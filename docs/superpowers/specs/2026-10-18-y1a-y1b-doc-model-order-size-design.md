<!-- doc-status: active -->
# Y1a+Y1b：doc 模型 v3·序与尺寸/只读（B 类合并批设计）

- **立项日**：2026-10-18；**唯一上游依据**：[2026-10-06-canvas-yjs-arch-upgrade-review.md](2026-10-06-canvas-yjs-arch-upgrade-review.md)（master spec v8.3）§0.2 Y1a/Y1b 两行+§0.1 裁决（D5/D4/E68/C7①③）。
- **B 类合并立项**（Y1a+Y1b——E6 序域与 C5↔D4 同批硬约束共用）；plan=`../plans/2026-10-18-y1a-y1b-doc-model-order-size.md`（**v9——九轮外审收敛后当前执行版**；T0-T28/9 片）。
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

## 0.1 本批有效裁决（master 内联+本批 Z'' 系）

| 编号 | 裁决 | 效力 |
|------|------|------|
| **D5** | order 仅同 parentId 层内生效；投影数组序=层序遍历+同层 (order,id)；不设跨层全局序；**MAINTENANCE_TRANSACT_ORIGIN**（withSession origin 参数前置；repair 经 vacuumReplace 单事务——origin 语义仅 CLI/维护窗内） | §2 |
| **D4** | 上传=服务端元数据命令写；生成=落地补一次解码写；视频=受控一次性 bootstrap（`data.sizeMode`）；**媒体事实真源=Media 表（DB）——REST/MediaFactOutbox 推送/快照 join 三出口（Z1''）** | §3 |
| **E68** | 读侧全函数/写侧显式拒绝/禁修复写回 doc 维持 | §2/§3 |
| **C7①③** | 版本协商拒旧（**双常量 bump：csv 连接门+docSchema 数据门——Z9''-v10**）+「排空切换 runbook 进 Y1」 | §6 |
| C5/C6/C5↔D4/D13/E6/E8/E15 | 维持 | §2/§3 |
| **Z1''（v12 补）** | **media facts=Media 读模型+MediaFactOutbox**：Media 表唯一权威；doc 四根不动；读出口：①REST `GET /api/projects/:id/media-facts?ids=`（≤500+项目成员**且按 binding/project 归属校验**〔join MediaBinding.projectId ∪ Media.projectId——跨项目 IDOR 拒〕+ETag 短 TTL）②**MediaFactOutbox 表**（`id BigInt autoincrement`/mediaId/projectId/factVersion/payload/state pending\|published\|dead/attempts/nextAttemptAt；**v12：`@@unique([mediaId,projectId,factVersion])`**——三写入点并发同版本插重行免疫；写入点三处=probe done/server natural/attach 创建时若 fact 已存在——**同事务插入**；消费=API emitter `state='pending' ∧ nextAttemptAt<=now ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 200`→emit `project:<id>` 房间 `media:fact{mediaId,version,fact}`→published；失败退避；耗尽 dead+告警；**无 watermark——晚提交的行仍是 pending 下轮必达；重启零回放；correction 必产生新 version**；**emitter 单实例假设显式化**〔ecosystem instances:1——多实例归 Y7 评估 Redis pub/sub〕）③快照/viewer=服务端 join 注入 `RawNode.natural{width,height}`（公开 payload 携带——G28）；web=mediaFacts store（重连/切项目全量拉+按 factVersion 忽略旧+**v12：pendingFacts 短 TTL Map——fact 先于 fileId 到达时暂存、fileId 到达即消费（「忽略未知 mediaId」单一路径废止——丢 natural 到重连）+delivery/attach mark 成功后对该 mediaId lazy GET 补拉**+切项目清空） | §3.1 |
| **Z2''（维持）** | 四类型链（Raw/Stored/Projected 7+(order\|slot) 判别联合/CanvasStoreNode）+三函数读模型维持 | §2.1 |
| **Z3''（维持）** | DOC_NODE_KEYS 7 键三处接线；NODE_ENVELOPE_KEYS 不动 | §2.3 |
| **Z4''（v12 补）** | **repair=一次 generation 跳变的 doc rewrite**：`POST /projects/:id/collab/order/repair`（OWNER/ADMIN，异步 202+jobId+单飞）→执行体**复用 vacuum 协议**：acquire vacuumGate（与 vacuum 共享互斥——不另起 repairingDocs）→beginVacuumEra（冻结全连接+hardClose 4410〔reason 可带 'doc-repairing'〕+serving 门拦新连接）→quiesce（writesSettled 覆盖服务端 outbox 写：DocDelivery/attach 消费者在维护门内 503 退避）→离线装载→纯函数重排（受影响层按 (oldOrder,id)+分片语义在离线构建中无意义——整体重建）→**等价断言=忽略 order|slot 的节点/边/data 内容等价（v12：exec 根属"内容"——值级等价+重建深拷贝保留；vacuumEquivalent 现状只比键集合 registry:655-663 属勘误）**→单事务 vacuumReplace（state+preVacuumSv+generation+1+删增量行+advisory lock）→purgeDocState+invalidateSnapshotCache→释放 gate；**客户端零新协议**：旧客户端重连 SyncStep1 覆盖 preVacuumSv→4410 doc-generation-stale→consumeGenerationJump 单链（undo clear→导出未同步→purge→reload）；**purgePidCaches 修复**（generation jump 清同 pid 全部代——现状反语义 bug 根修+真 IDB 测试）；ack/maintenance-start 降 UX 提示（超时照常 close 不中止 repair）；soft(24)/hard(128)/load 病理档 reaper/repair CLI 维持（CLI 经维护租约）；**repairRev 删除**（doc-status 可带 epochReason 审计）；离线客户端 pending 由 preVacuumSv 内容级 fence 拒（不可合并——导出/放弃显式出口） | §2.4 |
| **Z5''（维持 v10）** | applyIntrinsicFit=纯函数（store 数据源/display 契约 EXIF 5-8/imageRotation 用户变换交换/分镜跳过/sizeMode/clamp/viewer 纯函数） | §3.2 |
| **Z6''（维持 v10）** | 只读命令门（B1a+七命令补门）+dimensions 分表+resync 三路+节流+闩锁维持 | §3.3 |
| **Z7''（v12 改）** | **probe 单相+MIME 安全+attach 消费者**：probe 相（worker——重计算）：claim `probeState IN(pending,running∧lease过期) ∧ status='completed' ∧ **sniffedMimeType** image/video 非 SVG ∧ deletedAt IS NULL`（**MIME 路由用 sniffed 非客户端声明**）SKIP LOCKED+probeRunId CAS——**图片批 4+lease 180s；视频 batch=1+lease 5min**（覆盖下载+ffprobe 最坏）；nextProbeAt 带 jitter 指数退避；索引 `@@index([probeState,nextProbeAt])`；create 面置 pending|skipped+**confirm 后按 sniffed 重算 probeState**（伪报 audio 的图片不再永 skipped）；server natural 同事务置 done+**factVersion 推进+outbox 插入**；图片 sharp limitInputPixels **40MP+downscale 产品策略**（超大图 typed 拒+UX 提示——产品参数 UX 签字定）+并发 1+EXIF 5-8 交换；视频 ffprobe 15s+SIGKILL+protocol_whitelist+CI/部署 pin；metadata 只留 codec/duration/bitrate；**MIME 全链**：confirm 读对象头 file-type 嗅探（成熟库）→非白名单拒+删对象+计数→presign POST 增 Content-Type 条件（starts-with image//video//audio/）→**媒体消费走 API 代理流式 `GET /api/media/:id/content`**（服务端查 Media+按 sniffedMimeType 设 Content-Type+非白名单 attachment+CSP sandbox——**生产 MinIO 直链禁用**）→图片 probe 后 sharp 重编码剥 polyglot/EXIF 载荷→SVG 一律拒→**生产上传 /flowai 渗透修复**（mediaUploadUtils 改写逻辑改环境感知）→Media.size BigInt；attach 消费者（API 进程）：claim `attachState IN(pending,attaching∧lease过期) ∧ Media.status='completed'`（不 JOIN probeState）→linkMedia 原子 CAS（withSession 内：节点缺失→orphaned；非空∧≠expected→superseded；同值→applied）→attached；**attach=只填空（expectedValue=空）——非空替换必须走 replaceMedia 显式命令**；targetField+**targetItemId**（稳定 ImageItem.id）定位+**v12：词表补 videoUrl/resultUrl**；**v12：attach claim 条件加 `sourceIntentRowId IS NULL`**（资金原件 binding 永不进 attach 队列——零 churn/零双 owner；copy/clone binding 必清锚后正常入队交付——Z14''）+**lease 覆盖 flush+recheck+mark（180s）+onModuleDestroy 停 claim**；deliverMedia/attach 端点同 team/ImageItem 去 url/mediaRefsOf 七键维持 | §3.1 |
| **Z8''（维持）** | 工厂类型感知+fallbackSize 单函数+happy-path=0 | §3.4 |
| **Z9''（维持 v10）** | 版本门=**双常量 bump 3**（csv 连接门 schema-outdated→handleVersionTerminal 一次 reload；docSchema 数据门旧 doc 拒载+IDB 四维键+Redis 键联动）；DEPLOY_EPOCH 废止维持 | §6 |
| **Z10''（维持）** | collab-doc-ops 纯模块+表驱动校验+switch+never+WriteOutcome 四态（deliverArtifact/linkMedia op 进表） | §3.1 |
| **Z11''（v12 改）** | **禁写门五层**：①**v12：stripServerOwnedData web 单点——无条件剥服务端身份键（fileId/resultUrl/videoUrl/result/natural/errorCode），挂全构造点（diff dataPatch/addNode.data/copyPlan/paste/undo 恢复——「未修改才不回送」措辞废止：canvasIntents:502 全键差异在快照窗口跨远端 apply 时会把服务端键判为"变化"发回）**+manifest UNKNOWN_KEY；②（并入①）；③generated fileId=服务端所有权+replaceMedia/attach 显式命令+writeNodeData(fileId) expected CAS；④**服务端 writeNodeData 对 fileId/resultUrl/videoUrl/result/natural 键 manifest 拒写**（仅 linkMedia/deliverArtifact 复合 op 可写——worker 写端点 op 白名单 exec-only：HttpCollabWritePort 仅 writeExecStatus loading/skipped 可用；**现状 SERVER_NODE_DATA_KEYS 是白名单且含 content——需按 v12 键集重划，content 客户端可编辑不拒**）；⑤Yjs 客户端直发 update 仍可写身份键——**post-apply 检测（Z19'' exec-only 扩身份键域）+guard 根白名单**；第二步命令族=Y1 末/Y2 边界维持 | §3.2 |
| **Z12''（维持 v10）** | placement 复合单键+G17 改口+判别联合+allocator 唯一入口+updateNodeEnvelope apply 内合并整对象写+等值键 needs-layer-repair+37 调用点维持 | §2.5 |
| **Z13''（v11 补）** | harness+**execSeq 代际矩阵**（同 job 双 worker/新 intent 覆盖旧终态/旧 error 不覆盖新 loading）+**flush 四崩溃窗**（apply 前/flush 前/flush 后 mark 前/mark 后 emit 前）+**repair=vacuum 并发**（互斥/旧 IDB/离线 pending）+outbox 乱序提交+分镜并发维持 | §2.6 |
| **Z14''（v12 补）** | normalize 五路径+binding DB 复制+nodeId remap（cells remap 删）+**normalizeCopiedNodeData 单函数五路径共用（copyPlan/seed/clone）**：status loading/error→idle（red：copyPlan:63 structuredClone 连 loading 复制=副本永久转圈）/身份键 binding 复制成功才保留否则 strip/exec 永不复制/cells 删；**binding 复制必清锚**（sourceIntentRowId/sourceExecSeq 置空+新 registrationKey——副本非资金产物，attach 可交付 fileId） | §2.5 |
| **Z15''（维持）** | cs 面 order/slot 写链维持 | §2.5 |
| **Z16''（维持）** | multiImage previewSize/恒等断言/fallbackSize/双常量注释维持 | §2.3/§3.4 |
| **Z17''（维持 v10）** | cells→slot（capacity 派生不落 doc/deriveStoryboardCells 长度恰=capacity+overflowIds/resize 溢出移出/swap 整值写/回流面 11 处删除清单）维持 | §2.3 |
| **Z18''（v12 改——execSeq+分层+flush+kind 分支）** | **资金=artifactState+交付=DocDelivery 双轨（v9 骨架）+代际/事务/持久化三收口**：**①execSeq 全局代际**（硬约束见修订链 v12）：**EXEC_STATUS_KEYS/ExecStatusPatch 加 execSeq: string 前置**（manifest:90 现状无——UNKNOWN_KEY 门口死）；exec 守卫比较改 `patch.execSeq<stored→older-exec`（BigInt；同 execSeq 内终态幂等/旧 attempts 挡新——反例 A/B/C 全解）；job data 携带 (intentRowId,execSeq)（**现状 ExecutionJobData.intentRowId=死代码——接线**）；reserve 写 reservedExecSeq；settle/void CAS 匹配 reservedExecSeq；**同 jobId RUNNING 重入=复用当前 execSeq 不动 reservation（v12——分配两处 new claim/rearm；重入者 mayCall:false 静默 skipped 等旧 worker）**；rearm 事务=execSeq nextval+**voidInTx 旧冻结（release+re-reserve——新 worker 重走 reserve 拿 mayCall:true）**+旧 DocDelivery/MediaBinding superseded；**fail/touchHeartbeat/reanchorDeadline 补 execSeq 维度**（旧 execSeq 0 命中 no-op）；**②ArtifactCommitService（资金五路径唯一 finalize）**：对象上传/HEAD 事务外（key=`artifacts/{teamId}/{intentRowId}/{execSeq}/{index}-{sha256}`+**x-amz-meta-sha256 上传元数据+finalize HeadObject 校验**〔v12：If-None-Match 废止——MinIO 不支持条件写〕）→单 PG 事务：无锁读 intent 快照→**ledgerTx 首句+lockBalance(teamId)〔契约 20〕**→intent FOR UPDATE 重验（RUNNING∧execSeq∧reservedExecSeq 匹配）→**幂等检查在 CAS 前（v12：判据=FOR UPDATE 下 intent 行状态——SUCCEEDED∧stored∧creditsConsumed=cost→幂等返回+补建缺行；非仅 Media 存在）**→inserts（Media〔registerInTx〕/MediaBinding/DocDelivery〔execSeq+artifactIndex+targetField+targetItemId 快照〕）→CAS updateMany（RUNNING∧execSeq→SUCCEEDED+stored）count===1 唯一凭据→settleInTx（只结算 reservedExecSeq===execSeq；失败**整体回滚**——不得 settle 失败仍交付）→commit；**死锁 40P01/40001/55P03+P2024 有界重试 3 次+jitter**；多产物=一次事务 N Media+一 settle+N DocDelivery；**kind 分支（v12）**：text=跳过 registerInTx（DocDelivery kind=text 携 resultText）；video=即时 finalize 交付 videoUrl（**无 Media 行**——下载→MinIO→Media→fileId=非资金续段走 MediaRegistration+attach）；**资金 quota=软限**（超限告警+计数不回滚；registerInTx 禁调 assertOnConfirm+禁外部 IO——sniff/HEAD/hash 全事务外）；**③MediaRegistrationService（非资金唯一 Media 写入点）**：**prepareUploadInTx/registerInTx/confirmInTx/bindInTx 四形态**（11 处 media.create 全映射——幂等锚 registrationKey+@@unique(bucket,key)）——不碰 settle/complete/DocDelivery/exec；**④DocDelivery 交付（typed flush——裁决④全文）**：认领 CAS（SUCCEEDED∧stored∧pending∨lease过期）+SKIP LOCKED→**deliverArtifact 复合 op**（事务内前置判定全过才写：execSeq 比较→stale 拒/同值幂等/新 intent 已出现→superseded；expectedValue 不匹配→superseded；节点删→orphaned；**然后** data patch+exec done）→批量 flushDocument（**载体=StoreOutcome 判别联合——storeDocumentUnlocked boolean 五分支混 false 先行重构**；与 attach 同 project 进程内互斥串行化）→复核→mark delivered；spooled/PG 故障不消耗 maxAttempts；**⑤exec 投影（v10 分档维持+execSeq 化）**：loading/skipped=worker strict Http（带 execSeq）；error=DB+API reconcile（**(FAILED,VOIDED)∧execProjectedExecSeq≠当前 execSeq**——Epoch 化替代布尔标记；**活跃项目过滤+24h 窗**）；done=DocDelivery；alignExecFromIntents 重建带 execSeq；**⑥清理与不变量**：旧 reconcile 三后门删除（backfillSucceeded/threeCheck resultRef/settleStranded probeArtifacts）→**不变量巡检（v12 按 kind 分化**：image/edit=SUCCEEDED⇒stored∧Media 存在∧settled；video=SUCCEEDED⇒videoUrl 已交付∧settled〔Media 后补豁免〕；text=SUCCEEDED⇒resultText 非空∧settled；违反告警人工不自动退款）；cleanTerminalIntents=artifactState 终态∧delivery 终态∧reserved=0∧7d（**resultText 非空行延长 90d**）；缺行 reconcile×2；DocDelivery/MediaBinding 终态 retention+dead-letter 告警 | §3.1 |
| **Z19''（v11 扩）** | guard=exec-only+**身份键域**（post-apply 检测扩：exec map 客户端写+fileId/resultUrl/videoUrl/result/natural 客户端直写检测——Z11''⑤）；spike 定档+post-apply 恒做+四根白名单维持 | §3.6 |

