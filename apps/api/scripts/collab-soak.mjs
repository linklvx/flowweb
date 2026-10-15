// apps/api/scripts/collab-soak.mjs —— Y0b-5 T15（裁定 24：★测量非执法——E45 deny/LRU 归 Y1c-3 驳回的是执法）。
// N doc × M client × 编辑速率 → 每 30s 采样：RSS/heapUsed（/metrics process 族）/驻留 doc 数（yjs_loaded_documents）
// /store 延迟（yjs_store_duration_seconds 直方图窗口 p99）/spool bytes → 结束输出两张 runbook 数：
//   ①并发容量上限（本档无拐点即「≥N×M」——拐点判据=storeP99>1s 或 RSS 陡增；正式多档留档归 T18）；
//   ②spool 存活窗（容量 256MB ÷ 增速 B/min——预阈值 50%/80% 的「还剩多久」换算依据）。
// 帧延迟 p99=客户端观测（编辑方写时间戳 marker→观察方 update 回调测回显时延）。
// 运行时依赖真实 api（默认 127.0.0.1:3000/3001——dev 或服务器）——CP-B 人工留档，不进 verify。
// 用法（编辑压测，缺省模式）：node scripts/collab-soak.mjs --docs 2 --clients 2 --rate 300 --duration 0.5
//
// Y0c T0.5 扩展（Z121——一个装置四个消费者：T1 基线/A2 内存实测第一轮/D 第二轮/Z91 采样）：
//   ①提取器=collab-soak-metrics.mjs sampleOne(url, role)（T0 setDefaultLabels({role:'api'}) 后
//     原 `^name value$` 首匹配正则全体失配——入口条件实测 rss=0.0MB/docs=null/storeP99=n/a；
//     多进程安全=按 role+labels 精确取值；双端点读取 T29-I 已落——--worker-metrics-url/
//     WORKER_METRICS_URL 提供时 sample 阶段兼读 worker 3002（同 x-prometheus-token 头，Z116），
//     worker 侧 rss 源=process_tree_rss_bytes 树合计〔Z91①〕；未提供维持单端点现行为，
//     只压不统计——p95 由查询侧承担〔Z117②，T32 服务器实测轮消费〕）；
//   ②三场景（--scenario）：single=单节点执行链 / closepage=关页作业完成 / group20=20 节点组执行
//     （执行链 fixture/stub/execute 形态=exec-smoke Y0b-5 T17 同族——哨兵 NodeType 零可见+零外呼）；
//   ③COLLAB_SESSION_IDLE_TTL_MS pin（--ttl-pin 默认 120_000——Z107 判据 A 必带本轮 TTL 值；
//     受控链=fail-closed 断言 .env 同源值+closepage 作业间隔由 TTL 驱动，非仅记录）；
//   ④完整性巡检（Z111——A2/T22 实装：常驻 doc 抽样 PG 重放对拍 SV，差异进 JSON integrityProbe 字段）；
//   ⑤机器可读 JSON（--json <file> 落盘或 stdout——结构供 T1 直接落档）。
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { sampleOne, metricsDelta } from './collab-soak-metrics.mjs';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });   // apps/api/.env——collab-smoke B3′ 同序；不覆盖已设 env
const here = fileURLToPath(import.meta.url);
const req = createRequire(here);
const { PrismaClient } = req('@prisma/client');
const { CreditLedgerService } = req('../dist/modules/team/credit-ledger.service.js');   // dist=部署产物（exec-smoke 同源——余额播种经台账唯一写入口，ledger_guard 拦裸写）
const { replayPgSnapshot, stateVectorsEqual } = req('../dist/modules/collab/collab-integrity-probe.js');   // Z111 巡检纯函数（dist 同惯例——src 单测同源）
const WebSocket = req('ws');
// yjs/provider 走 await import（collab-smoke yjs#438 同坑——doc↔provider 全 mjs 同侧）
const Y = await import('yjs');
const { HocuspocusProvider } = await import('@hocuspocus/provider');

const API = process.env.COLLAB_API_URL ?? 'http://127.0.0.1:3000';
const WS_URL = process.env.COLLAB_WS_URL ?? 'ws://127.0.0.1:3001';
const WS_ORIGIN = process.env.COLLAB_ALLOWED_ORIGINS?.split(',')[0]?.trim()
  || new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:5173').origin;
const CSV = 2;   // CLIENT_PROTOCOL_VERSION（collab-smoke 同注——bump 时随改）
const METRICS_URL = `${API}/metrics`;

