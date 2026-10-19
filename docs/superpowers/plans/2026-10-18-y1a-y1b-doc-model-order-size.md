# Y1a+Y1b：doc 模型 v3·序与尺寸/只读 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

<!-- plan v8（2026-10-18）：三份 v7 外审高度收敛+三并行核验坐实+挖出三现存 bug 后四用户裁决落地（2026-10-18 八次确认）——v10 五大换代方向维持，本轮收敛为**单一代际/单一 epoch/单一事务**。**四裁决**：①**repair 换轨方案 A**（推翻 v10 裁决③——repairRev 三致命缺口实证〔客户端 URL 只 csv/cb 无自报 rev runtime:1572；doc-status dedup=${state}:${frozen}+客户端 msg.rev<=last return 吞 rev 变化；repair 不改 SV preVacuumSv 检测不到〕：repair=一次 generation 跳变的 doc rewrite——vacuumGate 互斥→beginVacuumEra 冻结+4410→quiesce〔writesSettled 覆盖服务端 outbox——DocDelivery/attach 维护门 503 退避〕→离线重排→**等价断言=忽略 order|slot 的节点/边/data 等价**→单事务 vacuumReplace〔state+preVacuumSv+generation+1〕→客户端零新协议〔preVacuumSv 内容级 fence+consumeGenerationJump 单链+IDB 四维键联动〕；**repairRev 删除**；ack 降 UX；**purgeForeignCaches 反语义 bug 同修**〔现状传会话旧键=保留脏代删其他代 local-cache-key:71〕）；②**全局单调 execSeq+三硬约束**（**DB sequence nextval 分配三处**〔new claim/同 jobId 重入/rearm〕禁 increment/max+1；DB BigInt wire/doc 用 string 守卫 BigInt 比较；进 exec 守卫/finalize CAS/唯一键+job data+onTick/reanchor+**reserve/reservedExecSeq+void_/settle CAS**+同 job 重入 claim 事务内 reservation 继承+旧 execSeq void/settle 一律失败；attempts=免费重试配额不混用——反例 A〔同 job stalled 重排 processor:40+重入不递增 attempts generation-intent:130/:158〕/B〔exec 守卫只比 attempts 不比 intentId document:313-331——**新 intent 的 loading/done 被旧 done 永久拦截=现存 bug**〕/C 三实证）；③**producer 分两层=一个 Media 写入服务+两个编排器**（**MediaRegistrationService=唯一 Media 写入点**：register/confirm 两形态共用 sniff/MIME/quota/probeState/natural 初始化+registerInTx/confirmInTx/bindInTx **禁止第二处 media.create/bindMedia**；ArtifactCommit=资金五路径〔text/image/video/edit/lighting〕finalize 事务内调 registerInTx+execSeq CAS+settleInTx+complete+DocDelivery；非资金六路径〔upload confirm/stitch/trim/separate/copy/export〕走 MediaRegistration **不碰 settle/complete/DocDelivery/exec**——四路径零 GenerationIntent 实证；非资金幂等锚 registrationKey=taskId+artifactIndex|mediaId|exportRequestId+Media @@unique(bucket,key)；非资金零 doc 写 attach consumer 交付；**不造 creditCost=0 intent**；两层只共享 Media/linkMedia 原语）；④**DocDelivery=typed flush+批量+复核**（withSession(write) 增 flush:true+**flushDocument(pid):'appended'|'noop'|'spooled'|'terminal'|'failed'**〔storeDocumentSerialized/saveMutex〕；只有 appended〔或 noop∧isPersistedComplete∧目标匹配〕才 delivered；**spooled≠delivered** 继续重试不耗 maxAttempts；按 project 批量一个 withSession 全 apply 后一次 flush；flush 后复核 target/execSeq/expectedValue→superseded/orphaned/delivered；lease 覆盖 flush+recheck+mark；delivered=PG 至少一次；**withSession 写后 debounce 未落库实证 residency:459-468——mark delivered 撒谎根修**）。 -->
<!-- v8 同批收编：**锁序契约 20**（finalize 先 lockBalance 再 CAS intent——credit-ledger:58 注释+reserve/settle/void/rollback 四处先 balance；先锁 intent=ABBA 死锁）+**InTx 方法族**（completeInTx/settleInTx/createXxxInTx——complete 根 prisma:255+settle 自开事务:132 根修）+finalize 幂等检查事务内 CAS 前+40P01 有界重试 3 次 jitter；**唯一键全带 execSeq+artifactIndex+targetItemId**（稳定 ImageItem.id——删除/重排按 id 现算实证 targetIndex 会漂移）；**对象 key=artifacts/{teamId}/{intentRowId}/{execSeq}/{index}-{sha256}**+If-None-Match+hash 校验+orphan sweep 前缀+龄阈值；**旧 reconcile 三后门删除**（backfillSucceeded:215 直接置 SUCCEEDED/threeCheck resultRef:244/settleStranded probeArtifacts→**不变量巡检**〔SUCCEEDED⇒stored∧Media∧settled——告警人工不自动退款〕）；**rearm 事务**（execSeq nextval+reservation 继承+旧 outbox superseded+**资金归一化**〔rearm 残留冻结 mayCall:false 静默跳过外呼=现存 bug team-credit:102+execution:325〕）；**worker 端点 op 白名单 exec-only**（fileId/resultUrl 在服务端白名单内 write.controller:32+manifest:83——收窄）；**MediaFactOutbox 替换 probedAt watermark**（事务乱序提交必漏实证；factVersion 单调/pending 行+SKIP LOCKED/probe·server-natural·attach 三写入点/来源 union(Media.projectId,binding)/重启零回放/emitter 单实例假设显式化=instances:1 多实例归 Y7）；**MIME 全链**（file-type 库+**API 代理流式 /api/media/:id/content 按 sniffedMimeType 设 Content-Type+attachment+CSP sandbox+生产 MinIO 直链禁用**+presign Content-Type 条件+SVG 拒+sharp 重编码剥载荷+Media.size BigInt〔Int 2.147GB 上限〕+**生产上传 /flowai 渗透修复**〔mediaUploadUtils:31 dev 假设——生产 MinIO 直连下无背书〕）；probe（**图片批 4 lease 180s/视频 batch 1 lease 5min**〔批 2×90s 覆盖不了下载+ffprobe〕/nextProbeAt jitter/claim 按 sniffedMimeType 路由〔伪报 audio 的图片不再永 skipped〕/索引 [probeState,nextProbeAt]/40MP+downscale 产品策略）；text 90 天（resultText 非空行延长）；exec error reconcile 活跃项目过滤+24h 窗；attach=只填空/replace=显式命令；观测+8 指标；**每卡真 PG 并发用例**（A3 不够早）；**交付 owner 唯一**（资金型=DocDelivery；binding 对 sourceIntent 非空跳过 fileId 写）。外审误判修正：生产 /flowai 同源直出不成立（MinIO 域名直连——上传侧渗透才是真问题）；reconcile 带状态+时间窗非全表；multiImage targetIndex 漂移不成立（UI 按 id 现算）。 -->
<!-- plan v9（2026-10-18）：三份 v8 外审攻击三接缝（finalize 状态机/三 poller 协调/A1-execSeq 交界）+四路并行核验（9 P0 坐实/8 P1/6 误判过滤）+四用户裁决（2026-10-18 九次确认）——v8 四裁决方向维持。**四裁决**：①**同 job 重入复用 execSeq**（推翻 v8「nextval 三处+继承/转移」——重入者 mayCall:false 静默 skipped 等旧 worker 交付〔team-credit:102 现状故意语义〕，旧 worker 真死归 reaper→rearm；**分配收敛两处 new claim/rearm**；rearm=nextval+**voidInTx 旧冻结**〔release+re-reserve——新 worker 重走 reserve 拿 mayCall:true〕+旧 outbox superseded）；②**video 即时 finalize**（provider 成功即 settle+complete+DocDelivery kind=videoUrl 交付 videoUrl **无 Media 行**；下载→MinIO→Media→fileId=**非资金续段**〔ai-download 迁 MediaRegistration+attach〕；不变量按 kind 分化——video 巡检豁免 Media 项/text 无 Media 跳过 registerInTx）；③**copy 清锚零新列**（copy/clone binding **清空 sourceIntentRowId/sourceExecSeq**+新 registrationKey；**attach claim 加 sourceIntentRowId IS NULL**——资金原件 binding 永不进队零 churn；**normalizeCopiedNodeData 五路径共用**——status loading/error→idle〔red：copyPlan:63 structuredClone 连 loading 复制=副本永久转圈〕/身份键 binding 成功才保留/exec 永不复制/cells 删）；④**资金 quota 软限**（finalize 不因 quota 回滚——钱已付 provider；超限告警+计数 artifact_quota_exceeded_total；registerInTx **禁调 assertOnConfirm**〔storage-quota:37-49 删对象+删行副作用〕+**禁外部 IO**——sniff/HEAD/hash 全事务外）。**9 P0**：EXEC_STATUS_KEYS/ExecStatusPatch+execSeq: string（manifest:90 现状无——不进键集 writeExecStatus 直接 UNKNOWN_KEY 代际围栏门口死；旧条目 docSchema v3 拒载）；同 job 复用；copy 清锚；**StoreOutcome 判别联合先行重构**（storeDocumentUnlocked boolean——noop/spool 成功/spool 失败/FK/fenced 五分支混一个 false〔persistence:235/:283/:287-395/:308-336〕；flushDocument 五态以 StoreOutcome 为载体禁旁路猜 hasFrames/persistUnhealthy；withSession(flush:true) 只 delivery/attach 两消费面）；**stripServerOwnedData web 单点无条件挂全构造点**（diff dataPatch〔canvasIntents:502 全键差异——快照窗口跨远端 apply 时服务端写的 fileId 被判"变化"经 WS 发回〕/addNode.data〔:462 全量〕/copyPlan/paste/undo 恢复；服务端 manifest 拒写降第二道——「未修改才不回送」废止）；text/video kind 分支；**唯一键补维度**（MediaBinding `@@unique([mediaId,projectId,nodeId,role,targetField,targetItemId])`/DocDelivery `+targetField,targetItemId`/**MediaFactOutbox `@@unique([mediaId,projectId,factVersion])`**/targetField 词表补 videoUrl/resultUrl——video 交付无处落）；**If-None-Match 废止**（MinIO 不支持条件写）→x-amz-meta-sha256 上传元数据+finalize HeadObject 校验；**pendingFacts**（fact 可先于 fileId——「忽略未知 mediaId」丢 natural 到重连）：客户端短 TTL Map（fileId 到达即消费）+delivery/attach mark 后 lazy GET 补拉。**8 P1**：重试码+**55P03**（lock_timeout）+P2024；MediaRegistration 第四形态 **prepareUploadInTx**+**11 处 media.create 映射表**（storage:37/media-process:194/ai-download:100/ai-image-edit:199+200/lighting:167/video-trim:110/stitch:97/generated-media:54/video-work:91——全部可映射四形态）；幂等前置判据=**FOR UPDATE 下 intent 行状态**（SUCCEEDED∧stored∧creditsConsumed=cost→幂等返回+补建缺行）非仅 Media 存在；attach/delivery **per-project 进程内互斥**（串行化 apply+flush+recheck+mark）；repair 等价断言含 **exec 根值等价**（vacuumEquivalent 现状只比键集合 registry:655-663）；attach lease 覆盖 flush（180s）+两 poller **onModuleDestroy**；**fail/touchHeartbeat/reanchorDeadline 补 execSeq 维度**（generation-intent:230/:248/:265 只守 status——旧 worker 可刷/杀新 attempt）。**误判过滤（勿复入）**：DocWriteCoordinator「正确性 P0」不成立（两 poller 写同 project 同 Y.Doc〔共享 residency 池〕+saveMutex per-doc+flush 排空全队列——纯成本降 P1 互斥）；零费 settle no-op 分支多余（不造 creditCost=0 intent）；P2002 事务内 catch 驱动多余（lockBalance 串行同 team 并发 finalize）；「grep 零第二处会红」=迁移终态门禁非现状断言；fillDoc 逐键写=A1/T15 已覆盖；outbox 单 projectId 漏 fanout=attach 补插行已设计（真缺口仅唯一键）。 -->
<!-- plan v10（2026-10-18）：第十轮三份 v9 外审生产级评审（机制通过/执行驳回×2）+三路并行事实核验+三份六点裁决报告终裁后**六项裁决+四分叉裁定+残余 P0 十三条**落地（推翻 v9 裁决②〔video videoUrl〕与 v8/v9 裁决①〔repair generation 跳变〕）。**六项裁决**：①**video 不交付 videoUrl**——`Media(status=processing)+fileId`：provider 成功即 settle+finalize（资金流与 v9 零 delta——只换交付载荷）；finalize 事务内建 Media 行（status=processing+**sourceUrl 专用列**〔禁入 metadata——media-batch 整行 spread 会泄漏〕+预分配 key+provider 声明 mimeType）+DocDelivery(kind=fileId 交付 mediaId)+settle/complete；**materialize 异步**（MaterializeJob：自有 processingLeaseUntil/processingAttempts 退避**与 intent attempts/rearm 彻底解耦**——存储抖动不污染资金/交付状态机；幂等键=mediaId；终态失败→**幂等补偿退款**+artifactState=failed+告警；materialize 不写 doc）；processing 期 content proxy 两态（ready=对象流+Range/HEAD/ETag；processing=allowlist 流式代理 sourceUrl+no-store+maxContentLength 上限+超限降级占位）；**targetField 词表删 videoUrl/resultUrl；DocDelivery kind 收敛 fileId|text**；统一不变量 `SUCCEEDED⇒settled∧DocDelivery(fileId)∧Media 行存在∧status∈{processing,completed}`（text 唯一例外）。②**repair=in-place 主路径**（preVacuumSv fence 挡不住未同步离线客户端实证 registry:689-697——generation 跳变常规化=数据复活风险常态化）：维护门（applyWriteFreeze **不 close 不 reload 不清 IDB 不跳 generation**+新连接只读+DocDelivery 维护门 503）→writesSettled→纯函数修复计划→**withSession(write, MAINTENANCE_TRANSACT_ORIGIN) 分块 ≤64KB**→回读校验（等价断言=忽略 order|slot+非 order/slot 键零变化）→解除 readOnly+RepairRun 审计；幂等可重跑；**帧预算预演**（scratch doc encodeStateAsUpdate——超 256KiB 或不可表达结构才退 vacuum）；**vacuum 兜底仅限「确定无离线客户端」运维窗**（无 generation 握手不得自动回退——握手归 Y2）。③**copy 方案二+**：**strip 只对更新不对新建**（更新路径剥禁写键——快照窗口回退 bug 面；**新建/copy/paste/explode 保留 fileId/images[].id——消灭空图窗口**）；normalizeCopiedNodeData 收窄（loading/error→有 fileId 则 done 无则 idle/清 errorCode/删 url/exec 不复制/cells 派生）；**binding 服务端惰性 reconcile**（mediaRefsOf 扫描+teamId 校验+幂等 upsert 清锚——零客户端调用零新端点）；跨 team paste=客户端 strip+读 ACL 403 兜底；**Media GC 加 doc 引用/grace 护栏**；**attach consumer 整建制取消**（两大存在理由消灭）——**交付 owner 收敛单一 DocDelivery poller**（非资金需写 doc 者并入 kind=fileId 无资金字段）+MediaBinding 降级纯索引。④**reconcile=R3 幂等 finalize 自动收敛**（推翻 v9「告警人工」）：finalizeFromExistingArtifact（CAS+补建缺行）+动作表+审计行+有界重试 3 次+pg_advisory_xact_lock+**歧义/资损风险绝不自动动钱**；**backfillSucceeded 禁写 SUCCEEDED+null**。⑤**guard/strip=检测/诊断/可修复（shadow 起步）；安全边界=读侧 ACL**：**assertMediaReadable 单门**（url/batch/content/facts/thumbs/snapshot 注入全覆盖——项目成员+Media.teamId===project.teamId；公开页按 workId 不按 mediaId）；**meta.schemaVersion 例外硬删+重连**（DoS 防护 shadow 也删——现状 writers 仅文档约定=viewer 可 brick 项目）；**键集单源两集合四处共用导出常量**（SERVER_WRITABLE_DATA_KEYS 含 content/CLIENT_FORBIDDEN_DATA_KEYS 不含 content——四处=manifest/strip/guard/census）。⑥**R2 登记 Y2 立项候选本批零代码**（Artifact 表/mediaRef/多实例+触发条件）；**双 bump 保留**（生产 epoch 14 在线旧 bundle 混跑窗真实）；fileId 命名保留。**四分叉裁定**：video settle=provider 成功即 settle（否 ingest 后 finalize——故障域隔离为决定性理由）；双 bump=保留；copy binding=服务端惰性 reconcile；**StoreOutcome 窄接口先行**（推翻 v9 P0「判别联合先行重构」——flushDocument 以 ephemeral flush+isPersistedComplete 三态 `persisted|not-persisted|terminal` 承载+spoolDeadline 1h；五态降后续硬化卡）。**残余 P0 十三条**：rearm **只 voidInTx 释放**（v9「release+re-reserve」自相矛盾——team-credit:105 reservedCredits>0→mayCall:false）；execSeq **进程内贯穿**（job data 不带——controller:68 enqueue 无 claim）+**同 job 重入三态**（心跳新鲜 skip/过期接管/未知可重试——禁「skipped 后成功 ack」）；**providerTaskId submit 后落库**（schema:1014 列在但全仓零写库点）+query-first+Idempotency-Key+**ArtifactCommit/MediaRegistration=shared artifact-core module 双 role DI 测试**（生产 API manualRegistration:true 不消费队列 app.module:71）；读 ACL 单门+**storage.presign 补 projectId**（create data 无 projectId）；**非 additive DDL=rebuild cutover runbook**+**BigInt toJSON 四读路径**（storage-quota agg/storage.service:85 Math.abs/media-batch spread/material spread）+**CI 加 S3 兼容服务**；**targetItemId 非空 sentinel ''**（PG NULL 不去重——单图绑定幂等键失效）；meta 硬保护+键集单源；**confirmInTx+pending CAS**（storage:69-99 无事务无守卫）；**用户 replace vs delivery expectedValue CAS**（applyWriteNodeDataToDoc 无条件 set document:286）；**DOC_NODE_KEYS 契约表+compareExecSeq 单源**（lint 禁裸比较+非法 string drop）；**outbox at-least-once**（「重启零回放」断言废止——改测重复投递幂等）；**SSRF SafeRemoteFetch**（ai-download:62 无 host 校验/重定向/大小上限）；**file-type pin 16.x 或自研 sniff**（≥17 纯 ESM vs tsconfig commonjs）。**附加**：quota claim 前预检；media.create 门禁 **grep census（9 处非 11——ai-image-edit:199+200 同一调用续行）**；C0b 出口**提前 soak 一轮**；**开工前三实证**（生产 nginx -T 核 /flowai〔web 24 处/15 文件改写面〕/check-migration-additive 实判/CI S3 到位）。 -->
<!-- plan v10.1（2026-10-18）：第十一轮三份 v13/v10 第二轮复审+四断言亲验坐实后**边界收口十一条**落地（v13 六裁决方向全部维持——三报告重提项 video 交付时机/dual bump/DocDelivery 泛化/vendor 四曲线/orderEpoch 全部维持原裁决）。**十一条**：①**非资金 DocDelivery lane 删除**（亲验零服务端 doc 写——stitch/trim/separate 只走 emit 族 emit.port:62-86，结果由客户端写 trimmedFileId；**DocDelivery funding-only，intentRowId/execSeq 非空禁 execSeq=0 伪造**；确需时建独立 DocCommand 表）；②**ArtifactState 四态 {none materializing stored failed}**：image/edit/lighting=stage 后 stored；video=finalize 时 materializing→materialize 成功 stored/终态失败 failed；text=stored；**finalize 幂等判据改 SUCCEEDED∧artifactState∈{materializing,stored}∧creditsConsumed=cost**；统一不变量加 failed 合法终态（status=failed⇒幂等补偿退款+artifactState=failed；delivered 只表示引用已写不表示字节存在）；R3 对 materializing=重试 materialize 非补 finalize；③**stage durable 化（Media(processing)=统一 stage 句柄）**：stageInTx 短事务先落行（objectKey/sha/size/sniff+sourceIntentRowId/sourceExecSeq/artifactIndex，ON CONFLICT DO NOTHING 幂等）+同事务插 processing fact→对象上传→finalize 只做状态提升——**消灭「对象在 DB 无记录」孤儿**（orphan sweep 以 stage 行为准+覆盖旧 execSeq 前缀）；video finalize 建行不 stage 字节；④**同 job 重入 skip→moveToDelayed**（`job.moveToDelayed(now+lease 余量+grace, token)`+抛 DelayedError **不 return 不 ack**——BullMQ return=completed 即悬挂）+**providerRequestId（UUID）submit 前落库**（Idempotency-Key，消灭 submit→DB 崩溃窗）+query-first 键序 requestId→providerTaskId→重呼（同步 provider 显式标注不可 query-first）；⑤**strip 键集精确枚举+socket 降级**：CLIENT_FORBIDDEN={fileId,resultUrl,videoUrl,result,natural,errorCode,fileIdRev}——**不含 referenceImage/images/allImages/trimmedFileId/videoFileId/audioFileId**（上传路径全在更新路径上，键名一刀切=剥掉上传）；**socket setFileResult 降级本地 UI 不写 doc**（emitNodeStatus video 不传 fileId——现状 :298 传 resultRef=URL→404）；guard generated/uploaded 类型分流；⑥**content 出服务端白名单**（亲验 :485 content=用户 prompt 回显）——text 交付删回显只写 result，两键集真正正交；⑦**meta.schemaVersion 修复=恢复 current 非删除**（亲验 docShape:87-91 sv==null∧有节点→assertDocSchema→throw——删除只是换一种 brick）；⑧**fileIdRev token 来源钉死**：server-owned 单调计数进禁写集；claim 装载 doc 捕获→finalize 写 DocDelivery.expectedValue→apply 比较 currentRev≠expectedRev→superseded；replaceMedia 递增；⑨**repair RW 写屏障+单块预算+advisory lock**：writesSettled 是持久化谓词拦不住在飞 withSession——per-project RW 锁（writer refcount/maintenance 排他+MAINTENANCE origin 自 bypass）；fallback 只留给不可表达结构（**「总量 256KiB 退 vacuum」废止**——分块下不可达且自相矛盾，总量大就多块）；pg_advisory_xact_lock 跨进程保险；⑩**multiImage 本批一 intent 一 artifact**：targetItemId=''+artifactIndex=0+删「多产物 N Media」描述（execution:539 单 result.url 实证）；slotId 归 Y2；**copy 重新分配 placement/order**（副本同层同 order 重复键——allocator 唯一入口）；⑪**consistency pass**：D5/⑨/⑪/⑬/⑭/Z1'' 残句/Z13''/T24/G53 全部对齐现行口径。**P1 收编**：MediaBinding 删 attach 死列（纯索引 9 列）+「清锚」措辞废止（锚在 Media）；processing fact 同事务推送；media-facts GET→POST≤200；MaterializeJob 复用同一次下载算 natural/hash/mime（免 probe 二次下载 1GB——probe 仅上传路径）；quota estimatedSize 预检；DocDelivery dead 重驱（on-load reconcile/admin retry）；R3 FAILED∧reserved>0 void 加「无 artifact/无 delivered」守卫；finalizeFromExistingArtifact→**finalizeFromExistingMediaOrText 改名**；assertMediaReadable projectId=null 退化 team member；flush 窄接口带 reason `{persisted}|{retry,spooled|failed}|{terminal,fenced|fk}`+显式 storeDocumentSerialized（替代 ephemeral-disconnect）+spooled 无限重试不假失败（PG 停机>1h 判死磁盘安全帧）；providerTaskId adapter 透传链（execution call 封装加字段）；Media.status 直接 enum；**T6 拆四卡（6a execSeq/claim/rearm/重入 lease；6b ArtifactCommit stageInTx/finalize；6c DocDelivery/fileIdRev/flush；6d Materialize/R3）+T5 拆三卡（5a outbox/REST/processing fact；5b MIME/proxy/读 ACL/SafeRemoteFetch/BigInt；5c /flowai 迁移）**。 -->
<!-- plan v11（2026-10-19）：第十二轮（第十五轮外审）——**三份批评版外审+一份修正版架构评审综合裁定后用户确认，修正版采纳为本版骨架**（spec v14 同批落盘——修订链 v14+§0.2 ㉕-㉜+§1.12 核验行+Z4/Z7/Z9/Z11/Z13/Z18 v14 改）。**诊断定论**：v10.1 根子问题=服务端产物事实写进客户端可写 CRDT+一个产物拆五套状态机，再用 DocDelivery/fileIdRev/strip/guard 补偿。**v11 四换骨架**：①**PG `NodeArtifact` 唯一产物权威+rev CAS**（推翻 v10.1-⑧ fileIdRev——exec rev 仍是 Y.Map，三洞成立：自重试误判 superseded/并发 replace 丢更新/text 无 rev；finalize/replaceMedia/clearMedia 全走 `WHERE rev=expectedRev`，claim 从 PG 捕获非 doc；0 行→superseded+资金独立判——intent CAS 成功照常 settle 产物入素材库，失败 void；内容等值只做投影 fast path；**权威=(sourceIntentRowId,execSeq,rev)**；**GenerationIntent.artifactState 列删**——防双权威回潮）；②**ArtifactProjection 投影交付**（DocDelivery 改造：`@@unique([artifactId,artifactRev])`+六终态 pending/projecting/projected/orphaned/superseded/dead——节点删 orphaned/replace+新代 superseded/耗尽 dead/成功 projected；投影循环=claim→读 NodeArtifact rev→apply doc→typed flush→recheck rev→projected；**poller 必须 CollabLease fencing**）；③**在线 repair 整建制删除**（推翻 v13 裁决②——读序 (order,id)/(slot,id) 双 tie-break 已容忍重复键，repair 是质量优化非正确性需求；维护门/RW 屏障/分块/CollabMaintenance/RepairRun 全删，只留病理计数+soft/hard 告警+CLI renumber-layer；compaction 维持现有 vacuum 不建 handshake）；④**版本硬切**（csv/docSchema 两常量照 bump=3——fail-closed 标记非兼容层；**doc schema 移 CanvasDoc.schemaVersion PG 列，meta.schemaVersion 删除**——推翻 v10.1-⑦；rebuild cutover runbook 删除，reset 全表替代）。**架构定案**：data 只留 fileId/result+用户内容+上传引用——`CLIENT_FORBIDDEN_ON_UPDATE={fileId,result}` 只挂更新路径，**新建/copy 保留 fileId**，**四客户端写路径迁移 replaceMedia/clearMedia 命令**（变换保存 ImageGenNode:394/AI 编辑回填 :885/socket done nodeStore:701 降本地 UI/清空 :737——亲验，v10.1 strip 无迁移卡会直接打断四面=真 P0 缺陷）；**MediaBinding 保留=doc 引用索引，current-state upsert**（键 [projectId,nodeId,role,targetField,targetItemId]——create-only 废止）；**video 异步+image/edit/lighting 同步 ingest 并存**（统一权威非时机；stage durable 全 kind 落 sourceUrl——image 系崩溃后 R3 可重下非只能退款）；**exec 降 cache**（资金/执行/交付判定全读 PG）；**ACL 团队级单门**（assertTeamMember——推翻「项目成员+跨项目 403」口径：团队回退实证下永不可绿；删 /url+/batch 读 presign 旁路；ready=X-Accel-Redirect 内部 location）；**上游媒体解析（v11 新增最高优先 P0）**：paramsHash 哈希上游 mediaId 非 URL+claim 读 NodeArtifact 非 doc（投影滞后漂哈希=重复扣费面）+外呼 URL=sourceUrl 新鲜直传→过期降级公网 presigned GET+sourceUrl 加密 omit 脱敏；**execSeq 三补强**：ExecutionTicket 进 edit/lighting job data+onTick {status,execSeq} 不匹配 abort+同 job 过期接管也 voidInTx；**pending upload TTL（pendingExpiresAt 24h+清理）+presign clientUploadId 幂等键**；pendingFacts 消费保留；StoreOutcome 窄接口维持。**维持**：R2 留 Y2（useNodeArtifact 直读=seam）、不拆 Blob 三层、非资金零 doc 写、锁序 20/InTx/outbox/probe/MIME/SSRF、moveToDelayed、rearm 只 voidInTx、providerRequestId write-ahead+query-first、quota 软限。**v10.1→v11 卡号映射**：T0 pin→T0；T1+T2 机械→T1；T3 schema→T2；T5a→T4/T5 一部分；T5b→T5/T6；T5c→T6；T6a→T9；T6b→T10；T6c→T14/T15；T6d→T12/T13；T7→T7；T8→T10/T16；T9→T17/T11；T10→T16；T4→T18（只读门）；T11-T18 A1→T17；T19-T21 A2→T18（CLI 化）；T22→T19；T23-T27 B1-B2→T17/T18；T28→T18/T19。**执行纪律核心**：plan 中每个被调用的 API/类型/DI 令牌/进程形态，写码前 grep 实证。行号=2026-10-18/19 快照。**每卡先红须含真 PG 并发用例（锁序/双 claim/崩溃窗）——mock 测不出代际/锁序问题。** -->
<!-- plan v11.1（2026-10-19）：第十三轮（第十六轮外审——v11 复审：确认骨架+契约收紧，零推翻）八条小改落地（骨架不动）。**核验坐实两条前提**：①「并发生成胜者规则」场景**结构性不存在**——claim ⓪ RUNNING 闸（Z94——同 nodeId RUNNING 行非本 job 重入→NodeBusy 不建新行，generation-intent:66-76）+RUNNING partial unique+finalize 原子（intent CAS 与 NodeArtifact CAS 同事务）⇒ 后发起者 claim 必见新 rev=「最新意图优先」的结构性表述——**不采纳 activeIntentId 列**（与 RUNNING 闸职责重复，违反「不引入重复机制」），改落**胜者规则不变量显式化+红测**（T10）；②CollabLease.epoch 列已存在（schema:858）——缺的是提交点校验，**flush 前校验 epoch 未变**（T14——复用零新机制）。**八条**：①flush lease epoch 校验（T14/T15）；②ArtifactProjection.state→enum+targetField/role 域约束+状态迁移前置（T2）；③provider 能力矩阵第三档=无幂等且不可查询→禁自动重投+人工裁决（T9）；④**成员移除→存量 WS 连接关闭/降权**（T5——本轮唯一新功能缺口）；⑤reset 脚本安全=环境白名单+目标库校验+默认 dry-run+路径限定+禁连生产（T18）；⑥验收矩阵补成员移除/reset 安全/50 客户端梯度+24h soak（**目标项非阻断门**——10 客户端维持阻断，2C 单机现实；T19）；⑦file-type 封装独立 sniff 模块+升级期限登记（T6——sharp 重编码=执行边界，sniff=第一道门）；⑧胜者规则不变量（T10 红测+spec v14.1 条目）。**外审重述项零动作**（P0-2 at-least-once 投影/P0-4 三态分离/P0-6 团队模型/4.x 职责分域——v11 已有）；**不采纳**：activeIntentId 列、多实例协作测试进本批（维持 Y7+单实例断言）。 -->

