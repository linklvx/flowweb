<!-- doc-status: active -->
# Y1c：doc 模型 v4·载体与契约（B 类合并批设计——v5.4 四平面架构：P0 契约 / P1 载体 / P2 内容 / P3 业务与恢复 / P4 交付）

- **立项**：2026-10-23，用户指令「Y1a+Y1b 完成，继续下一个任务」。按目录 §0.2 顺序节 B 类分组「Y1c 全批」合并立项（:159）；分阶段验收、批末一个完整发布单元。
- **唯一上游依据**：[2026-10-06-canvas-yjs-arch-upgrade-review.md](2026-10-06-canvas-yjs-arch-upgrade-review.md)（master v8.3）§0.2 Y1c 行+启动方式/执行门机制+§0.1 裁决；Y0c spec 世代契约冻结直采；Y1a/Y1b spec v14.3 移交行承接。
- **硬前置**（Y1c 行）：Y0a+Y0.5 迁移链——已满足。
- **最终原则（用户 2026-10-24 裁定文档——v5，v5.1/v5.2 维持）**：批准第六轮终裁架构反转。**Yjs 只负责协作内容；PostgreSQL 是业务状态唯一权威源；Spool WAL 是协作更新快速持久化入口；Runtime Feed 承担业务状态投影传输（Stateless 只通知不交付）**。推翻 v4「doc 内受控投影」原则——投影整体出 doc，服务端 serving 期零业务 doc 写入。

**修订链**：
- v1（2026-10-23）——首版合稿：三路一手核验+四片锚定+Z1-Z8 呈裁。
- v2（2026-10-23）——外审一轮+用户终裁 C-1~C-6+两收回+两修正。
- v3（2026-10-23）——外审二轮采纳（R1-R12+B1-B20 全实证+用户三项确认 v3-1~v3-6）。
- v4（2026-10-23）——外审三轮采纳+用户两项裁定（v4-1/v4-2）+v4-3~v4-9 直接采纳；偏离登记 11-15。
- plan v1（12fa3e8e）→v1.1（87c8507f）→v1.2（47e37467）——均过时存档。
- v5（2026-10-24）——第六轮「复核终裁」评估+用户裁定文档：架构反转版（三支柱实证+单实例钉死）；偏离登记 16-25。
- v5.1（2026-10-24）——第七轮外审「v1.3 四平面复核终裁」评估采纳+用户三项重裁（D1 水位三元删 appendSeq/D2 vacuum=generation++/D6 Undo clear 收口）：契约收口版；偏离登记 26-35；plan v1.3 退回。
- **v5.4（2026-10-24）——第十轮三份外审报告交叉裁决（用户确认采纳）：接缝与契约收口版（架构主线冻结不动）**。①**所有权切换（本批头号修正）**：apply 归 gate 的同时 store/unload/compact 所有权未切——gateway:340 `onStoreDocument→storeDocumentUnlocked('debounce')`+factory:57 仍接线，gate pre-apply 的 update 事件会触发库防抖 store=**每帧新旧双写**；T9/T10 同切片 seam switch（store 钩子链拆为 telemetry-only/退役，验收=一帧恰一次 WAL append+一次 PG row+旧 spool 计数 0）为 P1 入口条件。②**三项机制不成立换方案**：pending 检查前移（apply 后断言无效——pending 已入私有 store 无公开移除；改 frame-local 区间法：decodeUpdate 各 client 区间 vs encodeStateVector，起点 clock>SV 或区间有洞→4412，禁 max-clock 单值判断）；group commit 需真 actor 队列（mutex 串行凑不出批——`CollabProjectActor` submit/drain ≤20ms/1MiB 一次 fsync 逐帧 apply resolve，兼承载 in-flight 去重 promise map 与 FrameEffects 收集）；DraftEnvelope B 场景改**用户裁定式**（无 journal/base 时 typed replay=LWW 覆盖——新增直接导入/修改字段逐字段「当前 vs 草稿」二选一默认保留当前/删除显式确认；C 场景 nodeId **不重映射**（重映射断 parentId/cells/bindings），冲突跳过/替换用户选+确认面三行含「不恢复产物/历史/计费」）。③**三处 v1.6 事实错误认账修正**：广播无发送者过滤（esm:658-670 broadcast 支持 filter 但 broadcastUpdate :689 不传——发送者必收自身回声，origin 只影响 onUpdate）；DirectConnection 非零使用（withDoc:78 在役 readCanvas/shrink/export）；卸载钩子名=beforeUnloadDocument（非 onUnloadDocument）。④**契约修正**：水位拆义（内存三元 `0≤pgSeq≤appliedSeq≤spoolHeadSeq`；CanvasDoc 列改名 `walCheckpointSeq`=批提交时刻 spoolHeadSeq 采样，永不与 appliedSeq 比较）；historyId=SystemHistory 全局单行唯一权威（删 CanvasDoc 列）+**客户端半链**（providerVersion 带 h=/缓存键五元/onAuthenticate 先比 historyId 堵同代 PITR 复活/feed cursor 三元）+WAL 段 lastWriteAt 时间戳栅栏（防忘 bump）；ExecutionRequest 内部 id 主键+historyId 列（PITR 后重试 409 REQUEST_STALE）+planHash 只盖不可变字段+per-item 资金预留；ExecutionInput brotli/gzip 替代 zstd 原生依赖；frozenDocSeq 正确临界区（freeze=先拿 gate mutex→等当前 apply→flushThrough(appliedSeq)→断言 pgSeq==appliedSeq→只读 scope+直接父节点→500ms 预算超时回退 PG 前缀重建）；nodeVersion 单名单义（snapshot=全量替换统一 cursor）；事件 taxonomy（v:1/EVENT_KINDS/payload≤64KB/exact kinds）+cursor upsert genesis；锁序简化业务行→counter；XML 双层验证（L1 frame-local struct 扫描+L2 apply 后 changed-subtree walk 毒帧兜底+速率限制——驳 scoped clone）；clientID 单活跃连接；4413 定义；maintenance 行级关闸（REQUESTED 同事务写 maintenanceId+受理读 IS NULL）+SWITCHING 事务后 close 4410+T12 委托 T27； readOnly/writeFreeze 短路置于 gate 最前（库检查在 beforeSync 后）；WS maxPayload 16→9MiB+认证后入站字节上限；fsync EIO=fail-stop（截断复用仅写前失败/ENOSPC 档）；去重跨重启（WAL 帧存 frameHash 启动重建有界索引）；T33 错误率定义（仅 5xx/异常/非预期 1011/断言失败）+固定 runner；**版本门拆分：protocolVersion+schemaVersion+historyId=硬门，build hash 仅遥测**；P3 重排 **T21→T26→T22**（deliverArtifact 的 node-deleted 权威需 NodeLifecycle 先行）；T19-T21 窗口 dev-only 不部署 beta；barrier 服务端按项目合并 flush（≤250ms 节流）+clientSeq 配 tabId/sessionEpoch；RuntimeProjection 类型+四读径（public 快照发布时 join/导出=render model/复制粘贴=typed BindMedia 命令/video-work clone）；T29 挂生产前置 gate（synchronous_commit/ProjectErasure/seed·对象存储触发条件数字化/清理 worker）。**不再开第十一轮外审——下一步=T9/T10/T21/T22 先红用例**。
- **v5.3（2026-10-24）——第九轮三份外审报告交叉裁决（用户确认采纳）：收口精化版（四平面不变；源码级事实锚定+六项已决项重裁+若干精度补全）**。①**apply 归属收口（推翻偏离 28 patch 路线）**：gate 在 `beforeSync` 内 pre-apply（验证→spool+fsync→`Y.applyUpdate`→appliedSeq=walSeq），Hocuspocus 内联 apply=幂等重放（yjs.cjs:3385-3390 hasContent=false 零 update 事件），gate 抛错→close 4411 且无 SyncStatus(true)——**S1 缩减为 pin 4.6.0+契约测试（4.7.x 双版本腿与 patch-package 分支删除）**；②**候选验证收口（修订偏离 36-①/T24 面）**：引用类语义（引用闭包/边引用存在性/媒体引用存在性/业务权限）一律出准入——frame-local DENY+read-side NORMALIZE+毒帧仅兜 apply 异常，业务权限归执行受理（PG）；③**display-cache 删除（推翻 §6.4 v5.2 形态）**：服务端派生字段永不进 doc——`CanvasRenderModel=CanvasReadModel⊕RuntimeProjection`（Runtime Store IDB 持久化），DataKeySpec 三元收敛二元 `writer:'user'|'server'`（server 字段不进 doc）；④**HTTP seed 端点删除（修订 §3.2）**：server→client 走 WS（maxPayload 16MiB+ss2FrameGate≈8.06MiB 代码现实）；client→server 只保留 typed recovery import（≤8MiB）；⑤**ExecutionRequest 父子行（推翻 v1.4/v5.2「plan Json 数组/scopeNodeIds」）**：ExecutionRequest 父行+ExecutionNodePlan 子行（scope 从子行派生，planHash 覆盖按序子行）+ExecutionInput（PG Bytes 2MiB stored/8MiB raw，413 不截断）+frozenDocSeq（actor 内 flush→freeze→读，requestId 幂等）；⑥**historyId 纪元栅栏（新增）**：PG 单行+WAL 段头+CanvasDoc 列+握手——PITR/pg_dump 恢复后 bump，段头不匹配=整段 quarantine fail-closed（防恢复后 WAL 回放复活已回滚内容）。精度补全：barrier target=appliedSeq+回执带 clientSeq；pending struct 拒绝（4412）；fsync 失败截断复用 seq；onUnload drain；CanvasDoc.walSeq=批检查点；feedSeq 跨代不重置+锁序契约（counter 最后）；RuntimeFeedCursor 计数行（删 advisory/global sequence 待 T10 census）；G1-G6a gate-evidence manifest+负控；T33 硬/软分档；新增 T30b 切换演练；DraftEnvelope 三场景表（同代 CRDT/拒帧 typed 重放/跨代 import-as-new——无 3-way merge）；XmlFragment 服务端白名单（T16/T24）；协议/构建版本门（4406）；UI 四态维持（数字冻结 800ms/5s）。登记不上 Y1c：HTTP seed、对象存储 ExecutionInput bundle、逐帧审计表、ProjectErasure 状态机（进上线前必修项）。
- **v5.2（2026-10-24）——第八轮外审「四平面架构升级评审」（基线=plan v1.4）评估采纳+用户两项重裁与一项驳回：勘误精化版（无架构变更）**。四项 spec 级修订：①P0-01 `spoolSeq`→`walSeq` 命名统一+不变量 `0≤pgSeq≤appliedSeq≤walSeq`（语义同 v5.1 spoolSeq，纯命名收口）；②P0-04 跨表 CHECK 勘误——`Snapshot.stateSeq≤pgSeq` 非 PostgreSQL CHECK 可表达（v5.1 表述勘误），改快照发布事务行锁+条件更新保证；③P0-05 RuntimeEvent 全局 feedSeq→**per-project feedSeq+同项目行锁内分配且同事务提交**（sequence 分配序≠提交序——漏事件洞；与本仓 canvas_doc_update_seq「seq 序≡提交序」advisory lock 先例同构）——**用户重裁，推翻第七轮 D5 全局 feedSeq**；④T2 收口=删 :157+**改 execution.service:512 读点**（string 直读腿——读链断供实证：`data?.prompt?.text` 只匹配 image/video PromptValue，TextNodeData.prompt:string 恒 miss，textInput 执行 prompt 现状独占依赖 :157 content 覆盖）+**取消 promptText 请求参数**（prompt 权威=doc 单源，P3 服务端从 PG 前缀冻结 ExecutionRequest.promptText）——**用户重裁，推翻第七轮 D7 的请求参数部分**。plan 级注记批量登记（偏离 36）：候选文档验证（对照活动 doc 现状增量语义验证）/每帧 DB 世代验证/per-project 写入背压/ACK 四态 UI 映射/savedSeq 只由持久化回执推进/text 链外呼锚（其余链三层防护已在——外审「重复外呼」普适主张实证驳回）/测试矩阵三补/性能分轴两补。**驳回外审「五个用户确认点改为阶段验收归档节点」——确认点①-⑤+T27 执行门为用户治理纪律维持（v5-15）**。@hocuspocus/server 4.7.0/4.7.1 已发布但 changelog 无 errorHandler 修复——S1 双版本实测。偏离 26/28/30/32 修订+36 新增；plan v1.5 待本 spec 过门后修订。

---

## §0 裁定与定案

### 0.1 定案（v5-1～v5-15；**v5.1**=第七轮修订、**v5.2**=第八轮勘误精化、**v5.3**=第九轮收口〔v5-2/v5-4/v5-8 按 §1.8 修订生效〕——冻结，实施期不得重新引入旧机制）

- **v5-1 四平面架构**：Yjs 协作平面（多人文本/结构合并）/PG 业务权威平面（执行、交付、计费、生命周期、维护、幂等、恢复）/Spool WAL 持久化平面（协作更新快速持久化入口——fsync 后 apply，PG 批量后置）/Runtime Feed 平面（业务状态投影传输——有序、可恢复、游标续传）。Yjs 更新的交换/结合/幂等性只保证可安全合并重放，**不替代授权、事务与幂等控制**；不采用 Hocuspocus 常规持久化钩子——保留自有 WAL/批处理管线并明确其与 Hocuspocus 生命周期的集成契约。
- **v5-2 权威边界**：doc 三根 `meta/nodes/edges`（**exec 根删除**；meta 收缩为 schema 白名单内的用户可编辑配置——身份/权限/维护标志等服务端控制字段禁入）。迁出：`doc.exec` 全部、`data.fileId/result/status` 等服务端交付字段、任何「服务端计算又写回 nodes」的派生元数据、维护标志/执行围栏/内部身份/业务版本字段。**服务端 serving 期零业务 doc 写入=可测试不变量**；初始化/硬重置/离线导入=受控生命周期操作，不入普通请求路径。
- **v5-3 spool-first 写管线（v5.1 修订）**：准入→帧字节精确 copy+**原始帧 SHA-256 去重**→分配 `walSeq`→WAL fsync（含新段目录 fsync）→apply→广播→后台按 **applied 连续前缀**批量写 PG（单事务多行，**上界=appliedSeq——apply 失败的帧不得提交**）→推进 `pgSeq`。**禁止逐帧 PG 事务为默认路径**；保留现有批处理（512 条/8MiB+1MiB 分片实证在役）。
- **v5-4 ACK 持久性三档（v5.2 补 UI 四态映射）**：`Applied`（已应用未持久化）/`Spooled`（WAL fsync——本批同步接收的 ACK 等级，仅本机故障模型内可恢复）/`Durable`（PG 连续前缀已提交——判据 `pgSeq`）。Hocuspocus `SyncStatus(true)`=Applied；stateless `{tier:'spooled'}` 可选；save barrier=Durable(pgSeq)。**UI 四态映射（v5.2）**：`Local`（编辑已入本地 Y.Doc——「编辑中」）/`Spooled`（「已接收，正在保存」）/`Applied`（「已同步，等待数据库提交」）/`Durable`（「已保存」——必须对应可验证的 pgSeq 回执）——协议仍三档，UI 不因 WebSocket 连接或 SyncStatus 自动显示 Durable。耐久契约五档：`local→synced(applied)→spooled→durable(PG)→archived`——spooled 档=kill -9 可恢复、整机丢失不可（诚实登记）；机损 RPO=PG 批延迟（有界秒级），生产由 T29 PITR 兜。
- **v5-5 代际与水位（v5.1 重写；v5.2 命名统一）**：`generation`（文档身份——**schema 迁移/硬重置/vacuum 三时机均变**）/`snapshotRev`（快照版本）/`vacuumEpoch`（**遥测计数——不做任何 fence**）+**水位三元 `walSeq/appliedSeq/pgSeq`**（§5.1；v5.2 起 CanvasDoc 持久列=`walSeq/pgSeq`——`spoolSeq` 别名删除）。普通 vacuum 不复用「同 name+epoch fence」——同 name 方案存在结构性放行洞（偏离 27）。`schemaVersion`⇒`generation` 启动断言维持（违反拒绝启动）。
- **v5-6 全类型 schema 矩阵（v5.2 补执行读点注记）**：以真实创建/保存/加载/执行/导入/导出路径建立**唯一节点类型清单**（含 `group`/`videoEdit` 等 NODE_TYPES 之外的持久类型——33+2 处实证）+全路径字段矩阵（容器类型/写者/读者/权限/预算/撤销/导入导出/是否参与执行计划）。未知类型不静默降级：写侧明确 schema 错误拒绝；读侧必须有显式只读保真策略。census 现状基准（第七轮实证）：audioGen 的 prompt 现住 `content:string`（AudioConfigPanel textarea，无 prompt 字段）；multiImageGen.prompt=零写点死字段（面板全文无 prompt 输入）；textInput 的 `data.prompt:string` 已每键击落 doc（onChange :204-212）——**执行读点（execution.service:512）自 T2 起直读 string 形状（v5.2 修）**。
- **v5-7 字段容器语义按真实协作行为**：字符级并发纯文本=`Y.Text`；Tiptap 富文本正文/prompt=`Y.XmlFragment`（PromptInput=Tiptap+Mention(/,@)+Image 实证——不得当纯文本、不得留过渡形状）；稳定配置/布局 `position{x,y}`=`Y.Map` 逐键；集合=顶层共享结构（稳定 ID+结构操作规则）；媒体列表=`Y.Array` 或显式 LWW（不默认整数组覆盖——迁移单卡读写同卡）；执行/交付/计费状态**不入 Yjs**。
- **v5-8 ExecutionRequest 受理行（v5.1 修订：全计划冻结——D4；v5.2 补 promptText 来源；v5.4 注记：本条「scopeNodeIds/plan Json 数组」字段形态已废止——以 §6.1 v5.3 父子行为准）**：受理事务冻结**完整执行计划**（§6.1 字段表：scopeNodeIds/每节点 plan Json〔type/model/resolution/style/pricingRuleId/creditCost/paramsHash〕/teamId/kind/pricing）；`docSeq` 只接受 `pgSeq` 口径；**受理读必须来自 PG 一致前缀**（拿 gate→flush applied→PG→读 live doc，或 snapshot+updates at pgSeq 重建——不读「已 apply 未 PG」的 live doc）；等待上限+明确超时错误；校验失败=整体失败不落半条记录。**`promptText` 等冻结字段一律由服务端从 PG 一致前缀恢复 doc 内容冻结——客户端执行请求不携带提示词参数（v5.2：无第二权威通道）**。`GenerationIntent`=执行意图记录（claim 时创建并关联 requestId）。**worker 零 doc 读**。
- **v5-9 Runtime Feed（v5.1 修订：独立事件表——D5；v5.2 修订：per-project feedSeq）**：**独立 append-only `RuntimeEvent` 表+per-project `feedSeq`（同一项目行锁/advisory lock 键族内分配且同事务提交——分配序≡提交序；裸 sequence 全局自增不保证提交顺序〔偏离 30 v5.2〕）**——**禁用 ExecutionOutbox 当 feed 日志**（outbox=可 claim/可更新/可删的可变工作队列，游标会因行状态变化出洞）。首连=RR 事务快照+游标；重连=游标续传，失效=全量快照；事件应用幂等（旧版本忽略/缺口对账）；旧 generation 事件不污染新代；**心跳 15-30s 携带 latestFeedSeq**（防「连接没断但通知丢了」）。`docSeq/execSeq/eventVersion/artifactRev` 语义独立维持（**v5.4 注记：eventVersion 已废——统一为 nodeVersion，见 §5.2/§7**）。**Stateless 只通知/唤醒，不承担唯一数据交付责任**。
- **v5-10 单 UndoManager（v5.1 重写——D6）**：画布级单管理器 `UndoManager([nodes,edges],{trackedOrigins:LocalUser,captureTimeout:500})`——**scope 含根 Map 时 `changedParentTypes` 父链已覆盖全部嵌套子类型（yjs.cjs:3664-3670 实证），不调用 `addToScope`**（无 remove API，重复挂载只增不减）；不挂第二套 UndoManager/yUndoPlugin；Tiptap 焦点快捷键经薄 keymap 路由到统一管理器；文本+画布共享同一撤销栈（跨编辑器顺序非全局=产品语义）。**栈上限>100=整栈 `clear()`**（`keepItem` 模块私有不导出——公开 API 边界上「精确单项释放」不可实现；clear() 是唯一释放口）；**不写「shift 后字节回落」验收**；doc rebuild 仅在测量超标后（`unsyncedChanges===0` 且字节超阈值）。origin 注记（第七轮修正）：本库编辑器为 Tiptap onUpdate→dispatchCanvasIntent(Origin.LocalUser) 手搓管线（canvasIntents.ts:361-362）——现状零额外 origin 需求；T16 引入 ySyncPlugin 后其事务 origin 未必=LocalUser，T0 spike 实测后按需 `addTrackedOrigin`。
- **v5-11 本地缓存 per-tab+merge（v5.2 补 savedSeq 口径）**：每标签独立记录（tabId/snapshot/stateVector/savedSeq/unsyncedDirty/diverged/at）；boot 读同键全部记录 `Y.mergeUpdates` 后 apply（CRDT 并集）；clean 不覆盖/删除 dirty；同步成功删己记录；**generation 变更（含 vacuum 换代）清整族**；IDB blocked/quota 降级不阻断协作。**`savedSeq` 只由服务端持久化回执（save barrier 的 pgSeq）推进（v5.2）——不因 provider 显示同步完成或 WebSocket 连接即认定已保存**。
- **v5-12 单实例 ADR**：`instances:1` 为有意识选择的复杂度边界（非 HA）；同一时刻仅一个协作进程持有某项目活动文档写入权；**重启恢复顺序=先恢复 WAL→校验 PG 前缀→重建文档→再开放写入**；扩容=另立批，不得直接改大 instances。
- **v5-13 硬重置**：无存量数据——不维护 v3→v4 双读/双写/fallback/渐进兼容；DB schema+doc schema+客户端模型统一切换；reset 脚本可重复执行+测试种子+迁移验证+回滚说明。
- **v5-14 恢复模式**：握手比较 `g_client` vs `g_server`；`g_client>g_server`（服务端 PITR 回滚）→4410 `server-restored` **不清缓存**，进入只读 recovery+可导出草稿，管理员裁定；`g_client<g_server`（主动换代/vacuum）→4410 全会话重建维持。
- **v5-15 质量门结构**：六项 go/no-go（§9.1）=**工程门**（实施团队按证据自判，不是用户审批节点）；**阶段出口（P0-P4）=用户确认点维持（第八轮外审建议取消——用户 2026-10-24 驳回：确认点①-⑤+T27 执行门为用户治理纪律）**；世代切换首次真跑=执行门（单独请用户确认）。

