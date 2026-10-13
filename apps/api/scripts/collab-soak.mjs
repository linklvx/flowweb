// apps/api/scripts/collab-soak.mjs —— Y0b-5 T15（裁定 24：★测量非执法——E45 deny/LRU 归 Y1c-3 驳回的是执法）。
// N doc × M client × 编辑速率 → 每 30s 采样：RSS/heapUsed（/metrics process 族）/驻留 doc 数（yjs_loaded_documents）
// /store 延迟（yjs_store_duration_seconds 直方图窗口 p99）/spool bytes → 结束输出两张 runbook 数：
//   ①并发容量上限（本档无拐点即「≥N×M」——拐点判据=storeP99>1s 或 RSS 陡增；正式多档留档归 T18）；
//   ②spool 存活窗（容量 256MB ÷ 增速 B/min——预阈值 50%/80% 的「还剩多久」换算依据）。
// 帧延迟 p99=客户端观测（编辑方写时间戳 marker→观察方 update 回调测回显时延）。
// 运行时依赖真实 api（默认 127.0.0.1:3000/3001——dev 或服务器）——CP-B 人工留档，不进 verify。
// 用法：node scripts/collab-soak.mjs --docs 2 --clients 2 --rate 300 --duration 0.5
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });   // apps/api/.env——collab-smoke B3′ 同序；不覆盖已设 env
const here = fileURLToPath(import.meta.url);
const req = createRequire(here);
const { PrismaClient } = req('@prisma/client');
const WebSocket = req('ws');
// yjs/provider 走 await import（collab-smoke yjs#438 同坑——doc↔provider 全 mjs 同侧）
const Y = await import('yjs');
const { HocuspocusProvider } = await import('@hocuspocus/provider');

const API = process.env.COLLAB_API_URL ?? 'http://127.0.0.1:3000';
const WS_URL = process.env.COLLAB_WS_URL ?? 'ws://127.0.0.1:3001';
const WS_ORIGIN = process.env.COLLAB_ALLOWED_ORIGINS?.split(',')[0]?.trim()
  || new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:5173').origin;
const CSV = 2;   // CLIENT_PROTOCOL_VERSION（collab-smoke 同注——bump 时随改）

