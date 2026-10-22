// apps/api/src/modules/media-delivery/delivery-lag.metrics.ts —— T19 评审收口（P1#1①）：
// soak 证据义务四 gauge（spec 2026-10-18 design :518 观测增补钉名——doc_delivery_lag_seconds/
// doc_delivery_applied_unpersisted/media_fact_outbox_lag/media_materialize_lag）。
// 口径（各 owner，gauge=瞬时态供 soak 采样时序算 p95/稳态判读）：
//   - doc_delivery_lag_seconds：投影交付滞后=最老非终态（pending/projecting）ArtifactProjection
//     行龄（createdAt≈finalize 建 pending 行时点——「projected 行龄 vs finalize 时点」的队列态表达；
//     projected 转换即离开扫描集）。与 artifact_projection_pending_age_seconds 同查询同值
//     （彼=T15 既有名，此=spec :518 钉名面——互注禁拆两处查询）。
//   - doc_delivery_applied_unpersisted：本轮投影 tick 中「doc 已 apply 而 flush 未 persisted」的
//     行数——**tick 全部 project 累计**（质评 Important#1：组内直 set 的跨 project last-writer-wins
//     缺口根修——tick 头清零+循环累加+循环后一次 set；terminal fk/早退档计 0〔行已终态化/未 apply，
//     无待持久语义〕；稳态目标=0，spool 回灌后下轮归零）。
//   - media_fact_outbox_lag：事实投递滞后=最老 pending（未投递）MediaFactOutbox 行龄——刷新点=
//     facts 拉取端点（消费即观测：无人拉=无人观测滞后，at-least-once 拉模型语义）+retention 兜底。
//   - media_materialize_lag：物化滞后=最老 processing∧video∧generated Media 行龄（MaterializeJob
//     每 tick 刷新——空轮归零；持续增长=下载退避/lease 争用/终态不收敛信号）。
import { Gauge, register } from 'prom-client';

export const docDeliveryLagSeconds = new Gauge({
  name: 'doc_delivery_lag_seconds',
  help: 'T19（spec :518 钉名）：投影交付滞后——最老非终态 ArtifactProjection 行龄秒（createdAt≈finalize 时点；与 artifact_projection_pending_age_seconds 同查询同值互注）',
  registers: [register],
});

export const docDeliveryAppliedUnpersisted = new Gauge({
  name: 'doc_delivery_applied_unpersisted',
  help: 'T19（spec :518 钉名）：本轮投影 tick 全部 project 中 doc 已 apply 而 flush 未 persisted 的累计行数（persisted/terminal-fk/早退⇒0；spooled/failed⇒组行数累计——tick 头清零+循环后一次 set；稳态目标=0）',
  registers: [register],
});

export const mediaFactOutboxLag = new Gauge({
  name: 'media_fact_outbox_lag',
  help: 'T19（spec :518 钉名）：事实投递滞后——最老 pending MediaFactOutbox 行龄秒（facts 拉取端点刷新——消费即观测）',
  registers: [register],
});

export const mediaMaterializeLag = new Gauge({
  name: 'media_materialize_lag',
  help: 'T19（spec :518 钉名）：物化滞后——最老 processing∧video∧generated Media 行龄秒（MaterializeJob 每 tick 刷新——空轮归零）',
  registers: [register],
});
