import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/api/adminApi')>()),
  grantCredits: vi.fn().mockResolvedValue(undefined),
}));

import CreditsPage from './CreditsPage';

describe('CreditsPage（积分发放表单）', () => {
  it('填写 userId/数量后提交调用 grantCredits', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><CreditsPage /></AntdApp></MemoryRouter>);
    await user.type(screen.getByLabelText('用户 ID'), 'u1');
    await user.type(screen.getByLabelText('发放数量'), '10');
    await user.click(screen.getByRole('button', { name: /发\s?放/ }));
    const { grantCredits } = await import('@/api/adminApi');
    await waitFor(() => expect(grantCredits).toHaveBeenCalledWith({ userId: 'u1', amount: 10, creditType: 'regular' }));
  });
});
