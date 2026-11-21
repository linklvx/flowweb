// apps/web/src/stores/timelineUndo.spec.ts
// Y4a T4（plan 2026-11-20-y4a-timeline-domain Task 4——spec §0 条 1/2/5）：撤销闸执行器+时间轴栈
// ——两帧量法接入 editorStore 写路径。全部真实 yjs 装置（Y.Doc/Y.UndoManager——非 mock）。
//
// 六档（brief Step 1）：
// ①一笔加 clip：forwardBytes/undoBytes 均 ≤262144→写入成功、时间轴栈 +1；
// ②伪造超限事务（大 text 片段——标量域唯一可扩字段）→拒绝、live doc 不写、栈不变；
// ③clientID 顺序档：applyUpdate 之后设 temp.clientID=live.clientID（先设再 applyUpdate 会被
//   yjs 静默换号 transaction.js:357-360）——正序保持/逆序换号双断言；
// ④切块（v3 收紧——按合成帧复测）：清空大时间轴→单笔两帧量法拒；逐片段档（captureTimeout:0
//   逐笔记两帧）→贪心挑候选→候选箱落笔前在临时 doc 写成一笔复测两帧、超了把最后一片移出再量→
//   每箱一条事务、箱间 stopCapturing、全树清空成功；单片段任一帧仍超→整笔拒 doc 不动；
//   切比例不拆多笔（超限整笔拒绝）；不用 chunkCopyPlan 预算（utf8 JSON 预算负控）；
// ⑤栈项装回记账（spec §0 条 5——捕获策略记账，不实现 openCapture 重放）：两笔片段删除各成一步
//   不合成一个栈项（各自写前后 stopCapturing 断言）；两笔标量整值替换落进同一 500ms 窗→栈项装回
//   字节=两笔 undoBytes 之和；下一笔会越闸（栈顶已记+这笔 undoBytes>RESTORE_GATE_BYTES）→先被
//   stopCapturing 切开（单独成步断言）；pending 不继承（update 写完就清断言——下一笔不带上一笔
//   的数）；undo 读装回字节>RESTORE_GATE_BYTES→不弹栈档；负控：把正向 update 用 applyUpdate 灌进
//   克隆再 undo、字节≠measureTransactionFrames 的 undoBytes（applyUpdate 强制 transaction.local=
//   false :1688-1691、收栈只看 origin :3662-3668——用来禁止把 openCapture 重放加回来）；双向抄档
//   （spec §0 条 5）：删除→undo→redo→再 undo——新 redo 栈项与再生成的新 undo 栈项要么已抄回装回
//   字节、要么再撤销被闸拦住（缺失当 0 放行=负控钉死）；高 clock 合并窗档（§0 条 5 锁「和是保守
//   的」）：高 clock 文档上约 30 笔标量整值替换落同一捕获窗→live 上这一下撤销的未包装字节≤记录的
//   累加值且≤NORMAL_FRAME_GATE_BYTES（合帧不会比各笔逆操作之和更大到穿硬闸——由测试锁死而非口头
//   声明）；贴闸档（评审第 4 条）：同一捕获窗里把记账装回字节累到 518000 以上（多笔大标量）
//   →live 上这一下撤销的未包装字节仍≤524288——不过才把撤销按钮闸从 520192 下调、数字以实测为准；
// ⑥域隔离三行为（spec §4）：timeline-user 事务不动画布栈；LocalUser 画布事务不动时间轴栈；
//   删除→装回后 stableStringify 与删除前一致（无并发档）。
//
// 字节口径：未包装 update byteLength（与 guardSyncFrame payload.byteLength 同族）。
// 大标量负载=text 整段（span/transform/fade 等其余标量槽=类型化有限字段不可扩——codec spanOf
// 只取 trackId/start/duration/sourceStart，多出键被剥=零 diff；subtitle text 为唯一可扩字段）。
// UndoManager captureTimeout 用真时器（setTimeout）——同窗合并档以连写驱动真实 500ms 窗语义
// （每笔执行器含两份 temp doc 克隆 ~几 ms，30 笔总时长远小于窗——不 sleep）。
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import {
  UNDO_TIMELINE_ORIGIN, UNDO_CAPTURE_TIMEOUT_MS, RESTORE_GATE_BYTES,
  TIMELINE_CHUNK_UNDO_BUDGET, measureTransactionFrames, deleteTimelineClips,
  readTimelineFromDoc, diffProjectDataToDoc,
  type ProjectData, type SubtitleClip,
} from '@flowweb/shared';
import { Origin, attachUndoManager, detachUndoManager, stopCapturing } from './canvasUndo';
import {
  attachTimelineUndo, detachTimelineUndo, timelineStopCapturing, timelineUndo,
  timelineRedo, clearTimelineStackOf, getTimelineUndoManager, getStackItemRestoreBytes,
  clearAllTimelineClips, executeTimelineCommit, setPendingTimelineRestoreBytes,
} from './timelineUndo';
import * as timelineUndoModule from './timelineUndo';

vi.mock('antd', () => ({ message: { warning: vi.fn(), error: vi.fn() } }));

const HARD_GATE = 524_288;                 // NORMAL_FRAME_GATE_BYTES
const SOFT = TIMELINE_CHUNK_UNDO_BUDGET;   // 262144
/** 钉死 clientID（随机 clientID 改变 varuint 宽度、闸边界会抖——全夹具钉死）。 */
const T1 = 111_111, T2 = 222_222, LIVE = 909_090;

/** 装置：live doc + 画布栈 + 时间轴栈（nodeId='n1' 一棵工程 Map）。
 *  工程创建=LocalUser 一笔（画布栈域——T5 addNode 形态同族）；入口四键+默认轨（codec seed 同族）。 */
