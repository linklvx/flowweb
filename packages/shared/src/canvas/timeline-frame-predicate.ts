// packages/shared/src/canvas/timeline-frame-predicate.ts
// Y4a T3（plan 2026-11-20-y4a-timeline-domain Task 3——spec §0 条 8〔§3.1 v6 修订⑤+v7 修订③
// 键矩阵〕）：**纯字段检查**时间轴帧谓词——三消费面共用单源（frame-deny L1 矩阵两支/validateAppliedL2
// currentTarget 分支/T4 客户端 commit 写前自检）。键矩阵封闭集逐字段执法（video/image/audio/subtitle
// 四类片段+三轨+入口五键+字面量）；span/transform/style/fade/transitionIn/transitionOut 解包后
// 逐字段执法（fontSize/opacity/fade.in 都在 JSON 标量里面）。
//
// 删除三级不在本谓词 add/update 面（spec §0 条 8：删除集只有 client 和 clock、L1 帧内读不出键名
// ——「L1 只查插入」）；L2 侧的三级删除规则（删 version/fps/tracks/clips 容器键非法、删片段/
// 轨道/关键帧条目与整棵 timelines.<nodeId> 合法）由 frame-deny.ts 的 L2 timelines 分支直接执法，
// 本文件只供纯字段检查。标量槽上出现 Y.Map/Y.Array/Y.Text 一律拒（deepCopyYMap 跨 doc 直 set
// 这三型的坑——spec §0 条 7）。
import * as Y from 'yjs';
import { isValidOrderKey } from './order-key';
import type { ProjectData } from '../types/video-project';

export type TimelinePredicateVerdict = { ok: true } | { ok: false; reason: string };

/** 入口容器键（spec §0 条 8——L2 三级删除规则的非法删除集：删这些容器键=拆容器再塞新 Map 的绕过面）。 */
const ENTRY_CONTAINER_KEYS = new Set(['version', 'fps', 'tracks', 'clips']);

/** 片段四型键矩阵（spec §3.1 v7 修订③）：video=span/transform/mediaId/sourceNodeId/playbackSpeed/
 *  transitionIn/transitionOut/keyframes；image=同 video 但无 playbackSpeed；audio=span/mediaId/
 *  sourceNodeId/volume/fade/playbackSpeed/keyframes；subtitle=span/text/visible/style（无 keyframes/mediaId）。 */
const CLIP_KEYS: Record<string, ReadonlySet<string>> = {
  video: new Set(['type', 'span', 'transform', 'mediaId', 'sourceNodeId', 'playbackSpeed', 'transitionIn', 'transitionOut', 'keyframes']),
  image: new Set(['type', 'span', 'transform', 'mediaId', 'sourceNodeId', 'transitionIn', 'transitionOut', 'keyframes']),
  audio: new Set(['type', 'span', 'mediaId', 'sourceNodeId', 'volume', 'fade', 'playbackSpeed', 'keyframes']),
  subtitle: new Set(['type', 'span', 'text', 'visible', 'style']),
};

const TRACK_KEYS = new Set(['type', 'name', 'muted', 'hidden', 'order']);
const TRACK_TYPES = new Set(['video', 'subtitle', 'audio']);
const TRANSITION_TYPES = new Set(['fadeIn', 'fadeOut', 'crossfade', 'toBlack', 'toWhite']);
const PLAYBACK_SPEEDS = new Set([0.5, 1, 2]);
const TRANSFORM_KEYFRAME_PROPERTIES = new Set(['x', 'y', 'scale', 'rotation', 'opacity']);

/** Yjs 容器污染判定（标量槽拒绝 Y.Map/Y.Array/Y.Text——spec §0 条 7）。 */
const isYjsContainer = (v: unknown): boolean =>
  v instanceof Y.Map || v instanceof Y.Array || v instanceof Y.Text;

/** 有限数（NaN/Infinity/−Infinity 拒——spec §3.1 v7 修订③「非有限数拒」）。 */
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** span 五字段执法：trackId 非空串、start 有限非负、duration 有限正、sourceStart（可缺）有限非负。 */
function checkSpan(nodeId: string, span: unknown, allowSourceStart: boolean): string | undefined {
  if (span === undefined) return `timeline-missing:${nodeId}.span`;
  if (isYjsContainer(span) || typeof span !== 'object' || span === null) return `timeline-span:${nodeId}`;
  const s = span as Record<string, unknown>;
  if (typeof s.trackId !== 'string' || s.trackId === '') return `timeline-span:${nodeId}.trackId`;
  if (!isFiniteNumber(s.start) || s.start < 0) return `timeline-span:${nodeId}.start`;
  if (!isFiniteNumber(s.duration) || s.duration <= 0) return `timeline-span:${nodeId}.duration`;
  if (s.sourceStart !== undefined && (!isFiniteNumber(s.sourceStart) || s.sourceStart < 0)) return `timeline-span:${nodeId}.sourceStart`;
  if (!allowSourceStart && s.sourceStart !== undefined) return `timeline-span:${nodeId}.sourceStart-forbidden`;
  return undefined;
}

