<!-- doc-status: historical | verified_at: n/a -->
# 画布 Undo/Redo 实现计划（v5）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为画布结构层（增删/移动/resize/连线/打组解组）提供 zundo 快照式全局 undo/redo，整合并退役既有 groupHistory。

**Architecture:** 三模块拆分——`canvasHistory.ts`（**零 store import 的纯模块**：结构提取/F1 缓存 partialize 工厂/equality/D2 合成规则）、`canvasStore.ts`（挂 zundo temporal + 创建并导出 `historyPartialize` 单例）、`canvasHistoryRuntime.ts`（undo/redo 执行链、事务族、DB 同步；**顶层严禁访问 store 值**）。拖动/resize 用 pause + 手动 push 事务；多 set 组操作用嵌套安全事务压成一条历史；groupHistory 14 处 record 删除退役。

**Tech Stack:** zundo@^2.3.0、fast-deep-equal、zustand 4.5.5、@xyflow/react v12、vitest + jsdom

**Spec:** docs/superpowers/specs/canvas-undo-redo.md（v5 已冻结）

**v5 修订（五审 C-1~C-2/H-1~H-2/M-1~M-4/L-1~L-4 落实。zundo 2.3.0 源码已实证（unpkg dist）：`equality(pastState, currentState)` 比较的是同一次 set 的 pre/post partialize 产物，不与 pastStates 尾条比较；pause 期间 `temporalHandleSet` 首行 isTracking return（第二次 partialize 不执行）；undo/redo 用原始 `set` 绕过包装 set，不会重录）：**
- **C-1（endDragTransaction 幽灵历史）**：结论成立、机制修正——评审所述「比较尾条 S0 与新状态」不成立（per-set 语义），真实路径：resume 后 `setState({_isPointerInteraction:false})` 的 pre-partialize（flag 仍 true → I-1 跳过采样 = 旧 snap）与 post-partialize（flag false → catch-up 采样 = TD-Pos 拖动中新 position，canvasStore.ts:544-561 实证每帧写 nodeStore 新引用）的 `__nodeDataSnap` 不等 → zundo push `{新结构+旧snap}` 幽灵条目 → 首次 undo 视觉无反应。修法：复位移入 pause 窗口（set 整体被 isTracking 丢弃）；Task 5 补「拖动中 TD-Pos 写 nodeStore 后仍恰好 1 条 + 首次 undo 回原位」回归用例
- **C-2（事务外尾随 canvasStore set）**：评审例子（仅改 selectedId 的非结构 set）在 per-set equality 下实测**不产生**历史（partialize 视图不含 selectedId → pre/post 相等 → 不记录）——此机制描述不成立；但**结构性/派生 set**（applyGroupDerivations/refitGroupBounds 等）尾随事务外会成为独立第 2 条历史 → 首次 undo 落在「主操作已回滚、派生未随回滚」的中间态。Task 9 头部加硬约束声明 + Task 11 加 per-set equality 语义守护用例（防 zundo 升级变语义）
- **H-1（scheduleSync projectId 陈旧闭包）**：undo（P1）→ 300ms 内切 P2 → 旧 timer 用旧 pid + 当前（P2）payload 脏写 P1。修法：timer 回调内重读 projectId 并校验一致（自包含，不动 page.tsx）+ 用例
- **H-2（withHistoryPaused 无深度计数）**：zundo pause/resume 为布尔 set（源码实证），嵌套时内层 resume 提前恢复追踪。修法：深度计数（与 txDepth 同模式）；**定义提前至 Task 3**（Task 4 applyHistory 即可复用，消除第二套 raw pause/resume，全部 pause 收敛单一机制）；Task 6 只留 hydrateLoaded
- **M-1**：beginDragTransaction 重入守卫（`if (dragStartSnapshot) return`，保住首个拖动前快照），置位顺序改 snapshot→pause→set（flag 变化全程在 pause 窗口内，与 end 对称）；**M-2**：reconcileNodeStore 的 type fallback `'textInput'` 与 buildSyncPayload `'videoGen'` 不一致 → 统一 `'videoGen'`（对齐 canvasStore.ts:236/:582 既有同步路径）；**M-3**：isGroupEditContext 删除「画布容器外一律拦截」宽条款（点击侧边栏按钮/面板标题后 Ctrl+Z 会被误拦 = 新的"按了没反应"），改为 INPUT/TEXTAREA/isContentEditable 全局拦截 + AntD 弹层 portal 特征检测（`.ant-select-dropdown` 等 closest）——评审窄口径漏掉侧边栏普通输入框，合并方案两者都覆盖；**M-4**：Task 5 测试 beforeEach 补 `projectId: null`
- **L-1**：`_isPointerInteraction` 更名 `_isPointerInteraction`（drag/resize 四处挂钩共用，原名语义不足；sanitizeDragging 是节点级 RF dragging 字段处理，不涉改名）；**L-2**：applyHistory S-1 注释改「历史切换后（undo/redo 双向）」；**L-3**：withHistoryTransaction 抛错仍 push 的失败安全语义文档化；**L-4**：dropImageIntoStoryboard 简化护栏用例补入 Task 9（签名 `(groupId, nodeId)` 已核 canvasStore.ts:990）

**v4 修订（四审 B-1~B-3/I-1~I-4/M-1~M-5 落实）：**
- **B-1（空拖动幽灵历史）**：`endDragTransaction` / `withHistoryTransaction` push 前加 `structuralEquality` 守卫——空拖动（mousedown 未移动即 mouseup）、snapToGrid 回原位、resize 尺寸未变、事务内无结构变化均不 push（防 Ctrl+Z "按了没反应" + 浪费历史深度）
- **B-2（项目切换错误路径污染）**：Task 6 扩容——page.tsx:123 切换清空包 `withHistoryPaused`；三处错误路径（:152/:157/:168）补 `hydrateLoaded()`，否则加载失败后 pastStates 残留上一项目状态，Ctrl+Z 跨项目污染
- **B-3（命令兼容）**：全部 shell 命令 `&&` 改 `;` 分隔（bash 与 PowerShell 均有效）；grep 检查改用 Grep 工具。上轮 N-2 "不采纳" 修正为采纳兼容化写法
- **I-1（拖动每帧全量 clone）**：确认 onNodesChange TD-Pos 同步（:544-561）拖动中每帧写 nodeStore 新引用 → F1 缓存每帧 miss → 每帧 structuredClone 全量。修法：partialize 检测 `state._isPointerInteraction` 跳过采样复用 cachedSnap（pause 期间产物整体被 zundo 丢弃，无消费者；结束后下次调用 catch-up 采样）。**catch-up 采样点在 resume 后首个 canvas set 的 pre-partialize——`_isPointerInteraction` 复位 set 必须在 pause 窗口内完成（五审 C-1），否则该 set 的 pre（旧 snap）/post（catch-up 新 snap）不等，zundo 会 push 幽灵条目**
- **I-2（scheduleSync 乱序）**：300ms trailing debounce——快速连按 Ctrl+Z 的多个并发全量 PUT 可能乱序完成使 DB 落旧状态；debounce 合并为一次且取 debounce 结束时最新状态
- **I-3（完成回调竞态）**：abort() 拦不住已入微任务队列的完成回调。Task 4 补 `updateConfig` 双 store 幽灵守卫（nodeStore 无 + canvasStore 无 → 丢弃），比依赖 abort 可靠；nodeStore.test.ts:1358 既有 ghost 用例兼容（仍不抛错）
- **I-4（isApplyingHistory 无消费者）**：确认当前无订阅者读取（persistence debounce 天然安全、CanvasView pendingMediaFile 不受 undo 影响）——字段保留（spec 定义），注释改口为"预留"，Self-Review 不再声称已有消费者
- **M-1**：Task 9 toggleCollapse 注明矛盾中间态动机（:1296 先 collapsed:false 尺寸仍 200×64，不包事务则 undo 恢复到矛盾状态）；**M-2**：Task 5 注明拖入组 2 步 undo 粒度；**M-3**：`type || 'videoGen'` fallback 记录技术债（不改）；**M-4**：事务测试补 dragging:true 真实时序用例；**M-5**：CanvasView 卸载兜底用例写死（mock runtime + 扩 mock store 工厂，去掉"尽力而为"）
- **自查新发现**：Task 6 改造 page.tsx 后，page.test.tsx 的 mock canvasStore（:27）无 temporal 属性，真实 `withHistoryPaused` 会在测试内崩——Task 6 必须同步 mock `@/stores/canvasHistoryRuntime`

**v3 修订（三审 B-1/B-2/M-1~M-4/S-1~S-4/N-1~N-4 落实）：**
- **B-1**：循环依赖裁定重写为三模块拆分。原裁定（canvasHistory 顶层 import canvasStore）在 canvasHistory 先于 canvasStore 求值时 TDZ 崩（canvasStore body 构造 temporal 配置时同步读 `historyPartialize`/`HISTORY_LIMIT`）。**且评审建议的"纯模块仅含 nodeStore"也不安全**——`nodeStore.ts:2` 顶层 import canvasStore，链 `canvasHistory → nodeStore → canvasStore →（读 canvasHistory 导出）` 在测试文件先 import canvasHistory 时同样 TDZ。定案：canvasHistory 零 store import（依赖注入）；「禁止动态 import」禁令删除（不再需要）
- **B-2**：新增 Task 8 反转 `deleteNode`/`deleteTransformNode` 的「先清 nodeStore 后 set」顺序（spec D2 采样契约），配真实 action TDD 用例
- **M-1**：Task 9（原 Task 8 Step 3 扩容）逐 action 多 set 审计 + 事务化 + 护栏用例；toggleCollapse/updateStoryboardConfig 显式决策
- **M-2**：groupHistory 测试适配清单补全（useStitchTask.test.ts / canvasStore.groups.test.ts / useCanvasPersistence.test.ts / useGroupKeyboard.test.ts 四文件）
- **M-3**：runtime 测试文件 mock `@/api/projectApi`
- **M-4**：CanvasView 卸载兜底（RF v12 无 onNodeDragCancel）
- **S-1**：undo 撤销创建时 cancel 消失节点的活跃进程（防完成回调幽灵复活）
- **S-2**：一致态 applyGroupDerivations 不产生历史守卫用例
- **S-3**：structuredClone try/catch 降级浅拷贝
- **S-4**：renameGroup 语义反转用例改写 + 边界文档化
- **N-1**：record 计数更正为 14（canvasStore 13 + useStitchTask 1）；**N-2 不采纳**（本环境 shell 为 bash，`cd &&`/`grep` 可用）；**N-3 部分采纳**（实例冒烟用例）；**N-4**：zundo 自动路径 limit 真实用例

---

## 循环依赖裁定 v3（全局唯一，B-1 定案）

模块依赖图（→ 为顶层 import）：

```
canvasHistory.ts   （纯：零 store import，仅 @xyflow 类型 + fast-deep-equal）
canvasStore.ts     → canvasHistory（temporal 配置）+ canvasHistoryRuntime（组 action 函数体内用事务）
canvasHistoryRuntime.ts → canvasStore + canvasHistory + nodeStore + antd + projectApi
nodeStore.ts       → canvasStore（既有，仅函数体内使用）
组件/页面/测试      → canvasHistoryRuntime 或 canvasStore 或 canvasHistory
```

**安全性依据（ESM live binding + TDZ）**：
- canvasHistory 零 store import → 其求值永不触发 canvasStore → canvasStore body 读 `HISTORY_LIMIT`/`createPartialize` 时 canvasHistory 必已完成 → 无 TDZ
- `canvasStore.ts` 内 `export const historyPartialize = createPartialize(() => useNodeStore.getState())`——箭头内引用 useNodeStore（延迟），canvasStore 先求值时 nodeStore 可能未完成，但首次调用必在运行时 → 安全
- canvasStore → canvasHistoryRuntime → canvasStore 环：**runtime 顶层只允许 import 声明、函数定义、纯常量**（严禁顶层调用 `useCanvasStore.getState()` 等），canvasStore 对 runtime 的使用全部在 action 函数体内（延迟）→ 双向安全。runtime 文件头必须保留警示注释（Task 3 Step 2）
- 全场景求值推演已验证：canvasStore 先 / nodeStore 先 / canvasHistory 先 / runtime 先 / 组件先，均无 TDZ

---

## 已完成的侦查结论（实现者无需重查）

- `nodeStore.ts:2` 顶层 import canvasStore（B-1 关键事实，催生三模块拆分）
- saveHandler = `nodeStore.ts:328-386` 简单 `Record<string, () => Promise<void>>`，消费者仅 `saveTransformNode`；回调按 nodeId 读最新 store → 无需处理
- 打组 `groupNodes`（:810-845）单次 `setWithParentOrder` → 天然 1 条历史；mergeStoryboard（:1182 单 set）、pasteGroupClipboard（:1655 单 set）、duplicateGroup（:1562 单 set）、clearStoryboard（:1411）、removeStoryboardCell（:1461）、resizeStoryboardGrid（:1374）、addImageToStoryboardCell（:1425）均为单 set
- **多 set action 审计（M-1，已逐行核实）**：

| Action | 结构 set 次数 | 锚点 | 处理 |
|---|---|---|---|
| ungroup（storyboard 分支） | 2（:865 宫格重排 + :875 解组） | :861-883 | Task 9 事务 |
| ungroup（normal 分支） | 1（:875） | | 无需 |
| dropIntoGroup（目标组折叠） | ≥2（:963 toggleCollapse + :965 主 set） | :963-983 | Task 9 事务 |
| convertGroup（分镜→普通） | 2（:1253 + :1264 refitGroupBounds→set） | :1253-1264 | Task 9 事务 |
| convertGroup（普通→分镜） | 1（:1237） | | 无需 |
| toggleCollapse 折叠 | 1（:1296，width/height 200×64） | :1296-1309 | Task 9 统一事务 |
| toggleCollapse 展开 | 2（:1296 + :1315 或 :1321 refit） | :1310-1323 | Task 9 统一事务 |
| dropImageIntoStoryboard（imageGen 路径） | 2（:1095 addToGroup + :1097 cells） | :1093-1108 | Task 9 事务 |
| dropImageIntoStoryboard（multiImageGen 路径） | 1（:1060） | | 无需 |
| deleteNode（组内节点） | 1~3（:209 主 + :221 cells / 内部 ungroup） | :209-230 | Task 9 事务 |
| GroupContextMenu.handleDelete | N+1 次 deleteNode 循环 | GroupContextMenu.tsx:47-74 | Task 9 外层事务（嵌套直通） |
| updateStoryboardConfig | 1（:1347，尺寸联动进历史） | :1346-1355 | 决策文档化（Task 9） |