function setup(): {
  live: Y.Doc; timelines: Y.Map<unknown>; entry: Y.Map<unknown>;
  clips: Y.Map<unknown>; canvasUm: Y.UndoManager; timelineUm: Y.UndoManager;
} {
  const live = new Y.Doc();
  live.clientID = LIVE;
  const canvasUm = attachUndoManager(live);
  const timelines = live.getMap('timelines');
  live.transact(() => { timelines.set('n1', seedEntry()); }, Origin.LocalUser);
  stopCapturing();   // 画布域断窗（创建笔与后续 LocalUser 事务各自成步——断言口径与生产 afterStructuralChange 同源）
  const entry = timelines.get('n1') as Y.Map<unknown>;
  const timelineUm = attachTimelineUndo('n1', entry);
  const clips = entry.get('clips') as Y.Map<unknown>;
  return { live, timelines, entry, clips, canvasUm, timelineUm };
}

/** 空工程入口 Map（seedEmptyTimeline 同族形态——version/fps/tracks/clips 四键+默认轨）。 */
function seedEntry(): Y.Map<unknown> {
  const track = new Y.Map();
  track.set('type', 'video'); track.set('name', '视频');
  track.set('muted', false); track.set('hidden', false); track.set('order', '5000');
  const tracks = new Y.Map();
  tracks.set('n1:video', track);
  const entry = new Y.Map();
  entry.set('version', 1); entry.set('fps', 30);
  entry.set('tracks', tracks); entry.set('clips', new Y.Map());
  return entry;
}

/** 合法 video 片段（ProjectData 形态——diff/codec 可写、谓词可过）。 */
function projClip(id: string, start = 0): SubtitleClip {
  return {
    id, trackId: 'n1:video', type: 'subtitle', start, duration: 1,
    text: `字幕-${id}`, visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 },
  };
}

/** 大 text 负载（subtitle text=标量域唯一可扩字段——spanOf 会剥多出键、其余槽类型化有限）。 */
const bigText = (pad: number, tag = '') => `Z${tag}`.padEnd(pad, 'Z');

/** live 单帧字节观察器（undo() 后本端 update——未包装口径）。 */
const frameProbe = (doc: Y.Doc): { get: () => number } => {
  let last = 0;
  doc.on('update', (u: Uint8Array) => { last = u.byteLength; });
  return { get: () => last };
};

/** 工程当前真值读回（editorStore.commit 组合基线同款——doc truth read-back）。 */
const docTruth = (live: Y.Doc): ProjectData => {
  const before = readTimelineFromDoc(live.getMap('timelines').get('n1'));
  if (before === null) throw new Error('fixture: entry unreadable');
  return before;
};

/** 执行器一笔提交（editorStore.commit 同管线——kind 分捕获档）。 */
const commitToDoc = (
  live: Y.Doc, mutate: (d: ProjectData) => ProjectData,
  kind: 'structural' | 'scalar' | 'span-gesture',
): boolean => executeTimelineCommit(live, {
  nodeId: 'n1', before: docTruth(live), after: mutate(docTruth(live)), kind,
});

/** 执行器单笔预检量（undoBytes——与写入同一 diff 管线）。 */
function executeMeasure(live: Y.Doc, mutate: (truth: ProjectData) => ProjectData): number {
  const truth = docTruth(live);
  const after = mutate(truth);
  const buildOps = (timelines: Y.Map<unknown>) => diffProjectDataToDoc(timelines, 'n1', truth, after);
  const m = measureTransactionFrames(live, (temp) => {
    temp.transact((tx) => { for (const op of buildOps(temp.getMap('timelines'))) op(tx); }, UNDO_TIMELINE_ORIGIN);
  }, { trackedOrigins: [UNDO_TIMELINE_ORIGIN] });
  return m.undoBytes;
}

afterEach(() => {
  detachTimelineUndo();
  detachUndoManager();
});

// ─────────────────── ①② 量法闸（正向+逆操作两帧——软闸 262144） ───────────────────

describe('Y4a T4 ①② 量法闸：一笔编辑两帧任一超 262144 拒、live 不写', () => {
  it('① 一笔加 clip 两帧 ≤262144→写入成功、时间轴栈 +1（画布栈不动——域隔离基线）', () => {
    const { live, timelineUm, canvasUm, clips } = setup();
    const ok = commitToDoc(live, (d) => ({
      ...d, clips: { ...d.clips, c1: projClip('c1') },
    }), 'structural');
    expect(ok).toBe(true);
    expect(clips.size).toBe(1);
    expect(timelineUm.undoStack.length).toBe(1);   // ① 时间轴栈 +1
    expect(canvasUm.undoStack.length).toBe(1);     // 工程创建那笔 LocalUser（stopCapturing 前入栈=1——创建时捕获的画布域事务；timeline-user 编辑不动画布栈）
    live.destroy();
  });

  it('② 伪造超限事务（大 text 片段写入）→两帧量法拒、live 不写、栈不变', () => {
    const { live, timelineUm, clips } = setup();
    timelineStopCapturing();
    const stackBefore = timelineUm.undoStack.length;
    const ok = commitToDoc(live, (d) => ({
      ...d, clips: { ...d.clips, 'c-big': { ...projClip('c-big'), text: bigText(300_000) } },
    }), 'structural');
    expect(ok).toBe(false);                        // 量法拒（forward>262144）
    expect(clips.size).toBe(0);                    // live 不写
    expect(timelineUm.undoStack.length).toBe(stackBefore);   // 栈不变
    live.destroy();
  });

  it('②b 大 text 标量整值替换超限→拒、live 不写、栈不变（scalar 档直接形态）', () => {
    const { live, timelineUm, clips } = setup();
    commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, c0: projClip('c0') } }), 'structural');
    timelineStopCapturing();
    const stackBefore = timelineUm.undoStack.length;
    const before = docTruth(live);
    const c0 = before.clips.c0! as SubtitleClip;
    const ok = executeTimelineCommit(live, {
      nodeId: 'n1', before,
      after: { ...before, clips: { ...before.clips, c0: { ...c0, text: bigText(300_000, 'x') } } },
      kind: 'scalar',
    });
    expect(ok).toBe(false);                        // 量法拒
    expect((clips.get('c0') as Y.Map<unknown>).get('text')).toBe('字幕-c0');   // live 不写
    expect(timelineUm.undoStack.length).toBe(stackBefore);
    live.destroy();
  });
});

