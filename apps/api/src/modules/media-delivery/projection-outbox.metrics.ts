// apps/api/src/modules/media-delivery/projection-outbox.metrics.ts
// Y1a+Y1b T15（spec Z18''④/:91）：投影 poller 观测面——六终态转移计数（outcome 含 fast-path 命中率
// 分档）+pending 龄 gauge（poller lag）。*.metrics.ts 载面=spec §10 metric-names 块同 commit 同步
// （check-spec-consistency 双向核——code 为源，--write-metric-names 落盘先例）。
import { Counter, Gauge, register } from 'prom-client';

/** 六终态转移+重试/fenced 分档（spec Z18''④：projected/superseded/orphaned/dead 四终态转移 +
 *  fast-path（内容等值命中——projected 的跳 apply 分档，命中率=fast-path/(fast-path+projected)）+
 *  retry-spooled/retry-failed（T14 FlushOutcome 传递面）+fenced（epoch 易主拒提交——不耗 attempts 档）。 */
export const artifactProjectionOutcomeTotal = new Counter({
  name: 'artifact_projection_outcome_total',
  help: 'Y1b T15：ArtifactProjection 投影循环逐行转移计数（outcome=projected/fast-path/superseded/orphaned/dead/retry-spooled/retry-failed/fenced——六终态+重试分档；fast-path=内容等值跳 apply 命中档）',
  labelNames: ['outcome'],
  registers: [register],
});

/** poller lag：最老非终态投影行龄（秒）——每 tick 由 poller 刷新（无 pending=0）。 */
export const artifactProjectionPendingAgeSeconds = new Gauge({
  name: 'artifact_projection_pending_age_seconds',
  help: 'Y1b T15：投影 poller lag——最老非终态（pending/projecting）投影行龄秒数（每 tick 刷新；0=队列空）',
  registers: [register],
});
