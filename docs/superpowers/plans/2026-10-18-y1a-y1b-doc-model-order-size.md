# Y1a+Y1b：doc 模型 v3·序与尺寸/只读 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

<!-- plan v8（2026-10-18）：三份 v7 外审高度收敛+三并行核验坐实+挖出三现存 bug 后四用户裁决落地（2026-10-18 八次确认）——v10 五大换代方向维持，本轮收敛为**单一代际/单一 epoch/单一事务**。**四裁决**：①**repair 换轨方案 A**（推翻 v10 裁决③——repairRev 三致命缺口实证〔客户端 URL 只 csv/cb 无自报 rev runtime:1572；doc-status dedup=${state}:${frozen}+客户端 msg.rev<=last return 吞 rev 变化；repair 不改 SV preVacuumSv 检测不到〕：repair=一次 generation 跳变的 doc rewrite——vacuumGate 互斥→beginVacuumEra 冻结+4410→quiesce〔writesSettled 覆盖服务端 outbox——DocDelivery/attach 维护门 503 退避〕→离线重排→**等价断言=忽略 order|slot 的节点/边/data 等价**→单事务 vacuumReplace〔state+preVacuumSv+generation+1〕→客户端零新协议〔preVacuumSv 内容级 fence+consumeGenerationJump 单链+IDB 四维键联动〕；**repairRev 删除**；ack 降 UX；**purgeForeignCaches 反语义 bug 同修**〔现状传会话旧键=保留脏代删其他代 local-cache-key:71〕）；②**全局单调 execSeq+三硬约束**（**DB sequence nextval 分配三处**〔new claim/同 jobId 重入/rearm〕禁 increment/max+1；DB BigInt wire/doc 用 string 守卫 BigInt 比较；进 exec 守卫/finalize CAS/唯一键+job data+onTick/reanchor+**reserve/reservedExecSeq+void_/settle CAS**+同 job 重入 claim 事务内 reservation 继承+旧 execSeq void/settle 一律失败；attempts=免费重试配额不混用——反例 A〔同 job stalled 重排 processor:40+重入不递增 attempts generation-intent:130/:158〕/B〔exec 守卫只比 attempts 不比 intentId document:313-331——**新 intent 的 loading/done 被旧 done 永久拦截=现存 bug**〕/C 三实证）；③**producer 分两层=一个 Media 写入服务+两个编排器**（**MediaRegistrationService=唯一 Media 写入点**：register/confirm 两形态共用 sniff/MIME/quota/probeState/natural 初始化+registerInTx/confirmInTx/bindInTx **禁止第二处 media.create/bindMedia**；ArtifactCommit=资金五路径〔text/image/video/edit/lighting〕finalize 事务内调 registerInTx+execSeq CAS+settleInTx+complete+DocDelivery；非资金六路径〔upload confirm/stitch/trim/separate/copy/export〕走 MediaRegistration **不碰 settle/complete/DocDelivery/exec**——四路径零 GenerationIntent 实证；非资金幂等锚 registrationKey=taskId+artifactIndex|mediaId|exportRequestId+Media @@unique(bucket,key)；非资金零 doc 写 attach consumer 交付；**不造 creditCost=0 intent**；两层只共享 Media/linkMedia 原语）；④**DocDelivery=typed flush+批量+复核**（withSession(write) 增 flush:true+**flushDocument(pid):'appended'|'noop'|'spooled'|'terminal'|'failed'**〔storeDocumentSerialized/saveMutex〕；只有 appended〔或 noop∧isPersistedComplete∧目标匹配〕才 delivered；**spooled≠delivered** 继续重试不耗 maxAttempts；按 project 批量一个 withSession 全 apply 后一次 flush；flush 后复核 target/execSeq/expectedValue→superseded/orphaned/delivered；lease 覆盖 flush+recheck+mark；delivered=PG 至少一次；**withSession 写后 debounce 未落库实证 residency:459-468——mark delivered 撒谎根修**）。 -->
<!-- v8 同批收编：**锁序契约 20**（finalize 先 lockBalance 再 CAS intent——credit-ledger:58 注释+reserve/settle/void/rollback 四处先 balance；先锁 intent=ABBA 死锁）+**InTx 方法族**（completeInTx/settleInTx/createXxxInTx——complete 根 prisma:255+settle 自开事务:132 根修）+finalize 幂等检查事务内 CAS 前+40P01 有界重试 3 次 jitter；**唯一键全带 execSeq+artifactIndex+targetItemId**（稳定 ImageItem.id——删除/重排按 id 现算实证 targetIndex 会漂移）；**对象 key=artifacts/{teamId}/{intentRowId}/{execSeq}/{index}-{sha256}**+If-None-Match+hash 校验+orphan sweep 前缀+龄阈值；**旧 reconcile 三后门删除**（backfillSucceeded:215 直接置 SUCCEEDED/threeCheck resultRef:244/settleStranded probeArtifacts→**不变量巡检**〔SUCCEEDED⇒stored∧Media∧settled——告警人工不自动退款〕）；**rearm 事务**（execSeq nextval+reservation 继承+旧 outbox superseded+**资金归一化**〔rearm 残留冻结 mayCall:false 静默跳过外呼=现存 bug team-credit:102+execution:325〕）；**worker 端点 op 白名单 exec-only**（fileId/resultUrl 在服务端白名单内 write.controller:32+manifest:83——收窄）；**MediaFactOutbox 替换 probedAt watermark**（事务乱序提交必漏实证；factVersion 单调/pending 行+SKIP LOCKED/probe·server-natural·attach 三写入点/来源 union(Media.projectId,binding)/重启零回放/emitter 单实例假设显式化=instances:1 多实例归 Y7）；**MIME 全链**（file-type 库+**API 代理流式 /api/media/:id/content 按 sniffedMimeType 设 Content-Type+attachment+CSP sandbox+生产 MinIO 直链禁用**+presign Content-Type 条件+SVG 拒+sharp 重编码剥载荷+Media.size BigInt〔Int 2.147GB 上限〕+**生产上传 /flowai 渗透修复**〔mediaUploadUtils:31 dev 假设——生产 MinIO 直连下无背书〕）；probe（**图片批 4 lease 180s/视频 batch 1 lease 5min**〔批 2×90s 覆盖不了下载+ffprobe〕/nextProbeAt jitter/claim 按 sniffedMimeType 路由〔伪报 audio 的图片不再永 skipped〕/索引 [probeState,nextProbeAt]/40MP+downscale 产品策略）；text 90 天（resultText 非空行延长）；exec error reconcile 活跃项目过滤+24h 窗；attach=只填空/replace=显式命令；观测+8 指标；**每卡真 PG 并发用例**（A3 不够早）；**交付 owner 唯一**（资金型=DocDelivery；binding 对 sourceIntent 非空跳过 fileId 写）。外审误判修正：生产 /flowai 同源直出不成立（MinIO 域名直连——上传侧渗透才是真问题）；reconcile 带状态+时间窗非全表；multiImage targetIndex 漂移不成立（UI 按 id 现算）。 -->
<!-- plan v9（2026-10-18）：三份 v8 外审攻击三接缝（finalize 状态机/三 poller 协调/A1-execSeq 交界）+四路并行核验（9 P0 坐实/8 P1/6 误判过滤）+四用户裁决（2026-10-18 九次确认）——v8 四裁决方向维持。**四裁决**：①**同 job 重入复用 execSeq**（推翻 v8「nextval 三处+继承/转移」——重入者 mayCall:false 静默 skipped 等旧 worker 交付〔team-credit:102 现状故意语义〕，旧 worker 真死归 reaper→rearm；**分配收敛两处 new claim/rearm**；rearm=nextval+**voidInTx 旧冻结**〔release+re-reserve——新 worker 重走 reserve 拿 mayCall:true〕+旧 outbox superseded）；②**video 即时 finalize**（provider 成功即 settle+complete+DocDelivery kind=videoUrl 交付 videoUrl **无 Media 行**；下载→MinIO→Media→fileId=**非资金续段**〔ai-download 迁 MediaRegistration+attach〕；不变量按 kind 分化——video 巡检豁免 Media 项/text 无 Media 跳过 registerInTx）；③**copy 清锚零新列**（copy/clone binding **清空 sourceIntentRowId/sourceExecSeq**+新 registrationKey；**attach claim 加 sourceIntentRowId IS NULL**——资金原件 binding 永不进队零 churn；**normalizeCopiedNodeData 五路径共用**——status loading/error→idle〔red：copyPlan:63 structuredClone 连 loading 复制=副本永久转圈〕/身份键 binding 成功才保留/exec 永不复制/cells 删）；④**资金 quota 软限**（finalize 不因 quota 回滚——钱已付 provider；超限告警+计数 artifact_quota_exceeded_total；registerInTx **禁调 assertOnConfirm**〔storage-quota:37-49 删对象+删行副作用〕+**禁外部 IO**——sniff/HEAD/hash 全事务外）。**9 P0**：EXEC_STATUS_KEYS/ExecStatusPatch+execSeq: string（manifest:90 现状无——不进键集 writeExecStatus 直接 UNKNOWN_KEY 代际围栏门口死；旧条目 docSchema v3 拒载）；同 job 复用；copy 清锚；**StoreOutcome 判别联合先行重构**（storeDocumentUnlocked boolean——noop/spool 成功/spool 失败/FK/fenced 五分支混一个 false〔persistence:235/:283/:287-395/:308-336〕；flushDocument 五态以 StoreOutcome 为载体禁旁路猜 hasFrames/persistUnhealthy；withSession(flush:true) 只 delivery/attach 两消费面）；**stripServerOwnedData web 单点无条件挂全构造点**（diff dataPatch〔canvasIntents:502 全键差异——快照窗口跨远端 apply 时服务端写的 fileId 被判"变化"经 WS 发回〕/addNode.data〔:462 全量〕/copyPlan/paste/undo 恢复；服务端 manifest 拒写降第二道——「未修改才不回送」废止）；text/video kind 分支；**唯一键补维度**（MediaBinding `@@unique([mediaId,projectId,nodeId,role,targetField,targetItemId])`/DocDelivery `+targetField,targetItemId`/**MediaFactOutbox `@@unique([mediaId,projectId,factVersion])`**/targetField 词表补 videoUrl/resultUrl——video 交付无处落）；**If-None-Match 废止**（MinIO 不支持条件写）→x-amz-meta-sha256 上传元数据+finalize HeadObject 校验；**pendingFacts**（fact 可先于 fileId——「忽略未知 mediaId」丢 natural 到重连）：客户端短 TTL Map（fileId 到达即消费）+delivery/attach mark 后 lazy GET 补拉。**8 P1**：重试码+**55P03**（lock_timeout）+P2024；MediaRegistration 第四形态 **prepareUploadInTx**+**11 处 media.create 映射表**（storage:37/media-process:194/ai-download:100/ai-image-edit:199+200/lighting:167/video-trim:110/stitch:97/generated-media:54/video-work:91——全部可映射四形态）；幂等前置判据=**FOR UPDATE 下 intent 行状态**（SUCCEEDED∧stored∧creditsConsumed=cost→幂等返回+补建缺行）非仅 Media 存在；attach/delivery **per-project 进程内互斥**（串行化 apply+flush+recheck+mark）；repair 等价断言含 **exec 根值等价**（vacuumEquivalent 现状只比键集合 registry:655-663）；attach lease 覆盖 flush（180s）+两 poller **onModuleDestroy**；**fail/touchHeartbeat/reanchorDeadline 补 execSeq 维度**（generation-intent:230/:248/:265 只守 status——旧 worker 可刷/杀新 attempt）。**误判过滤（勿复入）**：DocWriteCoordinator「正确性 P0」不成立（两 poller 写同 project 同 Y.Doc〔共享 residency 池〕+saveMutex per-doc+flush 排空全队列——纯成本降 P1 互斥）；零费 settle no-op 分支多余（不造 creditCost=0 intent）；P2002 事务内 catch 驱动多余（lockBalance 串行同 team 并发 finalize）；「grep 零第二处会红」=迁移终态门禁非现状断言；fillDoc 逐键写=A1/T15 已覆盖；outbox 单 projectId 漏 fanout=attach 补插行已设计（真缺口仅唯一键）。 -->
<!-- plan v10（2026-10-18）：第十轮三份 v9 外审生产级评审（机制通过/执行驳回×2）+三路并行事实核验+三份六点裁决报告终裁后**六项裁决+四分叉裁定+残余 P0 十三条**落地（推翻 v9 裁决②〔video videoUrl〕与 v8/v9 裁决①〔repair generation 跳变〕）。**六项裁决**：①**video 不交付 videoUrl**——`Media(status=processing)+fileId`：provider 成功即 settle+finalize（资金流与 v9 零 delta——只换交付载荷）；finalize 事务内建 Media 行（status=processing+**sourceUrl 专用列**〔禁入 metadata——media-batch 整行 spread 会泄漏〕+预分配 key+provider 声明 mimeType）+DocDelivery(kind=fileId 交付 mediaId)+settle/complete；**materialize 异步**（MaterializeJob：自有 processingLeaseUntil/processingAttempts 退避**与 intent attempts/rearm 彻底解耦**——存储抖动不污染资金/交付状态机；幂等键=mediaId；终态失败→**幂等补偿退款**+artifactState=failed+告警；materialize 不写 doc）；processing 期 content proxy 两态（ready=对象流+Range/HEAD/ETag；processing=allowlist 流式代理 sourceUrl+no-store+maxContentLength 上限+超限降级占位）；**targetField 词表删 videoUrl/resultUrl；DocDelivery kind 收敛 fileId|text**；统一不变量 `SUCCEEDED⇒settled∧DocDelivery(fileId)∧Media 行存在∧status∈{processing,completed}`（text 唯一例外）。②**repair=in-place 主路径**（preVacuumSv fence 挡不住未同步离线客户端实证 registry:689-697——generation 跳变常规化=数据复活风险常态化）：维护门（applyWriteFreeze **不 close 不 reload 不清 IDB 不跳 generation**+新连接只读+DocDelivery 维护门 503）→writesSettled→纯函数修复计划→**withSession(write, MAINTENANCE_TRANSACT_ORIGIN) 分块 ≤64KB**→回读校验（等价断言=忽略 order|slot+非 order/slot 键零变化）→解除 readOnly+RepairRun 审计；幂等可重跑；**帧预算预演**（scratch doc encodeStateAsUpdate——超 256KiB 或不可表达结构才退 vacuum）；**vacuum 兜底仅限「确定无离线客户端」运维窗**（无 generation 握手不得自动回退——握手归 Y2）。③**copy 方案二+**：**strip 只对更新不对新建**（更新路径剥禁写键——快照窗口回退 bug 面；**新建/copy/paste/explode 保留 fileId/images[].id——消灭空图窗口**）；normalizeCopiedNodeData 收窄（loading/error→有 fileId 则 done 无则 idle/清 errorCode/删 url/exec 不复制/cells 派生）；**binding 服务端惰性 reconcile**（mediaRefsOf 扫描+teamId 校验+幂等 upsert 清锚——零客户端调用零新端点）；跨 team paste=客户端 strip+读 ACL 403 兜底；**Media GC 加 doc 引用/grace 护栏**；**attach consumer 整建制取消**（两大存在理由消灭）——**交付 owner 收敛单一 DocDelivery poller**（非资金需写 doc 者并入 kind=fileId 无资金字段）+MediaBinding 降级纯索引。④**reconcile=R3 幂等 finalize 自动收敛**（推翻 v9「告警人工」）：finalizeFromExistingArtifact（CAS+补建缺行）+动作表+审计行+有界重试 3 次+pg_advisory_xact_lock+**歧义/资损风险绝不自动动钱**；**backfillSucceeded 禁写 SUCCEEDED+null**。⑤**guard/strip=检测/诊断/可修复（shadow 起步）；安全边界=读侧 ACL**：**assertMediaReadable 单门**（url/batch/content/facts/thumbs/snapshot 注入全覆盖——项目成员+Media.teamId===project.teamId；公开页按 workId 不按 mediaId）；**meta.schemaVersion 例外硬删+重连**（DoS 防护 shadow 也删——现状 writers 仅文档约定=viewer 可 brick 项目）；**键集单源两集合四处共用导出常量**（SERVER_WRITABLE_DATA_KEYS 含 content/CLIENT_FORBIDDEN_DATA_KEYS 不含 content——四处=manifest/strip/guard/census）。⑥**R2 登记 Y2 立项候选本批零代码**（Artifact 表/mediaRef/多实例+触发条件）；**双 bump 保留**（生产 epoch 14 在线混跑窗真实）；fileId 命名保留。**四分叉裁定**：video settle=provider 成功即 settle（否 ingest 后 finalize——故障域隔离为决定性理由）；双 bump=保留；copy binding=服务端惰性 reconcile；**StoreOutcome 窄接口先行**（推翻 v9 P0「判别联合先行重构」——flushDocument 以 ephemeral flush+isPersistedComplete 三态 `persisted|not-persisted|terminal` 承载+spoolDeadline 1h；五态降后续硬化卡）。**残余 P0 十三条**：rearm **只 voidInTx 释放**（v9「release+re-reserve」自相矛盾——team-credit:105 reservedCredits>0→mayCall:false）；execSeq **进程内贯穿**（job data 不带——controller:68 enqueue 无 claim）+**同 job 重入三态**（心跳新鲜 skip/过期接管/未知可重试——禁「skipped 后成功 ack」）；**providerTaskId submit 后落库**（schema:1014 列在但全仓零写库点）+query-first+Idempotency-Key+**ArtifactCommit/MediaRegistration=shared artifact-core module 双 role DI 测试**（生产 API manualRegistration:true 不消费队列 app.module:71）；读 ACL 单门+**storage.presign 补 projectId**（create data 无 projectId）；**非 additive DDL=rebuild cutover runbook**+**BigInt toJSON 四读路径**（storage-quota agg/storage.service:85 Math.abs/media-batch spread/material spread）+**CI 加 S3 兼容服务**；**targetItemId 非空 sentinel ''**（PG NULL 不去重——单图绑定幂等键失效）；meta 硬保护+键集单源；**confirmInTx+pending CAS**（storage:69-99 无事务无守卫）；**用户 replace vs delivery expectedValue CAS**（applyWriteNodeDataToDoc 无条件 set document:286）；**DOC_NODE_KEYS 契约表+compareExecSeq 单源**（lint 禁裸比较+非法 string drop）；**outbox at-least-once**（「重启零回放」断言废止——改测重复投递幂等）；**SSRF SafeRemoteFetch**（ai-download:62 无 host 校验/重定向/大小上限）；**file-type pin 16.x 或自研 sniff**（≥17 纯 ESM vs tsconfig commonjs）。**附加**：quota claim 前预检；media.create 门禁 **grep census（9 处非 11——ai-image-edit:199+200 同一调用续行）**；C0b 出口**提前 soak 一轮**；**开工前三实证**（生产 nginx -T 核 /flowai〔web 24 处/15 文件改写面〕/check-migration-additive 实判/CI S3 到位）。 -->
<!-- 执行纪律核心：plan 中每个被调用的 API/类型/DI 令牌/进程形态，写码前 grep 实证。行号=2026-10-18 快照。**每卡先红须含真 PG 并发用例（锁序/双 claim/崩溃窗）——mock 测不出代际/锁序问题。** -->

