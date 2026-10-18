<!-- doc-status: active -->
# Y1a+Y1b：doc 模型 v3·序与尺寸/只读（B 类合并批设计）

- **立项日**：2026-10-18；**唯一上游依据**：[2026-10-06-canvas-yjs-arch-upgrade-review.md](2026-10-06-canvas-yjs-arch-upgrade-review.md)（master spec v8.3）§0.2 Y1a/Y1b 两行+§0.1 裁决（D5/D4/E68/C7③）。
- **B 类合并立项**（Y1a+Y1b——E6 序域与 C5↔D4 同批硬约束共用）；plan=`../plans/2026-10-18-y1a-y1b-doc-model-order-size.md`（**v5——五轮外审收敛后当前执行版**；T0-T28/9 片）。
- **用户立项三澄清（2026-10-18 一轮）**：①单 spec 单 plan+多段片序（每片出口=用户确认点）；②收敛 harness=内存双端基底+期望序断言+真连集成；③UI 变更面=「可接受变更清单+签字」（§0.2-⑥）。
- **修订链**：
  - v2（二轮）～v7（七轮）：历轮逐钉核验与裁决沿革全文见 git 历史（ee41624f/feeef2a6/816078ca 等）；v7 定稿=四类型链+integer-part 生成器+probe 状态机+in-place 维护窗+guard shadow 默认+reset 九步。
  - **v8（八轮·plan 五轮外审〔v2 评审→v2.1→v3→v4→v5〕+四次用户裁决收口回写——2026-10-18）**：v7 定稿后 plan 迭代五轮外审**推翻 v6/v7 多项冻结裁决**，积压勘误此前由 plan 头注内联承载（双源矛盾窗口五轮），本轮全部回写 spec 恢复单一权威。**七项架构换代**（均一手实证+用户确认）：
    1. **media 一等根 side map**（推翻 §0.2-①「零新 op」+Z1''-v7「natural 入 data」+Z11''-v7 禁写门键域+expectFileId 全 op CAS+strip 四点）：`media` server-only Y.Map 顶层根（与 exec map 同构先例——DOC_TOP_LEVEL_MAPS 四根扩五根）+**`writeMediaFact` op**（writeExecStatus 同构）+`DocProjection={nodes:ProjectedRecord[],edges,mediaFacts:Record<mediaId,MediaFact>}` 统一读出口（readDocProjection 四出口单源）——节点 data 域**零 natural 键**（writeNodeData 携 natural=UNKNOWN_KEY）；`MediaFact{width,height,rotation?,source,probedAt}`——**width/height 一律 display 尺寸**（图片 EXIF 烘焙后 rotation=0/视频按 rotation 交换——rotation 血缘客户端永不使用不二次旋转）。
    2. **probe=DB poller 两相**（推翻 Z7''-v7 BullMQ 链——MediaProbeService.enqueue 收口 7 处/jobId `probe_`/sweeper/队列装配拆分全废止）：poller **probe 相**（DB 条件 claim FOR UPDATE SKIP LOCKED+probeRunId CAS 认领）+**fact 相独立查询**（`factState='pending' ∧ probeState='done'`——不依赖 probe claim）；`MediaBinding` 表=fact outbox（factState/attempts/backoff）。
    3. **delivery outbox 资金闭环**（新增域——v7 无系统资金交付设计）：`DeliveryState enum(pending|delivering|delivered|discarded)`+attempts/lease/CAS——**pending=重试信号非退款信号**（撤回 v4「pending 一律 rollback」：settle-崩溃窗已扣费漏退〔reconcile:351 `reservedCredits:{gt:0}` 查询实证 settle 后行不在结果集〕+applied-崩溃窗误退=双向资损）；**WriteOutcome 四态判别联合**（删 written 字段）消费映射四档；execution complete→settle→**入 outbox**（撤批内即时 receipt）；probeArtifacts 退资金链+resultRef 降观测。
    4. **无自动重排+on-demand repair**（修订 §0.2-②/Z4''-v7）：装载期自动 rebalance 废止（并发 reparent 整层覆盖丢并发意图）+orderEpoch doc meta 废止 → **在线避让**（allocator 候选键已存在→重生成）+soft(24) 告警+hard(128) typed 拒+UX「立即修复」入口+**on-demand repair 端点**（服务端单写者+短 freeze+writesSettled+按层 (oldOrder,id)+分片 <256KB/批+apply 前重读跳过父变更节点+解冻不断连不清 IDB）+load 病理档（reaper）+repair CLI 兜底。
    5. **epoch terminal 门**（换 Z9''-v7 DEPLOY_EPOCH 形态）：deployEpoch **env/Redis 部署层单源**（不进 doc 不进 package.json）经 fetchProjectMeta/CollabSessionMeta 下发；epoch-mismatch 进 TERMINAL_AUTH_REASONS→`safeReload('version')` 强刷（旧 bundle 无新 epoch——「清 IDB 重连」死循环根修）；Redis 读失败 fail-closed+epoch-unavailable 瞬态区分。
    6. **cells 单序源**（推翻 Z17''-v7「双序源镜像同步」）：分镜子 **placement.order 不存**（fillDoc/applyIntent 对 storyboard 子只写 parentId）；orderRecords 对 storyboard parent 按 `data.cells` 槽序输出子节点——第二序源直接消灭（invariant=renderCanvas 子序≡orderRecords 分镜层子序）。
    7. **order 完整写链**（修订 Z12''/Z15''-v7「cs order 派生只读」）：addNode afterId 锚维持+**updateNodeEnvelope 增 order 写路径**（diff 比较 order→`{order}` intent——拖序持久化）+copyPlan/assembleRecords/duplicateNodes/pasteGroupClipboard/mergeStoryboard 副本经 allocatePlacements+reorderCsLayer（命令后 doc 读回重排 cs——读侧重排非 doc 写）。
  - v8 同批收编：guard 改 **Step 0 spike 定档**（spike 通过→浅层 enforce 默认+post-apply 恒做——v7「默认 shadow 零拒帧」废止 Z19''）；yjs/sharp **exact pin 前置 P0-pre 无条件**（T0——不随 guard 档位）；isValidOrderKey 宽松档+guard 拒非 base62/超长；排序单实现收编（nodeOrder.ts/snapshot-filter ensureParentFirst 删除收编进 order-records）；§6 非目标三行翻转（mediaFacts map/order diff 链写链/第七 op 从「留档不采」→本批采纳）。

## 0.1 本批有效裁决（master 内联+本批 Z'' 系）