## 0.2 裁决定案（2026-10-18 用户确认；v11 收口更新）

| # | 项 | 定案 |
|---|----|------|
| ① | media facts 存储 | 维持 v9——Media 读模型（v11:MediaFactOutbox 替换 watermark+IDOR 校验） |
| ② | 重排出口 | **v11 换轨方案 A**——repair=generation 跳变 doc rewrite（复用 vacuum 协议；**repairRev 删除**；purgeForeignCaches bug 同修） |
| ③ | 片序 | 维持（单列车+P0-pre+B1a 必做——§4 对齐 plan v8） |
| ④ | Y1c schema | 本批固定 **3**（双常量同值两门） |
| ⑤ | 键长参数 | 维持（vendor+soft 24+hard 128+四曲线+等值键 repair） |
| ⑥ | UI 变更面 | v7 清单+slot 交互+fileId 替换显式命令+text 32KB 截断+媒体库保留 N 天+**40MP 图片上限提示** |
| ⑦ | worker doc 写口径 | 维持 v10（exec-only strict Http；error=DB reconcile）+**v11:端点 op 白名单** |
| ⑧ | artifact 状态机 | 维持 v10 简化版+**v11:execSeq 代际+锁序 balance→intent+InTx 族+幂等前置** |
| ⑨ | ~~repair 防回滚~~ | **v11 废止 repairRev**（换轨方案 A——定案②） |
| ⑩ | fileId 所有权 | 维持 v10 第一步+**v11:服务端 manifest 拒写+端点白名单** |
| **⑪** | **执行代际（v11/v12 改）** | 全局单调 execSeq（**v12：nextval 两处分配〔new claim/rearm〕——同 jobId RUNNING 重入复用当前值不动 reservation**；单一序全链 fence+EXEC_STATUS_KEYS 进 manifest+fail/touch/reanchor execSeq 化；attempts=配额语义） |
| **⑫** | **producer 分层（v11）** | MediaRegistration（唯一 Media 写入点）+ArtifactCommit（资金）/MediaRegistration（非资金）两编排器；不造零费 intent |
| **⑬** | **交付持久化（v11）** | typed flushDocument 五态+批量一次 flush+flush 后复核；spooled≠delivered；PG 至少一次（**v12：载体=StoreOutcome 先行重构**） |
| **⑭** | **同 job 重入（v12）** | 复用当前 execSeq+重入者 mayCall:false 静默 skipped（续跑语义——同 intent 双 worker 只烧一次钱）；仅 rearm=nextval+voidInTx 旧冻结（release+re-reserve） |
| **⑮** | **video finalize（v12）** | provider 成功即 finalize 交付 videoUrl（无 Media 行）；下载→Media→fileId=非资金续段（ai-download 迁 MediaRegistration+attach）；不变量按 kind 分化（video 豁免 Media 项/text 无 Media） |
| **⑯** | **copy 资金产物（v12）** | copy/clone binding 清空 sourceIntentRowId/sourceExecSeq+新 registrationKey；attach claim 加 sourceIntentRowId IS NULL；normalizeCopiedNodeData 五路径共用（status loading/error→idle） |
| **⑰** | **资金 quota（v12）** | 软限——finalize 不因 quota 回滚（钱已付 provider）；超限告警+计数；非资金路径硬拒维持；registerInTx 禁调 assertOnConfirm+禁外部 IO |

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

