// packages/shared/src/canvas/timeline-codec.ts
// Y4a T3（plan 2026-11-20-y4a-timeline-domain Task 3——spec §3.1 v6 修订④⑤/§3.4〔条 9 换键〕）：
// timeline codec 骨架——Y.Map↔ProjectData 互转+diff 写路径+读回排序三档+clip mediaId 提取单源。
//
//  - seedEmptyTimeline：空工程种点（applyIntentToDoc addNode 分支同族形态——**不调
//    createDefaultProjectData**〔它用 genId('track')〕；默认轨 id=`${nodeId}:video`、
//    order=FIRST_ORDER_KEY 单源、名「视频」、clips 空 Map）；
//  - readTimelineFromDoc：读回=轨 order 再 trackId、片段 start 再 clipId、关键帧 t 再 id
//    （spec §3.1 v6 修订⑤读回顺序定死）；track.clips 推导生成（不参与 diff）；
//  - diffProjectDataToDoc：结构 diff 只改碰到的键；span/transform/style/fade/transitionIn/
//    transitionOut 整值替换；**禁止给已存在键 set 新 Map**（并发互吃=spec §9 锚 7）；
//    clip 创建同笔事务放空 keyframes Map（字幕除外——§3.1 v6 修订④）。diff 输入基线=
//    「doc 已合入状态」由调用方组合（T4 拖动档：doc 读回叠本地覆盖层），codec 只对两份
//    ProjectData diff；
//  - extractTimelineClipMediaIds：clip mediaId 提取单源（video/image/audio 按类型键矩阵、
//    空 clipId/空 mediaId 不产行、subtitle 无槽——T6 collectNodeRefsUnion 消费，不另写第二套扫描）。
import * as Y from 'yjs';
import { FIRST_ORDER_KEY, compareOrderKeys } from './order-key';
import type {
  ProjectData, Track, VideoClip, ImageClip, AudioClip, SubtitleClip,
  TransformKeyframe, VolumeKeyframe,
} from '../types/video-project';

type AnyClip = VideoClip | ImageClip | AudioClip | SubtitleClip;

/** 空工程种点：version=1/fps=30/单默认轨 `${nodeId}:video`（order=FIRST_ORDER_KEY、名「视频」）/
 *  clips 空 Map。不调 createDefaultProjectData（genId('track') 随机 id——默认轨 id 形态=契约面）。 */
export function seedEmptyTimeline(nodeId: string): Y.Map<unknown> {
  const track = new Y.Map();
  track.set('type', 'video');
  track.set('name', '视频');
  track.set('muted', false);
  track.set('hidden', false);
  track.set('order', FIRST_ORDER_KEY);
  const tracks = new Y.Map();
  tracks.set(`${nodeId}:video`, track);
  const entry = new Y.Map();
  entry.set('version', 1);
  entry.set('fps', 30);
  entry.set('tracks', tracks);
  entry.set('clips', new Y.Map());
  return entry;
}

/** 读侧标量窄化（非标量读作缺省——E68 读侧全函数：毒值不抛、值域外跳过）。 */
const scalarOf = (m: Y.Map<unknown>, k: string): unknown => {
  const v = m.get(k);
  return v instanceof Y.Map || v instanceof Y.Array || v instanceof Y.Text ? undefined : v;
};

/** 读回单个轨（五键直读；clips 由外层推导注入）。 */
function readTrackFromMap(trackId: string, m: Y.Map<unknown>): Track | null {
  const type = scalarOf(m, 'type');
  if (type !== 'video' && type !== 'subtitle' && type !== 'audio') return null;
  const name = scalarOf(m, 'name');
  const muted = scalarOf(m, 'muted');
  const hidden = scalarOf(m, 'hidden');
  const order = scalarOf(m, 'order');
  if (typeof name !== 'string' || typeof muted !== 'boolean' || typeof hidden !== 'boolean' || typeof order !== 'string') return null;
  return { id: trackId, type, name, muted, hidden, clips: [], order };
}