| 编号 | 裁决 | 效力 |
|------|------|------|
| **D5** | order 仅同 parentId 层内生效；投影数组序=层序遍历（父先子后）+同层 (order,id)；不设跨层全局序；Origin 枚举加第 5 常量 Maintenance（**MAINTENANCE_TRANSACT_ORIGIN**——onUpdateDelta 排除表+persistence 持久化同 SERVER_TRANSACT_ORIGIN 待遇）——**重排出口=on-demand repair 受控端点（§2.4-v8）非装载期自动**；ensureParentOrder 冻结「仅 RF 父先子后契约，禁承担 z 序」 | §2 |
| **D4** | 上传=服务端元数据命令写；生成=落地补一次解码写；视频=受控一次性 bootstrap（判据由 `data.sizeMode` 承载——author 档零写只更新事实、auto 档事实到达后 fit 一次）；维度缺失=合法态+DEFAULT_CHILD_SIZE 兜底；text=持久化作者尺寸；measured 仅节点内部视觉禁入帧派生——**媒体事实真源=Media 表（DB）投影 media map（doc）——Z1''-v8** | §3 |
| **E68** | 读侧全函数（绝不抛）/写侧显式拒绝（业务错误码）/禁修复写回 doc——装载读属读侧（strict 收窄写输入）维持 | §2/§3 |
| **C7①③** | 版本协商拒旧+「排空切换 runbook 进 Y1」（reset §6-v8） | §6 |
| C5/C6/C5↔D4/D13/E6/E8/E15 | 宽高三源/序分层/同批硬约束/门禁先红/键长上限/元数据可取性前置/收敛 harness（维持） | §2/§3 |
| **Z1''（v8 重写）** | **media 一等根+writeMediaFact op**：`media` server-only Y.Map 顶层根（mediaId 键→`MediaFact{width,height,rotation?,source,probedAt}`——同 fileId 单条 fact；**display 尺寸契约**：图片 EXIF 烘焙后 rotation=0/视频按 rotation 交换后宽高；rotation 血缘客户端永不使用）；`writeMediaFact` op（writeExecStatus 同构——manifest DOC_TOP_LEVEL_MAPS/NESTED_TYPE_CREATORS/DOC_KEY_MANIFEST media 行，Record 穷尽编译强制）；**DocProjection 统一读出口**（readDocProjection 四出口单源：readCanvas/readCanvasSnapshotCached/shrink exportFresh/web ydocBuilder——join media map→side map）；**快照边界注入**（公开输出带 mediaFacts 不带 doc——snapshot-filter/renderCanvas 零大改；RawNode.natural 注入公开 viewer fit 不 fallback）；v7「零新 op/data.natural 单对象/expectFileId 全 op CAS/strip 四点/SERVER_NODE_DATA_KEYS natural 行」**全废止**——data 域零 natural 键（manifest UNKNOWN_KEY 天然拒）；服务端写序=deliverMedia **binding 先于 doc fileId**（G51）；vacuum/seed/clone media 根复制（Z14''）；web 消费=media.observeDeep+初始全量读+切项目/登出清空（防旧项目 facts 错配） | §3.1 |
| **Z2''（v8 微修）** | **四类型链维持 v7**：`RawNodeRecord`（Y.Map 直出——docShape 内部不导出）→`StoredNodeRecord`（validateNodeRecord 规范化写输入——placement 必填；**storyboard 子 parentId-only 合法档**）→`ProjectedRecord`（diff/seed/读出口——position 可缺+parentId/order 派生；**恒 8 键=7+order，无 placement/natural 字段**）→`CanvasStoreNode`（RF Node 泛型+order 派生）；readCanvas 返回 ProjectedRecord[]（六消费者零改动）**升级为 DocProjection 四出口**（nodes+mediaFacts side map）；三函数读模型维持（strict 只用于写输入/total=装载读+投影热路径+同层合法项后层尾+id tie-break/公开快照 total-ordered）；运行期坏 order=total 落位+计数+close 违规连接；`doc-shape-invalid` reason 档+TERMINAL_AUTH_REASONS+manual-recovery 维持；repair-doc-order CLI 维持；G13 口径维持（新模块零 as+边界 allowlist） | §2.1 |
| **Z3''（维持 v7）** | `DOC_NODE_KEYS=['id','type','placement','position','width','height','data']` 独立三处接线（fillDoc.keys/validateWriteBatch fillDoc+required placement/manifest path）；**NODE_ENVELOPE_KEYS 不动**（投影面锚）；renderCanvas Pass2/ensureParentFirst 恒等断言/checkProjectionInvariant 序断言维持 | §2.3 |
| **Z4''（v8 重写）** | **无自动重排+on-demand repair**：**装载期自动 rebalance 废止**（先算后写不救并发——重排 apply 段与并发 reparent 竞争=整层覆盖丢并发意图；v7 装载 rebalance/purpose gate/backoff/预算门**废止**）；**在线避让**（allocatePlacement 候选键已存在→与下一不同键重生成；连续无 gap→`key-too-long` typed 拒走 repair）——v7「允许重复+读侧确定性」**降级为并发残余**（dup 信号 duplicateLayers 计数→repair 消费）；soft(24) 告警计数零 doc 写+hard(128) typed 拒+UX「立即修复」入口（非用户墙）；**on-demand repair 端点**（`POST /projects/:id/collab/order/repair` OWNER/ADMIN）：`applyWriteFreeze(conn,'maintenance')`（新 FreezeReason——不关连接不卸载）→`writesSettled(pid)`（三态收敛谓词）→受影响层按 (oldOrder,id) 重排——**分片 <256KB/批**（withSession 直写不经上行帧闸）+**apply 前重读+父变更节点跳过**（并发 reparent 不丢）→解冻→**不断连不清 IDB**；幂等（二跑零变更）；预算超限交 CLI；**load 病理档**（maxLen>hard ∧ 无 WS 连接→reaper tick 下个无连接窗——v4「常连项目永不触发」盲区根修，repair 端点为 hard 主出口）；repair CLI 兜底（offline 窗四形态）；MAINTENANCE_TRANSACT_ORIGIN/pendingStructs 跳过维持 | §2.4 |
| **Z5''（v8 改源）** | applyIntrinsicFit=**纯函数维持**——**数据源=mediaFacts side map**（naturalOf(mediaId) 读 side map；判据 side map 键匹配 data.fileId+sizeMode==='auto'——v7「读 data.natural」废止）；**display 尺寸契约**（rotation 永不二次应用——图片 EXIF 5/7/视频 90|270 fit 后宽高正确 G56）；load 时扫描（mediaFacts side map 到达检测+applyDocToStore 后一次 auto 扫描——不在投影读路径内写）；sizeMode 缺省规则（无 sizeMode∧有 wh=author；无∧无=auto）/`data.aspectRatio` 键删除/viewer 纯函数本地派生同值渲染（readOnly 会话 invariant 豁免 wh 比较）/工厂默认 wh=布局兜底/三分类写者（commitIntrinsicFit/commitAuthorSize/commitLayoutSize）/lastAppliedNatural 去重/**multiImage images[].id 每图独立 fact+格子布局**（mediaRefsOf 数据基础）/clamp（maxW/maxH——4K→800）维持 | §3.2 |
| **Z6''（维持 v7）** | 只读命令门（B1a 必做）+dimensions 分表（measured 始终本地/setAttributes resize=用户命令 viewer 拒）+cascade gate 前置+resync 三路（viewer 不自动 discard/终态禁重放）+write-rejected 节流+闩锁保留+断言零 local-origin update 维持 | §3.3 |
| **Z7''（v8 重写）** | **probe=DB poller 两相+MediaBinding fact outbox+deliverMedia 纯 DB**（v7 BullMQ 链全废止——plan v1「enqueue 收口挂 7 处 media.create」换 DB 条件查询结构性覆盖全 8 类）：**Media probe 状态机列**（probeState pending\|running\|done\|failed\|skipped/probeAttempts/probeError/**probeFailureKind** permanent\|transient/probeLeaseUntil/**probeRunId** CAS token/probedAt/naturalWidth/naturalHeight/naturalRotation/**naturalSource** probe\|server/sniffedMimeType）；**probe 相**（`probeState IN(pending, running∧lease 过期) ∧ status='completed' ∧ MIME image/video 非 SVG` FOR UPDATE SKIP LOCKED+probeRunId CAS 认领批 10）；probeability audio/temp/SVG **置 skipped**（防指标污染/repair 误判）；MIME magic bytes 嗅探（sniffedMimeType 落列——serving Content-Type 用）；图片 sharp `.rotate()` display 一次到位（EXIF 1-8 全档 5/7 交换）+limitInputPixels 100M+concurrency(1)（信号量非全局）；视频 ffprobe 15s 超时+SIGKILL+protocol_whitelist file+**启动版本检查**（-version 首行落日志）；**fact 相独立查询**（`factState='pending' ∧ media.probeState='done'` JOIN SKIP LOCKED——**不依赖 probe claim**：probe done 当轮 writeBatch 503→下一 tick 独立重试至 written；v4「fact outbox 无消费者」盲区根修）；fact 相逐 binding writeBatch writeMediaFact→applied 后 CAS factState='written'；retryable→pending+factAttempts++/nextFactAt 退避；permanent→failed+告警；**deliverMedia=纯 DB**（worker 进程安全——HttpCollabWritePort 边界实证五 processor 在 worker 无 collab server）+**写序钉死 binding 先于 doc fileId**（upsert MediaBinding factState=pending→写 doc fileId——崩溃窗只留 pending binding 可收敛）；**producer 七路径矩阵**（worker 五〔AI/ai-download/光照/改图/trim〕+generated-media confirm+客户端 attach——binding 全产生；stitch 无 nodeId :97-110 实证=客户端 attach 档/video-work docBound=false 显式 skip 档）；克隆/exportFresh 复制 binding（按 media 探测态派生 factState——done→pending 交 fact 相）；**attach 端点**（`POST /api/collab/projects/:id/nodes/:nodeId/media`+`:batch`——mediaRefsOf 批量：fileId/trimmedFileId/referenceImage/**images[].id**/allImages[].id〔ImageItem.id 即 media fileId——MultiImageNode:172 实证，只收 Media ID 形态+success/done 项〕；media.teamId===project.teamId ∨ media.userId===user **跨 team 放宽档**；node 存在校验；幂等；running 期 attach→factState=pending→fact 相补扫）；execution fileId 语义修正（不写 provider URL 只写 resultUrl/videoUrl——ai-download 落库后写 fileId=media.id） | §3.1 |
| **Z8''（维持 v7）** | 工厂类型感知（text/image/video/imageExt/multiImage 写默认 wh+sizeMode:'auto'；auto/storyboard 组不写 wh 0 帧键；storyboard 子写网格 wh；audio/videoEdit 片内定）；fallbackSize 单函数+reason 标签+去重计数；happy-path=0 | §3.4 |
| **Z9''（v8 改形）** | 版本双 bump 3 维持+reset runbook 步序（**含 CanvasDocUpdate 清**〔schema:843 无级联实证〕+MediaBinding/Media 生成物+spool/Redis 白名单+MinIO temp）；**DEPLOY_EPOCH 改形**：**env/Redis 部署层单源**（不进 doc 不进 package.json——v7「doc meta+job data 带 epoch」废止）经 fetchProjectMeta/CollabSessionMeta 下发；**epoch-mismatch 进 TERMINAL_AUTH_REASONS**（版本族）→web `safeReload('version')` 强刷（新 build 从 meta 取新 epoch 连接成功——**不做「清 IDB 重连」**：旧 bundle 无新 epoch 死循环根修）；Redis 读失败 **fail-closed** 拒+epoch-unavailable 瞬态区分（不误判永久）；maintenance mode/队列 pause 维持 v7 | §6 |
| **Z10''（维持 v7）** | `collab-doc-ops.ts` 纯函数模块（applyWriteOpsToDoc/applyOpsCore/rejectionsOf/原语——零 Nest import 破环，P0-pre 前置）；校验链表驱动 Record+switch+never+单写面薄包装维持；DocWriteOpSpec 逐键 ValueSpec 维持（writeMediaFact 进表）；`Object.hasOwn` 取代 `opName in` 维持；**WriteOutcome 四态入消费面**（Z18''） | §3.1 |
| **Z11''（v8 改）** | **natural 禁写收口为 web 单点**：canvasIntents 直发 natural patch 零写零上行帧+diff 零 natural intent+复制保 fileId+内容键——v7 SERVER_ONLY_DATA_KEYS natural 键/**strip 四点**废止（natural 不在 data 域——服务端 manifest UNKNOWN_KEY 天然拒）；resultUrl/videoUrl/result/errorCode 客户端禁写维持；content 双写者不禁维持；fileId 客户端可写维持（Y2 缺口登记——偏离表 #3；服务端写序收口=deliverMedia binding 先行 Z7''） | §3.2 |
| **Z12''（v8 改）** | 判别联合（父变更 `{parentId,afterId?}`——null=脱离到根，20+ 处 undefined 删键语义调用点显式迁移）+**唯一分配入口 allocatePlacement/allocatePlacements**（doc 写边界——intent addNode 只带 afterId 锚不带 order 维持）+**updateNodeEnvelope 增 order 写路径**（diff 比较 order→`{order}` intent——**重排命令持久化 G54**；v7「cs order 派生只读不可写」废止——拖序不持久=只读序域缺陷根修）+**在线避让**（Z4''）+37 处调用点迁移（addToGroup/ungroup/dropIntoGroup/dropImageIntoStoryboard/diff parentId 变更/组 resize/attachMember）+reorderCsLayer（命令级——命令后 cs 数组序=doc 层序，读侧重排非 doc 写）；placement 复合单键/order 不可删/copyPlan 副本新键+子层分配/assignSeedOrder/undo 回放原 placement/整对象 set 禁原地 mutate（DEV Object.freeze+census）维持 | §2.5 |
| **Z13''（维持 v7）** | harness 内存双端+投影纯函数抽取+期望序五件套（含 cells 槽序档）+参考模型+真连三条+并发用例（G17——含混键复现反例+**并发 reparent+同锚插入零丢失**） | §2.6 |
| **Z14''（v8 补）** | normalizeForSeed 收编**五路径**（seed/clone/template/exportFresh/vacuum——rebuildVacuumDoc 实为 readRecords→fillDoc registry:629 实证恢复路径不可断）+**media 根复制**（克隆/exportFresh 后 mediaFacts+binding 保留——其余根 deep-copy 保 exec/meta）；DOC_KEY_MANIFEST placement 拆两行维持；MinimalCSNode 派生 order/toDocRecord 签名/buildDocFromSnapshot assignSeedOrder 维持 | §2.5 |
| **Z15''（v8 改）** | cs 面=CanvasStoreNode（order 派生）维持+**order 写链补全**（projectCanvasNodes+order 透传——MinimalCSNode.order?/toDocRecords 透传/diff 比较 order→updateNodeEnvelope{order}/copyPlan/assembleRecords/duplicateNodes/pasteGroupClipboard/mergeStoryboard 副本经 allocatePlacements）；projectIntentToStore placement 派生 order 投影/allocator 时序定死/diff 数据键排除维持 | §2.5 |
| **Z16''（维持 v7）** | multiImage previewSize/renderCanvas·snapshot-filter 恒等断言/fallbackSize 去重/CLIENT_PROTOCOL_VERSION 注释 | §2.3/§3.4 |
| **Z17''（v8 重写）** | **cells 单序源**：分镜子 **placement.order 不存**（fillDoc/applyIntent 对 storyboard 子只写 parentId 不写 order——StoredNodeRecord storyboard 子 parentId-only 合法档）；orderRecords 对 storyboard parent 按 `data.cells` 槽序输出子节点（**不读子节点 placement.order**）；invariant=renderCanvas 子序≡orderRecords 分镜层子序（G55 对拍）——v7「cells 槽序权威+order 镜像同步」**废止**（镜像同步=永久双源漂移维护面，单序源直接消灭第二序源） | §2.3 |
| **Z18''（v8 新）** | **delivery outbox 资金闭环**：GenerationIntent 增 `DeliveryState enum(pending|delivering|delivered|discarded)`+deliveryAttempts+deliveryLeaseUntil+deliveredAt+resultText（text 全文——resultRef 降观测 grep 全仓审计零资金分支残留）；**pending=重试信号非退款信号**——writeBatch 幂等重试到收敛（同值 no-op 契约既有），仅 node-deleted/耗尽/主动 discard 退款；**WriteOutcome 判别联合**（删 written 字段）：`{status:'applied'|'rejected'|'retryable'|'permanent',index,op,code?}`——单写/批写同型；**消费映射四档**（rejected+node-deleted→CAS discarded+退款；rejected 其他→交付失败退款或标错；retryable→有界重试后退款；permanent→退款/补偿+告警非静默）；**outbox 认领 CAS**（pending∨delivering∧lease 过期→CAS 置 delivering+attempts++——并发双跑零双交付）；**崩溃窗三矩阵**（settle 后崩溃→重试交付→节点在=补写/节点删=退款；writeBatch applied 后崩溃→重认领→同值 no-op 幂等→delivered 不误退；认领后崩溃→lease 过期重认领）；execution 主链 complete→settle→**入 outbox**（撤批内即时 receipt）；三 processor+shrink 迁移 isDelivered/isNodeDeleted；**intent-reconcile 新分支**（`creditsConsumed>0 ∧ deliveryState IN(pending,delivering) ∧ completedAt<cutoff`——settle-崩溃窗；settleStranded 既有 reservedCredits>0 分支保留不动）；**probeArtifacts 退资金链**（settleStranded 直读 row.deliveryState——collab 域不增 Prisma DI）；written census 五消费面迁移（ai-download:119/ai-image-edit:233/lighting:215/shrink:146/reconcile:517+stub——生产代码零 written 命中 G44） | §3.1 |
| **Z19''（v8 新）** | **guard=Step 0 spike 定档+post-apply 恒做**：**Step 0 spike（1 天）先行**——真实帧 decodeUpdate+根 map ID 索引成本（10k/264KB p50/p95）+违规帧 close reason+恢复+混合帧可否部分剥离——**结论落盘定档位**；spike 通过→**浅层 enforce 默认**（根白名单+origin+键集；混合帧只拒纯 forbidden 根帧）；不通过→退 post-apply；**post-apply 恒做**（changedParentTypes 反查→media/exec 客户端写检测→**afterTransaction 队列修复**〔勿在 update 回调内嵌套写——重入防线〕+同步删键+诊断 close 非 terminal；replay/load origin 排除）；深度 shadow（C0a 原型引擎）+guard-contract.spec（私有结构形态断言——升级即红）；**yjs 13.6.32/sharp 0.34.5 exact pin 前置 P0-pre（T0 无条件——不随 guard 档位）**；S1=receipt+readOnly+post-apply+enforce（spike 通过才默认）——v7「COLLAB_CONTENT_GUARD 默认 shadow 零拒帧」废止（档位由 spike 数据定非预裁） | §3.6 |

## 0.2 裁决定案（2026-10-18 用户确认；v8 收口更新）

| # | 项 | 定案 |
|---|----|------|
| ① | 零新 op | **v8 废止**——`writeMediaFact` op 采纳（media 一等根——Z1''-v8；v7「server 子 map 登记为 Y2 目标」提前本批落地） |
| ② | 重排出口 | **v8 修订**——**无自动重排+on-demand repair 端点**（在线避让+soft 告警+hard 拒+UX 修复入口；freeze 机制保留为 repair 触发器；v7 装载期 rebalance/orderEpoch doc meta 废止——Z4''-v8） |
| ③ | 片序 | 维持 v7（单列车+P0-pre 前置+B1a 必做——§4 对齐 plan v5 T0-T28） |
| ④ | Y1c schema | 本批固定 **3**；Y1c-2 若入上线批折叠进 3 维持 |
| ⑤ | 键长参数 | **v8 落定**：fractional-indexing integer-part **vendor 库**（license 实测+wrapper）+**soft 24 告警+hard 128 拒**+四曲线硬验收（10k 尾插≤16/头插≤32/随机≤16/**同锚 10k 曲线**——on-demand repair 依据+hard UX 证据；G29） |
| ⑥ | UI 变更面 | v7 清单维持+**hard 128「立即修复」入口**+「层叠顺序随 sibling order」条目 |

**附 D6 维持（v7）**：`data.autoOrigin` 显式非帧键+fallbackOrigin 退役——移 B2（不与 placement 同刀）；空间序 id tie-break 维持 A1。

## 0.4 偏离登记表（滚动——实现与设计的差异单源）

| # | 偏离 | 落地形态与依据 |
|---|------|----------------|
| 1 | **E15 键长上限**（master「≤32」） | 本批=soft 24 告警+hard 128 安全网（§0.2-⑤ v8 参数落定——integer-part 实测后收紧）——表述差异登记，master 目录表回填 |
| 2 | **cellCount**（master Y1b：stitch/trim/separate 载荷） | 不做（零读者）维持 |
| 3 | **fileId 客户端可写**（updateConfig 整包写 data 可覆盖服务端产物引用） | Y2 已知缺口登记维持——v8 服务端写序收口=deliverMedia **binding 先于 fileId**（Z7''-v8）；Y2 投影合成收编 |

## 1. 基线快照（2026-10-18 八轮一手核验；行号=master 96056a52）

### 1.1 序域与投影链

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [nodeOrder.ts:17](../../../apps/web/src/utils/nodeOrder.ts) ensureParentOrder | 拓扑输出（父先子后/环跳过）；setWithParentOrder（groupNodes/ungroup/move 中间 set）也调它——中间态非层序 | D5/Z3''；**v8：收编删除进 order-records（排序单实现）** |
| [canvasCollabRuntime.ts:1870/:1906](../../../apps/web/src/stores/canvasCollabRuntime.ts)+onRemote 50ms timer | applyDocToStore 三调用点均无 try/catch——热路径 throw=白屏/卡水合（实证） | Z2''：enterDocInvalid catch 层 |
| [docShape.ts:138-166](../../../packages/shared/src/canvas/docShape.ts) | 裸迭代序 total 出口 | Z2''：total 维持+严格读新函数 |
| [docShape.ts:264-296](../../../packages/shared/src/canvas/docShape.ts) applyKeySetTable | 逐键显式构造——表外键静默丢（stripAuthorState/种子路径；auto 组 keepPosition=false） | Z3''/G24（D6） |
| [nodeEnvelope.ts:15/:19-26](../../../packages/shared/src/canvas/nodeEnvelope.ts) | **CanvasNodeRecord.position 必填**；NODE_ENVELOPE_KEYS 双向编译锚七键（parentId 非 placement） | Z2''/Z3''：键集不动+四类型 |
| [projectCanvasNodes.ts:29-37](../../../apps/web/src/utils/projectCanvasNodes.ts) | 末尾 `as CanvasNodeRecord` 强转；**7 键显式构造无 order** | Z2''（cast 删）/Z15''-v8（order 写链 G54） |
| [canvasIntents.ts:38-44](../../../apps/web/src/stores/canvasIntents.ts) NodeEnvelopePatch | 恰五键（type/parentId/position/width/height）无 order | Z12''-v8：判别联合+order 写路径 |
| [canvasIntents.ts:173](../../../apps/web/src/stores/canvasIntents.ts) | **moveNode 直读 `m.get('parentId')`**——parentId 直读 census 面（v6 复核） | Z12''：只经 placement 派生+census 门禁 |
| [canvasIntents.ts:462-481](../../../apps/web/src/stores/canvasIntents.ts) diffProjectionToIntents | addNode 无 order；updateNodeEnvelope 只比五键 | Z12''-v8：diff 比较 order（G54） |
| [copyPlan.ts:53-101](../../../packages/shared/src/canvas/copyPlan.ts) | 复制不重分配序 | Z12''：副本新键+子层分配 |
| arrangeSelection:79/geometry:68 | 落格/拼接空间序（四消费点）——**无 id tie-break** | G25（D6 附带） |

### 1.2 尺寸域

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [geometry.ts:301-322](../../../packages/shared/src/canvas/geometry.ts) contentEventSize | 三分支；ratioChanged 需 existingAspectRatio≠null（:310-315「类型谎言」+非空断言） | Z5''：sizeMode+side map 判据取代 |
| reportNodeSize 7 调用点 | 内容事件拟合/错误兜底/resize 卸载/multiImage 派生；真测量链=dispatchFixtureSizeIntents | C5 删除对象 |
| [canvasStore.ts:778-788](../../../apps/web/src/stores/canvasStore.ts) addNodeInner | text 300×300/videoEdit width=320 无 height；image/video/audio 无默认 | Z8'' |
| [docShape.ts:324](../../../packages/shared/src/canvas/docShape.ts) measured 注记 | MinimalCSNode 类型注记 | 删除面 |
| DEFAULT_CHILD_SIZE | 8+ 消费点 | Z8''：单函数+去重 |

### 1.3 只读域

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [canvasUndo.ts:67-105](../../../apps/web/src/stores/canvasUndo.ts) | undo/redo 无 canEdit 门 | Z6'' |
| [nodeStore.ts:524-560/:632](../../../apps/web/src/stores/nodeStore.ts) | addNode/updateNodeData/deleteNode 无门（命令+投影双调用）；**updateConfig 整包写 data** | Z6''/偏离表 #3 |
| [canvasStore.ts:1529-1530/:1648/:1699](../../../apps/web/src/stores/canvasStore.ts) | onNodesChange 无条件 applyNodeChanges+cascade 在 gate 前 | Z6''：dimensions 分表+级联前置 |
| [hocuspocus-server.cjs:295-313](../../../node_modules/.pnpm) | 库层 readOnly 发 SyncStatus(false)（实证） | Z6'' |
| guardSyncFrame（doc-registry:677/:706-746） | 帧闸 1009；readOnly=app 层 return+计数 | §3.6 挂点 |
| [canvasStore.ts:230-234](../../../apps/web/src/stores/canvasStore.ts) diverged 闩锁 | 三出边+boot-diverged 持久恢复 | Z6'' |

### 1.4 服务端写面与产物绑定

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [collab-document.service.ts:215-217](../../../apps/api/src/modules/collab/collab-document.service.ts) | writeNodeData 直连 applyWriteNodeDataToDoc 原语——不经 validateWriteBatch（`{a:1}` written:true 测试背书） | Z10''/G18 |
| [collab-document.service.ts:286-300](../../../apps/api/src/modules/collab/collab-document.service.ts) | 无条件 set（无同值短路）；WriteNodeDataResult 仅 {written,reason} | Z1''-v6 同值 no-op/Z18''-v8 WriteOutcome |
| [collab-doc-writer.service.ts:87-92/:104/:128-135](../../../apps/api/src/modules/collab/collab-doc-writer.service.ts) | WriteOpResult 四字段；applyWriteOpsToDoc 现存（单写面收编载体）；op 级违规→整 op written:false | Z10''/Z18''-v8（四态重写）/G15 |
| [execution.gateway.ts:116-126](../../../apps/api/src/modules/gateway/execution.gateway.ts) | emitStitchStatus 带 wh/cellCount；separate/trim 无 | C0a 8 类矩阵 |
| [canvas-doc-manifest.ts:83/:173-230/:332-417](../../../packages/shared/src/canvas/canvas-doc-manifest.ts) | SERVER_NODE_DATA_KEYS 六键；valueTypes typeof 四型+keyMaxBytes 单值；validateWriteBatch if 链（`opName in` 命中原型链） | Z1''-v8（natural 行出）/Z10''-v6（ValueSpec/Object.hasOwn） |
| [canvas-doc-manifest.ts:14](../../../packages/shared/src/canvas/canvas-doc-manifest.ts) DOC_TOP_LEVEL_MAPS | 现四根（nodes/edges/exec/meta） | Z1''-v8：media 入=五根 |
| readCanvas 消费面 | 单出口六消费者：execution 计费:167/video-project:98/video-work-clone:33/REST:24/探针:259/write port:51 | Z2''-v8：DocProjection 四出口（六消费者零改动） |
| `validateNodeRecord`/`SERVER_ONLY_DATA_KEYS` | 全仓不存在（G1 须列五处调用点） | Z2''-v6/G1 |
| [collab-document.service.ts:265-267](../../../apps/api/src/modules/collab/collab-document.service.ts) | **probeArtifacts 读 data.resultUrl（资金路径）** | Z18''-v8：退资金链（settleStranded 直读 deliveryState） |

### 1.5 版本与装载面

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| docShape:41/collab-protocol:8 | schemaVersion=2/csv=2 | Z9''：双 bump |
| [local-cache-key.ts:24-33](../../../apps/web/src/collab/local-cache-key.ts) | 键含 schemaVersion | Z9'' |
| [collab-doc-registry.service.ts:295/:393/:399](../../../apps/api/src/modules/collab/collab-doc-registry.service.ts) | onUpdateDelta 只排除 SERVER_TRANSACT_ORIGIN；loadDocument replay spool+cheap 上界；docTruth=cheap | §3.6/MAINTENANCE origin |
| [collab-shrink.service.ts:132](../../../apps/api/src/modules/collab/collab-shrink.service.ts) | exportFresh 走 fillDoc | Z14''（normalize 五路径） |
| [schema.prisma:843](../../../apps/api/prisma/schema.prisma) | **CanvasDocUpdate 无级联** | Z9''-v8（reset 显式清表） |

### 1.6-1.8 历史核验行（v5/v6/v7 轮——全文见 git 历史 816078ca 版本 §1.6-§1.8）

v5 轮（beforeSync pre-apply/hook 窗口无帧/presign 只写 userId/teamId/ffprobe 无 rotation）、v6 轮（worker 独立进程三令牌/HttpCollabWritePort 合成 written:true/yjs transact 无回滚/openDirectConnection context 签名/mediaUploadUtils projectId 可选/renderCanvas childrenByParent 迭代序/observeIdleDocs 常驻不重装）、v7 轮（DocNodeRecord 同名 172 处/writer 反向 import 成环/BullMQ 冒号 jobId/ecosystem 双进程/minio 仅 getObject 流/storage.module 无 registerQueue/rebuildVacuumDoc 走 fillDoc/assertNoAutoGroupFrameKeys 冲突/deleteNode 级联两处/generated-media 收客户端宽高/undefined 删键 20+ 调用点/尾插主路径口径）——各轮实证行继续有效，裁决引用以 §0.1 v8 口径为准。

### 1.9 v8 核验行（plan v4/v5 轮外审主张一手复核——2026-10-18）

| 位置 | 事实 | 裁决引用 |
|------|------|----------|
| [intent-reconcile.service.ts:351](../../../apps/api/src/modules/execution/intent-reconcile.service.ts) | settleStranded 查询 `reservedCredits: { gt: 0 }`——**settle 后崩溃行（=0）不在结果集**：已扣费无产物永久漏退 | Z18''-v8（reconcile 新分支——deliveryState 口径） |
| [execution.service.ts:354/:366/:377](../../../apps/api/src/modules/execution/execution.service.ts) | complete→settle→deliver 主链序；:484 `resultRef: text:${...slice(0,100)}` **观测占位**（非全文） | Z18''-v8（resultText 列+resultRef 降观测） |
| [execution.service.ts:381/:516/:542](../../../apps/api/src/modules/execution/execution.service.ts) | **fileId 双语义**：写 provider URL（非 Media.id） | Z7''-v8（fileId 语义修正——只写 resultUrl/videoUrl；ai-download 落库后写 fileId=media.id） |
| [MultiImageNode.tsx:172](../../../apps/web/src/pages/canvas/components/nodes/MultiImageNode.tsx) | `newImages.push({ id: fileId, ... })`——**ImageItem.id 即 media fileId**（无需加列） | Z7''-v8（mediaRefsOf images[].id 键集） |
| [canvas-doc.factory.ts:8](../../../apps/api/src/modules/collab/canvas-doc.factory.ts)+[ydocBuilder.ts](../../../apps/web/src/collab/ydocBuilder.ts) | **createCanvasDoc 真实落点**（api factory+web builder 双点）——docShape.ts 零 yjs | Z1''-v8（media 根建点） |
| [canvasCollabRuntime.ts:1961-1966](../../../apps/web/src/stores/canvasCollabRuntime.ts) | observeDeep **仅挂 nodes/edges/exec**——media 根未挂 | Z1''-v8（media.observeDeep+初始全量读） |
| [canvasCollabRuntime.ts:1464](../../../apps/web/src/stores/canvasCollabRuntime.ts) | writeFrozen **单向闩锁**（解冻不回落） | Z4''-v8（repair freeze 复用+解冻语义） |
| [collab-session-guard.service.ts:753-760](../../../apps/api/src/modules/collab/collab-session-guard.service.ts) | applyWriteFreeze **reason 集合**（'maintenance' 登记可扩展） | Z4''-v8（repair 端点启用） |
| [collab-write.port.ts:203-206/:263](../../../apps/api/src/modules/collab/collab-write.port.ts) | 瞬态耗尽/永久/bad-body **合成 written:true**（防误退款——对 probe fact=静默丢不重试） | Z18''-v8（WriteOutcome 四态真实分型） |
| stitch :97-110 | **stitch 产物无 nodeId**（服务端无法定位节点） | Z7''-v8（客户端 attach 档） |
| written 五消费面 | ai-download:119/ai-image-edit:233/lighting:215/shrink:146/reconcile:517+stub | Z18''-v8（G44 迁移面 census） |
| updateNodeEnvelope 37 处 | 调用点 census 37/7（v7 轮计） | Z12''-v8（全量迁移+order 写路径） |
| [@Cron intent-reconcile:34](../../../apps/api/src/modules/execution/intent-reconcile.service.ts) | @Cron 死代码（无 schedule 启用） | Z18''-v8（reconcile 扫描真实载体） |

## 2. Y1a 序域设计（D5 分层直译+数据流闭合）

### 2.1 类型链与读出口（Z2''-v8）

- **四型**：`RawNodeRecord`（Y.Map 直出——placement? 缺省合法态/position?/wh?；docShape 内部不导出）→ `StoredNodeRecord`（validateNodeRecord 规范化写输入——placement 必填；**storyboard 子 parentId-only 合法档**——Z17''）→ `ProjectedRecord`（diff/seed/读出口——position 可缺+parentId/order 派生；**恒 8 键=7+order，无 placement/natural 字段**）→ `CanvasStoreNode`（RF Node 泛型+order 派生）。`Placement={parentId: string|null, order: string}` 复合单键。
- **DocProjection 统一读出口**：`readDocProjection`（readCanvas/readCanvasSnapshotCached/shrink exportFresh/web ydocBuilder 四出口单源）=`{nodes: ProjectedRecord[], edges, mediaFacts: Record<mediaId, MediaFact>}`——节点不带 natural 键（side map 承载）；六消费者（execution 计费/video-project/video-work-clone/REST/探针/write port）继续吃 nodes 数组零改动。
- **三函数读模型**：strict 只用于写输入（validateNodeRecord 拆 record/patch 两函数五处）；total=装载读+投影热路径（同层合法项后层尾+id tie-break 落位+去重计数不抛）；公开快照 total-ordered。applyDocToStore catch 层只接 doc 级结构错误。
- **运行期坏 order 处置**：total 落位+计数+close 违规连接；repair CLI（G14）四形态扫描修复；post-apply 检测（§3.6）只验变更节点。
- **排序单实现收编（v8）**：`order-records.ts` 收编删除 nodeOrder.ts ensureParentFirst 与 snapshot-filter ensureParentFirst（census 全调用点→逐点切换→grep 零命中门）。
- G13 口径维持：新模块零新增 as+边界 allowlist+每条注明理由。

### 2.2 生成器+避让+soft/hard（§0.2-⑤ v8）

**生成器**：引入 **fractional-indexing integer-part vendor 库**（license 按仓库 LICENSE 实测）+shared wrapper（v7「移植算法不新增依赖」放开——vendor=同库测试向量+维护责任转移）；typed result（含 `key-too-long`）+头尾虚拟边界+等值键返同键+纯函数；isValidOrderKey **宽松档**（`^[0-9A-Za-z]{1,128}$`+长度——guard 另拒非 base62/超长——窄档防合法历史键误拒）。**四曲线硬验收（G29）**：10k 尾插 maxLen≤16/头插≤32/随机≤16/**同锚 10k 曲线落盘**（on-demand repair 触发依据+hard UX 证据）；同库测试向量+property 10k。

**soft/hard**：soft=24 告警（计数零 doc 写——v8 参数：integer-part 尾插≤16 留余量）/hard=128 typed 拒（`key-too-long`）+UX「立即修复」入口（联动 repair 端点——非用户墙）。

**在线避让**：allocatePlacement 候选键已存在→与下一不同键重生成；连续无 gap→key-too-long typed 拒。**并发残余 dup**：`duplicateLayers` 计数→repair 消费（在线避让已防产生；跨客户端并发同锚仍可能——读侧 (order,id) 确定性兜底维持）。

### 2.3 层序读出口+cells 单序源（Z3''/Z17''-v8）

- `orderRecords`=pre-order 层序 DFS（每层 (order,id)；孤儿/环=根处理三面同语义）；迭代栈 **256 深上限+reparent 拒环**。
- **cells 单序源（Z17''-v8）**：分镜子 **placement.order 不存**；orderRecords 对 storyboard parent 按 `data.cells` 槽序输出子节点（不读子 placement.order）；invariant=renderCanvas 子序≡orderRecords 分镜层子序（G55 对拍）；renderCanvas cellNodes 按 cells 槽序输出（childrenByParent 迭代序漂移点根修）。
- DOC_NODE_KEYS 三处接线（placement 键）——NODE_ENVELOPE_KEYS 不动。
- renderCanvas/snapshot-filter 恒等断言/ensureParentOrder 中间态/checkProjectionInvariant 序断言维持。

### 2.4 无自动重排+on-demand repair（Z4''-v8）

**废止理由（v7 装载期 rebalance）**：重排 apply 段与并发 reparent 竞争=整层覆盖丢并发意图（先算后写只保证 apply 段不抛，不救「计算与 apply 之间 doc 已变」——单写者假设在装载期不成立）；orderEpoch doc meta+离线 fence（清 IDB+UndoManager.clear）随装载重排一并废止（epoch 换代=deployEpoch env/Redis——Z9''）。

**维护链（v8——repair 为 hard 主出口）**：

- 检测：placement 写面/allocator 发现 maxLen>soft 或同层 dup>3 → `order-maintenance-required` 计数+告警（soft 不写 doc）；
- hard（128）：分配点 typed `key-too-long` 拒+UX「立即修复」入口；
- **on-demand repair 端点**（`POST /projects/:id/collab/order/repair`——OWNER/ADMIN，用户/管理员显式触发**非自动**）：`applyWriteFreeze(conn,'maintenance')`（不关连接不卸载——客户端写被 freeze 拒）→`writesSettled(pid)`（三态收敛谓词）→受影响层按 `(oldOrder,id)` 排序重排——**分片 <256KB/批**（withSession 直写 MAINTENANCE origin——不经上行帧闸）→**apply 前重读+父变更节点跳过**（并发 reparent 不丢）→解冻→现有连接直接收 update 重投影（**不断连不清 IDB**）；幂等（二跑零变更）；预算门超限交 CLI；
- **load 病理档**：maxLen>hard ∧ 无 WS 连接 → reaper tick 下个无连接窗执行 repair（常连项目由端点显式触发——v4 盲区根修）；
- **repair CLI**（G14）：offline 窗四形态（混合长短键/重复键/缺 placement/natural mismatch）+环修复+fact 兜底扫描（100/批限流）；JSON 报告+维护窗内 MAINTENANCE origin 重分配+相对序保持。

C0a 实测锚（[spike 数据](2026-10-18-y1a-y1b-c0a-spike-data.md)）：10k 重排全程≈56ms；10k 投影 p95 18.7ms（G22 阈值≤30ms）。

### 2.5 创建+父变更+order 写链（Z12''/Z14''/Z15''-v8）

placement 复合单键/判别联合（`parentId: string|null`——undefined 删键语义 20+ 调用点显式迁移）/order 不可删/命令级 allocator（allocatePlacement/allocatePlacements 唯一入口——intent addNode 只带 afterId 锚）/copyPlan 副本新键+子层分配/assignSeedOrder/undo 回放原 placement/整对象 set 禁 mutate/census（grep parentId 直读/写全量清单）维持。

**order 写链（v8 新——G54）**：projectCanvasNodes+order 透传（MinimalCSNode.order?）/toDocRecords 透传/**diff 比较 order→`updateNodeEnvelope{order}` intent**（拖拽置顶/插入中间持久化——diff 恰一个 intent；比较 order 防误判数组序为几何变更）/copyPlan/assembleRecords/duplicateNodes/pasteGroupClipboard/mergeStoryboard 副本经 allocatePlacements（相对序保持）/CanvasStoreNode.order 派生只读（cs 面派生——写只在 doc 侧）/reorderCsLayer（命令后 cs 数组序=doc 层序——读侧重排非 doc 写）。

**normalizeForSeed 五路径**（seed/clone/template/exportFresh/vacuum）+**media 根复制**（Z14''）：克隆/exportFresh 后 mediaFacts+binding 保留（T8 deliverMedia 侧 binding 复制）；其余根 deep-copy 保 exec/meta。DOC_KEY_MANIFEST placement 拆两行维持。

### 2.6 收敛 harness（Z13''-v8）

载体（apps/web vitest）/期望序五件套（含 cells 槽序档）/参考模型/双端真连三条维持；并发用例：G17 混键复现+**并发 reparent+同锚插入零丢失**（无自动重排=无整层覆盖的验证面）+双端同时分配避让；故障注入：fact 相 503 重试收敛/delivery outbox 三崩溃窗/on-demand repair 演练（活跃连接 hard→repair 不断连）/分区重启/reset 旧 IDB 联动。

## 3. Y1b 尺寸/只读域设计

### 3.1 media 一等根+probe 两相+delivery outbox（Z1''/Z7''/Z18''-v8）

**doc 形态**：

```
doc 根：nodes/edges（客户端意图）+ exec/media（server-only map）+ meta
media: Y.Map<mediaId, MediaFact{width,height,rotation?,source,probedAt}>
  → writeMediaFact op（writeExecStatus 同构——唯一写者：probe 相/repair CLI fact 兜底）
  → 客户端禁写（post-apply 检测+guard 根白名单）
DocProjection={nodes:ProjectedRecord[], edges, mediaFacts}（readDocProjection 四出口单源）
```

**probe+fact 写链（DB poller 两相——BullMQ 退役）**：

```
media.create（presign/confirm/AI/下载/光照/改图/trim/separate/register 全路径）
  → Media{probeState=pending, status=上传态}（无入队动作——DB 条件即队列）
poller probe 相（每 tick 批 10）:
  claim: probeState IN(pending, running∧lease过期) ∧ status='completed' ∧ MIME image/video 非 SVG
         FOR UPDATE SKIP LOCKED + probeRunId CAS → probeState=running
  audio/temp/SVG → 置 skipped（防指标污染/repair 误判）
  图片: getObject 流→临时文件→sharp metadata（limitInputPixels:100M+concurrency(1)）
        → .rotate() display 尺寸一次到位（EXIF 1-8 全档——5/7 交换后 rotation=0）
  视频: ffprobe（15s+SIGKILL+protocol_whitelist file+启动版本检查）
        → display 交换（90|270）+naturalRotation 血缘列
  → 成功: naturalWidth/Height（display）+naturalRotation（血缘）+naturalSource+sniffedMimeType
          +metadata.probe={width,height,rotation,probedAt}+probeState=done
  → 失败: probeFailureKind permanent（mismatch/SVG/超像素——不吃满重试）|transient
          → probeState=failed+lease 过期重认领至 attempts 上限
poller fact 相（独立查询——不看 probe claim）:
  claim: MediaBinding factState='pending' ∧ media.probeState='done' JOIN SKIP LOCKED
  逐 binding: writeBatch writeMediaFact（HTTP 写端口）→applied→CAS factState='written'
  retryable→pending+factAttempts++/nextFactAt 退避；permanent→failed+告警
deliverMedia（纯 DB——producer 调用，worker 进程安全）:
  upsert MediaBinding{mediaId,projectId,nodeId,teamId,role,factState=pending}   ← ① 先
  → 写 doc fileId（HTTP writeBatch）                                          ← ② 后
  （写序钉死：崩溃窗只留 pending binding——fact 相可收敛；红相=binding 失败时 doc 零 fileId）
producer 七路径: worker 五（AI/ai-download/光照/改图/trim）+generated-media confirm+客户端 attach
  （stitch 无 nodeId=客户端 attach 档；video-work docBound=false 显式 skip 档）
  克隆/exportFresh: 复制 binding（按探测态派生 factState）
attach 端点（用户鉴权 AuthGuard+perm.assertEditor——独立 controller）:
  mediaRefsOf 批量（fileId/trimmedFileId/referenceImage/images[].id/allImages[].id）
  +media.teamId===project.teamId ∨ media.userId===user（跨 team 放宽）+node 存在+幂等
  running 期 attach→factState=pending→fact 相补扫
```

**delivery outbox（资金交付权威——Z18''）**：

```
execution complete → settle（扣费定局）→ 入 outbox（deliveryState=pending+resultText 全文）
  （撤批内即时 receipt——交付改 outbox 认领）
outbox 认领: pending∨(delivering∧lease过期) → CAS 置 delivering+attempts++
  → writeBatch 交付 → applied → CAS delivered（幂等：同值 no-op——重认领不误退）
  → rejected+node-deleted → CAS discarded+退款
  → retryable → 释放 lease 保持 pending 下轮（有界重试后退款）
  → permanent → discarded+退款/补偿+告警（非静默）
reconcile 新分支: creditsConsumed>0 ∧ deliveryState IN(pending,delivering) ∧ completedAt<cutoff
  （settle-崩溃窗——settleStranded 既有 reservedCredits>0 分支保留不动）
probeArtifacts 退资金链（settleStranded 直读 row.deliveryState）；resultRef 降观测（grep 审计零资金残留）
WriteOutcome 四态（删 written）: applied|rejected|retryable|permanent
  消费映射四档+written census 五消费面迁移（G44——生产代码零 written 命中）
```

- **幂等**：同 mediaId/fact 重跑同值 no-op（deep-equal）；probe 迟到→fact 相重读 media 列写最新值（无 expectFileId CAS——binding 先行写序+读-检-写收敛）。
- **8 类产物绑定矩阵维持**（C0a 产出——全类经 DB 条件覆盖）。
- **校验链**：DocWriteOpSpec 逐键 ValueSpec+writeMediaFact 进表+Object.hasOwn+表驱动+switch+never；单写面收编（writeNodeData/writeExecStatus/writeMediaFact=applyWriteOpsToDoc 单 op 薄包装——经 collab-doc-ops）。

### 3.2 尺寸消费+禁写门（Z5''/Z11''-v8）

单写者三分类维持（commitIntrinsicFit/commitAuthorSize/commitLayoutSize）；**applyIntrinsicFit=纯函数——数据源 mediaFacts side map**（naturalOf(mediaId)；判据 side map 键匹配 data.fileId+sizeMode==='auto'）；**display 尺寸契约**（图片 EXIF 烘焙后 rotation=0/视频按 rotation 交换——rotation 血缘永不参与渲染不二次旋转 G56）；load 时扫描（mediaFacts side map 到达检测+applyDocToStore 后一次 auto 扫描——不在投影读路径内写）；sizeMode 缺省规则（无∧有 wh=author/无∧无=auto）；`data.aspectRatio` 键删除（WHITELIST/类型同步清）；viewer 纯函数本地派生同值渲染（readOnly 会话 invariant 豁免 wh 比较）；**multiImage images[].id 每图独立 fact+格子布局**；clamp（maxW/maxH 4K→800）；无 Media 行（剪贴板 blob/未上传 split）=无 fact→默认 wh+fallbackSize 维持 author 本地测量档；markAuthorSize（用户显式 resize 持久化 author 档）。

**禁写门**：natural=web 客户端单点（canvasIntents 直发 natural patch 零写零上行帧+diff 零 natural intent+复制保 fileId+内容键）+服务端 manifest UNKNOWN_KEY（writeNodeData 携 natural 拒）；resultUrl/videoUrl/result/errorCode 客户端禁写维持；fileId 客户端可写维持（Y2 缺口——服务端写序 deliverMedia binding 先行收口）。

### 3.3 只读命令边界+resync 分流（Z6'' 维持 v7）

命令入口 gate（canEditCommand 单源=canEdit∧!writeFrozen∧!canvasDiverged——viewer 早退置首）+B1a 必做（nodeStore 五命令门/deleteNode 命令路径级联门 :846 前置/onNodesChange 善后段全门/onConnect·onEdgesChange edges set 门/undo 门）+dimensions 分表（measured 始终本地/setAttributes resize=用户命令 viewer 拒）+resync 三路（重连判据/viewer 不自动 discard/结构档终态禁重放）+write-rejected 节流（10 拒→1 横幅）+**key-too-long→「立即修复」入口（T19 repair 联动）**+闩锁保留；断言=零 local-origin update+本地命令零写+VIEWER 键盘矩阵+零 DB 副作用（cascade/cancelNodeProcess 不触发）。

### 3.4 创建默认与兜底（Z8'' 维持）

工厂类型感知（组不写 wh 0 帧键/storyboard 子写网格 wh/audio·videoEdit 片内定）；fallbackSize 单函数+reason 标签+去重计数；happy-path=0。

### 3.5 删除面（收窄）

删 dispatchFixtureSizeIntents+RF dimensions 首测固化链+measured 类型注记+`data.aspectRatio` 键（WHITELIST/ImageNodeData）；reportNodeSize 收口三分类；contentEventSize 及 existingAspectRatio 依赖收编进 applyIntrinsicFit 判据；组件级迁移（ImageGenNode/VideoGenNode/MultiImageNode——删前先改调用点）；grep 全零+台账核销。

### 3.6 入口 guard（Z19''-v8——spike 定档+post-apply 恒做）

**Step 0 spike（1 天）先行**：真实帧 decodeUpdate+根 map ID 索引成本（10k/264KB p50/p95）+违规帧 close reason+恢复+混合帧可否部分剥离——**结论落盘定档**（G16 判据=spike 报告）。

- **spike 通过 → 浅层 enforce 默认**：根白名单（nodes/edges 客户端；exec/media/meta 服务端）+origin 链+键集；混合帧只拒纯 forbidden 根帧；<64KB 帧生效。
- **post-apply 恒做（不随档位）**：`doc.on('update')` 事务上 changedParentTypes 反查→media/exec 客户端写检测→**afterTransaction 队列修复**（勿在 update 回调内嵌套写——重入防线）+同步删键+诊断 close（非 terminal——防重连风暴）；replay/load origin 排除。
- **深度 shadow**（C0a 原型引擎——origin 链解析/覆写豁免/DeleteSet 反查）作为 enforce 期对账工具；guard-contract.spec（私有结构形态断言——yjs 升级即红）。
- **exact pin 前置 P0-pre 无条件**：yjs 13.6.32/sharp 0.34.5（T0——不随 guard 档位）。
- 帧闸/readOnly/quota 维持（guard 只加不减）；S1=receipt+readOnly+post-apply+enforce（spike 通过才默认）。

## 4. 片序与执行门（v8 对齐 plan v5 T0-T28；每片出口=用户确认点）

| 片 | 内容（T 卡） | 出口判据 |
|----|--------------|----------|
| **C0a（spike）** | （v6 完结——勘误两条已入 [spike 数据](2026-10-18-y1a-y1b-c0a-spike-data.md)） | ✅（历史） |
| **P0-pre（T0-T3 机械前置·零行为变更）** | T0 yjs/sharp exact pin+ffprobe 版本检查；T1 DocNodeRecord→ProjectedRecord 单 commit 改名（census 驱动零别名）；T2 collab-doc-ops 纯模块（原语+类型同迁破环）；T3 Prisma 三迁移（probe 族+MediaBinding fact outbox+**delivery outbox**） | 三面 tsc 绿+全量绿+census JSON+pin 绿+零行为变更 |
| **B1a（T4 只读命令门·必做）** | canEditCommand 单源+viewer 早退置首+nodeStore 五命令/deleteNode 级联/onNodesChange 善后段/onEdgesChange·onConnect edges 门/undo 门/dimensions 分档 | G34：VIEWER 全命令矩阵零 cs 写（select/measured 除外）+零 doc 写+零 DB 副作用 |
| **C0b（T5-T10 服务端事实写）** | T5 media 一等根+writeMediaFact+DocProjection+mediaRefsOf；T6 WriteOutcome 四态+delivery outbox（撤 pending→rollback）；T7 probe poller 两相；T8 deliverMedia 纯 DB+producer 七路径+attach；T9 web natural 禁写单点；T10 消费端接线（media.observeDeep+初始全量+切项目清空）+E2E | 五面闭环自检表；G42/G43/G44/G46/G48/G51/G58 全绿+两路径同表（G10/G18）+先红留档 |
| **A1（T11-T18 doc 契约+placement）** | 执行序 T12→T13→T14→T15（含 T11 bump 3 同批）→T16→T17→T18：placement 三型/DOC_NODE_KEYS/order-key vendor 四曲线/orderRecords+cells 单序源+排序收编/validate 双函数+fillDoc 写链+四出口层序+snapshot natural 注入/判别联合+allocator 避让+**order 完整写链（G54）**/normalize 五路径+media 根复制/空间 tie-break+doc-shape-invalid reason 档 | adversarial 绿+命令 strict（G1/G30）+**order 可写**（G54）+四出口层序+cells 单序源（G55）+bump3（G11）+G29 硬验收+空间序（G25） |
| **A2（T19-T21 序域执行）** | T19 soft/hard+**on-demand repair**（freeze+分片+跳过父变更+端点）+load 病理档；T20 guard Step 0 spike→enforce/post-apply；T21 repair CLI | repair 闭环（G53）+并发零丢失（G45）+spike 档位落盘+post-apply（G41/S1）+CLI（G14） |
| **A3（T22 harness）** | 五件套（含 cells 槽序档）+双端真连+故障注入（fact 相 503/delivery 三崩溃窗/repair 演练/并发 reparent+同锚） | 红相→绿+seed 复现（G12/G17） |
| **B1（T23-T24 只读收口续）** | DocShapeInvalidError+enterDocInvalid 收窄；resync 分流+write-rejected 节流+key-too-long repair UX | G19+注毒不白屏+解冻收敛 |
| **B2（T25-T27 删除面+写者补齐）** | 删除面+组件迁移（T26 先行）；applyIntrinsicFit（side map+display+clamp）+markAuthorSize+工厂表；D6 autoOrigin 改形 | grep 全零+G7/G28/G24/G56 |
| **B3（T28 终出口）** | **epoch terminal 门**（meta 下发+TERMINAL_AUTH_REASONS+safeReload 强刷+fail-closed）+dev reset（含 CanvasDocUpdate+MediaBinding）+verify/CI+UX 签字+soak | 全绿+两轮零回灌（G21/G47）+epoch 强刷不循环（G57/D2）+清单签字+soak 曲线（G35） |