function parseArgs(argv) {
  const out = { docs: 4, clients: 8, rate: 1000, duration: 5, ttlPin: 120_000, jobs: 3 };
  const STR_KEYS = new Set(['scenario', 'json', 'workerMetricsUrl']);   // 字符串值参数（其余数值——原校验语义不变）
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`坏参数：${k}（用法 --docs N --clients M --rate ms --duration min --scenario single|closepage|group20 --jobs N --ttl-pin ms --json file --worker-metrics-url url）`);
    const key = k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());   // kebab→camel 归一（--ttl-pin→ttlPin）
    if (STR_KEYS.has(key)) { out[key] = argv[i + 1]; continue; }
    const v = Number(argv[i + 1]);
    if (!Number.isFinite(v) || v <= 0) throw new Error(`坏参数：${k} ${argv[i + 1]}（数值参数须为正数）`);
    out[key] = v;
  }
  if (out.scenario && !['single', 'closepage', 'group20'].includes(out.scenario))
    throw new Error(`坏参数：--scenario ${out.scenario}（词表=single|closepage|group20——缺省=编辑压测模式）`);
  return out;
}
const OPTS = parseArgs(process.argv.slice(2));
// T29-I（Z116/Z117②）：worker 3002 双端点读取——CLI 旗优先，env WORKER_METRICS_URL 回退；
// 未提供维持单端点现行为（Windows 开发机无 worker 3002 驻留时装置不破——双端点能力=T32 服务器实测轮消费）。
const WORKER_METRICS_URL = OPTS.workerMetricsUrl ?? process.env.WORKER_METRICS_URL ?? null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HeaderWs extends WebSocket {
  constructor(url, headers) { super(url, { headers }); }
}

/** metrics 采样统一入口（含 PROMETHEUS_TOKEN header 组装——两模式共用）。
 *  T29-I 双端点（Z116/Z117②）：WORKER_METRICS_URL 提供时兼读 worker 3002（同 x-prometheus-token
 *  头——同 token 形态）；per-role 样本结构=api 平铺（既有汇总读面 rss/heap/docs 不变）+worker 嵌套
 *  （JSON 落档面——只压不统计，p95(worker 进程树 RSS 合计) 由查询侧承担）。 */
async function sample() {
  const headers = process.env.PROMETHEUS_TOKEN ? { 'x-prometheus-token': process.env.PROMETHEUS_TOKEN } : {};
  const apiSample = await sampleOne(METRICS_URL, 'api', headers);
  if (!WORKER_METRICS_URL) return apiSample;   // 单端点维持现行为（形状零变化）
  const workerSample = await sampleOne(WORKER_METRICS_URL, 'worker', headers);
  return { ...apiSample, worker: workerSample };
}

/** COLLAB_SESSION_IDLE_TTL_MS pin（Z107/P9——A2 判据 A 必带本轮 TTL 值，装置保证跑数时 TTL 受控）。
 *  受控链：装置与 api 同机同读 apps/api/.env（dotenv 同源）→ fail-closed 断言 .env 生效值
 *  （缺省=使用点默认 120_000——Z107 定标）与 --ttl-pin 一致；closepage 场景作业间隔由 pin 值驱动
 *  （N 连续作业全部落在 TTL 窗内=判据 A 前提）。边界如实登记：api 由 shell 显式注入该 env 时
 *  dotenv 不覆盖已设值、本断言不可见——跑数前须确认无 shell 覆盖（JSON ttlSource 注记）。 */
function pinTtl() {
  const raw = process.env.COLLAB_SESSION_IDLE_TTL_MS;
  const effective = raw !== undefined && raw !== '' ? Number(raw) : 120_000;
  if (effective !== OPTS.ttlPin)
    throw new Error(`TTL pin 断言失败：.env 生效值 ${effective} ≠ --ttl-pin ${OPTS.ttlPin}——对齐 apps/api/.env（改动后 api 须重启）或 --ttl-pin`);
  return { ttlPinnedMs: effective, ttlSource: raw !== undefined && raw !== '' ? 'env' : 'default' };
}

/** Z111 完整性巡检（A2/T22 实装）：抽样常驻 doc——PG 行集（CanvasDoc.state+CanvasDocUpdate.seq 升序）
 *  重放成 doc ⇔ 内存 doc 的 encodeStateVector 对拍；不等 ⇒ integrityProbe.drifted 报告差异
 *  （观测项非门禁——Z111 字面：A7a 档「整行缺失不可探测」的唯一探测手段，常驻把盲区从分钟级拉到
 *  小时级，故巡检只报告不拦截）。纯函数面（replayPgSnapshot/stateVectorsEqual）=dist 同源单测载体。
 *  内存真源两档：liveDocs 命中（single/group20=场景 provider 仍在连——同步副本≡服务端常驻 doc）；
 *  未命中（closepage 关页后无副本）⇒ probeSync 短连重同步取服务端真值（doc 常驻时同步自内存，
 *  对拍有效；TTL 后已卸载则重装载自 PG=平凡 match——liveSource 如实注记两档）。 */
