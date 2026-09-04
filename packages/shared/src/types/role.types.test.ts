import { describe, it, expect } from 'vitest';
import { isAdmin, type Role } from './role.types';

describe('isAdmin 类型谓词', () => {
  it('ADMIN 命中且收窄为 "ADMIN"', () => {
    const role: Role = 'ADMIN';
    if (isAdmin(role)) expect(role).toBe('ADMIN');
    else throw new Error('should narrow');
  });
  it('USER / undefined / 非法串均不命中', () => {
    expect(isAdmin('USER')).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin('admin' as unknown)).toBe(false);
  });
});
