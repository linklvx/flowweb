import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../auth', () => ({
  SESSION_COOKIE_OPTIONS: {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

import { WechatController } from './wechat.controller';

describe('WechatController', () => {
  let controller: WechatController;
  let mockSvc: Record<string, any>;

  beforeEach(() => {
    mockSvc = {
      getAccessToken: vi.fn(),
      getUserInfo: vi.fn(),
      findOrCreateUser: vi.fn(),
      createSession: vi.fn(),
    };
    controller = new WechatController(mockSvc as any);
  });

  describe('config', () => {
    it('返回 appid（不含 secret）', async () => {
      vi.stubEnv('WECHAT_APP_ID', 'wx123');
      const mockRes = { json: vi.fn() };

      await controller.config(mockRes as any);

      expect(mockRes.json).toHaveBeenCalledWith({ appid: 'wx123' });
      vi.unstubAllEnvs();
    });
  });

  describe('callback', () => {
    it('微信换 token 失败 → 302 /login?error=wechat_failed', async () => {
      mockSvc.getAccessToken.mockRejectedValue(new Error('wechat api fail'));
      const mockRes = { redirect: vi.fn() };

      await controller.callback({ code: 'c1' } as any, mockRes as any);

      expect(mockRes.redirect).toHaveBeenCalledWith('/login?error=wechat_failed');
    });

    it('新 openid → findOrCreateUser + createSession 被调用', async () => {
      mockSvc.getAccessToken.mockResolvedValue({ openid: 'o1', unionid: 'u1', accessToken: 'at' });
      mockSvc.getUserInfo.mockResolvedValue({ nickname: '微信用户', headimgurl: 'http://h' });
      mockSvc.findOrCreateUser.mockResolvedValue({ id: 'uid1' });
      mockSvc.createSession.mockResolvedValue({ token: 'tok' });
      const mockRes = { cookie: vi.fn(), redirect: vi.fn() };

      await controller.callback({ code: 'c1' } as any, mockRes as any);

      expect(mockSvc.findOrCreateUser).toHaveBeenCalledWith({
        openid: 'o1', unionid: 'u1', nickname: '微信用户', headimgurl: 'http://h',
      });
      expect(mockSvc.createSession).toHaveBeenCalledWith('uid1');
    });

    it('成功 → Set-Cookie + 302 /canvas', async () => {
      mockSvc.getAccessToken.mockResolvedValue({ openid: 'o1', unionid: 'u1', accessToken: 'at' });
      mockSvc.getUserInfo.mockResolvedValue({ nickname: '微信用户', headimgurl: 'http://h' });
      mockSvc.findOrCreateUser.mockResolvedValue({ id: 'uid1' });
      mockSvc.createSession.mockResolvedValue({ token: 'tok_32chars' });
      const mockRes = { cookie: vi.fn(), redirect: vi.fn() };

      await controller.callback({ code: 'c1' } as any, mockRes as any);

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'flowweb.session_token', 'tok_32chars',
        expect.objectContaining({ httpOnly: true, path: '/' }),
      );
      expect(mockRes.redirect).toHaveBeenCalledWith('/canvas');
    });
  });
});
