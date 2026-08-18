import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('@/pages/home/components/Navbar', () => ({
  Navbar: () => <div data-testid="navbar" />,
}));

const getTemplatesMock = vi.fn();
vi.mock('@/api/templateApi', () => ({
  getTemplates: (...args: unknown[]) => getTemplatesMock(...args),
  deleteTemplate: vi.fn(),
  updateTemplate: vi.fn(),
}));

import { MyTemplatesPage } from './MyTemplatesPage';

beforeEach(() => {
  getTemplatesMock.mockResolvedValue({
    templates: [{ id: 't1', name: 'Foo', description: '', importCount: 0, isOwner: true }],
  });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <MyTemplatesPage />
    </MemoryRouter>
  );
}

describe('MyTemplatesPage', () => {
  it('渲染独立导航栏', async () => {
    renderPage();
    expect(screen.getByTestId('navbar')).toBeInTheDocument();
  });

  it('渲染一级标题「工作空间」', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: '工作空间' })).toBeInTheDocument();
  });

  it('模板卡片链接前缀为 /works', async () => {
    renderPage();
    const link = await screen.findByText('Foo');
    expect(link.closest('a')).toHaveAttribute('href', '/works/t1');
  });
});
