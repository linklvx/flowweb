<!-- doc-status: historical | verified_at: n/a -->
# 视频剪辑器 Plan 3/4：scene 纯函数 + 预览播放 + audio-engine + 右面板四态 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地预览播放全链路（scene 纯函数 → video-cache/renderer → 主时钟 rAF 预览 → audio-engine 实时/离线共用 PCM），节点本体迷你播放（资源纪律五条），右面板四态 + 关键帧/转场编辑 UI，时间轴波形真数据与素材缺失态标红。

**Architecture:** spec v3.6（docs/superpowers/specs/video-editor.md）第六节预览播放 + 第四节右面板四态/关键帧 UI + 第五节波形 + 附录 B 阶段 5+6。同源渲染核心：`scene/` 两个纯函数（selectActiveClips/interpolateClip）供预览消费（导出 Plan 4 复用）；解码/取帧/LRU 属 `renderer/` 不进 scene；`audio-engine/` 全局单例（AudioContext 惰性创建 + suspend/resume，PCM 纯函数实时/离线共用——soundtouchjs 按 spike 定案路线：SoundTouch + SimpleFilter 手动 extract）。本 plan 全部前端（apps/web），零后端改动。

**Tech Stack:** 既有栈 + mediabunny（Input/CanvasSink/AudioBufferSink，Plan 1 已装）+ soundtouchjs@0.3.0（spike GO：tempo 2× 输出 0.980s 等效、440Hz 主频保持）。

**测试命令：** `pnpm -C apps/web test`（vitest run + tsc -b）；单文件 `pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/scene/active-clips.test.ts`

**本 plan 边界（不做，留 Plan 4）：** Worker 导出管线/产物登记与上画布；socket 单例迁移；AI 三按钮（生成音频/添加字幕/片段重拍——含本地实现的"添加字幕"按钮，与三按钮组一起落地）；导出前置校验（素材缺失拦截导出——本 plan 只做标红）；"设置"控件（spec 第四节四控件之一，但 spec 未定义其设置内容——臆造违反 YAGNI，登记省略，音量/全屏/缩放三控件实现；用户确认 plan 时可补充需求）。

**关键决策（写代码前必读，含对 spec 的登记偏离）：**

1. **video-cache 采用 vendor 实测形状 + UrlSource 取源（R2 审核 A3）**：`mediaId → Input+CanvasSink 常驻 + current/next 双帧 + 三段命中策略（next 命中→前移 / current 窗口有效→直返 / 前向迭代，>2s 跳跃重建 iterator）`+ LRU 上限 8 媒体淘汰 dispose——spec 说"LRU 帧缓存（参考 opencut video-cache）"，vendor 实际即此形状，非逐帧 LRU。CanvasSink 返回 WrappedCanvas（canvas 复用池，无需 close——VideoFrame close 纪律是导出路径 Plan 4 的事）。**视频取源用 mediabunny `UrlSource(url)`（HTTP Range 随机读，d.ts 实测导出）而非整文件 fetch blob**——vendor 的 File 本地磁盘随机读换成 fetch(url).blob() 是首帧延迟与内存大头（整 mp4 常驻）；音频解码/图片仍走 BlobSource/blob（PCM 与 ImageBitmap 反正要全量）。**Range 失败形态（R3 实测 source.js L699-714）：服务器不回 206 时 UrlSource 转入 sequential streaming + 缓存驱逐（"Reads into evicted regions will throw"）——不是变慢，是回拖/随机 seek 抛错 → renderFrameAt .catch 吞掉 → 黑帧**；编辑器恰是随机访问最密集场景，故 Task 14 验收必含"跨缓存容量向后拖拽 seek"项。修复路径（Nginx 反代 /flowai 吃掉 Range 头时）：`proxy_force_ranges on;` 或 `proxy_set_header Range $http_range; proxy_set_header If-Range $http_if_range;`。Content-Range 非 CORS safelisted 头，但 mediaApi L6 将 /flowai 前缀重写为同源相对路径（同源无 CORS）——若换 host/前缀需 MinIO CORS `ExposeHeaders: Content-Range`。
2. **soundtouch 按 spike 定案路线**（docs/superpowers/spikes/soundtouch-spike.mjs CONCLUSION）：`SoundTouch + SimpleFilter + WebAudioBufferSource` 手动 extract 循环，非 PitchShifter 图节点（构造即 createScriptProcessor 强依赖 AudioContext，spike 已证伪）。尾部冲刷：输入补 16384 帧静音；输出裁剪按**期望长度 round(len/tempo) 截/补**（比"最后非零样本"确定——底噪会使非零扫描失效；tempo≠1 时 soundtouch 处理延迟导致输出与期望差 ~2%，尾部几十 ms 静音无感，且调度显式传 duration 不依赖 PCM 长度）。
3. **变速 PCM 缓存 key = `${mediaId}:${speed}`**：prepare 时按需解码+伸缩；调度 offset = `(sourceStart + max(0, from-clip.start)*speed) / speed`（stretched 坐标系 = 原素材坐标 / speed）。
4. **toBlack/toWhite 用全屏 overlay 色层**而非降 opacity（opacity 会透出下层轨画面，不符合"渐黑"语义；转场语义=整幅画面渐黑，overlay 在全部视觉层之后、字幕之前统一绘制）。
5. **crossfade 画面 opacity 与音频增益同曲线**（spec 第六节 equal-gain 定案）：视频片内嵌音轨 gain ≡ interpolateClip 输出的 opacity（transform.opacity × 转场 alpha）——buildGainPoints 与 transitionEffect 单源共用 crossfadeContextOf；AudioClip 独立走 volume 关键帧 × fade 曲线。
6. **音频调度偏离 spec 的 lookahead（50ms/0.1s 窗）——改一次性全量调度 + seek 重建**：lookahead 的动因是 opencut 流式取 buffer 场景；本项目 PCM 全内存预处理后（spec 内存预估已按全量 PCM 算），一次调度 N 个 AudioBufferSourceNode（N=片段数，15min 工程通常 <100）无性能问题，行为等价（音频不因视频解码慢而停）。登记偏离理由，浏览器验收以音画同步为准。**配套三条纪律（R1 审核 G4 + R2 审核 A1/A4）**：① prepare 解码+变速后**立即转 AudioBuffer 单份驻留**（bufferCache 按 `mediaId:speed`，PcmData 局部变量即弃——R2 A1：双份常驻按 spec 口径 345.6MB/轨 ×2 = 690MB/轨不可接受），releasePcm 一并清；② 拖拽 seek 三段式 `scrubBegin/scrubMove/scrubEnd`——down 时若在播放则 stop 音频 + setPlaying(false)（静音拖拽，rAF 循环退出），move 只 setPlayhead（暂停态单帧渲染出画），up 才 setPlaying(true) 经 effect playFrom 重锚重排；验收以"松手后音画同步"为准；③ **播放中编辑重排 100ms 前沿去抖**（R2 A4：时间轴拖片段 transient 60Hz 下 subscribe 直接 playFrom = 每秒几十次 stop+全量重排"机器枪"——去抖窗内只重置 timer，停止变化 100ms 后重排一次）。
7. **AudioContext 全局单例 + suspend/resume，不 close**：audioEngine 模块级单例使实例数恒 1，物理满足"实例上限约 6"护栏（spec 边界护栏"收起时 close()"针对每次新建的实现，单例下 close 反而违反"复用全局单例"的节点纪律⑤）；收起时 stop sources + releasePcm + suspend 线程。**resume 修复（R1 审核 G2，P0）**：suspend 后二次打开编辑器时 getContext 因 ctx 已存在跳过 resume → currentTime 冻结 → engine.now() 恒定 → rAF 永不前进——prepare/playFrom 入口显式 resumeCtx()。
8. **主时钟统一由 AudioEngine 承载**：`engine.now()` 单一时钟真相——有音频 PCM 用 ctx.currentTime 锚（ctx 手势内创建）、无音频片降级 performance.now 锚（不为时钟空转 AudioContext，spec 第六节）；seek = playFrom 重新锚定，视觉 rAF 与音频调度共用 now() 不漂移。**登记偏离（R1 提出两轮未落，R3 五-6 正式登记）**：prepare 的 needed 含 video 片（内嵌音轨须解码后才知道有无），纯视频工程（全部无音轨）也会在解码前建 ctx——与"无音频片不空转 ctx"字面意图不符但功能无害（ctx 建后若 hasPcm()=false 走 perf 时钟，ctx 挂起前空转一次），一期接受。
9. **播放状态机放 editorStore（playing/preparing）+ 副作用编排集中在 hooks/playback.ts**：togglePlayback（prepare 异步完成后才 setPlaying(true)，音画同起点；preparing 态按钮 loading）/stopPlayback/seekPlayback 三函数被 PreviewPlayer、useEditorKeyboard（空格）、Ruler 拖拽共用——避免 keyboard hook 反向依赖组件。
10. **节点迷你播放单播放态放 videoEditorStore.miniPlaybackNodeId**（播 B 停 A）；全屏 open 时 openEditor 直接清 miniPlaybackNodeId；IntersectionObserver/selected 变 false/移出 → 停 + videoCache.release(本工程 mediaIds)。
11. **关键帧操作走 editorStore 专用 action**（addKeyframe 在播放头处取当前插值值、±半帧幂等；removeKeyframe；moveKeyframe 支持 transient 拖拽）——比 updateClip 拼 patch 可测；右面板其余修改全走既有 updateClip（浅 merge + 入历史）。
12. **字幕行数上限 2 行，超出截断**（spec"超长截断"具体化——行业惯例两行；截断不加省略号，按 maxWidth 切）。
13. **媒体 blob 共享缓存 getMediaBlob(mediaId, url)**：video-cache 取帧与 audio 解码共用；url 来源 = editorStore.mediaInfo 扩 `url?` 字段，AssetPanel 挂载/刷新时 mergeMediaInfo 同步（含既有工程重开场景）。
14. **TrackRow memo + playhead 订阅下沉**（Plan 2 M4 登记项）：TimelinePanel 不再订阅 playhead；TimelineRuler 自订阅；贯穿竖线抽 PlayheadLine 组件自订阅——播放头 30fps 更新不重渲全部轨道行。
15. **渲染跳帧 = in-flight 去重**：rAF tick 内上一帧 renderFrameAt 未返回则跳过发起新请求（天然实现 spec"跳帧追赶、音频不停"）；seek 暂停态单帧渲染 await 完成再绘。
16. **节点迷你播放不出声（R1 审核 G6 拍板）**：startMini 不调 audioEngine.prepare（整工程 PCM 解码+变速与"轻量 renderer"纪律冲突）——迷你播放视频帧经 videoCache 按需解码（播放的必要开销，缩略态零解码语义不变），音频静默；audio-engine 单例保留给编辑器主预览。
17. **crossfade 双窗口（R1 审核 G3）**：crossfadeContextOf 输出 `{ backOverlap, frontOverlap }` 可同时携带（三片链 A/B/C 全 crossfade 时中间片两窗并存）——transitionEffect 与 buildGainPoints 对双窗口独立施加（alpha 相乘），两重叠区各自 1↔0、中点各 0.5（spec 第六节 equal-gain）；crossfade 入场窗口存在时跳过独立 fadeIn 施加防重复，未吞并的出场转场（如入 crossfade + 出 toBlack）正常叠加。
18. **暂停态单帧渲染（R1 审核 G1，P0）+ in-flight 去重共用（R2 审核 N5）**：usePreviewPlayback 补 `!playing` effect（依赖 playhead/data）——renderFrameAt 单帧绘制；进编辑器即渲染 playhead=0 帧而非黑屏，暂停后点画布/拖标尺即时出画（scrubMove 的视觉基础）。**renderLatest(deps, data, t) 统一收口 playing tick 与暂停 effect**（pendingRef + latestTRef：in-flight 时只记最新 t、完成后补渲染一次）——否则 scrubMove/拖片段 60Hz 每帧发起全帧渲染（含视频 seek），MediaEntry 串行链把上百次 seek 排队执行。
19. **关键帧选中模型（R2 审核 N3）**：`selectKeyframe(kfId, clipId)` **同时写 selectedKeyframeId 与 selectedClipId**（点击菱形即选中其片段——stopPropagation 已挡片段选中路径，双写保证 Delete 的两 id 联动不变量）；selectClip 切换清 selectedKeyframeId（保持）；useEditorKeyboard Delete 分支 `selectedKeyframeId && selectedClipId` 双真才删关键帧（无错配空 patch 脏历史）。
20. **右面板秒表订阅派生布尔（R2 审核 A5）**：StopwatchButton 不订阅 playhead 本身，selector 返回"播放头处该属性存在关键帧"的布尔（zustand Object.is 比较，播放 30fps 不重渲整个 PropertiesPanel 的 InputNumber/Select/textarea 群）。

## 文件结构总览

```
apps/web/src/
├── stores/
│   └── videoEditorStore.ts              # [改] +miniPlaybackNodeId（Task 9）
├── pages/canvas/
│   ├── components/nodes/VideoEditNode.tsx  # [改] 迷你播放（Task 9）
│   └── video-editor/
│       ├── scene/                          # 同源渲染纯函数（预览/导出共用）
│       │   ├── active-clips.ts             # selectActiveClips/renderOrder（Task 1）
│       │   ├── interpolate.ts              # keyframeValueAt/interpolateTransform/crossfadeContextOf/transitionEffect/interpolateClip（Task 2）
│       │   └── subtitle-layout.ts          # layoutSubtitleLines/SUBTITLE_SPEC（Task 3）
│       ├── renderer/
│       │   ├── video-cache.ts              # VideoCacheService（Task 4）
│       │   ├── media-blob.ts               # getMediaBlob 缓存（Task 7）
│       │   ├── image-cache.ts              # ImageBitmap 缓存（Task 7）
│       │   ├── canvas-renderer.ts          # CanvasRenderer 薄层（Task 7，不测）
│       │   └── render-frame.ts             # renderFrameAt 单帧渲染编排（Task 7）
│       ├── audio-engine/
│       │   ├── pcm.ts                      # PcmData/resamplePcm/stretchPcm（Task 5）
│       │   ├── gain.ts                     # buildGainPoints/gainValueAt（Task 5）
│       │   ├── decode.ts                   # decodeMediaPcm（Task 6）
│       │   └── engine.ts                   # AudioEngine 单例（Task 6）
│       ├── store/editorStore.ts            # [改] playing/preparing/mergeMediaInfo（Task 8）+ keyframe actions（Task 10）+ selectedKeyframeId（Task 11）
│       ├── hooks/
│       │   ├── playback.ts                 # togglePlayback/stopPlayback/seekPlayback（Task 8）
│       │   ├── usePreviewPlayback.ts       # rAF 播放循环（Task 8）
│       │   └── useAudioPeaks.ts            # 波形峰值缓存（Task 12）
│       ├── timeline/
│       │   └── missing-source.ts           # missingSourceNodeIds（Task 13）
│       └── components/
│           ├── PreviewPlayer.tsx           # 预览播放器+控制条（Task 8，替换 PreviewPlaceholder）
│           ├── VideoEditorShell.tsx        # [改] 挂 PreviewPlayer/收起释放（Task 8）
│           ├── AssetPanel.tsx              # [改] mediaInfo url 同步（Task 8）
│           ├── PropertiesPanel.tsx         # 右面板四态（Task 10）
│           └── timeline/
│               ├── TimelinePanel.tsx       # [改] 工具行迁移/playhead 下沉/波形/标红（Task 8/12/13）
│               ├── TimelineRuler.tsx       # [改] 自订阅+拖拽 seek（Task 8）
│               ├── PlayheadLine.tsx        # [新建] 贯穿竖线自订阅（Task 8）
│               ├── TrackRow.tsx            # [改] memo/missing 传递（Task 13）
│               └── ClipBlock.tsx           # [改] 关键帧菱形（Task 11）/波形（Task 12）/标红（Task 13）
```

---

### Task 1: scene 纯函数——selectActiveClips（活跃片段判定 + renderOrder）

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/scene/active-clips.ts`
- Test: `apps/web/src/pages/canvas/video-editor/scene/active-clips.test.ts`

- [x] **Step 1: 写失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/scene/active-clips.test.ts
import { describe, it, expect } from 'vitest';
import { selectActiveClips } from './active-clips';
import type { Clip, ProjectData, VideoClip, ImageClip, AudioClip, SubtitleClip } from '../types';

const vc = (id: string, start: number, duration: number, trackId = 'tv', over: Partial<VideoClip> = {}): VideoClip => ({
  id, trackId, type: 'video', start, duration, sourceStart: 0, mediaId: 'm', playbackSpeed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [], ...over,
});
const ic = (id: string, start: number, duration: number, trackId = 'tv'): ImageClip => ({
  id, trackId, type: 'image', start, duration, mediaId: 'mi',
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
});
const ac = (id: string, start: number, duration: number, trackId = 'ta'): AudioClip => ({
  id, trackId, type: 'audio', start, duration, sourceStart: 0, mediaId: 'ma',
  volume: 1, fade: { in: 0, out: 0 }, playbackSpeed: 1, keyframes: [],
});
const sc = (id: string, start: number, duration: number, trackId = 'ts'): SubtitleClip => ({
  id, trackId, type: 'subtitle', start, duration, text: 'x', visible: true,
  style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 },
});

const data = (spec: { trackId: string; type: 'video' | 'subtitle' | 'audio'; hidden?: boolean; clips: Clip[] }[]): ProjectData => ({
  version: 1, fps: 30,
  tracks: spec.map(s => ({ id: s.trackId, type: s.type, name: s.trackId, muted: false, hidden: s.hidden ?? false, clips: s.clips.map(c => c.id) })),
  clips: Object.fromEntries(spec.flatMap(s => s.clips).map(c => [c.id, c])),
});
describe('selectActiveClips（视觉管线活跃判定）', () => {
  it('t=start 含 / t=end 不含（半开区间）', () => {
    const d = data([{ trackId: 'tv', type: 'video', clips: [vc('a', 1, 2)] }]);
    expect(selectActiveClips(d, 1).map(x => x.clip.id)).toEqual(['a']);
    expect(selectActiveClips(d, 3)).toHaveLength(0);
  });
  it('hidden 轨剔除（视觉片不进）', () => {
    const d = data([{ trackId: 'tv', type: 'video', hidden: true, clips: [vc('a', 0, 5)] }]);
    expect(selectActiveClips(d, 1)).toHaveLength(0);
  });
  it('音频片不进视觉管线（音频走 audio-engine 调度）', () => {
    const d = data([{ trackId: 'ta', type: 'audio', clips: [ac('a', 0, 5)] }]);
    expect(selectActiveClips(d, 1)).toHaveLength(0);
  });
  it('renderOrder：视觉片按 track 索引升序、同轨按 start；字幕恒最后', () => {
    const d = data([
      { trackId: 't0', type: 'video', clips: [vc('v-low', 0, 5)] },
      { trackId: 't1', type: 'video', clips: [vc('v-late', 1, 2), vc('v-early', 0, 5)] },
      { trackId: 'ts', type: 'subtitle', clips: [sc('sub', 0, 5)] },
    ]);
    // t1 轨内按 start：early(0) 先于 late(1)；字幕最后（即使其 track 索引最大以外）
    expect(selectActiveClips(d, 1.5).map(x => x.clip.id)).toEqual(['v-low', 'v-early', 'v-late', 'sub']);
  });
  it('crossfade overlap 区间双片段都在（排序后后片自然在上层）', () => {
    const d = data([{ trackId: 'tv', type: 'video', clips: [
      vc('front', 0, 3), vc('back', 2.5, 3, 'tv', { transitionIn: { type: 'crossfade', duration: 0.5 } }),
    ] }]);
    const r = selectActiveClips(d, 2.6);
    expect(r.map(x => x.clip.id)).toEqual(['front', 'back']);
  });
  it('空工程/无片段返回空数组', () => {
    const d = data([{ trackId: 'tv', type: 'video', clips: [] }]);
    expect(selectActiveClips(d, 0)).toEqual([]);
  });
});
```

- [x] **Step 2: 确认失败**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/scene/active-clips.test.ts
# 预期: FAIL（Cannot find module './active-clips'）
```

- [x] **Step 3: 实现**

```ts
// apps/web/src/pages/canvas/video-editor/scene/active-clips.ts
import type { Clip, ProjectData } from '../types';

export interface ActiveClip { clip: Clip; trackIndex: number; }

/** t 时刻视觉活跃片段（视频/图片/字幕；音频不进视觉管线），按 renderOrder 排序：
 *  ① 视频/图片按 track 索引升序（索引小先画=底层）、同轨按 start（crossfade 前片先画，后片自然上层）；
 *  ② 字幕恒最后（视觉最上，spec 第三节 renderOrder）。
 *  hidden 轨整体剔除；区间半开 [start, start+duration)。 */
export function selectActiveClips(data: ProjectData, t: number): ActiveClip[] {
  const visual: ActiveClip[] = [];
  const subtitles: ActiveClip[] = [];
  data.tracks.forEach((track, trackIndex) => {
    if (track.hidden) return;
    for (const cid of track.clips) {
      const c = data.clips[cid];
      if (!c || c.type === 'audio') continue;
      if (t < c.start || t >= c.start + c.duration) continue;
      const entry: ActiveClip = { clip: c, trackIndex };
      if (c.type === 'subtitle') subtitles.push(entry);
      else visual.push(entry);
    }
  });
  visual.sort((a, b) => a.trackIndex - b.trackIndex || a.clip.start - b.clip.start);
  return [...visual, ...subtitles];
}
```

- [x] **Step 4: 跑测试通过 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/scene/active-clips.test.ts
# 预期: 6 PASS
git add apps/web/src/pages/canvas/video-editor/scene && git commit -m "feat(video-editor): selectActiveClips 纯函数——renderOrder/hidden 剔除/半开区间（TDD）"
```

---

### Task 2: scene 纯函数——interpolateClip（关键帧插值 + crossfade 上下文 + 5 种转场 + overlay）

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/scene/interpolate.ts`
- Test: `apps/web/src/pages/canvas/video-editor/scene/interpolate.test.ts`

- [x] **Step 1: 写失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/scene/interpolate.test.ts
import { describe, it, expect } from 'vitest';
import {
  keyframeValueAt, interpolateTransform, crossfadeContextOf, transitionEffect, interpolateClip,
} from './interpolate';
import type { ProjectData, VideoClip } from '../types';

const vc = (id: string, start: number, duration: number, over: Partial<VideoClip> = {}): VideoClip => ({
  id, trackId: 'tv', type: 'video', start, duration, sourceStart: 0, mediaId: 'm', playbackSpeed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [], ...over,
});
const data = (clips: VideoClip[]): ProjectData => ({
  version: 1, fps: 30,
  tracks: [{ id: 'tv', type: 'video', name: 'V', muted: false, hidden: false, clips: clips.map(c => c.id) }],
  clips: Object.fromEntries(clips.map(c => [c.id, c])),
});
const kf = (t: number, property: 'x' | 'y' | 'scale' | 'rotation' | 'opacity', value: number) =>
  ({ id: `k-${t}-${property}`, t, property, value, easing: 'linear' as const });

describe('keyframeValueAt（插值边界，spec 数据模型）', () => {
  it('无点取 base / 单点恒值', () => {
    expect(keyframeValueAt([], 1, 0.7)).toBe(0.7);
    expect(keyframeValueAt([{ t: 0, value: 0.3 }], 5, 1)).toBe(0.3);
  });
  it('越首点取首值 / 越末点取末值', () => {
    const pts = [{ t: 1, value: 10 }, { t: 3, value: 30 }];
    expect(keyframeValueAt(pts, 0, 0)).toBe(10);
    expect(keyframeValueAt(pts, 9, 0)).toBe(30);
  });
  it('中间线性插值', () => {
    expect(keyframeValueAt([{ t: 0, value: 0 }, { t: 2, value: 1 }], 0.5)).toBeCloseTo(0.25, 10);
  });
  it('乱序输入先排序', () => {
    expect(keyframeValueAt([{ t: 2, value: 1 }, { t: 0, value: 0 }], 1)).toBeCloseTo(0.5, 10);
  });
});

describe('interpolateTransform（五属性独立通道）', () => {
  it('各属性走各自关键帧，无关键帧属性取基准', () => {
    const c = vc('a', 0, 10, {
      transform: { x: 100, y: 50, scale: 2, rotation: 30, opacity: 0.8 },
      keyframes: [kf(0, 'x', 0), kf(10, 'x', 200)],
    });
    const tr = interpolateTransform(c, 5);
    expect(tr.x).toBeCloseTo(100, 10);
    expect(tr.y).toBe(50); expect(tr.scale).toBe(2); expect(tr.rotation).toBe(30); expect(tr.opacity).toBe(0.8);
  });
});

describe('crossfadeContextOf（双窗口角色判定，决策 17）', () => {
  it('后片：backOverlap=实际重叠量', () => {
    const d = data([vc('f', 0, 3), vc('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } })]);
    expect(crossfadeContextOf(d, 'b')).toEqual({ backOverlap: 0.5, frontOverlap: 0 });
  });
  it('前片：frontOverlap=重叠量（前片自身无任何转场字段）', () => {
    const d = data([vc('f', 0, 3), vc('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } })]);
    expect(crossfadeContextOf(d, 'f')).toEqual({ backOverlap: 0, frontOverlap: 0.5 });
  });
  it('三片链 A/B/C 全 crossfade：中间片双窗口并存（R1 审核 G3）', () => {
    const d = data([
      vc('a', 0, 3),
      vc('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
      vc('c', 5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
    ]);
    expect(crossfadeContextOf(d, 'b')).toEqual({ backOverlap: 0.5, frontOverlap: 0.5 }); // b=[2.5,5.5)，c 从 5 起 → b/c 重叠 0.5
  });
  it('无 crossfade 参与 → null', () => {
    const d = data([vc('f', 0, 3), vc('b', 4, 3)]);
    expect(crossfadeContextOf(d, 'b')).toBeNull();
    expect(crossfadeContextOf(d, 'f')).toBeNull();
  });
  it('crossfade 但无实际重叠 → null（无重叠区无渐变）', () => {
    const d = data([vc('f', 0, 3), vc('b', 5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } })]);
    expect(crossfadeContextOf(d, 'b')).toBeNull(); // eff.overlap=0
    expect(crossfadeContextOf(d, 'f')).toBeNull();
  });
});

describe('transitionEffect（5 种转场，局部时间）', () => {
  const mk = (over: Partial<VideoClip>) => vc('a', 10, 4, over); // 局部 [0,4)
  it('fadeIn：开头 duration 内 0→1', () => {
    const d = data([mk({ transitionIn: { type: 'fadeIn', duration: 2 } })]);
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 0).alpha).toBeCloseTo(0, 10);
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 1).alpha).toBeCloseTo(0.5, 10);
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 2.5).alpha).toBe(1);
  });
  it('fadeOut：结尾 duration 内 1→0', () => {
    const d = data([mk({ transitionOut: { type: 'fadeOut', duration: 2 } })]);
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 2).alpha).toBeCloseTo(1, 10);
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 3).alpha).toBeCloseTo(0.5, 10);
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 4 - 1e-9).alpha).toBeCloseTo(0, 10);
  });
  it('toBlack：结尾 overlay black 0→1（alpha 恒 1）', () => {
    const d = data([mk({ transitionOut: { type: 'toBlack', duration: 2 } })]);
    const mid = transitionEffect(d, d.clips['a'] as VideoClip, 3);
    expect(mid.alpha).toBe(1);
    expect(mid.overlay).toEqual({ color: 'black', alpha: 0.5 });
  });
  it('toWhite：结尾 overlay white', () => {
    const d = data([mk({ transitionOut: { type: 'toWhite', duration: 2 } })]);
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 3).overlay).toEqual({ color: 'white', alpha: 0.5 });
  });
  it('入转场 toBlack：开头 overlay 从 1→0', () => {
    const d = data([mk({ transitionIn: { type: 'toBlack', duration: 2 } })]);
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 1).overlay).toEqual({ color: 'black', alpha: 0.5 });
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 3).overlay).toBeNull();
  });
  it('crossfade 后片：前缘 0→1（overlap 内）', () => {
    const d = data([vc('f', 0, 3), vc('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } })]);
    expect(transitionEffect(d, d.clips['b'] as VideoClip, 0).alpha).toBeCloseTo(0, 10);
    expect(transitionEffect(d, d.clips['b'] as VideoClip, 0.25).alpha).toBeCloseTo(0.5, 10);
    expect(transitionEffect(d, d.clips['b'] as VideoClip, 1).alpha).toBe(1);
  });
  it('crossfade 前片：尾缘 1→0（与后片同曲线 equal-gain，spec 第六节）', () => {
    const d = data([vc('f', 0, 3), vc('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } })]);
    expect(transitionEffect(d, d.clips['f'] as VideoClip, 2.5).alpha).toBeCloseTo(1, 10);
    expect(transitionEffect(d, d.clips['f'] as VideoClip, 2.75).alpha).toBeCloseTo(0.5, 10);
    expect(transitionEffect(d, d.clips['f'] as VideoClip, 3 - 1e-9).alpha).toBeCloseTo(0, 10);
  });
  it('前片独立 transitionOut 被 crossfade 吞并（effectiveTransitions.out=null，走 cf 分支）', () => {
    const d = data([
      vc('f', 0, 3, { transitionOut: { type: 'toBlack', duration: 1 } }),
      vc('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
    ]);
    const r = transitionEffect(d, d.clips['f'] as VideoClip, 2.75);
    expect(r.alpha).toBeCloseTo(0.5, 10); // crossfade 曲线生效
    expect(r.overlay).toBeNull();          // toBlack 被吞
  });
  it('三片链：中间片前缘入 + 尾缘出双窗口独立施加（G3——修复前中间片尾缘恒 1）', () => {
    const d = data([
      vc('a', 0, 3),
      vc('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
      vc('c', 5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
    ]);
    const te = (tl: number) => transitionEffect(d, d.clips['b'] as VideoClip, tl).alpha;
    expect(te(0)).toBeCloseTo(0, 10);      // 前缘起点（back 窗口）
    expect(te(1)).toBe(1);                 // 独立区
    expect(te(2.75)).toBeCloseTo(0.5, 10); // 尾缘中点（front 窗口：局部 2.75，rem=0.25 → 0.5）
    expect(te(3 - 1e-9)).toBeCloseTo(0, 10);
  });
  it('入 crossfade + 出 toBlack 组合：窗口 alpha 与未吞并的独立出场 overlay 同时生效（决策 17）', () => {
    const d = data([
      vc('a', 0, 3),
      vc('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 }, transitionOut: { type: 'toBlack', duration: 1 } }),
    ]);
    const r = transitionEffect(d, d.clips['b'] as VideoClip, 2.75); // rem=0.25<1 → overlay=0.75；无 front 窗 → alpha=1
    expect(r.alpha).toBe(1);
    expect(r.overlay).toEqual({ color: 'black', alpha: 0.75 });
  });
});

describe('interpolateClip（整合输出）', () => {
  it('视频片：sourceTime 公式 + transform 插值 + opacity 合成 + overlay', () => {
    const d = data([vc('a', 1, 8, {
      sourceStart: 2, playbackSpeed: 2,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 0.5 },
      keyframes: [kf(0, 'opacity', 1)],
      transitionOut: { type: 'toBlack', duration: 2 },
    })]);
    // 数值验算（控制器预验算）：t=7.5 → 局部 6.5；sourceTime=2+(7.5-1)×2=15；
    // opacity 通道单点 kf 恒值 1（基准 0.5 被覆盖）× alpha 1 = 1；toBlack rem=8-6.5=1.5 < 2 → overlay=1-1.5/2=0.25
    const s = interpolateClip(d, 'a', 7.5);
    expect(s.kind).toBe('visual');
    if (s.kind === 'visual') {
      expect(s.sourceTime).toBe(15);
      expect(s.opacity).toBe(1);
      expect(s.overlay).toEqual({ color: 'black', alpha: 0.25 });
    }
  });
  it('图片片：sourceTime=null', () => {
    const d = data([]);
    d.clips['img'] = { id: 'img', trackId: 'tv', type: 'image', start: 0, duration: 5, mediaId: 'mi', transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] };
    d.tracks[0].clips.push('img');
    const s = interpolateClip(d, 'img', 2);
    expect(s.kind === 'visual' && s.sourceTime).toBeNull();
  });
  it('字幕片：text/style/visible 透传', () => {
    const d = data([]);
    d.clips['sub'] = { id: 'sub', trackId: 'ts', type: 'subtitle', start: 0, duration: 2, text: '你好', visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 } };
    d.tracks[0] = { id: 'ts', type: 'subtitle', name: 'S', muted: false, hidden: false, clips: ['sub'] };
    const s = interpolateClip(d, 'sub', 1);
    expect(s).toMatchObject({ kind: 'subtitle', text: '你好', visible: true });
  });
});
```

