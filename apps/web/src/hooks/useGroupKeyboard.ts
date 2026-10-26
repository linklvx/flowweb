// useGroupKeyboard.ts
import { useEffect } from 'react';
import { message } from 'antd'; // Vite ESM：静态导入（require 不可用）
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore, NODE_TYPES } from '@/stores/nodeStore';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { undoCanvas, redoCanvas } from '@/stores/canvasUndo';

export function isGroupEditContext(target: HTMLElement | null): boolean {
  if (useNodeStore.getState().referenceSelect) return true; // 画布参考选择模式禁分组/撤销快捷键（spec §3.1：模式期 Ctrl+Z 等不生效——防撤销刚加入的参考图）
  // 视频编辑器打开期间画布快捷键禁用（spec 第五节；document keydown 是冒泡阶段，捕获层 stopPropagation 挡不住，此处为现成早退点）
  if (useVideoEditorStore.getState().open) return true;
  const ns = useNodeStore.getState();
  if (ns.activeEditNodeId !== null || ns.activeTransformNodeId !== null) return true;
  const active = document.activeElement as HTMLElement | null;
  if (active instanceof HTMLElement) {
    const tag = active.tagName;
    // 全局文本编辑上下文（含侧边栏普通输入框——target 是 keydown 目标，焦点可能在别处）
    if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) return true;
    // S4（五审 M-3）：AntD 弹层（Select/DatePicker/Dropdown/Cascader/Modal/Popover/Tooltip）挂 body 下
    if (active !== document.body
      && active.closest('.ant-select-dropdown, .ant-picker-dropdown, .ant-dropdown, .ant-cascader-menu, .ant-modal, .ant-popover, .ant-tooltip')) return true;
  }
  if (!target) return false;
  const tag = target.tagName;
  return !!(tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable);
}

export type GroupShortcut =
  | 'group' | 'merge-storyboard' | 'ungroup' | 'remove-from-group' | 'undo' | 'redo';

export function resolveGroupShortcut(e: {
  ctrlKey: boolean; metaKey?: boolean; altKey: boolean; shiftKey: boolean; key: string;
}): GroupShortcut | null {
  const ctrl = e.ctrlKey || !!e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && !e.altKey && !e.shiftKey && k === 'g') return 'group';
  if (ctrl && e.altKey && !e.shiftKey && k === 'g') return 'merge-storyboard';
  if (ctrl && !e.altKey && e.shiftKey && k === 'g') return 'ungroup';
  if (!ctrl && e.shiftKey && !e.altKey && k === 'g') return 'remove-from-group';
  if (ctrl && !e.shiftKey && k === 'z') return 'undo';
  if (ctrl && e.shiftKey && k === 'z') return 'redo';
  if (ctrl && !e.shiftKey && k === 'y') return 'redo';   // S5
  return null;
}

/** Y1c T18（spec §3.3 薄 keymap 焦点路由）：Tiptap 编辑器（ySyncPlugin 面——T16 起自带 history
 *  禁用：textExtensions/prompt-input extensions 均 history:false）内 Ctrl+Z/Y 路由到**统一
 *  UndoManager**（undoCanvas/redoCanvas——文本+画布同一撤销栈，跨编辑器顺序非全局=产品语义）。
 *  其余编辑上下文（INPUT/TEXTAREA 原生 undo/AntD 弹层/参考选择模式/视频编辑器）不入本路由——
 *  编辑器面以 DOM 锚（.ProseMirror/.tiptap——Tiptap 根元素类）判定，非 store 态。 */
export function isUnifiedUndoEditorSurface(target: HTMLElement | null | undefined): boolean {
  if (useNodeStore.getState().referenceSelect) return false;   // spec §3.1：参考选择模式期 Ctrl+Z 不生效
  if (useVideoEditorStore.getState().open) return false;      // 视频编辑器自有 undo（useEditorKeyboard）
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest('.ProseMirror, .tiptap');
}

export function useGroupKeyboard() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const s = useCanvasStore.getState();
      // 批2-1 四态化：会话未就绪（idle/pending/failed）禁分组/撤销快捷键
      if (s.hydration !== 'ready') return;
      const action = resolveGroupShortcut(e);
      if (!action) return;
      // T18 薄 keymap：编辑器面 undo/redo 穿透 isGroupEditContext 早退（history:false——统一 manager
      // 是编辑器撤销唯一入口）；其余编辑上下文照旧早退（原生 undo 归浏览器/弹层归自身）
      const unifiedUndoSurface = (action === 'undo' || action === 'redo')
        && isUnifiedUndoEditorSurface(e.target as HTMLElement | null);
      if (isGroupEditContext(e.target as HTMLElement) && !unifiedUndoSurface) return;

      const selected = s.nodes.filter((n) => n.selected);
      try {
        switch (action) {
          case 'group':
            if (selected.length >= 2) { e.preventDefault(); s.groupNodes(selected.map((n) => n.id)); }
            break;
          case 'merge-storyboard':
            if (selected.length >= 2) { e.preventDefault(); s.mergeStoryboard(selected.map((n) => n.id)); }
            break;
          case 'ungroup': {
            const g = selected.find((n) => n.type === NODE_TYPES.GROUP);
            if (g) { e.preventDefault(); s.ungroup(g.id); }
            break;
          }
          case 'remove-from-group': {
            const child = selected.find((n) => n.parentId && n.type !== NODE_TYPES.GROUP);
            if (child?.parentId) { e.preventDefault(); s.removeNodeFromGroup(child.parentId, child.id); }
            break;
          }
          case 'undo':
            e.preventDefault();
            undoCanvas().catch((err) => message.warning('撤销失败：' + (err as Error).message));
            break;
          case 'redo':
            e.preventDefault();
            redoCanvas().catch((err) => message.warning('重做失败：' + (err as Error).message));
            break;
        }
      } catch (err) {
        // 置灰条件的快捷键触发（如嵌套/非图片），Toast 提示错误信息
        message.warning((err as Error).message);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
}
