# Canvas 打组与合并分镜组交互升级 — 设计 spec

- 日期：2026-09-28
- 状态：待用户审阅
- 主题：多选虚线框/工具条改版、组工具条/组颜色/折叠宫格预览卡、组内节点拖出、+号输出按钮与批量连线、分镜组视觉改版

## 1. 背景与目标

画布现有打组/分镜组功能已具备核心能力（打组/解组/转组/折叠/整组执行/比例/宫格/拼接/序号/清空），本次按用户提供的目标产品参考代码做交互与视觉升级，并补齐四个全新能力：**排列、批量下载、组颜色、+号输出批量连线**，同时改造**组内节点拖出**机制。

实现路线（已确认）：**Store 实时驱动 + 自绘连线层**——与现有架构（canvasStore actions + portal overlay + 纯函数布局工具）同构，单一数据源，协作/撤销/渲染天然一致。否决方案：React Flow 原生 expandParent（只扩不缩，不符"动态框住"；需推翻自研体系）；视觉层跟随（两套几何源脱节，违背从根解决原则）。

## 2. 现状事实（探索结论，写实现时的定位锚点）

| 事实 | 位置 |
|---|---|
| 多选虚线框+多选工具条同组件，viewport 外 portal，屏幕像素坐标换算 | `apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.tsx` |
| 选框/工具条样式常量（padding 16、titleExtra 26、TOOLBAR） | `apps/web/src/pages/canvas/components/groups/selectionTokens.ts` |
| 组创建/解组/折叠/转组/合并分镜组等 actions | `apps/web/src/stores/canvasStore.ts`（groupNodes L810、ungroup L843、mergeStoryboard L1100、convertGroup L1177、toggleCollapse L1252） |
| 组几何纯函数（GROUP_PADDING=20、GROUP_PADDING_TOP=50、calcDefaultGrid、clampPositionToPadding） | `apps/web/src/utils/groupLayout.ts` |
| 组节点渲染分发（Normal/Storyboard）+ NodeResizer | `apps/web/src/pages/canvas/components/groups/GroupNode.tsx` → NormalGroupRenderer / StoryboardGroupRenderer |
| 组工具条内容由 CanvasView 注入 GroupToolbar children | `apps/web/src/pages/canvas/components/CanvasView.tsx` L582-656 |
| 子节点当前 `extent:'parent'` + onNodesChange clamp（锁死组内，本次废除） | canvasStore.ts L517-544 |
| 单节点媒体下载模式（getMediaUrl→fetch→blob→a[download]） | ImageGenNode.tsx L129-153、VideoGenNode.tsx L253-273 |
| handle 拖线落空弹添加节点菜单（SOURCE_ITEMS：文本/图片/视频/音频） | `apps/web/src/pages/canvas/components/HandleAddNodeMenu.tsx` |
| canvas-controls-* CSS 变量深浅两套已有定义；Tailwind 未注册（须 inline var） | `apps/web/src/index.css` L35-53/L79-93、tailwind.config.ts |
| `--canvas-group-border`、`--storyboard-group-shell-bg` 不存在，本次新增 | index.css |
| 测试栈 vitest + testing-library，portal 手动挂载模式 | `groups/SelectionBoxOverlay.test.tsx` |

## 3. 需求清单（含澄清结论）

| # | 需求 | 澄清结论 |
|---|---|---|
| 1 | 多选虚线框 padding 16→30px | 屏幕像素，不随 zoom |
| 2 | 多选工具条加排列+下载按钮 | 参考代码即目标：`[排列▾] │ [创建副本] │ [打组▾] [批量下载] │`；排列菜单=宫格/水平/垂直 |
| 3 | 打组后工具条改版 | `[颜色圆点] [排列子节点▾] │ [折叠] [整组执行] [转分镜组] [解组] │ [批量下载]`；组颜色=预设 8 色板，本次实现 |
| 4 | 折叠效果改宫格预览卡 | 固定 220×160；列数 1-2→按数量、3-4→2 列、5+→3 列；前 6 tile；非图片用类型图标占位；不显示组名 |
| 5 | 组内节点可拖出，组框动态跟随 | 完全拖出→脱离组；空组自动删除；未完全拖出→组框实时框住（保持 padding 空隙） |
| 6 | 虚线框/组框右侧 +号输出按钮 | 24px 圆指示器 + 80×80 命中区；组框在选中时显示；分镜组不加 |
| 7 | +号拖拽批量连线 + 点击弹菜单 | 拖动中显示多源→指针的激活临时连线；命中目标批量建边；点击（<5px）弹类型菜单（复用 SOURCE_ITEMS）创建 1 个新节点并批量连线 |
| 8 | 分镜组工具条与主体改版 | 全现有功能重渲染新视觉；宫格文案动态；新增左上标题浮层"分镜组 N 个节点"；新 shell 变量 |

