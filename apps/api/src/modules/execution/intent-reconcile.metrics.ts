import { Counter, register } from 'prom-client';

/** F12 每日三方对账资损前兆计数（SLO 信号——阈值上线前定；批 7 接 collabDiagnostics 面板） */
export const reconcileMismatchTotal = new Counter({
  name: 'intent_reconcile_mismatch_total',
  help: '每日对账：SUCCEEDED creditsConsumed 与消费流水数额不一致次数（资损前兆）',
  registers: [register],
});
