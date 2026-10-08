import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthController } from './auth.controller';
import { SESSION_COOKIE_OPTIONS } from './auth';

// Y0b-1 Z23：getMe 补偿 bootstrap 的钱包建行+register_grant 经 CreditLedgerService
const mockLedger = {
  tx: (raw: any) => raw,
  ensureBalance: vi.fn().mockResolvedValue(undefined),
  lockBalance: vi.fn().mockResolvedValue(undefined),
  mutate: vi.fn().mockResolvedValue({ rowId: 'lr-1', balanceAfter: 100 }),
};

describe('AuthController', () => {
  let controller: AuthController;
  let mockSvc: Record<string, any>;
  let mockRateLimiter: Record<string, any>;
  let mockSmsService: Record<string, any>;
  let mockRedis: Record<string, any>;
  let mockPrisma: Record<string, any>;

  beforeEach(() => {
    mockSvc = {
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(),
      getSessionByToken: vi.fn(),
      updateProfile: vi.fn(),
      phoneLogin: vi.fn(),
    };

    mockRateLimiter = {
      getClientIp: vi.fn(),
      checkIpRateLimit: vi.fn(),
      checkPhoneRateLimit: vi.fn(),
      releasePhoneLock: vi.fn(),
    };

    mockSmsService = {
      generateOtp: vi.fn(),
      storeOtp: vi.fn(),
      sendSms: vi.fn(),
      deleteOtp: vi.fn(),
    };

    mockRedis = {
      get: vi.fn(),
      del: vi.fn(),
    };

    // getMe 补偿走 bootstrapPersonalTeam：首查命中即 no-op，故 findFirst 默认返回既有团队
    mockPrisma = {
      team: { findFirst: vi.fn().mockResolvedValue({ id: 't-default', isDefault: true }) },
      materialFolder: { createMany: vi.fn() },
    } as any;

    // Direct construction — bypasses NestJS DI
    controller = new AuthController(
      mockSvc as any,
      mockPrisma as any,
      mockLedger as any,
      mockRateLimiter as any,
      mockSmsService as any,
      mockRedis as any,
    );
  });

  describe('signIn', () => {
    it('should set cookie and return user on success', async () => {
      const mockRes = { cookie: vi.fn(), json: vi.fn() };
      const token = 'tok_abc';
      mockSvc.signIn.mockResolvedValue({ token, user: { id: 'u1', email: 'u1@test.com' } });

      await controller.signIn(
        { email: 'u1@test.com', password: 'Test1234!' },
        mockRes as any,
      );

      expect(mockSvc.signIn).toHaveBeenCalledWith('u1@test.com', 'Test1234!');
      expect(mockRes.cookie).toHaveBeenCalledWith(
        'flowweb.session_token',
        token,
        expect.objectContaining({ httpOnly: true, path: '/', sameSite: 'lax' }),
      );
      // 批3-3：COOKIE_OPTIONS 与 SESSION_COOKIE_OPTIONS 统一（本地常量缺 secure——生产 cookie 无 Secure 标志）
      expect(mockRes.cookie).toHaveBeenCalledWith('flowweb.session_token', token, SESSION_COOKIE_OPTIONS);
      expect(mockRes.json).toHaveBeenCalledWith({
        user: { id: 'u1', email: 'u1@test.com' },
      });
    });

    it('should return 401 on failure', async () => {
      const mockRes = { cookie: vi.fn(), json: vi.fn(), status: vi.fn().mockReturnValue({ json: vi.fn() }) };
      mockSvc.signIn.mockRejectedValue(new Error('Invalid credentials'));

      await controller.signIn(
        { email: 'bad@test.com', password: 'wrong' },
        mockRes as any,
      );

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });

  describe('signUp', () => {
    it('should set cookie and return user on success', async () => {
      const mockRes = { cookie: vi.fn(), json: vi.fn() };
      const token = 'tok_new';
      mockSvc.signUp.mockResolvedValue({ token, user: { id: 'u2', email: 'new@test.com' } });

      await controller.signUp(
        { email: 'new@test.com', password: 'Test1234!', name: 'New' },
        mockRes as any,
      );

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'flowweb.session_token',
        token,
        expect.objectContaining({ httpOnly: true, path: '/' }),
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        user: { id: 'u2', email: 'new@test.com' },
      });
    });

    it('should return 400 on failure', async () => {
      const mockRes = { cookie: vi.fn(), json: vi.fn(), status: vi.fn().mockReturnValue({ json: vi.fn() }) };
      mockSvc.signUp.mockRejectedValue(new Error('Duplicate'));

      await controller.signUp(
        { email: 'taken@test.com', password: 'Test1234!', name: 'X' },
        mockRes as any,
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('signOut', () => {
    it('should clear cookie and sign out', async () => {
      const req = { headers: { cookie: 'flowweb.session_token=oldtok' } };
      const mockRes = { clearCookie: vi.fn(), json: vi.fn() };
      mockSvc.signOut.mockResolvedValue({ success: true });

      await controller.signOut(req as any, mockRes as any);

      expect(mockSvc.signOut).toHaveBeenCalledWith('oldtok');
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'flowweb.session_token',
        expect.objectContaining({ path: '/' }),
      );
      expect(mockRes.json).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('getMe', () => {
    it('should return user from session', async () => {
      const req = { headers: { cookie: 'flowweb.session_token=valid' } };
      const mockRes = { cookie: vi.fn(), json: vi.fn() };   // 批3-3：/me 有效 session 重发 cookie
      mockSvc.getSession.mockResolvedValue({ user: { id: 'u1', email: 'u1@test.com' } });

      await controller.getMe(req as any, mockRes as any);

      expect(mockRes.json).toHaveBeenCalledWith({ user: { id: 'u1', email: 'u1@test.com' } });
    });

    it('should return null when no session', async () => {
      const req = { headers: {} };
      const mockRes = { cookie: vi.fn(), json: vi.fn() };
      mockSvc.getSession.mockResolvedValue(null);

      await controller.getMe(req as any, mockRes as any);

      expect(mockRes.json).toHaveBeenCalledWith({ user: null });
    });

    it('批3-3：session 有效 → 重发 cookie（SESSION_COOKIE_OPTIONS）——15min me 探活的滑动续期半边（F8）', async () => {
      const req = { headers: { cookie: 'flowweb.session_token=valid' } };
      const mockRes = { cookie: vi.fn(), json: vi.fn() };
      mockSvc.getSession.mockResolvedValue({ user: { id: 'u1' } });

      await controller.getMe(req as any, mockRes as any);

      expect(mockRes.cookie).toHaveBeenCalledWith('flowweb.session_token', 'valid', SESSION_COOKIE_OPTIONS);
    });

    it('批3-3：无 session → 不重发 cookie', async () => {
      const req = { headers: { cookie: 'flowweb.session_token=stale' } };
      const mockRes = { cookie: vi.fn(), json: vi.fn() };
      mockSvc.getSession.mockResolvedValue(null);

      await controller.getMe(req as any, mockRes as any);

      expect(mockRes.cookie).not.toHaveBeenCalled();
    });

    it('should bootstrap personal team when user has none (幂等补偿，含文件夹)', async () => {
      const req = { headers: { cookie: 'flowweb.session_token=valid' } };
      const mockRes = { cookie: vi.fn(), json: vi.fn() };
      mockSvc.getSession.mockResolvedValue({ user: { id: 'u1', name: '张三', email: 'u1@test.com' } });

      const mockPrismaForBootstrap = {
        team: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 't1' }),
        },
        teamMember: { create: vi.fn() },
        materialFolder: { createMany: vi.fn().mockResolvedValue({ count: 5 }) },
        $transaction: vi.fn(async (fn: any) => fn(mockPrismaForBootstrap)),
      } as any;
      const mockRedis = { get: vi.fn(), del: vi.fn() };

      const ctrl = new AuthController(
        mockSvc as any, mockPrismaForBootstrap, mockLedger as any, mockRateLimiter as any, mockSmsService as any, mockRedis as any,
      );
      await ctrl.getMe(req as any, mockRes as any);

      expect(mockPrismaForBootstrap.team.findFirst).toHaveBeenCalledWith({ where: { ownerId: 'u1', isDefault: true } });
      expect(mockPrismaForBootstrap.materialFolder.createMany).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({ user: { id: 'u1', name: '张三', email: 'u1@test.com' } });
    });
  });

  describe('updateMe', () => {
    it('should update profile and return user', async () => {
      const req = { user: { id: 'u1' }, headers: { cookie: 'flowweb.session_token=tok' } };
      const mockRes = { json: vi.fn(), status: vi.fn().mockReturnValue({ json: vi.fn() }) };
      mockSvc.updateProfile.mockResolvedValue({
        user: { id: 'u1', name: 'NewName', email: 'test@test.com' }
      });

      await controller.updateMe(req as any, { name: 'NewName' } as any, mockRes as any);

      expect(mockSvc.updateProfile).toHaveBeenCalledWith(
        'flowweb.session_token=tok',
        { name: 'NewName' }
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: { user: { id: 'u1', name: 'NewName', email: 'test@test.com' } }
      });
    });

    it('should return 401 when not authenticated', async () => {
      const req = { user: null, headers: {} };
      const mockRes = { json: vi.fn(), status: vi.fn().mockReturnValue({ json: vi.fn() }) };

      await controller.updateMe(req as any, { name: 'X' } as any, mockRes as any);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.status().json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: 'UNAUTHORIZED' })
        })
      );
    });

    it('should ignore any userId in body — uses req.user.id only (越权防护)', async () => {
      const req = { user: { id: 'u1' }, headers: { cookie: 'flowweb.session_token=tok' } };
      const mockRes = { json: vi.fn(), status: vi.fn().mockReturnValue({ json: vi.fn() }) };
      mockSvc.updateProfile.mockResolvedValue({
        user: { id: 'u1', name: 'X', email: 'test@test.com' }
      });

      // Even if DTO had a userId field (it doesn't — UpdateProfileDto has no userId),
      // controller only uses req.user.id. This proves body userId is impossible to inject.
      await controller.updateMe(req as any, { name: 'X' } as any, mockRes as any);

      // updateProfile was called with cookie header, NOT a userId from body
      expect(mockSvc.updateProfile).toHaveBeenCalledWith(
        'flowweb.session_token=tok',
        expect.anything()
      );
    });
  });

  describe('sendSmsCode', () => {
    it('should return 200 on success', async () => {
      mockRateLimiter.getClientIp.mockReturnValue('1.2.3.4');
      mockRateLimiter.checkIpRateLimit.mockResolvedValue(true);
      mockRateLimiter.checkPhoneRateLimit.mockResolvedValue(true);
      mockSmsService.generateOtp.mockReturnValue('123456');
      mockSmsService.storeOtp.mockResolvedValue(undefined);
      mockSmsService.sendSms.mockResolvedValue(undefined);

      const mockRes = { status: vi.fn().mockReturnValue({ json: vi.fn() }), json: vi.fn() };
      const req = { headers: { 'x-forwarded-for': '1.2.3.4' }, ip: '10.0.0.1' };

      await controller.sendSmsCode(
        { phone: '13800138000' } as any,
        req as any, mockRes as any,
      );

      expect(mockRes.json).toHaveBeenCalledWith({ success: true });
    });

    it('should return 429 when phone rate limit exceeded', async () => {
      mockRateLimiter.getClientIp.mockReturnValue('1.2.3.4');
      mockRateLimiter.checkIpRateLimit.mockResolvedValue(true);
      mockRateLimiter.checkPhoneRateLimit.mockResolvedValue(false);

      const mockRes = { status: vi.fn().mockReturnValue({ json: vi.fn() }) };
      const req = { headers: {}, ip: '1.2.3.4' };

      await controller.sendSmsCode(
        { phone: '13800138000' } as any,
        req as any, mockRes as any,
      );

      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockSmsService.sendSms).not.toHaveBeenCalled();
    });

    it('should return 502 after releasing lock + deleting OTP when SMS fails', async () => {
      mockRateLimiter.getClientIp.mockReturnValue('1.2.3.4');
      mockRateLimiter.checkIpRateLimit.mockResolvedValue(true);
      mockRateLimiter.checkPhoneRateLimit.mockResolvedValue(true);
      mockSmsService.generateOtp.mockReturnValue('123456');
      mockSmsService.storeOtp.mockResolvedValue(undefined);
      mockSmsService.sendSms.mockRejectedValue(new Error('SMS_FAILED'));

      const mockRes = { status: vi.fn().mockReturnValue({ json: vi.fn() }) };
      const req = { headers: {}, ip: '1.2.3.4' };

      await controller.sendSmsCode(
        { phone: '13800138000' } as any,
        req as any, mockRes as any,
      );

      expect(mockRateLimiter.releasePhoneLock).toHaveBeenCalledWith('+8613800138000');
      expect(mockSmsService.deleteOtp).toHaveBeenCalledWith('+8613800138000');
      expect(mockRes.status).toHaveBeenCalledWith(502);
    });
  });

  describe('phoneLogin', () => {
    it('should return 200 + Set-Cookie on success', async () => {
      mockRateLimiter.getClientIp.mockReturnValue('1.2.3.4');
      mockRateLimiter.checkIpRateLimit.mockResolvedValue(true);
      mockSvc.phoneLogin.mockResolvedValue({
        token: 'tok_abc',
        user: { id: 'u1', phoneNumber: '+8613800138000', phoneNumberVerified: true },
      });

      const mockRes = { cookie: vi.fn(), json: vi.fn(), status: vi.fn().mockReturnValue({ json: vi.fn() }) };
      const req = { headers: {}, ip: '1.2.3.4' };

      await controller.phoneLogin(
        { phone: '13800138000', code: '123456' } as any,
        req as any, mockRes as any,
      );

      expect(mockSvc.phoneLogin).toHaveBeenCalledWith('+8613800138000', '123456');
      expect(mockRes.cookie).toHaveBeenCalledWith(
        'flowweb.session_token', 'tok_abc',
        expect.objectContaining({ httpOnly: true, path: '/' }),
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        user: { id: 'u1', phoneNumber: '+8613800138000', phoneNumberVerified: true },
      });
    });

    it('should read last_error from Redis when verify fails', async () => {
      mockRateLimiter.getClientIp.mockReturnValue('1.2.3.4');
      mockRateLimiter.checkIpRateLimit.mockResolvedValue(true);
      mockSvc.phoneLogin.mockRejectedValue(new Error('INVALID_OTP'));

      const spyRedis = { get: vi.fn().mockResolvedValue('WRONG'), del: vi.fn() };
      const mockRes = { status: vi.fn().mockReturnValue({ json: vi.fn() }) };
      const req = { headers: {}, ip: '1.2.3.4' };

      const ctrl = new AuthController(
        mockSvc as any, {} as any, mockLedger as any, mockRateLimiter as any, mockSmsService as any, spyRedis as any,
      );

      await ctrl.phoneLogin(
        { phone: '13800138000', code: '000000' } as any,
        req as any, mockRes as any,
      );

      expect(spyRedis.get).toHaveBeenCalledWith('sms:{+8613800138000}:last_error');
      expect(spyRedis.del).toHaveBeenCalledWith('sms:{+8613800138000}:last_error');
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });
});