其它澄清：排列=中心锚点不变+固定间距 60px+节点尺寸不变；批量下载=框/组内全部成品文件逐个触发下载（抽公共 util）；创建副本=选中整体复制偏移 {40,0}，含组走 duplicateGroup、选区内互连边一并复制。

## 4. 详细设计

### 4.1 多选虚线框与工具条（需求 1、2）

**padding**：`selectionTokens.ts` `SELECTION_BOX.padding: 16 → 30`。`titleExtra: 26` 不动（流坐标标题溢出补偿，与屏幕 padding 无关）。

**工具条结构**（替换现有"已选 N 个节点 + 打组▾"文本行；数量徽标"N 项"保留在选框左上角不变）：

```
[⊞排列图标] │ [⧉创建副本] │ [▣打组▾] [⬇批量下载] │
```

- 容器：padding 8 / gap 8 / 圆角 12 / 边框 0.5px `var(--canvas-controls-border)` / 背景 `var(--canvas-controls-bg)` / 阴影 rgba(0,0,0,0.08) 0 4px 10px / `backdrop-filter: blur(16px)`；定位：选框上缘中点，`translate(-50%,-100%) translateY(-14px)`（现 offset 12→14）
- 按钮：h-8 / px-2 / 圆角 8 / 13px / 色 `var(--canvas-controls-text)` / hover `var(--canvas-controls-hover)`；下载为 32×32 纯图标钮（aria-label=批量下载，无可下载项时 aria-disabled 置灰）；分隔线：1px 宽、`var(--canvas-controls-border)`
- 打组▾ 下拉保留现有两项（打组 Ctrl+G / 合并分镜组 Ctrl+Alt+G）及禁用条件（含组禁打组、非全图片完成禁合并），样式并入新视觉
- 排列菜单：点排列图标弹同视觉小浮层（min-width 120px），三项宫格排列/水平排列/垂直排列（SVG 用参考代码图标）

**排列纯函数** `arrangeRects(rects: Rect[], mode: 'grid'|'horizontal'|'vertical'): Rect[]`（放 groupLayout.ts）：
- grid：列数复用 `calcDefaultGrid(n)`，行数 ceil；horizontal：1 行 n 列；vertical：n 行 1 列
- 布局间距 `ARRANGE_GAP = 60`（行间/列间统一）；节点各自 width/height 不变
- 输出整体平移使**新布局包围盒中心 = 输入包围盒中心**

**store actions**：
- `arrangeSelection(mode)`：取选中节点（排除组节点）rects → arrangeRects → 批量写 position；选区保持
- `duplicateSelection()`：选中含组节点→组走现有 `duplicateGroup`（含子节点与内部边复制）；非组节点逐一复制（沿用 buildGroupCopy 的节点复制语义），偏移 {40, 0}；选区内互连边一并复制（新端点 id 映射）；完成后新节点集合设为选中
- `downloadSelectionMedia()`：收集选中中图片/视频**有成品 fileId** 的项，顺序 await 现有下载模式逐个触发；无项时 no-op（按钮侧置灰）

**公共下载 util** `mediaDownload.ts`：从 ImageGenNode 抽取 `downloadMediaByUrl(fileId, filename)`（getMediaUrl→fetch→blob→a[download]→revoke，失败 fallback window.open）；ImageGenNode/VideoGenNode 改为引用（精准修改：不动的逻辑不重写）。

### 4.2 组工具条／组颜色／折叠卡（需求 3、4）

**GroupToolbar 新布局**（普通组选中时显示，组框上方居中，bottom: calc(100% + 28px)）：

```
[●颜色圆点] [⊞排列子节点▾] │ [折叠] [▶整组执行] [⧉转分镜组] [⤢解组] │ [⬇批量下载]
```

- 视觉同 4.1 容器规范；按钮 h-9 / 圆角 10（参考代码组工具条规格），色点钮 size-10 内 20px 圆，下载 size-9 图标钮
- 折叠/整组执行/转分镜组/解组：现有行为与禁用条件不变，样式并入
- 批量下载：`downloadGroupMedia(groupId)`，同 4.1 收集逻辑作用于组内子节点

**组颜色**：
- `GroupData` 加 `color?: string`（hex 值；undefined=未设色）
- 预设色板 8 色：默认灰 `#b8b8b8`、红 `#f5222d`、橙 `#fa8c16`、黄 `#fadb14`、绿 `#52c41a`、青 `#13c2c2`、蓝 `#1677ff`、紫 `#722ed1`
- 点色点弹色板浮层（8 圆点网格 + "默认"项清除色）→ `setGroupColor(groupId, color | undefined)`
- 着色范围：组框边框色、组名标题文字/徽标、折叠卡边框；未设色维持现样式（`--fw-text-dim-3`/`--fw-text`）
- 色点钮内圆显示当前色（未设显示默认灰）

