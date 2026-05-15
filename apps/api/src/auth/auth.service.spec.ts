import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockSignInEmail, mockSignUpEmail, mockSignOut, mockGetSession, mockUpdateUser } = vi.hoisted(() => ({
  mockSignInEmail: vi.fn(),
  mockSignUpEmail: vi.fn(),
  mockSignOut: vi.fn(),
  mockGetSession: vi.fn(),
  mockUpdateUser: vi.fn(),
}));

vi.mock('./auth', () => ({
  auth: {
    api: {
      signInEmail: mockSignInEmail,
      signUpEmail: mockSignUpEmail,
      signOut: mockSignOut,
      getSession: mockGetSession,
      updateUser: mockUpdateUser,
    },
  },
}));

import { AuthService } from './auth.service';
import { auth } from './auth';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService],
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

  it('should expose updateProfile as a function', () => {
    expect(typeof service.updateProfile).toBe('function');
  });
});
