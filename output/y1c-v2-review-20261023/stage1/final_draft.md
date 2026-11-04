# Y1c v2 生产级架构复审报告

**日期：2026-10-23｜代码：9350dfc1｜对象：2026-10-23-y1c-doc-model-carrier-contract-design.md v2**

## 1. 执行结论

**总体判断：v2 的架构方向可以保留，但仍不宜直接转实施。** 它修正了 v1 的载体、世代、文本与撤销真源错误；当前主要缺口变成了“边界如何落到一个真实提交点”：租约只校验 owner、冻结后 drain 不被允许、拒绝更新后客户端不可逆历史如何清除、原生删除如何持久取消执行、多个 UndoManager 如何共享 keep、投影跨执行与产物版本如何组合，以及对象删除如何阻止新引用。

这些不是再加一层 fallback 就能解决的问题。本报告给出确定方案，不新增待用户裁决项，也不重新提出 exec 整体出 doc 或全量命令系统。

**确定保留：** 同一 Y.Doc 内容协作与服务器专写 exec 投影；PG 业务权威；原生 Yjs 编辑与撤销；纯文本 Y.Text、现有富文本 XmlFragment；四片验收、批末完整 v4 发布。

**确定补齐：** 三维写 fencing、可排空维护状态机、真实校验—apply 原子窗口、拒帧后同代新文档与缓存隔离、原生生命周期与业务取消原子提交、单一 doc.exec 展示源、文档级撤销保留协调、运行态/物化/对象 GC 的持久裁定。

### 1.1 本轮发现与上轮的区别

本轮读取的文件已经是 v2。v1 的“无锁 maxSeq 水位”“identity 二进制迁移”“HTML 入 Y.Text”“exec 内自增”等已修正，不作为本轮新问题重复计数。

`git diff c5fc6982..9350dfc1 --stat` 只显示两份设计文档变化，未显示业务实现变化。故不能把 v2 写下的目标视作现有程序已经保证。本轮代码定位以 9350dfc1 为准，spec 行号以此次读取的 320 行版本为准。

已执行两项纯内存机制探针；未运行 PostgreSQL 集成、浏览器、AI、对象存储或部署验证。PG/退款/GC 交错为基于实际执行顺序的反例，不声称已经发生生产事故。报告新建，未改原 spec、上轮 Word 或业务代码。

### 1.2 产品约束

单人团队与多人团队使用同一 schema、准入、保存、执行与配额协议。一个人的两个标签页仍有两个副本，不能退化为“单用户无并发”。presence 可按不同用户数省开销，正确性不能按人数省。

当前无用户数据，应一次建设正确 v4 并重建开发测试库，不设计旧 schema 兼容、历史数据回填、旧无代 spool 收养或临时双写。对未来有效编辑的保留、故障恢复和权限边界，仍属于目标产品正确性，而非保护当前测试存量。

## 2. 风险总览

P0 表示涉及内容、权限、执行或资金的发布阻断；P1 表示必须在所属能力出口前闭合。以下为设计风险等级，不代表已有正式环境事故。

| 编号 | 等级 | v2 剩余问题 | 最终处理 |
|---|---|---|---|
| R1 | P0 | owner-only 写检查不能区分同进程重获租约 | owner + leaseEpoch + generation 提交时核验 |
| R2 | P0 | QUIESCING 后 append 仅允许 SERVING，drain 无法完成 | 持久冻结边界与专用已受理批次 drain |
| R3 | P0 | 拒帧不能撤回客户端已整合的 CRDT 历史 | 同代 authoritative fresh doc + diverged 缓存隔离 |
| R4 | P0 | 原始更新权限、候选态和实际 apply 的边界不完整 | 固定版本消息生命周期适配与全项目互斥 |
| R5 | P0 | 原生删除没有 PG 取消/退款义务提交点 | 生命周期效果与内容增量同事务落库 |
| R6 | P0 | 整条 exec JSON 覆盖可能回滚独立产物版本 | 当前 PG execution 与每槽位 artifact 组合投影 |
| R7 | P0 | 单代物化 run 迟到退款未被 execSeq 围住 | runId 终态裁定先落 PG，再冲销精确账本 |
| R8 | P0 | 预留超时不等于工作已停止，对象查完再删有竞态 | 预留只终态释放；对象删除 claim 与写/引用互斥 |
| R9 | P0 | 多 UndoManager 清栈会误释放其他管理器 keep | 文档级保留协调，统一 GC 与退出生命周期 |
| R10 | P0 | 新内部 FK 被旧错误分类当“项目删除”而丢批 | 约束级分类，只有确证项目消失才能丢弃 |
| R11 | P1 | doc.exec 与 runtime snapshot 形成双展示源 | 客户端只读 doc.exec，PG 对账在服务器回投 |
| R12 | P1 | 表/初始快照/receipt/schema/发布门仍有定义空洞 | 补全可执行表约束与一致部署状态机 |

## 3. 载体协议：方向正确，仍需五项根修

### 3.1 R1：leaseEpoch 必须下沉到数据库事务

spec :158 仅检查 CollabLease owner。现 `collab-lease.service.ts:46` 的 owner 是进程生命周期常量，:158-163 每次获取又递增 epoch，:80-86 也明确同进程 rejoin 会产生新 epoch。

反例：工作 A 捕获 owner=O、epoch=7，暂停；O 失守后重获 epoch=9；A 恢复时 owner 又等于 O，于是 owner-only 检查放行。generation 没变化也挡不住这个 ABA。

**确定写契约：** 每个在飞 append、compact 发布、维护提交和投影 apply/flush 捕获 `{owner,leaseEpoch,generation}`；短事务 `FOR SHARE` 稳定租约行，再锁头行，验证全部三项。epoch 来自已授权操作的捕获值，禁止到提交前才读取“最新 epoch”替旧操作洗身份。