- [x] **Step 2: 确认失败 → Step 3: 实现**

```ts
// apps/web/src/pages/canvas/video-editor/scene/interpolate.ts
import type { Clip, ProjectData, SubtitleClip, Transform, TransformKeyframe, VideoClip, ImageClip } from '../types';
import { sourceTime } from '../timeline/clip-math';
import { clipsOnTrack, crossfadePredecessor, effectiveTransitions } from '../timeline/overlap';

/** 单属性关键帧通道插值：无点取 base / 单点恒值 / 越首末取端值 / 中间线性（spec 数据模型插值边界） */
export function keyframeValueAt(points: { t: number; value: number }[], t: number, base: number): number {
  if (points.length === 0) return base;
  if (points.length === 1) return points[0].value;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return sorted[0].value;
  if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].value;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]; const b = sorted[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      return span === 0 ? b.value : a.value + (b.value - a.value) * ((t - a.t) / span);
    }
  }
  return base; // 不可达（防御）
}

export type VisualClip = VideoClip | ImageClip;

/** 五属性（x/y/scale/rotation/opacity）各自独立关键帧通道；t 为片段局部时间 */
export function interpolateTransform(clip: VisualClip, tLocal: number): Transform {
  const kf = clip.keyframes ?? [];
  const ch = (p: TransformKeyframe['property']) => kf.filter(k => k.property === p).map(k => ({ t: k.t, value: k.value }));
  return {
    x: keyframeValueAt(ch('x'), tLocal, clip.transform.x),
    y: keyframeValueAt(ch('y'), tLocal, clip.transform.y),
    scale: keyframeValueAt(ch('scale'), tLocal, clip.transform.scale),
    rotation: keyframeValueAt(ch('rotation'), tLocal, clip.transform.rotation),
    opacity: keyframeValueAt(ch('opacity'), tLocal, clip.transform.opacity),
  };
}

export interface CrossfadeContext { backOverlap: number; frontOverlap: number; }

/** crossfade 双窗口角色判定（渲染与音频增益共用——equal-gain 同曲线单源，决策 17）：
 *  backOverlap = 本片 transitionIn crossfade 与前片的实际重叠（eff.overlap）；
 *  frontOverlap = 存在后片 crossfade 指向本片（predecessor 是本片）时的尾部重叠。
 *  两窗可并存（三片链中间片）；全零 → null（无重叠区无渐变）。 */
export function crossfadeContextOf(data: ProjectData, clipId: string): CrossfadeContext | null {
  const clip = data.clips[clipId];
  if (!clip || clip.type === 'subtitle' || clip.type === 'audio') return null;
  let backOverlap = 0;
  let frontOverlap = 0;
  if (clip.transitionIn?.type === 'crossfade') {
    const eff = effectiveTransitions(data, clipId);
    if (eff.in?.type === 'crossfade') backOverlap = eff.overlap;
  }
  const next = clipsOnTrack(data, clip.trackId)
    .find(c => c.start > clip.start && (c as VideoClip).transitionIn?.type === 'crossfade') as VideoClip | undefined;
  if (next && crossfadePredecessor(data, next)?.id === clipId) {
    frontOverlap = Math.max(0, clip.start + clip.duration - next.start);
  }
  return backOverlap > 0 || frontOverlap > 0 ? { backOverlap, frontOverlap } : null;
}

export interface TransitionEffect { alpha: number; overlay: { color: 'black' | 'white'; alpha: number } | null; }

/** 转场状态（局部时间）：crossfade 双窗口独立施加（back 前缘 0→1 / front 尾缘 1→0，中间片两窗 alpha 相乘）；
 *  独立转场与窗口并存——crossfade 入场已由窗口施加时跳过 eff.in（防重复，此时 eff.in 必为 crossfade），
 *  未吞并的出场转场（如入 crossfade + 出 toBlack）正常叠加。 */
export function transitionEffect(data: ProjectData, clip: VisualClip, tLocal: number): TransitionEffect {
  let alpha = 1;
  let overlay: TransitionEffect['overlay'] = null;
  const dur = clip.duration;
  const cf = crossfadeContextOf(data, clip.id);
  const eff = effectiveTransitions(data, clip.id);
  let skipIn = false;
  if (cf) {
    if (cf.backOverlap > 0 && tLocal < cf.backOverlap) alpha *= tLocal / cf.backOverlap;
    const rem = dur - tLocal;
    if (cf.frontOverlap > 0 && rem < cf.frontOverlap) alpha *= rem / cf.frontOverlap;
    skipIn = cf.backOverlap > 0;
  }
  const tin = eff.in;
  const tout = eff.out;
  if (!skipIn && tin && tin.duration > 0 && tLocal < tin.duration) {
    const p = tLocal / tin.duration;
    if (tin.type === 'fadeIn') alpha *= p;
    else overlay = { color: tin.type === 'toBlack' ? 'black' : 'white', alpha: 1 - p };
  }
  if (tout && tout.duration > 0 && dur - tLocal < tout.duration) {
    const p = (dur - tLocal) / tout.duration;
    if (tout.type === 'fadeOut') alpha *= p;
    else overlay = { color: tout.type === 'toBlack' ? 'black' : 'white', alpha: 1 - p };
  }
  return { alpha, overlay };
}

export interface VisualRenderState {
  kind: 'visual';
  sourceTime: number | null; // 视频片=sourceTime 公式；图片片 null
  transform: Transform;
  opacity: number; // transform.opacity × 转场 alpha
  overlay: { color: 'black' | 'white'; alpha: number } | null;
}
export interface SubtitleRenderState {
  kind: 'subtitle';
  text: string;
  style: SubtitleClip['style'];
  visible: boolean;
}
export type RenderState = VisualRenderState | SubtitleRenderState;

/** 同源渲染核心插值（预览/导出共用）：t 为成片绝对时间 */
export function interpolateClip(data: ProjectData, clipId: string, t: number): RenderState {
  const clip = data.clips[clipId] as Clip;
  const tLocal = t - clip.start;
  if (clip.type === 'subtitle') {
    return { kind: 'subtitle', text: clip.text, style: clip.style, visible: clip.visible };
  }
  if (clip.type === 'audio') {
    throw new Error('interpolateClip: audio clip 不进视觉管线（音频走 audio-engine）');
  }
  const visual = clip as VisualClip;
  const transform = interpolateTransform(visual, tLocal);
  const { alpha, overlay } = transitionEffect(data, visual, tLocal);
  return {
    kind: 'visual',
    sourceTime: visual.type === 'video' ? sourceTime(visual, t) : null,
    transform,
    opacity: transform.opacity * alpha,
    overlay,
  };
}
```

- [x] **Step 4: 跑测试通过 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/scene/interpolate.test.ts
# 预期: 全 PASS（数值用例已控制器预验算）
git add apps/web/src/pages/canvas/video-editor/scene && git commit -m "feat(video-editor): interpolateClip 纯函数——关键帧边界/crossfade 前后片/5 转场 overlay（TDD）"
```

---

### Task 3: scene 纯函数——subtitle-layout（1664px 换行 / 96px 底距 / 2 行截断）

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/scene/subtitle-layout.ts`
- Test: `apps/web/src/pages/canvas/video-editor/scene/subtitle-layout.test.ts`

- [x] **Step 1: 写失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/scene/subtitle-layout.test.ts
import { describe, it, expect } from 'vitest';
import { layoutSubtitleLines, SUBTITLE_SPEC } from './subtitle-layout';

/** 假 measure：每汉字 48px（fontSize=48 时 1 字 48px），ASCII 半宽 24px——可控换行断言 */
const measure = (s: string, _font: string) =>
  [...s].reduce((w, ch) => w + (/[一-鿿]/.test(ch) ? 48 : 24), 0);

describe('layoutSubtitleLines（1920×1080 基准，measure 注入）', () => {
  it('短文本单行原样', () => {
    const r = layoutSubtitleLines('你好', { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 }, measure);
    expect(r.lines).toEqual(['你好']);
    expect(r.lineHeight).toBe(Math.round(48 * 1.4));
  });
  it('超过 1664px 自动换行（34.6 汉字 → 34 字一行）', () => {
    const text = '字'.repeat(40); // 40×48=1920 > 1664 → 34 字（1632px）后换行
    const r = layoutSubtitleLines(text, { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 }, measure);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toBe('字'.repeat(34));
    expect(r.lines[1]).toBe('字'.repeat(6));
  });
  it('显式换行符保留（\n 分段各自再换行）', () => {
    const r = layoutSubtitleLines('你好\n世界', { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 }, measure);
    expect(r.lines).toEqual(['你好', '世界']);
  });
  it('超长截断：最多 2 行，第 2 行按 maxWidth 切（决策 12）', () => {
    const text = '字'.repeat(100);
    const r = layoutSubtitleLines(text, { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 }, measure);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toBe('字'.repeat(34));
    expect(measure(r.lines[1], '')).toBeLessThanOrEqual(SUBTITLE_SPEC.maxWidth);
    expect(r.lines[1].length + r.lines[0].length).toBeLessThan(100); // 有截断
  });
  it('空文本 → 单空行（绘制端跳过）', () => {
    const r = layoutSubtitleLines('', { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 }, measure);
    expect(r.lines).toEqual(['']);
  });
});
```

- [x] **Step 2: 确认失败 → Step 3: 实现**

```ts
// apps/web/src/pages/canvas/video-editor/scene/subtitle-layout.ts
import type { SubtitleClip } from '../types';

/** 字幕绘制规格（spec 第六节）：1920×1080 基准，720p 随 0.5× 整体缩放由 renderer 的 ctx.scale 处理 */
export const SUBTITLE_SPEC = {
  canvasW: 1920, canvasH: 1080,
  bottomMargin: 96,   // 底边安全边距
  maxWidth: 1664,     // 最大宽自动换行
  maxLines: 2,        // 超长截断行数上限（决策 12）
} as const;
const SUBTITLE_FONT = '"PingFang SC", "Microsoft YaHei", sans-serif';

export interface SubtitleLayout { lines: string[]; lineHeight: number; fontSize: number; }

/** 换行/截断纯函数：measure 由渲染端注入（ctx.measureText），测试注入假实现。
 *  行为：\n 分段；段内按 maxWidth 逐字换行；超过 maxLines 截断（第 maxLines 行按 maxWidth 切，不加省略号）。 */
export function layoutSubtitleLines(
  text: string,
  style: SubtitleClip['style'],
  measure: (s: string, font: string) => number,
): SubtitleLayout {
  const font = `${style.fontSize}px ${SUBTITLE_FONT}`;
  const fits = (s: string) => measure(s, font) <= SUBTITLE_SPEC.maxWidth;
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      if (line && !fits(line + ch)) {
        lines.push(line);
        if (lines.length >= SUBTITLE_SPEC.maxLines) break;
        line = ch;
      } else {
        line += ch;
      }
    }
    if (lines.length >= SUBTITLE_SPEC.maxLines) break;
    lines.push(line);
  }
  // 截断：已达上限时丢余段；第 maxLines 行保证自身不超宽（逐字累加天然保证）
  const capped = lines.slice(0, SUBTITLE_SPEC.maxLines);
  return { lines: capped, lineHeight: Math.round(style.fontSize * 1.4), fontSize: style.fontSize };
}
```

- [x] **Step 4: 跑测试通过 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/scene/subtitle-layout.test.ts
git add apps/web/src/pages/canvas/video-editor/scene && git commit -m "feat(video-editor): 字幕布局纯函数——1664px 换行/2 行截断/measure 注入（TDD）"
```

---

### Task 4: renderer/video-cache——VideoCacheService（三段命中 + LRU + 资源释放）

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/renderer/video-cache.ts`
- Test: `apps/web/src/pages/canvas/video-editor/renderer/video-cache.test.ts`

mediabunny API 形状（vendor 实测 + R2 A3 修订）：`new Input({source: new UrlSource(url), formats: ALL_FORMATS})`（UrlSource 走 HTTP Range 随机读——决策 1）→ `input.getPrimaryVideoTrack()` → `new CanvasSink(track, {poolSize, fit:'contain'})` → `sink.canvases(startTime)` AsyncGenerator<WrappedCanvas{canvas, timestamp, duration}>。本服务把 mediabunny 依赖收在 deps.openSink 注入点、自愈冷却时钟收在 deps.now 注入点（jsdom 可测——Date.now 不可控推进），生产装配在文件末尾。

- [x] **Step 1: 写失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/renderer/video-cache.test.ts
import { describe, it, expect, vi } from 'vitest';
import { VideoCacheService, RETRY_COOLDOWN_MS, type SinkHandle, type WrappedFrame } from './video-cache';

const SRC = 'http://minio/m1.mp4'; // UrlSource 直连（A3）——不再整文件 fetch blob

function makeSink(frames: { timestamp: number; duration: number }[]) {
  const state = { canvasesCalls: number, consumed: number, disposed: false };
  const handle: SinkHandle = {
    canvases: (start: number) => {
      state.canvasesCalls++;
      return (async function* () {
        for (const f of frames) {
          if (f.timestamp + f.duration <= start) continue;
          state.consumed++;
          yield { canvas: { width: 1920, height: 1080 }, timestamp: f.timestamp, duration: f.duration } as WrappedFrame;
        }
      })();
    },
    dispose: () => { state.disposed = true; },
  };
  return { handle, state };
}
const FRAMES = Array.from({ length: 10 }, (_, i) => ({ timestamp: i, duration: 1 })); // 0..9s 各 1s

describe('VideoCacheService（三段命中 + LRU）', () => {
  it('顺序请求：迭代到目标帧窗口', async () => {
    const { handle } = makeSink(FRAMES);
    const svc = new VideoCacheService({ openSink: vi.fn().mockResolvedValue(handle) });
    const f = await svc.getFrame('m1', SRC, 2.5);
    expect(f?.timestamp).toBe(2);
  });
  it('current 命中：同窗口重复请求不再消费 generator', async () => {
    const { handle, state } = makeSink(FRAMES);
    const svc = new VideoCacheService({ openSink: vi.fn().mockResolvedValue(handle) });
    await svc.getFrame('m1', SRC, 2.5);
    const consumed = state.consumed;
    await svc.getFrame('m1', SRC, 2.9);
    expect(state.consumed).toBe(consumed); // current 窗口 [2,3) 直返
    expect((await svc.getFrame('m1', SRC, 2.9))?.timestamp).toBe(2);
  });
  it('前进请求：迭代前进消费下一帧命中', async () => {
    const { handle } = makeSink(FRAMES);
    const svc = new VideoCacheService({ openSink: vi.fn().mockResolvedValue(handle) });
    await svc.getFrame('m1', SRC, 2.5); // 命中 [2,3) 即返（iterator 挂起于 yield ts=2，不预取）
    const f = await svc.getFrame('m1', SRC, 3.2); // |3.2-2|≤2 不重建 → 迭代前进消费 ts=3 命中（R5 注释修正：顺序产出下 next 预存分支不触达，真正覆盖 next 分支的是超前 yield 场景——vendor 流下由乱序/跳帧触发）
    expect(f?.timestamp).toBe(3);
  });
  it('大跳（>2s）重建 iterator：canvases 再次调用', async () => {
    const { handle, state } = makeSink(FRAMES);
    const svc = new VideoCacheService({ openSink: vi.fn().mockResolvedValue(handle) });
    await svc.getFrame('m1', SRC, 0.5);
    const calls = state.canvasesCalls;
    await svc.getFrame('m1', SRC, 8.2);
    expect(state.canvasesCalls).toBe(calls + 1);
    expect((await svc.getFrame('m1', SRC, 8.2))?.timestamp).toBe(8);
  });
  it('openSink 返回 null（无视频轨/失败）→ getFrame null', async () => {
    const svc = new VideoCacheService({ openSink: vi.fn().mockResolvedValue(null) });
    expect(await svc.getFrame('m1', SRC, 0)).toBeNull();
  });
  it('LRU：超过 maxMedia 淘汰最久未用并 dispose', async () => {
    const sinks = new Map<string, ReturnType<typeof makeSink>>();
    const svc = new VideoCacheService({
      openSink: vi.fn(async (_url: string) => {
        const id = `m${sinks.size + 1}`;
        const s = makeSink(FRAMES); sinks.set(id, s); return s.handle;
      }),
      maxMedia: 2,
    });
    await svc.getFrame('m1', SRC, 0.5);
    await svc.getFrame('m2', SRC, 0.5);
    await svc.getFrame('m3', SRC, 0.5); // m1 最久未用被淘汰
    expect(sinks.get('m1')!.state.disposed).toBe(true);
    expect(svc.size).toBe(2);
  });
  it('release(mediaId)：指定媒体释放', async () => {
    const { handle, state } = makeSink(FRAMES);
    const svc = new VideoCacheService({ openSink: vi.fn().mockResolvedValue(handle) });
    await svc.getFrame('m1', SRC, 0.5);
    svc.release('m1');
    expect(state.disposed).toBe(true);
    expect(svc.size).toBe(0);
  });
  it('串行链：并发请求不交错（后请求等待前完成）', async () => {
    const { handle } = makeSink(FRAMES);
    const svc = new VideoCacheService({ openSink: vi.fn().mockResolvedValue(handle) });
    const [a, b] = await Promise.all([svc.getFrame('m1', SRC, 2.5), svc.getFrame('m1', SRC, 4.5)]);
    expect(a?.timestamp).toBe(2);
    expect(b?.timestamp).toBe(4);
  });
  it('in-flight 去重（G7）：同 mediaId 并发首取只 openSink 一次', async () => {
    const { handle } = makeSink(FRAMES);
    const openSink = vi.fn(async () => { await new Promise(r => setTimeout(r, 10)); return handle; });
    const svc = new VideoCacheService({ openSink });
    await Promise.all([svc.getFrame('m1', SRC, 1.5), svc.getFrame('m1', SRC, 2.5), svc.getFrame('m1', SRC, 3.5)]);
    expect(openSink).toHaveBeenCalledTimes(1);
  });
  it('取帧抛错 → release 自愈 + 2s 冷却（entry 清空 + 越窗重开——R3 3.3 防永久黑帧 + R4 防每帧重开：坏源 rAF 30-60fps 下每秒几十次 release+openSink）', async () => {
    let clock = 1000;
    const { handle } = makeSink(FRAMES);
    const goodCanvases = handle.canvases;
    const openSink = vi.fn(async () => handle);
    const svc = new VideoCacheService({ openSink, now: () => clock });
    expect(await svc.getFrame('m1', SRC, 2.5)).not.toBeNull();
    handle.canvases = () => (async function* () { throw new Error('403 presigned expired'); })();
    expect(await svc.getFrame('m1', SRC, 4.5)).toBeNull(); // 抛错被吃、返回 null（lastTime=2，|4.5-2|>2 重建 iterator 即抛）
    expect(svc.size).toBe(0);                              // entry 已释放（死 iterator 不残留）
    expect(await svc.getFrame('m1', SRC, 4.5)).toBeNull(); // R4：冷却窗内（clock=1000 < 3000）不再重开
    expect(openSink).toHaveBeenCalledTimes(1);
    handle.canvases = goodCanvases;
    clock += RETRY_COOLDOWN_MS + 1;                        // 越过冷却窗
    expect(await svc.getFrame('m1', SRC, 2.5)).not.toBeNull(); // 下次请求重开
    expect(openSink).toHaveBeenCalledTimes(2);
  });
  it('release 与在途 openSink 竞态：open 迟到完成 → dispose 不复活 entry（R4——"播放中点关闭"不残留活 Input/CanvasSink）', async () => {
    let resolveOpen!: (h: SinkHandle | null) => void;
    const state = { disposed: false };
    const handle: SinkHandle = {
      canvases: () => (async function* () {})(),
      dispose: () => { state.disposed = true; },
    };
    const svc = new VideoCacheService({ openSink: () => new Promise<SinkHandle | null>(r => { resolveOpen = r; }) });
    const p = svc.getFrame('m1', SRC, 0); // 在途（openSink 未决）
    svc.release();                        // 收起/单媒体释放 → generations 作废在途 open
    resolveOpen(handle);                  // open 迟到完成
    expect(await p).toBeNull();
    expect(state.disposed).toBe(true);
    expect(svc.size).toBe(0);
  });
});
```

- [x] **Step 2: 确认失败 → Step 3: 实现**

```ts
// apps/web/src/pages/canvas/video-editor/renderer/video-cache.ts
import type { Input, CanvasSink } from 'mediabunny';

export interface WrappedFrame { canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number; duration: number; }
export type SinkIterator = AsyncGenerator<WrappedFrame, void, undefined>;
export interface SinkHandle { canvases(start: number): SinkIterator; dispose(): void; }
export interface VideoCacheDeps { openSink: (url: string) => Promise<SinkHandle | null>; maxMedia?: number; now?: () => number; }

const SEEK_REBUILD_GAP = 2; // 距上次消费 >2s 重建 iterator（vendor 同款）
export const RETRY_COOLDOWN_MS = 2000; // R4：坏源自愈冷却——无冷却时 renderLatest 按 rAF 30-60fps 重试，每秒几十次 openSink（每次 Input 构造 + moov range 请求）

class MediaEntry {
  current: WrappedFrame | null = null;
  next: WrappedFrame | null = null;
  private iterator: SinkIterator | null = null;
  private lastTime = 0;
  private chain: Promise<WrappedFrame | null> = Promise.resolve(null);
  private seekGen = 0;
  constructor(private readonly handle: SinkHandle) {}

  /** 串行链：所有请求排队执行，防 generator 交错 */
  getFrameAt(time: number): Promise<WrappedFrame | null> {
    const run = this.chain.then(() => this.doGet(time));
    this.chain = run.then(() => null, () => null); // 链不断（错误吞在单次请求内）
    return run;
  }

  private async doGet(time: number): Promise<WrappedFrame | null> {
    if (this.next && time >= this.next.timestamp && time < this.next.timestamp + this.next.duration) {
      this.current = this.next; this.next = null;
      return this.current;
    }
    if (this.current && time >= this.current.timestamp && time < this.current.timestamp + this.current.duration) {
      return this.current;
    }
    const gen = ++this.seekGen;
    if (!this.iterator || Math.abs(time - this.lastTime) > SEEK_REBUILD_GAP) {
      await this.iterator?.return?.().catch(() => {});
      this.iterator = this.handle.canvases(time);
    }
    for (;;) {
      if (gen !== this.seekGen) return this.current; // 期间有新 seek，让位
      const { value, done } = await this.iterator.next();
      if (done || !value) return this.current;
      this.lastTime = value.timestamp;
      if (time >= value.timestamp && time < value.timestamp + value.duration) {
        this.current = value; this.next = null;
        return value;
      }
      if (value.timestamp > time) { this.next = value; return this.current; } // 超前：返回最近已有帧
      this.current = value; // 落后继续追
    }
  }

  dispose(): void {
    this.seekGen++;
    void this.iterator?.return?.().catch(() => {});
    this.iterator = null; this.current = null; this.next = null;
    this.handle.dispose();
  }
}

/** 帧缓存服务：mediaId → 常驻 CanvasSink + 三段命中（vendor 形状）+ LRU 上限淘汰 + openSink in-flight 去重（G7）
 *  + 自愈三纪律（R4）：取帧抛错 release + 2s 冷却重试（坏源防每帧重开）；release 作废在途 open（generations 代数——
 *  "播放中收起"不残留活 Input/CanvasSink 到 LRU/收起为止）。 */
export class VideoCacheService {
  private entries = new Map<string, MediaEntry>(); // Map 插入序 = LRU 序（访问即 delete+set 移尾）
  private opening = new Map<string, Promise<MediaEntry | null>>(); // 同 tick 并发同 mediaId 只 openSink 一次（vendor initPromises 同款）
  private retryAfter = new Map<string, number>();  // mediaId → 冷却截止时间戳（R4）
  private generations = new Map<string, number>(); // mediaId → 已作废代数（R4：release 时 ++，在途 open 完成时比对）
  private readonly now: () => number;
  private readonly maxMedia: number;
  constructor(private readonly deps: VideoCacheDeps) {
    this.now = deps.now ?? Date.now;
    this.maxMedia = deps.maxMedia ?? 8;
  }

  get size(): number { return this.entries.size; }

  async getFrame(mediaId: string, url: string, time: number): Promise<WrappedFrame | null> {
    const until = this.retryAfter.get(mediaId);
    if (until !== undefined && this.now() < until) return null; // 冷却窗内不重开（R4）
    let entry = this.entries.get(mediaId);
    if (!entry) {
      let opening = this.opening.get(mediaId);
      if (!opening) {
        const gen = this.generations.get(mediaId) ?? 0;
        opening = this.deps.openSink(url).then((handle) => {
          if (!handle) {
            // R5：open 失败（无视频轨/canDecode false/403 reject）同样进冷却——否则 .finally 删 opening 后
            // 下一帧 renderLatest 再调 getFrame 再次 openSink（Input 构造 + moov range 请求），30-60 次/秒
            this.retryAfter.set(mediaId, this.now() + RETRY_COOLDOWN_MS);
            return null;
          }
          if ((this.generations.get(mediaId) ?? 0) !== gen) { // R4：release 已发生 → 在途 open 作废
            try { handle.dispose(); } catch { /* 已释放 */ }
            return null;
          }
          const e = new MediaEntry(handle);
          this.evictIfNeeded();
          this.entries.set(mediaId, e);
          return e;
        }).finally(() => { this.opening.delete(mediaId); });
        this.opening.set(mediaId, opening);
      }
      entry = (await opening) ?? undefined;
      if (!entry) return null; // 无视频轨/打开失败
    } else {
      this.entries.delete(mediaId); // LRU 触尾
      this.entries.set(mediaId, entry);
    }
    try {
      const f = await entry.getFrameAt(time);
      if (f) this.retryAfter.delete(mediaId); // 成功取帧解除冷却
      return f;
    } catch {
      // R3 3.3：UrlSource 预签名过期/网络错误时 iterator 已死、entry 残留 → 该素材从此永久黑帧——
      // 释放 entry 使下次请求重开 sink（新 URL 由调用方 mediaInfo 刷新后传入；一期限制见 spec 边界表"预签名过期"）
      console.warn('[video-cache] getFrame 失败，释放并 2s 后重试:', mediaId); // R4：诊断痕迹——冷却限频天然防刷屏
      this.retryAfter.set(mediaId, this.now() + RETRY_COOLDOWN_MS);
      this.release(mediaId); // 带参 release 不清 retryAfter——自愈冷却跨 release 继续生效
      return null;
    }
  }

  private evictIfNeeded(): void {
    while (this.entries.size >= this.maxMedia) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.get(oldest)?.dispose();
      this.entries.delete(oldest);
      this.retryAfter.delete(oldest); // 容量淘汰非源坏——冷却不继承
    }
  }

  release(mediaId?: string): void {
    // R4：先作废在途 open（keys 物化后再清 entries），再释放已驻留 entry。
    // R5：generations 不 clear——bump 值即作废凭据，clear 会把它抹平（在途 chain 捕获 gen=0、
    // 迟到完成时 undefined ?? 0 = 0 相等 → 不作废 → 复活 entry，用例 11 两断言必红）；
    // 保留计数无副作用：重进后新 chain 以 bump 后的值为基准捕获，比对相等正常放行。map 只增媒体数个 number。
    const keys = mediaId === undefined
      ? [...new Set([...this.entries.keys(), ...this.opening.keys()])]
      : [mediaId];
    for (const k of keys) this.generations.set(k, (this.generations.get(k) ?? 0) + 1);
    if (mediaId === undefined) {
      for (const e of this.entries.values()) e.dispose();
      this.entries.clear();
      this.retryAfter.clear(); // 会话终结（编辑器收起）——冷却不跨会话继承（与 generations 语义不同：retryAfter 是源健康度、新会话重试合理；generations 是实例代数、清了旧 chain 复活）
    } else {
      this.entries.get(mediaId)?.dispose();
      this.entries.delete(mediaId);
      // retryAfter 保留：自愈路径 release 后冷却继续生效，防立即重进再打网络
    }
  }
}

/** 生产装配：mediabunny CanvasSink（vendor video-cache/service.ts 同款）。
 *  B1 实测修正：CanvasSink 无 dispose 方法（mediabunny media-sink.d.ts 只有 getCanvas/canvases/canvasesAtTimestamps）；
 *  Input.dispose() 返回 void 非 Promise（input.d.ts L158）——同步调用，异常用 try/catch。
 *  R2 A3：视频取源 UrlSource（HTTP Range 随机读，决策 1）——presigned GET 直连，不整文件下载。
 *  R4：整段包 try——原 `await import` 与 `new Input` 在 try 外，一 reject 则 openSink reject 而非 null，
 *  违反 getFrame"失败 → null"契约（预览侧调用方 .catch 兜住不炸，但 Plan 4 导出路径未必兜）。 */
export async function openMediabunnySink(url: string): Promise<SinkHandle | null> {
  let input: Input | null = null;
  try {
    const { Input, ALL_FORMATS, UrlSource, CanvasSink } = await import('mediabunny');
    input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) {
      try { input.dispose(); } catch { /* 已释放 */ }
      return null;
    }
    const sink = new CanvasSink(track, { poolSize: 3, fit: 'contain' });
    const held = input; // const 断言窄化——闭包内 TS 对 let 不保留窄化
    return {
      canvases: (start: number) => sink.canvases(start) as unknown as SinkIterator,
      dispose: () => { try { held.dispose(); } catch { /* 已释放 */ } }, // 资源主口是 input.dispose
    };
  } catch {
    if (input) { try { input.dispose(); } catch { /* 已释放 */ } }
    return null;
  }
}

export const videoCache = new VideoCacheService({ openSink: openMediabunnySink });
```