- **toggleCollapse 决策**：此前无 groupHistory record；zundo 接入后折叠/展开各产生 1 条历史（width/height 属 spec D1 结构白名单，undo 恢复组尺寸 + collapsed 派生）。**接受为预期 undoable 行为**
- **updateStoryboardConfig / renameGroup 决策（S-4）**：renameGroup 为 data-only（:1280 单 set 仅改 data.name）→ 不进历史不可 undo（行为反转，Task 10 改写既有用例）；updateStoryboardConfig patch 改尺寸时 1 条历史且 data.storyboard 随 G1 完整引用整体回滚——组结构配置非 nodeStore 编辑域，接受；config-only patch（showIndex 等）equality 过滤 0 条
- **B-2 现状**：deleteNode（:207 `ns.deleteNode` → :209 `set`）与 deleteTransformNode（:255 → :257）均为「先清 nodeStore 后 set canvasStore」，违反 spec D2 采样契约（undo 删除恢复不出完整配置）→ Task 8 反转
- **record 计数（N-1）**：canvasStore.ts 13 处 `useGroupHistory.getState().record(...)`（:843/:888/:922/:946/:987/:1207/:1271/:1285/:1394/:1420/:1471/:1595/:1688）+ useStitchTask.ts:46 一处 = **14 处**
- **groupHistory 残留引用全量清单（M-2 扩充）**：canvasStore.ts:20、useGroupKeyboard.ts:6/62-63、useStitchTask.ts:6/39-51、useStitchTask.test.ts:6/19/39/42-43、canvasStore.groups.test.ts:5/16/169-170/192-193/199-204、useCanvasPersistence.test.ts:7/27、useGroupKeyboard.test.ts:25、groupHistory.test.ts（整文件删除）
- Ctrl+Z/Shift+Z 现由 `useGroupKeyboard.ts` `resolveGroupShortcut` 分发（无 Ctrl+Y，Task 7 补）；`isGroupEditContext`：INPUT/TEXTAREA/isContentEditable + activeEditNodeId/activeTransformNodeId（Task 7 升级）
- `useSocket.ts` 无 canvasStore 结构回写 → 远程 skipHistory 仅 page.tsx 加载与 persistence 兜底两条路径
- **M-4**：RF v12 无 `onNodeDragCancel`（仅 Start/Drag/Stop）→ 拖动中断（pointercancel/卸载/路由切换）时须卸载兜底收尾
- **S-1**：cancelNodeProcess（canvasStore.ts:781-791）纯本地（abortController.abort + 清 nodeProcessMap），无 API 调用；生成完成回调经 nodeStore.updateConfig 会为缺失 id 重建节点 → undo 撤销创建时须 cancel 活跃进程防幽灵复活
- resize 事务挂钩点共 4 处：GroupNode.tsx:24-29（NodeResizer）、ImageGenNode.tsx:1161-1162、VideoGenNode.tsx:736-737（后两者已有自有 handleResizeStart/End）、TextInputNode.tsx:157-158（NodeResizeControl）
- **B-2 现状（四审核验）**：page.tsx:123 切换项目清空 `setState({nodes:[],edges:[],...})` 未包 pause → 产生历史条目；正常路径由 `hydrateLoaded()` 兜底清空，但三处错误路径（:152 createPromiseRef 二次失败 / :157 loadProject 失败 / :168 新建失败）只调 `setHydrating(false)` 不清栈 → Ctrl+Z 可恢复上一项目节点到新项目画布
- **I-1 现状（四审核验）**：onNodesChange TD-Pos 同步（canvasStore.ts:544-561）拖动中每帧写 nodeStore 新引用（:555 仅跳过 position 未变帧，拖动中每帧都变）→ F1 缓存每帧 miss → 每帧全量 structuredClone
- **I-3 现状（四审核验）**：nodeStore.updateConfig（:512-535）对缺失 id 无守卫直接重建条目（type 兜底 'imageGen'/position {0,0}）；nodeStore.test.ts:1358 既有"ghost id 不抛错"用例与新增双 store 守卫兼容
- page.test.tsx（:27 mock canvasStore、:69 mock nodeStore、错误路径用例 :389/:422 已存在）——Task 6 改造后须补 runtime mock
- **技术债（M-3，不在本 plan 修）**：`nd.type || 'videoGen'` fallback 见 canvasStore.ts:236/:582 与本 plan buildSyncPayload——任意类型缺失默认成 videoGen 语义有误，为既有模式的延续，记录待偿。五审 M-2：reconcileNodeStore 的「双缺」兜底分支统一同值 `'videoGen'`（保证 undo 回补与 DB 同步双 store 类型一致）
- canvasStore.ts:11 已有 `import { message } from 'antd'` 静态先例

---

### Task 1: 依赖安装 + canvasHistory 纯函数模块（零 store import）

**Files:**
- Modify: `apps/web/package.json`（经 pnpm 安装）
- Create: `apps/web/src/stores/canvasHistory.ts`
- Test: `apps/web/src/stores/canvasHistory.test.ts`

- [ ] **Step 1: 安装依赖**

```bash
cd D:/flowweb; pnpm --filter web add zundo@^2.3.0 fast-deep-equal; pnpm --filter web add -D @types/fast-deep-equal
```

- [ ] **Step 2: 写失败测试（纯函数，fake getter 注入，零 store import）**

```ts
// apps/web/src/stores/canvasHistory.test.ts
import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import {
  HISTORY_LIMIT, pickStructNodes, pickStructEdges, sanitizeDragging,
  createPartialize, structuralEquality, type NodeStoreLike,
} from './canvasHistory';

const n = (over: Partial<Node> & { id: string }): Node => ({
  type: 'textInput', position: { x: 0, y: 0 }, data: {}, ...over,
} as Node);

const snapEntry = (id: string, data: Record<string, unknown> = {}) =>
  ({ id, type: 'textInput', position: { x: 0, y: 0 }, data });

describe('pickStructNodes / pickStructEdges', () => {
  it('只保留结构字段（id/type/position/parentId/width/height）', () => {
    const picked = pickStructNodes([n({ id: 'a', selected: true, dragging: true, zIndex: 5, data: { x: 1 } })]);
    expect(picked[0]).toEqual({ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, parentId: undefined, width: undefined, height: undefined });
  });
  it('edge 只保留结构字段', () => {
    const picked = pickStructEdges([{ id: 'e1', source: 'a', target: 'b', animated: true } as Edge]);
    expect(picked[0]).toEqual({ id: 'e1', source: 'a', target: 'b', sourceHandle: undefined, targetHandle: undefined, type: undefined });
  });
});

describe('sanitizeDragging', () => {
  it('无 dragging 节点时返回原数组引用（零 clone）', () => {
    const nodes = [n({ id: 'a' }), n({ id: 'b' })];
    expect(sanitizeDragging(nodes)).toBe(nodes);
  });
  it('dragging:true 的节点被替换为 dragging:false，其余保持引用', () => {
    const a = n({ id: 'a' });
    const b = n({ id: 'b', dragging: true });
    const out = sanitizeDragging([a, b]);
    expect(out[0]).toBe(a);
    expect(out[1].dragging).toBe(false);
    expect(out[1]).not.toBe(b);
  });
});

describe('createPartialize（F1 缓存 + S-3 降级）', () => {
  const mkStore = (nodes: Record<string, any>): NodeStoreLike & { swap(next: any): void } => {
    const holder = { nodes };
    return { nodes, swap: (next) => { holder.nodes = next; }, get nodes2() { return holder.nodes; } } as any;
  };
  // 简化：直接用闭包可控引用
  const mkGetter = () => {
    let cur: NodeStoreLike = { nodes: {} };
    return { get: () => cur, set: (nodes: any) => { cur = { nodes }; } };
  };

  it('nodeStore 引用未变时两次调用返回同一 __nodeDataSnap 引用（零深拷贝）', () => {
    const g = mkGetter();
    g.set({ a: snapEntry('a', { content: 'x' }) });
    const partialize = createPartialize(g.get);
    const state = { nodes: [n({ id: 'a' })], edges: [] } as any;
    expect(partialize(state).__nodeDataSnap).toBe(partialize(state).__nodeDataSnap);
  });
  it('nodeStore nodes 引用变化后重新采样', () => {
    const g = mkGetter();
    const partialize = createPartialize(g.get);
    const state = { nodes: [], edges: [] } as any;
    const p1 = partialize(state);
    g.set({ b: snapEntry('b') });
    const p2 = partialize(state);
    expect(p1.__nodeDataSnap).not.toBe(p2.__nodeDataSnap);
    expect(p2.__nodeDataSnap.b).toBeDefined();
  });
  it('采样为深拷贝（后续 nodeStore 更新不污染快照）', () => {
    const g = mkGetter();
    g.set({ a: snapEntry('a', { content: 'v1' }) });
    const partialize = createPartialize(g.get);
    const snap = partialize({ nodes: [], edges: [] } as any).__nodeDataSnap;
    g.set({ a: snapEntry('a', { content: 'v2' }) });
    expect((snap.a.data as any).content).toBe('v1');
  });
  it('不同工厂实例缓存隔离（Vitest 串用例防护）', () => {
    const g1 = mkGetter(); g1.set({});
    const p1 = createPartialize(g1.get)({ nodes: [], edges: [] } as any);
    g1.set({ a: snapEntry('a') });
    const p2 = createPartialize(g1.get)({ nodes: [], edges: [] } as any);
    expect(p1.__nodeDataSnap).not.toBe(p2.__nodeDataSnap);
  });
  it('S-3：data 混入不可克隆值（函数）时不抛错，降级浅拷贝', () => {
    const g = mkGetter();
    g.set({ a: { ...snapEntry('a'), data: { fn: () => {} } as any } });
    const partialize = createPartialize(g.get);
    expect(() => partialize({ nodes: [], edges: [] } as any)).not.toThrow();
    expect(partialize({ nodes: [], edges: [] } as any).__nodeDataSnap.a).toBeDefined();
  });
  it('I-1：拖动中（_isPointerInteraction）跳过采样——nodeStore 引用变化不触发 clone，结束后 catch-up', () => {
    const g = mkGetter();
    const partialize = createPartialize(g.get);
    const idle = partialize({ nodes: [], edges: [], _isPointerInteraction: false } as any);
    g.set({ b: snapEntry('b') });                                                 // 引用变化（模拟 TD-Pos 每帧写）
    const dragging = partialize({ nodes: [], edges: [], _isPointerInteraction: true } as any);
    expect(dragging.__nodeDataSnap).toBe(idle.__nodeDataSnap);                    // 复用缓存，零 clone
    const after = partialize({ nodes: [], edges: [], _isPointerInteraction: false } as any);
    expect(after.__nodeDataSnap.b).toBeDefined();                                 // 结束后下次调用补采样
  });
});

describe('structuralEquality（G1：过滤在 equality 层）', () => {
  it('只改 selected/hidden/dragging 不产生历史（equality 判等）', () => {
    const before = { nodes: [n({ id: 'a' })], edges: [] };
    const after = { nodes: [n({ id: 'a', selected: true, dragging: true, hidden: true })], edges: [] };
    expect(structuralEquality(before as any, after as any)).toBe(true);
  });
  it('改 position/parentId/width/height 产生历史（equality 不等）', () => {
    for (const patch of [{ position: { x: 9, y: 9 } }, { parentId: 'g' }, { width: 123 }, { height: 456 }]) {
      const before = { nodes: [n({ id: 'a' })], edges: [] };
      const after = { nodes: [n({ id: 'a', ...patch } as any)], edges: [] };
      expect(structuralEquality(before as any, after as any)).toBe(false);
    }
  });
  it('__nodeDataSnap 差异不影响判等', () => {
    const a = { nodes: [n({ id: 'a' })], edges: [], __nodeDataSnap: { a: {} } };
    const b = { nodes: [n({ id: 'a' })], edges: [], __nodeDataSnap: { a: { x: 1 } } };
    expect(structuralEquality(a as any, b as any)).toBe(true);
  });
});

describe('HISTORY_LIMIT', () => {
  it('为 100', () => expect(HISTORY_LIMIT).toBe(100));
});
```

- [ ] **Step 3: 运行确认失败**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/canvasHistory.test.ts
```
预期：FAIL（模块不存在）

- [ ] **Step 4: 实现 canvasHistory.ts（零 store import——循环依赖裁定见 plan 头部）**

```ts
// apps/web/src/stores/canvasHistory.ts
// 结构层 undo/redo 历史纯函数（spec: canvas-undo-redo.md v5）
// ⚠️ 本模块严禁 import 任何 store（含 nodeStore——nodeStore 顶层 import canvasStore，
//    会构成 canvasHistory → nodeStore → canvasStore → canvasHistory 环，
//    在本模块先于 canvasStore 求值时 TDZ 崩溃）。store 访问一律依赖注入。
// zundo pastStates 同时是 undo 回写载荷 → partialize 必须返回完整引用（G1），
// 结构过滤（UI/派生态不触发历史）下沉到 equality 层。
import type { Node, Edge } from '@xyflow/react';
import isEqual from 'fast-deep-equal';

export const HISTORY_LIMIT = 100;

export interface NodeDataSnapEntry {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface HistoryPartial {
  nodes: Node[];
  edges: Edge[];
  __nodeDataSnap: Record<string, NodeDataSnapEntry>;
}

/** nodeStore 最小结构（依赖注入接口，防循环 import） */
export interface NodeStoreLike {
  nodes: Record<string, NodeDataSnapEntry>;
}

/** equality/白名单共用提取：只保留触发历史的结构字段 */
export function pickStructNodes(nodes: Node[]) {
  return nodes.map((nd) => ({
    id: nd.id,
    type: nd.type,
    position: nd.position,
    parentId: nd.parentId,
    width: nd.width,
    height: nd.height,
  }));
}

export function pickStructEdges(edges: Edge[]) {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: e.type,
  }));
}

/** G1 sanitize：dragStart 瞬间 RF 已置 dragging=true，完整引用会污染快照 → 仅 clone dragging 节点 */
export function sanitizeDragging(nodes: Node[]): Node[] {
  return nodes.some((nd) => nd.dragging)
    ? nodes.map((nd) => (nd.dragging ? { ...nd, dragging: false } : nd))
    : nodes;
}

/** S-3：structuredClone 失败（data 混入函数/Blob/DOM 引用）降级浅拷贝——
 *  partialize 在 zundo _handleSet 内同步执行，抛错会打崩每一次 set */
function cloneSnap(nodes: Record<string, NodeDataSnapEntry>): Record<string, NodeDataSnapEntry> {
  try {
    return structuredClone(nodes);
  } catch (err) {
    console.warn('[canvasHistory] structuredClone failed, fallback to shallow copy', err);
    return { ...nodes };
  }
}

/** F1 缓存闭包：nodeStore 引用未变时复用上次深拷贝（源码确认每次 set 双跑 partialize 且 pause 期也跑第一次）。
 *  getNodeStore 由 canvasStore.ts 注入（Task 2 创建单例实例）。
 *  I-1：指针交互中（drag/resize，_isPointerInteraction）跳过采样复用 cachedSnap——TD-Pos 同步
 *  （onNodesChange :544-561）拖动中每帧写 nodeStore 新引用会使缓存每帧 miss → 每帧全量
 *  structuredClone；而 pause 期间 partialize 产物整体被 zundo _handleSet 丢弃（isTracking 检查），
 *  无消费者，跳过安全；结束后下次调用 catch-up（catch-up 采样点 = resume 后首个 set 的 pre-partialize，
 *  故复位 set 必须在 pause 窗口内——五审 C-1，见 canvasHistoryRuntime endDragTransaction） */
export function createPartialize(getNodeStore: () => NodeStoreLike) {
  let cachedSnap: HistoryPartial['__nodeDataSnap'] = {};
  let cachedRef: unknown = null;
  return (state: { nodes: Node[]; edges: Edge[]; _isPointerInteraction?: boolean }): HistoryPartial => {
    if (!state._isPointerInteraction) {
      const ns = getNodeStore();
      if (ns.nodes !== cachedRef) {
        cachedSnap = cloneSnap(ns.nodes);
        cachedRef = ns.nodes;
      }
    }
    return { nodes: sanitizeDragging(state.nodes), edges: state.edges, __nodeDataSnap: cachedSnap };
  };
}

