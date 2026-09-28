# Canvas 组与分镜组 UI 升级（Spec A）— 设计 spec

- 日期：2026-09-28（评审修订版，替代同日初版上半部分）
- 状态：待用户审阅
- 范围：需求 1/2/3/4/8 + 组颜色 —— 纯 UI/交互改版层，无组几何语义变更
- 姊妹篇：`2026-09-28-group-geometry-batch-connect-design.md`（Spec B：拖出机制 + +号批量连线，依赖本篇先行合入）
- 参考代码出处：用户需求原文提供的目标产品（Pippit）DOM 片段，视觉参数已提取进本 spec 各表，实现以本表为准

## 1. 背景与目标

按目标产品参考代码升级画布组体系 UI：多选框/工具条改版、排列、创建副本、批量下载、组颜色、折叠宫格预览卡、分镜组视觉与工具条。本篇不含组几何所有权变更（拖出/动态跟随，归 Spec B）。

已核实的库内事实约束（评审实证）：

| 事实 | 位置 |
|---|---|
| 组 data 变更必须双写 nodeStore（快照数据源） | canvasStore.ts:22-28 `syncGroupDataToNodeStore` |
| 后端快照 data 白名单会剥离新增字段 | apps/api snapshot-filter.util.ts:42 `group: ['groupType','cells','name']` |
| canvasStore 节点 data 仅桥接 5 键实时，其余 stale；复制节点必须从 nodeStore 取全量 data | nodeStore.ts:235 `CANVAS_BRIDGE_KEYS` |
| `addEdge` 只按 edge id 幂等，同源判重在 `onConnect` | canvasStore.ts:471-478 / :598-604 |
| 分镜组右上角已有 `data.name ?? '分镜组'` 标签；`name` 计数写死会过期 | StoryboardGroupRenderer.tsx:57-59 |
| 分镜组工具条现状无 转普通组/解组 按钮（storyboard 分支仅渲染 children） | GroupToolbar.tsx:69、CanvasView.tsx:618-656 |
| `TOOLBAR` 常量被多选/组两工具条共用；折叠尺寸 200×64 在 store 与渲染层双硬编码 | selectionTokens.ts:38、canvasStore.ts:1261、NormalGroupRenderer.tsx:44 |
| `aria-disabled` 仅 cursor 样式不拦点击 | index.css:116-120 |
| `isImageCompletedNode` 覆盖 imageGen/imageExtGen/multiImageGen 三型 | imageNodeGuards.ts |
| `useMediaUrl` 无缓存（每次挂载重打请求） | useMediaUrl.ts |
| convertGroup 两方向整体重建 data（转组丢 color，本篇须保色） | canvasStore.ts:1204/:1216 |
| lint 门禁：no-color-hex 增量禁令、b0-token-blocks / b1-token-migration 枚举式 token 守卫、css-audit slash-gate | lint-gate.mjs、b0-token-blocks.spec.ts |

## 2. 需求清单（本篇）

| # | 需求 | 关键口径（已拍板/已证实修正） |
|---|---|---|
| 1 | 多选虚线框 padding 16→30px | 屏幕像素不随 zoom；titleExtra 26 不动 |
| 2 | 多选工具条：`[排列▾] │ [创建副本] │ [打组▾] [批量下载] │` | 排列三模式；副本修丢配置 bug；下载抽公共 util |
| 3 | 组工具条：`[颜色点] [排列子节点▾] │ [折叠] [整组执行] [转分镜组] [解组] │ [批量下载]` | 组颜色新数据字段+全链路持久化 |
| 4 | 折叠态改宫格预览卡 220×160 | 尺寸常量单源；useMediaUrl 加缓存 |
| 8 | 分镜组视觉改版 + 工具条 | 转普通组/解组为**新增**按钮；智能标题替换右上标签 |

## 3. 详细设计

### 3.1 多选虚线框（需求 1）

`selectionTokens.ts` `SELECTION_BOX.padding: 16 → 30`。同步更新 SelectionBoxOverlay.test.tsx 中硬编码几何断言（194/352/132/164px、68px 等，按 +14px 平移重算）。

