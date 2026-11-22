// apps/web/src/pages/canvas/video-editor/store/editorStore.timeline.spec.ts
// Y4a T4 fix round（评审回包 I#2/I#3——spec §0 条 5）：editorStore 的 timeline-user doc 写路径
// 行为锁——拒绝回滚（I#2）+拖动松手结算（I#3）。真实 yjs 装置（doc ref 登记+真 timelineUndo 模块——
// 与 editorStore.test.ts 的纯本地态面分立：那套 vi.mock('@/stores/canvasUndo') 只锁本地语义，
// 本套锁 doc 管线端到端（loadProject→store 动作→doc 落笔/拒绝/回滚）。
// Y4a T7（spec §0 条 5/条 7 + §4）：水合/写穿/拖动覆盖层/重绑四组——loadProject 改 doc 水合
// （键不在不创建）、undo/redo 改道 timelineUndo/timelineRedo、transient=本地覆盖层零 doc 笔、
// 根键监听换 Map 重绑（先 clear() 再销毁旧 manager）与键删除关编辑器、observeDeep 只 setState。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { readTimelineFromDoc, toReadModel } from '@flowweb/shared';

vi.mock('antd', () => ({ message: { warning: vi.fn(), error: vi.fn() } }));
vi.mock('../timeline/auto-edges', () => ({ ensureAutoEdges: vi.fn() }));
vi.mock('@/stores/canvasUndo', () => ({ stopCapturing: vi.fn() }));

import { useEditorStore } from './editorStore';
import { setTimelineDocRef, attachTimelineUndo, detachTimelineUndo, getTimelineUndoManager } from '@/stores/timelineUndo';

/** 钉死 clientID。 */
const LIVE = 909_090;

/** 造一棵 seedEmptyTimeline 同族工程 Map（version/fps/单默认轨/clips 空 Map——local-user 事务集成）。 */
function buildEntry(): Y.Map<unknown> {
  const track = new Y.Map();
  track.set('type', 'video'); track.set('name', '视频');
  track.set('muted', false); track.set('hidden', false); track.set('order', '5000');
  const tracks = new Y.Map(); tracks.set('n1:video', track);
  const entry = new Y.Map();
  entry.set('version', 1); entry.set('fps', 30);
  entry.set('tracks', tracks); entry.set('clips', new Y.Map());
  return entry;
}

/** 装置（T4 旧形态保留——I#2/I#3 两组仍消费）：真 live doc（timelines 根 n1 一棵工程 Map）
 *  +doc ref 登记+store 直装（REST 形态 loadProject）+时间轴栈挂接。 */
function setupDocState(opts?: { fat?: boolean }): {
  live: Y.Doc; entry: Y.Map<unknown>; clips: Y.Map<unknown>;
} {
  const live = new Y.Doc();
  live.clientID = LIVE;
  setTimelineDocRef(live);
  const timelines = live.getMap('timelines');
  live.transact(() => { timelines.set('n1', buildEntry()); }, 'local-user');
  const entry = timelines.get('n1') as Y.Map<unknown>;
  const clips = entry.get('clips') as Y.Map<unknown>;
  if (opts?.fat) {
    // 摆入大片段（text 300K——软闸拒制造器；装置直写 origin=null 不入栈）
    live.transact(() => {
      const fat = new Y.Map();
      fat.set('type', 'subtitle');
      fat.set('span', { trackId: 'n1:video', start: 0, duration: 1 });
      fat.set('text', 'Z'.repeat(300_000));
      fat.set('visible', true);
      fat.set('style', { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 });
      clips.set('fat', fat);
    }, null as unknown as string);
  }
  // store 装载（T7 后 loadProject=doc 水合同一入口——REST 形态退役）
  useEditorStore.getState().loadProject('n1');
  return { live, entry, clips };
}

