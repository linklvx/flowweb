import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockSignInEmail, mockSignUpEmail, mockSignOut, mockGetSession, mockUpdateUser,
  mockVerifyPhoneNumber } = vi.hoisted(() => ({
  mockSignInEmail: vi.fn(),
  mockSignUpEmail: vi.fn(),
  mockSignOut: vi.fn(),
  mockGetSession: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockVerifyPhoneNumber: vi.fn(),
}));

vi.mock('./auth', () => ({
  auth: {
    api: {
      signInEmail: mockSignInEmail,
      signUpEmail: mockSignUpEmail,
      signOut: mockSignOut,
      getSession: mockGetSession,
      updateUser: mockUpdateUser,
      verifyPhoneNumber: mockVerifyPhoneNumber,
    },
  },
}));

import { AuthService } from './auth.service';
import { auth } from './auth';
import { REDIS_CLIENT } from '../common/redis/managed-redis';

describe('AuthService', () => {
  let service: AuthService;
  const mockRedis = { exists: vi.fn().mockResolvedValue(0), set: vi.fn().mockResolvedValue('OK') };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: REDIS_CLIENT, useValue: mockRedis },   // 批3-2 B6：硬编码 localhost Redis 拔除，注入收口实例
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
  });

  it('should call signInEmail with email and password', async () => {
    mockSignInEmail.mockResolvedValue({ user: { id: 'u1', email: 'test@test.com' } });
    const result = await service.signIn('test@test.com', 'pass123');
    expect(auth.api.signInEmail).toHaveBeenCalledWith({ body: { email: 'test@test.com', password: 'pass123' } });
    expect(result).toEqual({ user: { id: 'u1', email: 'test@test.com' } });
  });

  it('should call signUpEmail with email, password, name', async () => {
    mockSignUpEmail.mockResolvedValue({ user: { id: 'u1' } });
    const result = await service.signUp('test@test.com', 'pass123', 'Test User');
    expect(auth.api.signUpEmail).toHaveBeenCalledWith({ body: { email: 'test@test.com', password: 'pass123', name: 'Test User' } });
    expect(result).toEqual({ user: { id: 'u1' } });
  });

  it('should call signOut with sessionToken in headers', async () => {
    mockSignOut.mockResolvedValue({ success: true });
    await service.signOut('token123');
    expect(auth.api.signOut).toHaveBeenCalledWith({
      headers: new Headers({ cookie: 'flowweb.session_token=token123' }),
    });
  });

  it('should return null when no cookie header provided', async () => {
    const result = await service.getSession({});
    expect(result).toBeNull();
  });

  it('should return null when cookie has no valid session token', async () => {
    const result = await service.getSession({ cookie: 'other=value' });
    expect(result).toBeNull();
  });

  it('should call Better Auth updateUser for updateProfile', async () => {
    mockUpdateUser.mockResolvedValue({ user: { id: 'u1', name: 'NewName' } });

    const result = await service.updateProfile('flowweb.session_token=tok123', { name: 'NewName' });

    expect(mockUpdateUser).toHaveBeenCalledWith({
      body: { name: 'NewName', image: undefined },
      headers: expect.any(Headers),
    });
    expect(result).toEqual({ user: { id: 'u1', name: 'NewName' } });
  });

  describe('phoneLogin', () => {
    it('should call auth.api.verifyPhoneNumber with updatePhoneNumber: false', async () => {
      mockVerifyPhoneNumber.mockResolvedValue({
        token: 'tok_abc',
        user: { id: 'u1', phoneNumber: '+8613800138000', phoneNumberVerified: true },
      });
      const result = await service.phoneLogin('+8613800138000', '123456');
      expect(auth.api.verifyPhoneNumber).toHaveBeenCalledWith({
        body: {
          phoneNumber: '+8613800138000',
          code: '123456',
          updatePhoneNumber: false,
        },
      });
      expect(result.token).toBe('tok_abc');
    });
  });

  describe('批3-2 B6：blacklist 走注入的 REDIS_CLIENT（非硬编码 localhost 实例）', () => {
    it('isBlacklisted 调用注入实例 exists', async () => {
      mockRedis.exists.mockResolvedValueOnce(1);
      await expect(service.isBlacklisted('tok1')).resolves.toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith('blacklist:rt:tok1');
    });
  });
});