/** 读回单个片段（按键矩阵读回五档：span/transform/transition/字幕三键/mediaId+keyframes）。 */
function readClipFromMap(clipId: string, m: Y.Map<unknown>): AnyClip | null {
  const type = scalarOf(m, 'type');
  const span = scalarOf(m, 'span');
  if (typeof span !== 'object' || span === null) return null;
  const sp = span as Record<string, unknown>;
  if (typeof sp.trackId !== 'string' || typeof sp.start !== 'number' || typeof sp.duration !== 'number') return null;
  const base = { id: clipId, trackId: sp.trackId, start: sp.start, duration: sp.duration };
  if (type === 'subtitle') {
    const text = scalarOf(m, 'text');
    const visible = scalarOf(m, 'visible');
    const style = scalarOf(m, 'style');
    if (typeof text !== 'string' || typeof visible !== 'boolean' || typeof style !== 'object' || style === null) return null;
    const st = style as Record<string, unknown>;
    if (typeof st.fontSize !== 'number' || typeof st.color !== 'string' || typeof st.letterSpacing !== 'number') return null;
    return { ...base, type: 'subtitle', text, visible, style: { fontSize: st.fontSize, color: st.color, letterSpacing: st.letterSpacing } } satisfies SubtitleClip;
  }
  const mediaId = scalarOf(m, 'mediaId');
  if (typeof mediaId !== 'string') return null;
  const sourceNodeId = scalarOf(m, 'sourceNodeId');
  const keyframes = readKeyframesFromMap(m.get('keyframes'), type === 'audio');
  if (type === 'audio') {
    const volume = scalarOf(m, 'volume');
    const fade = scalarOf(m, 'fade');
    const playbackSpeed = scalarOf(m, 'playbackSpeed');
    if (typeof volume !== 'number' || typeof fade !== 'object' || fade === null) return null;
    const f = fade as Record<string, unknown>;
    if (typeof f.in !== 'number' || typeof f.out !== 'number') return null;
    if (sp.sourceStart === undefined || typeof sp.sourceStart !== 'number') return null;   // AudioClip.sourceStart 必在
    const clip: AudioClip = {
      ...base, type: 'audio', sourceStart: sp.sourceStart,
      mediaId,
      ...(typeof sourceNodeId === 'string' ? { sourceNodeId } : {}),
      volume, fade: { in: f.in, out: f.out },
      playbackSpeed: (playbackSpeed === 0.5 || playbackSpeed === 2 ? playbackSpeed : 1),
      keyframes: keyframes as VolumeKeyframe[],
    };
    return clip;
  }
  const transform = scalarOf(m, 'transform');
  if (typeof transform !== 'object' || transform === null) return null;
  const tf = transform as Record<string, unknown>;
  const norm = (t: Record<string, unknown>): { x: number; y: number; scale: number; rotation: number; opacity: number } | null =>
    typeof t.x === 'number' && typeof t.y === 'number' && typeof t.scale === 'number' && typeof t.rotation === 'number' && typeof t.opacity === 'number'
      ? { x: t.x, y: t.y, scale: t.scale, rotation: t.rotation, opacity: t.opacity }
      : null;
  const tfNorm = norm(tf);
  if (tfNorm === null) return null;
  const readTransition = (slot: string): { type: 'fadeIn' | 'fadeOut' | 'crossfade' | 'toBlack' | 'toWhite'; duration: number } | undefined => {
    const v = scalarOf(m, slot);
    if (typeof v !== 'object' || v === null) return undefined;
    const t = v as Record<string, unknown>;
    if (typeof t.type !== 'string' || typeof t.duration !== 'number') return undefined;
    if (t.type !== 'fadeIn' && t.type !== 'fadeOut' && t.type !== 'crossfade' && t.type !== 'toBlack' && t.type !== 'toWhite') return undefined;
    return { type: t.type, duration: t.duration };
  };
  const transitionIn = readTransition('transitionIn');
  const transitionOut = readTransition('transitionOut');
  if (type === 'image') {
    const clip: ImageClip = {
      ...base, type: 'image', mediaId,
      ...(typeof sourceNodeId === 'string' ? { sourceNodeId } : {}),
      transform: tfNorm,
      ...(transitionIn !== undefined ? { transitionIn } : {}),
      ...(transitionOut !== undefined ? { transitionOut } : {}),
      keyframes: keyframes as TransformKeyframe[],
    };
    return clip;
  }
  if (type === 'video') {
    const playbackSpeed = scalarOf(m, 'playbackSpeed');
    const clip: VideoClip = {
      ...base, type: 'video',
      ...(sp.sourceStart !== undefined ? { sourceStart: sp.sourceStart as number } : { sourceStart: 0 }),
      mediaId,
      ...(typeof sourceNodeId === 'string' ? { sourceNodeId } : {}),
      transform: tfNorm,
      playbackSpeed: (playbackSpeed === 0.5 || playbackSpeed === 2 ? playbackSpeed : 1),
      ...(transitionIn !== undefined ? { transitionIn } : {}),
      ...(transitionOut !== undefined ? { transitionOut } : {}),
      keyframes: keyframes as TransformKeyframe[],
    };
    return clip;
  }
  return null;
}

