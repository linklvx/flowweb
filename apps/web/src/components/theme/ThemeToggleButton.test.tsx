// 两态切换钮（C8 D0）：aria/title 常量共享（G7 按 aria-label 锚定）；点击写存储 + 挂 html 类。
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ThemeToggleButton', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');
  });

  it('默认深：aria-label=切换主题，当前：深色；点击 → html.light + 存储写 light + aria 翻浅色', async () => {
    const { ThemeToggleButton } = await import('./ThemeToggleButton');
    const { unmount } = render(<ThemeToggleButton />);
    const btn = screen.getByRole('button', { name: '切换主题，当前：深色' });
    expect(btn).toHaveAttribute('title', '主题：深色（点击切换为浅色）');
    fireEvent.click(btn);
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('light');
    expect(screen.getByRole('button', { name: '切换主题，当前：浅色' })).toBeInTheDocument();
    unmount();
  });

  it('浅档点击回深（两态往返）', async () => {
    localStorage.setItem('theme', 'light');
    const { ThemeToggleButton } = await import('./ThemeToggleButton');
    render(<ThemeToggleButton />);
    fireEvent.click(screen.getByRole('button', { name: '切换主题，当前：浅色' }));
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
