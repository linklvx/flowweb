# Spec: 团队 + 协作完善（多团队/项目权限/审计/增量日志/多实例/SV 等待/UndoManager）

日期：2026-08-28
状态：待用户审阅
来源：2026-08-27-team-collab-yjs-design.md「未来扩展」四项的正式实施 + 用户 5 项决策（项目成员覆盖表 / 纯前端 localStorage 切换 / Postgres 增量追加表 / 彻底移除 zundo / 单 spec 单 plan）+ 外部评审 5 条阻塞修正与 9 条补全项全部采纳
关联：2026-08-27-team-collab-yjs-design.md（前置一期，术语与 Y.Doc 结构沿用）

## 背景与目标

一期团队 + Yjs 协作已上线（团队池计费/Hocuspocus 单实例/全量快照/zundo 桥）。本次实施一期登记的四项扩展：

1. **团队管理增强**：多团队创建/切换、项目级权限角色（ProjectMember 覆盖表）、OWNER 转让、团队审计日志
2. **CanvasDoc 增量日志 + 多实例**：@hocuspocus/extension-redis 跨实例广播 + Postgres 增量追加表，废除"单实例铁律"
3. **执行端点 state vector 等待**：彻底消除"执行读旧参数"毫秒级竞态窗口
4. **Y.UndoManager 替换 zundo**：远端/AI 写入不入 undo 栈的原生支持，双向桥改单向数据流

开发测试阶段无用户数据，不做向后兼容/存量迁移防护（Prisma 迁移直接改表）。

## 全局约定

### Origin 常量表（第 2/3/4 节共用，钉死）

| origin 值 | 来源 | Y.UndoManager trackedOrigins |
|---|---|---|
| `'local-user'` | 本地用户操作（所有 UI mutation 入口，前端 runtime 定义常量导出） | **是（唯一入栈者）** |
| `'server'` | AI / 服务端 withDoc transact（后端常量） | 否 |
| UndoManager 实例本身 | undo/redo 回放 | 否（天然不入栈） |
| Hocuspocus provider 实例 | 远端同步 applyUpdate（provider 内部决定） | 否 |
| `null` | localStorage 崩溃快照恢复 | 否 |

### 两层权限分离原则（第 1 节）

- **团队层（TeamGuard，不变）**：Team OWNER/ADMIN 可做项目 CRUD、成员管理、团队设置、解散；MEMBER 不可
- **画布层（ProjectMember，新）**：控制项目内编辑/只读/项目成员管理。Team ADMIN 回退为 PROJECT_EDITOR **不影响**其团队层管理能力；Team OWNER/ADMIN 保留项目成员管理兜底权限
- **执行等写操作**：项目角色 ≥ PROJECT_EDITOR 才可触发，PROJECT_VIEWER 返回 403

### SV 等待规则（第 3 节）

所有读画布的服务端端点一律接受请求头 `x-yjs-sv`（base64 state vector）并在读取前等待 doc 覆盖；无头则跳过等待（兼容非浏览器调用）。

---

## 第 1 节：团队管理增强

### 1.1 多团队管理/切换

- 新端点 `POST /api/team`（SkipTeamGuard，AuthGuard 登录即可）：body `{name}`；事务内建 Team（ownerId=当前用户）+ TeamMember(OWNER) + TeamBalance（**credits=0，不写 register_grant 流水**——注册赠送只给默认团队一次，防建团刷积分）
- `GET /api/team/mine` 已有，返回全部团队（现状不变）
- **当前团队**仍存前端 localStorage `currentTeamId`，无服务端状态（用户决策）
- 前端：工作区 Navbar 加团队切换器（antd Dropdown：当前团队名 + 团队列表 + 分割线 + "新建团队"入口弹窗输入名称）；切换 = 写 localStorage + reload；**创建成功后自动切换到新团队**
- **解散当前团队后**：前端检测 currentTeamId 已不存在，回退到 `GET /api/team/mine` 结果之一（第一个），无团队不可能发生（一期已禁止解散唯一团队）
- 注册 `ensureDefaultTeam` 保持不变

### 1.2 ProjectMember 项目级权限

**数据模型：**

```
enum ProjectRole { PROJECT_OWNER PROJECT_EDITOR PROJECT_VIEWER }

ProjectMember   id, projectId(→CanvasProject, onDelete: Cascade), userId(→User), role(ProjectRole), createdAt
                @@unique([projectId, userId])   // 防重复
                @@index([userId])               // "我的项目"反查
```

