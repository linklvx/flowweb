// apps/api/src/modules/collab/author-slot.service.spec.ts
// Y2 B2a（spec D8 服务端腿/plan v6）：两封闭操作逻辑宿主单测——
//   readAuthorSlot：意图行核对（projectId/nodeId/代际）+冻结两列读出；
//   releaseAuthorSlot（v5/v6 顺序钉死）：①withSession 回调〔禁 await〕条件删键（现场=冻结值才删）
//   +collectMediaRefsForNode 快照作回调返回值〔与写帧原子〕→②withSession 之后 200 之前用快照调
//   projectBindings（delta 三态）→③projectBindings 成功后才 UPDATE authorSlotReleased=true
//   〔顺序钉死：回调删键/幂等跳过→快照→projectBindings→置位→200〕→④投影与置位同一 Prisma 事务、
//   投影在前〔v6〕；释放幂等=槽空/别 id 不删但快照照收投影照跑。
//   v6 空槽陷阱：⑴节点剩余引用=0 时 projectBindings 实参=Map{nodeId→[]}（恰一键非空 Map——
//   projector :86 空 Map 直返零动作，旧绑定钉住旧对象）；⑵projectBindings 未被调用则
//   authorSlotReleased 不得置 true。
// withSession 直投真 Y.Doc 形态照 collab-recovery-import.binding.int.spec 先例（docsStub）。
// 红态=服务不存在（编译级红）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'reflect-metadata';
import * as Y from 'yjs';
import { fillDoc } from '@flowweb/shared';
import { AuthorSlotService } from './author-slot.service';
import { BindingProjectionFailedError, type ProjectionStats } from './media-binding-projector';
import { toDocLike } from './doc-like.util';
import { BusinessException } from '../../common/exceptions/business.exception';

vi.mock('./media-binding-projector', async (orig) => ({
  ...(await orig<typeof import('./media-binding-projector')>()),
  projectBindings: vi.fn(),
}));

import { projectBindings } from './media-binding-projector';

const stats = (written = 0): ProjectionStats => ({ written, skipped: { missing: 0, 'cross-team': 0, 'soft-deleted': 0 } });

/** 意图行（B1 冻结三列在场形态）。 */
const intentRow = (over: Record<string, unknown> = {}) => ({
  id: 'gi-1', projectId: 'p1', nodeId: 'n1', teamId: 't1', kind: 'image', execSeq: 7n,
  authorSlotFrozen: true, authorMediaId: 'm-author', authorSlotReleased: false,
  ...over,
});

/** 真 Y.Doc 装置：n1 携 fileId=m-author（冻结值同值=可删形态）。 */
const mkDoc = (opts: { fileId?: unknown; extraNode?: [string, unknown] } = {}) => {
  const doc = new Y.Doc();
  fillDoc(toDocLike(doc), [
    { id: 'n1', type: 'imageGen', data: { status: 'done', ...(opts.fileId !== undefined ? { fileId: opts.fileId } : { fileId: 'm-author' }) } },
    ...(opts.extraNode ? [{ id: opts.extraNode[0], type: 'imageGen', data: opts.extraNode[1] as Record<string, unknown> }] : []),
  ], []);
  return doc;
};

