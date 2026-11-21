// apps/web/src/stores/timelineUndo.ts
// Y4a T4（plan 2026-11-20-y4a-timeline-domain Task 4——spec §0 条 1/2/5 + §4）：时间轴撤销闸执行器
// +时间轴栈——两帧量法接入 editorStore 写路径。与 canvasUndo.ts 两域分立（spec §0 条 5：
// 「画布栈和时间轴栈各持各的表」——本模块只持 timeline-user 域装回表，正向表在画布域）：
//  - attachTimelineUndo(nodeId, entry)：scope=[entry]（编辑器打开时绑定当前剪辑节点那棵工程 Map）、
//    trackedOrigins=[UNDO_TIMELINE_ORIGIN]、captureTimeout=UNDO_CAPTURE_TIMEOUT_MS(500)、
//    栈上限 100 同源（undoOverflowAction 溢出=整栈 clear——canvasUndo 同款）；
//  - 两级执行器 executeTimelineCommit/executeTimelineWrite：量法（T1 measureTransactionFrames
//    trackedOrigins=['timeline-user']——正向+逆操作两帧任一超 262144 拒「单次操作过大」live 不写，
//    不调用整棵装回尺）→ live transact 之前对临时 doc 落这笔两级自检（帧 update 跑 validateFrameDeny
//    +物化过的事件跑 validateAppliedL2——只跑帧级不够：改已有键时父项不在本帧 L1 跳过、服务端 L2
//    仍会 4411）→写前栈顶装回预检（标量档——栈顶已记+这笔 undoBytes>RESTORE_GATE_BYTES 先切开）→
//    一条 timeline-user 事务（diff 写——片段/轨道/关键帧增删档与拖动松手档写前后双 stopCapturing
//    每笔成步；标量档窗内合并）；
//  - 片段删除切块算法 chunkClipDeletes/clearAllTimelineClips（spec §0 条 1——按合成帧复测）：
//    ①先按一笔事务量两帧全过则写一笔；②逐片段各做一笔（captureTimeout:0 量法内置）记两帧；
//    ③单片段任一帧>262144 整笔拒绝 live 不动；④贪心装箱候选定下后按合成帧复测（落笔前在临时
//    doc 把这一箱写成一笔、两帧都要≤262144；任一帧超把最后一片移出再量）；⑤候选两帧各跑
//    validateFrameDeny（structs/DS Ranges≤16000——undo 装回帧 struct 密度高一档）；箱间对时间轴
//    栈 stopCapturing；⑥不用 chunkCopyPlan 的 utf8 JSON 预算（消费 yjs 真帧量法）；
//    ⑦切比例不拆多笔（标量档超限=整笔拒绝——executeTimelineCommit scalar 路径无切块退路）；
//  - 捕获策略记账（spec §0 条 5——不实现 openCapture 重放）：stackItemRestoreBytes 记装回字节
//    （itemNeedingBytes 同款回填机制——stack-item-added/updated 在 afterTransaction、doc 'update'
//    在其后；pendingRestoreBytes=本笔预检量的 undoBytes，update 写完立刻清、零帧事务经
//    afterTransaction 无条件清——不挂到下一笔）；undo()/redo() 弹栈后双向抄到新栈项
//    （yjs 每次 new StackItem 非挪对象、不抄=缺失当 0）；
//  - timelineUndo()/timelineRedo()：弹栈前读栈项累计装回字节>RESTORE_GATE_BYTES(520192)→
//    不弹栈+提示「单次操作过大」（撤销按钮后挡——spec §0 条 1 只作弹栈挡）；clearTimelineStackOf：
//    删除事务前清被删节点自己的栈（T5 消费）。
import * as Y from 'yjs';
import {
  UNDO_CAPTURE_TIMEOUT_MS, UNDO_STACK_BASE, UNDO_TIMELINE_ORIGIN,
  RESTORE_GATE_BYTES, TIMELINE_CHUNK_UNDO_BUDGET, undoOverflowAction,
  measureTransactionFrames, diffProjectDataToDoc, deleteTimelineClips,
  validateFrameDeny, validateAppliedL2,
  type ProjectData,
} from '@flowweb/shared';
import { recordRingOnlyCollabDiag } from '@/utils/collabDiagnostics';

