# Spec: 打组功能视觉与交互优化

日期：2026-08-23
状态：已确认（设计对话逐项澄清 + mockup 亲选视觉参数）

## 背景

打组功能存在 1 个残留 Bug 与 4 项视觉/交互问题：

| # | 问题 | 现状根源 |
|---|------|---------|
| 1 | 多选时**首个**被选中节点仍弹出单节点工具条（TD-G3 修复残留） | `isSingleSelected` 渲染期命令式 `getNodes()` 计数，加选后先选节点 `selected` prop true→true 不重渲染，工具条残留 |
| 2 | 多选工具条固定画布顶部居中 | `MultiSelectToolbar` 用 `absolute top-4 left-1/2` |
| 3 | 多选框为 RF 内置蓝色实线 rect，无内边距 | `.react-flow__nodesselection-rect` 默认样式 |
| 4 | 组工具条固定画布顶部居中 | `GroupToolbar` 用 `absolute top-4 left-1/2` |
| 5 | 组块边框 1px 实线、无四角手柄、标题为容器外浮文字不可编辑 | `NormalGroupRenderer` |

## 视觉参数（mockup 亲选，最终基准）

| Token | 值 |
|-------|-----|
| 多选框边框 | `2px dashed rgba(255,255,255,0.65)` |
| 多选框填充 | `rgba(0,0,0,0.35)` |
| 多选框圆角 / 内边距 | 8px / 16px |
| 多选框徽标 | 胶囊「N 项」，`#3f3f3f` 底白字，框左上角悬浮（不撑大包围盒） |
| 组块展开态容器 | `bg rgba(26,26,26,0.6)`，**单层** `2px dashed`，圆角 10px |
| 组块常态 / 选中虚线色 | `rgba(255,255,255,0.45)` / `rgba(255,255,255,0.85)` |
| 组块标题 | 容器内左上（top 8 / left 12）实底浮层：`data.name ?? '分组'` + 徽标「N 项」 |
| 四角手柄 | 8px 白方块（`#fff` + 1px `#666` 边框），仅选中时显示 |
| 工具条偏移 | 框/组 bounds 上方居中，间距 12px；工具条高 40 |

## 修复设计

### Fix 1：Bug A 残留（isSingleSelected 响应式化）

- 新 hook `useIsSingleSelected(selected: boolean): boolean`（与节点组件同目录共用位置）：内部 `useStore` selector **for 循环计数**（无中间数组分配，拖拽每帧触发场景下避免 GC 压力），返回 `selected && count === 1`。selector 返回 number，天然相等比较。
- 5 个节点组件的命令式计算行替换为该 hook：`ImageGenNode.tsx:77`、`MultiImageNode.tsx:78`、`TextInputNode.tsx:30`、`AudioGenNode.tsx:21`、`VideoGenNode.tsx:61`。
- 测试关键：**时序测试**——渲染节点 A（单选，工具条显示）→ act 内 store 加选节点 B → A 工具条消失（现有测试渲染时 count 已是终态，覆盖不到此路径）。

### Fix 2：多选容器框 SelectionBoxOverlay + 工具条重定位

新组件 `groups/SelectionBoxOverlay.tsx`，在 CanvasView 中替代现 `MultiSelectToolbar` 渲染位（其 JSX 内容——"已选 N 个节点"文字 + 打组下拉，**内容不动**——并入 overlay；原 `MultiSelectToolbar.tsx` 移除，`MultiSelectToolbar.test.tsx` 若有则用例迁移）。

- **数据**：`useStore` 订阅 `nodeLookup` 取选中节点 internalNode 引用（浅比较）→ RF 内置 `getNodesBounds(internalNodes)` 得流坐标 bounds（internalNode 走 `positionAbsolute`，组内子节点不错位；项目未配置 nodeOrigin，默认 [0,0] 无需传参——已验证）。
- **坐标**：`useViewport()` 变换屏幕坐标（同 `ImageNodeToolbar.tsx:323-324` 现有模式）。**padding 是屏幕像素常量，在流→屏幕变换后外加，不乘 zoom**（否则 zoom 0.5 时 16px 缩成 8px）：
  - `left = b.x·zoom + vpX − 16`，`top = b.y·zoom + vpY − 16`
  - `width = b.w·zoom + 32`，`height = b.h·zoom + 32`
  - 边框 2px / 圆角 8px 为 CSS 属性天然屏幕坐标，无需处理