保留 TTL 仅为接管时延，不把过期时间加回数据正确性门。FOR SHARE 可并行读锁，阻止修改 owner/epoch 的并发写；不要用 KEY SHARE 代替。

spool 的内容世代与“本次写尝试的租约 epoch”是不同维度。新所有者恢复同代可信 spool 时可以建立新写尝试、捕获新租约，保留源批身份并重新核验；不能让旧在飞调用随 mutable 当前 epoch 自动复活，更不能把旧代 payload 改贴新 generation。

### 3.2 R2：冻结必须有允许排空的受理截止点

spec :176-179 先进入 QUIESCING 再 drain，:158 却只允许 lifecycle=SERVING。维护通路“仍运行”不代表 PG 会允许它写。

现 persistence 的正常、重试、drain 都调用同一 append；`raceDeadline` :83-86 只让等待者超时，底层 op 仍继续。队列/spool 数量归零也不证明这些 op 已结束。

**确定状态机：** 在项目串行入口内关闭新受理，记录冻结截止序/可信批次边界，然后进入 QUIESCING。普通新写一律拒绝；只有冻结前已经受理且归属当前 g 的批次，可以持 maintenanceId 经专用 drain 写入。截止点由服务端产生，不能相信客户端时间或裸 seq。

DRAINED 必须同时证明：pending=0、当前代 spool=0、受理在飞=0、真实 append Promise/事务结束、项目写窗口空闲、投影生产者已暂停/移交。超时=未排空，保持封闭；不得因 Promise.race 返回 fallback 就销毁 doc 或发布新代。

维护开始后禁止并行 compact；已有后台计算结果在发布处仍检查 lifecycle/maintenanceId/generation，不能借“允许 appendSeq>N”闯进维护窗口。

### 3.3 初始快照、头行与维护字段补全

spec :153 定义的 CanvasDoc 没有 :176 使用的 maintenanceId，也未写新代 appendSeq=0 对应哪一行真实初始快照。应明确：

- `CanvasDoc`：现字段之外，至少包括 maintenanceId、maintenanceSourceGeneration、maintenanceTargetGeneration、targetSchemaVersion、admissionCutoff、maintenanceStage/错误信息。重复命令只能推进同一 operation，不能二次加 generation。
- 每个新项目/新世代都原子创建 `Snapshot(g,rev=0,stateSeq=0)` 与头指针。初始快照可有种子内容，stateSeq=0 表示还没有后续增量，不表示可见态为空。
- 快照仅关联稳定 CanvasProject 身份；头指针关联精确 `(projectId,generation,snapshotRev)`，禁止快照外键依赖会变化的头 generation。
- 初始化采用数据库延迟检查的复合指针 FK，项目+snapshot0+head 在同一事务完成；保留策略禁止删除当前指针引用行，限制级联路径。
- 缺头不是 null schema：使用 `missing / present / corrupt` 判别结果。已创建项目应有原子种子头，缺头异常不得以 schema=null 或 generation=0 自愈掩盖；真实创建在明确种子入口处理。

### 3.4 空画布不能删头再回到 g0

spec :182 改成可见态空比“零增量”好，但仍以“删行重造”作为普通空画布出口。现 `project.service.ts:100-107` 在头缺失时返回 g0；缓存键含 g。如果项目身份存续，删头后又建 g0 会复用旧历史命名空间。

**确定规则：** 开发环境显式整库 reset 与在线单项目维护完全分开。存续项目即使可见内容为空，也保留头并建立更高 generation；仅新项目身份从 0 开始。项目物理删除由独立生命周期处理，不是维护命令的空内容分支。

不要在当前无用户数据前提下投资 v3→v4 存量迁移器。当前上线 v4 走测试环境重建；保留的是未来同 schema 的类型化重建机器及语义 fixture。以后真有 schema 变化时再提供唯一对应 transformer，不预埋兼容读写。

### 3.5 前缀、CAS 与去重的准确保证

行锁内 appendSeq 分配是正确的。首个可信 snapshot0 加上“每次 successor 都覆盖一个完整提交前缀”形成归纳证明；RR+连续后缀不能反过来证明任意导入快照本来完整，hash 也只证明同一字节没损坏。

compact 在短事务中锁头后先比较 `(g,R,epoch,lifecycle)`，成功才 INSERT R+1。这样两 compact 的正常竞争不会先撞 PK。若还出现 PK 冲突，事务回滚后按不变量异常/幂等重放实查，不得把所有唯一异常折成正常 CAS miss。

updateHash 去重不能作为稳定提交 receipt：compact 删除活增量后，旧 hash 也消失，同内容再回灌会获新 seq。重复 append 对 Yjs 通常无害，但不能声称返回原提交号。**本批采用至少一次增量保存：hash 作完整性/活行重复优化；保存屏障确认完整前缀，不依赖永久 hash 去重。** 需要精确幂等的维护、原子生命周期批次/outbox 用独立 receipt 身份，不因 compact 被删除。

## 4. 原子准入：必须同时证明服务器安全与客户端恢复

### 4.1 R3：拒绝更新后，重同步旧 Y.Doc 不会回滚

本轮纯内存反例：服务器接受 A.parent=B，拒绝离线客户端的 B.parent=A。给该客户端再次 apply 服务器完整状态后，服务器保持 `{A:B,B:null}`，客户端仍是 `{A:B,B:A}`，双方 pending 均为 null。

**因此“close + 草稿 + 重提路径”必须写成操作协议，而不是一句 UX。** 被业务/权限拒绝且本地已整合的更新使该实例进入 REJECTED/DIVERGED：

