// packages/shared/src/canvas/timeline-codec.spec.ts
// Y4a T3（plan 2026-11-20-y4a-timeline-domain Task 3——spec §3.1 v6 修订④⑤/§3.4）：
// timeline codec 骨架行为锁——seedEmptyTimeline/readTimelineFromDoc roundtrip、diff 结构最小性、
// 并发互不覆盖、keyframes 随片段出生、读回排序三档（brief Step 1 ①-⑤）：
//  ①seedEmptyTimeline→readTimelineFromDoc roundtrip=空工程（单默认轨 `${nodeId}:video` order=
//    '5000'〔FIRST_ORDER_KEY 单源——禁字面量〕名「视频」/clips 空）——不调 createDefaultProjectData
//    （它用 genId('track')——默认轨 id 形态即断言面）；
//  ②setCanvasSize diff（before 无 canvasSize→after 1920×1080）只写 canvasSize 键——tracks/clips
//    map 不动（断言 diff 只产 canvasSize 一条 op）；
//  ③双端并发各加一个 clip 进同一棵 clips Map→两个都在、互不覆盖（spec §9 锚 7——两人同开同一
//    工程各加片段=键级合并非整串覆盖）；
//  ④keyframes 随片段出生（video clip 创建事务后 keyframes 已是空 Y.Map——spec §3.1 v6 修订④）；
//  ⑤读回排序三档：轨 order 再 trackId、片段 start 再 clipId、关键帧 t 再 id（乱序构造→读回已排序）。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { FIRST_ORDER_KEY } from './order-key';
import {
  seedEmptyTimeline, readTimelineFromDoc, diffProjectDataToDoc, extractTimelineClipMediaIds,
} from './timeline-codec';
import { TIMELINE_FRAME_PREDICATE } from './timeline-frame-predicate';
import type { ProjectData, SubtitleClip } from '../types/video-project';

const NODE = 'n-edit-1';
const VIDEO_TRACK = `${NODE}:video`;

/** 空工程构造（before/after diff 夹具——version/fps/单默认轨/可变 clips）。 */
function projectWith(clips: ProjectData['clips'], canvasSize?: { width: number; height: number }): ProjectData {
  return {
    version: 1, fps: 30,
    ...(canvasSize !== undefined ? { canvasSize } : {}),
    tracks: [{ id: VIDEO_TRACK, type: 'video', name: '视频', muted: false, hidden: false, clips: Object.keys(clips), order: FIRST_ORDER_KEY }],
    clips,
  };
}

/** 合法 video clip（diff/读回夹具）。 */
const videoClip = (id: string, start: number, duration = 5): Extract<ProjectData['clips'][string], { type: 'video' }> => ({
  id, type: 'video', trackId: VIDEO_TRACK, start, duration, sourceStart: 0, mediaId: `m-${id}`,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, playbackSpeed: 1,
  keyframes: [{ id: `k-${id}`, t: 0, property: 'x', value: 0, easing: 'linear' }],
});

/** 合法 subtitle clip（无 keyframes/mediaId 槽——I#1 组合夹具）。 */
const subtitleClip = (id: string, start: number): SubtitleClip => ({
  id, type: 'subtitle', trackId: VIDEO_TRACK, start, duration: 2,
  text: `text-${id}`, visible: true,
  style: { fontSize: 24, color: '#ffffff', letterSpacing: 0 },
});

/** 合法 audio clip（音量关键帧无 property——I#2/I#3 组合夹具）。 */
const audioClip = (id: string, start: number): Extract<ProjectData['clips'][string], { type: 'audio' }> => ({
  id, type: 'audio', trackId: VIDEO_TRACK, start, duration: 3, sourceStart: 0, mediaId: `m-${id}`,
  volume: 1, fade: { in: 0, out: 0 }, playbackSpeed: 1,
  keyframes: [{ id: `k-${id}`, t: 0, value: 1, easing: 'linear' }],
});

