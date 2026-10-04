<!-- doc-status: historical | verified_at: n/a -->
# Plan: 视频裁剪缩略图时间轴 + 白色选区样式

**日期**: 2026-07-02
**Spec**: `docs/superpowers/specs/2026-07-02-video-trim-thumbnail-timeline.md`
**原则**: TDD 红-绿-重构，先测试→确认失败→写实现→测试通过→提交

---

## 任务概览

| Task | 内容 | 文件 | 预估 |
|------|------|------|------|
| 1 | `useThumbnails` hook | 新建 2 文件 | 1.5h |
| 2 | `VideoTrimTimeline` 组件 | 新建 2 文件 | 2h |
| 3 | `VideoTrimPanel` 集成 | 修改 2 文件 | 1h |
| 4 | 验证 + 清理 | 运行测试 | 0.5h |

---

## Task 1: `useThumbnails` hook

### 文件

- **新建** `apps/web/src/hooks/useThumbnails.ts`
- **新建** `apps/web/src/hooks/useThumbnails.test.ts`

### 接口

```typescript
interface UseThumbnailsOptions {
  videoSrc: string | null | undefined;  // 视频源 URL
  duration: number;                      // 视频时长（秒）
}

interface UseThumbnailsResult {
  thumbnails: string[];                  // dataURL 数组
  loading: boolean;                      // 是否正在抽取
  error: boolean;                        // 是否抽取失败（降级）
}
```

### 内部逻辑

1. `videoSrc` 无效或 `duration < 1` → 返回空数组 + `loading: false`
2. 检查模块级 LRU 缓存（`Map<string, string[]>`，max 5），命中直接返回
3. 创建独立 `<video>`：`muted`, `playsInline`, `preload="auto"`, `crossOrigin="anonymous"`
4. 等待 `loadedmetadata`（3s 超时）→ 失败则释放 video + `error: true`
5. 串行抽帧：`for i in 0..count` → `video.currentTime = t` → `await seeked` → `drawCover(canvas)` → `toDataURL('image/jpeg', 0.6)` → 逐帧回调
6. 抽帧数：duration < 2s → 10 张；≥ 2s → 20 张
7. 每帧前后检查 `isMountedRef.current`，false 则中断
8. cleanup：`video.pause(); video.src = ''; video.load()`

### Canvas 规格

- 固定离屏 Canvas 尺寸：**40px × 60px**（与时间轴高度对齐，兼顾清晰度与文件体积）
- 单次抽帧任务内**复用同一个** Canvas 元素，禁止循环内重复创建
- 任务结束或组件卸载时释放 canvas 引用

### drawCover 函数

```typescript
const CANVAS_W = 40, CANVAS_H = 60;

function drawCover(video: HTMLVideoElement, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  const vw = video.videoWidth, vh = video.videoHeight;
  const scale = Math.max(CANVAS_W / vw, CANVAS_H / vh);
  const sw = vw * scale, sh = vh * scale;
  const sx = (CANVAS_W - sw) / 2, sy = (CANVAS_H - sh) / 2;
  ctx.drawImage(video, sx, sy, sw, sh);
}
```

### LRU 缓存实现

模块级缓存采用「命中即移至末尾」的标准 LRU 策略：

```typescript
const cache = new Map<string, string[]>();
const MAX_CACHE = 5;

function getCached(src: string): string[] | undefined {
  const entry = cache.get(src);
  if (entry) {
    // 命中：重新插入末尾（Map keys 按插入顺序迭代）
    cache.delete(src);
    cache.set(src, entry);
  }
  return entry;
}

function setCache(src: string, thumbnails: string[]): void {
  if (cache.has(src)) cache.delete(src);
  else if (cache.size >= MAX_CACHE) {
    // 淘汰最旧条目（Map 第一个 key）
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(src, thumbnails);
}
```

### loadedmetadata 超时实现

```typescript
function waitForMetadata(video: HTMLVideoElement, timeoutMs = 3000): Promise<void> {
  return Promise.race([
    new Promise<void>((resolve) => { video.addEventListener('loadedmetadata', () => resolve(), { once: true }); }),
    new Promise<void>((_, reject) => { setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs); }),
  ]);
}
```