1. 停止上传与自动重试，把该会话未获持久确认的内容保存到独立草稿；记录 reason、generation、客户端会话/本地 edit watermark。
2. 在 IndexedDB 持久标记缓存 diverged，通知同项目同代标签页；缓存写入/回放以 incarnation/version 为 fence，防旧 tab 重新覆盖“正常缓存”。复用已有 bootRecord.diverged 通路，不再造第二逃生框架。
3. 拆 provider、observers、UndoManager 和 cache writer；在**同一服务器 generation**中创建 authoritative fresh Y.Doc，禁应用被拒绝的 raw snapshot/update。
4. 向用户展示选择的语义差异，基于 fresh 状态重新生成允许的编辑，使用新 struct 身份；未选择的草稿留 detached 区，不自动全量再投。
5. 完成重建或明确放弃后，才切换本地正常缓存 incarnation。

这不是旧版本兼容，也不需要为一个客户端冲突让全体项目换 generation。不能复用现 `canvasCollabRuntime.ts:514-526` provider-only recovery。

### 4.2 R4：候选态必须保留历史，互斥必须跨到 native apply

候选验证采用当前 authoritative doc 的**二进制历史副本**，再 apply 候选帧，不能用维护时的可见态 fresh rebuild，否则原 struct/parent/删除因果不匹配。

4.6.0 `Connection.ts:270-285` 先 await beforeHandleMessage，之后 receiver.apply 的 finally 才调用 afterHandleMessage。MessageReceiver 在 beforeSync 后实际 apply。现 factory :60-62 没接 afterHandleMessage。

**确定接线：** 固定版本 CollabFrameGate 在 beforeSync 获取项目+世代令牌，执行原始权限及候选验证，持锁直到 actual apply/同步 update 事件处理结束；afterHandleMessage 幂等、令牌匹配地释放。beforeSync 抛错也经过 receiver 的 finally；beforeHandleMessage 抛错不经过该 finally，所以在其取得资源后发生失败必须自释放。不要对两种异常边界混用。

服务器 direct/resident 写、维护发布、节点恢复投影同用入口。写回调必须同步，不允许 await 后再持旧 doc 修改；“调用后发现返回 Promise 再 throw”不能回滚此前已写入的 struct。

**afterHandle 的 finally 只证明清理执行，不证明 apply 成功。** 本轮额外核验：`y-protocols/sync.js:82-89` 捕获 Y.applyUpdate 异常，在没有 errorHandler 时仅记录；Hocuspocus MessageReceiver :241-280 未提供该处理器，之后仍发 SyncStatus(true)。因此项目的严格帧接收边界必须具有显式失败结果：接收处提供重抛式错误处理、成功后才发协议 ACK；同步广播在帧受理成功前受控，不能提前向其他副本发布半成品。该依赖边界改动以固定版本源码适配及上游修复留证，不允许运行时 monkeypatch 私有方法或用外层日志假装修复。candidate 验证减少解码失败，但不能保证 live observers 永不抛错。若 PG 已提交而 live apply/observer 失败，隔离并重载的是共享项目文档及全部相关连接，不只是报错客户端；任何持久保存屏障均不得确认失败实例。

### 4.3 二进制权限不是比较最终 JSON

需分开验证：

- 已存在的 struct 区间、与其重叠区间、新尾部；已删除的 DeleteSet 区间、新发生的删除；explicit parent、origin/rightOrigin 推导的父归属。
- 已确认且实际上 no-op 的服务器投影历史重传可放行，但 clientID/clock 不是可信签名。伪造 old ID 不应成为授权新尾部的依据。
- 新受保护根写、父容器替换、隐藏/败选写、仍 live 的受保护 struct 删除均拒绝；不能只检查最终 JSON 是否暂时不变。
- 服务端 GC 后不一定保留原 parent 内容；需要的服务器写入域区间/provenance 与快照同步持久化。无法辨明的 ancestry 不得用“已知 clientID”豁免。exec 用根级不可分割 JSON，可显著减少这项权限历史面。
- 广播只传播 authoritative doc 实际整合产生的有效 update，不裸广播未经语义确认的输入帧。

### 4.4 未解析因果不是合法空操作，也不是自动恶意

U2 在 U1 前到达时，candidate 当前可见态可能没变化，pendingStructs/pendingDs 却留着内容；U1 后到会自动触发这些 pending。若第一帧按“无变化”放行，后续可能激活受保护写或图违规。

**本批不建立复杂因果等待队列。** 候选帧无法完成父域/因果授权时，禁止进入 live doc pending；发送可重试 RESYNC_REQUIRED 并关闭本连接，保留合法未确认编辑，要求完整依赖重同步。限制重试、帧/历史字节和时间，超限明确失败。

此类因果补齐与真正业务拒绝分档：未出现非法内容的 clean 缓存可以提供完整同代状态补依赖；已判业务/权限违规的 diverged 缓存只能走语义 rebase，不可 raw merge。native 接收/保存 ACK 都不得把未授权 pending 算作成功。

### 4.5 唯一创建者规则要允许合法 Undo 重建

Yjs undo 删除节点时会复制内容并生成新的共享类型 Item。禁止替换“仍 live 的 data/text 容器”是正确的；禁止某 nodeId 以后再次创建任何 data 容器，会误杀普通 undo。

**确定规则：** 新建/恢复 node incarnation 可以一次性创建其用户 data/文本容器；live incarnation 的容器不得整体替换。服务端投影不在该子树内，因此恢复不得夹带服务器字段。所有引用/parent 校验仍适用，不能信任客户端声明“这是 undo”。

强不变量与离线并发不是合并闭包：删除节点与另一端新建引用边，或两端相向 reparent，可各自合法而合并违规。服务器整帧拒绝+同代 rebase 的真实演练必须在本批完成；Y5 只扩展离线窗口，不后置基础正确性。

