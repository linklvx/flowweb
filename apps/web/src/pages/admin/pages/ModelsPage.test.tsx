import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/api/adminApi')>()),
  fetchNodeTypes: vi.fn().mockResolvedValue([
    { id: 'nt1', name: '文本', key: 'text', active: true },
  ]),
  fetchModels: vi.fn().mockResolvedValue([
    { id: 'm1', nodeTypeId: 'nt1', name: 'GLM', provider: 'zhipu', apiUrl: 'https://x', sortOrder: 1, recommended: true, active: true, resolutions: [], durations: [] },
  ]),
  fetchPricingRules: vi.fn().mockResolvedValue([]),
}));

import ModelsPage from './ModelsPage';

describe('ModelsPage', () => {
  it('节点类型 Tabs 渲染 + 模型列表加载', async () => {
    render(<MemoryRouter><AntdApp><ModelsPage /></AntdApp></MemoryRouter>);
    expect(await screen.findByText('文本')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('GLM')).toBeTruthy());
  });
  it('模型行操作齐全：编辑/上下线/删除 + 新建入口 + 计费规则标题', async () => {
    render(<MemoryRouter><AntdApp><ModelsPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('GLM')).toBeTruthy());
    expect(screen.getByText('编辑')).toBeTruthy();
    expect(screen.getByText('下线')).toBeTruthy();
    expect(screen.getByText('删除')).toBeTruthy();
    // 两个新建入口（模型/计费规则），/新\s?建/ 会命中多个元素，拆为精确断言
    expect(screen.getByRole('button', { name: '新建模型' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '新建规则' })).toBeTruthy();
    expect(screen.getByText('计费规则')).toBeTruthy();
  });
});