超时或失败后统一执行释放逻辑：`video.pause(); video.src = ''; video.load()`

### 测试用例 (useThumbnails.test.ts)

| # | 测试 | 验证 |
|---|------|------|
| 1 | `videoSrc` 为 null → 空数组 + loading:false | 不创建 video 元素 |
| 2 | `duration < 1` → 空数组 + loading:false | 不启动抽帧 |
| 3 | `duration >= 2` → 返回 20 张缩略图 | 数组长度 = 20 |
| 4 | `duration < 2 && >= 1` → 返回 10 张缩略图 | 数组长度 = 10 |
| 5 | 同 videoSrc 调用两次 → 第二次命中缓存 | mock 抽取只执行一次 |
| 6 | 第 6 个不同 videoSrc → LRU 淘汰最旧 | 缓存 size ≤ 5 |
| 7 | loadedmetadata 3s 超时 → error:true + 释放 video | error = true |
| 8 | 组件 unmount 中止抽帧 → 检查取消标志 | thumbnails 不完整但无报错 |
| 9 | canvas drawImage 抛 SecurityError → error:true | 异常被捕获 |
| 10 | cover 模式缩放 → 绘制坐标计算正确 | drawImage 参数验证 |

---

## Task 2: `VideoTrimTimeline` 组件

### 文件

- **新建** `apps/web/src/pages/canvas/components/nodes/VideoTrimTimeline.tsx`
- **新建** `apps/web/src/pages/canvas/components/nodes/VideoTrimTimeline.test.tsx`

### Props

```typescript
interface VideoTrimTimelineProps {
  duration: number;
  videoSrc: string | null | undefined;
  trimStart: number;
  trimEnd: number;
  onRangeChange: (start: number, end: number) => void;
  disabled?: boolean;  // isProcessing 时为 true
}
```

### DOM 结构与层叠顺序

层叠从下到上，交互逻辑内聚：

```
容器 (relative, h-[60px], rounded-[6px], overflow-hidden, bg-[#1a1a1a], nodrag nopan nowheel)
├── 缩略图层 (absolute inset-0, flex, z-0)
│   └── {thumbnails.map(src => <img src={src} />)}
│       CSS: flex:1, object-fit:cover, &:not(:last-child){border-right:1px solid rgba(255,255,255,0.1)}
├── 选区高亮层 (absolute, top-0 bottom-0, z-10, pointer-events: none)
│   纯视觉展示，不拦截任何点击事件
│   CSS: border-2 border-white, bg-white/15
│   left/width 由 trimStart/trimEnd 百分比计算
├── 点击热区层 (absolute inset-0, z-20)
│   统一接收所有点击事件，内部逻辑判断是否处理
│   onClick: 计算时间 → < trimStart→移左手柄 / > trimEnd→移右手柄 / 区间内→无操作
│   e.stopPropagation() 阻断画布事件
├── 左手柄 (absolute, top-[-3px], bottom-[-3px], z-30)
│   ├── 视觉线: w-[3px] bg-white, 居中
│   ├── 顶部圆点: w-[8px] h-[8px] rounded-full bg-white, shadow: 0 0 4px rgba(0,0,0,0.5)
│   └── 热区: w-[16px] (触屏 24px), 透明, 居中, touch-action: none
│   pointerdown → 开始拖拽 + e.stopPropagation() + e.preventDefault()
└── 右手柄 (同上)
```

### 定位规则

- 选区与手柄水平位置**统一使用百分比**计算：`left: ${(time / duration) * 100}%`
- 禁止使用固定像素定位，保证容器宽度变化时自动适配
- 选区宽度：`width: ${((trimEnd - trimStart) / duration) * 100}%`

### 拖拽逻辑（受控组件 + DOM 直刷）

核心原则：**拖拽全程保持视频预览实时联动**，与原 Slider 行为完全一致。