### 3.2 Token 拆分与新增（需求 2/3/8 前置）

- `TOOLBAR` 拆为 `SELECTION_TOOLBAR = { height: 40, offset: 14 }`（多选，选框上缘 14px）与 `GROUP_TOOLBAR = { height: 44, offset: 28 }`（组，组框上缘 28px，提为命名常量并留 ≥2px 组名浮层余量说明）。GroupToolbar/SelectionBoxOverlay 各引各的，`isAbove` 翻转判定随各自常量。
- index.css 新增（深 `:root,.dark` / 浅 `.light` 双块，`.light` 源序在后——b1 守卫约束）：
  - `--canvas-storyboard-shell-bg`：深 `#212121` / 浅 `#f7f8f8`（命名带 canvas- 前缀落入 b1 域正则）
  - `--canvas-group-border`：深 `#3a3a3a` / 浅 `#e5e7eb`
  - 组颜色 8 色板变量：`--canvas-group-color-0..7` 深浅各一套（统一 canvas- 前缀落入 b1 域正则；浅档用深色变体保 WCAG 1.4.11 ≥3:1 对 `--canvas-board-bg` 亮档 #F5F5F5，如黄 #fadb14 亮档换 #a16207 系）。hex 全部落 CSS，TS 只引用 `var(--canvas-group-color-*)`，规避 no-color-hex lint
- b0-token-blocks.spec.ts 的 TOKENS/DOMAIN_DARK/DOMAIN_LIGHT 三表 + e2e/audit/canvas-migration-registry.json 同步登记（任务清单项，漏则门禁红）

### 3.3 多选工具条（需求 2）

结构/容器视觉/按钮规格/排列菜单项同初版（padding 8 / gap 8 / 圆角 12 / 0.5px 边框 / blur 16 / 阴影；h-8 按钮、13px、hover 变量；下载 32×32 图标钮 aria-label=批量下载；打组▾ 下拉保留两项及禁用条件）。数量徽标留选框左上角。

**normalizeSelection（新纯函数，nodeOrder.ts 或新 utils/selection.ts）**：输入选中 id 集 → `{ groups: groupId[], loose: nodeId[] }`；组节点收进 groups，其子节点从 loose 剔除（组视为原子块）。消费点：排列/副本/+号源集（Spec B）。下载源集 = groups 展开子节点 + loose。

**arrangeSelection(mode)**（store action）：
- 输入 = normalizeSelection 结果；**组作为原子块参与布局**（rect 用组框绝对 rect），散节点用节点绝对 rect；子节点不单独参与
- `arrangeRects(rects, mode)`（groupLayout.ts 纯函数，绝对流坐标）：grid 列数复用 `calcDefaultGrid(n)`（注：n=2 时 1×2 与 horizontal 等价，属预期）、`ARRANGE_GAP = 60`；**混排尺寸行高=该行 max、列宽=该列 max**；n≤1 no-op；输出等尺寸 rect 集，整体平移使包围盒中心不变
- 写回：散节点写绝对 position；组写组 position（子节点 rel 不动，随组整体位移）。**单次 setWithParentOrder、一个 undo 步**；排列后保持原选区

**duplicateSelection()**：
- 抽公共 `duplicateNodes(ids, offset)`（canvasStore 内 helper）：id 集 = normalizeSelection 展开闭包（组+其子节点+散节点）；**data 一律取 `useNodeStore.getState().nodes[id].data` 全量**（修复既有丢配置 bug）；idMap 全集 → 新节点集（组/子 parentId 重映射、selected 仅组为 true 子为 false）+ 选区闭包内互连边（两端∈idMap）重映射复制；偏移 `{40, 0}` 统一常量 `DUPLICATE_OFFSET`（`copyNode` 的 {50,50} 一并改齐，消除双常量）；单次 set + ns.addNode 逐个（data 全量）+ applyGroupDerivations；新集合选中、旧集合取消
- 单 undo 步（stopCapturing 语义对齐 duplicateGroup 现状）

