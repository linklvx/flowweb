# Spec: TD-5/6/8 localStorage 持久化重构（子批 3c）

日期：2026-08-21
状态：待确认
来源：tech-debt.md TD-5（双 store 两份独立数据）/ TD-6（key 版本化 + schema 校验）/ TD-8（已污染脏数据）；第三批子批 3c
关联：为 3d（TD-4 防抖覆盖窗口）预留抑制接口

## 侦查结论（2026-08-21 实测核实）

1. **持久化是手写 localStorage，非 zustand persist**：[useCanvasPersistence.ts](apps/web/src/pages/canvas/hooks/useCanvasPersistence.ts) 每项目写两个 key：
   - `flowweb_canvas_${pid}`：canvasStore 镜像 `{nodes, edges, viewport}`，500ms 防抖
   - `flowweb_canvas_content_${pid}`：nodeStore 镜像 `Record<id, AppNode>`，即时写 + 空值守卫（store 被动清空不回写覆盖非空缓存）
2. **同一份数据两处存储、形状不同、写时机分离**（TD-5 本体）：视图数组 vs Record；防抖/即时双时钟可漂移。恢复逻辑分两处拼接：hook mount effect 逐 key 恢复 + page.tsx DB 空守卫（safeParseLocalNodes，page.tsx:37-49）只判空不恢复数据
3. **恢复拼接存在不一致窗口**：canvas key 空（如被动清空写入）而 content key 非空时，nodeStore 会被灌入孤儿数据而 canvasStore 0 节点——数据在 localStorage 永久残留（TD-8 的污染源之一）
4. **渲染数据源全部在 nodeStore**：16 处节点组件/面板按 id 订阅 `useNodeStore((s) => s.nodes[id])`，canvasStore.nodes.data 无渲染消费方（仅 DB sync mergedNodes 用 nodeStore 数据覆盖）→ **视图层可从 nodeStore 完全派生**
5. **尺寸双写已闭环**：canvasStore.ts:407-415 dimensions setAttributes 分支回写 nodeStore width/height；无 NodeResizer，`measured` 为瞬态重挂载即重测 → 派生不丢信息
6. **DB 保存链路与 localStorage 解耦**：syncNodes/syncEdges 由面板事件 + canvasStore remove 分支驱动（6 个面板 + deleteNode 链路）→ 重构持久化层不触 DB 链路
7. **TD-6 现状**：safeParseLocalNodes 仅 JSON.parse 失败清 key，无版本/结构校验；恢复侧 try/catch 静默吞——形状漂移的 payload（如 `{}`、缺字段对象）会通过判空进入恢复
8. **旧 key 消费方仅 hook + page.tsx**（ImageGenNode.tsx:220 读的是 `flowweb_projectId`，不在范围）；测试 fixture 用旧 key：page.test.tsx（6 处）、useCanvasPersistence.test.ts
9. **TD-8 现状**：无生产用户；旧格式 key 在 v2 启用后成死数据；MinIO 孤儿对账（DB media 全量 vs MinIO listing）属服务端脚本域，与 web 持久化重构不同域

## 策略决策

### 方案：单一版本化快照（合一 + 版本校验）→ 推荐

**新 key**：`flowweb_canvas_v2_${projectId}`，payload：

```ts
{
  version: 2,
  nodes: Record<string, AppNode>,   // nodeStore 全量 —— 唯一数据权威
  edges: { id, source, target }[],
  viewport: { x, y, zoom }
}
```

- **单写者**：hook 内一个订阅回调监听双 store（canvasStore.subscribe + nodeStore.subscribe 共用同一个 500ms 防抖定时器），写合并快照——消灭双时机漂移
- **恢复派生**：校验通过 → `nodeStore.setState(nodes)` + `canvasStore.setState({ nodes: Object.values(nodes), edges, viewport })`——视图节点由 AppNode（id/type/position/data/width/height）直接构成，侦查 4/5 保证无损
- **旧双 key 直接废弃不迁移**（D2）：TD-6 方向即「不兼容直接丢弃」；无生产用户；存量 dev 画布有 DB 同步兜底

### 备选：保留双 key 仅加版本前缀 → 否决

不解决 TD-5 本体（双份漂移/拼接不一致），只是给旧债贴版本号；恢复逻辑仍两处拼接，TD-4 修抑制要动两个写者。合一成本相同（同文件同测试面），收益全无。

## 修复设计

1. **共享快照模块** `apps/web/src/pages/canvas/hooks/canvasSnapshot.ts`：
   - `SNAPSHOT_VERSION = 2`、`snapshotKey(pid)`
   - `loadSnapshot(pid): Snapshot | null`——封装 getItem + 校验 + **失败清 key**（IO 副作用内聚，调用方不触 localStorage，杜绝两调用点清 key 漂移）；校验规则：JSON.parse 失败 / version !== 2 / 结构校验失败（nodes 非纯对象或值缺 id/type/position.x,y/data；edges 项缺 id/source/target；viewport 缺 x/y/zoom）→ 清 key 返回 null；无 key 返回 null
   - `isEmptySnapshot(snapshot)`——nodes Record 空即空（DB 空守卫复用）
   - 手写轻量校验，不引 zod（web 无该依赖，结构面窄）