async function integrityProbe(ctx) {
  const startedAt = Date.now();
  const results = [];
  for (const pid of ctx.projectIds) {
    try {
      const docRow = await ctx.prisma.canvasDoc.findUnique({ where: { projectId: pid }, select: { state: true } });
      const rows = await ctx.prisma.canvasDocUpdate.findMany({ where: { projectId: pid }, orderBy: { seq: 'asc' }, select: { update: true } });
      const replayed = replayPgSnapshot(docRow?.state ?? null, rows.map((r) => r.update));
      const liveDoc = ctx.liveDocs?.get(pid) ?? null;
      let svLive = null;
      let liveSource = null;
      if (liveDoc) {
        svLive = Y.encodeStateVector(liveDoc);
        liveSource = 'scenario-provider';
      } else if (ctx.probeSync) {
        const sv = await ctx.probeSync(pid);
        if (sv) { svLive = sv; liveSource = 'probe-resync'; }
      }
      if (!svLive) {
        results.push({ project: pid, skipped: 'no-live-doc', pgRows: rows.length, pgStatePresent: !!docRow?.state });
        continue;
      }
      const match = stateVectorsEqual(Y.encodeStateVector(replayed), svLive);
      results.push({ project: pid, match, pgRows: rows.length, pgStatePresent: !!docRow?.state, liveSource });
    } catch (e) {
      results.push({ project: pid, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return {
    implemented: true, sampled: results.length,
    matched: results.filter((r) => r.match === true).length,
    drifted: results.filter((r) => r.match === false),
    results, durationMs: Date.now() - startedAt,
  };
}

/** 巡检短连重同步（closepage 无活副本档）：开 provider→synced→取 SV→destroy（零编辑零驻留）。
 *  复用场景 session token；synced 超时/失败 ⇒ null（巡检降级为 skipped，不阻断装置）。 */
async function probeSyncSv(pid) {
  const p = new HocuspocusProvider({
    url: `${WS_URL}?csv=${CSV}&cb=soak-sc-probe`, name: `project:${pid}`, document: new Y.Doc(),
    WebSocketPolyfill: class extends HeaderWs {
      constructor(url) { super(url, { origin: WS_ORIGIN, cookie: `flowweb.session_token=${SCEN.token}` }); }
    },
  });
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('probe synced 超时 10s')), 10_000);
      p.on('synced', () => { clearTimeout(t); res(); });
    });
    await sleep(500);   // SyncStep2 尾帧 apply 静置（SV 取样前）
    const sv = Y.encodeStateVector(p.document);
    await p.destroy();
    return sv;
  } catch {
    await p.destroy().catch(() => {});
    return null;
  }
}

/** 机器可读 JSON 输出（T1 落档消费）：--json <file> 落盘或 stdout 尾块 */
function outputJson(obj) {
  const text = JSON.stringify(obj, null, 2);
  if (OPTS.json) {
    writeFileSync(OPTS.json, `${text}\n`);
    console.log(`[soak] JSON 已落盘：${OPTS.json}`);
  } else {
    console.log(`\n[soak-json]\n${text}`);
  }
}

/** 窗口 p99（桶累计差——base 为基线样本；total=0 → null） */
function bucketP99(buckets, base) {
  const les = Object.keys(buckets).sort((a, b) => Number(a) - Number(b));
  const total = (buckets['+Inf'] ?? 0) - (base?.buckets?.['+Inf'] ?? 0);
  if (!total) return null;
  const target = 0.99 * total;
  for (const le of les) {
    if (le === '+Inf') break;
    if ((buckets[le] ?? 0) - (base?.buckets?.[le] ?? 0) >= target) return Number(le) * 1000;
  }
  return Infinity;   // 落 +Inf 桶（>10s）
}

const fmtMs = (v) => (v === null || v === undefined ? 'n/a' : v === Infinity ? '>10s' : `${v}ms`);

async function readyAssert() {
  const ready = await fetch(`${API}/api/ready`).then((x) => x.json()).catch(() => null);
  if (!ready?.ready) throw new Error(`前置断言失败：/api/ready ready=${ready?.ready} reason=${ready?.reason}——先起服务再 soak`);
}

// ═══════════ 缺省模式：编辑压测（原 T15 装置逻辑原样——观测面改经提取器） ═══════════

