# Y0a-3 拓扑与租约 Implementation Plan（v4）

> **v4（2026-10-07，第五轮三份外审报告复核后就地修订）**：v3 的机制设计经三报告独立复核确认成立（互斥+接管顺序语义/单点负责制/owner-only/revoked 终态/boot 收养/int 池拆分），本轮修的全是同一病根——**"不变量只写在注释里、新路径没接上旧执行点"**。关键修正：①lease-stub 契约补三件套副作用（repo.setLeaseOwner∧spool.setOwner∧await onAcquired——否则 kit 全链在 scan() 处结构性红）；②depth() 五元组+`depthTotalBytes()` 回填熔断三处（改名后 `d.bytes→undefined` 比较恒 false=**容量熔断静默失效写满磁盘**）+PendingSnapshot 扩展使 gauges=total/部署门=own 在 collect 架构下成立；③listen 错误事件接线（hocuspocus listen() 在 EADDRINUSE 时 **promise 永不 settle**+无 error 监听=isPortError 死代码，已实证 dist）；④`listenCollab` 末尾 `rearmQueues()`+`onRecovered` 接线（v3 重排漏掉的旧不变量——否则 own 帧无恢复路径=**部署门死锁**）；⑤`initDone` 成功后置+`scan()` 临时 map 整体 swap（半截索引上线=门假绿）；⑥`onHeld` 原子化+owner 构造期有界（长 hostname→setOwner throw=半 held 僵尸复刻）；⑦`everHeld`+attemptAcquire 内 revoked 门（unknown-expired 隔离不查行=被撤实例经 `expiresAt<now()` 抢回）；⑧三入口统一读 `gateway.isLeaseServing()`（消灭与 lease.isServing 的判据分裂）；⑨读出口按**可变性三分法**（clone 是语义写——改快照会静默丢 ≤2s 编辑）；⑩T3 mock 断言值化（tagged template 插值不在文本里——文本断言=永久红+诱导 SQL 内插）。新增 §0.7 全局不变量八条（每条=执行点+可红断言）。五轮裁定记录见 §0.6。

> **v3（2026-10-07，第四轮三份外审报告复核后重写）**：本版是**单一权威正文**——v1/v2 的分层改写块已物理内联，被推翻的代码与断言全部删除（旧版仅存于 git 历史）。第四轮裁定增量：启动链单点负责制（语句层 `$transaction{timeout:2s}` 有界+`dispatchAcquired` 单点）；指标 labelNames 全量补齐（B8）；owner 文件系统安全形态（W4）；break-glass `'revoked'` 哨兵+终态不 rejoin（W7）；外来段 boot 即收养+截尾分档（P18）；int spec 从默认测试池排除（P15）；append 取 compact 同 key advisory lock（W14）；leaseRowMissing 批走 spool 不排梯（W11）。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 Y0a 第三子批——**删 extension-redis/CollabRedisSync**（单实例拓扑钉死，census 清零+pin 两正则）+ **PG 租约**（E44/E35：CAS 获取〔自愈 seed〕/心跳三态 renewed|fenced|unknown〔owner-only 判据〕/break-glass 运维脚本〔'revoked' 哨兵+审计行〕/**fence 下沉写语句**〔owner-only EXISTS+leaseRowMissing 区分+setLeaseOwner 单点注入，契约 16〕/lost→rejoin 状态机/revoked 终态）/三入口门 P0-1/**spool 每实例子目录 R3**（owner 必填+文件系统安全名+外来段 boot 收养+reconciler 自愈）/ **/api/ready 与 /api/health 拆分**（reason 八值封闭枚举+collabState 主导派生+pending 含 storeInFlight/stranded 分区+**POST /api/drain 三步部署前置**〔冻结连接+刷新幂等+60s 解除 1012 复连〕）+ **readCanvas 按消费者拆分**（计费类 503 fail-closed/投影类 readSnapshotOnly——repo"一个实现、两出口"）+ 项目种子 PG 侧同事务落库 + Y0a-2 跨批登记必办①-⑩全量收口（spec v2.5 §3 Y0a-3 节）。

**Architecture:** 租约=**互斥+接管顺序**的活性机制非数据完整性，不提供活性自检——TTL 唯一作用=崩溃后多快被接管（RTO 参数），不参与任何正确性判定（正确性=CAS 改 owner+写语句 owner 断言+PG delta 并集+CRDT 幂等；SV1 注释写死防"顺手加回 TTL 守卫"）。owner=每次启动文件系统安全形态 `host-pid-ts36`（同时是 spool 子目录名）；epoch 单调（break-glass 亦 +1）。启动链=**单点负责制**：凡 lease state→held 必经 `dispatchAcquired` await 启动回调（gateway 绝不直调 start），语句层 2s 有界（PG 黑洞不拖死 HTTP 绑定）——`await onModuleInit()` ⇒ serving 或 start-failed（kit 不变量保持）。启动次序=租约获取先于 listen/spool 回灌；关停步骤 6 显式 release+halt（deploy 不等 TTL）。ready 503 判据=PG+租约+collabState（Redis 仅报不 gating）；draining 与 /api/drain 同一状态位（collabState 单枚举七态，消灭布尔组合）。

**Tech Stack:** NestJS/Prisma/PG16（make_interval 参数化 TTL/advisory lock 同 key 串行）/yjs 13.6.32/@hocuspocus/server 4.6.0/vitest（默认池排除 int+int 专用配置串行）/prom-client（labelNames 声明先行）/ioredis（受管工厂 REDIS_CLIENT 注入）。

**执行门（spec §2.1）**：**Task 0（spec v2.5 回填 SV1-14）经用户批准后**进 TDD；Task 10 出口清单全绿后**请用户确认再启动 Y0a-4 plan**。

**TDD 纪律**：先失败测试（红）→最小实现（绿）→commit。**探针前置（v8 目录第 10 条）**：新守卫落地附最小可复现构造；**失败分支推演（v8.3 增补）**：每守卫写出①依赖缺失②依赖异常态③判据可达性三型行为表（§0.5）。

---

## 0. 基线快照（2026-10-07 一手核验，master=e9b1567f，Y0a-2 收口后；v3 修正行号漂移）

### 0.1 代码基线表（当前行号——全部当日 grep/read 实证）

| 位置 | 现状 | spec 引用 |
|------|------|----------|
| `collab.gateway.ts:5-6` | `import { Redis as RedisExtension }` + `import Redis from 'ioredis'`（extensions 块专用） | §3.1 删除面 |
| `collab.gateway.ts:13/:137` | `import { CollabRedisSync }` / 构造参数 4=redisSync | §3.1 |
| `collab.gateway.ts:174-182` | Server `extensions: [new RedisExtension({ createClient, disconnectDelay: 200 })]` | §3.1（disconnectDelay 随删） |
| `collab.gateway.ts:203-210` | authenticate X9 受理门（isShuttingDown 拒 DRAINING+spool 只读降级）——**租约门插此块** | §3.2 三入口门 |
| `collab.gateway.ts:260/:296` | loadDocument / `await this.redisSync.syncFromPeers(documentName, document, 1000)`（装载 1s 阻塞——删=确定性收益） | §3.1 |
| `collab.gateway.ts:380-461` | storeDocumentUnlocked：fenced 分支 :388-390（ERROR+批走 spool :433+不排梯 :460）——**selfIsolate 接线（必办①）+leaseRowMissing 分支（N4）插此** | §3.2/契约 15 |
| `collab.gateway.ts:543-546` | `isShuttingDown()/isWritableOrDegraded()`——draining 位 :108-109 并入 collabState（SV15 并入 SV7） | §3.3 |
| `collab.gateway.ts:570-577` | `computePending(): {projects,batches,spoolFiles,spoolBytes}`（Y5 键名）——ready.pending 消费同实现（必办②禁复制）+扩 storeInFlight/stranded | §3.3/P1 |
| `collab.gateway.ts:636-650` | schedulePersistRetry（X6 熔断首行 return）——**isolated 门插首行（必办⑧/I-3）** | 契约 15 |
| `collab.gateway.ts:699-706` | retryPersist detached 帧通道——**无 isFkGone 收割（必办⑨/M3）** | T5 修 |
| `collab.gateway.ts:802-839` | onModuleInit（getDocument 注入 :804/spool.scan :807/replayAll :813/自检 :816/rearm :822/validateDir :824/listen :825/sweep+seam :826-829/事件 :831-838）——**租约先于 listen 重排主对象** | §3.2 四语义 |
| `collab.gateway.ts:848-851` | startSessionSweep=`this.sessionSweepTimer = setInterval(...)` **无 clear-first**（rejoin 泄漏定时器——M2② 修） | T5 |
| `collab.gateway.ts:918-925` | closeAllConnections1012（只关连接不关 listener——isolate 需补 httpServer.close） | §3.2 |
| `collab.gateway.ts:931-954` | onApplicationShutdown 六步；:933 步骤 1 置 draining；:952 步骤 6 占位——**release+halt 落此（≤2s race）** | §2.4 步骤 6 |
| `canvas-doc-update.repository.ts:17-29` | append 单语句 AppendResult（无租约断言无锁——**fence owner-only EXISTS+advisory lock 追加**） | §3.2/契约 2 |
| `canvas-doc-update.repository.ts:40-70` | loadForHydration 单 RR 事务——**readConsistent 私有化（cursor 0n）+readSnapshotOnly 第二出口** | §3.2 |
| `canvas-doc-update.repository.ts:116-151` | compact（:122 advisory lock+pendingStructs+{compacted,reason}）——**事务首行租约断言（not-owner 分立）** | §3.2 |
| `collab-spool.service.ts:42-46` | `segFileName/parseSegFileName`——段键改文件名键+meta.dir（R3） | R3/T4 |
| `collab-spool.service.ts:55` | `index: Map<projectId, Map<segSeq, SegmentMeta>>`——键改 segKey（P11） | T4 |
| `collab-spool.service.ts:172-236` | appendRaw——活动目录+滚段计算改 meta.seq | T4 |
| `collab-spool.service.ts:240-261/:266-298` | peek（:250 以 frameCount 为界循环）/confirm——跨 owner 排序+segKey 解析 | T4 |
| `collab-spool.service.ts:346-381` | scan：:348 `this.index.clear()`（幂等重建——**rejoin 重复投递不变量注释**）+外来段收养分档 | T4 |
| `collab-spool.service.ts:388-441` | replayAll——扩 `opts:{projectIds}` 定向回灌（reconciler 复用单源） | T4 |
| `collab-redis-sync.service.ts`（73 行）+ `.spec.ts` | 删除对象（census §1.3） | §3.1 |
| `collab.module.ts:6/:18-24/:29` | COLLAB_REDIS factory+CollabRedisSync provider——删；+Lease/Ready/Audit/REDIS_CLIENT/Controller 注册 | §3.1/T2/T7 |
| `collab.gateway.multi-instance.spec.ts`（32 行） | Redis extension 挂载断言——**整删改写为租约 fail-fast（G-3 载体）** | §3.1/§6.1 |
| `collab.gateway.spec.ts:228-232` | elapsed<3000 断言+disconnectDelay 注释（:275 第二处注释）——**必办⑦ 随扩展删除重写** | §3.1 |
| `new CollabGateway(` 构造点 | 4 直构 spec（auth-reason/persist-status/sweep/env）+kit（dual-client-server.ts:51）——参数 4 redisSync→lease stub | T5 冲击面 |
| `dual-client-server.ts:51-52` | 构造+`await gateway.onModuleInit(); // async+await listen——无端口竞态`——**lease stub 契约必须维持此不变量（W5）** | T5 |
| `collab-document.service.ts:16-34/:70-82/:88-102` | withDoc（租约门=T7 前置至 T5 三入口③）/writeNodeData/writeExecStatus（X9 写意图门+租约档） | §3.2 |
| `packages/shared/src/constants/collab-auth-reason.ts` | 六档（draining 末尾）——+LEASE_NOT_READY 追加末尾（值即线上协议串只增不改） | §3.2/Y21 同款 |
| `apps/api/src/auth/auth.guard.ts:5-18` | PUBLIC_PREFIXES——**+'/api/ready'+'/api/drain'** | §3.3 |
| `app.module.ts:57/:94-95` | ThrottlerGuard 全局 300/min——两端点 @SkipThrottle() | §3.3 |
| `prisma/schema.prisma:477-486/:584-601/:847-852` | AuditTargetType 无 collab 族值（+COLLAB_LEASE 迁移）；AuditLog 先例 team.service.ts:188；CollabLease（scope/owner/epoch BigInt/expiresAt TIMESTAMP(3)→**迁移 timestamptz(3)+新增 renewedAt**） | §3.2/P2/Z19 |
| `apps/api/prisma/verify-indexes.sql:25-26` | `owner IS NULL AND epoch=0` 原始态断言——**改不变量断言+AuditTargetType 枚举块（Z1）** | T1 Step 6 |
| `health.service.ts` / `health.controller.ts` | /api/health 仅 SELECT 1（不动） | §3.3 |
| `execution.service.ts:74` / `video-project.service.ts:92` | **计费类** readCanvas（exec 烧钱输入）——租约失守→503 fail-closed | §3.2 拆分 |
| `video-work.service.ts:328` / `video-work-clone.service.ts:33` | **投影类** readCanvas——改 readCanvasFromSnapshot 出口 | §3.2 拆分 |
| `project.service.ts:43-63` | 事务先提交（CanvasProject+ProjectMember）→ withDoc 后置种子——**种子改 PG 侧同事务落库（报2 P1-3 修法，T8①）** | T8 |
| `apps/api/src/test-utils/dual-client-server.ts:49-57` | kit 构造——+lease stub 默认 serving-fast（契约：成功⇒已 await onAcquired） | T5 |
| `apps/api/src/test-utils/mock-repo.ts` | createMockRepo（append 恒 ok:true）——mock 层无 fence，不改 | — |
| `apps/api/vitest.config.ts` | **无 exclude 无 fileParallelism**——默认池并行跑全部 `*.int.spec.ts`（test job 双跑互踩实证）——**默认池排除+新增 vitest.int.config.ts（W13）** | T3/T9 |
| `apps/api/package.json:8-10` | `test`="vitest run"（默认池）；`test:int` 已存在——改 `-c vitest.int.config.ts --no-file-parallelism` 形态 | T3/T9 |
| `apps/api/src/common/redis/managed-redis.ts:14-20` | `createManagedRedis(url?, options?)` 第二参存在+onApplicationShutdown duck-type——**CollabModule 自带 REDIS_CLIENT provider（N11：7 模块各自 provide 非全局，已实证）** | T7 |
| `scripts/check-hocuspocus-pin.mjs:7-8` | `EXPECTED=['provider','server','common','extension-redis']` 单正则——**extension-redis 移除+yjs 独立正则**（P5：common 保留） | §3.1 |
| `scripts/gate-collab.mjs:56-70/:20-28` | waitForApiHealth 轮询 /api/health+waitForPort(3001)——**切 /api/ready 双验+TTL=2000 env（W17，无 FORCE）** | §3.3/T10 |
| `apps/api/scripts/collab-kill9-drill.ts:61-85/:163-189` | startServer（随机 port+wsPort=port+1）/kill9Mode（:174-187 轮询 depth_files===0 30s）——**+清租约行 helper+handover 模式（固定共享 wsPort）** | §3.2/T9 |
| `apps/api/scripts/collab-drill-server.ts:20-27` | enableShutdownHooks+IPC closing 闸——**POSIX SIGTERM 支路无闸（必办⑩：弃 enableShutdownHooks 改手动 handler）** | T9 |
| `.github/workflows/ci.yml:27-52/:136-188` | test job（:32 DATABASE_URL+:50 pnpm verify→默认池 int 并行）+collab-core（int 显式清单+四跑演练）——**test job 消 int（配置排除）+collab-core 集合断言+handover** | §4.5/T9 |
| `apps/api/scripts/collab-spool-import.ts` / `collab-spool-quarantine.ts` | import=纯 service API（子目录化自动兼容，**租约行接管 W20 守卫**）；quarantine=自有 readdir 平铺（**改 listSpoolFiles 单源**） | T4 |
| `apps/api/scripts/collab-compact.ts` | tsx+tsconfig.scripts.json 静态载体先例——**改租约行接管（健康持有者需 --force，W20）** | SV8 |
| `deploy.sh:59/:95` | 两处 `--kill-timeout 10000`——**→45000（W18：HTTP dispose 等在飞请求+22s 关停链+余量）** | SV6 |
| `.claude/launch.json:32` | api-b（3002/3003）开发期双实例装置——**改 handover 专用注释（单主机双实例真相=N15）** | T9 |
| `apps/api/src/config/env.ts` | zod（LEASE_* 收口归 Y0a-4——本批直读 process.env+构造断言 Z18） | §3.4.6 |

### 0.2 库/事实锚（本批消费；v3 修正+新增）

| # | 事实 | 证据 | 消费点 |
|---|------|------|--------|
| B1 | PG16 `UPDATE ... RETURNING` 返回**新值**（无 old-returning） | PG 语义 | break-glass 脚本先 SELECT 前任（T2） |
| B2 | `INSERT ... SELECT ... WHERE EXISTS ... RETURNING`：EXISTS 不满足=0 行=RETURNING 空（**不抛异常**） | PG 语义/契约 15 同源 | T3 append fence |
| B3 | `make_interval(secs => $n)` 接受参数化 float8 | PG 文档 | T2 |
| B4 | Nest `app.close()`=callDestroyHook→callBeforeShutdownHook→**dispose()（httpAdapter.close()，await 在飞请求结束）**→callShutdownHook（nest-application-context.js:118-123 实证）⇒ **HTTP 先于 onApplicationShutdown 关闭——关停窗口内 /api/ready 不可达；draining 可见性只能由 SIGTERM 前 POST /api/drain 达成（SV12）** | Nest 生命周期+两轮核验 | T7/T9 |
| B5 | `enableShutdownHooks` 内部自注册 process.on(SIGTERM)——drill-server 要自持 closing 闸必须弃它改手动 handler（必办⑩） | drill-server 现状 | T9 |
| B6 | `ALTER TYPE ... ADD VALUE` 自 PG12 起可在事务内执行 | PG 文档 | T2 迁移 |
| B7 | **hocuspocus 4.6.0 re-listen 结构可行**：httpServer/crossws/setupHttpUpgrade 全在构造函数（dist :1655-1679）；`listen()` 仅 `this.httpServer.listen(listenOptions)`（:1681-1698）；信号注册以 `stopOnSignals` 为门（:1684）且本仓 `collab.gateway.ts:167` 显式 false ⇒ **二次 listen 不重复注册信号 handler**。`destroy()` 被 destroyPromise 记忆化（不可逆）——isolate 用 `httpServer.close()`（公开字段）不用 destroy | dist 一手核验（v3） | T5 isolate/re-listen、T9 handover 变体 2 |
| B8 | prom-client 对未声明标签的 `inc({...})` **直接 throw**（`Added label "cause" is not included in initial labelset`——validation.js:21）⇒ 指标 labelNames 必须声明先行 | node_modules 一手核验（v3） | T2 Step 2 |
| B9 | Express `server.close()` 等待在飞请求结束（Node ≥19 自动关空闲 keep-alive）⇒ 关停预算含 HTTP dispose 项（长 REST=execution 外部 AI 调用/clone 10s）——kill_timeout 取 45000 | Node/Express 语义 | T9 deploy.sh |
| B10 | vitest 默认**文件级并行**且 vitest.config.ts 无排除设置时 `vitest run` 跑全部 `*.int.spec.ts`（test job :32 设 DATABASE_URL+:50 verify=双跑互踩）⇒ 默认池排除+int 专用配置（fileParallelism:false） | vitest.config.ts+ci.yml 一手核验（v3） | T3/T9 |
| B11 | `REDIS_CLIENT` 为**各模块自带 provider**（7 模块+app.module 各 provide 一份，非全局共享）；`createManagedRedis(url?, options?)` 第二参存在且产物 duck-type 带 onApplicationShutdown ⇒ CollabModule 自带 provider 即可，ReadyService 不再自建裸 ioredis/不再手写 shutdown | managed-redis.ts:14-20+grep 实证（v3） | T7 |
| B12 | `connection.readOnly` 为可变实例字段且库消息循环**逐条 update 查它**（readOnly→回 writeSyncStatus(false) 丢更新）——drain 冻结既有连接的机制依据；但**客户端无从得知**⇒ 解除必须 1012 复连（provider `onClose` 不看 close code、`shouldConnect` 为真即自动重连——冻结期客户端单侧编辑经重连握手的状态向量交换补回） | hocuspocus server dist :284-287+provider dist onClose（v4 核验） | T5 beginDraining |
| B13 | hocuspocus `listen()` 的 Promise **只在 listening 回调内 resolve**（onListen 钩子抛错才 reject），且 `httpServer` 全库唯一 `.on` 是 `'upgrade'`——**无 error 监听** ⇒ EADDRINUSE 时 promise 永不 settle+error 事件 unhandled（Sentry 吞=持锁僵尸）⇒ gateway 必须**自接线 `once('error')` 转 reject**，端口类失败有界持锁重试（≤2 次）后 release | dist :1624/:1693-1712 一手核验（v4） | T5 listenCollab |
| B14 | Prisma tagged template（`$queryRaw\`...\${v}...\``）传给 mock 的第一参是**字符串数组**、插值在后续参数——`String(args[0])` 不含值 ⇒ mock 断言必须**断言绑定值**（`call[0].join('?')` 看形状+`call.slice(1)` 看值，仓内惯例 video-work.service.spec:351）；文本断言永不红=诱导 `$queryRawUnsafe` 内插（注入面） | 既有 spec 惯例（v4 核验） | T3 Step 2 |
| B15 | 现有 depth 双 gauge 是 **collect 形态**（`pendingCollector()` 快照现算，store.metrics:75-86），全仓无 set 调用点 ⇒ "gauges=total/部署门=own"必须经 **PendingSnapshot 扩字段**实现（collector 契约加 stranded*，gauge 体取 own+stranded 之和）——不存在"改 set 处"这个操作 | store.metrics.ts+gateway:186 一手核验（v4） | T4/T5 |

### 0.3 plan 级设计裁定（spec 留白/冲突处定死；执行中不得再议——v3 存活项，被推翻项已删）

| # | 裁定 | 理由 |
|---|------|------|
| P1 | **loadDocument 门与 Y0a-2 X9"loadDocument 永不 gate"并存**：X9 的范围=spool 熔断/draining **降级态**（读可用性）；本批 loadDocument 首行只挂**租约门**（正确性门：未持租约的进程装载 doc=分叉风险）。两判据分立不混写 | 一个管可用性一个管正确性 |
| P2 | **AuditTargetType 加 `COLLAB_LEASE`（迁移）**：Prisma 封闭枚举不扩则 create 必败；targetId='primary'（scope 值） | 枚举封闭性 |
| P4 | **env zod 收口归 Y0a-4**；本批 LEASE_* 直读 process.env+**构造期不变量断言**（TTL>0 ∧ 0<HB≤TTL/2，越界 throw——Z18） | 批次边界 |
| P5 | **pin EXPECTED=['server','provider','common','yjs'] 两条正则**：现文件本含 common（批0e 存在性断言）不弱化门禁；yjs 独立正则（非 @hocuspocus scope，单正则永不匹配=静默绿） | check-hocuspocus-pin.mjs:7-8 实态 |
| P6 | **ready reason 优先级**：`pg-down > draining > lease-error > lease-lost > not-serving > lease-held > lease-not-acquired > spool-unwritable`；ready=true 当且仅当全空。**collabState 主导派生（W12/M6）**：isolated→lease-lost；held∧未服务→not-serving（start-failed 不再伪装 lease-not-acquired——两种运维动作分流）；acquiring 才看 lease diag | 判据可断言性+值班可操作性 |
| P7 | **repo owner===null 显式 throw（`lease-owner-not-set`）**：null 只可能是"lease service 从未注入"（排序/配置错误）——伪装 fenced 会触发自隔离+spool 污染方向 | 配置错误不伪装 |
| P9 | **启动链单点负责制（W5，替代 v2 的 2s race）**：lease 语句层 `$transaction{timeout:2000,maxWait:500}` 有界（PG 黑洞时 tryAcquireFast 必然 settle）+`dispatchAcquired` 单点（凡 state→held 必经它 await onAcquired；gateway/fast path/acquireLoop/rejoinLoop 均不自行其是）+**lease-stub 同契约**（成功⇒已 await onAcquired——kit `await onModuleInit()⇒已 listen` 不变量保持，dual-client-server.ts:52） | N3/P0-3/C1 三报告共识 |
| P10 | **acquireLoop=急重试 30×1s+passive 按行到期等待**（SELECT expiresAt→sleep min(剩余+100ms,5s)+10% 抖动——卡死进程 RTO=ttl+ε 而非 30s）；`halt()` 关停闸（acquireLoop/rejoinLoop/心跳退出；sleep 均 unref——事件循环不被吊住，M3/N9） | 可运维性 |
| P11 | **spool 段键从 segSeq 数字改段文件名键+SegmentMeta 增 `dir/seq/foreign` 字段**：平铺 index 无法表达"前任与我在各自目录各有 seg 0"；frameId=`<segKey>:<idx>`（segKey 含 `/` 无 `:`，confirm 按 lastIndexOf(':') 解析）；`listSpoolFiles(dir)` 导出单源 | R3 的最小正确实现 |
| P13 | **既有 int spec 补 `ensureLeaseFixture`**：`INSERT ... ON CONFLICT (scope) DO UPDATE SET owner=$1,"expiresAt"=now()+interval '1 hour'`（Z17 同判——行缺失自建不静默 0 行）；四个既有 int spec beforeEach 接入 | fence 的测试面连锁 |
| P14 | **G-3 红相守卫**：红相阶段对旧 gateway 构造——旧代码参数 4 消费 `syncFromPeers`，kit 默认 stub 不带该键=旧代码 loadDocument TypeError；红相验证以"G-3 不 listen"与"authenticate 拒"两例为主断言 | 红相物理可造 |
| P15 | **int 测试架构（W13，Z22 根修）**：默认 vitest 池 `exclude: ['**/*.int.spec.ts']`（verify/test job 不再触 int——并行互踩+本地库状态影响 verify 整类消失）；新增 `vitest.int.config.ts`（含 int+fileParallelism:false）；CI 断言改**文件级集合比较**（`git ls-files '*.int.spec.ts'` basename 集 ≡ int.json testResults 集+零失败零跳过）；本地 int 命令=`pnpm --filter @flowweb/api test:int` | B10 实证 |
| P16 | **深度两口径单源（W6/N10/SV11）**：`depth()` 返回 `{ownFiles,ownBytes,strandedFiles,strandedBytes,quarantinedBytes}`；**gauges yjs_spool_depth_*（容量告警+G-1 barrier 判据）=total（own+stranded 磁盘真值）**；**部署门判据=own（drainable）**；stranded 单独透出（ready.pending.stranded*）——同一根数字不得承担两种口径 | N1/N10 |
| P17 | **handover 演练固定共享 COLLAB_PORT（W16/M7）**：A/B 同 wsPort（HTTP 端口各异）——否则 B listen 永远成功，listener 让位/EADDRINUSE 断言全部落空；TCP connect 探针测 listener 占用 | M7 |
| P18 | **外来段 boot 即收养（W6/N1 修法 A，Z12 修订）**：scan 对外来段完整解析（可回灌——保 G-1 演练 30s 预算与"重启即达"RPO），**截尾分档**：本 owner 段坏尾=truncated 报告+sidecar+计数（磁盘故障可观测）；外来段坏尾=静默截断到最后完整帧+sealed=true（前任 kill 瞬间半写=常态非故障）。运行期新出现的外来段归 reconciler（mtime 静默 60s 收养） | N1 三方矛盾的正解 |
| P19 | **rejoin 重复投递不变量（M2③）**：scan() 首行 index.clear()=幂等重建——已落 PG 未 unlink 的帧重新可见→重复回灌=CRDT 幂等无害（既有启动行为同款）；**禁止依赖 confirmed 集跨世代存续**；隔离期残余批次经 doc 卸载 flush→fenced→spool 自然落定（无需 force-spool 前置） | scan:348 实证 |
| P20 | **读出口按可变性三分法（V18，替代 v3 的计费二分）**：只读展示（video-work.service:328 分享/渲染）→`readCanvasFromSnapshot`（可接受去抖窗陈旧）；**语义读=写操作前置**（clone:33 复制、video-project:92 regenerate 校验）→`readCanvas` 活 doc+租约门 503（**改快照=克隆静默丢 ≤2s 编辑**——clone 是用户可见的写操作）；计费读（execution:74 带 sv）→`readCanvas`+fail-closed 503。T8 快照出口仅 1 处 | clone:33 经 readCanvas（withDoc 活 doc）实证 |
| P21 | **ready 公开/授权两档（V17）**：无 token → `{ready, reason, redis, epoch}`（探针/gate 所需）；有效 `x-prometheus-token`（PROMETHEUS_TOKEN/COLLAB_ADMIN_TOKEN）→ 全字段（holder/pending/stranded/holderRenewedAgoMs/spoolQuarantined）——/api/ready 在 PUBLIC_PREFIXES 且 nginx 代理 /api（前端同前缀）=公网可达，holder 含 host+pid 属内部信息；drill/gate 已持 token | PUBLIC_PREFIXES+部署形态（v4） |
| P22 | **listen 失败可观测+有界（V10）**：`once('error')` 转 reject（B13——promise 悬挂修复）；端口类失败**持锁有界重试 ≤2 次**（5s 间隔）后 release+重获取（非租因故障不无限挡站）；`starting` 态在飞闸防 watchdog/5s 定时器并发重入 | B13+报告共识 |
| P23 | **锁键单源+INSERT 静态断言（V26）**：append/compact 的 advisory lock SQL 抽私有单源 `lockProject(tx, projectId)`（任何一处漂移=stateSeq 静默变谎话）；新增 ratchet spec 断言 `INSERT INTO "CanvasDocUpdate"` 仅出现在 canvas-doc-update.repository.ts（body-param-ratchet.spec.ts 先例形态） | W14 的守卫面 |

### 0.4 跨批登记消费表（Y0a-2 plan Task 10 落盘→本批 Task 映射；执行完逐项打勾）

| 来源 | 项 | 落点 |
|------|----|------|
| 必办① | collabLeaseLostTotal 的 fenced 分支接 selfIsolate | T5（接线）+T2（指标{cause}） |
| 必办② | computePending() 挂 /api/ready.pending（同一实现禁复制；字段名=projects） | T5/T7 |
| 必办③ | draining 位接就绪门+POST /api/drain（并入 collabState） | T5/T7 |
| 必办④ | spool 熔断对外拒绝面（ready 503 reason=spool-unwritable） | T7 |
| 必办⑤ | G-2a"ready 已转 draining"断言补验（**改 SIGTERM 前 POST drain→轮询**——B4 修正） | T9 |
| 必办⑥ | 演练子进程 FORCE——**改判：startServer 前清租约行（Z16 等价自动化），默认 TTL 接管路径由 handover 覆盖** | T9 |
| 必办⑦ | gateway.spec elapsed 断言重写（extension-redis 删除批；锚 :228-232） | T6 |
| 必办⑧ | I-3：retryPersist/schedulePersistRetry 无 fenced 感知——isolated 门 | T5 |
| 必办⑨ | M3：retryPersist 帧通道无 isFkGone 收割——帧回收+cancel 梯 | T5 |
| 必办⑩ | drill closing 闸只护 IPC 支路——POSIX SIGTERM 支路补闸 | T9 |
| R3 | spool 每实例子目录 dir/\<owner\>/（owner=租约 owner 同值·文件系统安全形态） | T4 |
| V22 | collabLeaseLostTotal 指标落 metrics（Y0a-2 移入） | T2 |
| X16 | 新增 *.int.spec.ts ⇒ int 专用配置+集合断言（P15 根修） | T3/T9 |
| 执行期发现 | YAML 死 job 已修——**本批首个 CI run 必须核验 collab-core 真跑绿** | T9/T10 |
| spec §3.1 | 装载 P95 改善落档（少 1s 阻塞+disconnectDelay 消失两处行为变化） | T10（spec 回填注记） |

### 0.5 失败分支推演（纪律 10 v8.3——每守卫三型行为表；v3 全量更新）

