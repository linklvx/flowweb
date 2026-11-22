// apps/web/src/pages/canvas/video-editor/store/editorStore.ts
// Y4a T7（plan 2026-11-20-y4a-timeline-domain Task 7——spec §0 条 5/条 7 + §4）：
// editorStore 改 doc 水合+写穿 Y——sourceNodeId 为主键（projectId/baseUpdatedAt/title/teamId 随
// REST 链退场）；loadProject=读已存在 timelines.<nodeId>（键不在不创建工程）；undo/redo=时间轴
// 栈（timelineUndo/timelineRedo——JSON 快照史 history.ts 整删）；transient=本地覆盖层零 doc 笔、
// 松手组合基线一笔；根键监听捕获 Map 替换/删除（重绑先 clear() 再销毁旧 manager）。
import { create } from 'zustand';
import * as Y from 'yjs';
import type { Clip, ProjectData, Track, VideoClip, ImageClip, AudioClip, SubtitleClip, TransformKeyframe, VolumeKeyframe } from '../types';
import { genId } from '../types';
import {
  quantizeTime, trimLeftGuard, trimRightGuard, clampDelta,
  applyTrimLeft, applyTrimRight, splitClipAt,
} from '../timeline/clip-math';
import { canPlaceAt, findNearestFreeStart, clipsOnTrack } from '../timeline/overlap';
import { ensureAutoEdges } from '../timeline/auto-edges';
import { canvasSizeOf, remapForCanvasSize, type CanvasSize } from '../timeline/canvas-size';
import { keyframeValueAt, interpolateTransform } from '../scene/interpolate';
import { stopCapturing } from '@/stores/canvasUndo';
// Y4a T1（Track.order 补件）：轨序键单源（order-key——addTrack 尾插；FIRST_ORDER_KEY 默认轨口径）
import { FIRST_ORDER_KEY, compareOrderKeys, orderKeyAfter, readTimelineFromDoc } from '@flowweb/shared';
// Y4a T4（plan 2026-11-20-y4a-timeline-domain Task 4——spec §0 条 1/条 5）：时间轴撤销闸执行器
// （量法前置+临时 doc 两级自检+写前栈顶装回预检+timeline-user 事务+捕获档编排）——轻量模块
// （yjs+shared 零画布依赖，editorStore 测试 mock 面不受累）。
// Y4a T7：attachTimelineUndo 转由本 store 水合时挂接（生产调用点）；timelineUndo/timelineRedo=
// undo/redo 动作身。
import {
  executeTimelineCommit, getTimelineDocRef, attachTimelineUndo, detachTimelineUndo,
  timelineUndo, timelineRedo,
  type TimelineCaptureKind,
} from '@/stores/timelineUndo';
// Y4a T11（spec §5/§9 锚 6）：canUndo/canRedo 事件驱动 UI——时间轴栈订阅（attachTimelineUndo
// 调用紧邻处接线；退订收拢在 detachTimelineUndo 内部序首位——退订先于 clear()+destroy）
import { attachTimelineUi } from '@/stores/undoUiStore';
import { useVideoEditorStore } from '@/stores/videoEditorStore';

export type EditorStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface MediaInfo { name: string; durationSec: number | undefined; url?: string; mimeType?: string; thumbnailUrl?: string; }

export interface AddClipInput {
  type: 'video' | 'image' | 'audio';
  mediaId: string;
  sourceNodeId?: string;
  trackId: string;
  start: number;
}

interface EditorState {
  sourceNodeId: string | null;
  data: ProjectData | null;
  status: EditorStatus;
  loadError: string | null;
  selectedClipId: string | null;
  selectedKeyframeId: string | null;
  playhead: number;
  pxPerSec: number;
  playing: boolean;
  preparing: boolean;
  mediaInfo: Record<string, MediaInfo>;
  /** 拖动覆盖层（spec §0 条 5）：transient 手会话（doc 组合基线+本地起始态）——模块级单会话，
   *  state 化只为 begin/end 配对可见（null=无进行中手势）。 */
  pendingOverlay: { base: ProjectData; origin: ProjectData } | null;
  pendingProduct: { mediaId: string; title: string } | null; // 导出产物节点补建登记（R7 小项④）——上传成功建节点失败时留存，重试仅补建不重复上传

