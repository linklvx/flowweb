// GroupToolbar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GroupToolbar } from './GroupToolbar';

const baseProps = {
  groupId: 'g1',
  groupType: 'normal' as const,
  collapsed: false,
  executing: false,
  onCollapse: vi.fn(), onExecute: vi.fn(), onUngroup: vi.fn(), onConvert: vi.fn(),
};

describe('GroupToolbar（普通组）', () => {
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