**Goal:** 落地 doc 模型 v3——placement 复合单键序域（order|slot+vendor+等值键）+Media 读模型（REST/**MediaFactOutbox**/快照 join+probe+MIME 全链+读 ACL 单门）+**execSeq 单一代际**（资金 ArtifactCommit/非资金 MediaRegistration 两编排器〔shared module 双 role〕+窄接口 flush 持久化交付）+WriteOutcome+fileId 单一身份收口（**doc 只有 fileId/result 两个身份——provider URL 永不入 doc**）+只读双层+双 bump，批出口=verify 全绿+门禁全过+四曲线+资金矩阵含代际/锁序/flush 崩溃窗/materialize/reconcile 收敛。

**Architecture:** doc=nodes/edges+exec+meta（四根不动）；Media 表=媒体事实权威（status 含 processing 两态——video 资金流 provider 成功即 settle+materialize 异步）；**execSeq=全局单调执行代际（DB sequence，claim 返回值进程内贯穿）**；资金=ArtifactCommitService（**stage 事务外+finalize 短事务**，lockBalance→intent CAS→registerInTx→settleInTx）；非资金=MediaRegistrationService（唯一 media.create 点）——**两者=shared artifact-core module 双 role（API+worker）**；交付=**单一 DocDelivery poller**（deliverArtifact 复合 op+expectedValue CAS+窄接口 flush 三态+复核；attach consumer 取消）；binding=惰性 reconcile 维护的纯索引；facts=MediaFactOutbox（pending 行无 watermark，at-least-once）；repair=**in-place renumber 主路径**（vacuum 仅运维窗兜底）；排序单实现（slot 派生）；双 bump 版本门（保留）；guard=检测/诊断（安全边界=读侧 ACL assertMediaReadable 单门）。

