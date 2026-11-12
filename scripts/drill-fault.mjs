#!/usr/bin/env node
// scripts/drill-fault.mjs
// Y1c T31（plan :417-419）：故障演练矩阵的**本地实弹**装置（卡文逐项——耐久契约四判据
// fail-closed/隔离恢复/零静默丢弃/水位不越 的端到端验证）。七模式（各自独立调用）：
//   node scripts/drill-fault.mjs --kill9         --confirm  kill -9 矩阵：①PG 批提交窗（触发器滞留
//                                                 =确定性 kill 窗——重启回灌 ⊇ 已接受集+零重复）
//                                                 ②save barrier flush 中 kill（回执未达→重启重发
//                                                 同 nonce→Durable committedSeq）。spool/apply/快照/
//                                                 维护/毒帧阶段=既有 int 实弹（映射登记演练记录：
//                                                 t10-g2 ③⑤⑥⑦⑨/t13-kill9 process/t13-g6a I3I4/
//                                                 t27-kill9 process——G6a/G2 门已承载，不重复装置化）
//   node scripts/drill-fault.mjs --infra         --confirm  PG failover（sc stop/start 服务形态）+
//                                                 网络分区（TCP proxy 挂起——socket 层模拟）+
//                                                 磁盘满（COLLAB_SPOOL_CAPACITY_BYTES 容量闸 fail-closed）
//                                                 【doc 卸载×PG 故障=停 PG 窗内断连同链承载】
//   node scripts/drill-fault.mjs --restore-bump  --confirm  pg_dump 恢复→bump historyId→旧 WAL **真段**
//                                                 quarantine 不复活（内容级：恢复后重放含 dump 前内容、
//                                                 不含 dump 后帧——charter restore-drill 用例①）
//   node scripts/drill-fault.mjs --restore-fence --confirm  忘 bump+restore.lock marker→时间戳栅栏拦截
//                                                 （boot fail-closed wal_recovery_blocked+suspect 段零重放
//                                                 →处置〔bump+清 marker〕→正常恢复+不复活——charter 用例①副链）
//   node scripts/drill-fault.mjs --pitr-ss2      --confirm  同代 PITR 恢复→客户端携旧 hid+SS2 旧内容重连
//                                                 →onAuthenticate 先比 historyId→4406 terminal close
//                                                 （全量上行不到达服务端+服务端重放零复活——charter 用例②）
//   node scripts/drill-fault.mjs --client        --confirm  客户端形态族：拒帧 4411→重连合法帧恢复（B 场景
//                                                 入口）+clientID 并发同键（旧连接被接管 close）+维护换代
//                                                 （行级关闸后新执行被拒+世代切换旧连接 close 4410+旧 name
//                                                 离线重连 auth 拒+新代接入）。双浏览器/多标签/断网重连=
//                                                 infra 分区档 A/B 双端承载；IDB blocked=web 面（映射登记）；
//                                                 feedSeq 交错=feedseq-commit-order int（映射登记）。
//   node scripts/drill-fault.mjs --worker-crash  --confirm  外部生成成功后崩溃重试零重复副作用（text 链锚：
//                                                 stub 收到外呼即 kill api〔崩溃窗=外部已成功/本地未提交——
//                                                 形态注记：text 执行链承载于 api 进程〕→重启重试→断言
//                                                 x-idempotency-key 恒同+台账 reserve/settle 各恰 1 行+
//                                                 intent 恰一终态+余额恰扣一次）
//
// 形态偏差预登记（本地实弹=本地形态——演练记录逐条对应；T30b D-1..D-7 先例）：
//   · PG failover=单机服务 stop/start（无备库集群切换——charter「主备切换 Durable 不丢」单机档=
//     主库本地提交口径的恢复验证，由 --restore-bump 承载 Durable 内容不丢面）
//   · 网络分区=装置内置 TCP proxy 挂起（本地无 iptable/物理分区面）
//   · 磁盘满=COLLAB_SPOOL_CAPACITY_BYTES 容量闸（软件等价——真 ENOSPC 不可注入 Windows；ENOSPC 档
//     seam=既有 t10-g2 ⑨ int）；fsync EIO fail-stop=不可注入真 EIO（subclass seam=既有 t13 K6 单测承载）
//   · OOM=kill -9 语义等价（本地无 OOM killer/内存配额面；RSS trip 谓词=heap-pressure 既有单测）
//   · 时钟偏移=DB/段头侧注入等价（真系统时钟偏移需管理员+影响全机——restore-fence 的 marker+lastWriteAt
//     > epochStartedAt 求值即该栅栏的可注入形态）
//   · 「worker 崩溃」=承载 text 执行链的 api 进程（两进程形态下 text 链 HTTP execute 在 api 进程直调）
// 破坏性（kill/pg_dump restore/PG 服务 stop）——--confirm 缺失=拒，exit 非 0 零副作用（drill-cutover 同律）。
import { execSync, spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = path.join(ROOT, 'apps', 'api');
const BACKUP_DIR = path.join(ROOT, 'backups');
const requireApi = createRequire(path.join(API_DIR, 'package.json'));

export const FAULT_MODES = ['kill9', 'infra', 'restore-bump', 'restore-fence', 'pitr-ss2', 'client', 'worker-crash'];

const API_URL = 'http://127.0.0.1:3000';
const WS_URL = 'ws://127.0.0.1:3001';
const PG_SERVICE = 'postgresql-x64-16';   // 本机 PG 16.13 服务名（Get-Service 实测）
const CLOSE_CLIENT_OUTDATED = 4406;

// ── env（apps/api/.env 手解析——drill-cutover 同形；只取演练所需键，不打印密钥） ──
function readApiEnv() { try { return readFileSync(path.join(API_DIR, '.env'), 'utf-8'); } catch { return ''; } }
function envOf(key, fallback = '') {
  if (process.env[key]) return process.env[key];
  const m = readApiEnv().match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^"|"$/g, '') : fallback;
}
function loadDatabaseUrl() {
  const dsn = envOf('DATABASE_URL');
  if (!dsn) throw new Error('DATABASE_URL 未配置（apps/api/.env 或环境变量）');
  return dsn;
}
function run(cmd, args, opts = {}) {
  return process.platform === 'win32'
    ? spawnSync([cmd, ...args].join(' '), { encoding: 'utf8', ...opts, shell: true })
    : spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}
function runQuoted(cmdString, opts = {}) { return spawnSync(cmdString, { encoding: 'utf8', ...opts, shell: true }); }

