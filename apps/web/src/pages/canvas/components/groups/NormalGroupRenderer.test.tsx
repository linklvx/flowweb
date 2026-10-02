// NormalGroupRenderer.test.tsx（全量替换）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NormalGroupRenderer } from './NormalGroupRenderer';

const renameGroup = vi.fn();
const mockStore = { nodes: [] as any[], renameRequest: null as { groupId: string; nonce: number } | null };
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (sel: any) => sel({ nodes: mockStore.nodes, renameGroup, renameRequest: mockStore.renameRequest }),
}));

// 2d-3：折叠分支内内容换成 CollapsedPreviewCard → tile 取图走 useMediaUrl（StoryboardGroupRenderer.test.tsx:7 同款 mock）
vi.mock('@/hooks/useMediaUrl', () => ({
  useMediaUrl: (fileId: string | null) => ({
    url: fileId ? `/flowai/${fileId}` : null, loading: false, error: null, onError: () => {},
  }),
}));

// 2d-4：折叠卡批量预取 effect 发起 batch——mock apiFetch 使其 hermetic（空行集即可 settle → phase2）
vi.mock('@/api/client', () => ({
  apiFetch: vi.fn().mockResolvedValue([]),
}));

describe('NormalGroupRenderer 展开态', () => {
  beforeEach(() => {
    mockStore.nodes = [{ id: 'c1', parentId: 'g1' }, { id: 'c2', parentId: 'g1' }, { id: 'x', parentId: null }];
    renameGroup.mockClear();
  });

  it('默认名「分组」+ 徽标「2 项」（for 循环计数）', () => {
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal' } as any} selected={false} />);
    expect(screen.getByText('分组')).toBeTruthy();
    expect(screen.getByText('2 项')).toBeTruthy();
  });

  it('自定义名显示 data.name', () => {
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '我的分组' } as any} selected={false} />);
    expect(screen.getByText('我的分组')).toBeTruthy();
  });

  it('展开态边框 1px solid var(--canvas-group-border)（F17/F22；不随 selected 变化——选中反馈由四角手柄承担）', () => {
    const { rerender } = render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal' } as any} selected={false} />);
    const box = screen.getByTestId('group-box');
    expect(box.style.border).toBe('1px solid var(--canvas-group-border)');
    // C8 D3-board：分组底随 controls-bg 双值（深 rgb(38,38,38)/浅 #f0f1f2）——原 rgba(26,26,26,0.6) 恒深字面摘除
    expect(box.style.background).toContain('var(--canvas-controls-bg)');
    rerender(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal' } as any} selected={true} />);
    expect(screen.getByTestId('group-box').style.border).toBe('1px solid var(--canvas-group-border)');
  });

  it('组色描边：data.color=red → 1px solid var(--canvas-group-color-red)；未设色 → 回退 var(--canvas-group-border)（组件内唯一回退点）', () => {
    const { rerender } = render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', color: 'red' } as any} selected={false} />);
    expect(screen.getByTestId('group-box').style.border).toBe('1px solid var(--canvas-group-color-red)');
    rerender(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal' } as any} selected={false} />);
    expect(screen.getByTestId('group-box').style.border).toBe('1px solid var(--canvas-group-border)');
  });

  it('组名入框（F17）：标题行在框内顶部预留带（top:0 无负位移），字号 13', () => {
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal' } as any} selected={false} />);
    const title = screen.getByText('分组').parentElement as HTMLElement;
    expect(title.style.transform).toBe('');
    expect(title.style.top).toBe('0px');
    expect(title.style.left).toBe('0px');
    expect(title.style.fontSize).toBe('13px');
  });

  it('编辑态输入框与组名同位（框内顶部 top:0 无负位移——双击改名不跳出框）', () => {
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '旧名' } as any} selected={false} />);
    fireEvent.doubleClick(screen.getByText('旧名'));
    const input = screen.getByRole('textbox') as HTMLElement;
    expect(input.style.transform).toBe('');
    expect(input.style.top).toBe('0px');
  });

  it('无 relative 包裹 div——absolute 子元素直接挂载（inset:0 相对整个节点盒，不受 RF 默认 padding 内缩）', () => {
    const { container } = render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal' } as any} selected={false} />);
    expect(screen.getByTestId('group-box').parentElement).toBe(container);
  });

  it('双击进入编辑；Enter 提交非空名', () => {
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '旧名' } as any} selected={false} />);
    fireEvent.doubleClick(screen.getByText('旧名'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '新名' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(renameGroup).toHaveBeenCalledWith('g1', '新名');
  });

  it('空输入提交回退默认「分组」', () => {
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '旧名' } as any} selected={false} />);
    fireEvent.doubleClick(screen.getByText('旧名'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(renameGroup).toHaveBeenCalledWith('g1', '分组');
  });

  it('Esc 取消不提交', () => {
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '旧名' } as any} selected={false} />);
    fireEvent.doubleClick(screen.getByText('旧名'));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(renameGroup).not.toHaveBeenCalled();
    expect(screen.getByText('旧名')).toBeTruthy();
  });

  it('Enter 触发 blur 后不重复提交（committedRef guard）', () => {
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '旧名' } as any} selected={false} />);
    fireEvent.doubleClick(screen.getByText('旧名'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '新名' } });
    fireEvent.keyDown(input, { key: 'Enter' }); // Enter 提交 → setEditing(false) → input 卸载（无 blur 双触发路径）
    expect(renameGroup).toHaveBeenCalledTimes(1);
  });

  it('IME 组合期 Enter 不提交（isComposing）', () => {
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '旧名' } as any} selected={false} />);
    fireEvent.doubleClick(screen.getByText('旧名'));
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true } as any);
    expect(renameGroup).not.toHaveBeenCalled();
    // 若 fireEvent 不支持 isComposing 字段导致用例失败，改用：
    // input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true } as any));
  });
});