## 2. Y1a 序域设计（D5 分层直译+数据流闭合）

### 2.1 类型链与读出口（Z2''）

四型/三函数读模型/排序单实现收编/G13 维持 v10。

### 2.2 生成器+避让+soft/hard+等值键（§0.2-⑤）

vendor+读写两侧严格+四曲线+同锚+**等值邻居 needs-layer-repair**+soft 24 告警+hard 128 损坏上限维持 v10。

### 2.3 层序读出口+slot 单实现（Z3''/Z17''）

orderRecords+deriveStoryboardCells（capacity 派生/长度恰=capacity/overflowIds/resize 溢出移出/swap 整值/回流面 11 处删除）维持 v10。

### 2.4 无自动重排+on-demand repair=generation 跳变（Z4''-v11）

维护链：soft/hard/检测/load 病理档 reaper/CLI 维持；**repair 执行体=vacuum 协议复用**（vacuumGate 互斥→beginVacuumEra 冻结+4410→quiesce〔writesSettled——维护门内 DocDelivery/attach 消费者 503 退避〕→离线装载+纯函数重排→**等价断言=忽略 order|slot 的节点/边/data/exec 值等价（exec 根深拷贝保留——v12）**→单事务 vacuumReplace〔generation+1〕→purge+释放）；客户端零新协议（preVacuumSv 内容级 fence+consumeGenerationJump 单链+IDB 四维键联动）；**purgePidCaches 修复**；ack 降 UX；repairRev 删除。

