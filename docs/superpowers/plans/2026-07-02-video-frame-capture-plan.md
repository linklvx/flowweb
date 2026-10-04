<!-- doc-status: historical | verified_at: n/a -->
# Plan: 视频截帧功能（当前帧 / 首帧 / 尾帧）v3

**日期**: 2026-07-02
**Spec**: `docs/superpowers/specs/2026-07-02-video-frame-capture-design.md`
**原则**: TDD 红-绿-重构，先测试→确认失败→写实现→测试通过→提交

---

## 任务概览

| Task | 内容 | 文件 | 预估 |
|------|------|------|------|
| 1 | `videoFrameUtils.ts` 纯工具层（无 API 依赖） | 新建 2 文件 | 1h |
| 2 | `mediaUploadUtils.ts` 上传业务封装 | 新建 2 文件 | 0.5h |
| 3 | `useThumbnails.ts` 重构 | 修改 1 文件 | 0.5h |
| 4 | `useVideoFrameCapture.ts` hook | 新建 2 文件 | 2h |
| 5 | `VideoNodeToolbar.tsx` props 扩展 | 修改 2 文件 | 0.5h |
| 6a | `canvasStore.addEdge` action | 修改 1 文件 | 0.25h |
| 6b | `VideoGenNode.tsx` 集成 | 修改 2 文件 | 1.5h |
| 7 | 验证 + 清理 | 测试 + 手动 | 0.5h |

**依赖图**：

```
Task 1 (videoFrameUtils) ──── Task 3 (useThumbnails 重构)
    ├── Task 4 (useVideoFrameCapture hook)
    └── Task 5 (Toolbar props) ← 独立

Task 2 (mediaUploadUtils) ──── Task 6b (VideoGenNode 集成)
                                    ↑
Task 6a (canvasStore.addEdge) ──────┤
Task 4, Task 5 ─────────────────────┘
                                        ↓
                                    Task 7 (验证)
```

---

## Task 1: `videoFrameUtils.ts` 纯工具层

### 定位

**纯 DOM/Canvas 工具层，零 API 依赖、零副作用、可独立复用**。不引入 `presignUpload`、`axios`、`confirmUpload` 等任何业务/网络依赖。

### 文件

- **新建** `apps/web/src/utils/videoFrameUtils.ts`
- **新建** `apps/web/src/utils/videoFrameUtils.test.ts`

### 导出函数

```typescript
// 全帧绘制 — 1:1 映射视频原始分辨率
export function drawFullFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): void;

// 居中裁剪绘制（cover 模式），用于缩略图
export function drawCover(video: HTMLVideoElement, canvas: HTMLCanvasElement): void;

// 创建隐藏 video：muted, playsInline, preload='auto', crossOrigin='anonymous'
export function createHiddenVideo(src: string): HTMLVideoElement;

// 等待 loadedmetadata，默认超时 5s
export function waitForMetadata(video: HTMLVideoElement, timeoutMs?: number): Promise<void>;

// 等待 seeked 事件，默认超时 3s。超时 reject('视频帧加载超时')
export function waitForSeeked(video: HTMLVideoElement, timeoutMs?: number): Promise<void>;

// 释放 video：pause → src='' → load()
export function releaseVideo(video: HTMLVideoElement): void;

// video 当前帧 → Canvas → Blob（全帧模式，默认 image/jpeg，quality 0.92）
export function videoFrameToBlob(
  video: HTMLVideoElement,
  options?: { type?: string; quality?: number }
): Promise<Blob>;
```

### 实现细节（与 v2 一致，新增 waitForSeeked）

**waitForSeeked**：
```typescript
export function waitForSeeked(video: HTMLVideoElement, timeoutMs = 3000): Promise<void> {
  return Promise.race([
    new Promise<void>((resolve) => {
      video.addEventListener('seeked', () => resolve(), { once: true });
    }),
    new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('视频帧加载超时')), timeoutMs);
    }),
  ]);
}
```

其余函数实现与 v2 一致，不重复。

### 测试用例 (videoFrameUtils.test.ts) — 11 例