/** 捕获档（spec §0 条 5 捕获窗三类）：片段/轨道/关键帧增删=写前后双 stopCapturing 每笔成步；
 *  拖动松手（span 标量整值替换、同一手势）=同款单独成步、不进 500ms 窗；其余标量整值替换=窗内
 *  合并（栈项装回字节=窗内各笔 undoBytes 之和）。 */
export type TimelineCaptureKind = 'structural' | 'scalar' | 'span-gesture';

let timelineUm: Y.UndoManager | null = null;
let timelineNodeId: string | null = null;
let timelineDoc: Y.Doc | null = null;
// doc 引用登记面（editorStore commit 消费——canvasCollabRuntime attach 站点接线；测试可注入）
let registeredDoc: Y.Doc | null = null;

// ── 装回字节表（spec §0 条 5——与 canvasUndo 正向表两域分立）──
const stackItemRestoreBytes = new WeakMap<object, number>();
/** 本笔预检量的 undoBytes（写编排器在 doc.transact 之前登记——update 到达时落到栈项、写完
 *  立刻清；本模块单 origin（timeline-user）与 canvasUndo per-origin map 各持一份）。 */
let pendingRestoreBytes = 0;
/** 待记栈项（stack-item-added/updated 在 afterTransaction 设置——update 到达时回填）。 */
let itemNeedingRestoreBytes: object | null = null;

// doc update/afterTransaction 监听（attach 注册、detach 注销——同 doc 多次 attach 不累积）
let docUpdateHandler: ((u: Uint8Array, origin: unknown) => void) | null = null;
let docAfterTransactionHandler: ((tr: Y.Transaction) => void) | null = null;

export function attachTimelineUndo(nodeId: string, entry: Y.Map<unknown>): Y.UndoManager {
  detachTimelineUndo();
  const doc = entry.doc;
  if (doc == null) throw new Error('timeline-undo-entry-detached');   // 装置契约：entry 集成态
  const um = new Y.UndoManager([entry], {
    trackedOrigins: new Set([UNDO_TIMELINE_ORIGIN]),
    captureTimeout: UNDO_CAPTURE_TIMEOUT_MS,
  });
  timelineUm = um;
  timelineNodeId = nodeId;
  timelineDoc = doc;
  // 装回表回填（canvasUndo :24-26 配对序同款——stack-item-added/updated 在 afterTransaction、
  // doc 'update' 在其后同事务 cleanup；undoBytes 落到对应栈项=「只有本笔确实发出 update 才加」）
  docUpdateHandler = (_u: Uint8Array, origin: unknown) => {
    if (origin !== UNDO_TIMELINE_ORIGIN) return;
    if (itemNeedingRestoreBytes != null && pendingRestoreBytes > 0) {
      stackItemRestoreBytes.set(
        itemNeedingRestoreBytes,
        (stackItemRestoreBytes.get(itemNeedingRestoreBytes) ?? 0) + pendingRestoreBytes,
      );
      itemNeedingRestoreBytes = null;
    }
    pendingRestoreBytes = 0;   // update 写完立刻清——下一笔不继承
  };
  // 零帧事务清挂（spec §0 条 5——删除缺 id/空片段列表这类事务不发 update；afterTransaction 在
  // update 之前跑——以「事务确实零内容」判定：changed/deleteSet 皆空=update 必不发，此时清挂）
  docAfterTransactionHandler = (tr: Y.Transaction) => {
    if (tr.origin !== UNDO_TIMELINE_ORIGIN) return;
    if (tr.changed.size === 0 && tr.deleteSet.clients.size === 0) pendingRestoreBytes = 0;
  };
  doc.on('update', docUpdateHandler);
  doc.on('afterTransaction', docAfterTransactionHandler);
  um.on('stack-item-added', ({ stackItem, origin, type }) => {
    if (origin === UNDO_TIMELINE_ORIGIN) itemNeedingRestoreBytes = stackItem;
    // 栈上限 100 同源（undoOverflowAction——溢出=整栈 clear，canvasUndo 同款诚实语义）
    if (type === 'undo' && undoOverflowAction(um.undoStack.length) === 'clear-whole-stack') um.clear();
  });
  um.on('stack-item-updated', ({ stackItem, origin }) => {
    if (origin === UNDO_TIMELINE_ORIGIN) itemNeedingRestoreBytes = stackItem;   // 标量窗内合并档增量累加点
  });
  return um;
}

