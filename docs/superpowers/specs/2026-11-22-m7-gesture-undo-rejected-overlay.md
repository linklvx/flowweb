# Spec：m#7 一行修小批——手势中 undo/redo 被**拒**须保留进行中覆盖层

日期：2026-11-22 ｜ 状态：用户已确认（2026-11-22 施工勘正版——本版取代同日初稿，初稿三处与仓库对不上已勘正）
前置：Y4a 批已销案推送（85cd2728）；m#7 为 Y4a 终审批外债第 3 条。
体例：单件行为修复小批，本文件即完整 spec+施工单。

## 0. 根因（按现码）

**timelineUndo/timelineRedo（timelineUndo.ts:152-178）**：返回 false 只有四条路径——无 manager、undoStack 空（undo）/redoStack 空（redo）、undo 装回字节超 RESTORE_GATE_BYTES（520192，仅 undo 侧；**timelineRedo 无装回闸**）。四条都在 `um.undo()/um.redo()` **之前** return——不开 Y.Transaction、observeDeep 不会在返回前跑。装回闸只写诊断环并异步 `import('antd')`。

**editorStore.ts:634-652 现码**：`pendingOverlay = null` 在弹栈调用之前无差别执行（I#1 序——成功弹栈的读回同步要求）；`set({..., pendingOverlay: null})` 只在成功路径。被拒后进入**分裂态**：模块变量已空、Zustand 镜像仍是原会话对象。

**分裂态危害（原文「一次手势丢失」只是第一拍）**：
1. observeDeep 看模块变量——抑制窗失效，拖拽剩余时间内远端合入整表 setState 盖掉本地 transient；
2. endTransient 看模块变量——这一笔不落 doc（早退 return false 不写 state）；
3. TimelinePanel 用镜像决定 beginTransient（`!es.pendingOverlay && !pointerMovedOnce`）——镜像一直为真，下一次拖拽不再开会话，模块变量继续 null，后续松手全不落笔。拖拽提交停到下一次成功弹栈、重载或换绑。**协作粘滞**。

## 1. §0 有效规则（单条）

**作废覆盖层当且仅当历史事务真的发生**。成功与否只有 timelineUndo/timelineRedo 知道，I#1 又要求 null 化在 `um.undo()` 之前。不预判（空栈/装回闸不重写一份）、不把 null 塞进 timelineUndo（栈模块不得持有编辑器会话）。**补偿括号留在覆盖层拥有者（editorStore undo/redo）里**：投机关掉抑制窗，未发生事务就按引用放回。成功路径的先后与现状相同；被拒分支**禁止 set**（镜像保持进入时对象——TimelinePanel 仍认为手势在进行）。

undo/redo 改形（两处同形）：

```ts
undo: () => {
  const s = get();
  const saved = pendingOverlay;
  pendingOverlay = null;
  const ok = timelineUndo();
  if (!ok) {
    pendingOverlay = saved;
    return false;
  }
  const next = get().data;
  set({ selectedClipId: null, selectedKeyframeId: null, pendingOverlay: null });
  if (s.sourceNodeId && next) afterStructuralChange(s.sourceNodeId, next);
  return true;
},
```

I#1 注释块补一句：**历史跳转（成功弹栈）作废覆盖层；被拒（无 manager、栈空、undo 装回闸）保留模块级覆盖层，且不写 state 镜像**。被拒安全依据=§0 四条返回都在 `um.undo()/um.redo()` 之前。

**不动**：endTransient、timelineUndo、timelineRedo 本体。不改 doc 形状、无迁移。editorStore.ts 不在 check-collab-module-size 行数锚里。

## 2. 测试锚（TDD——先红在 endTransient() === false）

editorStore.timeline.spec.ts 现有 20 条 it 不动；在「拖拽中 Ctrl+Z」那条**旁边**新增一条。

**夹具纪律**：setupHydrated() 种子事务是 local-user、UndoManager 只跟踪 timeline-user——水合后 undo/redo 两向都是空栈、c1 在 start 5。**直接拖 c1**。不要先 addClip 再 undo 到底（那会把刚加的片段弹掉、moveClip 对已删 id 返回 false——红落在错误原因上）。

一条用例依次锁两支被拒：

1. `selectClip('c1')`、`beginTransient()`、`moveClip('c1', 20, undefined, { transient: true })`。记下 `getState().pendingOverlay`。
2. `undo()` 为 false、`redo()` 为 false。镜像仍是刚才那个对象、`selectedClipId` 仍是 c1、两向栈长度仍 0、本地 c1.start 仍 20。
3. remote-peer 把 c2 的 start 写成 0.5。本地 c1.start 仍 20、本地 c2.start 仍 0（读回被抑制——抑制窗活着）。
4. `endTransient()` 为 true。doc 上 c1.start 为 20、c2.start 为 0.5（diff 不含未改键，远端值留在 doc 上）。镜像变为 null。undo 栈长度为 1。

**既有回归**：「拖拽中 Ctrl+Z（成功弹栈）」用例保持绿——`undo() === true`、`data.clips[id]` undefined、`endTransient() === false`。装回闸不另造夹具：它与空栈共用 `if (!ok)`；闸本身不弹栈已由 timelineUndo.spec 锁住。

## 3. 门与提交

门：timeline.spec 全绿 → tsc → web 全量 → census/module-size/doc-gate（门红只改同一批锚登记）。
单 commit：`fix(y4a): m#7——手势中 undo/redo 被拒保留覆盖层（saved/restore on reject）`；pre-commit fast 12 步真过、禁 --no-verify。

## 4. 不做

- m#4（水合 AutoEdge 对账锚）/m#5（addClip 写前检查锚）——归 Y4b。
- 不做抑制-恢复语义重构（本规则即终态）。