| # | 测试 | 验证 |
|---|------|------|
| 1 | drawFullFrame canvas 尺寸 = video 分辨率 | canvas.width/height 正确 |
| 2 | drawFullFrame 宽高比一致 | 比例 = video.videoWidth/video.videoHeight |
| 3 | drawCover 生成 cover 模式画面 | ctx.drawImage 参数验证 |
| 4 | createHiddenVideo 返回正确配置 | muted/playsInline/preload/crossOrigin |
| 5 | waitForMetadata resolve | loadedmetadata 事件后 resolve |
| 6 | waitForMetadata 超时 reject | 5s 后 reject |
| 7 | waitForSeeked resolve | seeked 事件后 resolve |
| 8 | waitForSeeked 超时 reject('视频帧加载超时') | 3s 后 reject |
| 9 | releaseVideo 清空资源 | video.src=''，video.load() |
| 10 | videoFrameToBlob 返回 JPEG Blob | Blob.type='image/jpeg'，size > 0 |
| 11 | videoFrameToBlob 失败 reject | canvas.toBlob 返回 null |

---

## Task 2: `mediaUploadUtils.ts` 上传业务封装

### 定位

**业务上传层**：封装「Blob → presign → FormData POST → confirm → getMediaUrl」标准上传链路，依赖 API 层（`presignUpload`/`confirmUpload`/`getMediaUrl`）和 `axios`。

### 文件

- **新建** `apps/web/src/utils/mediaUploadUtils.ts`
- **新建** `apps/web/src/utils/mediaUploadUtils.test.ts`

### 导出函数

```typescript
interface UploadImageBlobResult {
  url: string;
  fileId: string;
}

/**
 * 上传 Blob 到 MinIO，返回 media URL 和 fileId。
 * 内部走 presign → FormData POST → confirm → getMediaUrl 标准链路。
 * 文件名自动生成：frame_{timestamp}_{8位随机串}.jpg
 */
export async function uploadImageBlob(blob: Blob): Promise<UploadImageBlobResult>;
```

### 实现

```typescript
import { presignUpload, confirmUpload } from '@/api/storageApi';
import { getMediaUrl } from '@/api/mediaApi';
import axios from 'axios';

export async function uploadImageBlob(blob: Blob): Promise<UploadImageBlobResult> {
  const randomStr = Math.random().toString(36).slice(2, 10);
  const fileName = `frame_${Date.now()}_${randomStr}.jpg`;

  const presign = await presignUpload({
    fileName,
    fileSize: blob.size,
    fileType: 'image/jpeg',
    type: 'uploaded',
  });

  const formData = new FormData();
  Object.entries(presign.fields).forEach(([k, v]) => formData.append(k, v));
  formData.append('file', blob, presign.key.split('/').pop() || fileName);

  const proxyUrl = import.meta.env.DEV
    ? presign.uploadUrl.replace(/^http:\/\/[^/]+\/flowai/, '/minio-storage')
    : presign.uploadUrl;

  await axios.post(proxyUrl, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  await confirmUpload({ fileId: presign.fileId, key: presign.key, fileSize: blob.size });
  const { url } = await getMediaUrl(presign.fileId);

  return { url, fileId: presign.fileId };
}
```

### 测试用例 (mediaUploadUtils.test.ts) — 4 例

| # | 测试 | 验证 |
|---|------|------|
| 1 | 上传成功返回 url + fileId | presignUpload/confirmUpload/getMediaUrl 调用链完整 |
| 2 | presignUpload 失败 → 抛出异常 | confirmUpload 不被调用 |
| 3 | 上传失败 → 抛出异常 | confirmUpload 不被调用 |
| 4 | DEV 环境 proxy URL rewrite | uploadUrl 被正确 rewrite |

---

## Task 3: `useThumbnails.ts` 重构

### 文件

- **修改** `apps/web/src/hooks/useThumbnails.ts`

### 改动内容

**删除** 内部定义的 `drawCover`、`waitForMetadata`、`releaseVideo`。

**新增**：
```typescript
import { drawCover, waitForMetadata, releaseVideo } from '@/utils/videoFrameUtils';
```

**约束**：行为完全不变，已有 10 个测试全部继续通过。

### 验证

**重构完成后立即运行**：`npx vitest run src/hooks/useThumbnails.test.ts`，确认 10/10 通过后推进 Task 4。

---

## Task 4: `useVideoFrameCapture.ts` hook

### 文件

