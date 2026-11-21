// apps/api/src/modules/collab/slot-write.port.ts
// Y2 D3t（spec v2.13 §3 D5 ④「槽条件写（withSession 写模式）+行锁后三档」/plan v6 裁决 10）：
// BindMedia 槽条件写**窄端口**——binding controller 现仅注入读端口（media-refs-read.port 头注
// 自述防 DI 环先例），本端口同构：COLLAB_SLOT_WRITE_PORT token+DirectCollabSlotWriteAdapter
// 一行委托 collabDocumentService.withSession(write)（不直接注入 CollabDocumentService）。
//   语义：读 (projectId) 驻留会话同步回调内判槽（data.mediaId）三档——
//   - 槽空 → 才写 data.mediaId；
//   - 槽=本命令已写的 id（跨团队=新行 id/同团队=源 media id——两套比较对象由调用方传入 slotId）→
//     上次崩溃续走：不删对象、按全量快照补绑定、再完成；
//   - 槽=他 id → 409 SLOT_OCCUPIED（跨团队档删已拷新键+deletePending 由调用方在端口外执行——
//     端口只读槽写槽，外部 IO 禁进回调同步段）。
//   回调=**同步段零 await**（withSession transact 语义——SERVER_TRANSACT_ORIGIN 档）；
//   快照=回调内 collectNodeRefsUnion 并集返回值（Y4a T6 spec §0 条 11——节点槽∪timeline clips；
//   修前纯节点槽快照对剪辑节点会盖掉该节点全部片段绑定；与写帧原子——禁写完另开 read 会话）。
//   测试以 useValue 注入 mock 端口（collab-write.port 惯例——真库面在 int spec 直构 controller）。
import { Inject, Injectable } from '@nestjs/common';
import * as Y from 'yjs';
import { collectNodeRefsUnion, type MediaRef } from '@flowweb/shared';
import { CollabDocumentService } from './collab-document.service';

/** 槽条件写三档结果（档位归调用方分诊——本端口只承载读槽/写槽/快照原子面）。 */
export type SlotWriteOutcome = { slot: 'empty' | 'mine' | 'foreign'; snapshot: MediaRef[] };

/** BindMedia 槽条件写端口（驻留会话同步回调内读槽——行锁后三档的比较对象=调用方传入 slotId）。 */
export interface CollabSlotWritePort {
  /** withSession(write) 同步回调：读目标节点 data.mediaId 与 slotId 比对三档；槽空才写 slotId。
   *  返回回调内终态快照（collectNodeRefsUnion 并集——Y4a T6 节点槽∪timeline clips，与写帧原子）。 */
  conditionalWrite(projectId: string, targetNodeId: string, slotId: string): Promise<SlotWriteOutcome>;
}

/** DI token（字符串形态——media-refs-read.port 同款；测试 useValue 注入 mock）。 */
export const COLLAB_SLOT_WRITE_PORT = 'COLLAB_SLOT_WRITE_PORT';

/** 适配器：CollabDocumentService.withSession(write) 一行委托（裁决 10——防 DI 环）。 */
@Injectable()
export class DirectCollabSlotWriteAdapter implements CollabSlotWritePort {
  constructor(@Inject(CollabDocumentService) private readonly docs: CollabDocumentService) {}

  async conditionalWrite(projectId: string, targetNodeId: string, slotId: string): Promise<SlotWriteOutcome> {
    return this.docs.withSession(projectId, (doc): SlotWriteOutcome => {
      // 回调内禁 await（withSession transact 语义——SERVER_TRANSACT_ORIGIN 档）
      const nodes = doc.getMap('nodes');
      const node = nodes.get(targetNodeId);
      const data = node instanceof Y.Map ? node.get('data') : undefined;
      const current = data instanceof Y.Map ? data.get('mediaId') : undefined;
      const slotValue = typeof current === 'string' && current !== '' ? current : null;
      let slot: SlotWriteOutcome['slot'];
      if (slotValue == null) {
        // 槽空 → 才写（目标节点缺 data 容器=空槽同构——随写随建）
        const dataMap: Y.Map<unknown> = data instanceof Y.Map ? data : new Y.Map<unknown>();
        if (!(data instanceof Y.Map)) {
          const nodeMap: Y.Map<unknown> = node instanceof Y.Map ? node : new Y.Map<unknown>();
          if (!(node instanceof Y.Map)) nodes.set(targetNodeId, nodeMap);
          nodeMap.set('data', dataMap);
        }
        dataMap.set('mediaId', slotId);
        slot = 'empty';
      } else if (slotValue === slotId) {
        slot = 'mine';   // 上次崩溃续走——不删对象，快照照收
      } else {
        slot = 'foreign';   // doc 保持对方值——不写
      }
      // Y4a T6：写后快照=并集单源（节点槽∪timeline clips——剪辑节点槽写不清片段绑定）
      return { slot, snapshot: collectNodeRefsUnion(targetNodeId, nodes.get(targetNodeId), doc.getMap('timelines').get(targetNodeId)) };
    }, { mode: 'write' });
  }
}
