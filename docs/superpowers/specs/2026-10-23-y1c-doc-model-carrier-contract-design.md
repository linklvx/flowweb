<!-- doc-status: active -->
# Y1c：doc 模型 v3·载体与契约（B 类合并批设计——-1 载体 / -2a 内容模型 / -2b exec 契约 / -3 门禁预算）

- **立项**：2026-10-23，用户指令「Y1a+Y1b 完成，继续下一个任务」。按目录 §0.2 顺序节 B 类分组「**Y1c 全批（-1+-2a+-2b+-3）**」默认合并立项（:159）；合并与否由用户在启动时最终决定——本 spec v1 即按合并全批起草，若用户裁定缩为单片（如仅 -1）只需砍 §3-§5 与 §6/§7 对应行，其余不动。
- **唯一上游依据**：[2026-10-06-canvas-yjs-arch-upgrade-review.md](2026-10-06-canvas-yjs-arch-upgrade-review.md)（master v8.3）§0.2 Y1c 行（:145）+启动方式/执行门机制（:154-164）+§0.1 裁决（本 spec §0.1 逐条内联）；Y0c spec 世代契约冻结（[2026-10-13-y0c-y05-runtime-plane-design.md](2026-10-13-y0c-y05-runtime-plane-design.md) R0c-4/E68 形态/Z32/偏离 67）直采；Y1a/Y1b spec §0.2-④/§6 移交行（[2026-10-18-y1a-y1b-doc-model-order-size-design.md](2026-10-18-y1a-y1b-doc-model-order-size-design.md) v14.3）承接。
- **硬前置**（Y1c 行）：Y0a+Y0.5 迁移链——已满足（Y0a 完结 2026-10-08、迁移进部署链已核销）。
- **门槛重申**（E39，不因合并变化）：上线门槛=0 号+Y0a+Y0b+Y0.5+Y1a+Y1b+（**Y1c-2 三项 exec v2/E26/Y.Text 随上线批强制**）；Y1c-1/-3 收益为维护成本与模型完备性，上线后按序亦不违反门槛。

**修订链**：v1（2026-10-23）——首版合稿：三路一手核验（路线图裁决全文提取/载体域代码勘察/Y1a-Y1b 先例与移交链）+四片范围锚定+裁定项 Z1-Z8 呈用户。未外审。

---

## 0.1 本批有效裁决（master 内联——E30 纪律：spec 自包含，不跨文档追踪修订链）

### 0.1a 载体系（Y1c-1 域）

| 编号 | 裁决（原文） | 效力 |
|---|---|---|
| E3 | 修订 C7②/C9：世代通道前移——generation 必须走**合并前可见**载体=docName 编码 `project:<id>#g<N>`（服务端按 DB 列校验）或鉴权握手返回；客户端建 provider/Y.Doc 前丢弃本地缓存（实验 D：老世代 update 并入新 doc 无异常无 pendingStructs=静默投毒——doc 内 meta 是事后通道）；CanvasDoc 加 **generation+revision 双列**（revision=append 返回 seq 同事务 GREATEST(revision,seq) 单调水位，通用读路径 fail-closed 等待——PG 既有 seq 的暴露非新协议，tx-watermark 否决不翻案；资金路径主屏障=E1 plan，revision 降辅助）；y-indexeddb DB 名由 docName 派生→世代自然隔离，Y5 代不符清库简化。docName 通道 Y1c 落地 | §2.2/§2.3 |
| E23 | 修订 E3/E4/E9：拓扑前移+世代连带——**docName 世代 6 处连带**：parseProjectId 解析收口 parseDocName→{projectId,generation}/closeTeamDocuments 全世代/withDoc 用当前世代名+随 generation 缓存/客户端建 provider 前 REST 取 g/unflushed 键=(projectId,generation)（否则 stash 回灌新 doc=静默投毒）/gate·e2e 装置世代感知；onAuthenticate∧onLoadDocument 双校验+独立 reason；断言任一时刻单世代可加载。**最小世代重建前移 Y1c**（手工触发命令：导出可见态→新 generation→断连→清增量→强刷；Y6 只做自动化/K 份/COS）；**compact 守卫连续 3 败→世代重建出口**（防 fail-stuck：永久 pending→永不 compact→增量无界增长；出口=Y6 同一台机器，登记为指定降级路径）；公开快照缓存键拼 generation（世代 bump 主动失效） | §2.3/§2.4/§2.5（「REST 取 g」→Z2 裁定） |
| E39 | 修订批次结构（拆片定义+内存表清理）——**Y1c-1 载体**（SCHEMA_VERSION=3+generation/revision+stateSeq+docName 世代通道+排空 runbook 补两步：**排空 pending+spool 落 PG** 与 **归档旧世代快照**——CanvasDoc 是 projectId 单行主键，新世代写快照=覆盖唯一副本=**单向门，第一次世代切换必须与旧世代归档同批**[CanvasDocSnapshot 表 K=1 即可]/世代重建命令[与归档同机]）；……内存表（docEpoch/lastCompactAt/persistUnhealthy/persistRetry/unflushed）世代 bump 时按 (projectId,generation) 精确清理（按 projectId 清会误清活跃世代）；docName `#g<N>` 协议安全已验证（文档名走协议 routing key 不进 URL——provider 只把 url 交给 WebSocket 构造） | §2.2/§2.4/§2.5 |
| E60 | 版本协商走 providerVersion（如 `4.6.0+canvasSchema=3`）；缺字段/不可解析=拒连（独立 reason）；**docName#g<N> 只管世代；无需另造 REST/query 通道** | §2.1/§2.3（Z2 依据） |
| E61 | 修订 E31/E39：**世代切换=唯一 doc 迁移载体**——Y1c-2 的存量结构变换协议写死：停写→drain（pending+spool 落 PG）→导出可见态→**纯函数变换 v2→v3**（fixture 逐位比对）→写新 generation 快照→归档旧世代→bump 世代→客户端代不符清缓存硬刷。读写路径**禁任何「看版本分支」兼容代码**。线上 CanvasDoc 空=删行（reset-canvas-schema.mjs 先例），非空才走迁移命令——二者互斥判据写死；**E31「v2→v3 一次性迁移脚本」整项删除**（被本条取代）。schemaVersion 门收敛两档（匹配/拒；无戳自愈限服务端种子路径——「无戳=可疑」中间态消失） | §2.4（协议机器落 -1；真变换=Y1c-2a §3） |
| E62 | 修订 E34/E39-1/E40：**快照追加表+compact 预算**——CanvasDoc 单行原地重写（TOAST 全量重写+死元组）改 **CanvasDocSnapshot(projectId,revision,stateSeq,state) 追加式+CanvasDoc 指针**——一次四得：读路径不可变 WHERE revision=?/天然 CAS 令牌/消 E39「单行主键=单向门」/K 份保留起步（Y6 扩策略+自动化）。stateSeq 语义=「本次快照覆盖到的 maxSeq」，仅决定增量读，**不承担守卫**（守卫=E42 SV 支配性）。compact 补：分块+事务外重放+显式 {timeout}+后台调度+频率随字节自适应+写入字节/分钟入容量模型+**CanvasDocUpdate autovacuum/bloat 监控** | §2.2（表+CAS 落 -1；compact 分块/调度/自适应/监控归属→Z6 裁定） |
| C7③ | 排空切换 runbook（停写→drain→reset→部署→强刷）进 Y1（第一个弄脏 doc 的批次） | §2.4 |
| E20 移入项 | （Y0a 行 v8.1）**E20 读侧守卫三处/装载降级出口/doc-incomplete 码移 Y1c-1**（撕裂可达之时——E42⑤ 不可达裁定+守卫对整行缺失结构性失明）；E20 本体：完整性判据=**SV 支配性**（encodeStateVectorFromUpdate：被删行 SV 并集⊆新快照 SV，pendingStructs 仅辅助）+读路径 fail-closed 三处守卫：装载三步后判/readCanvas 拒绝+独立 reason/yjs_doc_incomplete_total/compact 写快照前判 | §2.6 |

