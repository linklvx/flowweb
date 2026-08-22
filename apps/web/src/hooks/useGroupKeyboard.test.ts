// useGroupKeyboard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock stores BEFORE importing the module under test
vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: {
    getState: () => ({
      activeEditNodeId: null,
      activeTransformNodeId: null,
    }),
  },
}));

// Mock other stores
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({
      isHydrating: false,
      nodes: [],
    }),
  },
}));

vi.mock('@/stores/groupHistory', () => ({
  useGroupHistory: {
    getState: () => ({
      undo: vi.fn(),
      redo: vi.fn(),
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
