<!-- doc-status: active | created: 2026-11-05 | confirmed: 2026-11-05（spec v5+plan v3.1 联合确认门通过；plan 终稿=docs/superpowers/plans/2026-11-05-production-readiness-closing.md v3.1） | v4→v5: 第四份外审（plan 评审回流 7×P0）逐项裁定吸收——P0-1 CanaryPin 补四字段（generation/contentHash/hashVersion/SV——worker readAt 比对无载体修）；P0-2 Redis 缓存键改 workId 映射（video-work.service.ts:46 键首段=作品 id 实证——v4/v3 `SCAN {pid}:*` 匹配零根修）；P0-3 锁模型重写（tombstone 行=持久 fence+每写事务 in-tx 查行+每批删除各自锁——advisory xact 锁事务结束释放，「持锁至删除完成」不可达）；P0-4 manifest 主载体改 data-dir 外部耐久面（**v4 误判反转登记**：DB JSONB 主载体与「恢复删除前旧备份」场景矛盾——恢复后 DB 无擦除行 manifest 消失；R3-5.5 原建议为正解）；P0-5 erasure scope 化（team 解散媒体=teamId 维——scopeType/scopeId）；P0-6 ProjectErasureRun 迁移前移 C1 前置（skip_erasing 依赖环解）；P0-7 写事务 in-tx tombstone 检查（缓存=fast-path 非保证）。P1×10 全采纳（红④断言反转/lockProject 抽 project-lock.ts+写锁门禁/sweepExpired 抽共享/迁移笔数勘正=三笔/pin TTL 15min+续租/erasure metrics/AuditLog targetType 谓词/smoke 参数化/C3 skip+预算/canary_capture_ms）。联合确认门 ✅ 2026-11-05（plan 终稿 v3.1） -->
# 生产就绪收尾批（charter 本地四项闭环——retention / replay-canary / doc-append-gap-alert / project-erasure）设计 spec

日期：2026-11-05（立项日；v5=第四份外审 7×P0 裁定吸收版）

定位：Y1c P4 交付线后继批。**目标=`scripts/production-charter.json` 八个 pending 中的四个本地开发项闭环翻 passed**（其余四项=服务器窗，范围外由用户开窗）。四卡全闭环后，`trafficTier` dev-test→production 改档仅余服务器窗＋显式改档留痕（runbook §15 操作序）。**本批闭环≠生产可上线**：单实例无 HA、无 PITR 的可用性风险不因本批改变——上线门槛仍是服务器窗。

## §0 已裁定（不再议）

- **frame-audit=无合规需求**→charter 已登记 na＋确认记录（58efba47）。
- **doc-append-gap-alert 阈值=采纳建议值** `increase(doc_append_gap_total[5m])>0`（零丢失口径）。
- **服务器窗=本批完成后一次性开**（部署 v4.1 走 runbook §16 序＋服务器侧 charter 三项核实＋restore-drill 服务器复演＋容量 soak 校准）。
- 流程纪律：superpowers TDD（红先行→绿）、TypeScript strict、subagent-driven＋每卡双评审、根修禁垫片、新 commit 禁 amend。
- 四轮外审裁定均落 §2/§6；驳回项与实证理由（含一处我方 v4 误判反转）见 §6。

## §1 事实基线（四轮核验锚点，2026-11-05）