| 守卫 | ①依赖缺失 | ②依赖异常态 | ③判据可达性 |
|------|-----------|-------------|-------------|
| 租约获取（CAS+自愈 seed） | 行缺失→同事务 INSERT ON CONFLICT 自愈重建（Z17）——获取路径 leaseRowMissing 结构性不可达 | PG 不可达→$transaction 2s 超时 reject→急重试 30×1s→passive 按行到期续试；进程保活 not-ready 不退出（halt 才停） | 持有者宕机：TTL 过期后 CAS `expiresAt<now()` 支路（handover 默认变体）；break-glass 后：'revoked'+expiresAt=now()→同支路立即可得 |
| 心跳三态（owner-only） | —（held 态才跳） | UPDATE 抛错=unknown：1s 重试直到**单调钟到期**（hrtime——禁 DB/应用双时钟域）才 isolate；0 行→二次查分流：行缺失→statementFailed/lease-error（不隔离不伪装）；owner='revoked'→revoked 终态（不 rejoin）；他人→fenced 立即 isolate+rejoin | 三态+revoked 全部可注入（mock reject/0 行/owner 值） |
| fence EXISTS（append） | 行被删→二次查空→leaseRowMissing throw→**gateway 落 spool 不排梯**（W11——早退=内存滞留重启丢批） | fenced（0 行+行在）→批走 spool+自隔离（契约 15） | 真库 int：A 持锁→B 夺→A append 0 行（G-3b） |
| /api/ready | PG down→pg-down（先判） | 语句失败+PG 通→lease-error；held∧未服务→not-serving（看门狗/启动失败整类出口） | 八档全注入用例（G-4）+503 响应体可解析（部署判据读体不读码） |
| /api/drain | 端点不可达（旧版本）→部署链 runbook 注明跳过（Y0a-4） | 置位后部署中止→60s 自动解除+**冻结连接 1012 复连**（B12——readOnly 直翻 false 会漏冻结期单侧编辑的静默分叉）；重复 POST=刷新 deadline | 演练：POST→ready draining→SIGTERM（T9 G-2a ii——B4 修正后唯一可达序） |
| spool owner 子目录 | owner 未设→activeDir throw（fail-closed；生产唯一写者=lease 必先 setOwner） | 前任进程并发写→各写各的子目录（同名段物理分置）——坏帧面消灭；运行期新外来段→reconciler 60s 静默收养 | 双 service 实例同根目录用例+handover 跨 owner 回灌 |
| 三入口门 | lease stub isServing=false→authenticate 拒（LEASE_NOT_READY 瞬态档）/loadDocument throw/withDoc 503 | 租约失守瞬间在飞连接→selfIsolate closeAll1012+**释放 listener**（httpServer.close——B7）；纯 DB REST 不受影响 | G-3 直构用例：第二 gateway 不 listen（listen spy） |
| 启动链（单点负责制） | onAcquired 未接线→state='held' 但无启动→看门狗 30s ERROR+inc+start-failed 自愈再调度（W22 每 episode 至多 1 次） | startCollabAfterLease 抛错（scan/listen）→start-failed+release+5s 重试；**listen 端口类失败不 release**（旧持有者 ≤1 心跳让位——N2③ 持锁重试） | PG 黑洞 2.1s→$transaction 超时→acquireLoop（无 race=无"后台悄悄成功"僵尸）；handover 变体 2=listener 让位演练载体 |
| rejoin | documents 未卸载（mutex 持有）→listenCollab 前置轮询 ≤5s 未达→跳过本轮（留 isolated 等下轮退避——**拒绝用陈旧 doc 服务**） | listener close 未完成→await listenerClosed 再 re-listen（M2①） | 定时器 clear-first（M2②）；重复投递幂等（P19） |

### 0.6 外审裁定记录（2026-10-07 三轮共九份报告的决策日志——**历史记录，非执行依据**；执行依据=本版正文）

**第二轮（v1→v2）**：采纳 Z1-Z28 共 28 项（心跳 owner-only/fence 去 TTL/collabState 状态机/错误域拆分/not-serving 档/isolate 关 listener+rejoin/reconcile 自愈/break-glass 替 FORCE/自愈 seed/timestamptz+renewedAt/not-owner 分立/int 串行+集合断言/kill_timeout/handover 三变体/真库活性用例/leaseRowMissing 分流/出口扩充）；拒绝 J1-J7（flush-then-snapshot 违计费裁定/本批不写 web/新判据方法复杂化/advisory lock 作租约维持 Y7/exit 主方案降 fallback/scan 流式读/ready 分层）；spec 变更 SV1-9。

**第三轮（v2→v3，第四轮三报告）**：核验坐实——vitest 默认池并行双跑 int（B10）、REDIS_CLIENT 非全局（B11）、prom-client 未声明标签 throw（B8）、startSessionSweep 无 clear-first、store 的 spool 兜底在 catch 之后（Z27 早退绕过它）、kit :52 不变量、hocuspocus re-listen 结构可行（B7）。**采纳（W 系 24 项）**：W1 单层重写；W2 spec 回填前移 Task 0；W3 指标 labelNames+collabStartFailureTotal+epoch gauge+rowMissing+compactNotOwner；W4 owner 文件系统安全形态；W5 启动链单点负责制（语句层有界+dispatchAcquired+stub 契约）；W6 外来段 boot 收养+截尾分档+深度两口径（P16/P18）；W7 break-glass 'revoked' 哨兵+revoked 终态+listen 失败持锁重试；W8 rejoin 卫生（initCollabOnce/listenCollab 拆分+定时器 clear-first+await listenerClosed+documents 清空前置）；W9 sleep unref+halt()；W10 drain 解除 1012 复连；W11 leaseRowMissing 落 spool；W12 ready collabState 主导派生；W13 int 排除默认池+专用配置（P15）；W14 append 取 compact 同 key advisory lock（SV3 半边）；W15 cursor 保谓词初值 0n+int 用例带超时；W16 handover 固定共享 wsPort（P17）；W17 gate 用 TTL=2000 env（无 FORCE）；W18 kill_timeout 45000；W19 drill 清租约行（Z16 落地形态）；W20 collab-compact/import 接管守卫（健康持有者需 --force）；W21 adoptSilentForeignSegments 接口入 T4（parseSegmentFrames 单源）；W22 看门狗每 episode 至多 inc 一次+start-failed 自愈再调度；W23 COLLAB_ADMIN_TOKEN 回退态启动 WARN；W24 launch.json api-b 注释+单主机双实例真相 runbook（N15）；另 P2-2 reconciler ENOENT 容错+廉价守卫、P2-3 'no-row' 死值删除、集合断言 basename 归一、verify-indexes 块简化、N16 容量三数+Y7 接口三件套登记 T10。**拒绝（R 系 5 项）**：R1 `--slow-request` 演练档（无自然慢端点=范围漂移；handover graceful 已证步骤 6；Y0a-4 真流量观测登记）；R2 worker `.catch` 计数化（AI 执行链 demo 重构线裁定）；R3 readOnly 直翻解冻（选 1012——B12）；~~R4 报3 M4 后半"写意图门不含 draining"~~（**v4 记录纠正**：原裁定理由错误——既有写意图门 isWritableOrDegraded() 只含 spool 两态、不含 draining；T8 Step 1 前插 `isLeaseServing()` 是**必需项**非冗余，动作保留）；R5 容量三数落本批（归 Y0a-4）。

**第四轮（v3→v4，第五轮三报告）**：核验坐实——depth() 现形 `{files,bytes}` 且熔断 :115/:119 读 d.bytes、gauges collect 形态读 pendingCollector（B15）、httpServer 无 error 监听且 listen() promise 悬挂（B13）、v3 的 listenCollab 漏 onRecovered 接线（现仓 :829 实证）、int 实为 5 文件（generation-intent 漏数）、clone:33 经 readCanvas 活 doc、种子链 `fillDoc(toDocLike(doc), stripAuthorState(...))`、cursor 为绑定参数（:52）。**采纳（V 系 34 项）**：V1 stub 契约三件套（deps{repo,spool} 副作用——否则 kit 全链 scan() 处结构性红）；V2 depth() 五元组+depthTotalBytes() 回填熔断三处+PendingSnapshot 扩 stranded*（gauges=total/门=own 在 collect 架构下成立）；V3 scan() 临时 map 整体 swap（半截索引防线）；V4 owner 构造期断言+长度有界（≤24 host 段）+onHeld 原子化（applyHeld 接线失败→释放拒当僵尸）；V5 everHeld+attemptAcquire 事务内 revoked 门（unknown-expired 不查行的抢回窗口）；V6 删 lease 未用 AuditService 注入+epoch gauge 复位；V7 dispatchAcquired halted 检查+acquireLoop 单飞闸；V8 break-glass 脚本审计 try/catch+finally 清行+60s 接管窗；V9 initDone 成功后置+catch 复位；V10 listenCollab 末尾 rearmQueues+onRecovered 接线+once('error') 转 reject+端口类有界持锁重试 ≤2+starting 在飞闸；V11 shuttingDown 字段（步骤 1 置位+startCollabAfterLease 守卫——关停期 rejoin 不得 re-listen）；V12 三入口统一 gateway.isLeaseServing()（lease.isServing 内部化——判据分裂窗口）；V13 leaseNotHeld 过渡窗第三分类（落 spool+不排梯——隔离期在飞 store 不再误报 DB 故障）；V14 看门狗计数去重（catch 置 episode 标志）；V15 beginDraining 返回真实 phase；V16 T7 用例修复（#7 serving 档/#9 重写/#10 并发合流断言）+八档矩阵化；V17 ready 公开/授权两档（P21）；V18 读出口三分法（P20——clone 留活读）；V19 T8 种子修正（toDocLike+stripAuthorState+孤儿注入清理）；V20 intent-reconcile withDoc 用例（503→延后重试非终态失败）；V21 503 对象响应体+Retry-After filter 本批定死；V22 T3 mock 断言值化+cursor 判别性（B14）；V23 ensureLeaseFixture 5min+afterAll 清理+gate/drill 清行 helper 共用；V24 T2 测试缩时+事件定序（onLost promise 替代 sleep）；V25 setOwner 正则收紧（[A-Za-z0-9_-] 禁 `..` 路径逃逸）；V26 锁键单源 lockProject+INSERT ratchet 静态断言（P23）；V27 CI 抽 check-int-coverage.mjs（集合+零失败+零跳过+条数下限）+int.json gitignore+CI-only outputFile+第 5 int 文件核验；V28 handover 统一 8s 预算+获租约 ≤2s 独立断言+epoch 单调 +1 断言；V29 §0.7 全局不变量八条；V30 spec 补句（SV4 ≤90s 措辞/stateSeq 角色/用户可见窗口/PromQL 5 条/容量三数=发布前置）；V31 verify-indexes 删行用例 finally 复原；V32 T3 既有 'no-row' 用例改写清单；V33 轻量 transition() 迁移单点（日志+合法迁移断言——三轮病根的结构解）；V34 fillDoc/auditLog 字段经 tsconfig.scripts 编译期校验确认（记录）。**拒绝（R6-R9）**：R6 rejectedWrites 计数器（部署门语义=**服务端已受理工作落定**——冻结拒收的客户端编辑本就不在服务端账上、重连后补回，判据正确非"洗白"；T10 runbook 注明语义）；R7 drain 双 phase 字段（drained ≡ reason=draining ∧ pending 四零——可推导不加字段；runbook 写死判据+drain→SIGTERM ≤2s 窗）；R8 revoked holder 归 lease-held（not-acquired 语义准确——行即刻可取；holder 字段自解释）；R9 fixture"拒偷活跃租约 throw"（本地 dev 与 int 并存是开发期形态，5min 过期+afterAll 清理已把干扰窗压到分钟级且 rejoinLoop 自愈；throw 会误伤 CI 残留态——采纳 5min+清理半边即 V23）。

### 0.7 全局不变量（V29——每条=唯一执行点+可红断言；三轮病根"不变量只在注释里"的结构解，T10 出口逐条验收）

| # | 不变量 | 唯一执行点 | 可红断言（载体） |
|---|--------|-----------|------------------|
| I1 | `lease.state==='held'` ⟺ 心跳在跑 ∧ repo.owner 已设 ∧ spool.owner 已设 ∧ onAcquired 已派发 | `onHeld`（原子——接线失败即释放并抛） | T2"接线失败→非 held+行已释放"用例 |
| I2 | `held` 只能经 `attemptAcquire` 达成，且该门检查 `revoked`（本进程 everHeld 则不夺 revoked 行） | `attemptAcquire` 事务内 SELECT owner 门 | T2"revoked 后 rejoin CAS 不复得"用例 |
| I3 | `collabState==='serving'` ⟹ init 四步（scan/隔离/回灌/rearm）各成功执行过 ≥1 次 ∧ listen 成功 ∧ 定时器唯一（clear-first） | `listenCollab`+`initDone` 成功后置 | T5"scan 失败→重试不跳过 scan"用例 |
| I4 | **serving ⟹ ∀p ∈ 非空队列 ∪ spool.keys() ⇒ p 在退避梯上**（own 帧有运行期恢复路径） | `listenCollab` 末尾 `rearmQueues()`+`onRecovered` 接线+reconciler 守卫含 own | T5"isolated→rejoin→3s 内梯上"用例+handover own 帧收敛断言 |
| I5 | 任何批的归属恒 ∈ {内存队列, spool(已 fsync), PG}；`fenced`/`leaseRowMissing`/`leaseNotHeld` 三类**必落 spool、不排梯** | `storeDocumentUnlocked` 三分类 | T5 三用例（各自断言 spool 非空+梯空） |
| I6 | `revoked` 是终态：被撤进程不得再获得租约（重启才重新参与） | `attemptAcquire` 门+`revoke()` 不启 rejoinLoop | T2 revoked 用例+handover --usurp"A 不抢回"断言 |
| I7 | `ready===true` ⟹ PG 通 ∧ 持租约 ∧ serving；部署门读的数字**必须可由运行期自愈归零**（I4 的推论） | ReadyService 派生链 | T7 八档矩阵+handover pending 收敛 |
| I8 | 数字口径单源：own（drainable，部署门/ready）≠ total（own+stranded 磁盘真值，**容量熔断+gauges+G-1 barrier**）≠ stranded（仅透出+WARNING） | `depth()`+`depthTotalBytes()`+PendingSnapshot 映射 | T4"外来段越限必抛容量"用例+两 gauge 取和断言 |

---

## File Structure

| 文件 | 动作 | 职责 |
|------|------|------|
| `packages/shared/src/constants/collab-ready.ts` | Create | COLLAB_READY_REASONS 八值+CollabReadyReason 字面量联合（tsc 封闭门）+CollabReadyResponse/Pending 接口 |
| `packages/shared/src/index.ts` | Modify | 导出 collab-ready 三类 |
| `packages/shared/src/constants/collab-auth-reason.ts`(+test) | Modify | +LEASE_NOT_READY 追加末尾（七档） |
| `apps/api/prisma/schema.prisma` | Modify | AuditTargetType +COLLAB_LEASE；CollabLease expiresAt→Timestamptz(3)+新增 renewedAt |
| `apps/api/prisma/migrations/<ts>_lease_collab_audit/migration.sql` | Create | ALTER TYPE+ALTER COLUMN+ADD COLUMN |
| `apps/api/prisma/verify-indexes.sql` | Modify | CollabLease 不变量块+AuditTargetType 枚举块（Z1） |
| `apps/api/src/modules/collab/collab-lease.service.ts` | Create | PG 租约：CAS（自愈 seed）/心跳三态（owner-only+单调钟）/classifyZeroRow（lost\|revoked|lease-error）/release/halt/rejoinLoop/diag+dispatchAcquired 单点 |
| `apps/api/src/modules/collab/collab-lease.service.spec.ts` | Create | mock 层全语义（CAS/三态/revoked/rejoin/halt/构造断言） |
| `apps/api/scripts/collab-lease-breakglass.ts` | Create | 运维逃生阀：SELECT 前任→'revoked' 哨兵 UPDATE→AuditLog（SV2） |
| `apps/api/src/modules/collab/collab-lease-fence.int.spec.ts` | Create | 真库：G-3b fenced/leaseRowMissing/compact 不删行/两出口同构/提交序倒挂（带超时） |
| `apps/api/src/modules/collab/canvas-doc-update.repository.ts`(+spec) | Modify | setLeaseOwner+append（owner-only fence+advisory lock）+二次查+compact 首行断言（not-owner）+readConsistent 两出口（cursor 0n） |
| `apps/api/src/modules/collab/collab-spool.service.ts`(+spec) | Modify | R3：setOwner（fs-safe 断言+必填）/activeDir/段键文件名化/meta.dir+foreign/listSpoolFiles/parseSegmentFrames 单源/depth 分区/adoptSilentForeignSegments/replayAll{projectIds} |
| `apps/api/src/modules/collab/collab.gateway.ts` | Modify | 删 redis 族/lease 注入/collabState 状态机/三入口门/selfIsolate（关 listener+await）/initCollabOnce+listenCollab/看门狗/leaseRowMissing 落 spool/I-3/M3/beginDraining（冻结+1012 解除）/reconciler/关停 release+halt |
| `apps/api/src/modules/collab/store.metrics.ts` | Modify | lease 族指标全集（labelNames 声明先行——B8） |
| `apps/api/src/modules/collab/collab.module.ts` | Modify | 删 COLLAB_REDIS/RedisSync；+Lease/Ready/Audit/REDIS_CLIENT provider+controllers 数组注册 |
| `apps/api/src/modules/collab/collab-redis-sync.service.ts` + `.spec.ts` | Delete | census §1.3 |
| `apps/api/src/modules/collab/collab.gateway.multi-instance.spec.ts` | Rewrite | G-3 租约 fail-fast（不 listen+三入口拒） |
| `apps/api/src/modules/collab/collab.gateway.spec.ts` | Modify | elapsed 断言重写（必办⑦，锚 :228-232）+lease 门用例（stub 契约） |
| `apps/api/src/modules/collab/collab.gateway.{auth-reason,persist-status,sweep,env}.spec.ts` | Modify | 构造参数 4→lease stub |
| `apps/api/src/modules/collab/collab-document.service.ts` | Modify | withDoc 租约门+写意图门租约档+readCanvasFromSnapshot |
| `apps/api/src/modules/collab/collab-ready.service.ts`(+spec) | Create | 探针+八档 collabState 主导派生（P6）+1s 单飞缓存+pending/stranded/holderRenewedAgoMs |
| `apps/api/src/modules/collab/collab-ready.controller.ts` | Create | GET /api/ready+POST /api/drain（CollabAdminAuthGuard+审计） |
| `apps/api/src/modules/collab/collab-admin-auth.guard.ts` | Create | COLLAB_ADMIN_TOKEN（未设回退 PROMETHEUS_TOKEN+启动 WARN——W23） |
| `apps/api/src/modules/collab/collab-not-serving.filter.ts` | Create | 503 对象响应体 `Retry-After: 2` filter（V21——本批定死，不留执行期） |
| `apps/api/src/modules/collab/canvas-doc-insert-ratchet.spec.ts` | Create | INSERT 单源静态断言（V26/P23——body-param-ratchet 先例形态） |
| `scripts/check-int-coverage.mjs` | Create | int 完整性单源（集合+零失败+零跳过+条数下限——V27） |
| `apps/api/src/auth/auth.guard.ts` | Modify | PUBLIC_PREFIXES +'/api/ready','/api/drain' |
| `apps/api/src/modules/collab/test-utils/lease-stub.ts` | Create | createLeaseStub（契约：成功⇒已 await onAcquired） |
| `apps/api/src/test-utils/dual-client-server.ts` | Modify | 构造参数 4→lease stub |
| `apps/api/src/test-utils/db-fixtures.ts` | Modify | +ensureLeaseFixture（ON CONFLICT DO UPDATE） |
| `apps/api/vitest.config.ts` + `vitest.int.config.ts`（新） | Modify/Create | 默认池排除 int / int 专用（串行）——P15 |
| `apps/api/package.json` | Modify | test:int 改专用配置；pnpm remove @hocuspocus/extension-redis |
| `apps/api/src/modules/execution/execution.service.ts` / `video-project.service.ts` | Modify | 计费/语义读 503 门（活读保留——含结构化错误体+Retry-After） |
| `apps/api/src/modules/video-work/video-work.service.ts` | Modify | 只读展示→readCanvasFromSnapshot（**快照出口仅此一处**——clone 留活读，V18/P20） |
| `apps/api/src/modules/project/project.service.ts` | Modify | 种子 PG 侧同事务落库（T8①） |
| `apps/api/scripts/collab-compact.ts` / `collab-spool-import.ts` | Modify | 租约行接管（健康持有者 --force 守卫——W20） |
| `apps/api/scripts/collab-spool-quarantine.ts` | Modify | readdir→listSpoolFiles 单源 |
| `apps/api/scripts/collab-kill9-drill.ts` / `collab-drill-server.ts` | Modify | 清租约行+handover 模式（固定 wsPort）/手动 SIGTERM 闸 |
| `scripts/gate-collab.mjs` | Modify | waitForApiHealth 切 /api/ready 双验+TTL=2000 env |
| `scripts/check-hocuspocus-pin.mjs` | Modify | EXPECTED 三+common+yjs 两正则 |
| `.github/workflows/ci.yml` | Modify | test job 消 int+collab-core 集合断言+handover |
| `deploy.sh` | Modify | kill_timeout 10000→45000 两处 |
| `.claude/launch.json` | Modify | api-b 注释改 handover 专用 |
| `docs/superpowers/specs/2026-10-06-y0a-data-integrity-design.md` | Modify | **Task 0：SV1-14 回填（v2.4→v2.5）**+T10 执行状态+§5.2 指标表+P95 落档 |
| `docs/superpowers/specs/2026-10-06-canvas-yjs-arch-upgrade-review.md` | Modify | §0.2 Y0a 行回填（T10） |

---

### Task 0: spec v2.5 回填（SV1-16）——先行落档，执行期 plan/canonical 不矛盾

> **W2（P2-1）**：SV 项改的是 spec 规范句——T1-T9 执行期若 spec 仍写旧语义，执行者/后续批会以 spec 为准"好心回退"。本 Task 纯文档，无代码。

**Files:**
- Modify: `docs/superpowers/specs/2026-10-06-y0a-data-integrity-design.md`

- [ ] **Step 1: SV1-16 逐项落 spec（v2.4→v2.5 版本头+各节句子替换）**

| # | 变更（spec 目标句） |
|---|------|
| SV1 | §3.2 fence/renew 判据"owner+TTL 双校验"→**owner-only（TTL 只留 CAS 获取谓词）**；service 头注释钉死"租约=互斥+接管顺序，TTL=RTO 参数不参与正确性判定" |
| SV2 | §3.2 `COLLAB_FORCE_TAKEOVER` env→**删除，改 break-glass 运维脚本**（'revoked' 哨兵+expiresAt=now()+epoch+1+AuditLog；被撤实例 revoked 终态不 rejoin） |
| SV3 | 契约 1/装载：`seq>stateSeq` 水位过滤→**删除（readConsistent cursor 0n 全量 apply）**+append 取 compact 同 key advisory lock。**补角色句（V30）：水位不是正确性载体（正确性=读侧全量+CRDT 幂等）；锁只保证 stateSeq 作为诊断/未来增量装载水位的诚实性——禁以"有锁了"为由把读侧过滤加回来** |
| SV4 | §9.13"待下一次重启回灌"→"**≤reconcile 周期自愈（最坏 ≤90s=首 tick 30s+静默窗 60s；boot 收养使重启场景即时）**"；§4.4 部署判据=own 四零+stranded 仅 WARNING |
| SV5 | E35/isolate：`lost` 终态→**rejoin 状态机**（isolate 关 listener 让位+documents 清空前置+有界退避 [1,2,5,15,30]s 重获取+re-listen——B7 库实证可行）；revoked 终态不 rejoin |
| SV6 | E43⑤ kill_timeout→**45000 提前本批**（deploy.sh 两行——B9 HTTP dispose 等在飞请求） |
| SV7 | §3.3 reason 枚举→**八值（+not-serving）**+**collabState 七态单枚举**（initializing/acquiring/starting/serving/draining/isolated/start-failed）主导派生（P6 优先级） |
| SV8 | §3.2 compact fence 档→**'not-owner' 分立**（abandoned=pendingStructs 专用）；skipLeaseAssert→**删（运维统一租约行接管，健康持有者需 --force）** |
| SV9 | §3.3 drain：**冻结既有连接 readOnly+幂等=刷新 60s deadline+自动解除时冻结连接 1012 复连**（B12） |
| SV10 | 外来段（§3.2 R3 关联）：**boot 即收养+截尾分档**（本 owner 坏尾=quarantine 计数；外来坏尾=静默截断 sealed） |
| SV11 | 深度两口径：**gauges=total（磁盘真值，容量+G-1 判据）；部署门=own（drainable）；stranded 单独透出** |
| SV12 | 部署链：**POST /api/drain=唯一停止写入入口**（B4——Nest dispose 先于模块 shutdown，SIGTERM 后 ready 不可达）；Y0a-4 deploy 三步硬依赖 |
| SV13 | leaseRowMissing 写路径：**批走 spool（BOI）+不排梯+独立计数**（不早退——内存滞留=重启丢批） |
| SV14 | 测试架构：**int spec 从默认池排除+专用配置串行+CI 文件级集合断言**（X16 根修） |
| SV15 | §3.2 readCanvas 拆分判据改**按可变性三分法**（v4/V18）：只读展示→readSnapshotOnly；语义读（clone/regenerate 校验）→活读+租约门 503（**快照出口仅 video-work.service:328 一处**——clone 改快照=静默丢去抖窗编辑）；计费读→活读+fail-closed |
| SV16 | §3.3 /api/ready **公开/授权两档**：无 token={ready,reason,redis,epoch}；带 x-prometheus-token=全字段（holder/pending/stranded 等——/api 经 nginx 公网可达，host+pid 属内部信息） |

（spec 版本头追加 v2.5 变更段；§1.4 执行状态行同步"Y0a-3 执行中"；被替换旧句删除不留注记——单层同款纪律。）

- [ ] **Step 2: v8 目录登记**

`2026-10-06-canvas-yjs-arch-upgrade-review.md` v8 目录补：Y0a-3 spec v2.5（SV1-14 十四项裁决+B7 re-listen 探针转正+B8 指标标签实证）。

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs && git commit -m "docs(spec): Y0a-3 T0 v2.5——SV1-14 回填（fence owner-only/break-glass revoked/去水位+append 锁/rejoin/八值 ready/drain 冻结/两口径/int 专用池）"
```

---

### Task 1: shared 协议面——CollabAuthReason 七档+ready 八值类型契约+verify-indexes

**Files:**
- Modify: `packages/shared/src/constants/collab-auth-reason.ts` + `.test.ts`
- Create: `packages/shared/src/constants/collab-ready.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/api/prisma/verify-indexes.sql`

- [ ] **Step 1: 写失败测试（auth-reason 七档+ready 八值类型）**

`collab-auth-reason.test.ts` 改写（现 :6 是 toEqual 精确数组——Y21 同款纪律：'lease-not-ready' 追加**末尾**）：

```typescript
import { describe, it, expect } from 'vitest';
import { CollabAuthReason, isTerminalReason, COLLAB_AUTH_REASONS } from './collab-auth-reason';
import { COLLAB_READY_REASONS, type CollabReadyReason, type CollabReadyResponse } from './collab-ready';

describe('CollabAuthReason 七档（Y0a-3：+lease-not-ready 瞬态档）', () => {
  it('值即线上协议串——封闭数组（顺序冻结，只增不改）', () => {
    expect(COLLAB_AUTH_REASONS).toEqual([
      'unauthenticated', 'session-expired', 'not-found', 'forbidden',
      'db-unavailable', 'draining', 'lease-not-ready',
    ]);
  });
  it('lease-not-ready 为瞬态档——误入终态白名单=关停期外客户端停止重连', () => {
    expect(isTerminalReason(CollabAuthReason.LEASE_NOT_READY)).toBe(false);
  });
});