// ─────────────────── ③ clientID 顺序档（量法忠实性） ───────────────────

describe('Y4a T4 ③ clientID 顺序档（temp.clientID 保持断言）', () => {
  it('正序（applyUpdate 之后设）穿过测量事务保持钉死值；逆序（先设再 applyUpdate）被 yjs 静默换号', () => {
    const live = new Y.Doc();
    live.clientID = LIVE;
    live.transact(() => { live.getMap('nodes').set('a', 1); }, Origin.LocalUser);
    // 正序：applyUpdate 之后、任何事务之前——measureTransactionFrames 内部同款
    const temp = new Y.Doc();
    Y.applyUpdate(temp, Y.encodeStateAsUpdate(live));
    temp.clientID = live.clientID;
    temp.transact(() => { temp.getMap('nodes').set('b', 1); }, Origin.LocalUser);
    expect(temp.clientID).toBe(LIVE);
    // 逆序：先设再 applyUpdate——入状态里已有该 clientID，yjs 静默换号（transaction.js:357-360）
    const temp2 = new Y.Doc();
    temp2.clientID = LIVE;
    Y.applyUpdate(temp2, Y.encodeStateAsUpdate(live));
    expect(temp2.clientID).not.toBe(LIVE);   // 被换号——量出来的会是另一个 client 的帧
    live.destroy(); temp.destroy(); temp2.destroy();
  });
});

// ─────────────────── ④ 切块（合成帧复测——spec §0 条 1 条目 ①-⑦） ───────────────────

/** 大时间轴夹具（420 片段、两写入 client 交错——timeline-gate.spec ④ 同族形态）。 */
function buildLargeTimeline(): { live: Y.Doc; clipIds: string[] } {
  const w1 = new Y.Doc(); const w2 = new Y.Doc();
  w1.clientID = T1; w2.clientID = T2;
  w1.transact(() => { w1.getMap('timelines').set('n1', seedEntry()); }, 'timeline-user');
  Y.applyUpdate(w2, Y.encodeStateAsUpdate(w1));
  for (let c = 0; c < 420; c++) {
    const author = c % 2 === 0 ? w1 : w2;
    author.transact(() => {
      const entry = author.getMap('timelines').get('n1') as Y.Map<unknown>;
      const clip = new Y.Map();
      clip.set('type', 'video');
      clip.set('span', { trackId: 'n1:video', start: c, duration: 1, sourceStart: 0 });
      clip.set('transform', { x: c, y: c, scale: 1, rotation: 0, opacity: 1 });
      clip.set('mediaId', `m${c}`);
      clip.set('playbackSpeed', 1);
      const kfs = new Y.Map();
      for (let k = 0; k < 6; k++) kfs.set(`kf${c}_${k}`, { id: `kf${c}_${k}`, t: k, property: 'x', value: k, easing: 'linear' });
      clip.set('keyframes', kfs);
      (entry.get('clips') as Y.Map<unknown>).set(`c${c}`, clip);
    }, 'local-user');
  }
  const live = new Y.Doc();
  live.clientID = LIVE;
  Y.applyUpdate(live, Y.encodeStateAsUpdate(w1));
  Y.applyUpdate(live, Y.encodeStateAsUpdate(w2));
  const clipIds = [...(((live.getMap('timelines').get('n1') as Y.Map<unknown>).get('clips') as Y.Map<unknown>).keys())];
  w1.destroy(); w2.destroy();
  return { live, clipIds };
}

