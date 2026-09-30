import { describe, it, expect } from 'vitest';
import { CollabAuthReason, isTerminalReason } from './collab-auth-reason';

describe('批3-1 CollabAuthReason 五档', () => {
  it('档值恰为契约串（gateway .reason 直达 writePermissionDenied，客户端按串分型）', () => {
    expect(Object.values(CollabAuthReason)).toEqual([
      'unauthenticated',
      'session-expired',
      'not-found',
      'forbidden',
      'db-unavailable',
    ]);
  });
});

describe('批3-1 isTerminalReason 终态白名单（契约锁㉙）', () => {
  it('仅四档终态 true：unauthenticated/session-expired/not-found/forbidden', () => {
    expect(isTerminalReason(CollabAuthReason.UNAUTHENTICATED)).toBe(true);
    expect(isTerminalReason(CollabAuthReason.SESSION_EXPIRED)).toBe(true);
    expect(isTerminalReason(CollabAuthReason.NOT_FOUND)).toBe(true);
    expect(isTerminalReason(CollabAuthReason.FORBIDDEN)).toBe(true);
  });
  it('db-unavailable / 裸 permission-denied / undefined / 未知串一律 false（瞬态桶）', () => {
    expect(isTerminalReason(CollabAuthReason.DB_UNAVAILABLE)).toBe(false);
    expect(isTerminalReason('permission-denied')).toBe(false);
    expect(isTerminalReason(undefined)).toBe(false);
    expect(isTerminalReason('whatever-else')).toBe(false);
  });
});
