// packages/shared/src/collab/recovery-flow.spec.ts
// Y1c T5c（plan v1.7 Task 5 客户端/恢复段；spec v5.4 §8.1）：4410 三分/4411/4412/4413/4406 客户端恢复
// 动作契约+重复 DENY 逃生口状态机+historyId 半链消费的契约测试。先红→绿。
import { describe, expect, it } from 'vitest';
import {
  CollabCloseCode,
  DOC_GENERATION_STALE_TERMINAL_REASON,
  DOC_VACUUMING_TERMINAL_REASON,
  SERVER_RESTORED_TERMINAL_REASON,
} from '../constants/collab-close-code';
import {
  CollabY1cClosePayload, resolveAuthHistoryVerdict,
} from './doc-protocol';
import {
  RecoveryAction, resolveRecoveryAction,
  CONSECUTIVE_DENY_RECOVERY_THRESHOLD, RecoveryDenyState, advanceRecoveryDenyState,
  recoveryActionForAuthVerdict, DENY_ESCAPE_HATCH_CONTRACT, HISTORY_ID_HALF_CHAIN_CONTRACT,
  Y1C_RECOVERY_DISPATCH_TIERS, assertY1cCodesNotBackoffRouted,
} from './recovery-flow';

describe('Y1c T5c 契约冻结：恢复动作枚举七值（§8.1）', () => {
  it('七值精确冻结', () => {
    const all: RecoveryAction[] = [
      'reconnect-new-generation', 'export-draft-then-clear', 'readonly-recovery-user-adjudication',
      'resync-full', 'force-refresh-protocol', 'retry-after-maintenance', 'backoff-retry',
    ];
    expect(new Set(all).size).toBe(7);
  });
});

describe('Y1c T5c 契约冻结：resolveRecoveryAction 按 T5a 冻结 close 载荷分派（全 reason 覆盖）', () => {
  it('4410 三分：doc-generation-stale→换代重连；doc-vacuuming→导出草稿再清；server-restored→只读 recovery 用户裁定', () => {
    const stale: CollabY1cClosePayload = { code: CollabCloseCode.GENERATION_SUPERSEDED, reason: 'doc-generation-stale', generation: 4 };
    const vacuuming: CollabY1cClosePayload = { code: CollabCloseCode.GENERATION_SUPERSEDED, reason: 'doc-vacuuming', generation: 4, discardLocalCache: true };
    const restored: CollabY1cClosePayload = { code: CollabCloseCode.GENERATION_SUPERSEDED, reason: 'server-restored' };
    expect(resolveRecoveryAction(stale)).toBe('reconnect-new-generation');
    expect(resolveRecoveryAction(vacuuming)).toBe('export-draft-then-clear');
    expect(resolveRecoveryAction(restored)).toBe('readonly-recovery-user-adjudication');
  });
  it('4411/4412→resync-full；4413→retry-after-maintenance；4406→force-refresh-protocol；其余→backoff-retry', () => {
    expect(resolveRecoveryAction({ code: CollabCloseCode.FRAME_MALFORMED, reason: 'frame-malformed' })).toBe('resync-full');
    expect(resolveRecoveryAction({ code: CollabCloseCode.RESYNC_REQUIRED, reason: 'resync-required' })).toBe('resync-full');
    expect(resolveRecoveryAction({ code: CollabCloseCode.MAINTENANCE_FREEZE, reason: 'maintenance-freeze', retryAfterMs: 30_000 })).toBe('retry-after-maintenance');
    expect(resolveRecoveryAction({
      code: CollabCloseCode.CLIENT_OUTDATED, reason: 'client-outdated',
      gate: { protocolVersion: 3, schemaVersion: 3, historyId: 'h1' },
    })).toBe('force-refresh-protocol');
    // 非 Y1c 码面（瞬态退避档——复用 resolveCloseAction backoff 语义）
    expect(resolveRecoveryAction({ code: CollabCloseCode.RATE_LIMITED_CLOSE, reason: undefined })).toBe('backoff-retry');
    expect(resolveRecoveryAction({ code: CollabCloseCode.SLOW_CONSUMER, reason: undefined })).toBe('backoff-retry');
    expect(resolveRecoveryAction({ code: 4205, reason: undefined })).toBe('backoff-retry');
  });
  it('防回归（评审 Important#2）：4410 三分判据=collab-close-code 单源常量——常量值漂移即红；分派面经同一常量构造载荷路由', () => {
    // 单源常量值面冻结（协议串漂移=执行卡死——四侧矩阵同纪律；改常量值字面量本断言即红）
    expect(DOC_GENERATION_STALE_TERMINAL_REASON).toBe('doc-generation-stale');
    expect(DOC_VACUUMING_TERMINAL_REASON).toBe('doc-vacuuming');
    expect(SERVER_RESTORED_TERMINAL_REASON).toBe('server-restored');
    // recovery-flow 分派面 import 同一常量构造载荷路由（重抄第二份值域即路由失配红）
    expect(resolveRecoveryAction({ code: CollabCloseCode.GENERATION_SUPERSEDED, reason: DOC_GENERATION_STALE_TERMINAL_REASON })).toBe('reconnect-new-generation');
    expect(resolveRecoveryAction({ code: CollabCloseCode.GENERATION_SUPERSEDED, reason: DOC_VACUUMING_TERMINAL_REASON })).toBe('export-draft-then-clear');
    expect(resolveRecoveryAction({ code: CollabCloseCode.GENERATION_SUPERSEDED, reason: SERVER_RESTORED_TERMINAL_REASON })).toBe('readonly-recovery-user-adjudication');
  });
});

