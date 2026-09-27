# 画布平移/框选交互重构（spec）

- 日期：2026-09-28（同日二修，吸收三份二审报告全部核实成立项）
- 状态：已确认（设计经三轮审核、逐条对照实装源码核实修订）
- 范围：`apps/web/src/pages/canvas/components/CanvasView.tsx` 及其配套（抑制信号、快捷键面板、CSS、测试）
- 库版本依据：@xyflow/react@12.10.2 / @xyflow/system@0.0.76 / d3-zoom@3.0.0（实装源码逐行核实）
- 前提声明：无用户数据、无兼容负担，不做 feature flag 与兼容层

## 1. 背景与目标

当前画布：左键拖空白=平移（`panOnDrag={!isLocked}`）、滚轮=平移（`panOnScroll` + `zoomOnScroll={false}`）、Shift+左键拖=框选（`selectionKeyCode` 默认 Shift）。

目标（用户需求原文映射）：

1. 平移画布触发方式：**空格+左键拖**、**鼠标中键拖**（左键直接拖不再是平移）
2. **左键拖空白=框选**（不再需要 Shift）
3. 滚轮改为**缩放**（用户拍板）
4. 框选判定 = **Partial 相交即选**（用户拍板；今天 Shift 框选为默认 Full 完全套住）

措辞张力（显式登记，防后人反复拉扯）：本方案是官方 **selection-on-drag 推荐配方**，触发方式对齐官方文档，**非全部参数等于库默认值**——库默认为 `panOnDrag=true`（左键平移）+ `selectionMode=Full`，本方案有意偏离两处（`[1]` + `Partial`）。2026-05-28 快捷键面板 spec:57-59 本就登记"键盘平移 Space+拖动 / 鼠标平移 中键拖动"为项目设计基线，本次是把代码拉回既有设计方向（该表"触控板平移=双指拖动"与本次滚轮=缩放冲突，§10 同步）。

## 2. 现状配置（CanvasView.tsx:466-469）

```jsx
zoomOnScroll={false}
panOnScroll={!isLocked}
panOnDrag={!isLocked}          // 左键拖=平移
zoomOnDoubleClick={!isLocked}
```

- 框选：`selectionKeyCode` 默认 'Shift' → Shift+左键拖
- `multiSelectionKeyCode="Shift"`（点击节点加选，保留不动）
- 锁定 = `activeEditNodeId !== null`（节点编辑中）；参考选择 = `referenceSelect !== null`

## 3. 核心改动（CanvasView.tsx）

```jsx
// 模块级常量：panOnDrag 不在 StoreUpdater fieldsToTrack（react:186-248，不写库）；
// 真实代价在 ZoomPane 的 update effect（react:1337-1377，deps 含 panOnDrag）——
// CanvasView 每帧 viewport 重渲染且 FlowRenderer memo 被 children 击穿（react:2001），
// 内联数组每渲染新身份 → effect 每帧重跑 → update() 无条件重建 wheel handler/重挂 d3
// （system:2909-2986）。常量使引用稳定 → effect 不重跑。
const PAN_ON_DRAG_MIDDLE = [1];

zoomOnScroll={!isLocked}                                       // 滚轮=缩放（原 false）
// panOnScroll 整行删除（false 即默认值）
panOnDrag={isLocked ? false : inRefSelect ? true : PAN_ON_DRAG_MIDDLE}  // 中键拖=平移
selectionOnDrag={!isLocked}                                    // 左键拖空白=框选（新增）
selectionMode={SelectionMode.Partial}                          // 相交即选（import 枚举；字面量 'partial' 过不了类型检查）
panActivationKeyCode={isLocked ? null : 'Space'}               // 锁定态空格平移旁路收窄（残留窗口见 §7）
```

全局 CSS 一行（修正本次引入的光标退化，见 §3.2 末条）：

```css
.react-flow__pane.selection.dragging { cursor: grabbing; }
```

### 3.1 `panOnDrag` 三态语义（含约束来源，后人勿"优化"）