/** G1：结构过滤在 equality 层——selected/hidden/dragging/data 变化不产生历史 */
export function structuralEquality(
  past: { nodes: Node[]; edges: Edge[] },
  current: { nodes: Node[]; edges: Edge[] },
): boolean {
  return isEqual(pickStructNodes(past.nodes), pickStructNodes(current.nodes))
    && isEqual(pickStructEdges(past.edges), pickStructEdges(current.edges));
}
```

- [ ] **Step 5: 运行测试通过**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/canvasHistory.test.ts
```
预期：PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/src/stores/canvasHistory.ts apps/web/src/stores/canvasHistory.test.ts pnpm-lock.yaml
git commit -m "feat(web): canvasHistory 纯模块——零store依赖/结构提取/F1缓存partialize工厂/equality/克隆降级"
```

---

### Task 2: canvasStore 挂 temporal 中间件 + historyPartialize 单例

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts:144`（create 调用）、CanvasState 接口
- Modify: `apps/web/src/stores/canvasStore.test.ts`（beforeEach 清历史 + 自动 limit 用例）

- [ ] **Step 1: 写失败测试（canvasStore.test.ts 追加）**

```ts
// ─── TD-Hist: temporal 中间件接入 ───
import { HISTORY_LIMIT } from './canvasHistory';
import { historyPartialize } from './canvasStore';

describe('canvasStore temporal history', () => {
  it('结构 set（addNode）应产生一条历史', () => {
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().addNode('text', { x: 0, y: 0 });
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });

  it('UI 态 set（selectedId）不应产生历史', () => {
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.setState({ selectedId: 'x' });
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);
  });

  it('isApplyingHistory/_isPointerInteraction 默认 false，__nodeDataSnap 默认 undefined', () => {
    useCanvasStore.setState({ isApplyingHistory: false, _isPointerInteraction: false, __nodeDataSnap: undefined });
    const s = useCanvasStore.getState();
    expect(s.isApplyingHistory).toBe(false);
    expect(s._isPointerInteraction).toBe(false);
    expect(s.__nodeDataSnap).toBeUndefined();
  });

  it('N-4：zundo 自动路径 limit 截断——105 次结构 set 后 pastStates ≤ HISTORY_LIMIT', () => {
    useCanvasStore.temporal.getState().clear();
    for (let i = 0; i < 105; i++) {
      useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: i, y: 0 }, data: {} } as any], edges: [] });
    }
    expect(useCanvasStore.temporal.getState().pastStates.length).toBeLessThanOrEqual(HISTORY_LIMIT);
  });

  it('N-3：historyPartialize 单例冒烟——nodeStore 未变时连续调用 __nodeDataSnap 同引用', () => {
    const state = { nodes: [], edges: [] } as any;
    expect(historyPartialize(state).__nodeDataSnap).toBe(historyPartialize(state).__nodeDataSnap);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/canvasStore.test.ts -t "temporal history"
```
预期：FAIL（`useCanvasStore.temporal` 不存在 / `historyPartialize` 未导出）

- [ ] **Step 3: 实现——canvasStore.ts 改造**

CanvasState 接口追加（找到 `interface CanvasState` 内 `isHydrating: boolean;` 一行后加）：

```ts
  isHydrating: boolean;
  // ── undo/redo（spec canvas-undo-redo.md）──
  /** zundo undo 回写时带入的 nodeStore data 采样，包装 undo/redo 中读出后立即清除 */
  __nodeDataSnap?: import('./canvasHistory').HistoryPartial['__nodeDataSnap'];
  /** 拖动事务进行中（onNodeDragStart/Stop 维护），undo/redo 键盘 no-op 守卫 */
  _isPointerInteraction: boolean;
  /** 包装 undo/redo 写回进行中。I-4：当前无订阅者消费（persistence 500ms debounce 写最终态天然安全、
   *  CanvasView pendingMediaFile 不受 undo 影响）——预留字段（spec D3 定义），供未来需跳过副作用的订阅者使用 */
  isApplyingHistory: boolean;
```

文件顶部 import 区追加：

```ts
import { temporal } from 'zundo';
import { createPartialize, structuralEquality, HISTORY_LIMIT } from './canvasHistory';
```

create 调用改造（canvasStore.ts:144 `export const useCanvasStore = create<CanvasState>((set, get) => {` 之前加实例、create 包 temporal）：

```ts
/** F1 缓存单例：zundo 配置与 runtime 事务快照（Task 5）共用同一实例，防两处漂移。
 *  getNodeStore 箭头延迟求值——canvasStore 先于 nodeStore 完成求值也安全 */
export const historyPartialize = createPartialize(() => useNodeStore.getState());

export const useCanvasStore = create<CanvasState>()(temporal(
  (set, get) => {
    // ……原有全部实现不动……
  },
  {
    limit: HISTORY_LIMIT,
    partialize: historyPartialize,
    equality: (past, current) => structuralEquality(past as any, current as any),
  },
));
```

`isHydrating: false,` 初始值行后追加：

```ts
  isHydrating: false,
  __nodeDataSnap: undefined,
  _isPointerInteraction: false,
  isApplyingHistory: false,
```

- [ ] **Step 4: 适配现有测试（防跨用例历史污染）**

`canvasStore.test.ts` beforeEach 追加一行：

```ts
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], viewport: { x: 0, y: 0 }, selectedId: null, projectId: null });
    useCanvasStore.temporal.getState().clear();
    useNodeStore.setState({ nodes: {} });
    mockSyncNodes.mockClear();
    mockSyncEdges.mockClear();
  });
```

- [ ] **Step 5: 运行全文件测试通过**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/canvasStore.test.ts
```
预期：PASS（含既有 68+ 用例；个别失败逐个在用例内 clear）

- [ ] **Step 6: 跑受影响的关联 store 测试**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/
```
预期：PASS（boundary/cellOps/dropIntoGroup/duplicate/groups/storyboard 等如失败，同样在各自 beforeEach 加 clear）

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.test.ts
git commit -m "feat(web): canvasStore 挂 zundo temporal——结构历史+UI态过滤+historyPartialize单例"
```

---

### Task 3: reconcileNodeStore 纯函数 + canvasHistoryRuntime 创建 + scheduleSync

**Files:**
- Modify: `apps/web/src/stores/canvasHistory.ts` 追加（reconcileNodeStore）
- Create: `apps/web/src/stores/canvasHistoryRuntime.ts`
- Test: `apps/web/src/stores/canvasHistory.test.ts` 追加 + `apps/web/src/stores/canvasHistoryRuntime.test.ts` 创建

- [ ] **Step 1: 写失败测试——canvasHistory.test.ts 追加（纯函数）**

```ts
import { reconcileNodeStore } from './canvasHistory';

describe('reconcileNodeStore（D2 合成规则，纯函数）', () => {
  it('undo 拖动：节点在当前 nodeStore 存在 → 保留当前 data', () => {
    const current = { a: snapEntry('a', { content: '当前值' }) };
    const snap = { a: snapEntry('a', { content: '旧值' }) };
    const next = reconcileNodeStore([{ id: 'a', type: 'textInput', position: { x: 0, y: 0 } }], snap, current);
    expect((next.a.data as any).content).toBe('当前值');
  });

  it('undo 删除：节点不在 nodeStore → 从快照回补', () => {
    const snap = { a: snapEntry('a', { content: '恢复我' }) };
    const next = reconcileNodeStore([{ id: 'a', type: 'textInput', position: { x: 1, y: 2 } }], snap, {});
    expect((next.a.data as any).content).toBe('恢复我');
  });

  it('redo 删除：目标结构不含 → 不进结果（防复活）', () => {
    const current = { a: snapEntry('a'), keep: snapEntry('keep') };
    const next = reconcileNodeStore([{ id: 'keep', type: 'textInput', position: { x: 0, y: 0 } }], {}, current);
    expect(next.a).toBeUndefined();
    expect(next.keep).toBeDefined();
  });

  it('快照也缺的节点 → 空 data 兜底', () => {
    const next = reconcileNodeStore([{ id: 'x', type: 'videoGen', position: { x: 0, y: 0 } }], {}, {});
    expect(next.x.data).toEqual({});
  });
});
```

- [ ] **Step 2: 实现 reconcileNodeStore（canvasHistory.ts 追加；M6：签名 Pick + currentNodes 注入返回 next 纯函数）**

```ts
/** D2 合成规则（双向语义，纯函数——store 写入由 runtime 桥接）：
 *   当前 nodeStore 有 → 保留（undo 拖动不回退配置）
 *   当前无、快照有 → 回补（undo 删除恢复配置）
 *   目标结构不含 → 不进结果（redo 删除不残留，防复活） */
export function reconcileNodeStore(
  targetNodes: Array<Pick<Node, 'id' | 'type' | 'position'>>,
  snap: HistoryPartial['__nodeDataSnap'],
  currentNodes: Record<string, NodeDataSnapEntry>,
): Record<string, NodeDataSnapEntry> {
  const next: Record<string, NodeDataSnapEntry> = {};
  for (const node of targetNodes) {
    next[node.id] = currentNodes[node.id] ?? snap[node.id] ?? {
      id: node.id, type: node.type || 'videoGen',   // 五审 M-2：与 buildSyncPayload/既有同步路径（:236/:582）统一兜底，双 store 类型一致
      position: node.position, data: {},
    };
  }
  return next;
}
```

- [ ] **Step 3: 运行纯函数测试通过**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/canvasHistory.test.ts
```
预期：PASS

- [ ] **Step 4: 创建 canvasHistoryRuntime.ts（scheduleSync + withHistoryPaused）**

```ts
// apps/web/src/stores/canvasHistoryRuntime.ts
// canvas undo/redo 运行时：undo/redo 执行链、事务族、DB 同步。
// ⚠️ 循环依赖裁定（plan 头部）：canvasStore 顶层 import 本模块（组 action 函数体内调用事务），
//    本模块顶层 import canvasStore——**顶层严禁访问 useCanvasStore/historyPartialize 的值**
//    （只允许 import 声明、函数定义、纯常量），否则 canvasStore 先求值时 TDZ 崩溃。
import { message } from 'antd';
import { useCanvasStore, historyPartialize } from './canvasStore';
import { useNodeStore } from './nodeStore';
import type { HistoryPartial } from './canvasHistory';
import { syncNodes, syncEdges } from '@/api/projectApi';

/** undo/redo 后的 DB 全量同步载荷：canvasStore 结构为基准 + nodeStore data */
function buildSyncPayload() {
  const cs = useCanvasStore.getState();
  const ns = useNodeStore.getState();
  return cs.nodes.map((nd) => ({
    id: nd.id,
    type: nd.type || 'videoGen',
    parentId: nd.parentId ?? null,
    position: nd.position,
    data: (ns.nodes[nd.id]?.data ?? nd.data) as Record<string, unknown>,
    width: nd.width,
    height: nd.height,
  }));
}

/** undo/redo 后的 DB 全量同步（失败 toast，spec D3）。
 *  I-2：300ms trailing debounce——快速连按 Ctrl+Z 会发出多个并发全量 PUT，
 *  乱序完成会使 DB 落旧状态；debounce 合并为一次，且 payload 取 debounce 结束时最新状态 */
let syncTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSync(): Promise<void> {
  const { projectId } = useCanvasStore.getState();
  if (!projectId) return Promise.resolve();
  if (syncTimer) clearTimeout(syncTimer);
  return new Promise((resolve) => {
    syncTimer = setTimeout(() => {
      syncTimer = null;
      // 五审 H-1：debounce 窗口内可能已切换项目——重读并校验，防止用旧 projectId
      // 写入当前（新项目/过渡）状态脏写旧项目（page.tsx 切换路径不调 scheduleSync，旧 timer 会存活）
      const pid = useCanvasStore.getState().projectId;
      if (!pid || pid !== projectId) { resolve(); return; }
      Promise.all([
        syncNodes(pid, buildSyncPayload()),
        syncEdges(pid, useCanvasStore.getState().edges),
      ])
        .then(() => resolve())
        .catch((e) => {
          console.error('[canvasHistory] undo sync failed', e);
          message.warning('撤销结果未能保存到服务器，刷新后可能恢复到撤销前状态');
          resolve();
        });
    }, 300);
  });
}

let pauseDepth = 0;

/** M7：DB/本地快照恢复等远程回写统一走此包装，不产生历史。
 *  五审 H-2：zundo pause/resume 为布尔 set 非计数——嵌套调用时内层 resume 会使外层
 *  仍期望 pause 的闭包提前恢复追踪；深度计数保证仅最外层退出时 resume。
 *  定义在 Task 3（而非 Task 6）——Task 4 applyHistory 即复用，pause 全收敛此单一机制 */
export function withHistoryPaused<T>(fn: () => T): T {
  const t = useCanvasStore.temporal.getState();
  if (pauseDepth === 0) t.pause();
  pauseDepth++;
  try {
    return fn();
  } finally {
    pauseDepth--;
    if (pauseDepth === 0) t.resume();
  }
}
```

（既有 deleteNode/onNodesChange 的 mergedNodes 内联构造保持不动——DRY 收敛列 P2，不在本 plan 扩面）

- [ ] **Step 5: 写 runtime 测试（M-3：mock antd + projectApi）**

