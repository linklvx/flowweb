<!-- doc-status: active -->
# Y1c：doc 模型 v3·载体与契约（B 类合并批设计——-1 载体 / -2a 内容模型 / -2b exec 契约 / -3 门禁预算）

- **立项**：2026-10-23，用户指令「Y1a+Y1b 完成，继续下一个任务」。按目录 §0.2 顺序节 B 类分组「Y1c 全批（-1+-2a+-2b+-3）」合并立项（:159）；四片分别验收、批末一个完整发布单元（§0.2-C6）。
- **唯一上游依据**：[2026-10-06-canvas-yjs-arch-upgrade-review.md](2026-10-06-canvas-yjs-arch-upgrade-review.md)（master v8.3）§0.2 Y1c 行（:145）+启动方式/执行门机制（:154-164）+§0.1 裁决（§0.1 内联）；Y0c spec 世代契约冻结（R0c-4/E68 形态/Z32/偏离 67）直采；Y1a/Y1b spec v14.3 移交行承接。
- **硬前置**（Y1c 行）：Y0a+Y0.5 迁移链——已满足。
- **门槛重申**（E39，不因合并变化）：上线门槛=0 号+Y0a+Y0b+Y0.5+Y1a+Y1b+（**Y1c-2 三项 exec v2 修订版/E26/Y.Text+XmlFragment 随上线批强制**）；Y1c-1/-3 收益为维护成本与模型完备性。
- **最终原则（用户 2026-10-23 终裁）**：统一 Yjs 协作路径，不新增无必要同步平面；PG 保持业务权威；doc 内允许受控投影，但**投影必须与用户编辑、撤销和网络写权限结构性隔离**。已有路线图不是不可修改的依据，但也不能在有更小、完整解法时无谓重建架构。

**修订链**：
- v1（2026-10-23）——首版合稿：三路一手核验+四片锚定+Z1-Z8 呈裁。
- **v2（2026-10-23）——外审一轮（生产级评审报告，21 项承重主张全实证）+用户终裁 C-1~C-6+报告收回两项+另修两点**：①报告实证 v1 四处设计错误（CAS/水位论证、写入时世代 fencing 缺失、identity≠重建、SV 三守卫违反 E42④）与六处基线过时（执行域被 Y1a/Y1b T13-T16+F1 重写——交付链/PG execSeq/NodeArtifact/ArtifactProjection/对象键/TextInputNode=Tiptap）全部修正；②用户裁定：C-1 exec 留 doc 但隔离撤销与写权限（E2 绑定修订）/C-2 不建全量命令系统但补原子准入/C-3 读者改道前移同单元/C-4 保存屏障随载体/C-5 **最小富文本绑定前移 -2a**（推翻 v1 的「HTML 串进 Y.Text 维持 LWW」推荐——该推荐自相矛盾：HTML 入 Y.Text=字符级合并损坏标记树）/C-6 保留四片+批末单发布；③报告收回：「exec 必须整体出 doc」「全部结构操作必须命令化」非本项目修复正确性所必需；④另修：快照保留≠恢复能力（历史检查点语义）；Geometry 本批不推翻既有契约（撤回取消修复回写建议）。§2/§3/§4 全面重写，§0.2 改定案表。

---

## 0.1 本批有效裁决（master 内联——E30 纪律：spec 自包含）

### 0.1a 载体系（Y1c-1 域）

| 编号 | 裁决（master 原文摘引） | 本批效力（v2） |
|---|---|---|
| E3 | generation 走合并前可见载体=docName `project:<id>#g<N>`（服务端按 DB 列校验）或鉴权握手返回；客户端建 provider/Y.Doc 前丢弃本地缓存（实验 D：老代 update 并入新 doc=静默投毒）；CanvasDoc 加 generation+revision 双列 | **修订采纳**：revision 水位语义由 GREATEST(revision,seq) 改为 **appendSeq 行锁内取号**（§2.2——v1 去锁方案有提交前缀缺口，报告 3.1 实证）；世代获取通道=**已有项目元数据**（project.service findById 已返回 collabGeneration，E3「鉴权握手返回」形态已实现——零新往返） |
| E23 | docName 世代 6 处连带+双校验+单世代断言；最小世代重建前移 Y1c（手工触发）；compact 守卫连续 3 败→世代重建出口；公开快照缓存键拼 generation | **修订采纳**：重建=类型化可见态导出全新 Y.Doc（§2.4——identity encodeStateAsUpdate 不换历史身份，报告 3.3+rebuildVacuumDoc 头注互证）；3 败出口=告警+关闭破坏性维护+人工重建仅对已证明完整源（Z4 定案） |
| E39 | Y1c-1=SCHEMA_VERSION+generation/revision+stateSeq+docName 世代通道+排空 runbook 补两步（pending+spool 落 PG/归档旧世代）+世代重建命令与归档同批；内存表按 (projectId,generation) 精确清理 | 采纳（§2.4/§2.5）；归档语义按六-①修正：**快照保留=历史检查点非无损回滚保证** |
| E60 | 版本协商走 providerVersion；缺字段=拒连；docName#g<N> 只管世代，无需另造 REST/query 通道 | 采纳（与元数据通道现状互证） |
| E61 | 世代切换=唯一 doc 迁移载体：停写→drain（pending+spool 落 PG）→导出可见态→纯函数变换→写新代快照→归档旧代→bump→客户端清缓存硬刷；禁「看版本分支」兼容码；空库=删行 vs 非空=迁移命令互斥判据；schemaVersion 门两档收敛 | **修订采纳**：导出可见态=**类型化 manifest 导出**（非 encodeStateAsUpdate）；互斥判据=**类型化可见态判定**（零增量≠空——已 compact 项目零增量但内容完整）；fixture=**语义比对**（fresh doc clientID 不同，字节逐位仅限确定性种子） |
| E62 | CanvasDocSnapshot(projectId,revision,stateSeq,state) 追加式+CanvasDoc 指针；stateSeq=覆盖 maxSeq 仅决定增量读不承担守卫；compact 补分块/事务外重放/{timeout}/后台调度/自适应/监控 | **修订采纳**：Snapshot PK=**(projectId,generation,snapshotRev)**+stateHash；基础调度/事务外重放/超时/bloat 观测**随 -1 上线**（纯流量触发对安静项目=增量无界——「只有形态收益没有运行机制」不成立，Z6 定案）；自适应/分层归档留 Y6 |
| C7③ | 排空切换 runbook（停写→drain→reset→部署→强刷） | 采纳（§2.4 维护状态机收编） |
| E20 移入项+**E42④** | E20 读侧守卫三处/装载降级出口/doc-incomplete 码移 Y1c-1；**E42④：SV 支配性=对账哨兵，非 compact 放行判据**；E42①：装载一致性=单 RR 事务覆盖快照+全增量；E42③：pendingStructs 只在「收到某行且时钟超前」产生，整行缺失不产生 | **按 E42 口径重写**（v1 §2.6 复活 E20 旧口径=违反更晚裁定）：主判据=**RR+前缀连续性**（§2.6），SV 降哨兵 |
| E45 移入项 | 准入 env 预留 enforcement 档（deny/LRU/RSS 软阈/字节上限/server-busy 码） | 采纳（-3） |

### 0.1b 内容系（Y1c-2a 域）

