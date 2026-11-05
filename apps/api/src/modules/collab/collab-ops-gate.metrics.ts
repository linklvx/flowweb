// apps/api/src/modules/collab/collab-ops-gate.metrics.ts
// C2-1（plan Task C2-1——生产就绪收尾批，spec v5 §3 C2）：OpsGate compact 门指标面。
// *.metrics.ts 单源惯例（THRESHOLDS it1 机器断言键 ⊆ 本文件提取集——新指标落本文件非 service 模块级）。
// 标签纪律：全低基数禁 projectId（E54 基调——冻结项目归结构化日志/top-N）；result=闭集词表。
// source 双进程注记：service 为 free-function（repo compact ①授权读/③发布事务 FOR SHARE/
// vacuumReplace 前置三面+poller tick 面）——api（maybeCompact 触发链）与 worker（tick 触发链）
// 都可能 inc compact_gate_skip_total；frozen_age gauge 的确定性维护面=worker 3002（compact
// poller boot 扫行初始化+每 tick 聚合刷新——api 进程族经 import 链在场但非维护面，api 3000 恒 0
// 死键：THRESHOLDS 条目=声明面，操作判定路径=check-collab-health evaluate OPS_GATE_CHECKS 段
// 读 worker 3002——retention/C3 同款声明形态）。
import { Counter, Gauge, register } from 'prom-client';

/** compact 门拒计数（result 闭集）：frozen-global=全局哨兵行 FROZEN / frozen-project=项目行 FROZEN /
 *  fail-closed=两行校验缺行（<2）∨闭集外 state 值（红① 三档的拒半边）。三触发面共用：repo compact
 *  ①授权读（非事务快速判定）+③发布事务 FOR SHARE 两行校验（正确性承载）+vacuumReplace 前置检查。 */
export const compactGateSkipTotal = new Counter({
  name: 'compact_gate_skip_total',
  help: 'C2-1 OpsGate compact 门拒计数（result=frozen-global 全局行 FROZEN/frozen-project 项目行 FROZEN/fail-closed 两行校验缺行或闭集外值——compact ①授权读+③发布事务 FOR SHARE+vacuumReplace 前置三面；api+worker 双进程触发面；冻结处置序 runbook §14 归 C2-3）',
  labelNames: ['result'],
  registers: [register],
});

/** FROZEN 行最老冻结年龄秒（全局 max=MIN(frozenAt) 聚合——无 projectId 标签）。维护面=worker 3002：
 *  compact poller boot 扫行初始化+每 tick 聚合刷新（C3 worker boot 首 tick await 先例）+freeze 后
 *  best-effort 刷新。年龄增长由巡检侧判（P1@1h/P0@6h——THRESHOLDS age-tier 声明+OPS_GATE_CHECKS 段
 *  操作判定）；解冻 ack 后回落 0。 */
export const collabOpsGateFrozenAge = new Gauge({
  name: 'collab_ops_gate_frozen_age',
  help: 'C2-1 OpsGate FROZEN 行最老冻结年龄秒（全局 max——MIN(frozenAt) 聚合无 projectId 标签；source=worker 3002：compact poller boot 扫行初始化+每 tick 刷新+freeze 后 best-effort——api 3000 恒 0 死键声明面；P1@1h/P0@6h 分级告警，解冻 ack 回落 0）',
  registers: [register],
});
