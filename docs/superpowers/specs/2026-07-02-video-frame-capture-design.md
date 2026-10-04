<!-- doc-status: historical | verified_at: n/a -->
# 视频截帧功能 Spec（v2 — 审核修订版）

## 参考方案评估

用户提供的「前端 Canvas + 后端 FFmpeg 混合架构」方案整体方向正确，结合项目当前阶段做以下调整：

| 项目 | 参考方案 | 调整建议 | 理由 |
|------|---------|---------|------|
| 截取首帧/尾帧 | 前端 Canvas 为主，后端 FFmpeg 为辅 | **一期全部前端 Canvas**，不引入后端 | 工具栏已有截帧下拉 UI，纯前端可闭环；后端 FFmpeg 截帧为持久化场景，暂无需求 |
| 输出目标 | 截帧 → 图片节点 | **采用**，截帧后上传 MinIO → 创建图片节点 + 连线 | 符合「视频→截帧→图片素材」创作链路 |
| 公共抽帧能力 | useVideoFrameCapture 独立实现 | **抽取公共工具文件**，useThumbnails 和 useVideoFrameCapture 共同依赖 | 避免 drawCover / 隐藏 video 创建释放逻辑重复，保证行为一致性 |
| 上传方式 | 自行 fetch 直传 MinIO | **复用现有 presign → FormData POST → confirm 标准流程** | 项目 useImageUpload 已有成熟模式，统一错误处理/目录规范 |
| 首帧时间点 | 0.1s | **采用**，但需 clamp 到 [0, duration] | 避免第 0 帧黑屏，同时防越界 |
| 尾帧时间点 | duration - 0.1s | **采用**，但需 `Math.max(0.1, duration - 0.1)` | 避免末尾黑屏，同时防负值 |

---

## 一、功能概述

点击视频节点悬浮工具条「视频截帧」下拉菜单中的选项（截取当前帧 / 截取首帧 / 截取尾帧），前端 Canvas 抽帧 → 上传 MinIO → 自动在画布上创建图片节点，并与源视频节点连线。

## 二、交互流程

```
视频节点（已加载视频，选中态，非 trim 模式）
  └── VideoNodeToolbar
        └── [视频截帧] 按钮（已有，带下拉箭头）
              │ 点击展开下拉菜单（已有）
              ├── [截取当前帧]  ← 本次实现
              ├── [截取首帧]    ← 本次实现
              └── [截取尾帧]    ← 本次实现
                    │ 点击任一选项
                    ▼
              下拉菜单关闭，按钮进入 loading 态
                    │
                    ├─ 成功 → Toast 提示"截帧成功"
                    │         → 视频节点右侧创建图片节点
                    │         → 自动连线（视频 → 图片）
                    │         → 自动选中新图片节点
                    │
                    └─ 失败 → Toast 提示"截帧失败：{原因}" → 恢复按钮
```

### 2.1 三种截取模式对比

| 模式 | 视频源 | 时间点 | 就绪条件 | 实现方式 |
|------|--------|--------|---------|---------|
| 截取当前帧 | 页面可见 videoRef | `video.currentTime` | `readyState >= HAVE_CURRENT_DATA` | 记录播放状态 → 暂停 → drawImage → 恢复原状态 |
| 截取首帧 | 隐藏 video（模块级缓存复用） | `Math.min(0.1, duration / 2)`，clamp 到 [0, duration] | seek 完成 | 获取/创建隐藏 video → seek → drawImage → 保留实例缓存 |
| 截取尾帧 | 隐藏 video（模块级缓存复用） | `Math.max(0.1, duration - 0.1)`，clamp 到 [0, duration] | seek 完成 | 获取/创建隐藏 video → seek → drawImage → 保留实例缓存 |

### 2.2 截取当前帧的播放状态处理

| 截取前状态 | 截取后行为 |
|-----------|-----------|
| 播放中 | 暂停 → 截取 → 恢复播放 |
| 已暂停 | 直接截取 → 保持暂停 |

