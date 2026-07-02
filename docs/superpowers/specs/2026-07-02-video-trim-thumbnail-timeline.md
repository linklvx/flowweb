# Spec: 视频裁剪缩略图时间轴 + 白色选区样式

**日期**: 2026-07-02
**范围**: `VideoTrimPanel` 组件 — 时间轴 UI 替换
**原则**: 功能等价替换，不改变裁剪逻辑、数据处理、提交流程、键盘快捷键、区间锁定规则

---

## 1. 目标

把当前 Ant Design `<Slider range>` 蓝色双滑块进度条替换为：
- **缩略图时间轴**：整条时间轴背景铺满视频关键帧缩略图
- **白色选区样式**：入点/出点用白色细竖线手柄标记，选中区间用白色描边高亮框包裹

---

## 2. 视觉规范

### 2.1 缩略图时间轴

| 属性 | 值 |
|------|-----|
| 时间轴高度 | 60px |
| 缩略图数量 | 20 张（duration < 2s 时降为 10 张） |
| 缩略图宽度 | 时间轴总宽 / N（flex:1 等分） |
| 缩略图高度 | 60px（填充整个时间轴高度，object-fit: cover） |
| 缩略图排列 | 水平紧密排列，`display: flex; align-items: stretch` |
| 帧间分割线 | 通过 `&:not(:last-child) { border-right: 1px solid rgba(255,255,255,0.1) }` 实现，避免首尾出现多余边线 |
| 圆角 | 容器 `border-radius: 6px` + `overflow: hidden`（统一裁切所有内部元素） |
| 降级背景 | `#1a1a1a` 纯深灰 |

### 2.2 选区高亮框

| 属性 | 值 |
|------|-----|
| 边框 | `2px solid #ffffff` |
| 内部填充 | `rgba(255, 255, 255, 0.15)` |
| 位置 | 绝对定位于时间轴之上，left/width 对应 trimStart/trimEnd 的百分比位置 |
| 裁切 | 由父容器 `overflow: hidden` 统一处理，避免直角溢出圆角 |

### 2.3 拖拽手柄

| 属性 | 值 |
|------|-----|
| 视觉竖线 | 宽 3px，高 = 时间轴高度 + 6px（上下各超出 3px），白色 `#ffffff` |
| 顶部圆点 | 直径 8px 白色圆点，带 `box-shadow: 0 0 4px rgba(0,0,0,0.5)` 增强辨识度 |
| 热区 | 宽 16px（触屏 24px），透明背景，居中覆盖视觉竖线 |
| 光标 | `ew-resize` |
| touch-action | `none`（保证触屏拖拽流畅） |
| z-index | 高于缩略图层和选区层 |

---

## 3. 交互行为

### 3.1 拖拽手柄

- `pointerdown` 在手柄热区上开始拖拽，调用 `e.stopPropagation()` + `e.preventDefault()` 阻断画布事件
- **事件全局绑定**：`pointerdown` 后将 `pointermove` / `pointerup` 绑定到 `window`，确保鼠标移出时间轴区域仍可连贯拖拽；`pointerup` 后立即解绑
- `pointermove`：将指针 X 坐标转换为时间值，更新对应边界
  - 通过 ref **直接操作 DOM** 更新手柄/选区位置（避免 React 重渲染）
  - 同时通过 `requestAnimationFrame` **节流调用 `onRangeChange`**，保证视频预览实时跟随（对齐原 Slider 实时联动行为），每帧最多触发一次
- `pointerup`：结束拖拽，最终同步一次 state 与 `onRangeChange`，确保数值收敛
- 约束：两端最小间距 0.5 秒（MIN_GAP），超出对方手柄位置时 clamp 到 MIN_GAP 位置

### 3.2 点击时间轴空白区域（精确定义）

- 点击位置对应时间 **< trimStart**：移动**左手柄**到点击位置
- 点击位置对应时间 **> trimEnd**：移动**右手柄**到点击位置
- 点击位置在 **[trimStart, trimEnd] 区间内**：无响应
- 点击事件中调用 `e.stopPropagation()` 阻断画布事件

### 3.3 视频同步

- 拖拽/点击时，视频预览 seek 到对应时间（通过 onRangeChange 联动，保持现有行为）
- 面板打开时，视频 currentTime 跳到 trimStart（保持现有行为）
- 视频播放到 trimEnd 时自动跳回 trimStart（保持现有循环行为）

### 3.4 处理中状态（isProcessing）