## 5. R5：原生删除必须有业务持久裁定点

spec :206 保留原生 Yjs 编辑，:244 却写“删除结构命令持久 deletion-observed”；:232 又出现补偿语义。这是上轮两种方案残留的拼接，不是已定义接口。

原生删节点、undo 新建、群组批删、父容器删除及离线 DeleteSet 都可能导致删除，单独增加 delete REST 命令不能覆盖。当前 persistence :192-208 的 update 监听只把字节推内存队列。

**最终方案不命令化客户端，而在受理层提取生命周期效果：**

- 在项目窗口内比较 authoritative 前态与候选后态，提取 created/restored/deleted 节点身份、引用增删及必要的可交付状态变化。PG NodeLifecycle/DeliveryFence 只保存版本、存在/删除与业务围栏，不复制完整节点内容为第二真源。
- 对涉及这些效果的整帧，先 flush 它依赖的此前已受理增量；然后在同一 PG 事务 append **整个有效内容增量**、生命周期/引用准入结果、取消与退款义务、同批审计/receipt，再 native apply 到 live doc 并广播。
- PG 失败不 apply、不广播、不 ACK 成功；PG 成功但 live apply 失败则 fence 当前会话，从 PG 重载。commit token 防 update listener 二次排队；receipt 支持整帧重试幂等。
- finalize/交付在事务中核对 NodeLifecycle/DeliveryFence；取消外部任务和实际冲销可异步执行，但义务一旦提交不能消失。
- **删除围栏一旦持久提交即取消该执行段的节点交付。** 恢复节点可以允许新的 execSeq，不解除旧段取消/退款。若并发 finalize 先提交，删除流程依同样锁序登记该已完成段的交付撤销/退款义务，保留证据，不凭某个 poller 的瞬时缺节点决定。
- 新媒体引用也必须事务核验 Media 未进入删除 claim，再与内容 delta 的引用索引同提交；否则 GC 可删除刚 ACK 进 doc 的引用对象。

普通文本/几何叶子帧可保留现批写与 durable marker，不每击键强制跨业务表事务。上述仅把有业务副作用的原生帧变为原子受理，不增加命令总线、补偿撤销或第二内容协议。

PG 事务禁止先持资金/媒体锁再等待项目窗口。统一按“项目受理排程→必要前置 flush→数据库锁→提交→同步 apply”。本批锁序定为：CollabLease SHARE → TeamBalance → StorageAccount → NodeLifecycle/DeliveryFence → GenerationIntent → StorageReservation → CanvasDoc → NodeArtifact 稳定槽位 → Media/ObjectManifest → outbox/receipt。同层多行按稳定主键排序；某路径仅取所需子集，但不能反向取得此前层级。保留既有 TeamBalance→GenerationIntent 方向；claim、finalize、退款、物化、删除、配额、GC 与维护全部按此核对和迁移，不以“局部用了事务”证明无死锁。该次序为本轮确定目标，尚未在代码实施或经数据库交错验收。

## 6. exec：保留同 doc，但消除双展示源和复合版本回退

### 6.1 R11：删除客户端 runtime snapshot/catch-up 方案

spec :243 在保留 doc.exec 后仍写 runtime snapshot、runtimeRevision 和客户端订阅追赶，这是上轮 exec 出 doc 方案的残留。现 execStatusView :34-52 已有 doc.exec、execAligned、data.status 三源回落，不能继续增加第四源。

**最终展示唯一源：doc.exec。** 冷装载在首轮权威 Sync 前，将 PG 当前运行态对账回 doc；重连、恢复节点、换代后同样由服务器重投影。客户端不合并另一份运行态快照；stateless 只作可丢 wake-up/progress，不承担状态真实性。

现 execAligned 与 data.status fallback 随读者迁移删除。公开快照读取同一合成投影，媒体事实可继续保留既有独立事实通道，但不能另行争夺 exec status 真源。

### 6.2 R6：三计数必须有确定的组合规则

反例：旧任务 `(execSeq=20,eventVersion=2)` 完成，用户已把槽位 rev=8 clear。若从旧事件整条覆盖 JSON，会复活已清产物；反过来新任务 loading 若只输出本次 artifact，会吞掉仍被选择的上一产物。

采用一个原子 JSON 值，但内部责任分开：

- `execution={intentId,execSeq,eventVersion,status,error,deliveryState,...}`；按数值 `(execSeq,eventVersion)` 排序。
- `artifacts[stableSlot]={artifactRevision,mediaId/resultText,state,sourceExecSeq,...}`；每槽位独立按 PG rev 选择，空值/clear 也具有版本。
- 用户 content 与 generated result 不合并：TextInputNode 的 XmlFragment 是用户编辑，生成文本 result 是 PG 产物；用户素材选择另有显式作者态键。

单一 dispatcher 把事件作为“需刷新当前态”的可靠通知，读取同一 PG 快照里的当前 execution 与全部当前槽位；提交投影 delta 时锁/CAS 核对 GI 代际、eventVersion、每槽位 rev、节点围栏、doc g/epoch、outbox runId。读取时 RR 一致不等于之后提交仍有效，commit-time fence 必须存在。

运行态事件版本需在 PG 真正持久化，状态更新与 version++/outbox 同事务；BigInt wire decimal string，比较先解析 BigInt，禁止字典序，例如 "10" 小于 "9"。

投影可读到新 PG 修订前存在有界传播 lag，但旧任务不得重新覆盖已经发布到 doc 的较新 execution/slot。更高完整投影版本仅控制整条 doc 值的发布顺序，不替代各业务维度的真源。

### 6.3 all-state outbox 的实际 schema

现 ArtifactProjection :1184-1205 具有必选 artifactId/artifactRev 和 artifact-only 唯一键；loading 或产物出现前 error 无合法对应 artifact。这里不是当前 FK 报错：现 schema 并未声明该 FK，问题在数据形状及 dispatcher 的假设。

