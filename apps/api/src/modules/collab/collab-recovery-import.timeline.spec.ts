// apps/api/src/modules/collab/collab-recovery-import.timeline.spec.ts
// Y4a T5（plan 2026-11-20-y4a-timeline-domain Task 5——spec §0 条 4）：恢复导入 timelines 三面
// ——单进程装置（docs.withSession 直投 Y.Doc——binding.int.spec stub 形态；head/maintenance 缺席档
// =found:null 等价直跑；envelope hash 零填充=完整性占位跳过）。
//  - effectiveDeletions 段「先对活文档逐块提交并逐块过闸」：删除节点+timelines 键随删（clip 大档
//    =逐块 SERVER_TRANSACT_ORIGIN、块过 validateFrameDeny/262144；任一块拒=活文档一笔不写）；
//  - replace 段：只删 nodes 条目留 timelines.<id>（不调删除原语）；写回节点非 videoEdit→同一笔
//    候选事务删 timelines.<id>；仍 videoEdit→键原样保留；
//  - commitDiff 计算前补种：信封新出现且 timelines 无同名键的 videoEdit→seedEmptyTimeline 已种；
//    已有键不重种（禁 set 新 Map）。
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import {
  rebuildCanvasDoc, serializeCanvas, CANVAS_DOC_SCHEMA_VERSION,
  validateFrameDeny, TIMELINE_CHUNK_UNDO_BUDGET, type CanvasDocValue,
} from '@flowweb/shared';
import { CollabRecoveryImportService } from './collab-recovery-import.service';
import type { CollabDocumentService } from './collab-document.service';
import type { DraftEnvelope } from '@flowweb/shared';

const PID = 'y4a-t5-recovery';

/** 直构服务（docs.withSession 直投 live doc——mode:'read' 语义：fn 直执行无外层事务）。 */
function buildService(live: Y.Doc): CollabRecoveryImportService {
  const docs = {
    withSession: async (_pid: string, fn: (d: Y.Doc) => unknown) => fn(live),
  } as unknown as CollabDocumentService;
  const prisma = {
    canvasDoc: { findUnique: vi.fn(async () => null) },   // head 缺席档=missing（零装载门/maintenance 门直通）
  };
  return new CollabRecoveryImportService(docs, prisma as never, undefined, undefined);
}

/** envelope 构造（rebuildCanvasDoc canonical——hash 零填充占位跳过比对）。 */
function envelopeOf(nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }>, draftId: string): DraftEnvelope {
  const doc = rebuildCanvasDoc({
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: { x: 1, y: 2 }, data: (n.data ?? {}) as Record<string, CanvasDocValue> })),
    edges: [],
    meta: {},
  });
  const canvas = serializeCanvas(doc);
  return {
    draftId, projectId: PID, generation: 1, schemaVersion: CANVAS_DOC_SCHEMA_VERSION,
    historyId: 'h-y4a-t5', capturedAtMs: Date.now(), tabId: 'tab-y4a-t5',
    nodes: canvas.nodes, edges: canvas.edges, meta: {},
    hashes: { nodes: '0'.repeat(64), edges: '0'.repeat(64) },
  } as unknown as DraftEnvelope;
}

/** live 上建剪辑节点+带片段时间轴（subtitle text=唯一可扩标量——撑大帧用）。 */
function seedClipNode(live: Y.Doc, id: string, textBytes = 100): void {
  live.transact(() => {
    const n = new Y.Map();
    n.set('type', 'videoEdit');
    live.getMap('nodes').set(id, n);
    const tl = new Y.Map();
    tl.set('version', 1); tl.set('fps', 30);
    const track = new Y.Map();
    track.set('type', 'video'); track.set('name', '视频');
    track.set('muted', false); track.set('hidden', false); track.set('order', '5000');
    const tracks = new Y.Map();
    tracks.set(`${id}:video`, track);
    tl.set('tracks', tracks);
    const clips = new Y.Map();
    const clip = new Y.Map();
    clip.set('type', 'subtitle');
    clip.set('span', { trackId: `${id}:video`, start: 0, duration: 1 });
    clip.set('text', 'x'.repeat(textBytes));
    clip.set('visible', true);
    clip.set('style', { fontSize: 16, letterSpacing: 0, color: '#fff' });
    clips.set(`${id}-c1`, clip);
    tl.set('clips', clips);
    live.getMap('timelines').set(id, tl);
  }, 'seed');
}