- **新建** `apps/web/src/hooks/useVideoFrameCapture.ts`
- **新建** `apps/web/src/hooks/useVideoFrameCapture.test.ts`

### 接口

```typescript
interface UseVideoFrameCaptureOptions {
  videoSrc: string | null | undefined;
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

### 全局缓存

**隐藏 video 缓存（LRU，max=5，key = videoSrc）**：

```typescript
const videoCache = new Map<string, HTMLVideoElement>();

function getOrCreateHiddenVideo(src: string): HTMLVideoElement {
  if (videoCache.has(src)) {
    const video = videoCache.get(src)!;
    videoCache.delete(src);
    videoCache.set(src, video);  // LRU 移至末尾
    return video;
  }
  if (videoCache.size >= 5) {
    const firstKey = videoCache.keys().next().value as string;
    releaseVideo(videoCache.get(firstKey)!);
    videoCache.delete(firstKey);
  }
  const video = createHiddenVideo(src);
  videoCache.set(src, video);
  return video;
}
```

**实例级串行锁（解决 seek 竞态，异常安全兜底）**：

同一缓存的 video 实例同时只能执行一个 seek + 截帧操作。用 Map 维护每个 video 实例的进行中 Promise。

**withVideoLock 高阶封装**（自动处理 acquire + try/finally release，避免死锁）：

```typescript
const videoLocks = new Map<HTMLVideoElement, Promise<void>>();

function acquireVideoLock(video: HTMLVideoElement): Promise<void> {
  return new Promise<void>((resolve) => {
    const existing = videoLocks.get(video);
    if (existing) {
      existing.then(resolve);  // 等待上一个任务完成
    } else {
      resolve();
    }
  });
}

function setVideoLock(video: HTMLVideoElement): { release: () => void } {
  let releaseLock: () => void;
  const lock = new Promise<void>((resolve) => { releaseLock = resolve; });
  videoLocks.set(video, lock);
  return { release: () => { releaseLock!(); videoLocks.delete(video); } };
}

// 高阶封装：自动处理锁获取与 finally 释放，杜绝死锁风险
async function withVideoLock<T>(video: HTMLVideoElement, fn: () => Promise<T>): Promise<T> {
  await acquireVideoLock(video);
  const { release } = setVideoLock(video);
  try {
    return await fn();
  } finally {
    release();
  }
}
```

**LLU 淘汰时同步清理锁**：

```typescript
// 在 getOrCreateHiddenVideo 淘汰逻辑中：
if (videoCache.size >= 5) {
  const firstKey = videoCache.keys().next().value as string;
  const oldVideo = videoCache.get(firstKey)!;
  releaseVideo(oldVideo);
  videoLocks.delete(oldVideo);  // 同步清理锁条目，避免 Map 引用泄漏
  videoCache.delete(firstKey);
}
```

**首帧 Blob 缓存（LRU，max=5，key = `${videoSrc}::${duration}`）**：

```typescript
const MAX_FIRST_FRAME_CACHE = 5;
const firstFrameCache = new Map<string, Blob>();

function getFirstFrameCacheKey(src: string, duration: number): string {
  return `${src}::${duration}`;
}

function getCachedFirstFrame(key: string): Blob | undefined {
  const blob = firstFrameCache.get(key);
  if (blob) {
    // LRU 命中 → 移至末尾
    firstFrameCache.delete(key);
    firstFrameCache.set(key, blob);
  }
  return blob;
}

function setCachedFirstFrame(key: string, blob: Blob): void {
  if (firstFrameCache.has(key)) {
    firstFrameCache.delete(key);
  } else if (firstFrameCache.size >= MAX_FIRST_FRAME_CACHE) {
    // 淘汰最旧条目
    const firstKey = firstFrameCache.keys().next().value as string;
    firstFrameCache.delete(firstKey);
  }
  firstFrameCache.set(key, blob);
}
```

### 内部逻辑

**并发标志位**：

```typescript
const isCapturingRef = useRef(false);      // 用户主动调用
const isPrefetchingRef = useRef(false);    // 后台预缓存
const prefetchPromiseRef = useRef<Promise<void> | null>(null);  // 预取 Promise（共享等待）
const isMountedRef = useRef(true);
```

**captureCurrent**：

```
1. 若 !isMountedRef.current → 静默 return
2. 若 isCapturingRef.current → reject('截帧进行中')
3. isCapturingRef = true
4. 若 !videoRef.current || !videoRef.current.duration → reject('视频未就绪')
5. 若 videoRef.current.readyState < 2 → reject('视频未加载完成，无法截取')
6. wasPaused = videoRef.current.paused
7. videoRef.current.pause()
8. blob = await videoFrameToBlob(videoRef.current)
9. 若 !wasPaused → videoRef.current.play()
10. 成功: 若 isMountedRef.current → loading=false, return blob
11. catch: 若 isMountedRef.current → error=msg, throw
12. finally: isCapturingRef = false
```

**captureFirst**：

```
1. 若 !isMountedRef.current → 静默 return
2. 若 isCapturingRef.current → reject('截帧进行中')
3. isCapturingRef = true