**演进同一 outbox，不并行造队列：** 新增事件类别、eventId、intentRowId/execSeq/eventVersion、可选 artifactId/rev、可选生命周期围栏身份、claim runId/state、投影 generation/receipt。artifact 事件保留自身唯一性；运行态事件以业务身份唯一。状态转移历史在 PG 留证；dispatcher 可按节点合并刷新当前态，不必保证用户看见每个瞬时 loading。

若采用 coalescing pending 行，mark/清 pending 必须条件匹配捕获版本；新事件在投递中到达时不能被旧 mark 清掉。消费幂等不等于投影存在：同一业务版本仍可修复缺失/错误 doc.exec。

### 6.4 换代与节点恢复后的投影必须重建

lease epoch 没变也可以切 doc generation，现 poller :323,363-390 主要检查 epoch/rev/runId，没有文档代际。每次投影尝试固定当前 g，flush 返回 `{g,committedSeq}`，mark 条件验证该 g 与 runId/状态；代变返回 pending，不消耗失败次数。

换代重建优先复制用户可见内容，exec 从当前 PG 派生再验证，不把旧 exec 当业务真源复制。旧世代事件已经 marked projected 也不免除新代对账；cold load 和 restoration 需要主动刷新所有相关条目，不能仅选 legacy loading 且 exec 缺失的节点。

恢复后已退款显示已取消需重新生成；在飞未取消显示真实运行态；已完成且交付仍合法显示当前槽位。读侧先检查 node 存在，后取 exec，始终不以孤儿 exec 独立存在为真。

## 7. R9：bounded undo 还缺文档级保留协调

本轮固定 Yjs 13.6.32 内存探针：两个 UndoManager 同时保留一次删除；清除其中一个后，另一个仍有一项 undo；执行 tryGc，再调用另一个 undo，文本恢复结果为空。

原因是 keep 是布尔，不是“几个 UndoManager 正在引用”的计数。引入 Tiptap Collaboration 后，单独对画布管理器的剩余栈取交集不足以保证其他历史。

**确定落地：** 文档级 RetentionCoordinator 统一登记画布/每个编辑器管理器的 undo、redo、当前 popped item、redone 与祖先依赖，协调清栈/redo 自动清空/编辑器关闭/项目退出；GC 前重新建立所有有效管理器保护并集，仅退休集合解除 keep。

Yjs 与协作 binding 都固定版本，释放与 tryGc 只在非重入窗口执行。各入口不能直接 `um.clear()/destroy()` 后自行 GC，必须交协调器；未注册的新管理器不能自动启用回收。祖先保护是闭包，不是仅同 clock 区间相减。

**还必须覆盖 Yjs 自己的自动 GC，不只是显式 tryGc。** UndoManager 在 afterTransaction 自动 clear redo；Transaction :320-325 随后进入自动回收。保护并集必须在原生栈变更后、自动 GC 前同步更新；文档 gcFilter 与显式 tryGc 使用同一保护判定，任何仍被其他 manager/祖先闭包引用的 Item 一律不可回收。保护索引失效且无法同步证明时 fail-closed 保留，而不是先释放后等下一 idle 重新保护。仅对已 keep=true 子项调用 keepItem(true) 不会自动修复已经 keep=false 的祖先，适配器要显式建立祖先闭包。

100 项/4MiB 明确为单管理器上界；文档总保留预算另设 16MiB 起步，按目标服务器/浏览器压力验证。跨管理器同 struct 去重计费，不把一次全量 encode 字节当 retained payload 的精确计量。预算超限按明确历史过期策略退休最旧记录，不能隐式清所有历史。

原生 Yjs undo 依赖删除内容留存，不是“补偿语义保存前值”。删除 spec :232 对补偿撤销的残留表述；验收证明未过期历史可恢复、退休负载可回收，tombstone metadata 另计。文本焦点内的快捷键归属正确，但快捷键不冲突并不等于内存保护不冲突。

## 8. 物化、配额和对象删除：必须先持久裁定再执行副作用

### 8.1 R7：execSeq 不足以保护同代物化迟到退款

当前 materialize-job.service :438-482：先读 Media.processingLeaseUntil 判归属，随后调用退款，最后另一事务 CAS 标 failed。旧 run 读通过后，新 run 接管并完成，旧 run 仍可能退款；后续 Media CAS 失败无法撤销已退款账本。

**最终机制：** claim 为每次物化创建明确 materializeRunId/epoch，leaseUntil 只控制接管时间。终态失败事务同时校验 runId、status、execSeq、产物身份，持久写失败裁定与精确 RefundObligation。只有裁定赢者可以安排冲销；完成事务用相同 run fence 和终态互斥条件。退款异步重试引用 exact settle row，幂等 reversesId，失败不能漏义务。

不在 CAS 终态前先退款；不把 expectedExecSeq、lease 时间前置 SELECT 或后置 mark 当成 side effect 的原子授权。

### 8.2 R8：reservation 超时只转移工作，不自动释放在飞额度

reservedBytes 是所有有效 reservation 的计量和。预留必须拥有唯一 operation 身份、team/execSeq、服务端冻结的上界与可恢复工作状态。

仅 lease 超时不能释放：provider 可能已提交、视频已付费但在物化、提交结果 UNKNOWN。把容量让给新任务会形成 oversale。应转移处理责任；只有持久 NO_SUBMIT、CANCELED/FAILED 等终态围栏赢得后，才能按条件 release；已付费终态失败先有退款义务。