const mkService = (row: ReturnType<typeof intentRow> | null, doc: Y.Doc) => {
  const prisma: any = {
    generationIntent: { findUnique: vi.fn().mockResolvedValue(row), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  const docs: any = { withSession: vi.fn(async (_pid: string, fn: (d: Y.Doc) => unknown) => fn(doc)) };
  return { svc: new AuthorSlotService(prisma, docs), prisma, docs };
};

describe('Y2 B2a AuthorSlotService（两封闭操作——先红）', () => {
  beforeEach(() => { vi.mocked(projectBindings).mockReset().mockResolvedValue(stats()); });

  describe('readAuthorSlot（行核对+冻结两列读出——只读 Y.Doc 面恒不写）', () => {
    it('行在场且 projectId 匹配 → 返回 {nodeId,kind,frozen,authorMediaId}（零 doc 写）', async () => {
      const doc = mkDoc();
      const { svc } = mkService(intentRow(), doc);
      const r = await svc.readAuthorSlot('p1', 'gi-1');
      expect(r).toMatchObject({ nodeId: 'n1', kind: 'image', frozen: true, authorMediaId: 'm-author' });
    });

    it('行灭失/跨项目 → BusinessException（404 族——禁按空槽放行）', async () => {
      const doc = mkDoc();
      const { svc } = mkService(null, doc);
      await expect(svc.readAuthorSlot('p1', 'gi-x')).rejects.toBeInstanceOf(BusinessException);
      const { svc: svc2 } = mkService(intentRow({ projectId: 'p2' }), doc);
      await expect(svc2.readAuthorSlot('p1', 'gi-1')).rejects.toBeInstanceOf(BusinessException);
    });
  });

  describe('releaseAuthorSlot（v5/v6 顺序：条件删键→快照→投影→置位→200）', () => {
    it('现场=冻结值 → 删该键（data.fileId 键消失）∧ 快照=删后终态（剩余引用照收）∧ 投影在前+置位在后同一事务', async () => {
      const doc = mkDoc({ extraNode: ['n2', { fileId: 'm-other' }] });
      const { svc, prisma } = mkService(intentRow(), doc);
      const order: string[] = [];
      vi.mocked(projectBindings).mockImplementation(async () => { order.push('projectBindings'); return stats(1); });
      prisma.generationIntent.updateMany.mockImplementation(async () => { order.push('released'); return { count: 1 }; });

      const r = await svc.releaseAuthorSlot('p1', 'gi-1');

      expect(r.deletedSlot).toBe(true);
      const data1 = (doc.getMap('nodes').get('n1') as Y.Map<any>).get('data') as Y.Map<any>;
      expect(data1.get('status')).toBe('done');   // 其余键不动
      expect(data1.get('fileId')).toBeUndefined();   // 键删（现场=冻结值）
      expect(order).toEqual(['projectBindings', 'released']);   // ⑵序：投影在前置位在后
      // 快照语义：n1 剩余引用=0 → projectBindings 实参=Map{nodeId→[]}（v6 ⑴——恰一键非空 Map）
      const delta = vi.mocked(projectBindings).mock.calls[0][3] as Map<string, unknown>;
      expect(delta.size).toBe(1);
      expect(delta.get('n1')).toEqual([]);
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'gi-1' }, data: { authorSlotReleased: true } }),
      );
    });

    it('现场≠冻结值（用户已换）→ 不删键（幂等跳过）但快照照收投影照跑+置位照写', async () => {
      const doc = mkDoc({ fileId: 'm-replaced' });
      const { svc, prisma } = mkService(intentRow(), doc);
      const r = await svc.releaseAuthorSlot('p1', 'gi-1');
      expect(r.deletedSlot).toBe(false);
      expect(((doc.getMap('nodes').get('n1') as Y.Map<any>).get('data') as Y.Map<any>).get('fileId')).toBe('m-replaced');   // 不动
      const delta = vi.mocked(projectBindings).mock.calls[0][3] as Map<string, unknown>;
      expect(delta.get('n1')).toEqual([{ nodeId: 'n1', mediaId: 'm-replaced', role: 'primary', targetField: 'fileId', targetItemId: '' }]);   // 现值照收
      expect(prisma.generationIntent.updateMany).toHaveBeenCalled();
    });

    it('projectBindings 失败（BindingProjectionFailedError）→ 非 2xx 上抛 ∧ released 不置位（⑵——updateMany 零调用）', async () => {
      const doc = mkDoc();
      const { svc, prisma } = mkService(intentRow(), doc);
      vi.mocked(projectBindings).mockRejectedValue(new BindingProjectionFailedError('projection failed'));
      await expect(svc.releaseAuthorSlot('p1', 'gi-1')).rejects.toBeInstanceOf(BindingProjectionFailedError);
      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalled();   // 置位被事务回滚（同事务投影在前）
    });

    it('行灭失 → BusinessException 零动作（withSession/projectBindings/updateMany 全零调用）', async () => {
      const doc = mkDoc();
      const { svc, docs } = mkService(null, doc);
      await expect(svc.releaseAuthorSlot('p1', 'gi-x')).rejects.toBeInstanceOf(BusinessException);
      expect(docs.withSession).not.toHaveBeenCalled();
      expect(projectBindings).not.toHaveBeenCalled();
    });
  });
});