4. cacheKey = getFirstFrameCacheKey(videoSrc, duration)
5. 检查 firstFrameCache.get(cacheKey) → 命中直接返回

6. 若 isPrefetchingRef.current && prefetchPromiseRef.current:
     await prefetchPromiseRef.current  // 共享等待，非轮询
     检查 firstFrameCache.get(cacheKey) → 命中返回，未命中继续 7

7. time = clampTime(Math.min(0.1, duration / 2), duration)
8. video = getOrCreateHiddenVideo(videoSrc)
9. await waitForMetadata(video)
10. blob = await withVideoLock(video, async () => {
      video.currentTime = time;
      await waitForSeeked(video);
      return videoFrameToBlob(video);
    });
11. 缓存到 firstFrameCache（LRU 淘汰，见下方）
12. 成功: 若 isMountedRef.current → loading=false, return blob
13. catch: 若 isMountedRef.current → error=msg, throw
14. finally: isCapturingRef = false
```

**captureLast**（与 captureFirst 结构一致，无缓存步骤）：

```
1-3. 同 captureFirst
4. time = clampTime(Math.max(0.1, duration - 0.1), duration)
5. video = getOrCreateHiddenVideo(videoSrc)
6. await waitForMetadata(video)
7. blob = await withVideoLock(video, async () => {
     video.currentTime = time;
     await waitForSeeked(video);
     return videoFrameToBlob(video);
   });
8-10. 同 captureFirst（成功/失败/finally 处理）
```

**prefetchFirstFrame（独立预取）**：

```typescript
function prefetchFirstFrame(generation: number):
  1. cacheKey = getFirstFrameCacheKey(videoSrc, duration)
  2. 若 firstFrameCache.has(cacheKey) → return
  3. 若 isPrefetchingRef.current → return（已在预取）
  4. isPrefetchingRef = true

  5. 创建 Promise 保存到 prefetchPromiseRef.current
  6. time = clampTime(Math.min(0.1, duration / 2), duration)
  7. video = getOrCreateHiddenVideo(videoSrc)
  8. await waitForMetadata(video)
  9. if (generation !== prefetchGenerationRef.current) return;  // ← 代际校验点 1

  10. blob = await withVideoLock(video, async () => {
        if (generation !== prefetchGenerationRef.current) return null;  // ← 代际校验点 2
        video.currentTime = time;
        await waitForSeeked(video);
        if (generation !== prefetchGenerationRef.current) return null;  // ← 代际校验点 3
        return videoFrameToBlob(video);
      });
  11. if (blob === null || generation !== prefetchGenerationRef.current) return;  // ← 代际校验点 4
  12. 缓存到 firstFrameCache（LRU 淘汰）
  13. catch: console.debug('[FrameCapture] prefetch failed', err); // 静默日志
  14. finally:
       isPrefetchingRef = false
       prefetchPromiseRef.current = null
```

> 每个异步等待节点后增加代际校验（共 4 个检查点）。videoSrc 变化 → generation 自增 → 旧预取在校验点检测到不匹配 → 直接 return，不执行后续绘制与缓存写入。

**首帧预缓存 useEffect**：

```typescript
useEffect(() => {
  if (videoSrc && duration > 0) {
    prefetchFirstFrame();
  }
  // videoSrc 变化时，上一个预取自动失效（通过 isMountedRef 间接保护）
  // prefetchFirstFrame 内的 videoLock 阻止并发，新预取等待旧锁完成
}, [videoSrc, duration]);
```

**预取取消机制**：

通过 `prefetchAbortRef` 取消旧预取：

```typescript
const prefetchGenerationRef = useRef(0);

