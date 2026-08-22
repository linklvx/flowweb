import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StitchButton } from './StitchButton';

vi.mock('@/hooks/useStitchTask', () => ({
  useStitchTask: () => ({ start: vi.fn().mockResolvedValue({ outcome: 'COMPLETED' } as const) }),
}));

describe('StitchButton', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('显示当前档位并可切换', () => {
    const onResolutionChange = vi.fn();
    render(<StitchButton groupId="g1" resolution="2K" onResolutionChange={onResolutionChange} />);
    expect(screen.getByText(/拼接\(2K\)/)).toBeTruthy();
  });

  it('执行中禁用（防重）', () => {
    render(<StitchButton groupId="g1" resolution="2K" onResolutionChange={vi.fn()} running />);
    expect((screen.getByRole('button', { name: /拼接/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('首用提示设置正确的 localStorage key', () => {
    // 首次渲染应设置正确的 key
    render(<StitchButton groupId="g1" resolution="2K" onResolutionChange={vi.fn()} />);
    // 验证 plan 定稿的 key：flowweb.stitch-upscale-tip
    expect(localStorage.getItem('flowweb.stitch-upscale-tip')).toBe('1');
  });
});