### 0.2 master 裁决效力（v5.1 精简重注——E30 自包含）

| 裁决 | v5.2 效力 |
|---|---|
| E3（generation 载体=docName #g） | 采纳+**v5.1 修订**：#g 变化=schema 迁移/硬重置/**vacuum**（D2——偏离 27） |
| E23/E61/E62（世代连带/重建命令/Snapshot 追加） | 采纳：buildDocName 唯一构造器+静态门维持；重建=类型化导出 fresh doc；Snapshot(g,rev) 追加+stateHash；compact 分批+worker 进程（授权=行锁+CAS〔水位口径 pgSeq〕，不拿租约） |
| E26+E33（keep GC 交集） | **v5.1 修订承袭形态（偏离 31——用户 2026-10-24 重裁）**：单管理器+栈上限 100+整栈 clear()+rebuild 逃生口——「精确交集释放」在公开 API 边界不可实现（keepItem 私有不导出、clear 唯一释放口），禁内部 API 释放；shift 泄漏现行 bug 以 clear 收口 |
| E27（嵌套类型唯一创建者） | 采纳+**incarnation→PG lifecycleSeq**（数值序；不做 Yjs Item/struct adapter——私有 API 禁令维持） |
| C8（Y.Text 原地 splice） | 采纳（v5-7 容器矩阵） |
| E17/E38（manifest 派生断言） | 采纳（全类型矩阵+未分类即红+运行时准入面共用） |
| E2/E22/E64（exec 契约/undo 绑定/outbox） | **v5 反转维持**：exec 出 doc（§6）；undo scope=[nodes,edges]（子类型经父链覆盖）；ExecutionOutbox=业务工作队列（**不作 feed 日志**——feed=RuntimeEvent，偏离 30） |
| C7③/E45 | 采纳（维护窗口+drain runbook；env 预留档 -3） |
| Z 系列/E30/E35 | 承袭（spec 自包含/单实例 ADR 化——v5-12） |

### 0.3 偏离登记（spec 级，续 v4 的 11-15；16-25=v5，26-35=v5.1，36=v5.2，37=v5.3，38=v5.4）

