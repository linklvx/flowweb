// apps/api/scripts/drill-server-control.test.mjs —— TD-32/C2 T19：控制库 fake-child 判据族
// （node --test 池消费；与 verify-manifest scripts-node-test 列举同步登记）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const req = createRequire(here);
const { startDrillServer, DrillStartError, DrillPortInUse, DrillStartFailed, DrillExited, settle } = req('./lib/drill-server-control.js');

const dir = await mkdtemp(path.join(tmpdir(), 'drill-ctl-'));
let n = 0;
const KEEP_ALIVE = 'setInterval(() => {}, 1000);\n';
async function fakeChild(body) {
  const p = path.join(dir, `fake-${n++}.cjs`);
  await writeFile(p, `'use strict';\nconst send = (m) => { if (process.send) process.send(m); };\n${body}\n${KEEP_ALIVE}`);
  return p;
}
const EPHEMERAL_ENV = { COLLAB_PORT: '0', DRILL_HTTP_PORT: '0' };

async function startFake(body, opts = {}) {
  const entry = await fakeChild(body);
  return startDrillServer(EPHEMERAL_ENV, { entry, allowEphemeral: true, timeoutMs: 5_000, ...opts });
}

test('T19-①：http-only 两态——expectCollab:false 等 HTTP；waitCollab 后置补 wsPort', async () => {
  const h = await startFake(`
    send({ type: 'drill.http', httpPort: 40123 });
    setTimeout(() => send({ type: 'drill.collab-state', state: 'serving', stateSince: Date.now(), attempt: 1, wsPort: 40124 }), 60);
  `, { expectCollab: false });
  try {
    assert.equal(h.httpPort, 40123);
    assert.equal(h.wsPort, undefined);
    assert.equal(await h.waitCollab(), 40124);
  } finally { await h.stop(); }
});

test('T19-②：expectCollab:true 的 ready 语义=serving+wsPort（drill.http 先到仍等 collab）', async () => {
  const h = await startFake(`
    send({ type: 'drill.http', httpPort: 40125 });
    setTimeout(() => send({ type: 'drill.collab-state', state: 'serving', stateSince: Date.now(), attempt: 1, wsPort: 40126 }), 80);
  `, { expectCollab: true });
  try {
    assert.equal(h.httpPort, 40125);
    assert.equal(h.wsPort, 40126);
  } finally { await h.stop(); }
});

test('T19-③：exit1<2s——exit/error 立即 reject（code+stderr 尾+lastState）', async () => {
  const t0 = Date.now();
  const entry = await fakeChild(`
    process.stderr.write('fake-boom\\n');
    setTimeout(() => process.exit(1), 20);
  `);
  await assert.rejects(
    startDrillServer(EPHEMERAL_ENV, { entry, allowEphemeral: true, expectCollab: false, timeoutMs: 5_000 }),
    (e) => {
      assert.ok(e instanceof DrillExited, e && e.name);
      assert.equal(e.exitCode, 1);
      assert.match(e.stderr, /fake-boom/);
      return true;
    },
  );
  assert.ok(Date.now() - t0 < 2_000, 'exit 判据须 <2s');
});

test('T19-④：EADDRINUSE 即拒（首包 failure=null 次包补发；不落 15s grace）', async () => {
  const t0 = Date.now();
  await assert.rejects(
    startFake(`
      send({ type: 'drill.http', httpPort: 40127 });
      send({ type: 'drill.collab-state', state: 'start-failed', stateSince: Date.now(), attempt: 2, lastStartFailure: null });
      setTimeout(() => send({ type: 'drill.collab-state', state: 'start-failed', stateSince: Date.now(), attempt: 2,
        lastStartFailure: { code: 'EADDRINUSE', message: 'listen EADDRINUSE', at: Date.now(), attempt: 2, kind: 'port-in-use', stateSince: Date.now() } }), 40);
    `, { expectCollab: true }),
    (e) => e instanceof DrillPortInUse,
  );
  assert.ok(Date.now() - t0 < 2_000, 'EADDRINUSE typed 拒绝须 ≤2s');
});

