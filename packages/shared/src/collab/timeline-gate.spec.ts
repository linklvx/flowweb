// packages/shared/src/collab/timeline-gate.spec.ts
// Y4a T1（plan 2026-11-20-y4a-timeline-domain Task 1——spec §0 条 1/2/10）：量法契约+闸常量+
// 切块表征。全部用真实 yjs 装置（Y.Doc/Y.UndoManager——非 mock）。
//
// 量法契约：
// ① measureTransactionFrames：一笔 addClip 的 forwardBytes 与 undoBytes 都 >0；
//    整份 encodeStateAsUpdate(live).byteLength ≠ forwardBytes（证明量的是这一笔不是全文档）。
// ② 不测整棵装回。RESTORE_GATE_BYTES === NORMAL_FRAME_GATE_BYTES - 4096 === 520192。
// ③ clientID 顺序：applyUpdate 之后设 temp.clientID=live.clientID——先设再 applyUpdate 会被
//    yjs 静默换号（transaction.js:357-360），断言两种顺序各自的真值（正序保持/逆序换号）。
// ④ 切块表征测试（spec §0 条 10——锁「每一块 live 撤销帧≤524288」）：带历史的 live doc
//    （数百笔小事务、两个钉死写入 clientID 交错、undo 用另一个钉死 clientID、撤销者自身
//    clock 越过 2^14 档），一个剪辑节点+指向它的边+一棵大时间轴；按切块规则用
//    deleteTimelineClips 清空再 deleteNodesWithTimelines 删小节点，逐块 undo→每一块
//    未包装撤销帧 ≤ NORMAL_FRAME_GATE_BYTES。
// ⑤ 立即撤销等长档：删除后立刻 undo 的 live 帧与 measureTransactionFrames 同笔 undoBytes 等长
//    （temp==live——量法忠实性断言）。
// ⑥ 大时间轴服务端帧档（spec §0 条 10——负控）：同一棵大时间轴（420 片段、多 client 交错 clock）
//    上——超预算的一笔删除必须被拒（nested-transact-forbidden 档+超 524288 档各一例）；
//    切块后的每一帧 ≤ 524288 且 countDsRanges ≤ 16000（连续 clock 夹具几乎必过、盖不住上线形态
//    ——夹具必须多 client 交错）。服务端三路（shrink/writeBatch/恢复导入）逐块化是定案非退路。
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { NORMAL_FRAME_GATE_BYTES } from './doc-protocol';
import { QUOTA_DEFAULTS } from '../constants/collab-quota';
import { FRAME_MAX_DS_RANGES, countDsRanges } from '../canvas/frame-deny';
import { deleteNodesWithTimelines, deleteTimelineClips } from '../canvas/canvas-node-delete';
import {
  measureTransactionFrames, RESTORE_GATE_BYTES, TIMELINE_CHUNK_UNDO_BUDGET,
} from './timeline-gate';

const HARD_GATE = NORMAL_FRAME_GATE_BYTES;        // 524288
const CHUNK_BUDGET = TIMELINE_CHUNK_UNDO_BUDGET;  // 262144

/** 钉死 clientID（spec §0 条 10：随机 clientID 改变 varuint 宽度、闸边界会抖——全夹具钉死）。 */
const W1 = 424_242, W2 = 848_484, UNDOER = 1_717_171, LIVE = 909_090;

/**
 * 大时间轴夹具（⑥ 形态——420 片段、多 client 交错 clock）：
 * 两个历史写入 client 交错各写数百笔小事务+交替著写 420 个片段（span/transform/text 标量+
 * keyframes Y.Map——spec §3.1 clip 形）；撤销者先写节点再叠 clock 越过 2^14 的 meta 小事务
 * （自身 clock > 16384——varuint 加宽档）；边由 W2 著写指向剪辑节点。
 */
