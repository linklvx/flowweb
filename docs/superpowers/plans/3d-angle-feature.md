<!-- doc-status: historical | verified_at: n/a -->
# Plan: 3D 角度功能 (3D Angle)

> 状态: 待确认
> 日期: 2026-06-21
> 关联 Spec: docs/superpowers/specs/3d-angle-feature.md

## 文件清单

### 新建文件 (12 个)

| # | 文件 | 说明 |
|---|------|------|
| 1 | `packages/shared/src/types/angle3d.types.ts` | 共享类型定义 |
| 2 | `apps/web/src/stores/angle3DStore.ts` | Zustand store |
| 3 | `apps/web/src/stores/angle3DStore.test.ts` | Store 单元测试 |
| 4 | `apps/web/src/pages/canvas/engine/Angle3DEngine.ts` | Three.js 3D 引擎 |
| 5 | `apps/web/src/pages/canvas/engine/Angle3DEngine.test.ts` | 引擎单元测试 |
| 6 | `apps/web/src/pages/canvas/hooks/useAngle3DEngine.ts` | 引擎 React hook |
| 7 | `apps/web/src/pages/canvas/components/Angle3D/Angle3DModal.tsx` | 全屏模态 |
| 8 | `apps/web/src/pages/canvas/components/Angle3D/Angle3DPreview.tsx` | 左侧 3D 预览 |
| 9 | `apps/web/src/pages/canvas/components/Angle3D/ControlPanel.tsx` | 右侧控制面板 |
| 10 | `apps/web/src/pages/canvas/components/Angle3D/AnglePresetButtons.tsx` | 多角度预设按钮 |
| 11 | `apps/web/src/pages/canvas/components/Angle3D/AnglePresetButtons.test.tsx` | 预设按钮测试 |
| 12 | `apps/api/src/modules/ai-image-edit/angle3d/` | 后端 API 模块 (7 文件) |

### 修改文件 (4 个)

| # | 文件 | 变更 |
|---|------|------|
| 13 | `packages/shared/src/index.ts` | 新增 angle3d 类型导出 |
| 14 | `apps/web/src/pages/canvas/page.tsx` | 挂载 Angle3DModal |
| 15 | `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx` | 「3D 角度」按钮绑定 onClick |
| 16 | `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx` | 新增 handleAngle3D 回调 |

---

## 实施阶段 (TDD: 红 → 绿 → 重构)

### Phase 1: 共享类型

**Step 1.1** — 创建 `angle3d.types.ts`

```typescript
// packages/shared/src/types/angle3d.types.ts

type Angle3DTaskStatus = 'idle' | 'pending' | 'processing' | 'success' | 'failed';

export const Angle3DTaskStatuses = {
  IDLE: 'idle' as Angle3DTaskStatus,
  PENDING: 'pending' as Angle3DTaskStatus,
  PROCESSING: 'processing' as Angle3DTaskStatus,
  SUCCESS: 'success' as Angle3DTaskStatus,
  FAILED: 'failed' as Angle3DTaskStatus,
} as const;

export interface Angle3DParams {
  horizontalAngle: number; // -90 ~ 90
  verticalAngle: number;   // -60 ~ 60
  zoom: number;            // 0 ~ 10
  customPrompt?: string;
}

export type Angle3DPresetKey = 'fisheye' | 'tilted' | 'topDown' | 'bottomUp' | 'panoramicTopDown';

export interface Angle3DPreset {
  key: Angle3DPresetKey;
  label: string;
  horizontalAngle: number;
  verticalAngle: number;
  zoom: number;
}

export const ANGLE3D_PRESETS: Angle3DPreset[] = [
  { key: 'fisheye', label: '鱼眼视角', horizontalAngle: 0, verticalAngle: 30, zoom: 10 },
  { key: 'tilted', label: '倾斜视角', horizontalAngle: 45, verticalAngle: -30, zoom: 5 },
  { key: 'topDown', label: '正面俯拍', horizontalAngle: 0, verticalAngle: 60, zoom: 5 },
  { key: 'bottomUp', label: '正面仰拍', horizontalAngle: 0, verticalAngle: -30, zoom: 5 },
  { key: 'panoramicTopDown', label: '全景俯拍', horizontalAngle: 45, verticalAngle: 30, zoom: 0 },
];

export const ANGLE3D_DEFAULTS: Angle3DParams = {
  horizontalAngle: 0,
  verticalAngle: 0,
  zoom: 5,
};

// 预设阈值匹配
export const PRESET_MATCH_THRESHOLDS = {
  horizontalAngle: 0.5,
  verticalAngle: 0.5,
  zoom: 0.1,
};
```