- [x] **Step 4: 跑测试通过 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/renderer/video-cache.test.ts
# 预期: 11 PASS（三段命中/current/next/大跳/openSink null/LRU/release/串行链/in-flight 去重/自愈+冷却/竞态作废）
git add apps/web/src/pages/canvas/video-editor/renderer && git commit -m "feat(video-editor): VideoCacheService——三段命中/LRU 淘汰/串行链/资源释放（TDD）"
```

---

### Task 5: audio-engine 纯函数——pcm（stretch/resample）+ gain（buildGainPoints）

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/audio-engine/pcm.ts`
- Create: `apps/web/src/pages/canvas/video-editor/audio-engine/gain.ts`
- Test: `apps/web/src/pages/canvas/video-editor/audio-engine/pcm.test.ts` + `gain.test.ts`
- Create（条件）: `apps/web/src/types/soundtouchjs.d.ts`（包无类型声明时）

- [x] **Step 1: 检查 soundtouchjs 类型声明**

```bash
ls apps/web/node_modules/soundtouchjs/dist/
grep -E '"types"|"typings"' apps/web/node_modules/soundtouchjs/package.json || echo "NO_TYPES"
```

若 NO_TYPES 且 dist 无 .d.ts → 新建 `apps/web/src/types/soundtouchjs.d.ts`：

```ts
declare module 'soundtouchjs' {
  export class SoundTouch {
    constructor(); // 实测无参（dist L24）——pitch/tempo/rate 均为可写属性
    tempo: number; pitch: number; rate: number;
  }
  export class SimpleFilter {
    constructor(source: WebAudioBufferSource, pipe: SoundTouch);
    extract(target: Float32Array, numFrames: number): number;
  }
  export class WebAudioBufferSource {
    constructor(buffer: AudioBuffer);
  }
  export class PitchShifter { constructor(context: AudioContext, buffer: AudioBuffer, bufferSize: number); tempo: number; }
}
```

（以实际导出为准微调——spike 已实测 SoundTouch/SimpleFilter/WebAudioBufferSource 存在。）

- [x] **Step 2: 写失败测试（pcm）**

```ts
// apps/web/src/pages/canvas/video-editor/audio-engine/pcm.test.ts
import { describe, it, expect } from 'vitest';
import { stretchPcm, resamplePcm, type PcmData } from './pcm';

const sine = (sr: number, sec: number, freq: number): Float32Array => {
  const p = new Float32Array(sr * sec);
  for (let i = 0; i < p.length; i++) p[i] = Math.sin(2 * Math.PI * freq * (i / sr));
  return p;
};
const mono = (ch: Float32Array, sr = 48000): PcmData => ({ sampleRate: sr, channels: [ch] });
const stereo = (ch: Float32Array, sr = 48000): PcmData => ({ sampleRate: sr, channels: [ch, ch] });

/** 主频估计：过零计数法（每秒过零数/2） */
const dominantFreq = (d: Float32Array, sr: number) => {
  let z = 0;
  for (let i = 1; i < d.length; i++) if ((d[i - 1] < 0 && d[i] >= 0) || (d[i - 1] >= 0 && d[i] < 0)) z++;
  return (z / 2) * (sr / d.length);
};
/** 尾部信号窗口最大绝对值（R2 N4：单点采样 |sinθ|<0.1 概率 6.4% 会 flaky——440Hz 周期 109 样本，
 *  任意 200 样本窗口必含峰值区 max≈1；补零区 max=0。零 flake 且锁住"尾部是真实信号非补零"） */
const tailMax = (arr: Float32Array, from: number): number => {
  let m = 0;
  for (let i = from; i < Math.min(arr.length, from + 200); i++) m = Math.max(m, Math.abs(arr[i]));
  return m;
};

describe('stretchPcm（soundtouch 离线变速，spike 定案路线）', () => {
  it('tempo=1 恒等（长度与内容）', () => {
    const input = stereo(sine(48000, 0.5, 440));
    const out = stretchPcm(input, 1);
    expect(out.channels[0].length).toBe(input.channels[0].length);
  });
  it('tempo=2：输出长度=期望值且尾部非静音（G8 假绿修复——长度恒等于 round(len/tempo)，±容差断言恒真无锁力）', () => {
    const input = stereo(sine(48000, 2, 440));
    const out = stretchPcm(input, 2);
    const expected = input.channels[0].length / 2;
    expect(out.channels[0].length).toBe(Math.round(expected)); // 锁决策 2 契约：期望长度截/补
    // spike 实测 2× 输出 0.980s（98%）——93% 位置起的 200 样本窗口必须是真实信号非尾部补零（N4 max-窗口）
    expect(tailMax(out.channels[0], Math.floor(expected * 0.93))).toBeGreaterThan(0.3);
  });
  it('tempo=2：主频保持 440Hz（变速不变调，±2% 容差）', () => {
    const out = stretchPcm(stereo(sine(48000, 2, 440)), 2);
    expect(Math.abs(dominantFreq(out.channels[0], out.sampleRate) - 440) / 440).toBeLessThan(0.02);
  });
  it('tempo=0.5：长度=期望值且尾部非静音（spike 实测 0.5× 输出 97%）且主频保持', () => {
    const out = stretchPcm(stereo(sine(48000, 1, 440)), 0.5);
    const expected = 48000 * 2;
    expect(out.channels[0].length).toBe(Math.round(expected));
    expect(tailMax(out.channels[0], Math.floor(expected * 0.93))).toBeGreaterThan(0.3); // N4 max-窗口
    expect(Math.abs(dominantFreq(out.channels[0], out.sampleRate) - 440) / 440).toBeLessThan(0.02);
  });
  it('mono 输入：内部升双声道处理，输出仍单声道', () => {
    const out = stretchPcm(mono(sine(48000, 1, 440)), 2);
    expect(out.channels).toHaveLength(1);
    expect(out.channels[0].length).toBe(24000);
  });
});

describe('resamplePcm（线性插值）', () => {
  it('同采样率直返', () => {
    const input = mono(sine(48000, 0.1, 440));
    const out = resamplePcm(input, 48000);
    expect(out.channels[0]).toBe(input.channels[0]); // 引用直返（零拷贝）
  });
  it('48000→24000：长度减半', () => {
    const out = resamplePcm(mono(sine(48000, 1, 440)), 24000);
    expect(out.channels[0].length).toBe(24000);
    expect(out.sampleRate).toBe(24000);
  });
});
```

- [x] **Step 3: 写失败测试（gain）**

```ts
// apps/web/src/pages/canvas/video-editor/audio-engine/gain.test.ts
import { describe, it, expect } from 'vitest';
import { buildGainPoints, gainValueAt } from './gain';
import type { ProjectData, VideoClip, AudioClip, Track } from '../types';

const track = (id: string, type: Track['type'], clipIds: string[], over: Partial<Track> = {}): Track =>
  ({ id, type, name: id, muted: false, hidden: false, clips: clipIds, ...over });
const vc = (id: string, over: Partial<VideoClip> = {}): VideoClip => ({
  id, trackId: 'tv', type: 'video', start: 0, duration: 4, sourceStart: 0, mediaId: 'mv', playbackSpeed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [], ...over,
});
const au = (id: string, over: Partial<AudioClip> = {}): AudioClip => ({
  id, trackId: 'ta', type: 'audio', start: 0, duration: 4, sourceStart: 0, mediaId: 'ma',
  volume: 1, fade: { in: 0, out: 0 }, playbackSpeed: 1, keyframes: [], ...over,
});
const proj = (tracks: Track[], clips: Record<string, VideoClip | AudioClip>): ProjectData =>
  ({ version: 1, fps: 30, tracks, clips: clips as ProjectData['clips'] });

const valueAt = (pts: { t: number; value: number }[], t: number) => gainValueAt(pts, t);

describe('buildGainPoints（音频片：volume × kf × fade）', () => {
  it('无修饰恒 1（首尾锚点）', () => {
    const pts = buildGainPoints(proj([track('ta', 'audio', ['a'])], { a: au('a') }), 'a');
    expect(valueAt(pts, 0)).toBe(1);
    expect(valueAt(pts, 2)).toBe(1);
  });
  it('fadeIn 0.5→1 线性；fadeOut 对称', () => {
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a', { fade: { in: 2, out: 2 } }) });
    const pts = buildGainPoints(d, 'a');
    expect(valueAt(pts, 0)).toBeCloseTo(0, 10);
    expect(valueAt(pts, 1)).toBeCloseTo(0.5, 10);
    expect(valueAt(pts, 2)).toBe(1);
    expect(valueAt(pts, 3)).toBeCloseTo(0.5, 10);
  });
  it('volume 基准 × volume 关键帧（越首末取端值）', () => {
    const d = proj([track('ta', 'audio', ['a'])], {
      a: au('a', { volume: 0.8, keyframes: [{ id: 'k1', t: 1, value: 0.2, easing: 'linear' }] }),
    });
    const pts = buildGainPoints(d, 'a');
    expect(valueAt(pts, 0)).toBeCloseTo(0.2, 10); // 越首点取首点值（单点恒值）
    expect(valueAt(pts, 1)).toBeCloseTo(0.2, 10);
  });
  it('muted 轨恒 0（仍占时长——调度不跳过）', () => {
    const d = proj([track('ta', 'audio', ['a'], { muted: true })], { a: au('a') });
    const pts = buildGainPoints(d, 'a');
    expect(pts).toEqual([{ t: 0, value: 0 }]);
  });
});

describe('buildGainPoints（视频片内嵌音轨：与画面 opacity 同曲线 equal-gain）', () => {
  it('crossfade 前片尾缘 1→0 / 后片前缘 0→1（中点各 0.5）', () => {
    const d = proj([track('tv', 'video', ['f', 'b'])], {
      f: vc('f', { start: 0, duration: 3 }),
      b: vc('b', { start: 2.5, duration: 3, transitionIn: { type: 'crossfade', duration: 0.5 } }),
    });
    const pf = buildGainPoints(d, 'f');
    const pb = buildGainPoints(d, 'b');
    expect(valueAt(pf, 2.5)).toBeCloseTo(1, 10);
    expect(valueAt(pf, 2.75)).toBeCloseTo(0.5, 10);
    expect(valueAt(pb, 0)).toBeCloseTo(0, 10);
    expect(valueAt(pb, 0.25)).toBeCloseTo(0.5, 10);
    expect(valueAt(pb, 1)).toBe(1);
  });
  it('三片链 crossfade：中间片双窗口增益（尾缘中点 0.5——R1 审核 G3 修复前恒 1）', () => {
    const d = proj([track('tv', 'video', ['a', 'b', 'c'])], {
      a: vc('a', { start: 0, duration: 3 }),
      b: vc('b', { start: 2.5, duration: 3, transitionIn: { type: 'crossfade', duration: 0.5 } }),
      c: vc('c', { start: 5, duration: 3, transitionIn: { type: 'crossfade', duration: 0.5 } }),
    });
    const pb = buildGainPoints(d, 'b');
    expect(valueAt(pb, 0)).toBeCloseTo(0, 10);
    expect(valueAt(pb, 1)).toBe(1);
    expect(valueAt(pb, 2.75)).toBeCloseTo(0.5, 10);
  });
  it('opacity 关键帧参与音轨增益（画面透明=音量同曲线）', () => {
    const d = proj([track('tv', 'video', ['a'])], {
      a: vc('a', { keyframes: [{ id: 'k1', t: 0, property: 'opacity', value: 0, easing: 'linear' }, { id: 'k2', t: 4, property: 'opacity', value: 1, easing: 'linear' }] }),
    });
    const pts = buildGainPoints(d, 'a');
    expect(valueAt(pts, 0)).toBeCloseTo(0, 10);
    expect(valueAt(pts, 2)).toBeCloseTo(0.5, 10);
  });
  it('fadeOut 转场音轨同步淡出', () => {
    const d = proj([track('tv', 'video', ['a'])], {
      a: vc('a', { transitionOut: { type: 'fadeOut', duration: 2 } }),
    });
    expect(valueAt(buildGainPoints(d, 'a'), 3)).toBeCloseTo(0.5, 10);
  });
  it('图片/字幕片无音轨 → 恒 0', () => {
    const d = proj([track('tv', 'video', ['img'])], {
      img: { id: 'img', trackId: 'tv', type: 'image', start: 0, duration: 4, mediaId: 'mi', transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] } as never,
    });
    expect(buildGainPoints(d, 'img')).toEqual([{ t: 0, value: 0 }]);
  });
});

describe('gainValueAt（折线求值）', () => {
  it('两点间线性', () => {
    expect(gainValueAt([{ t: 0, value: 0 }, { t: 2, value: 1 }], 0.5)).toBeCloseTo(0.25, 10);
  });
});
```

- [x] **Step 4: 确认失败 → 实现 pcm.ts + gain.ts**

```ts
// apps/web/src/pages/canvas/video-editor/audio-engine/pcm.ts
import { SoundTouch, SimpleFilter, WebAudioBufferSource } from 'soundtouchjs';

export interface PcmData { sampleRate: number; channels: Float32Array[]; }

/** 线性插值重采样（vendor retime/audio-stretch.ts buildResampledBuffer 形状，纯函数） */
export function resamplePcm(input: PcmData, targetRate: number): PcmData {
  if (input.sampleRate === targetRate) return input;
  const srcLen = input.channels[0].length;
  const ratio = input.sampleRate / targetRate;
  const outLen = Math.floor(srcLen / ratio);
  return {
    sampleRate: targetRate,
    channels: input.channels.map(c => {
      const out = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const pos = i * ratio;
        const i0 = Math.floor(pos);
        const i1 = Math.min(srcLen - 1, i0 + 1);
        const f = pos - i0;
        out[i] = c[i0] * (1 - f) + c[i1] * f;
      }
      return out;
    }),
  };
}

/** soundtouch 尾部冲刷缓冲（spike 陷阱：source 抽干后不足 16384 帧的尾部输入被丢弃） */
const FLUSH_FRAMES = 16384;
const EXTRACT_CHUNK = 4096;

/** 离线变速不变调（spike 定案：SoundTouch + SimpleFilter 手动 extract）。
 *  mono 输入内部升双声道、输出还原单声道；输出按期望长度 round(len/tempo) 截/补
 *  （决策 2：比"最后非零扫描"确定，soundtouch 处理延迟差 ~2% 表现为尾部几十 ms 静音）。 */
export function stretchPcm(input: PcmData, tempo: number): PcmData {
  if (tempo === 1) return { sampleRate: input.sampleRate, channels: input.channels.map(c => c.slice()) };
  const wasMono = input.channels.length === 1;
  const src = wasMono ? [input.channels[0], input.channels[0]] : input.channels;
  const srcLen = src[0].length;
  const padded = src.map(c => {
    const p = new Float32Array(srcLen + FLUSH_FRAMES);
    p.set(c);
    return p;
  });
  const fakeBuffer = {
    sampleRate: input.sampleRate,
    numberOfChannels: 2,
    getChannelData: (i: number) => padded[i],
    duration: padded[0].length / input.sampleRate,
  } as unknown as AudioBuffer;
  const st = new SoundTouch(); // 实测构造无参——采样率经 WebAudioBufferSource 的 buffer 携带
  st.tempo = tempo;
  const filter = new SimpleFilter(new WebAudioBufferSource(fakeBuffer), st);
  const inter = new Float32Array(EXTRACT_CHUNK * 2);
  const chunks: Float32Array[] = [];
  let totalFrames = 0;
  for (;;) {
    const n = filter.extract(inter, EXTRACT_CHUNK); // n = 帧数（每帧双声道交错 2 样本）
    if (n === 0) break;
    chunks.push(inter.slice(0, n * 2));
    totalFrames += n;
  }
  const outInter = new Float32Array(totalFrames * 2);
  let off = 0;
  for (const c of chunks) { outInter.set(c, off); off += c.length; }
  const expectedFrames = Math.round(srcLen / tempo); // 期望长度截/补
  const outChannels: Float32Array[] = [];
  const count = wasMono ? 1 : 2;
  for (let ch = 0; ch < count; ch++) {
    const out = new Float32Array(expectedFrames);
    for (let i = 0; i < expectedFrames; i++) {
      out[i] = i * 2 + ch < outInter.length ? outInter[i * 2 + ch] : 0;
    }
    outChannels.push(out);
  }
  return { sampleRate: input.sampleRate, channels: outChannels };
}
```

```ts
// apps/web/src/pages/canvas/video-editor/audio-engine/gain.ts
import type { AudioClip, ProjectData, VideoClip } from '../types';
import { keyframeValueAt, interpolateTransform, crossfadeContextOf, transitionEffect, type VisualClip } from '../scene/interpolate';
import { effectiveTransitions } from '../timeline/overlap';

export interface GainPoint { t: number; value: number; } // t 为片段局部时间

/** 折线求值（调度 seek 锚点用；points 首点恒 t=0） */
export function gainValueAt(points: GainPoint[], tLocal: number): number {
  if (points.length === 0) return 0;
  return keyframeValueAt(points, tLocal, points[0].value);
}

/** 片段音轨增益拐点集（调度时转 GainNode automation）：
 *  - audio 片：volume × VolumeKeyframe 插值 × fade in/out；muted 轨恒 0；
 *  - video 片（内嵌音轨）：与画面 opacity 同曲线 equal-gain（spec 第六节）——
 *    transform.opacity 通道 × 转场 alpha（crossfade/fadeIn/fadeOut），toBlack/toWhite 仅画面 overlay 不影响音轨；
 *  - image/subtitle：无音轨恒 0。
 *  输出保证含 t=0 与 t=duration 端点、按 t 升序。 */
export function buildGainPoints(data: ProjectData, clipId: string): GainPoint[] {
  const clip = data.clips[clipId] as VideoClip | AudioClip | undefined;
  if (!clip) return [];
  const tr = data.tracks.find(t => t.id === clip.trackId);
  if (tr?.muted) return [{ t: 0, value: 0 }];
  const dur = clip.duration;
  const times = new Set<number>([0, dur]);
  let gainAt: (tl: number) => number;

  if (clip.type === 'audio') {
    const kf = clip.keyframes.map(k => ({ t: k.t, value: k.value }));
    for (const k of kf) times.add(k.t);
    if (clip.fade.in > 0) times.add(Math.min(clip.fade.in, dur));
    if (clip.fade.out > 0) times.add(Math.max(0, dur - clip.fade.out));
    gainAt = (tl) => {
      let g = keyframeValueAt(kf, tl, clip.volume);
      if (clip.fade.in > 0 && tl < clip.fade.in) g *= tl / clip.fade.in;
      const rem = dur - tl;
      if (clip.fade.out > 0 && rem < clip.fade.out) g *= rem / clip.fade.out;
      return g;
    };
  } else if (clip.type === 'video') {
    const opKf = clip.keyframes.filter(k => k.property === 'opacity').map(k => ({ t: k.t, value: k.value }));
    for (const k of opKf) times.add(k.t);
    const cf = crossfadeContextOf(data, clipId);
    const eff = effectiveTransitions(data, clipId);
    if (cf) {
      // 双窗口拐点（决策 17 与 transitionEffect 同源）
      if (cf.backOverlap > 0) times.add(Math.min(cf.backOverlap, dur));
      if (cf.frontOverlap > 0) times.add(Math.max(0, dur - cf.frontOverlap));
    }
    const skipIn = !!cf && cf.backOverlap > 0; // crossfade 入场已由窗口施加（防重复）
    if (!skipIn && eff.in && eff.in.duration > 0 && eff.in.type !== 'toBlack' && eff.in.type !== 'toWhite') times.add(Math.min(eff.in.duration, dur));
    if (eff.out && eff.out.duration > 0 && eff.out.type !== 'toBlack' && eff.out.type !== 'toWhite') times.add(Math.max(0, dur - eff.out.duration));
    gainAt = (tl) => {
      const v = clip as VisualClip;
      const opacity = interpolateTransform(v, tl).opacity;
      const { alpha } = transitionEffect(data, v, tl);
      return opacity * alpha;
    };
  } else {
    return [{ t: 0, value: 0 }];
  }

  const sorted = [...times].sort((a, b) => a - b);
  const pts: GainPoint[] = [];
  for (const t of sorted) {
    const value = gainAt(t);
    if (pts.length === 0 || Math.abs(pts[pts.length - 1].t - t) > 1e-9) pts.push({ t, value });
  }
  return pts;
}
```

（`VisualClip` 若 interpolate.ts 未导出，在该文件 `export type VisualClip = VideoClip | ImageClip;` 并同步本 import。）

- [x] **Step 5: 跑测试通过 + tsc + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/audio-engine/pcm.test.ts src/pages/canvas/video-editor/audio-engine/gain.test.ts
# 预期: 全 PASS（soundtouch 真实运行——SoundTouch 类纯 JS 无 AudioContext 依赖，spike 已验证 node 可跑）
pnpm -C apps/web exec tsc -b
git add apps/web/src/pages/canvas/video-editor/audio-engine apps/web/src/types && git commit -m "feat(video-editor): audio PCM 纯函数——soundtouch 变速/线性重采样/增益拐点 equal-gain（TDD）"
```

---

### Task 6: audio-engine——decodeMediaPcm + AudioEngine 单例（调度/主时钟/资源纪律）

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/audio-engine/decode.ts`
- Create: `apps/web/src/pages/canvas/video-editor/audio-engine/engine.ts`
- Test: `apps/web/src/pages/canvas/video-editor/audio-engine/engine.test.ts`

- [x] **Step 1: 实现 decode.ts（mediabunny AudioBufferSink 薄封装——vendor media/audio.ts resolveAudioBufferForAsset 形状；真浏览器路径，jsdom 测试经 vi.mock 覆盖，不单独建 spec）**

```ts
// apps/web/src/pages/canvas/video-editor/audio-engine/decode.ts
import { resamplePcm, type PcmData } from './pcm';

/** 解码媒体 PCM（统一 mediabunny：mp4 内嵌音轨与独立音频同路；vendor resolveAudioBufferForAsset 同款）。
 *  无音轨/失败 → null。输出重采样到 targetRate（AudioBufferSink 输出轨道原生采样率）。 */
export async function decodeMediaPcm(blob: Blob, targetRate: number): Promise<PcmData | null> {
  const { Input, ALL_FORMATS, BlobSource, AudioBufferSink } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;
    const sink = new AudioBufferSink(track);
    const chunks: Float32Array[][] = [];
    let len = 0;
    let sampleRate = targetRate;
    let channels = 1;
    for await (const { buffer } of sink.buffers(0)) {
      sampleRate = buffer.sampleRate;
      channels = buffer.numberOfChannels;
      const cs: Float32Array[] = [];
      for (let ch = 0; ch < channels; ch++) cs.push(buffer.getChannelData(ch).slice()); // 池复用防御拷贝
      chunks.push(cs);
      len += cs[0].length;
    }
    if (len === 0) return null;
    const merged: Float32Array[] = [];
    for (let ch = 0; ch < channels; ch++) {
      const c = new Float32Array(len);
      let off = 0;
      for (const cs of chunks) { c.set(cs[ch], off); off += cs[ch].length; }
      merged.push(c);
    }
    return resamplePcm({ sampleRate, channels: merged }, targetRate);
  } catch {
    return null;
  } finally {
    try { input.dispose(); } catch { /* 已释放——Input.dispose() 返回 void（R2 审核 N1：B1 当时两处只修了 video-cache 一处） */ }
  }
}
```

- [x] **Step 2: 写失败测试（engine）**

