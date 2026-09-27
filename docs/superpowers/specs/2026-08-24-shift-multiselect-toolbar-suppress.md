# Spec: Shift 多选操作抑制节点悬浮工具条

日期：2026-08-24（v3，两轮外部评审逐条对照项目实际核验吸收）
状态：待确认

## 背景

用户报告（浏览器实测复现）：画布 2 个图片节点，Shift+左键选择图片节点时，第一个被选中的节点会弹出自身激活态悬浮工具条。多选意图下不应弹出。

上次 spec（2026-08-23-group-bugs-fix.md Bug A）已修复 count≥2 时工具条残留（`useIsSingleSelected`），本次是其**残余中间态场景**：多选操作刚开始、第一个节点被选中时，画布选中数瞬间为 1，满足 `count===1` 判定，工具条误弹。

## 根源（实测证据）

工具条显示判定链路（5 种节点统一）：

```
ImageGenNode.tsx:77 / MultiImageNode.tsx:77 / TextInputNode.tsx:30 /
AudioGenNode.tsx:20 / VideoGenNode.tsx:62
  → useIsSingleSelected(selected)  (hooks/useIsSingleSelected.ts:8)
    = selected && 全画布 selected 数 === 1
```

该判定无法区分两种语义：

| 场景 | 选中数 | 判定结果 | 期望 |
|------|--------|----------|------|
| 普通单击节点 | 1 | true → 弹出 | 弹出 ✓ |
| Shift+点击第一个节点 | 1（瞬间） | true → 弹出 | **不弹 ✗（本 Bug）** |
| Shift+框选套住第一个节点 | 1（拖拽中间态） | true → 弹出 | **不弹 ✗（本 Bug）** |
| Shift 加选第二个节点后 | 2 | false → 不弹 | 不弹 ✓（上次已修） |

浏览器复现记录（2026-08-24，PointerEvent 模拟）：

- 清空选中 → Shift+pointerdown 第一个 imageGen 节点 → `{selectedCount:1, toolbarVisible:true}` → Bug 复现。

### 同类判定点全局排查结论（评审 P2-3，已核实）

| 判定点 | 位置 | 处置 |
|--------|------|------|
| 节点工具条/resize 手柄/上传按钮 | `useIsSingleSelected`（5 种节点组件） | 本方案统一修复 |
| GroupToolbar 显示判定 | CanvasView.tsx:311-319 `selectedGroup`（自算 count===1） | 一并修复（用户已确认） |
| EditToolbar / TransformToolbar / AnnotationToolbar | 走 editMode/transformMode 编辑态 | 无需改 |
| 节点选中边框 | 节点容器 inline style | 无需改（视觉选中态应保留） |

无其他遗漏（grep `count === 1` / `length === 1` / `filter(selected)` 全量核实）。

## 修复方案

**核心：把「Shift 实时按下」升级为「最近一次画布指针按下是否带 Shift 修饰」的持久标志。**

用户确认的交互语义：只要最近一次选中操作由 Shift 参与，即使松开 Shift 后画布只剩 1 个选中节点，工具条也不弹出；直到普通（无 Shift）单击重新选中才恢复弹出。

> **2026-09-28 同步**（canvas-pan-select-interaction spec §10）：抑制源从 1 个（lastPointerShiftKey）扩为 2 个并存（+`marqueeSelecting`=框选拖拽进行态），抑制面扩至边 × 删除按钮、组缩放手柄、SelectionBoxOverlay、VideoConfigPanel。两者并存非替代：前者覆盖 Shift+点击加选（pointerdown 级采样），后者覆盖左键框选拖拽；删除任一必回归对应分支的中间态误弹。

### 1. canvasStore 新增状态

```ts
lastPointerShiftKey: boolean  // 初始 false；最近一次画布内主键 pointerdown 的 shiftKey
```

同步更新 canvasStore 的 State 接口定义与初始 state（`lastPointerShiftKey: false`），TS 严格模式下缺一即报错。

命名说明（评审 P2-2 核验后不采纳泛化）：产品当前仅支持 Shift 多选（`multiSelectionKeyCode="Shift"`，CanvasView.tsx:357），无 Cmd/Ctrl 加选路径，按 YAGNI 保持具名 `lastPointerShiftKey`；未来若支持 Cmd/Ctrl 再泛化。

### 2. CanvasView 安装捕获阶段 pointerdown 监听（评审 P1-1/P1-2/P2-1/P2 吸收）