export function detachTimelineUndo(): void {
  if (timelineDoc != null) {
    if (docUpdateHandler != null) timelineDoc.off('update', docUpdateHandler);
    if (docAfterTransactionHandler != null) timelineDoc.off('afterTransaction', docAfterTransactionHandler);
  }
  // Y4a T7（spec §0 条 7）：先 clear() 再 destroy——重绑/键删除路径卸栈时两向栈全清（旧
  // UndoManager 若保留栈项，外部持有的引用仍可对已脱离父键的 Map 发起 undo——clear 断这条路）。
  timelineUm?.clear();
  timelineUm?.destroy();
  timelineUm = null;
  timelineNodeId = null;
  timelineDoc = null;
  docUpdateHandler = null;
  docAfterTransactionHandler = null;
  pendingRestoreBytes = 0;
  itemNeedingRestoreBytes = null;
}

export function timelineStopCapturing(): void {
  timelineUm?.stopCapturing();
}

export function getTimelineUndoManager(): Y.UndoManager | null {
  return timelineUm;
}

/** 装回字节读（测试/诊断观测面——缺失当 0 与消费面同口径）。 */
export function getStackItemRestoreBytes(item: object): number {
  return stackItemRestoreBytes.get(item) ?? 0;
}

/** 低级登记面：写编排器在 doc.transact 之前登记本笔预检量的 undoBytes（executeTimelineCommit
 *  内部同款消费；零帧事务的挂账由 afterTransaction 清——不落到下一笔）。 */
export function setPendingTimelineRestoreBytes(undoBytes: number): void {
  pendingRestoreBytes = undoBytes;
}

/** 撤销按钮（PreviewPlayer 接线=T11）：弹栈前读栈项累计装回字节>RESTORE_GATE_BYTES→不弹栈
 *  保持删除态提示「单次操作过大」（spec §0 条 1——只作弹栈挡）；弹栈后装回字节抄到新 redo
 *  栈项（undo() 每次 new StackItem 非挪对象——不抄=缺失当 0）。 */
export function timelineUndo(): boolean {
  const um = timelineUm;
  if (!um || um.undoStack.length === 0) return false;
  const srcItem = um.undoStack[um.undoStack.length - 1]!;
  const srcRestore = stackItemRestoreBytes.get(srcItem);
  if (srcRestore != null && srcRestore > RESTORE_GATE_BYTES) {
    recordRingOnlyCollabDiag('write_reject', { reason: 'tx-too-large', via: 'timeline-undo-restore-gate' });
    void import('antd').then(({ message }) => { message.warning('单次操作过大'); });
    return false;
  }
  um.undo();
  const redoItem = um.redoStack[um.redoStack.length - 1];
  if (redoItem != null && srcRestore != null) stackItemRestoreBytes.set(redoItem, srcRestore);
  return true;
}

/** 重做按钮：软限额预检同构 redoCanvas（redo=再删一次——写入端软闸 262144 已同源保证回放帧不超，
 *  装回字节跟随 redo 项无独立闸面）；redo 弹栈后装回字节抄回新 undo 项（双向抄——spec §0 条 5）。 */