1. 组件为**受控组件**：手柄/选区位置最终由 `trimStart`/`trimEnd` props 决定
2. `pointerdown` 在手柄热区 → 记下拖拽中的手柄 (left/right) + 初始 X + `e.stopPropagation()` + `e.preventDefault()`
3. window 绑定 `pointermove`：
   - 计算 deltaX → 转换为时间偏移 → clamp → 内部 ref 记录临时值
   - **直接操作 DOM** 更新手柄与选区位置（保证跟手性，抵消 React 渲染延迟）
   - **同时通过 `requestAnimationFrame` 节流调用 `onRangeChange`**，通知父组件更新视频实时 seek 预览
4. window `pointerup` → 解绑事件 → **最终触发一次 `onRangeChange`**，保证状态收敛与父组件完全同步

### MIN_GAP 约束

- **复用** `VideoTrimPanel` 中导出的 `MIN_GAP` 常量（`export const MIN_GAP = 0.5`），禁止组件内重复定义
- 左手柄最大值：`trimEnd - MIN_GAP`
- 右手柄最小值：`trimStart + MIN_GAP`

### 点击逻辑

```
clickX → 时间 = (clickX / 容器宽) * duration
if 时间 < trimStart → onRangeChange(时间, trimEnd)
if 时间 > trimEnd → onRangeChange(trimStart, 时间)
否则 → 无操作
```

### 禁用态

`disabled=true` 时：容器 `opacity: 0.6`，手柄 `cursor: not-allowed`，拖拽和点击均无响应

### 测试用例 (VideoTrimTimeline.test.tsx)

| # | 测试 | 验证 |
|---|------|------|
| 1 | 基本渲染 | 容器存在 + 高度 60px + 圆角 + overflow:hidden |
| 2 | 缩略图加载中 | loading skeleton 或占位 |
| 3 | 缩略图渲染 | 20 张 img 渲染 + 帧间分割线 border-right |
| 4 | 缩略图降级 | 无 videoSrc → 纯色背景 #1a1a1a |
| 5 | 选区高亮框位置 | left/width 正确对应 trimStart/trimEnd |
| 6 | 手柄渲染 | 左右手柄各含视觉线 + 顶部圆点 |
| 7 | 拖拽左手柄 | pointerdown → pointermove → onRangeChange 被调用 |
| 8 | 拖拽右手柄 | 同上 |
| 9 | 拖拽边界 clamp | 拖到 < 0 或 > duration 被 clamp |
| 10 | 点击左侧区域 | click < trimStart → onRangeChange(新值, trimEnd) |
| 11 | 点击右侧区域 | click > trimEnd → onRangeChange(trimStart, 新值) |
| 12 | 点击选区内部 | click 在 [trimStart, trimEnd] → onRangeChange 不调用 |
| 13 | stopPropagation | pointerdown 和 click 不要冒泡到画布 |
| 14 | 禁用状态 | disabled → 拖拽/点击无响应 + opacity:0.6 |
| 15 | window 解绑 | pointerup 后移除 window 事件 |
| 16 | 手柄热区宽度 | 热区 16px+，视觉线 3px |
| 17 | MIN_GAP 约束 | 拖拽中左右手柄间距 ≥ 0.5s |
| 18 | rAF 节流 | 同一帧内多次 pointermove 只调用一次 onRangeChange |

---

## Task 3: `VideoTrimPanel` 集成

### 文件

- **修改** `apps/web/src/pages/canvas/components/nodes/VideoTrimPanel.tsx`
- **修改** `apps/web/src/pages/canvas/components/nodes/VideoTrimPanel.test.tsx`

### 改动内容

**移除**：
- `import { Slider } from 'antd'`，保留 `import { Button } from 'antd'`
- `<Slider range ...>` 段及其外层 div
- `handleChange` useCallback（Slider 专用，不再需要）

**导出**：
- `const MIN_GAP` → `export const MIN_GAP = 0.5`（供 VideoTrimTimeline 导入复用）

**新增**：
- `import { VideoTrimTimeline } from './VideoTrimTimeline'`
- 视频源动态监听：通过 `useEffect` 监听 `videoRef.current?.src` 变化，动态更新传入子组件的 `videoSrc`；src 为空时自动走纯色降级
- 内部 state：`const [range, setRange] = useState<[number, number]>([safeStart, safeEnd])`（保持）

