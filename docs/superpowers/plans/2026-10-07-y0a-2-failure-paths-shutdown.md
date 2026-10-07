# Y0a-2 失败路径与关停 Implementation Plan（v4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **v4（2026-10-07，第三轮三份外审回馈+一手核验后修订）**：三报告对 v3 的核心指控——"裁定表改了、Task 代码块仍是旧文本"——**经逐块核验成立**（Y4/Y5/Y15/Y17/Y19 共 5 族功能性断裂+7 族编译级残留）。v4 修订 19 项采纳（Y1-Y24 归并，见 §0.7）+6 项拒绝（J1-J6 附理由）。架构裁定三轮稳定无方向性变更；本轮全部是**施工面对齐裁定**。三项第三轮自我勘误经核验坐实收录（报一认错 redis/MINIO 两项+报三认错 N2 推演）。

> **v3（2026-10-07，第二轮三份外审回馈+一手核验后修订）**：v2 的架构裁定（§0.5 V1-V25/R1-R8）经三份独立复审确认成立（V1 confirm 语义两报告独立推演通过），但 v2 落地形态存在 **2 项"跑不起来"**（collab-core 无 redis——v2 的 V20/F5 勘误经核验**反了**（ci.yml:95 的 redis 属 e2e-collab job）；MINIO 占位 env 过不了 MinioModule 的 ensureBucket——`MINIO_INIT=skip` 是唯一解且为仓内 B′ 终裁先例）、**1 项自断言必红**（storeInFlight try/finally 与契约 14"spool 失败不清标志"矛盾）、**僵尸队列回归**（handleProjectsGone 不清 pendingQueues→drain_complete 永不打印）、**≥10 处裁定表与 Task 代码块脱钩**。全部修订见 §0.6（X1-X19+3 项拒绝）——**本版直接改写了 Task 代码块**（吸取 v2"patch-on-patch 脱钩"教训）。两项 spec 变更仍待拍板（§0.5 尾）。
>
> **v2（2026-10-07，第一轮三份外审回馈+一手核验后大修）**：v1 存在 1 处数据蒸发级 bug（P0-1 confirm 语义）、2 处预算不可证伪、1 处假绿（FK 形状——本地真库实测 raw FK=`P2010+meta.code:'23503'`）。核验锚：`storeDocumentHooks` 在 `saveMutex.runExclusive` 内调两 store 钩子（esm:1536-1539）；`onClose` else 分支无条件 `unloadDocument`（esm:1382-1387）且 `beforeUnloadDocument` 抛错=catch→return 取消卸载（esm:1580-1588）。

**Goal:** 落地 Y0a 第二子批——spool 单源落盘（**删内存 unflushed Map**，分段文件+帧 `[4B len][4B CRC32][payload]`+fsync+帧 id confirm+**V1 confirm 语义（新帧 PG 成功前永不 confirm）**+段封禁+quarantine 字节区间+两态熔断+回灌总预算）+storeDocument **BOI 重写**（AppendResult 判别消费·fenced 0 行不抛错/copy-first/任何路径不 throw/saveMutex 串行·**队列 projectId 键控化**·降级态 spool-first·**X9 分层受理门（draining 拒连/spool 熔断只读化）**）+退避无上限（**熔断态暂停+probe 唤醒 X6**）+storeInFlight（**四落定点 X2**）+关停 drain 六步（**预算 ≤22s 机制化上界**+force-spool 子预算+结构化日志）+project.gone 单点清账（**提交后 emit**+显式清账+FK 双形状兜底）+beforeUnloadDocument **BOI 交接守卫**+mergeUpdates 出 WS 消息路径+kill -9/SIGTERM 演练（**G-1 双模式 quiescence barrier 含 storeInFlight/G-2a·G-2b 双判据/崩溃模拟红相**）+collab-core job 演练步骤（spec v2.4 §3 Y0a-2）。**v2 修订全文以 §0.5 裁定总表为准**（V1-V25 采纳/R1-R8 拒绝）。

**Architecture:** 持久化模型（契约 §2.1 头注释钉死）：PG=单实例 delta 并集日志；CRDT 幂等收敛；锁只管 compact；内存 pending 队列=去抖窗口非持久层；**spool 文件=store 故障期唯一权威待落库台账**；onStoreDocument 不 throw。核心不变量=**BOI**（契约 §4.3-11）：任何批次任意时刻至少归属于 {doc 队列, spool 已 fsync, PG 已提交} 之一，离开旧归属必须先进入新归属。三代旧实现红相（splice-first / splice+putStash-throw / fenced-0-行不检查返回值）全部留档后 copy-first 绿。

**Tech Stack:** NestJS/Prisma/PG16/yjs 13.6.32/@hocuspocus/server 4.6.0（flushPendingStores·afterStoreDocument·beforeUnloadDocument·saveMutex 均公开——2026-10-06 探针实证 index.d.ts:193/:318/:322/:761）/vitest/node:zlib crc32（node≥20.12，本地 24/Ci 22 探针过）/tsx（脚本载体）。

**执行门（spec §2.1）**：Task 10 出口清单全绿后**请用户确认再启动 Y0a-3 plan**。

**TDD 纪律**：先失败测试（红）→最小实现（绿）→commit；三代 BOI 红相在重写前对旧代码跑红留档（D13）。**探针前置（v8 目录第 10 条）**：新守卫落地附最小可复现构造；**失败分支推演（v8.3 第 10 条增补）**：每守卫写出依赖缺失/异常态/判据可达性三型行为表。

---

## 0. 基线快照（2026-10-06 一手核验，master=5cec38ce）

### 0.1 代码基线表（Y0a-1 后行号已漂移，本表为当前行号）

| 位置 | 现状 | spec 引用 |
|------|------|----------|
| `collab.gateway.ts:79` | `unflushed = new Map<string, Uint8Array>()`（内存台账，进程崩溃丢） | §2.2 删除对象 |
| `collab.gateway.ts:253-264` | takeStash（先删）/putStash（内存 merge）——**内存 unflushed Map 唯一出入口** | §2.3 |
| `collab.gateway.ts:266-274` | peekStash/consumeStash（Y0a-1 落，load 路径专用） | §1.10 改造对象 |
| `collab.gateway.ts:280-317` | storeDocument：`:287` takeStash 提前 drain unshift/`:290` `queue.splice(0)` **先取走**/`:293` append **不消费返回值**/`:294-303` catch→unshift 回灌+`throw err` | §2.3 BOI 重写主对象 |
| `collab.gateway.ts:34` | `PERSIST_RETRY_DELAYS_MS=[1,2,5,15,30]s` 5 档梯（`schedulePersistRetry:364` 耗尽即弃） | §2.3 无上限化 |
| `collab.gateway.ts:382-412` | retryPersist：`:396` stash 级 takeStash **先删**→`:398` append 失败 payload 局部变量=**取走后静默蒸发** | §2.3 peek 化 |
| `collab.gateway.ts:419-435` | disconnect：`:423` await storeDocument（直调点）+`:433` catch→stashPending | §2.3 直调串行化 |
| `collab.gateway.ts:438-448` | stashPending：`:442` splice 后 putStash（第二同形状点） | §2.3 改造 |
| `collab.gateway.ts:549-561` | onApplicationShutdown：清 sweep/retry 定时器→closeAllConnections1012→destroy 与 **8s race**（无 drain/无 flushPendingStores/无 force-spool/日志非结构化） | §2.4 六步重排 |
| `collab.gateway.ts:200-208` | update 回调 `:207` `q.splice(0, q.length, Y.mergeUpdates(q))` **同步合并阻塞 WS 消息路径**（3000 条实测 4.8s） | §2.6 出 WS 路径 |
| `collab.gateway.ts:58/:64-66` | lastCompactAt（**全仓无 delete=真泄漏**）/persistUnhealthy/persistRetry——无卸载清理点 | §2.6 beforeUnloadDocument |
| `collab.gateway.ts:456-458` | 仅 `team.disbanded` 订阅；**项目删除三入口零清账** | §2.5 |
| `store.metrics.ts:22-26` | `yjsUnflushedProjects` gauge（内存 Map size——spool 后改语义） | §2.2 断言改造 |
| `project.service.ts:107` / `:110-118` | delete(id)/cleanDrafts(**deleteMany 不返回被删 id 集——emit 前需 findMany 拿清单**) | §2.5 emit 点 |
| `template.service.ts:153-158` | `$transaction` 内 `:156` canvasProject.delete（projectId `:155` 已判存） | §2.5 emit 点 |
| `team.service.ts:418` | `emitAsync('team.disbanded', {teamId, projectIds})` 先例（处理器禁慢操作的原因写在其上） | §2.5 形态依据 |
| `collab.module.ts:10-28` | providers 注册面（CollabSpoolService 落 `:26` 一带；COLLAB_REDIS 族 Y0a-3 删） | Task 1 |
| `prisma/schema.prisma:66-78` | Session.`token @unique`——演练直插 session 行即过 WS 鉴权 | Task 9 |
| 12 处 unflushed 断言 | persist-status.spec `:110/:118/:122`+gateway.spec `:587/:620/:625/:644/:647/:658/:661/:677/:681/:731` | §2.2 断言改造清单 |
| `new CollabGateway(` 构造点×6 | kit（dual-client-server.ts:41）+auth-reason:26/shutdown:16/persist-status:38/env:11/sweep:24（gateway.spec 经 kit） | Task 3 冲击面 |
| `apps/api/scripts/collab-compact.ts` | tsx+tsconfig.scripts.json 静态载体先例（Y0a-1 Task 9 裁定） | Task 8 同族 |
| `.data/` | **不存在**（spool 目录由代码 mkdir；.gitignore 需补条目） | Task 1 |

### 0.2 库行为锚（2026-10-06 dist 一手探针补充；A1-A10 见 Y0a-1 已落锚）

| # | 事实 | 证据 | 本批消费点 |
|---|------|------|-----------|
| A11 | `flushPendingStores(): void` **公开同步**（对每个 debounced doc `executeNow`——fire async）；`destroy()` 内部 runDestroy 自调（esm:1734） | index.d.ts:193 / esm:1348-1353 | drain 步骤 3（同步触发+≤6s 轮询窗口，非 Promise.race） |
| A12 | `afterStoreDocument?`/`beforeUnloadDocument?` 是 Server Configuration 可选钩子（index.d.ts:318/:322）——`beforeUnloadDocument` 抛错→库 catch→**取消卸载**（Y0a-1 已实证） | index.d.ts | Task 4 对账钩子/Task 7 清理钩子（**钩子体永不抛**） |
| A13 | `runDestroy`=close HTTP→closeConnections→flushPendingStores→**等 doc 计数归零才 resolve**（afterUnloadDocument 扩展轮询） | esm:1725-1742 | drain 步骤 4 主力先行（destroy 只兜底）+步骤 5 分型 |

### 0.3 plan 级设计裁定（spec 留白处定死；执行中不得再议）

| # | 裁定 | 理由 |
|---|------|------|
| P1 | **pending 观测载体**=gateway `computePending()`+两个 Gauge（prom-client **collect 回调现算**——零漂移零维护点）；演练经 `/api/metrics` 轮询；Y0a-3 ready.pending 字段**消费同一方法**（跨批登记，spec §3.3"计数器 Y0a-2 才落地"落此）。**Y5 终口径：返回 `{projects,batches,spoolFiles,spoolBytes}`+gauge 名 `yjs_pending_projects`/`yjs_pending_batches`**（v4 全局统一——本表初稿的 docs 键名作废） | ready 端点归 Y0a-3；演练 G-1 需要 Y0a-2 即可轮询的进程内观测面 |
| P2 | G-2a"ready 已转 draining"半句=**Y0a-3 接入点**（ready 端点同批）；Y0a-2 演练验 `shutdown_undrained` 日志与 storeInFlight 一致+spool 可读帧全可解析 | 不为演练提前落 Y0a-3 端点（防跨批范围漂移） |
| P3 | spool 熔断**对外面**（v3/X9 修正：本批落**只读降级**——新连接 readOnly+stateless 通告；writeNodeData/writeExecStatus 503）+熔断位+探针解熔断+计数+gauge；ready 503 reason=spool-unwritable 归 Y0a-3 接线 | 原"拒新连接"形态会把本地磁盘故障放大成全站画布不可读（loadDocument/readCanvas 均被拒）——报告二 1.5 成立 |
| P4 | 运维脚本载体=`apps/api/scripts/*.ts`+tsx（循 collab-compact.ts 先例——tsconfig.scripts.json typecheck 载体）；spec §2.2/§4.2 的 `scripts/collab-spool-quarantine.mjs`/`collab-spool-import.mjs` 名字按此落 `.ts` | Y0a-1 已裁定的静态载体纪律 |
| P5 | **storeInFlight=doc 级口径**（"承载进过取批且未落定批次的 doc 数"）；enter=storeDocument 取批路径首行（doc 无标志时 set）/leave=归属落定（append `r.ok===true` 或 spool fsync 成功后 clear）；spool 失败回队列**不清标志**（重试 enter 幂等）；drain force-spool 复用 leave 点 | 批次级 token 需跨调用随批走（复杂度不值）；项目级与 `shutdown_undrained.projects`/`pending.projects` 同量纲，G-2a"值一致"以 projects 字段对齐（契约 14 两点规则完全满足） |
| P6 | FK 违反（Prisma **P2003**，PG SQLSTATE 23503）=项目已删的 **DB 权威证据**：append/回灌撞 FK→按终态丢弃+计数（终态集是事件路径的主动拦截优化，非丢弃前提——重启后终态集空仍可凭 FK 收割残留段） | spec §2.5"收割路径=FK 识别"在重启场景自洽 |
| P7 | collab-core job 本批**补 redis service**（演练子进程起 AppModule 含 BullMQ）；spec §4.5"redis service Y0a-3 起补"按演练实际需求提前——偏差登记 | 演练是本批出口判据载体 |
| P8 | `queue.splice` 与批的取批语义：copy-first 重写后 `storeDocument` 取批=**读 queue.length+copy（merge 不动队列）**，`splice(0,n)` 仅在新家落定后执行（n=进入时快照长度；splice 后新 push 的更新自然留存） | BOI 契约 §4.3-11 逐字实现 |
| P9 | 熔断态下 storeDocument 的 **BOI 路径**不变（仍 append→失败→spool 尝试→失败→批留队列）；v3/X6 修正：**重试梯排程在熔断态暂停**（60s 撞满盘无意义——probe 成功后 rearmQueues 统一唤醒） | BOI 语义优先；排程暂停≠路径改变 |

### 0.4 既有测试基建（Y0a-1 产物，本批直接复用）

- `test-utils/mock-repo.ts`（createMockRepo：append 恒 `{ok:true,seq:1n}`/compact `{compacted:true}`/hydrateWithRecovery 委托）
- `test-utils/failing-repo.ts`（failAppend/failCompact——**post-N resolve undefined 缺陷须修**，Y0a-1 Minor 1 登记，Task 3 Step 1）
- `test-utils/dual-client-server.ts`（真 Provider×N+真 Server 随机端口+poll-until）
- `test-utils/db-fixtures.ts`（User→Team→CanvasProject FK 链——int/演练共用）
- collab-core CI job（int 显式清单+passed≥13——本批 Task 10 扩演练步骤）
- 命令口径：int/演练本地跑=Git Bash 前缀赋值 `DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api exec ...`；tsx 经 `pnpm --filter @flowweb/api exec`（api devDep）

### 0.5 v2 外审裁定总表（2026-10-07 三份报告回馈；全部主张一手核验后才裁定——**本表是 v2 修订的单源，Task 内冲突处以本表为准**）

**采纳（P0 阻断级——不改则丢数据/假绿/跑不起来）**

| # | 裁定（落点） | 核验依据 |
|---|------------|---------|
| V1 | **confirm 语义修正（P0-1+B7，T1/T3）**：新帧**永不**在写入路径 confirm——只在"内容已被 PG 成功接收"（成功路径 append `r.ok` 后）时 confirm 本批 peek 出的**旧帧**；失败路径 `spool.append(仅本批 payload)`（**不并入旧帧**——旧帧留在 spool 由下次成功路径合并读）。v1 的 `confirm([stashIds, ...newIds])` 在"新帧与旧帧同段"时=段全 confirmed→unlink→批物理消失（蒸发），且逐轮合并重写=O(n²) 写放大。此模型（失败写本批/成功合并读/新帧 PG 成功前不 confirm）同时消灭 P0-1、B7 写放大、报告二 P1-1 的四项结构代价——**拒绝 drainer 重构**（见拒绝表 R2） | v1 Task 3 Step 6 伪代码推演：F1 与 F2 同段时 unlink 后 PG/spool 双空 |
| V2 | **段封禁 sealed（P0-2，T1）**：`SegmentMeta` 增 `goodBytes`（已证干净字节上界）+`sealed`；追加前守卫（段尾不干净或已 sealed→滚动新段）；`writeFile/sync` 抛错即封段——消灭"半写后继续追加同段→后续帧永不可读"黑洞。ftruncate 尾部恢复**不做**（见 R7） | appendRaw 只在成功后自增 frameCount——失败尾部字节无人管 |
| V3 | **quarantine 改字节区间（P0-2b/E5，T1/T2）**：隔离=字节区间事实（坏帧起始偏移→EOF），sidecar 记 `{quarantinedFromOffset, reason, firstSeenAt}`；`quarantinedBytes = byteLength - off`（v1 的 `- FRAME_HEADER_BYTES` off-by-8 实错）；段回收条件=**全部可解析帧 confirm ∧ 坏区间已隔离**；启动 scan 对已隔离帧**不重复递增** quarantined 计数 | v1 的 `for(i=firstBad; i<frameCount)`——scan 停在坏帧使 frameCount===firstBad → 恒空循环（真 bug） |
| V4 | **队列归属 gateway 化（P0-3/B2/E7/E8，T3）**：`pendingUpdates` 改 **`Map<projectId, Uint8Array[]>`（gateway 权威）**+`WeakMap<Y.Doc, string>`（doc→projectId 关联，loadDocument 播种）——批次第一归属地的生命不再由库的卸载掌握（esm:1382-1387 无条件卸载）。computePending/drain/peekSpoolFrames 一律遍历自有 Map（单源派生，测试禁裸 Y.Doc 直插参与 pending 断言） | onClose else 分支+unloadDocument 直接 documents.delete+doc.destroy() |
| V5 | **beforeUnloadDocument=BOI 交接守卫（P0-3，T3/T7）**：钩子内若该项目队列非空→先尝试 spool 交接（fsync）；spool 亦不可用→**抛错取消卸载**（esm:1580-1588 catch→return——doc 留内存=数据保命）+ERROR 点名 `{event:'unload_blocked_undrained', projectId, batches}`；清理职责（lastCompactAt 等）保留且自身 try/catch 永不抛（"永不抛"限定清理段——交接段的有意 throw 是守卫本体） | unloadDocument 对钩子抛错的 catch→return 语义 |
| V6 | **FK 双形状判别（P0-4，T2/T6）**：`isFkGone(e) = e?.code==='P2003' \|\| e?.meta?.code==='23503'`——$queryRaw 失败=P2010+meta.code=SQLSTATE（本地真库实测 `P2010/meta.code:'23503'`）；**FK 用例必须有真库 int 背书**（collab-spool.int.spec.ts：建 fixture→写帧→删项目行→replayAll→断言 discarded+段回收），mock-only FK 用例标注无效证据 | fkprobe 实测输出 |
| V7 | **演练三修（P0-5，T9）**：①fixture 补 **TeamMember+Session**（`ensureCollabSessionFixture` 落 test-utils/db-fixtures.ts 并导出常量——v1 漏 TeamMember 使 authenticate FORBIDDEN）；②spool 故障**启动后**注入（listening 后对目标段路径 mkdir 同名目录→`open('a')` 抛 EISDIR——跨平台确定；v1 的"目录占位文件"会使 onModuleInit 的 scan mkdir 先崩）；③回灌等待改**轮询**（`yjs_spool_depth_files===0` 或子进程结构化日志行，带 deadline） | authenticate:154 查 teamMember；scan 首行 mkdir recursive 对文件路径抛 |
| V8 | **append 上界+预算 deadline 化（B3/P1-3/D2，T3/T5）**：`repo.append` 包 `$transaction(..., {timeout: 5_000, maxWait: 1_000})`（与 loadForHydration 同族——挂起 append 占 saveMutex 会穿透全部预算）；drain 步骤 4 每 doc **2s deadline**（`Promise.race`，超时即跳过 store 转 force-spool）；force-spool 独立子预算 **≤2s**（best-effort 归属落定不值 20s）；预算表每步标注**上界机制**（timer/race/transaction timeout——写不出机制依据的步不是预算） | append 现状裸 $queryRaw 无上界 |
| V9 | **graceDirectConnections 入口判定（B4，T5）**：首查 `directConnectionsCount` 总和，为 0 立即 return——消灭"每次重启无条件多 2s" | v1 无条件轮询 |
| V10 | **project.gone 终态拦截显式清账（B5，T6）**：拦截分支显式 `queue.splice(0)` 清队列+计数 batches/bytes+点名日志 `{event:'project_gone_discard', projectId, batches, bytes}`——丢弃是对的，静默丢弃不是 | v1 拦截 return false 留死队列 |
| V11 | **emit 后置（P1-6/E9，T6）**〔spec 变更①〕：emit 移到**删除事务提交之后**（delete/cleanDrafts/template 三入口）——消灭"回滚→假终态黑名单→该项目协作写永久静默被拦"；提交→emit 的亚秒窗由 FK 权威（V6）承接；`deletedProjects` 保留为快路径缓存（无假终态后无需 restored 补偿/TTL） | v1 前置 emit+永久 Set 的组合在回滚时毒化 |
| V12 | **降级态 spool-first（P1-2，T3）**：`persistUnhealthy.has(documentName)` 态下批**先落 spool（fsync）再尝试 PG**——故障腿窗口从"maxDebounce+append 全程（PG 挂起时无界）"压回"一个 debounce 窗+fsync"，使 spec §5.1 表成立；稳态保持 PG-first 零写放大 | spool 写在 append 失败后的时序事实 |
| V13 | **isAcceptingWork 三入口（D3/D4，T3/T5）**：`isAcceptingWork() = !draining && spool.isWritable() && !spool.overCapacity()`——挂 `authenticate()` 首段（拒新连接 typed reason）/`loadDocument()` 首行/`CollabDocumentService.withDoc()` 首行（openDirectConnection 之前）。draining 与熔断位由此获得**真消费者**（v1 的 P2/P3"留 Y0a-3"裁定作废——受理面是 drain 可达性的前提，不提前则"关停期间新写入静默丢"）；Y0a-3 的 ready 端点消费同一方法不产生第二语义 | closeAllConnections1012 后 HTTP/WS 升级照常+withDoc 直连仍可写 |
| V14 | **io/容量熔断两态分离（D4/B8，T2）**〔spec 变更②〕：`ioBroken`（探针可解）与 `overCapacity`（仅 depth 回落可解）分离——v1 的 probe 复用 append 会用 IO 恢复误关容量熔断；**容量核算含隔离字节**（隔离段同占盘——"排除"=磁盘被隔离字节填满而熔断永不触发）+容量计数不再进写失败 streak | probe→append→noteWriteSuccess 链 |
| V15 | **spool 目录 fail-fast+绝对路径（P1-5，T1）**：启动日志打印 spoolDir 绝对路径；`NODE_ENV=production` 下 `COLLAB_SPOOL_DIR` 非绝对路径→拒绝启动（CWD 漂移=静默换账本）；目录不可用（scan 抛错）→拒绝启动+结构化日志（**没有台账就不该收编辑**——fail-closed 语义前置，Y0a-3 ready 给 reason 只是锦上添花） | resolve(cwd/.data/...) 对 CWD 敏感 |
| V16 | **replayAll 总预算（D5/P1-7/M6，T2/T4）**：总墙钟预算默认 **5s**（耗尽即返回 `{failed}` 点名，帧保留）+固定 200ms 重试（启动期不指数退避）+同项目连续帧**合并为一次 append**（失败再退化逐帧隔离坏帧）；listen 仍在回灌后但"之后"有界 | v1 最坏 15s×帧数阻塞 listen |
| V17 | **测试工程修正（§4 系，各 Task）**：①T1 spec 改 beforeEach/afterEach 独立目录（v1 全文件共享 dir 且只在首用例赋值——用例 3/5 互染必红）；②T5 logCalls spy **前置**（动作后 spy 抓不到任何调用——真硬伤）；③BOI-1 append 挂起改 **deferred 可解锁**（永挂占 saveMutex 使 kit.dispose 的 destroy 永不 resolve=整套用例挂死）；④computePending 用例帧在 kit 启动**后**注入（v1 会被 onModuleInit 回灌消化掉）；⑤退避用例先 `clearTimeout(entry.timer); entry.timer=null`（armed 状态无法区分重排与否）；⑥`metric.get()` 替代 hashMap 内部读取；⑦kit 自建 spool 目录进 dispose 清理（"tmpdir 自动清理"不成立）；⑧删除 `void writeFile` 类占位语句 | 逐条静态核验 |
| V18 | **行为断言改写清单（E3/F8，T3/T4）**：`gateway.spec.ts` 绿9（:684 折叠注释改写——**禁折叠**后 70 条全留队列，断言本体兼容需改注释+时序说明）/绿9b（:698-709 `rejects.toThrow('db down')`→**`resolves.toBe(false)`**——契约 3 不 throw 直接反转该断言，必红点）/`persist-status.spec.ts:88`（"第 5 档已耗尽"断言→永续重排断言）——v1 的 12 行清单漏此三族；unflushed 断言实际=11 行断言+1 行装置（:658 预置），清单按行列 | 逐行核验 gateway.spec:684-720/persist-status:88 |
| V19 | **崩溃模拟红相（B6，T3）**：红相层新增——真 provider 写入+append 失败→**丢弃 gateway 实例（等价进程死）→同 spool 目录新建 gateway→断言批可回灌**（旧实现批在内存=必红）；白盒直调层保留但标注"绕过库 debouncer/saveMutex 链，仅测 storeDocument 自身语义"；v1 三代表中"二代=v2.1 形状"显式降级为**设计论证**（非实跑红相） | 直调 hooks 不经库包裹（esm:1532-1554） |
| V20 | **事实勘误（F5/F6/E13/E14/E15/F7）**：collab-core job **已有** redis service（ci.yml:95-102，P7 裁定作废）/`.data/` 已在 .gitignore（:13，T1 删该步）/`@hocuspocus/provider@4.6.0` 已是 devDep（package.json:59，T9 删安装步）/kit **已导出** emitter（dual-client-server.ts:23/:39，复用勿新增）/递归扫描**本批落**（T7——从 T10 跨批登记中去重）/断言清单按"11 行断言+1 行装置"计 | grep 逐条实证 |
| V21 | **演练环境依赖（E11/E12，T9）**：子进程 env 注入 `MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY` 占位值（app.module.ts:41 顶层 validateEnv 缺则 process.exit(1)）+本地演练前置 Redis（subscription-scheduler.service.ts:14 onModuleInit await getRepeatableJobs()——启动期硬依赖；CI 已有 redis 无碍）——runbook/命令注明 | env.ts:37-42+grep 实证 |
| V22 | **观测修正（P2 系，T3/T4）**：删 `yjs_unflushed_projects`（换义指标无消费者，直接删+登记 spec 变更）；`storeInFlight` 改名 `yjs_store_in_flight_docs`（doc 级口径量纲诚实，spec §5.2 表同步）；storeInFlight 的 leave 收敛 **try/finally 单点**（v1 散 3 处——中间 throw 漏减漂移）；collect() 体内 try/catch 返回零值+`unregisterPendingCollector()`（防 scrape 崩+多 gateway 覆盖）；afterStoreDocument 对账收缩为**存活计数**（`yjs_store_hook_calls_total`）——真对账移入 storeDocument 成功路径 splice 点自检（`splice 后 queue[0]===head 快照 ⇒ anomaly`——零误报，E4/B 系"去抖窗新写入恒误报"成立故撤 v1 判据）；`collabLeaseLostTotal` 指标移 Y0a-3（Y0a-2 fenced 不可达=无消费者死代码——fenced 分支的 ERROR 日志与行为保留，BOI-2 用例照测）；fenced 的 selfIsolate 接线维持 Y0a-3 登记 | 活跃编辑稳态推演 |
| V23 | **G-1/G-2 判据升级（报告三 G1/G2，T9）**：barrier 条件加 `yjs_store_in_flight_docs===0`（批离开队列≠批到 PG/spool——kill 时机最脆弱窗）；正常模式补 ack 反向下限（kill 前 `SELECT count(*)` 记 seqBefore→重启后 count≥seqBefore——防"驱动侧没写进去"假绿）；故障模式 barrier 前断言 `yjs_spool_depth_files>0`（证明确在故障态） | barrier 语义推演 |
| V24 | **契约扫描收缩（P2-6，T7/T10）**：删"契约 3/11/14 扫描"承诺（不 throw/BOI/两点规则是语义属性，正则不可证伪——违 D13 自订纪律）——只保留结构锚（update 回调零 mergeUpdates/compact await 后顾/递归收集）+行为断言载体（BOI 用例族） | D13 |
| V25 | **M1/M5 观测补丁（T7/T6）**：beforeUnloadDocument 清理段 catch 加 `yjs_unload_cleanup_failure_total`+WARN（清理失败必须留痕）；`deletedProjects` 加 `yjs_deleted_projects` gauge（"接受"变"可见地接受"）；M4 演练 finally 删 session 行 | 逐条 |

**拒绝（附理由——防下一轮翻案）**

| # | 拒绝项 | 理由 |
|---|-------|------|
| R1 | D1 帧头 maxSeq+`<projectId>.ack` 水印 | **性能优化非正确性修复**：spec §2.2 明示接受重复回灌（CRDT 幂等）；回收路径存在且闭环（运行期 store 成功路径 confirm 旧帧+回灌 replayAll confirm+段回收）——"部署门恒红"仅在 PG 持续故障期=门禁的正确行为（PG 挂时本就该拒部署，PG 恢复后回灌自愈归零）。引入第二持久状态（ack 文件）+新失败模式（ack 损坏）换重复行减少，不值。**登记为可选增强**：Y0a-4 部署门实测若重复回灌成本不可接受再上 |
| R2 | P1-1 spool 独立追加流+SpoolDrainer | V1 模型（失败写本批/成功合并读）以**零新增组件**消灭同一组四代价（confirm 耦合/IO 放大/重复落库/状态不可判定）；drainer 另增 120 行+新并发面（drainer×store 的 confirm 竞争+5 触发点），其唯一剩余收益（回灌不依赖 store 触发）已由重试梯+启动回灌覆盖 |
| R3 | P1-4 spool 每实例子目录 `dir/<instanceId>/` | Y0a-2 单实例无此并发面；fenced 前任写 spool 是 Y0a-3 租约/fence 落地时才存在的路径——**跨批登记 Y0a-3**（与租约同批，instanceId=租约 owner 同值），本批提前=为不存在的并发付布局复杂度 |
| R4 | G4 collab-drain CLI 脚本 | SIGTERM 即 drain（六步内建于 onApplicationShutdown）——deploy 直接 restart 信号即触发完整 drain；"停写不关停"语义归 Y0a-3 的 POST /api/drain（需要 HTTP 存活才能轮询 pending，CLI 做不了这件事） |
| R5 | E9 project.restored 补偿事件 | V11 emit 后置后无假终态场景（回滚→无 emit→无黑名单）——补偿事件失去存在前提 |
| R6 | P0-2 的 ftruncate 尾部恢复 | 封段+滚动（V2）已使"半写段"后续帧全部可读可回收——段文件非稀缺资源，ftruncate 的"段复用"收益不抵其"删字节"操作与契约 12 的额外例外复杂度（V2 的封段本身就是契约 12 需补的唯一例外） |
| R7 | E1/E2/E6 三项"测试断言互斥/竞态/mock 签名"指控 | 逐条核验不成立：BOI-3 的 mock append throw→v1 失败路径 spool.append（spool 健康）→帧在 spool（断言对象正确）；BOI-1 直调路径的 splice/copy 与 append mock 创建同处同步段（await 前），sleep(100) 后断言无竞态；createMockRepo(over)/failingRepo(opts) 签名与 v1 用例调用一致 |
| R8 | 报告二 P2-8"draining/熔断占位无消费者则删除" | V13 已给真消费者（受理三入口）——占位升级为功能，无需删 |

**spec 变更（2 项——2026-10-07 用户已确认批准；落地=Task 10 Step 3 随批改 spec 文档）**

1. **§2.5 emit 时点：删除前 → 删除事务提交后**（V11）——理由见上；spec 原文"删除前 emit（emit 先于事务提交，回滚即丢台账）"的顾虑对象（spool 段）已被 V10/V6 的"处理器零磁盘 I/O+FK 收割"取代，回滚风险面已不存在。cleanDrafts 的 FOR UPDATE 事务形态（X13）同批写入。
2. **§2.2 容量核算："排除已隔离字节" → 含隔离字节**（V14）+**契约 12 补段封禁例外**："帧文件变更只用追加与整段 unlink"→"……与**段封禁**（sealed 后永不再追加、滚动新段——只置位不删字节，禁 ftruncate/R6）"；另 §4.3-8 帧格式句补"confirm 语义=内容已被 PG 成功接收（成功路径统一 confirm peek 出的旧帧；新帧 PG 成功前永不 confirm）"。

### 0.6 v3 外审回响（2026-10-07 第二轮三份报告；核验后裁定——**本节条目直接改写 Task 代码块，v2 的 §0.5 与 Task 正文冲突处以本节+改写后的代码块为准**）

**核验坐实的 v2 错误（两项"勘误勘误错了"）**：①ci.yml collab-core job（:136-160）**只有 postgres**——:95 的 redis 属 e2e-collab job（:85），V20/F5 的"已有 redis"结论**反了**（v1 P7 复活：补 redis）；②`MINIO_INIT=skip` 是仓内既有 B′ 终裁机制（minio.module.ts:29-38——不设时 ensureBucket 对占位 endpoint 3 重试后 **throw**，Nest onModuleInit 失败=启动失败），V21 的"占位 env 即可"**错了**（占位只过 zod，过不了 MinioModule）。e2e-collab job :104-110 已有 skip+占位先例。

