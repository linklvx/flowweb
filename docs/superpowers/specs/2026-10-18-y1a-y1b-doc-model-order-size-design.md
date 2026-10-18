<!-- doc-status: active -->
# Y1a+Y1b：doc 模型 v3·序与尺寸/只读（B 类合并批设计）

- **立项日**：2026-10-18；**唯一上游依据**：[2026-10-06-canvas-yjs-arch-upgrade-review.md](2026-10-06-canvas-yjs-arch-upgrade-review.md)（master spec v8.3）§0.2 Y1a/Y1b 两行+§0.1 裁决（D5/D4/E68/C7①③）。
- **B 类合并立项**（Y1a+Y1b——E6 序域与 C5↔D4 同批硬约束共用）；plan=`../plans/2026-10-18-y1a-y1b-doc-model-order-size.md`（**v10.1——十一轮边界收口后当前执行版**；T0-T28/9 片）。
- **用户立项三澄清（2026-10-18 一轮）**：①单 spec 单 plan+多段片序（每片出口=用户确认点）；②收敛 harness=内存双端基底+期望序断言+真连集成；③UI 变更面=「可接受变更清单+签字」（§0.2-⑥）。
- **修订链**：
  - v2～v10：历轮沿革全文见 git 历史（ee41624f/feeef2a6/816078ca/14d28d8b 等）。v9 四裁决（media 读模型/artifactState 双轨/复合单键改口/slot 化）与 v10 接缝收口（exec 分档/ArtifactCommit/fileId 第一步）为本版基线；**v10 裁决③ repairRev 被本版推翻**。
  - **v11（十一轮·三份 v7 外审高度收敛+三并行核验坐实+挖出三个现存代码 bug+四用户裁决——2026-10-18）**：方向维持；本轮把三个新面收敛为**单一代际/单一 epoch/单一事务**。**四项裁决（2026-10-18 八次确认）**：
    1. **repair 换轨方案 A：repair=一次 generation 跳变的 doc rewrite**（推翻 v10 裁决③——repairRev 三致命缺口实证：客户端 URL 只 csv/cb **无自报 rev**；doc-status dedup=`${state}:${frozen}`+客户端 `msg.rev<=last` return **rev 变化被吞**；repair 不改 SV **preVacuumSv 检测不到**）：repair 复用 vacuum 全套（beginVacuumEra 冻结+4410 close→quiesce〔writesSettled 覆盖服务端 outbox 写〕→离线重排→**单事务 vacuumReplace**〔state+preVacuumSv+generation+1+删行+同键 advisory lock〕→guardSyncFrame **内容级 fence**（旧客户端 SV 覆盖重排前历史→4410 doc-generation-stale）→consumeGenerationJump 单链（clear undo→导出→purge→reload）→IDB 四维键天然联动）；等价断言=**忽略 order|slot 的节点/边/内容等价**；ack 降 UX 提示非正确性门（超时照常 close 不中止）；与 vacuum **共享 vacuumGate 互斥**（不另起 repairingDocs）；**repairRev 删除**（`doc-status` 可带 `epochReason:'vacuum'|'repair'` 审计字段）；**purgeForeignCaches 反语义 bug 同批修复**（purgePidCaches 全代删+真 IDB 测试——现状保留脏旧代删其他代）。
    2. **全局单调 execSeq=唯一执行代际+三硬约束**（反例 A 同 job stalled 重排/反例 B 新 intent 被旧终态挡/反例 C 旧 error 覆盖新 loading 三实证）：①`execSeq BigInt` 由**同一 DB sequence 的 nextval 分配**（new claim/同 jobId 重入/rearm 三处），禁行内 increment/max+1；DB BigInt，**wire/doc 用 string**（Yjs/JSON 精度），守卫 BigInt 比较；②execSeq 进 exec 守卫/finalize CAS/唯一键+**job data+onTick/reanchorDeadline+reserve/reservedExecSeq+void_/settle 的 CAS**；**同 job 重入在 claim 事务内把 reservation 继承/转移给新 execSeq；旧 execSeq 的 void/settle 一律失败**；③attempts 保留免费重试配额语义（≥3 EXHAUSTED）不与 execSeq 混用。
    3. **producer 分两层=一个 Media 写入服务+两个编排器**（非资金 producer 零 GenerationIntent 实证——统一 ArtifactCommit 模型不成立）：**MediaRegistrationService=唯一 Media 写入点**（register/generated 与 confirm/upload 两形态共用 sniff/MIME/quota/probeState/natural 初始化；提供 registerInTx/confirmInTx/bindInTx，**禁止第二处 media.create/bindMedia**）；**ArtifactCommitService=资金五路径**（text/image/video/edit/lighting——finalize 事务内调 registerInTx+execSeq CAS+settleInTx+complete+DocDelivery）；**非资金六路径**（upload confirm/stitch/trim/separate/copy/export）走 MediaRegistration（只建/确认 Media+MediaBinding+attach consumer 交付，**不碰 settle/complete/DocDelivery/exec**）；非资金幂等锚 `registrationKey=taskId+artifactIndex|mediaId|exportRequestId`+`Media @@unique([bucket,key])`；非资金零 doc 写（worker 只写 DB；完成通知由 API 侧发——WorkerEmitPort no-op 实证）；**不造 creditCost=0 的 GenerationIntent**（占 NodeBusy 互斥/被 reaper 判龄/污染 attempts/settleStranded 语义）；两层只共享 Media/linkMedia 底层原语**不共享资金事务**。
    4. **DocDelivery 持久化=typed flush+批量+复核**（withSession 写后 debounce 未落库实证——mark delivered 撒谎）：`withSession(write)` 增 `flush:true`+持久化层 `flushDocument(pid): Promise<'appended'|'noop'|'spooled'|'terminal'|'failed'>`（走 storeDocumentSerialized/saveMutex）；**只有 appended（或 noop∧isPersistedComplete∧目标已匹配）才 mark delivered；spooled 不是 delivered**（PG 才是 canonical）继续 retry；按 project 批量（同一批 delivery 一个 withSession 内 apply，全部 apply 后**一次 flush**；superseded/orphaned 直接终态不 flush）；flush 成功后**复核 target/execSeq/expectedValue**（用户替换/新 exec→superseded；节点删→orphaned；匹配才 delivered）；lease 覆盖 flush+recheck+mark；PG 故障/spooled **不消耗 maxAttempts**（告警+退避）；delivered=PG 持久化至少一次非客户端收到（emit 在 mark 后）；禁 withDoc unloadImmediately 逐条 flush。
  - v11 同批收编（核验坐实）：**锁序契约 20 强制**（finalize=先 lockBalance(TeamBalance) 再 CAS GenerationIntent——与 reserve/settle/void/rollback 一致，否则 ABBA 死锁）+**InTx 方法族**（completeInTx/settleInTx/createXxxInTx——complete 现走根 prisma/settle 自开事务的"单事务"名不副实根修）+finalize 幂等检查在事务内 CAS 之前+死锁 40P01 有界重试；**唯一键全带维度**（execSeq/artifactIndex/targetItemId——稳定 ImageItem.id 非 index〔删除/重排按 id 现算实证，targetIndex 会漂移〕）；**对象 key=`artifacts/{teamId}/{intentRowId}/{execSeq}/{index}-{sha256}`**+If-None-Match 条件写+finalize 前 hash 校验+orphan sweep 按前缀+龄阈值；**旧 reconcile 三后门删除**（backfillSucceeded 直接置 SUCCEEDED/threeCheck resultRef 判成功/settleStranded probeArtifacts→**不变量巡检**：SUCCEEDED⇒artifactState=stored∧Media 存在∧settled，违反告警人工处理不自动退款）；**rearm 事务**=execSeq nextval+reservation 继承+旧 DocDelivery/MediaBinding superseded+**资金归一化**（残留冻结 voidInTx 或 typed 拒——现状"rearm 后 mayCall:false 静默跳过外呼"现存 bug 根修）；**worker 写端点 op 白名单 exec-only**（writeNodeData 的 fileId/resultUrl 服务端 manifest 拒写——Yjs 客户端直发 update 仍可写，登记 guard/post-apply=Y1 面内 post-apply 检测）；**MediaFactOutbox 表替换 probedAt watermark**（factVersion 单调/pending 行+FOR UPDATE SKIP LOCKED/probe·server-natural·attach 三写入点/来源 union(Media.projectId, binding.projectId)/重启零回放/correction 必达/emitter 单实例假设显式化——instances:1 钉死，多实例归 Y7）；**MIME 安全升级**（file-type 库+**API 代理流式 `GET /api/media/:id/content` 按 sniffedMimeType 设 Content-Type+非白名单 attachment+CSP sandbox**+presign Content-Type 条件+SVG 拒+图片 sharp 重编码剥载荷+Media.size BigInt〔Int 2GB 上限〕+**生产上传 /flowai 渗透修复**〔mediaUploadUtils:31 dev 假设改写相对路径——生产 MinIO 直连下上传通路无背书〕）；probe（**40MP+downscale 产品策略**/视频 batch=1 lease 5min/nextProbeAt 带 jitter/claim 按 sniffedMimeType 路由/索引 [probeState,nextProbeAt]）；text 90 天（cleanTerminalIntents 对 resultText 非空行延长）；exec error reconcile 补**活跃项目过滤+24h 窗**；attach=只填空/replace=显式命令二分；观测+8 指标；**每卡真 PG 并发用例**（A3 不够早——锁序/双 claim/崩溃窗必须单卡内真 PG）；**交付 owner 唯一**（资金型=DocDelivery 唯一交付 outbox；MediaBinding 对 sourceIntent 非空**跳过 fileId 写**只做媒体库关联）。
  - **v12（十二轮·三份 v8 外审攻击三接缝〔finalize 状态机/三 poller 协调/A1-execSeq 交界〕+四路并行核验〔执行链/持久化/共享面/plan 文本〕——9 P0 坐实+8 P1+6 误判过滤+四用户裁决〔2026-10-18 九次确认〕；v11 四裁决方向不动）**。**四项裁决**：
    1. **同 jobId 重入复用 execSeq（推翻 v11「nextval 三处+reservation 继承/转移」）**：BullMQ stalled 同 jobId 重入=**同一执行段续跑**——复用当前 execSeq、**不动 reservation**（重入者经 reserve 见 reserved>0→mayCall:false 静默 skipped〔team-credit:102 现状故意语义——同 intent 双 worker 只烧一次钱〕；旧 worker finalize 照常匹配交付；旧 worker 真死归 reaper→rearm 闭环）。**分配收敛为两处：new claim/rearm**；rearm 事务=nextval+**voidInTx 旧冻结（release+re-reserve——新 worker 重新走 reserve 拿 mayCall:true）**+旧 DocDelivery/MediaBinding superseded（替代「继承」——继承后新 worker mayCall 未定义=bug 换壳：B 拿新 seq 后 A 的 CAS 失败∧B 不外呼→悬挂）。
    2. **video 即时 finalize（kind 分支）**：video=provider 成功即 finalize（settle+complete+DocDelivery kind=videoUrl 交付 videoUrl——**无 Media 行**）；下载→MinIO→Media→fileId=**非资金续段**（ai-download 迁 MediaRegistration+attach consumer 交付）。**不变量按 kind 分化**：image/edit=SUCCEEDED⇒stored∧Media∧settled；video=SUCCEEDED⇒videoUrl 已交付（Media 后补——巡检豁免 Media 项）；text=SUCCEEDED⇒resultText∧settled（无 Media——kind=text 跳过 registerInTx）。现状时序实证：videoUrl 先行（execution:513-517 resultRef=URL）+Media 后建（ai-download:100）。
    3. **copy 清锚（零新列）**：copy/clone 复制 MediaBinding **必须清空 sourceIntentRowId/sourceExecSeq**（资金已结清在原件——副本非资金产物）+新 registrationKey；**attach claim 条件加 sourceIntentRowId IS NULL**（资金原件 binding 永不进 attach 队列——v11「资金型跳过 fileId 写」的 claim 面收口，消除 v8「binding 复制维持 v10」与「资金型跳过」的矛盾：不清锚副本永无 fileId 交付者=空图）；**normalizeCopiedNodeData 单函数**（copyPlan/seed/clone 五路径共用：status loading/error→idle〔red：copyPlan:63 structuredClone 连 loading 都复制=副本永久转圈〕/身份键 binding 复制成功才保留否则 strip/exec 永不复制/cells 删）。
    4. **资金 quota=软限**：finalize **不因 quota 回滚**（钱已付 provider——产物不能 un-生成）；超限=告警+计数（artifact_quota_exceeded_total）+下次上传/非资金路径硬拒；registerInTx **禁调 assertOnConfirm**（storage-quota:37-49 超限删 MinIO 对象+删 Media 行——事务内副作用不可回滚）+**禁外部 IO**（sniff/HEAD/hash 全事务外，事务内只写 DB——防拉长 TeamBalance 锁持有）。
    - **9 P0 收口**：①**EXEC_STATUS_KEYS/ExecStatusPatch 加 execSeq: string**（manifest:90 现状无 execSeq——不进键集则 writeExecStatus 带 execSeq 直接 UNKNOWN_KEY，代际围栏在门口死；旧条目 docSchema v3 拒载不做 0 兜底）；②同 job 复用（裁决 1）；③copy 清锚（裁决 3）；④**StoreOutcome 判别联合先行重构**（storeDocumentUnlocked 现状 boolean——appended→true，noop/spool 成功/spool 失败/FK/fenced **五分支混一个 false**〔persistence:235/:283/:287-395/:308-336/:323-328〕；flushDocument 五态必须以 StoreOutcome 为载体，禁旁路猜 hasFrames/persistUnhealthy；withSession(flush:true) 只 delivery/attach 两消费面）；⑤**stripServerOwnedData web 单点无条件挂全构造点**（diff dataPatch〔canvasIntents:502 全键差异——快照窗口跨远端 apply 时服务端写的 fileId 被 diff 判为"变化"经 WS 发回〕/addNode.data〔:462 全量〕/copyPlan/paste/undo 恢复——服务端 manifest 拒写降第二道；「未修改才不回送」措辞废止）；⑥text/video kind 分支（裁决 2）；⑦**唯一键补维度**：MediaBinding `@@unique([mediaId,projectId,nodeId,role,targetField,targetItemId])`、DocDelivery `+targetField,targetItemId`、**MediaFactOutbox `@@unique([mediaId,projectId,factVersion])`**、targetField 词表补 **videoUrl/resultUrl**（现状 fileId|referenceImage|images|allImages——video 交付无处落）；⑧**If-None-Match 废止**（MinIO 不支持条件写——presign POST policy 表达不了）→key 含 sha256（已有）+**x-amz-meta-sha256 上传元数据+finalize HeadObject 校验**+orphan sweep 维持；⑨**pendingFacts**（fact 可先于 fileId 到达——「忽略未知 mediaId」=丢 natural 到下次重连）：客户端短 TTL Map（fileId 到达即消费）+delivery/attach mark 成功后对该 mediaId lazy GET media-facts 补拉。
    - **8 P1 收口**：重试码补 **55P03**（lock_timeout 抛 55P03 非 40P01）+P2024（pool timeout）有界重试；MediaRegistration 第四形态 **prepareUploadInTx**（presign pending 创建——storage:37）+**11 处 media.create 全映射表**（storage:37/media-process:194/ai-download:100/ai-image-edit:199+200/lighting:167/video-trim:110/stitch:97/generated-media:54/video-work:91——全部可映射四形态，G43 为迁移终态门禁）；幂等前置判据=**FOR UPDATE 下 intent 行状态**（SUCCEEDED∧stored∧creditsConsumed=cost→幂等返回+补建缺行——非仅 Media 存在）；**attach/delivery per-project 进程内互斥**（串行化 apply+flush+recheck+mark——单实例+共享 Y.Doc+saveMutex 下正确性本无虞，纯成本优化）；repair 等价断言含 **exec 根值等价**（vacuumEquivalent 现状只比键集合 registry:655-663——repair 重建必须深拷贝 exec）；attach lease 覆盖 flush（180s）+两 poller **onModuleDestroy**（停 claim/等在飞/释放 lease）；**fail/touchHeartbeat/reanchorDeadline 补 execSeq 维度**（generation-intent:230/:248/:265 现状只守 status——旧 worker 可刷心跳/杀新 attempt）。
    - **误判过滤（六条，防复入）**：attach/delivery DocWriteCoordinator「正确性 P0」不成立（两 poller 写同 project 同 Y.Doc〔共享 residency 池〕+saveMutex per-doc+flush 排空全队列——"delivered/superseded 抖动"推演不成立，降 P1 互斥）；零费 settle no-op 分支多余（已裁决不造 creditCost=0 intent）；P2002 事务内 catch 驱动分支多余（lockBalance 串行同 team 并发 finalize，P2002 到不了——ON CONFLICT 兜底即可）；「grep 零第二处会红」=迁移目标非现状断言（11 处是迁移对象）；fillDoc 逐键写=已覆盖（A1/T15 本就重写写链）；outbox 单 projectId 漏 fanout=已覆盖（attach 按 binding.projectId 补插行——真缺口仅唯一键）。
  - **v13（十三轮·三份 v9 外审生产级评审〔机制通过/执行驳回×2+方向详审〕+三路并行事实核验+三份六点裁决报告终裁——2026-10-18 十次确认）**。**六项裁决（推翻 v11 裁决①〔repair generation 跳变〕与 v12 裁决②〔video videoUrl〕；裁决④ copy 清锚/attach 交付链整体废止）**：
    1. **video 不交付 videoUrl——`Media(status=processing)+fileId`**：provider 成功即 settle+finalize（资金流与 v12 零 delta——只换交付载荷）；finalize 事务内建 Media 行（status=processing+sourceUrl 专用列〔provider 源，**禁入 metadata**——media-batch 整行 spread 会泄漏〕+预分配 key+provider 声明 mimeType）+DocDelivery(kind=fileId 交付 mediaId)+settle/complete；**materialize 异步**（自有 processingLeaseUntil/processingAttempts 退避——与 intent attempts/rearm 彻底解耦：存储抖动不污染资金/交付状态机）；完成→单事务 status=completed+size/sha256/sniffedMimeType+probeState 推进+factVersion/outbox；**终态失败→幂等补偿退款+artifactState=failed+告警**（不落人工工单）；processing 期 content proxy 两态：ready=对象流+Range/HEAD/ETag；processing=allowlist 流式代理 sourceUrl（no-store+maxContentLength 上限+超限降级占位 410/425+Retry-After）；**targetField 词表删 videoUrl/resultUrl；DocDelivery kind 收敛 `fileId|text`**；统一不变量 `SUCCEEDED⇒settled∧DocDelivery(kind=fileId)∧Media 行存在∧status∈{processing,completed}`（image=finalize 时已 completed；text 唯一显式例外——kind 分支从两套不变量收敛为一条+一个例外）。UI 适配实证：ImageGenNode:70/VideoGenNode:51 本就走 useMediaUrl(fileId)，videoUrl/resultUrl 是无消费者历史残留。
    2. **repair=in-place 主路径**（推翻 v11 裁决①/Z4''——**preVacuumSv fence 挡不住从未同步的离线客户端**实证：registry:689-697 只拒「clientID∈preVacuumSv∧clock≥pre」，quota-gate.spec:497 明确放行新 clientID→离线 IDB 未同步 update 重连合并=节点复活/旧键回写）：维护门（CollabMaintenance 行+与 vacuum 共享互斥）→对全部连接 applyWriteFreeze（**不 close 不 reload 不清 IDB**——秒级窗口）+新连接只读+DocDelivery 消费者维护门 503 退避→writesSettled→纯函数修复计划（按层 (oldOrder,id)+带间隙新键+去重）→withSession(write, MAINTENANCE_TRANSACT_ORIGIN) **分块 ≤64KB apply**→回读校验（无重复/无环/无孤儿）→解除 readOnly；幂等可重跑（崩溃→maintenance 行 stale→aborted→重跑）；**帧预算预演**（scratch doc encodeStateAsUpdate 预算——超 256KiB 或不可表达结构才退 vacuum）；**vacuum 兜底仅限「确定无离线客户端」运维窗**（无 generation 握手前提下不得作自动回退——A 条件句；**连接代际握手登记 Y2**）；等价断言维持「忽略 order|slot 的节点/边/data/exec 值等价」；purgeForeignCaches 反语义 bug 修复维持（仅 vacuum 兜底路径关联）。
    3. **copy=方案二+**（推翻 v12 裁决③ copy 清锚+attach 交付链）：**strip 只对更新不对新建**（updateNodeData/updateConfig/diff/undo 回放剥客户端禁写键——快照窗口跨远端 apply 回退服务端键的真实 bug 面；**addNode/copyPlan/paste/multiImage explode/addImageToStoryboardCell 保留 fileId/images[].id**——新建携带本就是用户可见 media id，保留即渲染，消灭空图窗口）；normalizeCopiedNodeData 收窄（status loading/error→有 fileId 则 done 无则 idle/清 errorCode/删 url/exec 不复制/cells 派生）；**binding 服务端惰性 reconcile**（post-apply guard/周期扫描 mediaRefsOf 七键→校验 Media.teamId===project.teamId〔跨 team 拒+计数〕→幂等 upsert MediaBinding〔清 sourceIntentRowId/sourceExecSeq 锚+attachState=attached〕——零客户端调用/零新端点/离线 paste 天然覆盖/跨项目同 team 自然成立）；跨 team paste=客户端 strip 身份引用+服务端不建 binding+读 ACL 403 兜底；**Media GC 加 doc 引用检查/grace period 护栏**（防副本还在媒体被删）；**attach consumer 整建制取消**（两大存在理由消灭：video 续段〔裁决 1——fileId 已在 finalize 交付，materialize 不写 doc〕+copy 再交付〔本裁决〕）；**交付 owner 收敛为单一 DocDelivery poller**（非资金路径需写 doc 者〔trim/stitch/separate 等〕并入 kind=fileId 无资金字段——plan 重写期逐点 grep 实证）；MediaBinding 降级纯索引（惰性 reconcile 维护）；v12「attach claim sourceIntentRowId IS NULL/copy 清锚交付/sourceRegistrationKey」整套补丁废止。
    4. **reconcile=R3 幂等 finalize 自动收敛**（推翻 v12「告警人工不自动退款」一刀切）：所有自动收敛走 `ArtifactCommit.finalizeFromExistingArtifact(intentId,execSeq)`（同一幂等 finalize——CAS+补建缺行）——动作表：SUCCEEDED∧Media/artifact 存在∧未 settle→finalize 补 settle+DocDelivery；RUNNING∧provider task 成功∧artifact staged→finalize（provider 不重调）；SUCCEEDED∧DocDelivery 缺失→补建；FAILED/VOIDED∧reserved>0→voidInTx（幂等）；SUCCEEDED∧Media(processing) 源过期/终态失败→重试 materialize→超限 refund+artifactState=failed+告警；delivery failed（node 删/project gone）→orphaned+幂等退款；delivery failed（未知/基础设施）→重试上限→dead+告警不自动退款；**台账不变量/对象缺失/无法判定→告警人工绝不自动动钱**；护栏：每行 CAS+有界尝试（3 次 jitter）+pg_advisory_xact_lock(hashtext(intentId)) 防并发双 reconcile+审计行 reconcile_action{intentRowId/action/before/after/traceId}+auto_converged/manual_required 分计数；**backfillSucceeded 禁写 SUCCEEDED+null**（现状 :224-227 无条件置——stalled 重入 skip→ack→reaper backfill 谎言链根修）。
    5. **guard/strip=检测/诊断/可修复（shadow 起步）；安全边界=读侧 ACL**：**assertMediaReadable(mediaId,userId) 单门**（覆盖 url/batch/content/facts/thumbs/snapshot 注入全读面——现状散在 media.service:15-43/media-batch:19-31/by-key 例外；校验=项目成员+Media.teamId===project.teamId；公开页按已发布 workId 授权不按 mediaId〔IDOR〕）；**meta.schemaVersion 例外硬删+重连**（DoS 防护——现状 manifest:105-110 writers 仅文档约定，客户端改 meta.schemaVersion=2→ensureSchemaVersion throw→项目被 viewer 永久 brick；**shadow 档也删**）；键集单源两集合四处共用导出常量：SERVER_WRITABLE_DATA_KEYS（**含 content**——否则 text 交付 UNKNOWN_KEY）/CLIENT_FORBIDDEN_DATA_KEYS（不含 content——文本正文客户端本就要编辑）；T20 验收从「拦住」改「检测到+可修复+读侧拒绝」；写端点 op 白名单（服务间授权）维持拒绝验收。
    6. **R2 大重构登记 Y2 立项候选，本批零代码**（Artifact 一等表/mediaRef typed-ref/去 fileId 所有权/多实例协调〔并 Y7〕+触发条件：一 intent 多产物/跨项目 media 引用/API 实例>1/doc schema 变更>1 次/季）；**双 bump 保留**（csv/docSchema bump 3 照做——生产 epoch 14 在线，旧 tab/旧 bundle 混跑窗真实；csv 门机制已存在，bump 成本两常量）；**fileId 命名保留**（mediaRef 归 Y2——现在改名零行为收益全 web 重刷）。
    - **四分叉裁定**：video settle 时机=provider 成功即 settle（否「ingest 后 finalize」——**故障域隔离**为决定性理由：materialize 重试与 intent attempts/rearm 解耦，MinIO 抖动不阻塞不回滚资金/交付；补偿退款路径 rollback 族已存在）；双 bump=保留；copy binding=服务端惰性 reconcile（否 links API/客户端 best-effort）；**StoreOutcome 窄接口先行**（推翻 v12 P0「判别联合先行重构」——flushDocument 以 ephemeral flush+isPersistedComplete 三态 `persisted|not-persisted|terminal` 承载交付判定+spoolDeadline 1h 兜底；五态判别联合降后续独立硬化卡——persistence 是 BOI 契约最密集文件，窄接口已足承载「spooled≠delivered」语义）。
    - **残余 P0 十三条（不因六裁决消失，写码前必须处理）**：①rearm **只释放不重冻**（v12「release+re-reserve——新 worker 重走 reserve 拿 mayCall:true」自相矛盾：team-credit:105 reservedCredits>0∨creditsConsumed>0→mayCall:false——rearm 内 re-reserve 后新 worker 必被静默跳过；修法=rearm 只 voidInTx 释放，re-reserve 留给新 worker reserve）；②execSeq **进程内贯穿**（job data 不带——controller:68-78 enqueue 时无 claim 不可得；DB 为唯一权威）+**同 job 重入三态**（旧 worker 心跳新鲜→skip；过期→接管新 execSeq fence 旧代；未知→抛可重试——「skipped 后成功 ack」废止：现状 job 被 ack→reaper backfillSucceeded 谎言链）；③**providerTaskId submit 后落库**（schema:1014 列在〔Z69〕但全仓无写库点——api-caller 只返回/generation-intent 只有注释）+query-first 重入+Idempotency-Key（intentRowId:execSeq）+**ArtifactCommit/MediaRegistration 置 shared module 双 role DI 测试**（生产 API manualRegistration:true 不消费队列——app.module:71；worker 是真实调用方）；④读 ACL 单门（裁决 5）+**storage.presign 补 projectId**（storage:38-50 create data 无 projectId——上传媒体 binding/facts/IDOR 归属全空）；⑤**非 additive DDL=rebuild cutover runbook**（execSeq NOT NULL/size Int→BigInt/docSchema v3 均非 additive——deploy.sh:129 check-migration-additive 会红，--rebuild-db 走 DROP SCHEMA：pg_dump/MinIO 备份+队列 pause+双进程停机顺序+回滚=restore）+**BigInt toJSON 全链**（storage-quota:16-30 agg._sum.size 算术/storage.service:85 Math.abs/media-batch:22-31 整行 spread/material.service:51-57——BigInt.prototype.toJSON+四读路径序列化测试）+**CI 加 S3 兼容服务**（现状无 MinIO——MIME/presign/Range 零 CI 覆盖）；⑥**targetItemId 非空 sentinel ''**（PG 唯一约束对 NULL 不去重——最常见的单图绑定恰在幂等键上失效；MediaBinding/DocDelivery 两处）；⑦meta 硬保护+键集单源（裁决 5）；⑧**confirmInTx+pending CAS**（现状 storage:69-99 无事务无 status='pending' 守卫——并发双 confirm 可都过配额；配额判定前移 presign/claim）；⑨**用户 replace vs delivery 竞态**：DocDelivery expectedValue CAS（或 fileIdRev 单调计数）——applyWriteNodeDataToDoc 现状无条件 set（document:286-300），用户在飞期间手动替换被旧代 delivery 覆盖；⑩**DOC_NODE_KEYS 契约表钉死**（envelope 7 键+order/slot 判别语义单源；slot=派生单实现禁两可）+compareExecSeq 单源（BigInt 解析+lint 禁裸比较+非法 string drop 不 0 兜底）；⑪**outbox at-least-once**（「重启零回放」断言废止——崩溃窗必然重放；改「零丢失+客户端 factVersion 幂等去重」+dead/retention+spoolDeadline）；⑫**SSRF SafeRemoteFetch**（ai-download:62 axios.get 无 host 校验/重定向限制/大小上限——https+allowlist+私网 IP 拒+maxRedirects:0+流式限长+content-type 白名单）；⑬**file-type pin 16.x 或自研 magic sniff**（≥17 纯 ESM vs tsconfig commonjs——ERR_REQUIRE_ESM）。
    - **附加修订**：quota claim 前预检（usage+estimatedBytes≤limit——AI 生成不走 presign assertCanUpload，软限=无限超配额）；media.create 门禁改 **grep census**（9 处非 11——ai-image-edit:199+200 同一调用续行；排除 seed/test）；C0b 片出口加**提前 soak 一轮**（不待 T28）；**开工前三实证**（生产 nginx -T 核 /flowai location〔改 /flowai 面前必做——web 24 处/15 文件改写面远大于 v9 所列 2 文件〕/check-migration-additive 对本批 DDL 实判/CI S3 服务到位）。
  - **v13b（十四轮·三份 v13/v10 第二轮复审+四断言亲验坐实——2026-10-18 十一次确认；v13 六裁决方向全部维持，本轮=边界收口）**。**方向重申（三报告重提项全部维持原裁决）**：video fileId 随 finalize 交付（否「ingest 后交付」——失败路径改写 doc errorCode=MATERIALIZE_FAILED 而非撤回交付；不变量加 failed 合法终态）；dual bump 保留（第三次重提第三次拒绝）；DocDelivery funding-only（否 source 泛化）；vendor/四曲线维持（第二次拒绝）；orderEpoch 拒绝（离线旧 order 键回写=读侧 (order,id) 稳定+重复键可容忍下次 repair，v13 已写明）。**v13 落盘遗漏修正（本版主因）**：
    1. **非资金 DocDelivery lane 删除**（亲验：doc 写点仅 ai-download:85/:118+lighting:214+ai-image-edit:232 全资金路径；stitch/trim/separate 只走 emit 族 emit.port:62-86 零 doc 写，结果由客户端写 trimmedFileId 等）——**DocDelivery 保持 funding-only，intentRowId/execSeq 非空**；将来确需非资金服务端写 doc 时建独立 DocCommand 表（sourceKey 唯一/intent 可空/自由词表），不污染 DocDelivery。
    2. **ArtifactState 补 materializing 四态** `{none materializing stored failed}`：image/edit/lighting=stage 后 stored；video=finalize 时 materializing→materialize 成功 stored/终态失败 failed；text=stored（resultText 非空）；**finalize 幂等判据改 `SUCCEEDED∧artifactState∈{materializing,stored}∧creditsConsumed=cost`**；统一不变量改 `SUCCEEDED⇒settled∧DocDelivery(fileId)∧Media 行存在∧status∈{processing,completed,failed}`（**failed=合法终态**：`status=failed⇒幂等补偿退款+artifactState=failed`；delivered 只表示引用已写不表示字节存在——video 統一不变量不再用一句 status∈{processing,completed} 掩盖 artifactState）；R3 对 materializing 的动作=**重试 materialize 非补 finalize/退款**。
    3. **stage durable 化（Media(processing)=统一 stage 句柄）**：stageInTx 短事务（不锁 balance）先落 `Media(status=processing, objectKey/sha/size/sniff 已知字段, sourceIntentRowId/sourceExecSeq/artifactIndex)` ON CONFLICT DO NOTHING 幂等返回 mediaId→对象上传→finalize 只做状态提升（image 系转 completed+插入 DocDelivery/settle；video 保持 processing）；崩溃在 stage 后=R3 可凭 processing 行收敛（图片直接 finalize；video 走 materialize）——**消灭「对象在 DB 无记录」孤儿**（orphan sweep 以 stage 行为准）；video finalize 建行不 stage 字节。
    4. **同 job 重入 skip→moveToDelayed（BullMQ 正确性）**：心跳新鲜→`job.moveToDelayed(now+lease 余量+grace, token)`+抛 DelayedError **不 return 不 ack**（return=completed→旧 worker 真死则零交付悬挂）；心跳过期→接管（新 execSeq fence）；未知→可重试错误延迟重投；**providerRequestId（UUID）submit 前落库**作 Idempotency-Key，query-first 键序 requestId→providerTaskId→重呼；同步 provider（text 无 task id）显式标注不可 query-first（能力矩阵）。
    5. **strip 键集精确枚举+socket 降级**：`CLIENT_FORBIDDEN_DATA_KEYS={fileId,resultUrl,videoUrl,result,natural,errorCode,fileIdRev}`——**不含 referenceImage/images/allImages/trimmedFileId/videoFileId/audioFileId**（用户上传/任务产物引用，客户端本就要写——上传路径全在更新路径上，键名一刀切会剥掉上传）；**socket `setFileResult` 降级本地 UI 状态不写 doc**（DocDelivery=generated fileId 唯一写入者）；emitNodeStatus 对 video 不传 fileId（现状 :298 传 resultRef=URL→useMediaUrl(URL) 404）；guard 对 generated/uploaded **类型分流**（写 generated mediaId→检测+读 403 计数；uploaded 引用不拦）。
    6. **content 出服务端白名单（亲验 execution:485）**：text artifact 的 content 写入是**用户 prompt 回显**（`data.content||prompt`——值来自用户输入）——删除回显、**text 交付只写 result**；SERVER_WRITABLE_DATA_KEYS 去 content——两键集真正正交（服务端只写生成物/客户端只写用户内容），双写者竞态从根上消失。
    7. **meta.schemaVersion 修复=恢复 current 非删除（亲验 docShape:87-91）**：`sv==null∧有节点→assertDocSchema→throw`——删除只是把「旧档」换成「无戳」两者同拒；guard 修复动作=单事务 `meta.set('schemaVersion', current)`+计数+可选重连。
    8. **fileIdRev token 来源（v13 残余 P0⑨ 补机制）**：节点 data 增 `fileIdRev`（server-owned 单调计数，进禁写集）——DocDelivery 写 fileId 时 +1；replaceMedia 递增；**claim 时读 doc 当前值捕获**（claim 本就装载 doc 做 plan/pricing）→finalize 写入 DocDelivery.expectedValue→apply 时 `currentRev≠expectedRev→superseded`；用户 replace 后旧代 delivery 必 superseded，新 generation claim 捕获新 rev 正常覆盖。
    9. **repair 写屏障+单块预算+advisory lock**：writesSettled 是持久化谓词非写屏障（在飞 withSession 不被门拦）——**per-project RW 锁**（writer refcount++/maintenance 取排他：先置 maintenance=true 拦新 writer，再等 refcount 归零；MAINTENANCE_TRANSACT_ORIGIN 自 bypass）；**帧预算按单 chunk（≤64KB）**——分块下「总量 256KiB 退 vacuum」几乎不可达且自相矛盾，fallback 只留给不可表达结构，总量大就多块；维护互斥加 `pg_advisory_xact_lock('maintenance:<pid>')`（vacuumGate 现状进程内 Promise 链——跨进程保险）。
    10. **multiImage 本批一 intent 一 artifact**：`targetItemId=''` 默认+`artifactIndex=0`，**删「多产物一次事务 N Media」描述**（无 producer——execution:539 单 result.url 实证）；slotId 不可变槽 id 设计随多产物归 Y2（与 R2 登记）。
    11. **consistency pass**：D5/⑨/⑪/⑬/⑭/Z1'' 残句/Z13''/Task24/G53 措辞全部对齐现行口径（历史行标废止）。
    - **P1 收编**：**MediaBinding 删 attach 状态机死列**（attachState/attachAttempts/nextAttachAt/attachLeaseUntil/attachRunId/attachedAt/maxAttempts/lastError——attach consumer 取消后无消费者）+**删「清锚」措辞**（锚在 Media.sourceIntentRowId/intent，binding=纯索引：id/mediaId/projectId/nodeId/teamId/role/targetField/targetItemId/createdAt）；**processing fact 同事务推送**（finalize/stage 建 Media(processing) 时同事务插 outbox fact state=processing——UI「处理中」有推送来源非 425 轮询；materialize 完成再插 completed）；**media-facts GET 500 ids→POST**（500×36≈18KB 超 nginx 8KB header→414）；**MaterializeJob 复用同一次下载算 natural/hash/mime**（免 probe 二次下载 1GB 视频——上传路径才需 probe）；quota claim 预检用 **estimatedSize**（processing 行 size=0 不占配额的洞）；**DocDelivery dead 加 on-load reconcile/admin retry 重驱**（dead 后节点永无 fileId）；R3 `FAILED/VOIDED∧reserved>0→voidInTx` 加「无 artifact/无 delivered」守卫（有交付的失败态交人工）；**finalizeFromExistingArtifact 改名 finalizeFromExistingMediaOrText**（避免执行者找不存在的 Artifact 表）；assertMediaReadable 对 projectId=null 退化为 team member（素材库上传无项目）；providerTaskId 需 adapter 透传链改造（execution call 封装现无该字段+api-caller 已返回）；content-addressed key 的 orphan sweep 覆盖旧 execSeq 前缀（rearm 换代后对象重复）；Media.status 无数据直接 enum（pending/processing/completed/failed）；**T6 拆四卡/T5 拆三卡**（mega-card 难定位难 review）；BigInt 全局 toJSON 维持（DTO 序列化为后续可选）。