const ts = Date.now();
// 每 client 独立 user/member/session（真实场景=每用户单连接；共用单 token 时拒绝缓存以 token 指纹为键——
// 一连接被 semaphore 拒（COLLAB_AUTH_INFLIGHT_MAX=4）即全员 15s 内同拒，M≥5 必「恰 4 auth」失败）
const S = {
  team: `soak-t-${ts}`,
  users: Array.from({ length: OPTS.clients }, (_, ci) => `soak-u-${ts}-${ci}`),
  members: Array.from({ length: OPTS.clients }, (_, ci) => `soak-m-${ts}-${ci}`),
  tokens: Array.from({ length: OPTS.clients }, () => `soak-tok-${randomUUID()}`),
};
const projectIds = Array.from({ length: OPTS.docs }, (_, i) => `soak-p-${ts}-${i}`);

async function runSoak() {
  const prisma = new PrismaClient();
  const providers = [];
  const editTimers = [];
  const warnings = [];
  let edits = 0;
  let connErrors = 0;
  const frameLatencies = [];
  const samples = [];
  try {
    await prisma.user.createMany({ data: S.users.map((u, ci) => ({ id: u, name: `soak-${ts}`, email: `soak-${ts}-u${ci}@example.invalid`, emailVerified: false })) });
    await prisma.team.create({ data: { id: S.team, name: `soak-${ts}`, ownerId: S.users[0] } });
    await prisma.teamMember.createMany({ data: S.users.map((u, ci) => ({ id: S.members[ci], teamId: S.team, userId: u, role: 'MEMBER' })) });
    await prisma.canvasProject.createMany({ data: projectIds.map((id) => ({ id, name: `soak-${ts}`, teamId: S.team })) });
    await prisma.session.createMany({ data: S.tokens.map((token, ci) => ({ id: `soak-s-${ts}-${ci}`, userId: S.users[ci], token, expiresAt: new Date(Date.now() + 30 * 60_000) })) });

    // M clients 轮转铺到 N docs；帧延迟观察=各 client 对「他人 marker」的回显时延（own marker 恒 0 剔除）
    const seenKeys = Array.from({ length: OPTS.clients }, () => new Set());
    for (let ci = 0; ci < OPTS.clients; ci++) {
      const cookie = { origin: WS_ORIGIN, cookie: `flowweb.session_token=${S.tokens[ci]}` };   // 各绑自己 session token
      const p = new HocuspocusProvider({
        url: `${WS_URL}?csv=${CSV}&cb=soak`, name: `project:${projectIds[ci % OPTS.docs]}`, document: new Y.Doc(),
        WebSocketPolyfill: class extends HeaderWs { constructor(url) { super(url, cookie); } },
      });
      providers.push(p);
      const doc = p.document;
      doc.on('update', () => {
        const map = doc.getMap('soak');
        for (const [k, v] of map.entries()) {
          if (k.startsWith(`c${ci}#`) || seenKeys[ci].has(k) || typeof v !== 'number') continue;
          seenKeys[ci].add(k);
          frameLatencies.push(Date.now() - v);
        }
      });
      p.on('close', () => { connErrors += 1; });
      // 顺序建连（错峰 AUTH）：COLLAB_AUTH_INFLIGHT_MAX 默认 4 + 拒绝缓存 15s（semaphore 拒后同 doc|token
      // 15s 内重连全拒）——同瞬 M≥5 并发 AUTH 必撞限且 10s synced 窗内不可恢复；真实场景=用户陆续上线
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error(`client#${ci} provider synced 超时 10s——WS 未监听/鉴权拒/装载失败`)), 10_000);
        p.on('synced', () => { clearTimeout(t); res(); });
      });
    }
    console.log(`[soak] 起跑：docs=${OPTS.docs} clients=${OPTS.clients} rate=${OPTS.rate}ms duration=${OPTS.duration}min`);

    // 编辑流：每 client 每 rate ms 写一次 marker（值=写入时刻——观察方回显时延即帧延迟样本）
    for (let ci = 0; ci < OPTS.clients; ci++) {
      let seq = 0;
      editTimers.push(setInterval(() => {
        const p = providers[ci];
        if (!p.document) return;
        seq += 1; edits += 1;
        p.document.transact(() => p.document.getMap('soak').set(`c${ci}#${seq}`, Date.now()));
      }, OPTS.rate));
    }

    // 采样列：t/rss/heap/docs/spool/storeP99(窗口)/frameP99(累计)
    const t0 = Date.now();
    const baseline = await sample();
    samples.push({ t: 0, ...baseline });
    const endAt = t0 + OPTS.duration * 60_000;
    while (Date.now() < endAt - 1_000) {
      await sleep(Math.min(30_000, Math.max(1, endAt - Date.now())));
      const s = await sample();
      samples.push({ t: Math.round((Date.now() - t0) / 1000), ...s });
      const frameP99 = frameLatencies.length ? frameLatencies.slice().sort((a, b) => a - b)[Math.floor(0.99 * (frameLatencies.length - 1))] : null;
      console.log(`[soak] sample#${samples.length - 1} rss=${(s.rss / 1048576).toFixed(1)}MB heap=${(s.heap / 1048576).toFixed(1)}MB docs=${s.docs} spool=${s.spoolBytes}B storeP99=${fmtMs(bucketP99(s.buckets, baseline))} frameP99=${fmtMs(frameP99)}${s.worker ? ` workerTreeRss=${(s.worker.rss / 1048576).toFixed(1)}MB` : ''}`);
    }
    const finalS = await sample();
    samples.push({ t: Math.round(OPTS.duration * 60), ...finalS });

    // ===== 汇总+两张 runbook 数 =====
    const frameP99 = frameLatencies.length ? frameLatencies.slice().sort((a, b) => a - b)[Math.floor(0.99 * (frameLatencies.length - 1))] : null;
    const frameNA = OPTS.clients <= OPTS.docs ? 'n/a(M≤N 无同 doc 观察对——帧延迟需 doc 上 ≥2 client)' : 'n/a';
    const storeP99 = bucketP99(finalS.buckets, baseline);
    const maxRss = Math.max(...samples.map((s) => s.rss ?? 0));
    const maxHeap = Math.max(...samples.map((s) => s.heap ?? 0));
    const maxDocs = Math.max(...samples.map((s) => s.docs ?? 0));
    const mins = Math.max(OPTS.duration, 1 / 60);
    const spoolGrowth = Math.max(0, (finalS.spoolBytes ?? 0) - (baseline.spoolBytes ?? 0)) / mins;
    console.log(`[soak] 汇总：edits=${edits} connErrors=${connErrors} frameP99=${frameP99 ?? frameNA} storeP99=${fmtMs(storeP99)} maxRSS=${(maxRss / 1048576).toFixed(1)}MB maxHeap=${(maxHeap / 1048576).toFixed(1)}MB maxLoadedDocs=${maxDocs} spoolGrowth=${spoolGrowth.toFixed(1)}B/min`);
    const noKnee = (storeP99 === null || (Number.isFinite(storeP99) && storeP99 <= 1000));
    console.log(`[soak] runbook 数①并发容量上限：${noKnee ? `本档 ${OPTS.docs} docs × ${OPTS.clients} conns 无拐点（storeP99≤1s）→ 容量上限 ≥ ${OPTS.docs}×${OPTS.clients}（单档下界——正式档多档跑归 T18）` : `本档见拐点（storeP99>1s）——容量上限 < ${OPTS.docs}×${OPTS.clients}`}`);
    const cap = Number(process.env.COLLAB_SPOOL_CAPACITY_BYTES) > 0 ? Number(process.env.COLLAB_SPOOL_CAPACITY_BYTES) : 256 * 1024 * 1024;
    console.log(`[soak] runbook 数②spool 存活窗：${spoolGrowth > 0 ? `增速 ${spoolGrowth.toFixed(1)}B/min → 容量 ${cap / 1048576}MB ÷ 增速 ≈ ${(cap / spoolGrowth).toFixed(0)}min 到满仓（50%/80% 预阈值=该窗的 1/2 与 4/5）` : 'spool 零增长——存活窗不构成约束（正常态：PG 通则 store 落库不滞留）'}`);
    outputJson({
      harness: 'collab-soak', mode: 'soak', ts: new Date().toISOString(), api: API,
      workerMetricsUrl: WORKER_METRICS_URL,   // T29-I：null=单端点档；非 null 时 samples[].worker 为 per-role 嵌套样本
      docs: OPTS.docs, clients: OPTS.clients, rateMs: OPTS.rate, durationMin: OPTS.duration,
      counts: { edits, connErrors }, frameP99, storeP99,
      maxRssBytes: maxRss, maxHeapBytes: maxHeap, maxLoadedDocs: maxDocs, spoolGrowthPerMin: spoolGrowth,
      samples,
    });
  } finally {
    for (const t of editTimers) clearInterval(t);
    for (const p of providers) { try { p.destroy(); } catch (e) { warnings.push(`provider destroy 异常: ${e.message}`); } }
    const order = [
      () => prisma.session.deleteMany({ where: { userId: { in: S.users } } }),
      () => prisma.teamMember.deleteMany({ where: { id: { in: S.members } } }),
      () => prisma.canvasProject.deleteMany({ where: { teamId: S.team } }),   // Cascade 清 CanvasDoc/Update（N docs 一并）
      () => prisma.team.deleteMany({ where: { id: S.team } }),
      () => prisma.user.deleteMany({ where: { id: { in: S.users } } }),
    ];
    for (const del of order) await del().catch((e) => warnings.push(`哨兵清理失败（残留待人工删）: ${e.message}`));
    await prisma.$disconnect();
    for (const w of warnings) console.error(`SOAK-WARN: ${w}`);   // finally 内输出——main 中途 throw 时清理期告警也可见
  }
}