| # | 裁定（落点） | 要点 |
|---|------------|------|
| X1 | **handleProjectsGone 清 pendingQueues**（报告一必修1，T6）：discardForGoneProject 上移到事件处理器（唯一必然执行点——doc 卸载后拦截分支结构性不可达，僵尸队列令 computePending 恒>0→drain_complete 永不打印+G-1 barrier 超时）；storeDocumentUnlocked 首行拦截保留兜底（事件与 store 的竞态窗） | 必修：G-1/G-2 判据失效 |
| X2 | **storeInFlight 弃 try/finally 改四落定点**（必修4/报告二1.2，T3）：leave 显式调用于 ①append ok ②spool fsync 成功（含 V12 降级提前写/V5' 卸载交接/force-spool）③FK/终态丢弃 ④project.gone 丢弃；**spool 失败回队列不清**（契约 14 原文——v2 的 finally 形态使 G-2a ii 档 storeInFlight===0 与 docs===1 不一致=自断言必红）；"意外异常漏减"防护=storeDocumentSerialized 外层 catch 兜底 leave | 必修：两处自断言必红 |
| X3 | **collab-core 补 redis+MINIO_INIT=skip**（报告二1.1/报告三N1，T9/T10）：job services 补 redis:7+REDIS_URL+`MINIO_INIT: skip`+三占位 MINIO_*（skip 是显式声明式裁剪先例 e2e-collab :104——生产 fail-fast 不变）；drill startServer env 同款 | 必修：演练四跑全挂 |
| X4 | **V5 重定义：beforeUnloadDocument 永不抛**（报告三N2/报告二2.2+2.3，T3/T7）：best-effort 交接（spool.append 成功→splice+leave；失败→ERROR+计数+**schedulePersistRetry 保活**——批的第一归属地在 doc 卸载后仍受退避梯保活，契约 4 补句）+清理段 try/catch。理由：V4 已免费提供"批不丢"（队列在 gateway Map）；throw 形态的问题=释放路径缺失（doc 永久驻留）+每次卸载重试循环；N2 的"unhandled rejection"推演经核验不成立（esm:1586 catch→return 捕获钩子错），但修法因驻留/停摆问题而正确 | 必修：内存驻留+队列停摆 |
| X5 | **rearmQueues()**（X4 配套，T3/T4）：onModuleInit 回灌后对每个非空 pendingQueues 条目+replay.failed>0 的项目调 schedulePersistRetry——"每个非空队列恒有恢复路径"单一不变量；**retryPersist detached 分支排空 pendingQueues**（报告二2.3：先看队列非空→spool-first 写入（失败保留不 cancel），再看 spool 帧三段式，皆空才 cancel）；R1 拒绝理由补强（回灌失败项目经退避梯运行期自愈——无需独立后台 timer） | 必修：detached 停摆 |
| X6 | **熔断态暂停重试梯**（必修2，T3/T4）：schedulePersistRetry 首行 `if (!this.spool.isWritable()) { this.retryPausedByCircuit = true; return; }`——熔断期不排（60s 撞满盘无意义）；probe 成功后若 retryPausedByCircuit→rearmQueues() 统一唤醒 | 消"永续撞盘刷日志"稳态 |
| X7 | **drain hardDeadline**（报告二1.3/C1/C2，T5）：onApplicationShutdown 起点 `hardDeadline=t0+22_000` 透传 drainAllDocuments/forceSpool；总闸 8s（`Date.now()-t0>8_000` break 转 force-spool）+每 doc `Math.min(2_000, remaining)` race；force-spool 每次 append 套 `Promise.race([append, remaining])`（可放弃）；超时分支也 `leaveInFlight(projectId)`（Set.delete 幂等——迟到的真 leave 无双扣）；peekSpoolFrames 在 drain 循环套 500ms race（磁盘挂起穿透防护） | 必修：N doc×2s 线性破 22s |
| X8 | **replayAll 重写有界重试环**（报告二1.4，T2）：每帧 maxAttempts=3（固定 200ms 退避）+总预算双闸；failed 在预算耗尽/attempts 耗尽两分支都计数；删 `failed += frame.frameId ? 0 : 0; void e2;` 死代码；**合并上界**（必修5/报告二2.1：≤8 帧且 ≤4MB 才合并单次 append，超界分轮——防 256MB 单行+同步 merge 停摆，恢复期自然有界多轮，每次 append 成功只 confirm 本轮 K 帧）；**__probe__ 段清理**（报告三C3：scan() 阶段直接 unlink `__probe__*` 段+keys() 过滤——防探针帧崩溃残留进回灌） | 必修：failed 恒 0=自检静默 |
| X9 | **V13 粒度修正：只读降级而非停服**（报告二1.5，T3）：`draining`→authenticate 拒连（**新增 CollabAuthReason.DRAINING**——transient 档；复用 db-unavailable 会让客户端停止重连=方向错）；spool 熔断（ioBroken/overCapacity）→新连接**放行但 `connectionConfig.readOnly = true`**（复用 :162 VIEWER 机制）+500ms 后补推 stateless `persist-status{healthy:false, reason:'spool-unwritable'}`；**loadDocument 永不 gate**（装载是读需求，拒装载=重连风暴）；withDoc 只 gate 写意图（writeNodeData/writeExecStatus→503 typed），**readCanvas 不受影响**。冲击面登记：packages/shared collab-auth-reason 常量+两测试文件（File Structure 补） | 必修：本地磁盘故障→全站画布不可读 |
| X10 | **update 回调 flush 闩锁+字节阈**（报告二2.5，T7）：`flushScheduled: Set<string>` 闩锁（防故障期每条 update 排一次 store 的风暴）+触发阈改"≥64 条**或** ≥1MB"双阈（替代 64 魔法数） | 故障期 CPU 自伤 |
| X11 | **yjsUnflushedProjects 冲突清**（必修3，T4）：Task 4 Step 3 的 collect 段删除该 gauge 行（V22 已裁删——正文残留） | 文书矛盾 |
| X12 | **行为断言全量清单**（必修6/报告二3.1，T3 Step 8 清单 B 扩）：gateway.spec `:494 rejects.toThrow('db down')`+`:495 toHaveLength(1)`（unshift 回灌语义——新实现 spool 成功后 splice→0，理由+数值双失效）；persist-status `:63-64 rejects`+`:75-90 梯子耗尽用例`（advanceTimersByTimeAsync 5 档+断言耗尽→永续语义反转）；pendingUpdates 装置/断言 15 处（gateway.spec :103/:424/:484/:495/:498/:601/:624/:662/:688/:690/:710/:714+persist-status :89/:193/:213）→pendingQueues；`.catch(()=>{})` 5 处（:83/:100/:132/:151/:175——语义前提复核）；**Task 4 computePending 用例+Task 5 seedPendingDoc 改 pendingQueues 键控**（N3——种子经旧 WeakMap 键=computePending 恒 0 双红）；**Task 9 Step 2 的 barrier/kill9Mode 代码块按 V23 重写**（N4——散文已改代码未改+删 sleep(2_000)）；**BOI-1 append 永挂改可控 deferred**（C5——finally release 再 dispose）；**headBefore 空断言删改**（N5：`queue[0]===headBefore` 同步段恒假=装饰性计数器——改长度判据"append 前记 n，append 成功后 queue.length<n ⇒ 并发取批=saveMutex 被绕过"） | 必修：全量回归成片红 |
| X13 | **cleanDrafts FOR UPDATE 事务**（报告二2.6，T6）：`$transaction(async tx => { ids=SELECT id ... FOR UPDATE; deleteMany({id:{in:ids}}); return ids; })` 提交后 emit 精确集合——关掉"两查询间草稿跃 cutoff→活项目进终态集"毒化窗 | 假终态残余窗 |
| X14 | **段文件耐久性与权限**（报告二2.7，T1）：新建段文件后 fsync 父目录（目录项落盘——Windows 不支持则 catch 登记）；`mkdir(dir,{mode:0o700})`+`open(path,'a',0o600)`（对已存在文件 chmod）——台账保密性不低于 PG 侧 | WAL 标准做法 |
| X15 | **isFkGone 落 pg-error.util.ts**（报告二3.3，T2/T3）：独立 util（gateway/spool 两处 import——防循环依赖）；同处放 isRetryableAppendError（V8 超时分类） | 结构 |
| X16 | **CI int 清单扩**（报告二3.2，T10）：collab-spool.int.spec.ts **写进 ci.yml int 显式清单**+passed 阈值同步（不加=门禁真空——文件永不跑而断言依旧绿）；纪律句：新增 int spec⇒同步扩清单 | 门禁真空 |
| X17 | **观测细节五项**（报告二3.5/3.6+报告三C4）：unregisterPendingCollector()+onApplicationShutdown 调用+collect 体 try/catch 归零（scrape 崩防）；`yjs_stash_discarded_deleted_total` 改名 `yjs_updates_discarded_deleted_total`+`{source:'gateway'|'spool'}` 标签统一口径；shutdown_drain_complete 增 `spoolResidual:{files,bytes}` 字段；computePending().`docs`→`projects`（V4 后按 projectId 计——字段名诚实，spec §5.2 同步）；pendingQueues 空条目回收（beforeUnload 清理段补 `if(q&&q.length===0) delete`）；confirm 的 allSettled 用 **goodFrameCount**（scan 维护的可解析帧数——非含坏尾的 frameCount）；File Structure 补 collab-spool.int.spec.ts+pg-error.util.ts+shared collab-auth-reason 三文件（C8：删 .gitignore/package.json/ci-redis 三 no-op 行） | 观测诚实 |
| X18 | **文书项**（C7/C9）：Task 9 commit 列表删 pnpm-lock.yaml；Task 10 Step 3 "plan v1"→v3；§0.5 尾"三份"表述校正 | 文书 |

**拒绝/修正第二轮报告的主张（3 项）**：
- 报告三 N2 的"unhandled rejection 死进程"**推演不成立**（钩子 throw 被 esm:1586 的 `catch(e){return}` 捕获——不会冒泡到 unloadDocument 调用者）；但其修法因 X4 的驻留/停摆理由正确，采纳修法、拒绝推演（防止后续按错误模型加固）。
- 报告二 C6 的 `@Optional()+内部兜底自建`：**拒绝**——兜底自建会用生产默认目录（.data）污染测试环境；必填参数+6 构造点全改（tsc 位置参数漏参即编译红=好特性）。
- 报告二 2.4 的独立 60s 后台排空器：**拒绝**——X5 的 rearmQueues（退避梯 60s 封顶）即运行期后台重试，无需第二个 timer 机制（防机制增殖）。

### 0.7 v4 外审回响（2026-10-07 第三轮三份报告；核验后裁定——**本节条目已直接改写对应 Task 代码块，与 §0.5/§0.6 冲突处以本节+改写后代码块为准**）

三报告共同指控成立：v3 的"直接改写代码块"承诺**未兑现**——修订留在散文/括号注记层，Task 代码块仍是 v1/v2 原文。v4 以"裁定为唯一来源重写代码块"纪律修订，并把 **Step 0 一致性自检**（该 Task 代码块引用的字段/方法名与 §0.5-0.7 裁定逐一对表）写进每 Task 首步。

| # | 裁定（落点） | 要点 |
|---|------------|------|
| Y1 | **inFlight 漂移收口**（报一必修1/报二2.5，T3/T5/T6）：`rearmQueues()` 排程处统一 `leaveInFlight(pid)`（enter 幂等——重试重新置位；语义=rearm 时旧 store 尝试已死）+`discardForGoneProject` 尾 leave+**rearm 覆盖面扩 `pendingQueues 非空 ∪ spool.keys()`**（报二2.4 观察成立：帧-only 滞留面——重启回灌预算耗尽残留/卸载交接后的帧——原 rearm 不覆盖） | 必修：G-1 barrier 永久超时（熔断→恢复→重试落定→标志悬挂→`yjs_store_in_flight_docs` 恒>0） |
| Y2 | **兜底 catch 落 storeDocumentUnlocked 外层**（报一必修2 强化，T3）：报一修法（Serialized 加 catch）只盖直调路径——**钩子路径直通 Unlocked 不经 Serialized**；改为 Unlocked 体内整体 try/catch（意外 throw→leave+ERROR+return false）一处覆盖两路径。spool 失败的正常 return false **不触发** catch（G-2a ii 断言无伤） | 必修：契约 3 静默违反+leave 漏减 |
| Y3 | **beforeUnloadDocument 顺序写死**（报一必修3/报二#12，T7）：v3 代码块 schedule 保活被清理段 cancel 立刻清掉（注释自认修法但代码没改）。终序：`cancelPersistRetry → 交接（成功 splice+leave/失败 inc+点名）→ 失败才 schedulePersistRetry → 清理段`。熔断态 schedule 首行 return 没排上→由 Y10 seam rearm 兜底（闭环） | 必修：X4 想消灭的停摆被修法自己造出 |
| Y4 | **X12 清单 grep 化+两处断言地基修**（报一必修4/报三F4，T3）：①清单改"输出 `grep -n "pendingUpdates" src/modules/collab/*.spec.ts` 逐行对照表"（当前 18 处——含 **expectDurableEquivalent 辅助体 :102-105**：4+ 用例唯一断言入口，改 `docProject.get(doc)→pendingQueues.get(pid)` 两跳）；②BOI-1 空转绿修：装置改 pendingQueues+`pollUntil` 等 append 真被调+反向断言 logger.error 未以 'unobserved' 调用（防空转） | 必修：断言地基塌一片+一代红相留档作废 |
| Y5 | **computePending 键名全局统一 `projects`**（报一必修5/报二#1/报三F1）：v3 的 T4 返回 docs/T5 读 projects/T9 读 e.docs（恒 undefined→演练两档红且报错指向错方向）。统一改：T4 定义+T4/T5 用例+T5 pollPendingDrained+T9 sigtermMode+T10 清单+**gauge 名 `yjs_pending_docs`→`yjs_pending_projects`**（drill barrier 同步改读）+spec §5.2 同批登记；`unregisterPendingCollector()` 导出落 metrics 代码块（v3 只在注记提） | 必修：同一 Task 内两键名混用 |
| Y6 | **T8 脚本按 V3 字节区间形态重写**（报一必修6）：读 sidecar `{quarantinedFromOffset,toOffset}`+好帧摘要（节点/边数）+段级 `goodBytes/quarantinedBytes` 打印；`--delete` 加 `--yes-i-understand` 二次确认+打印将删字节数；过滤 `__probe__*` 段 | 必修：生产事故唯一删段路径与隔离语义脱节+裸开关 |
| Y7 | **X10 补内存上界——硬阈异步 coalesce**（报二2.1，T7）：v1 折叠顺带提供的"每项目 ≤1 合并行"上界被 X10 删除→双败故障期队列无界。修：硬阈（≥512 条或 ≥8MB）触发 `setImmediate` 内 `Y.mergeUpdates`+**原地** `splice(0,len,merged)`（数组身份不变）；**门控**：`inFlightProjects.has(projectId)` 时跳过（反例成立：store 取批 n=3 copy 后 coalesce 压队列→store 成功 splice(0,3) 删含新内容的合并行=BOI 蒸发变体） | 必修：修 CPU 问题新开内存风险面 |
| Y8 | **splice 判据修正**（报二2.2，T3）：v3 的 splice 后 `queue.length<n` 几乎恒真（=0+新增<n）→健康路径持续刷 anomaly。改 **splice 前**判 `queue.length<n ∥ queue[n-1]!==tailRef`（tailRef=取批时 parts 末元素引用——身份校验兼防 Y7 coalesce 竞争），异常时仍 splice(0,n)（自动截断）+计数 | 必修：判据恒真=探测器变噪声源 |
| Y9 | **X9 通告修**（报二2.3/报三，T3）：`pushPersistStatus(documentName,false)` 双参不符实现（单参）且 spool 熔断不在 persistUnhealthy→首行早退=静默只读（比 v2 停服更隐蔽）。抽 `broadcastSpoolDegraded(documentName)` 独立 helper：500ms 后取 doc→broadcastStateless `{type:'persist-status',healthy:false,reason:'spool-unwritable'}`；补用例断言客户端真收到 | 必修：用户以为在编辑实则静默丢 |
| Y10 | **rearm 触发源 seam**（报二2.4，T2/T3）：X6 链条断——probe 在 spool 内、依赖方向 gateway→spool，恢复无人唤醒 gateway。spool 加公开字段 `onRecovered?: () => void`（noteWriteSuccess 解除 ioBroken 后调用）；gateway onModuleInit 注入 `this.spool.onRecovered = () => this.rearmQueues()`（幂等排程——schedulePersistRetry 对已有 timer return，无脑调用无害） | 必修：恢复后重试永久停摆 |
| Y11 | **loadDocument 队列 get-or-create**（报二2.6，T3）：不写死则"卸载交接失败→批留队列→重连 load `set` 替换"=静默丢批（V4 要消灭的形态）。`get ?? set 新数组` 永不替换+用例（交接失败→重连→同数组身份+批留存经梯落库） | 语义闭合 |
| Y12 | **hardDeadline=t0+18_000+超时不 leave**（报二2.7，T5）：22s+4s race=26s 破预算表；X7 注记"race 超时也 leave"是**错的**（超时=store 挂起=批未落定=G-2a ii 点名应含它；leave 会破坏 `storeInFlight===docs` 断言）——删该句，仅 catch（意外异常）分支 leave；force-spool 见 J5 | 预算可加算+判据保真 |
| Y13 | **挂起 append 改可释放 deferred**（报三F5，T3/T5/T7）：esm:1572 `shouldUnloadDocument` 含 `!saveMutex.isLocked()`——永挂 append 持锁→destroy 等 doc 归零永不 resolve→dispose 挂死整套用例。统一模板：`let release!: ...; const append = vi.fn(() => new Promise((r)=>{release=r}))`+finally `release?.({ok:true,seq:1n})` 后 dispose；T5 destroy spy 用例 finally 先 `vi.restoreAllMocks()` | 必修：三处用例超时挂死 |
| Y14 | **故障注入统一改服务态容量位**（报三F6 起因+核验升级）：occupied 文件形态无效（不影响段文件→spool 可写→drain_complete≠undrained）；报告三修法（mkdir 段路径占位）经推演**也会失效**——V2 封段滚动绕过（seg0 open EISDIR→封段→下次 append 滚 seg1 可写=只挡一次）。终口径：T5 用例白盒 `(spool as any).overCapacityFlag = true`；T9 `--spool-fail`→env `DRILL_SPOOL_FAIL=1`→drill-server 启动期 `app.get(CollabSpoolService).overCapacityFlag=true`（append 恒抛+不触盘+不影响启动 scan）；**--spool-fail 档不 dropTrigger**（trigger 在=drain append 恒败=undrained 确定可达——v3 无差别 drop 会让 append 成功走 drain_complete=断言红在错误方向） | 必修：G-2a ii 档不可达（两个失效形态均核验坐实） |
| Y15 | **T9 施工面落实**（报二#2/#3）：startServer env 代码块补 `MINIO_INIT:'skip'`+三 MINIO 占位（Step 1b 说了没落）；main() 改 `ensureCollabSessionFixture`（缺 TeamMember→authenticate FORBIDDEN→synced 永不触发）+FIXTURE_USER/FIXTURE_TEAM import 自 db-fixtures+删自建 sessionToken()；Step 1b 并入 Step 2（删补丁章节——脱钩载体） | 必修：演练四跑全挂 |
| Y16 | **T5 logCalls spy 前置**（报二#4）：v3 在 shutdown 之后装 spy——mock.calls 恒空。改 `installLogSpies(gateway)`（动作前）→跑→`collectEvents(spies)` | 必修：日志断言恒空 |
| Y17 | **T1 代码块终形态化**（报二#5-#8+S2）：SegmentMeta 补全 `goodBytes/sealed/quarantinedRange/quarantinedBytes`（quarantined Set 退役——T2 读不存在的字段=编译红）；appendRaw X14 完整（isFirstFrameOfSegment=stat 探测文件不存在——v3 是未定义变量；mkdir mode 0o700+open mode 0o600+新建段后 fsync 父目录）；confirm 判据改 goodFrameCount+range；isFkGone 类体内函数声明删（**class body 内函数声明=语法错**）只留 pg-error.util.ts import | 必修：编译红 |
| Y18 | **指标定义补全+旧名清零**（报二#10/3.2/报三F3）：`yjsUpdatesDiscardedDeletedTotal{source}`/`yjsUnloadHandoffFailureTotal`/`yjsUnloadCleanupFailureTotal` 三指标落 metrics 代码块（v3 只在用例/正文用从未定义）；`yjsStashDiscardedDeletedTotal` 旧名 2 处（T3 discardForGone/T6 用例）清零；用例 hashMap 内部读取改 `metric.get().values.reduce((s,v)=>s+v.value,0)`（带标签求和口径）+补"series 恰含 source=gateway/spool 两标签"断言 | 必修：编译红/静默第三 series |
| Y19 | **装置 pendingUpdates→pendingQueues 全量**（报二#11/报三F2 **部分采纳**，T3/T4/T5/T6/T7）：种子全改 projectId 键；**拒绝"删 documents.set"**——drain 循环需要 document 走 storeDocumentSerialized（detached 路径只灌帧，队列批靠 force-spool 兜底但用例 1 断言的是 repo.append 次数）；**补 saveMutex stub**（裸 Y.Doc 无 saveMutex——drain 取出直调 TypeError，两报告均未抓到）：`Object.assign(new Y.Doc(), { saveMutex: { runExclusive: (fn) => fn() } })` | 必修：种子不可见=全红 |
| Y20 | **cleanDrafts 保留 `{deletedCount}` 键**（报二3.4）：spec:265 断言 `{deletedCount:4}`+controller 透出前端——X13 的 SQL/emit 不变，返回键保留；既有 cleanDrafts 用例随 $queryRaw 事务形态整体重写（mock $transaction 透传 tx） | 断言兼容 |
| Y21 | **DRAINING 冲击面写死**（S1/F9）：collab-auth-reason.test.ts:6 是 `toEqual` 精确数组——'draining' **必须追加到末尾**（"值即线上协议串只增不改"）+describe"五档"→六档+补 `isTerminalReason(COLLAB DRAINING)===false` 断言（防未来误入终态白名单=关停期客户端停止重连）；X9 理由补正：真实依据=协议串可分型（Y0a-3 ready/Y0b UX 按档分），isTerminalReason 当前无 web 消费方（报告三核验） | 冲击面遗漏 |
| Y22 | **createTrigger 前置 DROP IF EXISTS**（S4）：CI 取消/硬崩残留触发器→下次 kill9Mode 必红 | 幂等 |
| Y23 | **T9 Step 1 注释修正**（S5）：仍写"collab-core job 已有 redis——V20/F5"（被 X3 推翻的残留）——改 X3 口径 | 文书 |
| Y24 | **文书包**：T2 commit message"启动回灌硬上限"→"有界重试环"；T6 文件头注释"emit 先于删除事务提交"→V11 后置口径；T1 spec beforeEach 化落代码块（V17①）；`depth()` 排除 `__probe__` 键；truncateByBytes 巨帧注释（单帧>4MB 单发+hydration 侧观测——防下轮当 bug 改）；`isAcceptingWork` 命名统一为 `isShuttingDown()+isWritableOrDegraded()`（Y0a-3 登记同步改）；File Structure 删 .gitignore/package.json 两 no-op 行；storeInFlight JSDoc"try/finally 单点"→四落定点（X2 残留）；出口清单补四门：内存上界门（600 条双败→队列被 coalesce 压回硬阈内）/降级可见门（spool 不可写→连接 readOnly+收到 stateless 通告+readCanvas 200）/保活门（熔断→恢复→批 ≤60s 落库）/已删项目门（事件时 store 在飞→落定后 gauge 归零） | 文书/门禁 |

**拒绝（6 项——防翻案）**：

- **J1**（报一 S3）inc 签名"不一致"：prom-client `.inc(labels)`（默认 +1）与 `.inc(labels, value)` **均合法**——非错误，不统一（防误改）。
- **J2**（报一 S6）kill9Mode 用 pid 变量：plan 原文是 `if (fault) await dropTrigger()`——**无 pid**，主张不成立。
- **J3**（报一 S8）flushScheduled 卸载清理：闩锁在 setImmediate 回调内自清（add→下一 tick delete 恒发生——卸载是 async 秒级，远晚于 tick），**无残留路径**，不加冗余行。
- **J4**（报三 F7）"队列空即 leave"语义错：帧-only 路径的帧已在 spool fsync=契约 14 落定点（flush-at-risk 窗口早已关闭），leave 语义正确——仅采纳注释澄清（帧的后续落 PG 归回灌，非 at-risk）。
- **J5**（报三 F8）force-spool `>=n` 即 splice：**危险**——race 超时且 append 实际失败时 splice=批蒸发（队列删了 spool 没写进）。正确形态=按返回值判定（`ids!==null` 才 splice）——"宁可重复（CRDT 幂等吸收），不要误删"。
- **J6**（报二 2.4）5s liveness tick 取代退避梯：已过三轮评审的退避梯整体重写=新评审风险；Y10 seam 一行解决触发源；tick 剩余收益（顺序敏感消失）已由 Y3 顺序写死解决。**登记后备**：Y0a-3/Y0b 若再发现退避梯漂移类 bug，届时换 tick 形态（活性和时延分离）。
- 报二"每 Task Step 1 前跑 tsc 门"不新增：pnpm verify 已含 typecheck 且每 Task 尾必跑——代码块不可编译已被现有机制挡住（v3 的 Y17 类错误在实现 Step 即红）。

**第三轮报告自我勘误核验坐实**（收录备查）：报一承认上轮"collab-core 已有 redis"与"MINIO 占位即可"两结论错（X3 修法正确）；报三收回 N2"unhandled rejection"推演（esm:1586 catch 确认）但驻留/停摆修法理由仍立（X4 维持）。

---

| 文件 | 动作 | 职责 |
|------|------|------|
| `apps/api/src/modules/collab/collab-spool.service.ts` | Create | spool 单源台账：帧编解码（len+CRC32）/分段滚动/append+fsync/peek/confirm/段 unlink/quarantine sidecar/容量与写失败熔断+探针/启动回灌/键集缓存/depth | 
| `apps/api/src/modules/collab/collab-spool.service.spec.ts` | Create | spool 单测（真 tmp 目录文件系统，beforeEach 独立目录 V17①） |
| `apps/api/src/modules/collab/collab-spool.int.spec.ts` | Create | FK 真库 int 背书（V6——进 CI int 显式清单 X16） |
| `apps/api/src/modules/collab/pg-error.util.ts` | Create | isFkGone/isRetryableAppendError 单源（X15——gateway/spool 双消费防循环依赖） |
| `packages/shared/src/constants/collab-auth-reason.ts` | Modify | 增 DRAINING 档（X9——Y21：'draining' 追加枚举**末尾**（值即线上协议串只增不改）+collab-auth-reason.test.ts:6 的 toEqual 精确数组同批追加+describe"五档"→六档+补 `isTerminalReason(DRAINING)===false` 断言（瞬态档——误入终态白名单=关停期客户端停止重连）） |
| `apps/api/src/modules/collab/collab.gateway.ts` | Modify | BOI 重写 storeDocument/删 unflushed 族/退避无上限/storeInFlight/afterStoreDocument/beforeUnloadDocument/drain 六步/project.gone 终态/mergeUpdates 出 WS/computePending/契约头注释 |
| `apps/api/src/modules/collab/store.metrics.ts` | Modify | 新增 spool 族指标+yjs_store_in_flight_docs+tail_anomaly+hook_calls+pending gauges（collect+**unregisterPendingCollector 导出** Y5）+**删 yjsUnflushedProjects**+改名 yjs_updates_discarded_deleted_total{source}+`yjsUnloadHandoff/CleanupFailureTotal` 两指标定义落本文件（Y18——v3 只用未定义）；pending gauge 名 `yjs_pending_projects`（Y5） |
| `apps/api/src/modules/collab/collab.module.ts` | Modify | CollabSpoolService 注册 |
| `apps/api/src/modules/collab/collab.gateway.spec.ts` | Modify | BOI 三代红相+断言改造（10 处 unflushed 行）+mergeUpdates spy+peek/consume 并发用例适配 |
| `apps/api/src/modules/collab/collab.gateway.persist-status.spec.ts` | Modify | 断言改造（2 处 unflushed 行）+退避无上限用例 |
| `apps/api/src/modules/collab/collab.gateway.shutdown.spec.ts` | Modify | drain 六步断言（结构化日志/pending 字段/预算） |
| `apps/api/src/modules/collab/collab.gateway.project-gone.spec.ts` | Create | project.gone 清账+FK 兜底用例 |
| `apps/api/src/test-utils/failing-repo.ts` | Modify | post-N 调用回工厂默认形状（修复 Y0a-1 Minor 1） |
| `apps/api/src/test-utils/dual-client-server.ts` | Modify | gateway 构造点补 spool 参数（tmp 目录注入） |
| `apps/api/src/test-utils/spool-dir.ts` | Create | 每用例独立 tmp spool 目录助手（mkdtemp+cleanup） |
| `apps/api/scripts/collab-spool-quarantine.ts` | Create | 逃生阀（外置导出+人工判定后删段） |
| `apps/api/scripts/collab-spool-import.ts` | Create | 回滚 runbook 脚本（读帧→append→confirm——回滚前 drain） |
| `apps/api/scripts/collab-drill-server.ts` | Create | 演练子进程入口（Nest HTTP app+enableShutdownHooks+随机端口+DRILL_SPOOL_FAIL 服务态注入 Y14） |
| `apps/api/scripts/collab-kill9-drill.ts` | Create | G-1（正常/故障双模式）+G-2a（SIGTERM）演练驱动 |
| `apps/api/src/modules/collab/collab-contract-guards.spec.ts` | Modify | 结构锚扫描（update 回调零 mergeUpdates/compact await 后顾/递归收集——V24 收缩：契约 3/11/14 不设扫描） |
| `.github/workflows/ci.yml` | Modify | collab-core 补 redis service+演练步骤 |

**不改**：租约/ready/drain 端点（Y0a-3——受理门本批已落 `isShuttingDown()/isWritableOrDegraded()`，Y0a-3 ready 消费同两名，**无 isAcceptingWork 方法**（Y24 命名统一））；extension-redis/CollabRedisSync（Y0a-3 删）；ecosystem/kill_timeout/连接池（Y0a-4）；env zod 收口（Y0a-4——本批 `COLLAB_SPOOL_DIR` 直读 process.env）；readSnapshotOnly（Y0a-3）。

---

### Task 1: spool service 骨架——帧编解码+append fsync+peek/confirm+段滚动+启动扫描

**Files:**
- Create: `apps/api/src/modules/collab/collab-spool.service.ts`
- Create: `apps/api/src/modules/collab/collab-spool.service.spec.ts`
- Create: `apps/api/src/test-utils/spool-dir.ts`
- Modify: `apps/api/src/modules/collab/collab.module.ts`
- Modify: `.gitignore`

- [x] **Step 1: spool-dir 助手（每用例独立 tmp 目录）+写失败测试**

```typescript
// apps/api/src/test-utils/spool-dir.ts
// Y0a-2：spool 单测目录助手——mkdtemp 独立目录+afterAll 清理（禁共享目录：用例间段状态互染）。
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function makeSpoolDir(prefix = 'y0a2-spool-'): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
```

```typescript
// apps/api/src/modules/collab/collab-spool.service.spec.ts
// Y0a-2：spool 单测——真文件系统（tmp 目录），禁 mock fs（文件系统语义正是被测对象）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { CollabSpoolService } from './collab-spool.service';
import { makeSpoolDir } from '../../test-utils/spool-dir';

let dir: string; let cleanup: () => Promise<void>;
beforeEach(async () => { ({ dir, cleanup } = await makeSpoolDir()); });   // V17①：每用例独立目录（v1 全文件共享=段状态互染）
afterEach(async () => { await cleanup(); });

function svc(): CollabSpoolService { return new CollabSpoolService(dir); }   // 每用例新实例=崩溃模拟（内存 index/confirmed 丢失）

describe('spool 骨架（帧编解码+append fsync+peek/confirm+段滚动）', () => {
  it('append→peek round-trip：payload 逐字节相等；帧文件真实落盘（fsync 后 size>0）', async () => {
    const s = svc();
    const p1 = new Uint8Array([1, 2, 3, 4, 5]);
    const p2 = new Uint8Array([9, 9]);
    const ids = await s.append('p1', p1);
    await s.append('p1', p2);
    expect(ids).toHaveLength(1);
    const frames = await s.peek('p1');
    expect(frames.map((f) => Array.from(f.payload))).toEqual([Array.from(p1), Array.from(p2)]);
    const files = await readdir(dir);
    expect(files.filter((f) => f.endsWith('.spool'))).toHaveLength(1);   // 同段追加
    expect((await readFile(join(dir, files[0]))).byteLength).toBe(8 + 5 + 8 + 2);
    expect(s.hasFrames('p1')).toBe(true);
  });

  it('confirm 段回收触发点①：全部帧 confirmed→段文件 unlink+键集删除；部分 confirm 保留', async () => {
    const s = svc();
    const a = await s.append('p1', new Uint8Array([1]));
    const b = await s.append('p1', new Uint8Array([2]));
    await s.confirm('p1', [a[0]]);                       // 部分：段保留
    expect((await readdir(dir)).some((f) => f.endsWith('.spool'))).toBe(true);
    await s.confirm('p1', b);                             // 全部：整段 unlink
    expect((await readdir(dir)).filter((f) => f.endsWith('.spool'))).toHaveLength(0);
    expect(s.hasFrames('p1')).toBe(false);
    expect(await s.peek('p1')).toEqual([]);               // 键已删
  });

  it('段滚动：累计写超 4MB 滚动新段（文件名 segSeq 递增）；跨段 peek 全量返回', async () => {
    const s = svc();
    const big = new Uint8Array(1_500_000); big.fill(7);
    await s.append('p1', big); await s.append('p1', big); await s.append('p1', big);   // 4.5MB → 3 段
    const files = (await readdir(dir)).filter((f) => f.endsWith('.spool')).sort();
    expect(files).toHaveLength(3);
    expect(files[0]).toBe('p1.0.spool'); expect(files[2]).toBe('p1.2.spool');
    const frames = await s.peek('p1');
    expect(frames).toHaveLength(3);
    expect(frames[0].frameId.split(':')[0]).toBe('0');
    expect(frames[2].frameId.split(':')[0]).toBe('2');
  });

  it('崩溃语义（confirmed 集丢失）：新实例 scan 同目录→peek 返回全部帧（幂等降级为第二道防线）', async () => {
    const s1 = svc();
    const a = await s1.append('p1', new Uint8Array([1]));
    await s1.confirm('p1', a);                            // confirmed 在内存——"崩溃"即丢
    const s2 = svc();                                     // 新实例=重启
    await s2.scan();
    expect(s2.hasFrames('p1')).toBe(true);
    expect(await s2.peek('p1')).toHaveLength(1);          // 全部帧重新可见（重复回灌由 CRDT 幂等吸收）
  });

  it('尾部截断：CRC 不符/长度越界→停在该帧+yjs_spool_truncated_total+1，禁静默续读', async () => {
    const count = async () => (await import('prom-client')).register.getSingleMetric('yjs_spool_truncated_total')!.get().values[0]?.value ?? 0;   // V17⑥：metric.get() 公开 API
    const before = await count();
    const s = svc();
    const good = new Uint8Array([1, 2, 3]);
    await s.append('p1', good);
    // 手工追加坏帧：长度声明 100 但实际 payload 2 字节（截断形态）
    const file = join(dir, 'p1.0.spool');
    const bad = Buffer.alloc(8 + 2);
    bad.writeUInt32LE(100, 0); bad.writeUInt32LE(crc32(Buffer.from([9, 9])), 4); bad[8] = 9; bad[9] = 9;
    await writeFile(file, Buffer.concat([await readFile(file), bad]), { flag: 'a' });
    const s2 = svc(); await s2.scan();
    const frames = await s2.peek('p1');
    expect(frames).toHaveLength(1);                       // 只有 good 帧；坏帧停读
    const after = await count();
    expect(after - before).toBe(1);
  });
});
```