describe('NormalGroupRenderer 折叠态', () => {
  it('折叠分支渲染 CollapsedPreviewCard（2d-3 内容替换）：title/aria/摘要接线 + 子节点 fileId 映射（data.fileId||referenceImage——GroupNode.tsx:55 先例）', async () => {
    mockStore.nodes = [
      { id: 'c1', parentId: 'g1', data: { fileId: 'f1' } },
      { id: 'c2', parentId: 'g1', data: { referenceImage: 'ref2' } },
      { id: 'c3', parentId: 'g1' },
      { id: 'x', parentId: null, data: { fileId: 'not-in-group' } },
    ];
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '我的分组', collapsed: true } as any} selected={false} />);
    const card = screen.getByTestId('collapsed-preview-card');
    expect(card.getAttribute('title')).toBe('我的分组');
    expect(card.getAttribute('aria-label')).toBe('我的分组，3 个节点');
    expect(screen.getByText('3 个节点')).toBeTruthy();
    // 2d-4 两段渲染：img 在批量预取 settle → phase2 挂 tile 后出现
    const imgs = await screen.findAllByTestId('collapsed-tile-img') as HTMLImageElement[];
    expect(imgs).toHaveLength(2);
    expect(imgs[0].src).toContain('/flowai/f1');
    expect(imgs[1].src).toContain('/flowai/ref2');
  });

  it('折叠卡根 div 显式尺寸=COLLAPSED_SIZE（2d-1 不变量载体——尺寸写点随内容替换落卡片根）', () => {
    mockStore.nodes = [];
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', collapsed: true } as any} selected={false} />);
    const card = screen.getByTestId('collapsed-preview-card');
    expect(card.style.width).toBe('220px');
    expect(card.style.height).toBe('160px');
    expect(screen.getByText('0 个节点')).toBeTruthy();
  });
});

describe('NormalGroupRenderer 右键重命名请求消费（2d-6）', () => {
  beforeEach(() => {
    mockStore.nodes = [{ id: 'c1', parentId: 'g1' }];
    mockStore.renameRequest = null;
    renameGroup.mockClear();
  });

  it('renameRequest 命中本组 → 进入与双击相同的编辑态（draft=当前名；跨组请求/已消费 nonce 不触发）', () => {
    mockStore.renameRequest = { groupId: 'g1', nonce: 1 };
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '旧名' } as any} selected={false} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('旧名');
  });

  it('跨组请求不触发编辑态', () => {
    mockStore.renameRequest = { groupId: 'g2', nonce: 1 };
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '旧名' } as any} selected={false} />);
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