| 值 | 行为 | 约束来源 |
|---|---|---|
| `[1]`（常量） | 仅中键拖平移；空格按住时库内升级为左键可平移（react:1993）；中键在节点/边上也能起手平移（system:2824-2828 特例） | **库硬约束：禁用 `[1,2]`**——数组含 2 时右键成为平移按钮（system:2866/:2870），且 `onContextMenu` 直接 `preventDefault()+return`（react:1433-1439），右键单击的菜单路径彻底失效 |
| `true`（参考选择期） | 左键拖平移，保留今天手感 | **项目口味**：D19 验收"参考选择时必须能平移缩放"（2026-09-26 spec:46）保左键手感；`panOnDrag===true` 令 `_selectionOnDrag` 自动失效（:1995）与 `elementsSelectable={false}` 双保险防误框选。（第三份二审建议统一 `[1]`——已考虑：D19 未要求左键，但保留例外仅影响低频模式，维持原拍板） |
| `false`（锁定） | 无拖拽平移；叠加 `panActivationKeyCode=null` 后空格旁路一并关闭 | 锁定语义对齐 annotation-feature.md:86"锁定不可平移/缩放"口径（Ctrl+滚轮缩放旁路仍存，见 §7） |

### 3.2 库内联动（已逐行核实）

- 空格按住 → `panOnDrag` 强制 true（react:1993）→ 左键平移 + 框选自动让位（`_selectionOnDrag = selectionOnDrag && panOnDrag !== true`，:1995）+ pane 挂 `draggable` 类（光标 grab）；**Shift 优先于空格**：ZoomPane 收到 `panOnDrag: !selectionKeyPressed && panOnDrag`（:1998），Shift+空格+左键拖=框选非平移
- **双击空白缩放在 `[1]` 下存活**（已核实推导链）：d3 `dblclicked` 首行过 filter（d3-zoom:303-304），但 xyflow filter 的按钮拦截分支带 `&& event.type === 'mousedown'`（system:2866）——dblclick 类型是 `'dblclick'` 不命中；`buttonAllowed` 中 `!event.button`（button=0）为 true 放行（:2870）→ `zoomOnDoubleClick` 正常
- **框选期间的防误触真来源**：filter 的 `if (userSelectionActive) return false`（system:2834，拖拽中禁全部 d3 缩放/平移）+ Pane `onClickCapture` 的 `selectionInProgress` 守卫（react:1422-1432）。**`clickDistance(Infinity)`（system:2914）与防误触无关**——d3 语义是 `g.moved = dist² > clickDistance²`（d3-zoom:289），Infinity 使 moved 恒 false → `dragEnable(view,false)`（:297）→ **不抑制**拖后 click；本配置下它无可观测影响（左键不进 d3 手势，中键拖后的 click 为 auxclick）
- 框选仅 pane 空白触发：`event.target === container.current`（react:1454）+ Background/viewport 均 `pointer-events:none`（style.css:98-126）→ 节点内 overlay（裁剪/扩图/擦除/标注/Resizer）天然不触发；**Shift 分支例外**：`isSelectionActive = (selectionOnDrag && eventTargetIsContainer) || selectionKeyPressed`（:1457）——Shift 按住时在节点/overlay 上也能起框，这是保留 Shift 路径的隐藏价值（勿当残留删）
- 框选期间 `setPointerCapture` 锁手势（:1461）→ 浮层抢不走；框选逐帧（集合变化时，areSetsEqual 守卫 :1521/:1525）`triggerNodeChanges` 实时改选中态 → §5-1 抑制的根源
- 框选连带选中相连边（:1506-1520）→ Backspace 连边删（今天 Shift 框选已如此，非新增）
- 光标矩阵：空闲 `pointer`（`.selection` 类恒挂，style.css:119）、空格 `grab`、空格拖中 `grabbing`、**中键拖中修正为 `grabbing`**（`.dragging` 与 `.selection` 同特异性 0,2,0，源序 `.selection` 后者恒胜——官方 `panOnDrag=true` 时两类不同挂、从未暴露此组合，属本次引入的副作用，故加 §3 CSS 一行修正）；框选中 `pointer`