function parseArgs(argv) {
  const out = { docs: 4, clients: 8, rate: 1000, duration: 5 };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i], v = Number(argv[i + 1]);
    if (!k.startsWith('--') || !Number.isFinite(v) || v <= 0) throw new Error(`坏参数：${k} ${argv[i + 1]}（用法 --docs N --clients M --rate ms --duration min）`);
    out[k.slice(2)] = v;
  }
  return out;
}
const OPTS = parseArgs(process.argv.slice(2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HeaderWs extends WebSocket {
  constructor(url, headers) { super(url, { headers }); }
}

/** /metrics 最小提取（soak 观测面：process 族+loaded docs+spool+store 直方图桶） */
async function sampleMetrics() {
  const headers = process.env.PROMETHEUS_TOKEN ? { 'x-prometheus-token': process.env.PROMETHEUS_TOKEN } : {};
  const text = await fetch(`${API}/metrics`, { headers }).then((r) => {
    if (!r.ok) throw new Error(`/metrics ${r.status}`);
    return r.text();
  });
  const num = (name) => { const m = text.match(new RegExp(`^${name} ([0-9.eE+-]+)$`, 'm')); return m ? Number(m[1]) : null; };
  const buckets = {};
  for (const m of text.matchAll(/^yjs_store_duration_seconds_bucket\{le="([0-9.eE+-]+)"\} ([0-9.eE+-]+)$/gm)) buckets[m[1]] = Number(m[2]);
  return { rss: num('process_resident_memory_bytes'), heap: num('nodejs_heap_size_used_bytes'), docs: num('yjs_loaded_documents'), spoolBytes: num('yjs_spool_depth_bytes'), buckets };
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

const ts = Date.now();
const S = { user: `soak-u-${ts}`, team: `soak-t-${ts}`, member: `soak-m-${ts}`, token: `soak-tok-${randomUUID()}` };
const projectIds = Array.from({ length: OPTS.docs }, (_, i) => `soak-p-${ts}-${i}`);

async function main() {
  // 前置断言（collab-smoke 同款）：ready 才测——非服务态下编辑会被拒，测出的不是容量而是降级
  const ready = await fetch(`${API}/api/ready`).then((x) => x.json()).catch(() => null);
  if (!ready?.ready) throw new Error(`前置断言失败：/api/ready ready=${ready?.ready} reason=${ready?.reason}——先起服务再 soak`);

  const prisma = new PrismaClient();
  const providers = [];
  const editTimers = [];
  const warnings = [];
  let edits = 0;
  let connErrors = 0;
  const frameLatencies = [];
  const samples = [];
  try {
    await prisma.user.create({ data: { id: S.user, name: `soak-${ts}`, email: `soak-${ts}@example.invalid`, emailVerified: false } });
    await prisma.team.create({ data: { id: S.team, name: `soak-${ts}`, ownerId: S.user } });
    await prisma.teamMember.create({ data: { id: S.member, teamId: S.team, userId: S.user, role: 'MEMBER' } });
    await prisma.canvasProject.createMany({ data: projectIds.map((id) => ({ id, name: `soak-${ts}`, teamId: S.team })) });
    await prisma.session.create({ data: { id: `soak-s-${ts}`, userId: S.user, token: S.token, expiresAt: new Date(Date.now() + 30 * 60_000) } });

    // M clients 轮转铺到 N docs；帧延迟观察=各 client 对「他人 marker」的回显时延（own marker 恒 0 剔除）
    const cookie = { origin: WS_ORIGIN, cookie: `flowweb.session_token=${S.token}` };
    const seenKeys = Array.from({ length: OPTS.clients }, () => new Set());
    for (let ci = 0; ci < OPTS.clients; ci++) {
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
    }
    await Promise.all(providers.map((p) => new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('provider synced 超时 10s——WS 未监听/鉴权拒/装载失败')), 10_000);
      p.on('synced', () => { clearTimeout(t); res(); });
    })));
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
    const baseline = await sampleMetrics();
    samples.push({ t: 0, ...baseline });
    const endAt = t0 + OPTS.duration * 60_000;
    while (Date.now() < endAt - 1_000) {
      await sleep(Math.min(30_000, Math.max(1, endAt - Date.now())));
      const s = await sampleMetrics();
      samples.push({ t: Math.round((Date.now() - t0) / 1000), ...s });
      const frameP99 = frameLatencies.length ? frameLatencies.slice().sort((a, b) => a - b)[Math.floor(0.99 * (frameLatencies.length - 1))] : null;
      console.log(`[soak] sample#${samples.length - 1} rss=${(s.rss / 1048576).toFixed(1)}MB heap=${(s.heap / 1048576).toFixed(1)}MB docs=${s.docs} spool=${s.spoolBytes}B storeP99=${fmtMs(bucketP99(s.buckets, baseline))} frameP99=${fmtMs(frameP99)}`);
    }
    const finalS = await sampleMetrics();
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
  } finally {
    for (const t of editTimers) clearInterval(t);
    for (const p of providers) { try { p.destroy(); } catch (e) { warnings.push(`provider destroy 异常: ${e.message}`); } }
    const order = [
      () => prisma.session.deleteMany({ where: { userId: S.user } }),
      () => prisma.teamMember.deleteMany({ where: { id: S.member } }),
      () => prisma.canvasProject.deleteMany({ where: { teamId: S.team } }),   // Cascade 清 CanvasDoc/Update（N docs 一并）
      () => prisma.team.deleteMany({ where: { id: S.team } }),
      () => prisma.user.deleteMany({ where: { id: S.user } }),
    ];
    for (const del of order) await del().catch((e) => warnings.push(`哨兵清理失败（残留待人工删）: ${e.message}`));
    await prisma.$disconnect();
    for (const w of warnings) console.error(`SOAK-WARN: ${w}`);   // finally 内输出——main 中途 throw 时清理期告警也可见
  }
}

void main().catch((e) => { console.error(`soak FAIL: ${e instanceof Error ? e.message : e}`); process.exitCode = 1; });