// ═══════════ 三场景装置（--scenario——执行链 fixture/stub/execute=exec-smoke T17 同族精简） ═══════════
// 场景哨兵独立前缀 soak-sc-（与编辑压测 soak- 与 exec-smoke smoke-y0b5- 互不交叉）。
// SCEN 场景级状态在 runScenario 内组装；本节只放共用件。

const NT_KEY = 'soak:y0c:text';   // 哨兵 NodeType key（用户面选择器按已知 key 查询——永不被查，exec-smoke 同形态）
// 哨兵 id 前缀单源（SCEN 生成与 purge 前缀谓词同源——防漂移）；谓词只匹配本装置哨兵（真实用户 id
// 为 cuid/uuid 形态，不可能以 soak-sc- 前缀开头——零误删面）。
const SCEN_PREFIX = { user: 'soak-sc-u-', team: 'soak-sc-t-', member: 'soak-sc-m-', session: 'soak-sc-s-', project: 'soak-sc-p-' };
const SCEN = {
  user: `${SCEN_PREFIX.user}${ts}`, team: `${SCEN_PREFIX.team}${ts}`, member: `${SCEN_PREFIX.member}${ts}`,
  session: `${SCEN_PREFIX.session}${ts}`, token: `soak-sc-tok-${randomUUID()}`,
  nt: `soak-sc-nt-${ts}`, model: `soak-sc-model-${ts}`, rule: `soak-sc-rule-${ts}`,
};