## 4. 改后交互矩阵

| 操作 | 行为 |
|---|---|
| 左键拖空白 | 框选（>1px 起框，`paneClickDistance` 默认 1；Partial 相交即选） |
| 单击空白 | 取消选择（`onPaneClick` 路径不变，pointerup 分支 :1544） |
| Shift+左键拖 | 框选（含在节点/overlay 上起框，:1457）；起框阈值 0（`selectionKeyPressed ? 0 : paneClickDistance`，:1487，与主路径 1px 既有不一致，登记） |
| Shift+空格+左键拖 | 框选（Shift 优先于平移，:1998） |
| 空格按住+左键拖 | 平移（光标 grab；框选自动让位） |
| 中键拖 | 平移（含从节点/连线上起手，system:2824；拖中光标 grabbing，见 §3.2） |
| 滚轮/触控板双指滚动 | 缩放 |
| Ctrl+滚轮/双指捏合 | 缩放（库内建；app 层步进删除，§5-3） |
| 空格+滚轮 | 平移（`panOnScroll = panActivationKeyPressed \|\| _panOnScroll` 库内逻辑） |
| 双击空白 | 缩放（`[1]` 下存活，证据链 §3.2） |
| 右键空白 | 上下文菜单（`[1]` 关键前提） |
| Shift+点击节点 | 加选（`multiSelectionKeyCode="Shift"` 不变） |
| 键盘焦点在节点 + Space | **双语义**：切换该节点选中（`elementSelectionKeys=['Enter',' ','Escape']`，system:27）**且**画布进平移态（xyflow 键盘选中与平移激活互不感知；登记可接受） |
| 视频裁剪面板/全屏编辑器打开 + Space | 视频播放/暂停**且**画布进平移态（VideoTrimPanel.tsx:87-92 / useEditorKeyboard.ts:27 的 window keydown `preventDefault` 不阻止 xyflow `useKeyPress`；面板/编辑器不设 activeEditNodeId → isLocked=false；登记可接受） |
| 框选松手后 | `nodesSelectionActive` → 库 NodesSelection 覆盖框渲染（带 nopan，react:1554+:1998）→ 从已选区域内起手拖=拖动选中集而非起新框/平移（官方行为，验收确认） |
| 参考选择期 | 左键拖=平移（`panOnDrag=true`）、节点不可拖/不可选照旧、可缩放 |
| 锁定（节点编辑中） | 上表全关（四 prop 反转：`zoomOnScroll`/`panOnDrag`/`selectionOnDrag`/`panActivationKeyCode=null`，空格旁路**收窄**——"按住空格瞬间锁定翻转"的残留窗口见 §7）；**Ctrl+滚轮缩放仍生效**（库旁路，根治牵 pinch 语义，登记不修）；触控板裸双指无响应、Ctrl+双指可缩放（分裂行为，登记） |

## 5. 配套必修

### 5-1 框选拖拽全程的 UI 抑制（2026-08-24 bug 防回归，覆盖 5 个消费点）

框选实时改选中态（react:1521-1533），拖拽中三类 UI 会闪弹——"恰好框住 1 个节点"瞬间工具条/手柄/配置面板闪现（count===1 中间态）、"框住第 2 个"瞬间 N 项框+打组工具条挂载、2↔1 阈值附近来回闪。库内 `NodesSelection` 的既定模式是 `!userSelectionActive` 才渲染（react:1954）——拖拽期间不渲染、松手才出现，app 侧照此统一。

**不变式（比枚举耐用，实现与验收以此为准）**：框选拖拽期间不挂载任何以 `selected` 为条件的操作浮层（工具条/缩放手柄/配置面板）；选中态**视觉**（节点高亮、组边框 dashed）仍实时更新。