### 0.1b 内容系（Y1c-2a 域）

| 编号 | 裁决（原文） | 效力 |
|---|---|---|
| C8 | Y.Text 硬约束——文本只允许原地 splice 更新；addNode 建好 Y.Text 后，该节点**禁止任何「整块替换 data/子 map」写入**（delete+insert 静默吞并发编辑）——Y1 起回归禁区，静态门禁化；Y1c 行将禁令**扩 data 全键整块替换** | §3 |
| E26 | 客户端 keep GC——UndoManager 对被删 struct 置 keep=true 阻断 GC；STACK_LIMIT shift() 截断只砍数组不解 keep——客户端 doc 随会话无界增长；修复落 Y1c（与 exec 进 scope 同批——undo 恢复恰依赖 keep，禁粗暴 clear）：对被截断出栈的项释放 keep、**扣除仍被剩余栈项引用的 struct 交集**；验收=删 200 个 1KB 节点后 encodeStateAsUpdate 字节回落 | §3（E33 修订随行） |
| E33 修订 | keep 释放实测零回收——①struct 粒度直接置 struct.keep=false（**禁走 keepItem——沿 parent 向上传播会误释放仍被保护的祖先=栈项 undo 恢复出 GC 壳=静默内容丢失**；StackItem.deletions 是 DeleteSet 区间，扣除须 struct 粒度）②回收唯一路径=**客户端 doc 重建**（复用 terminal rebuild 机制，前置 synced∧unsyncedChanges===0，触发=yjs_client_doc_bytes 阈值或空闲窗口） | §3 |
| Y0b-4 移交 | E39 单人零开销表第⑤格「文本泄漏同灭」→Y1c-2a（结构上限：节点数/data 字节/文本长度）；Y0b spec §9 遗留 9：单键 256KB 间隔门与整串覆盖拒绝语义在 Y1c-2a（Y.Text）落地时重切（canApplyIntent 单一 seam 只改一处） | §3 |
| Y1a/Y1b §6 移交 | SCHEMA=4→Y1c（:531；Y1a/Y1b 已占 3——版本口径→Z1） | §2.1/§3 |

### 0.1c exec 系（Y1c-2b 域）

| 编号 | 裁决（原文） | 效力 |
|---|---|---|
| E2 | exec 契约 v2+绑定裁定——attempt 维度（attemptId=intentId/attemptSeq 单调/artifact{mediaId,objectKey}，**URL 不入 exec**）；仅 attemptSeq>=现值允许整组覆盖、终态不倒退仅对同一 attemptId；**绑定裁定**：客户端 deleteNode intent 同事务 exec.delete(nodeId) 与 exec 进 scope=[nodes,edges,exec] 必须同批；execView.spec:320-328 断言从「零写」收窄为「只删不设」；sweepOrphanExec 整删改为源头消除后「doc 装载时廉价自检+计数」；Origin.Server 死常量删除；origin 契约表（写入者→origin→入栈→投影重建）进 Y1c | §4/§2.7 |
| E22 | attemptSeq 单调源=**exec 内自增**（attempts 列仅同一 intentId 内单调——二次生成=新 intentId 从 1 重来，迟到旧写同放行=竞争复现）；写入门槛：seq>现值 ∨（seq=现值∧同 attemptId）+stale 写计数 yjs_exec_stale_write_total；artifact 仅更大 seq 可覆写。**执行门三态矩阵**（loading 拒/done 按入口分流——execute-all 跳过、显式 regenerate 放行凭 attempt/error 放行——Y2 冻结）+修 execute 未知 nodeId 静默 success。**撤销×exec 洞语义**：删期间被丢弃的 exec 写不补投，恢复后 alignExecFromIntents 呈现最近终态，job 在飞=无状态重跑恢复（用例：A 删→B 完成→A undo→无幽灵 loading）。**已付费未交付裁定 (a) 退款**（删时在飞 intent 标待退款，产物到达即 refund）+ai_artifact_discarded_total 计数。**exec 不变量写死**：exec 无对应 node⇒视同不存在，禁任一读者当独立真源 | §4 |
| E64 | exec 契约+outbox（Y1c-2b）——①**PG 侧 outbox**：exec 写意图先落库（GenerationIntent 加 exec 投影列或小表+状态列）由 BullMQ 重试至成功；doc 写不再吞错——现 loading/error 四处 `.catch(()=>{})`（execution.service.ts:61/136/204/279/351）+**done 路径无 .catch 落外层 catch 对已 SUCCEEDED 意图 void_+fail+广播 error**（:173/:236/:318→:339-355——产物已写、扣费已完成却报 error=语义反转）②progress 永不入 exec+manifest 第五层「禁止入 doc 键」（viewport/selection/hover/drag/progress）③attempt 历史有界（exec[nodeId] 只留当前 attempt，历史在 PG）④装载后服务端对账（非终态条目→查 GenerationIntent→终态回写 origin=Server+存在性前置）⑤E2 次序约束写死：存在性守卫+客户端 deleteNode 清 exec **同批或先于** sweepOrphanExec 降级。**验收锚：kill collab 进程→执行完成的节点在恢复 30s 内必达 done（Y3 删 socket.io 的前置条件）** | §4 |

### 0.1d 门禁系（Y1c-3 域）

