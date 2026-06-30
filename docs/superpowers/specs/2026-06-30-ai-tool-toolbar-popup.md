# Spec: 悬浮工具栏 AI 工具扩展 — 弹出面板与派生节点创建

> 日期: 2026-06-30
> 状态: 待确认

## 一、目标

将悬浮工具栏上"九宫格"按钮重命名为"AI工具扩展"，为其接入与扩展图片节点底部面板相同的 AI 工具选择器。按节点类型区分行为：`imageExtGen` 节点选中工具直接更新配置；`imageGen` 节点选中工具则创建派生 `imageExtGen` 节点并连线。

## 二、按钮变更

### 2.1 名称与行为

| 项目 | 变更前 | 变更后 |
|------|--------|--------|
| 文本 | 九宫格 | AI工具扩展 |
| 图标 | `Grid3x3Icon` | 不变 |
| onClick | 无（空壳） | 弹出 AI 工具面板 |
| 渲染条件 | 所有图片节点 | 所有图片节点（`imageGen` + `imageExtGen`） |
| disabled | 无 | `!hasImage` 时禁用（无图片无需操作） |

## 三、AiToolPopup — 共享公共组件（新建）

### 3.1 双模式设计

```
AiToolPopup (新建独立组件)
├── mode: 'config' | 'action'
│
├── config 模式 (给 ImageExtConfigPanel 用)
│   ├── 有 selectedToolId → 显示选中态高亮
│   ├── 顶部「不使用 AI 工具」清除选项
│   ├── 外部点击 / ESC 关闭
│   └── onSelect(toolId | undefined) → 设置 extConfig.aiTool
│
├── action 模式 (给 ImageNodeToolbar 用)
│   ├── 无选中态，所有卡片平权
│   ├── 无清除选项
│   ├── 外部点击 / ESC 关闭
│   └── onSelect(toolId) → 立即执行动作 + 关闭弹窗
│
└── 共用
    ├── 4 组纵向排列 × 3 列网格布局 (复用现有 AI_TOOL_GROUPS)
    ├── 视口边界检测 (弹窗不越界)
    ├── 统一样式 (popup base class + style)
    └── 定位由调用方通过 anchorEl 或固定 position 控制
```

### 3.2 Props

```typescript
interface AiToolPopupProps {
  mode: 'config' | 'action';
  open: boolean;
  onClose: () => void;
  onSelect: (toolId: string) => void;
  selectedToolId?: string;              // config 模式用
  anchorEl?: HTMLElement | null;        // action 模式定位用
}
```

### 3.3 交互规范

| 场景 | 行为 |
|------|------|
| 点击弹窗外部 | 关闭弹窗，不执行操作 |
| 按 ESC | 关闭弹窗，不执行操作 |
| action 模式点击工具卡片 | 立即调用 `onSelect(toolId)` → 弹窗关闭 |
| config 模式点击工具卡片 | 调用 `onSelect(toolId)` → 弹窗关闭 |
| config 模式点击「不使用」 | 调用 `onSelect(undefined)` → 弹窗关闭 |
| 窗口 resize / 滚动 | 检测边界，调整位置避免溢出 |

## 四、ImageNodeToolbar 接入（修改）

### 4.1 按钮替换

将第 569 行的空壳 `TextIconButton` 替换为带弹窗的交互按钮：

```tsx
// 移除:
<TextIconButton icon={<Grid3x3Icon />} ariaLabel="九宫格" text="九宫格" />

// 替换为:
<div ref={aiToolBtnRef} className="relative">
  <TextIconButton
    icon={<Grid3x3Icon />}
    ariaLabel="AI工具扩展"
    text="AI工具扩展"
    disabled={!hasImage}
    onClick={() => setAiToolPopupOpen(v => !v)}
  />
  <AiToolPopup
    mode="action"
    open={aiToolPopupOpen}
    onClose={() => setAiToolPopupOpen(false)}
    onSelect={(toolId) => {
      setAiToolPopupOpen(false);
      handleAiToolAction(toolId);
    }}
    anchorEl={aiToolBtnRef.current}
  />
</div>
```

### 4.2 添加 handleAiToolAction 回调 (从 ImageGenNode 传入)

```typescript
// ImageGenNode.tsx 中新增 handler
const handleAiToolAction = useCallback((toolId: AiToolId) => {
  if (nodeType === 'imageExtGen') {
    // 扩展节点：直接更新 aiTool 配置
    updateConfig(id, { aiTool: toolId });
  } else {
    // 普通节点：创建派生扩展节点
    canvasStore.createDerivedExtNode({
      sourceNodeId: id,
      referenceImage: nodeData.fileId,
      aiTool: toolId,
    });
  }
}, [id, nodeType, nodeData.fileId, updateConfig]);
```

### 4.3 ImageNodeToolbar Props 扩展

新增 `onAiToolAction?: (toolId: AiToolId) => void` prop。

## 五、派生节点创建流程 (canvasStore)

### 5.1 createDerivedExtNode