**排列子节点菜单**：`arrangeGroupChildren(groupId, mode)`——组内子节点 rects → arrangeRects（中心锚定组内容区中心）→ 写位置 → `refitGroupBounds`；仅普通组提供。

**折叠宫格预览卡**（新组件 CollapsedPreviewCard，替换 NormalGroupRenderer 折叠态渲染）：
- 折叠尺寸 200×64 → 220×160 固定；`toggleCollapse` 的 savedSize/展开恢复逻辑不变
- 结构：上部预览宫格（padding 6、gap 4、圆角 6 tile）+ 底部 summaryRow（参考代码计数图标 + "N 个节点"，13px muted）
- 列数规则：1-2 节点→列数=节点数；3-4→2 列；5+→3 列；tile 最多 6 个（子节点按 `sortNodesByPosition` 序取前 6）
- tile 内容：图片完成节点→`<img>`（getMediaUrl，cover 填充）；其它类型→居中类型图标占位块（跟随深浅主题）
- 组颜色着色折叠卡边框；选中态边框高亮（现选中色或组色）

### 4.3 组内节点拖出（需求 5）

- **废除**：`groupNodes`/`dropIntoGroup`/`addToGroup` 不再设 `extent:'parent'`；`onNodesChange` 中普通组子节点 `clampPositionToPadding` 分支删除
- **新增实时跟随**：`onNodesChange` 处理普通组子节点 position 变更时，同步 `refitParentGroup(groupId)`（组 position/width/height = 子节点包围盒 + GROUP_PADDING/GROUP_PADDING_TOP），拖动过程中组框即时变化、四向 padding 空隙恒定
- **拖出判定**：`onNodeDragStop` 对被拖组子节点调纯函数 `rectCompletelyOutside(nodeRect, groupRect)`（两 rect 无任何交集，含相切判定=相切视为未完全超出）：
  - true → `removeFromGroup(nodeId)`：清 parentId、坐标转全局（+组 position）、组 refit；组剩 0 子节点→自动删除组节点（含其边清理）；部分相交→留在组内（组框已动态框住）
- 拖入组（findDropGroup/dropIntoGroup/dropImageIntoStoryboard）现有逻辑不变；分镜组子节点坐标恒 {0,0}，不参与此机制
- 协作注意：拖动中组节点几何变更经现有 awareness/同步机制广播，开发期可接受

### 4.4 +号输出按钮与批量连线（需求 6、7）

**AddOutputHandle 组件**（新）：
- 定位宿主框右缘垂直中点；80×80 隐形命中区（右缘外扩 40px 居中，`translateY(-50%)`），`cursor:crosshair`、nodrag/nopan、z 高于工具条
- 内含 24px 圆形指示器：14px 加号 SVG（两条 1.6px 圆帽线），背景 `var(--canvas-controls-bg)`、色 `var(--canvas-controls-text)`、边框 `var(--canvas-controls-border)`、阴影；默认紧贴框缘（指示器右移出命中区左缘 23px 处），拖拽时跟随指针
- 多选框：SelectionBoxOverlay 内渲染（屏幕坐标层）；普通组框：GroupNode 渲染层（流坐标，随组移动缩放），**组选中时显示**；分镜组不渲染

**交互状态机**（组件局部 state + store 少量字段）：
- pointerdown 记录起点 → 位移 ≥5px 进入**连线态**：<5px 且 pointerup = **点击**
- 连线态：`BatchConnectLines`（portal 至 #node-toolbar-portal，复用 SelectionBoxOverlay 的流↔屏坐标换算）自绘 SVG 折线集合：每个源节点右侧中点 → 指针当前位置；激活色（`--fw-text` 或 handle 激活色）；指示器跟随指针
- 实时命中检测：指针流坐标落入某节点 bounds → 该节点加高亮 class；源节点自身、组节点不可为目标
- pointerup 命中 → `batchConnect(sourceIds, targetId)`：逐对 `(source→target)` 建边，复用现有 addEdge 同源判重 + `getId('edge')`，普通边样式——等效手动逐个连线；已存在的对跳过
- pointerup 落空 → 取消（不弹菜单）
- **点击** → 在 +号右侧弹节点类型菜单：复用 HandleAddNodeMenu 的 SOURCE_ITEMS（文本/图片/视频/音频）与背板/Escape 关闭机制；选中类型 → 创建 **1 个**新节点于 +号右侧 80px（垂直居中）→ `batchConnect` 全部源 → 新节点

**源集合定义**：多选框=全部选中节点；组框=组内全部子节点。