**权限解析优先级链（钉死，`resolveProjectRole(userId, project)` 单一实现）：**

1. `ProjectMember` 显式记录 → 其 role
2. `project.userId === userId`（项目创建者）→ `PROJECT_OWNER`（仅兜底历史数据；**新建项目时同步写一条 ProjectMember(PROJECT_OWNER)**）
3. 团队角色回退：Team OWNER→`PROJECT_OWNER`，ADMIN/MEMBER→`PROJECT_EDITOR`

**端点**（`/api/project/:id/members`，TeamGuard('project') + 项目角色校验）：

- `GET`：项目成员列表（含回退角色推导的有效角色标注"继承"）——PROJECT_VIEWER 及以上可看
- `POST {userId, role}`：添加/覆盖项目成员——**被添加人必须是本团队成员，否则 400**；普通角色（VIEWER/EDITOR）PROJECT_OWNER 或 Team OWNER/ADMIN 可设，**设为 PROJECT_OWNER 需当前操作者是 PROJECT_OWNER 或 Team OWNER**（与 PATCH 同规则，防 Team ADMIN 经 POST 路径绕过授予 OWNER）
- `PATCH /:memberId {role}`：改角色——普通角色同 POST 权限；改 PROJECT_OWNER 需当前操作者是 PROJECT_OWNER 或 Team OWNER
- `DELETE /:memberId`：移除——同 POST；**禁止移除最后一个显式 PROJECT_OWNER**（Team OWNER 回退兜底技术上仍可达，此禁令为产品语义——防误操作产生只能靠团队管理员管理的准孤儿项目）
- **PROJECT_OWNER 允许多个**（平权协管理员语义）：PATCH 设为 PROJECT_OWNER 不降级他人；OWNER 间均可行使项目管理权

**collab 接入：** Hocuspocus `onAuthenticate` 在现有团队成员校验后追加 `resolveProjectRole`：`PROJECT_VIEWER` → 返回 `readOnly: true`（Hocuspocus 拒绝其写更新）。

**执行等写端点接入：** execute/enqueue/lighting 提交等触发执行类端点校验 `resolveProjectRole ≥ PROJECT_EDITOR`，否则 403；纯读取端点（加载/查看）放行。plan 阶段 grep 调用点复核清单。

**UI：** 画布页项目设置弹窗内加「项目成员」区块：成员列表（有效角色 + "继承"标签）、添加团队成员为 VIEWER/EDITOR、移除、改角色。

### 1.3 OWNER 转让

- `POST /api/team/:id/transfer-ownership`，body `{targetUserId}`
- 校验：请求者为该团队 Team OWNER；target 是本团队成员且 ≠ 自己
- **事务内**：① 原 OWNER 的 TeamMember.role → `ADMIN`；② target 的 TeamMember.role → `OWNER`；③ `Team.ownerId = targetUserId`（同步，阻塞级修正）；④ 写审计日志（action=transfer_ownership）
- 不影响任何 ProjectMember 记录（项目所有权独立）
- UI：TeamPage 成员 tab 三点菜单，OWNER 对其他成员可见「转让所有权」，二次确认弹窗（展示目标成员名）后调用

> **实施决议（2026-08-29）**：转让后用户处于"无属主团队但有成员身份"状态。团队解析幂等判据定为**成员身份**（ensureDefaultTeam：任一 TeamMember（最早 joinedAt）→ 直接返回该团队；零成员才新建+发放 register_grant；getOwnerTeamId：属主 > 最早成员回退）。切断"转让→建项目→幽灵团队+重复发放 100 积分"的循环刷积分路径。前端 localStorage currentTeamId 为建项目权威，服务端解析仅兜底。

### 1.4 团队审计日志

**数据模型（改现有 AuditLog）：**

- `AuditLog` + `teamId String?`（个人域日志为空）+ `@@index([teamId, createdAt])`
- `AuditTargetType` 枚举追加：`TEAM` / `TEAM_MEMBER` / `PROJECT` / `PROJECT_MEMBER`（现有 subscription/subscription_plan/point/order 不动）
- 变更摘要用现有 `beforeValue/afterValue Json?` 字段，不新增列

**写入点（service 事务内同步写）：**