/** transform 五字段执法（有限数——opacity ∈[0,1] 域维持 finite 档即可）。 */
function checkTransform(nodeId: string, t: unknown): string | undefined {
  if (t === undefined) return `timeline-missing:${nodeId}.transform`;
  if (isYjsContainer(t) || typeof t !== 'object' || t === null) return `timeline-transform:${nodeId}`;
  const v = t as Record<string, unknown>;
  for (const k of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) {
    if (!isFiniteNumber(v[k])) return `timeline-transform:${nodeId}.${k}`;
  }
  return undefined;
}

/** Transition 执法：五型之一+正 duration（spec §3.1 v7 修订③）。 */
function checkTransition(nodeId: string, slot: string, t: unknown): string | undefined {
  if (t === undefined) return undefined;   // 可选槽
  if (isYjsContainer(t) || typeof t !== 'object' || t === null) return `timeline-${slot}:${nodeId}`;
  const v = t as Record<string, unknown>;
  if (!TRANSITION_TYPES.has(v.type as string)) return `timeline-${slot}:${nodeId}.type`;
  if (!isFiniteNumber(v.duration) || v.duration <= 0) return `timeline-${slot}:${nodeId}.duration`;
  return undefined;
}

/** fade 执法（audio）：in/out 有限非负。 */
function checkFade(nodeId: string, f: unknown): string | undefined {
  if (f === undefined) return `timeline-missing:${nodeId}.fade`;
  if (isYjsContainer(f) || typeof f !== 'object' || f === null) return `timeline-fade:${nodeId}`;
  const v = f as Record<string, unknown>;
  if (!isFiniteNumber(v.in) || (v.in as number) < 0) return `timeline-fade:${nodeId}.in`;
  if (!isFiniteNumber(v.out) || (v.out as number) < 0) return `timeline-fade:${nodeId}.out`;
  return undefined;
}

/** subtitle style 执法：fontSize 有限正/letterSpacing 有限。 */
function checkStyle(nodeId: string, st: unknown): string | undefined {
  if (st === undefined) return `timeline-missing:${nodeId}.style`;
  if (isYjsContainer(st) || typeof st !== 'object' || st === null) return `timeline-style:${nodeId}`;
  const v = st as Record<string, unknown>;
  if (!isFiniteNumber(v.fontSize) || (v.fontSize as number) <= 0) return `timeline-style:${nodeId}.fontSize`;
  if (!isFiniteNumber(v.letterSpacing)) return `timeline-style:${nodeId}.letterSpacing`;
  if (typeof v.color !== 'string') return `timeline-style:${nodeId}.color`;
  return undefined;
}

/**
 * 单片段 Map 字段执法（键矩阵+逐字段——clipId=Map 键=记录自身 id，Map 键≠记录 id 形态由调用方
 * 传入 clipId 与 Map 内 id 域比对：键≠id 拒）。返回 undefined=通过。
 */
