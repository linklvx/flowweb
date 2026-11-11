// apps/api/src/modules/media/media-fact.metrics.int.spec.ts —— C2-5（地基修复批·C2 卡，spec
// 2026-11-11-foundation-batch-design.md §3.1-5 观测）：真 PG 红绿——
//   ①media_fact_age_seconds{factType}：refresh 后每 factType 的最老行龄=镜像查询同值（±容差）——
//     证 age 指标真从 DB 行龄计算（canary 形态 5min 旧行给下界锚）；
//   ②media_fact_unfinished_state_age_seconds：state 维健康观测口径（Media.status≠completed 且
//     未软删——spec 措辞「status≠completed 且 age>阈值」，阈值先不告警只观测 P1 记录性）——processing
//     media 的 8min 旧行计入、completed media 的 30d 全表最旧行不驱动（镜像等值承载排除语义）；
//   ③media_fact_read_total{result}：facts 读计数器接线——ok=进入响应的 MediaFact 行数（合成行
//     不计）、bad_payload=坏 payload 跳过行数（C2-3 Logger.warn 计数升级为 metric，warn 双出口保留）；
//   ④事实 canary seed：seedMediaFactCanary 幂等（重跑不动 canary 行龄锚=updatedAt 恒定）+固定 ID
//     资产在位+真实团队 facts 读不可见（teamId 过滤）——生产环境 canary=只读断言（runbook §14.2）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaFactsController } from './media-facts.controller';
import {
  mediaFactAgeSeconds, mediaFactUnfinishedStateAgeSeconds, mediaFactReadTotal,
  refreshMediaFactAgeMetrics,
} from './media-fact.metrics';
import {
  seedMediaFactCanary, MEDIA_FACT_CANARY_USER_ID, MEDIA_FACT_CANARY_TEAM_ID, MEDIA_FACT_CANARY_MEDIA_ID,
} from '../../prisma/mediafact-canary.seed';
import { deleteTeamsWithPass } from '../../test-utils/intent-fixture';

const hasDb = !!process.env.DATABASE_URL;
const prisma = new PrismaClient();

/** 断言容差（秒）：镜像查询与 refresh 两次 DB 往返间的 now() 推进+行龄单调增长——串行池实际 <1s，5s 宽。 */
const TOL = 5;
/** 便捷分钟常量。 */
const MIN = 60;

const UID = `int-c25-owner-${Date.now()}`;
let TID = '';

/** gauge 当前样本值（缺样本=-1——refresh 必写两 series 与零值，缺样本即红）。 */
async function gaugeValue(g: typeof mediaFactAgeSeconds | typeof mediaFactUnfinishedStateAgeSeconds, factType?: string): Promise<number> {
  const m = await g.get();
  const hit = m.values.find((v) => (factType === undefined || (v.labels as { factType?: string }).factType === factType));
  return hit?.value ?? -1;
}

/** read_total 某 result 的当前累计值。 */
async function readTotal(result: string): Promise<number> {
  const m = await mediaFactReadTotal.get();
  return m.values.find((v) => (v.labels as { result?: string }).result === result)?.value ?? 0;
}

