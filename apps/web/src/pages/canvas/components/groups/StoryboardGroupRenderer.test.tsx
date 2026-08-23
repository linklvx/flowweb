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
  selected: false,
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
});