export function timelineRedo(): boolean {
  const um = timelineUm;
  if (!um || um.redoStack.length === 0) return false;
  const srcItem = um.redoStack[um.redoStack.length - 1]!;
  const srcRestore = stackItemRestoreBytes.get(srcItem);
  um.redo();
  const newUndoItem = um.undoStack[um.undoStack.length - 1];
  if (newUndoItem != null && srcRestore != null) stackItemRestoreBytes.set(newUndoItem, srcRestore);
  return true;
}

/** 删除事务前清被删节点自己的时间轴栈（spec §0 条 6——T5 消费：拖动覆盖层作废+栈卸下；
 *  节点重新出现后编辑器重新 attach、时间轴栈从空栈开始）。他节点 id=本栈不是它的——no-op。 */
export function clearTimelineStackOf(nodeId: string): void {
  if (timelineNodeId === nodeId) detachTimelineUndo();
}

// ── doc 引用登记面（canvasCollabRuntime attach 站点接线——editorStore.commit 消费）──

export function setTimelineDocRef(doc: Y.Doc | null): void {
  registeredDoc = doc;
}

export function getTimelineDocRef(): Y.Doc | null {
  return registeredDoc;
}

// ── 两级执行器（量法前置+临时 doc 自检+写前栈顶装回预检+捕获编排）──

/** 量法装置自用帧（保留两帧字节——validateFrameDeny 消费；measureTransactionFrames 只返回数字）。 */
interface ChunkFrames { forwardBytes: number; undoBytes: number; forwardFrame: Uint8Array | null; undoFrame: Uint8Array | null }

/** 「单次操作过大」提示（拒绝共用——antd 动态 import 保测试重量隔离，canvasUndo 同款纪律）。 */
function rejectTooLarge(via: string): void {
  recordRingOnlyCollabDiag('write_reject', { reason: 'tx-too-large', via });
  void import('antd').then(({ message }) => { message.warning('单次操作过大'); });
}

/** 两帧量法+帧字节保留（与 measureTransactionFrames 同装置——applyUpdate 之后 temp.clientID=
 *  live.clientID、UndoManager pre-attached scope=UNDO_STACK_BASE、undo() 后收装回帧）。
 *  Y4a T5：trackedOrigins 取 measureOrigin（T5 分割删除传 local-user——量法与真删同 origin 同构）。 */
function measureChunkFrames(live: Y.Doc, apply: (temp: Y.Doc) => void, measureOrigin: unknown = UNDO_TIMELINE_ORIGIN): ChunkFrames {
  const temp = new Y.Doc();
  Y.applyUpdate(temp, Y.encodeStateAsUpdate(live));
  temp.clientID = live.clientID;   // applyUpdate 之后、任何事务之前——先设会被静默换号
  // 帧捕获经容器字段（闭包内赋值——TS 控制流对 captured let 的 null 缩窄在闭包外误判 never）
  const frames: { forward: Uint8Array | null; undo: Uint8Array | null } = { forward: null, undo: null };
  let gotForward = false;
  temp.on('update', (u: Uint8Array) => {
    if (!gotForward) { frames.forward = u; gotForward = true; }
    else frames.undo = u;
  });
  const um = new Y.UndoManager(
    UNDO_STACK_BASE.map((root) => temp.getMap(root)),
    { captureTimeout: 0, trackedOrigins: new Set([measureOrigin]) },
  );
  try {
    apply(temp);
    um.undo();
  } finally {
    um.destroy();
  }
  const forward: Uint8Array | null = frames.forward;
  const undo: Uint8Array | null = frames.undo;
  return {
    forwardBytes: forward?.byteLength ?? 0,
    undoBytes: undo?.byteLength ?? 0,
    forwardFrame: forward,
    undoFrame: undo,
  };
}

