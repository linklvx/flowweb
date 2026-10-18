<!-- doc-status: active -->
# Y1a+Y1b：doc 模型 v3·序与尺寸/只读（B 类合并批设计）

- **立项日**：2026-10-18；**唯一上游依据**：[2026-10-06-canvas-yjs-arch-upgrade-review.md](2026-10-06-canvas-yjs-arch-upgrade-review.md)（master spec v8.3）§0.2 Y1a/Y1b 两行+§0.1 裁决（D5/D4/E68/C7③）。
- **B 类合并立项**（Y1a+Y1b——E6 序域与 C5↔D4 同批硬约束共用）；plan=`../plans/2026-10-18-y1a-y1b-doc-model-order-size.md`（writing-plans 产出）。
- **用户立项三澄清（2026-10-18 一轮）**：①单 spec 单 plan+多段片序（每片出口=用户确认点）；②收敛 harness=内存双端基底+期望序断言+真连集成；③UI 变更面=「可接受变更清单+签字」（§0.2-⑥ 定案——VIEWER 拒写视觉沿用现有只读横幅体系）。
- **修订链**：
  - **v2（二轮）**：v1 五条 Z 裁决废止（违反 D5/D4/E68）+两处基线核验错误勘正+用户二轮裁决（固有尺寸=data 层 natural*+零新 op）。
  - **v3（三轮）**：（摘要——v2 自相矛盾修正+三型分裂+cs 携带 order 裁定；全文见 git 历史 ee41624f）
  - **v4（四轮）**：三份 v3 外审逐钉核验，四 P0 全部实证（observer 丢帧废止/forceSync 只发 SyncStep1/total vs ordered 三函数模型/natural* 键级跳过+上传绑定链路补全）——全文见 git 历史 feeef2a6。
  - **v5（五轮）**：三份 v4 外审评估后架构返工六项（natural\*=服务端唯一写者方案 B/装载 total 化/beforeSync pre-apply guard/placement 复合单键/rebalance 移 loadDocument/单写面收编）——全文见 git 历史（本文件 v5 版）。
  - **v6（六轮·三份 v5 外审逐钉核验〔主张一手复核见 §1.7〕后四处实错根修+权威链定案）**：六项结构性修订方向获外审一致确认维持；**四处实错（全部一手复核坐实）根修**：
    1. **natural\* 三矛盾根修**（v5 Z1''「服务端唯一写者」vs Z11''「addNode 工厂客户端初始值」vs §3.6「guard 拒客户端写」三句话互斥）：改 **`data.natural` 单对象** `{mediaId,width,height,rotation?}`（整值 LWW 原子+mediaId 绑定——v5 双键可混值+无 CAS 两缺陷一并根修）+**客户端零写（addNode 例外删除）**+服务端 type allowlist 恢复+probe 值错 typed false（fileId 交付独立 op 不丢）；
    2. **worker 进程边界实错**（v5「probe worker 经 withSession 直写」——worker 无 collab server〔HttpCollabWritePort.withDoc NotImplemented 实证 §1.7〕）：改 HTTP 写端口+probe 专用 strict 写结果档；
    3. **NODE_ENVELOPE_KEYS 编译矛盾**（v5 Z12''「改 placement 键」vs `satisfies` 锚 CanvasNodeRecord）：键集不动+DOC_NODE_KEYS 独立+**四类型链**（Raw/Doc/ProjectedRecord/CanvasStoreNode）+readCanvas 返 Raw；
    4. **rebalance「异常→保留长键」不成立**（Yjs transact=try/finally **无回滚**——yjs.cjs:3438-3463 实证）：**先算后写**+失败仍重测 docTruth+**purpose gate**（openDirectConnection context 实证 cjs:1632）+失败 backoff。
    配套：出清出口改**服务端驱动维护性重连**（doc 常驻期单客户端刷新不触发 loadDocument——「刷新提示」不可达洞根修）；presign projectId 改可选（素材库链路实证）；**A1 吸收 allocator/patch/seed 归一化**（v5 继承 v4 的「A1 先行不可运行」切片缺陷根修）；guard 降 **C0a 条件采纳**（Yjs struct 无路径需 ID 映射——「轻量 struct walk」低估，不达标退回 post-apply+total）；reset 先停 API/worker；**D6+空间序 id tie-break 纳入 A1**；§0.2 六项经用户确认定案（2026-10-18）。
  - **v7（七轮·三份 plan v1 外审逐钉核验〔§1.8 一手复核〕后四处实错+plan 级执行缺陷根修+用户确认 2026-10-18）**：plan v1 不能按原样开工（多主张一手坐实）——六项结构性修订+两处 v6 裁决勘误+一处 C0a 结论纠错：
    1. **`DocNodeRecord` 同名冲突**（现存 docShape:378——全仓 **172 处/34 文件**；index.ts `export *` 下再导出=TS2308）：类型链改 **`StoredNodeRecord`（写型 placement 必填）/`ProjectedRecord`（读出口——parentId/order 派生，沿用现 DocNodeRecord 语义加 order）/`RawNodeRecord`（docShape 内部不导出）/`CanvasStoreNode`**；**readCanvas 返回 ProjectedRecord[]**（六消费者零改动——video-work-clone/snapshot-filter parentId 直读不断）；plan 增 **P0-pre 机械迁移前置片**。
    2. **循环 import**（writer:59-69 从 document.service import 全原语——plan T2 反向调用必成环）：抽 **`collab-doc-ops.ts` 纯函数模块**（两 service 只 import 纯模块）。
    3. **序键生成器换 integer-part 方案**（**C0a 结论纠错**：尾插 maxLen 63@1000≈1 字符/16 次追加——追加才是画布主路径，「随机使用不可达」采样口径错误——soft 32≈500 次追加即触/硬 128≈2000 次）：移植 fractional-indexing 算法+测试向量（不新增依赖）；**G29 append-only 硬验收**（10k 尾插≤16/10k 头插≤32/重排后 1k 次追加不触发 soft）；并发同锚重复键**允许+读侧 (order,id) 确定性+dup 计数**；`key-too-long` typed。
    4. **probe 全链路重做**（plan v1 入队只挂 confirmUpload=**AI/download/image-edit/lighting/media-process/stitch 产物永不被探测**——8 类矩阵 6 类成空话）：`Media` 增 **probeState/probeAttempts/probeError/naturalWidth/naturalHeight/naturalRotation** 状态机列+**入队收口 `MediaProbeService.enqueue` 挂全部 7 处 media.create 路径**+**复用 MediaProcessService 补 detectNatural**（不新建平行模块）+jobId `probe_${mediaId}`（**BullMQ 5.75.1 冒号 jobId 抛错实证**）+sweeper+stream 临时文件（**MinioService 无 getObjectBytes 实证**）+MIME 嗅探+**attach 只信 probeState=done+metadata.probe 专属字段**（raw width/height 两处污染源：旧 detectMetadata 无 rotation/generated-media.register 收客户端宽高）+队列装配拆分（**producer=API 侧 registerQueue〔storage.module 无注册实证〕/processor=WorkerModule 平铺**〔Nest imports 单向〕）+**attach 用户鉴权独立 controller**（write-batch 控制器是 worker token 面——`perm.assertEditor` 实存）。
    5. **fileId/natural 所有权收口**：`expectFileId` **作用于整 op**（fileId op 亦 CAS——旧 probe 不得回退用户替换）+**strip 四点**（nodeStore 两命令/applyIntentToDoc addNode data/diff addNode data/copyPlan+assembleRecords 副本 data——原两点下复制携带 natural 与禁写门打架）+服务端写面统一 **bindMedia 单事务**；**维持零新 op**（§0.2-①——server 子 map 形态登记为 Y2 目标）。
    6. **维护流程改 in-place**（§0.2-② 修订——v6 close-all 链路机械不可达：maintenanceUntil 拒新连接=无人触发再物化、done 广播无连接可发、离线客户端旧键 LWW 复活、undo 栈复活旧键）：**freeze（新 FreezeReason）不关连接→persistence 收敛→in-place rebalance（56ms@10k 实测安全）→`orderEpoch` 写 meta→解冻→现有连接直接收 update 重投影**；客户端 synced 后 epoch 不符→清 IDB+UndoManager.clear+全量重同步。
    7. **guard 降 shadow 默认**（C0a「达标档」勘误为「解析可行/部署档位 shadow」——264KB fail-open 最大帧不查+拒帧丢离线编辑+私有结构升级风险三反对称性）：`COLLAB_CONTENT_GUARD=off|shadow|enforce` 默认 shadow；**主路径=post-apply 检测**（transaction.changed 只验变更节点+诊断 close code）；enforce 需 shadow 期数据+yjs pin+conformance spec。
    8. **两处 v6 裁决勘误**：Z14'' vacuum（**rebuildVacuumDoc 实为 readRecords→fillDoc**——normalizeForSeed 四路径改**五路径**含 vacuum〔恢复路径不可断〕）；**D6 改形**（`assertNoAutoGroupFrameKeys` 冻结断言：auto 组携任何帧键含 position 即违例——「auto 组仅 position 键」直接冲突）→改 **`data.autoOrigin` 显式非帧键**并移 **B2**（不再占 A1）。
    9. **B1a 必做化**（nodeStore 五命令门+deleteNode 命令路径级联门〔:846 前置——与 onNodesChange 是两处〕+onNodesChange 善后段全门+onConnect edges set 门〔dispatch 后仍 set :1702-1717〕）；**reset 真实拓扑**（**ecosystem 仅 flowweb-api+flowweb-worker 双进程实证**——collab 在 API 进程内，「SIGTERM collab 进程」不存在）+持久 maintenance mode+队列 pause+`DEPLOY_EPOCH`+pg_dump 备份；**G14 补 repair CLI 承载**（v6 自检虚报）；rebalance 保序（按层 (oldOrder,id) 排序+整层重排+定宽 base31+节点数/耗时预算门）；orderRecords 三面文件补齐（renderCanvas/snapshot-filter/video-work-clone）。

## 0.1 本批有效裁决（master 内联+本批 Z'' 系）