**关键约束**：记录 `video.paused` 原始状态到局部变量，按原始状态恢复，**禁止强制恢复播放**。

### 2.3 首帧预缓存（优化建议项）

在 `useVideoFrameCapture` 内部 `useEffect` 中同时监听 `videoSrc` 和 `duration` 两个依赖，仅当两者均有效（src 非空、duration > 0）时才触发后台静默预截取。

用户点击「截取首帧」时：
- 若缓存命中 → 直接返回，秒级响应
- 若缓存未命中/已过期 → 实时截取并更新缓存

缓存 key：`${videoSrc}::firstFrame`，仅当缓存超限淘汰或页面卸载时清理。单个视频节点卸载不清理首帧缓存，保证跨节点复用时命中。

---

## 三、架构设计

### 3.1 公共工具层：`videoFrameUtils.ts`（新建）

将 useThumbnails 和 useVideoFrameCapture 的共享能力抽离到独立工具文件，两个 hook 共同依赖，避免重复实现：

```typescript
// apps/web/src/utils/videoFrameUtils.ts

/** 居中裁剪绘制（cover 模式），与 useThumbnails.drawCover 行为一致 */
export function drawCover(video: HTMLVideoElement, canvas: HTMLCanvasElement): void;

/**
 * 全帧绘制 — 1:1 映射视频原始分辨率，无裁切、无拉伸。
 * canvas 尺寸 = video.videoWidth × video.videoHeight，输出图片与视频原始画面完全一致。
 * 与 drawCover（居中裁剪填充固定画布）明确区分：drawCover 用于缩略图，drawFullFrame 用于截帧。
 */
export function drawFullFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): void;

/** 创建隐藏 video 元素（统一 crossOrigin / preload / muted 配置） */
export function createHiddenVideo(src: string): HTMLVideoElement;

/** 等待 video 元数据加载完成，超时默认 5s */
export function waitForMetadata(video: HTMLVideoElement, timeoutMs?: number): Promise<void>;

/** 释放 video 资源 */
export function releaseVideo(video: HTMLVideoElement): void;

/** 将 video 帧绘制到 canvas 并导出为 Blob */
export function videoFrameToBlob(
  video: HTMLVideoElement,
  options?: { type?: string; quality?: number }
): Promise<Blob>;
```

**重构影响**：useThumbnails.ts 内部删除 `drawCover`、`waitForMetadata`、`releaseVideo`，改为从 `videoFrameUtils.ts` 导入。行为不变，已有测试继续通过。

### 3.2 useVideoFrameCapture Hook（新建）

依赖 `videoFrameUtils.ts` 公共工具，封装截帧逻辑：

```typescript
interface UseVideoFrameCaptureOptions {
  videoSrc: string;
  duration: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

interface UseVideoFrameCaptureResult {
  captureCurrent: () => Promise<Blob>;
  captureFirst: () => Promise<Blob>;
  captureLast: () => Promise<Blob>;
  loading: boolean;
  error: string | null;
}
```

**内部实现要点**：

1. **并发互斥**：`isCapturingRef` 标志位，任意截帧方法执行前检查，若上一任务未完成直接 `reject('截帧进行中')`。标志位与 UI 层 `capturingType` 单向同步（hook → UI），避免双向依赖。

2. **当前帧就绪态校验**：执行前判断 `video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA (2)`，不满足则 reject `'视频未加载完成，无法截取'`。

3. **播放状态记录与恢复**：
   ```typescript
   const wasPaused = video.paused;
   video.pause();
   // ... 截取 ...
   if (!wasPaused) video.play();  // 仅当截取前在播放时才恢复
   ```

4. **首帧/尾帧隐藏 video 复用（LRU 容量约束）**：模块级 `Map<string, HTMLVideoElement>` 缓存（key = videoSrc），最大容量 5 个实例。采用 LRU 策略，超限时淘汰最久未使用的实例并释放资源。单个视频节点卸载时**不释放**全局缓存中的 video，保证跨节点可复用；仅当缓存超限淘汰、视频源失效或页面卸载时统一释放。

