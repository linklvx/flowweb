// apps/web/src/pages/canvas/components/groups/GroupNode.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GroupNode } from './GroupNode';
import { useNodeStore } from '@/stores/nodeStore';

const { getMockNodes, setMockNodes, getMockMarqueeSelecting, setMockMarqueeSelecting, getResizeCalls, resetResizeCalls } = vi.hoisted(() => {
  let mockNodes: any[] = [];
  let mockMarqueeSelecting = false;
  let resizeCalls: { start: unknown[]; end: number } = { start: [], end: 0 };
  return {
    getMockNodes: () => mockNodes,
    setMockNodes: (n: any[]) => { mockNodes = n; },
    getMockMarqueeSelecting: () => mockMarqueeSelecting,
    setMockMarqueeSelecting: (v: boolean) => { mockMarqueeSelecting = v; },
    getResizeCalls: () => resizeCalls,
    resetResizeCalls: () => { resizeCalls = { start: [], end: 0 }; },
  };
});

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => selector({
      nodes: getMockNodes(),
      marqueeSelecting: getMockMarqueeSelecting(),
      localCollapsed: {},
      // B4'-2：组 resizer 接线（beginResize/commitResizeGesture——行为断言经 getResizeCalls）
      beginResize: (id: string, pointerId: number | null) => { getResizeCalls().start.push({ id, pointerId }); },
      commitResizeGesture: () => { getResizeCalls().end += 1; },
    })),
    { getState: () => ({ nodes: getMockNodes() }) },
  ),
}));

vi.mock('@/components/storyboard/StoryboardGroupRenderer', () => ({
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
      onClick={() => p.onResizeStart?.({ sourceEvent: { pointerId: 9 } })}
      onDoubleClick={() => p.onResizeEnd?.()}
    />
  ),
}));