**Goal:** 落地 doc 模型 v3——placement 复合单键序域（order|slot 判别+单一有界 order+`(order,id)`/`(slot,id)` 读序）+**PG NodeArtifact 生成产物权威**（rev CAS/终态 superseded）+ArtifactProjection 投影交付（六终态+typed flush+CollabLease fencing）+execSeq 单一代际（ticket/onTick fence/takeover void）+资金/非资金两编排器+fileId/result 两身份（更新禁写+新建保留+replaceMedia/clearMedia 命令）+上游媒体稳定身份解析+只读双层+版本硬切；批出口=verify 全绿+门禁全过+资金矩阵含代际/锁序/投影崩溃窗/materialize/reconcile 收敛。

**Architecture:** doc=nodes/edges+exec+meta（四根不动；**schema 版本移 CanvasDoc.schemaVersion 列**）；**NodeArtifact=生成产物权威**（rev/state/mediaId/resultText——finalize CAS/replace 命令同 CAS）；**ArtifactProjection=投影 outbox**（DocDelivery 改造——六终态+lease+flush+recheck）；**MediaBinding=doc 引用索引**（current-state upsert——覆盖 copy/paste/upload 客户端直写面）；**Media=字节/facts 权威**（stage durable 含 sourceUrl+materialize/probe/factVersion）；**execSeq=全局单调执行代际**（claim 返回值进程内贯穿+edit/lighting ExecutionTicket+onTick fence）；资金=ArtifactCommitService（**stageInTx durable+finalize 短事务 NodeArtifact CAS**，lockBalance→intent CAS→registerInTx→settleInTx）；非资金=MediaRegistrationService（唯一 media.create 点）——**两者=shared artifact-core module 双 role（API+worker）**；交付=**ArtifactProjection poller（lease-aware+内容等值 fast path）**；binding=current-state reconcile；facts=MediaFactOutbox（at-least-once）；repair=**CLI only**（病理计数+renumber-layer）；排序单实现（slot 派生）；版本门=**硬切**（双常量=3）；guard=检测/诊断（安全边界=读侧团队级 ACL）。

