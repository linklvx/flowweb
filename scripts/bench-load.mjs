#!/usr/bin/env node
// scripts/bench-load.mjs —— Y1c T33 负载基准装置（plan :433-434；spec v5.4 §9.4 分轴/分档）。
// 本地实弹 CLI 断言装置（drill-fault.mjs 同族形态：自拉 API+provider 驱动+分段落盘+超时上界）。
// 七场景（BENCH_SCENARIOS）：
//   cold-load         10k 节点冷加载（TTL 驱逐→重连：服务端装载/客户端 synced/read model 首屏分轴）
//   mixed-payload     8MiB 混合（传输/解码/fsync/apply/PG 批/投影分轴+apply_replay_ms+echo_bytes）
//   concurrency       10 项目×10 连接真实并发（WAL fsync 放大/批延迟/feed 负载/可见节点隔离）
//   ss2-fanout        8MiB SS2×10 连接出站扇出/事件循环阻塞（OUTBOUND_BUDGET 96MiB 同口径）
//   backlog-isolation spoolHeadSeq-pgSeq 积压规模/持续时间+慢项目隔离（背压验证）
//   sustained-disk    长时间持续写入+磁盘接近上限（容量闸 fail-closed+恢复落定+完整性终检）
//   recovery-rto      kill→重启→ready+回灌归零（恢复 RTO 硬门实测）
// 用法：node scripts/bench-load.mjs --profile full|smoke --confirm [--out file] [--only scenario]
//   [--skip-build]（PR smoke=verify 链步；nightly/release 硬门=full——固定 runner 口径见 runbook §17）
// 破坏性（kill api/PG 触发器/容量注入）——--confirm 缺失=拒，exit 非 0 零副作用（drill 同律）。
// 分段落盘：每场景完成即 append 写 --out JSONL（防中断全丢——中断后已落场景可 salvage）。
// 错误率口径（v1.7）：仅 5xx/未处理异常/非预期 1011/数据断言失败计入；预期 close 码
//   4411/4412/4404/4406/4413 单列不计入（EXPECTED_CLOSE_CODES）；负载 5xx<0.1% 无超时雪崩。
import { execSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HARD_THRESHOLDS, decideLoadBenchVerdict, axisOf } from './lib/load-bench-verdict.mjs';

export const BENCH_SCENARIOS = [
  'cold-load', 'mixed-payload', 'concurrency', 'ss2-fanout',
  'backlog-isolation', 'sustained-disk', 'recovery-rto',
];

/** 两档 profile（PR smoke=装置自检微规模；nightly/release full=硬门实弹规模——spec §9.4「硬门固定 runner」）。 */
export const BENCH_PROFILES = {
  full: {
    coldNodes: 10_000, coldRounds: 5, coldSeedBatch: 100,          // 10k 节点（卡文）
    mixedTotalBytes: 8 * 1024 * 1024, mixedFrameBytes: 512 * 1024, mixedObservers: 3,
    concProjects: 10, concConns: 10, concWindowMs: 60_000, concFrameMs: 400,   // 10×10（卡文）
    fanoutConns: 10,                                                // 8MiB SS2×10=80.6MiB<96MiB 预算
    backlogWindowMs: 20_000, backlogSampleMs: 1_000,
    sustainedWindowMs: 120_000, sustainedFrameMs: 300, spoolCapacityBytes: 12 * 1024 * 1024,
    rtoWriteMs: 15_000, ttlMs: 5_000,
    timeoutMs: 45 * 60_000,   // 全局超时上界（45min——防长跑无界挂起）
  },
  smoke: {
    coldNodes: 500, coldRounds: 3, coldSeedBatch: 50,
    mixedTotalBytes: 512 * 1024, mixedFrameBytes: 128 * 1024, mixedObservers: 1,
    concProjects: 3, concConns: 3, concWindowMs: 15_000, concFrameMs: 400,
    fanoutConns: 3,
    backlogWindowMs: 10_000, backlogSampleMs: 1_000,
    sustainedWindowMs: 20_000, sustainedFrameMs: 500, spoolCapacityBytes: 2 * 1024 * 1024,
    rtoWriteMs: 6_000, ttlMs: 3_000,
    timeoutMs: 12 * 60_000,
  },
};

/** v1.7 错误率口径：预期 close 码五码单列不计入（1000/1001=正常关/going away 亦不计）。 */
export const EXPECTED_CLOSE_CODES = new Set([1000, 1001, 1005, 1006, 4411, 4412, 4404, 4406, 4413]);   // 1005=无码正常关（provider destroy）；1006=装置 SIGKILL 断连（sustained/rto 场景 taskkill 形态——真异常断连观测归服务端日志面）

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = path.join(ROOT, 'apps', 'api');
const requireApi = createRequire(path.join(API_DIR, 'package.json'));
const API_URL = 'http://127.0.0.1:3000';
const WS_URL = 'ws://127.0.0.1:3001';
const METRICS_URL = `${API_URL}/metrics`;
const BENCH_TOKEN = `t33-bench-${randomUUID()}`;   // WORKER_WRITE_TOKEN 注入值（exec-status/feed 观测+canvas worker 读径）
const BENCH_ADMIN_TOKEN = `t33-admin-${randomUUID()}`;   // COLLAB_ADMIN_TOKEN 注入值（/api/ready pending 全字段面——RTO 回灌归零判据）

function parseArgs(argv) {
  const out = { profile: 'full', confirm: false, skipBuild: false, out: '', only: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') out.confirm = true;
    else if (a === '--skip-build') out.skipBuild = true;
    else if (a === '--profile') out.profile = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--only') out.only = argv[++i];
    else throw new Error(`坏参数：${a}（用法 --profile full|smoke --confirm [--out file] [--only scenario] [--skip-build]）`);
  }
  if (!BENCH_PROFILES[out.profile]) throw new Error(`坏 profile：${out.profile}（full|smoke）`);
  if (out.only && !BENCH_SCENARIOS.includes(out.only)) throw new Error(`坏 --only：${out.only}（${BENCH_SCENARIOS.join('|')}）`);
  return out;
}
const OPTS = parseArgs(process.argv.slice(2));
const P = BENCH_PROFILES[OPTS.profile];

// env 读取（drill-fault readApiEnv/envOf 同形——零第三方依赖：根 scripts 无 dotenv 包，文本解析 apps/api/.env）
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