- [x] **Step 2: 跑红**

```bash
pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab-spool.service.spec.ts
```
Expected: FAIL（`Cannot find module './collab-spool.service'`）。留档输出。

- [x] **Step 3: 实现 spool 骨架（帧编解码/append+fsync/peek/confirm/scan/depth；熔断与回灌归 Task 2）**

```typescript
// apps/api/src/modules/collab/collab-spool.service.ts
// Y0a-2（spec v2.4 §2.2）：spool=store 故障期唯一权威待落库台账（内存 unflushed Map 本批退役）。
// 帧格式 [4B len LE][4B crc32 LE][payload]；段文件 `<projectId>.<segSeq>.spool` 段满 4MB 滚动；
// putStash 语义=append 帧+同步 fsync（唯一持久动作）；confirm=按 frameId 内存记账，段内全部帧
// confirmed（或 quarantined）→整段 unlink（原子，消灭"重写文件去帧"中途崩溃=台账全丢窗口）。
// 持久化模型头注释见 collab.gateway.ts 顶部（§2.1 契约声明）。
// 崩溃语义：confirmed 集丢失→重启 scan 后全部帧重新可见→重复回灌由 CRDT 幂等吸收（幂等降级为
// 第二道防线，只承担重复行性能代价，不承担正确性）。
import { Injectable, Logger } from '@nestjs/common';
import { open, readFile, readdir, unlink, mkdir, stat } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { join, resolve } from 'node:path';

export interface SpoolFrame { frameId: string; payload: Uint8Array }

const SEGMENT_MAX_BYTES = 4 * 1024 * 1024;
const FRAME_HEADER_BYTES = 8;

/** Y0a-2 终形态（V2/V3，Y17）：frameCount=**可解析**帧数（scan 只数好帧；运行期追加恒好帧）——
 *  帧 idx 分配器与段回收判据共用；goodBytes=已证干净字节上界（追加守卫：stat().size 不符即封段滚动）；
 *  quarantinedRange=坏尾字节区间事实（Task 2 quarantineTruncatedFrames 写入——null=无坏尾）。 */
interface SegmentMeta {
  frameCount: number;
  goodBytes: number;
  bytes: number;
  confirmed: Set<number>;                        // 帧序号（内存态——崩溃丢失=幂等降级）
  sealed: boolean;                               // V2：封段后永不再追加（只置位不删字节——禁 ftruncate，R6）
  quarantinedRange: { fromOffset: number } | null;   // V3：坏帧起始偏移→EOF
  quarantinedBytes: number;
}

const segFileName = (projectId: string, segSeq: number) => `${projectId}.${segSeq}.spool`;
const parseSegFileName = (f: string): { projectId: string; segSeq: number } | null => {
  const m = /^(.+)\.(\d+)\.spool$/.exec(f);
  return m ? { projectId: m[1], segSeq: Number(m[2]) } : null;
};

@Injectable()
export class CollabSpoolService {
  private readonly logger = new Logger(CollabSpoolService.name);
  private readonly dir: string;
  /** projectId → segSeq → 段元数据（scan 重建与运行期同构维护；空 Map=键存在但无段） */
  private readonly index = new Map<string, Map<number, SegmentMeta>>();

  constructor(dir?: string) {
    this.dir = resolve(dir ?? process.env.COLLAB_SPOOL_DIR ?? join(process.cwd(), '.data', 'collab-spool'));
  }

  /** 键集（同步内存——gateway 键集缓存即此，非权威数据副本）。X8'：恒排除 `__probe__`。 */
  hasFrames(projectId: string): boolean {
    if (projectId === '__probe__') return false;
    return (this.index.get(projectId)?.size ?? 0) > 0;
  }
  keys(): string[] { return [...this.index.keys()].filter((k) => k !== '__probe__' && (this.index.get(k)?.size ?? 0) > 0); }

  /** Y24：depth 排除 `__probe__` 键（容量口径不含探针字节）；quarantinedBytes 含坏帧头（V3）。 */
  depth(): { files: number; bytes: number; quarantinedBytes: number } {
    let files = 0, bytes = 0, quarantinedBytes = 0;
    for (const [pid, segs] of this.index) {
      if (pid === '__probe__') continue;
      for (const m of segs.values()) { files++; bytes += m.bytes; quarantinedBytes += m.quarantinedBytes; }
    }
    return { files, bytes, quarantinedBytes };
  }

  /** putStash：append 帧+fsync——入账先于一切返回（失败 throw 交调用方走 BOI 队列路径）。
   *  T1 阶段=appendRaw 薄别名；T2 在此包装两态记账（容量判定+写失败 streak）。 */
  async append(projectId: string, payload: Uint8Array): Promise<string[]> {
    return this.appendRaw(projectId, payload);
  }

  /** 帧写入唯一实现（V2 封段守卫+X14 耐久性/权限——WAL 标准做法）。 */
  private async appendRaw(projectId: string, payload: Uint8Array): Promise<string[]> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    let segSeq = -1; let meta: SegmentMeta | undefined;
    const segs = this.index.get(projectId);
    if (segs && segs.size > 0) {
      segSeq = Math.max(...segs.keys());
      meta = segs.get(segSeq);
      // V2 追加前守卫：段已封禁（sealed）或写入失败遗留半写尾（goodBytes≠bytes）或段满 → 滚动新段
      if (meta && (meta.sealed || meta.goodBytes !== meta.bytes
        || meta.bytes + FRAME_HEADER_BYTES + payload.byteLength > SEGMENT_MAX_BYTES)) {
        segSeq += 1; meta = undefined;
      }
    }
    if (segSeq < 0) segSeq = 0;
    const isNewSegment = !meta;
    if (!meta) {
      meta = { frameCount: 0, goodBytes: 0, bytes: 0, confirmed: new Set(), sealed: false, quarantinedRange: null, quarantinedBytes: 0 };
      if (!segs) this.index.set(projectId, new Map());
      this.index.get(projectId)!.set(segSeq, meta);
    }
    const frameIdx = meta.frameCount;
    const header = Buffer.alloc(FRAME_HEADER_BYTES);
    header.writeUInt32LE(payload.byteLength, 0);
    header.writeUInt32LE(crc32(Buffer.from(payload)) >>> 0, 4);
    const path = join(this.dir, segFileName(projectId, segSeq));
    try {
      const fh = await open(path, 'a', 0o600);   // X14：台账保密性不低于 PG 侧默认
      try {
        await fh.chmod(0o600).catch(() => {});   // 已存在文件收敛权限（open 的 mode 只对新建生效）
        await fh.writeFile(Buffer.concat([header, Buffer.from(payload)]));
        await fh.sync();   // fsync 完成才返回（契约 4：入账先于一切）
      } finally {
        await fh.close();
      }
    } catch (e) {
      meta.sealed = true;   // V2：writeFile/sync/open 抛错即封段——消灭"半写后继续追加同段→后续帧永不可读"黑洞
      throw e;
    }
    meta.frameCount = frameIdx + 1;
    meta.bytes += FRAME_HEADER_BYTES + payload.byteLength;
    meta.goodBytes = meta.bytes;   // 追加成功则段尾干净
    // X14：**新建段文件后 fsync 父目录**（文件数据落盘≠目录项落盘——掉电后新段可能整个不存在）。
    // 顺序不可倒：写帧+fsync 文件 → fsync 父目录。Windows 目录 fsync ENOTSUP 则 catch 登记。
    if (isNewSegment) {
      const dh = await open(this.dir, 'r').catch(() => null);
      if (dh) { try { await dh.sync(); } catch { /* ENOTSUP（Windows）——登记 */ } finally { await dh.close(); } }
    }
    return [`${segSeq}:${frameIdx}`];
  }

  /** 读全部未 confirm 好帧（以 index 的 frameCount=可解析帧数为界——坏尾的识别与隔离归 scan/
   *  quarantineTruncatedFrames；循环内解析失败=index 与文件不一致的 tripwire：计数+停读）。 */
  async peek(projectId: string): Promise<SpoolFrame[]> {
    const segs = this.index.get(projectId);
    if (!segs) return [];
    const frames: SpoolFrame[] = [];
    for (const segSeq of [...segs.keys()].sort((a, b) => a - b)) {
      const meta = segs.get(segSeq)!;
      let buf: Buffer;
      try { buf = await readFile(join(this.dir, segFileName(projectId, segSeq))); }
      catch { continue; }   // 段文件消失（已 unlink）——跳过
      let off = 0; let idx = 0;
      while (idx < meta.frameCount) {
        if (off + FRAME_HEADER_BYTES > buf.byteLength) { this.reportTruncation(projectId, segSeq); break; }
        const len = buf.readUInt32LE(off);
        if (off + FRAME_HEADER_BYTES + len > buf.byteLength) { this.reportTruncation(projectId, segSeq); break; }
        const payload = buf.subarray(off + FRAME_HEADER_BYTES, off + FRAME_HEADER_BYTES + len);
        if ((crc32(payload) >>> 0) !== buf.readUInt32LE(off + 4)) { this.reportTruncation(projectId, segSeq); break; }
        if (!meta.confirmed.has(idx)) frames.push({ frameId: `${segSeq}:${idx}`, payload: new Uint8Array(payload) });
        off += FRAME_HEADER_BYTES + len; idx += 1;
      }
    }
    return frames;
  }

  /** confirm=append 成功后的记账性动作（契约 12：删帧恒在 append 成功之后——本方法不触 DB）。
   *  段回收判据（V3）：全部**可解析**帧（[0,frameCount)）confirmed ∧ 坏尾已处置
   *  （quarantinedRange 已记 ∨ 段尾本就干净 goodBytes===bytes）。 */
  async confirm(projectId: string, frameIds: string[]): Promise<void> {
    const segs = this.index.get(projectId);
    if (!segs) return;
    for (const id of frameIds) {
      const [seg, idx] = id.split(':');
      segs.get(Number(seg))?.confirmed.add(Number(idx));
    }
    for (const segSeq of [...segs.keys()]) {
      const meta = segs.get(segSeq)!;
      const allGoodConfirmed = meta.frameCount > 0 &&
        [...Array(meta.frameCount).keys()].every((i) => meta.confirmed.has(i));
      const tailSettled = meta.quarantinedRange != null || meta.goodBytes === meta.bytes;
      if (!allGoodConfirmed || !tailSettled) continue;
      const file = join(this.dir, segFileName(projectId, segSeq));
      try { await unlink(file); } catch { /* 已消失 */ }
      try { await unlink(`${file}.quarantine`); } catch { /* 无 sidecar */ }
      segs.delete(segSeq);
    }
    if (segs.size === 0) this.index.delete(projectId);
  }

  /** 启动扫描：重建 index（帧数/字节）——确认集丢失即幂等降级。返回坏帧段清单供启动隔离处置。
   *  Y17：truncated 段直接置 sealed（V2——scan 时已含坏尾，永不再追加）+goodBytes=首坏帧偏移；
   *  X8'：`__probe__*` 段崩溃残留直接 unlink（探针帧不进回灌/键集）。 */
  async scan(): Promise<{ truncatedSegments: string[] }> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const truncatedSegments: string[] = [];
    for (const f of await readdir(this.dir)) {
      const parsed = parseSegFileName(f);
      if (!parsed) continue;
      if (parsed.projectId === '__probe__') { await unlink(join(this.dir, f)).catch(() => {}); continue; }
      const buf = await readFile(join(this.dir, f));
      let off = 0, frameCount = 0; let truncated = false;
      while (off + FRAME_HEADER_BYTES <= buf.byteLength) {
        const len = buf.readUInt32LE(off);
        if (off + FRAME_HEADER_BYTES + len > buf.byteLength) { truncated = true; break; }
        const payload = buf.subarray(off + FRAME_HEADER_BYTES, off + FRAME_HEADER_BYTES + len);
        if ((crc32(payload) >>> 0) !== buf.readUInt32LE(off + 4)) { truncated = true; break; }
        off += FRAME_HEADER_BYTES + len; frameCount += 1;
      }
      if (truncated) truncatedSegments.push(f);
      const segs = this.index.get(parsed.projectId) ?? new Map<number, SegmentMeta>();
      segs.set(parsed.segSeq, {
        frameCount, goodBytes: off, bytes: buf.byteLength,
        confirmed: new Set(), sealed: truncated, quarantinedRange: null, quarantinedBytes: 0,
      });
      this.index.set(parsed.projectId, segs);
    }
    return { truncatedSegments };
  }

  private reportTruncation(projectId: string, segSeq: number) {
    yjsSpoolTruncatedTotal.inc();
    this.logger.error(`spool truncated frame at ${projectId}.${segSeq}——停读该段（坏帧从未持久化或落盘不完整），计数+人工介入`);
  }
}
```

（`reportTruncation` 体引用 `yjsSpoolTruncatedTotal`——import 自 `./store.metrics`；Task 2 扩 quarantine/熔断/回灌时同文件追加。）

- [x] **Step 4: 指标+module 注册+跑绿+commit（V20：.gitignore 已有 `.data/`——该子步为 no-op 删除）**

`store.metrics.ts` 追加：

```typescript
/** Y0a-2：spool 族指标（spec §5.2——事后取证口径：PROMETHEUS_TOKEN 手 curl；告警路由归 Y0b/E54）
 *  V14：容量口径含隔离字节（隔离段同占盘——"排除"=磁盘被隔离字节填满而熔断永不触发）。 */
export const yjsSpoolDepthFiles = new Gauge({
  name: 'yjs_spool_depth_files', help: 'spool 段文件数（键集缓存 size 口径）', registers: [register],
});
export const yjsSpoolDepthBytes = new Gauge({
  name: 'yjs_spool_depth_bytes', help: 'spool 段文件字节总和（**含**隔离字节——容量核算同口径，V14）', registers: [register],
});
export const yjsSpoolTruncatedTotal = new Counter({
  name: 'yjs_spool_truncated_total', help: '尾部截断/坏帧停读次数（禁静默续读；连续命中=磁盘故障信号）', registers: [register],
});
export const yjsSpoolWriteFailuresTotal = new Counter({
  name: 'yjs_spool_write_failures_total', help: 'spool append/fsync 失败次数（ioBroken 熔断素材——批次留队列，BOI）', registers: [register],
});
export const yjsSpoolCapacityTotal = new Counter({
  name: 'yjs_spool_capacity_total', help: 'spool 容量超限熔断次数（overCapacity 态——与 ioBroken 分离，V14；不丢最旧）', registers: [register],
});
export const yjsSpoolQuarantinedTotal = new Counter({
  name: 'yjs_spool_quarantined_total', help: '隔离帧计数（已接受但无法落库的编辑——显式接受的有界丢失，需人工判定；启动 scan 不重复递增，V3）', registers: [register],
});
```

`collab.module.ts` providers `:26` 一带（CanvasDocUpdateRepository 之后）加 `CollabSpoolService`（import 补）。

**V15 目录 fail-fast**（Step 3 实现段追加）：

```typescript
  /** V15：构造后启动校验——生产环境相对路径拒绝启动（CWD 漂移=静默换账本）；目录不可用拒绝启动
   *  （没有台账就不该收编辑——fail-closed；Y0a-3 ready 给 reason 只是锦上添花）。返回解析后的绝对路径供日志。 */
  validateDir(): string {
    const abs = resolve(this.dir);
    if (process.env.NODE_ENV === 'production' && !path.isAbsolute(this.dir)) {
      throw new Error(`COLLAB_SPOOL_DIR 必须为绝对路径（当前：${this.dir}——CWD 漂移会静默指向另一个空账本）`);
    }
    return abs;
  }
```

（gateway `onModuleInit` 首行 `this.logger.log(JSON.stringify({ event: 'spool_dir', dir: this.spool.validateDir() }))`——启动可见；scan 抛错（目录不可用）由 onModuleInit 不捕获=拒绝启动。）

```bash
pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab-spool.service.spec.ts
```
Expected: 6 用例全 PASS（骨架 5+V2 封段 1；V17① 的 beforeEach/afterEach 独立目录已直接落 Step 1 代码块——v1 的"全文件共享 dir+仅首用例赋值"互染 bug 不复存在。）

**V2/V3 骨架修订**（Step 3 实现段已随上方代码块终形态化——SegmentMeta 全字段+appendRaw 封段守卫；本 Step 补 V2 用例）：

```typescript
  it('V2 段封禁：段尾注入坏字节 → append 守卫滚动新段 → 重启 scan 后坏尾前后帧全部可 peek（v1 黑洞形态必红）', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));                       // 段 0 帧 0（干净：goodBytes===bytes===9）
    const file = join(dir, 'p1.0.spool');
    const junk = Buffer.alloc(2, 0x99);
    await writeFile(file, Buffer.concat([await readFile(file), junk]), { flag: 'a' });   // 外部坏尾：bytes=11 > goodBytes=9
    await s.append('p1', new Uint8Array([3]));                       // 追加前守卫 goodBytes!==bytes → 滚动段 1
    const files = (await readdir(dir)).filter((f) => f.endsWith('.spool')).sort();
    expect(files).toEqual(['p1.0.spool', 'p1.1.spool']);             // 段 0 封存+段 1 承接新帧
    const s2 = svc(); await s2.scan();
    const frames = await s2.peek('p1');
    expect(frames).toHaveLength(2);                                  // 段 0 帧 0 + 段 1 帧 0 全可读——v1 黑洞（继续追加坏尾段）下段 1 帧永不可读=红
  });
```

```bash
git add apps/api/src/modules/collab/collab-spool.service.ts apps/api/src/modules/collab/collab-spool.service.spec.ts apps/api/src/modules/collab/store.metrics.ts apps/api/src/modules/collab/collab.module.ts apps/api/src/test-utils/spool-dir.ts && git commit -m "feat(collab): Y0a-2 spool service 骨架——len+CRC32 帧格式+fsync append+帧 id confirm+段滚动+段封禁(V2)+字节区间隔离(V3)+目录 fail-fast(V15)+启动扫描"
```

> **Task 1 执行勘误（2026-10-07 实现裁定，commit `46be5b3b`；两阶段审查均过）**——plan 代码块 9 处修正已落实现，后续 Task 消费者以此为准：
> ①段滚动用例 payload 1.5MB→2.5MB（原值在 4MB 上限下只产 2 段，3 段断言必红）；②崩溃语义用例改两帧 confirm 一帧（单帧全量 confirm 触发段 unlink→重启 scan 磁盘空）；③**prom-client v15 `metric.get()` 返回 Promise**——一切指标读取用例用 `(await m.get())` 形态（Task 6 discardedCount helper 同改）；④坏帧注入 `writeFile(concat([readFile(file), bad]), { flag: 'a' })` 会把旧内容双写（**Task 2 用例 :663/:682 同款形态须删 flag 改整写**）；⑤constructor 加 `@Optional()`（Nest paramtypes=[String] 不可解析=boot 崩；§0.6 C6 拒绝裁定的语境是 **gateway 构造点**（Task 3），与 spool 自身可选构造无冲突）；⑥validateDir 检查对象改 rawDir（检查 resolve 后路径恒绝对=死检查）；⑦追加前守卫补 stat.size≠内存记账 探测（V2 用例的外部坏尾注入依赖它）；⑧scan 阶段 truncated 计数恰一次（peek tripwire 以 frameCount 为界自然不重复）；⑨追加 V15 fail-fast 用例。
> 质量审查 8 项 Minor（无 Critical/Important）：幻影段元数据×2（open 失败 meta 已插入；0 字节段 scan 永久残留）/＜8B 残尾静默漏报/目录 fsync close 异常翻转 append 结果/confirm O(frameCount) 重建/注释与实现不符×2（validateDir JSDoc 混同机制、ENOTSUP"登记"无日志）/appendRaw 单飞契约未文档化/测试名超 claim——**全部归 Task 2 同区域顺手收口**（见 Task 2 派发提示）。

---

### Task 2: spool 完整语义——quarantine sidecar+容量/写失败熔断+探针解熔断+启动回灌硬上限

**Files:**
- Modify: `apps/api/src/modules/collab/collab-spool.service.ts`
- Test: `apps/api/src/modules/collab/collab-spool.service.spec.ts`（追加）

- [x] **Step 1: 写失败测试（quarantine/熔断/探针/回灌四组）**

spec 文件追加：

```typescript
// 文件头 import 追加：vi（vitest）与 createMockRepo（test-utils/mock-repo）；fs 族已在 Task 1 引入
import { createMockRepo } from '../../test-utils/mock-repo';

describe('spool quarantine sidecar（v2.4：标记不搬字节——追加-only 段内移帧物理不可行）', () => {
  it('坏帧段：非隔离帧全 confirm→段可回收（unlink 条件≠全部帧 confirmed）+sidecar 保留记录', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));                          // 好帧 0:0
    // 追加坏帧（CRC 错）——真实故障形态：落盘不完整
    const file = join(dir, 'p1.0.spool');
    const bad = Buffer.alloc(8 + 2);
    bad.writeUInt32LE(2, 0); bad.writeUInt32LE(0xdeadbeef, 4); bad[8] = 1; bad[9] = 2;
    await writeFile(file, Buffer.concat([await readFile(file), bad]), { flag: 'a' });
    const s2 = svc();
    const report = await s2.scan();
    expect(report.truncatedSegments).toEqual(['p1.0.spool']);
    const quarantined = await s2.quarantineTruncatedFrames('p1');       // 坏帧段处置：非隔离帧重新可见
    expect(quarantined).toBeGreaterThan(0);                              // 隔离帧数（0:1）
    expect(await s2.peek('p1')).toHaveLength(1);                         // 好帧 0:0 仍可回灌
    const sidecar = join(dir, 'p1.0.spool.quarantine');
    expect((await readFile(sidecar, 'utf8')).includes('0:1')).toBe(true);
    await s2.confirm('p1', ['0:0']);                                      // 唯一非隔离帧 confirm→段回收
    expect((await readdir(dir)).filter((f) => f.endsWith('.spool'))).toHaveLength(0);
    expect((await readdir(dir)).filter((f) => f.endsWith('.quarantine'))).toHaveLength(0);   // sidecar 随段清理
  });

  it('V3/E5 容量核算含隔离字节+隔离区间=字节偏移口径：quarantinedBytes=坏帧起始偏移→EOF（含坏帧头）', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array(1024));                       // 好帧=8+1024=1032
    const bad = Buffer.alloc(8 + 512);
    bad.writeUInt32LE(512, 0); bad.writeUInt32LE(0, 4);   // CRC 恒不匹配
    await writeFile(join(dir, 'p1.0.spool'), Buffer.concat([await readFile(join(dir, 'p1.0.spool')), bad]), { flag: 'a' });
    const s2 = svc(); await s2.scan();
    await s2.quarantineTruncatedFrames('p1');
    const d = s2.depth();
    expect(d.quarantinedBytes).toBe(520);                             // 1552-1032=520（v1 的 -8 off-by-8 必红）
    expect(d.bytes).toBe(1552);                                       // V14：容量核算=总字节（含隔离）
  });
});

describe('spool 熔断与探针解熔断（V14 两态：ioBroken 探针可解 / overCapacity 仅 depth 回落可解）', () => {
  it('目录不可写（路径被文件占位）→append throw+isWritable()=false+yjs_spool_write_failures_total 递增', async () => {
    const { dir: d2, cleanup: c2 } = await makeSpoolDir('y0a2-spool-fail-');
    try {
      const file = join(d2, 'occupied');      // spool 目录指向一个文件 → mkdir 失败 → 写必败
      await writeFile(file, 'x');
      const s = new CollabSpoolService(file);
      await expect(s.append('p1', new Uint8Array([1]))).rejects.toBeInstanceOf(Error);
      expect(s.isWritable()).toBe(false);
      await expect(s.append('p1', new Uint8Array([1]))).rejects.toBeInstanceOf(Error);
      expect(s.failureStreak()).toBeGreaterThanOrEqual(2);   // 连败计数（ioBroken 熔断判定素材）
    } finally { await c2(); }
  });

  it('探针帧写删成功→isWritable 恢复 true；探针成功不误关 overCapacity（V14：probe 只解 ioBroken）', async () => {
    const s = svc();
    await s.append('p1', new Uint8Array([1]));
    expect(s.isWritable()).toBe(true);
    await s.probe();                                            // 探针=写 1 字节探针帧+confirm 段回收+fsync
    expect(s.isWritable()).toBe(true);
    (s as any).overCapacityFlag = true;                         // 白盒置容量态
    expect(s.isWritable()).toBe(false);                         // overCapacity 仍拒
    await s.probe();
    expect(s.isWritable()).toBe(false);                         // IO 探针成功≠容量恢复（v1 单态必红）
    (s as any).overCapacityFlag = false;                        // depth 回落后恢复（容量态由 append 前置判定驱动）
  });
});

describe('spool 启动回灌（V16：总预算+固定短退避+同项目帧合并；FK=真库 int 背书 V6）', () => {
  it('回灌：同项目连续帧合并为一次 append+confirm→段 unlink', async () => {
    const s1 = svc();
    await s1.append('p1', new Uint8Array([1, 1]));
    await s1.append('p1', new Uint8Array([2, 2]));
    const repo = createMockRepo();
    const s2 = svc(); await s2.scan();
    const report = await s2.replayAll(repo as any);
    expect(report.replayed).toBe(2); expect(report.failed).toBe(0);
    expect(repo.append).toHaveBeenCalledTimes(1);                // V16：合并单次（v1 逐帧=2 次必红）
    expect((await readdir(dir)).filter((f) => f.endsWith('.spool'))).toHaveLength(0);   // 段 unlink 触发点②
  });

  it('FK 失败（**真库形状** P2010+meta 23503——mock 形状 V6 标注无效，此用例仅测分支逻辑）→帧按终态丢弃+段收割', async () => {
    const s1 = svc();
    await s1.append('gone', new Uint8Array([1]));
    const repo = createMockRepo({ append: vi.fn(async () => { throw Object.assign(new Error('Raw query failed'), { code: 'P2010', meta: { code: '23503' } }); }) });
    const s2 = svc(); await s2.scan();
    const report = await s2.replayAll(repo as any);
    expect(report.discarded).toBe(1);
    expect((await readdir(dir)).filter((f) => f.endsWith('.spool'))).toHaveLength(0);
  });

  it('PG 未起（P1001）→总预算耗尽返回 failed（不阻塞 listen；固定 200ms 重试非指数）', async () => {
    const s1 = svc();
    await s1.append('p1', new Uint8Array([1]));
    const repo = createMockRepo({ append: vi.fn(async () => { throw Object.assign(new Error("Can't reach database server"), { code: 'P1001' }); }) });
    const s2 = svc(); await s2.scan();
    const t0 = Date.now();
    const report = await s2.replayAll(repo as any, { budgetMs: 500, retryDelayMs: 50 });   // 测试缝收紧
    expect(report.failed).toBe(1);
    expect(repo.append.mock.calls.length).toBeGreaterThanOrEqual(2);   // 预算内重试
    expect(Date.now() - t0).toBeLessThan(1_500);                        // V16：总预算有界（v1 最坏 15s/帧）
    expect((await readdir(dir)).filter((f) => f.endsWith('.spool'))).toHaveLength(1);   // 帧保留（未丢弃）
  });
});

// V6 真库 int 背书（新文件 collab-spool.int.spec.ts）：ensureProjectFixture→spool.append 真帧→
// prisma.canvasProject.delete（真删）→replayAll(repo 真实例)→断言 {discarded:1}+段回收——
// mock-only FK 用例一律视为无效证据（raw 路径形状唯真库可证）。
```

- [x] **Step 2: 跑红**

```bash
pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab-spool.service.spec.ts
```
Expected: 新增用例 FAIL（`quarantineTruncatedFrames`/`isWritable`/`probe`/`replayAll` is not a function）。留档。

- [x] **Step 3: 实现完整语义（追加到 collab-spool.service.ts）**

```typescript
  // —— Task 2 追加（v2：V14 两态熔断/V3 字节区间/V16 预算化回灌）——
  private static readonly WRITE_FAILURE_CIRCUIT = 5;          // 连续 5 次写失败→ioBroken
  private static readonly PROBE_INTERVAL_MS = 30_000;
  private static readonly SPOOL_CAPACITY_BYTES = 256 * 1024 * 1024;
  private static readonly REPLAY_BUDGET_MS = 5_000;           // V16：总墙钟预算（耗尽即返回，帧保留）
  private static readonly REPLAY_RETRY_MS = 200;              // V16：固定短退避（启动期不指数）
  private writeFailureStreak = 0;
  private ioBroken = false;                                   // V14：IO 态（探针可解）
  private overCapacityFlag = false;                           // V14：容量态（仅 depth 回落可解——探针无权关）
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  /** Y10：恢复回调 seam——gateway 注入（onModuleInit `this.spool.onRecovered = () => this.rearmQueues()`）。
   *  依赖方向 gateway→spool，spool 无反向通道是 v3 X6 链条断点（probe 成功无人唤醒 gateway）。幂等
   *  调用安全（schedulePersistRetry 对已有 timer return）。 */
  onRecovered?: () => void;

  isWritable(): boolean { return !this.ioBroken; }
  overCapacity(): boolean { return this.overCapacityFlag; }
  failureStreak(): number { return this.writeFailureStreak; }

  /** V14：ioBroken=磁盘/IO 故障（探针帧写删成功即解）；overCapacity=容量超限（只在
   *  depth().bytes 回落到阈值下时由 append 前置判定解除——探针成功不得误关，v1 单态 bug）。 */
  private noteWriteFailure(): void {
    this.writeFailureStreak += 1;
    yjsSpoolWriteFailuresTotal.inc();
    if (this.writeFailureStreak >= CollabSpoolService.WRITE_FAILURE_CIRCUIT && !this.ioBroken) {
      this.ioBroken = true;
      this.logger.error('spool IO circuit OPEN：连续写失败——批次留队列（BOI）；受理面由 gateway.isWritableOrDegraded 只读降级（Y24 命名）');
      this.startProbe();
    }
  }
  private noteWriteSuccess(): void {
    this.writeFailureStreak = 0;
    if (this.ioBroken) {
      this.ioBroken = false;
      this.stopProbe();
      this.logger.log('spool IO circuit CLOSED：探针帧写删成功');
      try { this.onRecovered?.(); } catch { /* 回调异常不损恢复事实 */ }   // Y10：唤醒 gateway rearm
    }
  }
  private startProbe(): void {
    if (this.probeTimer) return;
    this.probeTimer = setInterval(() => { void this.probe().catch(() => {}); }, CollabSpoolService.PROBE_INTERVAL_MS);
    this.probeTimer.unref?.();
  }
  private stopProbe(): void {
    if (this.probeTimer) { clearInterval(this.probeTimer); this.probeTimer = null; }
  }
  /** 探针=写 1 帧探针载荷+confirm 段回收+fsync——只解 ioBroken（noteWriteSuccess 不触碰容量态）。 */
  async probe(): Promise<void> {
    const ids = await this.appendRaw('__probe__', new Uint8Array([0]));
    await this.confirm('__probe__', ids);
    this.noteWriteSuccess();
  }

  /** append 统一包两态记账（V14）：容量判定=**总字节**（含隔离——隔离段同占盘）；容量计数不进写失败 streak。 */
  async append(projectId: string, payload: Uint8Array): Promise<string[]> {
    if (projectId !== '__probe__') {
      const d = this.depth();
      if (!this.overCapacityFlag && d.bytes + payload.byteLength > CollabSpoolService.SPOOL_CAPACITY_BYTES) {
        this.overCapacityFlag = true;
        yjsSpoolCapacityTotal.inc();
        this.logger.error('spool capacity exceeded（256MB 总口径含隔离字节）——拒新编辑（不丢最旧：丢=蒸发同罪）；人工处置=collab-spool-quarantine 脚本');
      } else if (this.overCapacityFlag && d.bytes <= CollabSpoolService.SPOOL_CAPACITY_BYTES * 0.9) {
        this.overCapacityFlag = false;                        // 滞回解除（10% 余量防抖动）
        this.logger.log('spool capacity recovered');
      }
      if (this.overCapacityFlag) throw new Error('spool capacity exceeded');
    }
    try {
      const ids = await this.appendRaw(projectId, payload);
      this.noteWriteSuccess();
      return ids;
    } catch (e) {
      this.noteWriteFailure();
      throw e;
    }
  }
```

（实现注记：Task 1 的 `append` 体改私有 `appendRaw`（V2 封段守卫在其内）；探针帧走 appendRaw 豁免容量。）

```typescript
  /** V3：坏帧段处置=**字节区间**隔离（坏帧起始偏移→EOF）——截断是字节事实非帧号集合
   *  （v1 的帧号循环在 scan 停读后 frameCount===firstBad=恒空循环，真 bug）；sidecar 记偏移区间；
   *  quarantinedBytes = byteLength - off（**含坏帧头**——v1 的 -8 off-by-8 实错）；重复调用不重复递增计数。 */
  async quarantineTruncatedFrames(projectId: string): Promise<number> {
    const segs = this.index.get(projectId);
    if (!segs) return 0;
    let newQuarantined = 0;
    for (const f of await readdir(this.dir)) {
      const parsed = parseSegFileName(f);
      if (!parsed || parsed.projectId !== projectId) continue;
      const meta = segs.get(parsed.segSeq)!;
      if (meta.quarantinedRange != null) continue;             // 已隔离——不重复递增（V3）
      const buf = await readFile(join(this.dir, f));
      let off = 0;
      while (off + FRAME_HEADER_BYTES <= buf.byteLength) {
        const len = buf.readUInt32LE(off);
        if (off + FRAME_HEADER_BYTES + len > buf.byteLength || (crc32(buf.subarray(off + 8, off + 8 + len)) >>> 0) !== buf.readUInt32LE(off + 4)) break;
        off += FRAME_HEADER_BYTES + len;
      }
      if (off >= buf.byteLength) continue;                     // 干净段
      meta.quarantinedRange = { fromOffset: off };             // 区间事实：坏帧起始偏移→EOF
      meta.sealed = true;                                      // V2：含坏尾的段封禁（永不再追加）
      meta.quarantinedBytes = buf.byteLength - off;
      newQuarantined += 1;
      const line = JSON.stringify({ segSeq: parsed.segSeq, quarantinedFromOffset: off, toOffset: buf.byteLength, reason: 'truncated-or-crc', firstSeenAt: new Date().toISOString() }) + '\n';
      const sc = await open(join(this.dir, `${f}.quarantine`), 'a');
      try { await sc.writeFile(line); await sc.sync(); } finally { await sc.close(); }
    }
    if (newQuarantined > 0) yjsSpoolQuarantinedTotal.inc(newQuarantined);
    return newQuarantined;
  }
```

