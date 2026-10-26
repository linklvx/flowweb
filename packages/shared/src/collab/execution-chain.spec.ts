// packages/shared/src/collab/execution-chain.spec.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段；spec v5.4 §6.2/§6.3）：执行链五表契约冻结的契约测试——
// NodeExecution 当前行+更新守卫真值表（generation 匹配且 execSeq 严格单调）、ExecutionOutbox 唯一键+
// SKIP LOCKED 租约+禁作 feed 日志负控、MaterializeRun fencing、RefundObligation unique+reversesId 幂等、
// ObjectManifest claimOwner/claimUntil。本文件=T21/T22/T23 的消费契约锁。
// Y1c T21（解冻窗口扩展）：+④根修红测（nodeExecutionUpdateAllowed 内部比较改道 compareExecSeq 单源）
// +确认点①附带裁定 #11（LifecycleObligation 定队列——state/attempts/lease+effect→obligation 映射+退款路径）。
import { describe, expect, it, vi } from 'vitest';
import {
  ExecutionOutboxRow, EXECUTION_OUTBOX_CONTRACT, EXTERNAL_SIDE_EFFECT_IDEMPOTENCY,
  MaterializeRunRow, MATERIALIZE_FENCING_CONTRACT, nodeExecutionUpdateAllowed,
  NodeExecutionRow, NODE_EXECUTION_CONTRACT, ObjectManifestRow, OBJECT_MANIFEST_CLAIM_CONTRACT,
  RefundObligationRow, REFUND_IDEMPOTENCY_CONTRACT,
} from './execution-chain';

// ── ④根修（T21）观察面：compareExecSeq 单源路由 spy（vi.hoisted 防 TDZ——mock 工厂先于文件体执行）──
const { compareExecSeqCalls } = vi.hoisted(() => ({ compareExecSeqCalls: [] as Array<[string, string]> }));
vi.mock('../canvas/media-fact', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../canvas/media-fact')>();
  return {
    ...actual,
    compareExecSeq: (a: string, b: string) => {
      compareExecSeqCalls.push([a, b]);
      return actual.compareExecSeq(a, b);
    },
  };
});

describe('Y1c T5b 契约冻结：NodeExecution 当前行表（spec §6.2）', () => {
  it('列集冻结：PK(projectId,nodeId)+generation 列+execSeq+nodeVersion（=该节点末次事件 feedSeq——单名单义）', () => {
    const row: NodeExecutionRow = {
      projectId: 'p1', nodeId: 'n1', generation: 3, execSeq: 9n, nodeVersion: 12n,
      status: 'RUNNING', attempts: 1, errorCode: 'E_PROV', artifactRev: 2, updatedAtMs: 1,
    };
    expect(Object.keys(row).sort()).toEqual([
      'artifactRev', 'attempts', 'errorCode', 'execSeq', 'generation', 'nodeId',
      'nodeVersion', 'projectId', 'status', 'updatedAtMs',
    ]);
    expect(NODE_EXECUTION_CONTRACT.historyHome).toContain('GenerationIntent');
    expect(NODE_EXECUTION_CONTRACT.artifactRevSource).toContain('NodeArtifact');
  });
  it('更新守卫全真值表：generation 匹配且 execSeq 严格单调才写——同 execSeq 亦拒（旧 worker 迟到更新拒绝）', () => {
    const cur = { generation: 3, execSeq: 10n };
    expect(nodeExecutionUpdateAllowed(cur, { generation: 3, execSeq: 11n })).toBe(true);    // 单调前进 ✓
    expect(nodeExecutionUpdateAllowed(cur, { generation: 3, execSeq: 10n })).toBe(false);   // 同值 ✗
    expect(nodeExecutionUpdateAllowed(cur, { generation: 3, execSeq: 9n })).toBe(false);    // 回退 ✗
    expect(nodeExecutionUpdateAllowed(cur, { generation: 4, execSeq: 11n })).toBe(false);   // 换代 ✗（generation CAS）
    expect(nodeExecutionUpdateAllowed(cur, { generation: 2, execSeq: 11n })).toBe(false);   // 旧代 ✗
  });
  it('④根修（T21 解冻窗口）：execSeq 比较改道 compareExecSeq 单源——bigint 入参外形不变、内部 string 十进制比较', () => {
    compareExecSeqCalls.length = 0;
    expect(nodeExecutionUpdateAllowed({ generation: 3, execSeq: 10n }, { generation: 3, execSeq: 11n })).toBe(true);
    // 红锚（根修前）：CONTRACT-FREEZE 冻结面 bigint 裸比（since T5b 488160c0）——零 compareExecSeq 调用
    expect(compareExecSeqCalls.length).toBeGreaterThan(0);
    expect(compareExecSeqCalls[0]).toEqual(['11', '10']);   // 签名域=string 十进制（media-fact.ts 单源）
    compareExecSeqCalls.length = 0;
    expect(nodeExecutionUpdateAllowed({ generation: 3, execSeq: 11n }, { generation: 3, execSeq: 10n })).toBe(false);
    expect(compareExecSeqCalls[0]).toEqual(['10', '11']);
  });
  it('④根修：2^53 边界语义不变（9007199254740993>9007199254740992——Number 域不可分辨、BigInt 域分辨）+严格单调', () => {
    const hi = 9_007_199_254_740_993n, lo = 9_007_199_254_740_992n;   // 2^53+1 / 2^53
    expect(nodeExecutionUpdateAllowed({ generation: 1, execSeq: lo }, { generation: 1, execSeq: hi })).toBe(true);
    expect(nodeExecutionUpdateAllowed({ generation: 1, execSeq: hi }, { generation: 1, execSeq: lo })).toBe(false);
    expect(nodeExecutionUpdateAllowed({ generation: 1, execSeq: hi }, { generation: 1, execSeq: hi })).toBe(false);
  });
});