- **框**：token 样式，本体 `pointerEvents: none`（拖拽走 RF 内置 nodesselection 层）；左上角胶囊徽标「N 项」。
- **工具条**：框上方居中偏移 12px；**顶部边界保护**：`isAbove = screenY − 12 − TOOLBAR_HEIGHT(40) > 0`，不满足则翻转到框下方（`translateY(0)`）。高 40 为两工具条现有固定单行常量（入 token），不做 ref 测量。
- **显示条件**：选中 ≥ 2（沿用）。
- **CSS**：全局隐藏 `.react-flow__nodesselection-rect` 视觉（`fill/stroke: transparent`，保留拖拽交互层）；与拖拽框选矩形 `.react-flow__selection` 类名不同，互不影响。**必须放全局样式文件**（index/global css），不可放 CSS module（RF 全局类名会被 module hash 失配）。
- **挂载**：portal 到现有 `node-toolbar-portal`（CanvasView.tsx:506）。

### Fix 3：组块重做（NormalGroupRenderer + GroupNode + canvasStore）

**渲染层**（NormalGroupRenderer）：
- 展开态：token 容器样式（单层虚线深色）；标题行实底浮层（`data.name ?? '分组'` + 徽标）；徽标计数响应式订阅（**for 循环计数** parentId===id，与 Fix 1 风格一致），增删子节点实时更新，不触碰用户改过的名字。
- 标题浮层 `pointerEvents: auto`（双击入口 + 单击可拖组）；与子节点的遮挡由 `GROUP_TOP_PADDING = 44` 布局预留解决（不采用编辑态切换 none——`pointer-events: none` 元素不是鼠标事件目标，会杀死双击）。
- **双击编辑**：双击标题 → input（`nodrag nopan` 类防拖拽）→ Enter/失焦提交、Esc 取消 → `canvasStore.renameGroup(groupId, name)`。提交 guard：
  - 空值回退：`value.trim() || '分组'`（空输入视为重置默认名，不持久化空名）
  - 双触发 guard：`committedRef` 防 Enter 触发 blur 后重复提交
  - IME：keydown 检查 `e.nativeEvent.isComposing`（中文输入法 Enter 选词不提交）
- 折叠态：小卡片同步虚线深色风格。

**NodeResizer**（GroupNode.tsx 普通组分支，仅 selected 渲染）：
- `minWidth 200 / minHeight 120`；CSS 隐藏边把手只留四角手柄（token 样式）：`.react-flow__resize-control:where(.line) { display: none; }`（全局样式文件，低特异性便于覆盖）。
- 仅改容器尺寸，子节点不动（`extent: 'parent'` 保证不出界）。
- **实时性**：依赖 RF v12 ResizeControl 默认拖拽实时 dimensions change 链路（不手动 onResize setNodes——避免绕过 changes 链路双写）。**已验证**：canvasStore.onNodesChange（canvasStore.ts:468）走标准 `applyNodeChanges` 且已有 dimensions → nodeStore 同步（472-479），dimensions type 不会被丢弃。仍保留实现首日浏览器验证拖拽实时跟随，异常才启用 onResize 后备。
- onResizeEnd → `data.manuallyResized = true`。

**store 层**（canvasStore）：
- 新增 `renameGroup(groupId, name)`：更新 `node.data.name`；**入组历史**（`captureBefore/After` + `record` 照抄 convertGroup 模式，label「重命名组」）——项目为独立组历史栈（快照式双写两 store），无 RF 通用 undo，改名入栈才可 Ctrl+Z。
- `toggleCollapse`：折叠时保存 `data.savedSize = { width, height }`；展开时 `manuallyResized` → 恢复 savedSize，否则 `refitGroupBounds`（现状）。
- `convertGroup`：refit 前清 `manuallyResized`（结构转换重置布局预期）。
- DB 加载路径（page.tsx P0-4）：加载后对展开普通组统一 refitGroupBounds 会覆盖手动尺寸——该循环需跳过 `manuallyResized` 组（计划调研发现，spec 补充）。localStorage 恢复路径同理（快照 AppNode 不含组宽高，展开组按子节点重算；手动尺寸组恢复 savedSize）。
- `calcGroupBounds`（utils/groupLayout.ts）：`GROUP_PADDING = 20` 拆出 `GROUP_TOP_PADDING = 44`（20 + 标题行高），新组顶部天然留标题空间。注意：子节点按相对坐标独立渲染，容器 CSS padding 推不开子节点，必须改 bounds 计算。旧组（恢复后不重算）由标题实底浮层保证可读，可接受的边缘重叠。
- 增删子节点（addToGroup/dropIntoGroup）不调用 refitGroupBounds（已核实仅 2 处调用），与手动 resize 无冲突，不需处理。

### Fix 4：GroupToolbar 重定位（普通组 + 分镜组统一）

组件内部改造（已有 `groupId` prop）：`useInternalNode(groupId)` + `useViewport()` + portal 到 `node-toolbar-portal`，bounds 上方居中偏移 12px + 顶部翻转保护（同 Fix 2；**偏移 12px 为屏幕常量，变换后外加不乘 zoom**）。移除 `top-4 left-1/2` class。按钮内容不动。折叠/展开引起的 bounds 变化由 internalNode 订阅天然覆盖。

