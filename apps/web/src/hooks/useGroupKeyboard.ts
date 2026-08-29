// useGroupKeyboard.ts
import { useEffect } from 'react';
import { message } from 'antd'; // Vite ESM：静态导入（require 不可用）
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';
import { undoCanvas, redoCanvas } from '@/stores/canvasUndo';

export function isGroupEditContext(target: HTMLElement | null): boolean {
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

export function useGroupKeyboard() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const s = useCanvasStore.getState();
      if (s.isHydrating) return;
      if (isGroupEditContext(e.target as HTMLElement)) return;

      const action = resolveGroupShortcut(e);
      if (!action) return;

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
            const g = selected.find((n) => n.type === 'group');
            if (g) { e.preventDefault(); s.ungroup(g.id); }
            break;
          }
          case 'remove-from-group': {
            const child = selected.find((n) => n.parentId && n.type !== 'group');
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