## 0.1 本批有效裁决（master 内联+本批 Z'' 系）

| 编号 | 裁决 | 效力 |
|------|------|------|
| **D5** | order 仅同 parentId 层内生效；投影数组序=层序遍历+同层 (order,id)；不设跨层全局序；**MAINTENANCE_TRANSACT_ORIGIN**（withSession origin 参数前置；v13b：repair=in-place 分块写〔RW 写屏障内〕——origin 语义仅 CLI/维护窗内，vacuumReplace 仅运维窗兜底路径） | §2 |
| **D4** | 上传=服务端元数据命令写；生成=落地补一次解码写；视频=受控一次性 bootstrap（`data.sizeMode`）；**媒体事实真源=Media 表（DB）——REST/MediaFactOutbox 推送/快照 join 三出口（Z1''）** | §3 |
| **E68** | 读侧全函数/写侧显式拒绝/禁修复写回 doc 维持 | §2/§3 |
| **C7①③** | 版本协商拒旧（**双常量 bump：csv 连接门+docSchema 数据门——Z9''-v10**）+「排空切换 runbook 进 Y1」 | §6 |
| C5/C6/C5↔D4/D13/E6/E8/E15 | 维持 | §2/§3 |
| **Z1''（v13b 改）** | **media facts=Media 读模型+MediaFactOutbox**：Media 表唯一权威；doc 四根不动；读出口：①REST `POST /api/projects/:id/media-facts/query`（**v13b：GET→POST——500×36≈18KB 超 nginx 8KB header→414**；ids≤200+项目成员**且按 binding/project 归属校验**〔join MediaBinding.projectId ∪ Media.projectId——跨项目 IDOR 拒〕+ETag 短 TTL）②**MediaFactOutbox 表**（`id BigInt autoincrement`/mediaId/projectId/factVersion/**factType**〔v13b：natural|state——payload 分型〕/payload/state pending\|published\|dead/attempts/nextAttemptAt；`@@unique([mediaId,projectId,factType,factVersion])`——并发同版本插重行免疫；**写入点（v13b 改）：probe done/server natural/processing 态创建〔stage/finalize 建 Media(processing) 同事务插 state=processing fact——UI「处理中」推送来源非 425 轮询〕——**同事务插入**；消费=API emitter `state='pending' ∧ nextAttemptAt<=now ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 200`→emit `project:<id>` 房间 `media:fact{mediaId,version,fact}`→published；失败退避；耗尽 dead+告警；**无 watermark——晚提交的行仍是 pending 下轮必达；at-least-once+客户端 factVersion 幂等去重（v13：「重启零回放」断言废止——崩溃窗必然重放；测「重复投递幂等」不测「零重放」）；correction 必产生新 version**；published retention 7d；**emitter 单实例假设显式化**〔ecosystem instances:1——多实例归 Y7 评估 Redis pub/sub〕）③快照/viewer=服务端 join 注入 `RawNode.natural{width,height}`（公开 payload 携带——G28）；web=mediaFacts store（重连/切项目全量拉+按 factVersion 忽略旧+pendingFacts 短 TTL Map——fact 先于 fileId 到达时暂存、fileId 到达即消费+delivery mark 成功后对该 mediaId lazy GET 补拉+切项目清空） | §3.1 |
| **Z2''（维持）** | 四类型链（Raw/Stored/Projected 7+(order\|slot) 判别联合/CanvasStoreNode）+三函数读模型维持 | §2.1 |
| **Z3''（维持）** | DOC_NODE_KEYS 7 键三处接线；NODE_ENVELOPE_KEYS 不动 | §2.3 |
| **Z4''（v13b 重写——in-place 主路径）** | **repair=in-place renumber**：`POST /projects/:id/collab/order/repair`（OWNER/ADMIN，小文档同步 200/大文档 202+jobId+单飞）→执行体：acquire 维护互斥（CollabMaintenance 行+与 vacuum 共享 vacuumGate+**pg_advisory_xact_lock('maintenance:<pid>')**〔v13b 跨进程保险〕）→对全部连接 applyWriteFreeze('repair')（**不 close 不 reload 不清 IDB 不跳 generation**——秒级窗口）+新连接只读+DocDelivery 消费者维护门 503 退避→**per-project RW 写屏障（v13b）**（writer refcount++/maintenance 取排他：先置 maintenance=true 拦新 writer 再等 refcount 归零；MAINTENANCE_TRANSACT_ORIGIN 自 bypass——**writesSettled 是持久化谓词拦不住在飞 withSession**）→纯函数修复计划（受影响层按 (oldOrder,id) 重算+带间隙新键+去重+结构 patch）→**withSession(write, MAINTENANCE_TRANSACT_ORIGIN) 分块 apply（每块 ≤64KB=独立事务，按层/块幂等重跑）**→回读校验（无重复/无环/无孤儿+等价断言=忽略 order|slot 的节点/边/data/exec 值等价——非 order/slot 键零变化）→解除 readOnly+恢复交付→写 RepairRun 审计；**幂等可重跑**（输入=当前层节点集合；崩溃→maintenance 行 stale→aborted→进程重启 readOnly 自然消失→重跑）；**单块预算（v13b）**：fallback 只留给不可表达结构〔非 Map 根/损坏 update log/单节点结构损坏〕——**总量大就多块不 fallback，「总量 256KiB 退 vacuum」废止**；**vacuum 兜底仅限「确定无离线客户端」运维窗**（无连接代际握手前提下**不得作自动回退**——握手登记 Y2；preVacuumSv fence 对未同步离线客户端无效实证）；vacuum 兜底路径沿用 beginVacuumEra/vacuumReplace+等价断言补 exec 值比较+purgePidCaches 修复维持（仅 vacuum 路径关联）；soft(24)/hard(128)/load 病理档 reaper/repair CLI 维持（CLI 默认 in-place，--vacuum 仅紧急）；客户端并发移动在冻结窗口外=per-key LWW 后写者赢（读侧 (order,id) 稳定排序+重复键可容忍下次收敛） | §2.4 |
| **Z5''（维持 v10）** | applyIntrinsicFit=纯函数（store 数据源/display 契约 EXIF 5-8/imageRotation 用户变换交换/分镜跳过/sizeMode/clamp/viewer 纯函数） | §3.2 |
| **Z6''（维持 v10）** | 只读命令门（B1a+七命令补门）+dimensions 分表+resync 三路+节流+闩锁维持 | §3.3 |
| **Z7''（v13 重写——probe 单相+MIME 安全；attach 消费者整建制取消）** | **probe 相（worker——重计算）维持 v12 口径**：claim `probeState IN(pending,running∧lease过期) ∧ status='completed' ∧ sniffedMimeType image/video 非 SVG ∧ deletedAt IS NULL`（MIME 路由用 sniffed）SKIP LOCKED+probeRunId CAS——图片批 4+lease 180s；视频 batch=1+lease 5min；nextProbeAt jitter 指数退避；索引 `@@index([probeState,nextProbeAt])`；confirm 后按 sniffed 重算 probeState；server natural 同事务 done+factVersion+outbox；图片 sharp 40MP+downscale+并发 1+EXIF 5-8；视频 ffprobe 15s+SIGKILL+protocol_whitelist+pin；metadata 只留 codec/duration/bitrate；**MIME 全链维持**：confirm 嗅探对象头（**file-type pin 16.x 或自研 magic sniff——≥17 纯 ESM vs commonjs**）→白名单外拒+删对象+计数→presign POST 增 Content-Type 条件（**须同时把 Content-Type 放进 presign.fields——否则全部 403**）→**媒体消费走 `GET /api/media/:id/content` 两态**（ready=对象存储流式+Range/HEAD/ETag/304+sniffedMimeType+非白名单 attachment+nosniff；processing=allowlist 流式代理 sourceUrl+no-store+maxContentLength 上限+超限降级占位——**安全约束：host allowlist/私网 IP 拒/maxRedirects:0/流式限长**〔SafeRemoteFetch〕；**生产 MinIO 直链禁用**；2C 单机带宽约束——大视频优先 X-Accel-Redirect/presigned GET，代理可降级）→图片 sharp 重编码剥载荷→SVG 拒→**/flowai 面迁移**（**web 24 处/15 文件**改写面——`mediaContentUrl(fileId)` 单点+census 禁再出现改写正则；**改前必先生产 nginx -T 实证 /flowai location 存在性**）→Media.size BigInt（**BigInt.prototype.toJSON+四读路径序列化测试**）；**attach 消费者取消（v13）**：两大存在理由消灭（video 续段=裁决 1 fileId 已在 finalize 交付；copy 再交付=裁决 3 新建保留 fileId）——**交付 owner 收敛为单一 DocDelivery poller（v13b：funding-only——非资金路径零服务端 doc 写实证〔stitch/trim/separate 只走 emit 族，结果由客户端写 trimmedFileId 等〕；将来确需时建独立 DocCommand 表不污染 DocDelivery）**；**MediaBinding 降级纯索引（v13b：删 attach 状态机死列 attachState/attachAttempts/nextAttachAt/attachLeaseUntil/attachRunId/attachedAt/maxAttempts/lastError——仅留 id/mediaId/projectId/nodeId/teamId/role/targetField/targetItemId/createdAt）**：服务端惰性 reconcile（post-apply guard/周期扫描 mediaRefsOf 七键→Media.teamId===project.teamId 校验〔跨 team 拒+计数〕→**create-only upsert（v13b：ON CONFLICT DO NOTHING——绝不改已有行的资金锚；「清锚」措辞废止——锚在 Media.sourceIntentRowId/intent 不在 binding**）；**MaterializeJob 复用同一次下载算 natural/hash/mime 置 probeState=done（v13b——免 probe 二次下载 1GB 视频；上传路径才需 probe）**；attach=只填空语义并入 DocDelivery expectedValue；replaceMedia 显式命令维持（带 expectedValue+**递增 fileIdRev**）；deliverMedia 端点同 team/ImageItem 去 url/mediaRefsOf 七键维持 | §3.1 |
| **Z8''（维持）** | 工厂类型感知+fallbackSize 单函数+happy-path=0 | §3.4 |
| **Z9''（维持 v10）** | 版本门=**双常量 bump 3**（csv 连接门 schema-outdated→handleVersionTerminal 一次 reload；docSchema 数据门旧 doc 拒载+IDB 四维键+Redis 键联动）；DEPLOY_EPOCH 废止维持 | §6 |
| **Z10''（维持）** | collab-doc-ops 纯模块+表驱动校验+switch+never+WriteOutcome 四态（deliverArtifact/linkMedia op 进表） | §3.1 |
| **Z11''（v13b 改——strip 键集精确枚举+socket 降级+content 正交+meta 恢复+fileIdRev）** | **禁写门分层（guard/strip=检测/诊断，安全边界=读侧 ACL——裁决 5）**：①**stripServerOwnedData web 单点——只挂更新路径**（updateNodeData/updateConfig/diff dataPatch/undo 回放剥 CLIENT_FORBIDDEN_DATA_KEYS——快照窗口跨远端 apply 回退服务端键的真实 bug 面）；**新建路径不 strip**（addNode/copyPlan/paste/multiImage explode/addImageToStoryboardCell **保留 fileId/images[].id**——消灭空图窗口〔裁决 3〕）；**v13b 键集精确枚举：CLIENT_FORBIDDEN_DATA_KEYS={fileId,resultUrl,videoUrl,result,natural,errorCode,fileIdRev}——不含 referenceImage/images/allImages/trimmedFileId/videoFileId/audioFileId**（用户上传/任务产物引用客户端本就要写——上传路径全在更新路径上，键名一刀切会剥掉上传=「图不显示」级事故）；**socket `setFileResult` 降级本地 UI 状态不写 doc**（DocDelivery=generated fileId 唯一写入者；现状 :298 emitNodeStatus 传 resultRef=URL→useMediaUrl(URL) 404）；+manifest UNKNOWN_KEY；②（并入①）；③generated fileId=服务端所有权+replaceMedia 显式命令（递增 fileIdRev）+DocDelivery expectedValue=fileIdRev CAS（**v13b token 来源钉死：claim 装载 doc 时读当前 fileIdRev 捕获→finalize 写入 expectedValue→apply 比较 currentRev≠expectedRev→superseded**——applyWriteNodeDataToDoc 现状无条件 set document:286-300）；④**服务端 writeNodeData 对客户端禁写键 manifest 拒写**（仅 linkMedia/deliverArtifact 复合 op 可写——worker 写端点 op 白名单 exec-only 维持；**键集单源两集合四处共用导出常量：v13b 正交化——SERVER_WRITABLE_DATA_KEYS={fileId,resultUrl,videoUrl,result,natural,errorCode,fileIdRev}（含 fileIdRev——server-owned 计数）〔**v13b：content 出白名单**——亲验 execution:485 content=用户 prompt 回显（data.content||prompt），删除回显 text 交付只写 result，双写者竞态从根上消失〕/CLIENT_FORBIDDEN_DATA_KEYS 同集减 resultUrl/videoUrl（历史键仍防回送）**——服务端只写生成物/客户端只写用户内容；四处=manifest/strip/guard/census 任一漂移即红**）；⑤Yjs 客户端直发 update 仍可写身份键——post-apply 检测（Z19''）+guard shadow 定档+**generated/uploaded 类型分流（写 generated mediaId→检测+读 403 计数；uploaded 引用不拦）**；**⑥meta.schemaVersion 例外修复（v13b：恢复 current 非删除——亲验 docShape:87-91 sv==null∧有节点→assertDocSchema→throw，删除只是把「旧档」换成「无戳」两者同拒）+重连**（DoS 防护——现状 writers 仅文档约定 manifest:105-110；**shadow 档也恢复+计数+诊断**；guard 域含 meta.* 整根）；第二步命令族=Y1 末/Y2 边界维持 | §3.2 |
| **Z12''（维持 v10）** | placement 复合单键+G17 改口+判别联合+allocator 唯一入口+updateNodeEnvelope apply 内合并整对象写+等值键 needs-layer-repair+37 调用点维持 | §2.5 |
| **Z13''（v13b 改）** | harness+**execSeq 代际矩阵（同 job 双 worker 三态 moveToDelayed——旧 worker 在 skip 后被 kill→grace 后重投→接管/完成，零「completed 但 RUNNING 悬挂」）**+新 intent 覆盖旧终态/旧 error 不覆盖新 loading+**flush 四崩溃窗**（apply 前/flush 前/flush 后 mark 前/mark 后 emit 前）+**in-place repair 并发（repair vs vacuum 409/写屏障持锁/维护窗 503/离线事后合并）**+outbox 乱序提交+重复投递幂等+分镜并发维持 | §2.6 |
| **Z14''（v13 重写——copy 方案二+）** | normalize 五路径+nodeId remap（cells remap 删）+**normalizeCopiedNodeData 单函数五路径共用（copyPlan/seed/clone）收窄**：status loading/error→**有 fileId 则 done 无则 idle**（red：copyPlan:63 structuredClone 连 loading 复制=副本永久转圈）/清 errorCode/error/删 ImageItem.url/**保留 fileId/images[].id**（新建路径不 strip——裁决 3）/exec 永不复制/cells 派生删；**binding=服务端惰性 reconcile**（post-apply guard/周期扫描 mediaRefsOf 七键→Media.teamId===project.teamId 校验〔跨 team 拒+计数〕→幂等 upsert〔清 sourceIntentRowId/sourceExecSeq 锚+attachState=attached+targetItemId sentinel〕——零客户端调用/离线 paste 天然覆盖/跨项目同 team 自然成立）；**跨 team paste=客户端 strip 身份引用**+服务端不建 binding+读 ACL 403 兜底（恶意客户端新建节点写他队 mediaId→doc 保留但读 403+facts 不返+binding 不建+guard 计数）；**Media GC 护栏**（删除前检查 doc 引用/活跃 binding+grace period——防副本还在媒体被删）；v12「binding 复制必清锚+新 registrationKey+attach 交付」整套废止（无执行者问题随 attach 取消消灭） | §2.5 |
| **Z15''（维持）** | cs 面 order/slot 写链维持 | §2.5 |
| **Z16''（维持）** | multiImage previewSize/恒等断言/fallbackSize/双常量注释维持 | §2.3/§3.4 |
| **Z17''（维持 v10）** | cells→slot（capacity 派生不落 doc/deriveStoryboardCells 长度恰=capacity+overflowIds/resize 溢出移出/swap 整值写/回流面 11 处删除清单）维持 | §2.3 |
| **Z18''（v13b 重写——execSeq+分层+flush+video materializing+R3 reconcile）** | **资金=artifactState+交付=DocDelivery 双轨（v9 骨架）+代际/事务/持久化三收口**：**①execSeq 全局代际**：**EXEC_STATUS_KEYS/ExecStatusPatch 加 execSeq: string 前置**（manifest:90 现状无——UNKNOWN_KEY 门口死）；exec 守卫比较改 `patch.execSeq<stored→older-exec`（BigInt；同 execSeq 内终态幂等——反例 A/B/C 全解）；**execSeq 由 claim 返回值进程内贯穿（job data 不带——controller:68-78 enqueue 时无 claim 不可得；DB 为唯一权威，禁第二真源）**；reserve 写 reservedExecSeq；settle/void CAS 匹配 reservedExecSeq；**同 jobId RUNNING 重入三态（v13b——skip 必不 ack）**：旧 worker 心跳新鲜→**`job.moveToDelayed(now+lease 余量+grace, token)`+抛 DelayedError（BullMQ 正确性：return=completed→旧 worker 真死则零交付悬挂）**；心跳过期→接管（新 execSeq fence 旧代+旧 DocDelivery superseded）；未知→可重试错误延迟重投——**禁「skipped 后成功 ack」**（现状 job 被 ack→reaper backfillSucceeded 谎言链）；rearm 事务=execSeq nextval+**voidInTx 只释放旧冻结（re-reserve 废止——team-credit:105 reservedCredits>0∨creditsConsumed>0→mayCall:false；re-reserve 留给新 worker 的 reserve）**+旧 DocDelivery superseded；**fail/touchHeartbeat/reanchorDeadline 补 execSeq 维度**（旧 execSeq 0 命中 no-op）；**providerRequestId（UUID）submit 前落库（v13b write-ahead——Idempotency-Key，消灭 submit→DB 崩溃窗）+providerTaskId submit 后落库（schema:1014 列在但全仓零写库点）+query-first 键序 requestId→taskId→重呼（同步 provider 如 text 显式标注不可 query-first——能力矩阵）**；**②ArtifactCommitService（资金五路径唯一 finalize——shared module 双 role：API+worker 均可实例化+双 role DI 测试〔生产 API manualRegistration:true 不消费队列，worker 是真实调用方 app.module:71〕）**：**stageInTx 短事务 durable 化（v13b——Media(processing)=统一 stage 句柄）**：先落 `Media(status=processing, objectKey/sha/size/sniff 已知字段, sourceIntentRowId/sourceExecSeq/artifactIndex)` ON CONFLICT DO NOTHING 幂等返回 mediaId+**同事务插 processing fact**→对象上传（image/edit/lighting：SafeRemoteFetch 下载+content-addressed key=`artifacts/{teamId}/{intentRowId}/{execSeq}/{index}-{sha256}`+**服务端自算 sha256**+sniff；orphan sweep 以 stage 行为准+覆盖旧 execSeq 前缀）→**finalize 短事务**（目标 <50ms/lock_timeout=3s/statement_timeout=5s；**事务内禁外部 IO**）：无锁读 intent 快照→ledgerTx 首句 lockBalance(teamId)〔契约 20〕→intent FOR UPDATE 重验（RUNNING∧execSeq∧reservedExecSeq）→**幂等检查在 CAS 前（v13b 判据=intent 行状态——SUCCEEDED∧artifactState∈{materializing,stored}∧creditsConsumed=cost→幂等返回+补建缺行）**→inserts/upserts（Media 状态提升〔registerInTx〕/MediaBinding/DocDelivery〔execSeq+targetField+targetItemId='' sentinel+expectedValue=fileIdRev 快照〕）→CAS updateMany（RUNNING∧execSeq→SUCCEEDED+artifactState）count===1 唯一凭据→settleInTx（失败整体回滚）→commit；死锁 40P01/40001/55P03+P2024 有界重试 3 次+jitter；**kind 分支（v13b——ArtifactState 四态）**：text=跳过 registerInTx（DocDelivery kind=text 携 resultText；artifactState=stored）；image/edit/lighting=stage 行 finalize 提升 completed（artifactState=stored）；**video=finalize 建 Media(status=processing, sourceUrl 专用列+预分配 key)+DocDelivery(kind=fileId 交付 mediaId)+settle/complete+artifactState=materializing——materialize 异步**（MaterializeJob：下载→MinIO→单事务 status=completed+size+sniffedMimeType+**复用同一次下载算 natural/hash/mime**+factVersion/outbox；幂等键=mediaId；processingLeaseUntil/processingAttempts 自有退避**与 intent attempts/rearm 解耦**；成功→artifactState=stored；**终态失败→幂等补偿退款+artifactState=failed+DocDelivery/exec errorCode=MATERIALIZE_FAILED（不清 fileId——UI 失败/重试）+告警**）；**资金 quota=软限+claim 前预检（estimatedBytes——processing 行 size=0 不占配额的洞）**；registerInTx 禁调 assertOnConfirm+禁外部 IO；**统一不变量（v13b）**：`SUCCEEDED⇒settled∧DocDelivery(kind=fileId)∧Media 行存在∧status∈{processing,completed,failed}`（`status=failed⇒幂等补偿退款+artifactState=failed`；text 唯一例外=resultText 非空；**delivered 只表示引用已写不表示字节存在**）；**③MediaRegistrationService（非资金唯一 Media 写入点——同 shared module）**：**prepareUploadInTx/registerInTx/confirmInTx/bindInTx 四形态**（**9 处 media.create 映射〔grep census〕+storage prepareUploadInTx 补 projectId**；幂等锚 registrationKey+@@unique(bucket,key)+**confirmInTx 带 status='pending' CAS**〔现状 storage:69-99 无事务无守卫〕）——不碰 settle/complete/DocDelivery/exec；**④DocDelivery 交付（单一 poller——v13b funding-only：非资金路径零服务端 doc 写实证〔stitch/trim/separate 只走 emit 族〕；将来确需时建独立 DocCommand 表）**：认领 CAS（SUCCEEDED∧artifactState∈{materializing,stored}∧pending∨lease过期）+SKIP LOCKED→**deliverArtifact 复合 op**（事务内前置判定全过才写：execSeq 比较→stale 拒/同值幂等/新 intent 已出现→superseded；**expectedValue（fileIdRev）不匹配→superseded（用户 replace 竞态根修）**；节点删→orphaned；然后 data patch+exec done）→按 project 批量 flush（**v13b 载体=带理由窄接口 `{persisted}|{retry,reason:spooled|failed}|{terminal,reason:fenced|fk}`——显式 storeDocumentSerialized 调用（saveMutex 内）替代 ephemeral-disconnect 当 flush 原语**；spooled=磁盘安全无限重试+告警不设假失败；failed=耗 maxAttempts+spoolDeadline 1h；fenced=停 claim 等租约；fk→orphaned）→复核 target/execSeq/expectedValue→mark delivered；onModuleDestroy 停 claim/等在飞；mark 后 lazy GET media-facts 补拉；**dead 行加 on-load reconcile/admin retry 重驱（v13b——dead 后节点永无 fileId）**；**⑤exec 投影维持**（loading/skipped=worker strict Http 带 execSeq；error=DB reconcile execProjectedExecSeq+活跃项目+24h；done=DocDelivery；alignExecFromIntents 重建）；**⑥清理与 reconcile=R3 自动收敛（v13b 改名+守卫）**：所有自动收敛走 `finalizeFromExistingMediaOrText(intentId,execSeq)`（同一幂等 finalize——**v13b 改名：避免执行者找不存在的 Artifact 表**）；动作表：SUCCEEDED∧产物存在∧未 settle→finalize 补 settle+DocDelivery；RUNNING∧provider 成功∧stage 行存在（processing 行）→finalize（provider 不重调）；SUCCEEDED∧delivery 缺失→补建；**FAILED/VOIDED∧reserved>0∧无 artifact/无 delivered→voidInTx（幂等）〔v13b 守卫：有交付的失败态交人工〕**；Media(processing) 源过期/终态失败→重试 materialize→超限 refund+failed+errorCode+告警；delivery failed（node 删/project gone）→orphaned+幂等退款；delivery failed（未知/基础设施）→重试上限→dead+告警不自动退款；台账不一致/对象缺失/无法判定→告警人工；护栏：每行 CAS+有界尝试 3 次 jitter+pg_advisory_xact_lock(hashtext(intentId))+审计行 reconcile_action+auto_converged/manual_required 分计数；**backfillSucceeded/threeCheck resultRef/settleStranded probeArtifacts 三后门删除**；统一不变量巡检；cleanTerminalIntents=artifactState 终态∧delivery 终态∧reserved=0∧7d（resultText 非空行 90d）+**保留矩阵：有 artifact 的 intent 不物理删（Media.sourceIntentRowId 悬空锚根修）**；DocDelivery delivered 30d/MediaFactOutbox published 7d retention+dead-letter 告警 | §3.1 |
| **Z19''（v13b 扩）** | guard=exec-only+**身份键域**（post-apply 检测扩：exec map 客户端写+fileId/resultUrl/videoUrl/result/natural/fileIdRev 客户端直写检测——Z11''⑤）+**meta.* 根（修复=恢复 current 非删除）**+**generated/uploaded 类型分流**（写 generated mediaId→检测+读 403 计数）；spike 定档+post-apply 恒做+四根白名单维持 | §3.6 |

## 0.2 裁决定案（2026-10-18 用户确认；v11 收口更新）

| # | 项 | 定案 |
|---|----|------|
| ① | media facts 存储 | 维持 v9——Media 读模型（v11:MediaFactOutbox 替换 watermark+IDOR 校验） |
| ② | 重排出口 | **v13 in-place renumber**（推翻 v11 换轨方案 A——preVacuumSv 对未同步离线客户端无效实证；不 close/不 reload/不清 IDB/不跳 generation；分块 ≤64KB+幂等重跑+帧预算预演；**vacuum 兜底仅限确定无离线客户端运维窗**；generation 握手归 Y2；purgeForeignCaches bug 修复维持仅 vacuum 路径关联） |
| ③ | 片序 | 维持（单列车+P0-pre+B1a 必做——§4 对齐 plan v10.1） |
| ④ | Y1c schema | 本批固定 **3**（双常量同值两门） |
| ⑤ | 键长参数 | 维持（vendor+soft 24+hard 128+四曲线+等值键 repair） |
| ⑥ | UI 变更面 | v7 清单+slot 交互+fileId 替换显式命令+text 32KB 截断+媒体库保留 N 天+**40MP 图片上限提示** |
| ⑦ | worker doc 写口径 | 维持 v10（exec-only strict Http；error=DB reconcile）+**v11:端点 op 白名单** |
| ⑧ | artifact 状态机 | 维持 v10 简化版+**v11:execSeq 代际+锁序 balance→intent+InTx 族+幂等前置**+**v13b：ArtifactState 四态 materializing/stage durable 化（见㉔）** |
| ⑨ | ~~repair 防回滚~~ | **v11 废止 repairRev**（~~换轨方案 A~~ **v13 再废止 generation 跳变常规路径——in-place〔定案②〕**；repairRev/in-place 均无需 rev 语义） |
| ⑩ | fileId 所有权 | 维持 v10 第一步+**v11:服务端 manifest 拒写+端点白名单**+**v13b：strip 键集精确枚举+socket 降级+fileIdRev（见㉔）** |
| **⑪** | **执行代际（v11/v12/v13b 改）** | 全局单调 execSeq（nextval 两处分配〔new claim/rearm〕；**v13b：同 job 重入三态 moveToDelayed 非 skip-ack〔覆盖 v12「复用+静默 skipped」〕**；单一序全链 fence+EXEC_STATUS_KEYS 进 manifest+fail/touch/reanchor execSeq 化+**providerRequestId write-ahead**；attempts=配额语义） |
| **⑫** | **producer 分层（v11）** | MediaRegistration（唯一 Media 写入点）+ArtifactCommit（资金）/MediaRegistration（非资金）两编排器；不造零费 intent |
| **⑬** | **交付持久化（v11→v13b）** | flushDocument 带理由窄接口（~~v12 五态先行重构~~ **v13 推翻**；**v13b 细化：`{persisted}|{retry,reason:spooled\|failed}|{terminal,reason:fenced\|fk}`——显式 storeDocumentSerialized 调用替代 ephemeral-disconnect；spooled 磁盘安全无限重试不设假失败、failed 耗 maxAttempts+spoolDeadline、fenced 停 claim 等租约、fk→orphaned**）+批量一次 flush+flush 后复核；spooled≠delivered；PG 至少一次 |
| **⑭** | ~~**同 job 重入（v12）**~~ | **v13b 废止**（复用+静默 skipped 语义被 ㉒ 三态取代——见 ⑪） |
| **⑮** | **video finalize（v13 重写+v13b 修正）** | **不交付 videoUrl**——`Media(status=processing)+fileId`：provider 成功即 settle+finalize（资金流零 delta）；materialize 异步（自有 lease/attempts 与 intent 解耦；**复用同一次下载算 natural/hash/mime**）；**终态失败→幂等补偿退款+artifactState=failed+DocDelivery/exec errorCode=MATERIALIZE_FAILED（不清 fileId——UI 显示失败/重试，非撤回交付）**；processing fact 同事务推送；processing 期 content proxy 两态（带上限可降级）；targetField 词表删 videoUrl/resultUrl；**不变量 status∈{processing,completed,failed}+failed⇒补偿退款（v13b——failed 为合法终态）** |
| **⑯** | **copy 资金产物（v13 重写）** | **方案二+**：strip 只对更新不对新建（新建保留 fileId——消灭空图窗口）；normalizeCopiedNodeData 收窄；binding=服务端惰性 reconcile（mediaRefsOf 扫描+teamId 校验+幂等 upsert 清锚）；跨 team strip+读 ACL 兜底；**attach consumer 取消、交付 owner 收敛单一 DocDelivery poller、MediaBinding 降级纯索引** |
| **⑰** | **资金 quota（v12 维持+v13 预检）** | 软限——finalize 不因 quota 回滚（钱已付 provider）；超限告警+计数；**claim 前预检 usage+estimatedBytes**；registerInTx 禁调 assertOnConfirm+禁外部 IO |
| **⑱** | **reconcile（v13+v13b 改名+守卫）** | R3 幂等 finalize 自动收敛（**finalizeFromExistingMediaOrText**〔v13b 改名——避免执行者找不存在的 Artifact 表〕+动作表+审计+有界重试+advisory lock）；自动/人工分界=歧义与资损风险绝不自动动钱；backfillSucceeded 禁写 SUCCEEDED+null；**FAILED∧reserved>0 void 加「无 artifact/无 delivered」守卫** |
| **⑲** | **guard/strip 定位（v13+v13b 改）** | 检测/诊断/可修复（shadow 起步）；安全边界=assertMediaReadable 读侧单门（**projectId=null 退化 team member**）；**meta.schemaVersion 例外修复=恢复 current 非删除（v13b 亲验 docShape:87-91——无戳∧有节点同拒）**；键集单源两集合四处共用（**v13b 精确枚举见㉔**） |
| **⑳** | **R2 大重构（v13）** | 登记 Y2 立项候选（Artifact 表/mediaRef/多实例/**slotId 多产物**+触发条件）；本批零代码；**双 bump 保留**（生产 epoch 14 在线混跑窗真实——第三次重提第三次拒绝）；fileId 命名保留 |
| **㉑** | **StoreOutcome（v13→v13b 细化）** | 窄接口先行（**v13b：带 reason 三态——见⑬**；五态判别联合仍为后续独立硬化卡） |
| **㉒** | **同 job 重入（v13b 改）** | 三态：**心跳新鲜→moveToDelayed(lease 余量+grace)+DelayedError 不 ack（v13b——return=completed 即悬挂）**；过期→接管（新 execSeq fence 旧代）；未知→可重试；execSeq 进程内贯穿（job data 不带） |
| **㉓** | **rearm（v13 改）** | **只 voidInTx 释放旧冻结**（re-reserve 废止——自相矛盾修复）；re-reserve 留给新 worker 的 reserve；**providerRequestId submit 前落库（Idempotency-Key）+providerTaskId submit 后落库+query-first 键序 requestId→taskId→重呼（v13b write-ahead——消灭 submit→DB 崩溃窗）** |
| **㉔** | **边界收口（v13b）** | ①非资金 DocDelivery lane 删除（零 doc 写实证）——funding-only；②ArtifactState 四态 materializing+stage durable 化（Media(processing)=统一 stage 句柄）；③strip 键集精确枚举 CLIENT_FORBIDDEN={fileId,resultUrl,videoUrl,result,natural,errorCode,fileIdRev}（不含 referenceImage/images/allImages/trimmedFileId 族）+socket setFileResult 降级本地 UI+guard 类型分流；④content 出服务端白名单（text 交付删回显只写 result——亲验 :485）；⑤fileIdRev token 来源（claim 捕获/apply 比较/replace 递增）；⑥repair RW 写屏障+单块预算+advisory lock；⑦multiImage 本批一 intent 一 artifact（targetItemId=''） |

**附 D6 维持**：data.autoOrigin 移 B2；空间序 id tie-break 维持 A1。

## 0.4 偏离登记表（滚动）

| # | 偏离 | 落地形态与依据 |
|---|------|----------------|
| 1 | E15 键长上限 | soft 24+hard 128 安全网——master 回填 |
| 2 | cellCount | 不做（零读者） |
| 3 | ~~fileId Y2~~ | **v10 废止——Y1 第一步收口（Z11''）；**Yjs 直发 update 面归 post-apply/guard（Y1 面内检测+Y2 收编） |
| 4 | 跨 team attach | 同 team+team-mismatch；复制方案 Y2 |
| 5 | 产物媒体库保留期 | Media 生成物 N 天（UX 签字窗定）；**text=90 天+读取入口** |
| 6 | **emitter 单实例假设** | ecosystem instances:1 钉死；多实例（Redis pub/sub/socket adapter）归 Y7 |

## 1. 基线快照（2026-10-18 十一轮一手核验；行号=master 96056a52）

### 1.1-1.7 历轮基线（v5-v10）

v5-v10 各轮基线行维持有效（全文见 git 历史与 v10 版本）；裁决引用以 §0.1 v11 口径为准。

### 1.8 v11 核验行（第八轮三份外审主张一手复核——2026-10-18 三并行核验）

| 位置 | 事实 | 裁决引用 |
|------|------|----------|
| [generation-intent.service.ts:130/:158/:183](../../../apps/api/src/modules/execution/generation-intent.service.ts) | 同 jobId RUNNING 重入**不递增 attempts**；rearm 才 increment；新行 attempts=1（schema:1004） | Z18''-v11（execSeq） |
| [execution.processor.ts:40](../../../apps/api/src/modules/execution/execution.processor.ts) | BullMQ stalled 同 jobId 重排——旧 worker 旧产物过 attempts CAS（反例 A） | Z18'' |
| [collab-document.service.ts:313-331](../../../apps/api/src/modules/collab/collab-document.service.ts) | **exec 守卫只比 attempts 不比 intentId**（条目含 intentId 字段但守卫不比较）；新行 attempts=1——**新 intent 的 loading/done 被旧 done 拦截（反例 B=现存 bug）** | Z18''（execSeq 守卫） |
| [team-credit.service.ts:102-108](../../../apps/api/src/modules/team/team-credit.service.ts)+[execution.service.ts:325](../../../apps/api/src/modules/execution/execution.service.ts) | reserve 见 reserved>0 返 mayCall:false→**新 attempt 静默跳过外呼（rearm 资金残留=现存 bug）** | Z18''（rearm 归一化） |
| [credit-ledger.service.ts:58](../../../apps/api/src/modules/team/credit-ledger.service.ts)+team-credit:90/:156/:186/:235 | **契约 20=TeamBalance 先于 GenerationIntent**（四处全先 lockBalance） | Z18''（finalize 锁序） |
| generation-intent:255+team-credit:132 | complete 根 prisma+settle 自开 $transaction | Z18''（InTx 族） |
| [intent-reconcile.service.ts:215/:244](../../../apps/api/src/modules/execution/intent-reconcile.service.ts) | backfillSucceeded 直接置 SUCCEEDED；threeCheck resultRef 判成功（绕过 finalize 后门） | Z18''（后门删除） |
| stitch:97/trim:110/generated-media:54/storage confirmUpload | **四路径零 GenerationIntent**；ExecutionJobData.intentRowId=死代码（:272 注释） | Z18''（producer 分层） |
| [collab-residency.service.ts:459-468](../../../apps/api/src/modules/collab/collab-residency.service.ts) | **withSession 入池写档零 flush**（仅 withDoc 旧路径 unloadImmediately+ephemeral 档）——debounce 未落库窗真实 | Z18''（flushDocument） |
| [canvas-doc-update.repository.ts:180-210](../../../apps/api/src/modules/collab/canvas-doc-update.repository.ts)+registry:564-581/:679-698 | **vacuum 全套现成**：beginVacuumEra+vacuumReplace 单事务（state+preVacuumSv+generation+1+删行+advisory lock）+guardSyncFrame preVacuumSv 内容级 fence | Z4''（方案 A） |
| registry:965-977+runtime:1450-1470 | doc-status dedup=`${state}:${frozen}`+客户端 `msg.rev<=last` return——**epoch 字段变化会被吞**（旁路仅 broadcastDocStatusForce） | Z4''（复用 generation 即复用 forceRevBump 链） |
| runtime:1572+canvasCollabRuntime:297-301 | 客户端 URL 只 csv/cb；CollabSessionMeta=viewerUid/generation/schema 三元——**无自报 rev 通道** | Z4''（方案 A 依据） |
| [local-cache-key.ts:71-78](../../../apps/web/src/collab/local-cache-key.ts)+runtime:598/:1530/:1649-1651+cache.spec:100-113 | **purgeForeignCaches 传会话旧键=保留脏旧代删其他代（反语义现存 bug）**；测试只断言调用参数 | Z4''（purgePidCaches 修复） |
| collab-shrink:78/:265-270+registry:190/:543-546 | vacuum 互斥=进程内 Promise 链+Set+advisory lock（仅事务护锁） | Z4''（共享 vacuumGate） |
| collab-write.controller:32-44+manifest:83 | worker 端点鉴权+manifest 键集存在——**fileId/resultUrl 在服务端白名单内**（op 白名单收窄点） | Z11''（端点 exec-only） |
| [mediaUploadUtils.ts:31](../../../apps/web/src/utils/mediaUploadUtils.ts)+video-work:207/:619 | **生产 media=MinIO 域名直连**（nginx 无 /flowai；裸 /flowai 生产 403）**但 web 上传侧仍改写相对 /flowai——dev 假设渗入生产路径（新发现）** | Z7''（MIME/通路修复） |
| schema:279/:270-315 | Media.size **Int（≈2.147GB 上限）**；无 probedAt/factVersion 列索引；仓内零嗅探库（file-type 需新增） | Z7'' |
| MultiImageConfigPanel:69/:82/:108-109+nodeStore:729-736 | 删除/重排按 ImageItem.id 现算 findIndex（**targetIndex 漂移批评不成立**——但 updateMultiImageImages 整数组覆盖仍在） | Z7''（targetItemId） |
| intent-reconcile:102-139/:350-352+schema:1025-1027 | reconcile 三查询**带状态+时间窗+partial 索引**（非全表）；缺活跃项目过滤 | Z18''（补过滤） |

### 1.9 v12 核验行（第九轮三份 v8 外审主张一手复核——2026-10-18 四路并行核验；行号=master 21daab17）

| 位置 | 事实 | 裁决引用 |
|------|------|----------|
| [canvas-doc-manifest.ts:83/:90](../../../packages/shared/src/canvas/canvas-doc-manifest.ts) | SERVER_NODE_DATA_KEYS=fileId/resultUrl/videoUrl/content/result/errorCode（**writeNodeData 白名单且含 content**）；**EXEC_STATUS_KEYS 无 execSeq**——不进键集 writeExecStatus 带 execSeq 直接 UNKNOWN_KEY | Z18''-①（manifest 前置） |
| [canvasIntents.ts:462/:502](../../../apps/web/src/stores/canvasIntents.ts)+nodeStore:632 | addNode 携 data 全量+dataPatch 全键差异（**快照窗口跨远端 apply 时服务端写的 fileId 被 diff 判为"变化"经 WS 发回**）；updateConfig merge 全量 | Z11''（strip 单点） |
| [copyPlan.ts:63](../../../packages/shared/src/canvas/copyPlan.ts) | structuredClone(rec.data) 仅 remap cells——**status loading/fileId 原样复制进副本**（副本永久转圈+无交付者） | Z14''（normalizeCopiedNodeData） |
| collab-persistence:235/:283/:287-395/:308-336/:323-328+439-441 | **storeDocumentUnlocked 返回 boolean——noop/spool 成功/spool 失败/FK/fenced 五分支混一个 false**；storeDocumentSerialized 仅 saveMutex 透传（per-doc） | Z18''-④（StoreOutcome） |
| [storage-quota.service.ts:25-49](../../../apps/api/src/modules/team/storage-quota.service.ts) | getUsage/assertCanUpload 根 prisma 无锁读（TOCTOU）；**assertOnConfirm 超限删 MinIO 对象+删 Media 行（事务内调用则副作用不可回滚）** | Z18''（软限+禁调） |
| generation-intent:230/:248/:265 | **touchHeartbeat/reanchorDeadline/fail 只守 status 不含代际维度——旧 worker 可刷新心跳/杀新 attempt** | Z18''-①（execSeq 化） |
| 11 处 media.create | storage:37（presign）/media-process:194/ai-download:100/ai-image-edit:199+200/lighting:167/video-trim:110/stitch:97/generated-media:54/video-work:91——**全部可映射 prepare/confirm/register/bind 四形态（迁移对象非 plan 实错）** | Z18''-③（映射表） |
| execution:480-488/:513-517+ai-download:100 | **text 只产 resultText 不建 Media；video videoUrl（resultRef=URL）先行交付、Media 行下载后才建** | Z18''-②（kind 分支） |
| registry:655-663 | **vacuumEquivalent 只比根/exec 键集合（浅比较）**——repair 等价断言须明确 exec 值级 | Z4''（exec 值等价） |

### 1.10 v13 核验行（第十轮三份 v9 外审主张三路并行核验+两处子代理误报亲验纠正——2026-10-18；行号=master 9cac518b）

| 位置 | 事实 | 裁决引用 |
|------|------|----------|
| [collab-doc-registry.service.ts:689-697](../../../apps/api/src/modules/collab/collab-doc-registry.service.ts)+[collab-quota-gate.spec.ts:497](../../../apps/api/src/modules/collab/collab-quota-gate.spec.ts) | **preVacuumSv fence 只拒「clientID∈preVacuumSv∧clock≥pre」——从未同步的离线客户端（IDB 有未同步 update、clientID 不在服务端 SV）重连被正常放行并合并旧编辑**（测试明确放行新 clientID） | Z4''-v13（in-place 根修依据） |
| [team-credit.service.ts:105-108](../../../apps/api/src/modules/team/team-credit.service.ts) | reserve 在 `reservedCredits>0 ∨ creditsConsumed>0` 时返 mayCall:false——**v12「rearm 内 release+re-reserve+新 worker 拿 mayCall:true」自相矛盾**（re-reserve 后新 worker 必被静默跳过） | Z18''-①（rearm 只释放） |
| schema.prisma:1014+api-caller.service.ts 全文+generation-intent.service.ts:129/:157/:173 | **providerTaskId 列存在（Z69「submit 后落库」注释）但全仓无写库点**（api-caller 只返回；generation-intent 只有「保留」注释——从未写入过何谈保留）；query-first 调用不存在 | Z18''-①（providerTaskId P0） |
| [execution.controller.ts:68-78](../../../apps/api/src/modules/execution/execution.controller.ts) | enqueue job data 只带 projectId/nodeId/userId/regenToken/traceId——**claim 在 worker execute 内才发生，「job data 携 execSeq」前提不存在** | Z18''-①（execSeq 进程内贯穿） |
| [execution.service.ts:381/:513-516](../../../apps/api/src/modules/execution/execution.service.ts)+[ai-download.processor.ts:62/:118](../../../apps/api/src/modules/ai-download/ai-download.processor.ts) | **video 的 resultRef/fileId 字段放的是 provider URL**（:513 videoUrl=result.url；:381 fileId=URL）；ai-download:118 又写 fileId+resultUrl；:62 axios.get 无 host 校验/重定向限制/大小上限（SSRF 面） | Z18''-②（裁决 1 依据）+P0⑫ |
| [canvas-doc-manifest.ts:105-110](../../../packages/shared/src/canvas/canvas-doc-manifest.ts) | meta.schemaVersion writers 仅文档约定（stampDocSchema）——**客户端发 Yjs update 可改 meta.schemaVersion→ensureSchemaVersion throw→项目被 viewer 永久 brick** | Z11''-⑥（meta 硬删） |
| [copyPlan.ts:27-102](../../../packages/shared/src/canvas/copyPlan.ts)+canvasStore duplicate/paste | buildCopyPlan 纯客户端、服务端只看 addNode data——**服务端无 source→target 节点映射，「binding 复制」无执行者**（v12 copy 清锚方案的结构性缺口） | Z14''-v13（方案二+依据） |
| [nodeStore.ts:632-636](../../../apps/web/src/stores/nodeStore.ts) | updateConfig dispatch `patch: mergeNodeData(existing.data, config)`——注释自认「终态全量」（外审主张实证成立） | Z11''-①（strip 更新路径） |
| media.create 全仓 grep | **生产调用点 9 处**（storage:37/media-process:194/ai-download:100/ai-image-edit:199〔+200 为续行〕/lighting:167/video-trim:110/stitch:97/generated-media:54/video-work:91）——**v9/v12 的「11 处」为错数**；门禁改 grep census | Z18''-③ |
| web `/flowai` 改写 grep | **24 处/15 文件**（mediaApi/videoWorkApi/ImageGenNode/MultiImageConfigPanel/MultiImageNode/VideoGenNode/AudioGenNode/AddNodeMenu/AssetPanel/export·upload/useTeamAssets/materialLibraryStore/splitUploadService/useImageUpload/mediaUploadUtils）——远大于 v9 所列 2 文件；deploy/nginx 模板无 /flowai（生产拓扑须 nginx -T 实证） | Z7''-v13（/flowai 面迁移） |
| [storage.service.ts:38-50/:69-99](../../../apps/api/src/modules/storage/storage.service.ts) | presign create data **无 projectId**（只解析 teamId）；confirmUpload **无事务无 status='pending' CAS**（并发双 confirm 可都过配额读） | Z18''-③（prepareUploadInTx 补 projectId）+P0⑧ |
| [schema.prisma:287](../../../apps/api/prisma/schema.prisma) | Media.status 为 String（pending\|completed\|failed）——**加 processing 无 enum 迁移成本** | Z18''-②（裁决 1 落地成本） |
| [app.module.ts:71](../../../apps/api/src/app.module.ts)+ecosystem.config.cjs | 生产 API `manualRegistration:true` **不消费队列**——ArtifactCommit/MediaRegistration 的真实调用方是 worker 进程（shared module 双 role 依据） | Z18''-② |
| [collab-write.port.ts:181-183/:206](../../../apps/api/src/modules/collab/collab-write.port.ts) | HttpCollabWritePort **瞬态耗尽/永久错误均返回 `{written:true}`**（把没写成当成功——资金路径禁伪造） | Z18''-②（typed outcome） |
| [intent-reconcile.service.ts:163/:224-227](../../../apps/api/src/modules/execution/intent-reconcile.service.ts) | job completed→backfillSucceeded **无条件置 SUCCEEDED（resultRef 可为 null）**——stalled 重入 skip→ack→deadline 时 reaper 谎言链 | Z18''-⑥（R3 动作表） |
| [collab-document.service.ts:286-300](../../../apps/api/src/modules/collab/collab-document.service.ts) | applyWriteNodeDataToDoc **无条件 set（无 CAS/expectedValue）**——用户 replace 在飞期间被旧代 delivery 覆盖 | Z11''-③（expectedValue CAS） |
| ImageGenNode.tsx:70/VideoGenNode.tsx:51/MultiImageConfigPanel.tsx:74 | **web 渲染本就走 useMediaUrl(fileId)/ImageItem.id=media id**——videoUrl/resultUrl 是无消费者历史残留（裁决 1 低风险依据） | Z18''-② |

### 1.11 v13b 核验行（第十一轮三份 v13/v10 复审主张亲验——2026-10-18；行号=master 9cac518b/fe1114d7）

| 位置 | 事实 | 裁决引用 |
|------|------|----------|
| 全仓 writeNodeData grep+emit.port.ts:62-86 | **非资金路径零服务端 doc 写**：doc 写点仅 ai-download:85/:118+lighting:214+ai-image-edit:232（全资金路径）；stitch/trim/separate 只走 emitTrimStatus/emitStitchStatus/emitSeparateStatus，结果由客户端写 trimmedFileId 等（nodeStore:845） | ㉔①（DocDelivery funding-only 依据——v10 T8「非资金并入」lane 删除） |
| [execution.service.ts:484-486](../../../apps/api/src/modules/execution/execution.service.ts) | text artifact 的 `content: data.content \|\| prompt`——**用户 prompt 回显非生成物**；result 才是生成文本 | ㉔④（content 出服务端白名单——text 交付只写 result） |
| [docShape.ts:84-92](../../../packages/shared/src/canvas/docShape.ts) | `sv==null ∧ 有节点 → assertDocSchema → sv≠current → throw`——**删除 meta.schemaVersion 后项目仍拒载**（无戳与旧档同拒） | ㉔（meta 修复=恢复 current 非删除） |
| execution.service.ts:298（emitNodeStatus）+video resultRef=URL（:513/:516） | **socket done 事件携 `fileId=intent.resultRef`——video 时即 provider URL**→useMediaUrl(URL) 404；生成结果 socket 路径与 DocDelivery 双写 | ㉔③（socket setFileResult 降级本地 UI——DocDelivery=generated fileId 唯一写入者） |
| BullMQ processor 语义 | **processor 正常 return=job completed**——「心跳新鲜→skip」若 return 即 ack，旧 worker 真死则零交付悬挂（无 stalled 重投） | ㉒（skip→moveToDelayed+DelayedError 不 ack） |
| execution.service:539+multiImage ImageItem.id=mediaId | **每 intent 单 result.url（一 intent 一 artifact）+ImageItem.id 随替换漂移**——「多产物 N Media」无 producer、「targetItemId=稳定 ImageItem.id」不成立 | ㉔⑦（本批一 intent 一 artifact+targetItemId=''；slotId 归 Y2） |
| collab-residency withSession 入口门 | withSession(write) 入口检查维护门，**但在飞 withSession 不被拦**——writesSettled 是持久化谓词非写屏障 | ㉔⑥（repair per-project RW 写屏障） |

## 2. Y1a 序域设计（D5 分层直译+数据流闭合）

### 2.1 类型链与读出口（Z2''）

四型/三函数读模型/排序单实现收编/G13 维持 v10。

### 2.2 生成器+避让+soft/hard+等值键（§0.2-⑤）

vendor+读写两侧严格+四曲线+同锚+**等值邻居 needs-layer-repair**+soft 24 告警+hard 128 损坏上限维持 v10。

### 2.3 层序读出口+slot 单实现（Z3''/Z17''）

orderRecords+deriveStoryboardCells（capacity 派生/长度恰=capacity/overflowIds/resize 溢出移出/swap 整值/回流面 11 处删除）维持 v10。

### 2.4 无自动重排+on-demand repair=in-place renumber（Z4''-v13b）

维护链：soft/hard/检测/load 病理档 reaper/CLI 维持；**repair 执行体=in-place**：维护互斥（CollabMaintenance 行+共享 vacuumGate+**pg_advisory_xact_lock 跨进程保险**）→applyWriteFreeze('repair')（不 close/不 reload/不清 IDB/不跳 generation）+新连接只读+DocDelivery 消费者维护门 503→**per-project RW 写屏障（v13b：writer refcount/maintenance 排他——writesSettled 是持久化谓词拦不住在飞 withSession）**→纯函数修复计划→**withSession(write, MAINTENANCE_TRANSACT_ORIGIN) 分块 ≤64KB=独立事务**→回读校验（**等价断言=忽略 order|slot 的节点/边/data/exec 值等价——非 order/slot 键零变化**）→解除 readOnly+恢复交付+RepairRun 审计；幂等可重跑（崩溃→maintenance 行 stale→aborted→重跑）；**单块预算（v13b）：fallback 只留给不可表达结构——总量大就多块不 fallback，「总量 256KiB 退 vacuum」废止**；**vacuum 兜底仅限「确定无离线客户端」运维窗**（无 generation 握手不得自动回退；握手归 Y2；vacuum 路径等价断言补 exec 值比较+purgePidCaches 修复维持）；CLI 默认 in-place（--vacuum 仅紧急）；**reason（推翻 v11 跳变）**：preVacuumSv fence 对未同步离线客户端无效（§1.10 实证）——generation 跳变做常规 repair=把数据复活风险常态化；in-place 保留离线编辑/undo 历史/连接，10k 重排实测 56ms+分块写回秒级。

C0a 实测锚：10k 重排≈56ms；投影 p95 18.7ms。

### 2.5 创建+父变更+order/slot 写链（Z12''/Z14''/Z15''）

维持 v10（复合单键+G17 改口+判别联合+apply 合并整对象写+等值键+37 调用点+normalize 五路径）；**v13：binding 复制改惰性 reconcile（Z14''-v13）**；**DOC_NODE_KEYS 契约表钉死**（envelope 7 键〔id/type/parentId/width/height/position/data〕+order/slot 进 data 判别——**slot=派生单实现禁两可**；fillDoc/applyRecordToYMap/readRecordsFromMaps/normalizeCanvasRecord/toDocRecord 全按新表）+**compareExecSeq 单源**（BigInt 解析+lint 禁裸比较+非法 string drop 不 0 兜底）。

### 2.6 收敛 harness（Z13''-v13b）

五件套+双端真连维持；并发/故障注入补：**execSeq 代际矩阵（同 job 双 worker 三态 moveToDelayed——旧 worker 在 skip 后被 kill→grace 后重投→接管/完成，零「completed 但 RUNNING 悬挂」）**+**flush 四崩溃窗**（apply 前/flush 前/flush 后 mark 前/mark 后 emit 前）+**in-place repair**（10k 重复 order→不断线不 reload/离线客户端事后合并零节点复活/repair vs vacuum 409/**写屏障持锁并发用例——持有 delivery 的 withSession 启动 repair→等待不丢写**/维护窗 delivery 503 退避/崩溃重跑收敛/不可表达结构回退 vacuum+旧客户端 4410）+outbox 乱序提交+**重复投递幂等**+分镜并发零成员丢失+等值邻居/重复键层 repair+DocDelivery 三窗/exec alignExecFromIntents 重建/**video materialize 矩阵（下载失败/超时/进程崩溃 resume/URL 过期→退款+errorCode）**+**copy 保留 fileId 立即渲染+binding 惰性 reconcile+跨 team paste strip**+**R3 五窗收敛**+**guard 检测→修复→ACL 拒绝链路+meta 恢复后项目仍可加载**+**strip 键集矩阵（上传路径 referenceImage/images/allImages 不被剥——red：键名一刀切复现）+socket 零 doc fileId 写**+reset 联动。

## 3. Y1b 尺寸/只读域设计

### 3.1 media 读模型+probe+两编排器+资金双轨（Z1''/Z7''/Z18''-v11）

**进程拓扑（v13b）**：

```
shared artifact-core module（API+worker 双 role 均可实例化+双 role DI 测试）：
  ArtifactCommitService（资金 finalize：stageInTx durable+finalize 短事务）
  +MediaRegistrationService（唯一 Media 写入点——prepareUploadInTx/registerInTx/confirmInTx/bindInTx）
  （只依赖 Prisma/Minio——不依赖 CollabResidency/DocDelivery poller）
API 进程：DocDelivery poller（唯一交付 owner——v13b funding-only（非资金路径零服务端
            doc 写实证）；deliverArtifact+fileIdRev CAS+flush+复核+dead 重驱）
          +binding 惰性 reconcile（mediaRefsOf 扫描——纯索引维护，create-only）
          +MediaFactOutbox emitter+exec error reconcile（execProjectedExecSeq）
          +media-facts REST（POST）+media content 代理（两态）+repair（in-place 主+vacuum 兜底）
worker 进程：probe（sharp/ffprobe——上传路径）+MaterializeJob（video processing→completed，
            复用同一次下载算 natural/hash/mime）
          +生成/媒体处理 processor
          ——零直接 Y.Doc 访问+零资金/artifact/fileId doc 写
          exec loading/skipped=strict Http（exec-only op 白名单+execSeq）
          exec error=只写 DB；producer 调 ArtifactCommit/MediaRegistration（纯 DB 调用）
```

**MediaFactOutbox（Z1''-v13b）**：

```
写入点（v13b）: probe done / server natural / processing 态创建
  （stageInTx/finalize 建 Media(processing) 同事务插 factType=state payload=processing
   ——UI「处理中」推送来源非 425 轮询；materialize 完成再插 completed）——同事务：
  update Media（natural 列+factVersion+1+probedAt 仅审计）
  insert MediaFactOutbox（mediaId+projectId〔union(Media.projectId,binding.projectId)〕
    +factVersion+factType+payload+state=pending）
emitter（API——单实例假设显式化）：
  claim: state='pending' ∧ nextAttemptAt<=now ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 200
  → emit project:<id> 房间 media:fact{mediaId,version,fact} → published
  失败 attempts++/nextAttemptAt 退避（jitter）；耗尽 dead+告警
  （无 watermark——晚提交行仍 pending 下轮必达；at-least-once+客户端 factVersion 幂等去重；
   correction 必产生新 version；published 行 retention 7d）
客户端：按 factVersion 忽略旧；重连/切项目全量拉（REST 返回 factVersion）
```

**MIME 安全链（Z7''）**：

```
presign POST: Content-Type 条件（starts-with image/|video/|audio/——Content-Type 进 fields）
confirm: 嗅探对象头（file-type 16.x 或自研） → 白名单外拒+删对象+media_content_type_reject_total
  → 按 sniffed 重算 probeState（伪报 audio 的图片→pending）
消费: GET /api/media/:id/content 两态（ready=对象流式+Range/HEAD/ETag/304+nosniff；
  processing=SafeRemoteFetch allowlist 代理 sourceUrl+no-store+上限降级）；生产 MinIO 直链禁用
图片 probe 后 sharp 重编码（剥 polyglot/EXIF 载荷）；SVG 一律拒
/flowai 面迁移（mediaContentUrl(fileId) 单点+census——nginx -T 实证先行）；Media.size BigInt
```

**资金双轨（Z18''-v13b）**：

```
⓪前置: EXEC_STATUS_KEYS/ExecStatusPatch+execSeq: string（旧条目 docSchema v3 拒载）
  flushDocument 带理由窄接口（v13b——五态判别联合仍降后续硬化卡）:
    {result:'persisted'} | {result:'retry',reason:'spooled'|'failed'}
    | {result:'terminal',reason:'fenced'|'fk'}
    （v13b: 显式调 storeDocumentSerialized〔saveMutex 内〕替代 ephemeral-disconnect 当
    flush 原语——disconnect 会卸载 doc、recheck 需重载；spooled=磁盘 fsync 安全无限重试
    +告警不设假失败〔PG 停机>1h 判死磁盘上的安全帧=假失败〕；failed=耗 maxAttempts
    +spoolDeadline 1h 兜底；fenced=停 claim 等租约；fk→orphaned）
  compareExecSeq 单源（BigInt 解析+lint 禁裸比较+非法 string drop）
①execSeq（全局单调——DB sequence nextval 两处: new claim/rearm）:
  execSeq 由 claim 返回值进程内贯穿（job data 不带——enqueue 时无 claim；
    DB 为唯一权威，禁第二真源）
  exec 守卫: patch.execSeq<stored→older-exec 拒；同 execSeq 终态→幂等（reason-aware）
  同 jobId RUNNING 重入三态（v13b）: 旧 worker 心跳新鲜→moveToDelayed
    （now+lease 余量+grace, token）+抛 DelayedError 不 ack（BullMQ 正确性:
    return=completed→旧 worker 真死则零交付悬挂）；过期→接管
    （新 execSeq fence 旧代+旧 DocDelivery superseded）；未知→可重试错误延迟重投
    ——禁「skipped 后成功 ack」（现状: skip→job completed→reaper backfillSucceeded
      谎言链 intent-reconcile:163/:224）
  providerRequestId（UUID）submit 前落库（v13b write-ahead——Idempotency-Key，
    消灭 submit→DB 崩溃窗）+providerTaskId submit 后落库（现状 schema:1014 列在
    但零写库点）+query-first 键序 requestId→taskId→重呼
    （同步 provider 如 text 无 task id——能力矩阵显式标注不可 query-first）
  reserve 写 reservedExecSeq；settle/void CAS 匹配 reservedExecSeq（旧代一律失败）
  fail/touchHeartbeat/reanchorDeadline 带 execSeq（旧代 0 命中 no-op）
  rearm 事务: execSeq nextval+voidInTx 只释放旧冻结
    （re-reserve 废止——team-credit:105 reservedCredits>0→mayCall:false，
      rearm 内 re-reserve 后新 worker 必被静默跳过；re-reserve 留给新 worker reserve）
    +旧 DocDelivery superseded
  attempts=免费重试配额（≥3 EXHAUSTED）不混用
②ArtifactCommitService（资金五路径: text/image/video/edit/lighting
  ——shared artifact-core module 双 role〔API+worker〕+双 role DI 测试）:
  stageInTx（v13b durable——短事务不锁 balance，Media(processing)=统一 stage 句柄）:
    先落 Media(status=processing, objectKey/sha/size/sniff 已知字段,
    sourceIntentRowId/sourceExecSeq/artifactIndex) ON CONFLICT DO NOTHING
    →幂等返回 mediaId+同事务插 processing fact（payload 含 state）
    再对象上传（image/edit/lighting）: SafeRemoteFetch 下载
    （https+host allowlist+私网 IP 拒+maxRedirects:0+流式限长+content-type 白名单）
    →对象存储（key=artifacts/{teamId}/{intentRowId}/{execSeq}/{index}-{sha256}）
    →服务端自算 sha256（x-amz-meta-sha256 仅参考——客户端可控不可当完整性凭据）
    →sniff→回写 stage 行——崩溃窗: processing 行在，R3 可收敛（orphan sweep 以
    stage 行为准+覆盖旧 execSeq 前缀——rearm 换代后对象重复清理）
  finalize（短事务 <50ms/lock_timeout=3s/statement_timeout=5s——事务内禁外部 IO）:
    无锁读 intent 快照 → ledgerTx 首句 → lockBalance(teamId)〔契约 20〕
    → intent FOR UPDATE 重验（RUNNING∧execSeq∧reservedExecSeq）
    → 幂等检查〔CAS 前〕: 判据=intent 行状态（v13b: SUCCEEDED∧artifactState∈
      {materializing,stored}∧creditsConsumed=cost→幂等返回+补建缺行）
    → inserts/upserts（Media 状态提升〔registerInTx〕/MediaBinding/
      DocDelivery〔execSeq+targetField+targetItemId='' sentinel+expectedValue=fileIdRev 快照〕）
    → CAS updateMany（RUNNING∧execSeq→SUCCEEDED+artifactState）count===1 唯一凭据
    → settleInTx（只结算 reservedExecSeq===execSeq；失败整体回滚——不得 settle 失败仍交付）
  死锁 40P01/40001/55P03+P2024 有界重试 3 次+jitter
    （v13b: 多产物行删除——本批一 intent 一 artifact〔execution:539 单 result.url 实证〕；
     multiImage 多产物+slotId 不可变槽 id 归 Y2）
  kind 分支（v13b——ArtifactState 四态 {none materializing stored failed}）:
    text=跳过 registerInTx（DocDelivery kind=text 携 resultText——content 回显删除只写
      result〔亲验 :485 content=用户 prompt 回显〕；artifactState=stored）；
    image/edit/lighting=stage 行 finalize 提升 completed（artifactState=stored）；
    video=finalize 建 Media(status=processing, sourceUrl 专用列+预分配 key
      +provider 声明 mimeType)+DocDelivery(kind=fileId 交付 mediaId)+settle/complete
      +artifactState=materializing
      ——materialize 异步（MaterializeJob: 下载→MinIO→单事务 status=completed+size
      +sniffedMimeType+复用同一次下载算 natural/hash/mime+factVersion/outbox；
      幂等键=mediaId；processingLeaseUntil/processingAttempts 自有退避——与 intent
      attempts/rearm 解耦；成功→artifactState=stored；
      终态失败→幂等补偿退款+artifactState=failed+DocDelivery/exec errorCode=
      MATERIALIZE_FAILED（不清 fileId——UI 失败/重试非撤回交付）+告警；materialize 不写 doc）
  资金 quota=软限+claim 前预检: claim 前 usage+estimatedBytes≤limit 预检
    （estimatedBytes——processing 行 size=0 不占配额的洞；AI 生成不走 presign
    assertCanUpload=无限超配额）；finalize 超限告警+计数不回滚；
    registerInTx 禁调 assertOnConfirm+禁外部 IO
  统一不变量（v13b）: SUCCEEDED⇒settled∧DocDelivery(kind=fileId)∧Media 行存在
    ∧status∈{processing,completed,failed}（status=failed⇒幂等补偿退款+artifactState=
    failed；delivered 只表示引用已写不表示字节存在；text 唯一例外=resultText 非空）
③MediaRegistrationService（非资金唯一 Media 写入点——同 shared module）:
  prepareUploadInTx/registerInTx/confirmInTx/bindInTx 四形态
  （9 处 media.create 映射〔grep census——ai-image-edit:199+200 为同一调用续行〕:
    storage:37→prepare〔**补 projectId 落库**〕/media-process:194→register/
    ai-download:100→MaterializeJob 接管〔video〕/ai-image-edit:199→register/
    lighting:167→register/video-trim:110→register/stitch:97→register/
    generated-media:54→register/video-work:91→prepare）
  （幂等锚 registrationKey+Media @@unique([bucket,key])
    +confirmInTx 带 status='pending' CAS〔现状无事务无守卫〕）
  ——不碰 settle/complete/DocDelivery/exec
④DocDelivery 交付（单一 poller——v13b funding-only: 非资金路径零服务端 doc 写实证
  〔stitch/trim/separate 只走 emit 族，结果由客户端写 trimmedFileId 等〕；
  将来确需非资金服务端写 doc 时建独立 DocCommand 表——禁塞 execSeq=0 伪造代际）:
  认领: SUCCEEDED∧artifactState∈{materializing,stored}∧(pending∨delivering∧lease过期)
    CAS+SKIP LOCKED
  deliverArtifact 复合 op（事务内前置判定全过才写——stale/execSeq/expectedValue/
    节点存活性→superseded|orphaned|幂等；然后 data patch+exec done）
    expectedValue（v13b token 来源=fileIdRev）不匹配→superseded（用户 replace vs
    在飞交付竞态根修——applyWriteNodeDataToDoc 现状无条件 set；
    claim 装载 doc 时读当前 fileIdRev 捕获→finalize 写 expectedValue→apply 比较；
    DocDelivery 写 fileId 时 fileIdRev+1；replaceMedia 递增）
  按 project 批量: 一个 withSession 内全 apply → 一次 flush（带理由窄接口）
  'persisted'（或 noop∧isPersistedComplete∧目标匹配）→ 复核 target/execSeq/expectedValue
    → 一致才 mark delivered
  'retry(spooled)' → 无限重试不耗 maxAttempts+告警（磁盘安全——PG 停机>1h 不假失败）
  'retry(failed)' → 重试耗 maxAttempts+spoolDeadline 1h 兜底
  'terminal(fenced)' → 停 claim 等租约（非 failed）
  'terminal(fk)' → orphaned
  lease 覆盖 flush+recheck+mark；emit 在 mark 后；onModuleDestroy 停 claim/等在飞
  mark 成功后对该 mediaId lazy GET media-facts 补拉（pendingFacts 配套）
  dead 行: on-load reconcile/admin retry 重驱（v13b——dead 后节点永无 fileId）
  HttpCollabWritePort typed outcome（appended|transient|permanent|fenced）
    ——资金路径禁伪造 {written:true}（现状 :181-183/:206 瞬态耗尽返回 written:true）
⑤exec 投影: loading/skipped=worker strict Http（exec-only+execSeq）；
  error=DB+API reconcile（(FAILED,VOIDED)∧execProjectedExecSeq≠当前——活跃项目+24h 窗）；
  done=DocDelivery；alignExecFromIntents 重建（execSeq 序）；
  **socket setFileResult 降级本地 UI 状态不写 doc（v13b——DocDelivery=generated
  fileId 唯一写入者；emitNodeStatus 对 video 不传 fileId〔现状 :298 传 resultRef=URL〕）**
⑥reconcile=R3 自动收敛（v13 裁决 4）:
  所有自动收敛走 finalizeFromExistingMediaOrText(intentId,execSeq)（v13b 改名——
    同一幂等 finalize，避免执行者找不存在的 Artifact 表）
  动作表: SUCCEEDED∧产物存在∧未 settle→finalize 补 settle+DocDelivery；
    RUNNING∧provider 成功∧stage 行存在（Media(processing)）→finalize（provider 不重调）；
    SUCCEEDED∧delivery 缺失→补建；
    FAILED/VOIDED∧reserved>0∧**无 artifact/无 delivered**→voidInTx（幂等）
    〔v13b 守卫：有交付的失败态交人工〕；
    Media(processing) 源过期/终态失败→重试 materialize→超限 refund+failed+errorCode+告警；
    delivery failed（node 删/project gone）→orphaned+幂等退款；
    delivery failed（未知/基础设施）→重试上限→dead+告警不自动退款；
    台账不一致/对象缺失/无法判定→告警人工（歧义与资损风险绝不自动动钱）
  护栏: 每行 CAS+有界尝试 3 次 jitter+pg_advisory_xact_lock(hashtext(intentId))
    +审计行 reconcile_action{intentRowId/action/before/after/traceId}
    +auto_converged/manual_required 分计数
  backfillSucceeded/threeCheck resultRef/settleStranded probeArtifacts 三后门删除
    （直接改 status 路径全灭——保留入口改走 finalize；backfillSucceeded 禁写 SUCCEEDED+null）
  cleanTerminalIntents: artifactState 终态∧delivery 终态∧reserved=0∧7d
    （resultText 非空行→90d；**保留矩阵: 有 artifact 的 intent 不物理删——
    Media.sourceIntentRowId 悬空锚根修〔soft delete/FK ON DELETE SET NULL
    +保留 sourceExecSeq/registrationKey〕**）
  DocDelivery delivered 30d/MediaFactOutbox published 7d retention+dead-letter 告警
WriteOutcome 四态+同值 no-op（fast-deep-equal）+HTTP 端点真实四态维持 v10
```

- **幂等**：同 mediaId/交付重跑 compare-before-set 零增量；finalize 同 execSeq 幂等返回已有；materialize 按 mediaId 幂等。
- **8 类产物绑定矩阵维持**（资金五+非资金六经两编排器结构性覆盖；**binding 由惰性 reconcile 维护——非交付机制**）。
- **校验链**：DocWriteOpSpec+deliverArtifact/linkMedia op 进表+switch+never 维持。

### 3.2 尺寸消费+禁写门（Z5''/Z11''-v13b）

applyIntrinsicFit/尺寸消费维持 v10。**禁写门分层**（Z11''-v13b——**guard/strip=检测/诊断，安全边界=读侧 ACL**）：**stripServerOwnedData 只挂更新路径**（updateNodeData/updateConfig/diff dataPatch/undo 回放剥 CLIENT_FORBIDDEN_DATA_KEYS——**v13b 精确枚举 {fileId,resultUrl,videoUrl,result,natural,errorCode,fileIdRev}；不含 referenceImage/images/allImages/trimmedFileId/videoFileId/audioFileId**〔上传路径全在更新路径上，键名一刀切会剥掉上传〕；**新建路径保留 fileId/images[].id**）+generated fileId 服务端所有权+replaceMedia 显式命令（递增 fileIdRev）+DocDelivery expectedValue=fileIdRev CAS（用户 replace 竞态根修）+**socket setFileResult 降级本地 UI 不写 doc**+**服务端 writeNodeData manifest 拒写客户端禁写键（端点 op 白名单 exec-only；键集单源两集合四处共用导出常量——v13b 正交化：SERVER_WRITABLE={fileId,resultUrl,videoUrl,result,natural,errorCode,fileIdRev}〔**content 出白名单**——亲验 :485 content=用户 prompt 回显，text 交付只写 result〕/CLIENT_FORBIDDEN 同集〕**+**meta.schemaVersion 例外修复=恢复 current（v13b——非删除：docShape:87-91 无戳∧有节点同拒）+重连（shadow 也恢复）**+Yjs 直发面归 post-apply/guard 检测（shadow 定档+generated/uploaded 类型分流+检测到+可修复+读侧拒绝）；ImageItem.url 类型级消灭；**读 ACL 单门 assertMediaReadable**（url/batch/content/facts/thumbs/snapshot 注入全覆盖——校验项目成员+Media.teamId===project.teamId；**projectId=null 退化 team member**〔素材库〕；公开页按已发布 workId 授权不按 mediaId）。

### 3.3 只读命令边界+resync 分流（Z6'' 维持 v10）

单源门+viewer 早退+七命令补门+dimensions 分表+resync 三路+节流+key-too-long→repair（=in-place）+闩锁维持。

### 3.4 创建默认与兜底（Z8'' 维持） / 3.5 删除面（维持） / 3.6 入口 guard（Z19''-v13）

维持 v10（guard 检测域扩：exec map+data 身份键客户端直写+**meta.* 根**）；**验收口径 v13 改「检测到+可修复+读侧拒绝」**（shadow 定档；重复违规 close+诊断；server/maintenance origin 零误报；合法内容零误报）。

## 4. 片序与执行门（v13b 对齐 plan v10.1 T0-T28；每片出口=用户确认点）

| 片 | 内容（T 卡） | 出口判据 |
|----|--------------|----------|
| **C0a（spike）** | （v6 完结） | ✅（历史） |
| **P0-pre（T0-T3）** | T0 pin（yjs/sharp/fast-deep-equal/file-type 16.x+ffprobe CI+**CI S3 服务**）；T1 改名 StoredNodeRecord；T2 collab-doc-ops；T3 Prisma（**execSeq DB sequence+reservedExecSeq/execProjectedExecSeq+providerRequestId+providerTaskId**/**ArtifactState 四态含 materializing**/probe 族+factVersion+factType/MediaBinding **纯索引列（attach 死列删）**/GenerationIntent/DocDelivery 全量〔**funding-only+targetItemId sentinel+spoolDeadline**〕/**MediaFactOutbox**/Media status enum+processing 族+sourceUrl 专用列/@@unique/删除 repairRev） | 三面 tsc 绿+全量绿+census+pin 绿 |
| **B1a（T4）** | 只读门+七命令 | G34 |
| **C0b（T5-T10，v13b 拆卡）** | **T5a** outbox（emitter at-least-once+REST **POST**+join+ImageItem 去 url+processing fact）；**T5b** MIME+content 两态代理+读 ACL 单门+SafeRemoteFetch+BigInt 四读路径；**T5c** /flowai 面迁移（24 处/15 文件+mediaContentUrl 单点+census〔nginx -T 实证先行〕）；**T6a** execSeq/claim/reserve/rearm（moveToDelayed 三态+providerRequestId write-ahead+fail/touch/reanchor execSeq 化+键集单源）；**T6b** ArtifactCommit（stageInTx durable+finalize 短事务+materializing+幂等判据+锁序+shared module 双 role DI）；**T6c** DocDelivery（单一 poller+fileIdRev CAS+带理由窄接口 flush+复核+dead 重驱）；**T6d** MaterializeJob+R3 reconcile（finalizeFromExistingMediaOrText+动作表+守卫+审计）；T7 probe（参数+sniffed 路由+40MP——**仅上传路径**）；T8 两编排器 producer 分层接线+binding 惰性 reconcile（create-only）+socket 降级；T9 stripServerOwnedData〔**更新路径 strip（键集精确枚举）/新建保留**〕+manifest 拒写+端点白名单+**meta.schemaVersion 恢复 current**；T10 消费端〔pendingFacts+lazy fetch〕+E2E | 五面自检表+G42-G44/G46/G48/G51/G58 v13b 全绿+**提前 soak 一轮** |
| **A1（T11-T18）** | 维持 v10（placement/slot/四出口/双 bump/写链/回流面）+**DOC_NODE_KEYS 契约表+compareExecSeq 单源** | G54/G55/G11/G57/G29 |
| **A2（T19-T21）** | T19 repair=**in-place 主路径**（维护门+applyWriteFreeze+**RW 写屏障+advisory lock**+分块 ≤64KB 独立事务+幂等重跑+**单块预算**+vacuum 兜底运维窗限定+purgePidCaches 修复〔vacuum 路径〕）+soft/hard+病理档；T20 guard（检测/诊断口径+**meta 恢复 current**+generated/uploaded 类型分流+ACL）；T21 CLI（默认 in-place） | G45/G53+S1+G14 |
| **A3（T22）** | 五件套+**execSeq 矩阵（moveToDelayed）+flush 四窗+in-place repair 并发（含写屏障持锁）**+真连 | G12/G17/G55/G58 |
| **B1-B2（T23-T27）** | 维持 v10（DocShapeInvalid/resync〔**repair UX=in-place 同步 200/202——无 generation reload**〕/删除面/applyIntrinsicFit/autoOrigin） | G19/G7/G28/G24/G56 |
| **B3（T28）** | 双 bump 门+reset（六表）+verify+UX 签字+soak+**rebuild cutover runbook** | G21/G33/G35/G57 |

