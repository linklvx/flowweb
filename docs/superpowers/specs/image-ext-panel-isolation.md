<!-- doc-status: historical | verified_at: n/a -->
# Spec: 扩展图片节点底部面板独立化

> 日期: 2026-06-30
> 状态: 待确认
> 方案: A — 扩展 ImageNodeData + 独立 ConfigPanel

## 一、目标

扩展图片节点（imageExtGen）的底部配置面板与原始图片节点（imageGen）完全隔离，包括模型选择、比例分辨率、生成数量、积分消耗和运行按钮。两个节点的设置互不影响。

## 二、数据模型

### 2.1 字段归属规则

**根级通用字段（两种节点共用，扁平化，不嵌套在业务对象内）：**

| 分类 | 字段 | 类型 |
|------|------|------|
| 图片实体 | `fileId`, `width`, `height`, `mediaName` | string / number |
| 通用状态 | `status`, `editMode`, `transformMode` | string enum |
| 展示变换 | `imageRotation`, `flipH`, `flipV` | number / boolean |
| 编辑参数 | `aspectRatio`, `customSize` | number / object |
| 参考图列表 | `allImages` | `ImageItem[]`（默认 `[]`） |

**生成配置字段 — 按节点严格隔离，不重叠：**

| 节点类型 | 归属位置 | 字段 |
|----------|----------|------|
| imageGen | 根级 | `model`, `ratio`, `resolution`, `quality`, `style`, `prompt: { text, html }` |
| imageExtGen | `extConfig` 内 | `model`, `ratio`, `resolution`, `quality`, `generateCount`, `prompt: { text, html }` |

**根级但仅扩展节点使用：**

| 字段 | 说明 |
|------|------|
| `aiTool` | AI 工具 ID，仅 imageExtGen 节点写入和读取 |

**关键规则：**
- `prompt` 对象**仅包含 `text` 和 `html`**，不再嵌套 `allImages`，统一使用 `PromptValue` 类型
- `allImages`（参考图列表）提升为根级通用字段，两种节点共用
- `allImages` 默认值为 `[]`，所有新建节点均初始化空数组
- 节点复制、分割时完整继承 `allImages` 数据
- 旧数据兼容：读取时若 `allImages` 不存在，兜底返回 `[]`
- 根级通用字段与业务生成字段完全分层，无嵌套重叠，避免「同一份数据两个入口」

### 2.2 类型定义

```ts
// —— Prompt 值（仅文本，不含图片列表） ——
// 统一类型，两种节点复用，避免两套定义不一致
interface PromptValue {
  text: string;   // 默认 ''
  html: string;   // 默认 ''
}

// —— 扩展节点专属生成配置 ——
interface ImageExtConfig {
  model?: string;
  ratio?: string;
  resolution?: string;
  quality?: string;
  generateCount?: number;
  prompt?: PromptValue;  // 复用统一类型，保证两种节点提示词结构一致
}

// —— ImageNodeData ——
interface ImageNodeData {
  // —— 根级通用 ——
  fileId?: string;
  width?: number;
  height?: number;
  mediaName?: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  editMode?: 'crop' | 'outpaint' | 'erase' | 'redraw' | 'annotate' | null;
  transformMode?: boolean;
  imageRotation?: 0 | 90 | 180 | 270;
  flipH?: boolean;
  flipV?: boolean;
  aspectRatio?: number;
  customSize?: { width: number; height: number };
  allImages: ImageItem[];           // ★ 提升为根级通用

  // —— imageGen 根级专属生成配置 ——
  model?: string;
  ratio?: string;
  resolution?: string;
  quality?: string;
  style?: string;
  prompt?: PromptValue;

  // —— imageExtGen 专属 ——
  extConfig?: ImageExtConfig;       // 扩展节点生成配置（仅 imageExtGen）
  aiTool?: AiToolId;                // AI 工具（仅 imageExtGen）
}
```

### 2.3 类型守卫 — 含运行时校验

类型守卫必须在运行时验证 `extConfig` 存在性，保证类型收窄与运行时完全一致：

```ts
export function isImageExtNode(node: unknown): node is AppNode & {
  type: 'imageExtGen';
  data: ImageNodeData & { extConfig: ImageExtConfig };
} {
  if (!isImageNode(node)) return false;
  if (node.type !== 'imageExtGen') return false;
  // ★ 运行时兜底：无 extConfig 不判定为扩展节点，避免空值风险
  if (!node.data?.extConfig) return false;
  return true;
}
```

类型守卫保持纯函数，不做数据修改，无副作用。

### 2.4 extConfig 运行时安全保障

**创建路径强制注入：** 所有创建 imageExtGen 节点的路径（新建、复制、分割、数据同步），必须保证 `extConfig` 完整初始化。