describe('Y4a T4 ④ 切块（合成帧复测——spec §0 条 1 条目 ①-⑦）', () => {
  it('清空大时间轴：单笔两帧拒→逐片段量→贪心装箱+合成帧复测→每箱一笔、箱间 stopCapturing、全树清空成功、逐块 undo ≤524288', () => {
    const { live, clipIds } = buildLargeTimeline();
    const canvasUm = attachUndoManager(live);
    const entry = live.getMap('timelines').get('n1') as Y.Map<unknown>;
    const clips = entry.get('clips') as Y.Map<unknown>;
    const timelineUm = attachTimelineUndo('n1', entry);
    expect(clips.size).toBe(420);
    // (a) 单笔量法：整树一笔两帧超软闸→拒（算法 ① 档）
    const single = measureTransactionFrames(live, (temp) =>
      deleteTimelineClips(temp, 'n1', clipIds, UNDO_TIMELINE_ORIGIN), { trackedOrigins: [UNDO_TIMELINE_ORIGIN] });
    expect(single.forwardBytes > SOFT || single.undoBytes > SOFT).toBe(true);
    // (b) 切块清空（算法 ①-⑦——合成帧复测在箱落笔前跑）
    const ok = clearAllTimelineClips(live, 'n1');
    expect(ok).toBe(true);
    expect(clips.size).toBe(0);   // 全树清空成功
    // (c) 每箱一笔、箱间 stopCapturing：时间轴栈每箱各自成步
    expect(timelineUm.undoStack.length).toBeGreaterThan(1);
    // 表征（实测 2026-11-21 yjs 13.6.32）：420 片段→3 箱——box[0] restoreBytes=262005（419 片段
    // 一箱、两帧≤262144）、box[1]/box[2]=626（逐片移出复测落单各自成箱）；数字记入 task-4 报告
    // (d) 逐块 undo：每块 live 未包装撤销帧 ≤524288（硬闸——贴闸档同族）
    const probe = frameProbe(live);
    let maxUndo = 0;
    while (timelineUm.undoStack.length > 0) {
      expect(timelineUndo()).toBe(true);
      maxUndo = Math.max(maxUndo, probe.get());
    }
    expect(maxUndo).toBeLessThanOrEqual(HARD_GATE);
    timelineUm.destroy(); canvasUm.destroy(); live.destroy();
  });

  it('单片段任一帧>262144：整笔拒绝、doc 不动（算法 ③ 档）', () => {
    const { live, timelineUm, clips } = setup();
    // 摆入大片段（装置——origin=null 不进栈）：text 撑过软闸（装回帧=整片段内容）
    const fat = new Y.Map();
    fat.set('type', 'subtitle');
    fat.set('span', { trackId: 'n1:video', start: 0, duration: 1 });
    fat.set('text', bigText(300_000));
    fat.set('visible', true);
    fat.set('style', { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 });
    live.transact(() => { clips.set('fat', fat); }, null as unknown as string);
    timelineStopCapturing();
    const stackBefore = timelineUm.undoStack.length;
    const m = measureTransactionFrames(live, (temp) =>
      deleteTimelineClips(temp, 'n1', ['fat'], UNDO_TIMELINE_ORIGIN), { trackedOrigins: [UNDO_TIMELINE_ORIGIN] });
    expect(m.undoBytes).toBeGreaterThan(SOFT);   // 单片段逆操作超
    const ok = clearAllTimelineClips(live, 'n1');
    expect(ok).toBe(false);                        // 整笔拒
    expect(clips.has('fat')).toBe(true);           // doc 不动
    expect(timelineUm.undoStack.length).toBe(stackBefore);
    live.destroy();
  });

  it('复合路径（executeTimelineCommit——removeTrack 形）：删集含超限片段→切块计划拒绝→live 完全未动（轨条目仍在+片段仍在）——计划先行原子性', () => {
    // 评审回包 I#1 红锚：复合 structural（轨道删除+片段删除）超限时切块计划必须先于 rest 落笔——
    // 修前 rest（删轨）先写、chunkClipDeletes ③ 拒后孤片段悬挂已删轨。
    const live = new Y.Doc();
    live.clientID = LIVE;
    const timelines = live.getMap('timelines');
    live.transact(() => { timelines.set('n1', seedEntry()); }, Origin.LocalUser);
    stopCapturing();
    const entry = timelines.get('n1') as Y.Map<unknown>;
    const timelineUm = attachTimelineUndo('n1', entry);
    const clips = entry.get('clips') as Y.Map<unknown>;
    const tracks = entry.get('tracks') as Y.Map<unknown>;
    // 摆入两个片段：fat（text 300K——单片段逆操作超 262144）+ normal（普通）
    const fat = new Y.Map();
    fat.set('type', 'subtitle');
    fat.set('span', { trackId: 'n1:video', start: 0, duration: 1 });
    fat.set('text', bigText(300_000));
    fat.set('visible', true);
    fat.set('style', { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 });
    const normal = new Y.Map();
    normal.set('type', 'subtitle');
    normal.set('span', { trackId: 'n1:video', start: 5, duration: 1 });
    normal.set('text', '字幕-normal');
    normal.set('visible', true);
    normal.set('style', { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 });
    live.transact(() => { clips.set('fat', fat); clips.set('normal', normal); }, null as unknown as string);
    timelineStopCapturing();
    const stackBefore = timelineUm.undoStack.length;
    const before = docTruth(live);
    expect(before.clips.fat).toBeDefined();
    // 复合笔：删两片段+删轨（removeTrack 同族形态——structural 超限走切块、删集含 fat）
    const ok = executeTimelineCommit(live, {
      nodeId: 'n1', before,
      after: { ...before, clips: {}, tracks: [] },
      kind: 'structural',
    });
    expect(ok).toBe(false);   // 删集含超限片段→切块计划 ③ 拒→整笔拒
    // 复合原子性：live 完全未动（修前：rest 已删轨→孤片段悬挂已删轨）
    expect(tracks.has('n1:video')).toBe(true);       // 轨条目仍在
    expect(clips.has('fat')).toBe(true);             // 片段仍在
    expect(clips.has('normal')).toBe(true);
    expect(timelineUm.undoStack.length).toBe(stackBefore);   // 栈不动
    // store 侧不毒化：下一笔合法编辑（before 重读 doc 真值）diff 不含被拒 delta、写成功
    const before2 = docTruth(live);
    const ok2 = executeTimelineCommit(live, {
      nodeId: 'n1', before: before2,
      after: { ...before2, clips: { ...before2.clips, extra: projClip('extra') } },
      kind: 'structural',
    });
    expect(ok2).toBe(true);
    expect(clips.size).toBe(3);   // fat+normal+extra——被拒笔的 delta 未复含
    timelineUm.destroy(); live.destroy();
  });

  it('切比例（canvasSize）超限=整笔拒绝、不拆多笔（算法 ⑦ 档）；不用 chunkCopyPlan 预算（⑥ 负控）', () => {
    const { live, entry } = setup();
    expect(commitToDoc(live, (d) => ({ ...d, canvasSize: { width: 1, height: 1 } }), 'scalar')).toBe(true);
    const before = entry.get('canvasSize');
    // 伪造超限标量帧（大 text 标量替换——标量档超限执行器整笔拒、无切块退路）
    const truth = docTruth(live);
    commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, sub: projClip('sub') } }), 'structural');
    const truth2 = docTruth(live);
    const sub = truth2.clips.sub! as SubtitleClip;
    const ok = executeTimelineCommit(live, {
      nodeId: 'n1', before: truth2,
      after: { ...truth2, clips: { ...truth2.clips, sub: { ...sub, text: bigText(300_000, 'c') } } },
      kind: 'scalar',
    });
    expect(ok).toBe(false);                        // 超限=整笔拒绝（标量档不拆多笔——同⑦切比例语义）
    expect(entry.get('canvasSize')).toBe(before);  // live 保持原值（超限笔未写）
    // ⑥ 负控锚：切块算法消费 yjs 两帧量法——实现面零 chunkCopyPlan（utf8 JSON 预算）引用
    const src = timelineUndoModule as unknown as Record<string, unknown>;
    expect(src.chunkCopyPlan).toBeUndefined();
    expect(typeof src.clearAllTimelineClips).toBe('function');
    live.destroy();
  });
});

