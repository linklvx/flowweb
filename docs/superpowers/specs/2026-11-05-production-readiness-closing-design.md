<!-- doc-status: draft-v4 | created: 2026-11-05 | v3→v4: 第三份外审（4×P0）逐项裁定吸收——P0-1 采纳+修法修正（捕获协议改复用 withFrozenPrefix :1631 T21 冻结临界区——八阶段/fn 临界区内执行/appliedSeq 冻结由 drain 每批让位承载；驳回 captureAtSerial 新原语）+skip_lag 连续 P0+doc_pg_lag_seq 年龄 P0（现成指标 :538）；P0-2 采纳 CanaryPin lease（方案 A；驳回方案 B 活态字节落对象存储）+N=ceil(active/24) 覆盖数校正+双层 SLO 分开（SQL 审计=全项目每 tick 完整层/canary 重放=抽样层）；P0-3 采纳项目级写串行化（erasure DRAINING 取 lockProject 同键 :59-63——appendBatch/vacuumReplace T12 锚+全 project-scoped 写事务首句同锁族；WS 缓存降 fast-path）；P0-4 采纳 GenerationIntent 内容列 scrub（resultText @db.Text :1487/gestureKey/resultRef→null）+列级机器断言+charter 披露行。P1：stateSeq 聚合断言锚、OpsGate NULL 唯一+boot gauge 初始化、FAILED replay 幂等返回原值实证（:309-313）、team disband manifest 事务内持久（:450-454 快照已有）、版本化测试载体分离（RustFS 未证→本地 MinIO gate）、manifest 主载体=DB JSONB（对象前缀降副本——MinIO 无备份 Y7）、smoke 生命周期要求节。待用户确认后进入 plan -->
# 生产就绪收尾批（charter 本地四项闭环——retention / replay-canary / doc-append-gap-alert / project-erasure）设计 spec

日期：2026-11-05（立项日；v4=第三份外审 4×P0 裁定吸收版）

定位：Y1c P4 交付线后继批。**目标=`scripts/production-charter.json` 八个 pending 中的四个本地开发项闭环翻 passed**（其余四项 pitr/pg-sync-commit/minio-versioning/restore-drill-服务器复演=服务器窗，范围外由用户开窗）。四卡全闭环后，`trafficTier` dev-test→production 改档仅余服务器窗＋显式改档留痕（runbook §15 操作序）。**本批闭环≠生产可上线**：单实例无 HA、无 PITR 的可用性风险不因本批改变——上线门槛仍是服务器窗。

## §0 已裁定（不再议）

- **frame-audit=无合规需求**→charter 已登记 na＋确认记录（58efba47）。
- **doc-append-gap-alert 阈值=采纳建议值** `increase(doc_append_gap_total[5m])>0`（零丢失口径）。
- **服务器窗=本批完成后一次性开**（部署 v4.1 走 runbook §16 序＋服务器侧 charter 三项核实＋restore-drill 服务器复演＋容量 soak 校准）。
- 流程纪律：superpowers TDD（红先行→绿）、TypeScript strict、subagent-driven＋每卡双评审、根修禁垫片、新 commit 禁 amend。
- 三轮外审裁定均落 §2/§6；驳回项与实证理由见 §6。

## §1 事实基线（三轮核验锚点，2026-11-05）

