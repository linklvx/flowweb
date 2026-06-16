# Plan: 素材库文件卡片 Hover 预览弹窗

> 基于 Spec v2 + 架构审核 v4，TDD 红-绿-重构循环
> 版本：v4 — 修正性能与类型安全关键问题

---

## 实施顺序（按依赖关系排列）

```
Task 1: canvasStore 扩展 + addNode 支持 dataOverride
  └─> Task 2: FilePreviewPopover 新建组件
        └─> Task 3: FileCard + FileGrid 集成
              └─> Task 4: CanvasView 监听 pendingMediaFile 创建节点
```

---

## 前置确认

- `canvasStore.nodeTypeMap` 已存在 `image → imageGen`、`video → videoGen` 映射，Task4 传入 `'image'` / `'video'` 即可正确解析
- `MaterialFile` 类型从 `@flowweb/shared` 导入，canvasStore 与素材库组件均导入此共享类型，不会产生循环依赖
- `dayjs` 由 Ant Design 提供，无需新增依赖

---

## Task 1: canvasStore — addNode 支持 dataOverride + 新增 requestAddMediaNode

### 文件
- **修改**: `apps/web/src/stores/canvasStore.ts`
- **测试**: `apps/web/src/stores/canvasStore.test.ts`

### 改动点

**1.1 修改 `addNode` 签名，支持可选 data 覆盖：**

```typescript
addNode: (type: string, position: XYPosition, dataOverride?: Record<string, unknown>) => string;
```

```typescript
addNode: (type, position, dataOverride) => {
  const id = getId('node');
  const resolvedType = nodeTypeMap[type] || type;
  const baseData = resolvedType === 'textInput' ? { content: '' } : {};
  const nodeData = dataOverride ? { ...baseData, ...dataOverride } : baseData;
  // 其余逻辑不变...
};
```

**1.2 新增 `pendingMediaFile` + `requestAddMediaNode`：**

```typescript
// 类型从 @flowweb/shared 导入，非组件内部类型
import type { MaterialFile } from '@flowweb/shared';

interface CanvasState {
  // ...existing fields...
  pendingMediaFile: MaterialFile | null;
  requestAddMediaNode: (file: MaterialFile) => void;
}
```

```typescript
pendingMediaFile: null,
requestAddMediaNode: (file) => set({ pendingMediaFile: file }),
```

### 测试用例
1. `addNode('image', pos, { fileId: 'x', status: 'done' })` → 节点 data 包含传入字段
2. `addNode('video', pos, { fileId: 'x' })` → 节点 data 包含 `fileId`
3. `addNode('image', pos)` 不传 dataOverride → 节点 data 为 `{}`（向后兼容）
4. `requestAddMediaNode(file)` 设置 `pendingMediaFile`
5. 连续调用 `requestAddMediaNode` 覆盖前一个文件

### 验证命令
```bash
pnpm --filter web test -- --run canvasStore.test.tsx
```

---

## Task 2: FilePreviewPopover — 新建预览内容组件

### 文件
- **新增**: `apps/web/src/components/MaterialLibrary/FilePreviewPopover.tsx`
- **新增**: `apps/web/src/components/MaterialLibrary/FilePreviewPopover.test.tsx`

### 组件接口
```typescript
interface FilePreviewPopoverProps {
  file: MaterialFile;
  onApplyToCanvas: (file: MaterialFile) => void;
}
```

### 组件结构

```tsx
function FilePreviewPopoverContent({ file, onApplyToCanvas }: FilePreviewPopoverProps) {
  const [loading, setLoading] = useState(false);

  const handleApply = useCallback(() => {
    setLoading(true);
    onApplyToCanvas(file);
  }, [file, onApplyToCanvas]);

  return (
    <div className="w-[280px] max-h-[calc(100vh-32px)] flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#262626] shadow-2xl">
      <div className="relative flex min-h-0 w-full flex-1 basis-[225px] items-center justify-center overflow-hidden bg-[#0F0F0F]">
        {file.mimeType?.startsWith('image/') && <ImagePreview file={file} />}
        {file.mimeType?.startsWith('video/') && <VideoPreview file={file} />}
      </div>
      <div className="flex shrink-0 flex-col gap-2 p-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-white/90" title={file.originalName}>
              {file.originalName}
            </span>
            {file.mimeType?.startsWith('video/') && <PlayIcon />}
          </div>
          <span className="text-sm text-white/40">
            创建于 {dayjs(file.createdAt).format('YYYY/M/D HH:mm:ss')}
          </span>
        </div>
        <button
          className="flex h-10 w-full items-center justify-center rounded-lg bg-[#646464] text-sm font-semibold text-[#FAFAFA] hover:bg-[#757575] transition-colors disabled:opacity-60"
          onClick={handleApply}
          disabled={loading}
        >
          {loading ? '处理中...' : '应用到画布'}
        </button>
      </div>
    </div>
  );
}
```

