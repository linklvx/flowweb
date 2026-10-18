// apps/api/scripts/write-frozen-drill.mjs —— Y0b-5 T9：write-frozen 全链演练（spec §5.3 验收链+plan T9 断言链①-⑦；collab-core CI 载体）。
// 形态：collab-kill9-drill 同族（自起 dist-drill/scripts/collab-drill-server.js 子进程——真实 AppModule+PG/Redis；
// 先 tsc -p tsconfig.drill.json——tsx/esbuild 不发射 decorator metadata 的载体偏差同 kill9 文件头登记）。
// 装置：双 ws client（collab-smoke 同族——cookie+Origin header+csv 版本门）；doc-status/conn-status 经
// provider 'stateless' 事件捕获（Y0b-4 T5 幂等快照通道——census ⑧：'write-frozen' 字面量已从服务端清零，
// 本脚本用 doc-status.writeFrozen 维度断言，scripts/ 面不受 census 扫描约束）。
// 模式：
//   --mode=frozen-chain  ：①双 client 连接（connected 钩子首快照 rev=DOC_STATUS_REV_SEED 播种验证）→②POST /api/drain→
//     两 client 收 doc-status writeFrozen=true（quota.state 恒 ok——drain/quota 两维度独立）→断言A:冻结期新编辑帧
//     readOnly 拒不物化（对端不可见+PG 不落行）→③pending 排空→关停（closeAll1012 close code 断言）→
//     ④重启后断线期间服务端 quota 状态翻转（临时 client C 突发大帧触发真实配额冻结链 beforeSync→freezePending→
//     2s 冷却实测→freezeQuota；★docTruth/docDelta 是 gateway 进程内 Map 无 DB 表可 SQL 直改——plan 的"quota
//     bytes 维度直改"按机制等价落此形态）+shrink recalibrate 的 force 广播（Y0b-4 T8 偏差③）定影权威快照→
//     ⑤断言B:重连 authenticated 后首 doc-status 快照逐字段=服务端权威值（幂等快照重放——rev 连续+bytes 精确）→
//     ⑥断言C:shrink 成功→<N 秒（N=35s 具象化——spec:594 出口锚为符号 <N；Y0c T13 根修后 thaw 即时化，
//     35s 为保守上界——详见 SHRINK_RELEASE_N_MS 注记）客户端收
//     writeFrozen=false+编辑放行物化对端可见+PG 落行。
//   --mode=mid-edit-kill9：★⑦编辑中 kill -9 档（裁定 23⑮/24⑸尾——spec:700 RPO 契约；既有 kill9 演练只在
//     quiescence barrier 后断言，本档不等待静默：编辑流持续中直接 SIGKILL）。双断言：
//     (a) 服务端独存：重启后"t_kill−8s 视界"前的编辑全部可恢复（≤debounce 2s+maxDebounce 3s+append 在飞 5s
//         ≈8s 契约上界——演练 COLLAB_DEBOUNCE=300 实际窗口远小，断言锚的是契约上界形态）；
//     (b) 客户端存活：同场景保留 client ydoc→重连握手 SS1/SV 差分→SS2 补回断线窗编辑→PG 重放零丢失
//         （T8 落地后用户可见 RPO≈0 的服务端侧证明）。
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { killProviderLateReconnect } from './lib/provider-late-reconnect-guard.js';   // R5'：@hocuspocus/provider v4 迟到重连定时器兜底（共享——禁内联副本）

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });   // apps/api/.env——collab-smoke B3′ 同序；不覆盖已设 env
const here = fileURLToPath(import.meta.url);
const req = createRequire(here);
const WebSocket = req('ws');
// yjs/provider 走 await import（collab-smoke yjs#438 同坑——doc↔provider 全 mjs 同侧）
const Y = await import('yjs');
const { HocuspocusProvider } = await import('@hocuspocus/provider');

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const TOKEN = `wf-drill-token-${Date.now()}`;   // fixture Session token（直插行=过 WS 鉴权与 REST cookie 鉴权）
const WS_ORIGIN = process.env.COLLAB_ALLOWED_ORIGINS?.split(',')[0]?.trim()
  || new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:5173').origin;   // gateway allowedOrigins() 同源推导（collab-smoke 同款）