C0a 实测锚：10k 重排≈56ms；投影 p95 18.7ms。

### 2.5 创建+父变更+order/slot 写链（Z12''/Z14''/Z15''）

维持 v10（复合单键+G17 改口+判别联合+apply 合并整对象写+等值键+37 调用点+normalize 五路径+binding 复制）。

### 2.6 收敛 harness（Z13''-v11）

五件套+双端真连维持；并发/故障注入补：**execSeq 代际矩阵**（同 job 双 worker/新 intent 覆盖旧终态/旧 error 不覆盖新 loading）+**flush 四崩溃窗**（apply 前/flush 前/flush 后 mark 前/mark 后 emit 前）+**repair=vacuum 并发**（互斥 409/旧 IDB/离线 pending 拒合并）+outbox 乱序提交/重启零回放+分镜并发零成员丢失+等值邻居/重复键层 repair+attach 503/DocDelivery 三窗/exec alignExecFromIntents 重建/reset 联动。

## 3. Y1b 尺寸/只读域设计

### 3.1 media 读模型+probe+两编排器+资金双轨（Z1''/Z7''/Z18''-v11）

**进程拓扑（v11）**：

```
API 进程：ArtifactCommitService（资金 finalize——producer 在 worker 调用，仅写 DB）
          +MediaRegistrationService（唯一 Media 写入点——registerInTx/confirmInTx/bindInTx）
          +DocDelivery 消费者（deliverArtifact+flushDocument+复核）
          +attach 消费者（linkMedia CAS）+MediaFactOutbox emitter
          +exec error reconcile（execProjectedExecSeq）+media-facts REST+media content 代理
          +repair（vacuum 协议复用）
worker 进程：probe（sharp/ffprobe）+生成/媒体处理 processor
          ——零直接 Y.Doc 访问+零资金/artifact/fileId doc 写
          exec loading/skipped=strict Http（exec-only op 白名单+execSeq）
          exec error=只写 DB；producer 调 ArtifactCommit/MediaRegistration（纯 DB 调用）
```