**Tech Stack:** TypeScript strict / Yjs exact 13.6.32 / Hocuspocus 4.6.0 / NestJS / sharp exact 0.34.5（40MP+并发 1）/ ffprobe 8.1.2（CI/部署 pin）/ fast-deep-equal / **file-type 16.x exact（≥17 纯 ESM 禁用——tsconfig commonjs）或自研 magic sniff** / vitest / node:test。

**执行纪律：** 每卡先红（真实变红+**真 PG 并发用例**）→绿→commit；写码前 grep 实证；三面 tsc；文档 diff；每片出口用户确认。

## 文件结构（触碰面全景·v11）

| 文件 | 动作 | 责任 | 片 |
|---|---|---|---|
| 根+apps package.json / ci.yml | 改 | T0 pin（yjs/sharp/fast-deep-equal/file-type 16.x+ffprobe CI/部署+**CI S3 兼容服务**） | S0 |
| docShape.ts+全仓 ~141 处 | 改 | T1 改名 StoredNodeRecord+**删 meta.schemaVersion 读（移 CanvasDoc.schemaVersion 列）** | S0 |
| scripts/check-plan-census.mjs | **建** | census（media.create grep census/键集四处一致/**CLIENT_FORBIDDEN_ON_UPDATE 两键**/NodeArtifact 写点枚举） | S0 |
| collab-doc-ops.ts | **建** | 写原语+类型同迁 | S0 |
| apps/api/prisma/schema.prisma + migration | 改 | T2 全量（**NodeArtifact/ArtifactProjection**+exec_seq sequence+MediaBinding current-state 键+Media 补列〔**sourceUrl 加密/pendingExpiresAt/clientUploadId/materialize 族/probe 族/factVersion**〕+**CanvasDoc.schemaVersion**+**删 GenerationIntent.artifactState**） | S0 |
| packages/shared/src/canvas/canvas-doc-manifest.ts | 改 | EXEC_STATUS_KEYS/ExecStatusPatch+execSeq: string+**SERVER_WRITABLE={fileId,result}**+compareExecSeq 单源 | S0 |
| storage.service.ts | 改 | prepareUploadInTx（**补 projectId+clientUploadId 幂等+pendingExpiresAt TTL**）+confirmInTx pending CAS+MIME 嗅探 | S1 |
| media.service.ts + media-batch + media-content.controller.ts | 改/建 | **删读侧 presign 旁路**+GET /content 两态（ready=X-Accel/Range；processing=SafeRemoteFetch 代理）+**assertMediaReadable 团队级单门** | S1 |
| shared SafeRemoteFetch（collab 或 media 域） | **建** | https+host allowlist+私网 IP 拒+maxRedirects:0+流式限长（ai-download/ai-image-edit/lighting/media-process 四处共用） | S1 |
| media-probe/media-probe.poller.ts | **建** | probe 单相（分型批/lease+sniffed 路由） | S1 |
| web mediaUploadUtils/mediaApi+/flowai 24 处/15 文件 | 改 | mediaContentUrl(fileId) 单点+census（nginx -T 实证先行） | S1 |
| execution/topology.service.ts + normalize-intent-params.ts + execution.service.ts | 改 | **上游解析：claim 读 NodeArtifact+paramsHash 哈希 mediaId+URL 解析 sourceUrl→presign 兜底** | S2 |
| generation-intent.service.ts + team-credit.service.ts + execution.processor | 改 | T9 execSeq 链路+ExecutionTicket（edit/lighting job data）+onTick fence+takeover void+rearm 只释放+providerTaskId 落库 | S2 |
| **shared artifact-core module**（artifact-commit.service.ts + media-registration.service.ts + node-artifact.service.ts） | **建** | 资金 finalize（stageInTx durable+finalize 短事务 **NodeArtifact rev CAS**+settleInTx）+唯一 Media 写入点+**NodeArtifact CAS 原语（finalize/replace/clear 共用）** | S2 |
| media-delivery/projection-outbox.poller.ts | **建** | **ArtifactProjection poller**（CollabLease fencing+内容等值 fast path+rev recheck+六终态+dead 重驱） | S4 |
| media-delivery/binding-reconcile.service.ts | **建** | binding **current-state reconcile**（mediaRefsOf 扫描+upsert+删 stale） | S4 |
| collab/collab-media.controller.ts | **建** | **replaceMedia/clearMedia 显式命令端点**（expectedRev CAS+409） | S2 |
| collab/collab-persistence.service.ts + collab-residency.service.ts | 改 | **flushDocument 带理由窄接口**（显式 storeDocumentSerialized） | S4 |
| collab/collab-pathology.ts | **建** | soft/hard/重复键计数+CLI 入口 | S5 |
| scripts/collab-renumber-layer.mjs | **建** | CLI（离线/维护窗 renumber——幂等，不承诺永久无重复） | S5 |
| worker MaterializeJob（ai-download 迁移改造） | 改 | video materialize（幂等键=mediaId+自有 lease+终态失败补偿退款） | S3 |
| execution/ + intent-reconcile | 改 | T13 R3 reconcile（finalizeFromExistingMediaOrText+动作表+三后门删除） | S3 |
| shared/canvas/placement.ts / order-key.ts / order-records.ts | **建** | placement 判别/单一有界 order+**(order,id)/(slot,id) 读序**/deriveStoryboardCells/DOC_NODE_KEYS | S5 |
| web canvas-allocator.ts + ImageGenNode/nodeStore/canvasIntents/copyPlan | 改 | allocator+**四写路径迁移 replaceMedia/clearMedia**+strip 更新路径 {fileId,result}+copy 保留 fileId+placement 重分配 | S2/S5 |
| web canvasCollabRuntime + nodeStore | 改 | **pendingFacts**+重连全量拉+factVersion+**exec 只读 cache（判定走 PG/artifact store）** | S4 |
| scripts/dev-reset-canvas.mjs | **建** | **全表清**（CanvasDoc/CanvasDocUpdate/NodeArtifact/ArtifactProjection/MediaBinding/MediaFactOutbox/Media 全量+GenerationIntent/TeamCreditTransaction/LightingTask/BullMQ/Redis/MinIO/IDB）+版本硬切演练 | S5 |
| collab/collab-harness/ | **建** | 双端真连+execSeq/投影 rev/flush/materialize/R3 故障注入 | S5 |