**抑制信号（架构决策）**：`<ReactFlow onSelectionStart onSelectionEnd>`（公开 props；`onSelectionStart` 触发点 react:1493 在第一次 `triggerNodeChanges` 之前同一同步体——标志必然先于选中态变化落入同一 React 批次）+ canvasStore 新增 `marqueeSelecting: boolean`。**不用**库私有字段 `useStore((s)=>s.userSelectionActive)`——公开 props 不依赖库内部 store 形状（私有 API 升级可改名），且 app 自有标志可自行兜底（见下）。注意：`onSelectionEnd` 的复位点与私有字段相同（都在 Pane `onPointerUp`，仅 `isSelectionEnabled` 时挂载，react:1551-1556/:1559）——若 `elementsSelectable` 在拖拽中翻转（进入编辑/参考选择），两者同样失效，**兜底复位因此是必做项而非可选项**。

**必做的稳定性与兜底**：

1. `onSelectionStart`/`onSelectionEnd` 必须 `useCallback` 稳定——FlowRenderer 是 memo（react:2001），内联回调每帧换身份直接击穿
2. **兜底复位（必须）**：marqueeSelecting 为 true 期间 4 类 UI 全部消失且静默无自愈，故复位须三通道幂等并行：`onSelectionEnd` + window `pointerup` + window `blur` + `Escape`（拖拽中切窗口/失焦是现实路径）
3. 实现建议：消费侧合并为单次订阅 `useCanvasStore((s) => s.lastPointerShiftKey || s.marqueeSelecting)`（返回布尔原语，zustand Object.is 相等比较稳定，语义恰为"抑制中"）

**5 个消费点**：

1. `useIsSingleSelected.ts`：`&& !marqueeSelecting`（经 useCanvasStore 订阅）
2. `CanvasView.tsx` `selectedGroup`（L405-416）：同源追加
3. `SelectionBoxOverlay.tsx` geo（L25-26）：`selectedInternal.length >= 2 && !marqueeSelecting` 才给几何体
4. `GroupNode.tsx:41` `GroupNodeResizer`：`selected && !collapsed && !marqueeSelecting`（读原始 selected，不过 useIsSingleSelected——组节点多选时也需要手柄，故不套该 hook，直接加标志）
5. `VideoGenNode.tsx:791` 底部 `VideoConfigPanel`：`!trimMode && selected && !fileId && ...` 追加 `&& !marqueeSelecting`（同为裸 selected 的操作浮层）

**lastPointerShiftKey 保留（并存非替代）**：该 flag 对"左键框选"失效（pointerdown 时 shiftKey=false），但对"Shift+点击节点加选"仍有效（pointerdown 时 shiftKey=true，点击不经框选路径）——`marqueeSelecting` 只覆盖框选进行态，不覆盖 Shift+点击。两者条件并存，删除前者必回归 2026-08-24 bug 的 Shift+点击分支。

### 5-2 快捷键面板同步（KeyboardShortcutsPanel.tsx:128-147）

最终结构（计数断言自洽：`触控板` 全面板 1 次、`鼠标` 2 次，现有测试 getAllByText 计数需同步）：

- 缩放栏：放大 Ctrl+ / 缩小 Ctrl+ / 适应画布 Ctrl+0 / **滚动（滚轮·双指）**（替换原"触控板"行——原双指捏合与新滚轮缩放合并）/ 鼠标（Ctrl+滚轮）
- 移动画布栏：键盘（Space+拖）/ 触控板（空格+双指）/ 鼠标（中键拖）/ 整理画布 Alt+Shift+F
- **新增"框选/多选"条目**：左键拖空白、Shift+点击加选（框选从冷门路径升主路径，面板需闭环）
- icon 映射随文案重排，**人工目视确认**（现有 icon 组件命名与视觉语义存在矛盾，不断言"对调"）

### 5-3 Ctrl+滚轮双 writer 从根消除（CanvasView.tsx:360-374）

现状：document 捕获层 `zoomIn/zoomOut({duration:100})` 与 xyflow 内建 Ctrl 缩放并行写 viewport——今天就双倍缩放。

修法：删 effect 内缩放步进，保留守卫——对画布内（`reactFlowWrapper.contains(target)`）Ctrl/Meta+滚轮 `preventDefault`，deps `[]`。工具栏缩放按钮（L512-513）不受影响。

