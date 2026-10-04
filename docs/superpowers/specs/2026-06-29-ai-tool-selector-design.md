<!-- doc-status: historical | verified_at: n/a -->
# AI 工具选择器 — 扩展图片节点

## 概述

在 Canvas 扩展图片节点（`imageExtGen`）的底部配置面板中，于"比例分辨率"按钮右侧新增一个"AI 工具"选择按钮。点击按钮向上弹出分类工具菜单，用户选择一个工具后将 `aiTool` 字段写入节点数据。

## 数据模型

### AiToolId 联合类型

```typescript
export type AiToolId =
  // 分镜叙事
  | 'storyboard_scheduling' | 'storyboard' | 'grid_25' | 'four_panel'
  | 'frame_forward_3s' | 'frame_backward_5s'
  // 质感调节
  | 'portrait_texture' | 'film_lighting'
  // 空间与机位
  | 'panorama_720' | 'nine_camera'
  // 设定图
  | 'face_three_view' | 'character_sheet' | 'character_three_view'
  | 'scene_sheet' | 'product_sheet';
```

### AiToolItem / AiToolGroup 类型

```typescript
export interface AiToolItem {
  id: AiToolId;
  name: string;
  desc: string;
  icon: React.FC<{ className?: string }>;
  isNew?: boolean;
}

export interface AiToolGroup {
  groupName: string;
  items: AiToolItem[];
}
```

### ImageNodeData 扩展

```typescript
export interface ImageNodeData {
  // ... 原有字段保持不变
  aiTool?: AiToolId; // 仅 imageExtGen 节点使用，普通 imageGen 恒为 undefined
}
```

### 类型守卫

```typescript
export function isImageExtNode(node: unknown): node is AppNode<'imageExtGen'> & { data: ImageNodeData } {
  if (!isImageNode(node)) return false;
  return node.type === 'imageExtGen';
}
```

## 数据更新与清空规则

### 更新链路

`aiTool` 字段复用现有 `updateConfig(nodeId, { aiTool })` 方法，与 `model`、`ratio`、`quality` 等配置项更新链路完全一致，确保数据同步写入 store 并持久化到后端。

### 清空能力

弹窗顶部增加「不使用 AI 工具」选项，点击后调用 `updateConfig(nodeId, { aiTool: undefined })`，按钮回到「AI 工具」占位态。避免用户选中后无法取消的操作死锁。

### 跨类型规则

- 普通图片节点（`imageGen`）不读取、不校验 `aiTool` 字段
- 扩展节点转换 / 粘贴为普通节点时，字段保留在 data 中但不生效，不强制清理，避免意外丢失数据
- 生成请求中普通节点不传 `aiTool`，扩展节点仅在选中时传

## 工具配置（数据化）

配置文件 `nodes/ai/aiToolConfig.ts`，SVG 图标组件放在 `components/icons/ai/` 目录下：

```typescript
export const AI_TOOL_GROUPS: AiToolGroup[] = [
  {
    groupName: '分镜叙事',
    items: [
      { id: 'storyboard_scheduling', name: '调度故事板', desc: '生成带有运动轨迹等调度草图分镜', icon: StoryboardSchedulingIcon, isNew: true },
      { id: 'storyboard', name: '故事板', desc: '生成完整剧情片段', icon: StoryboardIcon, isNew: true },
      { id: 'grid_25', name: '25宫格连贯分镜', desc: '生成连续分镜长图', icon: Grid25Icon },
      { id: 'four_panel', name: '剧情推演四宫格', desc: '生成四格剧情推演', icon: FourPanelIcon },
      { id: 'frame_forward_3s', name: '画面推演 - 3秒后', desc: '推演画面后续动作', icon: FrameForwardIcon },
      { id: 'frame_backward_5s', name: '画面推演 - 5秒前', desc: '还原画面前置状态', icon: FrameBackwardIcon },
    ],
  },
  {
    groupName: '质感调节',
    items: [
      { id: 'portrait_texture', name: '人像质感调节', desc: '降低 AI 感，优化人物质感与光影', icon: PortraitTextureIcon, isNew: true },
      { id: 'film_lighting', name: '电影级光影校正', desc: '调整画面光影质感', icon: FilmLightingIcon },
    ],
  },
  {
    groupName: '空间与机位',
    items: [
      { id: 'panorama_720', name: '720全景', desc: '生成全景场景图', icon: Panorama720Icon },
      { id: 'nine_camera', name: '多机位九宫格', desc: '生成多视角机位图', icon: NineCameraIcon },
    ],
  },
  {
    groupName: '设定图',
    items: [
      { id: 'face_three_view', name: '角色脸部三视图', desc: '基于一张参考图生成脸部细节三视图', icon: FaceThreeViewIcon },
      { id: 'character_sheet', name: '角色设定图', desc: '角色主视觉与设定拆解', icon: CharacterSheetIcon },
      { id: 'character_three_view', name: '角色三视图', desc: '正侧背视图与脸部特写', icon: CharacterThreeViewIcon },
      { id: 'scene_sheet', name: '场景设定图', desc: '场景设定与氛围参考', icon: SceneSheetIcon },
      { id: 'product_sheet', name: '产品设定图', desc: '产品外观设定与细节拆解', icon: ProductSheetIcon },
    ],
  },
];
```

