// apps/web/src/utils/unloadGuard.ts
// Y0b-5 T6：beforeunload 谓词 reason 计数表单源（spec §5.7）——三挂载点各注册 reason 取并集：
//   ExportModal=export-inflight（模块级 arm/disarm 形态保留，体内改道本模块）；
//   ImageGenNode=editor-dirty（transformMode 旋转翻转）；VideoEditorShell=editor-dirty
//  （'unsynced' 由 runtime 单源置位/清零时注册——并集语义与旧 editorDirty∨unsynced 等价）。
// T6 质量修复 I2：Set→Map 引用计数——ImageGenNode 与 VideoEditorShell 共享 'editor-dirty'，
//   Set 语义下一方 disarm 全清另一方（另一编辑器未保存却无确认框）；计数归零才解除。
// pagehide：unsynced_close 计数 once per page-life+flush（beforeunload 只负责确认框——
//   移动端 Safari 对无交互 preventDefault 静默忽略，计数须挂 pagehide）。
// flush 重复挂载安全性：collabDiagnostics 模块级已有 pagehide flush——flushTelemetry 幂等
//  （发后清空/空批零 beacon），两监听器任意顺序收敛（先 record 后 flush 恒含本事件）。
import { recordCollabDiag, flushTelemetry } from './collabDiagnostics';

export type UnloadWarningReason = 'unsynced' | 'editor-dirty' | 'export-inflight';

const armedCounts = new Map<UnloadWarningReason, number>();
let handlerInstalled = false;
let unsyncedCloseRecorded = false;   // once per page-life（pagehide 可能多次——bfcache 恢复再隐藏）

function installOnce(): void {
  if (handlerInstalled || typeof window === 'undefined') return;
  handlerInstalled = true;
  window.addEventListener('beforeunload', (e: BeforeUnloadEvent) => {
    if (armedCounts.size === 0) return;
    e.preventDefault();
    e.returnValue = '';
  });
  window.addEventListener('pagehide', () => {
    if (armedCounts.get('unsynced') && !unsyncedCloseRecorded) {
      unsyncedCloseRecorded = true;
      recordCollabDiag('unsynced_close', { n: 1 });
    }
    flushTelemetry();
  });
}

/** 武装卸载警告（reason 引用计数 +1——同 reason 多持有者共存：'editor-dirty' 双编辑器挂载） */
export function armUnloadWarning(reason: UnloadWarningReason): void {
  installOnce();
  armedCounts.set(reason, (armedCounts.get(reason) ?? 0) + 1);
}

/** 解除一次持有（计数归零删 key——异 reason 互不影响；未武装 reason 的 disarm 无害不过负） */
export function disarmUnloadWarning(reason: UnloadWarningReason): void {
  const next = (armedCounts.get(reason) ?? 0) - 1;
  if (next > 0) armedCounts.set(reason, next);
  else armedCounts.delete(reason);
}

/** 谓词半边（测试/调用面断言用）：任一 reason 持有（计数≥1）即真 */
export function shouldWarnUnload(): boolean {
  return armedCounts.size > 0;
}

/** 测试缝：计数表+once 标记复位（window 监听不属测试态——一次挂载常驻） */
export function _resetUnloadGuardForTest(): void {
  armedCounts.clear();
  unsyncedCloseRecorded = false;
}