**不动红线**：NODE_ENVELOPE_KEYS；exec 域写面；ecosystem 双进程；doc-status generation 跳变消费链；DOC_TOP_LEVEL_MAPS 四根；Y1c-1 世代段。

---

## 片 S0：契约与 schema（T0-T3——零行为变更）

### Task 0: exact pin+ffprobe CI/部署 pin（v10.1 T0 维持）
**Files:** 两 package.json（yjs/sharp exact+fast-deep-equal+file-type 16.x）+overrides+ci.yml（ffprobe 安装 pin+**CI S3 兼容服务**）
- [ ] 先红（pin+CI ffprobe 步+CI S3 服务真跑）→实现+Commit。

### Task 1: 机械前置（v10.1 T1+T2 合并：DocNodeRecord→StoredNodeRecord+collab-doc-ops 抽离）
**Files:** docShape.ts+全仓 ~141 处+collab-doc-ops.ts 新建
- [ ] census→改名→原语+类型同迁+环检测零命中→三面 tsc+全量绿→Commit。

### Task 2: Prisma 全量迁移（v11 表结构）

**Files:** schema.prisma+migration（`nodeartifact_projection_v3`）

- [ ] **Step 1: schema**

```prisma
// DB sequence（migration SQL: CREATE SEQUENCE "exec_seq" AS BIGINT）
enum ArtifactState { none materializing stored failed }
enum MediaStatus { pending processing completed failed }

model NodeArtifact {                       // v11 新建——生成产物唯一权威
  id String @id @default(cuid())
  projectId / nodeId / teamId String
  role String @default("primary")           // v11.1：域约束（白名单）
  targetField String                        // fileId | result（videoUrl/resultUrl 历史键删）——v11.1：域约束
  targetItemId String @default("")          // 非空 sentinel；本批一 intent 一 artifact 默认 ''
  mediaId String?
  resultText String? @db.Text
  source String @default("generated")       // generated | replace
  sourceIntentRowId String?                 // 资金锚（=GenerationIntent.id）
  sourceExecSeq BigInt?
  artifactIndex Int @default(0)
  state ArtifactState @default(none)
  rev Int @default(0)                       // PG 权威版本——finalize/replace/clear CAS 锚
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([projectId, nodeId, role, targetField, targetItemId])   // 槽位唯一
  @@unique([sourceIntentRowId, sourceExecSeq, artifactIndex])      // 资金 finalize 幂等
  @@index([mediaId])
  @@index([teamId, state])
}

enum ProjectionState { pending projecting projected orphaned superseded dead }

model ArtifactProjection {                  // v11——DocDelivery 改造为投影 outbox
  id String @id @default(cuid())
  artifactId String
  artifactRev Int                           // 投影时快照——recheck 比对 NodeArtifact.rev
  projectId / nodeId String
  targetField String                        // v11.1：域约束（CHECK/应用层白名单——fileId|result）
  targetItemId String @default("")
  mediaId String?
  resultText String?
  state ProjectionState @default(pending)   // v11.1：PG enum（禁应用层未定义值）+状态迁移前置约束（projected 仅来自 projecting；orphaned/superseded/dead 终态不可回退）
  attempts Int @default(0)
  leaseUntil DateTime?
  runId String?
  nextAttemptAt DateTime @default(now())
  lastError String? @db.VarChar(512)
  createdAt DateTime @default(now())
  projectedAt DateTime?
  @@unique([artifactId, artifactRev])
  @@index([state, nextAttemptAt])
  @@index([artifactId])
}

model MediaBinding {                        // v11——doc 引用索引（current-state）
  id String @id @default(cuid())
  mediaId / projectId / nodeId / teamId String
  role String @default("primary")
  targetField String @default("fileId")     // fileId|referenceImage|images|allImages|trimmedFileId|videoFileId|audioFileId
  targetItemId String @default("")
  createdAt DateTime @default(now())
  media Media @relation(fields: [mediaId], references: [id], onDelete: Cascade)
  @@unique([projectId, nodeId, role, targetField, targetItemId])  // v11：槽位唯一（current-state upsert——同槽位换 media 即改行；v10.1 [mediaId,...] create-only 废止）
  @@index([mediaId])
  @@index([projectId, nodeId])
}
```