## 5. 验收判据与先红门禁清单（v8 权威表——G36-G41/G49/G50/G52 为 plan 迭代废弃号不复用）

| # | 门禁 | 先红判据 | 绿判据 |
|---|------|----------|--------|
| G1 | order 写侧显式拒绝 | 写边界缺 placement=业务错误码红 | validateNodeRecord 五处逐处绿+A1 切片内 addNode 经 allocator 通过 |
| G2 | 读侧全函数+catch 层 | 注毒缺 placement：装载 strict→terminal/白屏 | total 确定性落位+`doc_integrity_invalid_total{stage}`+catch 层只接 doc 级结构错误 |
| G3 | 期望序 | Map 插入序≠order 时读出口=插入序（真红） | 层序三面同序 |
| G4 | 字母表/边界 | 乱序字母表红+同锚曲线缺位红 | 严格递增+vendor 测试向量+property+**G29 四曲线**（尾/头/随机/同锚——append-only 基准进 CI） |
| ~~G5~~ | ~~装载 rebalance~~ | **v8 废止**（Z4''——装载期自动重排废止） | 并入 **G53**（repair 端点受控重排） |
| G6 | E8 probe | C0b 断言先红 | 8 类逐项绿（DB 条件覆盖）+EXIF/rotation fixture+幂等重试 |
| G7 | 首拟合 | 现状红（image/video 无默认+首拟合缺口） | auto 档 fact 到达恰一次 fit/author 档零 wh 写+load 扫描+mediaId 匹配才 fit+viewer 纯函数同值 |
| G8 | 只读命令矩阵 | 收口前红（回弹+undo 无门） | 零 local-origin update+select 放行+measured 本地/setAttributes viewer 拒+级联前置 |
| G9 | 创建默认 | 现状红 | 兜底稳态 0+首拟合+auto 组 0 帧键 |
| G10 | 校验链表驱动 | 删 validator/case 红+未知键 {a:1} written:true 现状+`toString`/`constructor` 绕过 | 删即编译红+单写/批写两路径同表+Object.hasOwn |
| G11 | 版本门 | bump 前旧 csv 放行红 | 旧 csv 拒连+旧 schema 拒载+IDB 不命中 |
| G12 | 收敛 harness | 期望序红相+参考模型 | 五件套绿+并发用例（G17） |
| G13 | 类型门禁 | 新模块 as 残留红+四型混用红 | 四型分职+零新增 as+allowlist 注理由+projectCanvasNodes cast 删除 |
| G14 | repair CLI | 四形态注入 | 扫描→JSON 报告→维护窗重分配（MAINTENANCE origin）→修复后装载通过+相对序保持+fact 兜底 |
| G15 | 服务端写一致性 | {a:1}→written:true 两路径漂移现状 | 两路径同表拒+**WriteOutcome 四态消费映射**（Z18''）+natural/fileId op 独立成败 |
| ~~G16~~ | ~~guard shadow 对账~~ | **v8 改 S1**（Z19''——spike 定档） | **S1=receipt+readOnly+post-apply（恒做）+enforce（spike 通过才默认）**；spike 报告落盘 |
| G17 | placement 原子性 | 两键形态并发「移动+置顶」→merge 交叉复现 | 复合 placement 整值同源配对+三端同序+**并发 reparent+同锚插入零丢失** |
| G18 | 服务端单写路径 | 单写面写域外键→written:true 现状 | 两路径同表拒+reason 透传 |
| G19 | 坏 order 不终态 | 注毒持久化→重载 terminal/公开页 500 | total 渲染+计数+违规连接关闭+重载可用 |
| G20 | seed/clone 归一化 | 缺 placement 的 export/clone/vacuum 直连 fillDoc→typed 拒 | 五路径保相对序+**media 根复制**+synthetic key 零回写+vacuum 经 normalize 后其余根 deep-copy |
| G21 | reset 演练 | API/worker 仍在写时 truncate→回灌复现+队列未 pause 回灌 | 九步脚本（maintenance 不自动解除+队列 pause+停双进程+**CanvasDocUpdate 清**+备份+SCAN+epoch）→两轮零回灌 |
| G22 | 10k 预算 | 无预算基线 | 10k 投影 p95≤30ms+rebalance/repair 耗时达标+G35 浏览器面 |
| G23 | probe 韧性 | probe 失败/超时/节点不存在丢（现状无链路） | poller lease/attempts 真实重试+fact 相独立补扫+失败计数+fallback 兜底 |
| G24 | D6 autoOrigin | 空自动组无持久 origin（bbox 递归抖动） | data.autoOrigin 非帧键持久化+fallbackOrigin 退役+auto 组零帧键+断言改写 |
| G25 | 空间序 tie-break | 同坐标输入序=Y.Map 插入序——双端分叉 | id tie-break+双端同序 |
| G26 | 重排先算后写 | 中途 throw→半层混合+truth 失真 | **repair 执行体**：先算后写（apply 段不抛）+分片+重读跳过父变更后无半层+truth 一致 |
| G27 | probe 媒体替换 | 旧 probe 迟到覆盖新 fileId 事实 | **binding 先于 fileId 写序**（deliverMedia 读-检-写）+fact 相写最新值+丢弃计数 |
| G28 | 公开/viewer fit | 无 wh doc 公开页 fallback+viewer 不一致 | **快照边界注入 mediaFacts+RawNode.natural**+viewer 纯函数本地派生（readOnly 会话豁免档） |
| G29 | append-only 序键 | 中点算法 10k 尾插≈630 字符（反面基准） | integer-part vendor：10k 尾插≤16/头插≤32/随机≤16/**同锚曲线落盘**——append-only 基准进 CI |
| G30 | 读契约 | readCanvas 消费者 parentId 断链复现 | DocProjection 四出口+tsc 消费者锚+无同名 DocNodeRecord 双导出 |
| G31 | ~~in-place 维护窗~~ | **v8 改 G53**（orderEpoch 废止——epoch 换代 deployEpoch terminal） | 并入 **G53**（repair 不断连）+**G57**（epoch terminal 强刷） |
| G32 | probe 覆盖 | AI/download/image-edit/lighting/media-process/stitch 产物零探测复现 | **DB 条件查询结构性覆盖全 8 类**（无入队收口）+probeability 置 skipped+attach 不信客户端尺寸（metadata.probe 专属） |
| G33 | reset epoch | 旧 epoch job/doc 进程未停时回灌复现 | **epoch-mismatch→TERMINAL_AUTH_REASONS→safeReload('version') 强刷**（新 build 从 meta 取新 epoch）+fail-closed+epoch-unavailable 瞬态 |
| G34 | VIEWER 全命令矩阵 | v1 漏门处全红 | 全部零 cs 写（select/measured 除外）+零 doc 写+零 DB 副作用 |
| G35 | 性能 soak | 单端纯函数绿≠浏览器绿 | 10k+5 客户端 10min：投影 p95≤30ms+React commit+doc 字节不随同值写增长+update 单帧<帧闸/2+probe lag+**mediaFacts side map 不放大**+delivery outbox lag |
| **G42** | media 一等根五面（v8） | observe 未挂 media（:1961-1966）+四根现状红 | 零客户端写/manifest 五根/factory+builder 双点建根/vacuum/seed/clone/snapshot 注入；side map 不放大；切项目清空 |
| **G43** | producer 七路径（v8） | binding 零产生现状红 | worker 五+generated-media confirm+attach 全产生（stitch 客户端档/video-work skip 档显式）+multiImage images[].id 多引用+克隆 binding 派生 |
| **G44** | WriteOutcome（v8） | written 字段现状红 | 四态消费映射；written 生产代码零命中（census 五面迁移） |
| **G45** | 无自动重排（v8） | 并发 reparent+同锚插入→整层覆盖丢失复现（装载重排形态） | 零自动 doc 重排写+soft 告警+hard typed 拒+修复入口+并发 reparent 零丢失 |
| **G46** | fact 相独立（v8） | probe done 当轮 writeBatch 503→永久卡住复现 | 独立查询下 tick 重试至 written+attach 竞态补扫+退避不空转 |
| **G47** | reset 清表（v8） | CanvasDocUpdate 残留回放复现 | CanvasDocUpdate 清+MediaBinding/Media 生成物清+预置旧 generation+旧 update 零重放零复活 |
| **G48** | delivery outbox（v8） | 认领无 CAS 双交付/applied 崩溃误退复现 | 认领 CAS/幂等重试/节点删退款/settle-崩溃窗新分支/applied-崩溃窗不误退+resultRef 零资金残留 |
| **S1** | guard 档位（v8） | spike 未做=档位未定现状 | Step 0 spike 报告落盘定档+post-apply 恒做（afterTransaction 队列）+enforce（spike 通过才默认）+guard-contract.spec |
| **M1/M2** | probe 沙箱（v8） | probeability 污染指标/SVG 探测现状 | audio/temp/SVG 置 skipped+probeFailureKind 分型+lease token 防旧 worker+sniffedMimeType serving+信号量+ffprobe 沙箱+版本检查 |
| **D2** | epoch 单源（v8） | epoch 双源/死循环复现 | env/Redis 单源 fail-closed；terminal 强刷后新 epoch 连接成功；连续失败不循环 |
| **G51** | binding 先于 fileId（v8） | binding upsert 失败时 doc 已写 fileId 复现 | 写序钉死：崩溃窗只留 pending binding 可收敛 |
| **G53** | on-demand repair（v8） | 活跃项目 hard→无出口（用户墙）复现 | freeze+writesSettled+分片+跳过父变更→完成**不断连不清 IDB**；幂等二跑零变更；并发 reparent 不丢 |
| **G54** | order 写链（v8） | 拖序不持久复现（projectCanvasNodes 七键无 order） | diff 恰一个 {order} intent→doc placement 变→四出口同序；副本相对序保持 |
| **G55** | cells 单序源（v8） | 双序源漂移复现（childrenByParent 迭代序≠cells 槽序） | 分镜子无 order；renderCanvas 子序≡orderRecords 分镜层子序 |
| **G56** | display 尺寸（v8） | EXIF 5/7/视频 90|270 二次旋转错宽高复现 | 图片烘焙后 rotation=0/视频交换后宽高正确且 rotation 永不二次应用 |
| **G57** | epoch terminal（v8） | 旧 bundle 无新 epoch 清 IDB 重连死循环复现 | epoch-mismatch terminal→强刷→新 build 连接成功无循环 |
| **G58** | delivery 崩溃窗矩阵（v8） | 三窗任一不收敛复现 | settle 后/applied 后/认领后三窗全收敛（补写或退款——不误退不漏退） |

**观测增补（v8）**：`order_dup_total`+`natural_mismatch_total`+`probe_stuck_total`+`guard_reject_total{reason,mode}`+`readonly_blocked_total`+`repair_duration`+`delivery_outbox_lag`+`fact_phase_pending_total`（告警阈值：probe lag/failed/stuck、stale fact、delivery 超龄、repair 超预算）。

## 6. 非目标与移交

| 项 | 归属 |
|----|------|
| z 序 UI 命令（bringToFront 等） | 后续 UI 批 |
| 闩锁删除 | Y1c-1 后按证据再裁 |
| SCHEMA=4/generation/CanvasDocSnapshot/拆键/Y.Text | Y1c（折叠进 3 定案 §0.2-④） |
| reconcile 删除 | Y3 |
| v2→v3 兼容 | 无（reset runbook §6） |
| 拖拽帧级热路径在线重排 | 不做（repair=受控端点非热路径——§2.4-v8） |
| cellCount | 不做（零读者——偏离表 #2） |
| **BullMQ probe 队列**（MediaProbeService.enqueue/jobId `probe_`/sweeper/队列装配拆分） | **v8 废止**——DB poller 两相替代（Z7''-v8） |
| **装载期自动 rebalance+orderEpoch doc meta+离线 fence** | **v8 废止**——on-demand repair+deployEpoch env/Redis 替代（Z4''/Z9''-v8） |
| **exec/media 独立 runtime doc** | Y2 评估（master 目录登记） |
| fileId 客户端可写收编 | Y2（偏离表 #3——服务端写序已收口 deliverMedia） |
| R1/R2 片序拆分 | 不采纳维持（§0.2-③） |
| cutover 脚本化 | B3 评估维持 |
| ~~第七 op~~/~~mediaFacts 独立 map~~/~~order 出 diff 链写路径~~ | **v8 翻转采纳**：writeMediaFact op（Z1''）/mediaFacts side map（Z1''）/order diff 写链（Z12''-v8 G54）——原「留档不采」废止 |

## 7. 纪律与观察项

- v1-v7 历轮核验错误留痕与教训（「进 spec 断言先实证」/「方向级核验≠落点级核验」/「spec 落点核验≠plan 代码落点核验」/「spike 结论必须覆盖主使用路径」）维持——全文见 git 历史各版修订链。
- **v8 留痕（本版核心教训）**：v7 定稿后 plan 五轮外审推翻 spec 多项冻结裁决，期间勘误全部由 plan 头注内联承载=**spec/plan 双源矛盾窗口五轮**——若实现者照 spec v7 开工将做出七处架构级错误（data.natural 单对象/BullMQ probe 链/expectFileId CAS/装载期 rebalance/orderEpoch doc meta/cells 双序源镜像/order 只读）。v8 收口恢复单一权威。教训：**plan 外审推翻 spec 冻结裁决时当轮回写 spec，勿积压至收口批**。
- **v4→v5 两项裁决原则自我修正（记入观察项防再犯）**：①「宁可少扣不可错扣」在重试可收敛系统中反向错——pending=重试信号非退款信号（错退=系统性资损，漏退可由 reconcile 补）；②「删在线重排」不可绝对化——删自动/客户端重排，保留服务端受控 on-demand repair（常连项目 hard 无出口=用户墙）。
- harness 真连用例 provider destroy 走 scripts/lib/provider-late-reconnect-guard；纯内存部分不涉。
- 观察项：B15 心跳 FIFO（不触发）；collab.gateway.spec 满载 flaky（二连命中转根修）；mediaFacts side map 快照体积（G35 soak 覆盖）。
- manifest 矩阵扩+缩对称（media 一等根行+placement 拆两行+writeMediaFact op 行；measured 注记出+aspectRatio 出+natural data 行删）。
- 入口 guard 与 readOnly/帧闸/quota 只加不减；**guard 档位由 Step 0 spike 数据定（G16→S1）**——不预支结论。
- §0.2 v8 修订（①废止/②修订/⑤落定）经用户确认（2026-10-18 plan v2.1→v5 四次裁决）；后续变更走 §0.4 偏离表。