**Step 1.2** — 修改 `packages/shared/src/index.ts`，添加导出

```typescript
export * from './types/angle3d.types';
```

> verify: `tsc --noEmit` 通过

---

### Phase 2: angle3DStore（Zustand）

**Step 2.1** — 创建 `angle3DStore.test.ts`（红）

测试用例：
- openModal(新节点): 设置 visible、nodeId、imageUrl、canvasId、默认参数、清空 taskInfo
- openModal(同节点): 仅设置 visible=true，**保留** params、taskInfo、estimatedCredits
- openModal(不同节点): 重置 params 为默认值、清空 taskInfo、更新 nodeId/imageUrl/canvasId
- closeModal: 仅设置 visible=false，不清理任何业务数据
- updateParams: 部分更新参数
- updateParams: 合并更新多个参数
- applyPreset: 应用预设参数（三项全部更新）
- applyPreset: 未知 key 不修改参数
- resetParams: 重置 params 为默认值，不影响 taskInfo
- setTaskState: 更新 taskId/taskStatus/resultUrl/errorMessage（部分更新语义）
- setTaskState: 不覆盖未提供字段
- replaceCurrentNode: 调用后触发节点替换（通过 callback 模式验证）
- createNewNode: 调用后触发新建节点（通过 callback 模式验证）
- retryTask: 重置 taskStatus 为 idle，保留 params
- open→close→open(同节点): 参数与任务状态完整保留
- open→close→open(不同节点): 参数与任务状态完全隔离

**Step 2.2** — 创建 `angle3DStore.ts`（绿）

```typescript
interface Angle3DState {
  visible: boolean;
  nodeId: string | null;
  canvasId: string | null;     // 新增：后端权限校验 + 节点回写
  imageUrl: string | null;
  params: Angle3DParams;
  taskId: string | null;
  taskStatus: Angle3DTaskStatus;
  resultUrl: string | null;
  estimatedCredits: number;
  errorMessage: string | null;
}

// Actions:
// openModal(nodeId, imageUrl, canvasId) — 同节点仅 visible=true；不同节点全量重置
// closeModal() — 仅 visible = false，保留业务数据
// updateParams(partial) — 部分更新 params
// applyPreset(key) — 应用预设参数（三项全量更新）
// resetParams() — 重置为默认值
// setTaskState(partial) — 更新任务相关字段
// setEstimatedCredits(value) — 更新预估积分
// replaceCurrentNode(resultUrl) — 回调触发替换当前节点图片
// createNewNode(resultUrl) — 回调触发新建图片节点
// retryTask() — 重置 taskStatus 为 idle，保留 params 用于重新提交
```

**节点操作回调注入（Map 模式，按 nodeId 隔离）：**

```typescript
// Store 内部以 Map 存储，确保多节点场景数据隔离
nodeCallbacksMap: Map<string, NodeCallbacks>

setNodeCallbacks(nodeId: string, callbacks: NodeCallbacks | null) {
  if (callbacks === null) {
    this.nodeCallbacksMap.delete(nodeId);
  } else {
    this.nodeCallbacksMap.set(nodeId, callbacks);
  }
}

// replaceCurrentNode / createNewNode 自动匹配当前打开节点
replaceCurrentNode(resultUrl: string) {
  const callbacks = this.nodeCallbacksMap.get(this.nodeId!);
  callbacks?.onReplaceCurrentNode(resultUrl);
}
```

> verify: `pnpm --filter @flowweb/web test -- angle3DStore` 全部通过

---

### Phase 3: Angle3DEngine（Three.js 引擎）

**Step 3.1** — 创建 `Angle3DEngine.test.ts`（红）

