// apps/api/src/modules/collab/collab-timeline-collab.int.spec.ts
// Y4a T10（plan 2026-11-20-y4a-timeline-domain Task 10——spec §9 协作锚 2/4/7/8/9）：
// 双 client 协作端到端 int spec——装置=dual-client-server（E40 现成：真实 WS+cookie 认证+csv/sv
// 版本门+await synced），MockRepo 起始空 doc，节点与时间轴夹具由 A 端事务直写。
// **UndoManager 在本 spec 内直构**（int 装置不能 import apps/web——apps/api tsconfig 无该路径，
// 形态按 brief 指导对齐 web attach 形态）：
//   - 时间轴栈：scope=[该节点 timelines.<nodeId> 子 Map]+trackedOrigins=[UNDO_TIMELINE_ORIGIN]
//     （shared/collab/undo-policy 导出——与 web timelineUndo.ts attachTimelineUndo 同构）；
//   - 画布栈：scope=UNDO_STACK_BASE 三根+trackedOrigins=['local-user']（web canvasUndo.ts
//     Origin.LocalUser 枚举字面量 'local-user'——undo-policy UNDO_TRACKED_ORIGINS 同值钉出处；
//     ySyncPluginKey=对象 origin web 侧构造面直传、int 装置无编辑器面不适用）；
//   - captureTimeout=UNDO_CAPTURE_TIMEOUT_MS(500) 对齐 web 形态；栈长度断言前 stopCapturing
//     防窗合并（生产=afterStructuralChange 断窗，本装置在断言点手动切）。
// 六锚（plan T10 Step 1 :518-526）：
//   ①A 拖 clip（一条 timeline-user 事务）→B 端读回 start=终值（互见锚 2）；
//   ②A undo→B 端读回回滚值（锚 2 后半——undo 事务经真实 WS 同步到 B）；
//   ③域隔离双向（锚 4①②）：timeline-user 事务不动画布栈、local-user 画布事务不动时间轴栈；
//   ④A、B 各加一个 clip 到同一时间轴→两个都在、A undo 只撤 A 的（锚 7 创建唯一性+栈互不吃）；
//   ⑤拖动 transient 形态（锚 8）：B 端 timelines observe 计数在窗内=0（A 本地覆盖层不写 doc），
//     松手一笔（span 标量整值替换）B 端恰一笔终值；
//   ⑥A 删除剪辑节点（shared deleteNodesWithTimelines 原语一笔删节点+边+timelines.<nodeId>）
//     →B 端节点与时间轴同去；A undo→B 端两者同回（锚 9 装回档——画布栈 scope 三根 UNDO_STACK_BASE
//     含 timelines，undo 恢复只复活 scope 之内 item）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as Y from 'yjs';
import {
  UNDO_CAPTURE_TIMEOUT_MS, UNDO_STACK_BASE, UNDO_TIMELINE_ORIGIN,
  seedEmptyTimeline, readTimelineFromDoc, deleteNodesWithTimelines,
  type ProjectData, type VideoClip,
} from '@flowweb/shared';
import { startDualClientServer, type DualClientKit } from '../../test-utils/dual-client-server';
import { pollUntil } from '../../test-utils/poll-until';

/** web canvasUndo.ts Origin.LocalUser 枚举字面量（trackedOrigins 唯一入栈者——undo-policy
 *  UNDO_TRACKED_ORIGINS 同值；int 装置不 import apps/web，字面量钉出处）。 */
const CANVAS_LOCAL_USER = 'local-user';

/** 装置侧夹具：per-kit 双 client（同 doc 名=同一服务端 doc——互见前提）。 */
interface Pair {
  kit: DualClientKit;
  a: { ydoc: Y.Doc; provider: unknown; synced: Promise<void> };
  b: { ydoc: Y.Doc; provider: unknown; synced: Promise<void> };
}

