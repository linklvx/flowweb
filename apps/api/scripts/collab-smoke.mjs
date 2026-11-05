// apps/api/scripts/collab-smoke.mjs —— Y0a-4 post-deploy 冒烟（spec §4.4 三步+P21 强化）
// 运行（服务器）：cd ~/flowweb && pnpm --filter @flowweb/api exec node scripts/collab-smoke.mjs
// 运行（本地）  ：同命令（先 pnpm verify 保证 dist 新鲜——本脚本验的是部署产物 dist，不是 src）
// 形态：node 直跑（零 tsx）+dotenv 自加载（B3′）+dist 导入（验产物）
//      +双客户端（A/B 互写 marker 断言互见=协作广播链）+ready 前置断言（只读降级不误诊为落库失败）
// C2-3 合成金丝雀档：--canary（spec v5 §3 C2「smoke cron 参数化落脚本」——专用服务账号/固定 canary
//      项目/单次写入上限（--writes N 默认 3 硬顶 8）/排除计费统计/定期清理/独立 smoke-heartbeat；
//      跑通 WS 写→PG→canary 捕获→verify 重放比对全链——cron 形态见 runbook §14.1）
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });   // apps/api/.env——main.ts:3 同序同 path；不覆盖已设 env（B12）；quiet 消 dotenv17 tips 噪音
const here = fileURLToPath(import.meta.url);
const req = createRequire(here);
const { PrismaClient } = req('@prisma/client');
// yjs 走 await import（全 mjs 与 provider 同侧——yjs#438 混合格式规避）：provider 为 ESM，其同步链
// （y-protocols Y.applyUpdate）恒走 mjs 实例，若 doc 是 req('yjs') 的 cjs 实例=mjs structs 写入 cjs doc=
// GC 构造器 instanceof 检查失效面。dist repo 顶层 require('yjs') 仍会加载 cjs 副本（=yjs#438 警告噪音，
// 实测仍在），但其 Y 不触脚本 doc：readSnapshotOnly 纯 Prisma，compact 用自建 temp doc——doc↔provider 全 mjs 同侧
const Y = await import('yjs');
const { HocuspocusProvider } = await import('@hocuspocus/provider');
const { CanvasDocUpdateRepository } = req('../dist/modules/collab/canvas-doc-update.repository.js');   // dist=部署产物（P21）

const WS_URL = process.env.COLLAB_WS_URL ?? 'ws://127.0.0.1:3001';
const API = process.env.COLLAB_API_URL ?? 'http://127.0.0.1:3000';
const MARKERS = ['smoke-marker-a', 'smoke-marker-b'];
const ts = Date.now();
const S = { user: `smoke-u-${ts}`, team: `smoke-t-${ts}`, member: `smoke-m-${ts}`, project: `smoke-p-${ts}`, token: `smoke-tok-${randomUUID()}` };

// Y0b-3 T2：升级面校验（Origin 白名单+cookie-only）后的运维连接形态——Origin 推导与 gateway
// allowedOrigins() 同源（显式 COLLAB_ALLOWED_ORIGINS 首项 > BETTER_AUTH_URL origin > dev localhost:5173）；
// token 经 Cookie header 注入（query token 通道已删；undici 全局 WebSocket 不支持自定义 header——ws 包注入）。
// Y0b-3 T5 版本门：URL 必带 csv=CLIENT_PROTOCOL_VERSION（缺 csv=client-version-missing 恒拒——冒烟必挂）。
const WebSocket = req('ws');
// T19（P1#1④根修）：CSV 从 shared dist 单源读（T18 bump=3 后字面量 2 恒拒——「bump 时随改」惯例退役）。
// T30b 演练实弹补：sv=CANVAS_DOC_SCHEMA_VERSION 同源上行（T24 收口 M-1 三元硬门——缺失=4406 恒拒；
// 本装置 URL 止于 csv=T19 形态，对 T24+ 服务端 synced 恒超时——单源同律禁字面量）。
const CSV = req('@flowweb/shared').CLIENT_PROTOCOL_VERSION;
const SV = req('@flowweb/shared').CANVAS_DOC_SCHEMA_VERSION;
const WS_ORIGIN = process.env.COLLAB_ALLOWED_ORIGINS?.split(',')[0]?.trim()
  || new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:5173').origin;