2. **useCanvasPersistence 重写**：
   - 恢复：mount 时 store 空则 `loadSnapshot` → 通过则派生双 store 写入（替换现 16-49 行双 key 拼接）；恢复包裹 try/finally 置位/复位 isHydrating
   - 写入：单防抖写者，payload 合并双 store（nodes ← nodeStore，edges/viewport ← canvasStore，edges 裁剪最小字段）；**isHydrating 抑制：跳过并清除待执行定时器**（见 4）
   - 空守卫语义变更：**删除**「空快照不覆盖非空缓存」守卫，改为 hydrating 抑制从根上防污染（全删节点场景必须能写入空快照，否则重载复活已删节点——现状该场景靠 canvas key 无守卫写入空值实现，合一后须由快照整体写入承担）
3. **page.tsx 适配**：
   - safeParseLocalNodes 删除，DB 空守卫改 `loadSnapshot(projectId)` 判 `!isEmptySnapshot`（仅判断不写 store，早退语义不变——DB 与 localStorage 为串行兜底：DB 优先写 store，本地仅在 store 空时由 hook 兜底恢复）
   - 项目切换清 store 处（125-126 行）前置 isHydrating 置位；每轮 effect 开局归零 + finish/错误分支复位（含 DB 空早退经 finish 的路径）
4. **isHydrating 抑制接口（3d 预留）**：canvasStore 增加 `isHydrating: boolean`；置位时机 = 项目切换清 store 起 → loadProjectIntoStore 结束（含 DB 空守卫早退分支）；写者发现 isHydrating=true 跳过写入并清定时器。3d（TD-4）落地时复用同一标志扩展到慢 fetch 窗口，本批只接项目切换段
5. **旧 key 清扫（TD-8 localStorage 部分，D1）**：hook mount 时一次性移除匹配 `/^flowweb_canvas_content_/` 与 `/^flowweb_canvas_(?!v2_)/` 的 key（新 key 格式 `flowweb_canvas_v2_` 由负向前缀排除）
6. **TD-8 MinIO 孤儿对账移出本批**：服务端脚本域，台账 TD-8 保留仅剩 MinIO 部分，标注「上线前评估」

## 验证标准

1. 新增单测红→绿：
   - canvasSnapshot 校验矩阵（合法/版本不符/结构缺失/解析失败，失败均清 key）
   - hook：单写者（双 store 变更合并一次写 v2 key）/ 恢复派生（nodeStore + canvasStore 同源）/ isHydrating 抑制 / 旧 key 清扫
   - page：DB 空守卫读 v2 key
2. 既有测试迁移后全绿（page.test.tsx、useCanvasPersistence.test.ts fixture 换 v2 key）
3. `pnpm --filter @flowweb/web test` 全量绿；`tsc -b` 无新错误
4. 浏览器验证：编辑→刷新恢复完整；手植坏 payload 刷新即清；旧 key 存在时挂载后被清扫；全删节点→刷新不复活
5. 台账更新：TD-5/TD-6 清账，TD-8 缩窄为仅 MinIO 部分

## 不做什么

- 不合并内存双 store（canvasStore/nodeStore 架构不动——仅持久化层合一）
- 不动 DB 保存链路（syncNodes/syncEdges 全部调用方零改动）
- 不动 `flowweb_projectId`（最近项目指针，独立关注点）
- 不做旧格式→v2 数据迁移（D2）
- 不做 MinIO 孤儿对账（移出台账本项，见修复设计 6）
- 不修 TD-4 本体（仅落 isHydrating 接口，3d 扩展）

## 风险（已消解或受控）

- 派生视图节点丢 React Flow 瞬态（selected/measured/dragging）→ 本就随会话丢弃，重挂载重测（侦查 5）
- nodeStore 写由即时改 500ms 防抖 → 关标签页 500ms 内编辑可能丢本地缓存（DB 保存不受影响，D3）；现状 canvasStore 侧同为 500ms 防抖，接受
- 全删节点写空快照 vs 被动清空污染的区分 → 由 isHydrating 承担（修复设计 2/4），不再依赖启发式空值守卫
- 旧 key 清扫误删 → 负向前缀排除 v2，`flowweb_projectId` 不匹配两模式

## 决策点（请确认）

- **D1 旧 key 清扫**：建议挂载清扫（方案内）；备选留置不管（无害垃圾）
- **D2 旧数据不迁移直接丢弃**：建议丢弃（TD-6 方向 + 无生产用户 + DB 兜底）
- **D3 nodeStore 写即时→防抖 500ms**：建议接受（统一时钟是合一前提；丢缓存窗口 ≤500ms 且 DB 不受影响）