```ts
// apps/web/src/stores/canvasHistoryRuntime.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Node } from '@xyflow/react';

vi.mock('antd', () => ({ message: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/api/projectApi', () => ({ syncNodes: vi.fn(), syncEdges: vi.fn() }));

import { syncNodes, syncEdges } from '@/api/projectApi';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { scheduleSync, withHistoryPaused } from './canvasHistoryRuntime';

const n = (over: Partial<Node> & { id: string }): Node => ({
  type: 'textInput', position: { x: 0, y: 0 }, data: {}, ...over,
} as Node);

describe('scheduleSync', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null, projectId: null, isHydrating: false, _isPointerInteraction: false, nodeProcessMap: {} });
    useCanvasStore.temporal.getState().clear();
    useNodeStore.setState({ nodes: {} });
    vi.clearAllMocks();
  });

  it('projectId 为 null 时早退不发请求', async () => {
    useCanvasStore.setState({ projectId: null });
    await scheduleSync();
    expect(syncNodes).not.toHaveBeenCalled();
    expect(syncEdges).not.toHaveBeenCalled();
  });

  it('I-2：debounce 300ms 合并连发，payload 取最新状态', async () => {
    vi.useFakeTimers();
    try {
      useCanvasStore.setState({ projectId: 'p1', nodes: [n({ id: 'a' })], edges: [] });
      useNodeStore.setState({ nodes: { a: { id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: { content: 'x' } as any } } });
      const p1 = scheduleSync();
      useCanvasStore.setState({ nodes: [n({ id: 'a', position: { x: 9, y: 9 } })], edges: [] });   // 连按时状态再变
      const p2 = scheduleSync();
      await vi.advanceTimersByTimeAsync(300);
      await Promise.all([p1, p2]);
      expect(syncNodes).toHaveBeenCalledTimes(1);                                                  // 合并为一次
      expect(syncNodes).toHaveBeenCalledWith('p1', [expect.objectContaining({ position: { x: 9, y: 9 }, data: { content: 'x' } })]);  // 最新位置 + nodeStore data 为准
      expect(syncEdges).toHaveBeenCalledWith('p1', []);
    } finally {
      vi.useRealTimers();
    }
  });

  it('同步失败 toast 不抛出', async () => {
    vi.useFakeTimers();
    try {
      (syncNodes as any).mockRejectedValueOnce(new Error('net'));
      useCanvasStore.setState({ projectId: 'p1', nodes: [n({ id: 'a' })], edges: [] });
      const p = scheduleSync();
      await vi.advanceTimersByTimeAsync(300);
      await expect(p).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('五审 H-1：debounce 窗口内切换项目 → 旧 projectId 同步被丢弃', async () => {
    vi.useFakeTimers();
    try {
      useCanvasStore.setState({ projectId: 'p1', nodes: [n({ id: 'a' })], edges: [] });
      const p = scheduleSync();
      useCanvasStore.setState({ projectId: 'p2' });                    // 300ms 内切换
      await vi.advanceTimersByTimeAsync(300);
      await p;
      expect(syncNodes).not.toHaveBeenCalled();                        // 不用旧 pid 脏写
      expect(syncEdges).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('withHistoryPaused', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });
    useCanvasStore.temporal.getState().clear();
  });

  it('内的 set 不记录历史', () => {
    withHistoryPaused(() => {
      useCanvasStore.setState({ nodes: [] as any, edges: [] });
    });
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);
  });

  it('五审 H-2：嵌套调用——内层退出不提前恢复追踪，最外层退出才 resume', () => {
    withHistoryPaused(() => {
      withHistoryPaused(() => {
        useCanvasStore.setState({ nodes: [] as any, edges: [] });
      });
      // 内层 finally 不 resume——外层闭包内后续 set 仍不记录（布尔 pause 会被内层 resume 打穿）
      useCanvasStore.setState({ nodes: [{ id: 'b', type: 'textInput', position: { x: 1, y: 1 }, data: {} } as any], edges: [] });
    });
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);
    useCanvasStore.setState({ nodes: [] as any, edges: [] });          // 退出后恢复记录
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });

  it('异常时 finally resume（不卡记录能力）', () => {
    expect(() => withHistoryPaused(() => { throw new Error('x'); })).toThrow('x');
    useCanvasStore.setState({ nodes: [] as any, edges: [] });
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });
});
```

- [ ] **Step 6: 运行 + Commit**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/canvasHistory.test.ts src/stores/canvasHistoryRuntime.test.ts
git add apps/web/src/stores/canvasHistory.ts apps/web/src/stores/canvasHistory.test.ts apps/web/src/stores/canvasHistoryRuntime.ts apps/web/src/stores/canvasHistoryRuntime.test.ts
git commit -m "feat(web): reconcileNodeStore D2纯函数 + canvasHistoryRuntime + scheduleSync"
```

---

### Task 4: 包装 undo/redo（S9 try/finally + S-1 进程取消 + I-3 幽灵守卫）

**Files:**
- Modify: `apps/web/src/stores/canvasHistoryRuntime.ts` 追加、`apps/web/src/stores/nodeStore.ts:512-514`（updateConfig 守卫）
- Test: `apps/web/src/stores/canvasHistoryRuntime.test.ts` 追加、`apps/web/src/stores/nodeStore.test.ts` 追加

- [ ] **Step 1: 写失败测试（M1：全部 async + await；文件顶部 mock 已就绪）**

```ts
// canvasHistoryRuntime.test.ts 追加：
import { undoCanvas, redoCanvas } from './canvasHistoryRuntime';
import { reconcileNodeStore } from './canvasHistory';