**守卫理由（修正后）**：xyflow wheel handler 对 nowheel+Ctrl 已自行 `preventDefault`（system:2752-2753，"nowheel 区域整页缩放"不会发生）；守卫真实价值=①覆盖 `#node-toolbar-portal`（.react-flow 兄弟节点，CanvasView:636，d3 wheel 挂 .react-flow 上不可见）②防御性兜底。`preventDefault` 不阻断 d3（d3 不查 defaultPrevented），守卫不损伤库内缩放。

**行为变化（登记+验收）**：守卫从 document 收窄到画布内 → 画布外（侧栏/弹窗/视频编辑器）Ctrl+滚轮恢复浏览器整页缩放；现状是这些区域 Ctrl+滚轮误缩放背后画布（VideoEditorShell 与 CanvasView 为兄弟节点，page.tsx:301/:308）——顺手修掉既有误伤，验收确认。

## 6. 不变项（已核实）

- 节点拖拽/连线/handle 拖拽弹菜单（spec 2026-09-26 §3.3）
- 裁剪/扩图/擦除/标注 overlay：均在节点内 + 带 `nopan`，中键拖其上不平移（system:2846）、不触发框选
- SelectionBoxOverlay portal（#node-toolbar-portal，不在 pane 树内，pointer-events-none 容器）
- @ 提及下拉（CommandMentionList）：经 PromptInput.tsx:65-66 `document.createElement + body.appendChild` 渲染为 **body portal**——既不在 .react-flow 内（库 wheel 监看不到，滚轮原生滚动列表，无需 nowheel），也不在 reactFlowWrapper 内（Ctrl+滚轮其上走浏览器整页缩放，守卫收窄后果，§9-16 一并验收）
- 库 NodesSelection 框**可见**：index.css:225-229 给 `.react-flow__nodesselection-rect` 设了 background+1px dotted 边框（:219 的 fill/stroke:transparent 对 div 渲染是 no-op，注释"仅保留拖拽交互层"与实际不符）→ 框选 ≥2 松手后库框与 app SelectionBoxOverlay **双框重叠**；恰好 1 个只有库框——验收 §9-21 确认接受或按注释意图隐藏库框
- `ProcessSnapshot.tsx`（只读快照页，独立配置，不动）
- **框选不进 undo 栈——真因是结构投影白名单**：`pickStructNodes`（canvasHistory.ts:9-18）与 `storeProjection`（canvasCollabRuntime.ts:59-74）均不含 `selected` → 选中态变化不触发 store→doc 同步、不写 Y.Doc → 不入 Y.UndoManager。**canvasStore.onNodesChange:520 的 `applyNodeChanges` 处理全部变更类型含 select（框选实时改选中态正依赖它）——勿据"防 undo 污染"删改此行**
- MiniMap / CanvasToolbar：ReactFlow 的 children 渲染在 .react-flow 下、与 GraphView（含 pane）同级（react bundle 结构 `…SelectionListener, children, Attribution…`）→ `.react-flow__pane.selection .react-flow__panel`（style.css:287）选择器匹配不到，不受影响
- 双击空白缩放（§3.2 证据链）
- Shift+点击节点加选、2026-08-24 的 Shift+点击抑制（lastPointerShiftKey，§5-1）
- antd 下拉点空白关闭、输入框点空白失焦：pointerup 路径不变；但框选结束会真实派发一次 click（`clickDistance(Infinity)` 不抑制、d3 手势未启动故无抑制器），对 document 级 outside-click 监听的影响**移入验收确认**（§9-17），不预设"照旧"结论

## 7. 登记不修（精准修改原则）

