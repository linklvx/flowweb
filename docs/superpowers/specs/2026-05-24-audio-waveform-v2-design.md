<!-- doc-status: historical | verified_at: n/a -->
# Audio Waveform V2 — 固定采样 + 自定义 Canvas 渲染

## 概述

**问题**：wavesurfer.js 根据音频时长自动生成采样点，3 分钟音频产生 ~18000 点压缩到 400px 容器中，波形条拥挤，用户体验差。

**方案**：混合架构 — wavesurfer.js 仅作为音频引擎（解码、播放、seek），自定义 Canvas 渲染固定 250 个采样点的波形。播放头固定在 Canvas 中央，波形从右向左滚动。

**设计决策记录：**
- 架构：混合（wavesurfer 引擎 + 自定义 Canvas 渲染）
- 峰值数据源：`wavesurfer.getDecodedData()` → AudioBuffer → 分桶计算峰值
- 滚动行为：模式 B（固定光标 + 波形滚动）
- 配色：参考平台青色主题（#38bdf8）
- Seek 交互：拖拽 Seek（对齐参考平台）
- 布局：保留当前布局（播放按钮 + 时间文字在波形下方）

---

## 架构

```
AudioWaveform.tsx
├── @wavesurfer/react (useWavesurfer)  ← 音频引擎：解码、播放、seek、时间
├── Canvas (自绘)                      ← 波形渲染：250固定采样点、滚动、播放头
├── DOM 覆盖层                         ← 播放头三角 + 时间 tooltip（不画在 Canvas）
├── useAudioStore                      ← 状态管理：不变
├── useWaveformPeaks                   ← 峰值计算 hook（缓存 + 归一化）
├── useCanvasRenderer                  ← Canvas 渲染 + rAF 滚动循环
├── useDragSeek                        ← 拖拽 Seek + 捕获阶段事件隔离
└── formatDuration                     ← 时间格式化：不变
```

### 数据流

```
音频加载
  → wavesurfer 解码（Web Audio API）
  → getDecodedData() → AudioBuffer
  → useWaveformPeaks: 分 250 段 → 每段取 max amplitude → 归一化到 0~1 → 缓存
  → useCanvasRenderer: Canvas 2D 绘制 250 条波形
  → 播放时 rAF 循环: wavesurfer.getCurrentTime() → translateX → 重绘
  → 拖拽 Seek: 像素偏移 → 时间 → wavesurfer.seekTo()
```

---

## 视觉规格

### 配色

| 元素 | 值 |
|---|---|
| 波形背景 | `#1f1f1f`，borderRadius 12 |
| 未播放波形条（播放头右侧） | `#ffffff` |
| 已播放波形条（播放头左侧） | `#38bdf8`（青色） |
| 播放头三角 + 竖线 | `#38bdf8` |
| 时间 tooltip 背景 | `#38bdf8` |
| 时间 tooltip 文字 | `#0f172a`（深色） |
| 边缘渐变 | 左右 10% 淡出到 `#1f1f1f` |

### 核心渲染规则：已播放 / 未播放

**模式 B（滚动波形）的正确规则：**

播放头固定在 Canvas 水平中央。渲染时以播放头位置为界：
- **播放头左侧 → 青色**（#38bdf8，已播放）
- **播放头右侧 → 白色**（#ffffff，未播放）

每次 rAF 重绘时，Canvas 整体 translateX 偏移，但颜色切分线始终在 Canvas 中央（播放头位置）。

### 尺寸

| 元素 | 值 |
|---|---|
| 节点总高度 | 180px（波形 120px + 控制栏 60px） |
| 节点宽度 | 400px（不变） |
| 波形区域高度 | 120px |
| Canvas 原始宽度 | 2000px（250 bars × 4px × 2 倍 retina） |
| Canvas 原始高度 | 240px（120px × 2 倍 retina） |
| Canvas CSS 宽度 | 1000px |
| Canvas CSS 高度 | 120px |
| 容器可视宽度 | CSS 变量 `--waveform-visible-width`（初值 ~340px），overflow:hidden |
| 波形条宽度 | 3px |
| 波形条间距 | 1px |
| 波形条圆角 | 2px |
| 波形条最小高度 | 2px（静音区域显示小圆点） |
| 播放头竖线宽度 | 2px（hover 时 4px） |

### 高清屏适配

```typescript
const dpr = window.devicePixelRatio || 1;
canvas.width = 1000 * dpr;   // 原始像素
canvas.height = 120 * dpr;
canvas.style.width = '1000px';
canvas.style.height = '120px';
ctx.scale(dpr, dpr);
```

---

## 播放头（DOM 层渲染）