```ts
// apps/web/src/pages/canvas/video-editor/audio-engine/engine.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioEngine, type AudioContextLike, type BufferSourceLike, type GainNodeLike } from './engine';
import type { ProjectData, VideoClip, AudioClip, Track } from '../types';

vi.mock('./decode', () => ({ decodeMediaPcm: vi.fn() }));
import { decodeMediaPcm } from './decode';

// ---- fake AudioContext（jsdom 无 WebAudio；currentTime 由测试手动推进）----
function makeFakeCtx(sampleRate = 48000) {
  let now = 0;
  const created: { sources: BufferSourceLike[]; gains: GainNodeLike[] } = { sources: [], gains: [] };
  const ctx: AudioContextLike = {
    currentTime: 0, sampleRate, state: 'running',
    destination: { __dest: true },
    createBuffer: vi.fn((channels: number, length: number, sr: number) => ({
      numberOfChannels: channels, length, sampleRate: sr,
      getChannelData: () => new Float32Array(length),
    })),
    createBufferSource: () => {
      const s: BufferSourceLike = {
        buffer: null, connect: () => s, start: vi.fn(), stop: vi.fn(), onended: null,
      };
      created.sources.push(s);
      return s;
    },
    createGain: () => {
      const automation: { type: string; v: number; t: number }[] = [];
      const g: GainNodeLike = {
        gain: {
          value: 1,
          setValueAtTime: (v, t) => automation.push({ type: 'set', v, t }),
          linearRampToValueAtTime: (v, t) => automation.push({ type: 'ramp', v, t }),
          cancelScheduledValues: () => {},
        },
        connect: () => g,
        disconnect: () => {},
        __automation: automation,
      } as unknown as GainNodeLike;
      created.gains.push(g);
      return g;
    },
    resume: vi.fn(async () => {}), suspend: vi.fn(async () => {}),
  };
  return { ctx, created, advance: (dt: number) => { now += dt; (ctx as { currentTime: number }).currentTime = now; } };
}

// ---- 夹具 ----
const track = (id: string, type: Track['type'], clipIds: string[], over: Partial<Track> = {}): Track =>
  ({ id, type, name: id, muted: false, hidden: false, clips: clipIds, ...over });
const vc = (id: string, over: Partial<VideoClip> = {}): VideoClip => ({
  id, trackId: 'tv', type: 'video', start: 0, duration: 4, sourceStart: 0, mediaId: 'mv', playbackSpeed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [], ...over,
});
const au = (id: string, over: Partial<AudioClip> = {}): AudioClip => ({
  id, trackId: 'ta', type: 'audio', start: 0, duration: 4, sourceStart: 0, mediaId: 'ma',
  volume: 1, fade: { in: 0, out: 0 }, playbackSpeed: 1, keyframes: [], ...over,
});
const proj = (tracks: Track[], clips: Record<string, VideoClip | AudioClip>): ProjectData =>
  ({ version: 1, fps: 30, tracks, clips: clips as ProjectData['clips'] });

const PCM = (len = 48000 * 10) => ({ sampleRate: 48000, channels: [new Float32Array(len), new Float32Array(len)] });
const BLOB = new Blob(['x']);

describe('AudioEngine（调度/主时钟/资源纪律）', () => {
  let fake: ReturnType<typeof makeFakeCtx>;
  let engine: AudioEngine;
  beforeEach(() => {
    fake = makeFakeCtx();
    engine = new AudioEngine({ ctxFactory: () => fake.ctx });
    vi.mocked(decodeMediaPcm).mockReset();
  });

  it('prepare：按 (mediaId,speed) 解码+变速缓存；同 key 不重复解码；getBlob null 跳过', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj(
      [track('tv', 'video', ['v1']), track('ta', 'audio', ['a1', 'a2'])],
      { v1: vc('v1', { mediaId: 'mv', playbackSpeed: 2 }), a1: au('a1', { mediaId: 'ma' }), a2: au('a2', { mediaId: 'ma', playbackSpeed: 2 }) },
    );
    await engine.prepare(d, async (id) => (id === 'ma' ? BLOB : null)); // mv 无 blob 跳过
    expect(decodeMediaPcm).toHaveBeenCalledTimes(2); // ma:1 与 ma:2（mv 跳过）
    expect(engine.hasPcm('ma:1')).toBe(true);
    expect(engine.hasPcm('ma:2')).toBe(true);
    expect(engine.hasPcm('mv:2')).toBe(false);
  });

  it('playFrom：source.start 参数——when 未来映射/offset 变速换算/duration 成片时长', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], {
      a: au('a', { start: 2, duration: 4, sourceStart: 1, playbackSpeed: 2 }), // from=3：局部已进 1s
    });
    await engine.prepare(d, async () => BLOB);
    engine.playFrom(d, 3);
    const src = fake.created.sources.at(-1)!;
    // when=ctxNow(0)+max(0,2-3)=0；offset=(sourceStart 1+已消费 (3-2)×2)/2=1.5（stretched 坐标=原坐标/speed，决策 3——B3 验算修正：(1+2)/2=1.5）；duration=4-1=3
    expect(src.start).toHaveBeenCalledWith(0, 1.5, 3);
  });

  it('playFrom from < clip.start：when 映射到未来', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a', { start: 5, duration: 4, sourceStart: 0 }) });
    await engine.prepare(d, async () => BLOB);
    fake.advance(1); // ctx.currentTime = 1
    engine.playFrom(d, 0);
    const src = fake.created.sources.at(-1)!;
    expect(src.start).toHaveBeenCalledWith(1 + 5, 0, 4);
  });

  it('now()：主时钟锚定与推进（音频时钟）', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a') });
    await engine.prepare(d, async () => BLOB);
    engine.playFrom(d, 10);
    expect(engine.now()).toBeCloseTo(10, 6);
    fake.advance(2);
    expect(engine.now()).toBeCloseTo(12, 6);
  });

  it('perf 时钟模式（无 PCM 不创建 AudioContext）', () => {
    engine.setClockMode('perf');
    engine.playFrom(proj([track('tv', 'video', ['i'])], {
      i: { id: 'i', trackId: 'tv', type: 'video', start: 0, duration: 4, sourceStart: 0, mediaId: 'x', playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] } as never,
    }), 5);
    expect(engine.getContextCreated()).toBe(false); // 不为时钟空转 ctx（spec 第六节）
    expect(engine.now()).toBeGreaterThanOrEqual(5);
  });

  it('seek（播放中）：旧 source 全部 stop + 重调度 + 时钟重锚', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a') });
    await engine.prepare(d, async () => BLOB);
    engine.playFrom(d, 0);
    const first = [...fake.created.sources];
    engine.playFrom(d, 2); // seek = playFrom 重锚
    for (const s of first) expect(s.stop).toHaveBeenCalled();
    expect(engine.now()).toBeCloseTo(2, 6);
  });

  it('stop：全部 source stop + 时钟清零', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a') });
    await engine.prepare(d, async () => BLOB);
    engine.playFrom(d, 0);
    engine.stop();
    for (const s of fake.created.sources) expect(s.stop).toHaveBeenCalled();
    expect(engine.now()).toBe(0);
  });

  it('muted 轨：调度不跳过但 gain 恒 0', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'], { muted: true })], { a: au('a') });
    await engine.prepare(d, async () => BLOB);
    engine.playFrom(d, 0);
    expect(fake.created.sources).toHaveLength(1); // 仍占时长
    const g = fake.created.gains.at(-1)! as unknown as { __automation: { type: string; v: number }[] };
    expect(g.__automation[0]).toMatchObject({ type: 'set', v: 0 });
  });

  it('gain automation：from 处锚点 + 未来拐点 linearRamp', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a', { fade: { in: 2, out: 0 } }) });
    await engine.prepare(d, async () => BLOB);
    fake.advance(1);
    engine.playFrom(d, 1); // from=1：锚点 = gain(1)=0.5；未来拐点 t=2(ramp 1.0)、t=4(ramp 1.0)
    const g = fake.created.gains.at(-1)! as unknown as { __automation: { type: string; v: number; t: number }[] };
    expect(g.__automation[0]).toMatchObject({ type: 'set', v: 0.5, t: 1 });
    const ramps = g.__automation.filter(a => a.type === 'ramp');
    expect(ramps.some(r => Math.abs(r.v - 1) < 1e-9 && Math.abs(r.t - 2) < 1e-9)).toBe(true);
  });

  it('releasePcm：清缓存（编辑器收起释放）', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a') });
    await engine.prepare(d, async () => BLOB);
    engine.releasePcm();
    expect(engine.hasPcm('ma:1')).toBe(false);
  });

  it('重复 playFrom 复用 AudioBuffer（G4：createBuffer 次数不随 playFrom 增长——拖拽 seek 分配纪律）', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a') });
    await engine.prepare(d, async () => BLOB);
    engine.playFrom(d, 0);
    engine.playFrom(d, 2);
    engine.playFrom(d, 3);
    expect(fake.ctx.createBuffer).toHaveBeenCalledTimes(1); // 每 mediaId:speed 只建一次
  });

  it('suspend 后再次 playFrom：resume 被调（G2——currentTime 冻结修复，二次打开不黑屏）', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(PCM());
    const d = proj([track('ta', 'audio', ['a'])], { a: au('a') });
    await engine.prepare(d, async () => BLOB);
    engine.playFrom(d, 0);
    engine.suspend();
    (fake.ctx as { state: string }).state = 'suspended';
    engine.playFrom(d, 1);
    expect(fake.ctx.resume).toHaveBeenCalled();
  });

  it('setMasterVolume：master gain 设置', () => {
    engine.setMasterVolume(0.5);
    expect(engine.getMasterVolume()).toBeCloseTo(0.5, 10);
  });
});
```

- [x] **Step 3: 确认失败 → 实现 engine.ts**

```ts
// apps/web/src/pages/canvas/video-editor/audio-engine/engine.ts
import type { ProjectData } from '../types';
import { decodeMediaPcm } from './decode';
import { stretchPcm, type PcmData } from './pcm';
import { buildGainPoints, gainValueAt } from './gain';

// ---- Web Audio 结构类型（实时/离线/测试 fake 共用，不依赖具体实现）----
export interface AudioParamLike {
  value: number;
  setValueAtTime(v: number, t: number): void;
  linearRampToValueAtTime(v: number, t: number): void;
  cancelScheduledValues(t: number): void;
}
export interface GainNodeLike { gain: AudioParamLike; connect(node: unknown): unknown; disconnect(): void; }
export interface BufferSourceLike {
  buffer: unknown;
  connect(node: unknown): unknown;
  start(when?: number, offset?: number, duration?: number): void;
  stop(t?: number): void;
  onended: (() => void) | null;
}
export interface AudioBufferLike {
  numberOfChannels: number; length: number; sampleRate: number;
  getChannelData(channel: number): Float32Array;
}
export interface AudioContextLike {
  currentTime: number; sampleRate: number; state: string;
  destination: unknown;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): BufferSourceLike;
  createGain(): GainNodeLike;
  resume(): Promise<void>; suspend(): Promise<void>;
}

export type ClockMode = 'ctx' | 'perf';

interface TimeBase { mode: ClockMode; baseMedia: number; baseReal: number; }

export class AudioEngine {
  private ctx: AudioContextLike | null = null;
  private master: GainNodeLike | null = null;
  private masterVolume = 1;
  private sources: BufferSourceLike[] = [];
  /** A1 单份驻留（R2）：只存 AudioBuffer——prepare 解码+变速后立即转换，PcmData 局部变量即弃。
   *  双份常驻（PcmData + AudioBuffer）按 spec 口径 345.6MB/轨 ×2 = 690MB/轨不可接受。 */
  private bufferCache = new Map<string, AudioBufferLike>();
  private timeBase: TimeBase | null = null;
  private clockMode: ClockMode = 'ctx';

  constructor(private readonly deps: { ctxFactory?: () => AudioContextLike } = {}) {}

  /** 惰性创建（必须在用户手势调用链内首次触发）；测试经 ctxFactory 注入 */
  getContext(): AudioContextLike {
    if (!this.ctx) {
      this.ctx = this.deps.ctxFactory
        ? this.deps.ctxFactory()
        : new AudioContext() as unknown as AudioContextLike;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterVolume;
      this.master.connect(this.ctx.destination);
      void this.ctx.resume();
    }
    return this.ctx;
  }
  getContextCreated(): boolean { return this.ctx !== null; }

  setClockMode(mode: ClockMode): void { this.clockMode = mode; }

  /** 主时钟（决策 8 单一真相）：ctx 模式锚 ctx.currentTime；perf 模式锚 performance.now（无 PCM 不空转 ctx） */
  now(): number {
    if (!this.timeBase) return 0;
    const real = this.timeBase.mode === 'ctx' ? this.ctx!.currentTime : performance.now() / 1000;
    return this.timeBase.baseMedia + (real - this.timeBase.baseReal);
  }

  /** 命名历史沿用（R3 五-4 登记）：实现已是 AudioBuffer 单份驻留（A1）——语义即 hasAudioBuffer/releaseAudioBuffers。
   *  Plan 4 导出路径消费时注意：此处查/清的是 AudioBuffer 缓存，PcmData 在 prepare 后即弃。 */
  hasPcm(key?: string): boolean { return key ? this.bufferCache.has(key) : this.bufferCache.size > 0; }
  releasePcm(): void { this.bufferCache.clear(); }

  /** 播放前预处理：按 (mediaId:speed) 解码 + soundtouch 变速 → **立即转 AudioBuffer 单份驻留**（决策 3 + A1） */
  async prepare(data: ProjectData, getBlob: (mediaId: string) => Promise<Blob | null>): Promise<void> {
    const needed = new Set<string>();
    for (const c of Object.values(data.clips)) {
      if (c.type === 'video' || c.type === 'audio') needed.add(`${c.mediaId}:${c.playbackSpeed}`);
    }
    if (needed.size === 0) { this.setClockMode('perf'); return; }
    const ctx = this.getContext(); // 手势链路内创建
    const targetRate = ctx.sampleRate;
    for (const key of needed) {
      if (this.bufferCache.has(key)) continue;
      const sep = key.lastIndexOf(':');
      const mediaId = key.slice(0, sep);
      const speed = Number(key.slice(sep + 1));
      const blob = await getBlob(mediaId);
      if (!blob) continue;
      const raw = await decodeMediaPcm(blob, targetRate);
      if (!raw) continue; // 无音轨（纯视频/图片）
      const pcm = speed === 1 ? raw : stretchPcm(raw, speed);
      this.bufferCache.set(key, this.toBuffer(ctx, pcm)); // A1：PcmData 即弃，只留 AudioBuffer
    }
    this.setClockMode(this.hasPcm() ? 'ctx' : 'perf');
  }

  /** 播放/seek 统一入口：stop 旧 source → resume（G2：suspend 后二次打开 currentTime 冻结修复）→ 锚定时钟 → 全量调度（决策 6：一次性调度替代 lookahead + G4 AudioBuffer 复用） */
  playFrom(data: ProjectData, from: number): void {
    this.stopSources();
    if (this.ctx) this.resumeCtx(); // G2：ctx 已存在时 getContext 不会 resume，必须显式恢复
    const real = this.clockMode === 'ctx' ? this.getContext().currentTime : performance.now() / 1000;
    this.timeBase = { mode: this.clockMode, baseMedia: from, baseReal: real };
    if (this.clockMode === 'perf') return; // 无音频：只锚时钟
    const ctx = this.getContext();
    const ctxNow = ctx.currentTime;
    for (const tr of data.tracks) {
      for (const cid of tr.clips) {
        const clip = data.clips[cid] as ProjectData['clips'][string];
        if (!clip || (clip.type !== 'video' && clip.type !== 'audio')) continue;
        const clipEnd = clip.start + clip.duration;
        if (clipEnd <= from) continue;
        const key = `${clip.mediaId}:${clip.playbackSpeed}`;
        const buffer = this.bufferCache.get(key);
        if (!buffer) continue;
        const src = ctx.createBufferSource();
        src.buffer = buffer; // A1：prepare 已建好，playFrom 零复制（G4）
        const gain = ctx.createGain();
        src.connect(gain);
        gain.connect(this.master!);
        const when = clip.start > from ? ctxNow + (clip.start - from) : ctxNow;
        const consumed = Math.max(0, from - clip.start) * clip.playbackSpeed;
        const offset = (clip.sourceStart + consumed) / clip.playbackSpeed; // stretched 坐标 = 原坐标/speed（决策 3）
        const duration = clip.duration - Math.max(0, from - clip.start);
        this.applyGain(gain.gain, buildGainPoints(data, cid), clip.start, from, ctxNow);
        src.start(when, offset, duration);
        this.sources.push(src);
      }
    }
  }

  private applyGain(param: AudioParamLike, points: { t: number; value: number }[], clipStart: number, from: number, ctxNow: number): void {
    param.cancelScheduledValues(0);
    if (points.length === 0) return;
    param.setValueAtTime(gainValueAt(points, from - clipStart), ctxNow); // from 处插值锚点
    for (const p of points) {
      const abs = clipStart + p.t;
      if (abs <= from) continue;
      param.linearRampToValueAtTime(p.value, ctxNow + (abs - from));
    }
  }

  /** PcmData → AudioBuffer 一次性转换（A1：转换后 PcmData 由调用方丢弃，单份驻留） */
  private toBuffer(ctx: AudioContextLike, pcm: PcmData): AudioBufferLike {
    const buf = ctx.createBuffer(pcm.channels.length, pcm.channels[0].length, pcm.sampleRate);
    for (let ch = 0; ch < pcm.channels.length; ch++) buf.getChannelData(ch).set(pcm.channels[ch]);
    return buf;
  }

  private stopSources(): void {
    for (const s of this.sources) { try { s.stop(); } catch { /* 已结束 */ } }
    this.sources = [];
  }

  stop(): void { this.stopSources(); this.timeBase = null; }
  suspend(): void { void this.ctx?.suspend(); }
  resumeCtx(): void { if (this.ctx) void this.ctx.resume(); }
  setMasterVolume(v: number): void {
    this.masterVolume = v;
    if (this.master) this.master.gain.value = v;
  }
  getMasterVolume(): number { return this.masterVolume; }
}

/** 全局单例（决策 7：实例数恒 1，suspend/resume 不 close——AudioContext 上限约 6 的物理保障） */
export const audioEngine = new AudioEngine();
```

- [x] **Step 4: 跑测试 + tsc + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/audio-engine
pnpm -C apps/web exec tsc -b
git add apps/web/src/pages/canvas/video-editor/audio-engine && git commit -m "feat(video-editor): AudioEngine 单例——解码/变速缓存/全量调度/主时钟/资源纪律（TDD）"
```

---

### Task 7: renderer 胶合层——media-blob/image-cache/CanvasRenderer/renderFrameAt

CanvasRenderer 按 spec 测试策略为薄绘制层**不测**；renderFrameAt 依赖注入可测。

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/renderer/media-blob.ts`
- Create: `apps/web/src/pages/canvas/video-editor/renderer/image-cache.ts`
- Create: `apps/web/src/pages/canvas/video-editor/renderer/canvas-renderer.ts`
- Create: `apps/web/src/pages/canvas/video-editor/renderer/render-frame.ts`
- Test: `apps/web/src/pages/canvas/video-editor/renderer/render-frame.test.ts`

- [x] **Step 1: 实现三个小模块（无独立测试——纯缓存/薄层）**

```ts
// apps/web/src/pages/canvas/video-editor/renderer/media-blob.ts
/** 媒体 blob 共享缓存（R2 A3 后服务音频解码与图片 ImageBitmap——视频取帧改 UrlSource 直连不经此，决策 1/13）；
 *  上限 8 个 LRU 淘汰（音频 PCM 与图片通常远小于视频，按个数上限一期够用） */
const cache = new Map<string, Promise<Blob>>();

export async function getMediaBlob(mediaId: string, url: string): Promise<Blob | null> {
  const hit = cache.get(mediaId);
  if (hit) {
    cache.delete(mediaId); cache.set(mediaId, hit); // LRU 触尾
    try { return await hit; } catch { cache.delete(mediaId); return null; }
  }
  const p = fetch(url).then(r => (r.ok ? r.blob() : Promise.reject(new Error(`fetch ${r.status}`))));
  cache.set(mediaId, p);
  if (cache.size > 8) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
  }
  try { return await p; } catch { cache.delete(mediaId); return null; }
}

export function resolveMediaBlob(mediaId: string, url: string | undefined): Promise<Blob | null> {
  return url ? getMediaBlob(mediaId, url) : Promise.resolve(null);
}

export function clearMediaBlobs(): void { cache.clear(); }
```

```ts
// apps/web/src/pages/canvas/video-editor/renderer/image-cache.ts
/** ImageBitmap 缓存（图片片一次解码多次绘制，spec 第六节） */
const cache = new Map<string, Promise<ImageBitmap | null>>();

export function getImageBitmap(mediaId: string, blob: Blob): Promise<ImageBitmap | null> {
  let p = cache.get(mediaId);
  if (!p) {
    p = createImageBitmap(blob).catch(() => null);
    cache.set(mediaId, p);
  }
  return p;
}

export function clearImageBitmaps(): void { cache.clear(); }
```