| 项 | 理由 |
|---|---|
| 锁定态 Ctrl+滚轮缩放旁路 | `zoomActivationKeyPressed` 覆盖 `zoomOnScroll=false`（system:2821）；根治需动 `zoomActivationKeyCode` 并牵连 pinch 语义（`zoomOnPinch` 的 ctrlKey wheel 分支），复杂度不匹配；annotation-feature.md:86 口径偏差一并登记 |
| `panActivationKeyCode=null` 残留窗口 | useKeyPress 的 effect 守卫 `if (keyCode !== null)`（react:430）——keyCode 变 null 只摘监听、**不复位** keyPressed。序列"按住空格期间进入锁定（如按住空格点编辑按钮）"→ 平移态残留（光标 grab、左键可拖）直到下次空格键序或 window blur 自愈。可达性低（需按住空格操作 UI），登记 + §9-23 验收，不写合成 keyup hack |
| MultiImageNode.tsx:290 `overflow-auto` 缺 `nowheel` | 既有问题；滚轮语义从"无反应"（被 panOnScroll 吃掉）变"缩放画布"，非本次回归，勿顺手加类 |
| MultiImageConfigPanel.tsx:192 `max-h-40 overflow-y-auto`（容器仅 nodrag nopan） | 同上，滚轮=缩放画布；验收确认体验 |
| MiniMap / CanvasToolbar 上的滚轮 | 二者只有 nopan 无 nowheel、在 .react-flow 内但 pane 外 → 滚轮=缩放画布（沿革从"平移"变"缩放"），§9-24 一并确认 |
| snapGrid={[20,20]} 每帧写 xyflow store | CanvasView.tsx:474 内联数组 + snapGrid **在** fieldsToTrack（react:212）→ StoreUpdater 引用比较每渲染 setState——本文件真正"每帧写库"的是它（既有问题，panOnDrag 反而不在 tracked 表）；与本次同源，单独登记不修 |
| Windows Chrome 中键自动滚动罗盘 | d3 `mousedowned:280` 调用的 `nopropagation` **只有 stopImmediatePropagation、不 preventDefault**（d3 noevent.js 全文：preventDefault 的是 default export noevent，mousemove:286/mouseup:298 才调）→ mousedown 默认行为未被阻止，罗盘**有可能出现**；真机验收（§9-6）决定是否加兜底（wrapper `onMouseDown` 中键 preventDefault，不阻断冒泡不影响 d3） |
| Space 多义键三处（矩阵两行） | 双语义危害有限（平移态只是待命状态），根治需 VideoTrimPanel/编辑器打开时置 `panActivationKeyCode=null`——过度工程；VideoTrimPanel 空格未排除输入域属既有缺陷，不在半径内 |
| 触屏/平板 | selectionOnDrag 对 touch 生效且与 d3 touch 平移两路径打架（单指拖同时平移+框选）；仓库无触屏目标（仅 FileGrid 用 pointer:coarse），登记非目标，不加硬闸 |
| Shift 框选阈值 0 vs 主路径 1px | 既有不一致（:1487），非本次引入 |
| e2e 手势 spec | 仓内 Playwright 门禁（build+preview+API+单 worker）成本不匹配；手势全走 §9 人工验收 |

## 8. 测试策略（TDD）

**主防线=props 契约断言**（精确值，覆盖一切误改取值含 `[1,2]`）；class 派生断言为辅——class 断言能抓**含 0 的误改**（`[0,1]`/`true` → `draggable` 挂 → "无 draggable"断言必红；`selectionOnDrag=false` → `selection` 无 → 必红），但 `[1,2]` 与 `[1]` 的 class 表现相同（均无 `draggable`），须由 props 契约兜住。

1. **props 契约断言**（新建 CanvasView.interaction-props.test.tsx，mock 记录型 ReactFlow 捕获 props——全仓现无任何 panOnDrag/selectionOnDrag 断言，此为净新增防线）：
   - 非锁定：`panOnDrag` 引用===模块常量（值 [1]）、`selectionOnDrag=true`、`zoomOnScroll=true`、`selectionMode=SelectionMode.Partial`、`'panOnScroll' in props === false`（钉死删行而非显式 false）、`panActivationKeyCode='Space'`
   - 锁定（真 useNodeStore.setState）：`panOnDrag=false`、`selectionOnDrag=false`、`zoomOnScroll=false`、`panActivationKeyCode=null`
   - 参考选择期：`panOnDrag===true`