### 4.5 分镜组改版（需求 8）

- **主体**：StoryboardGroupRenderer 背景 `var(--storyboard-group-shell-bg)`、边框 `1px var(--canvas-group-border)`；组尺寸计算（calcStoryboardSize）与宫格/序号/空位填充/删除行为不变
- **左上标题浮层**（新增）："分镜组 N 个节点"，组框左上角外 8px，13px muted 色（`--fw-text` 透明度降低），超长省略号
- **工具条**（storyboard 组选中时，组框上方居中）：`[16:9▾] [宫格 n×m▾] │ [拼接(2k/4k)] [序号] [清空] [转普通组] │ [解组]`
  - 全部现有功能重渲染新视觉（容器规范同 4.1，按钮 h-8）
  - 宫格文案动态：`宫格 {gridCols}×{gridRows}`；拼接文案随 stitchResolution：`拼接(2k)`/`拼接(4k)`
  - 无折叠/整组执行（维持现有 noP 分支，与参考代码一致）

### 4.6 CSS 变量与主题

index.css（遵守 `.light` 必须在 `.dark` 之后的源序约束及既有测试守卫）：

| 变量 | 深色（:root/.dark） | 浅色（.light） |
|---|---|---|
| `--canvas-group-border` | `#3a3a3a` | `#e5e7eb` |
| `--storyboard-group-shell-bg` | `#212121` | `#f7f8f8` |

参考代码为浅色主题；深色值按项目深色画布基调定，浏览器验收时可微调（数值变更不视为设计变更）。新 UI 一律 inline `var(...)`，不注册 Tailwind 色（遵守 slash-gate 门禁）。

## 5. 数据模型变更汇总

- `GroupData`：+ `color?: string`（hex；undefined=未设色）
- 其余无 schema 变更；节点 data 内新增字段随现有持久化机制（开发期无存量数据兼容负担）

## 6. 测试策略（TDD：每处改动先写测试）

| 层 | 测试内容 |
|---|---|
| 纯函数 | `arrangeRects` 三模式（列数/间距/中心锚定/尺寸不变）；`rectCompletelyOutside`（分离/相交/相切边界）；折叠卡列数规则函数 |
| store | arrangeSelection；duplicateSelection（散节点复制+边映射+含组走 duplicateGroup+新集选中）；batchConnect（多边建立/判重跳过/自标排除）；setGroupColor；arrangeGroupChildren（排列+refit）；removeFromGroup（脱离+空组自动删除+坐标转全局）；onNodesChange 普通组实时 refit、storyboard 跳过；extent/clamp 废除后无回归 |
| 组件 | SelectionBoxOverlay：新按钮渲染/排列菜单弹出与回调/下载禁用态；AddOutputHandle：点击阈值/拖拽进入连线态；BatchConnectLines：多源线渲染；CollapsedPreviewCard：列数/tile 类型（图片 img、其它图标）/计数行；GroupToolbar：新布局按钮序；StoryboardGroupRenderer：shell 变量样式/标题浮层文案 |
| util | mediaDownload：成功路径（fetch→blob→a.click）/失败 fallback |
| 浏览器验收 | 多选拖 +号连到视频节点（批量建边）；点击 +号建节点连线；组内拖出（完全/部分）；空组自动消失；折叠预览卡；组颜色着色；排列三模式；批量下载；分镜组新视觉；深浅主题切换 |

## 7. 验收标准

1. 多选≥2 节点：虚线框 padding 30px；工具条四按钮区齐全可操作
2. 排列三模式后节点布局规整、中心不变、无尺寸变化；组内排列后组框贴合
3. 创建副本：偏移 40px 出现副本、内部边保留、新集选中
4. 批量下载：逐个触发浏览器下载，无成品时置灰
5. 组颜色：选色后边框/标题/折叠卡着色，清除恢复默认
6. 折叠：220×160 宫格预览卡、列数规则正确、≤6 tile、图片显图其它显图标、底部"N 个节点"
7. 拖出：拖动中组框实时跟随保持 padding；完全拖出即脱离；空组消失；部分拖回组框收缩贴合
8. +号：框右中点显示；拖拽批量连线（多源激活线、命中高亮、批量建边判重）；点击建 1 节点并全量连线
9. 分镜组：新 shell 底色/边框、左上标题浮层、工具条新视觉+动态文案
10. 深浅主题下所有新 UI 对比度正常

## 8. 范围外（本次不做）

- 分镜组框 +号输出按钮（需求仅指虚线框与打组框）
- 分镜组折叠/整组执行
- 组颜色自定义取色器（仅预设 8 色）
- 批量下载 zip 打包
- +号菜单创建多节点（仅 1 个）
- 协作多端拖动组框的广播节流优化