播放头三角 + 时间 tooltip 使用 DOM 元素叠加在 Canvas 上方，不画在 Canvas 中。

### 结构

```html
<div class="playhead" style="position:absolute; left:50%; top:0; bottom:0; transform:translateX(-50%)">
  <!-- 三角箭头 -->
  <svg width="10" height="6" class="shrink-0">
    <path d="M0 0h10L5 6z" fill="#38bdf8" />
  </svg>
  <!-- 竖线：垂直居中、贯穿整个波形高度 -->
  <div class="playhead-line"
       style="width:2px; flex:1; background:#38bdf8; border-radius:1px;
              transition: width 150ms"
       onMouseEnter → width:4px
  />
  <!-- 时间 tooltip（hover 时显示） -->
  <div class="playhead-tooltip" style="opacity:0; group-hover:opacity:100">
    <svg width="8" height="4"><path d="M0 4L4 0l4 4z" fill="#38bdf8" /></svg>
    <span style="background:#38bdf8; color:#0f172a">01:23 / 03:00</span>
  </div>
</div>
```

---

## 布局

```
┌──────────────────────────────────────┐
│  [边缘渐变L]  波形 Canvas (120px)  [边缘渐变R]  │
│              播放头（DOM覆盖）        │
├──────────────────────────────────────┤
│           ▶  /  ⏸  (40×40 SVG)      │  ← 60px 控制栏
│        01:23 / 03:00                │
└──────────────────────────────────────┘
节点总高度: 180px（120 + 60）
```

---

## 组件与 Hooks

### AudioWaveform.tsx（重写）

保持与 Phase 1 相同的 props 接口和 store 集成，内部渲染层替换为 Canvas + DOM 覆盖。

```typescript
export interface AudioWaveformProps {
  nodeId: string;
  audioUrl: string;
  waveformUrl?: string; // Phase 2: pre-generated peaks URL
  onError?: (error: Error) => void;
}
```

### useWaveformPeaks

```typescript
function useWaveformPeaks(
  wavesurfer: WaveSurfer | null,
  audioUrl: string,
  count: number = 250
): number[]  // 0~1 归一化峰值数组
```

- 从 `wavesurfer.getDecodedData()` 获取 AudioBuffer
- 将音频数据分 `count` 段，每段取最大绝对值
- 归一化到 0~1（除以全局最大值）
- **缓存**：同一 `audioUrl` 不重复计算（Map 缓存）
- 静音区域峰值接近 0，渲染为最小高度条（barMinHeight）

### useCanvasRenderer

```typescript
function useCanvasRenderer(
  canvasRef: RefObject<HTMLCanvasElement>,
  peaks: number[],
  wavesurfer: WaveSurfer | null,
  isPlaying: boolean,
  duration: number,
  visibleWidth: number
): void
```

- 高清屏适配：`canvas.width = 1000 * dpr`，`ctx.scale(dpr, dpr)`
- 绘制 250 条波形，barWidth=3, barGap=1, barRadius=2
- 以 Canvas 中央为界切分颜色（左侧青色，右侧白色）
- 播放时 rAF 循环：根据 `currentTime / duration` 计算 translateX → 重绘
- **暂停/停止时停止 rAF**，避免后台浪费 CPU
- **组件卸载/节点隐藏时取消 rAF**，防止内存泄漏

### useDragSeek

```typescript
function useDragSeek(
  canvasRef: RefObject<HTMLCanvasElement>,
  wavesurfer: WaveSurfer | null,
  isReady: boolean,
  duration: number
): { isDragging: boolean }
```

- **捕获阶段** `mousedown` 监听：`addEventListener('mousedown', handler, true)`
- mousedown → `e.stopPropagation()` → 标记 dragging
- **mousemove / mouseup 绑定到 `window`**（防拖出画布失控）
- 像素偏移 → 时间：`time = (offsetX / canvasWidth) * duration`
- **边界锁定**：clamp 到 0% ~ 100%
- **window.blur** 事件结束拖拽（用户 Alt+Tab 等场景）
- 拖拽过程中光标变为 `grabbing`

### 事件隔离双保险

```typescript
// 1. React Flow 官方规则
<canvas ref={canvasRef} className="nodrag" style={{ cursor: 'grab' }} />

// 2. 捕获阶段阻止冒泡
canvasRef.current?.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  // ...进入拖拽 seek 模式
}, true); // capture phase
```

---

## 鲁棒性

### 解码失败兜底

```
wavesurfer.on('error') → setUseFallback(true) → 渲染 <audio controls>
```

保持 Phase 1 的错误处理逻辑不变。

### 内存管理