（`SegmentMeta` 补 `quarantinedRange: { fromOffset: number } | null`+`quarantinedBytes: number`+V2 的 `goodBytes/sealed`；**段回收判据修订（V3）**：`confirm()` 的 allSettled 改为"全部**可解析**帧 confirmed ∧（有坏尾 ⇒ quarantinedRange 已记）"——可解析帧数=scan 时的好帧计数，`meta.quarantined` 帧号集合退役（peek 逻辑同步：读到 `quarantinedRange.fromOffset` 即停——不再依赖帧号集合）。）

```typescript
  /** V16+X8：启动回灌——总墙钟预算默认 5s+固定 200ms 退避+**每帧 maxAttempts=3 有界重试环**
   *  （v2 的"预算充足时单次失败既不重试也不计数"死代码形态撤销——failed 在 attempts 耗尽/预算耗尽
   *  两分支都计数，启动自检点名才不静默）+**合并上界**（≤8 帧且合计 ≤4MB 才合并单次 append，
   *  超界分轮——防 PG 长故障恢复后 256MB 单行 append+同步 merge 停摆；恢复期自然有界多轮，
   *  每轮成功只 confirm 本轮 K 帧）。FK 判别=isFkGone（pg-error.util.ts 单源，X15）。
   *  X3'（C3）：keys() 恒排除 `__probe__`；scan() 阶段直接 unlink `__probe__*` 段（探针帧崩溃残留不进回灌）。 */
  private static readonly REPLAY_MERGE_MAX_FRAMES = 8;
  private static readonly REPLAY_MERGE_MAX_BYTES = 4 * 1024 * 1024;
  private static readonly REPLAY_MAX_ATTEMPTS = 3;

  async replayAll(
    repo: Pick<CanvasDocUpdateRepository, 'append'>,
    opts?: { budgetMs?: number; retryDelayMs?: number; maxAttempts?: number; projectIds?: string[] },
  ): Promise<{ replayed: number; failed: number; discarded: number }> {
    const deadline = Date.now() + (opts?.budgetMs ?? CollabSpoolService.REPLAY_BUDGET_MS);
    const retryDelay = opts?.retryDelayMs ?? CollabSpoolService.REPLAY_RETRY_MS;
    const maxAttempts = opts?.maxAttempts ?? CollabSpoolService.REPLAY_MAX_ATTEMPTS;
    let replayed = 0, failed = 0, discarded = 0;
    for (const projectId of opts?.projectIds ?? this.keys()) {
      for (;;) {                                                 // X8：分轮合并（每轮 ≤8 帧且 ≤4MB）
        const frames = (await this.peek(projectId)).slice(0, CollabSpoolService.REPLAY_MERGE_MAX_FRAMES);
        if (frames.length === 0) break;
        const totalBytes = frames.reduce((s, f) => s + f.payload.byteLength, 0);
        if (totalBytes > CollabSpoolService.REPLAY_MERGE_MAX_BYTES) frames.length = this.truncateByBytes(frames, CollabSpoolService.REPLAY_MERGE_MAX_BYTES);
        let roundAppended = false;
        try {
          const merged = frames.length === 1 ? frames[0].payload : Y.mergeUpdates(frames.map((f) => f.payload));
          const r = await repo.append(projectId, merged);
          if (!r.ok) throw new Error(`append returned no row (${r.reason})`);
          await this.confirm(projectId, frames.map((f) => f.frameId));
          replayed += frames.length;
          roundAppended = true;                                  // 本轮全落——继续下一轮（帧已 confirm 不可见）
        } catch (e) {
          if (isFkGone(e)) {                                     // V6：项目已删 DB 权威证据
            await this.confirm(projectId, frames.map((f) => f.frameId));
            discarded += frames.length; yjsUpdatesDiscardedDeletedTotal.inc({ source: 'spool' }, frames.length);
            this.logger.warn(`spool frames for ${projectId} discarded (project deleted, FK)`);
            continue;                                            // 下一轮（或该项目耗尽）
          }
          // 合并失败→退化逐帧有界重试环（隔离坏帧目的仍达成）
          for (const frame of frames) {
            for (let attempt = 1; ; attempt++) {
              if (Date.now() > deadline) { failed += 1; this.logger.error(`spool replay budget-exhausted for ${projectId}:${frame.frameId}——帧保留（运行期由退避梯自愈，X5）`); break; }
              try {
                const r2 = await repo.append(projectId, frame.payload);
                if (!r2.ok) throw new Error(`append returned no row (${r2.reason})`);
                await this.confirm(projectId, [frame.frameId]);
                replayed += 1;
                break;
              } catch (e2) {
                if (isFkGone(e2)) { await this.confirm(projectId, [frame.frameId]); discarded += 1; yjsUpdatesDiscardedDeletedTotal.inc({ source: 'spool' }); break; }
                if (attempt >= maxAttempts) { failed += 1; this.logger.error(`spool replay failed (${attempt} attempts) for ${projectId}:${frame.frameId}: ${(e2 as Error).message}`); break; }
                await new Promise((r3) => setTimeout(r3, retryDelay));
              }
            }
          }
        }
        if (!roundAppended) break;                               // 本轮未整体落定——该项目结束（残帧归运行期）
        if (Date.now() > deadline) break;
      }
    }
    return { replayed, failed, discarded };
  }

  /** X8 辅助：按字节上限截断帧列表（保持顺序） */
  private truncateByBytes(frames: SpoolFrame[], maxBytes: number): number {
    let acc = 0, i = 0;
    while (i < frames.length && acc + frames[i].payload.byteLength <= maxBytes) { acc += frames[i].payload.byteLength; i += 1; }
    return Math.max(i, 1);                                       // 至少 1 帧（单帧超 4MB 也单帧投递——巨帧由装载侧 WARN 观测）
  }
```

（`import * as Y from 'yjs'`（api 侧服务引 yjs 无碍）；`isFkGone` 自 `./pg-error.util`（X15 新建——gateway/spool 双消费单源，防循环依赖）；`yjsUpdatesDiscardedDeletedTotal` 带 `{source}` 标签（X17 改名+统一口径）；`keys()` 实现补 `.filter((k) => k !== '__probe__')`+`scan()` 末步 `for (const f of files) if (f.startsWith('__probe__.')) await unlink(...)`。）

（import 补 `yjsSpoolCapacityTotal, yjsSpoolQuarantinedTotal, yjsSpoolWriteFailuresTotal, yjsUpdatesDiscardedDeletedTotal`——**Y18：该指标带 `{source:'gateway'|'spool'}` 标签，定义落本 Task 的 metrics 追加块（v3 只用未定义）**，Task 6 的 project.gone 主动拦截共用同计数器。）

**Y18：metrics 追加块（Task 2 批次）**：

```typescript
/** Y0a-2（X17 改名+标签统一口径）：已删项目的更新丢弃计数——source 标签区分 gateway 终态拦截与
 *  spool 回灌 FK 收割两路径（无标签调用会产出 source="" 的脏 series——禁）。 */
export const yjsUpdatesDiscardedDeletedTotal = new Counter({
  name: 'yjs_updates_discarded_deleted_total', help: '项目已删的更新丢弃数（gateway 拦截/spool FK 收割——显式接受的有界丢失）',
  labelNames: ['source'], registers: [register],
});
```

- [x] **Step 4: 跑绿+commit**

```bash
pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab-spool.service.spec.ts && pnpm --filter @flowweb/api exec vitest run src/modules/collab
```
Expected: spool 用例全绿+collab 全量绿（spool service 尚未接 gateway——零冲击）。

```bash
git add apps/api/src/modules/collab/collab-spool.service.ts apps/api/src/modules/collab/collab-spool.service.spec.ts apps/api/src/modules/collab/store.metrics.ts && git commit -m "feat(collab): Y0a-2 spool 完整语义——quarantine sidecar+容量/写失败两态熔断+探针解熔断(onRecovered seam)+启动回灌总预算+有界重试环+FK 终态丢弃"
```

> **Task 2 执行勘误（2026-10-07 实现裁定，commits `ca4a6908`+`c73aadbb`+`1119210a`；两阶段审查均过）**——Task 3+ 消费者以此为准（实际 commit 文件清单另含 pg-error.util.ts+collab-spool.int.spec.ts）：
> ①**isWritable() 终形态 `!ioBroken && !overCapacityFlag`**（controller 裁定）：实现者曾加 `writeFailureStreak===0` 条件（满足熔断用例 1 的 2 次失败断言）——**否决**：streak 1-4 区间探针未启（5 连败才 startProbe）+X6 重试梯首行 `!isWritable()` 停排+X9 受理面降级=**单败停摆窗口**（无人再写 spool→streak 永不清零）。熔断用例 1 改 5 连败断言（2 败后 isWritable true+5 败后 false）。
> ②**I1 quarantine 调序（质量审查 Important）**：sidecar 先落盘成功→再改 meta 三字段→再计数（plan 原代码块 meta 先改——ENOSPC 下 sidecar 写失败=内存已隔离→confirm unlink 销毁坏尾取证事实）；`finally { sc.close().catch(()=>{}) }` 防掩盖原异常；新增 sidecar 失败路径用例（mkdir 占位→EISDIR→meta 未动→重试成功）。
> ③**I2 replayAll 外层项目循环体首行补 `if (Date.now() > deadline) return {...}`**（plan 原代码块缺口——PG 挂起态逐项目稀释 5s 总预算）。
> ④合并回灌用例 payload 须为合法 Y update（`Y.mergeUpdates` 对任意字节 throw——plan 的 `[1,1]` 字节会退化逐帧路径使合并断言失真）；⑤quarantineTruncatedFrames 对 index 缺段 `!meta` continue 防御；⑥yjsSpoolQuarantinedTotal help 口径=段（非帧）；⑦Task 1 的 8 项质量 Minor 已同批收口（幻影 meta 回滚/scan index.clear()+<8B 段 unlink+残尾 truncated/父目录 fsync try/catch/confirm O(1) confirmedCount/注释三处/单飞契约 JSDoc/测试名）。
> spool 侧最终 API 面：append（两态记账）/peek/confirm/quarantineTruncatedFrames/scan/replayAll(repo,{budgetMs,retryDelayMs,maxAttempts,projectIds})/isWritable()/overCapacity()/failureStreak()/probe()/depth()/keys()/hasFrames()/validateDir()/onRecovered seam；pg-error.util.ts（isFkGone/isRetryableAppendError）；指标族全落（含 yjs_updates_discarded_deleted_total{source}）。测试：spool 19/19+int 1/1+collab 全量 209 绿。

---

### Task 3: BOI 重写+spool 单源接线（删内存 unflushed Map）+三代红相留档+storeInFlight

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（契约头注释+storeDocument 重写+stash 族退役+load peek 改造+saveMutex 串行+storeInFlight）
- Modify: `apps/api/src/test-utils/failing-repo.ts`（post-N 缺陷修复）
- Modify: `apps/api/src/test-utils/dual-client-server.ts`（构造点补 spool 参数）
- Modify: `apps/api/src/modules/collab/collab.gateway.spec.ts` / `collab.gateway.persist-status.spec.ts` / `collab.gateway.auth-reason.spec.ts` / `collab.gateway.env.spec.ts` / `collab.gateway.sweep.spec.ts` / `collab.gateway.shutdown.spec.ts`（构造点+12 处断言改造）
- Modify: `apps/api/src/modules/collab/store.metrics.ts`（yjsUnflushedProjects 改语义+storeInFlight）

- [x] **Step 1: 修复 failing-repo（Y0a-1 Minor 1 登记——本 Task 出现消费者）**

`failing-repo.ts` 的 failAppend 实现改（失败 N 次**后回工厂默认形状**而非 resolve undefined）：

```typescript
  if (opts.failAppend != null) {
    const defaultImpl = repo.append.getMockImplementation()!;   // 工厂默认（{ok:true,seq:1n}）
    let appends = 0;
    repo.append.mockImplementation(async (...args: Parameters<MockRepo['append']>) => {
      appends += 1;
      if (appends <= opts.failAppend!) throw new Error(`injected append failure #${appends}`);
      return defaultImpl(...args);
    });
  }
```

（failCompact 同款改造；`import { createMockRepo, type MockRepo } from './mock-repo'` 已有。）

- [x] **Step 2: 契约头注释（§2.1）+构造签名扩 spool（必填注入）+6 构造点改造**

`collab.gateway.ts` 类头（`:49` `export class CollabGateway` 之前）插入契约声明：

```typescript
/** ===== Y0a-2 持久化契约声明（spec v2.4 §2.1，钉死）=====
 *  PG=单实例 delta 并集日志（append-only）；CRDT 幂等收敛（重复/乱序 apply 安全）；锁只管 compact；
 *  内存 pending 队列=去抖窗口非持久层；spool 文件=store 故障期唯一权威待落库台账；
 *  onStoreDocument 任何路径不 throw（失败→spool→返回 false；自有 hook 抛错跳链=库锚 A1/A5 前提）。
 *  BOI（契约 §4.3-11）：任何批次任意时刻至少归属于 {doc 队列, spool 已 fsync, PG 已提交} 之一；
 *  离开旧归属必须先进入新归属——queue.splice 永远在新家落定之后。 */
```

构造函数（`:96` sessions 参数**之后**）加必填参数（Nest 按类型自动注入——module providers 已注册）：

```typescript
    private readonly spool: CollabSpoolService,
```

（import 补 `import { CollabSpoolService } from './collab-spool.service';`。）

**6 构造点改造**：kit（dual-client-server.ts:41）签名扩第三参 `spool?: CollabSpoolService`（缺省内部 makeSpoolDir）：

```typescript
export async function startDualClientServer(over: Partial<MockRepo> = {}, debounce = 300, spool?: CollabSpoolService): Promise<DualClientKit> {
  ...
  const spoolSvc = spool ?? new CollabSpoolService((await mkdtemp(join(tmpdir(), 'y0a2-kit-'))));
  const emitter = new EventEmitter2() as any;   // 单一实例——构造注入+kit 返回值暴露（事件用例直发 project.gone/team.disbanded）
  const gateway = new CollabGateway(prisma, emitter, repo as any, { syncFromPeers: async () => {} } as any, { resolve: async () => 'PROJECT_EDITOR' } as any, port, debounce, undefined, undefined, spoolSvc);
```

（kit 返回值加 `spool: spoolSvc, emitter`（DualClientKit 接口同步扩两字段：`spool: CollabSpoolService`+`emitter: EventEmitter2`——Task 6 事件用例经 `kit.emitter.emit` 直发）；dispose 不删目录——mkdtemp 在 os tmpdir 自动清理域。5 个直构 spec（auth-reason:26/shutdown:16/persist-status:38/env:11/sweep:24）同款：构造调用补 spool 实参——`new CollabSpoolService(<该 spec 的 tmp 目录>)`，各文件 beforeEach 建/afterAll 清（复用 makeSpoolDir）。**spec 位置参数注意**：现有直构点多为多行位置传参，插在 timeout 之后 sessions 之前——逐点核对实参序。）

- [x] **Step 3: 写 BOI 三用例（对旧实现全红——三代红相）**

`collab.gateway.spec.ts` 追加（kit import 已有）：

```typescript
import { CollabSpoolService } from './collab-spool.service';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { failingRepo } from '../../test-utils/failing-repo';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('Y0a-2 BOI（批次所有权不变量——契约 §4.3-11；红相三代见用例名）', () => {
  it('BOI-1 一代红相（splice-first）：append 挂起 → 批必须仍在队列（copy-first）——旧实现 splice(0) 先取走=队列空（进程死即蒸发）', async () => {
    let release!: (v: { ok: true; seq: bigint }) => void;                       // Y13：可释放 deferred（永挂 promise 留悬挂引用）
    const kit = await startDualClientServer({ append: vi.fn(() => new Promise((r) => { release = r; })) }, 200);
    try {
      const doc = new Y.Doc();
      const name = 'project:p-boi1';
      const g = kit.gateway as any;
      g.pendingQueues.set('p-boi1', [new Uint8Array([1, 2, 3])]);                // Y19：projectId 键控装置（V4——pendingUpdates 直插=种子不可见）
      const errSpy = vi.spyOn(g.logger, 'error');
      void kit.gateway.hooks.onStoreDocument({ document: doc, documentName: name });   // 不 await——append 挂起
      await pollUntil(() => (kit.repo.append as MockRepo['append']).mock.calls.length >= 1, 2_000);   // Y4：等 append 真被调——防 tripwire 早退的空转绿
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('unobserved'))).toBe(false);   // Y4 反向断言：tripwire 未吞掉用例
      expect(g.pendingQueues.get('p-boi1')).toHaveLength(1);                     // copy-first：批仍在旧归属地（旧实现 splice 后=0 → 红）
      release({ ok: true, seq: 1n });                                            // 释放挂起（dispose 干净）
    } finally { await kit.dispose(); }
  });

  it('BOI-2 三代红相（fenced 0 行不抛错）：append resolve {ok:false,reason:"fenced"} → spool 帧在+队列在+不排重试——旧实现不检查返回值照常 splice=帧蒸发', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-boi2-');
    try {
      const spool = new CollabSpoolService(dir);
      const repo = createMockRepo({ append: vi.fn(async () => ({ ok: false as const, reason: 'fenced' as const })) });
      const kit = await startDualClientServer({ ...repo }, 200, spool);
      try {
        const g = kit.gateway as any;
        g.pendingQueues.set('p-boi2', [new Uint8Array([9, 9])]);                 // Y19：projectId 键控
        const r = await kit.gateway.hooks.onStoreDocument({ document: new Y.Doc(), documentName: 'project:p-boi2' });
        expect(r).toBe(false);
        expect(g.pendingQueues.get('p-boi2')).toHaveLength(1);                   // 未 splice（旧实现=0 → 红）
        expect(await spool.peek('p-boi2')).toHaveLength(1);                      // 批入 spool（旧实现 spool 空 → 红）
        expect(g.persistRetry.size).toBe(0);                                     // fenced=终态禁退避梯（契约 15）
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  });

  it('BOI-3 A9 断链：append 持续失败 → 断连卸载 doc → 批必须在 spool（磁盘）——旧实现 stash 进内存 unflushed=崩溃丢（红）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-boi3-');
    try {
      const spool = new CollabSpoolService(dir);
      const kit = await startDualClientServer({ append: failingRepo({ failAppend: 99 }).append }, 200, spool);
      try {
        const name = 'project:p-boi3';
        const { provider, synced } = kit.connect(name);
        await synced;
        provider.document.getMap('nodes').set('n', new Y.Map([['x', 1]]));
        await pollUntil(() => (kit.repo.append as MockRepo['append']).mock.calls.length >= 1, 5_000);   // 首次 store 已失败（批已入 spool）
        expect(await spool.peek('p-boi3')).toHaveLength(1);       // BOI 失败路径：新家=spool 已 fsync（旧实现=内存 Map，spool 空 → 红）
        await provider.destroy();
        await pollUntil(() => !kit.gateway.server.hocuspocus.documents.has(name), 8_000);   // A9：卸载发生
        expect(await spool.peek('p-boi3')).toHaveLength(1);       // 卸载后批仍在磁盘（旧实现随 doc 消失+内存 Map 崩溃丢 → 红）
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  });
});
```

**Step 3b 注**：BOI-1 里构造 doc 的写法在实现时统一为 `new Y.Doc()`（gateway pendingUpdates 键类型 Y.Doc；Document extends Y.Doc，测试直插合法——kit 内 server 对该 doc 无感知不影响 storeDocument 白盒直调）。上面 BOI-1 代码段以 `const doc = new Y.Doc();` 为准（修正行内注释）。

- [x] **Step 4: 跑红留档（旧实现三代红相——D13）**

```bash
pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab.gateway.spec.ts -t "BOI"
```
Expected: 3 用例全 FAIL（BOI-1 队列 0≠1；BOI-2 队列 0≠1∧peek 0≠1；BOI-3 peek 0≠1——旧实现批在内存 unflushed）。**输出全文粘进本步骤下方留档**。红相三代登记表：

| 代 | 旧实现形态 | 红相证据 | 本批消灭机制 |
|---|-----------|---------|-------------|
| 一代 | `:290` splice(0) 先取走+append 挂起/失败 | BOI-1：队列空（批为栈上局部变量，进程死即蒸发） | copy-first（merge 不动队列） |
| 二代 | v2.1 形状（splice 后 putStash-throw） | BOI-3 注入等价（spool 写失败→队列不动）：形状论证——splice 已执行+throw=批彻底蒸发（spec §1.5 v2.1 自证缺陷） | spool 失败不 throw 改批留队列+熔断 |
| 三代 | append 返回 `{ok:false}` 不抛错（fenced 形态，Y0a-3 起真实存在） | BOI-2：旧实现不检查 AppendResult 照常 splice=帧蒸发（spec §6.1 v2.4 增补） | AppendResult 判别消费（契约 15） |

- [x] **Step 5: 探针留档——库调 store 钩子的锁形态（v2：结论已实测写死，探针降级为回归断言）**

**实测结论（2026-10-07，esm:1536-1539）**：`storeDocumentHooks` 把 `onStoreDocument` **与** `afterStoreDocument` **一起**包在 `document.saveMutex.runExclusive` 内——**形态 A 写死**：onStoreDocument 钩子注册**直通** storeDocument（体内禁再包=重入死锁）；gateway 三直调点（retryPersist doc 级/disconnect/drain）统一走 `storeDocumentSerialized`。**不采用 `isLocked()` 探测**（无法区分重入与竞争）——采用名称自证双入口：私有方法体命名 `storeDocumentUnlocked`（名字即契约——"忘了加锁"在 review 可见），hooks 直通它、直调点经 `storeDocumentSerialized` 包 mutex。附回归断言（collab.library-anchors.spec.ts 追加，防升级漂移）：

```typescript
it('A14 store 钩子在 saveMutex 内执行（v2 探针结论固化——重入加锁=死锁防线）', async () => {
  const order: string[] = [];
  const server = new Server({ port: 0, quiet: true, stopOnSignals: false, debounce: 50, maxDebounce: 80,
    onStoreDocument: async ({ document }) => { order.push('hook'); expect(document.saveMutex.isLocked()).toBe(true); } });
  await server.listen();
  try {
    const conn = await server.openDirectConnection('p-mutex');
    await conn.transact((doc) => { doc.getMap('nodes').set('n', new Y.Map()); });
    await conn.disconnect();
    await pollUntil(() => order.length >= 1, 3_000);
  } finally { await server.destroy(); }
});
```

- [x] **Step 6: 实现 BOI 重写（v2：队列 projectId 键控化/confirm 语义 V1/降级 spool-first V12/受理门 V13/storeInFlight try-finally V22）**

**V4 队列归属 gateway 化**（`:54` 字段替换——批次第一归属地不再随库卸载消亡）：

```typescript
  /** Y0a-2（V4）：批次第一归属地=gateway 权威 Map（projectId 键控）——库 onClose 无条件卸载（esm:1382-1387）
   *  会销毁 Document 与一切 WeakMap 键控态；队列改自有 Map 后 doc 消亡≠批消失（P0-3）。
   *  数组身份恒定不变量沿用：一切变更只 push/splice，禁 set 替换。 */
  private readonly pendingQueues = new Map<string, Uint8Array[]>();
  /** doc→projectId 关联（loadDocument 播种；update 回调/stash 检查用）——doc 消亡仅失关联不失批 */
  private readonly docProject = new WeakMap<Y.Doc, string>();
```

（`pendingUpdates` WeakMap 字段整删；update 回调取队列改 `this.pendingQueues.get(this.docProject.get(document)!)`；既有 spec 直插 `pendingUpdates` 的装置随 V18 清单同批改插 `pendingQueues`。）

**Y11：loadDocument 播种终形态（get-or-create——永不 set 替换）**。loadDocument 首行（原 `if (!this.pendingUpdates.has(document))` 块整体替换）：

```typescript
      // Y11：队列 get-or-create——卸载交接失败遗留的批必须在重连后存活（set 替换=静默丢批，V4 要消灭的形态）；
      // docProject 播种（update 回调经它解析队列）；数组身份恒定不变量沿用（只 push/splice）。
      this.docProject.set(document, projectId);
      if (!this.docEpoch.has(document)) this.docEpoch.set(document, Date.now());
      if (!this.pendingQueues.has(projectId)) this.pendingQueues.set(projectId, []);
      if (!this.docListeners.has(document)) {   // 监听防重复注册（update 事件一次）
        this.docListeners.add(document);
        document.on('update', (u: Uint8Array) => { /* Task 7 终形态回调体 */ });
      }
```

（`docListeners = new WeakSet<Y.Doc>()` 替代原 `pendingUpdates.has(document)` 的"已注册"判定源（原判定与队列条目耦合——V4 拆键后失效）。**配套用例（Task 7 Step 1 追加）**：卸载交接失败（spool 白盒置 ioBroken）→批留队列→同项目重连 load→断言 `(g).pendingQueues.get(pid)` 与交接前**同一数组引用**且长度不减→经退避梯/直接 store 落库一次。）

`storeDocument` 整体替换（`:280-317`，v2 形态——**confirm 语义 V1：失败路径只写本批（不并入旧帧），新帧 PG 成功前永不 confirm**）：

```typescript
  /** Y0a-2 BOI 主路径（spec v2.4 §2.3 + V1/V12）：copy-first——merge 不动队列，splice 永远在
   *  新家落定（append r.ok===true 或 spool fsync 成功）之后；任何路径不 throw（契约 3）；
   *  fenced=终态（契约 15）：批走 spool+不排退避梯（Y0a-3 接 selfIsolate——本批 ERROR 日志+行为用例）。
   *  **confirm 语义（V1，防 P0-1 蒸发）**：spool 帧只在"内容已被 PG 成功接收"时 confirm（本批 peek 出的
   *  旧帧集合）；失败路径 spool.append 写**仅本批**（旧帧不并入——各自独立帧，防 O(n²) 重写放大）；
   *  恢复时一次 append 合并全部未 confirm 帧+PG 已有内容，confirm 旧帧→段回收。
   *  **降级态 spool-first（V12）**：persistUnhealthy 态下批先落 spool（fsync）再试 PG——故障腿窗口
   *  =一个 debounce 窗+fsync（PG 挂起时 append 有 5s 事务上界兜底）；稳态 PG-first 零写放大。
   *  storeInFlight（契约 14/P5，**X2 四落定点**——Y24 注：非 try/finally）：①append ok ②spool fsync
   *  成功（含 V12 降级/V5' 交接/force-spool）③FK/终态丢弃 ④project.gone 丢弃；spool 失败回队列**不清**
   *  （批未落定=flush-at-risk）；意外异常兜底 leave=本方法外层 catch（Y2——钩子路径不经 Serialized，
   *  兜底必须在此层）。 */
  private async storeDocumentUnlocked({ document, documentName }: Pick<onStoreDocumentPayload, 'document' | 'documentName'>): Promise<boolean> {
    const projectId = parseProjectId(documentName);
    if (this.deletedProjects.has(projectId)) return this.discardForGoneProject(projectId, documentName);   // V10：显式清账+点名
    const queue = this.pendingQueues.get(projectId);
    if (!queue) {
      this.logger.error(`store for unobserved doc ${documentName}: listener never registered`);
      return false;
    }
    try {   // Y2：兜底 catch 在此层（钩子直通本方法——Serialized 的 catch 盖不到；spool 失败的正常 return false 不经过这里）
    const degraded = this.persistUnhealthy.has(documentName);    // V12：降级态
    const stashFrames = await this.peekSpoolFrames(projectId);
    if (queue.length === 0 && stashFrames.length === 0) { yjsStoreDrainTotal.inc({ result: 'noop' }); return false; }
    this.enterInFlight(projectId);                               // enter storeInFlight（projectId 级）
    const stashIds = stashFrames.map((f) => f.frameId);
    // —— 降级态（V12）：本批先落 spool（新家先落定），再连带旧帧试 PG ——
    if (degraded && queue.length > 0) {
      const n0 = queue.length;
      const own = n0 === 1 ? queue[0] : Y.mergeUpdates(queue.slice(0, n0));
      const ids = await this.spool.append(projectId, own);       // fsync 完成才返回（本批安全先落盘）
      queue.splice(0, n0);                                       // 本批新家=spool 已落定
      this.leaveInFlight(projectId);                             // X2 落定点②：spool fsync 成功（批已安全——后续 PG 尝试是回收不是保命）
      stashFrames.push({ frameId: ids[0], payload: own });       // 并入本次 PG 尝试集
      stashIds.push(ids[0]);
    }
    const n = queue.length;
    const parts = [...stashFrames.map((f) => f.payload), ...queue.slice(0, n)];
    const tailRef = parts[parts.length - 1];                     // Y8：取批时批尾引用（身份校验锚——splice 前比较）
    const payload = parts.length === 1 ? parts[0] : Y.mergeUpdates(parts);
    let appended = false; let fenced = false;
    try {
      const r = await this.repo.append(projectId, payload);      // AppendResult（契约 15）+5s 事务上界（V8）
      if (r.ok) appended = true;
      else if (r.reason === 'fenced') {
        fenced = true;
        this.logger.error(`append fenced for ${projectId}（租约失守——批走 spool，不排退避梯）`);
      } else {
        throw new Error(`append returned no row (${r.reason})`);
      }
    } catch (err) {
      if (isFkGone(err)) {                                       // V6：raw 路径=P2010+meta 23503（isFkGone 自 pg-error.util——X15 单源，Y17 删本类声明）
        queue.splice(0, n);
        yjsUpdatesDiscardedDeletedTotal.inc({ source: 'gateway' });
        this.leaveInFlight(projectId);                           // X2 落定点③：FK/终态丢弃
        this.logger.warn(`store append hit FK for ${projectId}——batch discarded (project deleted)`);
        return false;
      }
      this.logger.error(`store append failed for ${projectId}, ${parts.length} updates: ${(err as Error).message}`);
      yjsStoreAppendFailureTotal.inc();
    }
    if (appended) {
      // Y8：splice **前**判据（v3 的 splice 后 queue.length<n 恒真=健康路径刷 anomaly）——
      // await 期间 push 只增不减：length<n ⇒ 有人并发取批（saveMutex 被绕过）；
      // queue[n-1]!==tailRef ⇒ 结构性变更（Y7 coalesce 竞争——门控下不该发生）→ splice 只删确实还在的前缀
      if (queue.length < n || (n > 0 && queue[n - 1] !== tailRef)) {
        yjsStoreTailAnomalyTotal.inc();
        this.logger.error(`store tail anomaly for ${documentName}: queue mutated during append（并发取批/结构变更——splice(0,n) 按实际存在截断）`);
      }
      queue.splice(0, n);                                        // 新家（PG）已落定——移出旧归属
      this.leaveInFlight(projectId);                             // X2 落定点①：append ok
      if (stashIds.length) await this.spool.confirm(projectId, stashIds);   // 旧帧内容已入 PG——可回收
      yjsStoreDrainTotal.inc({ result: 'appended' });
      yjsCanvasDocBytes.inc({ projectId }, payload.byteLength);
      this.cancelPersistRetry(documentName);
      this.setPersistStatus(documentName, true);
      try { await this.maybeCompact(projectId); }
      catch (err) {
        yjsStoreCompactFailureTotal.inc();
        this.logger.warn(`compact failed for ${projectId} (rows already durable): ${(err as Error).message}`);
      }
      return true;
    }
    // append 失败（含 fenced）：批必须入账——spool=唯一真修法（E43②：入账先于一切）。
    // V1：只写"本批"（降级态已提前写过则跳过）——旧帧留在 spool 各自独立，恢复时合并读
    if (!degraded && queue.length > 0) {
      try {
        const n2 = queue.length;
        const own = n2 === 1 ? queue[0] : Y.mergeUpdates(queue.slice(0, n2));
        await this.spool.append(projectId, own);                 // fsync 完成才 resolve；新帧不 confirm（V1）
        queue.splice(0, n2);
        this.leaveInFlight(projectId);                           // X2 落定点②：spool fsync 成功
      } catch (e2) {
        // spool 也失败：队列不动（BOI）——**不清 inFlight 标志**（X2：批未落定=flush-at-risk 口径，
        // 契约 14 原文；finally 形态会把 G-2a ii 档清零=自断言红）
        this.logger.error(`spool append failed for ${projectId}, batch retained in queue: ${(e2 as Error).message}`);
        this.setPersistStatus(documentName, false);
        if (!fenced) this.schedulePersistRetry(documentName);    // X6：熔断态首行自检不排（probe 恢复经 onRecovered seam 唤醒——Y10）
        return false;                                            // 任何路径不 throw（契约 3）——熔断计数在 spool 内
      }
    }
    if (queue.length === 0) this.leaveInFlight(projectId);       // 队列空=批全在 spool（fsync 已完成=契约 14 落定点；帧后续落 PG 归回灌——非 at-risk，J4 注）
    this.setPersistStatus(documentName, false);
    if (!fenced) this.schedulePersistRetry(documentName);        // fenced=终态禁退避梯
    return false;                                                // 任何路径不 throw（契约 3）
    } catch (err) {   // Y2 兜底：意外异常（Y.mergeUpdates 炸/IO 逃逸等）——leave 防漂移+ERROR 留痕；正常失败路径（上文 return false）不经此
      this.leaveInFlight(projectId);
      this.logger.error(`store unexpected throw for ${documentName}: ${(err as Error).message}——契约 3 最后一道闸（批保留原归属地）`);
      return false;
    }
  }

  /** V10：终态拦截的显式清账——丢弃是对的，静默丢弃不是。Y1：丢弃=归属落定——leaveInFlight
   *  （Set.delete 幂等；事件到达时 store 在飞的窗口由此收口，防已删项目永久占用 storeInFlight）。 */
  private discardForGoneProject(projectId: string, documentName: string): boolean {
    const q = this.pendingQueues.get(projectId);
    const batches = q?.length ?? 0;
    const bytes = (q ?? []).reduce((s, u) => s + u.byteLength, 0);
    if (q && batches > 0) q.splice(0);
    this.leaveInFlight(projectId);   // Y1：X2 落定点④（project.gone 丢弃）
    yjsUpdatesDiscardedDeletedTotal.inc({ source: 'gateway' });
    this.logger.warn(JSON.stringify({ event: 'project_gone_discard', projectId, batches, bytes }));
    return false;
  }

  /** 提前 drain 的帧读（IO 错误不阻断主路径——帧留待下次；正常态键集判定零 IO） */
  private async peekSpoolFrames(projectId: string): Promise<{ frameId: string; payload: Uint8Array }[]> {
    try { return this.spool.hasFrames(projectId) ? await this.spool.peek(projectId) : []; }
    catch (err) {
      this.logger.error(`spool peek failed for ${projectId}（帧跳过本次合并，留待下次）: ${(err as Error).message}`);
      return [];
    }
  }
  /** V12 降级态取帧（与 peek 同读——命名区分"即将并入 PG 尝试集"语义） */

  /** Y0a-2：gateway 直调点的串行包装（A14——库已持锁调钩子，钩子路径直通 Unlocked 禁再包） */
  private storeDocumentSerialized(p: Pick<onStoreDocumentPayload, 'document' | 'documentName'>): Promise<boolean> {
    return p.document.saveMutex.runExclusive(() => this.storeDocumentUnlocked(p));
  }

  /** V13+X9：受理面判据（**粒度修正：只读降级而非停服**——v2 的"三入口全拒"会把本地磁盘故障放大成
   *  全站画布不可读：readCanvas 走 withDoc、装载拒=重连风暴，均超出 spec §2.2"拒新写入"语义）。
   *  分层：draining=关停期拒一切新连接；spool 熔断=**只读化**（新连接放行但 readOnly——复用 :162 VIEWER
   *  机制+stateless persist-status 通告；存量连接不动——其批次由 BOI/V5' 承接）；
   *  loadDocument **永不 gate**；withDoc 只 gate 写意图。Y0a-3 的 /api/ready 消费同一方法。 */
  isShuttingDown(): boolean { return this.draining; }
  isWritableOrDegraded(): 'ok' | 'spool-unwritable' {
    return this.spool.isWritable() && !this.spool.overCapacity() ? 'ok' : 'spool-unwritable';
  }