test('T19-⑤：旧 attempt 的 EADDRINUSE 失败不误判（failure.attempt≠当前 attempt→继续等）', async () => {
  const h = await startFake(`
    send({ type: 'drill.http', httpPort: 40128 });
    send({ type: 'drill.collab-state', state: 'start-failed', stateSince: Date.now(), attempt: 2,
      lastStartFailure: { code: 'EADDRINUSE', message: 'stale', at: Date.now(), attempt: 1, kind: 'port-in-use', stateSince: Date.now() } });
    setTimeout(() => send({ type: 'drill.collab-state', state: 'serving', stateSince: Date.now(), attempt: 2, wsPort: 40129 }), 80);
  `, { expectCollab: true });
  try {
    assert.equal(h.wsPort, 40129);
  } finally { await h.stop(); }
});

test('T19-⑥：非端口失败超 grace（stateSince 已过期）→ typed reject', async () => {
  const t0 = Date.now();
  await assert.rejects(
    startFake(`
      send({ type: 'drill.http', httpPort: 40130 });
      send({ type: 'drill.collab-state', state: 'start-failed', stateSince: Date.now() - 20_000, attempt: 1,
        lastStartFailure: { code: 'EPERM', message: 'boom', at: Date.now(), attempt: 1, kind: 'other', stateSince: Date.now() - 20_000 } });
    `, { expectCollab: true, startFailedGraceMs: 15_000 }),
    (e) => e instanceof DrillStartFailed,
  );
  assert.ok(Date.now() - t0 < 2_000, '过期 grace 立即拒绝');
});

test('T19-⑦：二次重试窗不误杀（start-failed(10s) → starting → serving，grace 15s 内）', async () => {
  const h = await startFake(`
    send({ type: 'drill.http', httpPort: 40131 });
    send({ type: 'drill.collab-state', state: 'start-failed', stateSince: Date.now() - 10_000, attempt: 1,
      lastStartFailure: { code: 'EPERM', message: 'boom', at: Date.now() - 10_000, attempt: 1, kind: 'other', stateSince: Date.now() - 10_000 } });
    setTimeout(() => send({ type: 'drill.collab-state', state: 'starting', stateSince: Date.now(), attempt: 2 }), 60);
    setTimeout(() => send({ type: 'drill.collab-state', state: 'serving', stateSince: Date.now(), attempt: 2, wsPort: 40132 }), 120);
  `, { expectCollab: true, startFailedGraceMs: 15_000 });
  try {
    assert.equal(h.wsPort, 40132);
  } finally { await h.stop(); }
});

test('T19-⑧：后置三态（调用前已到达）——已存 serving→waitCollab 立即 resolve；已存 port-in-use（grace 已过期）→typed reject（窗内容重试见⑬）', async () => {
  const h1 = await startFake(`
    send({ type: 'drill.http', httpPort: 40133 });
    setTimeout(() => send({ type: 'drill.collab-state', state: 'serving', stateSince: Date.now(), attempt: 1, wsPort: 40134 }), 40);
  `, { expectCollab: false });
  try {
    await new Promise((r) => setTimeout(r, 120));   // 等 serving 消息先于 waitCollab 到达
    assert.equal(h1.wsPort, 40134);
    assert.equal(await h1.waitCollab(), 40134);
  } finally { await h1.stop(); }

  const h2 = await startFake(`
    send({ type: 'drill.http', httpPort: 40135 });
    setTimeout(() => send({ type: 'drill.collab-state', state: 'start-failed', stateSince: Date.now() - 20_000, attempt: 1,
      lastStartFailure: { code: 'EADDRINUSE', message: 'x', at: Date.now(), attempt: 1, kind: 'port-in-use', stateSince: Date.now() - 20_000 } }), 40);
  `, { expectCollab: false });
  try {
    await new Promise((r) => setTimeout(r, 120));
    await assert.rejects(h2.waitCollab(), (e) => e instanceof DrillPortInUse);
  } finally { await h2.stop(); }
});