| 编号 | 裁决（原文） | 效力 |
|---|---|---|
| E17 | 交付物机器化——data.\* 全键读写矩阵+写域迁移表+真源清单=从**显式 doc schema manifest（TS 单源）派生的断言族**，非人工表格（键集知识现分散≥5 处）；新字段未分类即红（字段闭环门禁）；与既有 guard idiom 同构（envelope-serialization-guard/doc-shape-single-source.guard）复用不新造。data.fileId/status 读者 census 与 snapshot-filter.util.ts:133（data.status='idle' 写者）进 Y1c 基线 | §5 |
| E38 | manifest 扩**四层**（不只 data.\*）：顶层 map 集合（nodes/edges/exec/meta/时间轴/threads——**Y1c 起新增顶层域**）/每个嵌套类型的唯一创建者（E27 规则）/每个键的写入者与读者/归属（doc·exec·PG·投影合成）+撤销 scope | §5 |
| E27 | 嵌套共享类型唯一创建者——同一 key 并发创建=败者 Item 被删、字段在胜者视图不可见且无异常无日志；manifest 硬规则：**嵌套类型只允许父容器唯一创建者创建**，服务端对无权创建的 key 一律 no-op 不建；门禁=扫 getMap().set(k, new Y.Map()/Array/Text) 逐点登记创建者唯一性；用例=两 doc 并发对同一 nodeId 写 exec 不同字段，merge 后两字段俱在（今天红） | §5（census 形态已 Y0c 片 C0 冻结，用例落本批） |
| E30 | 字段冲突语义表（Y1c origin 契约表邻域并写进用户可见文档：data.content=Y.Text 字符级合并/几何与 config=LWW 绝对值/exec=attempt 维度）+每批 spec 首节内联该批有效裁决全文 | §5/本 spec §0.1 |
| E68 | 不变量登记表（Y0c 冻结形态/Y1c-3 落地）——每条三列=判据/读侧行为/写侧行为：①parentId 存在且无环②边两端存在③分镜/storyboard 引用存在④时间轴 clip sourceNodeId 存在⑤exec 无对应 node 视同不存在；铁律：**读侧全函数**（投影绝不抛）/写侧**显式拒绝**（业务错误码，禁丢帧禁静默跳过）/**禁修复写回 doc**；validateParentGraph 从入口静默过滤改业务错误返回+数量断言。Y0c R0c-5 勘正：①环=topology.sort 显式拒 CYCLE 已执法；Y0c 交付=形态冻结+现状核对，缺口执法移交本批 | §5 |
| D7+E33 | doc 字节预算=`A + 253B×活节点 + ~15B×累计删除项`（253B=活节点内容口径，显式标注不含 tombstone 与客户端 keep 保留量）+yjsCanvasDocBytes 告警+Origin.Geometry 帧写上限（同一手势最多 K 条超出合并）；世代维护触发=恢复需求/schema 翻转/删除项数阈值（spec 给数字），非字节增长 | §5 |
| E63 | 存储配额预留-结算+落盘幂等（Y1c-3）——①配额 check-then-act 无锁（storage-quota.service.ts:25-31）+ai-download.processor.ts:82 只调第一道→两并发生成同过且永久留存；修法=预留-结算（storageReserved 计数行+CAS）+AI 路径必经 assertOnConfirm+预留超时对账回收②落盘非幂等：对象键含 randomUUID+media.create 无去重键+taskId=Date.now()；修法=对象键确定性化（含 intentId/nodeId）+jobId=intentId（BullMQ 天然去重）+Media(projectId,nodeId,intentId) 唯一约束③defaultJobOptions 继承语义运行时断言（配置即契约）。验收=同 intent 重试不产生重复 Media 行+孤儿对象（先红后绿） | §5 |
| E45 移入项 | （Y0a 行 v8.1）准入 env 预留默认关的 enforcement 档（deny/LRU/RSS 软阈/字节上限/server-busy 码）移 Y1c-3 与 D7 预算同批 | §5 |
| 存量删除 | （Y1c 行）存量 data.status/fileId **一次性删除**（E17 写侧）——随 -2a/-3 落地（内容变换后写侧禁令+删除） | §3/§5 |

### 0.1e 前批冻结契约与移交（直采）

| 项 | 内容 | 效力 |
|---|---|---|
| Y0c R0c-4 世代契约冻结 | docName 语法 `project:<id>#g<N>`+六处连带点清单+双校验语义+单世代断言；**唯一实现动作=parseDocName 收口已落**（doc-name.util.ts：DOC_NAME_RE/parseDocName/isValidDocName/isGenerationMismatch）；**世代真源=DB 列**（vacuumReplace 递增不恒 0，K11 勘正）；name 与 DB 列不一致=独立拒因——防第二真源；**spool 键世代作用域随 Y1c**（当前 projectId 域=世代切换首次发生于 Y1c-1 前无歧义） | §2.3/§2.5 |
| Y0c Z32 | 客户端 doc schema 门生产恒开——服务端版本门已拒连+装载播种已做；登记 Y1c-1（世代通道批）**随 #g<N> 一体评估** | §2.3（Z3 附带裁定） |
| Y0b-4 4410 | generation-superseded close code 已分配（Y0b-4 T1），**消费归 Y1c-1** | §2.3 |
| Y1a/Y1b §0.2-④ | 「本批固定 3（双常量同值两门）」——3 已被 T18 占位（5ebdf6ce，csv 2→3+SCHEMA 2→3）；§6 :531「SCHEMA=4→Y1c」「闩锁删除→Y1c-1」（§3.3 resync 闩锁——plan 期 census 定位） | §2.1/§2.7 |
| Y1a/Y1b §6 :536 | vacuum 自动回退禁止；「连接代际握手=client 回传最后已知 generation，服务端 SyncStep1 前比对——Y2」——Y1c-1 docName 代际携带落地后该前提**提前满足**（Y2 行回填登记） | §2.3/§8 |
| Y1a/Y1b L70 | Y2 新登记两项观测（MediaFactOutbox pending 死行/media_materialize_lag gauge 语义）——非本批范围，引用不变 | §8 |

---

## 0.2 裁定项（v1 呈用户——逐项给推荐，用户可改判）

| # | 项 | 选项与推荐 |
|---|---|---|
| **Z1** | **版本口径**（Y1a/Y1b 已占 3） | **推荐 (a)**：(a) Y1c-1 **csv→4**（协议面变化：docName 世代段+4410 消费+装载门两档收敛；旧 bundle 拒连走版本终态档 reload UX）+**docSchema 维持 3**（载体不动内容契约）→Y1c-2a 经 E61 协议升 **4**（内容变换时点）。(b) Y1c-1 双常量同 bump 4。理由：双常量分工=Y0b-3 T0 显式分离（csv=线契约/SCHEMA=内容契约），Y1a/Y1b「同值」是该批固定非永恒约束；载体片无内容变换，升内容版本号=空 bump，且 -2a 的 4 必须与 E61 变换同刻才有意义 |
| **Z2** | **客户端得知当前 generation 的通道** | **推荐 (b)**：(a) E23 原文「建 provider 前 REST 取 g」（每建一次往返）；(b) **localStorage 末知 g+4410 纠偏跳**：客户端持久化 last-known g（localStorage 按 pid 键），据此构造 docName/缓存键；服务端 onAuthenticate 校验 name 段 vs DB 列，缺段/错段=**先拒载**（4410 generation-superseded，reason 携当前 g）→客户端清该代 IDB 缓存+更新 g+携正确段重连；首连（无 g）=缺段同路径一次纠偏后入库。理由：无每建往返；复用 Y0b-4 已分配 4410；与 E60「docName 只管世代、无需另造 REST/query 通道」的通道最小化裁定一致；E3 静默投毒路径被结构性封死（错代缓存键 ≠ 新代键，永不并入）。**deviation 说明**：与 E23 字面「REST 取 g」偏离，按 E60 精神收窄，呈用户裁定 |
| **Z3** | **CanvasDocSnapshot 保留粒度（K=1 语义）** | **推荐 (a)**：(a) **每 (projectId,generation) 留最新 revision**（K=1/代）——旧代最后快照天然归档留存（E39「与旧世代归档同批」的载体），Y6 扩策略；(b) 全局 K=1（切换即弃旧代）——违背 E39 归档同批要求，不推荐 |
| **Z4** | **compact 守卫连续 3 败出口形态** | **推荐 (b)**：(a) 自动触发世代重建；(b) **告警+admin 可见+runbook 人工触发重建命令**（重建=断连全体+清增量，自动执行风险大于收益；fail-stuck 的增量无界增长由「指标告警→人工窗口」承接）。E23 原文「出口=Y6 同一台机器，登记为指定降级路径」——本批交付命令+告警接线，自动归 Y6 |
| **Z5** | **actor 审计深度（E40）** | **推荐 (a)**：(a) Y1c-1=**origin 契约表**（写入者→origin→trackedOrigins→undo scope→投影重建，TS 单源+断言）+**服务端 doc 写全埋点**（withDoc/withSession 携 actor+command 落 append-only 表 DocWriteAudit）；客户端 origin 枚举收口进契约表；**per-user 客户端 origin 升格留 Y4**（批注真正消费时——trackedOrigins 语义随 Y4 变更，现在动=无消费方的投机改造）。(b) 现在就做客户端 per-user origin——不推荐 |
| **Z6** | **E62 compact 机制硬化归属** | **推荐 (a)**：(a) Y1c-1 只做**追加表+指针+revision CAS+去 advisory lock**（E62 四得本体+repository:228 注释点名的 CAS 前置）；分块/事务外重放/{timeout}/后台调度/频率自适应/autovacuum 监控按 Y6 行既有归属（「E62 K 份策略+compact 频率随字节自适应+CanvasDocUpdate autovacuum/bloat 监控」明文在 Y6）留 Y6，本 spec §8 登记。(b) 全量并入 -1——不推荐（-1 已含世代通道六连带+审计+守卫，再并入将超单片可回滚粒度） |
| **Z7** | **-2a/-2b 片序** | 路线图定序 -2a→-2b（Y1c 行末段）；-2a 的 schema→4 硬切依赖 -1 协议机器先行=天然顺序。**维持**。（-2b 对 -1 无结构依赖，若用户裁 -2a 变更延期可对调——呈备选） |
| **Z8** | **Y1c-1 是否含 dev/演练环境世代切换实弹** | **推荐 (a)**：(a) 含——int 级（identity 变换全链）+浏览器级（4410 纠偏+清缓存硬刷+重连）各至少一验，作为 -1 出口判据（服务器仍硬切前旧版，首次部署 --rebuild-db 后再服务器级演练一次，归部署清单）；(b) 只做单测/int——不推荐（世代切换是执行门主题，无实弹=门虚设） |

## 0.4 偏离登记表（滚动）

| # | 偏离 | 落地形态与依据 |
|---|---|---|
| （v1 空——实施期滚动登记） | | |

---

## 1. 基线快照（2026-10-23 三路一手核验；行号=master 65accbe7）

### 1.1 载体域（Y1c-1 承接面）

| # | 现状主张 | 亲验锚点 |
|---|---|---|
| 1 | csv=CLIENT_PROTOCOL_VERSION=**3**（T18 硬切 5ebdf6ce 2026-10-22；csv=2 是 Y0b-4 T1 2f186816）；docSchema=CANVAS_DOC_SCHEMA_VERSION=**3**，版本承载=CanvasDoc.schemaVersion PG 列（默认 3）；协商四档 negotiateClientVersion（allow/client-version-missing/client-version-invalid/schema-outdated/server-outdated） | packages/shared/src/constants/collab-protocol.ts:11,:14-28；packages/shared/src/canvas/docShape.ts:40,:58-62（ensureSchemaVersion 三函数已 T18 退役——版本判据唯一承载=PG 列装载门）；消费=collab-session-guard.service.ts:147-148 |
| 2 | 装载版本门：schemaVersion!=null∧≠3→拒载 SCHEMA_OUTDATED；**null 行现放行**（=E61 两档收敛对象） | collab-doc-registry.service.ts:387-397 |
| 3 | docName=`project:<id>` 无世代段；**#g<N> 语法已冻结未接线**：DOC_NAME_RE 含可选段、isValidDocName 现状**拒放**带段 name、isGenerationMismatch 纯函数已备未用；注释 :13「canvasProject.generation」表名笔误（实际列在 CanvasDoc） | apps/api/src/modules/collab/doc-name.util.ts:16,:24,:36-39,:43-45；客户端构造=apps/web/src/stores/canvasCollabRuntime.ts:1601（`project:${pid}`）、collabUrl :70-80/:1594-1597 |
| 4 | CanvasDoc=projectId 单行主键（state/stateSeq/generation default 0/preVacuumSv?/schemaVersion default 3）；CanvasDocUpdate=(projectId,seq) 唯一增量表；**无 revision 列、无 CanvasDocSnapshot 表**；generation 列=Y0b-4 T9a（20261011180000，vacuumReplace 递增） | apps/api/prisma/schema.prisma:862-876,:897-906；迁移尾=20261022080000_intent_claim_artifact_rev |
| 5 | 内存表全 projectId/documentName 单维键，**无 (projectId,generation) 复合**：pendingQueues/pendingSince/lastCompactAt/storeFailedDocs（projectId）+persistUnhealthy/persistRetry（documentName）+docEpoch=WeakMap<Y.Doc>+vacuumingDocs/preVacuumSvCache/docGeneration/docResidue/docStatusRev（projectId） | collab-persistence.service.ts:132,:143,:145,:149,:151,:153；collab-doc-registry.service.ts:167,:191-194,:204；内存 unflushed Map 已 Y0a-2 退役（collab.gateway.ts:211 注释：spool=唯一权威待落库台账） |
| 6 | compact 守卫=abandoned 语义（pendingStructs 非空→放弃本次+行全保留+下次 store 重试）；**「stateSeq 精确赋值依赖 advisory lock 串行——去锁并发化必须先落 Y1c-1 CAS 形态」**（本批点名前置）；**世代重建无 CLI**，仅 REST vacuum 端点（七步协议 vacuumCore，零连接窄版自动） | canvas-doc-update.repository.ts:272-275（守卫）、:228（CAS 注释）、:194-224（vacuumReplace 单事务 generation=n+1）；collab-persistence.service.ts:597-604；collab-doc.controller.ts:43-49；collab-shrink.service.ts:272-338；scripts/ grep 世代重建零命中 |
| 7 | spool 已完整（fsync 段文件+启动回灌+30s reconciler+关停 drain）；**键无世代段**（`${projectId}.${segSeq}.spool`）；**关停 drain 兜底=force-spool 落盘非落 PG**（=E39 排空两步缺口①）；store 主路径已把 spool 帧并入本次 append | collab-spool.service.ts:1-9,:49；collab.gateway.ts:756-778（回灌）,:869-913（关停）；collab-persistence.service.ts:819-838,:916+,:267,:320 |
| 8 | 服务端写门面=CollabDocWriter 六 op（writeBatch 四段：受理门→undefined fail-fast→rejections 事务外→withSession('write')）；withDoc=用完即走面（SERVER_TRANSACT_ORIGIN 最外层）；驻留/空闲回收=CollabResidencyService | collab-doc-writer.service.ts:197-226,:114-117；collab-document.service.ts:68-109（origin :102）；collab-residency.service.ts:202-233,:133-141 |
| 9 | origin 现状：SERVER_TRANSACT_ORIGIN='server' 单源常量（docShape.ts:51-56）；web Origin 枚举={LocalUser:'local-user',Server,AutoEdge,Geometry}，trackedOrigins 仅 LocalUser；**无任何 origin 契约表/actor 审计**（schema grep actor 零命中；AuditLog=管理面、ReconcileAction=对账面，均非 doc 写） | packages/shared/src/canvas/docShape.ts:51-56；apps/web/src/stores/canvasUndo.ts:11；schema.prisma:639-656；迁移 20261021150000 |
| 10 | 快照读路径=readConsistent 单 RR 事务（CanvasDoc 行+分页增量）；快照写=compact/vacuumReplace upsert 单行（TOAST 整行重写=E62 改造对象）；公开快照缓存 TTL 30s/LRU 32 **键未拼 generation** | canvas-doc-update.repository.ts:117-147,:167-181,:281-286,:214-218；collab-document.service.ts:137-164；snapshot-doc-cache.ts:14-28 |
| 11 | closeTeamDocuments 按 `project:${projectId}` 寻址（**非全世代**）；gate/e2e 装置无世代感知 | collab-session-guard.service.ts:1205 |
| 12 | 客户端本地缓存=Y0b-5 T8 最小内核（local-collab-cache）+T18「IDB 四维缓存键随行值结构性 miss」——缓存键含 schema 行值但**不含 generation**（docName 无段） | apps/web/src/collab/local-collab-cache.ts；Y1a/Y1b T18（5ebdf6ce） |

### 1.2 内容模型/exec/门禁域（-2a/-2b/-3 承接面——v1 锚定，深设计随片前版本收敛）

- **data.* 键系**：data.content 纯文本字符串（canvasIntents.ts:85 每击键整串覆盖——C8 改造对象）；positionXY 未拆键；cells 无稳定 id；时间轴域未入 doc。E17 census 前基线：data.fileId/status 读者 27 处/14 文件（E17 原文注记）；snapshot-filter.util.ts:133 data.status='idle' 写者。
- **exec 域**：exec map 现行（status/fileId 投影期合成未落地——C3/D2 归 Y2 投影统一；本批只动 exec 契约本身）；writeExecStatus 存在性守卫已 Y0 前移（E2 Z4/Z69）；execution.service.ts 五处 `.catch(()=>{})`+done 路径语义反转（E64 原文行号）；sweepOrphanExec 懒回收现状（Y0b-2 E36 触发点=完成时存在性检查）。
- **门禁域**：manifest 四层未建（键集知识分散≥5 处：docShape 私有谓词/NODE_ENVELOPE_KEYS/GROUP_NODE_DATA_KEYS/EPHEMERAL_DATA_KEYS/CANVAS_BRIDGE_KEYS——E17 原文）；canvas-invariants.ts 五条三列形态已 Y0c 冻结（①已执法/②④待勘/⑤=Z4 守卫闭环）；E63 三洞现状（storage-quota.service.ts:25-31/ai-download.processor.ts:82/:99-111/minio.service.ts:52/execution.service.ts:246/:328/execution.module.ts:44-46）。
- **Y1a/Y1b 交付基线**：order/尺寸/只读域全绿（verify full 30/30）；闩锁（§3.3 resync 域）维持待删（:531 移交本批 -1）。

---

## 2. Y1c-1 载体设计（首片——全深）

### 2.1 版本两门口径（Z1）

- **csv→4**：collab-protocol.ts 单源 bump；write-frozen-drill/exec-smoke/collab-smoke 已 shared 单源解析（65accbe7 约定——「字面量+bump 随改」已废弃，无随改面）。旧 bundle（csv=3）对新服务端=schema-outdated 档（reload 有效档），部署 api+web 同批。
- **docSchema 维持 3**：本片零内容变换；装载门两档收敛（E61）：`schemaVersion===3 ∨ 拒`，null 行=拒（无戳自愈仅限服务端种子路径——种子写显式 3）；Y1c-2a 经 E61 协议升 4（§3）。
- 双常量分工注记进 docShape.ts 头注（csv=线契约/SCHEMA=内容契约，同值是巧合非约束——Z1 裁定落痕）。

### 2.2 CanvasDocSnapshot 追加表+指针+revision CAS（E62+E3+E20 CAS）

**表形**（Prisma 迁移，dev 库无兼容负担）：

- 新表 `CanvasDocSnapshot { projectId, revision Int, stateSeq BigInt, state Bytes, createdAt }`，`@@id([projectId, revision])`，追加式（只 INSERT，禁 UPDATE/DELETE——删档仅归档策略动作）。
- `CanvasDoc` 改形：`state` 列**删除**；新增 `currentRevision Int`（指针）+`revision BigInt`（E3 水位）；`generation/preVacuumSv/schemaVersion/stateSeq` 保留（stateSeq=最近快照覆盖 maxSeq 的冗余便利列，语义同 snapshot 行——真源=指针行）。迁移=建表+每项目回填一行（revision=1, stateSeq=现值, state=现 state）+指针/水位初始化+drop state 列。
- **保留策略（Z3）**：每 (projectId,generation) 留最新 revision（K=1/代）。compact 成功插入新行后，删同代更旧 revision 行；**世代切换时旧代最后行不删**（=E39 归档同批的载体）。

**并发三写者矩阵**（去 advisory lock——repository:228 点名前置）：

| 写者 | 形态 | 并发语义 |
|---|---|---|
| append（高频） | 单语句 INSERT CanvasDocUpdate(seq) + 同事务 `UPDATE CanvasDoc SET revision=GREATEST(revision,{seq})`（E3 原文） | 无 CAS、永不重试 |
| compact（低频） | 读 currentRevision=R→快照构建（内存）→单短事务：INSERT Snapshot(R+1) + `UPDATE CanvasDoc SET currentRevision=R+1, stateSeq=… WHERE projectId=? AND currentRevision=R` + 删同代旧行 | **CAS 失败（0 行更新）=放弃本次+计数+下次重试**（沿用 abandoned 语义——不与 append 争锁）；与 append 交错由 CAS 检测（append 已推走 revision→WHERE 不中） |
| 世代切换（停写窗内） | 停写+断连后单事务：INSERT Snapshot(新代,revision=+1) + CanvasDoc{generation+1,currentRevision,revision,stateSeq} + deleteMany CanvasDocUpdate | 停写窗内无并发；=§2.4 协议④-⑥步 |

**读路径**：readConsistent 改读=CanvasDoc 行（generation/currentRevision/schemaVersion 门）+`Snapshot WHERE projectId=? AND revision=currentRevision`（不可变行，E62「天然 CAS 令牌」）+增量 `seq>stateSeq` 分页（RR 事务保持）。**指针悬空（快照行缺失）=结构性 fail-closed**（§2.6 守卫①覆盖——E20「守卫对整行缺失结构性失明」在新形态下自然可判）。

### 2.3 docName 世代通道（E23 六连带+Y0c R0c-4 冻结契约+4410 消费）

1. **服务端**：isValidDocName 谓词翻转——放行带段 name（`#g(0|[1-9]\d{0,8})`，DOC_NAME_RE 已备）；三入口（onAuthenticate/loadDocument/withDoc=withSession）**双校验**：parseDocName 段值 vs CanvasDoc.generation（世代真源=DB 列，K11），缺段/错段=独立拒因（close **4410** generation-superseded，reason 携当前 g——Z2）；修正 doc-name.util.ts:13 表名笔误（canvasProject→CanvasDoc）。**断言：任一时刻单世代可加载**（registry 层 invariant 断言+测试）。
2. **客户端（Z2 纠偏跳）**：localStorage 按 pid 持久化 last-known g→构造 docName `project:<pid>#g<g>`；IDB 缓存键由 docName 派生（含 g——E3「世代自然隔离」，替代性并入现四维键）；4410 到达=清该 pid 全部 IDB 缓存（旧代键结构性 miss，无需逐键清）+更新 g+携新段重连（一次，二次同因=terminal 档——connection-supervisor 既有闩锁语义复用）；首连无 g=缺段连→4410 纠偏一次入库。
3. **六连带其余四处**：closeTeamDocuments 全世代寻址（session-guard:1205 改代际扫描）；withDoc/withSession 用当前世代名+docGeneration Map 随 g 失效重播种；spool 键加代（§2.5）；gate/e2e 装置（Y0a/Y0c 三门装置）世代感知（双 client 携段连接+错段用例）。
4. **公开快照缓存键拼 generation**（snapshot-doc-cache——E23「世代 bump 主动失效」）。
5. **Z32 附带评估（落本节）**：客户端 doc schema 门生产恒开——世代段已入缓存键后，客户端在 apply 前比对 docStatus 下行 schemaVersion（已播种子）≠ 本地常量=拒并入+引导刷新；**建议采纳**（成本=一个判断点，收益=错版 update 永不进客户端 doc）。随 Z2 一并裁定。

### 2.4 世代迁移协议+世代重建命令+排空 runbook（E61+E23+C7③+E39 两步）

**协议机器（Y1c-1 落地，Y1c-2a 消费）**——八步写死，变换函数=参数（本批 identity）：

```
①停写（服务端拒新连接写+暂停 store 链）→②drain：pending 队列 flush+spool 段回灌并 **append 落 PG**（E39 补步一——关停 drain 现走 force-spool 落盘，本步给「落 PG」出口：flushPendingStores+replayAll 至空+确认零段）
→③断连该 doc 全部连接→④导出可见态（encodeStateAsUpdate 现装 doc）→⑤纯函数变换 transform(state)：本批=identity；Y1c-2a=v3→v4（fixture 逐位比对）
→⑥单事务写新代：INSERT Snapshot(g+1) + CanvasDoc{generation=g+1,指针,水位} + deleteMany CanvasDocUpdate（=清增量）+旧代快照行留存（E39 补步二=归档同批，Z3）
→⑦bump 完成（新连接按 §2.3 纠偏进入新代）→⑧客户端代不符清缓存硬刷（4410→清 IDB→重连新段名——§2.3 第 2 步同机制）
```

- **世代重建命令**（E23 手工触发）：`pnpm collab:rebuild-gen <projectId>`（scripts/ CLI，与归档同机）=上八步 identity 形态；**compact 守卫连续 3 败→告警指标 yjs_compact_fail_stuck_total+admin 可见**（Z4：人工触发，非自动；自动归 Y6）；现 REST vacuum 端点收编为同协议的服务面（七步 vacuumCore 对齐八步——零连接窄版自动保留，写侧单源=同一协议函数）。
- **互斥判据写死（E61）**：目标库 CanvasDoc 空（无行或零增量）=删行重造（reset-canvas-schema.mjs 先例）；非空=走重建命令。二者互斥、判据进命令前置检查。
- **排空切换 runbook（C7③+两补步）**：停写→drain（pending+spool 落 PG）→归档旧代→世代切换→部署→强刷——全文进 collab-ops-runbook.md 新节；**dev 演练与首次部署（--rebuild-db 后）各执行一遍**（Z8）。
- **读写路径禁「看版本分支」兼容代码**（E61 铁律——不因代际/版本做任何 if 分支读写；旧代数据只经协议⑤变换进入新代）。

### 2.5 spool 键世代作用域+内存表精确清理（E39+R0c-4）

- spool 段文件键 `${projectId}.${segSeq}.spool`→`${projectId}.g${N}.${segSeq}.spool`（collab-spool.service.ts:49）；replayAll 只收养当前代段；错代段=quarantine+计数（复用现 quarantine 面）；世代切换②步 drain 后旧代段必空——残留=quarantine 告警。
- 内存表键统一升维 (projectId,generation)（或 documentName 键——documentName 已含段，取更自然的 documentName 化）：pendingQueues/pendingSince/lastCompactAt/storeFailedDocs/persistUnhealthy/persistRetry/vacuumingDocs/preVacuumSvCache/docResidue/docStatusRev——世代 bump 时**按 (projectId,generation) 精确清理**（按 projectId 清会误清活跃世代——E39 原文；docEpoch=WeakMap<Y.Doc> 随 doc 实例释放自然失效，登记不清理）。

### 2.6 E20 移入：读侧三守卫+装载降级出口+doc-incomplete 码（新读路径）

- **守卫①（装载三步后判）**：readConsistent 组装（快照行+增量）完成后 **SV 支配性**校验（被删增量行 SV 并集⊆快照 SV；pendingStructs 仅辅助）——不满足=拒载。
- **守卫②（readCanvas 拒绝+独立 reason）**：服务端读出口同判据；**守卫③（compact 写快照前判）**：compact 构建态 SV 支配性预判（现 pendingStructs 判据扩为 SV 判据单源）。
- **指标**：yjs_doc_incomplete_total{reason}（snapshot-missing/sv-dominance）；**装载降级出口**：拒载≠永久卡死——reason=doc-incomplete 档+admin 告警+runbook 指路 §2.4 重建命令（E23「指定降级路径」）。
- **指针悬空**（§2.2 读路径）纳入守卫① reason=snapshot-missing（E20「整行缺失结构性失明」在新表形下可判——移入动机兑现）。

### 2.7 origin 契约表+actor/command 审计（E40+E2，Z5）+闩锁删除

- **origin 契约表**（TS 单源，packages/shared）：`{writer, origin, trackedOrigins, undoScope, projectionRebuild}` 五列——服务端六 op（SERVER_TRANSACT_ORIGIN）/客户端四 origin（LocalUser/AutoEdge/Geometry/Server）+维护 origin（maintenance——Y1a rebalance 已用）全量登记；断言=运行时写事务 origin ∈ 表内枚举（api+web 双侧 guard，复用 envelope-serialization-guard idiom）。
- **DocWriteAudit append-only 表**：`{id, projectId, generation, actor, command, origin, nodeId?, meta, createdAt}`——服务端 doc 写全埋点（CollabDocWriter.writeBatch 携 actor=jobId/system+command=op 名，withDoc/withSession 落库点单源）；客户端写不落库（Y4 per-user 升格时评估客户端上报——Z5）。Origin.Server 死常量删除（E2）。
- **闩锁删除**：Y1b §3.3 resync 闩锁（Y1a/Y1b spec :531 移交）——plan 期 census 精确定位后删除+Y1b 只读域回归全绿作出口判据（G11）。

### 2.8 Y2 前提回填

Y1a/Y1b §6 :536「连接代际握手（client 回传最后已知 generation，服务端比对）——Y2」：本片 docName 代际携带+服务端校验落地后**前提提前满足**；Y2 行登记回填（归 plan 期文档动作）。

---

## 3. Y1c-2a 内容模型（v1 锚定——片前版本深收敛）

- **E61 真变换消费者**：transform= v3→v4 纯函数（data.content 字符串→Y.Text/positionXY 拆键/cells 稳定 id/时间轴域结构入 doc）+fixture 逐位比对；**schema→4 与变换同刻**（Z1）；互斥判据与八步协议复用 §2.4（identity→真变换，仅⑤步函数替换）。
- **C8 禁令落地**：文本只允许原地 splice（Y.Text delta 写入 seam=canApplyIntent 单一改点——Y0b §9 遗留 9 重切点）；**禁令扩 data 全键整块替换**（静态门禁化——getMap().set 整块替换扫描进 -3 manifest 断言族，本片先红）。
- **E26+E33 keep GC**：exec 进 undo scope 同批（-2b 协同）；struct 粒度 keep=false（**禁 keepItem**）+剩余栈项引用交集扣除；回收唯一路径=客户端 doc 重建（terminal rebuild 复用，前置 synced∧unsyncedChanges===0）；验收=删 200 个 1KB 节点 encodeStateAsUpdate 字节回落。
- **单人文本泄漏格**（Y0b-4 E39⑤ 移交）：结构上限（节点数/data 字节/文本长度）落地——Y.Text 化后单键 256KB 间隔门与整串覆盖拒绝语义重切。
- **存量 data.status/fileId 一次性删除**（写侧——读者改造随 Y2 投影统一 C3，本批只删写+禁令）。

## 4. Y1c-2b exec 契约 v2（v1 锚定）

- exec 契约 v2 全量（E2+E22）：attempt 维度（attemptId=intentId/attemptSeq=**exec 内自增**/artifact{mediaId,objectKey}，URL 不入）；写入门槛 seq>现值 ∨（=现值∧同 attemptId）+yjs_exec_stale_write_total；执行门三态矩阵；execute 未知 nodeId 静默 success 修；撤销×exec 洞语义（alignExecFromIntents）；已付费未交付=退款+ai_artifact_discarded_total；exec 无对应 node⇒视同不存在（读者铁律）。
- **E64 outbox**：exec 写意图先落 PG（GenerationIntent 投影列/小表+状态列）BullMQ 重试；**五处吞错清剿+done 路径语义反转修复**（execution.service.ts 行号集）；progress 永不入 exec；attempt 历史有界（exec 只留当前 attempt）；装载后服务端对账；kill collab→执行完成节点恢复 30s 内必达 done（**Y3 删 socket.io 前置**）。
- **undo scope=[nodes,edges,exec]+deleteNode 同事务清 exec**（E2 绑定裁定）+execView 断言收窄「只删不设」+E64⑤ 次序约束（存在性守卫+清 exec 同批或先于 sweepOrphanExec 降级）。

