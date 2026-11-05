# 生产就绪收尾批 Implementation Plan（charter 本地四项闭环：C1 retention / C2 replay-canary / C3 doc-append-gap-alert / C4 project-erasure）——v3.1

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

<!-- plan v3（2026-11-05）：依据三份外审报告（2026-11-05）实证裁定吸收对 v2 全量修订。**v3 要点（对 v2）**：①Redis 映射勘正=`VideoWork.canvasProjectId=pid→workIds`（VideoProject 无此列，=workflowId FK Cascade :477/:486）；②stuck 口径按状态分（ExecutionRequest 无 deadlineAt :1033——ADMITTED→expiresAt/EXECUTING→GenerationIntent.deadlineAt）；③红③锚 :328-332；④manifest Json? 删（R16 外部文件主载体）；⑤verify:full→pnpm verify。C3 判据重构（行内密度+行间衔接+边界）；canary 坐标+语义兜底+shadow 档；OpsGate 预建行+FOR SHARE；pin 谓词进 SQL；fence=CanvasProject.lifecycleState 聚合行+advisory 锁+tombstone 事务首句取同键锁；C4 tombstone-only 四入口+资金门扩查+cleanDrafts origin+鉴权 OWNER+Media detach+引用图+IDB 协议+DRY_RUN；census=schema 闭包生成；卡序 C1→C3→C2→C4。**（v3 头注全文见 git 历史本行前版；下列 v3.1 差异为准）** -->

<!-- plan v3.1（2026-11-05）：依据**三份 v3 复审报告（同日）实证裁定**修订（指认经 HEAD 2881a0e8 逐条核对；v3 三处自身错误承认并修正）。
**A·硬伤修正六项（按字面写必失败）**：
①**C3 alias 行废止→`CanvasDocCoalesced` 侧表**——alias 撞三重约束（@@unique([projectId,generation,updateHash]) :1285 同 hash 再被 ON CONFLICT 吞；CHECK(frameCount>0)+CHECK(seq>=firstWalSeq) 迁移 20261024130000:25-26 拒插；密度 0≠1 自洽矛盾；多帧批区间补不全）。侧表：appendBatch 吞行点（res.length==0 已知 r.updateHash/r.lastWalSeq）同事务 INSERT `(projectId,generation,seq=lastWalSeq,updateHash,sourceSeq,reason)`；audit 行间衔接断点 LEFT JOIN 侧表判「被同内容吞行覆盖」。maintenance/dedup 形态经代码核实**不产生洞**（maintenance 帧 mkAppliedEntry :1245-1251 落 PG 批；dedup 不烧 seq）——C3-0 诊断夹具钉死该结论（非实测再定）。
②**TeamStatus 是 enum（:675-678）非 String——「无迁移」勘正**：笔一 `ALTER TYPE "TeamStatus" ADD VALUE 'DISBANDING'`（additive；PG enum 加值不与使用同事务——语句单独置迁移末）；TeamGuard（:43 只拦 DISBANDED）/assertTeamMember/team.service :161/:439 全路径统一「非 ACTIVE 拒」。
③**CanvasService.create 是第二创建路径（canvas.service.ts:33-54 直建 project+Template+genesis，不经 ProjectService；且两路径行为分叉——Canvas 建 Template/ProjectService 不建 :38-79）**：抽 `ensureProjectGovernance(tx,{projectId,origin})`（OpsGate 项目行+origin）两路径共用；笔二回填存量（`INSERT INTO "CollabOpsGate" SELECT 'compact',id,'OPEN' FROM "CanvasProject" ON CONFLICT DO NOTHING`+行数校验）；CI 调用点 census（schema 闭包扫不到调用路径）——漏接=该路径项目 compact 永久 fail-closed。
④**fence 读升级 `FOR SHARE`**（v3 plain SELECT 两窗实证：team 解散 lockScope('team') 与项目写 lockProject(pid) 键空间不相交→team 批 UPDATE 不等项目写→行复活；RR 写事务 advisory 锁后 plain SELECT 看旧快照）：写事务 fence 读=`SELECT "lifecycleState" FROM "CanvasProject" WHERE id=${pid} FOR SHARE`（行锁读——与 tombstone UPDATE 互斥/RR 下 locking read 看最新提交/team 批量 UPDATE 自然排干全部 FOR SHARE 持有者）；**advisory 锁保留给 doc 序**（lifecycleSeq 分配/vacuumReplace 同键 T12 锚不动）；锁序=advisory→Team 行→CanvasProject 行→业务行（单源钉死）。team 解散采纳 **O(N) 批置版**（单语句 UPDATE WHERE teamId 分批游标+FOR SHARE 自然互斥；O(1) 版项目写二跳查 Team.status 不采纳）。
⑤**fence 自锁根修=ErasureContextService**（应用层 AsyncLocalStorage——与写锁门禁同机制）：app 写=必须 ACTIVE；**erasure worker 写=允许 DELETING（唯一合法 DELETING 写者）**；DELETE 恒放行。fence 规则三句明写（v3 未定义豁免——worker 的 scrub/detach UPDATE 会被自己的 fence 拒）。
⑥**manifest-before-detach**：DRAINING 首步写 manifest（**唯一采集面**：media 行/work 行（VideoWork.canvasProjectId=pid→workIds+videoKey/coverKey）/spool 段/派生 Redis 键；NDJSON+每片 SHA-256+temp→fsync→rename→fsync dir）；**worker 后续 detach/删除只从 manifest 读**（v3 顺序未定——先 detach 再查 WHERE canvasProjectId=pid 查零行、清理全空转）。
**B·协议/迁移修正九项**：⑦run 表 unique 矛盾组——`@@unique([scopeType,scopeId])` 全局唯一改 **partial unique（active states，raw SQL）**：DONE/FAILED 后允许新 run（restore 再擦/DRY_RUN 后真实擦）；**+parentRunId/teamId**（team run `WAITING_CHILDREN` 会合——子 run 全 DONE 才 PURGING_TEAM/删 Team 行）；**DRY_RUN=dryRun 标志列**（不占真实唯一+跳过 lifecycle 置位——否则项目被隐藏）。⑧**PROJECT_ERASED 进 shared 契约**（CollabCloseCode+TERMINAL_REASON+resolveCloseAction 落 terminal——循 TEAM_DISBANDED_TERMINAL_REASON 先例；未命中落 backoff=客户端重连循环永不清 IDB）。⑨**pin 竞态三修**：**CAPTURING pin-first**（fn 内短事务=CanvasDoc 行 FOR SHARE+INSERT CAPTURING pin 带 lease→算 hash→更新 READY；失败删 pin）+快照选择=**stateSeq≤pgSeqAt 的最新快照行**（currentSnapshotRev 可能指向 stateSeq>pgSeqAt 的新快照——比对坐错标）+**vacuumReplace 加 pin 谓词**（defer 或标 STALE+告警）+pin **compare-and-delete**（WHERE pgSeqAt/snapshotRev 匹配——防 TTL 过期后误删新 pin）。⑩**OpsGate 发布事务校验两行都在**（IN ('',pid) 返回行数==2 且全 OPEN；<2=fail-closed）+存量回填（③）。⑪**shadow 默认翻转**：CANARY_FREEZE_ENABLED **生产默认 true**（charter :46「不一致告警并冻结」——shadow 只 dev 显式 flag；evidence 含 freeze 实弹演练）。⑫hash canonicalization=复用 compact stateHash 口径（pendingStructs===null+固定 gc/guid）+「同逻辑状态不同 integration order」单测。⑬**CollabJobCursor 进笔一**（v3 正文用而迁移无表）。⑭**C1 组**：voidForExecutionRequest 自开事务（team-credit.service.ts:233-234 无 tx 参）→**voidForExecutionRequestInTx**（循 :212 `tx?run(tx):$transaction` 先例）；retention 两扫面 join `lifecycleState='ACTIVE'`/`Team.status='ACTIVE'`；**ExecutionInput 终态迁移时重写 expiresAt=now+30d**（:449 受理写语义修正——长任务终态即删缺口）；`ExecutionRequest(teamId,state)` 索引；runtime_feed_bytes 改**计数器维护**（SUM(octet_length) 每轮全表扫废止）；投影 unknown 语义+8 天项目读面测试；**admit 进 fence census**（:434-463 现只查 maintenance 门）。⑮**C3 组**：purgeBelowSeq 非空**不 skip**（聚合过滤 seq>stateSeq 已消除断言违例+**purge 义务年龄告警**——skip 会永久隐藏卡死的 purge 义务）；counter 只对**新 gap** inc（gapActive false→true；CollabJobCursor.lastGap 存状态）；CTE 按预算项目批（=ANY($ids)——全项目单聚合=全表扫）。
**C·C4 语义修正八项**：⑯**Media 三档 registry**（库资产=folderId 非空∨isFavorite∨type='uploaded'（schema:340-344 素材库语义实证）→**detach 保留**；他项目/作品引用→detach；独占 generated/temp→删行+对象全版本）+引用图补全（VideoProject.data 深扫/LightingTask.resultMediaId/VideoTrimTask.sourceFileId·outputFileId/VideoWork.coverKey/ObjectManifest）+**resultRef 从引用图移除**（生成产物不跨 scope，仅 scrub——v3 同列进 guard 与 scrub 自相矛盾）+detach 时清 nodeId/taskId；两阶段复核窗**残余披露**（「扫描后新引用」窗缩小非根除——MediaRef refcount 表=登记项）。⑰**Redis purgeWorkCaches(workId)**：targeted SCAN `videoWork:process:{workId}:*` 全前缀（键首段=workId 合法非被禁 {pid}:*）+url 键族（Media.key/thumbnailKey/VideoWork.coverKey）——旧代体键 TTL 残留废止；like/view 随作品 detach 保留。⑱**Template 不改 FK**（SetNull→Cascade 撞 check-migration-additive 破坏性门禁）——worker 显式 `DELETE Template WHERE projectId`（等效+零门禁风险；产品裁定 2026-11-05：模板无独立内容列随项目擦除）。⑲**VideoWork detach 后 /process、clone=404**（:370 `!canvasProjectId→NotFound` 实证；产品裁定 2026-11-05：接受 404+runbook 写明，不做发布快照）。⑳资金门补 **RefundObligation PENDING+StorageReservation ACTIVE**（ExecutionRequest 之外未结面）。㉑DELETE 鉴权=**ProjectPermissionService PROJECT_OWNER**（ProjectRole :894-898 实证——非仅 teamRole OWNER/创建者）。㉒AuditLog beforeValue/afterValue 脱敏断言+TEAM 谓词（targetType='TEAM' AND targetId）。㉓**scope-alias-registry**（VideoProject.workflowId/VideoWork.canvasProjectId/ExecutionNodePlan.requestId/AuditLog.targetId/VideoTrimTask.workflowId 别名列——列名扫描找不到；registry 与 information_schema diff CI 红）。㉔**读路径 Prisma client extension 单点过滤**（lifecycleState='ACTIVE' 注入+includeDeleted 显式开关=admin/worker；canvasProject.find* 全仓 100+ 处逐点接线废止；admin 面保留全量看 DELETING/FAILED）+read census。㉕**append p95 基准**（T33 harness——每写事务锁+fence 读的 p95/p99/锁等待/最大 ops/s，C4 前跑基线）。
**D·开放项三项裁定落定（2026-11-05 用户确认）**：charter replay-canary requirement 文本修订=「每小时轮转 replay canary（全局每小时+每活跃项目 ≤24h）」（C2-4 同步）；VideoWork detach 404（⑲）；Template 随删（⑱）。
**E·维持登记不采纳**（理由更新）：crypto-shredding/DEK；DB 触发器（**FOR SHARE 行锁采纳后 fence 正确性已有 DB 层保证（行锁互斥），触发器从正确性兜底降为覆盖兜底**）；chainDigest Tier0；MediaRef refcount；ErasureJob/Audit 分表（partial unique+AuditLog 已够）；clean baseline reset（Template 不改 FK 后全部 DDL additive，两笔成立）；O(1) team 解散。行号=2881a0e8 快照。 -->