| 编号 | 裁决 | 效力 |
|------|------|------|
| **D5** | order 仅同 parentId 层内生效；投影数组序=层序遍历（父先子后）+同层 (order,id)；不设跨层全局序；Origin 枚举加第 5 常量 Maintenance（**MAINTENANCE_TRANSACT_ORIGIN**——onUpdateDelta 排除表+persistence 持久化同 SERVER_TRANSACT_ORIGIN 待遇）；rebalance=会话开始+**维护窗**（§2.2-v7 in-place freeze+重排+orderEpoch——§0.2-② v7）；ensureParentOrder 冻结「仅 RF 父先子后契约，禁承担 z 序」 | §2 |
| **D4** | 上传=服务端元数据命令写；生成=落地补一次解码写；**视频=受控一次性 bootstrap（「doc 已有 wh 零写」判据由 `data.sizeMode` 承载**——author 档零写只更新 natural、auto 档 natural 到达后 fit 一次）；维度缺失=合法态+DEFAULT_CHILD_SIZE 兜底；text=持久化作者尺寸；measured 仅节点内部视觉禁入帧派生 | §3 |
| **E68** | 读侧全函数（绝不抛）/写侧显式拒绝（业务错误码）/禁修复写回 doc——**装载读也属读侧**（strict 收窄写输入） | §2/§3 |
| **C7①③** | 版本协商拒旧+「排空切换 runbook 进 Y1（第一个弄脏 doc 的批次）」 | §6 |
| C5/C6/C5↔D4/D13/E6/E8/E15 | 宽高三源/序分层/同批硬约束/门禁先红/键长上限/元数据可取性前置/收敛 harness | §2/§3 |
| **Z1''（v6 重写）** | **natural=data 层单对象键**：`data.natural={mediaId, width, height, rotation?}`——`SERVER_NODE_DATA_KEYS` 以 **natural 单键**替代 naturalWidth/naturalHeight（服务端域；v5 双独立键=并发 probe/替换/迟到可混出「宽新高旧」+无 CAS 两缺陷根修）；值域落 `validateNodeRecord`（对象形状：mediaId string/width·height finite 正整数 1..100000/rotation 0\|90\|180\|270）+**服务端 node.type allowlist**（image/video 叶子+storyboard 格子 imageGen 允许；group/text/audio/multiImage/videoEdit typed 拒——服务端正确性非客户端容忍）；**服务端写值错=typed `written:false` 不 throw**（probe=外部数据非进程 bug——v5 fail-fast 会丢已付费交付）；**undefined/patch 结构损坏=fail-fast throw 维持**（UNDEFINED_PATCH_VALUE 同款纪律）；**fileId 交付与 natural 写拆两个 writeNodeData op**（writeBatch 两元素——natural 非法不丢交付）；同值 no-op（**v7：对象值用 deep-equal**——Object.is 对 natural/placement 恒 false，probe 重试膨胀 doc）；客户端禁写门见 Z11''-v7（**v7：四点 strip**）；**「零新 op」维持**（writeNodeData 现词汇承载——**v7 定案**：server 子 map/writeServerState 形态登记为 **Y2 目标**〔fileId 引用/事实结构分离——本批以 CAS 全 op+四点 strip+bind 单事务闭合所有权，不上结构迁移〕）；**v7：`expectFileId` 作用于整 op**（含 fileId op——旧 probe 不得回退用户替换后的 fileId：probe 首 op `expectFileId:null`（新节点）/`expectFileId:mediaId`（已绑定））；cellCount 不做/probeArtifacts 不加维持 | §3.1 |
| **Z2''（v7 微修）** | **四类型链**：`RawNodeRecord`（Y.Map 直出——placement?/position?/wh? 缺省合法态）→**`StoredNodeRecord`**（`validateNodeRecord` 规范化写输入——placement: Placement 必填；**v7 改名：不复用 `DocNodeRecord`**——现存 docShape:378 同名类型全仓 **172 处/34 文件**，index.ts `export *` 下再导出=TS2308 编译墙）→`ProjectedRecord`（diff/seed/**读出口**——position 可缺+parentId/order 派生，沿用现 DocNodeRecord 语义加 order）→`CanvasStoreNode`（RF Node 泛型+order 派生只读）——v5「ProjectedCanvasNode」一名混担两语义**勘误**；**v7：`readCanvas` 返回 `ProjectedRecord[]`**（六消费者〔video-work-clone/snapshot-filter parentId 直读〕零改动——**v6「返 Raw」废止**：Raw 令 clone/公开页 parentId 全 undefined；`RawNodeRecord` 收归 docShape 内部不导出）；**fillDoc 只收 StoredNodeRecord**（`toDocRecord` 删或改 `(n,placement)` 签名）；三函数读模型维持 v5（strict 只用于写输入/total=装载读+投影热路径——同层合法项后层尾+id tie-break 落位+计数/公开快照 total-ordered）；`doc-shape-invalid` 只留 doc 级结构失败维持；运行期坏 order=计数+close 违规连接+total 服务维持；repair-doc-order 离线工具维持；正则+「不得以 `0` 结尾」不变量维持；**guard=v7 shadow 默认**（§3.6-v7——C0a「达标档」勘误为「解析可行/部署 shadow」：`COLLAB_CONTENT_GUARD=off\|shadow\|enforce` 默认 shadow 零拒帧；主路径=post-apply 检测；enforce 需 shadow 期数据+yjs pin+conformance spec）；G13 allowlist 口径维持 v5 | §2.1 |
| **Z3''（v6 微修）** | D5 层序+接线闭合维持；**`DOC_NODE_KEYS=['id','type','placement','position','width','height','data']` 独立三处接线**（fillDoc.keys/validateWriteBatch fillDoc+required placement/manifest path）——**NODE_ENVELOPE_KEYS 不动**（投影面 CanvasNodeRecord.parentId 锚——v5「改 placement 键」笔误废止）；renderCanvas Pass2/ensureParentFirst 恒等断言维持；ensureParentOrder 中间态策略维持；checkProjectionInvariant 补序断言维持 | §2.3 |
| **Z4''（v6 重写）** | **rebalance=loadDocument 内+先算后写+purpose gate**：位置=hook 窗口无帧可达维持 v5（:357 实证）；**先算后写**（全部新 placement 纯函数计算+校验——可中止于零写入；apply 段只 set 预校验值不再抛〔Yjs transact=try/finally **无回滚** yjs.cjs:3438-3463 实证——v5「异常→保留长键」措辞废止；Yjs 内部异常=进程级故障，下次物化幂等重跑〕）；**失败仍重测 docTruth**（finally 段一次 encodeStateAsUpdate——防配额真值失真）；**purpose gate**（withSession read/ephemeral 探针/快照 fallback 经 `openDirectConnection(name,{purpose:'read'})` 传 context〔cjs:1632/d.ts:219-229 实证〕→loadDocument 跳过重排——读路径零写放大；仅 WS 首连与 mode:'write' 物化重排）；**失败 backoff**（进程内 Map<projectId,failedAt> 5min+`rebalance_skipped_total{reason}`）；删维护锁四件/quota 门维持 v5；origin=MAINTENANCE_TRANSACT_ORIGIN/pendingStructs 跳过/按 parent 整层维持 v5；**v7 保序**：按层 `(oldOrder,id)` 排序+**整层重排**（混合长短键层不半排）+**定宽 base31 序号键**（字典序=序数序——bijective 变长不保序）+**预算门**（节点数>20k 或计算段>100ms→跳过+计数交维护窗）+触发条件加「同层重复键>3」；**v7 in-place 维护窗**（§2.2-v7）复用本函数（freeze 期间 force 档）；purpose gate 传全 `openDirectConnection` 调用点（residency 现不传 context——v6 漏接线） | §2.4 |
| **Z5''（v6 微修）** | **applyIntrinsicFit 判据=`natural.mediaId===data.fileId`+sizeMode==='auto'**（v5 natural\* 键存在性判据改对象 mediaId 匹配——旧 fact 永不误配）；**load 时扫描**（probe 无人在线完成后→load/applyDocToStore 后一次 auto+natural 扫描，对缺 wh/比例变化节点 fit——单事务+Geometry origin+去重；否则 natural 已在 doc 而 update 事件永不触发）；**sizeMode 缺省规则定死**（无 sizeMode∧有 wh=author；无 sizeMode∧无 wh=auto；工厂按类型写）；**`data.aspectRatio` 键删除**（fit 派生即时计算——v5「aspectRatio 初始值废止但 WHITELIST/类型残留」半删除状态勘误，WHITELIST/ImageNodeData 同步清）；**viewer 语义**：applyIntrinsicFit=纯函数（doc 记录+natural+sizeMode→wh）——editor 写 doc（Geometry origin），viewer 本地派生同值渲染（不写 doc/不入 undo；checkProjectionInvariant 对 readOnly 会话豁免 wh 比较——同纯函数同值保证收敛）；工厂默认 wh=布局兜底（auto 档）/视频语义由 sizeMode 承载/currentWH 从 doc 读/三分类写者/lastAppliedNatural 去重维持 v5 | §3.2 |
| **Z6''（v6 微修）** | readOnly 机制+resync 三路维持 v5；**onNodesChange dimensions 分表细化**：无 setAttributes 的 measured=**始终本地应用**（RF 测量不写 doc）；带 setAttributes 的 resize=**用户命令**（viewer 拒+editor 走 commitAuthorSize）——v5「dimensions 始终本地」会把 viewer 拖 resizer 也放行（本地改尺寸 doc 零写下次投影回弹）；cascadeDeleteVideoProject gate 前置/nodeStore 命令/投影机制分离/undo 门/write-rejected 节流维持 v5；断言=零 local-origin update+本地命令零写 | §3.3 |
| **Z7''（v6 重写）** | **probe 链路（HTTP 写端口，不直连 collab）**：**probe worker 走 `HttpCollabWritePort.writeOpsBatch`→`/api/collab/doc/write-batch`→writeBatch→applyWriteOpsToDoc**（worker 无 collab server——worker.module.ts 端口形态三令牌/withDoc NotImplemented 实证 §1.7；现成链路勿绕开）+**probe 专用 strict 写结果档**（瞬态/永久真实分型+有界重试——防退款档合成 written:true〔:203-206/:263〕对 probe=静默丢不重试）；**三绑定洞补齐**：①新节点=客户端先生成 nodeId 传 presign（addNode 复用同 id）**或 attach 端点**（`POST /projects/:id/nodes/:nodeId/media`——服务端校验项目 EDITOR+media.projectId+node.data.fileId 一致后读 Media.metadata 写 natural；probe 未完成返 queued）②副本=probe 完成后按 `projectId+data.fileId===media.id` 扫描 doc 批量写 natural（probe 低频 O(n) 可接受——duplicate/paste 在 probe 前创建的副本不再永久 fallback）**+复制命令（duplicate/paste/mergeStoryboard）在 addNode 后自动 attach**（覆盖 probe 已完成后创建的副本——读源 Media.metadata 写 natural，〔C0a 补充项〕）③媒体替换=服务端单事务 read-check-write（node.data.fileId 与 mediaId 不匹配→typed `'stale-media'` written:false——旧 probe 永不覆盖新事实）；**v7 probe 状态机+全路径入队**：`Media` 增 `probeState(pending|running|done|failed|skipped)/probeAttempts/probeError/naturalWidth/naturalHeight/naturalRotation` 列（**Media.status=上传态非 probe 态——勿混用**）；**入队收口 `MediaProbeService.enqueue(mediaId)` 挂全部 media.create 路径**（confirmUpload/ai-download/ai-image-edit/lighting/media-process.uploadAndCreateMedia/stitch/trim/separate/generated-media.register——v6 只挂 confirm=**AI 产物永不被探测**〔§1.8 实证 6 类空话〕）；jobId=`probe_${mediaId}`（**BullMQ 5.75.1 冒号抛错实证**）+attempts/backoff 显式+sweeper（pending/failed/running 卡死>10min 重置/超 3 次 DLQ）；**复用 MediaProcessService 补 `detectNatural`**（不新建平行模块——第二真源禁则）+stream 落临时文件（MinioService 仅 getObject 流实证）+sharp `limitInputPixels:100M`+`concurrency(1)`+ffprobe 15s 超时+MIME magic bytes 嗅探；**probe 事实写 `metadata.probe={width,height,rotation,probedAt}` 专属字段**——**attach 只信 probeState=done+metadata.probe**（raw width/height 两污染源：旧 detectMetadata 无 rotation/generated-media.register 收客户端宽高）；**EXIF 全 1-8 档**（2/4/5/7 镜像档）+视频 rotation 负角归一；**队列装配拆分**（producer=API 侧 BullModule.registerQueue〔storage.module 无注册实证〕/processor=WorkerModule providers 平铺〔Nest imports 单向〕）；**attach 用户鉴权独立 controller**（AuthGuard+`perm.assertEditor`〔实存〕——write-batch 控制器是 worker token 面）；Media.projectId 可选维持（**attach 允许 projectId=null 素材库**——校验 teamId 可访问+项目 EDITOR+attach 时补写 Media.projectId/nodeId 两列）；**副本补写=复制命令自动 attach（O(k)）**——全 doc fileId 扫描降级低频修复扫描（100/批限流）；**服务端写面统一 bindMedia 单事务**（读-检-写 {fileId,natural}——AI 交付/attach/复制/扫描全走此口；expectFileId 全 op CAS 见 Z1''-v7）；**TTL 重试废止改 attach 兜底维持**；E8 锚/8 类矩阵维持 | §3.1 |
| **Z8''（维持 v5）** | 工厂类型感知：text/image/video/imageExt/multiImage 写默认 wh（sizeMode:'auto'）；auto/storyboard 组不写 wh（0 帧键）；storyboard 子节点写 wh（网格单元）；audio/videoEdit 补默认（片 B2 定）；`fallbackSize` 单函数+reason 标签+去重计数；happy-path=0 | §3.4 |
| **Z9''（v6 微修）** | 版本双 bump 3（A1 首任务）+**reset runbook 九步（v7 拓扑真实化）**：①**持久 maintenance mode**（`MAINTENANCE_MODE` Redis/env——assertWriteAdmitted/write-batch/presign/confirm/project.create 统一 503 COLLAB_MAINTENANCE+Retry-After；**不自动解除**——drain 60s 自动解除不可依赖）+**队列 pause**（BullMQ 全队列 pause 等待 active=0——重试对 truncate 后空 doc 回灌面） ②**停 flowweb-api+flowweb-worker 两进程**（**v7 拓扑勘误：ecosystem 仅此双进程实证——collab 在 API 进程内，「SIGTERM collab 进程」不存在**） ③清 spool/quarantine ④**pg_dump 备份**+truncate CanvasDoc/CanvasDocUpdate+`Media.nodeId` 置 null+probeState 重置 pending（re-probe） ⑤清 Redis（SCAN 白名单 bull:*/lease/quota——非 FLUSHDB） ⑥部署 api+web+worker 同窗 ⑦IDB 键自然失效+seed/gate 重生成 v3+**`DEPLOY_EPOCH` 校验**（doc meta+job data 带 epoch——旧 epoch 拒载/丢弃：「进程没停也不回灌」的结构保证） ⑧解除 maintenance+冒烟 ⑨**二轮 truncate 验证零回灌**；回滚=restore 备份+redeploy v2+清 IDB（v3 单向门维持）；`doc-shape-invalid` reason 档维持（**v7：进 TERMINAL_AUTH_REASONS**〔防无限重连〕**但不进 COLLAB_VERSION_TERMINAL_REASONS**+manual-recovery close action 导出/重置入口）；Y1c SCHEMA=4 折叠进 3维持 | §6 |
| **Z10''（v7 微修）** | **v7 循环 import 破除**：抽 **`collab-doc-ops.ts` 纯函数模块**（applyWriteOpsToDoc/applyOpsCore/rejectionsOf/全部原语——零 Nest import；两 service 只 import 纯模块〔writer:59-69 反向 import 实证——document.service 调 writer 内函数必成环〕，P0-pre 前置）；校验链收口维持 v5（表驱动 Record+applyOp switch+never+单写面收编薄包装+manifest.test 显式同步）+**DocWriteOpSpec 改逐键 `ValueSpec`**（`{types,integer?,min?,max?,keyMaxBytes?}`——natural 对象键进 `exemptValueKeys` 显式豁免〔结构测试断言 keys−exempt==valueTypes keys——不偷偷跳过〕）；**`Object.hasOwn` 取代表 `opName in`**（命中原型链——补 toString/constructor 输入用例） | §3.1 |
| **Z11''（v6 重写）** | **客户端零写无例外**：`SERVER_ONLY_DATA_KEYS`=natural/resultUrl/videoUrl/result/errorCode（v5 naturalWidth/naturalHeight 两键改 **natural 单键**）；**addNode 工厂 natural\* 例外删除**（v5 三矛盾根修——剪贴板 blob/未上传 split/标注产物=无 Media 行→无 natural，默认 wh+fallbackSize；要固有尺寸先上传成 Media 走 probe 链）；「服务端写晚于本地写天然 LWW 胜出」表述**废止**（并发同键由 YATA 序裁决非墙钟——CRDT 事实）；**v7 strip 四点**（v6 两点=复制/粘贴携带 natural 与禁写门打架——copyPlan structuredClone data 实证）：①nodeStore updateNodeData/updateConfig patch 入口过滤（剔键保留 existing 非 delete）②`applyIntentToDoc(addNode)` data 剥键 ③`diffProjectionToIntents` addNode data 排除 ④copyPlan/assembleRecords 副本 data 剥键；`applyIntentToDoc(updateNodeData)` skip+diff 数据键排除维持；**deleteNodeDataKeys 对服务端域键删除=typed 拒**（strip 只管 set 面——删除面显式定义）；**content 双写者不禁维持；fileId 客户端可写维持+升级为安全风险登记**（偏离表 #4——Y1b 内 attach/bind 校验 media 归属〔teamId 可访问+EDITOR〕+Y2 server 子 map 收编目标形态）；`ImageNodeData/VideoNodeData` natural 对象类型声明 | §3.2 |
| **Z12''（v7 重写）** | **allocator 收口 doc 写边界**：intent **只带锚不带 order**（`addNode{node:RawNodeRecord, afterId?}`——store 工厂无 doc 上下文构造不出 placement；v6「addNode.node=DocNodeRecord」与「buildNodeBase 产 Raw 再补」自相矛盾根修）；**唯一分配入口 `allocatePlacement(doc,parentId,anchor:{afterId?})`**（读同层 (order,id) 序——层尾/锚点间分配，applyIntentToDoc 内调用）+**批量 allocator `allocatePlacements(doc,items[])`**（虚拟层状态：已分配新键参与下一次 between——mergeStoryboard/paste/duplicate 同批新父未入 doc 场景）；**判别联合改 `parentId: string|null`**（null=脱离到根——现 `parentId:undefined` 删键语义的调用点显式迁移：出组 :1434/:2196 实证）；**37 处 updateNodeEnvelope 引用点全迁移**（addToGroup/ungroup/dropIntoGroup/dropImageIntoStoryboard/diff parentId 变更/组 resize/attachMember——v6 只改 addNode 工厂不够）；**本地命令后受影响层 reorderCsLayer**（命令级非拖拽帧级——cs 数组序立即=doc 层序）；placement 复合单键/order 不可删/copyPlan 副本新键+子层分配/assignSeedOrder/undo 回放原 placement 维持 v5；**placement/natural 整对象 set 禁原地 mutate**（DEV Object.freeze+census 禁赋值式改键）；**NODE_ENVELOPE_KEYS 不动**；fillDoc/applyRecordToYMap/applyIntentToDoc/DOC_NODE_KEYS/manifest/键集表写 placement，readRecordsFromMaps 读 placement 派生维持 | §2.5 |
| **Z13''（维持 v5）** | harness 载体+投影纯函数抽取+期望序五件套+参考模型+真连三条+并发用例（G17） | §2.6 |
| **Z14''（v7 勘误）** | **normalizeForSeed 收编五路径**（seed/clone/template/exportFresh/**vacuum**——`rebuildVacuumDoc` 实为 readRecordsFromMaps→fillDoc〔registry :629 一手实证；v6「vacuum=纯 deepCopy 不走 fillDoc」裁决文本**错误**〕：缺 placement 会打断**恢复路径**——vacuum 走 normalizeForSeed 后其余根照旧 deep-copy 保 exec/meta）；**DOC_KEY_MANIFEST placement 拆两行**（客户端写=client-undo/服务端 Maintenance 写=server-only）维持；MinimalCSNode 派生 order/`toDocRecord` 改 `(n,placement)` 签名或删/buildDocFromSnapshot 走 assignSeedOrder/CanvasIntent.addNode.node 类型改 **RawNodeRecord+afterId**（Z12''-v7）/禁 synthetic key 回写服务中 doc 维持 v5 | §2.5 |
| **Z15''（v6 微修）** | cs 面=**`CanvasStoreNode`**（RF Node 泛型+order 派生只读——v5「ProjectedCanvasNode」名废止）；`projectIntentToStore` updateNodeEnvelope 分支补 placement 派生 order 投影维持；allocator 时序定死维持；diff 数据键排除维持 | §2.5 |
| **Z16''（维持 v5）** | multiImage previewSize/renderCanvas·snapshot-filter 恒等断言/fallbackSize 去重/CLIENT_PROTOCOL_VERSION 注释 | §2.3/§3.4 |
| **Z17''（v6 新）** | **storyboard 双序源定案**：`data.cells`=槽序权威（增删/重排 cell 只写 cells）；`placement.order`=绘制序（层序 DFS 消费）——两者在 cell 增删/重排时**镜像同步**（addImageToStoryboardCell/mergeStoryboard 写 cells 同时写对应子 placement）+对拍用例（cells 序==子 placement 层序——禁两源漂移）；`renderCanvas` 分镜子 cellNodes 按 cells 序输出（现 childrenByParent 迭代序=双源漂移点 §1.7 实证） | §2.3 |

## 0.2 裁决定案（六项——2026-10-18 用户确认；此前 v5 为待裁清单）

| # | 项 | 定案 |
|---|----|------|
| ① | 零新 op | **维持**——natural 单对象+writeNodeData 两 op 承载（fileId 交付/natural 写拆元素） |
| ② | 出清出口 | **v7 改 in-place 维护窗**：freeze（新 FreezeReason）不关连接→persistence 收敛→in-place rebalance→`orderEpoch`→解冻（见下「② 修订」——v6 close-all 不可达否决） |
| ③ | 片序 | **不采纳 R1/R2 拆分**——单列车+**P0-pre 前置片**（v7）；**B1a（只读命令门）v7 改必做**（nodeStore 五命令门/deleteNode 级联/onNodesChange 善后段/onConnect 门——v6「可选」下 G8 无承载） |
| ④ | Y1c schema | 本批固定 **3**；Y1c-2 若入上线批**折叠进 3**维持 |
| ⑤ | 键长参数 | **v7 重定**：生成器换 integer-part 方案（§2.2-v7）——soft/hard 参数以新算法 10k append/prepend 实测落（G29 硬验收；中点算法旧参数〔soft32≈500 次追加即触〕废止） |
| ⑥ | UI 变更面 | **可接受变更清单**（B3 签字）：组子树整体 z 序/text 盒内裁剪/viewer 不回弹/视频 probe 前占位/**in-place 维护窗 UX**（v7）/doc-shape-invalid 恢复入口/**viewer 拒 setAttributes resize** |

**② 修订（v7·用户确认 2026-10-18）**：维护流程=**in-place freeze+重排+orderEpoch**（不做 close-all 卸载——v6 close-all 链路机械不可达：maintenanceUntil 拒新连接=无人触发再物化、done 广播无连接、离线客户端旧键 LWW 复活、undo 栈复活旧键；56ms@10k in-transact 实测安全）。
**① 维持（v7 确认）**：零新 op 维持——natural 单对象+expectFileId 全 op CAS+strip 四点+bindMedia 单事务闭合所有权；**server 子 map（data 引用/server.media 事实分离+writeServerState）登记为 Y2 目标形态**。
**附 D6 修订（v7·用户确认）**：**改形+移 B2**——「auto 组仅 position 键」与 `assertNoAutoGroupFrameKeys` 冻结断言冲突实证（auto 组携任何帧键含 position 即违例）→改 **`data.autoOrigin` 显式非帧键**（空 auto 组 origin 持久化）+fallbackOrigin 退役；不占 A1（不与 placement 同刀）；空间序 id tie-break 维持 A1。

## 0.4 偏离登记表（滚动——实现与设计的差异单源）

| # | 偏离 | 落地形态与依据 |
|---|------|----------------|
| 1 | **E15 键长上限**（master「≤32」） | 本批语义=soft 32 触发出清（非硬上限）+hard 128 安全网（§0.2-⑤ 定案）——表述差异登记，master 目录表回填 |
| 2 | **cellCount**（master Y1b：stitch/trim/separate 载荷） | 不做（零读者）维持 |
| 3 | **fileId 客户端可写**（updateConfig 整包写 data 可覆盖服务端产物引用——nodeStore :632） | **Y2 已知缺口登记**（Y1b 禁写门不含 fileId——双写者裁定维持；Y2 投影合成收编） |

## 1. 基线快照（2026-10-18 六轮一手核验；行号=master 96056a52）

### 1.1 序域与投影链

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [nodeOrder.ts:17](../../../apps/web/src/utils/nodeOrder.ts) ensureParentOrder | 拓扑输出（父先子后/环跳过）；setWithParentOrder（groupNodes/ungroup/move 中间 set）也调它——中间态非层序 | D5/Z3'' |
| [canvasCollabRuntime.ts:1870/:1906](../../../apps/web/src/stores/canvasCollabRuntime.ts)+onRemote 50ms timer | applyDocToStore 三调用点均无 try/catch——热路径 throw=白屏/卡水合（实证） | Z2''：enterDocInvalid catch 层 |
| [docShape.ts:138-166](../../../packages/shared/src/canvas/docShape.ts) | 裸迭代序 total 出口 | Z2''：total 维持+严格读新函数 |
| [docShape.ts:264-296](../../../packages/shared/src/canvas/docShape.ts) applyKeySetTable | 逐键显式构造——表外键静默丢（stripAuthorState/种子路径；auto 组 keepPosition=false） | Z3''/G24（D6） |
| [nodeEnvelope.ts:15/:19-26](../../../packages/shared/src/canvas/nodeEnvelope.ts) | **CanvasNodeRecord.position 必填**；NODE_ENVELOPE_KEYS 双向编译锚七键（parentId 非 placement） | Z2''/Z3''-v6：键集不动+四类型 |
| [projectCanvasNodes.ts:37](../../../apps/web/src/utils/projectCanvasNodes.ts) | 末尾 `as CanvasNodeRecord` 强转（条件展开缺 position 后强转——G13 v4 字面必红） | Z2''-v6：ProjectedRecord+cast 删 |
| [canvasIntents.ts:38-44](../../../apps/web/src/stores/canvasIntents.ts) NodeEnvelopePatch | 恰五键（type/parentId/position/width/height）无 order | Z12''：placement 判别联合 |
| [canvasIntents.ts:173](../../../apps/web/src/stores/canvasIntents.ts) | **moveNode 直读 `m.get('parentId')`**——parentId 直读 census 面（v6 复核） | Z12''-v6：只经 placement 派生+census 门禁 |
| [canvasIntents.ts:462-481](../../../apps/web/src/stores/canvasIntents.ts) diffProjectionToIntents | addNode 无 order；updateNodeEnvelope 只比五键 | Z12''：cs 携带派生 order |
| [copyPlan.ts:53-101](../../../packages/shared/src/canvas/copyPlan.ts) | 复制不重分配序 | Z12''：副本新键+子层分配 |
| arrangeSelection:79/geometry:68 | 落格/拼接空间序（四消费点）——**无 id tie-break** | G25（D6 附带） |

### 1.2 尺寸域

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [geometry.ts:301-322](../../../packages/shared/src/canvas/geometry.ts) contentEventSize | 三分支；ratioChanged 需 existingAspectRatio≠null（:310-315 「类型谎言」+非空断言） | Z5''-v6：sizeMode+natural 判据取代 |
| reportNodeSize 7 调用点 | 内容事件拟合/错误兜底/resize 卸载/multiImage 派生；真测量链=dispatchFixtureSizeIntents | C5 删除对象 |
| [canvasStore.ts:778-788](../../../apps/web/src/stores/canvasStore.ts) addNodeInner | text 300×300/videoEdit width=320 无 height；image/video/audio 无默认 | Z8'' |
| [docShape.ts:324](../../../packages/shared/src/canvas/docShape.ts) measured 注记 | MinimalCSNode 类型注记 | 删除面 |
| DEFAULT_CHILD_SIZE | 8+ 消费点 | Z8''：单函数+去重 |

### 1.3 只读域

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [canvasUndo.ts:67-105](../../../apps/web/src/stores/canvasUndo.ts) | undo/redo 无 canEdit 门 | Z6'' |
| [nodeStore.ts:524-560/:632](../../../apps/web/src/stores/nodeStore.ts) | addNode/updateNodeData/deleteNode 无门（命令+投影双调用）；**updateConfig 整包写 data** | Z6''/偏离表 #3 |
| [canvasStore.ts:1529-1530/:1648/:1699](../../../apps/web/src/stores/canvasStore.ts) | onNodesChange 无条件 applyNodeChanges+cascade 在 gate 前 | Z6''-v6：dimensions 分表+级联前置 |
| [hocuspocus-server.cjs:295-313](../../../node_modules/.pnpm) | 库层 readOnly 发 SyncStatus(false)（实证） | Z6'' |
| guardSyncFrame（doc-registry:677/:706-746） | 帧闸 1009；readOnly=app 层 return+计数 | §3.6 挂点 |
| [canvasStore.ts:230-234](../../../apps/web/src/stores/canvasStore.ts) diverged 闩锁 | 三出边+boot-diverged 持久恢复 | Z6'' |

### 1.4 服务端写面与产物绑定

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [collab-document.service.ts:215-217](../../../apps/api/src/modules/collab/collab-document.service.ts) | writeNodeData 直连 applyWriteNodeDataToDoc 原语——不经 validateWriteBatch（`{a:1}` written:true 测试背书） | Z10''/G18 |
| [collab-document.service.ts:286-300](../../../apps/api/src/modules/collab/collab-document.service.ts) | 无条件 set（无同值短路）；WriteNodeDataResult 仅 {written,reason} | Z1''-v6 |
| [collab-doc-writer.service.ts:87-92/:104/:128-135](../../../apps/api/src/modules/collab/collab-doc-writer.service.ts) | WriteOpResult 四字段；applyWriteOpsToDoc 现存（单写面收编载体）；op 级违规→整 op written:false | Z10''/G15 |
| [execution.gateway.ts:116-126](../../../apps/api/src/modules/gateway/execution.gateway.ts) | emitStitchStatus 带 wh/cellCount；separate/trim 无 | Z7''：C0a 8 类矩阵 |
| [canvas-doc-manifest.ts:83/:173-230/:332-417](../../../packages/shared/src/canvas/canvas-doc-manifest.ts) | SERVER_NODE_DATA_KEYS 六键；valueTypes typeof 四型+keyMaxBytes 单值；validateWriteBatch if 链（`opName in` 命中原型链） | Z1''/Z10''-v6（ValueSpec/Object.hasOwn） |
| readCanvas 消费面 | 单出口六消费者：execution 计费:167/video-project:98/video-work-clone:33/REST:24/探针:259/write port:51 | Z2''-v6：返 RawNodeRecord |
| `validateNodeRecord`/`SERVER_ONLY_DATA_KEYS` | 全仓不存在（G1 须列五处调用点） | Z2''-v6/G1 |

### 1.5 版本与装载面

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| docShape:41/collab-protocol:8 | schemaVersion=2/csv=2 | Z9''：双 bump |
| [local-cache-key.ts:24-33](../../../apps/web/src/collab/local-cache-key.ts) | 键含 schemaVersion | Z9'' |
| [collab-doc-registry.service.ts:295/:393/:399](../../../apps/api/src/modules/collab/collab-doc-registry.service.ts) | onUpdateDelta 只排除 SERVER_TRANSACT_ORIGIN；loadDocument replay spool+cheap 上界；docTruth=cheap | Z4''-v6/§3.6 |

### 1.6 v5 核验行（三份 v4 外审主张一手复核——2026-10-18）

| 位置 | 事实 | 裁决引用 |
|------|------|----------|
| hocuspocus-server.cjs:278-330 | readSyncMessage 首行 await beforeSync({type,payload:peekVarUint8Array()})（:281）→readUpdate（:318）——pre-apply 且 payload 含原始 update 字节 | §3.6 |
| [collab-doc-registry.service.ts:357](../../../apps/api/src/modules/collab/collab-doc-registry.service.ts) | 「库 createDocument 在 onLoadDocument hook 返回后才 documents.set」——hook 窗口无帧可达；catch 折 db-unavailable（:307-327） | Z4''-v6 |
| withDoc/withSession/readCanvas | 全经 openDirectConnection→loadDocument 同一物化点；doc 常驻期会话复用零重装 | Z4''-v6（purpose gate） |
| [storage.service.ts:37-52/:69-98](../../../apps/api/src/modules/storage/storage.service.ts) | presign media.create 只写 userId/teamId（projectId/nodeId 未落）；confirmUpload 只 statSize+status 无 probe 返回 {fileId} | Z7''-v6 |
| schema.prisma:282-283 / [media-process.service.ts:194-203](../../../apps/api/src/modules/media-process/media-process.service.ts) | Media.projectId/nodeId 两列已存；生成路径已在写 | Z7''-v6 |
| [media-process.service.ts:99-116](../../../apps/api/src/modules/media-process/media-process.service.ts) | ffprobe 只取 wh/codec/bitrate——无 rotation | Z7''-v6/C0a |
| plans 目录 | `2026-10-18-y1a-y1b-*.md` 不存在（writing-plans 产出——预期态） | §4 |

### 1.7 v6 核验行（三份 v5 外审主张一手复核——2026-10-18）

| 位置 | 事实 | 裁决引用 |
|------|------|----------|
| [worker.module.ts:175-179](../../../apps/api/src/worker.module.ts#L175) / [main-worker.ts](../../../apps/api/src/main-worker.ts) | **独立 worker 进程**（NestFactory.createApplicationContext(WorkerModule)）——「端口形态三令牌」：CollabWritePort=HttpCollabWritePort/CollabDocWriterService=HttpCollabDocWriter；**worker 无 collab server** | Z7''-v6（HTTP 写端口） |
| [collab-write.port.ts:231-233/:203-206/:263](../../../apps/api/src/modules/collab/collab-write.port.ts#L231) | withDoc NotImplemented（worker 不消费）；瞬态耗尽/永久/bad-body **合成 written:true**（防误退款语义）——对 probe fact=静默丢不重试 | Z7''-v6（strict 档） |
| yjs.cjs:3438-3463 | **transact=try/finally 无回滚**（f 抛错后已写 struct 保留+cleanup 照常执行）——半重排+docTruth 失真两后果成立 | Z4''-v6（先算后写） |
| hocuspocus-server.cjs:1632 / index.d.ts:219-229 | **openDirectConnection(documentName, context?) 签名实存**；loadDocument(..., context)——purpose gate 机制可行 | Z4''-v6 |
| [mediaUploadUtils.ts:15](../../../apps/web/src/utils/mediaUploadUtils.ts#L15) | uploadImageBlob(blob, projectId?)——projectId 可选（素材库/剪贴板无项目上下文）——presign 必填会打断 | Z7''-v6（projectId 可选） |
| [renderCanvas.ts:46-49](../../../packages/shared/src/canvas/renderCanvas.ts#L46) | 分镜子 childrenByParent 迭代序产出（非 data.cells 槽序）——双序源漂移点 | Z17''-v6 |
| registry observeIdleDocs/shouldUnloadDocument | doc 常驻期（有其他成员连接）单客户端刷新**不触发 loadDocument**——零连接+debounce 才卸载 | §2.2（出清出口） |

### 1.8 v7 核验行（三份 plan v1 外审主张一手复核——2026-10-18）

| 位置 | 事实 | 裁决引用 |
|------|------|----------|
| docShape.ts:378 + 全仓 grep | **现存 `DocNodeRecord`（parentId? 语义）172 处/34 文件**；index.ts `export *` 下新同名导出=TS2308 | Z2''-v7（改名 StoredNodeRecord+ProjectedRecord） |
| collab-doc-writer.service.ts:59-69 | **writer 从 collab-document.service import 全部原语+Service**（:193 @Inject 反向）——document.service 调 writer 内 applyWriteOpsToDoc 必成环 | Z10''-v7（collab-doc-ops.ts 抽取） |
| bullmq@5.75.1 job.js:1037 | **jobId 含 `:` 且 split≠3 段→throw 'Custom Id cannot contain :'** | Z7''-v7（jobId `probe_${mediaId}`） |
| ecosystem.config.cjs:12/:41 | **仅 flowweb-api+flowweb-worker 双进程**（collab 在 API 进程内）——「SIGTERM collab 进程」不存在 | Z9''-v7（reset 拓扑真实化） |
| minio.service.ts:95 | **仅 `getObject(key): Readable` 流**——无 getObjectBytes | Z7''-v7（stream 落临时文件） |
| storage.module.ts | **仅 imports TeamModule——无 BullModule.registerQueue**（@InjectQueue DI 即失败） | Z7''-v7（producer API 侧注册） |
| collab-doc-registry.service.ts:629 | **`rebuildVacuumDoc` 实为 readRecordsFromMaps→fillDoc**（+其余根 deep-copy）——vacuum 是 fillDoc strict 消费者（恢复路径） | Z14''-v7（normalizeForSeed 五路径） |
| assertions.ts:59-68 | **`assertNoAutoGroupFrameKeys`：auto 组携任何帧键（含 position）即违例**——「auto 组仅 position 键」直接冲突 | §0.2-附（D6 改形 data.autoOrigin→B2） |
| canvasStore.ts:846/:850 | **deleteNode 命令路径 cascadeDeleteVideoProject 在 dispatch 之前**（与 onNodesChange 路径是两处） | §0.2-③（B1a 必做） |
| generated-media.service.ts:29 | **register 接收客户端 `width?/height?` 写 metadata**（客户端尺寸污染源）；`perm.assertEditor` 助手实存 | Z7''-v7（attach 只信 metadata.probe/T3 权限闭合） |
| canvasStore.ts:1434/:2196 | 出组=`patch:{parentId:undefined}`、入组=`{parentId,position:undefined}`——**undefined 删键语义 20+ 调用点** | Z12''-v7（判别联合 parentId:null 迁移） |
| C0a order-key-growth 表 | **尾插 maxLen 63@1000（≈1 字符/16 次追加）——追加是画布主路径**（「随机使用不可达」结论口径错误——soft 32≈500 次追加即触） | §2.2-v7（生成器换 integer-part） |

## 2. Y1a 序域设计（D5 分层直译+数据流闭合）

### 2.1 类型链与读出口（Z2''-v7）

- **四型**：`RawNodeRecord`（Y.Map 直出——placement? 缺省合法态/position?/wh?；**docShape 内部不导出**）→ **`StoredNodeRecord`**（validateNodeRecord 规范化写输入——placement 必填；fillDoc/applyRecordToYMap/applyIntentToDoc 只收此型；**不复用现存 DocNodeRecord 名**——172 处冲突实证）→ `ProjectedRecord`（diff/seed/**读出口**——position 可缺+parentId/order 派生，沿用现 DocNodeRecord 语义加 order；`projectCanvasNodes` 返回此型删 cast）→ `CanvasStoreNode`（RF Node 泛型+order 派生只读）。`Placement={parentId: string|null, order: string}` 复合单键。
- **三函数读模型维持 v5**：strict 只用于写输入；total=装载读+投影热路径（同层合法项后层尾+id tie-break 落位+去重计数不抛）；公开快照/clone=total-ordered。**`readCanvas` 返回 `ProjectedRecord[]`**（六消费者零改动）。applyDocToStore catch 层只接 doc 级结构错误维持。
- **运行期坏 order 处置（v7）**：**主路径=post-apply 检测**（§3.6-v7——transaction.changed 只验变更节点+计数+诊断 close code）；shadow guard 计数对账；已入 doc 坏 order=total 落位+计数+close 违规连接；quarantine 只留结构档；**repair-doc-order CLI（G14 承载——v6 缺）**：扫描 max 键长/重复键/缺 placement/非法 placement/natural mismatch→JSON 报告→维护窗内按层重分配（MAINTENANCE origin）。
- **G13 口径维持 v5**：新模块零新增 as+边界 allowlist+allowlist 外 grep 巡检零命中。

### 2.2 分数索引+维护窗（§0.2-②/⑤ v7）

**生成器（v7 换型）**：移植 **fractional-indexing integer-part 算法+测试向量**进 shared（不新增依赖——若用户倾向直接加库依赖亦可；**中点 base32 方案废止**——尾插 1 字符/16 次追加实证）：typed result（含 `key-too-long`）+「不得以 `0` 结尾」+头尾虚拟边界+等值键定死+纯函数；**G29 append-only 硬验收**：10k 尾插 maxLen≤16/10k 头插≤32/10k 随机≤16/重排后 1k 次追加不再触发 soft；单测=移植测试向量+property 10k+头插/同锚/尾插曲线（新算法重测落盘 C0a 报告附记）。
**并发同锚重复键**：**允许重复+读侧 (order,id) 确定性**（分配层不重试——客户端直写架构下唯一低成本根修）；`order_dup_total` 计数+total 读把重复键计入 `doc_integrity_invalid_total{stage:'order-dup'}`；rebalance 触发=「maxLen>soft **或** 同层重复键>3」。

**维护窗（v7 in-place——§0.2-② 修订）**：

- 检测：placement 写面/rebalance 计算段发现触发条件→置 per-project pending+`order-maintenance-required` 广播（现有连接直接收到）；
- 触发：`POST /projects/:id/collab/order-maintenance`（EDITOR）→ **`applyWriteFreeze(conn,'maintenance',true)`（新 FreezeReason——不关连接不卸载）**→ `persistence.writesSettled(pid)`（复用现有三态收敛谓词）→ **in-place `rebalanceIfDue(doc,pid,{force:true})`**（先算后写同函数——56ms@10k 实测安全）→ **`orderEpoch` 写 doc meta（自增）**→ truth 重测→解冻→现有连接直接收 update 重投影（`order-maintenance-done` 广播有连接可发）；
- **离线客户端 fence**：客户端 `synced` 后比对本地 epoch≠doc meta epoch→`UndoManager.clear()`+清 IDB 缓存+全量重同步（防旧键 LWW 复活+undo 栈复活旧键——v6 两缺口根修）；
- 维护窗内客户端写被 freeze 拒（writeFreeze 现有信号面）+服务端 MAINTENANCE origin 写照常；`onUpdateDelta` 排除 MAINTENANCE（quota 口径不污染）；
- hard 耗尽：typed `OrderKeyExhausted`（`key-too-long`）→ 同一端点动作（禁静默拒绝/只提示刷新维持）；
- doc 不在内存：`withSession(write, purpose:'maintenance')` 物化→loadDocument 重排→释放（复用 T18 链路零新代码）。

### 2.3 层序读出口与三面收编（Z3''/Z17''-v6）

- `orderRecords`=pre-order 层序 DFS（每层 (order,id)；孤儿/环=根处理三面同语义）维持 v5。
- **DOC_NODE_KEYS 独立三处接线**（placement 键）——**NODE_ENVELOPE_KEYS 不动**（投影面锚）。
- **storyboard 双序源定案（Z17''）**：cells=槽序权威+order 镜像同步+对拍用例；renderCanvas cellNodes 按 cells 序输出。
- renderCanvas/snapshot-filter 恒等断言/ensureParentOrder 中间态/checkProjectionInvariant 序断言维持 v5。

### 2.4 装载期 rebalance（Z4''-v6）

**C0a 实测**（[spike 数据](2026-10-18-y1a-y1b-c0a-spike-data.md) §3/§4）：10k 重排全程≈56ms（compute 5.8+apply 20.2+truth 29.6——预算充足）；字节收缩 12.9%；中途 throw 半重排+update 照常广播实验实证（G26 红相可构造）；10k 投影全链 p50 15ms/p95 18.7ms（G22 建议达标线 ≤30ms——读侧占 84%）。

**位置**=loadDocument 内、replay/shape 门后、return 前（hook 窗口无帧可达 :357 实证）。**purpose gate**：`openDirectConnection(name,{purpose:'read'})` 的物化（withSession read/ephemeral 探针/快照 fallback）**跳过重排**——读路径零写放大；仅 WS 首连与 mode:'write' 物化重排。**先算后写**：全部新 placement 纯函数计算+校验（可中止于零写入）→apply 段只 set 预校验值不再抛（Yjs transact 无回滚——异常留半层混合键的 v5 缺陷根修）；**失败仍重测 docTruth**（finally 一次 encodeStateAsUpdate）；**失败 backoff**（Map<projectId,failedAt> 5min+`rebalance_skipped_total{reason}`）。删维护锁四件/quota 门维持 v5；origin=MAINTENANCE_TRANSACT_ORIGIN/pendingStructs 跳过/按 parent 整层/仅键长>32/预算实测（耗时+字节）维持。断言：docDelta 不增/不触发 freeze；**WS/写物化恰一次+read 物化零重排**（G5-v6）；重排后首帧投影相对序一致；中途 throw 注入→无半层+truth 一致（G26）。

### 2.5 创建+父变更全路径（Z12''/Z14''/Z15''-v6）

placement 复合单键/判别联合/order 不可删/命令级 allocator/census/copyPlan/assignSeedOrder 维持 v5（详见 §0.1 对应行）。**normalizeForSeed 四路径**（seed/clone/template/exportFresh——vacuum 保留 deepCopyYMap+复制后 placement 规范化可选）；**DOC_KEY_MANIFEST placement 拆两行**（client-undo/server-only）；**cs 面=CanvasStoreNode**；**parentId 直读 census**（grep `get('parentId')`/`set('parentId')`/`delete('parentId')` 全量清单——只经 readRecordsFromMaps/toDocRecord 派生+门禁）。

### 2.6 收敛 harness（Z13''-v6）

载体/五件套/参考模型/真连三条维持 v5；并发用例（G17——含两键形态混键复现反例）维持。

## 3. Y1b 尺寸/只读域设计

### 3.1 natural 服务端权威写（Z1''/Z7''/Z10''-v7）

**写链（v7——全路径入队+状态机+bindMedia 单事务；worker 进程边界实证 §1.7）**：

```
presignUpload(projectId?[, nodeId]) → Media{projectId?, nodeId?, status=pending, probeState=pending}
upload → confirmUpload → statSize+status=completed+**MediaProbeService.enqueue(mediaId)**
  （幂等——probeState=done 直接返回 probeQueued:false；**enqueue 收口挂全部 7 处 media.create 路径**：
   confirmUpload/ai-download/ai-image-edit/lighting/media-process.uploadAndCreateMedia/stitch/trim/separate/generated-media.register）
probe processor（BullMQ 'media-probe'，WorkerModule 平铺；jobId=probe_${mediaId} 无冒号）:
  probeState=running → MIME magic bytes 嗅探（不信 presign fileType）
  图片: MinioService.getObject 流→临时文件→sharp metadata（limitInputPixels:100M+concurrency(1)+failOn:'none'）
        → EXIF orientation 1-8 全档（5-8 交换+镜像档处理）
  视频: ffprobe（15s 超时+SIGKILL；side_data rotation 负角归一 0|90|180|270）
  → 成功: metadata.probe={width,height,rotation,probedAt} 专属字段+naturalWidth/Height/Rotation 列+probeState=done
  → 失败: probeState=failed+probeError（sweeper 重入——pending/failed/running 卡死>10min/超 3 次 DLQ）
  → done 后: bindMedia(mediaId)（HTTP 写端口——worker 无 collab server）
      POST /api/collab/doc/write-batch → writeBatch → applyWriteOpsToDoc（经 collab-doc-ops）
      bindMedia=单 withSession 事务 读-检-写 {fileId, natural}（expectFileId 全 op CAS：
      新节点 expectFileId:null / 已绑定 expectFileId:mediaId——旧 probe 既不回退 fileId 也不写 natural）
  → 节点不存在: node-deleted（attach 兜底，非 TTL）
attach 端点 POST /api/collab/projects/:id/nodes/:nodeId/media（用户鉴权 AuthGuard+perm.assertEditor——独立 controller 非 worker token 面）:
  客户端 addNode 后调用（或 presign 前置 nodeId）
  校验: media.teamId 可访问+项目 EDITOR+node type allowlist → **只信 probeState=done+metadata.probe**（不信 raw width/height 客户端污染源）
  attach 时补写 Media.projectId/nodeId 两列（素材库 projectId=null 允许）；probe 未完成→确保 job 存在+返 queued（绑定已持久化后的承诺）
副本补写: 复制命令 addNode 后自动 attach（O(k)——读源 Media metadata.probe）；全 doc fileId 扫描=低频修复扫描（100/批限流）
```

- **幂等**（同 mediaId 重跑同值——deep-equal no-op）+attempts/backoff+sweeper；旧 probe 迟到→stale-media typed false（**永不覆盖新事实/不回退 fileId**）。
- **服务端 type allowlist**（原语层）：`MEDIA_ELIGIBLE_TYPES` 自节点类型清单派生（imageGen/imageExtGen/videoGen+storyboard 格子经父组 groupType 判定；text/group/audio/multiImage/videoEdit typed 拒）。
- **8 类产物绑定矩阵维持**（C0a 产出）——全类经 enqueue 收口入队。
- **单写面收编**：writeNodeData/writeExecStatus=applyWriteOpsToDoc 单 op 薄包装（**经 collab-doc-ops 纯模块**——环破除后）。
- **校验链**：DocWriteOpSpec 逐键 ValueSpec（natural 进 exemptValueKeys 显式豁免）+Object.hasOwn+表驱动+switch+never。
- `SERVER_NODE_DATA_KEYS` 以 natural 单键替代 naturalWidth/naturalHeight（manifest 矩阵扩缩对称）。

### 3.2 三分类写者+禁写门（Z5''/Z11''-v6）

单写者三分类维持（commitIntrinsicFit/commitAuthorSize/commitLayoutSize）；**applyIntrinsicFit=纯函数**（判据 natural.mediaId===data.fileId+sizeMode==='auto'）——editor 写 doc（Geometry origin）/viewer 本地派生同值渲染（不写 doc；invariant readOnly 会话豁免 wh 比较）；**load 时扫描**（applyDocToStore 后一次 auto+natural 扫描——probe 无人在线完成的 fit 补触发）；**sizeMode 缺省规则**（无 sizeMode∧有 wh=author；无 wh=auto）；**data.aspectRatio 键删除**（WHITELIST/类型声明同步清）；**禁写门**：SERVER_ONLY_DATA_KEYS=natural/resultUrl/videoUrl/result/errorCode——patch 入口过滤+applyIntentToDoc skip+diff 排除；**addNode natural 例外删除**（无 Media 行→无 natural，默认 wh+fallback）；**content 双写者不禁；fileId=Y2 已知缺口登记**；`ImageNodeData/VideoNodeData` natural 对象声明。

### 3.3 只读命令边界+resync 分流（Z6''-v6）

命令入口 gate 维持 v5+**dimensions 分表细化**：measured（无 setAttributes）=始终本地应用（RF 测量不写 doc）；setAttributes resize=用户命令（viewer 拒+editor 走 commitAuthorSize——v5「dimensions 始终本地」会把 viewer 拖 resizer 放行后回弹）；cascade 前置/nodeStore 机制分离/undo 门/write-rejected 节流/resync 三路（viewer 不自动 discard/冻结解除完整重连/结构档终态禁重放）/闩锁全保留维持 v5；断言=零 local-origin update+本地命令零写+VIEWER 键盘矩阵+降级中拖拽不提交+冻结→解冻 resync 收敛。

### 3.4 创建默认与兜底（Z8'' 维持 v5）

工厂类型感知（组不写 wh 0 帧键/storyboard 子写网格 wh/audio·videoEdit 片内定）；fallbackSize 单函数+reason 标签+去重计数；happy-path=0。

### 3.5 删除面（收窄）

删 dispatchFixtureSizeIntents+RF dimensions 首测固化链+measured 类型注记+**data.aspectRatio 键**（WHITELIST/类型）；reportNodeSize 收口三分类；contentEventSize 及 existingAspectRatio 依赖收编进 applyIntrinsicFit 判据；grep 全零+台账核销。

### 3.6 入口 guard（v7——shadow 默认+post-apply 主路径）

**前置事实**（§1.6/§1.7 实证）：beforeSync pre-apply 且 payload 含原始 update 字节——hook 层可行；Yjs struct 无路径需「类型 ID→路径」映射；C0a 原型 9/9 全绿（解析**可行性**实证）。**v7 档位勘误（C0a「达标档」降级）**：三份 plan 外审收敛的部署级反对称性成立——①超阈帧 fail-open=最大的帧不查（拆帧绕过面）②SyncStep2 整帧拒绝=丢全部离线编辑+重连风暴（误报代价=用户数据 vs 漏报代价=短暂脏值——不对称）③私有结构依赖（`_map`/`store.clients`/decodeUpdate）=yjs 升级即事故 ④增量索引清理未设计。

**处置（v7）**：
- **`COLLAB_CONTENT_GUARD=off|shadow|enforce`，默认 shadow**：shadow=只解析+计数+日志（`guard_shadow_reject_total{reason}`）**零拒帧零 close**；C0a 原型（origin 链解析/覆写豁免/DeleteSet 反查五机制）作为 shadow 引擎移植。
- **主路径=post-apply 检测**：`doc.on('update')` 事务上读 `transaction.changed`（nodes map 变更键）→只校验**本次变更节点**的 placement/natural/服务端域键→违规计数+日志+对该连接发**诊断 close code（非 terminal——防重连风暴）**；坏数据短暂进 doc 由 total 读+repair CLI（G14）兜底——E68 相容。
- **enforce 条件**：shadow 期一个发布周期的 `guard_shadow_reject_total` 与 post-apply 检测对账（误报率≈0）+yjs 版本 pin+`guard-contract.spec`（断言 `_map`/`store.clients`/item.parent 形态——升级即红）；enforce 档只允许两条窄规则（①客户端写 SERVER_ONLY_DATA_KEYS ②删 placement 键）且仅 <64KB 帧生效。
- 帧闸/readOnly/quota 维持（guard 只加不减）；**删 natural/fileId 键的 DeleteSet 检查**（v1 原型缺口——post-apply 检测天然覆盖）。
- G16 绿判据 v7：shadow 计数与 post-apply 检测**双路对账一致**+正例矩阵零误报；**禁断言 post-apply 拒帧**维持。

## 4. 片序与执行门（v7：P0-pre 前置+B1a 必做；每片出口=用户确认点）

| 片 | 内容 | 出口判据 |
|----|------|----------|
| **C0a（spike）** | （v6 已完结——v7 勘误两条入 [spike 数据](2026-10-18-y1a-y1b-c0a-spike-data.md)：§1 尾插口径+§5 guard 档位） | ✅（历史） |
| **P0-pre（v7 新增·机械前置）** | ①**类型机械迁移**：现 `DocNodeRecord` 改名 `ProjectedRecord`（加 order）+新 `StoredNodeRecord` 写型+`RawNodeRecord` 内部化——**172 处引用纯改名 commit（零行为变更）**+`readCanvas` 返回 ProjectedRecord（六消费者锚）②**抽 `collab-doc-ops.ts`** 纯函数模块（破 writer→document 环——writer:59-69 实证）③**队列装配拆分**（media-probe producer=API 侧 registerQueue/processor=WorkerModule 平铺占位）④**Prisma probeState 状态机列** migration（+bindMedia/attach 契约定案） | `pnpm -r typecheck` 三面绿+无同名 DocNodeRecord+Nest DI 图可解析+**零行为变更**（全部既有测试绿） |
| **B1a（v7 必做）** | 只读命令门：**nodeStore 五命令门**（addNode/deleteNode/updateNodeData/updateConfig/updateText）+**deleteNode 命令路径级联门**（:846 前置）+onNodesChange **善后段全门**（ns.deleteNode/cancelNodeProcess/patchGroupData/ungroup）+onEdgesChange/onConnect **edges set 门**（:1702-1717）+undo/redo 门+dimensions 分表（**setAttributes 判定前置**——先判后 apply）+统一 `assertCanEditCommand`——零 schema/natural 依赖 | VIEWER 全命令矩阵零 local-origin update+零 DB 副作用（G34） |
| **C0b（服务端事实写·v7 重构）** | manifest ValueSpec+expectFileId 全 op CAS+单写面收编（经 collab-doc-ops）+**bindMedia 单事务**+presign 落两列+confirm probeState 状态机+**MediaProbeService.enqueue 挂 7 处 media.create**+detectNatural（复用 MediaProcessService）+processor 平铺+jobId `probe_`+sweeper+attach 用户 controller+metadata.probe 专属字段+**strip 四点**+E8 先红 | E8 逐类绿（G32——AI/upload/trim/stitch/素材库全入队）+两路径同表（G10/G18）+typed false 不 throw（G15）+stale-media 双向 CAS（G27）+先红留档 |
| **A1（doc 契约·v7 修订）** | 版本双 bump 3+**四型链接线**（P0-pre 已改名——本片接 placement 语义）+DOC_NODE_KEYS 三处+validateNodeRecord（拆 record/patch 两函数）五处+**allocatePlacement/allocatePlacements doc 写边界+intent afterId 锚**+**37 处 updateNodeEnvelope 调用点迁移+判别联合 parentId:string\|null**+normalizeForSeed 五路径（含 vacuum）+reorderCsLayer+空间序 tie-break+doc-shape-invalid reason 档（TERMINAL_AUTH_REASONS+manual-recovery） | adversarial 仍绿+tsc 挡构造+addNode 经 allocator 通过+**reparent/detach/copy/paste/merge 全过 strict**（G1/G30）+旧 csv/schema/IDB（G11）+空间序（G25） |
| **A2（序域主线·v7 修订）** | **integer-part 生成器移植+测试向量**+orderRecords 三函数+**参考模型 property 对拍**+三面收编（含 renderCanvas/snapshot-filter/video-work-clone——文件表补齐）+placement 写链+legacy 禁写+parentId census+装载期 rebalance（先算后写+**保序〔按层排序+整层+定宽〕**+purpose gate 全调用点+预算门+backoff）+**in-place 维护窗+orderEpoch+离线 fence**+**guard shadow 移植+post-apply 检测**+repair CLI（G14） | 层序三面同序+并发原子（G17）+**G29 append-only 硬验收**+read 物化零重排（G5）+保序断言（G26 附）+**维护演练不重连+epoch fence**（G31）+shadow/post-apply 对账（G16） |
| **A3（harness）** | node config+期望序五件套+参考模型+**双端真连 provider 用例前置**+并发用例 | 红相→绿+seed 复现（G12/G17） |
| **B1（只读收口续）** | enterDocInvalid catch 层（结构档收窄）+doc-shape-invalid 恢复入口+resync 三路+write-rejected 节流+闩锁保留 | G19+解冻收敛 |
| **B2（删除面+写者补齐）** | 删测量链/measured 注记/aspectRatio 键+contentEventSize 收编+**组件级迁移**（ImageGenNode/VideoGenNode/MultiImageNode——删前先改调用点）+工厂类型感知+applyIntrinsicFit（**含 maxW/maxH clamp**+无 Media 粘贴保留本地测量 author 档）+fallbackSize+**D6 改形**（data.autoOrigin 非帧键+fallbackOrigin 退役——G24 v7） | grep 全零+G7/G28+G24（autoOrigin 形态） |
| **B3（终出口）** | verify（+census/conformance 新步）+CI+**maintenance mode/队列 pause/DEPLOY_EPOCH 实现任务前置**+**reset 脚本九步**（--dry-run/--execute+备份+回滚）+UX 签字 | 全绿+G21 两轮零回灌+G33（epoch 旧 job 丢弃）+清单签字 |

## 5. 验收判据与先红门禁清单（G1-G35）

| # | 门禁 | 先红判据 | 绿判据 |
|---|------|----------|--------|
| G1 | order 写侧显式拒绝 | 写边界缺 placement=业务错误码红 | validateNodeRecord **五处**（applyIntentToDoc 写入前/fillDoc 种子/applyRecordToYMap 增量/applyWriteOpsToDoc data 键/validateWriteBatch writeNodeData 分支）逐处测试全绿+**A1 切片内 addNode 经 allocator 通过**（A1 出口假绿防） |
| G2 | 读侧全函数+catch 层 | 注毒缺 placement：装载 strict 形态→terminal/白屏；无 catch 时注毒即炸 | total 装载确定性落位渲染+`doc_integrity_invalid_total{stage}`（doc+node+stage 去重）+catch 层只接 doc 级结构错误 |
| G3 | 期望序 | Map 插入序≠order 时读出口=插入序（真红）+store 数组序断言 | 层序三面同序 |
| G4 | 字母表/边界 | 注入乱序字母表红+**v7：中点算法尾插 10k 次长键红相（反面基准——C0a §1 勘误口径）** | 严格递增+移植测试向量全绿+property 绿+**G29 append-only 硬验收**（10k 尾插≤16/头插≤32/随机≤16/重排后 1k 次追加不触发 soft——**append-only 基准进 CI**） |
| G5 | rebalance（v6） | docDelta 计入红相+**read 物化重排红相**（REST 冷读/ephemeral 探针触发重排）+中途 throw 半层混合+truth 失真 | Maintenance 排除+**WS/写物化恰一次+read 物化零重排**+失败 backoff 跳过不 fail load+pendingStructs 跳过 |
| G6 | E8 probe | C0b 断言先红 | 8 类逐项绿+EXIF/rotation fixture 绿+幂等重试 |
| G7 | 首拟合（v6） | 现状红（image/video 无默认+首拟合缺口） | **auto 档 natural 到达恰一次 fit/author 档零 wh 写**（v5「视频 bootstrap 零写」与 fit 一次措辞矛盾勘误）+load 扫描补触发+**natural.mediaId 匹配才 fit**+viewer 纯函数同值渲染+默认 wh 只是占位 |
| G8 | 只读命令矩阵（v6） | 收口前红（回弹+undo 无门） | 零 local-origin update+select 放行+**measured 本地/setAttributes viewer 拒**+级联前置+投影不误拦 |
| G9 | 创建默认 | 现状红（image/video 无默认） | 兜底稳态 0+首拟合+auto 组 0 帧键 |
| G10 | 校验链表驱动（v6） | 人为删一个 validator/case+单写面写未知键（{a:1} written:true 现状）+**`toString`/`constructor` op 名绕过** | 删即编译红+单写/批写两路径同表+**Object.hasOwn**（原型链不可绕） |
| G11 | 版本门 | bump 前旧 csv 放行红 | 旧 csv 拒连+旧 schema 拒载+fillDoc placement 域通过+IDB 不命中 |
| G12 | 收敛 harness | 期望序红相+参考模型 | 五件套绿+并发用例（G17） |
| G13 | 类型门禁（v6） | 新模块 as 残留红+allowlist 外命中红+**v5 四类型混用红**（ProjectedCanvasNode 同时承担 diff/store） | Raw/Doc/ProjectedRecord/CanvasStoreNode 四型分职+新模块零新增 as+allowlist 每条注明理由+projectCanvasNodes cast 删除 |
| G14 | repair-doc-order（v7 补承载——v6 自检虚报） | 制造坏 order doc（混合长短键/重复键/缺 placement/natural mismatch 四形态注入） | CLI 扫描四形态→JSON 报告→维护窗内按层重分配（MAINTENANCE origin）→修复后装载通过+相对序保持+修复期间 doc 可用 |
| G15 | 服务端写一致性（v6） | v4 现状红相（单写面 {a:1}→written:true 两路径漂移） | 两路径同表拒绝+**natural op typed false 不 throw**（外部数据）+**fileId op 独立成功**（natural 非法不丢交付）+undefined/结构损坏 throw 维持 |
| G16 | guard shadow+post-apply（v7） | 两键形态混键注入+客户端写服务端域键注入（post-apply 检测缺位时不可见） | **shadow 与 post-apply 检测双路对账一致**（guard_shadow_reject_total==post-apply 计数）+正例矩阵零误报+诊断 close code 非终态；**禁断言 post-apply 拒帧**维持 |
| G17 | placement 原子性 | 两键形态并发「移动+置顶」→merge 交叉 placement 复现 | 复合 placement 整值同源配对+三端同序+无跨 sibling 集 key |
| G18 | 服务端单写路径 | in-process/HTTP 单写面写域外键→written:true（v4 现状） | 两路径同表拒+reason 透传 |
| G19 | 坏 order 不终态 | 注入坏 placement 持久化→重载 terminal/公开页 500 | total 渲染+计数+违规连接关闭+重载可用+公开页不 500 |
| G20 | seed/clone 归一化（v7 五路径） | 缺 placement 的 export/clone/**vacuum** 直连 fillDoc→typed 拒（v6 前现状=键静默丢后通过；**vacuum 恢复路径 :629 实证**） | normalizeForSeed 五路径保相对序+fillDoc 通过+synthetic key 零回写+**vacuum 经 normalize 后其余根 deep-copy 保 exec/meta** |
| G21 | reset 演练（v7 九步脚本） | **API/worker 仍在写时 truncate→回灌复现**+**队列未 pause：BullMQ 重试回灌复现**+drain 60s 自动解除复现 | 脚本九步（maintenance mode 不自动解除+队列 pause active=0+停双进程+备份+SCAN+epoch）→**两轮零回灌**+G33 epoch 旧 job 丢弃 |
| G22 | 10k 预算（v7 扩） | C0a 前无预算基线 | 10k 投影 p95/读取 p95/rebalance 耗时达标（阈值=C0a 落盘定）+**G35 浏览器/soak 面** |
| G23 | probe 韧性（v6） | probe 失败/超时/迟到/**节点不存在 TTL 丢**（v5 形态）/媒体替换旧 fact 覆盖（现状无链路可注入） | strict 档真实重试+**node 不存在走 attach 端点不靠 TTL**+副本 fileId 扫描补写+**stale-media typed false 旧 fact 不覆盖**+失败计数+fallback 兜底 |
| **G24** | D6 改形 data.autoOrigin（v7） | 空自动组无持久 origin（fallbackOrigin 兜底——bbox 递归抖动） | **`data.autoOrigin` 显式非帧键**（空 auto 组 origin 持久化——不触 assertNoAutoGroupFrameKeys〔冲突实证〕）+fallbackOrigin 退役+**auto 组仍零帧键**（position/wh 维持剥除——v6「仅 position 键」废止）+groups 断言改写为 autoOrigin 断言 |
| **G25** | 空间序 tie-break（新） | 同坐标输入序=Y.Map 插入序——双端分叉复现 | sortNodesByPosition/sortForArrange id tie-break+双端同序 |
| **G26** | rebalance 先算后写（新） | 中途 throw 注入→半层混合键+docTruth 与编码值不一致（Yjs 无回滚实证 §1.7） | 无半层（先算后写——apply 段不抛）+失败仍重测 truth 一致 |
| **G27** | probe 媒体替换（新） | 旧 probe 迟到覆盖新 fileId 的 natural | 服务端单事务 read-check-write→stale-media typed false+丢弃计数 |
| **G28** | 公开/viewer fit（新） | 无 wh doc 公开页 fallback+viewer 无 fit 布局不一致 | 公开载荷白名单加 natural（image/video）或 wh 保证+viewer 纯函数本地派生渲染（readOnly 会话 invariant 豁免档） |

| **G29** | append-only 序键（v7 新） | 中点算法 10k 尾插 maxLen≈630 字符（C0a 反面基准复现） | integer-part 生成器：10k 尾插≤16/10k 头插≤32/10k 随机≤16/重排后 1k 次追加不触发 soft——**append-only 基准进 CI** |
| **G30** | 读契约（v7 新） | v6「readCanvas 返 Raw」形态下 video-work-clone/snapshot-filter parentId undefined 复现 | readCanvas 返 ProjectedRecord 六消费者零改动+vacuum 经 normalize 通过+tsc 消费者锚（返回型可赋给六入参）+无同名 DocNodeRecord 双导出 |
| **G31** | in-place 维护窗（v7 新） | v6 close-all 形态：done 广播无连接/无人触发再物化/离线客户端旧键复活/undo 复活旧键——四缺口复现 | editor+viewer 双连接触发维护→**不重连**（update 直接收+相对序一致）+epoch 不符→清 IDB+undo clear+旧长键不复活 |
| **G32** | probe 覆盖（v7 新） | 现状仅 confirm 路径入队——AI/download/image-edit/lighting/media-process/stitch 产物零探测复现 | **7 处 media.create 全入队**（enqueue 收口）+素材库（projectId=null）attach 成功+jobId 无冒号不抛+sweeper 重入+attach 不信客户端尺寸（metadata.probe 专属） |
| **G33** | reset epoch（v7 新） | 旧 epoch job/doc 在进程未停时回灌复现 | DEPLOY_EPOCH：旧 epoch doc 拒载+旧 epoch job 丢弃+maintenance mode 写 503+队列 pause |
| **G34** | VIEWER 全命令矩阵（v7 新） | nodeStore 五命令/deleteNode 级联/addNode/onNodesChange 善后段/onConnect edges set/undo——v1 漏门处全红 | 全部零 cs 写（select/measured 除外）+零 doc 写+**零 DB 副作用**（cascade/cancelNodeProcess 不触发） |
| **G35** | 性能 soak（v7 新） | 单端纯函数绿≠浏览器绿（C0a 只测 node） | 10k（append 生成键）+5 客户端 10min soak：投影 p95≤30ms+React commit 预算+doc 字节不随同值写增长（deep-equal no-op 验证） |

**观测增补（v7）**：v6 清单维持+`order_dup_total`+`natural_mismatch_total`+`probe_stuck_total`（sweeper 重置）+`guard_shadow_reject_total{reason}`+`readonly_blocked_total`+`maintenance_duration`（告警阈值：probe lag/failed/stuck、stale-media、guard shadow 误报率）。

## 6. 非目标与移交

| 项 | 归属 |
|----|------|
| z 序 UI 命令（bringToFront 等） | 后续 UI 批 |
| 闩锁删除 | Y1c-1 后按证据再裁 |
| SCHEMA=4/generation/CanvasDocSnapshot/拆键/Y.Text | Y1c（**折叠进 3 定案 §0.2-④**——Y1c 立项终裁；master 目录表回填） |
| reconcile 删除 | Y3 |
| v2→v3 兼容 | 无（reset runbook 九步脚本） |
| **拖拽帧级热路径**在线重排 | 不做（**v7：维护窗 in-place 重排已采纳**〔§0.2-② v7——freeze 期间受控执行非热路径〕） |
| cellCount | 不做（零读者——偏离表 #2） |
| 第七 op | 不做（natural 单对象+writeNodeData 两 op 承载——§0.2-① 定案） |
| mediaFacts 独立 map / order 出 diff 链语义 intent 重构 | 留档不采（v5 §6 理由维持） |
| R1/R2 片序拆分 | **不采纳**（§0.2-③ 定案——B1a 为唯一可选先行片） |
| fileId 客户端可写收编 | Y2（偏离表 #3 已知缺口登记） |
| cutover 脚本化（dry-run/backup/verify） | 移交 B3 评估（runbook 先按八步文本+G21 演练） |

## 7. 纪律与观察项

- v1/v2 共四处核验错误留痕（修订链）——「进 spec 断言先实证」三重教训维持。
- **v5 留痕（v6 修订链）**：六项方向修订有一手核验支撑，但**新写入的裁决文本（Z7''/Z12''/Z4''/Z11'' 落点措辞）未逐个再验编译/进程语义**——四处实错（natural 三矛盾/worker 进程边界/NODE_ENVELOPE_KEYS/transact 回滚+projectId 必填）全部由外审补验。教训：**方向级核验≠落点级核验**；v6 对每条新裁决的落点（类型签名/进程形态/库语义）补 §1.7 一手实证。
- **v7 留痕（修订链）**：v6 的落点级核验覆盖了「库语义/进程形态」，但 **plan v1 的代码级落点（类型名/import 方向/DI 装配/库 API 形态/进程拓扑/入队覆盖面）未逐个实证**——DocNodeRecord 同名 172 处/循环 import/BullMQ 冒号/getObjectBytes 不存在/无 registerQueue/AI 产物不入队/reset 拓扑七项全部由外审坐实。教训续篇：**「spec 落点核验」≠「plan 代码落点核验」——plan 中每个被调用的 API/类型/DI 令牌/进程形态，写前 grep 实证**（v2 头注纪律）。另：C0a 结论的**分布采样口径**错误（尾插是主路径却用随机插入下结论）——数据真实但结论选择性地引用了对本方案有利的行；外审跑同一脚本重读表格推翻。教训：** spike 结论必须覆盖主使用路径，勿用有利分布下结论**。
- v7 外审核验方法：三份 plan v1 外审主张逐钉一手复核（§1.8 十二行——类型/环/队列/拓扑/API/断言/时序/污染源全行号落盘）；不采纳项（server 子 map 本批上〔留 Y2〕/完全删 guard〔取 shadow 交集〕/独立 runtime doc〔留 Y2 评估〕/硬数字≤4〔G29 以≤16 保守起步〕）理由留 §3/§6。
- §0.2 六项 v7 修订经用户确认（2026-10-18：①维持/②in-place/⑤参数重定/B1a 必做+D6 改形 B2）；后续变更走 §0.4 偏离表。
- harness 真连用例 provider destroy 走 scripts/lib/provider-late-reconnect-guard；纯内存部分不涉。
- 观察项：B15 心跳 FIFO（不触发）；collab.gateway.spec 满载 flaky（二连命中转根修）。
- manifest 矩阵扩+缩对称（natural 单键入服务端 data 域行+placement 拆两行；measured 注记出+aspectRatio 出）。
- 入口 guard 与 readOnly/帧闸/quota 只加不减；**C0a 结论决定 §3.6 档位**（达标/退路双档判据已写 G16——不预支结论）。