/** 两帧各跑 validateFrameDeny（spec §0 条 1 ⑤——undo 装回帧 struct 密度高一档；帧缺失=零内容面跳过）。 */
function framesPassDeny(m: ChunkFrames): boolean {
  for (const f of [m.forwardFrame, m.undoFrame]) {
    if (f == null) continue;
    if (!validateFrameDeny(f).ok) return false;
  }
  return true;
}

/** live transact 之前的两级自检（brief：那一帧 update 跑 validateFrameDeny+物化过的事件跑
 *  validateAppliedL2——失败 live 不写。事件在观察者回调内物化 ev.changes（事务后读=Yjs 抛
 *  errorComputeChanges）；timelines 根身份=安装观察者时那棵（validateAppliedL2 内部 getMap
 *  同名根同一对象——spec §0 条 7）。 */
function selfCheckOnTempDoc(
  live: Y.Doc,
  buildOps: (timelines: Y.Map<unknown>) => Array<(tx: Y.Transaction) => void>,
): boolean {
  const temp = new Y.Doc();
  Y.applyUpdate(temp, Y.encodeStateAsUpdate(live));
  temp.clientID = live.clientID;
  let frame: Uint8Array | null = null;
  const events: Array<Y.YEvent<never>> = [];
  const timelinesTemp = temp.getMap('timelines');
  timelinesTemp.observeDeep((evs) => {
    for (const e of evs) { void e.changes; events.push(e as Y.YEvent<never>); }   // 物化 ev.changes——含 set-new-Map-on-existing-key 结构拒绝面（previous 比对）
  });
  temp.on('update', (u: Uint8Array) => { if (frame === null) frame = u; });
  temp.transact((tx) => { for (const op of buildOps(timelinesTemp)) op(tx); }, UNDO_TIMELINE_ORIGIN);
  const deny = frame != null ? validateFrameDeny(frame) : { ok: true as const };
  const l2 = validateAppliedL2(temp, events);
  temp.destroy();
  if (!deny.ok) {
    recordRingOnlyCollabDiag('write_reject', { reason: 'timeline-selfcheck-l1', via: 'timeline-commit' });
    return false;
  }
  if (!l2.ok) {
    recordRingOnlyCollabDiag('write_reject', { reason: `timeline-selfcheck-l2:${l2.reason}`, via: 'timeline-commit' });
    return false;
  }
  return true;
}

/** 一条 timeline-user 事务（捕获档编排+pending 登记）。预检量 m 由调用方跑过（预检与入栈同一个数）。 */
function writeTransaction(
  doc: Y.Doc,
  buildOps: (timelines: Y.Map<unknown>) => Array<(tx: Y.Transaction) => void>,
  kind: TimelineCaptureKind,
  undoBytes: number,
): void {
  if (kind !== 'scalar') timelineStopCapturing();   // structural/span-gesture：写前切
  pendingRestoreBytes = undoBytes;
  doc.transact((tx) => {
    for (const op of buildOps(doc.getMap('timelines'))) op(tx);
  }, UNDO_TIMELINE_ORIGIN);
  if (kind !== 'scalar') timelineStopCapturing();   // 写后切——下一笔不并入
}

/** 两级执行器（ops 形态——量法/自检/预检/事务一条龙）。零帧（幂等空 ops）返回 true 无可写。
 *  软闸 262144（spec §0 条 1）：两帧任一超=拒「单次操作过大」live 不写、不调用整棵装回尺。
 *  评审回包 M#4：nodeId 死参清除（buildOps 闭包携带——外部无需再传）。 */
