# Plan: TD-5/6/8 localStorage 持久化重构（子批 3c）

日期：2026-08-21
Spec：docs/superpowers/specs/td5-6-8-persistence-refactor.md（已确认，D1-D3 采纳，S1/S2 执行细节并入）
总原则：TDD 每任务先红后绿；持久化层合一，不动内存双 store 架构与 DB 保存链路。

## C1 职责边界：DB 加载与 localStorage 恢复是串行兜底，非并行竞争

| 场景 | page.tsx（DB 链路） | useCanvasPersistence（本地兜底） |
|---|---|---|
| DB 有数据 | 写双 store | mount 见 `canvasStore.nodes.length > 0` 直接 return，**不读 localStorage** |
| DB 空 + 本地非空 | **早退只返回 name，不写 store** | store 空 → 从 v2 恢复写入 |
| DB 空 + 本地空 | setState 空态 | 无可恢复，空画布 |

- hook 恢复触发条件 = `canvasStore.nodes.length === 0`（两条路径均成对写双 store，查一即够）
- page 中 `loadSnapshot` **仅判断不写 store**（决定 DB 空时是否早退保留本地兜底），实际写入统一由 hook 完成

## 任务 1：canvasSnapshot 模块 + 校验矩阵测试

- 新建 `apps/web/src/pages/canvas/hooks/canvasSnapshot.ts`：
  - `SNAPSHOT_VERSION = 2`、`snapshotKey(pid): string`
  - `Snapshot` 类型：`{ version: 2; nodes: Record<string, AppNode>; edges: { id; source; target }[]; viewport: { x; y; zoom } }`
  - `loadSnapshot(pid): Snapshot | null`——封装 getItem + 校验 + **失败清 key**（调用方不触 localStorage，杜绝两调用点清 key 逻辑漂移）；校验规则：解析失败 / version !== 2 / nodes 非纯对象、节点值缺 id/type/position.x,y/data、edge 缺 id/source/target、viewport 缺 x/y/zoom → 清 key 返回 null；无 key 返回 null
  - `isEmptySnapshot(s): boolean`——nodes Record 空
- 新建 `canvasSnapshot.test.ts`（先红，jsdom 原生 localStorage 预置，无需 mock）：合法 / version 1 / nodes 传数组 / 节点缺 position / edge 缺 target / viewport 缺 zoom / 截断 JSON（失败用例均断言清 key）/ 无 key 不抛返回 null / 空 nodes 合法且 isEmptySnapshot=true

## 任务 2：canvasStore 扩展 isHydrating

- `isHydrating: boolean`（默认 false）+ `setHydrating(v)`
- canvasStore.test.ts 补 1 例（先红）：setter 切换字段
- 该字段同时是 3d（TD-4）的抑制接口落点，本批仅接项目切换段

## 任务 3：重写 useCanvasPersistence

- **恢复 effect**：`canvasStore.nodes.length === 0` 时 `loadSnapshot(pid)` → 通过则派生写入双 store；**try/finally 包裹** `setHydrating(true)→(同步 setStates)→finally setHydrating(false)`（订阅同步触发，写者在恢复窗口内被抑制——消灭恢复数据写回自身的冗余写，且任何路径必复位）
- **单写者**：一个订阅回调挂双 store（canvasStore.subscribe + nodeStore.subscribe），共用同一 `timerRef` 500ms 防抖；触发时 `isHydrating=true` → **clearTimeout 待执行定时器并 return**（S1：防 hydrate 结束后旧回调延迟脏写），false → 重置定时器写合并快照。数据源：`nodes ← useNodeStore.getState().nodes`、`edges/viewport ← useCanvasStore.getState()`；**edges 显式裁剪最小字段** `map(e => ({id, source, target}))`（实测 onConnect/addEdge 实际字段即最小集，裁剪为防御性保证）
- **旧 key 一次性清扫**（S2）：模块级 `hasCleanedOldLocalKeys` flag；mount effect 首次执行时移除匹配 `/^flowweb_canvas_content_/` 与 `/^flowweb_canvas_(?!v2_)/` 的 key（grep 实测：前缀仅 hook/page/测试使用，无其他消费方），此后不再扫描
- 重写 `useCanvasPersistence.test.ts`（先红，`vi.useFakeTimers()` + `advanceTimersByTime(500)` 精确断言）：
  - 恢复派生（双 store 同源）
  - 单写者：双 store 各变一次 → advance 500ms → **恰一次写** v2 key
  - hydrating 抑制（S1）：置位期间触发变化 + advance 500ms → 无写且定时器被清；hydrating 结束后再触发变化 + advance 500ms → 恰一次写
  - 清扫 flag 单次（重跑 effect 不再扫描）
  - 空 store 不恢复；恢复后写者不回写（try/finally 窗口断言）