**旧数据兜底位置：** 兜底逻辑统一收敛在 `nodeStore` 的 selector/读取层：

```ts
// 读取扩展节点配置时自动兜底，不修改 store 原数据
function getExtConfig(nodeId: string): ImageExtConfig {
  const node = get().nodes[nodeId];
  if (!node?.data?.extConfig) return IMAGE_EXT_DEFAULTS;
  return node.data.extConfig;
}
```

兜底仅在读取层做返回值代理，不直接修改 store 数据。类型守卫不做数据修改。

### 2.5 updateConfig 与 updateExtConfig 职责边界

**严格拆分，禁止混用：**

| Action | 职责 | 约束 |
|--------|------|------|
| `updateConfig(id, partial)` | 根级通用字段 + imageGen 根级专属生成字段 | **代码层强制过滤 `extConfig` 字段**：合并前 `delete partial.extConfig`，杜绝误修改 |
| `updateExtConfig(id, partial)` | `extConfig` 内字段的浅合并 | **仅用于扩展节点**，非扩展节点调用无操作 |
| `updateConfig(id, { aiTool })` | `aiTool` 继续用 `updateConfig` | 不进入 `updateExtConfig` |

```ts
// updateConfig 实现层强制过滤
updateConfig: (id, config) => {
  // ★ 代码层杜绝 extConfig 误传入
  if ('extConfig' in config) {
    console.warn('[nodeStore] updateConfig 不允许传入 extConfig，已自动过滤');
    delete (config as any).extConfig;
  }
  // ... 原有合并逻辑 ...
}

// nodeStore 新增
updateExtConfig: (nodeId: string, partial: Partial<ImageExtConfig>) => {
  const node = get().nodes[nodeId];
  if (!isImageExtNode(node)) return;  // 类型守卫已含运行时校验
  set({
    nodes: {
      ...get().nodes,
      [nodeId]: {
        ...node,
        data: {
          ...node.data,
          extConfig: { ...node.data.extConfig, ...partial },
        },
      },
    },
  });
}
```

### 2.6 自定义分辨率交互

- `customSize` 保留在根级通用字段，两种节点均可用
- 扩展节点选择「自定义」分辨率时，`extConfig.resolution = 'custom'`，具体宽高从根级 `customSize` 读取
- 与 imageGen 节点的交互逻辑保持一致

## 三、组件架构

### 3.1 分层职责

```
ImageGenNode（容器 — 不改动主体渲染逻辑）
  ├─ 图片显示 / 上传 / 工具栏 / 编辑模式：完全复用（零改动）
  ├─ <ImageConfigPanelResolver nodeId={id} />
  │   ├─ isImageExtNode(node) === true  → <ImageExtConfigPanel />
  │   └─ 否则                           → <ImageConfigPanel />
  └─ 底部面板渲染位置不变
```

### 3.2 ImageConfigPanelResolver（新建）

- 入参：`{ nodeId: string }`
- 内部调用 `const node = useNodeStore(s => s.nodes[nodeId])`
- 通过 `isImageExtNode(node)` 判断并返回对应面板
- 两个面板均不渲染时返回 `null`

### 3.3 ImageExtConfigPanel（新建）

- 模型选择器 → 调用 `GET /api/node-types/image-ext/models`
- 比例分辨率选择器（独立选项列表）
- 生成数量选择器
- 积分展示 → 调用 `GET /api/pricing/calculate?modelId=X&nodeType=imageExtGen`
- AI 工具选择器（内置于此面板）
- 运行按钮 → 调用 `buildImageExtGenParams` 组装参数后提交
- 通过 `useImageExtConfig` hook 读写 `extConfig`
- 所有 UI 组件为纯展示组件，通过 props 接收数据和回调

### 3.4 ImageConfigPanel（改动）

- 移除 `isExtNode` 条件判断
- 移除 AI 工具选择器渲染
- 移除 `extConfig` 相关读取
- 对 `prompt.allImages` 的引用改为根级 `allImages`
- 恢复为纯 imageGen 节点的配置面板
- 其余逻辑不变

### 3.5 公共 UI 组件（纯展示，不调用 store、不发起请求）

| 组件 | Props |
|------|-------|
| `ModelSelector` | `models`, `selectedId`, `onSelect` |
| `RatioResolutionPopover` | `ratioOptions`, `ratio`, `resolution`, `onChange` |
| `GenerateCountSelector` | `count`, `options`, `onChange` |
| `CreditDisplay` | `cost` |
| `RunButton` | `loading`, `onClick` |

两个配置面板各自组装业务逻辑（数据获取、状态更新），UI 层完全复用。

### 3.6 useImageExtConfig Hook