| 编号 | 裁决（master 原文摘引） | 本批效力（v2） |
|---|---|---|
| C8 | 文本只允许原地 splice；建好 Y.Text 后禁任何「整块替换 data/子 map」写入；Y1c 行扩 data 全键整块替换禁令 | 采纳；**载体分型（C-5 定案）**：纯文本=Y.Text；TextInputNode 富文本（Tiptap，现状 getHTML 整串）=**Y.XmlFragment+最小 Collaboration 绑定前移 -2a**（禁 StarterKit 本地 history+编辑器/画布撤销归属分界+Tiptap 2 固定版适配；批注/复杂富文本留 Y4） |
| E26+E33 | keep GC：释放被截断出栈项∧扣除仍被剩余栈项引用交集；E33②：struct 粒度 keep=false 禁 keepItem；回收唯一路径=客户端 doc 重建 | **修订（报告 3.8+探针+源码实证）**：**tryGc 可回收（保留 1051B→clear() 1051B→tryGc 27B）——「唯一路径=重建」不成立**；修法 v2=bounded-undo（100 项/4MiB 预算）+非重入窗口精确 DeleteSet tryGc+**版本钉死适配器**（涉底层 store）；释放覆盖有效 undo/redo/redone/祖先闭包；tombstone 残留（~15B/项）与历史重置仍归世代维护重建（两机制并存边界） |
| E27 | 嵌套类型唯一创建者；服务端对无权创建 key 一律 no-op 不建；门禁=创建者唯一性 census；用例=两 doc 并发同 key 写 exec 不同字段 merge 后只剩一支（今天红） | **修订**：**帧级整体拒绝取代 no-op**（部分应用破坏 CRDT 因果——报告 3.5/C-2）；exec 域改**整条 JSON 投影值原子替换**（§4——嵌套 exec map 创建点连根消灭）；容器唯一创建（结构创建时一次性建容器，叶子写者只取现有实例，容器不存在=拒绝/等待，禁双方 lazy-create） |
| Y0b-4 移交 | 单人文本泄漏格（结构上限：节点数/data 字节/文本长度）+单键 256KB 间隔门与整串覆盖拒绝语义重切（canApplyIntent 单一 seam） | 采纳（-2a；上限按字节计不分文本类型——HTML/纯文本同域） |

### 0.1c exec 系（Y1c-2b 域）

| 编号 | 裁决（master 原文摘引） | 本批效力（v2） |
|---|---|---|
| E2 | attempt 维度+绑定裁定：客户端 deleteNode 同事务 exec.delete 与 exec 进 scope=[nodes,edges,exec] 必须同批；execView 断言收窄「只删不设」；origin 契约表进 Y1c | **绑定裁定修订（C-1 定案）**：**exec 不入 UndoManager scope；客户端 deleteNode 不直接删 exec**。用户内存验证实证：**即使 data.fileId 是 server origin 写入，删除节点后 undo 仍把它作为恢复内容带回（trackedOrigins 不自动剔除被删子树里的服务器字段）**——undo scope 绑定改写而非整体推翻同 doc 投影体系；execView 断言改「客户端对 exec 零写」（含 undo 恢复路径——准入门拦截） |
| E22 | attemptSeq 单调源=exec 内自增+写入门槛+执行门三态矩阵+撤销×exec 洞+已付费未交付退款+exec 不变量 | **单调源修订（C-1 定案）**：**PG execSeq=唯一执行序**（已在：全局单调+reserve/settle/void CAS 维度，Y1b T2）；attempts 仅=重试计数；**三计数分离**：execSeq（执行代际）/eventVersion（同代状态推进）/artifactRevision（独立保护用户 replace/clear——即 NodeArtifact.rev）；doc 守卫改 execSeq 比对（现 applyWriteExecStatusToDoc 仍比对 attempts——维度落后实证）；撤销×exec 洞/退款裁定/不变量⑤维持 |
| E64 | PG 侧 outbox（exec 写意图先落库 BullMQ 重试）；五处吞错+done 语义反转；progress 永不入 exec；attempt 历史有界；装载后对账；kill 恢复 30s 必达 done | **修订采纳（基线更正）**：主路径已修——交付唯一 owner=ArtifactProjection 投影 poller（Y1a/Y1b T15）+SUCCEEDED 防反转（F1 :455-459）+AI 对象键已 content-addressed；本批延伸：**loading/error/done 全状态走 outbox**（不只 done）；**内容等值 fast path 不得跳过状态修正**（poller 等值跳过实证——状态错配永不修正风险）；kill 锚修订=「PG 已终态成功且产物已可交付的任务，collab 恢复后 30s 内展示当前终态；materializing 展示真实物化中，不伪造 done」 |

### 0.1d 门禁系（Y1c-3 域）

| 编号 | 裁决（master 原文摘引） | 本批效力（v2） |
|---|---|---|
| E17+E38 | manifest 四层 TS 单源派生断言族（顶层 map 集合/唯一创建者/键写读者/归属+undo scope）+第五层禁键；新字段未分类即红 | **冻结前移 -1**（C-6：manifest 契约冻结入 -1），断言族全量执法 -3；census 为派生检查不冒充语义分类 |
| E30 | 字段冲突语义表（origin 契约表邻域+用户可见文档） | 采纳（-3；语义更新：exec=整条投影值原子替换·服务器专写/纯文本=字符级/富文本=XmlFragment/几何与 config=LWW） |
| E68 | 不变量五条三列（判据/读侧行为/写侧行为）；读侧全函数/写侧显式拒绝/禁修复写回 | 采纳（-3）；**边界澄清（报告 11.2）**：「合法维护命令级联删除=业务写，非投影修复」——与「禁修复写回」不混淆；强不变量（无环/引用存在）改在**候选态验证+整帧拒绝**（C-2，-1 串行窗），不再「先污染后补偿」 |
| D7+E33 | doc 字节预算+Geometry 帧写上限（同手势最多 K 条超出合并） | 采纳（-3）；**Geometry 既有契约本批不推翻（用户六-②）**：撤回「取消几何修复回写」建议（论证不足）——保留预算/手势保护/回归用例，后续领域内依实测调整 |
| E63 | 配额预留-结算+落盘幂等+defaultJobOptions 断言 | **修订采纳（基线更正）**：AI 对象键已确定性（artifactObjectKeyBase 含 team/intentRow/execSeq/index+sha256）——修法聚焦：**外呼前原子预留（StorageAccount/StorageReservation）+幂等 confirm（重复 confirm 返回已有结果，不重复计字节不删完成资产——getUsage 含 completed+重复 confirm 双计→超限删对象删行实证）+超限拒只在预留期+孤儿 GC 闭环（查询 manifest/物化租约/已提交引用，删前再校验）** |
| 存量删除 | data.status/fileId 一次性删除（E17 写侧） | **时序修订（C-3 定案）**：**全部读者改道与字段删除同发布单元**（-3）：图像完成判断/工作流素材/媒体引用/复制粘贴/公开快照一起改道→删旧持久化字段+写者+fallback；不建双写过渡、不把 broken reader 留给 Y2 |

### 0.1e 前批冻结契约与移交（直采）

| 项 | 内容 | 效力 |
|---|---|---|
| Y0c R0c-4 世代契约 | docName 语法+六连带+双校验+单世代断言；parseDocName 已收口（doc-name.util.ts）；世代真源=DB 列；name≠列=独立拒因；spool 键世代作用域随 Y1c | 采纳（§2.3） |
| Y0c Z32 | 客户端 doc schema 门生产恒开随 #g<N> 一体评估 | 采纳（§2.3-5——客户端 apply 前比对 schemaVersion，拒并入+引导刷新） |
| Y0b-4 4410 | generation-superseded close code 已分配，消费归 Y1c-1 | 采纳（§2.3——**须走 hardClose 主动关**：实证 4.6.0 auth catch 只发 PermissionDenied 不关连接） |
| Y1a/Y1b 移交 | 闩锁删除→-1（§3.3 resync 域，plan 期 census 定位）；SCHEMA=4→本批 | 采纳 |
| Y1a/Y1b §6 :536 | vacuum 自动回退禁止；「client 回传最后已知 generation 服务端比对」前提由本批满足 | 采纳（Y2 行回填） |

---

## 0.2 裁决定案（2026-10-23 用户终裁——本轮外审收敛）

