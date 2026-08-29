import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

vi.mock('../auth', () => ({
  SESSION_COOKIE_OPTIONS: {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

import axios from 'axios';
import { WechatService } from './wechat.service';
import { SESSION_COOKIE_OPTIONS } from '../auth';

describe('WechatService', () => {
  let service: WechatService;
  let mockPrisma: Record<string, any>;
  let mockTeamService: Record<string, any>;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      materialFolder: {
        count: vi.fn(),
        createMany: vi.fn(),
      },
      session: {
        create: vi.fn(),
      },
    };
    mockTeamService = {
      ensureDefaultTeam: vi.fn().mockResolvedValue({ id: 'team-1' }),
    };
    service = new WechatService(mockPrisma as any, mockTeamService as any);
    vi.clearAllMocks();
  });

  describe('createSession', () => {
    it('P0: 生成明文 32 字符 token 并原样写入 DB（不哈希）', async () => {
      mockPrisma.session.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...data, id: 's1' }),
      );

      const result = await service.createSession('u1');

      // token 与 Better Auth generateId(32) 同源：32 字符 [a-zA-Z0-9]，无前缀无签名
      expect(result.token).toMatch(/^[a-zA-Z0-9]{32}$/);
      // 写入 DB 的 token 就是明文 result.token（无哈希变换，getSession 按 token 直查可命中）
      expect(mockPrisma.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ token: result.token, userId: 'u1' }),
      });
    });

    it('createSession 的 expiresAt 使用 SESSION_COOKIE_OPTIONS.maxAge（不硬编码）', async () => {
      const before = Date.now();
      mockPrisma.session.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...data, id: 's1' }),
      );

      await service.createSession('u1');

      const { data } = mockPrisma.session.create.mock.calls[0][0];
      const expected = before + SESSION_COOKIE_OPTIONS.maxAge;
      expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(expected - 1000);
      expect(data.expiresAt.getTime()).toBeLessThanOrEqual(expected + 1000);
    });
  });

  describe('getAccessToken', () => {
    it('成功解析 openid / unionid / accessToken', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { access_token: 'tok', openid: 'openid123', unionid: 'unionid123', expires_in: 7200 },
      } as any);

      const result = await service.getAccessToken('code123');

      expect(result).toEqual({ openid: 'openid123', unionid: 'unionid123', accessToken: 'tok' });
    });

    it('errcode 非 0 时抛错（微信错误在 body 而非 HTTP 状态码）', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { errcode: 40029, errmsg: 'invalid code' },
      } as any);

      await expect(service.getAccessToken('badcode')).rejects.toThrow();
    });
  });

  describe('getUserInfo', () => {
    it('成功解析 nickname / headimgurl', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { openid: 'openid123', nickname: '微信用户', headimgurl: 'http://head/img.png' },
      } as any);

      const result = await service.getUserInfo('tok', 'openid123');

      expect(result).toEqual({ nickname: '微信用户', headimgurl: 'http://head/img.png' });
    });
  });

  describe('findOrCreateUser', () => {
    it('新 openid 时创建 User（临时 email）+ 默认文件夹', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'new-user', wechatOpenid: 'openid123' });
      mockPrisma.materialFolder.createMany.mockResolvedValue({ count: 5 });

      const result = await service.findOrCreateUser({
        openid: 'openid123',
        nickname: '微信用户',
        headimgurl: 'http://head/img.png',
      });

      const expectedEmail = `wechat_${Buffer.from('openid123').toString('base64url')}@wechat.flowweb.local`;
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: expectedEmail,
          name: '微信用户',
          image: 'http://head/img.png',
          wechatOpenid: 'openid123',
          emailVerified: false,
        }),
      });
      expect(mockPrisma.materialFolder.createMany).toHaveBeenCalled();
      expect(result.id).toBe('new-user');
    });

    it('已存在 openid 时复用 User，不重复创建（含文件夹）', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing', wechatOpenid: 'openid123' });

      const result = await service.findOrCreateUser({ openid: 'openid123', nickname: '微信用户' });

      expect(result.id).toBe('existing');
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockPrisma.materialFolder.createMany).not.toHaveBeenCalled();
    });
  });
});