测试用例（参考 LightingEngine.test.ts 模式，mock WebGLRenderer + OrbitControls）：
- 场景初始化：perspectiveCamera 存在、scene.background 为 #0a0e1a
- 图片平面：使用 PlaneGeometry + MeshBasicMaterial、transparent:true、depthWrite:true
- **图片平面宽高比**：给定已知宽高比的纹理，验证平面 geometry 尺寸（高度固定 2，宽度 = 2 × aspect）；加载中显示 1:1 占位平面；纹理加载完成后动态更新
- 地面网格：XZ 平面，Y=-1，尺寸 10×10，分段 10，颜色 #333333/#555555
- OrbitControls: enableDamping=true, **enablePan=false**, enableRotate=true, enableZoom=true
- 球坐标计算（正向）：给定 horizontalAngle/verticalAngle/zoom 产生正确的 camera.position（多点采样验证）
- 球坐标反算（**拖拽同步核心**）：从 camera.position 反推 horizontalAngle、verticalAngle、zoom，与原始值一致
- **反算公式边界钳位**：camera.position 超出合法范围时，反算结果被钳位到边界值（horizontalAngle ±90°、verticalAngle ±60°、zoom 0~10）
- 参数同步：setHorizontalAngle、setVerticalAngle、setZoom 各自正确更新
- 缩放映射：zoom=0 → 最远(r=5)，zoom=10 → 最近(r=2.5)
- 重置：reset() 恢复默认参数 (0,0,5) 和相机位置
- dispose：释放全部资源（geometry、material、OrbitControls、renderer、事件监听）
- **脏标记触发源**：①参数设置方法调用后 dirty=true；②OrbitControls change 事件持续打 dirty；③容器 resize 后 dirty=true；渲染后 dirty 重置为 false
- 线程安全：dispose 后不再渲染、不再响应事件
- webglcontextlost：触发后设置降级标记，清理 WebGL 资源

**Step 3.2** — 创建 `Angle3DEngine.ts`（绿）

```
核心架构（对齐 LightingEngine）：
- 构造函数(container, imageUrl, options?)
- initScene / initCamera / initRenderer / initOrbitControls / initImagePlane / initGrid
- 球坐标相机更新（6.1 公式）
- 脏标记渲染循环
- bindEvents / dispose
- 公开方法：setHorizontalAngle, setVerticalAngle, setZoom, applyPreset, reset, dispose
```

**关键差异 vs LightingEngine：**
- 无光源系统（无 PointLight、无 cone、无 handle、无 line）
- 无后处理（无 EffectComposer、无 OutlinePass）
- 无缩略图渲染
- 无正交相机
- MeshBasicMaterial 替代 MeshStandardMaterial
- enablePan = false
- 相机位置由球坐标参数驱动

**球坐标公式实现（正向）：**
```
α = degToRad(horizontalAngle)
β = degToRad(verticalAngle)
r = 5 * (1 - zoom / 20)

camera.position.x = r * sin(α) * cos(β)
camera.position.y = r * sin(β)
camera.position.z = r * cos(α) * cos(β)
camera.lookAt(0, 0, 0)
```

**OrbitControls polar angle 与 verticalAngle 映射：**
```
verticalAngle → polar:  polar = π/2 - degToRad(verticalAngle)
polar → verticalAngle:  verticalAngle = radToDeg(π/2 - polar)

约束范围：
  minPolarAngle = π/2 - degToRad(60) = π/6     (verticalAngle = +60°)
  maxPolarAngle = π/2 - degToRad(-60) = 5π/6   (verticalAngle = -60°)
```

**OrbitControls → 参数反向推导公式（拖拽同步核心）：**
```
// 从 camera.position 反算参数
horizontalAngle = radToDeg(atan2(camera.position.x, camera.position.z))
verticalAngle   = radToDeg(asin(clamp(camera.position.y / r, -1, 1)))
zoom            = 20 * (1 - camera.position.length() / 5)

// 结果钳位到合法范围
horizontalAngle = clamp(horizontalAngle, -90, 90)
verticalAngle   = clamp(verticalAngle, -60, 60)
zoom            = clamp(zoom, 0, 10)
```

**拖拽同步时序：**
- OrbitControls `change` 事件 → 每帧反算参数 → 16ms throttle 写入 store → 滑块实时更新
- OrbitControls `end` 事件 → 精确反算一次 → 写入 store 确保最终对齐

**脏标记触发来源（三类）：**
1. **参数方法调用**：setHorizontalAngle / setVerticalAngle / setZoom / applyPreset / reset → dirty = true
2. **OrbitControls 事件**：change 事件 → dirty = true（拖拽/缩放中持续触发，保证流畅渲染）；end 事件 → dirty = true 最后一帧
3. **容器 resize**：ResizeObserver 或 window.resize → 更新 renderer + camera aspect → dirty = true