export function checkTimelineClipMap(clipId: string, clipMap: Y.Map<unknown>): string | undefined {
  if (clipId === '') return 'timeline-clip-empty-id';
  const type = clipMap.get('type');
  if (typeof type !== 'string' || !(type in CLIP_KEYS)) return `timeline-clip-type:${clipId}`;
  const allowed = CLIP_KEYS[type]!;
  for (const k of clipMap.keys()) {
    if (!allowed.has(k)) return `timeline-clip-key:${clipId}.${k}`;
  }
  // span 档（video/audio 含 sourceStart；image/subtitle 不含）
  const spanErr = checkSpan(clipId, clipMap.get('span'), type === 'video' || type === 'audio');
  if (spanErr !== undefined) return spanErr;
  if (type === 'video' || type === 'image') {
    const tErr = checkTransform(clipId, clipMap.get('transform'));
    if (tErr !== undefined) return tErr;
  }
  if (type === 'video' || type === 'image') {
    const inErr = checkTransition(clipId, 'transitionIn', clipMap.get('transitionIn'));
    if (inErr !== undefined) return inErr;
    const outErr = checkTransition(clipId, 'transitionOut', clipMap.get('transitionOut'));
    if (outErr !== undefined) return outErr;
  }
  if (type === 'audio') {
    const fadeErr = checkFade(clipId, clipMap.get('fade'));
    if (fadeErr !== undefined) return fadeErr;
    const vol = clipMap.get('volume');
    if (!isFiniteNumber(vol)) return `timeline-volume:${clipId}`;
  }
  if (type === 'video' || type === 'audio') {
    const ps = clipMap.get('playbackSpeed');
    if (!PLAYBACK_SPEEDS.has(ps as number)) return `timeline-playback-speed:${clipId}`;
  }
  if (type === 'subtitle') {
    if (typeof clipMap.get('text') !== 'string') return `timeline-text:${clipId}`;
    if (typeof clipMap.get('visible') !== 'boolean') return `timeline-visible:${clipId}`;
    const stErr = checkStyle(clipId, clipMap.get('style'));
    if (stErr !== undefined) return stErr;
  }
  // mediaId 档：video/image/audio 非空字符串；subtitle 无槽（键矩阵已拒）
  if (type !== 'subtitle') {
    const mid = clipMap.get('mediaId');
    if (typeof mid !== 'string' || mid === '') return `timeline-media-id:${clipId}`;
  }
  // keyframes 档：video/image/audio=必须 Y.Map（随片段出生——§3.1 v6 修订④）；subtitle 键矩阵已拒
  if (type !== 'subtitle') {
    const kf = clipMap.get('keyframes');
    if (!(kf instanceof Y.Map)) return `timeline-keyframes:${clipId}`;
    for (const [kId, kfVal] of kf.entries()) {
      const err = checkKeyframe(kId, kfVal, type);
      if (err !== undefined) return err;
    }
  }
  // Map 键=记录自身 id（spec §3.1 v6 修订⑤——键≠id 拒；span.trackId 不参与此比对）
  void clipId;
  return undefined;
}

/** 关键帧标量执法：id=Map 键、t 有限、easing 只 linear；Transform 档 property∈五键+value 有限；
 *  Volume 档无 property（spec §3.1 v7 修订③——切比例不改音量关键帧）。 */
function checkKeyframe(kId: string, kfVal: unknown, clipType: string): string | undefined {
  if (kId === '') return 'timeline-keyframe-empty-id';
  if (isYjsContainer(kfVal) || typeof kfVal !== 'object' || kfVal === null) return `timeline-keyframe:${kId}`;
  const v = kfVal as Record<string, unknown>;
  if (v.id !== kId) return `timeline-keyframe-id:${kId}`;   // Map 键=记录自身 id
  if (!isFiniteNumber(v.t)) return `timeline-keyframe-t:${kId}`;
  if (v.easing !== 'linear') return `timeline-keyframe-easing:${kId}`;
  if (clipType === 'audio') {
    if ('property' in v) return `timeline-keyframe-property:${kId}`;   // 音量关键帧无 property
    if (!isFiniteNumber(v.value)) return `timeline-keyframe-value:${kId}`;
    return undefined;
  }
  if (!TRANSFORM_KEYFRAME_PROPERTIES.has(v.property as string)) return `timeline-keyframe-property:${kId}`;
  if (!isFiniteNumber(v.value)) return `timeline-keyframe-value:${kId}`;
  return undefined;
}

/** 轨 Map 字段执法（三型+五键+order 键域单源 isValidOrderKey）。 */
function checkTrackMap(trackId: string, track: Y.Map<unknown>): string | undefined {
  for (const k of track.keys()) {
    if (!TRACK_KEYS.has(k)) return `timeline-track-key:${trackId}.${k}`;
  }
  const type = track.get('type');
  if (typeof type !== 'string' || !TRACK_TYPES.has(type)) return `timeline-track-type:${trackId}`;
  if (typeof track.get('name') !== 'string') return `timeline-track-name:${trackId}`;
  if (typeof track.get('muted') !== 'boolean') return `timeline-track-muted:${trackId}`;
  if (typeof track.get('hidden') !== 'boolean') return `timeline-track-hidden:${trackId}`;
  const order = track.get('order');
  if (!isValidOrderKey(order)) return `timeline-track-order:${trackId}`;
  return undefined;
}

/** 入口 Map 字段执法（version=1/fps=30 字面量+canvasSize 有限正+tracks/clips Y.Map）。
 *  hasBefore=true（L2 update 路径）时 tracks/clips 已存在键 set 新 Y.Map=结构拒绝。 */