5. **时间点 clamp**：
   ```typescript
   function clampTime(time: number, duration: number): number {
     return Math.max(0, Math.min(time, duration));
   }
   const firstFrameTime = clampTime(Math.min(0.1, duration / 2), duration);
   const lastFrameTime = clampTime(Math.max(0.1, duration - 0.1), duration);
   ```

6. **首帧预缓存**：hook 初始化时（duration 可用后）自动预截首帧，缓存到模块级 `Map<string, Blob>`。`captureFirst` 优先返回缓存。

7. **输出分辨率**：使用 `video.videoWidth/videoHeight` 原始分辨率，一期不限制。预留 `maxDimension` 可选参数（默认 undefined = 不限制）。

### 3.3 组件层级

```
VideoGenNode.tsx（修改：集成 hook + 上传 + 创建节点 + 连线）
  ├── <video ref={videoRef}>  ← 当前帧截取复用此实例
  ├── VideoNodeToolbar（修改：onCaptureFrame / capturingType props）
  │     └── 截帧下拉菜单（已有 UI，按钮 onClick 改为调用 handler）
  └── （截首帧/尾帧的隐藏 video 在 hook 内部管理，不挂载到 DOM 树）
```

### 3.4 截帧 → 上传 → 创建节点 + 连线流程（VideoGenNode 内）

```
用户点击截帧选项
  → hook.captureFirst/Last/Current() → Blob
  → presignUpload({
        fileName: `frame_${Date.now()}_${randomStr(8)}.jpg`,
        fileSize: blob.size,
        fileType: 'image/jpeg',
        type: 'uploaded'
      })
  → 构建 FormData（与 useImageUpload.ts 一致）
  → axios.post(proxyUrl, formData)   // dev 环境自动 rewrite 到 /minio-storage
  → confirmUpload({ fileId, key, fileSize })
  → getMediaUrl(fileId) → 获取真实 URL（用于节点 referenceImage）
  → canvasStore.addNode('image', {
        x: videoNode.position.x + (videoNode.measured?.width ?? videoNode.width ?? 400) + 40,
        y: videoNode.position.y + 40
      }, {
        fileId,
        status: 'done',
        referenceImage: url
      })
  → 创建 edge: { id: getId('edge'), source: videoNodeId, target: newNodeId,
                   type: 'smoothstep' }  // 复用项目默认 edge 类型
  → 自动选中新节点: canvasStore.selectNode(newNodeId)
  → Toast.success('截帧成功')
```

**文件名**：`randomStr` 为 8 位随机字符串（`Math.random().toString(36).slice(2, 10)`），结合毫秒级时间戳，彻底避免高并发重名。

**Edge 连线**：复用项目默认 `smoothstep` 类型，source = 视频节点（输入），target = 图片节点（输出），符合「输入→输出」的节点数据流语义。不单独定义新样式。

**上传层收敛原则**：不在组件内自行组装 fetch/axios 请求，严格复用 `presignUpload` → FormData POST → `confirmUpload` 标准链路，与 `useImageUpload` 保持一致。

### 3.5 按钮 Loading 状态

```typescript
type CapturingType = 'current' | 'first' | 'last' | null;
```

- `capturingType` 非 null → 对应按钮显示 loading spinner
- 其他截帧按钮 disabled
- 下拉菜单在 loading 期间不可展开（避免并发操作）

---

## 四、数据结构

### 4.1 VideoNodeToolbarProps 扩展

```typescript
interface VideoNodeToolbarProps {
  // ... 现有字段
  onCaptureFrame?: (type: 'current' | 'first' | 'last') => void;
  capturingType?: 'current' | 'first' | 'last' | null;
}
```

### 4.2 无新增 store 字段

截帧是瞬态操作，结果直接创建新图片节点（带有 edge 连线），不需要在 VideoNodeData 中新增持久化字段。

### 4.3 Edge 连线

从视频节点到新图片节点的 edge 由 VideoGenNode 内部直接操作 `useCanvasStore.getState()` 创建，走标准 React Flow edge 结构。

