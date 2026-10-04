<!-- doc-status: historical | verified_at: n/a -->
# Audio Waveform Design (Phase 1 — Frontend Only)

**Date:** 2026-05-24
**Status:** Design Approved
**Context:** AudioGenNode 上传音频后实现波形可视化与拖拽播放

## 1. 整体架构

```
前端 (apps/web) — Phase 1 实现范围
┌──────────────────┐  ┌──────────────┐
│ AudioGenNode.tsx  │  │ audioStore   │
│ (修改) 400×260    │◄►│ (新建)        │
│ + AudioWaveform   │  │ 仅运行时状态   │
└──────┬───────────┘  │ 不持久化       │
       │              └──────────────┘
┌──────┴───────────┐
│ AudioWaveform.tsx │
│ (新建)             │
│ Phase 1: 前端解码  │
│ Phase 2: 后端peaks │
└──────────────────┘
       │ HTTP
       ▼
后端 — Phase 1 无修改，仅提供音频文件 HTTP 下载
后端 — Phase 2 新增: AudioController, AudioService, BullMQ, MinIO waveforms, Prisma migration
```

## 2. 状态边界（严格隔离）

### nodeStore.ts — 持久化状态（存档到 DB）
- `AudioNodeData.fileId` — AI 生成结果
- `AudioNodeData.referenceAudio` — 用户上传的音频
- `AudioNodeData.status` — idle | loading | done | error
- 用户编辑的标题（label state in component）

### audioStore.ts — 运行时状态（不持久化）
- `Map<nodeId, { wavesurfer, isPlaying, currentTime, duration }>`
- `activeNodeId: string | null`
- `isGlobalPlaying: boolean`
- Actions: `registerNode`, `unregisterNode` (含 destroy), `setWavesurfer`, `togglePlay`, `seekNode`, `updateNodeState`

**Phase 1 不修改 nodeStore.ts — waveformUrl 字段留到 Phase 2。**

## 3. 组件结构

### AudioGenNode (修改)

```
┌─────────────────────────────────────┐
│  [Handle]  🎵 标题 (可编辑)  替换   │
├─────────────────────────────────────┤
│  AudioWaveform (260px 高度区)       │
│  ┌─────────────────────────────┐    │
│  │  波形容器 #2d2d2d, r=12px   │    │
│  │  padding: 16px 0, h=120px   │    │
│  │  wavesurfer 渲染 88px        │    │
│  │  cursor: pointer            │    │
│  │  拖拽波形 = seekTo          │    │
│  │  加载中 → Spin overlay       │    │
│  │  出错 → 降级 <audio>        │    │
│  │  ▶/⏸ 40px 居中 (Ant Design) │    │
│  │  00:00 / 00:00              │    │
│  └─────────────────────────────┘    │
├─────────────────────────────────────┤
│  AudioConfigPanel (不变)            │
└─────────────────────────────────────┘
```

- 尺寸: 380×170 → 400×260 (宽 400, 高 260)
- 选中边框: 选 #9CA3AF 3px, 未选 #3F3F46 1px (同现有)
- Handle 颜色: #4ade80 (同现有)
- uploaded/replaced state: 保持不变, `showReplaceButton = !resultUrl && !!referenceAudio && !!displayUrl`
- 错误降级: `const [useFallback, setUseFallback] = useState(false)`
  - `useFallback === true` → 渲染 `<audio controls>` 替代 AudioWaveform
- Phase 2 预留: 透传 `waveformUrl={data.waveformUrl}` (当前为 undefined)

### AudioWaveform (新建)

- 依赖 `@wavesurfer/react` 的 `useWaveSurfer` Hook
- Props: `{ nodeId, audioUrl, waveformUrl?, onError? }`
- wavesurfer 容器: `#2d2d2d`, `border-radius: 12px`, `padding: 16px 0`, `height: 120px`, `box-sizing: border-box`
- wavesurfer 配置:
  - `waveColor: '#ffffff'`, `progressColor: '#ff3333'`, `cursorColor: '#ff3333'`
  - `cursorWidth: 2`, `barWidth: 3`, `barGap: 1`, `barRadius: 2`
  - `height: 120`, `backend: 'WebAudio'`, `responsive: true`
  - `normalize: true`, `autoplay: false`
  - `interact: true` (允许拖拽跳转)
  - Phase 1: `peaks: undefined` (前端解码)
  - Phase 2: `peaks: await fetch(waveformUrl).then(r => r.json())`