const isPortOpen = (port, host = '127.0.0.1') => new Promise((res) => {
  const s = net.connect({ port, host });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => { s.destroy(); res(false); });
});
async function waitFor(fn, timeoutMs, label, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fn();
    if (r) return r;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timeout 等待 ${label}（${timeoutMs}ms 上界）`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 长跑进程管理（drill-fault spawnService 同形） ──
const procs = new Map();
function spawnService(name, script, extraEnv = {}) {
  const logDir = path.join(ROOT, 'backups', 't33-logs');
  mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `${OPTS.profile}-${name}.log`);
  const child = spawn(process.execPath, [script], {
    cwd: API_DIR,
    env: { ...process.env, COLLAB_ROLE: 'all', NODE_ENV: 'development', MINIO_INIT: 'skip', WORKER_WRITE_TOKEN: BENCH_TOKEN, COLLAB_ADMIN_TOKEN: BENCH_ADMIN_TOKEN, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stream = createWriteStream(logFile, { flags: 'a' });
  const buf = { out: '' };
  const pipe = (chunk) => { const s = String(chunk); buf.out = (buf.out + s).slice(-400_000); stream.write(s); };
  child.stdout.on('data', pipe);
  child.stderr.on('data', pipe);
  child.on('exit', (code, signal) => { pipe(`[bench] ${name} 退出 code=${code} signal=${signal}\n`); procs.delete(name); });
  procs.set(name, { child, log: () => buf.out });
  console.log(`[bench] spawn ${name} pid=${child.pid} log=${logFile}`);
  return { child, log: () => buf.out };
}
function serviceLog(name) { return procs.get(name)?.log() ?? ''; }
async function stopService(name, timeoutMs = 20_000) {
  const entry = procs.get(name);
  if (!entry) return;
  if (process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${entry.child.pid}`, { stdio: 'ignore' }); } catch { /* 已退出 */ } }
  else { try { entry.child.kill('SIGKILL'); } catch { /* 已退出 */ } }
  await waitFor(() => (procs.has(name) ? false : 'done'), timeoutMs, `${name} 退出`).catch(() => { procs.delete(name); });
}
async function portKill(ports) {
  for (const port of ports) {
    if (!(await isPortOpen(port))) continue;
    if (process.platform !== 'win32') throw new Error(`端口 ${port} 被占且非 win32——人工清理后重跑（端口纪律：3000/3001/3002 独占窗）`);
    const out = execSync('netstat -ano', { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(new RegExp(`TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`));
      if (m) pids.add(m[1]);
    }
    for (const pid of pids) { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch { /* 竞态已退 */ } }
    await waitFor(async () => !(await isPortOpen(port)) ? 'done' : false, 15_000, `端口 ${port} 释放`);
  }
}
async function startApi(name = 'api', extraEnv = {}) {
  spawnService(name, 'dist/main.js', extraEnv);
  await waitFor(async () => {
    const r = await fetch(`${API_URL}/api/ready`).then((x) => x.json()).catch(() => null);
    return r?.ready === true ? 'done' : false;
  }, 90_000, `${name} ready`);
}
async function ensureBuilt() {
  if (OPTS.skipBuild || process.env.T33_SKIP_BUILD === '1') { console.log('[bench] 跳过构建（dist 假定新鲜）'); return; }
  const b1 = spawnSync('pnpm', ['--filter', '@flowweb/shared', 'build'], { cwd: ROOT, stdio: 'inherit', timeout: 300_000 });
  const b2 = spawnSync('pnpm', ['--filter', '@flowweb/api', 'build'], { cwd: ROOT, stdio: 'inherit', timeout: 600_000 });
  if (b1.status !== 0 || b2.status !== 0) throw new Error('构建失败（shared/api）');
}

// ── 错误率全局账（v1.7 口径——贯穿全程累积） ──
const ERR = {
  http5xx: 0, httpOps: 0, unhandledExceptions: 0, unexpectedClose1011: 0,
  dataAssertionFailures: 0, timeouts: 0, timedOps: 0,
  expectedCloseCodes: { 4411: 0, 4412: 0, 4404: 0, 4406: 0, 4413: 0 },
  logScan: { lastCount: -1 },   // api 日志未处理异常增量扫描游标（buffer 截断时保守全量重扫）
};
const UNHANDLED_RE = /uncaughtException|unhandledRejection|UnhandledPromiseRejection|未处理(?:的)?异常/g;
function scanApiLogForUnhandled() {
  const log = serviceLog('api');
  const cur = (log.match(UNHANDLED_RE) ?? []).length;
  const { lastCount } = ERR.logScan;
  ERR.unhandledExceptions += lastCount < 0 || cur < lastCount ? cur : cur - lastCount;   // 截断（cur<last）=保守按当前全量
  ERR.logScan.lastCount = cur;
}
function noteCloseCode(code) {
  if (code == null) return;
  if (code === 1011) { ERR.unexpectedClose1011 += 1; return; }
  if (EXPECTED_CLOSE_CODES.has(code)) { if (code in ERR.expectedCloseCodes) ERR.expectedCloseCodes[code] += 1; return; }
  ERR.dataAssertionFailures += 1;   // 其它非预期 close 码（非 1011 的意外形态）→断言失败账
  (ERR.unexpectedCloseCodeSamples ??= []).push(code);
}
function noteHttpStatus(status) {
  ERR.httpOps += 1;
  if (status >= 500) ERR.http5xx += 1;
}

// ── 客户端装置（drill-fault loadClientLibs/mkProvider 同族） ──
let LIBS = null;
function loadClientLibs() {
  if (LIBS) return LIBS;
  const WebSocket = requireApi('ws');
  const Y = requireApi('yjs');
  const { HocuspocusProvider } = requireApi('@hocuspocus/provider');
  const shared = requireApi('@flowweb/shared');
  LIBS = {
    WebSocket, Y, HocuspocusProvider, shared,
    CSV: shared.CLIENT_PROTOCOL_VERSION, SV: shared.CANVAS_DOC_SCHEMA_VERSION,
    WS_ORIGIN: (process.env.COLLAB_ALLOWED_ORIGINS?.split(',')[0]?.trim() || new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:5173').origin),
  };
  return LIBS;
}
const { killProviderLateReconnect } = requireApi('./scripts/lib/provider-late-reconnect-guard.js');
function destroyProvider(p) { try { p.destroy(); } catch { /* 已闭 */ } try { killProviderLateReconnect(p); } catch { /* 已净 */ } }
/** ws 层字节数据面（echo_bytes/SS2 扇出真值口径——doc 层对自身回声 no-op 不 emit update〔S1 契约
 *  行为，yjs 实证：全已知 update apply 零 update 事件〕，wire 层才是发送者回声流量的观测面）。 */
function mkWsSink() { return { downBytes: 0, msgCount: 0, _waiters: [] }; }
function wsSinkOnMessage(sink) {
  return (data) => {
    const bytes = data?.length ?? 0;
    sink.downBytes += bytes; sink.msgCount += 1;
    const waiters = sink._waiters; sink._waiters = [];
    for (const w of waiters) w(bytes);
  };
}
/** 等待下一条 ws 下行帧（发送者回声 wire 到达——同项目并发时=下一广播，观测面如实注明）。 */
function wsNextMessage(sink) {
  return new Promise((resolve) => { sink._waiters.push(resolve); });
}
function mkProvider({ token, projectId, document, onWsClose, wsSink }) {
  const { Y: Ylib, HocuspocusProvider: HP, WebSocket, CSV, SV, WS_ORIGIN } = loadClientLibs();
  const HeaderWs = class extends WebSocket {
    constructor(url) {
      super(url, { headers: { origin: WS_ORIGIN, cookie: `flowweb.session_token=${token}` } });
      this.on('error', () => {});
      if (onWsClose) this.on('close', (code) => onWsClose(code));
      if (wsSink) this.on('message', wsSinkOnMessage(wsSink));
    }
  };
  const q = [`csv=${CSV}`, `sv=${SV}`, 'cb=t33'];
  return new HP({
    url: `${WS_URL}?${q.join('&')}`, name: `project:${projectId}`,
    document: document ?? new Ylib.Doc(),
    WebSocketPolyfill: HeaderWs,
  });
}
function syncedOf(p, ms = 20_000) {
  ERR.timedOps += 1;
  return new Promise((res, rej) => {
    const t = setTimeout(() => { ERR.timeouts += 1; destroyProvider(p); rej(new Error('provider synced 超时')); }, ms);
    p.on('synced', () => { clearTimeout(t); res(); });
  });
}

// ── fixtures（drill makeFixtures 多项目扩展） ──
async function makeFixtures(prefix, projectCount) {
  const { PrismaClient } = requireApi('@prisma/client');
  const prisma = new PrismaClient();
  const ts = Date.now();
  const S = { prisma, user: `${prefix}-u-${ts}`, team: `${prefix}-t-${ts}`, member: `${prefix}-m-${ts}`,
    projects: Array.from({ length: projectCount }, (_, i) => `${prefix}-p${i}-${ts}`),
    token: `t33-tok-${randomUUID()}`, prefix };
  await prisma.user.create({ data: { id: S.user, name: `bench-${ts}`, email: `bench-${ts}@example.invalid`, emailVerified: false } });
  await prisma.team.create({ data: { id: S.team, name: `bench-${ts}`, ownerId: S.user } });
  await prisma.teamMember.create({ data: { id: S.member, teamId: S.team, userId: S.user, role: 'MEMBER' } });
  await prisma.canvasProject.createMany({ data: S.projects.map((id) => ({ id, name: `bench-${id}`, teamId: S.team })) });
  await prisma.session.create({ data: { id: `t33-s-${ts}`, userId: S.user, token: S.token, expiresAt: new Date(Date.now() + 120 * 60_000) } });
  return S;
}
async function cleanupFixtures(S) {
  const order = [
    () => S.prisma.maintenanceOperation.deleteMany({ where: { projectId: { in: S.projects } } }),
    () => S.prisma.session.deleteMany({ where: { userId: S.user } }),
    () => S.prisma.teamMember.deleteMany({ where: { id: S.member } }),
    () => S.prisma.canvasProject.deleteMany({ where: { id: { in: S.projects } } }),
    () => S.prisma.team.deleteMany({ where: { id: S.team } }),
    () => S.prisma.user.deleteMany({ where: { id: S.user } }),
  ];
  for (const del of order) await del().catch((e) => console.log(`[bench] SMOKE-WARN 清理失败: ${e.message}`));
  await S.prisma.$disconnect();
}

// ── metrics 采集器（prometheus 文本解析——runbook §9 桶上界分位口径同算法） ──
async function fetchMetricsText() {
  const res = await fetch(METRICS_URL);
  noteHttpStatus(res.status);
  return res.text();
}
function parseGauge(text, name) {
  const m = text.match(new RegExp(`^${name}(?:\\{[^}]*\\})?\\s+([0-9.eE+-]+)`, 'm'));
  return m ? Number(m[1]) : null;
}
function parseHistogram(text, name) {
  // → { buckets: [{le, count}], sum, count }（prom-client 文本形态：name_bucket{le=".."} c / name_sum / name_count）
  const buckets = [];
  const reB = new RegExp(`^${name}_bucket\\{(?:[^}]*,)?le="([^"]+)"[^}]*\\}[ \\t]+([0-9.eE+-]+)[ \\t]*\\r?$`, 'gm');   // (?:[^}]*,)?=le 恰为首 label 或前有逗号（role= 尾部 le= 不误配）；\r?$=CRLF 容忍
  let m; while ((m = reB.exec(text)) !== null) buckets.push({ le: m[1] === '+Inf' ? Infinity : Number(m[1]), count: Number(m[2]) });
  const sum = parseGauge(text, `${name}_sum`);
  const count = parseGauge(text, `${name}_count`);
  return { buckets, sum, count };
}
/** 直方图窗口差分位（桶上界口径——runbook §9：p95=累计首达 p×n 的桶上界，无插值）。 */
function histDeltaPercentile(before, after, p) {
  if (!before?.buckets?.length || !after?.buckets?.length) return null;
  const totalDelta = after.count - before.count;
  if (totalDelta <= 0) return null;
  const target = (p / 100) * totalDelta;
  for (const b of after.buckets) {
    const prev = before.buckets.find((x) => x.le === b.le)?.count ?? 0;
    if (b.count - prev >= target) return b.le === Infinity ? (after.buckets[after.buckets.length - 2]?.le ?? null) : b.le;
  }
  return null;
}
function histDelta(before, after) {
  if (!before?.buckets?.length || !after?.buckets?.length) return { p50: null, p95: null, p99: null, count: null, sumDelta: null };
  return {
    p50: histDeltaPercentile(before, after, 50),
    p95: histDeltaPercentile(before, after, 95),
    p99: histDeltaPercentile(before, after, 99),
    count: after.count != null && before.count != null ? after.count - before.count : null,
    sumDelta: after.sum != null && before.sum != null ? after.sum - before.sum : null,
  };
}
/** 资源采样（RSS/CPU 核均/事件循环/水位/spool——PG 锁等待经 withPg 采样）。 */
async function resourceSample(cpuBaseline) {
  const text = await fetchMetricsText();
  return {
    at: Date.now(),
    rss: parseGauge(text, 'process_resident_memory_bytes'),
    cpuSeconds: parseGauge(text, 'process_cpu_seconds_total'),
    eventLoopLagSeconds: parseGauge(text, 'event_loop_lag_seconds'),
    docPgLagSeq: parseGauge(text, 'doc_pg_lag_seq'),
    walPendingBytes: parseGauge(text, 'wal_pending_bytes'),
    spoolBytes: parseGauge(text, 'yjs_spool_depth_bytes'),
    outboundQueuedBytes: parseGauge(text, 'yjs_outbound_queued_bytes'),
    budgetCloseTotal: parseGauge(text, 'collab_outbound_budget_close_total'),
    slowConsumerTotal: parseGauge(text, 'collab_slow_consumer_disconnect_total'),
    spoolCapacityTotal: parseGauge(text, 'yjs_spool_capacity_total'),
    loadedDocs: parseGauge(text, 'yjs_loaded_documents'),
    connectionCount: parseGauge(text, 'yjs_connection_count'),
    _text: text,
  };
}
async function withPg(fn, applicationName = 't33-bench') {
  const { PrismaClient } = requireApi('@prisma/client');
  const dsn = loadDatabaseUrl();
  const prisma = new PrismaClient({ datasources: { db: { url: `${dsn}${dsn.includes('?') ? '&' : '?'}application_name=${applicationName}` } } });
  try { return await fn(prisma); } finally { await prisma.$disconnect(); }
}
/** PG 锁等待采样（pg_stat_activity——「PG 锁等待」分轴的观测面；interval 经 SQL 侧 EXTRACT 折 ms
 *  （Prisma $queryRaw 不支持 interval 列反序列化）。 */
async function pgLockWaitMs() {
  return withPg(async (p) => {
    const rows = await p.$queryRawUnsafe(`SELECT coalesce(max(EXTRACT(EPOCH FROM (now() - query_start)) * 1000), 0)::float8 AS max_wait_ms FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`);
    const ms = rows?.[0]?.max_wait_ms;
    return typeof ms === 'number' ? Math.round(ms) : 0;
  });
}

// ── 场景公共：帧写入器与回声测量 ──
/** 本地写入 marker（回声判定锚：远端帧 apply origin=provider 实例〔y-protocols sync.js:84 传参
 *  provider〕非字符串——本地 transact marker 与 provider 实例可判；origin===BENCH_LOCAL=本地跳过）。 */
const BENCH_LOCAL = 'bench-local';
/** 单连接写一帧并测「发送→本端回声到达」RTT+回声字节（echo 口径=发送者收到自身 update 广播；
 *  同项目多连接并发时=写后首个广播到达（含他连接帧——RTT 观测面如实注明，装置口径）。 */
function frameWriteWithEcho(doc, payloadFn, wsSink = null) {
  // ws wire 层口径：发送→下一条下行 ws message（发送者回声 wire 到达；doc 层对自身回声=no-op 零事件——S1 契约）。
  // 无 wsSink 时退化为 doc 层（他连接帧到达观测——observer/并发面）。超时上界 20s（防单帧挂死全场景）。
  return new Promise((resolve, reject) => {
    ERR.timedOps += 1;
    const t0 = Date.now();
    const timer = setTimeout(() => { ERR.timeouts += 1; cleanup(); resolve({ rttMs: null, echoBytes: 0, timedOut: true }); }, 20_000);
    const onWire = (bytes) => { cleanup(); resolve({ rttMs: Date.now() - t0, echoBytes: bytes }); };
    const onUpdate = (update, origin) => {
      if (origin === BENCH_LOCAL) return;   // 本地事务回环跳过——远端 apply origin=provider 实例
      cleanup();
      resolve({ rttMs: Date.now() - t0, echoBytes: update?.byteLength ?? update?.length ?? 0 });
    };
    function cleanup() {
      clearTimeout(timer);
      if (wsSink) { const i = wsSink._waiters.indexOf(onWire); if (i >= 0) wsSink._waiters.splice(i, 1); }
      else doc.off('update', onUpdate);
    }
    if (wsSink) wsSink._waiters.push(onWire); else doc.on('update', onUpdate);
    try { payloadFn(); } catch (e) { cleanup(); reject(e); }
  });
}
/** T15 合法容器形态节点：textInput{data: lww 标量+prompt: map{text:Y.Text}}（Y.Text 唯一合法域=
 *  节点 data.prompt 容器——顶层 texts map 等非法域被 actor 准入链拒 frame-malformed，实测实证）。 */
function mkNodeMap(Ylib, id, kind = 'textInput') {
  const data = new Ylib.Map();
  data.set('model', `t33-${kind}-${id}`);
  if (kind === 'textInput') {
    const promptText = new Ylib.Text();
    const prompt = new Ylib.Map();
    prompt.set('text', promptText);
    data.set('prompt', prompt);
  }
  const m = new Ylib.Map();
  m.set('type', kind);
  m.set('data', data);
  return m;
}

// ══ 场景实现 ══

/** 场景 1：10k 节点冷加载（TTL 驱逐→重连分轴）。 */
async function scenarioColdLoad(S, state) {
  const { Y: Ylib, shared } = loadClientLibs();
  const pid = S.projects[0];
  const nodes = P.coldNodes;
  console.log(`[bench] cold-load：建种 ${nodes} 节点（批 ${P.coldSeedBatch}/帧）`);
  const seedDoc = new Ylib.Doc();
  const seeder = mkProvider({ token: S.token, projectId: pid, document: seedDoc });
  await syncedOf(seeder);
  const nmap = seedDoc.getMap('nodes');
  for (let i = 0; i < nodes; i += P.coldSeedBatch) {
    seedDoc.transact(() => {
      for (let j = i; j < Math.min(i + P.coldSeedBatch, nodes); j++) nmap.set(`n${j}`, mkNodeMap(Ylib, `n${j}`));
    }, BENCH_LOCAL);
    await sleep(30);   // 批间节流——帧闸 512KB/批安全
  }
  const seededKeys = nmap.size;
  destroyProvider(seeder);
  await sleep(P.ttlMs + 4_000);   // TTL 驱遣窗（sweep 兜底）

  const coldConnect = [], coldReadModel = [], coldTotal = [];
  let serverLoadP95Sum = 0;
  for (let round = 0; round < P.coldRounds; round++) {
    await waitFor(async () => (await resourceSample()).loadedDocs === 0 ? 'done' : false, P.ttlMs + 20_000, `round${round} 驱逐确认`).catch(() => { /* sweep 慢则如实继续——装载计时不受影响（未驱逐=装载命中缓存，计数注记） */ });
    const beforeText = await fetchMetricsText();
    const loadHistBefore = parseHistogram(beforeText, 'yjs_load_duration_seconds');
    const doc = new Ylib.Doc();
    const t0 = Date.now();
    const p = mkProvider({ token: S.token, projectId: pid, document: doc });
    await syncedOf(p, 60_000);
    const tSynced = Date.now();
    const rm = shared.toReadModel(doc);   // 客户端首屏 read model 转换（shared 单源）
    const tRead = Date.now();
    if (Object.keys(rm.nodes ?? {}).length !== nodes) {
      ERR.dataAssertionFailures += 1;
      throw new Error(`冷加载节点数断言失败：read model=${Object.keys(rm.nodes ?? {}).length} ≠ ${nodes}`);
    }
    coldConnect.push(tSynced - t0); coldReadModel.push(tRead - tSynced); coldTotal.push(tRead - t0);
    const loadHistAfter = parseHistogram(await fetchMetricsText(), 'yjs_load_duration_seconds');
    const deltaP95 = histDeltaPercentile(loadHistBefore, loadHistAfter, 95);
    if (deltaP95 != null) serverLoadP95Sum += deltaP95 * 1000;
    destroyProvider(p);
    await sleep(P.ttlMs + 4_000);
  }
  state.axes.coldLoad = { ...axisOf(coldTotal), unit: 'ms', connectP: axisOf(coldConnect), readModelP: axisOf(coldReadModel),
    serverLoadP95Ms: coldTotal.length ? Math.round(serverLoadP95Sum / coldTotal.length) : null,
    docNodeCount: nodes, visibleNodeCount: nodes };   // 可见节点=文档总量同值登记（culling 面归 concurrency 场景隔离断言）
  state.invariants.seededKeys = { pass: seededKeys === nodes, detail: `种子键 ${seededKeys}/${nodes}` };
}

/** 场景 2：8MiB 混合载荷（fsync/apply/PG 批/投影+apply_replay_ms+echo_bytes）。 */
async function scenarioMixedPayload(S, state) {
  const { Y: Ylib } = loadClientLibs();
  const pid = S.projects[1];
  const doc = new Ylib.Doc();
  const writerSink = mkWsSink();
  const writer = mkProvider({ token: S.token, projectId: pid, document: doc, wsSink: writerSink });
  await syncedOf(writer);
  const observers = [];
  const obsSinks = [];
  for (let i = 0; i < P.mixedObservers; i++) {
    const od = new Ylib.Doc();
    const sink = mkWsSink();
    const op = mkProvider({ token: S.token, projectId: pid, document: od, wsSink: sink });
    observers.push({ p: op, doc: od });
    obsSinks.push(sink);
    await syncedOf(op);
  }
  const frames = Math.ceil(P.mixedTotalBytes / P.mixedFrameBytes);
  const rttSamples = []; const applyConfirmSamples = []; let inboundBytes = 0;
  const nmap = doc.getMap('nodes');
  // 大文本域=首节点 prompt 容器（T15 合法域——Y.Text 禁顶层 map，实测 frame-malformed 拒）
  const mainNode = mkNodeMap(Ylib, 'mix-main');
  nmap.set('mix-main', mainNode);
  const text = mainNode.get('data').get('prompt').get('text');
  let nodeSeq = 0;
  const chunk = 'x'.repeat(1024);
  const fsyncBefore = parseHistogram(await fetchMetricsText(), 'wal_fsync_latency');
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    const targetBytes = Math.min(P.mixedFrameBytes, P.mixedTotalBytes - inboundBytes);
    const frameT0 = Date.now();
    // 双口径：writer ws 回声（wire 到达=fsync+apply+广播完成）+observer doc apply 确认（新内容必 emit update——S1 契约下发送者侧 no-op 零事件）
    const obsDoc = observers[0].doc;
    const applyP = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 20_000);
      const onUpdate = () => { clearTimeout(timer); obsDoc.off('update', onUpdate); resolve(Date.now()); };
      obsDoc.on('update', onUpdate);
    });
    const approx = await frameWriteWithEcho(doc, () => {
      doc.transact(() => {
        // 混合载荷：Y.Text 增量（半）+节点创建（四分之一）+节点删除交替（四分之一）——合法域形态。
        // 注：同事务「text insert+model 属性变更」组合被 shared frame-deny 判 value-type 拒（L2 键级
        // walk 形态——真实 UI 面 text 编辑与 model 变更本就分事务，装置不做该人为组合）。
        text.insert(text.length ?? 0, chunk.repeat(Math.ceil(targetBytes / 2048)));
        for (let k = 0; k < Math.ceil(targetBytes / 16384); k++) nmap.set(`mn${++nodeSeq}`, mkNodeMap(Ylib, `mn${nodeSeq}`));
        if (f % 2 === 1) for (let k = 0; k < Math.ceil(targetBytes / 8192); k++) { const key = `mn${Math.max(1, nodeSeq - 12 - k)}`; if (nmap.get(key)) nmap.delete(key); }
      }, BENCH_LOCAL);
    }, writerSink);
    const applyAt = await applyP;
    if (approx.rttMs != null) rttSamples.push(approx.rttMs);
    if (applyAt != null) applyConfirmSamples.push(applyAt - frameT0);
    inboundBytes += targetBytes;
  }
  const writeWindowMs = Date.now() - t0;
  const fsyncAfter = parseHistogram(await fetchMetricsText(), 'wal_fsync_latency');
  const fsyncDelta = histDelta(fsyncBefore, fsyncAfter);

  // PG 批归零时延（spoolHeadSeq-pgSeq 积压排空面）+save barrier p95
  const barrierSamples = [];
  const barrierNonce = randomUUID();
  for (let i = 0; i < 5; i++) {
    ERR.timedOps += 1;
    const ms = await new Promise((resolve) => {
      const tSend = Date.now();
      const timer = setTimeout(() => { ERR.timeouts += 1; resolve(null); }, 15_000);
      const onStateless = (ev) => { const payload = ev?.payload ?? ev;   // provider 事件形={payload}（esm: this.emit('stateless',{payload})）
        try {
          const body = JSON.parse(typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8'));
          if (body?.nonce === barrierNonce) { clearTimeout(timer); writer.off('stateless', onStateless); resolve(Date.now() - tSend); }
        } catch { /* 非 JSON stateless 忽略 */ }
      };
      writer.on('stateless', onStateless);
      writer.sendStateless(JSON.stringify({ nonce: barrierNonce, clientSeq: 1 + i, sessionEpoch: 1 }));   // T5a 冻结 wire 形态 {nonce,clientSeq,sessionEpoch}（canvasCollabRuntime 同款）
    });
    if (ms != null) barrierSamples.push(ms);
  }
  // 投影读径（worker 通道 canvas 读端点——render model 投影面）
  const projSamples = [];
  for (let i = 0; i < 5; i++) {
    const tRead = Date.now();
    const res = await fetch(`${API_URL}/api/collab/doc/${pid}/canvas`, { headers: { authorization: `Bearer ${BENCH_TOKEN}` } });
    noteHttpStatus(res.status);
    await res.arrayBuffer();
    if (res.ok) projSamples.push(Date.now() - tRead);
  }
  for (const { p: op } of observers) destroyProvider(op);
  destroyProvider(writer);

  const echoBytes = writerSink.downBytes + obsSinks.reduce((a, s) => a + s.downBytes, 0);   // echo=项目全连接 ws 下行字节（发送者回声 wire 真值——doc 层 no-op 不可见）
  state.axes.applyReplay = {
    ...axisOf(applyConfirmSamples), unit: 'ms',
    why: '装置口径=writer 发送→observer doc apply 确认 RTT（新内容必 emit update；主体=gate pre-apply+fsync+广播——库内幂等重放成本 spec §9.3 apply_replay_ms 的装置代理观测）',
    wireEchoP: axisOf(rttSamples),
  };
  state.axes.echo = { bytes: echoBytes, inboundBytes, fanoutCeiling: 1 + P.mixedObservers };
  state.axes.mixedFsync = { ...fsyncDelta, unit: 'ms(p50/p95/p99),count,sum' };
  state.axes.saveBarrier = { ...axisOf(barrierSamples), unit: 'ms' };
  state.axes.projectionRead = { ...axisOf(projSamples), unit: 'ms' };
  state.axes.mixedThroughput = { bytes: inboundBytes, windowMs: writeWindowMs, bytesPerSec: Math.round(inboundBytes / (writeWindowMs / 1000)) };
  state.invariants.mixedConvergence = { pass: applyConfirmSamples.length === frames && rttSamples.length === frames, detail: `apply 确认 ${applyConfirmSamples.length}/${frames}+wire 回声 ${rttSamples.length}/${frames}` };
}