/** 读回关键帧（t 再 id 排序；audio 档无 property——VolumeKeyframe）。 */
function readKeyframesFromMap(kf: unknown, isVolume: boolean): Array<TransformKeyframe | VolumeKeyframe> {
  if (!(kf instanceof Y.Map)) return [];
  const out: Array<TransformKeyframe | VolumeKeyframe> = [];
  for (const [id, v] of kf.entries()) {
    if (typeof v !== 'object' || v === null) continue;
    const r = v as Record<string, unknown>;
    if (typeof r.t !== 'number' || r.easing !== 'linear' || typeof r.value !== 'number') continue;
    if (isVolume) {
      out.push({ id, t: r.t, value: r.value, easing: 'linear' });
    } else {
      if (typeof r.property !== 'string') continue;
      if (r.property !== 'x' && r.property !== 'y' && r.property !== 'scale' && r.property !== 'rotation' && r.property !== 'opacity') continue;
      out.push({ id, t: r.t, property: r.property, value: r.value, easing: 'linear' });
    }
  }
  out.sort((a, b) => (a.t === b.t ? (a.id < b.id ? -1 : 1) : a.t - b.t));
  return out;
}

/** 读回 per-node 工程入口：非 Y.Map 返 null；轨按 order 再 trackId、片段按 start 再 clipId；
 *  track.clips 推导生成（按轨聚合+start 排序）。 */
export function readTimelineFromDoc(entry: unknown): ProjectData | null {
  if (!(entry instanceof Y.Map)) return null;
  const version = scalarOf(entry, 'version');
  const fps = scalarOf(entry, 'fps');
  if (version !== 1 || fps !== 30) return null;
  const tracksMap = entry.get('tracks');
  const clipsMap = entry.get('clips');
  if (!(tracksMap instanceof Y.Map) || !(clipsMap instanceof Y.Map)) return null;
  const canvasSizeRaw = scalarOf(entry, 'canvasSize');
  let canvasSize: { width: number; height: number } | undefined;
  if (typeof canvasSizeRaw === 'object' && canvasSizeRaw !== null) {
    const cs = canvasSizeRaw as Record<string, unknown>;
    if (typeof cs.width === 'number' && typeof cs.height === 'number') canvasSize = { width: cs.width, height: cs.height };
  }
  const tracks: Track[] = [];
  for (const [tid, t] of tracksMap.entries()) {
    if (!(t instanceof Y.Map)) continue;
    const track = readTrackFromMap(tid, t);
    if (track !== null) tracks.push(track);
  }
  const clips: ProjectData['clips'] = {};
  for (const [cid, c] of clipsMap.entries()) {
    if (!(c instanceof Y.Map)) continue;
    const clip = readClipFromMap(cid, c);
    if (clip !== null) clips[cid] = clip;
  }
  // 读回排序三档（spec §3.1 v6 修订⑤）：轨 order 再 trackId（数值序单源 compareOrderKeys）；
  // track.clips=按 start 再 clipId 推导聚合。
  tracks.sort((a, b) => (a.order === b.order ? (a.id < b.id ? -1 : 1) : compareOrderKeys(a.order, b.order)));
  const byTrack = new Map<string, Array<{ id: string; start: number }>>();
  for (const [cid, clip] of Object.entries(clips)) byTrack.set(clip.trackId, [...(byTrack.get(clip.trackId) ?? []), { id: cid, start: clip.start }]);
  for (const track of tracks) {
    track.clips = (byTrack.get(track.id) ?? []).sort((a, b) => (a.start === b.start ? (a.id < b.id ? -1 : 1) : a.start - b.start)).map((c) => c.id);
  }
  return { version: 1, fps: 30, ...(canvasSize !== undefined ? { canvasSize } : {}), tracks, clips };
}