- 播放控制: Ant Design `PlayCircleFilled` / `PauseCircleFilled`, 40px 居中
- 时间显示: `formatTime(currentTime) / formatTime(duration)`, 左下角
- finish 事件: `wavesurfer.on('finish', () => audioStore.updateNodeState(nodeId, { isPlaying: false }))`

## 4. 关键稳定性措施（全部必须实现）

### 4.1 事件隔离
根容器阻止全部鼠标/触摸事件冒泡:
- `onMouseDown`, `onMouseMove`, `onMouseUp`, `onMouseLeave` → `e.stopPropagation()`
- `onTouchStart`, `onTouchMove`, `onTouchEnd` → `e.stopPropagation()`

### 4.2 画布缩放适配
```ts
const { viewport } = useReactFlow();
useEffect(() => {
  if (wavesurfer && containerRef.current) { wavesurfer.resize(); }
}, [viewport.zoom, wavesurfer]);
```

### 4.3 播放状态边缘处理
- 加载中禁止播放: `if (!isReady) return;`
- `autoplay: false` — 不触发浏览器自动播放拦截

### 4.4 错误降级（双重监听）
1. `useWaveSurfer` 返回的 `error` → `setUseFallback(true)`
2. `wavesurfer.on('error', ...)` → `setUseFallback(true)`

### 4.5 内存泄漏终极防护
- audioStore `unregisterNode`: `stop()` → `destroy()` → `= null` (try/catch)
- AudioWaveform `useEffect` cleanup: `wavesurfer?.destroy()` (双重保险)

## 5. 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/web/package.json` | 修改 | `wavesurfer.js@^7.8.1` + `@wavesurfer/react@^1.0.8` |
| `apps/web/src/stores/audioStore.ts` | **新建** | 运行时播放状态 (Zustand) |
| `apps/web/src/stores/audioStore.test.ts` | **新建** | Store 单元测试 |
| `apps/web/src/pages/canvas/components/nodes/AudioWaveform.tsx` | **新建** | 波形+播放控制+时间+降级 |
| `apps/web/src/pages/canvas/components/nodes/AudioWaveform.test.tsx` | **新建** | 波形组件测试 |
| `apps/web/src/pages/canvas/components/nodes/AudioGenNode.tsx` | 修改 | 380→400×260, 集成 AudioWaveform |
| `apps/web/src/pages/canvas/components/nodes/AudioGenNode.test.tsx` | 修改 | 覆盖波形集成测试 |

**Phase 1 坚决不改:** nodeStore.ts, 后端代码, Prisma schema, BullMQ

## 6. Phase 2 预留接口

所有 Phase 2 接口在 Phase 1 中已预留，升级时无需重构:

```ts
// AudioWaveformProps
interface AudioWaveformProps {
  nodeId: string;
  audioUrl: string;
  waveformUrl?: string;  // Phase 2: 从 nodeStore.data.waveformUrl 传入
  onError?: (error: Error) => void;
}

// AudioGenNode 透传 (Phase 1 传 undefined)
<AudioWaveform
  nodeId={id}
  audioUrl={displayUrl}
  waveformUrl={data.waveformUrl}  // Phase 1: undefined → 前端解码
  onError={() => setUseFallback(true)}
/>

// Phase 2: 后端预生成完 waveformUrl 后，用户重新打开节点时
// useWaveSurfer 自动从 MinIO 加载 peaks，跳过前端解码
```

### MinIO CORS 注意事项
- Phase 1 使用 wavesurfer 前端 WebAudio 解码，需确认 MinIO 已配置 CORS 允许前端域名
- useMediaUrl 返回预签名 URL (7天过期)，过期后 wavesurfer 加载失败会触发降级

## 7. TDD 流程

严格遵守红-绿-重构:

1. `audioStore.ts` 先写测试 → 测试红 → 实现 → 测试绿
2. `AudioWaveform.tsx` 先写测试 → 测试红 → 实现 → 测试绿
3. `AudioGenNode.tsx` 修改 → 更新测试 → 确保已有测试仍绿
4. 全部 381+ 测试通过 → 提交
