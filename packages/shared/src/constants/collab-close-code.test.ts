import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  resolveCloseAction, CollabCloseCode, MESSAGE_TOO_BIG_TERMINAL_REASON,
  DOC_OVER_QUOTA_TERMINAL_REASON, DOC_VACUUMING_TERMINAL_REASON, DOC_GENERATION_STALE_TERMINAL_REASON,
  SS2_OVER_LIMIT_TERMINAL_REASON, TEAM_DISBANDED_TERMINAL_REASON,
  resolveBackoffPlan, TRANSIENT_BACKOFF_STEPS_MS,
} from './collab-close-code';
import type { BackoffPlan, CloseActionKind } from './collab-close-code';
import { CollabAuthReason } from './collab-auth-reason';
import { ConnectionTimeout, Forbidden, MessageTooBig, ResetConnection, Unauthorized } from '@hocuspocus/common';

describe('CollabCloseCode 分配表（spec §3.5）——库值单源锚（P-N）', () => {
  it('应用侧自有码=1000/1012/4401/4402（4401 双 reason 分型同码——sweep 与库 Unauthorized 异 reason 同 code）', () => {
    expect(CollabCloseCode.NORMAL).toBe(1000);
    expect(CollabCloseCode.APP_RESTART).toBe(1012);
    expect(CollabCloseCode.SESSION_EXPIRED).toBe(4401);
    expect(CollabCloseCode.MAX_LIFETIME).toBe(4402);
  });
  it('库自发码从 @hocuspocus/common 导入（.code 引用——禁字面量重写；本测锚库当前值=升级漂移哨）', () => {
    expect(CollabCloseCode.LIB_RESET).toBe(ResetConnection.code);
    expect(CollabCloseCode.LIB_RESET).toBe(4205);
    expect(CollabCloseCode.LIB_UNAUTHORIZED).toBe(Unauthorized.code);
    expect(CollabCloseCode.LIB_UNAUTHORIZED).toBe(4401);
    expect(CollabCloseCode.LIB_FORBIDDEN).toBe(Forbidden.code);
    expect(CollabCloseCode.LIB_FORBIDDEN).toBe(4403);
    expect(CollabCloseCode.LIB_CONNECTION_TIMEOUT).toBe(ConnectionTimeout.code);
    expect(CollabCloseCode.LIB_CONNECTION_TIMEOUT).toBe(4408);
    expect(CollabCloseCode.LIB_MESSAGE_TOO_BIG).toBe(MessageTooBig.code);
    expect(CollabCloseCode.LIB_MESSAGE_TOO_BIG).toBe(1009);
  });
});

describe('resolveCloseAction（code,reason 双键分型——spec §5.2 v2.1）', () => {
  it('4401 双 reason 分型：库 Unauthorized=终态重登档 ≠ 应用 sweep session-expired=静默续期一次', () => {
    expect(resolveCloseAction(4401, 'session-expired').kind).toBe('silent-renew-once');
    expect(resolveCloseAction(4401, 'Unauthorized').kind).toBe('terminal');
  });
  it('4401 无 reason 按库默认语义=终态', () => {
    expect(resolveCloseAction(4401, undefined).kind).toBe('terminal');
  });
  it('1012=planned-restart（既有 30s 窗+短退避——runtime 链路收编进表）', () => {
    expect(resolveCloseAction(1012, '').kind).toBe('planned-restart');
  });
  it('4402 max-lifetime=backoff 档（v3：reconnect 死档删除——T9 close 映射对 reconnect 零动作=死档复发；寿命尽重连走 machine 既有退避防极端齐步）', () => {
    expect(resolveCloseAction(4402, 'max-lifetime').kind).toBe('backoff');
  });
  it('库自发瞬态族=4205/4403 落 backoff 档（4205 无超限语义——客户端禁由它推断成因）；4408 双 reason 分型：库 "Connection Timeout"=backoff ≠ 客户端合成 "forced"=backoff（三击强制的恶化档——synthetic 标记诊断区分，kind 仍 backoff）', () => {
    for (const c of [4205, 4403]) expect(resolveCloseAction(c, '').kind).toBe('backoff');
    expect(resolveCloseAction(4408, 'Connection Timeout').kind).toBe('backoff');
    expect(resolveCloseAction(4408, 'forced').kind).toBe('backoff');
    expect(resolveCloseAction(4408, 'forced').synthetic).toBe(true); // provider esm:342-357 合成码标记
    expect(resolveCloseAction(4408, 'Connection Timeout').synthetic).toBeUndefined();
  });
  it('1009=terminal 档（内容确定性：重连重发同一超限帧=无限循环——用户可达配额终态归 Y0b-4 4404 自救）', () => {
    expect(resolveCloseAction(1009, '').kind).toBe('terminal');
  });
  it('1000=normal', () => {
    expect(resolveCloseAction(1000, '').kind).toBe('normal');
  });
  it('未知 code=backoff（fail-safe 重连）', () => {
    expect(resolveCloseAction(4999, '').kind).toBe('backoff');
  });
});