| # | 定案 |
|---|---|
| **C-1** | **exec 留同一 Y.Doc，但隔离撤销与写权限**。PG=业务真源；doc.exec=服务器专写持久投影（供展示与离线读取；不可客户端改、不参与资金判断、不被用户撤销回滚）。落实：PG execSeq 唯一执行序+attempts=重试计数+eventVersion 同代推进+artifactRevision 独立保护 replace/clear（三计数不混）；exec[nodeId]=**整条不可分割 JSON 投影值**（单一服务端写者原子替换——消灭混合 attempt 与嵌套创建）；exec 不入 undo scope+客户端 deleteNode 不删 exec（删后读侧立即屏蔽+服务端幂等清理+恢复后按 PG 重投影）；**所有服务器产物投影字段移出用户可撤销的 nodes.data 子树**（用户上传素材选择等可编辑引用另行分类，不一概禁止）；loading/error/done 全状态延伸 PG outbox（成功标记以投影持久化完成为依据；内容等值不跳状态修正） |
| **C-2** | **不建全量命令系统，补齐原子准入**。检查二进制 struct/DeleteSet/父链/共享类型/创建权限/受保护根（非只看最终 JSON/禁键字符串）；服务器已确认投影历史重传放行、客户端**新增**受保护写入拒绝（不因帧含 exec 封正常 SyncStep2）；**验证与实际 apply 共用项目级串行窗口，服务器投影写经同一入口**（现状每连接排队+锁只包 hook=跨连接竞态）；强不变量在窗口内候选态验证、失败整帧拒绝（禁先污染后补偿）；拒绝内容不部分过滤不盲重发——独立本地草稿+冲突告知+重提路径。离线可编辑≠离线结构操作无条件接受（多端离线结构合并违反图约束=明确拒绝语义——Y5 验收覆盖）；少量强业务操作复用现有服务端结构入口，不为拖拽/文本/节点编辑新增命令总线/shadow 提交/补偿撤销体系 |
| **C-3** | **读者改道前移，与字段删除同发布单元**（-3）。不建双写过渡，不留 broken reader 给 Y2 |
| **C-4** | **保存屏障随载体落地**（-1）。synced/unsyncedChanges=0≠PG 已提交；屏障覆盖同连接此前已受理更新、等 PG、只确认对应前缀；delete-only/批发送/断线/迟到回执全覆盖；spool 落盘不冒充 PG 保存成功 |
| **C-5** | **最小富文本绑定前移 -2a**。纯文本=Y.Text；现有 Tiptap 富文本=Y.XmlFragment+最小 Collaboration 绑定（-2a 完成）；禁重复本地 history+编辑器/画布快捷键撤销归属明确+配置适配 Tiptap 2 固定版。批注/复杂富文本留 Y4；现存富文本不得挂错误 CRDT 载体等以后修。（v1「HTML 串进 Y.Text 维持 LWW」推荐**推翻**：HTML 入 Y.Text=字符级合并非 LWW 且不保证编辑器树有效——自相矛盾） |
| **C-6** | **保留四片质量出口，批末一个完整发布单元**。不采用报告 A-D 新批次体系；-1→-2a→-2b→-3 分片验收；相互依赖半成品不分别部署；无用户数据，批末直接建设并发布 v4（不保留兼容读写/旧 spool 收养/存量双写） |
| **报告收回×2** | 「exec 必须整体出 doc」「全部结构操作必须命令化」非本项目修复正确性所必需 |
| **另修①** | **快照保留≠恢复能力**：当前代 2 份+最近两旧代各最终 1 份=合理起步保留策略，但旧快照后增量已被压缩删除时仅凭旧快照无法恢复当前完整状态——声明为**历史检查点**语义；恢复能力（增量保留/完整备份）归 Y6 恢复域 |
| **另修②** | **Geometry 本批不推翻既有契约**：撤回「取消几何修复回写」（论证不足）；保留预算/手势保护/回归用例 |
| **Z1 落定** | csv→4 于 -1（协议面：docName 世代段+4410 hardClose+准入拒绝语义+装载门两档）；docSchema→4 于 -2a（内容变换同刻）；**master 中间态不部署**（批末单发布）——「协议/内容」两常量独立语义维持 |
| **Z2 落定** | 元数据先行（已有 project.service 通道，零新往返）；客户端检查 schema 后固定 {uid,pid,g,schema,sessionEpoch} 再建 IDB/Y.Doc/provider（携段名）；**localStorage 非当前 g 真源**；服务端认证/装载/append 三层核验（TOCTOU）；4410 仅处理竞态与真正换代（触发重新取元数据+创建完整新会话——非仅换 provider）；同目标世代纠偏限一次+退避+总预算（不与网络故障混作 terminal）；合法 g 提示仅在登录/项目 ACL 通过后返回 |
| **Z3 落定** | 当前代 2 份+最近两旧代各 1 份（有界起步，另修①语义）；不回填不归档搬运存量 |
| **Z4 落定** | 连续 3 次不完整=告警+关闭破坏性维护+诊断；人工重建仅对已证明完整源执行；identity 命令不得作「修复」出口 |
| **Z5 落定** | origin 机制表（本地机制记录：用户/编辑器 binding/UndoManager/provider·connection/服务端命令/维护——provider 对象不误判表外）+服务端可信 actor/command 审计**与内容 delta 同事务**；Origin.Server 无生产消费的客户端别名删、真正服务端写 origin 保留；per-user origin 不提前做（Yjs clientID/origin 非可信署名——未来法律级逐字符归因另立）；高频文本按批次审计连接/作者集合 |
| **Z6 落定** | 基础后台调度/事务外重放/显式超时/bloat 观测随 -1；自适应频率/分层归档留 Y6 |
| **Z7/Z8 落定** | 四片序维持；真实 PG 交错+两浏览器换代+kill 演练=发布门（§7），不以单测替代 |

## 0.4 偏离登记表（滚动）

| # | 偏离 | 落地形态与依据 |
|---|---|---|
| 1 | E2 绑定裁定修订（exec 不入 undo scope/客户端不删 exec） | §0.2-C1 用户终裁；undo 恢复被删子树不剔除 server origin 字段（用户内存验证实证）——原「同事务删 exec+入 scope」绑定的前提不成立 |
| 2 | E22 单调源修订（exec 内自增→PG execSeq+eventVersion/artifactRevision 三计数） | §0.2-C1；doc 内计数受 undo/重建生命周期影响（undo 复活旧计数/重建归零→迟到写重获资格） |
| 3 | E27「no-op 不建」→帧级整体拒绝 | §0.2-C2；部分应用破坏 CRDT 因果 |
| 4 | E33②「回收唯一路径=重建」→tryGc 路径并存 | §0.1b E26 修订（探针+源码实证） |
| 5 | E3 GREATEST 水位/E62 CAS 形态→appendSeq 行锁取号+短事务 CAS(generation,rev) | §2.2；v1 方案前缀缺口（报告 3.1 实证） |
| 6 | E61 导出载体→类型化 manifest 导出；fixture→语义比对 | §0.1a E61 修订 |

---

## 1. 基线快照（2026-10-23 一手核验=master c5fc6982；v2 已修正 v1 六处过时）

### 1.1 载体域