test('T19-⑫：启动期 grace 重挂——二次非端口失败后按 T2 的 stateSince 起算（旧表自清后不再挂=60s 兜底假红）', async () => {
  const t0 = Date.now();
  await assert.rejects(
    startFake(`
      send({ type: 'drill.http', httpPort: 40139 });
      send({ type: 'drill.collab-state', state: 'start-failed', stateSince: Date.now(), attempt: 1,
        lastStartFailure: { code: 'EPERM', message: 'a', at: Date.now(), attempt: 1, kind: 'other', stateSince: Date.now() } });
      setTimeout(() => send({ type: 'drill.collab-state', state: 'starting', stateSince: Date.now(), attempt: 2 }), 60);
      setTimeout(() => send({ type: 'drill.collab-state', state: 'start-failed', stateSince: Date.now(), attempt: 2,
        lastStartFailure: { code: 'EPERM', message: 'b', at: Date.now(), attempt: 2, kind: 'other', stateSince: Date.now() } }), 120);
    `, { expectCollab: true, startFailedGraceMs: 200, timeoutMs: 5_000 }),
    (e) => {
      assert.ok(e instanceof DrillStartFailed, e && e.name);
      assert.doesNotMatch(e.message, /未在 5000ms|未在 5/, '不得落到 overall 超时（grace 重挂=红判据）');
      return true;
    },
  );
  assert.ok(Date.now() - t0 < 2_000, 'T2+grace 内 typed 拒绝（旧实现=60s 兜底）');
});

test('T19-⑬：waitCollab 端口失败容重试——grace 窗内 EADDRINUSE 不立即拒（网关持锁 5s 重试形态）', async () => {
  const h = await startFake(`
    send({ type: 'drill.http', httpPort: 40140 });
    setTimeout(() => send({ type: 'drill.collab-state', state: 'start-failed', stateSince: Date.now(), attempt: 1,
      lastStartFailure: { code: 'EADDRINUSE', message: 'transient', at: Date.now(), attempt: 1, kind: 'port-in-use', stateSince: Date.now() } }), 40);
    setTimeout(() => send({ type: 'drill.collab-state', state: 'starting', stateSince: Date.now(), attempt: 2 }), 80);
    setTimeout(() => send({ type: 'drill.collab-state', state: 'serving', stateSince: Date.now(), attempt: 2, wsPort: 40141 }), 140);
  `, { expectCollab: false });
  try {
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(await h.waitCollab({ startFailedGraceMs: 15_000 }), 40141);   // 窗内端口失败→等重试，不误杀
  } finally { await h.stop(); }
});

test('T19-⑨：failure code 变化补发——lastState 跟随（同 stateSince 重发亦消费）', async () => {
  const h = await startFake(`
    send({ type: 'drill.http', httpPort: 40136 });
    send({ type: 'drill.collab-state', state: 'start-failed', stateSince: Date.now(), attempt: 1,
      lastStartFailure: { code: 'EPERM', message: 'a', at: Date.now(), attempt: 1, kind: 'other', stateSince: Date.now() } });
    setTimeout(() => send({ type: 'drill.collab-state', state: 'start-failed', stateSince: Date.now(), attempt: 1,
      lastStartFailure: { code: 'EACCES', message: 'b', at: Date.now(), attempt: 1, kind: 'other', stateSince: Date.now() } }), 60);
  `, { expectCollab: false });
  try {
    const t0 = Date.now();
    while (Date.now() - t0 < 1_000 && h.lastState?.lastStartFailure?.code !== 'EACCES') await new Promise((r) => setTimeout(r, 20));
    assert.equal(h.lastState?.lastStartFailure?.code, 'EACCES');
  } finally { await h.stop(); }
});