---

## 五、后端

**一期无后端变更**。截帧产物通过现有 `presignUpload` → FormData POST → `confirmUpload` 流程上传到 MinIO，复用现有 Storage 模块。MinIO key 由 `minioService.buildKey('uploaded', userId, ...)` 自动生成，自然归入 `uploads/` 目录。

---

## 六、边界情况

| 场景 | 处理 |
|------|------|
| 视频未加载元数据（duration 未知） | 截帧按钮正常显示，但点击后 hook 内检测 duration <= 0 → reject |
| 当前帧视频未就绪（readyState < 2） | reject `'视频未加载完成，无法截取'`，Toast 提示 |
| 截帧进行中再次点击 | `isCapturingRef` 拦截，第二次调用直接 reject，UI 层按钮 disabled |
| 组件卸载时截帧未完成 | `isMountedRef` 阻止 setState；cleanup 释放隐藏 video + URL.revokeObjectURL |
| Canvas 被污染（跨域未配置） | catch SecurityError → Toast "截帧失败：视频跨域限制" |
| 视频时长 < 0.2s（首帧/尾帧时间点重叠） | clamp 逻辑自动处理：首帧 Math.min(0.1, 0.1/2)=0.05s，尾帧 Math.max(0.1, 0.1-0.1)=0.1s |
| 极短视频（duration=0.05s） | 首帧 clamp → 0.025s，尾帧 clamp → 0.05s，均在 [0, duration] 内 |
| 截帧 Blob 为 null | reject → Toast "截帧失败：无法生成图片" |
| 上传接口失败（网络/服务端错误） | catch → Toast 错误提示，不创建节点 |
| 用户快速切换视频源 | hook 监听 videoSrc 变化，新 src 的 seek/pending 操作取消旧操作 |

---

## 七、非功能需求

- 当前帧截取：≤ 200ms（同步 Canvas 操作）
- 首帧/尾帧截取（首次）：≤ 3s（含 seek 等待 + 上传）
- 首帧截取（缓存命中）：≤ 200ms
- 图片节点默认位置：视频节点右侧 40px，y 偏移 40px
- 新图片节点自动连线到源视频节点，自动选中
- 不引入新的前端依赖
- 截帧输出格式：JPEG，quality 0.92，原始分辨率（一期无缩放）

---

## 八、核心测试用例（TDD 前置）

### 8.1 videoFrameUtils 工具函数

| 测试用例 | 验证点 |
|----------|--------|
| drawCover 生成 cover 模式画面 | canvas 上有像素内容，非空白 |
| drawFullFrame 生成全帧画面 | canvas 尺寸 = video 原始分辨率 |
| createHiddenVideo 返回正确配置的 video | crossOrigin='anonymous', preload='auto', muted=true |
| waitForMetadata 超时抛出 | 无效 src → TIMEOUT 错误 |
| releaseVideo 清空 src | video.src 被清空 |
| videoFrameToBlob 返回有效 JPEG Blob | Blob type='image/jpeg', size > 0 |

### 8.2 useVideoFrameCapture hook

| 测试用例 | 验证点 |
|----------|--------|
| captureCurrent 返回有效 Blob | Blob type 为 image/jpeg，size > 0 |
| captureCurrent 就绪态拦截（readyState < 2） | reject，错误信息包含"未加载完成" |
| captureFirst seek 到正确时间点（正常视频） | 隐藏 video currentTime ≈ 0.1 |
| captureFirst seek 时间点 clamp（极短视频 duration=0.05s） | currentTime ≤ duration 且在 [0, duration] 内 |
| captureLast seek 到 duration - 0.1（正常视频） | 隐藏 video currentTime ≈ duration - 0.1 |
| captureLast 时间点不出现负值（duration=0.05s） | currentTime = Math.max(0.1, 0.05-0.1) = 0.1, clamp → 0.05 |
| 首帧/尾帧截取完成后隐藏 video 保留在缓存中 | video.src 非空（缓存复用） |
| 播放中截帧后恢复播放 | video.play() 被调用 |
| 暂停中截帧后保持暂停 | video.play() 不被调用 |
| 并发互斥：连续两次调用 → 第二次被拦截 | 第二次 reject，信息包含"截帧进行中" |
| 组件卸载后不更新状态 | isMountedRef=false 后 loading/error 不变 |

