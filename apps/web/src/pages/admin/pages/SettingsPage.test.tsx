import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/api/adminApi')>()),
  fetchAllSettings: vi.fn().mockResolvedValue({
    wechat_pay: [
      { key: 'WECHAT_PAY_APP_ID', value: 'wx123' },
      { key: 'WECHAT_PAY_API_V3_KEY', value: '' },  // 真实后端 GROUP_KEYS 不返回敏感 key（条目缺席→valueOf('')→未配置，与空值等价）
    ],
    sms: [], wechat_login: [],
  }),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

import SettingsPage from './SettingsPage';

describe('SettingsPage（元数据驱动）', () => {
  it('三分组 Tab 渲染 + 非敏感字段回填 + 敏感字段显示「未配置」', async () => {
    render(<MemoryRouter><AntdApp><SettingsPage /></AntdApp></MemoryRouter>);
    expect(await screen.findByDisplayValue('wx123')).toBeTruthy();
    // wechat_pay 有 2 个敏感字段（API V3 密钥 + 商户私钥），mock 中均未配置
    expect(screen.getAllByText(/未配置/)).toHaveLength(2);
    for (const label of ['微信支付', '短信SMS', '微信扫码登录']) expect(screen.getByText(label)).toBeTruthy();
  });
});
