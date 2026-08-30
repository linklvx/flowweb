import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Footer } from './Footer';

describe('Footer', () => {
  it('渲染网站介绍与功能描述', () => {
    render(<Footer />);
    expect(screen.getByText('AI 多模态内容创作平台')).toBeInTheDocument();
    expect(screen.getByText('文生文·文生图·图生图·图生视频·文生视频')).toBeInTheDocument();
  });

  it('备案号链接指向工信部并新窗口打开', () => {
    render(<Footer />);
    const link = screen.getByText('鲁ICP备2026030119号').closest('a');
    expect(link).toHaveAttribute('href', 'https://beian.miit.gov.cn');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