const TERM_VIA_SIGNAL = process.platform !== 'win32';   // win32 kill('SIGTERM')=TerminateProcess 硬杀——IPC process.send 主通道（kill9 文件头探针实证）
const PKG_ROOT = resolve(here, '..', '..');   // here=scripts/*.mjs 文件路径——包根需上跳两级（URL '../.env' 与 path resolve 语义差异：URL 相对文件解析，path resolve 把文件段一并弹出）
const DRILL_ENTRY = resolve(PKG_ROOT, 'dist-drill', 'scripts', 'collab-drill-server.js');
const CSV = 2;   // CLIENT_PROTOCOL_VERSION（mjs 无 import shared 先例——字面量+bump 时随改，collab-smoke 同注）

// frozen-chain 配额档：maxDocBytes=40KB（softEnter=32KB/softExit=24KB——50KB 突发帧确定性越 soft，
// 且 doc 总量 <SS2 闸 maxDocBytes+64KB=104KB，重连装载同步帧不撞 4404；maxTxBytes 保持默认 256KB）
const CHAIN_MAX_DOC_BYTES = 40_000;
const BIG_NODE_BYTES = 50 * 1024;
// spec:594 <N> 具象化=35s。机制注记（Y0c T13 已根修——原 Y0b-5 T9 实测登记的「withDoc 嵌套事务
// GC 延迟清洗→thawed=false→解除走 frozenRecheckTimer 30s 兜底」机制已由 shrink 删除档 thaw 判据
// 改用影子预演 shrunk 消除）：thaw 即时化（shrink 出口即广播解除），35s 维持为保守上界不动。
const SHRINK_RELEASE_N_MS = 35_000;
const RPO_BUDGET_MS = 8_000;         // spec:700：debounce 2s+maxDebounce 3s+append 在飞 5s
const MID_EDIT_STREAM_MS = 10_000;   // 编辑流时长 ≥RPO 预算——8s 视界内有足够样本