**MediaFactOutbox（Z1''）**：

```
probe done / server natural / attach 时 fact 已存在 —— 三写入点同事务：
  update Media（natural 列+factVersion+1+probedAt 仅审计）
  insert MediaFactOutbox（mediaId+projectId〔union(Media.projectId,binding.projectId)〕
    +factVersion+payload{natural}+state=pending）
emitter（API——单实例假设显式化）：
  claim: state='pending' ∧ nextAttemptAt<=now ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 200
  → emit project:<id> 房间 media:fact{mediaId,version,fact} → published
  失败 attempts++/nextAttemptAt 退避（jitter）；耗尽 dead+告警
  （无 watermark——晚提交行仍 pending 下轮必达；重启零回放；correction 必产生新 version）
客户端：按 factVersion 忽略旧；重连/切项目全量拉（REST 返回 factVersion）
```

**MIME 安全链（Z7''）**：

```
presign POST: Content-Type 条件（starts-with image/|video/|audio/）
confirm: file-type 嗅探对象头 → 白名单外拒+删对象+media_content_type_reject_total
  → 按 sniffed 重算 probeState（伪报 audio 的图片→pending）
消费: GET /api/media/:id/content（API 代理流式——查 Media+按 sniffedMimeType 设
  Content-Type+非白名单 attachment+CSP sandbox）；生产 MinIO 直链禁用
图片 probe 后 sharp 重编码（剥 polyglot/EXIF 载荷）；SVG 一律拒
生产上传通路 /flowai 渗透修复（mediaUploadUtils 环境感知）；Media.size BigInt
```

**资金双轨（Z18''-v12）**：

```
⓪前置（v12）: EXEC_STATUS_KEYS/ExecStatusPatch+execSeq: string（旧条目 docSchema v3 拒载）
  StoreOutcome 判别联合先行重构（storeDocumentUnlocked boolean 五分支混 false 根修）:
    {kind:'appended'}|{kind:'noop'}|{kind:'spooled'}
    |{kind:'terminal';reason:'project-gone'|'fenced'|'lease-missing'}|{kind:'failed';error}
  storeDocumentSerialized 透传；flushDocument=saveMutex 包装+映射（禁旁路猜状态）
  withSession(flush:true) 只 delivery/attach 两消费面（37 个普通调用点不动）
①execSeq（全局单调——DB sequence nextval）：
  分配两处（v12）: new claim/rearm（禁 increment/max+1）
  同 jobId RUNNING 重入=复用当前 execSeq、不动 reservation
    （重入者 reserve mayCall:false 静默 skipped——同 intent 双 worker 只烧一次钱；
     旧 worker finalize 照常匹配；旧 worker 真死归 reaper→rearm 闭环）
  wire/doc 用 string；守卫 BigInt 比较
  exec 守卫: patch.execSeq<stored→older-exec 拒；同 execSeq 终态→幂等/rejected（reason-aware）
  job data 携带 (intentRowId,execSeq)；reserve 写 reservedExecSeq；
  settle/void CAS 匹配 reservedExecSeq（旧 execSeq 的 void/settle 一律失败）
  fail/touchHeartbeat/reanchorDeadline 带 execSeq（旧代 0 命中 no-op）
  rearm 事务: execSeq nextval+voidInTx 旧冻结（release+re-reserve——新 worker 重走
    reserve 拿 mayCall:true）+旧 DocDelivery/MediaBinding superseded
  attempts=免费重试配额（≥3 EXHAUSTED）不混用
②ArtifactCommitService（资金五路径: text/image/video/edit/lighting）:
  对象上传事务外（key=artifacts/{teamId}/{intentRowId}/{execSeq}/{index}-{sha256}
    +x-amz-meta-sha256 上传元数据+finalize HeadObject 校验〔If-None-Match 废止〕）
  单 PG 事务:
    无锁读 intent 快照 → ledgerTx 首句 → lockBalance(teamId)〔契约 20〕
    → intent FOR UPDATE 重验（RUNNING∧execSeq∧reservedExecSeq）
    → 幂等检查〔CAS 前〕: 判据=intent 行状态（SUCCEEDED∧stored∧creditsConsumed=cost
      →幂等返回+补建缺行——非仅 Media 存在）
    → registerInTx（Media 行）/bindInTx（MediaBinding）/DocDelivery 插入
      （execSeq+artifactIndex+targetField+targetItemId 快照）
    → CAS updateMany（RUNNING∧execSeq→SUCCEEDED+stored）count===1 唯一凭据
    → settleInTx（只结算 reservedExecSeq===execSeq；失败整体回滚）
  死锁 40P01/40001/55P03+P2024 有界重试 3 次+jitter；多产物=一次事务 N Media+一 settle+N DocDelivery
  kind 分支（v12）: text=跳过 registerInTx（DocDelivery kind=text 携 resultText）；
    video=即时 finalize 交付 videoUrl（无 Media 行——下载→MinIO→Media→fileId
      =非资金续段走 MediaRegistration+attach 交付）
  资金 quota=软限（v12）: 超限告警+计数不回滚（钱已付 provider）；
    registerInTx 禁调 assertOnConfirm（删对象副作用）+禁外部 IO（sniff/HEAD/hash 全事务外）
③MediaRegistrationService（非资金唯一 Media 写入点）:
  prepareUploadInTx/registerInTx/confirmInTx/bindInTx 四形态
  （11 处 media.create 全映射: storage:37→prepare/media-process:194→register/
    ai-download:100→register〔video 续段〕/ai-image-edit:199+200→register/
    lighting:167→register/video-trim:110→register/stitch:97→register/
    generated-media:54→register/video-work:91→prepare）
  （幂等锚 registrationKey=taskId+artifactIndex|mediaId|exportRequestId；
    Media @@unique([bucket,key])）——不碰 settle/complete/DocDelivery/exec
④DocDelivery 交付（typed flush）:
  认领: SUCCEEDED∧stored∧(pending∨delivering∧lease过期) CAS+SKIP LOCKED
  deliverArtifact 复合 op（事务内前置判定全过才写——stale/execSeq/expectedValue/节点存活性
    →superseded|orphaned|幂等；然后 data patch+exec done）
  按 project 批量: 一个 withSession(flush:true) 内全 apply → 一次 flushDocument
    （与 attach 同 project 进程内互斥串行化 apply+flush+recheck+mark）
  flush 返回（StoreOutcome）: 'appended'|'noop'（∧isPersistedComplete∧目标匹配）→ 复核
    target/execSeq/expectedValue → 一致才 mark delivered
  'spooled'|'failed' → 保持可重试（不消耗 maxAttempts——PG 才 canonical）
  'terminal' → orphaned/failed
  lease 覆盖 flush+recheck+mark；emit 在 mark 后；onModuleDestroy 停 claim/等在飞
  mark 成功后对该 mediaId lazy GET media-facts 补拉（v12——pendingFacts 配套）
⑤exec 投影: loading/skipped=worker strict Http（exec-only+execSeq）；
  error=DB+API reconcile（(FAILED,VOIDED)∧execProjectedExecSeq≠当前——活跃项目+24h 窗）；
  done=DocDelivery；alignExecFromIntents 重建（execSeq 序）
⑥清理: 旧三后门删除（backfillSucceeded/threeCheck resultRef/settleStranded probeArtifacts）
  →不变量巡检（按 kind 分化: image/edit=SUCCEEDED⇒stored∧Media∧settled；
    video=SUCCEEDED⇒videoUrl 已交付∧settled〔Media 后补豁免〕；
    text=SUCCEEDED⇒resultText 非空∧settled——违反告警人工不自动退款）
  cleanTerminalIntents: artifactState 终态∧delivery 终态∧reserved=0∧7d
    （resultText 非空行→90d；pending/delivering 保留+计数）
  缺行 reconcile×2；终态 retention+dead-letter 告警
WriteOutcome 四态+同值 no-op（fast-deep-equal）+HTTP 端点真实四态维持 v10
```

