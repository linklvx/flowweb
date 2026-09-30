import { describe, it, expect } from 'vitest';
import { parseSessionToken } from './parse-session-token';

describe('parseSessionToken', () => {
  it('单 cookie：取 token 值', () => {
    expect(parseSessionToken('flowweb.session_token=abc123')).toBe('abc123');
  });

  it('多 cookie：取目标 cookie 且不含尾部分号/后续内容', () => {
    expect(parseSessionToken('other=1; flowweb.session_token=abc123; next=2')).toBe('abc123');
  });

  it('无目标 cookie → null', () => {
    expect(parseSessionToken('other=1; another=2')).toBeNull();
  });

  it('undefined / null / 空串 → null（cookie 头缺失的安全缺省）', () => {
    expect(parseSessionToken(undefined)).toBeNull();
    expect(parseSessionToken(null)).toBeNull();
    expect(parseSessionToken('')).toBeNull();
  });
});