function fail(msg) { throw new Error(`DRILL FAIL: ${msg}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollUntil(cond, deadlineMs, intervalMs = 100, label = 'pollUntil') {
  const t0 = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - t0 > deadlineMs) fail(`${label}: ${deadlineMs}ms 未达成`);
    await sleep(intervalMs);
  }
}

// —— 服务管理面（kill9 startServer 同族——mjs 化） ——
const liveChildren = new Set();
const liveClients = new Set();   // R2'：client registry——die/watchdog/finally 统一收口面（幂等 destroy）
let compiling = null;
function ensureCompiled() {
  compiling ??= new Promise((res, rej) => {
    try {
      execSync('node node_modules/typescript/bin/tsc -p tsconfig.drill.json', { cwd: PKG_ROOT, stdio: 'inherit' });
      res();
    } catch (e) { rej(new Error(`drill 编译失败（tsc -p tsconfig.drill.json）: ${e.message}`)); }
  });
  return compiling;
}

async function startServer(extraEnv) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const wsPort = port + 1;
  const token = `wf-drill-${port}`;
  const child = spawn(process.execPath, [DRILL_ENTRY], {
    env: {
      ...process.env, ...extraEnv,
      DRILL_HTTP_PORT: String(port), COLLAB_PORT: String(wsPort),
      PROMETHEUS_TOKEN: token, COLLAB_ADMIN_TOKEN: token,   // W23：drain 独立停机令牌（kill9 同款双设）
      COLLAB_DEBOUNCE: '300',
      MINIO_INIT: 'skip', MINIO_ENDPOINT: 'http://127.0.0.1', MINIO_ACCESS_KEY: 'drill', MINIO_SECRET_KEY: 'drill-secret',   // X3：skip+占位缺一不可
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  liveChildren.add(child);
  const stdout = [];
  child.stdout.on('data', (d) => stdout.push(String(d)));
  child.stderr.on('data', (d) => stdout.push(String(d)));
  const ready = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`drill-server 未在 60s 内 listening\n${stdout.join('').slice(-2000)}`)), 60_000);
    const check = () => { if (stdout.join('').includes('drill_server_listening')) { clearTimeout(t); res(); } };
    child.stdout.on('data', check); check();
  });
  const h = {
    child, port, wsPort, token, ready,
    stop: async () => {   // 演练外收口——不留孤儿进程（kill9 stopServer 同语义）
      child.kill('SIGKILL');
      liveChildren.delete(child);
      await new Promise((r) => { child.once('exit', () => r()); setTimeout(r, 2_000).unref?.(); });
    },
  };
  return h;
}

async function shutdownGraceful(h) {   // POSIX=真 SIGTERM；win32=IPC（closeAll1012 经 app.close→onApplicationShutdown）
  if (TERM_VIA_SIGNAL) h.child.kill('SIGTERM');
  else h.child.send?.({ type: 'shutdown' });
  await new Promise((res) => { h.child.once('exit', () => res()); setTimeout(res, 30_000).unref?.(); });
  liveChildren.delete(h.child);
}

async function clearLeaseRow(prisma) {   // W19/Z16：kill 后死 A 持行清掉——下实例快路径获取
  await prisma.$executeRawUnsafe(`UPDATE "CollabLease" SET owner = NULL, "expiresAt" = NULL, "renewedAt" = NULL WHERE scope = 'primary'`);
}

// —— 双 client 装置（collab-smoke 同族+doc-status 捕获） ——
function connectClient(h, projectId, { ydoc, tag } = {}) {
  const doc = ydoc ?? new Y.Doc();
  const statusLog = [];     // doc-status 快照（{msg, at}）
  const connStatusLog = []; // conn-status（per-conn readOnly 真值）
  const wsCloses = [];      // {code, reason}——closeAll1012 断言面
  class HeaderWs extends WebSocket {
    constructor(url) {
      super(url, { headers: { origin: WS_ORIGIN, cookie: `flowweb.session_token=${TOKEN}` } });
      this.on('close', (code, reason) => wsCloses.push({ code, reason: String(reason) }));
    }
  }
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${h.wsPort}?csv=${CSV}`, name: `project:${projectId}`, document: doc,
    WebSocketPolyfill: HeaderWs,
  });
  provider.on('stateless', ({ payload }) => {
    try {
      const m = JSON.parse(payload);
      if (m.type === 'doc-status') statusLog.push({ msg: m, at: Date.now() });
      else if (m.type === 'conn-status') connStatusLog.push({ msg: m, at: Date.now() });
    } catch { /* ping/pong 族非 JSON stateless——忽略 */ }
  });
  const synced = new Promise((res, rej) => {
    const t = setTimeout(() => { try { provider.destroy(); } catch { /* 已闭 */ } rej(new Error('provider synced 超时 15s')); }, 15_000);
    provider.on('synced', () => { clearTimeout(t); res(); });
  });
  const entry = { tag: tag ?? 'c', provider, doc, statusLog, connStatusLog, wsCloses, synced,
    destroy: () => {   // R2'：registry 注销先判——幂等（二次 destroy 短路）
      if (!liveClients.delete(entry)) return;
      try { provider.destroy(); } catch { /* 同步 void——smoke B4 */ }
      killProviderLateReconnect(provider);   // R5'：provider v4 迟到重连定时器兜底（lib 共享——缺陷形态与退役判据见 provider-late-reconnect-guard.js 头注）
    } };
  liveClients.add(entry);
  return entry;
}

async function firstStatus(c, pred, deadlineMs, label) {
  const t0 = Date.now();
  for (;;) {
    const hit = c.statusLog.find((s) => pred(s.msg));
    if (hit) return hit;
    if (Date.now() - t0 > deadlineMs) fail(`${label}: ${deadlineMs}ms 内未收到满足条件的 doc-status（已收 ${c.statusLog.length} 条）`);
    await sleep(50);
  }
}

