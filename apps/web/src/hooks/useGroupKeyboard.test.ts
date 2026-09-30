// useGroupKeyboard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted：mock 工厂提升到 import 前，普通 const 会 TDZ——可变旗标供用例拨动 referenceSelect
const nodeState = vi.hoisted(() => ({
  activeEditNodeId: null as string | null,
  activeTransformNodeId: null as string | null,
  referenceSelect: null as unknown,
}));
vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: { getState: () => nodeState },
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

import { isGroupEditContext, resolveGroupShortcut } from '@/hooks/useGroupKeyboard';

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