2. **派生 class 断言**（CanvasView.test.tsx，真实渲染）：非锁定 `.react-flow__pane` 有 `selection` 无 `draggable`；锁定两者皆无；`keyDown(window,{key:' ',code:'Space'})` 后 `draggable` 上 `selection` 下（一条断言证"空格平移在+框选让位"，**之后必须 keyUp 复位**防污染）
3. **marqueeSelecting 抑制用例**：
   - useIsSingleSelected.test.tsx：该文件用**真 canvasStore**（仅 mock @xyflow/react），**无需改 mock**——直接 `useCanvasStore.setState({ marqueeSelecting: true })`。用例：标志 true 时单选返回 false、true→false 恢复
   - **必改 mock 清单**（这些文件把 canvasStore mock 成固定对象，缺 `marqueeSelecting` 字段时 selector 取 undefined → `!undefined===true` → 抑制逻辑零覆盖假绿）：CanvasView.test.tsx（:39-57）、CanvasView.theme-perf.test.tsx（:41）、GroupNode.test.tsx（:16）、SelectionBoxOverlay.test.tsx（:24）、ImageGenNode.test.tsx（:109），AudioGen/MultiImage/TextInputNode.test 同步确认
   - CanvasView：`onSelectionStart`/`onSelectionEnd` 接线（触发 store 标志翻转）
   - SelectionBoxOverlay.test：标志 true 时 ≥2 选中不渲染几何体
   - **兜底复位用例（必须）**：`onSelectionStart` 后不发 `onSelectionEnd`、仅派发 window `pointerup`（及 blur）→ `marqueeSelecting` 复位 false——此用例守卫 §5-1 的单点故障面（标志卡 true = 全部工具条/手柄/覆盖层永久消失且无自愈）
4. **面板用例**：§5-2 计数（触控板 1/鼠标 2）+ 新增框选条目断言 + 2026-05-28 spec"22 条目"数字同步
5. **守卫用例**：守卫断言目标=**portal 区域**（#node-toolbar-portal 内 Ctrl+滚轮 `defaultPrevented===true`——这是守卫真实价值所在，nowheel 区已由库自防）；画布外（wrapper 外）Ctrl+滚轮不 preventDefault；既有 3 条 Ctrl/Cmd+滚轮 zoomIn/zoomOut 断言删除、"should NOT zoom on regular wheel" 删除（语义已反）
6. **锁定态用例 afterEach 复位 `activeEditNodeId`**（真 store，防跨用例污染）
7. jsdom 边界（细化）：d3 **drag/zoom 手势不可测**（PointerEvent 丢 button/isPrimary、无布局）；**事件监听链路可触达可测**（dblclick/wheel 走 d3 监听器），但 dblclick 走 zoom.transform 过渡（依赖 rAF/d3-transition，jsdom 不保证同 tick 落地）——若断言 viewport 变更需 waitFor/fake timers，实现期以"监听被触达"为最低口径；**帧级时序不可测**（triggerNodeChanges 与标志置位是否同批）——"无中间帧闪烁"标人工逐帧观测，不写单测

## 9. 浏览器人工验收清单

