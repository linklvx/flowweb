// apps/api/src/modules/collab/media-refs-read.port.ts
// C3a-7（plan v3 Task C3a-7——spec 2026-11-11-foundation-batch-design.md §3.2-4 单写者+命令面两改）：
// BindMedia doc 源节点兜底**窄端口**（第七轮 P1-3——controller 注入端口防 DI 环；适配器=
// CollabDocumentService 读活 doc）。语义：读 (projectId,nodeId) 当前 doc 帧的节点媒体引用集——
//   - 返回 MediaRef[]：节点在 doc（refs 可为空数组=在册零引用——按引用集判归属）；
//   - 返回 null：节点不在 doc（不存在）→controller 分档 400 SOURCE_NODE_MISSING；
//   - 抛 ServiceUnavailableException：lease 失守/维护窗（withSession 受理门）→503 SOURCE_DOC_UNREADABLE。
// 活 doc 读在命令面即时校验**允许**（spec 禁活 doc 的是 inTx 投影/rebuild 路径——本端口只读不写、
// 不进 PG 事务：media-registration 同款纪律「事务内禁外部 IO」，端口调用点在事务之外）。
import { Inject, Injectable } from '@nestjs/common';
import { collectMediaRefsForNode, type MediaRef } from '@flowweb/shared';
import { CollabDocumentService } from './collab-document.service';

/** BindMedia 源配对 doc 兜底腿（pairArtifact 唯一腿的补集——NodeArtifact 行缺时按活 doc 引用集判归属）。 */
export interface MediaRefsReadPort {
  readNodeRefs(projectId: string, nodeId: string): Promise<MediaRef[] | null>;
}

/** DI token（字符串形态——collab-write.port 惯例；测试以 useValue 注入 mock 端口）。 */
export const MEDIA_REFS_READ_PORT = 'MEDIA_REFS_READ_PORT';

/** 适配器：CollabDocumentService.withSession(read) 读活 doc 节点 →collectMediaRefsForNode 单源
 *  （shared media-refs——投影链/命令面同源词表，type 不收窄全词表扫描）。 */
@Injectable()
export class CollabMediaRefsReadAdapter implements MediaRefsReadPort {
  constructor(@Inject(CollabDocumentService) private readonly docs: CollabDocumentService) {}

  async readNodeRefs(projectId: string, nodeId: string): Promise<MediaRef[] | null> {
    return this.docs.withSession(projectId, (doc) => {
      const node = doc.getMap('nodes').get(nodeId);
      return node === undefined ? null : collectMediaRefsForNode(nodeId, node);
    }, { mode: 'read' });
  }
}
