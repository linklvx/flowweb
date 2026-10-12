// apps/web/src/stores/connectionMachine.spec.ts
// 批1-1 恢复门纯函数——Y0b-5 T3b 降级改写后的形态（裁定 23⑴/24⑷④）：
// 恢复动作面（action/快线/unhealthy 门/冷却/退避表/抑制器）整体退役（表已删消费点已删——
// RECOVER_BACKOFF_MS 随 connectionMachine 整删，退避单源=shared TRANSIENT_BACKOFF_STEPS_MS，
// 消费者=connection-supervisor）；本模块只剩 UI 分级 + unhealthySince 追踪。
// reduce 零 IO——纯函数直测（now 确定入参，无 fake timers）；
// 集成锚（watchdog 真跑）在 canvasCollabRuntime.conn.spec.ts。
import { describe, it, expect } from 'vitest';
import {
  reduce, TICK_MS, STALE_INBOUND_MS, BANNER_MS,
  type MachineInputs,
} from './connectionMachine';
import * as cm from './connectionMachine';

/** 基线输入：健康（各判据只改相关字段——表驱动可回归） */
const BASE: MachineInputs = {
  now: 1_000_000,
  healthy: true,
  unhealthySince: null,
};

describe('批1-1 connectionMachine（T3b 降级形态）：常量表+退役面', () => {
  it('TICK=3s / STALE_INBOUND=45s / BANNER=90s', () => {
    expect(TICK_MS).toBe(3_000);
    expect(STALE_INBOUND_MS).toBe(45_000);
    expect(BANNER_MS).toBe(90_000);
  });

  it('表已删消费点已删：RECOVER_BACKOFF_MS/FAST_LANE_MS 导出不存在（退避单源=shared，消费者=supervisor）', () => {
    expect('RECOVER_BACKOFF_MS' in cm).toBe(false);
    expect('FAST_LANE_MS' in cm).toBe(false);
  });

  it('输出形状：仅 {ui, unhealthySince}——零 action 字段（第三态清零锚）', () => {
    const out = reduce(BASE);
    expect(Object.keys(out).sort()).toEqual(['ui', 'unhealthySince']);
  });
});

describe('批1-1 connectionMachine：UI 分层（批1-5 SyncBanner 消费）', () => {
  it('判据8 healthy ⇒ ok（unhealthySince 清 null）', () => {
    const out = reduce({ ...BASE, unhealthySince: BASE.now - 100_000 });
    expect(out.ui).toBe('ok');
    expect(out.unhealthySince).toBeNull();
  });

  it('判据8 unhealthy：elapsed<45s ⇒ ok；≥45s ⇒ hint；≥90s ⇒ banner', () => {
    expect(reduce({ ...BASE, healthy: false, unhealthySince: BASE.now - 44_999 }).ui).toBe('ok');
    expect(reduce({ ...BASE, healthy: false, unhealthySince: BASE.now - 45_000 }).ui).toBe('hint');
    expect(reduce({ ...BASE, healthy: false, unhealthySince: BASE.now - 90_000 }).ui).toBe('banner');
  });

  it('unhealthySince=null（本 tick 起始断裂）⇒ 输出补 now（下 tick 起计时）', () => {
    const out = reduce({ ...BASE, healthy: false, unhealthySince: null });
    expect(out.unhealthySince).toBe(BASE.now);
    expect(out.ui).toBe('ok'); // elapsed=0
  });

  it('纯函数无状态：同输入连续两次调用输出恒同', () => {
    const inp = { ...BASE, healthy: false, unhealthySince: BASE.now - 46_000 };
    expect(reduce(inp)).toEqual(reduce(inp));
  });
});
