// apps/web/src/utils/unloadGuard.test.ts
// Y0b-5 T6：beforeunload 谓词 reason 集合（Set<"unsynced"|"editor-dirty"|"export-inflight">——
// 三挂载点各注册 reason 取并集）+pagehide unsynced_close 计数 once per page-life+flush。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  armUnloadWarning, disarmUnloadWarning, shouldWarnUnload, _resetUnloadGuardForTest,
} from './unloadGuard';
import { getRecentCollabDiag, _resetCollabDiagForTest } from './collabDiagnostics';

const dispatchBeforeUnload = (): boolean => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};
const dispatchPageHide = (): void => { window.dispatchEvent(new Event('pagehide')); };

beforeEach(() => {
  _resetUnloadGuardForTest();
  _resetCollabDiagForTest();
});
afterEach(() => {
  _resetUnloadGuardForTest();
  vi.restoreAllMocks();
});

describe('Y0b-5 T6：unloadGuard reason 集合', () => {
  it('空集不拦；任一 reason 武装即拦（集合非空→preventDefault）', () => {
    expect(shouldWarnUnload()).toBe(false);
    expect(dispatchBeforeUnload()).toBe(false);
    armUnloadWarning('unsynced');
    expect(shouldWarnUnload()).toBe(true);
    expect(dispatchBeforeUnload()).toBe(true);
  });
  it('三 reason 取并集：同 reason 幂等（重复 arm 单 disarm 即清）；异 reason 独立（一个 disarm 不清另一个）', () => {
    armUnloadWarning('unsynced');
    armUnloadWarning('unsynced');      // 幂等
    armUnloadWarning('export-inflight');
    expect(shouldWarnUnload()).toBe(true);
    disarmUnloadWarning('unsynced');   // 单次 disarm 清重入计数
    expect(shouldWarnUnload()).toBe(true);   // export-inflight 仍在
    disarmUnloadWarning('export-inflight');
    expect(shouldWarnUnload()).toBe(false);
  });
  it('editor-dirty reason（VideoEditorShell/ImageGenNode 挂载点共用语义）可独立武装', () => {
    armUnloadWarning('editor-dirty');
    expect(dispatchBeforeUnload()).toBe(true);
    disarmUnloadWarning('editor-dirty');
    expect(dispatchBeforeUnload()).toBe(false);
  });
  it('pagehide 挂 unsynced_close 计数（beforeunload 只负责确认框——移动端 Safari 对无交互 preventDefault 静默忽略）；once per page-life', () => {
    armUnloadWarning('unsynced');
    dispatchPageHide();
    dispatchPageHide();   // bfcache 恢复再隐藏——once per page-life 不重计
    const closes = getRecentCollabDiag().filter((e) => e.type === 'unsynced_close');
    expect(closes).toHaveLength(1);
    expect(closes[0].detail).toEqual({ n: 1 });
  });
  it('pagehide 无 unsynced reason（仅 editor-dirty）→零 unsynced_close（编辑器脏态不算画布未同步离场）', () => {
    armUnloadWarning('editor-dirty');
    dispatchPageHide();
    expect(getRecentCollabDiag().filter((e) => e.type === 'unsynced_close')).toHaveLength(0);
  });
  it('unsynced_close 已计后 disarm→再 pagehide 不再计（once 语义绑定 page-life 非武装态）', () => {
    armUnloadWarning('unsynced');
    dispatchPageHide();
    disarmUnloadWarning('unsynced');
    armUnloadWarning('unsynced');
    dispatchPageHide();
    expect(getRecentCollabDiag().filter((e) => e.type === 'unsynced_close')).toHaveLength(1);
  });
});
