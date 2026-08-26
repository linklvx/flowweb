# Spec: 画布自动保存（去手动保存 + 乐观锁 + 三态指示器）

日期：2026-08-26
状态：已确认（2026-08-26 用户审核，3 处修正已合入：D-d 面板无保存按钮改 flush 替换 / D-c 保持 300ms / D2 响应 version+hydrate 重载+落库排序）
来源：自动保存方案调研（方案 2：脏标志收敛 + debounce 全量 PUT + 关键时机 flush；方案对比与事实核查见会话记录，全部主张已对照源码验证）
关联：近期将做团队共享式协作（本 spec 的乐观锁为其前置）；实时共编为远期（Yjs overlay 演进，见"未来扩展"）

## 背景与目标

当前画布依赖手动"保存画布"按钮兜底 + 散点式隐式同步。目标：移除手动保存，收敛为统一的自动保存机制，并为近期共享式协作落并发防护。

**修复现存隐患**：后端执行从 DB 读节点配置（execution.service.ts:27-30），用户改参数不保存直接生成会执行旧参数——生成前 flush 从"保险"升级为"正确性前提"。

## 侦查结论（2026-08-26 源码验证）

1. **散点全量 PUT 共 4 类**：① deleteNode 立即同步（canvasStore.ts:252-268）；② onNodesChange remove 批量删除后立即同步（:598-615）；③ undo/redo 后 300ms debounce scheduleSync（canvasHistoryRuntime.ts:33-56，含 H-1 防脏写校验）；④ 5 个 ConfigPanel 保存按钮同步（Image/ImageExt/Audio/Video/TextConfigPanel）
2. **双端点盲覆盖**：PUT `/projects/:id/nodes`、PUT `/projects/:id/edges` 无 version（project.controller.ts:31-39）；前端 `Promise.all` 并发，存在部分成功撕裂窗口
3. **无 beforeunload 拦截**：canvas/page.tsx 零匹配
4. **localStorage 持久化层已存在**：useCanvasPersistence.ts 单写者、双 store 订阅、500ms debounce、v2 快照（version/nodes/edges/viewport/parentMap）、isHydrating 抑制（S1）
5. **"保存画布"按钮语义错位**：CanvasTopBar.tsx:94-99 打开的是 SaveAsTemplateDialog（描述/公开到社区），内部自行调 syncNodes+syncEdges+POST `/projects/:id/save`（canvas.controller.ts:32，模板语义）
6. **viewport DB 持久化未接线**：PUT `/projects/:id/viewport` 端点存在但生产代码零调用，恢复仅靠 localStorage 快照
7. **生成触发点收敛（共 6 处）**：5 个 ConfigPanel 最终都走 `/execution/enqueue`——3 个（Video/Text/Audio）直调 enqueueWorkflow，2 个（Image/ImageExt）经 submitGeneration wrap（imageNodeApi.ts:51-53）；enqueue 仅入队，Worker 异步调 execute 读 DB → flush 在 enqueue 前完成即无竞态。第 6 处：组执行按钮（CanvasView.tsx:519-522 onExecute → executeGroupNodes → `/execution/execute` 同步端点，后端同样读 DB）
8. **节点数据引用化**：nodeStore data 只存 fileId/URL/参数，无 base64（协作预留约束 1 已满足）
9. **鉴权为同源 cookie**：client.ts fetch 无 Authorization header → sendBeacon 与 keepalive fetch 均可行
10. **saveTransformNode 为显式上传路径**：ImageGenNode.tsx:423-438 做本地变换→presignUpload→MinIO→写回 data；无法 debounce 化，保留独立路径
11. **nodeProcessMap 为运行时状态**（进程进度，canvasStore 内），不应触发同步
12. **schema**：CanvasProject.nodes/edges 为关联表（CanvasNode/CanvasEdge），version 字段加在 CanvasProject

## 设计

### 总体架构