1. **告警链现状**：prom-client 已在（api `/metrics`＋worker `127.0.0.1:3002` 双出口）；唯一告警通道=`scripts/check-collab-health.mjs` cron `*/5` 拉 /metrics（**双端点采集**）比阈值（单源 `scripts/collab-health-thresholds.mjs`）＋腾讯 SMS（P0、节流 15min）＋`.data/collab-health-heartbeat.txt` 心跳停更 P0 判据；`counter-delta` 内建重启重基线。**现成 append-stall 可观测指标**：`doc_pg_lag_seq`（store.metrics.ts:538）＋`wal_pending_bytes`（:530）。`doc_append_gap_total` 指标代码零存在；亲缘=`doc_prefix_gap_total`（recovery 侧）——语义分治。
2. **捕获与写锁原语**：**`withFrozenPrefix`（`collab-project-actor.service.ts:1631-1676`）**——T21 冻结临界区八阶段；freeze 持有期 drain 循环每批让位→**`st.appliedSeq` 冻结**（:1249/:1334 `st.appliedSeq=walSeq` 仅 apply 成功推进，:417 仅 apply 成功帧入队→**队列中未 apply 帧不进捕获坐标**、release 后 apply）；fn 临界区内执行→fn 时活 doc==PG@appliedSeq 严格成立。维护帧通道照常（→canary 维护窗 skip）。**`lockProject`（`canvas-doc-update.repository.ts:59-63`，`private`）=per-project xact advisory 锁**——appendBatch（:211）/vacuumReplace（:479）同键（T12 锚）；**advisory xact 锁=事务结束即释放（持锁跨 stage 不可达）**。`readConsistent`=读最新（无 pin）；pin 读可行：`CanvasDocSnapshot @@id([projectId,generation,snapshotRev])`＋`CanvasDocUpdate @@id(...,seq)`；`pruneSnapshots/purgeBelow`（:695/:677）为竞态源（→CanaryPin lease）。
3. **retention 现状**：`RuntimeEvent` 7d/100k 已实装（api 进程 1h setInterval）；`ExecutionInput` 零删除零索引（`expiresAt` 必填）；`ExecutionRequest` `@@index([projectId,state,expiresAt])` 在、终态**幂等返回原值不读 input**（`execution-request.service.ts:309-313`）；`sweepExpired`（**api 侧 ExecutionRequestService 内**，`take:100` 无循环无锁、无生产调用方）。advisory 先例全为事务内 xact 形态。
4. **擦除现状**：删除=五表 FK 级联＋内存终态集＋WS 关连接＋删者 IDB；**入口恰四条**（project.delete/cleanDrafts/template.delete `$transaction([...])` 数组形态/template 路径——**team 解散** `team.service.ts:428-456`：**medias 快照是 teamId 维**（`:452` `where:{teamId}`）＋`team.delete` 级联删 Media 行＋入队 best-effort warn）；admin/user 域 grep 零删除路径。**Redis 公开快照缓存键首段=workId 非 pid**（`video-work.service.ts:46-47` 注释实证：键空间按作品隔离＋`delProcessCacheFamily(workId)` :216 精确删族既有语义；pid 经 `w.canvasProjectId`（schema:1315）映射进 g/r 段；`:144` `videoWork:url:{key}`）。**`GenerationIntent` 内容列**（schema:1487 起）：`resultText @db.Text`/`gestureKey`/`resultRef`/`traceId`。MinIO=aws-sdk/client-s3（GetBucketVersioning/ListObjectVersions/DeleteObjects 面在未用；RustFS versioning 未证）；对象键中段含 pid 不可前缀枚举；`Media @@index([projectId])` 在；media-gc 引用图守卫先例在。**AuditLog 无 projectId 列**（targetType/targetId——schema:640-654；`AuditTargetType` 含 PROJECT）。
5. **机器门影响面**：指标=`*.metrics.ts`→canonical 名单→`--write-metric-names` 同 commit→**涉指标 commit 跑 verify FULL**；标签全低基数禁 projectId；迁移 additive＋immutability baseline `--write` 同 commit；census ⑰（worker 闭包零 `*Controller`）/㉒（env 裸读白名单）；check-collab-health 双端点已采（指标 source 声明归 plan）。

## §2 卡序与裁决

**卡序（v5：ProjectErasureRun 迁移前移解依赖环）**：C1 retention（**前置批=ProjectErasureRun 纯表迁移**——scope 化；C2 skip_erasing 只读行）→ C2 canary → C3 gap-alert → C4 erasure（worker/状态机/介质执行——表已在 C1 落地）。

**R 裁定（v5 全集；R1-R14 承 v4，R15-R18 新增）**：

