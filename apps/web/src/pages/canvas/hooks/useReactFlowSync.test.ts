import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mutable test state — the mock factories close over these bindings.
// Reassigned in beforeEach so each test starts clean.
// ---------------------------------------------------------------------------

let storeNodeMap: Record<string, any> = {};
const mockUpdateNodeData = vi.fn();
const mockDeleteNode = vi.fn().mockResolvedValue(undefined);

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: ((selector?: any) => {
    const state = {
      nodes: storeNodeMap,
      updateNodeData: mockUpdateNodeData,
      deleteNode: mockDeleteNode,
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }) as any,
}));

// ---------------------------------------------------------------------------
// useNodesState mock — returns a controlled tuple so we can observe calls
// ---------------------------------------------------------------------------

let rfNodes: any[] = [];
const mockSetNodes = vi.fn((update: any[] | ((prev: any[]) => any[])) => {
  if (typeof update === 'function') {
    rfNodes = update(rfNodes);
  } else {
    rfNodes = update;
  }
});
const mockOnNodesChange = vi.fn();

vi.mock('@xyflow/react', () => ({
  useNodesState: () => [rfNodes, mockSetNodes, mockOnNodesChange],
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import { useReactFlowSync } from './useReactFlowSync';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush the setTimeout(0) that resets the isUpdatingFromStoreRef guard. */
function tick() {
  act(() => {
    vi.advanceTimersByTime(0);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReactFlowSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    storeNodeMap = {};
    rfNodes = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 1. Store → ReactFlow sync on mount
  it('should sync store nodes to ReactFlow nodes on mount', () => {
    storeNodeMap['n1'] = {
      id: 'n1',
      type: 'textInput',
      position: { x: 0, y: 0 },
      data: { content: 'hello' },
    };
    storeNodeMap['n2'] = {
      id: 'n2',
      type: 'imageGen',
      position: { x: 100, y: 50 },
      data: { style: '写实', model: 'sdxl', status: 'idle' },
    };

    renderHook(() => useReactFlowSync());

    expect(mockSetNodes).toHaveBeenCalledTimes(1);
    const arg = mockSetNodes.mock.calls[0][0] as any[];
    expect(arg).toHaveLength(2);
    expect(arg[0]).toMatchObject({
      id: 'n1',
      type: 'textInput',
      position: { x: 0, y: 0 },
      data: { content: 'hello' },
    });
    expect(arg[1]).toMatchObject({
      id: 'n2',
      type: 'imageGen',
      position: { x: 100, y: 50 },
      data: { style: '写实', model: 'sdxl', status: 'idle' },
    });
  });

  // 2. Position change → store
  it('should update position in store on position change', () => {
    storeNodeMap['n1'] = {
      id: 'n1',
      type: 'textInput',
      position: { x: 0, y: 0 },
      data: { content: 'hello' },
    };

    const { result } = renderHook(() => useReactFlowSync());

    // Flush the setTimeout(0) that resets the sync guard
    tick();

    act(() => {
      result.current.handleNodesChange([
        { id: 'n1', type: 'position', position: { x: 50, y: 100 } } as any,
      ]);
    });

    expect(mockOnNodesChange).toHaveBeenCalled();
    expect(mockUpdateNodeData).toHaveBeenCalledWith('n1', {
      position: { x: 50, y: 100 },
    });
  });

  // 3. Select change → store
  it('should update selected in store on select change', () => {
    storeNodeMap['n1'] = {
      id: 'n1',
      type: 'textInput',
      position: { x: 0, y: 0 },
      data: { content: 'hello' },
    };

    const { result } = renderHook(() => useReactFlowSync());

    tick();

    act(() => {
      result.current.handleNodesChange([
        { id: 'n1', type: 'select', selected: true } as any,
      ]);
    });

    expect(mockOnNodesChange).toHaveBeenCalled();
    expect(mockUpdateNodeData).toHaveBeenCalledWith('n1', { selected: true });
  });

  // 4. Remove change → store
  it('should call deleteNode on remove change', () => {
    storeNodeMap['n1'] = {
      id: 'n1',
      type: 'textInput',
      position: { x: 0, y: 0 },
      data: { content: 'hello' },
    };

    const { result } = renderHook(() => useReactFlowSync());

    tick();

    act(() => {
      result.current.handleNodesChange([
        { id: 'n1', type: 'remove' } as any,
      ]);
    });

    expect(mockOnNodesChange).toHaveBeenCalled();
    expect(mockDeleteNode).toHaveBeenCalledWith('n1');
  });

  // 5. Prevent infinite loop — when store sync is in-flight, reverse
  //    updates must be blocked. After mount the useEffect sets
  //    isUpdatingFromStoreRef = true and schedules a setTimeout(0) to
  //    clear it. A synchronous handleNodesChange call that happens
  //    before the timer fires MUST skip store writes.
  it('should NOT trigger store update when syncing FROM store (prevent infinite loop)', () => {
    storeNodeMap['n1'] = {
      id: 'n1',
      type: 'textInput',
      position: { x: 0, y: 0 },
      data: { content: 'hello' },
    };

    const { result } = renderHook(() => useReactFlowSync());

    // The effect ran during render → isUpdatingFromStoreRef = true.
    // setTimeout(0) is queued but NOT yet executed (no tick() call).
    act(() => {
      result.current.handleNodesChange([
        { id: 'n1', type: 'position', position: { x: 999, y: 999 } } as any,
      ]);
    });

    // onNodesChange should still be called (RF side is always updated)
    expect(mockOnNodesChange).toHaveBeenCalled();
    // But store updates must be skipped
    expect(mockUpdateNodeData).not.toHaveBeenCalled();
    expect(mockDeleteNode).not.toHaveBeenCalled();
  });

  // 6. Unknown node — should not crash
  it('should NOT crash when handling change for unknown node id', () => {
    storeNodeMap['n1'] = {
      id: 'n1',
      type: 'textInput',
      position: { x: 0, y: 0 },
      data: { content: 'hello' },
    };

    const { result } = renderHook(() => useReactFlowSync());

    tick();

    expect(() => {
      act(() => {
        result.current.handleNodesChange([
          { id: 'unknown-id', type: 'position', position: { x: 50, y: 100 } } as any,
          { id: 'also-unknown', type: 'select', selected: true } as any,
          { id: 'ghost-node', type: 'remove' } as any,
        ]);
      });
    }).not.toThrow();

    // onNodesChange must still be called (forward all changes to RF)
    expect(mockOnNodesChange).toHaveBeenCalled();
  });
});