/** 装置（T7 新水合形态）：live doc 装一棵两轨三片段工程 → loadProject('n1') 走 doc 水合。 */
function setupHydrated(): {
  live: Y.Doc; timelines: Y.Map<unknown>; entry: Y.Map<unknown>; clips: Y.Map<unknown>;
} {
  const live = new Y.Doc();
  live.clientID = LIVE;
  setTimelineDocRef(live);
  const timelines = live.getMap('timelines');
  // 两轨三片段工程（视频轨两片+音频轨一片——track.clips 推导字段不落 doc）
  live.transact(() => {
    const vTrack = new Y.Map();
    vTrack.set('type', 'video'); vTrack.set('name', '视频');
    vTrack.set('muted', false); vTrack.set('hidden', false); vTrack.set('order', '5000');
    const aTrack = new Y.Map();
    aTrack.set('type', 'audio'); aTrack.set('name', '音频');
    aTrack.set('muted', false); aTrack.set('hidden', false); aTrack.set('order', '5001');
    const tracks = new Y.Map();
    tracks.set('n1:video', vTrack); tracks.set('n1:audio', aTrack);
    const c1 = new Y.Map();
    c1.set('type', 'video');
    c1.set('span', { trackId: 'n1:video', start: 5, duration: 3, sourceStart: 0 });
    c1.set('mediaId', 'm1'); c1.set('playbackSpeed', 1);
    c1.set('transform', { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
    c1.set('keyframes', new Y.Map());
    const c2 = new Y.Map();
    c2.set('type', 'image');
    c2.set('span', { trackId: 'n1:video', start: 0, duration: 2 });
    c2.set('mediaId', 'm2');
    c2.set('transform', { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
    c2.set('keyframes', new Y.Map());
    const c3 = new Y.Map();
    c3.set('type', 'audio');
    c3.set('span', { trackId: 'n1:audio', start: 1, duration: 2, sourceStart: 0 });
    c3.set('mediaId', 'm3'); c3.set('volume', 1);
    c3.set('fade', { in: 0, out: 0 }); c3.set('playbackSpeed', 1);
    c3.set('keyframes', new Y.Map());
    const clips = new Y.Map();
    clips.set('c1', c1); clips.set('c2', c2); clips.set('c3', c3);
    const entry = new Y.Map();
    entry.set('version', 1); entry.set('fps', 30);
    entry.set('tracks', tracks); entry.set('clips', clips);
    timelines.set('n1', entry);
  }, 'local-user');
  const entry = timelines.get('n1') as Y.Map<unknown>;
  const clips = entry.get('clips') as Y.Map<unknown>;
  useEditorStore.getState().loadProject('n1');
  return { live, timelines, entry, clips };
}

/** 稳定序列化（键排序——collab-canary-semantic stableStringify 同族口径的本地实现）。 */
function stable(v: unknown): string {
  const walk = (x: unknown): unknown => {
    if (x instanceof Y.Map) {
      const o: Record<string, unknown> = {};
      for (const [k, val] of [...x.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) o[k] = walk(val);
      return o;
    }
    if (x instanceof Y.Array) return x.toArray().map(walk);
    return x;
  };
  return JSON.stringify(walk(v));
}

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.getState().reset();
});

afterEach(() => {
  detachTimelineUndo();
  setTimelineDocRef(null);
});

describe('Y4a T4 fix I#2：执行器拒绝→本地状态回滚（不砖死 doc 写链）', () => {
  it('软闸拒绝（对既有大片段写 300K 新 text）→store data 回 prev、栈不长；下一笔合法编辑写成功且 diff 不含被拒 delta', () => {
    const { live, clips } = setupDocState({ fat: true });
    const before = useEditorStore.getState().data!;
    const stackLen = getTimelineUndoManager()!.undoStack.length;
    // 这笔会超软闸：对 fat 写 300K **新值** text（forward>262144）→ 执行器拒
    useEditorStore.getState().updateClip('fat', { text: 'Y'.repeat(300_000) });
    const s1 = useEditorStore.getState();
    expect(s1.data).toBe(before);                                   // 本地回滚（修前：保持已拒态=next）
    expect(getTimelineUndoManager()!.undoStack.length).toBe(stackLen);   // 被拒不入栈
    expect((clips.get('fat') as Y.Map<unknown>).get('text')).toBe('Z'.repeat(300_000));   // doc 侧维持原值
    // 下一笔合法编辑：before 重读 doc 真值（不含被拒 delta——修前被拒 delta 留在本地→每次 diff 复含→复拒砖死）
    const id = useEditorStore.getState().addClip({ type: 'image', mediaId: 'm1', trackId: 'n1:video', start: 0 });
    expect(id).toBeTruthy();
    const s2 = useEditorStore.getState();
    expect(s2.data!.clips[id!]).toBeDefined();          // 本地新片段
    const docData = readTimelineFromDoc(live.getMap('timelines').get('n1'))!;
    expect(docData.clips[id!]).toBeDefined();           // doc 落笔成功
    expect(docData.clips.fat!.type).toBe('subtitle');  // 被拒 delta 未复含（fat 保持原值）
    const fatEntry = (live.getMap('timelines').get('n1') as Y.Map<unknown>);
    const fatText = ((fatEntry.get('clips') as Y.Map<unknown>).get('fat') as Y.Map<unknown>).get('text');
    expect(fatText).toBe('Z'.repeat(300_000));          // doc 侧 fat 原值未动
    live.destroy();
  });
});

describe('Y4a T4 fix I#3：拖动松手（endTransient）=span-gesture 一笔落 doc——单独成步不进 500ms 窗', () => {
  it('真实手势路径：addClip→beginTransient→moveClip transient→endTransient→doc 落笔+时间轴栈独立成步（前后双 stopCapturing）', () => {
    const { live, clips } = setupDocState();
    const id = useEditorStore.getState().addClip({ type: 'image', mediaId: 'm1', trackId: 'n1:video', start: 0 });
    expect(id).toBeTruthy();
    expect(getTimelineUndoManager()!.undoStack.length).toBe(1);   // addClip 一笔结构步
    // 拖动松手（真实 UI 路径——TimelinePanel.tsx:169 pointerup 同源）：rAF 级 transient 不落 doc
    useEditorStore.getState().beginTransient();
    useEditorStore.getState().moveClip(id!, 8, undefined, { transient: true });
    expect(getTimelineUndoManager()!.undoStack.length).toBe(1);   // transient 过程零 doc 笔
    const spanBefore = (clips.get(id!) as Y.Map<unknown>).get('span') as Record<string, unknown>;
    expect(spanBefore.start).toBe(0);                             // doc 未落（修前 endTransient 不结算 doc）
    expect(useEditorStore.getState().endTransient()).toBe(true);
    // 松手一笔落 doc（修前：doc 无此笔——delta 被吸进下一笔无关 commit）
    const span = (clips.get(id!) as Y.Map<unknown>).get('span') as Record<string, unknown>;
    expect(span.start).toBe(8);
    // 单独成步（span-gesture 前后双 stopCapturing——不进 500ms 窗、不并入 addClip 步）
    expect(getTimelineUndoManager()!.undoStack.length).toBe(2);
    // undo 一步回拖动前：doc span 回到 start=0
    const um = getTimelineUndoManager()!;
    um.undo();
    const spanBack = (clips.get(id!) as Y.Map<unknown>).get('span') as Record<string, unknown>;
    expect(spanBack.start).toBe(0);
    // 复原（装置清理——redo 不影响后续断言）
    um.redo();
    live.destroy();
  });

  it('无位移拖动（down-up 零 delta）→endTransient 不落 doc、栈不动', () => {
    const { live } = setupDocState();
    const id = useEditorStore.getState().addClip({ type: 'image', mediaId: 'm1', trackId: 'n1:video', start: 0 });
    useEditorStore.getState().beginTransient();
    // pointerup 无位移（真实 UI pointerMovedOnce 门——零 delta 不入历史不落 doc）
    expect(useEditorStore.getState().endTransient()).toBe(false);
    expect(getTimelineUndoManager()!.undoStack.length).toBe(1);   // 只有 addClip 一笔
    void id;
    live.destroy();
  });
});

// ══════════ Y4a T7（spec §0 条 5/条 7 + §4）：水合/写穿/拖动覆盖层/重绑四组 ══════════

describe('Y4a T7 ①水合：loadProject=doc 水合（键不在不创建工程）', () => {
  it('doc 里 timelines.<nodeId> 两轨三片段 → loadProject(nodeId) → data 等价 readTimelineFromDoc（track.clips 推导排序已生成）+attachTimelineUndo 已挂+status ready', () => {
    const { live, entry } = setupHydrated();
    const s = useEditorStore.getState();
    expect(s.status).toBe('ready');
    expect(s.sourceNodeId).toBe('n1');
    expect(s.data).toEqual(readTimelineFromDoc(entry));   // track.clips 由读回推导（c2 start=0 在 c1 start=5 前）
    expect(s.data!.tracks.map((t) => t.id)).toEqual(['n1:video', 'n1:audio']);   // 读回 order 排序
    expect(s.data!.tracks[0].clips).toEqual(['c2', 'c1']);   // start 排序推导（0 在 5 前）
    expect(getTimelineUndoManager()).not.toBeNull();   // attachTimelineUndo 已挂当前 entry
    live.destroy();
  });

  it('键不存在 → loadProject 返 false 不创建不抛：status 停 loading、timelines 根零新键、无栈挂接', () => {
    const live = new Y.Doc();
    live.clientID = LIVE;
    setTimelineDocRef(live);
    const timelines = live.getMap('timelines');
    live.transact(() => { timelines.set('other', buildEntry()); }, 'local-user');
    useEditorStore.setState({ status: 'loading' });
    expect(useEditorStore.getState().loadProject('missing')).toBe(false);
    const s = useEditorStore.getState();
    expect(s.status).toBe('loading');   // 不进 ready——键不在=编辑器无工程可开
    expect(s.data).toBeNull();
    expect([...timelines.keys()]).toEqual(['other']);   // 键不在不创建工程（spec §0 条 7）
    expect(getTimelineUndoManager()).toBeNull();   // 无栈挂接
    live.destroy();
  });

  it('doc ref 缺席（无协作会话）→ loadProject 不水合不抛（status 停 loading——离线无 doc 可读）', () => {
    const live = new Y.Doc();
    live.clientID = LIVE;
    setTimelineDocRef(live);
    const timelines = live.getMap('timelines');
    live.transact(() => { timelines.set('n1', buildEntry()); }, 'local-user');
    setTimelineDocRef(null);   // 会话已拆——编辑器无 doc 面
    useEditorStore.setState({ status: 'loading' });
    expect(useEditorStore.getState().loadProject('n1')).toBe(false);
    expect(useEditorStore.getState().status).toBe('loading');
    live.destroy();
  });
});

describe('Y4a T7 ②写穿 roundtrip：commit→doc→observeDeep→setState 读回；undo/redo 改道 timelineUndo/timelineRedo', () => {
  it('commit 加 clip → doc clips Map 新键+span 标量+keyframes 空 Map；observeDeep 读回 setState 等价 readTimelineFromDoc', () => {
    const { live, clips } = setupHydrated();
    const beforeKeys = [...clips.keys()];
    const id = useEditorStore.getState().addClip({ type: 'image', mediaId: 'm9', trackId: 'n1:video', start: 9 });
    expect(id).toBeTruthy();
    // doc 落笔形态：新键+span 标量+keyframes 空 Map
    const m = clips.get(id!) as Y.Map<unknown>;
    expect(m).toBeInstanceOf(Y.Map);
    expect(m.get('span')).toEqual({ trackId: 'n1:video', start: 9, duration: 5 });
    expect(m.get('keyframes')).toBeInstanceOf(Y.Map);
    expect((m.get('keyframes') as Y.Map<unknown>).size).toBe(0);
    expect([...clips.keys()].length).toBe(beforeKeys.length + 1);
    // 读回等价（observeDeep→readTimelineFromDoc→setState——本地 data=doc 真值投影）
    const docData = readTimelineFromDoc(live.getMap('timelines').get('n1'))!;
    expect(useEditorStore.getState().data).toEqual(docData);
    expect(useEditorStore.getState().data!.clips[id!]).toBeDefined();
    live.destroy();
  });

  it('undo → doc 回到 before（stableStringify 一致）+本地读回同步；redo → doc 复原', () => {
    const { live, timelines, clips } = setupHydrated();
    const beforeStable = stable(timelines.get('n1'));
    const id = useEditorStore.getState().addClip({ type: 'image', mediaId: 'm9', trackId: 'n1:video', start: 9 });
    expect(clips.has(id!)).toBe(true);
    // editorStore.undo=timelineUndo()——弹栈后 doc 装回 before
    expect(useEditorStore.getState().undo()).toBe(true);
    expect(stable(timelines.get('n1'))).toBe(beforeStable);   // doc 回到 before（stableStringify 一致）
    expect(clips.has(id!)).toBe(false);
    expect(useEditorStore.getState().data!.clips[id!]).toBeUndefined();   // 本地读回同步（undo 后 setState）
    // redo=timelineRedo()——doc 复原
    expect(useEditorStore.getState().redo()).toBe(true);
    expect(clips.has(id!)).toBe(true);
    expect(useEditorStore.getState().data!.clips[id!]).toBeDefined();
    live.destroy();
  });

  it('undo 改道断言：无栈项时 undo() 返 false 不动 doc；时间轴栈吃 timeline-user 笔', () => {
    const { live, clips } = setupHydrated();
    // 水合后零编辑零栈项——undo 返 false
    expect(useEditorStore.getState().undo()).toBe(false);
    const id = useEditorStore.getState().addClip({ type: 'image', mediaId: 'm9', trackId: 'n1:video', start: 9 });
    expect(getTimelineUndoManager()!.undoStack.length).toBe(1);   // timeline-user 一笔
    useEditorStore.getState().selectClip(id!);
    expect(useEditorStore.getState().undo()).toBe(true);
    expect(clips.has(id!)).toBe(false);
    expect(useEditorStore.getState().selectedClipId).toBeNull();   // 历史跳转后选中不残留
    live.destroy();
  });

  it('拖拽中 Ctrl+Z：undo 弹栈作废进行中覆盖层（endTransient 不落 bogus 笔）', () => {
    const { live, clips } = setupHydrated();
    const id = useEditorStore.getState().addClip({ type: 'image', mediaId: 'm9', trackId: 'n1:video', start: 9 });
    const stackBefore = getTimelineUndoManager()!.undoStack.length;
    useEditorStore.getState().beginTransient();
    useEditorStore.getState().moveClip(id!, 20, undefined, { transient: true });
    // 拖拽中撤销：undo 弹掉 addClip 那笔——observeDeep 读回同步（覆盖层随历史跳转作废）
    expect(useEditorStore.getState().undo()).toBe(true);
    expect(clips.has(id!)).toBe(false);   // addClip 已被撤销
    // I#1（fix round 2）：本地读回同步——undo 事务落笔时抑制窗必须已关（修前 null 化在
    // timelineUndo 之后→读回早退→data 仍含 transient 幽灵片段）
    expect(useEditorStore.getState().data!.clips[id!]).toBeUndefined();
    expect(useEditorStore.getState().endTransient()).toBe(false);   // 不产生 bogus 覆盖层笔
    expect(getTimelineUndoManager()!.undoStack.length).toBe(stackBefore - 1);   // 只有弹掉的那笔
    live.destroy();
  });

  it('m#7：拖拽中 undo/redo 被拒（两向空栈）→覆盖层保留（抑制窗活着+松手仍落笔+镜像不破）', () => {
    const { live, clips } = setupHydrated();
    // 夹具纪律：水合后 undo/redo 两向天然空栈（种子=local-user、UndoManager 只跟 timeline-user）、
    // c1 在 start 5——直接拖 c1，不先 addClip 再 undo 到底（那会弹掉刚加的片段、moveClip 对已删 id
    // 返 false——红落在错误原因上）
    useEditorStore.getState().selectClip('c1');
    useEditorStore.getState().beginTransient();
    expect(useEditorStore.getState().moveClip('c1', 20, undefined, { transient: true })).toBe(true);
    const overlay = useEditorStore.getState().pendingOverlay;
    // 两向被拒（空栈）：覆盖层保留——模块变量按引用放回、镜像不动、不写 state
    expect(useEditorStore.getState().undo()).toBe(false);
    expect(useEditorStore.getState().redo()).toBe(false);
    const s1 = useEditorStore.getState();
    expect(s1.pendingOverlay).toBe(overlay);   // 镜像仍是刚才那个对象（同引用——TimelinePanel 仍认为手势在进行）
    expect(s1.selectedClipId).toBe('c1');   // 被拒不 set——选中不残留清除
    expect(getTimelineUndoManager()!.undoStack.length).toBe(0);   // 两向栈长仍 0
    expect(getTimelineUndoManager()!.redoStack.length).toBe(0);
    expect(s1.data!.clips.c1!.start).toBe(20);   // 本地 transient 终值保持
    // remote-peer 把 c2 的 start 写成 0.5（装置直写同款先例 :359）——读回被抑制（抑制窗活着）
    live.transact(() => {
      const c2 = clips.get('c2') as Y.Map<unknown>;
      c2.set('span', { ...(c2.get('span') as Record<string, unknown>), start: 0.5 });
    }, 'remote-peer');
    const s2 = useEditorStore.getState();
    expect(s2.data!.clips.c1!.start).toBe(20);   // 本地 transient 不被远端合入砸掉
    expect(s2.data!.clips.c2!.start).toBe(0);   // 读回被抑制（修前：模块变量已空→远端整表读回盖掉本地）
    // 松手：组合基线一笔落 doc——c1 终值 20、c2 远端值留在 doc（diff 不含未改键）
    expect(useEditorStore.getState().endTransient()).toBe(true);
    const c1Span = (clips.get('c1') as Y.Map<unknown>).get('span') as Record<string, unknown>;
    const c2Span = (clips.get('c2') as Y.Map<unknown>).get('span') as Record<string, unknown>;
    expect(c1Span.start).toBe(20);   // 手势笔落 doc
    expect(c2Span.start).toBe(0.5);   // 远端值留在 doc（diff 不含未改键）
    expect(useEditorStore.getState().pendingOverlay).toBeNull();   // 镜像闭口
    expect(getTimelineUndoManager()!.undoStack.length).toBe(1);   // 松手恰一笔
    live.destroy();
  });
});

describe('Y4a T7 ③拖动覆盖层（spec §0 条 5）：transient 零 doc 笔；松手组合基线一笔；并发删除丢覆盖层', () => {
  it('transient 改 start → 对端 doc 观察回调零触发；松手 commit → 对端见终值、栈恰 +1（span-gesture 单独成步）', () => {
    const { live, clips } = setupHydrated();
    // c1 [5,8) / c2 [0,2) 占位 → 新片 start=9 落 [9,14) 空位（addClip 落笔位）
    const id = useEditorStore.getState().addClip({ type: 'image', mediaId: 'm9', trackId: 'n1:video', start: 9 });
    const spanAfterAdd = (clips.get(id!) as Y.Map<unknown>).get('span') as Record<string, unknown>;
    const placedStart = spanAfterAdd.start as number;
    const stackAfterAdd = getTimelineUndoManager()!.undoStack.length;
    // 对端装置：另一 doc 同步链上挂观察回调（观察计数器——transient 全程零触发）
    const remote = new Y.Doc();
    let remoteObserved = 0;
    remote.getMap('timelines').observeDeep(() => { remoteObserved++; });
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(live));
    const observedAtSync = remoteObserved;
    // transient rAF 级：本地覆盖层跟手，过程中不写 doc（两步中间值都远端不可见）
    useEditorStore.getState().beginTransient();
    useEditorStore.getState().moveClip(id!, 20, undefined, { transient: true });
    useEditorStore.getState().moveClip(id!, 22, undefined, { transient: true });
    expect(remoteObserved).toBe(observedAtSync);   // 零中间写（spec 锚 8）
    const spanMid = (clips.get(id!) as Y.Map<unknown>).get('span') as Record<string, unknown>;
    expect(spanMid.start).toBe(placedStart);   // doc 未落（transient 全程保持 addClip 落笔位）
    // 松手结算：组合基线（doc 已合入状态叠覆盖层）作 before、UI 终值作 after → 一笔 span-gesture
    expect(useEditorStore.getState().endTransient()).toBe(true);
    const span = (clips.get(id!) as Y.Map<unknown>).get('span') as Record<string, unknown>;
    expect(span.start).toBe(22);   // 对端终值
    const spanRemote = ((remote.getMap('timelines').get('n1') as Y.Map<unknown>).get('clips') as Y.Map<unknown>).get(id!) as Y.Map<unknown>;
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(live));   // 松手后一次性拉平（松手前零中间帧断言已完毕）
    expect(spanRemote).toBeTruthy();
    // 栈恰 +1：松手=span 标量但同一次手势单独成步（事务前后双 stopCapturing——不走 500ms 窗）
    expect(getTimelineUndoManager()!.undoStack.length).toBe(stackAfterAdd + 1);
    // undo 一步回拖动前
    useEditorStore.getState().undo();
    const spanBack = (clips.get(id!) as Y.Map<unknown>).get('span') as Record<string, unknown>;
    expect(spanBack.start).toBe(placedStart);
    remote.destroy();
    live.destroy();
  });

  it('diff 基线=doc 已合入状态叠覆盖层——远端并发改过的另一片段键不被写回', () => {
    const { live, clips } = setupHydrated();
    // c1 建于 [5,8)：远端把 c1 的 start 改 6（装置直写——本地 data 因覆盖层抑制读回仍不知）
    const idA = useEditorStore.getState().addClip({ type: 'image', mediaId: 'm9', trackId: 'n1:video', start: 9 });
    useEditorStore.getState().beginTransient();   // 手势开始——observeDeep 读回抑制（覆盖层不可被远端合入砸掉）
    live.transact(() => {
      const c1 = clips.get('c1') as Y.Map<unknown>;
      c1.set('span', { ...(c1.get('span') as Record<string, unknown>), start: 6 });
    }, 'remote-peer');
    // 本地只拖 clip A（覆盖层不含 c1——本地 data 里 c1.start 仍是 5）
    useEditorStore.getState().moveClip(idA!, 20, undefined, { transient: true });
    expect(useEditorStore.getState().endTransient()).toBe(true);
    // commit 后 c1 在 doc 里仍是 6（远端值不被写回——组合基线=手势开始时 doc 已合入状态叠覆盖层）
    const c1Span = (clips.get('c1') as Y.Map<unknown>).get('span') as Record<string, unknown>;
    expect(c1Span.start).toBe(6);
    const aSpan = (clips.get(idA!) as Y.Map<unknown>).get('span') as Record<string, unknown>;
    expect(aSpan.start).toBe(20);
    live.destroy();
  });

  it('并发删除（片段键已没了）→ 松手丢覆盖层：doc 不写、本地回拖动前态、栈不加步', () => {
    const { live, clips } = setupHydrated();
    const id = useEditorStore.getState().addClip({ type: 'image', mediaId: 'm9', trackId: 'n1:video', start: 0 });
    const stackBefore = getTimelineUndoManager()!.undoStack.length;
    useEditorStore.getState().beginTransient();
    useEditorStore.getState().moveClip(id!, 8, undefined, { transient: true });
    // 远端并发删掉这个片段键
    live.transact(() => { clips.delete(id!); }, null as unknown as string);
    expect(useEditorStore.getState().endTransient()).toBe(false);   // 丢覆盖层（手势作废）
    const s = useEditorStore.getState();
    expect(clips.has(id!)).toBe(false);   // doc 不写（远端删除保持）
    expect(s.data!.clips[id!]).toBeUndefined();   // 本地读回同步（覆盖层丢弃）
    expect(getTimelineUndoManager()!.undoStack.length).toBe(stackBefore);   // 栈不加步
    live.destroy();
  });

  it('并发删除（轨道键已没了）→ 松手同样丢覆盖层', () => {
    const { live, entry, clips } = setupHydrated();
    const id = useEditorStore.getState().addClip({ type: 'image', mediaId: 'm9', trackId: 'n1:video', start: 0 });
    useEditorStore.getState().beginTransient();
    useEditorStore.getState().moveClip(id!, 8, undefined, { transient: true });
    // 远端并发删掉目标轨
    live.transact(() => {
      (entry.get('tracks') as Y.Map<unknown>).delete('n1:video');
      clips.delete(id!); clips.delete('c1'); clips.delete('c2');
    }, null as unknown as string);
    expect(useEditorStore.getState().endTransient()).toBe(false);   // 轨道键没了——丢覆盖层
    expect(clips.has(id!)).toBe(false);
    live.destroy();
  });
});

describe('Y4a T7 ④重绑（spec §0 条 7）：根键监听捕获 Map 替换/删除；observeDeep 只 setState 不 commit', () => {
  it('手动 set 新 Map 换掉 entry → 根键监听捕获 → 旧 manager clear 后销毁（不可对脱离 Map undo）、重绑当前 Map、栈从空开始、覆盖层作废', () => {
    const { live, timelines, clips } = setupHydrated();
    const oldEntry = timelines.get('n1') as Y.Map<unknown>;
    const oldUm = getTimelineUndoManager()!;
    // 造一个栈项+一个进行中覆盖层（重绑时都该作废）
    const id = useEditorStore.getState().addClip({ type: 'image', mediaId: 'm9', trackId: 'n1:video', start: 0 });
    useEditorStore.getState().beginTransient();
    useEditorStore.getState().moveClip(id!, 5, undefined, { transient: true });
    expect(oldUm.undoStack.length).toBe(1);
    // 远端换掉整棵 Map（合法=另一端删键再建——装置直接 set 新 Map 模拟）
    const fresh = buildEntry();
    live.transact(() => { timelines.delete('n1'); timelines.set('n1', fresh); }, null as unknown as string);
    // 重绑已发生（loadProject 订阅的根键监听捕获）——新 manager≠旧 manager、栈空、旧 manager destroyed
    const newUm = getTimelineUndoManager()!;
    expect(newUm).not.toBe(oldUm);
    expect(oldUm.undoStack.length + oldUm.redoStack.length).toBe(0);   // clear() 已调——旧栈两向全清
    // 旧 manager destroyed：直接调旧 manager.undo() 不再动 doc（clear 后无栈项——对脱离 Map 无可 undo）
    const docStableBefore = stable(timelines.get('n1'));
    oldUm.undo();
    expect(stable(timelines.get('n1'))).toBe(docStableBefore);   // 旧 manager 对已脱离父键的 Map 无作为
    expect(newUm.undoStack.length).toBe(0);   // 时间轴栈从空栈开始
    // 重绑后 data=新 Map 读回（覆盖层作废——moveClip 的 5 不在）
    const s = useEditorStore.getState();
    expect(s.data).toEqual(readTimelineFromDoc(fresh));
    expect(s.data!.clips[id!]).toBeUndefined();   // 覆盖层随旧 Map 作废（新 Map 无此片段）
    // 新 Map 上继续可编辑（写穿对新 entry 生效）
    const id2 = useEditorStore.getState().addClip({ type: 'image', mediaId: 'm8', trackId: 'n1:video', start: 0 });
    expect(id2).toBeTruthy();
    expect(newUm.undoStack.length).toBe(1);
    const newClips = (timelines.get('n1') as Y.Map<unknown>).get('clips') as Y.Map<unknown>;
    expect(newClips.has(id2!)).toBe(true);
    void clips;
    live.destroy();
  });

  it('键删除 → 根键监听捕获 → 编辑器关掉（videoEditorStore.open=false）', async () => {
    const { live, timelines } = setupHydrated();
    const { useVideoEditorStore } = await import('@/stores/videoEditorStore');
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1', miniPlaybackNodeId: null });
    live.transact(() => { timelines.delete('n1'); }, null as unknown as string);
    expect(useVideoEditorStore.getState().open).toBe(false);   // 节点没了——编辑器关掉
    expect(getTimelineUndoManager()).toBeNull();   // 栈随编辑器关掉卸下
    live.destroy();
  });

  it('m#3（fix round 2）：手势中键删除 → 同 doc 重 loadProject → 远端写读回不被残留覆盖层吞掉', () => {
    const { live, timelines } = setupHydrated();
    useEditorStore.getState().beginTransient();
    useEditorStore.getState().moveClip('c1', 42, undefined, { transient: true });
    // 键删除（节点没了）→ 编辑器关掉——模块级覆盖层随之闭口（m#3①：修前根键删除分支不 null 模块变量）
    live.transact(() => { timelines.delete('n1'); }, null as unknown as string);
    // 同 doc 键回来 → 重 loadProject（m#3②：水合入口闭口模块级覆盖层——修前只 null state 镜像）
    live.transact(() => { timelines.set('n1', buildEntry()); }, 'local-user');
    expect(useEditorStore.getState().loadProject('n1')).toBe(true);
    live.transact(() => {   // 远端写一笔轨名标量（最小写面）
      (((timelines.get('n1') as Y.Map<unknown>).get('tracks') as Y.Map<unknown>).get('n1:video') as Y.Map<unknown>).set('name', '远端轨');
    }, 'remote-peer');
    // 读回同步（修前：模块级残留覆盖层吞掉 observeDeep 读回——data 停在水合旧值）
    expect(useEditorStore.getState().data!.tracks.find((t) => t.id === 'n1:video')!.name).toBe('远端轨');
    live.destroy();
  });

  it('observeDeep 回调只 setState 读回、不调用 commit——远端事务零本地回写', () => {
    const { live, entry, clips } = setupHydrated();
    const beforeStack = getTimelineUndoManager()!.undoStack.length;
    const beforeStable = stable(entry);
    // 远端事务（origin 非 timeline-user——不进本地栈）：改一个片段标量
    live.transact(() => {
      const c1 = clips.get('c1') as Y.Map<unknown>;
      c1.set('span', { ...(c1.get('span') as Record<string, unknown>), start: 42 });
    }, 'remote-peer');
    // observeDeep 回调只 setState：本地 data 读回远端值（不 commit——doc 无第二笔写入）
    expect(useEditorStore.getState().data!.clips.c1!.start).toBe(42);
    // doc 只有远端那一笔：无本地回写（stable 与「仅远端改后」一致——若 observe 触发 commit 会多一笔 span 写回）
    expect(stable(entry)).not.toBe(beforeStable);
    const span = (clips.get('c1') as Y.Map<unknown>).get('span') as Record<string, unknown>;
    expect(span.start).toBe(42);   // 远端值原样在 doc——无本地 commit 覆写
    expect(getTimelineUndoManager()!.undoStack.length).toBe(beforeStack);   // 本地栈不动（远端 origin 不入栈+无回写）
    live.destroy();
  });
});

describe('Y4a T7 ⑤创建唯一性（spec 锚 7）：第二端不给已存在键 set 新 Map；两端同 Map 各加片段互不吃栈', () => {
  it('两端（编辑器+对端装置）同 Map 各加一个片段 → 两个都在、撤销互不吃对方栈', () => {
    const { live, clips } = setupHydrated();
    const remote = new Y.Doc();
    remote.clientID = 555_555;
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(live));
    // 双向同步装置（live→remote / remote→live）
    live.on('update', (u: Uint8Array) => { if (live.clientID !== 555_555) Y.applyUpdate(remote, u); });
    remote.on('update', (u: Uint8Array) => { Y.applyUpdate(live, u); });
    // 对端先加 clip R（remote 事务）
    remote.transact(() => {
      const rEntry = remote.getMap('timelines').get('n1') as Y.Map<unknown>;
      const rClips = rEntry.get('clips') as Y.Map<unknown>;
      const r = new Y.Map();
      r.set('type', 'image');
      r.set('span', { trackId: 'n1:video', start: 20, duration: 2 });
      r.set('mediaId', 'mr');
      r.set('transform', { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
      r.set('keyframes', new Y.Map());
      rClips.set('r1', r);
    }, 'remote-peer');
    // 本地编辑器后加 clip L
    const localId = useEditorStore.getState().addClip({ type: 'image', mediaId: 'm9', trackId: 'n1:video', start: 9 });
    expect(localId).toBeTruthy();
    // 两个都在（本地栈视角：本地的 addClip 一笔）
    const data = readTimelineFromDoc(live.getMap('timelines').get('n1'))!;
    expect(data.clips['r1']).toBeDefined();
    expect(data.clips[localId!]).toBeDefined();
    expect(getTimelineUndoManager()!.undoStack.length).toBe(1);   // 只有本地一笔（timeline-user）
    // 本地 undo 只撤自己的笔：r1 仍在、localId 没了
    useEditorStore.getState().undo();
    const data2 = readTimelineFromDoc(live.getMap('timelines').get('n1'))!;
    expect(data2.clips['r1']).toBeDefined();   // 互不吃对方栈
    expect(data2.clips[localId!]).toBeUndefined();
    // 编辑器从不「给已存在键 set 新 Map」：loadProject 重入同一键零形态变化（同名根同对象——不 set）
    const stableBefore = stable(live.getMap('timelines'));
    useEditorStore.getState().loadProject('n1');
    expect(stable(live.getMap('timelines'))).toBe(stableBefore);
    remote.destroy();
    live.destroy();
  });
});

describe('Y4a T7 ②′公开零泄漏（spec 锚 12）：toReadModel 输出键集不含 timelines（结构性）', () => {
  it('doc 带 timelines 根+工程内容 → toReadModel 输出键集无 timelines（结构性断言——非剔除后比对）', () => {
    const { live } = setupHydrated();
    const out = toReadModel(live);
    expect(Object.keys(out).sort()).toEqual(['edges', 'nodes']);   // 公开读模型里根本没有 timelines
    live.destroy();
  });
});