const makeHeaderWs = (headers) => class HeaderWs extends WebSocket {
  constructor(url) { super(url, { headers }); }
};

// provider 工厂/marker 信封/synced 等待（基线与 --canary 两档共用——C2-3 提升到模块层）
const mk = (project, token) => new HocuspocusProvider({
  url: `${WS_URL}?csv=${CSV}&sv=${SV}&cb=smoke`, name: `project:${project}`, document: new Y.Doc(),   // CSV/SV=shared dist 单源读（T19 根修+T30b sv 补）
  WebSocketPolyfill: makeHeaderWs({ origin: WS_ORIGIN, cookie: `flowweb.session_token=${token}` }),
});
// T30b 演练实弹补：哨兵节点=T9+ 节点信封（type 标量+data Map 容器——exec-smoke 播种/fillDoc 同形）；
// data 键走 lww 标量键 model（content/prompt=xml/map 域容器——string 直写=container-replacement 4411）
const mkMarker = (id) => {
  const data = new Y.Map();
  data.set('model', `smoke-marker-${id}`);
  const m = new Y.Map();
  m.set('type', 'textInput');
  m.set('data', data);
  return m;
};
const synced = (p) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('provider synced 超时 10s——3001 未监听/鉴权拒/装载失败')), 10_000);
  p.on('synced', () => { clearTimeout(t); res(); });   // 成功路径清 timer——否则绿态进程多挂最长 10s
});

async function step0_readyAssert() {
  const r = await fetch(`${API}/api/ready`).then((x) => x.json()).catch(() => null);
  if (r === null) throw new Error(`前置断言失败：/api/ready API 不可达（fetch 失败）——API 未启动/端口 ${API} 不对，先起服务再冒烟`);
  if (!r.ready) throw new Error(`前置断言失败：/api/ready ready=${r.ready} reason=${r.reason}——spool 只读降级/未服务态下 provider 写入会被拒，先查 ready 再冒烟（禁误诊为"未落库"）`);
}

// ═══ C2-3 合成金丝雀档（--canary）════════════════════════════════════════════
// spec v5 §3 C2：零用户活动期仍每小时跑通「WS 写→PG→canary 捕获→verify 重放比对」全链（charter
// 「全局每小时」的合成承载）。参数化六件全落脚本：专用服务账号+固定 canary 项目（固定 ID 前缀
// canary-smoke-=计费/统计聚合排除锚——账号面排除：零 exec 节点，永不触 GenerationIntent/
// CreditLedger/配额/遥测）+单次写入上限（--writes 默认 3 硬顶 8——cron 误配防刷帧）+定期清理
// （旧 marker 节点/过期 session/游标重置）+独立 smoke-heartbeat（.data/collab-canary-smoke-
// heartbeat.txt——runbook §14.1 外层停更判据载体）。
const CANARY_IDS = { user: 'canary-smoke-svc', team: 'canary-smoke-team', member: 'canary-smoke-m', project: 'canary-smoke-project' };
const CANARY_MARKER_PREFIX = 'canary-m-';
const CANARY_CHAIN_TIMEOUT_MS = 300_000;   // canary poller 60s+verify worker 60s 双 tick+余量（默认档）

/** 参数解析（soak 脚本 fail-loud 惯例：未知参数即拒——cron 误配零静默）。 */
function parseArgs(argv) {
  const out = { canary: false, writes: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--canary') { out.canary = true; continue; }
    if (a === '--writes') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1 || v > 8) throw new Error(`--writes 须为 1..8 整数（单次写入上限硬顶=8——实得 ${argv[i]}）`);
      out.writes = v;
      continue;
    }
    throw new Error(`未知参数：${a}（支持：--canary --writes N）`);
  }
  return out;
}

