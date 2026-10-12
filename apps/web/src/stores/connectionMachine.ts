// apps/web/src/stores/connectionMachine.ts
/** 批1：连接状态机判定纯函数（表驱动——阈值/分级可枚举可回归）。
 *  Y0b-5 T3b（裁定 23⑴/24⑷④）降级改写：恢复动作面（action/快线/unhealthy 门/冷却/退避表/
 *  抑制器）整体退役——恢复所有权归 connection-supervisor（watchdog 零 kick 路径）；
 *  本模块只剩 UI 分级电平（ok/hint/banner——SyncBanner 消费）+ unhealthySince 追踪。
 *  纯度纪律：零 Math.random（旧 jitter 阈值入参随 action 删除一并退役）。 */
export const TICK_MS = 3_000;
export const STALE_INBOUND_MS = 45_000;
export const BANNER_MS = 90_000;

export interface MachineInputs {
  now: number;
  healthy: boolean;
  unhealthySince: number | null;
}
export type MachineOutput = { ui: 'ok' | 'hint' | 'banner'; unhealthySince: number | null };

export function reduce(s: MachineInputs): MachineOutput {
  const unhealthySince = s.healthy ? null : (s.unhealthySince ?? s.now);
  const elapsed = unhealthySince == null ? 0 : s.now - unhealthySince;
  const ui = s.healthy ? 'ok'
    : (elapsed >= BANNER_MS ? 'banner'
      : (elapsed >= STALE_INBOUND_MS ? 'hint' : 'ok'));
  return { ui, unhealthySince };
}