describe('Y1c T5b 契约冻结：ExecutionOutbox（工作队列——禁作 feed 日志）', () => {
  it('列集冻结：唯一键含 generation+业务幂等键 businessKey+claim 租约列（SKIP LOCKED）', () => {
    const row: ExecutionOutboxRow = {
      id: 'ob-1', projectId: 'p1', generation: 3, businessKey: 'exec-finalize:req-1:n1',
      kind: 'exec-finalize', payload: { requestId: 'req-1' }, state: 'PENDING',
      claimOwner: 'w-1', claimUntilMs: 2, attempts: 0, createdAtMs: 1,
    };
    expect(Object.keys(row).sort()).toEqual([
      'attempts', 'businessKey', 'claimOwner', 'claimUntilMs', 'createdAtMs', 'generation',
      'id', 'kind', 'payload', 'projectId', 'state',
    ]);
  });
  it('契约三则：唯一键 (projectId,generation,businessKey)/SKIP LOCKED 租约/禁作 feed 日志（负控）+pending 行不按 watermark 过滤', () => {
    expect(EXECUTION_OUTBOX_CONTRACT.uniqueKey).toBe('(projectId, generation, businessKey)');
    expect(EXECUTION_OUTBOX_CONTRACT.claim).toContain('SKIP LOCKED');
    expect(EXECUTION_OUTBOX_CONTRACT.role).toContain('不作 feed 日志');
    expect(EXECUTION_OUTBOX_CONTRACT.reconciliation).toContain('全量对账');
  });
});