| # | 偏离 | 废止/修订对象 | 依据 |
|---|---|---|---|
| 16 | exec 根删除，运行时状态走 PG+Runtime Feed | 反转 v4-4 与 v2-C1 | 第六轮三支柱实证 |
| 17 | 服务端 serving 期零业务 doc 写（含 data.fileId/result/尺寸——尺寸改 feed 下发→客户端以用户域 origin+显式白名单写回） | 反转 §2.7-e 及 v1.2 candidate-first/shadow/clone/ServerDocWrite | deliverArtifact:248-264 实证 |
| 18 | admissionEpoch 删除——单 gate 串行受理+freeze 标志+drain 全部已受理帧 | 反转 v4-5 及 v1.2 懒块分配 | CollabLease 单行+gate 单串行口实证 |
| 19 | CanvasDocProvenance 删除——服务端零写 doc→威胁模型整体蒸发 | 反转 v4-7 及 v1.2 偏离 27 | B3 reset 场景随架构消失 |
| 20 | 保存屏障=onStateless flush+回执 {nonce,committedSeq}（处理器首语句同步捕获已受理前缀） | 修订 v1.2 偏离 29 | round-5 A1/A3+第六轮终裁 |
| 21 | （**v5.1 起废止**——被偏离 27 取代）vacuumEpoch 独立——vacuum 不改 generation/docName | 原 v5 对 v4 T11 #g 语义的修订 | 第七轮推翻 |
| 22 | 耐久契约四档→五档（插 spooled）+ACK 三档 | 修订 v4-8 | spool WAL 资产实证 |
| 23 | inputSnapshot 废止→ExecutionRequest 受理行+docSeq 前缀绑定 | 修订 v1.2 偏离 18 | generation-intent.service:251+execution.controller:33 实证 |
| 24 | RetentionCoordinator 删除；y-protocols fork 删除 | 修订 v1.2 偏离 26/33/24 | 单管理器现状+sync.js:82 errorHandler 实证 |
| 25 | NODE_TYPES 不作全集——全类型矩阵（group/videoEdit 入册+只读保真策略） | 修订 v1.2 T3/T2 | nodeStore:17-24+canvasStore 33+2 处实证 |
| 26 | **D1 水位状态机（v5.2 修订：命名统一+跨表勘误）**：`walSeq/appliedSeq/pgSeq` 三元——删 `appendSeq`；**CanvasDoc 持久列=`walSeq/pgSeq`（`spoolSeq` 别名删除——v5.2）**；不变量 `0≤pgSeq≤appliedSeq≤walSeq`（appliedSeq 可暂时落后——已 fsync 未 apply）；PG 批上界=appliedSeq；`docSeq/committedSeq/ETag/read model 新鲜度/公开快照水位`一律 pgSeq；受理读=PG 一致前缀；**CHECK 仅同行（CanvasDoc `pgSeq<=walSeq`）——`Snapshot.stateSeq<=pgSeq` 为跨表约束非 CHECK 可表达（v5.2 勘误：由快照发布事务行锁+条件更新保证，§4.5）**；appliedSeq 内存级（重启由 WAL+pgSeq 前缀校验重建） | 修订 v5-5/§5.1+plan v1.3 T7 四水位/T10 无上界/T19 ETag=appendSeq | appliedSeq 两文档 0 命中+T10 无 apply 上界实证——推翻 appendSeq（用户 2026-10-24 重裁）；v5.2 命名/勘误=第八轮 P0-01/P0-04 |
| 27 | **D2 vacuum=generation++/新 docName**：fresh doc→generation++→新 #g→4410 doc-vacuuming（discardLocalCache:true）；离线客户端重连旧 #g=auth 直接 generation mismatch（不装载/不 SS1/不上行旧 structs）→导出 DraftEnvelope→清缓存→新 name 重连导入；vacuumEpoch 仅遥测；preVacuumSv SV 重叠门退役 | 废止偏离 21 与 v5 §4.5 同 name 设计 | 前缀放行洞实证（registry:687-695 仅 SS1 分支+rebuildVacuumDoc 新 clientID 重写 :628-648→部分陈旧客户端 SS2 复活）——**用户 2026-10-24 重裁** |
| 28 | **D3 Hocuspocus apply 真相化（v5.2 补版本事实；v5.4 起整行 superseded——patch/双版本路线被偏离 37① 取代，存档不删）**：patch `@hocuspocus/server`（SyncStep2/Update 两处传 errorHandler，apply 失败不发 SyncStatus(true)）；不 patch y-protocols；**先实测新版是否已传 errorHandler——4.7.0（2026-09-09）/4.7.1 已发布但 changelog 无相关修复（Context 支持/maxAttemptsFailed），S1 双版本（4.6.0+4.7.x）实测定升降；可升级则升级（版本门 shared csv），不可升级再 patch-package**（仓库现未配 patch-package——引入属 P0 契约卡）；验收=完整顺序契约（不只测 errorHandler 被调用）；不用 `doc.store` 私有 API（post-check=encodeStateVector decode per-client clock 上界，仅 SS2/大帧诊断）；毒帧协议=隔离 doc+停写+WAL 截断至 appliedSeq+close 4411+从 pgSeq 重放，不跳帧续提交 | 修订偏离 24 的「服务端注入 errorHandler」路线——注入点不存在（readSyncStep2 调用点内部无钩子；factory 未接 onStateless） | server esm:277-281/:290-292 无条件假 ACK+sync.js:82 第 4 参在而未用+factory 全文无 onStateless 实证；v5.2 版本事实=GitHub changelog 核验 |
| 29 | **D4 ExecutionRequest 全计划冻结**：字段表 §6.1（补 scopeNodeIds/plan Json 每节点 type/model/resolution/style/pricingRuleId/creditCost/paramsHash/teamId/kind/pricing）；组执行=一行 plan 数组或每节点行+batchId（均自包含，worker 零 doc 读）；docSeq 只收 pgSeq+等待上限+明确超时 | 修订 v5-8 字段面（原仅 prompt/upstream 类） | spec:178 无上述字段实证；受理后改 prompt/拓扑/model/上游/节点删除不得影响已冻结计划 |
| 30 | **D5 Runtime Feed 独立表（v5.2 修订：per-project feedSeq）**：append-only `RuntimeEvent`+**per-project `feedSeq`——同一项目行锁/advisory lock 键族内分配且同事务提交（分配序≡提交序；`@@unique([projectId,feedSeq])`；游标 per-project）**+心跳 15-30s；**禁用 ExecutionOutbox 当 feed 日志**；G6 拆 G6a（doc 平面恢复——P1/T13）/G6b（Feed——P3/T22，即 §9.1 G5 验收位） | 修订 v5-9/§6.2 事件骨干=outbox+NodeExecution projected 元组；**v5.2 修订 v5.1 的全局 feedSeq autoincrement** | 当前库无任何 feed 事件表；outbox=可变工作队列当游标必出洞；**裸 sequence 分配序≠提交序（事务 A 取 100 未提交/B 取 101 先提交→游标到 101 漏 100）——与本仓 canvas_doc_update_seq「seq 序≡提交序」advisory lock 先例（repository:61-62/:110-112）+TeamCreditTransaction per-team FOR UPDATE（credit-ledger:58-62）同构——用户 2026-10-24 重裁推翻全局序** |
| 31 | **D6 Undo 收口**：不调用 addToScope（scope 父链已含子类型）；禁 keepItem 内部 API；栈上限>100=整栈 clear()；删「shift 后字节回落」红测；rebuild=测量后逃生口；T16 ySyncPlugin origin 由 T0 spike 实测（本库现状手搓管线 origin=LocalUser 已跟踪） | 修订 v5-10/E26 精确交集释放+addToScope（偏离 24 相应句） | yjs.cjs:3664-3670/:3726-3740/:9593-9599/:3491-3499+:3751-3766 实证；本库无 y-prosemirror 依赖——**用户 2026-10-24 重裁** |
| 32 | **D7 T2 修法（v5.2 修订：取消请求参数+补读点）**：删 TextConfigPanel:157 的 content 覆盖写一行+**同步改 execution.service:512 执行读点**（`typeof data?.prompt==='string'` 直读腿，兼容 PromptValue `.text`——读链断供实证：TextNodeData.prompt:string 恒 miss `.text`，textInput 执行 prompt 现状独占依赖 :157 覆盖；上游注入〔topology:83-84 读 content〕恢复正文语义）；`data.prompt:string` 现有每键击持久化保留（onChange :204-212）；**不引入 promptText 请求参数（v5.2 废止 v5.1 的请求通道——无第二权威）**；prompt 权威=doc 单源→T21 服务端从 PG 一致前缀冻结 ExecutionRequest.promptText；T15 才迁 Y.Map{text:Y.Text}（读点同卡再改）；E2E=输入→取消选中→重选→prompt 仍在→生成使用该值 | 修订偏离 25 的 T2 修法与 v5.1 的「请求体加 promptText」 | 现状 data.prompt 已每键击落 doc 实证+第八轮读链断供实证（execution.service:512+nodeStore:107-110/:136/:150）——**用户 2026-10-24 重裁推翻请求参数部分** |
| 33 | **D8 shape/zero-yjs/writer/frameId（v5.4 注记：DataKeySpec 三元已被偏离 37③ 改二元，本行三元描述 superseded）**：矩阵维持 §3.1（audioGen/multiImageGen{prompt:Y.Text}；imageGen/videoGen/imageExtGen{prompt:XmlFragment}——plan T15 的 Y.Map 合并与 T16 漏 imageExtGen 是起草错误，以本 spec 为准）；**删 zero-yjs DocLike**——DocCodec 直用真 Yjs 类型（shared 增 yjs@13.6.32 依赖），无 transform；DataKeySpec 三元 `writer:'user'|'server'`/`valueSource?:'user'|'server-feed'`/`authority?:'content'|'display-cache'`（尺寸等 server-feed 字段=客户端写的展示缓存，非执行/计费权威输入）+create/write/delete 矩阵；**frameId 批量化**——gate 按原始帧 SHA-256 去重后才分配 walSeq，PG 批行存 firstWalSeq/lastWalSeq/frameCount/updateHash（updateHash 唯一=批重试第二道保险），不存单 frameId | 修订 §10 P0 的「zero-yjs DocLike 注入」与 plan T4 二选一/T7 单 frameId/T15/T16 | fake DocLike=第二套 CRDT 语义镜像；writer:'server-feed' 混淆「谁写」与「值来源」；批 PG 行与单 frameId 语义冲突 |
| 34 | **D9 过渡顺序**：P2（T19）只改读者（保留 data.fileId/result/status 写者，读者经 read model 兼容）；P3（T22）**同切片**=deliverArtifact 改 PG 写+客户端切 Runtime Store+doc.exec 停写停读（禁 stale doc.exec 窗口）；P4（T32）才删 doc.exec/data.fileId/result/status 读写链/fallback/execAligned 旧链（删码与新路径同可编译切片） | 修订 plan v1.3 T19 删写者（早于 T22 切交付=断交付链）与 T22→T32 窗口 | plan:194/:210/:213/:264 实证 |
| 35 | **D10 T29 生产硬门实体化**：PITR RPO≤5min/RTO≤30min+MinIO 版本化 RPO≤15min+季度 restore drill+每小时 replay canary+HA 决策+SLO+`doc_append_gap_total` 告警——任一未过不得开放生产流量；本批交付=dev/test/beta（单机诚实登记；Spooled≠已保存） | 修订 plan v1.3 T29「占位」 | 生产可用性收口；与 §8.3 双验收线一致 |
| 36 | **第八轮 plan 级精化批注记（v5.2；v5.4 注记：①候选文档验证已被偏离 37② 删除——①项 superseded）**：①候选文档验证=准入验证对照**活动 doc 现状**做增量语义验证（引用闭包/图约束——解码级查不到的跨节点关系；「字段类型合法≠值/业务关系合法」），apply 后广播前禁全文档扫描（成本），毒帧路径兜底；②每帧对照当前世代权威（DB/同步失效缓存）验证 generation——非连接建立时缓存；③per-project 写入背压（慢项目不拖垮其他项目——观测+限流）；④text 生成链补外呼锚（现零键零锚 rearm 必重呼）——其余链三层防护已在（write-ahead providerRequestId+providerTaskId 先落库+query-first resume——外审「重复外呼」普适主张实证驳回），供应商不认键的 submit→落库窗=外部 at-least-once 诚实登记+资金 execSeq CAS 兜底；⑤reset-collab 阶段状态持久化（中途失败重跑感知已完成阶段）；⑥测试矩阵补三：feedSeq 提交顺序交错（延迟提交不漏事件）/世代切换时旧连接仍在发送/外部生成成功后 worker 崩溃重试零重复副作用；⑦性能分轴补二：`walSeq-pgSeq` 积压规模与持续时间/慢项目对其他项目的隔离影响 | 补充 §3.2/§3.4/§4.4/§6.3/§9.2/§9.4 | 第八轮外审采纳项（外审 §3.2/§4.1/§4.3/§七/性能）+我方三路验证（§1.7） |
| 37 | **第九轮三报告交叉裁决（v5.3——修订 36-①/28/33 与 §6.4/§3.2/§6.1；新增 historyId/T30b/G 门 manifest 等）**：①准入验证=frame-local DENY（结构/预算/世代/身份/clientID 绑定）+read-side NORMALIZE（引用类语义全后移——悬挂边/媒体引用缺失/父链环/重复边同 §3.2 NORMALIZE 面）+毒帧仅兜 Yjs apply 异常；业务权限语义授权归执行受理（PG 事务），不进 doc 帧；②apply 归属=gate pre-apply（beforeSync 内，origin 复用 `{source:'connection',connection}` 形态+gate 标记——广播发送者排除语义不变）；偏离 28 的 patch/双版本路线废止；③display-cache 回写删除——writer:'server' 字段一律禁入 doc，渲染=`CanvasRenderModel=CanvasReadModel⊕RuntimeProjection`；DataKeySpec 删 `valueSource/authority` 二键；④HTTP seed 端点删除（WS 通道已承载 8MiB SS2——maxPayload 16MiB/ss2FrameGate=8MiB+64KB 代码现实）；recovery import 维持 typed DraftEnvelope ≤8MiB；⑤ExecutionRequest=父行+ExecutionNodePlan 子行+ExecutionInput（§6.1 v5.3）；scopeNodeIds/plan Json 数组废止；⑥historyId 纪元栅栏（§4.4/§6.6/§8.3）；⑦barrier target=appliedSeq（非 pgSeq——已 apply 未落 PG 的帧不被回执少报）+回执 {nonce,clientSeq,committedSeq}；⑧pending struct=协议违规 4412 resync（禁入 appliedSeq）；⑨fsync 失败=截断回 last-good offset+复用已分配 seq+fail-closed；⑩onUnload=drain applied→PG 或拒绝卸载（PG 不可用=doc 常驻/fail-closed）+LRU 上限；⑪CanvasDoc.walSeq=批检查点（随 PG 批更新，恢复以 WAL 扫描为准——非每帧写）；⑫feedSeq 跨代不重置（generation 仅过滤）+RuntimeFeedCursor 专用计数行 `FOR UPDATE`+锁序契约（业务行→CanvasDoc→counter——counter 最后拿）；doc 写路径 advisory lock/global sequence 删除（T10 先 census 消费面）；⑬G1-G6a=gate-evidence manifest+负控（故意破坏不变量必红）；T33 硬 block/软 warn 分档；⑭新增 T30b 旧版一次性切换演练（T31 前实弹一次）；⑮DraftEnvelope=三场景表（同代 boot mergeUpdates/拒帧 typed intent 重放/跨代 import-as-new+nodeId 重映射+用户确认——**无 basePgSeq 3-way merge**；>8MiB 导出 fail-closed）；⑯XmlFragment 服务端 XML/PM 白名单（元素/mark/属性/深度 32/文本 128KB/URL allowlist——T16/T24，导出/公开快照二次 sanitize）；⑰协议/构建版本门（providerVersion 带 build hash；旧 bundle 4406 client-outdated+强刷——防 DENY 重连循环）；⑱Y1b 尺寸链 T22 删 12s/30s 轮询（feed 只带 {nodeId,mediaId}，facts 走既有 media-facts 通道+notifiedFactVersion 本地恰一次）；⑲save 指示器数字冻结（800ms idle/最长 5s/pagehide/visibility hidden/执行前 barrier；Spooled=客户端本地瞬态无 wire 消息）；⑳义务种类=closed enum（T5b 按子系统 census 定员，必含 FEED_TOMBSTONE）+义务从 actor FrameEffects 生成与帧前缀 PG 批同事务；㉑维护 9 段状态机转移表落卡+**切代前置=该项目无在飞执行（非终态 GenerationIntent/ExecutionNodePlan=0）** | 修订偏离 36-①/偏离 28（D3）/偏离 29（D4 形态）/偏离 33（DataKeySpec 三元）/偏离 33（8MiB=HTTP seed）；§2 数据平面第三行/§3.2/§4.1-§4.5/§6.1/§6.4/§6.6/§7/§8/§9 同步修订 | 三外审报告（2026-10-24）+我方源码核验（§1.8）+用户 2026-10-24 确认采纳六项重裁 |
| 38 | **第十轮三报告交叉裁决（v5.4——所有权切换+三项机制重设计+契约收口；修订 37 的若干表述）**：①**生命周期所有权切换=P1 入口条件**：gateway:340 `onStoreDocument→storeDocumentUnlocked('debounce')`/factory:57 onStoreDocument·afterStoreDocument 钩子链 T9/T10 同切片拆为 telemetry-only 或移除；旧 maybeCompact/handoffOnUnload/vacuumReplace 分别让位 T11/T13/T27（vacuumReplace 委托维护状态机=单换代入口）；验收=一帧恰一次 WAL append+一次 PG row+一次广播+旧 spool append 计数 0+onStoreDocument 对 connection-origin 零调用+卸载时 applied>pg 必须拒绝。②pending 检查前移至 frame-local（decodeUpdate 区间法替代 v5.3 的 apply 后断言——pending 入私有 store 后无公开移除；起点 clock>SV 或区间内部有洞→4412 零 WAL 零 apply；起点≤SV 且连续覆盖=自包含 SS2 合法——**禁 max-clock 单值判断**；检查后仍现 pending=毒帧 4411）；**readOnly/writeFreeze/quota 短路置于 gate 最前**（库 readOnly 检查在 beforeSync 之后 esm:264-276——gate 先 apply 则 VIEWER 帧已入 doc）。③`CollabProjectActor`：submit(frame,conn)→Promise 入队+单 drain 循环（≤20ms/1MiB 批→一次 fsync→逐帧 apply→逐帧 resolve）；承载 **in-flight 去重 promise map**（命中 inflight 必须 await 原帧 fsync+apply 完成才放行——「no-op 确认放行」在原帧未落盘时=ACK 早于 fsync 违约；原帧失败重复帧同错；**去重状态转移只在 actor 串行段内发生**）+FrameEffects 收集（afterTransaction+根 observeDeep+ProjectDocIndex.typeIdToNodeId 映射——无第二套 update 解析器）。④**去重跨重启**：WAL 帧记录存 frameHash，启动重建有界去重索引（最近 24h/100k 帧）——「零重复 walSeq」跨重启成立。⑤**三处 v1.6 事实修正**：广播无发送者过滤（broadcast 有 filter 参数但 broadcastUpdate 不传——**发送者必收自身回声**，provider 幂等 no-op；S1 验收改「每连接恰一次含发送者+echo_bytes 分轴」）；DirectConnection 静态门改「**serving 期业务 doc 写经 DirectConnection=0**」（allowlist=load/replay/maintenance/readCanvas/withDoc 读路径——withDoc:78 在役；census 全调用点）；卸载钩子名=**beforeUnloadDocument**（throw 拒绝卸载）+maxResidentDocBytes 上限（到顶新项目 503/4413）+doc_unload_blocked_total。⑥**水位拆义**：内存三元 `0≤pgSeq≤appliedSeq≤spoolHeadSeq`（永不与持久列比较）；CanvasDoc 列改名 `walCheckpointSeq`（=批提交时刻 spoolHeadSeq 采样，CHECK pgSeq≤walCheckpointSeq）；G2 断言=CanvasDocUpdate.lastWalSeq≤appliedSeq（独立）。⑦**historyId 端到端**：SystemHistory 全局单行唯一权威（删 CanvasDoc.historyId 列；bump 单事务=更新 SystemHistory〔+trigger 同步缓存〕，提交后才允许启动；启动任一不匹配 fail-closed 不自动修复）；客户端半链=providerVersion 带 `h=<historyId>`+本地缓存键五元 (uid,pid,generation,schemaVersion,historyId)+**onAuthenticate 先比 historyId 再比 generation**（堵同代 PITR 恢复的客户端 SS2 复活）+feed cursor=(historyId,generation,feedSeq)（响应 envelope 带 historyId；minRetainedFeedSeq 仅同 historyId 内有效）+ETag 拼 `generation:pgSeq`；**时间戳栅栏**：WAL 段头 lastWriteAt>SystemHistory.epochStartedAt→整段 quarantine+RESTORED_READONLY（防忘跑 bump；同机时钟偏移可接受）；`--adopt-wal` 仅 historyId 已匹配+operator 显式确认+审计。⑧**版本门拆分**：protocolVersion+schemaVersion+historyId=硬门（4406）；**build hash 降遥测/错误上报**（每次 hotfix 不强刷全员）。⑨ExecutionRequest：内部 id 主键+`@@unique([projectId,requestId])`（客户端字符串禁作全局 PK）+父行 historyId（重试不匹配→409 REQUEST_STALE）+**planHash 只盖不可变字段**（nodeId/order/type/model/resolution/styleId/pricingRuleId/creditCost/paramsHash——status/execSeq/intentId 不进）+inputHash 盖 ExecutionInput.contentHash+**per-item 资金预留**（受理事务 FOR UPDATE/CAS 预留 reservedCredit+expiresAt=15min+sweeper 逐 item void+部分失败逐 item 结算+requestId 重试不重复预留）。⑩ExecutionInput：raw≤8MiB 且 stored≤2MiB 任一超限 413；**node:zlib brotli/gzip**（删 zstd 原生依赖）；expiresAt 必填+终态 30d 清理 worker。⑪**frozenDocSeq 正确临界区**：freeze=**先拿 gate per-project mutex**（非布尔 flag——已过 flag 检查的 beforeSync 不得在读后 apply）→等当前 apply 完成→flushThrough(**appliedSeq**)→断言 pgSeq==appliedSeq→校验 generation→**只读 scope 节点+直接父节点**（禁全量 readCanvas）→frozenDocSeq=pgSeq→释放；超时 2s→503 不落行；freeze 预算 500ms 超时回退 PG 前缀重建候选 doc；requestId 同键不同 body（planHash/inputHash）→409 IDEMPOTENCY_CONFLICT。⑫XML 双层验证（替代「T24 激活」单点）：L1 frame-local struct 扫描（元素名/format key 白名单/ContentString 字节上限/字符串 URL allowlist/新子树深度上限；拒 XmlHook/嵌套 XmlFragment/未知 XmlElement）T16 同卡激活（shared 单表+PM schema 派生+setEqual）；L2 apply 后 changed-subtree walk（afterTransaction 触达子树）T24 激活——违规走毒帧+**per-connection 毒帧速率限制**（防重复重建 DoS）；mention/image=mediaId 存在性归执行受理/ProjectDocIndex 不入 gate。⑬RuntimeProjection 类型+merge（nodeVersion 大者胜/deletedAt 墓碑/generation 不符清族）T5c 冻结+四读径：公开快照=发布时服务端 projection join+缓存键加 projectionSeq；用户导出=render model（serializeCanvas 仅 doc 备份）；**复制/粘贴=typed BindMedia/CloneBinding 命令**（源 nodeId/mediaId 作命令参数非 doc 字段；服务端权威字段 mediaId/fileId/artifactId 一律清空由目标节点重新产生；cells 格位保留媒体引用清空；跨团队加 media ACL）；video-work clone=服务端 render model。⑭nodeVersion 单名单义：snapshot=**全量替换+统一 cursor**（客户端清投影按 snapshot 重建，仅接受 nodeVersion>cursor 增量——「maxFeedSeq≠最后变更」语义错误修正）；事件 payload v:1+EVENT_KINDS registry+unknown 忽略计数+payload≤64KB+PII 扫描+exact taxonomy（exec.status/exec.artifact/media.fact/node.deleted/doc.vacuumed）；RuntimeFeedCursor=`INSERT ON CONFLICT DO UPDATE RETURNING`+genesis 同事务插行。⑮锁序简化：feed 事务只锁业务行+counter（CanvasDoc 普通 SELECT/FOR SHARE 读 generation/docSeq）——锁序=业务行→counter；负控=静态锁序 lint+正常序压力+「去 counter」负控（期望重复/缺口），受控死锁用例标 heavy 不进 PR。⑯maintenance 行级关闸：REQUESTED 同事务写 MaintenanceOperation+CanvasDoc.maintenanceId；**执行受理读 maintenanceId IS NULL 才放行**（非 check-then-act）；in-flight 范围含 ExecutionOutbox/delivery/materialize/退款义务（drain 或 generation fence）；SWITCHING 事务只做 DB（generation/水位/Snapshot/stage），**提交成功后**再 close 4410（失败无害——重连被 generation auth 拒）；4413=maintenance-freeze（Retry-After 可重试）入 close-code 表。⑰clientID 单活跃：同一 (projectId,generation,userId,clientId) 只允许一个活跃连接（绑定表 connectionId+lastSeenAt；旧连接活跃→先 close 旧再纳新；僵尸超时替换；**禁两活跃连接共享 clientID**——同键并发=CRDT 结构性损坏）。⑱容量：WS maxPayload 16→**9MiB**（>ss2FrameGate 8.06MiB 即可）+认证后 per-connection 入站排队字节上限（2×ss2FrameGate 超限 1009）+入站速率桶；**fsync EIO=fail-stop**（walHealthy=false/停收/close 1011/要求重启+磁盘检查——**不进截断复用路径**；截断复用仅写前失败/ENOSPC 可恢复档）+wal_fsync_error_total；WAL 升级序补档位：per-project 组提交→p95>20ms→**4-way hash(projectId)%4 分片日志**→仍不达标全局 WAL=新 ADR。⑲T33：错误率=仅 5xx/未处理异常/非预期 1011/数据断言失败（预期 4411/4412/4404/4406/4413 单列）；负载 5xx<0.1% 无雪崩；硬门固定 runner（PR smoke/nightly 硬门）；apply_replay_ms/echo_bytes 软预算超限=触发 fork/patch 评审（非「只测不补」）。⑳T29 生产前置挂 gate（owner/date/触发条件）：`synchronous_commit=on`+备库同步验证（单机 Durable=「主库本地提交」诚实口径）+ProjectErasure 跨介质擦除状态机+seed 触发条件（cold p95>3s 或 loop block>50ms）+对象存储 bundle 触发条件（input 表>20GB 或 >2MiB 占比>5%）+ExecutionInput/RuntimeEvent 清理 worker+restore drill 含「主备切换 Durable 不丢」；T30b 回滚=一次性硬切（DB 快照+bundle 同回滚+nginx 强制旧 bundle；「旧 bundle+新服务端→4406」「新 bundle+旧服务端→不可用」实弹验证）；T30「清本地缓存」口径=只能靠 generation/4410 客户端自清；**P3 重排 T21→T26→T22**（deliverArtifact node-deleted 权威需 NodeLifecycle/DeliveryFence 先行）；T19-T21 窗口 dev-only 不部署 beta；S4 基线用 actor 原型测（旧 per-frame 管线数据不作拓扑依据）；barrier 服务端按项目合并 flush（≤250ms 节流；flushThrough 契约=幂等/有界/不阻塞写/返回当前 pgSeq）+clientSeq 配 tabId/sessionEpoch（reload 重置防线）；T2 落 `resolvePromptText` 单函数单测试（T15 只改函数与单测——认账上轮漏落卡） | 修订偏离 37 多处表述（pending 时点/去重语义/发送者回声/DirectConnection 钩子名/水位列名/TypedDraft 机制）；§2/§3.2/§4/§5/§6/§7/§8/§9/§10 同步 | 三外审报告（2026-10-24 v1.6 版）+我方源码核验（§1.9）+用户 2026-10-24 确认采纳 |
| 39 | **T22 G5 双评审收口批（2026-10-26——Controller 裁定轮，非外审）**：**exec.status taxonomy 扩两可选键 `intentId?`/`rearmable?`**（§7 v5.4⑭ 行同步）——writeExecStatus payload 修前丢键致 ImageConfigPanel/VideoConfigPanel `entry.rearmable===false`（EXHAUSTED 重试耗尽判据）结构性不可达；扩键=**词表根修非静默**（PII 扫描面对两键零误伤+shared runtime-event.ts 契约锁同批）。同批收口（行为面，不动冻结词表）：①客户端生产接线根修（runtimeFeedFetchers 生产恒 null——collabApi snapshot/events 两 fetcher+armSession 注入+心跳同形载荷 {type:'heartbeat',latestFeedSeq} 放宽同路追平）；②产物渲染读径 overlay（四节点 useMediaUrl(runtimeMediaIdOf(id)??fileId)——data.fileId 服务端停写后刷新/新协作者产物空白根修）；③snapshotEnvelope 竞态（RepeatableRead+语句序先 cursor 后 events+feedSeq≤lastSeq 过滤——原 RC 下信封 cursor 领先折叠事件=客户端永久漏事件）；④客户端缺口处理（gap⇒不推进 cursor 直接全量快照——原越洞应用+appliedSeq 推末位=洞内事件永久丢）；⑤义务 sweeper（租约重派 claim 谓词扩 CLAIMED∧过期+跨项目 projectId 行值直用删全库反查）；⑥deliverArtifact 幂等前置迁事务内 fence 行锁后（TOCTOU 双写关窗） | §7 v5.4⑭ taxonomy 行（exec.status 键集——扩 intentId?/rearmable?） | T22 G5 双评审（spec+quality 双 CHANGES_REQUIRED——「同切片切交付只完成了删除半边」定性）+Controller 收口批裁定 2026-10-26 |