将 reservation.upperBoundBytes 作为此次下载、原对象及约定派生对象的明确 cap，传入 safe fetch/materialize；现 SafeRemoteFetch 使用全局 maxBytes，不会自动等于单任务预留。超 cap 在付款前拒/扩额；若在付款后发现真实超 cap，持久失败与精确退款，不直接删除用户已付产物并只抛 quota 错。

套餐降级不立即压缩已取得的 reservation；新预留按新限制，现有承诺按被冻结的 entitlement 完成。字节计量 BigInt、重复 confirm 完成态零副作用、reconcile 不重复释放。

### 8.3 对象 GC 必须占住删除权，而不是查完直接删

现 media-gc.service :153-194 先扫 doc/PG 引用，随后调用 MinIO delete，两者间允许新引用/finalize。读前与删前各一次 SELECT 仍不能形成原子排他。

对象 manifest 按不可变 key/version 管状态 staged/committed/delete-claimed/deleted，关联有效上传/物化 lease。GC 在 PG 条件事务中 claim 删除并证明无有效引用/工作；所有引用创建、finalize、重试 put 都必须核验并尊重 delete claim。

已有在飞 PUT 不会因数据库 tombstone 自动消失。删除前取消/排空它们，或以对象版本/唯一写身份 fence，并保留晚到上传的补偿 GC；确认不存在活动写后再外部删除，最后标记完成。开启对象版本时删除精确版本，不能误删后来同 key 新物体。

原生引用帧在生命周期效果提交点写 PG 引用准入，不能只靠后台扫描；用户离线恢复一个已经删除的素材引用，应业务拒绝并提示重新选择，不宣称离线引用免于授权。

G31 “零孤儿”改为：**零重复已提交 Media、零永久未登记对象、临时 orphan 有界回收、零活引用对象误删。** 数据库与对象存储不是同一个事务，不承诺瞬时跨存储 exactly-once。

## 9. R10 与发布链：新增表可能撞上旧“安全丢弃”逻辑

`pg-error.util.ts:4-6` 把任何 P2003/23503 认作项目已删除。persistence :356-365 命中后 splice 队列并终态丢批。新增 snapshot 指针、lifecycle、reservation/receipt 等内部 FK 后，内部约束错误也可能被误当项目不存在，永久丢数据。

**最终错误模型：** 识别具体 constraint/table，只有明确项目 FK 缺失且数据库确认 CanvasProject 不存在才终态丢弃；内部 FK、快照悬空、世代错误、缺 maintenance 行均 fail-closed、保留批并告警。错误码与内容/维护/outbox 结果共享判别类型，禁一个 broad FK catch 吞所有问题。

当前 deploy.sh :134-159 在旧 api/worker 仍可能访问数据库时 rebuild/migrate，再重启；注释明确 additive 承担原安全性。v4 删列和全库重建不能只是豁免 additive guard。

**测试环境破坏性发布流程：** 外层维护关闭 HTTP/WS 写与任务受理→严格 drain→停止所有旧 api/worker/daemon 数据库消费者→执行明确 allowlist 的测试 DB reset/schema deploy→部署新 api/web→api 种子/准入/投影就绪检查→启动 worker→最后开放写。外层维护不能只依赖即将 DROP 的 PG lifecycle。

现 gate-decision.mjs :20-21 只检查 own 四零并允许 stranded 警告；v4 删除前门还必须统计实际在飞、全部可恢复段及后台事务，无法观测=阻断。未来正式环境恢复用非 reset 专用流程，与当前测试 reset 分离。

## 10. schema、manifest、预算与范围的剩余纠偏

### 10.1 版本通道按真实实现

spec :25 仍写版本协商走 providerVersion；现 shared collab-protocol :5-6 明确 Hocuspocus 4.6.0 providerVersion 是库版本、与应用协议无关。继续使用已有 shared `csv=CLIENT_PROTOCOL_VERSION` 的精确比较，不尝试篡改 providerVersion 或加平行协商。

spec :172 用 docStatus 下行 schemaVersion 在 apply 前拒绝，但现 buildDocStatus :938-956 根本没有该字段；更重要的是异步 stateless 通告不能证明先于 SyncStep2。

客户端 cache/doc/provider 前验证元数据；服务器 Auth+load 前再次版本/世代验证，是主屏障。若需要客户端首个 update 前断言，必须在有序首次水合路径携带确认，不把迟到 doc-status 当安全屏障；doc-status schema 信息仅观测/失效提示。

### 10.2 manifest 创建面与行为面同步

manifest 不预建没有消费方的 meta/threads/时间轴空根。字段、type、creator、permission、Undo 归属、导入/导出、引用扫描与 PG 投影关系逐项消费；先冻结规则，相关域入口当片就执法，不能到 -3 才首次发现 -2a 写错类型。

媒体引用 collector 现主要扫 nodes.data（media-refs.ts:70-89）。读者迁移不只 UI，还包括 binding、事实订阅、GC、复制/导出/公开快照、执行输入。移动 fileId/result 后这些索引不改，PG 产物可能被误判无人引用。

时间轴真实迁移按消费者完成，无双写；复杂高级功能留原唯一源、不建空新根。几何预算与既有保护保留，本轮不顺带推翻。

### 10.3 容量口径不能只用节点数

10,000 节点与 8MiB doc 是两条同时约束，测试不能默认“1KB×10,000”仍在 8MiB 内。需至少两种负载：10,000 个短节点测试结构开销；8MiB 文本/XML/混合素材测试字节上限；另有 10 用户/同人多标签的真实并发编辑。

candidate 历史拷贝/原始权限解析不应每击键全 doc encode。固定上限、结构分域索引与实际受影响集合增量验证，完整校验仅冷启/维护/定期自检；candidate 的临时历史实例或 worker 任务是明确安全基础设施，不是 live doc 回滚垫片。不能仅用 async 函数包 CPU 重放就声称不占 WS 事件循环，应 worker thread/任务隔离并限制 RSS。