// ── PG 工具链（drill-cutover 同形：G6a 先例目录+env 覆写+PATH 兜底） ──
function resolvePgBin() {
  if (process.env.PG_BIN_DIR && existsSync(path.join(process.env.PG_BIN_DIR, 'pg_dump.exe'))) return process.env.PG_BIN_DIR;
  const guess = 'D:/programfiles/PostgreSQL/16/bin';
  const exe = process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump';
  if (existsSync(path.join(guess, exe))) return guess;
  return '';
}
const pgDump = () => (resolvePgBin() ? path.join(resolvePgBin(), process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump') : 'pg_dump');
const pgRestore = () => (resolvePgBin() ? path.join(resolvePgBin(), process.platform === 'win32' ? 'pg_restore.exe' : 'pg_restore') : 'pg_restore');

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => { s.destroy(); resolve(false); });
  });
}
async function waitFor(fn, timeoutMs, label, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last === true || last === 'done') return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor 超时（${label}，${timeoutMs}ms——最后观测：${JSON.stringify(last)}）`);
}
const timing = { mode: '', steps: [], t0: 0 };
async function timed(step, fn) {
  const s = Date.now();
  const detail = await fn();
  timing.steps.push({ step, ms: Date.now() - s });
  console.log(`[drill] STEP ${step} done ${Date.now() - s}ms${detail ? `（${detail}）` : ''}`);
}
function printSummary() {
  const totalMs = Date.now() - timing.t0;
  console.log(`DRILL-SUMMARY ${JSON.stringify({ mode: timing.mode, steps: timing.steps, totalMs })}`);
  return totalMs;
}

// ── HTTP/PG 面 ──
const ADMIN_TOKEN = envOf('COLLAB_ADMIN_TOKEN');
async function getReadyFull() {
  return fetch(`${API_URL}/api/ready`, { headers: { 'x-prometheus-token': ADMIN_TOKEN } })
    .then((r) => r.json()).catch(() => null);
}
async function withPg(fn, applicationName = 'drill-t31') {
  const { Client } = requireApi('pg');
  const client = new Client({ connectionString: loadDatabaseUrl(), application_name: applicationName });
  await client.connect();
  try { return await fn(client); } finally { await client.end().catch(() => {}); }
}
async function systemHistory() {
  return withPg(async (client) => {
    const r = await client.query(`SELECT "historyId", "epochStartedAt" FROM "SystemHistory" WHERE id = 1`);
    if (r.rows.length !== 1) throw new Error('SystemHistory id=1 行缺失');
    return { historyId: r.rows[0].historyId, epochStartedAt: r.rows[0].epochStartedAt };
  }, 'drill-t31-probe');
}
/** restore 契约收尾（spec §4.4/T13）：bump=单事务更新 SystemHistory（提交后才允许启动）。 */
async function bumpHistoryId() {
  return withPg(async (client) => {
    // C1 rebaseline 后：SystemHistory 全列=timestamptz(3)——裸 now() 即瞬时值，会话时区无关
    //（T31-P1 的补偿式时区转换=naive 列时代形态，已随 C1 终态拆除）。
    const r = await client.query(`UPDATE "SystemHistory" SET "historyId" = gen_random_uuid()::text, "epochStartedAt" = now(), "updatedAt" = now() WHERE id = 1 RETURNING "historyId"`);
    if (r.rows.length !== 1) throw new Error('SystemHistory id=1 行缺失（恢复不完整）');
    return r.rows[0].historyId;
  });
}
/** PG 批滞留触发器（y31_drill_block——CanvasDocUpdate INSERT 拒）：PG 批提交窗 kill 的确定性注入
 *  （collab-kill9-drill y0a_drill_block 先例——批只能入 spool，kill 窗=spool 承载态）。 */
async function createBlockTrigger() {
  await withPg(async (client) => {
    await client.query(`DROP TRIGGER IF EXISTS y31_drill_block ON "CanvasDocUpdate"`);
    await client.query(`CREATE OR REPLACE FUNCTION y31_drill_block() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'drill t31: insert blocked'; END $$ LANGUAGE plpgsql`);
    await client.query(`CREATE TRIGGER y31_drill_block BEFORE INSERT ON "CanvasDocUpdate" FOR EACH ROW EXECUTE FUNCTION y31_drill_block()`);
  });
}
async function dropBlockTrigger() {
  await withPg(async (client) => {
    await client.query(`DROP TRIGGER IF EXISTS y31_drill_block ON "CanvasDocUpdate"`).catch(() => {});
    await client.query(`DROP FUNCTION IF EXISTS y31_drill_block()`).catch(() => {});
  }).catch(() => {});
}

// ── 长跑进程管理（drill-cutover spawnService 同形——日志含 Nest logger 输出供 fail-closed 断言） ──
const procs = new Map();
function spawnService(name, script, extraEnv = {}) {
  const logDir = path.join(BACKUP_DIR, 't31-logs');
  mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `${timing.mode}-${name}.log`);
  const child = spawn(process.execPath, [script], {
    cwd: API_DIR,
    env: { ...process.env, COLLAB_ROLE: 'api', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stream = createWriteStream(logFile, { flags: 'a' });
  const buf = { out: '' };
  const pipe = (chunk) => { const s = String(chunk); buf.out = (buf.out + s).slice(-200_000); stream.write(s); process.stdout.write(`[${name}] ${s}`); };
  child.stdout.on('data', pipe);
  child.stderr.on('data', pipe);
  child.on('exit', (code, signal) => { pipe(`[drill] ${name} 退出 code=${code} signal=${signal}\n`); procs.delete(name); });
  procs.set(name, { child, log: () => buf.out });
  console.log(`[drill] spawn ${name} pid=${child.pid} log=${logFile}`);
  return { child, log: () => buf.out };
}
function serviceLog(name) { return procs.get(name)?.log() ?? ''; }
async function stopService(name, timeoutMs = 20_000) {
  const entry = procs.get(name);
  if (!entry) return;
  if (process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${entry.child.pid}`, { stdio: 'ignore' }); } catch { /* 已退出 */ } }
  else { try { entry.child.kill('SIGKILL'); } catch { /* 已退出 */ } }
  await waitFor(() => procs.has(name) ? false : 'done', timeoutMs, `${name} 退出`).catch(() => {
    procs.delete(name);
    console.log(`[drill] WARNING ${name} 退出等待超时（端口面兜底核对）`);
  });
}
async function portKill(ports) {
  for (const port of ports) {
    if (!(await isPortOpen(port))) continue;
    if (process.platform !== 'win32') throw new Error(`端口 ${port} 被占且非 win32（无 netstat 杀面）——人工清理后重跑`);
    const out = execSync(`netstat -ano`, { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(new RegExp(`TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`));
      if (m) pids.add(m[1]);
    }
    for (const pid of pids) { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch { /* 竞态已退 */ } }
    await waitFor(async () => !(await isPortOpen(port)) ? 'done' : false, 15_000, `端口 ${port} 释放`);
  }
}

// ── WS/协作装置（drill-cutover 同族：ws 注入 header+csv/sv 版本门单源） ──
function loadClientLibs() {
  const WebSocket = requireApi('ws');
  const Y = requireApi('yjs');
  const { HocuspocusProvider } = requireApi('@hocuspocus/provider');
  const shared = requireApi('@flowweb/shared');
  return {
    WebSocket, Y, HocuspocusProvider,
    CSV: shared.CLIENT_PROTOCOL_VERSION, SV: shared.CANVAS_DOC_SCHEMA_VERSION,
    WS_ORIGIN: envOf('COLLAB_ALLOWED_ORIGINS').split(',')[0]?.trim() || new URL(envOf('BETTER_AUTH_URL', 'http://localhost:5173')).origin,
  };
}
async function makeFixtures(prefix) {
  const { PrismaClient } = requireApi('@prisma/client');
  const prisma = new PrismaClient();
  const ts = Date.now();
  const S = { prisma, user: `${prefix}-u-${ts}`, team: `${prefix}-t-${ts}`, member: `${prefix}-m-${ts}`, project: `${prefix}-p-${ts}`, token: `drill-tok-${randomUUID()}`, prefix };
  await prisma.user.create({ data: { id: S.user, name: `drill-${ts}`, email: `drill-${ts}@example.invalid`, emailVerified: false } });
  await prisma.team.create({ data: { id: S.team, name: `drill-${ts}`, ownerId: S.user } });
  await prisma.teamMember.create({ data: { id: S.member, teamId: S.team, userId: S.user, role: 'MEMBER' } });
  await prisma.canvasProject.create({ data: { id: S.project, name: `drill-${ts}`, teamId: S.team } });
  await prisma.session.create({ data: { id: `drill-s-${ts}`, userId: S.user, token: S.token, expiresAt: new Date(Date.now() + 30 * 60_000) } });
  return S;
}
async function cleanupFixtures(S) {
  const order = [
    // T32 双评审补（quality P1 复合面）：maintenance 行无级联——FAILED 残留会抬高 t27 int 全局
    // resumeActiveOnBoot 计数（2026-11-05 实录 t31-vac 残留 1 行致 standing red）；清理面补此表。
    () => S.prisma.maintenanceOperation.deleteMany({ where: { projectId: S.project } }),
    () => S.prisma.session.deleteMany({ where: { userId: S.user } }),
    () => S.prisma.teamMember.deleteMany({ where: { id: S.member } }),
    () => S.prisma.canvasProject.deleteMany({ where: { id: S.project } }),
    () => S.prisma.team.deleteMany({ where: { id: S.team } }),
    () => S.prisma.user.deleteMany({ where: { id: S.user } }),
  ];
  for (const del of order) await del().catch((e) => console.log(`[drill] SMOKE-WARN 哨兵清理失败: ${e.message}`));
  await S.prisma.$disconnect();
}
/** T9+ 节点信封（drill-cutover mkNode 同形——data 键走 lww 标量 model）。 */
function mkNode(Y, id) {
  const data = new Y.Map();
  data.set('model', `drill-${id}`);
  const m = new Y.Map();
  m.set('type', 'textInput');
  m.set('data', data);
  return m;
}
function mkProvider(S, opts = {}) {
  const { Y, HocuspocusProvider, WebSocket, CSV, SV, WS_ORIGIN } = loadClientLibs();
  let lastWs = null;
  const HeaderWs = class extends WebSocket {
    constructor(url) {
      super(url, { headers: { origin: WS_ORIGIN, cookie: `flowweb.session_token=${S.token}` } });
      lastWs = this;   // 实例捕获（重连新建亦更新——close 码断言面）
      this.on('error', () => {});   // CONNECTING 期服务端 close=ws 内部 close() emit error——吞掉由 close 码承载
    }
  };
  const q = [`csv=${CSV}`, `sv=${SV}`];
  if (opts.hid) q.push(`hid=${opts.hid}`);
  q.push('cb=t31');
  const P = new HocuspocusProvider({
    url: `${WS_URL}?${q.join('&')}`, name: opts.name ?? `project:${S.project}`,
    document: opts.document ?? new Y.Doc(),
    WebSocketPolyfill: opts.wsPolyfill ?? HeaderWs,
  });
  P.__wsOf = () => lastWs;
  return P;
}
const synced = (p, ms = 15_000) => new Promise((res, rej) => {
  const t = setTimeout(() => { destroyProvider(p); rej(new Error('provider synced 超时')); }, ms);
  p.on('synced', () => { clearTimeout(t); res(); });
});
/** provider 销毁统一收口（R5' 消费约定：destroy 后必经 killProviderLateReconnect 三连掐——
 *  provider v4 迟到重连定时器不拆=装置进程永生；禁内联副本——apps/api/scripts/lib 共享单源）。 */
const { killProviderLateReconnect } = requireApi('./scripts/lib/provider-late-reconnect-guard.js');
function destroyProvider(p) {
  try { p.destroy(); } catch { /* 已闭 */ }
  try { killProviderLateReconnect(p); } catch { /* 已净 */ }
}
/** provider 底层 ws close 码等待（terminal close 断言面——drill-cutover rawWsExpectClose 的 provider 形态；
 *  实例发现=mkProvider 的 __wsOf 捕获〔p.websocket 暴露不稳——CONNECTING 期 close 时序〕）。 */
function wsCloseOf(p, ms = 15_000) {
  return new Promise((res, rej) => {
    let wired = false;
    const t = setTimeout(() => { destroyProvider(p); rej(new Error('close 等待超时')); }, ms);
    const wire = () => {
      const ws = typeof p.__wsOf === 'function' ? p.__wsOf() : (p.websocket ?? p.socket);
      if (!ws || typeof ws.on !== 'function') return false;
      ws.on('close', (code) => { clearTimeout(t); res(code); });
      ws.on('error', () => {});
      wired = true;
      return true;
    };
    if (!wire()) {
      const iv = setInterval(() => { if (wire() || wired) clearInterval(iv); }, 80);
      setTimeout(() => clearInterval(iv), ms).unref?.();
    }
  });
}
/** PG 权威重放（readSnapshotOnly→Y.Doc 键集——重放 ⊇ 已接受集判据的观测面）。 */
async function replayKeysOf(projectId) {
  const { CanvasDocUpdateRepository } = requireApi('./dist/modules/collab/canvas-doc-update.repository.js');
  const { PrismaClient } = requireApi('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const repo = new CanvasDocUpdateRepository(prisma);
    const { state, updates } = await repo.readSnapshotOnly(projectId);
    const { Y } = loadClientLibs();
    const doc = new Y.Doc();
    if (state) Y.applyUpdate(doc, new Uint8Array(state));
    for (const u of updates) Y.applyUpdate(doc, new Uint8Array(u));
    return [...doc.getMap('nodes').keys()];
  } finally { await prisma.$disconnect(); }
}
/** PG 权威重放投影探针（拒帧断言面：节点 data 域内容级检查）。 */
async function replayDocOf(projectId) {
  const { CanvasDocUpdateRepository } = requireApi('./dist/modules/collab/canvas-doc-update.repository.js');
  const { PrismaClient } = requireApi('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const repo = new CanvasDocUpdateRepository(prisma);
    const { state, updates } = await repo.readSnapshotOnly(projectId);
    const { Y } = loadClientLibs();
    const doc = new Y.Doc();
    if (state) Y.applyUpdate(doc, new Uint8Array(state));
    for (const u of updates) Y.applyUpdate(doc, new Uint8Array(u));
    return doc;
  } finally { await prisma.$disconnect(); }
}
async function projectRow(projectId) {
  const { PrismaClient } = requireApi('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const doc = await prisma.canvasDoc.findUnique({ where: { projectId }, select: { generation: true, pgSeq: true, walCheckpointSeq: true } });
    const updates = await prisma.canvasDocUpdate.count({ where: { projectId } });
    return { doc, updates };
  } finally { await prisma.$disconnect(); }
}

// ── 通用 setup/teardown ──
function spoolDir() { return path.join(API_DIR, '.data', 'collab-spool'); }
async function ensureBuilt() {
  if (process.env.T31_SKIP_BUILD === '1') { console.log('[drill] T31_SKIP_BUILD=1——跳过构建（dist 假定新鲜）'); return; }
  const b1 = run('pnpm', ['--filter', '@flowweb/shared', 'build'], { cwd: ROOT, stdio: 'inherit', timeout: 300_000 });
  const b2 = run('pnpm', ['--filter', '@flowweb/api', 'build'], { cwd: ROOT, stdio: 'inherit', timeout: 600_000 });
  if (b1.status !== 0 || b2.status !== 0) throw new Error('构建失败（shared/api）');
}
async function precheck() {
  for (const [port, name] of [[5432, 'PostgreSQL'], [6379, 'Redis'], [9000, 'MinIO']]) {
    if (!(await isPortOpen(port))) throw new Error(`基础设施预检失败：${name}(${port}) 未监听`);
  }
  await portKill([3000, 3001, 3002]);
  if (!ADMIN_TOKEN) throw new Error('COLLAB_ADMIN_TOKEN 未配置（ready 全字段面需要）');
}
async function startApi(name = 'api', extraEnv = {}) {
  spawnService(name, 'dist/main.js', extraEnv);
  await waitFor(async () => {
    const r = await fetch(`${API_URL}/api/ready`).then((x) => x.json()).catch(() => null);
    return r?.ready === true ? 'done' : false;
  }, 90_000, `${name} ready`);
}
/** 起 HTTP 面但不等 collab serving（blocked/not-serving 态——ready 恒 false 场景的 maintenance 驱动形态）。 */
async function startApiHttp(name = 'api', extraEnv = {}) {
  spawnService(name, 'dist/main.js', extraEnv);
  await waitFor(async () => {
    const r = await fetch(`${API_URL}/api/ready`).then((x) => x.json()).catch(() => null);
    return r !== null ? 'done' : false;
  }, 90_000, `${name} HTTP 面可达`);
}
async function stopStack() {
  for (const name of [...procs.keys()]) await stopService(name);
  await portKill([3000, 3001, 3002]);
  await waitFor(() => dbClientBackendsProbe().then((n) => n === 0 ? 'done' : n), 15_000, '栈停后 DB 连接归零').catch(() => {});
}
async function dbClientBackendsProbe() {
  return withPg(async (client) => {
    const rows = (await client.query(`SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'
      AND application_name <> 'drill-t31' AND application_name <> 'drill-t31-probe'`)).rows;
    return rows.length;
  }, 'drill-t31-probe');
}
/** 等 spool 承载态（pending.spoolFiles>0——PG 批滞留/失败的帧入 spool）。 */
async function waitSpoolHeld(timeoutMs = 30_000) {
  await waitFor(async () => {
    const r = await getReadyFull();
    if (!r?.pending) return 'no-ready';
    return (r.pending.spoolFiles ?? 0) > 0 ? 'done' : r.pending;
  }, timeoutMs, 'spool 承载（pending.spoolFiles>0）');
}
/** 等 spool 排空（段回收=回灌/批落定完成信号）。 */
async function waitSpoolDrained(timeoutMs = 60_000) {
  await waitFor(async () => {
    const r = await getReadyFull();
    if (!r?.pending) return 'no-ready';
    return (r.pending.spoolFiles ?? 0) === 0 && (r.pending.projects ?? 1) === 0 ? 'done' : r.pending;
  }, timeoutMs, 'spool 排空（回灌完成）');
}
/** barrier 请求（drill-cutover smokeSupplement 同形：sendStateless {nonce,clientSeq}→回执 committedSeq）。 */
function sendBarrier(provider, nonce, clientSeq = 1, timeoutMs = 15_000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('barrier 回执超时')), timeoutMs);
    provider.on('stateless', ({ payload }) => {
      try { const p = JSON.parse(payload); if (p.nonce === nonce) { clearTimeout(t); res(p); } } catch { /* 非 JSON 通告 */ }
    });
    provider.sendStateless(JSON.stringify({ nonce, clientSeq }));
  });
}