## §1 基线与实证锚点

### 1.5 第六轮锚点（2026-10-24 三路核验——承袭有效）

deliverArtifact 同事务写 data+exec（collab-document.service.ts:248-264）/服务端 doc.exec 仅 3 触碰/决策全 PG；web 单点摄入 projectExecToStore+execStatusView+execAligned feed 已在；instances:1（ecosystem:15,:44）+factory:66-67 跨实例挂载已删；NODE_TYPES 6 个无 GROUP/VIDEO_EDIT（nodeStore:17-24）而 group（33 处）/videoEdit（2 处）真实持久；PromptValue{text,html,referencedImageIds}（nodeStore:99-103）；position=嵌套 Y.Map 逐键（collab-doc-ops:44-59）；allImages=plain array 全仓零 Y.Array 写点；受理断链（execution.controller:33+generation-intent.service:251-264）；spool WAL 资产（[len][crc32][payload]+fsync+目录 fsync，spool.service:294-329）+批 512/8MiB（persistence:45-46,:229-239）；y-protocols errorHandler 第 4 参在（sync.js:82）；单 UndoManager 现状（canvasUndo:28-31）；perm.changed 即时踢权（session-guard:919-947）。承袭 v4 §1.3/§1.4 的 24-56 号锚点（两现行 bug/POST /canvases 缺头/39 裸构造/50ms 全量投影等）继续有效。

### 1.6 第七轮新增锚点（2026-10-24 三路核验）

- **vacuum 洞全链**：preVacuumSv 谓词 `clock>=pre` 仅作用于 SS1 分支（collab-doc-registry.service.ts:687-695——SS2/Update 分支只有帧大小/速率/只读/配额判据）；provider 协议强制先发 SS1（@hocuspocus/provider esm:851-863）→完全同步离线作者 self-clock 恒≥pre→首帧即 4410 hardClose+清空消息队列（server esm:470-476），SS2 到不了；**真实暴露面=SV 全部 clock<pre 的部分陈旧客户端**：过 SS1 门→服务端回新 doc SV→其 SS2 全量旧 structs 无校验 apply→已删内容复活/旧值覆盖；rebuildVacuumDoc=fillDoc/deepCopy 以 fresh 新 clientID 重写、旧墓碑不随行（registry:628-648，createCanvasDoc=每次随机 clientID）；官方客户端缓解=本地缓存四维键 (uid,pid,generation,schemaVersion)（local-cache-key.ts:24-25）恰依赖 generation 变化；vacuumEpoch 全库 0 命中（无任何 auth/帧层 epoch 校验）。
- **水位**：appliedSeq 在 plan v1.3/spec v5 均 0 命中；plan:141「连续 WAL 前缀→PG」无 apply 上界；plan:106-110 appendSeq/spoolSeq/pgSeq/admissionCutoff 四水位并存+@@unique([maintenanceId])+DocWriteAudit（plan:119）=v1.2 残留。
- **feed 现状**：当前 Prisma schema 无任何 feed 事件表（ExecutionOutbox/NodeExecution/RuntimeEvent 全无）；MediaFactOutbox（schema:1228-1246：state/attempts/leaseUntil/claim 扫描）=可变工作队列形态参照；CanvasDocUpdate（schema:897-906：seq BigInt+@@unique([projectId,seq])，无 frameId）。
- **Hocuspocus/y-protocols**：readSyncStep2 只传 3 参+随后无条件 writeSyncStatus(true)（server esm:277-281；Update :290-292 同款；readOnly 例外 :269-272）；collab-server.factory.ts 未接 onStateless（库支持 server esm:1070-1072，本仓只发送不处理）；仓库未配 patch-package；版本钉死 @hocuspocus/server 4.6.0/provider 4.6.0/yjs 13.6.32/y-protocols 1.0.7。
- **yjs**：scope 含根 Map 时 changedParentTypes 逐级上溯覆盖嵌套子类型（yjs.cjs:3664-3670；d.ts:52「or its children」）；addToScope=去重后 push、全库无 removeFromScope（:3726-3740；仅 add/removeTrackedOrigin :3744-3750 属 origin）；keepItem 模块私有、不在 103 条导出（:9593-9599）；clear() 经 clearUndoManagerStackItem 对两栈整栈 keepItem(false)（:3491-3499/:3751-3766）——唯一公开释放口；popStackItem 不释放。
- **web 修正**：data.prompt:string 已每键击落 doc（TextConfigPanel.tsx:31 useState 种子=data.prompt；onChange :204-212 applyNodeDataPatch({prompt})）；:157 用 prompt 覆盖正文 content 实证；TextConfigPanel 仅单选中挂载（TextInputNode.tsx:203-207）；imageExtGen 走 PromptEditor=Tiptap（ImageExtConfigPanel.tsx:13,:190-191）；audioGen prompt 住 content:string（AudioConfigPanel textarea :204-212）；multiImageGen.prompt=零写点死字段（MultiImageConfigPanel 全文 0 处）；**本库未用 y-prosemirror**（package.json 无依赖、node_modules 无目录；Tiptap onUpdate→dispatchCanvasIntent(Origin.LocalUser)——canvasIntents.ts:361-362）；canvasUndo shift 截断不释放 keep（:41-43）。

### 1.7 第八轮新增锚点（2026-10-24 核验）

- **Hocuspocus 版本事实**：4.7.0（2026-09-09：generic Context 支持+maxAttemptsFailed 修复）/4.7.1（onLoadDocument 类型修复/send batched changes）已发布——**changelog 无 apply errorHandler 相关变更**（GitHub Releases/CHANGELOG 核验）；S1 spike 双版本（4.6.0+4.7.x）实测真实 SyncStep2/Update 路径，验收=完整顺序契约。
- **外呼幂等三层已在（外审普适主张驳回）**：write-ahead providerRequestId（submit 前落库随机 UUID+X-Idempotency-Key 头——generation-intent.service.ts:369-378+api-caller.service.ts:300-304/:424-428）/providerTaskId submit 后、轮询前即落 PG（api-caller:580+schema:1073-1087+@@index）/retry query-first tryResumePoll 按任务直查零重发（execution.service.ts:361-374）——「外部成功→提交 PG 前崩溃→重复外呼」对 image/video/编辑链不成立；真缺口=**text 链零键零锚**（callTextGen :533-535 纯直呼、:553 providerTaskId=null、:365 `claimPack.kind!=='text'` 才铸键——rearm 必重呼）+供应商不认键（api-caller:62-63 注释自认；外部 at-least-once、资金 execSeq CAS 保 exactly-once）。
- **prompt 读链断供（v5.2 T2 修法依据）**：execution.service.ts:512 fallback=`upstream.textContents.join(' ') || data?.prompt?.text || data?.content || ''`——`.text` 只匹配 imageGen/videoGen 的 PromptValue 形状（nodeStore:136/:150）；TextNodeData.prompt 为 string（:107-110）恒 miss→textInput（无上游文本）执行 prompt 现状**独占依赖 :157 的 content 覆盖**；上游注入（topology.service.ts:83-84 读上游 textInput 的 content）同受影响——删 :157 后 content 恢复 tiptap 正文语义（上游注入=正文，正确语义），自身执行 prompt 须改 :512 直读 string。
- **per-project 序先例双证**：canvas_doc_update_seq nextval 取号+`pg_advisory_xact_lock(hashtext(projectId))` 保「seq 序≡提交序」（canvas-doc-update.repository.ts:61-62 注释+单语句 INSERT :64-69；:110-112 明文「nextval 取号与提交序无绑定，绕锁路径=静默丢内容」）+TeamCreditTransaction per-team `SELECT…FOR UPDATE` 保 ledger 行序（team/credit-ledger.service.ts:58-62）——RuntimeEvent per-project feedSeq 行锁方案与本仓既有纪律同构。

### 1.8 第九轮新增锚点（2026-10-24 源码核验——三外审报告交叉裁决依据）

- **Hocuspocus 4.6.0 apply 路径全链（本仓 node_modules 实读）**：`beforeSync` 存在且被 `await`（server esm:251-254，携带 type 0/1/2+`peekVarUint8Array` payload——**本仓 factory:61 已接线为 Y0b-4 配额判据钩子**）；SS2/Update 内联 `readSyncStep2/readUpdate` 后**无条件** `writeSyncStatus(true)`（:277-281/:288-292）；`statelessCallback` 不被 await、返回值丢弃（:219-224——barrier 回执必须显式 `connection.sendStateless`）；`processMessages` 同连接严格串行队列+异常→`close({code,reason})` 清队（:440-479——barrier 排序前提+gate 抛错关连接路径）；Hocuspocus 自身 apply 的 origin=`{source:'connection',connection}`（:277-280——gate pre-apply 复用同形 origin 则广播发送者排除语义不变）。
- **Yjs 幂等重放零事件**：`writeUpdateMessageFromTransaction` 返回 hasContent，仅 `if (hasContent)` 才 emit update（yjs.cjs:3385-3390）——已 apply 帧的库内重放=零 update 事件/零重复广播/零二次 spool，`SyncStatus(true)` 仍诚实。
- **帧闸代码现实（外审「1MiB/需要新设 512KB」均不准确）**：`WS_MAX_PAYLOAD_BYTES=16,777,216`（collab-limits.ts:12）；`updateFrameGate=2×maxTxBytes=512KB` **已在代码**（:28）；`ss2FrameGate=maxDocBytes+64KB≈8.06MiB`（:27+FRAME_ALLOWANCE_BYTES）——8MiB SS2 走 WS 为现行合法设计（离线合并回灌），HTTP seed 端点无存在必要。
- **display-cache 矛盾实证**：spec §2/§3.1/§6.4 v5.2「Feed 下发→客户端以用户域 origin 写回 doc」与 v5-2「serving 期零业务 doc 写」原则冲突（客户端代理服务端写=第二写路径/双真源/undo 污染面/doc 体积与 compact 负担/导出与公开快照可读=伪造面）——渲染层投影 overlay 已由 Runtime Store（IDB 持久化+feedSeq 版本化）承载离线可见性，回写整体冗余。
- **恢复时间线缺口**：本仓备份=pg_dump 恢复（backup methodology 实证）——恢复到 T 后本地 WAL 仍含 T 之后帧，按「重启从 pgSeq 重放 WAL」会复活已回滚内容；PITR/主备切换同理。WAL 段头无任何纪元标识（v5.2 帧协议仅 generation）。
- **候选验证不可判定**：update apply 前非可完整解释状态（pending structs/并发插入片段）——「对照活动 doc 现状」的引用闭包预验证结论≠apply 后真实结果；并发删除与建边的合法 CRDT 中间态（悬挂边）在准入拒绝会造成客户端本地已写/服务端没有的分叉；且 spec §3.2 自身已将悬挂边/父链环/重复边归 NORMALIZE 面——与偏离 36-①「引用闭包准入验证」内在矛盾。
- **组执行关系性需求**：GenerationIntent/NodeExecution 本为 per-node 行——plan Json 数组使每节点 claim/status/retry/退款变「读改写整个 JSON」且无 FK/唯一约束保护；批行单 `actor` 对多用户组提交必然张冠李戴（CanvasDocUpdate 现状 schema:897-906 无帧级归因）。

### 1.9 第十轮新增锚点（2026-10-24 源码核验——三外审报告交叉裁决依据）

- **广播无发送者过滤（推翻 v5.3「origin 复用则发送者排除语义不变」表述）**：`broadcast(encode, filter)` 支持 filter 参数（server esm:658-670）但 `broadcastUpdate`（:689-691）**不传 filter**——遍历全部连接含发送者；origin 只进 `onUpdate` 回调（:678），不影响广播目标。发送者必收自身回声（provider 幂等 no-op 零事件）；`flushMaxBytes=1MiB`（factory:73）——8MiB 帧 apply 即刻 `flush()` 全量扇出 N 连接（:685；OUTBOUND_BUDGET=96MiB=10×8MiB 已隐含此预期）。
- **onStoreDocument 旧链仍在接线（双写实锤）**：collab.gateway.ts:340 `onStoreDocument → persistence.storeDocumentUnlocked(p,'debounce')`+factory:57-58 挂 Server——gate pre-apply 的 update 事件触发库防抖 store=**新旧两套持久化并行**；所有权切换（T9/T10 seam switch）为 P1 入口条件。
- **DirectConnection 在役（推翻 v1.6「全仓零使用」验收）**：collab-document.service.ts:78 `withDoc` 用 `openDirectConnection`（readCanvas/shrink/exportFresh「用完即走」面），:102 以 `SERVER_TRANSACT_ORIGIN` 注入服务端事务——静态门改「serving 期业务 doc 写经 DirectConnection=0」+allowlist+census。
- **readOnly 检查晚于 beforeSync**：:251 `await beforeSync` → :264-276 readOnly 检查在 switch 内部——gate pre-apply 必须自带 readOnly/writeFreeze/quota 短路（否则 VIEWER 帧先入 doc）。
- **卸载钩子名=beforeUnloadDocument**（factory:63 接线，throw=拒绝卸载；无 onUnloadDocument）；`unloadImmediately:true`（factory:52）——库谓词卸载链在役。
- **pending 私有不可移除**：pending structs 落 `doc.store.pendingStructs`（私有 API——本仓不动红线禁列）；公开 API 面无移除/回滚——apply 后断言只能污染后报警，检查必须前移 frame-local。

## §2 四平面架构总纲

```
Web 客户端          Y.Doc / Tiptap / 单 UndoManager / 本地草稿(per-tab) / Runtime Store
协作入口(Hocuspocus) 身份与权限 · 帧解码 · 结构/字段校验 · 限流与预算
                    合法更新 → 帧去重(SHA-256) → WAL spool fsync → apply(gate pre-apply) → 广播
协作持久化平面      Spool WAL → 批量 PG append（applied 前缀单事务，上界=appliedSeq）→ Snapshot / Vacuum
业务执行平面        ExecutionRequest（全计划冻结）→ GenerationIntent → Worker → NodeArtifact → ExecutionOutbox
Runtime Feed/REST   RuntimeEvent(append-only, per-project feedSeq) + PG 当前状态 → 有序推送 · 游标续传 · 客户端增量投影
```

| 数据 | 权威源 | 传输 | 客户端 |
|---|---|---|---|
| 协作内容（meta 白名单/nodes/edges） | Y.Doc（经 WAL→PG 前缀） | CRDT 同步 | Y.Doc+投影 |
| 执行/交付/计费/生命周期/维护 | PG | Runtime Feed（RuntimeEvent 游标） | Runtime Store（只读缓存，不参与 CRDT 合并） |
| 服务端计算尺寸等派生 | PG 业务记录 | Feed 下发（事件只带 {nodeId,mediaId}——facts 走 media-facts 通道） | Runtime Store 投影（IDB 持久化+feedSeq 版本化）——**服务端派生字段永不进 doc（v5.3：display-cache 回写删除）** |

写管线不变量（v5.4 增⑧）：①客户端帧由 gate 拥有持久化与 apply（**gate 在 beforeSync 内 pre-apply——update listener 不得对 connection-origin 二次 append，亦不得承担 apply**）；②ACK 前帧已在 WAL fsync 且已 apply（SyncStatus(true)=applied+fsync 诚实档——**重复帧命中去重表必须 await 原帧 fsync+apply 完成才可放行**）；PG 失败不丢帧只延迟；③snapshot/compact 只从 PG log 的 seq 前缀生成；④save barrier 捕获 **target=appliedSeq**、返回 `committedSeq=pgSeq`（≥target 时回执——覆盖本连接此前全部帧）；⑤**PG 只提交已 apply 帧（上界=appliedSeq）**；⑥业务输赢由 PG 事务+fencing token 裁定——doc 状态/网络通知/客户端缓存不得反向决定业务结果；⑦**服务端派生字段永不进 doc——渲染=`CanvasRenderModel=CanvasReadModel⊕RuntimeProjection`**；⑧**单一所有权（v5.4）**：store/unload/compact/vacuum 生命周期全部归新管线——`onStoreDocument/afterStoreDocument` 钩子链 T9/T10 起为 telemetry-only（旧 `storeDocumentUnlocked` 防抖持久化/`maybeCompact`/`handoffOnUnload`/`vacuumReplace` 分别让位 gate actor 批/T11 worker/T13/T27）；验收=一帧恰一次 WAL append+一次 PG row+一次广播+旧 spool append 计数 0。

## §3 协作平面（Yjs=可协作内容唯一职责）

### 3.1 doc shape（v5-6/v5-7/v5-8 注：矩阵为 v5.1/v5.2 唯一基准）