## 交互规范

| 场景 | 行为 |
|------|------|
| 未选中任何工具 | 按钮显示固定图标 + 占位文字「AI 工具」 |
| 已选中工具 | 按钮显示固定图标 + 选中项名称 |
| 点击菜单项 | `updateConfig(nodeId, { aiTool })` → 关闭弹窗 |
| 点击「不使用 AI 工具」 | `updateConfig(nodeId, { aiTool: undefined })` → 关闭弹窗 |
| 生成中 (`status === 'loading'`) | 按钮整体置灰禁用，禁止修改 |
| 点击弹窗外 / ESC | 关闭弹窗（复用现有 `useEffect` + `mousedown` 模式） |
| 选中项高亮 | 复用比例弹窗选中样式（`border-[#4a4a4a] bg-white/10 text-[#f5f5f5]`） |
| 未选中项 hover | 复用参考代码 hover 样式（`hover:bg-canvas-controls-hover`，描述文字从 `opacity-0` → `opacity-60`） |

### 弹窗互斥

复用配置面板现有弹窗互斥机制：点击 AI 工具按钮自动关闭比例弹窗（`setRatioOpen(false)`），反之亦然。同一时间仅允许一个弹窗打开。

### 视口边界检测

复用比例弹窗的边界检测逻辑：若按钮右侧视口空间不足容纳弹窗宽度，弹窗改为右对齐（`left-0` → `right-0`），避免溢出屏幕被截断。使用 `useViewport()` 或 `window.innerWidth` 配合弹窗宽度进行判断。

## 渲染条件

仅在 `isImageExtNode(node)` 为 true 时渲染 AI 工具按钮。普通 `imageGen` 节点不显示该按钮，`aiTool` 字段恒为 `undefined`。

## 组件结构

```
ImageConfigPanel (修改)
├── [现有] 模型选择器
├── [现有] 比例分辨率按钮 + 弹窗
├── [新增] AI 工具按钮 + 弹出面板（isImageExtNode 条件渲染）
│   └── 弹窗顶部：「不使用 AI 工具」选项
│   └── 弹窗内容：分组标题 + 工具项列表（图标 + 名称 + 描述 hover 显示）
├── [现有] 生成数量 / 积分 / 执行按钮
```

## 弹窗样式

- 定位：`absolute bottom-full mb-2 z-[300]`，默认 `left-0`，空间不足时 `right-0`
- 外观：`rounded-2xl p-2`，`backdrop-blur-2xl`，`bg-panel-background/95`，`border border-border-muted`
- 阴影：复用比例弹窗 `shadow-[0_4px_10px_rgba(0,0,0,0.25),0_2px_4px_rgba(0,0,0,0.3)]`
- 宽度：约 230px，参考代码中弹窗宽度
- 滚动：`max-height: calc(100vh - buttonBottom - 20px)` + `overflow-y-auto` + tiny scrollbar
- 菜单项：h-[52px]，图标 34x34，有 `isNew` 标记的项显示蓝色圆点指示器

## 图标

所有图标为自定义 SVG 组件，统一放在 `components/icons/ai/` 目录下。不依赖第三方图标库（避免版权问题）。每个图标导出为独立的 React 组件。

## 后端透传

### 请求 DTO

后端图片生成接口的请求 DTO 中新增 `aiTool?: string` 可选字段。

### 拓扑与执行链路

全链路透传 `aiTool` 字段。本期若未对接具体 AI 能力，执行层默认忽略该参数，不影响原有生成逻辑。

### 本期定位

**前端完成选型交互与数据落地，后端预留字段与透传能力。** 具体 AI 能力对接放在后续迭代。

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `src/stores/nodeStore.ts` | +`AiToolId` 类型、+`AiToolItem`/`AiToolGroup` 类型、+`aiTool` 字段、+`isImageExtNode()` |
| `src/pages/canvas/components/nodes/ai/aiToolConfig.ts` | 新建，`AI_TOOL_GROUPS` 配置 |
| `src/components/icons/ai/*.tsx` | 新建，15 个自定义 SVG 图标组件 |
| `src/pages/canvas/components/nodes/ImageConfigPanel.tsx` | +AI 工具按钮 + 弹出面板 + 互斥逻辑 + 边界检测 |
| `src/api/executionApi.ts` | 生成请求透传 `aiTool` 参数 |
| `src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx` | 新增 imageExtGen 相关测试用例 |
