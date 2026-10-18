# Y1a+Y1b：doc 模型 v3·序与尺寸/只读 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

<!-- plan v8（2026-10-18）：三份 v7 外审高度收敛+三并行核验坐实+挖出三现存 bug 后四用户裁决落地（2026-10-18 八次确认）——v10 五大换代方向维持，本轮收敛为**单一代际/单一 epoch/单一事务**。**四裁决**：①**repair 换轨方案 A**（推翻 v10 裁决③——repairRev 三致命缺口实证〔客户端 URL 只 csv/cb 无自报 rev runtime:1572；doc-status dedup=${state}:${frozen}+客户端 msg.rev<=last return 吞 rev 变化；repair 不改 SV preVacuumSv 检测不到〕：repair=一次 generation 跳变的 doc rewrite——vacuumGate 互斥→beginVacuumEra 冻结+4410→quiesce〔writesSettled 覆盖服务端 outbox——DocDelivery/attach 维护门 503 退避〕→离线重排→**等价断言=忽略 order|slot 的节点/边/data 等价**→单事务 vacuumReplace〔state+preVacuumSv+generation+1〕→客户端零新协议〔preVacuumSv 内容级 fence+consumeGenerationJump 单链+IDB 四维键联动〕；**repairRev 删除**；ack 降 UX；**purgeForeignCaches 反语义 bug 同修**〔现状传会话旧键=保留脏代删其他代 local-cache-key:71〕）；②**全局单调 execSeq+三硬约束**（**DB sequence nextval 分配三处**〔new claim/同 jobId 重入/rearm〕禁 increment/max+1；DB BigInt wire/doc 用 string 守卫 BigInt 比较；进 exec 守卫/finalize CAS/唯一键+job data+onTick/reanchor+**reserve/reservedExecSeq+void_/settle CAS**+同 job 重入 claim 事务内 reservation 继承+旧 execSeq void/settle 一律失败；attempts=免费重试配额不混用——反例 A〔同 job stalled 重排 processor:40+重入不递增 attempts generation-intent:130/:158〕/B〔exec 守卫只比 attempts 不比 intentId document:313-331——**新 intent 的 loading/done 被旧 done 永久拦截=现存 bug**〕/C 三实证）；③**producer 分两层=一个 Media 写入服务+两个编排器**（**MediaRegistrationService=唯一 Media 写入点**：register/confirm 两形态共用 sniff/MIME/quota/probeState/natural 初始化+registerInTx/confirmInTx/bindInTx **禁止第二处 media.create/bindMedia**；ArtifactCommit=资金五路径〔text/image/video/edit/lighting〕finalize 事务内调 registerInTx+execSeq CAS+settleInTx+complete+DocDelivery；非资金六路径〔upload confirm/stitch/trim/separate/copy/export〕走 MediaRegistration **不碰 settle/complete/DocDelivery/exec**——四路径零 GenerationIntent 实证；非资金幂等锚 registrationKey=taskId+artifactIndex|mediaId|exportRequestId+Media @@unique(bucket,key)；非资金零 doc 写 attach consumer 交付；**不造 creditCost=0 intent**；两层只共享 Media/linkMedia 原语）；④**DocDelivery=typed flush+批量+复核**（withSession(write) 增 flush:true+**flushDocument(pid):'appended'|'noop'|'spooled'|'terminal'|'failed'**〔storeDocumentSerialized/saveMutex〕；只有 appended〔或 noop∧isPersistedComplete∧目标匹配〕才 delivered；**spooled≠delivered** 继续重试不耗 maxAttempts；按 project 批量一个 withSession 全 apply 后一次 flush；flush 后复核 target/execSeq/expectedValue→superseded/orphaned/delivered；lease 覆盖 flush+recheck+mark；delivered=PG 至少一次；**withSession 写后 debounce 未落库实证 residency:459-468——mark delivered 撒谎根修**）。 -->
<!-- v8 同批收编：**锁序契约 20**（finalize 先 lockBalance 再 CAS intent——credit-ledger:58 注释+reserve/settle/void/rollback 四处先 balance；先锁 intent=ABBA 死锁）+**InTx 方法族**（completeInTx/settleInTx/createXxxInTx——complete 根 prisma:255+settle 自开事务:132 根修）+finalize 幂等检查事务内 CAS 前+40P01 有界重试 3 次 jitter；**唯一键全带 execSeq+artifactIndex+targetItemId**（稳定 ImageItem.id——删除/重排按 id 现算实证 targetIndex 会漂移）；**对象 key=artifacts/{teamId}/{intentRowId}/{execSeq}/{index}-{sha256}**+If-None-Match+hash 校验+orphan sweep 前缀+龄阈值；**旧 reconcile 三后门删除**（backfillSucceeded:215 直接置 SUCCEEDED/threeCheck resultRef:244/settleStranded probeArtifacts→**不变量巡检**〔SUCCEEDED⇒stored∧Media∧settled——告警人工不自动退款〕）；**rearm 事务**（execSeq nextval+reservation 继承+旧 outbox superseded+**资金归一化**〔rearm 残留冻结 mayCall:false 静默跳过外呼=现存 bug team-credit:102+execution:325〕）；**worker 端点 op 白名单 exec-only**（fileId/resultUrl 在服务端白名单内 write.controller:32+manifest:83——收窄）；**MediaFactOutbox 替换 probedAt watermark**（事务乱序提交必漏实证；factVersion 单调/pending 行+SKIP LOCKED/probe·server-natural·attach 三写入点/来源 union(Media.projectId,binding)/重启零回放/emitter 单实例假设显式化=instances:1 多实例归 Y7）；**MIME 全链**（file-type 库+**API 代理流式 /api/media/:id/content 按 sniffedMimeType 设 Content-Type+attachment+CSP sandbox+生产 MinIO 直链禁用**+presign Content-Type 条件+SVG 拒+sharp 重编码剥载荷+Media.size BigInt〔Int 2.147GB 上限〕+**生产上传 /flowai 渗透修复**〔mediaUploadUtils:31 dev 假设——生产 MinIO 直连下无背书〕）；probe（**图片批 4 lease 180s/视频 batch 1 lease 5min**〔批 2×90s 覆盖不了下载+ffprobe〕/nextProbeAt jitter/claim 按 sniffedMimeType 路由〔伪报 audio 的图片不再永 skipped〕/索引 [probeState,nextProbeAt]/40MP+downscale 产品策略）；text 90 天（resultText 非空行延长）；exec error reconcile 活跃项目过滤+24h 窗；attach=只填空/replace=显式命令；观测+8 指标；**每卡真 PG 并发用例**（A3 不够早）；**交付 owner 唯一**（资金型=DocDelivery；binding 对 sourceIntent 非空跳过 fileId 写）。外审误判修正：生产 /flowai 同源直出不成立（MinIO 域名直连——上传侧渗透才是真问题）；reconcile 带状态+时间窗非全表；multiImage targetIndex 漂移不成立（UI 按 id 现算）。 -->
<!-- plan v9（2026-10-18）：三份 v8 外审攻击三接缝（finalize 状态机/三 poller 协调/A1-execSeq 交界）+四路并行核验（9 P0 坐实/8 P1/6 误判过滤）+四用户裁决（2026-10-18 九次确认）——v8 四裁决方向维持。**四裁决**：①**同 job 重入复用 execSeq**（推翻 v8「nextval 三处+继承/转移」——重入者 mayCall:false 静默 skipped 等旧 worker 交付〔team-credit:102 现状故意语义〕，旧 worker 真死归 reaper→rearm；**分配收敛两处 new claim/rearm**；rearm=nextval+**voidInTx 旧冻结**〔release+re-reserve——新 worker 重走 reserve 拿 mayCall:true〕+旧 outbox superseded）；②**video 即时 finalize**（provider 成功即 settle+complete+DocDelivery kind=videoUrl 交付 videoUrl **无 Media 行**；下载→MinIO→Media→fileId=**非资金续段**〔ai-download 迁 MediaRegistration+attach〕；不变量按 kind 分化——video 巡检豁免 Media 项/text 无 Media 跳过 registerInTx）；③**copy 清锚零新列**（copy/clone binding **清空 sourceIntentRowId/sourceExecSeq**+新 registrationKey；**attach claim 加 sourceIntentRowId IS NULL**——资金原件 binding 永不进队零 churn；**normalizeCopiedNodeData 五路径共用**——status loading/error→idle〔red：copyPlan:63 structuredClone 连 loading 复制=副本永久转圈〕/身份键 binding 成功才保留/exec 永不复制/cells 删）；④**资金 quota 软限**（finalize 不因 quota 回滚——钱已付 provider；超限告警+计数 artifact_quota_exceeded_total；registerInTx **禁调 assertOnConfirm**〔storage-quota:37-49 删对象+删行副作用〕+**禁外部 IO**——sniff/HEAD/hash 全事务外）。**9 P0**：EXEC_STATUS_KEYS/ExecStatusPatch+execSeq: string（manifest:90 现状无——不进键集 writeExecStatus 直接 UNKNOWN_KEY 代际围栏门口死；旧条目 docSchema v3 拒载）；同 job 复用；copy 清锚；**StoreOutcome 判别联合先行重构**（storeDocumentUnlocked boolean——noop/spool 成功/spool 失败/FK/fenced 五分支混一个 false〔persistence:235/:283/:287-395/:308-336〕；flushDocument 五态以 StoreOutcome 为载体禁旁路猜 hasFrames/persistUnhealthy；withSession(flush:true) 只 delivery/attach 两消费面）；**stripServerOwnedData web 单点无条件挂全构造点**（diff dataPatch〔canvasIntents:502 全键差异——快照窗口跨远端 apply 时服务端写的 fileId 被判"变化"经 WS 发回〕/addNode.data〔:462 全量〕/copyPlan/paste/undo 恢复；服务端 manifest 拒写降第二道——「未修改才不回送」废止）；text/video kind 分支；**唯一键补维度**（MediaBinding `@@unique([mediaId,projectId,nodeId,role,targetField,targetItemId])`/DocDelivery `+targetField,targetItemId`/**MediaFactOutbox `@@unique([mediaId,projectId,factVersion])`**/targetField 词表补 videoUrl/resultUrl——video 交付无处落）；**If-None-Match 废止**（MinIO 不支持条件写）→x-amz-meta-sha256 上传元数据+finalize HeadObject 校验；**pendingFacts**（fact 可先于 fileId——「忽略未知 mediaId」丢 natural 到重连）：客户端短 TTL Map（fileId 到达即消费）+delivery/attach mark 后 lazy GET 补拉。**8 P1**：重试码+**55P03**（lock_timeout）+P2024；MediaRegistration 第四形态 **prepareUploadInTx**+**11 处 media.create 映射表**（storage:37/media-process:194/ai-download:100/ai-image-edit:199+200/lighting:167/video-trim:110/stitch:97/generated-media:54/video-work:91——全部可映射四形态）；幂等前置判据=**FOR UPDATE 下 intent 行状态**（SUCCEEDED∧stored∧creditsConsumed=cost→幂等返回+补建缺行）非仅 Media 存在；attach/delivery **per-project 进程内互斥**（串行化 apply+flush+recheck+mark）；repair 等价断言含 **exec 根值等价**（vacuumEquivalent 现状只比键集合 registry:655-663）；attach lease 覆盖 flush（180s）+两 poller **onModuleDestroy**；**fail/touchHeartbeat/reanchorDeadline 补 execSeq 维度**（generation-intent:230/:248/:265 只守 status——旧 worker 可刷/杀新 attempt）。**误判过滤（勿复入）**：DocWriteCoordinator「正确性 P0」不成立（两 poller 写同 project 同 Y.Doc〔共享 residency 池〕+saveMutex per-doc+flush 排空全队列——纯成本降 P1 互斥）；零费 settle no-op 分支多余（不造 creditCost=0 intent）；P2002 事务内 catch 驱动多余（lockBalance 串行同 team 并发 finalize）；「grep 零第二处会红」=迁移终态门禁非现状断言；fillDoc 逐键写=A1/T15 已覆盖；outbox 单 projectId 漏 fanout=attach 补插行已设计（真缺口仅唯一键）。 -->
<!-- plan v10（2026-10-18）：第十轮三份 v9 外审生产级评审（机制通过/执行驳回×2）+三路并行事实核验+三份六点裁决报告终裁后**六项裁决+四分叉裁定+残余 P0 十三条**落地（推翻 v9 裁决②〔video videoUrl〕与 v8/v9 裁决①〔repair generation 跳变〕）。**六项裁决**：①**video 不交付 videoUrl**——`Media(status=processing)+fileId`：provider 成功即 settle+finalize（资金流与 v9 零 delta——只换交付载荷）；finalize 事务内建 Media 行（status=processing+**sourceUrl 专用列**〔禁入 metadata——media-batch 整行 spread 会泄漏〕+预分配 key+provider 声明 mimeType）+DocDelivery(kind=fileId 交付 mediaId)+settle/complete；**materialize 异步**（MaterializeJob：自有 processingLeaseUntil/processingAttempts 退避**与 intent attempts/rearm 彻底解耦**——存储抖动不污染资金/交付状态机；幂等键=mediaId；终态失败→**幂等补偿退款**+artifactState=failed+告警；materialize 不写 doc）；processing 期 content proxy 两态（ready=对象流+Range/HEAD/ETag；processing=allowlist 流式代理 sourceUrl+no-store+maxContentLength 上限+超限降级占位）；**targetField 词表删 videoUrl/resultUrl；DocDelivery kind 收敛 fileId|text**；统一不变量 `SUCCEEDED⇒settled∧DocDelivery(fileId)∧Media 行存在∧status∈{processing,completed}`（text 唯一例外）。②**repair=in-place 主路径**（preVacuumSv fence 挡不住未同步离线客户端实证 registry:689-697——generation 跳变常规化=数据复活风险常态化）：维护门（applyWriteFreeze **不 close 不 reload 不清 IDB 不跳 generation**+新连接只读+DocDelivery 维护门 503）→writesSettled→纯函数修复计划→**withSession(write, MAINTENANCE_TRANSACT_ORIGIN) 分块 ≤64KB**→回读校验（等价断言=忽略 order|slot+非 order/slot 键零变化）→解除 readOnly+RepairRun 审计；幂等可重跑；**帧预算预演**（scratch doc encodeStateAsUpdate——超 256KiB 或不可表达结构才退 vacuum）；**vacuum 兜底仅限「确定无离线客户端」运维窗**（无 generation 握手不得自动回退——握手归 Y2）。③**copy 方案二+**：**strip 只对更新不对新建**（更新路径剥禁写键——快照窗口回退 bug 面；**新建/copy/paste/explode 保留 fileId/images[].id——消灭空图窗口**）；normalizeCopiedNodeData 收窄（loading/error→有 fileId 则 done 无则 idle/清 errorCode/删 url/exec 不复制/cells 派生）；**binding 服务端惰性 reconcile**（mediaRefsOf 扫描+teamId 校验+幂等 upsert 清锚——零客户端调用零新端点）；跨 team paste=客户端 strip+读 ACL 403 兜底；**Media GC 加 doc 引用/grace 护栏**；**attach consumer 整建制取消**（两大存在理由消灭）——**交付 owner 收敛单一 DocDelivery poller**（非资金需写 doc 者并入 kind=fileId 无资金字段）+MediaBinding 降级纯索引。④**reconcile=R3 幂等 finalize 自动收敛**（推翻 v9「告警人工」）：finalizeFromExistingArtifact（CAS+补建缺行）+动作表+审计行+有界重试 3 次+pg_advisory_xact_lock+**歧义/资损风险绝不自动动钱**；**backfillSucceeded 禁写 SUCCEEDED+null**。⑤**guard/strip=检测/诊断/可修复（shadow 起步）；安全边界=读侧 ACL**：**assertMediaReadable 单门**（url/batch/content/facts/thumbs/snapshot 注入全覆盖——项目成员+Media.teamId===project.teamId；公开页按 workId 不按 mediaId）；**meta.schemaVersion 例外硬删+重连**（DoS 防护 shadow 也删——现状 writers 仅文档约定=viewer 可 brick 项目）；**键集单源两集合四处共用导出常量**（SERVER_WRITABLE_DATA_KEYS 含 content/CLIENT_FORBIDDEN_DATA_KEYS 不含 content——四处=manifest/strip/guard/census）。⑥**R2 登记 Y2 立项候选本批零代码**（Artifact 表/mediaRef/多实例+触发条件）；**双 bump 保留**（生产 epoch 14 在线混跑窗真实）；fileId 命名保留。**四分叉裁定**：video settle=provider 成功即 settle（否 ingest 后 finalize——故障域隔离为决定性理由）；双 bump=保留；copy binding=服务端惰性 reconcile；**StoreOutcome 窄接口先行**（推翻 v9 P0「判别联合先行重构」——flushDocument 以 ephemeral flush+isPersistedComplete 三态 `persisted|not-persisted|terminal` 承载+spoolDeadline 1h；五态降后续硬化卡）。**残余 P0 十三条**：rearm **只 voidInTx 释放**（v9「release+re-reserve」自相矛盾——team-credit:105 reservedCredits>0→mayCall:false）；execSeq **进程内贯穿**（job data 不带——controller:68 enqueue 无 claim）+**同 job 重入三态**（心跳新鲜 skip/过期接管/未知可重试——禁「skipped 后成功 ack」）；**providerTaskId submit 后落库**（schema:1014 列在但全仓零写库点）+query-first+Idempotency-Key+**ArtifactCommit/MediaRegistration=shared artifact-core module 双 role DI 测试**（生产 API manualRegistration:true 不消费队列 app.module:71）；读 ACL 单门+**storage.presign 补 projectId**（create data 无 projectId）；**非 additive DDL=rebuild cutover runbook**+**BigInt toJSON 四读路径**（storage-quota agg/storage.service:85 Math.abs/media-batch spread/material spread）+**CI 加 S3 兼容服务**；**targetItemId 非空 sentinel ''**（PG NULL 不去重——单图绑定幂等键失效）；meta 硬保护+键集单源；**confirmInTx+pending CAS**（storage:69-99 无事务无守卫）；**用户 replace vs delivery expectedValue CAS**（applyWriteNodeDataToDoc 无条件 set document:286）；**DOC_NODE_KEYS 契约表+compareExecSeq 单源**（lint 禁裸比较+非法 string drop）；**outbox at-least-once**（「重启零回放」断言废止——改测重复投递幂等）；**SSRF SafeRemoteFetch**（ai-download:62 无 host 校验/重定向/大小上限）；**file-type pin 16.x 或自研 sniff**（≥17 纯 ESM vs tsconfig commonjs）。**附加**：quota claim 前预检；media.create 门禁 **grep census（9 处非 11——ai-image-edit:199+200 同一调用续行）**；C0b 出口**提前 soak 一轮**；**开工前三实证**（生产 nginx -T 核 /flowai〔web 24 处/15 文件改写面〕/check-migration-additive 实判/CI S3 到位）。 -->
<!-- plan v10.1（2026-10-18）：第十一轮三份 v13/v10 第二轮复审+四断言亲验坐实后**边界收口十一条**落地（v13 六裁决方向全部维持——三报告重提项 video 交付时机/dual bump/DocDelivery 泛化/vendor 四曲线/orderEpoch 全部维持原裁决）。**十一条**：①**非资金 DocDelivery lane 删除**（亲验零服务端 doc 写——stitch/trim/separate 只走 emit 族 emit.port:62-86，结果由客户端写 trimmedFileId；**DocDelivery funding-only，intentRowId/execSeq 非空禁 execSeq=0 伪造**；确需时建独立 DocCommand 表）；②**ArtifactState 四态 {none materializing stored failed}**：image/edit/lighting=stage 后 stored；video=finalize 时 materializing→materialize 成功 stored/终态失败 failed；text=stored；**finalize 幂等判据改 SUCCEEDED∧artifactState∈{materializing,stored}∧creditsConsumed=cost**；统一不变量加 failed 合法终态（status=failed⇒幂等补偿退款+artifactState=failed；delivered 只表示引用已写不表示字节存在）；R3 对 materializing=重试 materialize 非补 finalize；③**stage durable 化（Media(processing)=统一 stage 句柄）**：stageInTx 短事务先落行（objectKey/sha/size/sniff+sourceIntentRowId/sourceExecSeq/artifactIndex，ON CONFLICT DO NOTHING 幂等）+同事务插 processing fact→对象上传→finalize 只做状态提升——**消灭「对象在 DB 无记录」孤儿**（orphan sweep 以 stage 行为准+覆盖旧 execSeq 前缀）；video finalize 建行不 stage 字节；④**同 job 重入 skip→moveToDelayed**（`job.moveToDelayed(now+lease 余量+grace, token)`+抛 DelayedError **不 return 不 ack**——BullMQ return=completed 即悬挂）+**providerRequestId（UUID）submit 前落库**（Idempotency-Key，消灭 submit→DB 崩溃窗）+query-first 键序 requestId→providerTaskId→重呼（同步 provider 显式标注不可 query-first）；⑤**strip 键集精确枚举+socket 降级**：CLIENT_FORBIDDEN={fileId,resultUrl,videoUrl,result,natural,errorCode,fileIdRev}——**不含 referenceImage/images/allImages/trimmedFileId/videoFileId/audioFileId**（上传路径全在更新路径上，键名一刀切=剥掉上传）；**socket setFileResult 降级本地 UI 不写 doc**（emitNodeStatus video 不传 fileId——现状 :298 传 resultRef=URL→404）；guard generated/uploaded 类型分流；⑥**content 出服务端白名单**（亲验 :485 content=用户 prompt 回显）——text 交付删回显只写 result，两键集真正正交；⑦**meta.schemaVersion 修复=恢复 current 非删除**（亲验 docShape:87-91 sv==null∧有节点→assertDocSchema→throw——删除只是换一种 brick）；⑧**fileIdRev token 来源钉死**：server-owned 单调计数进禁写集；claim 装载 doc 捕获→finalize 写 DocDelivery.expectedValue→apply 比较 currentRev≠expectedRev→superseded；replaceMedia 递增；⑨**repair RW 写屏障+单块预算+advisory lock**：writesSettled 是持久化谓词拦不住在飞 withSession——per-project RW 锁（writer refcount/maintenance 排他+MAINTENANCE origin 自 bypass）；fallback 只留给不可表达结构（**「总量 256KiB 退 vacuum」废止**——分块下不可达且自相矛盾，总量大就多块）；pg_advisory_xact_lock 跨进程保险；⑩**multiImage 本批一 intent 一 artifact**：targetItemId=''+artifactIndex=0+删「多产物 N Media」描述（execution:539 单 result.url 实证）；slotId 归 Y2；**copy 重新分配 placement/order**（副本同层同 order 重复键——allocator 唯一入口）；⑪**consistency pass**：D5/⑨/⑪/⑬/⑭/Z1'' 残句/Z13''/T24/G53 全部对齐现行口径。**P1 收编**：MediaBinding 删 attach 死列（纯索引 9 列）+「清锚」措辞废止（锚在 Media）；processing fact 同事务推送；media-facts GET→POST≤200；MaterializeJob 复用同一次下载算 natural/hash/mime（免 probe 二次下载 1GB——probe 仅上传路径）；quota estimatedSize 预检；DocDelivery dead 重驱（on-load reconcile/admin retry）；R3 FAILED∧reserved>0 void 加「无 artifact/无 delivered」守卫；finalizeFromExistingArtifact→**finalizeFromExistingMediaOrText 改名**；assertMediaReadable projectId=null 退化 team member；flush 窄接口带 reason `{persisted}|{retry,spooled|failed}|{terminal,fenced|fk}`+显式 storeDocumentSerialized（替代 ephemeral-disconnect）+spooled 无限重试不假失败（PG 停机>1h 判死磁盘安全帧）；providerTaskId adapter 透传链（execution call 封装加字段）；Media.status 直接 enum；**T6 拆四卡（6a execSeq/claim/rearm/重入 lease；6b ArtifactCommit stageInTx/finalize；6c DocDelivery/fileIdRev/flush；6d Materialize/R3）+T5 拆三卡（5a outbox/REST/processing fact；5b MIME/proxy/读 ACL/SafeRemoteFetch/BigInt；5c /flowai 迁移）**。 -->
<!-- 执行纪律核心：plan 中每个被调用的 API/类型/DI 令牌/进程形态，写码前 grep 实证。行号=2026-10-18 快照。**每卡先红须含真 PG 并发用例（锁序/双 claim/崩溃窗）——mock 测不出代际/锁序问题。** -->

