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
  fetchPricingCoverage: vi.fn().mockResolvedValue({ ok: true, missing: [] }),
}));

import ModelsPage from './ModelsPage';
import { fetchPricingCoverage } from '@/api/adminApi';

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

  describe('Y0b-5 T14 定价覆盖红标（Y0b-1 移交收口——missing 非空→红色 Alert）', () => {
    it('coverage missing 非空→Alert「N 个模型无生效定价规则」+缺失明细可见', async () => {
      (fetchPricingCoverage as any).mockResolvedValueOnce({
        ok: false,
        missing: [
          { modelId: 'm1', name: 'GLM', problem: '缺 (model,null,null) active 基础规则——模型全灭' },
          { modelId: 'm2', name: 'Kimi', problem: '缺 (model,res2,null) active 规则——分辨率档全灭' },
        ],
      });
      render(<MemoryRouter><AntdApp><ModelsPage /></AntdApp></MemoryRouter>);
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('2 个模型无生效定价规则');
      expect(alert.textContent).toContain('GLM');
      expect(alert.textContent).toContain('Kimi');
    });
    it('全覆盖→零红标（页面就绪后无 alert）', async () => {
      (fetchPricingCoverage as any).mockResolvedValueOnce({ ok: true, missing: [] });
      render(<MemoryRouter><AntdApp><ModelsPage /></AntdApp></MemoryRouter>);
      await waitFor(() => expect(screen.getByText('GLM')).toBeTruthy());   // 页面就绪（非渲染未完成假绿）
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