**Tech Stack:** TypeScript strict / Yjs exact 13.6.32 / Hocuspocus 4.6.0 / NestJS / sharp exact 0.34.5（40MP+并发 1）/ ffprobe 8.1.2（CI/部署 pin）/ fast-deep-equal / **file-type 16.x exact（≥17 纯 ESM 禁用——tsconfig commonjs）或自研 magic sniff** / vitest / node:test。

**执行纪律：** 每卡先红（真实变红+**真 PG 并发用例**）→绿→commit；写码前 grep 实证；三面 tsc；文档 diff；每片出口用户确认。

## 文件结构（触碰面全景·v10）

| 文件 | 动作 | 责任 | 片 |
|---|---|---|---|
| 根+apps package.json / ci.yml | 改 | T0 pin（yjs/sharp/fast-deep-equal/**file-type 16.x 或自研 sniff**+ffprobe CI/部署+**CI S3 兼容服务**） | P0-pre |
| packages/shared/src/canvas/canvas-doc-manifest.ts | 改 | **EXEC_STATUS_KEYS/ExecStatusPatch+execSeq: string+键集单源两集合（SERVER_WRITABLE 含 content/CLIENT_FORBIDDEN 不含 content——四处共用导出常量）** | C0b |
| packages/shared/src/canvas/copyPlan.ts | 改 | **normalizeCopiedNodeData 收窄**（loading/error→有 fileId 则 done 无则 idle/清 errorCode/删 url/**保留 fileId**/exec 不复制/cells 派生） | C0b/A1 |
| docShape.ts+全仓 ~141 处 | 改 | T1 改名 StoredNodeRecord | P0-pre |
| scripts/check-plan-census.mjs | **建** | census（**含 media.create grep census/strip 键集四处一致/targetItemId 非空**） | P0-pre |
| collab-doc-ops.ts | **建** | 写原语+类型同迁 | P0-pre |
| apps/api/prisma/schema.prisma + migration | 改 | T3 全量（**exec_seq DB sequence**+probe 族+factVersion+MediaBinding+artifactState+DocDelivery+**MediaFactOutbox**+Media 补列〔**status processing+sourceUrl+materialize 族**〕+**targetItemId 非空 sentinel**+保留矩阵） | P0-pre |
| shared/src/canvas/media-fact.ts | **建** | MediaFact+mediaRefsOf 七键+**compareExecSeq 单源** | C0b |
| media-facts.controller.ts + media-fact-emitter.ts | **建** | REST（**读 ACL 单门**）+**outbox emitter（SKIP LOCKED+at-least-once）** | C0b |
| media-probe/media-probe.poller.ts | **建** | probe 单相（批/lease 分型+sniffed 路由） | C0b |
| **shared artifact-core module**（execution/artifact-commit.service.ts + media-registration/media-registration.service.ts） | **建** | **资金 finalize（stage 事务外+lockBalance→CAS→registerInTx→settleInTx 短事务）+唯一 Media 写入点（prepareUploadInTx 补 projectId/registerInTx/confirmInTx CAS/bindInTx）——AppModule+WorkerModule 双 import+双 role DI 测试** | C0b |
| media-delivery/delivery-outbox.poller.ts | **建** | **单一 DocDelivery poller**（资金+非资金 kind=fileId/text；deliverArtifact+expectedValue CAS+**窄接口 flush 三态**+复核）+exec error reconcile | C0b |
| media-delivery/binding-reconcile.service.ts | **建** | **binding 惰性 reconcile**（mediaRefsOf 扫描+teamId 校验+幂等 upsert 清锚——纯索引维护） | C0b |
| worker MaterializeJob（ai-download 迁移改造） | 改 | **video materialize（processing→completed；幂等键=mediaId；自有 lease/attempts；不写 doc）** | C0b |
| collab/collab-media.controller.ts | **建** | replaceMedia 显式命令（带 expectedValue）端点+repair 端点（in-place 主+vacuum 兜底） | C0b/A2 |
| media.service.ts + media-content.controller.ts | 改/建 | **GET /api/media/:id/content 两态**（ready=对象流+Range/HEAD/ETag；processing=allowlist 代理+上限降级）+**assertMediaReadable 单门** | C0b |
| collab-write.port.ts + controller | 改 | WriteOutcome+同值 no-op+**端点 op 白名单 exec-only**+**typed outcome（资金路径禁伪造 written:true）** | C0b |
| execution/ + intent-reconcile + team-credit + generation-intent | 改 | T6 execSeq 链路+InTx 族+**R3 reconcile 自动收敛**+rearm 只释放+providerTaskId 落库 | C0b |
| collab/collab-residency.service.ts + collab-persistence.service.ts | 改 | **flushDocument 窄接口三态（ephemeral flush+isPersistedComplete）**；MAINTENANCE origin+维护门 | C0b/A2 |
| shared/canvas/placement.ts / order-key.ts / order-records.ts / validate·normalize | **建** | placement 判别/vendor/deriveStoryboardCells/五路径+**DOC_NODE_KEYS 契约表** | A1 |
| web/canvas-allocator.ts | **建** | allocator+等值键+slot 重映射 | A1 |
| collab/collab-pathology.ts + collab-maintenance.service.ts | **建** | soft/hard+**repair=in-place（维护门+分块 ≤64KB+帧预算预演+vacuum 兜底运维窗限定）**+purgePidCaches 修复（vacuum 路径） | A2 |
| collab/collab-content-guard.ts | **建** | guard（检测/诊断口径——exec+身份键+meta.* 域；shadow 定档+meta 硬删例外） | A2 |
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
// Media 增列（v10）
// status（String——现状 pending|completed|failed）词表加 processing：
//   processing=video finalize 已建行、materialize 未完成（size=0/key 预分配/mimeType=provider 声明值）
//   completed=materialize/confirm 完成（size/sha256/sniffedMimeType 真实值）
//   failed=materialize 终态失败（触发幂等补偿退款+artifactState=failed）
sourceUrl String?                        // v10：provider 源 URL——专用列禁入 metadata（media-batch 整行 spread 泄漏）；所有读路径 select 排除
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
enum AttachState { pending attaching attached orphaned superseded failed }
model MediaBinding {
  id String @id @default(cuid())
  mediaId / projectId / nodeId / teamId String
  role String @default("primary")
  targetField String @default("fileId")    // fileId|referenceImage|images|allImages（v10：删 videoUrl/resultUrl——video 交付 fileId）
  targetItemId String @default("")         // v10：非空 sentinel（PG NULL 不去重——单图绑定幂等键失效根修）；稳定项 id（ImageItem.id）
  expectedValue String?                    // replace 显式命令用（带期望旧值）；惰性 reconcile 建行时置空
  attachState AttachState @default(attached)  // v10：惰性 reconcile 建行即 attached（doc 已有 fileId 无需 attach 消费者）
  attachAttempts Int @default(0)
  nextAttachAt DateTime @default(now())
  attachLeaseUntil DateTime?
  attachRunId String?
  attachedAt DateTime?
  maxAttempts Int @default(10)
  lastError String? @db.VarChar(512)
  createdAt DateTime @default(now())
  media Media @relation(fields: [mediaId], references: [id], onDelete: Cascade)
  @@unique([mediaId, projectId, nodeId, role, targetField, targetItemId])
  @@index([attachState, nextAttachAt])
  @@index([projectId, nodeId])
}
```

```prisma
enum ArtifactState { stored failed }
// GenerationIntent 增列（v10）
execSeq BigInt @unique                    // 全局单调（exec_seq sequence nextval 两处：new claim/rearm）
reservedExecSeq BigInt?                   // reserve 时写；settle/void CAS 匹配
execProjectedExecSeq BigInt?              // error 投影代际（替代布尔标记）
artifactState ArtifactState?
resultText String? @db.Text
providerTaskId String?                    // v10 P0：submit 后落库（现状 schema:1014 列在但全仓零写库点）——query-first 重入锚
@@index([status, artifactState])
@@index([status, execProjectedExecSeq])
```

```prisma
enum DeliveryState { pending delivering delivered orphaned superseded failed }
model DocDelivery {
  id String @id @default(cuid())
  intentRowId String
  execSeq BigInt                          // 代际快照
  projectId / nodeId String
  kind String                             // v10：收敛 fileId|text（videoUrl/resultUrl 删——video 交付 fileId）
  payload Json?
  artifactIndex Int @default(0)
  targetField String @default("fileId")   // 词表同 MediaBinding（无 videoUrl/resultUrl）
  targetItemId String @default("")        // v10：非空 sentinel（PG NULL 不去重根修）
  expectedValue String?                   // v10 P0⑨：用户 replace vs 在飞交付 CAS（不匹配→superseded 不覆盖用户值）
  state DeliveryState @default(pending)
  attempts Int @default(0)
  leaseUntil DateTime?
  runId String?
  nextAttemptAt DateTime @default(now())
  spoolDeadline DateTime?                 // v10：not-persisted 重试兜底（1h 超时转 failed+告警）
  maxAttempts Int @default(10)
  deliveredAt DateTime?
  lastError String? @db.VarChar(512)
  createdAt DateTime @default(now())
  @@unique([intentRowId, execSeq, nodeId, kind, artifactIndex, targetField, targetItemId])
  @@index([state, nextAttemptAt])
  @@index([intentRowId, execSeq])
}
// 保留矩阵（v10）：intent 行 ≥ Media（sourceIntentRowId）/DocDelivery 引用——有 artifact 的 intent 不物理删（soft delete 或 FK ON DELETE SET NULL+保留 sourceExecSeq）；DocDelivery delivered 30d / MediaFactOutbox published 7d retention
```

```prisma
model MediaFactOutbox {                   // v11：替换 watermark
  id BigInt @id @default(autoincrement())
  mediaId String
  projectId String                        // union(Media.projectId, binding.projectId)
  factVersion BigInt
  payload Json                            // {natural:{width,height}}
  state String @default("pending")        // pending|published|dead
  attempts Int @default(0)
  nextAttemptAt DateTime @default(now())
  leaseUntil DateTime?
  publishedAt DateTime?
  createdAt DateTime @default(now())
  @@unique([mediaId, projectId, factVersion])  // v12：三写入点并发同版本插重行免疫
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

### Task 5: media-facts 读模型（MediaFactOutbox emitter+REST+join+MIME 全链+读 ACL 单门+两态代理+/flowai 面迁移）

**Files:**
- Create: media-fact.ts+media-facts.controller.ts（**读 ACL 单门 assertMediaReadable——项目成员+Media.teamId===project.teamId；公开页按已发布 workId 不按 mediaId**）+media-fact-emitter.ts（SKIP LOCKED 认领+**at-least-once**）
- Create: media-content.controller.ts（**GET /api/media/:id/content 两态**：ready=对象存储流式+Range/HEAD/ETag/304+nosniff+非白名单 attachment；processing=SafeRemoteFetch allowlist 流式代理 sourceUrl+no-store+maxContentLength 上限+超限降级 410/425+Retry-After）
- Create/Modify: **SafeRemoteFetch**（https+host allowlist+私网 IP 拒+maxRedirects:0+流式限长+content-type 白名单——ai-download:62 SSRF 根修共用）
- Modify: storage.service.ts（confirm **嗅探（file-type 16.x 或自研 magic sniff）+白名单拒+删对象+按 sniffed 重算 probeState+confirmInTx 带 status='pending' CAS**+**BigInt.toJSON**）+minio.service.ts（presign Content-Type 条件——**Content-Type 须进 presign.fields 否则全 403**）
- Modify: **/flowai 面 24 处/15 文件迁移**（mediaContentUrl(fileId) 单点+census 禁再出现改写正则——**nginx -T 实证先行**）+snapshot-filter（FilteredNode+公开 natural）+nodeStore（ImageItem 去 url）
- Test: media-fact/emitter/content/snapshot/storage spec（**CI S3 兼容服务真跑——禁 mock 验证 MIME/presign/Range**）

- [ ] **Step 1: 先红（G42/G28/M1-M2）**

```ts
describe('ADR-1 media 读模型+MIME（G42/G28/M2 v10）', () => {
  it('MediaFactOutbox：事务乱序提交（A 先写后提交——**红相：watermark 跳过 A**）→outbox pending 行下轮必达；**重复投递幂等（factVersion 去重——red：v9「重启零回放」假绿复现）**；correction 新 version 必达；惰性 reconcile 后到补发；published retention', async () => { /* 断言 */ });
  it('读 ACL 单门：**跨项目 mediaId 403（red：media.service 现状只 assertTeamMember 复现）**+公开页按 workId+**sourceUrl 零泄漏（DTO/select 测试）**+ETag；doc 四根不动', () => { /* 断言 */ });
  it('MIME：confirm 嗅探→HTML/SVG/PE 拒+删对象+计数；**伪报 audio 的图片按 sniffed 重算 pending**（red：永 skipped）；presign Content-Type 条件（red：不进 fields 全 403）', async () => { /* 真 S3 */ });
  it('media content 两态：ready=Range/206（**视频可拖动——red：mediabunny UrlSource 顺序退化**）/HEAD/ETag/304；processing=allowlist 代理+超限降级；**SSRF 拒（私网 IP/重定向/超限断）**；生产 MinIO 直链禁用', async () => { /* 真 S3 */ });
  it('BigInt：size BigInt 后 **storage-quota agg 算术/media-batch spread/material list 四读路径可 JSON.stringify（red：TypeError 复现）**', () => { /* 断言 */ });
  it('/flowai 面迁移：mediaContentUrl(fileId) 单点+census 零改写正则（red：24 处现状）；ImageItem 无 url 键', () => { /* 断言 */ });
  it('快照 join：RawNode.natural{width,height} 注入+FilteredNode 显式（公开 payload：natural 在/mediaId·probe 域不在）', () => { /* 断言 */ });
});
```

- [ ] **Step 2: 实现**→**Step 3: 绿+Commit**（`feat(shared+api): outbox at-least-once+MIME 全链+读 ACL 单门+两态代理（ADR-1/G42/M2 v10）`）。

### Task 6: execSeq 链路+ArtifactCommit/MediaRegistration（shared module）+InTx 族+窄接口 flush+R3 reconcile+materialize

**Files:**
- Modify: **canvas-doc-manifest.ts（P0 前置：EXEC_STATUS_KEYS/ExecStatusPatch+execSeq: string+键集单源两集合——SERVER_WRITABLE_DATA_KEYS 含 content/CLIENT_FORBIDDEN_DATA_KEYS 不含 content，四处共用导出常量；旧条目 docSchema v3 拒载不兜底）**
- Modify: generation-intent.service.ts（**execSeq nextval 两处〔new claim/rearm〕——execSeq 由 claim 返回值进程内贯穿（job data 不带——controller:68 enqueue 无 claim）**+**providerTaskId submit 后落库**+rearm 事务〔nextval+**voidInTx 只释放旧冻结（re-reserve 废止）**+旧 DocDelivery superseded〕+completeInTx+**fail/touchHeartbeat/reanchorDeadline 补 execSeq 维度**）+team-credit.service.ts（**settleInTx/voidInTx**+reserve 写 reservedExecSeq+settle/void CAS 匹配）+execution.service.ts（撤自行 settle/complete/交付——producer 迁移；**同 job 重入三态**：心跳新鲜 skip/过期接管/未知可重试）+ai-image-edit/lighting/trim processor 迁移
- Create: **shared artifact-core module**（AppModule+WorkerModule 双 import）：artifact-commit.service.ts（**stage 事务外**〔SafeRemoteFetch 下载→对象存储 content-addressed key→**服务端自算 sha256**→sniff——失败零 DB 变更，temp orphan 由 sweep 清〕+**finalize 短事务 <50ms**〔lockBalance→intent FOR UPDATE 重验→幂等前置〔intent 行状态判据〕→registerInTx→CAS→settleInTx；事务内禁外部 IO〕+**40P01/40001/55P03/P2024 重试**+**quota 软限+claim 前预检**）+media-registration.service.ts（**prepareUploadInTx〔补 projectId 落库〕**/registerInTx/confirmInTx〔pending CAS〕/bindInTx 四形态）+**双 role DI 测试**（API+worker 容器均可解析）
- Modify: collab-document.service.ts（**exec 守卫 execSeq 化**——compareExecSeq 单源 BigInt 比较+reason-aware；deliverArtifact 复合 op 前置判定+**expectedValue CAS**〔用户 replace 竞态——replaceMedia 递增期望值〕）+collab-doc-ops（同值 no-op deep-equal）
- Modify: collab-persistence.service.ts+collab-residency.service.ts（**flushDocument 窄接口三态**〔'persisted'|'not-persisted'|'terminal'——ephemeral flush+isPersistedComplete；spoolDeadline 1h〕——**五态判别联合降后续硬化卡**；维护门 503）
- Create: delivery-outbox.poller.ts（**单一 DocDelivery poller**：认领+批量 apply+一次 flush〔窄接口三态〕+复核〔execSeq/expectedValue/节点〕+mark 后 lazy GET media-facts+exec error reconcile〔execProjectedExecSeq+活跃项目+24h〕+onModuleDestroy）
- Modify: worker MaterializeJob（**ai-download 迁移改造**：video processing→completed；幂等键=mediaId；自有 lease/attempts；**不写 doc**；终态失败→幂等补偿退款+artifactState=failed+告警）
- Modify: intent-reconcile.service.ts（**R3 自动收敛**：所有入口走 finalizeFromExistingArtifact〔CAS+补建缺行〕+动作表+审计行 reconcile_action+auto_converged/manual_required 分计数+pg_advisory_xact_lock；**三后门删除**〔直接改 status 路径全灭〕；**backfillSucceeded 禁写 SUCCEEDED+null**；cleanTerminalIntents 交付终态门+resultText 90d+**保留矩阵**〔有 artifact 的 intent 不物理删〕）
- Test: 全 spec（**真 PG 并发**）

- [ ] **Step 1: census**。
- [ ] **Step 2: 先红（G44/G48/G58）**

```ts
describe('ADR-3/6 execSeq+finalize+flush+materialize+R3（G44/G48/G58 v10）', () => {
  it('**manifest 前置**：writeExecStatus 携 execSeq 过 EXEC_STATUS_KEYS（red：现状 manifest:90 无该键——UNKNOWN_KEY 拒写=代际围栏门口死）；旧条目无 execSeq→docSchema v3 拒载；**compareExecSeq property test（2^53 边界/前后导零/非法值 drop）**', async () => { /* 断言 */ });
  it('execSeq 代际：**同 job 双 worker 三态**——心跳新鲜→skip∧旧 worker finalize 照常交付；**过期→接管（新 execSeq fence 旧代+旧 DocDelivery superseded）**；未知→可重试错误（red：「skipped 后成功 ack」→reaper backfillSucceeded 谎言链复现 intent-reconcile:163/:224）；**新 intent 新代不被旧 done 挡**（red：反例 B 现存 bug）；旧 error 不覆盖新 loading；**fail/touchHeartbeat/reanchorDeadline 旧 execSeq 0 命中 no-op**；**job data 无 execSeq（DB 唯一权威）**', async () => { /* 真 PG 并发 */ });
  it('rearm：execSeq nextval+**voidInTx 只释放旧冻结**（red：v9「release+re-reserve」下新 worker reserve mayCall:false 静默跳过外呼复现——team-credit:105）；**providerTaskId 落库+query-first**（kill worker after submit→重跑**零重复 provider submit**——red：现状零写库点）+Idempotency-Key', async () => { /* 真 PG+真 BullMQ */ });
  it('finalize 锁序：**并发 reaper+finalize 死锁注入——零 40P01/55P03 或 3 次重试收敛**；lockBalance 先于 intent（契约 20）；**finalize 事务注入 100ms sleep——锁等待/池不恶化**；**stage 失败零扣费零 Media（temp orphan 由 sweep 清）**', async () => { /* 真 PG 并发 */ });
  it('finalize 幂等：**判据=intent 行状态**（SUCCEEDED∧stored∧settled→幂等返回+补建缺行；red：仅查 Media 存在把半状态当已完成）；**服务端自算 sha256 校验（不同字节拒——x-amz-meta 客户端可控不可当凭据）**', async () => { /* 断言 */ });
  it('资金矩阵：settle 失败整体回滚（零 Media 零 delivered）；多产物一次事务 N Media 整组；**shared module 双 role DI（API+worker 容器解析——red：worker DI 图不可解析 P0 复发）**', async () => { /* 矩阵 */ });
  it('**video=Media(processing)+fileId**：finalize 后 doc 只有 fileId（**grep doc data 无 videoUrl/resultUrl**）+Media status=processing+**processing 期可播可 seek（content 两态）**；materialize 完成后 fact 到达+status=completed；**materialize 幂等重试不重复 Media（幂等键=mediaId）**；**源过期→410/重试；终态失败→幂等补偿退款+artifactState=failed+告警（不落人工）**；**materialize 重试预算与 intent attempts/rearm 解耦（存储抖动不污染执行状态机）**；text=零 Media（kind=text 携 resultText）；**quota claim 前预检+软限**（超限告警+计数不回滚——registerInTx 禁调 assertOnConfirm）', async () => { /* 断言 */ });
  it('flush：**四崩溃窗**（apply 前/flush 前/flush 后 mark 前/mark 后 emit 前）全收敛；**载体=窄接口三态（ephemeral flush+isPersistedComplete——red：boolean 下 not-persisted 被当 failed 耗 attempts）**；**not-persisted 继续重试不耗 maxAttempts（spoolDeadline 1h 超时转 failed+告警）**；批量一次 flush；flush 后复核（execSeq/expectedValue/节点）→superseded/orphaned/delivered', async () => { /* 断言 */ });
  it('deliverArtifact 前置判定在 data patch 前（stale/execSeq/expected 全过才写——red：先 data 后 exec 的 partial 复现）；**用户 replace vs delivery 双向时序**：在飞→用户 replace→delivery 到达→**superseded 不覆盖用户值（red：applyWriteNodeDataToDoc 无条件 set 复现 document:286）**；反向 replace 覆盖成功', async () => { /* 真 PG+真 doc */ });
  it('**R3 五窗收敛**：settle 后崩溃/Media 后崩溃/delivery 缺失/node 删除/源过期——**一轮 reconcile 全收敛+双 settle 零+双 refund 零+审计行**；并发双 reconcile 恰一次（advisory lock）；**歧义态（FAILED∧artifact 存在）不自动动钱→告警**；三后门 grep 零命中+**backfillSucceeded 禁写 SUCCEEDED+null**', async () => { /* 真 PG */ });
  it('exec 投影：loading/skipped worker strict（exec-only+execSeq）；error=DB→API reconcile（execProjectedExecSeq≠当前+活跃项目+24h 窗）；alignExecFromIntents 重建', async () => { /* 断言 */ });
  it('text：resultText 落库=物化；data.result≤32KB；intent/:id/result 入口；**resultText 非空行 cleanTerminal 延长 90d**（red：7 天删行全文丢失）', async () => { /* 断言 */ });
});
```

- [ ] **Step 3: 实现**→**Step 4: 绿+Commit**（`feat(exec+collab): execSeq+shared artifact-core+窄接口 flush+materialize+R3（ADR-3/6 v10/G44/G48/G58）`）。

### Task 7: probe 单相（分型批/lease+sniffed 路由+40MP）

**Files:** media-probe.poller.ts（worker）+九处 create 面+sweep+media-process（server natural 同事务 done+**factVersion+outbox 插入**）
- [ ] 先红（G23/M1）：claim（**图片批 4 lease 180s/视频 batch 1 lease 5min**——red：批 2×90s 覆盖不了下载+ffprobe 复现；sniffed 路由+deletedAt+SKIP LOCKED）/nextProbeAt jitter/skipped 触发点/server natural done+outbox/sharp 40MP+downscale（产品策略 UX）/EXIF 5-8/ffprobe 沙箱（**spawn 数组+timeout+protocol_whitelist——trim/separate/thumbnail 同改**）/零 doc 写→绿+Commit。

### Task 8: 两编排器 producer 接线+MaterializeJob+binding 惰性 reconcile+fileId 命令

**Files:**
- Modify: **资金五路径**（execution text/image/video+ai-image-edit+lighting——producer 只调 ArtifactCommit〔video=processing+fileId〕）+**非资金路径**（upload confirm/stitch/trim/separate/export——调 MediaRegistration+bindInTx；**job data 带 registrationKey**；**需写 doc 者并入 DocDelivery kind=fileId 无资金字段——逐点 grep 实证**）
- Modify: **9 处 media.create grep census 映射**（storage:37→prepareUploadInTx〔**补 projectId 落库**〕/media-process:194→register/ai-download:100→**MaterializeJob 接管**/ai-image-edit:199→register/lighting:167→register/video-trim:110→register/stitch:97→register/generated-media:54→register/video-work:91→prepareUploadInTx）
- Create: media-delivery/binding-reconcile.service.ts（**mediaRefsOf 七键扫描+teamId 校验+幂等 upsert〔清锚+attachState=attached+targetItemId sentinel〕——post-apply guard 联动+周期扫描**）
- Modify: collab-media.controller.ts（**replaceMedia 显式命令〔带 expectedValue〕**+同 team）
- Test: delivery/materialize/binding-reconcile/controller spec

- [ ] **Step 1: 先红（G43/G46/G51）**

```ts
describe('ADR-7 两编排器+materialize+binding reconcile（G43/G46/G51 v10）', () => {
  it('**MediaRegistrationService=唯一 media.create 点**（grep 全仓 media.create 零第二处〔**排除 seed/test**〕——red：现状 9 处直建复现）；资金五走 ArtifactCommit〔video=Media(processing)+fileId〕/非资金走 MediaRegistration 四形态（不碰 settle/complete/DocDelivery/exec——red：无 intent 空指针复现）；**prepareUploadInTx 落 projectId（red：storage:38-50 现状缺失）**；**confirmInTx 并发双 confirm 恰一 completed 一 no-op（red：storage:69-99 无守卫复现）**', async () => { /* grep+真 PG 矩阵 */ });
  it('非资金幂等：registrationKey（taskId+index|mediaId|exportRequestId）重试不重复建 Media/binding；@@unique(bucket,key)；**MediaFactOutbox @@unique(mediaId,projectId,factVersion) 并发同版本零重行**；**targetItemId sentinel——同键双行必失败（red：PG NULL 不去重现测）**', async () => { /* 真 PG */ });
  it('**MaterializeJob**：幂等键=mediaId（kill 后重跑不重复 Media/不重复下载对象）；**processing→completed 单事务（size+sniffedMimeType+probeState+factVersion+outbox）**；**不写 doc（red：ai-download:118 现状写 fileId+resultUrl 复现）**；终态失败→补偿退款', async () => { /* 断言 */ });
  it('**copy 保留 fileId 立即渲染**（新建路径零 strip——red：v9 无条件 strip 副本空图复现）+normalizeCopiedNodeData（loading→idle/done——red：copyPlan:63 连 loading 复制=永久转圈）；**binding 惰性 reconcile**（mediaRefsOf 扫描建行恰一次——重试幂等；跨 team 拒+计数不建 binding；**Media GC doc 引用/grace 护栏——副本在媒体不删**）', async () => { /* 断言 */ });
  it('replace=显式命令（带 expectedValue——非空替换必经此门）；同 team；七键 mediaRefsOf', async () => { /* 断言 */ });
});
```

- [ ] **Step 2: 实现**→**Step 3: 绿+AI 全链冒烟+Commit**。

### Task 9: web 禁写（更新路径 strip/新建保留）+服务端 manifest 拒写+端点白名单+meta 硬删

**Files:** canvasIntents（**stripServerOwnedData 单点——只挂更新路径：updateNodeData/updateConfig diff/undo 回放剥 CLIENT_FORBIDDEN_DATA_KEYS；新建路径（addNode/copyPlan/paste/explode/addImageToStoryboardCell）保留 fileId/images[].id**）+nodeStore（updateConfig 显式键）+**canvas-doc-manifest.ts（writeNodeData 拒客户端禁写键——仅 linkMedia/deliverArtifact 复合 op 可写；键集单源两集合四处共用）**+collab-write.controller.ts（**op 白名单：worker 仅 writeExecStatus loading/skipped**）+**guard 前置：meta.schemaVersion 硬删（shadow 也删）+计数+重连**

- [ ] 先红（直发身份键零写/**diff 跨远端 apply 窗口服务端键被当"变化"发回（red：canvasIntents:502 全键差异复现）→更新路径 strip**/**新建路径保留 fileId（red：v9 全构造点 strip 副本空图）**/updateConfig 不回送/**服务端 writeNodeData 携 fileId→UNKNOWN_KEY 拒**〔red：现状白名单内可写〕/**worker 端点 writeNodeData→拒**/**客户端发 meta.schemaVersion=2→硬删+重连（red：现状可写→ensureSchemaVersion throw→项目 brick）**）→绿+Commit。

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
### Task 17: **normalizeCopiedNodeData 五路径+copy 保留 fileId（v10 裁决 3 方案二+）**
- **normalizeCopiedNodeData 单函数**（copyPlan/seed/clone 五路径共用）收窄：status loading/error→**有 fileId 则 done 无则 idle**（red：copyPlan:63 structuredClone 连 loading 复制=副本永久转圈）/清 errorCode/error/删 ImageItem.url/**保留 fileId/images[].id（新建路径不 strip——副本立即渲染无空图窗口）**/exec 永不复制/cells 删（remap 删）。
- **binding=服务端惰性 reconcile**（T8 binding-reconcile.service：mediaRefsOf 扫描+teamId 校验+幂等 upsert 清锚〔sourceIntentRowId/sourceExecSeq 置空+attachState=attached〕——零客户端调用零新端点，离线 paste 天然覆盖，跨项目同 team 自然成立）。
- **跨 team paste=客户端 strip 身份引用**+服务端不建 binding+读 ACL 403 兜底；**Media GC doc 引用/grace 护栏**。
- [ ] 先红（copy loading 节点→副本 idle/复制完成图节点→副本立即显示 fileId 保留/binding 惰性建行恰一次/exec 不复制/跨 team paste 无 fileId）→绿+Commit。
### Task 18: 空间 tie-break+doc-shape-invalid——维持 v7。

**片 A1 出口**：维持 v7 判据+呈报。

---

## 片 A2：序域执行（T19-T21）

### Task 19: soft/hard+on-demand repair=**in-place renumber 主路径**+病理档

**Files:**
- Create: collab-pathology.ts+collab-maintenance.service.ts（soft 计数+病理档+**repair 执行体=in-place**：维护互斥〔CollabMaintenance 行+共享 vacuumGate〕→applyWriteFreeze('repair')〔不 close/不 reload/不清 IDB/不跳 generation〕+新连接只读+DocDelivery 维护门 503→writesSettled→纯函数修复计划〔受影响层 (oldOrder,id)+带间隙新键+去重〕→**withSession(write, MAINTENANCE_TRANSACT_ORIGIN) 分块 ≤64KB**→回读校验→解除 readOnly+RepairRun 审计；**帧预算预演**〔scratch doc encodeStateAsUpdate——超 256KiB 或不可表达结构退 vacuum 兜底〕）
- Modify: collab-shrink.service.ts（**vacuum 兜底仅限「确定无离线客户端」运维窗**——无 generation 握手不得自动回退〔握手归 Y2〕；vacuum 路径等价断言补 exec 值比较〔vacuumEquivalent 现状只比键集合 registry:655-663 勘误〕）+collab-residency.service.ts（**维护门 assertMaintenanceFree 覆盖 withSession/withDoc 全写路径**——DocDelivery 消费者维护窗 503 退避）+MAINTENANCE origin
- Modify: **web purgePidCaches 修复**（local-cache-key+runtime——**仅 vacuum 兜底路径关联**：generation jump 清同 pid 全部代+**真 IDB 测试断言实际删除集合**〔red：现状保留脏旧代复现〕）
- Create/Modify: collab-media.controller.ts（repair 端点——小文档同步 200/大文档 202+jobId+单飞+OWNER/ADMIN）
- Test: collab-pathology.spec.ts

- [ ] **Step 1: 先红（G45/G53）**

```ts
describe('ADR-5 v10 repair=in-place（G45/G53）', () => {
  it('repair 执行体：维护互斥（**repair 进行中 vacuum→409/反之**）→applyWriteFreeze+维护门 503+writesSettled→分块 ≤64KB 写入→回读校验（**等价断言=忽略 order|slot 的节点/边/data/exec 值等价——非 order/slot 键零变化**）→解除 readOnly；**幂等可重跑（崩溃→maintenance 行 stale→aborted→重跑收敛）**', async () => { /* 断言 */ });
  it('**零断线零 reload**：10k 重复 order→in-place 修复——**全部客户端连接保持、零 reload、零 IDB purge、undo 保留**（red：v9 vacuum 全套断线 reload 复现）；**离线客户端事后合并零节点复活**（red：preVacuumSv 放行新 clientID 复现 registry:689-697——in-place 后该面不存在）', async () => { /* 真双端 */ });
  it('**维护门全覆盖**：repair 窗口 DocDelivery 消费者 writeNodeData→503 退避不 mark（red：维护窗内交付被 repair 窗口写竞争复现）；**并发客户端在 repair 窗口移动节点→无 500 无损坏、读侧 (order,id) 稳定**', async () => { /* 断言 */ });
  it('**超预算回退 vacuum**：构造超 256KiB 更新→自动/显式退 vacuum 兜底→旧客户端 4410+一次 reload+**purgePidCaches 全代清（真 IDB 断言——red：现状保留脏旧代复现）**', async () => { /* 断言 */ });
  it('soft/hard/dup/病理档维持（key-too-long→repair 仍触发 in-place）', async () => { /* 断言 */ });
});
```

- [ ] **Step 2: 实现**→**Step 3: 绿+双端演练+Commit**（`feat(collab): repair=in-place+维护门+vacuum 兜底运维窗限定（ADR-5 v10/G45/G53）`）。

### Task 20: guard——spike（exec+身份键+meta 域）→shadow 定档+post-apply 检测+读 ACL
**Files:** collab-content-guard.ts+scripts/c0a-guard-exec-spike.mjs+collab-doc-registry:677
- [ ] spike（exec 伪造+身份键直写+**meta.schemaVersion 篡改**检测）→**shadow 定档（检测+计数+诊断事件+修复——不承诺拦住）**→post-apply 恒做（afterTransaction 队列+修复+诊断）+**meta.* 硬删例外（shadow 也删+重连）**+**server/maintenance origin 零误报**+guard-contract.spec+Commit。验收口径：**检测到+可修复+读侧拒绝**（editor 伪造 fileId→写入成功〔shadow〕→读 403→guard 计数→修复恢复/删除；伪造他队 mediaId→403 不泄漏；viewer 直发 update→协议 readOnly 拒）。

### Task 21: repair CLI（placement/slot/dup/binding——经维护租约；**默认 in-place，--vacuum 仅紧急**）
- [ ] 先红（四形态+环+duplicateLayers+binding 缺失+in-place 默认）→绿+Commit。

---

## 片 A3：收敛 harness（T22）

### Task 22: 五件套+双端真连+故障注入（v10 矩阵）

**Files:** web node config+fixtures+api collab-harness/provider-convergence.e2e-spec.ts

- [ ] 先红：五件套（slot 派生档）/双端收敛/G17 改口档/分镜并发零成员丢失/等值邻居/重复键层 repair（in-place）/双端避让/真连+分区重启/**DocDelivery flush 四窗**/**execSeq 代际矩阵（同 job 双 worker 三态：心跳新鲜 skip∧旧 worker 交付/过期接管 fence/未知重试）**/**exec alignExecFromIntents 重建**/**in-place repair（10k 修复零断线零 reload+离线客户端事后合并零复活+repair vs vacuum 409+维护窗 503+崩溃重跑+超预算回退 vacuum+旧 IDB 全代清）**/**outbox 乱序提交+重复投递幂等**/**video materialize 矩阵（processing 期可播 seek/下载失败重试/进程崩溃 resume/URL 过期→410/终态失败→补偿退款）**/**copy 保留 fileId 立即渲染+binding 惰性 reconcile+跨 team paste strip**/**R3 五窗收敛**/**guard 检测→修复→ACL 拒绝链路**/**pendingFacts 消费**/reset 联动。
- [ ] 绿+Commit（`feat(web+api): A3 harness（G12/G17/G45/G46/G53/G55/G58 v10）`）。

---

## 片 B1-B2（T23-T27，维持 v7 口径）

### Task 23: DocShapeInvalidError+enterDocInvalid 收窄——维持 v7。
### Task 24: resync 分流+write-rejected 节流（repair UX=generation 单链）——维持 v7。
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

## 验收门禁（v10 汇总——判据随 spec v13 §5 权威表）

**保留**：G1-G15/G17（改口）/G18-G20/G22/G47/G54/G55/G56/G57（v10 口径）。

| 门 | v10 增强点 |
|---|---|
| G42 | **MediaFactOutbox（乱序提交必达/重复投递幂等〔factVersion 去重——零回放断言废止〕/correction 必达/惰性 reconcile 补发/读 ACL 单门 IDOR 拒/@@unique 零重行）+pendingFacts 消费+mark 后 lazy GET+published retention** |
| G43 | **两编排器**（MediaRegistration=唯一 media.create 点 **grep census 零第二处〔9 处非 11——排除 seed/test〕**+**prepareUploadInTx 补 projectId+confirmInTx pending CAS**；**video=Media(processing)+fileId；text 零 Media**；非资金不碰资金域；registrationKey 幂等；**shared module 双 role DI**） |
| G44 | deliverArtifact **前置判定在 data patch 前**+execSeq reason-aware+deep-equal no-op+**expectedValue CAS（用户 replace 竞态双向时序）** |
| G46 | **copy 保留 fileId 立即渲染（新建路径零 strip）+normalizeCopiedNodeData+binding 惰性 reconcile（幂等一次/跨 team 拒）+Media GC 护栏+targetItemId 非空 sentinel（NULL 双行必失败）** |
| G48 | **execSeq 三态重入（心跳新鲜 skip∧旧 worker 交付/过期接管 fence/未知重试——禁 skip 后 ack）+EXEC_STATUS_KEYS+compareExecSeq 单源 property test+锁序死锁注入零 40P01/55P03+finalize 100ms sleep 注入+stage 失败零扣费+幂等前置（intent 行状态判据）+rearm=voidInTx 只释放（v9 文本矛盾根修）+providerTaskId 落库+query-first（kill 后零重复 submit）+Idempotency-Key+video materialize 矩阵+quota claim 预检+fail/touch/reanchor 旧代 no-op+R3 五窗收敛（双 settle 零双 refund 零+审计行）+backfillSucceeded 禁写 SUCCEEDED+null** |
| G23/M1 | 分型批/lease+sniffed 路由+jitter+40MP+**ffmpeg spawn 数组+timeout（trim/separate/thumbnail 同改）** |
| M2 | **media content 两态（ready Range/206 视频可拖动+processing allowlist 代理降级）+MinIO 直链禁用+读 ACL 单门（跨项目 403/公开页按 workId）+sharp 重编码+size BigInt+BigInt toJSON 四读路径+/flowai 面迁移（mediaContentUrl 单点+census）+SSRF 用例+CI 真 S3** |
| G53 | **repair=in-place**（零断线零 reload 零 IDB purge+离线客户端事后合并零复活/维护门 503/崩溃重跑幂等/等价断言〔忽略 order\|slot+exec 值〕/超预算回退 vacuum+4410+purgePidCaches 全代清〔仅 vacuum 路径〕/repair vs vacuum 409） |
| G58 | **flush 四窗全收敛+载体=窄接口三态（ephemeral flush+isPersistedComplete）+not-persisted 不耗 maxAttempts（spoolDeadline 1h）+批量一次 flush+flush 后复核（用户 replace superseded 不覆盖）**——mark delivered 撒谎根修 |

---

## 自检（plan v10——writing-plans Self-Review）

**v10 六裁决落位**：①video=Media(processing)+fileId=T3（status/sourceUrl/materialize 族）+T6（finalize 建行+kind 分支）+T8（MaterializeJob）+T5（content 两态）+T22（materialize 矩阵）；②repair=in-place=T19（维护门+分块+帧预算+vacuum 运维窗限定）+T21（CLI 默认 in-place）+T22（零断线/离线合并）；③copy 方案二+=T9（strip 更新/新建两路）+T17（保留 fileId+normalize 收窄）+T8（binding 惰性 reconcile+MaterializeJob+9 处 census）+**attach consumer 取消**；④reconcile=R3=T6（finalizeFromExistingArtifact+动作表+审计+advisory lock）+T22（五窗）；⑤guard 检测口径+读 ACL 单门=T20（shadow 定档+meta 硬删例外）+T5（assertMediaReadable）+T9（键集单源）；⑥R2 登记 Y2+双 bump 保留=T28（runbook+双 bump 维持）。

**四分叉裁定落位**：video settle=provider 成功即 settle（T6 kind 分支——materialize 与 intent 解耦）；双 bump 保留（T28）；copy binding=服务端惰性 reconcile（T8/T17）；**StoreOutcome 窄接口先行**（T6——ephemeral flush+isPersistedComplete 三态+spoolDeadline；五态降后续硬化卡）。

**残余 P0 十三条落位**：①rearm 只释放+②execSeq 进程内贯穿/三态重入+③providerTaskId 落库+query-first+Idempotency-Key+shared module 双 role=T6；④读 ACL 单门+presign projectId=T5/T8；⑤rebuild runbook+BigInt toJSON+CI S3=T0/T5/T28；⑥targetItemId sentinel=T3；⑦meta 硬保护+键集单源=T9/T20；⑧confirmInTx CAS=T5/T8；⑨expectedValue CAS=T6；⑩DOC_NODE_KEYS 契约表+compareExecSeq=T3/T6/A1；⑪outbox at-least-once=T5；⑫SafeRemoteFetch=T5；⑬file-type 16.x/自研=T0/T5。

**五面闭环**：生产端（T6/T8 两编排器+MaterializeJob）/交付端（T6 窄接口 flush+T5 outbox）/消费端（T5+T9 strip 更新路+T10 pendingFacts+T26）/生命周期端（T17+T28 六表+text 90d+**保留矩阵**）/崩溃端（T6 锁序/幂等/四窗+R3 五窗+T19 维护门+T22 注入）。

**v9→v10 实质差异（执行者勿混用）**：①**video=Media(processing)+fileId**（推翻 v9 裁决② videoUrl 即时交付——targetField 词表删 videoUrl/resultUrl+DocDelivery kind 收敛 fileId|text+统一不变量一条）；②**repair=in-place**（推翻 v9 裁决① generation 跳变——零断线零 reload+vacuum 仅运维窗兜底）；③**strip 分更新/新建两路**（推翻 v9「无条件挂全构造点」——新建保留 fileId）；④**attach consumer 取消+单一 DocDelivery poller+binding 惰性 reconcile**（推翻 v9 copy 清锚/attach 交付链）；⑤**reconcile=R3 自动收敛**（推翻 v9「告警人工」）；⑥**guard=检测/诊断+读 ACL 单门+meta 硬删**（推翻「拦住」口径）；⑦**StoreOutcome 窄接口先行**（推翻 v9 P0 五态前置）；⑧rearm 只释放（推翻 v9 release+re-reserve）；⑨execSeq 进程内贯穿+同 job 重入三态（推翻 v9 复用+静默 skip）；⑩providerTaskId 落库+query-first+shared artifact-core module 双 role；⑪9 处 grep census（推翻 11 处清单）+prepareUploadInTx 补 projectId+confirmInTx CAS；⑫targetItemId 非空 sentinel；⑬outbox at-least-once；⑭quota claim 前预检；⑮SafeRemoteFetch+BigInt toJSON+/flowai 24 处面+CI S3+rebuild runbook。

**执行期语义定位点（已实证——v10 复核）**：同 jobId 重入不递增 attempts（generation-intent:130/:158）+rearm:183+新行=1（schema:1004）；BullMQ 同 jobId（processor:40）；exec 守卫只比 attempts（document:313-331——反例 B 现存 bug）；reserve mayCall:false（team-credit:105-108+execution:325——**v10：rearm 内 re-reserve 后新 worker 同样触发= v9 文本矛盾实证**）；契约 20（credit-ledger:58+team-credit:90/:156/:186/:235）；complete 根 prisma:255+settle 自开:132；后门（reconcile:163/:215/:224-227——**v10：backfillSucceeded 无条件置 SUCCEEDED+null 谎言链**）；四路径零 intent（stitch:97/trim:110/generated-media:54/confirmUpload）+ExecutionJobData.intentRowId 死代码:272；withSession 零 flush（residency:459-468）；vacuum 全套（registry:564-581/repo:180-210/registry:679-698/runtime:594-601）；**preVacuumSv 只拒已知 clientID（registry:689-697+quota-gate.spec:497——未同步离线客户端放行=v9 裁决①推翻依据）**；doc-status 去重（registry:965-977+runtime:1450-1470）；URL 只 csv/cb（runtime:1572）；purgeForeignCaches 反语义（local-cache-key:71+cache.spec:100-113）；worker 端点白名单内含 fileId（write.controller:32+manifest:83）；生产上传 /flowai 渗透（mediaUploadUtils:31——**web 全仓 24 处/15 文件**）；Media.size Int（schema:279）+**Media.status String（schema:287——加 processing 无 enum 成本）**；仓内零嗅探库+**file-type 未装（pin 16.x 或自研）**；UI 按 ImageItem.id 现算（MultiImageConfigPanel:69/:82）+**渲染本就走 useMediaUrl(fileId)（ImageGenNode:70/VideoGenNode:51——videoUrl/resultUrl 零消费者）**；reconcile 带时间窗+索引（:102-139/:350-352+schema:1025-1027）；EXEC_STATUS_KEYS 无 execSeq+SERVER_NODE_DATA_KEYS 白名单含 content（manifest:83/:90）+**meta.schemaVersion writers 仅文档约定（manifest:105-110——viewer 可 brick）**；addNode 携 data 全量+dataPatch 全键差异（canvasIntents:462/:502）+**updateConfig 终态全量（nodeStore:632-636 注释自认）**；copyPlan:63 structuredClone 连 status 复制；storeDocumentUnlocked boolean 多分支混 false（persistence:235/:283/:287-395/:308-336/:323-328）；assertOnConfirm 删对象+删行（storage-quota:37-49）；touchHeartbeat/reanchor/fail 只守 status（generation-intent:230/:248/:265）；text 零 Media+video videoUrl 先行 Media 后建（execution:480-488/:513-517+ai-download:100——**fileId 字段实为 URL :381**）；vacuumEquivalent 浅比较（registry:655-663）；**9 处 media.create（storage:37/media-process:194/ai-download:100/ai-image-edit:199+200 续行/lighting:167/video-trim:110/stitch:97/generated-media:54/video-work:91）**；**providerTaskId 列在零写库点（schema:1014+api-caller 只返回+generation-intent 只注释）**；**enqueue 无 execSeq（controller:68-78——claim 在 worker）**；**presign create 无 projectId（storage:38-50）+confirmUpload 无事务无 CAS（storage:69-99）**；**applyWriteNodeDataToDoc 无条件 set（document:286-300）**；**HttpCollabWritePort 瞬态返回 written:true（collab-write.port:181-183/:206）**；**生产 API manualRegistration:true 不消费队列（app.module:71——shared module 双 role 依据）**；**ai-download SSRF（axios.get:62 无 host 校验）**。

**与 spec v13 的对齐**：全部 T 卡/门禁与 spec v13 §4/§5 一致；裁决引用=§0.1 v13 口径（⑮⑯⑰⑱⑲⑳㉑㉒㉓+Z1''/Z4''/Z7''/Z11''/Z14''/Z18''-v13 重写）；偏离走 spec §0.4。