async function runCanary(prisma, repo, writes) {
  // 独立 smoke-heartbeat（check-collab-health「心跳先行」同律：评估/比对失败也留痕）。路径=仓根
  // .data（health 脚本 stateDir 同目录——服务器部署树内 cron 写入面）。
  const dataDir = path.join(path.dirname(here), '../../../.data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'collab-canary-smoke-heartbeat.txt'), new Date().toISOString());

  const ts = Date.now();
  const runMarkers = Array.from({ length: writes }, (_, i) => `${CANARY_MARKER_PREFIX}${ts}-${i}`);
  const token = `canary-tok-${randomUUID()}`;
  // 固定 fixtures（platform-team.seed 幂等 upsert 先例：固定 id+空 update 不自愈误改值）
  await prisma.user.upsert({ where: { id: CANARY_IDS.user }, update: {}, create: { id: CANARY_IDS.user, name: 'canary-smoke-svc', email: 'canary-smoke-svc@flowweb.internal', emailVerified: false } });
  await prisma.team.upsert({ where: { id: CANARY_IDS.team }, update: { isDefault: false }, create: { id: CANARY_IDS.team, name: 'canary-smoke 团队', ownerId: CANARY_IDS.user, status: 'ACTIVE', isDefault: false } });   // isDefault:false 承重（platform-team.seed 同注）
  await prisma.teamMember.upsert({ where: { teamId_userId: { teamId: CANARY_IDS.team, userId: CANARY_IDS.user } }, update: { role: 'OWNER' }, create: { id: CANARY_IDS.member, teamId: CANARY_IDS.team, userId: CANARY_IDS.user, role: 'OWNER' } });
  await prisma.canvasProject.upsert({ where: { id: CANARY_IDS.project }, update: {}, create: { id: CANARY_IDS.project, name: 'canary-smoke 固定金丝雀项目（勿删·排除计费/统计）', teamId: CANARY_IDS.team, origin: 'user' } });
  // OpsGate 项目行+全局哨兵行（ensureProjectGovernance 幂等 SQL 同款——smoke 直建 canvasProject
  // 绕过两创建路径=governance 不达；行缺=canary mismatch freeze UPDATE 0 行静默失败+解冻端点无靶）
  await prisma.$executeRaw`INSERT INTO "CollabOpsGate" ("gate", "projectId", "state") VALUES ('compact', ${CANARY_IDS.project}, 'OPEN') ON CONFLICT DO NOTHING`;
  await prisma.$executeRaw`INSERT INTO "CollabOpsGate" ("gate", "projectId", "state") VALUES ('compact', '', 'OPEN') ON CONFLICT DO NOTHING`;
  // 定期清理①：过期 session（每轮主动清，session TTL 兜底之外）
  await prisma.session.deleteMany({ where: { userId: CANARY_IDS.user, expiresAt: { lt: new Date() } } });
  await prisma.session.create({ data: { id: `canary-smoke-s-${ts}`, userId: CANARY_IDS.user, token, expiresAt: new Date(Date.now() + 3600_000) } });

  const p = mk(CANARY_IDS.project, token);
  let staleDeleted = 0;
  try {
    await synced(p);
    const nodes = p.document.getMap('nodes');
    // 定期清理②：旧 marker 先删（独立事务帧=纯删除帧先行——Yjs delete 不进 SV 的威胁形态每轮实弹
    // 过链〔C2-2b 红⑥-b 家族〕+doc 有界：marker 恒 ≤ 本轮 writes 个）
    const stale = Array.from(nodes.keys()).filter((k) => k.startsWith(CANARY_MARKER_PREFIX) && !runMarkers.includes(k));
    if (stale.length > 0) p.document.transact(() => { for (const k of stale) nodes.delete(k); });
    staleDeleted = stale.length;
    p.document.transact(() => { for (const m of runMarkers) nodes.set(m, mkMarker(m)); });   // 写入上限=writes 个 marker（parseArgs 硬顶 8）
    // marker 批落 PG（readSnapshotOnly 重放等待——基线档同法；删除帧生效同断）
    let flushOk = false; let lastInfo = { updates: -1 };
    for (let i = 0; i < 8 && !flushOk; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const { state, updates } = await repo.readSnapshotOnly(CANARY_IDS.project);
      lastInfo = { updates: updates.length };
      const probe = new Y.Doc();
      if (state) Y.applyUpdate(probe, new Uint8Array(state));
      for (const u of updates) Y.applyUpdate(probe, new Uint8Array(u));
      if (runMarkers.every((m) => probe.getMap('nodes').has(m)) && stale.every((m) => !probe.getMap('nodes').has(m))) flushOk = true;
    }
    if (!flushOk) throw new Error(`canary marker 批未落 PG（readSnapshotOnly 重放 8 轮未收敛，last=${JSON.stringify(lastInfo)}）——store 链路异常`);
    // 定期清理③/排程参数化：游标重置（固定项目每小时强制 due——nextDueAt≈19.2h 的 SLO 排程之外
    // 的合成档节奏；删除在 flush 后=本轮捕获必然覆盖本轮写入）
    await prisma.collabCanaryCursor.deleteMany({ where: { projectId: CANARY_IDS.project } });
    // 等真 canary 链路：捕获（pin/游标 captured）→verify 消费（pin 清空）+gate OPEN（未冻结）
    let captured = false; let chain = null;
    const t0 = Date.now();
    for (;;) {
      const [pins, cur, gate] = await Promise.all([
        prisma.canaryPin.count({ where: { projectId: CANARY_IDS.project } }),
        prisma.collabCanaryCursor.findUnique({ where: { projectId: CANARY_IDS.project } }),
        prisma.collabOpsGate.findUnique({ where: { gate_projectId: { gate: 'compact', projectId: CANARY_IDS.project } } }),
      ]);
      if (gate?.state === 'FROZEN') throw new Error(`canary verify 判红已冻结（runbook §14.1 处置序）：frozenBy=${gate.frozenBy} reason=${gate.reason}`);
      if (!captured && (pins > 0 || (cur?.lastResult ?? '').startsWith('captured'))) captured = true;
      chain = { pins, cursor: cur?.lastResult ?? null, gate: gate?.state ?? null };
      if (captured && pins === 0 && gate?.state === 'OPEN') break;
      if (Date.now() - t0 > CANARY_CHAIN_TIMEOUT_MS) {
        throw new Error(`canary 链路超时 ${CANARY_CHAIN_TIMEOUT_MS}ms（captured=${captured}）: ${JSON.stringify(chain)}${captured ? '——pin 残留=verify worker 未消费（查 worker 进程/3002）' : '——零捕获=poller 未拾取（查 api serving/CANARY_POLL_INTERVAL_MS/候选批）'}`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    console.log(JSON.stringify({
      canary: 'OK', project: CANARY_IDS.project, writes: runMarkers.length, staleDeleted,
      chainMs: Date.now() - t0, ...chain,
      chain: 'WS→PG→捕获(pin)→verify 重放比对→ok（gate OPEN）',
    }));
  } finally {
    try { p.destroy(); } catch { /* 已断开 */ }   // B4：同步 void 调用
    await prisma.session.deleteMany({ where: { token } }).catch(() => undefined);   // 本轮 session 即清（固定 fixtures 保留——下轮复用）
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));   // fail-loud：未知参数/超上限即拒（soak 惯例）
  await step0_readyAssert();
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma);
  if (opts.canary) {   // C2-3 合成金丝雀档（固定 fixtures 不清场——基线档哨兵清场不适用）
    try {
      await runCanary(prisma, repo, opts.writes);
    } finally {
      await prisma.$disconnect();
    }
    return;
  }
  const warnings = [];
  let lastInfo = { updates: -1 };
  try {
    await prisma.user.create({ data: { id: S.user, name: `smoke-${ts}`, email: `smoke-${ts}@example.invalid`, emailVerified: false } });
    await prisma.team.create({ data: { id: S.team, name: `smoke-${ts}`, ownerId: S.user } });
    await prisma.teamMember.create({ data: { id: S.member, teamId: S.team, userId: S.user, role: 'MEMBER' } });
    await prisma.canvasProject.create({ data: { id: S.project, name: `smoke-${ts}`, teamId: S.team } });
    await prisma.session.create({ data: { id: `smoke-s-${ts}`, userId: S.user, token: S.token, expiresAt: new Date(Date.now() + 10 * 60_000) } });

    const A = mk(S.project, S.token), B = mk(S.project, S.token);   // mk/mkMarker/synced=模块层共用（C2-3 --canary 档同源）
    try {
      await Promise.all([synced(A), synced(B)]);
      A.document.transact(() => A.document.getMap('nodes').set(MARKERS[0], mkMarker(MARKERS[0])));
      B.document.transact(() => B.document.getMap('nodes').set(MARKERS[1], mkMarker(MARKERS[1])));
      // 双客户端断言①：广播链——A 侧收敛出 B 的 marker（10s）
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('广播链断：A 10s 未见 marker-b（doc 装载/广播异常——单客户端冒烟测不出的面）')), 10_000);
        const check = () => { if (A.document.getMap('nodes').has(MARKERS[1])) { clearTimeout(t); res(); } };
        A.document.on('update', check); check();
      });
      // 等 store 落 PG（K 减法：readSnapshotOnly 轮询重放——等待条件与断言条件合一）
      let replayOk = false;
      for (let i = 0; i < 8 && !replayOk; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const { state, updates } = await repo.readSnapshotOnly(S.project);
        lastInfo = { updates: updates.length };
        const probe = new Y.Doc();
        if (state) Y.applyUpdate(probe, new Uint8Array(state));
        for (const u of updates) Y.applyUpdate(probe, new Uint8Array(u));
        if (MARKERS.every((m) => probe.getMap('nodes').has(m))) replayOk = true;
      }
      if (!replayOk) throw new Error(`marker 批未落 PG（readSnapshotOnly 重放 8 轮未收敛，last=${JSON.stringify(lastInfo)}）——store 链路异常`);
    } finally {
      for (const p of [A, B]) { try { p.destroy(); } catch (e) { warnings.push(`provider destroy 异常: ${e.message}`); } }   // B4：同步 void 调用
    }

    console.log(JSON.stringify({ smoke: 'OK', project: S.project, ...lastInfo, chain: 'WS→auth→load→双端写→广播互见→store→PG→重放' }));
  } finally {
    // 清哨兵（B6 依赖序；失败=WARN+残留 id——禁静默；无条件跑：半途建失败也要清掉已建行，deleteMany 按 exact-id 幂等）
    const order = [
      () => prisma.session.deleteMany({ where: { userId: S.user } }),
      () => prisma.teamMember.deleteMany({ where: { id: S.member } }),
      () => prisma.canvasProject.deleteMany({ where: { id: S.project } }),   // Cascade 清 CanvasDoc/Update
      () => prisma.team.deleteMany({ where: { id: S.team } }),
      () => prisma.user.deleteMany({ where: { id: S.user } }),
    ];
    for (const del of order) await del().catch((e) => warnings.push(`哨兵清理失败（残留待人工删）: ${e.message}`));
    const left = await prisma.canvasProject.count({ where: { id: S.project } }).catch(() => -1);
    if (left === 1) warnings.push(`哨兵项目残留：${S.project}（人工删除：psql → DELETE FROM "CanvasProject" WHERE id='${S.project}'）`);
    for (const w of warnings) console.error(`SMOKE-WARN: ${w}`);
    await prisma.$disconnect();
  }
}

void main().catch((e) => { console.error(`smoke FAIL: ${e instanceof Error ? e.message : e}`); process.exitCode = 1; });