async function startStub() {
  const { createServer } = await import('node:http');
  const srv = createServer((rq, rs) => {
    const chunks = [];
    rq.on('data', (c) => chunks.push(c));
    rq.on('end', () => {
      rs.writeHead(200, { 'content-type': 'application/json' });
      rs.end(JSON.stringify({ choices: [{ message: { content: 'soak-sc-ok' } }] }));
    });
  });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  return { port: srv.address().port, close: () => new Promise((res) => srv.close(res)) };
}

/** 场景哨兵清理（前缀谓词覆盖全部 7 类——跨 ts 残留可清；台账/团队删须 ledger_guard 通行证，
 *  exec-smoke 同款）。失败上抛不吞：预扫失败=拒跑 fail-closed（seed 必撞约束）；finally 清理
 *  失败由调用点 catch 进 SOAK-WARN 告警（内层吞错=告警死代码，真实失败全静默——已修）。 */
async function purgeScenSentinels(prisma, ledger) {
  await prisma.generationIntent.deleteMany({ where: { teamId: { startsWith: SCEN_PREFIX.team } } });
  await prisma.session.deleteMany({ where: { userId: { startsWith: SCEN_PREFIX.user } } });
  await prisma.teamMember.deleteMany({ where: { id: { startsWith: SCEN_PREFIX.member } } });
  await prisma.canvasProject.deleteMany({ where: { id: { startsWith: SCEN_PREFIX.project } } });
  await ledger.runInTx(async (tx) => {
    await tx.teamCreditTransaction.deleteMany({ where: { teamId: { startsWith: SCEN_PREFIX.team } } });
    await tx.team.deleteMany({ where: { id: { startsWith: SCEN_PREFIX.team } } });
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: SCEN_PREFIX.user } } });
  await prisma.nodeType.deleteMany({ where: { key: NT_KEY } });
}

/** 场景 fixture（exec-smoke 形态：哨兵 NodeType 零可见+stub 模型零外呼+cost:0 零台账行）
 *  +WS 播种 nNodes 个 textInput 节点，返回 { provider, project, nodeIds, sv }。
 *  baseline 采样时机由调用方定（synced+落地窗后=观测窗自 execute 起）。 */