**渲染循环逻辑：**
- 每帧检查 `this.dirty`，为 true 则 `renderer.render()` + `dirty = false`
- 与 LightingEngine 一致：使用 requestAnimationFrame + dirty flag 模式（非持续渲染）

> verify: `pnpm --filter @flowweb/web test -- Angle3DEngine` 全部通过

---

### Phase 4: useAngle3DEngine hook + UI 组件

**Step 4.1** — 创建 `useAngle3DEngine.ts`

```typescript
// 参考 useLightingEngine.ts
interface UseAngle3DEngineOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  imageUrl: string | null;
  params: Angle3DParams;
  onParamsChange: (params: Partial<Angle3DParams>) => void;
}

// 职责：
// 1. imageUrl 变化时 创建/销毁 Angle3DEngine
// 2. params 变化时同步到引擎（horizontalAngle, verticalAngle, zoom）
// 3. 暴露 reset()
```

> 注：此 hook 无 UI，与 useLightingEngine 同类，不单独写测试（由集成测试覆盖）。

**Step 4.2** — 创建 UI 组件

| 组件 | 说明 | 测试 |
|------|------|------|
| `AnglePresetButtons.tsx` | 5 预设按钮 + 自定义标签，阈值匹配高亮 | `AnglePresetButtons.test.tsx` |
| `Angle3DPreview.tsx` | 左侧 3D 容器 + 加载/错误状态 + 左下提示 | 无需单独测试（依赖 WebGL mock） |
| `ControlPanel.tsx` | 水平角度/垂直角度/缩放滑块 + 预设按钮 + 提示词 + 生成按钮 | 无需单独测试（纯组装） |
| `Angle3DModal.tsx` | 全屏 portal，组合 Preview + ControlPanel + ResultOverlay + ErrorOverlay | 无需单独测试（集成层级） |

**Step 4.3** — 创建 `AnglePresetButtons.test.tsx`（红）

测试用例：
- 渲染 5 个预设按钮 + 1 个自定义标签
- 当前参数匹配预设时对应按钮高亮
- 偏离所有预设时「自定义」标签高亮
- 阈值边界测试（±0.5°/±0.1 偏差内匹配）
- 点击预设触发 onSelect 回调
- 自定义标签不可点击

**Step 4.4** — 实现 `AnglePresetButtons.tsx`（绿）

```
布局：3 列网格 (鱼眼/倾斜/正面俯拍) + (正面仰拍/全景俯拍/自定义)
自定义：不可点击，灰色文字标签
匹配逻辑：遍历预设，三项偏差均在阈值内 → 匹配
```

> verify: `pnpm --filter @flowweb/web test -- AnglePresetButtons` 通过

**Step 4.5** — 实现 `Angle3DPreview.tsx` + `ControlPanel.tsx` + `Angle3DModal.tsx`

组件树：
```
Angle3DModal (全屏 portal, z-[100000])
├── 半透明遮罩背景 (点击关闭)
├── 内容容器 (max-w-[1400px], 圆角, 同 LightingModal)
│   ├── Top bar (标题「🎥 3D 角度」+ 使用手册链接 + Esc提示 + 关闭按钮)
│   ├── Angle3DPreview (左侧 flex-1)
│   │   ├── div ref={containerRef} (Three.js 挂载点)
│   │   ├── 加载状态遮罩 (半透明占位平面 + 加载图标)
│   │   ├── 加载失败遮罩 (灰色平面 + 「图片加载失败」文字)
│   │   └── 左下角提示「拖拽旋转视角 · 滚轮缩放」+ 重置按钮
│   └── ControlPanel (右侧 320px)
│       ├── AnglePresetButtons
│       ├── 水平角度滑块 (-90 ~ 90) [processing时禁用]
│       ├── 垂直角度滑块 (-60 ~ 60) [processing时禁用]
│       ├── 缩放滑块 (0 ~ 10) [processing时禁用]
│       ├── PromptInput (复用) [processing时禁用]
│       └── 生成按钮 (显示预估积分)
│   ├── ResultOverlay (taskStatus=success 时)
│   │   ├── 结果图片预览
│   │   ├── 「替换当前节点」按钮
│   │   └── 「新建图片节点」按钮
│   └── ErrorOverlay (taskStatus=failed 时)
│       ├── 错误信息
│       └── 「重试」按钮 (调用 retryTask)
```