**Goal:** charter（`scripts/production-charter.json`）四个本地 pending 四项闭环翻 passed——C1 `retention-worker` / C2 `replay-canary` / C3 `doc-append-gap-alert` / C4 `project-erasure`→ 批末出口门呈报「四项 charter 证据闭环+改档前置就绪」（容量/HA/密钥化/告警值班归服务器窗——登记项节列明）。

**Architecture:** 核心不变量：①canary 捕获=withFrozenPrefix 临界区+**CAPTURING pin-first**（fn 内 CanvasDoc 行 FOR SHARE+pin 先落库→hash→READY）；hash 不等语义兜底；②pin（CAPTURING/READY）存活期 purgeBelow/pruneSnapshots/**vacuumReplace** 删除语句内部谓词推迟；③**fence=CanvasProject.lifecycleState/Team.status 聚合行 FOR SHARE 行锁读**（advisory 锁=doc 序专用；tombstone=同键 advisory+聚合行 UPDATE；erasure ctx=唯一合法 DELETING 写者；DELETE 恒放行）；④擦除=请求 tombstone-only（O(1)；team=O(N) 批置分批）+worker saga（DRAINING=**manifest 唯一采集面先行**→WAITING_CHILDREN(team)→PURGING→VERIFYING→DONE；kill -9 续跑/lease 回收）；⑤retention=终态过滤（终态重写 expiresAt）+时间衰减+scope ACTIVE 过滤；⑥C3 审计=行内密度+行间衔接（**CanvasDocCoalesced 覆盖豁免**）+边界（聚合过滤 seq>stateSeq；purge 义务年龄告警）；⑦指标全低基数；⑧读路径=extension 单点 ACTIVE 过滤。

**Tech Stack:** TypeScript strict / NestJS（api+worker 双进程）/ Prisma（client extension）/ prom-client / @aws-sdk/client-s3（capability detect）/ vitest+node:test / 本地 MinIO gate（版本化 e2e）/ CI RustFS（非版本化+分支单测）。

**执行纪律：** 每卡先红→绿→commit（禁 amend）；写码前 grep 实证；行号=2881a0e8 快照；三面 tsc；迁移**两笔** additive 串行（immutability baseline `--write` 同 commit；enum 加值语句单独置迁移末）；涉指标 commit 必跑 `pnpm verify`；每卡双评审+Controller 亲验；批内不触服务器；写锁门禁与 census 同跑。

## 文件结构（触碰面全景）

| 文件 | 动作 | 责任 | 卡 |
|---|---|---|---|
| apps/api/prisma/schema.prisma+迁移两笔 | 改 | 笔一：`ExecutionInput(expiresAt)` 索引+`RuntimeEvent(projectId,createdAt)` 索引+`ExecutionRequest(teamId,state)` 索引+`CanvasProject.lifecycleState/origin`+**TeamStatus+DISBANDING**+`CanvasDocCoalesced` 表+`CollabJobCursor` 表+`ProjectErasureRun` 全字段；笔二：`CollabOpsGate`+**存量回填**+`CanaryPin`（status/stateSeq/hashSkipped/leaseUntil）+`CollabCanaryCursor(nextDueAt)` | C1/C2 |
| packages/shared/src/collab/retention.ts | **建** | RETENTION 常量单源+tick 词表 | C1 |
| packages/shared/src/constants/collab-close-code.ts | 改 | **PROJECT_ERASED 码+TERMINAL_REASON+resolveCloseAction 落 terminal**（循 TEAM_DISBANDED 先例）+契约测试 | C4 |
| apps/api/src/modules/collab/project-lock.ts | **建** | lockProject（advisory=doc 序 T12 锚）+**fenceProject/fenceTeam（FOR SHARE 行锁读单源）**+lockScope+**ErasureContextService（ALS）**+写锁门禁测试态断言 | C1 前置 |
| apps/api/src/modules/collab/project-governance.service.ts | **建** | **ensureProjectGovernance(tx,{projectId,origin})**——OpsGate 项目行+origin 单源（ProjectService.create 与 **CanvasService.create** 两路径共用） | C2 前置 |
| apps/api/prisma/read-path.filter.ts（client extension） | **建** | canvasProject 读操作单点注入 `lifecycleState='ACTIVE'`+`includeDeleted` 显式开关（admin/worker/erasure）；read census 兜底 | C4 |
| apps/api/src/modules/collab/retention.sweeper.poller.ts | **建** | worker 三扫面+xact 单飞+循环清空+stuck/backlog+**scope ACTIVE 过滤**+指标 | C1 |
| apps/api/src/modules/collab/runtime-feed.retention.service.ts | **建** | sweepRetention 迁 worker（100k=lastSeq 边界+**bytes 计数器维护**+**投影 unknown 语义**） | C1 |
| apps/api/src/modules/execution/execution-request.retention.service.ts | **建** | sweepExpired 抽共享（claim+**voidForExecutionRequestInTx** 同事务小批） | C1 |
| apps/api/src/modules/team/team-credit.service.ts | 改 | **voidForExecutionRequestInTx(tx,...)**（循 :212 模式） | C1 |
| apps/api/src/modules/team/team-funds-gate.service.ts | 改 | 扩查 ExecutionRequest（ADMITTED/EXECUTING∧reservedCredit>0）+**RefundObligation PENDING+StorageReservation ACTIVE** | C4 |
| apps/api/src/modules/collab/collab-append-audit.worker.ts | **建** | SQL 聚合审计（单条 CTE 批内/三断言+**Coalesced 覆盖豁免**/seq>stateSeq 过滤+purge 义务年龄/轮转游标/新 gap 边沿 inc） | C3 |
| apps/api/src/modules/collab/collab-ops-gate.service.ts | **建** | 预建行+回填校验+发布事务 FOR SHARE **两行校验**+freeze UPDATE version+1+三档+解冻 ack | C2 |
| apps/api/src/modules/collab/collab-replay-canary.poller.ts | **建** | api tick：isLeaseServing 首步→skip 判定→**CAPTURING pin-first 捕获**（fn 内 FOR SHARE+INSERT pin→hash→READY） | C2 |
| apps/api/src/modules/collab/collab-canary-verify.worker.ts | **建** | readAt 重放→hash→语义兜底→**compare-and-delete pin** | C2 |
| apps/api/src/modules/collab/canvas-doc-update.repository.ts | 改 | readAt pin 读+发布事务 gate FOR SHARE 两行读+purgeBelow/pruneSnapshots/**vacuumReplace** 内部 pin 谓词+**appendBatch 吞行写 CanvasDocCoalesced** | C2/C3 |
| apps/api/src/modules/project/project-erasure.service.ts+erasure.worker.ts | **建** | scope saga（**manifest 唯一采集面先行**/WAITING_CHILDREN 会合/SKIP LOCKED claim+lease/**ErasureContext 包裹**）+介质 registry+引用图两阶段 | C4 |
| apps/api/src/modules/project/project.service.ts+template.service.ts+team.service.ts+**canvas.service.ts** | 改 | 四入口 tombstone-only（物理删除移 worker；disbandTeam 废止请求内级联）；**CanvasService.create 接 ensureProjectGovernance**；**TeamGuard/assertTeamMember/team.service 非 ACTIVE 全拒** | C4 |
| apps/api/src/modules/team/team.guard.ts+team.util.ts | 改 | DISBANDING 拦截（`status!=='ACTIVE'`） | C4 |
| apps/api/src/modules/project/project.controller.ts | 改 | DELETE 鉴权=**ProjectPermissionService PROJECT_OWNER**（ProjectRole :894） | C4 |
| apps/api/src/modules/video-work/video-work-clone.service.ts+project.service.ts create | 改 | origin 列根修（clone 传 'clone'；cleanDrafts 谓词过滤） | C4 |
| apps/api/src/modules/video-work/video-work.service.ts | 改 | **purgeWorkCaches(workId)** 公开（targeted SCAN 全前缀+url 键族）+like/view 保留 | C4 |
| apps/api/src/modules/collab/collab-spool.service.ts | 改 | purgeScope+collectMediaRefs 内部端点（**限批+isLeaseServing**——容量事故防护） | C4 |
| apps/api/src/modules/minio/minio.service.ts | 改 | capability detect+ListObjectVersions/DeleteObjects 1000/批+DeleteMarkers+ListMultipartUploads/Abort+**GetBucketReplication/GetObjectLockConfiguration/lifecycle** | C4 |
| apps/web/src/collab/*（local-collab-cache 消费面+recovery） | 改 | **PROJECT_ERASED terminal 处理**：清 IDB/runtimeStore 投影+不自动重连（resolveRecoveryAction 同步） | C4 |
| apps/api/scripts/collab-smoke.mjs | 改 | --canary 档 | C2 |
| scripts/collab-health-thresholds.mjs+check-collab-health.test.mjs | 改 | 新条目+键⊆名单断言扩 | C1-C3 |
| scripts/restore-reerase.mjs | **建** | 恢复重擦除（扫外部 manifest；**按行幂等+replayedAt 落审计**；restore gate——runbook 定为恢复后开流量前置） | C4 |
| docs/superpowers/collab-ops-runbook.md | 改 | §14 canary 处置+shadow→实弹；§6 分诊；§13 恢复 SOP+残余披露（在线擦除+备份保留期+恢复重擦除三段/复核窗残余/VideoWork 404 语义/Template 随删语义）+retention matrix 登记 | C2-C4 |
| apps/api/.env.example+spec §10 env 块 | 改 | 新 env 键（env.ts zod 同步） | C1-C4 |
| scripts/check-collab-census.mjs | 改 | 新文件普查+**schema 闭包+scope-alias-registry diff**+**canvasProject.create 调用点必经 governance 断言**+read census | C1-C4 |

**迁移两笔（串行）：**
- [ ] **笔一（C1 前置+C3/C4 表列一次到位）**：`ExecutionInput @@index([expiresAt])`；`RuntimeEvent @@index([projectId, createdAt])`；`ExecutionRequest @@index([teamId, state])`；`CanvasProject` + `lifecycleState String @default("ACTIVE")` + `@@index([lifecycleState])` + `origin String?`；**`ALTER TYPE "TeamStatus" ADD VALUE 'DISBANDING'`（语句置迁移末——PG enum 加值不与使用同事务）**；**`CanvasDocCoalesced`（`projectId String, generation Int, seq BigInt, updateHash String @db.Char(64), sourceSeq BigInt, reason String, createdAt DateTime @default(now()), @@id([projectId,generation,seq]), @@index([projectId,generation,updateHash])`）**；**`CollabJobCursor`（`job String @id, lastKey String?, lastGap Json?, updatedAt DateTime @updatedAt`）**；`ProjectErasureRun`（`erasureId String @id @default(cuid()), scopeType String, scopeId String, parentRunId String?, teamId String?, state String @default("PENDING")`（PENDING|RUNNING|DRAINING|WAITING_CHILDREN|PURGING_DB|PURGING_OBJECTS|PURGING_CACHE|VERIFYING|DONE|FAILED）`, stage String?, dryRun Boolean @default(false), requestedBy String, requestedAt DateTime @default(now()), claimOwner String?, leaseUntil DateTime?, heartbeatAt DateTime?, completedAt DateTime?, manifestPath String?, manifestSha256 String? @db.Char(64), error String?, attempts Int @default(0), updatedAt DateTime @updatedAt, @@index([state, updatedAt]), @@index([scopeType, scopeId]), @@index([parentRunId])`+raw SQL partial unique：`CREATE UNIQUE INDEX project_erasure_active_uq ON "ProjectErasureRun"("scopeType","scopeId") WHERE state IN ('PENDING','RUNNING','DRAINING','WAITING_CHILDREN','PURGING_DB','PURGING_OBJECTS','PURGING_CACHE','VERIFYING')`——DONE/FAILED 后允许新 run）。baseline `--write` 同 commit。
- [ ] **笔二（C2）**：`CollabOpsGate`（`gate String, projectId String @default(""), state String @default("OPEN")（OPEN|FROZEN）, version BigInt @default(0), frozenAt DateTime?, frozenBy String?, unfrozenAt DateTime?, reason String?, @@id([gate, projectId])`）+**存量回填**（`INSERT INTO "CollabOpsGate" ("gate","projectId","state") SELECT 'compact', "id", 'OPEN' FROM "CanvasProject" ON CONFLICT DO NOTHING`+迁移后校验存量项目数==gate 项目行数）；`CanaryPin`（`projectId String @id, status String @default("CAPTURING")（CAPTURING|READY）, generation Int, snapshotRev BigInt, stateSeq BigInt, pgSeqAt BigInt, contentHash String? @db.Char(64), hashSkipped Boolean @default(false), hashVersion Int, stateVector Bytes?, leaseUntil DateTime, expiresAt DateTime`——**compare-and-delete**：worker 删 pin 带 pgSeqAt/snapshotRev 谓词）；`CollabCanaryCursor`（`projectId String @id, generation Int, lastCheckedAt DateTime, lastResult String, nextDueAt DateTime`）。baseline `--write` 同 commit。
- [ ] C4 零新表零新列（Template FK 不改——worker 显式删行）。

---

## C1：retention-worker（独立卡——先开）

### Task C1-0: 前置批（红先行）
- [ ] `packages/shared/src/collab/retention.ts`：常量单源迁移（30d/7d/100k）+tick 词表。
- [ ] **`project-lock.ts` 单源**：`lockProject`（advisory——doc 序，自 canvas-doc-update.repository.ts:59-63 抽出，repo 改引）+**`fenceProject(tx,pid)`/`fenceTeam(tx,tid)`（`SELECT lifecycleState/status ... FOR SHARE` 行锁读——非 ACTIVE 抛 PROJECT_ERASING；ErasureContext ALS 内豁免 DELETING）**+`lockScope(scopeType,scopeId)`；锁序单源钉死=advisory→Team 行→CanvasProject 行→业务行；**写锁门禁**：测试态 AsyncLocalStorage 断言（无锁写入即抛）。
- [ ] 迁移笔一落盘+baseline `--write` 同 commit。
- [ ] **★红⓪**（单测）：写锁门禁——未取锁的 `prisma.$transaction` 写路径（测试态）即抛；已取锁放行。

### Task C1-1: RetentionSweeperPoller 主体（红先行）
- [ ] **★红①**：过期且终态 ExecutionInput 行被删+未过期零触碰+非终态零触碰（判别双档）。**终态重写口径**：ExecutionRequest 终态迁移处同事务 `UPDATE ExecutionInput SET expiresAt=now()+30d`（:449 受理写=now+30d 语义修正——长任务终态即删缺口根除；红①夹具：受理 31 天后才终态→终态后 30d 才删）。
- [ ] **★红②**：stuck 告警按状态分——ADMITTED∧`ExecutionRequest.expiresAt`<now+EXECUTING∧join `GenerationIntent.deadlineAt/heartbeatAt`（MIN(deadlineAt)）→`retention_stuck_requests` 计数+告警不删。
- [ ] **★红③**：FAILED→删 input→同 requestId replay→幂等返回原值不读 input（`execution-request.service.ts:328-332`）。
- [ ] **★红④**：双 worker 并发 tick→`pg_try_advisory_xact_lock(hashtext('flowweb:retention'))` 单飞（第二实例 skip+计数）。
- [ ] **★红⑤**：sweepExpired 1000 行积压→多 tick 排空——claim（FOR UPDATE SKIP LOCKED）与 **`voidForExecutionRequestInTx(tx,...)`**（team-credit.service.ts 新增 InTx 变体，循 :212 模式）**同事务小批 ≤50**；连续失败退出+退避。
- [ ] **★红⑥**：kill -9 中途→续跑幂等。
- [ ] RuntimeEvent：sweepRetention 迁 worker；api timer/武装移除（`runtime-feed.service.ts:36/:102/:293-299`）；100k=lastSeq−100_000 feedSeq 边界法；**两扫面均 join `lifecycleState='ACTIVE'`/`Team.status='ACTIVE'`（DELETING/DISBANDING 零触碰——擦除中项目行集与 retention 不相交）**；`runtime_feed_bytes` 改**计数器维护**（删除时累减维护全局 Σbytes——SUM(octet_length) 全表扫废止；projectId 标签删除断言）；**投影语义**：retention 删后 `snapshotEnvelope`（:266-289 只折 RuntimeEvent）首连投影=**显式 unknown（真源=NodeExecution/NodeArtifact）非静默空白**——★红⑦：迁移前后 minRetainedSeq/删除语义对拍+8 天未打开项目首连投影 unknown 读面测试。
- [ ] 指标 `retention.metrics.ts`（deleted_rows{table}/backlog_rows{table} 按需 count/stuck/run_duration/void 计数——source=worker 3002）；THRESHOLDS+`--write-metric-names` 同 commit。
- [ ] worker.module 平铺+census ⑰/㉒+env 键。
- [ ] `pnpm verify`+双评审。

### Task C1-2: charter evidence 收口
- [ ] `retention-worker` 项 passed+evidence（两表清理实测+常驻+api timer 移除+锁形态+stuck 实弹+终态重写口径+scope ACTIVE 过滤+低基数断言）。

---

## C3：doc-append-gap-alert（侧表方案——独立于 C2）

> **v3.1 判据依据**：alias 行废止（撞 @@unique(updateHash) :1285+CHECK(frameCount>0)+密度自洽）；改 `CanvasDocCoalesced` 侧表承载吞行记录，audit 行间衔接断点 LEFT JOIN 判覆盖。maintenance/dedup 形态经代码核实不产生洞（maintenance 帧 mkAppliedEntry :1245-1251 落 PG 批；dedup 不烧 seq）——C3-0 诊断夹具钉死。

### Task C3-0: 诊断夹具+吞行侧表（红先行）
- [ ] **★红⓪-a（诊断夹具，先于一切）**：真实 actor 驱动 maintenance 帧与 dedup 命中两形态——断言 `CanvasDocUpdate` 行落库/pgSeq 推进与三断言一致（预期绿；若红=实现层形态与本结论不符，先修实现再续卡）。
- [ ] appendBatch 行插入循环（:213-224）——`RETURNING` 空的帧（updateHash 幂等吞行）**同事务 INSERT `CanvasDocCoalesced`**（`seq=r.lastWalSeq, updateHash=r.updateHash, sourceSeq=在档同 hash 行 seq, reason='t30b-coalesced'`，ON CONFLICT DO NOTHING 幂等）。——**★红⓪-b**：T30b 形态（同内容帧新 seq 重发→吞行）→侧表行落库+该批 ok+adopt 重定基——audit 三断言全绿。
- [ ] 侧表兼容核验单测：readAt/装载重放不受影响（侧表不进重放面）；compact purgeBelow 顺带删侧表行（同 seq 区间）；擦除随 scope 批删（registry 登记）。

### Task C3-1: SQL 聚合审计（红先行）
- [ ] **★红①（三断言+覆盖豁免）**：compact prune 彻底完成后审计绿——按 generation、聚合只取 seq>stateSeq 行：a) 行内密度 `frameCount==lastWalSeq−firstWalSeq+1`；b) 行间衔接：按 seq 排序 `next.firstWalSeq==cur.lastWalSeq+1` **∨ 断点区间 [cur.lastWalSeq+1, next.firstWalSeq−1] 全部存在 CanvasDocCoalesced 记录**（LEFT JOIN 覆盖判定）；c) 边界 `min(firstWalSeq)==stateSeq+1 ∧ max(lastWalSeq)==pgSeq`。**注入缺 seq（无侧表记录）→红**。
- [ ] **★红②（purge 延迟窗零假阳性+义务年龄）**：`purgeBelowSeq IS NOT NULL` 的 doc 聚合过滤 seq>stateSeq 后断言不违例（旧行不参与）**不 skip**——另加 **purge 义务年龄告警**（purgeBelowSeq 持续非空>阈值——卡死的清理义务独立告警，不被审计吞掉）。
- [ ] **★红③（skip 面+轮转游标）**：无 CanvasDoc 行∨`lifecycleState!='ACTIVE'`→skip 计数；每 tick 项目数预算分批**轮转游标**（`CollabJobCursor.lastKey` 按 projectId 轮转——尾部项目饿死根除）。
- [ ] **★红④（maintenance/dedup 夹具）**：红⓪-a 夹具进 CI 常驻（形态漂移即红）。
- [ ] **★红⑤（正常批+adopt 零计数）**：判别双档——正常批/T30b adopt（含侧表）零计数。
- [ ] 审计实现：单条 SQL CTE **按预算项目批（`=ANY($ids)` 逐批——全项目单聚合=全表扫废止）**；失败输出 `{projectId,generation,stateSeq,pgSeq,断言违例,缺失区间}` 结构化。
- [ ] worker audit（每 5min tick）：**新 gap 边沿 inc**（`CollabJobCursor.lastGap` 存 (project,generation) 状态——gapActive false→true 才 `doc_append_gap_total.inc`）+`collab_doc_append_gap_current` gauge（每 tick 重算）+即时 `captureCollabException`+结构化日志；两指标语义分工作 runbook 注记。
- [ ] 热路径 tripwire **维持 fail-closed 不降格**（:190-195 数据丢失级拒收）。
- [ ] THRESHOLDS：`doc_append_gap_total`（counter-delta delta:0 P0+source=worker 3002）+**`collab_doc_append_gap_current>0` 持续阈值**+缺样本 unobservable 告警——**★红⑥**：worker 停跑→health 红（样本年龄判定）。
- [ ] **★红⑦**：counter 回落重基线不误报+**SMS 实弹**（测试号码+演练标签）。
- [ ] runbook §6 分诊。`--write-metric-names` 同 commit+`pnpm verify`+双评审。

### Task C3-2: charter evidence 收口
- [ ] `doc-append-gap-alert` 项 passed+evidence（三断言全项目+T30b 侧表/purge 延迟/maintenance-dedup 夹具零假阳性+skip 面+注入红+轮转游标+义务年龄+SMS 实弹）。

---

## C2：replay-canary（依赖笔二+C3 审计面）

### Task C2-0: governance 前置（红先行）
- [ ] `project-governance.service.ts`：`ensureProjectGovernance(tx,{projectId,origin})`（OpsGate ('compact',pid,'OPEN') 行+origin 列单源）——**ProjectService.create 与 CanvasService.create（:33-54 第二创建路径）两处接线**；CI census 加「canvasProject.create 调用点必经 governance」断言。——**★红⓪**：两路径（/api/projects 与 canvas 创建）各建项目→OpsGate 行/origin 齐+compact 可运行（fail-closed 停摆根除）。
- [ ] 迁移笔二落盘（含存量回填+行数校验）+baseline 同 commit。

### Task C2-1: OpsGate 主体（红先行）
- [ ] **★红①**：三档语义（两行 state 组合）——全局行 FROZEN→拒；两行 OPEN→open；**任一行缺→fail-closed**；查询异常→fail-closed。
- [ ] **★红②**：canary fail→该 pid 项目行 FROZEN+他项目 OPEN+`collab_ops_gate_frozen_age`（全局 max 低基数）；boot 扫行初始化 gauge。
- [ ] **★红③（锁语义+两行校验）**：授权读 pass 后、发布事务提交前 frozen 到达→abandoned 零写——发布事务（compact ③ :607-629）内 `SELECT state FROM "CollabOpsGate" WHERE gate='compact' AND projectId IN ('',${pid}) FOR SHARE`——**校验返回行数==2 且两行全 OPEN（<2=fail-closed）**；freeze=UPDATE 置 FROZEN+version+1；`compact_gate_skip_total`。
- [ ] compact 三路径接线（repo 发布事务+worker tick+api maybeCompact）+**vacuumReplace 前置 gate 检查**。THRESHOLDS frozen_age P1@1h/P0@6h。

### Task C2-2: canary 捕获+比对（红先行）
- [ ] **★红④（两态双断言承 v3）**：先塞 5 帧→进 withFrozenPrefix→捕获坐标 pgSeqAt/appliedSeq 不含该 5 帧→release→队列帧 apply→pgSeq 前进含之。
- [ ] **CAPTURING pin-first 捕获（v3.1 竞态三修）**：fn 内短事务=①`SELECT "currentSnapshotRev" FROM "CanvasDoc" WHERE projectId=${pid} FOR SHARE`（与 compact 发布 FOR UPDATE 互斥——pin 在 prune 前可见）+②快照选择=**`stateSeq≤pgSeqAt` 的最新快照行**（currentSnapshotRev 可能指向 stateSeq>pgSeqAt 的新快照——坐错标根除；无满足快照→回退 genesis rev 0）+③INSERT `CanaryPin(status='CAPTURING', leaseUntil, expiresAt, 坐标)`→④fn 内算 SV+canonical hash（canary_capture_ms 计时+尺寸阈值——超限 hashSkipped=true 只取 SV）→⑤UPDATE pin status='READY'+contentHash（失败→DELETE pin）。——**★红⑤-a（创建窗）**：捕获中（CAPTURING 已落库）并发 compact publish+prune→pin 谓词挡住→readAt 仍可读；**红⑤-b（vacuum）**：pin 存活期 vacuumReplace→defer 本轮（或 pin 标 STALE+告警——实现择一，谓词进 vacuumReplace SQL）。
- [ ] api 侧 poller：**首步 `isLeaseServing()`**（非 serving skip——lease 未持有时不触 withFrozenPrefix）→skip 判定（维护窗/lifecycleState!='ACTIVE'）→捕获（上节协议）→**捕获前活跃 pin 检查**（同 pid 未过期 pin 存在→skip 本轮）。
- [ ] worker verify：`readAt(projectId,generation,snapshotRev,pgSeqAt)`（快照 PK+增量区间；prune→skip_retry；换代→skip+cursor generation 重置）→`replayPgSnapshot`→hash 主判→**语义兜底**（decodeStateAsUpdate 两侧→节点/边 canonical JSON 深比→仅语义不等 freeze；语义相等=hash_encoding_mismatch 计数）→SV 同代辅助→**compare-and-delete pin**（`DELETE WHERE projectId=? AND pgSeqAt=? AND snapshotRev=?`——TTL 过期后新 pin 误删根除；TTL 续租）。
- [ ] **hash canonicalization**：复用 compact `stateHash` 口径（`pendingStructs===null`+固定 gc/guid+hashVersion）——**★红⑥-a**：「同逻辑状态不同 integration order」构造→hash 可能不等→语义兜底绿不 freeze；**红⑥-b**：注入删行/改 payload→语义不等→双比红+Sentry+OpsGate frozen+解冻 ack 演练（AuditLog）。
- [ ] **★红⑦**：捕获后新帧涌入不误报+维护/擦除窗 skip+hashVersion 演进不误报。
- [ ] **★红⑧**：skip_lag 连续 3 tick→P0+`yjs_oldest_unflushed_age_seconds`>30s→P0+`wal_pending_bytes` 持续高位 P1。
- [ ] 覆盖：`N=ceil(active×1.25/24)`（active=CanvasDoc.updatedAt>now−7d∧lifecycleState='ACTIVE'）；`collab_canary_last_check_age`=全局 max>24h 告警；游标持久化+replay 预算+`pin_retry_total` 告警；freeze 争用披露（500ms 预算封顶+每项目 24h 低频——chainDigest 根治=登记项）。
- [ ] **freeze 默认实弹（v3.1 翻转）**：`CANARY_FREEZE_ENABLED` 生产默认 **true**（charter「不一致告警并冻结」）；shadow 只 dev 显式 flag——runbook 写 shadow→实弹切换判据（误报率观察窗）。
- [ ] 指标 `collab-canary.metrics.ts`（checked{result}/last_check_age/pin_retry/capture_ms/hash_encoding_mismatch/hash_skipped）+`--write-metric-names` 同 commit。

### Task C2-3: 合成金丝雀（参数化）+runbook
- [ ] `collab-smoke.mjs --canary` 档：专用服务账号+固定 canary 项目+写入上限+排除计费/统计面+独立 heartbeat+定期清理；本地 gate 实跑留证。
- [ ] runbook §14：cron+处置序（确认→语义复核→修复 A/B→解冻 ack→强制维护窗判据）+shadow→实弹切换序。
- [ ] `pnpm verify`+双评审。

### Task C2-4: charter evidence 收口+requirement 文本修订
- [ ] charter `replay-canary` requirement 文本修订：**「每小时轮转 replay canary（全局每小时+每活跃项目 ≤24h）：snapshot+updates 重放 fresh doc，hash 主判+semanticEqual 语义兜底/SV 对比，不一致告警并冻结 compact」**（2026-11-05 用户裁定——与 N 公式实现一致）。
- [ ] `replay-canary` 项 passed+evidence（捕获协议含红④两态+CAPTURING pin-first+创建窗/vacuum 竞态红⑤+语义兜底红⑥+**freeze 实弹演练**（非 shadow）+覆盖 SLO 实测+两路径 governance 红⓪+smoke 实跑）。

---

## C4：project-erasure（依赖 C1 表+C2 gate 语义——最后开）

> **v3.1 形态（对 v3）**：①fence=`fenceProject/fenceTeam`（FOR SHARE 行锁读单源）+**ErasureContextService**（app 写必须 ACTIVE/erasure ctx 允许 DELETING/DELETE 恒放行——fence 自锁根修）；②**manifest=唯一采集面先行**（DRAINING 首步写 manifest，worker 后续只从 manifest 读）；③run 表 partial unique+parentRunId+WAITING_CHILDREN 会合；④Media 三档 registry+引用图补全；⑤Template FK 不改（worker 显式删）；⑥VideoWork detach=/process、clone 404（产品裁定）；⑦PROJECT_ERASED 进 shared 契约；⑧读路径 extension 单点过滤。

### Task C4-1: tombstone-only 四入口+team 会合（红先行）
- [ ] `project.service.delete`：单事务=lockProject+fence 校验→资金门（in-tx——assertSettled 扩查 ExecutionRequest（ADMITTED/EXECUTING∧reservedCredit>0）+**RefundObligation PENDING+StorageReservation ACTIVE**；不过回滚 409）→置 `lifecycleState='DELETING'`+插 run 行（PENDING）→提交→emit `project.gone`→202——**★红①**：请求返回时行仍在（DELETING）+kill -9 on emit→run 恢复；重复删除请求→活跃 run 存在→202 返回该 run；**DONE 后再删（restore 形态）→新 run（partial unique）**；DRY_RUN→dryRun=true 且**跳过 lifecycle 置位**（项目不隐藏）。
- [ ] `cleanDrafts`：同批 tombstone；判据=`(origin IS NULL OR origin='user')`∧无 Template∧24h——**★红②**：clone（origin='clone'——VideoWorkCloneService.clone :52 接线）不被删。
- [ ] `template.service.delete`：数组事务→交互事务（lockProject+tombstone+资金门 in-tx）——**★红③**：原子。
- [ ] `team.service.disbandTeam`：请求事务=lockScope('team')+fenceTeam→资金门（in-tx 扩查询）→`Team.status='DISBANDING'`+team run 行（PENDING）→提交→emit→202；**逐项目置 DELETING+子 run 由 worker 分批游标完成**（O(N) 批置分批；team run `WAITING_CHILDREN` 等子 run 全 DONE→PURGING_TEAM（TeamBalance/团队级对象）→ledger 通行证→删 Team 行）；**废止请求内 team.delete 级联**——**★红④**：BullMQ 入队失败→run 轮询兜底；**红⑤**：team 解散与项目 appendBatch 并发交错→零复活（FOR SHARE 互斥——team 批 UPDATE 等全部 FOR SHARE 持有者）；**红⑤-b**：team run 等子 run 会合（一个子 run FAILED→team run FAILED 不删 Team）。
- [ ] **TeamStatus DISBANDING 全路径拦截**：TeamGuard（:43）/assertTeamMember（team.util.ts）/team.service :161/:439 统一 `status!=='ACTIVE'` 拒（写/管理 403；重复解散 409）——**★红⑥-a**：DISBANDING 下创建项目/邀请/充值/URL 路由全拒。
- [ ] `project.controller.ts` DELETE：**ProjectPermissionService 判 PROJECT_OWNER**（ProjectRole :894-898——含显式 PROJECT_OWNER 非创建者；requestedBy 传 userId）——**★红⑥-b**：MEMBER→403/PROJECT_OWNER 通过。
- [ ] 读路径：**Prisma client extension 单点注入 `lifecycleState='ACTIVE'`**（`includeDeleted` 显式开关=admin/worker/erasure；admin 面保留全量看 DELETING/FAILED）+read census（canvas 画布读/media presign/runtime-feed events/execution status/member/storyboard/video-project 等 project→读径全列）——**★红⑦**：tombstone 后 GET/画布读/media/feed→404/410+列表零出现+admin 可见 DELETING。

### Task C4-2: fence 写串行化+erasure 上下文（红先行）
- [ ] **写路径 census=schema 闭包+scope-alias-registry**：含 projectId/teamId 列模型闭包**+别名登记**（VideoProject.workflowId/VideoWork.canvasProjectId/ExecutionNodePlan.requestId（经 ExecutionRequest 桥）/AuditLog.targetId/VideoTrimTask.workflowId 等——列名扫描找不到的关联列）∪ $transaction/$executeRaw 写点——生成清单逐点接线：project 维写=lockProject（doc 序需保留者）+`fenceProject(tx,pid)`（FOR SHARE——非 ACTIVE 抛 PROJECT_ERASING）；纯 team 维写=lockScope+fenceTeam；**新增表/列未登记=CI 红**；**admit 事务接线**（:434-463——现只查 maintenance 门）。写路径隔离级别 census 维持（FOR SHARE 在 RR 下 locking read 亦看最新提交——正确性由行锁承担，census 为覆盖检查）。
- [ ] **ErasureContextService 接线**：erasure worker 全事务经 `withErasure(runId)`（ALS）包裹——`fenceProject` 在 ctx 内允许 DELETING 态写（worker=唯一合法 DELETING 写者）；DELETE 恒放行；**fence 规则三句 runbook 钉死**。
- [ ] erasure **DRAINING**（worker）：同键锁等待排干→**首步写 manifest（唯一采集面）**：NDJSON 分片（每 10k 行+每片 SHA-256+footer）+header（erasureId/scope/projectIds/requestedAt/schemaVersion）+media 行（id/bucket/key/thumbnailKey/objectKey/size）+work 行（id/canvasProjectId/videoKey/coverKey）+spool 段+派生 Redis 键清单；temp→fsync→rename→fsync dir；DB 存 manifestPath/manifestSha256；**worker 后续 detach/删除只从 manifest 读**——**★红⑧-a（顺序红测）**：先 detach 再清理（错误序）→Redis/对象清理空转→红；manifest 序→detach 后仍零残留清理全达。
- [ ] unload 归 API（`project.gone`→gateway handleProjectsGone :518-534——worker 不跨进程 unload）+WS fast-path 拒帧（close code=**PROJECT_ERASED**——shared 契约已进）。
- [ ] **★红⑨（fence 三态）**：a) 写事务持 FOR SHARE→并发 tombstone UPDATE 等待→写提交→DRAINING 批删→零行（含**双真连接交错**）；b) tombstone 先→写 FOR SHARE 见 DELETING→拒；c) **worker ctx 内 scrub/detach UPDATE 成功、同 UPDATE app ctx 被拒**（fence 自锁根除实证）；d) RR 写事务同样被 FOR SHARE 挡（负控：plain SELECT 版会穿）。
- [ ] **★红⑩**：双进程语义——API 持 doc+客户端在线→tombstone→连接 close（PROJECT_ERASED terminal）+doc unload+零 CanvasDoc 行复活。
- [ ] **append p95 基准（T33 harness）**：fence 接线后 appendBatch p95/p99/锁等待/最大 ops/s 基线对比——回归>阈值=红。

### Task C4-3: 介质执行+列级断言（红先行）
- [ ] saga worker（SKIP LOCKED claim+leaseUntil 续租/backoff/reaper 回收；stage 幂等 kill -9 续跑）——**★红⑪**：kill -9 各 stage→resume DONE 零双删；lease 过期→reaper 重置 PENDING。
- [ ] **介质清单（registry 驱动）**：FK 级联核验→无 FK 孤儿族 per-scope 批删（含 ExecutionNodePlan（requestId 桥）/MaintenanceOperation/OpsGate 项目行/CanaryCursor/pin 行/**CanvasDocCoalesced（C3 侧表）**/**Template 行（worker 显式 DELETE WHERE projectId——FK 不改，产品裁定=随项目擦除）**）→**Media 三档 registry**：a) **库资产**（folderId 非空∨isFavorite∨type='uploaded'——schema:340-344 素材库语义）→detach（projectId=NULL+**清 nodeId/taskId**+行对象保留）；b) 他项目/已发布作品引用（引用图=VideoWork.videoMediaId/coverKey+NodeArtifact.mediaId+MediaBinding+VideoProject.data 深扫+LightingTask.resultMediaId+VideoTrimTask.sourceFileId/outputFileId+他项目引用+ObjectManifest claim）→detach 保留；c) 独占（generated/temp 且无 a/b）→删行+对象全版本；**resultRef 不进引用图**（产物不跨 scope——仅 scrub 置 null）；**未 reconcile 引用经 collectMediaRefs 内部端点**（限批+isLeaseServing——容量防护；api 不可达→本轮暂停不删）+两阶段复核（首扫标记→下轮复核才删）+**复核窗残余披露**（「扫描后新引用」窗缩小非根除）——**★红⑫**：三档判别（库资产/他引用/独占）+detach 行 nodeId/taskId 已清。
- [ ] **VideoWork detach**：canvasProjectId=NULL——**/process、clone=404**（:370 实证；产品裁定 2026-11-05——runbook 写明；视频/封面/计费/审计保留）——**★红⑬**：detach 后作品视频可看+/process 404+零复活。
- [ ] **Redis purgeWorkCaches(workId)**（自 manifest work 行）：targeted `SCAN videoWork:process:{workId}:*` 全前缀（旧代体键 TTL 残留废止）+meta+`videoWork:url:{Media.key/thumbnailKey/VideoWork.coverKey}`；like/view 随作品保留——**★红⑭**：擦除后 process/meta/url 全族零残留（SCAN 断言）+detach 作品键保留。
- [ ] `purgeScope` spool 端点+api 内存 dedup/水位清键+快照缓存 evict。
- [ ] **版本化 capability detect**：GetBucketVersioning→ListObjectVersions+DeleteObjects 1000/批+DeleteMarkers+ListMultipartUploads/Abort+**GetBucketReplication/GetObjectLockConfiguration/lifecycle（副本/锁定→删除策略或披露）**——**★红⑮**（MinIO gate 版本化桶）：旧版本全删+multipart 残件清理；CI RustFS 非版本化+分支单测。
- [ ] **GenerationIntent scrub**（resultText/gestureKey/resultRef→null+计费列保留）+ExecutionRequest/NodeExecution 计费列保留+**AuditLog**（`targetType='PROJECT' AND targetId=pid` **+`targetType='TEAM' AND targetId=tid`**——beforeValue/afterValue 内容脱敏断言）——**★红⑯**：**列级机器断言**（schema 闭包+scope-alias-registry 全表——擦除后除 allowlist（GenerationIntent/ExecutionRequest 计费行/AuditLog/VideoWork detach/Media detach）外零行+allowlist 内容列全空）。
- [ ] **PROJECT_ERASED 全链（shared 契约已进）**：gateway onAuthenticate/onLoadDocument 查 lifecycleState 非 ACTIVE→terminal close PROJECT_ERASED；web resolveRecoveryAction→terminal→清 local-collab-cache+runtimeStore 投影+内存 doc/undo/awareness+拒绝 queued updates+不自动重连——**★红⑰**（单测+浏览器手测）：擦除→重连→terminal code→IDB 零残留+UI 终态+零重连。
- [ ] **`restore-reerase.mjs`**：扫外部 manifest（按行幂等+replayedAt 落审计；manifest 缺失→RESIDUAL_RISK exit 2 非成功）；**runbook 定为 restore gate**（恢复后开流量前置）——**★红⑱**：恢复旧备份→重擦零残留；双失→RESIDUAL_RISK 不假绿。
- [ ] **DRY_RUN**：dryRun 标志——走完整 stage+manifest+断言，介质删除跳过+lifecycle 不置位；runbook 实弹切换序。
- [ ] erasure 指标（runs_total{state}/pending_age/objects_deleted/stage_duration）+THRESHOLDS+擦除动作 AuditLog+资金行计费列存活断言+C1 互斥断言（scope ACTIVE 过滤对拍）。
- [ ] runbook §13：恢复 SOP（restore gate 步骤）+残余披露（在线擦除+备份保留期+恢复重擦除三段语义/manifest=外部文件 host 丢失窗/复核窗残余/离线 IDB 下次连接前残留/VideoWork 404+Template 随删语义/日志 Sentry 数据最小化）。
- [ ] `pnpm verify`+双评审。