## 5. 验收判据与先红门禁清单（v13b 权威表——v10/v11/v12/v13 门禁判据随裁决增强；G36-G41/G49/G50/G52 废弃号不复用）

| # | 门禁 | 先红判据 | 绿判据 |
|---|------|----------|--------|
| G1-G15/G17-G20/G22/G47 | 维持 v10 口径（G17 改口维持） | — | — |
| **G11** | 版本双门 | 旧 csv/旧 doc 放行红 | 双 bump 拒连+拒载+IDB/Redis 键失效 |
| **G21** | reset 演练 | 写中 truncate 回灌红 | 九步（六表清）两轮零回灌 |
| **G23（v11）** | probe 韧性 | 失败丢/热循环红 | **图片批 4 lease 180s/视频 batch 1 lease 5min/nextProbeAt jitter/sniffed 路由/索引**+skipped 触发点+server done+fallback |
| **G28** | 公开 natural | fallback 红 | payload 带 natural{width,height}（剥 mediaId/probe 域）+viewer fit |
| **G29** | 序键 | 中点 630 反面 | 四曲线+等值邻居 needs-layer-repair |
| **G33** | reset 版本门 | 回灌复现 | 双 bump 单动作两门 |
| **G34** | VIEWER 矩阵 | 漏门红（含七命令） | 零 cs/doc/DB 写 |
| **G35** | soak | 单端绿≠浏览器绿 | 10k+10 客户端数字 SLO+**artifact commit p95/delivery lag/outbox lag/applied_unpersisted=0** |
| **G42（v13b）** | media 读模型 | watermark 漏发复现+**fact 先于 fileId 到达丢 natural** | **MediaFactOutbox：乱序提交必达/重复投递幂等（factVersion 去重）/correction 新 version 必达/processing fact 同事务推送（UI「处理中」来源）/惰性 reconcile 后到补发/IDOR 拒（项目成员+Media.teamId）**+**REST POST（≤200 ids）**+pendingFacts 消费+mark 后 lazy GET 补拉+published retention；doc 四根 |
| **G43（v13b）** | producer 分层 | **非资金路径强塞 ArtifactCommit 复现（无 intent 空指针）+非资金 doc 写伪造 execSeq=0 复现** | 资金五走 ArtifactCommit（**video=Media(processing)+fileId+artifactState=materializing；text 零 Media 只写 result**）/**非资金零 doc 写实证——DocDelivery funding-only**（trim/stitch/separate 不经 DocDelivery）；非资金走 MediaRegistration 四形态（**9 处 media.create grep census 零第二处——排除 seed/test**）；registrationKey 幂等；**prepareUploadInTx 落 projectId；confirmInTx 并发双 confirm 恰一 no-op**；shared module 双 role DI 测试 |
| **G44（v13b）** | WriteOutcome+复合 op | written 现状+合成红+**expectedValue 无 token 来源（v13 空措辞）** | 四态+deliverArtifact 复合 op+**前置判定在 data patch 前（stale/execSeq/expected 全过才写）**+同值 no-op deep-equal+**fileIdRev token 闭环（claim 捕获/finalize 写入/apply 比较/replace 递增——双向时序：旧代 delivery superseded 不覆盖用户值）** |
| **G45** | 无自动重排+G17 改口 | 整层覆盖复现 | 维持 v10 |
| **G46（v13b）** | 交付+binding | **上传路径被 strip 复现（键名一刀切——referenceImage/images/allImages）+copy 副本空图（v12 strip 全构造点）+副本永久转圈（copyPlan:63）+跨 team paste 泄漏** | **strip 键集精确枚举：上传引用键零剥（上传参考图/多图上传后 doc 有 referenceImage/images）**+**socket done 事件零 doc fileId 写（DocDelivery 唯一写入者）**+copy 保留 fileId 立即渲染（新建路径零 strip）+normalizeCopiedNodeData+**binding 惰性 reconcile create-only（原资金节点扫描后锚仍在——真 PG 用例）**+跨 team paste strip+读 ACL 403+Media GC 护栏+targetItemId 非空 sentinel（**同键 NULL 双行必失败**）+**一 intent 一 artifact（targetItemId=''）** |
| **G48（v13b）** | 资金矩阵 | **反例 A/B/C 全复现+rearm 内 re-reserve 后新 worker 静默跳过+providerTaskId 零落库+EXEC_STATUS_KEYS 无 execSeq（UNKNOWN_KEY 红）+「skip 后 ack→旧 worker 真死零交付」复现+stage 后 finalize 前崩溃=对象孤儿** | **execSeq：同 job 双 worker 三态（心跳新鲜→moveToDelayed 不 ack——旧 worker 在 skip 后被 kill→grace 后重投接管/完成，零「completed 但 RUNNING 悬挂」；过期接管 fence/未知重试）/新 intent 新代不被挡/旧 error 不覆盖新 loading**；**EXEC_STATUS_KEYS+execSeq 进 manifest+compareExecSeq 单源（property test）**；finalize 锁序 balance→intent（**死锁注入零 40P01/55P03 或可重试收敛**+**事务注入 100ms sleep 验证锁等待/池不恶化**）；**stageInTx durable：stage 后 kill -9→R3 凭 processing 行收敛（HeadObject 命中→finalize；对象缺失→重下/退款）；幂等前置=artifactState∈{materializing,stored} 判据**；settle 失败整体回滚；**rearm=nextval+voidInTx 只释放**；**providerRequestId submit 前落库+providerTaskId 后落库+query-first 键序 requestId→taskId（kill worker after submit→重跑零重复 provider submit）**；**video=Media(processing)+artifactState=materializing（processing 期可播/seek；materialize 幂等重试不重复 Media；**成功→stored**；源过期 410/重试/终态失败自动补偿退款+errorCode=MATERIALIZE_FAILED）+quota claim 前预检（estimatedBytes）**；fail/touch/reanchor 旧代 no-op；**R3 五窗收敛+FAILED∧reserved>0 void 加「无 artifact/无 delivered」守卫+backfillSucceeded 禁写 SUCCEEDED+null+审计行** |
| **S1（v13b）** | guard（exec+身份键+meta 域） | spike 未做 | 报告+post-apply 恒做+shadow 定档+**meta.schemaVersion 恢复 current（shadow 也恢复）——篡改后项目仍可 load（非删除：无戳∧有节点同拒 docShape:87-91）**+generated/uploaded 类型分流 |
| **M1/M2（v13b）** | probe+MIME | sniff 缺失+**生产 /flowai 通路渗透**红 | 嗅探（file-type 16.x 或自研）+presign 条件（**Content-Type 进 fields——否则全 403**）+**media content 两态（ready: Range/HEAD/ETag/304——视频可拖动；processing: allowlist 代理+上限降级 410/425）+MinIO 直链禁用+读 ACL 单门（跨项目 mediaId 403/公开页按 workId/projectId=null 退化 team member）**+sharp 重编码+SVG 拒+**size BigInt+BigInt.toJSON 四读路径**+/flowai 面迁移（mediaContentUrl 单点+census）+**SSRF 用例**+**sourceUrl 零泄漏（DTO/select 测试）** |
| **D2** | 版本双门 | 双源/循环红 | 双 bump 单动作；Redis 故障不拒连 |
| **G51（v13b）** | 交付收敛 | 崩溃零 fileId 红 | pending→deliverArtifact→flush→delivered（单一 poller）+**dead 行 on-load reconcile/admin retry 重驱** |
| **G53（v13b）** | repair=in-place | **现状无 repair 复现+「repair 必须断线 reload」假预设红（10k 重复 order 修复中客户端连接保持）+「总量超预算退 vacuum」退化复现** | **in-place 全绿：10k 重复 order→修复中零断线零 reload 零 IDB purge/离线客户端事后合并零节点复活/repair vs vacuum 409/**写屏障（持有 delivery 的 withSession 启动 repair→等待不丢写；repair 期间新 delivery 503）**/维护窗 delivery 退避/崩溃重跑幂等/等价断言（忽略 order\|slot+exec 值）**；**不可表达结构回退 vacuum：旧客户端 4410+一次 reload+purgePidCaches 全代清（真 IDB 断言）——单块预算，总量大就多块** |
| **G54** | order/slot 写链 | 拖序不持久红 | 维持 v10+重复键层 repair+**DOC_NODE_KEYS 契约表 census**+**copy 重新分配 placement/order（副本同层同 order 重复键复现——allocator 唯一入口）** |
| **G55** | slot 单实现 | LWW 丢格+满员 append 红 | 维持 v10+cells 零残留+**slot 派生单源断言** |
| **G56** | display | 二次旋转红 | EXIF 5-8+imageRotation 交换+分镜跳过 |
| **G57** | 旧 bundle/旧 doc | 循环+误读红 | csv 一次 reload+docSchema 拒载 |
| **G58（v13b）** | 交付持久化崩溃窗 | **「mark delivered 时 doc 未落库」复现（debounce 窗 kill——扣费无产物无重试）+三态无理由下 spooled 被当 failed 耗 attempts+PG 停机>1h spool 判死假失败** | **flush 四窗全收敛**（apply 前/flush 前/flush 后 mark 前/mark 后 emit 前）；**载体=带理由窄接口 `{persisted}|{retry,spooled|failed}|{terminal,fenced|fk}`（显式 storeDocumentSerialized——非 ephemeral-disconnect）**；spooled 无限重试不耗 maxAttempts+告警（**PG 停机>1h 保持 pending 非 failed**）；failed 耗 maxAttempts+spoolDeadline 1h；fenced 停 claim 等租约；fk→orphaned；批量一次 flush；flush 后复核（superseded/orphaned/delivered——**用户 replace vs delivery 双向时序：superseded 不覆盖用户值**）；**exec alignExecFromIntents 重建** |

