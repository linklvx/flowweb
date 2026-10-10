// apps/api/src/modules/collab/collab-document.exec-map.spec.ts
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { CollabDocumentService } from './collab-document.service';
import { execProjectionDroppedTotal } from '../execution/exec.metrics';

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

const execEntry = (doc: Y.Doc, nodeId: string): Record<string, unknown> | undefined => {
  const m = doc.getMap('exec').get(nodeId);
  return m instanceof Y.Map ? (m.toJSON() as Record<string, unknown>) : undefined;
};

const totalOf = (m: any): number => Object.values(m.hashMap ?? {}).reduce((s: number, v: any) => s + (v.value ?? 0), 0);

describe('CollabDocumentService.writeExecStatus（exec map 服务端唯一写者）', () => {
  it('写 doc.getMap("exec") 的 nodeId 条目（status/jobId/intentId/attempts——Z111 attempts 必填）', async () => {
    const doc = new Y.Doc();
    const service = buildService(doc);

    await service.writeExecStatus('p1', 'n1', { status: 'loading', jobId: 'j1', intentId: 'i1', attempts: 0 });

    expect(execEntry(doc, 'n1')).toEqual({ status: 'loading', jobId: 'j1', intentId: 'i1', attempts: 0 });
  });

  it('终态防倒退：已 done 再写 loading（同代次）→ 仍 done', async () => {
    const doc = new Y.Doc();
    const service = buildService(doc);
    await service.writeExecStatus('p1', 'n1', { status: 'done', fileId: 'f1', attempts: 1 });

    await service.writeExecStatus('p1', 'n1', { status: 'loading', jobId: 'j2', attempts: 1 });

    expect(execEntry(doc, 'n1')).toEqual({ status: 'done', fileId: 'f1', attempts: 1 }); // 迟到 loading 零覆盖
  });

  it('error 终态同样防倒退（同代次）', async () => {
    const doc = new Y.Doc();
    const service = buildService(doc);
    await service.writeExecStatus('p1', 'n1', { status: 'error', error: 'boom', attempts: 1 });

    await service.writeExecStatus('p1', 'n1', { status: 'loading', jobId: 'j2', attempts: 1 });

    expect(execEntry(doc, 'n1')).toEqual({ status: 'error', error: 'boom', attempts: 1 });
  });

  it('节点不存在仍写 exec 条目（异步落地竞态——best-effort）', async () => {
    const doc = new Y.Doc(); // nodes map 空——无 node 条目
    const service = buildService(doc);

    await service.writeExecStatus('p1', 'ghost', { status: 'loading', jobId: 'j1', attempts: 0 });

    expect(execEntry(doc, 'ghost')).toEqual({ status: 'loading', jobId: 'j1', attempts: 0 });
  });

  it('patch 语义：同 nodeId 第二次写补键不覆盖已有键，undefined 值跳过', async () => {
    const doc = new Y.Doc();
    const service = buildService(doc);
    await service.writeExecStatus('p1', 'n1', { status: 'loading', jobId: 'j1', attempts: 0 });

    await service.writeExecStatus('p1', 'n1', { status: 'done', error: undefined, fileId: 'f9', attempts: 0 });

    expect(execEntry(doc, 'n1')).toEqual({ status: 'done', jobId: 'j1', fileId: 'f9', attempts: 0 }); // jobId 保留、error 键未写入
  });

  it('skipped 非终态（Z88/Z99）：skipped 后同代次 done 可写', async () => {
    const doc = new Y.Doc();
    const service = buildService(doc);
    await service.writeExecStatus('p1', 'n1', { status: 'skipped', reason: 'NODE_BUSY', attempts: 1 });

    await service.writeExecStatus('p1', 'n1', { status: 'done', fileId: 'f1', attempts: 1 });

    expect(execEntry(doc, 'n1')!.status).toBe('done'); // skipped 不锁死——在飞 worker 的 done 照常落地
  });
});

describe('Y0b-2 T5：writeExecStatus 守卫代次化 fail-closed（Z99/Z111）', () => {
  it('Z111 缺 attempts 的迟到投影被拦 + exec_projection_dropped_total 计数（改前红=照写）', async () => {
    const doc = new Y.Doc();
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
    const service = buildService(doc);
    await service.writeExecStatus('p1', 'n1', { status: 'error', errorCode: 'X', error: 'boom', attempts: 1 });

    await service.writeExecStatus('p1', 'n1', { status: 'loading', jobId: 'j2', attempts: 2 });
    expect(execEntry(doc, 'n1')!.status).toBe('loading'); // 新代次可写

    await service.writeExecStatus('p1', 'n1', { status: 'done', fileId: 'f2', attempts: 2 });
    expect(execEntry(doc, 'n1')!.status).toBe('done');
  });

  it('Z111 严格更老一律丢（不看终态）：stored loading(attempts2) 不被老代 error(attempts1) 覆盖 + dropped 计数', async () => {
    const doc = new Y.Doc();
    const service = buildService(doc);
    await service.writeExecStatus('p1', 'n1', { status: 'loading', jobId: 'j2', attempts: 2 });
    const before = totalOf(execProjectionDroppedTotal);

    await service.writeExecStatus('p1', 'n1', { status: 'error', error: 'stale worker', attempts: 1 });

    expect(execEntry(doc, 'n1')!.status).toBe('loading'); // 老代投影（非终态目标也）不倒退新代
    expect(totalOf(execProjectionDroppedTotal)).toBeGreaterThan(before);
  });

  it('遗留 doc 条目兜底：stored 无 attempts（改动前条目）视作 0 代——请求级 attempts:0 同代不倒退终态、attempts:1 可写', async () => {
    const doc = new Y.Doc();
    // 直构遗留条目（服务端旧版本写入形态——无 attempts 键）
    doc.getMap('exec').set('n1', new Y.Map(Object.entries({ status: 'done', fileId: 'f0' })));
    const service = buildService(doc);

    await service.writeExecStatus('p1', 'n1', { status: 'loading', attempts: 0 });
    expect(execEntry(doc, 'n1')!.status).toBe('done'); // 0 代不得覆盖任何 ≥1 代；遗留视作 0 ⇒ 同代=终态保持

    await service.writeExecStatus('p1', 'n1', { status: 'loading', attempts: 1 });
    expect(execEntry(doc, 'n1')!.status).toBe('loading'); // 新代可写
  });
});