```ts
// apps/web/src/pages/canvas/video-editor/renderer/canvas-renderer.ts
import type { SubtitleRenderState, VisualRenderState } from '../scene/interpolate';
import { layoutSubtitleLines } from '../scene/subtitle-layout';

export const CANVAS_W = 1920;
export const CANVAS_H = 1080;

export interface VisualLayer {
  source: CanvasImageSource;
  srcW: number; srcH: number;
  state: VisualRenderState;
}
export interface SubtitleLayer { state: SubtitleRenderState; }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 薄绘制层（spec：不测）——1920×1080 合成坐标系；720p 导出由 Plan 4 整体 0.5× ctx.scale。
 *  绘制顺序：黑底 → 视觉层（renderOrder 已由 selectActiveClips 排好）→ overlay 层（toBlack/toWhite 全屏，决策 4）→ 字幕（最后，spec renderOrder）。 */
export class CanvasRenderer {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  draw(visual: VisualLayer[], subtitles: SubtitleLayer[]): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    const overlays: { color: 'black' | 'white'; alpha: number }[] = [];
    for (const l of visual) {
      this.drawVisual(l);
      if (l.state.overlay && l.state.overlay.alpha > 0) overlays.push(l.state.overlay);
    }
    for (const o of overlays) {
      ctx.save();
      ctx.globalAlpha = clamp01(o.alpha);
      ctx.fillStyle = o.color === 'black' ? '#000' : '#FFF';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();
    }
    for (const s of subtitles) this.drawSubtitle(s);
  }

  private drawVisual({ source, srcW, srcH, state }: VisualLayer): void {
    const { transform } = state;
    const contain = Math.min(CANVAS_W / srcW, CANVAS_H / srcH); // contain 居中基准 = scale 1（spec 数据模型默认基准）
    const scale = contain * transform.scale;
    const w = srcW * scale;
    const h = srcH * scale;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = clamp01(state.opacity);
    ctx.translate(CANVAS_W / 2 + transform.x, CANVAS_H / 2 + transform.y);
    if (transform.rotation) ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.drawImage(source, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  private drawSubtitle({ state }: SubtitleLayer): void {
    if (!state.visible || !state.text) return;
    const ctx = this.ctx;
    // G5：字间距参与 measure 与绘制（ctx.letterSpacing Chromium 99+；jsdom/旧浏览器赋值静默无效不抛）
    ctx.save();
    const font = `${state.style.fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.font = font;
    try { (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${state.style.letterSpacing}px`; } catch { /* 不支持则忽略 */ }
    const layout = layoutSubtitleLines(state.text, state.style, (s, f) => { ctx.font = f; return ctx.measureText(s).width; });
    const blockH = layout.lines.length * layout.lineHeight;
    const firstLineCenterY = CANVAS_H - 96 - blockH + layout.lineHeight / 2; // 底边安全边距 96px
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = state.style.color;
    layout.lines.forEach((line, i) => {
      ctx.fillText(line, CANVAS_W / 2, firstLineCenterY + i * layout.lineHeight);
    });
    ctx.restore();
  }
}
```

- [x] **Step 2: 写失败测试（renderFrameAt）**

```ts
// apps/web/src/pages/canvas/video-editor/renderer/render-frame.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderFrameAt, type FrameRenderDeps } from './render-frame';
import type { VideoCacheService, WrappedFrame } from './video-cache';
import type { CanvasRenderer } from './canvas-renderer';
import type { ProjectData, VideoClip } from '../types';

const mkDeps = (over: { frame?: WrappedFrame | null; bitmap?: { width: number; height: number } | null; url?: string } = {}): FrameRenderDeps & { video: { getFrame: ReturnType<typeof vi.fn> }; images: { getImageBitmap: ReturnType<typeof vi.fn> }; getMediaUrl: ReturnType<typeof vi.fn>; getBlob: ReturnType<typeof vi.fn> } => {
  const deps = {
    video: { getFrame: vi.fn(async () => over.frame ?? null) },
    images: { getImageBitmap: vi.fn(async () => over.bitmap ?? null) },
    getMediaUrl: vi.fn(() => over.url ?? 'http://u-mv'),
    getBlob: vi.fn(async () => new Blob(['x'])),
    renderer: { draw: vi.fn() },
  } as unknown as FrameRenderDeps & { video: { getFrame: ReturnType<typeof vi.fn> }; images: { getImageBitmap: ReturnType<typeof vi.fn> }; getMediaUrl: ReturnType<typeof vi.fn>; getBlob: ReturnType<typeof vi.fn> };
  return deps;
};

const vc = (id: string, start: number, duration: number): VideoClip => ({
  id, trackId: 'tv', type: 'video', start, duration, sourceStart: 0, mediaId: 'mv', playbackSpeed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
});
const dataWith = (clips: { id: string; start: number; duration: number; type: 'video' | 'image' | 'subtitle' }[]): ProjectData => {
  const d: ProjectData = {
    version: 1, fps: 30,
    tracks: [{ id: 'tv', type: 'video', name: 'V', muted: false, hidden: false, clips: [] },
             { id: 'ts', type: 'subtitle', name: 'S', muted: false, hidden: false, clips: [] }],
    clips: {},
  };
  for (const c of clips) {
    if (c.type === 'video') { d.clips[c.id] = vc(c.id, c.start, c.duration); d.tracks[0].clips.push(c.id); }
    else if (c.type === 'image') {
      d.clips[c.id] = { id: c.id, trackId: 'tv', type: 'image', start: c.start, duration: c.duration, mediaId: 'mi', transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] };
      d.tracks[0].clips.push(c.id);
    } else {
      d.clips[c.id] = { id: c.id, trackId: 'ts', type: 'subtitle', start: c.start, duration: c.duration, text: '字幕', visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 } };
      d.tracks[1].clips.push(c.id);
    }
  }
  return d;
};

describe('renderFrameAt（单帧渲染编排）', () => {
  it('视频片取帧：url+sourceTime 传给 videoCache，帧 canvas 进 draw', async () => {
    const frame = { canvas: { width: 1920, height: 1080 }, timestamp: 0, duration: 1 } as unknown as WrappedFrame;
    const deps = mkDeps({ frame });
    await renderFrameAt(dataWith([{ id: 'v', start: 0, duration: 5, type: 'video' }]), 2, deps);
    expect(deps.video.getFrame).toHaveBeenCalledWith('mv', 'http://u-mv', 2);
    expect(deps.renderer.draw).toHaveBeenCalledWith(
      [expect.objectContaining({ srcW: 1920, srcH: 1080 })],
      [],
    );
  });
  it('图片片走 imageCache；字幕进 subtitles 数组', async () => {
    const deps = mkDeps({ bitmap: { width: 800, height: 600 } });
    await renderFrameAt(dataWith([
      { id: 'img', start: 0, duration: 5, type: 'image' },
      { id: 'sub', start: 0, duration: 5, type: 'subtitle' },
    ]), 1, deps);
    expect(deps.images.getImageBitmap).toHaveBeenCalledWith('mi', expect.any(Blob));
    const [visual, subs] = (deps.renderer.draw as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(visual).toHaveLength(1);
    expect(subs).toHaveLength(1);
    expect(subs[0].state.text).toBe('字幕');
  });
  it('取帧失败/无 url：层跳过不炸（draw 仍执行）', async () => {
    const deps = mkDeps({ frame: null });
    deps.getMediaUrl = vi.fn(() => undefined); // A3：视频源缺 url 跳过
    await renderFrameAt(dataWith([{ id: 'v', start: 0, duration: 5, type: 'video' }]), 0, deps);
    expect(deps.renderer.draw).toHaveBeenCalledWith([], []);
  });
});
```

- [x] **Step 3: 确认失败 → 实现 render-frame.ts**

```ts
// apps/web/src/pages/canvas/video-editor/renderer/render-frame.ts
import type { ProjectData } from '../types';
import { selectActiveClips } from '../scene/active-clips';
import { interpolateClip, type SubtitleRenderState, type VisualRenderState } from '../scene/interpolate';
import type { SubtitleLayer, VisualLayer } from './canvas-renderer';
import type { WrappedFrame } from './video-cache';

/** deps 全量注入可测。视频片经 UrlSource 取帧（A3——getMediaUrl 直连 presigned URL）；
 *  图片片与未来其他 blob 消费走 getBlob（createImageBitmap 需全量 blob）。 */
export interface FrameRenderDeps {
  video: { getFrame(mediaId: string, url: string, time: number): Promise<WrappedFrame | null> };
  images: { getImageBitmap(mediaId: string, blob: Blob): Promise<ImageBitmap | null> };
  getMediaUrl: (mediaId: string) => string | undefined;
  getBlob: (mediaId: string) => Promise<Blob | null>;
  renderer: { draw(visual: VisualLayer[], subtitles: SubtitleLayer[]): void };
}

/** 单帧渲染编排：selectActiveClips → interpolateClip → 取源（videoCache/imageCache）→ renderer.draw。
 *  deps 全量注入可测；生产装配在 hooks/playback.ts（makeFrameDeps）——renderer 层不 import store，依赖方向由 playback 层承担。 */
export async function renderFrameAt(data: ProjectData, t: number, deps: FrameRenderDeps): Promise<void> {
  const visual: VisualLayer[] = [];
  const subs: SubtitleLayer[] = [];
  for (const { clip } of selectActiveClips(data, t)) {
    const state = interpolateClip(data, clip.id, t);
    if (state.kind === 'subtitle') { subs.push({ state }); continue; }
    if (clip.type === 'image') {
      const blob = await deps.getBlob(clip.mediaId);
      if (!blob) continue;
      const bmp = await deps.images.getImageBitmap(clip.mediaId, blob);
      if (bmp) visual.push({ source: bmp, srcW: bmp.width, srcH: bmp.height, state });
    } else {
      const url = deps.getMediaUrl(clip.mediaId);
      if (!url) continue;
      const frame = await deps.video.getFrame(clip.mediaId, url, (state as { sourceTime: number }).sourceTime!);
      if (frame) visual.push({ source: frame.canvas, srcW: frame.canvas.width, srcH: frame.canvas.height, state });
    }
  }
  deps.renderer.draw(visual, subs);
}
```

- [x] **Step 4: 跑测试 + tsc + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/renderer
pnpm -C apps/web exec tsc -b
git add apps/web/src/pages/canvas/video-editor/renderer && git commit -m "feat(video-editor): renderer 胶合层——media-blob/image-cache/CanvasRenderer/renderFrameAt（TDD）"
```

---

### Task 8: PreviewPlayer + 播放状态机 + 控制条迁移 + playhead 订阅下沉

**Files:**
- Modify: `apps/web/src/pages/canvas/video-editor/store/editorStore.ts`（+playing/preparing/mergeMediaInfo；MediaInfo 扩 url）
- Create: `apps/web/src/pages/canvas/video-editor/hooks/playback.ts`
- Create: `apps/web/src/pages/canvas/video-editor/hooks/usePreviewPlayback.ts`
- Create: `apps/web/src/pages/canvas/video-editor/components/PreviewPlayer.tsx`（替换 PreviewPlaceholder 挂载点）
- Modify: `apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.tsx`（挂 PreviewPlayer + 收起释放）
- Modify: `apps/web/src/pages/canvas/video-editor/components/AssetPanel.tsx`（mediaInfo url 同步）
- Modify: `apps/web/src/pages/canvas/video-editor/components/timeline/TimelinePanel.tsx`（工具行四按钮迁走/playhead 订阅下沉/PlayheadLine）
- Modify: `apps/web/src/pages/canvas/video-editor/components/timeline/TimelineRuler.tsx`（自订阅 playhead + 拖拽 seek）
- Create: `apps/web/src/pages/canvas/video-editor/components/timeline/PlayheadLine.tsx`
- Modify: `apps/web/src/pages/canvas/video-editor/hooks/useEditorKeyboard.ts`（空格 toggle + Delete 分支扩展占位）
- Delete: `apps/web/src/pages/canvas/video-editor/components/PreviewPlaceholder.tsx`
- Test: `apps/web/src/pages/canvas/video-editor/components/PreviewPlayer.test.tsx`

- [x] **Step 1: editorStore 扩展（状态字段——行为已由 playback/hook 承载，store 侧只加纯状态）**

```ts
// editorStore.ts 修改点（类型区 + 初始值 + reset/loadProject）：
export interface MediaInfo { name: string; durationSec: number | undefined; url?: string; }
// State 增加：
  playing: boolean;
  preparing: boolean;
// action 增加：
  setPlaying(v: boolean): void;
  setPreparing(v: boolean): void;
  mergeMediaInfo(entries: Record<string, MediaInfo>): void; // AssetPanel items → url/名称回填（仅填缺失键，不覆盖已有）
// 实现区：
  playing: false,
  preparing: false,
  setPlaying: (v) => set({ playing: v }),
  setPreparing: (v) => set({ preparing: v }),
  mergeMediaInfo: (entries) => set((s) => {
    const next = { ...s.mediaInfo };
    for (const [id, info] of Object.entries(entries)) {
      next[id] = next[id] ? { ...next[id], url: next[id].url ?? info.url } : info;
    }
    return { mediaInfo: next };
  }),
// reset() 与 loadProject() 均补 playing: false, preparing: false
```

- [x] **Step 2: 写失败测试（playback 状态机 + PreviewPlayer 控制条）**

```ts
// apps/web/src/pages/canvas/video-editor/components/PreviewPlayer.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { PreviewPlayer } from './PreviewPlayer';
import { useEditorStore } from '../store/editorStore';
import { createDefaultProjectData, type ProjectData } from '../types';
import { togglePlayback, stopPlayback, seekPlayback } from '../hooks/playback';
import { audioEngine } from '../audio-engine/engine';
import { useVideoEditorStore } from '@/stores/videoEditorStore';

vi.mock('../audio-engine/engine', () => ({
  audioEngine: {
    prepare: vi.fn(async () => { }),
    playFrom: vi.fn(),
    stop: vi.fn(),
    now: vi.fn(() => 0),
    hasPcm: vi.fn(() => true),
    setClockMode: vi.fn(),
    setMasterVolume: vi.fn(),
    suspend: vi.fn(),
    releasePcm: vi.fn(),
  },
}));
vi.mock('../renderer/render-frame', () => ({ renderFrameAt: vi.fn(async () => { }) }));

const ready = (data?: ProjectData) => {
  const d = data ?? createDefaultProjectData();
  d.clips['v1'] = { id: 'v1', trackId: d.tracks[0].id, type: 'video', start: 0, duration: 3, sourceStart: 0, mediaId: 'm1', playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] };
  d.tracks[0].clips.push('v1');
  useEditorStore.setState({ status: 'ready', data: d, projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't', playhead: 0, playing: false, preparing: false });
};

describe('playback 状态机（togglePlayback/stopPlayback/seekPlayback）', () => {
  beforeEach(() => { vi.clearAllMocks(); useEditorStore.getState().reset(); });

  it('toggle：prepare 完成后才 setPlaying(true)（音画同起点，决策 14 流程）', async () => {
    ready();
    await togglePlayback();
    expect(audioEngine.prepare).toHaveBeenCalled();
    expect(useEditorStore.getState().playing).toBe(true);
    expect(useEditorStore.getState().preparing).toBe(false);
  });
  it('toggle 期间再 toggle 被 preparing 门卫挡住', async () => {
    ready();
    let resolvePrepare!: () => void;
    (audioEngine.prepare as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise<void>(r => { resolvePrepare = r; }));
    const first = togglePlayback();
    expect(useEditorStore.getState().preparing).toBe(true);
    await togglePlayback(); // preparing 中——直接返回
    expect(audioEngine.prepare).toHaveBeenCalledTimes(1);
    resolvePrepare();
    await first;
    expect(useEditorStore.getState().playing).toBe(true);
  });
  it('stop：engine.stop + playing=false', async () => {
    ready();
    await togglePlayback();
    stopPlayback();
    expect(audioEngine.stop).toHaveBeenCalled();
    expect(useEditorStore.getState().playing).toBe(false);
  });
  it('seek 播放中：setPlayhead + playFrom 重调度；暂停中只 setPlayhead', async () => {
    ready();
    await togglePlayback();
    seekPlayback(1.5);
    expect(useEditorStore.getState().playhead).toBe(1.5);
    expect(audioEngine.playFrom).toHaveBeenCalled();
    stopPlayback();
    vi.clearAllMocks();
    seekPlayback(2);
    expect(useEditorStore.getState().playhead).toBe(2);
    expect(audioEngine.playFrom).not.toHaveBeenCalled();
  });
});

describe('PreviewPlayer（控制条）', () => {
  beforeEach(() => { vi.clearAllMocks(); useEditorStore.getState().reset(); });

  it('渲染 16:9 画布与控制条：播放/时间码/撤销/重做/分割/删除/音量/全屏/缩放滑杆', () => {
    ready();
    render(<PreviewPlayer />);
    expect(screen.getByTestId('preview-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('preview-play-btn')).toBeInTheDocument();
    expect(screen.getByText('撤销')).toBeInTheDocument();
    expect(screen.getByText('重做')).toBeInTheDocument();
    expect(screen.getByText('分割')).toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
    expect(screen.getByTestId('volume-slider')).toBeInTheDocument();
    expect(screen.getByTestId('zoom-slider')).toBeInTheDocument();
    expect(screen.getByText(/0:03/)).toBeInTheDocument(); // 总长 3s
  });
  it('播放按钮 → togglePlayback；playing 态文案切换', async () => {
    ready();
    render(<PreviewPlayer />);
    fireEvent.click(screen.getByTestId('preview-play-btn'));
    await waitFor(() => expect(useEditorStore.getState().playing).toBe(true));
    expect(screen.getByTestId('preview-play-btn').textContent).toBe('⏸');
  });
  it('删除按钮删选中片段（控制条迁移后行为不丢）', () => {
    ready();
    useEditorStore.getState().selectClip('v1');
    render(<PreviewPlayer />);
    fireEvent.click(screen.getByText('删除'));
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(0);
  });

  it('暂停态：playhead 变化触发单帧渲染（G1/N5——R2 补测；jsdom canvas.getContext 默认 null 须 stub，EraseCanvas 先例）', async () => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ __fake: true }) as unknown as CanvasRenderingContext2D);
    try { // R3 五-5：try/finally 恢复——用例失败不污染同文件后续用例
      ready();
      const { unmount } = render(<PreviewPlayer />);
      const { renderFrameAt } = await import('../renderer/render-frame');
      vi.mocked(renderFrameAt).mockClear();
      act(() => { useEditorStore.getState().setPlayhead(1); });
      await waitFor(() => expect(renderFrameAt).toHaveBeenCalled());
      expect(vi.mocked(renderFrameAt).mock.lastCall?.[1]).toBe(1); // (data, t, deps) 的 t 取最新 playhead
      unmount();
    } finally {
      HTMLCanvasElement.prototype.getContext = orig;
    }
  });
  it('空格键 toggle（useEditorKeyboard 挂载在 TimelinePanel 且需 videoEditorStore.open 门卫放行——R1 审核 B4）', async () => {
    ready();
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' }); // hook 首行 open 门卫（Plan 2 既有行为）
    const { TimelinePanel } = await import('./timeline/TimelinePanel');
    render(<><PreviewPlayer /><TimelinePanel /></>);
    fireEvent.keyDown(document, { key: ' ' });
    await waitFor(() => expect(useEditorStore.getState().playing).toBe(true));
  });
});
```

- [x] **Step 3: 确认失败 → 实现 playback.ts + usePreviewPlayback.ts + PreviewPlayer + 组件修改**

```ts
// apps/web/src/pages/canvas/video-editor/hooks/playback.ts
import { useEditorStore } from '../store/editorStore';
import { audioEngine } from '../audio-engine/engine';
import { totalDuration } from '../timeline/timecode';
import { resolveMediaBlob } from '../renderer/media-blob';
import { videoCache } from '../renderer/video-cache';
import { getImageBitmap, clearImageBitmaps } from '../renderer/image-cache';
import { CanvasRenderer } from '../renderer/canvas-renderer';
import type { FrameRenderDeps } from '../renderer/render-frame';

const clampT = (t: number) => {
  const es = useEditorStore.getState();
  return Math.max(0, Math.min(t, es.data ? totalDuration(es.data) : 0));
};
const resolveBlob = (mediaId: string) => resolveMediaBlob(mediaId, useEditorStore.getState().mediaInfo[mediaId]?.url);

const mediaUrlOf = (mediaId: string) => useEditorStore.getState().mediaInfo[mediaId]?.url;

export function makeFrameDeps(ctx: CanvasRenderingContext2D): FrameRenderDeps {
  return {
    video: videoCache,
    images: { getImageBitmap },
    getMediaUrl: mediaUrlOf, // A3：视频 UrlSource 直连（决策 1）
    getBlob: resolveBlob,    // 图片 ImageBitmap 用（音频解码亦经 resolveBlob）
    renderer: new CanvasRenderer(ctx),
  };
}

export async function togglePlayback(): Promise<void> {
  const es = useEditorStore.getState();
  if (es.status !== 'ready' || !es.data) return;
  if (es.playing) { stopPlayback(); return; }
  if (es.preparing) return;
  es.setPreparing(true);
  try {
    await audioEngine.prepare(es.data, resolveBlob);
  } finally {
    useEditorStore.getState().setPreparing(false);
  }
  useEditorStore.getState().setPlaying(true); // prepare 完成后同起点起播（决策 14）
}

export function stopPlayback(): void {
  audioEngine.stop();
  useEditorStore.getState().setPlaying(false);
}

/** 单击/键盘 seek：setPlayhead + 播放中重锚重排（低频路径，直接 playFrom） */
export function seekPlayback(t: number): void {
  const es = useEditorStore.getState();
  if (!es.data) return;
  const tt = clampT(t);
  es.setPlayhead(tt);
  if (es.playing) audioEngine.playFrom(es.data, tt); // G4：bufferCache 已复用，重排无全量复制
}

// ---- 拖拽 seek 三段式（G4 决策 6②：move 只动播放头，up 才重排）----
let scrubWasPlaying = false;
let scrubActive = false; // R3 五-3：running 守卫——标尺/画布等多 scrub 源交错时防串状态

/** 标尺/画布拖拽开始：播放中则停音频+退 rAF（静音拖拽——决策 6②），仅移动播放头 */
export function scrubBegin(t: number): void {
  const es = useEditorStore.getState();
  if (scrubActive) { // 上一轮未 up（异常路径）——先按上轮状态收口再重入
    if (scrubWasPlaying) es.setPlaying(true);
  }
  scrubActive = true;
  scrubWasPlaying = es.playing;
  if (es.playing) { audioEngine.stop(); es.setPlaying(false); } // rAF 循环随 playing=false 退出
  es.setPlayhead(clampT(t));
}

export function scrubMove(t: number): void {
  if (!scrubActive) return;
  useEditorStore.getState().setPlayhead(clampT(t)); // 纯播放头——G1 暂停态单帧 effect 出画
}

export function scrubEnd(): void {
  if (!scrubActive) return;
  scrubActive = false;
  if (scrubWasPlaying) useEditorStore.getState().setPlaying(true); // effect 内 playFrom(playhead) 重锚（prepare 已缓存幂等）
}

/** 编辑器收起时的运行时释放（spec 边界护栏） */
export function releaseEditorRuntime(): void {
  stopPlayback();
  audioEngine.releasePcm();
  audioEngine.suspend();
  videoCache.release();
  clearImageBitmaps();
}
```

```ts
// apps/web/src/pages/canvas/video-editor/hooks/usePreviewPlayback.ts
import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import { audioEngine } from '../audio-engine/engine';
import { makeFrameDeps } from './playback';
import { renderFrameAt, type FrameRenderDeps } from '../renderer/render-frame';
import { CANVAS_W, CANVAS_H } from '../renderer/canvas-renderer';
import { totalDuration } from '../timeline/timecode';
import type { ProjectData } from '../types';

/** 播放视觉循环 + 暂停态单帧渲染（G1/决策 18）：
 *  renderLatest(deps, data, t) 统一收口两条路径（N5）：pendingRef + latestTRef——in-flight 时只记最新 t、
 *  完成后补渲染一次；否则 scrubMove/拖片段 60Hz 每帧发起全帧渲染（含视频 seek），MediaEntry 串行链排队上百次。
 *  playing=true：起锚（音频由 engine.playFrom 同步起）→ rAF 每帧 engine.now() → setPlayhead → renderLatest（跳帧追赶，决策 15）。
 *  播放中 data 变化（编辑）→ 音频 playFrom **100ms 前沿去抖**重排（A4/决策 6③：transient 60Hz 下不"机器枪"）。
 *  playing=false：依赖 [playhead, data] 单帧渲染——进编辑器即出 playhead 帧（非黑屏）、暂停后 seek/拖标尺即时出画。 */
export function usePreviewPlayback(canvasRef: React.RefObject<HTMLCanvasElement | null>): void {
  const playing = useEditorStore(s => s.playing);
  const playhead = useEditorStore(s => s.playhead);
  const data = useEditorStore(s => s.data);
  const pendingRef = useRef(false);
  const latestTRef = useRef(0);

  const renderLatest = (deps: FrameRenderDeps, d: ProjectData, t: number): void => {
    latestTRef.current = t;
    if (pendingRef.current) return; // in-flight 去重（N5）
    const run = (tt: number): void => {
      pendingRef.current = true;
      renderFrameAt(d, tt, deps).catch(() => {}).finally(() => {
        pendingRef.current = false;
        // R3 §4.2 登记：尾追闭包的 d/deps 是发起那次渲染的（非最新 data）——播放中编辑/暂停拖拽期间可能
        // 以"旧 data + 新 t"补渲一帧，下一 tick/effect 触发自愈（低危，接受）
        if (latestTRef.current !== tt) run(latestTRef.current); // 期间有更新 → 补渲染最新
      });
    };
    run(t);
  };

  // 暂停态单帧（G1）
  useEffect(() => {
    if (playing || !data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    if (canvas.width !== CANVAS_W) { canvas.width = CANVAS_W; canvas.height = CANVAS_H; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderLatest(makeFrameDeps(ctx), data, playhead);
  }, [playing, playhead, data, canvasRef]);

  // 播放循环
  useEffect(() => {
    if (!playing) return;
    const canvas = canvasRef.current;
    const es0 = useEditorStore.getState();
    if (!canvas || !es0.data) return;
    if (canvas.width !== CANVAS_W) { canvas.width = CANVAS_W; canvas.height = CANVAS_H; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const deps = makeFrameDeps(ctx);
    audioEngine.playFrom(es0.data, es0.playhead); // 时钟锚定 + 音频调度
    let raf = 0;
    const tick = () => {
      const s = useEditorStore.getState();
      if (!s.playing || !s.data) return;
      const t = audioEngine.now();
      s.setPlayhead(t);
      const total = totalDuration(s.data);
      if (total > 0 && t >= total) { audioEngine.stop(); s.setPlaying(false); return; }
      renderLatest(deps, s.data, t); // N5：in-flight 去重（跳帧追赶，决策 15）
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // A4/决策 6③：播放中编辑（拖片段 transient 60Hz）重排 100ms 前沿去抖——停止变化后重排一次
    let rescheduleTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useEditorStore.subscribe((s, prev) => {
      if (s.data !== prev.data && s.playing && audioEngine.hasPcm()) {
        if (rescheduleTimer != null) clearTimeout(rescheduleTimer);
        rescheduleTimer = setTimeout(() => {
          rescheduleTimer = null;
          const st = useEditorStore.getState();
          if (st.playing && st.data) audioEngine.playFrom(st.data, audioEngine.now());
        }, 100);
      }
    });
    return () => {
      unsub();
      if (rescheduleTimer != null) clearTimeout(rescheduleTimer);
      cancelAnimationFrame(raf);
      audioEngine.stop();
    };
  }, [playing, canvasRef]);
}
```

```tsx
// apps/web/src/pages/canvas/video-editor/components/PreviewPlayer.tsx
import { useRef } from 'react';
import { Slider, Tooltip } from 'antd';
import { useEditorStore } from '../store/editorStore';
import { usePreviewPlayback } from '../hooks/usePreviewPlayback';
import { togglePlayback, seekPlayback } from '../hooks/playback'; // R3 五-5：stopPlayback 未使用（停止走 togglePlayback 的 playing 分支），删导入
import { audioEngine } from '../audio-engine/engine';
import { formatShortTime, totalDuration } from '../timeline/timecode';

export function PreviewPlayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  usePreviewPlayback(canvasRef);
  const playing = useEditorStore(s => s.playing);
  const preparing = useEditorStore(s => s.preparing);
  const playhead = useEditorStore(s => s.playhead);
  const data = useEditorStore(s => s.data);
  const pxPerSec = useEditorStore(s => s.pxPerSec);
  const setPxPerSec = useEditorStore(s => s.setPxPerSec);
  const total = data ? totalDuration(data) : 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#F7F8FA]">
      {/* 16:9 预览区 */}
      <div ref={containerRef} className="flex-1 min-h-0 flex items-center justify-center p-3">
        <canvas data-testid="preview-canvas" width={1920} height={1080}
          className="bg-black max-w-full max-h-full" style={{ aspectRatio: '16 / 9', width: '100%' }}
          onClick={(e) => { // 点击画布 seek（点击位置→时间）
            const rect = e.currentTarget.getBoundingClientRect();
            seekPlayback(((e.clientX - rect.left) / rect.width) * total);
          }} />
      </div>
      {/* 控制条（spec 第四节：播放/时间码/撤销/重做/分割/删除 + 音量/全屏/缩放滑杆） */}
      <div data-testid="preview-control-bar"
        className="h-11 shrink-0 flex items-center gap-2 px-3 bg-white border-t border-[#E5E7EB] [border-top-style:solid] box-border">
        <button type="button" data-testid="preview-play-btn" disabled={preparing}
          onClick={() => { void togglePlayback(); }}
          className="text-[16px] text-[#1F2329] bg-transparent border-0 cursor-pointer px-2 disabled:opacity-50">
          {preparing ? '…' : playing ? '⏸' : '▶'}
        </button>
        <span className="text-[12px] text-[#1F2329] tabular-nums">
          {formatShortTime(playhead)}
          <span className="text-[#86909C]"> / {formatShortTime(total)}</span>
        </span>
        <span className="text-[#C9CDD4] mx-1">|</span>
        <button type="button" onClick={() => useEditorStore.getState().undo()}
          className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1.5">撤销</button>
        <button type="button" onClick={() => useEditorStore.getState().redo()}
          className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1.5">重做</button>
        <button type="button" title="在播放头处分割选中片段"
          onClick={() => { const es = useEditorStore.getState(); if (es.selectedClipId) es.splitClip(es.selectedClipId, es.playhead); }}
          className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1.5">分割</button>
        <button type="button" title="删除选中片段"
          onClick={() => { const es = useEditorStore.getState(); if (es.selectedClipId) es.removeClip(es.selectedClipId); }}
          className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1.5">删除</button>
        <div className="ml-auto flex items-center gap-3">
          <Tooltip title="音量">
            <Slider data-testid="volume-slider" className="w-20" min={0} max={100} defaultValue={100}
              onChange={(v) => audioEngine.setMasterVolume((v as number) / 100)} />
          </Tooltip>
          <button type="button" title="全屏"
            onClick={() => { const el = containerRef.current; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen?.(); }}
            className="text-[14px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1.5">⛶</button>
          <Tooltip title="时间轴缩放">
            <Slider data-testid="zoom-slider" className="w-24" min={10} max={500} value={pxPerSec}
              onChange={(v) => setPxPerSec(v as number)} />
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
```

其余修改点（精确到行为，执行者按现码对齐）：

- **VideoEditorShell.tsx**：① `<PreviewPlaceholder />` 替换为 `<PreviewPlayer />`（删 PreviewPlaceholder.tsx 文件与其 import）；右列占位 span 替换为 `<PropertiesPanel />`（Task 10 实现——本 task 先建最小占位 `export function PropertiesPanel() { return <div data-testid="properties-panel" className="w-[280px] shrink-0 border-l border-[#E5E7EB] [border-left-style:solid] bg-white" />; }` 防 import 断裂，Task 10 完整化）。② `handleClose` 内 flush 完成后、`close()` 之前调 `releaseEditorRuntime()`（import 自 hooks/playback）。③ 底部 `TimelinePanel` 之前的中列结构保持。
- **AssetPanel.tsx**：`useWorkflowAssets` 的 items 就绪后同步 mediaInfo——组件体内 `useEffect(() => { if (items.length) useEditorStore.getState().mergeMediaInfo(Object.fromEntries(items.map(i => [i.mediaId, { name: i.originalName, durationSec: i.nodeDurationSec ?? (i.metadata as { durationSec?: number })?.durationSec, url: i.url }]))); }, [items])`（含既有工程重开的 url 回填，决策 13）；R6 import 前置：现码 L1 仅 `import { useState } from 'react';`——改 `import { useEffect, useState } from 'react';`。
- **TimelinePanel.tsx**：⓪ 头部 import 改 `import { useEffect, useMemo, useRef, useState } from 'react';`（R5：现码 L1 仅 `{ useEffect, useRef }`——⑤ 的 useState 与 Task 13 的 useMemo 一次到位，落地即改防两处分别踩 TS2304）；① 删除 `playhead` 订阅与贯穿竖线渲染（抽 PlayheadLine；**B7 连带**：L191 `onSubtitleAdd={(trackId) => ...addSubtitleClip(trackId, playhead)}` 的闭包 playhead 随订阅删除变未定义——改 `useEditorStore.getState().playhead`）；② 工具行删除 撤销/重做/分割/删除 四按钮（迁 PreviewPlayer），保留 +视频轨/+音频轨/pxPerSec 显示；③ 滚动区内容末尾（轨道列表后）追加 `<PlayheadLine />`（**R4 无 props 化**：原 data/widthPx 仅喂未被使用的滚动内容宽 w——死代码删除；left = 140 + playhead 换算 px，放滚动内容 wrapper 内与 Ruler 同坐标系、140px 轨道头偏移几何一致，render.test 的 playhead-line testid 不变）；④ TrackRow 导出改 memo 化（R6：现码 L1 无任何 react import——补 `import { memo } from 'react';`，照 ClipBlock.tsx:19 既有具名内部函数风格 `export const TrackRow = memo(function TrackRow({ ... }: TrackRowProps) { ... })` 保留组件名；Task 11/13 新增 props 后续照常并入签名）；⑤ **G9（Plan 2 M2 正式接）**：viewportW 经 ResizeObserver 维护 state——panel 不再订阅 playhead 后播放期间无每帧重渲，`scrollRef.current?.clientWidth` 直读会停在首帧值：

```tsx
  const [viewportW, setViewportW] = useState(940);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewportW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Ruler 的 widthPx 传参改 viewportW - 140（test-setup.ts 已有 ResizeObserver mock；PlayheadLine 无 props 化后不依赖 widthPx）
```

- **TimelineRuler.tsx**：playhead 改组件内自订阅 `const playhead = useEditorStore(s => s.playhead)`（props 删 playhead，调用方 TimelinePanel 同步删传参）；R6 import 前置：补 `import { useEditorStore } from '../../store/editorStore';`（现码 L1-5 无 store import），scrub 改造删原 handlePointer 后 L3 `import { quantizeTime } from '../../timeline/clip-math';` 成孤儿一并删（量化不丢：setPlayhead 内部本就 quantizeTime，editorStore.ts:131；tsconfig.base 无 noUnusedLocals 非编译红线，按 CLAUDE.md 精准修改清孤儿）；既有 `import type React from 'react'`（L5）已支持新 handler 的 React.PointerEvent 注解——现码 L24 先例，无需补值 import；pointer 拖拽改 **scrub 三段式（G4/决策 6②：move 只动播放头，up 才重排音频——标尺拖拽高频 playFrom 的分配灾难封堵）**：

```tsx
import { scrubBegin, scrubMove, scrubEnd } from '../../hooks/playback';
  const timeAt = (clientX: number, el: HTMLElement) =>
    Math.max(0, pxToTime(clientX - el.getBoundingClientRect().left, pxPerSec));
  // N6：jsdom 无 PointerCapture API（仓内既有风格 setPointerCapture?.——TimelinePanel L50）；hasPointerCapture 可选链 + ?? false
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrubBegin(timeAt(e.clientX, e.currentTarget as HTMLElement));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId) ?? false) scrubMove(timeAt(e.clientX, e.currentTarget as HTMLElement));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId) ?? false) scrubEnd();
  };
  // JSX：onPointerDown/onPointerMove/onPointerUp 三挂（原 onSeek prop 删除）
```

- **既有测试迁移清单（R1 审核 B6——除 TimelinePanel.render.test.tsx 第 4 用例外还有两处必红）**：① `TimelinePanel.interact.test.tsx` 的"分割按钮"（L100 附近 getByText('分割')）与"删除按钮"两用例——渲染处 `render(<TimelinePanel />)` 改 `render(<><PreviewPlayer /><TimelinePanel /></>)`（PreviewPlayer.test.tsx 同目录 import），四按钮断言不动；② `VideoEditorShell.test.tsx` 的 `getByTestId('preview-placeholder')` 断言改 `getByTestId('preview-canvas')`（Shell 测试已 vi.mock videoProjectApi，PreviewPlayer 组件挂载无网络请求、playing=false 无 effect 副作用，安全）。

```tsx
// apps/web/src/pages/canvas/video-editor/components/timeline/PlayheadLine.tsx
import { useEditorStore } from '../../store/editorStore';
import { timeToPx } from '../../timeline/view-scale';

/** 贯穿播放头竖线（自订阅——30fps 播放头更新不重渲轨道行，决策 14/M4；R4 无 props 化：删除未被使用的滚动内容宽计算） */
export function PlayheadLine() {
  const playhead = useEditorStore(s => s.playhead);
  const pxPerSec = useEditorStore(s => s.pxPerSec);
  return (
    <div data-testid="playhead-line" className="absolute top-0 bottom-0 w-0.5 bg-[#6C5CE7] pointer-events-none z-10"
      style={{ left: 140 + timeToPx(playhead, pxPerSec) }} />
  );
}
```

- **useEditorKeyboard.ts**：空格分支从"仅 preventDefault"改为 `e.preventDefault(); void togglePlayback();`（import playback——决策 9，避免 hook 依赖组件）。

- [x] **Step 4: 跑测试 + tsc + 全量回归 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/components/PreviewPlayer.test.tsx src/pages/canvas/video-editor/components/timeline
# 预期: 新用例 PASS + 既有测试迁移按上方"既有测试迁移清单（B6）"三处执行：render.test 第 4 用例四按钮断言迁移/删除、interact.test 分割/删除两用例补渲染 PreviewPlayer、Shell.test preview-placeholder 断言改 preview-canvas
pnpm -C apps/web exec tsc -b
pnpm -C apps/web test
git add apps/web/src && git commit -m "feat(video-editor): 预览播放器——播放状态机/rAF 跳帧追赶/控制条迁移/主时钟（TDD）"
```