describe('Y1c T5c 契约修正 #7：Y1c 四码先走 resolveRecoveryAction——不被 backoff 吞（T10/T25）', () => {
  it('四码分派档表：4406→terminal/4411·4412→resync/4413→retry（Retry-After 语义）——与 resolveRecoveryAction 动作映射单源一致', () => {
    expect(Y1C_RECOVERY_DISPATCH_TIERS[CollabCloseCode.CLIENT_OUTDATED]).toBe('terminal');
    expect(Y1C_RECOVERY_DISPATCH_TIERS[CollabCloseCode.FRAME_MALFORMED]).toBe('resync');
    expect(Y1C_RECOVERY_DISPATCH_TIERS[CollabCloseCode.RESYNC_REQUIRED]).toBe('resync');
    expect(Y1C_RECOVERY_DISPATCH_TIERS[CollabCloseCode.MAINTENANCE_FREEZE]).toBe('retry');
    expect(Object.keys(Y1C_RECOVERY_DISPATCH_TIERS).length).toBe(4);   // 恰四码——不多不少
    // 分派档↔动作单源对齐：四码各经 resolveRecoveryAction 得正确档（禁 backoff-retry）
    const tierToAction: Record<'terminal' | 'resync' | 'retry', RecoveryAction> = {
      terminal: 'force-refresh-protocol',
      resync: 'resync-full',
      retry: 'retry-after-maintenance',
    };
    for (const [code, tier] of Object.entries(Y1C_RECOVERY_DISPATCH_TIERS)) {
      const action = resolveRecoveryAction({ code: Number(code) });
      expect(action).toBe(tierToAction[tier]);
      expect(action).not.toBe('backoff-retry');   // 「不被 backoff 吞」——四码永不落通用退避档
    }
  });
  it('守卫 assertY1cCodesNotBackoffRouted：四码任一入 backoff 处理集合即 throw（负控——4413 放进去必须红）', () => {
    // 负控：把 4413 放进 backoff 集合→守卫必 throw（消费方测试红——「不被 backoff 吞」的编译/装配面防线）
    expect(() => assertY1cCodesNotBackoffRouted([CollabCloseCode.MAINTENANCE_FREEZE])).toThrow(/resolveRecoveryAction/);
    expect(() => assertY1cCodesNotBackoffRouted([1008, CollabCloseCode.CLIENT_OUTDATED])).toThrow(/4406|resolveRecoveryAction/);
    expect(() => assertY1cCodesNotBackoffRouted([4406, 4411, 4412, 4413])).toThrow();
    // 合法 backoff 集合（瞬态码——1008/1011/4205）不触发
    expect(() => assertY1cCodesNotBackoffRouted([CollabCloseCode.RATE_LIMITED_CLOSE, CollabCloseCode.SLOW_CONSUMER, 4205])).not.toThrow();
    expect(() => assertY1cCodesNotBackoffRouted([])).not.toThrow();
  });
});

