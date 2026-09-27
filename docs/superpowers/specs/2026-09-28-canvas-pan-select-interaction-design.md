# 画布平移/框选交互对齐 xyflow 官方默认（spec）

- 日期：2026-09-28
- 状态：已确认（设计经两轮外部审核逐条核实修订）
- 范围：`apps/web/src/pages/canvas/components/CanvasView.tsx` 及其配套（抑制 hook、快捷键面板、测试）
- 库版本依据：@xyflow/react@12.10.2 / @xyflow/system@0.0.76（实装源码逐行核实）

## 1. 背景与目标

当前画布：左键拖空白=平移（`panOnDrag={!isLocked}`）、滚轮=平移（`panOnScroll` + `zoomOnScroll={false}`）、Shift+左键拖=框选（`selectionKeyCode` 默认 Shift）。

目标（用户需求原文映射）：

1. 平移画布改为 xyflow 官方默认触发方式：**空格+左键拖**、**鼠标中键拖**（左键直接拖不再是平移）
2. **左键拖空白=框选**（不再需要 Shift）
3. 滚轮改为**缩放**（用户拍板：全面对齐官方默认）
4. 框选判定 = **Partial 相交即选**（用户拍板；今天 Shift 框选为默认 Full 完全套住）

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
zoomOnScroll={!isLocked}                                  // 滚轮=缩放（原 false）
// panOnScroll 整行删除（false 即默认值）
panOnDrag={isLocked ? false : inRefSelect ? true : [1]}   // 中键拖=平移（原 !isLocked 左键平移）
selectionOnDrag={!isLocked}                               // 左键拖空白=框选（新增）
selectionMode={SelectionMode.Partial}                     // 相交即选（需 import 枚举；字面量 'partial' 过不了类型检查）
```

### 3.1 `panOnDrag` 三态语义（含源码依据，后人勿"优化"）

| 值 | 行为 | 依据 |
|---|---|---|
| `[1]` | 仅中键拖平移；空格按住时库内升级为左键可平移（`panOnDrag = panActivationKeyPressed \|\| _panOnDrag`，react/index.js:1993） | **禁用 `[1,2]`**：数组含 2 时 `onContextMenu` 直接 `preventDefault()+return`（react/index.js:1432-1438），右键菜单（AddNodeMenu）会死 |
| `true`（参考选择期） | 左键拖平移，保留今天手感 | D19 验收口径"参考选择时必须能平移缩放"（2026-09-26 spec:46）；且 `panOnDrag===true` 令 `_selectionOnDrag` 自动失效（:1995），与 `elementsSelectable={false}` 双保险防误框选 |
| `false`（锁定） | 无拖拽平移 | 与现状逐值一致 |

### 3.2 库内联动（已核实，非本项目代码）

- 空格按住 → `panOnDrag` 强制 true → 左键平移 + 框选自动让位（`_selectionOnDrag = selectionOnDrag && panOnDrag !== true`，:1995）+ pane 光标 grab
- `selectionOnDrag=true` → d3 `clickDistance(Infinity)`（system/index.js:2914）→ 框选拖拽后不误触双击缩放
- 框选仅 pane 空白触发：`event.target === container.current`（:1454）→ 节点内 overlay（裁剪/扩图/擦除/标注/Resizer）天然不触发
- 框选期间 `setPointerCapture` 锁手势（:1461）→ 中途弹出的浮层抢不走
- 框选逐帧 `triggerNodeChanges` 实时改选中态（:1500-1530）→ 见 §5 P1-1 抑制
- 框选连带选中相连边（:1506-1520）→ Backspace 连边删（今天 Shift 框选已如此，非新增）
- 光标：非锁定空闲 `.react-flow__pane.selection{cursor:pointer}`（style.css:119，原 grab）；空格=grab、拖中=grabbing。接受官方行为，不做 CSS 覆盖

## 4. 改后交互矩阵

| 操作 | 行为 |
|---|---|
| 左键拖空白 | 框选（>1px 起框，`paneClickDistance` 默认 1；Partial 相交即选） |
| 单击空白 | 取消选择（`onPaneClick` 路径不变，pointerup 分支 :1544） |
| Shift+左键拖 | 框选（`selectionKeyCode` 默认 Shift 保留，无冲突） |
| 空格按住+左键拖 | 平移（光标 grab；此时框选自动让位） |
| 中键拖 | 平移 |
| 滚轮/触控板双指滚动 | 缩放 |
| Ctrl+滚轮/双指捏合 | 缩放（库内建；app 层步进删除，见 §5-3） |
| 空格+滚轮 | 平移（`panOnScroll = panActivationKeyPressed \|\| _panOnScroll` 库内逻辑） |
| 双击空白 | 缩放（`zoomOnDoubleClick={!isLocked}` 保留） |
| 右键空白 | 上下文菜单（`[1]` 关键前提） |
| Shift+点击节点 | 加选（`multiSelectionKeyCode="Shift"` 不变） |
| 参考选择期 | 左键拖=平移（`panOnDrag=true`）、节点不可拖/不可选照旧、可缩放 |
| 锁定（节点编辑中） | 上表全关（四 prop 反转）；**空格平移与 Ctrl+滚轮缩放仍生效**（库内置旁路，现状既有，登记不修） |

## 5. 配套必修（不做则回归 bug / 文档失真）

### 5-1 框选中间态工具条抑制（2026-08-24 bug 防回归）

框选实时改选中态，拖拽经过"恰好框住 1 个节点"瞬间 count===1，若不抑制则节点工具条/缩放手柄闪弹——正是 2026-08-24 spec:28-29 用 `lastPointerShiftKey` 修掉的场景。左键框选成为主路径后该 flag 恒 false，抑制完全失效。

修法：

- `useIsSingleSelected.ts`：新增订阅 xyflow 内部 store `const userSelectionActive = useStore((s) => s.userSelectionActive)`（保持既有 number selector 相等比较优化），返回条件追加 `&& !userSelectionActive`
- `CanvasView.tsx` `selectedGroup`（L405-416）同源追加该条件（经 `useStore` 订阅取值，勿命令式读取）
- 效果：框选中不弹；松手后（`userSelectionActive=false`）按原语义恢复

### 5-2 快捷键面板同步（KeyboardShortcutsPanel.tsx:128-147）

现文案登记"移动画布=触控板（滚轮平移）"，滚轮改缩放后失真。改后：

- 移动画布：键盘 Space+拖 / 鼠标 中键拖 / 触控板 空格+双指
- 缩放：新增"滚动（滚轮·双指）"；保留 Ctrl+滚轮、Ctrl+0
- 顺带修 L143-144 对调的 icon key（触控板行现用 `mousePan`、鼠标行现用 `touchpadPan`——就在本次改动行内）
- `KeyboardShortcutsPanel.test.tsx` 同步（触控板计数 2→1、鼠标保持 2、新增滚动行断言）

### 5-3 Ctrl+滚轮双 writer 从根消除（CanvasView.tsx:360-374）

现状：document 捕获层 `zoomIn/zoomOut({duration:100})` 与 xyflow 内建 Ctrl 缩放（filter `zoomScroll = zoomActivationKeyPressed || zoomOnScroll`，system:2821）并行写 viewport——**今天就双倍缩放**。滚轮轴变为缩放主路径后该问题被放大。

修法：删 effect 内 `zoomIn/zoomOut` 步进，保留守卫——只对画布内（`reactFlowWrapper.current.contains(target)`）Ctrl/Meta+滚轮 `preventDefault`（nowheel 区域如节点内文本框/视频时间轴，xyflow filter 返回 false 不处理，无守卫会触发浏览器整页缩放）。deps 变 `[]`。工具栏缩放按钮（L512-513）不受影响。

既有测试处置（CanvasView.test.tsx:117-160）：3 条 Ctrl/Cmd+滚轮 zoomIn/zoomOut 断言删除（jsdom 不可观测 xyflow 侧缩放）；新增"画布内 Ctrl+滚轮 → `defaultPrevented===true`"与"画布外 → 不 preventDefault"两条；"should NOT zoom on regular wheel" 用例删除（滚轮语义已反）。

## 6. 不变项（已核实不受影响）

- 节点拖拽/连线/handle 拖拽弹菜单（spec 2026-09-26 §3.3）
- 裁剪/扩图/擦除/标注 overlay：均在节点内，`eventTargetIsContainer` 不成立，天然不触发框选；且 overlay 带 `nopan`，中键拖其上不平移
- SelectionBoxOverlay（portal 到 #node-toolbar-portal，不在 pane 树内）
- `ProcessSnapshot.tsx`（只读快照页，独立配置，不动）
- 框选不进 undo 栈（canvasStore.onNodesChange 只处理 remove/position/dimensions）
- MiniMap / CanvasToolbar（渲染在 pane 外，`.react-flow__pane.selection .react-flow__panel` 选择器匹配不到）
- antd 下拉点空白关闭、输入框点空白失焦（pointerup 路径不变）

## 7. 登记不修（精准修改原则）

| 项 | 理由 |
|---|---|
| 锁定态空格平移 / Ctrl+滚轮缩放旁路 | 库内置（`panActivationKeyPressed`/`zoomActivationKeyPressed` 覆盖 false），现状既有非本次引入；annotation-feature.md:86"锁定不可平移缩放"口径与现实的偏差一并登记。要禁需 `panActivationKeyCode={isLocked ? null : 'Space'}`，属额外范围 |
| MultiImageNode.tsx:289 `overflow-auto` 缺 `nowheel` | 既有问题；滚轮改缩放后该区域滚轮=缩放画布（原来被 panOnScroll 吃掉同样滚不动），非本次回归，勿顺手加类 |
| Windows Chrome 中键自动滚动 | d3 mousedown 不 preventDefault；真机验收若出现，兜底 wrapper `onMouseDown` 中键 `preventDefault()`（不阻断冒泡，不影响 d3 平移），先实测再决定 |
| 触屏/平板单指拖拽 | selectionOnDrag 对 touch 生效（单指拖从平移变框选），且 d3 touch 平移路径并行，两路径打架；仓库无触屏专有代码，桌面优先，非目标 |

## 8. 测试策略（TDD）

props 断言自证（断言自己写的字面量），只当 wiring 防回退；主证据是走库内真实推导的派生 class 断言——谁把 `panOnDrag` 写回 true/[0,1]，框选静默关死时必红。

1. **派生 class 断言**（CanvasView.test.tsx，真实渲染骨架现成）：
   - 非锁定：`.react-flow__pane` 有 `selection` 类、无 `draggable` 类（:1558-1559 推导）
   - 锁定（`useNodeStore.setState({ activeEditNodeId: 'n1' })`，真 store）：两者皆无
   - `fireEvent.keyDown(window, { key: ' ', code: 'Space' })` 后：`draggable` 上、`selection` 下——一条断言同时证明"空格平移在 + 框选让位"
2. **props 契约断言**（新建 CanvasView.interaction-props.test.tsx，mock 记录型 ReactFlow 捕获 props）：非锁定 `panOnDrag=[1]`、`selectionOnDrag=true`、`zoomOnScroll=true`、`selectionMode=SelectionMode.Partial`、`panOnScroll===undefined`；锁定反转（`panOnDrag=false` 等）；参考选择期 `panOnDrag=true`
3. **P1-1 抑制用例**：useIsSingleSelected.test.tsx 扩展——`userSelectionActive=true` 时单选返回 false、true→false 恢复
4. **面板文案用例**：§5-2 同步
5. **守卫用例**：§5-3 两条
6. jsdom 测不了 d3 手势（PointerEvent 丢 button/isPrimary、无布局，仓内 2026-08-24 spec:186 既有结论）→ 手势级全走 §9 人工验收，不加 e2e（playwright 门禁 build+preview 成本不划算）

## 9. 浏览器人工验收清单

1. 左键拖空白出虚线框，>1px 起框；**相交即选**（Partial）
2. 单击空白取消选择不误清；框选后 SelectionBoxOverlay 工具栏照常出现
3. 框选经过"恰好 1 个节点"→ 无工具条/缩放手柄闪出；松手后单选正常显示
4. 框选 2+ → N 项框 + 工具条；单节点工具条无残留
5. 中键拖=平移；观察 Windows Chrome 中键自动滚动罗盘是否出现（兜底方案见 §7）
6. 空格按住光标 grab + 左键拖=平移 + 此时拖拽不框选；松开空格恢复
7. 滚轮/双指滚动=缩放；Ctrl+滚轮无双倍跳变（双 writer 已除）；nowheel 区域（节点内文本框/时间轴）Ctrl+滚轮不缩放浏览器页面
8. 双击空白仍缩放；框选拖拽后快速双击无误缩放
9. 右键空白出上下文菜单（AddNodeMenu）
10. 参考选择模式：左键拖=平移、不框选；中键/空格可平移；滚轮可缩放；点节点能拾取（D19 口径）
11. 锁定态（节点编辑中）：左键不平移不框选、滚轮不缩放；空格平移/Ctrl+滚轮缩放仍可（登记旁路，非缺陷）
12. MiniMap 拖动/点击、CanvasToolbar 按钮、overlay（裁剪/扩图/擦除）拖动、节点内文本框滚动、antd 下拉点空白关闭、点空白输入框失焦——全部照旧
13. 框选含相连边 → Backspace 连边删（产品确认接受）

## 10. 同步义务

- D19 spec（2026-09-26-canvas-reference-select-and-style-library-design.md:46）：**不动**——本设计保其"参考选择可平移缩放"口径
- annotation-feature.md:86：登记旁路口径偏差（§7），不改文档
- 快捷键相关旧 spec 若登记滚轮平移，随 §5-2 一并核对更新

