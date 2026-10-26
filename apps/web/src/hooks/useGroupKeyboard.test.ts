// useGroupKeyboard.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted：mock 工厂提升到 import 前，普通 const 会 TDZ——可变旗标供用例拨动 referenceSelect
const nodeState = vi.hoisted(() => ({
  activeEditNodeId: null as string | null,
  activeTransformNodeId: null as string | null,
  referenceSelect: null as unknown,
}));
vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: { getState: () => nodeState },
  NODE_TYPES: { GROUP: 'group' },
}));

// Mock other stores
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({
      hydration: 'ready' as const,
      nodes: [],
    }),
  },
}));

// Mock antd message
vi.mock('antd', () => ({
  message: {
    warning: vi.fn(),
  },
}));

// Y1c T18 薄 keymap：undoCanvas/redoCanvas 路由断言（统一 manager 唯一入口 spy）
const undoSpies = vi.hoisted(() => ({ undo: vi.fn(), redo: vi.fn() }));
vi.mock('@/stores/canvasUndo', () => ({
  undoCanvas: vi.fn(() => {
    undoSpies.undo();
    return Promise.resolve();
  }),
  redoCanvas: vi.fn(() => {
    undoSpies.redo();
    return Promise.resolve();
  }),
}));

import { isGroupEditContext, resolveGroupShortcut, isUnifiedUndoEditorSurface, useGroupKeyboard } from '@/hooks/useGroupKeyboard';
import { renderHook } from '@testing-library/react';

describe('isGroupEditContext（编辑态判定 spec 6.3）', () => {
  it('INPUT 聚焦 → true', () => {
    expect(isGroupEditContext(document.createElement('input'))).toBe(true);
  });
  it('普通 div → false', () => {
    expect(isGroupEditContext(document.createElement('div'))).toBe(false);
  });
  it('参考选择模式 → true（模式期 Ctrl+Z/G/Y 被禁，spec §3.1——防撤销刚加入的参考图）', () => {
    nodeState.referenceSelect = { sourceNodeId: 'img1' };
    expect(isGroupEditContext(document.createElement('div'))).toBe(true);
    nodeState.referenceSelect = null; // 还原，防污染既有用例
  });
});

describe('resolveGroupShortcut undo/redo 映射（S5：含 Ctrl+Y）', () => {
  it('ctrl+z → undo；ctrl+shift+z → redo；ctrl+y → redo；meta 兼容', () => {
    expect(resolveGroupShortcut({ ctrlKey: true, altKey: false, shiftKey: false, key: 'z' })).toBe('undo');
    expect(resolveGroupShortcut({ ctrlKey: true, altKey: false, shiftKey: true, key: 'z' })).toBe('redo');
    expect(resolveGroupShortcut({ ctrlKey: true, altKey: false, shiftKey: false, key: 'y' })).toBe('redo');
    expect(resolveGroupShortcut({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'z' } as any)).toBe('undo');
  });
});

describe('isGroupEditContext 焦点守卫（S4，五审 M-3 合并方案）', () => {
  it('INPUT/TEXTAREA/contentEditable 返回 true', () => {
    expect(isGroupEditContext({ tagName: 'INPUT' } as HTMLElement)).toBe(true);
    expect(isGroupEditContext({ tagName: 'TEXTAREA' } as HTMLElement)).toBe(true);
  });
  it('五审 M-3：activeElement 为 INPUT（含侧边栏输入框）→ 拦截', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(isGroupEditContext(null)).toBe(true);
    input.remove();
  });
  it('五审 M-3：activeElement 在 AntD 弹层 portal 内 → 拦截', () => {
    const dropdown = document.createElement('div');
    dropdown.className = 'ant-select-dropdown';
    const option = document.createElement('div');
    option.setAttribute('tabindex', '0');
    dropdown.appendChild(option);
    document.body.appendChild(dropdown);
    option.focus();
    expect(isGroupEditContext(null)).toBe(true);
    dropdown.remove();
  });
  it('五审 M-3：activeElement 为画布外普通按钮 → 放行（点击工具栏后 Ctrl+Z 不被误拦）', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    expect(isGroupEditContext(null)).toBe(false);
    btn.remove();
  });
});

describe('resolveGroupShortcut', () => {
  it.each([
    [{ ctrlKey: true, key: 'g', altKey: false, shiftKey: false }, 'group'],
    [{ ctrlKey: true, key: 'g', altKey: true, shiftKey: false }, 'merge-storyboard'],
    [{ ctrlKey: true, key: 'G', altKey: false, shiftKey: true }, 'ungroup'],
    [{ shiftKey: true, key: 'G', ctrlKey: false, altKey: false }, 'remove-from-group'],
    [{ ctrlKey: true, key: 'z', shiftKey: false }, 'undo'],
    [{ ctrlKey: true, key: 'Z', shiftKey: true }, 'redo'],
    [{ ctrlKey: false, key: 'x' }, null],
  ])('%j → %s', (ev, expected) => {
    expect(resolveGroupShortcut(ev as KeyboardEvent)).toBe(expected);
  });
});

// ════ Y1c T18 薄 keymap 焦点路由（spec §3.3：编辑器面 Ctrl+Z/Y →统一 UndoManager）════
describe('T18 isUnifiedUndoEditorSurface+Ctrl+Z 路由', () => {
  const makeEditor = (): HTMLElement => {
    const host = document.createElement('div');
    const editor = document.createElement('div');
    editor.className = 'tiptap ProseMirror';
    editor.setAttribute('contenteditable', 'true');
    host.appendChild(editor);
    document.body.appendChild(host);
    return editor;
  };
  afterEach(() => {
    document.body.innerHTML = '';
    nodeState.referenceSelect = null;
    undoSpies.undo.mockClear();
    undoSpies.redo.mockClear();
  });

  it('Tiptap 编辑器元素（.ProseMirror/.tiptap——T16 history:false 面）→ true；普通 INPUT/div → false', () => {
    const editor = makeEditor();
    expect(isUnifiedUndoEditorSurface(editor)).toBe(true);
    expect(isUnifiedUndoEditorSurface(editor.querySelector('div') ?? editor)).toBe(true);   // 宿主内亦命中（closest）
    expect(isUnifiedUndoEditorSurface(document.createElement('input'))).toBe(false);
    expect(isUnifiedUndoEditorSurface(document.createElement('div'))).toBe(false);
    expect(isUnifiedUndoEditorSurface(null)).toBe(false);
  });

  it('参考选择模式 → false（spec §3.1 模式期 Ctrl+Z 不生效——防撤销刚加入的参考图）', () => {
    nodeState.referenceSelect = { sourceNodeId: 'img1' };
    expect(isUnifiedUndoEditorSurface(makeEditor())).toBe(false);
  });

  it('handler：编辑器内 ctrl+z/ctrl+y 路由到统一 manager（undoCanvas/redoCanvas）；textarea 内不路由（原生 undo 归浏览器）', async () => {
    const { unmount } = renderHook(() => useGroupKeyboard());
    const editor = makeEditor();
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
    await Promise.resolve();
    expect(undoSpies.undo).toHaveBeenCalledTimes(1);   // 编辑器面穿透 isGroupEditContext（contentEditable 早退）
    expect(undoSpies.redo).toHaveBeenCalledTimes(1);
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await Promise.resolve();
    expect(undoSpies.undo).toHaveBeenCalledTimes(1);   // 原生输入面不路由（次数不增）
    unmount();
  });
});
