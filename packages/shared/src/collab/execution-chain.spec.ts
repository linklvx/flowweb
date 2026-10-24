// packages/shared/src/collab/execution-chain.spec.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段；spec v5.4 §6.2/§6.3）：执行链五表契约冻结的契约测试——
// NodeExecution 当前行+更新守卫真值表（generation 匹配且 execSeq 严格单调）、ExecutionOutbox 唯一键+
// SKIP LOCKED 租约+禁作 feed 日志负控、MaterializeRun fencing、RefundObligation unique+reversesId 幂等、
// ObjectManifest claimOwner/claimUntil。本文件=T21/T22/T23 的消费契约锁。
import { describe, expect, it } from 'vitest';
import {
  ExecutionOutboxRow, EXECUTION_OUTBOX_CONTRACT, EXTERNAL_SIDE_EFFECT_IDEMPOTENCY,
  MaterializeRunRow, MATERIALIZE_FENCING_CONTRACT, nodeExecutionUpdateAllowed,
  NodeExecutionRow, NODE_EXECUTION_CONTRACT, ObjectManifestRow, OBJECT_MANIFEST_CLAIM_CONTRACT,
  RefundObligationRow, REFUND_IDEMPOTENCY_CONTRACT,
} from './execution-chain';

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