**Goal:** 落地 doc 模型 v3——placement 复合单键序域（order|slot+vendor+等值键）+Media 读模型（REST/**MediaFactOutbox**/快照 join+probe+MIME 全链+读 ACL 单门）+**execSeq 单一代际**（资金 ArtifactCommit/非资金 MediaRegistration 两编排器〔shared module 双 role〕+窄接口 flush 持久化交付）+WriteOutcome+fileId 单一身份收口（**doc 只有 fileId/result 两个身份——provider URL 永不入 doc**）+只读双层+双 bump，批出口=verify 全绿+门禁全过+四曲线+资金矩阵含代际/锁序/flush 崩溃窗/materialize/reconcile 收敛。

**Architecture:** doc=nodes/edges+exec+meta（四根不动）；Media 表=媒体事实权威（status 含 processing 两态——video 资金流 provider 成功即 settle+materialize 异步）；**execSeq=全局单调执行代际（DB sequence，claim 返回值进程内贯穿）**；资金=ArtifactCommitService（**stage 事务外+finalize 短事务**，lockBalance→intent CAS→registerInTx→settleInTx）；非资金=MediaRegistrationService（唯一 media.create 点）——**两者=shared artifact-core module 双 role（API+worker）**；交付=**单一 DocDelivery poller**（deliverArtifact 复合 op+expectedValue CAS+窄接口 flush 三态+复核；attach consumer 取消）；binding=惰性 reconcile 维护的纯索引；facts=MediaFactOutbox（pending 行无 watermark，at-least-once）；repair=**in-place renumber 主路径**（vacuum 仅运维窗兜底）；排序单实现（slot 派生）；双 bump 版本门（保留）；guard=检测/诊断（安全边界=读侧 ACL assertMediaReadable 单门）。

