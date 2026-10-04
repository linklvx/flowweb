<!-- doc-status: historical | verified_at: n/a -->
# Spec: 画布 Undo/Redo（结构层，zundo 快照式）

日期：2026-08-25（v5，同日四轮评审修订）
状态：**已冻结**（四审 Approve，S8-S10 已落实）
来源：2026-08-25 讨论（时机/方案选型）+ 外部评审四轮（M/S/N、F1-F3、G1、S8-S10）；zundo 2.3.0 源码已核验

## 背景与决策

- 项目无全局 undo/redo 基础设施；写入路径分散（store action / ConfigPanel / onNodesChange），越晚接入改造面越大
- 决策 1（时机）：现在做，但范围收窄到**画布结构层**——节点增删、位置移动、尺寸调整、连线增删、打组/解组。配置 data 随节点功能演进，暂不纳入
- 决策 2（方案）：**zundo@^2.3.0**（zustand temporal 中间件，peer `^4.3.0 || ^5.0.0`，项目 4.5.5 满足）+ 全量快照。**前提**（评审 N6）：快照式"不需要收敛写入路径"成立的前提是所有结构变更都经 `canvasStore.setState` 且不可变更新（见 D5 写入纪律）
- 官方参照：[React Flow Pro Undo/Redo 示例](https://reactflow.dev/examples/interaction/undo-redo) = 快照式 past/future 栈（源码付费，原理公开）

## 目标 / 非目标

**In scope**
- 结构操作的 undo/redo：添加/删除节点、拖动移动（多选、组整体）、resize（NodeResizer/组缩放）、连线/断线、打组/解组（parentId 变化）
- 一次拖动/一次 resize = 一条历史（事务合并）
- undo/redo 后 DB 同步（复用现有 `syncNodes`/`syncEdges` 全量链路）
- 键盘：Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z、Ctrl+Y

**Out of scope**
- 节点配置 data 的历史（修改 prompt/生成结果不可 undo）
- viewport / selection / isHydrating 等 UI 态
- **历史栈持久化**（刷新/项目切换后历史清空；zundo 的 wrapTemporal+persist 本次不启用）——刷新后位置正确靠的是 undo 后 sync 到 DB，不是历史栈
- 多人协同 undo（Yjs 路线）
- undo/redo 按钮 UI（P2）

## 设计

### D1 历史层接入（zundo temporal）

- 接入点：`canvasStore`（apps/web/src/stores/canvasStore.ts）
- **partialize 返回完整引用，不做字段 pick（G1）**：zundo 的 pastStates 同时是 undo 回写载荷（`userSet(nextState)` 为 zustand 浅合并，`state.nodes` 顶层整体替换）——白名单 pick 的残缺 node（无 `data`/`style`/`measured`/`zIndex`）写回后自定义节点组件读 `node.data.xxx` 直接崩溃。**快照必须可直接写回，字段过滤下沉到 equality 层**（与官方示例一致：partialize 返回完整 `state.nodes`/`state.edges` 引用）
- **dragging sanitize（G1）**：dragStart 瞬间 RF 已置 `node.dragging=true`，完整引用会把它带进 dragStartSnapshot → undo 后节点卡 dragging 态。partialize 内最小 sanitize，非拖动期零 clone：

  ```ts
  nodes: state.nodes.some(n => n.dragging)
    ? state.nodes.map(n => n.dragging ? { ...n, dragging: false } : n)
    : state.nodes
  ```

- **结构过滤下沉到 equality（G1，取代原 M3/M5 的白名单手段）**：equality 只比结构字段，`selected`/`hidden`/`dragging` 变化不触发历史：

  ```ts
  equality: (p, c) =>
    fastDeepEqual(pickStructNodes(p.nodes), pickStructNodes(c.nodes))
    && fastDeepEqual(pickStructEdges(p.edges), pickStructEdges(c.edges))
  // pickStructNodes: 按 {id,type,position,parentId,width,height} 提取（实现选型 plan 定：
  // pick+fastDeepEqual 或手写遍历零临时对象）
  ```

  M3/M5 原诉求全部保持：选中/派生变化不产生历史；undo 不拆"结构→派生"两步（derivations 的 set 被 equality 判等跳过）。代价与语义：selected/hidden 存在于快照引用中——undo 恢复拖动前的选中态是合理 UX；hidden 由 `applyGroupDerivations` 幂等重放覆盖，最终态正确。快照"纯净性"让位于回写正确性
- **`__nodeDataSnap` 字段**：partialize 通过闭包读 `useNodeStore.getState().nodes`，`structuredClone` 深拷贝后作为第三个字段塞进 partial state（机制见 D2）。约束：nodeStore data 必须是纯可序列化数据（无 File/Blob/函数/DOM 引用），否则 structuredClone 抛错
- **采样缓存（F1 性能修复，闭包化防测试串用例）**：源码确认 `store.setState` 包装在 set 前无条件执行第一次 partialize（pause 期间也跑），`temporalHandleSet` 内第二次——不缓存则**每次 set（含拖动中高频 set）跑两次全量 structuredClone**。缓存用**工厂函数闭包**（模块级变量会在 Vitest 多用例间串缓存）：

  ```ts
  function createPartialize() {
    let cachedSnap: Record<string, NodeData> = {};
    let cachedRef: unknown = null;
    return (state: CanvasState) => {
      const ns = useNodeStore.getState();
      if (ns.nodes !== cachedRef) {          // D5 不可变纪律保证更新必产生新引用
        cachedSnap = structuredClone(ns.nodes);
        cachedRef = ns.nodes;
      }
      return { nodes: sanitizeDragging(state.nodes), edges: state.edges, __nodeDataSnap: cachedSnap };
    };
  }
  ```

  nodeStore 未变期间所有 set（UI 态/拖动中）复用同一缓存引用，零深拷贝；多条历史共享同一 snap 引用安全（不可变纪律下不会被 mutate）
- `limit`: 100，提取为共享常量 `HISTORY_LIMIT`（自动路径 zundo 托管 shift；手动 push 路径见 D1.1 同步截断）
- **partialize 提取为独立实例**：`createPartialize()` 工厂在 store 创建时实例化一次，zundo 配置与 D1.1 的 `dragStartSnapshot = partialize(get())` 共用同一实例，防逻辑两处漂移
- **canvasStore 上增加不进 partialize 的内部标志**：`_isDragging` / `isApplyingHistory`（供订阅者与 D3/D5 使用）

### D1.1 拖拽/resize 事务合并（源码核验后的修正方案）

zundo 记录机制（2.3.0 index.js:76-81）：每次主 store set 时 `pastState = partialize(set 前状态)`，set 应用后 push。`pause()`（`isTracking=false`）期间 set 完全跳过记录且**不保留暂停锚点**——若 resume 后靠 set 触发记录，push 的将是"拖动后状态"，产生一条 no-op 历史。

正确方案（**pause + 手动 push 拖动前快照**，不用 tick）：

```
onNodeDragStart:  dragStartSnapshot = partialize(get())；temporal.pause()
拖动中:           set 照常，zundo 跳过记录
onNodeDragStop:   temporal.resume()；
                  temporal.setState(s => {
                    const next = [...s.pastStates, dragStartSnapshot];
                    if (next.length > HISTORY_LIMIT) next.shift();   // F2：手动 push 绕过 _handleSet 的 limit 截断，必须同步截断
                    return { pastStates: next, futureStates: [] };
                  })
```

- `pastStates`/`futureStates` 是 temporal store 公开字段，可直接 set
- undo 时 splice 尾条（拖动前态）→ `userSet` 回写，恰好一条历史；undo 时 `currentState` 自动进 `futureStates`，redo 语义正确
- resize 事务同理：挂 NodeResizer 的 `onResizeStart(event, params)` / `onResizeEnd(event, params)`（@xyflow/react 12 已核验存在）
- 已知边界：`undo()` 不检查 `isTracking`（源码未拦截），拖动中按 Ctrl+Z 会打断拖动——包装层（D3）检查 `_isDragging` 时 no-op

### D2 nodeStore data 跟随规则（关键设计）

**问题**：节点配置 data 存在 nodeStore（不进历史）。删除节点会同步清 nodeStore（TD-11 / 586aa5a 语义）→ undo 删除时 data 已丢。

**采样机制（评审 M2 方案 A）**：partialize 闭包采样（D1），`__nodeDataSnap` 与 pastStates 天然同生共死，limit/future 清空全由 zundo 托管。undo 时 zundo 会把 `__nodeDataSnap` 一并 set 回主 store，包装 undo 中读出后立即清除（D3 步骤 5）。

**写回合成规则（纯函数，双向语义正确）**：

```
nextNodeStore = {}
for node in 目标结构:
  nextNodeStore[node.id] = 当前 nodeStore[node.id] ?? 快照采样[node.id] ?? {}
```

- **undo 拖动**：节点在当前 nodeStore 存在 → data 保留当前值，配置不被回退
- **undo 删除**：节点已不在 nodeStore → 从快照采样回补，配置完整恢复
- **redo 删除**：结构定界，data 不残留 → 不触发「刷新复活」（保持 586aa5a 语义）

**采样时序硬约束（评审 S3，需侦查测试坐实）**：删除路径必须**先 `canvasStore.set`（删结构）→ 后 `nodeStore.deleteNode`（清 data）**。因为采样发生在 canvasStore.set 的同步中间件期间，此时 nodeStore 尚未清理才能采到完整 data；顺序反了采样为空，undo 删除恢复不出配置。代码阅读显示现有 deleteNode/onNodesChange remove 路径满足此序（set 在前、清理在后），**plan 阶段必须有「删除→undo→断言 data 完整恢复」的 TDD 用例坐实，不能只靠阅读假设**。

**采样缓存前提**：D1 的引用比较缓存依赖「nodeStore 的 nodes 更新必产生新引用」——与 D5 写入纪律同源，`updateConfig`/`deleteNode` 等现有路径均为不可变 set，保持即可（无需侵入 nodeStore 加 version 字段）。

### D3 undo/redo 执行链（包装函数，不靠 handleSet）

zundo `undo()` 内部直接 `userSet(nextState)`，无 before/after 钩子；`handleSet` 是 temporal 内部记录 setter 的 throttle 包装器，不在主 store 写回路径上——**副作用链必须用包装 undo/redo**：

```
// isApplyingHistory / _isDragging 是 canvasStore 字段，经 canvasStore.setState 设置（非裸变量）
// _isDragging 由 onNodeDragStart/onNodeDragStop 维护
const undo = () => {
  const t = canvasStore.temporal.getState();
  if (t.pastStates.length === 0 || _isDragging || isHydrating) return;   // 空栈/拖动中/hydrate 中 no-op
  const target = t.pastStates.at(-1);
  canvasStore.setState({ isApplyingHistory: true });
  t.pause();                                             // 防御性提前：保证后续所有 set 都在 pause 区间内
  try {
    t.undo();                                            // userSet 原始 setState 回写 {完整节点/边快照 + __nodeDataSnap}，不二次记录
    reconcileNodeStore(target.__nodeDataSnap);           // D2 合成规则
    applyGroupDerivations();                             // 派生重放（hidden 等不进快照）
    canvasStore.setState({ __nodeDataSnap: undefined }); // 清采样残留（F3：必须在 pause 内）
  } finally {                                            // S9：任一步抛错不得卡死 isApplyingHistory/pause
    t.resume();
    canvasStore.setState({ isApplyingHistory: false });
  }
  scheduleSync();                                        // syncNodes + syncEdges（projectId 非空）
};
const redo = () => {
  const t = canvasStore.temporal.getState();
  if (t.futureStates.length === 0 || _isDragging || isHydrating) return;
  const target = t.futureStates.at(-1);                  // __nodeDataSnap = undo 时在 reconcile 前采样的 nodeStore 态（S8）
  canvasStore.setState({ isApplyingHistory: true });
  t.pause();
  try {
    t.redo();                                            // set 回 {完整节点/边快照 + __nodeDataSnap}
    reconcileNodeStore(target.__nodeDataSnap);           // redo 同样需要 data 合成（redo「删除」→ 结构定界清残留；redo「添加」→ 回补 undo 前 data，见 S8 机制）
    applyGroupDerivations();
    canvasStore.setState({ __nodeDataSnap: undefined });
  } finally {
    t.resume();
    canvasStore.setState({ isApplyingHistory: false });
  }
  scheduleSync();
};
```

- `isApplyingHistory` 供 `onNodesChange`/订阅者识别写回瞬间，避免二次记录或副作用循环
- **useCanvasPersistence 不需要跳过/主动触发**（有意决策）：快照写入本就是 500ms debounce 单写者，undo/redo 链是同步的（一次按键内完成），链内 set 只会重置 debounce 定时器，链结束后 500ms 落最终态——天然合并、无中间态落盘。加"跳过+主动触发"反而引入忘记触发的 bug 面（验收 13 覆盖最终一致性）
- **hydrate 时序（评审 M7）**：项目加载 = `temporal.pause()` → 多次 hydrating set → `temporal.clear()` → `temporal.resume()`。DB 路径与本地快照兜底路径**都**要在恢复完成后 clear；项目切换同理
- **远程回写 skipHistory**：Socket 推送、DB 响应回写 store 的路径统一带 pause 或走 isApplyingHistory 分支，不产生历史。plan 阶段封装 `withHistoryPaused(fn)` helper（pause → fn() → finally resume），防各回写路径手写 pause/resume 漏掉
- **sync 竞态（评审 S4，plan 评估）**：快速连按 undo/redo 时全量 `deleteMany+createMany` 无版本戳，乱序响应后到会旧覆新（REST 全量写模式下客户端无法单方面丢弃已发生的写入）。本次接受 last-write-wins 风险 + 失败日志/toast；串行化请求队列或后端版本戳列为 P2。undo 放大了 sync 失败的用户感知（本地已撤销、刷新后丢失），失败至少 toast 提示

### D4 键盘

- 位置：`CanvasKeyboardHandler`（page.tsx）
- Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z、Ctrl+Y（Mac metaKey 兼容）
- **焦点守卫升级**：INPUT/TEXTAREA/contentEditable 判断之外，AntD Select/DatePicker 弹层焦点可能在 body——判断 `document.activeElement` 是否在画布容器内，或把监听挂画布容器（tabIndex=0）而非 window（plan 定）
- `isHydrating` / `isApplyingHistory` / 拖动中 / 空栈 → no-op

### D5 写入纪律（快照式生命线，评审 M6）

快照结构共享成立的前提：**所有 nodes/edges 更新严格不可变**。任何 `node.position.x = ...` / `node.data.xxx = ...` 就地 mutate 会同时改写 pastStates 里共享的旧引用 → undo 静默失效且难排查。

- 所有结构变更走不可变更新（applyNodeChanges / map 新数组新对象 / Immer 均可）
- 禁止就地 mutate node/edge 对象及 nodeStore 的 data 对象（nodeStore 现有 updateConfig 已是不可变模式，保持）
- **守护测试**：单测断言操作后 `pastStates` 中旧快照节点未被污染（开发期 Object.freeze 快照节点断言亦可）；排查存量代码中的就地 mutate 是 plan 阶段侦查项
- ESLint 规则（no-param-reassign 等）作为可选加强

## 验收标准

1. 添加节点 → Ctrl+Z 节点消失 → Ctrl+Shift+Z 恢复（位置一致）
2. 拖动节点（含多选拖动）→ Ctrl+Z 回原位置，**仅一条历史**（`pastStates.length` 增量为 1，中间轨迹不可逐步撤销）→ 刷新浏览器位置正确（undo 后 DB 已同步）
3. 删除节点（含自动清理的连线）→ Ctrl+Z 节点、连线、**节点配置 data**（prompt/fileId 等）全部恢复
4. 连线 → Ctrl+Z 连线消失 → redo 恢复
5. 打组/解组 → Ctrl+Z 恢复结构（parentId/子节点关系），**组子节点 hidden 派生正确**（折叠组/展开组各验一次）
6. resize 节点/组 → Ctrl+Z 恢复原尺寸（一条历史）
7. 修改节点配置（如 prompt）→ Ctrl+Z 无结构变化、`pastStates.length` 不增（配置不进历史）
8. 文本输入框内 Ctrl+Z 为浏览器原生行为；AntD 下拉打开时画布 undo 不误触
9. 加载项目后立即 Ctrl+Z 无效果；**加载后做一个操作再 undo，仅撤销该操作**（两个子场景都验）
10. undo 删除后再 redo 删除 → 刷新浏览器节点不复活
11. 连续 5 次 undo 再 5 次 redo → 结构与初始一致
12. limit 溢出可测化：**连续 200 次结构操作（含拖动/resize/增删）后 `pastStates.length ≤ HISTORY_LIMIT(100)`**
13. undo/redo 后 `useCanvasPersistence` 的 localStorage 快照与最终结构一致（无脏写）
14. undo 回写后 node 对象保留 `data`/`style`/`measured`/`zIndex` 等渲染字段（G1：快照为完整引用，单测断言 + 浏览器自定义节点渲染不崩溃）

## 已知限制

- **redo「添加节点」会恢复 undo 时的 data（机制说明，S8 修正）**：zundo undo 在 `userSet` 前、reconcile 前采样 `currentState`（此时 nodeStore 仍含被 undo 节点的 data）→ 随 currentState 进 futureStates；redo 时 reconcile「当前无 → 快照回补」恢复完整 data（含 undo 前配置的 prompt）。与「undo 删除恢复 data」对称，是正确行为而非限制。若 undo 后执行了任何新操作（futureStates 清空），data 不可恢复——仍符合「配置不单独进历史」的边界
- **引用文件不可逆**：删除时 `ns.deleteNode` 的 MinIO 引用 DELETE 照常执行（防泄漏）→ undo 恢复的节点若引用文件已物理删除，图片 fallback 显示。P2：恢复时在 data 标 `fileMissing` 让 UI 显式提示（评审 N3）；更远期评估延迟引用删除
- **进行中任务**：删除生成中节点会 cancelNodeProcess，undo 恢复后**任务已取消、节点回到无结果空闲态，用户可重新触发生成**（评审 N4 表述）
- nodeStore saveHandler 注册表不随 undo 恢复（ConfigPanel 重挂载时重新注册；undo 仅改 parentId 不卸载节点时引用是否陈旧，plan 读注册表实现确认——N2）
- sync 乱序 last-write-wins 风险（见 D3）

## 修订记录

| 编号 | 级别 | 修订 |
|------|------|------|
| M1 | Must | 拖拽合并：pause/resume + **手动 push 拖动前快照**（评审原 tick 方案经源码推演会产生 no-op 历史，已修正） |
| M2 | Must | 采样机制 = partialize 闭包 + structuredClone + `__nodeDataSnap` |
| M3 | Must | partialize 改结构字段白名单（本 spec 补入 width/height） |
| M4 | Must | 包装 undo/redo + isApplyingHistory |
| M5 | Must | hidden 不进快照；derivations 期间 pause |
| M6 | Must | 新增 D5 写入纪律 + 守护测试 |
| M7 | Must | hydrate = pause→set→clear→resume；远程回写 skipHistory |
| S1-S7 | Should | deep equality、配置取舍文档化、采样时序硬约束、sync 竞态、历史不持久化、快捷键守卫、内存评估 |
| N1-N6 | Nit | zundo@^2.3.0、saveHandler 核实、fileMissing、任务态表述、补验收 5 条、前提补全 |
| F1 | Must（二轮） | partialize 采样缓存（源码确认每次 set 双跑且 pause 期也跑一次）；修法改进为 **nodes 引用比较缓存**（零侵入，优于 nodeStore 加 version） |
| F2 | Must（二轮） | 手动 push 同步 limit 截断，`HISTORY_LIMIT` 共享常量 |
| F3 | Must（二轮） | 清 `__nodeDataSnap` 移入 pause 区间（resume 后会走完整记录路径）；补全 redo 包装步骤；no-op 守卫加 isHydrating |
| S(二轮) | Should | equality 排除 `__nodeDataSnap`；partialize 提取共用；redo 补 reconcile；验收 12 可测化。**persistence 跳过/主动触发不采纳**——500ms debounce 单写者天然合并同步 undo 链，spec 记录为有意决策 |
| N(二轮) | Nit | onSave 在 push 前调用且参数为 partialized 态（plan 注释记录）；D2 时序约束需 TDD 侦查用例坐实 |
| G1 | Must（三轮） | **partialize 返回完整引用 + dragging sanitize，结构过滤下沉到 equality**——pastStates 同时是 undo 回写载荷（userSet 浅合并整体替换 state.nodes），白名单 pick 的残缺 node 写回后自定义组件崩溃；原 M3/M5 的白名单手段作废，原诉求（UI/派生态不触发历史）由 equality 结构比较保持 |
| S(三轮) | Should | F1 缓存闭包化（`createPartialize()` 工厂，防 Vitest 模块级缓存串用例）；equality 结构比较需单测覆盖（只改 selected/hidden 不增历史、改 position/parentId/width/height 增历史，防后人换回完整比较） |
| N(三轮) | Nit | resize 回调名核验（onResizeStart/onResizeEnd）；plan 第一件事读 saveHandler 注册/注销实现（确认 undo 改 parentId 不卸载节点时回调是否陈旧） |
| S8 | Should（四轮） | 「已知限制」第一条改写为机制说明：redo add 实际恢复 undo 时的 data（undo 在 reconcile 前采样 currentState 进 futureStates，源码核验成立），与 undo 删除对称，非限制 |
| S9 | Should（四轮） | D3 undo/redo 链 try/finally 包裹（防 isApplyingHistory 卡 true / temporal 卡 pause）；t.pause() 防御性提前 |
| S10+Nit(四轮) | Should/Nit | D3 注释残留「结构白名单」修正为完整快照；isApplyingHistory/_isDragging 注明为 store 字段经 setState 设置；`withHistoryPaused(fn)` helper 封装远程回写 |

## 冻结状态

四轮评审全部关闭（M1-M7 / F1-F3 / G1 / S8-S10 / N 系列均有落点或不采纳有据）。可进入 plan。plan 阶段注意：第一件事读 useNodeStore saveHandler 注册/注销实现；groupHistory 既有组撤销设施的共存/迁移决策是 plan 关键设计点。
