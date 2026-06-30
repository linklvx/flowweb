# Plan: 扩展图片节点底部面板独立化 — 实现计划

> 日期: 2026-06-30
> 关联 Spec: `docs/superpowers/specs/image-ext-panel-isolation.md`

## 概览

将 imageExtGen 节点的底部配置面板从 imageGen 共享面板中完全独立出来，实现数据、API、UI 三层隔离。

---

## Phase 1: 数据层改造（nodeStore + canvasStore）

### 1.1 新增类型定义

**文件:** `apps/web/src/stores/nodeStore.ts`

- [ ] 新增 `NODE_TYPES` 常量
- [ ] 新增 `ImageExtConfig` 接口
- [ ] `ImageNodeData` 中 `allImages` 明确为根级字段（类型 `ImageItem[]`，默认 `[]`）
- [ ] `prompt` 对象仅保留 `text`、`html`，不再嵌套 `allImages`
- [ ] 扩展 `ImageNodeData` 增加 `extConfig?: ImageExtConfig` 字段
- [ ] `PromptValue` 保持不变（已含 text/html）
- [ ] 新增 `isImageGenNode` 类型守卫（对称 isImageExtNode）
- [ ] 强化 `isImageExtNode` — 追加运行时 `node.data?.extConfig` 存在性校验

### 1.2 新增 updateExtConfig action

**文件:** `apps/web/src/stores/nodeStore.ts`

- [ ] 新增 `updateExtConfig(nodeId, partial: Partial<ImageExtConfig>)`
  - 非扩展节点调用无操作（isImageExtNode 已含运行时校验）
  - 内部对 extConfig 做浅合并，仅更新传入字段

### 1.3 updateConfig 强制过滤 extConfig

**文件:** `apps/web/src/stores/nodeStore.ts`

- [ ] `updateConfig` 实现中：合并前 `delete partial.extConfig` + warn，杜绝误覆盖

### 1.4 默认值常量化

**文件:** `apps/web/src/stores/nodeStore.ts`（或新建 `defaults.ts`）

- [ ] 声明 `IMAGE_GEN_DEFAULTS` 和 `IMAGE_EXT_DEFAULTS`
- [ ] `mergeNodeData` 按 nodeType 选择对应默认值模板
- [ ] `mergeNodeData` 确保 `allImages` 默认初始化为 `[]`

### 1.5 canvasStore.addNode 注入扩展默认值

**文件:** `apps/web/src/stores/canvasStore.ts`

- [ ] `addNode('imageExt', ...)` 注入完整 `IMAGE_EXT_DEFAULTS` 到 `extConfig`
- [ ] `copyNode` 保持 extConfig 完整继承
- [ ] `addChildNode` / `addChildNodes` 继承父节点 extConfig

### 1.6 测试（TDD: RED → GREEN）

**文件:** `apps/web/src/stores/nodeStore.test.ts`（追加）

- [ ] `updateExtConfig` 仅更新传入字段，保留其他 extConfig 配置
- [ ] `updateExtConfig` 对非扩展节点无操作
- [ ] `updateConfig` 传入 extConfig 时被静默过滤（不影响其他字段）
- [ ] `isImageExtNode` 对无 extConfig 的扩展节点返回 false
- [ ] `isImageGenNode` 对 imageGen 节点返回 true，对 imageExtGen 返回 false

**文件:** `apps/web/src/stores/canvasStore.test.ts`（追加）

- [ ] `addNode('imageExt')` 创建的节点包含完整 extConfig 默认值
- [ ] `copyNode` 对扩展节点完整保留 extConfig
- [ ] 跨类型粘贴（imageExt → imageGen）目标使用 imageGen 默认值

---

## Phase 2: API 层

### 2.1 改造 enqueueWorkflow 为对象传参

**文件:** `apps/web/src/api/executionApi.ts`

- [ ] `enqueueWorkflow` 改为对象传参，与参数组装函数返回结构对齐
- [ ] 签名：`enqueueWorkflow(params: EnqueueParams)`

### 2.2 新建 imageNodeApi.ts

**文件:** `apps/web/src/api/imageNodeApi.ts`（新建）

