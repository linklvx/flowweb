// StoryboardGroupRenderer.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StoryboardGroupRenderer } from './StoryboardGroupRenderer';

// P0-2：mock useMediaUrl —— 宫格取图经 fileId → 预签名 URL 解析（JSON API 不能直接作 src）
vi.mock('@/hooks/useMediaUrl', () => ({
  useMediaUrl: (fileId: string | null) => ({
    url: fileId ? `/flowai/${fileId}` : null, loading: false, error: null,
  }),
}));

const cells = [
  { id: 'a', fileId: 'f1', status: 'done' },
  { id: 'b', fileId: 'f2', status: 'done' },
];

const props = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  data: {
    groupType: 'storyboard',
    cells: ['a', 'b'],
    storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' as const },
    ...over,
  },
  cellNodes: cells,
});

describe('StoryboardGroupRenderer', () => {
  it('渲染宫格图与两位补零序号（img src 为解析后的 URL）', () => {
    render(<StoryboardGroupRenderer {...(props() as any)} />);
    expect(screen.getByText('01')).toBeTruthy();
    expect(screen.getByText('02')).toBeTruthy();
    const imgs = screen.getAllByRole('presentation').filter((el) => el.tagName === 'IMG');
    expect(imgs[0] as HTMLImageElement).toHaveProperty('src', expect.stringContaining('/flowai/f1'));
  });

  it('空宫格显示 + 占位（2x2 只有 2 图 → 2 个空位）', () => {
    render(<StoryboardGroupRenderer {...(props() as any)} />);
    expect(screen.getAllByText('+')).toHaveLength(2);
  });

  it('loading 态宫格显示占位', () => {
    const customProps = props();
    (customProps as any).cellNodes = [{ id: 'a', fileId: 'f1', status: 'loading' }, cells[1]];
    render(<StoryboardGroupRenderer {...(customProps as any)} />);
    expect(screen.getByText(/生成中/)).toBeTruthy();
  });

  it('showIndex=false 无序号', () => {
    render(<StoryboardGroupRenderer {...(props({
      storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false, stitchResolution: '2K' },
    }) as any)} />);
    expect(screen.queryByText('01')).toBeNull();
  });

  it('空宫格 + 按钮 dispatch fill-cell 事件携带 groupId（P0-新2）', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    render(<StoryboardGroupRenderer {...(props() as any)} />);
    fireEvent.click(screen.getAllByText('+')[0]);
    const evt = dispatchSpy.mock.calls.map((c) => c[0]).find((e) => (e as Event).type === 'storyboard:fill-cell');
    expect(evt).toBeTruthy();
    expect((evt as CustomEvent).detail.groupId).toBe('g1'); // 来自 NodeProps.id，非 data.groupId
  });

  it('根容器 absolute inset:0 + 格子 100% 填充轨道（RF .react-flow__node-group 默认 padding 10px，静态 100% 尺寸 + 固定格子像素会溢出节点盒）', () => {
    const { container } = render(<StoryboardGroupRenderer {...(props() as any)} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.position).toBe('absolute');
    expect(root.style.inset).toBe('0');
    const cell = root.children[0] as HTMLElement; // 第一个 StoryboardCell 根 div
    expect(cell.style.width).toBe('100%');
    expect(cell.style.height).toBe('100%');
  });

  it('组框与格子间有 5px padding（图片不贴组框边）', () => {
    const { container } = render(<StoryboardGroupRenderer {...(props() as any)} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.padding).toBe('5px');
  });

  it('格子间有 3px 间隙（图片不挤一块）', () => {
    const { container } = render(<StoryboardGroupRenderer {...(props() as any)} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.gap).toBe('3px');
  });

  it('组框边框随主题双值（选中态无高亮边框，选中反馈仅有上方悬浮工具条）', () => {
    const { container } = render(<StoryboardGroupRenderer {...(props() as any)} />);
    const root = container.firstElementChild as HTMLElement;
    // C8 D3-board：组边框随 controls-border 双值（深 rgb(51,51,51)/浅 rgb(229,231,235)）——
    // jsdom 对含 var() 的 shorthand 不展开 longhand（borderColor 读回空串），断言 verbatim shorthand 串
    expect(root.style.border).toBe('1px solid var(--canvas-controls-border)');
  });

  it('格子选中态边框随前景双值 1px（浅档防选中框消失）', () => {
    const { container } = render(<StoryboardGroupRenderer {...(props() as any)} />);
    const cell = (container.firstElementChild as HTMLElement).children[0] as HTMLElement;
    fireEvent.click(cell);
    // C8 D3-board：选中格边随 --fw-text 双值（深 rgb(226,232,240)/浅 rgb(31,35,41)）——
    // jsdom 对含 var() 的 shorthand 不展开 longhand（borderWidth/borderColor 读回空串），断言 verbatim shorthand 串
    expect(cell.style.border).toBe('1px solid var(--fw-text)');
  });

  it('标题浮层在容器外右上角（translateY(-100%)，与普通组/节点标题一致）', () => {
    render(<StoryboardGroupRenderer {...(props() as any)} />);
    const title = screen.getByText('分镜组') as HTMLElement;
    expect(title.style.transform).toBe('translateY(-100%)');
    expect(title.style.top).toBe('0px');
    expect(title.style.right).toBe('0px');
  });

  it('无 storyboard 的克隆体渲染不崩且按 1×1 默认网格（F2 消费点①）', () => {
    const noStoryboardData = { groupType: 'storyboard', cells: [null] } as any;
    expect(() => render(<StoryboardGroupRenderer id="g1" data={noStoryboardData} cellNodes={[]} />)).not.toThrow();
  });
});
