// apps/web/src/stores/connectionMachine.spec.ts
// 批1-1 恢复门纯函数（spec 红2-恢复组）：三门电平析取（快线/unhealthy 门）+ 冷却/抑制 +
// UI 分层 + 退避表封顶 + jitter 入参化。reduce 零 IO——纯函数直测（now 确定入参，无 fake timers）；
// 集成锚（watchdog 真跑）在 canvasCollabRuntime.conn.spec.ts。
import { describe, it, expect } from 'vitest';
import {
  reduce, TICK_MS, STALE_INBOUND_MS, FAST_LANE_MS, BANNER_MS, RECOVER_BACKOFF_MS,
  type MachineInputs,
} from './connectionMachine';

/** 基线输入：健康、无恢复史、无抑制——各判据只改相关字段（表驱动可回归） */
const BASE: MachineInputs = {
  now: 1_000_000,
  healthy: true,
  fastLaneEligible: false,
  gateMs: STALE_INBOUND_MS,
  cooldownMs: 15_000,
  hydrationPending: false,
  unhealthySince: null,
  recoveryAttempts: 0,
  lastRecoveryAt: 0,
  terminal: false,
  hidden: false,
  offline: false,
};

/** unhealthy 门已开形态：断裂 46s > 45s 门（hydration/冷却/抑制全关） */
const gateHit = { ...BASE, healthy: false, unhealthySince: BASE.now - 46_000 };

describe('批1-1 connectionMachine：常量表（阈值可枚举锚）', () => {
  it('TICK=3s / STALE_INBOUND=45s / FAST_LANE=15s / BANNER=90s / 退避表封顶 30s', () => {
    expect(TICK_MS).toBe(3_000);
    expect(STALE_INBOUND_MS).toBe(45_000);
    expect(FAST_LANE_MS).toBe(15_000);
    expect(BANNER_MS).toBe(90_000);
    expect(RECOVER_BACKOFF_MS).toEqual([5_000, 10_000, 20_000, 30_000]);
  });
});

describe('批1-1 connectionMachine：恢复门（三门析取）', () => {
  it('判据1 快线：connected 未鉴权>15s（fastLaneEligible）+ 其余门关 ⇒ recover（DENY 黑洞形态）', () => {
    // unhealthy 门刻意关着（断裂仅 5s < 45s 门）——证明是快线独立触发
    const out = reduce({ ...BASE, healthy: false, fastLaneEligible: true, unhealthySince: BASE.now - 5_000 });
    expect(out.action).toBe('recover');
  });

  it('判据2 unhealthy 门：健康电平断裂超门（46s > 45s）⇒ recover', () => {
    expect(reduce(gateHit).action).toBe('recover');
  });

  it('判据2 从未健康：unhealthySince=startedAt 初值同样按门计时触发（首帧黑洞/挂起握手从 t0 计）', () => {
    const startedAt = BASE.now - 46_000; // runtime 侧 initCollab 把 unhealthySince 初始化为 startedAt
    expect(reduce({ ...BASE, healthy: false, unhealthySince: startedAt }).action).toBe('recover');
  });

  it('unhealthySince=null（本 tick 起始断裂）⇒ 输出补 now、本 tick 不触发（下 tick 起计时）', () => {
    const out = reduce({ ...BASE, healthy: false, unhealthySince: null });
    expect(out.action).toBe('none');
    expect(out.unhealthySince).toBe(BASE.now);
  });

  it('判据3 hydration 门：hydrationPending ⇒ 首同步窗口不 recover（即便门已开）', () => {
    expect(reduce({ ...gateHit, hydrationPending: true }).action).toBe('none');
  });

  it('判据4 冷却：now-lastRecoveryAt < cooldownMs ⇒ none；≥（边界含等）⇒ recover', () => {
    expect(reduce({ ...gateHit, lastRecoveryAt: BASE.now - 10_000 }).action).toBe('none');   // 10s < 15s
    expect(reduce({ ...gateHit, lastRecoveryAt: BASE.now - 15_000 }).action).toBe('recover'); // 边界过
  });

  it('判据5 纯函数无状态：同输入连续两次调用输出恒同（第二次仍 recover——单飞去重归 runtime recovering 标志）', () => {
    expect(reduce(gateHit)).toEqual(reduce(gateHit));
    expect(reduce(gateHit).action).toBe('recover');
    expect(reduce(gateHit).action).toBe('recover');
  });

  it('判据6 抑制：terminal / hidden / offline 任一 ⇒ none（零自动）', () => {
    const suppressors: Array<Partial<MachineInputs>> = [{ terminal: true }, { hidden: true }, { offline: true }];
    for (const s of suppressors) {
      expect(reduce({ ...gateHit, ...s }).action).toBe('none');
    }
  });

  it('判据7 退避表封顶：attempts=10 仍取 30s 档（Math.min 钳制）且 action 不因 attempts 高而停——永不停止自动', () => {
    expect(RECOVER_BACKOFF_MS[Math.min(10, RECOVER_BACKOFF_MS.length - 1)]).toBe(30_000); // runtime 查表式
    // cooldownMs=30_000 即 runtime 按 attempts=10 查表结果（入参化）；冷却已过 40s
    const out = reduce({
      ...BASE, healthy: false, unhealthySince: BASE.now - 200_000,
      recoveryAttempts: 10, lastRecoveryAt: BASE.now - 40_000, cooldownMs: 30_000,
    });
    expect(out.action).toBe('recover');
  });

  it('判据9 jitter 入参化：同 inputs 不同 gateMs 结果可不同（模块零 Math.random 的可测性锚）', () => {
    const inputs = { ...BASE, healthy: false, unhealthySince: BASE.now - 46_000 };
    expect(reduce({ ...inputs, gateMs: 45_000 }).action).toBe('recover');
    expect(reduce({ ...inputs, gateMs: 50_000 }).action).toBe('none');
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

  it('判据8 attempts≥3 ⇒ banner（不论 elapsed——反复恢复失败升格）', () => {
    expect(reduce({ ...BASE, healthy: false, unhealthySince: BASE.now - 10_000, recoveryAttempts: 3 }).ui).toBe('banner');
    expect(reduce({ ...BASE, healthy: false, unhealthySince: BASE.now - 10_000, recoveryAttempts: 2 }).ui).toBe('ok');
  });
});