describe('undoCanvas / redoCanvas', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null, projectId: null, isHydrating: false, _isPointerInteraction: false, nodeProcessMap: {}, __nodeDataSnap: undefined, isApplyingHistory: false });
    useCanvasStore.temporal.getState().clear();
    useNodeStore.setState({ nodes: {} });
  });

  it('undo 恢复结构且 node 携带完整渲染字段（G1 验收14）', async () => {
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: { k: 1 }, style: { color: 'red' }, measured: { width: 300, height: 300 } } as any], edges: [] });
    useCanvasStore.setState({ nodes: [], edges: [] });
    await undoCanvas();
    const restored = useCanvasStore.getState().nodes[0];
    expect(restored.data).toEqual({ k: 1 });
    expect(restored.style).toEqual({ color: 'red' });
    expect(restored.measured).toEqual({ width: 300, height: 300 });
  });

  it('undo 删除 → nodeStore data 从快照回补（D2）', async () => {
    useNodeStore.setState({ nodes: { a: { id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '配置' } as any } } });
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });
    useCanvasStore.setState({ nodes: [], edges: [] });                       // 删除（set 前快照含 a 的 nodeStore data）
    useNodeStore.setState({ nodes: {} });                                     // 删除路径清 nodeStore
    await undoCanvas();
    expect((useNodeStore.getState().nodes.a?.data as any).content).toBe('配置');
  });

  it('undo 后 redo 恢复到撤销前结构', async () => {
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });
    useCanvasStore.setState({ nodes: [], edges: [] });
    await undoCanvas();
    expect(useCanvasStore.getState().nodes.length).toBe(1);
    await redoCanvas();
    expect(useCanvasStore.getState().nodes.length).toBe(0);
  });

  it('undo 后 __nodeDataSnap 已清除、isApplyingHistory 复位、栈移位', async () => {
    useCanvasStore.setState({ nodes: [], edges: [] });
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });
    const before = useCanvasStore.temporal.getState().pastStates.length;
    await undoCanvas();
    const s = useCanvasStore.getState();
    expect(s.__nodeDataSnap).toBeUndefined();
    expect(s.isApplyingHistory).toBe(false);
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(before - 1);
    expect(useCanvasStore.temporal.getState().futureStates.length).toBe(1);
  });

  it('空栈 no-op；isHydrating/_isPointerInteraction no-op', async () => {
    await expect(undoCanvas()).resolves.toBeUndefined();
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });
    useCanvasStore.setState({ _isPointerInteraction: true });
    await undoCanvas();
    expect(useCanvasStore.getState().nodes.length).toBe(1);
    useCanvasStore.setState({ _isPointerInteraction: false, isHydrating: true });
    await undoCanvas();
    expect(useCanvasStore.getState().nodes.length).toBe(1);
  });

  it('异常路径：执行链抛错时 __nodeDataSnap 清理且标志复位，不抛出（S9 catch）', async () => {
    const orig = useCanvasStore.getState().applyGroupDerivations;
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });
    useCanvasStore.setState({ nodes: [], edges: [] });
    (useCanvasStore.getState() as any).applyGroupDerivations = () => { throw new Error('boom'); };
    await expect(undoCanvas()).resolves.toBeUndefined();
    expect(useCanvasStore.getState().__nodeDataSnap).toBeUndefined();
    expect(useCanvasStore.getState().isApplyingHistory).toBe(false);
    (useCanvasStore.getState() as any).applyGroupDerivations = orig;
  });

  it('S-1：undo 撤销创建时取消该节点的活跃进程（防完成回调幽灵复活）', async () => {
    const abort = vi.fn();
    useCanvasStore.setState({
      nodes: [{ id: 'a', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any],
      edges: [],
      nodeProcessMap: { a: { status: 'PROCESSING', progress: 50, abortController: { abort } } as any },
    });
    // 注意：不能再 setState 清空 nodes——「创建 a」这一 set 本身即历史条目（∅→[a]），
    // undo 直接回到 ∅ 才是「撤销创建」；多加删除行会使 undo 变成恢复节点、S-1 不触发
    // （实现期发现的原 plan bug，五轮评审未察觉——见执行记录 88f43ae）
    await undoCanvas();
    expect(useCanvasStore.getState().nodeProcessMap.a).toBeUndefined();
    expect(abort).toHaveBeenCalled();
  });

  it('S-1：undo 不影响仍在结构中的节点进程', async () => {
    const abort = vi.fn();
    useCanvasStore.setState({
      nodes: [{ id: 'a', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any, { id: 'b', type: 'textInput', position: { x: 9, y: 9 }, data: {} } as any],
      edges: [],
      nodeProcessMap: { a: { status: 'PROCESSING', progress: 10, abortController: { abort } } as any },
    });
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });  // 删除 b
    await undoCanvas();
    expect(useCanvasStore.getState().nodeProcessMap.a).toBeDefined();
    expect(abort).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 写失败测试——nodeStore.test.ts 追加（I-3 幽灵守卫）**

```ts
// apps/web/src/stores/nodeStore.test.ts 追加（该文件已可用真实 canvasStore——nodeStore.ts:2 已 import）：
import { useCanvasStore } from './canvasStore';

describe('updateConfig 幽灵守卫（I-3）', () => {
  it('双 store 均无的幽灵 id 直接丢弃（undo 撤销创建后完成回调迟到不复活）', () => {
    useNodeStore.setState((s) => { const next = { ...s.nodes }; delete next['ghost-undo']; return { nodes: next }; });
    useCanvasStore.setState((s) => ({ nodes: s.nodes.filter((nd) => nd.id !== 'ghost-undo') }));
    useNodeStore.getState().updateConfig('ghost-undo', { status: 'done' } as any);
    expect(useNodeStore.getState().nodes['ghost-undo']).toBeUndefined();
  });

  it('canvasStore 存在而 nodeStore 缺失 → 仍重建（既有语义保留）', () => {
    useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'cs-only', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any] }));
    try {
      useNodeStore.getState().updateConfig('cs-only', { status: 'done' } as any);
      expect(useNodeStore.getState().nodes['cs-only']).toBeDefined();
    } finally {
      useCanvasStore.setState((s) => ({ nodes: s.nodes.filter((nd) => nd.id !== 'cs-only') }));   // 防跨用例污染
    }
  });
});
```

（既有 :1358 "ghost id 不抛错"用例与守卫兼容——丢弃路径同样不抛）

- [ ] **Step 3: 运行确认失败（nodeStore 幽灵守卫用例）**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/nodeStore.test.ts -t "幽灵守卫"
```
预期：FAIL（ghost id 被重建——守卫尚未实现）

- [ ] **Step 4: 实现 updateConfig 守卫（nodeStore.ts:512-514，existing 取出后插入）**

```ts
  updateConfig: (id, config) => {
    const existing = getNode(get().nodes, id);
    const nodeType = existing?.type;
    // I-3 幽灵守卫：双 store 均无此节点（undo 撤销创建后生成完成回调迟到）→ 丢弃。
    // abort() 拦不住已入微任务队列的完成回调；若不拦截会经此处重建 nodeStore 条目，
    // 被 persistence 快照持久化 → 下次刷新幽灵复活
    if (!existing && !useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
    // ……以下原样不动……
```

- [ ] **Step 5: 运行 nodeStore 用例转绿（undoCanvas 用例仍红——runtime 未实现，属预期）**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/nodeStore.test.ts
```
预期：PASS（含既有 :1358 ghost 用例——丢弃路径同样不抛）

- [ ] **Step 6: 实现（canvasHistoryRuntime.ts 追加；M2：antd 静态 import，catch 无 await；S-1：undo 撤销创建→cancel 消失节点进程）**

```ts
import { reconcileNodeStore } from './canvasHistory';

/** S9：统一执行链（同步主体，async 仅因 scheduleSync）。undo=true 撤销 / false 重做。
 *  五审 H-2：pause/resume 复用 withHistoryPaused 深度计数——zundo undo/redo 不检查
 *  isTracking 且经原始 set 应用状态（源码实证），pause 窗口内执行安全且不会重录 */
function applyHistory(direction: 'undo' | 'redo'): Promise<void> {
  const t = useCanvasStore.temporal.getState() as {
    pastStates: HistoryPartial[]; futureStates: HistoryPartial[];
    undo(): void; redo(): void;
  };
  const s = useCanvasStore.getState();
  const stack = direction === 'undo' ? t.pastStates : t.futureStates;
  if (stack.length === 0 || s._isPointerInteraction || s.isHydrating) return Promise.resolve();
  const target = stack[stack.length - 1];

  // isApplyingHistory 不在 partialize 视图 → 窗口外 set 的 pre/post 相等，不产生历史
  useCanvasStore.setState({ isApplyingHistory: true });
  let ok = false;
  withHistoryPaused(() => {
    try {
      const beforeIds = new Set(s.nodes.map((nd) => nd.id));
      if (direction === 'undo') t.undo(); else t.redo();
      // S-1：历史切换后（undo/redo 双向）从结构中消失且仍有活跃进程的节点 → cancel（防生成完成
      // 回调经 nodeStore.updateConfig 为缺失 id 重建节点 → 刷新时幽灵复活）
      const afterState = useCanvasStore.getState();
      const afterIds = new Set(afterState.nodes.map((nd) => nd.id));
      for (const id of beforeIds) {
        if (!afterIds.has(id) && afterState.nodeProcessMap[id]) {
          afterState.cancelNodeProcess(id);
        }
      }
      useNodeStore.setState({
        nodes: reconcileNodeStore(afterState.nodes, target.__nodeDataSnap, useNodeStore.getState().nodes),
      });
      afterState.applyGroupDerivations();
      useCanvasStore.setState({ __nodeDataSnap: undefined });
      ok = true;
    } catch (err) {
      console.error('[canvasHistory] history apply failed', err);
      useCanvasStore.setState({ __nodeDataSnap: undefined });   // S9：半成品最小清理
      message.error('撤销失败，画布状态可能不一致，请刷新页面');
    }
  });
  useCanvasStore.setState({ isApplyingHistory: false });
  return ok ? scheduleSync() : Promise.resolve();
}

export function undoCanvas() { return applyHistory('undo'); }
export function redoCanvas() { return applyHistory('redo'); }
```

- [ ] **Step 7: 运行测试通过**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/canvasHistoryRuntime.test.ts src/stores/nodeStore.test.ts
```
预期：PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/stores/canvasHistoryRuntime.ts apps/web/src/stores/canvasHistoryRuntime.test.ts apps/web/src/stores/nodeStore.ts apps/web/src/stores/nodeStore.test.ts
git commit -m "feat(web): undoCanvas/redoCanvas 包装链——try/finally/进程取消/updateConfig幽灵守卫"
```

---

### Task 5: 拖动与 resize 事务（D1.1 pause + 手动 push + F2 截断 + M-4 兜底）

**Files:**
- Modify: `apps/web/src/stores/canvasHistoryRuntime.ts` 追加 `pushHistorySnapshot` / `beginDragTransaction` / `endDragTransaction` / `withHistoryTransaction`（嵌套安全）
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx`（onNodeDragStart/Stop + 卸载兜底）
- Modify: `apps/web/src/pages/canvas/components/groups/GroupNode.tsx:24-29`、`nodes/ImageGenNode.tsx:1161-1162`、`nodes/VideoGenNode.tsx:736-737`、`nodes/TextInputNode.tsx:157-158`
- Test: canvasHistoryRuntime.test.ts 追加

- [ ] **Step 1: 写失败测试（M4：先置数再 clear 建立基线）**

```ts
// canvasHistoryRuntime.test.ts 追加：
import { beginDragTransaction, endDragTransaction, withHistoryTransaction } from './canvasHistoryRuntime';
import { HISTORY_LIMIT } from './canvasHistory';

describe('拖动/resize 事务（D1.1）', () => {
  const nodeA = () => ({ id: 'a', type: 'textInput' as const, position: { x: 0, y: 0 }, data: {} });

  beforeEach(() => {
    useCanvasStore.setState({ nodes: [nodeA()] as any, edges: [], _isPointerInteraction: false, isHydrating: false, projectId: null });
    useCanvasStore.temporal.getState().clear();   // 节点已在，历史清零（M4 基线；projectId:null 防残留 pending timer——五审 M-4）
  });

  it('pause 期间 set 不记录；endDrag 后恰好一条（拖动前快照，无 dragging）', () => {
    beginDragTransaction();
    useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 50, y: 50 } } as any], edges: [] });
    useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 99, y: 99 } } as any], edges: [] });
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);   // pause 中不记录
    endDragTransaction();
    const past = useCanvasStore.temporal.getState().pastStates;
    expect(past.length).toBe(1);                                            // 恰好一条
    expect(past[0].nodes[0].position).toEqual({ x: 0, y: 0 });              // 拖动前
    expect(past[0].nodes[0].dragging).toBeFalsy();
  });

  it('endDrag push 使 futureStates 清空', async () => {
    useCanvasStore.setState({ nodes: [] as any, edges: [] });
    await undoCanvas();
    expect(useCanvasStore.temporal.getState().futureStates.length).toBe(1);
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.setState({ nodes: [nodeA()] as any, edges: [] });        // 基线
    beginDragTransaction();
    useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 5, y: 5 } } as any], edges: [] });
    endDragTransaction();
    expect(useCanvasStore.temporal.getState().futureStates.length).toBe(0); // 新操作清 future
  });

  it('F2：手动 push 同步 limit 截断', () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      beginDragTransaction();
      useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: i, y: 0 } } as any], edges: [] });
      endDragTransaction();
    }
    expect(useCanvasStore.temporal.getState().pastStates.length).toBeLessThanOrEqual(HISTORY_LIMIT);
  });

  it('_isPointerInteraction 事务内为 true，结束复位；endDragTransaction 幂等（M-4 兜底可安全重入）', () => {
    beginDragTransaction();
    expect(useCanvasStore.getState()._isPointerInteraction).toBe(true);
    endDragTransaction();
    expect(useCanvasStore.getState()._isPointerInteraction).toBe(false);
    expect(() => endDragTransaction()).not.toThrow();   // 未 begin 时直调（卸载兜底路径）
  });

  it('B-1：空拖动（无 set / 结构未变 / snapToGrid 回原位）不产生幽灵历史', () => {
    beginDragTransaction();
    endDragTransaction();                                              // 完全无 set（mousedown 即 mouseup）
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);
    beginDragTransaction();
    useCanvasStore.setState({ nodes: [nodeA()] as any, edges: [] });   // set 了但结构与快照相同（回原位）
    endDragTransaction();
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);
  });

  it('B-1：withHistoryTransaction 内无结构变化不 push', () => {
    withHistoryTransaction(() => {
      useCanvasStore.setState({ selectedId: 'x' });                    // 非 partialize 字段
    });
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);
  });

  it('五审 C-1 回归：拖动中 TD-Pos 写 nodeStore（新引用）→ endDrag 后仍恰好 1 条且首次 undo 即回原位', async () => {
    useNodeStore.setState({ nodes: { a: { id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} as any } } });
    beginDragTransaction();
    useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 99, y: 99 } } as any], edges: [] });
    // 模拟 TD-Pos（canvasStore.ts:544-561）：拖动中把新 position 写进 nodeStore 新引用
    useNodeStore.setState({ nodes: { a: { id: 'a', type: 'textInput', position: { x: 99, y: 99 }, data: {} as any } } });
    endDragTransaction();
    const past = useCanvasStore.temporal.getState().pastStates;
    expect(past.length).toBe(1);                                        // 旧顺序（resume→push→复位）此处为 2：复位 set 的 pre(旧snap)/post(catch-up新snap) 不等被 zundo 记录
    await undoCanvas();
    expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 0, y: 0 });   // 首次 undo 即回原位，无"按了没反应"
  });

  it('五审 M-1：同一手势重复 beginDragTransaction 不覆盖首个快照', () => {
    beginDragTransaction();
    useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 5, y: 5 } } as any], edges: [] });
    beginDragTransaction();                                             // RF 边缘场景重复触发 Start
    useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 9, y: 9 } } as any], edges: [] });
    endDragTransaction();
    const past = useCanvasStore.temporal.getState().pastStates;
    expect(past.length).toBe(1);
    expect(past[0].nodes[0].position).toEqual({ x: 0, y: 0 });          // 首个拖动前快照，非 x:5
  });

  it('M-4 时序：RF dragStart 前节点已 dragging:true → 快照被 sanitize 为 false', () => {
    useCanvasStore.setState({ nodes: [{ ...nodeA(), dragging: true } as any], edges: [] });
    useCanvasStore.temporal.getState().clear();                         // 该 set 结构未变，无历史
    beginDragTransaction();
    useCanvasStore.setState({ nodes: [{ ...nodeA(), dragging: true, position: { x: 7, y: 7 } } as any], edges: [] });
    endDragTransaction();
    const past = useCanvasStore.temporal.getState().pastStates;
    expect(past.length).toBe(1);
    expect(past[0].nodes[0].dragging).toBeFalsy();
    expect(past[0].nodes[0].position).toEqual({ x: 0, y: 0 });          // 拖动前
  });

  it('withHistoryTransaction：同步多 set 压成一条历史（Task 9 组操作复用）', () => {
    withHistoryTransaction(() => {
      useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 1, y: 1 } } as any], edges: [] });
      useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 2, y: 2 } } as any], edges: [] });
      useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 3, y: 3 } } as any], edges: [] });
    });
    const past = useCanvasStore.temporal.getState().pastStates;
    expect(past.length).toBe(1);
    expect(past[0].nodes[0].position).toEqual({ x: 0, y: 0 });              // 操作前快照
    expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 3, y: 3 });
  });

  it('withHistoryTransaction：嵌套直通——外层统一 1 条历史（handleDelete N+1 循环用）', () => {
    withHistoryTransaction(() => {
      useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 1, y: 1 } } as any], edges: [] });
      withHistoryTransaction(() => {
        useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 2, y: 2 } } as any], edges: [] });
      });
      expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0); // 外层仍 pause 中
    });
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });

  it('withHistoryTransaction：fn 抛错也 push 且 resume（不卡 pause）', () => {
    expect(() => withHistoryTransaction(() => {
      useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 9, y: 9 } } as any], edges: [] });
      throw new Error('x');
    })).toThrow('x');
    useCanvasStore.setState({ nodes: [nodeA()] as any, edges: [] });        // resume 后恢复记录
    expect(useCanvasStore.temporal.getState().pastStates.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/canvasHistoryRuntime.test.ts -t "事务"
```
预期：FAIL

- [ ] **Step 3: 实现（canvasHistoryRuntime.ts 追加；S6：push 共用 + 嵌套安全事务，拖动为跨事件两段式）**

```ts
import { HISTORY_LIMIT, structuralEquality } from './canvasHistory';

/** F2：手动 push 快照 + limit 截断 + 清 future（拖动/resize/多 set 事务共用） */
function pushHistorySnapshot(snap: HistoryPartial) {
  const t = useCanvasStore.temporal.getState() as { pastStates: HistoryPartial[]; futureStates: HistoryPartial[] };
  const next = [...t.pastStates, snap];
  if (next.length > HISTORY_LIMIT) next.shift();
  useCanvasStore.temporal.setState({ pastStates: next, futureStates: [] });
}

let dragStartSnapshot: HistoryPartial | null = null;

/** D1.1：dragStart/resizeStart 调用——拍拖动前快照并暂停记录（跨事件两段式）。
 *  五审 M-1：重入守卫——同一手势重复 Start 忽略，保住首个拖动前快照。
 *  顺序 snapshot→pause→set：flag 置位全程在 pause 窗口内（与 end 对称），不产生记录 */
export function beginDragTransaction() {
  if (dragStartSnapshot) return;
  dragStartSnapshot = historyPartialize(useCanvasStore.getState());
  useCanvasStore.temporal.getState().pause();
  useCanvasStore.setState({ _isPointerInteraction: true });
}

/** D1.1：dragStop/resizeEnd/拖动中断兜底（M-4）调用——恢复记录并 push 拖动前快照。
 *  B-1：push 前 equality 守卫——空拖动（mousedown 未移动即 mouseup，RF 仍触发 Start/Stop）、
 *  snapToGrid 回原位、resize 尺寸未变时结构相等，不 push（防 Ctrl+Z "按了没反应"+浪费历史深度）。
 *  五审 C-1：复位必须在 resume **之前**——zundo equality 比较同一次 set 的 pre/post partialize
 *  （源码实证），resume 后复位的 set 其 pre 侧（flag=true → I-1 跳过采样=旧 snap）与 post 侧
 *  （flag=false → catch-up 采样=TD-Pos 拖动中新 position，:544-561 每帧写 nodeStore）不等
 *  → push `{新结构+旧snap}` 幽灵条目，首次 undo 视觉无反应。pause 窗口内 set 被
 *  temporalHandleSet 首行 isTracking 检查整体丢弃。
 *  幂等：未 begin 时直调仅复位 + resume，无快照可 push，安全（M-4 兜底路径） */
export function endDragTransaction() {
  if (dragStartSnapshot) {
    // 复位前计算 changed：此刻 flag 仍 true → I-1 复用 begin 时缓存，structuralEquality
    // 只比 nodes/edges 结构字段——拖动中途的 nodeStore 数据变化（进程状态等）属 S-1 范围外
    const current = historyPartialize(useCanvasStore.getState());
    const changed = !structuralEquality(dragStartSnapshot, current);
    useCanvasStore.setState({ _isPointerInteraction: false });   // pause 窗口内复位，不记录（C-1）
    useCanvasStore.temporal.getState().resume();
    if (changed) pushHistorySnapshot(dragStartSnapshot);          // temporal.setState，不触发 canvas 包装 set
    dragStartSnapshot = null;
  } else {
    useCanvasStore.setState({ _isPointerInteraction: false });
    useCanvasStore.temporal.getState().resume();
  }
}

let txDepth = 0;

/** S6：同步多 set 操作（组 action 多 set 段 / handleDelete 批量删除）压成一条历史；
 *  嵌套直通（内层不拍快照不 resume，外层统一 push）；不碰 _isPointerInteraction；
 *  B-1：结构无变化（防御性提前 return 路径等）不 push；
 *  五审 L-3：fn 抛错时 finally 仍比较并 push 快照——「操作失败到一半」也可 undo 回操作前，
 *  失败安全语义，勿改为抛错不记录 */
export function withHistoryTransaction(fn: () => void) {
  if (txDepth > 0) { fn(); return; }
  const snap = historyPartialize(useCanvasStore.getState());
  useCanvasStore.temporal.getState().pause();
  txDepth++;
  try {
    fn();
  } finally {
    txDepth--;
    useCanvasStore.temporal.getState().resume();
    const current = historyPartialize(useCanvasStore.getState());
    if (!structuralEquality(snap, current)) pushHistorySnapshot(snap);
  }
}
```

（endDrag 内 复位→resume→push 为同步连续执行；resume/push 均为 temporal store 的 set，不触发 canvas 包装 set——单线程无插入窗口）

- [ ] **Step 4: CanvasView 挂钩 + M-4 卸载兜底**

CanvasView.tsx `<ReactFlow` JSX（约 340-365 行），现有 `onNodeDragStop={onNodeDragStopIntoGroup}`（:360）附近改造：

```tsx
import { useEffect, useCallback } from 'react';   // useEffect 若已 import 则不重复
import { beginDragTransaction, endDragTransaction } from '@/stores/canvasHistoryRuntime';

// 组件体内：
const handleNodeDragStart = useCallback(() => beginDragTransaction(), []);
const handleNodeDragStop = useCallback((e: any, node: any) => {
  endDragTransaction();
  onNodeDragStopIntoGroup(e, node);   // 既有拖入组逻辑保持
}, [onNodeDragStopIntoGroup]);

// M-4：RF v12 无 onNodeDragCancel——拖动中断（pointercancel/卸载/路由切换）时兜底收尾，
// 防 temporal 永久 pause + _isPointerInteraction 永久 true（历史记录与 undo/redo 全局失效）
useEffect(() => () => {
  if (useCanvasStore.getState()._isPointerInteraction) endDragTransaction();
}, []);

// JSX：
onNodeDragStart={handleNodeDragStart}
onNodeDragStop={handleNodeDragStop}
```

（M-2 显式决策：拖入组是 **2 步 undo 粒度**——endDrag 先 push「拖动前」快照，随后 onNodeDragStopIntoGroup → dropIntoGroup 事务再 push「拖后未入组」快照；Ctrl+Z 第 1 次撤销组归属（回拖后位置），第 2 次撤销拖动本身。合理粒度，非缺陷）

（`useCanvasStore` 若未在该文件 import 需补；卸载兜底测试见 Step 7）

- [ ] **Step 5: GroupNode resize 事务**

GroupNode.tsx `<NodeResizer`（24-29 行，现有 `onResizeEnd={() => useCanvasStore.getState().markManuallyResized(id)}`）改造：

```tsx
import { beginDragTransaction, endDragTransaction } from '@/stores/canvasHistoryRuntime';
// ……
<NodeResizer
  // ……现有其他 props 保持……
  onResizeStart={() => beginDragTransaction()}
  onResizeEnd={() => { endDragTransaction(); useCanvasStore.getState().markManuallyResized(id); }}
/>
```

（markManuallyResized 为 data-only set，事务外不进历史）

- [ ] **Step 6: 其余三个 resizer 组件挂钩（同模式）**

- `nodes/ImageGenNode.tsx:1161-1162`：组件内既有 `handleResizeStart`/`handleResizeEnd` 函数体首行分别追加 `beginDragTransaction();` / `endDragTransaction();`
- `nodes/VideoGenNode.tsx:736-737`：同上
- `nodes/TextInputNode.tsx:157-158`（NodeResizeControl）：

```tsx
import { beginDragTransaction, endDragTransaction } from '@/stores/canvasHistoryRuntime';
// ……
onResizeStart={() => { beginDragTransaction(); setIsResizing(true); }}
onResizeEnd={() => { endDragTransaction(); setIsResizing(false); }}
```

- [ ] **Step 7: M-4 卸载兜底组件测试（CanvasView.test.tsx——该文件 canvasStore 为整体 mock（:35-70），须同步扩 mock）**

测试文件顶部 vi.mock 区追加 + canvasStore mock 工厂的 `getState`（:59-62）扩一个字段：

```tsx
// 顶部 mock 区追加（mockPointer 需 vi.hoisted 保证提升后可用）：
const mockPointer = vi.hoisted(() => ({ interaction: false }));
vi.mock('@/stores/canvasHistoryRuntime', () => ({
  beginDragTransaction: vi.fn(),
  endDragTransaction: vi.fn(),
}));

// canvasStore mock 工厂 getState 改为（仅追加 _isPointerInteraction 行，其余保持）：
getState: () => ({
  pendingMediaFile: mockPendingMediaFile,
  requestAddMediaNode: vi.fn(),
  _isPointerInteraction: mockPointer.interaction,
}),
```

describe 内追加用例：

```tsx
it('M-4：拖动中卸载组件触发 endDragTransaction 兜底（防 temporal 永久 pause）', async () => {
  const { endDragTransaction } = await import('@/stores/canvasHistoryRuntime');
  const { unmount } = render(
    <ReactFlowProvider><CanvasView /* 复用本文件既有用例的最小 props 组合 */ /></ReactFlowProvider>
  );
  mockPointer.interaction = true;      // 模拟 beginDrag 已发生（真实 store 的 _isPointerInteraction=true）
  unmount();
  expect(endDragTransaction).toHaveBeenCalled();
  mockPointer.interaction = false;     // 还原，防污染同文件其他用例
});
```

- [ ] **Step 8: 运行测试 + 相关组件测试**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/canvasHistoryRuntime.test.ts src/pages/canvas/components/groups/GroupNode.test.tsx src/pages/canvas/components/CanvasView.test.tsx src/pages/canvas/components/nodes/
```
预期：PASS

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/stores/canvasHistoryRuntime.ts apps/web/src/stores/canvasHistoryRuntime.test.ts apps/web/src/pages/canvas/components/CanvasView.tsx apps/web/src/pages/canvas/components/groups/GroupNode.tsx apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx apps/web/src/pages/canvas/components/nodes/TextInputNode.tsx
git commit -m "feat(web): 拖动/resize/多set事务——pause+push前快照+limit截断+嵌套直通+卸载兜底"
```

---

### Task 6: hydrate 时序 + 项目切换/错误路径清栈（含 B-2；withHistoryPaused 已在 Task 3 Step 4 定义并测试）

**Files:**
- Modify: `apps/web/src/stores/canvasHistoryRuntime.ts` 追加
- Modify: `apps/web/src/pages/canvas/page.tsx:37-96`（loadProjectIntoStore）、`:120-125`（切换清空）、`:152/:157/:168`（错误路径）、`apps/web/src/pages/canvas/hooks/useCanvasPersistence.ts:31-81`
- Test: canvasHistoryRuntime.test.ts 追加；useCanvasPersistence.test.ts 清理 groupHistory 引用；page.test.tsx 补 runtime mock + B-2 用例

- [ ] **Step 1: 写失败测试**

```ts
// canvasHistoryRuntime.test.ts 追加：
import { hydrateLoaded } from './canvasHistoryRuntime';

describe('hydrateLoaded', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });
    useCanvasStore.temporal.getState().clear();
  });

  it('清空 past/future（防 undo 到上一个项目）', () => {
    useCanvasStore.setState({ nodes: [] as any, edges: [] });   // 产生 1 条历史
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
    hydrateLoaded();
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);
    expect(useCanvasStore.temporal.getState().futureStates.length).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/canvasHistoryRuntime.test.ts -t "hydrateLoaded"
```
预期：FAIL

- [ ] **Step 3: 实现（canvasHistoryRuntime.ts 追加）**

```ts
/** M7：hydrate 完成（DB 或本地兜底）后调用——清空历史（withHistoryPaused 见 Task 3 Step 4） */
export function hydrateLoaded() {
  useCanvasStore.temporal.setState({ pastStates: [], futureStates: [] });
}
```

- [ ] **Step 4: page.tsx 接入（loadProjectIntoStore）**

```ts
import { withHistoryPaused, hydrateLoaded } from '@/stores/canvasHistoryRuntime';
```

`loadProjectIntoStore` 的 store 写入段（page.tsx:62-94）整体包 `withHistoryPaused`，随后调 `hydrateLoaded()`：

```ts
withHistoryPaused(() => {
  useCanvasStore.setState({ /* 原有 nodes/edges/viewport 写入（62-72 行）原样移入 */ });
  useCanvasStore.getState().applyGroupDerivations();
  for (const g of /* 原有 refitGroupBounds 循环（76-81 行）的筛选表达式 */ []) { /* 原循环体 */ }
  useNodeStore.setState({ nodes: content });   // 原有 content 构造（83-94 行）移入闭包前定义、写入在闭包内
});
hydrateLoaded();
return project.name || '未命名项目';
```

- [ ] **Step 5: B-2——page.tsx 切换清空与三处错误路径**

（1）切换清空段（:120-125）包 `withHistoryPaused`，否则清空动作本身产生一条历史：

```ts
if (target === null || target !== lastPidRef.current) {
  // hydrate 窗口开启：清 store 至 DB 加载/兜底恢复完成期间，抑制本地快照空写
  useCanvasStore.getState().setHydrating(true);
  // B-2：清空不进历史（否则产生一条「上一项目 → 空」的结构历史）
  withHistoryPaused(() => {
    useCanvasStore.setState({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
    useNodeStore.setState({ nodes: {} });
  });
}
```

（2）三处错误路径补 `hydrateLoaded()`——否则加载失败后 pastStates 残留上一项目状态，Ctrl+Z 跨项目污染：

```ts
// :152（createPromiseRef 二次失败，ProjectInaccessibleError fallback 内）
useCanvasStore.getState().setHydrating(false);
hydrateLoaded();          // B-2：错误路径同样清栈
setLoadError('network');

// :157（loadProjectIntoStore 失败，通用 catch 内）
useCanvasStore.getState().setHydrating(false);
hydrateLoaded();          // B-2
setLoadError(e instanceof ProjectInaccessibleError ? 'inaccessible' : 'network');

// :168（新建项目失败，createPromiseRef catch 内）
useCanvasStore.getState().setHydrating(false);
hydrateLoaded();          // B-2
setLoadError('network');
```

（3）page.test.tsx 顶部补 runtime mock——该文件 canvasStore 为整体 mock（:27）无 temporal 属性，真实 `withHistoryPaused` 会在测试内崩：

```ts
vi.mock('@/stores/canvasHistoryRuntime', () => ({
  withHistoryPaused: (fn: () => any) => fn(),   // 直通执行（mock canvasStore 无 temporal）
  hydrateLoaded: vi.fn(),
}));
```

（4）page.test.tsx 追加 B-2 用例（复制 :389「无参网络错误时进入错误态」用例的全部 Arrange 段——相同 mock 拒绝形态——在断言处追加）：

```ts
it('B-2：加载失败路径清空历史栈（hydrateLoaded 被调，防跨项目 undo 污染）', async () => {
  // ……Arrange 段与 :389 用例完全相同（mock getProject reject 网络错误，渲染页面）……
  await waitFor(() => expect(screen.getByText(/加载失败|重试/)).toBeTruthy());   // 错误态出现（沿用 :389 的断言写法）
  const { hydrateLoaded } = await import('@/stores/canvasHistoryRuntime');
  expect(hydrateLoaded).toHaveBeenCalled();
});
```

- [ ] **Step 6: useCanvasPersistence 接入（快照兜底恢复）**

```ts
import { withHistoryPaused, hydrateLoaded } from '@/stores/canvasHistoryRuntime';
```

恢复 effect（40-80 行）：`setHydrating(true)` 后的 try 块内包 `withHistoryPaused`：

```ts
useCanvasStore.getState().setHydrating(true);
try {
  withHistoryPaused(() => {
    useNodeStore.setState({ nodes: snap.nodes });
    useCanvasStore.setState({ /* 原有 nodes/edges/viewport 写入（43-57 行） */ });
    useCanvasStore.getState().applyGroupDerivations();
    for (const g of /* 原有组 refit 循环（63-77 行）*/ []) { /* 原循环体 */ }
  });
  hydrateLoaded();
} finally {
  useCanvasStore.getState().setHydrating(false);
}
```

- [ ] **Step 7: useCanvasPersistence.test.ts 清理 groupHistory 引用（M-2）**

该测试 `:7` `import { useGroupHistory } from '@/stores/groupHistory';` 删除；`:27` `useGroupHistory.setState({ past: [], future: [] });` 替换为 `useCanvasStore.temporal.getState().clear();`

- [ ] **Step 8: 运行 hooks 与 page 测试**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/canvasHistoryRuntime.test.ts src/pages/canvas/hooks/ src/pages/canvas/page.test.tsx
```
预期：PASS（失败文件按需在 beforeEach clear）

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/stores/canvasHistoryRuntime.ts apps/web/src/stores/canvasHistoryRuntime.test.ts apps/web/src/pages/canvas/page.tsx apps/web/src/pages/canvas/page.test.tsx apps/web/src/pages/canvas/hooks/useCanvasPersistence.ts apps/web/src/pages/canvas/hooks/useCanvasPersistence.test.ts
git commit -m "feat(web): hydrate pause→set→clear→resume + withHistoryPaused + 错误路径清栈"
```

---

### Task 7: 键盘迁移（Ctrl+Z/Ctrl+Y → 全局 + 焦点守卫升级）

**Files:**
- Modify: `apps/web/src/hooks/useGroupKeyboard.ts`
- Test: `apps/web/src/hooks/useGroupKeyboard.test.ts`

- [ ] **Step 1: 侦查现有焦点守卫（S4）**

读 `useGroupKeyboard.ts` 的 `isGroupEditContext`（本 plan 侦查已确认现状：INPUT/TEXTAREA/isContentEditable + activeEditNodeId/activeTransformNodeId）。升级判断（五审 M-3 合并方案）——**不要**用「焦点在画布容器外一律拦截」宽条款（点击侧边栏按钮/面板标题后按 Ctrl+Z 会被误拦 = 新的"按了没反应"）；也**不要**只检测 AntD 弹层（漏掉侧边栏普通输入框，Ctrl+Z 会被画布抢走并误改画布）。合并：INPUT/TEXTAREA/isContentEditable 全局拦截 + AntD 弹层 portal 特征检测：

```ts
export function isGroupEditContext(target: HTMLElement | null): boolean {
  const ns = useNodeStore.getState();
  if (ns.activeEditNodeId !== null || ns.activeTransformNodeId !== null) return true;
  const active = document.activeElement as HTMLElement | null;
  if (active) {
    const tag = active.tagName;
    // 全局文本编辑上下文（含侧边栏普通输入框——target 参数是 keydown 目标，
    // 焦点可能在别处，故对 activeElement 也做同样检查）
    if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) return true;
    // S4（五审 M-3）：AntD 弹层（Select/DatePicker/Dropdown/Cascader/Modal）挂 body 下，
    // 焦点不在画布容器内且非 body 本身——closest 特征检测，避免宽口径误拦
    if (active !== document.body
      && active.closest('.ant-select-dropdown, .ant-picker-dropdown, .ant-dropdown, .ant-cascader-menu, .ant-modal')) return true;
  }
  if (!target) return false;
  const tag = target.tagName;
  return !!(tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable);
}
```

（画布空闲时 activeElement 为 body：非 INPUT、closest 对 body 返回 null → 放行 ✓；点击工具栏按钮后：button 非 INPUT、不在弹层内 → 放行，Ctrl+Z 正常作用于画布 ✓）

- [ ] **Step 2: 写失败测试（mock runtime 模块）**

```ts
// apps/web/src/hooks/useGroupKeyboard.test.ts
import { describe, it, expect, vi } from 'vitest';
import { resolveGroupShortcut, isGroupEditContext } from './useGroupKeyboard';

vi.mock('@/stores/canvasHistoryRuntime', () => ({ undoCanvas: vi.fn(), redoCanvas: vi.fn() }));

describe('resolveGroupShortcut undo/redo 映射（S5：含 Ctrl+Y）', () => {
  it('ctrl+z → undo；ctrl+shift+z → redo；ctrl+y → redo；meta 兼容', () => {
    expect(resolveGroupShortcut({ ctrlKey: true, altKey: false, shiftKey: false, key: 'z' })).toBe('undo');
    expect(resolveGroupShortcut({ ctrlKey: true, altKey: false, shiftKey: true, key: 'z' })).toBe('redo');
    expect(resolveGroupShortcut({ ctrlKey: true, altKey: false, shiftKey: false, key: 'y' })).toBe('redo');
    expect(resolveGroupShortcut({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'z' } as any)).toBe('undo');
  });
});

describe('isGroupEditContext 焦点守卫（S4）', () => {
  it('INPUT/TEXTAREA/contentEditable 返回 true', () => {
    expect(isGroupEditContext({ tagName: 'INPUT' } as HTMLElement)).toBe(true);
    expect(isGroupEditContext({ tagName: 'TEXTAREA' } as HTMLElement)).toBe(true);
  });
  it('五审 M-3：activeElement 为 INPUT（含侧边栏输入框）→ 拦截', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(isGroupEditContext(null)).toBe(true);
    input.remove();
  });
  it('五审 M-3：activeElement 在 AntD 弹层 portal 内 → 拦截', () => {
    const dropdown = document.createElement('div');
    dropdown.className = 'ant-select-dropdown';
    const option = document.createElement('div');
    option.setAttribute('tabindex', '0');
    dropdown.appendChild(option);
    document.body.appendChild(dropdown);
    option.focus();
    expect(isGroupEditContext(null)).toBe(true);
    dropdown.remove();
  });
  it('五审 M-3：activeElement 为画布外普通按钮 → 放行（点击工具栏后 Ctrl+Z 不被误拦）', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    expect(isGroupEditContext(null)).toBe(false);
    btn.remove();
  });
});
```

（若该文件已有用例，追加 describe；既有 `:25` 的 `useGroupHistory` mock 段同步删除——M-2 清单项）

- [ ] **Step 3: 运行确认失败**

```bash
cd D:/flowweb/apps/web; npx vitest run src/hooks/useGroupKeyboard.test.ts
```
预期：FAIL（Ctrl+Y 未映射 / 焦点守卫未升级）

- [ ] **Step 4: 实现**

文件头：删除 `import { useGroupHistory } from '@/stores/groupHistory';`（:6），追加：

```ts
import { undoCanvas, redoCanvas } from '@/stores/canvasHistoryRuntime';
```

`resolveGroupShortcut` 内 undo/redo 区（:28-31 附近）追加 Ctrl+Y：

```ts
  if (ctrl && !e.shiftKey && k === 'z') return 'undo';
  if (ctrl && e.shiftKey && k === 'z') return 'redo';
  if (ctrl && !e.shiftKey && k === 'y') return 'redo';   // S5