- **R15 锁模型=持久 fence＋in-tx 检查（P0-3/7 根修）**：**tombstone 行（ProjectErasureRun）=持久 fence**（不是锁——行在即拒绝一切该 scope 写）；**每个 project/team-scoped 写事务**：首句 `lockProject`（同键）→**同事务内查 fence 行**（无行才写——同一事务同一快照，check-then-act 根除）；**DRAINING 只持锁排干在飞事务**（拿锁→等在飞→unload→释放）；**每批删除各自取同键锁**；WS 逐帧缓存与 worker=fast-path（缓存命中=早退，未命中=in-tx 查行——**worker 侧禁 TTL 缓存直查**）。锁共享化=`lockProject` 自 repo private 抽 `project-lock.ts` 单源＋**写锁门禁**（静态扫写路径＋测试态 AsyncLocalStorage 断言无锁写入即抛——机器化，禁人记）。
- **R16 manifest 主载体=data-dir 外部耐久面（v4 误判反转）**：**DB JSONB 主载体被 P0-4 证伪**——恢复「删除前」旧备份时 DB 无擦除行→manifest 随备份消失→re-erase 无从重放；正解=R3-5.5 原建议：**manifest 主载体=data-dir 绝对路径文件**（DB restore 不波及）＋对象存储 `erasure/` 前缀可选副本；**DB 行只作索引**（manifestPath）；恢复脚本扫外部 manifest 目录重放；两者皆失→**诚实披露**（恢复删除前备份=已擦除项目复活——PITR 级残余归服务器窗），**不声称零残留**。
- **R17 erasure scope 化（P0-5）**：`ProjectErasureRun` 增 `scopeType: 'project'|'team'`＋`scopeId`；team 解散=同事务 team manifest＋team-scope tombstone；worker 按 scope 执行；schema 零行断言按 scope 过滤；**禁 `projectId=team:<id>` 哨兵混进项目表**。
- **R18 Redis 擦除=workId 映射（P0-2）**：pid→workIds 经 `VideoProject.canvasProjectId` → 逐 workId 调既有 `delProcessCacheFamily(workId)`（含 meta 键）→ `Media.key`→`videoWork:url:{key}` 删；**禁 `SCAN {pid}:*`**（键首段=workId——匹配零）；断言擦除后 process/meta/url 三类键零残留。
- R1-R14 承 v4（告警链扩展 cron 双网；RuntimeEvent 迁 worker；sweepExpired 循环+SKIP LOCKED；资金行豁免；OpsGate seed＋项目级＋三档＋两阶段读＋人工 ack；withFrozenPrefix 捕获；tombstone-first；collab-smoke cron；版本化 capability detect；CanaryPin lease；N=ceil(active×1.25/24) 双层 SLO）。

## §3 卡设计（v5 增量标注；余承 v4）

### C1 retention-worker（承 v4 三扫面＋v5 两点）

- **前置批**：`ProjectErasureRun` **scope 化纯表迁移前移到本卡**（`erasureId @id, scopeType, scopeId, state, stage, requestedBy/requestedAt, manifestPath, error, attempts, @@unique([scopeType, scopeId])`——re-erase=upsert-reset）——C2 skip_erasing 只读行（解依赖环），C4 落状态机/worker。
- `sweepExpired` **抽共享 `ExecutionRequestRetentionService`**（自 api ExecutionRequestService 抽出——worker 按模块边界注入共享 service 而非 api service）；stuck 口径=**request 侧 `expiresAt`（15min）/deadlineAt**（非 input 侧 30d——input 只按终态过滤）。
- 扫面/锁/指标/告警/红锚承 v4（终态过滤、xact 单飞、循环清空、api timer 移除对拍、FAILED replay 实证、kill -9 续跑）。

### C2 replay-canary（承 v4＋v5 四处）

- **CanaryPin 表补全（P0-1）**：`projectId @id, generation Int, snapshotRev BigInt, pgSeqAt BigInt, contentHash Char(64), hashVersion Int, stateVector Bytes?, expiresAt DateTime`（**TTL 15min＋worker 续租＋过期清扫**——P1-11；`pin_retry_total` 告警）；捕获四要素全落库——worker `readAt`+比对有载体。
- **CollabCanaryCursor 补 `generation`**（vacuum 换代游标重置——否则旧代游标永 skip）。
- **红④断言修正（P1-12，我方 v4 误写反转）**：「先塞 5 帧→进 withFrozenPrefix→**捕获坐标 pgSeqAt 不含**（st.appliedSeq 仅 apply 成功推进：:1249/:417）→release 后队列帧 apply→pgSeq 前进含之」——捕获不含、release 后含（两态双断言）。
- **`canary_capture_ms` 计时＋尺寸阈值**（超限只取 SV+坐标 skip hash——10k doc 单次捕获阻塞预算护栏）。
- 其余承 v4：OpsGate 三档/两阶段读/boot gauge 初始化/frozen_age 分级；skip_lag 连续 3→P0；`doc_pg_lag_seq` 年龄 P0；覆盖 `N=ceil(active×1.25/24)`+last_check_age；smoke cron（**参数化落脚本**：专用账号/固定 canary 项目/单次写入上限/排除计费统计/定期清理/独立 smoke-heartbeat——runbook §14 写明+脚本 flag 承载）。