// —— 观测/重放/fixture（collab-smoke 同族——dist 仓库+Prisma 直查） ——
async function metrics(h) {
  const res = await fetch(`http://127.0.0.1:${h.port}/metrics`, { headers: { 'x-prometheus-token': h.token }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`metrics HTTP ${res.status}`);
  return res.text();
}
function gauge(text, name) {
  const m = new RegExp(`^${name} ([0-9.]+)`, 'm').exec(text);
  if (!m) fail(`gauge ${name} 不在 metrics 输出中`);
  return Number(m[1]);
}
async function waitPendingDrained(h, deadlineMs = 15_000) {
  await pollUntil(async () => {
    const t = await metrics(h);
    return gauge(t, 'yjs_pending_projects') === 0 && gauge(t, 'yjs_pending_batches') === 0 && gauge(t, 'yjs_store_in_flight_docs') === 0;
  }, deadlineMs, 400, '③pending 排空');
}
let repoCtor = null;
async function replayKeys(prisma, projectId) {   // DB 权威重放（绕过内存 doc——kill9 replayKeys 同形态）
  repoCtor ??= req('../dist-drill/src/modules/collab/canvas-doc-update.repository.js').CanvasDocUpdateRepository;
  const repo = new repoCtor(prisma);
  const { state, updates } = await repo.readSnapshotOnly(projectId);
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, new Uint8Array(state));
  for (const u of updates) Y.applyUpdate(doc, new Uint8Array(u));
  return [...doc.getMap('nodes').keys()];
}
async function waitReplayHas(prisma, projectId, keys, deadlineMs = 30_000) {
  const t0 = Date.now();
  for (;;) {
    const ks = new Set(await replayKeys(prisma, projectId));
    if (keys.every((k) => ks.has(k))) return;
    if (Date.now() - t0 > deadlineMs) fail(`replay 未收敛：缺 [${keys.filter((k) => !ks.has(k)).join(',')}]（deadline ${deadlineMs}ms）`);
    await sleep(2_500);
  }
}
async function postShrink(h, projectId, body) {
  const res = await fetch(`http://127.0.0.1:${h.port}/api/collab/doc/${projectId}/shrink`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WS_ORIGIN, cookie: `flowweb.session_token=${TOKEN}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!(res.status >= 200 && res.status < 300)) fail(`POST shrink ${JSON.stringify(body)} → HTTP ${res.status} ${await res.text().catch(() => '')}`);   // Nest POST 默认 201（无 @HttpCode——web 侧 res.ok 同口径）
  const j = await res.json();
  return j?.data ?? j;   // TransformInterceptor 信封 {code:0,data}
}

// fixture（collab-smoke S 哨兵族——逐 run 唯一 id+finally deleteMany 幂等清理）
function makeSentinel(ts) {
  return { ts, user: `wf-u-${ts}`, team: `wf-t-${ts}`, member: `wf-m-${ts}`, project: `wf-p-${ts}`, token: TOKEN };
}
async function createFixture(prisma, S) {
  await prisma.user.create({ data: { id: S.user, name: `wf-${S.ts}`, email: `wf-${S.ts}@example.invalid`, emailVerified: false } });
  await prisma.team.create({ data: { id: S.team, name: `wf-${S.ts}`, ownerId: S.user } });
  await prisma.teamMember.create({ data: { id: S.member, teamId: S.team, userId: S.user, role: 'MEMBER' } });   // MEMBER=编辑级（仅 PROJECT_VIEWER 只读）
  await prisma.canvasProject.create({ data: { id: S.project, name: `wf-${S.ts}`, teamId: S.team } });
  await prisma.session.create({ data: { id: `wf-s-${S.ts}`, userId: S.user, token: S.token, expiresAt: new Date(Date.now() + 10 * 60_000) } });
}
async function cleanupFixture(prisma, S) {   // smoke B6 依赖序；失败 WARN+残留 id 不静默
  const warnings = [];
  const order = [
    () => prisma.session.deleteMany({ where: { userId: S.user } }),
    () => prisma.teamMember.deleteMany({ where: { id: S.member } }),
    () => prisma.canvasProject.deleteMany({ where: { id: S.project } }),   // Cascade 清 CanvasDoc/Update
    () => prisma.team.deleteMany({ where: { id: S.team } }),
    () => prisma.user.deleteMany({ where: { id: S.user } }),
  ];
  for (const del of order) await del().catch((e) => warnings.push(`哨兵清理失败（残留待人工删）: ${e.message}`));
  for (const w of warnings) console.error(`WF-DRILL-WARN: ${w}`);
}

// ===== frozen-chain：断言链 ①-⑥（spec §5.3 验收） =====
async function frozenChainMode(env) {
  const PrismaClient = req('@prisma/client').PrismaClient;
  const prisma = new PrismaClient();
  const S = makeSentinel(Date.now());
  const hEnv = { ...env, COLLAB_MAX_DOC_BYTES: String(CHAIN_MAX_DOC_BYTES) };
  let h = null;
  try {
    await createFixture(prisma, S);
    h = await startServer(hEnv); await h.ready;
    // ① 双 EDITOR client 连接——connected 钩子首快照（rev=DOC_STATUS_REV_SEED 播种——初值 0 会被客户端
    // rev<=last 守卫丢首快照=Y0b-4 T5 修复的存在性验证）
    const A = connectClient(h, S.project, { tag: 'A' });
    const B = connectClient(h, S.project, { tag: 'B' });
    await Promise.all([A.synced, B.synced]);
    for (const c of [A, B]) {
      const m = (await firstStatus(c, () => true, 5_000, `①${c.tag} connected 首快照`)).msg;
      if (m.rev !== 1) fail(`①${c.tag} 首快照 rev=${m.rev} ≠ 播种值 1（DOC_STATUS_REV_SEED）`);
      if (m.writeFrozen !== false || m.quota.state !== 'ok') fail(`①${c.tag} 首快照应为未冻结 ok 态：${JSON.stringify(m)}`);
    }
    // 基线编辑落 PG（后续断言的重放基线）
    A.doc.transact(() => A.doc.getMap('nodes').set('base-node', new Y.Map([['v', 1]])));
    await waitReplayHas(prisma, S.project, ['base-node']);

    // ② POST /api/drain → 两 client 收 doc-status writeFrozen=true（quota.state 恒 ok——drain 不冒充 quota over）
    const drainRes = await fetch(`http://127.0.0.1:${h.port}/api/drain`, { method: 'POST', headers: { 'x-prometheus-token': h.token }, signal: AbortSignal.timeout(10_000) });
    if (drainRes.status !== 200) fail(`②POST /api/drain 非 200：${drainRes.status}`);
    for (const c of [A, B]) {
      const m = (await firstStatus(c, (x) => x.writeFrozen === true, 5_000, `②${c.tag} drain 冻结通告`)).msg;
      if (m.quota.state !== 'ok') fail(`②${c.tag} drain 冻结通告 quota.state=${m.quota.state}（drain/quota 两维度独立——不得冒充 over）：${JSON.stringify(m)}`);
      if (!c.connStatusLog.some((x) => x.msg.readOnly === true)) fail(`②${c.tag} 未收 conn-status readOnly=true（applyWriteFreeze 单源）`);
    }
    // 断言A：drain 后新编辑帧 readOnly 拒不物化（对端不可见+PG 不落行）
    A.doc.transact(() => A.doc.getMap('nodes').set('frozen-node', new Y.Map([['v', 1]])));
    await sleep(4_000);
    if (B.doc.getMap('nodes').has('frozen-node')) fail('断言A：drain 冻结期编辑帧物化到对端');
    if ((await replayKeys(prisma, S.project)).includes('frozen-node')) fail('断言A：drain 冻结期编辑帧落 PG');

    // ③ pending 排空 → closeAll1012（真实关停链——onApplicationShutdown 步骤 2）
    await waitPendingDrained(h);
    const clients1 = [A, B];
    await shutdownGraceful(h);
    h = null;
    for (const c of clients1) {
      if (!c.wsCloses.some((x) => x.code === 1012)) fail(`③${c.tag} 未观察到 close(1012 APP_RESTART)（close 事件：${JSON.stringify(c.wsCloses)}）`);
      c.destroy();   // 防 zombie 重连（旧端口已死——重试无害但清场）
    }

    // ④ 重启 + 断线期间服务端 quota 状态翻转（client 不知情）：临时 client C 突发大帧触发真实配额冻结链
    await clearLeaseRow(prisma);
    h = await startServer(hEnv); await h.ready;   // h2 归位同一 h 槽——中途 fail 的 finally 兜底 SIGKILL 覆盖两代实例
    const C = connectClient(h, S.project, { tag: 'C' });
    await C.synced;
    C.doc.transact(() => C.doc.getMap('nodes').set('big-node', new Y.Map([['blob', 'x'.repeat(BIG_NODE_BYTES)]])));
    const overMsg = (await firstStatus(C, (x) => x.quota?.state === 'over', 10_000, '④quota over 通告（freezePending 广播）')).msg;
    await pollUntil(() => C.connStatusLog.some((x) => x.msg.readOnly === true), 8_000, 100, '④freezeQuota 落地（conn-status readOnly=true）');
    // ④b 权威快照定影：shrink recalibrate（纯校准）触发 force 广播（Y0b-4 T8 偏差③——dedup 键不含 bytes），
    // C 收到带最新 truth bytes 的 over 快照=断线翻转后的服务端权威值（thawed=false——越 softExit 不解冻）
    const rec = await postShrink(h, S.project, { recalibrate: true });
    if (rec.result !== 'recalibrated' || rec.thawed !== false) fail(`④recalibrate 出口异常：${JSON.stringify(rec)}`);
    const authoritative = (await firstStatus(C, (x) => x.rev > overMsg.rev && x.quota?.state === 'over', 5_000, '④权威快照 force 广播')).msg;
    if (authoritative.quota.bytes !== rec.watermark) fail(`④force 广播 bytes=${authoritative.quota.bytes} ≠ watermark=${rec.watermark}`);

    // ⑤ 断言B：重连 authenticated 后首 doc-status 快照=服务端权威值（幂等快照重放——rev 连续+bytes 精确）
    const A2 = connectClient(h, S.project, { tag: 'A2' });
    const B2 = connectClient(h, S.project, { tag: 'B2' });
    await Promise.all([A2.synced, B2.synced]);
    for (const c of [A2, B2]) {
      const m = (await firstStatus(c, () => true, 5_000, `⑤${c.tag} 首快照`)).msg;
      // T11：首快照走 per-conn 推送面——带各自顶层 connectionId（权威快照=per-doc 广播面无此字段），
      // 剥离后逐字段比对（比对语义不变）；类型校验=per-conn 回传字段存在性
      const { connectionId, ...shared } = m;
      if (typeof connectionId !== 'string') fail(`断言B：${c.tag} 首快照缺 connectionId（T11 per-conn 回传）——got ${JSON.stringify(m)}`);
      if (JSON.stringify(shared) !== JSON.stringify(authoritative))
        fail(`断言B：${c.tag} 首快照 ≠ 服务端权威值\n  got ${JSON.stringify(shared)}\n  exp ${JSON.stringify(authoritative)}`);
      if (!c.connStatusLog.some((x) => x.msg.readOnly === true)) fail(`断言B：${c.tag} 未收 conn-status readOnly=true（冻结期加入）`);
    }

    // ⑥ 断言C：shrink 成功 → <N 秒客户端本地只读态解除（Y0c T13 根修后 thaw 即时化——删除档判据
    // 用影子预演 shrunk，解除广播随 shrink 出口发出）+编辑放行物化对端可见+PG 落行
    const rec2 = await postShrink(h, S.project, { deleteNodeIds: ['big-node'] });
    if (rec2.result !== 'ok') fail(`⑥shrink 出口异常：${JSON.stringify(rec2)}`);
    const shrinkAt = Date.now();
    for (const c of [A2, B2]) {
      const released = await firstStatus(c, (x) => x.writeFrozen === false && x.quota?.state === 'ok', SHRINK_RELEASE_N_MS, `⑥${c.tag} 只读态解除通告`);
      const tookMs = released.at - shrinkAt;
      if (tookMs > SHRINK_RELEASE_N_MS) fail(`⑥${c.tag} 解除耗时 ${tookMs}ms ≥ N=${SHRINK_RELEASE_N_MS}ms（spec:594 出口锚）`);
      if (!c.connStatusLog.some((x) => x.msg.readOnly === false)) fail(`⑥${c.tag} conn-status 未解除 readOnly`);
    }
    A2.doc.transact(() => A2.doc.getMap('nodes').set('thaw-marker', new Y.Map([['v', 1]])));
    await pollUntil(() => B2.doc.getMap('nodes').has('thaw-marker'), 5_000, 50, '⑥thaw-marker 对端可见');
    await waitReplayHas(prisma, S.project, ['thaw-marker']);

    for (const c of [C, A2, B2]) c.destroy();
    await h.stop();
    h = null;   // 正常收口——finally 兜底跳过（防对死进程二次 stop 空等 2s）
    console.log(`DRILL PASS: frozen-chain —— ①rev 播种首快照 ②drain 冻结(断言A 拒不物化) ③close(1012) ④断线期 quota 冻结+force 权威定影 ⑤断言B 逐字段重放(rev=${authoritative.rev},bytes=${authoritative.quota.bytes}) ⑥断言C 解除<${SHRINK_RELEASE_N_MS}ms(thaw 即时)+物化`);
  } finally {
    for (const c of liveClients) c.destroy();   // R2'：成功路径句柄收口——provider/ws 销毁（自然 exit 0 根修）
    await cleanupFixture(prisma, S);
    await prisma.$disconnect();
    if (h) await h.stop();   // 兜底 SIGKILL——中途 fail 不留孤儿进程/端口/DB 连接
  }
}