**事件穿透处理（Angle3DModal 内实现）：**

```typescript
// useEffect 在模态挂载时处理
useEffect(() => {
  if (!visible) return;

  // 方案1：全屏 z-[100000] portal 覆盖，自然阻断鼠标事件
  // 方案2：捕获可能穿透的 wheel 事件，阻止传播到下层画布
  const stopWheel = (e: WheelEvent) => e.stopPropagation();
  const modalRoot = modalRef.current;
  modalRoot?.addEventListener('wheel', stopWheel, { passive: false });

  return () => {
    modalRoot?.removeEventListener('wheel', stopWheel);
  };
}, [visible]);
// 对齐 LightingModal 模式：依靠 z-index 层级 + portal 到 body 自然阻断交互
```

**ControlPanel 控件禁用规则：**
- `taskStatus === 'processing' || taskStatus === 'pending'` 时：
  - 三个滑块：disabled
  - 预设按钮组：pointer-events-none + opacity-50
  - PromptInput：disabled
  - 重置按钮：disabled
  - 生成按钮：显示「生成中...」
- `taskStatus === 'success' || taskStatus === 'failed' || taskStatus === 'idle'` 时恢复全部操作

**Esc 键 + 遮罩点击关闭：**
- Esc 监听（useEffect + keydown）：closeModal()
- 半透明遮罩 onClick（target === currentTarget）：closeModal()
- 对齐 LightingModal 交互范式

---

### Phase 5: 工具栏接线

**Step 5.1** — 在 `ImageGenNode.tsx` 中添加 `handleAngle3D` 回调 + 注册节点操作回调

```typescript
const projectId = useCanvasStore(s => s.projectId); // 或从 props/context 获取

const handleAngle3D = useCallback(async () => {
  const targetFileId = fileId || referenceImage;
  if (!targetFileId) return;
  try {
    const { url } = await getMediaUrl(targetFileId);
    useAngle3DStore.getState().openModal(id, url, projectId);
  } catch {
    // silently fail
  }
}, [id, fileId, referenceImage, projectId]);

// 注册节点操作回调（Map 模式，按 nodeId 隔离）
useEffect(() => {
  useAngle3DStore.getState().setNodeCallbacks(id, {
    onReplaceCurrentNode: (resultUrl: string) => {
      // 更新当前节点的 fileId
      // 先通过 presignUpload+confirmUpload 把 resultUrl 转为 fileId
    },
    onCreateNewNode: (resultUrl: string) => {
      // 在画布原节点旁新增一个图片节点
      useCanvasStore.getState().addChildNode(id, { 
        status: 'done' 
      });
    },
  });
  return () => {
    useAngle3DStore.getState().setNodeCallbacks(id, null);
  };
}, [id, updateConfig]);
```

**Step 5.2** — 在 `ImageNodeToolbar.tsx` 中

- props 新增 `onAngle3D?: () => void`
- 「3D 角度」按钮绑定 `onClick={onAngle3D}`

**Step 5.3** — 在 `ImageGenNode.tsx` 中

- `<ImageNodeToolbar>` 传递 `onAngle3D={handleAngle3D}`

**Step 5.4** — 在 `page.tsx` 中

- import `Angle3DModal`
- 在 JSX 中添加 `<Angle3DModal />`（与 `<LightingModal />` 同级）

> verify: 启动 dev server，点击 3D 角度按钮确认模态打开

---

### Phase 6: 后端 API（延后，非阻塞前端开发）

> 注：后端 API 可延后实现，前端可先使用 mock 或复用 lighting API 测试交互。

后端文件清单：
```
apps/api/src/modules/ai-image-edit/angle3d/
  dto/create-angle3d-task.dto.ts
  interfaces/angle3d-task.interface.ts
  angle3d.controller.ts
  angle3d.controller.spec.ts
  angle3d.service.ts
  angle3d.service.spec.ts
  angle3d.consumer.ts
```

- 端点：`POST /api/image-edit/angle3d/tasks`、`GET /api/image-edit/angle3d/tasks/:taskId`
- 复用现有 BullMQ `ai-image-edit` 队列
- 复用积分冻结/解冻逻辑
- 复用 MinIO 存储 + Socket.io 通知

---

