// packages/shared/src/collab/timeline-gate.ts
// Y4a T1（plan 2026-11-20-y4a-timeline-domain Task 1——spec §0 条 1/2）：时间轴撤销闸地基——
// 装回闸常量+两帧量法纯函数（T4 编辑预检/T5 切块预检消费；本文件零 doc 依赖面之外的状态）。
//
// 只量「这一笔自己的两帧」：临时 doc=applyUpdate(encodeStateAsUpdate(live)) 不连 provider、
// applyUpdate 之后任何事务之前 temp.clientID=live.clientID（先设会被 yjs 静默换号——
// transaction.js:357-360：入状态里已有该 clientID 时 applyUpdate 触发 generateNewClientId、
// 量出来的是另一个 client 的帧）、UndoManager 落笔之前挂上且 scope/origin 与 apply 里那笔
// 同构、undo() 后收装回帧。整份 encodeStateAsUpdate 从不作闸（spec §0 条 2——整棵装回写闸
// 有害：切块后无任何用户操作一帧装回整棵、这把尺会把时间轴卡在 ~256KB）。
import * as Y from 'yjs';
import { NORMAL_FRAME_GATE_BYTES } from './doc-protocol';
import { QUOTA_DEFAULTS } from '../constants/collab-quota';
import { UNDO_STACK_BASE } from './undo-policy';

/** 撤销按钮后挡（spec §0 条 1——本批唯一新常量）：undoCanvas/timelineUndo 弹栈前读栈项装回字节
 *  超过即不弹栈保持删除态。只作弹栈挡、不作删除判据（2026-11-21 独立实验：撤销者 clock 越
 *  2^21 实测漂移 +5976——4096 余量被击穿；切块每块预检 262144 距硬闸 256KB 余量盖得住）。 */
export const RESTORE_GATE_BYTES = NORMAL_FRAME_GATE_BYTES - 4096;   // 520_192

/** 切块逆操作预算（spec §0 条 1 软闸同源）：每块正向帧与装回帧任一超过即拒、活文档不写。
 *  初值=QUOTA_DEFAULTS.maxTxBytes（262144）——表征某块超硬闸时下调此预算、只影响切块上限。 */
export const TIMELINE_CHUNK_UNDO_BUDGET = QUOTA_DEFAULTS.maxTxBytes;

/** 量法 options：trackedOrigins 可覆盖（缺省=['local-user']——分割删除/T5 切块预检同域；
 *  T4 量 timeline-user 编辑写时传 UNDO_TIMELINE_ORIGIN）。captureTimeout=0 与三根 scope 固定
 *  （与 apply 里那笔同构——不加更多旋钮）。 */
export interface MeasureTransactionFramesOptions { trackedOrigins?: readonly unknown[] }

/**
 * 两帧量法（纯测量——不写 live）：apply 由调用方组装（T4 编辑事务传 diff 写、T5 切块预检传
 * deleteTimelineClips 同源形式），undoBytes 即该块装回帧。字节=未包装 update byteLength
 * （与 guardSyncFrame payload.byteLength 同口径）。apply 事务未入栈（origin 不在
 * trackedOrigins）时 undo() 无栈项——undoBytes=0、forwardBytes 照量（调用方判域）。
 */
export function measureTransactionFrames(
  live: Y.Doc,
  apply: (temp: Y.Doc) => void,
  opts: MeasureTransactionFramesOptions = {},
): { forwardBytes: number; undoBytes: number } {
  const temp = new Y.Doc();
  Y.applyUpdate(temp, Y.encodeStateAsUpdate(live));
  temp.clientID = live.clientID;   // applyUpdate 之后、任何事务之前——先设会被静默换号
  let forwardBytes = 0;
  let undoBytes = 0;
  let gotForward = false;
  temp.on('update', (update: Uint8Array) => {
    if (!gotForward) { forwardBytes = update.byteLength; gotForward = true; }
    else undoBytes = update.byteLength;
  });
  const um = new Y.UndoManager(
    UNDO_STACK_BASE.map((root) => temp.getMap(root)),
    { captureTimeout: 0, trackedOrigins: new Set(opts.trackedOrigins ?? ['local-user']) },
  );
  try {
    apply(temp);   // 调用方自己的 temp.transact(..., origin)——预检与真删同形态
    um.undo();
  } finally {
    um.destroy();
  }
  return { forwardBytes, undoBytes };
}