1. 左键拖空白出虚线框，>1px 起框；**相交即选**（Partial）
2. 单击空白取消选择不误清；框选后 SelectionBoxOverlay 工具栏照常出现
3. 框选经过"恰好 1 个节点"→ 无工具条/缩放手柄闪出；松手后单选正常显示
4. 组节点：框选经过"恰好框住 1 个组"→ **无缩放手柄闪出**（组 dashed 边框随选中实时变化属预期，是选中态视觉非浮层）；松手单选该组 → 手柄正常出现
5. 框选 2+ → N 项框 + 工具条；在 2↔1 阈值附近来回拖动 → 全程不出现、不闪烁；松手后按语义出现
6. 中键拖=平移，拖中光标 grabbing（CSS 修正生效）；Windows Chrome 中键自动滚动罗盘不出现
7. 空格按住光标 grab + 左键拖=平移 + 此时拖拽不框选；松开空格恢复；Shift+空格+左键拖=框选（Shift 优先）
8. 滚轮/双指滚动=缩放；Ctrl+滚轮无双倍跳变（双 writer 已除）；nowheel 区域（节点内文本框/时间轴）Ctrl+滚轮不缩放浏览器页面
9. 双击空白仍缩放；**框选松手后 300ms 内同点再点一次 → 确认不触发意外缩放**（clickDistance 不设防，风险验证）
10. 右键空白出上下文菜单（AddNodeMenu）
11. 参考选择模式：左键拖=平移、不框选；中键/空格可平移；滚轮可缩放；点节点能拾取（D19 口径）
12. 锁定态（节点编辑中）：左键不平移不框选、滚轮不缩放、**空格不平移（旁路已根治）**；Ctrl+滚轮仍可缩放（登记旁路，非缺陷）
13. MiniMap 拖动/点击、CanvasToolbar 按钮、overlay（裁剪/扩图/擦除）拖动、节点内文本框滚动、antd 下拉点空白关闭、点空白输入框失焦——确认照旧（框选结束派发的 click 对 outside-click 的影响属本条验证目标）
14. Space 多义键三连测：a) 键盘焦点在节点按 Space → 选中切换+光标 grab 同时发生（登记项）；b) 视频裁剪面板打开按 Space → 播放/暂停+光标变 grab（登记项）；c) 全屏视频编辑器同 b
15. 触控板专项：双指滚动=缩放、捏合=缩放、空格+双指=平移；确认手感（本次唯一高频手势退化项：平移从双指变为需按空格，产品已拍板接受）
16. 画布外（侧栏/弹窗/视频编辑器/**body portal 类 UI 如 @ 提及下拉**）Ctrl+滚轮 → 恢复浏览器页面缩放（行为变化，确认可接受；视频编辑器内时间轴自身缩放不受损；提及下拉内滚轮=正常滚动列表）
17. 未带 nowheel 的节点内滚动区（MultiImage 展开区、MultiImage 配置面板）滚轮行为确认（=缩放画布，登记体验）
18. 大组覆盖的空白轻拖 2-3px → 观察 Partial 误选大组概率（产品手感确认）
19. 框选后再从已选区域内起手拖拽 → 拖动选中集（官方覆盖框行为，确认可接受）
20. 锁定态触控板：裸双指无响应、Ctrl+双指可缩放（分裂行为，产品确认接受）
21. 框选松手后观察：恰好 1 个节点 / 2+ 个节点 → 库 NodesSelection 框与 app SelectionBoxOverlay 是否**双框重叠**（§6：index.css:225 背景边框生效）——确认接受，或按 index.css:220 注释意图隐藏库框（background/border 置空）
22. 框选经过"恰好 1 个无 fileId 的视频节点"（经中间态）→ 底部 VideoConfigPanel 不闪出（§5-1 消费点 5）
23. **按住空格期间点击进入节点编辑 → 检查锁定态是否仍残留平移态（光标 grab/左键可拖）→ 松开空格或窗口失焦后确认自愈**（§7 panActivationKeyCode 残留窗口，登记非缺陷）
24. MiniMap / CanvasToolbar 上滚轮/双指 → 缩放画布（沿革从平移变缩放，确认可接受）；其上 Ctrl+滚轮行为一并确认

## 10. 同步义务

- D19 spec（2026-09-26-canvas-reference-select-and-style-library-design.md:46）：**不动**——本设计保其"参考选择可平移缩放"口径（第三份二审的统一 `[1]` 建议已考虑并否决）
- 2026-08-24-shift-multiselect-toolbar-suppress.md：§5-1 把抑制源从 1 个（lastPointerShiftKey）扩为 2 个并存（+marqueeSelecting），是该 spec :51 用户确认语义与行为表的扩展——追加同步说明
- annotation-feature.md:86：空格旁路已收窄（残留窗口 §7），口径偏差仅剩 Ctrl+滚轮一项（§7 登记）
- 2026-05-28-canvas-keyboard-shortcuts-panel-design.md:57-59：交互表"触控板平移=双指拖动"与本次滚轮=缩放冲突 → 更新为"空格+双指"；:108-109"22 个条目"数字随新增框选条目核对更新
- KeyboardShortcutsPanel.test.tsx 计数断言随 §5-2 同步