function buildLargeTimelineFixture(): { live: Y.Doc; clipIds: string[] } {
  const w1 = new Y.Doc(); const w2 = new Y.Doc(); const undoer = new Y.Doc();
  w1.clientID = W1; w2.clientID = W2; undoer.clientID = UNDOER;
  // 历史小事务：W1/W2 交错数百笔（多 client 交错 clock——连续 clock 夹具盖不住上线形态）
  for (let i = 0; i < 400; i++) {
    w1.transact(() => { w1.getMap('nodes').set(`w1k${i}`, i); }, 'local-user');
    w2.transact(() => { w2.getMap('nodes').set(`w2k${i}`, i); }, 'local-user');
  }
  undoer.transact(() => {
    const n1 = new Y.Map();
    n1.set('type', 'videoEdit');
    undoer.getMap('nodes').set('n1', n1);
  }, 'local-user');
  // 撤销者自身 clock 越过 2^14 档（16500 笔小事务——undoer id varuint 加宽、量出的帧同翼）
  for (let i = 0; i < 16_500; i++) {
    undoer.transact(() => { undoer.getMap('meta').set(`u${i}`, i); }, 'local-user');
  }
  // 时间轴骨架由撤销者一笔著写（tracks/clips Y.Map——spec §3.1 形）
  undoer.transact(() => {
    const tl = new Y.Map();
    tl.set('version', 1); tl.set('fps', 30);
    const tracks = new Y.Map();
    const tr = new Y.Map();
    tr.set('id', 'n1:video'); tr.set('type', 'video'); tr.set('name', '视频');
    tr.set('muted', false); tr.set('hidden', false); tr.set('order', '5000');
    tracks.set('n1:video', tr);
    tl.set('tracks', tracks);
    tl.set('clips', new Y.Map());
    undoer.getMap('timelines').set('n1', tl);
  }, 'timeline-user');
  // 片段内容 W1/W2 交替著写（多 client 交错 clock——undo 装回帧内容携带两 client 形态）
  Y.applyUpdate(w1, Y.encodeStateAsUpdate(undoer));
  Y.applyUpdate(w2, Y.encodeStateAsUpdate(undoer));
  for (let c = 0; c < 420; c++) {
    const author = c % 2 === 0 ? w1 : w2;
    author.transact(() => {
      const clips = (author.getMap('timelines').get('n1') as Y.Map<unknown>).get('clips') as Y.Map<unknown>;
      const clip = new Y.Map();
      clip.set('span', { trackId: 'n1:video', start: c, duration: 1, sourceStart: 0 });
      clip.set('transform', { x: c, y: c, scale: 1, rotation: 0, opacity: 1 });
      clip.set('text', `片段 ${c} ` + 'Z'.repeat(700));
      clip.set('mediaId', `m${c}`);
      const kfs = new Y.Map();
      for (let k = 0; k < 6; k++) {
        kfs.set(`kf${c}_${k}`, { id: `kf${c}_${k}`, t: k, property: 'x', value: k, easing: 'linear' });
      }
      clip.set('keyframes', kfs);
      clips.set(`c${c}`, clip);
    }, 'local-user');
  }
  w2.transact(() => {
    const e = new Y.Map();
    e.set('id', 'e1'); e.set('source', 'src'); e.set('target', 'n1');
    w2.getMap('edges').set('e1', e);
  }, 'local-user');
  const live = new Y.Doc();
  live.clientID = LIVE;
  Y.applyUpdate(live, Y.encodeStateAsUpdate(w1));
  Y.applyUpdate(live, Y.encodeStateAsUpdate(w2));
  Y.applyUpdate(live, Y.encodeStateAsUpdate(undoer));
  const clipIds = [...((live.getMap('timelines').get('n1') as Y.Map<unknown>).get('clips') as Y.Map<unknown>).keys()];
  return { live, clipIds };
}

/** 切块算法（T1 表征的复制品——与 T4 清空时间轴同一条规则：贪心增长每块直到 undoBytes 超预算）。 */
function planChunks(live: Y.Doc, clipIds: readonly string[]): string[][] {
  const chunks: string[][] = [];
  let i = 0;
  while (i < clipIds.length) {
    const del = (ids: readonly string[]) => (temp: Y.Doc) =>
      deleteTimelineClips(temp, 'n1', ids, 'local-user');
    const first = measureTransactionFrames(live, del(clipIds.slice(i, i + 1)));
    if (first.undoBytes > CHUNK_BUDGET) {
      chunks.push(clipIds.slice(i, i + 1));   // 单片段逆操作仍超=整块不写（消费方判拒；这里表征尺寸）
      i += 1;
      continue;
    }
    let good = 1;
    let fail = 2;
    for (;;) {
      const cand = Math.min(i + fail, clipIds.length);
      if (cand <= i + good) break;
      const m = measureTransactionFrames(live, del(clipIds.slice(i, cand)));
      if (m.undoBytes <= CHUNK_BUDGET) { good = cand - i; fail *= 2; if (cand >= clipIds.length) break; }
      else break;
    }
    if (i + good < clipIds.length && fail > good + 1) {
      let lo = good, hi = Math.min(i + fail, clipIds.length) - i;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        const m = measureTransactionFrames(live, del(clipIds.slice(i, i + mid)));
        if (m.undoBytes <= CHUNK_BUDGET) lo = mid; else hi = mid;
      }
      good = lo;
    }
    chunks.push(clipIds.slice(i, i + good));
    i += good;
  }
  return chunks;
}