- 时间轴整体 `opacity: 0.6`
- 手柄光标切换为 `not-allowed`
- 拖拽、点击均无响应

### 3.5 键盘快捷键（保持现有）

- `Space`：播放/暂停
- `Escape`：取消并关闭面板

---

## 4. 缩略图生成策略

### 4.1 资源隔离（核心约束）

- **禁止复用**传入的 `videoRef`（主预览视频）
- 组件内部创建**独立的隐藏 `<video>` 元素**用于抽帧
- 视频源从 `videoRef.current?.src` 读取；若 `videoRef` 为 null 或 `src` 无效/为空，直接进入纯色降级，不创建抽帧 video
- 加载与主预览相同的视频源 (`crossOrigin="anonymous"`)
- 默认属性：`muted`（避免意外发声）、`playsInline`（禁止移动端自动全屏）、`preload="auto"`

### 4.2 就绪等待

- 监听内部 video 的 `loadedmetadata` 事件，确认 `duration` 为有效正数后启动抽帧
- 3 秒超时：若 `loadedmetadata` 未在 3s 内触发，放弃抽帧，直接降级纯色背景
- 超时后释放 video 资源

### 4.3 串行抽帧（禁止并行 seek）

```
async function extractFrames(video, duration, count):
  thumbnails = []
  for i in 0..count-1:
    if (!isMountedRef.current) break    // 取消检查
    targetTime = (i + 0.5) * duration / count
    video.currentTime = targetTime
    await 'seeked' event                  // 串行等待
    if (!isMountedRef.current) break
    // cover 模式居中裁剪绘制，保证缩略图画面比例正确
    drawCover(video, canvas)
    dataUrl = canvas.toDataURL('image/jpeg', 0.6)
    thumbnails.push(dataUrl)
    // 逐帧回调，支持渐进渲染
    onFrame?.(i, dataUrl)
  return thumbnails

// cover 居中裁剪：取宽高缩放比中较大值，反向计算偏移
function drawCover(video, canvas):
  ctx = canvas.getContext('2d')
  cw = canvas.width, ch = canvas.height
  vw = video.videoWidth, vh = video.videoHeight
  scale = max(cw / vw, ch / vh)
  sw = vw * scale, sh = vh * scale
  sx = (cw - sw) / 2, sy = (ch - sh) / 2
  ctx.drawImage(video, sx, sy, sw, sh)
```

### 4.4 取消机制

- 使用 `isMountedRef`（组件级 useRef），组件卸载时设为 false
- 每一帧 seek 前和 seek 后检查标志位，已卸载则立即退出循环
- cleanup 中释放内部 video：`video.pause(); video.src = ''; video.load()`

### 4.5 跨域与画布污染

- 设置 `crossOrigin="anonymous"` 请求 CORS 资源
- 全链路 try/catch：若 `drawImage()` 或 `toDataURL()` 抛 SecurityError（画布污染），捕获后统一走纯色降级
- 前置依赖：确保 MinIO 存储桶已配置 CORS 规则，允许前端域名访问视频资源

### 4.6 异常处理汇总

| 场景 | 行为 |
|------|------|
| duration 无效 (NaN/0) | 不启动抽帧，纯色背景 |
| loadedmetadata 3s 超时 | 释放 video，纯色背景 |
| 组件中途卸载 | 取消标志位终止循环，释放 video |
| 画布污染 (SecurityError) | 捕获异常，纯色背景 |
| 单帧 seek 失败 | 跳过该帧，继续下一帧（缩略图留空占位） |

### 4.7 缓存策略（优化建议）

- 模块级 Map 缓存：`Map<videoSrc, dataUrl[]>`，以视频 URL 为 key
- 同一视频重复打开 Panel 时复用缓存，跳过抽帧
- Panel 关闭时**不主动清缓存**；视频源变化时自然不命中缓存
- **容量约束**：最大 5 条，采用 LRU 策略淘汰最旧缓存（Map keys 按插入顺序迭代，访问时 delete + set 实现 LRU）

### 4.8 性能

- 动态帧数：duration < 2s → 10 张；≥ 2s → 20 张
- 单个缩略图尺寸：宽度 ≈ 时间轴宽/20（约 15-30px），高度 60px → canvas 采 30×60 即可
- JPEG quality 0.6，单张约 1-3KB，总计 < 60KB
- 逐帧回调实现渐进式渲染，不阻塞首屏

---

## 5. Props 接口（保持不变）