// ===== mid-edit-kill9：★⑦ 编辑中 kill -9 档（spec:700 RPO——裁定 23⑮/24⑸尾双断言） =====
async function midEditKill9Mode(env) {
  const PrismaClient = req('@prisma/client').PrismaClient;
  const prisma = new PrismaClient();
  const S = makeSentinel(Date.now());
  let h = null;
  try {
    await createFixture(prisma, S);
    await clearLeaseRow(prisma);   // W19：清残留持行——快路径获取（演练焦点=RPO 非接管时序）
    h = await startServer(env); await h.ready;
    const A = connectClient(h, S.project, { tag: 'A' });
    await A.synced;
    A.doc.transact(() => A.doc.getMap('nodes').set('mid-base', new Y.Map([['v', 1]])));
    await waitReplayHas(prisma, S.project, ['mid-base']);   // store 链路自证（非静默断言基线）

    // 编辑流持续中（不等待静默/quiescence barrier——与既有 kill9 模式的结构差异点）直接 SIGKILL
    const stream = [];
    const timer = setInterval(() => {
      const key = `mid-${stream.length}`;
      A.doc.transact(() => A.doc.getMap('nodes').set(key, new Y.Map([['i', stream.length]])));
      stream.push({ key, at: Date.now() });
    }, 120);
    await sleep(MID_EDIT_STREAM_MS);
    const tKill = Date.now();
    h.child.kill('SIGKILL');
    clearInterval(timer);
    liveChildren.delete(h.child);
    h = null;   // 已 kill——finally 兜底跳过（exit 收口由下一行 destroy 语义承接，防 stop() 对死进程空等 2s）
    await sleep(300);
    A.destroy();   // 客户端存活语义：provider 销毁但 ydoc 保留（本地仍持有断线窗编辑——RPO≈0 的载体）

    // (a) 服务端独存：重启后 ≤8s 视界前的编辑全部可恢复
    await clearLeaseRow(prisma);
    h = await startServer(env); await h.ready;   // 重启实例归位同一 h 槽——中途 fail 的 finally 兜底覆盖
    const replayed = new Set(await replayKeys(prisma, S.project));
    const horizon = stream.filter((k) => k.at <= tKill - RPO_BUDGET_MS);
    if (horizon.length === 0) fail(`⑦a：8s 视界内无样本（流 ${MID_EDIT_STREAM_MS}ms 不足）——断言退化禁过`);
    const missingA = horizon.filter((k) => !replayed.has(k.key));
    if (missingA.length > 0) fail(`⑦a RPO 契约破：t_kill−8s 视界前 ${missingA.length}/${horizon.length} 个编辑丢失：${missingA.slice(0, 5).map((k) => k.key).join(',')}`);
    const presentTs = stream.filter((k) => replayed.has(k.key)).map((k) => k.at);
    const observedRpo = presentTs.length > 0 ? tKill - Math.max(...presentTs) : tKill - stream[0].at;

    // (b) 客户端存活：同 ydoc 重连——SS1/SV 差分→SS2 补回断线窗编辑→PG 重放零丢失
    const PB = connectClient(h, S.project, { ydoc: A.doc, tag: 'PB' });
    await PB.synced;
    const t0 = Date.now();
    for (;;) {
      const now = new Set(await replayKeys(prisma, S.project));
      if (stream.every((k) => now.has(k.key))) break;
      if (Date.now() - t0 > 30_000) {
        const lost = stream.filter((k) => !now.has(k.key));
        fail(`⑦b 零丢失破：SS2 差分补回后仍缺 ${lost.length}/${stream.length}：${lost.slice(0, 5).map((k) => k.key).join(',')}`);
      }
      await sleep(500);
    }
    PB.destroy();
    await h.stop();
    h = null;   // 正常收口——finally 兜底跳过（防对死进程二次 stop 空等 2s）
    console.log(`DRILL PASS: mid-edit-kill9 —— (a)服务端独存：观测 RPO≈${observedRpo}ms ≤ 契约上界 ${RPO_BUDGET_MS}ms（视界样本 ${horizon.length}/${stream.length}）；(b)客户端存活：SS2 差分补回 ${stream.length}/${stream.length} 零丢失`);
  } finally {
    for (const c of liveClients) c.destroy();   // R2'：成功路径句柄收口——provider/ws 销毁（自然 exit 0 根修）
    await cleanupFixture(prisma, S);
    await prisma.$disconnect();
    if (h) await h.stop();
  }
}

