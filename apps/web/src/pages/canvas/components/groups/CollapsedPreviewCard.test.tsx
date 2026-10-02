// CollapsedPreviewCard.test.tsx（§4.5 折叠宫格预览卡——2d-3；2d-4 两段渲染后 img 断言待 phase2）
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CollapsedPreviewCard, calcCollapsedGrid } from './CollapsedPreviewCard';

// P0-2 同款（StoryboardGroupRenderer.test.tsx:7 先例）：mock useMediaUrl——fileId → 预签名 URL 解析；
// 'pending' 前缀模拟「URL 未解析（loading/error）」→ 占位分支
vi.mock('@/hooks/useMediaUrl', () => ({
  useMediaUrl: (fileId: string | null) => ({
    url: fileId && !fileId.startsWith('pending') ? `/flowai/${fileId}` : null,
    loading: !!fileId?.startsWith('pending'),
    error: null,
    onError: () => {},
  }),
}));

// 2d-4：卡片 effect 会发起批量预取——mock apiFetch 使其 hermetic（空行集即可：settle → phase2 挂 tile）
vi.mock('@/api/client', () => ({
  apiFetch: vi.fn().mockResolvedValue([]),
}));

const cell = (id: string, fileId?: string) => ({ nodeId: id, fileId });

describe('CollapsedPreviewCard 结构（§4.5）', () => {
  it('宫格 padding 6/gap 4/圆角 6 + summaryRow「3 个节点」（N=cells 总数非显示数）+ 根 div 显式尺寸=COLLAPSED_SIZE 220×160（2d-1 不变量载体）', () => {
    render(<CollapsedPreviewCard name="组" cells={[cell('a', 'f1'), cell('b', 'f2'), cell('c')]} />);
    const grid = screen.getByTestId('collapsed-preview-grid');
    expect(grid.style.gridAutoRows).toBe('minmax(0, 1fr)');
    expect(grid.style.padding).toBe('6px');
    expect(grid.style.gap).toBe('4px');
    expect(grid.style.borderRadius).toBe('6px');
    expect(screen.getByText('3 个节点')).toBeTruthy();
    expect(screen.getAllByTestId('collapsed-tile')).toHaveLength(3);
    const card = screen.getByTestId('collapsed-preview-card');
    expect(card.style.width).toBe('220px');
    expect(card.style.height).toBe('160px');
  });

  it('≤6 tile：7 cells → 只渲染 6 tile，summary 仍是「7 个节点」+ aria-label 同总数', () => {
    render(<CollapsedPreviewCard name="组" cells={[cell('a', 'f1'), cell('b', 'f2'), cell('c', 'f3'), cell('d', 'f4'), cell('e', 'f5'), cell('f', 'f6'), cell('g', 'f7')]} />);
    expect(screen.getAllByTestId('collapsed-tile')).toHaveLength(6);
    expect(screen.getByText('7 个节点')).toBeTruthy();
    expect(screen.getByTestId('collapsed-preview-card').getAttribute('aria-label')).toBe('组，7 个节点');
  });

  it('根元素 title=组名 + aria-label「{name}，N 个节点」', () => {
    render(<CollapsedPreviewCard name="我的分组" cells={[cell('a'), cell('b')]} />);
    const card = screen.getByTestId('collapsed-preview-card');
    expect(card.getAttribute('title')).toBe('我的分组');
    expect(card.getAttribute('aria-label')).toBe('我的分组，2 个节点');
  });
});

describe('calcCollapsedGrid（列数纯函数——1-2 按数量/3-4→2 列/5+→3 列）', () => {
  it('1→1, 2→2, 3→2, 4→2, 5→3, 6→3, 7→3', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(calcCollapsedGrid)).toEqual([1, 2, 2, 2, 3, 3, 3]);
  });
  it('0（空组）兜底 1 列（防 repeat(0, 1fr) 无效轨道）', () => {
    expect(calcCollapsedGrid(0)).toBe(1);
  });
});

describe('CollapsedPreviewCard tile 取图', () => {
  it('fileId → useMediaUrl 解析 url 挂 img src；无 fileId → 图标占位（其它节点类型同款占位）', async () => {
    render(<CollapsedPreviewCard name="组" cells={[cell('a', 'f1'), cell('b')]} />);
    // 2d-4 两段渲染：img 在 batch settle → phase2 挂 tile 后出现
    const img = await screen.findByTestId('collapsed-tile-img') as HTMLImageElement;
    expect(img.src).toContain('/flowai/f1');
    expect(screen.getAllByTestId('collapsed-tile-placeholder')).toHaveLength(1);
  });
  it('url 未解析（loading/error/pending）→ 图标占位不挂 img', async () => {
    render(<CollapsedPreviewCard name="组" cells={[cell('a', 'pending-f1')]} />);
    await act(async () => {});                       // 冲刷批量 settle → phase2 已挂 tile（url 仍未解析）
    expect(screen.queryByTestId('collapsed-tile-img')).toBeNull();
    expect(screen.getAllByTestId('collapsed-tile-placeholder')).toHaveLength(1);
  });
});

describe('CollapsedPreviewCard 边框（组色双兜底 + 选中态优先）', () => {
  const card = () => screen.getByTestId('collapsed-preview-card');
  // jsdom 不拆含 var() 的 border 简写 → 断言整串（NormalGroupRenderer.test.tsx:32 先例）
  it("color='red' → 组色 var(--canvas-group-color-red)；未设色 → 中性兜底 var(--canvas-group-border)", () => {
    const { rerender } = render(<CollapsedPreviewCard name="组" color="red" cells={[]} />);
    expect(card().style.border).toBe('2px dashed var(--canvas-group-color-red)');
    rerender(<CollapsedPreviewCard name="组" cells={[]} />);
    expect(card().style.border).toBe('2px dashed var(--canvas-group-border)');
  });
  it('选中高亮 > 组色：selected 且 color=red → var(--fw-text)（GROUP_BOX.selectedBorder——折叠卡选中样式现状族）', () => {
    render(<CollapsedPreviewCard name="组" color="red" selected cells={[]} />);
    expect(card().style.border).toBe('2px dashed var(--fw-text)');
  });
});