describe('Y1c T5b 契约冻结：交付 fencing 与退款幂等（spec §6.3——承袭 v4 §2.9）', () => {
  it('MaterializeRun：materializeRunId+expectedExecSeq 双锚 fencing（B12/B17 承袭）', () => {
    const row: MaterializeRunRow = {
      id: 'mr-1', projectId: 'p1', nodeId: 'n1', expectedExecSeq: 10n, state: 'RUNNING', createdAtMs: 1,
    };
    expect(Object.keys(row).sort()).toEqual(['createdAtMs', 'expectedExecSeq', 'id', 'nodeId', 'projectId', 'state']);
    expect(MATERIALIZE_FENCING_CONTRACT.anchors).toContain('materializeRunId');
    expect(MATERIALIZE_FENCING_CONTRACT.anchors).toContain('expectedExecSeq');
  });
  it('RefundObligation：unique(intentRowId,execSeq)+reversesId 幂等——不依据客户端 doc 字段或过期 worker 状态', () => {
    const row: RefundObligationRow = {
      id: 'ro-1', intentRowId: 'gi-1', execSeq: 10n, reversesId: 'settle-1',
      creditAmount: 5, state: 'PENDING', createdAtMs: 1,
    };
    expect(Object.keys(row).sort()).toEqual([
      'createdAtMs', 'creditAmount', 'execSeq', 'id', 'intentRowId', 'reversesId', 'state',
    ]);
    expect(REFUND_IDEMPOTENCY_CONTRACT.uniqueKey).toBe('(intentRowId, execSeq)');
    expect(REFUND_IDEMPOTENCY_CONTRACT.reversesId).toContain('幂等');
    expect(REFUND_IDEMPOTENCY_CONTRACT.evidence).toContain('不依据客户端 doc 字段');
  });
  it('ObjectManifest：claimOwner/claimUntil GC delete-claim+有界 orphan', () => {
    const row: ObjectManifestRow = {
      id: 'om-1', objectKey: 'artifacts/a/b.png', sizeBytes: 1024,
      claimOwner: 'gc-1', claimUntilMs: 2, state: 'REFERENCED', updatedAtMs: 1,
    };
    expect(Object.keys(row).sort()).toEqual(['claimOwner', 'claimUntilMs', 'id', 'objectKey', 'sizeBytes', 'state', 'updatedAtMs']);
    expect(OBJECT_MANIFEST_CLAIM_CONTRACT.gc).toContain('claimOwner/claimUntil');
  });
  it('外部副作用幂等注记（偏离 36-④）：write-ahead providerRequestId+query-first resume；text 链补外呼锚——数据库 fencing 撤不回已发生外呼', () => {
    expect(EXTERNAL_SIDE_EFFECT_IDEMPOTENCY.submitPollChain).toContain('write-ahead providerRequestId');
    expect(EXTERNAL_SIDE_EFFECT_IDEMPOTENCY.textChain).toContain('外呼锚');
  });
});

// ═══ Y1c T21（确认点①附带裁定 #11——解冻窗口落定）：LifecycleObligation 定队列 ═════════════════