## 5. Y1c-3 门禁与预算（v1 锚定）

- **manifest 四层+第五层禁键**（E17+E38+E64②）：TS 单源派生断言族（键→写入者→读者→归属 doc/exec/PG/投影合成/删除+undo scope+唯一创建者）；新字段未分类即红；禁键=progress/viewport/selection/hover/drag；与既有 guard idiom 同构复用。
- **E68 不变量落地**：五条三列执法（②边两端/③分镜引用/④时间轴 sourceNodeId 缺口执法+①复核+⑤闭环）；写侧显式拒绝（业务错误码）/读侧全函数/禁修复写回；validateParentGraph 改业务错误返回+数量断言。
- **E27 用例**：两 doc 并发对同一 nodeId 写 exec 不同字段 merge 后俱在（今天红）+创建者唯一性 census 门禁接线（Y0c 片 C0 冻结形态）。
- **E30 字段冲突语义表**：origin 契约表邻域+用户可见文档。
- **D7+E33 预算**：`A+253B×活节点+~15B×累计删除项`（spec 给 A 值与依据）+yjsCanvasDocBytes 告警+Origin.Geometry 帧写上限（同一手势 K 条超出合并）。
- **E63 三洞**：存储配额预留-结算+CAS+AI 路径必经 assertOnConfirm+超时对账；落盘幂等（对象键确定性化/jobId=intentId/Media 三元唯一约束）；defaultJobOptions 继承运行时断言。先红=同 intent 重试重复 Media 行+孤儿对象复现。
- **E45 移入 enforcement 档**：deny/LRU/RSS 软阈/字节上限/server-busy 码（env 预留已 Y0a 落，本批接 enforcement）。