export function checkTimelineEntryMap(nodeId: string, entry: Y.Map<unknown>, existing: Y.Map<unknown> | undefined): string | undefined {
  const version = entry.get('version');
  if (version !== 1) return `timeline-version:${nodeId}`;
  const fps = entry.get('fps');
  if (fps !== 30) return `timeline-fps:${nodeId}`;
  const canvasSize = entry.get('canvasSize');
  if (canvasSize !== undefined) {
    if (isYjsContainer(canvasSize) || typeof canvasSize !== 'object' || canvasSize === null) return `timeline-canvas-size:${nodeId}`;
    const cs = canvasSize as Record<string, unknown>;
    if (!isFiniteNumber(cs.width) || (cs.width as number) <= 0) return `timeline-canvas-size:${nodeId}.width`;
    if (!isFiniteNumber(cs.height) || (cs.height as number) <= 0) return `timeline-canvas-size:${nodeId}.height`;
  }
  // tracks/clips 容器：存在即必须 Y.Map；已存在键 set 新 Y.Map=结构拒绝（「删了换新」等效绕过）
  for (const k of ['tracks', 'clips'] as const) {
    const v = entry.get(k);
    if (v === undefined) return `timeline-missing:${nodeId}.${k}`;
    if (!(v instanceof Y.Map)) return `timeline-${k}:${nodeId}`;
    if (existing !== undefined) {
      const prev = existing.get(k);
      if (prev !== undefined && prev !== v) return `timeline-${k}-replaced:${nodeId}`;
    }
  }
  for (const k of entry.keys()) {
    if (k !== 'version' && k !== 'fps' && k !== 'canvasSize' && !ENTRY_CONTAINER_KEYS.has(k)) {
      return `timeline-entry-key:${nodeId}.${k}`;
    }
  }
  const tracks = entry.get('tracks') as Y.Map<unknown>;
  for (const [tid, t] of tracks.entries()) {
    if (!(t instanceof Y.Map)) return `timeline-track:${tid}`;
    const tErr = checkTrackMap(tid, t);
    if (tErr !== undefined) return tErr;
  }
  const clips = entry.get('clips') as Y.Map<unknown>;
  for (const [cid, c] of clips.entries()) {
    if (!(c instanceof Y.Map)) return `timeline-clip:${cid}`;
    const cErr = checkTimelineClipMap(cid, c);
    if (cErr !== undefined) return cErr;
  }
  return undefined;
}

/** 帧内深链档结构判定：per-struct 的「这是不是一个合法的 timelines 插入形态」——
 *  供 frame-deny L1 逐 struct 路径调用（framePathOf 已解析 keys——纯字段检查零 doc 依赖）。 */

/** L2 根键 add 递归面：action='add' 且新值为 Y.Map 时按入口矩阵整树递归（同事务 new Y.Map
 *  子树不发独立事件——只查「这是个 Map」漏掉整棵新工程）。existing=根上该键先前的值
 *  （结构拒绝面：先前已是 Map、新值不同实例=set 新 Map 拒）。 */
export function checkTimelineEntryValue(nodeId: string, value: unknown, previous: unknown): string | undefined {
  if (!(value instanceof Y.Map)) return `timeline-entry-not-map:${nodeId}`;
  const prevMap = previous instanceof Y.Map ? previous : undefined;
  return checkTimelineEntryMap(nodeId, value, prevMap);
}

/**
 * timelines 帧谓词（L1 签名——update: Uint8Array + doc: Y.Doc → verdict；纯解码级零写）。
 * 消费面=frame-deny L1 直接子项档/帧内深链档（插入 struct 逐路径执法——见 frame-deny.ts 接线注记）
 * +T4 客户端写前自检（临时 doc 两级闸之一）。本函数对整帧解码后遍历 timelines 根全部键：
 * 只检查**本帧插入/可读形态**（导入整棵新树走这里）；删除集（client/clock）无键名不执法。
 */
export function TIMELINE_FRAME_PREDICATE(update: Uint8Array, doc: Y.Doc): TimelinePredicateVerdict {
  // 解码面由调用方（frame-deny L1）先行——本面直接在 doc 上验证根上可见的 timelines 状态：
  // 帧应用后临界区语义（L1 的 frame-local 不可判定面=「父出帧」由 L2 承接）。
  const timelines = doc.getMap('timelines');
  for (const [nodeId, entry] of timelines.entries()) {
    if (entry === undefined) continue;
    if (!(entry instanceof Y.Map)) return { ok: false, reason: `timeline-entry-not-map:${nodeId}` };
    const err = checkTimelineEntryMap(nodeId, entry, undefined);
    if (err !== undefined) return { ok: false, reason: err };
  }
  void update;
  return { ok: true };
}