describe('CollabReadyReason 封闭枚举（G-4 载体：tsc 即门）', () => {
  it('八值字面量封闭（SV7：not-serving 在 lease-lost 后）', () => {
    expect(COLLAB_READY_REASONS).toEqual([
      'pg-down', 'draining', 'lease-error', 'lease-lost', 'not-serving',
      'lease-held', 'lease-not-acquired', 'spool-unwritable',
    ]);
  });
  it('CollabReadyResponse 结构：epoch=string（BigInt 序列化崩坑）+pending 含 storeInFlight/stranded 分区', () => {
    const body: CollabReadyResponse = {
      ready: false, reason: 'lease-held' satisfies CollabReadyReason,
      holder: 'prev-owner', epoch: '3', holderRenewedAgoMs: 1200, redis: 'up',
      pending: { projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 },
      spoolQuarantined: 0,
    };
    expect(typeof body.epoch).toBe('string');
    expect(body.pending.strandedFiles).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm --filter @flowweb/shared exec vitest run src/constants/collab-auth-reason.test.ts`
Expected: FAIL——`COLLAB_AUTH_REASONS` 未导出/`./collab-ready` 模块不存在。

- [ ] **Step 3: 最小实现**

`collab-auth-reason.ts`：

```typescript
export const CollabAuthReason = {
  UNAUTHENTICATED: 'unauthenticated',
  SESSION_EXPIRED: 'session-expired',
  NOT_FOUND: 'not-found',
  FORBIDDEN: 'forbidden',
  DB_UNAVAILABLE: 'db-unavailable',
  DRAINING: 'draining',
  LEASE_NOT_READY: 'lease-not-ready',   // Y0a-3：租约未持有/失守——瞬态档（客户端继续重连；Y0b 终端 UX 分型消费）
} as const;
/** 值序冻结（线上协议串只增不改）——测试 toEqual 锚此数组 */
export const COLLAB_AUTH_REASONS = Object.values(CollabAuthReason) as string[];
```

`collab-ready.ts` 新建：

```typescript
/** Y0a-3（spec v2.5 §3.3）：/api/ready 响应契约——reason 字面量封闭枚举（tsc 即门，禁通配）；
 *  由 collabState 主导派生（SV7）；holder/epoch/pending 为并列取证字段禁入 reason；epoch=string
 *  （JSON.stringify(bigint) 抛 TypeError）；redis 仅报不 gating。forceTakeover 已随 FORCE env 删除（SV2）。 */
export const COLLAB_READY_REASONS = [
  'pg-down', 'draining', 'lease-error', 'lease-lost', 'not-serving',
  'lease-held', 'lease-not-acquired', 'spool-unwritable',
] as const;
export type CollabReadyReason = (typeof COLLAB_READY_REASONS)[number];

export interface CollabReadyPending {
  projects: number;     // pending 队列非空项目数（Y5 键名——gateway.computePending 同源）
  batches: number;      // update 条数（非合并后批数——与 storeInFlight 不同量纲）
  spoolFiles: number;   // own 口径（drainable——部署门判据，P16）
  spoolBytes: number;
  storeInFlight: number;   // W10：部署门"四零"假绿消除（X2 集合 size）
  strandedFiles: number;   // 外来段（磁盘真值部分——只 WARNING 不阻塞，SV4）
  strandedBytes: number;
}

export interface CollabReadyResponse {
  ready: boolean;
  reason?: CollabReadyReason;
  holder?: string;
  epoch?: string;
  holderRenewedAgoMs?: number;   // 值班判"它还活着吗"（Z19 renewedAt 派生）
  redis: 'up' | 'down';
  pending: CollabReadyPending;
  spoolQuarantined?: number;
}
```

`index.ts` 追加：

```typescript
export { COLLAB_READY_REASONS } from './constants/collab-ready';
export type { CollabReadyReason, CollabReadyResponse, CollabReadyPending } from './constants/collab-ready';
```

- [ ] **Step 4: 跑测试确认绿+shared 构建**

Run: `pnpm --filter @flowweb/shared exec vitest run src/constants/collab-auth-reason.test.ts && pnpm --filter @flowweb/shared build`
Expected: PASS×4+构建成功。

- [ ] **Step 5: verify-indexes.sql 双块改造（Z1——先红后绿）**

`verify-indexes.sql:25-26` 的 CollabLease 块改**不变量断言**（runner 按空行分块、每块须 ≥1 行——块间留空行；正常态恒返回 1 行）+新增 AuditTargetType 枚举存在块：

```sql
-- Y0a-3（Z1）：租约行不变量——epoch 恒非空；(owner IS NULL)=(expiresAt IS NULL) 耦合
--（持有者必有过期时刻；释放/break-glass 后两者同 NULL——不再断言"原始态"，本批后可变）。
SELECT scope FROM "CollabLease" WHERE scope = 'primary' AND epoch IS NOT NULL AND (owner IS NULL) = ("expiresAt" IS NULL);

-- Y0a-3（P2）：AuditTargetType 必含 COLLAB_LEASE（break-glass/drain 审计行依赖——枚举漏迁移即红）。
SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'AuditTargetType' AND e.enumlabel = 'COLLAB_LEASE';
```

Run: `node scripts/verify-indexes.mjs`
Expected: 先红（当前库已跑过 API 则 owner 非空+枚举缺值必红；未跑过则以临时 UPDATE 造红）→ Task 2 迁移后绿。

- [ ] **Step 6: Commit**

```bash
git add packages/shared apps/api/prisma/verify-indexes.sql && git commit -m "feat(shared): Y0a-3 T1 协议面——auth-reason 七档+ready 八值契约(epoch=string+stranded 分区)+verify-indexes 不变量块"
```

---

### Task 2: 迁移+CollabLeaseService（CAS 自愈 seed/心跳 owner-only/revoked/rejoin/halt）+break-glass 脚本

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_lease_collab_audit/migration.sql`（migrate dev 生成）
- Create: `apps/api/src/modules/collab/collab-lease.service.ts` + `.spec.ts`
- Create: `apps/api/scripts/collab-lease-breakglass.ts`
- Modify: `apps/api/src/modules/collab/store.metrics.ts`（指标全集——编译依赖先行）

- [ ] **Step 1: schema 枚举+列迁移（Z19/P2/B6）**

schema.prisma：AuditTargetType 追加 `COLLAB_LEASE`；CollabLease 的 expiresAt 改 `DateTime? @db.Timestamptz(3)`+新增 `renewedAt DateTime? @db.Timestamptz(3)`：

```prisma
enum AuditTargetType {
  subscription
  subscription_plan
  point
  order
  TEAM
  TEAM_MEMBER
  PROJECT
  PROJECT_MEMBER
  COLLAB_LEASE   // Y0a-3：break-glass/drain 审计行（targetId=scope 'primary'）
}
```

```bash
pnpm --filter @flowweb/api exec prisma migrate dev --name lease_collab_audit
```

（生成 `ALTER TYPE "AuditTargetType" ADD VALUE 'COLLAB_LEASE';`+`ALTER TABLE "CollabLease" ALTER COLUMN "expiresAt" TYPE timestamptz(3);`+`ADD COLUMN "renewedAt" timestamptz(3);`——fresh replay 必验：`prisma migrate reset` 烟测一次。）

- [ ] **Step 2: store.metrics.ts 指标全集（W3/B8——labelNames 声明先行，未声明标签 inc 直接 throw）**

在 `collabSweepCloseTotal` 定义后追加（同 register 模式）：

```typescript
/** Y0a-3（E35/E44/V22）：租约指标族——labelNames 必须与全部 .inc({}) 调用点一一对应
 *  （B8：prom-client 对未声明标签 throw——隔离路径会炸，先于任何消费方落地）。 */
export const collabLeaseDeniedTotal = new Counter({
  name: 'collab_lease_denied_total',
  help: '租约获取失败次数（reason=contention：CAS 0 行；reason=error：语句失败/超时）',
  labelNames: ['reason'],
  registers: [register],
});
export const collabLeaseLostTotal = new Counter({
  name: 'collab_lease_lost_total',
  help: '租约失守次数（cause=fenced-by-write/heartbeat-fenced/heartbeat-unknown-expired/revoked——gateway.selfIsolate 单点 inc）',
  labelNames: ['cause'],
  registers: [register],
});
export const collabStartFailureTotal = new Counter({
  name: 'collab_start_failure_total',
  help: 'collab 面启动失败次数（scan/listen 抛错；看门狗每 episode 至多补 1 次——W22）',
  registers: [register],
});
export const collabLeaseEpoch = new Gauge({
  name: 'collab_lease_epoch',
  help: '当前持有租约的 epoch（onHeld 时 set——单调观测）',
  registers: [register],
});
export const collabLeaseRowMissingTotal = new Counter({
  name: 'collab_lease_row_missing_total',
  help: '写路径遇 CollabLease 行缺失次数（配置错误——批走 spool 不排梯，SV13）',
  registers: [register],
});
/** Y0a-3（SV8）：compact 租约档拒绝（与 pendingStructs 的 abandoned 分立——计数不混） */
export const yjsCompactNotOwnerTotal = new Counter({
  name: 'yjs_compact_not_owner_total',
  help: 'compact 因租约档拒绝次数（not-owner——出现即租约与 compact 判据不一致，需值班关注）',
  registers: [register],
});
/** Y0a-3（§3.2）：投影类快照读计数（readSnapshotOnly 出口） */
export const yjsSnapshotReadTotal = new Counter({
  name: 'yjs_snapshot_read_total',
  help: 'readSnapshotOnly 投影出口快照读次数（video-work 快照/克隆）',
  registers: [register],
});
```

- [ ] **Step 3: 写失败测试（service 全语义——mock prisma；到期类用例用小真实定时器+构造前 env）**

`collab-lease.service.spec.ts`：

```typescript
// Y0a-3 T2：租约 service 全语义 mock 层——CAS（自愈 seed 同事务）/心跳三态（owner-only+单调钟）/
// classifyZeroRow 三分流（fenced|revoked|lease-error）/everHeld-revoked 门/rejoin/halt/构造断言/release。
// V24：到期类用例小 env（构造前设——HB*2≤TTL 不变式仍满足）+事件定序（onLost/onAcquired 的 Promise
// 替代固定 sleep——<1s 余量问题根除）；B14：tagged template 断言一律 join('?')/slice(1) 值断言。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CollabLeaseService } from './collab-lease.service';
import { CollabSpoolService } from './collab-spool.service';
import { makeSpoolDir } from '../../test-utils/spool-dir';

function buildService(query: ReturnType<typeof vi.fn>, spool: CollabSpoolService) {
  const prisma = { $queryRaw: query, $transaction: vi.fn(async (fn: any) => fn({ $queryRaw: query, $executeRaw: vi.fn() })) };
  const repo = { setLeaseOwner: vi.fn() };
  const svc = new CollabLeaseService(prisma as any, repo as any, spool);
  return { svc, prisma, repo };
}
const renewSql = (frag: unknown) => String(frag).includes('"renewedAt" = now()') && String(frag).includes('RETURNING "renewedAt"');
const text = (c: unknown[]) => (c[0] as string[]).join('?');
const withTimeout = <T,>(p: Promise<T>, ms = 5_000, msg = '事件未到达（定序失败）') =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

describe('CollabLeaseService', () => {
  let dir: { dir: string; cleanup: () => Promise<void> };
  let spool: CollabSpoolService;
  beforeEach(async () => {
    process.env.COLLAB_LEASE_TTL_MS = '10000';
    process.env.COLLAB_LEASE_HEARTBEAT_MS = '3000';
    dir = await makeSpoolDir('y0a3-lease-');
    spool = new CollabSpoolService(dir.dir);
  });
  afterEach(async () => { delete process.env.COLLAB_LEASE_TTL_MS; delete process.env.COLLAB_LEASE_HEARTBEAT_MS; await dir.cleanup(); });

  it('构造断言（Z18）：HB*2>TTL → throw（负/零 TTL=make_interval 负秒=恒可夺——互斥静默失效）', () => {
    process.env.COLLAB_LEASE_TTL_MS = '4000';
    process.env.COLLAB_LEASE_HEARTBEAT_MS = '3000';
    expect(() => buildService(vi.fn(), spool)).toThrow(/不变式/);
  });

  it('owner 有界+fs-safe（V4）：host 段 ≤24、总长 ≤64、仅 [A-Za-z0-9_-]——同时是 spool 子目录名（Windows 禁冒号；长 hostname 不得致 setOwner throw）', () => {
    const { svc } = buildService(vi.fn(), spool);
    expect(svc.owner.length).toBeLessThanOrEqual(64);
    expect(svc.owner).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(() => spool.setOwner(svc.owner)).not.toThrow();
  });

  it('CAS 成功：held+repo.setLeaseOwner(owner)+spool.setOwner(owner)+epoch gauge+自愈 seed 同事务', async () => {
    const query = vi.fn().mockResolvedValue([{ epoch: 5n }]);
    const setOwnerSpy = vi.spyOn(spool, 'setOwner');
    const { svc, repo } = buildService(query, spool);
    const ok = await svc.tryAcquireFast();
    expect(ok).toBe(true);
    expect(svc.isServing()).toBe(true);
    expect(repo.setLeaseOwner).toHaveBeenCalledWith(expect.any(String));
    expect(setOwnerSpy).toHaveBeenCalledWith(expect.any(String));
    expect(text(query.mock.calls[0])).toContain('ON CONFLICT (scope) DO NOTHING');   // Z17 自愈 seed 同事务
    expect((await svc.diag()).epoch).toBe('5');
  });

  it('CAS 0 行（他人持有/未过期）：false+不触 repo/spool 接线', async () => {
    const { svc, repo } = buildService(vi.fn().mockResolvedValue([]), spool);
    await expect(svc.tryAcquireFast()).resolves.toBe(false);
    expect(svc.isServing()).toBe(false);
    expect(repo.setLeaseOwner).not.toHaveBeenCalled();
  });

  it('单点负责制（W5）：成功⇒tryAcquireFast 内已 await onAcquired（kit 不变量：返回即已启动）', async () => {
    const onAcquired = vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const { svc } = buildService(vi.fn().mockResolvedValue([{ epoch: 1n }]), spool);
    svc.onAcquired = onAcquired;
    const t0 = Date.now();
    await svc.tryAcquireFast();
    expect(onAcquired).toHaveBeenCalledTimes(1);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(20);   // await 穿透（fire-and-forget 则 ≈0）
  });

  it('onHeld 原子（V4/I1）：spool.setOwner 抛 → state 非 held+租约行已释放（防半 held 僵尸）+rethrow', async () => {
    const badSpool = new CollabSpoolService(dir.dir);
    vi.spyOn(badSpool, 'setOwner').mockImplementation(() => { throw new Error('owner 非法'); });
    const query = vi.fn().mockResolvedValue([{ epoch: 1n }]);
    const { svc } = buildService(query, badSpool);
    await expect(svc.tryAcquireFast()).rejects.toThrow('owner 非法');
    expect(svc.isServing()).toBe(false);
    expect(query.mock.calls.some((c) => text(c).includes('SET owner = NULL'))).toBe(true);   // 行已释放——其他实例不被僵尸挡
  });

  it('心跳三态-unknown：单次抛错不隔离——1s 重试恢复；renew 语句 owner-only（无 TTL 守卫）', async () => {
    process.env.COLLAB_LEASE_TTL_MS = '1000';
    process.env.COLLAB_LEASE_HEARTBEAT_MS = '200';
    let renewCalls = 0; let failFirst = true;
    const query = vi.fn().mockImplementation((...args: any[]) => {
      if (renewSql(args[0])) {
        renewCalls += 1;
        if (failFirst) { failFirst = false; return Promise.reject(new Error('PG 抖动')); }
        return Promise.resolve([{ renewedAt: new Date() }]);
      }
      return Promise.resolve([{ epoch: 1n }]);
    });
    const { svc } = buildService(query, spool);
    await svc.tryAcquireFast();
    await withTimeout(vi.waitFor(() => { if (renewCalls < 2) throw new Error('尚未重试'); }), 4_000, '1s 重试未发生');   // 第一次抖动→1s 后重试成功
    expect(svc.isServing()).toBe(true);   // 关键断言：unknown ≠ fenced（单次抖动不隔离）
    const renewText = text(query.mock.calls.find((c) => renewSql(c[0]))!);
    expect(renewText).not.toContain('"expiresAt" >= now()');   // SV1：owner-only——TTL 守卫=活性抖动误判源
  });

  it('心跳三态-unknown 到期（单调钟）：renew 恒败 → ttl+hb 窗内无成功 → isolate(heartbeat-unknown-expired)', async () => {
    process.env.COLLAB_LEASE_TTL_MS = '200';
    process.env.COLLAB_LEASE_HEARTBEAT_MS = '100';
    const query = vi.fn().mockImplementation((...args: any[]) =>
      renewSql(args[0]) ? Promise.reject(new Error('PG down')) : Promise.resolve([{ epoch: 1n }]));
    const onLost = vi.fn();
    const { svc } = buildService(query, spool);
    svc.onLost = onLost;
    await svc.tryAcquireFast();
    await withTimeout(vi.waitFor(() => { if (!onLost.mock.calls.length) throw new Error('未隔离'); }), 4_000);
    expect(onLost).toHaveBeenCalledWith('heartbeat-unknown-expired');
    expect(svc.isServing()).toBe(false);
  });

  it('心跳三态-fenced（V24 定序）：renew 0 行+行 owner=他人 → isolate(heartbeat-fenced)+repo 清 null+rejoin CAS 0 行不复得', async () => {
    process.env.COLLAB_LEASE_HEARTBEAT_MS = '200';
    let lost = false;   // phase flip：held 期 renew 成功；lost 后 renew 0 行+行 owner=他人+rejoin CAS 0 行
    const query = vi.fn().mockImplementation((...args: any[]) => {
      if (renewSql(args[0])) return Promise.resolve(lost ? [] : [{ renewedAt: new Date() }]);
      if (String(args[0]).includes('SELECT owner')) return Promise.resolve([{ owner: 'other-instance' }]);
      return Promise.resolve(lost ? [] : [{ epoch: 1n }]);   // 首获成功；rejoin CAS 0 行
    });
    const onLost = vi.fn();
    const { svc, repo } = buildService(query, spool);
    svc.onLost = onLost;
    await svc.tryAcquireFast();
    lost = true;                                       // 被夺
    await withTimeout(vi.waitFor(() => { if (!onLost.mock.calls.length) throw new Error('未隔离'); }), 4_000);
    expect(onLost).toHaveBeenCalledWith('heartbeat-fenced');
    expect(repo.setLeaseOwner).toHaveBeenLastCalledWith(null);   // 契约 16 fail-closed
    await new Promise((r) => setTimeout(r, 1_500));              // rejoin 首退避 1s——CAS 仍 0 行
    expect(svc.isServing()).toBe(false);                          // 不复得（mock 定序稳定——无竞态窗口）
  });

  it('classifyZeroRow-revoked（W7）：行 owner=revoked → revoked 终态+onLost(revoked)+不再 CAS', async () => {
    process.env.COLLAB_LEASE_HEARTBEAT_MS = '200';
    let casCount = 0;
    const query = vi.fn().mockImplementation((...args: any[]) => {
      if (renewSql(args[0])) return Promise.resolve([]);
      if (String(args[0]).includes('SELECT owner')) return Promise.resolve([{ owner: 'revoked' }]);
      casCount += 1;
      return Promise.resolve([{ epoch: 1n }]);
    });
    const onLost = vi.fn();
    const { svc } = buildService(query, spool);
    svc.onLost = onLost;
    await svc.tryAcquireFast();
    const afterAcquire = casCount;
    await withTimeout(vi.waitFor(() => { if (!onLost.mock.calls.length) throw new Error('未撤销'); }), 4_000);
    expect(onLost).toHaveBeenCalledWith('revoked');
    await new Promise((r) => setTimeout(r, 2_500));   // rejoin 窗口（若有 bug 会 CAS）
    expect(casCount).toBe(afterAcquire);              // revoked 不 rejoin——无新 CAS
    expect(svc.isServing()).toBe(false);
  });

  it('everHeld-revoked 门（V5/I2/I6）：unknown 到期隔离（不查行）后行被 break-glass 改 revoked → rejoin 前置门判 revoked → 终态不复得（CAS 不执行）', async () => {
    process.env.COLLAB_LEASE_TTL_MS = '200';
    process.env.COLLAB_LEASE_HEARTBEAT_MS = '100';
    let rowOwner: string | null = null;   // 行态受控
    let casSuccess = 0;
    const query = vi.fn().mockImplementation((...args: any[]) => {
      const t = text(args);
      if (renewSql(args[0])) return Promise.reject(new Error('PG down'));                  // unknown 路径
      if (String(args[0]).includes('SELECT owner')) return Promise.resolve(rowOwner == null ? [] : [{ owner: rowOwner }]);
      if (t.includes('epoch = epoch + 1')) { casSuccess += 1; return Promise.resolve([{ epoch: 9n }]); }   // 无门则 rejoin 会成功
      return Promise.resolve([{ epoch: 1n }]);
    });
    const onLost = vi.fn();
    const { svc } = buildService(query, spool);
    svc.onLost = onLost;
    await svc.tryAcquireFast();                        // everHeld=true
    await withTimeout(vi.waitFor(() => { if (!onLost.mock.calls.length) throw new Error('未隔离'); }), 4_000);   // unknown 到期→lost→rejoin 退避
    rowOwner = 'revoked';                              // break-glass 发生
    await new Promise((r) => setTimeout(r, 2_000));    // rejoin 首退避 1s 后 attemptAcquire 查行→revoked
    expect(svc.getState()).toBe('revoked');            // 终态（I6：被撤进程不得复得）
    expect(casSuccess).toBe(1);                        // 仅首获——rejoin 的 CAS UPDATE 未执行（门在 CAS 前）
  });

  it('rejoin 复得（SV5）：fenced 隔离后 CAS 恢复成功 → held+onAcquired 重跑', async () => {
    process.env.COLLAB_LEASE_HEARTBEAT_MS = '200';
    let phase: 'held' | 'lost' = 'held';
    const query = vi.fn().mockImplementation((...args: any[]) => {
      if (renewSql(args[0])) return Promise.resolve(phase === 'held' ? [{ renewedAt: new Date() }] : []);
      if (String(args[0]).includes('SELECT owner')) return Promise.resolve([{ owner: 'other' }]);
      return Promise.resolve(phase === 'held' ? [{ epoch: 1n }] : [{ epoch: 2n }]);   // rejoin CAS 成功
    });
    const onAcquired = vi.fn();
    const onLost = vi.fn();
    const { svc } = buildService(query, spool);
    svc.onAcquired = onAcquired; svc.onLost = onLost;
    await svc.tryAcquireFast();
    phase = 'lost';
    await withTimeout(vi.waitFor(() => { if (onAcquired.mock.calls.length < 2) throw new Error('未复得'); }), 5_000);
    expect(svc.isServing()).toBe(true);
  });

  it('halt（W9）：关停闸后 acquireLoop 退出', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const { svc } = buildService(query, spool);
    const loop = svc.acquireLoop();
    await new Promise((r) => setTimeout(r, 100));
    svc.halt();
    await withTimeout(loop, 4_000, 'halted 后循环未退出');
  });

  it('acquireLoop 单飞（V7）：并发二调不双跑（第二次立即返回）', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const { svc } = buildService(query, spool);
    const a = svc.acquireLoop(); void svc.acquireLoop();
    await new Promise((r) => setTimeout(r, 100));
    svc.halt();
    await withTimeout(a, 4_000);
    expect(query.mock.calls.length).toBeLessThanOrEqual(2);   // 无并发双循环各 30 次的形态
  });

  it('release：owner=NULL 语句+离开 held+幂等；spool owner 不清+epoch gauge 复位（V6）', async () => {
    const query = vi.fn().mockImplementation((...a: any[]) =>
      text(a).includes('epoch = epoch + 1') ? Promise.resolve([{ epoch: 1n }]) : Promise.resolve([{}]));
    const setOwnerSpy = vi.spyOn(spool, 'setOwner');
    const { svc } = buildService(query, spool);
    await svc.tryAcquireFast();
    await svc.release();
    expect(svc.isServing()).toBe(false);
    expect(setOwnerSpy).toHaveBeenCalledTimes(1);      // 只 set 一次——release/isolate 均不清 spool owner
    await svc.release();                               // 幂等不抛
  });
});
```

- [ ] **Step 4: 跑测试确认红**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab-lease.service.spec.ts`
Expected: FAIL——`collab-lease.service.ts` 不存在。

- [ ] **Step 5: 实现 CollabLeaseService**

```typescript
// apps/api/src/modules/collab/collab-lease.service.ts
// Y0a-3（spec v2.5 §3.2/E44/E35）：PG 租约——单实例拓扑的**互斥+接管顺序**机制，非数据完整性、
// 非活性自检。TTL 唯一作用=崩溃后多快被接管（RTO 参数），不参与任何正确性判定——正确性由
// ①CAS 改变 owner ②写语句 owner 断言 ③PG delta 并集+CRDT 幂等 承担。
// SV1：renew/fence 判据 owner-only——CAS 不清过期 owner，"owner=$me ∧ 已过期" ⟺ 从无他人接管
// ⇒ 续租/写入安全（唯一持有者）；被夺 ⟺ owner≠me（真 fenced）。**禁把 TTL 守卫加回**（会把事件
// 循环阻塞>TTL 误判为被夺=单实例永久停服）。
// 状态机：not-acquired → held →（fenced/unknown 到期）lost → rejoin（SV5）；
//         break-glass 撤销 → revoked 终态（不 rejoin——防 1s 内抢回，W7）。
// 单点负责制（W5/P9）：凡 state→held 必经 dispatchAcquired await 启动回调——gateway/fast path/
// acquireLoop/rejoinLoop 均不自行调用；lease-stub 同契约。
// fence 接线（契约 16）：本服务=repo.setLeaseOwner 唯一写者；spool.setOwner 唯一写者
// （失守/释放均不清 spool owner——残余批次仍落本实例目录供 reconciler 收养）。
import { Injectable, Inject, Logger } from '@nestjs/common';
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabSpoolService } from './collab-spool.service';
import { collabLeaseDeniedTotal, collabLeaseEpoch, collabStartFailureTotal } from './store.metrics';

export const COLLAB_LEASE_SCOPE = 'primary';   // Y7 演进=加行非改架构（容量/scope 常量——T10 登记）
export const REVOKED_OWNER = 'revoked';        // break-glass 哨兵（SV2）：CAS 经 expiresAt<now() 支路立即可得

export type CollabLeaseState = 'not-acquired' | 'held' | 'lost' | 'revoked';
export type LeaseLostCause = 'fenced-by-write' | 'heartbeat-fenced' | 'heartbeat-unknown-expired' | 'revoked';

export interface CollabLeaseDiag {
  state: CollabLeaseState;
  owner: string | null;          // 本进程 owner（not-acquired 未产生=null）
  holder: string | null;         // DB 行当前 owner（ready.holder 源——held 时=owner）
  epoch: string | null;          // String(BigInt)——JSON 可序列化（spec §3.3）
  renewedAt: Date | null;        // ready.holderRenewedAgoMs 源（Z19）
  statementFailed: boolean;      // PG 通但租约语句自身失败（ready lease-error 判据）
}

const sleep = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.(); });   // M3：unref——关停后事件循环不被吊住

@Injectable()
export class CollabLeaseService {
  private readonly logger = new Logger(CollabLeaseService.name);
  /** W4/V4：owner 同时是 spool 子目录名——文件系统安全形态（Windows 禁 ':'）且**长度有界**
   *  （host 段 ≤24：K8s 长 pod 名不得撞 setOwner 的 64 上限 throw=半 held 僵尸）；唯一性=pid+ts+rand。 */
  readonly owner = `${hostname().replace(/[^A-Za-z0-9_-]/g, 'x').slice(0, 24)}-${process.pid}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  private state: CollabLeaseState = 'not-acquired';
  private epoch: bigint | null = null;
  private renewedAt: Date | null = null;
  private statementFailedFlag = false;
  private halted = false;
  private everHeld = false;           // V5/I2：本进程曾进入 held——rejoin 时对 revoked 行执行行政终态门
  private acquireLoopRunning = false; // V7：单飞闸——防 fast-path 兜底/5s 重试/看门狗多源并发起循环（双 CAS→双 listen 自撞）
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private unknownRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRenewOkMono = 0n;   // Z2：单调钟——unknown 到期判据不混 DB/应用双时钟域
  private readonly ttlMs: number;
  private readonly heartbeatMs: number;
  /** gateway 接线（W5 单点）：获取成功→启动 collab 面（dispatchAcquired 统一 await）；
   *  失守/撤销→gateway.selfIsolate。回调异常不损租约事实。 */
  onAcquired?: () => void | Promise<void>;
  onLost?: (cause: LeaseLostCause) => void;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CanvasDocUpdateRepository) private readonly repo: CanvasDocUpdateRepository,
    private readonly spool: CollabSpoolService,
  ) {
    this.ttlMs = Number(process.env.COLLAB_LEASE_TTL_MS) || 10_000;
    this.heartbeatMs = Number(process.env.COLLAB_LEASE_HEARTBEAT_MS) || 3_000;
    if (!(this.ttlMs > 0 && this.heartbeatMs > 0 && this.heartbeatMs * 2 <= this.ttlMs))
      throw new Error(`COLLAB_LEASE_TTL_MS/HEARTBEAT_MS 不变式破坏（需 TTL>0 ∧ 0<HB≤TTL/2）：ttl=${this.ttlMs} hb=${this.heartbeatMs}`);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(this.owner))
      throw new Error(`lease owner 非文件系统安全形态: ${this.owner}`);   // V4：构造期 fail-fast——起不来好过起一个半 held 僵尸
  }

  isServing(): boolean { return this.state === 'held'; }
  getState(): CollabLeaseState { return this.state; }

  /** P9 快路径：一次有界 CAS——健康态一轮往返即获取；成功即由本方法 await 启动回调（W5 单点）。 */
  async tryAcquireFast(): Promise<boolean> {
    if (this.state === 'held') return true;
    const ok = await this.attemptAcquire();
    if (ok) await this.dispatchAcquired();
    return ok;
  }

  private async dispatchAcquired(): Promise<void> {
    if (this.halted) {   // V7：关停在飞获取——立即放行（防关停期起 collab 面）
      await this.release().catch(() => {});
      return;
    }
    try { await this.onAcquired?.(); }
    catch (e) { this.logger.error(`onAcquired 回调失败（gateway 侧应有自身 catch——此为 belt）: ${(e as Error).message}`); }
  }

  /** P10：急重试 30×1s（覆盖 TTL 接管窗）→passive 按行到期等待（W/P2-3：SELECT expiresAt→
   *  sleep min(剩余+100ms,5s)+10% 抖动——卡死进程 RTO=ttl+ε 而非 30s）。 */
  async acquireLoop(): Promise<void> {
    if (this.acquireLoopRunning) return;   // V7 单飞：多源（onModuleInit 兜底/5s 重试/看门狗）只跑一个循环
    this.acquireLoopRunning = true;
    try {
    for (let i = 0; i < 30; i++) {
      if (this.halted || this.state !== 'not-acquired') return;
      await sleep(1_000);
      if (this.halted || this.state !== 'not-acquired') return;
      try { if (await this.attemptAcquire()) { await this.dispatchAcquired(); return; } }
      catch (e) { this.logger.error(`lease acquire attempt ${i + 1} failed: ${(e as Error).message}`); }
    }
    this.logger.error('lease 急重试 30 次耗尽——passive 按行到期续试（ready=lease-not-acquired/lease-held/lease-error）');
    for (;;) {
      if (this.halted || this.state !== 'not-acquired') return;
      let waitMs = 5_000;
      try {
        const row = await this.prisma.$queryRaw<{ expiresAt: Date | null }[]>`
          SELECT "expiresAt" FROM "CollabLease" WHERE scope = ${COLLAB_LEASE_SCOPE}`;
        if (row[0]?.expiresAt) {
          const remain = row[0].expiresAt.getTime() - Date.now() + 100;
          waitMs = Math.max(200, Math.min(remain, 5_000));
        }
      } catch { /* 行读失败按 5s */ }
      await sleep(waitMs * (0.9 + Math.random() * 0.2));
      if (this.halted || this.state !== 'not-acquired') return;
      try { if (await this.attemptAcquire()) { await this.dispatchAcquired(); return; } } catch { /* passive 续试 */ }
    }
    } finally { this.acquireLoopRunning = false; }
  }

  /** CAS 一语句组（自愈 seed+revoked 门同事务）——语句层 $transaction 有界（N3：PG 黑洞时 promise 必然
   *  settle，onModuleInit/HTTP 绑定不被拖死——替代 2s race，消灭"后台悄悄成功"僵尸窗口）。 */
  private async attemptAcquire(): Promise<boolean> {
    if (this.halted) return false;
    const ttl = this.ttlMs;
    try {
      this.statementFailedFlag = false;
      const rows = await this.prisma.$transaction(
        async (tx) => {
          // Z17 自愈 seed：行缺失自重建（获取路径 leaseRowMissing 结构性不可达——写路径保留区分）
          await tx.$executeRaw`INSERT INTO "CollabLease" (scope, owner, epoch, "expiresAt", "renewedAt")
            VALUES (${COLLAB_LEASE_SCOPE}, NULL, 0, NULL, NULL) ON CONFLICT (scope) DO NOTHING`;
          // V5/I2/I6：everHeld 进程对 revoked 行执行行政终态门——break-glass 的运维意图（让位新实例）
          // 不得被本进程 rejoin 经 expiresAt<now() 支路抢回（新进程 everHeld=false 照常可夺）。
          // unknown-expired 隔离不查行——此门是 revoked 检查的唯一 held 入口对称面。
          if (this.everHeld) {
            const row = await tx.$queryRaw<{ owner: string | null }[]>`
              SELECT owner FROM "CollabLease" WHERE scope = ${COLLAB_LEASE_SCOPE}`;
            if (row[0]?.owner === REVOKED_OWNER) { this.revoke(); return []; }
          }
          return tx.$queryRaw<{ epoch: bigint }[]>`
            UPDATE "CollabLease" SET owner = ${this.owner}, epoch = epoch + 1,
              "expiresAt" = now() + make_interval(secs => ${ttl / 1000}), "renewedAt" = now()
            WHERE scope = ${COLLAB_LEASE_SCOPE}
              AND (owner IS NULL OR owner = ${this.owner} OR "expiresAt" < now())
            RETURNING epoch`;
        },
        { timeout: 2_000, maxWait: 500 },
      );
      if (rows.length === 0) { collabLeaseDeniedTotal.inc({ reason: 'contention' }); return false; }
      this.onHeld(rows[0].epoch);
      return true;
    } catch (e) {
      this.statementFailedFlag = true;
      collabLeaseDeniedTotal.inc({ reason: 'error' });
      throw e;
    }
  }

  /** V4/I1 原子：state='held' ⟺ 心跳在跑 ∧ repo/spool 接线完成——接线失败即释放租约行并抛
   *  （调用方见 start-failed 语义，绝不留"持有租约但无心跳/无 spool owner"的半态僵尸）。 */
  private onHeld(epoch: bigint): void {
    this.epoch = epoch;
    this.renewedAt = new Date();
    try {
      this.repo.setLeaseOwner(this.owner);   // 契约 16：唯一写者
      this.spool.setOwner(this.owner);       // R3：写路径切每实例子目录（构造期已保 owner 合法——此为防御断点）
    } catch (e) {
      this.state = 'not-acquired';
      collabStartFailureTotal.inc();
      this.logger.error(`lease onHeld 接线失败——释放租约行拒当僵尸: ${(e as Error).message}`);
      void this.prisma.$queryRaw`
        UPDATE "CollabLease" SET owner = NULL, "expiresAt" = NULL, "renewedAt" = NULL
        WHERE scope = ${COLLAB_LEASE_SCOPE} AND owner = ${this.owner}`.catch(() => {});
      throw e;
    }
    this.state = 'held';
    this.everHeld = true;
    collabLeaseEpoch.set(Number(epoch));
    this.lastRenewOkMono = process.hrtime.bigint();
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => { void this.heartbeat().catch(() => {}); }, this.heartbeatMs);
    this.heartbeatTimer.unref?.();   // E35：独立 unref timer——进程退出不被阻
  }
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.unknownRetryTimer) { clearTimeout(this.unknownRetryTimer); this.unknownRetryTimer = null; }
  }

  /** 心跳三态（E35/SV1）：renewed=续期；0 行→classifyZeroRow（fenced|revoked|lease-error）；
   *  unknown（抛错）=PG 抖动≠被接管——1s 重试直到**单调钟到期**（ttl+hb 无成功）才隔离。
   *  **禁把 unknown 当 fenced**（一次 PG 1s 抖动不得踢全队）；**禁加回 TTL 守卫**。 */
  private async heartbeat(): Promise<void> {
    if (this.state !== 'held' || this.halted || this.unknownRetryTimer) return;
    if (this.lastRenewOkMono !== 0n
      && process.hrtime.bigint() - this.lastRenewOkMono >= BigInt(this.ttlMs + this.heartbeatMs) * 1_000_000n)
      return this.isolate('heartbeat-unknown-expired');
    try {
      const rows = await this.prisma.$transaction(
        (tx) => tx.$queryRaw<{ renewedAt: Date }[]>`
          UPDATE "CollabLease" SET "expiresAt" = now() + make_interval(secs => ${this.ttlMs / 1000}), "renewedAt" = now()
          WHERE scope = ${COLLAB_LEASE_SCOPE} AND owner = ${this.owner}
          RETURNING "renewedAt"`,
        { timeout: 2_000, maxWait: 500 },
      );
      if (rows.length === 0) return void this.classifyZeroRow().catch(() => { this.statementFailedFlag = true; });
      this.lastRenewOkMono = process.hrtime.bigint();
      this.renewedAt = rows[0].renewedAt;
    } catch {
      this.scheduleUnknownRetry();
    }
  }

  /** renew 0 行分流（W7/N2②）：owner='revoked'（break-glass 撤销）→revoked 终态不 rejoin；
   *  行缺失→statementFailed（lease-error 档——不隔离不伪装 fenced，§0.5）；他人持有→真 fenced。 */
  private async classifyZeroRow(): Promise<void> {
    const row = await this.prisma.$queryRaw<{ owner: string | null }[]>`
      SELECT owner FROM "CollabLease" WHERE scope = ${COLLAB_LEASE_SCOPE}`;
    if (row.length === 0) { this.statementFailedFlag = true; return; }
    if (row[0]?.owner === REVOKED_OWNER) return this.revoke();
    this.isolate('heartbeat-fenced');
  }

  private scheduleUnknownRetry(): void {
    if (this.unknownRetryTimer || this.state !== 'held') return;
    this.unknownRetryTimer = setTimeout(() => { this.unknownRetryTimer = null; void this.heartbeat(); }, 1_000);
    this.unknownRetryTimer.unref?.();
  }

  /** 自隔离（E35 不自杀不硬撑）：repo fence 收口（owner=null=断言恒败）+gateway.onLost（关 WS/listener）。
   *  计数单源=gateway.selfIsolate（{cause} 标签——一次失守至多计 1）。lost→rejoinLoop（SV5）。 */
  private isolate(cause: LeaseLostCause): void {
    if (this.state === 'lost' || this.state === 'revoked') return;
    this.state = 'lost';
    this.statementFailedFlag = false;
    this.stopHeartbeat();
    collabLeaseEpoch.set(0);            // V6：不再持有——gauge 复位（值班不读旧实例 epoch）
    this.repo.setLeaseOwner(null);   // 契约 16 fail-closed（spool.setOwner 不清——P19）
    this.logger.error(JSON.stringify({ event: 'collab_lease_lost', cause, note: 'rejoin 退避重获取中（B7 re-listen 可行）' }));
    try { this.onLost?.(cause); } catch (e) { this.logger.warn(`onLost callback failed: ${(e as Error).message}`); }
    void this.rejoinLoop().catch(() => {});
  }

  /** break-glass 撤销终态（SV2/W7）：运维行政性降级——不 rejoin（防 1s 内抢回）；重启才重新参与。 */
  private revoke(): void {
    if (this.state === 'revoked') return;
    const wasHeld = this.state === 'held';
    this.state = 'revoked';
    this.statementFailedFlag = false;
    this.stopHeartbeat();
    collabLeaseEpoch.set(0);            // V6
    this.repo.setLeaseOwner(null);
    this.logger.error(JSON.stringify({ event: 'collab_lease_revoked', note: 'break-glass 撤销——终态不 rejoin，进程重启才重新参与' }));
    if (wasHeld) try { this.onLost?.('revoked'); } catch { /* gateway 侧幂等 */ }
  }

  /** SV5：lost→退避 [1,2,5,15,30]s 封顶 30s 重获取——owner=$me 支路使"未被夺"场景立即复得；
   *  被夺则等 TTL/释放。halted/状态迁移即退出。 */
  private async rejoinLoop(): Promise<void> {
    const backoff = [1_000, 2_000, 5_000, 15_000, 30_000];
    for (let i = 0; ; i++) {
      if (this.halted || this.state !== 'lost') return;
      await sleep(backoff[Math.min(i, backoff.length - 1)]);
      if (this.halted || this.state !== 'lost') return;
      try {
        if (await this.attemptAcquire()) { await this.dispatchAcquired(); return; }
      } catch { /* 续试 */ }
    }
  }

  /** 显式释放（§2.4 步骤 6 ≤2s）：owner=NULL 使下实例 CAS 立即命中（RTO 不吃 TTL）；
   *  SIGKILL 截断则下实例等 TTL（过期支路兜底）。非 held 态 no-op。 */
  async release(): Promise<void> {
    this.stopHeartbeat();
    if (this.state !== 'held') return;
    try {
      await this.prisma.$queryRaw`
        UPDATE "CollabLease" SET owner = NULL, "expiresAt" = NULL, "renewedAt" = NULL
        WHERE scope = ${COLLAB_LEASE_SCOPE} AND owner = ${this.owner}`;
    } catch (e) { this.logger.warn(`lease release failed（下实例将等 TTL 接管）: ${(e as Error).message}`); }
    this.state = 'not-acquired';
    collabLeaseEpoch.set(0);   // V6
    this.repo.setLeaseOwner(null);
  }

  /** W9/M3/N9：关停闸——halt 后 acquireLoop/rejoinLoop/心跳全部退出（防关停期抢租约留死 owner）；
   *  sleep 均 unref（"坏版本部署/PG 长故障期重启"不被吊到 kill_timeout SIGKILL）。 */
  halt(): void { this.halted = true; this.stopHeartbeat(); }

  /** ready 诊断（§3.3）：held 时 owner/epoch/renewedAt 本地即得；否则读 DB 行（lease-held 取证）。
   *  行读取失败静默（pg-down 由 ready 的 SELECT 1 先判）。 */
  async diag(): Promise<CollabLeaseDiag> {
    let holder: string | null = null;
    let epoch: string | null = null;
    let renewedAt: Date | null = null;
    if (this.state === 'held') {
      holder = this.owner;
      epoch = this.epoch?.toString() ?? null;
      renewedAt = this.renewedAt;
    } else {
      try {
        const row = await this.prisma.$queryRaw<{ owner: string | null; epoch: bigint; renewedAt: Date | null }[]>`
          SELECT owner, epoch, "renewedAt" FROM "CollabLease" WHERE scope = ${COLLAB_LEASE_SCOPE}`;
        holder = row[0]?.owner ?? null;
        epoch = row[0]?.epoch != null ? row[0].epoch.toString() : null;
        renewedAt = row[0]?.renewedAt ?? null;
      } catch { /* pg-down 分流 */ }
    }
    return {
      state: this.state,
      owner: this.state !== 'not-acquired' ? this.owner : null,
      holder, epoch, renewedAt,
      statementFailed: this.statementFailedFlag,
    };
  }
}
```

- [ ] **Step 6: 跑测试确认绿**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab-lease.service.spec.ts`
Expected: PASS×15（含 V4/V5/V7 新三例：onHeld 原子/everHeld-revoked 门/单飞）。

- [ ] **Step 7: break-glass 脚本（SV2/W7——tsx+tsconfig.scripts.json 载体先例）**

`apps/api/scripts/collab-lease-breakglass.ts`：

```typescript
// Y0a-3（SV2/W7）：运维逃生阀——撤销当前持有者。写 'revoked' 哨兵+expiresAt=now()+epoch+1：
//  新实例 CAS 经 expiresAt<now() 支路立即可得；被撤销实例 renew 0 行→owner='revoked'→revoked
//  终态不 rejoin（防 1s 内抢回）。epoch 单调由下次 CAS +1 保持。
// runbook 三步（spec §5.2）：①本脚本 ②确认旧实例日志 collab_lease_revoked+listener 已释放
//  ③起新实例。缺第②步=一次不可审计的停机。
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const prev = await prisma.$queryRaw<{ owner: string | null; epoch: bigint; expiresAt: Date | null }[]>`
      SELECT owner, epoch, "expiresAt" FROM "CollabLease" WHERE scope = 'primary'`;
    if (prev.length === 0) { console.error('CollabLease 行缺失——无需撤销（seed 会自建）'); process.exitCode = 1; return; }
    console.log(JSON.stringify({ event: 'breakglass_prev', owner: prev[0].owner, epoch: prev[0].epoch.toString(), expiresAt: prev[0].expiresAt?.toISOString() ?? null }));
    await prisma.$executeRawUnsafe(
      `UPDATE "CollabLease" SET owner = 'revoked', epoch = epoch + 1, "expiresAt" = now(), "renewedAt" = NULL WHERE scope = 'primary'`,
    );
    // AuditLog 审计行（字段名经 tsconfig.scripts 的 tsc --noEmit 编译期校验——V31 核验确认；
    // V8：审计是旁路不是前置——写失败只 WARN（UPDATE 已生效=撤销事实优先，勿让值班误判"撤销失败"重跑））
    try {
      await prisma.auditLog.create({
        data: {
          operatorId: 'system:breakglass', operatorName: 'system:breakglass',
          targetType: 'COLLAB_LEASE', targetId: 'primary', action: 'collab_breakglass',
          afterValue: { owner: 'revoked', epoch: (prev[0].epoch + 1n).toString() },
          remark: `前任 owner=${prev[0].owner} epoch=${prev[0].epoch} expiresAt=${prev[0].expiresAt?.toISOString() ?? null}`,
        },
      });
    } catch (e) { console.warn(`breakglass 审计写失败（撤销已生效）: ${(e as Error).message}`); }
    console.log(JSON.stringify({ event: 'breakglass_done', note: '确认旧实例日志 collab_lease_revoked + listener 释放后，起新实例' }));
  } finally { await prisma.$disconnect(); }
}
void main();
```

- [ ] **Step 8: verify-indexes 绿+Commit**

Run: `node scripts/verify-indexes.mjs`
Expected: PASS（Task 1 Step 5 的红转绿——迁移后枚举值+不变量成立）。

```bash
git add apps/api/prisma apps/api/src/modules/collab/collab-lease.service.ts apps/api/src/modules/collab/collab-lease.service.spec.ts apps/api/src/modules/collab/store.metrics.ts apps/api/scripts/collab-lease-breakglass.ts
git commit -m "feat(collab): Y0a-3 T2 PG 租约 service——CAS(自愈 seed+语句层 2s 有界)+心跳 owner-only(单调钟)+classifyZeroRow(revoked 终态)+rejoin+halt+dispatchAcquired 单点；break-glass 脚本+指标全集(labelNames)"
```

---

### Task 3: repo fence 下沉（owner-only+advisory lock）+readConsistent 两出口（cursor 0n）+int 真库 G-3b+int 测试池拆分

**Files:**
- Modify: `apps/api/src/modules/collab/canvas-doc-update.repository.ts` + `.spec.ts`
- Create: `apps/api/src/modules/collab/collab-lease-fence.int.spec.ts`
- Modify: `apps/api/src/test-utils/db-fixtures.ts`（ensureLeaseFixture）
- Modify: `apps/api/vitest.config.ts` + Create: `apps/api/vitest.int.config.ts` + Modify: `apps/api/package.json`（P15）
- Modify: 三个既有 int spec（append/compact/spool——beforeEach 接 fixture；hydration 同加）

- [ ] **Step 1: int 测试池拆分（P15/W13——先行：本 Task 起真库用例不经默认池）**

`vitest.config.ts`：

```typescript
import path from 'path';
import { configDefaults } from 'vitest/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Y0a-3（P15/B10）：int 从默认池排除——单行 CollabLease 全局资源×文件级并行=互踩；
    // verify/test job 不再触真库。int 归 test:int（专用配置串行）。
    exclude: [...configDefaults.exclude, '**/*.int.spec.ts'],
  },
  resolve: { alias: { '@flowweb/shared': path.resolve(__dirname, '../../packages/shared/src') } },
});
```

`vitest.int.config.ts`（新建）：

```typescript
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.int.spec.ts'],
    fileParallelism: false,   // CollabLease 单行——串行（Z22 根修）
  },
  resolve: { alias: { '@flowweb/shared': path.resolve(__dirname, '../../packages/shared/src') } },
});
```

`package.json` test:int 改：`"test:int": "vitest run -c vitest.int.config.ts"`。

验证：`pnpm --filter @flowweb/api test`（无 DATABASE_URL 环境）不再发现 int 文件；`DATABASE_URL=... pnpm --filter @flowweb/api test:int` 串行跑 int。

- [ ] **Step 2: 写失败测试（mock 层——fence owner-only 形状/leaseRowMissing/not-owner/两出口）**

`canvas-doc-update.repository.spec.ts` 追加 describe（既有 mock 形态 `$transaction.mockImplementation(fn=>fn(prisma))` 家族保持）：

```typescript
describe('Y0a-3 fence 下沉（契约 2/15/16——owner-only SV1+advisory lock SV3）', () => {
  // B14：Prisma tagged template 传 mock 的第一参是字符串数组、插值在后续参——断言一律
  // `call[0].join('?')` 看形状 + `call.slice(1)` 看值（仓内惯例 video-work.service.spec:351）；
  // 文本断言永不红=诱导 $queryRawUnsafe 内插（注入面）。
  const shape = (c: any[]) => (c[0] as string[]).join('?');

  function buildRepo(opts: {
    query?: ReturnType<typeof vi.fn>;        // 事务外 $queryRaw（二次查）
    txQuery?: ReturnType<typeof vi.fn>;      // 事务内 $queryRaw（INSERT/fence/页查询）
    txExec?: ReturnType<typeof vi.fn>;       // 事务内 $executeRaw（advisory lock）
    docRow?: { stateSeq: bigint } | null;    // canvasDoc.findUnique 返回（cursor 判别性）
  } = {}) {
    const query = opts.query ?? vi.fn().mockResolvedValue([]);
    const txq = opts.txQuery ?? vi.fn().mockResolvedValue([]);
    const exec = opts.txExec ?? vi.fn().mockResolvedValue([]);
    const prisma = {
      $queryRaw: query,
      $transaction: vi.fn((fn: any) => fn({
        $queryRaw: txq,
        $executeRaw: exec,
        canvasDocUpdate: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
        canvasDoc: { findUnique: vi.fn().mockResolvedValue(opts.docRow ?? null), upsert: vi.fn() },
      })),
    };
    return { repo: new CanvasDocUpdateRepository(prisma as any), prisma, txq, exec, query };
  }

  it('append：advisory lock（值=p1）+owner-only EXISTS（形状无 TTL 项）——与 compact 同 key', async () => {
    const txq = vi.fn().mockResolvedValue([{ seq: 1n }]);
    const exec = vi.fn().mockResolvedValue([]);
    const { repo, exec: e } = buildRepo({ txQuery: txq, txExec: exec });
    repo.setLeaseOwner('me');
    const r = await repo.append('p1', new Uint8Array([1]));
    expect(r).toEqual({ ok: true, seq: 1n });
    expect(e.mock.calls.length).toBeGreaterThanOrEqual(1);            // 锁语句被执行
    expect(shape(e.mock.calls[0])).toContain('pg_advisory_xact_lock(hashtext(?)');   // 占位符形态（禁内插）
    expect(e.mock.calls[0].slice(1)).toEqual(['p1']);                 // 锁键=projectId（与 compact 同源）
    const insert = txq.mock.calls[0];
    expect(shape(insert)).toContain('EXISTS (SELECT 1 FROM "CollabLease"');
    expect(shape(insert)).not.toContain('"expiresAt" >= now()');      // SV1：fence 去 TTL
    expect(insert.slice(1)).toEqual(expect.arrayContaining(['p1', 'me']));   // owner=绑定值
  });

  it('owner=null 显式 throw lease-owner-not-set（P7：配置错误不伪装 fenced）', async () => {
    const { repo } = buildRepo();
    await expect(repo.append('p1', new Uint8Array([1]))).rejects.toThrow('lease owner not set');
  });

  it('fenced=0 行不抛异常（B2）→二次查行在→{ok:false,reason:"fenced"}（契约 15；no-row 死值已删）', async () => {
    const txq = vi.fn().mockResolvedValue([]);                       // INSERT 0 行
    const query = vi.fn().mockResolvedValue([{ owner: 'other' }]);   // 二次查
    const { repo } = buildRepo({ query, txQuery: txq });
    repo.setLeaseOwner('me');
    await expect(repo.append('p1', new Uint8Array([1]))).resolves.toEqual({ ok: false, reason: 'fenced' });
  });

  it('leaseRowMissing：二次查空行→throw（不伪装 fenced/不进重试语义）', async () => {
    const txq = vi.fn().mockResolvedValue([]);
    const query = vi.fn().mockResolvedValue([]);                     // 二次查空 同 mock
    const { repo } = buildRepo({ query, txQuery: txq });
    repo.setLeaseOwner('me');
    await expect(repo.append('p1', new Uint8Array([1]))).rejects.toMatchObject({ leaseRowMissing: true });
  });

  it('compact 事务首行租约断言：不符→{compacted:false,reason:"not-owner"}+零删除+断言先于锁（调用序判据）', async () => {
    const txq = vi.fn()
      .mockResolvedValueOnce([])                        // 首行 fence 断言=0 行
      .mockResolvedValue([{ owner: 'other' }]);         // 二次查
    const exec = vi.fn().mockResolvedValue([]);
    const { repo, exec: e } = buildRepo({ txQuery: txq, txExec: exec });
    repo.setLeaseOwner('me');
    const r = await repo.compact('p1');
    expect(r).toEqual({ compacted: false, reason: 'not-owner' });
    expect(e.mock.calls.length).toBe(0);                // 锁未被调用——fence 断言先于锁（调用序而非文本）
  });

  it('readSnapshotOnly=第二出口（契约 1"一个实现、两出口"）——同 readConsistent 事务形态+计数', async () => {
    const { repo } = buildRepo({ docRow: null });
    const r = await repo.readSnapshotOnly('p1');
    expect(r).toEqual({ state: null, updates: [], stateSeq: 0n });
  });

  it('readConsistent 游标初值 0n（SV3 判别性——docRow.stateSeq=42n 时旧实现从 42 起、新实现从 0 起）', async () => {
    const txq = vi.fn().mockResolvedValue([]);   // 增量页空（首页即止）
    const { repo, txq: q } = buildRepo({ txQuery: txq, docRow: { stateSeq: 42n } });
    await repo.loadForHydration('p1');
    const page = q.mock.calls.find((c) => shape(c).includes('seq >'))!;
    expect(shape(page)).toContain('seq > ?::bigint');            // 谓词保留（去谓词=满页死循环——W15）
    expect(page.slice(1)).toEqual(['p1', 0n, 500]);              // 游标=0n 非 42n+页大小绑定值
  });
});
```

（既有 spec 的 mock 适配按实际事务拦截形态对齐——断言意图不变；**V32 连带改写**：既有 `append returned no row` 相关旧三值用例与 gateway :391-392 的 else-throw 分支随 'no-row' 死值删除同步改写为二值形态——执行期 grep `no-row` 清单化处理。）

- [ ] **Step 3: 跑测试确认红**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/collab/canvas-doc-update.repository.spec.ts`
Expected: FAIL×7——setLeaseOwner/readSnapshotOnly 不存在、append SQL 无锁无 EXISTS。