```prisma
// GenerationIntent 增列（v11——artifactState 列删除：产物权威移 NodeArtifact，双权威防线）
execSeq BigInt @unique
reservedExecSeq BigInt?
execProjectedExecSeq BigInt?
resultText String? @db.Text
providerRequestId String?                   // submit 前落库（write-ahead Idempotency-Key）
providerTaskId String?                      // submit 后落库（query-first 锚）
@@index([status, execProjectedExecSeq])
@@index([providerTaskId])
```

```prisma
// Media 沿 v10.1 列族（sourceUrl 加密/sourceUrlExpiresAt/materialize 族/probe 族/factVersion/natural/sniffed）+
pendingExpiresAt DateTime?                  // v11：pending 行 TTL（24h 定时清理行+对象）
clientUploadId String?                      // v11：presign 幂等键（网络重试不建新行/新 key）
@@unique([teamId, clientUploadId])
@@unique([bucket, key])
@@unique([sourceRegistrationKey])           // 非资金幂等（nullable）
@@index([status, nextMaterializeAt])
@@index([probeState, nextProbeAt])
@@index([status, pendingExpiresAt])
// 资金唯一键 [sourceIntentRowId,sourceExecSeq,artifactIndex] 移 NodeArtifact；sourceIntentRowId/sourceExecSeq 保留为 origin/审计
// CanvasDoc 增：schemaVersion Int   —— doc schema 移 PG 列（meta.schemaVersion 删除）
```

- [ ] **Step 2: migration+fresh replay 必验**（无存量数据——不做 rebuild cutover）。
- [ ] **Step 3: Commit**。

### Task 3: 键集单源+manifest+compareExecSeq
**Files:** canvas-doc-manifest.ts+media-fact.ts（compareExecSeq）
- [ ] `SERVER_WRITABLE_DATA_KEYS={fileId,result}`（仅 deliverArtifact/replaceMedia/clearMedia 三 op 可写）+`CLIENT_FORBIDDEN_ON_UPDATE={fileId,result}`（同集——v3 doc 无 resultUrl/videoUrl/natural/errorCode/fileIdRev 历史键）+EXEC_STATUS_KEYS 加 execSeq: string+compareExecSeq 单源（property test：2^53 边界/前后导零/非法 drop）+census 四处一致→先红（manifest 前置）→绿+Commit。