**Tech Stack:** TypeScript strict / Yjs exact 13.6.32 / Hocuspocus 4.6.0 / NestJS / sharp exact 0.34.5（40MP+并发 1）/ ffprobe 8.1.2（CI/部署 pin）/ fast-deep-equal / **file-type 16.x exact（≥17 纯 ESM 禁用——tsconfig commonjs）或自研 magic sniff** / vitest / node:test。

**执行纪律：** 每卡先红（真实变红+**真 PG 并发用例**）→绿→commit；写码前 grep 实证；三面 tsc；文档 diff；每片出口用户确认。

## 文件结构（触碰面全景·v10.1）

| 文件 | 动作 | 责任 | 片 |
|---|---|---|---|
| 根+apps package.json / ci.yml | 改 | T0 pin（yjs/sharp/fast-deep-equal/**file-type 16.x 或自研 sniff**+ffprobe CI/部署+**CI S3 兼容服务**） | P0-pre |
| packages/shared/src/canvas/canvas-doc-manifest.ts | 改 | **EXEC_STATUS_KEYS/ExecStatusPatch+execSeq: string+键集单源两集合四处共用导出常量（v10.1 正交化：SERVER_WRITABLE={fileId,resultUrl,videoUrl,result,natural,errorCode,fileIdRev}——content 出白名单/CLIENT_FORBIDDEN 同集）** | C0b |
| packages/shared/src/canvas/copyPlan.ts | 改 | **normalizeCopiedNodeData 收窄**（loading/error→有 fileId 则 done 无则 idle/清 errorCode/删 url/**保留 fileId**/exec 不复制/cells 派生） | C0b/A1 |
| docShape.ts+全仓 ~141 处 | 改 | T1 改名 StoredNodeRecord | P0-pre |
| scripts/check-plan-census.mjs | **建** | census（**含 media.create grep census/strip 键集四处一致/targetItemId 非空**） | P0-pre |
| collab-doc-ops.ts | **建** | 写原语+类型同迁 | P0-pre |
| apps/api/prisma/schema.prisma + migration | 改 | T3 全量（**exec_seq DB sequence**+probe 族+factVersion+MediaBinding+artifactState+DocDelivery+**MediaFactOutbox**+Media 补列〔**status processing+sourceUrl+materialize 族**〕+**targetItemId 非空 sentinel**+保留矩阵） | P0-pre |
| shared/src/canvas/media-fact.ts | **建** | MediaFact+mediaRefsOf 七键+**compareExecSeq 单源** | C0b |
| media-facts.controller.ts + media-fact-emitter.ts | **建** | REST（**读 ACL 单门**）+**outbox emitter（SKIP LOCKED+at-least-once）** | C0b |
| media-probe/media-probe.poller.ts | **建** | probe 单相（批/lease 分型+sniffed 路由） | C0b |
| **shared artifact-core module**（execution/artifact-commit.service.ts + media-registration/media-registration.service.ts） | **建** | **资金 finalize（stageInTx durable〔Media(processing)=统一 stage 句柄+processing fact〕+finalize 短事务 lockBalance→CAS→状态提升→settleInTx）+唯一 Media 写入点（prepareUploadInTx 补 projectId/registerInTx/confirmInTx CAS/bindInTx）——AppModule+WorkerModule 双 import+双 role DI 测试** | C0b |
| media-delivery/delivery-outbox.poller.ts | **建** | **单一 DocDelivery poller（v10.1 funding-only）**（认领 artifactState∈{materializing,stored}+deliverArtifact+fileIdRev CAS+**带理由窄接口 flush**+复核+dead 重驱）+exec error reconcile | C0b |
| media-delivery/binding-reconcile.service.ts | **建** | **binding 惰性 reconcile（create-only——绝不改已有行资金锚）**（mediaRefsOf 扫描+teamId 校验——纯索引维护） | C0b |
| worker MaterializeJob（ai-download 迁移改造） | 改 | **video materialize（processing→completed；幂等键=mediaId；自有 lease/attempts；复用同一次下载算 natural/hash/mime；不写 doc；终态失败→补偿退款+errorCode）** | C0b |
| collab/collab-media.controller.ts | **建** | replaceMedia 显式命令（带 expectedValue）端点+repair 端点（in-place 主+vacuum 兜底） | C0b/A2 |
| media.service.ts + media-content.controller.ts | 改/建 | **GET /api/media/:id/content 两态**（ready=对象流+Range/HEAD/ETag；processing=allowlist 代理+上限降级）+**assertMediaReadable 单门** | C0b |
| collab-write.port.ts + controller | 改 | WriteOutcome+同值 no-op+**端点 op 白名单 exec-only**+**typed outcome（资金路径禁伪造 written:true）** | C0b |
| execution/ + intent-reconcile + team-credit + generation-intent | 改 | T6 execSeq 链路+InTx 族+**R3 reconcile 自动收敛**+rearm 只释放+providerTaskId 落库 | C0b |
| collab/collab-residency.service.ts + collab-persistence.service.ts | 改 | **flushDocument 带理由窄接口（{persisted}|{retry,spooled|failed}|{terminal,fenced|fk}——显式 storeDocumentSerialized 调用）**；MAINTENANCE origin+维护门+**per-project RW 写屏障** | C0b/A2 |
| shared/canvas/placement.ts / order-key.ts / order-records.ts / validate·normalize | **建** | placement 判别/vendor/deriveStoryboardCells/五路径+**DOC_NODE_KEYS 契约表** | A1 |
| web/canvas-allocator.ts | **建** | allocator+等值键+slot 重映射 | A1 |
| collab/collab-pathology.ts + collab-maintenance.service.ts | **建** | soft/hard+**repair=in-place（维护门+分块 ≤64KB+帧预算预演+vacuum 兜底运维窗限定）**+purgePidCaches 修复（vacuum 路径） | A2 |
| collab/collab-content-guard.ts | **建** | guard（检测/诊断口径——exec+身份键+meta.* 域+generated/uploaded 类型分流；shadow 定档+**meta 修复=恢复 current 例外**） | A2 |
| scripts/collab-repair-doc-order.mjs | **建** | CLI（**默认 in-place，--vacuum 仅紧急**） | A2 |
| collab/collab-harness/ | **建** | 双端真连+**execSeq 三态/flush/materialize/R3/in-place repair 故障注入** | A3 |
| web utils/stores + groups/ + 三组件 | 改 | order/slot 写链+**strip 更新路径/新建保留**+**cells 消费面**+ImageItem 去 url | C0b/A1/B2 |
| web/src/utils/mediaUploadUtils.ts + mediaApi.ts + **/flowai 24 处/15 文件** | 改 | **/flowai 面迁移**（mediaContentUrl(fileId) 单点+census——**nginx -T 实证先行**） | C0b |
| video-work/snapshot-filter.util.ts + video-work-clone.service.ts | 改 | FilteredNode+公开 natural+cells 删 | C0b/A1 |
| shared/types/group.ts + storyboardConfig.ts | 改 | GROUP_NODE_DATA_KEYS 删 cells+capacity 派生 | A1 |
| scripts/dev-reset-canvas.mjs | **建** | 六表清+双 bump 演练+**rebuild cutover runbook 联动** | B3 |