- [ ] `fetchModels()` → `GET /api/node-types/image/models`
- [ ] `getCreditCost(modelId)` → `GET /api/pricing/calculate?modelId=X`
- [ ] `buildImageGenParams(nodeId)` — 从根级字段组装，含 `nodeType`、`allImages`
- [ ] `submitGeneration(nodeId)` — 封装：调用 `buildImageGenParams` + `enqueueWorkflow`

### 2.3 新建 imageExtNodeApi.ts

**文件:** `apps/web/src/api/imageExtNodeApi.ts`（新建）

- [ ] `fetchModels()` → `GET /api/node-types/image-ext/models`
- [ ] `getCreditCost(modelId)` → `GET /api/pricing/calculate?modelId=X&nodeType=imageExtGen`
- [ ] `buildImageExtGenParams(nodeId)` — 从 extConfig + aiTool 组装，含 `nodeType`、`allImages`，复用 `getExtConfig` 兜底
- [ ] `submitGeneration(nodeId)` — 封装：调用 `buildImageExtGenParams` + `enqueueWorkflow`

**参数组装函数关键约束：**
- 两个函数均通过 `useNodeStore.getState()` 读取数据，保持纯函数特性，不依赖 React 上下文
- 参考图均从根级 `allImages` 读取，不使用 `prompt.allImages`
- 面板层不直接调用底层 `enqueueWorkflow`，统一通过 API 模块的 `submitGeneration`

### 2.4 测试（TDD: RED → GREEN）

**文件:** `apps/web/src/api/imageNodeApi.test.ts`（新建）

- [ ] `buildImageGenParams` 输出包含 nodeType='imageGen' 和根级 allImages
- [ ] `submitGeneration` 调用 enqueueWorkflow 并传入正确参数

**文件:** `apps/web/src/api/imageExtNodeApi.test.ts`（新建）

- [ ] `buildImageExtGenParams` 输出包含 nodeType='imageExtGen'、allImages、aiTool
- [ ] `buildImageExtGenParams` 对无 extConfig 的节点使用默认值兜底
- [ ] `submitGeneration` 调用 enqueueWorkflow 并传入正确参数

---

## Phase 3: 公共 UI 组件抽离

### 3.1 新建公共组件目录

**目录:** `apps/web/src/pages/canvas/components/nodes/config-panel/`（新建）

- [ ] `ModelSelector.tsx` — 模型下拉选择器（纯展示）
- [ ] `RatioResolutionPopover.tsx` — 比例分辨率弹窗（纯展示）
- [ ] `GenerateCountSelector.tsx` — 生成数量选择器（纯展示）
- [ ] `CreditDisplay.tsx` — 积分消耗展示条（纯展示）
- [ ] `RunButton.tsx` — 运行按钮（纯展示）
- [ ] `PromptEditor.tsx` — 提示词编辑器（纯展示）

这些组件严格保持纯 UI：不调 store、不发请求，全部通过 props 传入数据和回调。

### 3.2 组件接口定义

```
ModelSelector         props: { models, selectedId, onSelect, disabled }
RatioResolutionPopover props: { ratioOptions, ratio, resolution, onRatioChange, onResolutionChange }
GenerateCountSelector  props: { count, options, onChange, disabled }
CreditDisplay         props: { cost }
RunButton             props: { loading, onClick, disabled }
PromptEditor          props: { value, onChange, onPasteImage, onGenerate, disabled, maxHeight, allImages }
```

### 3.3 测试（TDD: RED → GREEN）

**文件:** `apps/web/src/pages/canvas/components/nodes/config-panel/ModelSelector.test.tsx`（新建）

- [ ] 渲染模型列表
- [ ] 选中项高亮
- [ ] 点击触发 onSelect
- [ ] disabled 状态

**文件:** `apps/web/src/pages/canvas/components/nodes/config-panel/PromptEditor.test.tsx`（新建）

- [ ] 渲染提示词输入区域
- [ ] onChange 触发
- [ ] onGenerate 触发

---

## Phase 4: 配置面板重构

### 4.1 新建 useImageExtConfig Hook

**文件:** `apps/web/src/pages/canvas/components/nodes/hooks/useImageExtConfig.ts`（新建）

