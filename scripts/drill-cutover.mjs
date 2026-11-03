#!/usr/bin/env node
// scripts/drill-cutover.mjs
// Y1c T30b（plan Task 30b；spec §6.6+偏离 38⑳·38㉓⑭）：runbook §16 八步破坏性发布序的**本地实弹**
// 演练装置（「staging 克隆环境」=本地环境——P4 重启裁定②）。三模式（各自独立调用，实弹序衔接）：
//   node scripts/drill-cutover.mjs --cutover     --confirm   §16 ①-⑦ 全序计时（freeze→drain→红②probe
//                                                 →停消费者三查→快照→reset→部署新树→RB1 起序→smoke）
//                                                 ——RTO 计时窗（charter pitr 项 RTO≤30min）
//   node scripts/drill-cutover.mjs --rollback    --confirm   ⑦ 回滚=一次性硬切（停新→pg_restore 快照
//                                                 →bump historyId→spool 整目录 quarantine→起旧栈
//                                                 →两向版本门 4406→WAL 不复活动证）
//   node scripts/drill-cutover.mjs --final-reset --confirm   空库 reset→migrate→seed→双端协作全绿
//                                                 （终态链+「reset 可重复执行」再证）
//
// 本地形态适配（诚实登记面——演练记录 gate-evidence/t30b-cutover-drill.txt 逐条对应）：
//   · 旧版消费者=dist 双进程（node dist/main.js COLLAB_ROLE=api + dist/main-worker.js
//     COLLAB_ROLE=worker——ecosystem pm2 形态的本地直跑等价，最贴近服务器形态）
//   · ③对象存储 manifest：本地无 mc——@aws-sdk/client-s3 ListObjectsV2（apps/api 解析）生成
//     mc ls --recursive 同构文本
//   · ⑤6a=本地构建（pnpm build）；6b 省略（非 squash 形态——reset 的 migrate 已按当前树跑过，
//     M-A 注记归 runbook）；6c 无 dist 切换面（树内直跑）
//   · ⑦「nginx 强制旧 bundle」本地无 nginx——版本门行为（4406 路径/version.json）实弹代偿，
//     nginx 段=服务器面未实弹（登记）
//   · gate-collab 与在跑栈 3000/3001 端口结构性冲突——演练外独立跑（问题清单登记）
// 破坏性（reset/pg_restore/进程杀）——--confirm 缺失=拒，exit 非 0 零副作用（reset-collab 同律）。
import { execSync, spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = path.join(ROOT, 'apps', 'api');
const BACKUP_DIR = path.join(ROOT, 'backups');
const requireApi = createRequire(path.join(API_DIR, 'package.json'));

// §16 八步序的机器承载（顺序即语义——乱序=破坏性；node:test 顺序断言消费面=deploy-guard.test.mjs T30b 红②）
export const DRILL_STEPS = ['freeze', 'drain-wait', 'reset-refusal-probe', 'stop-consumers', 'snapshot', 'reset', 'deploy-new', 'rb1-start', 'smoke'];

const API_URL = 'http://127.0.0.1:3000';
const WS_URL = 'ws://127.0.0.1:3001';
const CLOSE_CLIENT_OUTDATED = 4406;   // 版本门三元 terminal close（旧 bundle+新服务端 / hid 不匹配同投）

// ── env（apps/api/.env 手解析——drill 进程自身不 dotenv；只取演练所需键，不打印密钥） ──
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
function maskDsn(dsn) { return dsn.replace(/:\/\/([^:/@]+):[^@]*@/, '://$1:***@'); }

// ── 子进程（win32 .cmd 需 shell——参数全静态字面量无注入面，reset-collab runCmd 同律） ──
function run(cmd, args, opts = {}) {
  return process.platform === 'win32'
    ? spawnSync([cmd, ...args].join(' '), { encoding: 'utf8', ...opts, shell: true })
    : spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}
/** 引号形态子进程（DSN 含 `&`〔Prisma query 参数〕——cmd.exe 裸拼会被命令分隔符截断；参数须预加引号）。 */
function runQuoted(cmdString, opts = {}) {
  return spawnSync(cmdString, { encoding: 'utf8', ...opts, shell: true });
}

// ── PG 工具链（G6a 先例：D:/programfiles/PostgreSQL/16/bin；env PG_BIN_DIR 可覆写，缺省回退 PATH） ──
function resolvePgBin() {
  if (process.env.PG_BIN_DIR && existsSync(path.join(process.env.PG_BIN_DIR, 'pg_dump.exe'))) return process.env.PG_BIN_DIR;
  const guess = 'D:/programfiles/PostgreSQL/16/bin';
  const exe = process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump';
  if (existsSync(path.join(guess, exe))) return guess;
  return '';   // PATH 兜底（pg_dump/pg_restore 裸名）
}
const pgDump = () => (resolvePgBin() ? path.join(resolvePgBin(), process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump') : 'pg_dump');
const pgRestore = () => (resolvePgBin() ? path.join(resolvePgBin(), process.platform === 'win32' ? 'pg_restore.exe' : 'pg_restore') : 'pg_restore');

// ── 端口探测（gate-collab isPortOpen 同形） ──
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

// ── 计时（RTO 判据：charter pitr 项 RTO≤30min——分步+总） ──
const RTO_BUDGET_MS = 30 * 60_000;
const timing = { mode: '', steps: [], t0: 0 };
async function timed(step, fn) {
  const s = Date.now();
  const detail = await fn();
  timing.steps.push({ step, ms: Date.now() - s });
  console.log(`[drill] STEP ${step} done ${(Date.now() - s)}ms${detail ? `（${detail}）` : ''}`);
}
function printSummary() {
  const totalMs = Date.now() - timing.t0;
  const payload = { mode: timing.mode, steps: timing.steps, totalMs, rtoBudgetMs: RTO_BUDGET_MS, withinRto: totalMs <= RTO_BUDGET_MS };
  console.log(`DRILL-SUMMARY ${JSON.stringify(payload)}`);
  for (const s of timing.steps) console.log(`DRILL-TIMING ${s.step} ${s.ms}ms`);
  console.log(`DRILL-TIMING total ${totalMs}ms（RTO 预算 ${RTO_BUDGET_MS}ms——${totalMs <= RTO_BUDGET_MS ? '内' : '超'}）`);
  return payload;
}

// ── HTTP 面 ──
const ADMIN_TOKEN = envOf('COLLAB_ADMIN_TOKEN');
async function getReadyFull() {
  return fetch(`${API_URL}/api/ready`, { headers: { 'x-prometheus-token': ADMIN_TOKEN } })
    .then((r) => r.json()).catch(() => null);
}
async function postDrain() {
  // 全局 TransformInterceptor 包一层 {code,data,message}（drain=普通返回值端点；/api/ready=@Res() 直写不受包）
  const r = await fetch(`${API_URL}/api/drain`, { method: 'POST', headers: { 'x-prometheus-token': ADMIN_TOKEN } })
    .then((x) => x.json()).catch(() => null);
  const d = r?.data ?? r;
  if (!d || d.draining !== true) throw new Error(`drain 未生效：${JSON.stringify(r)}`);
  return d;
}

// ── PG 面 ──
async function withPg(fn, applicationName = 'drill-t30b') {
  const { Client } = requireApi('pg');
  const client = new Client({ connectionString: loadDatabaseUrl(), application_name: applicationName });
  await client.connect();
  try { return await fn(client); } finally { await client.end().catch(() => {}); }
}
/** 三查①：同库活连接计数（backend_type='client backend' 过滤——reset-collab precheck 同源口径；
 *  排除本装置探针自身（前一轮关闭中的 idle backend 会在 pg_stat_activity 短暂滞留=自污染假红）。 */
async function dbClientBackends() {
  return withPg(async (client) => {
    const rows = (await client.query(`SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'
      AND application_name <> 'drill-t30b'`)).rows;
    return rows.length;
  }, 'drill-t30b-probe');
}
/** 三查③：租约行判定（无行/owner 空/已过期=无持有）。 */
async function leaseVerdict() {
  return withPg(async (client) => {
    let row = null;
    try { row = (await client.query(`SELECT owner, "expiresAt" FROM "CollabLease" WHERE scope = 'primary'`)).rows[0] ?? null; }
    catch (e) { if (e.code !== '42P01') throw e; return 'no-table（schema 空）'; }
    if (row == null) return 'no-row';
    if (!row.owner) return 'owner-null';
    if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) return 'expired';
    return `HELD（owner=${row.owner} expiresAt=${row.expiresAt?.toISOString()}）`;
  });
}
async function systemHistory() {
  return withPg(async (client) => {
    const r = await client.query(`SELECT "historyId", "epochStartedAt" FROM "SystemHistory" WHERE id = 1`);
    if (r.rows.length !== 1) throw new Error('SystemHistory id=1 行缺失');
    return { historyId: r.rows[0].historyId, epochStartedAt: r.rows[0].epochStartedAt };
  });
}

// ── 长跑进程管理（api/worker——日志落 backups/t30b-logs/） ──
const procs = new Map();
function spawnService(name, script, role) {
  const logDir = path.join(BACKUP_DIR, 't30b-logs');
  mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `${timing.mode}-${name}.log`);
  const child = spawn(process.execPath, [script], {
    cwd: API_DIR,
    env: { ...process.env, COLLAB_ROLE: role },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stream = createWriteStream(logFile, { flags: 'a' });
  const pipe = (chunk) => { const s = String(chunk); stream.write(s); process.stdout.write(`[${name}] ${s}`); };
  child.stdout.on('data', pipe);
  child.stderr.on('data', pipe);
  child.on('exit', (code, signal) => { pipe(`[drill] ${name} 退出 code=${code} signal=${signal}\n`); procs.delete(name); });
  procs.set(name, child);
  console.log(`[drill] spawn ${name} pid=${child.pid} role=${role} log=${logFile}`);
  return child;
}
async function stopService(name, timeoutMs = 20_000) {
  const child = procs.get(name);
  if (!child) return;
  if (process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' }); } catch { /* 已退出 */ } }
  else { try { child.kill('SIGKILL'); } catch { /* 已退出 */ } }
  await waitFor(() => procs.has(name) ? false : 'done', timeoutMs, `${name} 退出`).catch(() => {
    procs.delete(name);
    console.log(`[drill] WARNING ${name} 退出等待超时（端口面兜底核对）`);
  });
}
/** 端口兜底杀（跨调用残留/孤儿进程——netstat 反查 pid+taskkill；unix 无面则红提示人工处理）。 */
async function portKill(ports) {
  for (const port of ports) {
    if (!(await isPortOpen(port))) { console.log(`[drill] port ${port} 已无监听`); continue; }
    if (process.platform !== 'win32') throw new Error(`端口 ${port} 被占且非 win32（无 netstat 杀面）——人工清理后重跑`);
    const out = execSync(`netstat -ano`, { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(new RegExp(`TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`));
      if (m) pids.add(m[1]);
    }
    for (const pid of pids) {
      console.log(`[drill] 杀端口 ${port} 占用者 pid=${pid}`);
      try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch { /* 竞态已退 */ }
    }
    await waitFor(async () => !(await isPortOpen(port)) ? 'done' : false, 15_000, `端口 ${port} 释放`);
  }
}

// ── WS/协作装置（collab-smoke 同族：ws 注入 header+csv 版本门单源） ──
function loadClientLibs() {
  const WebSocket = requireApi('ws');
  const Y = requireApi('yjs');
  const { HocuspocusProvider } = requireApi('@hocuspocus/provider');
  const shared = requireApi('@flowweb/shared');
  const CSV = shared.CLIENT_PROTOCOL_VERSION;
  const SV = shared.CANVAS_DOC_SCHEMA_VERSION;   // T24 三元上行（缺失=4406——演练实弹发现面）
  const WS_ORIGIN = envOf('COLLAB_ALLOWED_ORIGINS').split(',')[0]?.trim()
    || new URL(envOf('BETTER_AUTH_URL', 'http://localhost:5173')).origin;
  return { WebSocket, Y, HocuspocusProvider, CSV, SV, WS_ORIGIN };
}
async function makeFixtures(prefix) {
  const { PrismaClient } = requireApi('@prisma/client');
  const prisma = new PrismaClient();
  const ts = Date.now();
  const S = { prisma, user: `${prefix}-u-${ts}`, team: `${prefix}-t-${ts}`, member: `${prefix}-m-${ts}`, project: `${prefix}-p-${ts}`, token: `drill-tok-${randomUUID()}` };
  await prisma.user.create({ data: { id: S.user, name: `drill-${ts}`, email: `drill-${ts}@example.invalid`, emailVerified: false } });
  await prisma.team.create({ data: { id: S.team, name: `drill-${ts}`, ownerId: S.user } });
  await prisma.teamMember.create({ data: { id: S.member, teamId: S.team, userId: S.user, role: 'MEMBER' } });
  await prisma.canvasProject.create({ data: { id: S.project, name: `drill-${ts}`, teamId: S.team } });
  await prisma.session.create({ data: { id: `drill-s-${ts}`, userId: S.user, token: S.token, expiresAt: new Date(Date.now() + 30 * 60_000) } });
  return S;
}
async function cleanupFixtures(S) {
  const order = [
    () => S.prisma.session.deleteMany({ where: { userId: S.user } }),
    () => S.prisma.teamMember.deleteMany({ where: { id: S.member } }),
    () => S.prisma.canvasProject.deleteMany({ where: { id: S.project } }),
    () => S.prisma.team.deleteMany({ where: { id: S.team } }),
    () => S.prisma.user.deleteMany({ where: { id: S.user } }),
  ];
  for (const del of order) await del().catch((e) => console.log(`[drill] SMOKE-WARN 哨兵清理失败: ${e.message}`));
  await S.prisma.$disconnect();
}
/** T9+ 节点信封（type 标量+data Map 容器——exec-smoke 播种同形；旧 kind 信封=frame-deny node-key 4411 恒拒）。 */
function mkNode(Y, id, content) {
  const data = new Y.Map();
  data.set('content', content ?? `drill-${id}`);
  const m = new Y.Map();
  m.set('type', 'textInput');
  m.set('data', data);
  return m;
}
/** 原始 WS 连接并断言版本门 terminal close 码（两向实弹——T24 close 帧先例的裸 ws 形态）。 */
function rawWsExpectClose(query, expectCode, timeoutMs = 15_000) {
  const { WebSocket, WS_ORIGIN } = loadClientLibs();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}/?${query}`, { headers: { origin: WS_ORIGIN } });
    const t = setTimeout(() => { try { ws.close(); } catch { /* noop */ } reject(new Error(`版本门 close 等待超时（${query}——期望 ${expectCode}）`)); }, timeoutMs);
    ws.on('close', (code) => { clearTimeout(t); code === expectCode ? resolve(`close=${code}`) : reject(new Error(`close 码不符（${query}——期望 ${expectCode} 实得 ${code}）`)); });
    ws.on('error', (e) => { clearTimeout(t); reject(new Error(`WS 错误（${query}）：${e.message}`)); });
    ws.on('open', () => { /* 认证后 close 帧——等待 close */ });
  });
}

// ═══════════════ T30b 红②实弹步骤（Controller 先红裁定②——对 T30 precheck 的真实环境复证） ═══════════════
/** 旧消费者在线窗内驱动真实 reset CLI——必须因「消费者在线」拒（exit 非 0）。装置缺失判据红=T30b 红③。 */
export async function resetRefusalProbeLive() {
  const r = run('node', [path.join(ROOT, 'scripts', 'reset-collab.mjs'), '--rebuild-db', '--confirm'], { cwd: ROOT, timeout: 180_000 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  if (r.status === 0) throw new Error(`红②实弹复证红：旧消费者在线而 reset 未拒（exit 0——T30 precheck 判据失效）：${out.slice(-400)}`);
  if (!/消费者在线/.test(out)) throw new Error(`红②实弹复证红：reset 拒绝但判据非「消费者在线」：${out.slice(-400)}`);
  // 卫生：precheck 拒在 drop 前落了 freshState（0 完成阶段=语义等价全新）——确认后清档（真实中断态〔有完成阶段〕不删）
  const statePath = path.join(ROOT, '.reset-collab-state.json');
  if (existsSync(statePath)) {
    const st = JSON.parse(readFileSync(statePath, 'utf8'));
    const doneCount = Object.values(st.stages ?? {}).filter((x) => x?.done === true).length;
    if (doneCount === 0) rmSync(statePath);
    else console.log(`[drill] WARNING probe 后状态文件含 ${doneCount} 个已完成阶段（非本 probe 产物）——保留不删`);
  }
  return '旧消费者在线 → reset 拒（decideResetGuard 消费者在线——T30 precheck 真实环境复证过）';
}

// ═══════════════ 模式一：--cutover（§16 ①-⑦ 计时全序） ═══════════════
async function modeCutover() {
  // ── setup（不在 RTO 计时窗：构建+旧栈起+预写——运维窗自「公告维护」起算）──
  console.log('[drill] === setup：预检+构建+旧栈起（dist 双进程形态——最贴近服务器 pm2 形态的本地等价） ===');
  for (const [port, name] of [[5432, 'PostgreSQL'], [6379, 'Redis'], [9000, 'MinIO']]) {
    if (!(await isPortOpen(port))) throw new Error(`基础设施预检失败：${name}(${port}) 未监听`);
  }
  for (const port of [3000, 3001, 3002]) {
    if (await isPortOpen(port)) throw new Error(`端口 ${port} 被占——演练需空闲（残留进程清理后重跑）`);
  }
  if (!ADMIN_TOKEN) throw new Error('COLLAB_ADMIN_TOKEN 未配置（drain/ready 全字段面需要）');
  console.log(`[drill] PG 工具链：${resolvePgBin() || 'PATH'}`);
  const b = run('pnpm', ['--filter', '@flowweb/shared', 'build'], { cwd: ROOT, stdio: 'inherit', timeout: 300_000 });
  if (b.status !== 0) throw new Error('shared build 失败');
  const b2 = run('pnpm', ['--filter', '@flowweb/api', 'build'], { cwd: ROOT, stdio: 'inherit', timeout: 600_000 });
  if (b2.status !== 0) throw new Error('api build 失败');

  spawnService('old-api', 'dist/main.js', 'api');
  await waitFor(async () => {
    const r = await fetch(`${API_URL}/api/ready`).then((x) => x.json()).catch(() => null);
    return r?.ready === true ? 'done' : false;
  }, 120_000, '旧 api ready');
  spawnService('old-worker', 'dist/main-worker.js', 'worker');
  await waitFor(() => isPortOpen(3002) ? 'done' : false, 120_000, '旧 worker 3002 指标口');
  console.log('[drill] 旧栈在线（api ready+worker 3002）——旧 DB 消费者=2 进程');

  // 预写+活跃连接（drain 步的实work面）+快照前 historyId 留档
  const pre = await makeFixtures('t30b-pre');
  const libs0 = loadClientLibs();
  const mkHeaderWs = (headers) => class HeaderWs extends libs0.WebSocket { constructor(url) { super(url, { headers }); } };
  const P = new libs0.HocuspocusProvider({
    url: `${WS_URL}?csv=${libs0.CSV}&sv=${libs0.SV}&cb=drill`, name: `project:${pre.project}`, document: new libs0.Y.Doc(),
    WebSocketPolyfill: mkHeaderWs({ origin: libs0.WS_ORIGIN, cookie: `flowweb.session_token=${pre.token}` }),
  });
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('预写 provider synced 超时')), 15_000); P.on('synced', () => { clearTimeout(t); res(); }); });
  P.document.transact(() => P.document.getMap('nodes').set('drill-pre-marker', mkNode(libs0.Y, 'pre-marker')));
  const preHistory = await systemHistory();
  await pre.prisma.$disconnect();   // 三查①卫生：预写 fixture 连接池在停消费者前撤（否则活连接恒 1=假红）
  console.log(`[drill] 预写完成（活跃连接在位）；pre-reset historyId=${preHistory.historyId}`);

  // ── RTO 计时窗起算（①公告维护+freeze）──
  timing.t0 = Date.now();
  await timed('freeze', async () => {
    const r = await postDrain();
    console.log('[drill] ①公告维护（本地形态=日志注记——公告面=服务器人工动作，登记）+gate freeze：drain 生效（写路径拒绝/读维持）');
    return `drain pending=${JSON.stringify(r.pending)}`;
  });

  await timed('drain-wait', async () => {
    const deadline = Date.now() + 60_000;
    let lastDrain = Date.now();
    while (Date.now() < deadline) {
      const r = await getReadyFull();
      if (r?.pending && r.pending.projects === 0 && r.pending.batches === 0) break;   // spoolHeadSeq==pgSeq（批落 PG）语义
      if (Date.now() - lastDrain > 20_000) { await postDrain(); lastDrain = Date.now(); }   // 60s TTL 窗内续期（deploy-guard 同款）
      await new Promise((s) => setTimeout(s, 500));
    }
    const final = await getReadyFull();
    if (!(final?.pending && final.pending.projects === 0 && final.pending.batches === 0)) {
      throw new Error(`pending 未排空（spoolHeadSeq≠pgSeq）：${JSON.stringify(final?.pending)}`);
    }
    // 活跃连接 0（客户端断开；兜底=drain 60s 自动解除时服务端 1012 强断——「或强制 1012」档。
    // 口径：connections=pending 的兄弟字段（ready service 冻结形状——禁进 pending 对象）
    try { P.destroy(); } catch { /* 已断 */ }
    await waitFor(async () => {
      const r = await getReadyFull();
      return r && r.connections === 0 ? 'done' : r?.connections ?? 'no-ready';
    }, 75_000, '活跃连接归零（含 60s 自动解除 1012 强断兜底窗）');
    return 'spoolHeadSeq==pgSeq（projects/batches=0）+活跃连接 0';
  });

  await timed('reset-refusal-probe', () => resetRefusalProbeLive());

  await timed('stop-consumers', async () => {
    // ②按序：worker 先停（消费面先断——本地单 worker 形态承载 feed→execution→compact 全部子系统）→api
    await stopService('old-worker');
    await stopService('old-api');
    const conns = await waitFor(() => dbClientBackends().then((n) => n === 0 ? 'done' : n), 15_000, '三查① DB 连接归零');
    const pid = 'worker/api 子进程退出事件已收（stopService 等待面）';
    // 三查③：taskkill=SIGKILL 等价不释放租约行——等 TTL 过期（缺省 10s——runbook ③「等 TTL 过期再 reset」同款）
    let leaseFinal = '';
    await waitFor(async () => leaseVerdict().then((v) => { if (v.startsWith('HELD')) return false; leaseFinal = v; return 'done'; }), 30_000, '三查③ 租约 TTL 过期');
    const lease = leaseFinal;
    console.log(`[drill] 三查：①DB client-backend 连接=0 ✓（${conns}）②PID=${pid} ✓ ③租约=${lease} ✓（TTL 过期）`);
    return `三查过（连接 0/PID 退出/租约=${lease}）`;
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpPath = path.join(BACKUP_DIR, `t30b-pre-reset-${stamp}.dump`);
  const manifestPath = path.join(BACKUP_DIR, `t30b-pre-reset-minio-manifest-${stamp}.txt`);
  await timed('snapshot', async () => {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const d = runQuoted(`"${pgDump()}" -Fc -f "${dumpPath}" "${loadDatabaseUrl()}"`, { cwd: ROOT, timeout: 300_000 });   // 选项须先于位置参数 dbname（PG CLI 解析序）
    if (d.status !== 0) throw new Error(`pg_dump 失败：${(d.stderr ?? '').slice(-400)}`);
    // 对象存储 manifest（本地无 mc——SDK ListObjectsV2 生成 mc ls --recursive 同构文本；形态偏差登记）
    const { S3Client, ListObjectsV2Command } = requireApi('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region: 'us-east-1', endpoint: envOf('MINIO_ENDPOINT', 'http://127.0.0.1:9000'),
      credentials: { accessKeyId: envOf('MINIO_ACCESS_KEY', 'minioadmin'), secretAccessKey: envOf('MINIO_SECRET_KEY', 'minioadmin') },
      forcePathStyle: true,
    });
    const bucket = envOf('MINIO_BUCKET', 'flowai');
    let token; const lines = [];
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
      for (const o of page.Contents ?? []) lines.push(`${o.LastModified?.toISOString() ?? '-'} ${String(o.Size ?? 0).padStart(10)} ${o.Key}`);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    writeFileSync(manifestPath, `${lines.join('\n')}\n`);
    return `pg_dump=${path.basename(dumpPath)}（${(statSync(dumpPath).size / 1024).toFixed(0)}KB）+minio manifest=${lines.length} 对象（SDK 形态——mc 缺席偏差）`;
  });
  const resetEraHistoryProbe = await systemHistory();   // 快照时点（=pre-reset 纪元）

  await timed('reset', async () => {
    const r = run('node', [path.join(ROOT, 'scripts', 'reset-collab.mjs'), '--rebuild-db', '--confirm'], { cwd: ROOT, stdio: 'inherit', timeout: 600_000 });
    if (r.status !== 0) throw new Error(`reset-collab 失败（exit ${r.status}）`);
    return '七阶段全链过（含 SystemHistory bump+旧 spool 整目录 quarantine）';
  });

  await timed('deploy-new', async () => {
    const b1 = run('pnpm', ['--filter', '@flowweb/shared', 'build'], { cwd: ROOT, stdio: 'inherit', timeout: 300_000 });
    const b2 = run('pnpm', ['--filter', '@flowweb/api', 'build'], { cwd: ROOT, stdio: 'inherit', timeout: 600_000 });
    if (b1.status !== 0 || b2.status !== 0) throw new Error('6a 本地构建失败');
    return '6a 本地构建过；6b 省略（非 squash 形态——reset 的 migrate 已按当前树跑过，M-A 注记）；6c 无切换面（树内直跑）';
  });

  await timed('rb1-start', async () => {
    spawnService('new-api', 'dist/main.js', 'api');
    // M-B 修正形态：ready 等待有失败分支（60s 超限=abort 不起 worker——「60 轮空转无失败分支」不复存在）
    try {
      await waitFor(async () => {
        const r = await fetch(`${API_URL}/api/ready`).then((x) => x.json()).catch(() => null);
        return r?.ready === true ? 'done' : false;
      }, 60_000, '新 api ready');
    } catch (e) {
      await stopService('new-api').catch(() => {});
      throw new Error(`api ready 60s 未达——不起 worker（RB1 三步序；M-B 修正形态）：${e.message}`);
    }
    spawnService('new-worker', 'dist/main-worker.js', 'worker');
    try {
      await waitFor(() => isPortOpen(3002) ? 'done' : false, 60_000, '新 worker 3002 指标口');
    } catch (e) {
      throw new Error(`worker 3002 60s 未监听（引导未完成/崩溃——查 backups/t30b-logs）：${e.message}`);
    }
    return 'RB1 三步序过（api 先起→ready 绿→worker→3002 监听）';
  });

  const resetEraHistory = await systemHistory();
  await timed('smoke', async () => {
    for (const smoke of ['collab-smoke.mjs', 'exec-smoke.mjs']) {
      const r = run('pnpm', ['--filter', '@flowweb/api', 'exec', 'node', `scripts/${smoke}`], { cwd: ROOT, stdio: 'inherit', timeout: 600_000 });
      if (r.status !== 0) throw new Error(`${smoke} 失败（exit ${r.status}）`);
    }
    await smokeSupplement(preHistory.historyId, resetEraHistory.historyId);
    return 'collab-smoke+exec-smoke+补充断言（undo/barrier Durable/feed 追平/查无 doc.exec/版本门 A 向 4406）全过';
  });

  const summary = printSummary();
  writeFileSync(path.join(BACKUP_DIR, 't30b-drill-state.json'), JSON.stringify({
    dumpPath, manifestPath, preResetHistoryId: preHistory.historyId, resetEraHistoryId: resetEraHistory.historyId, snapshotHistoryIdProbe: resetEraHistoryProbe.historyId, cutoverSummary: summary,
  }, null, 2));
  console.log('[drill] cutover 完成——新栈保持在线（⑧开放写态）；回滚演练接续：node scripts/drill-cutover.mjs --rollback --confirm（其步 1 停新）');
}

/** 卡文⑥点名补充断言（既有装置缺口面——collab-smoke 已覆盖双端建/改/广播/store 落 PG，exec-smoke 已覆盖执行）。 */
async function smokeSupplement(preResetHistoryId, resetEraHistoryId) {
  const S = await makeFixtures('t30b-sm');
  const { Y, HocuspocusProvider, WebSocket, CSV, SV, WS_ORIGIN } = loadClientLibs();
  const mkHeaderWs = (headers) => class HeaderWs2 extends WebSocket { constructor(url) { super(url, { headers }); } };
  const mk = () => new HocuspocusProvider({
    url: `${WS_URL}?csv=${CSV}&sv=${SV}&cb=drill`, name: `project:${S.project}`, document: new Y.Doc(),
    WebSocketPolyfill: mkHeaderWs({ origin: WS_ORIGIN, cookie: `flowweb.session_token=${S.token}` }),
  });
  const A = mk(), B = mk();
  const synced = (p) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('synced 超时 10s')), 10_000); p.on('synced', () => { clearTimeout(t); res(); }); });
  try {
    await Promise.all([synced(A), synced(B)]);
    // undo：A 建→B 见→A undo→B 见消失（undo origin 单元在客户端）
    A.document.transact(() => A.document.getMap('nodes').set('drill-undo-node', mkNode(Y, 'undo-node')));
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('undo 前置：B 10s 未见 drill-undo-node')), 10_000);
      const c = () => { if (B.document.getMap('nodes').has('drill-undo-node')) { clearTimeout(t); res(); } };
      B.document.on('update', c); c();
    });
    const um = new Y.UndoManager(A.document.getMap('nodes'));
    um.undo();
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('undo 断言：B 10s 仍见 drill-undo-node（undo 未生效/未广播）')), 10_000);
      const c = () => { if (!B.document.getMap('nodes').has('drill-undo-node')) { clearTimeout(t); res(); } };
      B.document.on('update', c); c();
    });
    console.log('[drill] smoke 补充：undo 过（A undo→B 收敛移除）');
    // 保存（barrier Durable）：stateless {nonce,clientSeq}→回执 committedSeq 无 error
    A.document.transact(() => A.document.getMap('nodes').set('drill-barrier-node', mkNode(Y, 'barrier-node')));
    const nonce = `drill-${randomUUID()}`;
    const receipt = await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('barrier 回执 10s 未达（Durable 未证）')), 10_000);
      A.on('stateless', ({ payload }) => {
        try { const p = JSON.parse(payload); if (p.nonce === nonce) { clearTimeout(t); res(p); } } catch { /* 非 JSON 通告 */ }
      });
      A.sendStateless(JSON.stringify({ nonce, clientSeq: 1 }));
    });
    if (receipt.error || typeof receipt.committedSeq !== 'string') throw new Error(`barrier 回执非 Durable 档：${JSON.stringify(receipt)}`);
    console.log(`[drill] smoke 补充：save barrier Durable 过（committedSeq=${receipt.committedSeq}）`);
    // feed 追平：HTTP 游标可从 0 枚举至 cursor（事件链覆盖水位）——端点受全局 TransformInterceptor 包裹取 .data
    const cookie = { cookie: `flowweb.session_token=${S.token}` };
    const snap = (await fetch(`${API_URL}/api/collab/runtime-feed/${S.project}/snapshot`, { headers: cookie }).then((r) => r.json())).data;
    const ev = (await fetch(`${API_URL}/api/collab/runtime-feed/${S.project}/events?after=0&limit=200`, { headers: cookie }).then((r) => r.json())).data;
    const evCount = Array.isArray(ev.events) ? ev.events.length : 0;
    const cursor = snap.cursor?.feedSeq;
    if (!cursor || cursor === '0' || evCount === 0) throw new Error(`feed 未追平：cursor=${cursor} events=${evCount}（响应 ${JSON.stringify(snap).slice(0, 200)}/${JSON.stringify(ev).slice(0, 200)}）`);
    console.log(`[drill] smoke 补充：feed 追平过（cursor=${cursor} events=${evCount} latestFeedSeq=${ev.latestFeedSeq ?? '-'}）`);
    // 查无 doc.exec：重放投影断言（readSnapshotOnly→probe doc）——exec 面零键（T32 删除清单的前向断言）
    await new Promise((r) => setTimeout(r, 2500));   // 批落 PG 等待（collab-smoke 轮询同窗）
    const { CanvasDocUpdateRepository } = requireApi('./dist/modules/collab/canvas-doc-update.repository.js');
    const prisma = S.prisma;
    const repo = new CanvasDocUpdateRepository(prisma);
    const { state, updates } = await repo.readSnapshotOnly(S.project);
    const probe = new Y.Doc();
    if (state) Y.applyUpdate(probe, new Uint8Array(state));
    for (const u of updates) Y.applyUpdate(probe, new Uint8Array(u));
    if (probe.getMap('exec').size !== 0) throw new Error(`doc.exec 非空（${probe.getMap('exec').size} 键——执行面不得写 doc exec map）`);
    console.log('[drill] smoke 补充：查无 doc.exec 过（重放投影 exec map 零键）');
    // 版本门 A 向（旧 bundle+新服务端→4406）：csv=2 schema-outdated 档+hid=旧纪元档（客户端 IDB 五元自燃实证）
    const c1 = await rawWsExpectClose(`csv=2&sv=2&cb=drill`, CLOSE_CLIENT_OUTDATED);
    const c2 = await rawWsExpectClose(`csv=${CSV}&sv=${SV}&hid=${preResetHistoryId}&cb=drill`, CLOSE_CLIENT_OUTDATED);
    console.log(`[drill] smoke 补充：版本门 A 向过（旧 bundle+新服务端→4406：${c1}；旧 hid〔${preResetHistoryId.slice(0, 8)}…〕→4406：${c2}）`);
  } finally {
    for (const p of [A, B]) { try { p.destroy(); } catch { /* 已断 */ } }
    await cleanupFixtures(S);
  }
}

// ═══════════════ 模式二：--rollback（⑦ 一次性硬切回滚） ═══════════════
async function modeRollback() {
  timing.t0 = Date.now();
  const statePath = path.join(BACKUP_DIR, 't30b-drill-state.json');
  if (!existsSync(statePath)) throw new Error('t30b-drill-state.json 缺失（先跑 --cutover 产快照锚）');
  const D = JSON.parse(readFileSync(statePath, 'utf8'));
  if (!existsSync(D.dumpPath)) throw new Error(`快照缺失：${D.dumpPath}`);

  await timed('stop-new', async () => {
    await portKill([3000, 3001, 3002]);
    await waitFor(() => dbClientBackends().then((n) => n === 0 ? 'done' : n), 15_000, '停新后 DB 连接归零');
    return '新栈全停（一次性硬切：不支持「新客户端+旧服务端」混跑）';
  });

  await timed('restore-snapshot', async () => {
    // 整库恢复=DROP schema 后 pg_restore（确定性形态——-c 依赖 dump 内 DROP 序）
    await withPg(async (client) => { await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); });
    const r = runQuoted(`"${pgRestore()}" --no-owner --no-privileges -d "${loadDatabaseUrl()}" "${D.dumpPath}"`, { cwd: ROOT, timeout: 300_000 });
    if (r.status !== 0) throw new Error(`pg_restore 失败：${(r.stderr ?? '').slice(-600)}`);
    const h = await systemHistory();
    if (h.historyId !== D.preResetHistoryId) throw new Error(`恢复后 historyId=${h.historyId} ≠ 快照纪元 ${D.preResetHistoryId}（恢复失真）`);
    return `快照恢复过（historyId 回旧纪元 ${h.historyId.slice(0, 8)}…）`;
  });

  let quarantineDir = '';
  await timed('bump-and-quarantine', async () => {
    // restore 契约收尾（spec §4.4）：bump historyId（单事务）→旧 spool/WAL 整目录 quarantine（T13 栅栏）
    const h = await withPg(async (client) => {
      const r = await client.query(`UPDATE "SystemHistory" SET "historyId" = gen_random_uuid()::text, "epochStartedAt" = now(), "updatedAt" = now() WHERE id = 1 RETURNING "historyId"`);
      if (r.rows.length !== 1) throw new Error('SystemHistory id=1 行缺失（恢复不完整）');
      return r.rows[0].historyId;
    });
    const spool = path.join(API_DIR, '.data', 'collab-spool');
    let quarantinedFiles = 0;
    if (existsSync(spool)) {
      quarantineDir = path.join(path.dirname(spool), `.quarantine-rollback-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      renameSync(spool, quarantineDir);
      quarantinedFiles = readdirSync(quarantineDir).length;
    }
    return `bump=${h.slice(0, 8)}…+spool quarantine=${quarantinedFiles} 文件（保证据不删——boot 栅栏双保险）`;
  });

  await timed('rollback-start', async () => {
    console.log('[drill] ⑦回滚本地形态：前端 bundle 同回滚+nginx 强制旧 bundle=版本门行为验证（下步两向）——nginx 段=服务器面未实弹（登记）');
    spawnService('rb-api', 'dist/main.js', 'api');
    try {
      await waitFor(async () => {
        const r = await fetch(`${API_URL}/api/ready`).then((x) => x.json()).catch(() => null);
        return r?.ready === true ? 'done' : false;
      }, 60_000, '回滚 api ready');
    } catch (e) {
      await stopService('rb-api').catch(() => {});
      throw new Error(`api ready 60s 未达——不起 worker（RB1 三步序；M-B 修正形态）：${e.message}`);
    }
    spawnService('rb-worker', 'dist/main-worker.js', 'worker');
    await waitFor(() => isPortOpen(3002) ? 'done' : false, 60_000, '回滚 worker 3002');
    return '回滚目标态栈起（api→ready→worker）';
  });

  await timed('two-way-verify', async () => {
    const { CSV, SV } = loadClientLibs();
    // B 向（新 bundle+旧服务端→不可用）：csv>current=server-outdated→terminal 4406；hid=reset 代（新客户端缓存）→4406
    const c1 = await rawWsExpectClose(`csv=4&sv=${SV}&cb=drill`, CLOSE_CLIENT_OUTDATED);
    const c2 = await rawWsExpectClose(`csv=${CSV}&sv=${SV}&hid=${D.resetEraHistoryId}&cb=drill`, CLOSE_CLIENT_OUTDATED);
    // A 向复证（csv=2 旧 bundle 对恢复后服务端——4406 恒拒，防「旧服端放旧客户端」错觉）
    const c3 = await rawWsExpectClose(`csv=2&sv=2&cb=drill`, CLOSE_CLIENT_OUTDATED);
    console.log(`[drill] 两向实弹：B 向 csv=4→${c1}；B 向 hid=reset 代→${c2}；A 向 csv=2→${c3}`);
    // WAL 不复活动证（T13 栅栏行为级复证）：quarantine 目录在 boot 后原样+fail-closed 未触发（ready 已达）
    if (quarantineDir) {
      if (!existsSync(quarantineDir)) throw new Error('quarantine 目录消失（复活面！）');
      const n = readdirSync(quarantineDir).length;
      if (n === 0) throw new Error('quarantine 目录空（boot 收养/清空=复活面！）');
      console.log(`[drill] WAL 不复活动证：quarantine 目录 ${n} 文件原样（boot 未收养）+fail-closed 未触发（ready 达成）`);
    } else {
      console.log('[drill] WAL 不复活动证：quarantine 时 spool 目录不存在（空态——无旧段可复活，注记）');
    }
    return '两向 4406+WAL 不复活过';
  });

  printSummary();
  await stopService('rb-worker'); await stopService('rb-api');
  console.log('[drill] rollback 完成（演练态收尾——机器留净）；终态链：node scripts/drill-cutover.mjs --final-reset --confirm');
}

// ═══════════════ 模式三：--final-reset（空库链+双端协作全绿） ═══════════════
async function modeFinalReset() {
  timing.t0 = Date.now();
  await timed('ensure-down', async () => {
    await portKill([3000, 3001, 3002]);
    await waitFor(() => dbClientBackends().then((n) => n === 0 ? 'done' : n), 15_000, '栈停后 DB 连接归零');
    return '栈停';
  });
  await timed('final-reset', async () => {
    const r = run('node', [path.join(ROOT, 'scripts', 'reset-collab.mjs'), '--rebuild-db', '--confirm'], { cwd: ROOT, stdio: 'inherit', timeout: 600_000 });
    if (r.status !== 0) throw new Error(`reset-collab 失败（exit ${r.status}）`);
    return '空库 reset→migrate→seed 全链过（reset 可重复执行再证）';
  });
  await timed('rb1-start', async () => {
    spawnService('fin-api', 'dist/main.js', 'api');
    try {
      await waitFor(async () => {
        const r = await fetch(`${API_URL}/api/ready`).then((x) => x.json()).catch(() => null);
        return r?.ready === true ? 'done' : false;
      }, 60_000, '终态 api ready');
    } catch (e) {
      await stopService('fin-api').catch(() => {});
      throw new Error(`api ready 60s 未达——不起 worker（RB1 三步序；M-B 修正形态）：${e.message}`);
    }
    spawnService('fin-worker', 'dist/main-worker.js', 'worker');
    await waitFor(() => isPortOpen(3002) ? 'done' : false, 60_000, '终态 worker 3002');
    return 'RB1 三步序过';
  });
  await timed('smoke', async () => {
    const r = run('pnpm', ['--filter', '@flowweb/api', 'exec', 'node', 'scripts/collab-smoke.mjs'], { cwd: ROOT, stdio: 'inherit', timeout: 600_000 });
    if (r.status !== 0) throw new Error(`collab-smoke 失败（exit ${r.status}）`);
    return '空库 reset 态双端协作全绿（WS→auth→load→双端写→广播互见→store→PG→重放）';
  });
  printSummary();
  await stopService('fin-worker'); await stopService('fin-api');
  console.log('[drill] final-reset 完成——本地库=HEAD 代码形态 seed 态（机器留净）');
}

// ═══════════════ CLI ═══════════════
function main() {
  const args = process.argv.slice(2);
  const modes = args.filter((a) => a.startsWith('--')).filter((a) => a !== '--confirm');
  const known = new Set(['--cutover', '--rollback', '--final-reset', '--confirm']);
  for (const flag of modes) {
    if (!known.has(flag)) { console.error(`未知旗标: ${flag}（禁静默忽略）\n用法：node scripts/drill-cutover.mjs --cutover|--rollback|--final-reset --confirm`); process.exit(2); }
  }
  if (modes.length !== 1) { console.error(`用法：node scripts/drill-cutover.mjs --cutover|--rollback|--final-reset --confirm（三模式择一）`); process.exit(2); }
  if (!args.includes('--confirm')) {
    console.error('REFUSED 缺 --confirm：本装置破坏性（reset/pg_restore/杀进程——库内数据确认丢弃；回退锚=backups/ 快照）。确认后重跑并附 --confirm');
    process.exit(1);
  }
  timing.mode = modes[0].slice(2);
  const runMode = { cutover: modeCutover, rollback: modeRollback, 'final-reset': modeFinalReset }[timing.mode];
  runMode().catch(async (e) => {
    console.error(`DRILL FAIL(${timing.mode}): ${e.message}`);
    for (const name of [...procs.keys()]) await stopService(name).catch(() => {});
    process.exit(1);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