**不动红线**：NODE_ENVELOPE_KEYS；exec 域写面；ecosystem 双进程；doc-status generation 跳变消费链；DOC_TOP_LEVEL_MAPS 四根；Y1c-1 世代段。

---

## 片 P0-pre：机械前置（T0-T3——零行为变更）

### Task 0: exact pin+ffprobe CI/部署 pin
**Files:** 两 package.json（yjs/sharp exact+**fast-deep-equal+file-type**）+overrides+ci.yml（ffprobe 安装 pin）+media-process（版本探测）
- [ ] 先红（pin+CI ffprobe 步）→实现+Commit。

### Task 1: DocNodeRecord→StoredNodeRecord 单 commit 改名
- [ ] census→改名→三面 tsc+全量绿→Commit。

### Task 2: 抽 collab-doc-ops.ts 纯模块
- [ ] 原语+类型同迁+环检测零命中→Commit。

### Task 3: Prisma 全量迁移（v10 表结构）
**Files:** schema.prisma+migration（`execseq_outbox_registration_flush`）

- [ ] **Step 1: schema**

```prisma
// DB sequence（migration SQL: CREATE SEQUENCE "exec_seq" AS BIGINT）
enum ProbeState { pending running done failed skipped }
enum MediaStatus { pending processing completed failed }  // v10.1：String→enum（无数据直接改）；processing=stage/video 未 materialize；failed=终态失败（补偿退款）
sourceUrl String?                        // v10.1：provider 源 URL——专用列禁入 metadata（media-batch 整行 spread 泄漏）；所有读路径 select 排除
sourceUrlExpiresAt DateTime?             // v10：源过期判定（过期→materialize 重试判据）
materializeAttempts Int @default(0)
nextMaterializeAt DateTime?
materializeLeaseUntil DateTime?          // v10：materialize 自有 lease（与 intent attempts/rearm 解耦）
materializeError String? @db.VarChar(512)
probeState ProbeState @default(pending)  // confirm 后按 sniffed 重算
probeAttempts Int @default(0)
probeError String? @db.VarChar(512)
probeFailureKind String?
probeLeaseUntil DateTime?
probeRunId String?
nextProbeAt DateTime?                   // jitter 退避
probedAt DateTime?                      // 仅审计
factVersion BigInt @default(0)          // 单调事实版本（每次 natural/sniff/status 变更+1）
naturalWidth Int? / naturalHeight Int?  // display
naturalRotation Int?                    // 血缘
naturalSource String?
sniffedMimeType String?
sourceIntentRowId String?               // 资金型锚（=GenerationIntent.id）——保留矩阵：有 artifact 的 intent 不物理删（7d 悬空锚根修）
sourceExecSeq BigInt?                   // 代际
sourceRegistrationKey String?           // 非资金幂等锚（taskId+index|mediaId|exportRequestId）
artifactIndex Int @default(0)
objectKey String? / objectSha256 String?
size BigInt                             // Int→BigInt（2GB 上限根修）+ BigInt.prototype.toJSON 全链
bindings MediaBinding[]
@@unique([bucket, key])                 // 对象级幂等
@@unique([sourceIntentRowId, sourceExecSeq, artifactIndex])  // 资金型 finalize 幂等
@@unique([sourceRegistrationKey])       // 非资金幂等（nullable unique）
@@index([probeState, nextProbeAt])
@@index([sourceIntentRowId, sourceExecSeq])
@@index([status, nextMaterializeAt])    // v10：materialize claim
```

```prisma
model MediaBinding {                        // v10.1：纯索引（attach 状态机死列全删——attach consumer 取消后无消费者）
  id String @id @default(cuid())
  mediaId / projectId / nodeId / teamId String
  role String @default("primary")
  targetField String @default("fileId")    // fileId|referenceImage|images|allImages（删 videoUrl/resultUrl）
  targetItemId String @default("")         // 非空 sentinel（PG NULL 不去重根修）；v10.1：一 intent 一 artifact 默认 ''
  createdAt DateTime @default(now())
  media Media @relation(fields: [mediaId], references: [id], onDelete: Cascade)
  @@unique([mediaId, projectId, nodeId, role, targetField, targetItemId])
  @@index([projectId, nodeId])
}
// 惰性 reconcile=create-only upsert（ON CONFLICT DO NOTHING——绝不改已有行的资金锚；「清锚」语义废止——锚在 Media.sourceIntentRowId/intent）
```

```prisma
enum ArtifactState { none materializing stored failed }  // v10.1 四态：video finalize=materializing→materialize 成功 stored；幂等判据 artifactState∈{materializing,stored}
// GenerationIntent 增列（v10.1）
execSeq BigInt @unique                    // 全局单调（exec_seq sequence nextval 两处：new claim/rearm）
reservedExecSeq BigInt?                   // reserve 时写；settle/void CAS 匹配
execProjectedExecSeq BigInt?              // error 投影代际（替代布尔标记）
artifactState ArtifactState?
resultText String? @db.Text
providerRequestId String?                 // v10.1 write-ahead：submit 前落库（Idempotency-Key——消灭 submit→DB 崩溃窗）
providerTaskId String?                    // submit 后落库（现状 schema:1014 列在但全仓零写库点）——query-first 重入锚（键序 requestId→taskId）
@@index([status, artifactState])
@@index([status, execProjectedExecSeq])
@@index([providerTaskId])
```

```prisma
enum DeliveryState { pending delivering delivered orphaned superseded failed }
model DocDelivery {                        // v10.1：funding-only（非资金路径零 doc 写实证——禁 execSeq=0 伪造；确需非资金 doc 写时建独立 DocCommand 表）
  id String @id @default(cuid())
  intentRowId String
  execSeq BigInt                          // 代际快照
  projectId / nodeId String
  kind String                             // 收敛 fileId|text（videoUrl/resultUrl 删）
  payload Json?
  artifactIndex Int @default(0)
  targetField String @default("fileId")   // 词表同 MediaBinding
  targetItemId String @default("")        // 非空 sentinel；v10.1：一 intent 一 artifact 默认 ''
  expectedValue String?                   // v10.1 token=fileIdRev（claim 装载 doc 捕获→finalize 写入→apply 比较→不匹配 superseded）
  state DeliveryState @default(pending)
  attempts Int @default(0)
  leaseUntil DateTime?
  runId String?
  nextAttemptAt DateTime @default(now())
  spoolDeadline DateTime?                 // 仅 {retry,failed} 态兜底（1h 转终态+告警）——spooled 磁盘安全无限重试不假失败
  maxAttempts Int @default(10)
  deliveredAt DateTime?
  lastError String? @db.VarChar(512)
  createdAt DateTime @default(now())
  @@unique([intentRowId, execSeq, nodeId, kind, artifactIndex, targetField, targetItemId])
  @@index([state, nextAttemptAt])
  @@index([intentRowId, execSeq])
}
// 保留矩阵（v10.1）：intent 行 ≥ Media（sourceIntentRowId）/DocDelivery 引用——有 artifact 的 intent 不物理删（soft delete 或 FK ON DELETE SET NULL+保留 sourceExecSeq）；DocDelivery delivered 30d / MediaFactOutbox published 7d retention
```

```prisma
model MediaFactOutbox {                   // 替换 watermark
  id BigInt @id @default(autoincrement())
  mediaId String
  projectId String                        // union(Media.projectId, binding.projectId)
  factVersion BigInt
  factType String @default("natural")      // v10.1：natural|state（processing/completed/failed 状态推送——UI「处理中」来源）
  payload Json                            // {natural:{width,height}} | {state:'processing'|'completed'|'failed'}
  state String @default("pending")        // pending|published|dead
  attempts Int @default(0)
  nextAttemptAt DateTime @default(now())
  leaseUntil DateTime?
  publishedAt DateTime?
  createdAt DateTime @default(now())
  @@unique([mediaId, projectId, factType, factVersion])  // v10.1：factType 入唯一键
  @@index([state, nextAttemptAt, id])
}
```

- [ ] **Step 2: migration（含 CREATE SEQUENCE exec_seq）+fresh replay 必验**。
- [ ] **Step 3: Commit**。

**片 P0-pre 出口**：三面 tsc 绿+全量绿+census+pin 绿。

---

## 片 B1a（必做）：只读命令门（T4）

### Task 4: canEditCommand 单源门+七命令补门（维持 v7）
**Files:** syncStatus+nodeStore+canvasStore（七命令首行门）+canvasUndo
- [ ] 先红（G34 含七命令 viewer cs 突变红相）→绿+Commit。

---

## 片 C0b：服务端事实写（T5-T10）

> **五面纪律**：每卡自检生产/交付/消费/生命周期/崩溃端；**每卡至少一个真 PG 并发用例**。

### Task 5a: MediaFactOutbox+REST（at-least-once+processing fact+POST）

**Files:** media-fact.ts+media-facts.controller.ts（**读 ACL 单门 assertMediaReadable——项目成员+Media.teamId===project.teamId；projectId=null 退化 team member〔素材库〕；公开页按已发布 workId 不按 mediaId**）+media-fact-emitter.ts（SKIP LOCKED 认领+**at-least-once**）+snapshot-filter（FilteredNode+公开 natural）+nodeStore（ImageItem 去 url）