### 图片加载策略（fetch + AbortSignal，真正终止网络请求）

```typescript
function ImagePreview({ file }: { file: MaterialFile }) {
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    // 切换文件时重置所有状态，避免旧状态残留
    setLoadError(false);
    setOriginalUrl(null);
    setImageLoaded(false);
    // 释放上一个 objectURL
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    if (!file.url) {
      setLoadError(true);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    fetch(file.url, { signal: controller.signal })
      .then((res) => res.blob())
      .then((blob) => {
        // 已中止则跳过状态更新，避免卸载后 setState 警告
        if (controller.signal.aborted) return;
        const objUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objUrl;
        setOriginalUrl(objUrl);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setLoadError(true);
      });

    return () => {
      controller.abort();
      // 组件卸载时释放当前 objectURL，避免内存泄漏
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [file.url]);

  if (loadError) return <ErrorPlaceholder />;

  return (
    <>
      {file.thumbnailUrl && (
        <img
          src={file.thumbnailUrl}
          className="z-0 max-h-full max-w-full object-contain absolute inset-0"
        />
      )}
      {originalUrl && (
        <img
          src={originalUrl}
          className={`relative z-10 max-h-full max-w-full object-contain transition-opacity duration-150 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setImageLoaded(true)}
        />
      )}
    </>
  );
}
```

**淡入方案：** 使用 `transition-opacity duration-150` + `onLoad` 设置 `opacity: 1`，纯 Tailwind 方案，不依赖自定义 keyframes。

**关键点：**
- 缩略图用 `<img src>` 直载（体积小，无需 AbortController）
- 原图用 `fetch(url, { signal })` → blob → `URL.createObjectURL`，可通过 `abort()` 真正终止网络请求
- `controller.signal.aborted` 守卫防止卸载后 setState 警告
- cleanup 中同时 abort + revokeObjectURL，确保卸载和切换文件都能正确释放内存
- 无缩略图时媒体区显示纯黑背景，原图加载后淡入

### 视频加载策略

```typescript
function VideoPreview({ file }: { file: MaterialFile }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    // 切换文件时重置错误状态
    setLoadError(false);

    const video = videoRef.current;
    if (!video || !file.url) {
      setLoadError(true);
      return;
    }

    video.src = file.url;

    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [file.url]);

  if (loadError) return <ErrorPlaceholder />;

  return (
    <video
      ref={videoRef}
      poster={file.thumbnailUrl}
      preload="metadata"
      autoPlay
      loop
      muted
      playsInline
      disablePictureInPicture
      onError={() => setLoadError(true)}
      onCanPlay={(e) => { e.currentTarget.play().catch(() => {}); }}
      className="relative z-10 max-h-full max-w-full object-contain"
    />
  );
}
```

### 加载失败占位

```
#0F0F0F 背景 + 居中 24px 破损图标 + 12px text-white/40 "加载失败"
```

### 测试用例
1. 图片文件：渲染底层缩略图 + 上层原图异步加载 + 文件名 + 日期 + 按钮
2. 视频文件：渲染 video 元素（autoplay/loop/muted/poster）+ 播放图标
3. 文件名 truncate + `title` 属性显示完整名
4. 日期使用 dayjs 格式 `YYYY/M/D HH:mm:ss`
5. 按钮点击 → 调用 `onApplyToCanvas(file)` + 按钮进入 loading
6. 图片 fetch 失败 → 显示占位图 + "加载失败"
7. 视频加载失败 → 显示占位图 + "加载失败"
8. 组件卸载时 AbortController.abort() 被调用，视频执行三步清理
9. 组件卸载时 `URL.revokeObjectURL` 正确释放（mock 验证）
10. 快速切换 file props 时，前一次 fetch 被 AbortController 终止（验证 signal.aborted）
11. 图片渐进加载：底层缩略图始终可见 + 上层原图加载后淡入
12. 视频触发 error 事件时，渲染加载失败占位图
13. 图片 file.url 为空时，直接显示加载失败占位图

### 验证命令
```bash
pnpm --filter web test -- --run FilePreviewPopover.test.tsx
```

---

## Task 3: FileCard + FileGrid — 集成 Popover 包裹 + 滚动关闭

### 文件
- **修改**: `apps/web/src/components/MaterialLibrary/FileGrid/FileCard.tsx`
- **修改**: `apps/web/src/components/MaterialLibrary/FileGrid/FileGrid.tsx`
- **测试**: `apps/web/src/components/MaterialLibrary/FileGrid/FileCard.test.tsx`

### 3.1 FileGrid — 触屏检测上移 + 滚动关闭

在 FileGrid 组件中初始化 `useFinePointer`（单例），通过 props 下发给所有 FileCard：

```typescript
// FileGrid.tsx
function useFinePointer(): boolean {
  const [fine, setFine] = useState(() => window.matchMedia('(pointer: fine)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: fine)');
    const handler = (e: MediaQueryListEvent) => setFine(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return fine;
}

// 滚动时派发自定义事件统一关闭弹窗（100ms 节流降低开销）
const handleScroll = useMemo(
  () => throttle(() => {
    window.dispatchEvent(new CustomEvent('material-library:list-scroll'));
  }, 100),
  [],
);
```

Scroll 事件绑定在 FileGrid 的滚动容器上（仅 1 个监听器），节流避免高频触发。`throttle` 从项目已有的 `@/utils/debounce` 或自行实现。

### 3.2 FileCard — 受控 Popover + 监听滚动关闭

```tsx
// FileCard.tsx
interface FileCardProps {
  // ...existing props...
  isFinePointer: boolean; // 从 FileGrid 下发，非各自实例化
}

const [popoverOpen, setPopoverOpen] = useState(false);

// 监听滚动 → 关闭弹窗
useEffect(() => {
  if (!popoverOpen) return;
  const handler = () => setPopoverOpen(false);
  window.addEventListener('material-library:list-scroll', handler);
  return () => window.removeEventListener('material-library:list-scroll', handler);
}, [popoverOpen]);

const isMedia = file.mimeType?.startsWith('image/') || file.mimeType?.startsWith('video/');

const handleApplyToCanvas = useCallback((file: MaterialFile) => {
  setPopoverOpen(false); // 显式关闭，不依赖素材库生命周期
  useCanvasStore.getState().requestAddMediaNode(file);
  useMaterialLibraryStore.getState().close();
}, []);

// 非媒体文件 或 触屏设备 → 不渲染 Popover
if (!isMedia || !isFinePointer) {
  return <div>{/* 原有卡片内容 */}</div>;
}

return (
  <Popover
    open={popoverOpen}
    onOpenChange={setPopoverOpen}
    arrow={false}
    placement="right"
    offset={[0, 0]}
    mouseEnterDelay={0.3}
    mouseLeaveDelay={0.15}
    zIndex={1050}
    destroyTooltipOnHide={true}
    classNames={{ body: "p-0 bg-transparent" }}
    content={
      <FilePreviewPopover
        file={file}
        onApplyToCanvas={handleApplyToCanvas}
      />
    }
  >
    <div>{/* 原有卡片内容 + hover 触发 */}</div>
  </Popover>
);
```

**关键配置说明：**
- `open`/`onOpenChange` — 受控模式，点击应用后显式关闭
- `offset={[0, 0]}` — 弹窗紧贴卡片（x=0, y=0），间距 ≤ 4px，配合 150ms 离开延迟保证容错
- `destroyTooltipOnHide={true}` — 隐藏时卸载 DOM，触发 FilePreviewPopover 清理
- `classNames.body: "p-0 bg-transparent"` — 移除默认内边距和背景
- 滚动关闭：FileGrid 派发自定义事件，仅当 `popoverOpen=true` 时才监听（优化性能）

**z-index 层级约定：**
- antd 5 默认层级：Modal/Drawer ~1000，Popover ~1030
- 预览 Popover 显式 `zIndex={1050}`，高于 Modal，可正常显示在素材库弹窗之上
- 若项目自定义过 Modal z-index，同步调整为 `Modal zIndex + 50`

### 测试用例
1. 图片文件：渲染 Popover，hover 时显示 FilePreviewPopover
2. 视频文件：渲染 Popover，hover 时显示 FilePreviewPopover
3. 非媒体文件：不渲染 Popover，保持原有结构
4. Popover 配置：open 受控模式、arrow=false、placement="right"、destroyTooltipOnHide=true、offset=0
5. "应用到画布"点击 → 先 `setPopoverOpen(false)`，再调用 store 方法
6. `isFinePointer=false`（触屏）：不渲染 Popover，返回原生卡片
7. `isFinePointer=true`（精确指针）：正常渲染 Popover
8. `material-library:list-scroll` 事件触发时，已打开的 Popover 自动关闭

### 验证命令
```bash
pnpm --filter web test -- --run FileCard.test.tsx
```

---

## Task 4: CanvasView — 监听 pendingMediaFile 创建节点

### 文件
- **修改**: `apps/web/src/pages/canvas/components/CanvasView.tsx`
- **测试**: `apps/web/src/pages/canvas/components/CanvasView.test.tsx`

### 改动点

```typescript
useEffect(() => {
  const unsub = useCanvasStore.subscribe(
    (state) => state.pendingMediaFile,
    (file) => {
      if (!file || !reactFlowWrapper.current) return;

      try {
        const bounds = reactFlowWrapper.current.getBoundingClientRect();
        const centerClientX = bounds.left + bounds.width / 2;
        const centerClientY = bounds.top + bounds.height / 2;

        let position = screenToFlowPosition({
          x: centerClientX,
          y: centerClientY,
        });

        // 减去节点默认尺寸的一半，实现视觉居中
        const NODE_DEFAULT_WIDTH = 320;
        const NODE_DEFAULT_HEIGHT = 240;
        position = {
          x: position.x - NODE_DEFAULT_WIDTH / 2,
          y: position.y - NODE_DEFAULT_HEIGHT / 2,
        };

        // nodeTypeMap 已有: image → imageGen, video → videoGen
        const isVideo = file.mimeType?.startsWith('video/');
        const nodeType = isVideo ? 'video' : 'image';

        // 预填充 URL 减少节点初次查询
        const nodeData = {
          fileId: file.id,
          status: 'done',
          mediaName: file.originalName,
          mediaUrl: file.url,
          thumbnailUrl: file.thumbnailUrl,
        };

        addNode(nodeType, position, nodeData);
      } catch (err) {
        // 异常兜底：清空 pending 防止死锁 + 上报可观测性
        console.error('[CanvasView] addMediaNode failed:', err);
        Sentry?.captureException(err);
      } finally {
        useCanvasStore.setState({ pendingMediaFile: null });
      }
    },
    { fireImmediately: false },
  );

  return () => {
    unsub();
    useCanvasStore.setState({ pendingMediaFile: null });
  };
}, [screenToFlowPosition, addNode]);
```

**防御性兜底：**
- `!reactFlowWrapper.current` — React Flow 未初始化时跳过
- `try/catch/finally` — 异常时清空 `pendingMediaFile`，防止状态死锁
- 卸载时清空残留

### 测试用例
1. `pendingMediaFile` (image/*) → 创建 imageGen 节点，data 含 `fileId` + `status: 'done'` + `mediaUrl`
2. `pendingMediaFile` (video/*) → 创建 videoGen 节点，data 含 `fileId` + `status: 'done'` + `mediaUrl`
3. 节点创建后 `pendingMediaFile` 被清空为 null
4. 节点创建在画布容器可视中心位置
5. 新节点为选中状态（addNode 已内置）
6. CanvasView 卸载时清空 `pendingMediaFile`
7. 节点创建异常时兜底清空 `pendingMediaFile`，防止死锁

### 验证命令
```bash
pnpm --filter web test -- --run CanvasView.test.tsx
```

---

## 集成验证

```bash
# 运行所有相关测试
pnpm --filter web test -- --run "canvasStore|FilePreviewPopover|FileCard|CanvasView"

# TypeScript 类型检查
pnpm --filter web typecheck

# 完整测试套件
pnpm test
```

---

## 手动验证清单
- [ ] 鼠标 hover 图片卡片 300ms → 预览弹窗出现，缩略图立即显示 + 原图淡入
- [ ] 鼠标 hover 视频卡片 → 视频自动播放（静音循环）+ 播放图标
- [ ] 鼠标从卡片快速移向弹窗 → 弹窗不关闭（gap ≤ 4px + 150ms 延迟）
- [ ] 鼠标离开弹窗 150ms → 弹窗关闭，视频暂停 + 移除 src + load
- [ ] 素材库列表滚动 → 已打开的弹窗自动关闭
- [ ] 浏览器窗口右侧空间不足 → 弹窗自动翻转到左侧
- [ ] 超大尺寸图片/视频 → object-contain 生效，不溢出
- [ ] 图片/视频加载失败 → 显示占位图 + "加载失败"
- [ ] 快速划过多个卡片 → 仅最后一次预览保留，前次请求被 abort
- [ ] 点击「应用到画布」→ 弹窗显式关闭 + 素材库关闭 + 画布中心新建节点
- [ ] 新节点自动选中 + 媒体正确加载显示
- [ ] 触屏设备 → 不触发 hover 预览

---

## 实施检查清单
- [ ] Task 1: canvasStore 扩展（test → red → green → refactor）
- [ ] Task 2: FilePreviewPopover 组件（test → red → green → refactor）
- [ ] Task 3: FileCard + FileGrid 集成（test → red → green → refactor）
- [ ] Task 4: CanvasView 集成（test → red → green → refactor）
- [ ] 全量测试通过
- [ ] TypeScript strict 类型检查通过
- [ ] 浏览器手动验证通过