### Task C4-4: charter evidence 收口
- [ ] `project-erasure` 项 passed+evidence（四入口含 team 会合全链+fence 三态含双连接交错+erasure ctx+manifest 唯一采集面+逐介质零残留含 Media 三档/Template 显式删/Redis SCAN 全前缀+版本化全删+replication/object-lock 能力核实+PROJECT_ERASED 全链+外部 manifest 恢复演练+列级断言+DRY_RUN+append p95 基线）。

---

## 批末出口门（确认点）

- [ ] 四卡全闭环（每卡双评审 APPROVED+Controller 亲验）。
- [ ] charter 四项 evidence 齐（含 replay-canary requirement 文本修订落盘）+`node scripts/check-production-charter.mjs` PASS。
- [ ] `pnpm verify` 全绿+registered red=0+`check-gate-evidence.mjs` PASS。
- [ ] gate-evidence/production-readiness-exit.txt 呈报包（四卡终态链关键数字+charter 快照+限制诚实登记：在线介质零残留+备份残余披露+freeze 实弹状态+容量/HA/密钥化登记——**不写「生产就绪/零残留」**）。
- [ ] **呈报「四项 charter 证据闭环+改档前置就绪」停等用户**——服务器窗与 `trafficTier` 改档=用户显式指令；容量/HA/密钥化/告警值班归服务器窗（登记项节）。