/**
 * 结构 diff：对 before/after 两份 ProjectData 产 Y.Map 操作序列（只改碰到的键）。
 * nodeId=显式形参（controller 裁定：调用方〔T4 editorStore〕持有剪辑节点 id——禁内容推导，
 * tracks[0].id 冒号前缀推导在用户加轨 genId('track') 无前缀时产幽灵 timelines['track-xyz'] 条目）。
 * 规则（spec §3.1 v6 修订⑤）：标量整值替换（span/transform/style/fade/transitionIn/
 * transitionOut/color/text…）；clip 增删走键级；keyframes 增删走键级；**禁止对已存在键 set
 * 新 Map**——tracks/clips/keyframes 容器只 add 新键/delete 缺键/改既有键的值。clip 创建同笔
 * 放空 keyframes Map（subtitle 除外——无此键）。
 */
export function diffProjectDataToDoc(
  timelines: Y.Map<unknown>,
  nodeId: string,
  before: ProjectData,
  after: ProjectData,
): Array<(tx: Y.Transaction) => void> {
  const ops: Array<(tx: Y.Transaction) => void> = [];
  if (nodeId === '') return ops;
  const ensureEntry = (tx: Y.Transaction): Y.Map<unknown> => {
    const existing = timelines.get(nodeId);
    if (existing instanceof Y.Map) return existing;
    const fresh = seedEmptyTimeline(nodeId);
    timelines.set(nodeId, fresh);
    return fresh;
  };
  const entryOp = (fn: (entry: Y.Map<unknown>) => void): void => {
    ops.push((tx) => { void tx; fn(ensureEntry(tx)); });
  };

  // 入口标量档：canvasSize（version/fps 字面量恒等不 diff）
  if (JSON.stringify(before.canvasSize) !== JSON.stringify(after.canvasSize)) {
    entryOp((entry) => {
      if (after.canvasSize !== undefined) entry.set('canvasSize', after.canvasSize);
      else entry.delete('canvasSize');
    });
  }

  // 轨档：增/删/标量改（只 add 新键、delete 缺键、改五键值——不 set 新 Map）
  const beforeTracks = new Map(before.tracks.map((t) => [t.id, t]));
  const afterTracks = new Map(after.tracks.map((t) => [t.id, t]));
  for (const [tid, t] of afterTracks) {
    const prev = beforeTracks.get(tid);
    if (prev === undefined) {
      entryOp((entry) => {
        const tracks = entry.get('tracks');
        if (!(tracks instanceof Y.Map)) return;
        if (tracks.has(tid)) return;   // 并发对端已建同 id 轨——不覆盖（只改值语义）
        const m = new Y.Map();
        m.set('type', t.type); m.set('name', t.name); m.set('muted', t.muted); m.set('hidden', t.hidden); m.set('order', t.order);
        tracks.set(tid, m);
      });
      continue;
    }
    for (const k of ['type', 'name', 'muted', 'hidden', 'order'] as const) {
      if (prev[k] !== t[k]) entryOp((entry) => {
        const tracks = entry.get('tracks');
        if (!(tracks instanceof Y.Map)) return;
        const m = tracks.get(tid);
        if (m instanceof Y.Map) m.set(k, t[k]);
      });
    }
  }
  for (const tid of beforeTracks.keys()) {
    if (!afterTracks.has(tid)) entryOp((entry) => {
      const tracks = entry.get('tracks');
      if (tracks instanceof Y.Map) tracks.delete(tid);
    });
  }

  // 片段档：增（同笔放空 keyframes Map——subtitle 除外）/删/标量整值替换/keyframes 键级
  const beforeClips = new Map(Object.entries(before.clips));
  const afterClips = new Map(Object.entries(after.clips));
  for (const [cid, c] of afterClips) {
    const prev = beforeClips.get(cid);
    if (prev === undefined) {
      entryOp((entry) => {
        const clips = entry.get('clips');
        if (!(clips instanceof Y.Map)) return;
        if (clips.has(cid)) return;   // 并发对端已建同 id 片段——不覆盖（spec §9 锚 7）
        const m = new Y.Map();
        for (const [k, v] of Object.entries(clipToDocFields(c))) m.set(k, v);
        if (c.type !== 'subtitle') m.set('keyframes', new Y.Map());   // 随片段出生（§3.1 v6 修订④）
        clips.set(cid, m);
      });
      // keyframes 增：新片段的初始关键帧（键级 set——不换容器）
      if (c.type !== 'subtitle' && c.keyframes.length > 0) {
        entryOp((entry) => {
          const clips = entry.get('clips');
          if (!(clips instanceof Y.Map)) return;
          const m = clips.get(cid);
          if (!(m instanceof Y.Map)) return;
          const kf = m.get('keyframes');
          if (!(kf instanceof Y.Map)) return;
          for (const k of c.keyframes) if (!kf.has(k.id)) kf.set(k.id, { ...k });
        });
      }
      continue;
    }
    // 既有片段：标量档逐键整值替换（span/transform/style/fade/transitionIn/transitionOut/
    // text/visible/volume/playbackSpeed/mediaId/sourceNodeId——键级 diff 不换 Map）
    const changed = diffClipFields(prev, c);
    for (const [k, v] of changed) entryOp((entry) => {
      const clips = entry.get('clips');
      if (!(clips instanceof Y.Map)) return;
      const m = clips.get(cid);
      if (m instanceof Y.Map) m.set(k, v);
    });
    // keyframes 键级：add 新 id/delete 缺 id/update 既有 id 整值
    if (c.type !== 'subtitle') {
      const prevKf = prev.type === 'subtitle' ? [] : prev.keyframes;
      if (!keyframesEqual(prevKf, c.keyframes)) entryOp((entry) => {
        const clips = entry.get('clips');
        if (!(clips instanceof Y.Map)) return;
        const m = clips.get(cid);
        if (!(m instanceof Y.Map)) return;
        const kf = m.get('keyframes');
        if (!(kf instanceof Y.Map)) return;
        const prevById = new Map(prevKf.map((k) => [k.id, k]));
        for (const k of c.keyframes) {
          const p = prevById.get(k.id);
          if (p === undefined) { if (!kf.has(k.id)) kf.set(k.id, { ...k }); continue; }
          if (JSON.stringify(p) !== JSON.stringify(k)) kf.set(k.id, { ...k });
        }
        for (const k of prevKf) if (!c.keyframes.some((nk) => nk.id === k.id)) kf.delete(k.id);
      });
    }
  }
  for (const cid of beforeClips.keys()) {
    if (!afterClips.has(cid)) entryOp((entry) => {
      const clips = entry.get('clips');
      if (clips instanceof Y.Map) clips.delete(cid);
    });
  }
  return ops;
}

