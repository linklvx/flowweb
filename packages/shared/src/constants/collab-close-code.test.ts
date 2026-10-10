import { describe, it, expect } from 'vitest';
import { resolveCloseAction, CollabCloseCode } from './collab-close-code';
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