**批量下载**：
- 抽 `utils/mediaDownload.ts` → `downloadMediaFile({ fileId, filename }): Promise<void>`：getMediaUrl → fetch → blob → `a.download = filename`（来源：`data.fileName ?? data.mediaName ?? 节点类型-短id`，扩展名由响应 content-type 映射）→ click → **`setTimeout(revoke, 60_000)` 延迟回收**（对齐 ExportModal.tsx:160 既有正确做法）；失败 `message.error` 提示并继续下一项（**批量路径不用 window.open fallback**——await 后的 popup 必被拦截）
- 5 处既有重复实现（ImageGenNode/VideoGenNode/ImageFullscreenViewer/VideoFullscreenViewer/ExportModal 中前四者）切换引用，ExportModal 保持现状（FSA 路径不同）
- `downloadSelectionMedia()`：收集源 = isImageCompletedNode（三型）∪ 视频完成节点（有 fileId）；**串行 + 项间递增延迟**（如 i*300ms，规避浏览器多下载节流静默丢弃）；无可下载项按钮 `aria-disabled` + **handler 内 `if (targets.length === 0) return` 守卫**（aria-disabled 不拦点击）

### 3.4 组工具条与组颜色（需求 3）

布局/视觉同初版（色点 size-10 内 20px 圆、排列子节点菜单、h-9 圆角 10、下载 size-9；容器 `GROUP_TOOLBAR.offset=28px`；portal #node-toolbar-portal 屏坐标层维持现有 GroupToolbar 机制，替换硬编码 rgba(0,0,0,0.85) 为 canvas-controls 变量容器规范）。折叠/整组执行/转分镜组/解组行为与禁用条件不变。

**组颜色**：
- `GroupNodeData`（types/group.ts，真名非 GroupData）+ `color?: string`（存 CSS 变量名 `--canvas-group-color-3` 而非裸 hex——白名单校验天然简化，CRCT 共享安全）
- 色板浮层：8 圆点 + "默认"清除项；`setGroupColor(groupId, color?)`：写 canvasStore data → `syncGroupDataToNodeStore(groupId)` 双写 → applyGroupDerivations 无关不动
- `convertGroup` 两分支保留 color 字段（storyboard→normal / normal→storyboard 的 data 重建处展开保留）
- 后端 snapshot-filter.util.ts `group` 白名单 + `'color'`，同步 snapshot-filter.util.spec.ts 期望字段集
- 着色范围：组框边框色、组名标题文字/徽标、折叠卡边框（均引用 `var(color变量)`）；未设色维持现 token 样式

**排列子节点** `arrangeGroupChildren(groupId, mode)`：子节点绝对 rect（rel+组绝对）→ arrangeRects → 同一 set 内写子节点新 rel（目标绝对 − 新组原点）+ 组新几何（子包围盒+GROUP_PADDING/GROUP_PADDING_TOP）——**排列自写全量坐标，天然守恒，不依赖 refitGroupBounds**（Spec B 改造后亦兼容）；单次 setWithParentOrder。仅普通组。

### 3.5 折叠宫格预览卡（需求 4）

- `COLLAPSED_SIZE = { width: 220, height: 160 }` 常量入 groupLayout.ts，toggleCollapse（canvasStore.ts:1261）与 NormalGroupRenderer 折叠渲染**同源引用**（消除双硬编码）
- 结构/列数规则/≤6 tile/summaryRow"N 个节点"/不显示组名，同初版；重命名入口 = 组右键菜单（已有）与展开态标题双击，折叠卡不提供
- tile 组件 `CollapsedPreviewTile`：图片完成节点用 `useMediaUrl(fileId)`（hooks 规则：tile 独立组件）；**useMediaUrl 增加模块级 Map 缓存**（fileId→url，TTL 内复用；失败不缓存）——折叠/展开反复挂载不再重打请求；其它类型节点居中类型图标占位（SVG，`--fw-text-dim-3`）
- 组颜色着色折叠卡边框；选中态高亮优先选中色

