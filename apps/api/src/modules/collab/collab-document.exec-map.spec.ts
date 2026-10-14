// apps/api/src/modules/collab/collab-document.exec-map.spec.ts
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { CollabDocumentService, applyWriteExecStatusToDoc } from './collab-document.service';
import { execProjectionDroppedTotal, execOrphanBlockedTotal } from '../execution/exec.metrics';

/** B2/F2 批0.5-5：exec map 服务端唯一写者。真 Y.Doc 直驱——
 *  mock withDoc 直接执行回调传 doc（gateway 直连细节与本任务无关）。 */
function buildService(doc: Y.Doc): CollabDocumentService {
  // Y0a-2 X9 写意图受理门 + Y0a-3 T8 构造两参（gateway, repo）——stub 恒 ok/serving（本 spec 焦点在写路径语义）
  const service = new CollabDocumentService(
    { isWritableOrDegraded: () => 'ok', isLeaseServing: () => true } as any,
    { readSnapshotOnly: async () => ({ state: null, updates: [], stateSeq: 0n }) } as any,
  );
  (service as any).withDoc = (_projectId: string, fn: (doc: Y.Doc) => unknown) => fn(doc);
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

describe('CollabDocumentService.writeExecStatus（exec map 服务端唯一写者）', () => {
  it('写 doc.getMap("exec") 的 nodeId 条目（status/jobId/intentId/attempts——Z111 attempts 必填）', async () => {
    const doc = new Y.Doc();
    seedNode(doc);
    const service = buildService(doc);

    await service.writeExecStatus('p1', 'n1', { status: 'loading', jobId: 'j1', intentId: 'i1', attempts: 0 });

    expect(execEntry(doc, 'n1')).toEqual({ status: 'loading', jobId: 'j1', intentId: 'i1', attempts: 0 });
  });

  it('终态防倒退：已 done 再写 loading（同代次）→ 仍 done', async () => {
    const doc = new Y.Doc();
    seedNode(doc);
    const service = buildService(doc);
    await service.writeExecStatus('p1', 'n1', { status: 'done', fileId: 'f1', attempts: 1 });

    await service.writeExecStatus('p1', 'n1', { status: 'loading', jobId: 'j2', attempts: 1 });

    expect(execEntry(doc, 'n1')).toEqual({ status: 'done', fileId: 'f1', attempts: 1 }); // 迟到 loading 零覆盖
  });

  it('error 终态同样防倒退（同代次）', async () => {
    const doc = new Y.Doc();
    seedNode(doc);
    const service = buildService(doc);
    await service.writeExecStatus('p1', 'n1', { status: 'error', error: 'boom', attempts: 1 });

    await service.writeExecStatus('p1', 'n1', { status: 'loading', jobId: 'j2', attempts: 1 });

    expect(execEntry(doc, 'n1')).toEqual({ status: 'error', error: 'boom', attempts: 1 });
  });

  it('节点不存在不建条目（Y0c T11 Z4 存在性守卫——原「异步落地竞态 best-effort 建条目」语义翻转，规格行为变化非测试放松）', async () => {
    const doc = new Y.Doc(); // nodes map 空——无 node 条目
    const service = buildService(doc);

    await service.writeExecStatus('p1', 'ghost', { status: 'loading', jobId: 'j1', attempts: 0 });

    expect(execEntry(doc, 'ghost')).toBeUndefined(); // 不建孤儿条目（改前红=建条目；存量归 sweepOrphanExec 消化）
  });

  it('patch 语义：同 nodeId 第二次写补键不覆盖已有键，undefined 值跳过', async () => {
    const doc = new Y.Doc();
    seedNode(doc);
    const service = buildService(doc);
    await service.writeExecStatus('p1', 'n1', { status: 'loading', jobId: 'j1', attempts: 0 });

    await service.writeExecStatus('p1', 'n1', { status: 'done', error: undefined, fileId: 'f9', attempts: 0 });

    expect(execEntry(doc, 'n1')).toEqual({ status: 'done', jobId: 'j1', fileId: 'f9', attempts: 0 }); // jobId 保留、error 键未写入
  });

  it('skipped 非终态（Z88/Z99）：skipped 后同代次 done 可写', async () => {
    const doc = new Y.Doc();
    seedNode(doc);
    const service = buildService(doc);
    await service.writeExecStatus('p1', 'n1', { status: 'skipped', reason: 'NODE_BUSY', attempts: 1 });

    await service.writeExecStatus('p1', 'n1', { status: 'done', fileId: 'f1', attempts: 1 });

    expect(execEntry(doc, 'n1')!.status).toBe('done'); // skipped 不锁死——在飞 worker 的 done 照常落地
  });
});

describe('Y0b-2 T5：writeExecStatus 守卫代次化 fail-closed（Z99/Z111）', () => {
  it('Z111 缺 attempts 的迟到投影被拦 + exec_projection_dropped_total 计数（改前红=照写）', async () => {
    const doc = new Y.Doc();
    seedNode(doc);
    const service = buildService(doc);
    await service.writeExecStatus('p1', 'n1', { status: 'done', fileId: 'f1', attempts: 1 });
    const before = totalOf(execProjectionDroppedTotal);

    // 违约 patch：无 attempts（运行时构造——类型已必填，防御旧调用方/跨端直构）
    await (service as any).writeExecStatus('p1', 'n1', { status: 'loading', jobId: 'j2' });

    expect(execEntry(doc, 'n1')!.status).toBe('done'); // fail-closed：缺字段即拦
    expect(totalOf(execProjectionDroppedTotal)).toBeGreaterThan(before);
  });

  it('Z99 投影代次化：error(attempt1) → rearm 后 loading/done(attempt2) 可写（改前红=终态一刀切整体吞）', async () => {
    const doc = new Y.Doc();
    seedNode(doc);
    const service = buildService(doc);
    await service.writeExecStatus('p1', 'n1', { status: 'error', errorCode: 'X', error: 'boom', attempts: 1 });

    await service.writeExecStatus('p1', 'n1', { status: 'loading', jobId: 'j2', attempts: 2 });
    expect(execEntry(doc, 'n1')!.status).toBe('loading'); // 新代次可写

    await service.writeExecStatus('p1', 'n1', { status: 'done', fileId: 'f2', attempts: 2 });
    expect(execEntry(doc, 'n1')!.status).toBe('done');
  });

  it('Z111 严格更老一律丢（不看终态）：stored loading(attempts2) 不被老代 error(attempts1) 覆盖 + dropped 计数', async () => {
    const doc = new Y.Doc();
    seedNode(doc);
    const service = buildService(doc);
    await service.writeExecStatus('p1', 'n1', { status: 'loading', jobId: 'j2', attempts: 2 });
    const before = totalOf(execProjectionDroppedTotal);

    await service.writeExecStatus('p1', 'n1', { status: 'error', error: 'stale worker', attempts: 1 });

    expect(execEntry(doc, 'n1')!.status).toBe('loading'); // 老代投影（非终态目标也）不倒退新代
    expect(totalOf(execProjectionDroppedTotal)).toBeGreaterThan(before);
  });

  it('遗留 doc 条目兜底：stored 无 attempts（改动前条目）视作 0 代——请求级 attempts:0 同代不倒退终态、attempts:1 可写', async () => {
    const doc = new Y.Doc();
    seedNode(doc);
    // 直构遗留条目（服务端旧版本写入形态——无 attempts 键）
    doc.getMap('exec').set('n1', new Y.Map(Object.entries({ status: 'done', fileId: 'f0' })));
    const service = buildService(doc);

    await service.writeExecStatus('p1', 'n1', { status: 'loading', attempts: 0 });
    expect(execEntry(doc, 'n1')!.status).toBe('done'); // 0 代不得覆盖任何 ≥1 代；遗留视作 0 ⇒ 同代=终态保持

    await service.writeExecStatus('p1', 'n1', { status: 'loading', attempts: 1 });
    expect(execEntry(doc, 'n1')!.status).toBe('loading'); // 新代可写
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

  it('单写面计数：守卫触发 ⇒ exec_orphan_blocked_total +1（并列投影丢弃全集观测 cause=node-deleted）', async () => {
    const doc = new Y.Doc();
    const service = buildService(doc);
    const before = totalOf(execOrphanBlockedTotal);
    const droppedBefore = totalOf(execProjectionDroppedTotal);

    await service.writeExecStatus('p1', 'ghost', { status: 'done', attempts: 1 });

    expect(totalOf(execOrphanBlockedTotal)).toBe(before + 1);              // Z4 专项信号（改前红=指标不存在）
    expect(totalOf(execProjectionDroppedTotal)).toBe(droppedBefore + 1);   // node-deleted 同时进投影丢弃全集（现有条件自然覆盖）
    expect(execEntry(doc, 'ghost')).toBeUndefined();
  });
});