```ts
function useImageExtConfig(nodeId: string) {
  const extConfig = useNodeStore(s => s.nodes[nodeId]?.data?.extConfig ?? IMAGE_EXT_DEFAULTS);
  const updateExtConfig = useNodeStore(s => s.updateExtConfig);
  const updateConfig = useCallback(
    (partial: Partial<ImageExtConfig>) => updateExtConfig(nodeId, partial),
    [nodeId, updateExtConfig]
  );
  return { extConfig, updateExtConfig: updateConfig };
}
```

避免配置面板中重复编写取值、判断逻辑，通过精确 selector 减少不必要重渲染。

## 四、生成链路

### 4.1 API 与参数组装隔离

| 功能 | imageGen | imageExtGen |
|------|----------|-------------|
| 模型列表 | `GET /api/node-types/image/models` | `GET /api/node-types/image-ext/models` |
| 积分计算 | `GET /api/pricing/calculate?modelId=X` | `GET /api/pricing/calculate?modelId=X&nodeType=imageExtGen` |
| 参数组装 | `buildImageGenParams(nodeId)` | `buildImageExtGenParams(nodeId)` |
| 生成提交 | `POST /api/execution/enqueue` | 同一接口 |

### 4.2 参数组装 — 必须包含 nodeType + allImages + 兜底

```ts
// api/imageNodeApi.ts
function buildImageGenParams(nodeId: string): EnqueueParams {
  const node = getNode(nodeId);
  return {
    projectId: 'default',
    nodeId,
    nodeType: NODE_TYPES.IMAGE_GEN,
    allImages: node.data.allImages ?? [],   // ★ 根级通用参考图
    // 从 node.data 根级读取 model, ratio, resolution, quality, prompt
  };
}

// api/imageExtNodeApi.ts
function buildImageExtGenParams(nodeId: string): EnqueueParams {
  const node = getNode(nodeId);
  const extConfig = getExtConfig(nodeId);    // ★ 复用兜底函数，保证无 extConfig 也能组装合法参数
  return {
    projectId: 'default',
    nodeId,
    nodeType: NODE_TYPES.IMAGE_EXT_GEN,
    allImages: node.data.allImages ?? [],   // ★ 根级通用参考图
    aiTool: node.data.aiTool,               // ★ 根级 aiTool 必须透传
    // 从 extConfig 读取 model, ratio, resolution, quality, generateCount, prompt
  };
}
```

- `buildImageExtGenParams` 必须同时包含 `extConfig` 全量生成配置 + 根级 `aiTool`
- 后端通过 `nodeType` 区分参数解析、模型路由、积分计算逻辑，不依赖数据库二次查询
- 两个纯函数独立，禁止 if/else 混在一套逻辑里

### 4.3 接口模块收敛

```
api/imageNodeApi.ts      — imageGen 的模型查询、参数组装、生成提交
api/imageExtNodeApi.ts   — imageExtGen 的模型查询、参数组装、生成提交、积分查询
```

业务组件不直接 fetch URL，统一通过 API 模块调用。

### 4.4 节点类型常量

```ts
export const NODE_TYPES = {
  IMAGE_GEN: 'imageGen',
  IMAGE_EXT_GEN: 'imageExtGen',
  TEXT: 'textInput',
  VIDEO_GEN: 'videoGen',
  AUDIO_GEN: 'audioGen',
  MULTI_IMAGE_GEN: 'multiImageGen',
} as const;
```

优先在图片节点相关模块（配置面板、store、API 层）替换硬编码字符串，不强制全项目一次性改造。

## 五、默认值

### 5.1 两套独立默认常量

```ts
const IMAGE_GEN_DEFAULTS = {
  model: 'sdxl',
  ratio: '16:9',
  resolution: '2K',
  quality: 'standard',
  style: '写实',
};

const IMAGE_EXT_DEFAULTS: ImageExtConfig = {
  model: '<扩展图片默认模型>',
  ratio: '16:9',
  resolution: '2K',
  quality: 'standard',
  generateCount: 1,
};
```

- 两套默认常量完全独立声明，修改一方不影响另一方
- `canvasStore.addNode('imageExt', ...)` 时注入完整 `IMAGE_EXT_DEFAULTS` 到 `extConfig`
- `nodeStore` 按 nodeType 选择对应的默认值模板

## 六、边界规则

### 6.1 节点操作配置继承

| 操作 | extConfig 行为 |
|------|---------------|
| 同类型复制 | 完整继承，所有字段保留 |
| 同类型分割 | 子节点完整继承父节点 extConfig |
| 跨类型粘贴 | 不迁移 extConfig，目标节点使用自身默认值 |

### 6.2 跨类型转换

- 本期不提供「普通图片节点 → 扩展图片节点」的主动转换能力
- 跨类型粘贴仅保留通用字段（图片实体、编辑状态、参考图 allImages），生成配置重置为目标类型默认值

