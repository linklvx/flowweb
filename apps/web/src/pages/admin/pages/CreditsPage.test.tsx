import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { grantCredits } from '@/api/adminApi';

vi.mock('@/api/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/api/adminApi')>()),
  grantCredits: vi.fn().mockResolvedValue(undefined),
}));

import CreditsPage from './CreditsPage';

const grantMock = grantCredits as unknown as ReturnType<typeof vi.fn>;

describe('CreditsPage（积分发放表单）', () => {
  beforeEach(() => { grantMock.mockClear(); grantMock.mockResolvedValue(undefined); });
  /** Y0b-2 T8（Z113）：Idempotency-Key 手势幂等——失败/在飞保留复用（重试同 key）、成功轮换（二次提交新 key）。 */
  async function submitOnce(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('用户 ID'), 'u1');
    await user.type(screen.getByLabelText('发放数量'), '10');
    await user.click(screen.getByRole('button', { name: /发\s?放/ }));
  }

  it('提交调用 grantCredits 且携带 Idempotency-Key（UUID 形态）', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><CreditsPage /></AntdApp></MemoryRouter>);
    await submitOnce(user);
    const calls = grantMock.mock.calls;
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    expect(calls[0][0]).toEqual({ userId: 'u1', amount: 10, creditType: 'regular' });
    expect(calls[0][1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('失败后重试复用同 key（超时重试/双击不双发——服务端回放）', async () => {
    const { grantCredits } = await import('@/api/adminApi');
    const mock = grantCredits as ReturnType<typeof vi.fn>;
    mock.mockRejectedValueOnce(new Error('网络超时'));
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><CreditsPage /></AntdApp></MemoryRouter>);
    await submitOnce(user);
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    await submitOnce(user);   // 失败保留——重试同 key
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
    expect(mock.mock.calls[1][1]).toBe(mock.mock.calls[0][1]);
  });

  it('成功后二次提交轮换新 key（手势边界）', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><CreditsPage /></AntdApp></MemoryRouter>);
    await submitOnce(user);
    await waitFor(() => expect(grantMock).toHaveBeenCalledTimes(1));
    await submitOnce(user);   // 成功轮换——新 key
    await waitFor(() => expect(grantMock).toHaveBeenCalledTimes(2));
    expect(grantMock.mock.calls[1][1]).not.toBe(grantMock.mock.calls[0][1]);
  });
});
