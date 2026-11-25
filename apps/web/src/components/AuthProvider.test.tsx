// apps/web/src/components/AuthProvider.test.tsx
// Y0b-5 T5/Y5 T13：登出/切用户 purge 挂点——logout 清本 uid 全部本地库（uid 隔离的登出侧闭环；
// 与 clearMediaUrlCache 同点——G27「登出/切用户经页面卸载路径显式复位」的缓存清理在登出动作点
// 落位：destroyCollab 无法区分登出/切项目，无差别 purge 会误删他标签在用库）。
// Y5 T14：旧层登出 purge 断言退役；Y5 T13 已接的新层 purgeUidDbs 才是现役登出清理。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';

const purgeHarness = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('@/collab/local-yjs-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/collab/local-yjs-store')>();
  return {
    ...orig,
    purgeUidDbs: async (uid: string) => {
      purgeHarness.calls.push(uid);
      return { deleted: 0, held: 0, blocked: 0 };
    },
  };
});

import { AuthProvider, useAuth } from './AuthProvider';

function LogoutProbe() {
  const { logout } = useAuth();
  return <button type="button" onClick={() => void logout()}>登出</button>;
}

describe('Y0b-5 T5：登出 purge 挂点（AuthProvider.logout）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    purgeHarness.calls.length = 0;
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes('/api/auth/me')) {
        // Y5 T7：/me 改经证明模块（读 status）——夹具补 200（语义仍是原「200 带 user」）
        return { ok: true, status: 200, json: async () => ({ user: { id: 'u1', name: 'T', email: 't@t.com', emailVerified: true, createdAt: '', updatedAt: '' } }) } as any;
      }
      return { ok: true, status: 200, json: async () => ({}) } as any;
    });
  });

  it('logout ⇒ purgeUidDbs(登出前 uid)（切用户不读前 uid 库——出口判据⑭登出侧）', async () => {
    render(
      <AuthProvider>
        <LogoutProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('登出')).toBeInTheDocument());

    await act(async () => {
      screen.getByText('登出').click();
    });
    expect(purgeHarness.calls).toEqual(['u1']);
    expect(String(vi.mocked(globalThis.fetch).mock.calls.find((c: any[]) => String(c[0]).includes('sign-out'))?.[0])).toContain('/api/auth/sign-out');
  });

  it('未登录态 logout（user=null）⇒ 无 uid 可清零调用', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ user: null }) }) as any);
    render(
      <AuthProvider>
        <LogoutProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('登出')).toBeInTheDocument());
    await act(async () => {
      screen.getByText('登出').click();
    });
    expect(purgeHarness.calls).toHaveLength(0);
  });
});