- [ ] 先红（G42/G28）：outbox 乱序提交必达（red：watermark 跳过 A）+**重复投递幂等（factVersion 去重——red：v9「重启零回放」假绿复现）**+**processing fact 同事务推送（stage/finalize 建 Media(processing) 时插 factType=state payload=processing——red：UI「处理中」无推送来源 425 轮询复现）**+correction 新 version 必达+惰性 reconcile 后到补发+published retention+**REST POST（≤200 ids——red：GET 500×36≈18KB 超 nginx 8KB header 414）**+**读 ACL：跨项目 mediaId 403（red：media.service 现状只 assertTeamMember）+projectId=null team member 退化**+**sourceUrl 零泄漏（DTO/select 测试）**+快照 join（公开 payload：natural 在/mediaId·probe 域不在）→绿+Commit。

### Task 5b: MIME 全链+content 两态代理+SafeRemoteFetch+BigInt 四读路径

**Files:** media-content.controller.ts（**GET /api/media/:id/content 两态**：ready=对象存储流式+Range/HEAD/ETag/304+nosniff+非白名单 attachment；processing=SafeRemoteFetch allowlist 流式代理 sourceUrl+no-store+maxContentLength 上限+超限降级 410/425+Retry-After）+**SafeRemoteFetch**（https+host allowlist+私网 IP 拒+maxRedirects:0+流式限长+content-type 白名单——ai-download:62 SSRF 根修共用）+storage.service.ts（confirm **嗅探（file-type 16.x 或自研）+白名单拒+删对象+按 sniffed 重算 probeState+confirmInTx 带 status='pending' CAS**）+minio.service.ts（presign Content-Type 条件——**Content-Type 须进 presign.fields 否则全 403**）+**BigInt.prototype.toJSON**

- [ ] 先红（M1/M2，**CI S3 兼容服务真跑——禁 mock 验证 MIME/presign/Range**）：MIME 嗅探→HTML/SVG/PE 拒+删对象+计数；伪报 audio 的图片按 sniffed 重算 pending（red：永 skipped）；presign Content-Type 条件（red：不进 fields 全 403）；media content 两态：ready=Range/206（**视频可拖动——red：mediabunny UrlSource 顺序退化**）/HEAD/ETag/304；processing=allowlist 代理+超限降级；**SSRF 拒（私网 IP/重定向/超限断）**；生产 MinIO 直链禁用；**BigInt：storage-quota agg 算术/media-batch spread/material list 四读路径可 JSON.stringify（red：TypeError 复现）**→绿+Commit。

### Task 5c: /flowai 面迁移（24 处/15 文件）

**Files:** **web 全仓 24 处/15 文件**（mediaApi/videoWorkApi/ImageGenNode/MultiImageConfigPanel/MultiImageNode/VideoGenNode/AudioGenNode/AddNodeMenu/AssetPanel/export·upload/useTeamAssets/materialLibraryStore/splitUploadService/useImageUpload/mediaUploadUtils）

- [ ] **开工前置：生产 `nginx -T` 核 /flowai location 存在性**（改前必做）。先红：`mediaContentUrl(fileId)` 单点+census 零改写正则（red：24 处现状）+ImageItem 无 url 键→绿+Commit。

### Task 6a: execSeq/claim/reserve/rearm/同 job 重入 lease（v10.1 拆卡①）

**Files:** generation-intent.service.ts（execSeq nextval 两处+**providerRequestId submit 前落库**+providerTaskId submit 后落库+rearm 事务〔nextval+**voidInTx 只释放**+旧 DocDelivery superseded〕+completeInTx+fail/touchHeartbeat/reanchorDeadline 补 execSeq）+team-credit.service.ts（settleInTx/voidInTx+reserve 写 reservedExecSeq+CAS）+execution.service.ts（**同 job 重入三态：心跳新鲜→`job.moveToDelayed(now+lease 余量+grace, token)`+抛 DelayedError 不 ack；过期→接管新 execSeq fence；未知→可重试错误**——撤自行 settle/complete/交付）+execution.processor（skip 路径 moveToDelayed）+**canvas-doc-manifest.ts（EXEC_STATUS_KEYS/ExecStatusPatch+execSeq: string+键集单源两集合四处共用导出常量——v10.1 正交化：SERVER_WRITABLE={fileId,resultUrl,videoUrl,result,natural,errorCode,fileIdRev}〔content 出白名单〕/CLIENT_FORBIDDEN 同集；compareExecSeq 单源）**

- [ ] census→先红（G48 前半）：**manifest 前置**（red：EXEC_STATUS_KEYS 无 execSeq——UNKNOWN_KEY 门口死）+compareExecSeq property test（2^53 边界/前后导零/非法值 drop）；**同 job 重入三态**（red：现状「skip 后 return=ack→旧 worker 真死零交付」悬挂复现——moveToDelayed 后 grace 重投接管/完成；**job data 无 execSeq**）；**新 intent 新代不被旧 done 挡**（red：反例 B）+旧 error 不覆盖新 loading+fail/touch/reanchor 旧代 0 命中 no-op；**rearm 只释放**（red：v9「release+re-reserve」新 worker mayCall:false 静默跳过复现——team-credit:105）；**providerRequestId submit 前落库+providerTaskId 后落库+query-first 键序 requestId→taskId**（red：现状零写库点；kill worker after submit→重跑**零重复 provider submit**）；Idempotency-Key+同步 provider 能力矩阵（text 不可 query-first 显式标注）→绿+Commit（真 PG+真 BullMQ）。

### Task 6b: ArtifactCommit（stageInTx durable+finalize 短事务+materializing）

**Files:** **shared artifact-core module**（AppModule+WorkerModule 双 import+双 role DI 测试）：artifact-commit.service.ts（**stageInTx 短事务**〔不锁 balance：先落 Media(processing, objectKey/sha/size/sniff+source 锚) ON CONFLICT DO NOTHING 幂等返回+**同事务插 processing fact**→对象上传〔SafeRemoteFetch 下载+content-addressed key+服务端自算 sha256+sniff〕→回写 stage 行；orphan sweep 以 stage 行为准+覆盖旧 execSeq 前缀〕+**finalize 短事务 <50ms**〔lockBalance→intent FOR UPDATE 重验→幂等前置〔**v10.1 判据：SUCCEEDED∧artifactState∈{materializing,stored}∧creditsConsumed=cost**〕→Media 状态提升/CAS（RUNNING∧execSeq→SUCCEEDED+artifactState）/settleInTx；事务内禁外部 IO〕+40P01/40001/55P03/P2024 有界重试+quota claim 前预检〔estimatedBytes〕）+media-registration.service.ts（prepareUploadInTx〔补 projectId〕/registerInTx/confirmInTx〔pending CAS〕/bindInTx）

- [ ] 先红（G48 中段）：**stage durable 崩溃窗**（stage 后 kill -9→R3 凭 processing 行收敛：HeadObject 命中→finalize；对象缺失→重下/退款——red：「对象在 DB 无记录」孤儿复现）；**幂等前置=artifactState∈{materializing,stored} 判据**（red：仅 stored 把 video processing 误判半状态）；**finalize 锁序 balance→intent**（死锁注入零 40P01/55P03+**事务注入 100ms sleep 锁等待/池不恶化**）；stage 失败零扣费；settle 失败整体回滚；**shared module 双 role DI**（red：worker DI 图不可解析 P0 复发）；**confirmInTx 并发双 confirm 恰一 no-op**（red：storage:69-99 无守卫）→绿+Commit。

### Task 6c: DocDelivery（单一 poller funding-only+fileIdRev+带理由窄接口 flush）

**Files:** collab-document.service.ts（exec 守卫 execSeq 化+deliverArtifact 复合 op 前置判定+**fileIdRev 机制**：DocDelivery 写 fileId 时 +1/replaceMedia 递增/apply 比较）+collab-doc-ops（同值 no-op）+collab-persistence.service.ts+collab-residency.service.ts（**flushDocument 带理由窄接口 `{persisted}|{retry,reason:'spooled'|'failed'}|{terminal,reason:'fenced'|'fk'}`——显式调 storeDocumentSerialized〔saveMutex 内〕替代 ephemeral-disconnect 当 flush 原语**+维护门 503）+delivery-outbox.poller.ts（**funding-only**：认领 CAS〔SUCCEEDED∧artifactState∈{materializing,stored}〕+批量 apply+一次 flush+复核〔execSeq/expectedValue=**fileIdRev**/节点〕+mark 后 lazy GET media-facts+dead 行 on-load reconcile/admin retry 重驱+onModuleDestroy）

- [ ] 先红（G44/G46/G58）：deliverArtifact 前置判定在 data patch 前（red：先 data 后 exec partial）；**fileIdRev token 闭环双向时序**（在飞→用户 replace→delivery 到达→**superseded 不覆盖用户值**〔red：applyWriteNodeDataToDoc 无条件 set document:286 复现〕；反向 replace 覆盖成功）；**flush 四窗全收敛**+**带理由窄接口**（red：三态无 reason 下 spooled 被当 failed 耗 attempts+**PG 停机>1h spool 判死假失败复现——spooled 保持 pending 无限重试**；fenced 停 claim 等租约非 failed；fk→orphaned）；批量一次 flush；**flush 后同一 session 内 recheck**；**funding-only 断言**（red：非资金路径伪造 execSeq=0 复现——grep 证明 trim/stitch/separate 零 DocDelivery 写）→绿+Commit。

### Task 6d: MaterializeJob+R3 reconcile（finalizeFromExistingMediaOrText）

**Files:** worker MaterializeJob（**ai-download 迁移改造**：video processing→completed；幂等键=mediaId；自有 lease/attempts；**复用同一次下载算 natural/hash/mime 置 probeState=done**——免 probe 二次下载 1GB；**不写 doc**；成功→artifactState=stored；终态失败→幂等补偿退款+artifactState=failed+**DocDelivery/exec errorCode=MATERIALIZE_FAILED**〔不清 fileId——UI 失败/重试〕+告警）+intent-reconcile.service.ts（**R3 自动收敛：所有入口走 `finalizeFromExistingMediaOrText(intentId,execSeq)`**〔v10.1 改名——避免执行者找不存在的 Artifact 表〕+动作表+**FAILED/VOIDED∧reserved>0∧无 artifact/无 delivered 守卫**+审计行 reconcile_action+auto_converged/manual_required 分计数+pg_advisory_xact_lock；**三后门删除**+**backfillSucceeded 禁写 SUCCEEDED+null**；cleanTerminalIntents+保留矩阵）+collab-write.port.ts（typed outcome——资金路径禁伪造 written:true）+exec error reconcile（execProjectedExecSeq+活跃项目+24h）