- [ ] **Step 4: 实现 repository 改造**

`canvas-doc-update.repository.ts`：

类字段（:8 logger 后）：

```typescript
  /** 契约 16（v2.5）：唯一写者=CollabLeaseService（获取/失守/释放时调用）；owner=null ⇒
   *  append/compact 断言恒不通过=天然 fail-closed（P7：null 显式 throw——"lease service 从未注入"
   *  是排序/配置 bug，伪装 fenced 会误导自隔离方向）。禁逐调用点传参（漏传=静默破防）。 */
  private leaseOwner: string | null = null;
  setLeaseOwner(owner: string | null): void { this.leaseOwner = owner; }
```

append 改写（:17-29）：

```typescript
  /** P23/V26 锁键单源：append/compact 共用——任何一处漂移=stateSeq 静默变谎话（配合
   *  canvas-doc-insert-ratchet.spec.ts 静态断言"INSERT 仅在本文件"形成双守卫）。 */
  private lockProject(tx: { $executeRaw: (q: unknown) => Promise<unknown> }, projectId: string): Promise<unknown> {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId})::bigint)`;
  }

  async append(projectId: string, update: Uint8Array): Promise<{ ok: true; seq: bigint } | { ok: false; reason: 'fenced' }> {
    const owner = this.leaseOwner;
    if (owner == null) throw Object.assign(new Error('append blocked: lease owner not set（契约 16 fail-closed）'), { leaseNotHeld: true });   // V13：gateway 第三分类标记
    const rows = await this.prisma.$transaction(
      async (tx) => {
        // SV3/W14：与 compact 同 key advisory lock——seq 序≡提交序（stateSeq 保持可信水位），
        // append×compact 竞态结构性消失；单锁无死锁面；亚毫秒级（仅同项目并发写时排队）。
        await this.lockProject(tx, projectId);
        return tx.$queryRaw<{ seq: bigint }[]>`
        INSERT INTO "CanvasDocUpdate" (id, "projectId", seq, update, "createdAt")
        SELECT gen_random_uuid()::text, ${projectId}, nextval('canvas_doc_update_seq')::bigint, ${Buffer.from(update)}, now()
        WHERE EXISTS (SELECT 1 FROM "CollabLease"
                       WHERE scope = 'primary' AND owner = ${owner})
        RETURNING seq`;
      },
      { timeout: 5_000, maxWait: 1_000 },
    );
    if (rows.length > 0) return { ok: true, seq: rows[0].seq };
    // 0 行=fenced（B2 不抛）。二次查区分（v2.5 消静默）：行被删=配置错误（leaseRowMissing，重试无用
    // ——gateway 落 spool 不排梯 SV13）；行在=确为 fenced（owner≠me）。
    const lease = await this.prisma.$queryRaw<{ owner: string | null }[]>`
      SELECT owner FROM "CollabLease" WHERE scope = 'primary'`;
    if (lease.length === 0) {
      throw Object.assign(
        new Error('CollabLease row missing（行被删——配置错误非 fenced；修复=补行后重启回灌）'),
        { leaseRowMissing: true },
      );
    }
    return { ok: false, reason: 'fenced' };
  }
```

loadForHydration/readSnapshotOnly/readConsistent（:40-70 重构——事务体原样搬移为 readConsistent 私有体，**游标初值改 0n、seq 谓词保留**）：

```typescript
  async loadForHydration(
    projectId: string,
    opts?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<{ state: Buffer | null; updates: Buffer[]; stateSeq: bigint }> {
    return this.readConsistent(projectId, opts);
  }

  /** 契约 1（"一个实现、两出口"）：投影出口（video-work 快照/克隆）——不 apply 到 doc、不触 store/
   *  compact；与装载出口共用同一单 RR 事务实现，禁复制第二份。 */
  async readSnapshotOnly(projectId: string): Promise<{ state: Buffer | null; updates: Buffer[]; stateSeq: bigint }> {
    yjsSnapshotReadTotal.inc();
    return this.readConsistent(projectId);
  }

  private async readConsistent(
    projectId: string,
    opts?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<{ state: Buffer | null; updates: Buffer[]; stateSeq: bigint }> {
    /* 原 loadForHydration 事务体原样（findUnique/分页游标/巨帧 WARN 全不动），唯一改动：
       let cursor = docRow?.stateSeq ?? 0n;  →  let cursor = 0n;
       （SV3/W15：nextval 取号与提交序无绑定——水位过滤在绕锁路径下=静默丢内容；append 侧
       advisory lock 已使 seq 序≡提交序（stateSeq 重新可信），读侧全量为双保险且正常路径等价。
       分页 seq>cursor 谓词保留——去掉谓词=满页死循环。） */
  }
```

（import 行补 `yjsSnapshotReadTotal`；方法头注释随迁 readConsistent。）

compact 事务首行断言（:120-122 advisory lock **之前**；opts 不再有 skipLeaseAssert——SV8）：

```typescript
      async (tx) => {
        const owner = this.leaseOwner;
        if (owner == null) throw Object.assign(new Error('compact blocked: lease owner not set（契约 16 fail-closed）'), { leaseNotHeld: true });
        const fence = await tx.$queryRaw<{ ok: number }[]>`
          SELECT 1 AS ok WHERE EXISTS (SELECT 1 FROM "CollabLease" WHERE scope = 'primary' AND owner = ${owner})`;
        if (fence.length === 0) {
          const row = await tx.$queryRaw<{ owner: string | null }[]>`
            SELECT owner FROM "CollabLease" WHERE scope = 'primary'`;
          if (row.length === 0) {
            throw Object.assign(new Error('CollabLease row missing（compact fence）'), { leaseRowMissing: true });
          }
          yjsCompactNotOwnerTotal.inc();   // SV8：not-owner 分立（abandoned=pendingStructs 专用不污染）
          this.logger.warn(`compact not-owner for ${projectId}（租约档——行数不减）`);
          return { compacted: false, reason: 'not-owner' as const };
        }
        await this.lockProject(tx, projectId);   // P23：锁键单源（与 append 同 helper）
        /* ……原事务体不动…… */
      },
```

- [ ] **Step 5: 跑 mock 单测确认绿**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/collab/canvas-doc-update.repository.spec.ts`
Expected: PASS（新增 7+既有全绿）。

- [ ] **Step 6: db-fixtures 增 ensureLeaseFixture（P13）+既有 int spec 接入**

`db-fixtures.ts` 追加：

```typescript
/** Y0a-3（P13/V23）：fence 落地后真库 append/compact 需要 CollabLease 行 owner 匹配——int/演练共用。
 *  ON CONFLICT DO UPDATE（Z17 同判）；过期 **5min**（非 1h——残留 fixture 不长挡本地 dev/gate，
 *  干扰窗压到分钟级且 dev API rejoinLoop 自愈）；配套 restoreLeaseRow 供各 int spec afterAll 复原。 */
export const LEASE_FIXTURE_OWNER = 'int-test-lease';
export async function ensureLeaseFixture(
  prisma: PrismaClient, repo?: { setLeaseOwner(o: string | null): void }, owner = LEASE_FIXTURE_OWNER,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CollabLease" (scope, owner, epoch, "expiresAt") VALUES ('primary', $1, 1, now() + interval '5 minutes')
     ON CONFLICT (scope) DO UPDATE SET owner = $1, "expiresAt" = now() + interval '5 minutes'`, owner,
  );
  repo?.setLeaseOwner(owner);
}
/** V23：int 后复原全局租约行（afterAll 调——防残留 fixture 挡本地 dev API/gate 的下一次获取）。 */
export async function restoreLeaseRow(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "CollabLease" SET owner = NULL, "expiresAt" = NULL, "renewedAt" = NULL WHERE scope = 'primary'`,
  );
}
```

四个既有 int spec（append/compact/spool/hydration）beforeEach 追加 `await ensureLeaseFixture(prisma, repo)`（hydration 只读同加——防未来加写用例漏）**+afterAll 追加 `await restoreLeaseRow(prisma)`**（V23——中断/崩溃外的常态路径零残留；gate/drill 侧另有清行 helper 兜底，见 T9/T10）。**本步后 int 全绿再进下一步**：

Run: `DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int`
Expected: PASS（既有条数不变——经专用配置串行）。

- [ ] **Step 7: 写真库 fence int 用例（G-3b+倒挂——红）**

`collab-lease-fence.int.spec.ts`（hasDb 门控惯例+自建 FK 行；**倒挂用例带 10s 超时**——SV3/W15 死循环形态=挂起而非红）：

```typescript
// Y0a-3 T3：fence 写语句真库证明（G-3b+leaseRowMissing+两出口同构+提交序倒挂）——repo 层直接
// 操纵租约行模拟 A 持锁/B 夺锁（lease service 获取路径语义归 collab-lease.service.spec mock 层）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture } from '../../test-utils/db-fixtures';

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d('fence 下沉真库（G-3b+SV3 倒挂）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);
  const projectId = 'y0a3-fence-int';

  beforeAll(async () => { await ensureProjectFixture(prisma as any, projectId); });
  afterAll(async () => {
    await prisma.$executeRawUnsafe(`UPDATE "CollabLease" SET owner = NULL, "expiresAt" = NULL WHERE scope = 'primary'`);
    await cleanupProjectFixture(prisma as any, projectId);
    await prisma.$disconnect();
  });

  it('A 持锁 append ok → B 夺锁（行 UPDATE owner=B）→ A append={ok:false,fenced}（写语句级，非内存布尔）', async () => {
    await ensureLeaseFixture(prisma as any, repo, 'owner-A');
    const r1 = await repo.append(projectId, Y.encodeStateAsUpdate(new Y.Doc()));
    expect(r1.ok).toBe(true);
    await prisma.$executeRawUnsafe(`UPDATE "CollabLease" SET owner = 'owner-B', "expiresAt" = now() + interval '1 hour' WHERE scope = 'primary'`);
    const r2 = await repo.append(projectId, Y.encodeStateAsUpdate(new Y.Doc()));
    expect(r2).toEqual({ ok: false, reason: 'fenced' });
  });

  it('A 的 compact 在 B 持锁期不删行（{compacted:false,reason:"not-owner"}+CanvasDocUpdate 行数不减）', async () => {
    await ensureLeaseFixture(prisma as any, repo, 'owner-A');
    await repo.append(projectId, Y.encodeStateAsUpdate(new Y.Doc()));
    const before = await repo.count(projectId);
    await prisma.$executeRawUnsafe(`UPDATE "CollabLease" SET owner = 'owner-B', "expiresAt" = now() + interval '1 hour' WHERE scope = 'primary'`);
    const r = await repo.compact(projectId);
    expect(r).toEqual({ compacted: false, reason: 'not-owner' });
    expect(await repo.count(projectId)).toBe(before);
  });

  it('租约行缺失：append throws leaseRowMissing（配置错误不伪装 fenced）——finally 复原（V31：中途失败不毒化本地 verify 链）', async () => {
    repo.setLeaseOwner('owner-A');
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "CollabLease" WHERE scope = 'primary'`);
      await expect(repo.append(projectId, new Uint8Array([1]))).rejects.toMatchObject({ leaseRowMissing: true });
    } finally {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "CollabLease" (scope, owner, epoch, "expiresAt") VALUES ('primary', NULL, 0, NULL)
         ON CONFLICT (scope) DO NOTHING`,
      );
    }
  });

  it('readSnapshotOnly 与 loadForHydration 同构（同一 readConsistent 两出口）', async () => {
    await ensureLeaseFixture(prisma as any, repo);
    await repo.append(projectId, Y.encodeStateAsUpdate(new Y.Doc()));
    const a = await repo.readSnapshotOnly(projectId);
    const b = await repo.loadForHydration(projectId);
    expect(a.updates.length).toBe(b.updates.length);
    expect(a.stateSeq).toBe(b.stateSeq);
  });

  it('提交序倒挂（SV3 证明——10s 超时防死循环形态）：compact 后手工 INSERT 低 seq 行 → 装载必含其内容', async () => {
    await ensureLeaseFixture(prisma as any, repo);
    const doc = new Y.Doc();
    doc.getMap('nodes').set('inverted-marker', new Y.Map([['v', 1]]));
    await repo.append(projectId, Y.encodeStateAsUpdate(doc));
    const c = await repo.compact(projectId);   // stateSeq 落定（如 11）
    expect(c.compacted).toBe(true);
    // 模拟绕锁迟到提交（advisory lock 之外的直接 INSERT——运维脚本/极端窗口形态）：低 seq 行
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CanvasDocUpdate" (id, "projectId", seq, update, "createdAt")
       SELECT gen_random_uuid()::text, $1, 10, $2::bytea, now()`, projectId, Buffer.from(Y.encodeStateAsUpdate(doc)),
    );
    const loaded = await Promise.race([
      repo.loadForHydration(projectId),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('装载死循环/超时——cursor 未从 0 起')), 10_000)),
    ]);
    const replay = new Y.Doc();
    for (const u of loaded.updates) Y.applyUpdate(replay, new Uint8Array(u));
    expect(replay.getMap('nodes').has('inverted-marker')).toBe(true);   // 水位过滤会永久跳过=断言红
  });
});
```

- [ ] **Step 8: 跑 int 确认绿**

Run: `DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int`
Expected: PASS×5（fence int 新 5 例+既有全绿）。

- [ ] **Step 9: 运维脚本租约行接管（SV8/W20——无 skipLeaseAssert 旁路）**

`collab-compact.ts` / `collab-spool-import.ts` main 内同款接管（W20 守卫+V8 运维反噬修复——健康持有者需 --force；**60s 接管窗+finally 释放**：脚本中途死掉不得让生产实例 10min 无法获取租约；import 脚本要 scan() 故**必须同时 spool.setOwner**——P2-1：activeDir 必填 throw 会让脚本必挂）：

```typescript
// SV8/W20/V8：运维脚本经租约行接管获得 fence 权限（诚实形态；热路径零豁免口）。守卫：行有活跃
// 持有者（expiresAt>now()）时拒绝——改 owner 会让健康实例立刻 fenced→isolate→踢用户一轮。
const row = await prisma.$queryRawUnsafe(`SELECT owner, "expiresAt" FROM "CollabLease" WHERE scope = 'primary'`);
const healthy = row[0] && row[0].expiresAt && row[0].expiresAt.getTime() > Date.now();
if (healthy && !process.argv.includes('--force')) {
  console.error(`拒绝：租约有活跃持有者 ${row[0].owner}——确认实例已停或加 --force`);
  process.exit(1);
}
const OPS_OWNER = 'ops:collab-compact';   // import 脚本用 'collab-spool-import'
const takeover = async () => {
  await prisma.$executeRawUnsafe(
    `UPDATE "CollabLease" SET owner = '${OPS_OWNER}', epoch = epoch + 1, "expiresAt" = now() + interval '60 seconds' WHERE scope = 'primary'`,
  );
  repo.setLeaseOwner(OPS_OWNER);
  spool?.setOwner(OPS_OWNER);   // import 脚本（scan 必需）；compact 脚本不触 spool 可不传
};
await takeover();
try {
  /* ……主体（compact / scan+replayAll）——长操作周期性续期：await takeover() 每 30s（循环内）…… */
} finally {
  // V8：异常退出也释放——防脚本崩溃后生产实例 60s+ 内无法获取租约（runbook 注明）
  await prisma.$executeRawUnsafe(`UPDATE "CollabLease" SET owner = NULL, "expiresAt" = NULL, "renewedAt" = NULL WHERE scope = 'primary' AND owner = '${OPS_OWNER}'`).catch(() => {});
}
```

- [ ] **Step 9.5: INSERT 单源静态断言（V26/P23——body-param-ratchet.spec.ts 先例形态）**

`apps/api/src/modules/collab/canvas-doc-insert-ratchet.spec.ts`（fs 读源码断言——W14 锁不变量的守卫面）：

```typescript
// V26：CanvasDocUpdate 的 INSERT 只允许出现在 repository.append 内——任何绕锁写入都会把
// stateSeq 重新变成谎话（seq 序≡提交序 的前提被静默破坏）。静态断言先例=body-param-ratchet。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (e.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('CanvasDocUpdate INSERT 单源（P23）', () => {
  it('INSERT INTO "CanvasDocUpdate" 仅出现在 canvas-doc-update.repository.ts', () => {
    const src = tsFiles(join(__dirname));
    const violators = src.filter((f) => {
      if (f.endsWith('canvas-doc-update.repository.ts') || f.endsWith('.spec.ts') || f.includes('scripts')) return false;
      return /INSERT\s+INTO\s+"CanvasDocUpdate"/.test(readFileSync(f, 'utf8'));
    });
    expect(violators).toEqual([]);
  });
});
```

（范围=src/modules 排除 spec/脚本；int spec 的手工 INSERT 属测试面豁免。）

- [ ] **Step 10: verify+Commit**

Run: `pnpm verify`
Expected: 全绿（默认池已排除 int——mock 套件不触真库 fence）。

```bash
git add apps/api/src/modules/collab apps/api/src/test-utils apps/api/scripts/collab-compact.ts apps/api/scripts/collab-spool-import.ts apps/api/vitest.config.ts apps/api/vitest.int.config.ts apps/api/package.json
git commit -m "feat(collab): Y0a-3 T3 fence owner-only 下沉+append 同 key advisory lock+leaseRowMissing 区分+readConsistent 两出口(cursor 0n)；G-3b 真库 5 例+int 专用池(P15)"
```

---

### Task 4: spool 每实例子目录（R3——owner 必填+fs-safe+外来段 boot 收养+depth 分区+reconcile 接口）

**Files:**
- Modify: `apps/api/src/modules/collab/collab-spool.service.ts` + `.spec.ts`
- Modify: `apps/api/scripts/collab-spool-quarantine.ts`

- [ ] **Step 1: 写失败测试（双 owner 并存/跨 owner 回收/收养分档/depth 分区/必填 throw）**

`collab-spool.service.spec.ts` 追加 describe：

```typescript
describe('Y0a-3 R3：每实例子目录（fenced 前任并发写防护+P18 boot 收养）', () => {
  it('双 service 实例同根目录：各写各的 owner 子目录——段名不冲突+scan 后 peek 跨 owner 聚合', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a3-r3-');
    try {
      const a = new CollabSpoolService(dir); a.setOwner('owner-A');
      const b = new CollabSpoolService(dir); b.setOwner('owner-B');
      await a.append('p1', new Uint8Array([1]));
      await b.append('p1', new Uint8Array([2]));
      const fa = await a.peek('p1');   // a 未重扫——scan 前只见自己（写路径 activeDir）
      expect(fa).toHaveLength(1);
      await b.scan();                  // b 启动扫描=双 owner 全量重建（外来段 boot 收养——P18）
      const fb = await b.peek('p1');
      expect(fb).toHaveLength(2);      // A 残留+B 自有——跨 owner 聚合（前任帧回灌面）
    } finally { await cleanup(); }
  });

  it('跨 owner 回收：B 的 replayAll confirm 后——B 段 unlink+A 段同判据回收+空 owner 目录 rmdir', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a3-r3-');
    try {
      const a = new CollabSpoolService(dir); a.setOwner('owner-A');
      await a.append('p1', new Uint8Array([1]));
      const b = new CollabSpoolService(dir); b.setOwner('owner-B');
      await b.scan();
      const repo = { append: vi.fn(async () => ({ ok: true as const, seq: 1n })) };
      const r = await b.replayAll(repo as any);
      expect(r.replayed).toBe(1);
      expect(b.hasFrames('p1')).toBe(false);           // 全段回收（含 A 的段——unlink 在 A 的子目录内）
      const { existsSync } = await import('node:fs');
      expect(existsSync(join(dir, 'owner-A'))).toBe(false);   // 空目录已 rmdir
    } finally { await cleanup(); }
  });

  it('外来段坏尾：静默截断到最后完整帧（sealed=true，不进 truncatedSegments——前任半写=常态）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a3-r3-foreign-');
    try {
      const a = new CollabSpoolService(dir); a.setOwner('owner-A');
      await a.append('p1', new Uint8Array([1]));
      // 造坏尾：直接 append 半个头（不经 service——模拟前任 kill 瞬间）
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(dir, 'owner-A', 'p1.0.spool'), Buffer.alloc(3));
      const b = new CollabSpoolService(dir); b.setOwner('owner-B');
      const { truncatedSegments } = await b.scan();
      expect(truncatedSegments).toHaveLength(0);      // 外来坏尾不报告（P18 分档）
      const frames = await b.peek('p1');
      expect(frames.length).toBeGreaterThanOrEqual(1);   // 完整帧仍可回灌
    } finally { await cleanup(); }
  });

  it('容量含外来段（I8/V2）：own+外来合计越限 → append 抛 spool capacity exceeded（熔断不得排除 stranded）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a3-r3-cap-');
    try {
      const a = new CollabSpoolService(dir); a.setOwner('owner-A');
      const b = new CollabSpoolService(dir); b.setOwner('owner-B');
      const big = new Uint8Array(CollabSpoolService.SPOOL_CAPACITY_BYTES / 2 + 1024);   // 各自 ~128MB 段（SEGMENT_MAX_BYTES 内单段不可造——用多段累加形态，执行期按段上限循环 append 逼近半量）
      await a.append('p1', big);
      await b.scan();   // b 视角：own(p2)+stranded(p1)
      const half = CollabSpoolService.SPOOL_CAPACITY_BYTES / 2;
      let acc = 0; const frame = new Uint8Array(1024 * 1024);
      while (acc < half) { try { await b.append('p2', frame); acc += frame.byteLength; } catch { break; } }
      // 再追加必须因 total（own+stranded）越限而抛——若熔断只看 own 则此断言红
      await expect(b.append('p2', new Uint8Array(1024 * 1024))).rejects.toThrow(/capacity/);
      expect(b.isWritable()).toBe(false);
    } finally { await cleanup(); }
  });

  it('depth 分区（P16）：own=stranded 分离+hasForeignSegments 廉价守卫', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a3-r3-depth-');
    try {
      const a = new CollabSpoolService(dir); a.setOwner('owner-A');
      await a.append('p1', new Uint8Array([1]));
      const b = new CollabSpoolService(dir); b.setOwner('owner-B');
      await b.append('p2', new Uint8Array([2]));
      await b.scan();
      expect(b.hasForeignSegments()).toBe(true);
      const d = b.depth();
      expect(d.ownFiles).toBe(1);          // p2（own 口径——部署门）
      expect(d.strandedFiles).toBe(1);     // p1（外来——磁盘真值部分）
    } finally { await cleanup(); }
  });

  it('adoptSilentForeignSegments（W21）：mtime 静默后收养——foreign=false 纳入 own 口径', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a3-r3-adopt-');
    try {
      const a = new CollabSpoolService(dir); a.setOwner('owner-A');
      await a.append('p1', new Uint8Array([1]));
      const b = new CollabSpoolService(dir); b.setOwner('owner-B');
      await b.scan();
      const fresh = await b.adoptSilentForeignSegments(60_000);
      expect(fresh).toHaveLength(0);       // 刚写——mtime 未静默
      const staled = await b.adoptSilentForeignSegments(0);   // 0ms=立即视为静默（测试形态）
      expect(staled).toHaveLength(1);
      expect(b.depth().ownFiles).toBe(1);  // 收养后 own
      expect(b.hasForeignSegments()).toBe(false);
    } finally { await cleanup(); }
  });

  it('owner 未设：activeDir throw（Z13 fail-closed——单测/运维脚本显式 setOwner）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a3-r3-null-');
    try {
      const s = new CollabSpoolService(dir);          // 不 setOwner
      await expect(s.append('p1', new Uint8Array([1]))).rejects.toThrow(/owner not set/);
      await expect(s.scan()).rejects.toThrow(/owner not set/);
    } finally { await cleanup(); }
  });

  it('setOwner 断言文件系统安全名（W4 配套）：含 ":" → throw', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a3-r3-fs-');
    try {
      const s = new CollabSpoolService(dir);
      expect(() => s.setOwner('host:123:abc')).toThrow(/文件系统安全/);
    } finally { await cleanup(); }
  });

  it('replayAll 定向回灌（Z11 复用单源）：opts.projectIds 过滤', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a3-r3-replay-');
    try {
      const s = new CollabSpoolService(dir); s.setOwner('owner-A');
      await s.append('p1', new Uint8Array([1]));
      await s.append('p2', new Uint8Array([2]));
      const repo = { append: vi.fn(async () => ({ ok: true as const, seq: 1n })) };
      await s.replayAll(repo as any, { projectIds: ['p1'] });
      expect(s.hasFrames('p1')).toBe(false);
      expect(s.hasFrames('p2')).toBe(true);   // 未点名不回灌
    } finally { await cleanup(); }
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab-spool.service.spec.ts -t "R3"`
Expected: FAIL——setOwner 不存在。

- [ ] **Step 3: 实现（P11 段键重构+P18 收养分档+P16 分区）**

`collab-spool.service.ts` 改动（六组）：

1）SegmentMeta+键结构（:31-46 区域）：

```typescript
interface SegmentMeta {
  frameCount: number;
  goodBytes: number;
  bytes: number;
  confirmed: Set<number>;
  confirmedCount: number;
  sealed: boolean;
  quarantinedRange: { fromOffset: number } | null;
  quarantinedBytes: number;
  dir: string;        // R3：段所在绝对目录（scan 重建/appendRaw 新建/跨 owner unlink 定位）
  seq: number;        // 段号（appendRaw 滚段判定的 max 计算）
  foreign: boolean;   // P18：外来段标记（depth stranded 分区+reconciler 收养对象）
}
```

```typescript
const segFileName = (projectId: string, segSeq: number) => `${projectId}.${segSeq}.spool`;   // 不变

/** R3 单源枚举（scan+quarantine 脚本+reconciler 共消费）：root 平铺段+一级子目录段（owner 目录）。 */
export async function listSpoolFiles(dir: string): Promise<{ dir: string; name: string }[]> {
  const out: { dir: string; name: string }[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) for (const f of await readdir(join(dir, e.name))) out.push({ dir: join(dir, e.name), name: f });
    else out.push({ dir, name: e.name });
  }
  return out;
}
```

2）owner/activeDir（:55 后+构造旁）：

```typescript
  /** R3：owner 作用域写目录（唯一写者=CollabLeaseService.onHeld）——fenced 前任与本进程并发
   *  append 同名段=两句柄交错写=帧互毁；每实例独立子目录物理分置。Z13 必填：未设即 throw
   *  （生产唯一写者=lease 必先设；单测/运维脚本显式 setOwner）。W4：文件系统安全名断言
   *  （Windows 禁 ':' ——owner 生成侧已保证，此为防御断点）。 */
  private owner: string | null = null;
  setOwner(owner: string): void {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(owner)) throw new Error(`spool owner 非文件系统安全名: ${owner}`);   // V25：去 '.'——禁 '..' 路径逃逸（join(dir,'..')）
    this.owner = owner;
  }
  private activeDir(): string {
    if (!this.owner) throw new Error('spool owner not set——lease service 唯一写者必先 setOwner（契约 16 同族）');
    return join(this.dir, this.owner);
  }
  /** 段键：root 段=文件名；子目录段='<ownerDir>/<文件名>'（含 '/' 无 ':'——frameId lastIndexOf(':') 解析安全）。 */
  private segKeyOf(dir: string, name: string): string {
    return dir === this.dir ? name : `${relative(this.dir, dir).split(sep).join('/')}/${name}`;
  }