describe('Y0b-4 T1 配额/代际码四码+terminal 原因常量（spec §3.5）', () => {
  it('四码三常量：DOC_OVER_QUOTA=4404/GENERATION_SUPERSEDED=4410（v6 启用——spec §3.5 预留提前消费）均 terminal；RATE_LIMITED_CLOSE=1008/SLOW_CONSUMER=1011 且 backoff；DOC_VACUUMING_TERMINAL_REASON/DOC_GENERATION_STALE_TERMINAL_REASON 常量单源（T5 close 映射/T11 终态档/T9a 检测点共用——字段一致矩阵）', () => {
    expect(resolveCloseAction(4410, DOC_VACUUMING_TERMINAL_REASON).kind).toBe('terminal');
    expect(resolveCloseAction(4410, DOC_GENERATION_STALE_TERMINAL_REASON).kind).toBe('terminal');
    expect(CollabCloseCode.DOC_OVER_QUOTA).toBe(4404);
    expect(resolveCloseAction(4404, DOC_OVER_QUOTA_TERMINAL_REASON).kind).toBe('terminal');
    expect(CollabCloseCode.RATE_LIMITED_CLOSE).toBe(1008);
    expect(resolveCloseAction(1008, 'msg-rate-exceeded').kind).toBe('backoff');
    expect(CollabCloseCode.SLOW_CONSUMER).toBe(1011);
    expect(resolveCloseAction(1011, 'slow-consumer').kind).toBe('backoff');
  });
  it('库抹码形态分型：(1000, doc-over-quota) 不得落 normal——reason 双键兜底', () => {
    // 外审 P0-2 尾巴：旧路径/竞态下客户端可能观测 (1000,'doc-over-quota')——reason 匹配
    // DOC_OVER_QUOTA_TERMINAL_REASON 时必须落 terminal（禁字面量 reason 散落——常量单源）
    expect(resolveCloseAction(1000, DOC_OVER_QUOTA_TERMINAL_REASON).kind).toBe('terminal');
  });
  it('terminal 原因常量字面量锚（MESSAGE_TOO_BIG 同款模式——字面量即线路协议契约，漂移即红）', () => {
    expect(DOC_OVER_QUOTA_TERMINAL_REASON).toBe('doc-over-quota');
    expect(DOC_VACUUMING_TERMINAL_REASON).toBe('doc-vacuuming');
    expect(DOC_GENERATION_STALE_TERMINAL_REASON).toBe('doc-generation-stale');
    expect(MESSAGE_TOO_BIG_TERMINAL_REASON).toBe('message-too-big');
  });
});

// ══════════ Y0b-5 T6：close 分型双 reason（裁定 25⑸——报告3 P0-1/P0-2） ══════════
describe('Y0b-5 T6 close 分型双 reason：4404-ss2-over-limit 按 reason 分型 + 1000-team-disbanded 升 terminal', () => {
  it('两常量字面量锚（线路协议契约——字面量即契约，漂移即红；team disbanded 原 gateway:3009 裸字面量升单源）', () => {
    expect(SS2_OVER_LIMIT_TERMINAL_REASON).toBe('ss2-over-limit');
    expect(TEAM_DISBANDED_TERMINAL_REASON).toBe('team disbanded');
  });
  it('4404 按 reason 分型：ss2-over-limit→terminal(自身 reason)；其余/缺省 reason→doc-over-quota（既有语义不回归）', () => {
    const a = resolveCloseAction(4404, SS2_OVER_LIMIT_TERMINAL_REASON);
    expect(a.kind).toBe('terminal');
    expect(a.terminalReason).toBe('ss2-over-limit');
    expect(resolveCloseAction(4404, DOC_OVER_QUOTA_TERMINAL_REASON)).toEqual(
      { kind: 'terminal', terminalReason: DOC_OVER_QUOTA_TERMINAL_REASON });
    expect(resolveCloseAction(4404, undefined).terminalReason).toBe(DOC_OVER_QUOTA_TERMINAL_REASON);
  });
  it('1000 按 reason 分型：team disbanded→terminal(自身 reason)——团队解散禁先重连一次（24⑴ normal→exponential 的已知终局例外，与 doc-over-quota 特例同款形态）；其余 1000 仍 normal', () => {
    const a = resolveCloseAction(1000, TEAM_DISBANDED_TERMINAL_REASON);
    expect(a.kind).toBe('terminal');
    expect(a.terminalReason).toBe('team disbanded');
    expect(resolveCloseAction(1000, '').kind).toBe('normal');
    expect(resolveCloseAction(1000, 'doc-over-quota').kind).toBe('terminal'); // 库抹码兜底既有语义保留
  });
  it('resolveBackoffPlan 传导：(1000,"team disbanded")/close 路由落 none（永久断线——禁先重连）；(4404,"ss2-over-limit") 同落 none；CloseActionKind 不加新档（两特例均在既有五档内分派）', () => {
    expect(resolveBackoffPlan('close', 1000, TEAM_DISBANDED_TERMINAL_REASON, 0, 0).kind).toBe('none');
    expect(resolveBackoffPlan('close', 4404, SS2_OVER_LIMIT_TERMINAL_REASON, 0, 0).kind).toBe('none');
    const a = resolveCloseAction(1000, TEAM_DISBANDED_TERMINAL_REASON);
    expect(['terminal', 'silent-renew-once', 'planned-restart', 'backoff', 'normal']).toContain(a.kind);
  });
});