- [ ] 先红（G48 后半/G51）：**video=Media(processing)+artifactState=materializing**（finalize 后 doc 只有 fileId〔grep doc data 无 videoUrl/resultUrl〕+processing 期可播/seek+processing fact 推送）；materialize 幂等重试不重复 Media；源过期 410/重试；**终态失败→补偿退款+errorCode（不清 fileId——UI 失败态）**；materialize 重试预算与 intent attempts/rearm 解耦（存储抖动不污染执行状态机）；text=零 Media 只写 result（**content 回显删除——red：:485 现状复现**）；**R3 五窗收敛**（settle 后崩溃/Media 后崩溃/delivery 缺失/node 删除/源过期——一轮收敛+双 settle 零+双 refund 零+审计行）+并发双 reconcile 恰一次+**歧义态（FAILED∧artifact 存在）不自动动钱→告警**+三后门 grep 零命中+**backfillSucceeded 禁写 SUCCEEDED+null**（red：:224-227 无条件置复现）+text 90d→绿+Commit。

### Task 7: probe 单相（分型批/lease+sniffed 路由+40MP）

**Files:** media-probe.poller.ts（worker）+九处 create 面+sweep+media-process（server natural 同事务 done+**factVersion+outbox 插入**）
- [ ] 先红（G23/M1）：claim（**图片批 4 lease 180s/视频 batch 1 lease 5min**——red：批 2×90s 覆盖不了下载+ffprobe 复现；sniffed 路由+deletedAt+SKIP LOCKED）/nextProbeAt jitter/skipped 触发点/server natural done+outbox/sharp 40MP+downscale（产品策略 UX）/EXIF 5-8/ffprobe 沙箱（**spawn 数组+timeout+protocol_whitelist——trim/separate/thumbnail 同改**）/零 doc 写→绿+Commit。

### Task 8: 两编排器 producer 接线+MaterializeJob+binding 惰性 reconcile+fileId 命令

**Files:**
- Modify: **资金五路径**（execution text/image/video+ai-image-edit+lighting——producer 只调 ArtifactCommit〔video=processing+materializing+fileId〕）+**非资金路径**（upload confirm/stitch/trim/separate/export——调 MediaRegistration+bindInTx；**job data 带 registrationKey**；**v10.1：非资金零 doc 写实证维持现状——trim/stitch/separate 结果由客户端经 socket 事件写自己的键（trimmedFileId 等），不经 DocDelivery、禁伪造 execSeq**）
- Modify: **9 处 media.create grep census 映射**（storage:37→prepareUploadInTx〔**补 projectId 落库**〕/media-process:194→register/ai-download:100→**MaterializeJob 接管**/ai-image-edit:199→register/lighting:167→register/video-trim:110→register/stitch:97→register/generated-media:54→register/video-work:91→prepareUploadInTx）
- Create: media-delivery/binding-reconcile.service.ts（**mediaRefsOf 七键扫描+teamId 校验+create-only upsert〔ON CONFLICT DO NOTHING——绝不改已有行的资金锚〕——post-apply guard 联动+周期扫描**）
- Modify: collab-media.controller.ts（**replaceMedia 显式命令〔带 expectedValue+递增 fileIdRev〕**+同 team）
- Test: delivery/materialize/binding-reconcile/controller spec

- [ ] **Step 1: 先红（G43/G46/G51）**

```ts
describe('ADR-7 两编排器+materialize+binding reconcile（G43/G46/G51 v10.1）', () => {
  it('**MediaRegistrationService=唯一 media.create 点**（grep 全仓 media.create 零第二处〔**排除 seed/test**〕——red：现状 9 处直建复现）；资金五走 ArtifactCommit〔video=Media(processing)+artifactState=materializing+fileId〕/非资金走 MediaRegistration 四形态（不碰 settle/complete/DocDelivery/exec——red：无 intent 空指针复现）；**非资金路径零 DocDelivery 写（funding-only——red：伪造 execSeq=0 复现；grep 实证 trim/stitch/separate 只走 emit 族）**；**prepareUploadInTx 落 projectId（red：storage:38-50 现状缺失）**；**confirmInTx 并发双 confirm 恰一 completed 一 no-op（red：storage:69-99 无守卫复现）**', async () => { /* grep+真 PG 矩阵 */ });
  it('非资金幂等：registrationKey（taskId+index|mediaId|exportRequestId）重试不重复建 Media/binding；@@unique(bucket,key)；**MediaFactOutbox @@unique(mediaId,projectId,factType,factVersion) 并发同版本零重行**；**targetItemId sentinel——同键双行必失败（red：PG NULL 不去重现测）**', async () => { /* 真 PG */ });
  it('**MaterializeJob**：幂等键=mediaId（kill 后重跑不重复 Media/不重复下载对象）；**processing→completed 单事务（size+sniffedMimeType+复用同一次下载算 natural/hash/mime+factVersion+outbox completed fact）**；**不写 doc（red：ai-download:118 现状写 fileId+resultUrl 复现）**；终态失败→补偿退款+errorCode', async () => { /* 断言 */ });
  it('**copy 保留 fileId 立即渲染**（新建路径零 strip——red：v9 无条件 strip 副本空图复现）+normalizeCopiedNodeData（loading→idle/done——red：copyPlan:63 连 loading 复制=永久转圈）+**placement/order/slot 重新分配（allocator 唯一入口——red：副本同层同 order 重复键/位置重叠复现）**；**binding 惰性 reconcile create-only**（扫描建行恰一次——重试幂等；**原资金节点扫描后 Media.sourceIntentRowId 锚仍在〔red：update 分支抹锚复现〕**；跨 team 拒+计数不建 binding；**Media GC doc 引用/grace 护栏——副本在媒体不删**）', async () => { /* 断言 */ });
  it('replace=显式命令（带 expectedValue+递增 fileIdRev——非空替换必经此门）；同 team；七键 mediaRefsOf', async () => { /* 断言 */ });
});
```

- [ ] **Step 2: 实现**→**Step 3: 绿+AI 全链冒烟+Commit**。

### Task 9: web 禁写（更新路径 strip 键集精确枚举/新建保留）+socket 降级+manifest 拒写+端点白名单+meta 恢复

**Files:** canvasIntents（**stripServerOwnedData 单点——只挂更新路径：updateNodeData/updateConfig diff/undo 回放剥 CLIENT_FORBIDDEN_DATA_KEYS；v10.1 精确枚举 {fileId,resultUrl,videoUrl,result,natural,errorCode,fileIdRev}——不含 referenceImage/images/allImages/trimmedFileId/videoFileId/audioFileId〔上传路径全在更新路径上，键名一刀切=剥掉上传〕；新建路径（addNode/copyPlan/paste/explode/addImageToStoryboardCell）保留 fileId/images[].id**）+nodeStore（updateConfig 显式键）+**socket 降级：setFileResult 改本地 UI 状态不写 doc+emitNodeStatus video 不传 fileId（red：现状 :298 传 resultRef=URL→useMediaUrl(URL) 404）**+**canvas-doc-manifest.ts（writeNodeData 拒客户端禁写键——仅 linkMedia/deliverArtifact 复合 op 可写；键集单源两集合四处共用——v10.1 正交化：SERVER_WRITABLE={fileId,resultUrl,videoUrl,result,natural,errorCode,fileIdRev}〔content 出白名单——text 交付删 :485 回显只写 result〕/CLIENT_FORBIDDEN 同集）**+collab-write.controller.ts（**op 白名单：worker 仅 writeExecStatus loading/skipped**）+**guard 前置：meta.schemaVersion 修复=恢复 current（v10.1——非删除：docShape:87-91 无戳∧有节点同拒；shadow 也恢复）+计数+可选重连**

- [ ] 先红（直发身份键零写/**diff 跨远端 apply 窗口服务端键被当"变化"发回（red：canvasIntents:502 全键差异复现）→更新路径 strip**/**上传路径零剥（red：键名一刀切——上传参考图 updateConfig {referenceImage} 后 doc 有值；多图上传 images/allImages 后 doc 有值）**/**新建路径保留 fileId（red：v9 全构造点 strip 副本空图）**/**socket done 事件零 doc fileId 写（red：setFileResult 现状写 doc 复现）**/updateConfig 不回送/**服务端 writeNodeData 携 fileId→UNKNOWN_KEY 拒**〔red：现状白名单内可写〕/**worker 端点 writeNodeData→拒**/**客户端发 meta.schemaVersion=2→恢复 current+项目仍可 load（red：现状可写→ensureSchemaVersion throw→brick；「删除」→无戳∧有节点同 throw——恢复非删除）**）→绿+Commit。

### Task 10: 消费端接线（pendingFacts+store 重连全量刷+factVersion）+E2E+片出口
**Files:** canvasCollabRuntime（**pendingFacts 短 TTL Map——fact 先于 fileId 到达时暂存、fileId 到达即消费（red：「忽略未知 mediaId」丢 natural 到重连复现）**+全量拉+按 factVersion 忽略旧+清空+**delivery mark 后 lazy GET media-facts 补拉**）+nodeStore
- [ ] 先红（pendingFacts 消费/全量刷/outbox 事件 version/清空/lazy 补拉）→E2E 真链路+G42/G43/G44/G46/G48/G51/G58 矩阵→**提前 soak 一轮（v10：数字 SLO 见 T28）**→Commit+呈报。

---

## 片 A1：doc 契约+placement 语义（T11-T18，维持 v7 口径+T15 双 bump）

### Task 11: 【并入 T15】双 bump 3（csv+docSchema 两门）——维持 v7。
### Task 12: placement 三型+DOC_NODE_KEYS 7 键（order|slot 判别；读写 vendor 严格）——维持 v7。
### Task 13: order-key vendor+四曲线+等值键 needs-layer-repair——维持 v7。
### Task 14: orderRecords+deriveStoryboardCells（capacity 派生+overflowIds）+收编——维持 v7。
### Task 15: validate+fillDoc slot 写链+四出口+manifest（deliverArtifact/linkMedia 进表）+【T11 双 bump】——维持 v7。
### Task 16: 判别联合+allocator+order/slot 写链+**cells 回流面 11 处删除**——维持 v7（T16 测试矩阵维持）。
### Task 17: **normalizeCopiedNodeData 五路径+copy 保留 fileId+placement 重分配（v10.1 方案二+）**
- **normalizeCopiedNodeData 单函数**（copyPlan/seed/clone 五路径共用）收窄：status loading/error→**有 fileId 则 done 无则 idle**（red：copyPlan:63 structuredClone 连 loading 复制=副本永久转圈）/清 errorCode/error/删 ImageItem.url/**保留 fileId/images[].id（新建路径不 strip——副本立即渲染无空图窗口）**/exec 永不复制/cells 删（remap 删）/**placement/order/slot 重新分配（v10.1——allocator 唯一入口；red：副本同层同 order 重复键/位置重叠复现）**。
- **binding=服务端惰性 reconcile（create-only）**（T8 binding-reconcile.service：mediaRefsOf 扫描+teamId 校验+**ON CONFLICT DO NOTHING——绝不改已有行的资金锚**；零客户端调用零新端点，离线 paste 天然覆盖，跨项目同 team 自然成立）。
- **跨 team paste=客户端 strip 身份引用**+服务端不建 binding+读 ACL 403 兜底；**Media GC doc 引用/grace 护栏**。
- [ ] 先红（copy loading 节点→副本 idle/复制完成图节点→副本立即显示 fileId 保留+**同层 order 唯一**/binding 惰性建行恰一次+**原资金节点锚不动**/exec 不复制/跨 team paste 无 fileId）→绿+Commit。
### Task 18: 空间 tie-break+doc-shape-invalid——维持 v7。