describe('Y4a T1 量法契约：measureTransactionFrames（spec §0 条 1/2）', () => {
  it('① 一笔 addClip：forwardBytes>0、undoBytes>0；整份 stateAsUpdate ≠ forwardBytes（量的是这一笔非全文档）', () => {
    const live = new Y.Doc();
    live.clientID = LIVE;
    live.transact(() => {
      const tl = new Y.Map();
      tl.set('version', 1); tl.set('fps', 30);
      tl.set('tracks', new Y.Map());
      tl.set('clips', new Y.Map());
      live.getMap('timelines').set('n1', tl);
    }, 'local-user');
    const r = measureTransactionFrames(live, (temp) => {
      temp.transact(() => {
        const clips = (temp.getMap('timelines').get('n1') as Y.Map<unknown>).get('clips') as Y.Map<unknown>;
        const clip = new Y.Map();
        clip.set('span', { trackId: 'n1:video', start: 0, duration: 1 });
        clip.set('keyframes', new Y.Map());
        clips.set('c0', clip);
      }, 'local-user');
    });
    expect(r.forwardBytes).toBeGreaterThan(0);
    expect(r.undoBytes).toBeGreaterThan(0);
    expect(Y.encodeStateAsUpdate(live).byteLength).not.toBe(r.forwardBytes);
  });

  it('①b trackedOrigins 缺省=local-user；自定义 trackedOrigins 覆盖（T4 量 timeline-user 写用）', () => {
    const live = new Y.Doc();
    live.clientID = LIVE;
    const withCustom = measureTransactionFrames(live, (temp) => {
      temp.transact(() => { temp.getMap('nodes').set('a', 1); }, 'timeline-user');
    }, { trackedOrigins: ['timeline-user'] });
    expect(withCustom.forwardBytes).toBeGreaterThan(0);
    expect(withCustom.undoBytes).toBeGreaterThan(0);
    // 不传 options 时 timeline-user 事务不入栈——undo() 无栈项、undoBytes=0（缺省域=local-user）
    const untracked = measureTransactionFrames(live, (temp) => {
      temp.transact(() => { temp.getMap('nodes').set('b', 1); }, 'timeline-user');
    });
    expect(untracked.forwardBytes).toBeGreaterThan(0);
    expect(untracked.undoBytes).toBe(0);
  });

  it('② RESTORE_GATE_BYTES === NORMAL_FRAME_GATE_BYTES - 4096 === 520192（0x7F000=508KB 整；spec/brief 括注「520096」为文档内笔误——524288−4096 算术值唯一，公式为单源派生真值）；本批无整棵装回尺（import 面无 measureWholeTreeRestore）', async () => {
    expect(RESTORE_GATE_BYTES).toBe(NORMAL_FRAME_GATE_BYTES - 4096);
    expect(RESTORE_GATE_BYTES).toBe(520_192);   // 文档四处括注 520096 与「=硬闸−4096」互斥——本测试锁公式算术真值
    const mod = await import('./timeline-gate');
    expect((mod as Record<string, unknown>).measureWholeTreeRestore).toBeUndefined();
    expect(TIMELINE_CHUNK_UNDO_BUDGET).toBe(QUOTA_DEFAULTS.maxTxBytes);   // 262144 与软闸同源
  });

  it('③ clientID 顺序：applyUpdate 后设保持钉死值；先设再 applyUpdate（撞已入状态 client）被静默换号', () => {
    const live = new Y.Doc();
    live.clientID = LIVE;
    live.transact(() => { live.getMap('nodes').set('a', 1); }, 'local-user');
    // 正序：applyUpdate 之后、事务之前设——穿过测量事务保持不变
    const temp = new Y.Doc();
    Y.applyUpdate(temp, Y.encodeStateAsUpdate(live));
    temp.clientID = live.clientID;
    temp.transact(() => { temp.getMap('nodes').set('b', 1); }, 'local-user');
    expect(temp.clientID).toBe(LIVE);
    // 逆序：先设再 applyUpdate——入状态里已有该 clientID，yjs 静默换号（transaction.js:357-360）
    const temp2 = new Y.Doc();
    temp2.clientID = LIVE;
    Y.applyUpdate(temp2, Y.encodeStateAsUpdate(live));
    expect(temp2.clientID).not.toBe(LIVE);   // 被换号——量出来的会是另一个 client 的帧
  });
});

