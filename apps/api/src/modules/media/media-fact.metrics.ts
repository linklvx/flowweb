// apps/api/src/modules/media/media-fact.metrics.ts —— C2-5（地基修复批·C2 卡，spec
// 2026-11-11-foundation-batch-design.md §3.1-5 观测）：MediaFact 当前态表观测面。载面纪律同
// delivery-lag.metrics.ts（*.metrics.ts + metric-names 基线同 commit——check-spec-consistency
// --write-metric-names 先例）。
// 口径（spec §3.1-5/plan v3 C2-5）：
//   - media_fact_age_seconds{factType}：每 factType 最老当前态行行龄秒（gauge——dashboard 用；
//     空 factType 归零防冻结陈旧正值，mediaMaterializeLag 同纪律）。**明确不做 version_lag 告警**
//     （Media.factVersion 是跨 factType 的全局递增计数——natural 行版本天然滞后→永久假 lag，反模式；
//     staleness 的健康观测走下行 unfinished-state 口径）。
//   - media_fact_unfinished_state_age_seconds：state 维健康观测口径=Media.status≠completed 且未软删
//     的最老 state 行龄（spec 措辞「status≠completed 且 age>阈值」——阈值先不告警只观测，P1 级记录性；
//     软删行排除=与 probe/materialize claim 同口径，软删 processing 行永久滞留不构成管道停滞信号）。
//   - media_fact_read_total{result}：facts 读计数（ok=进入响应的 MediaFact 表行数——Media.status 合成
//     行不计；bad_payload=坏 payload 跳过行数——C2-3 的 Logger.warn 计数出口升级为 metric，warn 保留双出口）。
// 进程拓扑：read_total 在 api 进程（facts 端点）；两 gauge 由 worker 进程 MediaProbePoller 每 tick 头
// 刷新（materialize observeLag 同款——非每请求全表扫，一次刷新并发两聚合查询；api 进程同名 series
// 恒 0 幽灵——抓取/告警只认 worker 实例，分诊注记=runbook §14.2）。
import { Counter, Gauge, register } from 'prom-client';
import { Prisma } from '@prisma/client';

/** 每 factType 最老当前态行行龄秒（dashboard 用——事实 canary 行也计入统计，synthetic team 行
 *  对真实团队查询不可见但行龄照算——canary 断言窗锚，runbook §14.2）。 */
export const mediaFactAgeSeconds = new Gauge({
  name: 'media_fact_age_seconds',
  help: 'C2-5（spec §3.1-5）：MediaFact 当前态表每 factType 最老行行龄秒（dashboard 用；不做 version_lag——factVersion 跨 factType 全局递增 natural 恒假滞后反模式；空 factType 归零）',
  labelNames: ['factType'],
  registers: [register],
});

/** state 维健康观测（P1 记录性——阈值先不告警）：Media.status≠completed 且未软删的最老 state 行龄秒。 */
export const mediaFactUnfinishedStateAgeSeconds = new Gauge({
  name: 'media_fact_unfinished_state_age_seconds',
  help: 'C2-5（spec §3.1-5）：state 维健康观测口径——Media.status≠completed 且未软删的最老 state 行龄秒（「status≠completed 且 age>阈值」的记录性观测，阈值告警后置；软删排除=probe/materialize claim 同口径）',
  registers: [register],
});

/** facts 读计数（result=ok/bad_payload——与 controller skippedBadPayload 出口对接）。 */
export const mediaFactReadTotal = new Counter({
  name: 'media_fact_read_total',
  help: 'C2-5（spec §3.1-5）：facts 端点读计数（result=ok=进入响应的 MediaFact 表行数，Media.status 合成行不计；bad_payload=坏 payload 跳过行数——C2-3 warn 计数出口的 metric 升级，warn 保留双出口）',
  labelNames: ['result'],
  registers: [register],
});

/** refresh 可接受的 DB 面（PrismaService/PrismaClient/测试直连客户端同构——$queryRaw 单依赖）。 */
export type MediaFactMetricsDb = Pick<Prisma.TransactionClient, '$queryRaw'>;

/** 刷新两行龄 gauge（每 tick 头调用——MediaProbePoller worker 进程；MediaFact.updatedAt=timestamptz，
 *  now()−tsz→interval 全 TZ 安全，EXTRACT(EPOCH)=瞬时差豁免面）。 */
export async function refreshMediaFactAgeMetrics(db: MediaFactMetricsDb): Promise<void> {
  const [byTypeRows, unfinishedRows] = await Promise.all([
    db.$queryRaw<Array<{ factType: string; ageSeconds: number | null }>>(Prisma.sql`
      SELECT "factType", EXTRACT(EPOCH FROM (now() - MIN("updatedAt")))::double precision AS "ageSeconds"
      FROM "MediaFact" GROUP BY "factType"`),
    db.$queryRaw<Array<{ ageSeconds: number | null }>>(Prisma.sql`
      SELECT EXTRACT(EPOCH FROM (now() - MIN(f."updatedAt")))::double precision AS "ageSeconds"
      FROM "MediaFact" f JOIN "Media" m ON m."id" = f."mediaId"
      WHERE f."factType" = 'state' AND m."status" <> 'completed' AND m."deletedAt" IS NULL`),
  ]);
  const byType = new Map(byTypeRows.map((r) => [r.factType, r.ageSeconds]));
  mediaFactAgeSeconds.set({ factType: 'state' }, byType.get('state') ?? 0);
  mediaFactAgeSeconds.set({ factType: 'natural' }, byType.get('natural') ?? 0);
  mediaFactUnfinishedStateAgeSeconds.set(unfinishedRows[0]?.ageSeconds ?? 0);
}
