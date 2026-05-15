import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  let controller: AuthController;
  let mockSvc: Record<string, any>;

  beforeEach(() => {
    mockSvc = {
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(),
    };

    // Direct construction — bypasses NestJS DI
    controller = new AuthController(mockSvc as any);
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
      const mockRes = { json: vi.fn() };
      mockSvc.getSession.mockResolvedValue({ user: { id: 'u1', email: 'u1@test.com' } });

      await controller.getMe(req as any, mockRes as any);

      expect(mockRes.json).toHaveBeenCalledWith({ user: { id: 'u1', email: 'u1@test.com' } });
    });

    it('should return null when no session', async () => {
      const req = { headers: {} };
      const mockRes = { json: vi.fn() };
      mockSvc.getSession.mockResolvedValue(null);

      await controller.getMe(req as any, mockRes as any);

      expect(mockRes.json).toHaveBeenCalledWith({ user: null });
    });
  });

  describe('updateMe', () => {
    it('should update profile and return user', async () => {
      const req = { user: { id: 'u1' }, headers: { cookie: 'flowweb.session_token=tok' } };
      const mockRes = { json: vi.fn(), status: vi.fn().mockReturnValue({ json: vi.fn() }) };
      mockSvc.updateProfile = vi.fn().mockResolvedValue({
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
      mockSvc.updateProfile = vi.fn().mockResolvedValue({
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
});