describe('Y4a T1 切块表征（spec §0 条 10——高时钟 live 逐块 undo ≤ 硬闸）', () => {
  it('④ 清空大时间轴再删小节点：逐块 live 撤销帧≤524288、终态三根全删、undo 依块序装回', () => {
    const { live, clipIds } = buildLargeTimelineFixture();
    const chunks = planChunks(live, clipIds);
    expect(chunks.length).toBeGreaterThan(1);   // 大时间轴必须切成多块（一块装回=超硬闸）
    // 表征记录：测到的块规模（brief 要求「测试写明测到的帧与块规模」）
    // console.info(`④ chunk count=${chunks.length} sizes=${chunks.map(c => c.length).join(',')}`)
    // 本夹具实测（2026-11-21，yjs 13.6.32）：420 片段切成 200/199/21 三块、
    // 装回帧 261967/262490/27603、小节点帧 282——最大 262490，距硬闸 524288 余量 ≥261KB。
    const um = new Y.UndoManager(
      [live.getMap('nodes'), live.getMap('edges'), live.getMap('timelines')],
      { captureTimeout: 0, trackedOrigins: new Set(['local-user']) },
    );
    let lastFrame = 0;
    live.on('update', (u: Uint8Array) => { lastFrame = u.byteLength; });
    // 切块真删：每块最外层事务（deleteTimelineClips 内恰一次 transact）
    for (const ch of chunks) {
      um.stopCapturing();
      deleteTimelineClips(live, 'n1', ch, 'local-user');
    }
    // 最后一笔删小节点+边+已变小的 timelines 键
    um.stopCapturing();
    deleteNodesWithTimelines(live, ['n1'], 'local-user');
    expect(live.getMap('nodes').has('n1')).toBe(false);
    expect(live.getMap('edges').has('e1')).toBe(false);
    expect(live.getMap('timelines').has('n1')).toBe(false);
    // 逐块 undo：每一块 live 未包装撤销帧 ≤ NORMAL_FRAME_GATE_BYTES（未包装口径=guardSyncFrame payload.byteLength 同族）
    const undoFrames: number[] = [];
    while (um.undoStack.length > 0) {
      um.undo();
      undoFrames.push(lastFrame);
    }
    expect(undoFrames).toHaveLength(chunks.length + 1);   // 每块一步+小节点一步
    for (const b of undoFrames) expect(b).toBeLessThanOrEqual(HARD_GATE);
    const maxUndo = Math.max(...undoFrames);
    expect(maxUndo).toBeGreaterThan(200_000);   // 表征锚：块确实吃到 2^14 加宽档的量级（非空转）
    // 终态装回：节点/边/时间轴/片段全数回来
    const tl = live.getMap('timelines').get('n1') as Y.Map<unknown>;
    expect(live.getMap('nodes').has('n1')).toBe(true);
    expect(live.getMap('edges').has('e1')).toBe(true);
    expect((tl.get('clips') as Y.Map<unknown>).size).toBe(420);
    um.destroy();
  });

  it('⑤ 立即撤销等长档：删除后立刻 undo 的 live 帧 === measureTransactionFrames 同笔 undoBytes（temp==live 忠实性）', () => {
    const { live, clipIds } = buildLargeTimelineFixture();
    const chunks = planChunks(live, clipIds);
    const chunk0 = chunks[0]!;
    const mm = measureTransactionFrames(live, (temp) =>
      deleteTimelineClips(temp, 'n1', chunk0, 'local-user'));
    const um = new Y.UndoManager(
      [live.getMap('nodes'), live.getMap('edges'), live.getMap('timelines')],
      { captureTimeout: 0, trackedOrigins: new Set(['local-user']) },
    );
    let lastFrame = 0;
    live.on('update', (u: Uint8Array) => { lastFrame = u.byteLength; });
    deleteTimelineClips(live, 'n1', chunk0, 'local-user');
    expect(lastFrame).toBe(mm.forwardBytes);   // 正向帧先等长钉死（temp==live 删除即时）
    um.undo();
    expect(lastFrame).toBe(mm.undoBytes);      // 立即撤销帧与预检 undoBytes 逐字节等长
    um.destroy();
  });
});

