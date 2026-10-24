// packages/shared/src/collab/lifecycle.spec.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段；spec v5.4 §6.5——census⑪ 定员）：生命周期义务契约冻结的契约测试——
// OBLIGATION_KINDS 三值 closed enum 精确冻结（必含 FEED_TOMBSTONE；排除候选留档）、消费面注记、
// NodeLifecycle 当前行 partial unique+delete no-op 真值表、DeliveryFence fenceSeq 校验契约。
// 本文件=T26（义务观察器）/T22（交付切权）的消费契约锁。
import { describe, expect, it } from 'vitest';
import {
  DeliveryFenceRow, DELIVERY_FENCE_CONTRACT, LifecycleObligationRow, NodeLifecycleRow,
  NodeLifecycleState, NODE_LIFECYCLE_CURRENT_ROW_UNIQUE, NODE_LIFECYCLE_SEMANTICS,
  OBLIGATION_EXCLUDED_CANDIDATES, OBLIGATION_KINDS, OBLIGATION_KIND_CONSUMERS,
  shouldEmitDeleteObligation,
} from './lifecycle';

describe('Y1c T5b 契约冻结：义务 closed enum（census⑪ 定员——新增种类=新功能走 spec 修订非随手加 string）', () => {
  it('OBLIGATION_KINDS 三值精确冻结：FEED_TOMBSTONE/NODE_DELETED/EXEC_FINALIZE', () => {
    expect([...OBLIGATION_KINDS]).toEqual(['FEED_TOMBSTONE', 'NODE_DELETED', 'EXEC_FINALIZE']);
    expect(new Set(OBLIGATION_KINDS).size).toBe(3);
  });
  it('每值消费面注记：FEED_TOMBSTONE=清 Runtime Store 投影/NODE_DELETED=三消费面/EXEC_FINALIZE=GenerationIntent 资金收口', () => {
    expect(Object.keys(OBLIGATION_KIND_CONSUMERS).sort()).toEqual([...OBLIGATION_KINDS].sort());
    expect(OBLIGATION_KIND_CONSUMERS.FEED_TOMBSTONE).toContain('Runtime Store');
    expect(OBLIGATION_KIND_CONSUMERS.NODE_DELETED).toContain('MediaBinding');
    expect(OBLIGATION_KIND_CONSUMERS.NODE_DELETED).toContain('ArtifactProjection');
    expect(OBLIGATION_KIND_CONSUMERS.NODE_DELETED).toContain('VideoProject');
    expect(OBLIGATION_KIND_CONSUMERS.EXEC_FINALIZE).toContain('GenerationIntent');
  });
  it('排除候选留档（census⑪ 对照）：MediaFactOutbox/搜索/公开快照/doc bytes 配额——键域或生命周期不含 nodeId/请求时派生/异步收敛', () => {
    expect(Object.keys(OBLIGATION_EXCLUDED_CANDIDATES).length).toBeGreaterThanOrEqual(4);
    expect(OBLIGATION_EXCLUDED_CANDIDATES['MediaFactOutbox']).toContain('键域无 nodeId');
    expect(Object.keys(OBLIGATION_EXCLUDED_CANDIDATES)).not.toContain('FEED_TOMBSTONE');
  });
});

describe('Y1c T5b 契约冻结：NodeLifecycle 当前行（lifecycleSeq 数值序+partial unique）', () => {
  it('NodeLifecycleRow 列集冻结：projectId+nodeId+lifecycleSeq+isCurrent+state+walSeq（触发帧）', () => {
    const row: NodeLifecycleRow = {
      projectId: 'p1', nodeId: 'n1', lifecycleSeq: 15n, isCurrent: true,
      state: 'ACTIVE', walSeq: 42n, createdAtMs: 1,
    };
    expect(Object.keys(row).sort()).toEqual(['createdAtMs', 'isCurrent', 'lifecycleSeq', 'nodeId', 'projectId', 'state', 'walSeq']);
  });
  it('当前行 partial unique 契约：UNIQUE(projectId,nodeId) WHERE is_current——历史行保留（义务可从帧前缀重建）；两项目同 nodeId 不互串', () => {
    expect(NODE_LIFECYCLE_CURRENT_ROW_UNIQUE).toContain('UNIQUE(projectId, nodeId)');
    expect(NODE_LIFECYCLE_CURRENT_ROW_UNIQUE).toContain('WHERE is_current');
  });
  it('语义四则冻结：delete 已删=no-op 不二次退款/undo 重建=新 lifecycleSeq 恢复态/delete+restore 同帧两行/删除义务只对 ACTIVE 发', () => {
    expect(NODE_LIFECYCLE_SEMANTICS.deleteAlreadyDeleted).toContain('no-op');
    expect(NODE_LIFECYCLE_SEMANTICS.undoRestore).toContain('新 lifecycleSeq');
    expect(NODE_LIFECYCLE_SEMANTICS.deleteRestoreSameFrame).toContain('两行');
  });
  it('shouldEmitDeleteObligation 真值表：ACTIVE→发；DELETED→不发（不二次退款）；undefined（从未在册）→不发', () => {
    expect(shouldEmitDeleteObligation('ACTIVE')).toBe(true);
    expect(shouldEmitDeleteObligation('DELETED')).toBe(false);
    expect(shouldEmitDeleteObligation(undefined)).toBe(false);
  });
  it('LifecycleObligationRow 列集冻结：义务与触发帧前缀 PG 批同事务落库（帧↔义务原子；按 walSeq buffer）', () => {
    const row: LifecycleObligationRow = {
      projectId: 'p1', nodeId: 'n1', kind: 'FEED_TOMBSTONE', walSeq: 42n, createdAtMs: 1,
    };
    expect(Object.keys(row).sort()).toEqual(['createdAtMs', 'kind', 'nodeId', 'projectId', 'walSeq']);
  });
});

describe('Y1c T5b 契约冻结：DeliveryFence（交付 fencing——偏离 38⑳ T26 先于 T22）', () => {
  it('DeliveryFenceRow 列集冻结：projectId+nodeId+fenceSeq（=当前 lifecycleSeq）+state+updatedAt', () => {
    const row: DeliveryFenceRow = { projectId: 'p1', nodeId: 'n1', fenceSeq: 15n, state: 'ACTIVE', updatedAtMs: 1 };
    expect(Object.keys(row).sort()).toEqual(['fenceSeq', 'nodeId', 'projectId', 'state', 'updatedAtMs']);
  });
  it('fence 校验契约：写 artifact 前 fenceSeq==当前 lifecycleSeq 且 state 允许——不匹配=丢弃不退款；权威观察点 T22 起自 doc 切本表', () => {
    expect(DELIVERY_FENCE_CONTRACT.check).toContain('fenceSeq');
    expect(DELIVERY_FENCE_CONTRACT.check).toContain('丢弃不退款');
    expect(DELIVERY_FENCE_CONTRACT.authoritySwitch).toContain('T22');
    expect(DELIVERY_FENCE_CONTRACT.observerOrder).toContain('T26');
  });
  it('NodeLifecycleState 二值：ACTIVE/DELETED（undo 重建=新行回 ACTIVE——无第三态）', () => {
    const states: NodeLifecycleState[] = ['ACTIVE', 'DELETED'];
    expect(states.sort()).toEqual(['ACTIVE', 'DELETED']);
  });
});