/** 剪辑节点信封（frame-deny NODE_ENVELOPE_KEYS 矩阵——type/position/data）。 */
function videoEditNode(id: string): Y.Map<unknown> {
  return new Y.Map([
    ['type', 'videoEdit'],
    ['position', new Y.Map([['x', 0], ['y', 0]])],
    ['data', new Y.Map()],
  ]);
}

/** A 端布景一笔：剪辑节点+空工程 timelines.<nodeId>（local-user 画布域——seedEmptyTimeline 单源
 *  默认轨 `${nodeId}:video`，不走 diff 保证结构同 seedEmptyTimeline 契约）。 */
function seedProjectDoc(pair: Pair, nodeId: string): void {
  pair.a.ydoc.transact(() => {
    pair.a.ydoc.getMap('nodes').set(nodeId, videoEditNode(nodeId));
    pair.a.ydoc.getMap('timelines').set(nodeId, seedEmptyTimeline(nodeId));
  }, CANVAS_LOCAL_USER);
}

/** 合法 video 片段 ProjectData 形态（谓词键矩阵可过——readTimelineFromDoc 可读回）。 */
function videoClip(id: string, start: number): VideoClip {
  return {
    id, trackId: 'n1:video', type: 'video', start, duration: 5, sourceStart: 0,
    mediaId: `m-${id}`, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    playbackSpeed: 1, keyframes: [],
  };
}

/** A 端一条 timeline-user 事务写一个片段（松手/加片段档——帧谓词/键矩阵合法形态）。 */
function aAddClipTx(pair: Pair, nodeId: string, clip: VideoClip): void {
  const entry = pair.a.ydoc.getMap('timelines').get(nodeId) as Y.Map<unknown>;
  const clips = entry.get('clips') as Y.Map<unknown>;
  pair.a.ydoc.transact(() => {
    const m = new Y.Map();
    m.set('type', 'video');
    m.set('span', { trackId: clip.trackId, start: clip.start, duration: clip.duration, sourceStart: clip.sourceStart });
    m.set('mediaId', clip.mediaId);
    m.set('transform', clip.transform);
    m.set('playbackSpeed', clip.playbackSpeed);
    m.set('keyframes', new Y.Map());
    clips.set(clip.id, m);
  }, UNDO_TIMELINE_ORIGIN);
}

/** B 端读回片段 start（timelines.<nodeId>.clips.<clipId>.span.start——读回三档经 readTimelineFromDoc
 *  单源或直取 span；断言面=span 标量终值）。 */
function bClipStart(pair: Pair, nodeId: string, clipId: string): number | undefined {
  const entry = pair.b.ydoc.getMap('timelines').get(nodeId);
  if (!(entry instanceof Y.Map)) return undefined;
  const clips = entry.get('clips');
  if (!(clips instanceof Y.Map)) return undefined;
  const m = clips.get(clipId);
  if (!(m instanceof Y.Map)) return undefined;
  const span = m.get('span');
  if (typeof span !== 'object' || span === null) return undefined;
  return (span as { start?: number }).start;
}

/** B 端整棵时间轴读回（readTimelineFromDoc 单源——互见/回滚断言用 ProjectData 视图）。 */
function bTimeline(pair: Pair, nodeId: string): ProjectData | null {
  return readTimelineFromDoc(pair.b.ydoc.getMap('timelines').get(nodeId));
}