```

（`isFkGone` 落 **`pg-error.util.ts`**（X15 新建独立 util——gateway/spool 双消费单源，防循环依赖；同处放 `isRetryableAppendError(e)` 供 append 超时分类）；`draining` 字段 Task 5 落。）

**X9 分层挂载**（本 Step 完成 authenticate；loadDocument **不挂**；CollabDocumentService 只挂写意图）：

```typescript
  // authenticate() try 块首行（token 判定之后、DB 查询之前）：
  if (this.isShuttingDown()) throw deny(CollabAuthReason.DRAINING, 'service restarting');   // 关停期拒新连接
  const spoolState = this.isWritableOrDegraded();
  if (spoolState !== 'ok') {
    connectionConfig.readOnly = true;          // X9：只读降级（复用 :162 机制——协议层拒写更新）
    this.broadcastSpoolDegraded(documentName); // Y9：独立通告通道（pushPersistStatus 有 persistUnhealthy 早退——spool 熔断不在其中=静默只读）
  }
```

**Y9：spool 降级通告 helper**（gateway 内新增——禁复用 pushPersistStatus：其语义=doc 级 store 失败横幅补推，首行早退；spool 是全局态）：

```typescript
  /** Y0a-2（X9/Y9）：spool 熔断的只读降级通告——best-effort（连接注册后 doc 才存在，500ms 延迟取；
   *  无 doc 则跳过，重连时 authenticate 再补）。客户端据此展示"暂存不可用"横幅——禁静默只读。 */
  private broadcastSpoolDegraded(documentName: string): void {
    const t = setTimeout(() => {
      const document = this.server.hocuspocus.documents.get(documentName);
      if (!document) return;
      try {
        document.broadcastStateless(JSON.stringify({ type: 'persist-status', healthy: false, reason: 'spool-unwritable' }));
      } catch (err) {
        this.logger.warn(`spool degraded broadcast failed for ${documentName}: ${(err as Error).message}`);
      }
    }, 500);
    t.unref?.();
  }
```

**配套用例（Task 3 Step 8 追加）**：spool 白盒置 ioBroken → kit.connect → 断言 ①连接成功（synced）②`(connection as any).readOnly === true`（经 provider 侧观察写更新被拒亦可）③1.5s 内收到 stateless `persist-status{healthy:false,reason:'spool-unwritable'}`（provider.on('stateless') 采集）——Y9 降级可见门。

（`collab-document.service.ts`：**只 gate 写意图**——`writeNodeData`/`writeExecStatus` 首行 `if (this.gateway.isWritableOrDegraded() !== 'ok') throw new ServiceUnavailableException('collab degraded: spool unwritable');`；**`readCanvas` 不 gate**（PG 健康+数据在 PG——本地磁盘故障不该挡读）；`withDoc` 本体不 gate（装载照常）。**CollabAuthReason 增 `DRAINING`**（X9——shared 封闭枚举+transient 档；复用 db-unavailable 会让客户端停止重连=方向错；`packages/shared/src/constants/collab-auth-reason.ts`+其两测试文件进 Task 3 冲击面清单——File Structure 补三文件。）

（V4/V22/X2：storeInFlight 维护对（**projectId 键控**——与队列归属同键；enter=Unlocked 取批路径；leave=**四落定点显式调用**（见 storeDocumentUnlocked 头注释）+Y2 兜底 catch+Y1 rearm/detached——非 try/finally 单点（v3 注释残留已清））：

```typescript
  private readonly inFlightProjects = new Set<string>();
  private enterInFlight(projectId: string): void {
    this.inFlightProjects.add(projectId);          // Set.add 幂等——重试再进入不双计（P5）
    storeInFlightDocs.set(this.inFlightProjects.size);
  }
  private leaveInFlight(projectId: string): void { // 唯一减点=归属落定/finally——drain force-spool 复用（契约 14）
    this.inFlightProjects.delete(projectId);
    storeInFlightDocs.set(this.inFlightProjects.size);
  }
```

（`collabLeaseLostTotal` 指标**移 Y0a-3**（V22——Y0a-2 fenced 不可达=无消费者死代码，Y0a-3 selfIsolate 同批落）；fenced 分支的 ERROR 日志与不排梯行为保留，BOI-2 用例照测。）

**stash 族退役**（`:252-274`）：`takeStash`/`putStash`/`peekStash`/`consumeStash` 四方法整删；字段 `:79` `unflushed` 整删。load 路径（`:227-228` 与 `:244`）改：

```typescript
      // Y0a-2：stash=spool 帧（peek→apply；帧不删——confirm 恒在 append 成功后，契约 12）。
      // apply 事件进 pending；帧的 confirm 出口=下次 store 提前 drain / 断连 flush / 启动回灌。
      for (const f of await this.peekSpoolFrames(projectId)) Y.applyUpdate(document, f.payload);
```

（`:244` `this.consumeStash(projectId)` 行整删——Y0a-1 用例"正常档消费后清空"语义随断言改造更新为"帧保留"。）

**retryPersist detached 分支重写**（`:396-398` 替换——X5：doc 已卸载后的队列/帧双通道恢复，消灭"队列静默停摆"）：

```typescript
      } else {
        // X5：detached 态（doc 不活/队列空）双通道——先看 gateway 队列（V4 后 doc 卸载队列仍在），
        // 再看 spool 帧；皆空才 cancel。队列通道=spool-first（写 spool 成功即归属落定，帧由后续三段式回灌）。
        const queue = this.pendingQueues.get(projectId);
        if (queue && queue.length > 0) {
          const n = queue.length;
          const payload = n === 1 ? queue[0] : Y.mergeUpdates(queue.slice(0, n));
          await this.spool.append(projectId, payload);           // 失败 throw 重走 catch 退避（不 cancel——批仍需保活）
          queue.splice(0, n);
          this.leaveInFlight(projectId);                         // Y1：detached 队列通道落定点②（批可能带着 Unlocked 留下的在飞标志进梯——此处落 spool 即落定）
        } else {
          const frames = await this.peekSpoolFrames(projectId);  // 帧通道=三段式（peek→append→confirm）
          if (frames.length === 0) { this.cancelPersistRetry(documentName); return; }
          for (const f of frames) {
            const r = await this.repo.append(projectId, f.payload);
            if (!r.ok) throw new Error(`append returned no row (${r.reason})`);   // 重走 catch 退避（帧未 confirm——安全）
            await this.spool.confirm(projectId, [f.frameId]);
          }
        }
      }
```

（doc 级路径 `:391` 的 `await this.storeDocument(...)` 改 `await this.storeDocumentSerialized(...)`。**X6 熔断自检**：`schedulePersistRetry` 首行加 `if (!this.spool.isWritable()) { this.retryPausedByCircuit = true; return; }`——熔断期不排程。）

**X5+Y1+Y10：rearmQueues 终形态**（新私有方法；调用点=onModuleInit 回灌后+`spool.onRecovered` seam 回调）：

```typescript
  /** X5：统一唤醒——"每个非空队列恒有恢复路径"单一不变量。Y1：覆盖面=pendingQueues 非空 ∪ spool.keys()
   *  （帧-only 滞留面：重启回灌预算耗尽残留/卸载交接后的帧——v3 只遍历队列会漏）；排程即清 inFlight
   *  （rearm 时旧 store 尝试已死——批带着标志滞留会永久抬 yjs_store_in_flight_docs；重试 enter 幂等重新置位）。 */
  private rearmQueues(): void {
    const ids = new Set<string>([
      ...[...this.pendingQueues.entries()].filter(([, q]) => q.length > 0).map(([pid]) => pid),
      ...this.spool.keys(),
    ]);
    for (const pid of ids) {
      this.leaveInFlight(pid);
      this.schedulePersistRetry(`project:${pid}`);
    }
    this.retryPausedByCircuit = false;
  }
```

（onModuleInit 回灌接线之后一行：`this.spool.onRecovered = () => this.rearmQueues();`——Y10 seam（幂等：schedulePersistRetry 对已有 timer return；probe 恢复/正常重启均安全调用）。R1 拒绝理由由此自洽：回灌失败项目经退避梯运行期自愈，无需独立后台 timer。）

**disconnect 改造**（`:419-435`）：

```typescript
  private async disconnect({ document, documentName }: onDisconnectPayload) {
    if (document.getConnectionsCount() > 0) return;
    const projectId = parseProjectId(documentName);
    // Y0a-2：storeDocument 不再 throw（BOI）——失败路径自处理（批在 spool/队列），stashPending 退役
    const wrote = await this.storeDocumentSerialized({ document, documentName });
    if (wrote) {
      try { await this.maybeCompact(projectId); }
      catch (err) {
        yjsStoreCompactFailureTotal.inc();
        this.logger.warn(`final compact failed for ${projectId}: ${(err as Error).message}`);
      }
    }
  }
```

（`stashPending` 方法 `:438-448` 整删；`onApplicationShutdown` `:549-561` 本 Task 不动——Task 5 重排。retryPersist doc 级 `:388-394` 的 retryingPersist 标志保留（档位取值归 retryPersist）。）

**storeInFlight gauge**（metrics 追加——V22 改名 doc 级口径量纲诚实）：

```typescript
/** Y0a-2（V22+X2）：flush-at-risk 口径（契约 14/P5）=承载"进过取批且未落定批次"的项目数——
 *  enter=storeDocumentUnlocked 取批路径开始；leave=**四落定点**（①append ok ②spool fsync 成功含降级/
 *  交接/force-spool ③FK 丢弃 ④project.gone 丢弃——Y1/retryPersist detached/意外异常兜底 leave 同源）；
 *  spool 失败回队列**不清**（批未落定）；drain force-spool 复用 leave 点；库去抖窗口不属此口径。 */
export const storeInFlightDocs = new Gauge({
  name: 'yjs_store_in_flight_docs', help: '进入取批未落定（append/spool）的项目数（G-2 断言对象；spec §5.2 表同批改名）', registers: [register],
});
```

- [x] **Step 7: 跑绿（BOI 三用例）**

```bash
pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab.gateway.spec.ts -t "BOI"
```
Expected: 3 用例 PASS（copy-first/fenced 判别消费/spool 承重）。

- [x] **Step 8: unflushed 断言改造（11 行断言+1 行装置——V20/F7）+行为断言改写（V18）+yjsUnflushedProjects 删除（V22）**

`store.metrics.ts` 的 `yjsUnflushedProjects`（`:22-26`）**整删**（V22——换义指标零消费者：删定义+gateway 三处 set 点随 stash 族退役自然消失；"待落库项目数"语义由 Task 4 的 `yjs_spool_depth_files` 覆盖；spec §5.2 变更随 Task 10 登记）。

**断言改造清单 A（unflushed 行——纪律 11 冲击面逐行；spool 引用=kit.spool/自建实例）**：

| 文件:行 | 旧断言 | 新断言 |
|---|---|---|
| persist-status.spec:110-122（stash 级用例） | `(gateway as any).unflushed.get('p1')` truthy/`.has` false | `await kit.spool.peek('p1')` 非空/空（用例语义不变：失败后数据还在） |
| gateway.spec:587 | `unflushed.get('p1')` truthy（兜底生效注释） | `await spool.peek('p1')` 非空 |
| gateway.spec:609-625（绿8 全链） | `:620 get/:625 has` | 同上 peek 替换；"store 落库"步骤后断言 peek 空（段回收）或帧 confirm |
| gateway.spec:644-647（绿8b） | `:644 get/:647 has` | peek 替换 |
| gateway.spec:658-661（绿8c 快照同源） | `:658 unflushed.set('p1', ...)` 预置（**装置行**） | `await spool.append('p1', <同 payload>)` 预置；`:661 has false` 改"帧保留至 append 成功"（load 后 peek 仍非空——Y0a-1"消费后清空"语义随契约 12 反转，用例名与断言同步改写） |
| gateway.spec:677/681（Y0a-1 peek/consume 用例） | `unflushed.has('p-peek')` true/false | 版本门拒档：`spool.peek` 非空（帧存活）；正常档：**仍非空**（帧保留至下次 store 确认——用例改写为"apply 后帧保留，confirm 出口=下次 store"并追加一次 storeDocument 直调断言 confirm 后 peek 空） |
| gateway.spec:731 | `unflushed.has('p1')` false | `spool.peek('p1')` 空 |

**断言改造清单 B（V18 行为断言——v1 漏列，不改则 Step 9 全量必红）**：

| 文件:行 | 旧断言（现状实读） | 新断言 |
|---|---|---|
| gateway.spec 绿9（:684-695） | 注释"第 65 条时折为 1"+`toHaveBeenCalledTimes(1)`（折叠+drain 合并单行） | **禁折叠**：70 条全留队列（`queue.length===70`——在 setImmediate flush 前断言）+折叠注释改"计数阈触发 setImmediate 提前 flush"；`toHaveBeenCalledTimes(1)` 兼容保留（flush/直调合并仍单行）——时序说明写进用例（await 直调先于 setImmediate check 阶段） |
| gateway.spec 绿9b（:697-714） | `await expect(storePromise).rejects.toThrow('db down')`（**:709——契约 3"不 throw"直接反转，必红点**） | `await expect(storePromise).resolves.toBe(false)`+失败批仍在队列（`queue.length>0` 兼容）+重试成功后净空断言不变 |
| persist-status.spec:88 | `expect(repo.append).not.toHaveBeenCalled()`（注释"第 5 档已耗尽：无第 6 个定时器"） | 退避无上限（Task 4）：rung≥5 仍重排——断言改 `entry.timer` 真值（先 `clearTimeout(entry.timer); entry.timer=null` 再推 rung 重排——V17⑤）；用例名与注释同步（"耗尽"语义删除） |
| **expectDurableEquivalent 辅助体（gateway.spec:102-105）** | `(gateway as any).pendingUpdates.get(doc)`+`expect(pending).toBeDefined()` | **Y4（v3 漏列——4+ 用例（绿2/3/9/9b/10）的唯一断言入口，改名后恒 undefined=塌一片）**：改两跳 `(g).pendingQueues.get((g).docProject.get(doc))`（真路径用例 docProject 已播种）；前置断言保留（防 vacuous） |
| 全部直插 `pendingUpdates` 的装置与断言 | 逐处 | **Y4：以 `grep -n "pendingUpdates" src/modules/collab/*.spec.ts` 输出为清单逐行对表**（当前 18 处——v3 的"15 处"数字在 Task 3 改完后即失效；数字不作承诺，grep 结果为准）——装置改 `(g).pendingQueues.set(projectId, [...])`、断言改按 projectId 取；computePending/drain 断言参与用例禁裸 Y.Doc 直插（B2） |

**V19 红相层注记**：BOI-1/2/3 白盒直调保留（测 storeDocumentUnlocked 自身语义——直调不经库 debouncer/saveMutex 包裹，标注"白盒层"）；**崩溃模拟红相**追加（红相层，对旧实现红）：

```typescript
  it('BOI-4 崩溃模拟（V19 红相层）：append 失败→丢弃 gateway 实例（等价进程死）→同 spool 目录新 gateway→批可回灌（旧实现批在内存=红）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-boi4-');
    try {
      const repo = failingRepo({ failAppend: 99 });
      const kit1 = await startDualClientServer({ append: repo.append }, 200, new CollabSpoolService(dir));
      const { provider, synced } = kit1.connect('project:p-boi4');
      await synced;
      provider.document.getMap('nodes').set('k', new Y.Map([['x', 1]]));
      await pollUntil(() => kit1.repo.append.mock.calls.length >= 1, 5_000);   // 失败已发生→批已入 spool
      await provider.destroy();
      await kit1.dispose();                     // 丢弃实例=进程死（内存 unflushed/队列随之消失——旧实现红相源）
      const kit2 = await startDualClientServer({}, 200, new CollabSpoolService(dir));
      await kit2.gateway.onModuleInit();        // scan+replayAll：spool 帧回灌 PG（mock append ok）
      await pollUntil(async () => (await new CollabSpoolService(dir).peek('p-boi4')).length === 0, 5_000);   // 段回收
      const q = kit2.repo.append.mock.calls;    // 回灌 append 的 payload 含所写节点
      const revived = new Y.Doc();
      for (const c of q) Y.applyUpdate(revived, new Uint8Array(c[1]));
      expect(revived.getMap('nodes').has('k')).toBe(true);   // 批经 spool 存活——旧实现（内存）必红
      await kit2.dispose();
    } finally { await cleanup(); }
  });
```

- [x] **Step 9: collab 全量回归+verify+commit**

```bash
pnpm --filter @flowweb/api exec vitest run src/modules/collab && pnpm verify
```
Expected: collab 全量绿（含 5 个直构 spec 构造点改造）；verify 全绿。

```bash
git add apps/api/src/modules/collab apps/api/src/test-utils && git commit -m "feat(collab): Y0a-2 BOI 重写——copy-first+AppendResult 判别消费+任何路径不 throw+spool 单源接线（删内存 unflushed Map）+saveMutex 直调串行+storeInFlight（三代红相留档）"
```

> **Task 3 执行勘误（2026-10-07 实现裁定，commits `64a72f37`+`c9663e18`；两阶段审查+修复复核毕）**——Task 4+ 消费者以此为准：
> **实现适配 10 项**：①TS1016——必填 spool 不能随可选参数，前置可选参改 `T | undefined` 显式+@Optional 保留（漏参仍编译红）；②BOI-2 队列断言 1→**0**（plan 自相矛盾：fenced 失败路径批迁 spool 后队列被 splice 清空——红相判别由 peek 断言承担）；③BOI-4 改 `kit2.spool.scan()` 显式+同实例 peek（plan 的 `new CollabSpoolService(dir).peek` 新实例 index 空=恒真假绿；kit 构造已调 onModuleInit 二次调用 EADDRINUSE）；④A14 用 `server.hocuspocus.openDirectConnection`（库不透传）；⑤append mock 补 `{ok:true,seq:1n}` 返回（判别消费下 undefined=TypeError 连片红）；⑥persist-status 两用例 useRealTimers+pollUntil（帧通道真实 fs IO 与 fake timers 冲突）；⑦BOI-3 首 peek 改 pollUntil（append 调用先于 spool fsync 的竞速）；⑧onDisconnect 直调夹具 11 处 Y.Doc→真 Document（saveMutex 载体）；⑨deletedProjects/draining 惰性落位（空集/常 false+注释归属 T5/T6）；⑩kit 返回 spool+dispose 只清自建目录。
> **质量审查修复 3 Important（c9663e18，红先行）**：**I-1** retryPersist doc 级消费布尔（false→throw 进 catch 梯——旧形态无条件 cancel+healthy=批滞留时误广播已保存+杀重试定时器；plan 代码块同形缺陷）+两处自排点恢复 `!retryingPersist` 守卫；**I-2** 三处 splice 身份判据**命中跳过 splice**（appended 支/V12 降级支 tailRef0/spool 兜底支 tailRef2——plan 的"判据命中仍 splice"在折并交织窗删含快照后内容的合并元素=丢更新；跳过后批留队重发 CRDT 幂等吸收）；**I-3** 容量恢复缝（spool confirm 末尾滞回自评≤90% 解除+onRecovered 唤醒——confirm=depth 回落观测点；append 解除支对称补 onRecovered；**X6 条件改 `!isWritable() && !overCapacity()`**——仅 ioBroken 停排：容量态下 PG 可消化帧，梯子继续=自愈通道，否则 X9 readOnly 挡编辑+无 store+spool 无人消化=恢复后半瘫死锁）。
> **Minor 收口**：M1 draining 白盒用例/M2 降级支 spool 失败对称化（局部 catch 不上抛 Y2）/M7 `_document`/M8 BOI-1 release 挪 finally。**登记**：M3（retryPersist 帧通道无 isFkGone 收割——Task 6 审查核对）/M5（readOnly 无恢复翻转+恢复无 stateless 通告——客户端体验债，Y0b）/M6（pendingQueues 空条目回收——Task 6 顺手）/降级支 catch 的 schedulePersistRetry 缺 `!retryingPersist` 守卫（档位节奏漂移无数据风险——Task 4 顺手一行）。
> **推迟项（controller 裁定）**：绿9 折叠断言保持旧语义随 Task 7（plan 清单 B 与 Task 7 分工矛盾——折叠删除在 T7，断言终态同批落）；persist-status :88 梯子"5 档耗尽"断言保持随 Task 4（退避无上限同批改）。红相三代：BOI-1/2 红落装置行（pendingQuenes 直插 TypeError——旧实现无该字段）、BOI-3 实质断言红（peek [] ≠1）——登记表如实标注。基线：collab 219/219 绿（25 files）。

---

### Task 4: 退避无上限+afterStoreDocument 最小对账+computePending+pending 观测（collect 注册模式）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`
- Modify: `apps/api/src/modules/collab/store.metrics.ts`
- Test: `apps/api/src/modules/collab/collab.gateway.spec.ts`（追加）+`collab.gateway.persist-status.spec.ts`（追加）

- [x] **Step 1: 写失败测试**

`collab.gateway.spec.ts` 追加：

```typescript
describe('Y0a-2 退避无上限+afterStoreDocument 对账+computePending', () => {
  it('persistRetryDelayMs 纯函数：前 5 档 [1,2,5,15,30]s，rung≥5 恒 60s（永不耗尽——锚 A5：库不补）', async () => {
    const { persistRetryDelayMs } = await import('./collab.gateway');
    expect([0, 1, 2, 3, 4].map(persistRetryDelayMs)).toEqual([1_000, 2_000, 5_000, 15_000, 30_000]);
    expect(persistRetryDelayMs(5)).toBe(60_000);
    expect(persistRetryDelayMs(999)).toBe(60_000);
  });

  it('持续失败不弃批：append 永败+spool 可用 → 退避排程永不耗尽（persistRetry 条目常在且重排）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-retry-');
    try {
      const repo = failingRepo({ failAppend: 99 });
      const spool = new CollabSpoolService(dir);
      const kit = await startDualClientServer({ append: repo.append }, 10_000 /* 大 debounce：只走 retry 梯 */, spool);
      try {
        const doc = new Y.Doc();
        const name = 'project:p-retry';
        (kit.gateway as any).pendingQueues.set('p-retry', [new Uint8Array([1])]);   // Y19：projectId 键控装置
        const r1 = await kit.gateway.hooks.onStoreDocument({ document: doc, documentName: name });
        expect(r1).toBe(false);
        // 第一次失败即入 spool（BOI）+排程——spool 键命中 ⇒ 本用例只验证"排程不耗尽"：
        // 手工把 rung 推到 5+（模拟多轮失败）再断言 schedulePersistRetry 仍重排
        const entry = (kit.gateway as any).persistRetry.get(name);
        expect(entry).toBeTruthy();
        entry.rung = 7;
        (kit.gateway as any).schedulePersistRetry(name);
        const entry2 = (kit.gateway as any).persistRetry.get(name);
        expect(entry2.timer).toBeTruthy();     // rung 7 仍重排（旧实现 :364 耗尽 return → timer null=红）
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  });

  it('V22 afterStoreDocument=存活计数（yjs_store_hook_calls_total）；去抖窗新写入零误报（v1 判据已撤——真对账=Task 3 splice 点自检）', async () => {
    const kit = await startDualClientServer();
    try {
      const reg = (await import('prom-client')).register;
      const callsBefore = (await reg.getSingleMetric('yjs_store_hook_calls_total')!.get()).values[0]?.value ?? 0;
      const g = kit.gateway as any;
      const doc = new Y.Doc();
      g.docProject.set(doc, 'p-tail'); g.pendingQueues.set('p-tail', [new Uint8Array([1])]);
      await kit.gateway.hooks.onStoreDocument({ document: doc, documentName: 'project:p-tail' });   // append ok→队列清空
      await kit.gateway.hooks.afterStoreDocument({ document: doc, documentName: 'project:p-tail' });
      const callsAfter = (await reg.getSingleMetric('yjs_store_hook_calls_total')!.get()).values[0]?.value ?? 0;
      expect(callsAfter - callsBefore).toBe(1);          // 存活计数（V17⑥：metric.get() 公开 API——hashMap 内部读取作废）
      const q = g.pendingQueues.get('p-tail') as Uint8Array[];
      q.push(new Uint8Array([2]));                       // 白盒模拟 store 完成后去抖窗内新写入（合法归属）
      await kit.gateway.hooks.afterStoreDocument({ document: doc, documentName: 'project:p-tail' });
      const anomaly = (await reg.getSingleMetric('yjs_store_tail_anomaly_total')!.get()).values[0]?.value ?? 0;
      expect(anomaly).toBe(0);                           // 零误报（v1 判据在此场景必计 1=红——判据已撤）
    } finally { await kit.dispose(); }
  });

  it('computePending：projects=队列非空项目数/batches=条数（空条目不计）；spool 深度并入（G-1 演练的轮询面——P1/Y5）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-cp-');
    try {
      const spool = new CollabSpoolService(dir);
      await spool.append('p-cp', new Uint8Array([1, 1]));
      const kit = await startDualClientServer({}, 300, spool);
      try {
        const g = kit.gateway as any;
        g.pendingQueues.set('pd1', [new Uint8Array([1]), new Uint8Array([2])]);
        g.pendingQueues.set('pd2', []);   // 空条目不计 projects（验证语义）
        const p = g.computePending();
        expect(p).toMatchObject({ projects: 1, batches: 2, spoolFiles: 1, spoolBytes: 8 + 2 });
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  });
});
```

（`spoolBytes: 8+2`=帧头+payload——computePending 经 spool.depth()；Y19：装置只插 pendingQueues——computePending 遍历自有 Map，**不读库 documents Map**（B2 单源），故无需再插 doc。）

- [x] **Step 2: 跑红**

```bash
pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab.gateway.spec.ts -t "Y0a-2"
```
Expected: FAIL（`persistRetryDelayMs` 未导出/hooks.afterStoreDocument undefined/computePending is not a function；耗尽用例 rung=7 timer null=红）。留档。

- [x] **Step 3: 实现**

`collab.gateway.ts`：

```typescript
/** Y0a-2：退避无上限（v2.4 §2.3——重试梯永不"耗尽"：spool 已保底，梯子只加速恢复；封顶 60s） */
export function persistRetryDelayMs(rung: number): number {
  const table = [1_000, 2_000, 5_000, 15_000, 30_000];
  return rung < table.length ? table[rung] : 60_000;
}
```

（`:32-34` `PERSIST_RETRY_DELAYS_MS` 数组**整删**；`schedulePersistRetry:361-371` 的耗尽 `return` 行删+delay 改 `persistRetryDelayMs(entry.rung)`；`retryPersist:402-411` catch 的 `if (entry.rung >= …) { cancel… exhausted… }` 分支删——改恒 `this.schedulePersistRetry(documentName)`+日志去 exhausted 措辞；引用数组的注释/断言同步清理。）

hooks 对象（`:80-85`）扩 `afterStoreDocument`（构造 Server 配置同步加 `afterStoreDocument: this.hooks.afterStoreDocument`）：

```typescript
  /** Y0a-2（V22 收缩）：afterStoreDocument=**存活计数探针**（yjs_store_hook_calls_total——钩子链健康面）。
   *  v1 的"队列非空∧非 spool 键"对账判据**撤**（去抖窗内正常新写入必命中=纯噪声——外审 E4 成立）；
   *  真对账=Task 3 storeDocumentUnlocked 成功路径的 **splice 点队首前进自检**（零误报）。
   *  钩子体 try/catch 永不抛（在库 saveMutex 锁内执行——A14）。 */
  private async afterStoreDocument(_p: { document: Y.Doc; documentName: string }): Promise<void> {
    try { yjsStoreHookCallsTotal.inc(); } catch { /* 探针钩子永不抛 */ }
  }

  /** Y0a-2（P1+V4 单源派生+Y5 键名）：pending 快照——遍历**自有 pendingQueues**（B2：不依赖库
   *  documents Map，测试与生产同构）；字段 `projects`（按 projectId 计——drain/日志/用例/drill 同名消费）；
   *  G-1/G-2 演练轮询面（/api/metrics collect 回调）+Y0a-3 /api/ready.pending 消费同一实现 */
  computePending(): { projects: number; batches: number; spoolFiles: number; spoolBytes: number } {
    let projects = 0, batches = 0;
    for (const q of this.pendingQueues.values()) {
      if (q.length > 0) { projects += 1; batches += q.length; }
    }
    const d = this.spool.depth();
    return { projects, batches, spoolFiles: d.files, spoolBytes: d.bytes };
  }
```

（类型注记：hooks 对象的 afterStoreDocument 签名用 `afterStoreDocumentPayload`——import type 补；实现参数按仓库惯例窄化 `Pick<…, 'document' | 'documentName'>` 同 storeDocument。）

`store.metrics.ts` 追加（collect 注册模式——yjsUnflushedProjects/yjsSpoolDepth\* 同批改 collect）：

```typescript
/** Y0a-2：pending 快照 gauges（P1——采集时现算，零手动维护点）。
 *  Y5：字段/指标名统一 projects 口径（V4 后按 projectId 计——字段名诚实；drill barrier 同步读
 *  yjs_pending_projects）。G-1/G-2 演练经 /api/metrics 轮询；Y0a-3 /api/ready.pending 消费同一 computePending()。
 *  稳态行为（spec §3.3）：活跃编辑时 batches>0 恒成立——只能作"停止写入后是否排空"的判据。 */
type PendingSnapshot = { projects: number; batches: number; spoolFiles: number; spoolBytes: number };
let pendingCollector: (() => PendingSnapshot) | null = null;
export function registerPendingCollector(fn: () => PendingSnapshot): void { pendingCollector = fn; }
export function unregisterPendingCollector(): void { pendingCollector = null; }   // Y5：onApplicationShutdown 调用——防多 gateway 覆盖+destroy 后闭包悬挂（v3 只在注记提未导出）
export const yjsPendingProjects = new Gauge({
  name: 'yjs_pending_projects', help: 'pending 队列非空的项目数（G-1 演练 quiescence 判据；Y0a-3 ready.pending.projects 同源）',
  registers: [register],
  collect() { try { this.set(pendingCollector?.().projects ?? 0); } catch { this.set(0); } },   // X17：collect 体 try/catch——scrape 崩=整个 /api/metrics 500
});
export const yjsPendingBatches = new Gauge({
  name: 'yjs_pending_batches', help: 'pending 队列 update 条数（update 条数口径，非合并后批数——与 storeInFlight 不同量纲）',
  registers: [register],
  collect() { try { this.set(pendingCollector?.().batches ?? 0); } catch { this.set(0); } },
});
export const yjsStoreTailAnomalyTotal = new Counter({
  name: 'yjs_store_tail_anomaly_total', help: '取批后队列被并发改动（splice 前 length<n 或批尾引用不符——Y8）的探测计数；真对账=storeDocument 成功路径自检', registers: [register],
});
export const yjsStoreHookCallsTotal = new Counter({
  name: 'yjs_store_hook_calls_total', help: 'afterStoreDocument 钩子链存活计数（V22 收缩形态——库钩子健康面）', registers: [register],
});
```

（X11/X17/Y5：**`yjsUnflushedProjects` 定义整删**（V22——"待落库项目数"语义由 depthFiles 覆盖）；`yjsSpoolDepthFiles`/`yjsSpoolDepthBytes` 两 gauge 改 collect 形态——各加 `collect() { try { const p = pendingCollector?.(); this.set(p ? p.spoolFiles : 0); } catch { this.set(0); } }`（bytes 同理——X17 collect 体 try/catch 防 scrape 500）；gateway 构造函数尾行加 `registerPendingCollector(() => this.computePending())`；`computePending` 的 `projects` 键名与 pending gauge 改名**均已落上方代码块**——drain/日志/用例/drill 消费点同步（Task 5/9/10），spec §5.2 随 Task 10 登记。）

**onModuleInit 回灌接线（spec §2.2：启动回灌先于一切对外服务——Task 4 补）**：`onModuleInit`（`:450-459`）开头（`await this.server.listen()` **之前**）插：

```typescript
    // Y0a-2：启动回灌（先于 listen——fail-closed：先服务后回灌=第二次撕裂）。坏帧 scan 报告→隔离处置；
    // 回灌失败不阻塞启动（帧保留待下次+自检点名）；FK 帧收割（P2003）随 replayAll。
    const { truncatedSegments } = await this.spool.scan();
    let quarantined = 0;
    for (const seg of truncatedSegments) {
      const projectId = seg.replace(/\.\d+\.spool$/, '');
      quarantined += await this.spool.quarantineTruncatedFrames(projectId);
    }
    const replay = await this.spool.replayAll(this.repo);
    if (quarantined > 0 || replay.failed > 0) {
      // 启动自检（spec §5.2 口径——ERROR 结构化日志；Y0a-3 起随 ready.spoolQuarantined 可见）
      this.logger.error(JSON.stringify({ event: 'spool_startup_selfcheck', quarantined, replayFailed: replay.failed, replayed: replay.replayed, discarded: replay.discarded, truncatedSegments }));
    }