// ─────────────────── ⑤ 栈项装回记账（spec §0 条 5——两张表） ───────────────────

describe('Y4a T4 ⑤ 栈项装回记账（spec §0 条 5——捕获策略，不实现 openCapture）', () => {
  it('捕获窗常量：captureTimeout=UNDO_CAPTURE_TIMEOUT_MS(500)（同源单源）', () => {
    expect(UNDO_CAPTURE_TIMEOUT_MS).toBe(500);
    // attachTimelineUndo 构造面引 UNDO_CAPTURE_TIMEOUT_MS 单源（行为由同窗合并/切开各档锁定）
  });

  it('两笔片段删除各成一步不合成一个栈项（各自写前后 stopCapturing）', () => {
    const { live, timelineUm, clips } = setup();
    commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, a: projClip('a') } }), 'structural');
    commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, b: projClip('b') } }), 'structural');
    // structural 档写前后双 stopCapturing——两笔各自成步（非窗合并）
    expect(timelineUm.undoStack.length).toBe(2);
    const del = (d: ProjectData, id: string): ProjectData => {
      const clipsNext = { ...d.clips };
      delete clipsNext[id];
      return { ...d, clips: clipsNext };
    };
    expect(commitToDoc(live, (d) => del(d, 'a'), 'structural')).toBe(true);
    expect(commitToDoc(live, (d) => del(d, 'b'), 'structural')).toBe(true);
    expect(clips.size).toBe(0);
    expect(timelineUm.undoStack.length).toBe(4);   // +2 各自一步（写前后 stopCapturing 切开——非合成一个栈项）
    live.destroy();
  });

  it('span-gesture 档（拖动松手——评审回包 I#3）：同一手势单独成步、不进 500ms 窗——前接一笔 scalar 窗内笔也不并入', () => {
    const { live, timelineUm } = setup();
    commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, a: projClip('a') } }), 'structural');
    timelineStopCapturing();
    const lenBefore = timelineUm.undoStack.length;
    // 先一笔 scalar（窗内——营造「下一笔若不加切会并窗」的对照）
    expect(commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, a: { ...d.clips.a!, text: bigText(400, 'w') } } }), 'scalar')).toBe(true);
    // 拖动松手（span 整值替换——span-gesture 档写前后双 stopCapturing、不并入 scalar 窗项）
    expect(commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, a: { ...d.clips.a!, start: 9 } } }), 'span-gesture')).toBe(true);
    expect(timelineUm.undoStack.length).toBe(lenBefore + 2);   // scalar 窗项+span-gesture 独立项（非并入）
    // 紧随的 scalar 又开新窗（gesture 已断窗——不吸进 gesture 步）
    expect(commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, a: { ...d.clips.a!, text: bigText(400, 'x') } } }), 'scalar')).toBe(true);
    expect(timelineUm.undoStack.length).toBe(lenBefore + 3);
    live.destroy();
  });

  it('两笔标量整值替换同一 500ms 窗→栈项装回字节=两笔 undoBytes 之和（stack-item-updated 增量累加）', () => {
    const { live, timelineUm } = setup();
    commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, a: projClip('a') } }), 'structural');
    timelineStopCapturing();
    const lenBefore = timelineUm.undoStack.length;
    const text1 = bigText(800, 'a');
    const text2 = bigText(800, 'b');
    // 预检两笔 undoBytes（执行器同款 diff 管线）
    const m1 = executeMeasure(live, (t) => ({ ...t, clips: { ...t.clips, a: { ...t.clips.a!, text: text1 } } }));
    expect(commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, a: { ...d.clips.a!, text: text1 } } }), 'scalar')).toBe(true);
    const m2 = executeMeasure(live, (t) => ({ ...t, clips: { ...t.clips, a: { ...t.clips.a!, text: text2 } } }));
    expect(commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, a: { ...d.clips.a!, text: text2 } } }), 'scalar')).toBe(true);
    expect(timelineUm.undoStack.length).toBe(lenBefore + 1);   // 合并=一个栈项（500ms 窗内连写）
    const item = timelineUm.undoStack[timelineUm.undoStack.length - 1]!;
    const recorded = getStackItemRestoreBytes(item);
    expect(recorded).toBeGreaterThan(0);
    // 栈项装回字节=两笔 undoBytes 之和（±容差 varuint 边界）
    expect(Math.abs(recorded - (m1 + m2))).toBeLessThanOrEqual(16);
    live.destroy();
  });

  it('下一笔会越闸（栈顶已记+这笔 undoBytes>RESTORE_GATE_BYTES）→先被 stopCapturing 切开、单独成步', () => {
    const { live, timelineUm } = setup();
    commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, a: projClip('a') } }), 'structural');
    timelineStopCapturing();
    // 窗口积累：30 笔标量（每笔 undoBytes≈17.43K——第 i 笔恢复 i−1 文本、首笔微小；30 笔后
    // top≈513.2K——第 30 笔预检 495.9+17.43=513.3K≤520192 全合并不切；实测数字见 task-4 报告）
    for (let i = 0; i < 30; i++) {
      const text = bigText(17_400, String(i));
      expect(commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, a: { ...d.clips.a!, text } } }), 'scalar')).toBe(true);
    }
    const windowItems = timelineUm.undoStack.length;   // 结构项+窗口项
    const topBefore = timelineUm.undoStack[timelineUm.undoStack.length - 1]!;
    const topRecorded = getStackItemRestoreBytes(topBefore);
    expect(topRecorded).toBeGreaterThan(RESTORE_GATE_BYTES - 262_144);   // 窗口项记账已达「下一笔可越闸」量级
    // 触发笔：top(≈513.3K)+这笔(≈17.43K)=530.7K>520192 → 执行器写前预检切开、单独成步
    const trigger = bigText(17_400, 'T');
    expect(commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, a: { ...d.clips.a!, text: trigger } } }), 'scalar')).toBe(true);
    expect(timelineUm.undoStack.length).toBe(windowItems + 1);   // 单独成步（不并入窗口项）
    const splitItem = timelineUm.undoStack[timelineUm.undoStack.length - 1]!;
    expect(splitItem).not.toBe(topBefore);
    expect(getStackItemRestoreBytes(splitItem)).toBeGreaterThan(0);   // 自己的 undoBytes（非窗口之和）
    live.destroy();
  });

  it('undo 读装回字节>RESTORE_GATE_BYTES→不弹栈、doc 保持删除态', () => {
    const { live, timelineUm, clips } = setup();
    // 摆入大片段（装置）：删除后 undo 装回帧>RESTORE_GATE_BYTES——装回字节经低级登记面注入
    const fat = new Y.Map();
    fat.set('type', 'subtitle');
    fat.set('span', { trackId: 'n1:video', start: 0, duration: 1 });
    fat.set('text', bigText(600_000));
    fat.set('visible', true);
    fat.set('style', { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 });
    live.transact(() => { clips.set('fat', fat); }, null as unknown as string);
    timelineStopCapturing();
    // 预检量这笔删除的 undoBytes（编排器同款）+低级登记面注入
    const m = measureTransactionFrames(live, (temp) =>
      deleteTimelineClips(temp, 'n1', ['fat'], UNDO_TIMELINE_ORIGIN), { trackedOrigins: [UNDO_TIMELINE_ORIGIN] });
    expect(m.undoBytes).toBeGreaterThan(RESTORE_GATE_BYTES);
    setPendingTimelineRestoreBytes(m.undoBytes);
    live.transact(() => { clips.delete('fat'); }, UNDO_TIMELINE_ORIGIN);
    expect(clips.has('fat')).toBe(false);
    const topItem = timelineUm.undoStack[timelineUm.undoStack.length - 1]!;
    expect(getStackItemRestoreBytes(topItem)).toBeGreaterThan(RESTORE_GATE_BYTES);
    const stackLen = timelineUm.undoStack.length;
    expect(timelineUndo()).toBe(false);            // 不弹栈
    expect(clips.has('fat')).toBe(false);          // doc 保持删除态
    expect(timelineUm.undoStack.length).toBe(stackLen);
    live.destroy();
  });

  it('pending 不继承：update 写完立刻清——零帧事务不挂账、下一笔不带上一笔的数', () => {
    const { live, timelineUm } = setup();
    commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, a: projClip('a') } }), 'structural');
    // 编排登记后事务零帧（删缺 id）——afterTransaction 无条件清挂、不落到下一笔
    setPendingTimelineRestoreBytes(5_000);
    live.transact(() => {
      const entry = live.getMap('timelines').get('n1') as Y.Map<unknown>;
      (entry.get('clips') as Y.Map<unknown>).delete('missing-id');
    }, UNDO_TIMELINE_ORIGIN);
    timelineStopCapturing();
    // 第三笔正常写入成新步——装回字节=第三笔自己的 undoBytes（若零帧挂账被继承则 ≥5000）
    expect(commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, b: projClip('b') } }), 'structural')).toBe(true);
    const items = timelineUm.undoStack;
    const last = items[items.length - 1]!;
    const recorded = getStackItemRestoreBytes(last);
    expect(recorded).toBeGreaterThan(0);          // 本笔 undoBytes 已落（update 回填）
    expect(recorded).toBeLessThan(5_000);          // 零帧挂账 5000 未继承（清挂生效——下一笔不带上一笔的数）
    live.destroy();
  });

  it('负控：applyUpdate 正向灌进克隆——undo() 无栈项（transaction.local=false :1688-1691、收栈只看 origin :3662-3668）——禁 openCapture 重放', () => {
    const { live, clips } = setup();
    commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, a: projClip('a'), b: projClip('b') } }), 'structural');
    let captured: Uint8Array | null = null;
    const h = (u: Uint8Array, origin: unknown) => { if (origin === UNDO_TIMELINE_ORIGIN) captured = u; };
    live.on('update', h);
    const truth = docTruth(live);
    executeTimelineCommit(live, {
      nodeId: 'n1', before: truth,
      after: { ...truth, clips: { b: truth.clips.b! } },   // 只删 a（b 留作正控测量锚）
      kind: 'structural',
    });
    live.off('update', h);
    expect(captured).not.toBeNull();
    expect(clips.has('a')).toBe(false);
    // 克隆：applyUpdate 灌入——applyUpdate 强制 transaction.local=false、origin=undefined（非 tracked）
    const clone = new Y.Doc();
    clone.clientID = T1;
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(live));
    Y.applyUpdate(clone, captured!);   // 删除帧
    const umc = new Y.UndoManager([clone.getMap('timelines')], { captureTimeout: 0, trackedOrigins: new Set([UNDO_TIMELINE_ORIGIN]) });
    expect(umc.undoStack.length).toBe(0);   // 收栈只看 origin——applyUpdate 路线零栈项
    // applyUpdate 路线的「量法」undoBytes=0（undo() 无栈项）——≠真实事务量法的 undoBytes（负控钉死：
    // 用正向帧重放造不出装回帧——openCapture 重放路线结构性不可行）
    const m = measureTransactionFrames(live, (temp) => { Y.applyUpdate(temp, captured!); }, { trackedOrigins: [UNDO_TIMELINE_ORIGIN] });
    expect(m.undoBytes).toBe(0);
    const direct = measureTransactionFrames(live, (temp) =>
      deleteTimelineClips(temp, 'n1', ['b'], UNDO_TIMELINE_ORIGIN), { trackedOrigins: [UNDO_TIMELINE_ORIGIN] });
    expect(direct.undoBytes).toBeGreaterThan(0);   // 真实事务路线>0——两口径不同
    umc.destroy(); clone.destroy(); live.destroy();
  });

  it('双向抄档（spec §0 条 5）：删除→undo→redo→再 undo——新 redo/undo 栈项抄回装回字节（undo/redo 每次 new StackItem 非挪对象）', () => {
    const { live, timelineUm, clips } = setup();
    commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, a: projClip('a') } }), 'structural');
    const truth = docTruth(live);
    expect(executeTimelineCommit(live, {
      nodeId: 'n1', before: truth,
      after: { ...truth, clips: {} },
      kind: 'structural',
    })).toBe(true);
    const undoItem = timelineUm.undoStack[timelineUm.undoStack.length - 1]!;
    const restoreBytes = getStackItemRestoreBytes(undoItem);
    expect(restoreBytes).toBeGreaterThan(0);
    // undo：新 redo 栈项抄回装回字节
    expect(timelineUndo()).toBe(true);
    const redoItem = timelineUm.redoStack[timelineUm.redoStack.length - 1]!;
    expect(getStackItemRestoreBytes(redoItem)).toBe(restoreBytes);
    // redo：新 undo 栈项抄回
    expect(timelineRedo()).toBe(true);
    const reUndoItem = timelineUm.undoStack[timelineUm.undoStack.length - 1]!;
    expect(getStackItemRestoreBytes(reUndoItem)).toBe(restoreBytes);
    // 再 undo：装回字节已抄回——非「缺失当 0」的裸放行（同一次大删除的撤销→重做→再撤销不丢闸）
    expect(clips.has('a')).toBe(false);
    expect(timelineUndo()).toBe(true);
    expect(clips.has('a')).toBe(true);
    live.destroy();
  });

  it('高 clock 合并窗档：约 30 笔标量整值替换同一捕获窗——live 单次撤销未包装字节≤记录累加值且≤524288', () => {
    // 高 clock 文档：装置先把 live clock 拉高（400 笔同 client 小事务）
    const live = new Y.Doc();
    live.clientID = LIVE;
    for (let i = 0; i < 400; i++) {
      live.transact(() => { live.getMap('nodes').set(`k${i}`, i); }, Origin.LocalUser);
    }
    const timelines = live.getMap('timelines');
    live.transact(() => { timelines.set('n1', seedEntry()); }, Origin.LocalUser);
    stopCapturing();
    const entry = timelines.get('n1') as Y.Map<unknown>;
    const timelineUm = attachTimelineUndo('n1', entry);
    // 建一个字幕片段（装置直写——origin=null 不入栈）
    live.transact(() => {
      (entry.get('clips') as Y.Map<unknown>).set('s0', makeSubtitleMap('s0'));
    }, null as unknown as string);
    timelineStopCapturing();
    // 30 笔大 text 标量整值替换（同窗合并——每笔 undoBytes≈17.63K：第 i 笔恢复 i−1 文本、首笔
    // 微小；30 笔记账≈511.3K——第 30 笔预检 493.6+17.63=511.2K≤520192 全合并不切）
    let recordedSum = 0;
    for (let i = 0; i < 30; i++) {
      const text = bigText(17_600, String(i).padStart(3, '0'));
      const truth = docTruth(live);
      const after = { ...truth, clips: { ...truth.clips, s0: { ...truth.clips.s0!, text } } };
      const m = measureTransactionFrames(live, (temp) => {
        const ops = diffProjectDataToDoc(temp.getMap('timelines'), 'n1', truth, after);
        temp.transact((tx) => { for (const op of ops) op(tx); }, UNDO_TIMELINE_ORIGIN);
      }, { trackedOrigins: [UNDO_TIMELINE_ORIGIN] });
      recordedSum += m.undoBytes;
      expect(executeTimelineCommit(live, { nodeId: 'n1', before: truth, after, kind: 'scalar' })).toBe(true);
    }
    const topItem = timelineUm.undoStack[timelineUm.undoStack.length - 1]!;
    const recorded = getStackItemRestoreBytes(topItem);
    // 表征（实测 2026-11-21 yjs 13.6.32）：30 笔×17626B（首笔 undo=33 恢复初值、其余 17626）
    // →recorded=511187=measuredSum（一窗一项）；live 撤销帧=33（合帧恢复初值——记录之和是
    // 保守上限的实测锁定）
    expect(recorded).toBeGreaterThan(500_000);
    expect(recorded).toBe(recordedSum);   // 记录=窗内各笔之和（同一数——执行器预检与入栈同一个数）
    // live 单次撤销未包装字节≤记录累加值（合帧不比各笔逆操作之和更大——假设锁死）且≤524288
    const probe = frameProbe(live);
    expect(timelineUndo()).toBe(true);
    const liveUndoBytes = probe.get();
    expect(liveUndoBytes).toBeLessThanOrEqual(recorded);
    expect(liveUndoBytes).toBeLessThanOrEqual(HARD_GATE);
    timelineUm.destroy(); live.destroy();
  });

  it('贴闸档：窗内记账装回字节累到 518000 以上→live 撤销未包装字节仍≤524288（按钮闸 520192 不下调）', () => {
    const live = new Y.Doc();
    live.clientID = LIVE;
    for (let i = 0; i < 400; i++) {
      live.transact(() => { live.getMap('nodes').set(`k${i}`, i); }, Origin.LocalUser);
    }
    const timelines = live.getMap('timelines');
    live.transact(() => { timelines.set('n1', seedEntry()); }, Origin.LocalUser);
    stopCapturing();
    const entry = timelines.get('n1') as Y.Map<unknown>;
    const timelineUm = attachTimelineUndo('n1', entry);
    live.transact(() => {
      (entry.get('clips') as Y.Map<unknown>).set('s0', makeSubtitleMap('s0'));
    }, null as unknown as string);
    timelineStopCapturing();
    // 3 笔大 text 标量（每笔 ~259.33K 软闸内）。窗内记账语义：第 i 笔 undoBytes=恢复 i−1 的文本
    // ——首笔恢复初值（微小）、第 2 笔恢复第 1 笔的 259.3K、第 3 笔恢复第 2 笔的 259.3K——
    // top 累进 0→259.3K→518.7K；第 3 笔预检 top(259.3K)+259.33K=518.66K≤520192 全合并不切。
    for (let i = 0; i < 3; i++) {
      const text = bigText(259_300, String(i));
      const truth = docTruth(live);
      const after = { ...truth, clips: { ...truth.clips, s0: { ...truth.clips.s0!, text } } };
      expect(executeTimelineCommit(live, { nodeId: 'n1', before: truth, after, kind: 'scalar' })).toBe(true);
    }
    const topItem = timelineUm.undoStack[timelineUm.undoStack.length - 1]!;
    const recorded = getStackItemRestoreBytes(topItem);
    // 表征（实测 2026-11-21 yjs 13.6.32）：每笔 forward=259326/undo=259326（首笔 undo=33 恢复
    // 初值）；recorded=518685∈[518000,520192]（窗内两笔 259326 之和、首笔 33）——按钮闸 520192
    // 放行；live 撤销帧=33（合并窗恢复初值）≤524288——按钮闸维持 520192 不下调
    expect(recorded).toBeGreaterThanOrEqual(518_000);
    expect(recorded).toBeLessThanOrEqual(RESTORE_GATE_BYTES);
    const probe = frameProbe(live);
    expect(timelineUndo()).toBe(true);   // ≤520192——按钮放行
    expect(probe.get()).toBeLessThanOrEqual(HARD_GATE);   // 贴闸档实锚：live 撤销帧 ≤524288
    timelineUm.destroy(); live.destroy();
  });
});

