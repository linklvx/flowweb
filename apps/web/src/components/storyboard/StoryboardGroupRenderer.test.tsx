// apps/web/src/components/storyboard/StoryboardGroupRenderer.test.tsx
// O0c-2（Spec B）：随组件自 canvas 页目录抽迁（零 store 纯组件）；新增两形态用例：
// 公开页形态（onRemoveCell 缺省——零 Delete 键监听）与公开页取图通道（thumbnailUrl）。
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

  it('空宫格显示 + 占位（2x2 只有 2 图 → 2 个空位——主画布形态注入 onFillEmpty）', () => {
    render(<StoryboardGroupRenderer {...(props() as any)} onFillEmpty={vi.fn()} />);
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

  it('空宫格 + 按钮点击经 onFillEmpty 回调携带格序（O0c-2 参数化——事件分发上移 GroupNode 注入，组件零 window 依赖）', () => {
    const onFillEmpty = vi.fn();
    render(<StoryboardGroupRenderer {...(props() as any)} onFillEmpty={onFillEmpty} />);
    fireEvent.click(screen.getAllByText('+')[0]);
    expect(onFillEmpty).toHaveBeenCalledWith(2); // 2x2 宫格首个空位=index 2（cells=['a','b',...]）
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

  it('shell 背景/边框 2d-7 token 化：--canvas-storyboard-shell-bg + 1px --canvas-group-border（原 controls token 迁移）', () => {
    const { container } = render(<StoryboardGroupRenderer {...(props() as any)} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.background).toBe('var(--canvas-storyboard-shell-bg)');
    // jsdom 对含 var() 的 shorthand 不展开 longhand（borderColor 读回空串），断言 verbatim shorthand 串
    expect(root.style.border).toBe('1px solid var(--canvas-group-border)');
  });

  it('组色描边吃组色（v10 裁决 4）：color=red → border 随 --canvas-group-color-red', () => {
    const { container } = render(<StoryboardGroupRenderer {...(props({ color: 'red' }) as any)} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.border).toBe('1px solid var(--canvas-group-color-red)');
  });

  it('组色未设/bogus → 回退 --canvas-group-border（单回退点，NormalGroupRenderer 2c-5 同款；不抛错）', () => {
    const unset = render(<StoryboardGroupRenderer {...(props() as any)} />);
    expect((unset.container.firstElementChild as HTMLElement).style.border).toBe('1px solid var(--canvas-group-border)');
    const bogus = render(<StoryboardGroupRenderer {...(props({ color: 'bogus' }) as any)} />);
    expect((bogus.container.firstElementChild as HTMLElement).style.border).toBe('1px solid var(--canvas-group-border)');
  });

  it('格子选中态边框随前景双值 1px（浅档防选中框消失）', () => {
    const { container } = render(<StoryboardGroupRenderer {...(props() as any)} />);
    const cell = (container.firstElementChild as HTMLElement).children[0] as HTMLElement;
    fireEvent.click(cell);
    // C8 D3-board：选中格边随 --fw-text 双值（深 rgb(226,232,240)/浅 rgb(31,35,41)）——
    // jsdom 对含 var() 的 shorthand 不展开 longhand（borderWidth/borderColor 读回空串），断言 verbatim shorthand 串
    expect(cell.style.border).toBe('1px solid var(--fw-text)');
  });

  it('无 storyboard 的克隆体渲染不崩且按 1×1 默认网格（F2 消费点①）', () => {
    const noStoryboardData = { groupType: 'storyboard', cells: [null] } as any;
    expect(() => render(<StoryboardGroupRenderer id="g1" data={noStoryboardData} cellNodes={[]} />)).not.toThrow();
  });
});

describe('StoryboardGroupRenderer（O0c-2 零 store 抽迁——两形态）', () => {
  it('公开页取图通道：cellNodes 仅 thumbnailUrl（fileId 缺席）→ img src=thumbnailUrl 直用', () => {
    render(<StoryboardGroupRenderer {...(props() as any)} cellNodes={[{ id: 'a', thumbnailUrl: '/th/a.webp' }, { id: 'b', thumbnailUrl: '/th/b.webp' }]} />);
    const imgs = screen.getAllByRole('presentation').filter((el) => el.tagName === 'IMG');
    expect((imgs[0] as HTMLImageElement).getAttribute('src')).toBe('/th/a.webp');
    expect((imgs[1] as HTMLImageElement).getAttribute('src')).toBe('/th/b.webp');
  });

  it('公开页形态（onRemoveCell/onFillEmpty 缺省）：零 window keydown 监听注册（只读分享页无删除热键）', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    render(<StoryboardGroupRenderer {...(props() as any)} />);
    expect(addSpy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);
    addSpy.mockRestore();
  });

  it('公开页形态：空格不渲染 + 按钮（参数化对称——只读页无死交互可供性）', () => {
    render(<StoryboardGroupRenderer {...(props() as any)} />);
    expect(screen.queryAllByText('+')).toEqual([]);
  });

  it('主画布形态：选中格后 Delete 键经 onRemoveCell 回调（参数化——组件不直连 store）', () => {
    const onRemoveCell = vi.fn();
    const { container } = render(<StoryboardGroupRenderer {...(props() as any)} onRemoveCell={onRemoveCell} />);
    fireEvent.click((container.firstElementChild as HTMLElement).children[0]); // 选中格 0
    fireEvent(window, new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(onRemoveCell).toHaveBeenCalledWith(0);
  });
});