- 顶层三根：`meta`（用户可编辑配置白名单）/`nodes`/`edges`；`exec` 根及读写链路删除。
- 全类型矩阵（plan 冻结具体表，冻结自真实路径 census——**census 基准见 v5-6**）：textInput{content:XmlFragment, prompt:Y.Map{text:Y.Text}}；audioGen/multiImageGen{prompt:Y.Text}；imageGen/videoGen/imageExtGen{prompt:XmlFragment（mention/image=PM 节点）→PromptValue{text,html,referencedImageIds}}；allImages/images=Y.Array（迁移单卡：写读同卡改道）；通用{position:Y.Map{x,y} 逐键, width/height/parentId:标量 LWW}；group{groupType/name/color/collapsed/order/storyboard/cells}；videoEdit{videoProjectId 等}；edges{source/target}。
- **DataKeySpec 二元+矩阵（v5.3 收敛——删 `valueSource`/`authority` 两键）**：`writer:'user'|'server'`（谁可写）；另增 `map`/`items` 容器标注+create·write·delete 三操作矩阵；运行时 gate 同表。**writer:'server' 字段一律禁入 doc**（服务端派生数据只住 PG+Feed；客户端渲染经 RuntimeProjection overlay——§6.4 v5.3）；doc 内全部业务字段 writer='user'（serving 期服务端不写 doc、客户端也不代理服务端回写）。组合合法性断言（writer=server⇒ownership=server 等）。
- 字段所有权不止 TS 类型：运行时校验+写入 API 双落；未分类字段默认拒绝——用户不能靠构造 update 绕过前端限制。

### 3.2 FrameGate（收缩面——v5.3 验证分层收口：frame-local DENY + read-side NORMALIZE + 毒帧兜底）