- [ ] 精确订阅 `extConfig` 字段（通过 store selector 避免不必要重渲染）
- [ ] 封装 `updateExtConfig` 调用
- [ ] 内置默认值兜底（`extConfig ?? IMAGE_EXT_DEFAULTS`）

### 4.2 新建 ImageConfigPanelResolver

**文件:** `apps/web/src/pages/canvas/components/nodes/ImageConfigPanelResolver.tsx`（新建）

- [ ] 入参 `{ nodeId }`
- [ ] 内部通过 store selector 获取 nodeType
- [ ] `isImageExtNode(node)` → `<ImageExtConfigPanel>`
- [ ] `isImageGenNode(node)` → `<ImageConfigPanel>`
- [ ] 否则 → `null`
- [ ] `React.memo` 包裹，仅在 nodeType 变化时重渲染

### 4.3 新建 ImageExtConfigPanel

**文件:** `apps/web/src/pages/canvas/components/nodes/ImageExtConfigPanel.tsx`（新建）

- [ ] 模型选择器 → 调用 `imageExtNodeApi.fetchModels()`，渲染 `<ModelSelector>`
- [ ] 比例分辨率选择器 → 渲染 `<RatioResolutionPopover>`
- [ ] 生成数量选择器 → 渲染 `<GenerateCountSelector>`
- [ ] 积分展示 → 调用 `imageExtNodeApi.getCreditCost()`，渲染 `<CreditDisplay>`
- [ ] 提示词输入 → 渲染 `<PromptEditor>`
- [ ] AI 工具选择器（内置逻辑，使用公共弹窗样式）
- [ ] 运行按钮 → 调用 `imageExtNodeApi.submitGeneration()`，渲染 `<RunButton>`
- [ ] 使用 `useImageExtConfig` hook 读写 extConfig
- [ ] 所有 UI 组件为公共纯展示组件

### 4.4 修改 ImageConfigPanel

**文件:** `apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.tsx`

- [ ] 移除 `isExtNode` 条件判断
- [ ] 移除 AI 工具选择器渲染（移入 ImageExtConfigPanel）
- [ ] 移除 `extConfig` 相关读取
- [ ] 所有 `prompt.allImages` 引用改为根级 `allImages`
- [ ] UI 组件替换为公共组件：`<ModelSelector>`、`<RatioResolutionPopover>`、`<CreditDisplay>`、`<RunButton>`、`<PromptEditor>`
- [ ] 模型/积分查询改用 `imageNodeApi` 模块方法
- [ ] 生成提交改用 `imageNodeApi.submitGeneration()`
- [ ] 仅保留 imageGen 专属业务逻辑（数据获取、状态更新）
- [ ] 整体布局、容器样式保持不变

### 4.5 修改 ImageGenNode

**文件:** `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx`

- [ ] 底部面板渲染行改为 `<ImageConfigPanelResolver nodeId={id} />`
- [ ] 原有条件判断（`!fileId && !referenceImage` 等）保持不变

### 4.6 测试（TDD: RED → GREEN）

**文件:** `apps/web/src/pages/canvas/components/nodes/ImageConfigPanelResolver.test.tsx`（新建）

- [ ] imageGen 节点路由到 ImageConfigPanel
- [ ] imageExtGen 节点路由到 ImageExtConfigPanel
- [ ] 未知类型返回 null
- [ ] nodeType 变化时正确切换面板

**文件:** `apps/web/src/pages/canvas/components/nodes/hooks/useImageExtConfig.test.ts`（新建）

- [ ] 返回 extConfig 数据
- [ ] updateExtConfig 触发 store 更新
- [ ] extConfig 缺失时返回默认值

**文件:** `apps/web/src/pages/canvas/components/nodes/ImageExtConfigPanel.test.tsx`（新建）

- [ ] 扩展面板渲染模型选择器
- [ ] 扩展面板渲染比例分辨率选择器
- [ ] 扩展面板渲染生成数量选择器
- [ ] 扩展面板渲染 AI 工具选择器
- [ ] 扩展面板渲染积分展示和运行按钮
- [ ] 修改扩展节点模型不影响 imageGen 节点配置
- [ ] 运行按钮调用 submitGeneration

**文件:** `apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx`（更新）

