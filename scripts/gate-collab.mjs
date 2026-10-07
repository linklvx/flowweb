#!/usr/bin/env node
// 批7 collab E2E 发布门禁（gate）：基础设施预检 → 自拉 API（COLLAB_FAKE_AI=1 + COLLAB_SWEEP_ENABLED=true，
// 单进程 node dist/main——重启零重编译）→ HTTP 控制面(:3100，/status /kill /start /logs) → playwright
// collab-recovery 套件 → 清理子进程 → 退出码透传。
// 为什么 API 归 gate 而非 playwright webServer：webServer 自起的服务 playwright 不提供杀/重启句柄
// （v5.7 注记），而批7 用例需要杀 API→重启的循环操纵。
// 用法：node scripts/gate-collab.mjs（本地需 PG 5432/Redis 6379 在跑；CI 由 workflow services 提供）
import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = path.join(ROOT, 'apps', 'api');
const WEB_DIR = path.join(ROOT, 'apps', 'web');
const API_CONTROL_PORT = Number(process.env.COLLAB_E2E_API_CONTROL_PORT) || 3100;
const API_ENV = {
  ...process.env,
  COLLAB_FAKE_AI: '1',        // 批7 fake provider（api-caller.service 生产 env 拒绝）
  COLLAB_SWEEP_ENABLED: 'true', // S4 会话过期 sweep（灰度开关——门禁环境显式开）
  MINIO_INIT: 'skip',         // B′（第九轮）：gate 场景零 MinIO 产物消费，显式裁剪 ensureBucket——
                              // 本地/CI 行为一致（原依赖本地真 MinIO 掩盖；CI 无 service 即启动红）
  COLLAB_LEASE_TTL_MS: '2000',      // kill/start 循环确定性：taskkill=SIGKILL 不释放租约，TTL 2s
  COLLAB_LEASE_HEARTBEAT_MS: '500', // 使重启后接管 ≤2s（HB 500 ≤ TTL/2 不变式；W17——无 FORCE，env 已删）
};

/** TCP 端口可连（有监听者）探测 */
function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => { s.destroy(); resolve(false); });
  });
}

async function waitForPort(port, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting for ${what} on port ${port}`);
}

async function waitForApiHealth(timeoutMs = 60_000) {
  // 预算 ≥TTL+5s：覆盖租约行残留死 owner 的接管窗（TTL 2s 下实际 ≤2.5s）
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // 子进程在等待期退出（端口被占等）即失败——防半启动状态被外部占用者冒名顶替
    if (!apiChild) throw new Error('API 子进程在启动等待期退出（见上方 [api] 日志——常见为 3000/3001 被残留进程占用）');
    try {
      // W17：/api/ready 双验——ready=true（租约在握+Redis 在线+not-serving 解除）≠WS 已监听，
      // 再补 3001 端口探测（就绪≠监听窗口）
      const res = await fetch('http://localhost:3000/api/ready');
      if (res.ok) {
        const body = await res.json();
        if (body.ready === true) {
          await waitForPort(3001, 10_000, 'collab WS(3001)');
          return;
        }
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('API ready timeout on :3000（/api/ready 未达 ready=true）');
}

// ── API 子进程管理 ────────────────────────────────────────────────────────────

let apiChild = null;
const logRing = []; // 子进程输出环形缓冲（/logs 供 S9 无 5xx/未捕获异常断言）
const pushLog = (chunk) => {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (!line) continue;
    logRing.push(line);
    if (logRing.length > 800) logRing.shift();
    process.stdout.write(`[api] ${line}\n`);
  }
};

function spawnApi() {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: API_DIR,
    env: API_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiChild = child;
  child.stdout.on('data', pushLog);
  child.stderr.on('data', pushLog);
  child.on('exit', (code, signal) => {
    pushLog(`[gate] API 子进程退出 code=${code} signal=${signal}`);
    // 实例守卫：taskkill 的 exit 事件可能迟到至下一实例 spawn 之后（s3b 实证）——
    // 旧实例的迟到退出不得抹掉新 apiChild 引用（否则健康等待误判"启动期退出"）
    if (apiChild === child) apiChild = null;
  });
}

/** 每次 API 启动前清租约行（V23/P1-2——必办⑥改判）：TTL env 对未过期的残留行（上轮 taskkill 死 owner/
 *  本地 test:int fixture）无效，owner=NULL 使新实例 CAS 立即命中（与 drill clearLeaseRow 同款 SQL；
 *  通道=API_DIR 的 prisma CLI db execute——与既有 migrate deploy 同一 shell-out 形态）。 */
function clearLeaseRow() {
  execSync('pnpm exec prisma db execute --stdin', {
    cwd: API_DIR,
    input: `UPDATE "CollabLease" SET owner = NULL, "expiresAt" = NULL, "renewedAt" = NULL WHERE scope = 'primary';`,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}

/** 临 spawn 复检 + 拉起 + 健康等待——preflight 与此刻之间有 ~1min 构建窗口，
 *  外部残留进程会让子进程 EADDRINUSE 假死、健康探针被冒名顶替（run5 实证）。 */
async function spawnApiChecked() {
  for (const port of [3000, 3001]) {
    if (await isPortOpen(port)) {
      throw new Error(`端口 ${port} 在构建窗口后被外部进程占用——请清除残留 node 进程后重跑（netstat -ano | grep :${port}）`);
    }
  }
  clearLeaseRow();
  spawnApi();
  await waitForApiHealth();
}

async function killApiTree() {
  const child = apiChild;
  if (!child) return;
  apiChild = null;
  if (process.platform === 'win32') {
    try { execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' }); } catch { /* 已退出 */ }
  } else {
    try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
  }
  // 等端口真正释放（3000/3001 关闭才返回——后续重启不撞端口）
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const open = (await isPortOpen(3000)) || (await isPortOpen(3001));
    if (!open) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('API 端口未在 15s 内释放（kill 后 3000/3001 仍监听）');
}

// ── 控制面（测试经 collab-helpers 的 killApi/startApi 消费） ──────────────────

const controlServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${API_CONTROL_PORT}`);
  const json = (body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  try {
    if (req.method === 'GET' && url.pathname === '/status') {
      return json({ up: !!apiChild || (await isPortOpen(3000)) });
    }
    if (req.method === 'GET' && url.pathname === '/logs') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(logRing.slice(-400).join('\n'));
    }
    if (req.method === 'POST' && url.pathname === '/kill') {
      await killApiTree();
      return json({ ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/start') {
      if (apiChild) return json({ ok: true }); // 幂等
      await spawnApiChecked();
      return json({ ok: true });
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e?.message ?? e));
  }
});