**片 S0 出口**：三面 tsc 绿+全量绿+census+pin 绿+fresh replay 绿。

---

## 片 S1：Media/ACL/content（T4-T7）

> **五面纪律**：每卡自检生产/交付/消费/生命周期/崩溃端；**每卡至少一个真 PG 并发用例**。

### Task 4: upload/confirm/MIME/pending TTL/幂等键
**Files:** storage.service.ts+media-registration.service.ts（prepareUploadInTx/confirmInTx/bindInTx）
- [ ] 先红：**presign clientUploadId 幂等**（网络重试同 uploadId 恰一行——red：现状重复行/重复 key）；**pendingExpiresAt TTL**（24h 定时清理 pending 行+对象——red：现状永不过期不占配额可占满 MinIO）；confirm 嗅探（file-type 16.x 或自研 magic sniff）白名单拒+删对象+按 sniffed 重算 probeState；**confirmInTx 带 status='pending' CAS**（red：storage:69-99 无守卫——并发双 confirm 恰一 completed）；presign Content-Type 条件（进 presign.fields 否则全 403）；**prepareUploadInTx 落 projectId**（red：storage:38-50 现状缺失）；quota estimatedSize 预检→绿+Commit。

### Task 5: 读 ACL 团队级单门+删旁路+content 两态+X-Accel
**Files:** media.service.ts+media-batch.service.ts+media-content.controller.ts
- [ ] 先红：**assertMediaReadable=assertTeamMember(Media.teamId) 单门**（**同 team 跨项目 200——red：v10.1「跨项目 403」红测在团队回退语义下永不可绿**/跨 team 403/公开页按已发布 workId 200/被移出团队后 content 403）；**删读侧 presign 旁路**（`GET /media/:id/url`+`POST /media/batch` presign 返回——404/降级 content 路由——red：现状绕过 MIME/单门）；**content 两态**：ready=X-Accel-Redirect 内部 location（nginx 配置+`/internal-media/` 路径——**不 302 公网 presign**；Range/HEAD/ETag/304/206/416+nosniff+非白名单 attachment——视频可拖动 red：mediabunny UrlSource 顺序退化）；processing=SafeRemoteFetch allowlist 流式代理 sourceUrl+no-store+maxContentLength 上限+超限 410/425+Retry-After；**写 ACL 独立**（presign(projectId) 要 project editor——red：viewer presign 403）；**v11.1：成员被移除→存量 WS 连接关闭/降权**（teamMember 删除钩子→gateway 对该用户现存 collab 连接 close 或降 readOnly——red：移除后旧连接仍可写 doc=越权面）→绿+Commit（**CI 真 S3**）。

### Task 6: SafeRemoteFetch+SSRF+BigInt+/flowai 迁移
**Files:** SafeRemoteFetch 新建+ai-download/ai-image-edit/lighting/media-process 四处替换+mediaUploadUtils/mediaApi+/flowai 24 处/15 文件+BigInt
- [ ] **开工前置：生产 `nginx -T` 核 /flowai location 存在性+X-Accel 内部 location 可配**。先红：SSRF 拒（私网 IP/重定向/超限断——red：ai-download:62 现状无 host 校验）；mediaContentUrl(fileId) 单点+census 零改写正则（red：24 处现状）；BigInt 四读路径可 JSON.stringify（storage-quota agg/Math.abs/spread×2——red：TypeError 复现）；**v11.1：file-type 封装为独立 sniff 模块**（单一 import 点+登记升级期限——勿永久固化；sharp 重编码=执行边界，sniff=第一道门）→绿+Commit。

### Task 7: probe 单相（v10.1 T7 维持）
**Files:** media-probe.poller.ts（worker）+九处 create 面+sweep+media-process
- [ ] 先红（分型批/lease+sniffed 路由+server natural done+outbox+sharp 40MP+ffprobe 沙箱〔spawn 数组+timeout+protocol_whitelist——trim/separate/thumbnail 同改〕+**probe 仅上传路径——materialize 复用下载**）→绿+Commit。

---

## 片 S2：同步 ingest 资金+命令族（T8-T11）

### Task 8: 上游媒体解析+paramsHash 稳定身份（**v11 最高优先——全案唯一重复扣费缺口**）

**Files:** topology.service.ts（collectUpstreamData 改 NodeArtifact 读源）+normalize-intent-params.ts（WHITELIST 身份字段化）+execution.service.ts（callArgs 构造处 URL 解析）+media-fact.ts（resolveUpstreamMediaUrl）

- [ ] **Step 1: grep 实证钉死键形态**（startImageUrl/endImageUrl/imageUrls 当前存 URL 还是 fileId——web 写入点同步盘点）。
- [ ] **Step 2: 先红**：**上游注入读 NodeArtifact（PG）非 doc**（red：拓扑投影滞后——doc 尚无 fileId 时 claim 取空/漂移→paramsHash 变；PG 行在 finalize 即建）；**paramsHash 哈希稳定身份**（video/image 白名单 imageUrl→imageMediaId 等 fileId 形态——red：presign 续签/URL 重解析后重试同键〔现状 resultUrl 哈希=URL 变即新 intent 重复扣费复现〕）；**URL 解析顺序**：Media.sourceUrl 未过期直传（provider 取自家 URL）→过期降级公网 presigned GET（nginx /flowai 域名）——red：sourceUrl 过期重试仍可达 provider；**sourceUrl 零泄漏**（Prisma omit 全局排除+DTO 测试+日志/Sentry 脱敏——red：media-batch spread 现状）；topology:71 resultUrl 消费面删除（grep 零 resultUrl 读取）→绿+Commit（真 PG+上游链真连用例：imageGen→imageGen 取到图+重试 paramsHash 不变+kill 后 query-first 不重复扣费）。

### Task 9: execSeq/claim/ticket/rearm/takeover/onTick（v10.1 T6a+三补强）

**Files:** generation-intent.service.ts（execSeq nextval 两处+providerRequestId submit 前落库+providerTaskId submit 后落库+rearm 事务〔nextval+voidInTx 只释放+旧 ArtifactProjection superseded〕+completeInTx+fail/touchHeartbeat/reanchorDeadline 补 execSeq）+team-credit.service.ts（settleInTx/voidInTx+reserve 写 reservedExecSeq+CAS）+execution.service.ts（同 job 重入三态 moveToDelayed+**同 job 过期接管路径也 voidInTx(old)**）+execution.processor（skip 路径 moveToDelayed）+ai-image-edit.controller/lighting.controller（**job data 携 ExecutionTicket {intentRowId,execSeq,jobId}**）+api-caller（onTick 回调带 {status,execSeq} 判定——**不匹配即 abort 外呼**）

- [ ] 先红（真 PG+真 BullMQ）：manifest 前置（EXEC_STATUS_KEYS+execSeq）；同 job 重入三态（red：现状「skip 后 return=ack→旧 worker 真死零交付」悬挂复现）；**onTick 旧代 abort**（red：旧 worker 在接管后仍轮询 provider 白烧钱复现）；**takeover void**（red：旧 worker reserve 后 kill→新 worker 接管→恰好扣一次交付一次；无 void 则 mayCall:false 悬挂复现——team-credit:105）；fail/touch/reanchor 旧代 0 命中 no-op；rearm 只释放（red：v9「release+re-reserve」悬挂复现）；providerRequestId write-ahead+providerTaskId 落库+query-first 键序 requestId→taskId（red：现状零写库点；kill worker after submit→重跑零重复 provider submit）；edit/lighting ticket（red：旧 job 在新代后重投零副作用）；**v11.1：能力矩阵第三档——无幂等键且不可查询的 provider 禁自动重投+显式人工裁决路径**（submit 后崩溃→重跑零重复外呼转告警——本地状态无法单方面保证外部 exactly-once）→绿+Commit。

### Task 10: NodeArtifact+ArtifactCommit（stage durable+finalize CAS+image 同步链）

**Files:** **shared artifact-core module**（node-artifact.service.ts=**CAS 原语三用**〔finalize/replace/clear 共用 `WHERE rev=expectedRev`〕+artifact-commit.service.ts+media-registration.service.ts）

- [ ] **NodeArtifact CAS 原语**：`claimCapture`（claim 时读 PG 槽位 rev——expectedRev）+`casUpsert(rev 匹配→rev+1+mediaId/resultText+state+execSeq)`——0 行=superseded（记 ArtifactProjection state=superseded+资金独立判）。
- [ ] 先红（真 PG）：**finalize CAS**（red：生成在飞用户 replace→finalize 0 行→superseded 不覆盖用户值〔v10.1 fileIdRev 三洞之洞 A/B 对应面〕；反向 replace 后新 claim 捕获新 rev 正常覆盖）；**资金独立判**（intent CAS 成功∧provider 成功→照常 settle 产物入素材库——red：「CAS 失败静默丢产物」与「无条件退款」两错分支；intent CAS 失败→void 旧冻结）；**finalize 锁序 balance→intent**（死锁注入零 40P01/55P03+100ms sleep 注入锁等待不恶化）；**stage durable 全 kind 落 sourceUrl**（red：image 系 stage 后 kill -9→R3 凭 processing 行+sourceUrl 重下并 finalize——现状 provider URL 仅在内存窗口只能退款）；幂等（同 intent+execSeq 重跑零新行——NodeArtifact @@unique）；settle 失败整体回滚；shared module 双 role DI（red：worker DI 图不可解析）；40P01/40001/55P03/P2024 有界重试；**v11.1：胜者规则不变量红测**（同节点第二 claim→NodeBusy——RUNNING 闸 Z94 维持禁开口子；finalize 原子性——intent CAS 与 NodeArtifact CAS 同事务，后发起者 claim 必见新 rev——「最新意图优先」的结构性表述，**不引入 activeIntentId 列**）→绿+Commit。

