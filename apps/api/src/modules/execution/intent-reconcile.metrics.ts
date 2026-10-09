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

/** Y0b-1（F7）：终态∧reservedCredits>0 的行到达保留期仍无法清理（settle 失败悬留——第四分支清账后次轮自然可删）。
 *  持续增长=settleStranded 闭环失效（毒行冻结保留期）——SLO 信号。 */
export const strandedTotal = new Counter({
  name: 'intent_frozen_stranded_total',
  help: '终态冻结悬留行计数（settle 失败悬留到保留期——第四分支闭环失效信号）',
  registers: [register],
});

/** Y0b-1（Z11）：不变量①漂移（per (teamId,creditType) ΣbalanceDelta ≢ 池余额，或 ACTIVE 团队无钱包行）
 *  ——台账为真源，钱包可据 Σ 重建；漂移=资损级信号。 */
export const balanceDriftTotal = new Counter({
  name: 'ledger_balance_drift_total',
  help: '不变量①漂移计数（池余额 ≢ ΣbalanceDelta 或 ACTIVE 团队缺钱包行）',
  registers: [register],
});

/** Y0b-1（Z11）：不变量②漂移（RUNNING 意图 per intent ΣfrozenDelta ≢ reservedCredits）——冻结账与意图行脱钩信号。 */
export const frozenDriftTotal = new Counter({
  name: 'ledger_frozen_drift_total',
  help: '不变量②漂移计数（RUNNING 意图 ΣfrozenDelta ≢ reservedCredits）',
  registers: [register],
});

/** Y0b-1（Z11）：孤儿冻结释放成功计数——reserve 行未被冲销∧意图行灭失∧超龄 ⇒ 窄口幂等释放。 */
export const orphanReleaseTotal = new Counter({
  name: 'intent_frozen_orphan_total',
  help: '孤儿冻结释放计数（意图行已灭失的未冲销 reserve——releaseOrphanReserve 窄口）',
  registers: [register],
});

/** Y0b-1（Z11）：不可释放的未冲销 reserve 行计数（团队解散钱包已级联删——quota/冻结永久残余登记，不可自动修复）。
 *  每轮观测计数语义（T5 质量审 I-2）：这批行永不冲销，同一批每轮重复计入——读 rate/突增非累计值。 */
export const orphanUnreleasableTotal = new Counter({
  name: 'ledger_orphan_unreleasable_total',
  help: '不可释放孤儿冻结计数（钱包已消失——解散销毁，残余登记；每轮观测语义——看 rate 非累计）',
  registers: [register],
});
