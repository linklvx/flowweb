# 画布平移/框选交互重构（spec）

- 日期：2026-09-28（同日五修：二至五修逐轮吸收共 12 份外部审核报告全部核实成立项）
- 状态：已确认（设计经五轮外部审核、逐条对照实装源码核实修订）
- 范围：`apps/web/src/pages/canvas/components/CanvasView.tsx` 及其配套（抑制信号、isLocked 双定义、快捷键面板、index.css、测试）
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
// 真实代价在 ZoomPane 的 update effect（react:1337-1377，deps 含 panOnDrag）。
// 每帧重渲染链（完整）：defaultViewport={viewport} 每帧新对象（CanvasView.tsx:451）
// → GraphView memo 失效（react:3130）→ FlowRenderer 重建 children → memo 失效（react:2001）
// → ZoomPane 重渲染 → 内联数组换身份 → effect 重跑 → update() 重建 wheel/start/zoom/end
// 处理器与 filter（system:2909-2986；原生 mousedown.zoom 只在创建时挂一次，非手势正确性问题）。
// 常量使引用稳定 → effect 不重跑（其余 deps 已核实稳定：onPaneContextMenu useCallback([])、
// onTransformChange 库内 useCallback）。
const PAN_ON_DRAG_MIDDLE = [1];  // panOnDrag?: boolean | number[]——number[] 即可，无需标注
// snapGrid 在 fieldsToTrack（react:212）且原为内联（L474）→ 本文件真正每帧写 store 的是它，一并 hoist。
// 必须显式标注 tuple 类型：snapGrid?: SnapGrid = [number, number]（system general.d.ts:163，react index.d.ts:37 有导出），
// hoist 丢失上下文类型后 [20,20] 退化为 number[] → strict 下 TS2322（原内联字面量享上下文类型故通过）。
// as const 不可用（readonly tuple 不可赋可变 tuple）；Object.freeze 同理不可用——防共享引用污染靠注释：
// snapGrid 会 store.setState 进库（与模块常量同一数组），勿原地改写 store.snapGrid。
const SNAP_GRID: SnapGrid = [20, 20];

zoomOnScroll={!isLocked}                                       // 滚轮=缩放（原 false）
// panOnScroll 整行删除（false 即默认值）
panOnDrag={isLocked ? false : inRefSelect ? true : PAN_ON_DRAG_MIDDLE}  // 中键拖=平移
selectionOnDrag={!isLocked}                                    // 左键拖空白=框选（新增）
selectionMode={SelectionMode.Partial}                          // 相交即选（import 枚举；字面量 'partial' 过不了类型检查）
panActivationKeyCode={isLocked ? null : 'Space'}               // 锁定态空格平移旁路收窄（残留窗口见 §7）
// 既有两行 snapToGrid={snapEnabled} / snapGrid={[20,20]}（L473-474）中的内联数组改为 snapGrid={SNAP_GRID}
```

**isLocked 定义修正（transform 根因修，用户拍板；双定义同批改）**：

```ts
// L109（订阅式）——原：const isLocked = activeEditNodeId !== null;
const isLocked = activeEditNodeId !== null || activeTransformNodeId !== null;
// L299-300（命令式，onConnectEnd 内，喂 decideHandleMenu）——同批改同一口径，并刷新其过期注释（L102-103 → L108-109）：
const isLockedNow = useNodeStore.getState().activeEditNodeId !== null
  || useNodeStore.getState().activeTransformNodeId !== null;