```
任意画布变更（结构/参数/AI 结果写入）
  → 统一 dirty 信号（canvasSyncRuntime，订阅双 store）
  → 2s trailing debounce → PUT /projects/:id/canvas { nodes, edges, version }（原子+乐观锁）
  → 三态指示器（保存中/已保存/失败重试）

关键时机立即 flush（跳过 debounce）：
  生成前（enqueueWorkflow 前 await）/ 路由切走 / 项目切换 / beforeunload(keepalive)

旁路：viewport 独立通道（onMoveEnd 触发，独立端点，不混入结构 dirty）
旁路：saveTransformNode 上传保留显式路径，写回 data 后由统一 dirty 接住
```

### D1 统一同步运行时 `canvasSyncRuntime.ts`

新模块 `apps/web/src/stores/canvasSyncRuntime.ts`（遵循 canvasHistoryRuntime 循环依赖裁定模式：顶层只允许 import 声明/函数定义/纯常量）：

- **dirty 判定**：`syncPartialize(state)` 投影——nodes（id/type/parentId/position/width/height/data 合并 nodeStore）/edges；zustand subscribe 回调中比较投影，变化才 markDirty。排除：nodeProcessMap、selected/dragging/measured 瞬态、isHydrating 窗口内变更（复用 S1 抑制模式）
- **nodeStore data 变更**：含 ImageItem.status 等生成状态字段——属用户资产变化，纳入 dirty（生成完成 Socket 回调写 data → 自动同步 DB）
- **debounce**：2s trailing；触发时构建 payload（复用 buildSyncPayload 合并逻辑）+ 携带 version 调 PUT /canvas
- **projectId 防脏写**：复用 scheduleSync 的 H-1 模式——debounce 触发时重读校验 projectId
- **保存状态机**：`'saved' | 'dirty' | 'saving' | 'error'` 存 canvasStore（不进 history partialize、不进 localStorage 快照），三态指示器订阅
- **flush(reason)**：立即执行保存（清定时器、取最新状态）；返回 Promise 供生成前 await

### D2 单端点 `PUT /api/projects/:id/canvas` + 乐观锁

- **schema**：CanvasProject 加 `version Int @default(0)`；迁移 `migrate dev --name canvas-autosave-version`
- **语义**：body `{ nodes, edges, version }`；Prisma 事务内——校验 `WHERE id AND version = body.version`，通过则按现有 syncNodes/syncEdges 的落库方式（deleteMany+createMany 关联表）原子更新 nodes+edges、`version + 1`；version 不匹配返回 **409** `{ code: 1, message: '画布已被他人修改' }`
- **落库沿用现有实现细节**（project.service.ts）：保留客户端生成的 node ID（:107）；parentId 父先子后排序插入（:104，否则自引用外键约束失败）
- **响应体**：`{ version: number }`——前端保存成功后必须更新 canvasStore.version，否则下一次保存携带旧 version 必然 409
- **GET /projects/:id** 响应增加 version，前端加载时存入 canvasStore
- **冲突前端行为**（共享式协作，非实时）：toast 提示"画布已被他人修改，已加载最新版本"→ 自动 GET 最新状态重载 store——**重载必须复用现有 hydrate 模式**（withHistoryPaused + hydrateLoaded，对照 page.tsx:64-81），防止 undo/redo 历史栈被污染；同时更新 canvasStore.version。不自动重放、不做覆盖选择 UI（丢失本地未同步改动由 localStorage 快照兜底）
- **删除旧端点**：PUT `:id/nodes`、PUT `:id/edges`、PATCH `:id/nodes/dimensions`（尺寸变更属 nodes 字段，统一走 dirty；CanvasView.tsx 的 syncNodeDimensions debounce 链路移除）。无兼容负担（开发阶段无旧客户端）
- **保留**：PUT `:id/viewport`（D7）

### D3 flush 时机