describe('Y1c T5c 契约冻结：重复 DENY 逃生口（N 次后 recovery 模式——阈值 3）', () => {
  it('阈值冻结=3（Controller 工程值裁定：连续三次 4411=确定性客户端态坏，再循环=自我 DoS）', () => {
    expect(CONSECUTIVE_DENY_RECOVERY_THRESHOLD).toBe(3);
  });
  it('状态机：deny 计数累加，第 3 次达阈值切 recovery 模式（1/2 次仍 normal——可能瞬态）', () => {
    let s: RecoveryDenyState = { consecutiveDenyCount: 0, mode: 'normal' };
    s = advanceRecoveryDenyState(s, { kind: 'deny-4411' });
    expect(s).toEqual({ consecutiveDenyCount: 1, mode: 'normal' });
    s = advanceRecoveryDenyState(s, { kind: 'deny-4411' });
    expect(s).toEqual({ consecutiveDenyCount: 2, mode: 'normal' });   // 阈值边界：2<3 未切
    s = advanceRecoveryDenyState(s, { kind: 'deny-4411' });
    expect(s).toEqual({ consecutiveDenyCount: 3, mode: 'recovery' }); // 第 3 次切 recovery
  });
  it('恢复同步成功（non-deny）归零计数但不退出 recovery 模式——recovery 退出仅经用户完成裁定导入', () => {
    let s: RecoveryDenyState = { consecutiveDenyCount: 3, mode: 'recovery' };
    s = advanceRecoveryDenyState(s, { kind: 'sync-ok' });
    expect(s).toEqual({ consecutiveDenyCount: 0, mode: 'recovery' }); // 计数归零、模式粘住
    s = advanceRecoveryDenyState(s, { kind: 'recovery-complete' });
    expect(s).toEqual({ consecutiveDenyCount: 0, mode: 'normal' });
  });
  it('normal 态 sync-ok 归零计数（1-2 次瞬态重置——重新起算）', () => {
    const s = advanceRecoveryDenyState({ consecutiveDenyCount: 2, mode: 'normal' }, { kind: 'sync-ok' });
    expect(s).toEqual({ consecutiveDenyCount: 0, mode: 'normal' });
  });
  it('负控：recovery 模式下 deny 事件不回退不重进（禁无限重连循环——达阈值后不再消耗重连预算）', () => {
    let s: RecoveryDenyState = { consecutiveDenyCount: 3, mode: 'recovery' };
    for (let i = 0; i < 50; i++) s = advanceRecoveryDenyState(s, { kind: 'deny-4411' });
    expect(s.mode).toBe('recovery');
    expect(s.consecutiveDenyCount).toBeGreaterThanOrEqual(CONSECUTIVE_DENY_RECOVERY_THRESHOLD);
  });
  it('逃生口契约注记：导出→重置→用户裁定导入（禁无限重连循环）', () => {
    expect(DENY_ESCAPE_HATCH_CONTRACT.sequence).toContain('导出');
    expect(DENY_ESCAPE_HATCH_CONTRACT.sequence).toContain('重置');
    expect(DENY_ESCAPE_HATCH_CONTRACT.sequence).toContain('用户裁定导入');
    expect(DENY_ESCAPE_HATCH_CONTRACT.noInfiniteReconnectLoop).toContain('禁无限重连循环');
  });
});

describe('Y1c T5c 契约冻结：historyId 客户端半链消费（复用 T5a——import 不重造）', () => {
  it('auth 裁定→恢复动作映射：server-restored→只读 recovery 裁定；doc-generation-stale→换代重连；ok→null（无恢复动作）', () => {
    // 复用 T5a resolveAuthHistoryVerdict（先比 historyId 再比 generation——§8.1）
    const v1 = resolveAuthHistoryVerdict({ historyId: 'h-old', generation: 3 }, { historyId: 'h-new', generation: 3 });
    expect(v1).toBe('server-restored');
    expect(recoveryActionForAuthVerdict(v1)).toBe('readonly-recovery-user-adjudication');

    const v2 = resolveAuthHistoryVerdict({ historyId: 'h1', generation: 2 }, { historyId: 'h1', generation: 3 });
    expect(v2).toBe('doc-generation-stale');
    expect(recoveryActionForAuthVerdict(v2)).toBe('reconnect-new-generation');

    const v3 = resolveAuthHistoryVerdict({ historyId: 'h1', generation: 3 }, { historyId: 'h1', generation: 3 });
    expect(v3).toBe('ok');
    expect(recoveryActionForAuthVerdict(v3)).toBeNull();
  });
  it('半链契约注记：缓存键五元+先比 historyId（providerVersion h=/LocalCacheKeyFiveTuple——doc-protocol 单源）', () => {
    expect(HISTORY_ID_HALF_CHAIN_CONTRACT.cacheKey).toContain('五元');
    expect(HISTORY_ID_HALF_CHAIN_CONTRACT.compareOrder).toContain('先比 historyId');
    expect(HISTORY_ID_HALF_CHAIN_CONTRACT.reuse).toContain('doc-protocol');
  });
});