```

（直构 spec 不调 onModuleInit 的用例零影响；调用的（kit/auth-reason）走空目录 scan+replayAll(mock append ok)——无害且即回灌路径回归。）

- [x] **Step 4: 跑绿+回归+commit**

```bash
pnpm --filter @flowweb/api exec vitest run src/modules/collab && pnpm verify
```
Expected: collab 全量绿（persist-status 的退避梯断言若引用旧数组常量——Step 3 已随 grep 清单同步改写；grep `PERSIST_RETRY_DELAYS_MS` 全仓零残留）。

```bash
git add apps/api/src/modules/collab && git commit -m "feat(collab): Y0a-2 退避无上限(60s 封顶)+afterStoreDocument 最小对账+computePending+pending gauges(collect 注册模式)"
```

> **Task 4 执行勘误（2026-10-07 实现裁定，commits `885189c3`+`26f98baa`；两阶段审查+修复复核毕）**——Task 5+ 消费者以此为准：
> **适配 7 项**：①梯子用例单一 fake 会话+模块级 realSetTimeout/realSleep（useRealTimers 切换杀在途 fake 定时器=链断裂）；②rung 断言下界 ≥5（60s 窗级联容忍）；③V22 anomaly 断言 delta 形态（I-2 用例先行推高全局 counter）；④computePending 用例装置在 kit 起动后（onModuleInit 回灌消费前置帧=假红）；⑤V17⑤ 前清 timer 防早退恒真；⑥quarantined `+=` 累积（plan 代码块笔误）；⑦unregisterPendingCollector 提前至 onApplicationShutdown 首行（**Task 5 重写时按 plan 移回 destroy race 后**——恢复 drain 期 pending 可观测性，M4 裁定）。
> **质量审查修复（26f98baa，红先行）**：**I-1** onModuleInit 回灌后补 `this.rearmQueues();`（plan X5"必修"在 T4 交付中漏落——回灌失败项目曾无梯子条目=depth 永续>0）；**I-2** `retryingPersist` 单布尔改 `retryingPersistDocs: Set<string>`（per-documentName——单布尔时 A 梯在飞罩住 B 项目首次失败=跨项目不排梯停摆窗）；M-1 validateDir 启动日志调用点（spool_dir 事件）/M-2 unregister 后 gauge 0 用例/M-3 depth help 措辞。
> **登记**：I-3（retryPersist catch 无 fenced 感知——在梯项目转 fenced 后永续重排违契约 15；本批 fenced 不可达，**Task 10 Y0a-3 必办**与 selfIsolate 同点处置）。基线：collab **226/226** 绿。

---

### Task 5: 关停 drain 六步（预算 ≤22s+force-spool+结构化日志+destroy 超时分型）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts:549-561`
- Test: `apps/api/src/modules/collab/collab.gateway.shutdown.spec.ts`（重写+追加）

- [x] **Step 1: 写失败测试（drain 主路径/force-spool/undrained 点名/destroy 分型）**

`collab.gateway.shutdown.spec.ts` 重写（既有 8s race 用例随六步改造——`new CollabGateway` 构造点已随 Task 3 补 spool）：

```typescript
import { describe, it, expect, vi, afterAll } from 'vitest';
import * as Y from 'yjs';
import { CollabSpoolService } from './collab-spool.service';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { startDualClientServer } from '../../test-utils/dual-client-server';
import { createMockRepo } from '../../test-utils/mock-repo';
import { failingRepo } from '../../test-utils/failing-repo';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const c of cleanups) await c(); });

/** Y16：spy 必须**动作前**安装（v3 在 shutdown 之后装——mock.calls 恒空=日志断言全假绿）。
 *  install → 跑 onApplicationShutdown → collectEvents 三段式。 */
function installLogSpies(gateway: any) {
  return {
    log: vi.spyOn(gateway.logger, 'log'),
    warn: vi.spyOn(gateway.logger, 'warn'),
    error: vi.spyOn(gateway.logger, 'error'),
  };
}
function collectEvents(spies: ReturnType<typeof installLogSpies>): any[] {
  const out: any[] = [];
  for (const spy of [spies.log, spies.warn, spies.error]) {
    for (const c of spy.mock.calls) {
      const s = String(c[0]);
      const m = /\{"event":"([a-z_]+)".*/.exec(s);
      if (m) out.push(JSON.parse(s.slice(s.indexOf('{'))));
    }
  }
  return out;
}

/** Y19：装置=projectId 键控 pendingQueues（V4）+documents Map 保留（drain 循环经它取 document 走
 *  storeDocumentSerialized——detached 路径只灌帧，队列批出口=store/force-spool）+**saveMutex stub**
 *  （裸 Y.Doc 无 saveMutex——drain 取出直调 runExclusive 会 TypeError；stub 直执行 fn）。 */
async function seedPendingDoc(kit: any, name: string, updates: number): Promise<Y.Doc> {
  const projectId = name.replace(/^project:/, '');
  const doc = Object.assign(new Y.Doc(), { saveMutex: { runExclusive: <T,>(fn: () => Promise<T>) => fn() } }) as Y.Doc;
  const q: Uint8Array[] = Array.from({ length: updates }, (_, i) => new Uint8Array([i + 1]));
  (kit.gateway as any).pendingQueues.set(projectId, q);
  (kit.gateway as any).docProject.set(doc, projectId);
  kit.gateway.server.hocuspocus.documents.set(name, doc);
  return doc;
}

describe('Y0a-2 关停 drain 六步（spec v2.4 §2.4——预算 ≤22s；G-2a 双档）', () => {
  it('drain 主路径：pending 批全部 append 落 PG → shutdown_drain_complete 日志 pending 全 0（G-2a i 档）', async () => {
    const kit = await startDualClientServer();   // append 工厂默认 ok:true
    try {
      const spies = installLogSpies(kit.gateway);   // Y16：动作前安装
      await seedPendingDoc(kit, 'project:p-dr1', 3);
      await seedPendingDoc(kit, 'project:p-dr2', 1);
      await kit.gateway.onApplicationShutdown();
      expect(kit.repo.append).toHaveBeenCalledTimes(2);        // 两项目各一批单行 append
      const events = collectEvents(spies);
      const done = events.find((e) => e.event === 'shutdown_drain_complete');
      expect(done).toMatchObject({ pending: { projects: 0, batches: 0 } });   // Y5：projects 键名
      expect(done.storeInFlight).toBe(0);
    } finally { await kit.dispose(); }
  });

  it('drain force-spool：append 失败+spool 可用 → 批入 spool（归属落定）→ drain_complete pending.projects===0（批已出队列）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-shut2-'); cleanups.push(cleanup);
    const spool = new CollabSpoolService(dir);
    const kit = await startDualClientServer({ append: failingRepo({ failAppend: 99 }).append }, 300, spool);
    try {
      const spies = installLogSpies(kit.gateway);
      await seedPendingDoc(kit, 'project:p-dr3', 2);
      await kit.gateway.onApplicationShutdown();
      expect(await spool.peek('p-dr3')).toHaveLength(1);       // 批在 spool（磁盘）
      const events = collectEvents(spies);
      const done = events.find((e) => e.event === 'shutdown_drain_complete');
      expect(done).toBeTruthy();
      expect(done.pending.projects).toBe(0);
    } finally { await kit.dispose(); }
  });

  it('G-2a ii 档：append 失败+spool 不可写 → shutdown_undrained 点名（batches/projects 与 storeInFlight 一致；不得声称 0）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-shut3-'); cleanups.push(cleanup);
    const spool = new CollabSpoolService(dir);
    (spool as any).overCapacityFlag = true;                    // Y14：服务态容量位注入——append 恒抛且不触盘（mkdir 段路径占位会被 V2 封段滚动绕过：seg0 EISDIR→seg1 可写=注入失效）
    const kit = await startDualClientServer({ append: failingRepo({ failAppend: 99 }).append }, 300, spool);
    try {
      const spies = installLogSpies(kit.gateway);
      await seedPendingDoc(kit, 'project:p-dr4', 2);
      await kit.gateway.onApplicationShutdown();
      const events = collectEvents(spies);
      const undrained = events.find((e) => e.event === 'shutdown_undrained');
      expect(undrained).toMatchObject({ batches: 2, projects: 1 });   // 如实点名（Y5 键名）
      expect(undrained.storeInFlight).toBe(1);                        // 与 projects 一致（P5 口径——spool 失败不清标志）
    } finally { await kit.dispose(); }
  });

  it('destroy 超时分型：destroy 挂起+pending 已清 → destroy_timeout hangReason=direct-open；未清 → store-undrained', async () => {
    const kit = await startDualClientServer();
    try {
      const spies = installLogSpies(kit.gateway);
      await seedPendingDoc(kit, 'project:p-dr5', 1);
      vi.spyOn(kit.gateway.server, 'destroy').mockImplementation(() => new Promise<void>(() => {}) as any);
      await kit.gateway.onApplicationShutdown();
      const events = collectEvents(spies);
      const timeout = events.find((e) => e.event === 'destroy_timeout');
      expect(timeout).toBeTruthy();
      expect(['store-undrained', 'direct-open']).toContain(timeout.hangReason);
      expect(typeof timeout.storeInFlight).toBe('number');
    } finally {
      vi.restoreAllMocks();   // Y13：先还原 destroy mock——否则 dispose 的 server.destroy 仍挂起=整套用例超时
      await kit.dispose();
    }
  });

  it('总预算：正常档关停全程 ≤22s（本地实测断言——kill_timeout 30s 余量 ≥8s 由 Y0a-4 ecosystem 承载）', async () => {
    const kit = await startDualClientServer();
    try {
      const t0 = Date.now();
      await kit.gateway.onApplicationShutdown();
      expect(Date.now() - t0).toBeLessThan(22_000);
    } finally { await kit.dispose(); }
  });
});
```

- [x] **Step 2: 跑红**

```bash
pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab.gateway.shutdown.spec.ts
```
Expected: FAIL（现实现无 drain/无结构化日志——`shutdown_drain_complete` undefined；批留队列被 destroy 丢弃）。留档。

- [x] **Step 3: 实现 onApplicationShutdown 六步重排**

替换 `:549-561`：

```typescript
  /** Y0a-2 关停 drain 六步（spec v2.4 §2.4 预算表：直连宽限 ≤2s+flush ≤6s+自管 drain+force-spool 硬界
   *  t0+18s+race ≤4s=合计 ≤22s——Y12：hardDeadline 18s（22s+4s=26s 破表），kill_timeout 30s 内垫 ≥8s
   *  ——ecosystem Y0a-4）。G-2a：归属要么落定、要么被如实点名（禁声称 0）。
   *  步骤 6（租约显式释放 ≤2s）Y0a-3 落地——本批占位注释（v2.4"必须执行到"约束随租约同批）。 */
  private draining = false;   // 与 Y0a-3 /api/drain 同一状态位（幂等；内存态）

  async onApplicationShutdown(): Promise<void> {
    const t0 = Date.now();
    this.draining = true;                                                        // 步骤 1：停收新写（就绪门对接 Y0a-3）
    if (this.sessionSweepTimer) { clearInterval(this.sessionSweepTimer); this.sessionSweepTimer = null; }
    for (const [name] of [...this.persistRetry]) this.cancelPersistRetry(name);  // 定时器随停——drain 主动接管
    await this.graceDirectConnections(2_000);                                    // 在飞直连宽限（A3：directConnectionsCount）
    this.closeAllConnections1012();                                              // 步骤 2：瞬时
    this.server.hocuspocus.flushPendingStores();                                 // 步骤 3：库 debounce 队列（同步触发）
    await this.pollPendingDrained(6_000);                                        // ≤6s 排空窗口（只管"仍在 debounce 中"的 store——主力是步骤 4）
    await this.drainAllDocuments(t0 + 18_000);                                   // 步骤 4：自管 drain+force-spool（X7+Y12——硬界 18s，其后 4s race 收在 22s）
    let destroyed = false;                                                       // 步骤 5：destroy 与 4s race（兜底）
    const destroying = this.server.destroy()
      .then(() => { destroyed = true; })
      .catch((err) => this.logger.warn(`collab server destroy failed: ${(err as Error).message}`));
    await Promise.race([destroying, new Promise<void>((r) => { setTimeout(r, 4_000).unref?.(); })]);
    if (!destroyed) {
      const p = this.computePending();
      const hangReason = p.projects > 0 || p.batches > 0 ? 'store-undrained' : 'direct-open';   // 分型（v2.4；Y5 键名）
      this.logger.error(JSON.stringify({ event: 'destroy_timeout', ...p, storeInFlight: this.inFlightProjects.size, hangReason }));
    }
    unregisterPendingCollector();   // Y5：collect 闭包随 gateway 死——防多实例覆盖+悬挂
    // 步骤 6（≤2s）：租约显式释放——Y0a-3（deploy 不等 TTL；SIGKILL 截断则下实例吃满 TTL=RTO）
    this.logger.log(JSON.stringify({ event: 'shutdown_complete', elapsedMs: Date.now() - t0 }));
  }

  /** V9：在飞直连宽限——**入口先判**（无直连立即归还，消灭"每次重启无条件多 2s"）；轮询期间
   *  directConnectionsCount 归零即返（A3——closeAllConnections1012 只遍历 WS 不触 direct）。 */
  private async graceDirectConnections(budgetMs: number): Promise<void> {
    const count = () => { let n = 0; for (const d of this.server.hocuspocus.documents.values()) n += d.directConnectionsCount ?? 0; return n; };
    if (count() === 0) return;                                   // V9：常见路径零成本
    const t0 = Date.now();
    while (Date.now() - t0 < budgetMs) {
      if (count() === 0) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private async pollPendingDrained(budgetMs: number): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < budgetMs) {
      const p = this.computePending();
      if (p.projects === 0 && p.batches === 0) return;   // Y5：projects 键名（v3 此处读 p.docs=改名后恒 undefined）
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** 自管 drain（步骤 4 主力）——X7+Y12：hardDeadline（t0+18s）透传+两级闸（总闸 8s 遍历预算+每 doc
   *  min(2s, remaining) race）；drain 循环内 peekSpoolFrames 套 500ms race（磁盘挂起穿透防护）；
   *  force-spool **每次 append 套 Promise.race 可切断+按返回值判定**（J5：`ids!==null` 才 splice——
   *  race 超时且 append 实际失败时 splice=批蒸发；超时后成功=重复帧由 CRDT 幂等吸收，宁可重复不误删）。
   *  **race 超时分支不 leave**（Y12 修正 X7 注记错误：超时=store 挂起=批未落定=undrained 点名应含它——
   *  leave 会破坏 G-2a ii 的 storeInFlight===projects 断言；仅 catch（意外异常）leave）。
   *  G-2a：归属要么落定、要么被如实点名。 */
  private async drainAllDocuments(hardDeadline: number): Promise<void> {
    const drainStart = Date.now();
    for (const [projectId, q] of [...this.pendingQueues]) {      // V4：单源遍历
      if (Date.now() - drainStart > 8_000) break;                // X7：总闸——剩余转 force-spool
      const frames = await this.raceDeadline(this.peekSpoolFrames(projectId), 500, []);   // 磁盘挂起防护
      if (q.length === 0 && frames.length === 0) continue;
      const name = `project:${projectId}`;
      const document = this.server.hocuspocus.documents.get(name);
      if (!document) {
        await this.drainDetachedProject(projectId, hardDeadline);
        continue;
      }
      const remaining = Math.max(200, Math.min(2_000, hardDeadline - Date.now()));
      try {
        await Promise.race([
          this.storeDocumentSerialized({ document, documentName: name }),
          new Promise<void>((r) => { setTimeout(r, remaining).unref?.(); }),
        ]);   // race 超时=resolve 不进 catch——不 leave（Y12：挂起中批未落定，点名应含）
      } catch (err) {
        this.logger.warn(`drain store failed for ${name}: ${(err as Error).message}`);
        this.leaveInFlight(projectId);                           // 仅意外异常 leave（幂等——迟到的真 leave 无双扣）
      }
      if (Date.now() > hardDeadline) break;
    }
    const p = this.computePending();
    if (p.projects === 0 && p.batches === 0) {
      this.logger.log(JSON.stringify({ event: 'shutdown_drain_complete', pending: p, spoolResidual: { files: p.spoolFiles, bytes: p.spoolBytes }, storeInFlight: this.inFlightProjects.size }));   // X17：spoolResidual 显式（防误读"全部落 PG"）
      return;
    }
    // force-spool（每次 append 可切断——剩余 hardDeadline 为界；J5 按返回值判定）
    let forced = 0;
    for (const [projectId, q] of [...this.pendingQueues]) {
      if (q.length === 0) continue;
      if (Date.now() > hardDeadline) break;                      // X7：硬切断——点名其余
      const n = q.length;
      const payload = n === 1 ? q[0] : Y.mergeUpdates(q.slice());   // copy——不动队列
      try {
        const ids = await this.raceDeadline(this.spool.append(projectId, payload), Math.max(200, hardDeadline - Date.now()), null);
        if (ids !== null) { q.splice(0, n); this.leaveInFlight(projectId); forced += 1; }   // J5：真写成才 splice（null=race 超时未落定——留队列点名；后到的成功帧=重复回灌，幂等吸收）
      } catch { /* 留队列——点名 */ }
    }
    const p2 = this.computePending();
    this.logger.error(JSON.stringify({ event: 'shutdown_undrained', batches: p2.batches, projects: p2.projects, spoolFiles: p2.spoolFiles, spoolBytes: p2.spoolBytes, storeInFlight: this.inFlightProjects.size, forcedSpool: forced }));
  }

  /** X7：op 套 deadline——超时返回 fallback（op 自身继续跑，结果被弃） */
  private async raceDeadline<T>(op: Promise<T>, ms: number, fallback: T): Promise<T> {
    return Promise.race([op, new Promise<T>((r) => { setTimeout(() => r(fallback), ms).unref?.(); })]);
  }

  /** V4：doc 已卸载但归属仍在——spool 帧三段式直灌（append→confirm，每帧套剩余预算） */
  private async drainDetachedProject(projectId: string, hardDeadline: number): Promise<void> {
    for (const f of await this.peekSpoolFrames(projectId)) {
      if (Date.now() > hardDeadline) return;
      try {
        const r = await this.repo.append(projectId, f.payload);
        if (r.ok) await this.spool.confirm(projectId, [f.frameId]);
      } catch { /* 帧保留——点名 */ }
    }
  }
```

（V8/Y12 预算表上界依据（写进代码注释与方法头）：步骤 1=timer（2s）+入口判定（V9 常见 0s）/步骤 3=timer（6s 轮询窗）/步骤 4+force-spool=**hardDeadline t0+18s**（总闸 8s+每 doc Promise.race 2s+force-spool 按剩余硬界——自有 Map 快照遍历有界）/步骤 5=race（4s）/**合计机制上界 22s**（18+4——v3 的 22+4=26s 破表已修）——append 另有 5s 事务上界（Task 3 落 $transaction）双保险。`destroy_timeout` 日志的 storeInFlight 字段=`this.inFlightProjects.size`（V22 命名）。**M-4 复审登记：≤22s 读作近似值**——race 收口点后仍有 p2 计算+日志写盘的调度 ε，机制最坏 ≈22.2s；对 kill_timeout 30s 的 ≥8s 垫断言不受影响。）

- [x] **Step 4: 跑绿+回归+commit**

```bash
pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab.gateway.shutdown.spec.ts && pnpm --filter @flowweb/api exec vitest run src/modules/collab && pnpm verify
```
Expected: 六步用例全绿+collab 全量绿（既有 8s race 用例已被重写覆盖）。

```bash
git add apps/api/src/modules/collab && git commit -m "feat(collab): Y0a-2 关停 drain 六步——直连宽限+flushPendingStores+自管 drain+force-spool 复用落定点+destroy 超时分型（≤22s 预算表）"
```

> **Task 5 执行勘误（2026-10-07 实现裁定，commits `dbb7e854`+`abe148e7`；两阶段审查+修复复核毕）**——Task 6+ 消费者以此为准：
> **适配 6 项**：①**Y14 双保险（controller 追认）**——`overCapacityFlag=true` 单独注入失效：spool append 滞回解除支对空盘自清（depth 0≤90%×256MB→flag 翻 false→append 成功）→G-2a ii 假红；改容量位+`vi.spyOn(spool,'append').mockRejectedValue` 双保险（容量位承重 X6 闸/受理面读点，append spy 承重"恒抛不触盘"）。**传导 Task 9：DRILL_SPOOL_FAIL 的 drill-server 注入改 monkey-patch `spool.append` 恒抛**（服务态同语义——overCapacityFlag 会被运行期首个 append 自清）；②seedPendingDoc 载荷=真 Y update；③库 destroy memoized+documents 非空永挂——用例 1-3 destroy 打桩直通（dispose 复用同 mock）+用例 4 restore→摘 doc→dispose；④种子 doc 补 `connections: Map`（closeAllConnections1012 spread 裸 Y.Doc TypeError）；⑤`draining` 不重复声明（T3 已落位）；⑥用例显式 timeout 15s/20s/22s（6s poll 窗>vitest 默认 5s）。
> **质量审查修复（abe148e7）**：**I-1** V8 append 事务上界**落地** `canvas-doc-update.repository.ts`（`$transaction(async tx=>tx.$queryRaw..., {timeout:5_000,maxWait:1_000})`——plan V8 裁定曾无任何 Task 承载=注释虚构机制；int 真库背书 3/3）+repository 单测 mock 同批更新+上界断言；**I-2** drainDetachedProject deadline 背书（peek raceDeadline 500ms+每帧 append raceDeadline min(5s,remaining)+`r?.ok` 才 confirm——超时帧保留点名）；**I-3** force-spool 成功腿（forcedSpool 1+batches 0+帧入 spool）+J5 反向（deferred append 挂起→race 超时→队列保留+storeInFlight 1）两用例锁定。
> **登记**：M-1 迟到成功虚报 undrained（保守方向，方法头注释已补）/M-2 kit 无"只关 listener"收口+M-3 destroy 快速 reject 误分型（Y0a-4 登记——修复者已写入 spec §4.7 复审登记）/M-4 预算 ≈22.2s 读作近似（kill_timeout 30s 垫不受影响）。基线：collab **227/227** 绿。

---

### Task 6: project.gone 单点收敛（V11 提交后 emit×3 入口+双订阅+终态集显式清账+FK 兜底）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（终态集+事件订阅+可见化 gauge）
- Modify: `apps/api/src/modules/project/project.service.ts:106-118`（emit 后置）
- Modify: `apps/api/src/modules/template/template.service.ts:153-158`（emit 后置）
- Test: Create `apps/api/src/modules/collab/collab.gateway.project-gone.spec.ts`
- Test: `apps/api/src/modules/project/project.service.spec.ts`（emit 断言追加）

- [x] **Step 1: 写失败测试**

```typescript
// apps/api/src/modules/collab/collab.gateway.project-gone.spec.ts
// Y0a-2（spec §2.5+V11）：项目消失单点收敛——处理器只做内存终态+显式清账+关连接（禁慢操作/禁
// 磁盘 I/O：**emit 在删除事务提交之后**（V11 后置——回滚=无 emit=无假终态）；提交→emit 亚秒窗的
// 写入由 FK 双形状权威承接（撞 FK=项目确已删，丢弃+计数正确）；残留 spool 段收割=FK 识别（Task 2）。
import { describe, it, expect, afterAll, vi } from 'vitest';
import * as Y from 'yjs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollabSpoolService } from './collab-spool.service';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { startDualClientServer } from '../../test-utils/dual-client-server';
import { createMockRepo } from '../../test-utils/mock-repo';

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const c of cleanups) await c(); });

/** Y18：带标签指标的公开 API 求和（hashMap 内部读取=V17⑥ 禁）；series 恰含两 source 断言的取数源 */
const discardedCount = async (): Promise<number> => {
  const m = (await import('prom-client')).register.getSingleMetric('yjs_updates_discarded_deleted_total')!;
  return m.get().values.reduce((s, v) => s + v.value, 0);
};

describe('Y0a-2 project.gone 清账', () => {
  it('project.gone 事件 → 关连接+清 persistRetry/lastCompactAt/persistUnhealthy+终态集登记+**队列显式清账（X1）**', async () => {
    const kit = await startDualClientServer();
    try {
      const g = kit.gateway as any;
      g.lastCompactAt.set('p-gone', 1);
      g.persistUnhealthy.add('project:p-gone');
      g.persistRetry.set('project:p-gone', { rung: 3, timer: setTimeout(() => {}, 60_000) });
      g.pendingQueues.set('p-gone', [new Uint8Array([7])]);   // X1：僵尸队列——事件处理器必须清（doc 卸载后拦截分支不可达）
      // 活跃连接关断（真 WS）
      const { provider, synced } = kit.connect('project:p-gone');
      await synced;
      // kit await onModuleInit 时已注册订阅（gateway.onModuleInit 内）——用例经 kit.emitter 直发（同步派发，等价 emitAsync 监听路径）
      kit.emitter.emit('project.gone', { projectIds: ['p-gone'] });
      expect(g.deletedProjects.has('p-gone')).toBe(true);        // 终态集（永久无界——spec §9.10）
      expect(g.lastCompactAt.has('p-gone')).toBe(false);
      expect(g.persistUnhealthy.has('project:p-gone')).toBe(false);
      expect(g.persistRetry.has('project:p-gone')).toBe(false);  // 定时器随清
      expect(g.pendingQueues.get('p-gone')).toHaveLength(0);     // X1：队列已清（不清=computePending 恒>0→drain_complete 永不打印）
      expect((await import('prom-client')).register.getSingleMetric('yjs_store_in_flight_docs')!.get().values[0]?.value ?? 0).toBe(0);   // Y1 已删项目门：事件时在飞→落定后归零
      await provider.destroy();
    } finally { await kit.dispose(); }
  });

  it('终态拦截：已删项目的 storeDocument no-op+yjs_updates_discarded_deleted_total{source=gateway} 递增', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-gone2-'); cleanups.push(cleanup);
    const spool = new CollabSpoolService(dir);
    const kit = await startDualClientServer({}, 300, spool);
    try {
      const g = kit.gateway as any;
      kit.emitter.emit('project.gone', { projectIds: ['p-gone2'] });
      const before = await discardedCount();
      g.pendingQueues.set('p-gone2', [new Uint8Array([1])]);      // Y19：projectId 键控
      const r = await kit.gateway.hooks.onStoreDocument({ document: new Y.Doc(), documentName: 'project:p-gone2' });
      expect(r).toBe(false);
      expect(kit.repo.append).not.toHaveBeenCalled();            // 不 append（写了也白写——项目行没了）
      expect(await spool.peek('p-gone2')).toHaveLength(0);       // 不入 spool（台账无意义）
      expect(await discardedCount() - before).toBeGreaterThanOrEqual(1);
    } finally { await kit.dispose(); }
  });

  it('team.disbanded 双订阅汇入同一处理（projectIds 载荷等价）', async () => {
    const kit = await startDualClientServer();
    try {
      kit.emitter.emit('team.disbanded', { teamId: 't1', projectIds: ['p-x'] });
      expect((kit.gateway as any).deletedProjects.has('p-x')).toBe(true);
    } finally { await kit.dispose(); }
  });

  it('FK 兜底（运行期）：append 撞 P2003 → 批丢弃+计数+不排重试梯（残留 spool 段的收割同判——Task 2 replayAll）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-gone4-'); cleanups.push(cleanup);
    const spool = new CollabSpoolService(dir);
    const repo = createMockRepo({ append: vi.fn(async () => { throw Object.assign(new Error('Foreign key constraint failed'), { code: 'P2003' }); }) });
    const kit = await startDualClientServer({ ...repo }, 300, spool);
    try {
      const g = kit.gateway as any;
      const before = await discardedCount();
      g.pendingQueues.set('p-fk', [new Uint8Array([1])]);        // Y19：projectId 键控
      const r = await kit.gateway.hooks.onStoreDocument({ document: new Y.Doc(), documentName: 'project:p-fk' });
      expect(r).toBe(false);
      expect(g.pendingQueues.get('p-fk')).toHaveLength(0);       // 批丢弃（DB 权威证据=P6）
      expect(g.persistRetry.size).toBe(0);                       // 不进重试梯
      expect(await discardedCount() - before).toBeGreaterThanOrEqual(1);
    } finally { await kit.dispose(); }
  });

  it('Y18：discarded 计数的 series 恰含 source=gateway/spool 两标签（无标签调用会产出 source="" 脏 series）', async () => {
    const m = (await import('prom-client')).register.getSingleMetric('yjs_updates_discarded_deleted_total')!;
    const sources = new Set(m.get().values.map((v) => v.labels.source));
    expect(sources.has('gateway') || sources.size === 0).toBe(true);   // 前两用例已 inc({source:'gateway'})——非空时必含 gateway；禁出现 undefined
    for (const v of m.get().values) expect(v.labels.source).toBeDefined();
  });
});
```

`project.service.spec.ts` 追加（delete/cleanDrafts emit 断言；template.service 同款断言进其既有 spec——本 Task grep 定位）：

```typescript
  it('delete：删除提交后 emit project.gone（V11 后置——回滚无 emit）', async () => {
    emitter.emitAsync.mockResolvedValue([]);
    await service.delete('p1');
    expect(prisma.canvasProject.delete).toHaveBeenCalledBefore(emitter.emitAsync.mock.calls[0] ?? expect.anything());   // 调用序断言（无 matcher 用 spy invocationCallOrder）
    expect(emitter.emitAsync).toHaveBeenCalledWith('project.gone', { projectIds: ['p1'] });
  });
  it('delete 回滚（delete reject）→ 不 emit（V11：无假终态——项目仍在，协作写不受影响）', async () => {
    prisma.canvasProject.delete.mockRejectedValue(new Error('rollback'));
    await expect(service.delete('p1')).rejects.toThrow('rollback');
    expect(emitter.emitAsync).not.toHaveBeenCalled();
  });
  it('cleanDrafts：$queryRaw FOR UPDATE 锁定集合 → deleteMany → 提交后按确实被删集 emit（V11+X13）', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));   // tx 透传=prisma（单测形态）
    prisma.$queryRaw.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    prisma.canvasProject.deleteMany.mockResolvedValue({ count: 2 });
    const result = await service.cleanDrafts('u1');
    expect(result).toEqual({ deletedCount: 2 });                       // Y20：键名不变
    expect(prisma.canvasProject.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] } } });   // 按锁定集精确删（X13）
    expect(emitter.emitAsync).toHaveBeenCalledWith('project.gone', { projectIds: ['a', 'b'] });
  });
```

**Y20 冲击面登记**：既有用例 `project.service.spec.ts:255-266`（"删除无 Template 关联…"）断言 `deleteMany({where:{userId,updatedAt,templates:{none:{}}}})` 旧形状+`{deletedCount:4}`——X13 后 mock 形态全变（$transaction+$queryRaw），**该用例随本 Task 整体重写为上形**（$queryRaw 返回 4 行→deletedCount 4→deleteMany({id:{in:[...]}})）；controller/前端消费 `{deletedCount}` 键不变。

- [x] **Step 2: 跑红**

```bash
pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab.gateway.project-gone.spec.ts src/modules/project/project.service.spec.ts
```
Expected: FAIL（deletedProjects 未落/emit 未挂/project.service 无 emit）。留档。

- [x] **Step 3: 实现**

`collab.gateway.ts`（终态拦截的 `discardForGoneProject` 与 append catch 的 `isFkGone` 分支**已随 Task 3 Step 6 落地**——本 Step 只落事件面）：

```typescript
  /** Y0a-2（spec §2.5+V10/V11+X1）：项目消失终态集——**永久无界**（spec §9.10：进程寿命内**真删除**项目数
   *  ——V11 emit 后置后无假终态；可见地接受：yjs_deleted_projects gauge，V25）。
   *  X1：discardForGoneProject 在**事件处理器内**调用（唯一必然执行点——doc 卸载后 store 拦截分支
   *  结构性不可达，不清则僵尸队列令 computePending 恒>0→drain_complete 永不打印+G-1 barrier 超时）；
   *  storeDocumentUnlocked 首行拦截保留兜底（事件与 store 的竞态窗）。spool 段收割=FK 双形状（V6）。 */
  private readonly deletedProjects = new Set<string>();

  private handleProjectsGone(projectIds: string[]) {
    for (const projectId of projectIds) {
      this.deletedProjects.add(projectId);
      this.cancelPersistRetry(`project:${projectId}`);           // 定时器随清
      this.lastCompactAt.delete(projectId);                       // 卸载清理的第二入口（Task 7 钩子为第一入口）
      this.persistUnhealthy.delete(`project:${projectId}`);       // 陈旧电平（重连会补推失效横幅）
      this.discardForGoneProject(projectId, `project:${projectId}`);   // X1：显式清队列+点名（唯一必然执行点）
    }
    yjsDeletedProjects.set(this.deletedProjects.size);            // V25：可见地接受
    this.closeTeamDocuments(projectIds);                          // 关连接（payload-only 不查库）
  }
```

（onModuleInit `:456-458` 的 team.disbanded 订阅改双订阅：`this.eventEmitter.on('project.gone', (p: { projectIds: string[] }) => this.handleProjectsGone(p.projectIds));` + team.disbanded 行改 `this.handleProjectsGone(payload.projectIds)`。`yjsDeletedProjects` gauge 本 Task 落 metrics——`new Gauge({ name: 'yjs_deleted_projects', help: '终态集大小（进程寿命内真删除项目数——永久无界的可见化，spec §9.10）', registers: [register] })`。）

`project.service.ts` `:106-108`（**V11：emit 后置**——删除提交后才通知；提交→emit 亚秒窗的写入由 FK 权威（V6）承接：撞 FK=项目确已删，丢弃+计数正确；回滚→无 emit→无假终态）：

```typescript
  async delete(id: string) {
    const deleted = await this.prisma.canvasProject.delete({ where: { id } });
    // Y0a-2（V11）：提交后 emit（emitAsync await 监听器——处理器禁慢操作：内存终态+关连接；
    // 回滚安全：删除失败=异常上抛=无 emit=该项目协作写不受影响）
    await this.eventEmitter.emitAsync('project.gone', { projectIds: [id] });
    return deleted;
  }
```

`cleanDrafts` `:110-118`：

```typescript
  async cleanDrafts(userId: string) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const where = {
      userId,
      updatedAt: { lt: cutoff },
      templates: { none: {} },
    } as const;
    // Y0a-2（V11+X13）：**FOR UPDATE 事务**锁定并删除（关掉"findMany→deleteMany 间草稿跃 cutoff→
    // 活项目进终态集"的毒化窗——deleteMany 不返回被删 id 是 Prisma 既有限制，FOR UPDATE 把窗口归零），
    // 提交后按**确实被删的集合** emit。
    const deletedIds = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "CanvasProject"
        WHERE "userId" = ${userId} AND "updatedAt" < ${cutoff}
          AND NOT EXISTS (SELECT 1 FROM "Template" WHERE "Template"."projectId" = "CanvasProject"."id")
        FOR UPDATE`;
      const ids = rows.map((r) => r.id);
      if (ids.length > 0) await tx.canvasProject.deleteMany({ where: { id: { in: ids } } });
      return ids;
    });
    if (deletedIds.length > 0) await this.eventEmitter.emitAsync('project.gone', { projectIds: deletedIds });
    return { deletedCount: deletedIds.length };   // Y20：保留既有返回键（project.service.spec:265 断言 {deletedCount}+controller 透出——X13 只改 SQL/emit 不破形状）
  }
```

`template.service.ts` `:153-158`（**事务提交后** emit——`$transaction` await 完成之后）：

```typescript
    await this.prisma.$transaction([
      this.prisma.template.delete({ where: { id } }),
      ...(template.projectId ? [this.prisma.canvasProject.delete({ where: { id: template.projectId } })] : []),
    ]);
    // Y0a-2（V11）：项目删除入口之三——事务提交后 emit（回滚=无 emit）
    if (template.projectId) await this.eventEmitter.emitAsync('project.gone', { projectIds: [template.projectId] });
```

（project.service/template.service 构造注入 `EventEmitter2`——`private readonly eventEmitter: EventEmitter2`（TeamModule/team.service 同款；若已注入零改动——实现时 grep 确认）。两 spec 的 service 构造点补 emitter mock：`{ emitAsync: vi.fn().mockResolvedValue([]) }`。project.service.spec 的 delete 断言（`:248-250` delete calledWith）兼容——emit 在 delete 之后不断言不破坏。**V11 新增回滚用例**（project-gone.spec）：mock `canvasProject.delete` reject → 断言 emitAsync **未被调**+`deletedProjects` 无该项目（后续编辑正常落库）。）