- [ ] 移除 AI 工具相关测试用例
- [ ] 确认不渲染 AI 工具选择器（imageGen 节点）
- [ ] 现有测试保持通过（除移除的 AI 工具测试）

---

## Phase 5: 集成验证

### 5.1 端到端验证

- [ ] 同时选中两个节点，各自配置面板独立
- [ ] 扩展节点同类型复制后 extConfig 完整保留
- [ ] 扩展节点分割后子节点 extConfig 完整继承
- [ ] 跨类型粘贴：imageExtGen → imageGen 使用默认值
- [ ] 历史数据（无 extConfig 旧扩展节点）不报错
- [ ] 现有 imageGen 节点所有功能无退化
- [ ] `npm run test` 全部通过
- [ ] `npm run typecheck` 无错误

### 5.2 回归测试检查清单

- [ ] ImageConfigPanel 现有测试全部通过（移除 AI 工具相关后）
- [ ] canvasStore 现有测试全部通过
- [ ] nodeStore 现有测试全部通过
- [ ] ImageGenNode 现有测试全部通过

---

## 文件改动总览

| 文件 | 操作 | Phase |
|------|------|-------|
| `stores/nodeStore.ts` | 修改 | 1 |
| `stores/canvasStore.ts` | 修改 | 1 |
| `stores/nodeStore.test.ts` | 追加 | 1 |
| `stores/canvasStore.test.ts` | 追加 | 1 |
| `api/executionApi.ts` | 修改 | 2 |
| `api/imageNodeApi.ts` | **新建** | 2 |
| `api/imageExtNodeApi.ts` | **新建** | 2 |
| `api/imageNodeApi.test.ts` | **新建** | 2 |
| `api/imageExtNodeApi.test.ts` | **新建** | 2 |
| `components/nodes/config-panel/ModelSelector.tsx` | **新建** | 3 |
| `components/nodes/config-panel/RatioResolutionPopover.tsx` | **新建** | 3 |
| `components/nodes/config-panel/GenerateCountSelector.tsx` | **新建** | 3 |
| `components/nodes/config-panel/CreditDisplay.tsx` | **新建** | 3 |
| `components/nodes/config-panel/RunButton.tsx` | **新建** | 3 |
| `components/nodes/config-panel/PromptEditor.tsx` | **新建** | 3 |
| `components/nodes/config-panel/ModelSelector.test.tsx` | **新建** | 3 |
| `components/nodes/config-panel/PromptEditor.test.tsx` | **新建** | 3 |
| `components/nodes/hooks/useImageExtConfig.ts` | **新建** | 4 |
| `components/nodes/hooks/useImageExtConfig.test.ts` | **新建** | 4 |
| `components/nodes/ImageConfigPanelResolver.tsx` | **新建** | 4 |
| `components/nodes/ImageConfigPanelResolver.test.tsx` | **新建** | 4 |
| `components/nodes/ImageExtConfigPanel.tsx` | **新建** | 4 |
| `components/nodes/ImageExtConfigPanel.test.tsx` | **新建** | 4 |
| `components/nodes/ImageConfigPanel.tsx` | 修改 | 4 |
| `components/nodes/ImageGenNode.tsx` | 修改 | 4 |
| `components/nodes/ImageConfigPanel.test.tsx` | 更新 | 4 |

总计：新建 18 个文件，修改 3 个文件，追加 2 个测试，更新 1 个测试

---

## 开发规范

### 提交策略

每个 Phase 按「测试→实现→验证」的 TDD 循环独立 commit，功能单一、可回溯：

```
Phase 1: feat(nodeStore): 新增 extConfig 类型与 updateExtConfig action
Phase 2: feat(api): 新增 imageNodeApi / imageExtNodeApi，改造 enqueueWorkflow 对象传参
Phase 3: feat(components): 抽离公共配置面板 UI 组件（含 PromptEditor）
Phase 4: feat(components): 新增 ImageExtConfigPanel 与 Resolver，重构 ImageConfigPanel
Phase 5: chore: 集成验证与回归测试通过
```

### 参数组装函数纯函数约束

- 统一通过 `useNodeStore.getState()` 读取数据
- 不依赖 React 上下文
- 方便独立单测与后续逻辑复用
