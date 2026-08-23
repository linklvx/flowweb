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
  useCanvasStore: vi.fn((selector?: any) => selector({ nodes: getMockNodes() })),
}));

vi.mock('./StoryboardGroupRenderer', () => ({
  StoryboardGroupRenderer: (p: any) => (
    <div data-testid="renderer" data-cellnodes={JSON.stringify(p.cellNodes)} />
  ),
}));

vi.mock('./NormalGroupRenderer', () => ({
  NormalGroupRenderer: () => <div data-testid="normal-renderer" />,
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