## 实施顺序与依赖关系

```
Phase 1 (shared types)     ← 无依赖，最先
  ↓
Phase 2 (store)            ← 依赖 Phase 1
  ↓
Phase 3 (engine)           ← 依赖 Phase 1，独立于 Phase 2
  ↓
Phase 4 (hook + 组件)      ← 依赖 Phase 2 + Phase 3
  ↓
Phase 5 (工具栏接线)       ← 依赖 Phase 4
  ↓
Phase 6 (后端 API)         ← 延后，非阻塞
```

Phase 2 和 Phase 3 可并行开发（互不依赖）。

---

## TDD 红线规则

每个 Phase 内：
1. **红** — 先写测试，确认失败
2. **绿** — 最小实现让测试通过
3. **重构** — 消除重复，优化结构

---

## 不做的

- 不修改 LightingEngine 任何代码
- 不新增路由（使用 portal overlay 模式）
- 不新增 npm 依赖
- 不发送真实 HTTP 请求（Phase 5 使用 mock）
- 节点覆盖范围：仅 ImageGenNode，其他节点类型暂不接入

---

## 开发执行注意事项（实现阶段落地）

### 1. 节点回调作用域隔离

**问题**：Store 采用单组 `setNodeCallbacks` 注入，画布存在多个 ImageGenNode 时，后挂载节点会覆盖前一个节点的回调，导致生成结果回写到错误节点。

**方案**：Store 内回调按 nodeId 以 `Map<string, NodeCallbacks>` 形式存储：

```typescript
// angle3DStore 内部
nodeCallbacksMap: new Map<string, NodeCallbacks>()

setNodeCallbacks(nodeId: string, callbacks: NodeCallbacks | null) {
  if (callbacks === null) {
    this.nodeCallbacksMap.delete(nodeId);
  } else {
    this.nodeCallbacksMap.set(nodeId, callbacks);
  }
}

// replaceCurrentNode / createNewNode 自动匹配当前打开节点
replaceCurrentNode(resultUrl: string) {
  const callbacks = this.nodeCallbacksMap.get(this.nodeId!);
  callbacks?.onReplaceCurrentNode(resultUrl);
}
```

ImageGenNode 挂载时注册回调（带 nodeId），卸载时清除。

### 2. 纹理跨域显式配置

**问题**：即使 MinIO 已配置 CORS，Three.js `TextureLoader` 默认不设置 `crossOrigin`，导致 canvas 被标记为「已污染」（tainted），后续 `toDataURL` / `readRenderTargetPixels` 报错。

**方案**：纹理加载时显式设置：

```typescript
const loader = new THREE.TextureLoader();
// 在 load 之前设置 crossOrigin
loader.crossOrigin = 'anonymous';
loader.load(url, onLoad, onProgress, onError);
```

写入 Angle3DEngine 的 `initImagePlane` 方法。

### 3. OrbitControls 阻尼与脏标记配合

**问题**：`enableDamping = true` 时，用户松手后阻尼惯性动画会持续触发 `change` 事件（通常 0.5~1s），若在此期间停止打脏标记，动画会掉帧卡顿。

**方案**：直接复用 LightingEngine 的实现模式——

- OrbitControls `change` 事件监听器中设置 `this.dirty = true`
- 渲染循环中：读取 `this.dirty` → 渲染 → 重置为 `false`
- 阻尼动画期间的每一帧 `change` 都会重新打脏标记，直到惯性停止
- 无需特殊处理 `end` 事件

### 4. 引擎销毁时序

**问题**：模态卸载时若先移除 DOM 容器再 dispose 引擎，WebGL 上下文可能已随 DOM 移除而丢失，导致 `renderer.dispose()` 报错或资源泄漏。

**方案**：在 `useAngle3DEngine` 的 cleanup effect 中严格遵循顺序：

```typescript
useEffect(() => {
  // ... 创建 engine
  return () => {
    engine.dispose();      // ① 先释放 WebGL 资源
    engineRef.current = null;  // ② 再断开引用
    // ③ React 随后卸载 DOM（containerRef 对应的 div）
  };
}, [imageUrl]);
```

`dispose()` 方法内部顺序：移除事件监听 → cancelAnimationFrame → 释放 geometry/material/texture → 释放 renderer → 移除 canvas DOM 元素。对齐 LightingEngine.dispose() 的完整清理链路。
