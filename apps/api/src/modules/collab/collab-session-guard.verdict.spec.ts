// apps/api/src/modules/collab/collab-session-guard.verdict.spec.ts
// Y0c T42（B3 承接账③）：SG verdict 顶层导出直调单测（质量评审 Minor-1——verdict 9 顶层导出零外部
// 生产消费方，纯函数化价值=判定核可直测；本 spec 补 4 函数边界用例〔decideAuthAdmission/
// decideSweepRecheck/decideClientOwnership/decideAwarenessStrip〕，禁降私有=保 §5 纯函数化结构）。
// 形态：对现状写当场全绿（W2 语义钉住先例）——门序/边界值逐条钉死，判定核漂移即红。
// 零 cast/零 gateway 实例（façade 门禁天然干净）；执法副作用（inc/readOnly/广播）不在本面——留壳语义见 service。
import { describe, it, expect } from 'vitest';
import { CollabAuthReason } from '@flowweb/shared';
import { decideAuthAdmission, decideSweepRecheck, decideClientOwnership, decideAwarenessStrip } from './collab-session-guard.service';

/** 七门全过基线快照（csv='2'=CLIENT_PROTOCOL_VERSION 现值——shared collab-protocol 单源） */
const PASS_CTX = { hasDoc: true, heapTripped: false, csv: '2', docNameValid: true, shuttingDown: false, leaseServing: true, breakerOpen: false };

describe('decideAuthAdmission（§3.1bis 门序钉死 heap→version→docName→draining→lease→breaker）', () => {
  it('七门全过 → proceed', () => {
    expect(decideAuthAdmission(PASS_CTX)).toEqual({ proceed: true });
  });
  it('gate1 heap：仅拒新物化（!hasDoc∧tripped→server-overloaded+loadRejectCount）；hasDoc=true∧tripped=压力期放行存量编辑防自伤', () => {
    const v = decideAuthAdmission({ ...PASS_CTX, hasDoc: false, heapTripped: true });
    expect(v).toMatchObject({ proceed: false, reason: CollabAuthReason.SERVER_OVERLOADED, source: 'heap', loadRejectCount: 'server-overloaded' });
    expect(decideAuthAdmission({ ...PASS_CTX, heapTripped: true })).toEqual({ proceed: true });
  });
  it('gate2 版本门四档（csv 精确相等——missing/invalid/schema-outdated/server-outdated，source=version）', () => {
    expect(decideAuthAdmission({ ...PASS_CTX, csv: null })).toMatchObject({ proceed: false, reason: CollabAuthReason.CLIENT_VERSION_MISSING, source: 'version' });
    expect(decideAuthAdmission({ ...PASS_CTX, csv: 'abc' })).toMatchObject({ proceed: false, reason: CollabAuthReason.CLIENT_VERSION_INVALID, source: 'version' });
    expect(decideAuthAdmission({ ...PASS_CTX, csv: '1' })).toMatchObject({ proceed: false, reason: CollabAuthReason.SCHEMA_OUTDATED, source: 'version' });
    expect(decideAuthAdmission({ ...PASS_CTX, csv: '3' })).toMatchObject({ proceed: false, reason: CollabAuthReason.SERVER_OUTDATED, source: 'version' });
  });
  it('gate3 先于 gate4：docName 无效∧draining 并存 → invalid-doc-name（确定性拒绝零 DB，序漂移即红）', () => {
    expect(decideAuthAdmission({ ...PASS_CTX, docNameValid: false, shuttingDown: true }))
      .toMatchObject({ proceed: false, reason: CollabAuthReason.INVALID_DOC_NAME, source: 'state' });
  });
  it('gate4 draining 先于 gate5 租约门（draining 时 collabState≠serving——租约门先行=死代码+误导 reason）', () => {
    expect(decideAuthAdmission({ ...PASS_CTX, shuttingDown: true, leaseServing: false }))
      .toMatchObject({ proceed: false, reason: CollabAuthReason.DRAINING, source: 'state' });
    expect(decideAuthAdmission({ ...PASS_CTX, leaseServing: false }))
      .toMatchObject({ proceed: false, reason: CollabAuthReason.LEASE_NOT_READY, source: 'state' });
  });
  it('gate6 熔断 open → db-unavailable（零 Prisma；前五门全过才达）', () => {
    expect(decideAuthAdmission({ ...PASS_CTX, breakerOpen: true }))
      .toMatchObject({ proceed: false, reason: CollabAuthReason.DB_UNAVAILABLE, source: 'state' });
  });
});

