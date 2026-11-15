// TD-33/C1a T6：启动失败面单源（isPortError 自 gateway 迁入——gateway 锚净零；C2 tracker 本文件扩展）。
// TD-32/C2 T17：CollabStartFailureTracker——typed 启动失败面（drill IPC/控制库同读；gateway 只委托）。
import { describe, it, expect } from 'vitest';
import { isPortError, CollabStartFailureTracker } from './collab-start-failure';

describe('isPortError（C1a 迁入）', () => {
  it('EADDRINUSE / DOCS_NOT_UNLOADED / code 缺失但消息含 EADDRINUSE=端口类启动失败', () => {
    expect(isPortError(Object.assign(new Error('x'), { code: 'EADDRINUSE' }))).toBe(true);
    expect(isPortError(Object.assign(new Error('x'), { code: 'DOCS_NOT_UNLOADED' }))).toBe(true);
    expect(isPortError(new Error('listen EADDRINUSE: address already in use'))).toBe(true);
  });

  it('EACCES/EPERM/普通错误=false（typed DrillCollabStartFailed 面不换口）', () => {
    expect(isPortError(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe(false);
    expect(isPortError(Object.assign(new Error('x'), { code: 'EPERM' }))).toBe(false);
    expect(isPortError(new Error('boom'))).toBe(false);
    expect(isPortError(null)).toBe(false);
  });
});

describe('CollabStartFailureTracker（TD-32/T17：lastStartFailure/stateSince/attempt 单源）', () => {
  it('attempt 入口递增+failure 清空；failure 面=code/kind/attempt/at/stateSince（transition 时写）', () => {
    const t = new CollabStartFailureTracker();
    expect(t.snapshot().attempt).toBe(0);
    expect(t.lastStartFailure()).toBeNull();
    t.noteAttempt();
    t.noteFailure(Object.assign(new Error('listen EADDRINUSE: address already in use'), { code: 'EADDRINUSE' }), 1100);
    t.noteState('start-failed', 1200);   // catch 先赋值再 transition——stateSince=进入 start-failed 时刻（grace 起算点）
    expect(t.lastStartFailure()).toMatchObject({
      code: 'EADDRINUSE', kind: 'port-in-use', attempt: 1, at: 1100, stateSince: 1200,
    });
    t.noteAttempt();   // 新 attempt 入口清空（旧 attempt 失败不误判）
    expect(t.lastStartFailure()).toBeNull();
    expect(t.snapshot().attempt).toBe(2);
  });

  it('kind 映射：DOCS_NOT_UNLOADED=docs-not-unloaded；EACCES/EPERM/普通=other；消息含 EADDRINUSE=port-in-use', () => {
    const t = new CollabStartFailureTracker();
    t.noteAttempt();
    t.noteFailure(Object.assign(new Error('x'), { code: 'DOCS_NOT_UNLOADED' }));
    expect(t.lastStartFailure()?.kind).toBe('docs-not-unloaded');
    t.noteFailure(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }));
    expect(t.lastStartFailure()?.kind).toBe('other');
    t.noteFailure(Object.assign(new Error('x'), { code: 'EPERM' }));
    expect(t.lastStartFailure()?.kind).toBe('other');
    t.noteFailure(new Error('listen EADDRINUSE'));
    expect(t.lastStartFailure()?.kind).toBe('port-in-use');
    t.noteFailure(new Error('boom'));
    expect(t.lastStartFailure()?.kind).toBe('other');
    expect(t.lastStartFailure()?.code).toBeUndefined();
  });

  it('noteServing 清空 failure；stateSince 随 transition 变化（at 不变）', () => {
    const t = new CollabStartFailureTracker();
    t.noteAttempt();
    t.noteFailure(new Error('boom'), 10);
    t.noteState('start-failed', 20);
    t.noteState('starting', 30);    // 重试窗（failure 保留但 stateSince 跟随当前态）
    expect(t.snapshot()).toMatchObject({ state: 'starting', stateSince: 30 });
    expect(t.lastStartFailure()?.at).toBe(10);
    t.noteServing();
    expect(t.lastStartFailure()).toBeNull();
  });

  it('snapshot 面=state/stateSince/attempt/lastStartFailure（drill IPC 消费契约）', () => {
    const t = new CollabStartFailureTracker();
    t.noteState('serving', 99);
    expect(t.snapshot()).toEqual({ state: 'serving', stateSince: 99, attempt: 0, lastStartFailure: null });
  });
});