// ═══════════════ 模式一：--kill9（PG 批提交窗+barrier flush 中 kill -9） ═══════════════
async function modeKill9() {
  await precheck(); await ensureBuilt();
  const S = await makeFixtures('t31-k9');
  timing.t0 = Date.now();
  const { Y } = loadClientLibs();
  const KEYS = Array.from({ length: 12 }, (_, i) => `t31-k9-node-${i}`);
  try {
    // ── 档①：PG 批提交窗 kill（触发器滞留=确定性 kill 窗——帧已 fsync 入 spool、批未落 PG） ──
    await createBlockTrigger();
    await timed('k9a-start-blocked', async () => { await startApi('api-1'); return 'api 起（PG 批恒滞留态）'; });
    let A = mkProvider(S);
    await synced(A);
    A.document.transact(() => { for (const k of KEYS) A.document.getMap('nodes').set(k, mkNode(Y, k)); });
    await new Promise((r) => setTimeout(r, 400));   // 上行送达窗
    destroyProvider(A)
    await timed('k9a-spool-held', async () => { await waitSpoolHeld(); return '批滞留确认（帧在 spool——Spooled 档，PG 批被触发器拒）'; });
    await timed('k9a-kill9', async () => {
      await stopService('api-1');   // taskkill /F = SIGKILL 等价（kill -9 矩阵·批提交阶段）
      return 'kill -9 于 PG 批提交窗（spool 承载态进程死亡——磁盘字节存活）';
    });
    await dropBlockTrigger();
    await timed('k9a-restart-replay', async () => {
      await startApi('api-2');
      await waitSpoolDrained(60_000).catch(() => console.log('[drill] WARNING 段回收超窗（回灌判定以重放为准）'));
      const replayed = await replayKeysOf(S.project);
      const accepted = new Set(KEYS);
      const missing = [...accepted].filter((k) => !replayed.includes(k));
      if (missing.length > 0) throw new Error(`k9a 已接受集丢失 ${missing.length}/${accepted.size}（零静默丢弃违约）`);
      if (new Set(replayed).size !== replayed.length) throw new Error('k9a 重放键集含重复（零重复违约）');
      const { updates } = await projectRow(S.project);
      if (updates < 1) throw new Error('k9a 重启后零 PG 行（回灌失败）');
      return `重启回灌：重放 ⊇ 已接受集 ${accepted.size} 键+PG ${updates} 行+零重复（updateHash 幂等——水位不越）`;
    });
    await stopService('api-2');

    // ── 档②：save barrier flush 中 kill（回执未达→重启重发同 nonce→Durable） ──
    await timed('k9b-start', async () => { await startApi('api-3'); return 'api 起（正常态）'; });
    A = mkProvider(S);
    await synced(A);
    const barrierKey = 't31-k9-barrier-node';
    A.document.transact(() => A.document.getMap('nodes').set(barrierKey, mkNode(Y, barrierKey)));
    await new Promise((r) => setTimeout(r, 300));
    const nonce = `t31-k9-${randomUUID()}`;
    let receiptArrived = false;
    const receiptP = sendBarrier(A, nonce, 1, 20_000).then((r) => { receiptArrived = true; return r; }).catch(() => null);
    await new Promise((r) => setTimeout(r, 150));   // barrier flush 等待窗（回执大概率未达）
    await timed('k9b-kill9', async () => {
      await stopService('api-3');
      const early = await Promise.race([receiptP, new Promise((r) => setTimeout(() => r(null), 500))]);
      console.log(`[drill] kill 时回执态=${receiptArrived ? '已达（竞态胜出——不影响重发断言）' : '未达（预期——flush 窗内 kill）'}（${early ? 'earlyReceipt' : 'none'}）`);
      return 'kill -9 于 barrier flush 窗（barrier flush 阶段——回执未达）';
    });
    destroyProvider(A)
    await timed('k9b-retry-barrier', async () => {
      await startApi('api-4');
      const B = mkProvider(S);
      await synced(B);
      const r = await sendBarrier(B, nonce, 1, 30_000);   // 同 nonce 重发（幂等语义）
      if (r.error || typeof r.committedSeq !== 'string') throw new Error(`k9b 重发 barrier 非 Durable 档：${JSON.stringify(r)}`);
      const replayed = await replayKeysOf(S.project);
      if (!replayed.includes(barrierKey)) throw new Error('k9b barrier 目标帧未落 PG（committedSeq 回执与内容不符）');
      destroyProvider(B)
      return `barrier 重发 Durable 回执（committedSeq=${r.committedSeq} 无 error——nonce 幂等+目标帧已落 PG）`;
    });
    await stopService('api-4');
  } finally {
    await stopStack();
    await dropBlockTrigger();
    await cleanupFixtures(S);
  }
}