```typescript
interface VideoTrimPanelProps {
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  duration: number;
  initialTrimStart: number;
  initialTrimEnd: number;
  onConfirm: (start: number, end: number) => Promise<void> | void;
  onCancel: () => void;
  onRangeChange?: (start: number, end: number) => void;
  taskStatus?: 'idle' | 'queued' | 'processing' | 'done' | 'error';
  error?: string | null;
}
```

---

## 6. 不改变的部分

- `VideoGenNode.tsx` — 零改动
- `useTrimTaskStatus` hook — 零改动
- `videoTrimApi` — 零改动
- 后端任何代码 — 零改动
- 时间格式化函数 `formatTime()`
- 底部按钮区（取消/确认裁剪）
- 状态/错误提示文字
- 面板整体容器样式（圆角、毛玻璃、阴影）
- `MIN_GAP = 0.5` 约束
- `nodrag nopan nowheel` 事件隔离

---

## 7. 组件结构变化

**移除**：
- `import { Slider } from 'antd'`
- `<Slider range ...>` 及其父 div

**新增**：
- `useThumbnails` — 内部 hook：管理独立 video 创建、串行抽帧、缓存、取消
- 时间轴容器（relative, h-[60px], rounded-[6px], overflow-hidden, bg-[#1a1a1a]）
  - 缩略图层（absolute inset-0, flex, 20 个 `<img>` 标签）
  - 选区高亮层（absolute, top-0 bottom-0, border-2 border-white, bg-white/15）
  - 左手柄（absolute, 3px 视觉线 + 16px 热区 + 顶部圆点）
  - 右手柄（同上）
  - 点击热区层（absolute inset-0, 透明，处理点击跳转）
- 拖拽状态管理（pointer events + ref-based DOM 操作）
- `e.stopPropagation()` 双重事件隔离

---

## 8. 边界情况

| 场景 | 预期行为 |
|------|----------|
| duration < 1s | 不生成缩略图，深灰背景 |
| duration < 2s | 缩略图降为 10 张 |
| trimStart = 0, trimEnd = duration | 高亮框覆盖整个时间轴 |
| 手柄拖到最左/最右 | clamp 到边界，不超出时间轴 |
| 左/右手柄推到对方位置 | clamp 到 MIN_GAP 间距 |
| 正在处理中 (isProcessing) | 手柄不可拖拽，点击无响应 |
| Panel 关闭后重新打开 | 同视频走缓存；不同视频重新抽取 |
| videoRef 为 null | 不抽帧，纯色背景 |
| 画布污染 (CORS 未配) | 纯色降级，不抛异常 |
| 组件卸载时抽帧未完成 | 取消标志位终止循环 + 释放 video |

---

## 9. 无障碍（优化建议）

- 手柄元素添加 `role="slider"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`
- 支持 `ArrowLeft`/`ArrowRight` 键盘微调（step 0.1s），对齐原 Slider 键盘交互

---

## 10. 测试用例（Plan 阶段细化）

| # | 场景 | 验证点 |
|---|------|--------|
| 1 | 快速开关面板 | 抽帧任务正确取消，无 setState 警告、无内存泄漏 |
| 2 | videoRef 为 null | 直接纯色降级，不创建抽帧 video |
| 3 | 跨域视频 (CORS 未配) | 画布污染 SecurityError 被捕获，平稳降级纯色背景，无控制台报错 |
| 4 | 拖拽边界 | 手柄拖到时间轴外仍可连续操作，松开后数值正确 clamp |
| 5 | 极短视频 (duration < 1s) | 不抽帧，纯色背景正常显示 |
| 6 | 短视频 (duration < 2s) | 缩略图降为 10 张 |
| 7 | 正常视频 | 20 张缩略图逐帧渐进渲染 |
| 8 | 处理中状态 | 拖拽/点击均无响应，opacity:0.6，光标 not-allowed |
| 9 | 视频源切换 | 不同视频不命中缓存、重新抽帧 |
| 10 | 同视频二次打开 | 命中缓存，跳过抽帧，即时显示 |
| 11 | loadedmetadata 3s 超时 | 释放 video，纯色降级 |
| 12 | 拖拽实时预览 | 拖拽中视频 seek 实时跟随（rAF 节流） |
| 13 | 点击时间轴 | < trimStart → 移左手柄，> trimEnd → 移右手柄，区间内 → 无响应 |
| 14 | 手柄推挤 | 左右手柄间距 < MIN_GAP 时正确 clamp |
| 15 | 组件卸载 | cleanup 释放 video: pause() + src='' + load() |
| 16 | LRU 缓存淘汰 | 第 6 条视频淘汰最旧缓存 |