| 动作 | action | targetType |
|---|---|---|
| 创建团队 | create_team | TEAM |
| 解散团队 | disband_team | TEAM |
| 移除成员 | remove_member | TEAM_MEMBER |
| 成员角色变更 | change_role | TEAM_MEMBER |
| 成员额度调整 | adjust_quota | TEAM_MEMBER |
| OWNER 转让 | transfer_ownership | TEAM_MEMBER |
| 加入申请批准/拒绝 | approve_join / reject_join | TEAM_MEMBER |
| 充值成功 | recharge | TEAM |
| 订阅购买/到期 | subscribe / expire | TEAM |
| 项目成员增/删/改 | add_project_member / remove_project_member / change_project_role | PROJECT_MEMBER |

- 端点 `GET /api/team/:id/audit-logs?page=&pageSize=`：仅 Team OWNER/ADMIN 可见；按 `teamId + createdAt` 倒序分页，返回 `{items, total, page, pageSize}`
- UI：TeamPage 新增第 5 个 tab「审计日志」：antd Table（时间/操作者/动作/对象/摘要 before→after），客户端操作符映射为中文标签

---

## 第 2 节：CanvasDoc 增量日志 + Redis 多实例

### 2.1 数据模型

```
CanvasDocUpdate   id, projectId(→CanvasProject, onDelete: Cascade), seq BigInt, update Bytes, createdAt
                  @@index([projectId, seq])
```

- `seq` 来自**全局 Postgres SEQUENCE** `canvas_doc_update_seq`（migration 内 raw SQL `CREATE SEQUENCE`），append 时 `nextval()` 取号——多实例并发下全局单调，不要求 per-project 连续，同项目内相对有序即保证重放确定性
- Prisma schema 用 `BigInt` + `@default(dbgenerated("nextval('canvas_doc_update_seq')"))` 或 append 走 `$executeRaw nextval()`（plan 阶段定）

### 2.2 写入与 compaction（onStoreDocument 改造）

- **（2026-09-29 修订：变更驱动落库）** 变更检测基于**观测**（Yjs `doc.on('update')` 事件收集 pending 队列），禁止任何"SV 相等 / diff 为空 ⇒ 无变化 ⇒ 跳过 append"判等——删除不产生新 struct、SV 零变化、语义相同 doc 双向 diff 恒非空（R1 判据 2 事故根因，实测钉死；修复设计见 `docs/superpowers/specs/collab-delete-persist-fix.md`）
- `onStoreDocument`（debounce 5s/10s 保留）：从 pending 队列取批 mergeUpdates 单行 append（seq=nextval）；队列空 = 真·无变化不落行
- 水位不变量：只滞后、不越过；失败不推进（队列原样保留 + 抛错）、doc 存活期内可重试（at-least-once）；滞后上界 connection/local origin ≤ maxDebounce 10s，redis-origin 落库时点 = 下次 store 触发（仅 SIGKILL 落空，非待修缺陷）；队列数组身份在 doc 生命周期内恒定（原地 push/splice/unshift，禁止 set 替换）
- **Compaction（flush-then-compact，快照从 Postgres 权威构建，不信任任何实例内存——Redis 广播延迟与 compaction 解耦）**：该项目累计 update 行数 ≥ 32 时触发：
  1. **前置 flush**：先 flush 本实例 pending 批（变更驱动）——保证本实例内存状态全部落库，否则本批更新不在快照构建的 maxSeq 覆盖范围内、只能等下次加载时按增量行重放
  2. 事务内（`pg_advisory_xact_lock(hashtext(projectId)::bigint)` 防多实例并发 compaction）：
     - `maxSeq = SELECT max(seq) WHERE projectId`
     - 临时 `new Y.Doc()`：apply `CanvasDoc.state` + 按 seq ASC 重放 `seq <= maxSeq` 全部增量行（临时 doc 用完即弃、不广播，不违反"严禁自建 Y.Doc"双轨铁律）
     - `newSnapshot = Y.encodeStateAsUpdate(tempDoc)`
     - UPSERT `CanvasDoc.state = newSnapshot`
     - `DELETE WHERE projectId AND seq <= maxSeq`——步骤 a 之后其他实例新 append 的行（seq > maxSeq）不受影响，下次加载快照 + 这些行重放仍正确