export function executeTimelineWrite(
  doc: Y.Doc,
  buildOps: (timelines: Y.Map<unknown>) => Array<(tx: Y.Transaction) => void>,
  kind: TimelineCaptureKind,
): boolean {
  const m = measureTransactionFrames(doc, (temp) => {
    temp.transact((tx) => { for (const op of buildOps(temp.getMap('timelines'))) op(tx); }, UNDO_TIMELINE_ORIGIN);
  }, { trackedOrigins: [UNDO_TIMELINE_ORIGIN] });
  if (m.forwardBytes === 0) return true;   // 零帧（幂等空 ops）——无可写
  if (m.forwardBytes > TIMELINE_CHUNK_UNDO_BUDGET || m.undoBytes > TIMELINE_CHUNK_UNDO_BUDGET) {
    rejectTooLarge('timeline-commit');
    return false;
  }
  if (!selfCheckOnTempDoc(doc, buildOps)) return false;
  // 写前栈顶装回预检（标量档——spec §0 条 5：栈顶已记+这笔 undoBytes>RESTORE_GATE_BYTES 先切开）
  if (kind === 'scalar') {
    const um = timelineUm;
    const top = um?.undoStack[um.undoStack.length - 1];
    if (top != null && (stackItemRestoreBytes.get(top) ?? 0) + m.undoBytes > RESTORE_GATE_BYTES) timelineStopCapturing();
  }
  writeTransaction(doc, buildOps, kind, m.undoBytes);
  return true;
}

/** 两级执行器（diff 形态——editorStore.commit 消费）：before/after 两份 ProjectData 结构 diff
 *  只改碰到的键。structural 档超限时走片段删除切块算法（spec §0 条 1——删集切箱+尾笔小事务）；
 *  无删集可切=整笔拒绝；scalar/span-gesture 档超限=整笔拒绝（切比例不拆多笔——算法 ⑦）。
 *  评审回包 I#1 复合原子性：全部切块计划/拒绝**先行**（测量全在 temp doc 非突变）——计划过闸
 *  后 rest 才落笔、再逐箱落笔；任一拒绝点返回 false 时 live doc 一笔未写（修前 rest 先写、
 *  切块 ③ 拒后孤片段悬挂已删轨）。 */
export function executeTimelineCommit(
  doc: Y.Doc,
  plan: { nodeId: string; before: ProjectData; after: ProjectData; kind: TimelineCaptureKind },
): boolean {
  const { nodeId, before, after, kind } = plan;
  const buildOps = (timelines: Y.Map<unknown>) => diffProjectDataToDoc(timelines, nodeId, before, after);
  const m = measureTransactionFrames(doc, (temp) => {
    temp.transact((tx) => { for (const op of buildOps(temp.getMap('timelines'))) op(tx); }, UNDO_TIMELINE_ORIGIN);
  }, { trackedOrigins: [UNDO_TIMELINE_ORIGIN] });
  if (m.forwardBytes === 0) return true;   // 幂等空 diff——无可写
  if (m.forwardBytes <= TIMELINE_CHUNK_UNDO_BUDGET && m.undoBytes <= TIMELINE_CHUNK_UNDO_BUDGET) {
    if (!selfCheckOnTempDoc(doc, buildOps)) return false;
    if (kind === 'scalar') {
      const um = timelineUm;
      const top = um?.undoStack[um.undoStack.length - 1];
      if (top != null && (stackItemRestoreBytes.get(top) ?? 0) + m.undoBytes > RESTORE_GATE_BYTES) timelineStopCapturing();
    }
    writeTransaction(doc, buildOps, kind, m.undoBytes);
    return true;
  }
  // 超限：scalar/span-gesture=整笔拒绝（无切块退路——切比例不拆多笔）
  if (kind !== 'structural') {
    rejectTooLarge('timeline-commit');
    return false;
  }
  // structural 超限→片段删除切块算法：删集（before 有 after 无的片段键）切箱、其余 ops 尾笔小事务
  const deletedClipIds = Object.keys(before.clips).filter((id) => !(id in after.clips));
  if (deletedClipIds.length === 0) {
    rejectTooLarge('timeline-commit');   // 无删集可切（纯增/纯改超限）——整笔拒 live 不动
    return false;
  }
  // I#1 计划先行：切块计划全在 temp doc 上量（零突变）——任一拒绝点（①deny/③单片段超/④b deny）
  // 在 rest 落笔**之前**整笔返回 false（live 一笔未写）
  const chunkPlan = planClipDeletes(doc, nodeId, deletedClipIds);
  if (chunkPlan === null) return false;
  // 尾笔：按 after 的轨道/标量形态落（clips 保持 before——片段键由下面的切块计划收走）
  const afterRest: ProjectData = { ...after, clips: before.clips };
  const restOk = executeTimelineWrite(doc, (timelines) =>
    diffProjectDataToDoc(timelines, nodeId, before, afterRest), 'structural');
  if (!restOk) return false;   // 尾笔也超（防御——轨道侧超大）整笔拒（尾笔未写：executeTimelineWrite 原子）
  // 计划已过闸——逐箱落笔（每箱一条事务、箱间 stopCapturing、pending=该箱预检 undoBytes）
  for (const box of chunkPlan) writeChunk(doc, nodeId, box.ids, box.undoBytes);
  return true;
}