```ts
useEffect(() => {
  const wrapper = reactFlowWrapper.current;
  if (!wrapper) return;
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;  // 仅主键：右键/中键不改选中，不应动 flag
    const target = e.target;
    // Element（含 SVGElement）：节点标题图标/波形等 SVG 目标也需采样；仅排除文本节点等非 Element
    if (!(target instanceof Element)) return;
    // 事件目标必须在 .react-flow 容器内：
    // node-toolbar-portal 挂载在 </ReactFlow> 之后、wrapper 之内（CanvasView.tsx:510-514），
    // 绑 wrapper 时靠此判定隔离 portal——工具条按钮点击不更新 flag。
    if (!target.closest('.react-flow')) return;
    // 排除画布内非选中交互控件（点击它们不改变节点选中，不应重置 flag）：
    // - MiniMap（React Flow 内置类）
    // - CanvasToolbar（项目自定义缩放/吸附按钮组，渲染在 .react-flow 内，无内置类 → 需加 id）
    if (target.closest('.react-flow__minimap, #canvas-toolbar')) return;
    useCanvasStore.setState({ lastPointerShiftKey: e.shiftKey });
  };
  wrapper.addEventListener('pointerdown', onPointerDown, { capture: true });
  return () => wrapper.removeEventListener('pointerdown', onPointerDown, { capture: true });
}, []);
```

要点：

- **绑 wrapper（组件自身根 div ref）而非 querySelector('.react-flow')**（二轮评审 P2 采纳）：wrapper ref 在首次 effect 时必然存在，不依赖 ReactFlow 内部 DOM 的挂载时序；.react-flow 归属改为运行时 `closest` 判定。当前项目 CanvasView/ReactFlow 均无条件渲染（page.tsx:295、CanvasView.tsx:338），此为消除隐式时序耦合的等价加固，非功能变更。
- **capture 阶段**：先于 React Flow 内部 d3-drag 处理，flag 在选中状态应用前同步写入（zustand setState 同步）。
- **cleanup 必须**（一轮评审 P1-3）：项目启用 React.StrictMode（main.tsx:7），dev 下 effect 双挂载，卸载时移除监听。
- **CanvasToolbar 根 div 需加 `id="canvas-toolbar"`**（一行）：一轮评审建议的 `.react-flow__controls/.react-flow__panel` 在本项目不存在（CanvasToolbar 为自定义绝对定位 div，CanvasToolbar.tsx:48）。单画布实例下 id 即可（二轮评审 P3 同结论，YAGNI）。

### 3. useIsSingleSelected 融合标志

```ts
const lastPointerShiftKey = useCanvasStore((s) => s.lastPointerShiftKey);  // 订阅，触发重渲染
return !!selected && selectedCount === 1 && !lastPointerShiftKey;
```

自定义 hook 体内 selector 订阅，无 deps 问题。

### 4. CanvasView selectedGroup 同步融合（二轮评审 P1：必须订阅 + 加入 deps）

```ts
// 1. 组件级订阅（触发重渲染）
const lastPointerShiftKey = useCanvasStore((s) => s.lastPointerShiftKey);

// 2. memo 判定融合 + deps 必须加入（现状 CanvasView.tsx:311-319 deps 仅 [nodes]）
const selectedGroup = useMemo(() => {
  let count = 0;
  for (const n of nodes) {
    if (!n.selected) continue;
    count++;
    if (count > 1) return undefined;
  }
  return count === 1 && !lastPointerShiftKey
    ? nodes.find((n) => n.type === 'group' && n.selected)
    : undefined;
}, [nodes, lastPointerShiftKey]);
```

**订阅是功能正确性要求，非仅 ESLint 规范**：场景「Shift+点击组 A（flag=true，GroupToolbar 隐藏）→ 普通单击 A」——A 已是唯一选中，React Flow 的 selected true→true 可能不产生 nodes 引用变化；若不订阅 flag，memo 永不重算，GroupToolbar「恢复弹出」路径失效。`useIsSingleSelected` 同理由（「Shift+点节点 → 普通再点同节点 → 工具条恢复」依赖 flag 订阅触发重渲染）。

### 时序正确性（评审第二节核验结论）