准入序（**gate-local=真 frame-local 检查+ProjectDocIndex 查询（与 appliedSeq 同源增量维护——嵌套字段/容器类型对既有节点的校验经索引 O(1) 查，非全 doc 扫描；本帧新建节点从 decodeUpdate struct 局部构建候选）**）：**⓪写权限态短路最先（readOnly/writeFreeze/quota——库 readOnly 检查在 beforeSync 之后 esm:264-276，gate 先 apply 则 VIEWER 帧已入 doc〔偏离 38②〕；「VIEWER 发 Update→doc 不变」用例）**→身份/项目权限/generation（**每帧对照当前世代权威——DB 或同步失效缓存，非连接建立时缓存〔偏离 36-②〕**）/帧格式→解码+结构/字段权限/预算（maxStructs/maxDsRanges/maxFrameBytes——**解压后大小**限）→**pending 区间预检（v5.4：`Y.decodeUpdate` 取各 client struct 区间 vs `Y.encodeStateVector(doc)`——区间起点 clock>SV（缺前驱）或区间内部有洞→4412 零 WAL 零 apply 零 ACK；起点≤SV 且连续覆盖=自包含 SS2 合法放行即使 max clock>SV；**禁 max-clock 单值判断**；检查通过后 apply 仍现 pending（理论不应发生）→毒帧 4411〔偏离 38②〕）**→帧字节**精确 copy 至独立 buffer**（禁 subarray 共享 buffer 直解——lib0 越界读实测）→**原始帧 SHA-256 去重（去重后才分配 walSeq——命中 inflight 必须 await 原帧 fsync+apply 完成才放行〔原帧失败重复帧同错〕；命中 applied=no-op 确认；**去重状态转移只在 actor 串行段内**；WAL 帧记录存 frameHash+启动重建有界索引（24h/100k）——「零重复 walSeq」跨重启成立〔偏离 38④〕）**→WAL。**DENY 面（frame-local）**：受保护 root/meta 服务端字段/未知类型/未知键/值类型错/容器替换（G17b 对抗面）/超预算（普通帧闸=512KB=2×maxTxBytes〔collab-limits.ts:28 单源——spec 旧文 1MiB 作废〕）；**XmlFragment 双层验证（v5.4⑫取代「T24 激活」单点）**：L1=frame-local struct 扫描（元素名/format key 白名单、ContentString 字节上限、字符串 URL allowlist 扫描、新子树深度上限；拒 XmlHook/嵌套 XmlFragment/未知 XmlElement——shared 单表与 PM schema 派生+setEqual；**T16 同卡激活**，T24 扩全类型矩阵）；L2=apply 后 changed-subtree walk（afterTransaction 触达子树——语义层；**T24 激活**；违规走毒帧+per-connection 毒帧速率限制防重复重建 DoS）；导出 HTML/公开快照二次 sanitize；mention/image=mediaId 存在性归执行受理/ProjectDocIndex不入 gate。**NORMALIZE 面（v5.3 扩——引用类语义全后移读侧）**：悬挂边/父链环/跨组 parent/重复边/**媒体引用指向不存在资源/边引用不存在节点/引用闭包类一切跨节点关系**（读侧确定性屏蔽+graph_anomaly_total{kind}，依托 ProjectDocIndex 装载建+增量维护；只读不写回；并发删除+建边=合法 CRDT 中间态，拒绝必致客户端分叉）。**毒帧面（唯一兜底）**：Yjs `applyUpdate` 自身抛异常（§4.3）。**业务权限语义授权不在 gate**——归执行受理（PG 事务核验，§6.1）。**大帧通道（v5.4⑱）**：8MiB SS2 走 WS（**WS maxPayload 16→9MiB**〔>ss2FrameGate 8.06MiB 即可，16 纯增攻击面〕+认证后 per-connection 入站排队字节上限 2×ss2FrameGate 超限 1009+入站速率桶；**SS2 大帧并发信号量（全局内存预算+per-project 1）**）；发送者回声为库行为（broadcast 无 filter——§1.9），echo 成本入 T33 `echo_bytes` 分轴；client→server 大差量恢复=**recovery import（DraftEnvelope REST，≤8MiB，OWNER/EDITOR 且仅本人 draft+幂等键+候选 doc 全量校验——唯一允许 clone 的场所）**；HTTP seed 端点废止（触发条件进 T29）。**clientID 绑定+单活跃（v5.4⑰）**：绑定键=`(projectId,generation,userId,clientId)` 四元+绑定表 `connectionId/lastSeenAt`——**同一四元组只允许一个活跃连接**（旧连接活跃→先 close 旧再纳新；僵尸超时替换；禁两活跃连接共享 clientID——同键并发=CRDT 结构性损坏）；同用户多 clientID 并发放行；异活跃用户拒绝、碰撞=可重试 close（clientID=CRDT 结构标识非身份凭证）。**协议版本门拆分（v5.4⑧）**：**protocolVersion+schemaVersion+historyId=硬门**（缺失/低于最小=4406 client-outdated+客户端强刷）；**build hash 仅遥测/错误上报**（每次 hotfix 不强刷全员）。**origin 枚举（v5.4⑤）**：`doc_update_origin_total{origin}` label 限 `gate|connection|load|import|maintenance|server-direct`——仅 server-direct 在 serving 期写 doc 时告警（load/import/maintenance=合法受控路径）。**无 provenance/无区间授权/无 shadow/clone**。

### 3.3 单 UndoManager（v5-10 v5.1 形态）

画布级 `UndoManager([nodes,edges],{trackedOrigins:LocalUser,captureTimeout:500})`（**不 addToScope**——父链覆盖实证）；不挂 yUndoPlugin；Ctrl+Z 薄 keymap 按焦点归属路由；文本+画布同一撤销栈（跨编辑器顺序非全局=产品语义）。**栈上限>100=整栈 clear()**；不写「shift 后字节回落」验收；doc rebuild 先测后建（unsyncedChanges===0 且字节超阈值）；T16 ySyncPlugin origin 由 T0 spike 实测、按需 addTrackedOrigin。

### 3.4 本地缓存（v5-11）

per-tab 记录+boot mergeUpdates 并集；clean 不覆盖 dirty；同步成功删己记录；**generation 变更（含 vacuum 换代）清整族**（vacuum 走 4410 doc-vacuuming+discardLocalCache:true 显式清，不靠改键；**换代前先保存可恢复脏草稿再清——禁静默丢离线编辑**）；**savedSeq 只由服务端持久化回执（save barrier pgSeq）推进（偏离 36）**；IDB blocked/quota 降级。

### 3.5 容器规则（G17 收缩）

结构创建时一次性建合法共享容器（唯一创建者=写 seam）；普通业务写禁懒创建掩盖结构错误；undo 重建合法（新容器）；恢复不得夹带服务器字段。**nodeId 即身份**；生命周期需要代际时用 PG `lifecycleSeq`（数值 BigInt——字符串序禁），不做 Yjs Item/struct adapter。

## §4 持久化平面（spool-first）

### 4.1 写入次序（v5.4：apply 归属+actor 队列+所有权切换）

**`CollabProjectActor`（per-project 单例——偏离 38③）**：`submit(frame,conn)→Promise` 入队；单 drain 循环批量 ≤20ms/1MiB → 一次 WAL append+fsync → 逐帧 `Y.applyUpdate`（origin=`{source:'connection',connection,gate:true}`）→ 逐帧 resolve（beforeSync await 该 promise）；actor 兼承载 in-flight 去重 promise map 与 FrameEffects 收集。次序：①写权限态短路（readOnly/writeFreeze/quota 最先）+会话身份/项目权限/generation（每帧对照世代权威）/帧格式→②解码验证结构/字段权限/预算+pending 区间预检（frame-local——§3.2）→③帧字节精确 copy+**SHA-256 去重（promise map）**+分配 `walSeq`→④批量追加 WAL+一次 fsync（新段含目录 fsync）→⑤actor 内 pre-apply（Hocuspocus 随后的内联 apply=幂等重放，yjs.cjs:3385-3390 零 update 事件；gate 抛错→close 4411 且无 SyncStatus(true)）→appliedSeq=walSeq→⑥广播由 ⑤ 的 update 事件驱动（**broadcast 无 filter——发送者必收自身回声，provider 幂等 no-op〔§1.9 认错修正〕**）→⑦后台将 **applied 队列连续前缀**写 PG（单事务多行，上界=appliedSeq），提交后推进 `pgSeq`。**spool-first≠先 ACK 后验证**——准入先于一切；ACK 与承诺的持久等级严格一致。**所有权切换（偏离 38①）：`onStoreDocument/afterStoreDocument` 钩子链 T9/T10 同切片改 telemetry-only/拆除——旧防抖 store/`maybeCompact`/`handoffOnUnload`/`vacuumReplace` 让位（验收=一帧恰一次 WAL append+一次 PG row+一次广播+旧 spool append 计数 0）**。**不引入 patch-package/不升级 4.7.x；apply 重放与回声成本入 T33（apply_replay_ms/echo_bytes 软预算——超限触发 fork/patch 评审，非「只测不补」〔偏离 38⑲〕）**。

### 4.2 ACK 与耐久契约（v5-4；v5.3 barrier 钉死）

Applied/Spooled/Durable 三档+**UI 四态映射（Local 编辑中/Spooled 已接收正在保存/Applied 已同步等待数据库提交/Durable 已保存——Durable 必须对应可验证 pgSeq 回执；不因 WebSocket 连接或 SyncStatus 自动显示；Spooled=客户端本地瞬态，无 wire 消息）**；save barrier=**onStateless**（**v5.3 钉死算法**：handler 首语句**同步捕获 `target=appliedSeq`**（任何 await 之前——捕 pgSeq 会少报已 apply 未落 PG 的帧；捕 walSeq 会误等他连接在飞帧）；`flushThrough(target)`→等 `pgSeq>=target` 有界等待→回执 `{nonce,clientSeq,committedSeq=pgSeq}`；**`onStateless` 不被库 await 且返回值丢弃（esm:219-224）——回执必须 handler 内显式 `connection.sendStateless`；handler 按 nonce 幂等（重试同结果）；永不 throw（catch 后回 `{nonce,error:'BARRIER_FAILED',committedSeq:当前pgSeq}`）；maintenance freeze 期回 `{ok:false,reason:'maintenance'}` 不产生 Durable**）；**clientSeq=客户端每次本地编辑自增、barrier 请求携带、服务端原样回显——UI 判 Durable=`resp.clientSeq>=lastLocalEditSeq && resp.committedSeq`，客户端无需知晓 walSeq；v5.4 增配 `tabId/sessionEpoch`（clientSeq 在 reload 后重置，回执按同 session 比较）**；触发时机冻结：**最后编辑后 800ms idle/持续 dirty 最长 5s 一次/pagehide+visibilitychange:hidden 立发/执行前 await ensureDurable/重连同步完成后重发**；**v5.4：服务端按项目合并 barrier 等待（flushThrough ≤250ms 节流——barrier 只承诺「目标前缀已提交」不承诺「立刻新建 PG 事务」；flushThrough 契约=幂等/有界等待/不阻塞写入/返回当前 pgSeq）**；失败退避 1s/2s/5s/10s；拒帧连接屏障不可成功；断线新 nonce。**barrier 语义=per-tab**（只覆盖本连接此前帧；项目级「全部保存」由各标签 dirty 清零推导——durable watermark 广播（PG 批提交后 per-project ≤1 次/秒 `broadcastStateless({type:'durable',pgSeq})`）仅作辅助显示与观测，不替代 barrier）；**factory 接线 onStateless——现状未接，P1 T10 落（v5.3 前移——P2 UI 依赖）**。

### 4.3 WAL 与内存 doc 原子性边界（状态机——v5.1 水位化）

- **WAL fsync 成功+apply 失败（毒帧）**：隔离当前文档、停止后续可见写入、**WAL 截断至 appliedSeq**、隔离毒帧、close 4411、从 pgSeq 重放——**不得跳过毒帧继续提交后续序号**（截断后 spooled 未 applied 的帧随 4411 重同步恢复——Spooled≠Durable 诚实语义）。**同步关闭该项目全部连接须在 setImmediate 广播 flush 之前完成（坏帧不漏给其他在线端）**。
- **WAL fsync 失败分档（v5.4⑱）**：**EIO=fail-stop 不可恢复**（置 walHealthy=false/停收帧/close 全部连接 1011/标记隔离/要求进程重启+磁盘检查——**不进截断复用路径**；`wal_fsync_error_total{device}` 告警不自动重试）；**写前失败/ENOSPC 可恢复档**=截断回 last-good offset+复用已分配未落盘 walSeq（不留洞）+fail-closed 停收；截断本身失败=quarantine 段+拒服务。
- **pending struct=协议违规（v5.3⑧；v5.4 检查前移 §3.2——apply 后无公开移除 API）**：frame-local 区间预检（decodeUpdate 各 client 区间 vs SV：起点 clock>SV 或区间有洞→4412 **零 WAL 零 apply 零 ACK doc 不变**；连续覆盖=自包含 SS2 合法——禁 max-clock 单值判断）；预检通过仍现 pending（理论不应发生）=毒帧 4411 路径；指标 `doc_pending_reject_total`——**appliedSeq 永远等于「完全整合」，ETag=pgSeq 语义才成立**。
- apply 成功+广播失败：不回滚已持久接收的更新；客户端经重连+SV 同步补齐（best-effort——发送者 ACK 允许领先其他在线端，收敛=断线重连+SV 同步；`provider.forceSyncInterval=30s` 兜底；出站缓冲超限=断慢消费者连接由客户端补齐——出站背压现行机制承袭）。
- PG 批量提交失败：保留 WAL，不推 pgSeq，重试。
- 进程重启：先恢复连续前缀（从 pgSeq 重放 WAL+前缀校验重建 appliedSeq），再开放写入；**恢复扫描先校验段头 historyId（§4.4）——不匹配段整段 quarantine 不重放**。
- **doc 卸载纪律（v5.3⑩；v5.4 修正钩子名与容量上界）**：**`beforeUnloadDocument`**（throw=拒绝卸载——无 onUnloadDocument 钩子）必须 drain applied→PG 或**拒绝卸载**（applied>pg 时不许静默卸载丢前缀；PG 不可用=doc 常驻/fail-closed）；**`maxResidentDocBytes` 全局驻留上界（如 2GB）——到顶后新项目 onLoad 503/4413 不 OOM**+`doc_unload_blocked_total` 指标；LRU 触发卸载按此纪律；per-project 互斥/spool 队列/去重 hash 按 (projectId,generation) 随卸载清理。
- 无法证明状态一致：拒绝服务（fail-closed），不静默跳坏帧。
- SV 适合确定双方缺失结构，**不替代 WAL 提交水位**。

### 4.4 WAL 能力清单（v5.2 命名统一；v5.3 补 historyId+批检查点+spike 触发器收紧）

单调帧序号（walSeq）/SHA-256 帧去重（幂等重放零重复业务效果+零重复 walSeq——**传输层去重≠业务层幂等：执行/退款/交付/资源释放由业务幂等键+唯一约束+fencing 保护，两层不混**；**帧记录存 frameHash+启动重建有界去重索引（24h/100k）——跨重启「零重复 walSeq」成立〔偏离 38④〕**）/CRC+可验证记录边界；**水位拆义（v5.4⑥）：内存三元 `spoolHeadSeq`（最后 fsync 帧序号——内存+WAL 段 manifest）/`appliedSeq`/`pgSeq`，不变量 `0≤pgSeq≤appliedSeq≤spoolHeadSeq`（**永不与持久列比较**）；`CanvasDoc` 持久列改名 `walCheckpointSeq`（=批提交时刻 spoolHeadSeq 采样——随 PG 批同批更新非每帧写，CHECK pgSeq≤walCheckpointSeq；恢复以 WAL 扫描为准、列只作快路径）**+恢复时连续前缀校验（扫描完整有效前缀，截断/隔离无效尾部）；部分批次失败重试；坏段隔离+告警；磁盘空间上限+写入背压+故障停收（fail-closed）+**per-project 写入背压（慢项目不拖垮其他项目——偏离 36-③）**；崩溃恢复从 pgSeq 重放（不依赖进程内状态）；快照指针发布与 WAL 清理分离（purgeBelowSeq 水位先持久再分批删，启动续跑）。**WAL 段头（v5.4⑦ 扩容）：`{magic,version,projectId,generation,historyId,lastWriteAt,createdAt}`——historyId=**SystemHistory 全局单行唯一权威**（删 CanvasDoc.historyId 列——restore 恒为整库恢复，per-project history 不支持；bump=单事务更新 SystemHistory〔+trigger 同步缓存〕提交后才允许启动；启动任一不匹配 fail-closed 不自动修复）；段头 historyId≠SystemHistory 当前值=**整段 quarantine 不重放+fail-closed**（防恢复后 WAL 回放复活已回滚内容——本仓备份=pg_dump 恢复实证）；**时间戳栅栏（防忘跑 bump）：段头 lastWriteAt>SystemHistory.epochStartedAt→整段 quarantine+RESTORED_READONLY（同机时钟偏移可接受——fail-closed 方向正确）+备份工具写 restore.lock marker 双保险**；`--adopt-wal` 仅 historyId 已匹配+operator 显式确认+审计**。**PG 批行形状（v5.4⑤ 收紧）**：不存单 frameId——存 firstWalSeq/lastWalSeq/frameCount/updateHash（**=有序 frameHash 列表的 SHA-256**——非 merged update 字节，保证重试/重组批幂等；唯一=批重试第二道保险）+**actorRanges Json 单表示（删 actor 列；`[{from,to,userId,actorKind}]` 区间覆盖 [firstWalSeq,lastWalSeq] 每帧不重叠无空洞——**from/to 用十进制字符串（BigInt 禁入 JSON number）**；userId 仅内部 ID 禁 email/IP/connectionId）+敏感操作（删除/执行/权限变更/维护/退款）同 PG 事务写 DocAuditEvent（保留 180 天，不含正文）**。**WAL 拓扑（v5.3 定形 per-project；v5.4⑱ 补档位）**：现状 per-project owner 分段文件维持；多项目 fsync 放大实测（10 项目×10 连接，p95>20ms 持续）；**升级序=组提交调优（actor 批窗）→p95>20ms→4-way hash(projectId)%4 分片日志（每片独立 writer/fsync）→仍不达标全局 WAL=新 ADR**；帧带 projectId/generation；**帧内一律携带 generation**。**换代（含 vacuum）=WAL 段 namespace 切代+旧段 quarantine+跨代连续 seq（T12 落定——spoolHeadSeq/pgSeq 水位**保留不重置**；purgeBelowSeq 清档、currentSnapshotRev 归 0 指针复位；换代状态机单入口见 §6.6）**。

### 4.5 compact/vacuum（v5.1——D2；v5.2 勘误快照约束；v5.3 补 DraftEnvelope 三场景表）

compact=快照前缀发布+WAL 分批清理（指针短事务+水位同事务持久+提交后 worker 进程后台删——COLLAB_ROLE worker，真进程隔离；授权=CanvasDoc 行锁+generation/pgSeq CAS，不拿租约；**`Snapshot.stateSeq≤pgSeq` 为跨表不变量——由快照发布事务内行锁+条件更新验证保证（非 CHECK，偏离 26 v5.2）；compact 失败保留原可用快照与 WAL，不提前清理**）。**vacuum=文档重建：重放重建 fresh doc（新 clientID 重写）→generation++→新 docName(#g)→替换快照→关连接（4410 doc-vacuuming，载荷 discardLocalCache:true）**；离线 dirty 客户端：重连旧 #g=auth 直接 generation mismatch（不装载、不 SS1、不上行旧 structs）→导出 DraftEnvelope→清缓存→新 name 重连导入（**导入前执行新 Schema/权限/图结构校验——恢复流程非兼容层**）。**vacuumEpoch 仅遥测计数**。preVacuumSv SV 重叠门退役（偏离 27）。保留策略=检查点语义（当前代最近 2 份+旧代最终 1 份；禁删指针引用行）。

**DraftEnvelope merge policy=v5.3 三场景表（无 basePgSeq 3-way merge——自动三方合并在无服务端基座时不可判定，整族不做）**：

| 场景 | 处置 | 用户可见 |
|---|---|---|
| A 两标签离线草稿（同代） | boot 时 `Y.mergeUpdates` CRDT 并集（§3.4 既有——两标签独立 clientID，raw merge 安全）+**v5.4：boot 合并后跑一次 ProjectDocIndex 异常检测（重复 order/slot/悬挂边/跨组 parent/cells 越界）作「合并提示」展示——不阻断合并，不宣称无冲突面（CRDT 并集≠用户语义无冲突：A 删 B 改同节点等）** | 正常收敛+异常提示 |
| B 拒帧恢复（同代） | **v5.4 改用户裁定式（typed 自动重放无 journal/base=LWW 覆盖，废止）**：客户端重置到服务端状态；草稿转 read model（剥服务端字段）——**新增节点直接导入（用户确认数）；修改字段逐字段「当前值 vs 草稿值」二选一（默认保留当前——无 base 不自动判）；删除/恢复显式确认不自动复活**；不重放被拒原始 update | 字段级冲突确认面（非「预览计数」）→导入/取消 |
| C 换代导入（跨代） | 导出 DraftEnvelope→清缓存→新 #g 作**新节点导入**：**nodeId 稳定不重映射（v5.4——重映射断 parentId/cells/meta/PG bindings；与现有 nodeId 冲突=跳过/替换用户选，不自动改 ID）**+边指向缺失节点丢弃并报告+服务端候选 doc 全量校验（Schema/权限/图结构/XML 白名单——恢复流程非兼容层） | 确认面固定三行：内容节点数/丢弃引用数/**不恢复产物·执行历史·计费记录**（导入后状态 unknown，执行按钮可用需重新生成） |

Envelope 为**类型化导出清单**（draftId/projectId/generation/schemaVersion/capturedAt/tabId/nodes/edges/meta/hashes——非 CRDT update 裸字节）；导入=单飞（每项目同时一个 draftId）+幂等键+OWNER/EDITOR 且仅本人 draft+≤8MiB（超限=导出文件+fail-closed 不开导入）；跨代原地合并不做（另立 feature 才可）。

## §5 代际与版本模型

### 5.1 代际三元+水位三元（v5-2 v5.2 形态——spoolSeq 别名删除）

| 字段 | 语义 | 变化时机 | 客户端行为 |
|---|---|---|---|
| generation | 文档身份/schema 代际 | 硬重置/schema 迁移/**vacuum** | 4410 换代，新 docName(#g)，清整族缓存 |
| snapshotRev | 快照版本 | compact 发布 | 不重连（最多 doc-status） |
| vacuumEpoch | 压缩操作代次（**遥测**） | 每次 vacuum | 无行为分支（观测/诊断） |

```text
walSeq      gate 去重后分配的帧序号（per project 连续——帧的身份序号）
spoolHeadSeq 最后一个 fsync 成功的 walSeq（内存+WAL 段 manifest——v5.4⑥ 拆义新名）
appliedSeq  最后 apply 成功且完全整合（无 pending）的 walSeq（内存/批级，不逐帧落库；重启由 WAL+pgSeq 前缀校验重建——内存值不作持久权威；由 actor 推进〔§4.1〕）
pgSeq       最后 PG 提交的 walSeq（CanvasDoc 持久列；CanvasDocUpdate 批行 seq=该批 lastWalSeq）——对外唯一「已保存」水位
不变量（内存三元）：0 <= pgSeq <= appliedSeq <= spoolHeadSeq（appliedSeq 可暂时落后 spoolHeadSeq——已 fsync 未 apply；PG 批末端序号不得超过 appliedSeq；fsync 写前失败/ENOSPC 截断复用 seq 不留洞、EIO fail-stop〔§4.3〕）
CanvasDoc.walCheckpointSeq = 批提交时刻 spoolHeadSeq 采样（持久列——随 PG 批更新非每帧写；恢复以 WAL 扫描为准；永不与 appliedSeq 比较）
CHECK（同行）：CanvasDoc (pgSeq <= walCheckpointSeq)
跨表不变量（Snapshot.stateSeq <= pgSeq）：非 CHECK——快照发布事务内行锁+条件更新保证（§4.5）
G2 断言（独立）：CanvasDocUpdate.lastWalSeq <= appliedSeq（批行只从 applied 队列取）
```

- PG 批只从 applied 队列取（若从 WAL 扫，必须 walSeq≤appliedSeq）；apply 失败不得提交。
- **docSeq=pgSeq；committedSeq=pgSeq；ETag/read model 新鲜度/公开快照水位一律 pgSeq**。
- **ExecutionRequest 受理读=PG 一致前缀**（拿 gate→flush applied→PG→读 live doc；或 snapshot+updates at pgSeq 重建）——不读「已 apply 未 PG」的 live doc。

### 5.2 版本维度

generation/vacuumEpoch(遥测)/snapshotRev/水位族（walSeq·spoolHeadSeq·appliedSeq·pgSeq·walCheckpointSeq〔v5.4 拆义〕）/docSeq（=受理冻结的 pgSeq）/execSeq（节点执行代际序——GenerationIntent 代际/NodeExecution 更新守卫族，比较单源=compareExecSeq；**与 lifecycleSeq/fenceSeq〔生命周期族——NodeLifecycle/DeliveryFence〕全文分离、两族序永不互换互指**〔确认点①附带裁定 #4——T21 生效〕）/**nodeVersion（节点状态截至 feedSeq 水位——v5.4 单名单义，eventVersion/projectedEventVersion/projectedExecSeq 全部废止）**/lifecycleSeq（节点生命周期序——NodeLifecycle 当前行/DeliveryFence.fenceSeq 同源）/artifactRev（产物槽位版本)/**feedSeq（RuntimeEvent per-project 序——跨代不重置）**——作用域/比较方式/持久化位置/重置规则各自明确；**BigInt 入 JSON/WS payload 显式 String()**（bigint-json gate 进 verify）。

### 5.3 缓存键双轨

公开快照（已发布检查点）=(projectId,generation,snapshotRev)；read model 缓存（新鲜度）=(projectId,generation,pgSeq)——不混用。

## §6 业务平面（PG 唯一权威）

### 6.1 ExecutionRequest（v5-8；v5.3=父子行+ExecutionInput+frozenDocSeq——偏离 37⑤，plan Json 数组/scopeNodeIds 废止）

```prisma
model ExecutionRequest {            // 父行（每请求一行）
  id            String   @id @default(cuid())   // 内部主键（v5.4⑨——客户端字符串禁作全局 PK）
  requestId     String                    // 客户端幂等键（项目内唯一）
  projectId     String
  generation    Int
  historyId     String                    // v5.4⑨：PITR 后同 requestId 重试不匹配→409 REQUEST_STALE
  docSeq        BigInt              // 客户端下界（=客户端已确认 pgSeq）
  frozenDocSeq  BigInt              // 服务端实际冻结值（>=docSeq；同 requestId 重试返回原值）
  userId / teamId / kind / state / reservedCredit / totalCredit / planHash(Char 64) / inputHash(Char 64)
  expiresAt     DateTime            // =now+15min（未 claim 由 sweeper 逐 item void）
  @@unique([projectId, requestId])
}
model ExecutionNodePlan {           // 子行（每节点一行——claim/retry/退款/artifact 的关系性载体）
  requestId / nodeId / order Int
  type / model? / resolution? / styleId? / pricingRuleId? / creditCost / reservedCredit / paramsHash
  status / generationIntentId? / execSeq?
  @@id([requestId, nodeId]) @@index([requestId, order])
}
model ExecutionInput {              // 冻结输入（PG Bytes/TOAST——不引对象存储依赖）
  requestId String @id
  encoding String                   // json+gzip/brotli（v5.4⑩——node:zlib，禁 zstd 原生依赖）
  content Bytes                     // stored<=2MiB 且 raw<=8MiB（任一超限 413）
  contentHash Char(64) / rawBytes / storedBytes / schemaVersion / expiresAt DateTime  // expiresAt 必填（终态 30d 清理 worker）
}
```

- **scopeNodeIds 不落列——从 ExecutionNodePlan 派生**；**planHash 只覆盖不可变计划字段（v5.4⑨：nodeId/order/type/model/resolution/styleId/pricingRuleId/creditCost/paramsHash——status/execSeq/generationIntentId 不进 hash）**=sha256(按 order 排序子行)——冻结后不可变的单源证明；`inputHash`=ExecutionInput.contentHash。上游节点不进子行；上游内容进 ExecutionInput 作冻结输入（直接父节点 only——与 topology 现状语义一致，不扩多级）。
- **受理校验（插入前一次性，任一失败整请求 4xx 不落半行）**：nodeIds 非空/去重/≤EXEC_MAX_NODES(20)/全部属于本项目/frozenDocSeq 前缀存在且 type 与 plan 一致/拓扑无环/至少一个 executable。
- **frozenDocSeq 正确临界区（v5.4⑪——修正 v5.3 顺序错误）**：`docSeq`=客户端下界；受理在 **per-project gate mutex 内**：freeze（=拿 mutex 阻止新 beforeSync 进入，非布尔 flag）→等当前 apply 完成→`flushThrough(appliedSeq)`→断言 pgSeq==appliedSeq→校验 generation 未变→**只读 scope 节点+直接父节点（禁全量 readCanvas）**→frozenDocSeq=pgSeq→释放；**超时 2s→503 不落行；freeze 预算 500ms 超时回退 PG 前缀重建候选 doc（不无限阻塞项目 actor）**；同 requestId 重试幂等返回原 frozenDocSeq，**同键不同 body（planHash/inputHash）→409 IDEMPOTENCY_CONFLICT**；maintenance active→409/503；doc 已卸载→PG 重载后再读。
- **资金预留 per-item（v5.4⑨）**：受理事务内按 item 预留（复用 team-credit FOR UPDATE/CAS——写 `ExecutionNodePlan.reservedCredit`）；未 claim 过期请求由 sweeper 逐 item void 释放；部分失败按 item 释放/结算；requestId 幂等重试不重复预留。
- **受理读=PG 一致前缀**（§5.1）——否则冻结的 prompt/upstream 可能包含未持久帧。
- 客户端流程：save barrier→拿 clientSeq 回执→带 docSeq 调 execute（**请求不携带提示词参数——promptText 等冻结字段由服务端从 PG 前缀恢复 doc 内容冻结〔偏离 32 v5.2 维持〕**）。
- **输入预算（冻结数字）**：ExecutionInput **raw≤8MiB 且 stored≤2MiB 任一超限 413**（`EXEC_INPUT_TOO_LARGE` 列超限 nodeId 不落请求；组执行超限 UI 提示缩小范围不静默截断）；promptText ≤256KiB（413 `PROMPT_TOO_LARGE`）；upstreamMediaIds≤200/referencedImageIds≤50（413）——**不截断、不分片**；共享上游按 sha256 去重只存一份；媒体只存 mediaId+元数据；日志禁整 payload（Sentry 只带 requestId/contentHash/bytes）。
- `GenerationIntent` claim 时创建并关联 requestId；paramsHash/pricing 只读 request 不重算；**同 requestId 重试返回原请求（幂等受理维持）**。**worker 零 doc 读**（只读 ExecutionNodePlan+ExecutionInput）。

### 6.2 执行链

`ExecutionRequest → GenerationIntent（claim 创建/关联 requestId）→ Worker（零 doc 读）→ NodeArtifact（权威交付）→ ExecutionOutbox`。NodeExecution=**当前行表** PK(projectId,nodeId)+**generation 列+更新守卫（generation 匹配且 execSeq 单调才写——旧 worker 迟到更新拒绝）+nodeVersion（=该节点末次事件 feedSeq——v5.4 删 projected 元组，单名单义见 §5.2/§7）**（历史留 GenerationIntent；artifact 槽位版本读 NodeArtifact 不建第二套）；ExecutionOutbox 唯一键含 generation+业务幂等键 businessKey+claim lease（SKIP LOCKED）——**工作队列职责，不作 feed 日志（feed=RuntimeEvent，§7）**；pending outbox 行不按 watermark 过滤；冷装载/换代/恢复全量对账；ArtifactProjection 分步退役（先证明新链路覆盖六终态/重试再删）。

### 6.3 交付状态机与退款 fencing（v5.2 补外部副作用幂等注记）

文件生成/对象存储上传/DB 事务非原子——可恢复交付状态机：受控上传任务→受限 objectKey+版本标识→校验身份/大小/完整性/权限→带执行身份 fencing 的 DB 事务终局→outbox 事件→未完成/失效/孤儿可重试清理。退款/删除引用精确业务记录（exact settle row/reversesId 幂等；Refund unique+reversesId），不依据客户端 doc 字段或过期 worker 状态。materializeRunId/expectedExecSeq/StorageReservation 终态释放/GC delete-claim 承袭 v4 §2.9；ObjectManifest claimOwner/claimUntil。**外部副作用幂等（偏离 36-④）：submit-poll 链三层防护已在（write-ahead providerRequestId+providerTaskId 先落库+query-first resume——§1.7 实证）；text 生成链补外呼锚（现零键零锚）；供应商不认键的 submit→落库窗=外部 at-least-once 诚实登记，资金由 execSeq CAS 保 exactly-once——数据库 fencing 无法撤销已发生的外部调用，外部幂等键是唯一屏障**。

### 6.4 尺寸元数据模式与 RuntimeProjection 读径（v5.3 重写+v5.4 读径收口）

服务端计算尺寸→写权威业务记录→Feed 事件只带 `{nodeId,mediaId}`→客户端查既有 media-facts 通道（MediaFactOutbox POST batch）取 natural size/`downscaledFrom`/state→**写入 Runtime Store 投影（IDB 持久化+feedSeq 版本化）——渲染层 `CanvasRenderModel=CanvasReadModel⊕RuntimeProjection` 合成**。**服务端派生字段永不进 doc**；离线可见性由投影持久化承载（显示「上次已知（截至 HH:mm）」+stale 角标，执行按钮禁用 fail-closed；从未收到过=unknown 不显示 idle）。作者态 width/height（用户拖拽）仍在 doc；服务端 natural size 只在投影。

**RuntimeProjection 契约（T5c 冻结——v5.4⑬）**：`{projectId,generation,feedSeq,pgSeq,nodes:Record<nodeId,{exec?,media?,deletedAt?}>,mediaFacts:Record<mediaId,{...factVersion,feedSeq}>}`；**merge 规则=同字段 nodeVersion 大者胜/deletedAt 版本大于任何字段版本则清空/generation 不匹配整族清/unknown≠idle**；shared 唯一 merge 函数。**四读径（doc 无服务端字段后的完整读者面）**：①**公开快照/分享页**=`toPublicReadModel(renderModel,policy)`——快照发布时**服务端做 PG projection join**+缓存键加 `projectionSeq/feedSeq`（(pid,g,snapshotRev) 会拼「旧文档+新图片」）；②**用户导出/备份**=render model（`serializeCanvas` 仅 doc 备份不作用户导出）；③**复制/粘贴/duplicate**=typed **`BindMedia/CloneBinding` 命令**——源 nodeId/mediaId 作命令参数（非 doc 字段），服务端校验权限/归属后写 PG binding+发 feed；**复制只复制用户域字段，mediaId/fileId/artifactId 一律清空由目标节点重新产生；组 cells 格位保留媒体引用清空；跨团队粘贴加 media ACL**；lifecycleSeq 新生成、NodeArtifact 不挂旧产物；④**video-work clone**=服务端用 render model 复制（不读 doc 猜 fileId）。

### 6.5 生命周期义务（G13/G14 收缩形态；v5.3=closed enum+FEED_TOMBSTONE）

服务端**只读观察**已受理帧的 nodes/edges 事务→NodeLifecycle（lifecycleSeq 数值序+当前行 partial unique）/DeliveryFence 义务行**与对应帧前缀的 PG 批事务同事务落库**（帧↔义务原子；**义务由 actor 的 FrameEffects 生成——不做第二套 Yjs update 语义解析器**；observer 按 walSeq buffer 与批同行；**义务可从帧前缀确定性重建**——崩溃后重放前缀恢复义务，不依赖进程内状态）；incident-edge/media 反查用轻量反向索引（**ProjectDocIndex**：edgesByNode/mediaRefsByNode——装载建+增量维护）。**FrameEffects/ProjectDocIndex 契约（v5.4⑮——T5b 冻结类型，解 T24↔T26 循环引用）：`FrameEffect=NODE_CREATED|NODE_DELETED|NODE_RESTORED|EDGE_ADDED|EDGE_REMOVED|MEDIA_REF_ADDED|MEDIA_REF_REMOVED|FIELD_CHANGED{nodeId,key}`（均带 walSeq）；`ProjectDocIndex={nodeType(nodeId)/edgesByNode/mediaRefsByNode/apply(effects)/rebuild(doc)}`——effects 由 actor 在 pre-apply 时从 decodeUpdate+当前索引计算（per-transaction 收集器=afterTransaction+根 observeDeep+typeIdToNodeId 映射，apply 前清空 apply 后取走；失败/pending 丢弃），与 walSeq 一起进 observer buffer 与 PG 批同事务；索引与 appliedSeq 同源、崩溃从 WAL/PG 前缀重建、只消费 effects 不直接 observeDeep；T24 建索引并用于 NORMALIZE/frame-local 字段校验（§3.2），T26 复用同实例持久化义务——禁止第二套解析器**。genesis 行=T7/T21 建。delete 已删=no-op 不二次退款；undo 重建=新 lifecycleSeq+恢复态；delete+restore 同帧=两行；两项目同 nodeId 不互串。**义务种类=closed enum（新增种类=新功能走 spec 修订，非随手加 string；T5b 按真实子系统 census 定员——必含 `FEED_TOMBSTONE`（删除已提交→客户端清 Runtime Store 投影），按需含 EXEC_CANCEL/REFUND/MEDIA_GC/ARTIFACT_INVALIDATE/STORAGE_RELEASE 等）**；交付事务写 artifact 前必须检查 `DeliveryFence.fenceSeq==当前 lifecycleSeq` 且 state 允许——fence 不匹配=丢弃不退款；**deliverArtifact 的 node-deleted 权威观察点自 T22 起从 doc（data.written:false）切换为本表——T26 观察器（delete/restore 维护+当前态）必须先于/同切片 T22 落地（P3 排序 T21→T26→T22，偏离 38⑳）**。

### 6.6 维护窗口（T10-lite）与 genesis（v5.3 补 9 段转移表+切代前置）

**stage 转移表（9 段+FAILED/ABORTED 终态——SWITCHING=唯一不可回退点）**：

```
REQUESTED→FREEZING→DRAINING→DRAINED→EXPORTING→REBUILDING→SWITCHING→VERIFYING→COMPLETED
                                  ↘FAILED（任意阶段：保持只读+告警+人工显式 resume——不自动恢复写）
                                  ↘ABORTED（仅 SWITCHING 之前可 abort 解冻恢复）
```

| 阶段 | 前置 | 动作（幂等） | 失败 |
|---|---|---|---|
| REQUESTED | 无活跃维护 | **同一 PG 事务**写 MaintenanceOperation+**CanvasDoc.maintenanceId（行级关闸——执行受理读 maintenanceId IS NULL 才放行，先关入口再查/等 in-flight；非 check-then-act）**+admin 鉴权+幂等键；**in-flight 判定范围含 GenerationIntent/ExecutionNodePlan/ExecutionOutbox/delivery·materialize 在飞/退款义务（drain 到终态或 generation fence 显式拒绝——v5.4⑯）** | FAILED |
| FREEZING | REQUESTED | gate 置 freeze；新帧 503/**4413 maintenance-freeze（Retry-After 可重试——v5.4⑯ 定义入 close-code 表+resolveCloseAction 档）** | ABORTED（解冻） |
| DRAINING | FREEZING | 等 `spoolHeadSeq==pgSeq`；flush；关空闲连接 | 重试/FAILED 只读 |
| DRAINED | DRAINING | 记 drainedAt；校验 pending=0 | FAILED 只读 |
| EXPORTING | DRAINED | DocCodec canonical 导出+hash+备份 | FAILED 只读 |
| REBUILDING | EXPORTING | fresh doc 重放+新 clientID+snapshot0+建新代 WAL 段目录 | FAILED 只读 |
| SWITCHING | REBUILDING | **单 PG 事务只做 DB 变更**：generation++/**跨代连续 seq——水位保留不重置（T12 落定形态：spoolHeadSeq·pgSeq·walCheckpointSeq 承接〔switchGeneration 计数器+全提交旧段换代即删〕，purgeBelowSeq 清档、currentSnapshotRev 归 0 指针复位）**/插新代 Snapshot(g, rev0)（stateSeq=旧代 maxSeq 承接非归零）/写 stage——**提交成功后**由维护服务 close 4410+切 WAL namespace+解冻（close 失败无害：旧客户端重连被 generation auth 拒；事务内禁 close——网络关闭非事务性〔v5.4⑯〕） | **已提交=只许 roll-forward** |
| VERIFYING | SWITCHING | 从 PG 重载新 doc；hash/SV 对比+smoke | FAILED 只读 |
| COMPLETED | VERIFYING | 解冻开放写+发 feed 事件 | — |