async function main() {
  if (!DATABASE_URL) fail('DATABASE_URL 未设置（本地 apps/api/.env 或 CI job env）');
  const mode = (process.argv.find((a) => a.startsWith('--mode=')) ?? '').slice(7);
  if (!['frozen-chain', 'mid-edit-kill9'].includes(mode)) fail('usage: node scripts/write-frozen-drill.mjs --mode=frozen-chain|mid-edit-kill9');
  await ensureCompiled();   // 载体：tsc 全量（emitDecoratorMetadata）+node dist 子进程——kill9 文件头同注
  const spoolDir = await mkdtemp(join(tmpdir(), 'y0b5-wf-spool-'));
  const env = { DATABASE_URL, COLLAB_SPOOL_DIR: spoolDir, NODE_ENV: 'development' };
  try {
    if (mode === 'frozen-chain') return await frozenChainMode(env);
    return await midEditKill9Mode(env);
  } finally {
    await rm(spoolDir, { recursive: true, force: true });
  }
}

function die(e) {   // R2'：stderr 同步写（CI 管道防截断）+1s 兜底 exit
  clearTimeout(watchdog);
  for (const c of liveClients) c.destroy();
  for (const c of liveChildren) c.kill('SIGKILL');   // 兜底 SIGKILL——孤儿化收口（kill9 Major-1 同款）
  const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
  process.stderr.write(`\nDRILL FAIL: ${msg}\n`, () => process.exit(1));
  setTimeout(() => process.exit(1), 1_000);   // v3：fallback 保 ref（unref+stderr 背压=exit 0 假绿）
}

// R2' watchdog（B19 分责）：兜 catch 不可达的 hang（fetch/Prisma/未知句柄）；execSync(tsc) 阻塞期
// 本定时器不触发——tsc 挂由 CI step timeout 兜底。exit 2 与业务失败 1 区分。
// 保 ref 不 unref——unref+无句柄 hang=exit 0 假绿；成功/die 路径 clearTimeout。默认 6min < CI step 10min。
const WATCHDOG_MS = Number(process.env.WF_DRILL_WATCHDOG_MS) || 6 * 60_000;
const watchdog = setTimeout(() => {
  for (const c of liveClients) c.destroy();
  for (const c of liveChildren) c.kill('SIGKILL');
  process.stderr.write('DRILL WATCHDOG: 超时强制退出（exit 2）\n', () => process.exit(2));
  setTimeout(() => process.exit(2), 1_000);   // v3：fallback 保 ref
}, WATCHDOG_MS);

void main().then(() => { clearTimeout(watchdog); }).catch(die);
