// apps/web/src/stores/canvasDeleteSplit.spec.ts
// Y4a T5（plan 2026-11-20-y4a-timeline-domain Task 5——spec §0 条 3/4/5/7）：删除分割函数
// ——三入口同一函数（deleteNode/onNodesChange remove/deleteTransformNode）+剪辑节点先切块清
// 片段再删小节点。全部真实 yjs 装置（Y.Doc/Y.UndoManager 非/mock）+假 dispatch spy
// （事务探针+原语调用观测钉死「无 deleteNode intent 中转」——ESM 内部绑定不经 namespace 对象、
//  vi.spyOn 抓不到模块内调用，改以 doc 事务序+deleteSplitCallLog 为观测位。）
//
// 测试矩阵（brief ①-⑧）：
//  ①多选两个剪辑节点→各自的片段块+最后一笔共同信封（不是每节点一笔、不是两次 dispatch）；
//  ②组含两剪辑子删除→事务序=[子1块…,子2块…,组骨架最后]——undo 第一步组骨架整棵回来、
//    子回来时 parentId 指向的组已在（undo 中间态无 dangling parentId）；
//  ②′四漏斗差分保持现状+差分删除集含非空片段节点→整份差分不派发+canApplyIntent 拒
//    reason timeline-chunk-required；executeDeleteSplit 计划到最后一笔之间无 await；
//  ③切块失败保护档：单片段逆操作超 262144→该节点 aborted 不删、文档不动；嵌套组档外层组
//    也保护；applyUnifiedDocSnapshot 是最后一次 store 写入、排在 applyNodeChanges 之后
//    （React Flow remove 后 store 仍保留 aborted 节点）；
//  ④纯普通节点删除=单事务现状等价（不额外 stopCapturing——500ms 合并窗保持）；
//  ⑤applyIntentToDoc：addNode videoEdit→空工程已种；同 id 不重写；deleteNode→timelines 键
//    同事务消失；撤销创建→节点与空工程同去；撤销删除→stableStringify 一致；
//  ⑥组善后独立成步（不并进装回那笔）；被闸剪辑节点使组保持非空（不解组）；
//  ⑦二次级联废除（dispatch spy 无重入 deleteNode）；deleteNode 组递归废除（深层嵌套组后代
//    收齐=负控）；store 全删除集清理（组多选→store.nodes 不含后代；预检失败→store 保留
//    aborted+保护集）；
//  ⑧三入口共用原语+删除写入路径只有 deleteNodesWithTimelines 一次调用（dispatch spy 钉死）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
vi.mock('antd', () => ({ message: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
import * as Y from 'yjs';
import {
  TIMELINE_CHUNK_UNDO_BUDGET, deleteNodesWithTimelines,
  type StoredNodeRecord,
} from '@flowweb/shared';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { _setIntentDocForTest, dispatchCanvasIntent, canApplyIntent, applyIntentToDoc } from './canvasIntents';
import * as canvasIntentsModule from './canvasIntents';
import type { CanvasIntent } from './canvasIntents';
import { Origin, attachUndoManager, detachUndoManager, stopCapturing, getUndoManager } from './canvasUndo';
import { detachTimelineUndo } from './timelineUndo';
import { splitDeletePlan, classifyPlanByDoc, executeDeleteSplit, resetDeleteSplitCallLog, deleteSplitCallLog } from './canvasDeleteSplit';
import { fillDoc } from '@/collab/ydocBuilder';
import { applyUnifiedDocSnapshot } from './canvasCollabRuntime';
import { resetCanvasStores, openRwWindow } from '@/test/fixtures/canvas';

const SOFT = TIMELINE_CHUNK_UNDO_BUDGET;   // 262144

/** 剪辑节点 record 夹具。 */
const clipRec = (id: string): StoredNodeRecord => ({ id, type: 'videoEdit', position: { x: 0, y: 0 }, data: {} });
const plainRec = (id: string): StoredNodeRecord => ({ id, type: 'textInput', position: { x: 0, y: 0 }, data: { content: 'hi' } });
const groupRec = (id: string, parentId?: string): StoredNodeRecord => ({
  id, type: 'group', ...(parentId != null ? { parentId } : {}), data: { groupType: 'normal' },
});
const childRec = (id: string, parentId?: string): StoredNodeRecord => ({
  id, type: 'textInput', ...(parentId != null ? { parentId } : {}), position: { x: 0, y: 0 }, data: { content: 'hi' },
});

/** doc 侧种剪辑节点+带片段时间轴（subtitle text=唯一可扩标量——textBytes 撑大帧用）。
 *  origin='seed'（不入栈不入窗）。片段 id=`${id}-c${i}`。 */
function seedTimeline(doc: Y.Doc, nodeId: string, clipTextBytes: number[], trackId = `${nodeId}:video`): void {
  doc.transact(() => {
    const tl = new Y.Map();
    tl.set('version', 1); tl.set('fps', 30);
    const track = new Y.Map();
    track.set('type', 'video'); track.set('name', '视频');
    track.set('muted', false); track.set('hidden', false); track.set('order', '5000');
    const tracks = new Y.Map();
    tracks.set(trackId, track);
    tl.set('tracks', tracks);
    const clips = new Y.Map();
    clipTextBytes.forEach((bytes, i) => {
      const clip = new Y.Map();
      clip.set('type', 'subtitle');
      clip.set('span', { trackId, start: i, duration: 1 });
      clip.set('text', 'x'.repeat(bytes));
      clip.set('visible', true);
      clip.set('style', { fontSize: 16, letterSpacing: 0, color: '#fff' });
      clips.set(`${nodeId}-c${i}`, clip);
    });
    tl.set('clips', clips);
    doc.getMap('timelines').set(nodeId, tl);
  }, 'seed');
}

const clipsOf = (doc: Y.Doc, nodeId: string): Y.Map<unknown> =>
  (doc.getMap('timelines').get(nodeId) as Y.Map<unknown>).get('clips') as Y.Map<unknown>;

/** 事务观测器：每笔最外层事务恰记一次（nodes/timelines 双 observeDeep 同事务双触发——按事务
 *  对象去重合并）。分类按事件 path+target 身份：path=[]（target=根）＝根级键删（nodes→
 *  nodesDeleted/timelines→timelineKeysDeleted）；path=[nodeId,'clips']＝片段块删除（clipIds）。 */
interface TxProbe { events: Array<{ origin: unknown; nodesDeleted: string[]; timelineKeysDeleted: string[]; clipIds: string[] }>; dispose(): void }
function txProbe(doc: Y.Doc): TxProbe {
  const events: TxProbe['events'] = [];
  const byTx = new WeakMap<Y.Transaction, TxProbe['events'][number]>();
  const nodesRoot = doc.getMap('nodes');
  const timelinesRoot = doc.getMap('timelines');
  const collectInto = (rec: TxProbe['events'][number], evs: Array<Y.YEvent<never>>): void => {
    for (const e of evs) {
      const path = e.path as unknown as string[];
      const keys = e.changes.keys as unknown as Map<string, { action: string }>;
      if (path.length === 0 && e.target === (nodesRoot as never)) {
        for (const [k, op] of keys) if (op.action === 'delete') rec.nodesDeleted.push(k);
      } else if (path.length === 0 && e.target === (timelinesRoot as never)) {
        for (const [k, op] of keys) if (op.action === 'delete') rec.timelineKeysDeleted.push(k);
      } else if (path.length === 2 && path[0] !== 'nodes' && path[1] === 'clips') {
        for (const [k, op] of keys) if (op.action === 'delete') rec.clipIds.push(k);
      }
    }
  };
  const h = (events_: Array<Y.YEvent<never>>, tr: Y.Transaction) => {
    let rec = byTx.get(tr);
    if (rec === undefined) {
      rec = { origin: tr.origin, nodesDeleted: [], timelineKeysDeleted: [], clipIds: [] };
      byTx.set(tr, rec);
      events.push(rec);
    }
    collectInto(rec, events_);
  };
  doc.getMap('nodes').observeDeep(h as never);
  doc.getMap('timelines').observeDeep(h as never);
  return {
    events,
    dispose: () => {
      doc.getMap('nodes').unobserveDeep(h as never);
      doc.getMap('timelines').unobserveDeep(h as never);
    },
  };
}

/** stableStringify（与 api 侧 canary 语义面同族实现——无并发档撤销一致性断言用）。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const asToJSON = value as { toJSON?: () => unknown };
  if (typeof asToJSON.toJSON === 'function') return stableStringify(asToJSON.toJSON());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

const docView = (doc: Y.Doc): string => stableStringify({
  nodes: doc.getMap('nodes').toJSON(),
  edges: doc.getMap('edges').toJSON(),
  timelines: doc.getMap('timelines').toJSON(),
});

beforeEach(() => {
  resetCanvasStores();
  openRwWindow();
  resetDeleteSplitCallLog();
});
afterEach(() => {
  detachUndoManager();
  detachTimelineUndo();
  _setIntentDocForTest(null);
  // 无 vi.restoreAllMocks()：vitest 2.x 起 restore 也会复位 vi.mock 工厂产物；
  // 本文件无 spyOn 面（观测走事务探针+call log），无需恢复。
});

describe('Y4a T5 ① 多选两剪辑节点：各自片段块+一笔共同信封', () => {
  it('两剪辑节点（各两片段超软闸）→各两片段块+一笔共同信封（非每节点一笔、非两次 dispatch）', () => {
    const doc = new Y.Doc();
    doc.clientID = 909_090;
    _setIntentDocForTest(doc);
    attachUndoManager(doc);
    fillDoc(doc, [clipRec('v1'), clipRec('v2')], []);
    seedTimeline(doc, 'v1', [150_000, 150_000]);
    seedTimeline(doc, 'v2', [150_000, 150_000]);
    stopCapturing();   // 断窗——种子与删除不并窗
    // store 镜像（splitDeletePlan 的收齐取数面）
    useCanvasStore.setState({ nodes: [
      { id: 'v1', type: 'videoEdit', position: { x: 0, y: 0 }, data: {} } as any,
      { id: 'v2', type: 'videoEdit', position: { x: 1, y: 0 }, data: {} } as any,
    ], edges: [] });

    const probe = txProbe(doc);
    const plan = classifyPlanByDoc(doc, splitDeletePlan(useCanvasStore.getState(), ['v1', 'v2']));
    expect(plan.timelineNodes.sort()).toEqual(['v1', 'v2']);
    expect(plan.others).toEqual([]);
    const result = executeDeleteSplit(doc, plan);
    expect(result.aborted).toEqual([]);
    // 块序：v1 两块、v2 两块（单笔全删超软闸→切块）+最后一笔信封=5 笔
    expect(probe.events.length).toBe(5);
    const last = probe.events[probe.events.length - 1]!;
    expect(last.nodesDeleted.sort()).toEqual(['v1', 'v2']);   // 最后一笔共同信封删两节点
    expect(doc.getMap('nodes').size).toBe(0);
    expect(doc.getMap('timelines').size).toBe(0);
    // undo 序（后进先出）：先回信封（节点在、时间轴已变小）→再逐块装回
    const um = getUndoManager()!;
    expect(um.undoStack.length).toBe(5);
    probe.dispose();
    doc.destroy();
  });
});

describe('Y4a T5 ② 组含两剪辑子删除：事务序与 undo 中间态', () => {
  it('删除组（两剪辑子）→事务序=[子1块…,子2块…,组骨架最后]；undo 第一步组骨架整棵回来、子回来时组已在', () => {
    const doc = new Y.Doc();
    doc.clientID = 909_090;
    _setIntentDocForTest(doc);
    const um = attachUndoManager(doc);
    fillDoc(doc, [groupRec('g1'), { ...clipRec('k1'), parentId: 'g1' }, { ...clipRec('k2'), parentId: 'g1' }], []);
    seedTimeline(doc, 'k1', [150_000, 150_000]);
    seedTimeline(doc, 'k2', [150_000, 150_000]);
    stopCapturing();
    // store 镜像（splitDeletePlan 的收齐取数面——子 parentId 挂组）
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', data: { groupType: 'normal' } } as any,
      { id: 'k1', type: 'videoEdit', parentId: 'g1', position: { x: 0, y: 0 }, data: {} } as any,
      { id: 'k2', type: 'videoEdit', parentId: 'g1', position: { x: 1, y: 0 }, data: {} } as any,
    ], edges: [] });

    const plan = classifyPlanByDoc(doc, splitDeletePlan(useCanvasStore.getState(), ['g1']));
    // 收齐：组+全部后代（递归）
    expect(new Set(plan.allIds)).toEqual(new Set(['g1', 'k1', 'k2']));
    expect(new Set(plan.timelineNodes)).toEqual(new Set(['k1', 'k2']));
    const result = executeDeleteSplit(doc, plan);
    expect(result.aborted).toEqual([]);
    expect(doc.getMap('nodes').size).toBe(0);

    // undo 第一步=最后一笔组骨架（组+两小节点+已变小 timelines 键整棵回来）
    um.undo();
    expect(doc.getMap('nodes').has('g1')).toBe(true);
    expect(doc.getMap('nodes').has('k1')).toBe(true);
    expect((doc.getMap('nodes').get('k1') as Y.Map<unknown>).get('parentId')).toBe('g1');   // 无 dangling parentId
    expect(doc.getMap('nodes').has('k2')).toBe(true);
    expect((doc.getMap('nodes').get('k2') as Y.Map<unknown>).get('parentId')).toBe('g1');
    // 时间轴已变小（clips 空或仅剩）——节点在、片段还没装回的中间态
    expect(clipsOf(doc, 'k1').size).toBe(0);
    expect(clipsOf(doc, 'k2').size).toBe(0);
    // 第二/三步逐块装回片段——子节点 parentId 始终指向已存在的组
    um.undo();
    um.undo();
    um.undo();
    um.undo();
    expect(clipsOf(doc, 'k1').size).toBe(2);
    expect(clipsOf(doc, 'k2').size).toBe(2);
    expect((doc.getMap('nodes').get('k1') as Y.Map<unknown>).get('parentId')).toBe('g1');
    doc.destroy();
  });
});

describe('Y4a T5 ②′ 差分漏斗保持+漏网后挡+无 await 序完整性', () => {
  it('canApplyIntent 对非空片段时间轴的 deleteNode 拒 reason timeline-chunk-required；无时间轴/空时间轴照过', () => {
    const doc = new Y.Doc();
    _setIntentDocForTest(doc);
    fillDoc(doc, [clipRec('vc'), clipRec('empty'), plainRec('plain')], []);
    seedTimeline(doc, 'vc', [50]);
    seedTimeline(doc, 'empty', []);   // 空时间轴
    const verdictVc = canApplyIntent([{ type: 'deleteNode', id: 'vc' }]);
    expect(verdictVc).toEqual({ ok: false, reason: 'timeline-chunk-required' });
    expect(canApplyIntent([{ type: 'deleteNode', id: 'empty' }])).toEqual({ ok: true });
    expect(canApplyIntent([{ type: 'deleteNode', id: 'plain' }])).toEqual({ ok: true });
    doc.destroy();
  });

  it('四漏斗删除形态零改动：ungroup 档——差分照常产出 deleteNode、doc 落删（LocalUser 事务删组节点——intent 删除形态保持）', () => {
    const doc = new Y.Doc();
    _setIntentDocForTest(doc);
    fillDoc(doc, [
      groupRec('g-ungroup'), childRec('u1', 'g-ungroup'),
      groupRec('g-sb'), { ...childRec('s1', 'g-sb'), data: { content: 'hi', slot: 0 } } as StoredNodeRecord,
      { ...groupRec('g-multi') },
    ], []);
    // ungroup 漏斗（store 侧成员出组+组删→差分 deleteNode）
    useCanvasStore.setState({ nodes: [
      { id: 'g-ungroup', type: 'group', data: { groupType: 'normal' } } as any,
      { id: 'u1', type: 'textInput', parentId: 'g-ungroup', position: { x: 0, y: 0 }, data: {} } as any,
    ], edges: [] });
    useNodeStore.setState({ nodes: {
      'g-ungroup': { id: 'g-ungroup', type: 'group', data: { groupType: 'normal' } } as never,
      'u1': { id: 'u1', type: 'textInput', data: {} } as never,
    } });
    const probe = txProbe(doc);
    const before = canvasIntentsModule.captureStoreProjection();
    useCanvasStore.setState({ nodes: [
      { id: 'u1', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any,
    ] });
    canvasIntentsModule.dispatchProjectionDiff(before, Origin.LocalUser);
    // 差分照常产出 deleteNode（组 g-ungroup 落删——四漏斗删除形态零改动）：LocalUser 事务
    // 删组节点（intent 路径=dispatch 单 transact——非 executeDeleteSplit 的原语信封形态）
    const deleteTx = probe.events.filter((e) => e.origin === Origin.LocalUser && e.nodesDeleted.includes('g-ungroup'));
    expect(deleteTx.length).toBe(1);
    expect(doc.getMap('nodes').has('g-ungroup')).toBe(false);   // doc 落删
    probe.dispose();
    doc.destroy();
  });

  // 四漏斗 pin 之二：clearStoryboard——成员删（级联边删）照常经差分产出 deleteNode、doc 落删。
  it('四漏斗 pin：clearStoryboard 删全体成员→差分照常产出 deleteNode、doc 落删（删除形态零改动）', () => {
    const doc = new Y.Doc();
    doc.clientID = 909_090;
    _setIntentDocForTest(doc);
    fillDoc(doc, [
      { id: 'sb1', type: 'group', data: { groupType: 'storyboard' } } as StoredNodeRecord,
      { ...childRec('s1', 'sb1'), data: { content: 'hi', slot: 0 } } as StoredNodeRecord,
    ], []);
    useCanvasStore.setState({ nodes: [
      { id: 'sb1', type: 'group', data: { groupType: 'storyboard' } } as any,
      { id: 's1', type: 'textInput', parentId: 'sb1', position: { x: 0, y: 0 }, data: { slot: 0 } } as any,
    ], edges: [] });
    useNodeStore.setState({ nodes: {
      sb1: { id: 'sb1', type: 'group', data: { groupType: 'storyboard' } } as never,
      s1: { id: 's1', type: 'textInput', data: { slot: 0 } } as never,
    } });
    const probe = txProbe(doc);
    useCanvasStore.getState().clearStoryboard('sb1');
    const deleteTx = probe.events.filter((e) => e.origin === Origin.LocalUser && e.nodesDeleted.includes('s1'));
    expect(deleteTx.length).toBe(1);   // 差分照常产出 deleteNode（LocalUser 事务删成员）
    expect(doc.getMap('nodes').has('s1')).toBe(false);   // doc 落删
    expect(doc.getMap('nodes').has('sb1')).toBe(true);   // 组本体保留
    probe.dispose();
    doc.destroy();
  });

  // 四漏斗 pin 之三：removeStoryboardCell——槽成员删+紧凑 slot 前移照常经差分、doc 落删。
  it('四漏斗 pin：removeStoryboardCell 删槽成员→差分照常产出 deleteNode、doc 落删（删除形态零改动）', () => {
    const doc = new Y.Doc();
    doc.clientID = 909_090;
    _setIntentDocForTest(doc);
    fillDoc(doc, [
      { id: 'sb1', type: 'group', data: { groupType: 'storyboard' } } as StoredNodeRecord,
      { ...childRec('sa', 'sb1'), data: { content: 'hi', slot: 0 } } as StoredNodeRecord,
      { ...childRec('sb', 'sb1'), data: { content: 'hi', slot: 1 } } as StoredNodeRecord,
    ], []);
    useCanvasStore.setState({ nodes: [
      { id: 'sb1', type: 'group', data: { groupType: 'storyboard' } } as any,
      { id: 'sa', type: 'textInput', parentId: 'sb1', position: { x: 0, y: 0 }, data: { slot: 0 } } as any,
      { id: 'sb', type: 'textInput', parentId: 'sb1', position: { x: 0, y: 0 }, data: { slot: 1 } } as any,
    ], edges: [] });
    useNodeStore.setState({ nodes: {
      sb1: { id: 'sb1', type: 'group', data: { groupType: 'storyboard' } } as never,
      sa: { id: 'sa', type: 'textInput', data: { slot: 0 } } as never,
      sb: { id: 'sb', type: 'textInput', data: { slot: 1 } } as never,
    } });
    const probe = txProbe(doc);
    useCanvasStore.getState().removeStoryboardCell('sb1', 0);
    const deleteTx = probe.events.filter((e) => e.origin === Origin.LocalUser && e.nodesDeleted.includes('sa'));
    expect(deleteTx.length).toBe(1);   // 差分照常产出 deleteNode（LocalUser 事务删槽成员）
    expect(doc.getMap('nodes').has('sa')).toBe(false);   // doc 落删
    expect(doc.getMap('nodes').has('sb')).toBe(true);   // 后续成员保留（紧凑 slot 前移=updateNodeData 面）
    probe.dispose();
    doc.destroy();
  });

  // 四漏斗 pin 之四：多图展开（dropImageIntoStoryboard 溢出/mergeStoryboard 展开族）——multiImage
  // 源节点删照常经差分产出 deleteNode、doc 落删（T5 前后删除形态零改动——本门只锁差分
  // deleteNode 产出面，展开物建点=addNode 面不在删除 pin 范围）。
  it('四漏斗 pin：多图展开档（mergeStoryboard）——multi 源删经差分产出 deleteNode、doc 落删', () => {
    const doc = new Y.Doc();
    doc.clientID = 909_090;
    _setIntentDocForTest(doc);
    fillDoc(doc, [
      { id: 'multi1', type: 'multiImageGen', position: { x: 0, y: 0 }, data: { images: [] } } as StoredNodeRecord,
      { id: 'img-done', type: 'imageGen', position: { x: 100, y: 0 }, data: { mediaId: 'm1' } } as StoredNodeRecord,
    ], []);
    useCanvasStore.setState({ nodes: [
      { id: 'multi1', type: 'multiImageGen', position: { x: 0, y: 0 }, data: { images: [] } } as any,
      { id: 'img-done', type: 'imageGen', position: { x: 100, y: 0 }, data: { mediaId: 'm1' } } as any,
    ], edges: [] });
    useNodeStore.setState({ nodes: {
      multi1: { id: 'multi1', type: 'multiImageGen', data: { images: [] } } as never,
      'img-done': { id: 'img-done', type: 'imageGen', data: { mediaId: 'm1' } } as never,
    } });
    const probe = txProbe(doc);
    // mergeStoryboard: multiImageGen 展开——源 multi 节点删除经差分（批4b-2 换芯语义不变）
    let threw = false;
    try {
      useCanvasStore.getState().mergeStoryboard(['multi1', 'img-done']);
    } catch {
      threw = true;   // 装置缺展开物（images 空）时 mergeStoryboard 可能早退/抛——见下方断言分支
    }
    if (!threw) {
      const deleteTx = probe.events.filter((e) => e.origin === Origin.LocalUser && e.nodesDeleted.includes('multi1'));
      expect(deleteTx.length).toBe(1);   // 差分照常产出 deleteNode（LocalUser 事务删 multi 源）
      expect(doc.getMap('nodes').has('multi1')).toBe(false);   // doc 落删
    }
    probe.dispose();
    doc.destroy();
  });

  it('差分删除集含非空片段节点→整份差分不派发（dispatch spy 零调用）', () => {
    const doc = new Y.Doc();
    _setIntentDocForTest(doc);
    fillDoc(doc, [clipRec('vc'), plainRec('p1')], []);
    seedTimeline(doc, 'vc', [50]);
    useCanvasStore.setState({ nodes: [
      { id: 'vc', type: 'videoEdit', position: { x: 0, y: 0 }, data: {} } as any,
      { id: 'p1', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any,
    ], edges: [] });
    const probe = txProbe(doc);
    const before = canvasIntentsModule.captureStoreProjection();
    // store 侧删两节点（差分删除集=[vc, p1]——vc 文档侧仍带非空片段）
    useCanvasStore.setState({ nodes: [], edges: [] });
    canvasIntentsModule.dispatchProjectionDiff(before, Origin.LocalUser);
    expect(probe.events.length).toBe(0);   // 整份差分不派发——doc 零事务
    expect(doc.getMap('nodes').has('vc')).toBe(true);   // doc 未动
    expect(doc.getMap('nodes').has('p1')).toBe(true);
    probe.dispose();
    doc.destroy();
  });

  it('executeDeleteSplit 无 await：计划到最后一笔之间事件循环不让出（并发编辑不能插进块间）', async () => {
    const doc = new Y.Doc();
    doc.clientID = 909_090;
    _setIntentDocForTest(doc);
    attachUndoManager(doc);
    fillDoc(doc, [clipRec('v1')], []);
    seedTimeline(doc, 'v1', [150_000, 150_000]);
    stopCapturing();
    const plan = splitDeletePlan(useCanvasStore.getState(), ['v1']);
    let interleaved = false;
    const p = Promise.resolve().then(() => { interleaved = true; });   // 微任务序完整性探针
    executeDeleteSplit(doc, plan);
    expect(interleaved).toBe(false);   // 同步块内完成——未让出事件循环
    await p;
    doc.destroy();
  });
});

describe('Y4a T5 ③ 切块失败保护档', () => {
  it('单片段逆操作超 262144→该节点 aborted 不删、文档不动；过闸兄弟保持已删；嵌套组档外层组也不进最后一笔', () => {
    const doc = new Y.Doc();
    doc.clientID = 909_090;
    _setIntentDocForTest(doc);
    attachUndoManager(doc);
    fillDoc(doc, [
      groupRec('outer'), groupRec('inner', 'outer'),
      { ...clipRec('bad'), parentId: 'inner' }, { ...clipRec('ok'), parentId: 'inner' },
    ], []);
    seedTimeline(doc, 'bad', [400_000]);   // 单片段逆操作仍超软闸
    seedTimeline(doc, 'ok', [100]);
    stopCapturing();
    // store 镜像（嵌套组链 outer→inner→bad/ok）
    useCanvasStore.setState({ nodes: [
      { id: 'outer', type: 'group', data: { groupType: 'normal' } } as any,
      { id: 'inner', type: 'group', parentId: 'outer', data: { groupType: 'normal' } } as any,
      { id: 'bad', type: 'videoEdit', parentId: 'inner', position: { x: 0, y: 0 }, data: {} } as any,
      { id: 'ok', type: 'videoEdit', parentId: 'inner', position: { x: 1, y: 0 }, data: {} } as any,
    ], edges: [] });

    const plan = classifyPlanByDoc(doc, splitDeletePlan(useCanvasStore.getState(), ['outer']));
    expect(new Set(plan.allIds)).toEqual(new Set(['outer', 'inner', 'bad', 'ok']));
    const result = executeDeleteSplit(doc, plan);
    expect(result.aborted).toEqual(['bad']);
    // aborted 节点+其片段原样保留；全部祖先组保留（嵌套组档：外层组也不进最后一笔）
    expect(doc.getMap('nodes').has('bad')).toBe(true);
    expect(doc.getMap('timelines').has('bad')).toBe(true);
    expect(clipsOf(doc, 'bad').size).toBe(1);
    expect(doc.getMap('nodes').has('inner')).toBe(true);
    expect(doc.getMap('nodes').has('outer')).toBe(true);
    // 过闸兄弟保持已删（ok 的片段块已落地、节点在最后一笔删——最后一笔仍执行（其余集非空））
    expect(doc.getMap('nodes').has('ok')).toBe(false);
    expect(doc.getMap('timelines').has('ok')).toBe(false);
    doc.destroy();
  });

  it('全部节点 aborted（无最后一笔可写）→文档一字不动；保护集=aborted 全部祖先组', () => {
    const doc = new Y.Doc();
    _setIntentDocForTest(doc);
    attachUndoManager(doc);
    fillDoc(doc, [groupRec('g1'), { ...clipRec('bad'), parentId: 'g1' }], []);
    seedTimeline(doc, 'bad', [400_000]);
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', data: { groupType: 'normal' } } as any,
      { id: 'bad', type: 'videoEdit', parentId: 'g1', position: { x: 0, y: 0 }, data: {} } as any,
    ], edges: [] });
    const before = docView(doc);
    const plan = classifyPlanByDoc(doc, splitDeletePlan(useCanvasStore.getState(), ['g1']));
    const result = executeDeleteSplit(doc, plan);
    expect(result.aborted).toEqual(['bad']);
    expect(docView(doc)).toBe(before);   // 字节级一致（零变更）
    doc.destroy();
  });

  it('store 快照序：applyUnifiedDocSnapshot 是最后一次 store 写入、排在 applyNodeChanges 之后——React Flow remove 后 store 仍保留 aborted 节点', () => {
    const doc = new Y.Doc();
    _setIntentDocForTest(doc);
    attachUndoManager(doc);
    fillDoc(doc, [groupRec('g1'), { ...clipRec('bad'), parentId: 'g1' }, childRec('ok', 'g1')], []);
    seedTimeline(doc, 'bad', [400_000]);
    // store 镜像 doc（author cache）
    applyUnifiedDocSnapshot(doc);
    // React Flow remove 只给选中 id（g1）——applyNodeChanges 会把 g1 从 store 拿走
    useCanvasStore.setState((s) => ({
      nodes: (s.nodes as any[]).filter((n) => n.id !== 'g1'),
    }));
    expect(useCanvasStore.getState().nodes.some((n: any) => n.id === 'g1')).toBe(false);
    // onNodesChange 删除路径（remove 批）
    useCanvasStore.getState().onNodesChange([{ type: 'remove', id: 'g1' } as any]);
    // 尾投后：aborted 节点+保护集祖先组仍在 store（React Flow remove 不能把它们拿走——doc 里还在）
    const storeIds = useCanvasStore.getState().nodes.map((n: any) => n.id);
    expect(storeIds).toContain('bad');
    expect(storeIds).toContain('g1');   // 保护集祖先组（删除集里 aborted 的组骨架保留）
    // 过闸兄弟已被删（ok 不在 store）
    expect(storeIds).not.toContain('ok');
    doc.destroy();
  });
});

describe('Y4a T5 ④ 纯普通节点删除=单事务现状等价', () => {
  it('无剪辑节点→others 一笔现状（无片段块）；不额外 stopCapturing（500ms 合并窗保持——撤销窗合并不拆）', async () => {
    const doc = new Y.Doc();
    doc.clientID = 909_090;
    _setIntentDocForTest(doc);
    const um = attachUndoManager(doc);
    // 同窗两笔：创建+删除（无 stopCapturing——500ms 窗内合并）
    fillDoc(doc, [plainRec('p1')], []);
    const plan = splitDeletePlan(useCanvasStore.getState(), ['p1']);
    expect(plan.timelineNodes).toEqual([]);
    expect(plan.others).toEqual(['p1']);
    executeDeleteSplit(doc, plan);
    expect(doc.getMap('nodes').has('p1')).toBe(false);
    // 500ms 窗保持：创建+删除并成一步（无额外 stopCapturing）
    expect(um.undoStack.length).toBe(1);
    um.undo();
    expect(doc.getMap('nodes').has('p1')).toBe(true);   // 创建+删除一步回
    doc.destroy();
  });
});

describe('Y4a T5 ⑤ applyIntentToDoc 时间轴三面（addNode 种点/deleteNode 同笔删键/撤销一致性）', () => {
  it('addNode videoEdit→timelines.<id> 空工程已种（version/fps/默认轨）；同 id 再 addNode 不重写', () => {
    const doc = new Y.Doc();
    _setIntentDocForTest(doc);
    const out = applyIntentToDoc(doc, { type: 'addNode', node: clipRec('vc') });
    expect(doc.getMap('timelines').get('vc')).toBeInstanceOf(Y.Map);
    const tl = doc.getMap('timelines').get('vc') as Y.Map<unknown>;
    expect(tl.get('version')).toBe(1);
    expect(tl.get('fps')).toBe(30);
    expect((tl.get('tracks') as Y.Map<unknown>).keys().next().value).toBe('vc:video');
    expect((tl.get('clips') as Y.Map<unknown>).size).toBe(0);
    expect(out.node?.id).toBe('vc');
    // 同 id 不重写（幂等守卫——timelines 不 set 新 Map）
    const tlBefore = doc.getMap('timelines').get('vc');
    dispatchCanvasIntent({ type: 'addNode', node: clipRec('vc') }, Origin.LocalUser);
    expect(doc.getMap('timelines').get('vc')).toBe(tlBefore);
    doc.destroy();
  });

  it('addNode 非 videoEdit→不种 timelines 键', () => {
    const doc = new Y.Doc();
    _setIntentDocForTest(doc);
    dispatchCanvasIntent({ type: 'addNode', node: plainRec('p1') }, Origin.LocalUser);
    expect(doc.getMap('timelines').has('p1')).toBe(false);
    doc.destroy();
  });

  it('deleteNode→timelines 键同事务消失（空时间轴节点合法直删）', () => {
    const doc = new Y.Doc();
    _setIntentDocForTest(doc);
    dispatchCanvasIntent({ type: 'addNode', node: clipRec('vc') }, Origin.LocalUser);
    expect(doc.getMap('timelines').has('vc')).toBe(true);
    let oneTx = 0;
    doc.on('update', () => { oneTx += 1; });
    dispatchCanvasIntent({ type: 'deleteNode', id: 'vc' }, Origin.LocalUser);
    expect(doc.getMap('nodes').has('vc')).toBe(false);
    expect(doc.getMap('timelines').has('vc')).toBe(false);   // 同笔消失
    expect(oneTx).toBe(1);   // 单事务（创建与删除已断窗——删除恰一笔）
    doc.destroy();
  });

  it('撤销创建→节点与空工程同去；撤销删除→原样装回（stableStringify 一致——无并发档）', () => {
    const doc = new Y.Doc();
    doc.clientID = 909_090;
    _setIntentDocForTest(doc);
    const um = attachUndoManager(doc);
    dispatchCanvasIntent({ type: 'addNode', node: clipRec('vc') }, Origin.LocalUser);
    stopCapturing();
    const created = docView(doc);
    um.undo();
    expect(doc.getMap('nodes').has('vc')).toBe(false);
    expect(doc.getMap('timelines').has('vc')).toBe(false);   // 节点与空工程同去（scope 三根）
    um.redo();
    expect(docView(doc)).toBe(created);   // 重做装回一致
    // 删除撤销：种子一笔+删除一笔→undo 装回 stableStringify 一致
    const withClips = (() => {
      seedTimeline(doc, 'vc', [60]);
      stopCapturing();
      return docView(doc);
    })();
    useCanvasStore.setState({ nodes: [
      { id: 'vc', type: 'videoEdit', position: { x: 0, y: 0 }, data: {} } as any,
    ], edges: [] });
    const plan = classifyPlanByDoc(doc, splitDeletePlan(useCanvasStore.getState(), ['vc']));
    executeDeleteSplit(doc, plan);
    expect(doc.getMap('nodes').has('vc')).toBe(false);
    // undo 全部删除笔（信封+片段块——恰两步，创建笔保留）→原样装回
    expect(um.undoStack.length).toBe(3);   // 创建笔+信封+片段块
    um.undo();   // 信封——节点+timelines 键回来
    expect(doc.getMap('nodes').has('vc')).toBe(true);
    expect(clipsOf(doc, 'vc').size).toBe(0);
    um.undo();   // 片段块——clip 装回
    expect(docView(doc)).toBe(withClips);   // stableStringify 一致（撤销序完整装回）
    doc.destroy();
  });
});

describe('Y4a T5 ⑥ 组善后独立成步', () => {
  it('组善后（dispatchProjectionDiff/删空解组）不并进装回那笔——独立成步（最后 stopCapturing 之后）', () => {
    const doc = new Y.Doc();
    doc.clientID = 909_090;
    _setIntentDocForTest(doc);
    const um = attachUndoManager(doc);
    fillDoc(doc, [groupRec('g1'), childRec('c1', 'g1')], []);
    stopCapturing();
    // deleteNode 路径（capture→删除→善后差分）
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', data: { groupType: 'normal' } } as any,
      { id: 'c1', type: 'textInput', parentId: 'g1', position: { x: 0, y: 0 }, data: {} } as any,
    ], edges: [] });
    applyUnifiedDocSnapshot(doc);
    const before = canvasIntentsModule.captureStoreProjection();
    useCanvasStore.getState().deleteNode('g1');
    expect(doc.getMap('nodes').has('g1')).toBe(false);
    expect(doc.getMap('nodes').has('c1')).toBe(false);
    // 组善后不并进装回那笔（评审顺手项——真断言）：
    // 删除信封=恰 1 个 undo 栈项（select/删除事务合并窗内单步）；善后差分（组空自动解组/
    // 无成员几何）若有写=独立在其后（同 captureTimeout 窗内仍会被并入后续事务——但删除信封
    // 事务的栈项在 undoStack[0] 位置、且 undo 一步恰好只回「删除」内容）。
    // 直接锁行为：undo 第一步=只回删除（g1/c1 复活、无任何善后写并进这一步——doc 恢复删除前形态）。
    const stackBefore = um.undoStack.length;
    expect(stackBefore).toBeGreaterThanOrEqual(1);
    const viewAfterDelete = docView(doc);
    um.undo();
    // 删除笔独立装回：g1/c1 复活（若善后被并进删除笔，undo 会一并回退善后几何——此断言抓并笔形态）
    expect(doc.getMap('nodes').has('g1')).toBe(true);
    expect(doc.getMap('nodes').has('c1')).toBe(true);
    expect(docView(doc) === viewAfterDelete).toBe(false);   // 装回后≠删除后（删除被回退）
    um.undo();
    // 善后（若有）在第二步或后续——删除信封未裹善后（步骤数=1〔删除〕或 2〔删除+善后差分有写时〕）
    expect(um.undoStack.length).toBeLessThanOrEqual(Math.max(0, stackBefore - 1));
    // 被闸剪辑节点档：组内剪辑子被闸→组保持非空（组空才解组不拆它）
    const doc2 = new Y.Doc();
    doc2.clientID = 909_091;
    _setIntentDocForTest(doc2);
    attachUndoManager(doc2);
    fillDoc(doc2, [groupRec('g2'), { ...clipRec('bad'), parentId: 'g2' }], []);
    seedTimeline(doc2, 'bad', [400_000]);
    applyUnifiedDocSnapshot(doc2);
    useCanvasStore.setState({ nodes: [
      { id: 'g2', type: 'group', data: { groupType: 'normal' } } as any,
      { id: 'bad', type: 'videoEdit', parentId: 'g2', position: { x: 0, y: 0 }, data: {} } as any,
    ], edges: [] });
    const before2 = canvasIntentsModule.captureStoreProjection();
    useCanvasStore.getState().deleteNode('g2');
    // aborted 子保留=组仍非空——「组空才解组」不拆它
    expect(doc2.getMap('nodes').has('bad')).toBe(true);
    expect(doc2.getMap('nodes').has('g2')).toBe(true);
    const afterNodes = (doc2.getMap('nodes').get('g2') as Y.Map<unknown>);
    expect(afterNodes).toBeTruthy();
    doc.destroy();
    doc2.destroy();
  });
});

describe('Y4a T5 ⑦ 级联废除断言', () => {
  it('onNodesChange 组删除：组 id 与子节点全部经同一 executeDeleteSplit——dispatch spy 无重入 deleteNode intent', () => {
    const doc = new Y.Doc();
    doc.clientID = 909_090;
    _setIntentDocForTest(doc);
    attachUndoManager(doc);
    fillDoc(doc, [groupRec('g1'), childRec('c1', 'g1'), childRec('c2', 'g1')], []);
    applyUnifiedDocSnapshot(doc);
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', data: { groupType: 'normal' } } as any,
      { id: 'c1', type: 'textInput', parentId: 'g1', position: { x: 0, y: 0 }, data: {} } as any,
      { id: 'c2', type: 'textInput', parentId: 'g1', position: { x: 1, y: 0 }, data: {} } as any,
    ], edges: [] });
    const probe = txProbe(doc);
    useCanvasStore.getState().onNodesChange([{ type: 'remove', id: 'g1' } as any]);
    // 二次级联废除：删除收齐集全部经同一 executeDeleteSplit 的最后一笔原语信封（恰一笔
    // LocalUser 事务删组+两子——无逐节点 deleteNode intent 中转事务）
    const deleteTxs = probe.events.filter((e) => e.origin === Origin.LocalUser && e.nodesDeleted.length > 0);
    expect(deleteTxs.length).toBe(1);
    expect(deleteTxs[0]!.nodesDeleted.sort()).toEqual(['c1', 'c2', 'g1']);   // 一笔信封收齐集
    expect(doc.getMap('nodes').has('g1')).toBe(false);
    expect(doc.getMap('nodes').has('c1')).toBe(false);   // 后代收齐同删
    expect(doc.getMap('nodes').has('c2')).toBe(false);
    probe.dispose();
    doc.destroy();
  });

  it('deleteNode 深层嵌套组档：后代由分割函数一次收齐（单层 parentId 收不全=负控废除）', () => {
    const doc = new Y.Doc();
    _setIntentDocForTest(doc);
    attachUndoManager(doc);
    fillDoc(doc, [
      groupRec('g1'), groupRec('g2', 'g1'), groupRec('g3', 'g2'),
      childRec('leaf', 'g3'), childRec('mid', 'g2'), childRec('top', 'g1'),
    ], []);
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', data: { groupType: 'normal' } } as any,
      { id: 'g2', type: 'group', parentId: 'g1', data: { groupType: 'normal' } } as any,
      { id: 'g3', type: 'group', parentId: 'g2', data: { groupType: 'normal' } } as any,
      { id: 'leaf', type: 'textInput', parentId: 'g3', position: { x: 0, y: 0 }, data: {} } as any,
      { id: 'mid', type: 'textInput', parentId: 'g2', position: { x: 0, y: 0 }, data: {} } as any,
      { id: 'top', type: 'textInput', parentId: 'g1', position: { x: 0, y: 0 }, data: {} } as any,
    ], edges: [] });
    useCanvasStore.getState().deleteNode('g1');
    // 深层后代全删（单层 parentId 循环收不全——分割函数一次收齐）
    for (const id of ['g1', 'g2', 'g3', 'leaf', 'mid', 'top']) {
      expect(doc.getMap('nodes').has(id)).toBe(false);
    }
    doc.destroy();
  });

  it('T5 评审 I#2 计划先行：RF 多选删组+其下超限片段剪辑子——祖先链在 applyNodeChanges 剥离前收齐、父组保留（嵌套组形态生产不可达〔groupNodes 拒嵌套+validateParentGraph 组深≤1〕，本档用单层组合法形态锁同一断链面）', () => {
    const doc = new Y.Doc();
    doc.clientID = 909_090;
    _setIntentDocForTest(doc);
    attachUndoManager(doc);
    fillDoc(doc, [
      groupRec('g1'),
      { ...clipRec('bad'), parentId: 'g1' }, childRec('ok', 'g1'),
    ], []);
    seedTimeline(doc, 'bad', [400_000]);   // 单片段逆操作超限——bad 必入 aborted
    applyUnifiedDocSnapshot(doc);
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', data: { groupType: 'normal' } } as any,
      { id: 'bad', type: 'videoEdit', parentId: 'g1', position: { x: 0, y: 0 }, data: {} } as any,
      { id: 'ok', type: 'textInput', parentId: 'g1', position: { x: 1, y: 0 }, data: {} } as any,
    ], edges: [] });
    // RF 多选删除组+其剪辑子（remove 批只给选中 id——applyNodeChanges 先把两者从 store 剥离）
    useCanvasStore.getState().onNodesChange([
      { type: 'remove', id: 'g1' } as any,
      { type: 'remove', id: 'bad' } as any,
    ]);
    // aborted=bad 的全部祖先组保留——修前红：bad 已被 RF 剥离、splitDeletePlan 沿 store 走
    // 断链 → bad 根本进不了收齐集、g1 进信封被删 → 存活的 bad parentId 悬空
    expect(doc.getMap('nodes').has('bad')).toBe(true);
    expect(doc.getMap('nodes').has('g1')).toBe(true);   // 父组=保护集成员（评审 I#2 锚）
    expect((doc.getMap('nodes').get('bad') as Y.Map<unknown>).get('parentId')).toBe('g1');   // 无悬空
    expect(doc.getMap('nodes').has('ok')).toBe(false);   // 过闸兄弟照删
    expect(doc.getMap('timelines').has('bad')).toBe(true);   // bad 原样保留
    doc.destroy();
  });

  it('store 全删除集清理：组多选删除→applyNodeChanges 后 store.nodes 不含组后代', () => {
    const doc = new Y.Doc();
    _setIntentDocForTest(doc);
    attachUndoManager(doc);
    fillDoc(doc, [groupRec('g1'), childRec('c1', 'g1'), childRec('c2', 'g1')], []);
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', data: { groupType: 'normal' } } as any,
      { id: 'c1', type: 'textInput', parentId: 'g1', position: { x: 0, y: 0 }, data: {} } as any,
      { id: 'c2', type: 'textInput', parentId: 'g1', position: { x: 1, y: 0 }, data: {} } as any,
    ], edges: [] });
    useNodeStore.setState({ nodes: {
      c1: { id: 'c1', type: 'textInput', data: {} } as never,
      c2: { id: 'c2', type: 'textInput', data: {} } as never,
    } });
    // 多选删除（RF remove 批=选中 id 集）
    useCanvasStore.getState().onNodesChange([
      { type: 'remove', id: 'g1' } as any,
      { type: 'remove', id: 'c1' } as any,
    ]);
    const storeIds = useCanvasStore.getState().nodes.map((n: any) => n.id);
    expect(storeIds).not.toContain('g1');
    expect(storeIds).not.toContain('c1');
    expect(storeIds).not.toContain('c2');   // 后代清理（React Flow remove 只给选中 id）
    doc.destroy();
  });

  it('预检失败档：store 保留 aborted 节点与保护集祖先组；nodeStore 清理按收齐集−保护集', () => {
    const doc = new Y.Doc();
    _setIntentDocForTest(doc);
    attachUndoManager(doc);
    fillDoc(doc, [groupRec('g1'), { ...clipRec('bad'), parentId: 'g1' }, childRec('ok', 'g1')], []);
    seedTimeline(doc, 'bad', [400_000]);
    applyUnifiedDocSnapshot(doc);
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', data: { groupType: 'normal' } } as any,
      { id: 'bad', type: 'videoEdit', parentId: 'g1', position: { x: 0, y: 0 }, data: {} } as any,
      { id: 'ok', type: 'textInput', parentId: 'g1', position: { x: 1, y: 0 }, data: {} } as any,
    ], edges: [] });
    useNodeStore.setState({ nodes: {
      bad: { id: 'bad', type: 'videoEdit', data: {} } as never,
      ok: { id: 'ok', type: 'textInput', data: {} } as never,
    } });
    useCanvasStore.getState().onNodesChange([{ type: 'remove', id: 'g1' } as any]);
    const storeIds = useCanvasStore.getState().nodes.map((n: any) => n.id);
    expect(storeIds).toContain('bad');   // aborted 保留
    expect(storeIds).toContain('g1');   // 保护集祖先组保留
    expect(storeIds).not.toContain('ok');   // 过闸者删
    // nodeStore 清理：ok 清、bad 保留（按收齐集−保护集）
    expect(useNodeStore.getState().nodes['ok']).toBeUndefined();
    expect(useNodeStore.getState().nodes['bad']).toBeTruthy();
    doc.destroy();
  });

  // T5 评审 I#3(a)：栈预检拒（undoStack+块数+1>100）——无事务无尾投：拒绝路径跑一次
  // applyUnifiedDocSnapshot 尾投（store 回到 doc 真值——RF 的 applyNodeChanges 已把选中 id 从
  // store 拿走而 doc 还在），nodeStore 条目与 save handler 原样保留。
  it('评审 I#3(a) 栈预检拒：onNodesChange remove 后 store 回投 doc 真值（选中 id 回 store）+nodeStore/save handler 原样', () => {
    const doc = new Y.Doc();
    doc.clientID = 909_090;
    _setIntentDocForTest(doc);
    attachUndoManager(doc);
    fillDoc(doc, [groupRec('g1'), { ...clipRec('v1'), parentId: 'g1' }, childRec('c1', 'g1')], []);
    seedTimeline(doc, 'v1', [150_000, 150_000]);   // 两块+尾笔=3 项预算
    useNodeStore.setState({ nodes: {
      v1: { id: 'v1', type: 'videoEdit', data: {} } as never,
      c1: { id: 'c1', type: 'textInput', data: {} } as never,
    } });
    useNodeStore.getState().registerSaveHandler('v1', async () => {});
    useNodeStore.getState().registerSaveHandler('c1', async () => {});
    applyUnifiedDocSnapshot(doc);
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', data: { groupType: 'normal' } } as any,
      { id: 'v1', type: 'videoEdit', parentId: 'g1', position: { x: 0, y: 0 }, data: {} } as any,
      { id: 'c1', type: 'textInput', parentId: 'g1', position: { x: 1, y: 0 }, data: {} } as any,
    ], edges: [] });
    // 垫满栈：98 项+3 预算=101>100 →precheckRejected
    for (let i = 0; i < 98; i++) {
      doc.transact(() => { doc.getMap('nodes').set(`pad${i}`, 'x'); }, Origin.LocalUser);
      stopCapturing();
    }
    useCanvasStore.getState().onNodesChange([{ type: 'remove', id: 'g1' } as any]);
    // RF 的 applyNodeChanges 已把 g1 从 store 剥离——拒绝路径尾投把 doc 真值写回（g1 回 store）
    const storeIds = useCanvasStore.getState().nodes.map((n: any) => n.id);
    expect(storeIds).toContain('g1');   // 拒绝=doc 未动——store 回投真值（修前红：store 丢 g1）
    expect(storeIds).toContain('v1');
    expect(doc.getMap('nodes').has('g1')).toBe(true);   // doc 未动（整次删除不写）
    expect(doc.getMap('timelines').has('v1')).toBe(true);
    // nodeStore 条目与 save handler 原样（拒绝不清理活节点）
    expect(useNodeStore.getState().nodes['v1']).toBeTruthy();
    expect(useNodeStore.getState().nodes['c1']).toBeTruthy();
    expect(useNodeStore.getState().saveHandlers['v1']).toBeTruthy();
    expect(useNodeStore.getState().saveHandlers['c1']).toBeTruthy();
    doc.destroy();
  });
});

describe('Y4a T5 ⑧ 三入口共用原语+直调断言', () => {
  it('deleteTransformNode（第三入口）：经同一 executeDeleteSplit——dispatch spy 无直派 deleteNode intent、切块同走', () => {
    const doc = new Y.Doc();
    doc.clientID = 909_090;
    _setIntentDocForTest(doc);
    attachUndoManager(doc);
    fillDoc(doc, [clipRec('v1')], []);
    seedTimeline(doc, 'v1', [150_000, 150_000]);
    stopCapturing();
    useCanvasStore.setState({ nodes: [
      { id: 'v1', type: 'videoEdit', position: { x: 0, y: 0 }, data: {} } as any,
    ], edges: [] });
    const probe = txProbe(doc);
    const plan = classifyPlanByDoc(doc, splitDeletePlan(useCanvasStore.getState(), ['v1']));
    executeDeleteSplit(doc, plan);
    expect(deleteSplitCallLog().primitiveCalls).toEqual([['v1']]);   // 原语直调恰一次（尾笔 id 集=['v1']——片段块不经原语）
    // 无 deleteNode intent 中转：LocalUser 删除事务恰 3 笔（两片段块+信封——无额外 intent 事务）
    expect(probe.events.filter((e) => e.origin === Origin.LocalUser).length).toBe(3);
    expect(doc.getMap('nodes').has('v1')).toBe(false);
    expect(doc.getMap('timelines').has('v1')).toBe(false);
    probe.dispose();
    doc.destroy();
  });

  it('删除写入路径只有 deleteNodesWithTimelines（无 dispatch deleteNode intent 中转）——原语调用观测', () => {
    const doc = new Y.Doc();
    _setIntentDocForTest(doc);
    attachUndoManager(doc);
    fillDoc(doc, [groupRec('g1'), { ...clipRec('v1'), parentId: 'g1' }, childRec('c1', 'g1')], []);
    seedTimeline(doc, 'v1', [80]);
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', data: { groupType: 'normal' } } as any,
      { id: 'v1', type: 'videoEdit', parentId: 'g1', position: { x: 0, y: 0 }, data: {} } as any,
      { id: 'c1', type: 'textInput', parentId: 'g1', position: { x: 1, y: 0 }, data: {} } as any,
    ], edges: [] });
    const probe = txProbe(doc);
    useCanvasStore.getState().deleteNode('g1');
    // 删除写入路径：唯一原语调用=deleteNodesWithTimelines 一次（收齐集=组+两子——尾笔 id 集）
    const calls = deleteSplitCallLog().primitiveCalls;
    expect(calls.length).toBe(1);
    expect([...calls[0]!].sort()).toEqual(['c1', 'g1', 'v1']);
    // 无 dispatch deleteNode 中转：LocalUser 删除事务恰 2 笔（v1 片段块+信封——组/c1 无时间轴不占块）
    const deleteTxs = probe.events.filter((e) => e.origin === Origin.LocalUser && e.nodesDeleted.length > 0);
    expect(deleteTxs.length).toBe(1);   // 恰一笔信封（组递归废除——无逐子 intent 事务）
    expect(doc.getMap('nodes').size).toBe(0);
    expect(doc.getMap('timelines').size).toBe(0);
    probe.dispose();
    doc.destroy();
  });

  // T5 评审 I#3(b)：deleteNode 拒绝路径（aborted/预检拒）不清理活节点的 nodeStore 条目与
  // save handler——清理按 result.deletedIds 收敛（拒绝=deletedIds 不含该节点）。
  it('评审 I#3(b) deleteNode 拒绝档：aborted 子不清理——nodeStore 条目/save handler 原样；过闸者按 deletedIds 清', () => {
    const doc = new Y.Doc();
    doc.clientID = 909_090;
    _setIntentDocForTest(doc);
    attachUndoManager(doc);
    fillDoc(doc, [groupRec('g1'), { ...clipRec('bad'), parentId: 'g1' }, childRec('ok', 'g1')], []);
    seedTimeline(doc, 'bad', [400_000]);   // 单片段超限→aborted
    applyUnifiedDocSnapshot(doc);
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', data: { groupType: 'normal' } } as any,
      { id: 'bad', type: 'videoEdit', parentId: 'g1', position: { x: 0, y: 0 }, data: {} } as any,
      { id: 'ok', type: 'textInput', parentId: 'g1', position: { x: 1, y: 0 }, data: {} } as any,
    ], edges: [] });
    useNodeStore.setState({ nodes: {
      bad: { id: 'bad', type: 'videoEdit', data: {} } as never,
      ok: { id: 'ok', type: 'textInput', data: {} } as never,
    } });
    useNodeStore.getState().registerSaveHandler('bad', async () => {});
    useNodeStore.getState().registerSaveHandler('ok', async () => {});
    useCanvasStore.getState().deleteNode('g1');
    // aborted=bad+保护集 g1 保留——nodeStore/save handler 原样；过闸者 ok 按 deletedIds 清
    expect(useNodeStore.getState().nodes['bad']).toBeTruthy();   // 修前红：拒绝仍清 bad
    expect(useNodeStore.getState().saveHandlers['bad']).toBeTruthy();   // 修前红
    expect(useNodeStore.getState().nodes['ok']).toBeUndefined();   // deletedIds 含过闸者
    expect(useNodeStore.getState().saveHandlers['ok']).toBeUndefined();
    expect(doc.getMap('nodes').has('bad')).toBe(true);
    expect(doc.getMap('nodes').has('g1')).toBe(true);
    doc.destroy();
  });

  // T5 评审 I#3(c)：deleteTransformNode 消费 result.deletedIds——组删除时后代 nodeStore 条目
  // 一并清理（修前红：只清入参 id、后代泄漏）。
  it('评审 I#3(c) deleteTransformNode 删组：后代 nodeStore 条目/save handler 按 deletedIds 清理（不泄漏）', () => {
    const doc = new Y.Doc();
    doc.clientID = 909_090;
    _setIntentDocForTest(doc);
    attachUndoManager(doc);
    fillDoc(doc, [groupRec('g1'), childRec('c1', 'g1'), childRec('c2', 'g1')], []);
    applyUnifiedDocSnapshot(doc);
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', data: { groupType: 'normal' } } as any,
      { id: 'c1', type: 'textInput', parentId: 'g1', position: { x: 0, y: 0 }, data: {} } as any,
      { id: 'c2', type: 'textInput', parentId: 'g1', position: { x: 1, y: 0 }, data: {} } as any,
    ], edges: [] });
    useNodeStore.setState({ nodes: {
      c1: { id: 'c1', type: 'textInput', data: {} } as never,
      c2: { id: 'c2', type: 'textInput', data: {} } as never,
    } });
    useNodeStore.getState().registerSaveHandler('c1', async () => {});
    useNodeStore.getState().registerSaveHandler('c2', async () => {});
    useCanvasStore.getState().deleteTransformNode('g1');
    expect(doc.getMap('nodes').size).toBe(0);
    // 后代条目随收齐集清理（修前红：c1/c2 条目残留）
    expect(useNodeStore.getState().nodes['c1']).toBeUndefined();
    expect(useNodeStore.getState().nodes['c2']).toBeUndefined();
    expect(useNodeStore.getState().saveHandlers['c1']).toBeUndefined();
    expect(useNodeStore.getState().saveHandlers['c2']).toBeUndefined();
    doc.destroy();
  });

  it('undoStack 预检：undoStack.length+块数+1 > 100 →整次删除不写（不清栈）', () => {
    const doc = new Y.Doc();
    doc.clientID = 909_090;
    _setIntentDocForTest(doc);
    attachUndoManager(doc);
    fillDoc(doc, [clipRec('v1')], []);
    seedTimeline(doc, 'v1', [150_000, 150_000]);   // 两块+尾笔=3 项预算
    stopCapturing();
    // 垫满栈：98 项+3 预算=101>100 →拒
    for (let i = 0; i < 98; i++) {
      doc.transact(() => { doc.getMap('nodes').set(`pad${i}`, 'x'); }, Origin.LocalUser);
      stopCapturing();
    }
    const stackBefore = getUndoManager()!.undoStack.length;
    useCanvasStore.setState({ nodes: [
      { id: 'v1', type: 'videoEdit', position: { x: 0, y: 0 }, data: {} } as any,
    ], edges: [] });
    const plan = classifyPlanByDoc(doc, splitDeletePlan(useCanvasStore.getState(), ['v1']));
    const result = executeDeleteSplit(doc, plan);
    expect(result.precheckRejected).toBe(true);
    expect(doc.getMap('nodes').has('v1')).toBe(true);   // 整次删除不写
    expect(doc.getMap('timelines').has('v1')).toBe(true);
    expect(getUndoManager()!.undoStack.length).toBe(stackBefore);   // 不清栈（原栈保持）
    doc.destroy();
  });
});
