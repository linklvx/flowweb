import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { apiFetch } from './client';
import { useSessionExpiry } from '@/auth/sessionExpiry';

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

describe('apiFetch 契约（批3-3：json.code!==0 不丢 status + 401 置 sessionExpiry 电平）', () => {
  beforeEach(() => useSessionExpiry.getState().reset());

  it('HTTP 200 但 json.code!==0 → 抛错含 message/status/errorCode（现状丢 status）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: -1, message: '业务失败', errorCode: 'INTENT_EXHAUSTED' }), { status: 200 }),
    ));
    const err: any = await apiFetch('/x').then(() => { throw new Error('should throw'); }, (e) => e);
    expect(err.message).toBe('业务失败');
    expect(err.status).toBe(200);
    expect(err.errorCode).toBe('INTENT_EXHAUSTED');
    expect(useSessionExpiry.getState().httpExpired).toBe(false);   // 非 401 不置位
  });

  it('401 → sessionExpiry.httpExpired 电平置位', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: -1, message: '未登录' }), { status: 401 }),
    ));
    await expect(apiFetch('/x')).rejects.toThrow('未登录');
    expect(useSessionExpiry.getState().httpExpired).toBe(true);
  });

  it('500 → 不置位（瞬态桶不进 session 过期语义）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    await expect(apiFetch('/x')).rejects.toThrow();
    expect(useSessionExpiry.getState().httpExpired).toBe(false);
  });
});