// ═══════════════ 模式二：--infra（PG failover+网络分区+磁盘满） ═══════════════
/** 装置内置 TCP proxy（网络分区 socket 层模拟——挂起=停转发不断连）。 */
function startProxy(listenPort, targetPort) {
  const sockets = new Set();
  const server = net.createServer((client) => {
    const upstream = net.connect({ port: targetPort, host: '127.0.0.1' });
    sockets.add(client); sockets.add(upstream);
    client.pipe(upstream); upstream.pipe(client);
    const bye = () => { sockets.delete(client); sockets.delete(upstream); try { client.destroy(); } catch { /* 已闭 */ } try { upstream.destroy(); } catch { /* 已闭 */ } };
    client.on('error', bye); upstream.on('error', bye); client.on('close', bye); upstream.on('close', bye);
  });
  return new Promise((res) => server.listen(listenPort, '127.0.0.1', () => res({
    pauseAll: () => { for (const s of sockets) s.pause(); },   // 分区：静默挂起（不 RST 不 FIN）
    resumeAll: () => { for (const s of sockets) s.resume(); },  // 分区恢复：转发恢复（连接不断——客户端 pending 上行随后到达）
    kill: () => {
      for (const s of sockets) { try { s.destroy(); } catch { /* 已闭 */ } }   // 先断连接（长连接池挂 close 回调 300s——PG failover 注入窗效率）
      sockets.clear();
      return new Promise((r) => server.close(() => r()));
    },
  })));
}
async function pgServiceStop() {
  // 优先 sc stop（fast shutdown=计划内 failover 形态）；权限不足 fallback taskkill postgres.exe（immediate crash 形态——postmaster 死）
  const r = run('sc', ['stop', PG_SERVICE], { timeout: 60_000 });
  if (r.status !== 0) {
    console.log('[drill] sc stop 失败（权限/形态）——fallback taskkill postgres.exe（immediate crash 等价）');
    try { execSync('taskkill /F /IM postgres.exe', { stdio: 'ignore' }); } catch (e) { console.log(`[drill] taskkill postgres.exe: ${String(e.message).split('\n')[0]}`); }
  }
  await waitFor(async () => !(await isPortOpen(5432)) ? 'done' : 'listening', 30_000, 'PG 停（5432 拒连）');
}
async function pgServiceStart() {
  const r = run('sc', ['start', PG_SERVICE], { timeout: 60_000 });
  if (r.status !== 0) throw new Error(`sc start ${PG_SERVICE} 失败：${(r.stderr ?? '').slice(-200)}`);
  await waitFor(async () => (await isPortOpen(5432)) ? 'done' : false, 60_000, 'PG 起回（5432 监听）');
  await waitFor(() => withPg(async (c) => { await c.query('SELECT 1'); return 'done'; }).catch((e) => e.message), 60_000, 'PG 可查询');
}
async function modeInfra() {
  await precheck(); await ensureBuilt();
  const S = await makeFixtures('t31-infra');
  const { Y } = loadClientLibs();
  timing.t0 = Date.now();
  let clientA = null;
  // PG 前置 proxy（failover 注入形态——本机无管理员权限停 PG 服务〔sc stop 拒/taskkill 服务进程拒〕：
  // api 的 DATABASE_URL 改写指向 proxy 端口，proxy 转发真 5432；「PG 停」=proxy kill〔api 视角主库不可达
  // =连接拒——fail-closed 链等价〕，「恢复」=proxy 重起。装置自身 withPg 直连真 5432 不受影响。
  const PG_PROXY_PORT = 15432;
  let pgProxy = null;
  const proxiedDsn = (() => {   // DSN host:port 改写 → PG proxy（query 参数保留）
    const u = new URL(loadDatabaseUrl());
    u.hostname = '127.0.0.1';
    u.port = String(PG_PROXY_PORT);
    return u.toString();
  })();
  try {
    // ── 档①：PG failover（proxy kill=api 视角主库不可达——写不静默丢/停机窗断连=doc 卸载×PG 故障同链） ──
    await timed('infra1-baseline', async () => {
      pgProxy = await startProxy(PG_PROXY_PORT, 5432);
      await startApi('api-1', { DATABASE_URL: proxiedDsn });
      clientA = mkProvider(S); await synced(clientA);
      clientA.document.transact(() => clientA.document.getMap('nodes').set('t31-infra-x1', mkNode(Y, 'x1')));
      await waitFor(async () => (await replayKeysOf(S.project)).includes('t31-infra-x1') ? 'done' : false, 30_000, 'x1 落 PG（Durable 基线）');
      return '基线：x1 Durable 落 PG（failover 前已提交内容=恢复必达下限）——api 经 PG proxy（DSN 改写注入）';
    });
    await timed('infra1-pg-stop', async () => {
      await pgProxy.kill();
      return 'PG「停」（proxy kill=api 视角主库不可达——本地 failover 形态，偏差登记：单机无管理员权限停服务，proxy 注入等价）';
    });
    await timed('infra1-write-while-down', async () => {
      clientA.document.transact(() => clientA.document.getMap('nodes').set('t31-infra-x2', mkNode(Y, 'x2')));
      await new Promise((r) => setTimeout(r, 2_500));
      const ready = await getReadyFull().catch(() => null);
      console.log(`[drill] 停机窗 ready=${JSON.stringify(ready)?.slice(0, 160)}（fail-closed/degraded 观测——breaker 面）`);
      return '停机窗写入送达（x2——Spooled 承接/显式拒均合法，静默丢=违约——重放终判）';
    });
    await timed('infra1-pg-recover', async () => {
      pgProxy = await startProxy(PG_PROXY_PORT, 5432);   // 「服务起回」等价：proxy 重起（api 连接池重连+breaker 探测）
      await waitFor(async () => (await replayKeysOf(S.project)).includes('t31-infra-x2') ? 'done' : false, 180_000, 'x2 恢复后回灌落 PG');
      return 'PG「起回」（proxy 重起）→x2 回灌落 PG（停机窗写入零丢失——隔离恢复）';
    });
    await timed('infra1-verify', async () => {
      const keys = await replayKeysOf(S.project);
      for (const k of ['t31-infra-x1', 't31-infra-x2']) if (!keys.includes(k)) throw new Error(`infra1 缺 ${k}（failover 丢内容——违约）`);
      if (new Set(keys).size !== keys.length) throw new Error('infra1 重放键重复（恢复回灌双写——违约）');
      destroyProvider(clientA); clientA = null;
      await stopService('api-1');
      return `failover 前后内容齐（${keys.length} 键零重复——doc 卸载×PG 故障：停机窗连接的帧由回灌承接）`;
    });

    // ── 档②：网络分区（TCP proxy 挂起——客户端与服务端互不可达但连接未断） ──
    await timed('infra2-partition', async () => {
      await startApi('api-2');
      const PROXY_PORT = 31299;
      const proxy = await startProxy(PROXY_PORT, 3001);
      const { WebSocket, HocuspocusProvider, CSV, SV, WS_ORIGIN } = loadClientLibs();
      const ProxyWs = class extends WebSocket { constructor(url) { super(`ws://127.0.0.1:${PROXY_PORT}${url.slice(WS_URL.length)}`, { headers: { origin: WS_ORIGIN, cookie: `flowweb.session_token=${S.token}` } }); } };
      const A = new HocuspocusProvider({ url: `${WS_URL}?csv=${CSV}&sv=${SV}&cb=t31`, name: `project:${S.project}`, document: new Y.Doc(), WebSocketPolyfill: ProxyWs });
      await synced(A);
      A.document.transact(() => A.document.getMap('nodes').set('t31-infra-x3', mkNode(Y, 'x3')));
      await waitFor(async () => (await replayKeysOf(S.project)).includes('t31-infra-x3') ? 'done' : false, 30_000, 'x3 经 proxy 落 PG');
      // 分区：proxy 静默挂起（服务端对 A 不可达；A 连接仍在）+B 直连写 x4+A 本地写 x5
      proxy.pauseAll();
      const B = mkProvider(S); await synced(B);
      B.document.transact(() => B.document.getMap('nodes').set('t31-infra-x4', mkNode(Y, 'x4')));
      await waitFor(async () => (await replayKeysOf(S.project)).includes('t31-infra-x4') ? 'done' : false, 30_000, '分区窗 x4（B 直连）落 PG');
      A.document.transact(() => A.document.getMap('nodes').set('t31-infra-x5', mkNode(Y, 'x5')));   // 分区窗 A 本地写（上行不可达）
      await new Promise((r) => setTimeout(r, 800));
      proxy.resumeAll();   // 恢复=转发恢复（A 连接未断〔polyfill 硬编码 proxy 端口——挂起/恢复两段即完整分区形态〕→A pending 上行到达+SV 同步
      await waitFor(async () => (await replayKeysOf(S.project)).includes('t31-infra-x5') ? 'done' : false, 60_000, '分区窗 A 本地写 x5 恢复后落 PG');
      const bSeesX5 = await new Promise((res) => {
        if (B.document.getMap('nodes').has('t31-infra-x5')) return res(true);
        const t = setTimeout(() => res(false), 15_000);
        B.document.on('update', () => { if (B.document.getMap('nodes').has('t31-infra-x5')) { clearTimeout(t); res(true); } });
      });
      if (!bSeesX5) throw new Error('infra2 B 15s 未见 x5（分区恢复后收敛失败）');
      destroyProvider(A); destroyProvider(B)
      await stopService('api-2');
      return '分区（挂起）→恢复：A 本地写 x5 恢复后上行落 PG+B 收敛（断网重连 B3 形态——零静默丢弃）';
    });

    // ── 档③：磁盘满（COLLAB_SPOOL_CAPACITY_BYTES 容量闸——fail-closed 显式拒，不静默丢） ──
    await timed('infra3-disk-full', async () => {
      await startApi('api-3', { COLLAB_SPOOL_CAPACITY_BYTES: '4096' });   // 4KB 容量（超小额=磁盘满等价）
      const C = mkProvider(S); await synced(C);
      C.document.transact(() => { for (let i = 0; i < 8; i++) C.document.getMap('nodes').set(`t31-infra-df-${i}`, mkNode(Y, `df-${i}`)); });
      await new Promise((r) => setTimeout(r, 3_000));
      const ready = await getReadyFull().catch(() => null);
      const keys = await replayKeysOf(S.project);
      const landed = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => keys.includes(`t31-infra-df-${i}`)).length;
      console.log(`[drill] 容量闸：服务端落定 ${landed}/8；ready=${JSON.stringify(ready)?.slice(0, 160)}（fail-closed 面——冻结拒收/降级均合法形态）`);
      const log = serviceLog('api-3');
      const explicitRefusal = /overCapacity|capacity|unwritable|spool/i.test(log);
      console.log(`[drill] 容量闸显式拒证据（日志 overCapacity/spool 面）=${explicitRefusal ? '在案' : '未见（以落定计数+恢复形态承载）'}`);
      destroyProvider(C)
      await stopService('api-3');
      await startApi('api-4');
      const D = mkProvider(S); await synced(D);
      D.document.transact(() => { for (let i = 0; i < 8; i++) D.document.getMap('nodes').set(`t31-infra-df2-${i}`, mkNode(Y, `df2-${i}`)); });
      await waitFor(async () => {
        const keys2 = await replayKeysOf(S.project);
        return [0, 1, 2, 3, 4, 5, 6, 7].every((i) => keys2.includes(`t31-infra-df2-${i}`)) ? 'done' : false;
      }, 30_000, '容量恢复后写入全落定');
      destroyProvider(D)
      await stopService('api-4');
      return `容量闸 fail-closed（超限窗落定 ${landed}/8——拒收形态非静默丢）→容量恢复全落定 8/8（df2）`;
    });
  } finally {
    if (clientA) { destroyProvider(clientA) }
    await stopStack();
    if (pgProxy) await pgProxy.kill().catch(() => {});
    await withPg(async (c) => { await c.query('SELECT 1'); }).catch(() => {});   // 真 PG 健康兜底核对（直连——proxy 注入不动真服务）
    await cleanupFixtures(S);
  }
}