```

与 useGroupKeyboard.ts:14 既有"模式中"定义对齐（编辑与 transform 互斥，nodeStore.ts:383）。不修则 transform（旋转/镜像）调整中 `isLocked=false` → 左键拖=框选 → 框选第一帧 `resetSelectedElements()`（react:1492）反选调整中节点 → TransformToolbar（`if (!selected) return null`）中途消失。**只改 L109 漏 L300 会"画布锁了 handle 菜单没锁"**（transform 期 handle 拖拽仍弹菜单）——一处概念两处定义，同批改防口径分裂。handleMenu.ts 是纯函数（isLocked 入参），单测不受影响。

连带效果（方案 A 已拍板，transform 期画布全锁与编辑模式同族）：transform 调整中平移/缩放/框选/空格全关——调整期视线就在节点上、口径统一优先；方案 B（仅 `selectionOnDrag={!isLocked && !inTransform}` 收窄、保留平移缩放）**已考虑否决**：与 useGroupKeyboard"模式中"口径分裂、isLocked 不再等于"模式中"需注释维护。副产物登记：transform 期 `deleteKeyCode=[]`（Backspace 不删节点，行为变化显式接受）、`nodesFocusable=false`（键盘可达性收窄，登记）；旋转/镜像为按钮驱动（TransformToolbar rotation 0|90|180|270 + mirror，ImageGenNode.tsx:1011-1042，无拖拽式旋转控件），不受 `nodesDraggable=false` 影响。

可选优化（登记不做）：`defaultViewport` memo 化可掐断整条每帧重渲染链（ZoomPane 挂载 effect 只读一次，react:1301-1336），非 update() deps，与本常量互不替代。

全局 CSS 一行（修正本次引入的光标退化，见 §3.2 末条）：

```css
.react-flow__pane.selection.dragging { cursor: grabbing; }
```

### 3.1 `panOnDrag` 三态语义（含约束来源，后人勿"优化"）

| 值 | 行为 | 约束来源 |
|---|---|---|
| `[1]`（常量） | 仅中键拖平移；空格按住时库内升级为左键可平移（react:1993）；中键在节点/边上也能起手平移（system:2824-2828 特例） | **库硬约束：禁用 `[1,2]`**——数组含 2 时右键成为平移按钮（system:2866/:2870），且 `onContextMenu` 直接 `preventDefault()+return`（react:1433-1439），右键单击的菜单路径彻底失效 |
| `true`（参考选择期） | 左键拖平移，保留今天手感 | **项目口味**：D19 验收"参考选择时必须能平移缩放"（2026-09-26 spec:46）保左键手感；`panOnDrag===true` 令 `_selectionOnDrag` 自动失效（:1995）与 `elementsSelectable={false}` 双保险防误框选。（第三份二审建议统一 `[1]`——已考虑：D19 未要求左键，但保留例外仅影响低频模式，维持原拍板） |
| `false`（锁定） | 无拖拽平移；叠加 `panActivationKeyCode=null` 后空格旁路一并关闭（残留窗口 §7） | 锁定 = 编辑中 **或 transform 调整中**（§3 isLocked 根因修），语义对齐 annotation-feature.md:86"锁定不可平移/缩放"口径（Ctrl+滚轮缩放旁路仍存，见 §7） |

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
| 锁定（节点编辑中 **或 transform 旋转/镜像调整中**） | 上表全关（四 prop 反转：`zoomOnScroll`/`panOnDrag`/`selectionOnDrag`/`panActivationKeyCode=null`，空格旁路**收窄**——"按住空格瞬间锁定翻转"的残留窗口见 §7）；连带：`deleteKeyCode=[]`（Backspace 不删，显式接受）、`nodesFocusable=false`（键盘可达性收窄，登记）、节点失 selectable 指针光标（锁定态预期）；**Ctrl+滚轮缩放仍生效**（库旁路，根治牵 pinch 语义，登记不修）；触控板裸双指无响应、Ctrl+双指可缩放（分裂行为，登记） |

## 5. 配套必修

### 5-1 框选拖拽全程的 UI 抑制（2026-08-24 bug 防回归，不变式 + 枚举证据）

框选实时改选中态（react:1521-1533 节点/:1525-1527 边），拖拽中 UI 会闪弹——"恰好框住 1 个节点"瞬间工具条/手柄/配置面板闪现、"框住第 2 个"瞬间 N 项框+打组工具条挂载、框到连通节点时边上 × 删除按钮挂载、2↔1 阈值附近来回闪。库内 `NodesSelection` 的既定模式是 `!userSelectionActive` 才渲染（react:1954）——拖拽期间不渲染、松手才出现，app 侧照此统一。

**不变式（实现与验收以此为准）**：框选拖拽期间不挂载任何以 `selected` 为条件的**操作浮层**（工具条/缩放手柄/配置面板/删除按钮）；选中态**视觉**（节点高亮、组边框 dashed、库 selection rect）不在抑制范围、仍实时更新。

**抑制信号（架构决策）**：`<ReactFlow onSelectionStart onSelectionEnd>`（公开 props；`onSelectionStart` 触发点 react:1493 在 `resetSelectedElements`（:1492）与第一次 `triggerNodeChanges`（:1523）之前同一同步体——标志必然先于选中态变化落入同一 React 批次，任何中间帧都是"已抑制"）+ canvasStore 新增 `marqueeSelecting: boolean`。**不用**库私有字段 `useStore((s)=>s.userSelectionActive)`——公开 props 不依赖库内部 store 形状（私有 API 升级可改名），且 app 自有标志可自行兜底（见下）。注意：`onSelectionEnd` 的复位点与私有字段相同（都在 Pane `onPointerUp`，仅 `isSelectionEnabled` 时挂载，react:1551-1556/:1559）——若 `elementsSelectable` 在拖拽中翻转（进入编辑/参考选择），两者同样失效，**兜底复位因此是必做项而非可选项**。

**必做的稳定性与兜底**：

1. `onSelectionStart`/`onSelectionEnd` 用 `useCallback` 稳定——与文件内既有 handler 风格一致；且一旦将来进入 effect deps 可防放大为每帧 update()
2. **兜底复位（必须，标志作用域 + 五通道幂等）**：marqueeSelecting 为 true 期间全部操作浮层消失且静默无自愈，兜底是本设计唯一单点故障面。监听做成**标志作用域**（`useEffect` 依赖 marqueeSelecting，为 true 才挂、复位即卸）——非框选期全 app 点击零常驻开销，卡死时监听恰好处于激活态。通道与性质分级：
   - **主通道**（触发即拖拽必已终止，由定义保证）：`onSelectionEnd` / window `pointerup` / window `pointercancel`（规范语义即"手势被取消"）
   - **补充通道**：window `pointermove` 时 `e.buttons === 0` 即复位——窗口外释放鼠标时各浏览器对 pointerup 的派发行为不一（即便有 pointer capture），`buttons===0` 是"按键已不在按下"的标准判定
   - **次级通道**：window `blur`——**接受极小残留窗口**：拖拽中 alt-tab 失焦（标志被清）→ 回窗口继续同一拖拽，`onSelectionStart` 不会重触发（react:1486 `selectionInProgress` 已 true）→ 抑制解除至松手。性质与 Esc 同类但概率远低（Esc 单键即发、alt-tab 需拖拽中切窗）；不用 Esc（拖拽中单键可发 + 本仓已有 3 个语义：节点键盘取消选中 system:27/快捷键面板关闭/裁剪面板取消）
3. **复位写法（函数式返回同引用，必须）**：`useCanvasStore.setState((s) => (s.marqueeSelecting ? { marqueeSelecting: false } : s))`——zustand 的 `Object.is(nextState, state)` 比较的是 **partial（或函数返回）与整个 state**（vanilla.mjs:4-10 逐字核实：对象字面量部分更新必不等于整库 state → 必通知全部订阅者，**不存在"同值 setState 不通知"**）。函数式无变化时返回原 state 引用 → Object.is 命中 → 不进通知分支，且原子、无 getState→setState 间 TOCTOU。守卫的真实作用是**根本不让 zustand 通知**——裸订阅共 4 处（useCanvasPersistence:116 的 500ms 全量快照写 / canvasCollabRuntime:210 的 O(n) diff / CanvasView:127 / VideoEditorShell:104），每次全 app 点击/切窗都白跑一遍的代价在此
4. **白名单护栏（负向断言，随测试落地）**：`marqueeSelecting` 不得加入 `pickStructNodes` / `storeProjection` / `canvasSnapshot` 任一白名单——除注释禁令外，§8 落负向断言（先例 canvasHistory.test.ts:12）：`pickStructNodes` 结果不含该字段、快照 JSON 键集合固定
5. 实现建议：消费侧合并为单次订阅 `useCanvasStore((s) => s.lastPointerShiftKey || s.marqueeSelecting)`（返回布尔原语，zustand Object.is 相等比较稳定，语义恰为"抑制中"）。**lastPointerShiftKey 不可被 xyflow 原生 `multiSelectionActive` 替代**（已考虑否决）：后者是 Shift 键按下态（react:1238，松开即 false），前者是 pointer 级采样——"先按 Shift 再点节点"与"先点节点再按 Shift"二者表现不同，且 Shift+点击后松键的过渡期抑制只有前者覆盖

**消费点枚举（实现完成的勾选证据）**——枚举命令：

```sh
rg -n "selected &&|if \(!selected\)|selected \?\s" apps/web/src/pages/canvas/components --glob '!*.test.tsx'
```

净产物须逐条处置。**判定判据（枚举产物机械处置的依据）**：浮层的 `selected` 入参来自 `useIsSingleSelected` → 已被消费点 1 覆盖（如 ImageNodeToolbar.tsx:390 的 `if (!selected) return null`，喂值 ImageGenNode.tsx:1040 是 `isSingleSelected`）；来自**裸 selected**（props 直传 / useStore / nodeLookup）→ 必须单独加标志或论证不可达（如 TransformToolbar 靠根因修豁免）——形式相同的两处（ImageNodeToolbar vs TransformToolbar，都是 `if (!selected) return null`）处置相反，凭判据而非凭形式。

1. `useIsSingleSelected.ts`：`&& !marqueeSelecting`（经 useCanvasStore 订阅）——覆盖所有喂 `isSingleSelected` 的工具条（含 ImageNodeToolbar，其内部 `if (!selected) return null` 被喂值已覆盖）
2. `CanvasView.tsx` `selectedGroup`（L405-416）：同源追加
3. `SelectionBoxOverlay.tsx` geo（L25-26）：`selectedInternal.length >= 2 && !marqueeSelecting` 才给几何体
4. `GroupNode.tsx:41` `GroupNodeResizer`：`selected && !collapsed && !marqueeSelecting`（读原始 selected，不过 useIsSingleSelected——组节点多选时也需要手柄）
5. `VideoGenNode.tsx:792` 底部 `VideoConfigPanel`：`!trimMode && selected && !fileId && ...` 追加 `&& !marqueeSelecting`（裸 selected 操作浮层）
6. `ConnectionLine.tsx:107` 边 × 删除按钮：`{selected && <EdgeLabelRenderer>…}` 追加 `&& !marqueeSelecting`——边的选中态同样被框选实时改（react:1525-1527，§3.2"连带选边"），破坏性控件在拖拽途中闪现不可接受
7. `TransformToolbar.tsx:118`（`if (!selected) return null`，ImageGenNode.tsx:1012-1017 喂裸 selected）：**根因修后不在暴露面**（transform 调整中 isLocked=true → selectionOnDrag=false → 无框选可达），不加标志——枚举时注明此项豁免理由
8. `VideoEditNode.tsx:89` 副作用登记（非浮层）：`if (!selected && miniPlaying) stopMini()` ——框选经过又离开播放中节点会停迷你预览；属选中态驱动的既有语义（取消选中即停），**接受不修**，验收 §9-26 确认
9. 纯视觉命中（VideoEditNode.tsx:155 boxShadow、MultiImageNode.tsx:413 边框、NormalGroupRenderer.tsx:45 组 dashed 边框）：选中态视觉，不变式明确不抑制

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
- @ 提及下拉（CommandMentionList / ImageMentionList）：经 body portal 渲染（PromptInput.tsx:65-66 与 :119-129 两处 `document.createElement + body.appendChild`）——既不在 .react-flow 内（滚轮原生滚动列表，无需 nowheel），也不在 reactFlowWrapper 内（Ctrl+滚轮其上走浏览器整页缩放，守卫收窄后果，§9-16 一并验收）
- MiniMap / CanvasToolbar（合并两条证据链，同一结论）：①二者渲染在 .react-flow 下、与 GraphView（其根即 renderer）同级（react bundle 结构 `…GraphView, SelectionListener, children…`）→ `.react-flow__pane.selection .react-flow__panel`（style.css:287）选择器匹配不到；②d3 wheel 挂在 `.react-flow__renderer`（react:1304 domNode + :1378），wheel 冒泡不经 renderer → d3 收不到 → 其上滚轮/双指=**无反应**（panOnScroll 时代同样无反应，沿革两端皆然）；Ctrl+滚轮仍被 wrapper 级守卫 preventDefault、页面不缩放（二者在 wrapper 内）
- 库 NodesSelection 框视觉**本次修掉**（既有缺陷被主路径升格放大暴露）：index.css:219 注释意图白纸黑字"多选视觉由自定义 SelectionBoxOverlay 渲染；内置 selection rect 仅保留拖拽交互层"，但 :219 的 fill/stroke:transparent 对 div 渲染（react:1979）是 no-op，:225-229 的 D2 钉值（background+1px dotted）使库框实际可见 → 与 app 框（带 SELECTION_BOX.padding/titleExtra 外扩，SelectionBoxOverlay.tsx:30-33）形成**错位双虚线框**；且框选恰好 1 个节点时只留库框（app 框要求 ≥2）并持续到下次点击（nodesSelectionActive 维持）。修法：`.react-flow__nodesselection-rect` 从 :225 组合选择器拆出、显式 `background: transparent; border: none;`——拖拽交互层是 div 本身（onContextMenu/onKeyDown/useDrag 挂其上），视觉透明不影响"从已选区域拖动选中集"；**保留 `.react-flow__selection`**（框选拖拽中的虚线反馈）
- `ProcessSnapshot.tsx`（只读快照页，独立配置，不动）
- **框选不进 undo 栈——真因是结构投影白名单**：`pickStructNodes`（canvasHistory.ts:9-18）与 `storeProjection`（canvasCollabRuntime.ts:59-74）均不含 `selected` → 选中态变化不触发 store→doc 同步、不写 Y.Doc → 不入 Y.UndoManager。**canvasStore.onNodesChange:520 的 `applyNodeChanges` 处理全部变更类型含 select（框选实时改选中态正依赖它）——勿据"防 undo 污染"删改此行**
- 双击空白缩放（§3.2 证据链）
- Shift+点击节点加选、2026-08-24 的 Shift+点击抑制（lastPointerShiftKey，§5-1）
- antd 下拉点空白关闭、输入框点空白失焦：pointerup 路径不变；但框选结束会真实派发一次 click（`clickDistance(Infinity)` 不抑制、d3 手势未启动故无抑制器），对 document 级 outside-click 监听的影响**移入验收确认**（§9-17），不预设"照旧"结论

## 7. 登记不修（精准修改原则）

| 项 | 理由 |
|---|---|
| 锁定态 Ctrl+滚轮缩放旁路 | `zoomActivationKeyPressed` 覆盖 `zoomOnScroll=false`（system:2821）；根治需动 `zoomActivationKeyCode` 并牵连 pinch 语义（`zoomOnPinch` 的 ctrlKey wheel 分支），复杂度不匹配；annotation-feature.md:86 口径偏差一并登记 |
| `panActivationKeyCode=null` 残留窗口 | useKeyPress 的 effect 守卫 `if (keyCode !== null)`（react:430）——keyCode 变 null 只摘监听、**不复位** keyPressed，且 **blur/contextmenu 复位监听也在守卫内**（react:465-473）→ **锁定期间零自愈通道**（松空格无 keyup 监听、失焦无 blur 监听）。序列"按住空格期间进入锁定"→ 残留：光标 grab、左键可拖、**滚轮=平移**（`panOnScroll = panActivationKeyPressed \|\| _panOnScroll` 同被置 true，比"编辑中滚轮无响应"更显眼）。残留持续整个锁定会话，**解锁后**（keyCode 回 'Space' 重挂监听）由下一次空格键序或 window blur 清除。可达性低（需按住空格操作 UI），登记 + §9-23 按此口径验收；无监听可派发故无 hack 可写，接受登记 |
| MultiImageNode.tsx:290 `overflow-auto` 缺 `nowheel` | 既有问题；滚轮语义从"无反应"（被 panOnScroll 吃掉）变"缩放画布"，非本次回归，勿顺手加类 |
| MultiImageConfigPanel.tsx:192 `max-h-40 overflow-y-auto`（容器仅 nodrag nopan） | 同上，滚轮=缩放画布；验收确认体验 |
| Windows Chrome 中键自动滚动罗盘 | d3 `mousedowned:280` 调用的 `nopropagation` **只有 stopImmediatePropagation、不 preventDefault**（d3-drag/noevent.js：preventDefault 的是 default export noevent，仅 mousemove:286/mouseup:298 使用）→ mousedown 默认行为未被阻止，罗盘**有可能出现**；真机验收（§9-6）决定是否加兜底（wrapper `onMouseDown` 中键 preventDefault，不阻断冒泡不影响 d3） |
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
   - **消费点 → 覆盖文件对照表**（mock 需照 `mockLastPointerShiftKey` 既有模式加**可变变量 + 字段接线**（CanvasView.test.tsx:15/:41 先例）——补静态 `marqueeSelecting:false` 与不补运行行为相同，零覆盖）：
     | 消费点 | 覆盖文件 | mock 处置 |
     |---|---|---|
     | 1（useIsSingleSelected，含 ImageNodeToolbar） | ImageGenNode.test.tsx:109、AudioGenNode.test.tsx:65、MultiImageNode.test.tsx:60 | 加可变变量 |
     | 2（selectedGroup） | CanvasView.test.tsx:39-57、CanvasView.theme-perf.test.tsx:41 | 加可变变量 |
     | 3（SelectionBoxOverlay） | SelectionBoxOverlay.test.tsx:24 | 加可变变量 |
     | 4（GroupNodeResizer） | GroupNode.test.tsx:16 | 加可变变量 |
     | 5（VideoConfigPanel） | **VideoGenNode.test.tsx:85-96**（state 仅 projectId，清单曾漏） | 加可变变量 |
     | 6（边 × 按钮） | **ConnectionLine.test.tsx:6-12**——mock 是**普通对象形态**（`{ getState }` 非函数），加 `useCanvasStore((s)=>…)` 订阅立刻 TypeError：须先升级为 `Object.assign(vi.fn(selector=>selector(state)), { getState })` 可调用形态（照 CanvasView.test.tsx:36-73 范式）再接可变变量 |
     | 8（VideoEditNode 副作用，接受不修） | VideoEditNode.test.tsx 未 mock canvasStore（真 store） | 无需改 |
     TextInputNode.test.tsx 同为真 store，不在清单
   - CanvasView：`onSelectionStart`/`onSelectionEnd` 接线（触发 store 标志翻转）
   - SelectionBoxOverlay.test：标志 true 时 ≥2 选中不渲染几何体
   - **兜底复位用例（必须）**：`onSelectionStart` 后不发 `onSelectionEnd`、仅派发 window `pointerup`/`pointercancel`/`pointermove(buttons===0)` → `marqueeSelecting` 复位 false——守卫 §5-1 单点故障面；并断言标志已 false 时再派发 window pointerup **不通知** canvasStore 订阅者（函数式同引用守卫——该断言在"普通 setState 实现"下必红，恰好钉死 §5-1.3 写法）
   - **负向护栏断言（§5-1.4）**：`pickStructNodes` 结果不含 `marqueeSelecting`；`useCanvasPersistence` 快照 JSON 键集合固定（先例 canvasHistory.test.ts:12）
   - **theme-perf 断言**：viewport 变更不触发 store 写（本次 hoist SNAP_GRID 正为它）仍成立
   - **isLocked transform 用例**：`activeTransformNodeId` 置位 → props 与派生 class 均呈锁定态（与 activeEditNodeId 同口径，§3 根因修的回归防线）；`decideHandleMenu` 收到的 `isLocked` 在 transform 期同样为 true（双定义同口径的回归防线）
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
12. 锁定态（节点编辑中 / transform 旋转镜像调整中，§3 根因修后同口径）：左键不平移不框选、滚轮不缩放、空格不平移（正常路径已收窄；"按住空格进锁定"的残留窗口按第 23 条单独验）；Ctrl+滚轮仍可缩放（登记旁路，非缺陷）
13. MiniMap 拖动/点击、CanvasToolbar 按钮、overlay（裁剪/扩图/擦除）拖动、节点内文本框滚动、antd 下拉点空白关闭、点空白输入框失焦——确认照旧（框选结束派发的 click 对 outside-click 的影响属本条验证目标）
14. Space 多义键三连测：a) 键盘焦点在节点按 Space → 选中切换+光标 grab 同时发生（登记项）；b) 视频裁剪面板打开按 Space → 播放/暂停+光标变 grab（登记项）；c) 全屏视频编辑器同 b
15. 触控板专项：双指滚动=缩放、捏合=缩放、空格+双指=平移；确认手感（本次唯一高频手势退化项：平移从双指变为需按空格，产品已拍板接受）
16. 画布外（侧栏/弹窗/视频编辑器/**body portal 类 UI 如 @ 提及下拉**）Ctrl+滚轮 → 恢复浏览器页面缩放（行为变化，确认可接受；视频编辑器内时间轴自身缩放不受损；提及下拉内滚轮=正常滚动列表）
17. 未带 nowheel 的节点内滚动区（MultiImage 展开区、MultiImage 配置面板）滚轮行为确认（=缩放画布，登记体验）
18. 大组覆盖的空白轻拖 2-3px → 观察 Partial 误选大组概率（产品手感确认）
19. 框选后再从已选区域内起手拖拽 → 拖动选中集（官方覆盖框行为，确认可接受）
20. 锁定态触控板：裸双指无响应、Ctrl+双指可缩放（分裂行为，产品确认接受）
21. 框选松手后（1 个 / 2+ 个节点）：确认**单一框**（app SelectionBoxOverlay；库框视觉已按 §6 修掉）且拖动选中集正常；恰好 1 个节点时确认无残留库框
22. 框选拖拽经过无 fileId 的视频节点 → 底部 VideoConfigPanel 不闪出（§5-1 消费点 5）
23. **残留窗口口径（§7）**：按住空格 → 点编辑按钮进入锁定 → 确认锁定态残留平移态（光标 grab/左键可拖/**滚轮=平移**）且**锁定期间不自愈**（松空格、切窗均无效，登记非缺陷）→ 退出编辑解锁后再按一次空格或切窗 → 确认自愈
24. MiniMap / CanvasToolbar 上滚轮/双指 → **无反应**（事件不经 .react-flow__renderer，§6；沿革两端皆无反应）；其上 Ctrl+滚轮被守卫 preventDefault、页面不缩放，一并确认
25. 框选拖拽经过有连通边的节点 → 边上 × 删除按钮不闪出（§5-1 消费点 6）；松手后选中含边时按钮正常出现
26. 迷你播放中的 VideoEditNode 被框选经过又离开 → 播放停止属既有选中语义（§5-1 消费点 8，接受不修），确认无其他异常
27. transform（旋转/镜像）调整中（方案 A 口径，与编辑模式同族）：**画布不可平移/不可缩放/不可框选/空格无效**（期望如此，非缺陷）；TransformToolbar 旋转/镜像按钮与保存/取消正常可用（按钮驱动，不受 nodesDraggable=false 影响）、TransformToolbar 不因画布操作消失（§3 根因修）；handle 拖拽不弹菜单（双定义同口径）；节点失去 selectable 指针光标属锁定态预期；transform 期 Backspace 不删节点（显式接受的行为变化）；退出 transform 后画布交互恢复

## 10. 同步义务

- D19 spec（2026-09-26-canvas-reference-select-and-style-library-design.md:46）：**不动**——本设计保其"参考选择可平移缩放"口径（第三份二审的统一 `[1]` 建议已考虑并否决）
- 2026-08-24-shift-multiselect-toolbar-suppress.md：§5-1 把抑制源从 1 个（lastPointerShiftKey）扩为 2 个并存（+marqueeSelecting）且抑制面扩到边/组/配置面板，是该 spec :51 用户确认语义与行为表的扩展——追加同步说明
- annotation-feature.md:86：锁定口径扩为"编辑中或 transform 调整中"（§3 根因修）；空格旁路已收窄（残留窗口 §7），口径偏差仅剩 Ctrl+滚轮一项（§7 登记）
- 2026-05-28-canvas-keyboard-shortcuts-panel-design.md:57-59：交互表"触控板平移=双指拖动"与本次滚轮=缩放冲突 → 更新为"空格+双指"；:108-109"22 个条目"数字随新增框选条目核对更新
- KeyboardShortcutsPanel.test.tsx 计数断言随 §5-2 同步