- **幂等**：同 mediaId/attach/交付重跑 compare-before-set 零增量；finalize 同 epoch 幂等返回已有。
- **8 类产物绑定矩阵维持**（资金五+非资金六经两编排器结构性覆盖）。
- **校验链**：DocWriteOpSpec+deliverArtifact/linkMedia op 进表+switch+never 维持。

### 3.2 尺寸消费+禁写门（Z5''/Z11''-v11）

applyIntrinsicFit/尺寸消费维持 v10。**禁写门五层**（Z11''-v12）：**stripServerOwnedData web 单点无条件剥身份键挂全构造点（diff dataPatch/addNode.data/copyPlan/paste/undo 恢复——「未修改才不回送」废止）**+generated fileId 服务端所有权+replaceMedia/attach 命令+**服务端 writeNodeData manifest 拒写身份键（端点 op 白名单 exec-only；SERVER_NODE_DATA_KEYS 现状白名单含 content 需重划——content 客户端可编辑）**+Yjs 直发面归 post-apply/guard 检测；ImageItem.url 类型级消灭。

### 3.3 只读命令边界+resync 分流（Z6'' 维持 v10）

单源门+viewer 早退+七命令补门+dimensions 分表+resync 三路+节流+key-too-long→repair（=generation 跳变）+闩锁维持。

### 3.4 创建默认与兜底（Z8'' 维持） / 3.5 删除面（维持） / 3.6 入口 guard（Z19''-v11 扩身份键域）

维持 v10（guard 检测域扩：exec map+data 身份键客户端直写）。

## 4. 片序与执行门（v11 对齐 plan v8 T0-T28；每片出口=用户确认点）