// ── 主流程 ───────────────────────────────────────────────────────────────────

async function preflight() {
  for (const [port, name] of [[5432, 'PostgreSQL'], [6379, 'Redis']]) {
    if (!(await isPortOpen(port))) {
      throw new Error(`基础设施预检失败：${name}(${port}) 未监听——请先启动本地服务（CI 由 services 容器提供）`);
    }
  }
  for (const port of [3000, 3001, 5173]) {
    if (await isPortOpen(port)) {
      throw new Error(`端口 ${port} 已被占用——gate 需要 3000/3001（自拉 API）与 5173（vite preview）空闲`);
    }
  }
  console.log('[gate] 预检通过：PG/Redis 在线，3000/3001/5173 空闲');

  console.log('[gate] shared build + 迁移 + seed（幂等）');
  execSync('pnpm --filter @flowweb/shared build', { cwd: ROOT, stdio: 'inherit' });
  execSync('pnpm exec prisma migrate deploy', { cwd: API_DIR, stdio: 'inherit' });
  execSync('pnpm exec prisma db seed', { cwd: API_DIR, stdio: 'inherit' });

  console.log('[gate] 构建 API（nest build——子进程直接 node dist/main，重启零重编译）');
  execSync('pnpm exec nest build', { cwd: API_DIR, stdio: 'inherit' });
}

async function main() {
  await preflight();

  console.log('[gate] 拉起 API（COLLAB_FAKE_AI=1 COLLAB_SWEEP_ENABLED=true）');
  await spawnApiChecked();

  await new Promise((resolve) => controlServer.listen(API_CONTROL_PORT, '127.0.0.1', resolve));
  console.log(`[gate] 控制面就绪 :${API_CONTROL_PORT}（/status /kill /start /logs）`);

  const playwrightEnv = {
    ...process.env,
    COLLAB_E2E_API_CONTROL: `http://127.0.0.1:${API_CONTROL_PORT}`,
  };
  // COLLAB_E2E_GREP="S3" 只跑匹配用例（调试快速迭代——全套 ~8min，单用例 ~1min）
  const grep = process.env.COLLAB_E2E_GREP ? ['--grep', process.env.COLLAB_E2E_GREP] : [];
  console.log('[gate] 运行 playwright：collab-recovery（双客户端 E2E）');
  const exitCode = await new Promise((resolve) => {
    const child = spawn('pnpm', ['exec', 'playwright', 'test', '-c', 'playwright.collab.config.ts', ...grep], {
      cwd: WEB_DIR,
      env: playwrightEnv,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
}

main()
  .catch((e) => {
    console.error(`[gate] 失败：${e?.message ?? e}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await killApiTree().catch(() => {});
    controlServer.close();
    // 给 stdout 冲刷一点时间再退出（exitCode 已定）
    setTimeout(() => process.exit(process.exitCode ?? 0), 300);
  });