| # | 现状主张 | 亲验锚点 |
|---|---|---|
| 1 | csv=CLIENT_PROTOCOL_VERSION=3（T18 硬切 5ebdf6ce）；docSchema=CANVAS_DOC_SCHEMA_VERSION=3（承载=CanvasDoc.schemaVersion PG 列）；协商四档 negotiateClientVersion | collab-protocol.ts:11,:14-28；docShape.ts:40；session-guard:147-148 |
| 2 | 装载版本门 null 行放行（E61 两档收敛对象） | collab-doc-registry.service.ts:387-397 |
| 3 | docName 无段；#g<N> 语法冻结未接线（isValidDocName 拒放带段名；isGenerationMismatch 备而未用）；注释 :13 表名笔误（canvasProject→应为 CanvasDoc） | doc-name.util.ts:16-45；客户端 canvasCollabRuntime.ts:1601 |
| 4 | **世代获取通道已在**：project.service findById 返回 collabGeneration/collabSchemaVersion/collabViewerUid（零新往返，page.tsx promise 链先于 initCollab） | project.service.ts:87-108 |
| 5 | **客户端缓存四维键已含 generation**：`{DB_PREFIX}{uid}:{pid}:g{g}:s{schema}`；世代三元不完整=禁缓存+local-cache-degraded 遥测 | local-cache-key.ts:24-25；canvasCollabRuntime.ts:1666-1677 |
| 6 | CanvasDoc=projectId 单行（state/stateSeq/generation/preVacuumSv?/schemaVersion）；CanvasDocUpdate=(projectId,seq) 唯一；**无 revision/appendSeq/lifecycle 列、无 CanvasDocSnapshot**；append 取号在项目 advisory lock 内（**前缀完整性现状由锁保证——v1「去锁」无等价证明=错误**） | schema.prisma:862-876,:897-906；canvas-doc-update.repository.ts:63-69 |
| 7 | 内存表全 projectId/documentName 单维键（pendingQueues/pendingSince/lastCompactAt/storeFailedDocs/persistUnhealthy/persistRetry/docEpoch=WeakMap/vacuumingDocs/preVacuumSvCache/docGeneration/docResidue/docStatusRev） | collab-persistence.service.ts:132-153；collab-doc-registry.service.ts:167-204 |
| 8 | compact 守卫=abandoned 语义；世代重建无 CLI（仅 REST vacuum 七步协议）；**rebuildVacuumDoc 克隆覆盖有限**：非 Map 根（Text/Array 序列内容）→null 降级；exec 等价断言只比键集合不比内容 | canvas-doc-update.repository.ts:272-275；collab-shrink.service.ts:272-338；collab-doc-registry.service.ts:628-662 |
| 9 | spool 完整（fsync/回灌/30s reconciler/关停 drain）；键无世代段；关停 drain 兜底=force-spool 落盘非落 PG | collab-spool.service.ts:49；collab.gateway.ts:756-778,:869-913 |
| 10 | **同步 ACK≠PG 保存**：readUpdate 内存应用后立即 writeSyncStatus(true)；stateless 回调不 await；auth 拒绝只发 PermissionDenied 不关连接（4.6.0 库源实证） | @hocuspocus/server MessageReceiver.ts:116-124,:241-280；ClientConnection.ts:517-557 |
| 11 | terminal recovery=provider-only 重建（同 doc 复用）——换代需全 doc 拆卸（observers/UndoManager/cache writer/provider+in-flight 检查 sessionEpoch） | canvasCollabRuntime.ts:514-526 |
| 12 | origin：SERVER_TRANSACT_ORIGIN 单源+web Origin 枚举（trackedOrigins 仅 LocalUser）；无 origin 契约表/actor 审计（schema grep actor 零命中）；服务端写门面=CollabDocWriter 六 op/withSession | docShape.ts:51-56；canvasUndo.ts:11；collab-doc-writer.service.ts:197-226 |
| 13 | residency releaser 单项目档丢弃 tryRelease 结果（drain 档 for 循环 await 后弃值）——维护方拿不到类型化 quiesce 结果 | collab-residency.service.ts:166-175 |
| 14 | closeTeamDocuments 单代寻址；公开快照缓存键未拼 g | collab-session-guard.service.ts:1205；snapshot-doc-cache.ts:14-28 |

### 1.2 执行/产物域（v2 更正——Y1a/Y1b T13-T16+F1 已重写，v1 引用 E64/E63 旧行号过时）

| # | 现状主张 | 亲验锚点 |
|---|---|---|
| 15 | **交付唯一 owner=ArtifactProjection 投影 poller**（T15：worker 零 doc 写；data.{fileId|result}+exec done=deliverArtifact 复合 op 专写面；node 删除观察=written:false node-deleted 权威观察点→orphaned+幂等退款）；SUCCEEDED 后残余异常=零退款零 error 投影（F1） | execution.service.ts:389-423,:455-459；projection-outbox.poller.ts:258-295 |
| 16 | **PG 执行代际已在**：GenerationIntent.execSeq BigInt @unique（全局单调 DB sequence；reserve/settle/void CAS 维度；execProjectedExecSeq error 投影代际）+NodeArtifact（权威=(sourceIntentRowId,execSeq,artifactIndex) 唯一；槽位唯一；rev=finalize/replace/clear CAS 锚=artifactRevision 现成载体）+ArtifactProjection（六终态 outbox；lease/runId） | schema.prisma:1074-1205 |
| 17 | AI 对象键已 content-addressed：`artifacts/{teamId}/{intentRowId}/{execSeq}/{index}-{sha256}`；finalize 资金 quota=软限（钱已付 provider 不因 quota 回滚；registerInTx 禁调 assertOnConfirm） | artifact-commit.service.ts:23-24,:53-56 |
| 18 | doc 侧 exec 守卫仍比对 attempts（missing/older/terminal-superseded）——**维度落后于 PG execSeq** | collab-document.service.ts:307-325 |
| 19 | poller 内容等值 fast path：doc 当前值等值=跳 apply（含 exec 状态不修正的风险面） | projection-outbox.poller.ts:265-290 |
| 20 | rollback 族 CAS 仅 status 维度（rollbackDeliveryFailed={id,status:SUCCEEDED}）——无 expectedExecSeq/精确 ledger 身份维度 | team-credit.service.ts:257-284 |
| 21 | 存储配额：getUsage=completed 之和；assertOnConfirm 超限→**删 MinIO 对象+删 Media 行**（重复 confirm 双计 actualSize→误删完成资产路径实证）；assertCanUpload 无锁 | storage-quota.service.ts:15-49 |
| 22 | TextInputNode=Tiptap（StarterKit+onUpdate getHTML 整串写 data.content）——富文本 HTML 字符串载体 | TextInputNode.tsx:37-50 |
| 23 | yjs 13.6.32 库源：UndoManager clear 路径 keepItem(item,false)（:43）；Transaction 导出 tryGc（:251）+事务清理调 tryGcDeleteSet（:325）——**释放 keep 后需触发 tryGc 才回收**（E33「零回收」观察的机制解释） | yjs/src/utils/UndoManager.js:43；Transaction.js:251,:325 |

---

## 2. Y1c-1 载体与原子准入（首片——全深）

### 2.1 版本两门口径（Z1）

csv→4（-1：docName 段+4410 hardClose+准入拒绝+装载门两档收敛——旧 bundle 走版本终态档 reload）；docSchema 维持 3 至 -2a 变换同刻升 4；master 中间态不部署（批末单发布，C-6）；双常量「协议/内容」独立语义注记进 docShape.ts 头注。装载门两档：`schemaVersion===current ∨ 拒`（null=拒；服务端种子路径显式写值豁免）。

### 2.2 PG 载体协议 v2（appendSeq 行锁取号+世代内聚）

**表形**（Prisma 迁移；dev 库硬切——additive 门禁按 Y1a/Y1b v11 先例登记豁免：spec 载明 reset runbook/无存量）：

- `CanvasDoc(projectId PK, generation, schemaVersion, lifecycle, currentSnapshotRev BigInt, appendSeq BigInt)`——小型头部。**删 state/stateSeq/preVacuumSv 列**（单行重写/第二真源/vacuum SV 代际门三职责分别由追加表/指针行/世代 fencing 承接）。
- `CanvasDocSnapshot(projectId, generation, snapshotRev BigInt, stateSeq BigInt, state, stateHash, schemaVersion, createdAt)`——`@@id([projectId,generation,snapshotRev])` 追加式（禁 UPDATE；DELETE 仅保留策略动作）。
- `CanvasDocUpdate(projectId, generation, seq BigInt, update, updateHash, createdAt)`——`@@id([projectId,generation,seq])` 只追加；哈希=字节校验/同代重复识别（不与业务幂等混同）。
- 序号全 BigInt，wire 十进制 string；指针指向同项目同代快照由复合关联/约束保证；「无头行」与「有头指针悬空」分档 reason。