| 片 | 内容（T 卡） | 出口判据 |
|----|--------------|----------|
| **C0a（spike）** | （v6 完结） | ✅（历史） |
| **P0-pre（T0-T3）** | T0 pin（yjs/sharp/fast-deep-equal/file-type+ffprobe CI）；T1 改名 StoredNodeRecord；T2 collab-doc-ops；T3 Prisma（**execSeq DB sequence+reservedExecSeq/execProjectedExecSeq**/probe 族+factVersion/MediaBinding 全量/GenerationIntent/DocDelivery 全量/**MediaFactOutbox**/Media sourceExecSeq·artifactIndex·objectKey·sha256·size BigInt·@@unique(bucket,key)/**删除 repairRev**） | 三面 tsc 绿+全量绿+census+pin 绿 |
| **B1a（T4）** | 只读门+七命令 | G34 |
| **C0b（T5-T10）** | T5 media-facts（REST+**MediaFactOutbox emitter**+join+ImageItem 去 url+**MIME 全链+media content 代理+生产通路修复**）；T6 **execSeq 链路〔EXEC_STATUS_KEYS 前置〕+StoreOutcome 先行重构+ArtifactCommit〔kind 分支+软限〕+MediaRegistration〔四形态+11 处映射〕+settleInTx+deliverArtifact+flushDocument+exec 守卫 execSeq 化+rearm voidInTx 归一化+后门删除**；T7 probe（参数+sniffed 路由+40MP）；T8 attach 消费者〔claim sourceIntentRowId IS NULL〕+两编排器 producer 分层接线+video 下载续段；T9 stripServerOwnedData 单点全构造点+manifest 拒写+端点白名单；T10 消费端〔pendingFacts+lazy fetch〕+E2E | 五面自检表+G42-G44/G46/G48/G51/G58 v12 全绿 |
| **A1（T11-T18）** | 维持 v10（placement/slot/四出口/双 bump/写链/回流面） | G54/G55/G11/G57/G29 |
| **A2（T19-T21）** | T19 repair=**vacuum 协议复用**（vacuumGate+beginVacuumEra+等价断言+vacuumReplace+purgePidCaches 修复）+soft/hard+病理档；T20 guard（exec+身份键域）；T21 CLI | G45/G53+S1+G14 |
| **A3（T22）** | 五件套+**execSeq 矩阵+flush 四窗+repair=vacuum 并发**+真连 | G12/G17/G55/G58 |
| **B1-B2（T23-T27）** | 维持 v10（DocShapeInvalid/resync/删除面/applyIntrinsicFit/autoOrigin） | G19/G7/G28/G24/G56 |
| **B3（T28）** | 双 bump 门+reset（六表）+verify+UX 签字+soak | G21/G33/G35/G57 |

## 5. 验收判据与先红门禁清单（v12 权威表——v10/v11 门禁判据随裁决增强；G36-G41/G49/G50/G52 废弃号不复用）

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
| **G42（v12）** | media 读模型 | watermark 漏发复现（**事务提交乱序：A 先写后提交被 watermark 跳过**）+**fact 先于 fileId 到达丢 natural（忽略未知 mediaId 复现）** | **MediaFactOutbox：乱序提交必达/重启零回放/correction 新 version 必达/attach 后到补发/IDOR 拒**+**pendingFacts 消费+mark 后 lazy GET 补拉**；doc 四根 |
| **G43（v12）** | producer 分层 | **非资金路径强塞 ArtifactCommit 复现（无 intent 空指针）** | 资金五走 ArtifactCommit（**kind 分支：text 零 Media/video 即时 finalize 交付 videoUrl+下载续段**）/非资金走 MediaRegistration 四形态（**11 处 media.create 全映射——grep 零第二处**）；registrationKey 幂等 |
| **G44（v11）** | WriteOutcome+复合 op | written 现状+合成红 | 四态+deliverArtifact 复合 op+**前置判定在 data patch 前（stale/execSeq/expected 全过才写）**+同值 no-op deep-equal |
| **G45** | 无自动重排+G17 改口 | 整层覆盖复现 | 维持 v10 |
| **G46（v12）** | attach 消费者 | probe 卡死+跨会话 CAS 复现+**copy 副本无 fileId 交付者（v8 矛盾复现）** | status=completed 解耦 probe+linkMedia 原子 CAS+**targetItemId 稳定定位**+**claim sourceIntentRowId IS NULL（资金原件零 churn）**+**copy 清锚后正常入队交付+normalizeCopiedNodeData（status loading→idle）**+lease 覆盖 flush+onModuleDestroy |
| **G48（v12）** | 资金矩阵 | **「Media 已建未 stored 免费」+活跃 RUNNING 被 release+attempts 代际错位（反例 A）+新 intent 被旧终态挡（反例 B）+rearm 静默跳过（现存 bug）+EXEC_STATUS_KEYS 无 execSeq（writeExecStatus UNKNOWN_KEY 红）**全复现 | **execSeq：同 job 双 worker 重入复用代际（重入者 mayCall:false skipped∧旧 worker finalize 照常交付——双烧零）/新 intent 新代不被挡/旧 error 不覆盖新 loading**；**EXEC_STATUS_KEYS+execSeq 进 manifest**；finalize 锁序 balance→intent（**并发 reaper+finalize 死锁注入零 40P01/55P03 或可重试收敛**）；**幂等前置=intent 行状态判据（半状态不误判）**；settle 失败整体回滚；多产物单事务整组；**rearm=nextval+voidInTx+re-reserve（mayCall:true）**；**kind 分支（text 零 Media/video 续段）+quota 软限**；fail/touch/reanchor 旧代 no-op |
| **S1** | guard（exec+身份键域） | spike 未做 | 报告+post-apply 恒做+enforce 条件默认 |
| **M1/M2（v11）** | probe+MIME | sniff 缺失+**生产 /flowai 上传通路渗透**红 | file-type 嗅探+presign 条件+**media content 代理（Content-Type/attachment/CSP sandbox）+MinIO 直链禁用**+sharp 重编码+SVG 拒+size BigInt+通路修复 |
| **D2** | 版本双门 | 双源/循环红 | 双 bump 单动作；Redis 故障不拒连 |
| **G51** | attach 收敛 | 崩溃零 fileId 红 | pending→linkMedia→attached |
| **G53（v11）** | repair=generation 跳变 | **repairRev 三缺口复现（无自报 rev/rev 被吞/离线 pending 回写）+purgeForeignCaches 保留脏代复现** | **vacuum 协议复用全绿：互斥 409/单事务 generation+1/旧 SV 内容级拒/IDB 全代清/consumeGenerationJump 单链一次 reload**；等价断言（忽略 order\|slot）；与 vacuum 并发一进一 409 |
| **G54** | order/slot 写链 | 拖序不持久红 | 维持 v10+重复键层 repair |
| **G55** | slot 单实现 | LWW 丢格+满员 append 红 | 维持 v10+cells 零残留 |
| **G56** | display | 二次旋转红 | EXIF 5-8+imageRotation 交换+分镜跳过 |
| **G57** | 旧 bundle/旧 doc | 循环+误读红 | csv 一次 reload+docSchema 拒载 |
| **G58（v12）** | 交付持久化崩溃窗 | **「mark delivered 时 doc 未落库」复现（debounce 窗 kill——扣费无产物无重试）+StoreOutcome 缺失下 spooled 被当 failed 耗 attempts** | **flush 四窗全收敛**（apply 前/flush 前/flush 后 mark 前/mark 后 emit 前）；**载体=StoreOutcome 五态判别（禁旁路猜）**；spooled≠delivered 继续重试不耗 maxAttempts；批量一次 flush（**与 attach 同 project 互斥**）；flush 后复核（superseded/orphaned/delivered）；**exec alignExecFromIntents 重建** |

**观测增补（v12）**：v10 全量+`artifact_commit_total{result}`+`artifact_commit_tx_seconds`+`settle_deadlock_retry_total`+`intent_epoch_stale_total`+`doc_delivery_applied_unpersisted`+`doc_delivery_lag_seconds`+`media_fact_outbox_lag/dead_letter`+`exec_projection_stale_rejected_total`+`doc_epoch_mismatch_total`+`maintenance_write_rejected_total`+`worker_write_scope_rejected_total`+`probe_lease_expired_total`+**`artifact_quota_exceeded_total`（软限计数）**。

## 6. 非目标与移交

| 项 | 归属 |
|----|------|
| z 序 UI/闩锁删除/SCHEMA=4/reconcile 删除 | 后续批/Y1c-1/Y1c/Y3 维持 |
| v2→v3 兼容 | 无（reset runbook） |
| BullMQ probe 队列/装载期自动 rebalance/doc 内 media 根/DEPLOY_EPOCH/DeliveryState 资金语义/data.cells·capacity | v9/v10 废止维持 |
| **repairRev（CanvasDoc 列）** | **v11 废止**（方案 A——generation 跳变；epochReason 仅审计） |
| **probedAt watermark emitter** | **v11 废止**（MediaFactOutbox） |
| **统一 ArtifactCommit（非资金路径）** | **v11 废止**（两编排器分层） |
| **withDoc unloadImmediately 逐条 flush** | **v11 禁用**（flushDocument 批量） |
| **If-None-Match 条件写** | **v12 废止**（MinIO 不支持条件写——x-amz-meta-sha256+HeadObject 校验替代） |
| **attach/delivery DocWriteCoordinator** | **v12 不采纳**（降 P1 进程内 per-project 互斥——正确性无虞纯成本；误判过滤#1） |
| ExecStatusOutbox 表 | v10 不采纳维持（execProjectedExecSeq reconcile） |
| emitter 多实例（Redis pub/sub/adapter） | **Y7**（偏离表 #6） |
| fileId 命令族第二步 | Y1 末/Y2 边界维持 |
| 跨 team Media 复制 | Y2 维持 |

**reset runbook（v11）**：停双进程→maintenance→队列 pause→备份→清表（CanvasDoc/CanvasDocUpdate/MediaBinding/DocDelivery/**MediaFactOutbox**/Media 生成物+spool+Redis+MinIO temp+IDB 预置）→双 bump→SCAN→重启→两轮验证。