// ─────────────────── ⑥ 域隔离三行为（spec §4） ───────────────────

describe('Y4a T4 ⑥ 域隔离三行为（origin 承载）', () => {
  it('timeline-user 事务不动画布栈；LocalUser 画布事务不动时间轴栈；删除→装回 stableStringify 一致（无并发档）', () => {
    const live = new Y.Doc();
    live.clientID = LIVE;
    const canvasUm = attachUndoManager(live);
    const timelines = live.getMap('timelines');
    live.transact(() => { timelines.set('n1', seedEntry()); }, Origin.LocalUser);
    stopCapturing();   // 画布域断窗（创建笔与后续 LocalUser 事务各自成步）
    const entry = timelines.get('n1') as Y.Map<unknown>;
    const timelineUm = attachTimelineUndo('n1', entry);
    const clips = entry.get('clips') as Y.Map<unknown>;
    const canvasBase = canvasUm.undoStack.length;    // 0（创建笔与下笔断窗后基线）
    // ① timeline-user 编辑：画布栈不动
    expect(commitToDoc(live, (d) => ({ ...d, clips: { ...d.clips, a: projClip('a') } }), 'structural')).toBe(true);
    expect(timelineUm.undoStack.length).toBe(1);
    expect(canvasUm.undoStack.length).toBe(canvasBase);
    // ② LocalUser 画布事务：时间轴栈不动
    live.transact(() => { live.getMap('nodes').set('cn', 1); }, Origin.LocalUser);
    expect(canvasUm.undoStack.length).toBe(canvasBase + 1);
    expect(timelineUm.undoStack.length).toBe(1);
    // ③ 删除→装回：stableStringify 与删除前一致（无并发档）
    timelineStopCapturing();
    const before = stable(timelines.get('n1'));
    const truth = docTruth(live);
    expect(executeTimelineCommit(live, {
      nodeId: 'n1', before: truth,
      after: { ...truth, clips: {} },
      kind: 'structural',
    })).toBe(true);
    expect(clips.has('a')).toBe(false);
    expect(timelineUndo()).toBe(true);
    expect(stable(timelines.get('n1'))).toBe(before);
    canvasUm.destroy(); live.destroy();
  });

  it('clearTimelineStackOf：删除事务前卸下被删节点自己的时间轴栈（T5 消费面）；他节点栈不动', () => {
    const live = new Y.Doc();
    live.clientID = LIVE;
    const timelines = live.getMap('timelines');
    live.transact(() => { timelines.set('n1', seedEntry()); }, Origin.LocalUser);
    stopCapturing();
    const entry = timelines.get('n1') as Y.Map<unknown>;
    attachTimelineUndo('n1', entry);
    const truth = docTruth(live);
    expect(executeTimelineCommit(live, {
      nodeId: 'n1', before: truth,
      after: { ...truth, clips: { ...truth.clips, a: projClip('a') } },
      kind: 'structural',
    })).toBe(true);
    expect(getTimelineUndoManager()!.undoStack.length).toBe(1);
    // 他节点 id：不是本编辑器栈——no-op（管理器仍在）
    clearTimelineStackOf('n-other');
    expect(getTimelineUndoManager()).not.toBe(null);
    // 被删节点自己的栈：卸下（spec §0 条 6——删除事务前清栈）
    clearTimelineStackOf('n1');
    expect(getTimelineUndoManager()).toBe(null);
    live.destroy();
  });
});

// ─────────────────── 装置辅助 ───────────────────

/** Y.Map 形字幕片段（装置直写用——谓词可过的满键形态）。 */
function makeSubtitleMap(id: string, start = 0): Y.Map<unknown> {
  const c = new Y.Map();
  c.set('type', 'subtitle');
  c.set('span', { trackId: 'n1:video', start, duration: 1 });
  c.set('text', `字幕-${id}`);
  c.set('visible', true);
  c.set('style', { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 });
  return c;
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