**append（高频路径）**：短事务统一锁序——稳定读 CollabLease owner（FOR SHARE 短锁，takeover 用冲突锁）→ 锁 CanvasDoc 行 → 验证（lease owner ∧ **expectedGeneration** ∧ lifecycle=SERVING）→ 去重（updateHash）→ **appendSeq+1（行锁内取号，事务回滚连同回滚——提交前缀由构造保证）** → INSERT Update → 更新 appendSeq → COMMIT。**不用全局 sequence 数值大小推断提交顺序**（PG sequence 不随事务回滚——A 取 10 未提交/B 取 11 提交的前缀缺口结构性消除）。

**装载**：只读 RR 事务读头（generation,appendSeq=N,指针 R）→ 同代 Snapshot(R)（stateSeq=S）→ 读 S<seq<=N 全增量 → **检查顺序连续+数量=N-S+哈希校验** → 事务外 apply（重放失败=拒载不返回可编辑半文档）。S≤N+指针存在+前缀连续=结构完整性证据；**SV/pendingStructs=附加 CRDT 诊断哨兵（E42④）**。

**compact（基础调度随本片，Z6）**：RR 取快照 R+完整前缀至 N+拷贝数据退出事务→**事务外**（有界后台任务）重放/编码/校验（显式 {timeout}，不占 WS 事件循环与行锁）→短事务按同锁序检查 (generation,currentSnapshotRev=R)——**允许 appendSeq 已大于 N**（新增量自然保留由新快照后继续装载，append 不使 compact 失败）→CAS 成功才 INSERT Snapshot(R+1)+指针前移+stateSeq=N+删实读同代行集，任一步失败整体回滚；CAS 失败分类计数（conflict/not-owner/generation-changed/incomplete），不留孤儿快照不删增量。两 compact 仅一个发布（唯一键先撞场景归入 CAS 分类，不折成正常 miss）。触发：1,000 行/2MiB/最老增量 60s；单项目最短间隔 30s；全局重放并发 1 起步。

**保留（Z3+另修①）**：当前代留最近 2 份+最近两旧代各最终 1 份（≤4/项目）；**=历史检查点语义，非无损回滚保证**（旧快照后增量已压缩删除时不能仅凭其恢复当前态——恢复能力归 Y6）。

### 2.3 世代通道与三层 fencing（E23 六连带+Z2）

1. **元数据先行（零新往返，通道已在）**：客户端取项目元数据（collabGeneration/collabSchemaVersion/viewerUid 已返回）→检查 schema 匹配→固定 {uid,pid,g,schema,sessionEpoch}→再建 IDB/Y.Doc/provider（name=`project:<pid>#g<N>`——isValidDocName 谓词翻转为**要求段**）。localStorage 仅展示提示非真源。
2. **三层 fencing**：①认证（onAuthenticate：name 段 vs DB 列——**独立拒因走 hardClose 主动关**〔4.6.0 auth catch 只发 PermissionDenied 实证——复用 Y0b-3 close 单源机制〕，4410 携当前 g 仅在登录/ACL 通过后返回）；②装载（onLoadDocument 再核验）；③**append 原子验证 expectedGeneration**（§2.2——在飞 store/spool 回灌/内部写换代后晚到=数据库原子拒绝，不改标签重放）。**断言任一时刻单世代可加载**。
3. **4410 消费端到端**：触发重新取元数据+**创建完整新会话**（停写→清旧重试→本地未确认日志写完→拆 observers/UndoManager/cache writer/provider→destroy 旧 doc→新 doc——**非仅换 provider**：terminal recovery :514-526 同 doc 复用形态不适用于换代）；同目标世代纠偏限一次+退避+总次数预算（超预算=维护中终态）；缓存隔离=四维键结构性（purge 仅卫生——多标签 delete blocked fail-soft 已在，正确性不依赖 purge；未获 PG 确认内容保留至 detached 恢复区）；二进制备份导入校验项目/世代/schema，跨代仅类型化导入禁 raw applyUpdate。
4. **六连带其余**：closeTeamDocuments 全世代寻址；withDoc/withSession 用当前世代名+docGeneration 随 g 失效重播种；spool 键加代（§2.5）；gate/e2e 装置世代感知。
5. **公开快照缓存键拼 generation**；**Z32 采纳**：客户端 apply 前比对 docStatus 下行 schemaVersion≠本地常量=拒并入+引导刷新（与 4410 的错版/错代 reason 分档）。

### 2.4 维护状态机与世代切换协议（E61+E23+C7③）

**PG lifecycle+maintenanceId**（非散落布尔）：SERVING→QUIESCING→DRAINED→REBUILDING→SERVING；maintenanceId 幂等/可观察/可继续——进程任一步 kill 后由持久状态决定继续/中止。

步序（**先阻新生产者，再排空，不先禁 drain**）：
①项目级停收新写+暂停任务 claim（已飞外部任务保留 PG，完成事实继续落业务平面）→②旧连接只读，等待在应用/写入结束（**维护专用 drain 通路保持运行**）→③flush pending+回灌当前代 spool 落 PG（E39 补步一）+确认 pending/spool/在飞 append/actor 作业=零（失败=类型化结果保持封闭不自动换代；releaser 返回值类型化修复——基线 13）→④关闭旧连接卸载，基于已提交一致快照**按 manifest 类型化导出可见态**（nodes/edges/exec 投影/文本/时间轴——非 encodeStateAsUpdate）→⑤纯函数变换 transform（-1=identity；-2a=v3→v4 内容变换；**fixture=语义比对**：canonical 可见语义/类型/稳定 ID/引用/排序，字节逐位仅确定性种子）→⑥全新 Y.Doc 按 manifest 重建（Y.Map/Y.Text/Y.Array/Y.XmlFragment 全类型——**现 rebuildVacuumDoc 非 Map 根降级+exec 键集合等价断言扩为语义级**）+同短事务封存旧代最终快照（E39 补步二=归档同批）+写新代头（generation+1,appendSeq=0,schemaVersion=目标）+清旧代增量（仅归档与覆盖证明成立后）→⑦精确清旧代内存键（§2.5）恢复受理→⑧客户端 4410→重取元数据→新会话（§2.3-3）。

- **世代重建命令**：`pnpm collab:rebuild-gen <projectId>`（与归档同机）=上协议 identity 形态；REST vacuum 端点收编为同协议服务面（写侧单源=同一协议函数）。
- **互斥判据（类型化可见态判定）**：目标库 doc 无可见内容=删行重造（reset-canvas-schema.mjs 先例）；非空=走重建命令。**禁「零增量=空」判据**（已 compact 项目零增量但内容完整）。
- **compact 3 败出口（Z4）**：连续 3 次不完整=告警+**关闭破坏性维护**+诊断；人工重建仅对已证明完整源；identity 不作修复出口（源已不完整时导出可见态=固化缺失——优先完整存储/备份恢复；「缺损救援非无损恢复」独立标记工具）。
- **排空切换 runbook**（C7③）：停写→drain→归档→换代→部署→强刷，进 collab-ops-runbook.md；dev 演练+首次部署（--rebuild-db 后）各一遍（Z8）。
- **禁「看版本分支」兼容代码**（E61 铁律）：旧数据只经协议⑤变换进新代。

### 2.5 spool 键世代作用域+内存表精确清理（E39）