### C3 doc-append-gap-alert（承 v4＋v5 三点）

- **skip 已删/擦除项目**（无 CanvasDoc/scope 行→skip——擦除后 C1/C4 落地的孤儿行不触发假阳性）；**每 tick 项目数预算分批**；`sum(frameCount)` 与 adopt 重定基**单测钉死语义**。
- 其余承 v4：stateSeq 锚聚合三断言（prune 后零假阳性）、gauge+counter 分工、worker source 声明、缺样本 unobservable 升级、热路径 tripwire 降格、SMS 实弹、runbook 分诊。

### C4 project-erasure（承 v4＋v5 锁模型/载体/scope/键重写）

- **锁模型（R15）**：fence 行＋每写事务 in-tx 查行＋DRAINING 排干释放＋每批删除锁＋写锁门禁（project-lock.ts 单源＋AsyncLocalStorage 测试态断言）。
- **manifest（R16）**：data-dir 外部文件主载体＋对象前缀可选副本＋DB 行=索引；恢复脚本扫外部目录；**残余披露行**（备份轮换窗+manifest 同失→复活——PITR 级归服务器窗，不声称零残留）。
- **scope（R17）**：team 解散=team-scope run（manifest 事务内持久 medias 快照——teamId 维）＋worker 按 scope；入队降加速（失败不丢对象）。
- **Redis（R18）**：workId 映射删族（`delProcessCacheFamily`+url 键）——**红锚**：擦除后 process/meta/url 三类键零残留。
- **迁移笔数勘正**：全批**三笔**（C1：ExecutionInput 索引＋ProjectErasureRun scope 表；C2：CollabOpsGate 哨兵＋CanaryPin 全字段＋CollabCanaryCursor 含 generation；C4：零新表——run 表已 C1 落地）。
- **erasure 指标/claim（P1-13）**：`erasure_runs_total{state}`/`erasure_pending_age`（PENDING>1h P0/FAILED P1）/`erasure_objects_deleted_total`；worker `FOR UPDATE SKIP LOCKED` claim＋attempts/backoff。
- **AuditLog 脱敏判据（P1-14）**：谓词=`targetType='PROJECT' AND targetId=pid`（列已在；可执行断言——需索引则随批）。
- 其余承 v4：内容列 scrub（resultText/gestureKey/resultRef→null）＋列级机器断言、版本化 capability detect（载体分离：本地 MinIO gate 版本化 e2e/CI RustFS 非版本化+分支单测）、介质十项清单、四入口全链红锚、GenerationIntent scrub 测试、资金行计费列存活断言。

## §4 机器门与登记影响面（批级）

承 v4＋v5：迁移**三笔**（immutability baseline `--write` 同 commit）；指标全集＋`erasure_runs_total{state}`/`erasure_pending_age`/`erasure_objects_deleted_total`/`canary_capture_ms`/`pin_retry_total`（全 `.metrics.ts`＋`--write-metric-names` 同 commit＋涉指标 commit 跑 verify FULL）；env 新键走 env.ts zod＋spec §10 env 块同步＋census ㉒；worker/app module 平铺（census ⑰）；**写锁门禁**（project-lock.ts 单源＋静态扫＋AsyncLocalStorage 测试断言——新增登记面归 plan）；doc-gate：本 spec 入语料。

## §5 确认点（批流程门）

1. **本 spec v5 确认门（当前）**——与 plan v2 联合呈报（P0 四件已回流 spec；plan v2 同步终稿）。
2. plan 确认门（v2）。
3. 逐卡 subagent-driven 双评审。
4. 批末出口门：四卡闭环＋charter 四项 passed＋`check-production-charter` PASS＋verify:full 全绿＋registered red=0→呈报「改档前置就绪」；服务器窗与 `trafficTier` 改档留用户指令。

