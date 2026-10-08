// apps/api/scripts/collab-smoke.mjs —— Y0a-4 post-deploy 冒烟（spec §4.4 三步+P21 强化）
// 运行（服务器）：cd ~/flowweb && pnpm --filter @flowweb/api exec node scripts/collab-smoke.mjs
// 运行（本地）  ：同命令（先 pnpm verify 保证 dist 新鲜——本脚本验的是部署产物 dist，不是 src）
// 形态：node 直跑（零 tsx）+dotenv 自加载（B3′）+dist 导入（验产物）
//      +双客户端（A/B 互写 marker 断言互见=协作广播链）+ready 前置断言（只读降级不误诊为落库失败）
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

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

async function step0_readyAssert() {
  const r = await fetch(`${API}/api/ready`).then((x) => x.json()).catch(() => null);
  if (r === null) throw new Error(`前置断言失败：/api/ready API 不可达（fetch 失败）——API 未启动/端口 ${API} 不对，先起服务再冒烟`);
  if (!r.ready) throw new Error(`前置断言失败：/api/ready ready=${r.ready} reason=${r.reason}——spool 只读降级/未服务态下 provider 写入会被拒，先查 ready 再冒烟（禁误诊为"未落库"）`);
}

async function main() {
  await step0_readyAssert();
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma);
  const warnings = [];
  let lastInfo = { updates: -1 };
  try {
    await prisma.user.create({ data: { id: S.user, name: `smoke-${ts}`, email: `smoke-${ts}@example.invalid`, emailVerified: false } });
    await prisma.team.create({ data: { id: S.team, name: `smoke-${ts}`, ownerId: S.user } });
    await prisma.teamMember.create({ data: { id: S.member, teamId: S.team, userId: S.user, role: 'MEMBER' } });
    await prisma.canvasProject.create({ data: { id: S.project, name: `smoke-${ts}`, teamId: S.team } });
    await prisma.session.create({ data: { id: `smoke-s-${ts}`, userId: S.user, token: S.token, expiresAt: new Date(Date.now() + 10 * 60_000) } });

    const mk = () => new HocuspocusProvider({ url: `${WS_URL}?token=${S.token}`, name: `project:${S.project}`, document: new Y.Doc() });
    const A = mk(), B = mk();
    const synced = (p) => new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('provider synced 超时 10s——3001 未监听/鉴权拒/装载失败')), 10_000);
      p.on('synced', () => { clearTimeout(t); res(); });   // 成功路径清 timer——否则绿态进程多挂最长 10s
    });
    try {
      await Promise.all([synced(A), synced(B)]);
      A.document.transact(() => A.document.getMap('nodes').set(MARKERS[0], new Y.Map([['kind', 'smoke']])));
      B.document.transact(() => B.document.getMap('nodes').set(MARKERS[1], new Y.Map([['kind', 'smoke']])));
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
