// apps/web/src/pages/canvas/components/groups/GroupNode.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GroupNode } from './GroupNode';

const { getMockNodes, setMockNodes } = vi.hoisted(() => {
  let mockNodes: any[] = [];
  return {
    getMockNodes: () => mockNodes,
    setMockNodes: (n: any[]) => { mockNodes = n; },
  };
});

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => selector({ nodes: getMockNodes() })),
    { getState: () => ({ nodes: getMockNodes(), markManuallyResized: vi.fn() }) },
  ),
}));

vi.mock('./StoryboardGroupRenderer', () => ({
  StoryboardGroupRenderer: (p: any) => (
    <div data-testid="renderer" data-cellnodes={JSON.stringify(p.cellNodes)} />
  ),
}));

vi.mock('./NormalGroupRenderer', () => ({
  NormalGroupRenderer: (p: any) => <div data-testid="normal-renderer" data-groupid={p.groupId} />,
}));

vi.mock('@xyflow/react', async (orig) => ({
  ...(await orig<typeof import('@xyflow/react')>()),
  NodeResizer: (p: any) => (
    <div
      data-testid="node-resizer"
      data-visible={String(p.isVisible)}
      data-minw={String(p.minWidth)}
      data-minh={String(p.minHeight)}
    />
  ),
}));

describe('GroupNode（StoryboardGroupRendererCellNodes 映射）', () => {
  it('cellNodes fileId 归一化：无 fileId 有 referenceImage（上传图）→ fileId 取 referenceImage（格子有图）', () => {
    setMockNodes([
      {
        id: 'g1', type: 'group', position: { x: 0, y: 0 },
        data: { groupType: 'storyboard', cells: ['c1', 'c2'] },
      },
      { id: 'c1', type: 'imageGen', position: { x: 0, y: 0 }, data: { status: 'idle', referenceImage: 'ref-1' } },
      { id: 'c2', type: 'imageGen', position: { x: 0, y: 0 }, data: { status: 'done', fileId: 'gen-2', mediaUrl: 'http://m/gen-2' } },
    ]);
    render(<GroupNode id="g1" data={{ groupType: 'storyboard', cells: ['c1', 'c2'] }} selected={false} {...{} as any} />);
    const cellNodes = JSON.parse(screen.getByTestId('renderer').getAttribute('data-cellnodes')!);
    expect(cellNodes).toEqual([
      { id: 'c1', fileId: 'ref-1', status: 'idle' }, // url: undefined 序列化丢失
      { id: 'c2', fileId: 'gen-2', status: 'done', url: 'http://m/gen-2' },
    ]);
  });
});

describe('GroupNode（普通组 NodeResizer）', () => {
  it('普通组：选中时渲染 NodeResizer，未选中不渲染', () => {
    setMockNodes([]);
    const { rerender } = render(<GroupNode id="g1" data={{ groupType: 'normal' }} selected={false} {...{} as any} />);
    expect(screen.queryByTestId('node-resizer')).toBeNull();
    rerender(<GroupNode id="g1" data={{ groupType: 'normal' }} selected={true} {...{} as any} />);
    expect(screen.getByTestId('node-resizer')).toBeTruthy();
  });

  it('普通组：折叠态即使选中也不渲染 NodeResizer', () => {
    setMockNodes([]);
    render(<GroupNode id="g1" data={{ groupType: 'normal', collapsed: true }} selected={true} {...{} as any} />);
    expect(screen.queryByTestId('node-resizer')).toBeNull();
  });
});

describe('GroupNode（组缩放最小尺寸 R5）', () => {
  it('minWidth/minHeight = 子节点联合包围盒 + 非对称 padding', () => {
    setMockNodes([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 740, height: 370, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 20, y: 50 }, width: 300, height: 200, data: {} },
      { id: 'c2', type: 'imageGen', parentId: 'g1', position: { x: 420, y: 50 }, width: 300, height: 300, data: {} },
    ]);
    render(<GroupNode id="g1" data={{ groupType: 'normal' }} selected={true} {...{} as any} />);
    const resizer = screen.getByTestId('node-resizer');
    expect(resizer.getAttribute('data-minw')).toBe('740');  // 联合宽 700 + 40
    expect(resizer.getAttribute('data-minh')).toBe('370'); // 联合高 300 + 50 + 20
  });

  it('子节点 width 为空时走 measured 再 fallback', () => {
    setMockNodes([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 589, height: 380, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 20, y: 50 }, width: null, height: null, measured: { width: 549, height: 310 }, data: {} },
    ]);
    render(<GroupNode id="g1" data={{ groupType: 'normal' }} selected={true} {...{} as any} />);
    const resizer = screen.getByTestId('node-resizer');
    expect(resizer.getAttribute('data-minw')).toBe('589');  // 549 + 40
    expect(resizer.getAttribute('data-minh')).toBe('380'); // 310 + 70
  });

  it('无子节点保留 200/120 兜底', () => {
    setMockNodes([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 200, data: { groupType: 'normal' } },
    ]);
    render(<GroupNode id="g1" data={{ groupType: 'normal' }} selected={true} {...{} as any} />);
    const resizer = screen.getByTestId('node-resizer');
    expect(resizer.getAttribute('data-minw')).toBe('200');
    expect(resizer.getAttribute('data-minh')).toBe('120');
  });
});
