import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceTabBar } from '../components/WorkspaceTabBar';

describe('WorkspaceTabBar', () => {
  it('页签受控：点击「团队项目」触发 onTabChange，激活态样式切换', () => {
    const onTabChange = vi.fn();
    render(<WorkspaceTabBar activeTab="personal" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole('button', { name: '团队项目' }));
    expect(onTabChange).toHaveBeenCalledWith('team');
    expect(screen.getByRole('button', { name: '个人项目' })).toHaveClass('border-b-2');
  });

  it('activeTab=team 时团队项目按钮为激活态', () => {
    render(<WorkspaceTabBar activeTab="team" onTabChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '团队项目' })).toHaveClass('border-b-2');
    expect(screen.getByRole('button', { name: '个人项目' })).not.toHaveClass('border-b-2');
  });

  it('页签字体大小 20px', () => {
    render(<WorkspaceTabBar activeTab="personal" onTabChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '个人项目' })).toHaveClass('text-[20px]');
    expect(screen.getByRole('button', { name: '团队项目' })).toHaveClass('text-[20px]');
  });

  it('个人项目按钮 margin-left 0 / margin-right 12，团队项目按钮 margin 2px', () => {
    render(<WorkspaceTabBar activeTab="personal" onTabChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '个人项目' })).toHaveClass('ml-0');
    expect(screen.getByRole('button', { name: '个人项目' })).toHaveClass('mr-3');
    expect(screen.getByRole('button', { name: '团队项目' })).toHaveClass('mx-[2px]');
  });
});