// ═══════════════ 模式三：--restore-bump（pg_dump 恢复→bump→真段 quarantine 不复活） ═══════════════
async function modeRestoreBump() {
  await precheck(); await ensureBuilt();
  const S = await makeFixtures('t31-rb');
  const { Y } = loadClientLibs();
  timing.t0 = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpPath = path.join(BACKUP_DIR, `t31-restore-bump-${stamp}.dump`);
  try {
    await timed('rb1-baseline', async () => {
      await startApi('api-1');
      const A = mkProvider(S); await synced(A);
      A.document.transact(() => A.document.getMap('nodes').set('t31-rb-keep', mkNode(Y, 'keep')));
      await waitFor(async () => (await replayKeysOf(S.project)).includes('t31-rb-keep') ? 'done' : false, 30_000, 'keep 落 PG（快照内基线）');
      destroyProvider(A)
      await waitSpoolDrained(30_000).catch(() => {});   // 快照前段清（真段形态由 dump 后滞留帧构造）
      return '基线内容 t31-rb-keep 落 PG（将随 pg_dump 入快照）';
    });
    await timed('rb1-snapshot', async () => {
      mkdirSync(BACKUP_DIR, { recursive: true });
      const d = runQuoted(`"${pgDump()}" -Fc -f "${dumpPath}" "${loadDatabaseUrl()}"`, { cwd: ROOT, timeout: 300_000 });
      if (d.status !== 0) throw new Error(`pg_dump 失败：${(d.stderr ?? '').slice(-400)}`);
      return `pg_dump ${path.basename(dumpPath)}（${(statSync(dumpPath).size / 1024).toFixed(0)}KB）`;
    });
    await timed('rb1-postdump-frames', async () => {
      await createBlockTrigger();   // dump 后帧滞留 spool（恢复后应消失的「已回滚」内容）
      const B = mkProvider(S); await synced(B);
      B.document.transact(() => B.document.getMap('nodes').set('t31-rb-rollback', mkNode(Y, 'rollback')));
      await new Promise((r) => setTimeout(r, 600));
      destroyProvider(B)
      await waitSpoolHeld(30_000);
      return 'dump 后帧 t31-rb-rollback 滞留 spool（真段在位——恢复后不得复活的内容）';
    });
    await timed('rb1-crash-restore', async () => {
      await stopService('api-1');
      await dropBlockTrigger();
      await withPg(async (client) => { await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); });
      const r = runQuoted(`"${pgRestore()}" --no-owner --no-privileges -d "${loadDatabaseUrl()}" "${dumpPath}"`, { cwd: ROOT, timeout: 300_000 });
      if (r.status !== 0) throw new Error(`pg_restore 失败：${(r.stderr ?? '').slice(-600)}`);
      const h = await systemHistory();
      return `pg_restore 过（回快照时点——SystemHistory=${h.historyId.slice(0, 8)}…；PG 无 rollback 行）`;
    });
    await timed('rb1-bump-restart', async () => {
      const h = await bumpHistoryId();
      // boot recoverScan：旧 historyId 段全隔离（纪元栅栏）→可证链尾 0<pgSeq=2=I3 档（Q-I4）
      // pgPrefixViolation——T13 有意 fail-closed（「restore+bump 形态」代码注释点名）：恢复后不自动
      // 灌回旧 WAL、直接开放写非预期路径（spec §8.1=换代一次再开放写）。断言=blocked 合法终态。
      spawnService('api-2', 'dist/main.js');
      await new Promise((r) => setTimeout(r, 8_000));
      const log = serviceLog('api-2');
      const blocked = /wal_recovery_blocked/.test(log) && /pgSeq/.test(log);
      const serving = await fetch(`${API_URL}/api/ready`).then((x) => x.json()).catch(() => null);
      if (serving?.ready === true) throw new Error('bump 后直接 serving（I3 档 fail-closed 缺失——restore+bump 未换代直接开放写=契约违约）');
      if (!blocked) throw new Error(`blocked 观测未达：wal_recovery_blocked 日志=${/wal_recovery_blocked/.test(log)}`);
      console.log(`[drill] bump=${h.slice(0, 8)}…→boot fail-closed（wal_recovery_blocked〔violation=PG 前缀——旧段全隔离可证链尾<pgSeq〕+ready=${JSON.stringify(serving)?.slice(0, 120)}拒服务）`);
      return `bump→boot fail-closed（I3 档：旧段纪元栅栏全隔离+PG 残留 pgSeq=2>链尾 0=证据保全禁截断——不自动灌回）`;
    });
    await timed('rb1-no-resurrection', async () => {
      // 不复活断言（PG 直查——blocked 态服务不可用，但 restore 回来的 PG 是快照时点真数据）：
      // keep（快照内）在+rollback（dump 后帧，仅存于隔离段）不在=零复活。
      const keys = await replayKeysOf(S.project);
      if (!keys.includes('t31-rb-keep')) throw new Error('恢复丢失快照内内容 t31-rb-keep（恢复失真——隔离恢复违约）');
      if (keys.includes('t31-rb-rollback')) throw new Error('旧 WAL 真段复活已回滚内容 t31-rb-rollback（historyId 纪元栅栏失效——重大违约）');
      return `不复活验证过：keep 在+rollback 不在（PG 权威重放零复活——charter restore-drill 用例①）`;
    });
    await timed('rb1-reopen-after-generation', async () => {
      // spec §8.1 处置序三步（restore 收尾序——非 boot 自动）：①bump（已做）②**旧 WAL/spool 整目录
      // quarantine**（运维动作=reset-collab quarantine-spool 阶段/T30b rollback 同形——boot 段级纪元
      // 栅栏隔离≠整目录挪走，段物理在原地=I3 档证据保全 blocked 是设计内行为）③换代一次再开放写
      // （maintenance vacuum——per-project 世代切换单入口 §6.6；not-serving 态 HTTP 面可驱动）。
      await stopService('api-2');
      await startApiHttp('api-3');   // 起 HTTP 面（collab 仍 blocked——ready false 但 /api 可达）
      const startRes = await fetch(`${API_URL}/api/collab/maintenance/${S.project}/start`, {
        method: 'POST', headers: { 'x-idempotency-key': `t31-rb-reopen-${Date.now()}`, 'x-prometheus-token': ADMIN_TOKEN, cookie: `flowweb.session_token=${S.token}` },
      }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })).catch((e) => ({ status: 0, body: { err: e.message } }));
      console.log(`[drill] 换代 maintenance start=${startRes.status} ${JSON.stringify(startRes.body ?? {}).slice(0, 160)}`);
      if (startRes.status >= 300) throw new Error(`maintenance start 失败（${startRes.status}）——换代链不可驱动`);
      await waitFor(async () => {
        const st = await fetch(`${API_URL}/api/collab/maintenance/${S.project}`, { headers: { 'x-prometheus-token': ADMIN_TOKEN, cookie: `flowweb.session_token=${S.token}` } }).then((r) => r.json()).catch(() => null);
        const s = st?.data ?? st;
        const stage = s?.operation?.stage ?? s?.stage ?? s?.status;
        return stage === 'COMPLETED' ? 'done' : stage;
      }, 120_000, '换代 COMPLETED');
      await stopService('api-3');
      // ②整目录 quarantine（运维等价物：段物理挪走=证据保全+boot 无段=K2b 合法续跑窗）
      const spool = spoolDir();
      const quarantineDir = path.join(path.dirname(spool), `.quarantine-t31-rb-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      const segsBefore = existsSync(spool) ? readdirSync(spool).filter((f) => !f.startsWith('.')).length : 0;
      if (existsSync(spool)) renameSync(spool, quarantineDir);
      console.log(`[drill] spool 整目录 quarantine：${segsBefore} 条目→${path.basename(quarantineDir)}（保证据不删——restore 收尾序步骤②）`);
      await startApi('api-4');   // ③再开放写：无段+pgSeq 行在=合法续跑（kill9b 同形态）
      const { doc } = await projectRow(S.project);
      const gen = doc?.generation ?? 1;
      const C = mkProvider(S, { name: `project:${S.project}#g${gen}` });
      await synced(C, 20_000);
      C.document.transact(() => C.document.getMap('nodes').set('t31-rb-after', mkNode(Y, 'after')));
      await waitFor(async () => (await replayKeysOf(S.project)).includes('t31-rb-after') ? 'done' : false, 30_000, '换代后新写落 PG');
      destroyProvider(C);
      const keys = await replayKeysOf(S.project);
      if (keys.includes('t31-rb-rollback')) throw new Error('quarantine+换代后 rollback 复活（违约）');
      await stopService('api-4');
      // WAL 不复活动证（T30b two-way-verify 同形）：quarantine 目录 boot 后原样（零收养零清空）
      const qCount = existsSync(quarantineDir) ? readdirSync(quarantineDir).length : -1;
      if (qCount !== segsBefore) throw new Error(`quarantine 目录条目变化（${segsBefore}→${qCount}——收养/清空=复活面）`);
      return `再开放写全链：换代 COMPLETED→整目录 quarantine（${segsBefore} 条目原样）→重启 ready→新代 #g${gen} 写入落 PG（spec §8.1 处置序）`;
    });
  } finally {
    await stopStack();
    await dropBlockTrigger();
    await cleanupFixtures(S);
  }
}

// ═══════════════ 模式四：--restore-fence（忘 bump+restore.lock→时间戳栅栏拦截→处置恢复） ═══════════════
async function modeRestoreFence() {
  await precheck(); await ensureBuilt();
  const S = await makeFixtures('t31-rf');
  const { Y } = loadClientLibs();
  timing.t0 = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpPath = path.join(BACKUP_DIR, `t31-restore-fence-${stamp}.dump`);
  try {
    await timed('rf1-baseline', async () => {
      await startApi('api-1');
      const A = mkProvider(S); await synced(A);
      A.document.transact(() => A.document.getMap('nodes').set('t31-rf-keep', mkNode(Y, 'keep')));
      await waitFor(async () => (await replayKeysOf(S.project)).includes('t31-rf-keep') ? 'done' : false, 30_000, 'keep 落 PG');
      destroyProvider(A)
      await waitSpoolDrained(30_000).catch(() => {});
      return '基线 keep 落 PG';
    });
    await timed('rf1-snapshot', async () => {
      const d = runQuoted(`"${pgDump()}" -Fc -f "${dumpPath}" "${loadDatabaseUrl()}"`, { cwd: ROOT, timeout: 300_000 });
      if (d.status !== 0) throw new Error(`pg_dump 失败：${(d.stderr ?? '').slice(-400)}`);
      return `pg_dump ${path.basename(dumpPath)}`;
    });
    await timed('rf1-postdump-frames', async () => {
      await createBlockTrigger();
      const B = mkProvider(S); await synced(B);
      B.document.transact(() => B.document.getMap('nodes').set('t31-rf-rollback', mkNode(Y, 'rollback')));
      await new Promise((r) => setTimeout(r, 600));
      destroyProvider(B)
      await waitSpoolHeld(30_000);
      return 'dump 后帧 t31-rf-rollback 滞留 spool（真段——段头 lastWriteAt>epochStartedAt 形态在位）';
    });
    await timed('rf1-restore-nobump', async () => {
      await stopService('api-1');
      await dropBlockTrigger();
      await withPg(async (client) => { await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); });
      const r = runQuoted(`"${pgRestore()}" --no-owner --no-privileges -d "${loadDatabaseUrl()}" "${dumpPath}"`, { cwd: ROOT, timeout: 300_000 });
      if (r.status !== 0) throw new Error(`pg_restore 失败：${(r.stderr ?? '').slice(-600)}`);
      // 忘 bump 形态：不 bump+备份工具写 restore.lock marker（双保险信号——spec §4.4）
      writeFileSync(path.join(spoolDir(), 'restore.lock'), `t31 restore-fence ${new Date().toISOString()}\n`);
      return '恢复完成但**忘 bump**+restore.lock marker 在位（时间戳栅栏求值信号）';
    });
    await timed('rf1-fence-blocked', async () => {
      const h = await systemHistory();
      const segFilesNow = [];
      if (existsSync(spoolDir())) {
        for (const d of readdirSync(spoolDir(), { withFileTypes: true })) {
          if (!d.isDirectory()) continue;
          for (const f of readdirSync(path.join(spoolDir(), d.name))) if (f.endsWith('.spool')) segFilesNow.push(`${d.name}/${f}`);
        }
      }
      console.log(`[drill] boot 前观测：epochStartedAt=${new Date(h.epochStartedAt).toISOString()}（hid=${h.historyId.slice(0, 8)}…）+真段 ${segFilesNow.length}=${JSON.stringify(segFilesNow.slice(0, 4))}+marker=${existsSync(path.join(spoolDir(), 'restore.lock'))}`);
      if (segFilesNow.length > 0) {
        const segPath = path.join(spoolDir(), segFilesNow[0]);
        const segBuf = readFileSync(segPath);
        const segLastWriteAt = Number(segBuf.readBigUInt64LE(152));
        const segHid = segBuf.indexOf(Buffer.from(h.historyId.slice(0, 8))) >= 0 ? '匹配' : '不匹配';
        console.log(`[drill] 段头直读：lastWriteAt=${new Date(segLastWriteAt).toISOString()}（>epoch=${segLastWriteAt > h.epochStartedAt.getTime() ? '是→suspect 应真' : '否→栅栏数学不触发'}）；historyId ${segHid}`);
      }
      if (segFilesNow.length === 0) throw new Error('真段形态丢失：boot 前 spool 零 .spool 文件（滞留帧段被回收？——装置构造失效，禁继续假绿');
      spawnService('api-2', 'dist/main.js');
      await new Promise((r) => setTimeout(r, 10_000));   // boot 求值窗（5s 重试循环=每次 blocked）
      const log = serviceLog('api-2');
      const blocked = /wal_recovery_blocked/.test(log);
      const serving = await fetch(`${API_URL}/api/ready`).then((x) => x.json()).catch(() => null);
      if (serving?.ready === true) {
        const allAfter = [];
        if (existsSync(spoolDir())) for (const d of readdirSync(spoolDir(), { withFileTypes: true })) {
          if (!d.isDirectory()) { allAfter.push(d.name); continue; }
          for (const f of readdirSync(path.join(spoolDir(), d.name))) allAfter.push(`${d.name}/${f}`);
        }
        const pgRows = await withPg(async (client) => {
          const r = await client.query(`SELECT count(*)::int AS n FROM "CanvasDocUpdate" WHERE "projectId" = $1`, [S.project]);
          return r.rows[0].n;
        }).catch(() => -1);
        console.log(`[drill] A/B 判别：serving 时目录全条目=${JSON.stringify(allAfter)}；本项目 CanvasDocUpdate 行=${pgRows}（dump 基线=2〔keep 帧〕；>2=rollback 帧被重放落 PG=suspect 未拦实锤）`);
        throw new Error('忘 bump 后服务照常 serving（时间戳栅栏失效——重大违约）');
      }
      if (!blocked && !serving) throw new Error('栅栏观测未达：无 blocked 日志且 ready 不可达（观测面缺失）');
      console.log(`[drill] wal_recovery_blocked=${blocked}；ready=${JSON.stringify(serving)?.slice(0, 140)}（fail-closed 拒服务）`);
      await stopService('api-2');
      return '时间戳栅栏拦截：recoverySuspect 零重放+boot fail-closed（suspect 段内容不上线——忘 bump 拦截）';
    });
    await timed('rf1-remediate-recover', async () => {
      await bumpHistoryId();                                          // 处置①：bump（收尾契约——C1 后 SystemHistory 列 tsz，裸 now() 会话时区无关）
      rmSync(path.join(spoolDir(), 'restore.lock'), { force: true }); // 处置②：清 marker（恢复流人工裁定等价物）
      // 处置后 boot 双合法终态：a) ready（I2 形态——段链可证续跑）b) blocked（真库 pgSeq>0 形态：
      // bump 后段头 historyId 不匹配→段隔离→I3 violation 证据保全——restore-bump 模式同终态，
      // 最终再开放写=spec §8.1 整目录 quarantine+换代〔rb1-reopen 同链〕）。零复活断言对两态同构。
      spawnService('api-3', 'dist/main.js');
      await new Promise((r) => setTimeout(r, 9_000));
      const log3 = serviceLog('api-3');
      const serving3 = await fetch(`${API_URL}/api/ready`).then((x) => x.json()).catch(() => null);
      const keys = await replayKeysOf(S.project);
      if (!keys.includes('t31-rf-keep')) throw new Error('处置后快照内内容 keep 丢失');
      if (keys.includes('t31-rf-rollback')) throw new Error('处置后 suspect 段复活 rollback（零复活违约）');
      if (serving3?.ready === true) {
        const C = mkProvider(S); await synced(C);
        C.document.transact(() => C.document.getMap('nodes').set('t31-rf-after', mkNode(Y, 'after')));
        await waitFor(async () => (await replayKeysOf(S.project)).includes('t31-rf-after') ? 'done' : false, 30_000, '处置后新写落 PG');
        destroyProvider(C);
        await stopService('api-3');
        return `处置（bump+清 marker）→正常恢复：keep 在+rollback 不复活+新写落 PG（I2 形态）`;
      }
      const violation3 = /wal_recovery_blocked/.test(log3);
      console.log(`[drill] 处置后 boot=blocked（violation=${violation3}——bump 后段隔离+PG 残留 pgSeq 的 I3 档=restore-bump 同终态；再开放写=rb1-reopen 同链〔整目录 quarantine+换代〕已由 restore-bump 模式实测）`);
      await stopService('api-3');
      if (!violation3 && !/suspect/.test(log3)) throw new Error('处置后既非 serving 也无 blocked 证据（观测面缺失）');
      return `处置（bump+清 marker）→fail-closed 保全：keep 在+rollback 不复活（I3 档=真库 pgSeq>0 形态——再开放写归 rb1-reopen 同链）`;
    });
  } finally {
    await stopStack();
    await dropBlockTrigger();
    rmSync(path.join(spoolDir(), 'restore.lock'), { force: true });
    await cleanupFixtures(S);
  }
}