```

（`import { relative, sep } from 'node:path'` 补入现有 path import；`rmdir` 补入 fs/promises import。）

3）index 声明（:55）：`Map<number, SegmentMeta>` → `Map<string, SegmentMeta>`（键=segKey）。

4）appendRaw（:172-236）——活动目录+滚段计算改 meta.seq（同项目同活动目录内 max）：

```typescript
  private async appendRaw(projectId: string, payload: Uint8Array): Promise<string[]> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) throw new Error(`非法 projectId: ${projectId}`);   // B6 路径断言
    const adir = this.activeDir();
    await mkdir(adir, { recursive: true, mode: 0o700 });
    let segSeq = -1; let meta: SegmentMeta | undefined;
    const segs = this.index.get(projectId);
    if (segs && segs.size > 0) {
      // 活动目录内最大段号（前任段在其它目录=物理不撞名，不参与滚段计算）
      let maxSeq = -1;
      for (const m of segs.values()) if (m.dir === adir && m.seq > maxSeq) maxSeq = m.seq;
      if (maxSeq >= 0) {
        segSeq = maxSeq;
        meta = segs.get(this.segKeyOf(adir, segFileName(projectId, segSeq)));
        if (meta) {
          const st = await stat(join(adir, segFileName(projectId, segSeq))).catch(() => null);
          if (st && st.size !== meta.bytes) meta.sealed = true;
          if (meta.sealed || meta.goodBytes !== meta.bytes
            || meta.bytes + FRAME_HEADER_BYTES + payload.byteLength > SEGMENT_MAX_BYTES) {
            segSeq += 1; meta = undefined;
          }
        }
      }
    }
    if (segSeq < 0) segSeq = 0;
    if (!meta) {
      meta = { frameCount: 0, goodBytes: 0, bytes: 0, confirmed: new Set(), confirmedCount: 0, sealed: false, quarantinedRange: null, quarantinedBytes: 0, dir: adir, seq: segSeq, foreign: false };
      if (!segs) this.index.set(projectId, new Map());
      this.index.get(projectId)!.set(this.segKeyOf(adir, segFileName(projectId, segSeq)), meta);
    }
    const frameIdx = meta.frameCount;
    /* ……header 构造/写入/fchmod/fsync/封段回滚 原样——path 全部 join(adir, segFileName(projectId, segSeq))，
       新段父目录 fsync 的 open(this.dir) 改 open(adir)；封段回滚分支 segsNow.delete(segSeq) 改删 segKey…… */
    return [`${this.segKeyOf(adir, segFileName(projectId, segSeq))}:${frameIdx}`];   // frameId=segKey:idx
  }
```

5）peek/confirm/quarantineTruncatedFrames：

```typescript
  // peek：遍历键按 (meta.seq, meta.dir) 字典序排序（跨 owner 顺序无语义——CRDT 幂等，确定性排序为测试稳定）；
  //       readFile(join(meta.dir, segFileName(projectId, meta.seq)))；frameId 同 appendRaw 形态。
  // confirm：id.lastIndexOf(':') 解析 segKey+idx；unlink(join(meta.dir, segFileName(...))+sidecar 后
  //         若 meta.dir !== this.dir 则 rmdir(meta.dir).catch(()=>{})（空 owner 目录回收——ENOTEMPTY 静默下轮再试）；
  //         segs.delete(segKey)。其余判据原样（ENOENT 容错——P2-2：reconciler 先收走时序）。
  // quarantineTruncatedFrames：readdir(this.dir) 平铺循环改 for (const { dir, name } of await listSpoolFiles(this.dir))
  //         ——sidecar 写 join(dir, `${name}.quarantine`)。
```

6）scan（:346-381）+帧循环单源+收养分档（P18）+depth/hasForeign/adopt：

```typescript
  /** 帧循环单源（W21）：scan/adoptSilentForeignSegments 共用——返回完整帧数/好字节/是否坏尾。 */
  private parseSegmentFrames(buf: Buffer): { frameCount: number; goodBytes: number; truncated: boolean } {
    let off = 0; let frameCount = 0;
    /* ……原 scan 帧循环体（header 长度校验/CRC/前进）原样搬移，返回 {frameCount, goodBytes: off, truncated: off !== buf.byteLength}…… */
  }

  async scan(): Promise<{ truncatedSegments: string[] }> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const adir = this.activeDir();   // Z13：owner 必填断点（scan 前必有 lease——生产形态）
    const next = new Map<string, Map<string, SegmentMeta>>();   // V3：临时 map 末尾整体 swap——中途抛错（EACCES/EIO）不留半截索引（半截=未入索引段对 depth/keys/hasFrames 全不可见=部署门假绿+回灌漏）
    const truncatedSegments: string[] = [];
    for (const { dir, name: f } of await listSpoolFiles(this.dir)) {
      const parsed = parseSegFileName(f);
      if (!parsed) continue;
      if (parsed.projectId === '__probe__') { await unlink(join(dir, f)).catch(() => {}); continue; }
      const isForeign = dir !== adir;
      const buf = await readFile(join(dir, f));
      if (buf.byteLength < FRAME_HEADER_BYTES) { await unlink(join(dir, f)).catch(() => {}); continue; }   // <8B 残片段回收（现行为）
      const { frameCount, goodBytes, truncated } = this.parseSegmentFrames(buf);
      // P18 截尾分档：本 owner 段坏尾=truncated 报告+计数（磁盘故障可观测）；
      //   外来段坏尾=静默截断到最后完整帧 sealed=true（前任 kill 瞬间半写=常态非故障——Z12 真意）
      if (truncated && !isForeign) {
        truncatedSegments.push(f);
        yjsSpoolTruncatedTotal.inc();   // 现有指标（仅 own 段——外来坏尾不计=假告警面消灭）
      }
      const segs = next.get(parsed.projectId) ?? new Map<string, SegmentMeta>();
      segs.set(this.segKeyOf(dir, f), {
        frameCount, goodBytes, bytes: buf.byteLength,
        confirmed: new Set(), confirmedCount: 0, sealed: truncated,
        quarantinedRange: null, quarantinedBytes: 0,
        dir, seq: parsed.segSeq, foreign: isForeign,
      });
      next.set(parsed.projectId, segs);
    }
    this.index = next;   // P19 幂等重建不变量保持（confirmed 集不跨世代存续——重复回灌 CRDT 幂等无害）
    return { truncatedSegments };
  }

  /** P16/V2/I8：深度两口径单源——own=本 owner 目录段（drainable，**部署门/ready.pending**）；
   *  stranded=外来段；**total（own+stranded 磁盘真值）=容量熔断+gauges+G-1 barrier**（B15：gauges 是
   *  collect 形态读 pendingCollector——两口径经 PendingSnapshot 扩字段实现，见组 7）。
   *  ⚠ 熔断三处消费点（append 置位 :115/滞回解除 :119/探针恢复 :291-292）**必须**改用
   *  depthTotalBytes()——直读 d.bytes 在五元组下=undefined 比较恒 false=熔断双向静默失效（V2 根因）。 */
  depth(): { ownFiles: number; ownBytes: number; strandedFiles: number; strandedBytes: number; quarantinedBytes: number } {
    let ownFiles = 0, ownBytes = 0, strandedFiles = 0, strandedBytes = 0, quarantinedBytes = 0;
    for (const [pid, segs] of this.index) {
      if (pid === '__probe__') continue;
      for (const m of segs.values()) {
        if (m.foreign) { strandedFiles++; strandedBytes += m.bytes; }
        else { ownFiles++; ownBytes += m.bytes; }
        quarantinedBytes += m.quarantinedBytes;
      }
    }
    return { ownFiles, ownBytes, strandedFiles, strandedBytes, quarantinedBytes };
  }
  /** V14 语义不变（含隔离字节）：容量判定=磁盘真值 total——外来段同占盘不得排除。 */
  private depthTotalBytes(d: ReturnType<CollabSpoolService['depth']>): number { return d.ownBytes + d.strandedBytes; }
  totalFiles(d: ReturnType<CollabSpoolService['depth']> = this.depth()): number { return d.ownFiles + d.strandedFiles; }

  hasForeignSegments(): boolean {   // P2-2 廉价守卫：30s tick 无外来段零 IO
    for (const segs of this.index.values()) for (const m of segs.values()) if (m.foreign) return true;
    return false;
  }

  /** W21/Z11（SV4）：收养静默外来段（前任残余——boot 后新出现者；mtime ≥silentMs 无写入=其进程
   *  已死/已让位）。完整重扫（parseSegmentFrames 单源）；收养后 foreign=false 纳入 own 口径；
   *  坏尾此时按本 owner 档处理（sealed 截断——内容以完整帧为准）。返回收养清单（reconciler 回灌对象）。 */
  async adoptSilentForeignSegments(silentMs: number): Promise<{ projectId: string; dir: string; name: string }[]> {
    const now = Date.now();
    const adopted: { projectId: string; dir: string; name: string }[] = [];
    for (const [pid, segs] of [...this.index.entries()]) {
      for (const [key, m] of [...segs.entries()]) {
        if (!m.foreign) continue;
        const path = join(m.dir, segFileName(pid, m.seq));
        const st = await stat(path).catch(() => null);
        if (!st || now - st.mtimeMs < silentMs) continue;
        const buf = await readFile(path).catch(() => null);
        if (!buf) continue;
        const { frameCount, goodBytes, truncated } = this.parseSegmentFrames(buf);
        segs.set(key, { frameCount, goodBytes, bytes: buf.byteLength, confirmed: new Set(), confirmedCount: 0,
          sealed: truncated, quarantinedRange: null, quarantinedBytes: 0, dir: m.dir, seq: m.seq, foreign: false });
        adopted.push({ projectId: pid, dir: m.dir, name: segFileName(pid, m.seq) });
      }
    }
    return adopted;
  }

  /** Y0a-3（§3.3）：当前隔离段数（ready.spoolQuarantined 源——quarantinedRange != null 计数，__probe__ 排除）。 */
  quarantinedSegments(): number {
    let n = 0;
    for (const [pid, segs] of this.index) {
      if (pid === '__probe__') continue;
      for (const m of segs.values()) if (m.quarantinedRange != null) n += 1;
    }
    return n;
  }
```

replayAll 签名扩 `opts?: { projectIds?: string[] }`（:388——keys() 遍历前若提供则过滤；reconciler 定向回灌复用单源，禁复制第二实现）。

7）**store.metrics PendingSnapshot 扩展+gauges 取 total（V2/B15/I8——"两口径"在 collect 架构下的唯一落法）**：

```typescript
// store.metrics.ts：collector 契约扩 stranded 字段（B15：gauges 与 ready.pending 同源 computePending——
// 结构上不存在"set 处"；口径选择上移到两个消费端）
type PendingSnapshot = {
  projects: number; batches: number; storeInFlight: number;
  spoolFiles: number; spoolBytes: number;           // own 口径（drainable——ready.pending/部署门）
  strandedFiles: number; strandedBytes: number;     // 外来段（磁盘真值部分——透出+WARNING）
};
export const yjsSpoolDepthFiles = new Gauge({
  name: 'yjs_spool_depth_files',
  help: 'spool 段文件数（**total=own+stranded 磁盘真值**——容量告警+G-1 barrier 判据；部署门读 /api/ready.pending 的 own 口径，P16）',
  registers: [register],
  collect() { try { const p = pendingCollector?.(); this.set(p ? p.spoolFiles + p.strandedFiles : 0); } catch { this.set(0); } },
});
export const yjsSpoolDepthBytes = new Gauge({
  name: 'yjs_spool_depth_bytes',
  help: 'spool 段字节总和（**total 含隔离与外来字节**——容量核算同口径，V14/P16）',
  registers: [register],
  collect() { try { const p = pendingCollector?.(); this.set(p ? p.spoolBytes + p.strandedBytes : 0); } catch { this.set(0); } },
});
```

（三消费端口径由此唯一化：**熔断=depthTotalBytes()/gauges=total/部署门=own/ready=own+stranded 分区**；drill 的 quiescence barrier 读 `yjs_spool_depth_*`=磁盘真值归零——语义与现状一致，**写死这句防后人把 barrier 当部署门用**。`yjs_pending_projects/batches` 两 gauge 的 collect 兼容新快照字段〔`.projects/.batches` 键名不变〕零改动。）

8）**容量熔断三处回填（V2——漏改=undefined 比较恒 false=熔断双向静默失效）**：`append()` 置位（:115）与滞回解除（:119）、探针恢复判据（:291-292）的 `d.bytes` 全部改 `this.depthTotalBytes(this.depth())`。

- [ ] **Step 4: collab-spool-quarantine.ts 切 listSpoolFiles**

`for (const f of (await readdir(dir)).filter(...))` 改：

```typescript
import { listSpoolFiles } from '../src/modules/collab/collab-spool.service';
// ...
for (const { dir: segDir, name: f } of await listSpoolFiles(dir)) {
  if (!f.endsWith('.spool') || f.startsWith('__probe__')) continue;   // Y6 探针过滤
  const projectId = f.split('.').slice(0, -2).join('.');
  const buf = await readFile(join(segDir, f));
  /* ……sidecar 读/摘要素材/删除段全部 join(segDir, ...)…… */
}
```

- [ ] **Step 5: 跑 spool 全套确认绿（含既有用例——owner 显式传后零回归）**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab-spool.service.spec.ts && DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api exec vitest run -c vitest.int.config.ts src/modules/collab/collab-spool.int.spec.ts`
Expected: PASS（新增 8+既有全绿；int 的 service 构造补 setOwner——执行期按红点逐个补显式 owner）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/collab/collab-spool.service.ts apps/api/src/modules/collab/collab-spool.service.spec.ts apps/api/scripts/collab-spool-quarantine.ts
git commit -m "feat(collab): Y0a-3 T4 spool 每实例子目录(R3)——owner 必填 fs-safe+段键文件名化+外来段 boot 收养(截尾分档 P18)+depth 两口径+adoptSilentForeignSegments+listSpoolFiles 单源"
```

---

### Task 5: gateway 拓扑切换——删 extension 挂载+collabState 状态机+启动链单点+isolate/rejoin 卫生+drain 冻结+I-3/M3

> **受影响既有用例清单（W33——状态机改造面，执行时逐个核绿）**：`collab.gateway.shutdown.spec.ts`（步骤 1 draining 语义→beginDraining/collabState+drain 生命周期三断言）、`collab.gateway.auth-reason.spec.ts`（DRAINING 档断言照旧——isShuttingDown() 派生）、`collab.gateway.persist-status.spec.ts`/`sweep`/`env`（构造参数 4）、`collab.gateway.spec.ts`（elapsed :228-232 归 T6；kit 用例经 stub 契约）、multi-instance（T6 整删重写）。grep `this.draining` 全部改 collabState 派生。

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`
- Modify: `apps/api/src/modules/collab/collab.module.ts`（+LeaseService/AuditService 注册——redisSync provider 留 T6 删）
- Create: `apps/api/src/modules/collab/test-utils/lease-stub.ts`
- Modify: `apps/api/src/test-utils/dual-client-server.ts`
- Modify: `apps/api/src/modules/collab/collab.gateway.spec.ts`（+lease 门用例）

- [ ] **Step 1: lease-stub 工具（W5 契约载体）**

`test-utils/lease-stub.ts`：

```typescript
// Y0a-3：CollabGateway 构造参数 4 的租约 stub——**契约同构（W5 单点负责制+V1 三件套）**：
// tryAcquireFast 成功 ⇒ ①repo.setLeaseOwner(owner) ②spool.setOwner(owner) ③await onAcquired
// （真实现 onHeld/dispatchAcquired 同序）——**缺①②则 kit 的 spool.scan() 在 activeDir() 处 throw**
// （T4 owner 必填）⇒ 全部 kit 用例落 start-failed=测试地基没了。gateway.onModuleInit 返回即
// collab 面已启动（kit `await onModuleInit() ⇒ 已 listen` 不变量保持，dual-client-server.ts:52）。
// G-3/门用例经 over 关闭。
import { vi } from 'vitest';

export interface LeaseStub {
  isServing: ReturnType<typeof vi.fn>;
  tryAcquireFast: ReturnType<typeof vi.fn>;
  acquireLoop: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  halt: ReturnType<typeof vi.fn>;
  diag: ReturnType<typeof vi.fn>;
  onAcquired?: () => void | Promise<void>;
  onLost?: (cause: string) => void;
}
export function createLeaseStub(
  over: Partial<LeaseStub> = {},
  deps: { repo?: { setLeaseOwner(o: string | null): void }; spool?: { setOwner(o: string): void } } = {},
): LeaseStub {
  const stub: LeaseStub = {
    isServing: vi.fn(() => true),
    tryAcquireFast: vi.fn(async () => {
      deps.repo?.setLeaseOwner('stub-owner-1');    // V1 契约三件套之①②——与真实现 onHeld 同序
      deps.spool?.setOwner('stub-owner-1');
      await stub.onAcquired?.();                   // ③
      return true;
    }),
    acquireLoop: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    halt: vi.fn(() => {}),
    diag: vi.fn(async () => ({ state: 'held', owner: 'stub-owner-1', holder: 'stub-owner-1', epoch: '1', renewedAt: new Date(), statementFailed: false })),
    ...over,
  };
  return stub;
}
```

- [ ] **Step 2: 写失败测试（三入口门+不 listen+selfIsolate/看门狗/I-3/M3/leaseRowMissing 落 spool——P14 红相守卫）**

`collab.gateway.spec.ts` 追加 describe（经 kit 构造；lease 经 kit 第 4 参注入）：

```typescript
describe('Y0a-3 租约三入口门+selfIsolate/启动链（G-3/G-3b mock 面）', () => {
  it('G-3：lease 未持有→authenticate 拒 LEASE_NOT_READY（瞬态档）+服务端不关 socket（J2 半边）', async () => {
    const kit = await startDualClientServer({}, 300, undefined, createLeaseStub({ isServing: vi.fn(() => false) }));
    try {
      const conn = { socket: { close: vi.fn() } };
      await expect(kit.gateway.hooks.onAuthenticate({
        requestHeaders: new Map(), requestParameters: new URLSearchParams('?token=tok'),
        documentName: 'project:p1', connectionConfig: {}, connection: conn as any,
      } as any)).rejects.toMatchObject({ reason: CollabAuthReason.LEASE_NOT_READY });
      expect(conn.socket.close).not.toHaveBeenCalled();   // 拒绝不关 socket——provider 自动重连消费瞬态档
    } finally { await kit.dispose(); }
  });

  it('G-3：lease 未持有→loadDocument 拒（P1：正确性门——与 spool 降级态的"永不 gate"分立）', async () => {
    const kit = await startDualClientServer({}, 300, undefined, createLeaseStub({ isServing: vi.fn(() => false) }));
    try {
      await expect(kit.gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p1' } as any))
        .rejects.toMatchObject({ reason: CollabAuthReason.LEASE_NOT_READY });
      expect(kit.repo.hydrateWithRecovery).not.toHaveBeenCalled();
    } finally { await kit.dispose(); }
  });

  it('G-3：tryAcquireFast 失败→onModuleInit 返回但不 listen（detached acquireLoop 接管）', async () => {
    const lease = createLeaseStub({ tryAcquireFast: vi.fn(async () => false) });
    const gateway = new CollabGateway({} as any, new EventEmitter2() as any, createMockRepo() as any,
      lease as any, { resolve: vi.fn() } as any, 48100, 300, undefined, undefined,
      new CollabSpoolService((await makeSpoolDir('y0a3-g3-')).dir));
    const listenSpy = vi.spyOn(gateway.server, 'listen').mockImplementation(async () => {});
    try {
      await gateway.onModuleInit();
      expect(listenSpy).not.toHaveBeenCalled();
      expect(lease.acquireLoop).toHaveBeenCalled();
    } finally { listenSpy.mockRestore(); }
  });

  it('启动链单点（W5）：stub 契约=成功⇒已 await onAcquired——onModuleInit 返回即 serving', async () => {
    const kit = await startDualClientServer();   // 默认 stub（契约形态）
    try {
      expect(kit.gateway.getCollabState()).toBe('serving');   // await onModuleInit 后（kit 构造内）
      expect(kit.gateway.server.httpServer?.listening).toBe(true);
    } finally { await kit.dispose(); }
  });

  it('G-3b/必办①：append fenced→selfIsolate（closeAll1012+关 listener+lost{cause}）+批走 spool 不排梯', async () => {
    const kit = await startDualClientServer({ append: vi.fn(async () => ({ ok: false as const, reason: 'fenced' as const })) });
    try {
      const closeSpy = vi.spyOn(kit.gateway as any, 'closeAllConnections1012').mockImplementation(() => {});
      const doc = new Y.Doc();
      kit.gateway['pendingQueues'].set('pf1', [new Uint8Array([1])]);
      await kit.gateway.hooks.onStoreDocument({ document: doc, documentName: 'project:pf1' } as any);
      expect(kit.gateway.getCollabState()).toBe('isolated');
      expect(closeSpy).toHaveBeenCalled();
      expect(await kit.spool.peek('pf1')).toHaveLength(1);                 // 批已落 spool（契约 15）
      expect(kit.gateway['persistRetry'].has('project:pf1')).toBe(false);   // fenced=终态禁梯
    } finally { await kit.dispose(); }
  });

  it('必办⑧/I-3：isolated 后 schedulePersistRetry 不排（梯项目转 fenced 永续重排收口）', async () => {
    const kit = await startDualClientServer();
    try {
      (kit.gateway as any).collabState = 'isolated';
      kit.gateway['schedulePersistRetry']('project:px');
      expect(kit.gateway['persistRetry'].has('project:px')).toBe(false);
    } finally { await kit.dispose(); }
  });

  it('必办⑨/M3：retryPersist 帧通道 FK 收割——已删项目帧 confirm+cancel 梯+discarded 计数', async () => {
    const fkErr = Object.assign(new Error('FK'), { code: 'P2003' });
    const kit = await startDualClientServer({ append: vi.fn(async () => { throw fkErr; }) });
    try {
      await kit.spool.append('pdel', new Uint8Array([1]));
      kit.gateway['persistRetry'].set('project:pdel', { rung: 0, timer: null });
      const confirmSpy = vi.spyOn(kit.spool, 'confirm');
      await kit.gateway['retryPersist']('project:pdel');
      expect(confirmSpy).toHaveBeenCalledWith('pdel', [expect.any(String)]);
      expect(kit.gateway['persistRetry'].has('project:pdel')).toBe(false);
    } finally { await kit.dispose(); }
  });

  it('SV13/W11：leaseRowMissing→批落 spool（不早退）+不排梯+rowMissing 计数', async () => {
    const kit = await startDualClientServer({ append: vi.fn(async () => { throw Object.assign(new Error('row missing'), { leaseRowMissing: true }); }) });
    try {
      const doc = new Y.Doc();
      kit.gateway['pendingQueues'].set('prm1', [new Uint8Array([1])]);
      await kit.gateway.hooks.onStoreDocument({ document: doc, documentName: 'project:prm1' } as any);
      expect(await kit.spool.peek('prm1')).toHaveLength(1);                 // 落 spool（早退=内存滞留重启丢批）
      expect(kit.gateway['persistRetry'].has('project:prm1')).toBe(false);   // 配置错误重试无用
    } finally { await kit.dispose(); }
  });

  it('SV9/W10：beginDraining 冻结连接+60s 自动解除=1012 复连+响应体 {autoReleaseAt,pending}', async () => {
    vi.useFakeTimers();
    try {
      const kit = await startDualClientServer();
      const { provider } = kit.connect('project:pd1');
      await vi.advanceTimersByTimeAsync(500);
      const frozen = { readOnly: false, sendStateless: vi.fn(), webSocket: { close: vi.fn() } };
      (kit.gateway as any).server.hocuspocus.documents.set('project:pd1', {
        connections: new Map([[frozen as any, null]]),
      });
      const r = kit.gateway.beginDraining();
      expect(r.pending).toMatchObject({ projects: expect.any(Number) });
      expect(frozen.readOnly).toBe(true);                    // 冻结（B12）
      expect(frozen.sendStateless).toHaveBeenCalled();        // write-frozen 通告（Y0b 消费）
      await vi.advanceTimersByTimeAsync(60_000);
      expect(frozen.webSocket.close).toHaveBeenCalledWith(1012, 'drain released');   // 解除=1012 复连
      expect(kit.gateway.getCollabState()).toBe('serving');
      await provider.destroy();
      await kit.dispose();
    } finally { vi.useRealTimers(); }
  });

  it('V12 判据唯一化：collabState=isolated ∧ lease 仍 held（fenced-by-write 窗口）⇒ 三入口全拒+ready 派生 lease-lost', async () => {
    const lease = createLeaseStub();   // isServing 恒 true（lease 视角仍 held——模拟心跳未到）
    const kit = await startDualClientServer({}, 300, undefined, lease);
    try {
      (kit.gateway as any).selfIsolate('fenced-by-write');   // 写路径立即隔离——lease 侧要等 ≤1 心跳
      await expect(kit.gateway.hooks.onAuthenticate({
        requestHeaders: new Map(), requestParameters: new URLSearchParams('?token=tok'),
        documentName: 'project:p1', connectionConfig: {},
      } as any)).rejects.toMatchObject({ reason: CollabAuthReason.LEASE_NOT_READY });   // 若门读 lease.isServing（true）=放行=判据分裂（本用例红）
      await expect(kit.gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p1' } as any))
        .rejects.toMatchObject({ reason: CollabAuthReason.LEASE_NOT_READY });
      expect(kit.gateway.getCollabState()).toBe('isolated');
    } finally { await kit.dispose(); }
  });

  it('I4 rejoin 后 rearm：isolated→rejoin→serving ⇒ spool 残留 own 帧项目 3s 内回到退避梯（部署门可收敛）', async () => {
    const kit = await startDualClientServer();
    try {
      await kit.spool.setOwner('owner-B');   // 残留段制造（前任视角）
      await kit.spool.append('porphan', new Uint8Array([1]));
      await kit.spool.scan();   // 重建 index 使 hasFrames 可见
      (kit.gateway as any).selfIsolate('fenced-by-write');
      (kit.gateway as any).collabState = 'starting';   // 模拟 rejoin 的 startCollabAfterLease 重入路径
      await (kit.gateway as any).listenCollab();       // I4 执行点：listenCollab 末尾 rearmQueues
      expect(kit.gateway.getCollabState()).toBe('serving');
      await new Promise((r) => setTimeout(r, 3_000));
      expect(kit.gateway['persistRetry'].has('project:porphan')).toBe(true);   // own 帧有梯=可收敛
    } finally { await kit.dispose(); }
  });

  it('I4/Y10 seam：onRecovered 接线存在（v3 重排漏接的回归锚——spool IO 熔断恢复唤醒梯）', async () => {
    const kit = await startDualClientServer();
    try {
      expect(typeof (kit.gateway as any).spool.onRecovered).toBe('function');
    } finally { await kit.dispose(); }
  });
});
```