| 时机 | 实现 | 失败行为 |
|---|---|---|
| 生成前 | 6 个触发点：5 个 ConfigPanel 的 generate handler 内原 syncNodes+syncEdges 替换为 `await flush('execute')`（面板无独立保存按钮，参数输入已直接写 store）+ 组执行按钮 onExecute 回调加 flush | 先做 1 次立即重试（间隔 500ms），仍失败 toast 警告"保存失败，生成将使用上次保存的参数"，不阻断生成；顺带清理面板内 `projectId ?? 'default'` fallback（flush 内部已有 null 守卫） |
| 路由切走 / 项目切换 | **不 flush**（2026-08-26 plan 评审裁定）：项目切换时 cleanup 执行晚于 store 清空/新数据写入、早于 canvasStore.projectId 更新——此刻 flush 会把空画布/新项目数据写到旧项目（跨项目脏写）。丢改窗口 ≤2s，由 localStorage 快照与下次进入兜底 | — |
| beforeunload/pagehide | `fetch(url, { keepalive: true, ... })` 复用 apiFetch 路径（同源 cookie 自动携带；页面关闭后浏览器仍完成请求） | 无法感知，接受（localStorage 500ms 快照兜底） |

### D4 三态指示器

- 位置：CanvasTopBar.tsx:91-101 原"保存画布"按钮的容器，替换为状态文本：
  - `saving` → "保存中…"（dirty→flush 启动期间显示，含 debounce 等待）
  - `saved` → "已保存"（默认态；flush 成功后显示）
  - `error` → "保存失败，点击重试"（红色，点击 = 立即 flush）
- 加载完成（hydrate）即 `'saved'`

### D5 "保存画布"按钮拆分

- CanvasTopBar 移除保存按钮；用户下拉菜单新增"保存为模板"项 → 打开 SaveAsTemplateDialog
- SaveAsTemplateDialog 内删除 syncNodes/syncEdges 调用（自动保存已覆盖；若此刻有 pending dirty，打开对话框时先 flush），仅保留模板元数据（名称/描述/公开）提交 POST `/projects/:id/save`。顺带消除现存不一致：SaveAsTemplateDialog.tsx:24 传 `state.nodes as any` 未合并 nodeStore data（模板可能丢最新参数），该调用删除后此 bug 一并消失

### D6 与 localStorage 持久化层关系

- 两层共享同一 dirty 投影判定，保持独立 debounce 时钟：本地 500ms / 服务端 2s（本地是崩溃兜底，需更快）。**实现注记（2026-08-26 plan 阶段裁定）**：共享投影不做——useCanvasPersistence 保持订阅任意 store 变更（saveStatus 变化触发的快照写为无害最终态覆盖），本地持久化本应比服务端更激进，共享投影属无净收益的跨层耦合
- localStorage v2 快照增加服务端 `serverVersion` 字段：恢复时若本地快照落后于 DB version，以 DB 为准（DB 非空守卫已有此语义，仅增强判断依据）

### D7 viewport 独立通道

- 接线现状缺口：CanvasView 的 onMoveEnd → debounce 1s → PUT `/projects/:id/viewport`（复用现有端点与 updateViewport API）
- 不参与乐观锁（纯 UI 偏好，最后写入者胜，无冲突危害）；不触发结构 dirty

### D8 散点同步收敛清单（全部改走统一 dirty）

| 现有同步点 | 处置 |
|---|---|
| deleteNode 立即同步（canvasStore.ts:252-268） | 删除直接调用的同步，改 markDirty |
| onNodesChange remove 同步（:598-615） | 同上 |
| scheduleSync 300ms（canvasHistoryRuntime.ts） | 函数体改为 markDirty，flush 窗口**保持 300ms 不变**（I-2 为快速连按 Ctrl+Z 设计的行为原样保留）；projectId 校验逻辑由 runtime 统一承担 |
| 5 个 ConfigPanel generate handler 内的 syncNodes+syncEdges | 替换为 `await flush('execute')`（面板无独立保存按钮，参数输入已直接写 store，dirty 自动接住） |
| CanvasView syncNodeDimensions（PATCH dimensions） | 删除整段 debounce 链路，尺寸变更走 dirty |
| SaveAsTemplateDialog 内同步 | 见 D5 |

## 验证标准（TDD）

1. 后端新增测试红→绿：
   - PUT /canvas 原子更新（nodes+edges 同事务，version+1）
   - version 不匹配返回 409
   - version 匹配但项目不存在 → 404
   - GET /:id 返回 version