- **最后连接断开强制 compaction**：`onDisconnect` 时判断 `instance.getConnectionsCount(documentName) === 0`（含直连）→ 主动执行同一 flush-then-compact 序列（await 完成）——Hocuspocus 无独立 unload 钩子（一期 S7 裁定），框架随后自动触发的 onStoreDocument 对空队列 noop 不落行；不留增量尾巴，下次加载只读快照
- **多实例冗余 append 接受**：同一文档两实例都 debounce 触发时可能 append 冗余行——CRDT 幂等保证重放正确，compaction 统一回收，不做内容去重

### 2.3 加载（onLoadDocument 改造）

1. `CanvasDoc.state` 快照 apply
2. 该项目增量按 `(projectId, seq ASC)` 重放 apply
3. **跨实例初始同步（阻塞级，Redis pub/sub）**：
   - 先订阅 `sync-response:{docName}:{requestId}`，再发布 `sync-request:{docName}`（携带本实例 SV）
   - 持有该文档的任一实例收到后回复 `Y.encodeStateAsUpdate(peerDoc, requesterSV)`（差异编码）；多实例重复回复无害（CRDT 幂等）
   - 加载方 apply response；**1s 超时兜底**（无对等实例则以 Postgres 为准）
   - 等待期间到达的正常广播 update 照常 apply（无害）
   - `Promise.race([response, timeout])` 后 resolve，onLoadDocument 返回

### 2.4 多实例（@hocuspocus/extension-redis）

- Hocuspocus 挂 `Redis` extension：复用 `REDIS_URL`，独立 ioredis 连接（pub/sub 与 BullMQ 队列连接分离）
- 跨实例广播文档 update 与 awareness（extension 内置能力）
- **废除一期"单机单实例"约束**；"业务写入必须走 openDirectConnection、严禁自建 Y.Doc"铁律**保留**——多实例下直连打开本实例副本，由 2.3 跨实例同步保证其新鲜度
- sync-request/sync-response 作为 extension-redis 之上的自建补充通道（独立 Redis subscriber 按文档名路由，plan 阶段定代码位置）

### 2.5 部署建议（登记，不在本次代码内实施）

- Nginx/APISIX 对 WS `/collab` 配 sticky session（同一客户端连同一实例），减少跨实例流量；Redis extension 不替代 sticky

---

## 第 3 节：执行端点 state vector 等待

### 3.1 协议

- 客户端：执行类请求前 `Y.encodeStateVector(本地doc)` → base64 → 请求头 `x-yjs-sv`
- 前端统一封装：执行调用入口（执行按钮/enqueue/lighting 提交等）从 collab runtime 取 SV 附加，业务代码无感

### 3.2 服务端等待（下沉进 readCanvas）

- `readCanvas(projectId, sv?: Uint8Array)`：openDirectConnection（onLoadDocument 含跨实例同步完成后）：
  - 无 sv → 直接读（兼容）
  - 有 sv → `serverSV = Y.encodeStateVector(doc)`，检查 sv 中每个 client id 的 clock ≤ serverSV 对应值；**未满足则事件驱动等待**：`doc.on('update')` 回调中重查条件，`Promise.race([条件满足, 3s timeout])`；超时降级照常读 + **Prometheus counter `yjs_sv_wait_timeout_total`（复用现有 metrics 体系）+ Nest Logger warning**
- **HTTP 端点**：execute / enqueue / lighting 提交 / 模板保存 / video-trim、video-separate 提交等所有读画布端点从 `x-yjs-sv` 头取 SV 传入 readCanvas（plan 阶段 grep readCanvas 调用点列全清单）
- **BullMQ job**：enqueue 端点把 SV 存入 job payload；worker 调 `readCanvas(projectId, sv)` 在读取前等待

---

## 第 4 节：Y.UndoManager 替换 zundo

### 4.1 删除清单

- web 依赖 `zundo`；`canvasHistory.ts`（partialize/HISTORY_LIMIT 快照机制）
- `canvasHistoryRuntime.ts` 的 `applyHistory / undoCanvas / redoCanvas / __nodeDataSnap 快照回写 / withHistoryPaused / beginDragTransaction / endDragTransaction`
- `canvasCollabRuntime.ts` 的 `LOCAL_ORIGIN / LOCAL_UNDO_ORIGIN / markNextAsUndo()` 及双向桥的 store→doc 自动 diff 回写路径

### 4.2 新增：Y.UndoManager