---

## 6. 片序与执行门

| 片 | 内容 | 出口判据（达成=用户确认点） | 回滚面 |
|---|---|---|---|
| **Y1c-1 载体** | §2 全部 | G1-G12（§7）+verify 全绿+世代切换演练（Z8）——**世代切换首次执行前单独请用户确认（:163 执行门）** | 迁移可回退（快照表 additive 先行+drop state 列最后）；世代切换=单向门（归档同批兑现后可回读旧代快照） |
| **Y1c-2a 内容模型** | §3 | schema→4 硬切+E61 fixture 逐位+keep GC 字节回落+C8 门禁先红转绿 | E61 协议回滚=bundle 回退+世代重建（旧代快照在档） |
| **Y1c-2b exec 契约** | §4 | kill 恢复 30s done 锚+三态矩阵用例+吞错清剿 census 零命中 | exec 契约域独立（undo scope 与 -2a 同批面协调） |
| **Y1c-3 门禁预算** | §5 | manifest 断言族全红转绿+不变量执法+E63 先红后绿+预算断言入 CI | 纯门禁+配额域 |

- 片序=-1→-2a→-2b→-3（Z7）；每片出口=用户确认点（合并不稀释质量——:163 原文「门一道不少，只是从立项层移到执行层」）。
- 上线门槛三项（exec v2/E26/Y.Text）随上线批强制（E39 重申）。