(hasDb ? describe : describe.skip)('C2-5：MediaFact 观测（真 PG）', () => {
  let ctrl: MediaFactsController;
  let M_PROC: string;   // processing media（state 行 8min 旧——unfinished 计入）
  let M_DONE_OLD: string;   // completed media（state 行 12min 更旧——不驱动 unfinished）
  let M_AGE_STATE: string;   // canary 形态：state 行 5min 旧（age 下界锚）
  let M_AGE_NAT: string;   // canary 形态：natural 行 3min 旧（age 下界锚）
  let M_GOOD: string;   // state+natural 双可用行（read_total ok 计数）
  let M_BAD: string;   // state 可用+natural 坏行（read_total ok/bad 双计数）

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-c25', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    TID = (await prisma.team.create({ data: { name: 'int-c25-team', ownerId: UID } })).id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    const now = Date.now();
    // type=uploaded+processing=惰性行（materialize 只 claim generated、probe 只 claim completed）
    const makeMedia = async (over: Record<string, unknown> = {}) =>
      (await prisma.media.create({
        data: {
          userId: UID, teamId: TID, key: `int-c25/${randomUUID().slice(0, 8)}`,
          originalName: 'a.png', mimeType: 'image/png', size: 1n, type: 'uploaded', ...over,
        },
      })).id;
    const fact = (mediaId: string, factType: 'state' | 'natural', ageMin: number, payload: Prisma.InputJsonValue, version = 1n) =>
      prisma.mediaFact.create({
        data: { mediaId, factType, factVersion: version, payload, updatedAt: new Date(now - ageMin * MIN * 1000) },
      });
    M_PROC = await makeMedia({ status: 'processing' });
    await fact(M_PROC, 'state', 8, { status: 'processing' });
    // 30d 旧（MediaFact 表 2026-11-11 C2-1 迁移才建——30d 恒为全表最老行）：completed 不驱动 unfinished
    // 的排除语义=镜像等值+上界断言双承载（误计入则 u≈30d 必红）
    M_DONE_OLD = await makeMedia({ status: 'completed' });
    await fact(M_DONE_OLD, 'state', 30 * 24 * 60, { status: 'completed' });
    M_AGE_STATE = await makeMedia({ status: 'completed' });
    await fact(M_AGE_STATE, 'state', 5, { status: 'completed' });
    M_AGE_NAT = await makeMedia({ status: 'completed' });
    await fact(M_AGE_NAT, 'natural', 3, { naturalWidth: 640, naturalHeight: 480 });
    M_GOOD = await makeMedia({ status: 'completed', factVersion: 2n });
    await fact(M_GOOD, 'state', 0, { status: 'completed' }, 2n);
    await fact(M_GOOD, 'natural', 0, { naturalWidth: 800, naturalHeight: 600 }, 2n);
    M_BAD = await makeMedia({ status: 'completed', factVersion: 1n });
    await fact(M_BAD, 'state', 0, { status: 'completed' });
    await fact(M_BAD, 'natural', 0, { naturalWidth: -1, naturalHeight: 5 });
    ctrl = new MediaFactsController(prisma as unknown as PrismaService);
  }, 20_000);

  afterAll(async () => {
    // canary 固定 ID 行保留（platform-team.seed.spec 同款——seed 等价幂等无害）；一次性团队级联清 media/fact
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  }, 20_000);

  it('①age gauge：refresh 后=镜像查询同值（±容差）且旧行给下界（证真在算非冻结常量）', async () => {
    await refreshMediaFactAgeMetrics(prisma);
    const mirror = await prisma.$queryRaw<Array<{ factType: string; ageSeconds: number | null }>>`
      SELECT "factType", EXTRACT(EPOCH FROM (now() - MIN("updatedAt")))::double precision AS "ageSeconds"
      FROM "MediaFact" GROUP BY "factType"`;
    const byType = new Map(mirror.map((r) => [r.factType, r.ageSeconds]));
    const stateAge = await gaugeValue(mediaFactAgeSeconds, 'state');
    const naturalAge = await gaugeValue(mediaFactAgeSeconds, 'natural');
    expect(Math.abs(stateAge - (byType.get('state') ?? -1))).toBeLessThanOrEqual(TOL);
    expect(Math.abs(naturalAge - (byType.get('natural') ?? -1))).toBeLessThanOrEqual(TOL);
    // canary 形态行（state 5min/natural 3min 旧）必计入 max 行龄——下界锚（证 gauge 读的是真行龄非常量）
    expect(stateAge).toBeGreaterThanOrEqual(5 * MIN - TOL);
    expect(naturalAge).toBeGreaterThanOrEqual(3 * MIN - TOL);
  });

  it('②unfinished-state gauge：processing 8min 行计入、completed 30d 最旧行不驱动（镜像等值承载排除语义）', async () => {
    await refreshMediaFactAgeMetrics(prisma);
    const mirror = await prisma.$queryRaw<Array<{ ageSeconds: number | null }>>`
      SELECT EXTRACT(EPOCH FROM (now() - MIN(f."updatedAt")))::double precision AS "ageSeconds"
      FROM "MediaFact" f JOIN "Media" m ON m."id" = f."mediaId"
      WHERE f."factType" = 'state' AND m."status" <> 'completed' AND m."deletedAt" IS NULL`;
    const u = await gaugeValue(mediaFactUnfinishedStateAgeSeconds);
    expect(Math.abs(u - (mirror[0]?.ageSeconds ?? -1))).toBeLessThanOrEqual(TOL);
    expect(u).toBeGreaterThanOrEqual(8 * MIN - TOL);   // M_PROC（processing）计入
    // M_DONE_OLD（completed，30d=全表最老 state 行）不驱动：误计入则 u≈30d 必红
    expect(u).toBeLessThan(30 * 24 * 60 * MIN - TOL);
  });

  it('③read_total 接线：一次 facts 读 ok=可用行数（合成行不计）、bad_payload=跳过行数', async () => {
    const ok0 = await readTotal('ok');
    const bad0 = await readTotal('bad_payload');
    const rows = await ctrl.facts({ user: { id: UID } } as never, TID, { mediaIds: [M_GOOD, M_BAD] });
    expect(rows).toHaveLength(2);   // 两 media 均出响应（M_BAD 坏 natural 行跳过、state 可用）
    expect(await readTotal('ok')).toBe(ok0 + 3);        // M_GOOD state+natural+M_BAD state（合成 state 不计）
    expect(await readTotal('bad_payload')).toBe(bad0 + 1);   // M_BAD 坏 natural 行
  });

  it('④事实 canary：seed 幂等（重跑不动行龄锚）+固定 ID 资产在位+真实团队 facts 读不可见', async () => {
    await seedMediaFactCanary(prisma);
    const first = await prisma.mediaFact.findUnique({
      where: { mediaId_factType: { mediaId: MEDIA_FACT_CANARY_MEDIA_ID, factType: 'state' } },
    });
    expect(first).toBeTruthy();
    await seedMediaFactCanary(prisma);   // 重跑幂等——canary 行龄锚（updatedAt）不动
    const second = await prisma.mediaFact.findUnique({
      where: { mediaId_factType: { mediaId: MEDIA_FACT_CANARY_MEDIA_ID, factType: 'state' } },
    });
    expect(second?.updatedAt.getTime()).toBe(first?.updatedAt.getTime());
    const team = await prisma.team.findUnique({ where: { id: MEDIA_FACT_CANARY_TEAM_ID } });
    const media = await prisma.media.findUnique({ where: { id: MEDIA_FACT_CANARY_MEDIA_ID } });
    const member = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: MEDIA_FACT_CANARY_TEAM_ID, userId: MEDIA_FACT_CANARY_USER_ID } },
    });
    expect(team?.name.startsWith('canary-')).toBe(true);   // 命名带 canary- 标记（防误清理误判）
    expect(media?.teamId).toBe(MEDIA_FACT_CANARY_TEAM_ID);
    expect(media?.status).toBe('completed');   // 完成态=不进 unfinished 健康口径（canary 不污染健康信号）
    expect(member?.role).toBe('OWNER');
    const natural = await prisma.mediaFact.findUnique({
      where: { mediaId_factType: { mediaId: MEDIA_FACT_CANARY_MEDIA_ID, factType: 'natural' } },
    });
    expect(natural?.payload).toEqual({ naturalWidth: 1, naturalHeight: 1 });
    // 真实团队读 canary mediaId 静默不返（facts 端点 teamId 过滤——synthetic team 行对真实团队不可见）
    const rows = await ctrl.facts({ user: { id: UID } } as never, TID, { mediaIds: [MEDIA_FACT_CANARY_MEDIA_ID] });
    expect(rows).toEqual([]);
  });
});