useEffect(() => {
  if (videoSrc && duration > 0) {
    prefetchGenerationRef.current += 1;
    const gen = prefetchGenerationRef.current;
    prefetchFirstFrame(gen);  // 传入代际号
  }
  return () => {
    prefetchGenerationRef.current += 1;  // 卸载时废弃所有预取
  };
}, [videoSrc, duration]);

// prefetchFirstFrame 内部在关键 await 后检查:
// if (generation !== prefetchGenerationRef.current) return; // 已过期
```

**时间 clamp**：

```typescript
function clampTime(time: number, duration: number): number {
  return Math.max(0, Math.min(time, duration));
}
```

**cleanup**：

```typescript
useEffect(() => {
  isMountedRef.current = true;
  return () => {
    isMountedRef.current = false;
    prefetchGenerationRef.current += 1;  // 废弃所有进行中的预取
    // 不释放 videoCache / firstFrameCache（全局缓存）
  };
}, []);
```

### 卸载防护规则

| 操作 | 是否检查 isMountedRef |
|------|----------------------|
| setState（loading/error） | 是 |
| throw / reject | 是 |
| finally 中 isCapturingRef 重置 | 否，始终执行 |
| finally 中 isPrefetchingRef 重置 | 否，始终执行 |
| 预取中 setState | 预取不 setState，仅写缓存 |

### 测试用例 (useVideoFrameCapture.test.ts) — 21 例

| # | 测试 | 验证 |
|---|------|------|
| 1 | captureCurrent 返回 Blob | mock videoFrameToBlob 返回值正确 |
| 2 | captureCurrent readyState < 2 → reject | 错误信息含"未加载完成" |
| 3 | captureCurrent 播放中 → 暂停→截取→恢复 | wasPaused=false → video.play() 调用 |
| 4 | captureCurrent 暂停中 → 保持暂停 | wasPaused=true → video.play() 不调用 |
| 5 | captureFirst seek 时间点正确 | time = clampTime(Math.min(0.1, duration/2), duration) |
| 6 | captureLast seek 时间点正确 | time = clampTime(Math.max(0.1, duration-0.1), duration) |
| 7 | 极短视频 duration=0.05s → 首帧 clamp | currentTime ∈ [0, 0.05] |
| 8 | 极短视频 duration=0.05s → 尾帧 clamp | currentTime ∈ [0, 0.05] |
| 9 | 并发互斥：两次 captureCurrent → 第二次 reject | 第二次 promise reject |
| 10 | 首帧缓存命中（同 src+duration）→ 直接返回 | 不创建 video，不 seek |
| 11 | 首帧缓存 key 含 duration：同 src 不同 duration → 不命中 | 创建新 video，seek |
| 12 | 预取进行中 + 用户点击 captureFirst → 等待预取完成 | await prefetchPromise，返回缓存结果 |
| 13 | 预取失败 + captureFirst → 独立执行成功 | 不依赖预取结果，正常返回 |
| 14 | 隐藏 video LRU 复用：同 src 两次 captureFirst | 仅创建 1 个 video |
| 15 | 隐藏 video LRU 淘汰：6 个不同 src | 缓存 ≤ 5，最早创建的释放 |
| 16 | 组件卸载后 setState 不执行 | isMountedRef=false → loading/error 不变 |
| 17 | 组件卸载后 finally 仍重置 isCapturingRef | 标志位正确复位 |
| 18 | 首帧预缓存触发：videoSrc+duration 有效 → prefetch | prefetchFirstFrame 被调用 |
| 19 | captureCurrent 无 videoRef → reject | 错误信息正确 |
| 20 | 同一视频并发两次 captureFirst → 串行执行 | 第二次等待第一次释放锁后执行，执行顺序正确 |
| 21 | 截帧异常时锁正常释放 | 模拟 seek 失败，releaseVideoLock 仍被调用，后续调用可获取锁 |

### 测试隔离

```typescript
beforeEach(() => {
  videoCache.clear();
  firstFrameCache.clear();
  videoLocks.clear();
});
```

---

## Task 5: `VideoNodeToolbar.tsx` props 扩展

（与 v2 一致，无变更）

### 文件

- **修改** `apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.tsx`
- **修改** `apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.test.tsx`

### Props 扩展

```typescript
onCaptureFrame?: (type: 'current' | 'first' | 'last') => void;
capturingType?: 'current' | 'first' | 'last' | null;
```

### 测试用例 — 新增 7 例（与 v2 一致）

---

## Task 6a: `canvasStore.addEdge` action

### 文件

- **修改** `apps/web/src/stores/canvasStore.ts`

### 改动

```typescript
// interface 新增
addEdge: (source: string, target: string) => string;