```typescript
interface CreateDerivedExtNodeParams {
  sourceNodeId: string;
  referenceImage?: string;    // 原节点 fileId，作为新节点参考图
  aiTool: AiToolId;
}

createDerivedExtNode(params: CreateDerivedExtNodeParams): string {
  const source = get().nodes[params.sourceNodeId];
  // 1. 计算新节点位置：源节点右侧，水平对齐
  const newPosition = {
    x: source.position.x + (source.measured?.width ?? 300) + 80,  // NODE_GAP
    y: source.position.y,
  };
  // 2. 创建 imageExtGen 节点
  const newNodeId = addNode({
    type: 'imageExtGen',
    position: newPosition,
    data: {
      allImages: params.referenceImage
        ? [{ fileId: params.referenceImage, url: getFileUrl(params.referenceImage) }]
        : [],
      aiTool: params.aiTool,
      extConfig: { ...IMAGE_EXT_DEFAULTS },
      // 其他字段取默认值
    },
  });
  // 3. 创建连线
  addEdge({ source: params.sourceNodeId, target: newNodeId });
  // 4. 选中新节点 + 滚动到视野中心
  setSelectedNode(newNodeId);
  setTimeout(() => fitView({ nodes: [newNodeId] }), 50);
  return newNodeId;
}
```

### 5.2 位置计算

- 新节点 x = 源节点 position.x + 源节点宽度 + 80px (间距)
- 新节点 y = 源节点 position.y (水平对齐)
- 若源节点无 `measured` 宽度，兜底使用 300px

## 六、ImageExtConfigPanel 重构（修改）

### 6.1 替换内联弹窗

将第 204-290 行的 AI 工具按钮 + 弹窗替换为使用 `AiToolPopup` (config 模式)：

```tsx
// 替换后:
<div className="relative" ref={aiToolBtnRef}>
  <button onClick={() => setAiToolOpen(v => !v)}>...</button>
  <AiToolPopup
    mode="config"
    open={aiToolOpen}
    onClose={() => setAiToolOpen(false)}
    onSelect={(toolId) => {
      updateConfig(nodeId, { aiTool: toolId });
      setAiToolOpen(false);
    }}
    selectedToolId={aiTool}
    anchorEl={aiToolBtnRef.current}
  />
</div>
```

### 6.2 移除内部弹窗逻辑

- 删除 `POPUP_BASE_CLASS`、`POPUP_BASE_STYLE` 常量（移入 `AiToolPopup`）
- 删除内联的列分布算法代码（移入 `AiToolPopup`）
- 删除 `checkPopupBounds` 逻辑（移入 `AiToolPopup`）
- 保留 AI 工具按钮的渲染和状态管理

## 七、不改动范围

- `ImageConfigPanel.tsx`（imageGen 独立配置面板，完全不动）
- `ImageGenNode.tsx` 主体渲染逻辑（仅新增 `handleAiToolAction` 回调传入 toolbar）
- `ImageExtNode.tsx`（thin wrapper，完全不动）
- `aiToolConfig.ts`（AI_TOOL_GROUPS 配置不动）
- `nodeStore.ts` 类型定义（不新增字段，复用现有 AiToolId）
- `imageNodeApi.ts` / `imageExtNodeApi.ts`（API 层不动）
- 所有编辑模式组件（不动）

## 八、文件变更清单

| 文件 | 变更 |
|------|------|
| `components/nodes/AiToolPopup.tsx` | **新建** — 双模式 AI 工具弹出面板公共组件 |
| `components/nodes/ImageNodeToolbar.tsx` | "九宫格" → "AI工具扩展" + 接入 `AiToolPopup` (action 模式) |
| `components/nodes/ImageExtConfigPanel.tsx` | 移除内联弹窗 → 复用 `AiToolPopup` (config 模式) |
| `components/nodes/ImageGenNode.tsx` | 新增 `handleAiToolAction` 回调传入 toolbar |
| `stores/canvasStore.ts` | 新增 `createDerivedExtNode` 方法 |
| `components/nodes/AiToolPopup.test.tsx` | **新建** — AiToolPopup 测试 |
| `stores/canvasStore.test.ts` | 新增 `createDerivedExtNode` 测试 |
| `components/nodes/ImageNodeToolbar.test.tsx` | 更新测试：按钮名称 + 弹窗行为 |
| `components/nodes/ImageExtConfigPanel.test.tsx` | 更新测试：复用 AiToolPopup |

## 九、成功标准

1. 悬浮工具栏上"AI工具扩展"按钮在选中图片节点后可见
2. 点击"AI工具扩展"按钮 → 弹窗在按钮下方居中弹出
3. 弹窗展示 4 组 AI 工具，每组纵向排列、组内 3 列网格
4. imageGen 节点选中工具 → 新 imageExtGen 节点创建在右侧、连线、选中并滚动到视野中心
5. imageExtGen 节点选中工具 → 更新当前节点 `aiTool` 配置
6. 点击弹窗外 / ESC → 弹窗关闭，不执行任何操作
7. ImageExtConfigPanel 的 AI 工具选择器行为与重构前完全一致（config 模式）
8. 无图片时按钮禁用
9. 弹窗不超出视口边界
10. 所有现有测试不退化

## 十、核心测试覆盖

1. **AiToolPopup config 模式**：选中态高亮、"不使用"选项、onSelect 回调
2. **AiToolPopup action 模式**：无选中态、无清除选项、onSelect 回调
3. **ImageNodeToolbar**：按钮名称变更、点击弹窗开关、action 模式 onSelect
4. **canvasStore.createDerivedExtNode**：节点创建位置、edge 创建、选中 + 视野滚动
5. **ImageExtConfigPanel**：重构后行为与之前完全一致