// ── 片段删除切块算法（spec §0 条 1——按合成帧复测）──

/** 已过闸切块计划（I#1 拆相——计划全在 temp doc 上量、落笔由调用方编排）。 */
export interface PlannedBox { ids: string[]; undoBytes: number }

/** 逐片段删除切块**计划**（纯测量零突变——live 不落笔）：
 *  ①一笔量两帧全过则单箱计划；②逐片段各做一笔（captureTimeout:0 量法内置）记两帧；
 *  ③单片段任一帧>262144 整笔拒绝（null）；④按逐片段字节贪心装箱+每箱落笔前合成帧复测
 *  （在临时 doc 把这一箱写成一笔量两帧、任一帧超把最后一片移出再量——移出片自成箱单测必过）；
 *  ⑤每箱两帧各跑 validateFrameDeny；任一环节拒=null（live 一笔不写）。
 *  评审回包 I#1：计划先行原子性——复合笔（rest+切块）先调本计划、过闸后 rest/箱才落笔。
 *  Y4a T5（spec §0 条 3 同源复用）：导出+measureOrigin 形参——T5 分割删除消费同一计划规则、
 *  落笔 origin=local-user（进画布栈——块写入由调用方编排，T4 本模块写 timeline-user 不变）。 */
export function planClipDeletes(
  doc: Y.Doc,
  nodeId: string,
  clipIds: readonly string[],
  measureOrigin: unknown = UNDO_TIMELINE_ORIGIN,
): PlannedBox[] | null {
  if (clipIds.length === 0) return [];
  const del = (ids: readonly string[]) => (temp: Y.Doc) => deleteTimelineClips(temp, nodeId, ids, measureOrigin);
  // ① 一笔量两帧——全过则单箱
  const single = measureChunkFrames(doc, del(clipIds), measureOrigin);
  if (single.forwardBytes === 0) return [];   // 已空（幂等）
  if (single.forwardBytes <= TIMELINE_CHUNK_UNDO_BUDGET && single.undoBytes <= TIMELINE_CHUNK_UNDO_BUDGET) {
    if (!framesPassDeny(single)) {
      recordRingOnlyCollabDiag('write_reject', { reason: 'timeline-chunk-deny', via: 'timeline-commit' });
      return null;
    }
    return [{ ids: [...clipIds], undoBytes: single.undoBytes }];
  }
  // ② 逐片段各做一笔——记每片段正向字节与逆操作字节
  const perClip = clipIds.map((id) => {
    const c = measureChunkFrames(doc, del([id]), measureOrigin);
    return { id, forwardBytes: c.forwardBytes, undoBytes: c.undoBytes };
  });
  // ③ 单片段任一帧>262144：整笔拒绝 live doc 不动
  for (const c of perClip) {
    if (c.forwardBytes > TIMELINE_CHUNK_UNDO_BUDGET || c.undoBytes > TIMELINE_CHUNK_UNDO_BUDGET) {
      rejectTooLarge('timeline-chunk');
      return null;
    }
  }
  // ④ 按逐片段字节贪心装箱（近似候选——装回帧主导取两帧较大者保守）
  const candidateBoxes: string[][] = [];
  let cur: string[] = [];
  let curBytes = 0;
  for (const c of perClip) {
    const b = Math.max(c.forwardBytes, c.undoBytes);
    if (cur.length > 0 && curBytes + b > TIMELINE_CHUNK_UNDO_BUDGET) {
      candidateBoxes.push(cur);
      cur = []; curBytes = 0;
    }
    cur.push(c.id);
    curBytes += b;
  }
  if (cur.length > 0) candidateBoxes.push(cur);
  // ④b+⑤ 候选箱落笔前合成帧复测（真写成一笔量两帧——任一帧超把最后一片移出再量、移出片自成箱）
  // +每箱两帧各跑 validateFrameDeny——全部定下后才交由调用方落笔
  const planned: PlannedBox[] = [];
  const queue = [...candidateBoxes];
  while (queue.length > 0) {
    let ids = queue.shift()!;
    let m = measureChunkFrames(doc, del(ids), measureOrigin);
    while ((m.forwardBytes > TIMELINE_CHUNK_UNDO_BUDGET || m.undoBytes > TIMELINE_CHUNK_UNDO_BUDGET) && ids.length > 1) {
      const dropped = ids[ids.length - 1]!;
      ids = ids.slice(0, -1);   // 超了把最后一片移出再量
      queue.unshift([dropped]);   // 移出片自成箱（③保证单片两帧≤262144——下轮复测必过）
      m = measureChunkFrames(doc, del(ids), measureOrigin);
    }
    if (m.forwardBytes > TIMELINE_CHUNK_UNDO_BUDGET || m.undoBytes > TIMELINE_CHUNK_UNDO_BUDGET) {
      rejectTooLarge('timeline-chunk');   // 单片仍超——③ 防御再拦（理论不可达）
      return null;
    }
    if (!framesPassDeny(m)) {
      recordRingOnlyCollabDiag('write_reject', { reason: 'timeline-chunk-deny', via: 'timeline-commit' });
      return null;
    }
    planned.push({ ids, undoBytes: m.undoBytes });
  }
  return planned;
}