---

### Task 9: 节点本体迷你播放（资源纪律五条）

**Files:**
- Modify: `apps/web/src/stores/videoEditorStore.ts`（+miniPlaybackNodeId）
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoEditNode.tsx`（播放激活 + 迷你画布 + 互斥/IO/selected 释放）
- Test: `apps/web/src/pages/canvas/components/nodes/VideoEditNode.miniplay.test.tsx`

- [x] **Step 1: videoEditorStore 扩展**

```ts
// stores/videoEditorStore.ts 全量替换（在既有三字段上加迷你播放单播放态，决策 10）：
import { create } from 'zustand';

interface VideoEditorState {
  open: boolean;
  sourceNodeId: string | null;
  closedAt: number;
  /** 全局同时只播一个剪辑节点（资源纪律①：播 B 停 A） */
  miniPlaybackNodeId: string | null;
  openEditor: (sourceNodeId: string) => void;
  close: () => void;
  startMiniPlayback: (nodeId: string) => void;
  stopMiniPlayback: () => void;
}

export const useVideoEditorStore = create<VideoEditorState>((set) => ({
  open: false,
  sourceNodeId: null,
  closedAt: 0,
  miniPlaybackNodeId: null,
  openEditor: (sourceNodeId) => set({ open: true, sourceNodeId, miniPlaybackNodeId: null }), // 全屏打开即停全部迷你播放（资源纪律④）
  close: () => set((s) => ({ open: false, closedAt: s.closedAt + 1 })),
  startMiniPlayback: (nodeId) => set({ miniPlaybackNodeId: nodeId }),
  stopMiniPlayback: () => set({ miniPlaybackNodeId: null }),
}));
```

（既有测试引用 `useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0 })`——新增字段有默认值，setState 部分更新不破。）

- [x] **Step 2: 写失败测试**

```tsx
// apps/web/src/pages/canvas/components/nodes/VideoEditNode.miniplay.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { VideoEditNode } from './VideoEditNode';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { audioEngine } from '@/pages/canvas/video-editor/audio-engine/engine';
import type { ProjectData } from '@/pages/canvas/video-editor/types';

vi.mock('@/api/videoProjectApi', () => ({ getProjectByNode: vi.fn() }));
import { getProjectByNode } from '@/api/videoProjectApi';
vi.mock('@/api/mediaApi', () => ({ batchGetMedia: vi.fn(async () => []) })); // G10：loadMediaUrls 不发真 fetch
// 决策 16 后组件不 import audioEngine——无 engine mock（playback.ts 的 engine 依赖也不在本组件链上）
vi.mock('@/pages/canvas/video-editor/renderer/render-frame', () => ({ renderFrameAt: vi.fn(async () => { }) })); // 播放循环隔离（rAF polyfill 下 renderFrameAt 空转，mini-canvas 存续由 t<total 保证）
vi.mock('@/pages/canvas/video-editor/renderer/video-cache', () => ({ videoCache: { release: vi.fn() } }));
vi.mock('@/pages/canvas/video-editor/renderer/image-cache', () => ({ clearImageBitmaps: vi.fn(), getImageBitmap: vi.fn(async () => null) }));

const props = (id = 'n1', selected = false) => ({ id, selected, dragging: false }) as any;
const data = (): ProjectData => {
  const d: ProjectData = { version: 1, fps: 30, tracks: [{ id: 'tv', type: 'video', name: 'V', muted: false, hidden: false, clips: ['c1'] }],
    clips: { c1: { id: 'c1', trackId: 'tv', type: 'video', start: 0, duration: 3, sourceStart: 0, mediaId: 'm1', playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] } } };
  return d;
};

