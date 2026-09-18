# A0 CSS 审计报告（before 基线冻结）

- 生成时间：2026-09-18T16:13:20.648Z
- 基线 commit：`b4384096f572dc48c0de59c4124ada6b236d98a1`
- 产物 CSS：dist/assets/index-Dx6BxzyI.css（compile-diff 的"产物侧"）
- 统计口径：按**类字符串出现次**计（任务参考值为 grep 行数口径，同行多次/含 `text-white/NN` 子串等会造成偏差——本表为冻结权威口径）
- 稳定键：`file#tag@序号`（宿主元素签名，非行号）；行号仅辅助人读

## Route ① 颜色债 + 涌现面（裁定拆列）+ 主题色工具类归属

| 维度 | 计数 | 参考 | 说明 |
|---|---|---|---|
| 颜色债（任意值硬编码 hex） | 721（产品 700） | — | bg/text/border/ring/…-[#hex] 全量 |
| 边框宽度类总数 | 271 | ~324 | 参考口径即此数（含配了色的） |
| 裸边框（宽度无色） | 118（产品 105） | — | 同 className 串/同分支内无 border 颜色类——真"忘配色"裁定族 |
| border-[color]（宽度+显式色） | 144 | ~238 | [#hex]/[var(--…)] 两形，绝大多数保留 |
| 分隔线 divide 族 | 2 | 1 处 | divide-y + divide-white/5 同点（TeamBillingPage）；子元素 UA border-style:none → 全站不可见 |
| textarea 清单 | 6（产品，含测试 6） | ~7 | 逐个登记是否带显式文本色 |
| [border-*-style:*] 四格阵 | 代码 19（solid 18 + dashed 1） + 测试断言 1 + 内联 1 | 18+1+1 | dashed 在 VideoEditNode |

### 主题色工具类（white/black 族）宿主岛归属（三列）

| 列 | 计数 | 文件数 |
|---|---|---|
| 画板恒深（board） | 150 | 31 |
| 岛内（island） | 23 | 7 |
| 跟随（following） | 349 | 60 |

- text-white（精确 token，不含 /NN）：**136**（参考 213 为 grep 行数口径：同行多记 + 含 text-white/NN 行；src/pages/canvas/ 下 47，参考 83）
- text-black（精确 token）：**16**（参考 16 = 行数口径，此处一致量级）
- white/black 族总出现：522，涉及 98 文件
- 归属判据顺序：D4 域图草案（route ⑤）→ 岛根祖先链 → 跟随域；路径前缀不可作判据（反例 HistorySidebar）

## Route ② 半透明族（属性 × 透明度分列，五通道，变体前缀已吃）

| 通道 | 计数 | 透明度档 | 变体前缀 | 参考 |
|---|---|---|---|---|
| bgWhite | 176 | 5, 10, 15, 20, 30, 40, 50, 90 | hover: before: group-hover/row: | ~197/12 档 |
| borderWhite | 46 | 5, 10, 15, 20, 25, 30, 40 | focus: hover: | ~54/10 档 |
| textWhite | 93 | 30, 40, 45, 50, 55, 60, 70, 75, 80, 85, 90 | hover: | ~93/11 档 |
| ringWhite | 7 | 10, 20, 60 | hover: focus-within: | 5（宿主元素口径；此处为出现次口径，WorkspaceToolbar:43 同点 2 类） |
| divideWhite | 1 | — | — | 1 |

## Route ③ 死类家族（compile-diff，content globs 内，动态拼接单列存疑）

- 判死总数：**30**（参考 ~25-27）；动态拼接存疑：0

| 类 token | 总次 | 产品次 |
|---|---|---|
| `text-popover-foreground` | 10 | 10 |
| `text-muted-foreground` | 8 | 8 |
| `z-5` | 3 | 3 |
| `text-fg-default` | 3 | 3 |
| `outline-hidden` | 2 | 2 |
| `focus-visible:ring-ring` | 2 | 2 |
| `text-primary-foreground` | 2 | 2 |

## Route ④ 斜杠零输出基线

- var() 型颜色键：[]（现状 0）
- var 键 + /NN 组合违规：**0**（基线冻结为 0；B0 后转产物 CSS 存在性回归检查）
- 现存 [`#hex`]/NN（合法，hex+斜杠可用）：**32**（参考 ~28）

## Route ⑤ 域 token 引用 × 宿主域 + 变量引用图 + D4 画板清单草案

- ts/tsx var() 引用点（产品码）：**161**

| token | 引用次数 |
|---|---|
| `--ve-text` | 34 |
| `--ve-border` | 25 |
| `--ve-text-dim` | 22 |
| `--ve-accent` | 15 |
| `--ve-panel` | 14 |
| `--canvas-controls-text` | 12 |
| `--canvas-controls-hover` | 11 |
| `--canvas-controls-border` | 6 |
| `--canvas-controls-bg` | 4 |
| `--canvas-controls-active` | 3 |
| `--canvas-shadow-dropdown` | 2 |
| `--ve-bg` | 2 |
| `--ve-track-video` | 2 |
| `--vw-close-reserve` | 2 |
| `--canvas-shadow-menu` | 1 |
| `--canvas-handle-bg` | 1 |
| `--canvas-handle-icon` | 1 |
| `--vw-carousel-reserve` | 1 |
| `--vw-card-border` | 1 |
| `--vw-card-border-hover` | 1 |
| `--vw-card-bg` | 1 |

### 变量引用图（手写 CSS 内自定义属性 → 其它自定义属性间接链）

- `src/index.css:30` — `--ve-panel: var(--canvas-controls-bg)` → 引用 `--canvas-controls-bg`
- `src/index.css:31` — `--ve-border: var(--canvas-controls-border)` → 引用 `--canvas-controls-border`
- `src/index.css:34` — `--ve-text-control: var(--canvas-controls-text)` → 引用 `--canvas-controls-text`

### D4 画板组件清单草案（恒深保留 + 禁 token 化），证据逐条

- **ConnectionLine**（`src/pages/canvas/components/edges/ConnectionLine.tsx`）：CanvasView.tsx nodeTypes/edgeTypes 注册（渲染进 React Flow viewport）；目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **EdgeFlowParticles**（`src/pages/canvas/components/edges/EdgeFlowParticles.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **AspectRatioDropdown**（`src/pages/canvas/components/groups/AspectRatioDropdown.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **GridSizeDropdown**（`src/pages/canvas/components/groups/GridSizeDropdown.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **GroupContextMenu**（`src/pages/canvas/components/groups/GroupContextMenu.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **GroupNode**（`src/pages/canvas/components/groups/GroupNode.tsx`）：CanvasView.tsx nodeTypes/edgeTypes 注册（渲染进 React Flow viewport）；目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **GroupToolbar**（`src/pages/canvas/components/groups/GroupToolbar.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **NormalGroupRenderer**（`src/pages/canvas/components/groups/NormalGroupRenderer.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **SelectionBoxOverlay**（`src/pages/canvas/components/groups/SelectionBoxOverlay.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **StitchButton**（`src/pages/canvas/components/groups/StitchButton.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **StoryboardCell**（`src/pages/canvas/components/groups/StoryboardCell.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **StoryboardGroupRenderer**（`src/pages/canvas/components/groups/StoryboardGroupRenderer.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **aiToolConfig**（`src/pages/canvas/components/nodes/ai/aiToolConfig.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **AiToolActionPopup**（`src/pages/canvas/components/nodes/AiToolActionPopup.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **AnnotationCanvas**（`src/pages/canvas/components/nodes/AnnotationCanvas.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **AnnotationToolbar**（`src/pages/canvas/components/nodes/AnnotationToolbar.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **AudioConfigPanel**（`src/pages/canvas/components/nodes/AudioConfigPanel.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **AudioGenNode**（`src/pages/canvas/components/nodes/AudioGenNode.tsx`）：CanvasView.tsx nodeTypes/edgeTypes 注册（渲染进 React Flow viewport）；目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **AudioWaveform**（`src/pages/canvas/components/nodes/AudioWaveform.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **CreditDisplay**（`src/pages/canvas/components/nodes/config-panel/CreditDisplay.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **GenerateCountSelector**（`src/pages/canvas/components/nodes/config-panel/GenerateCountSelector.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **ModelSelector**（`src/pages/canvas/components/nodes/config-panel/ModelSelector.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **PromptEditor**（`src/pages/canvas/components/nodes/config-panel/PromptEditor.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **RatioResolutionPopover**（`src/pages/canvas/components/nodes/config-panel/RatioResolutionPopover.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **RunButton**（`src/pages/canvas/components/nodes/config-panel/RunButton.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **CropOverlay**（`src/pages/canvas/components/nodes/CropOverlay.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **EditToolbar**（`src/pages/canvas/components/nodes/EditToolbar.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **EraseBottomToolbar**（`src/pages/canvas/components/nodes/EraseBottomToolbar.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **EraseCanvas**（`src/pages/canvas/components/nodes/EraseCanvas.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **ImageConfigPanel**（`src/pages/canvas/components/nodes/ImageConfigPanel.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **ImageConfigPanelResolver**（`src/pages/canvas/components/nodes/ImageConfigPanelResolver.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **ImageExtConfigPanel**（`src/pages/canvas/components/nodes/ImageExtConfigPanel.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **ImageExtNode**（`src/pages/canvas/components/nodes/ImageExtNode.tsx`）：CanvasView.tsx nodeTypes/edgeTypes 注册（渲染进 React Flow viewport）；目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **ImageFullscreenViewer**（`src/pages/canvas/components/nodes/ImageFullscreenViewer.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **ImageGenNode**（`src/pages/canvas/components/nodes/ImageGenNode.tsx`）：CanvasView.tsx nodeTypes/edgeTypes 注册（渲染进 React Flow viewport）；目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **ImageNodeToolbar**（`src/pages/canvas/components/nodes/ImageNodeToolbar.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **MultiImageConfigPanel**（`src/pages/canvas/components/nodes/MultiImageConfigPanel.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **MultiImageNode**（`src/pages/canvas/components/nodes/MultiImageNode.tsx`）：CanvasView.tsx nodeTypes/edgeTypes 注册（渲染进 React Flow viewport）；目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **NodeHandle**（`src/pages/canvas/components/nodes/NodeHandle.tsx`）：消费域 token 2 处；目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **OutpaintSelectionOverlay**（`src/pages/canvas/components/nodes/OutpaintSelectionOverlay.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **CommandMentionList**（`src/pages/canvas/components/nodes/prompt-input/CommandMentionList.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **ImageMentionList**（`src/pages/canvas/components/nodes/prompt-input/ImageMentionList.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **ImageThumbnailBar**（`src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **PromptInput**（`src/pages/canvas/components/nodes/prompt-input/PromptInput.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **SortableImageItem**（`src/pages/canvas/components/nodes/prompt-input/SortableImageItem.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **TextConfigPanel**（`src/pages/canvas/components/nodes/TextConfigPanel.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **TextInputNode**（`src/pages/canvas/components/nodes/TextInputNode.tsx`）：CanvasView.tsx nodeTypes/edgeTypes 注册（渲染进 React Flow viewport）；目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **TextNodeFullscreen**（`src/pages/canvas/components/nodes/TextNodeFullscreen.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **TextNodeToolbar**（`src/pages/canvas/components/nodes/TextNodeToolbar.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **TransformToolbar**（`src/pages/canvas/components/nodes/TransformToolbar.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **VideoConfigPanel**（`src/pages/canvas/components/nodes/VideoConfigPanel.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **VideoEditNode**（`src/pages/canvas/components/nodes/VideoEditNode.tsx`）：CanvasView.tsx nodeTypes/edgeTypes 注册（渲染进 React Flow viewport）；目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **VideoFullscreenViewer**（`src/pages/canvas/components/nodes/VideoFullscreenViewer.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **VideoGenNode**（`src/pages/canvas/components/nodes/VideoGenNode.tsx`）：CanvasView.tsx nodeTypes/edgeTypes 注册（渲染进 React Flow viewport）；目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **VideoHDPanel**（`src/pages/canvas/components/nodes/VideoHDPanel.tsx`）：消费域 token 8 处；目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **VideoNodeToolbar**（`src/pages/canvas/components/nodes/VideoNodeToolbar.tsx`）：消费域 token 6 处；目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **VideoTrimPanel**（`src/pages/canvas/components/nodes/VideoTrimPanel.tsx`）：消费域 token 4 处；目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）
- **VideoTrimTimeline**（`src/pages/canvas/components/nodes/VideoTrimTimeline.tsx`）：目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）

- 岛内草案：src/pages/canvas/video-editor/、src/components/MaterialLibrary/（video-editor 壳 / MaterialLibrary 自带 CSS 弹层）
- 永不迁移清单：--canvas-handle-*、--edge-flow-*、--canvas-shadow-*、--z-panel
- 反例登记：路径前缀反例：位于 components/ 但消费 --canvas-controls-text/hover（index.css 画布壳 token）→ 域=跟随（画布壳（canvas shell）= 跟随域：画布页 DOM 骨架（菜单/调板/顶栏/侧栏），主题化时随站点走）。判据顺序=域图→岛根祖先链→跟随域，路径不可作为判据

## Probe 登记（A1 断言靶点）

- 裸 `<button>`（无 className）：产品 110 + 测试 9；优先探针=login/register 页与带 aria-label 者（父级 font-size 基准由基线快照承接）
- WorkspaceTabBar 双臂：选中 `text-white border-b-2 border-white border-x-0 border-t-0` / 未选中 `text-white/50 border-none`；选择器 `getByRole("button", { name: "个人项目" })`
- aria-disabled 现状：4 行（产品 1 + 测试 3 = 4 行）

## 判断与口径备忘（本脚本自决项）

- 归属三列的"岛内"草案含 video-editor 与 MaterialLibrary 子树（自带独立 CSS 的暗色自持区）；videos 预览弹层暂归跟随，D4 定稿时复核
- border-[color] 计入 `[#hex]` 与 `[var(--…)]` 两形（后者现值域 token，同属"宽度+显式色"裁定列）
- 死类判定 = 类字符串字面量内的静态完整 token（content globs 内、产物 CSS 无规则）；判据三重：字面量需含真类（密度≥40%）、token 需完整工具类形状（纯前缀裸词/以 - 结尾的拼接残片不判）、模板插值边缘 token 只入存疑
- 与 grep 口径的已解释偏差：① grep 子串匹配会把测试标题里黏连中文的类名计入（bg-white/NN 差 1）；② grep 行数把同行多类少记（text-white 参考 213）；③ ring-white 参考按宿主元素 5 记、本表按出现次 7 记（WorkspaceToolbar:43 同点 ring-white/10 + focus-within:ring-white/20）
- 产物 CSS 类存在性判定 = 解析选择子类名集合后精确比对（含反转义），免疫 2xl: 等前缀数字的 hex 转义形态（\32xl）
- 颜色债口径含颜色属性全族（bg/text/border/ring/fill/stroke/from/via/to/divide/outline/shadow/decoration/accent/caret）的 `[#hex]` 任意值
- audit 明细（含全部 items/稳定键）见 audit-A0.json