test('T19-⑩：port0 守卫=显式选项（非 NODE_ENV）+ 子进程显式 COLLAB_ALLOW_EPHEMERAL=1', async () => {
  const entry = await fakeChild('void 0;');
  await assert.rejects(
    startDrillServer(EPHEMERAL_ENV, { entry, expectCollab: false }),
    (e) => e instanceof DrillStartError && /allowEphemeral/.test(e.message),
  );
  const out = path.join(dir, 'env-out.json');
  const entry2 = await fakeChild(`
    require('node:fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify({ ae: process.env.COLLAB_ALLOW_EPHEMERAL, pt: process.env.PROMETHEUS_TOKEN, at: process.env.COLLAB_ADMIN_TOKEN }));
    send({ type: 'drill.http', httpPort: 40137 });
  `);
  const h = await startDrillServer(EPHEMERAL_ENV, { entry: entry2, allowEphemeral: true, expectCollab: false, timeoutMs: 5_000 });
  try {
    const env = JSON.parse(await readFile(out, 'utf8'));
    assert.equal(env.ae, '1');
    assert.equal(env.pt, h.token);
    assert.equal(env.at, h.token);
    assert.match(h.token, /^[0-9a-f-]{36}$/);
  } finally { await h.stop(); }

  // 继承 env 的令牌不得泄漏（.env 经 tsx 带入 COLLAB_ADMIN_TOKEN 曾致 drain 403——T20 实锤回归）
  const out2 = path.join(dir, 'env-out2.json');
  const entry3 = await fakeChild(`
    require('node:fs').writeFileSync(${JSON.stringify(out2)}, JSON.stringify({ at: process.env.COLLAB_ADMIN_TOKEN, pt: process.env.PROMETHEUS_TOKEN }));
    send({ type: 'drill.http', httpPort: 40138 });
  `);
  const saved = process.env.COLLAB_ADMIN_TOKEN;
  process.env.COLLAB_ADMIN_TOKEN = 'inherited-bad';
  try {
    const h2 = await startDrillServer(EPHEMERAL_ENV, { entry: entry3, allowEphemeral: true, expectCollab: false, timeoutMs: 5_000 });
    const env2 = JSON.parse(await readFile(out2, 'utf8'));
    await h2.stop();
    assert.equal(env2.at, h2.token);
    assert.equal(env2.pt, h2.token);
  } finally {
    if (saved === undefined) delete process.env.COLLAB_ADMIN_TOKEN; else process.env.COLLAB_ADMIN_TOKEN = saved;
  }
});

test('卡② K5：settle 两通道+监听卫生（创建同拍落定化——零 unhandledRejection）', async () => {
  const bad = await settle(Promise.reject(new Error('boom')));
  assert.equal(bad.ok, false);
  assert.equal(bad.e.message, 'boom');
  const good = await settle(Promise.resolve(42));
  assert.equal(good.ok, true);
  assert.equal(good.v, 42);
  const seen = [];
  const on = (reason) => seen.push(reason);
  process.on('unhandledRejection', on);
  try {
    await settle(Promise.reject(new Error('boom2')));
    await new Promise((r) => setImmediate(r));   // await settle 后再等一个 setImmediate——unhandled 面才浮出
    assert.equal(seen.length, 0, `不得产生 unhandledRejection：${seen.map(String).join(';')}`);
  } finally {
    process.removeListener('unhandledRejection', on);   // 监听卫生=finally 摘（断言红也不漏监听）
  }
});

test('T19-⑪：entry 缺失→typed 拒绝；idle 子进程超时→DrillStartFailed（60s 兜底可配）', async () => {
  await assert.rejects(
    startDrillServer({}, { expectCollab: false }),
    (e) => e instanceof DrillStartError && /entry/.test(e.message),
  );
  const entry = await fakeChild('void 0;');
  const t0 = Date.now();
  await assert.rejects(
    startDrillServer(EPHEMERAL_ENV, { entry, allowEphemeral: true, expectCollab: false, timeoutMs: 300 }),
    (e) => e instanceof DrillStartFailed && /未在 300ms/.test(e.message),
  );
  assert.ok(Date.now() - t0 < 2_000);
});