/** 片段→doc 键值集（不含 keyframes——出生时单独放空 Map；type 键含入）。
 *  mediaId 只对 video/image/audio 写出（类型键矩阵——subtitle 无此槽：m.set('mediaId',
 *  undefined) 实测留键、自家谓词键矩阵拒 timeline-clip-key:<id>.mediaId）。 */
function clipToDocFields(c: AnyClip): Record<string, unknown> {
  const out: Record<string, unknown> = { type: c.type, span: spanOf(c) };
  if (c.type === 'video' || c.type === 'image') out.transform = c.transform;
  if (c.type === 'video' || c.type === 'image') {
    if (c.transitionIn !== undefined) out.transitionIn = c.transitionIn;
    if (c.transitionOut !== undefined) out.transitionOut = c.transitionOut;
  }
  if (c.type === 'audio') { out.volume = c.volume; out.fade = c.fade; }
  if (c.type === 'video' || c.type === 'audio') out.playbackSpeed = c.playbackSpeed;
  if (c.type === 'subtitle') { out.text = c.text; out.visible = c.visible; out.style = c.style; }
  if (c.type !== 'subtitle') out.mediaId = (c as { mediaId: string }).mediaId;
  if ((c as { sourceNodeId?: string }).sourceNodeId !== undefined) out.sourceNodeId = (c as { sourceNodeId?: string }).sourceNodeId;
  return out;
}