基础 compact 触发与 bloat 观测保留；SLO 拟定值全部标为预算，真实输入 admission/全文 clone/PG flush/投影合成分阶段计时。达不到就降低准入上限或优化影响域，不准为达标放开权限。

## 11. 四片执行方案与依赖

**-1：先实现承重 seam。** owner/epoch/g fencing，完整头与 snapshot0/指针约束，判别读与错误分类，维护 drain 授权，FrameGate 验证—apply生命周期，拒帧/因果补齐的恢复协议，保存屏障，后台 compact；manifest 正式冻结。节点生命周期/引用效果的受理接口与持久 receipt 在此明确，避免 -2b 另造删除 endpoint。

**-2a：完善内容与保留。** Y.Text/XmlFragment 与固定绑定，合法 restore incarnation，全部类型序列化，文档级 Undo retain 协调、精确 GC、结构/字节上限与 typed draft rebase。撤销继续 native，不增加补偿命令系统。

**-2b：运行态闭环。** 单一 doc.exec 展示，PG eventVersion 与独立 artifact slots，演进同 outbox；节点 lifecycle+cancel/refund 义务原子提交、物化 run fence、generation-aware projection receipt、cold/restore/rebuild 服务器对账；删除 execAligned/runtime snapshot 双写回落。

**-3：资源与引用闭环。** 全消费者改投影、旧字段一次删除，PG 原子媒体引用准入/GC删除claim，reservation cap 与真实状态机、完整队列 profile、审计和容量门禁。

片间接口要有可执行契约测试；中间 master 版本不部署，最终 csv4/schema4 完整单元一次测试环境发布。无需 v3 数据回填与兼容，也无需为了报告行数短把缺接口留作“plan期观察项”。

## 12. 本轮新增必须先红后绿的验收

以下 B1-B20 在既有 G1-G33 基础上补充，不另造新的批次流程：

1. **B1 租约 ABA：** 同 owner 的 epoch7 操作，在重获 epoch9 后提交，所有 append/compact/维护/投影均拒。
2. **B2 drain 特权：** QUIESCING 后正常新写拒，截止点前 trusted pending/spool 可以落 PG；超时底层还在跑时不得宣称 DRAINED。
3. **B3 genesis/空画布：** 新头指向真实 snapshot0；存续空项目维护后 g 单调增加；缺头/空schema/悬空pointer分档。
4. **B4 FK误分类：** 注入内部 snapshot/lifecycle FK 错，pending/spool保留；真实项目删除才终态丢弃。
5. **B5 原子 FrameGate：** 两连接 A.check/B.check/A.apply/B.apply 反例被串行化；beforeSync/beforeHandle失败及afterhook异常均不漏锁；live observer 故意抛错时不能被底层吞成成功 ACK，广播/保存均不确认半成品，共享项目可从 PG 重载。
6. **B6 离线图冲突：** 相向 reparent/删节点与新引用冲突被拒后，fresh同代实例能收敛；重复 apply服务器态到旧doc的错误方案先红。
7. **B7 多标签缓存：** diverged持久标记、旧tab迟到写、重启读取、IDB blocked情况下拒绝历史不回到正常cache。
8. **B8 pending因果：** U2先到、U1后到及delete-only未知target，未授权pending不入live且不获ACK；补齐与业务拒绝分档。
9. **B9 权限历史：** overlap/newtail、伪造origin指向exec、已删DS重传/live保护对象新删、GC祖先缺失全部验证；正常server投影重传不误拒。
10. **B10 原生恢复：** node删除再undo重新创建data/text容器合法；替换live容器拒绝；恢复不可夹带server字段。
11. **B11 删除提交点：** accepted DeleteSet→kill、删后马上undo、group delete及undo创建，内容与业务围栏均不漏；已承诺退款不被恢复撤销。
12. **B12 并发finalize：** 删除与finalize两种先后，钱和交付裁定由事务赢者确定，没有poller盲区。
13. **B13 投影多维：** 新loading保留合法旧槽位；旧done不回滚较新clear；数值10/9不按字符串排序。
14. **B14 outbox形状：** 无artifact的loading/error可可靠落事件；并发新版本与旧mark不丢唤醒。
15. **B15 换代重投影：** lease不变g变化、旧projected事件、新代冷开/恢复缺exec仍按PG修复，不被dedup屏蔽。
16. **B16 多UndoManager：** 清一个/关闭编辑器/自动redo清栈后，其他有效历史仍恢复；tryGc不能破坏active/popped祖先。
17. **B17 物化run接管：** 旧run读通过后新run完成，旧run不得退款；终态失败裁定与refund义务同事务，退款失败可重扫。
18. **B18 预留状态：** lease过期但provider/materializing/UNKNOWN在飞不释放；cap实际执行；付款后超cap有持久退款义务；套餐降级不毁既有承诺。
19. **B19 GC并发：** 新引用/在飞PUT/晚到finalize与DELETE交错不误删；临时orphan有记录且有界回收。
20. **B20 发布实弹：** 所有旧DB消费者停止后测试reset；own队列零但inflight/stranded非零时拒发布；分别跑10k短节点与8MiB真实混合内容负载。

所有用例保留反面、正面、版本、环境与故障点证据；纯内存探针不替代PG/浏览器/对象真实集成。kill后30秒终态锚以PG已成功且可交付为前置，materializing不假done。

## 13. 给 spec v3 的最终替换要点