**片 A1 出口**：维持 v7 判据+呈报。

---

## 片 A2：序域执行（T19-T21）

### Task 19: soft/hard+on-demand repair=**in-place renumber 主路径**+病理档

**Files:**
- Create: collab-pathology.ts+collab-maintenance.service.ts（soft 计数+病理档+**repair 执行体=in-place**：维护互斥〔CollabMaintenance 行+共享 vacuumGate+**pg_advisory_xact_lock('maintenance:<pid>') 跨进程保险**〕→applyWriteFreeze('repair')〔不 close/不 reload/不清 IDB/不跳 generation〕+新连接只读+DocDelivery 维护门 503→**per-project RW 写屏障**〔writer refcount/maintenance 排他：先置 maintenance=true 拦新 writer 再等 refcount 归零；MAINTENANCE origin 自 bypass——writesSettled 是持久化谓词拦不住在飞 withSession〕→纯函数修复计划〔受影响层 (oldOrder,id)+带间隙新键+去重〕→**withSession(write, MAINTENANCE_TRANSACT_ORIGIN) 分块 ≤64KB=独立事务**→回读校验→解除 readOnly+RepairRun 审计；**单块预算**〔fallback 只留给不可表达结构——**「总量 256KiB 退 vacuum」废止，总量大就多块**〕）
- Modify: collab-shrink.service.ts（**vacuum 兜底仅限「确定无离线客户端」运维窗**——无 generation 握手不得自动回退〔握手归 Y2〕；vacuum 路径等价断言补 exec 值比较〔vacuumEquivalent 现状只比键集合 registry:655-663 勘误〕）+collab-residency.service.ts（**维护门 assertMaintenanceFree 覆盖 withSession/withDoc 全写路径**——DocDelivery 消费者维护窗 503 退避）+MAINTENANCE origin
- Modify: **web purgePidCaches 修复**（local-cache-key+runtime——**仅 vacuum 兜底路径关联**：generation jump 清同 pid 全部代+**真 IDB 测试断言实际删除集合**〔red：现状保留脏旧代复现〕）
- Create/Modify: collab-media.controller.ts（repair 端点——小文档同步 200/大文档 202+jobId+单飞+OWNER/ADMIN）
- Test: collab-pathology.spec.ts

- [ ] **Step 1: 先红（G45/G53）**

```ts
describe('ADR-5 v10.1 repair=in-place（G45/G53）', () => {
  it('repair 执行体：维护互斥（**repair 进行中 vacuum→409/反之**+advisory lock）→applyWriteFreeze+维护门 503+**RW 写屏障（持有 delivery 的 withSession 启动 repair→等待不丢写；repair 期间新 delivery 503）**→分块 ≤64KB 独立事务写入→回读校验（**等价断言=忽略 order|slot 的节点/边/data/exec 值等价——非 order/slot 键零变化**）→解除 readOnly；**幂等可重跑（崩溃→maintenance 行 stale→aborted→重跑收敛）**', async () => { /* 断言 */ });
  it('**零断线零 reload**：10k 重复 order→in-place 修复——**全部客户端连接保持、零 reload、零 IDB purge、undo 保留**（red：v9 vacuum 全套断线 reload 复现）；**离线客户端事后合并零节点复活**（red：preVacuumSv 放行新 clientID 复现 registry:689-697——in-place 后该面不存在）', async () => { /* 真双端 */ });
  it('**维护门全覆盖**：repair 窗口 DocDelivery 消费者 writeNodeData→503 退避不 mark（red：维护窗内交付被 repair 窗口写竞争复现）；**并发客户端在 repair 窗口移动节点→无 500 无损坏、读侧 (order,id) 稳定**', async () => { /* 断言 */ });
  it('**不可表达结构回退 vacuum**：构造非 Map 根/损坏 update log→显式退 vacuum 兜底→旧客户端 4410+一次 reload+**purgePidCaches 全代清（真 IDB 断言——red：现状保留脏旧代复现）**——**大文档多块不 fallback（10k 全层 300KB+ 仍 in-place——red：「总量退 vacuum」退化复现）**', async () => { /* 断言 */ });
  it('soft/hard/dup/病理档维持（key-too-long→repair 仍触发 in-place）', async () => { /* 断言 */ });
});
```

- [ ] **Step 2: 实现**→**Step 3: 绿+双端演练+Commit**（`feat(collab): repair=in-place+RW 写屏障+单块预算+vacuum 运维窗限定（ADR-5 v10.1/G45/G53）`）。

### Task 20: guard——spike（exec+身份键+meta 域）→shadow 定档+post-apply 检测+读 ACL
**Files:** collab-content-guard.ts+scripts/c0a-guard-exec-spike.mjs+collab-doc-registry:677
- [ ] spike（exec 伪造+身份键直写+**meta.schemaVersion 篡改**检测）→**shadow 定档（检测+计数+诊断事件+修复——不承诺拦住）**→post-apply 恒做（afterTransaction 队列+修复+诊断）+**meta.schemaVersion 修复=恢复 current（v10.1——非删除：docShape:87-91 无戳∧有节点同拒；shadow 也恢复）+篡改后项目仍可 load 用例**+**generated/uploaded 类型分流（写 generated mediaId→检测+读 403 计数；uploaded 引用不拦）**+**server/maintenance origin 零误报**+guard-contract.spec+Commit。验收口径：**检测到+可修复+读侧拒绝**（editor 伪造 fileId→写入成功〔shadow〕→读 403→guard 计数→修复恢复/删除；伪造他队 mediaId→403 不泄漏；viewer 直发 update→协议 readOnly 拒）。

### Task 21: repair CLI（placement/slot/dup/binding——经维护租约；**默认 in-place，--vacuum 仅紧急**）
- [ ] 先红（四形态+环+duplicateLayers+binding 缺失+in-place 默认）→绿+Commit。

---

## 片 A3：收敛 harness（T22）

### Task 22: 五件套+双端真连+故障注入（v10.1 矩阵）

**Files:** web node config+fixtures+api collab-harness/provider-convergence.e2e-spec.ts

- [ ] 先红：五件套（slot 派生档）/双端收敛/G17 改口档/分镜并发零成员丢失/等值邻居/重复键层 repair（in-place）/双端避让/真连+分区重启/**DocDelivery flush 四窗**/**execSeq 代际矩阵（同 job 双 worker 三态 moveToDelayed——旧 worker 在 skip 后被 kill→grace 后重投接管/完成，零「completed 但 RUNNING 悬挂」）**/**exec alignExecFromIntents 重建**/**in-place repair（10k 修复零断线零 reload+离线客户端事后合并零复活+repair vs vacuum 409+RW 写屏障持锁并发+维护窗 503+崩溃重跑+不可表达结构回退 vacuum+旧 IDB 全代清）**/**outbox 乱序提交+重复投递幂等**/**video materialize 矩阵（processing 期可播 seek+processing fact 推送/下载失败重试/进程崩溃 resume/URL 过期→410/终态失败→补偿退款+errorCode）**/**copy 保留 fileId 立即渲染+placement 重分配+binding 惰性 reconcile create-only+跨 team paste strip**/**R3 五窗收敛**/**guard 检测→修复（meta 恢复 current）→ACL 拒绝链路**/**strip 键集矩阵（上传路径 referenceImage/images/allImages 不被剥）+socket 零 doc fileId 写**/**pendingFacts 消费**/reset 联动。
- [ ] 绿+Commit（`feat(web+api): A3 harness（G12/G17/G45/G46/G53/G55/G58 v10.1）`）。

---

## 片 B1-B2（T23-T27，维持 v7 口径）

### Task 23: DocShapeInvalidError+enterDocInvalid 收窄——维持 v7。
### Task 24: resync 分流+write-rejected 节流（**v10.1：repair UX=in-place 同步 200/202——无 generation reload 单链；generation 单链仅 vacuum 兜底路径**）——维持 v7。
### Task 25: 删除面+cells 消费面迁移（T26 同窗先行）——维持 v7。
### Task 26: applyIntrinsicFit（store+display+imageRotation+分镜跳过+G28 公开 natural）——维持 v7。
### Task 27: D6 autoOrigin——维持 v7。

---

## 片 B3：终出口（T28）

### Task 28: 双 bump 门+dev reset（六表）+verify/CI+UX 签字+soak+rebuild cutover runbook

**Files:** collab-protocol+docShape:41（双常量=3——**v10 保留：生产 epoch 14 在线旧 bundle 混跑窗真实**）+session-guard（csv 拒连；docSchema 拒载既有门）+dev-reset-canvas.mjs（**六表清：CanvasDoc/CanvasDocUpdate/MediaBinding/DocDelivery/MediaFactOutbox/Media 生成物**+spool/Redis+MinIO temp+IDB 预置）+verify-manifest（census/排序/guard/曲线/pin/cells 零残留/**media.create grep census 单点**/**DOC_NODE_KEYS 契约表**）

