// apps/web/src/stores/connectionMachine.ts
/** 批1：连接状态机判定纯函数（表驱动——阈值/分级/jitter/冷却可枚举可回归）。
 *  纯度纪律：jitter 阈值由 runtime 侧生成后**作为入参传入**（gateMs/cooldownMs）——本模块零 Math.random。
 *  电平输入（禁读派生 connStatus——黑洞下恒 connecting）；输出=恢复动作+UI 级别。 */
export const TICK_MS = 3_000;
export const STALE_INBOUND_MS = 45_000;
export const FAST_LANE_MS = 15_000;
export const BANNER_MS = 90_000;
export const RECOVER_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000]; // 封顶永不停止

export interface MachineInputs {
  now: number;
  healthy: boolean;
  fastLaneEligible: boolean;
  gateMs: number;
  cooldownMs: number;
  hydrationPending: boolean;
  unhealthySince: number | null;
  recoveryAttempts: number;
  lastRecoveryAt: number;
  terminal: boolean; hidden: boolean; offline: boolean;
}
export type MachineOutput = { action: 'none' | 'recover'; ui: 'ok' | 'hint' | 'banner'; unhealthySince: number | null };

export function reduce(s: MachineInputs): MachineOutput {
  const unhealthySince = s.healthy ? null : (s.unhealthySince ?? s.now);
  const elapsed = unhealthySince == null ? 0 : s.now - unhealthySince;
  const gateHit = !s.hydrationPending && unhealthySince != null && elapsed > s.gateMs;
  const eligible = s.fastLaneEligible || gateHit;
  const cooldownOk = s.now - s.lastRecoveryAt >= s.cooldownMs;
  const suppressed = s.terminal || s.hidden || s.offline;
  const ui = s.healthy ? 'ok'
    : (elapsed >= BANNER_MS || s.recoveryAttempts >= 3 ? 'banner'
      : (elapsed >= STALE_INBOUND_MS ? 'hint' : 'ok'));
  return {
    action: !s.healthy && eligible && cooldownOk && !suppressed ? 'recover' : 'none',
    ui, unhealthySince,
  };
}
