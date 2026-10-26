// apps/api/src/modules/collab/collab-document.exec-map.spec.ts
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { CollabDocumentService, applyWriteExecStatusToDoc } from './collab-document.service';
import { execOrphanBlockedTotal } from '../execution/exec.metrics';

/** B2/F2 批0.5-5→Y1c T22（G5 同切片——doc.exec 停写）：writeExecStatus=RuntimeEvent exec.status
 *  PG 写（Z99/Z111 代次守卫随 doc 写面退役——客户端 reducer nodeVersion 大者胜承担旧事件丢弃）。
 *  本 spec 焦点：方法面事件发射契约（payload 形状/attempts 兜底）+零 doc 写（不变量⑦）+
 *  applyWriteExecStatusToDoc 原语域（writeBatch 词汇表——T32 删码清单前的在役面）。 */
import { vi } from 'vitest';

function buildService(doc: Y.Doc, feedEvents: Array<Record<string, unknown>> = []): CollabDocumentService {
  const fakeFeed = {
    appendEvent: vi.fn(async (_pid: string, kind: string, factory: (seq: bigint) => Record<string, unknown>) => {
      const payload = factory(1n);
      feedEvents.push({ kind, ...payload });
      return { feedSeq: 1n, generation: 0, docSeq: 0n };
    }),
    notifyProject: vi.fn(),
  };
  const service = new CollabDocumentService(
    { isWritableOrDegraded: () => 'ok', isLeaseServing: () => true } as any,
    { readSnapshotOnly: async () => ({ state: null, updates: [], stateSeq: 0n }) } as any,
    undefined,
    fakeFeed as never,
  );
  (service as any).withSession = (_projectId: string, fn: (doc: Y.Doc) => unknown, _opts?: unknown) => fn(doc);
  return service;
}

/** Y0c T11（Z4）守卫后：exec 写目标节点必须存在（不存在⇒不建条目）——夹具对齐
 *  （collab-doc-writer.service.spec seedNode 同手法；Z4 前本文件用例不种节点=守卫域旧形态）。 */
function seedNode(doc: Y.Doc, id = 'n1'): void {
  doc.getMap('nodes').set(id, new Y.Map());
}

const execEntry = (doc: Y.Doc, nodeId: string): Record<string, unknown> | undefined => {
  const m = doc.getMap('exec').get(nodeId);
  return m instanceof Y.Map ? (m.toJSON() as Record<string, unknown>) : undefined;
};

const totalOf = (m: any): number => Object.values(m.hashMap ?? {}).reduce((s: number, v: any) => s + (v.value ?? 0), 0);

describe('Y1c T22：writeExecStatus 改 PG 写（RuntimeEvent exec.status——doc.exec 停写）', () => {
  it('发射 exec.status 事件（nodeId/status/attempts——缺 attempts 兜 0）+零 doc 写（不变量⑦）+提交后 notify', async () => {
    const doc = new Y.Doc();
    seedNode(doc);
    const events: Array<Record<string, unknown>> = [];
    const svc = buildService(doc, events);
    await svc.writeExecStatus('p1', 'n1', { status: 'loading', attempts: 1, jobId: 'j1', intentId: 'i1' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'exec.status', nodeId: 'n1', status: 'loading', attempts: 1 });
    expect(doc.getMap('exec').size).toBe(0);   // 零 doc 写
    expect((svc as any).feed.notifyProject).toHaveBeenCalledWith('p1');   // 事务提交后通知
  });
  it('attempts/execSeq/errorCode 透传（payload 键集=EXEC_STATUS_KEYS 域）', async () => {
    const doc = new Y.Doc();
    seedNode(doc);
    const events: Array<Record<string, unknown>> = [];
    await buildService(doc, events).writeExecStatus('p1', 'n1', { status: 'error', attempts: 2, errorCode: 'E_X', execSeq: '7' });
    expect(events[0]).toMatchObject({ nodeId: 'n1', status: 'error', attempts: 2, errorCode: 'E_X', execSeq: '7' });
  });
  it('受理门先行：lease 未持 → 503（事件零发射——与旧写面同门）', async () => {
    const doc = new Y.Doc();
    const service = new CollabDocumentService(
      { isWritableOrDegraded: () => 'ok', isLeaseServing: () => false } as any,
      { readSnapshotOnly: async () => ({ state: null, updates: [], stateSeq: 0n }) } as any,
    );
    await expect(service.writeExecStatus('p1', 'n1', { status: 'loading', attempts: 1 })).rejects.toThrow(/503|ServiceUnavailable|collab/);
  });
  it('Z99/Z111 代次守卫随 doc 写面退役：迟到旧事件照发（客户端 reducer nodeVersion 大者胜丢弃——T22 语义迁移注记）', async () => {
    const doc = new Y.Doc();
    seedNode(doc);
    const events: Array<Record<string, unknown>> = [];
    await buildService(doc, events).writeExecStatus('p1', 'n1', { status: 'error', attempts: 1 });
    await buildService(doc, events).writeExecStatus('p1', 'n1', { status: 'loading', attempts: 2 });
    expect(events).toHaveLength(2);   // 守卫不拦（旧 dropped 计数面退役——服务端不再持 exec 条目状态）
  });
});

describe('Y0c T11（Z4/Z69 减法）：writeExecStatus 存在性守卫——节点不存在不建条目', () => {
  it('原语直测：不存在节点 ⇒ {written:false,reason:"node-deleted"} ∧ exec 无条目（新孤儿结构性不可产生）', () => {
    const doc = new Y.Doc(); // nodes 空——ghost 不存在

    const outcome = applyWriteExecStatusToDoc(doc, 'ghost', { status: 'loading', jobId: 'j1', attempts: 0 });

    expect(outcome).toEqual({ written: false, reason: 'node-deleted' });   // 类型化拒码（改前红=无此分支）
    expect(doc.getMap('exec').get('ghost')).toBeUndefined();               // 不建条目（改前红=无条件建条目）
  });

  it('顺序判别：ghost 无节点+patch 无 attempts ⇒ reason=node-deleted（存在性判定先行于 attempts 校验——倒序则 missing-attempts）', () => {
    const doc = new Y.Doc(); // nodes 空——ghost 不存在

    const outcome = applyWriteExecStatusToDoc(doc, 'ghost', { status: 'loading' } as unknown as Parameters<typeof applyWriteExecStatusToDoc>[2]);

    expect(outcome).toEqual({ written: false, reason: 'node-deleted' }); // 钉设计决定：存在性守卫先于代次校验
  });

  it('T22：单写面计数随 doc 写面退役——ghost 节点事件照发（孤儿观察归客户端墓碑；计数面退役注记锚）', async () => {
    const doc = new Y.Doc();
    const events: Array<Record<string, unknown>> = [];
    const before = totalOf(execOrphanBlockedTotal);
    await buildService(doc, events).writeExecStatus('p1', 'ghost', { status: 'done', attempts: 1 });
    expect(events).toHaveLength(1);   // 事件照发（节点已删则客户端按墓碑忽略——spec §7 docSeq 应用规则）
    expect(totalOf(execOrphanBlockedTotal)).toBe(before);                 // 计数面退役（doc 无 exec 条目即无孤儿面）
    expect(execEntry(doc, 'ghost')).toBeUndefined();
  });
});