describe('Y4a T3 timeline-codec：seedEmptyTimeline/readTimelineFromDoc/diff 三面', () => {
  it('①seed→read roundtrip=空工程（单默认轨 order=FIRST_ORDER_KEY 名「视频」/零片段）', () => {
    const doc = new Y.Doc();
    doc.getMap('timelines').set(NODE, seedEmptyTimeline(NODE));
    const read = readTimelineFromDoc(doc.getMap('timelines').get(NODE));
    expect(read).not.toBeNull();
    expect(read!.version).toBe(1);
    expect(read!.fps).toBe(30);
    expect(read!.canvasSize).toBeUndefined();
    expect(read!.tracks).toHaveLength(1);
    expect(read!.tracks[0]).toMatchObject({ id: VIDEO_TRACK, type: 'video', name: '视频', muted: false, hidden: false, order: FIRST_ORDER_KEY, clips: [] });
    expect(Object.keys(read!.clips)).toHaveLength(0);
    // 默认轨 id 形态断言：非 genId('track') 随机 id（seedEmptyTimeline 不调 createDefaultProjectData）
    expect(read!.tracks[0]!.id.startsWith('track-')).toBe(false);
  });

  it('①b 非 Y.Map 入口 read 返 null（undefined/标量/纯对象三态）', () => {
    expect(readTimelineFromDoc(undefined)).toBeNull();
    expect(readTimelineFromDoc(42)).toBeNull();
    expect(readTimelineFromDoc({ version: 1 })).toBeNull();
  });

  it('②setCanvasSize diff 只写 canvasSize 键（tracks/clips map 不动——结构 diff 最小性）', () => {
    const doc = new Y.Doc();
    const timelines = doc.getMap('timelines');
    timelines.set(NODE, seedEmptyTimeline(NODE));
    const before = readTimelineFromDoc(timelines.get(NODE))!;
    const after = projectWith({}, { width: 1920, height: 1080 });
    const ops = diffProjectDataToDoc(timelines, NODE, before, after);
    // 结构 diff 最小性断言：只有 canvasSize 一条 op；应用后 tracks/clips 容器原实例未换（身份不变）。
    expect(ops).toHaveLength(1);
    const entry = timelines.get(NODE) as Y.Map<unknown>;
    const tracksBefore = entry.get('tracks');
    const clipsBefore = entry.get('clips');
    doc.transact((tx) => { for (const op of ops) op(tx); }, 'timeline-user');
    expect(entry.get('canvasSize')).toEqual({ width: 1920, height: 1080 });
    expect(entry.get('tracks')).toBe(tracksBefore);   // 容器键未 set 新 Map
    expect(entry.get('clips')).toBe(clipsBefore);
  });

  it('③双端并发各加一个 clip 进同一棵 Map→两个都在、互不覆盖', () => {
    // 真实 yjs 并发装置：A/B 两 doc 同步基线后各自离线加 clip→互收 update→合并后两 clip 并存。
    const a = new Y.Doc(), b = new Y.Doc();
    for (const d of [a, b]) d.getMap('timelines').set(NODE, seedEmptyTimeline(NODE));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    const before = readTimelineFromDoc(a.getMap('timelines').get(NODE))!;
    a.transact((tx) => {
      for (const op of diffProjectDataToDoc(a.getMap('timelines'), NODE, before, projectWith({ 'c-a': videoClip('c-a', 0) }))) op(tx);
    }, 'timeline-user');
    b.transact((tx) => {
      for (const op of diffProjectDataToDoc(b.getMap('timelines'), NODE, before, projectWith({ 'c-b': videoClip('c-b', 10) }))) op(tx);
    }, 'timeline-user');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const merged = readTimelineFromDoc(a.getMap('timelines').get(NODE))!;
    expect(Object.keys(merged.clips).sort()).toEqual(['c-a', 'c-b']);
    // B 端读回同样两 clip（对称）
    const mergedB = readTimelineFromDoc(b.getMap('timelines').get(NODE))!;
    expect(Object.keys(mergedB.clips).sort()).toEqual(['c-a', 'c-b']);
  });

  it('④keyframes 随片段出生（video clip 创建事务后 keyframes 已是空 Y.Map）', () => {
    const doc = new Y.Doc();
    const timelines = doc.getMap('timelines');
    timelines.set(NODE, seedEmptyTimeline(NODE));
    const before = readTimelineFromDoc(timelines.get(NODE))!;
    const withClip = projectWith({ 'c1': videoClip('c1', 0) });
    doc.transact((tx) => {
      for (const op of diffProjectDataToDoc(timelines, NODE, before, withClip)) op(tx);
    }, 'timeline-user');
    const clipMap = (timelines.get(NODE) as Y.Map<unknown>).get('clips') as Y.Map<unknown>;
    const c1 = clipMap.get('c1') as Y.Map<unknown>;
    const kf = c1.get('keyframes');
    // keyframes 容器随片段出生（§3.1 v6 修订④——同笔事务已是 Y.Map）；初始关键帧键级就位
    // （fixture 带 1 个关键帧 k-c1——非「等第一条关键帧再 set 一棵新 Map」的补建形态）。
    expect(kf instanceof Y.Map).toBe(true);
    expect((kf as Y.Map<unknown>).size).toBe(1);
    expect((kf as Y.Map<unknown>).get('k-c1')).toMatchObject({ id: 'k-c1', t: 0, property: 'x', easing: 'linear' });
    // 无 keyframes 的 clip（transform 关键帧数组空）→ 仍出生空 keyframes Map
    const bare = { ...videoClip('c2', 5), keyframes: [] };
    doc.transact((tx) => {
      for (const op of diffProjectDataToDoc(timelines, NODE, withClip, projectWith({ 'c1': videoClip('c1', 0), 'c2': bare })) ) op(tx);
    }, 'timeline-user');
    const c2 = (clipMap.get('c2') as Y.Map<unknown>).get('keyframes');
    expect(c2 instanceof Y.Map).toBe(true);
  });

  it('⑤读回排序三档：轨 order→trackId、片段 start→clipId、关键帧 t→id（乱序构造读回已排序）', () => {
    const doc = new Y.Doc();
    const timelines = doc.getMap('timelines');
    // 乱序轨：order '9000'（音频）与默认 '5000'（视频）——Map 插入序与读序无关
    const entry = new Y.Map();
    entry.set('version', 1);
    entry.set('fps', 30);
    const tracks = new Y.Map();
    for (const [tid, order, type] of [[`${NODE}:audio`, '9000', 'audio'], [VIDEO_TRACK, '5000', 'video']] as const) {
      const t = new Y.Map();
      t.set('type', type); t.set('name', type === 'video' ? '视频' : '音频'); t.set('muted', false); t.set('hidden', false); t.set('order', order);
      tracks.set(tid, t);
    }
    entry.set('tracks', tracks);
    const clips = new Y.Map();
    // 乱序片段：start 10/0/5 与同 start 5 的两片段（start→clipId tie-break）
    const mk = (id: string, start: number) => {
      const m = new Y.Map();
      m.set('type', 'video');
      m.set('span', { trackId: VIDEO_TRACK, start, duration: 5, sourceStart: 0 });
      m.set('transform', { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
      m.set('mediaId', `m-${id}`);
      m.set('playbackSpeed', 1);
      const kf = new Y.Map();
      for (const [kid, t] of [['k3', 9], ['k1', 1], ['k2', 5], ['k0', 1]] as const) kf.set(kid, { id: kid, t, property: 'x', value: 0, easing: 'linear' });
      m.set('keyframes', kf);
      return m;
    };
    clips.set('cz', mk('cz', 10));
    clips.set('ca', mk('ca', 0));
    clips.set('cm', mk('cm', 5));
    clips.set('cb', mk('cb', 5));
    entry.set('clips', clips);
    timelines.set(NODE, entry);
    const read = readTimelineFromDoc(entry)!;
    // 轨序：'5000' 视频先于 '9000' 音频
    expect(read.tracks.map((t) => t.id)).toEqual([VIDEO_TRACK, `${NODE}:audio`]);
    // 片段序：0 → 5(cb) → 5(cm) → 10（start 再 clipId）
    expect(read.tracks[0]!.clips).toEqual(['ca', 'cb', 'cm', 'cz']);
    // 关键帧序：t=1(k0) → t=1(k1) → t=5(k2) → t=9(k3)（t 再 id）
    expect(read.clips['ca']!.type === 'video' && (read.clips['ca'] as Extract<ProjectData['clips'][string], { type: 'video' }>).keyframes.map((k) => k.id))
      .toEqual(['k0', 'k1', 'k2', 'k3']);
    // track.clips 推导：音频轨无片段
    expect(read.tracks[1]!.clips).toEqual([]);
  });
});

describe('Y4a T3 extractTimelineClipMediaIds（clip mediaId 提取单源——T6 collectNodeRefsUnion 消费）', () => {
  it('video/image/audio 按类型键矩阵取 mediaId；空 clipId/空 mediaId 不产行；subtitle 无槽', () => {
    // 真实 doc 装置（detached Map 读键=yjs Invalid access 家族——先集成再读）。
    const doc = new Y.Doc();
    doc.transact(() => {
      const entry = new Y.Map();
      const clips = new Y.Map();
      const mk = (type: string, mediaId: unknown) => {
        const m = new Y.Map();
        m.set('type', type);
        m.set('span', { trackId: VIDEO_TRACK, start: 0, duration: 5 });
        if (mediaId !== undefined) m.set('mediaId', mediaId);
        return m;
      };
      clips.set('cv', mk('video', 'm-v'));
      clips.set('ci', mk('image', 'm-i'));
      clips.set('ca', mk('audio', 'm-a'));
      clips.set('cs', mk('subtitle', undefined));
      clips.set('', mk('video', 'm-empty-id'));          // 空 clipId 不产行
      clips.set('cm-empty', mk('video', ''));            // 空 mediaId 不产行
      entry.set('clips', clips);
      doc.getMap('timelines').set(NODE, entry);
    });
    expect(extractTimelineClipMediaIds(doc.getMap('timelines').get(NODE))).toEqual([
      { clipId: 'cv', mediaId: 'm-v' },
      { clipId: 'ci', mediaId: 'm-i' },
      { clipId: 'ca', mediaId: 'm-a' },
    ]);
  });

  it('非 Y.Map 入口返空数组（undefined/标量/缺 clips 键）', () => {
    expect(extractTimelineClipMediaIds(undefined)).toEqual([]);
    expect(extractTimelineClipMediaIds('nope')).toEqual([]);
    const bare = new Y.Map();
    expect(extractTimelineClipMediaIds(bare)).toEqual([]);
  });
});

// ══════════ Y4a T3-fix（评审回包 round 1——I#1/I#3/I#4）：codec↔谓词组合档 ══════════
// codec 产物喂自家帧谓词/L2 读回——修前组合面零覆盖（codec 产物与 TIMELINE_FRAME_PREDICATE
// 键矩阵互相矛盾时两侧单测各自绿=组合红漏网）。
describe('Y4a T3-fix 组合档：codec diff 产物必须过自家帧谓词+读回闭环', () => {
  /** diff 应用装置：seed→before 读回→diff→单事务应用→返回应用后 doc。 */
  function applyDiff(doc: Y.Doc, before: ProjectData, after: ProjectData): void {
    const timelines = doc.getMap('timelines');
    doc.transact((tx) => {
      for (const op of diffProjectDataToDoc(timelines, NODE, before, after)) op(tx);
    }, 'timeline-user');
  }

  it('I#1：diff 造 subtitle 片段→帧谓词过（subtitle 无 mediaId 槽——clipToDocFields 按类型写键）', () => {
    const doc = new Y.Doc();
    doc.getMap('timelines').set(NODE, seedEmptyTimeline(NODE));
    const before = readTimelineFromDoc(doc.getMap('timelines').get(NODE))!;
    const after = projectWith({ 's1': subtitleClip('s1', 0) });
    applyDiff(doc, before, after);
    // 组合断言①：codec 产物键集必须不含 subtitle 键矩阵外的键（mediaId/keyframes）——
    // m.set('mediaId', undefined) 实测留键、自家 CLIP_KEYS.subtitle 拒（修前红）。
    const s1 = ((doc.getMap('timelines').get(NODE) as Y.Map<unknown>).get('clips') as Y.Map<unknown>).get('s1') as Y.Map<unknown>;
    expect(s1.has('mediaId')).toBe(false);
    expect(s1.has('keyframes')).toBe(false);
    // 组合断言②：整份 doc 喂帧谓词——subtitle diff 产物全树放行（修前红：
    // timeline-clip-key:s1.mediaId）。
    expect(TIMELINE_FRAME_PREDICATE(Y.encodeStateAsUpdate(doc), doc)).toEqual({ ok: true });
    // 组合断言③：读回闭环=subtitle 三键值保真。
    const read = readTimelineFromDoc(doc.getMap('timelines').get(NODE))!;
    expect(read.clips['s1']).toMatchObject({ type: 'subtitle', text: 'text-s1', visible: true, style: { fontSize: 24 } });
  });

  it('I#1b：diff 造 audio/video 片段→帧谓词过（mediaId 就位——正控对照）', () => {
    const doc = new Y.Doc();
    doc.getMap('timelines').set(NODE, seedEmptyTimeline(NODE));
    const before = readTimelineFromDoc(doc.getMap('timelines').get(NODE))!;
    applyDiff(doc, before, projectWith({ 'c1': videoClip('c1', 0), 'a1': audioClip('a1', 10) }));
    expect(TIMELINE_FRAME_PREDICATE(Y.encodeStateAsUpdate(doc), doc)).toEqual({ ok: true });
    const read = readTimelineFromDoc(doc.getMap('timelines').get(NODE))!;
    expect(read.clips['c1']).toMatchObject({ type: 'video', mediaId: 'm-c1' });
    expect(read.clips['a1']).toMatchObject({ type: 'audio', mediaId: 'm-a1', volume: 1 });
  });

  it('I#3：纯值 keyframe 编辑（k1: t 0→5）→产出 update op→写后 doc 读回新值', () => {
    const doc = new Y.Doc();
    doc.getMap('timelines').set(NODE, seedEmptyTimeline(NODE));
    let before = readTimelineFromDoc(doc.getMap('timelines').get(NODE))!;
    const withClip = projectWith({ 'c1': { ...videoClip('c1', 0) } });
    applyDiff(doc, before, withClip);
    // 纯值编辑：同 id 集、k-c1 的 t 0→5（id 集合相等——修前 keyframesEqual 只比 id 产零 op）。
    const editedClip: Extract<ProjectData['clips'][string], { type: 'video' }> = {
      ...withClip.clips['c1'] as Extract<ProjectData['clips'][string], { type: 'video' }>,
      keyframes: [{ id: 'k-c1', t: 5, property: 'x', value: 0, easing: 'linear' }],
    };
    const edited: ProjectData = { ...withClip, clips: { 'c1': editedClip } };
    const ops = diffProjectDataToDoc(doc.getMap('timelines'), NODE, withClip, edited);
    expect(ops.length).toBeGreaterThan(0);   // 修前红：id 集合相等即 true→零 op
    applyDiff(doc, withClip, edited);
    const read = readTimelineFromDoc(doc.getMap('timelines').get(NODE))!;
    const kf = (read.clips['c1'] as Extract<ProjectData['clips'][string], { type: 'video' }>).keyframes;
    expect(kf).toEqual([{ id: 'k-c1', t: 5, property: 'x', value: 0, easing: 'linear' }]);
    void before;
  });

  it('I#4：nodeId 显式形参——无冒号默认轨（genId(track) 形态）写正确键、不产幽灵条目', () => {
    // 用户加轨用 genId('track')（id 无 `${nodeId}:` 前缀）——修前 nodeIdOf 取 tracks[0].id
    // 冒号前缀、脆弱推导产幽灵 timelines['track-xyz']。修后 nodeId=显式形参，与轨 id 形态无关。
    const doc = new Y.Doc();
    doc.getMap('timelines').set(NODE, seedEmptyTimeline(NODE));
    const before = readTimelineFromDoc(doc.getMap('timelines').get(NODE))!;
    const after: ProjectData = {
      version: 1, fps: 30,
      tracks: [
        { id: 'track-x7f9', type: 'audio', name: '音频', muted: false, hidden: false, clips: ['a1'], order: '9000' },   // 无冒号轨 id
      ],
      clips: { 'a1': { ...audioClip('a1', 0), trackId: 'track-x7f9' } },
    };
    applyDiff(doc, before, after);
    // 写入目标=调用方给定的 NODE 键（修前红：写幽灵 'track-x7f9' 键——seedEntry 不在）。
    expect((doc.getMap('timelines') as Y.Map<unknown>).has('track-x7f9')).toBe(false);
    const read = readTimelineFromDoc(doc.getMap('timelines').get(NODE))!;
    expect(read.tracks[0]).toMatchObject({ id: 'track-x7f9', type: 'audio', order: '9000' });
    expect(read.clips['a1']).toMatchObject({ type: 'audio', mediaId: 'm-a1' });
  });
});