- 单击选中：pointerdown(capture, flag 写入) → d3-drag 选中写入 → React 18 原生事件内自动批处理合并渲染，无中间帧。
- 框选：pointerdown(capture) 先于所有 pointermove（选中数 0→N 变化），全程 flag=true。
- 三种路径均不出现 `count===1 && flag=false` 的中间渲染帧，无工具条闪现。

## 行为矩阵（修复后）

| 操作序列 | 选中数 | flag(lastPointerShiftKey) | 工具条 |
|----------|--------|---------------------------|--------|
| 普通单击节点 | 1 | false | 弹出 |
| Shift+点击节点 A | 1 | true | 不弹 |
| 上行后松开 Shift（仍只选 A） | 1 | true | **不弹（用户确认）** |
| Shift+点击 A → Shift+点击 B | 2 | true | 不弹 |
| Shift+框选（全程） | 1→N | true | 全程不弹 |
| 多选态后普通单击某节点 | 1 | false | 弹出 |
| Shift+点 A 后普通单击同一节点 A（选中态不变） | 1 | true→false | **弹出（恢复路径，依赖 flag 订阅）** |
| 普通点击空白清空 | 0 | false | 无（count=0） |
| flag=true 后点击 MiniMap/缩放按钮 | 不变 | 不变（已排除） | 不受影响 |
| 带 Shift 点工具条按钮（portal 在 .react-flow 外） | 不变 | 不变 | 不受影响 |
| 右键/中键画布 | 不变 | 不变（button 过滤） | 不受影响 |
| Shift+点击节点内 SVG（标题图标/波形） | 1 | true | 不弹（实现期评审补充：SVGElement 非 HTMLElement 子类，需 instanceof Element） |

## 范围外（本次不改）

- 键盘选中（nodesFocusable + Space/Enter）不走 pointerdown，flag 不更新——若之前 flag=true，键盘单选后工具条暂不弹，边缘场景可接受。后续如需补：键盘选中处理中显式 `setState({ lastPointerShiftKey: false })`。
- macOS Cmd / Windows Ctrl 加选：产品未配置（multiSelectionKeyCode="Shift"），不做。

## 测试计划（TDD）

### 1. useIsSingleSelected.test.tsx 扩展

| 场景 | count | selected | flag | 期望 |
|------|-------|----------|------|------|
| 回归：单选无 flag | 1 | true | false | true |
| 新：单选 + flag | 1 | true | true | false |
| 边界：count=0 + flag | 0 | true | true | false |
| 回归：count=2 | 2 | true | true | false |
| flag true→false 恢复 | 1 | true | true→false | false→true |

### 2. pointerdown 监听单测（CanvasView 层提取 hook 或直接测 CanvasView）

- `.react-flow` 内主键 shiftKey pointerdown → flag=true
- `.react-flow` 内主键无 shift pointerdown → flag=false
- 非主键（button=2）→ flag 不变（P2-1）
- `.react-flow__minimap` / `#canvas-toolbar` 内 dispatch → flag 不变（P1-1）
- **时序锁定**：同一目标再注册 bubble 阶段监听读 flag，断言 capture 写入先于 bubble 读取（本方案核心保证）
- cleanup：unmount 后 dispatch → flag 不变（P1-3）
- portal（.react-flow 外）dispatch → flag 不变（P1-2）

### 3. 组件级

- ImageGenNode：selected + count=1 + flag=true → ImageNodeToolbar 不渲染
- ImageGenNode 接线回归（二轮评审 P3）：selected + count=1 + flag=false → ImageNodeToolbar **正常渲染**（防 hook 接线错误导致工具条永不显示）
- GroupToolbar：selectedGroup 场景 flag=true → 不渲染（用户确认一并修复）
- 恢复路径：flag true→false 且 nodes 引用不变 → 工具条/GroupToolbar 恢复显示（锁定订阅语义，对应二轮评审 P1）

### 4. 浏览器手测（jsdom 不可替代项）

评审建议的「Shift+框选 pointermove 序列」集成测试**降级为浏览器手测**：实测合成 PointerEvent 无法驱动 d3-drag 完整交互序列（第二次合成点击即失效），jsdom 下不可行。手测清单：

1. 普通单击节点 → 工具条可见
2. 清空 → Shift+单击节点 → 工具条不可见 → 松开 Shift → 仍不可见
3. 普通单击同一节点 → 工具条恢复
4. Shift+拖拽框选（含只框住 1 个节点）→ 全程及结束后工具条不可见
5. Shift+点击组节点 → GroupToolbar 不弹