## §6 外审驳回/修正登记（四轮存档）

| 项 | 轮 | 裁定 | 理由（实证） |
|---|---|---|---|
| T0 统一 ProjectLifecycle | R1 | 驳回 | 简洁优先；真实交互点一行守卫；Y2 状态增殖再议 |
| 2h 有界自动解冻 | R1 | 驳回 | 自动解冻=烘焙可疑态违背 fail-closed；frozen_age 分级＋双 backstop |
| 「CI 无 MinIO」 | R1 | 修正 | test job 已跑 RustFS S3（ci.yml:19-61） |
| 「counter reset/心跳缺失」 | R1 | 已存在 | counter-delta 重基线＋heartbeat 停更 P0 判据均在 |
| 「flushThrough 不等队列排空」 | R2 | 修正（承 v3） | withFrozenPrefix :1631 正确屏障；捕获走它 |
| 「hash/重放移出 api 事件循环」 | R2 | 部分驳回 | Y.Doc 不可跨进程转移；api 有界捕获＋尺寸阈值 |
| OpsGate 5s 读缓存 | R2 | 驳回 | compact 60s 时间门下可忽略；缓存仅 WS fast-path |
| 「admin/账号删除入口须核」 | R2 | 已核不存在 | admin/user 域 grep 零删除路径；入口恰四条 |
| `@unique(projectId)` 改 active 部分唯一 | R2 | 修正 | re-erase=upsert-reset 同行复用 |
| manifest 当删除源 | R2 | 采纳 R9 | 删除源=DB 行＋Media 驱动；manifest=证据+恢复重放源 |
| S3 前缀中段通配 | R2 | 采纳 | Media 行驱动＋孤儿兜底扫 |
| captureAtSerial/barrier 新原语 | R3 | 驳回（R11） | withFrozenPrefix :1631 已是正确屏障；复用非重造 |
| P0-2 方案 B（活态字节落对象存储） | R3 | 驳回 | pin lease 已消除竞态 |
| **manifest 主载体=对象前缀** | **R3** | **v4 误判→v5 反转（R16）** | **v4 改 DB JSONB 主载体被 R4 证伪**（恢复删除前备份=DB 无擦除行→manifest 消失）；R3-5.5 原建议=正解（data-dir 外部耐久面主载体）；**我方两轮反复的勘误登记** |
| RustFS 上直接测版本化 | R3 | 采纳（载体分离） | 本地 MinIO gate 版本化 e2e；CI 非版本化+分支单测 |
| R3 其余（4×P0+6×P1） | R3 | 全采纳 | 落 §2 R11-R14＋§3 各卡＋§4 |
| **CanaryPin 缺比对字段** | **R4** | **采纳（R15 前置）** | **Pin 表补 generation/contentHash/hashVersion/SV；Cursor 补 generation** |
| **Redis 键=workId 非 pid** | **R4** | **采纳（R18）** | **:46-47 注释实证+delProcessCacheFamily :216；v4 `SCAN {pid}:*` 匹配零根修** |
| **DRAINING 锁模型矛盾** | **R4** | **采纳（R15）** | **xact 锁事务结束释放；「持锁至删除完成」不可达→持久 fence+in-tx 检查+每批锁** |
| **manifest DB 主载体矛盾** | **R4** | **采纳（R16 反转）** | 见 R3 行反转登记 |
| **team 媒体非 project 维** | **R4** | **采纳（R17）** | **medias where teamId :452 实证；scope 化** |
| **skip_erasing 依赖环** | **R4** | **采纳** | **ProjectErasureRun 迁移前移 C1 前置** |
| **无 FK 写面 TTL 缓存窗** | **R4** | **采纳（R15）** | **worker 禁 TTL 直查；in-tx 检查=保证** |
| R4 P1×10（lockProject private/抽共享/迁移笔数/pin TTL/红④反转/erasure metrics/AuditLog 谓词/smoke 参数/C3 skip/capture_ms） | R4 | 全采纳 | 各落 §2 R15-R18＋§3＋§4；红④=我方 v4 误写反转（:1249/:417 实证） |