// IntersectionObserver mock（jsdom/本仓均无——研究 §8）
const observeMock = vi.fn();
const unobserveMock = vi.fn();
class IO {
  constructor(private cb: IntersectionObserverCallback) {}
  observe = observeMock;
  unobserve = unobserveMock;
  disconnect = vi.fn();
  trigger(isVisible: boolean) { this.cb([{ isIntersecting: isVisible } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
}

describe('VideoEditNode 迷你播放（资源纪律）', () => {
  let ioInstances: IO[];
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('VideoDecoder', function () {});
    vi.stubGlobal('AudioDecoder', function () {});
    vi.stubGlobal('OffscreenCanvas', function () {});
    ioInstances = [];
    vi.stubGlobal('IntersectionObserver', class extends IO { constructor(cb: IntersectionObserverCallback) { super(cb); ioInstances.push(this); } });
    useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0, miniPlaybackNodeId: null });
    vi.mocked(getProjectByNode).mockResolvedValue({ id: 'p1', data: data() } as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderNode = (selected = false) => render(<ReactFlowProvider><VideoEditNode {...props('n1', selected)} /></ReactFlowProvider>);

  it('播放按钮激活：点击 → startMiniPlayback(本节点) + 本地播放态', async () => {
    renderNode();
    await waitFor(() => expect(screen.getByTestId('node-track-thumb')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('node-play-btn'));
    expect(useVideoEditorStore.getState().miniPlaybackNodeId).toBe('n1');
    expect(screen.getByTestId('node-mini-canvas')).toBeInTheDocument(); // 播放时显示迷你画布
  });

  it('互斥：miniPlaybackNodeId 指向其他节点 → 本地停止', async () => {
    renderNode();
    await waitFor(() => expect(screen.getByTestId('node-track-thumb')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('node-play-btn'));
    useVideoEditorStore.getState().startMiniPlayback('other-node'); // 播 B
    await waitFor(() => expect(screen.queryByTestId('node-mini-canvas')).not.toBeInTheDocument());
    expect(screen.getByTestId('node-play-btn').textContent).toBe('▶');
  });

  it('全屏编辑打开 → 迷你播放停止（资源纪律④）', async () => {
    renderNode();
    await waitFor(() => expect(screen.getByTestId('node-track-thumb')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('node-play-btn'));
    useVideoEditorStore.getState().openEditor('n1');
    await waitFor(() => expect(screen.queryByTestId('node-mini-canvas')).not.toBeInTheDocument());
  });

  it('移出视口（IO 不可见）→ 停止 + videoCache.release（资源纪律③）', async () => {
    const { videoCache } = await import('@/pages/canvas/video-editor/renderer/video-cache');
    renderNode();
    await waitFor(() => expect(ioInstances.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId('node-play-btn'));
    (ioInstances[0] as IO).trigger(false); // 移出视口
    await waitFor(() => expect(screen.queryByTestId('node-mini-canvas')).not.toBeInTheDocument());
    expect(videoCache.release).toHaveBeenCalled();
  });

  it('取消选中（selected prop 变 false）→ 停止（资源纪律③）', async () => {
    const { rerender } = render(<ReactFlowProvider><VideoEditNode {...props('n1', true)} /></ReactFlowProvider>);
    await waitFor(() => expect(screen.getByTestId('node-track-thumb')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('node-play-btn'));
    rerender(<ReactFlowProvider><VideoEditNode {...props('n1', false)} /></ReactFlowProvider>);
    await waitFor(() => expect(screen.queryByTestId('node-mini-canvas')).not.toBeInTheDocument());
  });
});
```

- [x] **Step 3: 确认失败 → 实现 VideoEditNode 迷你播放**

VideoEditNode.tsx 修改（保持既有 缩略/refetch/capabilities 逻辑不动，增量如下——完整播放控制块）：

```tsx
// 顶部新增 import（B8：现码 L2 为 `import { memo, useEffect, useState } from 'react'` ——需扩为含 useRef；
//   B2：FrameRenderDeps 定义在 renderer/render-frame.ts 非 canvas-renderer.ts，分开 import）：
import { useRef } from 'react'; // 并入现有 react import 行
import { renderFrameAt } from '@/pages/canvas/video-editor/renderer/render-frame';
import type { FrameRenderDeps } from '@/pages/canvas/video-editor/renderer/render-frame';
import { videoCache } from '@/pages/canvas/video-editor/renderer/video-cache';
import { clearImageBitmaps, getImageBitmap } from '@/pages/canvas/video-editor/renderer/image-cache';
import { resolveMediaBlob } from '@/pages/canvas/video-editor/renderer/media-blob';
import { CanvasRenderer, CANVAS_W, CANVAS_H } from '@/pages/canvas/video-editor/renderer/canvas-renderer';
import { batchGetMedia } from '@/api/mediaApi';

// 组件体内新增（结构上：miniPlaying 本地态 + miniNodeId 订阅 + selected/IO/open 副作用 + 播放按钮替换 + 播放态渲染迷你画布替代缩略区）：
  const miniNodeId = useVideoEditorStore(s => s.miniPlaybackNodeId);
  const [miniPlaying, setMiniPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const miniPlayingRef = useRef(false); // IO/selected 回调读最新值
  miniPlayingRef.current = miniPlaying;
  const rafRef = useRef(0); // B8：上提至 stopMini 之前（引用顺序即声明顺序，防执行者困惑）
  const projectDataRef = useRef<ProjectData | null>(null); // N2：释放入口读最新工程数据（IO effect deps:[] 闭包捕获的是首渲染 null）
  projectDataRef.current = projectData;
  // N2：IO effect deps:[] 捕获首渲染闭包 → 三个释放入口统一走 ref 取最新实例
  const stopMiniRef = useRef<() => void>(() => {});
  stopMiniRef.current = () => {
    setMiniPlaying(false);
    cancelAnimationFrame(rafRef.current);
    // 资源纪律③：释放本工程解码与帧缓存（mediaIds 从最新 projectData 派生）；无音频故不碰 audioEngine（决策 16）
    const pd = projectDataRef.current;
    const mids = new Set(pd ? Object.values(pd.clips).map(c => c.mediaId) : []);
    for (const m of mids) videoCache.release(m);
    clearImageBitmaps();
    if (useVideoEditorStore.getState().miniPlaybackNodeId === id) useVideoEditorStore.getState().stopMiniPlayback();
  };
  const stopMini = () => stopMiniRef.current();

  const startMini = async () => {
    if (!projectData || !canPreview) return;
    useVideoEditorStore.getState().startMiniPlayback(id); // 播 B 停 A（他节点经 miniNodeId 副责停）
    setMiniPlaying(true); // R4：置位必须先于 await——fireEvent.click 是同步 act，只 flush React 队列不 flush 用户 promise 续体，置位若在 await 后则点击返回时 miniPlaying 仍 false（用例 1 的画布断言/用例 4 的 IO 回调读 ref 同根因必红）；先置位=点击即时进播放态，URL 晚到首帧黑底、tick 每帧重读 mediaUrlsRef 到达后自动出画
    if (mediaUrlsRef.current.size === 0) await loadMediaUrls(); // ref 已填充则跳过（R2：省重复 RTT 与重复签 URL）
  };

  // 互斥：他节点接管 → 停
  useEffect(() => { if (miniPlaying && miniNodeId !== id) stopMini(); }, [miniNodeId]);
  // 取消选中 → 停
  useEffect(() => { if (!selected && miniPlaying) stopMini(); }, [selected]);
  // IO 视口监听（资源纪律③）——回调经 stopMiniRef 取最新闭包（N2）
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting && miniPlayingRef.current) stopMiniRef.current();
    });
    io.observe(root);
    return () => io.disconnect();
  }, []);
  // R4：卸载清理——节点删除/画布卸载时若在播：停播并释放（videoCache 条目与 ImageBitmap 不残留到 LRU/收起才回收）；deps:[] 经 ref 取最新闭包（N2 同款）
  useEffect(() => () => { if (miniPlayingRef.current) stopMiniRef.current(); }, []);
  // 迷你播放媒体源解析：工程 clips 的 mediaId 集合 → batchGetMedia 批查 presigned url（节点场景无 mediaInfo，决策 10 配套）
  const mediaUrlsRef = useRef<Map<string, string>>(new Map());
  const loadMediaUrls = async () => {
    if (!projectData) return;
    const fileIds = [...new Set(Object.values(projectData.clips).map(c => c.mediaId))];
    if (fileIds.length === 0) return;
    try {
      const rows = await batchGetMedia(fileIds);
      mediaUrlsRef.current = new Map(rows.map(r => [r.id, r.url]));
    } catch { /* 静默：无源则黑底播放 */ }
  };
  const resolveMiniBlob = (mediaId: string) => resolveMediaBlob(mediaId, mediaUrlsRef.current.get(mediaId));

  // 播放循环（perf 时钟本地推进——决策 16：无音频，不建 AudioContext 不锚 engine；与编辑器同构但数据源是本地 projectData）
  useEffect(() => {
    if (!miniPlaying || !projectData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = CANVAS_W; canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const deps: FrameRenderDeps = {
      video: videoCache,
      images: { getImageBitmap },
      getMediaUrl: (mediaId) => mediaUrlsRef.current.get(mediaId), // A3：UrlSource 直连
      getBlob: resolveMiniBlob, // 图片 ImageBitmap 用
      renderer: new CanvasRenderer(ctx),
    };
    let t0 = performance.now() / 1000;
    let pending = false;
    const tick = () => {
      const t = (performance.now() / 1000) - t0;
      const total = totalDuration(projectData);
      if (t >= total) { stopMini(); return; }
      if (!pending) { pending = true; renderFrameAt(projectData, t, deps).catch(() => {}).finally(() => { pending = false; }); }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [miniPlaying, projectData]);
```

播放按钮（替换 Plan 2 的 disabled 占位）：

```tsx
          <button type="button" data-testid="node-play-btn"
            disabled={!canPreview || !projectData}
            onClick={() => { if (miniPlaying) stopMini(); else void startMini(); }}
            className={`text-[12px] bg-transparent border-0 px-1 ${canPreview && projectData ? 'text-[#6C5CE7] cursor-pointer' : 'text-[#C9CDD4] cursor-not-allowed'}`}>
            {miniPlaying ? '⏸' : '▶'}
          </button>
```

根元素挂 ref（R4 必红②：rootRef 已声明且被 IO effect 读取，但增量 JSX 无任何一处挂载 → rootRef.current 恒 null、IO effect 永远早退——用例 4 的 ioInstances 断言超时，且资源纪律③"移出视口释放"真机整体失效）——现码 L48 根元素改：

```tsx
    <div ref={rootRef} className="relative canvas-node" data-testid={`video-edit-node-${id}`}>
```

播放态渲染（轨道缩略区条件替换）：

```tsx
        {miniPlaying ? (
          <div className="px-3 pb-3">
            <canvas data-testid="node-mini-canvas" ref={canvasRef}
              className="w-full bg-black rounded-md" style={{ aspectRatio: '16 / 9' }} />
          </div>
        ) : (
          /* 既有轨道缩略 JSX 原样 */
        )}
```

- [x] **Step 4: 跑测试 + 既有 VideoEditNode 测试回归 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/components/nodes/VideoEditNode.miniplay.test.tsx src/pages/canvas/components/nodes/VideoEditNode.test.tsx
# 预期: 新 5 PASS + 既有用例回归（播放按钮从 disabled 变 enabled——既有用例若断言 disabled 需同步：Plan 2 用例未断言播放按钮，核对后无碍则不动）
pnpm -C apps/web exec tsc -b
git add apps/web/src && git commit -m "feat(video-editor): 节点迷你播放——单播放互斥/IO 视口释放/selected 停止/复用全局 engine（TDD）"
```

---

### Task 10: editorStore 关键帧 action + PropertiesPanel 右面板四态

**Files:**
- Modify: `apps/web/src/pages/canvas/video-editor/store/editorStore.ts`（+addKeyframe/removeKeyframe/moveKeyframe）
- Create: `apps/web/src/pages/canvas/video-editor/components/PropertiesPanel.tsx`（替换 Task 8 占位）
- Test: `apps/web/src/pages/canvas/video-editor/store/editorStore.keyframe.test.ts` + `components/PropertiesPanel.test.tsx`

- [x] **Step 1: 写失败测试（store keyframe actions）**

```ts
// apps/web/src/pages/canvas/video-editor/store/editorStore.keyframe.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editorStore';
import { createDefaultProjectData, type ProjectData } from '../types';

const ready = (d?: ProjectData) => {
  const data = d ?? createDefaultProjectData();
  useEditorStore.setState({ status: 'ready', data, projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't', playhead: 0 });
  return data;
};
const addVideo = () => {
  const d = useEditorStore.getState().data!;
  return useEditorStore.getState().addClip({ type: 'video', mediaId: 'm1', trackId: d.tracks[0].id, start: 0 })!;
};

describe('keyframe actions（spec 第四节关键帧 UI 支撑）', () => {
  beforeEach(() => useEditorStore.getState().reset());

  it('addKeyframe：播放头处添加当前插值值关键帧（t 局部坐标）', () => {
    ready();
    const id = addVideo(); // duration 5（mediaInfo 缺省）
    useEditorStore.getState().setPlayhead(2);
    const kfId = useEditorStore.getState().addKeyframe(id, 'scale');
    expect(kfId).toBeTruthy();
    const clip = useEditorStore.getState().data!.clips[id] as any;
    expect(clip.keyframes).toHaveLength(1);
    expect(clip.keyframes[0]).toMatchObject({ t: 2, property: 'scale', value: 1 }); // 当前显示值
  });
  it('addKeyframe 幂等：±半帧内已有同属性关键帧返回既有 id', () => {
    ready();
    const id = addVideo();
    useEditorStore.getState().setPlayhead(2);
    const a = useEditorStore.getState().addKeyframe(id, 'scale')!;
    const b = useEditorStore.getState().addKeyframe(id, 'scale')!;
    expect(a).toBe(b);
    expect((useEditorStore.getState().data!.clips[id] as any).keyframes).toHaveLength(1);
  });
  it('addKeyframe 音频片 volume 通道（VolumeKeyframe 无 property 字段）', () => {
    ready();
    const d = useEditorStore.getState().data!;
    const auId = useEditorStore.getState().addClip({ type: 'audio', mediaId: 'ma', trackId: d.tracks.find(t => t.type === 'audio')!.id, start: 0 })!;
    useEditorStore.getState().setPlayhead(1);
    const kfId = useEditorStore.getState().addKeyframe(auId, 'volume');
    const clip = useEditorStore.getState().data!.clips[auId] as any;
    expect(clip.keyframes[0]).toMatchObject({ t: 1, value: 1 });
    expect('property' in clip.keyframes[0]).toBe(false);
  });
  it('addKeyframe 类型不匹配（音频片加 transform 属性/视频片加 volume）→ null', () => {
    ready();
    const d = useEditorStore.getState().data!;
    const id = addVideo();
    const auId = useEditorStore.getState().addClip({ type: 'audio', mediaId: 'ma', trackId: d.tracks.find(t => t.type === 'audio')!.id, start: 0 })!;
    expect(useEditorStore.getState().addKeyframe(auId, 'scale')).toBeNull();
    expect(useEditorStore.getState().addKeyframe(id, 'volume')).toBeNull();
  });
  it('removeKeyframe / moveKeyframe（clamp [0,duration] + 量化 + transient）', () => {
    ready();
    const id = addVideo(); // duration 5
    useEditorStore.getState().setPlayhead(1);
    const kfId = useEditorStore.getState().addKeyframe(id, 'scale')!;
    expect(useEditorStore.getState().moveKeyframe(id, kfId, 99, { transient: true })).toBe(true);
    expect((useEditorStore.getState().data!.clips[id] as any).keyframes[0].t).toBe(5); // clamp duration
    useEditorStore.getState().removeKeyframe(id, kfId);
    expect((useEditorStore.getState().data!.clips[id] as any).keyframes).toHaveLength(0);
  });
  it('moveKeyframe transient 不入历史（拖拽 rAF），removeKeyframe 入历史', () => {
    ready();
    const id = addVideo();
    useEditorStore.getState().setPlayhead(1);
    const kfId = useEditorStore.getState().addKeyframe(id, 'scale')!;
    const depth = useEditorStore.getState().history.past.length;
    useEditorStore.getState().moveKeyframe(id, kfId, 2, { transient: true });
    expect(useEditorStore.getState().history.past.length).toBe(depth);
    useEditorStore.getState().removeKeyframe(id, kfId);
    expect(useEditorStore.getState().history.past.length).toBe(depth + 1);
  });
  it('字幕片 addKeyframe → null（无关键帧语义）', () => {
    ready();
    const d = useEditorStore.getState().data!;
    const subId = useEditorStore.getState().addSubtitleClip(d.tracks.find(t => t.type === 'subtitle')!.id, 0);
    expect(useEditorStore.getState().addKeyframe(subId, 'scale')).toBeNull();
  });
});
```

- [x] **Step 2: 确认失败 → 实现 store actions（editorStore.ts 增量）**

```ts
// editorStore.ts 顶部 import 增量：
import { keyframeValueAt, interpolateTransform } from '../scene/interpolate';
import { quantizeTime } from '../timeline/clip-math'; // 已有则跳过
import type { TransformKeyframe, VolumeKeyframe } from '../types'; // 已有则跳过

// State 接口增加：
  addKeyframe(clipId: string, property: TransformKeyframe['property'] | 'volume'): string | null;
  removeKeyframe(clipId: string, kfId: string): void;
  moveKeyframe(clipId: string, kfId: string, t: number, opts?: { transient?: boolean }): boolean;

// 实现区增加（updateClip 之后；全部走既有 commit/transient 闭包内联——R4：消除 commitClipPatch 假助手与"勿新增助手函数"注解的自相矛盾）：
```ts
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
```

- [x] **Step 3: 写失败测试（PropertiesPanel 四态）→ 实现**

```tsx
// apps/web/src/pages/canvas/video-editor/components/PropertiesPanel.test.tsx 核心用例（写入文件）：
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PropertiesPanel } from './PropertiesPanel';
import { useEditorStore } from '../store/editorStore';
import { createDefaultProjectData } from '../types';

const readyWith = (make: (d: ReturnType<typeof createDefaultProjectData>) => string) => {
  const d = createDefaultProjectData();
  const clipId = make(d);
  useEditorStore.setState({ status: 'ready', data: d, projectId: 'p1', sourceNodeId: 'e1', baseUpdatedAt: 't', playhead: 0 });
  useEditorStore.getState().selectClip(clipId);
};
const videoClip = (d: ReturnType<typeof createDefaultProjectData>) => {
  const id = 'v1';
  d.clips[id] = { id, trackId: d.tracks[0].id, type: 'video', start: 0, duration: 5, sourceStart: 0, mediaId: 'm1', playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [], transitionIn: undefined, transitionOut: undefined };
  d.tracks[0].clips.push(id);
  return id;
};
const audioClip = (d: ReturnType<typeof createDefaultProjectData>) => {
  const id = 'a1';
  d.clips[id] = { id, trackId: d.tracks[2].id, type: 'audio', start: 0, duration: 5, sourceStart: 0, mediaId: 'ma', volume: 1, fade: { in: 0, out: 0 }, playbackSpeed: 1, keyframes: [] };
  d.tracks[2].clips.push(id);
  return id;
};
const subClip = (d: ReturnType<typeof createDefaultProjectData>) => {
  const id = 's1';
  d.clips[id] = { id, trackId: d.tracks[1].id, type: 'subtitle', start: 0, duration: 3, text: '旧文本', visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 } };
  d.tracks[1].clips.push(id);
  return id;
};

describe('PropertiesPanel 四态', () => {
  beforeEach(() => useEditorStore.getState().reset());

  it('未选中 → 空态', () => {
    useEditorStore.setState({ status: 'ready', data: createDefaultProjectData(), projectId: 'p1', sourceNodeId: 'e1', baseUpdatedAt: 't' });
    render(<PropertiesPanel />);
    expect(screen.getByTestId('properties-empty')).toBeInTheDocument();
  });
  it('视频态：transform 五输入 + 速度 + 转场 + 秒表；改 x → updateClip', () => {
    readyWith(videoClip);
    render(<PropertiesPanel />);
    expect(screen.getByLabelText('x')).toBeInTheDocument();
    expect(screen.getByLabelText('播放速度')).toBeInTheDocument();
    expect(screen.getByText('入场转场')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('x'), { target: { value: '100' } });
    expect((useEditorStore.getState().data!.clips['v1'] as any).transform.x).toBe(100);
  });
  it('视频态秒表：播放头处无关键帧点击添加、有关键帧点击删除', () => {
    readyWith(videoClip);
    useEditorStore.getState().setPlayhead(1);
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByTestId('stopwatch-scale'));
    expect((useEditorStore.getState().data!.clips['v1'] as any).keyframes).toHaveLength(1);
    fireEvent.click(screen.getByTestId('stopwatch-scale'));
    expect((useEditorStore.getState().data!.clips['v1'] as any).keyframes).toHaveLength(0);
  });
  it('音频态：音量/fade/速度；改音量 → updateClip', () => {
    readyWith(audioClip);
    render(<PropertiesPanel />);
    fireEvent.change(screen.getByLabelText('音量'), { target: { value: '0.5' } });
    expect((useEditorStore.getState().data!.clips['a1'] as any).volume).toBe(0.5);
  });
  it('字幕态：文本/显示开关/字号/颜色/字间距', () => {
    readyWith(subClip);
    render(<PropertiesPanel />);
    fireEvent.change(screen.getByLabelText('字幕文本'), { target: { value: '新文本' } });
    expect((useEditorStore.getState().data!.clips['s1'] as any).text).toBe('新文本');
    expect(screen.getByLabelText('显示字幕')).toBeInTheDocument();
  });
});
```

PropertiesPanel 实现（一个文件四态分区；`updateClip` 全部走浅 merge；秒表按钮 active=播放头处该属性存在关键帧）：

```tsx
// apps/web/src/pages/canvas/video-editor/components/PropertiesPanel.tsx（替换 Task 8 占位）
import { InputNumber, Slider, Switch, Select, Segmented } from 'antd';
import { useEditorStore } from '../store/editorStore';
import type { AudioClip, SubtitleClip, VideoClip, ImageClip, Transform } from '../types';

const TRANSITION_TYPES = [
  { value: 'fadeIn', label: '淡入' }, { value: 'fadeOut', label: '淡出' },
  { value: 'crossfade', label: '交叉淡化' }, { value: 'toBlack', label: '渐黑' }, { value: 'toWhite', label: '渐白' },
];

function StopwatchButton({ clip, property, label }: { clip: VideoClip | ImageClip; property: 'x' | 'y' | 'scale' | 'rotation' | 'opacity'; label: string }) {
  // A5/决策 20：订阅派生布尔而非 playhead（zustand Object.is 比较——播放 30fps 时布尔不变即不重渲整个 PropertiesPanel）
  const active = useEditorStore(s =>
    clip.keyframes.some(k => k.property === property && Math.abs(k.t - (s.playhead - clip.start)) < 0.5 / 30));
  return (
    <button type="button" data-testid={`stopwatch-${property}`} title={`${active ? '删除' : '添加'} ${label} 关键帧`}
      onClick={() => {
        const es = useEditorStore.getState();
        const tl = es.playhead - clip.start; // 点击时取最新播放头（订阅不持有它）
        const hit = clip.keyframes.find(k => k.property === property && Math.abs(k.t - tl) < 0.5 / 30);
        if (hit) es.removeKeyframe(clip.id, hit.id);
        else es.addKeyframe(clip.id, property);
      }}
      className={`text-[12px] bg-transparent border-0 cursor-pointer px-1 ${active ? 'text-[#6C5CE7]' : 'text-[#C9CDD4]'}`}>⏱</button>
  );
}

/** 五属性全部配秒表（spec 第四节：每属性行旁秒表按钮）；keyof Transform 恰为五属性联合，无需 cast */
const TRANSFORM_ROWS: { property: keyof Transform; label: string; step?: number; min?: number; max?: number }[] = [
  { property: 'x', label: 'x' },
  { property: 'y', label: 'y' },
  { property: 'scale', label: '缩放', step: 0.1 },
  { property: 'rotation', label: '旋转' },
  { property: 'opacity', label: '不透明', step: 0.1, min: 0, max: 1 },
];

function TransformRow({ clip, row }: { clip: VideoClip | ImageClip; row: (typeof TRANSFORM_ROWS)[number] }) {
  const { property, label } = row;
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[12px] text-[#4E5969] w-14 shrink-0">{label}</span>
      <InputNumber aria-label={label} size="small" step={row.step} min={row.min} max={row.max} value={clip.transform[property]}
        onChange={v => { if (v !== null) useEditorStore.getState().updateClip(clip.id, { transform: { ...clip.transform, [property]: v } }); }}
        className="flex-1" />
      <StopwatchButton clip={clip} property={property} label={label} />
    </div>
  );
}

function TransitionEditor({ clip, edge }: { clip: VideoClip | ImageClip; edge: 'transitionIn' | 'transitionOut' }) {
  const t = clip[edge];
  const patch = (type: string | undefined) =>
    useEditorStore.getState().updateClip(clip.id, type ? { [edge]: { type, duration: t?.duration ?? 0.5 } } : { [edge]: undefined });
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[12px] text-[#4E5969] w-14 shrink-0">{edge === 'transitionIn' ? '入场转场' : '出场转场'}</span>
      <Select size="small" allowClear placeholder="无" value={t?.type} options={TRANSITION_TYPES} onChange={v => patch(v)}
        className="flex-1" />
      {t && (
        <InputNumber size="small" min={0.2} max={2} step={0.1} value={t.duration}
          onChange={v => { if (v !== null) useEditorStore.getState().updateClip(clip.id, { [edge]: { ...t, duration: v } }); }}
          className="w-16" addonAfter="s" />
      )}
    </div>
  );
}

export function PropertiesPanel() {
  const selectedClipId = useEditorStore(s => s.selectedClipId);
  const data = useEditorStore(s => s.data);
  const clip = selectedClipId ? data?.clips[selectedClipId] : undefined;
  if (!clip) {
    return (
      <div data-testid="properties-panel" data-testid-empty="1"
        className="w-[280px] shrink-0 border-l border-[#E5E7EB] [border-left-style:solid] bg-white p-3 box-border">
        <div data-testid="properties-empty" className="text-[12px] text-[#C9CDD4] text-center py-8">未选中片段</div>
      </div>
    );
  }
  return (
    <div data-testid="properties-panel"
      className="w-[280px] shrink-0 border-l border-[#E5E7EB] [border-left-style:solid] bg-white p-3 overflow-y-auto box-border">
      {clip.type === 'video' && (
        <div className="flex flex-col">
          <div className="text-[13px] font-medium text-[#1F2329] py-1.5">视频片段</div>
          {TRANSFORM_ROWS.map(row => <TransformRow key={row.property} clip={clip} row={row} />)}
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[#4E5969] w-14 shrink-0">播放速度</span>
            <Segmented aria-label="播放速度" size="small" value={String(clip.playbackSpeed)}
              options={[{ label: '0.5×', value: '0.5' }, { label: '1×', value: '1' }, { label: '2×', value: '2' }]}
              onChange={v => useEditorStore.getState().updateClip(clip.id, { playbackSpeed: Number(v) as 0.5 | 1 | 2 })} />
          </div>
          <TransitionEditor clip={clip} edge="transitionIn" />
          <TransitionEditor clip={clip} edge="transitionOut" />
        </div>
      )}
      {clip.type === 'image' && (
        <div className="flex flex-col">
          <div className="text-[13px] font-medium text-[#1F2329] py-1.5">图片片段</div>
          {TRANSFORM_ROWS.map(row => <TransformRow key={row.property} clip={clip} row={row} />)}
          <TransitionEditor clip={clip} edge="transitionIn" />
          <TransitionEditor clip={clip} edge="transitionOut" />
        </div>
      )}
      {clip.type === 'audio' && (
        <div className="flex flex-col">
          <div className="text-[13px] font-medium text-[#1F2329] py-1.5">音频片段</div>
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[#4E5969] w-14 shrink-0">音量</span>
            <InputNumber aria-label="音量" size="small" min={0} max={2} step={0.1} value={clip.volume}
              onChange={v => { if (v !== null) useEditorStore.getState().updateClip(clip.id, { volume: v }); }}
              className="flex-1" />
          </div>
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[#4E5969] w-14 shrink-0">淡入</span>
            <InputNumber aria-label="淡入" size="small" min={0} max={5} step={0.1} value={clip.fade.in}
              onChange={v => { if (v !== null) useEditorStore.getState().updateClip(clip.id, { fade: { ...clip.fade, in: v } }); }}
              className="flex-1" addonAfter="s" />
          </div>
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[#4E5969] w-14 shrink-0">淡出</span>
            <InputNumber aria-label="淡出" size="small" min={0} max={5} step={0.1} value={clip.fade.out}
              onChange={v => { if (v !== null) useEditorStore.getState().updateClip(clip.id, { fade: { ...clip.fade, out: v } }); }}
              className="flex-1" addonAfter="s" />
          </div>
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[#4E5969] w-14 shrink-0">播放速度</span>
            <Segmented aria-label="播放速度" size="small" value={String(clip.playbackSpeed)}
              options={[{ label: '0.5×', value: '0.5' }, { label: '1×', value: '1' }, { label: '2×', value: '2' }]}
              onChange={v => useEditorStore.getState().updateClip(clip.id, { playbackSpeed: Number(v) as 0.5 | 1 | 2 })} />
          </div>
        </div>
      )}
      {clip.type === 'subtitle' && (
        <div className="flex flex-col">
          <div className="text-[13px] font-medium text-[#1F2329] py-1.5">字幕</div>
          <textarea aria-label="字幕文本" value={clip.text} rows={3}
            onChange={e => useEditorStore.getState().updateClip(clip.id, { text: e.target.value })}
            className="w-full text-[12px] border border-[#E5E7EB] [border-style:solid] rounded-md p-1.5 box-border" />
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[#4E5969] w-14 shrink-0">显示字幕</span>
            <Switch aria-label="显示字幕" size="small" checked={clip.visible}
              onChange={v => useEditorStore.getState().updateClip(clip.id, { visible: v })} />
          </div>
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[#4E5969] w-14 shrink-0">字号</span>
            <Slider aria-label="字号" className="flex-1" min={12} max={120} value={clip.style.fontSize}
              onChange={v => useEditorStore.getState().updateClip(clip.id, { style: { ...clip.style, fontSize: v as number } })} />
            <InputNumber size="small" min={12} max={120} value={clip.style.fontSize}
              onChange={v => { if (v !== null) useEditorStore.getState().updateClip(clip.id, { style: { ...clip.style, fontSize: v } }); }}
              className="w-16" />
          </div>
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[#4E5969] w-14 shrink-0">字体颜色</span>
            <input type="color" aria-label="字体颜色" value={clip.style.color}
              onChange={e => useEditorStore.getState().updateClip(clip.id, { style: { ...clip.style, color: e.target.value } })}
              className="w-8 h-6 border border-[#E5E7EB] [border-style:solid] rounded cursor-pointer" />
          </div>
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[#4E5969] w-14 shrink-0">字间距</span>
            <InputNumber aria-label="字间距" size="small" min={0} max={20} step={0.5} value={clip.style.letterSpacing}
              onChange={v => { if (v !== null) useEditorStore.getState().updateClip(clip.id, { style: { ...clip.style, letterSpacing: v } }); }}
              className="flex-1" />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 4: 跑测试 + tsc + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/store/editorStore.keyframe.test.ts src/pages/canvas/video-editor/components/PropertiesPanel.test.tsx
pnpm -C apps/web exec tsc -b
git add apps/web/src && git commit -m "feat(video-editor): 关键帧 store actions + 右面板四态（transform/速度/转场/秒表/字幕样式）（TDD）"
```

---

### Task 11: 时间轴关键帧菱形刻度（点击跳转/拖拽/Delete）

**Files:**
- Modify: `apps/web/src/pages/canvas/video-editor/store/editorStore.ts`（+selectedKeyframeId/selectKeyframe）
- Modify: `apps/web/src/pages/canvas/video-editor/components/timeline/ClipBlock.tsx`（菱形渲染 + pointer）
- Modify: `apps/web/src/pages/canvas/video-editor/components/timeline/TimelinePanel.tsx`（keyframe 拖拽状态机）
- Modify: `apps/web/src/pages/canvas/video-editor/components/timeline/TrackRow.tsx`（prop 透传）
- Modify: `apps/web/src/pages/canvas/video-editor/hooks/useEditorKeyboard.ts`（Delete 优先删选中关键帧）
- Test: `apps/web/src/pages/canvas/video-editor/components/timeline/keyframe-ui.test.tsx`

- [x] **Step 1: 写失败测试（核心用例——文件含 helper 复用 TimelinePanel.interact.test.tsx 的 ready/addVideoClip 模式）**

```tsx
// apps/web/src/pages/canvas/video-editor/components/timeline/keyframe-ui.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimelinePanel } from './TimelinePanel';
import { useEditorStore } from '../../store/editorStore';
import { createDefaultProjectData } from '../../types';

// jsdom 无 PointerEvent 构造器——按本仓 TimelinePanel.interact.test.tsx 既有先例用 MouseEvent 按 type 派发（R1 审核 B5：
// fireEvent.pointerDown 走 createEvent 的 window[EventType]||Event 回退，button/clientX 全丢 → if (e.button !== 0) 早退）
const firePointer = (target: Element | Window, type: string, init: { button?: number; clientX?: number; clientY?: number } = {}) => {
  fireEvent(target, new MouseEvent(type, { bubbles: true, cancelable: true, button: init.button ?? 0, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0 }));
};

const ready = () => {
  const d = createDefaultProjectData();
  useEditorStore.setState({ status: 'ready', data: d, projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't' });
  return d;
};
const addVideoWithKf = () => {
  const d = useEditorStore.getState().data!;
  const id = useEditorStore.getState().addClip({ type: 'video', mediaId: 'm1', trackId: d.tracks[0].id, start: 0 })!;
  useEditorStore.getState().setPlayhead(2);
  useEditorStore.getState().addKeyframe(id, 'scale');
  useEditorStore.getState().setPlayhead(0);
  return id;
};

describe('时间轴关键帧菱形刻度', () => {
  beforeEach(() => useEditorStore.getState().reset());

  it('渲染菱形（data-testid=kf-*），点击跳转播放头', () => {
    ready();
    addVideoWithKf();
    render(<TimelinePanel />);
    const kf = screen.getByTestId(/^kf-/); // 首个菱形
    firePointer(kf, 'pointerdown', { clientX: 160, clientY: 50 });
    firePointer(window, 'pointerup');
    expect(useEditorStore.getState().playhead).toBe(2); // kf.t=2 → 跳转
  });

  it('拖拽菱形移动关键帧（transient，pointerup 入栈）', () => {
    ready();
    const id = addVideoWithKf();
    render(<TimelinePanel />);
    const kf = screen.getByTestId(/^kf-/);
    firePointer(kf, 'pointerdown', { clientX: 160, clientY: 50 });
    firePointer(window, 'pointermove', { clientX: 240, clientY: 50 }); // +80px = +1s @80px/s
    firePointer(window, 'pointerup');
    const clip = useEditorStore.getState().data!.clips[id] as any;
    expect(clip.keyframes[0].t).toBe(3);
  });

  it('Delete 优先删除选中关键帧（其次选中片段）——N3 定案：先选片段再点菱形（两 id 双写联动）', () => {
    ready();
    const id = addVideoWithKf();
    render(<TimelinePanel />);
    useEditorStore.getState().selectClip(id); // 先选片段
    const kf = screen.getByTestId(/^kf-/);
    firePointer(kf, 'pointerdown', { clientX: 160, clientY: 50 }); // 点菱形：双写 selectedKeyframeId + selectedClipId（同时跳播放头）
    expect(useEditorStore.getState().selectedClipId).toBe(id); // 双写保证联动（直接点菱形也选中其片段）
    fireEvent.keyDown(document, { key: 'Delete' });
    const clip = useEditorStore.getState().data!.clips[id] as any;
    expect(clip.keyframes).toHaveLength(0);      // 关键帧优先被删
    expect(useEditorStore.getState().data!.tracks[0].clips).toContain(id); // 片段保留
  });
});
```

- [x] **Step 2: 确认失败 → 实现**

editorStore 增量：State 加 `selectedKeyframeId: string | null`（初始 null，reset 清空）+ **`selectKeyframe(kfId: string | null, clipId?: string)`（N3/决策 19 双写：kfId 非空时同时写 `selectedKeyframeId: kfId` 与 `selectedClipId: clipId`——点击菱形即选中其片段，stopPropagation 已挡片段选中路径，双写保证 Delete 的两 id 联动不变量；kfId 为 null 只清 selectedKeyframeId）**；既有 `selectClip` 补清 `selectedKeyframeId: null`（切换片段时关键帧选中失效，不变量保持）；**undo/redo 的 set 同步补 `selectedKeyframeId: null`**（R4：现码 L330/339 只清 selectedClipId——历史跳转后 selectedClipId 已 null、Delete 双真条件不触发，当前无害，但"双写联动"不变量要求 kf 选中不残留，Plan 4 消费前顺手收口）。

ClipBlock 增量（视觉片渲染菱形；props 加 `onKeyframePointerDown?: (kfId: string, e: React.PointerEvent<HTMLDivElement>) => void`——R6：与 TrackRow 逐层同签名。R7 轮 tsc 实证的双向规则：窄参 handler（`<HTMLDivElement>`）赋给 bare 槽位（=PointerEvent<Element>）报 TS2322（逆变参数检查："PointerEvent<Element> is not assignable to PointerEvent<HTMLDivElement>"——R6 前计划形态 TrackRow→ClipBlock 正是此向）；反方向 bare handler 赋给窄参槽位合法（现存先例 TimelinePanel.tsx:31 bare → TrackRow.tsx:15 `<HTMLDivElement>`））：

```tsx
  {(clip.type === 'video' || clip.type === 'image') && clip.keyframes.map(k => (
    <div key={k.id} data-testid={`kf-${k.id}`} title={`${k.property} @ ${k.t.toFixed(2)}s`}
      onPointerDown={(e) => onKeyframePointerDown?.(k.id, e)}
      className="absolute w-2 h-2 bg-white border border-[#6C5CE7] rotate-45 cursor-pointer z-[1]"
      style={{ left: timeToPx(k.t, pxPerSec) - 4, top: '50%', marginTop: -4 }} />
  ))}
```

（菱形不挡片段拖拽外的命中：pointerdown 内 stopPropagation 由 TimelinePanel 的 handler 做。audio 片 volume 关键帧同样渲染——同款分支，testid 同前缀；**title 用 `音量 @ ${k.t.toFixed(2)}s`**（R3 五-2：VolumeKeyframe 无 property 字段，复用 k.property 会渲染 "undefined @ 1.00s"）。）

TrackRow 增量（R6：链条完整性——只在 TimelinePanel 侧加 handler 会断在中层，keyframe-ui.test 三用例全红）：TrackRowProps 增加同签名 prop，ClipBlock 渲染处（现码 L60-62）与 onPointerDown 并列透传：

```tsx
// TrackRowProps 增加：
  onKeyframePointerDown?: (kfId: string, e: React.PointerEvent<HTMLDivElement>) => void;
// ClipBlock 渲染处透传：
  onKeyframePointerDown={onKeyframePointerDown}
```

TimelinePanel 增量（R4 头部 import 前置：现码 L8 仅 `import type { Clip } from '../../types'` 且无 playback 导入——下方代码用 `(c as VideoClip)` 与 `seekPlayback`，不补则抄写即 TS2304）：

```ts
import type { Clip, VideoClip } from '../../types';   // L8 改——VideoClip 新增
import { seekPlayback } from '../../hooks/playback';  // 新增（点击菱形跳转播放头）
```

dragRef 的 kind 联合扩 `'keyframe'`；`onKeyframePointerDown(kfId, e)`：

```tsx
const onKeyframePointerDown = (kfId: string, e: React.PointerEvent<HTMLDivElement>) => {
  if (e.button !== 0) return;
  e.stopPropagation();
  const es = useEditorStore.getState();
  const clip = Object.values(es.data?.clips ?? {}).find(c =>
    (c.type === 'video' || c.type === 'image' || c.type === 'audio') && (c as VideoClip).keyframes.some(k => k.id === kfId));
  es.selectKeyframe(kfId, clip?.id); // N3/决策 19：双写 selectedKeyframeId + selectedClipId（stopPropagation 挡了片段选中路径）
  // 点击跳转播放头（spec 第四节：可点击跳转）
  if (clip) seekPlayback(clip.start + ((clip as VideoClip).keyframes.find(k => k.id === kfId)!.t));
  dragRef.current = {
    kind: 'keyframe', clipId: clip!.id, kfId,
    startClientX: e.clientX,
    startKfT: (clip as VideoClip).keyframes.find(k => k.id === kfId)!.t,
    startPxPerSec: pxPerSec, pointerMovedOnce: false, // B8：字段名对齐现码 DragState（Plan 2 执行期修正后 pointerMoved 已删、startClientY 不存在）
  } as DragState & { kfId: string; startKfT: number };
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
};
// onWindowPointerMove 的 keyframe 分支（pointerMovedOnce 与现码字段名统一，B8）：
//   d.kfId → if (!es.pendingSnapshot && !d.pointerMovedOnce) { es.beginTransient(); d.pointerMovedOnce = true; }
//   es.moveKeyframe(d.clipId, d.kfId, d.startKfT + dxSec, { transient: true })
// onWindowPointerUp 不变（endTransient 统一收口）
```

useEditorKeyboard Delete 分支改造：

```ts
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const es = useEditorStore.getState();
        if (es.selectedKeyframeId && es.selectedClipId) {
          es.removeKeyframe(es.selectedClipId, es.selectedKeyframeId); // 关键帧优先
        } else if (es.selectedClipId) {
          es.removeClip(es.selectedClipId);
        }
      }
```

（selectedKeyframeId 与 selectedClipId 联动：removeKeyframe 内已清 selectedKeyframeId；selectClip 切换时清 selectedKeyframeId——store 的 selectClip 补 `selectedKeyframeId: null`。）

- [x] **Step 3: 跑测试 + 回归 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/components/timeline/keyframe-ui.test.tsx src/pages/canvas/video-editor/components/timeline/TimelinePanel.interact.test.tsx
# 预期: 新 3 PASS + 既有交互用例回归（Delete 分支行为对"无选中关键帧"场景不变）
git add apps/web/src && git commit -m "feat(video-editor): 时间轴关键帧菱形——点击跳转/拖拽移动/Delete 删除优先级（TDD）"
```

---

### Task 12: 波形真数据（共享解码 + peaks 缓存 + 音频片段 Canvas 自绘）

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/hooks/useAudioPeaks.ts`
- Modify: `apps/web/src/pages/canvas/video-editor/components/timeline/ClipBlock.tsx`（audio 片波形层）
- Test: `apps/web/src/pages/canvas/video-editor/hooks/useAudioPeaks.test.ts`

- [x] **Step 1: 写失败测试（useAudioPeaks）**

```ts
// apps/web/src/pages/canvas/video-editor/hooks/useAudioPeaks.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAudioPeaks } from './useAudioPeaks';
import { peaksFromAudioBuffer } from '../timeline/waveform';

vi.mock('../audio-engine/decode', () => ({
  decodeMediaPcm: vi.fn(async () => null),
}));
import { decodeMediaPcm } from '../audio-engine/decode';

const pcm = { sampleRate: 48000, channels: [new Float32Array(48000).fill(0.5)] };

describe('useAudioPeaks（mediaId 缓存——模块级 Map 跨用例存活，故各用例用不同 mediaId 隔离）', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('解码 → peaksFromAudioBuffer 结果缓存（二次挂载不重解码）', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(pcm as never);
    const { result: r1 } = renderHook(() => useAudioPeaks('m1', 'http://u1'));
    await waitFor(() => expect(r1.current).not.toBeNull());
    expect(r1.current).toHaveLength(200);
    expect(decodeMediaPcm).toHaveBeenCalledTimes(1);
    const { result: r2 } = renderHook(() => useAudioPeaks('m1', 'http://u1'));
    await waitFor(() => expect(r2.current).not.toBeNull());
    expect(decodeMediaPcm).toHaveBeenCalledTimes(1); // 命中模块级缓存
  });
  it('无 url / 解码失败 → null 不炸', async () => {
    const { result } = renderHook(() => useAudioPeaks('m9a', undefined));
    expect(result.current).toBeNull();
    vi.mocked(decodeMediaPcm).mockResolvedValue(null);
    const { result: r2 } = renderHook(() => useAudioPeaks('m9b', 'http://u2'));
    await waitFor(() => expect(r2.current).toBeNull());
  });
});
```

- [x] **Step 2: 实现 useAudioPeaks + ClipBlock 波形层**

```ts
// apps/web/src/pages/canvas/video-editor/hooks/useAudioPeaks.ts
import { useEffect, useState } from 'react';
import { getMediaBlob } from '../renderer/media-blob';
import { decodeMediaPcm } from '../audio-engine/decode';
import { peaksFromAudioBuffer } from '../timeline/waveform';

const peaksCache = new Map<string, number[]>();
export const PEAKS_COUNT = 200;

/** 波形峰值按 mediaId 缓存（spec 第五节：共享单例解码器产数据，不为每片段 new wavesurfer） */
export function useAudioPeaks(mediaId: string | undefined, url: string | undefined): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(() => (mediaId ? peaksCache.get(mediaId) ?? null : null));
  useEffect(() => {
    if (!mediaId || !url) return;
    if (peaksCache.has(mediaId)) { setPeaks(peaksCache.get(mediaId)!); return; }
    let cancelled = false;
    void (async () => {
      try {
        const blob = await getMediaBlob(mediaId, url);
        if (!blob) return;
        const pcm = await decodeMediaPcm(blob, 48000);
        if (!pcm) return;
        const source = {
          sampleRate: pcm.sampleRate,
          length: pcm.channels[0].length,
          getChannelData: (ch: number) => pcm.channels[Math.min(ch, pcm.channels.length - 1)],
        };
        const p = peaksFromAudioBuffer(source, PEAKS_COUNT);
        peaksCache.set(mediaId, p);
        if (!cancelled) setPeaks(p);
      } catch { /* 静默：无波形显示占位色块 */ }
    })();
    return () => { cancelled = true; };
  }, [mediaId, url]);
  return peaks;
}
```

ClipBlock 增量（audio 片波形 canvas 层——Canvas 自绘静态波形；peaks 归一化渲染端处理：`peak / max`，研究 §6）：

```tsx
// ClipBlock.tsx 顶部（R3 五-1：现码 L1 仅 `import { memo } from 'react'`——须扩为 { memo, useRef, useEffect }，
// WaveformCanvas 直接用 useRef/useEffect，抄写即 TS2304）：
import { memo, useRef, useEffect } from 'react';
import { useAudioPeaks } from '../../hooks/useAudioPeaks';
import { useEditorStore } from '../../store/editorStore';

// 文件顶层新增（与 ClipBlock 同级，模块作用域）——R7：若声明在 ClipBlock 函数体内则成嵌套组件定义，
// ClipBlock 每次重渲（选中/pxPerSec/拖拽 transient）都产生新组件类型 → canvas 子树卸载重建、effect 反复跑：
function WaveformCanvas({ mediaId }: { mediaId: string }) {
  const url = useEditorStore(s => s.mediaInfo[mediaId]?.url);
  const peaks = useAudioPeaks(mediaId, url);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !peaks) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    const max = Math.max(...peaks, 1e-6);
    ctx.fillStyle = '#43CC80';
    const bw = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const barH = (peaks[i] / max) * (h * 0.8);
      ctx.fillRect(i * bw, (h - barH) / 2, Math.max(1, bw - 0.5), barH);
    }
  }, [peaks]);
  return <canvas ref={ref} width={260} height={30} data-testid={`waveform-${mediaId}`}
    className="absolute inset-x-1 bottom-0.5 w-[calc(100%-8px)] h-[30px] pointer-events-none" />;
}
// audio 片渲染：label 行下叠加 {clip.type === 'audio' && <WaveformCanvas mediaId={clip.mediaId} />}
```

- [x] **Step 3: 跑测试 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/hooks/useAudioPeaks.test.ts
pnpm -C apps/web exec tsc -b
git add apps/web/src && git commit -m "feat(video-editor): 波形真数据——共享解码/peaks mediaId 缓存/Canvas 自绘（TDD）"
```

---

### Task 13: 素材缺失态片段标红

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/timeline/missing-source.ts`
- Modify: `apps/web/src/pages/canvas/video-editor/components/timeline/TimelinePanel.tsx`（订阅 canvasStore.nodes 派生 missing 集合）
- Modify: `apps/web/src/pages/canvas/video-editor/components/timeline/TrackRow.tsx` + `ClipBlock.tsx`（missing prop 传递与红态）
- Test: `apps/web/src/pages/canvas/video-editor/timeline/missing-source.test.ts`

- [x] **Step 1: 写失败测试（纯函数 + 组件红态合并入纯函数用例文件；组件红态断言并入 TimelinePanel.render.test.tsx 追加用例）**

```ts
// apps/web/src/pages/canvas/video-editor/timeline/missing-source.test.ts
import { describe, it, expect } from 'vitest';
import { missingSourceNodeIds } from './missing-source';
import type { ProjectData } from '../types';

const data = (sourceNodeIds: (string | undefined)[]): ProjectData => ({
  version: 1, fps: 30,
  tracks: [{ id: 'tv', type: 'video', name: 'V', muted: false, hidden: false, clips: sourceNodeIds.map((_, i) => `c${i}`) }],
  clips: Object.fromEntries(sourceNodeIds.map((sn, i) => [`c${i}`, {
    id: `c${i}`, trackId: 'tv', type: 'video', start: 0, duration: 3, sourceStart: 0, mediaId: `m${i}`,
    ...(sn ? { sourceNodeId: sn } : {}), playbackSpeed: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
  }])) as ProjectData['clips'],
});

describe('missingSourceNodeIds（素材缺失态派生——spec 生命周期第 3 条）', () => {
  it('clip.sourceNodeId 不在画布节点集合 → 计入缺失', () => {
    const m = missingSourceNodeIds(data(['ghost', 'alive']), new Set(['alive', 'edit1']));
    expect(m).toEqual(new Set(['ghost']));
  });
  it('素材库来源（无 sourceNodeId）不计入；字幕片不计入', () => {
    const d = data([undefined]);
    d.clips['sub'] = { id: 'sub', trackId: 'tv', type: 'subtitle', start: 5, duration: 2, text: 'x', visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 }, sourceNodeId: 'ghost2' };
    d.tracks[0].clips.push('sub');
    expect(missingSourceNodeIds(d, new Set())).toEqual(new Set());
  });
  it('data null → 空集合', () => {
    expect(missingSourceNodeIds(null, new Set())).toEqual(new Set());
  });
});
```

- [x] **Step 2: 确认失败 → 实现**

```ts
// apps/web/src/pages/canvas/video-editor/timeline/missing-source.ts
import type { ProjectData } from '../types';

/** 上游素材节点被删（clip 仍引用 sourceNodeId 但画布无该节点）→ 片段标红"素材已删除"（spec 生命周期第 3 条；
 *  导出前置拦截缺失 mediaId 在 Plan 4）。 */
export function missingSourceNodeIds(data: ProjectData | null, nodeIds: Set<string>): Set<string> {
  const missing = new Set<string>();
  if (!data) return missing;
  for (const c of Object.values(data.clips)) {
    if (c.type === 'subtitle') continue;
    if (c.sourceNodeId && !nodeIds.has(c.sourceNodeId)) missing.add(c.sourceNodeId);
  }
  return missing;
}
```

TimelinePanel 增量（订阅 canvasStore.nodes——低频，playhead 无关）：

```tsx
import { useCanvasStore } from '@/stores/canvasStore';
import { missingSourceNodeIds } from '../../timeline/missing-source';
// 组件内：
const canvasNodes = useCanvasStore(s => s.nodes);
const missingSources = useMemo(
  () => missingSourceNodeIds(data, new Set(canvasNodes.map(n => n.id))),
  [data, canvasNodes]);
// TrackRow 传参：missingSourceNodeIds={missingSources}
```

TrackRow → ClipBlock 传递 `missing={c.sourceNodeId ? missingSourceNodeIds.has(c.sourceNodeId) : false}`；ClipBlockProps 增加 `missing?: boolean;` 并在参数解构中取出（R7：与 Task 11 onKeyframePointerDown 并列写明——防 prop 链条断在中层）；ClipBlock 红态：

```tsx
  // style 增量：background: missing ? '#FEE2E2' : BLOCK_BG[clip.type]
  // 边框优先级（R6 定案）：missing 红边压过选中边（素材缺失是更高优先级的告警态）——
  //   border: `1px solid ${missing ? '#EF4444' : selected ? BLOCK_BAR[clip.type] : 'transparent'}`
  // label 区追加角标：
  {missing && <span className="text-[10px] text-[#EF4444] ml-1 shrink-0">素材已删除</span>}
```

- [x] **Step 3: 跑测试 + TimelinePanel.render.test.tsx 追加红态用例 + 提交**

追加用例（R4：既有夹具 v1.sourceNodeId='s1' 而 canvasStore 默认无此节点 → 夹具默认即红态，直接复用，无需另造 missing 数据；夹具中仅 v1 带 sourceNodeId——a1/sub1 无，getByText 唯一成立）：

```tsx
// TimelinePanel.render.test.tsx 追加（顶部补 import { act } from '@testing-library/react' 与 import { useCanvasStore } from '@/stores/canvasStore'）：
  it('素材缺失态：sourceNodeId 不在画布 → 红态角标；源节点回画布 → 消失', () => {
    const d = dataWithClips(); // 夹具 v1 带 sourceNodeId: 's1'（canvasStore.nodes 默认不含 → 红态）
    useEditorStore.setState({ status: 'ready', data: d, projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't' });
    render(<TimelinePanel />);
    expect(screen.getByText('素材已删除')).toBeInTheDocument();
    act(() => { useCanvasStore.setState({ nodes: [{ id: 's1', position: { x: 0, y: 0 }, data: {} } as never] }); });
    expect(screen.queryByText('素材已删除')).not.toBeInTheDocument();
  });
```

**既有夹具红态影响（R4 知会性登记）**：render.test 第 3 用例与 interact.test 的 addVideoClip（sourceNodeId: 's1'）在本 task 后均渲染红标——既有断言（testid/文案/交互）不含红标文案，不受影响不失败；执行者看到夹具片段带红角标属预期，勿误判为缺陷回改夹具。

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/timeline/missing-source.test.ts src/pages/canvas/video-editor/components/timeline/TimelinePanel.render.test.tsx
git add apps/web/src && git commit -m "feat(video-editor): 素材缺失态片段标红——源节点派生/红底角标（TDD）"
```

---

### Task 14: Plan 3 浏览器验收（preview 工具）

对 spec 29 条验收清单中 Plan 3 范围条目逐项核验；前端 dev server + 本地 API + Postgres/Redis/MinIO（按项目启动流程记忆）。发现的缺陷按 TDD 修复后复验。**前置数据**：画布需有真实视频/音频/图片产物节点（生成链路产物）——若生成不可用，用"+上传"链路（presign）向素材库传本地样例视频后经资产面板拖入。

**Files:** 无新文件（修复改对应源文件）

- [x] **Step 1: 启动环境并准备素材（真实媒体文件：一段 >5s 的 mp4 + 一张图片）**

- [x] **Step 2: 逐项验收**

| spec 条目 | 验收点 | 手段 |
|---|---|---|
| 7 | 预览音画同步（播放/暂停/seek 精确）；变速 0.5×/2× 音调不变（spike① 人工判定补做）；节点本体播放/暂停/时间码；两个剪辑节点不同时播放；移出视口释放（播放中滚动画布移出→自动停） | preview 操作 + console 无错 |
| 8 | 字幕添加（字幕轨➕）与样式实时反映（字号/颜色/字间距改动画布即时变化；宽文本换行 ≤1664px、底距 96px 视觉核对） | preview_fill + snapshot |
| 9 | 5 种转场正确（入场/出场各型）；crossfade overlap 配对与退化（删前片→fadeIn） | 时间轴操作 + 播放观察 |
| 10 | 关键帧增（秒表+菱形）/拖（菱形拖拽）/删（Delete）；插值正确（局部坐标、单点恒值、越界取端值——右面板改值+播放头观察） | 操作 + preview |
| 6（补全） | 0.5×/2× 变速后公式正确（sourceTime 随速度——预览画面内容核对） | 变速 + 播放 |
| — | 波形：音频片段显示静态波形（真实 peaks） | snapshot |
| — | 素材缺失：删除上游素材节点→片段标红"素材已删除"（红底 + 红边，红边压过选中边——R6 优先级定案） | 画布删节点 + snapshot |
| — | 控制条迁移后撤销/重做/分割/删除可用；缩放滑杆与 Ctrl+滚轮联动；音量滑杆实际影响播放音量 | 操作 |
| — | 暂停态单帧渲染（G1）：进编辑器即显示 playhead=0 帧而非黑屏；暂停后点画布/拖标尺即时出画 | 操作 + snapshot |
| — | seek：暂停态点击画布单帧到位；播放中拖标尺=静音拖拽、**松手后音画同步**（G4/决策 6② 验收口径——**拖动过程中允许音画短暂不同步**：去抖窗内音频仍用旧调度，松手 ≤100ms 重排恢复，A4） | 操作 |
| — | 编辑器收起后再进：无 AudioContext 泄漏（DevTools AudioContext 计数恒 1）；播放头位置不保留（重进=0）与数据保留 | 反复进出 10 次 |
| — | 720p 预览降级：canvas 内部分辨率 1920×1080 CSS 缩放显示清晰 | inspect |
| — | **Range 206 验证（A3 前置）——服务侧 + 浏览器侧双验**：① `curl -I -H 'Range: bytes=0-1' <presigned GET url>` 返回 206（Nginx 反代 /flowai 若回 200 需修：`proxy_force_ranges on;` 或 `proxy_set_header Range $http_range; proxy_set_header If-Range $http_if_range;`）；② 浏览器侧 DevTools Network 观察播放/seek 期间**多次分段 206 请求**（非单次整文件 200）且 **console 无 mediabunny range 警告**（非 206 时 UrlSource 转 sequential+缓存驱逐、回拖抛错黑帧——curl 证明不了浏览器侧，决策 1） | curl + DevTools Network + console |
| — | **回拖 seek 无黑帧（Range 链路终验）**：播放至中段 → 向后拖拽播放头到已播过的早期位置（跨越 UrlSource 缓存容量）+ 段落级回看反复数次——画面正常出帧无永久黑帧（sequential 退化模式的抛错形态恰好在此暴露） | preview 操作 |
| — | **prepare 瞬时内存观测（§4.1）**：15min 级工程（或最长可用素材）首次点播放时 DevTools Memory/performance.memory 采样记录峰值——prepare 瞬时约为稳态 3-4 倍（解码拼接 chunks+merged、变速 padded+输出缓冲并存）；数字登记回本文件执行期记录，>2GB 异常 | DevTools Memory |
| — | 多标签双解码口径（spec 边界表已登记）：同工程开两标签各自解码 PCM/取帧——行为可用无报错即过（一期接受，无跨标签共享） | 操作 |

- [x] **Step 3: 缺陷修复循环（发现 → 复现测试 → TDD 修复 → 复验）**

- [x] **Step 4: 全量回归 + 提交收尾**

```bash
pnpm -C apps/web exec tsc -b
pnpm -C apps/web test && pnpm -C apps/api test
# 预期: 全绿（api 不受本 plan 影响）
git add -A && git commit -m "test(video-editor): Plan 3 浏览器验收通过（spec 条目 6/7/8/9/10 + 资源纪律实测）"
```

### Task 14 执行期验收记录（2026-09-11，preview 工具实测）

**环境**：本地 PG/Redis/MinIO + api(3000)/web(5173) dev server；素材注入 = 应用自身 presign+confirm 管道上传统媒体（主测视频 985e5a36 10.1s 带音轨 / 纯视频 3140551 5.4s 无音轨 / 0.png / mp3），经 `useCanvasStore.addNode(type, pos, { fileId, status:'success' })`（与应用生成完成同路径 setFileResult 语义）建产物节点——生成链路（第三方 API 积分）不可用于验收数据，此路径为计划 Step 1 预授权的替代。

**逐项结论**：

| 验收点 | 结果 | 证据 |
|---|---|---|
| 预览播放推进 | ✓ | prepare(preparing 门卫)→playing，playhead 0→3.07 @1.02× 实时；播放中像素逐帧变化（左区 134→162→130） |
| 暂停态单帧（G1） | ✓ | 点击画布 seek 30%→5.07s 即时出画；进编辑器即渲染 playhead 帧 |
| 字幕（条目 8） | ✓ | 文本/字号 48→96/颜色红/字间距实时反映（像素级）；40+ 字自动换行恰 2 行截断、底距 96 视觉核对 |
| 转场（条目 9） | ✓ | crossfade 中点 [102,79,75]≈两片均值；toBlack 130→7、toWhite→249；fadeOut 比值恰 0.10；fadeIn 早期 10/晚期 132；前片独立出场被 crossfade 吞并（spec 定案）；删前片→退化 fadeIn（比值 0.14≈alpha 0.1） |
| 关键帧（条目 10） | ✓ | 秒表添加 tLocal=3 正确；菱形渲染/点击跳播放头(2+1=3)/拖拽 +80px→t+1/Delete 优先删 kf 留片段；scale 1→2 插值像素分化（视频区→图片区） |
| 变速（条目 6） | ✓ | 同 playhead 1×/2× 9 点指纹全异 + 回 1× 确定性 |
| 波形 | ✓ | audio 片 canvas 260×30 绿峰 42px/非空 2092（peaks 真数据） |
| 素材缺失 | ✓ | 删源节点→角标"素材已删除"+红底 #FEE2E2（删前 false→删后 true 双向）；级联：预览该片段跳层黑（与时间轴标红语义一致） |
| 控制条 | ✓ | 分割 8→9/撤销→8/重做→9/删除→8/双 undo 恢复；音量/全屏/缩放滑杆在位 |
| scrub 三段式 | ✓（活模块直驱） | 播放中 scrubBegin(3)→playing=false+ph=3；move 只动 ph；end→恢复播放从 6.5 续播 7.3（重锚重排）。标尺 UI 合成事件不可达（见发现④），单测 4 用例+活模块联动双重覆盖 |
| AudioContext 泄漏 | ✓ | reload 后 patch 构造计数，开关编辑器 10 轮计数恒 1；重开 playhead=0 重置、8 clips 数据保留 |
| 720p 降级 | ✓ | canvas 内部 1920×1080 + CSS 缩放 |
| Range 206 双验 | ✓ | 服务侧 presigned GET + Range:bytes=0-1 → 206 + Content-Range "bytes 0-1/24390720"；浏览器侧播放/seek 期间多次分段 206 + console 无 range 警告 |
| 回拖 seek 无黑帧 | ✓ | 素材齐全下 尾13→头3→中8→尾14→头2.5→中9 六次 >2s 大跳全出帧（115/208/43/112/208/43）+ 确定性（两次同点全等） |
| prepare 内存 | ✓（口径登记） | 10s 素材 JS 堆瞬时 +12MB（117→129）/稳态 +10MB；performance.memory 只测 JS 堆——AudioBuffer native 驻留不可见（DevTools Memory 人工可选）；无 >2GB 异常 |
| 多标签双解码 | —（登记） | window.open 弹窗被拦——模块态（audioEngine/videoCache/peaksCache）每页实例天然隔离无共享路径，人工可选开双标签 |
| spike① 变速音调人工判定 | —（登记） | 无扬声器自动化路径；spike 已验 440Hz 主频保持，浏览器侧同一 stretchPcm 实现，留人工听感 |

**执行期发现与登记**：

1. **范围缺口（上报用户裁量）**：spec L280-282"全集资产 = 画布产物 + 团队素材库"且"+新建"上传走 presign 链路——Plan 2 占位注释写"团队素材 Plan 3 实化"但 **Plan 3 无此任务**（七轮审核均未覆盖）：当前"+上传"链路只写节点 referenceVideo（生成参考），不经 fileId 不入资产面板；团队素材分支仍是死占位。验收数据靠生成产物语义注入绕过。建议并入 Plan 4 或另开小 plan。
2. **低危 UX**：编辑器刚打开、AssetPanel url 未回填完成前的 seek 渲染会缺图片层且暂不自愈（G1 effect 依赖 [playing,playhead,data] 不含 mediaInfo）——下次 seek/edit 自愈。
3. **诊断痕迹缺口（改进项）**：video-cache openSink 失败路径（403/无轨）静默进冷却无 console.warn（R4 的 warn 只在 getFrameAt catch）——排查黑帧时无痕迹，建议 Plan 4 顺手补一行。
4. **合成事件限制（非缺陷）**：标尺 scrub 的 `setPointerCapture(合成 pointerId)` 对不存在指针抛 NotFoundError 中断 handler——真实指针 pointerId 恒有效不受影响。
5. **环境残留知会**：console 6 条 HMR Failed to reload TrackRow 为子代理编辑中途瞬态（终态 tsc/测试全绿），刷新后无新错。
6. 黑帧疑点排查过程记录：素材缺失验收删源节点后 t=4/10 黑帧 = 预期级联（无 url 跳层），重建产物节点后恢复——非 Range/缓存缺陷。

---

## Plan 3 完成判定

- `pnpm -C apps/web exec tsc -b` 0 error；`pnpm -C apps/web test` 全绿（新增约 60+ 用例：scene 3 文件 + renderer 2 + audio-engine 3 + store keyframe + 组件 5）；`pnpm -C apps/api test` 不受影响全绿
- spec 附录 B 阶段 5/6 落地核对：
  - 阶段 5：scene 纯函数 TDD（selectActiveClips/interpolateClip 含 Keyframe 边界与 5 转场）✓；主线程预览（主时钟/跳帧追赶/seek 等帧）✓；节点本体迷你播放（资源纪律五条）✓；全局 audio-engine 新建（实时/离线共用 PCM 纯函数——stretchPcm/resamplePcm/buildGainPoints 无上下文类型依赖）✓
  - 阶段 6：右面板四态 ✓；转场/关键帧编辑 UI（含 overlap 音频线性 equal-gain——buildGainPoints 单源）✓；波形真数据（peaksFromAudioBuffer 接线共享解码）✓；素材缺失态标红（Plan 2 交接项）✓
- 浏览器验收 Task 14 清单通过；soundtouch spike①（音质人工判定）补做登记结论
- **登记偏离**：音频调度一次性全量替代 lookahead（决策 6，含 G4 两条配套纪律：AudioBuffer 按 key 复用 + 拖拽 scrub 三段式）；AudioContext suspend/resume 替代 close（决策 7，含 G2 resume 修复）；字幕 2 行截断具体化（决策 12，spec 已同步登记）；"设置"控件省略（边界节，spec 已留 TODO，待用户补充需求）；节点迷你播放不出声 + 媒体 url 经 batchGetMedia 现查（决策 16 / Task 9 定案）
- **R1 轮审核修订（2026-09-11，11 项阻塞 + 10 项功能缺口全数采纳，2 项拍板落定）**：阻塞 B1-B8——mediabunny dispose 实形修正（CanvasSink 无 dispose/Input.dispose 返回 void）；setMediaUrlResolver 残留与 FrameRenderDeps 错位 import 清理（B2）；Task 6 offset 期望 1.5 验算修正（B3）；空格用例补 videoEditorStore.open 门卫（B4）；Task 11 pointer 事件改 MouseEvent 派发（B5）；既有测试迁移清单三处补全（B6）；onSubtitleAdd 闭包 playhead 连带（B7）；useRef/rafRef 上提/pointerMovedOnce 统一（B8）。缺口 G1-G10——暂停态单帧渲染 effect（G1/决策 18）；suspend 后 resume 冻结修复（G2）；crossfade 双窗口（G3/决策 17，三片链测试补齐）；拖拽 seek 静音 + up 重排（G4/决策 6②）；letterSpacing 参与 measure 与绘制（G5）；迷你播放删 prepare 不出声（G6/决策 16 拍板）；video-cache openSink in-flight 去重（G7）；stretchPcm 尾部非静音断言替代恒真假绿（G8）；ResizeObserver 接 M2（G9）；mediaApi mock/动态 import 清理/objectFit 删除（G10）。审核核验无误项（数值向量/依赖实形/soundtouchjs·mediabunny API 实形）已按其修正对齐
- **R2 轮审核修订（2026-09-11，R1 修订核验 20/21 落实 + 新引入 3 必红 + 1 flaky + 5 架构项全数采纳）**：必红 N1-N3——decode.ts input.dispose().catch 残留补修（R1 只修 video-cache 一处）；Task 9 IO effect deps:[] 闭包捕获首渲染 projectData=null → stopMini 空 release，stopMiniRef/projectDataRef 统一三释放入口（N2）；关键帧选中模型定案 selectKeyframe(kfId, clipId) 双写（N3/决策 19，用例改"先选片段再点菱形"）。P1 N4-N6——stretchPcm 尾部断言改 200 样本窗口 max（单点采样 6.4% flaky，N4）；renderLatest 统一 playing tick 与暂停 effect 的 in-flight 去重 + G1 补测（N5/决策 18）；Ruler pointer capture 加 ?.（jsdom 无 PointerCapture，N6）。架构 A1-A5——engine AudioBuffer 单份驻留（pcmCache 删，prepare 即转，N 立减半，A1/决策 6①）；spec 内存预估 86→345.6MB/轨 修正 + 勘误③ + Plan 4 阈值口径同源（A2）；视频取源改 mediabunny UrlSource（HTTP Range，d.ts 实测导出；音频/图片保持 blob；Task 14 加 Range 206 验收，A3/决策 1）；播放中编辑重排 100ms 前沿去抖（A4/决策 6③）；StopwatchButton 改派生布尔订阅（A5/决策 20）。另：迷你播放 loadMediaUrls ref 命中跳过（省重复 RTT）；spec 边界表登记多标签双解码
- **R3 轮审核修订（2026-09-11，R2 修订核验 11/11 落实 + 2 必红 + UrlSource 语义修正 + 3 架构残留全采纳）**：必红——Task 7 FrameRenderDeps 双声明残留删除（R2 改 import 未删旧接口块，TS2300+TS2304）；Task 4 LRU 用例 `_b: Blob` 改 `_url: string`（strictFunctionTypes 逆变）。UrlSource 语义（实测 source.js L699-714）——退化形态更正为"sequential 流式 + 缓存驱逐 + 回拖抛错黑帧"（非"退化为整下载"），决策 1 措辞重写 + Nginx 具体指令（proxy_force_ranges on / Range+If-Range set_header）+ Content-Range CORS 条件（/flowai 同源重写已验，换前缀需 ExposeHeaders）；Task 14 验收升级为服务侧+浏览器侧双验（多次 206 + console 无 range 警告）+ 新增跨缓存回拖 seek 无黑帧终验。自愈缺口（3.3）——video-cache getFrame 捕错 release(mediaId) 重开（含回归用例）；预签名 3600s 过期一期限制登记 spec 边界表。架构残留——prepare 瞬时峰值实测口径（稳态 3-4 倍，替换 spec"×2"）+ Task 14 内存观测项（§4.1 选①）；renderLatest 尾追旧 data 登记于实现注释（§4.2 低危）；A4 验收口径补"拖动过程中允许不同步"（§4.3）。历史小项——Task 12 ClipBlock 补 useRef/useEffect import 说明（五-1）；audio 菱形 title 用"音量"防 undefined（五-2）；scrub 加 scrubActive 守卫（五-3）；hasPcm/releasePcm 语义注释（五-4，Plan 4 消费提示）；纯视频工程建 ctx 偏离正式登记决策 8（五-6）；PreviewPlayer 测试 try/finally + 未用 stopPlayback 导入删除（五-5）
- **R4 轮审核修订（2026-09-11，R3 修订核验 7/7 落实 + Task 9 一根因两必红 + A3 自愈三收口全数采纳）**：必红两处（同根因）——①startMini 的 `await loadMediaUrls()` 先于 `setMiniPlaying(true)`：fireEvent.click 是同步 act 只 flush React 队列、不 flush 用户 promise 续体，点击返回时 miniPlaying 仍 false → 用例 1（画布断言紧跟 click）与用例 4（trigger(false) 时 miniPlayingRef 仍 false，随后微任务 flush 画布出现且无第二次 IO 触发）双双必红——setMiniPlaying(true) 提前至 await 之前（点击即时进播放态，URL 晚到首帧黑底、tick 每帧重读 mediaUrlsRef 到达后自动出画）；②rootRef 声明而增量 JSX 无任何一处挂载（现码 L48 根元素无 ref）→ IO effect 永远早退，用例 4 ioInstances 断言超时且资源纪律③真机整体失效——根元素补 `ref={rootRef}`；③补卸载清理 `useEffect(() => () => { if (miniPlayingRef.current) stopMiniRef.current(); }, [])`（节点删除/画布卸载时不残留 videoCache 条目与 ImageBitmap，deps:[] 经 ref 取最新闭包与 N2 同款）。健壮性三收口——④自愈冷却（坏源 rAF 30-60fps 每秒几十次 release+openSink → retryAfter 2s 冷却 + deps.now 注入可测 + console.warn 诊断痕迹；成功取帧解除冷却、LRU 淘汰不继承冷却、无参 release 会话终结清冷却、带参 release 冷却保留防立即重进再打网络）；⑤openSink rejection 纳入 try（原 `await import`/`new Input` 在 try 外，一 reject 则 getFrame reject 违反"失败→null"契约——openMediabunnySink 整段包 try，const held 窄化闭包）；⑥release 与在途 open 竞态（在途 open 解析后照样 entries.set 复活已释放的 Input/CanvasSink——generations 代数作废，"播放中点关闭"场景即 Task 14 反复进出验收的前置；带参/无参 release 均先物化 keys 再 ++）。小项五条——⑦Task 4 用例 10 适配冷却（now 注入推进时钟）+ 新增竞态用例 11（跑测注释 11 PASS）；⑧Task 11 补 TimelinePanel 头部 import（VideoClip/seekPlayback——现码 L8 仅 Clip，抄写即 TS2304）+ undo/redo 补清 selectedKeyframeId（双写联动不变量收口，Plan 4 消费前）；⑨Task 10 代码块改内联 commit（消除 commitClipPatch 假助手与"勿新增助手函数"注解的"散文对代码块错"自相矛盾——R1-R3 反复踩的形态）；⑩PlayheadLine 无 props 化（data/widthPx 仅喂未被使用的滚动内容宽 w，死代码删除；left = 140 + playhead 换算 px 与 Ruler 同坐标系说明并入挂载点）；⑪Task 13 追加用例复用既有夹具红态（v1.sourceNodeId='s1' 默认即红，getByText 唯一——夹具中仅 v1 带 sourceNodeId）+ 既有夹具红态影响知会登记（render.test 第 3 用例与 interact.test 夹具在本 task 后渲染红标，既有断言不含红标文案不受影响）
- **R5 轮审核修订（2026-09-11，R4 修订核验 11/11 落实 + 1 必红 + 3 收口全数采纳）**：P0 必红（R4 自引入）——release() 内 `generations.clear()` 把同函数刚 bump 的代数抹平：无参路径 keys.forEach(+1) 后紧接 clear，在途 chain 捕获 gen=0、迟到完成时 `undefined ?? 0 = 0` 相等 → 不作废 → entries.set 复活已释放的 Input/CanvasSink，用例 11 的 disposed/size 两断言必红——删 `generations.clear()`（bump 值即作废凭据；保留计数无副作用：重进后新 chain 以 bump 后的值为基准捕获、比对相等正常放行；map 只增媒体数个 number 无内存顾虑；与 retryAfter.clear() 语义区分注释化——源健康度可跨会话清、实例代数不可清）；P1——open 失败路径补冷却（.then 内 `if (!handle)` 分支 set retryAfter：无视频轨/canDecode false/presigned 403 reject 三种来源原来只在 getFrameAt catch 设冷却，.finally 删 opening 后下一帧 renderLatest 再次 openSink，30-60 次/秒——R4④要堵的风暴换了条路径；与 P0 修法正交：用例 11 迟到 handle 非 null 走作废分支不设冷却、用例 5 单次调用不受影响）；P2 两处——Task 8 TimelinePanel 头部 import 目标形态一次写死 `{ useEffect, useMemo, useRef, useState }`（⓪ 项：现码 L1 仅 { useEffect, useRef }，⑤ 的 useState 与 Task 13 的 useMemo 落地即改防两处分别 TS2304）；Task 10 removeKeyframe 改 `as VideoClip` 单型视图（TransformKeyframe[] | VolumeKeyframe[] 联合上调 .filter 触发 TS2349 union 泛型签名互不兼容——与 moveKeyframe 同款谎报，audio 的 VolumeKeyframe 与 id 过滤结构兼容无运行时后果）；P3——Task 4 用例 3 注释修正（首次命中即返、iterator 挂起于 yield 不预取；顺序产出下 next 预存分支不触达，标题改"迭代前进消费下一帧命中"）
- **R6 轮审核修订（2026-09-11，R5 修订核验 4/4 落实 + 3 处 import 缺项（同类第三发）+ 2 条 UI 细节定案）**：import 三处——TrackRow 现码 L1 无 react import（Task 8 ④ memo 化需补 `import { memo } from 'react';`，照 ClipBlock.tsx:19 既有具名内部函数风格保留组件名）；AssetPanel 现码 L1 仅 useState（Task 8 mergeMediaInfo effect 需补 useEffect）；TimelineRuler 现码无 store import（Task 8 自订阅需补 `import { useEditorStore } from '../../store/editorStore';`）+ scrub 改造删原 handlePointer 后 `quantizeTime` import 成孤儿一并删（量化不丢：setPlayhead 内部 quantizeTime，editorStore.ts:131；tsconfig.base 无 noUnusedLocals 非编译红线，按 CLAUDE.md 精准修改清孤儿；既有 `import type React from 'react'` 已支持 React.PointerEvent 注解——现码 L24 先例）。UI 细节两条——Task 11 TrackRow 新 prop 签名写死 `onKeyframePointerDown?: (kfId: string, e: React.PointerEvent<HTMLDivElement>) => void` 且 ClipBlock 渲染处（现码 L60-62）与 onPointerDown 并列透传（只在 TimelinePanel 侧加 handler 断在中层，keyframe-ui.test 三用例全红；ClipBlock prop 注解同步对齐 `<HTMLDivElement>` 泛型——R6 前形态的 TrackRow→ClipBlock 透传是"窄参 handler → bare 槽位"，被逆变拒绝 TS2322；R7 轮 tsc 实证双向并精确化表述：bare handler → 窄参槽位合法（TimelinePanel.tsx:31→TrackRow.tsx:15 现存先例）、窄参 handler → bare 槽位才报错）；Task 13 ClipBlock 边框优先级定案 `missing ? '#EF4444' : selected ? BLOCK_BAR[clip.type] : 'transparent'`（素材缺失是更高优先级告警态，红边压过选中边），Task 14 素材缺失验收按此预期
- **R7 轮审核修订（2026-09-11，R6 修订核验 5/5 落实 + §二逆变方向论断驳回（tsc 实证）+ §三/§四 采纳）**：§二——R7 称 R6 的 strictFunctionTypes 逆变论断方向反了；仓内 tsc scratch 双向实证**维持 R6 原判**：窄参 handler（`PointerEvent<HTMLDivElement>`）赋给 bare 槽位（`PointerEvent<Element>`）报 TS2322（错误消息即 `PointerEvent<Element> is not assignable to PointerEvent<HTMLDivElement>`，R6 前计划形态的 TrackRow→ClipBlock 边界正是此向）；反方向 bare handler 赋给窄参槽位合法——R7 引的 TimelinePanel.tsx:31→TrackRow.tsx:15 现存先例属安全向，与 R6 所修边界不同向，不构成反证。采纳其精神：计划两处注释升级为双向精确表述（防通则误用导致后续反向放宽或不必要 cast）。§三采纳——Task 12 WaveformCanvas 落点写明"文件顶层（模块作用域，与 ClipBlock 同级）"：声明在 ClipBlock 函数体内成嵌套组件定义，每次重渲产生新组件类型 → canvas 子树卸载重建、effect 反复跑（peaks 有缓存不重解码但 DOM 全新）。§四采纳——Task 13 ClipBlockProps 点明增加 `missing?: boolean;` 并参数解构取出（与 Task 11 onKeyframePointerDown 并列，防 prop 链条断中层）
- **执行完成记录（2026-09-11，subagent-driven 14 任务全数落地）**：14 任务 × 两阶段审查（规格符合性 + 质量变异审查）全闭环；执行期修正可追溯——计划笔误/计划-现码矛盾适配 18 处（canvas 漏 ref、测试 TS7006/TS2339、antd Slider 吞 testid、StrictFifoSamplePipe 语法笔误、soundtouch 度量分母、dragState 可选字段等，均各任务报告登记）；变异审查补强守护用例 14 个（字幕恒最后/插值取值/LRU 触尾/prepare 幂等/clipEnd 跳过/perf 时钟/双写联动/undo 清理/拖拽历史/无 url 守卫/插值精度/拷贝语义/scrub 三段式/卸载释放）；执行期实现修复 3 处（transitionEffect crossfade 零重叠白闪 + 类型守卫吞 skipIn 死变量、迷你播放 mediaUrls 陈旧黑帧、flush 失败收起释放）；Task 14 浏览器验收逐项结论与 6 项发现登记见上方执行期验收记录（发现①全集资产范围缺口上报用户裁量）
- **交接 Plan 4**：Worker 导出 controller 复用 scene 纯函数与 renderFrameAt 结构（OfflineAudioContext 路径走 stretchPcm/buildGainPoints 同源）；导出前置校验消费 missingSourceNodeIds；video-cache RETRY_COOLDOWN_MS 冷却（取帧失败 + open 失败双路径）与 generations 作废语义随 Task 4 契约继承（导出路径消费 getFrame 同样受冷却保护）

## 后续 Plan（另开文件）

- Plan 4/4：Worker 导出（mediabunny Output/编码/polyfill/进度）+ 产物登记上画布 + socket 单例迁移（5 创建点）+ AI 三按钮（A1 影子节点消费 Plan 1 regenerate 端点 + Plan 2 onRemote 短路）+ 导出前置校验 + 29 条完整验收


---