describe('Y4a T5 recovery import timelines 三面（spec §0 条 4）', () => {
  it('effectiveDeletions 段：timelines 键随删（活文档逐块提交——无时间轴普通节点单笔原语删）', async () => {
    const live = new Y.Doc();
    live.transact(() => {
      const m = new Y.Map();
      m.set('type', 'textInput');
      live.getMap('nodes').set('n-plain', m);
    }, 'seed');
    seedClipNode(live, 'n-clip', 200);
    const svc = buildService(live);
    const out = await svc.importEnvelope(PID, 'u1', envelopeOf([], 'd-t5-del'), undefined, undefined, ['n-plain', 'n-clip']);
    expect(out.deletions).toEqual({ requested: 2, applied: 2, filteredIntersection: 0 });
    expect(live.getMap('nodes').has('n-plain')).toBe(false);
    expect(live.getMap('nodes').has('n-clip')).toBe(false);
    expect(live.getMap('timelines').has('n-clip')).toBe(false);   // timelines 键随删（effectiveDeletions 段）
  });

  it('effectiveDeletions 大片段档：逐块提交逐块过闸——每块帧过 validateFrameDeny 且 ≤262144；单片段逆操作超限档=活文档一笔不写+422/400 fail-closed', async () => {
    const live = new Y.Doc();
    // 单片段逆操作超 262144（装回帧>软闸）——该块过不了闸：活文档一笔不写（spec §0 条 4）
    seedClipNode(live, 'n-huge', 300_000);
    const beforeNodes = Y.encodeStateAsUpdate(live);
    const svc = buildService(live);
    // 捕获各笔事务帧（直投装置下每块=deleteNodesWithTimelines 一笔）
    const frames: Array<{ bytes: number; origin: unknown }> = [];
    live.on('update', (u: Uint8Array, origin: unknown) => frames.push({ bytes: u.byteLength, origin }));
    await expect(svc.importEnvelope(PID, 'u1', envelopeOf([], 'd-t5-huge'), undefined, undefined, ['n-huge']))
      .rejects.toMatchObject({ status: expect.any(Number) });
    expect(frames.length).toBe(0);   // 块闸拒=活文档一笔未写（fail-closed）
    expect(Y.encodeStateAsUpdate(live)).toEqual(beforeNodes);
    expect(live.getMap('nodes').has('n-huge')).toBe(true);
    expect(live.getMap('timelines').has('n-huge')).toBe(true);
    live.destroy();
  });

  // T5 评审 I#1（spec §0 条 4——validateFrameDeny 块闸补齐）：struct 密度超限块（1000 片段×20 微小键
  // ——整笔 undo 309227B>262144 走切块、贪心箱 ~821 片段 undo ~254K 过字节预算、undo structs
  // ~17.2K>FRAME_MAX_STRUCTS(16000)）。修前红相：planner 只查 262144、该箱字节合法照写活 doc。
  it('effectiveDeletions deny 档（评审 I#1）：struct 密度超限块（字节预算内、structs>16000）→活文档一笔不写+fail-closed', async () => {
    const live = new Y.Doc();
    live.transact(() => {
      const n = new Y.Map();
      n.set('type', 'videoEdit');
      live.getMap('nodes').set('n-dense', n);
      const tl = new Y.Map();
      tl.set('version', 1); tl.set('fps', 30);
      tl.set('tracks', new Y.Map());
      const clips = new Y.Map();
      for (let i = 0; i < 1000; i++) {
        const clip = new Y.Map();
        for (let k = 0; k < 20; k++) clip.set(String.fromCharCode(97 + (k % 26)), 1);
        clips.set(`n-dense-c${i}`, clip);
      }
      tl.set('clips', clips);
      live.getMap('timelines').set('n-dense', tl);
    }, 'seed');
    const beforeNodes = Y.encodeStateAsUpdate(live);
    const svc = buildService(live);
    const frames: Array<{ bytes: number; origin: unknown }> = [];
    live.on('update', (u: Uint8Array, origin: unknown) => frames.push({ bytes: u.byteLength, origin }));
    await expect(svc.importEnvelope(PID, 'u1', envelopeOf([], 'd-t5-dense'), undefined, undefined, ['n-dense']))
      .rejects.toMatchObject({ status: expect.any(Number) });   // deny 拒=fail-closed 400（修前红：字节过闸照删）
    expect(frames.length).toBe(0);   // 活文档一笔未写
    expect(Y.encodeStateAsUpdate(live)).toEqual(beforeNodes);
    expect(live.getMap('nodes').has('n-dense')).toBe(true);
    expect(((live.getMap('timelines').get('n-dense') as Y.Map<unknown>).get('clips') as Y.Map<unknown>).size).toBe(1000);   // 片段原样
    live.destroy();
  });

  it('effectiveDeletions 中片段档：过闸块照删——每帧 validateFrameDeny 通过（合法块形态锁）', async () => {
    const live = new Y.Doc();
    seedClipNode(live, 'n-mid', 40_000);   // 40KB 文本——单块两帧 <262144 合法档
    const svc = buildService(live);
    const denyFrames: Uint8Array[] = [];
    live.on('update', (u: Uint8Array) => denyFrames.push(u));
    const out = await svc.importEnvelope(PID, 'u1', envelopeOf([], 'd-t5-mid'), undefined, undefined, ['n-mid']);
    expect(out.deletions).toEqual({ requested: 1, applied: 1, filteredIntersection: 0 });
    expect(live.getMap('nodes').has('n-mid')).toBe(false);
    expect(live.getMap('timelines').has('n-mid')).toBe(false);
    for (const f of denyFrames) expect(validateFrameDeny(f).ok).toBe(true);
    live.destroy();
  });

  it('replace 保留：replace 删既有剪辑节点再信封加回同 id→timelines.<id> 原样保留（replace 不调删除原语）', async () => {
    const live = new Y.Doc();
    seedClipNode(live, 'n-rep', 300);
    const tlBefore = live.getMap('timelines').get('n-rep') as Y.Map<unknown>;
    const svc = buildService(live);
    // 信封同 id videoEdit 替换（choices replace）——envelope videoEdit 无 data 键
    const env = envelopeOf([{ id: 'n-rep', type: 'videoEdit' }], 'd-t5-replace');
    const out = await svc.importEnvelope(PID, 'u1', env, { 'n-rep': 'replace' });
    expect(out.dispositions.find((d) => d.nodeId === 'n-rep')?.disposition).toBe('replace');
    expect(live.getMap('nodes').has('n-rep')).toBe(true);   // 信封加回
    expect(live.getMap('timelines').get('n-rep')).toBe(tlBefore);   // 原对象保留（不 set 新 Map）
    const clips = (live.getMap('timelines').get('n-rep') as Y.Map<unknown>).get('clips') as Y.Map<unknown>;
    expect(clips.size).toBe(1);   // 轨道片段不清空
  });

  it('replace 类型变更：写回节点不再是 videoEdit→同一笔候选事务删掉 timelines.<id>（仍 videoEdit→保留）', async () => {
    // (a) 替换为 textInput：键须删
    const live = new Y.Doc();
    seedClipNode(live, 'n-typed', 300);
    const svc = buildService(live);
    const env = envelopeOf([{ id: 'n-typed', type: 'textInput' }], 'd-t5-typed');
    await svc.importEnvelope(PID, 'u1', env, { 'n-typed': 'replace' });
    expect((live.getMap('nodes').get('n-typed') as Y.Map<unknown>).get('type')).toBe('textInput');
    expect(live.getMap('timelines').has('n-typed')).toBe(false);   // 同一笔候选事务删键（GC 引用不滞留）
    live.destroy();
    // (b) 替换仍 videoEdit：键原样保留
    const live2 = new Y.Doc();
    seedClipNode(live2, 'n-typed2', 300);
    const svc2 = buildService(live2);
    const env2 = envelopeOf([{ id: 'n-typed2', type: 'videoEdit' }], 'd-t5-typed2');
    await svc2.importEnvelope(PID, 'u1', env2, { 'n-typed2': 'replace' });
    expect(live2.getMap('timelines').has('n-typed2')).toBe(true);
    live2.destroy();
  });

  it('commitDiff 前补种：信封新出现且 timelines 无同名键的 videoEdit→seedEmptyTimeline 已种；已有键不重种', async () => {
    const live = new Y.Doc();
    // 已有键节点（同 id 无冲突直接 import 档=跳过——换不同 id 验证已有键不重种走 replace 档）
    seedClipNode(live, 'n-have', 300);
    const existingTl = live.getMap('timelines').get('n-have') as Y.Map<unknown>;
    const svc = buildService(live);
    // 新出现 videoEdit（无既有键）→补种
    const env = envelopeOf([
      { id: 'n-fresh', type: 'videoEdit' },
      { id: 'n-have', type: 'videoEdit' },
    ], 'd-t5-seed');
    await svc.importEnvelope(PID, 'u1', env, { 'n-have': 'replace' });
    const fresh = live.getMap('timelines').get('n-fresh') as Y.Map<unknown> | undefined;
    expect(fresh).toBeInstanceOf(Y.Map);   // seedEmptyTimeline 已种（version/fps/默认轨）
    expect(fresh!.get('version')).toBe(1);
    expect(fresh!.get('fps')).toBe(30);
    expect((fresh!.get('tracks') as Y.Map<unknown>).size).toBe(1);
    expect((fresh!.get('tracks') as Y.Map<unknown>).keys().next().value).toBe('n-fresh:video');
    expect((fresh!.get('clips') as Y.Map<unknown>).size).toBe(0);
    // 已有键不重种（禁 set 新 Map——原对象身份保留）
    expect(live.getMap('timelines').get('n-have')).toBe(existingTl);
    live.destroy();
  });
});