每阶段持久化 stage/status/attempt/leaseOwner/error——重启从 PG 读 stage 继续，不猜本地文件；stage=Prisma enum（非裸 string；**9 主段+2 终态（FAILED/ABORTED）共 11 值——v5.4 措辞修正**）；stage 单源在 MaintenanceOperation（sourceGeneration/targetGeneration/schemaVersion/cutoffPgSeq/drainedAt；活跃维护唯一性=其 partial unique——CanvasDoc 不存 stage 副本，只存 maintenanceId）；REST 控制面 admin guard；维护执行者=租约持有者；空画布保头升代；归档=保留一份 PG dump 回滚。genesis 双路+缺头三态承袭（先 reset 再 migrate）。**`--rebuild-db`/restore 类工具收尾必须 bump historyId（§4.4）**。**单换代入口（v5.4⑯）：T12 vacuumReplace 委托本状态机（只做 rebuild payload）——「无在飞执行」前置与 4410 语义对 vacuum 同样生效；两入口只一个生效**。

### 6.7 删除清单（frozen——P4 收口，删码与新路径同可编译切片）

`CanvasDocProvenance`/区间授权；shadow doc/full clone/candidate-first/ServerDocWrite 服务端写链；admissionEpoch 与 admissionCutoff/`@@unique([maintenanceId])`/DocWriteAudit（v1.2 残留——**审计=CanvasDocUpdate.actorRanges+DocAuditEvent（v5.3）**）；appendSeq 列与 `spoolSeq` 命名（v5.2 统一 walSeq）；preVacuumSv 门与缓存播种（**Y1c T12 已随卡落地**——门/播种/列〔迁移 20261024160000〕全删，世代执法=docName 段 auth/load 双校验〔偏离 27〕；T32 该项=核验零残留）；RetentionCoordinator；`transformV3ToV4Draft` 与在线归档；y-protocols fork 与 FrameApplyReceipt wire 协议；zero-yjs DocLike 双出口；**display-cache 回写链与 `valueSource:'server-feed'`/`authority:'display-cache'` 两键（v5.3 删除——投影 overlay 替代）**；**Y1b 上传点 12s/30s 定向补拉定时器+pendingFacts 冗余轮询路径（T22 同卡删——feed 事件到达→查 facts→processing 4s→30s 退避→terminal 停；`downscaledFrom` 按 (mediaId,factVersion) 恰一次=本地 notifiedFactVersion 持久化）**；**doc 写路径 `pg_advisory_xact_lock` 与全局 `canvas_doc_update_seq`（T10 先 census 全消费面再删——单写者 actor+CanvasDoc 行 CAS 替代）**；doc.exec 读写链+writeExecStatus+deliverArtifact 的 doc 写+`data.fileId/result/status` 写者与 fallback（execAligned/data.status）——**删时点=T32（D9 顺序：T19 只改读者/T22 同切片切交付）**；addToScope 调用与「shift 字节回落」验收；v3 兼容层；无调用方的多管理器协调与过度代际维护机制。**登记不上 Y1c（上线前必修项）：HTTP seed 端点（触发条件：冷启动 SS2 encode/apply p95 实测超标）/对象存储 ExecutionInput bundle/逐帧审计表/ProjectErasure 跨介质擦除状态机（WAL 段+RuntimeEvent+ExecutionInput+IDB+备份 tombstone——项目删除/团队解散场景）。**

## §7 Runtime Feed 平面（v5-9 v5.2——D5 per-project feedSeq）

```prisma
model RuntimeEvent {
  id         String   @id @default(cuid())
  projectId  String
  generation Int
  feedSeq    BigInt   // per-project 连续——同一项目行锁/advisory lock 键族内分配且同事务提交（分配序≡提交序；偏离 30 v5.2）
  kind       String
  payload    Json
  docSeq     BigInt?  // 事件对应的 pgSeq 下界
  createdAt  DateTime @default(now())
  @@unique([projectId, feedSeq])
  @@index([projectId, generation, feedSeq])
}
```

- **feedSeq 分配纪律（v5.3⑫ 定形；v5.4⑭⑮ 补）**：专用计数行 `RuntimeFeedCursor(projectId PK, lastSeq BigInt, minRetainedSeq BigInt)`——写入事务 `INSERT ... ON CONFLICT (projectId) DO UPDATE SET lastSeq=lastSeq+1 RETURNING`（**upsert——空项目首事件 0 行问题修**；genesis 建项目同事务插 cursor 行；行锁持有至提交）锁内分配 feedSeq 并同事务提交——**分配序=提交序，游标推进不会漏未提交事件**；**feedSeq 跨代不重置（generation 仅作过滤）**；**锁序简化（v5.4⑮）：feed 事务只锁业务行→counter（CanvasDoc 用普通 SELECT/FOR SHARE 读 generation/docSeq——不与维护/快照互斥）；负控=静态锁序 lint+正常序压力（N 次无 40P01）+「去 counter」负控（期望重复/缺口）——受控死锁用例标 heavy 不进 PR**；全局有序流不承诺；跨项目无序不影响 per-project 游标。
- **唯一交付=HTTP 游标（v5.3 收口）**：stateless 通知与心跳都**不携带事件体**，只带 `{type:'feed-hint',latestFeedSeq}`；客户端单 reducer：`h<=cursor` 忽略/`h>cursor`→`GET /runtime/events?after=cursor&limit<=200` 按 feedSeq 升序应用+按 (projectId,feedSeq) 去重/返回不连续=缺口→从 cursor 重取/cursor 过期→全量快照——两通道无「到达序」问题（都不交付数据，只有 cursor 有序）。**通知在业务事务提交后发**（事务内发则客户端可能查不到——重试即可，不把「查不到」当缺口）。
- 首连：RR 事务读当前状态+该项目 `max(feedSeq)`→返回 `{snapshot,cursor,minRetainedFeedSeq,historyId}`；**cursor=(historyId,generation,feedSeq) 三元（v5.4⑦——historyId 不匹配→直接全量快照+客户端清投影不做增量；minRetainedFeedSeq 仅同 historyId 内有效）**；续传：`feedSeq>cursor` 升序；**游标<minRetainedFeedSeq 或保留期已过→全量快照；保留期冻结：7 天或 100k 条/项目（先到为准）+清理 worker 更新 minRetainedSeq+`runtime_feed_bytes` 指标**。
- **事件与业务事务原子提交**（执行状态变更与 RuntimeEvent 同一 PG 事务）。
- **Stateless 只通知；心跳 15-30s 携带 latestFeedSeq**（防「连接没断但通知丢了」——仅靠心跳也能追平）。
- **nodeVersion 语义（v5.4⑭ 修正 snapshot 语义错误）**：payload 带 `nodeVersion`=该节点最后一次变更事件的 feedSeq——客户端流序只认 feedSeq、单节点新旧只认 nodeVersion，两者不跨比较；**snapshot=全量替换+统一 cursor（客户端收 snapshot 后清空投影按 snapshot 状态重建，每节点 nodeVersion=snapshot cursor，此后仅接受 nodeVersion>cursor 的增量——「maxFeedSeq≠最后变更」歧义消除）**。**事件 schema（v5.4⑭）**：payload 带 `v:1`；服务端维护 `EVENT_KINDS` 常量 registry 与 upcaster——**exact taxonomy：`exec.status{nodeId,status,attempts,errorCode?,artifactRev?,intentId?,rearmable?,nodeVersion}`（**T22 收口批 I-8 扩键〔2026-10-26 Controller 裁定=词表根修，非静默改冻结词表**：intentId=手势 token/意图身份、rearmable=EXHAUSTED 重试耗尽判据〔客户端面板 entry.rearmable===false 轮换档——修前 writeExecStatus payload 丢键致该档结构性不可达〕；PII 扫描面对两新键零误伤〔intentId/rearmable 不命中禁写键模式〕；shared runtime-event.ts 契约锁+修订行 39 同批落）**/`exec.artifact{nodeId,mediaId?,resultRef?,artifactRev,nodeVersion}`/`media.fact{mediaId,naturalWidth,naturalHeight,downscaledFrom?,factVersion,nodeVersion}`/`node.deleted{nodeId,lifecycleSeq,nodeVersion}`（=FEED_TOMBSTONE）/`doc.vacuumed{generation}`**；客户端未知 kind 忽略+`unknown_event_total` 不崩；**payload≤64KB 超限拒绝写入（业务 bug 非截断；resultText 大文本放 NodeArtifact 事件只带引用）**；事件写入前 PII 扫描（禁 prompt/正文/URL 原文）。
- `docSeq` 应用规则：事件 `docSeq<=` 客户端已同步 pgSeq 才应用，否则 buffer；节点已删则忽略；旧 generation 隔离；**BigInt 一律 String() 传输（§5.2 维持）**。
- UI 契约：feed 未首达=exec `unknown`（生成按钮禁用，**不显示 idle**——防重复点击）；**离线=上次已知投影+stale 角标（IDB 持久化 {projectId,generation,feedSeq,pgSeq,projection,fetchedAt}——TTL 7 天，换代清整族）+执行禁用（fail-closed）；内容编辑不受影响**；重复/乱序/旧代事件过滤+缺口对账。
- **禁用 ExecutionOutbox 当 feed 日志**（可变工作队列——claim/state/delete 使游标出洞）。

## §8 恢复、耐久与安全

### 8.1 4410/4411 语义（v5-14）

4410 三分：`doc-generation-stale`（主动换代——全会话重建）/`doc-vacuuming`（**换代通道**：新 #g+discardLocalCache:true；离线 dirty 草稿先导出 DraftEnvelope 再清）/`server-restored`（**g_client>g_server 或 historyId 不匹配——不清缓存，只读 recovery+草稿导出+管理员裁定；恢复后=bump historyId+旧 WAL/spool 整目录 quarantine+换代一次再开放写，不自动把旧 WAL 灌回 PG**）。**客户端半链（v5.4⑦）**：providerVersion 带 `h=<historyId>`+本地缓存键五元 `(uid,pid,generation,schemaVersion,historyId)`+**onAuthenticate 先比 historyId 再比 generation（堵同代 PITR 恢复的客户端 SS2 复活——g_client==g_server 时旧内容重灌）**+首连无 historyId 由服务端 auth 回执下发并客户端持久化；ETag 拼 `generation:pgSeq`（恢复后无 304 旧内容）。4411=REJECTED/RESYNC（毒帧/apply 失败同走 4411——§4.3）；**4412=resync-required（pending struct 区间拒绝——§3.2/§4.3）**；**4413=maintenance-freeze（Retry-After 可重试——§6.6）**；**4406=client-outdated（protocolVersion+schemaVersion+historyId 硬门——§3.2 v5.4⑧；build hash 仅遥测）**。拒帧恢复（REJECTED/DIVERGED+DraftEnvelope+同代 fresh doc）承袭；DraftEnvelope merge policy=**§4.5 三场景表（B=用户裁定式——冻结，T5c 落类型，T25 实现）**；**重复 DENY 逃生口：客户端 N 次 4411 后切换 recovery 模式（导出→重置→用户裁定导入），禁无限重连循环**。

### 8.2 Yjs≠权限系统

文档准入按身份/项目权限/字段白名单/节点类型/预算；业务权限在 PG 事务内重新核验；客户端 origin 非安全凭证；**clientID=CRDT 结构标识非身份凭证（身份始终由已验证服务端会话提供）**；服务器专有数据不因合法 CRDT update 被覆盖；**projectId=项目/团队/个人统一业务隔离边界**（个人与团队同一套项目级协作模型——差异仅在成员权限/连接数/资源配额）。

### 8.3 双验收线（D10）

