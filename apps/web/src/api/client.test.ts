import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetch } from './client';

afterEach(() => vi.unstubAllGlobals());

describe('apiFetch 失败提示', () => {
  it('非 ok 且 body 含 message → 抛中文 message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: -1, message: '需要管理员权限' }), { status: 403 }),
    ));
    await expect(apiFetch('/x')).rejects.toThrow('需要管理员权限');
  });
  it('body 无 message → 回退状态行（含 status）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    await expect(apiFetch('/x')).rejects.toThrow('500');
  });
});