```

`case 'undo':` / `case 'redo':`（约 58-63 行）替换：

```ts
case 'undo':
  e.preventDefault(); void undoCanvas();
  break;
case 'redo':
  e.preventDefault(); void redoCanvas();
  break;
```

`isGroupEditContext` 按 Step 1 代码升级。

- [ ] **Step 5: 运行测试**

```bash
cd D:/flowweb/apps/web; npx vitest run src/hooks/
```
预期：PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/useGroupKeyboard.ts apps/web/src/hooks/useGroupKeyboard.test.ts
git commit -m "feat(web): Ctrl+Z/Y 迁移全局undo + 焦点守卫升级（AntD弹层）"
```

---

### Task 8: deleteNode / deleteTransformNode 顺序反转（三审 B-2，spec D2 采样契约）

**背景：** 现状两 action 均为「先清 nodeStore、后 set canvasStore」（deleteNode :207→:209 / deleteTransformNode :255→:257）。zundo 在 set 时同步采样 nodeStore——先清会导致 `__nodeDataSnap` 缺项，undo 删除恢复不出 prompt/extConfig 等完整配置（违反验收 3）。onNodesChange remove 路径已是正确顺序（set :504 → 清理 :570-575），对齐即可。（注：四审 B-2 为 Task 6 Step 5 的错误路径清栈，两者独立）

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts:199-262`
- Test: `apps/web/src/stores/canvasHistoryRuntime.test.ts` 追加

- [ ] **Step 1: 写失败测试（真实 action，非手工 setState 模拟）**

```ts
// canvasHistoryRuntime.test.ts 追加：
describe('B-2：删除路径采样契约（先 set 后清 nodeStore）', () => {
  const seedNode = (id: string) => {
    useCanvasStore.setState({
      nodes: [{ id, type: 'textGen', position: { x: 1, y: 2 }, data: {} } as any],
      edges: [],
      selectedId: null, projectId: null, nodeProcessMap: {},
    });
    useNodeStore.setState({
      nodes: { [id]: { id, type: 'textGen', position: { x: 1, y: 2 }, data: { prompt: '完整配置', extConfig: { model: 'x' } } as any } },
    });
    useCanvasStore.temporal.getState().clear();
  };

  it('undo 真实 deleteNode → nodeStore data 完整恢复', async () => {
    seedNode('a');
    useCanvasStore.getState().deleteNode('a');
    expect(useNodeStore.getState().nodes.a).toBeUndefined();   // 删除路径已清理
    expect(useCanvasStore.getState().nodes.length).toBe(0);
    await undoCanvas();
    expect(useCanvasStore.getState().nodes.some((nd) => nd.id === 'a')).toBe(true);
    expect((useNodeStore.getState().nodes.a?.data as any).prompt).toBe('完整配置');
    expect((useNodeStore.getState().nodes.a?.data as any).extConfig).toEqual({ model: 'x' });
  });

  it('undo 真实 deleteTransformNode → data 完整恢复', async () => {
    seedNode('t1');
    useCanvasStore.getState().deleteTransformNode!('t1');
    expect(useNodeStore.getState().nodes.t1).toBeUndefined();
    await undoCanvas();
    expect((useNodeStore.getState().nodes.t1?.data as any).prompt).toBe('完整配置');
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/canvasHistoryRuntime.test.ts -t "B-2"
```
预期：FAIL（undo 后 data 为空对象——快照采样时 nodeStore 已被清空）

- [ ] **Step 3: 实现——deleteNode（:199-248）顺序反转**

将 `ns.deleteNode(id)` / `ns.unregisterSaveHandler(id)` 两行从 set 之前移到 set 之后（其余逻辑不动，含组清理与 DB 同步段；`ns` 变量声明保留在原 `const ns = useNodeStore.getState();` 位置或随移动一并下移，DB 段对 `ns.nodes` 的读取不受影响——只按现存节点 id 查询）：

```ts
deleteNode: (id) => {
  // 组清理需在删除前捕获父子关系（filter 后会丢失）
  const prevParentId = get().nodes.find((n) => n.id === id)?.parentId;
  // Cancel any in-progress process for this node
  const state = get();
  state.cancelNodeProcess(id);
  // B-2（spec D2）：结构 set 必须先于 nodeStore 清理——
  // zundo partialize 在 set 时采样 nodeStore，先清会丢失 undo 删除所需的完整 data
  set((s) => ({
    nodes: s.nodes.filter((n) => n.id !== id),
    edges: s.edges.filter((e) => e.source !== id && e.target !== id),
    selectedId: s.selectedId === id ? null : s.selectedId,
  }));
  const ns = useNodeStore.getState();
  ns.deleteNode(id);
  ns.unregisterSaveHandler(id);
  // ……以下组清理（:214-230）与 DB 同步（:231-247）原样不动……
```

- [ ] **Step 4: deleteTransformNode（:250-262）同样反转**

```ts
deleteTransformNode: (id) => {
  const state = get();
  state.cancelNodeProcess(id);
  set((s) => ({
    nodes: s.nodes.filter((n) => n.id !== id),
    edges: s.edges.filter((e) => e.source !== id && e.target !== id),
    selectedId: s.selectedId === id ? null : s.selectedId,
  }));
  const ns = useNodeStore.getState();
  ns.deleteNode(id);
  ns.unregisterSaveHandler(id);
},
```

- [ ] **Step 5: 运行测试 + 全量回归**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/canvasHistoryRuntime.test.ts src/stores/canvasStore.test.ts
```
预期：PASS（既有 deleteNode 相关用例若依赖旧顺序需逐个核对——清理仅位置后移，对外行为不变）

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasHistoryRuntime.test.ts
git commit -m "fix(web): deleteNode/deleteTransformNode 反转为先set后清nodeStore（D2采样契约）"
```

---

### Task 9: 多 set 组操作事务化（M-1，一次操作 = 一条历史）

**依据（plan 头部审计表）：** ungroup(storyboard)/dropIntoGroup(折叠)/convertGroup(分镜→普通)/toggleCollapse(展开)/dropImageIntoStoryboard(imageGen)/deleteNode(组内) 为多 set；handleDelete 为 N+1 循环。**toggleCollapse 决策**：折叠/展开各 1 条历史（width/height 结构字段，undo 恢复尺寸+collapsed 派生）。**updateStoryboardConfig**：单 set 无需事务，语义边界见头部侦查。

**硬约束（五审 C-2）：事务闭包外严禁结构性 canvasStore.setState（含派生 applyGroupDerivations / refitGroupBounds）**——zundo equality 为同一次 set 的 pre/post 比较（源码实证），事务 resume 后尾随的结构 set 会成为独立第 2 条历史，首次 undo 落在「主操作已回滚、派生未随回滚」的中间态（两段式 undo）。非结构 set（selectedId/viewport/isHydrating 等非 partialize 字段）pre/post 相等不记录，留在事务外安全；nodeStore 的 setState 不经 canvas 包装 set，留事务外安全（删除类须满足 Task 8 顺序契约：事务内最后 set 完成后才清 nodeStore）。本 Task 每个 action 改造时逐自审：「该 action 全部 canvasStore 结构 set 已在事务闭包内」。

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts`（ungroup/dropIntoGroup/convertGroup/toggleCollapse/dropImageIntoStoryboard/deleteNode）
- Modify: `apps/web/src/pages/canvas/components/groups/GroupContextMenu.tsx:47-74`
- Test: `apps/web/src/stores/canvasStore.groups.test.ts` 或新建 `canvasStore.tx.test.ts` 追加护栏

- [ ] **Step 1: 写失败护栏测试（每 action 恰好 1 条历史；TDD——先红）**

```ts
// apps/web/src/stores/canvasStore.tx.test.ts（新建，避免既有 groups.test.ts 的 groupHistory 依赖干扰）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';

vi.mock('antd', () => ({ message: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const addText = (id: string, x: number, y: number) => {
  useCanvasStore.setState((s) => ({
    nodes: [...s.nodes, { id, type: 'text', position: { x, y }, data: {} } as any],
  }));
  useNodeStore.setState((s) => ({ nodes: { ...s.nodes, [id]: { id, type: 'text', position: { x, y }, data: {} as any } } }));
};

beforeEach(() => {
  useCanvasStore.setState({ nodes: [], edges: [], selectedId: null, projectId: null, nodeProcessMap: {}, _isPointerInteraction: false, isHydrating: false });
  useCanvasStore.temporal.getState().clear();
  useNodeStore.setState({ nodes: {} });
});

describe('多 set 组操作事务护栏（M-1：恰好 1 条历史）', () => {
  it('ungroup 分镜组 → 1 条（宫格重排 + 解组双 set）', () => {
    // 构造分镜组：两个完成态图片节点 + 打组后转分镜
    addText('img1', 0, 0); addText('img2', 320, 0);
    const gid = useCanvasStore.getState().groupNodes(['img1', 'img2']);
    useCanvasStore.setState((s) => ({
      nodes: s.nodes.map((n) => n.id === gid
        ? { ...n, data: { ...n.data, groupType: 'storyboard', cells: ['img1', 'img2'],
            storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' } } }
        : n),
    }));
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().ungroup(gid);
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });

  it('convertGroup 分镜→普通 → 1 条（主 set + refitGroupBounds 双 set）', () => {
    addText('img1', 0, 0); addText('img2', 320, 0);
    const gid = useCanvasStore.getState().groupNodes(['img1', 'img2']);
    useCanvasStore.setState((s) => ({
      nodes: s.nodes.map((n) => n.id === gid
        ? { ...n, data: { ...n.data, groupType: 'storyboard', cells: ['img1', 'img2'],
            storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' } } }
        : n),
    }));
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().convertGroup(gid, 'normal');
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });

  it('toggleCollapse 折叠 → 1 条；展开 → 1 条（此前无 record，zundo 新增 undoable，显式决策接受）', () => {
    addText('a', 0, 0); addText('b', 300, 0);
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().toggleCollapse(gid);                          // 折叠
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().toggleCollapse(gid);                          // 展开（未手动 resize → refit 路径双 set）
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });

  it('dropIntoGroup 目标组折叠态 → 1 条（toggleCollapse + 主 set）', () => {
    addText('a', 0, 0); addText('b', 300, 0);
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.getState().toggleCollapse(gid);                          // 折叠
    addText('c', 600, 0);
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().dropIntoGroup('c', gid);
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });

  it('deleteNode 分镜组内节点 → 1 条（主 filter + cells 过滤 set）', () => {
    addText('img1', 0, 0); addText('img2', 320, 0);
    const gid = useCanvasStore.getState().groupNodes(['img1', 'img2']);
    useCanvasStore.setState((s) => ({
      nodes: s.nodes.map((n) => n.id === gid
        ? { ...n, data: { ...n.data, groupType: 'storyboard', cells: ['img1', 'img2'],
            storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' } } }
        : n),
    }));
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().deleteNode('img1');
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });

  it('dropImageIntoStoryboard imageGen 路径 → 1 条（五审 L-4 简化护栏；前置已核 :1082-1095：type=imageGen + status=done + 有空位）', () => {
    addText('img1', 0, 0);
    const gid = useCanvasStore.getState().groupNodes(['img1']);
    useCanvasStore.setState((s) => ({
      nodes: s.nodes.map((n) => n.id === gid
        ? { ...n, data: { ...n.data, groupType: 'storyboard', cells: [],
            storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' } } }
        : n),
    }));
    useCanvasStore.setState((s) => ({
      nodes: [...s.nodes, { id: 'img2', type: 'imageGen', position: { x: 600, y: 0 }, data: { status: 'done' } } as any],
    }));
    useNodeStore.setState((s) => ({ nodes: { ...s.nodes, img2: { id: 'img2', type: 'imageGen', position: { x: 600, y: 0 }, data: { status: 'done' } as any } } }));
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().dropImageIntoStoryboard(gid, 'img2');
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });
});
```

（`handleDelete` 的护栏由嵌套事务单测（Task 5）+ 嵌套直通语义保证；`dropImageIntoStoryboard` 简化护栏已补（五审 L-4），浏览器端到端补充验证见 Task 11 Step 4）

- [ ] **Step 2: 运行确认失败**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/canvasStore.tx.test.ts
```
预期：FAIL（ungroup/convertGroup/toggleCollapse 展开/dropIntoGroup 折叠/deleteNode 组内 = 2 条或更多；toggleCollapse 折叠可能恰 1 条——分支差异）

- [ ] **Step 3: ungroup 改造（示范模板）**

canvasStore.ts 文件头 import 区追加：

```ts
import { withHistoryTransaction } from './canvasHistoryRuntime';
```

ungroup（:847-889）：storyboard 分支起至 record 前的主体包事务（normal 分支单 set 同包无害）：

```ts
ungroup: (groupId) => {
  if (get().hasActiveProcessInGroup(groupId)) {
    message.warning('组内有节点正在执行，请等待完成后再操作');
    return;
  }
  const s = get();
  const group = s.nodes.find((n) => n.id === groupId);
  if (!group) return;
  const gd = group.data as any;
  const gp = group.position;
  const childIds = s.nodes.filter((n) => n.parentId === groupId).map((n) => n.id);
  const allNodeIds = [groupId, ...childIds];
  const before = captureBefore(allNodeIds, []);
  withHistoryTransaction(() => {
    if (gd.groupType === 'storyboard') {
      // ……原有 :861-874 宫格重排段原样移入（const cfg/cellH 与 set）……
    }
    // ……原有 :875-883 解组 set 原样移入……
    useNodeStore.getState().deleteNode(groupId);
    get().applyGroupDerivations();
  });
  const after = captureAfter(allNodeIds, []);
  useGroupHistory.getState().record({ label: '解组', nodeIds: allNodeIds, edgeIds: [], before, after });
},
```

（record 段此时保留——Task 10 统一删除；captureAfter 在事务后读最新 store，不受影响）

- [ ] **Step 4: 其余 action 同模式改造（包裹范围 = 该 action 全部结构 set + 派生调用；nodeStore 双写/record 留事务外安全——不经 canvas 包装 set；canvasStore 结构 set 严禁尾随事务外，五审 C-2）**

- `dropIntoGroup`（:949-988）：包裹 `:963 toggleCollapse 调用 + :965 setWithParentOrder + :984 applyGroupDerivations` 整段
- `convertGroup`（:1211-1272）：包裹 `:1237/:1253 set + :1264 refitGroupBounds + :1268 applyGroupDerivations`（两个分支统一包裹）
- `toggleCollapse`（:1295-1326）：包裹 `:1296 set + :1315 set / :1321 refit + syncGroupDataToNodeStore + :1325 applyGroupDerivations` 整体。**动机（M-1）**：不包事务时展开路径 :1296 只改 data.collapsed（结构未变，equality 不记录），:1315/:1321 恢复尺寸时记录的 before 快照是「collapsed=false + 尺寸仍 200×64」的矛盾中间态——undo 会恢复到该矛盾状态；事务包裹后 push 的是操作前一致快照（collapsed=true 200×64）
- `dropImageIntoStoryboard` imageGen 分支（:1093-1108）：包裹 `:1095 addToGroup + :1097 cells set`（multiImageGen 分支 :1060 单 set 不动）
- `deleteNode`（Task 8 改造后形态）：包裹 `主 filter set + 组清理段（:214-230 的 cells set / ungroup 调用）`；ns.deleteNode/unregisterSaveHandler 与 DB 同步段留事务外（顺序契约仍满足：事务内最后 set 完成后 nodeStore 才被清）

- [ ] **Step 5: GroupContextMenu.handleDelete 外层事务（嵌套直通）**

GroupContextMenu.tsx（:29 附近已有 deleteNode selector）：

```tsx
import { withHistoryTransaction } from '@/stores/canvasHistoryRuntime';

const handleDelete = () => {
  // ……既有确认/收集逻辑……
  withHistoryTransaction(() => {
    // ……原有 :59-75 的 deleteNode(childId) 循环 + deleteNode(groupId) + ns 清理……
  });
};
```

- [ ] **Step 6: 运行护栏转绿 + 全量回归**

```bash
cd D:/flowweb/apps/web; npx vitest run src/stores/canvasStore.tx.test.ts; npx vitest run src/stores/ src/pages/canvas/components/groups/
```
预期：PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.tx.test.ts apps/web/src/pages/canvas/components/groups/GroupContextMenu.tsx
git commit -m "feat(web): 多set组操作事务化——ungroup/convert/toggle/dropInto/删除/handleDelete 恰好1条历史"
```

---

### Task 10: groupHistory 退役（14 处 record 删除 + 测试适配）

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts`（13 处 record）、`apps/web/src/hooks/useStitchTask.ts`（1 处）
- Modify: `apps/web/src/stores/canvasStore.groups.test.ts`、`apps/web/src/hooks/useStitchTask.test.ts`（M-2 适配清单；useCanvasPersistence.test.ts 与 useGroupKeyboard.test.ts 已在 Task 6/7 清理）
- Delete: `apps/web/src/stores/groupHistory.ts`、`apps/web/src/stores/groupHistory.test.ts`

- [ ] **Step 1: 写回归护栏（canvasStore.tx.test.ts 追加——退役后组操作走 zundo 全局栈）**

```ts
import { undoCanvas, redoCanvas } from './canvasHistoryRuntime';

describe('组操作历史（groupHistory 退役后）', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null, projectId: null, nodeProcessMap: {} });
    useCanvasStore.temporal.getState().clear();
    useNodeStore.setState({ nodes: {} });
  });

  it('打组产生恰好 1 条历史，undo 可恢复结构', async () => {
    addText('a', 0, 0); addText('b', 300, 0);
    useCanvasStore.temporal.getState().clear();
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
    await undoCanvas();
    const s = useCanvasStore.getState();
    expect(s.nodes.some((nd) => nd.type === 'group')).toBe(false);
    expect(s.nodes.find((nd) => nd.id === 'a')!.parentId).toBeUndefined();
    expect(s.nodes.some((nd) => nd.id === gid)).toBe(false);
  });

  it('解组产生恰好 1 条历史，undo 恢复组', async () => {
    addText('a', 0, 0); addText('b', 300, 0);
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().ungroup(gid);
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
    await undoCanvas();
    expect(useCanvasStore.getState().nodes.some((nd) => nd.id === gid)).toBe(true);
  });
});
```

- [ ] **Step 2: 删除 canvasStore.ts 全部 record 调用（13 处）**

行号（record 调用行）：:843、:888、:922、:946、:987、:1207、:1271、:1285、:1394、:1420、:1471、:1595、:1688。统一处理：

- 删除 `const before = captureBefore(...)` / `const after = captureAfter(...)` / `useGroupHistory.getState().record({...})` 三件套（Task 9 事务包裹后行号有小幅漂移，按 `captureBefore|captureAfter|useGroupHistory` 检索定位）
- 删除因此孤立的 `const allNodeIds` / `const newEdgeIds`（仍被其他逻辑使用的保留）
- 删除文件头部 `import { useGroupHistory, captureBefore, captureAfter } from './groupHistory';`（:20）
- renameGroup（:1274-1286）record 删除后 data-only 不进历史——S-4 语义反转，Step 4 同步改写用例

- [ ] **Step 3: useStitchTask record 删除（:39-51）**

`before` 构造与 `useGroupHistory.getState().record({...})` 段删除 + 文件头 groupHistory import 删除（:6）（拼接产物节点创建是普通结构 set，zundo 自动记录）。

- [ ] **Step 4: 测试适配（M-2 清单剩余两项）**

`canvasStore.groups.test.ts`：
- `:5` import 删除；`:16` `useGroupHistory.setState({ past: [], future: [] })` → `useCanvasStore.temporal.getState().clear()`
- `:160-173`（undo→redo 排序用例）：`useGroupHistory.getState().undo()` / `.redo()` → `await undoCanvas()` / `await redoCanvas()`（从 canvasHistoryRuntime import；断言 expectParentBeforeChild 不变——zundo 回写即快照顺序，打组时 setWithParentOrder 已保证父前子后）
- `:183-195`（rename 可 undo）改写为 S-4 新语义：

```ts
it('renameGroup 为 data-only 变更，不进结构历史（退役后语义，S-4）', () => {
  const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
  useCanvasStore.temporal.getState().clear();
  useCanvasStore.getState().renameGroup(gId, '我的分组');
  expect((useCanvasStore.getState().nodes.find((n) => n.id === gId)!.data as any).name).toBe('我的分组');
  expect((useNodeStore.getState().nodes[gId].data as any).name).toBe('我的分组');   // nodeStore 双写保持
  expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);             // data-only 不产生历史
});
```

- `:197-205`（no-op 不产生历史）：`pastLength()` 断言 → `pastStates.length`（同名 no-op 仍 0 条）

`useStitchTask.test.ts`：
- `:6` import 删除；`:19` `useGroupHistory.getState().clear()` → `useCanvasStore.temporal.getState().clear()`
- `:39` `canUndo()` 断言 → `expect(useCanvasStore.temporal.getState().pastStates.length).toBeGreaterThan(0)`
- `:42-43` undo 回归 → `await undoCanvas()`（import from canvasHistoryRuntime；产物节点消失断言不变——undo 撤销产物节点创建，D2 快照回补 nodeStore，结构层节点移除）

- [ ] **Step 5: 删除 groupHistory.ts 与其测试 + 残留检查**

```bash
git rm apps/web/src/stores/groupHistory.ts apps/web/src/stores/groupHistory.test.ts
```

残留检查用 Grep 工具（B-3：避免 shell grep 跨环境差异）：pattern `groupHistory|useGroupHistory`、path `apps/web/src`、glob `*.{ts,tsx}`。
预期：无匹配（有则清理该引用）

- [ ] **Step 6: 全量测试**

```bash
cd D:/flowweb/apps/web; npx vitest run
```
预期：PASS

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src
git commit -m "refactor(web): groupHistory 退役——14处record删除，组操作统一走 zundo 全局历史"
```