spool 段键 `${projectId}.g${N}.${segSeq}.spool`；replayAll 只收养当前代段；错代段=quarantine+计数；换代③步后旧代段必空——残留=告警。内存表键统一升维（documentName 含段或 (projectId,generation) 复合）：pendingQueues/pendingSince/lastCompactAt/storeFailedDocs/persistUnhealthy/persistRetry/vacuumingDocs/preVacuumSvCache（随 preVacuumSv 退役评估）/docResidue/docStatusRev——换代⑦步按 (projectId,generation) 精确清理（docEpoch=WeakMap 随实例释放）。

### 2.6 读侧完整性与降级出口（E20 移入项按 E42④ 口径重写）

**前缀连续性三守卫**（主判据）+SV 哨兵：①装载组装后判（前缀连续+哈希+指针存在——「有头指针悬空」独立 reason=snapshot-missing，E20「整行缺失结构性失明」在新表形下可判）；②readCanvas 服务端读出口同判据拒绝+独立 reason；③compact 发布前判（构建态前缀完整性预检）。指标 yjs_doc_incomplete_total{reason}；**装载降级出口**：拒载≠永久卡死——doc-incomplete 档+admin 告警+runbook 指路 §2.4（指定降级路径）；delete-only 延期数据（pendingDs）编码语义保留，不声称 pendingStructs/pendingDs 空可检测整行缺失；未解析因果数据不得在可见态重建中静默丢弃。

### 2.7 原子准入（C-2）+项目级串行窗口+origin 契约与审计（Z5）

**项目级串行窗口（本片新基础设施）**：验证与实际 apply 共用项目级串行窗口；**服务器投影写经同一入口**（现状 Hocuspocus 每连接排队+beforeSync 锁只包 hook 后释放=跨连接竞态实证——窗口消除 A.check/B.check/A.apply/B.apply 交错）。

**准入检查面**（进入窗口的每个入站帧）：
1. 检查二进制 struct/DeleteSet/父链/共享类型/创建权限/受保护根（**非只看最终 JSON/禁键字符串**）；
2. **服务器已确认投影历史重传放行；客户端新增受保护写入拒绝**（不因帧含 exec 封正常 SyncStep2）；
3. 强不变量（无环/引用存在）在窗口内**候选态验证**，失败**整帧拒绝**+close+诊断（复用 Z19'' 违规 close 语义）——禁先污染 live doc 再补偿修复；
4. 拒绝内容不部分过滤（破坏因果）、不盲重发——**独立本地草稿+冲突告知+重提交路径**；
5. 与 C-1 联动闭环：exec 根/受保护字段（含用户 undo 重建子树时的服务器投影字段——undo 恢复 op 为客户端作者）在准入层结构性拒于 doc 外。

**离线边界声明**：离线可编辑≠离线结构操作无条件接受——多端离线结构合并违反图约束=整帧拒绝语义（Y5 验收覆盖此边界，不以保留 Y5 名义省略）；少量强业务操作复用现有服务端结构入口（不建命令总线/shadow 提交/补偿撤销体系）。

**origin 契约表**（TS 单源，shared）：`{writer, origin, trackedOrigins, undoScope, projectionRebuild}`——本地机制记录（用户/编辑器 binding/UndoManager/provider·connection/服务端命令/维护）；断言=写事务 origin∈表内枚举（api+web 双侧，复用 envelope-serialization-guard idiom）；Origin.Server 无生产消费客户端别名删、服务端写 origin 保留。

**DocWriteAudit（append-only）**：`{id,projectId,generation,actor,command,origin,nodeId?,meta,createdAt}`——服务端可信 actor（session/内部认证）+command 与内容 delta **同事务**提交（有审计无内容/有内容无审计皆禁）；auditId↔traceId 关联；高频文本按批次审计连接/作者集合（不每击键全量 JSON）。

**闩锁删除**：Y1b §3.3 resync 闩锁（Y1a/Y1b :531 移交）——plan 期 census 定位删除+Y1b 只读域回归全绿（G11）。

### 2.8 保存屏障（C-4）

- **三档保存状态**：本地修改/同步中→服务器已接收待保存→已保存到服务器（synced∧unsyncedChanges=0 只到第二档——库源实证 ACK 在内存应用后即发）；spool fsync=本机故障保护已写，不冒充 PG。
- **同连接有序 marker**：客户端先 provider.flushPendingUpdates()（公开 API 实证）→同连接发 save-barrier（nonce+sessionEpoch+generation+本地 edit watermark）→服务端在**被 await 的有序入口**识别 marker（stateless 回调不 await 实证——禁在 onStateless 随意 await 取水位）→捕获此前所有已受理更新的项目前缀→等该前缀进 PG→回 (nonce,g,committedSeq)。
- 回执只清 marker 之前 dirty（后续仍脏）；跨连接/旧 provider/旧 generation 迟到 ACK 无效；连接曾拒帧=屏障不可成功；断线后新 nonce 重发；delete-only update 同经 marker 序列；PG 批写 ~3s 上界保留但屏障前不对用户宣布已保存；保存/执行/离页可触发提前 flush。
- 本地 IDB append 以事务 complete 为成功，关缓存实例前刷日志；日志 GC 只删已覆盖且已确认记录。

### 2.9 manifest 契约冻结前移（C-6→-1）

四层 manifest TS 单源在 -1 冻结为契约（E17+E38 形态）：顶层 map 集合（nodes/edges/exec/meta/时间轴/threads——新顶层域登记）/嵌套类型唯一创建者/每键写入者与读者/归属（doc·exec·PG·投影合成）+撤销 scope+禁键（progress/viewport/selection/hover/drag——E64②）；**nodes.data 键分类含「服务器投影字段（迁出→exec）/用户可编辑引用（保留）」二分**（C-1）；schema 创建/projection/导入导出/静态门禁从此消费；**新字段未分类构建红**（-1 即生效）；断言族行为门全量执法 -3。data.fileId/status 读者 census（27 处/14 文件）+snapshot-filter util:133 写者进基线。

---

## 3. Y1c-2a 内容模型（C-5 定案版）

- **文本分型（现在分清）**：纯文本域（prompt/普通文本）=Y.Text 直接 delta/splice（禁每键整串覆盖/全串 diff 绕行——canApplyIntent 单一 seam）；中文 IME composition/粘贴/选区/两端同位置插入独立验收。**TextInputNode 富文本=Y.XmlFragment+最小 Collaboration 绑定（前移本片）**：禁用 StarterKit 本地 history、编辑器与画布 UndoManager 快捷键归属分界（文本焦点内 Ctrl+Z=编辑器协作历史）、配置适配 Tiptap 2 固定版（不照抄在线最新版）；格式化 HTML 仅渲染/导出非合并真源；批注/高级富文本留 Y4。
- **唯一创建者（E27 修订）**：节点与 data/文本容器在结构创建时一次性创建，叶子写者只取现有实例；容器不存在=拒绝/等待；禁 client/server 双方 lazy-create 同 key；census 门禁（Y0c 片 C0 冻结形态）+**用例先红**：两副本并发同 key 建容器→旧路径只剩一支（红），新路径创建者唯一+两后续字段修改均可见（绿）。
- **完整重建序列化（E61 消费）**：类型化导出/重建覆盖 Y.Text/Y.Array/Y.XmlFragment 全类型（rebuildVacuumDoc 扩面）；v3→v4 纯函数变换（fixture 语义比对）+**schema→4 与变换同刻**（Z1）。
- **bounded undo（E26+E33 修订）**：上限 100 项/4MiB 保留内容预算（入栈前后统一核算）；退休项回收覆盖有效 undo/redo/redone/祖先闭包；非重入维护窗口对精确 DeleteSet 调 **tryGc（版本钉死适配器，禁散调）**；验收改写：退休结构内容可回收+有效 100 项历史可恢复+GC 后字节不含退休负载（「删 200 节点后完全回落」原锚不合理化——结构删除由补偿语义保存前值；若测试保留 100 项完整删除内容则字节归零本身不合理）；redo 清空/clear/detach/destroy 同生命周期；常规 GC **不**销毁 provider/Y.Doc 不清剩余历史（世代维护/项目切换/显式清撤销=历史重置边界，前置=PG 保存屏障+本地写完成）。
- **单人文本泄漏格**（Y0b-4 移交）：结构上限（节点数/data 字节/文本长度——按字节计不分类型）+单键 256KB 间隔门重切。
- **时间轴域**：真实消费的 VideoProject.data 读写同步迁移（不放空根宣称完成）；PG 衍生产物 cells 不重复入 doc 成第二真源；未迁移功能保留原真源禁双写。