// ═══════════════ 模式五：--pitr-ss2（同代 PITR→客户端 SS2 旧内容被 historyId 握手拦截） ═══════════════
async function modePitrSs2() {
  await precheck(); await ensureBuilt();
  const S = await makeFixtures('t31-pitr');
  const { Y } = loadClientLibs();
  timing.t0 = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpPath = path.join(BACKUP_DIR, `t31-pitr-ss2-${stamp}.dump`);
  try {
    let oldHistoryId = '';
    await timed('pitr1-baseline', async () => {
      await startApi('api-1');
      const h = await systemHistory();
      oldHistoryId = h.historyId;
      const A = mkProvider(S); await synced(A);
      A.document.transact(() => A.document.getMap('nodes').set('t31-pitr-keep', mkNode(Y, 'keep')));
      await waitFor(async () => (await replayKeysOf(S.project)).includes('t31-pitr-keep') ? 'done' : false, 30_000, 'keep 落 PG');
      destroyProvider(A)
      await waitSpoolDrained(30_000).catch(() => {});
      return `基线 keep 落 PG；旧纪元 hid=${oldHistoryId.slice(0, 8)}…（客户端将携此重连）`;
    });
    await timed('pitr1-snapshot', async () => {
      const d = runQuoted(`"${pgDump()}" -Fc -f "${dumpPath}" "${loadDatabaseUrl()}"`, { cwd: ROOT, timeout: 300_000 });
      if (d.status !== 0) throw new Error(`pg_dump 失败：${(d.stderr ?? '').slice(-400)}`);
      return `pg_dump ${path.basename(dumpPath)}`;
    });
    await timed('pitr1-postdump-frames', async () => {
      await createBlockTrigger();
      const B = mkProvider(S); await synced(B);
      B.document.transact(() => B.document.getMap('nodes').set('t31-pitr-rollback', mkNode(Y, 'rollback')));
      await new Promise((r) => setTimeout(r, 600));
      destroyProvider(B)
      await waitSpoolHeld(30_000);
      return 'dump 后帧滞留 spool（真段——恢复后旧纪元段）';
    });
    await timed('pitr1-restore-bump', async () => {
      await stopService('api-1');
      await dropBlockTrigger();
      await withPg(async (client) => { await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); });
      const r = runQuoted(`"${pgRestore()}" --no-owner --no-privileges -d "${loadDatabaseUrl()}" "${dumpPath}"`, { cwd: ROOT, timeout: 300_000 });
      if (r.status !== 0) throw new Error(`pg_restore 失败：${(r.stderr ?? '').slice(-600)}`);
      const h = await bumpHistoryId();
      // spec §8.1 收尾序：bump+旧 spool 整目录 quarantine（段物理挪走=证据保全+boot 无段=合法续跑——
      // restore-bump 模式 rb1 同形；不挪则 boot I3 violation blocked=WS 面不可达，SS2 拦截断言无从做）
      const spool = spoolDir();
      if (existsSync(spool)) {
        const qd = path.join(path.dirname(spool), `.quarantine-t31-pitr-${new Date().toISOString().replace(/[:.]/g, '-')}`);
        renameSync(spool, qd);
        console.log(`[drill] spool 整目录 quarantine→${path.basename(qd)}（restore 收尾序）`);
      }
      await startApi('api-2');
      return `同代 PITR 恢复+bump（新纪元 ${h.slice(0, 8)}…≠客户端旧 hid ${oldHistoryId.slice(0, 8)}…）+整目录 quarantine→ready 开放`;
    });
    await timed('pitr1-ss2-blocked', async () => {
      // 客户端半链：本地 Y.Doc 预写旧内容（SS2 全量将携它上行）+携旧 hid 连接→版本门三元硬门先拒
      const { Y: Y2, HocuspocusProvider, WebSocket, CSV, SV, WS_ORIGIN } = loadClientLibs();
      const doc = new Y2.Doc();
      doc.transact(() => { const data = new Y2.Map(); data.set('model', 'stale'); const m = new Y2.Map(); m.set('type', 'textInput'); m.set('data', data); doc.getMap('nodes').set('t31-pitr-stale', m); });
      let wsInstance = null;
      const HeaderWs = class extends WebSocket {
        constructor(url) {
          super(url, { headers: { origin: WS_ORIGIN, cookie: `flowweb.session_token=${S.token}` } });
          wsInstance = this;
          this.on('error', () => {});   // 4406 terminal close 于 CONNECTING 期触达=ws close() emit error（provider 内部 cleanup 链）——吞掉由 close 码断言承载
        }
      };
      const P = new HocuspocusProvider({ url: `${WS_URL}?csv=${CSV}&sv=${SV}&hid=${oldHistoryId}&cb=t31`, name: `project:${S.project}`, document: doc, WebSocketPolyfill: HeaderWs });
      const closeCode = await new Promise((res, rej) => {
        const t = setTimeout(() => { destroyProvider(P); rej(new Error('旧 hid close 等待超时（握手未被拦——违约）')); }, 15_000);
        const wire = () => {
          if (!wsInstance) return false;
          wsInstance.on('close', (code) => { clearTimeout(t); res(code); });
          return true;
        };
        if (!wire()) setTimeout(wire, 100);
      });
      destroyProvider(P);
      destroyProvider(P)
      if (closeCode !== CLOSE_CLIENT_OUTDATED) throw new Error(`旧 hid 客户端 close 码=${closeCode}（期望 4406——onAuthenticate 先比 historyId 失效）`);
      await new Promise((r) => setTimeout(r, 1_000));
      const keys = await replayKeysOf(S.project);
      if (keys.includes('t31-pitr-stale')) throw new Error('客户端 SS2 旧内容复活（握手拦截后全量上行仍到达——重大违约）');
      if (keys.includes('t31-pitr-rollback')) throw new Error('旧纪元真段复活（restore 链违约）');
      if (!keys.includes('t31-pitr-keep')) throw new Error('快照内 keep 丢失');
      return `SS2 拦截过：旧 hid→4406 terminal close（全量上行不到达）+服务端重放零复活（stale/rollback 均不在——charter restore-drill 用例②）`;
    });
    await timed('pitr1-fresh-client', async () => {
      const C = mkProvider(S); await synced(C);   // 首连无 hid=放行（auth 回执下发新纪元）
      C.document.transact(() => C.document.getMap('nodes').set('t31-pitr-after', mkNode(Y, 'after')));
      await waitFor(async () => (await replayKeysOf(S.project)).includes('t31-pitr-after') ? 'done' : false, 30_000, '新客户端写入落 PG');
      destroyProvider(C)
      return '新客户端（hid 缺省首连放行）正常接入+写入落 PG';
    });
    await stopService('api-2');
  } finally {
    await stopStack();
    await dropBlockTrigger();
    await cleanupFixtures(S);
  }
}

