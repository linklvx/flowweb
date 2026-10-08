import { Counter, register } from 'prom-client';

/** F12 每日三方对账资损前兆计数（SLO 信号——阈值上线前定；批 7 接 collabDiagnostics 面板） */
export const reconcileMismatchTotal = new Counter({
  name: 'intent_reconcile_mismatch_total',
  help: '每日对账：SUCCEEDED creditsConsumed 与消费流水数额不一致次数（资损前兆）',
  registers: [register],
});

/** Y0b-1（P8/§1.3 第四分支）：settle 未达——外呼成功但核销失败（已消费未计账）。
 *  执行链语义：totalDeducted 不加 cost（emit 的 totalCost=实扣真值，冻结≠消费）+产物照发（E53），
 *  账由每日对账第四分支闭环（deliveredAt 有值→补 settle）。 */
export const settleFailureTotal = new Counter({
  name: 'execution_settle_failure_total',
  help: 'settle 未达次数（外呼成功但核销失败——冻结由对账兜底，产物照发）',
  registers: [register],
});

/** Y0b-1（Z35）：同意图重复外呼企图——alreadyReserved（stall 重排双 worker）静默退出时计数（零副作用）。 */
export const intentDuplicateAttemptTotal = new Counter({
  name: 'intent_duplicate_attempt_total',
  help: '同意图重复外呼企图（alreadyReserved 静默退出——不 void_/不 fail/不 emit）',
  registers: [register],
});