**观测增补（v13）**：v10/v12 全量+`artifact_commit_total{result}`+`artifact_commit_tx_seconds`+`settle_deadlock_retry_total`+`intent_epoch_stale_total`+`doc_delivery_applied_unpersisted`+`doc_delivery_lag_seconds`+`media_fact_outbox_lag/dead_letter`+`exec_projection_stale_rejected_total`+`maintenance_write_rejected_total`+`worker_write_scope_rejected_total`+`probe_lease_expired_total`+`artifact_quota_exceeded_total`+**`media_materialize_lag/attempts_total{result}`（v13）+`reconcile_auto_converged_total{action}`/`reconcile_manual_required_total`（v13）+`media_content_proxy_fallback_total`（v13）+`guard_meta_write_deleted_total`（v13）**。

## 6. 非目标与移交

| 项 | 归属 |
|----|------|
| z 序 UI/闩锁删除/SCHEMA=4 | 后续批/Y1c-1/Y1c/Y3 维持 |
| v2→v3 兼容 | 无（rebuild cutover runbook——**v13：非 additive DDL+pg_dump/MinIO 备份+队列 pause+双进程停机顺序+回滚=restore**） |
| BullMQ probe 队列/装载期自动 rebalance/doc 内 media 根/DEPLOY_EPOCH/DeliveryState 资金语义/data.cells·capacity | v9/v10 废止维持 |
| **repairRev（CanvasDoc 列）** | **v11 废止**（v13：in-place 无需任何 rev/generation 语义） |
| **repair=generation 跳变（常规路径）** | **v13 废止**（in-place 主路径；vacuum 仅运维窗兜底——preVacuumSv 对未同步离线客户端无效实证 §1.10） |
| **vacuum 自动回退（无 generation 握手前提下）** | **v13 禁止**（仅「确定无离线客户端」运维窗；**连接代际握手=client 回传最后已知 generation，服务端 SyncStep1 前比对——Y2**） |
| **attach consumer（独立 poller）** | **v13 废止**（两大存在理由消灭——裁决 1/3；交付 owner 收敛单一 DocDelivery poller；MediaBinding 降级纯索引由惰性 reconcile 维护） |
| **非资金路径并入 DocDelivery（v10 T8 lane）** | **v13b 废止**（亲验零服务端 doc 写——stitch/trim/separate 只走 emit 族，结果由客户端写 trimmedFileId 等；**DocDelivery funding-only，intentRowId/execSeq 非空，禁 execSeq=0 伪造**；将来确需时建独立 DocCommand 表） |
| **strip 键名一刀切（referenceImage/images/allImages 进禁写集）** | **v13b 废止**（上传路径全在更新路径上——键集精确枚举 {fileId,resultUrl,videoUrl,result,natural,errorCode,fileIdRev}，上传引用键零剥） |
| **socket setFileResult 写 doc fileId** | **v13b 废止**（降级本地 UI 状态——DocDelivery=generated fileId 唯一写入者；emitNodeStatus video 不传 fileId〔现状传 resultRef=URL〕） |
| **「多产物一次事务 N Media」** | **v13b 废止**（无 producer——execution:539 单 result.url；本批一 intent 一 artifact+targetItemId=''；slotId 多产物归 Y2） |
| **「总量 256KiB 退 vacuum」** | **v13b 废止**（分块下不可达且自相矛盾——单块预算，fallback 只留给不可表达结构） |
| **copy 清锚+attach 交付链（sourceRegistrationKey/claim sourceIntentRowId IS NULL）** | **v13 废止**（方案二+：新建保留 fileId+binding 惰性 reconcile） |
| **probedAt watermark emitter** | **v11 废止**（MediaFactOutbox） |
| **统一 ArtifactCommit（非资金路径）** | **v11 废止**（两编排器分层） |
| **withDoc unloadImmediately 逐条 flush** | **v11 禁用**（flush 批量） |
| **If-None-Match 条件写** | **v12 废止**（x-amz-meta-sha256+服务端自算 sha256 校验替代） |
| **attach/delivery DocWriteCoordinator** | **v12 不采纳**（降 P1 进程内 per-project 互斥） |
| ExecStatusOutbox 表 | v10 不采纳维持（execProjectedExecSeq reconcile） |
| emitter 多实例（Redis pub/sub/adapter） | **Y7**（偏离表 #6） |
| fileId 命令族第二步 | Y1 末/Y2 边界维持 |
| 跨 team Media 复制 | Y2 维持（跨 team paste=strip+显式复制命令 Y2） |
| **R2 大重构（Artifact 一等表〔intent→N artifact〕/mediaRef typed-ref 取代裸 fileId/DocDelivery 引用 artifactId/统一 text·image·video 语义去 kind 分支/去 fileId 所有权与 strip/若 Y2 前未处理则一并删双 bump）** | **Y2 立项候选（v13 裁决 6 登记——本批零代码）**；触发条件：一 intent 多产物成产品需求/跨项目 media 引用/API 实例>1/doc schema 变更>1 次/季；本批 schema 决策保持 R2 兼容（稳定 Media.id/DocDelivery 作 outbox/execSeq 代际/不引入与 Artifact 表冲突字段） |

