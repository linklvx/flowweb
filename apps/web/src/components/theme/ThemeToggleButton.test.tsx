// 两态切换钮（C8 D0）：aria/title 常量共享（G7 按 aria-label 锚定）；点击写存储 + 挂 html 类。
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// 超时带宽（2026-11-05 根修，registered-flakes 族销案）：满载池 CPU 饥饿下本文件两例墙钟可达
// 5820ms＞5000 默认（webfull1 实录）——超时弃测后**被弃异步体仍续跑**（vitest 不杀 promise），
// 迟到的 render() 落进下一用例窗内注入第二个同 aria 按钮=多元素连锁红（test 2 的假根因）。
// 拉带宽消触发面（t25/mr1-2 60s 同款先例；本用例本体亚秒级——20s=10× 裕量）。
vi.setConfig({ testTimeout: 20_000 });

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