## 登记项（本批不实施——裁定 2026-11-05，两轮外审维持）

| 项 | 内容 | 去向 |
|---|---|---|
| crypto-shredding/per-scope DEK+KMS | 备份/版本化副本不可恢复的唯一方案 | 合规需求出现再立项（frame-audit na 同源；出口 evidence 只写在线介质零残留+备份残余披露） |
| DB 触发器兜底 | 含 scope 列全表语句级触发器 | 服务器窗前可选——**FOR SHARE 行锁采纳后 fence 正确性已有 DB 层保证（行锁互斥），触发器降为覆盖兜底**（census CI+写锁门禁为本批防线） |
| chainDigest Tier0 canary | actor apply 链内存摘要+PG 重算——零 freeze/全量连续覆盖 | C2 后续强化（freeze 争用根治） |
| MediaRef refcount 表 | 引用计数权威表（删除判据免 doc 扫描/免复核窗） | 后续批（本批两阶段复核+残余披露） |
| 单活容量/多活、WAL→官方 extension、schema 演进策略、容量 soak | 架构决策 | 服务器窗/独立立项 |
| 告警链升级（电话/值班/Alertmanager） | P0 通道强化 | 服务器窗 |
| retention matrix 全表实现 | DocAuditEvent 180d/GenerationIntent.resultText 90d/MediaFactOutbox 7d/AuditLog 归档 | runbook 登记+后续批（charter 字面=两表；evidence 只写两表） |
| ExecutionInput 分区 | 月分区 DROP PARTITION | 不实施（T33 实测 44 行/13KB；终态重写口径为将来分区留路） |
| ErasureJob/ErasureAudit 分表 | job 与审计事件分离 | 不实施（partial unique+AuditLog 承载已够——无用户数据窗口） |
| canary 覆盖 SLO 提档 | 「每小时每项目」口径 | 已裁定分层 SLO（charter 文本 C2-4 同步修订）——如需提档另立 |

## 确认点表

| 确认点 | 位置 | 状态 |
|---|---|---|
| spec 确认门 | spec v4→v5 | ✅ 已确认 |
| 三外审裁定（v2 评审） | 三份报告（2026-11-05） | ✅ 用户确认（v3 依据） |
| v3 复审裁定 | 三份 v3 复审报告（2026-11-05） | ✅ 用户确认（2026-11-05——本 v3.1 依据；开放项三项同批裁定：charter 文本/VideoWork 404/Template 随删） |
| plan 确认门 | 本文件 **v3.1** | ✅ 已确认（2026-11-05——spec v5+plan v3.1 联合确认门；卡序 C1→C3→C2→C4 开工） |
| 逐卡双评审 | C1→C3→C2→C4 各卡 | ⏳ 开卡逐个 |
| 批末出口门 | 本节 | ⏳ 批末 |