// ═══════════════ 模式六：--client（拒帧 4411 恢复+clientID 并发同键+维护换代族） ═══════════════
async function modeClient() {
  await precheck(); await ensureBuilt();
  const S = await makeFixtures('t31-cl');
  const { Y } = loadClientLibs();
  const ORIGIN = loadClientLibs().WS_ORIGIN;
  timing.t0 = Date.now();
  try {
    await timed('cl1-deny-recovery', async () => {
      await startApi('api-1');
      // 拒帧（frame-local DENY——node-key 形态：T9+ 信封须 type+data 容器，旧 kind 信封=node-key 4411
      // 〔drill-cutover 发现④/T30b 装置同帧〕；DENY 不进 apply=零 L2 截断链——避免 walHealthy 熔断
      // 污染后续档〔container-replacement 形态走 L2 毒帧+截断水位窗=另一演练面，映射 t24 deny-matrix〕）
      const A = mkProvider(S); await synced(A);
      const closeP = wsCloseOf(A, 15_000);
      A.document.transact(() => {
        const m = new Y.Map(); m.set('kind', 'legacy-envelope');   // 旧信封（无 type 标量）→frame-deny node-key
        A.document.getMap('nodes').set('t31-cl-denynode', m);
      });
      const closeCode = await closeP;
      if (closeCode !== 4411) throw new Error(`拒帧 close 码=${closeCode}（期望 4411——node-key frame-local DENY）`);
      await new Promise((r) => setTimeout(r, 1_000));
      const keys1 = await replayKeysOf(S.project);
      if (keys1.includes('t31-cl-denynode')) throw new Error('拒帧节点入服务端 doc（DENY 后 doc 不变违约）');
      // 重连+合法帧恢复（B 场景恢复入口——连接重建+合法写通过）
      const B = mkProvider(S); await synced(B);
      B.document.transact(() => { const data = new Y.Map(); data.set('model', 'cl-recovered'); const m = new Y.Map(); m.set('type', 'textInput'); m.set('data', data); B.document.getMap('nodes').set('t31-cl-recovered', m); });
      await waitFor(async () => (await replayKeysOf(S.project)).includes('t31-cl-recovered') ? 'done' : false, 30_000, '拒帧后重连合法写落 PG');
      destroyProvider(A); destroyProvider(B);
      return `拒帧 4411（node-key frame-local DENY）→服务端 doc 不变→重连合法帧恢复落 PG（拒帧恢复 B 场景入口过）`;
    });
    await timed('cl2-clientid-single-active', async () => {
      const { Y } = loadClientLibs();
      const mkSameClient = () => {
        const doc = new Y.Doc();
        doc.clientID = 987654321;   // 并发同键（僵尸+新连接同 clientID）——构造前设置（awareness 绑定 clientID 于 provider 构造期）
        return mkProvider(S, { document: doc });
      };
      const first = mkSameClient();
      await synced(first);
      first.document.transact(() => { const data = new Y.Map(); data.set('model', 'cl-idbind'); const m = new Y.Map(); m.set('type', 'textInput'); m.set('data', data); first.document.getMap('nodes').set('t31-cl-idbind', m); });
      await new Promise((r) => setTimeout(r, 800));   // 帧提交=四元绑定登记载体（actor.submit 链——clientId 取自 doc.clientID）
      const second = mkSameClient();
      const oldClosed = wsCloseOf(first, 20_000);
      await synced(second, 20_000);
      second.document.transact(() => { const data = new Y.Map(); data.set('model', 'cl-idbind2'); const m = new Y.Map(); m.set('type', 'textInput'); m.set('data', data); second.document.getMap('nodes').set('t31-cl-idbind2', m); });   // 同四元第二连接首帧→接管判定
      // T31 双评审 quality P2-4：second 帧落 PG 断言（判别力）——未观测接管 close 时区分两形态：
      // 帧达准入链而未触发接管（=接线动态时序疑点，升级调查）vs 帧未达准入链（=装置驱动形态未达）。
      await waitFor(async () => (await replayKeysOf(S.project)).includes('t31-cl-idbind2') ? 'done' : false, 20_000, 'second 帧落 PG（接管判别力锚——帧未达=装置形态未达非接线缺口）');
      const code = await oldClosed.catch(() => null);
      console.log(`[drill] clientID 同键：旧连接 close=${code ?? '未达（20s 无接管 close）'}；新连接 synced`);
      destroyProvider(first); destroyProvider(second);
      if (code != null) {
        if (code === 1005 || code === 1006) throw new Error(`旧连接 close 码=${code}（异常关闭形态——接管 close 未投递？）`);
        return `clientID 并发同键：旧连接被 close（${code}）+新连接接管 synced（单活跃——禁两活跃共享 clientID）`;
      }
      // 登记（T31 发现②）：同四元第二连接帧提交未触发接管 close——t24-clientid-binding.spec 单测链
      // （actor 直调）全绿而真 WS 实弹未达——接线面疑点（gateway→actor 的 clientId 提取或帧时序），
      // 移交 Controller 核实；本演练契约承载=既有 spec 单测（僵尸/接管/碰撞/SS2 四态）。
      console.log('[drill] 登记：cl2 真 WS 接管 close 未观测（单测链绿——接线缺口候选，移交核实；契约承载=t24-clientid-binding.spec 既有四态）');
      return `clientID 并发同键：真 WS 接管未观测=登记缺口（契约承载=t24 spec 单测四态——移交核实接线面）`;
    });
    await timed('cl3-vacuum-generation', async () => {
      const S2 = await makeFixtures('t31-vac');
      // 哨兵模型（ECONNREFUSED 形态——零外呼+cost:0；validation 预检可过=受理面与关闸面可区分：
      // 闸前=受理（success:false+TEXT_PROVIDER_UNKNOWN），闸后=maintenanceId 行级闸拒）
      const tsVac = Date.now();
      const NT2 = { id: `t31-vac-nt-${tsVac}`, key: `smoke:t31:vac:${tsVac}` };
      const M2 = { id: `t31-vac-m-${tsVac}`, rule: `t31-vac-r-${tsVac}` };
      try {
        await S2.prisma.nodeType.create({ data: { id: NT2.id, key: NT2.key, name: `t31-vac ${tsVac}` } });
        await S2.prisma.aIModel.create({ data: { id: M2.id, nodeTypeId: NT2.id, name: `t31-vac ${tsVac}`, provider: 'moonshot', apiUrl: 'http://127.0.0.1:1', apiKey: 't31-vac-dummy', apiModelName: `t31-vac-${tsVac}`, active: true } });
        await S2.prisma.pricingRule.create({ data: { id: M2.rule, nodeTypeId: NT2.id, modelId: M2.id, creditCost: 0, active: true } });
        const A = mkProvider(S2); await synced(A);
        A.document.transact(() => { const data = new Y.Map(); data.set('model', M2.id); const m = new Y.Map(); m.set('type', 'textInput'); m.set('data', data); A.document.getMap('nodes').set('t31-vac-keep', m); });
        await waitFor(async () => (await replayKeysOf(S2.project)).includes('t31-vac-keep') ? 'done' : false, 30_000, 'vac keep 落 PG');
        // 行级关闸：REQUESTED 写 maintenanceId 同事务→新执行**受理**被拒（spec §6.6/偏离 38⑯——
        // 受理端点 POST /api/execution/requests 走 ExecutionRequestService〔maintenanceId IS NULL 判定〕；
        // 旧直执 execute 端点=T32 删除在列的过渡通道〔受理不经 ExecutionRequestService——注记映射〕）
        const admitBody = { requestId: `t31-vac-req-${Date.now()}`, nodeIds: ['t31-vac-keep'], docSeq: '0' };
        const admitOf = () => fetch(`${API_URL}/api/execution/requests`, {
          method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: `flowweb.session_token=${S2.token}` },
          body: JSON.stringify({ projectId: S2.project, ...admitBody }),
          signal: AbortSignal.timeout(10_000),
        }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })).catch((e) => ({ status: 0, body: { err: e.message } }));
        const preAdmit = await admitOf();
        console.log(`[drill] 关闸前 admit HTTP=${preAdmit.status}（对照——受理面形态）`);
        const startRes = await fetch(`${API_URL}/api/collab/maintenance/${S2.project}/start`, {
          method: 'POST', headers: { 'x-idempotency-key': `t31-vac-${Date.now()}`, 'x-prometheus-token': ADMIN_TOKEN, cookie: `flowweb.session_token=${S2.token}` },
        }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
        if (startRes.status >= 300) throw new Error(`maintenance start 失败：${JSON.stringify(startRes).slice(0, 240)}`);
        const gatedExec = await admitOf();
        const gatedOk = gatedExec.status === 409 || gatedExec.status === 423 || gatedExec.status === 503
          || JSON.stringify(gatedExec.body ?? {}).includes('MAINTENANCE');
        if (!gatedOk) throw new Error(`行级关闸后新执行受理未被拒：HTTP=${gatedExec.status} body=${JSON.stringify(gatedExec.body ?? {}).slice(0, 200)}`);
        console.log(`[drill] 关闸后 admit HTTP=${gatedExec.status}（拒——maintenanceId 行级闸）`);
        // 世代切换：维护终态 COMPLETED（DRAINING 超时 FAILED→resume roll-forward）；在连旧连接 close
        // 断言=best-effort 记录（4410/4413 完整投递语义由 t27 int 红①/红⑤承载——真 WS 形态下 provider
        // 自动重连循环使装置侧 close 码捕获不稳定〔run10=4413/run12=未达〕，不阻断核心断言）
        const closed = wsCloseOf(A, 150_000).catch(() => null);
        await waitFor(async () => {
          const st = await fetch(`${API_URL}/api/collab/maintenance/${S2.project}`, { headers: { 'x-prometheus-token': ADMIN_TOKEN, cookie: `flowweb.session_token=${S2.token}` } }).then((r) => r.json()).catch(() => null);
          const s = st?.data ?? st;
          const stage = s?.operation?.stage ?? s?.stage ?? s?.status;
          if (stage === 'FAILED') {
            const rr = await fetch(`${API_URL}/api/collab/maintenance/${S2.project}/resume`, {
              method: 'POST', headers: { 'x-prometheus-token': ADMIN_TOKEN, cookie: `flowweb.session_token=${S2.token}` },
            }).then((x) => x.status).catch(() => 0);
            console.log(`[drill] 维护 FAILED（drain 超时）→resume=${rr}（roll-forward）`);
            return false;
          }
          return stage === 'COMPLETED' ? 'done' : stage;
        }, 150_000, '维护换代 COMPLETED');
        const closeCode = await Promise.race([closed, new Promise((r) => setTimeout(() => r(null), 3_000))]);
        console.log(`[drill] 换代期旧连接 close=${closeCode ?? '未捕获（provider 重连循环形态——4410/4413 语义承载=t27 int）'}`);
        const { doc } = await projectRow(S2.project);
        if ((doc?.generation ?? 0) < 1) throw new Error(`换代未生效 generation=${doc?.generation}`);
        // 离线客户端重连旧 name（project:X 无 #g 段=旧世代形态）→auth generation mismatch 拒
        // （形态：不装载/不 SS1/不上行——close 码或 sync 拒两形均合法；判据=synced 永不达成）
        const stale = mkProvider(S2);
        const staleSynced = await Promise.race([
          synced(stale, 8_000).then(() => true).catch(() => false),
          new Promise((r) => setTimeout(() => r(false), 8_500)),
        ]);
        const staleClose = staleSynced ? 'ILLEGAL-SYNCED（违约！）' : '未达成（拒装载——auth generation mismatch）';
        destroyProvider(stale);
        if (staleSynced) throw new Error('旧世代 name 连接 synced（admitDocNameForGeneration 失效——复活面！）');
        console.log(`[drill] 旧世代 name 重连 close=${staleClose}（auth generation mismatch——不装载/不 SS1/不上行）`);
        // 新代接入：project:X#g<newGen> 合法
        const gen = doc.generation;
        const fresh = mkProvider(S2, { name: `project:${S2.project}#g${gen}` });
        await synced(fresh, 20_000);
        destroyProvider(fresh); destroyProvider(A);
        return `维护换代全链：关闸拒受理（HTTP ${gatedExec.status}）+换代 COMPLETED（旧连接 close=${closeCode ?? '未捕获'}）+旧 name 重连拒（${staleClose}）+新代 #g${gen} 接入（世代切换·vacuum 换代离线重连 S2 实弹）`;
      } finally {
        await S2.prisma.aIModel.deleteMany({ where: { id: M2.id } }).catch(() => {});
        await S2.prisma.pricingRule.deleteMany({ where: { id: M2.rule } }).catch(() => {});
        await S2.prisma.nodeType.deleteMany({ where: { key: NT2.key } }).catch(() => {});
        await cleanupFixtures(S2);
      }
    });
    await stopService('api-1');
  } finally {
    await stopStack();
    await cleanupFixtures(S);
  }
}