/** 逐片段删除切块（计划+落笔一体——单入口消费面）：计划全在 temp doc 上量（零突变），
 *  过闸后才逐箱写活文档；任一拒绝点=live 一笔不写。 */
export function chunkClipDeletes(doc: Y.Doc, nodeId: string, clipIds: readonly string[]): boolean {
  const planned = planClipDeletes(doc, nodeId, clipIds);
  if (planned === null) return false;
  for (const box of planned) writeChunk(doc, nodeId, box.ids, box.undoBytes);
  return true;
}

/** 一箱一笔（箱间 stopCapturing——每箱单独成栈项、栈项装回字节=这箱 undoBytes）。 */
function writeChunk(doc: Y.Doc, nodeId: string, ids: readonly string[], undoBytes: number): void {
  timelineStopCapturing();   // 写前切
  pendingRestoreBytes = undoBytes;
  deleteTimelineClips(doc, nodeId, ids, UNDO_TIMELINE_ORIGIN);   // 恰一次最外层事务（shared 原语）
  timelineStopCapturing();   // 写后切
}

/** 清空一棵时间轴的片段（切块算法入口——大时间轴单笔超限时逐箱清空）。 */
export function clearAllTimelineClips(doc: Y.Doc, nodeId: string): boolean {
  const entry = doc.getMap('timelines').get(nodeId);
  if (!(entry instanceof Y.Map)) return true;   // 无工程键=已空（幂等成功）
  const clips = entry.get('clips');
  if (!(clips instanceof Y.Map)) return true;   // 毒值时间轴不炸（clips 非 Map）——无可清
  const clipIds = [...clips.keys()];
  if (clipIds.length === 0) return true;
  return chunkClipDeletes(doc, nodeId, clipIds);
}
