import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const getTemplatesMock = vi.fn();
vi.mock('@/api/templateApi', () => ({
  getTemplates: (...args: unknown[]) => getTemplatesMock(...args),
}));

import { TemplateMarketPage } from './TemplateMarketPage';

beforeEach(() => {
  getTemplatesMock.mockResolvedValue({ templates: [] });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <TemplateMarketPage />
    </MemoryRouter>
  );
}

describe('TemplateMarketPage', () => {
  it('渲染标签页：社区模板、官方模板、工作空间', async () => {
    renderPage();
    expect(screen.getByText('社区模板')).toBeInTheDocument();
    expect(screen.getByText('官方模板')).toBeInTheDocument();
    expect(await screen.findByText('工作空间')).toBeInTheDocument();
  });
});
