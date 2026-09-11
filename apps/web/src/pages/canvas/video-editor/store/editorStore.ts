import { create } from 'zustand';
import type { Clip, ProjectData, Track, VideoClip, ImageClip, AudioClip, SubtitleClip, TransformKeyframe, VolumeKeyframe } from '../types';
import { genId } from '../types';
import { createHistory, pushHistory, undoHistory, redoHistory, type History } from '../timeline/history';
import {
  quantizeTime, trimLeftGuard, trimRightGuard, clampDelta,
  applyTrimLeft, applyTrimRight, splitClipAt,
} from '../timeline/clip-math';
import { canPlaceAt, findNearestFreeStart, clipsOnTrack } from '../timeline/overlap';
import { ensureAutoEdges } from '../timeline/auto-edges';
import { keyframeValueAt, interpolateTransform } from '../scene/interpolate';
import { stopCapturing } from '@/stores/canvasUndo';

export type EditorStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SaveState = 'saved' | 'saving' | 'error';

export interface MediaInfo { name: string; durationSec: number | undefined; url?: string; }

export interface AddClipInput {
  type: 'video' | 'image' | 'audio';
  mediaId: string;
  sourceNodeId?: string;
  trackId: string;
  start: number;
}

interface EditorState {
  projectId: string | null;
  sourceNodeId: string | null;
  baseUpdatedAt: string | null;
  data: ProjectData | null;
  status: EditorStatus;
  loadError: string | null;
  saveState: SaveState;
  selectedClipId: string | null;
  selectedKeyframeId: string | null;
  playhead: number;
  pxPerSec: number;
  playing: boolean;
  preparing: boolean;
  mediaInfo: Record<string, MediaInfo>;
  history: History<ProjectData>;
  pendingSnapshot: ProjectData | null;

  loadProject(p: { id: string; sourceNodeId: string; updatedAt: string; data: ProjectData }): void;
  setLoadError(msg: string): void;
  reset(): void;
  setSaveState(s: SaveState): void;
  setBaseUpdatedAt(t: string): void;
  setPlayhead(t: number): void;
  setPxPerSec(v: number): void;
  setPlaying(v: boolean): void;
  setPreparing(v: boolean): void;
  selectClip(id: string | null): void;
  setMediaInfo(mediaId: string, info: MediaInfo): void;
  mergeMediaInfo(entries: Record<string, MediaInfo>): void; // AssetPanel items → url/名称回填（仅填缺失键，不覆盖已有）

  addClip(input: AddClipInput): string | null;
  addSubtitleClip(trackId: string, start: number, text?: string): string;
  moveClip(clipId: string, start: number, trackId?: string, opts?: { transient?: boolean }): boolean;
  trimClip(clipId: string, edge: 'left' | 'right', deltaSec: number, opts?: { transient?: boolean }): boolean;
  splitClip(clipId: string, at: number): string | null;
  removeClip(clipId: string): void;
  updateClip(clipId: string, patch: Record<string, unknown>): void;
  addKeyframe(clipId: string, property: TransformKeyframe['property'] | 'volume'): string | null;
  removeKeyframe(clipId: string, kfId: string): void;
  moveKeyframe(clipId: string, kfId: string, t: number, opts?: { transient?: boolean }): boolean;
  addTrack(type: Track['type']): string;
  removeTrack(trackId: string): void;
  toggleTrack(trackId: string, key: 'muted' | 'hidden'): void;

  beginTransient(): void;
  endTransient(): boolean;
  undo(): void;
  redo(): void;
}

const sortTrackClips = (data: ProjectData): ProjectData => ({
  ...data,
  tracks: data.tracks.map(t => ({
    ...t,
    clips: [...t.clips].sort((a, b) => (data.clips[a]?.start ?? 0) - (data.clips[b]?.start ?? 0)),
  })),
});

/** clip 增删后统一尾部动作：边对账 + 断画布合并窗 */
const afterStructuralChange = (sourceNodeId: string, data: ProjectData) => {
  ensureAutoEdges(sourceNodeId, data);
  stopCapturing();
};