### 6.3 状态复用

- 生成状态 `status`（loading/done/error）继续复用根级字段
- 图片加载状态、错误提示等通用状态继续复用

### 6.4 工具栏完全复用

- 所有图片编辑工具（裁剪、擦除、标注、光照、3D角度、变换、全屏、下载等）与节点类型无关
- `ImageNodeToolbar` 零改动

### 6.5 编辑模式兼容性

- 裁剪、擦除、标注、光照等所有编辑功能在扩展节点上完全可用
- 编辑结果正确保存，不受 extConfig 影响

### 6.6 历史数据兼容

- 旧版本创建的扩展节点若不存在 `extConfig`，`isImageExtNode` 返回 `false`，不渲染扩展面板
- Selector 读取层自动返回默认值兜底（不修改 store 原数据）
- 当用户首次在扩展面板中修改任意配置时，`updateExtConfig` 自动初始化完整 extConfig
- 不报错、不丢失原有数据

## 七、不改动范围

- `ImageGenNode` 主体渲染（图片显示、上传、toolbar、editMode）
- `ImageNodeToolbar` 全部功能
- 所有编辑模式组件（CropOverlay、EraseCanvas、OutpaintSelectionOverlay、AnnotationCanvas）
- 现有 imageGen 节点的任何行为
- `ImageExtNode.tsx` — 保持 thin wrapper 架构
- 节点创建/删除的核心流程

## 八、成功标准

1. imageGen 节点底部面板行为与改动前完全一致
2. imageExtGen 节点底部面板使用独立模型列表
3. 同时打开两个节点的配置面板，修改扩展节点的模型/比例，imageGen 节点的对应配置无任何变化
4. imageExtGen 积分消耗基于自身模型独立计算
5. imageExtGen 运行按钮组装 `extConfig` + `aiTool` + `nodeType` 完整参数提交
6. 同类型复制、分割后 extConfig 所有字段完整继承，无缺失、无重置
7. 跨类型粘贴使用目标类型默认值
8. 扩展节点生成请求参数结构正确，包含 extConfig 全量配置、aiTool、nodeType
9. 所有编辑模式在扩展节点上完全可用
10. 历史数据（无 extConfig 的旧扩展节点）`isImageExtNode` 返回 false，不渲染扩展面板，不报错
11. `updateConfig` 传入 extConfig 字段时代码层强制过滤并 warn，不影响现有逻辑
12. 两个参数组装函数均包含 `allImages` 字段，生成请求不丢失参考图数据
13. 所有现有测试不退化

## 九、核心单测覆盖（至少 3 个）

1. **`updateExtConfig` 浅合并**：仅更新传入字段，保留其他 extConfig 配置
2. **`isImageExtNode` 边界**：无 extConfig 的扩展节点返回 false
3. **跨类型粘贴**：粘贴后目标节点生成配置为自身默认值，不携带源节点配置

## 十、优化建议（非强制）

### 10.1 PromptEditor 公共组件

提示词编辑器抽离为纯展示组件，通过 props 传入 `value` 与 `onChange`。两种节点的提示词交互、样式、功能 100% 一致。

### 10.2 对称的 isImageGenNode 类型守卫

```ts
export function isImageGenNode(node: unknown): node is AppNode & {
  type: 'imageGen';
  data: ImageNodeData;
} {
  if (!isImageNode(node)) return false;
  return node.type === 'imageGen';
}
```

与 `isImageExtNode` 形成对称体系，两种配置面板的判断逻辑统一。

### 10.3 ImageConfigPanelResolver 增加 memo 优化

```ts
export const ImageConfigPanelResolver = memo(
  function ImageConfigPanelResolver({ nodeId }: { nodeId: string }) {
    const nodeType = useNodeStore(s => s.nodes[nodeId]?.type);
    if (nodeType === NODE_TYPES.IMAGE_EXT_GEN) return <ImageExtConfigPanel nodeId={nodeId} />;
    if (nodeType === NODE_TYPES.IMAGE_GEN) return <ImageConfigPanel nodeId={nodeId} />;
    return null;
  }
);
```

仅在 `nodeType` 变化时重新判断，避免图片状态、编辑模式等不相关属性变化导致不必要重渲染。

### 10.4 积分查询逻辑收敛到 API 模块

```ts
// api/imageExtNodeApi.ts
export async function getCreditCost(modelId: string): Promise<number> {
  const res = await fetch(`/api/pricing/calculate?modelId=${modelId}&nodeType=imageExtGen`);
  const json = await res.json();
  return json.code === 0 ? json.data : 0;
}
```

配置面板仅调用封装好的方法，不直接感知接口路径与参数。