// 实现（type 使用 'default'，与 onConnect 和项目 edgeTypes 一致）
addEdge: (source, target) => {
  const id = getId('edge');
  const edge: Edge = { id, source, target, type: 'default' };
  set((s) => ({ edges: [...s.edges, edge] }));
  return id;
},
```

> Edge type 使用 `'default'`（非 `'smoothstep'`），与 `onConnect` 行为和 `CanvasView` 中 `edgeTypes` 配置保持一致。后续若需全局修改连线样式，统一在 `CanvasView` 配置层调整。

---

## Task 6b: `VideoGenNode.tsx` 集成

### 文件

- **修改** `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx`
- **修改** `apps/web/src/pages/canvas/components/nodes/VideoGenNode.test.tsx`

### 新增 imports

```typescript
import { useVideoFrameCapture } from '@/hooks/useVideoFrameCapture';
import { uploadImageBlob } from '@/utils/mediaUploadUtils';
import { message } from 'antd';
```

### 新增 state

```typescript
const [capturingType, setCapturingType] = useState<'current' | 'first' | 'last' | null>(null);
```

### 错误友好化

```typescript
function friendlyError(err: Error): string {
  const map: Record<string, string> = {
    '视频未加载完成，无法截取': '视频正在缓冲，请稍后重试',
    '视频帧加载超时': '视频资源加载缓慢，请检查网络后重试',
    'SecurityError': '视频资源无法访问，请检查源文件',
  };
  for (const [key, msg] of Object.entries(map)) {
    if (err.message?.includes(key)) return msg;
  }
  return err.message || '截帧失败，请重试';
}
```

### 截帧 handler（核心）

```typescript
const handleCaptureFrame = useCallback(async (type: 'current' | 'first' | 'last') => {
  if (capturingType) return;  // UI 层加固
  setCapturingType(type);

  try {
    const captureFn = type === 'current' ? captureCurrent
      : type === 'first' ? captureFirst : captureLast;
    const blob = await captureFn();

    // 上传（一口调用抽离工具）
    const { url, fileId } = await uploadImageBlob(blob);

    // 创建节点
    const store = useCanvasStore.getState();
    const videoNode = store.nodes.find(n => n.id === id);
    if (!videoNode) return;

    const vw = videoNode.measured?.width ?? videoNode.width ?? 400;
    const position = {
      x: videoNode.position.x + vw + 40,
      y: videoNode.position.y + 40,
    };

    const newNodeId = store.addNode('image', position, {
      fileId,
      status: 'done',
      referenceImage: url,
    });

    // 连线（使用 addEdge action）
    store.addEdge(id, newNodeId);

    // 自动选中
    store.selectNode(newNodeId);

    message.success('截帧成功');
  } catch (err: any) {
    const msg = friendlyError(err);
    message.error(msg);
    // 简易埋点（关键失败场景）
    console.warn('[FrameCapture]', err?.message || err);
  } finally {
    setCapturingType(null);
  }
}, [id, capturingType, captureCurrent, captureFirst, captureLast]);
```

> **节点防重叠**：一期不实现，保留固定偏移量。重叠属于低概率场景，后续做通用自动布局时统一处理。

### Toolbar 传参

```tsx
<VideoNodeToolbar
  show={selected && hasMedia && !trimMode}
  onFullscreen={handleOpenFullscreen}
  fullscreenTriggerRef={fullscreenTriggerRef}
  onDownload={handleDownload}
  onTrim={handleOpenTrim}
  onCaptureFrame={handleCaptureFrame}
  capturingType={capturingType}
