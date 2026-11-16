// apps/api/scripts/lib/drill-server-control.js —— TD-32/C2 T19：演练子进程控制库（CJS——kill9 tsx 与
// write-frozen mjs 双消费；.d.ts 同址供 TS 解析）。
// 契约（spec §4.2.4）：显式 entry；port0 守卫=显式选项非 NODE_ENV；expectCollab:true 的 ready 语义=
// serving 完成+wsPort 实际口；expectCollab:false 只等 HTTP（wsPort 后置 waitCollab 补齐）；
// EADDRINUSE（failure.attempt===当前 attempt）即拒；非端口失败 grace 从 stateSince 起算；
// exit/error 立即 reject（code+stderr 尾+lastState）；60s 兜底；环形缓冲；token=randomUUID。
'use strict';

const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

class DrillStartError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = this.constructor.name;
    Object.assign(this, extra);
  }
}
class DrillPortInUse extends DrillStartError {}
class DrillStartFailed extends DrillStartError {}
class DrillExited extends DrillStartError {}

class RingBuffer {
  constructor(cap) {
    this.cap = cap;
    this.chunks = [];
    this.size = 0;
  }
  push(chunk) {
    const s = String(chunk);
    this.chunks.push(s);
    this.size += s.length;
    while (this.size > this.cap && this.chunks.length > 1) this.size -= this.chunks.shift().length;
  }
  tail() {
    return this.chunks.join('').slice(-this.cap);
  }
}

/** 会话句柄（start 决议后返回）。 */
function makeHandle(ctx) {
  const { child, token, state, stderr, stdout, waitCollab } = ctx;
  return {
    child,
    token,
    get httpPort() { return state.httpPort; },
    get wsPort() { return state.collab && typeof state.collab.wsPort === 'number' ? state.collab.wsPort : undefined; },
    get lastState() { return state.collab; },
    get stderrTail() { return stderr.tail(); },
    get stdoutTail() { return stdout.tail(); },
    waitCollab,
    stop() {
      return new Promise((res) => {
        if (state.exited) return res();
        child.once('exit', () => res());
        try { child.kill('SIGKILL'); } catch { res(); }
        setTimeout(res, 2_000).unref?.();
      });
    },
  };
}