### Task 11: replaceMedia/clearMedia 命令+四客户端写路径迁移

**Files:** collab-media.controller.ts（**POST /api/projects/:id/collab/nodes/:nodeId/media**：replaceMedia{mediaId,expectedRev}/clearMedia{expectedRev}——PG NodeArtifact CAS+新 ArtifactProjection pending+旧投影 superseded；0 行→409 ARTIFACT_REV_CONFLICT）+web ImageGenNode.tsx（变换保存 :394/AI 编辑回填 :885/清空 :737）+nodeStore.ts（socket done :698 降本地 UI）+canvasIntents（strip 更新路径 CLIENT_FORBIDDEN_ON_UPDATE={fileId,result}）

- [ ] 先红：**四路径迁移**（red：变换保存/AI 编辑回填走 replaceMedia 后 doc fileId 正确落且 NodeArtifact.rev+1——v10.1 strip 直接打断四面复现）；**clearMedia**（red：清空走命令——referenceImage 清空仍客户端写不受影响）；**409 冲突**（red：expectedRev 过期→409→客户端刷新重试成功）；**socket done 零 doc 写**（red：setFileResult 现状写 doc 复现）；strip 更新路径只剥 {fileId,result}（red：上传 referenceImage/images/allImages 不被剥）→绿+UX 签字（409 交互+乐观 UI）+Commit。

---

## 片 S3：video 异步+reconcile（T12-T13）

### Task 12: video finalize-first+MaterializeJob（v10.1 T6d 主体维持）

**Files:** artifact-commit.service.ts（video kind 分支）+worker MaterializeJob（ai-download 迁移改造）
- [ ] 先红：video=finalize 建 Media(processing,sourceUrl 加密)+**NodeArtifact state=materializing**+settle/complete+ArtifactProjection（fileId 交付 mediaId）——doc 只有 fileId（grep doc data 无 videoUrl/resultUrl）；processing 期可播/seek（content 两态+processing fact 推送）；materialize 幂等键=mediaId（kill 后重跑不重复下载/不重复 Media）+复用同一次下载算 natural/hash/mime 置 probeState=done；自有 lease/attempts 与 intent attempts/rearm 解耦；源过期 410/重试；**终态失败→幂等补偿退款+NodeArtifact state=failed+errorCode=MATERIALIZE_FAILED（不清 fileId——UI 失败/重试）**→绿+Commit。

### Task 13: R3 reconcile+三后门删除+保留矩阵（v10.1 T6d 后半维持）
**Files:** intent-reconcile.service.ts（finalizeFromExistingMediaOrText+动作表+审计行 reconcile_action+pg_advisory_xact_lock）+collab-write.port.ts（typed outcome——资金路径禁伪造 written:true）
- [ ] 先红：R3 五窗收敛（settle 后崩溃/Media 后崩溃/投影缺失/node 删除/源过期——一轮收敛+双 settle 零双 refund 零+审计行）；**stage 行+sourceUrl 存在→重下 finalize（provider 不重调）**；FAILED/VOIDED∧reserved>0∧无 artifact/无 delivered→voidInTx；歧义态不自动动钱→告警；三后门 grep 零命中+backfillSucceeded 禁写 SUCCEEDED+null；text 90d；并发双 reconcile 恰一次→绿+Commit。

---

## 片 S4：投影与交付（T14-T16）

### Task 14: typed flush 窄接口（v10.1 T6c 载体维持）
**Files:** collab-persistence.service.ts+collab-residency.service.ts
- [ ] 先红：flushDocument `{persisted}|{retry,reason:'spooled'|'failed'}|{terminal,reason:'fenced'|'fk'}`（显式 storeDocumentSerialized〔saveMutex 内〕）；**spooled 无限重试不耗 attempts**（red：PG 停机>1h 判死磁盘安全帧假失败复现）；fenced 停 claim 等租约；fk→orphaned；noop 分支显式（noop∧isPersistedComplete∧目标匹配=persisted 等价）；**v11.1：flush 提交前校验 CollabLease.epoch 未变**（会话捕获时 epoch≠当前 epoch→拒绝提交/降级重试——长会话在租约易主后不得继续落库；复用 schema:858 epoch 列零新机制；red：模拟租约易主后旧会话 flush 被拒）→绿+Commit。

### Task 15: ArtifactProjection poller（lease fencing+fast path+六终态）
**Files:** media-delivery/projection-outbox.poller.ts+collab-document.service.ts（deliverArtifact 复合 op——写 data.fileId/result+exec cache）
- [ ] 先红（真双端）：**CollabLease fencing**（red：非 lease holder claim 后 withSession 503 耗 attempts——滚动部署/双开复现）；投影循环（claim pending∧lease 过期 SKIP LOCKED→**读 NodeArtifact——artifactRev≠rev→superseded**→**内容等值 fast path**〔doc.fileId==artifact.mediaId→跳写直接 flush+projected〕→withSession apply→typed flush→**recheck rev**→一致才 projected）；六终态（red：node 删除→orphaned 不重试/用户 replace+新代→superseded/耗尽→dead+告警/undo 恢复节点→可 re-open）；批按 project 一次 flush；dead 行 on-load reconcile/admin retry 重驱；mark 后 lazy GET media-facts 补拉；onModuleDestroy；**v11.1：投影循环全程同一所有权边界**（claim→apply→flush→recheck→mark 均受 lease epoch 约束——T14 校验的引用面）→绿+Commit。

### Task 16: MediaBinding current-state reconcile+GC 引用图+exec cache+pendingFacts
**Files:** binding-reconcile.service.ts+media GC+web canvasCollabRuntime/nodeStore
- [ ] 先红：**current-state upsert**（red：同槽位换 media 改行——v10.1 create-only「当前槽位靠 createdAt 猜」复现；**删除节点→binding 行删除**——stale 清扫）；finalize 同步 upsert binding（source=generated）；**GC 引用图=binding+NodeArtifact+VideoProject/VideoWork/素材库+grace**（red：副本引用媒体不被删——doc 引用扫描）；跨 team 拒+计数不建行；**exec 降 cache**（red：资金/执行/交付判定读 PG——raw 写 exec 后仅显示漂移可修复，不影响钱/交付）；**pendingFacts**（fact 先于 fileId 到达暂存+fileId 到达即消费+重连全量拉+factVersion 忽略旧+切项目清空）→绿+Commit。

---

## 片 S5：doc v3/客户端/运维（T17-T19）

### Task 17: placement/order/slot+cells 派生+copy normalize+只读门（v10.1 A1/B1-B2 核心）
**Files:** placement.ts/order-key.ts/order-records.ts/validate·normalize（shared）+canvas-allocator.ts+web 三组件+groups/+syncStatus+nodeStore+canvasStore+canvasUndo+video-work 快照
- [ ] placement 复合单键+DOC_NODE_KEYS 契约表（envelope 7 键+order/slot 进 data 判别——slot=派生单实现）；单一有界 order+**(order,id)/(slot,id) 双 tie-break 读序**（sortNodesByPosition/sortForArrange/orderRecords 全改）；allocator 唯一入口+**copy/paste 重新分配 placement/order**（red：副本同层同 order 重复键+位置重叠复现）；deriveStoryboardCells（capacity 派生+overflowIds+回流面 11 处删除）；normalizeCopiedNodeData 五路径共用（loading→有 fileId 则 done 无则 idle/清 errorCode/删 url/**保留 fileId/images[].id**/exec 不复制/cells 删）；**canEditCommand 单源门+七命令补门**（G34）；applyIntrinsicFit+尺寸消费+resync 分流+write-rejected 节流→绿+Commit。

### Task 18: 病理计数+CLI+版本硬切+reset（v10.1 A2/B3 改造——repair CLI 化+硬切）
**Files:** collab-pathology.ts（soft/hard/重复键/键长计数+告警）+scripts/collab-renumber-layer.mjs（**离线/维护窗 CLI——幂等，不承诺永久无重复**）+collab-protocol+docShape（**双常量=3+CanvasDoc.schemaVersion 列门——meta.schemaVersion 删除**）+session-guard（csv≠3→4410 一次 reload）+dev-reset-canvas.mjs（**全表清**：CanvasDoc/CanvasDocUpdate/NodeArtifact/ArtifactProjection/MediaBinding/MediaFactOutbox/Media 全量〔含上传〕+GenerationIntent/TeamCreditTransaction/LightingTask+BullMQ 队列+Redis 键+MinIO temp/uploads/artifacts 前缀+IDB `flowweb:collab:`+spool 目录——**两轮零回灌**）
- [ ] 先红：旧 client（csv=2）→schema-outdated→一次 reload；旧 doc（docSchema=2）→拒载（CanvasDoc.schemaVersion 列判定）+IDB 不命中+Redis 键失效；**CLI renumber 幂等**（同层重复键→CLI 重排→读序稳定；重复再生成仍容忍不 500）；**在线 repair 端点不存在**（grep 零 repair 路由/CollabMaintenance/RepairRun）——G53 改口判据；reset 全表零回灌→绿+Commit。