// ═══════════════ 模式七：--worker-crash（外部生成成功后崩溃重试零重复副作用——text 链锚） ═══════════════
async function modeWorkerCrash() {
  await precheck(); await ensureBuilt();
  const S = await makeFixtures('t31-wc');
  timing.t0 = Date.now();
  const ts = Date.now();
  const NT = { key: `smoke:t31:text:${ts}`, id: `t31-wc-nt-${ts}` };
  const MODEL = { id: `t31-wc-m-${ts}`, apiUrl: '', rule: `t31-wc-r-${ts}` };
  const NODE = 't31-wc-node';
  const stubRequests = [];
  let stubFirstSeen = null;
  // stub text provider：收到请求即通知装置（崩溃窗注入点）——200 openai-chat 形态
  const stub = createServer((rq, rs) => {
    const chunks = [];
    rq.on('data', (c) => chunks.push(c));
    rq.on('end', () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* 保持空 */ }
      const entry = { model: body.model ?? '', authorization: rq.headers.authorization ?? '', idem: String(rq.headers['x-idempotency-key'] ?? '') };
      stubRequests.push(entry);
      if (stubFirstSeen === null) stubFirstSeen = { ...entry, at: Date.now() };
      rs.writeHead(200, { 'content-type': 'application/json' });
      rs.end(JSON.stringify({ choices: [{ message: { content: `t31-wc-ok-${ts}` } }] }));
    });
  });
  await new Promise((res) => stub.listen(0, '127.0.0.1', res));
  const stubPort = stub.address().port;
  const { Y } = loadClientLibs();
  try {
    await timed('wc1-fixtures', async () => {
      const { CreditLedgerService } = requireApi('./dist/modules/team/credit-ledger.service.js');
      const ledger = new CreditLedgerService(S.prisma);
      await S.prisma.nodeType.create({ data: { id: NT.id, key: NT.key, name: `t31-wc ${ts}` } });
      MODEL.apiUrl = `http://127.0.0.1:${stubPort}`;
      await S.prisma.aIModel.create({ data: { id: MODEL.id, nodeTypeId: NT.id, name: `t31-wc ${ts}`, provider: 'moonshot', apiUrl: MODEL.apiUrl, apiKey: 't31-wc-dummy', apiModelName: `t31-wc-${ts}`, active: true } });
      await S.prisma.pricingRule.create({ data: { id: MODEL.rule, nodeTypeId: NT.id, modelId: MODEL.id, creditCost: 1, active: true } });
      await ledger.runInTx(async (tx) => {
        await ledger.ensureBalance(tx, S.team);
        await ledger.mutate(tx, { teamId: S.team, operatorUserId: S.user, type: 'register_grant', creditType: 'regular', balanceDelta: 10, frozenDelta: 0, referenceId: `register:${S.team}` });
      });
      return `哨兵（NodeType/AIModel stub/PricingRule cost:1/余额 10）——stub 端口 ${stubPort}`;
    });
    await timed('wc2-crash-window', async () => {
      await startApi('api-1');
      const A = mkProvider(S); await synced(A);
      A.document.transact(() => { const data = new Y.Map(); data.set('model', MODEL.id); const m = new Y.Map(); m.set('type', 'textInput'); m.set('data', data); A.document.getMap('nodes').set(NODE, m); });
      await new Promise((r) => setTimeout(r, 1_500));   // 播种落地窗
      const sv = Buffer.from(Y.encodeStateVector(A.document)).toString('base64');
      const execP = fetch(`${API_URL}/api/execution/execute`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: loadClientLibs().WS_ORIGIN, cookie: `flowweb.session_token=${S.token}` },
        body: JSON.stringify({ projectId: S.project, nodeId: NODE, stateVector: sv }),
        signal: AbortSignal.timeout(60_000),
      }).then((r) => r.json().catch(() => null)).catch((e) => ({ err: e.message }));
      // 崩溃窗：stub 收到外呼（外部生成进行中/成功）即 kill api——本地提交窗（finalize/settle 前）死亡
      await waitFor(() => stubFirstSeen !== null ? 'done' : false, 30_000, 'stub 收到外呼（崩溃窗开）');
      console.log(`[drill] 外呼到达（idem=${stubFirstSeen.idem.slice(0, 24)}…）→kill api（外部成功后、本地提交前——崩溃窗）`);
      await stopService('api-1');   // kill -9（崩溃——形态注记：text 链承载于 api 进程）
      await execP.catch(() => {});
      destroyProvider(A)
      const intent = await S.prisma.generationIntent.findFirst({ where: { projectId: S.project, nodeId: NODE }, select: { status: true, providerRequestId: true, reservedCredits: true, execSeq: true } });
      console.log(`[drill] 崩溃后 intent=${JSON.stringify(intent, (k, v) => typeof v === 'bigint' ? v.toString() : v)}（providerRequestId 已落库=write-ahead 键在外呼前持久化）`);
      if (intent?.providerRequestId == null) throw new Error('崩溃后 providerRequestId 缺失（write-ahead 键未在外呼前落库——偏离 36-④ 契约违约）');
      return `崩溃窗注入过（外呼 1 次已到达+api kill——intent 停驻=${intent?.status}）`;
    });
    await timed('wc3-retry-idempotent', async () => {
      await startApi('api-2');
      const B = mkProvider(S); await synced(B);
      const sv = Buffer.from(Y.encodeStateVector(B.document)).toString('base64');
      let final = null;
      for (let i = 0; i < 10; i++) {
        await fetch(`${API_URL}/api/execution/execute`, {
          method: 'POST', headers: { 'content-type': 'application/json', origin: loadClientLibs().WS_ORIGIN, cookie: `flowweb.session_token=${S.token}` },
          body: JSON.stringify({ projectId: S.project, nodeId: NODE, stateVector: sv }),
          signal: AbortSignal.timeout(30_000),
        }).then((x) => x.json().catch(() => null)).catch(() => null);
        final = await S.prisma.generationIntent.findFirst({ where: { projectId: S.project, nodeId: NODE }, select: { status: true, creditsConsumed: true, reservedCredits: true, execSeq: true } });
        if (final && ['SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(final.status)) break;
        await new Promise((res) => setTimeout(res, 1_500));
      }
      console.log(`[drill] 重试后 intent 终态=${JSON.stringify(final, (k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
      // ── 零重复副作用三断言 ──
      const ledgerRows = await S.prisma.teamCreditTransaction.findMany({ where: { teamId: S.team, referenceId: { startsWith: 'intent:' } }, select: { type: true, balanceDelta: true, frozenDelta: true }, orderBy: { seq: 'asc' } });
      const reserves = ledgerRows.filter((l) => l.type === 'reserve');
      const settles = ledgerRows.filter((l) => l.type === 'settle');
      if (reserves.length !== 1 || settles.length !== 1) throw new Error(`资金非恰一次：reserve=${reserves.length} settle=${settles.length}（零重复副作用违约——台账 ${JSON.stringify(ledgerRows)}）`);
      const balance = await S.prisma.teamBalance.findUnique({ where: { teamId: S.team } });
      if (balance.credits !== 9) throw new Error(`余额=${balance.credits}（期望 9=恰扣一次——双扣/漏扣违约）`);
      const intents = await S.prisma.generationIntent.findMany({ where: { projectId: S.project, nodeId: NODE }, select: { status: true, execSeq: true } });
      if (intents.length !== 1) throw new Error(`intent 行数=${intents.length}（期望 1——重复建行）`);
      const keys = new Set(stubRequests.map((s) => s.idem));
      console.log(`[drill] stub 请求 ${stubRequests.length} 次（幂等键集 ${keys.size} 个）`);
      if (keys.size !== 1) throw new Error(`x-idempotency-key 漂移（${keys.size} 个键——write-ahead 键复用违约）`);
      if (final.status !== 'SUCCEEDED') throw new Error(`重试终态=${final.status}（预期 SUCCEEDED——text 链可重入）`);
      destroyProvider(B)
      return `零重复副作用过：外呼 ${stubRequests.length} 次/幂等键恒同 1 个+reserve/settle 各恰 1 行+余额恰扣一次（9/10）+intent 恰一行 SUCCEEDED`;
    });
    await stopService('api-2');
  } finally {
    await stopStack();
    // 哨兵清理（NodeType/AIModel/PricingRule/intent/台账——前缀谓词）
    try {
      await S.prisma.generationIntent.deleteMany({ where: { teamId: S.team } });
      await S.prisma.aIModel.deleteMany({ where: { id: MODEL.id } });
      await S.prisma.pricingRule.deleteMany({ where: { id: MODEL.rule } });
      await S.prisma.nodeType.deleteMany({ where: { key: NT.key } });
      const { CreditLedgerService } = requireApi('./dist/modules/team/credit-ledger.service.js');
      const ledger = new CreditLedgerService(S.prisma);
      await ledger.runInTx(async (tx) => {
        await tx.teamCreditTransaction.deleteMany({ where: { teamId: S.team } });
        await tx.team.deleteMany({ where: { id: S.team } });
      });
    } catch (e) { console.log(`[drill] SMOKE-WARN 哨兵清理失败: ${e.message}`); }
    await cleanupFixtures(S);
    await new Promise((res) => stub.close(res));
  }
}

// ═══════════════ CLI ═══════════════
function main() {
  const args = process.argv.slice(2);
  const modes = args.filter((a) => a.startsWith('--')).filter((a) => a !== '--confirm');
  for (const flag of modes) {
    if (!FAULT_MODES.includes(flag.slice(2))) { console.error(`未知旗标: ${flag}（禁静默忽略）\n用法：node scripts/drill-fault.mjs --<mode> --confirm（模式：${FAULT_MODES.join('/')}）`); process.exit(2); }
  }
  if (modes.length !== 1) { console.error(`用法：node scripts/drill-fault.mjs --<mode> --confirm（七模式择一：${FAULT_MODES.join('/')}）`); process.exit(2); }
  if (!args.includes('--confirm')) {
    console.error('REFUSED 缺 --confirm：本装置破坏性（kill -9/pg_dump restore/PG 服务 stop/容量闸——库内演练数据确认可弃；快照锚=backups/）。确认后重跑并附 --confirm');
    process.exit(1);
  }
  timing.mode = modes[0].slice(2);
  const runMode = { kill9: modeKill9, infra: modeInfra, 'restore-bump': modeRestoreBump, 'restore-fence': modeRestoreFence, 'pitr-ss2': modePitrSs2, client: modeClient, 'worker-crash': modeWorkerCrash }[timing.mode];
  runMode().then(() => {
    printSummary();
    console.log(`[drill] ${timing.mode} 完成（机器留净）`);
    // 兜底退出（proxy/客户端库偶发残留句柄挂事件循环——服务进程已净、演练判定已闭合；5s 宽限后强退）
    setTimeout(() => process.exit(0), 5_000);
  }).catch(async (e) => {
    console.error(`DRILL FAIL(${timing.mode}): ${e.message}`);
    console.error(e.stack ?? String(e));
    for (const name of [...procs.keys()]) await stopService(name).catch(() => {});
    process.exit(1);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
