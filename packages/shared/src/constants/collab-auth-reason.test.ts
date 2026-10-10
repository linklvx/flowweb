import { describe, it, expect } from 'vitest';
import { CollabAuthReason, isTerminalReason, COLLAB_AUTH_REASONS } from './collab-auth-reason';
import { COLLAB_READY_REASONS, type CollabReadyReason, type CollabReadyResponse } from './collab-ready';

describe('CollabAuthReason 十三档（Y0b-3 T0：七旧+六新 append-only）', () => {
  it('值即线上协议串——封闭数组（顺序冻结，只增不改）', () => {
    expect(COLLAB_AUTH_REASONS).toEqual([
      'unauthenticated', 'session-expired', 'not-found', 'forbidden',
      'db-unavailable', 'draining', 'lease-not-ready',
      'server-overloaded', 'schema-outdated', 'client-version-missing',
      'client-version-invalid', 'rate-limited', 'server-outdated',
    ]);
  });
  it('lease-not-ready 为瞬态档——误入终态白名单=关停期外客户端停止重连', () => {
    expect(isTerminalReason(CollabAuthReason.LEASE_NOT_READY)).toBe(false);
  });
});

describe('Y0b-3 T0：词表追加六值（append-only）+终态五档', () => {
  it('server-overloaded/rate-limited 是瞬态——严禁终态（误入=一次尖峰把客户端钉死且不自愈）', () => {
    expect(isTerminalReason(CollabAuthReason.SERVER_OVERLOADED)).toBe(false);
    expect(isTerminalReason(CollabAuthReason.RATE_LIMITED)).toBe(false);
    expect(isTerminalReason(CollabAuthReason.SERVER_OUTDATED)).toBe(false);
  });
  it('版本族三档是终态（reload 档 UX 依赖 isTerminalReason 分流）', () => {
    for (const r of ['schema-outdated', 'client-version-missing', 'client-version-invalid']) {
      expect(isTerminalReason(r)).toBe(true);
    }
  });
  it('词表 append-only 全集=13 值（七旧+六新）', () => {
    expect(COLLAB_AUTH_REASONS).toHaveLength(13);
  });
});

describe('isTerminalReason 终态白名单（契约锁㉙）', () => {
  it('仅四档终态 true：unauthenticated/session-expired/not-found/forbidden', () => {
    expect(isTerminalReason(CollabAuthReason.UNAUTHENTICATED)).toBe(true);
    expect(isTerminalReason(CollabAuthReason.SESSION_EXPIRED)).toBe(true);
    expect(isTerminalReason(CollabAuthReason.NOT_FOUND)).toBe(true);
    expect(isTerminalReason(CollabAuthReason.FORBIDDEN)).toBe(true);
  });
  it('db-unavailable / draining / 裸 permission-denied / undefined / 未知串一律 false（瞬态桶）', () => {
    expect(isTerminalReason(CollabAuthReason.DB_UNAVAILABLE)).toBe(false);
    expect(isTerminalReason(CollabAuthReason.DRAINING)).toBe(false);
    expect(isTerminalReason('permission-denied')).toBe(false);
    expect(isTerminalReason(undefined)).toBe(false);
    expect(isTerminalReason('whatever-else')).toBe(false);
  });
});

describe('CollabReadyReason 封闭枚举（G-4 载体：tsc 即门）', () => {
  it('八值字面量封闭（SV7：not-serving 在 lease-lost 后）', () => {
    expect(COLLAB_READY_REASONS).toEqual([
      'pg-down', 'draining', 'lease-error', 'lease-lost', 'not-serving',
      'lease-held', 'lease-not-acquired', 'spool-unwritable',
    ]);
  });
  it('CollabReadyResponse 结构：epoch=string（BigInt 序列化崩坑）+pending 含 storeInFlight/stranded 分区', () => {
    const body: CollabReadyResponse = {
      ready: false,
      reason: 'lease-held' satisfies CollabReadyReason,
      holder: 'prev-owner',
      epoch: '3',
      holderRenewedAgoMs: 1200,
      redis: 'up',
      pending: { projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 },
      spoolQuarantined: 0,
    };
    expect(typeof body.epoch).toBe('string');
    expect(body.pending.strandedFiles).toBe(0);
  });
});