- :158 append 检查改 owner+captured leaseEpoch+expectedGeneration；维护 drain按截止前可信批授权，禁止 mutable 最新epoch洗旧操作。
- :153-156 补 maintenance字段、真实snapshot0、稳定project外键与头复合指针，判别missing/present/corrupt；修 broad FK丢批。
- :176-185 改在线空画布保头换更高g；当前开发v4 reset独立；补真实在飞排空证明与外层部署维护。
- :195-206 补 FrameGate acquire/release机制、historycandidate、原始权限provenance、因果RESYNC分档、同代freshdoc与diverged缓存rebase；本批就验离线拒绝基础行为。
- :232 删除补偿撤销残留；补文档级多管理器保留协调及binding版本锁。
- :243 删除客户端runtime snapshot/runtimeRevision追赶和execAligned第二状态源；改服务器PG当前态对账回doc与完整投影版本。
- :239-244 补execution/artifact槽位独立排序、PG eventVersion、typed同outbox；原生帧生命周期与业务围栏同事务，不改客户端command架构。
- :251 补materializeRunId终态裁定、reservation状态而非超时释放、对象deleteclaim/活写排空/引用准入；G31改有界orphan目标。
- :25/:172 修providerVersion应用协商旧说法与doc-status先于update的假设；保留真实csv通道和元数据/服务器装载主门。
- 33项原门保留，新增B1-B20并入相应片；“表格压缩到330行”不作为承重契约完整性的证据。

**最终推荐：保留 v2 的六项架构方向，重写上述实际提交、授权与恢复边界，然后实施。** 根修不是把所有能力搬出Yjs，也不是每个动作都命令化，而是让CRDT收敛、PG耐久、业务围栏和不可逆副作用分别拥有唯一且可验证的责任点。

## 附录 A. 本轮关键代码证据

以下为仓库相对路径，line对应9350dfc1；升级后应以符号定位。

- `apps/api/src/modules/collab/collab-lease.service.ts:46,80-86,158-163`：同owner生命周期、重获epoch、获取语句。
- `apps/api/src/modules/collab/collab-persistence.service.ts:83-86,192-208,319-364`：超时底层继续、仅排队字节、broad FK丢批。
- `apps/api/src/modules/collab/pg-error.util.ts:4-6`：所有FK错误认项目删除。
- `apps/api/src/modules/project/project.service.ts:45-79,100-107`：原子种子与缺头g0回落。
- `apps/api/node_modules/@hocuspocus/server/src/Connection.ts:270-285`：beforeHandle与apply/afterHandle的真实finally范围；`MessageReceiver.ts:241-280`、`apps/api/node_modules/y-protocols/sync.js:82-89`：底层apply错误可被吞下并继续成功ACK。
- `apps/api/src/modules/collab/collab-server.factory.ts:60-62`：原有beforehooks，无afterHandle接线。
- `apps/api/src/modules/collab/collab-doc-writer.service.ts:76-79`：调用后才识别Promise，不是回滚。
- `apps/api/node_modules/yjs/src/utils/encoding.js:395-447`：pendingStructs/pendingDs后续激活。
- `apps/web/src/stores/canvasCollabRuntime.ts:514-526,1744-1773`：provider-only与已有diverged缓存通路。
- `apps/api/node_modules/yjs/src/utils/UndoManager.js:40-44,304-315`：clear解除keep，不跨管理器计数。
- `apps/api/prisma/schema.prisma:1079-1087,1158-1205`：已有execSeq/槽位/outbox，无eventVersion完整契约。
- `apps/api/src/modules/media-delivery/projection-outbox.poller.ts:323,363-396`：flush/recheck/mark，runId与g边界需扩。
- `apps/web/src/stores/execStatusView.ts:34-52`：多源运行态回落。
- `packages/shared/src/canvas/media-refs.ts:70-89`：nodes.data引用扫描。
- `apps/api/src/modules/artifact-core/materialize-job.service.ts:175-195,438-482`：时间lease claim、退款前读归属与退款后终态CAS。
- `apps/api/src/modules/media/safe-remote-fetch.service.ts:91-94,127-161`：全局cap，与单reservation独立。
- `apps/api/src/modules/media-delivery/media-gc.service.ts:153-194`：扫描与外部DELETE的时间窗。
- `apps/api/src/modules/collab/collab-doc-registry.service.ts:938-956`：doc-status无schemaVersion。
- `packages/shared/src/constants/collab-protocol.ts:5-6,11-27`：providerVersion不是应用csv，精确版本门。
- `deploy.sh:134-159`、`scripts/lib/gate-decision.mjs:15-22`：旧进程访问窗口、own四零与stranded警告。

## 附录 B. 官方机制与适用边界

查阅日期：2026-10-23。

1. Yjs Document Updates：https://docs.yjs.dev/api/document-updates 。更新可交换、结合、幂等；同步state/diff是合并，不是服务端覆盖式回滚；纯可见态与历史身份分开。
2. Yjs UndoManager：https://docs.yjs.dev/api/undo-manager 。scope覆盖子类型，trackedOrigins决定捕获，UndoManager自身也被追踪；多管理器keep反例以固定13.6.32源码和本轮探针确认。
3. Hocuspocus Hooks：https://tiptap.dev/docs/hocuspocus/server/hooks 。公开生命周期职责可参考，beforeSync异步/afterfinally/Auth close具体行为以项目4.6.0安装源码为准，在线最新版不能替代版本钉死契约。
4. PostgreSQL Explicit Locking：https://www.postgresql.org/docs/current/explicit-locking.html 。FOR SHARE阻止行写但兼容共享读，KEY SHARE不阻止普通非键列UPDATE；锁持续至事务结束，不等于长期lease。
5. BullMQ Job IDs：https://docs.bullmq.io/guide/jobs/job-ids 。jobId仅队列内去重，移除后可重新加入；不可替代PG业务幂等。

不存在“一种主流方案自动替你解决所有CRDT业务约束”。本项目应依固定版本、可构造反例和真实发布门证明协议，而不是以“闭合裁定”或工具库名称替代工程证据。
