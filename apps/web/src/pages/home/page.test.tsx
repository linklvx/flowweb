import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { HomePage } from './index';
import { AuthProvider } from '@/components/AuthProvider';
import { apiFetch } from '@/api/client';

vi.mock('@/api/client', () => ({ apiFetch: vi.fn() }));
const mockApiFetch = vi.mocked(apiFetch);

describe('HomePage（新首页）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Banner 空态：轮播不渲染，聚焦创作卡与 Footer
    mockApiFetch.mockResolvedValue([]);
  });

  const renderPage = () =>
    render(
      <MemoryRouter>
        <AuthProvider>
          <HomePage />
        </AuthProvider>
      </MemoryRouter>
    );

  it('渲染新建画布创作卡片', () => {
    renderPage();
    expect(screen.getByText('新建画布创作')).toBeInTheDocument();
  });

  it('渲染 Footer 备案信息', () => {
    renderPage();
    expect(screen.getByText('鲁ICP备2026030119号')).toBeInTheDocument();
  });

  it('渲染 AI 助手悬浮按钮', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /AI 助手/i })).toBeInTheDocument();
  });

  it('旧区块不复存在：无 Hero 标题/精选模板/Navbar', () => {
    renderPage();
    expect(screen.queryByText('开始创作')).toBeNull();
    expect(screen.queryByText('精选工作流模板')).toBeNull();
    expect(screen.queryByText(/Flow123/i)).toBeNull();
  });
});