（import 补 `CollabAuthReason`/`createLeaseStub`/`makeSpoolDir`/`EventEmitter2`/`CollabSpoolService`/`createMockRepo`——按文件既有 import 面追加；`startDualClientServer` 第 4 参=lease stub（Step 4h 落）。**P14**：红相阶段对旧 gateway 构造——旧代码参数 4 消费 `syncFromPeers`，stub 无该键=旧代码 loadDocument TypeError=假红转假绿；红相主断言以"不 listen"+"authenticate 拒"两例为准。）

- [ ] **Step 3: 跑测试确认红**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab.gateway.spec.ts -t "租约"`
Expected: FAIL——构造参数不匹配/门不存在。

- [ ] **Step 4: gateway+module+kit 改造**

**4a. 构造与删除面**：
- 删 `:5` RedisExtension import、`:6` ioredis import、`:13` CollabRedisSync import；
- 构造参数 4（:137）`redisSync: CollabRedisSync` → `lease: CollabLeaseService`；
- Server 配置 `extensions: [...]` 块（:174-182）整删（disconnectDelay 随之消失——必办⑦断言对象）；
- loadDocument `:296` `await this.redisSync.syncFromPeers(...)` 行删（装载 1s 阻塞消失）；
- onModuleInit `:804` `this.redisSync.getDocument = ...` 行删。

**4b. collabState 状态机+三入口门**（:108-109 draining 双字段替换）：

```typescript
  /** SV7/W 状态机（单枚举消灭布尔组合态）：ready reason 与三入口门 1:1 派生（P6）。
   *  serving=唯一放行态；draining=部署停写（与 /api/drain 同一位）；isolated=自隔离（listener
   *  已关让位——rejoin 由 lease.rejoinLoop 驱动/revoked 终态）；start-failed=启动失败（有界重试）。 */
  private collabState: 'initializing' | 'acquiring' | 'starting' | 'serving' | 'draining' | 'isolated' | 'start-failed' = 'initializing';
  private initDone = false;             // V9/I3：成功后置（scan/隔离/回灌/rearm 四步全成才 true——早置=失败重试跳过 init 带半截索引上线）
  private startInFlight = false;        // V10：starting 在飞闸（watchdog/5s 定时器/fast-path 并发重入防线）
  private shuttingDown = false;         // V11：关停闸（步骤 1 置位——isolated 态关停时 rejoin 的 CAS 成功也不得 re-listen）
  private listenerClosed: Promise<void> | null = null;   // M2①：isolate 的 close 完成信号（re-listen 前 await）
  private frozenConnections = new Set<{ readOnly?: boolean; sendStateless?: (p: string) => void; webSocket?: { close: (c: number, r: string) => void } }>();
  getCollabState() { return this.collabState; }
  /** V33 迁移单点（三轮病根的结构解）：所有 collabState 写点经此——日志+计数挂钩+开发期合法迁移断言。 */
  private static readonly LEGAL_TRANSITIONS: Record<string, string[]> = {
    initializing: ['acquiring', 'starting'],
    acquiring: ['starting', 'draining', 'isolated'],
    starting: ['serving', 'start-failed', 'draining', 'isolated'],
    serving: ['draining', 'isolated'],
    draining: ['serving', 'isolated'],
    isolated: ['starting', 'draining'],   // rejoin 经 startCollabAfterLease→starting
    'start-failed': ['starting', 'draining', 'isolated'],
  };
  private transition(next: typeof this.collabState, cause?: string): void {
    if (!(next === this.collabState)) {
      const legal = CollabGateway.LEGAL_TRANSITIONS[this.collabState] ?? [];
      if (!legal.includes(next)) this.logger.error(JSON.stringify({ event: 'collab_illegal_transition', from: this.collabState, to: next, cause }));
    }
    this.logger.log(JSON.stringify({ event: 'collab_state', from: this.collabState, to: next, cause }));
    this.collabState = next;
  }
  isLeaseServing(): boolean { return this.collabState === 'serving'; }
  isShuttingDown(): boolean { return this.collabState === 'draining'; }   // 派生（既有消费方两名不变）
```

**V12 判据唯一化**：三入口门统一读 `this.isLeaseServing()`（collabState 派生）——`CollabLeaseService.isServing()`（lease state==='held'）降级为租约状态机内部使用（acquireLoop/rejoinLoop/看门狗），lease 头注释写明"对外服务判据唯一源=collabState"。fenced-by-write 后的窗口（collabState='isolated' 而 lease 侧 ≤1 心跳内仍 'held'）三入口必须已拒——否则 ready=lease-lost 与 authenticate 放行并存=判据分裂（P6"1:1 派生"不可断言）。

authenticate X9 块（:205 前）插：

```typescript
      if (!this.isLeaseServing()) throw deny(CollabAuthReason.LEASE_NOT_READY, 'collab lease not held');   // P0-1 三入口①（V12：collabState 判据）
```

loadDocument 首行（:262 try 之前——P1 正确性门）：

```typescript
    if (!this.isLeaseServing()) {
      throw Object.assign(new Error('collab lease not held'), { reason: CollabAuthReason.LEASE_NOT_READY });   // P0-1 三入口②（WS 与直连都经此；V12）
    }
```

（既有 `this.draining` 全部引用点改 `isShuttingDown()`/collabState——grep 清零。）

**4c. selfIsolate（Z4/B7+M2①）+看门狗（Z7/W22）**（isShuttingDown 家族旁）：

```typescript
  /** E35 自隔离（不自杀不硬撑）：拒新 WS（三入口门）+closeAll1012+**释放 listener 让位**（B7：
   *  closeAllConnections 不关监听——半死场景新实例 listen 必 EADDRINUSE；用 httpServer.close 不用
   *  destroy——后者 memoized 不可逆）。计数单源=本方法（{cause}——写侧直调与心跳侧 onLost 汇入同点，
   *  一次失守至多计 1）。re-listen 前置=M2① await listenerClosed+documents 清空（listenCollab）。 */
  private selfIsolate(cause: 'fenced-by-write' | 'heartbeat-fenced' | 'heartbeat-unknown-expired' | 'revoked'): void {
    if (this.collabState === 'isolated') return;
    this.transition('isolated', cause);   // V33
    collabLeaseLostTotal.inc({ cause });
    this.clearDrainTimer();
    this.frozenConnections.clear();
    this.closeAllConnections1012();
    this.listenerClosed = new Promise<void>((res) => {
      try {
        this.server.httpServer?.closeAllConnections?.();   // Node≥18.2 清 keep-alive
        this.server.httpServer?.close(() => res());
        setTimeout(res, 2_000).unref?.();                  // close 回调兜底
      } catch (e) { this.logger.warn(`isolate: listener close failed: ${(e as Error).message}`); res(); }
    });
    this.logger.error(JSON.stringify({ event: 'collab_self_isolate', cause, note: 'listener 已释放——rejoin 由 lease.rejoinLoop 驱动（revoked 终态）；纯 DB REST 不受影响' }));
  }

  private watchdogFired = false;
  /** 30s 看门狗（Z7/W22）：lease held ∧ 未服务——P0-1 整类失败的可观测出口+一次有界自愈
   *  （N3③：start-failed 且 5s 重试未达时再调度）；counter 每 episode 至多 1 次（无界增长治理）。 */
  private startServingWatchdog(): void {
    const t = setInterval(() => {
      if (this.lease.isServing() && this.collabState !== 'serving' && this.collabState !== 'draining') {
        if (!this.watchdogFired) { this.watchdogFired = true; collabStartFailureTotal.inc(); }
        this.logger.error(JSON.stringify({ event: 'collab_not_serving_watchdog', collabState: this.collabState, listening: this.server.httpServer?.listening }));
        if (this.collabState === 'start-failed') void this.startCollabAfterLease().catch(() => {});
      }
    }, 30_000);
    t.unref?.();
  }
```

（onModuleInit 末调 startServingWatchdog。）

**4d. onModuleInit 重排+startCollabAfterLease 拆分（P9/W5/W8）+leaseRowMissing 落 spool（W11）+I-3/M3**：

```typescript
  async onModuleInit(): Promise<void> {
    // 租约回调接线（W5 单点：启动只经 onAcquired；失守/撤销→selfIsolate）
    this.lease.onAcquired = () => this.startCollabAfterLease();
    this.lease.onLost = (cause) => this.selfIsolate(cause);
    // 事件订阅先于租约（获取窗口内 project.gone/team.disbanded 照常清账——内存终态不依赖 listen）
    this.eventEmitter.on('team.disbanded', (payload: { teamId: string; projectIds: string[] }) => {
      this.handleProjectsGone(payload.projectIds);
    });
    this.eventEmitter.on('project.gone', (payload: { projectIds: string[] }) => {
      this.handleProjectsGone(payload.projectIds);
    });
    this.logger.log(JSON.stringify({ event: 'spool_dir', dir: this.spool.validateDir() }));
    this.startServingWatchdog();
    this.transition('acquiring');
    let acquired = false;
    try { acquired = await this.lease.tryAcquireFast(); }   // 单点负责制：成功⇒已 await 启动；语句层 2s 有界（无 race=无"后台悄悄成功"僵尸）
    catch (e) { this.logger.error(`lease fast-acquire failed: ${(e as Error).message}`); }
    if (acquired) return;   // serving 或 start-failed（后者自调度重试）
    this.logger.error('collab lease not acquired（fast path）——detached 重试中，不 listen（ready=lease-*）');
    void this.lease.acquireLoop().catch((e) => this.logger.error(`lease acquireLoop crashed: ${(e as Error).message}`));
  }

  /** 租约获取成功后的 collab 面启动（onAcquired 唯一入口——fast path/acquireLoop/rejoinLoop 同点）。
   *  W8 拆分：init 四步（scan/隔离/回灌/rearm）+listenCollab（可重复——rejoin re-listen）。
   *  V9/I3：initDone **成功后置**（早置+scan 抛错=重试跳过 init 带半截索引上线=门假绿）；
   *  V11：关停期（步骤 1 置 shuttingDown）不得再起 collab 面（isolated 态关停时 rejoin CAS 成功场景）；
   *  V10：startInFlight 闸防并发重入（watchdog/5s 定时器/fast-path）。 */
  private async startCollabAfterLease(): Promise<void> {
    if (this.collabState === 'serving' || this.collabState === 'draining' || this.shuttingDown || this.startInFlight) return;
    this.startInFlight = true;
    try {
      if (!this.initDone) {
        this.transition('starting');
        const { truncatedSegments } = await this.spool.scan();
        let quarantined = 0;
        for (const seg of truncatedSegments) {
          const projectId = seg.replace(/\.\d+\.spool$/, '');
          quarantined += await this.spool.quarantineTruncatedFrames(projectId);
        }
        const replay = await this.spool.replayAll(this.repo);
        if (quarantined > 0 || replay.failed > 0) {
          this.logger.error(JSON.stringify({ event: 'spool_startup_selfcheck', quarantined, replayFailed: replay.failed, replayed: replay.replayed, discarded: replay.discarded, truncatedSegments }));
        }
        this.rearmQueues();   // I-1：回灌失败残帧落梯（listen 前调用=先备恢复路径后受理）
        this.initDone = true;   // V9：四步全成才置位
      }
      await this.listenCollab();
    } catch (e) {
      this.transition('start-failed');
      collabStartFailureTotal.inc();
      this.watchdogFired = true;   // V14：episode 标志——看门狗不再对同一 episode 双计
      const portErr = this.isPortError(e);
      this.logger.error(JSON.stringify({ event: 'collab_start_failed', error: (e as Error).message, portError: portErr }));
      // V10/N2③ 失败分型：端口类（EADDRINUSE/documents 未卸载）=**本地瞬态、与租约无关**——持锁
      // 有界重试 ≤2 次（旧持有者 ≤1 心跳让位）；非端口类或耗尽 → release（不占租约不服务）
      if (portErr && this.listenRetries < 2) this.listenRetries += 1;
      else { this.listenRetries = 0; await this.lease.release().catch(() => {}); }
      setTimeout(() => {
        if (this.shuttingDown) return;
        if (this.lease.isServing()) void this.startCollabAfterLease().catch(() => {});   // 持锁重试 listen/init
        else void this.lease.acquireLoop().catch(() => {});                              // 已释放——重获取（经 onAcquired 回此）
      }, 5_000).unref?.();
    } finally {
      this.startInFlight = false;
    }
  }

  private listenRetries = 0;

  /** B13（listen 错误路径可观测）：hocuspocus listen() 的 Promise 只在 listening 回调内 resolve、
   *  httpServer 无 error 监听——EADDRINUSE 时 promise 悬挂+error 事件 unhandled（Sentry 吞=持锁僵尸）。
   *  自接线 once('error') 转 reject；成功后摘除（运行期 error 维持现状语义）。 */
  private listenServer(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const httpServer = this.server.httpServer;
      const onError = (e: Error) => {
        httpServer?.off('error', onError);
        reject(Object.assign(e instanceof Error ? e : new Error(String(e)), { code: (e as { code?: string })?.code }));
      };
      httpServer?.once('error', onError);
      this.server.listen().then(
        () => { httpServer?.off('error', onError); resolve(); },
        (e: unknown) => { httpServer?.off('error', onError); reject(e); },
      );
    });
  }

  private async listenCollab(): Promise<void> {
    if (this.listenerClosed) { await this.listenerClosed.catch(() => {}); this.listenerClosed = null; }   // M2①：等 isolate 的 close 落定再 re-listen（net close 异步）
    // M2③/P1-2 前置：隔离期内存 doc 必须已卸载——陈旧 doc 对外服务=同进程复现"两实例互不可见"
    const t0 = Date.now();
    while (this.server.hocuspocus.documents.size > 0 && Date.now() - t0 < 5_000)
      await new Promise((r) => setTimeout(r, 100));
    if (this.server.hocuspocus.documents.size > 0)
      throw Object.assign(new Error(`documents 未卸载（${this.server.hocuspocus.documents.size} 个——mutex 持有），拒绝 re-listen（留 isolated 等下轮退避）`), { code: 'DOCS_NOT_UNLOADED' });   // V10：归端口类=持锁重试
    await this.listenServer();   // Y0a-1 P1-1：await listen；E35 三入口之首=未持租约不 listen
    this.startSessionSweep();     // W8/M2②：先 clear 再 set（幂等——rejoin 不泄漏定时器）
    this.startSpoolReconciler();
    // Y10 seam（v3 重排漏接=v4 修复，I4）：spool IO 熔断恢复→唤醒退避梯——缺此行=熔断期梯死+恢复后零自愈
    this.spool.onRecovered = () => this.rearmQueues();
    this.transition('serving');   // 置位=最后一步（"已完成"非"已进入"）
    this.watchdogFired = false;
    this.rearmQueues();   // I4（P0-1 修）：serving ⟹ 非空队列∪spool.keys() 全部在梯上——rejoin 后 own 帧的运行期恢复路径（缺此=own 帧只待重启=部署门死锁）
  }

  private isPortError(e: unknown): boolean {
    const code = (e as { code?: string })?.code;
    return code === 'EADDRINUSE' || code === 'DOCS_NOT_UNLOADED' || /EADDRINUSE/i.test((e as Error)?.message ?? '');
  }
```

startSessionSweep 首行补（:848 区域）：`if (this.sessionSweepTimer) clearInterval(this.sessionSweepTimer);`

**4e. storeDocumentUnlocked 改造（:380-461）**——`let fenced = false;` 旁加 `let rowMissing = false;`；catch 块首插 leaseRowMissing 分支；fenced 分支接 selfIsolate；末尾两处梯守卫扩 rowMissing：

```typescript
      let appended = false; let fenced = false; let rowMissing = false; let notHeld = false;
      try {
        const r = await this.repo.append(projectId, payload);
        if (r.ok) appended = true;
        else {   // AppendResult fenced 单失败档（no-row 已删——0 行只可能是 fenced 或 throw）
          fenced = true;
          this.logger.error(`append fenced for ${projectId}（租约失守——批走 spool，不排退避梯）`);
          this.selfIsolate('fenced-by-write');   // 必办①：V22 落地——closeAll+listener 释放+lost{cause} 单点计数
        }
      } catch (err) {
        if ((err as { leaseRowMissing?: boolean })?.leaseRowMissing) {
          // SV13/W11/I5：配置错误重试无用——但**照常走下方 spool 兜底**（早退=批只留内存，重启即丢=BOI 实质失效）
          rowMissing = true;
          collabLeaseRowMissingTotal.inc();
          this.logger.error(JSON.stringify({ event: 'lease_row_missing', projectId, note: '批落 spool（BOI）；修复=补 CollabLease 行后重启回灌' }));
        } else if ((err as { leaseNotHeld?: boolean })?.leaseNotHeld) {
          // V13/I5：隔离/释放过渡窗在飞 store 撞 owner=null（P7 throw）——与 fenced 同处置（落 spool+不排梯），
          // 不进通用分支（否则误报 DB 故障+failure 计数污染——日志事件区分）
          notHeld = true;
          this.logger.error(JSON.stringify({ event: 'lease_owner_not_set', projectId, note: '隔离/释放过渡窗——批落 spool（BOI）不排梯' }));
        } else if (isFkGone(err)) {
          /* ……原 FK 分支不动…… */
        } else {
          /* ……原 ERROR+failure 计数不动…… */
        }
      }
```

（下方 spool 兜底 :433-457 不动——fenced/rowMissing/notHeld 都自然落入；:454 与 :460 两处 `if (!fenced && ...)` 改 `if (!fenced && !rowMissing && !notHeld && ...)`。`drainAllDocuments` 的 force-spool 腿不触 repo.append（spool.append 直写）——无 owner 面。）

**4f. schedulePersistRetry 首行门（:641 熔断自检之前——终态优先）+retryPersist FK 收割（:699-706）**：

```typescript
    if (this.collabState === 'isolated') return;   // 必办⑧/I-3：fenced/revoked=终态禁梯——重试无意义且掩盖失守
```

```typescript
          const frames = await this.peekSpoolFrames(projectId);
          if (frames.length === 0) { this.cancelPersistRetry(documentName); return; }
          for (const f of frames) {
            try {
              const r = await this.repo.append(projectId, f.payload);
              if (!r.ok) throw new Error(`append fenced (${r.reason})`);
              await this.spool.confirm(projectId, [f.frameId]);
            } catch (err) {
              if (isFkGone(err)) {   // M3/必办⑨：已删项目帧无终态出口——与 store 主路径 FK 分支同形
                await this.spool.confirm(projectId, [f.frameId]);
                yjsUpdatesDiscardedDeletedTotal.inc({ source: 'spool' });
                this.logger.warn(`persist retry frames for ${projectId} discarded (project deleted, FK)`);
                continue;
              }
              throw err;   // 重走 catch 退避（帧未 confirm——安全）
            }
          }
```

**4g. handleProjectsGone 保收割梯（Z11①——cancel 后）**：

```typescript
        if (this.spool.hasFrames(projectId)) this.schedulePersistRetry(projectId);   // Z11①：帧通道撞 FK→confirm+cancel（必办⑨ 同批先行）
```

**4h. reconciler（Z11/SV4+W）**：

```typescript
  private spoolReconcilerTimer: ReturnType<typeof setInterval> | null = null;
  private startSpoolReconciler(): void {
    if (this.spoolReconcilerTimer) clearInterval(this.spoolReconcilerTimer);   // M2②：clear-first
    this.spoolReconcilerTimer = setInterval(() => { void this.reconcileSpool().catch(() => {}); }, 30_000);
    this.spoolReconcilerTimer.unref?.();
  }
  /** SV4/Z11+I4：收养静默外来段（boot 后新出现的前任残余）→定向回灌（replayAll{projectIds} 单源）→段回收。
   *  守卫含 own（V10/I4：隔离期落 spool 的自有段无客户端重连时也要有恢复驱动——只看 foreign=own 帧永滞）。
   *  ENOENT 全程容错（P2-2：并发 confirm 先收走）。 */
  private async reconcileSpool(): Promise<void> {
    if (this.collabState !== 'serving') return;
    const d = this.spool.depth();   // 廉价守卫（零 IO——depth 走内存 index；无外来段且 own 无段即返）
    if (d.strandedFiles === 0 && d.ownFiles === 0) return;
    const adopted = d.strandedFiles > 0 ? await this.spool.adoptSilentForeignSegments(60_000) : [];
    const ownPending = d.ownFiles > 0;
    if (adopted.length === 0 && !ownPending) return;
    const byProject = [...new Set(adopted.map((s) => s.projectId))];
    await this.spool.replayAll(this.repo, byProject.length ? { projectIds: byProject } : undefined);
    if (ownPending) this.rearmQueues();   // own 段的驱动=退避梯（replayAll 不点名全量——幂等回灌无害）
    this.logger.warn(JSON.stringify({ event: 'spool_reconcile_adopted', projects: byProject, segments: adopted.length, ownPending }));
  }
```

**4i. beginDraining（Z9/W10——SV9）**（isShuttingDown 家族旁）：

```typescript
  private drainAutoReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  /** SV9：POST /api/drain 动作体——置 draining+冻结既有连接（readOnly+write-frozen 通告）+刷新 60s
   *  deadline（幂等=刷新非 no-op：慢排空部署链续 POST 续窗）。**不触发关停流程**——只停写、等去抖
   *  自然排空；进度=GET /api/ready 的 pending。60s 未收到 SIGTERM 自动解除=对冻结连接 close(1012)
   *  （B12：readOnly 直翻 false 会漏"冻结期客户端单侧编辑"的静默分叉——客户端重连经状态向量自愈；
   *  write-frozen/resumed 通告归 Y0b）。 */
  beginDraining(): { draining: boolean; phase: string; autoReleaseAt: number; pending: ReturnType<CollabGateway['computePending']> } {
    if (this.collabState === 'serving') this.transition('draining', 'api-drain');
    // V15：回真实态——非 serving 态（isolated/start-failed/acquiring）置位不生效，drilling:false 不对部署链说谎
    this.clearDrainTimer();
    const autoReleaseAt = Date.now() + 60_000;
    this.drainAutoReleaseTimer = setTimeout(() => {
      this.drainAutoReleaseTimer = null;
      const frozen = [...this.frozenConnections];
      this.frozenConnections.clear();
      if (this.collabState === 'draining') this.transition('serving', 'drain-auto-release');
      for (const c of frozen) { try { c.webSocket?.close(1012, 'drain released'); } catch { /* 已断 */ } }
      this.logger.warn('drain 60s 未续期——自动解除（冻结连接已 1012 复连；慢排空请部署链周期性续 POST）');
    }, 60_000);
    this.drainAutoReleaseTimer.unref?.();
    for (const doc of this.server.hocuspocus.documents.values())
      for (const c of doc.connections.keys()) {
        const conn = c as unknown as { readOnly?: boolean; sendStateless?: (p: string) => void };
        if (this.frozenConnections.has(c as never)) continue;
        this.frozenConnections.add(c as never);
        conn.readOnly = true;   // B12：库逐条 update 查它——冻结生效
        try { conn.sendStateless?.(JSON.stringify({ type: 'write-frozen', reason: 'draining' })); } catch { /* Y0b 消费 */ }
      }
    return { draining: this.collabState === 'draining', phase: this.collabState, autoReleaseAt, pending: this.computePending() };
  }
  private clearDrainTimer(): void {
    if (this.drainAutoReleaseTimer) { clearTimeout(this.drainAutoReleaseTimer); this.drainAutoReleaseTimer = null; }
  }
```

onApplicationShutdown 步骤 1（:933）改：

```typescript
    this.shuttingDown = true;   // V11：关停闸首置——isolated 态关停时 rejoin 的 CAS 成功也不得 re-listen（步骤 3/4 flush 期间接受新连接=半关停态对外服务）
    if (this.collabState === 'serving' || this.collabState === 'start-failed' || this.collabState === 'acquiring') this.transition('draining', 'shutdown');
    this.clearDrainTimer();   // SIGTERM 在途=自动解除取消
    this.frozenConnections.clear();   // 后续 closeAllConnections1012 兜底关连接——此行只清记账（依赖顺序注释）

**4j. computePending 扩展（:570-577——必办②+Z10+V2/I8：PendingSnapshot 新契约的注册源）**：

```typescript
  computePending(): { projects: number; batches: number; storeInFlight: number; spoolFiles: number; spoolBytes: number; strandedFiles: number; strandedBytes: number } {
    /* ……既有 projects/batches 计算不动…… */
    const d = this.spool.depth();
    return {
      /* projects, batches 既有值 */
      storeInFlight: this.inFlightProjects.size,   // Z10：部署门四零假绿消除（字段名按既有集合实名对齐——grep inFlight）
      spoolFiles: d.ownFiles,        // I8：own 口径（drainable——ready.pending/部署门）
      spoolBytes: d.ownBytes,
      strandedFiles: d.strandedFiles,
      strandedBytes: d.strandedBytes,
    };
  }
```

（`:186` 的 `registerPendingCollector(() => this.computePending())` 原样——签名兼容新快照类型；**两个 depth gauge 的 collect 体在 T4 组 7 已改为 own+stranded 之和**——本处返回 own 是部署门口径，两消费端各取所需，B15 结构闭合。）

**4k. 关停步骤 6（:952 占位落实——release+halt）**：

```typescript
    // 步骤 6（≤2s）：租约显式释放+关停闸——必须执行到（释放被 SIGKILL 截断则下实例等满 TTL，直接吃进 RTO；
    // halt 防 acquireLoop 关停期抢租约留死 owner）
    await this.raceDeadline(this.lease.release(), 2_000, null as never).catch(() => {});
    this.lease.halt();
```

（unregisterPendingCollector 之后、shutdown_complete 日志之前。）

**4l. module 注册（collab.module.ts）**：providers 增 `AuditService`（../../common/audit/audit.service）+`CollabLeaseService`（RedisSync/COLLAB_REDIS 本 Task 不动——T6 删）。

**4m. kit（dual-client-server.ts）**：`startDualClientServer(over, debounce, spool, lease = createLeaseStub({}, { repo, spool: spoolSvc }))` 第 4 参——**默认 stub 必须带 deps（V1：契约三件套②③——不带则 kit 的 spool 无 owner→scan() throw→全部用例 start-failed）**；构造行参数 4 换 `lease as any`；import createLeaseStub；`docService: new CollabDocumentService(gateway, repo)`（T8 构造扩参预接——repo 为 kit 的 mock repo）。

**4n. 四直构 spec 构造参数 4**（auth-reason/persist-status/sweep/env——grep `new CollabGateway(` 实证定位）：`{ syncFromPeers: vi.fn(async () => {}) } as any` → `createLeaseStub() as any`（各文件 import 补）。