## 7. 验收判据与先红门禁（-1 全量；-2a/-2b/-3 框架——片前版本补全）

| # | 门禁 | 先红判据（可复现反面） | 绿判据 |
|---|---|---|---|
| G1 | 追加表迁移 | —（迁移+回填+drop state；migrate dev/deploy 链双验） | schema 定形+readConsistent 新读路径全量测试绿 |
| G2 | revision CAS 并发 | 删 advisory lock 后 compact×append 交错（CI postgres 三方交错先例）丢增量/双快照/指针回退任一复现=红 | CAS 单调：交错下指针只前进、增量零丢、compact 失败=放弃重试计数 |
| G3 | 双校验+单世代 | 错段/缺段 name 连接：现状放行（isValidDocName 拒带段=红前置翻转）+错段不拒=红 | onAuthenticate∧onLoadDocument 双拒 4410 携 g；任一时刻单世代断言 |
| G4 | 六连带点 | 逐点 census 先红（closeTeamDocuments 单代寻址/spool 键无代/内存表单维/装置无感） | 四处+缓存键拼 g 全落；census 清零 |
| G5 | 世代切换全链 | identity 重建命令端到端：错代 update 并入新代 doc（实验 D 复现）=红 | 八步全链 int+浏览器（4410→清 IDB→重连新段）绿；旧代快照留存可读 |
| G6 | E20 三守卫 | 人为 snapshot 行缺失/SV 支配破坏：现状装载通过=红 | 拒载+独立 reason+yjs_doc_incomplete_total+降级出口指路重建命令 |
| G7 | 旧代归档 | 切换后旧代最后快照行被删=红 | K=1/代留存+跨代可读（归档同批兑现） |
| G8 | origin 契约+审计 | 表外 origin 写事务（现无断言）=红；服务端写零审计行=红 | 契约表断言双侧+DocWriteAudit 全埋点（六 op×actor+command） |
| G9 | 静默投毒免疫 | 客户端持旧代缓存连新代服务端：旧代 update 并入=红（实验 D 复现于改造前路径） | 缓存键代际隔离+4410 纠偏跳=并入结构性不可能 |
| G10 | csv=4 硬切 | 旧 bundle（csv=3）连新服务端：非版本终态档=红 | schema-outdated 档 reload UX；write-frozen 演练随 shared 单源绿 |
| G11 | 闩锁删除回归 | 删闩锁后 Y1b 只读域（§3.3 七命令+resync 三路）任一红=红 | Y1b 域全绿+census 闩锁零残留 |
| G12 | 4410 消费端到端 | 客户端 4410 到达不清缓存/不清 g/二次重连失败=红 | 清 IDB+更新 g+携新段重连恰一次；二次同因 terminal |
| -2a 框架 | G13-G16 | E61 fixture 逐位比对/keep 字节回落/C8 整块替换扫描红/schema→4 两档硬切 | 片前版本补全 |
| -2b 框架 | G17-G20 | 吞错五处 census/kill 恢复 30s/三态矩阵/并发创建用例 | 片前版本补全 |
| -3 框架 | G21-G25 | manifest 未分类字段红/E68 缺口执法红/E63 重复 Media 复现/预算断言 | 片前版本补全 |

