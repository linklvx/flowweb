// apps/web/src/components/AuthProvider.test.tsx
// Y0b-5 T5：登出/切用户 purge 挂点——logout 清本 uid 全部本地缓存库（uid 隔离的登出侧闭环；
// 与 clearMediaUrlCache 同点——G27「登出/切用户经页面卸载路径显式复位」的缓存清理在登出动作点
// 落位：destroyCollab 无法区分登出/切项目，无差别 purge 会误删他标签在用库）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/collab/local-cache-key', () => ({
  purgeUidCaches: vi.fn().mockResolvedValue(undefined),
}));

import { AuthProvider, useAuth } from './AuthProvider';
import { purgeUidCaches } from '@/collab/local-cache-key';

function LogoutProbe() {
  const { logout } = useAuth();
  return <button type="button" onClick={() => void logout()}>登出</button>;
}

describe('Y0b-5 T5：登出 purge 挂点（AuthProvider.logout）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(purgeUidCaches).mockResolvedValue(undefined);
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes('/api/auth/me')) {
        return { ok: true, json: async () => ({ user: { id: 'u1', name: 'T', email: 't@t.com', emailVerified: true, createdAt: '', updatedAt: '' } }) } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    });
  });

  it('logout ⇒ purgeUidCaches(登出前 uid)（切用户不读前 uid 库——出口判据⑭登出侧）', async () => {
    render(
      <AuthProvider>
        <LogoutProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('登出')).toBeInTheDocument());

    await act(async () => {
      screen.getByText('登出').click();
    });
    expect(purgeUidCaches).toHaveBeenCalledWith('u1');
    expect(String(vi.mocked(globalThis.fetch).mock.calls.find((c: any[]) => String(c[0]).includes('sign-out'))?.[0])).toContain('/api/auth/sign-out');
  });

  it('未登录态 logout（user=null）⇒ 无 uid 可清零调用', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ user: null }) }) as any);
    render(
      <AuthProvider>
        <LogoutProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('登出')).toBeInTheDocument());
    await act(async () => {
      screen.getByText('登出').click();
    });
    expect(purgeUidCaches).not.toHaveBeenCalled();
  });
});