describe('GroupNode（StoryboardGroupRendererCellNodes 映射）', () => {
  // Y2 A5：cellNodes 列表=渲染节点 data 携带（projectCanvas 内核——id+slot）；cs 节点仅补
  // mediaId/status（byId 直查）。mock nodes=cs 作者缓存面。
  // Y2 B3 契约（spec D8）：主槽判定=resolvePrimaryMediaId 单源——作者键 data.mediaId 非空用它，
  // 否则（无产物入参）主槽为空；referenceImage 不再充当主槽兜底、status 禁读（cellNodes status 只来自
  // exec 投影——execOverrideOf 无条目=undefined 序列化丢失）。
  it('cellNodes mediaId 归一化：无作者键（仅 referenceImage 上传图）→ mediaId 空（referenceImage 不再兜底）', () => {
    setMockNodes([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, data: { referenceImage: 'ref-1' } },
      { id: 'c2', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, data: { mediaId: 'gen-2' } },
    ]);
    render(<GroupNode id="g1" data={{ groupType: 'storyboard', cellNodes: [{ id: 'c1' }, { id: 'c2' }] }} selected={false} {...{} as any} />);
    const cellNodes = JSON.parse(screen.getByTestId('renderer').getAttribute('data-cellnodes')!);
    expect(cellNodes).toEqual([
      { id: 'c1' }, // referenceImage 兜底退役——mediaId:undefined/status:undefined 序列化丢失
      { id: 'c2', mediaId: 'gen-2' },
    ]);
  });

  it('R2b-7 读点清零：节点 data 含遗留 mediaUrl 键 → cellNodes 不透传 url（陈旧 URL 不进读路径）', () => {
    setMockNodes([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, data: { mediaId: 'gen-1', mediaUrl: 'http://stale/presigned' } },
    ]);
    render(<GroupNode id="g1" data={{ groupType: 'storyboard', cellNodes: [{ id: 'c1' }] }} selected={false} {...{} as any} />);
    const cellNodes = JSON.parse(screen.getByTestId('renderer').getAttribute('data-cellnodes')!);
    expect(cellNodes).toEqual([{ id: 'c1', mediaId: 'gen-1' }]); // 无 url 键（status 禁读零回落）
    expect(JSON.stringify(cellNodes)).not.toContain('stale');
  });

  it('membership=cellNodes 单通道：已移出子（cs 仍在但不在渲染节点 cellNodes）→ 不进分镜宫格', () => {
    // Y2 A5：格位/成员真源=内核 cellNodes（parentId 派生）；cs byId 只补媒体身份不扩员
    setMockNodes([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, data: { mediaId: 'a' } },
      { id: 'c2', type: 'imageGen', position: { x: 0, y: 0 }, data: { mediaId: 'b' } },
    ]);
    render(<GroupNode id="g1" data={{ groupType: 'storyboard', cellNodes: [{ id: 'c1' }] }} selected={false} {...{} as any} />);
    const cellNodes = JSON.parse(screen.getByTestId('renderer').getAttribute('data-cellnodes')!);
    expect(cellNodes).toEqual([{ id: 'c1', mediaId: 'a' }]);
  });

  it('批1-6 合并视图：data.status=loading 但 exec 投影 done → cellNodes status=done（读点换源）', () => {
    setMockNodes([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, data: { status: 'loading' } },
    ]);
    useNodeStore.setState({ execStatus: new Map([['c1', { status: 'done' }]]) });
    render(<GroupNode id="g1" data={{ groupType: 'storyboard', cellNodes: [{ id: 'c1' }] }} selected={false} {...{} as any} />);
    const cellNodes = JSON.parse(screen.getByTestId('renderer').getAttribute('data-cellnodes')!);
    expect(cellNodes).toEqual([{ id: 'c1', status: 'done' }]); // mediaId: undefined 序列化丢失
    useNodeStore.setState({ execStatus: new Map() });
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

  it("B4'-2 分镜组现状锚（终裁 57④）：storyboard 分支早退——选中也不出现 resizer（防 O0 改造丢结构）", () => {
    setMockNodes([]);
    render(
      <GroupNode
        id="g1"
        data={{ groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 1, showIndex: true, stitchResolution: '2K' } }}
        selected={true}
        {...{} as any}
      />,
    );
    expect(screen.queryByTestId('node-resizer')).toBeNull();
    expect(screen.getByTestId('renderer')).toBeTruthy();   // 分镜渲染分支在位
  });

  it("B4'-2 组 resizer 接线（终裁 44③/56）：onResizeStart→beginResize(id, pointerId)+onResizeEnd→commitResizeGesture", async () => {
    setMockNodes([]);
    resetResizeCalls();
    render(<GroupNode id="g1" data={{ groupType: 'normal' }} selected={true} {...{} as any} />);
    await fireEvent.click(screen.getByTestId('node-resizer'));           // 模拟 resize 手势开始（sourceEvent.pointerId=9）
    expect(getResizeCalls().start).toEqual([{ id: 'g1', pointerId: 9 }]);  // 懒激活——会话即建
    await fireEvent.doubleClick(screen.getByTestId('node-resizer'));     // 模拟松手（onResizeEnd）
    expect(getResizeCalls().end).toBe(1);                                 // 单提交路径
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

describe('GroupNodeResizer 框选抑制（消费点 4）', () => {
  it('selected 且未折叠 + marqueeSelecting=true → Resizer 不渲染；false 恢复', () => {
    setMockNodes([]);
    setMockMarqueeSelecting(true);
    const { rerender } = render(
      <GroupNode id="g1" data={{ groupType: 'normal' }} selected {...{} as any} />
    );
    expect(screen.queryByTestId('node-resizer')).not.toBeInTheDocument();
    setMockMarqueeSelecting(false);
    rerender(<GroupNode id="g1" data={{ groupType: 'normal' }} selected {...{} as any} />);
    expect(screen.getByTestId('node-resizer')).toBeInTheDocument();
  });
});