---

### Task 11: 守护测试 + 浏览器端到端验收

**Files:**
- Test: canvasHistoryRuntime.test.ts 追加守护用例

- [ ] **Step 1: D5 快照污染守护 + 多节点一致性 + 双 store 键一致 + S-2 派生守卫**

```ts
describe('D5 不可变纪律守护', () => {
  it('后续 set 不污染 pastStates 中的旧快照节点', () => {
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: { v: 1 } } as any], edges: [] });
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 5, y: 5 }, data: { v: 1 } } as any], edges: [] });
    const snap = useCanvasStore.temporal.getState().pastStates.at(-1)!;   // M5：尾条 = 上一次 set 前状态
    expect(snap.nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(snap.nodes[0].data).toEqual({ v: 1 });
  });

  it('连续 5 次 undo 再 5 次 redo 结构一致（验收 11，S3：多节点累积）', async () => {
    useCanvasStore.temporal.getState().clear();
    const nodes: any[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      nodes.push(n({ id }));
      useCanvasStore.setState({ nodes: [...nodes], edges: [] });   // 累积，非替换
    }
    const finalIds = useCanvasStore.getState().nodes.map((nd) => nd.id).join(',');
    for (let i = 0; i < 5; i++) await undoCanvas();
    expect(useCanvasStore.getState().nodes.length).toBe(0);
    for (let i = 0; i < 5; i++) await redoCanvas();
    expect(useCanvasStore.getState().nodes.map((nd) => nd.id).join(',')).toBe(finalIds);
  });

  it('undo 后 canvasStore 结构与 nodeStore 键集合一致（验收 13，无幽灵/缺失）', async () => {
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.setState({ nodes: [n({ id: 'a' })], edges: [] });
    useCanvasStore.setState({ nodes: [], edges: [] });
    await undoCanvas();
    const csIds = new Set(useCanvasStore.getState().nodes.map((nd) => nd.id));
    const nsIds = new Set(Object.keys(useNodeStore.getState().nodes));
    expect([...csIds].every((id) => nsIds.has(id))).toBe(true);
  });

  it('五审 C-2 语义守护：非 partialize 字段 set 不产生历史（zundo per-set equality 基线，防升级变语义）', () => {
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.setState({ nodes: [n({ id: 'a' })], edges: [] });   // 1 条
    useCanvasStore.setState({ selectedId: 'a' });                      // 非 partialize 字段
    useCanvasStore.setState({ viewport: { x: 10, y: 10, zoom: 1 } });  // 非 partialize 字段
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });
});

describe('S-2：组派生不产生多余历史（一致态守卫）', () => {
  it('父子一致态下 applyGroupDerivations 不产生历史', () => {
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null, projectId: null });
    useCanvasStore.temporal.getState().clear();
    useNodeStore.setState({ nodes: {} });
    // 构造一致态组：groupNodes 后 derivations 已在 action 内跑过，此态为一致态
    useCanvasStore.setState((s) => ({
      nodes: [
        { id: 'g', type: 'group', position: { x: 0, y: 0 }, width: 600, height: 400, data: { groupType: 'normal' } } as any,
        { id: 'c', type: 'text', position: { x: 10, y: 10 }, parentId: 'g', extent: 'parent', data: {} } as any,
      ],
    }));
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().applyGroupDerivations();
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);
  });
});
```