export const useEditorStore = create<EditorState>()((set, get) => {
  /** 非 transient 结构变更：push 前态 → mutate → 尾部动作 */
  const commit = (mutate: (data: ProjectData) => ProjectData, opts?: { structural?: boolean }) => {
    const s = get();
    if (!s.data || s.status !== 'ready') return;
    const prev = s.data;
    let next = mutate(prev);
    next = sortTrackClips(next);
    set({ data: next, history: pushHistory(s.history, prev) });
    if (opts?.structural !== false && s.sourceNodeId) afterStructuralChange(s.sourceNodeId, next);
  };

  /** transient 变更（拖拽 rAF 级）：只改 data 不入栈（begin/endTransient 配对收口） */
  const transient = (mutate: (data: ProjectData) => ProjectData) => {
    const s = get();
    if (!s.data) return;
    set({ data: sortTrackClips(mutate(s.data)) });
  };

  return {
    projectId: null,
    sourceNodeId: null,
    baseUpdatedAt: null,
    data: null,
    status: 'idle',
    loadError: null,
    saveState: 'saved',
    selectedClipId: null,
    selectedKeyframeId: null,
    playhead: 0,
    pxPerSec: 80,
    playing: false,
    preparing: false,
    mediaInfo: {},
    history: createHistory<ProjectData>(),
    pendingSnapshot: null,

    loadProject: (p) => set({
      projectId: p.id, sourceNodeId: p.sourceNodeId, baseUpdatedAt: p.updatedAt,
      data: p.data, status: 'ready', loadError: null,
      history: createHistory<ProjectData>(), pendingSnapshot: null,
      selectedClipId: null, playhead: 0, playing: false, preparing: false,
    }),
    setLoadError: (msg) => set({ status: 'error', loadError: msg }),
    reset: () => set({
      projectId: null, sourceNodeId: null, baseUpdatedAt: null, data: null,
      status: 'idle', loadError: null, saveState: 'saved', selectedClipId: null, selectedKeyframeId: null,
      playhead: 0, pxPerSec: 80, playing: false, preparing: false, mediaInfo: {},
      history: createHistory<ProjectData>(), pendingSnapshot: null,
    }),
    setSaveState: (v) => set({ saveState: v }),
    setBaseUpdatedAt: (t) => set({ baseUpdatedAt: t }),
    setPlayhead: (t) => set({ playhead: Math.max(0, quantizeTime(t)) }),
    setPxPerSec: (v) => set({ pxPerSec: Math.min(500, Math.max(10, v)) }),
    setPlaying: (v) => set({ playing: v }),
    setPreparing: (v) => set({ preparing: v }),
    selectClip: (id) => set({ selectedClipId: id }),
    setMediaInfo: (mediaId, info) => set((s) => ({ mediaInfo: { ...s.mediaInfo, [mediaId]: info } })),
    mergeMediaInfo: (entries) => set((s) => {
      const next = { ...s.mediaInfo };
      for (const [id, info] of Object.entries(entries)) {
        next[id] = next[id] ? { ...next[id], url: next[id].url ?? info.url } : info;
      }
      return { mediaInfo: next };
    }),

    addClip: (input) => {
      const s = get();
      if (!s.data || s.status !== 'ready') return null;
      const duration = input.type === 'image'
        ? 5
        : s.mediaInfo[input.mediaId]?.durationSec ?? 5; // 决策 6：未知兜底 5s
      const start = Math.max(0, quantizeTime(input.start)); // drop 直入口自防御（调用方已 clamp，此处兜底）
      let placed = start;
      // 新片未入库无 id——clipId 参数仅用于跳过同 id 比较，'' 语义等价 undefined（strict 下 string 不收 undefined）
      if (!canPlaceAt(s.data, '', start, input.trackId, duration)) {
        placed = findNearestFreeStart(s.data, '', start, input.trackId, duration); // 冲突吸附最近空位
      }
      const id = genId('clip');
      const base = { id, trackId: input.trackId, start: placed, duration, mediaId: input.mediaId, ...(input.sourceNodeId ? { sourceNodeId: input.sourceNodeId } : {}) };
      const clip: Clip = input.type === 'video'
        ? { ...base, type: 'video', sourceStart: 0, playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] } as VideoClip
        : input.type === 'image'
          ? { ...base, type: 'image', transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] } as ImageClip
          : { ...base, type: 'audio', sourceStart: 0, volume: 1, fade: { in: 0, out: 0 }, playbackSpeed: 1, keyframes: [] } as AudioClip;
      commit((d) => ({
        ...d,
        clips: { ...d.clips, [id]: clip },
        tracks: d.tracks.map(t => t.id === input.trackId ? { ...t, clips: [...t.clips, id] } : t),
      }));
      return id;
    },

    addSubtitleClip: (trackId, start, text = '新字幕') => {
      const s = get();
      const id = genId('clip');
      const clip: SubtitleClip = {
        id, trackId, type: 'subtitle', start: quantizeTime(start), duration: 3,
        text, visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 },
      };
      commit((d) => ({
        ...d,
        clips: { ...d.clips, [id]: clip },
        tracks: d.tracks.map(t => t.id === trackId ? { ...t, clips: [...t.clips, id] } : t),
      }));
      return id;
    },

    moveClip: (clipId, start, trackId, opts) => {
      const s = get();
      if (!s.data) return false;
      const clip = s.data.clips[clipId];
      if (!clip) return false;
      const targetTrack = trackId ?? clip.trackId;
      const ns = quantizeTime(start);
      // 同类型跨轨（图片在视频轨）；同轨冲突吸附最近空位
      const placed = canPlaceAt(s.data, clipId, ns, targetTrack, clip.duration, clip as any) // as any：联合传 { transitionIn? } 弱类型检测（audio/subtitle 无公共属性）
        ? ns
        : findNearestFreeStart(s.data, clipId, ns, targetTrack, clip.duration, clip as any);
      const mutate = (d: ProjectData): ProjectData => {
        const c = d.clips[clipId];
        return {
          ...d,
          clips: { ...d.clips, [clipId]: { ...c, start: placed, trackId: targetTrack } },
          tracks: d.tracks.map(t => {
            if (t.id === c.trackId && t.id !== targetTrack) return { ...t, clips: t.clips.filter(x => x !== clipId) };
            if (t.id === targetTrack && t.id !== c.trackId) return { ...t, clips: [...t.clips, clipId] };
            return t;
          }),
        };
      };
      if (opts?.transient) transient(mutate);
      else commit(mutate, { structural: false }); // move 不改源集合，无需 ensureAutoEdges
      return true;
    },

    trimClip: (clipId, edge, deltaSec, opts) => {
      const s = get();
      if (!s.data) return false;
      const clip = s.data.clips[clipId];
      if (!clip) return false;
      const mediaDuration = (clip as any).mediaId ? s.mediaInfo[(clip as any).mediaId]?.durationSec ?? Infinity : Infinity;
      let guard = edge === 'left' ? trimLeftGuard(clip, mediaDuration) : trimRightGuard(clip, mediaDuration);
      // 同轨邻居 clamp（spec 同轨禁重叠——trim 不是建立 crossfade 的途径）：
      // 无重叠时不得产生（delta 上/下界=间隙），已有合法重叠（crossfade）时不得加深（界取 0）
      const neighbors = clipsOnTrack(s.data, clip.trackId).filter(c => c.id !== clipId);
      if (edge === 'right') {
        const next = neighbors.find(c => c.start >= clip.start);
        if (next) guard = { ...guard, maxDelta: Math.min(guard.maxDelta, Math.max(0, next.start - (clip.start + clip.duration))) };
      } else {
        const prev = [...neighbors].reverse().find(c => c.start < clip.start);
        if (prev) guard = { ...guard, minDelta: Math.max(guard.minDelta, Math.min(0, prev.start + prev.duration - clip.start)) };
      }
      const d = clampDelta(guard, deltaSec);
      const mutate = (data: ProjectData): ProjectData => {
        const c = data.clips[clipId];
        const next = edge === 'left' ? applyTrimLeft(c, d) : applyTrimRight(c, d);
        return { ...data, clips: { ...data.clips, [clipId]: next } };
      };
      if (opts?.transient) transient(mutate);
      else commit(mutate, { structural: false });
      return true;
    },

    splitClip: (clipId, at) => {
      const s = get();
      if (!s.data) return null;
      const clip = s.data.clips[clipId];
      if (!clip) return null;
      const cut = quantizeTime(at);
      if (cut <= clip.start + 1 / 30 || cut >= clip.start + clip.duration - 1 / 30) return null; // 至少 1 帧两侧
      const backId = genId('clip');
      commit((d) => {
        const { front, back } = splitClipAt(d.clips[clipId], cut, backId);
        return {
          ...d,
          clips: { ...d.clips, [clipId]: front, [backId]: back },
          tracks: d.tracks.map(t => t.id === clip.trackId
            ? { ...t, clips: [...t.clips, backId] }
            : t),
        };
      });
      return backId;
    },

    removeClip: (clipId) => {
      const s = get();
      if (!s.data) return;
      const clip = s.data.clips[clipId];
      if (!clip) return;
      commit((d) => {
        const clips = { ...d.clips };
        delete clips[clipId];
        return {
          ...d,
          clips,
          tracks: d.tracks.map(t => t.id === clip.trackId ? { ...t, clips: t.clips.filter(x => x !== clipId) } : t),
        };
      });
      if (s.selectedClipId === clipId) set({ selectedClipId: null });
    },

    updateClip: (clipId, patch) => {
      commit((d) => {
        if (!d.clips[clipId]) return d; // 不存在早退——防 {...undefined,...patch} 造假 clip 入库
        return {
          ...d,
          clips: { ...d.clips, [clipId]: { ...d.clips[clipId], ...patch } as Clip },
        };
      }, { structural: false });
    },

    addKeyframe: (clipId, property) => {
      const s = get();
      if (!s.data || s.status !== 'ready') return null;
      const clip = s.data.clips[clipId];
      if (!clip) return null;
      const tLocal = Math.min(clip.duration, Math.max(0, quantizeTime(s.playhead - clip.start)));
      if (clip.type === 'video' || clip.type === 'image') {
        if (property === 'volume') return null;
        const exist = clip.keyframes.find(k => k.property === property && Math.abs(k.t - tLocal) < 0.5 / 30);
        if (exist) return exist.id;
        const value = interpolateTransform(clip, tLocal)[property];
        const kf: TransformKeyframe = { id: genId('kf'), t: tLocal, property, value, easing: 'linear' };
        commit((d) => {
          const c = d.clips[clipId] as VideoClip;
          return { ...d, clips: { ...d.clips, [clipId]: { ...c, keyframes: [...c.keyframes, kf].sort((a, b) => a.t - b.t) } } };
        }, { structural: false });
        return kf.id;
      }
      if (clip.type === 'audio') {
        if (property !== 'volume') return null;
        const exist = clip.keyframes.find(k => Math.abs(k.t - tLocal) < 0.5 / 30);
        if (exist) return exist.id;
        const value = keyframeValueAt(clip.keyframes.map(k => ({ t: k.t, value: k.value })), tLocal, clip.volume);
        const kf: VolumeKeyframe = { id: genId('kf'), t: tLocal, value, easing: 'linear' };
        commit((d) => {
          const c = d.clips[clipId] as AudioClip;
          return { ...d, clips: { ...d.clips, [clipId]: { ...c, keyframes: [...c.keyframes, kf].sort((a, b) => a.t - b.t) } } };
        }, { structural: false });
        return kf.id;
      }
      return null; // subtitle
    },

    removeKeyframe: (clipId, kfId) => {
      const s = get();
      if (!s.data) return;
      const clip = s.data.clips[clipId] as Clip | undefined;
      if (!clip || clip.type === 'subtitle') return;
      commit((d) => {
        // R5：as VideoClip 单型视图（与 moveKeyframe 同款）——TransformKeyframe[] | VolumeKeyframe[] 联合上
        // 调 .filter 触发 TS2349（union 泛型签名互不兼容）；audio 的 VolumeKeyframe 与 id 过滤结构兼容，单型谎报无运行时后果
        const c = d.clips[clipId] as VideoClip;
        return { ...d, clips: { ...d.clips, [clipId]: { ...c, keyframes: c.keyframes.filter(k => k.id !== kfId) } } };
      }, { structural: false });
      if (get().selectedKeyframeId === kfId) set({ selectedKeyframeId: null });
    },

    moveKeyframe: (clipId, kfId, t, opts) => {
      const s = get();
      if (!s.data) return false;
      const clip = s.data.clips[clipId] as Clip | undefined;
      if (!clip || clip.type === 'subtitle') return false;
      const tt = Math.min(clip.duration, Math.max(0, quantizeTime(t)));
      const mutate = (d: ProjectData): ProjectData => {
        const c = d.clips[clipId] as VideoClip;
        return {
          ...d,
          clips: { ...d.clips, [clipId]: { ...c, keyframes: c.keyframes.map(k => k.id === kfId ? { ...k, t: tt } : k).sort((a, b) => a.t - b.t) } as Clip },
        };
      };
      if (opts?.transient) transient(mutate);
      else commit(mutate, { structural: false });
      return true;
    },

    addTrack: (type) => {
      const id = genId('track');
      const count = get().data?.tracks.filter(t => t.type === type).length ?? 0;
      commit((d) => ({
        ...d,
        tracks: [...d.tracks, { id, type, name: `${type === 'video' ? '视频' : type === 'audio' ? '音频' : '字幕'}${count + 1}`, muted: false, hidden: false, clips: [] }],
      }), { structural: false });
      return id;
    },

    removeTrack: (trackId) => {
      commit((d) => {
        const clips = { ...d.clips };
        for (const cid of d.tracks.find(t => t.id === trackId)?.clips ?? []) delete clips[cid];
        return { ...d, clips, tracks: d.tracks.filter(t => t.id !== trackId) };
      });
    },

    toggleTrack: (trackId, key) => {
      commit((d) => ({
        ...d,
        tracks: d.tracks.map(t => t.id === trackId ? { ...t, [key]: !t[key] } : t),
      }), { structural: false });
    },

    beginTransient: () => {
      const s = get();
      set({ pendingSnapshot: s.data });
    },

    endTransient: () => {
      const s = get();
      if (!s.pendingSnapshot || !s.data) return false;
      const changed = s.pendingSnapshot !== s.data;
      if (changed) {
        set({ history: pushHistory(s.history, s.pendingSnapshot), pendingSnapshot: null });
        stopCapturing(); // 拖拽 commit 断画布合并窗
      } else {
        set({ pendingSnapshot: null });
      }
      return changed;
    },

    undo: () => {
      const s = get();
      if (!s.data) return;
      const r = undoHistory(s.history, s.data);
      if (!r) return;
      set({ data: r.state, history: r.history, selectedClipId: null, pendingSnapshot: null }); // 历史操作作废进行中 transient 会话
      if (s.sourceNodeId) afterStructuralChange(s.sourceNodeId, r.state); // 边跟随回滚
    },

    redo: () => {
      const s = get();
      if (!s.data) return;
      const r = redoHistory(s.history, s.data);
      if (!r) return;
      set({ data: r.state, history: r.history, selectedClipId: null, pendingSnapshot: null }); // 历史操作作废进行中 transient 会话
      if (s.sourceNodeId) afterStructuralChange(s.sourceNodeId, r.state);
    },
  };
});
