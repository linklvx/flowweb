import { describe, it, expect } from 'vitest';
import {
  resolveCloseAction, CollabCloseCode, MESSAGE_TOO_BIG_TERMINAL_REASON,
  DOC_OVER_QUOTA_TERMINAL_REASON, DOC_VACUUMING_TERMINAL_REASON, DOC_GENERATION_STALE_TERMINAL_REASON,
} from './collab-close-code';
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
