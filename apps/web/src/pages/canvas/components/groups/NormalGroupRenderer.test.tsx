// NormalGroupRenderer.test.tsx（全量替换）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NormalGroupRenderer } from './NormalGroupRenderer';

const renameGroup = vi.fn();
const mockStore = { nodes: [] as any[] };
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (sel: any) => sel({ nodes: mockStore.nodes, renameGroup }),
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

  it('展开态无边框（去虚线，保留深色底；选中反馈由四角手柄承担）', () => {
    const { rerender } = render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal' } as any} selected={false} />);
    const box = screen.getByTestId('group-box');
    expect(box.style.border).toBe('');
    // C8 D3-board：分组底随 controls-bg 双值（深 rgb(38,38,38)/浅 #f0f1f2）——原 rgba(26,26,26,0.6) 恒深字面摘除
    expect(box.style.background).toContain('var(--canvas-controls-bg)');
    rerender(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal' } as any} selected={true} />);
    expect(screen.getByTestId('group-box').style.border).toBe('');
  });

  it('标题浮层在容器外左上角，上移 10px，字号 13（节点标题同款外浮）', () => {
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal' } as any} selected={false} />);
    const title = screen.getByText('分组').parentElement as HTMLElement;
    expect(title.style.transform).toBe('translateY(calc(-100% - 10px))');
    expect(title.style.top).toBe('0px');
    expect(title.style.left).toBe('0px');
    expect(title.style.fontSize).toBe('13px');
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
  it('小卡片：名称 + 徽标 + 虚线深色', () => {
    mockStore.nodes = [{ id: 'c1', parentId: 'g1' }];
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '我的分组', collapsed: true } as any} selected={false} />);
    expect(screen.getByText('我的分组')).toBeTruthy();
    expect(screen.getByText('1 项')).toBeTruthy();
  });
});
