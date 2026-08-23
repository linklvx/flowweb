// GroupToolbar.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GroupToolbar } from './GroupToolbar';

const rf = vi.hoisted(() => ({ vp: { x: 0, y: 0, zoom: 1 }, node: null as any }));
vi.mock('@xyflow/react', () => ({
  useViewport: () => rf.vp,
  useInternalNode: () => rf.node,
}));

const baseProps = {
  groupId: 'g1',
  groupType: 'normal' as const,
  collapsed: false,
  executing: false,
  onCollapse: vi.fn(), onExecute: vi.fn(), onUngroup: vi.fn(), onConvert: vi.fn(),
};

// 全局 portal setup（对所有 describe 生效）
beforeEach(() => {
  const portal = document.createElement('div');
  portal.id = 'node-toolbar-portal';
  document.body.appendChild(portal);
});
afterEach(() => document.getElementById('node-toolbar-portal')?.remove());

describe('GroupToolbar（普通组）', () => {
  beforeEach(() => {
    // 为旧用例提供最小可用 internalNode mock（定位无关，仅需通过非空校验）
    rf.vp = { x: 0, y: 0, zoom: 1 };
    rf.node = { id: 'g1', measured: { width: 400, height: 300 }, internals: { positionAbsolute: { x: 100, y: 200 } } };
  });

  it('渲染 4 按钮', () => {
    render(<GroupToolbar {...baseProps} />);
    expect(screen.getByRole('button', { name: /折叠/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /整组执行/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /转分镜组/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /解组/ })).toBeTruthy();
  });

  it('执行中禁用结构变更按钮', () => {
    render(<GroupToolbar {...baseProps} executing />);
    expect((screen.getByRole('button', { name: /解组/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /转分镜组/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /折叠/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('点击折叠触发 onCollapse', () => {
    render(<GroupToolbar {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /折叠/ }));
    expect(baseProps.onCollapse).toHaveBeenCalledWith('g1');
  });
});

describe('GroupToolbar 定位', () => {
  it('定位在组 bounds 上方居中（偏移 12 屏幕常量）', () => {
    rf.vp = { x: 0, y: 0, zoom: 1 };
    rf.node = { id: 'g1', measured: { width: 400, height: 300 }, internals: { positionAbsolute: { x: 100, y: 200 } } };
    render(<GroupToolbar {...baseProps} />);
    const toolbar = document.getElementById('node-toolbar-portal')!.firstElementChild as HTMLElement;
    expect(toolbar.style.left).toBe('300px'); // 100 + 400/2
    expect(toolbar.style.top).toBe('188px');  // 200 - 12，translate(-50%,-100%)
  });

  it('组贴顶时翻转到下方', () => {
    rf.vp = { x: 0, y: 0, zoom: 1 };
    rf.node = { id: 'g1', measured: { width: 400, height: 300 }, internals: { positionAbsolute: { x: 100, y: 0 } } };
    render(<GroupToolbar {...baseProps} />);
    const toolbar = document.getElementById('node-toolbar-portal')!.firstElementChild as HTMLElement;
    expect(toolbar.style.top).toBe('312px'); // 0 + 300 + 12，translate(-50%,0)
  });

  it('internalNode 不可用时不渲染', () => {
    rf.node = null;
    const { container } = render(<GroupToolbar {...baseProps} />);
    expect(container).toBeEmptyDOMElement();
  });
});