**reset runbook（v13）**：停双进程→maintenance→队列 pause→**pg_dump+MinIO 备份**→清表（CanvasDoc/CanvasDocUpdate/MediaBinding/DocDelivery/**MediaFactOutbox**/Media 生成物+spool+Redis+MinIO temp+IDB 预置）→**migrate（check-migration-additive 对非 additive DDL 实判——按 rebuild 设计不走 additive 门）**→双 bump→SCAN→重启→两轮验证→**回滚=restore 备份非 down migration**。

## 7. 纪律与观察项

- 历轮留痕维持（git 历史）。
- **v11 留痕**：①「再加一层机制」是三轮共同弯路（attempts→intentAttempts→execSeq 的教训：**代际必须是外部单调序，不能复用业务计数器**；watermark→outbox 的教训：**游标永远追不上乱序提交，用待办队列**；repairRev→generation 的教训：**fence 必须内容级（SV 可证）且与快照同事务，连接级参数 fence 挡不住重连**）；②**锁序契约（契约 20）是全仓不变量——任何新事务先 grep 既有锁序**；③「单事务」必须落为 InTx 方法族+锁序+CAS 凭据三件套，一句话裁决不够；④现存 bug 三处（exec 守卫反例 B/rearm 静默跳过/purgeForeignCaches 反语义）由外审挖出——**评审输入要包含"现状缺陷"维度**；⑤外审的部署形态断言要核验（生产 /flowai 认知偏差——上传侧渗透才是真问题）。
- **v12 留痕**：①**「分配点越多越安全」反例**——v11「nextval 三处」中同 job 重入一处是自伤（新 seq fence 掉活着的旧 worker+继承后 mayCall 未定义=悬挂）；**代际分配必须区分「新执行段」（nextval）与「续跑」（复用）**；②**manifest 是 op 域第一道墙**——新键进 doc 必须先进 manifest 键集（execSeq 差点门口死：EXEC_STATUS_KEYS 无该键则 writeExecStatus 直接 UNKNOWN_KEY）；③**boolean 返回值混五态=状态机债**（storeDocumentUnlocked noop/spool/FK/fenced 同返 false——五态必须判别联合载体，禁旁路猜）；④**裁决措辞要带 claim 面**（「资金型 binding 跳过 fileId 写」不写 claim 条件→copy 矛盾漏网；「不回送未修改键」不写无条件→跨窗口 diff 漏网）；⑤外审误判六条过滤存档（coordinator 正确性 P0/零费 settle/P2002 驱动/grep 门禁语义/fillDoc/fanout——**"正确性推演"要先核共享状态载体**：两 poller 共享 Y.Doc+saveMutex 则交错无害）；⑥**多产品语义要按 kind 分化不变量**（text/video/image 三态谓词不同——单一谓词迫使 video 等下载或 text 造假 Media）。
- **v13 留痕**：①**「fence 挡不住未同步者」是内容级 fence 的普遍边界**——preVacuumSv 只覆盖服务端见过的历史，对从未同步的离线 clientID 无效（v11 把它当 repair 的正确性支柱=把低频运维风险常态化为常规路径）；**凡依赖「对方知道我改了」的 fence 都要问：新加入者/从未握手者走哪条路**；②**裁决文本自相矛盾要在开工前抓**（v12「rearm 内 release+re-reserve+新 worker 拿 mayCall:true」两半互斥——**把裁决写成可执行语义时先在代码里走一遍现状**）；③**「无写库点的列」=设计意图未落地**（providerTaskId 列在+注释说保留——从未写入过何谈保留；注释引用「query-first」但调用不存在——**注释不能当实现**）；④**身份键进 doc 前先数消费者**（videoUrl/resultUrl 在 web 零消费者=历史残留；fileId 全走 useMediaUrl——删 URL 键是净简化非破坏）；⑤**「检测」与「拦截」是两种承诺**（Yjs 无字段级 ACL——把 guard 验收写成「拦住」必然假绿或误杀；安全边界要放在唯一可验证处=读侧 ACL）；⑥**「为对称性付复杂度」反例**——image/video 统一「ingest 后 finalize」会用存储抖动污染资金状态机；**统一不变量的正确姿势是措辞覆盖（status∈{processing,completed}）而非时序强行对齐**；⑦**新建路径 strip 是自造困境**（strip 新建→副本无 fileId→需要 attach 再交付→需要 binding 复制→需要服务端映射——一层垫片引出四层垫片；放开新建保留即整链消失）；⑧**外审报告也要核验**（本轮三报告各含事实错误：11 处实为 9 处/「providerTaskId 已落库」子代理误报经亲验纠正/「CollabSessionMeta.generation 现成」过乐观——**核验子代理结论与外审结论同等必要**）。
- **v13b 留痕**：①**「交付面假设要先 grep doc 写面」**——v10「非资金并入 DocDelivery」lane 是基于首轮外审的错误假设，第二轮亲验 grep 证明非资金路径零 doc 写（stitch/trim/separate 只走 emit 族）——**为不存在的路径造机制（source 泛化）是负收益**；②**BullMQ skip 必不 ack**——processor return=completed 是队列语义不是措辞问题，「心跳新鲜→skip」若 return 即制造「旧 worker 真死零交付」悬挂（**写 skip 语义时先问：这个 job 还会重投吗**）；③**崩溃窗句柄要 durable**——stage 在事务外+零 DB 变更=「对象在 DB 无记录」孤儿；**任何"事务外做完了什么"都要先落 durable 行再做**（Media(processing)=统一 stage 句柄）；④**修复动作要可逆验证**——meta.schemaVersion「删除」在 docShape 无戳拒载下等于换一种 brick（**修复前先走一遍加载路径**）；⑤**窄接口也要带理由**——spooled（磁盘安全）/failed（内存丢失）/fenced（等租约）/fk（orphaned）四个决策不同，混成 not-persisted|terminal 会让 poller 误判（**三态够、reason 必带**）；⑥**键集要按"谁合法产生值"枚举而非按"键名像不像身份键"**——referenceImage/images/allImages 是用户上传引用，进禁写集=上传全断；⑦**「maintained 的门」拦不住「正在飞的门」**——writesSettled 是持久化谓词非写屏障，在飞 withSession 不受拦（**排他互斥必须等 refcount 归零**）；⑧**回显写入是隐藏的双写者**——text content 回显（data.content||prompt）看似无害，实为服务端覆盖用户输入的竞态面（**服务端只写它自己产生的东西**）。
- 观察项：slot 冲突频率；fileId superseded 频率；产物媒体库保留期 N；**outbox lag/死信率**；**execSeq stale 频率**（旧 worker 迟到提交量）；**软限超限频率（artifact_quota_exceeded_total）**；**pendingFacts 命中率**；**materialize 失败/补偿退款频率+reconcile auto_converged vs manual_required 比例+guard 检测命中分布+content proxy processing 降级频率（v13）**；**moveToDelayed 重投频率+fileIdRev superseded 频率（v13b）**。
- harness 真连 provider destroy 走 scripts/lib/provider-late-reconnect-guard。
- manifest 矩阵对称（deliverArtifact/linkMedia 进表+身份键服务端拒写行+**execSeq 进 EXEC_STATUS_KEYS**）。
- guard 与 readOnly/帧闸/quota 只加不减。
- §0.2 v11 修订（②⑪⑫⑬+⑨废止）经用户确认（2026-10-18 四次裁决）；v12 修订（⑪更新+⑭-⑰+Z1''/Z4''/Z7''/Z11''/Z14''/Z18''-v12 改）经用户确认（2026-10-18 九次确认）；v13 修订（②⑮⑯⑰更新+⑱-㉓新增+Z1''/Z4''/Z7''/Z11''/Z14''/Z18''-v13 重写+残余 P0 十三条）经用户确认（2026-10-18 十次确认——六项裁决+四分叉裁定+三点待确认项全部落地）；**v13b 修订（⑨⑪⑬⑭⑲㉒㉓更新+㉔新增+D5/Z1''/Z4''/Z7''/Z11''/Z13''/Z18''/Z19''-v13b 重写+§1.11 核验行+§5 六门 v13b 化+§6 四行废止+T5/T6 拆卡）经用户确认（2026-10-18 十一次确认——v13 六裁决方向全部维持，本轮=边界收口十一条+consistency pass）**；后续变更走 §0.4。