- [ ] **Step 5: 跑全套确认绿（含 W33 清单逐个核）**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/collab`
Expected: PASS（新增 12+既有全绿——redis-sync.service.spec 仍绿：文件未删、其自身不构造 gateway；shutdown/auth-reason/persist-status/sweep/env 按 Step 0 清单逐个核绿）。

- [ ] **Step 6: verify+Commit**

Run: `pnpm verify`

```bash
git add apps/api/src/modules/collab apps/api/src/test-utils
git commit -m "feat(collab): Y0a-3 T5 gateway 拓扑切换——collabState 七态+启动链单点(initOnce/listenCollab 拆分)+selfIsolate 关 listener+看门狗自愈+leaseRowMissing 落 spool+drain 冻结/1012 解除+I-3/M3+reconciler"
```

---

### Task 6: 删除面收尾——redis-sync 文件对删+pin 两正则+multi-instance 改写+elapsed 断言重写

**Files:**
- Delete: `apps/api/src/modules/collab/collab-redis-sync.service.ts` + `.spec.ts`
- Modify: `collab.module.ts`（COLLAB_REDIS factory+CollabRedisSync provider+imports 删）
- Modify: `apps/api/package.json`（pnpm remove）
- Modify: `scripts/check-hocuspocus-pin.mjs`
- Rewrite: `collab.gateway.multi-instance.spec.ts`
- Modify: `collab.gateway.spec.ts:228-232`（必办⑦——v3 修正锚点）

- [ ] **Step 1: module 清理+依赖移除+文件删除**

`collab.module.ts`：删 `import Redis from 'ioredis'`/`import { CollabRedisSync, COLLAB_REDIS } ...`/COLLAB_REDIS provider 块/CollabRedisSync provider。

```bash
git rm apps/api/src/modules/collab/collab-redis-sync.service.ts apps/api/src/modules/collab/collab-redis-sync.service.spec.ts
pnpm --filter @flowweb/api remove @hocuspocus/extension-redis
```

（T5 后仓内零 redisSync 引用——`grep -rn "redisSync\|CollabRedisSync\|COLLAB_REDIS\|extension-redis" apps/api/src` 应仅剩本 Task 待改的 multi-instance spec/pin 脚本。）

- [ ] **Step 2: multi-instance spec 改写为租约 fail-fast（G-3 载体）**

`collab.gateway.multi-instance.spec.ts` 全文重写：

```typescript
// Y0a-3（spec §3.1/§6.1 G-3）：原"Redis extension 挂载"断言随 extension-redis 删除整删——
// 本 spec 改写为**租约 fail-fast**：第二实例（未持租约）结构性无法接流（不 listen/WS 拒/直连拒）。
// 单实例拓扑钉死后"多实例"的正名=第二实例的**拒绝面**验证（E23：冗余组件判据升无用途）。
// N15 真相：单主机双实例同端口本就 EADDRINUSE 先于租约——租约的真实价值=TTL 崩溃接管/跨主机/
// 误配快速失败；演练（随机端口）是这套机制唯一的验证场。
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { createLeaseStub } from './test-utils/lease-stub';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { CollabAuthReason } from '@flowweb/shared';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('CollabGateway 租约 fail-fast（第二实例结构性无法接流——G-3）', () => {
  let dir: { dir: string; cleanup: () => Promise<void> };
  let gateway: CollabGateway;
  beforeEach(async () => {
    dir = await makeSpoolDir('y0a3-mi-');
    gateway = new CollabGateway({} as any, new EventEmitter2() as any, createMockRepo() as any,
      createLeaseStub({ isServing: vi.fn(() => false), tryAcquireFast: vi.fn(async () => false) }) as any,   // 第二实例：租约被占
      { resolve: vi.fn() } as any, 48200, 300, undefined, undefined, new CollabSpoolService(dir.dir));
  });
  afterEach(async () => {
    await (gateway as any).server.destroy?.().catch?.(() => {});
    await dir.cleanup();
  });

  it('不 listen：onModuleInit 完成但 Server.listen 未调用（E35 三入口之首）', async () => {
    const listenSpy = vi.spyOn(gateway.server, 'listen').mockImplementation(async () => {});
    try {
      await gateway.onModuleInit();
      expect(listenSpy).not.toHaveBeenCalled();
    } finally { listenSpy.mockRestore(); }
  });

  it('WS 升级拒绝：authenticate 抛 lease-not-ready（瞬态档——客户端重连而非终态）', async () => {
    await expect(gateway.hooks.onAuthenticate({
      requestHeaders: new Map(), requestParameters: new URLSearchParams('?token=tok'),
      documentName: 'project:p1', connectionConfig: {},
    } as any)).rejects.toMatchObject({ reason: CollabAuthReason.LEASE_NOT_READY });
  });

  it('直连路径拒：loadDocument 权威点抛（DirectConnection 绕过 authenticate 的兜底）', async () => {
    await expect(gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p1' } as any))
      .rejects.toMatchObject({ reason: CollabAuthReason.LEASE_NOT_READY });
  });
});
```

- [ ] **Step 3: 必办⑦——elapsed 断言重写（collab.gateway.spec.ts :228-232；:275 注释同步清理）**

现文本（:230-232 的 RedisExtension disconnectDelay 注释+3000ms 阈）改：

```typescript
    // Y0a-3（必办⑦）：RedisExtension 已删——withDoc 直连断开不再有 disconnectDelay 固定延迟；
    // 等待成功路径 ≈ 20ms 等待+直连装载/断开（ms 级）。1000ms 稳定区分 SV 等待超时降级路径（3s）。
    expect(elapsed).toBeLessThan(1000);
```

（:275 附近第二处 disconnectDelay 注释一并清理——执行时以 grep 'disconnectDelay\|RedisExtension' 全文件清零为准。）

- [ ] **Step 4: pin 脚本三+common+yjs 两正则（P5）**

`check-hocuspocus-pin.mjs` :7-8 改：

```javascript
// Y0a-3：extension-redis 随单实例拓扑钉死删除——EXPECTED 收敛 @hocuspocus 三包（common=批0e
// 存在性断言保留）+yjs 独立正则（非同一 scope，单正则永不匹配=门禁静默绿——spec §1.3 v2.1 注）。
const EXPECTED = ['provider', 'server', 'common', 'yjs'];
const reHocuspocus = /'@hocuspocus\/(provider|server|common)@([\d.]+)'/g;
const reYjs = /'yjs@([\d.]+)'/g;
```

（found 集合合并两正则结果；yjs 版本断言 `!== '13.6.32'` 判红；hocuspocus 系 `!== '4.6.0'` 判红；`found.size === 0` 兜底保留。）

```bash
node scripts/check-hocuspocus-pin.mjs
```

Expected: `hocuspocus pinned @4.6.0 ✓ ... + yjs@13.6.32 ✓` 形态（版本号以 lockfile 为准）。

- [ ] **Step 5: census 清零验证+全套绿**

```bash
grep -rn "extension-redis\|CollabRedisSync\|COLLAB_REDIS\|redisSync\|RedisExtension\|disconnectDelay" apps/api/src apps/api/package.json scripts/check-hocuspocus-pin.mjs
```

Expected: **零命中**（pin 脚本注释里的历史词不算——grep 以代码行为准，注释行人工核）。

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/collab && pnpm verify`
Expected: 全绿（multi-instance 新 3 例+elapsed 重写后既有 describe 绿）。

- [ ] **Step 6: Commit**

```bash
git add -A apps/api scripts/check-hocuspocus-pin.mjs pnpm-lock.yaml
git commit -m "feat(collab): Y0a-3 T6 删除面收尾——extension-redis/CollabRedisSync 整删+pin 两正则(yjs 独立)+multi-instance 改写租约 fail-fast(G-3)+elapsed 断言重写(必办⑦)"
```

---

### Task 7: /api/ready+/api/drain（G-4 载体+必办②③④——collabState 主导派生+单飞缓存+独立 guard）

**Files:**
- Create: `apps/api/src/modules/collab/collab-ready.service.ts` + `.controller.ts` + `.service.spec.ts` + `collab-admin-auth.guard.ts`
- Modify: `collab.gateway.ts`（无——beginDraining 已在 T5 落）
- Modify: `apps/api/src/auth/auth.guard.ts`（PUBLIC_PREFIXES）
- Modify: `collab.module.ts`（+ReadyService/Controller/REDIS_CLIENT——controllers 数组注册）

- [ ] **Step 1: 写失败测试（G-4 八档+优先级 P6+drain 语义）**

`collab-ready.service.spec.ts`：

```typescript
// Y0a-3 T7：G-4 载体——ready 八档 collabState 主导派生（W12）+1s 单飞缓存+epoch string+pending
// 消费 computePending（必办②同一实现禁复制）+drain 幂等/60s 解除（gateway 侧归 T5/ shutdown spec）。
import { describe, it, expect, vi } from 'vitest';
import { CollabReadyService } from './collab-ready.service';

function build(over: {
  pgOk?: boolean; diag?: any; gateway?: any; redisOk?: boolean;
} = {}) {
  const prisma = { $queryRaw: vi.fn(async () => { if (over.pgOk === false) throw new Error('PG down'); return [{}]; }) };
  const lease = {
    isServing: () => over.diag?.state === 'held',
    diag: vi.fn(async () => over.diag ?? { state: 'held' as const, owner: 'me', holder: 'me', epoch: '3', renewedAt: new Date(), statementFailed: false }),
  };
  const gateway = over.gateway ?? {
    computePending: () => ({ projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 }),
    isShuttingDown: () => false,
    isWritableOrDegraded: () => 'ok' as const,
    getCollabState: () => 'serving',
  };
  const redis = { status: 'ready', connect: vi.fn(async () => {}), ping: vi.fn(async () => over.redisOk === false ? Promise.reject(new Error('x')) : 'PONG'), disconnect: vi.fn() };
  const svc = new CollabReadyService(prisma as any, lease as any, gateway as any, { quarantinedSegments: () => 0 } as any, redis as any);
  return { svc, gateway, redis };
}

describe('CollabReadyService（G-4 八档+P6 优先级+collabState 主导）', () => {
  it('全清：ready=true 200+pending 结构（Y5 键名+三扩字段）', async () => {
    const { svc } = build();
    const r = await svc.getReady();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ready: true, redis: 'up', pending: { projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 } });
  });
  it('pg-down：SELECT 1 抛错→503 reason=pg-down（最高优先）', async () => {
    const r = await build({ pgOk: false }).svc.getReady();
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('pg-down');
  });
  it('draining（P6：高于 lease/spool——G-2a ii 断言不分档）', async () => {
    const gw = { computePending: () => ({ projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 }), isShuttingDown: () => true, isWritableOrDegraded: () => 'spool-unwritable' as const, getCollabState: () => 'draining' };
    const r = await build({ gateway: gw }).svc.getReady();
    expect(r.body.reason).toBe('draining');
  });
  it('lease-error：PG 通+statementFailed→503（与 pg-down 两种运维动作分流）', async () => {
    const r = await build({ diag: { state: 'held', owner: 'me', holder: 'me', epoch: '1', renewedAt: new Date(), statementFailed: true } }).svc.getReady();
    expect(r.body.reason).toBe('lease-error');
  });
  it('lease-lost：collabState isolated（W12 主导——非 lease.diag 兜底）', async () => {
    const gw = { computePending: () => ({ projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 }), isShuttingDown: () => false, isWritableOrDegraded: () => 'ok' as const, getCollabState: () => 'isolated' };
    const r = await build({ diag: { state: 'held', owner: 'me', holder: 'me', epoch: '1', renewedAt: new Date(), statementFailed: false }, gateway: gw }).svc.getReady();
    expect(r.body.reason).toBe('lease-lost');
  });
  it('not-serving：lease held ∧ start-failed/starting（start-failed 不再伪装 lease-not-acquired——W12）', async () => {
    const gw = { computePending: () => ({ projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 }), isShuttingDown: () => false, isWritableOrDegraded: () => 'ok' as const, getCollabState: () => 'start-failed' };
    const r = await build({ diag: { state: 'held', owner: 'me', holder: 'me', epoch: '1', renewedAt: new Date(), statementFailed: false }, gateway: gw }).svc.getReady();
    expect(r.body.reason).toBe('not-serving');
  });
  it('八档矩阵（V16/A2——collabState×lease.diag×spool 三真源表驱动，"1:1 派生"从此不可回退）', async () => {
    const held = { state: 'held' as const, owner: 'me', holder: 'me', epoch: '1', renewedAt: new Date(), statementFailed: false };
    const gw = (over: Partial<{ shutting: boolean; writable: string; phase: string }>) => ({
      computePending: () => ({ projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 }),
      isShuttingDown: () => over.shutting ?? false,
      isWritableOrDegraded: () => (over.writable ?? 'ok') as 'ok',
      getCollabState: () => over.phase ?? 'serving',
    });
    const cases: Array<{ name: string; diag?: any; gw?: Parameters<typeof gw>[0]; expect: string | null }> = [
      // 全清：serving+held+ok → ready
      { name: 'serving', diag: held, gw: {}, expect: null },
      // draining（P6 高于 lease/spool——两故障叠加仍 draining）
      { name: 'draining', diag: held, gw: { shutting: true, writable: 'spool-unwritable', phase: 'draining' }, expect: 'draining' },
      // lease-error（statementFailed——与 pg-down 两种运维动作分流）
      { name: 'lease-error', diag: { ...held, statementFailed: true }, gw: {}, expect: 'lease-error' },
      // lease-lost（collabState 主导——lease.diag 仍 held 也判 lost，V12 窗口）
      { name: 'lease-lost', diag: held, gw: { phase: 'isolated' }, expect: 'lease-lost' },
      // not-serving（held ∧ 未服务——start-failed/starting；不再伪装 lease-not-acquired，W12）
      { name: 'not-serving(start-failed)', diag: held, gw: { phase: 'start-failed' }, expect: 'not-serving' },
      { name: 'not-serving(starting)', diag: held, gw: { phase: 'starting' }, expect: 'not-serving' },
      // lease-held（acquiring+他人持有——holder 取证独立）
      { name: 'lease-held', diag: { state: 'not-acquired', owner: null, holder: 'other-owner', epoch: '9', renewedAt: new Date(), statementFailed: false }, gw: { phase: 'acquiring' }, expect: 'lease-held' },
      // lease-not-acquired（acquiring+无持有者；holder='revoked' 同档——行即刻可取，R8）
      { name: 'lease-not-acquired', diag: { state: 'not-acquired', owner: null, holder: null, epoch: '0', renewedAt: null, statementFailed: false }, gw: { phase: 'acquiring' }, expect: 'lease-not-acquired' },
      // spool-unwritable（**serving+held+spool 熔断**——三真源全"正常"档才轮到它，P0-3 修复点）
      { name: 'spool-unwritable', diag: held, gw: { writable: 'spool-unwritable' }, expect: 'spool-unwritable' },
    ];
    for (const c of cases) {
      const r = await build({ diag: c.diag, gateway: gw(c.gw ?? {}) as any }).svc.getReady();
      if (c.expect === null) {
        expect([r.body.ready, r.status]).toEqual([true, 200]);
      } else {
        expect([r.body.ready, r.body.reason, r.status]).toEqual([false, c.expect, 503]);
      }
    }
  });
  it('holder 取证独立（禁入 reason）+revoked 行落 not-acquired 档（R8）', async () => {
    const held = await build({ diag: { state: 'not-acquired', owner: null, holder: 'other-owner', epoch: '9', renewedAt: new Date(), statementFailed: false }, gateway: { computePending: () => ({ projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 }), isShuttingDown: () => false, isWritableOrDegraded: () => 'ok' as const, getCollabState: () => 'acquiring' } as any }).svc.getReady();
    expect(held.body.reason).toBe('lease-held');
    expect(held.body.holder).toBe('other-owner');
  });
  it('epoch 恒 string+holderRenewedAgoMs 派生（BigInt 序列化坑）', async () => {
    const r = await build({ diag: { state: 'not-acquired', owner: null, holder: 'x', epoch: '9223372036854775807', renewedAt: new Date(), statementFailed: false }, gateway: { computePending: () => ({ projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 }), isShuttingDown: () => false, isWritableOrDegraded: () => 'ok' as const, getCollabState: () => 'acquiring' } as any }).svc.getReady();
    expect(() => JSON.stringify(r.body)).not.toThrow();
    expect(typeof r.body.epoch).toBe('string');
    expect(typeof r.body.holderRenewedAgoMs).toBe('number');
  });
  it('redis down 不 gating：ping reject → body.redis=down ∧ status 仍 200（BullMQ 无一票否决权）', async () => {
    const { svc } = build({ redisOk: false });
    const r = await svc.getReady();
    expect(r.status).toBe(200);
    expect(r.body.redis).toBe('down');
  });
  it('1s 单飞（Z10）：缓存+并发合流——两次串行 + 10 次并发共探 PG/redis 一次', async () => {
    const { svc, redis } = build();
    await svc.getReady();
    await svc.getReady();
    await Promise.all(Array.from({ length: 10 }, () => svc.getReady()));
    expect(redis.ping).toHaveBeenCalledTimes(1);   // 缓存期内零新探测+无并发击穿
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab-ready.service.spec.ts`
Expected: FAIL——文件不存在。

- [ ] **Step 3: 实现 CollabAdminAuthGuard+ReadyService+Controller**

`collab-admin-auth.guard.ts`：

```typescript
// Y0a-3（Z15/W23）：drain 凭据独立——监控只读令牌（PROMETHEUS_TOKEN）≠停机权。COLLAB_ADMIN_TOKEN
// 未设时回退 PROMETHEUS_TOKEN（启动 WARN 标注回退态——Y0a-4 换独立令牌）；均未设=生产 fail-closed
//（dev fail-open 与 /metrics 同源先例）。header 形态同 x-prometheus-token（deploy.sh 工具链统一）。
import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class CollabAdminAuthGuard implements CanActivate {
  private readonly logger = new Logger(CollabAdminAuthGuard.name);
  private readonly warned = false;
  canActivate(context: ExecutionContext): boolean {
    const admin = process.env.COLLAB_ADMIN_TOKEN;
    const token = admin ?? process.env.PROMETHEUS_TOKEN;
    if (!token) {
      if (process.env.NODE_ENV === 'development') return true;   // dev fail-open（/metrics 同源）
      throw new UnauthorizedException('COLLAB_ADMIN_TOKEN/PROMETHEUS_TOKEN 均未设置——fail-closed');
    }
    if (!admin && !this.warned) {   // V/P1-11：回退 WARN 每 episode 一次（原 readonly 永不置位=每请求刷屏）
      this.warned = true;
      this.logger.warn('COLLAB_ADMIN_TOKEN 未设——drain 回退 PROMETHEUS_TOKEN（监控令牌兼任停机权，Y0a-4 应换独立令牌）');
    }
    const req = context.switchToHttp().getRequest();
    return req.headers['x-prometheus-token'] === token;
  }
}
```

（guard 形态对照 prometheus-auth.guard.ts 实际实现微调——执行期以先例为准。）

`collab-ready.service.ts`：

```typescript
// Y0a-3（spec v2.5 §3.3）：/api/ready 组装——503 判据=PG+租约+collabState（Redis 仅报不 gating）；
// reason collabState 主导派生（W12/P6：isolated→lease-lost；held∧未服务→not-serving；acquiring 才看
// lease diag）；1s 单飞缓存（Z10：探针轮询不吃 PG/Redis）；pending 消费 gateway.computePending
//（必办②同一实现禁复制）；epoch=string；drain 生命周期在 gateway（T5）。
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import type { CollabReadyReason, CollabReadyResponse } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabLeaseService } from './collab-lease.service';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { REDIS_CLIENT } from '../../common/redis/managed-redis';

@Injectable()
export class CollabReadyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly lease: CollabLeaseService,
    private readonly gateway: CollabGateway,
    private readonly spool: CollabSpoolService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,   // B11：CollabModule 自带受管 provider（lazyConnect 探针参数）——不新建裸 ioredis、不手写 shutdown
  ) {}

  private inflight: Promise<{ status: number; body: CollabReadyResponse }> | null = null;
  private cached: { at: number; v: { status: number; body: CollabReadyResponse } } | null = null;

  async getReady(): Promise<{ status: number; body: CollabReadyResponse }> {
    if (this.cached && Date.now() - this.cached.at < 1_000) return this.cached.v;   // Z10：1s 缓存
    this.inflight ??= this.computeReady().then((v) => { this.cached = { at: Date.now(), v }; this.inflight = null; return v; });
    return this.inflight;
  }

  private async computeReady(): Promise<{ status: number; body: CollabReadyResponse }> {
    const pending = this.gateway.computePending();
    const base = { pending, spoolQuarantined: this.spool.quarantinedSegments() };
    let pgOk = true;
    try { await this.prisma.$queryRaw`SELECT 1`; } catch { pgOk = false; }
    if (!pgOk) return { status: 503, body: { ready: false, reason: 'pg-down', redis: await this.redisStatus(), ...base } };
    const diag = await this.lease.diag();
    const phase = this.gateway.getCollabState();
    const common = {
      redis: await this.redisStatus(),
      holder: diag.holder ?? undefined,
      epoch: diag.epoch ?? undefined,
      holderRenewedAgoMs: diag.renewedAt ? Date.now() - diag.renewedAt.getTime() : undefined,
    };
    // P6 优先级（W12 collabState 主导）：draining > lease-error > lease-lost > not-serving
    // > lease-held > lease-not-acquired > spool-unwritable；ready=true 当且仅当全空
    let reason: CollabReadyReason | undefined;
    if (this.gateway.isShuttingDown()) reason = 'draining';
    else if (diag.statementFailed) reason = 'lease-error';
    else if (phase === 'isolated' || diag.state === 'lost' || diag.state === 'revoked') reason = 'lease-lost';
    else if (diag.state === 'held' && phase !== 'serving') reason = 'not-serving';
    else if (diag.state !== 'held' && diag.holder != null && diag.holder !== 'revoked') reason = 'lease-held';
    else if (diag.state !== 'held') reason = 'lease-not-acquired';
    else if (this.gateway.isWritableOrDegraded() !== 'ok') reason = 'spool-unwritable';
    if (reason) return { status: 503, body: { ready: false, reason, ...common, ...base } };
    return { status: 200, body: { ready: true, ...common, ...base } };
  }

  private async redisStatus(): Promise<'up' | 'down'> {
    try {
      if (this.redis.status !== 'ready') await this.redis.connect().catch(() => {});
      const pong = await Promise.race([
        this.redis.ping(),
        new Promise<string>((r) => { setTimeout(() => r('timeout'), 500).unref?.(); }),
      ]);
      return pong === 'PONG' ? 'up' : 'down';
    } catch { return 'down'; }
  }
}
```

`collab-ready.controller.ts`：

```typescript
// Y0a-3（spec §3.3）：GET /api/ready（PUBLIC+@SkipThrottle——探针轮询不吃共享限流桶）+
// POST /api/drain（CollabAdminAuthGuard 把关+AuditLog 审计——Z15）。draining 档 503 属预期——
// **部署判据读响应体不读状态码**（reason=draining+pending 收敛）。
import { Controller, Get, HttpCode, Post, Req, Res, UseGuards, SkipThrottle } from '@nestjs/common';
import { Request, Response } from 'express';
import { CollabReadyService } from './collab-ready.service';
import { CollabGateway } from './collab.gateway';
import { CollabAdminAuthGuard } from './collab-admin-auth.guard';
import { AuditService } from '../../common/audit/audit.service';

@Controller('api')
@SkipThrottle()
export class CollabReadyController {
  constructor(
    private readonly ready: CollabReadyService,
    private readonly gateway: CollabGateway,
    private readonly audit: AuditService,
  ) {}

  @Get('ready')
  async getReady(@Req() req: Request, @Res() res: Response) {
    const r = await this.ready.getReady();
    // V17/P21 两档视图：无 token={ready,reason,redis,epoch}（探针/gate 所需）；有效
    // x-prometheus-token（COLLAB_ADMIN_TOKEN 或回退 PROMETHEUS_TOKEN）=全字段（holder/pending/
    // stranded/holderRenewedAgoMs——host+pid 属内部信息，/api 经 nginx 公网可达）。drill/gate 已持 token。
    const token = process.env.COLLAB_ADMIN_TOKEN ?? process.env.PROMETHEUS_TOKEN;
    const authorized = !!token && req.headers['x-prometheus-token'] === token;
    if (!authorized) {
      const { ready, reason, redis, epoch } = r.body;
      res.status(r.status).json({ ready, reason, redis, epoch });
      return;
    }
    res.status(r.status).json(r.body);
  }

  @Post('drain')
  @UseGuards(CollabAdminAuthGuard)
  @HttpCode(200)
  async drain() {
    const { autoReleaseAt, pending } = this.gateway.beginDraining();
    await this.audit.log({
      operatorId: 'system:drain', operatorName: 'system:drain',
      targetType: 'COLLAB_LEASE', targetId: 'primary', action: 'collab_drain',
      afterValue: { autoReleaseAt }, remark: `pending=${JSON.stringify(pending)}`,
    });
    return { draining: true, autoReleaseAt, pending };
  }
}
```

`auth.guard.ts` PUBLIC_PREFIXES（:17 '/metrics' 前后）追加：

```typescript
  '/api/ready',    // Y0a-3：就绪探针（PUBLIC+@SkipThrottle——503 判据=PG+租约+collabState，Redis 仅报）
  '/api/drain',    // Y0a-3：部署链停写入口（PUBLIC 放行 AuthGuard，CollabAdminAuthGuard 把关）
```

`collab.module.ts`（Z14——controller 必须 controllers 数组）：

```typescript
@Module({
  controllers: [CollabReadyController],   // Z14：providers 不注册路由
  providers: [
    /* 既有+CollabLeaseService+AuditService */
    CollabReadyService,
    { provide: REDIS_CLIENT, useFactory: () => createManagedRedis(process.env.REDIS_URL, {
      lazyConnect: true, connectTimeout: 500, maxRetriesPerRequest: 1,
      retryStrategy: () => null, enableOfflineQueue: false,   // B11/Z10③：探针参数收紧（受管工厂第二参）
    }) },
  ],
})
```

- [ ] **Step 4: 端点级用例（Z14——drill 或 supertest 断言 GET /api/ready 非 404）+全套绿**

`collab-ready.controller.spec.ts`（Nest TestingModule 轻量直控——controller+fake service）断言路由注册（GET /api/ready → 200/503 均非 404；POST /api/drain 无 token → 401/403；**V17 两档**：无 token 响应体仅 {ready,reason,redis,epoch} 四键、带 token 全字段）。

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/collab && pnpm verify`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/collab apps/api/src/auth/auth.guard.ts
git commit -m "feat(collab): Y0a-3 T7 /api/ready+/api/drain——G-4 八档 collabState 主导+1s 单飞+pending 三扩(必办②④)+drain 审计(Z15)+controllers 注册(Z14)+REDIS_CLIENT 受管探针(B11)"
```

---

### Task 8: readCanvas 按可变性三分法拆分（V18/P20）+写意图门+项目种子 PG 侧落库

> **三分法（P20/SV15，替代 v3 的计费二分）**：clone:33 是**语义写操作**（复制工作流）——改快照出口=用户编辑后立即克隆会**静默丢 ≤2s（去抖窗）编辑**；且问题只会在 clone 出现（几乎无人会把它和本次重构联系起来）。判据按**可变性**：只读展示（video-work.service:328 分享/渲染）→`readCanvasFromSnapshot`；语义读（clone:33/video-project:92 regenerate 校验）→`readCanvas` 活读+租约门 503；计费读（execution:74）→活读+fail-closed 503。**快照出口仅 1 处**——T8 改动面从 4 处降到 1 处。
>
> **J1 残余（runbook 事实）**：每次部署 drain 窗口（≤15s）+重启窗口内全部付费执行与克隆被 503——产品可见的资金路径不可用（非技术债）；T10 出口+Y0a-4 runbook 明写"部署窗口=执行/克隆入口不可用（预期）"，`COLLAB_NOT_SERVING`+`Retry-After: 2` 交 Y0b 首批。

**Files:**
- Modify: `apps/api/src/modules/collab/collab-document.service.ts`
- Modify: `execution.service.ts` / `video-project.service.ts` / `video-work.service.ts` / `video-work-clone.service.ts`
- Modify: `project.service.ts`（种子 PG 化）
- Modify: 对应 `*.spec.ts`（grep `readCanvas` 清单）

- [ ] **Step 1: collab-document.service 三处**

构造注入 repo（readCanvasFromSnapshot 消费——契约 1 两出口）：

```typescript
  constructor(
    @Inject(CollabGateway) private readonly gateway: CollabGateway,
    @Inject(CanvasDocUpdateRepository) private readonly repo: CanvasDocUpdateRepository,
  ) {}
```

withDoc 首行（P0-1 三入口③——早退语义：openDirectConnection 在 await 前有微窗口）：

```typescript
  async withDoc<T>(projectId: string, fn: (doc: Y.Doc) => T | Promise<T>): Promise<T> {
    if (!this.gateway.isLeaseServing()) throw new ServiceUnavailableException('collab not serving (lease not held)');   // P0-1 三入口③
    /* ……原体…… */
  }
```

readCanvasFromSnapshot+写意图门（:70/:89 现有 X9 判据前加租约档——draining 经 isLeaseServing 派生已覆盖，R4 裁定）：

```typescript
  /** Y0a-3（§3.2 投影类）：readSnapshotOnly 出口包装——不经 openDirectConnection/不装载/不触 store/compact；
   *  陈旧度=进行中编辑未含（去抖窗级，spec §9.9 登记）。 */
  async readCanvasFromSnapshot(projectId: string): Promise<{ nodes: any[]; edges: any[] }> {
    const { state, updates } = await this.repo.readSnapshotOnly(projectId);
    const doc = new Y.Doc();
    try {
      if (state) Y.applyUpdate(doc, new Uint8Array(state));
      for (const u of updates) Y.applyUpdate(doc, new Uint8Array(u));
      ensureSchemaVersion(toDocLike(doc));
      return readRecordsFromMaps(toDocLike(doc));
    } finally { doc.destroy(); }
  }

  isLeaseServing(): boolean { return this.gateway.isLeaseServing(); }
```

```typescript
    if (!this.gateway.isLeaseServing() || this.gateway.isWritableOrDegraded() !== 'ok')
      throw new ServiceUnavailableException('collab degraded: lease or spool');
```

- [ ] **Step 2: 计费/语义读 503（execution.service:74 执行前/video-project.service:92 regenerate 校验前——V21 对象响应体+filter 本批定死）**

两处 readCanvas 前插：

```typescript
    // Y0a-3（§3.2 计费读）：租约失守/drain→503 fail-closed（按陈旧快照烧钱比拒服务更糟——E49）。
    // V21：**对象响应体**（Object.assign 挂异常属性不会进 getResponse()——客户端拿不到 code）；
    // Retry-After 由 collab-not-serving.filter.ts 统一落（见 Step 2.5）。
    if (!this.collabDoc.isLeaseServing())
      throw new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'collab not serving' });
```

**Step 2.5: `collab-not-serving.filter.ts`（V21——跨端契约不留执行期）**：

```typescript
// Y0a-3（V21）：COLLAB_NOT_SERVING 503 统一附 Retry-After: 2（Y0b 前端分型消费的跨端契约——
// 本批定死）。filter 按 body.code 精确匹配（不误伤其他 ServiceUnavailableException）。
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class CollabNotServingFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const body = exception.getResponse();
    if (exception.getStatus() === HttpStatus.SERVICE_UNAVAILABLE && typeof body === 'object' && body !== null && (body as { code?: string }).code === 'COLLAB_NOT_SERVING') {
      res.setHeader('Retry-After', '2');
    }
    throw exception;   // 透传给默认异常处理（filter 只加头不改体——链式：注册于 APP_FILTER，rethrow 经框架默认链）
  }
}
```

（注册形态执行期对照既有 filter 惯例——若 rethrow 不可行则改为完整写响应：`res.status(503).setHeader('Retry-After','2').json(body)`。**意图锚：响应体含 `code:'COLLAB_NOT_SERVING'`+头含 `Retry-After: 2`**——T8 Step 5 用例直接断言二者。）

- [ ] **Step 3: 只读展示改快照出口（**仅 video-work.service:328**——clone:33 留活读，V18/P20）**

```typescript
    const raw = await this.withTimeout(this.collabDoc.readCanvasFromSnapshot(w.canvasProjectId), 5000) as RawCanvasData;
```

（`video-work-clone.service.ts:33` **不改**——clone 经 `readCanvas`（withDoc 活 doc）获最新含去抖窗编辑；其租约门=withDoc 首行 503。`CLONE_TIMEOUT_MS` 外层维持。）

- [ ] **Step 4: 项目种子 PG 侧同事务落库（报2 P1-3——创建原子化；V19 修正类型与内容契约）**

`project.service.ts:43-63` 事务内追加（withDoc 后置种子块 :63-73 整删；**孤儿清理**：`@Inject(CollabDocumentService)`（:31）+ import（:5）随之删除——CLAUDE.md 精准修改纪律）：

```typescript
      // Y0a-3（T8①/P1-3/V19）：种子 PG 侧同事务落库——创建原子化（不依赖领导权、不产"行已建无戳"
      //  半成品、clone 链同受益）；首装载 hydrate state 已含戳——O0b-0 语义不变。
      //  V19：fillDoc 契约=（DocLike, stripAuthorState 输出, edges）——直传原始记录=往快照写非作者态
      //  键（分镜子 position/组帧键按组类型键集表——clone 传入的正是作者态记录）。
      const seed = new Y.Doc();
      stampDocSchema(toDocLike(seed));
      if (nodes && nodes.length > 0) fillDoc(toDocLike(seed), stripAuthorState(nodes as any), edges ?? []);
      await tx.canvasDoc.upsert({
        where: { projectId: created.id },
        create: { projectId: created.id, state: Buffer.from(Y.encodeStateAsUpdate(seed)), stateSeq: 0n },
        update: {},
      });
      seed.destroy();
```

- [ ] **Step 5: 测试适配+新增断言**

- grep `readCanvas` 全部 spec：**仅 video-work.service.spec**（分享/渲染路径）mock 键改 `readCanvasFromSnapshot`（mockImplementation 体不变）；**clone spec 零改动**（活读保留——V18）；
- **CollabDocumentService 构造 3 点**（exec-map.spec:9 `({ isWritableOrDegraded: () => 'ok' } as any)`/service.spec:52 `({} as any)`/kit:57）：签名加第二参 repo——两 spec gateway stub 补 `isLeaseServing: () => true`+repo mock（`{ readSnapshotOnly: vi.fn(...) }`）；kit 传真 mock repo（T5 4m 预接）；
- 新增三断言（collab-document.service.spec）：lease 未持→withDoc 503；readCanvasFromSnapshot 不走 withDoc（直查 repo mock——窥探 gateway 不被触）；writeNodeData lease 档 503（**R4 记录纠正的活文档：该前插是必需项**——既有门 isWritableOrDegraded 只含 spool 态，不含 draining）；
- 新增（execution.service.spec）：collabDoc.isLeaseServing false→ServiceUnavailableException 且 **getResponse().code==='COLLAB_NOT_SERVING'**（V21 对象体）；
- 新增（V20/intent-reconcile.service.spec）：withDoc 抛 503 → reconcile 捕获后**延后重试**（intent 状态非终态失败）——防租约失守期把未完成 exec 投影写判死；
- project.service 种子用例：建项目后 `prisma.canvasDoc.findUnique` state 非空且**含 schema 戳+节点内容**（fillDoc 经 toDocLike+stripAuthorState——V19 形态）+project.service 无 CollabDocumentService 残留注入（孤儿清理断言）。

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/collab src/modules/execution src/modules/video-project src/modules/video-work src/modules/project`
Expected: PASS。

- [ ] **Step 6: verify+Commit**

Run: `pnpm verify`

```bash
git add apps/api/src/modules
git commit -m "feat(collab): Y0a-3 T8 readCanvas 可变性三分法——计费/语义读 503(对象体+Retry-After filter)+只读展示 readCanvasFromSnapshot(仅 video-work)+withDoc 三入口③+intent-reconcile 重试语义+项目种子 PG 侧同事务落库"
```

---

### Task 9: 演练与 CI——handover 三变体+closing 闸 POSIX+G-2a drain 序+CI 集合断言+kill_timeout 45000

**Files:**
- Modify: `apps/api/scripts/collab-kill9-drill.ts` / `collab-drill-server.ts`
- Modify: `.github/workflows/ci.yml` / `deploy.sh` / `.claude/launch.json`

- [ ] **Step 1: drill-server closing 闸 POSIX 支路（必办⑩——弃 enableShutdownHooks 改手动 handler，B5）**

`collab-drill-server.ts`（:20-27 区域重写）：

```typescript
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  // Y0a-3（必办⑩）：closing 闸原只护 IPC 支路——enableShutdownHooks 的 POSIX SIGTERM 路径无闸
  // （双通道并发=app.close 二跑）。改手动 handler 弃 enableShutdownHooks（app.close 本身恒调
  // onApplicationShutdown——信号接线才是它的职责，B4）；两支路同闸。
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void app.close().then(() => process.exit(0));   // 显式 exit——IPC/信号句柄不吊 event loop
  };
  process.on('message', (m: unknown) => { if ((m as { type?: string } | null)?.type === 'shutdown') shutdown(); });
  process.on('SIGTERM', shutdown);   // POSIX 真信号（CI Linux=生产同构通道）；win32=TerminateProcess 硬杀不走此
