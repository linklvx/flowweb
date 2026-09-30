// apps/api/src/modules/collab/collab-document.exec-map.spec.ts
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { CollabDocumentService } from './collab-document.service';

/** B2/F2 批0.5-5：exec map 服务端唯一写者。真 Y.Doc 直驱——
 *  mock withDoc 直接执行回调传 doc（gateway 直连细节与本任务无关）。 */
function buildService(doc: Y.Doc): CollabDocumentService {
  const service = new CollabDocumentService({} as any);
  (service as any).withDoc = (_projectId: string, fn: (doc: Y.Doc) => unknown) => fn(doc);
  return service;
}

const execEntry = (doc: Y.Doc, nodeId: string): Record<string, unknown> | undefined => {
  const m = doc.getMap('exec').get(nodeId);
  return m instanceof Y.Map ? (m.toJSON() as Record<string, unknown>) : undefined;
};

describe('CollabDocumentService.writeExecStatus（exec map 服务端唯一写者）', () => {
  it('写 doc.getMap("exec") 的 nodeId 条目（status/jobId/intentId）', async () => {
    const doc = new Y.Doc();
    const service = buildService(doc);

    await service.writeExecStatus('p1', 'n1', { status: 'loading', jobId: 'j1', intentId: 'i1' });

    expect(execEntry(doc, 'n1')).toEqual({ status: 'loading', jobId: 'j1', intentId: 'i1' });
  });

  it('终态防倒退：已 done 再写 loading → 仍 done', async () => {
    const doc = new Y.Doc();
    const service = buildService(doc);
    await service.writeExecStatus('p1', 'n1', { status: 'done', fileId: 'f1' });

    await service.writeExecStatus('p1', 'n1', { status: 'loading', jobId: 'j2' });

    expect(execEntry(doc, 'n1')).toEqual({ status: 'done', fileId: 'f1' }); // 迟到 loading 零覆盖
  });

  it('error 终态同样防倒退', async () => {
    const doc = new Y.Doc();
    const service = buildService(doc);
    await service.writeExecStatus('p1', 'n1', { status: 'error', error: 'boom' });

    await service.writeExecStatus('p1', 'n1', { status: 'loading', jobId: 'j2' });

    expect(execEntry(doc, 'n1')).toEqual({ status: 'error', error: 'boom' });
  });

  it('节点不存在仍写 exec 条目（异步落地竞态——best-effort）', async () => {
    const doc = new Y.Doc(); // nodes map 空——无 node 条目
    const service = buildService(doc);

    await service.writeExecStatus('p1', 'ghost', { status: 'loading', jobId: 'j1' });

    expect(execEntry(doc, 'ghost')).toEqual({ status: 'loading', jobId: 'j1' });
  });

  it('patch 语义：同 nodeId 第二次写补键不覆盖已有键，undefined 值跳过', async () => {
    const doc = new Y.Doc();
    const service = buildService(doc);
    await service.writeExecStatus('p1', 'n1', { status: 'loading', jobId: 'j1' });

    await service.writeExecStatus('p1', 'n1', { status: 'done', error: undefined, fileId: 'f9' });

    expect(execEntry(doc, 'n1')).toEqual({ status: 'done', jobId: 'j1', fileId: 'f9' }); // jobId 保留、error 键未写入
  });
});