### 3.6 分镜组改版（需求 8）

- 主体：背景 `var(--canvas-storyboard-shell-bg)`、边框 `1px var(--canvas-group-border)`；宫格/序号/空位填充/删除行为不变
- **智能标题**（替换现有右上角标签，不共存）：左上角组框外 8px 浮层——`data.name` 为用户重命名值（≠自动生成格式）时显示 name；否则显示 `分镜组 ${cells.filter(Boolean).length} 个节点` **实时派生**（不读 name 的过期计数）。判定规则：mergeStoryboard/convertGroup 写入的自动名含"个节点"格式——实现为 `data.nameCustom?: boolean` 标记（renameGroup 置 true，自动生成不置），标题读 nameCustom 决定显示分支；13px muted、超长省略
- 工具条（组选中时）：`[比例▾] [宫格 n×m▾] │ [拼接(2k/4k)] [序号] [清空] [转普通组] │ [解组]`
  - 比例/宫格/拼接/序号/清空 = 现有功能重渲染新视觉（容器规范同 3.3，h-8）
  - **转普通组、解组 = 新增按钮**（现 storyboard 分支未渲染）：onConvert 复用 `convertGroup(id,'normal')`（已支持），onUngroup 复用现有 handleUngroup 链路（GroupToolbar storyboard 分支补渲染这两个按钮，Props 已有对应回调）
  - 宫格文案动态 `宫格 {cols}×{rows}`；拼接文案随 stitchResolution
  - 无折叠/整组执行（维持 noP）

## 4. 测试策略（TDD）

| 层 | 内容 |
|---|---|
| 纯函数 | arrangeRects（三模式/混排行高列宽/中心锚定/n≤1）；normalizeSelection（组+子同选/纯散/纯组）；折叠卡列数规则 |
| store | arrangeSelection（原子块/中心不变/单 set/保持选区）；duplicateNodes（nodeStore data 全等断言——关掉丢配置 bug 的回归锚点；边重映射；DUPLICATE_OFFSET 统一后 copyNode 断言同步）；setGroupColor（双写 nodeStore + doc 投影含 color）；convertGroup 保色两方向；arrangeGroupChildren（守恒：子节点绝对位置=arrangeRects 输出） |
| util | mediaDownload（文件名/revoke 延迟——vi.useFakeTimers/失败 message）；useMediaUrl 缓存（同 fileId 二次挂载不发请求——mock api 计数） |
| 组件 | SelectionBoxOverlay（按钮序/排列菜单/下载禁用 handler 守卫）；GroupToolbar（新布局/色板浮层/storyboard 补转普通组+解组）；CollapsedPreviewCard（列数/tile 类型/计数行）；StoryboardGroupRenderer（shell 变量/智能标题两分支/右上旧标签移除） |
| 门禁 | b0/b1/registry 同步后全绿；lint（色板 hex 只在 index.css） |

既有测试更新清单：SelectionBoxOverlay.test.tsx 几何断言（padding+14 平移）、GroupToolbar.test.tsx（188/312px 断言随 offset 14/28 重算 + 新按钮序）、NormalGroupRenderer.test.tsx 折叠态（尺寸 220×160、组名断言移除）、StoryboardGroupRenderer.test.tsx（getByText('分镜组') 歧义消除——右上标签删除后唯一）。

浏览器验收：排列三模式（含组+散混选）、副本内容等价（副本 prompt 与源一致）、批量下载 ≥5 文件全部落地、组颜色全链路（设置→刷新仍在→转组仍在→快照仍在）、折叠卡、分镜组智能标题与新工具条、深浅主题 8 色可辨。

## 5. 范围外

- 拖出机制/+号/批量连线（Spec B）
- 折叠卡显示组名（已拍板不显示；重命名走右键菜单/展开态）
- zip 打包、下载进度条（递增延迟 + 失败提示已覆盖可用性）
- `--storyboard-group-shell-bg` 旧命名（本篇直接用 `--canvas-storyboard-shell-bg`）