describe('decideSweepRecheck（快照死线 ∨ 权限复验到期）', () => {
  const now = 1_000_000;
  it('expiresAt===now 边界=已过期（getTime()<=now）→ recheck', () => {
    expect(decideSweepRecheck({ expiresAt: new Date(now), now, cachedAt: now, ttl: 300_000 })).toBe('recheck');
  });
  it('未过期但 permCache 首查（cachedAt undefined）→ recheck', () => {
    expect(decideSweepRecheck({ expiresAt: new Date(now + 1), now, cachedAt: undefined, ttl: 300_000 })).toBe('recheck');
  });
  it('now-cachedAt===ttl 边界=到期（>=）→ recheck；ttl-1 → skip', () => {
    expect(decideSweepRecheck({ expiresAt: new Date(now + 1), now, cachedAt: now - 300_000, ttl: 300_000 })).toBe('recheck');
    expect(decideSweepRecheck({ expiresAt: new Date(now + 1), now, cachedAt: now - 299_999, ttl: 300_000 })).toBe('skip');
  });
  it('expiresAt undefined（非 Date）不算过期——仅 perm 支判定', () => {
    expect(decideSweepRecheck({ expiresAt: undefined, now, cachedAt: now, ttl: 300_000 })).toBe('skip');
  });
});

describe('decideClientOwnership（归属表三分支——forged/ghost/owner-limit/register/pass-inject）', () => {
  it('他人登记=伪造 → forged（owner≠socketId 即拒，不查空态）', () => {
    expect(decideClientOwnership({ owner: 'sock-a', socketId: 'sock-b', emptyState: true, docHasState: false, ownCount: 0 })).toBe('forged');
  });
  it('owner===socketId（含刚登记）→ pass-inject', () => {
    expect(decideClientOwnership({ owner: 'sock-a', socketId: 'sock-a', emptyState: false, docHasState: true, ownCount: 1 })).toBe('pass-inject');
  });
  it('首见 ghost：空态∧doc 无此 id → ghost', () => {
    expect(decideClientOwnership({ owner: undefined, socketId: 's', emptyState: true, docHasState: false, ownCount: 0 })).toBe('ghost');
  });
  it('首见超上限：ownCount>=4（AWARENESS_CLIENT_ID_LIMIT，service :75 模块私有——字面值钉）→ owner-limit；3 → register', () => {
    expect(decideClientOwnership({ owner: undefined, socketId: 's', emptyState: false, docHasState: true, ownCount: 4 })).toBe('owner-limit');
    expect(decideClientOwnership({ owner: undefined, socketId: 's', emptyState: false, docHasState: true, ownCount: 3 })).toBe('register');
  });
  it('首见非空态未超限 → register', () => {
    expect(decideClientOwnership({ owner: undefined, socketId: 's', emptyState: false, docHasState: true, ownCount: 0 })).toBe('register');
  });
});

describe('decideAwarenessStrip（readOnly→solo→over-8 三档序）', () => {
  it('readOnly 优先于 solo（连接级先于文档级）', () => {
    expect(decideAwarenessStrip({ readOnly: true, distinctUsers: 1 })).toBe('read-only');
  });
  it('distinctUsers<=1 边界 → solo（1=solo，2=null）', () => {
    expect(decideAwarenessStrip({ readOnly: false, distinctUsers: 1 })).toBe('solo');
    expect(decideAwarenessStrip({ readOnly: false, distinctUsers: 2 })).toBeNull();
  });
  it('>AWARENESS_DISTINCT_USER_STRIP_OVER(8) 边界 → over-8（8=null，9=over-8）', () => {
    expect(decideAwarenessStrip({ readOnly: false, distinctUsers: 8 })).toBeNull();
    expect(decideAwarenessStrip({ readOnly: false, distinctUsers: 9 })).toBe('over-8');
  });
});