- [x] **Step 4: 跑绿+回归+commit**

```bash
pnpm --filter @flowweb/api exec vitest run src/modules/collab src/modules/project src/modules/template && pnpm verify
```
Expected: 全绿。

```bash
git add apps/api/src/modules/collab apps/api/src/modules/project apps/api/src/modules/template && git commit -m "feat(collab): Y0a-2 project.gone 单点收敛——三删除入口提交后 emit(V11)+双订阅+终态集显式清账(V10)+FK 双形状兜底(V6)（处理器零磁盘 I/O）"
```

> **Task 6 执行勘误（2026-10-07 实现裁定，commit `40c22d34`；两阶段审查均过，无修复 commit）**——适配：M6 断言 `pendingQueues.has===false`（计划 `toHaveLength(0)` 与条目删除互斥）/Y1 门用例装置 inFlightProjects.add 前置置位（平凡 0 断言无鉴别力）/emit 序断言 invocationCallOrder（vitest 无 toHaveBeenCalledBefore）/两处白盒 `as any`（TS2740 仓内先例）/template.service 额外补 projectId=null 不 emit 负例。质量审查通过（FOR UPDATE 事务正确性/emit 后置时序/终态集语义/异常面五焦点全过）。**登记**：Minor 1（discardForGoneProject batches=0 仍计数+WARN——gateway 计"动作次数"vs spool 计"帧数"量纲不一致+解散大团队日志噪音——**Task 7 顺手**：`batches>0` 才 inc+log，leave 保持无条件）/Minor 2（project.gone emit/on 载荷键无守卫——**Task 7 contract-guards 扩面落**结构锚）/Minor 3（FOR UPDATE 无 ORDER BY——忽略，现实风险≈0 防投机加固）/M3（retryPersist 帧通道无 FK 收割——Task 10 归档）。基线：三目录 **302 tests** 绿。

---

### Task 7: beforeUnloadDocument 清理钩子+mergeUpdates 出 WS 消息路径+门禁扩面

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts:200-208`（update 回调）+hooks 对象（beforeUnloadDocument）
- Modify: `apps/api/src/modules/collab/collab-contract-guards.spec.ts`（mergeUpdates 扫描+递归扫描+契约 5 负向后顾——Y0a-1 跨批登记①②）
- Test: `apps/api/src/modules/collab/collab.gateway.spec.ts`（追加）

- [x] **Step 1: 写失败测试**

`collab.gateway.spec.ts` 追加：

```typescript
describe('Y0a-2 beforeUnloadDocument 清理+mergeUpdates 出 WS 路径', () => {
  it('卸载清理钩子：lastCompactAt/persistUnhealthy/persistRetry 残留随 doc 卸载清（真泄漏唯 lastCompactAt 的修点）', async () => {
    const kit = await startDualClientServer();
    try {
      const g = kit.gateway as any;
      g.lastCompactAt.set('p-ul', 1);
      g.persistUnhealthy.add('project:p-ul');
      await g.hooks.beforeUnloadDocument({ documentName: 'project:p-ul', document: new Y.Doc() } as any);
      expect(g.lastCompactAt.has('p-ul')).toBe(false);
      expect(g.persistUnhealthy.has('project:p-ul')).toBe(false);
    } finally { await kit.dispose(); }
  });

  it('清理钩子永不抛：内部异常被吞（库对 beforeUnloadDocument 抛错=取消卸载→destroy 永不 resolve→8s race+内存泄漏）', async () => {
    const kit = await startDualClientServer();
    try {
      const g = kit.gateway as any;
      g.spool = { hasFrames: () => { throw new Error('boom'); } };   // 内部依赖炸
      await expect(g.hooks.beforeUnloadDocument({ documentName: 'project:p-x', document: new Y.Doc() } as any)).resolves.toBeUndefined();
    } finally { await kit.dispose(); }
  });

  it('入队只 push 不折叠：70 条全留队列+软阈触发 setImmediate 提前 flush（旧实现 :207 封顶合并后=1=红相）', async () => {
    let release!: (v: { ok: true; seq: bigint }) => void;   // Y13：可释放 deferred（永挂 append 锁 saveMutex→dispose 挂死）
    const kit = await startDualClientServer({ append: vi.fn(() => new Promise((r) => { release = r; })) }, 60_000);   // 大 debounce+append 挂起：只看入队形态
    try {
      const g = kit.gateway as any;
      const { provider, synced } = kit.connect('project:p-many');   // 真路径装载（pendingQueues 由 loadDocument 播种——Y19 禁裸插装置）
      await synced;
      for (let i = 0; i < 70; i++) provider.document.getMap('nodes').set(`k${i}`, new Y.Map([['x', i]]));
      await new Promise((r) => setTimeout(r, 300));
      const q = g.pendingQueues.get('p-many') as Uint8Array[];
      expect(q).toBeDefined();
      expect(q.length).toBeGreaterThan(60);      // 不折叠（旧实现封顶合并后=1 → 红）；软阈 flush 已尝试（append 挂起=批留队列，BOI copy-first）
      expect((kit.repo.append as MockRepo['append']).mock.calls.length).toBeGreaterThanOrEqual(1);   // 提前 flush 确已触发（防空转）
      release({ ok: true, seq: 1n });            // 释放——mutex 归还，dispose 干净
      await provider.destroy();
    } finally { await kit.dispose(); }
  });
```

（实现注记：v1 的 mergeSpy 断言已删——append 挂起形态下 storeDocument 取批的 `Y.mergeUpdates(parts)` 会被调用（合法），spy 必误伤；**"入队路径零 merge 编码"的判据=Step 3 契约扫描门禁（结构锚）**，运行时断言只保留"不折叠+flush 触达"两条。）

```typescript
});
```

- [x] **Step 2: 跑红**

```bash
pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab.gateway.spec.ts -t "Y0a-2 beforeUnloadDocument"
```
Expected: FAIL（hooks.beforeUnloadDocument undefined；70 条折叠后=1≠>60）。留档。

- [x] **Step 3: 实现**

hooks 对象扩（构造 Server 配置同步加 `beforeUnloadDocument: this.hooks.beforeUnloadDocument`——**非 extension，Server 公开配置项** index.d.ts:322）：

```typescript
  /** Y0a-2（spec §2.6+V5'——X4 永不抛+Y3 顺序写死）：doc 卸载前=best-effort 交接+确定时点清理。
   *  交接：队列非空（批第一归属地=V4 自有 Map，doc 卸载不吞批）→尝试 spool.append（成功=splice+leave）；
   *  失败→不抛不取消卸载（throw 形态=释放路径缺失 doc 永久驻留+每次卸载重试循环）——ERROR 点名+
   *  schedulePersistRetry 保活（队列消亡仅三出口：落 PG/落 spool/进程退出由 shutdown_undrained 点名）。
   *  **Y3 顺序（v3 的 schedule→cancel 顺序会立刻清掉刚排的保活 timer=自造停摆）**：
   *  ①cancelPersistRetry（清旧梯——幂等）→②交接→③失败才 schedulePersistRetry（熔断态首行 return
   *  排不上→由 onRecovered seam 的 rearmQueues 兜底——Y10 闭环）→④清理段（永不抛）。
   *  清理段：lastCompactAt（真泄漏唯一修点）/persistUnhealthy（陈旧电平）/pendingQueues 空条目回收（X17）。 */
  private async beforeUnloadDocument({ documentName }: { documentName: string }): Promise<void> {
    const projectId = parseProjectId(documentName);
    this.cancelPersistRetry(documentName);                       // ① 先清旧梯（防清掉③要排的保活）
    // —— ② 交接段（best-effort，永不抛）——
    let handoffFailed = false;
    const q = this.pendingQueues.get(projectId);
    if (q && q.length > 0) {
      try {
        const n = q.length;
        const payload = n === 1 ? q[0] : Y.mergeUpdates(q.slice());
        await this.spool.append(projectId, payload);             // 交接成功：批新家=spool
        q.splice(0, n);
        this.leaveInFlight(projectId);                           // X2 落定点②（卸载交接）
      } catch (e) {
        handoffFailed = true;
        yjsUnloadHandoffFailureTotal.inc();
        this.logger.error(JSON.stringify({ event: 'unload_handoff_failed', projectId, batches: q.length, reason: (e as Error).message }));
      }
    }
    // —— ③ 保活（仅交接失败；在 ① 的 cancel 之后——Y3）——
    if (handoffFailed) this.schedulePersistRetry(documentName);  // detached 队列经退避梯恢复（X5 双通道）；熔断态由 Y10 seam rearm 兜底
    // —— ④ 清理段（永不抛——M1：清理失败必须留痕）——
    try {
      this.lastCompactAt.delete(projectId);
      this.persistUnhealthy.delete(documentName);
      const q2 = this.pendingQueues.get(projectId);
      if (q2 && q2.length === 0) this.pendingQueues.delete(projectId);   // X17：空条目回收（交接失败时 q2 非空自然保留）
    } catch (e) {
      yjsUnloadCleanupFailureTotal.inc();
      this.logger.warn(`unload cleanup failed for ${documentName}: ${(e as Error).message}`);
    }
  }
```

（`yjsUnloadHandoffFailureTotal`/`yjsUnloadCleanupFailureTotal` 两指标随本 Task 落 metrics（Y18——v3 只在注记提）：

```typescript
export const yjsUnloadHandoffFailureTotal = new Counter({
  name: 'yjs_unload_handoff_failure_total', help: '卸载交接 spool 写失败次数（批留队列+退避保活——X4/Y3）', registers: [register],
});
export const yjsUnloadCleanupFailureTotal = new Counter({
  name: 'yjs_unload_cleanup_failure_total', help: '卸载清理段异常次数（永不抛——吞+计数留痕，M1）', registers: [register],
});
```）

（**配套用例**（gateway.spec Task 7 describe 追加，替代 v3 的散文形态）：①队列非空+spool 可用→钩子完成后队列空+帧在 spool；②队列非空+spool 白盒 overCapacity→钩子 **resolves 不 reject**（X4 永不抛）+队列仍在+`persistRetry` 已排（Y3 保活——且断言排程发生在 cancel 之后：`entry.timer` 真值）；③Y11 重连用例（交接失败→同项目重连→同数组身份+批留存）。**X10/Y7 字段**：`flushScheduled: Set<string>`+`queueBytes(projectId, q)`（O(n) 求和，n≤512 常数小）+`COALESCE_MAX_ENTRIES/COALESCE_MAX_BYTES` 常量（见 update 回调块）。）

update 回调 `:200-208` 重写（PENDING_MAX_ENTRIES 语义变更——仅"提前异步 flush"触发阈，不再同步合并；队列取用改 V4 键控）：

```typescript
        document.on('update', (u: Uint8Array) => {
          if (this.replaying.has(document)) return;
          const projectId = this.docProject.get(document);
          const q = projectId ? this.pendingQueues.get(projectId) : undefined;
          if (!q) { this.logger.error(`update for untracked doc ${documentName}: dropped`); return; }
          q.push(u);
          // Y0a-2（spec §2.6/纪律 9+X10）：入队只 push——mergeUpdates 禁入 WS 消息路径（实测 3000 条 4.8s 同步阻塞）；
          // 软阈=条数(64)或字节(1MB)双阈+闩锁（防故障期"每条 update 排一次 store"风暴）→ setImmediate 提前 flush
          if ((q.length >= PENDING_MAX_ENTRIES || this.queueBytes(projectId, q) >= 1_048_576) && !this.flushScheduled.has(projectId)) {
            this.flushScheduled.add(projectId);
            setImmediate(() => {
              this.flushScheduled.delete(projectId);
              void this.storeDocumentSerialized({ document, documentName }).catch(() => {});
            });
          }
          // Y7（内存保命——X10 删折叠后唯一上界）：双败故障期（append+spool 皆不可用）队列无界增长——
          // 硬阈（512 条/8MB）触发异步 coalesce：merge 在 setImmediate tick（不占 WS 同步栈）+原地
          // splice 保数组身份。**门控（BOI 反例）**：store 在飞（inFlightProjects）时禁止合并——store 取批
          // n=3 copy 后 coalesce 压队列成 1 条（含新内容）→ store 成功 splice(0,3)=删未落库内容=蒸发；
          // 竞争窗由 Y8 身份校验兜底（queue[n-1]!==tailRef ⇒ anomaly+按实际存在截断）。
          if (q.length >= COALESCE_MAX_ENTRIES || this.queueBytes(projectId, q) >= COALESCE_MAX_BYTES) {
            setImmediate(() => {
              const qq = projectId ? this.pendingQueues.get(projectId) : undefined;
              if (!qq || qq.length < 2) return;
              if (this.inFlightProjects.has(projectId)) return;   // 在飞不合并（下一次触发再收）
              const merged = Y.mergeUpdates(qq.slice());
              qq.splice(0, qq.length, merged);   // 原地——数组身份恒定不变量保持
            });
          }
        });
```

（常量：`const COALESCE_MAX_ENTRIES = 512; const COALESCE_MAX_BYTES = 8 * 1024 * 1024;`——与 PENDING_MAX_ENTRIES 同处声明；coalesce 无闩锁（setImmediate 天然下 tick，多次排队幂等无害——合并后长度 1 不再触发）。**配套用例（Y24 内存上界门）**：append 永挂+spool 白盒 overCapacity → 推 600 条 update → pollUntil 断言队列长度 ≤512+1（coalesce 收敛）且 `yjs_pending_batches` 不随 update 数线性增长。）

（`:39-42` PENDING_MAX_ENTRIES 注释更新语义；`replaying` 判定不变。）

`collab-contract-guards.spec.ts` 扩三条（Y0a-1 跨批登记①②收口）：

```typescript
  it('契约 mergeUpdates 出 WS 路径：update 回调体内零 merge 编码（结构锚——回调体只 push+计数阈）', () => {
    const gw = readFileSync(join(SRC, 'collab.gateway.ts'), 'utf8');
    const cb = /document\.on\('update',[\s\S]*?\n        \}\);/.exec(gw)?.[0] ?? '';
    expect(cb, 'update 回调体定位失败').not.toBe('');
    expect(cb).not.toMatch(/mergeUpdates/);
  });
  it('契约 5 扩负向后顾（Y0a-1 登记①）：maybeCompact/repo.compact 调用行无 await 前缀即红（裸语句形态盲区）', () => {
    for (const f of prodFiles) {
      const lines = f.src.split('\n');
      lines.forEach((line, i) => {
        if (/this\.(maybeCompact|repo\.compact)\(/.test(line) && !/\bawait\b/.test(line) && !/^\s*(\*|\/\/|\/\*)/.test(line)) {
          throw new Error(`${f.name}:${i + 1} compact 调用缺 await：${line.trim()}`);
        }
      });
    }
  });
  it('扫描递归化（Y0a-1 登记②）：prodFiles 收集改递归 readdirSync——collab/ 子目录（如未来 spool/ 拆分）不静默失明', () => {
    // prodFiles 收集逻辑改递归（doc-shape-single-source.guard 先例——5 行）；断言本 spec 自身仍绿即证
  });
```

（第三条的实现=把文件头 `prodFiles` 的 `readdirSync(SRC)` 平铺收集改**递归收集**（自实现 5 行 walk 或 `readdirSync(SRC, { recursive: true })`——Node 20+ 支持 recursive 选项）；用例断言=递归收集后数量 ≥ 平铺数量。）

- [x] **Step 4: 跑绿+门禁先红验证（D13）+commit**

```bash
pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab.gateway.spec.ts src/modules/collab/collab-contract-guards.spec.ts
# 门禁红证据：临时在 update 回调体内加一行 Y.mergeUpdates(q) → 契约扫描红 → 还原零残留
pnpm --filter @flowweb/api exec vitest run src/modules/collab && pnpm verify
```

```bash
git add apps/api/src/modules/collab && git commit -m "feat(collab): Y0a-2 beforeUnloadDocument 清理钩子(永不抛)+mergeUpdates 出 WS 消息路径(setImmediate 提前 flush)+门禁扩面（递归扫描+契约5后顾）"
```

> **Task 7 执行勘误（2026-10-07 实现裁定，commits `b82c30c9`+`2dc87107`+`9beef788`；spec 审查追认+两轮修复复核毕）**——Task 8+ 消费者以此为准：
> **①Y7 coalesce 门控删除（controller 追认——重大偏离）**：plan 的 `inFlightProjects.has` 门在双败故障期**结构性死锁**（enter 后批未落定→leave 不清（契约 14）→inFlight 恒置位→折并永不执行→Y24 上界破约——600 条门用例在 plan 门形态下必红，门与 Y24 不相容二选一）。实现把折并**移入 saveMutex 锁内取批点**（`storeDocumentUnlocked` :346-348——折并与取批同锁同 tick 零 await，主交织窗结构性消灭）；spec 审查独立推演追认（含 controller 交织场景逐步验证+库源码 saveMutex 实证）。残余锁外 splice（unload 交接+detached 梯）均 I-2 批尾锚守卫（2dc87107 补 detached 锚——门控删除的窄蒸发窗闭环）。
> **②X17 空条目回收加 doc 存活前置（9beef788，质量审查 I-1）**：库在 beforeUnloadDocument 钩子后**复检** shouldUnloadDocument（esm:1589——mutex 锁定/连接>0 取消卸载 doc 存活）→无前置的空条目删除使僵尸 doc 重连后每条 update 命中 `!q` 丢弃=活编辑静默蒸发窗。前置 `!documents.get(documentName)` 修复；**实现者库时序实证**：documents.delete 在钩子后（:1590）→钩子执行期 doc 恒在 Map→**X17 回收生产中恒不触发**（保守正确——空条目由 get-or-create 复用/handleProjectsGone 承接，有界无害）。
> **③适配**：70 条/交接/Y11 用例 pollUntil 等全量落队（客户端 WS 送达异步——stamp 水准假红）；Y24 600 条用例改服务端 doc 直注（Y19 时序补全）；交接用例断言 `toHaveLength(0)`（X17 前置后空条目保留——9beef788 同步）；阈值注释 off-by-one 对齐（代码严格 `>`=65/513 触发）；"唯一锁外 splice"注释改正（两处）；soft 阈闩锁 `scheduleSoftFlush`（空队列/doc 不在静默返回）；Minor 1（discardForGoneProject batches>0 才 inc+log）；contract-guards 第四条（project.gone emit/on 载荷键接缝守卫——Task 6 Minor 2）。
> **登记**：M-3（卸载交接 spool.append 无时间上界——关停腿 4s race 兜底）/M-4(a)(b)（闩锁去重用例+交接 I-2 anomaly 分支用例——**Task 10 顺手清单**）/M-5（契约锚边角假阳/假阴——响偏可接受）/M-6（交接成功后运行期无该项目 PG 排空者——J4 非 at-risk 设计内）。基线：collab **245/245** 绿。

---

### Task 8: 运维脚本——collab-spool-quarantine（逃生阀）+collab-spool-import（回滚 runbook）

**Files:**
- Create: `apps/api/scripts/collab-spool-quarantine.ts`
- Create: `apps/api/scripts/collab-spool-import.ts`

- [x] **Step 1: 实现 collab-spool-quarantine.ts（Y6 终形态：sidecar 字节区间+好帧摘要+二次确认+`__probe__` 过滤——生产事故唯一删段路径，必须能被半夜叫醒的人正确使用）**

```typescript
// apps/api/scripts/collab-spool-quarantine.ts —— Y0a-2 逃生阀（spec §2.2 v2.4：quarantine=sidecar 标记
// 不搬字节，段内移帧物理不可行；本脚本是唯一删段路径，人工可审计）。
// 运行：COLLAB_SPOOL_DIR=... pnpm --filter @flowweb/api exec tsx scripts/collab-spool-quarantine.ts <projectId|--all> --dry-run
//       判定后：同命令 --delete --yes-i-understand（不可逆；先 --dry-run 审阅）
import { readdir, readFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as Y from 'yjs';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const target = args[0];
  const dryRun = args.includes('--dry-run');
  const del = args.includes('--delete');
  const confirmed = args.includes('--yes-i-understand');
  if (!target || (!dryRun && !del)) {
    console.error('usage: tsx scripts/collab-spool-quarantine.ts <projectId|--all> (--dry-run | --delete --yes-i-understand)');
    console.error('  --dry-run            打印段字节区间+好帧摘要（人工判定）');
    console.error('  --delete             判定后删段（唯一允许删段的路径——不可逆）');
    console.error('  --yes-i-understand   --delete 的二次确认（缺则拒绝执行）');
    process.exit(1);
  }
  if (del && !confirmed) {
    console.error('拒绝：--delete 不可逆，需追加 --yes-i-understand（先 --dry-run 审阅将被删除的字节数）');
    process.exit(1);
  }
  const dir = resolve(process.env.COLLAB_SPOOL_DIR ?? join(process.cwd(), '.data', 'collab-spool'));
  let totalDeleteBytes = 0; let deleteCount = 0;
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.spool') && !x.startsWith('__probe__')).sort()) {   // Y6：探针段过滤
    const projectId = f.split('.').slice(0, -2).join('.');
    if (target !== '--all' && projectId !== target) continue;
    const buf = await readFile(join(dir, f));
    // sidecar 区间（V3 字节口径——与隔离处置同源）
    let quarantinedFromOffset: number | null = null;
    const sidecar = await readFile(join(dir, `${f}.quarantine`), 'utf8').then((t) => t.trim().split('\n').filter(Boolean)).catch(() => [] as string[]);
    const last = sidecar[sidecar.length - 1];
    if (last) { try { quarantinedFromOffset = JSON.parse(last).quarantinedFromOffset ?? null; } catch { /* 行残缺——按无 sidecar 处理 */ } }
    // 帧解析：好帧摘要（节点/边数——人工判定"这段值不值得救"）+首坏偏移（无 sidecar 时现场判定）
    let off = 0, idx = 0, firstBad = -1;
    const goodLines: string[] = [];
    while (off + 8 <= buf.byteLength) {
      const len = buf.readUInt32LE(off);
      if (off + 8 + len > buf.byteLength) { firstBad = off; break; }
      const payload = buf.subarray(off + 8, off + 8 + len);
      if ((await import('node:zlib')).crc32(payload) !== buf.readUInt32LE(off + 4)) { firstBad = off; break; }
      const doc = new Y.Doc();
      try { Y.applyUpdate(doc, payload); } catch { /* 摘要尽力而为 */ }
      goodLines.push(`  好 ${idx} @${off}: ${len}B, nodes=${doc.getMap('nodes').size}, edges=${doc.getMap('edges').size}`);
      off += 8 + len; idx += 1;
    }
    const badFrom = quarantinedFromOffset ?? firstBad;
    const quarantinedBytes = badFrom != null ? buf.byteLength - badFrom : 0;
    console.log(`\n=== ${f} (${buf.byteLength}B) ===`);
    console.log(goodLines.slice(-8).join('\n') || '  （无好帧）');   // 尾部 8 帧（近期编辑——判定主依据）
    if (goodLines.length > 8) console.log(`  …共 ${goodLines.length} 好帧`);
    if (badFrom != null) console.log(`  隔离区间: @${badFrom}→EOF（${quarantinedBytes}B 含坏帧头）${quarantinedFromOffset != null ? '〔sidecar 已记〕' : '〔sidecar 未记——现场解析判定〕'}`);
    else console.log('  段尾干净（无隔离区间）');
    if (del) {
      await unlink(join(dir, f));
      await unlink(join(dir, `${f}.quarantine`)).catch(() => {});
      totalDeleteBytes += buf.byteLength; deleteCount += 1;
      console.log(`  → 已删除（${buf.byteLength}B）`);
    } else {
      console.log(`  → dry-run（--delete --yes-i-understand 才删）`);
    }
  }
  if (del) console.log(`\n共删除 ${deleteCount} 段 / ${totalDeleteBytes}B`);
}
void main().catch((e) => { console.error(e); process.exitCode = 1; });
```

- [x] **Step 2: 实现 collab-spool-import.ts（回滚 runbook——回滚前先 drain，否则"残留文件不读"=回滚动作本身丢数据 spec §4.2）**

```typescript
// apps/api/scripts/collab-spool-import.ts —— Y0a-2 回滚配套（spec §4.2）：读帧→repo.append→confirm。
// 运行：DATABASE_URL=... pnpm --filter @flowweb/api exec tsx scripts/collab-spool-import.ts <projectId|--all>
import { PrismaClient } from '@prisma/client';
import { CollabSpoolService } from '../src/modules/collab/collab-spool.service';
import { CanvasDocUpdateRepository } from '../src/modules/collab/canvas-doc-update.repository';

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) { console.error('usage: tsx scripts/collab-spool-import.ts <projectId|--all>'); process.exit(1); }
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);
  const spool = new CollabSpoolService();
  try {
    await spool.scan();
    const ids = target === '--all' ? spool.keys() : [target];
    let replayed = 0;
    for (const projectId of ids) {
      const r = await spool.replayAll(repo);
      replayed += r.replayed;
      console.log(`${projectId}: replayed=${r.replayed} failed=${r.failed} discarded=${r.discarded}`);
    }
    console.log(`共回灌 ${replayed} 帧`);
  } finally { await prisma.$disconnect(); }
}
void main().catch((e) => { console.error(e); process.exitCode = 1; });
```

- [x] **Step 3: 本地真库跑通+typecheck+commit**

```bash
# quarantine dry-run：手工造一帧（临时 COLLAB_SPOOL_DIR 放一个 .spool 文件）
COLLAB_SPOOL_DIR=$(mktemp -d) pnpm --filter @flowweb/api exec tsx scripts/collab-spool-quarantine.ts --all --dry-run
# 期望：列出段/好帧摘要/隔离区间+”dry-run（--delete --yes-i-understand 才删）”；exit 0
COLLAB_SPOOL_DIR=$(mktemp -d) pnpm --filter @flowweb/api exec tsx scripts/collab-spool-quarantine.ts --all --delete
# 期望：拒绝执行（缺 --yes-i-understand）；exit 1
pnpm --filter @flowweb/api exec tsc -p tsconfig.scripts.json --noEmit
```
Expected: 脚本可运行+tsc exit 0（两个脚本进 tsconfig.scripts.json include 的 scripts/ 目录自动覆盖）。

```bash
git add apps/api/scripts/collab-spool-quarantine.ts apps/api/scripts/collab-spool-import.ts && git commit -m "feat(scripts): Y0a-2 spool 逃生阀(外置导出+人工判定后删段)+回滚 runbook 脚本(读帧→append→confirm)"
```

> **Task 8 执行勘误（2026-10-07 实现裁定，commits `8eb0568e`+`909e93aa`；双阶段审查毕）**——适配 5 项（①badFrom null 映射修正——plan `?? firstBad` 段尾干净时泄漏 -1 打印"@-1→EOF"胡话；②<8B 残尾映射 firstBad=off 与 scan 口径一致；③crc32 静态 import+`>>> 0`；④空目录"无匹配段"输出；⑤**import 点名回灌 `{projectIds:[projectId]}`——plan 裸 replayAll 单项目目标旁及全部项目+--all 首迭代全量误导**）+审查修复 4 项（import 目录预检 stat——错目录曾静默建幽灵目录 exit 0 假成功/quarantine 停机前提声明（活实例 --delete=TOCTOU+陈旧 meta）/--dry-run --delete 互斥校验/dry-run 将删合计行）。冒烟全过（dry-run 摘要/--delete 拒绝/定向删/import 真库闭环 replayed=1+段回收+tsc scripts 门）。登记：帧解析三常量双实现（service 未导出——观察项）；pnpm exec Windows 噪音（exit 码正确传播，直呼 tsx bin 更净）。

---

### Task 9: kill -9/SIGTERM 演练装置（G-1 双模式 quiescence barrier+G-2a 点名一致性）

**Files:**
- Create: `apps/api/scripts/collab-drill-server.ts`（子进程入口）
- Create: `apps/api/scripts/collab-kill9-drill.ts`（驱动）
- Modify: `apps/api/package.json`（devDep `@hocuspocus/provider`——驱动 client）

- [x] **Step 1: drill-server 子进程入口+AppModule 可起性探针**

```typescript
// apps/api/scripts/collab-drill-server.ts —— Y0a-2 演练子进程入口：真实 AppModule（生产同构——
// drain 六步经 enableShutdownHooks 的 Nest 生命周期；metrics 端点=轮询面）。env 全由驱动进程注入：
// DATABASE_URL/COLLAB_PORT/DRILL_HTTP_PORT/COLLAB_DEBOUNCE/COLLAB_SPOOL_DIR/PROMETHEUS_TOKEN/
// MINIO_INIT=skip+三占位（X3）/DRILL_SPOOL_FAIL（Y14）。
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CollabSpoolService } from '../src/modules/collab/collab-spool.service';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableShutdownHooks();   // SIGTERM→onApplicationShutdown（G-2a 演练对象）
  if (process.env.DRILL_SPOOL_FAIL === '1') {
    // Y14：spool 故障注入=服务态容量位（append 恒抛+不触盘+不影响启动 scan）。文件系统占位形态
    // （段路径 mkdir）会被 V2 封段滚动绕过：seg0 open EISDIR→封段→seg1 可写=注入只挡一次。
    (app.get(CollabSpoolService) as unknown as { overCapacityFlag: boolean }).overCapacityFlag = true;
    console.log(JSON.stringify({ event: 'drill_spool_broken' }));
  }
  await app.listen(Number(process.env.DRILL_HTTP_PORT) || 3000);
  console.log(JSON.stringify({ event: 'drill_server_listening', pid: process.pid }));
}
void main().catch((e) => { console.error(e); process.exit(1); });
```

**AppModule 可起性探针（纪律 10——CI collab-core 无 MinIO）**：

```bash
DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb DRILL_HTTP_PORT=3999 COLLAB_PORT=3998 PROMETHEUS_TOKEN=drill COLLAB_DEBOUNCE=300 COLLAB_SPOOL_DIR=$(mktemp -d) pnpm --filter @flowweb/api exec tsx scripts/collab-drill-server.ts &
sleep 15 && curl -s -H "x-prometheus-token: drill" http://127.0.0.1:3999/api/metrics | head -5; kill %1
```

预期：`drill_server_listening`+metrics 文本。**若 MinIO/其他依赖硬阻塞启动**（探针发现）：降级为 drill 专用 root module（`scripts/drill-app.module.ts` 只 import CollabModule+MetricsModule 所需链——以探针实际红点为准最小组合，登记偏差）；BullMQ 需 Redis（**X3：collab-core job 本批补 redis service**——v2 的 V20"已有"勘误经核验反了（ci.yml:95 属 e2e-collab），本地演练前置=Redis 必须起，写进 runbook——V21/E12）。

**V21 探针命令修正（E11——env 必填硬门槛）**：`app.module.ts:41` 顶层 `validateEnv()` 缺 `MINIO_ENDPOINT(url)/MINIO_ACCESS_KEY/SECRET_KEY` 即 `process.exit(1)`——探针/演练命令必须注入占位值：

```bash
DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb MINIO_ENDPOINT=http://127.0.0.1 MINIO_ACCESS_KEY=drill MINIO_SECRET_KEY=drill-secret DRILL_HTTP_PORT=3999 COLLAB_PORT=3998 PROMETHEUS_TOKEN=drill COLLAB_DEBOUNCE=300 COLLAB_SPOOL_DIR=$(mktemp -d) pnpm --filter @flowweb/api exec tsx scripts/collab-drill-server.ts &
```

（不走 MINIO_INIT=skip 之类的开关——占位 env 即可过 zod，零生产足迹。）

- [x] **Step 1b: v2 修订落实（V7 演练三修+V23 判据升级——对 Step 2 代码段的覆盖性修正）**

1. **fixture 补全（V7b）**：`test-utils/db-fixtures.ts` 增导出（演练与 int 共用）：

```typescript
export const FIXTURE_USER = 'y0a-fixture-user';
export const FIXTURE_TEAM = 'y0a-fixture-team';

/** V7：演练/端到端用完整 fixture——User+Team+CanvasProject+**TeamMember**（缺它 authenticate FORBIDDEN）
 *  +Session（token @unique 直插即过 WS 鉴权）。 */
export async function ensureCollabSessionFixture(
  prisma: PrismaClient, projectId: string, token: string, role = 'MEMBER',
): Promise<void> {
  await ensureProjectFixture(prisma, projectId);
  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: FIXTURE_TEAM, userId: FIXTURE_USER } },
    update: { role },
    create: { teamId: FIXTURE_TEAM, userId: FIXTURE_USER, role },
  });
  await prisma.session.deleteMany({ where: { token } });
  await prisma.session.create({ data: { id: `sess-${token}`, userId: FIXTURE_USER, token, expiresAt: new Date(Date.now() + 3_600_000) } });
}

export async function cleanupCollabSessionFixture(prisma: PrismaClient, projectId: string, token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token } });        // V25/M4：session 行清理
  await cleanupProjectFixture(prisma, projectId);
}
```

（TeamMember 必填字段以 schema 一手核对（teamId/userId/role 枚举值）；drill 的 `FIXTURE_USER` 字面量改 import 此常量——"脚本内字面量对齐"作废。）

2. **spool 故障注入=Y14 服务态（V7a 的段路径 mkdir 形态作废）**：文件占位会被 **V2 封段滚动绕过**——seg0 `open('a')` 抛 EISDIR→封段→下一次 append 滚 seg1 可写=注入只挡一次（force-spool 第二写成功→drain_complete≠undrained→断言红在错误方向）。修法：`--spool-fail` → startServer env 加 `DRILL_SPOOL_FAIL: '1'` → drill-server 启动期 `(app.get(CollabSpoolService)).overCapacityFlag = true`（Step 1 代码已落）——append 恒抛+不触盘+不影响启动 scan/mkdir。**sigterm --spool-fail 档同时不 dropTrigger**（见 Step 2 sigtermMode——trigger 在则 drain 的 append 恒败，undrained 判据确定可达；v3 无差别 dropTrigger 会让 append 成功→drain_complete→断言红）。

3. **回灌等待改轮询（V7c）**：kill9 重启后 `await sleep(2_000)` 删除，改轮询（带 deadline）：

```typescript
  const h2 = await startServer(env); await h2.ready;
  const t1 = Date.now();
  while (Date.now() - t1 < 30_000) {
    const text = await metrics(h2.port, h2.token);
    if (await gauge(text, 'yjs_spool_depth_files') === 0) break;   // 回灌完成（段回收）
    await sleep(300);
  }
