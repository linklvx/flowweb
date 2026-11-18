// apps/api/src/modules/collab/author-slot.service.ts
// Y2 B2a（spec D8 服务端腿/plan v6 裁决 11）：两封闭操作逻辑宿主——
//   readAuthorSlot：服务端装意图行核对项目/节点/代际+冻结两列读出+readAuthorSlot 回调只读 Y.Doc；
//   releaseAuthorSlot（v5/v6 顺序钉死）：①withSession 回调〔禁 await〕内现场=冻结值才删该槽键
//   +collectMediaRefsForNode 快照作回调返回值〔与写帧原子〕→②withSession 返回之后、200 之前用快照
//   调 projectBindings（delta 三态；失败同样非 2xx）→③projectBindings 成功后才 UPDATE
//   authorSlotReleased=true（上代置 true 残留=新代释放失败零兜底——B1 rearm 重置闭环）→④投影与
//   置位同一 Prisma 事务、投影在前〔v6——事务原子，提交成功再回 200〕。
//   释放幂等=槽空/别 id 不删但快照照收投影照跑。
//   v6 空槽陷阱：⑴节点剩余引用=0 时 projectBindings 实参=Map{nodeId→[]}（恰一键非空 Map——
//   projector 空 Map 直返零动作，旧绑定钉住旧对象；spec delta 三态「不得省略 nodeId」）；
//   ⑵projectBindings 未被调用（含空 Map 早退/跳过形态）则 authorSlotReleased 不得置 true。
// 槽键=targetFieldOfKind（text→result 无媒体槽——删键面仅 media 槽）；快照单源=collectMediaRefsForNode
// （帧级投影同源——post-delete 终态）。
import { HttpStatus, Injectable, Inject } from '@nestjs/common';
import * as Y from 'yjs';
import { collectMediaRefsForNode, type MediaRef } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { targetFieldOfKind } from '../artifact-core/node-artifact.service';
import { projectBindings, type ProjectionStats } from './media-binding-projector';
import { CollabDocumentService } from './collab-document.service';

/** readAuthorSlot 返回（冻结面只读——worker 侧 B2c/B2d 受理读槽消费）。 */
export interface AuthorSlotRead {
  nodeId: string;
  kind: string;
  frozen: boolean;
  authorMediaId: string | null;
}

/** releaseAuthorSlot 返回（deletedSlot=现场恰冻结值已删；bindingStats=投影统计——事务提交后已落）。 */
export interface AuthorSlotRelease {
  released: true;
  deletedSlot: boolean;
  bindingStats: ProjectionStats;
}

@Injectable()
export class AuthorSlotService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CollabDocumentService) private readonly docs: CollabDocumentService,
  ) {}

  /** 意图行核对（projectId 匹配+行在场）——两封闭操作共用前置。 */
  private async requireIntent(projectId: string, intentRowId: string) {
    const row = await this.prisma.generationIntent.findUnique({
      where: { id: intentRowId },
      select: { projectId: true, nodeId: true, teamId: true, kind: true, authorSlotFrozen: true, authorMediaId: true, authorSlotReleased: true },
    });
    if (!row || row.projectId !== projectId) {
      throw new BusinessException('AUTHOR_SLOT_INTENT_NOT_FOUND', `意图行不存在或项目不符（intentRowId=${intentRowId}）`, HttpStatus.NOT_FOUND);
    }
    return row;
  }

  /** 封闭读：冻结两列读出（行核对+只读——零 doc 写零投影）。 */
  async readAuthorSlot(projectId: string, intentRowId: string): Promise<AuthorSlotRead> {
    const row = await this.requireIntent(projectId, intentRowId);
    return { nodeId: row.nodeId, kind: row.kind, frozen: row.authorSlotFrozen, authorMediaId: row.authorMediaId };
  }

  /** 封闭释放（v5/v6 顺序钉死——头注②③④；快照与写帧原子=withSession 回调内 collect）。 */
  async releaseAuthorSlot(projectId: string, intentRowId: string): Promise<AuthorSlotRelease> {
    const row = await this.requireIntent(projectId, intentRowId);
    const { deletedSlot, snapshot } = await this.docs.withSession(projectId, (doc): { deletedSlot: boolean; snapshot: MediaRef[] } => {
      // 回调内禁 await（withSession 会话语义）——条件删键+终态快照同帧原子
      const field = targetFieldOfKind(row.kind);
      let deletedSlot = false;
      if (field !== 'result') {
        const node = doc.getMap('nodes').get(row.nodeId);
        const data = node instanceof Y.Map ? node.get('data') : undefined;
        if (data instanceof Y.Map && data.get(field) === row.authorMediaId && typeof row.authorMediaId === 'string') {
          data.delete(field);   // 现场=冻结值才删（用户已换=幂等跳过——快照照收现值）
          deletedSlot = true;
        }
      }
      return { deletedSlot, snapshot: collectMediaRefsForNode(row.nodeId, doc.getMap('nodes').get(row.nodeId)) };
    }, { mode: 'write' });   // 写会话（条件删键在帧内——origin 分类面见 residency 头注）
    // ②③④：投影与置位同一事务、投影在前——projectBindings 失败（含其内部错误包装）⇒ 事务回滚
    // released 不落（v6 ⑵）；实参恒 Map{nodeId→快照}（v6 ⑴——剩余引用=0 ⇒ 空数组=清现存行）。
    const bindingStats = await this.prisma.$transaction(async (tx) => {
      const stats = await projectBindings(tx, projectId, row.teamId, new Map([[row.nodeId, snapshot]]));
      await tx.generationIntent.updateMany({ where: { id: intentRowId }, data: { authorSlotReleased: true } });
      return stats;
    });
    return { released: true, deletedSlot, bindingStats };
  }
}
