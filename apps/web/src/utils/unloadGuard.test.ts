// apps/web/src/utils/unloadGuard.test.ts
// Y0b-5 T6：beforeunload 谓词 reason 计数表（Map<reason, count>——三挂载点各注册 reason 取并集；
// T6 质量修复 I2：Set→引用计数——ImageGenNode 与 VideoEditorShell 共享 'editor-dirty'，
// 一方 disarm 不得清另一方）+pagehide unsynced_close 计数 once per page-life+flush。
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
  it('三 reason 取并集：异 reason 独立（一个 disarm 不清另一个）；同 reason 引用计数（重复 arm 需两次 disarm——单 disarm 只解除一次持有）', () => {
    armUnloadWarning('unsynced');
    armUnloadWarning('unsynced');      // 双持有（计数 2）
    armUnloadWarning('export-inflight');
    expect(shouldWarnUnload()).toBe(true);
    disarmUnloadWarning('unsynced');   // 第一持有解除——计数 1 仍武装
    expect(shouldWarnUnload()).toBe(true);
    disarmUnloadWarning('export-inflight');
    expect(shouldWarnUnload()).toBe(true);   // unsynced 第二持有仍在
    disarmUnloadWarning('unsynced');         // 计数归零删 key
    expect(shouldWarnUnload()).toBe(false);
  });
  it('T6 质量修复 I2：双持有者共享 editor-dirty（ImageGenNode+VideoEditorShell）——一方 disarm 另一方仍拦确认框', () => {
    armUnloadWarning('editor-dirty');     // ImageGenNode 挂载
    armUnloadWarning('editor-dirty');     // VideoEditorShell 挂载
    disarmUnloadWarning('editor-dirty');  // ImageGenNode 卸载
    expect(shouldWarnUnload()).toBe(true);    // VideoEditorShell 仍持有
    expect(dispatchBeforeUnload()).toBe(true);
    disarmUnloadWarning('editor-dirty');  // VideoEditorShell 卸载——归零
    expect(dispatchBeforeUnload()).toBe(false);
  });
  it('未武装 reason 的 disarm 幂等无害（计数不过负——teardown 双保险路径：WeakSet 未含实例时 clearDocUnsyncedDirty 早退不 disarm）', () => {
    armUnloadWarning('editor-dirty');
    disarmUnloadWarning('unsynced');
    disarmUnloadWarning('unsynced');
    expect(shouldWarnUnload()).toBe(true);   // editor-dirty 不受未武装 reason 的 disarm 影响
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