/>
```

### 测试用例 — 新增 8 例

| # | 测试 | 验证 |
|---|------|------|
| 1 | 截帧成功 → addNode('image') | fileId + status='done' |
| 2 | 截帧成功 → addEdge(source, target) | source=videoNodeId, target=newNodeId, type='default' |
| 3 | 截帧成功 → selectNode(newNodeId) | 新节点选中 |
| 4 | 截帧成功 → message.success | 提示文案正确 |
| 5 | 截帧失败 → message.error + 不创建节点 | nodes/edges 不变 |
| 6 | 上传失败 → 错误回滚 | 无节点/edge 创建 |
| 7 | capturingType 正确流转 | null → type → null |
| 8 | 技术错误 → 友好文案转换 | '视频帧加载超时' → 用户提示 |

---

## Task 7: 验证

### 验证命令

```bash
# 全部单元测试
cd apps/web && npx vitest run --reporter=verbose

# 新增/修改文件单独跑
cd apps/web && npx vitest run --reporter=verbose \
  src/utils/videoFrameUtils.test.ts \
  src/utils/mediaUploadUtils.test.ts \
  src/hooks/useThumbnails.test.ts \
  src/hooks/useVideoFrameCapture.test.ts \
  src/pages/canvas/components/nodes/VideoNodeToolbar.test.tsx \
  src/pages/canvas/components/nodes/VideoGenNode.test.tsx

# TypeScript 类型检查
cd apps/web && npx tsc --noEmit
```

### 自动化验证清单

| # | 检查项 | 命令 |
|---|--------|------|
| 1 | 所有已有测试通过 | `npx vitest run` |
| 2 | 新增 50+ 测试全部通过 | 同上 |
| 3 | TypeScript 无错误 | `npx tsc --noEmit` |
| 4 | 无 console.error/warning（除预期埋点） | 观察测试输出 |

### 手动验证（真实浏览器，五个核心边界场景）

| # | 验证场景 | 验证点 |
|---|----------|--------|
| 5 | 多视频节点同时截首帧 | 竞态保护生效，各自画面正确（不串画） |
| 6 | 预取过程中点击截首帧 | 不报"截帧进行中"，等待预取完成后秒出 |
| 7 | 极短视频（< 0.2s）首帧/尾帧 | 不崩溃，clamp 后正常截取 |
| 8 | 跨域视频截帧降级 | 无 CORS → 画布污染 SecurityError → 友好提示 |
| 9 | 弱网 seek 超时 | seek 3s 超时 → 友好提示，无假死 |

---

## 执行顺序

```
Task 1 (videoFrameUtils) ──── Task 3 (useThumbnails 重构) → 立即跑测试
    ├── Task 4 (useVideoFrameCapture hook)
    └── Task 5 (Toolbar props)

Task 2 (mediaUploadUtils) ──── Task 6b (VideoGenNode 集成)
                                    ↑
Task 6a (canvasStore.addEdge)  ─────┤
Task 4, Task 5 ─────────────────────┘
                                        ↓
                                    Task 7 (验证 + 手动)
```

每 Task 内严格 TDD：写测试 → 确认失败（红）→ 写最小实现 → 确认通过（绿）→ 重构。

每个 Task 完成即 git commit。

### 关键约束

| 约束 | 说明 |
|------|------|
| Task 1 零 API 依赖 | videoFrameUtils 不引入任何 API/网络模块 |
| Task 3 重构验证前置 | 必须跑通 useThumbnails 10 个测试后再推进 |
| Task 4 测试隔离 | beforeEach 清空 videoCache / firstFrameCache / videoLocks |
| **锁机制优先自测** | 开发 Task 4 时优先完成锁机制 + 并发测试（#20, #21），确认底层并发模型正确后再补全业务逻辑 |
| withVideoLock 高阶封装 | 所有锁使用场景统一走 try/finally，杜绝死锁 |
| LRU 淘汰同步清理锁 | 淘汰 video 实例时同步 delete videoLocks，防止 Map 泄漏 |
| 预取代际校验全覆盖 | 每个异步节点后检查 generation，防止无用资源占用 |
| 首帧缓存 LRU 完整实现 | 命中移至末尾 + 超限淘汰最旧，与 video 缓存一致 |
| 预取等待 = 共享 Promise | 禁止轮询，使用 prefetchPromiseRef |
| 无节点防重叠 | 一期保留固定偏移量，不做碰撞检测 |
| Edge type = 'default' | 与 onConnect / edgeTypes 配置一致 |