describe('Y4a T1 大时间轴服务端帧档（spec §0 条 10——负控）', () => {
  it('⑥a 超预算一笔删除被拒：一帧装回 undoBytes > 524288（两帧闸拒——切块后的每帧过闸）', () => {
    const { live, clipIds } = buildLargeTimelineFixture();
    // 一笔删全部片段+节点+边+时间轴（无切块形态——writeBatch/恢复导入逐块化前的单事务毒形态；
    // 单一 transact 模拟「一切并成一帧」的服务端旧写法——两原语各自恰一层事务，这里手写同形）
    const oneShot = measureTransactionFrames(live, (temp) => {
      temp.transact(() => {
        const clips = (temp.getMap('timelines').get('n1') as Y.Map<unknown>).get('clips') as Y.Map<unknown>;
        for (const id of clipIds) clips.delete(id);
        temp.getMap('nodes').delete('n1');
        temp.getMap('edges').delete('e1');
        temp.getMap('timelines').delete('n1');
      }, 'local-user');
    });
    expect(oneShot.undoBytes).toBeGreaterThan(HARD_GATE);   // 552309 实测>524288——硬闸必须拒
    // 切块后：每块正向+装回两帧均过闸（软闸=切块预算、硬闸=帧上限）
    const chunks = planChunks(live, clipIds);
    expect(chunks.length).toBeGreaterThan(1);
    for (const ch of chunks) {
      const m = measureTransactionFrames(live, (temp) =>
        deleteTimelineClips(temp, 'n1', ch, 'local-user'));
      expect(m.undoBytes).toBeLessThanOrEqual(CHUNK_BUDGET);   // 切块规则=装回帧 ≤ 262144
      expect(m.undoBytes).toBeLessThanOrEqual(HARD_GATE);
      expect(m.forwardBytes).toBeLessThanOrEqual(HARD_GATE);
    }
  });

  it('⑥b 嵌套并帧档：原语在 withDoc/writeBatch 外层事务里被调即抛 nested-transact-forbidden（切多少块都还是一帧——禁静默）', () => {
    const { live } = buildLargeTimelineFixture();
    expect(() => {
      live.transact(() => {
        deleteTimelineClips(live, 'n1', ['c0'], 'local-user');
      }, 'server');
    }).toThrow('nested-transact-forbidden');
    expect(() => {
      live.transact(() => {
        deleteNodesWithTimelines(live, ['n1'], 'server');
      }, 'server');
    }).toThrow('nested-transact-forbidden');
    // 抛出后活文档一笔未写（帧事务未落——片段仍在）
    const clips = (live.getMap('timelines').get('n1') as Y.Map<unknown>).get('clips') as Y.Map<unknown>;
    expect(clips.has('c0')).toBe(true);
    expect(live.getMap('nodes').has('n1')).toBe(true);
  });

  it('⑥c 切块后的每一帧（正向+装回）≤524288 且 countDsRanges≤16000（L1 预算同源——多 client 交错夹具）', () => {
    const { live, clipIds } = buildLargeTimelineFixture();
    const um = new Y.UndoManager(
      [live.getMap('nodes'), live.getMap('edges'), live.getMap('timelines')],
      { captureTimeout: 0, trackedOrigins: new Set(['local-user']) },
    );
    const frames: Uint8Array[] = [];
    live.on('update', (u: Uint8Array) => { frames.push(u); });
    const chunks = planChunks(live, clipIds);
    for (const ch of chunks) {
      um.stopCapturing();
      deleteTimelineClips(live, 'n1', ch, 'local-user');
    }
    um.stopCapturing();
    deleteNodesWithTimelines(live, ['n1'], 'local-user');
    while (um.undoStack.length > 0) um.undo();
    um.destroy();
    // 正向帧（纯删=DS 载体）与装回帧（undo 重放 struct）两族全检
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      expect(f.byteLength).toBeLessThanOrEqual(HARD_GATE);
      const decoded = Y.decodeUpdate(f);
      const dsRanges = countDsRanges(decoded.ds as unknown as { clients: Map<number, unknown[]> });
      expect(dsRanges).toBeLessThanOrEqual(FRAME_MAX_DS_RANGES);   // 16000 与 L1 预算同源
    }
  });
});