**观测增补**：yjs_doc_incomplete_total{reason}/yjs_compact_fail_stuck_total/yjs_exec_stale_write_total（-2b）/ai_artifact_discarded_total（-2b）/yjs_client_doc_bytes（-2a）/yjsCanvasDocBytes 告警阈值（-3）。

## 8. 非目标与移交

| 项 | 归属 |
|---|---|
| compact 分块/事务外重放/{timeout}/后台调度/频率自适应/CanvasDocUpdate autovacuum-bloat 监控 | **Y6**（Y6 行明文+E62；Z6 裁定） |
| K 份策略扩展+自动化/COS 归档/恢复演练/世代维护自动化 | Y6 |
| 客户端 per-user origin 升格（批注消费方） | Y4（Z5） |
| data.fileId/status 读者改道+投影合成 | Y2（C3/D2——本批只删写侧） |
| z 序 UI | 后续批（Y1a/Y1b §6 维持） |
| vacuum 自动回退 | 维持禁止（Y1a/Y1b §6 :536；代际握手前提已由本批满足——Y2 行回填） |
| Y2 已登记两项观测（outbox pending 死行/materialize lag gauge 语义） | Y2（Y1a/Y1b spec L70——不变） |
| 多实例/监控/运维 | Y7 |
| 上线门槛变化 | 无（E39 门槛判据不因合并变化） |

## 9. 纪律与观察项

- **TDD 先红**：每 G 判据先红后绿；世代切换=执行门主题（:163），首次执行前单独请用户确认。
- **禁垫片/禁版本分支兼容码**（E61 铁律+用户根修指令）：旧代数据只经协议⑤变换进新代；读写路径零「看版本分支」。
- **csv 消费一律 shared 单源**（65accbe7 约定——「字面量+bump 随改」废弃）。
- **护栏自查**：本 spec ~490 行＜可评审规模护栏 ~1500 行（:164）——四片合并立项维持。
- **观察项**：①追加表回填在 dev 库（无生产数据）——首次部署走 --rebuild-db 判据与 E61 互斥判据对齐（空=删行路径）；②spool 键升代后旧键段文件（无代前缀）首启=quarantine 收养一次（一次性迁移动作，进 runbook）；③Y1b 闩锁精确形态 plan 期 census；④Z32 客户端 schema 门采纳后与 4410 的交互（错版 vs 错代分档 reason）在 plan 期用例化。

---

*版本确认：v1（2026-10-23）——起草会话呈用户评审；裁定项 Z1-Z8 待裁后进 v2。*