const spanOf = (c: AnyClip): { trackId: string; start: number; duration: number; sourceStart?: number } =>
  c.type === 'video' || c.type === 'audio'
    ? { trackId: c.trackId, start: c.start, duration: c.duration, sourceStart: c.sourceStart }
    : { trackId: c.trackId, start: c.start, duration: c.duration };

/** 既有片段标量键级 diff（整值替换——返回 [key, value] 变更集）。 */
function diffClipFields(prev: AnyClip, next: AnyClip): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  if (prev.type !== next.type) return [['type', next.type]];
  if (JSON.stringify(spanOf(prev)) !== JSON.stringify(spanOf(next))) out.push(['span', spanOf(next)]);
  const slots: Array<string> = [];
  if (next.type === 'video' || next.type === 'image') slots.push('transform', 'transitionIn', 'transitionOut');
  if (next.type === 'audio') slots.push('volume', 'fade', 'playbackSpeed');
  if (next.type === 'video') slots.push('playbackSpeed');
  if (next.type === 'subtitle') slots.push('text', 'visible', 'style');
  for (const s of slots) {
    const a = (prev as unknown as Record<string, unknown>)[s];
    const b = (next as unknown as Record<string, unknown>)[s];
    if (JSON.stringify(a) !== JSON.stringify(b) && b !== undefined) out.push([s, b]);
  }
  if ((prev as { mediaId: string }).mediaId !== (next as { mediaId: string }).mediaId) out.push(['mediaId', (next as { mediaId: string }).mediaId]);
  if ((prev as { sourceNodeId?: string }).sourceNodeId !== (next as { sourceNodeId?: string }).sourceNodeId) {
    const sn = (next as { sourceNodeId?: string }).sourceNodeId;
    if (sn !== undefined) out.push(['sourceNodeId', sn]);
  }
  return out;
}

/** keyframes 全等（id 集合相等**且每 id 值 deep-equal**——只比 id 会丢纯值编辑〔t/value 改〕产零 op）。 */
const keyframesEqual = (a: ReadonlyArray<{ id: string }>, b: ReadonlyArray<{ id: string }>): boolean => {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((k) => [k.id, k]));
  return b.every((k) => {
    const p = byId.get(k.id);
    return p !== undefined && JSON.stringify(p) === JSON.stringify(k);
  });
};

/** clip mediaId 提取单源（T6 collectNodeRefsUnion 消费）：video/image/audio 按类型键矩阵取
 *  mediaId；空 clipId/空 mediaId 不产行；subtitle 无槽；非 Y.Map/缺 clips 返空。 */
export function extractTimelineClipMediaIds(entry: unknown): Array<{ clipId: string; mediaId: string }> {
  if (!(entry instanceof Y.Map)) return [];
  const clips = entry.get('clips');
  if (!(clips instanceof Y.Map)) return [];
  const out: Array<{ clipId: string; mediaId: string }> = [];
  for (const [cid, c] of clips.entries()) {
    if (cid === '' || !(c instanceof Y.Map)) continue;
    const type = c.get('type');
    if (type !== 'video' && type !== 'image' && type !== 'audio') continue;   // subtitle 无槽
    const mediaId = c.get('mediaId');
    if (typeof mediaId !== 'string' || mediaId === '') continue;
    out.push({ clipId: cid, mediaId });
  }
  return out;
}