async function seedScenario(prisma, ledger, stubPort, nNodes) {
  const project = `${SCEN_PREFIX.project}${ts}`;
  await prisma.user.create({ data: { id: SCEN.user, name: `soak-sc-${ts}`, email: `soak-sc-${ts}@example.invalid`, emailVerified: false } });
  await prisma.team.create({ data: { id: SCEN.team, name: `soak-sc-${ts}`, ownerId: SCEN.user } });
  await prisma.teamMember.create({ data: { id: SCEN.member, teamId: SCEN.team, userId: SCEN.user, role: 'MEMBER' } });
  await prisma.canvasProject.create({ data: { id: project, name: `soak-sc-${ts}`, teamId: SCEN.team } });
  await prisma.session.create({ data: { id: SCEN.session, userId: SCEN.user, token: SCEN.token, expiresAt: new Date(Date.now() + 10 * 60_000) } });
  await ledger.runInTx(async (tx) => {
    await ledger.ensureBalance(tx, SCEN.team);
    await ledger.mutate(tx, { teamId: SCEN.team, operatorUserId: SCEN.user, type: 'register_grant', creditType: 'regular', balanceDelta: 10, frozenDelta: 0, referenceId: `register:${SCEN.team}` });
  });
  await prisma.nodeType.create({ data: { id: SCEN.nt, key: NT_KEY, name: `soak-sc 哨兵（用户面不可见）${ts}` } });
  await prisma.aIModel.create({ data: { id: SCEN.model, nodeTypeId: SCEN.nt, name: `soak-sc ${ts}`, provider: 'moonshot', apiUrl: `http://127.0.0.1:${stubPort}`, apiKey: 'smoke-dummy', apiModelName: `soak-sc-ok-${ts}`, active: true } });
  await prisma.pricingRule.create({ data: { id: SCEN.rule, nodeTypeId: SCEN.nt, modelId: SCEN.model, creditCost: 0, active: true } });

  const provider = new HocuspocusProvider({
    url: `${WS_URL}?csv=${CSV}&cb=soak-sc`, name: `project:${project}`, document: new Y.Doc(),
    WebSocketPolyfill: class extends HeaderWs {
      constructor(url) { super(url, { origin: WS_ORIGIN, cookie: `flowweb.session_token=${SCEN.token}` }); }
    },
  });
  await new Promise((res, rej) => {
    const t = setTimeout(() => { provider.destroy(); rej(new Error('场景 provider synced 超时 10s——3001 未监听/鉴权拒/装载失败')); }, 10_000);
    provider.on('synced', () => { clearTimeout(t); res(); });
  });
  const nodeIds = Array.from({ length: nNodes }, (_, i) => `soak-sc-node-${i}`);
  provider.document.transact(() => {
    for (const nodeId of nodeIds) {
      const data = new Y.Map();
      data.set('model', SCEN.model);
      data.set('content', `soak-sc ${nodeId}`);
      const m = new Y.Map();
      m.set('type', 'textInput');
      m.set('data', data);
      provider.document.getMap('nodes').set(nodeId, m);
    }
  });
  await sleep(1_500);   // 客户端 update → 服务端落地窗（SV 门失败自动重试兜底，exec-smoke 同注）
  const sv = Buffer.from(Y.encodeStateVector(provider.document)).toString('base64');
  return { provider, project, nodeIds, sv };
}