describe('Y4a T10：双 client 时间轴协作（装置=dual-client-server 真 WS）', () => {
  let pair: Pair;

  beforeAll(async () => {
    const kit = await startDualClientServer();
    // docName 带 project: 前缀（生产约定——裸名 invalid-doc-name）
    pair = { kit, a: kit.connect('project:y4a-t10-collab'), b: kit.connect('project:y4a-t10-collab') };
    await Promise.all([pair.a.synced, pair.b.synced]);
    seedProjectDoc(pair, 'n1');
    // 布景同步到 B（A 布景 local-user 笔经真实 WS——互见前提就位）
    await pollUntil(() => pair.b.ydoc.getMap('timelines').has('n1'), 5_000);
  });

  afterAll(async () => { await pair.kit.dispose(); });

  it('①A 拖 clip→B 互见+②A undo→B 回滚（锚 2 两半）', async () => {
    const aEntry = pair.a.ydoc.getMap('timelines').get('n1') as Y.Map<unknown>;
    // 时间轴栈直构（brief 指导——scope=该节点工程子 Map、trackedOrigins=[timeline-user]、500ms 窗）
    const timelineUm = new Y.UndoManager([aEntry], {
      trackedOrigins: new Set([UNDO_TIMELINE_ORIGIN]),
      captureTimeout: UNDO_CAPTURE_TIMEOUT_MS,
    });
    try {
      // ① A 拖 clip：一条 timeline-user 事务写 c1 start=120（拖动终值）
      aAddClipTx(pair, 'n1', videoClip('c1', 120));
      // B 端读回 start=终值（互见锚 2——真实 WS 同步）
      await pollUntil(() => bClipStart(pair, 'n1', 'c1') === 120, 5_000);
      expect(bClipStart(pair, 'n1', 'c1')).toBe(120);
      timelineUm.stopCapturing();   // 栈长度断言前切窗（brief 纪律）
      expect(timelineUm.undoStack.length).toBe(1);

      // ② A undo→B 端读回回滚值（clip 消失——布景空工程回滚态）
      timelineUm.undo();
      await pollUntil(() => bClipStart(pair, 'n1', 'c1') === undefined, 5_000);
      expect(bTimeline(pair, 'n1')?.clips['c1']).toBeUndefined();
      // 装置活性：A 端 redo 栈恰 1（undo 真弹栈非 no-op）
      expect(timelineUm.redoStack.length).toBe(1);
    } finally {
      timelineUm.destroy();
    }
  }, 20_000);

  it('③域隔离双向（锚 4①②）：timeline-user 事务不动画布栈、local-user 画布事务不动时间轴栈', async () => {
    // 独立节点 n3（隔离夹具——不与锚④的 n1 精确键断言串扰；红因归位：首跑红=③④共用 n1 夹具泄漏）
    seedProjectDoc(pair, 'n3');
    await pollUntil(() => pair.b.ydoc.getMap('timelines').has('n3'), 5_000);
    // 画布栈直构（scope=UNDO_STACK_BASE 三根+trackedOrigins=['local-user']）+时间轴栈（同锚①形态）
    const canvasUm = new Y.UndoManager(
      UNDO_STACK_BASE.map((root) => pair.a.ydoc.getMap(root)),
      { trackedOrigins: new Set([CANVAS_LOCAL_USER]), captureTimeout: UNDO_CAPTURE_TIMEOUT_MS },
    );
    const aEntry = pair.a.ydoc.getMap('timelines').get('n3') as Y.Map<unknown>;
    const timelineUm = new Y.UndoManager([aEntry], {
      trackedOrigins: new Set([UNDO_TIMELINE_ORIGIN]),
      captureTimeout: UNDO_CAPTURE_TIMEOUT_MS,
    });
    try {
      // 锚 4①：timeline-user 事务不动画布栈
      const before = canvasUm.undoStack.length;
      aAddClipTx(pair, 'n3', videoClip('c3-isolate', 0));
      canvasUm.stopCapturing(); timelineUm.stopCapturing();
      expect(canvasUm.undoStack.length).toBe(before);          // 画布栈零增
      expect(timelineUm.undoStack.length).toBe(1);             // 时间轴栈 +1（装置活性）
      // 锚 4②：local-user 画布事务不动时间轴栈
      const tlBefore = timelineUm.undoStack.length;
      pair.a.ydoc.transact(() => {
        pair.a.ydoc.getMap('nodes').set('canvas-only', videoEditNode('canvas-only'));
      }, CANVAS_LOCAL_USER);
      canvasUm.stopCapturing(); timelineUm.stopCapturing();
      expect(timelineUm.undoStack.length).toBe(tlBefore);      // 时间轴栈零增
      expect(canvasUm.undoStack.length).toBe(before + 1);      // 画布栈 +1（装置活性）
    } finally {
      canvasUm.destroy(); timelineUm.destroy();
    }
  }, 20_000);

  it('④两端各加一个 clip→两个都在+A undo 只撤 A 的（锚 7：创建唯一性+撤销互不吃）', async () => {
    const aEntry = pair.a.ydoc.getMap('timelines').get('n1') as Y.Map<unknown>;
    const timelineUm = new Y.UndoManager([aEntry], {
      trackedOrigins: new Set([UNDO_TIMELINE_ORIGIN]),
      captureTimeout: UNDO_CAPTURE_TIMEOUT_MS,
    });
    try {
      // A 端加 cA、B 端加 cB（各一条 timeline-user 事务——B 端直构同款事务；两端 B 端首见工程经
      // 布景同步已就位、clips 容器为既有键，只 set 新片段键=锚 7「第二端从不调用给已存在键
      // set 新 Map」这记写不出现——两端各写各的新键）
      aAddClipTx(pair, 'n1', videoClip('cA', 0));
      await pollUntil(() => bClipStart(pair, 'n1', 'cA') === 0, 5_000);   // A 笔先到 B（顺序确定性）
      pair.b.ydoc.transact(() => {
        const bEntry = pair.b.ydoc.getMap('timelines').get('n1') as Y.Map<unknown>;
        const clips = bEntry.get('clips') as Y.Map<unknown>;
        const m = new Y.Map();
        m.set('type', 'video');
        m.set('span', { trackId: 'n1:video', start: 10, duration: 4, sourceStart: 0 });
        m.set('mediaId', 'm-cB');
        m.set('transform', { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
        m.set('playbackSpeed', 1);
        m.set('keyframes', new Y.Map());
        clips.set('cB', m);
      }, UNDO_TIMELINE_ORIGIN);
      // 两个都在（A 端视角收 B 笔）
      await pollUntil(() => {
        const tl = readTimelineFromDoc(pair.a.ydoc.getMap('timelines').get('n1'));
        return tl != null && tl.clips['cA'] !== undefined && tl.clips['cB'] !== undefined;
      }, 5_000);
      expect(Object.keys(bTimeline(pair, 'n1')!.clips).sort()).toEqual(['cA', 'cB']);

      // A undo 只撤 A 的（B 的 cB 不动——远端事务非 tracked origin 进不了 A 的栈、A 栈顶只含 cA 笔）
      timelineUm.stopCapturing();
      const stackBefore = timelineUm.undoStack.length;
      timelineUm.undo();
      await pollUntil(() => bClipStart(pair, 'n1', 'cA') === undefined, 5_000);
      const tlB = bTimeline(pair, 'n1')!;
      expect(tlB.clips['cA']).toBeUndefined();        // A 的被撤销
      expect(tlB.clips['cB']).toBeDefined();          // B 的还在
      expect(timelineUm.undoStack.length).toBe(stackBefore - 1);
    } finally {
      timelineUm.destroy();
    }
  }, 20_000);

  it('⑤拖动 transient（锚 8）：A 本地覆盖层窗内 B 端 timelines 零变化+松手一笔终值', async () => {
    // 布景：A 加 c5 start=0（松手前的已合入状态——diff 基线）
    aAddClipTx(pair, 'n1', videoClip('c5', 0));
    await pollUntil(() => bClipStart(pair, 'n1', 'c5') === 0, 5_000);

    // B 端 timelines observeDeep 计数窗（transient 形态：A 本地覆盖层跟手不写 doc——窗内 B 零 update）
    let timelineUpdates = 0;
    const handler = () => { timelineUpdates += 1; };
    pair.b.ydoc.getMap('timelines').observeDeep(handler);
    try {
      // 拖动过程：A 端本地覆盖层（无 doc 事务——真实拖动 start 覆盖层值序列 1→2→3 全程不写）
      const overlayStarts = [1, 2, 3];
      void overlayStarts;   // 覆盖层=纯本地状态（web editorStore transient 面——int 装置以零事务表达）
      await new Promise((r) => setTimeout(r, 150));   // 窗内停留（真实拖动时长档——装置以 wall clock 表达）
      // B 端窗内零 update（transient 零中间写——锚 8 前半）
      expect(timelineUpdates).toBe(0);

      // 松手：一笔 span 标量整值替换（A 端 c5 span.start=3 终值——span 整值替换非窗合并档，
      // 写前后双 stopCapturing 单独成步=锚 8 后半的撤销栈面在锚①②已锁，本锚断 B 端恰一笔+终值）
      const aEntry = pair.a.ydoc.getMap('timelines').get('n1') as Y.Map<unknown>;
      const clips = aEntry.get('clips') as Y.Map<unknown>;
      const clip = clips.get('c5') as Y.Map<unknown>;
      pair.a.ydoc.transact(() => {
        clip.set('span', { trackId: 'n1:video', start: 3, duration: 5, sourceStart: 0 });
      }, UNDO_TIMELINE_ORIGIN);
      await pollUntil(() => bClipStart(pair, 'n1', 'c5') === 3, 5_000);
      expect(bClipStart(pair, 'n1', 'c5')).toBe(3);   // 松手终值
      // B 端恰一笔（窗内零+松手一笔——observeDeep 计数）
      await new Promise((r) => setTimeout(r, 300));   // 尾部静默窗（防在途 update 迟到误计）
      expect(timelineUpdates).toBe(1);
    } finally {
      pair.b.ydoc.getMap('timelines').unobserveDeep(handler);
    }
  }, 20_000);

  it('⑥A 删剪辑节点（deleteNodesWithTimelines 一笔）→B 端节点与时间轴同去+A undo→两者同回（锚 9 装回档）', async () => {
    // 布景：剪辑节点 n2+空工程（同 seedProjectDoc 形态——n2 键分离防锚①-⑤夹具串扰）
    pair.a.ydoc.transact(() => {
      pair.a.ydoc.getMap('nodes').set('n2', videoEditNode('n2'));
      pair.a.ydoc.getMap('timelines').set('n2', seedEmptyTimeline('n2'));
    }, CANVAS_LOCAL_USER);
    await pollUntil(() => pair.b.ydoc.getMap('timelines').has('n2'), 5_000);

    // 画布栈直构（scope=UNDO_STACK_BASE 三根——timelines 在 scope 内=undo 装回带回节点+时间轴）
    const canvasUm = new Y.UndoManager(
      UNDO_STACK_BASE.map((root) => pair.a.ydoc.getMap(root)),
      { trackedOrigins: new Set([CANVAS_LOCAL_USER]), captureTimeout: UNDO_CAPTURE_TIMEOUT_MS },
    );
    try {
      // A 删节点：shared deleteNodesWithTimelines 原语恰一次事务（local-user——画布栈域）
      deleteNodesWithTimelines(pair.a.ydoc, ['n2'], CANVAS_LOCAL_USER);
      // B 端节点与时间轴同去（锚 9 前半——一笔事务双根同步）
      await pollUntil(() =>
        !pair.b.ydoc.getMap('nodes').has('n2') && !pair.b.ydoc.getMap('timelines').has('n2'), 5_000);
      expect(pair.b.ydoc.getMap('nodes').has('n2')).toBe(false);
      expect(pair.b.ydoc.getMap('timelines').has('n2')).toBe(false);

      // A undo→B 端两者同回（锚 9 装回档——scope 含 timelines：节点+时间轴都复活）
      canvasUm.stopCapturing();
      expect(canvasUm.undoStack.length).toBeGreaterThanOrEqual(1);
      canvasUm.undo();
      await pollUntil(() =>
        pair.b.ydoc.getMap('nodes').has('n2') && pair.b.ydoc.getMap('timelines').has('n2'), 5_000);
      expect(pair.b.ydoc.getMap('nodes').has('n2')).toBe(true);
      expect(pair.b.ydoc.getMap('timelines').has('n2')).toBe(true);
    } finally {
      canvasUm.destroy();
    }
  }, 20_000);
});