## 任务 4：page.tsx 适配

- 删 `STORAGE_KEY` 与 `safeParseLocalNodes`；DB 空守卫改 `loadSnapshot(projectId)` 判 `!isEmptySnapshot`（**仅判断不写 store**，早退语义不变——见 C1 表）
- isHydrating 生命周期：每轮 effect **开局 `setHydrating(false)` 归零**（清上一轮 cancelled 遗留悬停）；项目切换清 store 处（现 125-126 行）再置 `setHydrating(true)`；复位点：`finish()`、两处 `setLoadError` 分支（含 fallback-create 失败）——DB 空早退路径经 `.then(finish)` 复位，覆盖所有离开 hydrate 窗口的路径
- `flowweb_projectId` 不动

## 任务 5：测试 fixture 迁移

- page.test.tsx：`flowweb_canvas_content_p1` 等旧 key fixture → `flowweb_canvas_v2_p1` 合法快照 payload；截断 JSON 用例语义不变（清 key + 视为空）
- 全库 grep `flowweb_canvas_content|flowweb_canvas_(?!v2)` 确认无残留旧 key 引用

## 任务 6：类型检查 + 全量回归

- `tsc -b` 无新错误
- `pnpm --filter @flowweb/web test` 全绿

## 任务 7：浏览器验证矩阵

dev server + 浏览器实测（preview 工具）：

1. 编辑节点 → 刷新 → 数据完整恢复（节点/连线/视口/节点内容）
2. 手植坏 payload（截断 JSON / version:1）→ 刷新 → key 被清、画布走 DB/空
3. 预置旧 key（`flowweb_canvas_p1`、`flowweb_canvas_content_p1`）→ 挂载后被清扫，且切换项目再回来不重复扫描（flag）
4. 全删节点 → 刷新 → 不复活（空快照可写入）
5. 项目 A↔B 切换 → 无交叉污染（B 的缓存不被 A 的切换清空写破坏）

## 任务 8：台账 + 原子 commit

- tech-debt.md：TD-5/TD-6 → 已清账；TD-8 缩窄为仅 MinIO 孤儿对账（localStorage 部分随本批清）；批次建议 3c 标记完成
- 单 commit（业务 + 测试 + 台账 + spec/plan 留档）：

```
refactor(web): unify localStorage persistence into versioned snapshot (TD-5/6/8)

- dual-key mirror (canvas 500ms debounce + content immediate) had split
  write clocks and an inconsistent restore window (orphaned nodeStore
  content with empty view); replaced by single flowweb_canvas_v2_${pid}
  snapshot {version, nodes, edges, viewport} — nodeStore as sole data
  authority, view nodes derived on restore
- validateSnapshot: version + structural check, dirty payload → key removed
- isHydrating suppression in canvasStore: single writer skips + clears
  pending timer during hydration window (project switch → DB load; also
  the reserved hook-in point for TD-4 in batch 3d)
- old keys swept once per session (module flag); MinIO orphan
  reconciliation split out of TD-8 (server-side, pre-launch)
```

## 回滚路径

单 commit → `git revert` 即整体回退；localStorage v2 key 与旧 key 并存（不同名），revert 后旧链路照常工作，无数据迁移不可逆风险。