1. **告警链现状**：prom-client 已在（api `/metrics`＋worker `127.0.0.1:3002` 双出口）；唯一告警通道=`scripts/check-collab-health.mjs` cron `*/5` 拉 /metrics（**双端点采集：api `:333`＋worker 3002 `:134``）比阈值（单源 `scripts/collab-health-thresholds.mjs`）＋腾讯 SMS（P0、节流 15min）＋`.data/collab-health-heartbeat.txt` 心跳停更 P0 判据；`counter-delta` 内建重启重基线。**现成 append-stall 可观测指标**：`doc_pg_lag_seq`（store.metrics.ts:538）＋`wal_pending_bytes`（:530）。
2. **捕获与写锁原语（v4 核心实证）**：**`withFrozenPrefix`（`collab-project-actor.service.ts:1631-1676`）=仓内在役屏障原语**——T21 冻结临界区，八阶段（acquire→wait-apply(batchInFlight)→flushThrough→assert-pgSeq==appliedSeq→verify-generation→fn 临界区内执行→release）；freeze 持有期 **drain 循环每批让位**（:447 注释：已过准入检查的 beforeSync 帧不得在冻结读后 apply）→ appliedSeq 冻结 → **fn 时活 doc==PG 前缀@appliedSeq 严格成立**；预算 EXEC_FREEZE_BUDGET_MS 500ms＋EXEC_ADMISSION_TIMEOUT_MS 2s；维护帧通道照常（→ canary tick 维护窗 skip 判定先行）。**`lockProject`（`canvas-doc-update.repository.ts:59-63`）=per-project xact advisory 锁单源**（`pg_advisory_xact_lock(hashtext(projectId)::bigint)`）——appendBatch（:211）与 vacuumReplace（:479）同键互斥（T12 锚）。`readConsistent`=读最新指针+增量尾（无 pin）；**pin 读可行**：`CanvasDocSnapshot @@id([projectId,generation,snapshotRev])` PK 直查＋`CanvasDocUpdate @@id([projectId,generation,seq])` 区间扫＋`pruneSnapshots/purgeBelow`（:695/:677）为竞态源（→CanaryPin lease）。
3. **retention 现状**：`RuntimeEvent` 7d/100k 已实装（api 进程 1h setInterval）；`ExecutionInput` 零删除零索引（`expiresAt DateTime` **必填**——schema:1074，无 NULL 悬挂）；`ExecutionRequest` `@@index([projectId,state,expiresAt])` 在、终态**幂等返回原值不读 input**（`execution-request.service.ts:309-313` 同 (projectId,requestId) 在档三档：REQUEST_STALE 409/幂等冲突/幂等返回原值）；`sweepExpired` take:100 无循环无锁、无生产调用方。advisory 先例全为事务内 xact 形态。
4. **擦除现状**：删除=五表 FK 级联＋内存终态集＋WS 关连接＋删者 IDB；**入口恰四条**（project.delete/cleanDrafts/template.delete `prisma.$transaction` 数组形态 `template.service.ts:164`/team 解散 `team.service.ts:428-456`——**解散事务内本就快照 medias**（`:450-454`）＋提交后 best-effort 入队（`:464-466` 失败仅 warn）＋`team.delete` 级联删 Media 行；admin/user 域 grep 零删除路径）。**`GenerationIntent` 内容列实证**（schema:1487 起）：`resultText String? @db.Text`（生成正文）、`gestureKey`、`resultRef`、`traceId`——v3 允许清单保留=擦除不净。Redis 公开快照缓存（`video-work.service.ts:53`）；MinIO=aws-sdk/client-s3（GetBucketVersioning/ListObjectVersions/DeleteObjects SDK 面在未用；**RustFS versioning 支持未证**）；对象键中段含 pid 不可前缀枚举；`Media @@index([projectId])` 在；media-gc 引用图守卫先例在。
5. **机器门影响面**：指标=`*.metrics.ts`→canonical 名单→`--write-metric-names` 同 commit→**涉指标 commit 跑 verify FULL**；标签全低基数禁 projectId；迁移 additive＋immutability baseline 同 commit；census ⑰/㉒；check-collab-health 已双端点采集（指标 source 声明归 plan）。

## §2 卡序与裁决

**卡序**：C1 retention（独立）→ C2 canary（独立）→ C3 gap-alert（SQL 审计权威层）→ C4 erasure（依赖 C1 衰减互斥＋C2 完整性可验）。

**R 裁定（v4 全集；R1-R10 承 v3，新增 R11-R14）**：

- **R11 捕获协议=复用 `withFrozenPrefix`**（驳回新 captureAtSerial/barrier 原语）：canary 捕获 fn 在临界区内 no-await 执行（坐标＋SV＋canonical hash 一次取齐）；queued 帧 apply 于 release 后、坐标 pin 只读 `<=pgSeqAt`——两方向都不受队列余量影响。红锚「先塞 5 帧→再冻结→捕获」判别性用例必测。
- **R12 CanaryPin lease**（P0-2 方案 A；驳回方案 B 活态字节每小时落对象存储）：pin 行 `(projectId, snapshotRev, pgSeqAt, expiresAt=TTL 5min)`——compact `pruneSnapshots/purgeBelow` 对 pin 存活 pid **推迟本轮**（skip＋计数）；worker `readAt` pin 读＋比对完成删 pin；pin TTL 过期=compact 恢复（canary 下轮重试）。
- **R13 erasure 写串行化=lockProject 同键＋DRAINING stage**：erasure 状态机补 DRAINING（拿锁→等在飞事务→unload 驻留 doc→manifest→删除，持锁至完成）；**全部 project-scoped 写事务首句同锁族**（appendBatch 已在；feed append/ExecutionOutbox/MaterializeRun/deliverArtifact/exec-status/upload confirm——plan 按 census 枚举逐点）；WS 逐帧缓存=fast-path（锁=保证）；实现形态二选一归 plan（推荐 lockProject 复用单源；备选 CanvasProject FOR SHARE×DELETE FOR UPDATE）。
- **R14 GenerationIntent 内容列 scrub＋列级断言**：擦除对 allowlist 行做 column scrub（`resultText/gestureKey/resultRef`→null；保留计费身份列 creditCost/creditsConsumed/execSeq/status/kind/teamId/userId/traceId）；AuditLog 该项目行 payload 脱敏核查；机器断言升级**行级零行＋allowlist 内容列全空**（列级防未来加列漏网）；charter/披露行=「资金审计保留=计费与身份字段，不含生成内容」。
- R1-R10 承 v3（告警链扩展 cron＋双网；RuntimeEvent 迁 worker；sweepExpired 循环+SKIP LOCKED；资金行豁免+fencing；OpsGate seed＋项目级＋三档＋两阶段读＋人工 ack＋`collab_ops_gate_frozen_age` 分级告警＋**NULL 唯一约束修复＋boot 扫行初始化 gauge**；api 侧有界捕获；tombstone-first 四入口＋`@unique(projectId)` upsert-reset；collab-smoke 每小时 cron；manifest=证据+恢复重放源；版本化 capability detect）。

## §3 卡设计

### C1 retention-worker

worker 进程 `RetentionSweeperPoller`（poller 模板；worker.module 平铺）。三扫面＋闸：

1. **ExecutionInput 30d**：`expiresAt<now` 且 join `ExecutionRequest.state ∈ 终态`（COMPLETED/**FAILED**/VOIDED）→ ctid victims CTE 500/批；**regenerate 语义钉死**：终态 replay=幂等返回原值不读 input（`:309-313` 实证）——FAILED 同删安全，红锚（FAILED→删 input→replay→原值非 500）；`expiresAt` 必填已证（无 NULL 悬挂）。EXECUTING/ADMITTED 超期→`retention_stuck_requests` 告警不删。新索引 `ExecutionInput(expiresAt)`。
2. **RuntimeEvent 7d/100k**：sweepRetention 原样迁共享 service；api timer＋武装移除（等价对拍红锚）。
3. **sweepExpired**：循环清空（每轮 ≤500、单轮连续失败退出、多 tick 排干）＋事务内 `pg_try_advisory_xact_lock` claim。
4. 单飞闸=tick 事务内 xact 锁；**指标 source=worker 3002**（THRESHOLDS 条目声明——health 双端点已采）。
- backlog 告警：`retention_backlog_rows{table}`＋`retention_stuck_requests`＋`retention_deleted_rows_total{table}`/`retention_run_duration_ms`。
- 红锚：30d 边界±、终态过滤判别双档、FAILED replay 实证、api timer 移除等价对拍、kill -9 续跑、xact 锁双 worker 单飞、stuck 实弹、sweepExpired 1000 积压多 tick 排干、worker 指标被 health 采集实测。

### C2 replay-canary

api 进程 `CollabReplayCanaryPoller`。**tick 首步 skip 判定**：维护窗（freezeInfo——维护帧通道照常故必 skip）/tombstoned→skip 计数。

**捕获协议（R11 复用）**：`withFrozenPrefix(pid, fn)`——fn 临界区内 no-await 取坐标 `(generation, snapshotRev_at_capture, pgSeqAt=appliedSeq)`＋SV＋canonical hash（hashVersion 标注；超尺寸 doc→内容 hash skip＋flag）；gate/flush 超时（500ms/2s 预算）→skip_gate/skip_lag 计数。**CanaryPin 落库（R12）**：捕获同刻插 pin 行（TTL 5min）。

**worker 比对**：`readAt(projectId, generation, snapshotRev, pgSeqAt)` pin 读（快照行 PK＋增量 `stateSeq<seq<=pgSeqAt`）→ `replayPgSnapshot` → **canonical hash 主判＋SV 同代辅助**（`vacuumEquivalent` GC 壳）；比对完成删 pin。

**双 skip 分层（P0-1 补丁）**：`skip_lag` **连续 3 tick→P0**（append 停摆伪装面）；`doc_pg_lag_seq` 年龄超 30s→P0（现成指标加阈值——append 停摆时 C3 SQL 审计因 pgSeq 不动也假绿，此条为两路共同的兜底）＋`wal_pending_bytes` 持续高位 P1。

**覆盖（P0-2 校正）**：`N=ceil(activeProjects/24)`/tick（activeProjects=DB 计数；留抖动余量归 plan）；**双层 SLO 分开**：SQL 审计（C3）=全项目每 tick 完整层；canary 全量重放=**抽样层**（replay 预算：每 doc `readAt+decode+hash` 时限，超预算降级 SQL 审计＋标记）；覆盖 gauge=`collab_canary_last_check_age`（每项目 lastCheckedAt 年龄 max——超 24h 告警）＋`collab_canary_pin_retry_total`。

**OpsGate**：三档语义（全局缺行/异常=fail-closed；项目行不存在=open）＋两阶段读＋**`@@unique([gate,projectId])` NULL 修复**（PG 多 NULL 行=全局行可重复——哨兵 `projectId=''` 或 partial unique raw SQL，plan 定形）＋**boot 扫 gate 行初始化 `collab_ops_gate_frozen_age`**（重启不丢冻结告警）＋`collab_ops_gate_frozen_age` 分级 P1@1h/P0@6h＋解冻人工 ack＋AuditLog＋runbook §14 处置序（修复路径 A 活 doc 导出→collab-spool-import；B PG 前缀→collab-rebuild-gen.mjs；spool 容量 full=强制维护窗判据）。
- **合成金丝雀（R8 承 v3＋生命周期要求）**：collab-smoke 每小时 crontab——**专用服务账号＋固定 canary 项目＋单次写入量上限＋排除计费/统计面＋定期清理（垃圾上限）＋独立心跳文件（smoke-heartbeat——与 collab-health 心跳分开）＋失败即 P0**；部署时启用（runbook §14 写明）。
- 红锚：先塞 5 帧→冻结捕获（坐标含/不含判别）；**捕获窗内新帧涌入不误报**（pin 读坐实）；compact 高频下 pin 存活→快照不被 prune（pin-lease 判别性）；注入删行/改 payload→双比红＋gate frozen＋compact skip＋解冻演练；skip_lag 连续 3→P0；200 项目覆盖 ≤24h 实测（N 计算验证）；维护/擦除窗 skip；hashVersion 演进不误报；游标持久化重启续扫；boot 后 frozen_age 保留；高载零误报；smoke 本地实跑＋独立心跳。

### C3 doc-append-gap-alert

**权威层=廉价 SQL 聚合审计（全项目，worker 每 5min tick）**：per-project per-generation 一条聚合——**锚=当前指针快照行 stateSeq**：
`min(firstWalSeq)==stateSeq+1 ∧ max(seq)==pgSeq ∧ ΣframeCount==pgSeq−stateSeq`
（按 generation 过滤、pgSeq 取同代指针；compact prune 后存活首行恰为 stateSeq+1——**无窗口函数假阳性**）。违反→`doc_append_gap_total.inc(缺失数)`＋即时 `captureCollabException`（第一网）＋结构化日志（pid 走日志）。**gauge+counter 分工**：`collab_doc_append_gap_current`（当前缺口数 gauge——每 tick 重算不累加）＋counter（累计新增）。
- **热路径 tripwire 降格保留**（承 v3）：appendBatch 行回查 fencedClassify 瞬态档→结构化日志 only；「CAS 已提交且同事务行缺失」结构性不可达→tripwire inc（注释明示非告警源）。
- **告警链**：THRESHOLDS 增 `doc_append_gap_total`（counter-delta delta:0 P0）＋**source=worker 3002 声明**＋缺样本/缺指标升级档（evaluate 目标缺样本→unobservable 告警）＋`doc_pg_lag_seq` 年龄 P0（承 C2）＋runbook §6 分诊步骤（spoolResidual/pgSeq-appliedSeq/行集查询序）。
- 红锚：**compact prune 后审计零假阳性**（先 compact 再审计判别）；全项目范围注入缺 seq→计数＋告警判定红＋Sentry 面；正常批＋adopt 收敛零计数双档；counter 回落重基线不误报；SMS 实弹。

### C4 project-erasure

**tombstone-first（承 v3＋事务形态修正）**：`ProjectErasureRun`（erasureId @id＋projectId＋state＋stage＋requestedBy/requestedAt＋manifest JSONB＋error/attempts——**manifest 主载体=DB JSONB（随 daily pg_dump 耐久；data-dir 文件降副本；对象前缀可选副本）**——恢复重放脚本优先读 DB manifest；`@unique(projectId)`＋re-erase=upsert-reset）。四入口同事务插 PENDING：project.delete/cleanDrafts/**template.delete 数组事务→交互事务**（插 tombstone 在 `template.delete` 前同事务）/team 解散——**解散 manifest 在事务内持久 medias 快照**（`:450-454` 已有快照→manifest JSONB 同事务），`cleanupQueue` 入队降为加速（失败不再丢对象——worker 轮询兜底）。

**状态机＋写串行化（R13）**：`PENDING→RUNNING→DRAINING→VERIFYING→DONE / FAILED(retry)`；**DRAINING 取 `lockProject` 同键持锁至删除完成**（appendBatch/vacuumReplace 同键互斥）；**全部 project-scoped 写事务首句同锁族**（plan 按 census 枚举：appendBatch 已在＋feed append/ExecutionOutbox/MaterializeRun/deliverArtifact/exec-status/upload confirm——命中 tombstone=typed throw）；WS 逐帧缓存=fast-path。驻留 doc：DRAINING 前置 close＋unload＋registry 清。kill -9 每 stage 续跑幂等。

**内容列 scrub（R14）**：GenerationIntent（allowlist）行 `resultText/gestureKey/resultRef`→null；AuditLog 该项目 payload 脱敏核查；**列级机器断言**：information_schema 扫全部含 projectId 列的表——擦除后除 allowlist（GenerationIntent[scrub 后]/ProjectErasureRun）外**零行**＋allowlist **内容列全空**（列级，防未来加列漏网）。

**介质清单（v4 全量）**：

| # | 介质 | 处置 |
|---|---|---|
| 1 | FK 五表族 | 删除事务级联（既有）——run 核验记账 |
| 2 | 无 FK 孤儿族（RuntimeEvent/Cursor/ExecutionRequest/NodePlan/ExecutionInput/NodeExecution/Outbox/MaterializeRun/DeliveryFence/LifecycleObligation/NodeArtifact/ArtifactProjection/MediaFactOutbox/DocAuditEvent/MaintenanceOperation/OpsGate 项目行/CanaryCursor 行） | per-pid 批式删 |
| 3 | Media 行＋MinIO 对象 | Media(projectId) 行驱动逐对象删＋引用图守卫（他项目引用→行+对象保留，披露）；`uploads`/`temp` 经 Media 反查同守卫；孤儿对象兜底扫（results/ 分页过滤 pid——定期 backstop） |
| 4 | 对象版本化 | capability detect：GetBucketVersioning→开启时 ListObjectVersions＋DeleteObjects 版本全删；**测试载体分离**：本地 MinIO gate 跑版本化全删 e2e（RustFS versioning 未证）；CI RustFS 跑非版本化路径＋capability 分支单测——evidence 写明载体 |
| 5 | Redis 公开快照缓存 | SCAN `videoWork:process:{pid}:*`＋DEL（含 url/meta）；失败入 stage 重试（TTL 自腐=兜底非承诺） |
| 6 | WAL spool 段 | `spool.purgeProject(pid)` api 内部端点（`WORKER_WRITE_TOKEN`）：段头/文件名 pid 匹配 unlink＋sidecar＋空目录 rmdir＋api 内存 dedup/水位/计数器清键；run 末 `listSpoolFiles` 按 pid 零残留核验 |
| 7 | 快照缓存进程内 | pid 键 evict（随内部端点同调） |
| 8 | 他端 IDB | 既有终态 close reason 族 purge 核验（离线设备=下次连接清——披露） |
| 9 | 备份 tombstone | manifest=DB JSONB 主载体（daily dump 耐久）；恢复 SOP=自动化 re-erase 脚本（DB manifest 优先＋**manifest 缺失时恢复 DB 行＋前缀扫描重建**）；**残余风险诚实披露**：恢复到擦除前旧备份＋manifest 晚于备份轮换窗丢失→PITR 级残余（归服务器窗 Y7 门槛） |
| 10 | 审计 | 擦除动作落 AuditLog；资金行 GenerationIntent scrub 保留（计费身份列）；RefundObligation 无 projectId 列（表级断言自然豁免） |

- 与 C1 互斥：erasure=项目立即终态；retention=全表时间衰减——行集不相交、xact 锁各自单飞。
- CI：int suite 挂 test job（RustFS 已在）；版本化 e2e=本地 MinIO gate。
- 红锚：四入口全链（含解散 manifest durable/模板交互事务）；**开写事务→tombstone→DRAINING→提交被阻→零行**（锁判别——check-then-act 根除实证）；擦除中 WS 在飞帧被拒＋在飞 materialize 写入被拒；驻留 doc unload；**allowlist 内容列全空**（列级断言）；team 解散对象零残留（manifest 兜底实证）；版本化旧版本全删（本地 gate）；恢复旧备份→脚本重擦除零残留；kill -9 每 stage；re-erase upsert-reset；共享 media 判别；资金行计费列存活断言。

## §4 机器门与登记影响面（批级）

- 指标（全落 `.metrics.ts`；禁 projectId 标签；**source 声明**：worker 3002 族 vs api `/metrics` 族——THRESHOLDS 条目同步）：`doc_append_gap_total`/`collab_doc_append_gap_current`/`retention_deleted_rows_total{table}`/`retention_backlog_rows{table}`/`retention_stuck_requests`/`retention_run_duration_ms`/sweep-void 计数/`collab_canary_checked_total{result}`/`collab_canary_last_check_age`/`collab_canary_pin_retry_total`/`collab_ops_gate_frozen_age`/`compact_gate_skip_total`——canonical 名单再生成同 commit＋涉指标 commit 跑 verify FULL。
- 迁移五笔（additive）：`ExecutionInput(expiresAt)` 索引、`CollabOpsGate`＋seed＋NULL 唯一修复、`CanaryPin`、`CollabCanaryCursor`、`ProjectErasureRun`（manifest JSONB）——immutability baseline `--write` 同 commit。
- env 新键走 env.ts zod＋spec §10 env 块同步＋census ㉒；census ⑰ 新 poller 零 controller；doc-gate：本 spec 入语料。
- runbook 增量：§14 canary 处置序＋解冻序＋smoke cron（账号/项目/预算/清理/独立心跳）＋强制维护窗判据；§6 gap 分诊＋worker source；§13 恢复 SOP re-erase 脚本步。

## §5 确认点（批流程门）

1. **本 spec 确认门（当前）**——v4 裁定（含 §6 三轮驳回面）确认。
2. plan 确认门（步骤级红锚；实现形态二选一项落定：OpsGate NULL 修复形态/写串行化锁形态/覆盖 N 余量）。
3. 逐卡 subagent-driven 双评审（实现者→spec 合规→质量→收口→Controller 亲验）。
4. 批末出口门：四卡闭环＋charter 四项 pending→passed＋`check-production-charter` PASS＋verify:full 全绿＋registered red=0 → 呈报「改档前置就绪」；服务器窗与 `trafficTier` 改档留用户指令。

## §6 外审驳回/修正登记（三轮存档）

| 项 | 轮 | 裁定 | 理由（实证） |
|---|---|---|---|
| T0 统一 ProjectLifecycle | R1 | 驳回 | 简洁优先；真实交互点一行守卫；Y2 状态增殖再议 |
| 2h 有界自动解冻 | R1 | 驳回 | 自动解冻=烘焙可疑态违背 fail-closed；人工 ack＋frozen_age 分级（P1@1h/P0@6h）＋容量/磁盘双 backstop |
| 「CI 无 MinIO」 | R1 | 修正 | test job 已跑 RustFS S3（ci.yml:19-61） |
| 「counter reset/心跳缺失」 | R1 | 已存在 | counter-delta 重基线＋heartbeat 停更 P0 判据均在 |
| 「flushThrough 不等队列排空」 | R2 | 修正（承 v3） | withFrozenPrefix :1631 断言 pgSeq==appliedSeq＋drain 每批让位＝正确屏障；v4 明确捕获走它 |
| 「hash/重放移出 api 事件循环」 | R2 | 部分驳回 | Y.Doc 不可跨进程转移；api 有界捕获（1 doc/tick 内、超尺寸 skip） |
| OpsGate 5s 读缓存 | R2 | 驳回 | compact 60s 时间门下每 tick 一查询可忽略；缓存仅 WS 逐帧 fast-path |
| 「admin/账号删除入口须核」 | R2 | 已核不存在 | admin/user 域 grep 零删除路径；入口恰四条 |
| `@unique(projectId)` 改 active 部分唯一 | R2 | 修正 | re-erase=upsert-reset 同行复用 |
| manifest 当删除源 | R2 | 采纳 R9 | 删除源=DB 行＋Media 驱动；manifest=证据+恢复重放源 |
| S3 前缀中段通配 | R2 | 采纳 | Media 行驱动＋孤儿兜底扫 |
| **captureAtSerial/barrier 新原语** | **R3** | **驳回（R11）** | **withFrozenPrefix :1631 已是正确屏障（T21 八阶段在役测试过）；根修=复用非重造**；红锚「先塞 5 帧再冻结」保留 |
| **P0-2 方案 B（活态字节落对象存储）** | **R3** | **驳回** | pin lease（A）已消除竞态；2.5MB/h 无必要 |
| **manifest 主载体=对象前缀** | **R3** | **修正** | MinIO 无备份（Y7 门槛）→主载体=DB JSONB（daily dump 耐久）；对象前缀降可选副本；残余风险（备份轮换窗）诚实披露归服务器窗 |
| 「RustFS 上直接测版本化」 | R3 | 采纳（载体分离） | RustFS versioning 支持未证→本地 MinIO gate 跑版本化 e2e；CI 跑非版本化路径＋capability 分支单测 |
| 其余 R3 P0/P1（skip_lag 假绿/pin 竞态/N 校正/写串行化/内容列 scrub/stateSeq 锚/NULL 唯一/FAILED 实证/disband manifest/smoke 生命周期） | R3 | **全采纳** | 各落 §2 R11-R14＋§3 各卡＋§4 |