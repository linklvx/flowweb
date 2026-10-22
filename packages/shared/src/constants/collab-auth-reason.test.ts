import { describe, it, expect } from 'vitest';
import { CollabAuthReason, isTerminalReason, COLLAB_AUTH_REASONS, COLLAB_VERSION_TERMINAL_REASONS } from './collab-auth-reason';
import { CLIENT_PROTOCOL_VERSION } from './collab-protocol';
import { COLLAB_READY_REASONS, type CollabReadyReason, type CollabReadyResponse } from './collab-ready';

describe('CollabAuthReason 十四档（Y0b-3 T0：七旧+六新 append-only；Y0b-5 T16 追加 invalid-doc-name）', () => {
  it('值即线上协议串——封闭数组（顺序冻结，只增不改）', () => {
    expect(COLLAB_AUTH_REASONS).toEqual([
      'unauthenticated', 'session-expired', 'not-found', 'forbidden',
      'db-unavailable', 'draining', 'lease-not-ready',
      'server-overloaded', 'schema-outdated', 'client-version-missing',
      'client-version-invalid', 'rate-limited', 'server-outdated',
      'invalid-doc-name',
    ]);
  });
  it('lease-not-ready 为瞬态档——误入终态白名单=关停期外客户端停止重连', () => {
    expect(isTerminalReason(CollabAuthReason.LEASE_NOT_READY)).toBe(false);
  });
  it('invalid-doc-name 为终态档（Y0b-5 T16——确定性拒绝：漏加=客户端对永不可合法的 docName 无限重连）', () => {
    expect(isTerminalReason(CollabAuthReason.INVALID_DOC_NAME)).toBe(true);
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
  it('词表 append-only 全集=14 值（七旧+六新+invalid-doc-name）', () => {
    expect(COLLAB_AUTH_REASONS).toHaveLength(14);
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

describe('COLLAB_VERSION_TERMINAL_REASONS 版本族 reload 自愈档（Y0b-3 T9 评审 M-1：runtime/SyncBanner 两消费面单源）', () => {
  it('恰三档（schema-outdated/client-version-missing/client-version-invalid）', () => {
    expect(COLLAB_VERSION_TERMINAL_REASONS).toEqual([
      CollabAuthReason.SCHEMA_OUTDATED,
      CollabAuthReason.CLIENT_VERSION_MISSING,
      CollabAuthReason.CLIENT_VERSION_INVALID,
    ]);
  });
  it('子集 ⊆ 终态七档全集（isTerminalReason 全 true——版本族是终态档的子集）', () => {
    for (const r of COLLAB_VERSION_TERMINAL_REASONS) expect(isTerminalReason(r)).toBe(true);
  });
  it('server-outdated 瞬态档不入（reload 无效——v2 M-4）', () => {
    expect(COLLAB_VERSION_TERMINAL_REASONS).not.toContain(CollabAuthReason.SERVER_OUTDATED);
  });
});

describe('CollabReadyReason 封闭枚举（G-4 载体：tsc 即门）', () => {
  it('九值字面量封闭（SV7：not-serving 在 lease-lost 后；Y0b-5 T16 追加 db-unavailable=PG 熔断 open 档）', () => {
    expect(COLLAB_READY_REASONS).toEqual([
      'pg-down', 'draining', 'lease-error', 'lease-lost', 'not-serving',
      'lease-held', 'lease-not-acquired', 'spool-unwritable',
      'db-unavailable',
    ]);
  });
  it('CollabReadyResponse 结构：epoch=string（BigInt 序列化崩坑）+pending 含 storeInFlight/stranded 分区+collabProtocolVersion 必选（Y0b-3 T5 P-C）', () => {
    const body: CollabReadyResponse = {
      ready: false,
      reason: 'lease-held' satisfies CollabReadyReason,
      holder: 'prev-owner',
      epoch: '3',
      holderRenewedAgoMs: 1200,
      redis: 'up',
      pending: { projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 },
      spoolQuarantined: 0,
      collabProtocolVersion: CLIENT_PROTOCOL_VERSION,
    };
    expect(typeof body.epoch).toBe('string');
    expect(body.pending.strandedFiles).toBe(0);
    expect(body.collabProtocolVersion).toBe(3);   // 缺字段=类型红（必选）；值锚 bump 纪律（T18 版本硬切 csv=3——与 CANVAS_DOC_SCHEMA_VERSION 双常量同 bump）
  });
});