## 7. 纪律与观察项

- 历轮留痕维持（git 历史）。
- **v11 留痕**：①「再加一层机制」是三轮共同弯路（attempts→intentAttempts→execSeq 的教训：**代际必须是外部单调序，不能复用业务计数器**；watermark→outbox 的教训：**游标永远追不上乱序提交，用待办队列**；repairRev→generation 的教训：**fence 必须内容级（SV 可证）且与快照同事务，连接级参数 fence 挡不住重连**）；②**锁序契约（契约 20）是全仓不变量——任何新事务先 grep 既有锁序**；③「单事务」必须落为 InTx 方法族+锁序+CAS 凭据三件套，一句话裁决不够；④现存 bug 三处（exec 守卫反例 B/rearm 静默跳过/purgeForeignCaches 反语义）由外审挖出——**评审输入要包含"现状缺陷"维度**；⑤外审的部署形态断言要核验（生产 /flowai 认知偏差——上传侧渗透才是真问题）。
- **v12 留痕**：①**「分配点越多越安全」反例**——v11「nextval 三处」中同 job 重入一处是自伤（新 seq fence 掉活着的旧 worker+继承后 mayCall 未定义=悬挂）；**代际分配必须区分「新执行段」（nextval）与「续跑」（复用）**；②**manifest 是 op 域第一道墙**——新键进 doc 必须先进 manifest 键集（execSeq 差点门口死：EXEC_STATUS_KEYS 无该键则 writeExecStatus 直接 UNKNOWN_KEY）；③**boolean 返回值混五态=状态机债**（storeDocumentUnlocked noop/spool/FK/fenced 同返 false——五态必须判别联合载体，禁旁路猜）；④**裁决措辞要带 claim 面**（「资金型 binding 跳过 fileId 写」不写 claim 条件→copy 矛盾漏网；「不回送未修改键」不写无条件→跨窗口 diff 漏网）；⑤外审误判六条过滤存档（coordinator 正确性 P0/零费 settle/P2002 驱动/grep 门禁语义/fillDoc/fanout——**"正确性推演"要先核共享状态载体**：两 poller 共享 Y.Doc+saveMutex 则交错无害）；⑥**多产品语义要按 kind 分化不变量**（text/video/image 三态谓词不同——单一谓词迫使 video 等下载或 text 造假 Media）。
- 观察项：slot 冲突频率；fileId superseded 频率；产物媒体库保留期 N；**outbox lag/死信率**；**execSeq stale 频率**（旧 worker 迟到提交量）；**软限超限频率（artifact_quota_exceeded_total）**；**pendingFacts 命中率**。
- harness 真连 provider destroy 走 scripts/lib/provider-late-reconnect-guard。
- manifest 矩阵对称（deliverArtifact/linkMedia 进表+身份键服务端拒写行+**execSeq 进 EXEC_STATUS_KEYS**）。
- guard 与 readOnly/帧闸/quota 只加不减。
- §0.2 v11 修订（②⑪⑫⑬+⑨废止）经用户确认（2026-10-18 四次裁决）；**v12 修订（⑪更新+⑭-⑰+Z1''/Z4''/Z7''/Z11''/Z14''/Z18''-v12 改）经用户确认（2026-10-18 九次确认）**；后续变更走 §0.4。