**状态复用规则**：完全复用原 Panel 内部的 `range` state、`isProcessing` 计算、时间格式化逻辑，**仅替换 UI 渲染部分**（Slider → VideoTrimTimeline），不改动任何状态更新与业务回调。

**新增 state + effect**：
```tsx
// 视频源动态监听
const [videoSrc, setVideoSrc] = useState<string | null>(null);

useEffect(() => {
  const src = videoRef?.current?.src ?? null;
  setVideoSrc(src);
  // 监听后续变化
  const vid = videoRef?.current;
  if (!vid) return;
  const observer = new MutationObserver(() => {
    if (vid.src) setVideoSrc(vid.src);
  });
  observer.observe(vid, { attributes: true, attributeFilter: ['src'] });
  return () => observer.disconnect();
}, [videoRef]);
```

**替换**：
- Slider 区域替换为 `<VideoTrimTimeline>`
  ```tsx
  <VideoTrimTimeline
    duration={safeDuration}
    videoSrc={videoSrc}
    trimStart={range[0]}
    trimEnd={range[1]}
    onRangeChange={(start, end) => {
      setRange([start, end]);
      onRangeChange?.(start, end);
    }}
    disabled={isProcessing}
  />
  ```

### 测试用例更新 (VideoTrimPanel.test.tsx)

- 移除 antd Slider mock（保留 Button mock）
- Mock `VideoTrimTimeline` → 简单 div + data-testid
- 保留所有现有通过测试（时间格式化、按钮行为、键盘快捷键、错误状态等）
- 新增：验证 `VideoTrimTimeline` 收到正确 props
- 新增：`onRangeChange` 回调正确联动

| # | 测试 | 验证 |
|---|------|------|
| 1 | 渲染 VideoTrimTimeline | timeline 组件存在 |
| 2 | props 传递正确 | duration/videoSrc/trimStart/trimEnd/disabled 传递 |
| 3 | onRangeChange 联动 | 时间轴回调 → setRange + 外部 onRangeChange |
| 4-13 | 保留所有原有测试 | 按钮、键盘、格式、状态文本…全部通过 |

---

## Task 4: 验证

### 验证命令

```bash
# 单元测试
cd apps/web && npx vitest run --reporter=verbose

# 单独跑新增/修改的测试文件
cd apps/web && npx vitest run --reporter=verbose \
  src/hooks/useThumbnails.test.ts \
  src/pages/canvas/components/nodes/VideoTrimTimeline.test.tsx \
  src/pages/canvas/components/nodes/VideoTrimPanel.test.tsx

# TypeScript 类型检查
cd apps/web && npx tsc --noEmit
```

### 验证清单

**自动化验证**：

| # | 检查项 | 命令/方法 |
|---|--------|-----------|
| 1 | 所有已有测试通过 | `npx vitest run` |
| 2 | 新增测试全部通过 | 同上 |
| 3 | TypeScript 无错误 | `npx tsc --noEmit` |
| 4 | 无 console.error/warning | 观察测试输出 |

**手动验证（真实浏览器）**：

| # | 验证场景 | 验证点 |
|---|----------|--------|
| 5 | 真实视频抽帧效果 | 缩略图连续无变形、数量正确（≥2s→20张，<2s→10张） |
| 6 | 拖拽跟手性 | 手柄无延迟、不卡顿，鼠标移出时间轴拖拽仍连贯 |
| 7 | 视频同步预览 | 拖拽时预览视频实时 seek 跳转，松开后位置准确 |
| 8 | 画布事件隔离 | 拖拽、点击时间轴不会触发画布平移/缩放/节点拖拽 |
| 9 | 快速开关面板 | 抽帧任务正确取消，无 setState 警告、无内存泄漏 |
| 10 | 同视频二次打开 | 缓存命中，缩略图即时显示（无重新抽帧延迟） |

---

## 执行顺序

```
Task 1 (useThumbnails) → Task 2 (VideoTrimTimeline) → Task 3 (VideoTrimPanel) → Task 4 (验证)
```

每 Task 内严格 TDD：
1. 写测试 → 2. 确认测试失败（红） → 3. 写最小实现 → 4. 确认测试通过（绿） → 5. 重构（如需要）