### Task 19: 收敛 harness+soak+verify 终出口（v10.1 T22+T28 合并）
**Files:** web node config+fixtures+api collab-harness/provider-convergence.e2e-spec.ts+verify-manifest
- [ ] 先红矩阵：双端收敛+分镜并发零成员丢失+等值邻居/重复键读序稳定；**execSeq 代际矩阵**（同 job 双 worker 三态 moveToDelayed+onTick abort+takeover void——零「completed 但 RUNNING 悬挂」+零 provider 白轮询）；**投影 rev 竞态矩阵**（生成在飞 replace→superseded；apply→flush spooled→重启→retry 仍 projected；旧/新 artifactRev 同时 pending 新代赢；flush 四崩溃窗）；**video materialize 矩阵**（processing 可播 seek/下载失败重试/崩溃 resume/URL 过期→410/终态失败→补偿退款+errorCode）；**R3 五窗**；**copy 保留 fileId 立即渲染+placement 重分配+binding current-state**；**guard 检测→exec cache 修复→ACL 拒绝链路**；outbox 乱序+重复投递幂等；reset 联动。
- [ ] 绿+**soak**（10k+10 客户端 10min：投影 p95≤30ms+doc<8MB+单帧<128KB+delivery lag p95≤60s〔pg_notify 唤醒优化可选〕+outbox lag+materialize lag+applied_unpersisted=0+内存上界；**v11.1 验收矩阵补：成员移除后旧连接拒写/reset 安全（非白名单拒执行）——阻断门；50 客户端梯度+24h soak——目标项非阻断门（2C 单机现实，10 客户端维持阻断）**）+verify/CI 全绿+UX 签字（slot 交互/replace 命令 409 交互/40MP 上限/content 两态下载行为/video processing UX）→Commit+部署窗呈报。

---

## 验收门禁（v11 汇总——判据随 spec v14 §0.2 ㉕-㉜ 权威表）

**保留**：G1-G15/G17（改口）/G18-G20/G22/G47/G54-G57（v10 口径未被 v14 推翻项）。

| 门 | v11 增强点 |
|---|---|
| G42 | MediaFactOutbox（乱序必达/重复投递幂等/processing fact 同事务/REST POST≤200/pendingFacts 消费）+**读 ACL 团队级（同 team 跨项目 200/跨 team 403/公开 workId）+读侧 presign 旁路零存在（/url+/batch 404）** |
| G43 | 两编排器（MediaRegistration=唯一 media.create 点 grep census+prepareUploadInTx 补 projectId+clientUploadId 幂等+**pendingExpiresAt TTL**；video=NodeArtifact materializing；text=NodeArtifact resultText 零 Media；非资金零 doc 写；shared module 双 role DI） |
| G44 | **NodeArtifact CAS（claim 捕获 expectedRev/finalize `WHERE rev`/replace/clear 命令/0 行 superseded+资金独立判/内容等值仅 fast path）+四客户端写路径迁移+409 冲突** |
| G46 | strip 更新路径 {fileId,result}+上传引用键零剥+socket 零 doc fileId 写+copy 保留 fileId 立即渲染+placement 重分配+**binding current-state upsert（同槽位改行/删节点删行）+GC 引用图全** |
| G48 | **上游解析（paramsHash 哈希 mediaId+claim 读 NodeArtifact 非 doc+sourceUrl→presign 兜底）**+execSeq 三态 moveToDelayed+**onTick 旧代 abort+takeover voidInTx**+ExecutionTicket（edit/lighting）+providerRequestId/providerTaskId 落库+query-first+finalize 锁序+stage durable 全 kind sourceUrl+R3 五窗+三后门零命中 |
| G23/M1 | probe 分型批/lease+sniffed 路由+ffprobe 沙箱（materialize 复用下载） |
| M2 | content 两态（ready=X-Accel Range/206+processing 代理降级）+**删读侧 presign 旁路**+sharp 重编码+BigInt+sourceUrl 零泄漏+/flowai 迁移+SSRF+CI 真 S3 |
| G53 | **v11 改口：读序 (order,id)/(slot,id) 稳定+重复键不 500 不丢节点+CLI renumber 幂等+在线 repair 不存在（grep 零命中）**；reset 脚本安全（red：非白名单环境/生产 DB 拒执行——环境白名单+目标库校验+**默认 dry-run**+对象存储路径限定） |
| G58 | **投影 flush 四窗全收敛+载体=typed flush 窄接口+rev recheck（旧 rev superseded）+内容等值 fast path+CollabLease fencing+六终态（node 删 orphaned/replace superseded/耗尽 dead）+dead 重驱** |

## 自检（plan v11——writing-plans Self-Review）

**v14 四推翻落位**：①NodeArtifact PG 权威+rev CAS=T2（schema）+T10（CAS 原语+finalize）+T11（replace/clear 命令）+T15（投影 recheck）——fileIdRev/exec rev 全案零出现（grep fileIdRev=0）；②在线 repair 删除=T18（CLI+病理计数+「在线 repair 不存在」门禁）——CollabMaintenance/RepairRun/RW 屏障/维护门 503 零出现；③硬切=T2（CanvasDoc.schemaVersion 列）+T18（双常量=3+旧 doc 拒载+reset 全表）——rebuild cutover runbook 零出现；④ArtifactProjection=T2（六终态 schema）+T14（typed flush）+T15（投影循环）。

**八补强落位**：①上游 provider URL 形态=T8（sourceUrl 直传+presign 兜底——用户 2026-10-19 选型确认）；②上游读源 NodeArtifact=T8；③投影 lease fencing=T15；④pending TTL+uploadId=T4；⑤pendingFacts=T16；⑥compaction 维持现状=T18（现有 vacuum 行为不动，零新 handshake 代码）；⑦artifactState 双权威消除=T2（GenerationIntent.artifactState 列删）；⑧replace/clear UX=T11+T19（签字项）。

**维持项落位**：锁序 20/InTx=T10；outbox=T4/T7/T16；MIME/SSRF/ACL=T4/T5/T6；moveToDelayed/takeover=T9；rearm 只 voidInTx=T9；providerRequestId write-ahead=T9；quota 软限+预检=T4/T10；video 即时 settle=T12；copy 新建保留=T17；R2=Y2 登记（useNodeArtifact 直读=seam——T16 exec cache 即其过渡形态）。

**五面闭环**：生产端（T10/T12 两编排器+NodeArtifact）/交付端（T14/T15 typed flush+投影循环）/消费端（T11 strip+T16 pendingFacts+exec cache）/生命周期端（T13 保留矩阵+T16 GC+T18 reset 全表）/崩溃端（T8 重下/T9 锁序+代际/T10 stage durable/T12 materialize/T13 R3/T15 flush 四窗/T19 注入矩阵）。

**v10.1→v11 实质差异（执行者勿混用）**：①DocDelivery→ArtifactProjection（唯一键 [artifactId,artifactRev]+六终态——expectedValue/fileIdRev 删）；②GenerationIntent.artifactState 删→NodeArtifact.state；③MediaBinding 键 [mediaId,...] create-only→[projectId,nodeId,role,targetField,targetItemId] current-state upsert；④在线 repair（A2 三卡）→CLI+计数；⑤rebuild cutover runbook→reset 全表；⑥meta.schemaVersion 恢复→CanvasDoc.schemaVersion 列；⑦strip 键集 7→2（CLIENT_FORBIDDEN_ON_UPDATE={fileId,result}）；⑧四客户端写路径迁移新增（T11——v10.1 缺失面）；⑨上游解析新增（T8——v10.1 缺失面）；⑩ACL 项目成员→团队级+删读侧 presign 旁路+X-Accel；⑪edit/lighting ExecutionTicket+onTick abort+takeover void 补强；⑫pending TTL+clientUploadId 新增；⑬28 卡/9 片→20 卡/6 片（S0-S5 垂直切片——每片可独立验证）。

**执行期语义定位点（已实证）**：topology:71 读 data.resultUrl（T8 消解）/normalize-intent-params:16-17 imageUrl 哈希（T8 消解）/written:true 合成 collab-write.port:203-206（T13 typed outcome）/团队回退 project-permission:28-33（T5 ACL 依据）/四客户端写路径 ImageGenNode:394/:885/:737+nodeStore:701（T11 迁移对象）/providerTaskId 零写库点（T9）/team-credit:105 mayCall:false（T9 takeover void）/applyWriteNodeDataToDoc 无条件 set document:286（T15 内容等值 fast path+rev recheck 消解）——其余 v10.1 锚维持（同 jobId 重入不递增 attempts generation-intent:130/:158/exec 守卫只比 attempts document:313-331/契约 20 credit-ledger:58/三后门 reconcile:163/:215/:224/media.create 9 处/24 处 /flowai/confirmUpload 无守卫 storage:69-99/BullMQ return=completed/presign 无 projectId storage:38-50/app.module:71 manualRegistration）。

**与 spec v14 的对齐**：全部 T 卡/门禁与 spec v14 §0.1 Z 表（v14 改条目）+§0.2 ㉕-㉜ 一致；裁决引用=spec v14 修订链口径；偏离走 spec §0.4。