### 8.3 VideoNodeToolbar

| 测试用例 | 验证点 |
|----------|--------|
| 点击「截取当前帧」→ onCaptureFrame('current') | 回调参数正确 |
| 点击「截取首帧」→ onCaptureFrame('first') | 回调参数正确 |
| 点击「截取尾帧」→ onCaptureFrame('last') | 回调参数正确 |
| capturingType='current' → 对应按钮显示 loading | 按钮 disabled / spinner 可见 |
| capturingType 非 null → 下拉菜单不可展开 | Dropdown open=false |

### 8.4 集成测试

| 测试用例 | 验证点 |
|----------|--------|
| 截帧成功 → 创建图片节点 + 连线 | canvasStore 新增 image 节点，edges 新增一条 source→target |
| 截帧成功 → 新节点自动选中 | selectedId = newNodeId |
| 截帧失败 → 不创建节点 | canvasStore nodes/edges 数量不变 |
| 上传失败 → 不创建节点 + 错误提示 | Toast 显示错误，不创建节点/edge |
| 极短视频（duration=0.1s）首帧/尾帧截取不崩溃 | clamp 后正常执取，不抛异常 |
| 隐藏 video 复用：同一 src 两次 captureFirst | 全局缓存仅创建 1 个 video 实例 |
| 缓存 LRU 淘汰：6 个不同 src 依次截取 | 缓存实例数 ≤ 5，最早创建的实例被释放 |
| drawFullFrame 宽高比一致性 | 输出图片宽高比 = video.videoWidth / video.videoHeight，无拉伸 |

---

## 九、优化建议项（推荐纳入一期）

| # | 建议 | 决定 |
|---|------|------|
| 1 | 首帧预缓存（后台静默截取首帧，用户点击秒出） | **纳入一期** — 实现简单，体验提升明显 |
| 2 | 同视频源隐藏 video 复用（模块级缓存） | **纳入一期** — 避免重复创建销毁 |
| 3 | 截帧后自动选中新节点 | **纳入一期** — 符合创作流直觉 |
| 4 | 分辨率可选限制（maxDimension 参数） | **预留参数** — 一期传 undefined（不限制），后续按需开启 |

---

## 十、不在一期范围

- 后端 FFmpeg 截帧（大视频/持久化素材场景）→ 后续按需
- 截帧预览/确认弹窗 → 后续按需
- 批量截帧（时间点列表）→ 后续按需
- 非 JPEG 格式输出 → 后续按需

---

## 十一、文件变更清单

| 文件 | 动作 | 说明 |
|------|------|------|
| **前端** | | |
| `apps/web/src/utils/videoFrameUtils.ts` | **新建** | 公共视频帧工具（drawCover / drawFullFrame / createHiddenVideo / waitForMetadata / releaseVideo / videoFrameToBlob） |
| `apps/web/src/hooks/useVideoFrameCapture.ts` | **新建** | 截帧 hook（captureCurrent / captureFirst / captureLast + 并发互斥 + 就绪态校验 + 时间 clamp + 首帧预缓存 + 隐藏 video 复用） |
| `apps/web/src/hooks/useThumbnails.ts` | **修改** | 删除内部 drawCover / waitForMetadata / releaseVideo，改为导入 videoFrameUtils |
| `apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.tsx` | **修改** | 新增 onCaptureFrame / capturingType props，下拉按钮接入 |
| `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx` | **修改** | 集成 hook，截帧→上传→创建节点→连线→选中 |

**预计新增代码量**：~120 行（videoFrameUtils）+ ~150 行（hook）+ ~80 行（VideoGenNode 修改）+ ~40 行（Toolbar 修改）+ ~20 行（useThumbnails 重构，仅删减导入）