function startDrillServer(env, opts = {}) {
  return new Promise((resolve, reject) => {
    const {
      entry,
      expectCollab = false,
      timeoutMs = 60_000,
      startFailedGraceMs = 15_000,
      allowEphemeral = false,
    } = opts;
    if (!entry) {
      reject(new DrillStartError('startDrillServer: entry 必填（显式入口——禁隐式路径推导）'));
      return;
    }
    const childEnv = { ...process.env, ...env };
    const wantsEphemeral = childEnv.COLLAB_PORT === '0' || childEnv.DRILL_HTTP_PORT === '0';
    if (wantsEphemeral && !allowEphemeral) {
      reject(new DrillStartError('startDrillServer: port 0 需显式 allowEphemeral: true（显式选项非 NODE_ENV 推断）'));
      return;
    }
    if (wantsEphemeral) childEnv.COLLAB_ALLOW_EPHEMERAL = '1';   // drill 腿 NODE_ENV 缺省=production——必须显式 opt-in
    const token = randomUUID();
    // 显式 env 传入方为准；否则用本库 token 覆盖继承值（.env 可能经 tsx 带入 COLLAB_ADMIN_TOKEN——
    // 继承会让子进程令牌≠handle.token=drain 403，T20 实锤）
    if (!(env && env.PROMETHEUS_TOKEN)) childEnv.PROMETHEUS_TOKEN = token;
    if (!(env && env.COLLAB_ADMIN_TOKEN)) childEnv.COLLAB_ADMIN_TOKEN = token;

    const child = spawn(process.execPath, [entry], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const stdout = new RingBuffer(4_000);
    const stderr = new RingBuffer(4_000);
    child.stdout.on('data', (d) => stdout.push(d));
    child.stderr.on('data', (d) => stderr.push(d));

    const state = { httpPort: undefined, collab: null, exited: null };
    let settled = false;
    let startGraceTimer = null;
    let startGraceStateSince = null;
    const waiters = [];

    const clearStartGrace = () => {
      if (startGraceTimer) { clearTimeout(startGraceTimer); startGraceTimer = null; }
      startGraceStateSince = null;
    };
    const failStart = (err) => {
      if (settled) return;
      settled = true;
      clearStartGrace();
      clearTimeout(overall);
      try { child.kill('SIGKILL'); } catch { /* 已退出 */ }   // 启动失败不留孤儿（测试/CI 收口）
      reject(err);
    };
    const resolveStart = () => {
      if (settled) return;
      settled = true;
      clearStartGrace();
      clearTimeout(overall);
      resolve(makeHandle({ child, token, state, stderr, stdout, waitCollab }));
    };

    const finishWaiter = (w, err) => {
      const i = waiters.indexOf(w);
      if (i < 0) return;
      waiters.splice(i, 1);
      if (w.timer) clearTimeout(w.timer);
      if (w.deadline) clearTimeout(w.deadline);
      w.graceStateSince = null;
      if (err) w.reject(err);
      else w.resolve(state.collab.wsPort);
    };

    const portInUseOf = (c) => c.lastStartFailure && c.lastStartFailure.kind === 'port-in-use' && c.lastStartFailure.attempt === c.attempt;

    const evaluateFailure = (c, onFail) => {
      if (c.state !== 'start-failed' || !c.lastStartFailure) return false;
      if (portInUseOf(c)) {
        onFail(new DrillPortInUse(`drill-server 端口占用（EADDRINUSE，attempt ${c.attempt}）`, { lastState: c, stderr: stderr.tail() }));
        return true;
      }
      const remaining = c.stateSince + startFailedGraceMs - Date.now();
      if (remaining <= 0) {
        onFail(new DrillStartFailed(`drill-server 启动失败超 grace（${startFailedGraceMs}ms）：${c.lastStartFailure.kind}`, { lastState: c, stderr: stderr.tail() }));
        return true;
      }
      if (!startGraceTimer || startGraceStateSince !== c.stateSince) {
        clearStartGrace();
        const dueStateSince = c.stateSince;
        startGraceStateSince = dueStateSince;
        startGraceTimer = setTimeout(() => {
          startGraceTimer = null;
          startGraceStateSince = null;
          const cur = state.collab;
          if (settled || !cur || cur.state !== 'start-failed' || cur.stateSince !== dueStateSince) return;
          failStart(new DrillStartFailed(`drill-server 启动失败超 grace（${startFailedGraceMs}ms）：${cur.lastStartFailure && cur.lastStartFailure.kind}`, { lastState: cur, stderr: stderr.tail() }));
        }, remaining);
        startGraceTimer.unref?.();
      }
      return false;
    };

    const pumpWaiters = () => {
      const c = state.collab;
      if (!c) return;
      if (c.state !== 'start-failed') {
        for (const w of waiters) { if (w.timer) { clearTimeout(w.timer); w.timer = null; } }
      }
      for (const w of [...waiters]) {
        if (c.state === 'serving' && typeof c.wsPort === 'number') { finishWaiter(w, null); continue; }
        if (c.state !== 'start-failed' || !c.lastStartFailure) continue;
        const remaining = c.stateSince + w.graceMs - Date.now();
        // 端口失败：grace 内不立即拒（网关持锁 5s 重试——A listener 关闭竞态窗口内 B 首次 listen 可
        // EADDRINUSE 后重试成功）；grace 到期仍 start-failed 才按端口故障 typed 拒绝。
        if (portInUseOf(c)) {
          if (remaining <= 0) finishWaiter(w, new DrillPortInUse(`drill-server 端口占用（EADDRINUSE，attempt ${c.attempt}）`, { lastState: c, stderr: stderr.tail() }));
          else scheduleWaiterGrace(w, c.stateSince, remaining);
          continue;
        }
        if (remaining <= 0) { finishWaiter(w, new DrillStartFailed(`drill-server 启动失败超 grace（${w.graceMs}ms）：${c.lastStartFailure.kind}`, { lastState: c, stderr: stderr.tail() })); continue; }
        scheduleWaiterGrace(w, c.stateSince, remaining);
      }
    };

    const scheduleWaiterGrace = (w, dueStateSince, remaining) => {
      if (w.timer && w.graceStateSince === dueStateSince) return;
      if (w.timer) clearTimeout(w.timer);
      w.graceStateSince = dueStateSince;
      w.timer = setTimeout(() => {
        w.timer = null;
        const cur = state.collab;
        if (cur && cur.state === 'start-failed' && cur.stateSince === dueStateSince) pumpWaiters();
      }, remaining);
      w.timer.unref?.();
    };

    const maybeResolveStart = () => {
      if (settled) return;
      if (!expectCollab) {
        if (state.httpPort !== undefined) resolveStart();
        return;
      }
      const c = state.collab;
      if (!c || state.httpPort === undefined) return;
      if (c.state === 'serving' && typeof c.wsPort === 'number') { resolveStart(); return; }
      evaluateFailure(c, (err) => failStart(err));
    };

    child.on('message', (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.type === 'drill.http') {
        state.httpPort = m.httpPort;
        maybeResolveStart();
        return;
      }
      if (m.type === 'drill.collab-state') {
        state.collab = {
          state: m.state,
          stateSince: m.stateSince,
          attempt: m.attempt,
          ...(typeof m.wsPort === 'number' ? { wsPort: m.wsPort } : {}),
          lastStartFailure: m.lastStartFailure ?? null,
        };
        if (state.collab.state !== 'start-failed') clearStartGrace();   // 重试窗=旧 grace 表作废（T2 按新 stateSince 重挂）
        maybeResolveStart();
        pumpWaiters();
      }
    });

    child.once('exit', (code, signal) => {
      state.exited = { code, signal };
      const err = new DrillExited(`drill-server 退出（code=${code} signal=${signal}）`, { exitCode: code, signal, stderr: stderr.tail(), lastState: state.collab });
      failStart(err);
      for (const w of [...waiters]) finishWaiter(w, err);
    });
    child.once('error', (e) => {
      const err = new DrillExited(`drill-server spawn error: ${e.message}`, { stderr: stderr.tail(), lastState: state.collab });
      failStart(err);
      for (const w of [...waiters]) finishWaiter(w, err);
    });

    const overall = setTimeout(() => {
      failStart(new DrillStartFailed(`drill-server 未在 ${timeoutMs}ms 内就绪`, { lastState: state.collab, stderr: stderr.tail(), stdout: stdout.tail() }));
    }, timeoutMs);
    overall.unref?.();

    /** 后置补等（expectCollab:false 的主消费面）：同步读已存态+同步挂监听（间无 await——丢消息窗闭合）。 */
    const waitCollab = (wopts = {}) => {
      const graceMs = wopts.startFailedGraceMs ?? 15_000;
      const wTimeout = wopts.timeoutMs ?? 60_000;
      return new Promise((res, rej) => {
        const w = { resolve: res, reject: rej, graceMs, timer: null, deadline: null };
        waiters.push(w);
        w.deadline = setTimeout(() => finishWaiter(w, new DrillStartFailed(`waitCollab 未在 ${wTimeout}ms 内 serving`, { lastState: state.collab, stderr: stderr.tail() })), wTimeout);
        w.deadline.unref?.();
        if (state.exited) { finishWaiter(w, new DrillExited('drill-server 已退出', { stderr: stderr.tail(), lastState: state.collab })); return; }
        pumpWaiters();
      });
    };
  });
}

/** 卡② K5：创建同拍落定化判别式（drill 计时 Promise 所有权）——成功值为 Error 不并通道，全仓唯一实现。 */
function settle(p) {
  return p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
}

module.exports = { startDrillServer, DrillStartError, DrillPortInUse, DrillStartFailed, DrillExited, settle };