```

- [ ] **Step 2: drill 改造——清租约行 helper（W19）+handover 模式（W16/P17）**

`collab-kill9-drill.ts`：

```typescript
// W19/Z16：不再注入 FORCE（env 已删）——startServer 前清租约行（break-glass 等价自动化：
// owner=NULL 使 CAS 立即命中；本地 dev 实例若持锁被让位，runbook 注明）。默认 TTL 接管路径
// （expiresAt<now() 支路）由 handover 默认变体覆盖。
async function clearLeaseRow(): Promise<void> {
  await prisma!.$executeRawUnsafe(`UPDATE "CollabLease" SET owner = NULL, "expiresAt" = NULL, "renewedAt" = NULL WHERE scope = 'primary'`);
}
```

（kill9Mode/sigtermMode/handoverMode 的每次 startServer 前调用；startServer env 块**不注入** COLLAB_FORCE_TAKEOVER。）

startServer 扩可选固定 wsPort（P17）：

```typescript
async function startServer(env: Record<string, string>, fixedWsPort?: number): Promise<DrillHandle> {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const wsPort = fixedWsPort ?? port + 1;   // handover：A/B 共享 wsPort——否则 B listen 永远成功，listener 让位断言落空
  /* ……其余不动…… */
}
```

handover 模式（Z25/W16——新增）：

```typescript
// Z25：handover 双进程演练——A 小 TTL（2000/500）普通 CAS 起→写 N 键→B 起（同库同 spool 根目录、
// 同 wsPort）→断言 B not-listening+ready 503 lease-held+holder===A→kill -9 A→B 于 TTL+ε（预算 ≤8s）
// 接管+listen+回灌 A 的 spool 帧（跨 owner 子目录——R3 正名）+ready 200→键集⊇停写前。
// 变体 --graceful：A SIGTERM（步骤 6 显式释放）→B ≤2s 接管（不吃 TTL）。
// 变体 --usurp：break-glass 脚本清行为 'revoked'→B CAS 夺取→断言 A 日志 collab_lease_revoked
//  +A wsPort TCP refused（listener 让位——B7/G-3c）+B listen 成功+A 不抢回（B ready holder 稳定 3s）。
async function handoverMode(env: Record<string, string>): Promise<void> {
  const graceful = process.argv.includes('--graceful');
  const usurp = process.argv.includes('--usurp');
  const WS_PORT = 31001;   // P17：A/B 共享
  await clearLeaseRow();
  const envA = { ...env, COLLAB_LEASE_TTL_MS: '2000', COLLAB_LEASE_HEARTBEAT_MS: '500' };
  const A = await startServer(envA, WS_PORT); await A.ready;
  const { provider, keys } = await connectWrite(A, PID, NODES);
  // V17 配套：handover 读 holder/epoch 取证字段——带 x-prometheus-token（全字段授权视图）
  const readyOf = async (h: DrillHandle) => (await (await fetch(`http://127.0.0.1:${h.port}/api/ready`, { headers: { 'x-prometheus-token': h.token } })).json());
  const aReady = await readyOf(A);
  const aOwner = aReady.holder as string;
  const epochA = Number(aReady.epoch);
  const B = await startServer(envA, WS_PORT); await B.ready;   // B HTTP 起、collab 不 listen（lease-held）
  // 断言 B 未 listen+lease-held+holder===A
  const bReady1 = await readyOf(B);
  if (bReady1.ready !== false || bReady1.reason !== 'lease-held' || bReady1.holder !== aOwner)
    fail(`handover：B 未报 lease-held/holder 不符：${JSON.stringify(bReady1)}`);
  if (graceful) {
    if (TERM_VIA_SIGNAL) A.child.kill('SIGTERM'); else A.child.send?.({ type: 'shutdown' });
  } else if (usurp) {
    await execScript('collab-lease-breakglass.ts');   // tsx 子进程跑仓内脚本
  } else {
    A.child.kill('SIGKILL');
  }
  await provider.destroy().catch(() => {});
  // V28：两段断言——①**获租约 ≤2s**（reason 翻离 lease-held 即得手：graceful=显式释放实证 SV12/步骤 6；
  // kill9/usurp=CAS 接管）②**ready 200 ≤8s**（listen+回灌完成；V10 端口重试等兜底预算——2s 预算会与
  // 自身"持锁重试 5s"机制互斥=假红难归因）
  const t0 = Date.now();
  let acquiredAt = 0; let readyAt = 0; let bEpoch = 0;
  while (Date.now() - t0 < 8_000) {
    const body = await readyOf(B).catch(() => null);
    if (body && acquiredAt === 0 && body.reason !== 'lease-held' && body.holder) { acquiredAt = Date.now() - t0; bEpoch = Number(body.epoch); }
    if (body?.ready === true) { readyAt = Date.now() - t0; break; }
    await sleep(200);
  }
  if (readyAt === 0) fail(`handover(${graceful ? 'graceful' : usurp ? 'usurp' : 'kill9'}）：B 未在 8s 内 ready`);
  const acquireBudget = graceful ? 2_000 : 2_500;   // graceful=显式释放 ≤2s；TTL 2s 接管 +ε
  if (acquiredAt === 0 || acquiredAt > acquireBudget)
    fail(`handover：B 获租约 ${acquiredAt}ms > ${acquireBudget}ms（${graceful ? '显式释放不达 SV12' : 'TTL 接管超预算'}）`);
  if (bEpoch !== epochA + 1) fail(`handover：epoch 非单调 +1（A=${epochA} B=${bEpoch}）——接管顺序契约破`);   // V28/A4
  if (usurp) {   // A 让位断言：revoked 日志+A 不抢回（I6）
    if (!A.drillStdout().includes('collab_lease_revoked')) fail('usurp：A 未落 collab_lease_revoked 日志');
    await sleep(3_000);   // A rejoin 窗口（若有 bug 会抢回——everHeld 门应挡）
    const bStable = await readyOf(B);
    if (!bStable.ready || bStable.holder === aOwner) fail(`usurp：B 持有不稳定/A 抢回：${JSON.stringify(bStable)}`);
  }
  // 键集断言（跨 owner 回灌）
  const replayed = new Set(await replayKeys());
  const missing = keys.filter((k) => !replayed.has(k));
  if (missing.length > 0) fail(`handover：已接受集丢失 ${missing.length}/${keys.length}`);
  await stopServer(B); await stopServer(A);
  console.log(`DRILL PASS: handover${graceful ? ' --graceful' : ''}${usurp ? ' --usurp' : ''}（Z25 三变体）`);
}
```

（execScript=spawn tsx 跑脚本先例；TCP 探针 net.connect 判 wsPort 占用随断言细化——执行期以红绿调。usage 行与 main 分发扩 handover。）

- [ ] **Step 3: G-2a ii 档 ready 断言（必办⑤——Z8 修正序：drain 前置）**

`sigtermMode` 发送关停信号**之前**：

```typescript
  // Y0a-3（必办⑤/Z8）：G-2a ii"draining 可见"——B4 修正后唯一可达序=SIGTERM 前 POST /api/drain
  //（Nest dispose 先于模块 shutdown——SIGTERM 后 ready 不可达）。drain 进演练面（Y0a-4 部署链预演）。
  const drainRes = await fetch(`http://127.0.0.1:${h.port}/api/drain`, { method: 'POST', headers: { 'x-prometheus-token': h.token } });
  if (drainRes.status !== 200) fail(`POST /api/drain 非 200：${drainRes.status}`);
  const drained = await (await fetch(`http://127.0.0.1:${h.port}/api/ready`)).json();
  if (!(drained.ready === false && drained.reason === 'draining'))
    fail(`G-2a ii：ready 未转 draining（P6 优先级——两档统一值）：${JSON.stringify(drained)}`);
```

（原"SIGTERM 后轮询 ready"代码删——结构性不可达。）

- [ ] **Step 4: deploy.sh kill_timeout（W18/SV6）+launch.json（W24）**

deploy.sh 两处（:59/:95）`--kill-timeout 10000` → `--kill-timeout 45000`（B9：HTTP dispose 等在飞请求+22s 关停链+余量）。

`.claude/launch.json:32` api-b：名改 `api-b (handover only)`+注释"同机第二实例只能错端口跑，且只有先起的那个能持有 collab（N15：3000/3001 端口冲突先于租约——租约价值=TTL 崩溃接管/跨主机/误配快速失败）"。

- [ ] **Step 5: ci.yml——int 专用配置+覆盖断言脚本化（V27）+handover（X16）**

`test:int` 脚本改（**CI-only JSON 输出**——本地保留 default 人读输出；`apps/api/int.json` 入 `.gitignore`）：

```json
"test:int": "vitest run -c vitest.int.config.ts",
"test:int:ci": "vitest run -c vitest.int.config.ts --reporter=default --reporter=json --outputFile=int.json"
```

新增 `scripts/check-int-coverage.mjs`（V27——单源四判据：集合+零失败+**零跳过**+条数下限；`describe.skip` 文件仍在 testResults 里、vitest 纯 skip 退出码 0——只查漏跑=CI 静默绿回归 X16）：

```javascript
#!/usr/bin/env node
// Y0a-3（V27/X16）：int 完整性单源。四判据：①git ls-files 文件集 ≡ int.json 执行集（basename
// 归一——vitest name 是绝对路径）；②numFailedTests===0；③numPendingTests===0（DATABASE_URL 缺失
// 时 hasDb describe.skip 全跳=覆盖为零仍绿——必须挡）；④numTotalTests ≥ MIN（现 16+本批新增，随
// 清单上调——魔法数在此单点维护，非 CI YAML 内联）。退出码=判据结果（失败即红）。
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const MIN_TOTAL = Number(process.env.INT_MIN_TOTAL ?? 21);   // 16 既有+lease-fence 5（执行期按实际条数校正一次）
const report = JSON.parse(readFileSync('apps/api/int.json', 'utf8'));
const ran = new Set(report.testResults.map((t) => t.name.replace(/\\/g, '/').split('/').pop()));
const files = new Set(execSync('git ls-files "apps/api/src/**/*.int.spec.ts"').toString().trim().split('\n').filter(Boolean).map((s) => s.split('/').pop()));
const missing = [...files].filter((f) => !ran.has(f));
const problems = [];
if (missing.length) problems.push(`int 静默漏跑：${missing.join(',')}`);
if ((report.numFailedTests ?? 0) > 0) problems.push(`numFailedTests=${report.numFailedTests}`);
if ((report.numPendingTests ?? 0) > 0) problems.push(`numPendingTests=${report.numPendingTests}（describe.skip?=DATABASE_URL 缺失）`);
if ((report.numTotalTests ?? 0) < MIN_TOTAL) problems.push(`numTotalTests=${report.numTotalTests} < ${MIN_TOTAL}`);
if (problems.length) { console.error('int 覆盖异常：\n' + problems.join('\n')); process.exit(1); }
console.log(`int 覆盖 ✓ ${files.size} 文件 ${report.numTotalTests} 例（含 execution/generation-intent——v4 补数的第 5 文件）`);
```

collab-core 的 int 步骤改：

```yaml
      - name: collab int（专用配置串行——CollabLease 单行全局资源；5 文件含 execution/generation-intent——v3 漏数）
        run: DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int:ci
      - name: int 完整性断言（V27——集合+零失败+零跳过+下限）
        run: node scripts/check-int-coverage.mjs
```

（**首跑核验 generation-intent.int.spec.ts 在 collab-core env（MINIO_INIT=skip）下绿**——它原在 test job 跑，本批迁池后环境变了；若红则该文件保留在默认池排除但 CI 单列一步跑，勿静默放宽。test job 的 verify 不再触 int〔T3 Step 1 已排除〕——YAML 死 job 修复后**首跑核验**此点。）

collab-core 演练步骤追加 handover 三变体（串行——租约行全局共享）：

```yaml
      - run: DATABASE_URL=... pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=handover
      - run: DATABASE_URL=... pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=handover --graceful
      - run: DATABASE_URL=... pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=handover --usurp
```

- [ ] **Step 6: 本地七跑演练全绿（PG+Redis 前置）**

```bash
export DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb
pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=kill9-normal
pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=kill9-fault
pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=sigterm
pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=sigterm --spool-fail
pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=handover
pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=handover --graceful
pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=handover --usurp
```

Expected: 七跑 PASS（kill9 两档含 boot 收养外来段——30s 预算内 depth_files→0；sigterm 含 drain 前置断言；handover 三变体含 listener 让位+A 不抢回）。

- [ ] **Step 7: CI 首跑核验（YAML 死 job 修复后首个 run）**

```bash
node -e "const yaml=require('js-yaml');const fs=require('fs');yaml.load(fs.readFileSync('.github/workflows/ci.yml','utf8'));console.log('ci.yml YAML OK')"
git push   # 用户确认后（本 Task 出口=远端 collab-core 真跑绿——Actions 核验 passed 行+七跑演练+test job 无 int）
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/scripts .github/workflows/ci.yml deploy.sh .claude/launch.json
git commit -m "feat(ci): Y0a-3 T9 演练与 CI——handover 三变体(固定 wsPort)+drill 清租约行(必办⑥改判)+closing 闸 POSIX(必办⑩)+drain 前置断言(必办⑤)+int 专用池集合断言+kill_timeout 45000"
```

---

### Task 10: gate-collab 切 ready+子批出口核对+跨批登记收口

**Files:**
- Modify: `scripts/gate-collab.mjs`
- Modify: `docs/superpowers/specs/2026-10-06-y0a-data-integrity-design.md`（§1.4 执行状态+§5.2 指标表+P95 落档）
- Modify: `docs/superpowers/specs/2026-10-06-canvas-yjs-arch-upgrade-review.md`（§0.2 Y0a 行）

- [ ] **Step 1: gate-collab 切 ready 双验（W17——无 FORCE）**

`gate-collab.mjs`：API_ENV 追加 `COLLAB_LEASE_TTL_MS: '2000', COLLAB_LEASE_HEARTBEAT_MS: '500'`（kill/start 循环确定性——taskkill=SIGKILL 不释放租约，TTL 2s 使重启接管 ≤2s；**不注入 FORCE**〔env 已删〕）；**每次 /start 前清租约行**（V23/P1-2：与 drill 同款 `UPDATE ... SET owner=NULL,"expiresAt"=NULL,"renewedAt"=NULL`——TTL env 对**未过期**的残留行（上轮死 owner/本地 test:int fixture）无效；gate 侧经 `node -e`+pg 或 spawn psql 实现，执行期按 gate 现有 DB 通道形态落地）；waitForApiHealth 改：

```javascript
async function waitForApiHealth(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;   // 预算 ≥TTL+5s：租约行残留死 owner 的接管窗覆盖（TTL 2s 下实际 ≤2.5s）
  while (Date.now() < deadline) {
    if (!apiChild) throw new Error('API 子进程在启动等待期退出');
    try {
      const res = await fetch('http://localhost:3000/api/ready');
      if (res.ok) {
        const body = await res.json();
        if (body.ready === true) {
          await waitForPort(3001, 10_000, 'collab WS(3001)');   // 双验：就绪≠监听窗口
          return;
        }
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('API ready timeout on :3000（/api/ready 未达 ready=true）');
}
```

- [ ] **Step 2: 子批出口清单核对（spec §4.1 Y0a-3 行——逐项+载体）**

```
□ 删除面 census 清零（grep extension-redis/CollabRedisSync/COLLAB_REDIS/redisSync/RedisExtension/disconnectDelay 零命中）——T6 Step 5
□ pin 两正则绿+锚重跑绿——T6 Step 4+verify
□ **§0.7 全局不变量 I1-I8 逐条有可红断言且全绿**（V29——本批验收面；I4 含 handover own 帧收敛）
□ G-3 三入口拒+不 listen 绿+**V12 判据唯一化用例**（isolated ∧ lease held ⇒ 三入口全拒 ∧ ready=lease-lost）——T5/T6
□ G-3b fenced-owner 真库绿+SV3 倒挂用例绿（带超时）+fenced-append 三断言+**INSERT ratchet 绿**——T3/T5
□ G-4 八档矩阵绿+epoch string+redis 不 gating+单飞并发合流+**两档视图**（无 token 四键/带 token 全字段）——T7
□ gate-collab 切 ready（双验+TTL 预算+**start 前清租约行**）后全绿——T10 Step 1+本地跑 gate（PG/Redis/占位 MINIO 前置）
□ 三分法用例绿（计费/语义读 503 对象体+Retry-After 头；video-work 快照；**clone 活读零改动**）+种子 PG 化+intent-reconcile 延后重试——T8
□ 心跳三态+revoked 终态+**everHeld 门**+rejoin+**onHeld 原子**+halt+单飞 用例绿——T2
□ **容量熔断含外来段用例绿**（I8——depthTotalBytes 回填三处后越限必抛）+gauges=total/门=own 断言——T4
□ 必办①-⑩全勾（§0.4 消费表逐项——⑥=清租约行改判）+R3 双 owner 用例绿——T2-T9
□ handover 三变体演练绿+**获租约 ≤2s/epoch 单调 +1 两条独立断言**——B7 探针转正的演练级证明
□ revoked 档可注入且被断言（lease spec+handover --usurp）+隔离态 httpServer 释放断言
□ pending 含 storeInFlight/stranded 分区+own/stranded/total 三口径可区分（I8/P16）
□ verify-indexes 新块绿（不变量+枚举存在）——T1/T2
□ int 覆盖断言脚本绿（**集合+零失败+零跳过+条数下限**四判据；5 文件含 generation-intent）+串行+test job 无 int——T9
□ CI collab-core 真跑绿（首跑核验）——T9 Step 7
□ pnpm verify 全绿+doc-gate canonical 无漂移+plan 一致性 grep（W1 门禁：扫 `COLLAB_FORCE_TAKEOVER|skipLeaseAssert|expiresAt" >= now\(\)|owner=null 根目录`——命中仅允许出现在 §0.4/§0.6/Task 0 SV 表的决策记录行与否定式断言〔.not.toContain/不注入/已删〕，**Task 正文代码块内零命中**）
□ **§9.7"Y0a 与 Y0b 同批部署上线"发布顺序约束已写入出口汇报**（硬门——drain 冻结/新 reason/503 对用户是纯噪声直到 Y0b）
□ 产品面事实入 runbook：drain/isolated 冻结**所有用户**画布写（单人团队同栈代价）+部署窗口=付费执行/克隆入口 503（J1 残余）+P6"draining 掩 spool-unwritable"消费 pending 兜底+**部署门语义=服务端已受理工作落定**（R6 裁定判据说明——冻结拒收的客户端编辑经重连补回、不在服务端账上）+drain→SIGTERM ≤2s 窗
□ /api/drain 与 /api/ready 的生产消费方归 Y0a-4（deploy 三步=drain→SIGTERM→ready 轮询——SV12 唯一停写入口）+break-glass runbook 三步+**用户可见窗口登记**（TTL+rejoin 退避+客户端 banner 时序≈11s 上界——Y0b UX 阈值输入）
□ COLLAB_LEASE_SCOPE 常量导出+Y7 接口三件套登记+**PromQL 5 条落 spec §5.2**（lease_lost>0〔5m〕/row_missing>0〔立即〕/start_failure 持续增长/epoch 变化率=接管 flapping/ready not-serving 持续 >1m）
□ 容量三数（并发 WS 上限/常驻 doc 字节上限/事件循环 lag 阈值）落 Y0a-4 **发布前置**登记（单实例钉死后容量是唯一过载闸——非"下一批再说"）
```

- [ ] **Step 3: spec 执行状态回填+跨批登记落盘**

`2026-10-06-y0a-data-integrity-design.md`：①§1.4 E23/E35/E44 行〔执行状态〕改"**Y0a-3 执行（2026-10-XX）**"+实际形态偏差注记（P6 优先级/P10 passive 行到期/P11 段键形态/P15 int 池/W5 单点负责制/W7 revoked+everHeld 门/V18 三分法/V17 两档视图）；②§5.2 指标表补 lease 族（lost{cause}/start_failure/epoch gauge/denied{reason}/row_missing/compact_not_owner/snapshot_read）+**PromQL 5 条告警线**（V30）+装载 P95 落档行（":296 少 1s 阻塞+disconnectDelay 消失两处行为变化——e2e/gate 观察，非新测试"）+用户可见窗口登记（§9.x——Y0b UX 阈值输入）。

`2026-10-06-canvas-yjs-arch-upgrade-review.md` §0.2 Y0a 行：plan 列补 Y0a-3 链接+状态"Y0a-1~3 完成；待 Y0a-4"。

本 plan 尾追加"跨批登记"段：**Y0a-4 必办**（deploy 三步接 drain/ready=唯一停写链〔SV12〕+kill_timeout 45000 生效核验+COLLAB_SPOOL_DIR 绝对路径必需化〔Z13 后 owner 目录只能从解析根发现〕+nginx /collab 段+COLLAB_ADMIN_TOKEN 独立令牌换装〔W23〕+env zod 收口〔LEASE_TTL/HEARTBEAT/SPOOL_DIR/MAX_LOADED_DOCS〕+容量三数〔N16〕+M-2/M-3 destroy 链复审〔spec §4.7〕+deploy 真流量下步骤 6 释放到达性观测〔R1〕）；**Y0b 登记**（LEASE_NOT_READY/DRAINING 终端 UX 分型+write-frozen/resumed 消费+首屏蒙层分流〔J2 范围〕+COLLAB_NOT_SERVING/Retry-After 消费〔J3 半边〕+worker 写者 503 分型〔T8——R2 裁定并入 AI 执行链重构线〕）；**Y7 登记**（advisory lock 作租约评估〔J4 四条反对仍立〕/DocOwnership 接口收窄/所有权注册表与 HTTP 写转发/容量触发线）。**观察项**：spool import/compact 脚本 10min 租约接管与生产实例并发窗（服务停态 runbook 前提，TOCTOU 无观测面——W20 守卫已挡健康持有者）。

- [ ] **Step 4: verify+doc-gate+Commit**

```bash
pnpm verify
node scripts/doc-gate.mjs   # 仅 [canonical-drift] 时 --write-canonical 并 review diff
git add docs/superpowers scripts/gate-collab.mjs
git commit -m "feat(gate): Y0a-3 T10 gate-collab 切 /api/ready 双验+出口核对+spec 回填+跨批登记——子批收口"
```

- [ ] **Step 5: 向用户汇报出口清单，请求确认进 Y0a-4 plan（执行门）**

---

## Self-Review 记录（v3）

- **单层权威（W1）**：v1/v2 代码块与被推翻断言全部物理删除；三轮裁定就地内联 Task 正文；§0.6 仅存决策日志（无代码）。一致性 grep 已实跑核验：全部命中为决策记录行/否定式断言，Task 正文代码块零残留（T10 Step 2 门禁固化该判据）。
- **运行时阻断四项全修**：①指标 labelNames 声明先行+collabStartFailureTotal/epoch gauge/rowMissing/compactNotOwner 定义面与 .inc 调用点一一对应（B8）；②启动链=语句层 $transaction 2s 有界+dispatchAcquired 单点+lease-stub 契约同构（W5——kit :52 不变量保持，Z6 2s race 与其自矛盾删除）；③int 默认池排除+专用配置串行（B10/P15——test job 双跑互踩根修）；④owner 文件系统安全形态+setOwner 断言（W4——Windows EINVAL）。
- **机制闭合**：外来段 boot 收养+截尾分档（P18——G-1 演练 30s 预算与 Z12 假告警面两全）；break-glass 'revoked' 哨兵+终态不 rejoin+listen 失败持锁重试（W7）；rejoin 卫生（initCollabOnce/listenCollab 拆分+定时器 clear-first+await listenerClosed+documents 清空前置，W8/M2）；sleep unref+halt（W9）；drain 冻结/1012 解除（W10/B12）；leaseRowMissing 落 spool（W11/N4——store :433 兜底位实证）；ready collabState 主导（W12/M6）；cursor 0n 保谓词（W15/N12——死循环形态由倒挂用例 10s 超时兜）；handover 固定 wsPort（W16/M7）；append 同 key advisory lock（W14——stateSeq 重新可信，Z21 读侧双保险并存）。
- **类型一致性**：CollabLeaseService（tryAcquireFast/acquireLoop/release/halt/isServing/getState/diag/onAcquired/onLost/owner）T2 定义↔T5 消费一致；LeaseLostCause 四值（+revoked）T2↔T5 selfIsolate 一致；`setLeaseOwner(string|null)` T2 onHeld/isolate/release↔T3 唯一写者；`spool.setOwner(string)`（必填+fs-safe 断言）T2 onHeld↔T4；`depth()` 分区 T4↔computePending（T5）↔ready pending（T7）字段一致；computePending 七字段=T1 CollabReadyPending 一致；CollabReadyReason 八值 T1=T7 派生链一致；frameId `segKey:idx` T4 appendRaw↔confirm lastIndexOf 解析一致；计数百用例核对：lost{cause} 单点=gateway.selfIsolate、startFailure=startCollabAfterLease catch+看门狗每 episode ≤1、denied{reason} 两分支。
- **拒绝项防翻案（R1-R5 附据）**：--slow-request（无自然慢端点=造测试端点属范围漂移；handover graceful 已证步骤 6；Y0a-4 真流量观测）；worker 计数化（AI 执行链 demo 重构线项目裁定）；readOnly 直翻（选 1012——B12 单侧编辑静默分叉）；M4 后半（isLeaseServing 派生 collabState——draining 已 503，事实误读）；容量三数（Y0a-4——报告2 自认前置）。
- **探针结论落档**：B7 re-listen 结构可行（hocuspocus dist 一手核验：构造建 server/listen 仅 httpServer.listen/stopOnSignals:false 不重复注册）——Z4 探针转正，handover 变体 2 为演练级证明；Z10③ REDIS_CLIENT 注入已定（B11：CollabModule 自带受管 provider——探针分叉关闭）。
- **占位扫描**：无 TBD/TODO；执行期输入显式声明（fillDoc 已 V19 定死/Retry-After 已 V21 定死/auditLog 字段经编译期校验〔V31〕/int.json 产物路径已 V27 脚本化/check-int-coverage 的 MIN_TOTAL 按实际条数校正一次〔T9〕/filter rethrow 形态对照既有惯例〔T8 Step 2.5 意图锚已定〕）——均为诚实的执行期对齐，非语义占位。

## Self-Review 记录（v4）

- **第五轮核验面**：depth() 现形+熔断三消费点+gauges collect 形态（B15/V2）、httpServer 无 error 监听+listen promise 悬挂（B13）、v3 listenCollab 漏 onRecovered（现仓 :829）、int 5 文件、clone 经 readCanvas 活 doc、种子链 toDocLike+stripAuthorState、cursor 绑定参数（B14）——全部一手坐实后才采纳；报告误报一处（"drillStdout handle 未存"——DrillHandle 现有该字段，无需动作）。
- **三轮病根的结构解**：§0.7 全局不变量八条（V29——每条=唯一执行点+可红断言）+transition() 迁移单点（V33）+lease-stub 契约三件套（V1——测试地基与真实现共享同序副作用）。
- **测试地基修复**：V1（stub deps——否则 kit 全链 scan() 处结构性红）；V22（mock 值断言——文本断言永不红且诱导 SQL 内插）；V24（事件定序+小 env——<1s 余量根除）；V16（八档矩阵——P6"1:1 派生"不可回退）；P0-3（T7 #7 serving 档/#9 重写/#10 合流）。
- **v4 类型一致性**：LeaseLostCause 四值/LeaseStub 契约三件套（T2 onHeld↔T5 stub 同序）/depth() 五元组（T4）↔depthTotalBytes（熔断）↔computePending（T5）↔PendingSnapshot（T4 组 7）↔ready.pending（T7）↔CollabReadyPending（T1）六面同源；lockProject 单源（append/compact↔ratchet spec）；beginDraining 返回 {draining,phase,autoReleaseAt,pending}（T5）↔drain controller 响应体（T7）一致；transition 合法迁移表覆盖全部写点（onModuleInit/startCollabAfterLease/listenCollab/selfIsolate/beginDraining/自动解除/shutdown）。
- **拒绝项（R6-R9 附据）**：rejectedWrites 计数器（部署门语义=服务端已受理工作落定——冻结拒收的编辑本就不在服务端账上，判据正确；runbook 注明）；drain 双 phase 字段（可推导不加字段）；revoked holder 归 lease-held（not-acquired 语义准确——行即刻可取）；fixture 偷租约 throw（5min+清理+gate/drill 清行已把干扰窗压到分钟级且 rejoinLoop 自愈；throw 误伤 CI 残留态）。R4 记录纠正（v3 裁定理由错误、动作保留——T8 Step 1 前插为必需项）。

---

## 跨批登记（T10 落盘 2026-10-08）

**Y0a-4 必办**：
- deploy 三步接 drain/ready=唯一停写链（SV12：drain→SIGTERM→ready 轮询——禁旁路 kill）+kill_timeout 45000 生效核验（deploy.sh 内联已改，pm2 实际行为未验证）。
- COLLAB_SPOOL_DIR 绝对路径必需化（Z13 后 owner 目录只能从解析根发现——相对路径 cwd 漂移=段蒸发）。
- nginx /collab 段（WS 3001 反代）+COLLAB_ADMIN_TOKEN 独立令牌换装（W23——当前回退 PROMETHEUS_TOKEN+启动 WARN）。
- env zod 收口：LEASE_TTL/HEARTBEAT/SPOOL_DIR/MAX_LOADED_DOCS 四值显式声明（现 process.env 直读面收编）。
- 容量三数（N16：并发 WS 上限/常驻 doc 字节上限/事件循环 lag 阈值——**发布前置**，单实例钉死后容量是唯一过载闸，非"下一批再说"）。
- M-2/M-3 destroy 链复审（spec §4.7）+deploy 真流量下步骤 6 释放到达性观测（R1——--slow-request 拒绝项的观测替代）。
- CI collab-core 首跑核验（**push 用户门控后**——YAML 死 job 已修，真跑绿未验证）。

**Y0b 登记**：LEASE_NOT_READY/DRAINING 终端 UX 分型+write-frozen/resumed 消费+首屏蒙层分流（J2 范围）+COLLAB_NOT_SERVING/Retry-After 消费（J3 半边——filter 已落 503 对象体+头）+worker 写者 503 分型（T8——R2 裁定并入 AI 执行链重构线）+**§9.7 同批部署约束**（Y0a 与 Y0b 同批上线——两条例外路径预期超出客户端 synced 死线）+PromQL 5 条告警线路由落地（spec §5.2 V30）+§9.14 用户可见窗口（≈11s 上界）作 UX 阈值输入。

**Y7 登记**：advisory lock 作租约评估（J4 四条反对仍立）/DocOwnership 接口收窄/所有权注册表与 HTTP 写转发/容量触发线（COLLAB_LEASE_SCOPE 常量已导出——加行非改架构）。

**产品面 runbook 事实**：drain/isolated 冻结**所有用户**画布写（单人团队同栈代价）；部署窗口=付费执行/克隆入口 503（J1 残余——预期非故障，runbook 明写）；P6"draining 掩 spool-unwritable"由部署门读 pending 兜底；部署门语义=**服务端已受理工作落定**（R6——冻结拒收的客户端编辑经重连补回、不在服务端账上）；drain→SIGTERM ≤2s 窗（R7——drained ≡ reason=draining ∧ pending 四零）。

**观察项**：spool import/compact 脚本 60s 接管窗与生产实例并发（服务停态 runbook 前提；W20 守卫已挡健康持有者——需 --force）。