describe('退避计划（spec §5.2 v2.2——RECOVER_BACKOFF_MS 族一张表；纯函数零 Math.random）', () => {
  it('TRANSIENT_BACKOFF_STEPS_MS=[2,5,10,30]s 四档（裁定 22⑻ 单源表——T3 删 connectionMachine RECOVER_BACKOFF_MS 改 import 本表）', () => {
    expect(TRANSIENT_BACKOFF_STEPS_MS).toEqual([2_000, 5_000, 10_000, 30_000]);
  });
  it('auth 瞬态档（code=undefined）：六瞬态 reason 全落指数档（真协议路径①——denyAuth→authenticationFailed）', () => {
    for (const r of [CollabAuthReason.DRAINING, CollabAuthReason.LEASE_NOT_READY, CollabAuthReason.DB_UNAVAILABLE,
                     CollabAuthReason.SERVER_OVERLOADED, CollabAuthReason.RATE_LIMITED, CollabAuthReason.SERVER_OUTDATED]) {
      expect(resolveBackoffPlan('auth', undefined, r, 0, 0).kind).toBe('exponential');
    }
  });
  it('auth terminal 档：七终态 reason→none（isTerminalReason 单源派生——客户端引导重登/跳转/reload 档不重连）', () => {
    for (const r of [CollabAuthReason.UNAUTHENTICATED, CollabAuthReason.SESSION_EXPIRED, CollabAuthReason.NOT_FOUND,
                     CollabAuthReason.FORBIDDEN, CollabAuthReason.SCHEMA_OUTDATED,
                     CollabAuthReason.CLIENT_VERSION_MISSING, CollabAuthReason.CLIENT_VERSION_INVALID]) {
      const p = resolveBackoffPlan('auth', undefined, r, 0, 0);
      expect(p.kind).toBe('none');
      expect(p.ms).toBe(0);
    }
  });
  it('close 瞬态档（真协议路径②③）：close(1008,"msg-rate-exceeded")与 close(4408,"forced") 落指数档', () => {
    expect(resolveBackoffPlan('close', 1008, 'msg-rate-exceeded', 0, 0).kind).toBe('exponential');
    expect(resolveBackoffPlan('close', 4408, 'forced', 0, 0).kind).toBe('exponential');
  });
  it('阶梯+封顶：jitter=0 时 ms=STEPS[min(attempt,3)]；attempt≥3 恒 30_000；jitter 注入加成', () => {
    expect(resolveBackoffPlan('auth', undefined, CollabAuthReason.DRAINING, 0, 0).ms).toBe(2_000);
    expect(resolveBackoffPlan('auth', undefined, CollabAuthReason.DRAINING, 1, 0).ms).toBe(5_000);
    expect(resolveBackoffPlan('auth', undefined, CollabAuthReason.DRAINING, 2, 0).ms).toBe(10_000);
    expect(resolveBackoffPlan('auth', undefined, CollabAuthReason.DRAINING, 3, 0).ms).toBe(30_000);
    expect(resolveBackoffPlan('auth', undefined, CollabAuthReason.DRAINING, 99, 0).ms).toBe(30_000);
    expect(resolveBackoffPlan('auth', undefined, CollabAuthReason.DRAINING, 0, 2_000).ms).toBe(4_000);
  });
  it('planned-restart(1012)=short（键名 APP_RESTART——库无 PLANNED_RESTART 键；jitter 0-60s full 由调用方生成传入——裁定 23⑶ NAT 40 客户端部署窗算术）', () => {
    const p = resolveBackoffPlan('close', 1012, '', 0, 0);
    expect(p.kind).toBe('short');
    expect(p.ms).toBe(1_000);
    expect(resolveBackoffPlan('close', 1012, '', 0, 59_000).ms).toBe(60_000);
  });
  it('terminal/close-normal:none 按 route 分流:code!==undefined 时 resolveCloseAction 单源判定——(4401,"Unauthorized") 落 terminal 档;none 语义显式命名"永久断线"=不可扩展集合(仅 terminal 档+应用主动销毁两处)', () => {
    expect(resolveBackoffPlan('close', 4401, 'Unauthorized', 0, 0).kind).toBe('none');
    expect(resolveBackoffPlan('close', 4404, DOC_OVER_QUOTA_TERMINAL_REASON, 0, 0).kind).toBe('none');
    expect(resolveBackoffPlan('close', 1009, '', 0, 0).kind).toBe('none');
    expect(resolveBackoffPlan('close', 4410, DOC_VACUUMING_TERMINAL_REASON, 0, 0).kind).toBe('none');
    expect(resolveBackoffPlan('close', 1000, DOC_OVER_QUOTA_TERMINAL_REASON, 0, 0).kind).toBe('none'); // 库抹码兜底分型
  });
  it('silent-renew 档:(4401,"session-expired")→{kind:"silent-renew",ms:500+jitter} 立即重连一次不进阶梯(第二次同因回落 terminal 由 supervisor 闩锁管,函数无状态)', () => {
    const p = resolveBackoffPlan('close', 4401, 'session-expired', 99, 0);
    expect(p.kind).toBe('silent-renew');
    expect(p.ms).toBe(500);
    expect(p.ms).toBeLessThanOrEqual(1_500);
  });
  it('normal(1000) 改带退避的一次重连(库抹码形态 (1000,reason) 可能掩盖瞬态关闭;真终态服务端下次握手以带 reason 的 auth 拒档权威分型)', () => {
    expect(resolveBackoffPlan('close', 1000, '', 0, 0).kind).toBe('exponential');
  });
  it('五档穷尽性表驱动用例:对 CloseActionKind 全五档 × 常见 reason 矩阵断言 kind 映射穷尽且合法(terminal→none/silent-renew-once→silent-renew/planned-restart→short/backoff→exponential/normal→exponential);未来新增 kind 未映射即红(kind 联合类型驱动编译期+运行时双重穷尽)', () => {
    const EXPECTED: Record<CloseActionKind, BackoffPlan['kind']> = {
      'terminal': 'none',
      'silent-renew-once': 'silent-renew',
      'planned-restart': 'short',
      'backoff': 'exponential',
      'normal': 'exponential',
    };
    // 代表矩阵：每档至少一对 (code,reason)——档判定经 resolveCloseAction 真值分派
    const matrix: ReadonlyArray<readonly [code: number, reason: string]> = [
      [4401, 'Unauthorized'], [4404, DOC_OVER_QUOTA_TERMINAL_REASON], [4410, DOC_VACUUMING_TERMINAL_REASON],
      [1009, ''], [1000, DOC_OVER_QUOTA_TERMINAL_REASON],                                        // terminal
      [4401, 'session-expired'],                                                                  // silent-renew-once
      [1012, ''],                                                                                 // planned-restart
      [1008, 'msg-rate-exceeded'], [4408, 'forced'], [4408, 'Connection Timeout'],
      [1011, 'slow-consumer'], [4205, ''], [4403, ''], [4402, 'max-lifetime'], [4999, ''],       // backoff
      [1000, ''],                                                                                 // normal
    ];
    const seenKinds = new Set<CloseActionKind>();
    for (const [code, reason] of matrix) {
      const kind = resolveCloseAction(code, reason).kind;
      seenKinds.add(kind);
      expect(resolveBackoffPlan('close', code, reason, 0, 0).kind, `(${code},"${reason}")→${kind}`).toBe(EXPECTED[kind]);
    }
    // 运行时穷尽：矩阵覆盖五档全集（新增档无代表对即红；编译期由 switch 无 default 兜底）
    expect(seenKinds).toEqual(new Set(Object.keys(EXPECTED) as CloseActionKind[]));
  });
  it('AUTH_WAIT_TIMEOUT 独立路由:socket OPEN 但 10s 未 authenticated→exponential(传 (undefined,"") 会得 none 与 supervisor attempt++/重排自相矛盾)', () => {
    expect(resolveBackoffPlan('timeout', undefined, '', 0, 0).kind).toBe('exponential');
    expect(resolveBackoffPlan('timeout', undefined, '', 0, 0).ms).toBe(2_000);
  });
  it('非 terminal reason 判据派生自 isTerminalReason 单源——未来新增瞬态 reason 自动落指数档(禁第二张 reason 表):resolveBackoffPlan 内禁出现独立 TRANSIENT_REASONS 集合字面量(本用例锁实现形态)', () => {
    // 锁实现形态：函数内部不得有独立瞬态 reason 集合（第二张 reason 表=未来新增瞬态 reason 漏登即误判终态）
    const src = readFileSync(new URL('./collab-close-code.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/TRANSIENT_REASONS/);
  });
});