## 4. Y1c-2b exec 契约 v2（C-1 定案版）

- **doc.exec=服务器专写持久投影根**（受保护根——准入层拒客户端写，含 undo 恢复路径）：
  - `exec[nodeId]`=**整条不可分割 JSON 投影值**（{execSeq,eventVersion,status,artifact{mediaId,objectKey},…}——URL 不入），单一服务端写者原子替换（Y.Map 值整体 set——无嵌套共享类型=并发创建点连根消灭+无混合 attempt 字段）。
  - **exec 不入 UndoManager scope；客户端 deleteNode 不删 exec**；节点删除→读侧立即屏蔽（不变量⑤读侧全函数）+服务端幂等清理；节点恢复→按 PG 当前执行/交付/退款状态重投影（alignExecFromIntents 族）——已退款显示「已取消需重新生成」/在飞未取消=真实 loading/完成未撤销交付=合法产物；**禁幽灵 loading 复活与免费重跑已退款生成**。
  - **所有服务器产物投影字段移出 nodes.data 子树**（fileId/result/status 迁 exec 投影——undo 恢复被删子树不剔除 server origin 字段的实证根因消除）；用户上传素材选择等可编辑引用按 manifest 分类保留。
- **PG 唯一执行序与三计数（E22 修订）**：execSeq=执行代际（claim/rearm）；attempts=免费重试计数；eventVersion=同代 loading/done/error 推进（单调）；artifactRevision=NodeArtifact.rev（独立保护用户 replace/clear，不因旧任务晚到回滚）。doc 守卫改 execSeq 比对（基线 18 attempts 维度落后修正）+stale 写计数。执行门三态矩阵维持（loading 拒/done 按 execute-all 跳过·regenerate 新请求/error 按真实费用规则）+未知 nodeId/零可执行显式拒。
- **outbox 延伸（E64 修订）**：loading/error/done 全状态在业务状态事务内落 PG（ArtifactProjection 演进为持久运行态事件/投影——**延伸既有，不建平行投影队列**；PG poller 继续可靠 dispatcher，BullMQ 只调度重活/加速提示；jobId=eventId 或 intent+execSeq+eventVersion 非冒号分隔）；claim 带 runId/leaseUntil，完成标记验证 runId+期望状态+目标修订号（过期 worker mark 不改坏新 run 结果）；**内容等值 fast path 不跳状态修正**（基线 19——状态错配必须修正路径）；kill 锚=PG 已终态成功且产物可交付→collab 恢复 30s 内展示当前终态，materializing=真实物化中；stateless 仅可丢 revision 提示，冷启动/重连读授权 runtime snapshot 按 runtimeRevision 追赶（订阅与快照竞态补齐——**以 execSeq 替代整体 runtimeRevision 不成立**）。
- **退款代际闭环**：rollback 族全 API 补 **expectedExecSeq+精确 ledger 行身份**（基线 20——现 CAS 仅 status 维度，rearm 后旧代迟到退款误命中风险）；删除结构命令持久 deletion-observed+在飞执行标不可节点交付；provider 不可取消→orphaned/discarded 明确状态+退款指向确切 execSeq 与原 settle ledger 行；第三方 provider 无幂等时不承诺跨 provider exactly-once（提交前 requestId/提交后 taskId/超时 query-first·UNKNOWN 人工可见不自动重复付费 submit）。

## 5. Y1c-3 门禁与预算

- **读者改道与字段删除同单元（C-3）**：图像完成判断/工作流素材/媒体引用/复制粘贴/公开快照全部读者改道投影合成→删旧持久化字段+写者+fallback（E17 写侧）——**无双写过渡无 broken reader**。
- **E68 不变量执法**：五条三列落地（②边两端/③分镜引用/④时间轴 sourceNodeId 缺口执法+①复核+⑤闭环）；读侧全函数保留可诊断异常/写侧显式拒绝（业务错误码禁丢帧禁静默跳过）/禁修复写回；**合法维护命令级联删除=业务写非投影修复**（边界澄清）；普通删除后远端视图按确定规则屏蔽悬空引用；execute topology 数量断言（不静默跳未知节点）。
- **manifest 断言族全量**（-1 冻结契约的执法）：新字段未分类红+二进制授权/父容器替换/跨代 replay/未知类型/URL 写 exec 行为门；manifest+静态扫描不替代真实网络测试。
- **E63 修订版**：外呼前原子预留（StorageAccount(teamId,usedBytes,reservedBytes,version)+StorageReservation(reservationId,operationId,execSeq,upperBoundBytes,state,leaseUntil)——未知视频大小按服务端上界预留禁零预留）+物化同事务结算（真实 bytes/Media 提升/used 增/reserved 释）+**幂等 confirm**（completed 返回已有结果不重计字节不删对象——基线 21 误删路径封死）+超限拒只在预留/扩额期+预留超时对账回收（验 lease/version 防双减）+孤儿 GC（查询 manifest/物化租约/已提交引用删前再校验，可追踪）+对象身份三层（业务身份 (sourceIntentRowId,sourceExecSeq,artifactIndex)/对象身份=现行确定性键+内容 hash 不改回可覆盖键/调度身份 eventId 辅助）+defaultJobOptions 完整命名 profile+运行时断言实际 Queue attempts/backoff/retention。
- **D7 预算与 Geometry（另修②）**：预算公式保留为 fixture 经验描述非配额真值（A 由 manifest 空文档实测记录版本/GC 设置/client 数/内容长度）；编码字节/JS heap/Undo 保留/XML·文本负载/tombstone 数/快照写放大分别监控；删除项 100,000 或历史残留>30% 编码量且≥2MiB=人工维护候选（不自动重建）；**Geometry 既有契约维持**（Origin.Geometry 帧写上限=同手势 K 条修复写合并/手势保护/回归用例保留——后续领域内依实测调整）；预算断言入 CI。
- **E45 移入项**+**观测**：低基数指标（durable_save_lag/append_gap/generation_fenced/runtime_outbox_oldest_age/storage_reservation_expired/object_gc_pending）；Prometheus 标签不带 projectId/nodeId/userId（定位进受权管理视图+采样日志）。
- **起步预算数字**（工程上界初值，目标服务器基准调整）：读事务 8s/短提交 5s/重放 10s；10,000 节点/10 活跃连接拟定验收：单键投影 P95≤16ms·P99≤50ms/事件循环延迟 P99≤50ms/保存屏障 P95≤1s·P99≤3s/冷开当前上限画布 P95≤3s——达不到降准入上限或优化粒度，数字不写成已兑现性能。

## 6. 片序与执行门（C-6）

| 片 | 内容 | 出口=用户确认点 |
|---|---|---|
| **-1 载体与原子准入** | §2 全部（版本门/载体协议 v2/世代三层 fencing/维护状态机/spool·内存表代际化/读侧完整性/串行窗口+准入/origin 契约+审计/保存屏障/manifest 契约冻结/基础 compact 调度/闩锁删除） | G1-G14+verify 全绿+世代切换演练——**世代切换首次执行前单独请用户确认（:163 执行门）** |
| **-2a 内容模型** | §3（Y.Text/XmlFragment 最小绑定/唯一创建者/完整重建序列化+schema→4/bounded undo/结构上限/时间轴真实迁移） | G15-G20+E61 fixture 语义比对绿 |
| **-2b exec 契约 v2** | §4（execSeq 守卫/服务器专写投影根/undo 边界/outbox 全状态/退款代际闭环） | G21-G27+kill 恢复锚 |
| **-3 门禁与预算** | §5（读者改道+字段删除同单元/E68 执法/断言族/E63/预算+Geometry 契约维持/E45/观测） | G28-G33 |