- rAF 循环：暂停时 `cancelAnimationFrame`，组件卸载时清理
- 峰值缓存：Map<audioUrl, peaks>，`unregisterNode` 时清除对应缓存
- wavesurfer 生命周期：仍由 audioStore.unregisterNode 管理

### 边界情况

- 拖拽鼠标移出浏览器窗口 → `window.mouseup` 结束拖拽
- 拖拽中切换窗口（Alt+Tab）→ `window.blur` 结束拖拽
- 音频 duration 为 0 → 波形全部白色，播放头居中，禁用交互
- 容器 resize → 重新计算 visibleWidth（CSS 变量），rAF 自动适配

---

## 边缘渐变

DOM 覆盖层实现（非 Canvas），精准遮罩范围：

```css
background: linear-gradient(
  to right,
  #1f1f1f 0%,      /* 0%: 完全不透明 */
  transparent 10%,  /* 10%: 完全透明 */
  transparent 90%,  /* 90%: 完全透明 */
  #1f1f1f 100%      /* 100%: 完全不透明 */
);
```

两个 `<div>` 覆盖在 Canvas 左右两侧，`pointer-events: none`，`z-index` 高于 Canvas。

---

## 与 Phase 1 的变更范围

| 文件 | 变更 | 说明 |
|---|---|---|
| `AudioWaveform.tsx` | **重写** | Canvas + DOM 渲染替代 wavesurfer 渲染 |
| `useWaveformPeaks.ts` | **新建** | 峰值计算 + 缓存 |
| `useCanvasRenderer.ts` | **新建** | Canvas 2D 绘制 + rAF 滚动 |
| `useDragSeek.ts` | **新建** | 拖拽 Seek + 事件隔离 |
| `AudioWaveform.test.tsx` | **重写** | 适配新渲染层 |
| `AudioGenNode.tsx` | **微调** | NODE_HEIGHT 260 → 180 |
| `audioStore.ts` | **不变** | - |
| `formatDuration` | **不变** | - |
| `package.json` | **不变** | wavesurfer.js 保留 |

---

## 成功标准

1. **波形密度一致**：10 秒和 10 分钟音频，波形条视觉效果一致（均为 250 条）
2. **播放头居中滚动**：播放时光标固定在 Canvas 中央，波形从右向左滚动
3. **拖拽 Seek**：拖拽波形可定位，不触发节点拖动
4. **事件隔离**：波形上的所有交互不影响 React Flow 画布
5. **高清屏清晰**：Retina 屏幕波形无模糊
6. **错误兜底**：解码失败自动切换到原生 `<audio>` 控件
7. **所有现有测试通过**：audioStore、AudioGenNode 测试不受影响

---

## 落地优化（代码层补充，不改动架构）

### 1. 静音音频兜底
```typescript
// useWaveformPeaks — 全静音音频也保留最小高度
peaks[i] = Math.max(max, 0.05);
```

### 2. 拖拽 Seek 节流
```typescript
// useDragSeek — 10ms 节流防高频 seek 卡顿
import { throttle } from 'lodash';
const onMouseMove = throttle(handleSeek, 10);
```

### 3. rAF 播放状态严格控制
```typescript
// useCanvasRenderer — 仅播放中启动循环，暂停立即取消
if (!isPlaying || !wavesurfer) {
  cancelAnimationFrame(rafRef.current);
  return;
}
```

### 4. 播放头 hover 丝滑过渡
```css
.playhead-line {
  transition: width 150ms cubic-bezier(0.25, 0.1, 0.25, 1);
}
```

### 5. 边缘渐变拆分为左右独立遮罩
```tsx
// 左遮罩：向右淡出
<div style={{ background: 'linear-gradient(to right, #1f1f1f 0%, transparent 10%)' }} />
// 右遮罩：向左淡出
<div style={{ background: 'linear-gradient(to left, #1f1f1f 0%, transparent 10%)' }} />
```

### 6. 播放头 DOM 不拦截鼠标事件
```tsx
<div className="playhead" style={{ pointerEvents: 'none' }}>
```

### 7. 峰值缓存 LRU 限制
```typescript
// useWaveformPeaks — 最多 50 条，防止无限画布内存溢出
const MAX_CACHE_SIZE = 50;
if (cache.size > MAX_CACHE_SIZE) {
  const firstKey = cache.keys().next().value;
  cache.delete(firstKey);
}
```

### 8. 进度变化才重绘
```typescript
// useCanvasRenderer — 进度无变化跳过重绘，减少 90% 无效渲染
const lastProgressRef = useRef(-1);
const currentProgress = currentTime / duration;
if (Math.abs(currentProgress - lastProgressRef.current) < 0.001) {
  animationRef.current = requestAnimationFrame(render);
  return;
}
lastProgressRef.current = currentProgress;
```