2. 前端新增测试红→绿：
   - dirty 判定矩阵：结构变更→dirty；nodeStore data 变更→dirty；nodeProcessMap 变更→不 dirty；selected/dragging 变更→不 dirty；isHydrating 窗口→不 dirty
   - debounce 2s 合并：连续 5 次变更仅 1 次 PUT
   - flush：生成前 await、beforeunload（keepalive fetch 调用参数断言）、error 态 retry、template 失败返回 false 阻断
   - 409 冲突：toast + 重载最新状态
   - 三态指示器：四态渲染 + error 点击重试
   - undo/redo → 300ms flush（与 I-2 现行行为一致）
   - viewport onMoveEnd → 独立端点调用
3. 既有测试迁移全绿（ConfigPanel/deleteNode/scheduleSync/dimensions 相关断言改写）
4. `pnpm --filter @flowweb/web test`、`pnpm --filter @flowweb/api test` 全绿；两端 `tsc -b` 无新错误
5. 浏览器验收：编辑→2s 内 DB 落库（Prisma 查库验证）；改参数立即生成→DB 为新参数；关标签页重开→数据保留；双开同一画布先后编辑→后保存方 409 提示并加载最新；撤销→500ms 落库

## 不做什么

- 不做 Command 层重构/操作日志双表双 Worker/CRDT/可观测性全家桶（方案论证已否决）
- 不做多标签页 BroadcastChannel 同步（同用户双开走 409 冲突路径）
- 不做版本历史/快照回溯 UI
- 不做保存失败的离线队列重试（error 态手动重试 + 后续变更自动重试即可）
- 不动 saveTransformNode 显式上传路径
- 不动 DB 保存的 Template 语义（POST /projects/:id/save 原样保留）

## 风险（已消解或受控）

- 2s 窗口崩溃丢数据 → localStorage 500ms 快照兜底（恢复优先 DB，本地仅兜底空 DB）
- keepalive fetch 体积上限（64KB）→ 几百节点画布全量 JSON 约几百 KB 可能超限：beforeunload payload 若超限则退化为仅依赖 localStorage 快照（实现时实测，超限记录 console.warn）
- GET 重载冲突状态时用户正在输入 → 409 场景罕见（共享协作前后编辑），接受覆盖丢失（localStorage 快照可查）
- undo/redo 300ms 与全局 2s 并存的双时钟 → 属同一 runtime 内两条调度路径，共享状态机和 projectId 校验，无漂移风险

## 已知限制（接受，不处理）

- **saveTransformNode 上传期间导航离开**：上传超时 30s，unmount flush 不含尚未写回的 fileId——用户回来需重新变换（服务端文件已上传，仅 ID 未落库）
- **全量 deleteMany+createMany 的规模上限**：现状已是此模式无回归；画布增长至 1000+ 节点时每 2s 全表删插可能产生 PG 压力，到达时再演进增量/diff
- **生成状态 'loading' 触发多余 PUT**：status='loading' 写 data → dirty → 生成 >2s 时多发一次 PUT（每生成约 2 次 PUT）。在投影中排除 'loading' 瞬态会增加复杂度，暂不做

## 决策点（2026-08-26 用户审核后全部裁定）

- **D-a 生成前 flush 失败** → toast 警告但继续生成；flush 内先做 1 次立即重试（间隔 500ms）再放行
- **D-b 409 冲突行为** → 自动加载最新 + toast"画布已被他人修改，已加载最新版本"；不做覆盖选择 UI、不做 force version 后门
- **D-c undo/redo flush 窗口** → 保持 300ms（与现有 scheduleSync I-2 行为一致，不做无依据改动）
- **D-d ConfigPanel** → 修正认定：面板无独立保存按钮，generate handler 内 syncNodes+syncEdges 替换为 `await flush('execute')`；`projectId ?? 'default'` fallback 一并清理

## 未来扩展（登记不实施）

- 实时共编（Yjs overlay）：协作会话从 PG 状态初始化 Yjs doc，WS 增量同步，定期快照回写同一 PUT /canvas 通道
- 协作预留约束：①节点数据引用化（已满足）②PUT /canvas 保持"状态基底"覆盖语义（本设计即如此）③不引入单写者假设字段（version 为中性并发控制，非身份字段）