- 四片分别验收；**相互依赖的半成品不分别部署——批末一个完整 v4 发布单元**（无兼容读写/旧 spool 收养/存量双写；dev 库重建；运维脚本对生产环境默认拒绝 reset）。
- 回滚：测试部署可重建回旧测试版本；正式内容恢复走新世代（不把 DB 二进制降级+bundle 回退假称无损回滚——另修①检查点语义）。

## 7. 验收判据与先红门禁（v2——按片；全部记录测试载体/故意变红证据/修复提交）

**-1（G1-G14）**

| # | 门禁 | 先红 | 绿 |
|---|---|---|---|
| G1 | 载体迁移 | —（新表形+删旧列；additive 豁免登记=硬切批先例） | 迁移链+装载新读路径全绿 |
| G2 | appendSeq 前缀 | 旧无锁协议交错反例复现（A 取号未提交/B 先提交/compact/第三读者→遗漏） | 新协议前缀无缺口（交错用例 CI postgres） |
| G3 | compact CAS | 两 compact+append 三方交错：双快照/指针回退/孤儿行/增量误删任一 | 仅一快照发布/append 零丢/CAS 败零副作用/分类计数 |
| G4 | 世代 fencing | 旧代异步 append/spool/内部写换代后到达：现无 expectedGeneration=贴当前代 | 数据库原子拒绝+generation_fenced 计数 |
| G5 | 装载完整性 | 删增量整行 pending=null：前缀检测拒载；删指针行/改字节：分档 reason | 拒载+独立 reason+yjs_doc_incomplete_total+降级出口指路 |
| G6 | 元数据+段名 | 现状 isValidDocName 拒带段=红前置；错段/缺段连接放行=红 | 三层 fencing+4410 hardClose 携 g+单世代断言 |
| G7 | 4410 会话重建 | 现状 provider-only recovery（同 doc）=换代后旧历史并入=红 | 全 doc 拆卸+新会话+四维键结构性隔离+纠偏预算 |
| G8 | 静默投毒免疫 | 旧代 update 并入新代 doc（实验 D） | 并入结构性不可能（错代键≠新代键+三层 fencing） |
| G9 | 维护状态机 | 维护每步 kill：现无持久状态=人工猜测 | maintenanceId 恢复不重复换代不开放旧写；先阻生产者再排空步序断言 |
| G10 | 类型化重建 | encodeStateAsUpdate 形态（旧身份保留）=红；rebuild 非 Map 根降级=红 | manifest 全类型重建+语义等价断言（exec 内容级） |
| G11 | 闩锁删除回归 | Y1b §3.3 域任一红 | 全绿+census 零残留 |
| G12 | 原子准入 | 手工二进制写未知根/exec/替换父 map/DeleteSet 删受保护对象：现放行=红；部分过滤形态=红 | 整帧拒绝+close+诊断；服务器投影重传放行；候选态不变量验证；本地草稿+重提路径 |
| G13 | 保存屏障 | Sync ACK 后 PG 提交前 kill：界面称已保存+本地内容丢失=红 | 三档状态；marker 前后两次编辑/provider batching/重连/旧 nonce/delete-only 只确认前缀；spool 不冒充 PG |
| G14 | origin 契约+审计 | 表外 origin=红；服务端写零审计/有审计无内容=红 | 双侧断言+同事务审计+批次审计 |

**-2a（G15-G20）**：G15 纯文本并发（IME/粘贴/选区/两端同位插入）｜G16 富文本绑定（禁本地 history/快捷键归属/树有效性——现 HTML 整串=红）｜G17 唯一创建者（两副本同 key 并发=红→唯一+两字段均可见）｜G18 重建序列化全类型+语义 fixture｜G19 bounded undo+tryGc（退休可回收+100 项可恢复+祖先/redone 正确）｜G20 结构上限+文本泄漏格。
**-2b（G21-G27）**：G21 exec 专写根（客户端写 exec/undo 恢复带投影字段=准入拒）｜G22 三计数（同 execSeq eventVersion 单调/artifactRevision 独立/execSeq 优先）｜G23 undo 边界（A 删→B 完成/退款→A undo=无幽灵 loading 无免费交付）｜G24 outbox 全状态（kill/Redis 清空→恢复 30s 展示终态；materializing 不假 done；状态错配被修正）｜G25 退款代际（迟到退款遇 rearm 不误命中新代——expectedExecSeq）｜G26 节点恢复重投影（按 PG 三态）｜G27 attempts→execSeq 守卫切换回归。
**-3（G28-G33）**：G28 读者改道同单元（改道后删字段=全读者投影合成绿——broken reader 零）｜G29 E68 执法（缺口先红）｜G30 配额预留（两并发 confirm/完成素材重复 confirm=不过售不重计不删资产——基线 21 反例先红）｜G31 落盘幂等三层（同 intent 重试零重复 Media 零孤儿）｜G32 manifest 断言族（未分类字段红）｜G33 预算+Geometry 回归（契约维持验证）。

**发布门（批末，Z8）**：真实 PG 交错全组（G2-G5）+两浏览器换代+多标签 IDB delete blocked+kill 演练（维护每步）+10,000 节点/10 连接真实负载（投影/保存/事件循环/heap/压缩写放大——非无业务 marker soak）。

## 8. 非目标与移交

| 项 | 归属 |
|---|---|
| 「exec 整体出 doc」「全部结构操作命令化」 | **已裁定不采**（2026-10-23 用户收回——非修复正确性所必需） |
| 批注/高级富文本 | Y4（最小 Collaboration 绑定已前移 -2a） |
| 离线结构操作合并的拒绝语义验收 | Y5（边界已在本 spec §2.7 声明——Y5 不得以保留离线名义省略） |
| 快照恢复能力（增量保留/完整备份/K 份策略扩展/自动恢复/分层云归档） | Y6（本批保留=历史检查点语义——另修①） |
| compact 频率自适应 | Y6 |
| Geometry 契约调整 | 领域内依实测（本批维持——另修②） |
| z 序 UI | 后续批 |
| vacuum 自动回退 | 维持禁止（代际前提已由本批满足——Y2 行回填） |
| Y2 已登记两项观测 | Y2 不变 |
| 多实例/运维监控 | Y7 |

## 9. 纪律与观察项

- **最终原则**（用户终裁）：统一 Yjs 协作路径不新增无必要同步平面；PG 业务权威；doc 内受控投影与用户编辑/撤销/网络写权限**结构性隔离**。
- TDD 先红（每 G）；世代切换首演=执行门（:163）；四片出口=用户确认点一道不少。
- 禁垫片/禁版本分支兼容码（E61）；csv 消费一律 shared 单源（65accbe7）。
- 观察项：①行锁取号吞吐 vs 现 advisory lock（同量级串行——基准后定）；②串行窗口对 WS 事件循环压力（并发 1 重放起步）；③「几何已有 x/y 分键」报告主张 plan 期 census 复核（positionXY 拆键对象按实存复合字段）；④CollabLease FOR SHARE 短锁与现租约三入口的合成（Y0a-3 机制沿用）；⑤Tiptap 2 固定版 Collaboration 配置差异（禁照抄在线最新版）。
- 护栏自查：本 spec v2 ~330 行（表格化压缩）＜1500 行护栏——四片合并维持。

---

*版本确认：v1（2026-10-23 起草呈裁）→ **v2（2026-10-23 外审一轮+用户终裁 C-1~C-6+两收回+两修正——待用户评审）**。*