  loadProject(nodeId: string): boolean;
  setLoadError(msg: string): void;
  reset(): void;
  setPlayhead(t: number): void;
  setPxPerSec(v: number): void;
  setPlaying(v: boolean): void;
  setPreparing(v: boolean): void;
  selectClip(id: string | null): void;
  /** N3/决策 19 双写：kfId 非空时同时写 selectedKeyframeId 与 selectedClipId（点菱形即选中其片段，Delete 两 id 联动）；null 只清关键帧选中 */
  selectKeyframe(kfId: string | null, clipId?: string): void;
  setMediaInfo(mediaId: string, info: MediaInfo): void;
  mergeMediaInfo(entries: Record<string, MediaInfo>): void; // AssetPanel items → url/名称回填（仅填缺失键，不覆盖已有）
  setPendingProduct(p: { mediaId: string; title: string }): void;
  clearPendingProduct(): void;

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
  /** 切 C 档画布：canvasSize 落库 + 既有片段 transform/keyframes 中心点重映射（commit 入栈，undo 可回退） */
  setCanvasSize(size: CanvasSize): void;

  beginTransient(): void;
  endTransient(): boolean;
  undo(): boolean;
  redo(): boolean;
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

// ── 水合/重绑监听（spec §0 条 7）──
// observeDeep=读回 setState（唯一观察者效果——写路径唯一入口=commit，防 observe→commit 循环）；
// 根键监听=捕获 Map 替换/删除（子 Map 被换掉后旧 Map 上的监听收不到替换事件——非仅 observeDeep 子 Map）。
let observedEntry: Y.Map<unknown> | null = null;
let entryDeepHandler: (() => void) | null = null;
let rootKeyHandler: (() => void) | null = null;
let observedNodeId: string | null = null;

const detachDocListeners = (): void => {
  if (observedEntry != null && entryDeepHandler != null) observedEntry.unobserveDeep(entryDeepHandler);
  if (observedEntry != null && observedEntry.doc != null && rootKeyHandler != null) {
    observedEntry.doc.getMap('timelines').unobserve(rootKeyHandler);
  }
  observedEntry = null;
  entryDeepHandler = null;
  rootKeyHandler = null;
  observedNodeId = null;
};

/** observeDeep 回调：只 setState 读回（永不 commit——写路径唯一入口）。毒值（readTimelineFromDoc
 *  null）不 setState：本地保持上次良好投影，维护路径（装载重扫/服务端剥除）会继续写 doc。
 *  拖动手势进行中（覆盖层会话非空）跳过读回——远端合入不砸掉本地覆盖层（spec §0 条 5：
 *  transient=本地覆盖层；松手守卫按 doc 真值判并发删除，手势结束即恢复读回同步）。 */
const makeEntryDeepHandler = () => () => {
  if (observedEntry == null || pendingOverlay !== null) return;
  const next = readTimelineFromDoc(observedEntry);
  if (next === null) return;
  useEditorStore.setState({ data: next });
};

/** 绑定一棵 entry：observeDeep（读回 setState）+timelines 根键监听（替换/删除——spec §0 条 7）。 */
const bindDocListeners = (nodeId: string, entry: Y.Map<unknown>): void => {
  detachDocListeners();
  observedNodeId = nodeId;
  observedEntry = entry;
  entryDeepHandler = makeEntryDeepHandler();
  entry.observeDeep(entryDeepHandler);
  const doc = entry.doc;
  if (doc == null) return;   // 理论不可达（集成态 entry）——防御不炸
  const root = doc.getMap('timelines');
  rootKeyHandler = () => {
    if (observedNodeId == null) return;
    const current = root.get(observedNodeId);
    if (!(current instanceof Y.Map)) {
      // 键删除（节点没了）→ 编辑器关掉（spec §0 条 7）——栈卸下+监听拆+壳收起。
      // m#3①（fix round 2）：模块级覆盖层同点闭口——手势中键删除后模块变量不残留（残留会吞掉
      // 后续同 doc 重 loadProject 的远端读回）。
      // Y4a T11：undoUiStore 退订收拢在 detachTimelineUndo 内部序首位（退订先于 clear()+destroy）
      detachDocListeners();
      detachTimelineUndo();
      pendingOverlay = null;
      useEditorStore.setState({ status: 'idle', data: null, selectedClipId: null, selectedKeyframeId: null, pendingOverlay: null });
      useVideoEditorStore.getState().close();
      return;
    }
    if (current === observedEntry) return;   // 键在且同一对象——非替换事件
    // Map 被换 → 重绑当前这棵：销毁旧 UndoManager（先 clear()——避免对已脱离父键的 Map 再 undo）
    // 再绑、本地覆盖层作废、时间轴栈从空栈开始；data 立即读回新 Map。
    // Y4a T11：旧栈退订由 detachTimelineUndo 内部序首位收口；新栈订阅=attach 紧邻处返回值直交
    detachDocListeners();
    attachTimelineUi(attachTimelineUndo(observedNodeId, current));
    pendingOverlay = null;   // 覆盖层随旧 Map 作废（模块级单源——state 镜像由下方 set 落）
    const next = readTimelineFromDoc(current);
    useEditorStore.setState({
      data: next,
      pendingOverlay: null,
      selectedClipId: null, selectedKeyframeId: null,
    });
    bindDocListeners(observedNodeId, current);
    if (next !== null && observedNodeId) afterStructuralChange(observedNodeId, next);   // 水合完成 AutoEdge 对账一次
  };
  root.observe(rootKeyHandler);
};

// ── 拖动覆盖层（spec §0 条 5）──
// transient 阶段=本地覆盖层（不写 doc）；松手=组合基线 readTimelineFromDoc(entry) 叠覆盖层作
// before、UI 终值作 after→commit。overlay 记录手势开始时的 doc 真值基线（组合基线原料）。
interface OverlaySession {
  /** 手势开始时 doc 读回基线（叠加覆盖层=松手 before 的原料）。 */
  base: ProjectData;
  /** 手势开始时 data（丢覆盖层时的本地回退态）。 */
  origin: ProjectData;
}
let pendingOverlay: OverlaySession | null = null;

export const useEditorStore = create<EditorState>()((set, get) => {
  /** 非 transient 结构变更：mutate → doc 写 → 尾部动作。
   *  Y4a T4（spec §0 条 1/条 5）：doc 写路径穿两级执行器——量法（两帧任一超 262144 拒「单次操作
   *  过大」live 不写）→临时 doc 两级自检（validateFrameDeny+物化事件 validateAppliedL2）→写前
   *  栈顶装回预检→一条 timeline-user 事务（捕获档见各 action capture 注）。
   *  评审回包 I#2（拒绝回滚）：doc 写**先行**、本地 set 延后到写成功——执行器拒（软闸/自检/
   *  切块计划拒）时本地保持 prev（不写被拒态），before 每笔重读 doc 真值→被拒 delta 不复含。
   *  Y4a T7：before=doc 已合入状态（readTimelineFromDoc(entry)——远端合入不被回写；doc ref 缺席
   *  =无协作会话——本地态照旧（写面休眠零差异）。 */
  const commit = (mutate: (data: ProjectData) => ProjectData, opts?: { structural?: boolean; capture?: TimelineCaptureKind }) => {
    const s = get();
    if (!s.data || s.status !== 'ready') return;
    const prev = s.data;
    let next = mutate(prev);
    next = sortTrackClips(next);
    // doc 写先行（无协作会话=本地序先行——写面休眠零差异）
    if (s.sourceNodeId && !writeTimelineToDoc(s.sourceNodeId, prev, next, opts?.capture ?? 'structural')) return;   // 拒→本地保持 prev（不 set）
    set({ data: next });
    if (opts?.structural !== false && s.sourceNodeId) afterStructuralChange(s.sourceNodeId, next);
  };

  /** doc 写路径（timeline-user 事务——两级执行器编排）。
   *  before=组合基线（拖动松手=doc 已合入状态叠覆盖层；普通 commit=当前本地态=最近 doc 投影）。
   *  返回 false=执行器拒（软闸/自检/切块计划）——commit 回滚本地不落 next。doc ref/entry 缺席=
   *  编辑器未挂 doc（测试/离线）：返 true（本地态照旧推进）。 */
  const writeTimelineToDoc = (nodeId: string, before: ProjectData, after: ProjectData, capture: TimelineCaptureKind): boolean => {
    const doc = getTimelineDocRef();
    if (!doc) return true;   // 无协作会话（测试/离线）——本地态照旧
    const entry = doc.getMap('timelines').get(nodeId);
    if (!(entry instanceof Y.Map)) return true;   // 编辑器只读已存在的 timelines.<nodeId>——键不在不创建（spec §0 条 7）
    return executeTimelineCommit(doc, { nodeId, before, after, kind: capture });
  };

  /** transient 变更（拖拽 rAF 级）：只改 data 不写 doc（本地覆盖层——spec §0 条 5） */
  const transient = (mutate: (data: ProjectData) => ProjectData) => {
    const s = get();
    if (!s.data) return;
    set({ data: sortTrackClips(mutate(s.data)) });
  };

  return {
    sourceNodeId: null,
    data: null,
    status: 'idle',
    loadError: null,
    selectedClipId: null,
    selectedKeyframeId: null,
    playhead: 0,
    pxPerSec: 80,
    playing: false,
    preparing: false,
    mediaInfo: {},
    pendingOverlay: null,
    pendingProduct: null,

    loadProject: (nodeId) => {
      const doc = getTimelineDocRef();
      if (!doc) return false;   // 无协作会话——离线无 doc 可读（不创建不抛）
      const entry = doc.getMap('timelines').get(nodeId);
      if (!(entry instanceof Y.Map)) return false;   // 键不在不创建工程（spec §0 条 7）
      const data = readTimelineFromDoc(entry);
      if (data === null) return false;   // 毒值/旧文档未水合——不可开
      // 换绑新节点：旧监听/旧栈卸下（clear() 在 detachTimelineUndo 内置——先 clear 再 destroy）
      // m#3②（fix round 2）：模块级覆盖层闭口——水合入口是工程切换唯一路径，模块变量不跨工程
      // 残留（现只 null state 镜像会漏模块档）。
      detachDocListeners();
      pendingOverlay = null;
      // Y4a T11：水合挂接+新栈订阅（返回值直交——单 manager 单订阅入口）；旧栈退订由
      // attachTimelineUndo 内部 detachTimelineUndo 收口（退订序在其内部首位）
      attachTimelineUi(attachTimelineUndo(nodeId, entry));
      bindDocListeners(nodeId, entry);
      set({
        sourceNodeId: nodeId, data, status: 'ready', loadError: null,
        selectedClipId: null, selectedKeyframeId: null, playhead: 0, playing: false, preparing: false,
        pendingOverlay: null,
        pendingProduct: null, // R11-A7：显式字段清单——不补则工程 A 建节点失败后重开工程 B，重试把 A 的 mediaId 错挂到 B
      });
      afterStructuralChange(nodeId, data);   // 水合完成 AutoEdge 对账一次（补崩溃窗没写上的边）
      return true;
    },
    setLoadError: (msg) => set({ status: 'error', loadError: msg }),
    reset: () => {
      detachDocListeners();
      // Y4a T11：undoUiStore 退订收拢在 detachTimelineUndo 内部序首位（退订先于 clear()+destroy）
      detachTimelineUndo();
      pendingOverlay = null;
      set({
        sourceNodeId: null, data: null, status: 'idle', loadError: null,
        selectedClipId: null, selectedKeyframeId: null,
        playhead: 0, pxPerSec: 80, playing: false, preparing: false, mediaInfo: {},
        pendingOverlay: null,
        pendingProduct: null, // R1（P0-6）：reset 是编辑器重开清理点——漏加会跨工程残留
      });
    },
    setPlayhead: (t) => set({ playhead: Math.max(0, quantizeTime(t)) }),
    setPxPerSec: (v) => set({ pxPerSec: Math.min(500, Math.max(10, v)) }),
    setPlaying: (v) => set({ playing: v }),
    setPreparing: (v) => set({ preparing: v }),
    selectClip: (id) => set({ selectedClipId: id, selectedKeyframeId: null }), // 切换片段时关键帧选中失效（不变量）
    selectKeyframe: (kfId, clipId) => set(
      kfId === null
        ? { selectedKeyframeId: null }
        : { selectedKeyframeId: kfId, selectedClipId: clipId ?? null },
    ),
    // P0-7：整条替换不擦既有字段（TimelinePanel drop 回调 payload 只有 name/durationSec——
    // 直接覆盖会抹掉 AssetPanel 已回填的 url/mimeType 与时长，图片片段从此无源可渲、addClip 兜 5s）
    setMediaInfo: (mediaId, info) => set((s) => ({ mediaInfo: { ...s.mediaInfo, [mediaId]: {
      ...info,
      url: info.url ?? s.mediaInfo[mediaId]?.url,
      mimeType: info.mimeType ?? s.mediaInfo[mediaId]?.mimeType,
      durationSec: info.durationSec ?? s.mediaInfo[mediaId]?.durationSec,
      thumbnailUrl: info.thumbnailUrl ?? s.mediaInfo[mediaId]?.thumbnailUrl, // poster 异步回写后，后续 set 不得清掉
    } } })),
    mergeMediaInfo: (entries) => set((s) => {
      const next = { ...s.mediaInfo };
      for (const [id, info] of Object.entries(entries)) {
        // R8-4：与 setMediaInfo 对称——既有键字段只补缺不覆盖
        next[id] = next[id]
          ? { ...next[id], url: next[id].url ?? info.url, mimeType: next[id].mimeType ?? info.mimeType, durationSec: next[id].durationSec ?? info.durationSec, thumbnailUrl: next[id].thumbnailUrl ?? info.thumbnailUrl }
          : info;
      }
      return { mediaInfo: next };
    }),

    setPendingProduct: (p) => set({ pendingProduct: p }),
    clearPendingProduct: () => set({ pendingProduct: null }),

    addClip: (input) => {
      const s = get();
      if (!s.data || s.status !== 'ready') return null;
      // clip.sourceNodeId 写前检查（源节点不在不发事务——canvas-invariants clipSourceNodeExists）
      if (input.sourceNodeId && s.sourceNodeId) {
        const doc = getTimelineDocRef();
        if (doc && !doc.getMap('nodes').has(input.sourceNodeId)) return null;   // 悬挂引用不产生（读侧全函数不炸）
      }
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
      }), { capture: 'structural' });
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
      }), { capture: 'structural' });
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
      else commit(mutate, { structural: false, capture: 'span-gesture' }); // 非拖动一次性 move（编程/吸附位）——span 整值替换单独成步；真实拖动=transient+endTransient 松手结算（I#3）
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
      else commit(mutate, { structural: false, capture: 'span-gesture' }); // 非拖动一次性 trim（编程位）——span 整值替换单独成步；真实拖动=transient+endTransient 松手结算（I#3）
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
      }, { capture: 'structural' });   // 片段增删档——写前后双 stopCapturing 每笔成步
      if (s.selectedClipId === clipId) set({ selectedClipId: null });
    },

    updateClip: (clipId, patch) => {
      commit((d) => {
        if (!d.clips[clipId]) return d; // 不存在早退——防 {...undefined,...patch} 造假 clip 入库
        return {
          ...d,
          clips: { ...d.clips, [clipId]: { ...d.clips[clipId], ...patch } as Clip },
        };
      }, { structural: false, capture: 'scalar' });   // 标量整值替换档——500ms 窗内合并
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
        }, { structural: false, capture: 'structural' });   // 关键帧增删档——每笔成步
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
        }, { structural: false, capture: 'structural' });
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
      }, { structural: false, capture: 'structural' });
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
      else commit(mutate, { structural: false, capture: 'scalar' });   // 关键帧标量整值替换——窗内合并
      return true;
    },

    addTrack: (type) => {
      const id = genId('track');
      const count = get().data?.tracks.filter(t => t.type === type).length ?? 0;
      commit((d) => ({
        ...d,
        // Y4a T1（Track.order 补件）：新增轨 order=尾插键（order-key 单源——max.int+1 零碰撞；
        // 全空回落 FIRST_ORDER_KEY 同「默认轨 order='5000'」口径；orderKeyAfter null 档=越上沿，
        // addTrack 维持现状键不越界）
        tracks: [...d.tracks, { id, type, name: `${type === 'video' ? '视频' : type === 'audio' ? '音频' : '字幕'}${count + 1}`, muted: false, hidden: false, order: orderKeyAfter([...d.tracks].sort((a, b) => compareOrderKeys(a.order, b.order)).at(-1)?.order ?? FIRST_ORDER_KEY) ?? FIRST_ORDER_KEY, clips: [] }],
      }), { structural: false, capture: 'structural' });   // 轨道增删档——每笔成步
      return id;
    },

    removeTrack: (trackId) => {
      commit((d) => {
        const clips = { ...d.clips };
        for (const cid of d.tracks.find(t => t.id === trackId)?.clips ?? []) delete clips[cid];
        return { ...d, clips, tracks: d.tracks.filter(t => t.id !== trackId) };
      }, { capture: 'structural' });
    },

    toggleTrack: (trackId, key) => {
      commit((d) => ({
        ...d,
        tracks: d.tracks.map(t => t.id === trackId ? { ...t, [key]: !t[key] } : t),
      }), { structural: false, capture: 'scalar' });   // 轨标量整值替换——窗内合并
    },

    // 结构不变（tracks 不动）——与 moveClip 同款 opts；commit 即完整入栈，调用方无需再包 transient
    setCanvasSize: (size) => {
      commit((d) => {
        const clips = remapForCanvasSize(Object.values(d.clips), canvasSizeOf(d), size);
        return { ...d, canvasSize: size, clips: Object.fromEntries(clips.map((c) => [c.id, c])) };
      }, { structural: false, capture: 'scalar' });   // 切比例=canvasSize/transform/关键帧标量整值——窗内合并；超限整笔拒（不拆多笔）
    },

    beginTransient: () => {
      // 拖动覆盖层（spec §0 条 5）：记手势基线=当时 doc 已合入状态（松手组合基线原料）+本地起始态。
      // doc 不可读（离线/毒值）回落本地态（离线编辑照旧——写面休眠零差异）。
      const s = get();
      if (!s.data) return;
      const doc = s.sourceNodeId ? getTimelineDocRef() : null;
      const entry = doc?.getMap('timelines').get(s.sourceNodeId ?? '');
      const base = entry instanceof Y.Map ? readTimelineFromDoc(entry) : null;
      const overlay: OverlaySession = { base: base ?? s.data, origin: s.data };
      pendingOverlay = overlay;
      set({ pendingOverlay: overlay });   // state 镜像（TimelinePanel pointerMovedOnce 判据）
    },

    endTransient: () => {
      const s = get();
      const overlay = pendingOverlay;
      pendingOverlay = null;
      if (!overlay || !s.data) return false;
      if (overlay.origin === s.data) { set({ pendingOverlay: null }); return false; }   // 无位移（down-up 零 delta）——不入栈不落 doc
      // 并发删除守卫（spec §0 条 5）：松手时片段键或它的轨道键已没了 → 丢覆盖层（本地读回 doc 真值）
      const doc = s.sourceNodeId ? getTimelineDocRef() : null;
      const entry = doc?.getMap('timelines').get(s.sourceNodeId ?? '');
      if (entry instanceof Y.Map) {
        const docNow = readTimelineFromDoc(entry);
        if (docNow === null) { set({ data: overlay.origin, pendingOverlay: null }); return false; }   // 工程不可读（毒值/维护窗口）——覆盖层作废
        const overlayKeys = Object.keys(s.data.clips);
        const docKeys = new Set(Object.keys(docNow.clips));
        const trackIds = new Set(docNow.tracks.map((t) => t.id));
        for (const id of overlayKeys) {
          if (!docKeys.has(id) || !trackIds.has(s.data.clips[id]!.trackId)) {
            set({ data: sortTrackClips(docNow), pendingOverlay: null });   // 本地读回 doc 真值（丢覆盖层——并发删除形态收口）
            return false;
          }
        }
      }
      // 松手=组合基线一笔（doc 已合入状态叠覆盖层作 before、UI 终值作 after→一条 timeline-user
      // span-gesture 事务——前后双 stopCapturing 单独成步不走 500ms 窗）。拒绝面与 commit 同款
      // （executeTimelineCommit false→本地回拖动前态=手势作废）。
      if (s.sourceNodeId && !writeTimelineToDoc(s.sourceNodeId, overlay.base, s.data, 'span-gesture')) {
        set({ data: overlay.origin, pendingOverlay: null });   // 执行器拒——本地回拖动前态（手势作废）
        return false;
      }
      set({ pendingOverlay: null });
      if (s.sourceNodeId) stopCapturing(); // 拖拽 commit 断画布合并窗
      return true;
    },

    // Y4a T7（spec §4）：undo/redo=时间轴栈（timelineUndo/timelineRedo——Y-backed；JSON 快照史退场）。
    // 弹栈后 doc 装回经 observeDeep 读回 setState（唯一投影路径）；边跟随经 ensureAutoEdges（AutoEdge
    // origin 不入栈——交叉点注记 spec §2）；进行中手势作废（历史操作作废 transient 会话）。
    // I#1（fix round 2）：抑制窗先关再弹栈——um.undo() 事务同步收尾即触发 observeDeep，此刻模块级
    // 覆盖层必须已 null（修前 null 化在弹栈之后→自身读回早退→本地留幽灵片段+afterStructuralChange
    // 拿陈旧 data 重投幽灵 auto: 边）。非手势档 pendingOverlay 本来就 null、行为不变。
    // m#7：历史跳转（成功弹栈）作废覆盖层；被拒（无 manager、栈空、undo 装回闸）保留模块级覆盖层，
    // 且不写 state 镜像——被拒安全依据=timelineUndo/timelineRedo 四条 false 返回都在 um.undo()/um.redo()
    // 之前（事务未发生）。成功路径先后与现状相同（投机关抑制窗→弹栈→set）。
    undo: () => {
      const s = get();
      const saved = pendingOverlay;
      pendingOverlay = null;   // 抑制窗先关——undo 事务落笔时读回自然同步
      const ok = timelineUndo();
      if (!ok) {
        pendingOverlay = saved;   // 被拒（无 manager/栈空/装回闸）——按引用放回，抑制窗复活；禁 set（镜像保持进入时对象）
        return false;
      }
      const next = get().data;   // observeDeep 读回已同步（undo 事务同步收尾）
      set({ selectedClipId: null, selectedKeyframeId: null, pendingOverlay: null });
      if (s.sourceNodeId && next) afterStructuralChange(s.sourceNodeId, next);   // 边跟随回滚
      return true;
    },

    redo: () => {
      const s = get();
      const saved = pendingOverlay;
      pendingOverlay = null;   // 抑制窗先关（I#1 同款——redo 事务落笔时读回自然同步）
      const ok = timelineRedo();
      if (!ok) {
        pendingOverlay = saved;   // 被拒（无 manager/redoStack 空）——同 undo：放回+禁 set
        return false;
      }
      const next = get().data;
      set({ selectedClipId: null, selectedKeyframeId: null, pendingOverlay: null });
      if (s.sourceNodeId && next) afterStructuralChange(s.sourceNodeId, next);
      return true;
    },
  };
});