/** 执行调用（exec-smoke 同款：SYNC_PENDING 409 重试 5 次——TransformInterceptor 信封 {code:0,data}） */
async function executeNodes(project, nodeIds, sv) {
  for (let i = 0; i < 5; i++) {
    let res;
    try {
      res = await fetch(`${API}/api/execution/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: WS_ORIGIN, cookie: `flowweb.session_token=${SCEN.token}` },
        body: JSON.stringify({ projectId: project, nodeIds, stateVector: sv }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new Error(`execute API 不可达（dev watch 重启窗/未启动）: ${e instanceof Error ? e.message : e}`);
    }
    if (res.status === 409) { await sleep(500); continue; }
    if (!(res.status >= 200 && res.status < 300)) throw new Error(`execute HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    const j = await res.json();
    return j?.data ?? j;
  }
  throw new Error('execute 重试 5 次仍 SYNC_PENDING');
}

// ═══════════ 三场景 runner（Z121：T1 基线落档载体——load/store/withdoc 计数与直方图窗口差） ═══════════

async function runScenario(name) {
  const ttl = pinTtl();   // fail-closed：.env 生效值≠--ttl-pin 即拒跑（装置跑数时 TTL 受控，非仅记录）
  const prisma = new PrismaClient();
  const ledger = new CreditLedgerService(prisma);
  const stub = await startStub();
  let provider = null;
  try {
    await purgeScenSentinels(prisma, ledger);   // 幂等预扫（上次运行崩溃残留不永久污染）
    const nNodes = name === 'group20' ? 20 : 1;
    const seeded = await seedScenario(prisma, ledger, stub.port, nNodes);
    provider = seeded.provider;
    // baseline 采点=播种落地后（观测窗自 execute 面起算——播种 WS 装载的 load{ws} 不入窗）
    const baseline = await sample();
    console.log(`[soak-sc] scenario=${name} project=${seeded.project} nodes=${nNodes} ttlPinnedMs=${ttl.ttlPinnedMs}(${ttl.ttlSource})`);
    let jobs = 0;
    let closepageGapMs = null;   // closepage 作业间隔实际生效值（JSON 落档；非 closepage=null）
    const t0 = Date.now();
    if (name === 'closepage') {
      provider.destroy(); provider = null;   // 关页——零连接；后续作业全走 REST 直连（withDoc 装载/落库路径）
      await sleep(3_000);   // 断连收尾+卸载窗（关页 flush 落定——读数如实记录本窗形态）
      // 作业间隔由 TTL 驱动：clamp(TTL/10, 2s, TTL/2)，下界优先——N 作业全部落在 TTL 窗内（Z107 判据 A 前提）
      const gap = Math.max(2_000, Math.min(ttl.ttlPinnedMs / 10, ttl.ttlPinnedMs / 2));
      closepageGapMs = gap;
      for (let i = 0; i < OPTS.jobs; i++) {
        if (i > 0) await sleep(gap);
        const r = await executeNodes(seeded.project, [seeded.nodeIds[0]], seeded.sv);
        if (r.success !== true) throw new Error(`closepage 作业#${i} 应成功：${JSON.stringify(r.errors ?? r)}`);
        jobs += 1;
        console.log(`[soak-sc] closepage 作业#${i} OK（elapsed=${Date.now() - t0}ms gap=${gap}ms）`);
      }
    } else {
      const ids = name === 'group20' ? seeded.nodeIds : [seeded.nodeIds[0]];
      const r = await executeNodes(seeded.project, ids, seeded.sv);
      if (r.success !== true) throw new Error(`场景执行应成功：${JSON.stringify(r.errors ?? r)}`);
      jobs = ids.length;
      console.log(`[soak-sc] execute OK：${ids.length} 节点 totalCost=${r.totalCost}（${Date.now() - t0}ms）`);
    }
    await sleep(2_000);   // 末端投影/store 落定静置窗——final 采样前
    const final = await sample();
    const delta = metricsDelta(baseline, final);
    const probe = await integrityProbe({
      projectIds: [seeded.project], prisma,
      liveDocs: new Map([[seeded.project, provider ? provider.document : null]]),   // closepage=关页无副本⇒probeSync 短连档
      probeSync: probeSyncSv,
    });
    const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}:${v === null || v === undefined ? 'n/a' : `${v >= 0 ? '+' : ''}${v}`}`).join(',');
    console.log(`[soak-sc] 窗口 delta：docLoad{${fmt(delta.docLoad)}} store{${fmt(delta.storeTotal)}} withdoc{count:${delta.withdoc.count} sum:${delta.withdoc.sum.toFixed(3)}} withdocOpen{count:${delta.withdocOpen.count} sum:${delta.withdocOpen.sum.toFixed(3)}}`);
    console.log(`[soak-sc] integrityProbe（Z111）：sampled=${probe.sampled} matched=${probe.matched} drifted=${probe.drifted.length}${probe.results.map((r) => ` [${r.project}] ${r.error ? `error:${r.error}` : r.skipped ? `skipped:${r.skipped}` : `${r.match ? 'MATCH' : 'DRIFT'}(pgRows=${r.pgRows},state=${r.pgStatePresent},${r.liveSource})`}`).join('')}`);
    outputJson({
      harness: 'collab-soak', mode: 'scenario', scenario: name,
      ts: new Date().toISOString(), api: API,
      workerMetricsUrl: WORKER_METRICS_URL,   // T29-I：双端点档时 metrics.baseline/final 含 worker 嵌套样本
      project: seeded.project, nodes: nNodes, jobs, jobsRequested: OPTS.jobs, closepageGapMs,
      ...ttl,
      metrics: { baseline, final, delta },
      integrityProbe: probe,
    });
  } finally {
    if (provider) { try { provider.destroy(); } catch { /* 已闭——同步 void */ } }
    await sleep(1_500);   // 服务端卸载 flush 窗（收尾写落 PG 后再删——防孤儿行复活，exec-smoke 同注）
    const warnings = [];
    await purgeScenSentinels(prisma, ledger).catch((e) => warnings.push(`场景哨兵清理失败（残留待人工删）: ${e.message}`));
    await prisma.$disconnect();
    await stub.close();
    for (const w of warnings) console.error(`SOAK-WARN: ${w}`);
  }
}

// ═══════════ 入口分派 ═══════════

async function main() {
  await readyAssert();
  if (OPTS.scenario) await runScenario(OPTS.scenario);
  else await runSoak();
}

void main().catch((e) => { console.error(`soak FAIL: ${e instanceof Error ? e.message : e}`); process.exitCode = 1; });