（注：repairStoryboardCells 在父子不一致时会改 parentId/position——该修复路径产出的历史属于真实结构变化，接受；一致态守卫防止常态下的多余历史）

- [ ] **Step 2: 运行 + 全量回归**

```bash
cd D:/flowweb/apps/web; npx vitest run
```
预期：PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/stores/canvasHistoryRuntime.test.ts
git commit -m "test(web): 快照污染守护 + 多节点一致性 + 双store键一致 + 派生零历史守卫"
```

- [ ] **Step 4: 浏览器端到端验收（preview 环境，按 spec 14 条验收）**

启动/复用 preview（api + web），登录 `u1@flowai.dev / Test1234!` 进入 canvas，逐条验证：

1. 添加节点 → Ctrl+Z 消失 → Ctrl+Shift+Z 恢复 → Ctrl+Y 恢复（redo 二选一）
2. 拖动节点到新位置 → Ctrl+Z 回原位（一次到位）→ 刷新浏览器位置正确（查 canvasNode 表 position）
3. 删除节点（Backspace）→ Ctrl+Z 节点/连线/配置 data 全恢复；组右键删除子节点（deleteNode 路径）→ Ctrl+Z data 完整恢复（B-2 验证：prompt 不丢）
4. 连线 → Ctrl+Z 断开 → Ctrl+Shift+Z 恢复
5. Ctrl+G 打组 → Ctrl+Z 解组恢复（一次到位）；折叠组 → Ctrl+Z 恢复展开 + 子节点显式正确
6. 选中组 resize → Ctrl+Z 恢复原尺寸；拖动一半中断（按 Esc 之外方式，如切换标签页回来）后再操作 → 历史仍记录（M-4）
7. 文本输入框内 Ctrl+Z 浏览器原生；打开 AntD Select 下拉时 Ctrl+Z 不误触画布
8. 刷新页面 → Ctrl+Z 无效果；做一个操作后 Ctrl+Z 仅撤销该操作
9. undo 删除 → redo 删除 → 刷新后不复活（查 DB）
10. 快速连按 Ctrl+Z ×5 → Ctrl+Shift+Z ×5 → 结构一致、无 console 报错
11. 撤销一个正在生成的节点创建 → 生成完成后节点不复活（S-1）
12. 验收后清理测试节点（deleteNode 路径），刷新确认干净

- [ ] **Step 5: 最终 Commit（如有修复）**

```bash
git add -A apps/web/src; git commit -m "fix(web): 端到端验收修复收尾"
```

---

## Self-Review 记录（v5）

- **五审落实**：C-1（Task 5 endDrag 复位移入 pause 窗口 + `changed` 复位前计算 + TD-Pos 回归用例）、C-2（Task 9 头部硬约束 + Step 4 措辞 + Task 11 per-set 语义守护用例；非结构 set 经源码实证不产生历史——评审例子机制不成立但结构性尾随 set 风险真实）、H-1（Task 3 timer 内 pid 重读校验 + 用例）、H-2（withHistoryPaused 深度计数 + 定义提前 Task 3 + applyHistory 复用，pause 收敛单一机制）、M-1（begin 重入守卫 + snapshot→pause→set 顺序 + 用例）、M-2（reconcileNodeStore fallback 统一 'videoGen'）、M-3（isGroupEditContext 删宽条款，INPUT/TEXTAREA/contentEditable 全局 + AntD 弹层 closest 合并方案——评审窄口径漏侧边栏普通输入框，已补）、M-4（Task 5 beforeEach 补 projectId:null）、L-1（全文 `_isPointerInteraction`）、L-2（S-1 注释双向）、L-3（抛错 push 语义注释）、L-4（dropImageIntoStoryboard 护栏用例，前置 :1082-1095 已核）
- **Task 6 结构变化**：withHistoryPaused 定义/测试移至 Task 3（Task 4 applyHistory 依赖），Task 6 仅剩 hydrateLoaded + page.tsx 接入 + B-2
- **zundo 源码证据（unpkg zundo@2.3.0/dist/index.js）**：`store.setState` 包装 = `pastState=partialize(get()) → setState(...) → temporalHandleSet(pastState)`；`temporalHandleSet` 首行 `if (!isTracking) return`，随后 `currentState=partialize(get())`，`equality(pastState, currentState)` 相等则跳过；`_handleSet` 本体 push pastState（limit shift 仅此处）；undo/redo 经 `userSet`（zustand 原始 set）应用并直接操作 past/future，不触发包装不重录

- **Spec 覆盖**：D1（Task 1/2）、D1.1（Task 5）、D2（Task 3 纯函数 + Task 8 真实路径顺序契约）、D3（Task 4，守卫仅空栈/_isPointerInteraction/isHydrating 三项 + S-1 进程取消 + I-3 幽灵守卫；isApplyingHistory 为预留字段、当前无消费者）、D4（Task 7，含 Ctrl+Y 与焦点守卫升级）、D5（Task 11）、M7（Task 6 含 B-2 错误路径）、验收 3（Task 8）、验收 5/6（Task 9 事务护栏）——全覆盖
- **四审落实**：B-1（Task 5 双守卫 + 3 用例）、B-2（Task 6 Step 5 四小项：清空包裹/三错误路径清栈/page.test runtime mock/B-2 用例）、B-3（全部命令 `;` 分隔 + grep 改 Grep 工具）、I-1（Task 1 createPartialize 拖动跳过 + 用例）、I-2（Task 3 debounce + fake timers 用例）、I-3（Task 4 updateConfig 双 store 守卫 + 2 用例）、I-4（Task 2 注释改口预留字段）、M-1（Task 9 动机注释）、M-2（Task 5 Step 4 粒度注释）、M-3（头部技术债记录）、M-4（Task 5 时序用例）、M-5（Task 5 Step 7 mock 方案写死）；另自查发现 page.test.tsx 需 runtime mock（四审未提，已入 Task 6）
- **三审落实**：B-1（三模块拆分，头部裁定含全场景求值推演）、B-2（Task 8）、M-1（Task 9 + 头部审计表）、M-2（Task 6/7/10 适配清单全覆盖 7 文件）、M-3（Task 3 runtime 测试双 mock）、M-4（Task 5 Step 4/7 + endDrag 幂等）、S-1（Task 4）、S-2（Task 11 守卫）、S-3（Task 1 cloneSnap）、S-4（Task 10 用例改写 + 头部决策）、N-1（14 处）、N-3（Task 2 冒烟）、N-4（Task 2 自动 limit）
- **类型一致性**：`HistoryPartial`/`NodeDataSnapEntry`/`NodeStoreLike` 贯穿（Task 1 定义、Task 2 实例注入、Task 3/4/5 复用）；`reconcileNodeStore` 纯函数签名（Task 3 定义 = Task 4 调用）；runtime 导出名单在 Task 3/4/5/6 逐步补齐，消费方 import 路径统一为 `@/stores/canvasHistoryRuntime`
- **占位符扫描**：Task 6 Step 4/6「原有 XX 行」为既有代码搬移标注（非待实现）；Task 6 Step 5(4) B-2 用例 Arrange 段指向复制 :389 既有用例（明确指令）；Task 9 Step 4 五个 action 给精确包裹锚点（审计表行号）；无 TBD/TODO
- **命令兼容（B-3）**：全部执行命令 `;` 分隔（bash/PowerShell 双兼容）；残留检查用 Grep 工具表述
