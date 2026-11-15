// TD-33/C1b T9：ErasureRegistry 指标面（*.metrics.ts 单源——check-spec-consistency 提取域）。
// 口径单源=spec §3.1：C1b 合计 5 gauge + 3 counter（v15 新增 3 gauge+1 counter，v16 新增 refresh 失败 1）。
// 标签纪律：全低基数（无 projectId 标签——集合大小即观测面）。
import { Counter, Gauge, register } from 'prom-client';

/** blocked 集合大小（写拒绝面——随历史擦除单调增长：DONE run 行禁清理⇒gauge=增长观测面）。 */
export const yjsBlockedProjects = new Gauge({
  name: 'yjs_blocked_projects',
  help: 'spool 写拒绝项目数（DB 权威快照：非 ACTIVE 项目/团队∪project scope run 非 DONE/FAILED 或 terminal∧ACTIVE 行）',
  registers: [register],
});

/** purgeable 集合大小（可清残面——run 终态∧CanvasProject 行不存在）。 */
export const yjsPurgeableProjects = new Gauge({
  name: 'yjs_purgeable_projects',
  help: 'spool 可清残项目数（project scope 非 dry-run run 终态∧CanvasProject 行不存在）',
  registers: [register],
});

/** restore-pending 子集大小（terminal run∧ACTIVE 行——restore 后旧 spool 禁重放，须 restore-reerase+离线重启）。 */
export const restorePendingProjects = new Gauge({
  name: 'restore_pending_projects',
  help: 'restore-pending 项目数（terminal run〔DONE/FAILED〕∧CanvasProject ACTIVE 行——拒写不清，恢复=restore-reerase+离线重启）',
  registers: [register],
});

/** purgeable 项目 spool 字节（T14 sweep 同次 listSpoolFiles 分组累计写入）。 */
export const purgeableSpoolBytes = new Gauge({
  name: 'purgeable_spool_bytes',
  help: 'purgeable 项目残段字节数（spool sweep 同次扫盘分组累计）',
  registers: [register],
});

/** registry 年龄（ms）——刷新成功归零；失败继续增长（>3×周期告警）。 */
export const erasureRegistryAgeMs = new Gauge({
  name: 'erasure_registry_age_ms',
  help: 'ErasureRegistry 快照年龄毫秒（refresh 成功=0；失败保留旧 Map 并增长——>3×周期=告警面）',
  registers: [register],
});

/** spool sweep 失败次数（live purgeable 查询/清理失败——下轮重试）。 */
export const purgeSweepFailuresTotal = new Counter({
  name: 'purge_sweep_failures_total',
  help: 'spool sweep 失败次数（live purgeable 批量查询或段清理失败；listen 不挡，下轮重试）',
  registers: [register],
});

/** manifestPath 缺失计数（per-pid 每进程一次——持续状态非事件，10s refresh 重复见同一 pid 不去重=无界增长）。 */
export const erasureManifestMissingTotal = new Counter({
  name: 'erasure_manifest_missing_total',
  help: 'purgeable run 的 manifestPath 缺失数（每 pid 每进程一次；缺失不阻断清理——审计缺口归巡检）',
  registers: [register],
});

/** registry refresh 查询失败次数（失败保留旧 Map 不替换——fail-closed）。 */
export const erasureRefreshFailuresTotal = new Counter({
  name: 'erasure_refresh_failures_total',
  help: 'ErasureRegistry refresh 查询失败次数（旧 blocked 保持不清空；age 继续增长）',
  registers: [register],
});
