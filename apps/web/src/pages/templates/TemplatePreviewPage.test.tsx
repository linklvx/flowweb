import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

const getTemplateMock = vi.fn();
vi.mock('@/api/templateApi', () => ({
  getTemplate: (...args: unknown[]) => getTemplateMock(...args),
  importTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));

import { TemplatePreviewPage } from './TemplatePreviewPage';

const template = {
  id: 'abc',
  name: 'Foo',
  description: '',
  coverUrl: '',
  importCount: 0,
  isOwner: true,
  category: undefined,
};

beforeEach(() => {
  getTemplateMock.mockResolvedValue(template);
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/works/:id" element={<TemplatePreviewPage />} />
        <Route path="/templates/:id" element={<TemplatePreviewPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TemplatePreviewPage', () => {
  it('在 /works/:id 下返回按钮文案为「返回工作空间」', async () => {
    renderAt('/works/abc');
    expect(await screen.findByText('← 返回工作空间')).toBeInTheDocument();
  });

  it('在 /templates/:id 下返回按钮文案为「返回模板广场」', async () => {
    renderAt('/templates/abc');
    expect(await screen.findByText('← 返回模板广场')).toBeInTheDocument();
  });
});