- `new Y.UndoManager([nodesYMap, edgesYMap], { trackedOrigins: new Set([Origin.LocalUser]), captureTimeout: 500 })`
- trackedOrigins **只含 `'local-user'`**：远端（provider origin）、AI/服务端（'server'）、undo 回放（UndoManager 自身）、localStorage 恢复（null）全部天然不入栈

### 4.3 单向数据流（关键改造）

```
UI mutation 入口 → doc.transact(() => {Y.Map ops}, 'local-user')   // 唯一写入路径
doc observeDeep  → 投影刷新 canvasStore/nodeStore（原 hydrate 路径保留）
```

- store 彻底变为 doc 投影，undo 产生的更新 origin = UndoManager 实例 → 投影刷新 store 但不回写（回环结构上消失）
- **mutation 入口全量拦截清单（spec 级钉死，plan 阶段 grep 复核防漏）**：
  - `onNodesChange`（React Flow：position 拖拽/zIndex/dimensions/remove——**select 变更不进 doc**，走 awareness selectedIds（一期已有），否则瞬态选中会以 local-user origin 污染 undo 栈）
  - `onEdgesChange`（边的 remove；**select 同上走 awareness**）
  - 节点增删：addNode / 复制粘贴 / 拖入素材 / 导入模板 / 组操作（group/ungroup）
  - 连线建立/删除
  - 参数面板 data 字段编辑（prompt/model 等，逐键写 Y.Map）
  - 属性面板变更（width/height/parentId 等）
- 拖拽合并：captureTimeout 500ms 内相邻同 origin 事务自动归并为一个 undo 项；**交互边界调 `stopCapturing()` 分隔**：拖拽松手、参数输入停顿（debounce 后）、连续删除的每次操作

### 4.4 栈上限与快捷键

- `undoStack` 超 **100** 项时手动 shift 截断（保持原 HISTORY_LIMIT 体验；Y.UndoManager 无内建上限）
- `useGroupKeyboard` 的 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y → `undoManager.undo() / redo()`（输入框/AntD 弹层豁免逻辑不变）

---

## 验证标准

1. **多团队**：新建团队余额 0 且无流水；创建后自动切换；Navbar 切换器切换生效；解散当前团队后自动回退剩余团队
2. **项目角色**：PROJECT_VIEWER 打开画布只读（协作编辑被服务端拒绝）、执行返回 403；PROJECT_EDITOR 可编辑可执行；PROJECT_OWNER 可管项目成员；**多 PROJECT_OWNER 平权，移除最后一个显式 OWNER 被拒**；Team ADMIN 无项目记录时为 EDITOR 但仍可删项目（两层分离）；项目创建者默认 PROJECT_OWNER
3. **OWNER 转让**：转让后原 OWNER 变 ADMIN、Team.ownerId 更新、审计有记录；转让人不可转让给自己/非成员
4. **审计日志**：1.4 表格动作均产生记录；第 5 tab 分页正常；仅 OWNER/ADMIN 可见
5. **多实例**：双 api 实例（不同端口）+ 浏览器各连其一，同项目实时同步（update+awareness）；实例 A 上 execute 能读到实例 B 上未持久化（5s debounce 窗口内）的最新参数（跨实例 sync + SV 等待）；**并发 compaction 不丢更新**——实例 B append 后、广播到达前，实例 A 触发 compaction，B 的更新行（seq > maxSeq）保留且下次加载可重放
6. **SV 等待**：自动化测试——写参数 → 立即 execute（带 x-yjs-sv）→ 断言执行读到新值；无头请求兼容通过
7. **undo/redo**：本地操作可撤销/重做；远端用户/AI 写入后本地 Ctrl+Z 不撤销远端内容；一次拖拽一个 undo 项；参数连续输入合并一项、停顿后分隔；栈超 100 截断；刷新后 undo 历史清空（UndoManager 为内存态，预期行为）
8. **回归**：模板保存/导入、素材库、组操作、6 类节点生成、协作 presence、断网重连恢复

## 明确不做（本次边界）

- 团队层自定义权限矩阵/自定义角色名
- 增量表内容级去重（接受冗余行，compaction 回收）
- Sentry/新观测设施（用现有 Prometheus + Logger）
- Redis 持久化增强（增量日志以 Postgres 为准，Redis 仅 pub/sub 通道）
- sticky session 代码实施（2.5 登记部署建议）