```

4. **barrier 判据升级（V23）**：`barrier()` 的 quiescent 条件追加 `storeInFlight===0`（gauge 名 `yjs_store_in_flight_docs`）；正常模式 kill 前记 `seqBefore = SELECT count(*) FROM "CanvasDocUpdate" WHERE "projectId"=$1`，重启后断言 `count >= seqBefore`（反向下限——防"驱动侧没写进去"假绿）；故障模式 barrier 前断言 `yjs_spool_depth_files > 0`（证明确在故障态）。barrier 签名相应改 `barrier(h, { withSpoolStable?, requireSpoolNonEmpty? })`。

5. **子进程 env 补 MINIO 裁剪（V21→X3 修正，已落 Step 2 startServer 代码块）**：`startServer` 的 env 展开含 `MINIO_INIT: 'skip'`+三占位——**skip 不可省**（占位只过 zod，`MinioModule.onModuleInit` 仍 `ensureBucket()`→3 重试后 throw→listen 永不执行→drill 60s 超时全红；skip=仓内 B′ 终裁机制，minio.module.ts:29-38，e2e-collab 先例）。

- [x] **Step 2: collab-kill9-drill 驱动脚本**

```typescript
// apps/api/scripts/collab-kill9-drill.ts —— Y0a-2 演练驱动（spec §4.1 G-1/G-2；collab-core 载体）。
// 模式：
//   --mode kill9-normal ：停写→双模式 barrier（docs===0∧batches===0 持续 ≥3s）→kill -9→重启→重放 ⊇ 已接受集
//   --mode kill9-fault  ：DB 触发器拒 INSERT→批入 spool→barrier（+spoolBytes 连续 2 采样不变）→kill -9→drop 触发器→重启回灌→重放 ⊇
//   --mode sigterm [--spool-fail]：SIGTERM→关停日志断言（drain_complete pending 全 0 或 undrained 与 storeInFlight 一致）
// 判定锚=已接受集=驱动侧 provider 文档的节点键集（写入方全量知情）。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { CanvasDocUpdateRepository } from '../src/modules/collab/canvas-doc-update.repository';
import { ensureCollabSessionFixture, cleanupCollabSessionFixture, FIXTURE_USER } from '../src/test-utils/db-fixtures';

const DATABASE_URL = process.env.DATABASE_URL!;
const PID = process.env.DRILL_PROJECT ?? `y0a2-drill-${Date.now()}`;
const DRILL_TOKEN = `drill-token-${Date.now()}`;   // Y15：fixture 的 Session token（ensureCollabSessionFixture 直插行=过 WS 鉴权）
const NODES = 25;                        // 已接受集大小
const COLLAPSE_MS = 3_200;               // ≥maxDebounce(3s) 的持续判定窗

function fail(msg: string): never { console.error(`DRILL FAIL: ${msg}`); process.exit(1); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function metrics(port: number, token: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/api/metrics`, { headers: { 'x-prometheus-token': token } });
  return res.text();
}
async function gauge(text: string, name: string): Promise<number> {
  const m = new RegExp(`^${name} ([0-9.]+)`, 'm').exec(text);
  if (!m) fail(`gauge ${name} 不在 metrics 输出中`);
  return Number(m[1]);
}

interface DrillHandle { child: ChildProcess; port: number; wsPort: number; token: string; ready: Promise<void> }
async function startServer(env: Record<string, string>): Promise<DrillHandle> {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const wsPort = port + 1;
  const token = `drill-${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', resolve(__dirname, 'collab-drill-server.ts')], {
    env: {
      ...process.env, ...env,
      DRILL_HTTP_PORT: String(port), COLLAB_PORT: String(wsPort), PROMETHEUS_TOKEN: token, COLLAB_DEBOUNCE: '300',
      // X3/Y15：skip 不可省（占位只过 zod——MinioModule 仍 ensureBucket 3 重试后 throw=listen 永不执行）
      MINIO_INIT: env.MINIO_INIT ?? 'skip',
      MINIO_ENDPOINT: 'http://127.0.0.1', MINIO_ACCESS_KEY: 'drill', MINIO_SECRET_KEY: 'drill-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: string[] = []; const stderr: string[] = [];
  child.stdout!.on('data', (d) => stdout.push(String(d)));
  child.stderr!.on('data', (d) => stderr.push(String(d)));
  const ready = new Promise<void>((resolveReady, reject) => {
    const t = setTimeout(() => reject(new Error(`drill-server 未在 60s 内 listening\n${stdout.join('')}\n${stderr.join('')}`)), 60_000);
    const check = () => { if (stdout.join('').includes('drill_server_listening')) { clearTimeout(t); resolveReady(); } };
    child.stdout!.on('data', check); check();
  });
  (child as any & { drillStdout: () => string }).drillStdout = () => stdout.join('');
  return { child, port, wsPort, token, ready };
}

async function connectWrite(h: DrillHandle, projectId: string, nodes: number): Promise<{ provider: HocuspocusProvider; keys: string[] }> {
  const ydoc = new Y.Doc();
  const provider = new HocuspocusProvider({ url: `ws://127.0.0.1:${h.wsPort}?token=${DRILL_TOKEN}`, name: `project:${projectId}`, document: ydoc });
  await new Promise<void>((r, rej) => { provider.on('synced', () => r()); setTimeout(() => rej(new Error('sync 超时')), 15_000); });
  const keys: string[] = [];
  for (let i = 0; i < nodes; i++) ydoc.getMap('nodes').set(`drill-${i}`, new Y.Map([['x', i]]));
  keys.push(...[...ydoc.getMap('nodes').keys()]);
  await sleep(200);                     // 上行送达窗
  return { provider, keys };
}

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

async function replayKeys(): Promise<string[]> {   // DB 权威重放（绕过内存 doc）
  const repo = new CanvasDocUpdateRepository(prisma as any);
  const { state, updates } = await repo.loadForHydration(PID);
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, new Uint8Array(state));
  for (const u of updates) Y.applyUpdate(doc, new Uint8Array(u));
  return [...doc.getMap('nodes').keys()];
}

async function barrier(h: DrillHandle, opts: { withSpoolStable?: boolean; requireSpoolNonEmpty?: boolean } = {}): Promise<void> {
  // X12/N4（V23 判据入代码）：docs/batches/inFlight 三归零 + 持续 ≥COLLAPSE_MS——批离开队列≠批已落定
  // （storeInFlight 在飞窗口正是 kill 最脆弱时刻）；故障模式加 spoolBytes 两采样不变+前置断言 spoolFiles>0
  if (opts.requireSpoolNonEmpty) {
    const pre = await metrics(h.port, h.token);
    if (await gauge(pre, 'yjs_spool_depth_files') === 0) fail('故障模式前置断言失败：spool 空=实际在测正常模式（触发器未生效？）');
  }
  const t0 = Date.now();
  let stableSince: number | null = null; let lastSpoolBytes = -1;
  while (Date.now() - t0 < 30_000) {
    const text = await metrics(h.port, h.token);
    const docs = await gauge(text, 'yjs_pending_projects'); const batches = await gauge(text, 'yjs_pending_batches');   // Y5：gauge 名同步改
    const inFlight = await gauge(text, 'yjs_store_in_flight_docs');
    const spoolBytes = await gauge(text, 'yjs_spool_depth_bytes');
    const quiescent = docs === 0 && batches === 0 && inFlight === 0 && (!opts.withSpoolStable || spoolBytes === lastSpoolBytes);
    if (quiescent) { if (stableSince === null) stableSince = Date.now(); if (Date.now() - stableSince >= COLLAPSE_MS) return; }
    else stableSince = null;
    lastSpoolBytes = spoolBytes;
    await sleep(400);
  }
  fail('quiescence barrier 30s 未达成（docs/batches/inFlight 未归零或 spool 不稳定）');
}

async function main(): Promise<void> {
  const mode = (process.argv.find((a) => a.startsWith('--mode=')) ?? '').slice(7);
  if (!['kill9-normal', 'kill9-fault', 'sigterm'].includes(mode)) fail('usage: --mode=kill9-normal|kill9-fault|sigterm [--spool-fail]');
  const spoolDir = await mkdtemp(join(tmpdir(), 'y0a2-drill-spool-'));
  const env = { DATABASE_URL, COLLAB_SPOOL_DIR: spoolDir, NODE_ENV: 'development' as const };
  await ensureCollabSessionFixture(prisma as any, PID, DRILL_TOKEN);   // Y15/V7b：User+Team+Project+TeamMember（缺它 authenticate FORBIDDEN）+Session
  try {
    if (mode === 'sigterm') return await sigtermMode(env);
    return await kill9Mode(env, mode === 'kill9-fault');
  } finally {
    await dropTrigger();
    await cleanupCollabSessionFixture(prisma as any, PID, DRILL_TOKEN).catch(() => {});
    await prisma.$disconnect();
    await rm(spoolDir, { recursive: true, force: true });
  }
}

async function createTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS y0a_drill_block ON "CanvasDocUpdate"`);   // Y22：幂等——CI 取消/硬崩残留触发器会让下次 CREATE 直接红
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION y0a_drill_block() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'drill: insert blocked'; END $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER y0a_drill_block BEFORE INSERT ON "CanvasDocUpdate" FOR EACH ROW EXECUTE FUNCTION y0a_drill_block()`);
}
async function dropTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS y0a_drill_block ON "CanvasDocUpdate"`).catch(() => {});
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS y0a_drill_block()`).catch(() => {});
}

async function kill9Mode(env: Record<string, string>, fault: boolean): Promise<void> {
  if (fault) await createTrigger();            // V7 修正：触发器先于 startServer（先建再写——"触发器前批次已落 PG"的不可判窗口消除）
  const h = await startServer(env); await h.ready;
  const { provider, keys } = await connectWrite(h, PID, NODES);
  await provider.destroy();                    // 停写（断连触发 flush——故障档 flush 失败批入 spool）
  const seqBefore = await prisma.canvasDocUpdate.count({ where: { projectId: PID } });   // V23：反向下限（防"驱动侧没写进去"假绿）
  await barrier(h, { withSpoolStable: fault, requireSpoolNonEmpty: fault });   // X12：三归零判据+故障前置断言
  const accepted = new Set(keys);
  h.child.kill('SIGKILL');                     // kill -9
  await sleep(500);
  if (fault) await dropTrigger();              // 重启前恢复写入
  const h2 = await startServer(env); await h2.ready;
  // X12/N4（V7c 轮询替代 sleep）：回灌完成信号=spool 段回收（files===0）或 30s deadline
  const t1 = Date.now();
  while (Date.now() - t1 < 30_000) {
    const text = await metrics(h2.port, h2.token);
    if (await gauge(text, 'yjs_spool_depth_files') === 0) break;
    await sleep(300);
  }
  const replayed = new Set(await replayKeys());
  const seqAfter = await prisma.canvasDocUpdate.count({ where: { projectId: PID } });
  if (seqAfter < seqBefore) fail(`kill9：行数反向下限失败（after=${seqAfter} < before=${seqBefore}——重启丢行）`);
  const missing = [...accepted].filter((k) => !replayed.has(k));
  if (missing.length > 0) fail(`kill9-${fault ? 'fault' : 'normal'}：已接受集丢失 ${missing.length}/${accepted.size}：${missing.slice(0, 5).join(',')}…`);
  console.log(`DRILL PASS: kill9-${fault ? 'fault' : 'normal'} —— ${accepted.size} 节点 ⊇ 已接受集（RPO 故障腿 ${fault ? 'spool 覆盖' : '≤maxDebounce 窗口外'}）`);
}

async function sigtermMode(env: Record<string, string>): Promise<void> {
  const spoolFail = process.argv.includes('--spool-fail');
  await createTrigger();                       // append 恒败→drain 走 force-spool 路径
  const h = await startServer(spoolFail ? { ...env, DRILL_SPOOL_FAIL: '1' } : env);   // Y14：服务态注入（overCapacity——段路径 mkdir 会被封段滚动绕过）
  await h.ready;                               // X3：startServer env 已含 MINIO_INIT=skip
  const { provider } = await connectWrite(h, PID, NODES);
  await provider.destroy();
  await sleep(1_500);                          // store 失败已发生（批在队列）
  if (!spoolFail) await dropTrigger();         // Y14：仅非故障档 drop——让 drain 的 append 成功走 drain_complete；--spool-fail 档保持 trigger（append 恒败+spool 恒败=undrained 判据确定可达）
  h.child.kill('SIGTERM');
  const out = await new Promise<string>((r) => { h.child.on('exit', () => r((h.child as any).drillStdout())); setTimeout(() => r((h.child as any).drillStdout()), 30_000); });
  const drainDone = /\{"event":"shutdown_drain_complete".*\}/.exec(out)?.[0];
  const undrained = /\{"event":"shutdown_undrained".*\}/.exec(out)?.[0];
  if (spoolFail) {
    if (!undrained) fail('sigterm --spool-fail：期望 shutdown_undrained 点名（G-2a ii 档——不得声称 0）');
    const e = JSON.parse(undrained);
    if (!(e.projects >= 1 && e.batches >= 1 && e.storeInFlight === e.projects)) fail(`undrained 与 storeInFlight 不一致：${undrained}`);   // Y5：projects 键名（e.docs 恒 undefined→两档均红且报错指向错误方向）
  } else {
    if (!drainDone) fail('sigterm：期望 shutdown_drain_complete（G-2a i 档）');
    const e = JSON.parse(drainDone);
    if (!(e.pending.projects === 0 && e.pending.batches === 0)) fail(`drain_complete pending 非 0：${drainDone}`);
  }
  console.log(`DRILL PASS: sigterm${spoolFail ? ' --spool-fail' : ''}（G-2a ${spoolFail ? 'ii' : 'i'} 档）`);
}

void main().catch((e) => { console.error(e); process.exit(1); });
```

（实现注记：①`FIXTURE_USER` 常量与 db-fixtures 的内部常量同值（该文件不 export——脚本内字面量对齐+注释锚定，漂移由演练必红暴露）；②G-2b（机制判据）=Task 3 BOI 用例（vitest 层），演练不重复；③Y0a-3 起 kill9 重启子进程补 `COLLAB_FORCE_TAKEOVER=1`（防被上一持有者租约挡住——本批无租约，登记跨批）。）

- [x] **Step 3: 本地三模式跑通+commit**

```bash
DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=kill9-normal
DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=kill9-fault
DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=sigterm
DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=sigterm --spool-fail
```
Expected: 四跑均 `DRILL PASS`（红相验证：对重写前代码 kill9-fault 必丢批——BOI 留档已覆盖，演练红相可选项：`git stash` 回旧代码跑一次 kill9-fault 留档）。**V20/E13：`@hocuspocus/provider@4.6.0` 已是 devDep（package.json:59）——无安装步**；Step 3 的 commit 文件列表去掉 pnpm-lock.yaml。

```bash
git add apps/api/scripts/collab-drill-server.ts apps/api/scripts/collab-kill9-drill.ts apps/api/package.json && git commit -m "test(collab): Y0a-2 kill9/SIGTERM 演练装置——双模式 quiescence barrier+G-2a 双档点名断言+DB 触发器注入"
```

> **Task 9 执行勘误（2026-10-07 实现裁定，commit `d0be123b`；双阶段审查毕——四跑亲验全 PASS+假绿面三问堵死）**——Task 10 消费者以此为准：
> **载体偏差 6 项**：①**tsx 不可行**（esbuild 不发射 decorator metadata——AppModule DI 链 onModuleInit TypeError 实证）→`tsconfig.drill.json`+tsc 编译+子进程 `node dist/scripts/collab-drill-server.js`（第 4 commit 文件=tsconfig.drill.json 非 package.json）；②**win32 SIGTERM=libuv TerminateProcess 硬杀**（handler 不可达实证）→IPC `process.send({type:'shutdown'})` 主通道+POSIX 保留真信号（CI Linux 走生产同构通道）+closing 闸幂等；③requireSpoolNonEmpty **后置**到 quiescence 后（plan 前置单采样在 debounce 窗内=确定性假红——dev DB 残留两项目为证）；④`shutdown_undrained` 走 logger.error=**stderr**→驱动合并检索；⑤seqBefore 移 barrier 后（注：拦"没写进去"的是 missing-keys 检查——seqBefore 是行数完整性+分型诊断）；⑥**/api/metrics 无全局前缀是 plan 笔误**——controller 实证路径 `/metrics`（CI 步骤用驱动内建路径，无需改）。
> **审查登记**：Major-1（fail() 路径 `process.exit(1)` 绕过 finally——子进程孤儿化+fixture/spoolDir 残留，实证 DB 残留 2 项目+TEMP 2 目录——**Task 10 CI 化前必修**：fail 改 throw 统一清理）+Minor 2/3（ii 档 fail 消息缺 out dump/barrier 超时缺末次采样——Task 10 顺手）+Minor 4（closing 闸只护 IPC 支路——潜伏登记）+Minor 5（触发器函数名全局共享→CI 四跑必须串行——plan 已串行；tsc 首次全量编译无上界→CI 预算计入）。

---

### Task 10: collab-core CI 演练步骤+子批出口核对+跨批登记

**Files:**
- Modify: `.github/workflows/ci.yml`（collab-core job 补 redis+演练步骤）
- Modify: `docs/superpowers/specs/2026-10-06-canvas-yjs-arch-upgrade-review.md`（Y0a 行状态回填）

- [x] **Step 1: collab-core job 扩展（X3 修正：**补 redis+MINIO_INIT=skip**——v2 的"已有 redis"勘误经核验**反了**：ci.yml :95 的 redis 属 e2e-collab job（:85），collab-core（:136-160）只有 postgres；演练子进程 AppModule 含 BullMQ（subscription-scheduler onModuleInit await getRepeatableJobs——无 Redis 即挂起）+MinioModule（无 skip 即 ensureBucket 3 重试后 throw））

services 补 redis（postgres 块之后）+env 补 REDIS_URL/MINIO_INIT/MINIO_*：

```yaml
      redis:
        image: redis:7
        ports: ['6379:6379']
        options: >-
          --health-cmd "redis-cli ping" --health-interval 10s --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgresql://flowweb:123456@localhost:5432/flowweb
      REDIS_URL: redis://localhost:6379/0
      MINIO_INIT: skip                      # X3：B′ 终裁机制（e2e-collab :104 先例）——占位值仅过 validateEnv，skip 路径零连接
      MINIO_ENDPOINT: http://localhost:9000
      MINIO_ACCESS_KEY: drill
      MINIO_SECRET_KEY: drill-secret
```

**X16（int 清单扩——门禁真空修复）**：int 步骤的显式文件清单（ci.yml:158）追加 `src/modules/collab/collab-spool.int.spec.ts`（V6 FK 真库用例的唯一有效证据——不加则文件永不跑而 passed 断言依旧绿）+passed 阈值同步上调（新增用例数——实现时按实际条数计入）。

步骤追加（int 条数断言之后——**演练=本 job 的真增量**：子进程形态 test job 无法跑，spec §4.5③）：

```yaml
      - name: kill -9/SIGTERM 演练（G-1 双模式+G-2a 双档——RPO 契约的唯一测试证明）
        run: |
          pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=kill9-normal
          pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=kill9-fault
          pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=sigterm
          pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=sigterm --spool-fail
```

（本地等价命令=Task 9 Step 3 四条；轮询等待非固定 sleep；drill 子进程 env 由 startServer 内部注入 MINIO_INIT=skip+占位——job 级 env 为双保险。**纪律句（X16）**：新增 `*.int.spec.ts` ⇒ 同步扩 ci.yml int 显式清单+阈值——否则静默漏跑。）

- [x] **Step 2: 子批出口清单核对（spec §4.1 Y0a-2 行——逐项+载体；v2 增 V1/V2/V5 三条）**

```
□ BOI 红→绿（一代 splice-first/三代 fenced-0-行实测留档+**BOI-4 崩溃模拟红相（V19）**；二代=设计论证标注非实跑）〔载体：collab.gateway.spec BOI describe〕——Task 3
□ **V1 confirm 语义：连续两次 append 失败（spool 健康）→两批内容各自独立帧在 spool 可见+段未 unlink；第三次 append 成功后帧才回收**〔载体：collab.gateway.spool-confirm.spec 或 BOI describe 追加〕——Task 3
□ **V2 段封禁：半写注入→封段→新段→重启后坏帧前后帧全部可读**〔载体：collab-spool.service.spec〕——Task 1
□ **V5 卸载交接：真 WS+append/spool 双败→断连→队列存活（gateway Map 归属）+unload_blocked_undrained 点名**〔载体：gateway.spec〕——Task 3/7
□ **V6 FK 真库 int：真删项目行→帧收割（discarded===1+段回收）**〔载体：collab-spool.int.spec〕——Task 2
□ G-1 演练绿（双模式 quiescence barrier 含 storeInFlight===0+seqBefore 反向下限+故障态 spoolFiles>0 前置——V23）〔载体：collab-core 演练步〕——Task 9/10
□ G-2 演练绿（G-2a i/ii 档演练断言+G-2b=BOI 用例机制载体）〔同上〕——Task 3/9
□ quarantine 硬上限用例绿（回灌总预算不阻塞 listen+sidecar 字节区间+容量含隔离字节——"不再阻塞 ready"的 ready 面 Y0a-3 接线核对）〔载体：collab-spool.service.spec〕——Task 2
□ project.gone 清账+FK 兜底断言绿（提交后 emit+回滚无假终态+显式清账点名——处理器零磁盘 I/O）〔载体：project-gone.spec+project.service.spec〕——Task 6
□ mergeUpdates 出 WS 路径红→绿（结构扫描+queue 不折叠断言+门禁先红验证；**V24：契约 3/11/14 不设扫描——行为断言载体**）〔载体：contract-guards+gateway.spec〕——Task 7
□ unflushed 断言改造完成（11 行断言+1 行装置+**V18 行为断言三族：绿9 注释/绿9b rejects→resolves false/persist-status 耗尽→永续**+**Y4：expectDurableEquivalent 辅助体两跳改+pendingUpdates grep 对照表清零**）〔载体：gateway.spec/persist-status.spec〕——Task 3/4
□ **Y24 四门**：①内存上界门——双败注入推 600 条→队列被 coalesce 压回硬阈内（≤513）〔载体：gateway.spec T7〕；②降级可见门——spool 不可写→连接 readOnly+收到 stateless persist-status{healthy:false,reason}+readCanvas 200〔载体：gateway.spec T3〕；③保活门——熔断→probe 恢复（onRecovered seam）→滞留批经退避梯落库〔载体：gateway.spec T4——fake timers 或退避缝〕；④已删项目门——事件时 store 在飞→落定后 yjs_store_in_flight_docs===0〔载体：project-gone.spec〕
□ **Y5 键名一致性**：`computePending` 的 projects 字段在代码/日志/用例/drill 断言/spec §5.2 五处一致（grep 'pending.docs\|e.docs\|yjs_pending_docs' 零残留）
□ pnpm verify 全绿+doc-gate 无漂移——Task 10 Step 2
```

- [x] **Step 3: v8 目录 Y0a 行回填+跨批登记落盘**

`2026-10-06-canvas-yjs-arch-upgrade-review.md` §0.2 Y0a 行：plan 列补 Y0a-2 链接+状态改"Y0a-1 完成；Y0a-2 执行中（plan v3）"。plan 文件本 Self-Review 后追加"跨批登记"段：

**spec 变更落地（已批准 2026-10-07——本 Step 改 `2026-10-06-y0a-data-integrity-design.md` 四处）**：①§2.5"删除**前** emit"→"删除事务提交**后** emit（V11/X13——FOR UPDATE 事务+按确实被删集合）"；②§2.2"容量核算**排除**已隔离字节"→"**含**隔离字节（隔离段同占盘）"+独立字段语义改为可观测口径；③§4.3-8 补 confirm 语义句（新帧 PG 成功前永不 confirm）；④契约 12 补段封禁例外（只置位不删字节，禁 ftruncate）。同批在 §1.4 E21/E37 行内标注执行状态变更（Y0a-2 实际形态）。

**Y0a-3 必办**：①`collabLeaseLostTotal` 的 fenced 分支接 selfIsolate（Y0a-2 已落计数+ERROR——行为占位非死代码，fenced 本批不可达）②`computePending()` 挂 /api/ready.pending（P1——同一实现禁复制；**字段名=projects（Y5）**）③`draining` 状态位接就绪门+POST /api/drain 端点（Task 5 落位；**消费 gateway.isShuttingDown()/isWritableOrDegraded() 两方法——本批无 isAcceptingWork 单方法（Y24 命名统一）**）④spool 熔断对外拒绝面（ready 503 reason=spool-unwritable——P3）⑤G-2a"ready 已转 draining"断言补验（P2）⑥演练子进程补 `COLLAB_FORCE_TAKEOVER=1`（kill9 重启防租约挡）⑦Y0a-1 登记的 gateway.spec:242-244 elapsed 断言重写（extension-redis 删除批）。
**Y0a-4 必办**：ecosystem kill_timeout≥30000+`COLLAB_SPOOL_DIR` 绝对路径 env 注入（E37 runbook：PM2 重启不换 CWD）+collab-core required check 生效验证。
**Y0b 登记**：yjs_store_tail_anomaly 的误报窗窄化（Task 4 已注释）+spool 族告警路由（E54）。
**spec 偏差登记**：P7（redis service 提前后）+P4（脚本载体 .ts）+P5（storeInFlight doc 级口径）+P6（FK=权威证据）——已在本 plan §0.3 裁定表。

```bash
node scripts/doc-gate.mjs   # 仅 [canonical-drift] 时 --write-canonical 并 review diff
git add docs/superpowers .github/workflows/ci.yml && git commit -m "feat(ci): Y0a-2 collab-core 演练步骤(四跑)+redis service+v8 目录 Y0a 行回填——子批收口"
```

- [ ] **Step 4: 向用户汇报出口清单，请求确认进 Y0a-3 plan（执行门）**

---

## 跨批登记（Task 10 落盘——Y0a-3/Y0a-4/Y0b 追加项+执行期新发现）

> Task 1-9 勘误块登记项的跨批出口汇总（Task 10 Step 3 既有 Y0a-3 必办①-⑦/Y0a-4/Y0b 基线之外的新增）；P 系偏差已在 §0.3 裁定表，此处不重复。

**Y0a-3 必办（追加）**：
- ⑧ **T4 I-3**：retryPersist catch 无 fenced 感知——在梯项目转 fenced 后永续重排违契约 15（本批 fenced 不可达）——与 selfIsolate 同点处置（T4 勘误块登记）。
- ⑨ **T3 M3**：retryPersist 帧通道无 isFkGone 收割——已删项目帧续试无终态出口（T3/T6 双登记；修法=isFkGone 判别→帧回收+cancel 梯，与 store 主路径 FK 分支同形）。
- ⑩ **T9 Minor 4**：drill closing 闸只护 IPC 支路——POSIX SIGTERM 真信号支路无闸（CI Linux 同构通道已演练验证，潜伏登记）。

**Y0a-4 必办（追加）**：T5 M-2（drill kit 无"只关 listener"收口）+M-3（destroy 快速 reject 误分型——修复者已写入 spec §4.7 复审登记）。

**Y0b 登记（追加）**：T3 M5——readOnly 置位后无恢复翻转+恢复无 stateless 通告（客户端体验债——spool 熔断解除后存量连接恒只读）。

**观察项（不构成必办，防复审翻案）**：T8 帧解析三常量双实现（spool service 未导出，人工脚本现场重复——Y1c-1 段世代同批收口）；pnpm exec Windows 噪音（exit 码正确传播，直呼 tsx bin 更净）；T6 Minor 3（FOR UPDATE 无 ORDER BY——现实风险≈0，防投机加固）；T7 M-5（契约锚边角假阳/假阴——响偏可接受）；T7 M-6（交接成功后运行期无该项目 PG 排空者——J4 非 at-risk 设计内）；T5 M-4（drain 预算 ≈22.2s 读作近似——kill_timeout 30s 垫不受影响）。

**本步执行期新发现（登记）**：**YAML 死 job**——HEAD `ci.yml` 条数断言行裸 run 标量含 `'FAIL: passed'` 的 ": " 序列=整文件 YAML 解析失败（js-yaml 本地实证+GitHub Actions 同规格必拒）——**Y0a-1 起 collab-core job 从未真正跑过**（int 显式清单+passed≥13 断言从未执行，X16 防线对该 job 失效的根因）。本批判定+块标量修复——**Y0a-3 首个 CI run 必须核验 collab-core 真跑绿**。

**终审收口（2026-10-07）**：I-2 终审收口——force-spool 补批尾锚（全仓唯一无锚 splice=残余蒸发窗：关停窗内 append 挂起时并发折并可断批尾身份→`ids!==null` 无条件 splice 误删未落定批→重启蒸发，违 BOI。修=取批同点取 tailRef，append 兑现后身份校验：不符=tail_anomaly 计数+跳过 splice 留队列点名，与队列其余三处同形；红绿双相 shutdown.spec 用例留档；spec §5.2 指标表同批回填 Y5 判据）。

---

## Self-Review 记录（v3）

- **第三轮外审回响（v4 核心增量）**：三份 v3 复审合并去重后 19 项采纳（Y1-Y24）/6 项拒绝（J1-J6）。核心发现=三报告共同坐实的"**裁定表已改、Task 代码块仍是 v1/v2 原文**"（5 族功能性断裂+7 族编译级残留）——v4 全部在代码块层面修复并**新发现两处三报告均未抓到的断裂**：①段路径 mkdir 注入会被 V2 封段滚动绕过（seg0 EISDIR→seg1 可写=注入只挡一次——T5/T9 故障注入统一改服务态容量位）；②--spool-fail 档无差别 dropTrigger 会让 drain 的 append 成功→drain_complete≠undrained→断言红在错误方向（dropTrigger 移入非故障档分支）。另：裸 Y.Doc 无 saveMutex（T5 drain 直调 TypeError）——seedPendingDoc 补 stub。
- **第三轮外审回响（v3 核心增量）**：三份 v2 复审 51 项主张逐条核验——采纳 19 项（X1-X19）+拒绝 3 项（N2 的 unhandled rejection 推演不成立但其修法经驻留/停摆理由采纳/C6 的 Optional 兜底（自建默认目录污染测试环境）/独立后台排空器（rearmQueurs 退避梯即后台））。两项 v2 勘误错误坐实并回正：collab-core 无 redis（:95 属 e2e-collab）+MINIO_INIT=skip 是唯一解（B′ 终裁先例）。**v3 直接改写 Task 代码块**（v2 的裁定表与施工面脱钩教训——报告二 3.1 共 14 处冲突全部在代码块层面修复）。


- **外审回响（v2 核心增量）**：三份报告 51 项主张逐条一手核验——采纳 25 项（V1-V25，§0.5 总表）/拒绝 8 项（R1-R8 附理由防翻案）/核验后不成立 3 项（R7）；v1 的 1 处蒸发级 bug（confirm 新帧）、2 处预算不可证伪、1 处假绿（FK 形状）、4 处 no-op 基线错全部修正。
- **Spec 覆盖**：spec v2.4 §3 Y0a-2 全项↔Task 映射：2.1 契约声明→T3 Step 2；2.2 spool 单源（分段/帧格式/fsync/**V1 confirm 语义**/**V2 段封禁**/**V3 字节区间隔离**/两态熔断/回灌总预算/键集/指标/**V15 fail-fast**/断言改造/逃生阀）→T1+T2+T3+T8；2.3 BOI 重写（AppendResult 判别/copy-first/不 throw/**V4 队列 projectId 键控**/**V12 降级 spool-first**/saveMutex A14/**V13 isAcceptingWork 三入口**/退避无上限/afterStore 收缩/storeInFlight try-finally）→T3+T4；2.4 关停六步（**V8 预算机制化上界**/force-spool 子预算/**V9 直连宽限入口判定**/结构化日志/分型）→T5；2.5 project.gone（**V11 提交后 emit**〔spec 变更①〕/双订阅/**V10 显式清账**/FK 双形状/§9.10 可见化）→T6；2.6 beforeUnloadDocument（**V5 BOI 交接守卫**+清理）+mergeUpdates 出 WS+PENDING_MAX_ENTRIES 语义变更→T7；G-1/G-2 演练（双模式 barrier **V23 判据升级**/drill **V7 三修**/**V21 env 依赖**/崩溃模拟红相 V19）→T9；collab-core 演练步骤（redis 已有 V20）→T10；§4.2 回滚脚本→T8。
- **冲击面清点（纪律 11）**：unflushed 11 断言行+1 装置行（V20/F7 口径）+**V18 行为断言三族**（绿9 注释/绿9b rejects→resolves/persist-status 耗尽→永续）+6 构造点+pendingUpdates 装置改 pendingQueues（V4）/store.metrics（yjsUnflushedProjects 删+9 新指标）/project+template service（构造注入 EventEmitter2+回滚用例）/collab-document.service（withDoc 受理门）/contract-guards（递归+后顾+**V24 收缩**）/ci.yml（仅演练步骤）/db-fixtures（V7 扩 ensureCollabSessionFixture）。✓
- **失败分支推演（纪律 10 v8.3）**：spool append→目录不可写=ioBroken+批留队列/容量满=overCapacity+拒新编辑（两态分离 V14）；半写→封段滚动（V2）；坏帧→字节区间隔离+不重复计数（V3）；回灌→预算耗尽不阻塞 listen（V16）；FK→双形状判别+真库 int 背书（V6）；fenced 0 行→不抛错走 spool（BOI-2）；双败+断连→队列 gateway 归属存活+卸载被守卫取消（V4/V5）；drain→append 挂起=单 doc 2s deadline+force-spool 2s 子预算（V8）；清理钩子→清理段吞+计数留痕/交接段有意抛（M1/V5）；drill→MINIO env 缺=占位注入/Redis 缺=runbook 前置（V21）。判据可达性：barrier 三条件（docs/batches/in_flight）+故障态前置断言（V23）。✓
- **占位扫描**：无 TBD/TODO；Y0a-3 跨批衔接点（fenced selfIsolve/ready.pending 消费 computePending/POST /api/drain 接 draining/租约释放步骤 6/spool 每实例子目录 R3）全部显式登记于 Task 10 Step 3；drill-server 降级两档写死。✓
- **类型一致性（v2）**：`pendingQueues: Map<string, Uint8Array[]>`+`docProject: WeakMap<Y.Doc, string>`（V4）；`enterInFlight/leaveInFlight(projectId)`+`inFlightProjects: Set<string>`+gauge `storeInFlightDocs`；`storeDocumentUnlocked`（私有体）/`storeDocumentSerialized`（mutex 包装）/`isAcceptingWork()`/`discardForGoneProject`/`drainDetachedProject`；spool：`appendRaw`(私有)/`append`(两态记账)/`probe()`/`isWritable()/overCapacity()/validateDir()`/`replayAll(repo, {budgetMs?, retryDelayMs?, projectIds?})`/`quarantineTruncatedFrames`（字节区间）；模块级 `isFkGone(e)` 单源；metrics 11 个新命名（spool 族 6+yjs_store_in_flight_docs+yjs_store_hook_calls_total+tail_anomaly+pending 2+yjs_deleted_projects+yjs_unload_cleanup_failure_total——yjsUnflushedProjects 删）。✓
- **环境注意**：Git Bash 前缀 env；tsx 经 `pnpm --filter @flowweb/api exec`；演练本地跑需 PG+Redis 起+MINIO 占位 env（V21）；doc-gate 仅 drift 时覆写；`git add` 显式列表；drill 随机端口段 20000+random(20000)。✓