describe('Y1c T21 #11：LifecycleObligation 队列契约（state/attempts/lease——T26 观察器消费）', () => {
  it('队列状态 closed 4 值：PENDING/CLAIMED/DONE/DEAD（DEAD=attempts 耗尽 fail-closed 告警档非静默丢）', async () => {
    const { LIFECYCLE_OBLIGATION_STATES } = await import('./execution-chain');
    expect([...LIFECYCLE_OBLIGATION_STATES]).toEqual(['PENDING', 'CLAIMED', 'DONE', 'DEAD']);
  });
  it('队列行列集冻结：kind=义务 closed enum（必含 FEED_TOMBSTONE 衔接 lifecycle.ts）+state+attempts+claim 租约双列', async () => {
    const sample: import('./execution-chain').LifecycleObligationQueueRow = {
      id: 'lo-1', projectId: 'p1', nodeId: 'n1', kind: 'FEED_TOMBSTONE', walSeq: 7n,
      state: 'PENDING', attempts: 0, claimOwner: 'w-1', claimUntilMs: 9, createdAtMs: 1, updatedAtMs: 2,
    };
    expect(Object.keys(sample).sort()).toEqual([
      'attempts', 'claimOwner', 'claimUntilMs', 'createdAtMs', 'id', 'kind',
      'nodeId', 'projectId', 'state', 'updatedAtMs', 'walSeq',
    ]);
  });
  it('effect→obligation 映射（单源纯函数）：NODE_DELETED→三义务；NODE_RESTORED/其余 effect 零义务（负控）', async () => {
    const { obligationsForFrameEffect } = await import('./execution-chain');
    expect(obligationsForFrameEffect('NODE_DELETED')).toEqual(['FEED_TOMBSTONE', 'NODE_DELETED', 'EXEC_FINALIZE']);
    expect(obligationsForFrameEffect('NODE_CREATED')).toEqual([]);
    expect(obligationsForFrameEffect('NODE_RESTORED')).toEqual([]);   // undo 重建=新 lifecycleSeq——无删除义务（负控）
    expect(obligationsForFrameEffect('EDGE_ADDED')).toEqual([]);
    expect(obligationsForFrameEffect('EDGE_REMOVED')).toEqual([]);
    expect(obligationsForFrameEffect('MEDIA_REF_ADDED')).toEqual([]);
    expect(obligationsForFrameEffect('MEDIA_REF_REMOVED')).toEqual([]);
    expect(obligationsForFrameEffect('FIELD_CHANGED')).toEqual([]);
  });
  it('队列转移真值表：claim/complete/fail/lease-expired——终态（DONE/DEAD）免疫一切事件；fail 按 attempts 上限进 DEAD', async () => {
    const { nextObligationQueueState } = await import('./execution-chain');
    const pend = { state: 'PENDING' as const, attempts: 0 };
    expect(nextObligationQueueState(pend, { type: 'claim', owner: 'w-1', untilMs: 9 })).toMatchObject({ state: 'CLAIMED', claimOwner: 'w-1', claimUntilMs: 9 });
    expect(nextObligationQueueState(pend, { type: 'complete' })).toMatchObject({ state: 'DONE' });            // 幂等终态（未 claim 直达=重建面）
    expect(nextObligationQueueState({ state: 'CLAIMED' as const, attempts: 1 }, { type: 'complete' })).toMatchObject({ state: 'DONE' });
    expect(nextObligationQueueState({ state: 'CLAIMED' as const, attempts: 1 }, { type: 'fail' })).toMatchObject({ state: 'PENDING', attempts: 2 });
    expect(nextObligationQueueState({ state: 'PENDING' as const, attempts: 0 }, { type: 'fail' })).toMatchObject({ state: 'PENDING', attempts: 1 });
    expect(nextObligationQueueState({ state: 'CLAIMED' as const, attempts: 4 }, { type: 'fail' })).toMatchObject({ state: 'DEAD', attempts: 5 });        // attempts+1≥5（maxAttempts 冻结值）
    expect(nextObligationQueueState({ state: 'CLAIMED' as const, attempts: 1 }, { type: 'lease-expired' })).toMatchObject({ state: 'PENDING', attempts: 2 });   // 租约到期重派计一次尝试
    expect(nextObligationQueueState(pend, { type: 'lease-expired' })).toMatchObject({ state: 'PENDING', attempts: 0 });   // PENDING 无租约可过期=no-op
    expect(nextObligationQueueState({ state: 'CLAIMED' as const, attempts: 1 }, { type: 'claim', owner: 'w-2', untilMs: 9 })).toBeNull();   // 双 claim 结构性禁（重派必经 lease-expired）
    for (const terminal of ['DONE', 'DEAD'] as const) {
      expect(nextObligationQueueState({ state: terminal, attempts: 1 }, { type: 'claim', owner: 'w', untilMs: 1 })).toBeNull();
      expect(nextObligationQueueState({ state: terminal, attempts: 1 }, { type: 'complete' })).toBeNull();
      expect(nextObligationQueueState({ state: terminal, attempts: 1 }, { type: 'fail' })).toBeNull();
      expect(nextObligationQueueState({ state: terminal, attempts: 1 }, { type: 'lease-expired' })).toBeNull();
    }
  });
  it('退款路径契约：EXEC_FINALIZE→RefundObligation（unique(intentRowId,execSeq)+reversesId）；FEED_TOMBSTONE/NODE_DELETED 无资金面', async () => {
    const { LIFECYCLE_OBLIGATION_REFUND_PATH } = await import('./execution-chain');
    expect(LIFECYCLE_OBLIGATION_REFUND_PATH.EXEC_FINALIZE).toContain('RefundObligation');
    expect(LIFECYCLE_OBLIGATION_REFUND_PATH.EXEC_FINALIZE).toContain('reversesId');
    expect(LIFECYCLE_OBLIGATION_REFUND_PATH.FEED_TOMBSTONE).toContain('无资金面');
    expect(LIFECYCLE_OBLIGATION_REFUND_PATH.NODE_DELETED).toContain('无资金面');
  });
  it('租约纪律注记：SKIP LOCKED 同 ExecutionOutbox 先例+attempts 上限冻结值', async () => {
    const { LIFECYCLE_OBLIGATION_LEASE } = await import('./execution-chain');
    expect(LIFECYCLE_OBLIGATION_LEASE.claim).toContain('SKIP LOCKED');
    expect(LIFECYCLE_OBLIGATION_LEASE.maxAttempts).toBe(5);
    expect(LIFECYCLE_OBLIGATION_LEASE.retry).toContain('DEAD');
  });
});