本批交付线（dev/test/beta）：单实例+WAL 持久化+PG 批量提交+恢复重放+快照压缩+协作权限+运行时对账（诚实登记：单机不声称 HA；机损 RPO=PG 批延迟；Spooled≠已保存）。生产上线线=T29 **实体化生产硬门**（非占位）：PITR RPO≤5min/RTO≤30min+对象存储版本化 RPO≤15min+季度 restore drill（**v5.3 必含「PITR/pg_dump 恢复后 WAL 不复活」用例——historyId fence 实弹**）+每小时 replay canary（snapshot+updates 重放 fresh doc，semanticEqual/SV 对比，不一致告警并冻结 compact）+HA 决策+SLO+`doc_append_gap_total` 告警——任一未过不得开放生产流量（前置条件纳入发布自动化，非仅 runbook 登记）。

## §9 质量门与验收

### 9.1 六项 go/no-go（**工程门**——v5.3⑬ 起按 **gate-evidence manifest+负控**机器判定；任一失败=对应任务先改再写码）

每门产出 `gate-evidence/<gate>.json`（`{gate,commit,env,cases:[{id,command,status,artifacts}],invariants:[{id,sql,expect}],skipped}`）；CI job `pnpm gate:G2` 执行——任何 `skipped>0`/artifact 缺失/invariant 非 0 即红；**每门至少一个负控（故意破坏被测不变量必须红——负控不红=门无效）**；人只审 manifest 与 artifact，不再「按证据自判」。

| 门 | 必须证明 | 验收时点 | 不通过处理 |
|---|---|---|---|
| G1 真实 schema 与 PG 表形 | 全类型/全 Prisma 关系/迁移/事务约束过验证 | P1 | 修模型重跑，禁绕过迁移校验 |
| G2 WAL 与 PG 连续前缀 | fsync/批次失败/重复帧/重启重放/快照发布与清理/**合法帧 apply 失败/毒帧隔离/pending 拒绝 4412/fsync 失败截断复用 seq**（§4.3 全状态机）全正确 | P1 | 不得进内容迁移 |
| G3 富文本与撤销 | Y.Text/嵌套 XmlFragment/mention/undo-redo 双端并发通过（栈≤100/clear 收口形态） | P2 | 调容器或绑定，禁临时 JSON 垫片 |
| G4 ExecutionRequest 与 docSeq | 受理输入与文档前缀一致；重放不改已冻结输入；受理后改 prompt/拓扑/model/上游/删节点不影响计划 | P3 | 修受理事务与前缀协议 |
| G5 Runtime Feed 可靠性（=G6b） | RuntimeEvent 游标：断线/漏通知（仅心跳追平）/重复/乱序/旧代/游标失效六语料+**feedSeq 提交顺序交错（延迟提交不漏事件）**；feed 不因 outbox claim/delete 出洞 | P3（T22） | 不得移除旧投影写者直至新链路过 |
| G6 单实例故障恢复（=G6a，doc 平面） | kill -9/坏 WAL/PG 不可用/磁盘满/重启符合耐久契约（不含 Feed——Feed 归 G5） | P1（T13） | fail-closed+隔离恢复，禁静默丢弃或越过 pgSeq |

P1 验收主线（真实故障顺序）：同帧重复送达零重复业务效果零重复 walSeq；PG 提交失败 WAL 可恢复且 pgSeq 不越过失败帧；fsync 前后 kill 符合 ACK 等级；PG 提交成功但内存水位未更新即崩溃→重启零重复；snapshot 已发布 WAL 未清理时重启正确；WAL 达清理条件后重启不误删；坏 CRC/截断/缺号/重复 ID 分类隔离告警；**无 PG 行 walSeq>appliedSeq；ETag 不超前 pgSeq**。

### 9.2 CI 测试清单（v5.2 补三）

三面 tsc strict；Prisma validate+迁移重建+真 PG 集成；双客户端同节点/异节点/边/富文本/媒体列表并发；篡改类型/服务器字段/嵌套容器/序号/版本拒绝测试；**VIEWER/冻结/超配额发 Update→doc 不变（readOnly 短路——§3.2⓪）**；**XmlFragment 对抗语料（未知元素/mark/属性/超深/超长/外链 URL/mention 伪造——L1/L2 双层，T16/T24）**；WAL 崩溃点矩阵/重复批次/PG 故障/坏段/水位恢复/毒帧/**pending 区间拒绝 4412（缺前驱/区间有洞/自包含 SS2 放行三态）**/**fsync 写前失败截断复用 seq+ENOSPC/EIO fail-stop 分档**/**恢复段头 historyId 不匹配+lastWriteAt 时间戳栅栏双 quarantine**/**doc 卸载 drain 纪律+maxResidentDocBytes**/**同代 PITR 恢复→客户端 SS2 旧内容被 onAuthenticate historyId 先比拦截**；RuntimeEvent 游标六语料+心跳追平+**feedSeq 分配序=提交序交错**+**空项目首事件（cursor upsert）**+**「去 counter」负控（期望重复/缺口——非制造死锁）**+静态锁序 lint；ExecutionRequest 冻结（受理后变更不影响计划）/worker 抢占/过期迟到写/退款重试/**同 requestId 断线重试幂等+同键不同 body 409+PITR 后 historyId 不匹配 409 REQUEST_STALE**/**资金 per-item 预留/过期 void/部分失败逐 item 结算**；vacuum×append 并发（换代语义）/快照发布×分批清理交错；删除/undo 重建/媒体引用/GC claim 竞态；双浏览器/多标签/IDB blocked/拒帧恢复；**世代切换时旧连接仍在发送+行级关闸（REQUESTED 写 maintenanceId 后新执行被拒——check 后启动执行必拒）+in-flight 含 delivery/outbox drain**；**外部生成成功后 worker 崩溃重试零重复副作用（text 链锚验收）**；**barrier 契约（target=appliedSeq 覆盖本连接帧/clientSeq+sessionEpoch 回显/nonce 幂等/handler 永不 throw/并发 barrier/项目级 flush 节流）**；**pre-apply 契约（广播每连接恰一次含发送者回声 no-op/重复帧零二次广播（含 in-flight 并发同字节帧：一个 walSeq 两 ACK 均在 fsync 后）/SS1 路径零 WAL/onLoadDocument 零 WAL 帧/DirectConnection 业务写=0（allowlist）/awareness 不受影响）**；**clientID 单活跃（双标签伪造同 clientID/僵尸+新连接/同用户异 clientID 并发放行）**；**旧 bundle 4406 版本门（拒而不循环）**；10k 节点+8MiB 混合+10 项目×10 连接分轴压力基准（WAL fsync/批延迟/feed 负载/可见节点 culling/**8MiB×10 出站扇出与事件循环/echo_bytes**）。

### 9.3 观测指标

`wal_fsync_latency`/`wal_pending_bytes`/`doc_pg_lag_seq`/`doc_prefix_gap_total`/`doc_recovery_total`/`doc_frame_rejected_total{reason}`/`runtime_feed_lag`/`runtime_feed_gap_total`/`execution_fence_rejected_total`/`doc_snapshot_bytes`/`doc_compaction_duration`/`doc_append_gap_total`/**v5.3 增：`apply_replay_ms`（库内幂等重放成本）/`doc_pending_reject_total`/`doc_update_origin_total{origin}`（label 限枚举 gate|connection|load|import|maintenance|server-direct——仅 server-direct serving 写告警）/`graph_anomaly_total{kind}`/`collab_broadcast_gap_seconds`/`doc_broadcast_queue_bytes`/`doc_durable_watermark_seq`/`collab_slow_consumer_disconnect_total`；v5.4 增：`echo_bytes`（发送者回声流量）/`wal_fsync_error_total{device}`/`doc_unload_blocked_total`/`unknown_event_total`/`runtime_feed_bytes`/`exec_input_bytes`/`exec_freeze_ms`/`xml_validate_ms`**。按项目或有限维度聚合（禁高基数标签）；日志禁完整 prompt/正文/敏感 URL/整 payload。

### 9.4 性能门禁原则（v5.2 补两分轴；v5.3=硬 block/软 warn 分档）

10k 冷加载测服务端解码/装载/read model/首屏；8MiB 测传输/解码/fsync/apply/PG 批/投影+**apply_replay_ms（库内幂等重放成本）+echo_bytes（发送者回声流量）**；**多项目分轴（WAL fsync 放大/批延迟/feed 负载——S4 基线用 actor 原型管线测，旧 per-frame 管线数据不作拓扑依据〔偏离 38⑳〕）**；**`spoolHeadSeq-pgSeq` 积压规模与持续时间（时段分布非仅瞬时值）**；**慢项目对其他项目的隔离影响（背压验证）**；**8MiB SS2×10 连接出站扇出/事件循环阻塞分轴（OUTBOUND_BUDGET 96MiB 同口径压测）**；可见节点与文档总量分开；全部报 P50/P95/P99+CPU/RSS/磁盘 IO/PG 锁等待；先建基准再把实测转 CI 门禁。**分档语义（v5.4⑲ 修正）**：**硬 block（发布阻断）**=任一正确性/数据丢失不变量失败、**错误率>0（口径=仅 5xx/未处理异常/非预期 1011/数据断言失败——预期 4411/4412/4404/4406/4413 单列不计入；负载测试 5xx<0.1% 且无超时雪崩）**、WAL fsync p95>20ms（10×10）、save barrier p95>2s、10k 冷加载 p95>3s、恢复 RTO>5min、feed lag>30s——**硬门跑固定 runner（PR 只跑 smoke，nightly/release 跑硬门）**；**软 warn**=吞吐/CPU/RSS/磁盘 IO/p99 及 1.0-1.2× 预算带、feed lag 5-30s、**apply_replay_ms/echo_bytes 软预算（超限=触发 fork/patch 评审，非只测不补）**；发布前不得有 TBD 阈值。

## §10 阶段表与任务处置

| 阶段 | 内容 | 出口 |
|---|---|---|
| **P0 契约** | 全类型 schema 矩阵+DocCodec 双出口（**真 Yjs 类型直用——shared 增 yjs 依赖，zero-yjs DocLike 删除**；canonical+read model，无 transform）+两现行 bug（T1 isTextNode 单源；**T2=删 :157 覆盖写+改 execution.service:512 执行读点 string 直读腿——data.prompt:string 每键击持久化保留，无请求参数**，E2E 取消选中/重选）+契约冻结：**水位状态机（D1 v5.2：walSeq 命名）/Hocuspocus apply 归属（v5.3：gate pre-apply+幂等重放——S1 缩减为 pin 4.6.0+契约测试，patch/4.7.x 双版本废止）/ExecutionRequest 父子行+ExecutionInput+frozenDocSeq（v5.3）/RuntimeEvent+per-project feedSeq+RuntimeFeedCursor 行锁+锁序+游标（D5 v5.2+v5.3⑫）/Undo 策略（D6）/shape 矩阵+writer 二元（D8 v5.3）/frameId 批量化+WAL 段头 historyId/WAL 帧协议/ACK 三档+UI 四态+barrier target=appliedSeq+clientSeq/版本维度表（nodeVersion=feedSeq）/4410 三分+4411+4412+4406/DraftEnvelope 三场景表/save barrier/义务 closed enum/协议-构建版本门**（T5 按 **T5a 协议水位/T5b 业务 DDL/T5c 客户端恢复** 三段冻结面落卡——同一确认点①）+census 静态门（含服务端读者） | **用户确认点①**（契约门） |
| **P1 载体** | PG 新表+genesis 双路+文档头/generation；单实例 ADR+spool-first 写管线（**CollabProjectActor 队列+gate pre-apply+pending 区间预检+in-flight 去重**）+**所有权切换（onStoreDocument 旧链拆除——P1 入口条件，偏离 38①）**+applied 前缀批量提交+**walCheckpointSeq 水位**+**barrier 服务端接线（T10）**+快照发布+崩溃恢复（真实故障顺序验收+毒帧+EIO 分档+卸载 drain）；**vacuum=generation++/新 docName（D2——vacuumReplace 委托维护状态机）**；WAL 拓扑（S4 actor 原型基线）；**G6a=doc 平面故障恢复**（Feed 不入本阶段） | G1/G2/G6 过→**用户确认点②** |
| **P2 内容** | 全类型矩阵落地+Y.Text/XmlFragment/Y.Map/媒体数组语义；容器唯一创建者规则先行→Tiptap 双端绑定/mention/粘贴/IME（ySyncPlugin origin 按 T0 spike）+**XML 白名单 L1 同卡激活（T16）**；单 UndoManager 收口形态（**不 addToScope/栈上限 clear**）；全读者切 DocCodec read model（**只改读者——写者保留，ETag=pgSeq；census.json 索引+27 fixture；本阶段至 T22 前=dev-only 中间态不部署 beta〔偏离 38⑳〕**） | G3 过→**用户确认点③** |
| **P3 业务**（v5.4 排序 **T21→T26→T22**——deliverArtifact 的 node-deleted 权威需 NodeLifecycle/DeliveryFence 先行） | ExecutionRequest 受理冻结（**父子行+frozenDocSeq 正确临界区+资金 per-item 预留**+PG 一致前缀读）→**T26 义务观察器（FrameEffects/ProjectDocIndex/FEED_TOMBSTONE）**→PG 权威执行态+**RuntimeEvent Feed 全量（taxonomy+cursor upsert+historyId cursor）+投影 overlay 四读径（Runtime Store——尺寸/facts 单链，删 Y1b 12s/30s 轮询；公开快照 join/导出/BindMedia/clone）**+worker fencing/交付幂等/退款义务（**text 链外呼锚+UNKNOWN 不自动重呼**）；**T22 同切片：deliverArtifact 改 PG 写+客户端切 Runtime Store 投影+doc.exec 停写停读（node-deleted 权威=DeliveryFence）**；收缩 FrameGate（**frame-local DENY+XML L2+clientID 单活跃+版本门硬门三元**）/图异常 NORMALIZE/拒帧恢复（**用户裁定式**三场景）；维护窗口（**行级关闸+事务后 close**+切代前置）+4410 三分+4411/4412/4413/4406+恢复模式 | G4/G5 过→**用户确认点④**（含世代切换首次真跑执行门） |
| **P4 交付** | reset-collab 工具（**阶段状态持久化+historyId bump 步骤**）+部署顺序+**T30b 旧版一次性切换演练（T31 前实弹一次：公告维护→gate freeze→等 walSeq==pgSeq/活跃连接 0→按序停旧消费者〔feed→execution→compact worker〕→DB 快照+对象 manifest 备份→reset-collab --rebuild-db→migrate→seed→新 worker 就绪→新 API /ready+gate-collab→双端 smoke→回滚=停新+恢复快照+起旧版+版本门拒旧缓存；staging 克隆重演记录耗时<RTO）**；多浏览器/并发/断网/kill/磁盘/PG 故障演练（**+恢复段头 historyId quarantine 实弹**）；10k+8MiB+**10 项目×10 连接分轴**负载；**删除清单 T32 执行（D9 顺序）**；发布门禁（**gate-evidence manifest 校验**）+dev/test/beta 限制登记+T29 生产硬门 charter（纳入发布自动化） | **用户确认点⑤=全批终出口**（证据汇编） |

任务处置：**plan v1.7 以本 spec（v5.4）+第十轮裁决（偏离 38）为依据修订**（plan v1.6 主体保留——定点修订+**P3 重排 T21→T26→T22**；v1.6 存档留处置映射）。修订集中在：T0〔S1 验收改写（含发送者回声/DirectConnection allowlist/去重跨重启/origin 枚举）+S4 actor 原型基线+census 补 withDoc 调用点〕/T2〔+resolvePromptText 单函数单测试——认账补落〕/T3〔删 ownership 残留+envelope 派生 NODE_ENVELOPE_KEYS〕/T5〔T5a 补 walCheckpointSeq 拆义/pending 区间/readOnly 短路/XML L1/frameHash/WS 9MiB/版本门三元/b4413；T5b 补 FrameEffects·ProjectDocIndex 契约/requestId 内部 PK/historyId 列/planHash 不可变/资金预留/cursor upsert/minRetainedSeq/SystemHistory 权威；T5c 补 RuntimeProjection 类型 merge 墓碑/用户裁定式三场景/四读径〕/T7〔SystemHistory 权威+删 CanvasDoc.historyId+walCheckpointSeq 改名+actorRanges 单表示〕/T8〔段头+lastWriteAt+帧存 frameHash+EIO fail-stop〕/T9〔CollabProjectActor+所有权切换+in-flight promise map+readOnly 短路+pending 前移+XML L1+入站字节上限〕/T10〔barrier flush 节流+beforeUnloadDocument 正名+maxResidentDocBytes+walCheckpointSeq CAS〕/T13〔EIO/卸载演练〕/T16〔XML L1 同卡激活+PM schema 同源〕/T19〔census.json 索引+dev-only〕/T21〔frozenDocSeq 正确临界区+409+资金预留+brotli〕/T22〔taxonomy+cursor upsert+锁序简化+historyId cursor+四读径+BindMedia〕/T24〔XML L2+clientID 单活跃+frame-local 措辞收窄〕/T25〔用户裁定式+nodeId 不重映射+三行确认面〕/T26〔**前移 T22 前**+复用 T24 索引〕/T27〔行级关闸+事务后 close+T12 委托〕/T29〔synchronous_commit/ProjectErasure/触发条件数字化〕/T30〔本地缓存口径〕/T30b〔一次性硬切+停全部 poller〕/T31/T32/T33〔错误率定义+echo_bytes+固定 runner〕/T34；P1 validator 用 P1 shape fixture，全类型最终矩阵运行时准入在 P3 收缩卡激活。迁移按依赖顺序串行（禁并行依赖同一 schema 状态）。

**门禁映射**：v4 的 G1-G33/B1-B20 由 plan 按新架构重编号——requires 规则（任何 gate 依赖后序任务=评审红）与「每卡先红（真实变红+真 PG 并发）→绿→commit」纪律承袭。**用户确认点①-⑤+T27 执行门维持（第八轮外审建议取消——用户 2026-10-24 驳回）。**