**与 SelectionBoxOverlay 互斥**：选中 ≥2 节点（含组节点）时两个工具条会叠——GroupToolbar 显示条件增加「**单独选中该组**」（选中计数 === 1，与 Fix 1 同模式），多选时隐藏。改 CanvasView 选中组判定处（310 行附近），组件两处用法（446/488）其余不动。

### Fix 5：共享视觉 token

新 `groups/selectionTokens.ts`：`SELECTION_BOX`、`GROUP_BOX`（常态/选中）、`BADGE`、`HANDLE`、`TOOLBAR`（高 40 / 偏移 12）。SelectionBoxOverlay 与 NormalGroupRenderer（含折叠态）引用。多选框（viewport 外 overlay、屏幕坐标、纯视觉）与组块（RF 节点内、流坐标、可交互）坐标系与职责不同，**不做组件级抽象**（避免 `if (isGroup)` 耦合），仅共享样式 token。

## 实施顺序（依赖关系）

1. **Fix 1**（hook，独立）
2. **Fix 5**（token，被 2/3 依赖）
3. **Fix 2**（SelectionBoxOverlay）
4. **Fix 4**（GroupToolbar + 互斥条件）
5. **Fix 3a 序列化链路验证/补字段**（先确认组节点 data 在 DB payload 与 localStorage 快照的序列化无白名单缺新字段——若有 picklist 显式加入 name/savedSize/manuallyResized；UI 之前完成，避免做完渲染层才发现字段不持久化）
6. **Fix 3b**（组块渲染层 + store 改动 renameGroup/manuallyResized/savedSize/GROUP_TOP_PADDING，最后端到端）

## 测试要求（TDD，先红后绿）

- **Fix 1**：`useIsSingleSelected.test.ts(x)` 时序用例（单选显示 → 加选消失 → 减选回单选恢复）；5 组件既有测试回归。
- **Fix 2**：多节点 bounds + padding + viewport 变换坐标断言；选中 <2 不渲染；框 pointerEvents none / 工具条 auto；顶部翻转分支。
- **Fix 3**：NormalGroupRenderer（默认名/自定义名/徽标计数/双击三态：提交-失焦-Esc/空值回退/IME 不提交/常态与选中样式 token）；`renameGroup` store 测试（data 更新 + 历史记录）；`toggleCollapse` savedSize 往返（manuallyResized 保持 / 无标记 refit）；`convertGroup` 清标记；`calcGroupBounds` 顶部 44 断言；NodeResizer 拖拽实时性（dimensions change 链路，首日浏览器验证）。
- **Fix 4**：mock `useInternalNode`/`useViewport` 断言 left/top 计算 + 顶部翻转 + 多选互斥（选中计数 ≥2 时隐藏）。

## 验证标准（浏览器端到端）

1. **框选路径**：框选 2+ 图片节点 → 无任何单节点工具条残留、虚线框 + 徽标「N 项」+ 框上方工具条出现。
2. **Shift 加选路径**：先单击选中 1 节点（单节点工具条显示）→ Shift 加选第 2 个 → 单节点工具条消失、多选框出现（Bug A 残留验证）。
3. 拖动选中集合 / 缩放 / 平移：框与工具条实时跟随。
4. 选区贴画布顶部：工具条翻转到框下方不被裁切。
5. 组块：虚线深色样式、双击改名（Enter/Esc/失焦/空值回退/IME 选词不提交）、徽标随增删子节点实时更新、选中显示四角手柄、**拖拽过程容器实时跟随**（非松手跳变）、拖角仅改容器尺寸且子节点不出界。
5a. **工具条互斥**：选中组 + 其他节点（≥2）时组工具条隐藏、多选框 + 多选工具条正常；单独选中组时组工具条正常、无多选框。
6. 手动 resize 后折叠再展开：恢复用户尺寸；convertGroup 后重算（标记清除）。
7. 普通/分镜组工具条均在组块上方居中；折叠/展开后跟随；贴顶翻转。
8. 刷新：组名、组尺寸、manuallyResized 状态持久化正常。**实现时验证点**：组节点 data（name/savedSize/manuallyResized）在 DB payload 与 localStorage 快照两条恢复路径均完整（T8 组状态派生之后组 data 已有链路，需实测确认新字段随行）。
9. Ctrl+Z：重命名可撤销。

## 不改动（范围外，注明）

- 单节点工具条（ImageNodeToolbar 等）定位与靠顶裁切问题——不动。
- 分镜组（StoryboardGroupRenderer）渲染内容——不动（仅工具条定位随共用组件变化）。
- 多选工具条按钮内容（"已选 N 个节点"文字与框徽标并存）——不动。
- RF 拖拽框选矩形（`.react-flow__selection`）视觉——不动。