- [ ] Step 1 先红（G21/G33/D2/G57）：旧 bundle（csv=2）→schema-outdated→一次 reload（守卫不绕过）；旧 doc（docSchema=2）→拒载+IDB 不命中+Redis 键失效；Redis 停机协作不受影响；reset 六表→零重放零复活→两轮零回灌。
- [ ] Step 2 双 bump（唯一新代码=两常量）→Step 3 verify/CI 全绿+双拒实证。
- [ ] Step 4 UX 签字（slot 交互/身份键不回送+fileId 替换显式命令〔带 expectedValue〕/hard 128 修复入口/text 32KB 截断+全文入口/媒体库保留 N 天/**40MP 图片上限+downscale 提示**/**media content 两态下载行为+processing 占位降级**/**video processing 期「处理中」UX**）。
- [ ] Step 5 soak（数字 SLO）：10k+10 客户端 10min：投影 p95≤30ms+React commit+doc 字节不随同值写增长+单帧<128KB+doc<8MB+probe lag p95≤60s+delivery lag p95≤60s+**outbox lag**+facts 批量 p95≤100ms+**artifact commit p95**+**materialize lag**+**applied_unpersisted=0**+内存上界。
- [ ] Step 6 **rebuild cutover runbook 落盘**（非 additive DDL：pg_dump+MinIO 备份→队列 pause+drain→双进程停机→迁移〔check-migration-additive 实判按 rebuild 设计〕→依次起 api/worker→回滚=restore 非 down migration+回滚演练）→Commit+部署窗呈报。

---

## 验收门禁（v10.1 汇总——判据随 spec v13b §5 权威表）

**保留**：G1-G15/G17（改口）/G18-G20/G22/G47/G54/G55/G56/G57（v10 口径）。

| 门 | v10.1 增强点 |
|---|---|
| G42 | **MediaFactOutbox（乱序提交必达/重复投递幂等〔factVersion 去重〕/processing fact 同事务推送/correction 必达/惰性 reconcile 补发/读 ACL 单门 IDOR 拒+projectId=null 退化 team member/@@unique(mediaId,projectId,factType,factVersion) 零重行）+REST POST≤200+pendingFacts 消费+mark 后 lazy GET+published retention** |
| G43 | **两编排器**（MediaRegistration=唯一 media.create 点 **grep census 零第二处〔9 处非 11——排除 seed/test〕**+**prepareUploadInTx 补 projectId+confirmInTx pending CAS**；**video=Media(processing)+artifactState=materializing+fileId；text 零 Media 只写 result**；**非资金零 doc 写——DocDelivery funding-only 禁 execSeq=0**；registrationKey 幂等；**shared module 双 role DI**） |
| G44 | deliverArtifact **前置判定在 data patch 前**+execSeq reason-aware+deep-equal no-op+**fileIdRev token 闭环（claim 捕获/finalize 写入/apply 比较/replace 递增——用户 replace 竞态双向时序：superseded 不覆盖用户值）** |
| G46 | **strip 键集精确枚举（上传引用键 referenceImage/images/allImages 零剥——red：键名一刀切）+socket done 零 doc fileId 写+copy 保留 fileId 立即渲染（新建路径零 strip）+placement/order 重分配（同层 order 唯一）+normalizeCopiedNodeData+binding 惰性 reconcile create-only（原资金节点锚不动）+Media GC 护栏+targetItemId 非空 sentinel（NULL 双行必失败）** |
| G48 | **execSeq 三态重入 moveToDelayed（心跳新鲜→delayed 不 ack——旧 worker skip 后被 kill→grace 重投接管/完成，零「completed 但 RUNNING 悬挂」/过期接管 fence/未知重试）+EXEC_STATUS_KEYS+compareExecSeq 单源 property test+锁序死锁注入零 40P01/55P03+finalize 100ms sleep 注入+stage durable（stage 后 kill -9→R3 凭 processing 行收敛）+幂等前置（artifactState∈{materializing,stored} 判据）+rearm=voidInTx 只释放+providerRequestId write-ahead+providerTaskId 落库+query-first 键序 requestId→taskId（kill 后零重复 submit）+video materialize 矩阵（materializing→stored；终态失败补偿退款+errorCode）+quota claim 预检 estimatedSize+fail/touch/reanchor 旧代 no-op+R3 五窗收敛（双 settle 零双 refund 零+审计行+FAILED∧reserved>0 void 无 artifact/delivered 守卫）+backfillSucceeded 禁写 SUCCEEDED+null** |
| G23/M1 | 分型批/lease+sniffed 路由+jitter+40MP+**ffmpeg spawn 数组+timeout（trim/separate/thumbnail 同改）**（**probe 仅上传路径——materialize 复用下载免二次探测**） |
| M2 | **media content 两态（ready Range/206 视频可拖动+processing allowlist 代理降级 410/425）+MinIO 直链禁用+读 ACL 单门（跨项目 403/公开页按 workId）+sharp 重编码+size BigInt+BigInt toJSON 四读路径+sourceUrl 零泄漏+/flowai 面迁移（mediaContentUrl 单点+census）+SSRF 用例+CI 真 S3** |
| G53 | **repair=in-place**（零断线零 reload 零 IDB purge+离线客户端事后合并零复活/**RW 写屏障持锁并发**/维护门 503/崩溃重跑幂等/等价断言〔忽略 order\|slot+exec 值〕/**不可表达结构回退 vacuum**+4410+purgePidCaches 全代清〔仅 vacuum 路径〕/repair vs vacuum 409/**大文档多块不 fallback**） |
| G58 | **flush 四窗全收敛+载体=带理由窄接口（{persisted}|{retry,spooled\|failed}|{terminal,fenced\|fk}——显式 storeDocumentSerialized）+spooled 无限重试不假失败（PG 停机>1h 保持 pending）/failed 耗 maxAttempts+spoolDeadline 1h/fenced 停 claim 等租约/fk→orphaned+批量一次 flush+flush 后同一 session recheck（用户 replace superseded 不覆盖）+dead 行重驱**——mark delivered 撒谎根修 |

---

## 自检（plan v10.1——writing-plans Self-Review）

**v10.1 边界收口十一条落位**：①非资金 lane 删除=T8（funding-only 断言+grep 实证）；②ArtifactState 四态 materializing=T3（enum）+T6b（幂等判据）+T6d（materializing→stored）；③stage durable=T6b（stageInTx+processing fact+orphan sweep 以 stage 行为准）；④moveToDelayed+providerRequestId write-ahead=T6a；⑤strip 键集精确枚举+socket 降级=T9（+T8 emitNodeStatus）；⑥content 出白名单（text 只写 result）=T6a（键集）+T6d（text 用例）；⑦meta 修复=恢复 current=T9/T20；⑧fileIdRev token=T3（DocDelivery.expectedValue）+T6c（闭环）；⑨repair RW 写屏障+单块预算+advisory lock=T19；⑩multiImage 一 intent 一 artifact+copy placement 重分配=T3（targetItemId=''）+T17；⑪consistency pass=头注+门禁+自检全量对齐。

**v13 六裁决+残余 P0 十三条落位（维持）**：①video=T3/T6b/T6d/T5b/T22；②repair in-place=T19/T21/T22；③copy 方案二+=T9/T17/T8；④R3=T6d；⑤guard=T20/T5a/T9；⑥R2=Y2 登记；十三条→T3/T5/T6/T8/T9/T28 全落（见 v10 头注）。

**四分叉裁定落位（维持）**：video settle=provider 成功即 settle；双 bump 保留（T28）；copy binding=惰性 reconcile create-only；StoreOutcome 带理由窄接口先行（五态判别联合仍降后续硬化卡）。

**五面闭环**：生产端（T6/T8 两编排器+MaterializeJob）/交付端（T6c 带理由 flush+T5a outbox）/消费端（T5+T9 strip 更新路+T10 pendingFacts+T26）/生命周期端（T17+T28 六表+text 90d+保留矩阵）/崩溃端（T6 锁序/幂等/四窗+stage durable 窗+R3 五窗+T19 维护门/写屏障+T22 注入）。

**v10→v10.1 实质差异（执行者勿混用）**：①**非资金 DocDelivery lane 删除（funding-only）**——v10「非资金需写 doc 者并入」是错误假设（亲验零 doc 写）；②**ArtifactState 四态 materializing+幂等判据∈{materializing,stored}+统一不变量加 failed 合法终态**；③**stage 事务外→stageInTx durable（Media(processing)=统一 stage 句柄）**；④**同 job 重入 skip→moveToDelayed（BullMQ 不 ack）+providerRequestId submit 前落库（write-ahead）**；⑤**strip 键集精确枚举——上传引用键零剥+socket setFileResult 降级本地 UI 不写 doc**；⑥**content 出服务端白名单（text 交付删回显只写 result）**；⑦**meta.schemaVersion 修复=恢复 current（非删除——无戳∧有节点同拒）**；⑧**expectedValue token=fileIdRev 钉死（claim 捕获/apply 比较/replace 递增）**；⑨**repair per-project RW 写屏障（writesSettled 非屏障）+单块预算（「总量退 vacuum」废止）+advisory lock**；⑩**multiImage 一 intent 一 artifact（targetItemId=''+删多产物 N Media 描述）+copy placement/order/slot 重分配**；⑪**flush 窄接口带 reason+显式 storeDocumentSerialized+spooled 无限重试不假失败+MediaBinding 删 attach 死列（纯索引 9 列）+「清锚」措辞废止（create-only）**；⑫T5 拆三卡（5a/5b/5c）+T6 拆四卡（6a/6b/6c/6d）；⑬processing fact 同事务推送+REST POST≤200+MaterializeJob 复用下载算 natural+probe 仅上传路径+dead 重驱+R3 void 守卫+finalizeFromExistingMediaOrText 改名+assertMediaReadable projectId=null 退化+Media.status enum+providerTaskId adapter 透传链。

**执行期语义定位点（已实证——v10.1 复核新增）**：**非资金零 doc 写（stitch/trim/separate 只走 emitTrimStatus/emitStitchStatus/emitSeparateStatus emit.port:62-86，结果客户端写 trimmedFileId nodeStore:845）**；**text content=用户 prompt 回显（execution:484-486 `content: data.content||prompt`）**；**docShape 无戳拒载（docShape:87-91 sv==null∧有节点→assertDocSchema→throw——meta 修复必须恢复非删除）**；**emitNodeStatus fileId=resultRef（execution:298——video 时为 provider URL）**；**BullMQ return=completed（skip 必须 moveToDelayed 不 ack）**；**一 intent 一 artifact（execution:539 单 result.url）+ImageItem.id=mediaId 随替换漂移**；**withSession 入口门拦不住在飞会话（写屏障需 RW 锁非 writesSettled）**——其余 v10 锚维持（同 jobId 重入不递增 attempts generation-intent:130/:158/exec 守卫只比 attempts document:313-331/reserve mayCall:false team-credit:105/契约 20/三后门 reconcile:163/:215/:224/preVacuumSv registry:689-697/purgeForeignCaches local-cache-key:71/24 处 /flowai/media.create 9 处/providerTaskId 零写库点 schema:1014/enqueue 无 execSeq controller:68/presign 无 projectId storage:38-50/confirmUpload 无守卫 storage:69-99/applyWriteNodeDataToDoc 无条件 set document:286/HttpCollabWritePort 伪造 written:true :181-183/:206/manualRegistration app.module:71/ai-download SSRF :62/updateConfig 终态全量 nodeStore:632/copyPlan:63 连 status 复制/Media.size Int schema:279/Media.status String schema:287/meta writers 仅文档约定 manifest:105-110）。

**与 spec v13b 的对齐**：全部 T 卡/门禁与 spec v13b §4/§5 一致；裁决引用=§0.1 v13b 口径（⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔+Z1''/Z4''/Z7''/Z11''/Z13''/Z18''/Z19''-v13b 重写）；偏离走 spec §0.4。