/** 场景 3：10 项目×10 连接真实并发（fsync 放大/feed 负载/可见节点隔离/PG 锁等待）。 */
async function scenarioConcurrency(S, state) {
  const { Y: Ylib } = loadClientLibs();
  const { mintWorkerScopeToken } = requireApi('./dist/modules/collab/worker-scope-token.js');
  const projects = S.projects.slice(2, 2 + P.concProjects);
  const allRtt = [];
  const crossProjectLeak = { count: 0 };
  console.log(`[bench] concurrency：${P.concProjects} 项目×${P.concConns} 连接 × ${P.concWindowMs}ms 窗`);
  // 连接建立：项目间并行+项目内串行（同项目多连接并发首连实测 SS2 不达——TTL 驱逐/装载竞态面；
  // 项目间并行保吞吐，项目内串行避同项目装载竞态）
  const conns = [];
  await Promise.all(projects.map(async (pid) => {
    const otherPrefixes = projects.filter((x) => x !== pid);
    for (let c = 0; c < P.concConns; c++) {
      const doc = new Ylib.Doc();
      doc.on('update', (_u, origin) => {
        if (origin === BENCH_LOCAL) return;
        // 可见节点 culling 断言面：本端 doc 出现其它项目域节点键=跨项目广播泄漏
        for (const k of doc.getMap('nodes').keys()) if (otherPrefixes.some((x) => k.startsWith(`${x}-`))) crossProjectLeak.count += 1;
      });
      const sink = mkWsSink();
      const p = mkProvider({ token: S.token, projectId: pid, document: doc, onWsClose: noteCloseCode, wsSink: sink });
      await syncedOf(p, 45_000);
      conns.push({ p, doc, sink, pid, prefix: `${pid}-${c}-`, seq: 0 });
    }
  }));
  const fsyncBefore = parseHistogram(await fetchMetricsText(), 'wal_fsync_latency');
  const storeBytesBefore = parseHistogram(await fetchMetricsText(), 'yjs_store_payload_bytes');
  const cpuBefore = await resourceSample();
  const resSamples = []; const lockSamples = []; const feedLagSamples = [];
  const t0 = Date.now();
  const stopAt = t0 + P.concWindowMs;
  const writers = conns.map((c) => (async () => {
    while (Date.now() < stopAt) {
      const rtt = await frameWriteWithEcho(c.doc, () => {
        c.doc.transact(() => {
          c.seq += 1;
          const key = `${c.prefix}${c.seq}`;
          c.doc.getMap('nodes').set(key, mkNodeMap(Ylib, key));
        }, BENCH_LOCAL);
      }, c.sink);
      if (rtt.rttMs != null) allRtt.push(rtt.rttMs);
      await sleep(P.concFrameMs);
    }
  })());
  const sampler = (async () => {
    let cpuPrev = cpuBefore;
    while (Date.now() < stopAt) {
      await sleep(5_000);
      const s = await resourceSample();
      const cores = os.cpus().length || 4;
      const cpuDelta = s.cpuSeconds != null && cpuPrev.cpuSeconds != null ? s.cpuSeconds - cpuPrev.cpuSeconds : 0;
      const wall = (s.at - cpuPrev.at) / 1000;
      resSamples.push({ rss: s.rss, cpuPercent: wall > 0 ? (cpuDelta / wall / cores) * 100 : null, eventLoopLagSeconds: s.eventLoopLagSeconds, docPgLagSeq: s.docPgLagSeq, walPendingBytes: s.walPendingBytes });
      cpuPrev = s;
      lockSamples.push(await pgLockWaitMs());
    }
  })();
  const feedProber = (async () => {
    const pidFeed = projects[0];
    const nodeId = `${projects[0]}-feed-probe`;
    let probeSeq = 0;
    while (Date.now() < stopAt) {
      await sleep(8_000);
      try {
        const scope = mintWorkerScopeToken(BENCH_TOKEN, pidFeed, {});
        const baselineResp = await fetch(`${API_URL}/api/collab/runtime-feed/${pidFeed}/events?after=0&limit=1`, { headers: { cookie: `flowweb.session_token=${S.token}` } });
        noteHttpStatus(baselineResp.status);
        const baselineBody = await baselineResp.json().catch(() => null);
        const baselineLatest = BigInt(baselineBody?.data?.latestFeedSeq ?? baselineBody?.latestFeedSeq ?? '0');   // TransformInterceptor {code,data} 包装——data 层优先
        const tPost = Date.now();
        const res = await fetch(`${API_URL}/api/collab/doc/exec-status`, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${BENCH_TOKEN}`, 'x-worker-scope': scope },
          body: JSON.stringify({ projectId: pidFeed, nodeId, patch: { status: 'running', attempts: 1, errorCode: `t33-probe-${tPost}` } }),   // probe 标记走 errorCode 键域（probeAt 非键域）
        });
        noteHttpStatus(res.status);
        if (res.ok) {
          ERR.timedOps += 1;
          probeSeq += 1;
          // feed lag=事件写入→HTTP events 端点可拉取（游标可见性；匹配口径=事件计数增长——probe 前
          // 采基线，增长即该 probe 事件可见〔payload 键形态不进判定——形态漂移不影响 lag 轴〕）
          const visible = await waitFor(async () => {
            const r = await fetch(`${API_URL}/api/collab/runtime-feed/${pidFeed}/events?after=0&limit=1`, { headers: { cookie: `flowweb.session_token=${S.token}` } });
            noteHttpStatus(r.status);
            const body = await r.json().catch(() => null);
            const latest = body?.data?.latestFeedSeq ?? body?.latestFeedSeq;
            return typeof latest === 'string' && BigInt(latest) > baselineLatest ? 'done' : false;
          }, 20_000, `feed probe ${tPost} 可见`).catch((e) => { console.log(`[bench] feed 可见性等待异常：${e?.message ?? e}`); return null; });
          if (visible) feedLagSamples.push(Date.now() - tPost);
          else ERR.timeouts += 1;
        } else {
          const bodyText = await res.text().catch(() => '');
          console.log(`[bench] feed prober 非 2xx：${res.status} ${bodyText.slice(0, 220)}`);
        }
      } catch { /* 连接层失败不计 op（非服务端响应） */ }
    }
  })();
  await Promise.all([...writers, sampler, feedProber]);
  const windowMs = Date.now() - t0;
  const fsyncAfter = parseHistogram(await fetchMetricsText(), 'wal_fsync_latency');
  const storeBytesAfter = parseHistogram(await fetchMetricsText(), 'yjs_store_payload_bytes');
  const fsyncDelta = histDelta(fsyncBefore, fsyncAfter);

  // 收敛不变量：每项目 doc 节点键集在各连接一致（取每项目首连接为权威，比对末连接）
  let convergence = true;
  for (const pid of projects) {
    const mine = conns.filter((c) => c.pid === pid);
    if (!mine.length) { convergence = false; continue; }
    const keysA = [...mine[0].doc.getMap('nodes').keys()].sort();
    const keysB = [...mine[mine.length - 1].doc.getMap('nodes').keys()].sort();
    if (keysA.length === 0 || JSON.stringify(keysA) !== JSON.stringify(keysB)) convergence = false;
  }
  for (const c of conns) destroyProvider(c.p);
  await sleep(500);

  state.axes.concurrency = { ...axisOf(allRtt), unit: 'ms', conns: conns.length, windowMs };
  state.axes.walFsync = { ...fsyncDelta, unit: 'ms(p50/p95/p99),count,sum', fsyncPerSec: fsyncDelta.count != null ? +(fsyncDelta.count / (windowMs / 1000)).toFixed(1) : null, storeBytesDelta: storeBytesAfter.sum - storeBytesBefore.sum };
  state.axes.feedLag = { ...axisOf(feedLagSamples), unit: 'ms' };
  state.axes.resources = {
    rssMaxBytes: Math.max(...resSamples.map((s) => s.rss ?? 0)),
    cpuMaxPercent: Math.round(Math.max(...resSamples.map((s) => s.cpuPercent ?? 0))),
    eventLoopLagMaxMs: Math.round((Math.max(...resSamples.map((s) => s.eventLoopLagSeconds ?? 0))) * 1000),
    pgLockWaitMaxMs: Math.round(Math.max(...lockSamples, 0)),
    docPgLagSeqMax: Math.max(...resSamples.map((s) => s.docPgLagSeq ?? 0)),
  };
  state.invariants.crossProjectIsolation = { pass: crossProjectLeak.count === 0, detail: `跨项目广播泄漏 ${crossProjectLeak.count} 帧` };
  state.invariants.convergence = { pass: convergence, detail: `${projects.length} 项目各连接键集一致` };
}

/** 场景 4：8MiB SS2×10 连接出站扇出/事件循环阻塞（OUTBOUND_BUDGET 96MiB 同口径）。 */
async function scenarioSs2Fanout(S, state) {
  const { Y: Ylib, WebSocket } = loadClientLibs();
  const pid = S.projects[2 + P.concProjects];
  // 建种 ~8MiB（mixed 同形）
  const total = P.mixedTotalBytes;
  const seedDoc = new Ylib.Doc();
  const seedSink = mkWsSink();
  const seeder = mkProvider({ token: S.token, projectId: pid, document: seedDoc, wsSink: seedSink });
  await syncedOf(seeder);
  const fanMain = mkNodeMap(Ylib, 'fan-main');
  seedDoc.getMap('nodes').set('fan-main', fanMain);
  const text = fanMain.get('data').get('prompt').get('text');   // T15 合法域（节点 prompt 容器）
  const chunk = 'y'.repeat(1024);
  const perFrame = 512 * 1024;
  for (let b = 0; b < Math.ceil(total / perFrame); b++) {
    await frameWriteWithEcho(seedDoc, () => seedDoc.transact(() => { text.insert(text.length ?? 0, chunk.repeat(perFrame / 2048)); }, BENCH_LOCAL), seedSink);
  }
  destroyProvider(seeder);
  await sleep(P.ttlMs + 5_000);

  const base = await resourceSample();
  const loopLagSeries = [];
  let fanoutDone = false;
  const lagSampler = (async () => {
    while (!fanoutDone) {
      await sleep(200);
      const s = await resourceSample();
      loopLagSeries.push(s.eventLoopLagSeconds);
    }
  })();
  // SS2 下行字节口径=ws message 帧字节（初始全量同步不走客户端 update 事件——ws 帧量才是真出站面；mkProvider wsSink 同源）
  const sink = mkWsSink();
  const observers = [];
  const t0 = Date.now();
  for (let i = 0; i < P.fanoutConns; i++) {
    observers.push(mkProvider({ token: S.token, projectId: pid, document: new Ylib.Doc(), onWsClose: noteCloseCode, wsSink: sink }));
  }
  await Promise.all(observers.map((op) => syncedOf(op, 90_000)));
  const fanoutMs = Date.now() - t0;
  fanoutDone = true;
  await sleep(1_000);
  const after = await resourceSample();
  for (const op of observers) destroyProvider(op);
  await lagSampler;

  const budgetBytes = 100_663_296;   // OUTBOUND_BUDGET_BYTES=96MiB 同口径（collab-limits 单源值——本处仅扇出对账）
  state.axes.ss2Fanout = {
    conns: P.fanoutConns, outboundBytes: sink.downBytes, fanoutMs,
    perConnSyncedMs: Math.round(fanoutMs),   // 并发建立窗（≈最慢连接 synced——串行化扇出形态如实另报 fanoutMs）
    outboundBudgetBytes: budgetBytes,
    budgetUtilization: +(sink.downBytes / budgetBytes).toFixed(3),
    eventLoopLagMaxMs: Math.round((Math.max(0, ...loopLagSeries)) * 1000),
    budgetCloseDelta: (after.budgetCloseTotal ?? 0) - (base.budgetCloseTotal ?? 0),
    slowConsumerDisconnectDelta: (after.slowConsumerTotal ?? 0) - (base.slowConsumerTotal ?? 0),
  };
  state.invariants.outboundBudget = {
    pass: sink.downBytes <= budgetBytes && (after.budgetCloseTotal ?? 0) - (base.budgetCloseTotal ?? 0) === 0,
    detail: `出站 ${sink.downBytes}B/${(budgetBytes / 1048576).toFixed(0)}MiB 预算+close 事件 delta=${(after.budgetCloseTotal ?? 0) - (base.budgetCloseTotal ?? 0)}`,
  };
}

/** 场景 5：spoolHeadSeq-pgSeq 积压+慢项目隔离（背压验证——PG 触发器滞留档）。 */
async function scenarioBacklogIsolation(S, state) {
  const { Y: Ylib } = loadClientLibs();
  const normalPid = S.projects[3 + P.concProjects];
  const slowPid = S.projects[4 + P.concProjects];
  // PG 触发器：slow 项目 CanvasDocUpdate INSERT 拒（T31 y31_drill_block 同形——PG 批滞留=确定性背压注入）
  const dropBlockTrigger = () => withPg(async (p) => { await p.$executeRawUnsafe('DROP TRIGGER IF EXISTS y33_bench_block_trg ON "CanvasDocUpdate"'); await p.$executeRawUnsafe('DROP FUNCTION IF EXISTS y33_bench_block()'); });
  await withPg(async (p) => {
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION y33_bench_block() RETURNS trigger AS $fn$ BEGIN IF NEW."projectId" = '${slowPid}' THEN RAISE EXCEPTION 't33 bench backlog block'; END IF; RETURN NEW; END $fn$ LANGUAGE plpgsql`);
    await p.$executeRawUnsafe('DROP TRIGGER IF EXISTS y33_bench_block_trg ON "CanvasDocUpdate"');
    await p.$executeRawUnsafe('CREATE TRIGGER y33_bench_block_trg BEFORE INSERT ON "CanvasDocUpdate" FOR EACH ROW EXECUTE FUNCTION y33_bench_block()');
  });
  const mkConn = async (pid) => {
    const doc = new Ylib.Doc();
    const sink = mkWsSink();
    const p = mkProvider({ token: S.token, projectId: pid, document: doc, onWsClose: noteCloseCode, wsSink: sink });
    await syncedOf(p);
    return { p, doc, sink, pid };
  };
  const normal = await mkConn(normalPid);
  const slow = await mkConn(slowPid);
  const normalRtt = []; const slowRtt = [];
  const backlogSeries = [];
  const t0 = Date.now();
  const stopAt = t0 + P.backlogWindowMs;
  const normalW = (async () => { let seq = 0; while (Date.now() < stopAt) { const r = await frameWriteWithEcho(normal.doc, () => { normal.doc.transact(() => { seq += 1; const k = `bk-n${seq}`; normal.doc.getMap('nodes').set(k, mkNodeMap(Ylib, k)); }, BENCH_LOCAL); }, normal.sink); if (r.rttMs != null) normalRtt.push(r.rttMs); await sleep(300); } })();
  const slowW = (async () => { let seq = 0; while (Date.now() < stopAt) { const r = await frameWriteWithEcho(slow.doc, () => { slow.doc.transact(() => { seq += 1; const k = `bk-s${seq}`; slow.doc.getMap('nodes').set(k, mkNodeMap(Ylib, k)); }, BENCH_LOCAL); }, slow.sink); if (r.rttMs != null) slowRtt.push(r.rttMs); await sleep(300); } })();
  const sampler = (async () => { while (Date.now() < stopAt) { const s = await resourceSample(); backlogSeries.push({ at: Date.now(), docPgLagSeq: s.docPgLagSeq, walPendingBytes: s.walPendingBytes }); await sleep(P.backlogSampleMs); } })();
  try {
    await Promise.all([normalW, slowW, sampler]);
  } finally {
    // 撤触发器（finally——场景失败早退不得残留滞留注入污染后续场景）
    await dropBlockTrigger().catch(() => {});
    destroyProvider(normal.p); destroyProvider(slow.p);
  }
  // 积压排空窗（持续时间轴）
  const drainStart = Date.now();
  const drained = await waitFor(async () => { const s = await resourceSample(); return s.docPgLagSeq === 0 ? 'done' : false; }, 60_000, '积压排空').catch(() => false);
  const drainMs = drained ? Date.now() - drainStart : null;

  const lagMax = Math.max(0, ...backlogSeries.map((s) => s.docPgLagSeq ?? 0));
  state.axes.backlog = {
    windowMs: P.backlogWindowMs, sampleCount: backlogSeries.length,
    lagSeqMax: lagMax, pendingBytesMax: Math.max(0, ...backlogSeries.map((s) => s.walPendingBytes ?? 0)),
    backlogDurationMs: P.backlogWindowMs + (drainMs ?? 0),   // 持续时间=注入窗+排空窗（时段分布见 series）
    drainMs, series: backlogSeries.map((s) => ({ at: s.at - t0, lag: s.docPgLagSeq, pending: s.walPendingBytes })),
  };
  state.axes.slowProjectIsolation = {
    normalP95Ms: axisOf(normalRtt).p95, slowP95Ms: axisOf(slowRtt).p95,
    normalSampleCount: normalRtt.length, slowSampleCount: slowRtt.length,
  };
  state.invariants.backlogDrained = { pass: drained === 'done', detail: `撤触发器后积压排空=${drained === 'done'}（drainMs=${drainMs}）` };
  state.invariants.slowProjectIsolation = {
    pass: axisOf(normalRtt).p95 != null && axisOf(normalRtt).p95 <= HARD_THRESHOLDS.walFsyncP95Ms * 4,   // 慢项目滞留下正常项目 p95 不劣化超 4× fsync 门（软报告+硬判据双锚）
    detail: `慢项目滞留窗正常项目帧 p95=${axisOf(normalRtt).p95}ms（对照 fsync 硬门 20ms 的 4×容差）`,
  };
}

/** 场景 6：长时间持续写入+磁盘接近上限（容量闸 fail-closed+恢复落定+完整性终检）。 */
async function scenarioSustainedDisk(S, state) {
  const pid = S.projects[5 + P.concProjects];
  // 重启 api 注入容量上限（磁盘接近上限形态——T31 D 档先例：软件容量闸等价）
  await stopService('api');
  await startApi('api', { COLLAB_SPOOL_CAPACITY_BYTES: String(P.spoolCapacityBytes) });
  const { Y: Ylib } = loadClientLibs();
  const doc = new Ylib.Doc();
  const susSink = mkWsSink();
  const p = mkProvider({ token: S.token, projectId: pid, document: doc, onWsClose: noteCloseCode, wsSink: susSink });
  await syncedOf(p);
  const resSamples = []; const capacityEvents = [];
  let acceptedSeq = 0; let rejected = 0;
  const t0 = Date.now();
  const stopAt = t0 + P.sustainedWindowMs;
  const susMain = mkNodeMap(Ylib, 'sus-main');
  doc.getMap('nodes').set('sus-main', susMain);
  const text = susMain.get('data').get('prompt').get('text');   // T15 合法域（节点 prompt 容器）
  const chunk = 'z'.repeat(512);
  const sampler = (async () => {
    while (Date.now() < stopAt + 2_000) {
      await sleep(5_000);
      const s = await resourceSample();
      resSamples.push({ rss: s.rss, eventLoopLagSeconds: s.eventLoopLagSeconds, spoolBytes: s.spoolBytes, capacityTotal: s.spoolCapacityTotal, docPgLagSeq: s.docPgLagSeq });
    }
  })();
  ERR.timedOps += Math.ceil(P.sustainedWindowMs / (P.sustainedFrameMs + 8));
  while (Date.now() < stopAt) {
    try {
      await frameWriteWithEcho(doc, () => {
        doc.transact(() => {
          acceptedSeq += 1;
          text.insert(text.length ?? 0, chunk.repeat(16));   // ~8KB/帧
          doc.getMap('nodes').set(`sus${acceptedSeq}`, mkNodeMap(Ylib, `sus${acceptedSeq}`));
        }, BENCH_LOCAL);
      }, susSink);
    } catch { rejected += 1; capacityEvents.push(Date.now() - t0); ERR.timeouts += 1; }   // 容量闸拒收/回声超时=可观测拒（非静默丢）
    await sleep(P.sustainedFrameMs);
  }
  await sampler;
  const capacityBefore = await resourceSample();
  // 容量闸形态：继续写到容量触发（上界 60s）——观测 fail-closed（帧拒/连接 close 码——非静默丢）
  const capT0 = Date.now();
  while (Date.now() - capT0 < 60_000 && (await resourceSample()).spoolCapacityTotal === capacityBefore.spoolCapacityTotal) {
    try { await frameWriteWithEcho(doc, () => { acceptedSeq += 1; doc.transact(() => { text.insert(text.length ?? 0, chunk.repeat(128)); }, BENCH_LOCAL); }, susSink); } catch { rejected += 1; }
    await sleep(100);
  }
  const capAfter = await resourceSample();
  const triggered = capAfter.spoolCapacityTotal > (capacityBefore.spoolCapacityTotal ?? 0);
  // 容量恢复（撤上限重启）→回灌落定+完整性终检
  await stopService('api');
  await startApi('api');
  const finalDoc = new Ylib.Doc();
  const fp = mkProvider({ token: S.token, projectId: pid, document: finalDoc });
  await syncedOf(fp, 60_000);
  const finalKeys = finalDoc.getMap('nodes').size;
  destroyProvider(fp);
  // PG 权威重放对拍（drill replayKeysOf 同形——零静默丢终检）
  const { CanvasDocUpdateRepository } = requireApi('./dist/modules/collab/canvas-doc-update.repository.js');
  const replayKeys = await withPg(async (prisma) => {
    const repo = new CanvasDocUpdateRepository(prisma);
    const { state: snap, updates } = await repo.readSnapshotOnly(pid);
    const { Y: Ylib2 } = loadClientLibs();
    const rd = new Ylib2.Doc();
    if (snap) Ylib2.applyUpdate(rd, new Uint8Array(snap));
    for (const u of updates) Ylib2.applyUpdate(rd, new Uint8Array(u));
    return rd.getMap('nodes').size;
  });

  state.axes.sustained = {
    windowMs: P.sustainedWindowMs, framesAccepted: acceptedSeq, framesRejected: rejected,
    rssMaxBytes: Math.max(...resSamples.map((s) => s.rss ?? 0)),
    rssStableBytes: resSamples.length > 3 ? Math.abs((resSamples[resSamples.length - 1].rss ?? 0) - (resSamples[0].rss ?? 0)) : null,
    spoolBytesMax: Math.max(...resSamples.map((s) => s.spoolBytes ?? 0)),
    eventLoopLagMaxMs: Math.round(Math.max(0, ...resSamples.map((s) => s.eventLoopLagSeconds ?? 0)) * 1000),
    spoolCapacityBytes: P.spoolCapacityBytes, capacityTriggered: triggered,
  };
  // 零静默丢口径：主窗帧（每帧恰 1 节点=计数可对账）全数落 PG+客户端终态=PG 重放（等值=无静默丢）；
  // 容量段帧=容量闸 fail-closed 拒收面（拒帧/滞留为预期行为非静默丢——acceptedSeq 含容量段尝试，不对账）。
  const mainWindowFrames = Math.floor(Math.min(P.sustainedWindowMs / (P.sustainedFrameMs + 8), acceptedSeq));
  state.invariants.noSilentDrop = {
    pass: replayKeys === finalKeys && finalKeys >= mainWindowFrames,
    detail: `PG 重放键 ${replayKeys} / 客户端终态 ${finalKeys} / 主窗帧 ${mainWindowFrames}（容量触发=${triggered}，容量段拒帧=${rejected}——fail-closed 拒收非静默丢）`,
  };
}

/** 场景 7：恢复 RTO（kill→重启→ready+回灌归零）。 */
async function scenarioRecoveryRto(S, state) {
  const { Y: Ylib } = loadClientLibs();
  const pid = S.projects[6 + P.concProjects];
  const doc = new Ylib.Doc();
  const rtoSink = mkWsSink();
  const p = mkProvider({ token: S.token, projectId: pid, document: doc, wsSink: rtoSink });
  await syncedOf(p);
  let seq = 0;
  const w = (async () => { while (!state._rtoKilled) { try { await frameWriteWithEcho(doc, () => { seq += 1; doc.transact(() => { doc.getMap('nodes').set(`rto${seq}`, mkNodeMap(Ylib, `rto${seq}`)); }, BENCH_LOCAL); }, rtoSink); } catch { break; } await sleep(150); } })();
  await sleep(P.rtoWriteMs);   // 写入热身（spool 有在飞帧）
  const acceptedBefore = seq;
  state._rtoKilled = true;
  const t0 = Date.now();
  await stopService('api');   // taskkill /F=SIGKILL 等价（drill A2 同形）
  await portKill([3000, 3001]);
  await startApi('api');
  await waitFor(async () => {
    const r = await fetch(`${API_URL}/api/ready`, { headers: { 'x-prometheus-token': BENCH_ADMIN_TOKEN } }).then((x) => x.json()).catch(() => null);
    noteHttpStatus(200);
    return r?.ready === true && r?.pending?.spoolFiles === 0 ? 'done' : false;
  }, 120_000, 'RTO：ready+回灌归零');
  const rtoMs = Date.now() - t0;
  await w;
  // 重放 ⊇ 已接受集（零丢终检）
  const { CanvasDocUpdateRepository } = requireApi('./dist/modules/collab/canvas-doc-update.repository.js');
  const replayKeys = await withPg(async (prisma) => {
    const repo = new CanvasDocUpdateRepository(prisma);
    const { state: snap, updates } = await repo.readSnapshotOnly(pid);
    const { Y: Ylib2 } = loadClientLibs();
    const rd = new Ylib2.Doc();
    if (snap) Ylib2.applyUpdate(rd, new Uint8Array(snap));
    for (const u of updates) Ylib2.applyUpdate(rd, new Uint8Array(u));
    return rd.getMap('nodes').size;
  });
  destroyProvider(p);
  state.axes.recoveryRto = { ms: rtoMs, acceptedBeforeKill: acceptedBefore, replayKeysAfter: replayKeys };
  state.invariants.replaySuperset = { pass: replayKeys >= acceptedBefore, detail: `重启重放 ${replayKeys} ≥ kill 前接受 ${acceptedBefore}` };
}

// ══ 主流程 ══
const STATE = {
  meta: { profile: OPTS.profile, machine: `${os.platform()}/${os.arch()} ${os.cpus().length}C/${Math.round(os.totalmem() / 1024 / 1024 / 1024)}G node ${process.version}`, startedAt: new Date().toISOString(), axesComplete: false },
  errors: ERR, invariants: {}, axes: {},
};
function appendOut(scenario, payload) {
  if (!OPTS.out) return;
  appendFileSync(OPTS.out, JSON.stringify({ scenario, at: new Date().toISOString(), ...payload }) + '\n', 'utf8');   // 分段落盘（防中断全丢）
}
async function main() {
  const globalDeadline = setTimeout(() => { console.error('[bench] 全局超时上界到——强制退出（分段 JSONL 已落盘）'); process.exit(2); }, P.timeoutMs);
  globalDeadline.unref?.();
  if (!OPTS.confirm) { console.error('破坏性装置（kill api/PG 触发器/容量注入）——加 --confirm 执行（drill-cutover/reset-collab 同律）'); process.exit(1); }
  for (const [port, name] of [[5432, 'PostgreSQL'], [6379, 'Redis']]) {
    if (!(await isPortOpen(port))) throw new Error(`基础设施预检失败：${name}(${port}) 未监听`);
  }
  // MinIO 预检=警告非阻断（api spawn 注入 MINIO_INIT=skip 显式裁剪 ensureBucket——gate-collab B′ 先例；
  // 负载基准零对象存储产物消费，CI load-bench-hard job 无 MinIO service 合法）
  if (!(await isPortOpen(9000))) console.log('[bench] WARNING MinIO(9000) 未监听——MINIO_INIT=skip 形态继续（零对象存储产物消费）');
  await portKill([3000, 3001, 3002]);
  await ensureBuilt();
  const projectCount = 7 + P.concProjects + (P.fanoutConns > 0 ? 0 : 0);
  const S = await makeFixtures('t33', projectCount);
  let exitCode = 0;
  try {
    await startApi('api', { COLLAB_SESSION_IDLE_TTL_MS: String(P.ttlMs) });
    const runners = [
      ['cold-load', scenarioColdLoad], ['mixed-payload', scenarioMixedPayload], ['concurrency', scenarioConcurrency],
      ['ss2-fanout', scenarioSs2Fanout], ['backlog-isolation', scenarioBacklogIsolation],
      ['sustained-disk', scenarioSustainedDisk], ['recovery-rto', scenarioRecoveryRto],
    ];
    for (const [name, fn] of runners) {
      if (OPTS.only && OPTS.only !== name) continue;
      const t0 = Date.now();
      console.log(`\n[bench] ══ 场景 ${name} 开始 ══`);
      try {
        await fn(S, STATE);
        appendOut(name, { ok: true, ms: Date.now() - t0, axes: { [name]: STATE.axes[name === 'ss2-fanout' ? 'ss2Fanout' : name] ?? null } });
        console.log(`[bench] ══ 场景 ${name} 完成（${((Date.now() - t0) / 1000).toFixed(1)}s）══`);
      } catch (e) {
        appendOut(name, { ok: false, ms: Date.now() - t0, error: String(e?.message ?? e) });
        console.error(`[bench] 场景 ${name} 失败：${e?.stack ?? e}`);
        ERR.dataAssertionFailures += 1;
        if (OPTS.only) throw e;   // 定向模式直接抛（调试形态）
      }
      scanApiLogForUnhandled();
    }
    scanApiLogForUnhandled();
    STATE.meta.axesComplete = !OPTS.only;
    STATE.meta.finishedAt = new Date().toISOString();
    const verdict = decideLoadBenchVerdict(STATE);
    STATE.verdict = verdict;
    console.log('\n════════ T33 负载基准判定 ════════');
    console.log(`profile=${OPTS.profile} 机器=${STATE.meta.machine}`);
    console.log(`硬门：${verdict.hardBlocks.length === 0 ? '全过' : '红 ' + verdict.hardBlocks.length + ' 项'}`);
    for (const b of verdict.hardBlocks) console.log(`  [BLOCK] ${b.gate}: ${JSON.stringify(b.actual)} vs 阈值 ${JSON.stringify(b.threshold)}——${b.why}`);
    if (verdict.softWarns.length) console.log(`软 warn ${verdict.softWarns.length} 项（超限=触发 fork/patch 评审非只测不补）：`);
    for (const w of verdict.softWarns) console.log(`  [WARN:${w.level}] ${w.axis}: ${JSON.stringify(w.actual)} vs 预算 ${JSON.stringify(w.budget)}——${w.why}`);
    if (OPTS.out) {
      writeFileSync(OPTS.out.replace(/\.jsonl?$/, '') + '.bench.json', JSON.stringify(STATE, null, 2), 'utf8');
      console.log(`完整 JSON：${OPTS.out.replace(/\.jsonl?$/, '') + '.bench.json'}（JSONL 分段=${OPTS.out}）`);
    }
    exitCode = verdict.verdict === 'pass' ? 0 : 1;
  } finally {
    await stopService('api').catch(() => {});
    await portKill([3000, 3001, 3002]);
    await cleanupFixtures(S).catch(() => {});
    clearTimeout(globalDeadline);
  }
  process.exit(exitCode);
}
if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) main().catch((e) => { console.error(`[bench] 致命：${e?.stack ?? e}`); process.exit(2); });
