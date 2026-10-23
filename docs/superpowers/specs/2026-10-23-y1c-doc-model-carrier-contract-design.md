<!-- doc-status: active -->
# Y1c：doc 模型 v3·载体与契约（B 类合并批设计——-1 载体 / -2a 内容模型 / -2b exec 契约 / -3 门禁预算）

- **立项**：2026-10-23，用户指令「Y1a+Y1b 完成，继续下一个任务」。按目录 §0.2 顺序节 B 类分组「Y1c 全批（-1+-2a+-2b+-3）」合并立项（:159）；四片分别验收、批末一个完整发布单元（§0.2-C6）。
- **唯一上游依据**：[2026-10-06-canvas-yjs-arch-upgrade-review.md](2026-10-06-canvas-yjs-arch-upgrade-review.md)（master v8.3）§0.2 Y1c 行（:145）+启动方式/执行门机制（:154-164）+§0.1 裁决（§0.1 内联）；Y0c spec 世代契约冻结（R0c-4/E68 形态/Z32/偏离 67）直采；Y1a/Y1b spec v14.3 移交行承接。
- **硬前置**（Y1c 行）：Y0a+Y0.5 迁移链——已满足。
- **门槛重申**（E39，不因合并变化）：上线门槛=0 号+Y0a+Y0b+Y0.5+Y1a+Y1b+（**Y1c-2 三项 exec v2 修订版/E26/Y.Text+XmlFragment 随上线批强制**）；Y1c-1/-3 收益为维护成本与模型完备性。
- **最终原则（用户 2026-10-23 终裁）**：统一 Yjs 协作路径，不新增无必要同步平面；PG 保持业务权威；doc 内允许受控投影，但**投影必须与用户编辑、撤销和网络写权限结构性隔离**。已有路线图不是不可修改的依据，但也不能在有更小、完整解法时无谓重建架构。

**修订链**：
- v1（2026-10-23）——首版合稿：三路一手核验+四片锚定+Z1-Z8 呈裁。
- v2（2026-10-23）——外审一轮（生产级评审报告，21 项承重主张全实证）+用户终裁 C-1~C-6+报告收回两项+另修两点：①报告实证 v1 四处设计错误（CAS/水位论证、写入时世代 fencing 缺失、identity≠重建、SV 三守卫违反 E42④）与六处基线过时全部修正；②用户裁定：C-1 exec 留 doc 但隔离撤销与写权限/C-2 不建全量命令系统但补原子准入/C-3 读者改道前移同单元/C-4 保存屏障随载体/C-5 最小富文本绑定前移 -2a（推翻 v1「HTML 串进 Y.Text 维持 LWW」自相矛盾推荐）/C-6 保留四片+批末单发布；③报告收回：「exec 必须整体出 doc」「全部结构操作必须命令化」非本项目修复正确性所必需；④另修：快照保留≠恢复能力（历史检查点语义）；Geometry 本批不推翻既有契约。§2/§3/§4 全面重写，§0.2 改定案表。
- **v3（2026-10-23）——外审二轮采纳（「Y1c-v2生产级架构复审报告」，代码基线 9350dfc1，R1-R12+B1-B20；四路并行验证承重主张全实证）+用户确认（§0.3 三项点头）**：方向保留（报告自证不推翻 C-1~C-6、不重提两项收回），缺口=「边界落到真实提交点/恢复点/副作用点」。①载体域提交点围栏——append/compact/维护/投影提交时核验 {owner,**捕获 leaseEpoch**,generation}（R1 同 owner ABA——DB 语句 owner-only 实证）；维护冻结加**受理截止点+可信批专用 drain 授权**（R2——v2 :158 SERVING-only 与 :178-179 drain 自相矛盾）；表形补 maintenanceId 族+**snapshot0 genesis**+复合指针 FK+missing/present/corrupt 三态（R12）；空画布保头升代（:182 收窄为初始切换/test reset 专用）；compact PK 冲突不折正常 miss+hash 非稳定 receipt（3.5）；**FK 约束级分类**（R10 全 23503=项目已删实证）。②准入域两半——服务器侧 **FrameGate 令牌跨到 native apply**（R4：afterHandleMessage 全仓零接线+y-protocols 吞错后假 ACK实证）+二进制权限按 struct 区间/DeleteSet/父链（4.3）+pending 因果 RESYNC_REQUIRED 分档（4.4）+唯一创建者允许 undo 重建 incarnation（4.5）；客户端侧**拒帧恢复操作协议** REJECTED/DIVERGED+同代 fresh doc+diverged 缓存隔离（R3——CRDT 合并单调性反例；复用已有 bootRecord.diverged 通路）。③exec 域收单源——**删 runtime snapshot/runtimeRevision 残留**（R11——doc.exec 单展示源，服务器重投影即追赶）；三计数组合规则=execution 数值序 (execSeq,eventVersion)+artifacts[stableSlot] 槽位独立按 rev+BigInt 禁字典序（R6）；outbox 演进事件类别+eventVersion+业务身份唯一（6.3）；投影 receipt 加 generation 维度（6.4）。④**受理层生命周期效果提取**（R5——原生帧 created/restored/deleted+引用增删在项目窗口提取，与内容增量/取消退款义务/审计 receipt 同 PG 事务提交后再 apply；poller 懒观察→原子裁定）；**全局锁序宣言=绑定契约**（§2.10）。⑤资源域先持久裁定再副作用——materializeRunId 终态裁定事务先于冲销（R7）；reservation 只终态释放+upperBoundBytes 真传入 fetch（R8）+对象 delete-claim+G31 改有界 orphan 目标。⑥**文档级保留协调**——RetentionCoordinator 统一多管理器 keep 并集+覆盖自动 GC+gcFilter 统一保护判定（R9 keep=布尔非计数+事务清理自动回收+现 gcFilter=()=>true 零保护三实证）。⑦基线纠偏——E60 providerVersion 采纳标记作废（P6 勘误+shared csv 精确门实证）；Z32 载体改元数据+有序首水合（buildDocStatus 无 schemaVersion+异步通告不能证明先于 SyncStep2 实证）。⑧B1-B20 并入四片（§7.2）；v4 破坏性发布流程+gate 扩在飞判据（§6）。

---

## 0.1 本批有效裁决（master 内联——E30 纪律：spec 自包含）

### 0.1a 载体系（Y1c-1 域）

| 编号 | 裁决（master 原文摘引） | 本批效力（v3） |
|---|---|---|
| E3 | generation 走合并前可见载体=docName `project:<id>#g<N>`（服务端按 DB 列校验）或鉴权握手返回；客户端建 provider/Y.Doc 前丢弃本地缓存（实验 D：老代 update 并入新 doc=静默投毒）；CanvasDoc 加 generation+revision 双列 | **修订采纳**：revision 水位语义由 GREATEST(revision,seq) 改为 **appendSeq 行锁内取号**（§2.2——v1 去锁方案有提交前缀缺口）；世代获取通道=**已有项目元数据**（project.service findById 已返回 collabGeneration，零新往返） |
| E23 | docName 世代 6 处连带+双校验+单世代断言；最小世代重建前移 Y1c（手工触发）；compact 守卫连续 3 败→世代重建出口；公开快照缓存键拼 generation | **修订采纳**：重建=类型化可见态导出全新 Y.Doc（§2.4——identity encodeStateAsUpdate 不换历史身份）；3 败出口=告警+关闭破坏性维护+人工重建仅对已证明完整源（Z4 定案） |
| E39 | Y1c-1=SCHEMA_VERSION+generation/revision+stateSeq+docName 世代通道+排空 runbook 补两步+世代重建命令与归档同批；内存表按 (projectId,generation) 精确清理 | 采纳（§2.4/§2.5）；归档语义按六-①修正：**快照保留=历史检查点非无损回滚保证**；drain 授权形态 v3 补（§2.4-R2） |
| E60 | 版本协商走 providerVersion；缺字段=拒连；docName#g<N> 只管世代，无需另造 REST/query 通道 | **修订（v3——报告 10.1 实证）**：providerVersion 为 4.6.0 库内部硬编码版本号与本协议无关（P6 勘误禁用——collab-protocol.ts:6）；版本门=**shared csv=CLIENT_PROTOCOL_VERSION 精确比较**（既有实现维持，不篡改不平行协商）；docName 段+元数据通道维持 |
| E61 | 世代切换=唯一 doc 迁移载体：停写→drain→导出可见态→纯函数变换→写新代快照→归档旧代→bump→客户端清缓存硬刷；禁「看版本分支」兼容码；空库=删行 vs 非空=迁移命令互斥判据；schemaVersion 门两档收敛 | **修订采纳**：导出可见态=**类型化 manifest 导出**（非 encodeStateAsUpdate）；互斥判据=**类型化可见态判定**（零增量≠空）且**空画布保头升代**（v3 修正——「删行重造」收窄为初始 v4 切换/test reset 专用，§2.4）；fixture=**语义比对** |
| E62 | CanvasDocSnapshot(projectId,revision,stateSeq,state) 追加式+CanvasDoc 指针；stateSeq=覆盖 maxSeq 仅决定增量读不承担守卫；compact 补分块/事务外重放/{timeout}/后台调度/自适应/监控 | **修订采纳**：Snapshot PK=**(projectId,generation,snapshotRev)**+stateHash；基础调度/事务外重放/超时/bloat 观测随 -1 上线（Z6）；自适应/分层归档留 Y6；v3 补 genesis/复合指针 FK（§2.2） |
| C7③ | 排空切换 runbook（停写→drain→reset→部署→强刷） | 采纳（§2.4 维护状态机收编；批末发布流程 §6 扩） |
| E20 移入项+**E42④** | E20 读侧守卫三处/装载降级出口/doc-incomplete 码移 Y1c-1；**E42④：SV 支配性=对账哨兵，非 compact 放行判据**；E42①：装载一致性=单 RR 事务覆盖快照+全增量；E42③：pendingStructs 只在「收到某行且时钟超前」产生，整行缺失不产生 | **按 E42 口径**（主判据=**RR+前缀连续性**，§2.6，SV 降哨兵）；v3 补：未解析因果禁入 live pending+RESYNC 分档（§2.7-c——4.4） |
| E45 移入项 | 准入 env 预留 enforcement 档（deny/LRU/RSS 软阈/字节上限/server-busy 码） | 采纳（-3） |

### 0.1b 内容系（Y1c-2a 域）

| 编号 | 裁决（master 原文摘引） | 本批效力（v3） |
|---|---|---|
| C8 | 文本只允许原地 splice；建好 Y.Text 后禁任何「整块替换 data/子 map」写入；Y1c 行扩 data 全键整块替换禁令 | 采纳；**载体分型（C-5 定案）**：纯文本=Y.Text；TextInputNode 富文本=**Y.XmlFragment+最小 Collaboration 绑定前移 -2a**（禁 StarterKit 本地 history+编辑器/画布撤销归属分界+Tiptap 2 固定版适配；批注/复杂富文本留 Y4） |
| E26+E33 | keep GC：释放被截断出栈项∧扣除仍被剩余栈项引用交集；E33②：struct 粒度 keep=false 禁 keepItem；回收唯一路径=客户端 doc 重建 | **修订（v2 探针实证 tryGc 可回收）**：单管理器 bounded-undo（100 项/4MiB）+非重入窗口精确 DeleteSet tryGc+版本钉死适配器；**v3 再修（R9）**：→**文档级 RetentionCoordinator**（多管理器 keep 并集+**覆盖自动 GC**+gcFilter 统一保护判定——keep=布尔非计数/事务清理自动 tryGcDeleteSet/现 gcFilter=()=>true 零保护三实证；C-5 引入编辑器管理器后单管理器视角不足；§3） |
| E27 | 嵌套类型唯一创建者；服务端对无权创建 key 一律 no-op 不建；门禁=创建者唯一性 census；用例=两 doc 并发同 key 写 exec 不同字段 merge 后只剩一支（今天红） | **修订**：**帧级整体拒绝取代 no-op**（部分应用破坏 CRDT 因果）；exec 域改整条 JSON 投影值原子替换（§4——嵌套 exec map 创建点连根消灭）；容器唯一创建；**v3 补（4.5）**：唯一创建者=每 node incarnation 一次性创建用户容器——**允许合法 undo 重建**（undo 复制内容生成新共享类型 Item 是 Yjs 机制；live incarnation 容器禁整体替换不变；§3） |
| Y0b-4 移交 | 单人文本泄漏格（结构上限）+单键 256KB 间隔门与整串覆盖拒绝语义重切（canApplyIntent 单一 seam） | 采纳（-2a；上限按字节计不分文本类型） |

### 0.1c exec 系（Y1c-2b 域）

| 编号 | 裁决（master 原文摘引） | 本批效力（v3） |
|---|---|---|
| E2 | attempt 维度+绑定裁定：客户端 deleteNode 同事务 exec.delete 与 exec 进 scope=[nodes,edges,exec] 必须同批；execView 断言收窄「只删不设」；origin 契约表进 Y1c | **绑定裁定修订（C-1 定案）**：**exec 不入 UndoManager scope；客户端 deleteNode 不直接删 exec**。实证：即使 data.fileId 是 server origin 写入，删除节点后 undo 仍把它作为恢复内容带回（trackedOrigins 不自动剔除被删子树里的服务器字段）——undo scope 绑定改写而非整体推翻同 doc 投影体系；execView 断言改「客户端对 exec 零写」（含 undo 恢复路径——准入门拦截） |
| E22 | attemptSeq 单调源=exec 内自增+写入门槛+执行门三态矩阵+撤销×exec 洞+已付费未交付退款+exec 不变量 | **单调源修订（C-1 定案）**：**PG execSeq=唯一执行序**（已在：全局单调+reserve/settle/void CAS 维度）；attempts 仅=重试计数；三计数分离：execSeq/eventVersion/artifactRevision（=NodeArtifact.rev）；doc 守卫改 execSeq 比对（现 applyWriteExecStatusToDoc 仍比对 attempts）；撤销×exec 洞/退款裁定/不变量⑤维持；**v3 补（R6）**：三计数确定组合规则+eventVersion PG 持久化同事务（§4） |
| E64 | PG 侧 outbox+五处吞错+done 语义反转；progress 永不入 exec；attempt 历史有界；装载后对账；kill 恢复 30s 必达 done | **修订采纳（基线更正）**：主路径已修（交付唯一 owner=ArtifactProjection 投影 poller+SUCCEEDED 防反转+AI 对象键 content-addressed）；本批延伸：loading/error/done 全状态走演进同一 outbox（**R11：展示唯一源=doc.exec，删 runtime snapshot 追赶**——v2 :243 残留清除；execAligned/data.status fallback 随读者迁移删除）；**内容等值 fast path 不得跳过状态修正**；kill 锚=「PG 已终态成功且产物可交付→恢复 30s 展示当前终态；materializing=真实物化中不伪造 done」 |

### 0.1d 门禁系（Y1c-3 域）

| 编号 | 裁决（master 原文摘引） | 本批效力（v3） |
|---|---|---|
| E17+E38 | manifest 四层 TS 单源派生断言族+第五层禁键；新字段未分类即红 | **冻结前移 -1**（C-6），断言族全量执法 -3；**v3 补（10.2）**：创建面与行为面同步——不预建无消费方空根，字段/type/creator/permission/Undo 归属/导入导出/引用扫描逐项消费、相关域入口当片执法（-2a 写错类型当片即红，非 -3 首次发现） |
| E30 | 字段冲突语义表（origin 契约表邻域+用户可见文档） | 采纳（-3；语义更新：exec=整条投影值原子替换·服务器专写/纯文本=字符级/富文本=XmlFragment/几何与 config=LWW） |
| E68 | 不变量五条三列；读侧全函数/写侧显式拒绝/禁修复写回 | 采纳（-3）；「合法维护命令级联删除=业务写非投影修复」边界澄清；强不变量在候选态验证+整帧拒绝（-1 串行窗） |
| D7+E33 | doc 字节预算+Geometry 帧写上限 | 采纳（-3）；**Geometry 既有契约本批不推翻（六-②）**；v3 补双负载验收（10.3——10k 短节点+8MiB 混合两约束独立） |
| E63 | 配额预留-结算+落盘幂等+defaultJobOptions 断言 | **修订采纳（基线更正）**：对象键已确定性；本批聚焦：外呼前原子预留（StorageAccount/StorageReservation）+幂等 confirm+超限拒只在预留期+孤儿 GC 闭环；**v3 补（R7/R8）**：materializeRunId 终态裁定先落 PG 再冲销+reservation 只终态释放（lease 超时仅转移责任）+upperBoundBytes 传入 fetch+对象 delete-claim（§4/§5） |
| 存量删除 | data.status/fileId 一次性删除（E17 写侧） | **时序修订（C-3 定案）**：全部读者改道与字段删除同发布单元（-3），不建双写过渡不留 broken reader；**v3 补（10.2）**：读者枚举扩全（binding/事实订阅/GC/复制粘贴/公开快照/执行输入——media-refs 现单扫 nodes.data 实证） |

### 0.1e 前批冻结契约与移交（直采）

| 项 | 内容 | 效力 |
|---|---|---|
| Y0c R0c-4 世代契约 | docName 语法+六连带+双校验+单世代断言；parseDocName 已收口；世代真源=DB 列；name≠列=独立拒因；spool 键世代作用域随 Y1c | 采纳（§2.3） |
| Y0c Z32 | 客户端 doc schema 门生产恒开随 #g<N> 一体评估 | **修订载体（v3——报告 10.1）**：主门=元数据通道（建 provider 前核 collabSchemaVersion）+服务器认证/装载双核；客户端首个 update 前断言（如需）走**有序首次水合路径**；doc-status 携 schema 仅观测/失效提示（buildDocStatus 现无该字段+异步 stateless 不能证明先于 SyncStep2 双实证） |
| Y0b-4 4410 | generation-superseded close code 已分配，消费归 Y1c-1 | 采纳（§2.3——须走 hardClose 主动关：4.6.0 auth catch 只发 PermissionDenied 不关连接实证） |
| Y1a/Y1b 移交 | 闩锁删除→-1（§3.3 resync 域，plan 期 census 定位）；SCHEMA=4→本批 | 采纳；**v3 补（R5/偏离 9）**：Y1b T15「node 删除观察=poller written:false 权威观察点」→受理层生命周期效果提取（§2.7-e） |
| Y1a/Y1b §6 :536 | vacuum 自动回退禁止；「client 回传最后已知 generation 服务端比对」前提由本批满足 | 采纳（Y2 行回填） |

---

## 0.2 裁决定案（2026-10-23 用户终裁——外审一轮收敛）

| # | 定案 |
|---|---|
| **C-1** | **exec 留同一 Y.Doc，但隔离撤销与写权限**。PG=业务真源；doc.exec=服务器专写持久投影（不可客户端改、不参与资金判断、不被用户撤销回滚）。落实：PG execSeq 唯一执行序+attempts=重试计数+eventVersion 同代推进+artifactRevision 独立保护 replace/clear（三计数不混）；exec[nodeId]=**整条不可分割 JSON 投影值**（单一服务端写者原子替换——消灭混合 attempt 与嵌套创建）；exec 不入 undo scope+客户端 deleteNode 不删 exec（删后读侧立即屏蔽+服务端幂等清理+恢复后按 PG 重投影）；**所有服务器产物投影字段移出用户可撤销的 nodes.data 子树**；loading/error/done 全状态延伸 PG outbox（内容等值不跳状态修正） |
| **C-2** | **不建全量命令系统，补齐原子准入**。检查二进制 struct/DeleteSet/父链/共享类型/创建权限/受保护根（非只看最终 JSON/禁键字符串）；服务器已确认投影历史重传放行、客户端**新增**受保护写入拒绝；**验证与实际 apply 共用项目级串行窗口，服务器投影写经同一入口**；强不变量在窗口内候选态验证、失败整帧拒绝（禁先污染后补偿）；拒绝内容不部分过滤不盲重发——独立本地草稿+冲突告知+重提路径。离线可编辑≠离线结构操作无条件接受（多端离线结构合并违反图约束=明确拒绝语义——本批即验基础行为，Y5 扩离线窗口）；少量强业务操作复用现有服务端结构入口，不新增命令总线/shadow 提交/补偿撤销体系 |
| **C-3** | **读者改道前移，与字段删除同发布单元**（-3）。不建双写过渡，不留 broken reader 给 Y2 |
| **C-4** | **保存屏障随载体落地**（-1）。synced/unsyncedChanges=0≠PG 已提交；屏障覆盖同连接此前已受理更新、等 PG、只确认对应前缀；spool 落盘不冒充 PG 保存成功 |
| **C-5** | **最小富文本绑定前移 -2a**。纯文本=Y.Text；现有 Tiptap 富文本=Y.XmlFragment+最小 Collaboration 绑定；禁重复本地 history+编辑器/画布快捷键撤销归属明确+配置适配 Tiptap 2 固定版。批注/复杂富文本留 Y4。（v1「HTML 串进 Y.Text 维持 LWW」推荐**推翻**） |
| **C-6** | **保留四片质量出口，批末一个完整发布单元**。不采用报告 A-D 新批次体系；-1→-2a→-2b→-3 分片验收；相互依赖半成品不分别部署；无用户数据，批末直接建设并发布 v4（不保留兼容读写/旧 spool 收养/存量双写） |
| **报告收回×2** | 「exec 必须整体出 doc」「全部结构操作必须命令化」非本项目修复正确性所必需 |
| **另修①** | **快照保留≠恢复能力**：当前代 2 份+最近两旧代各最终 1 份=合理起步保留策略，但仅凭旧快照无法恢复当前完整状态——声明为**历史检查点**语义；恢复能力归 Y6 |
| **另修②** | **Geometry 本批不推翻既有契约**：撤回「取消几何修复回写」（论证不足）；保留预算/手势保护/回归用例 |
| **Z1 落定** | csv→4 于 -1（协议面：docName 世代段+4410 hardClose+准入拒绝语义+装载门两档）；docSchema→4 于 -2a（内容变换同刻）；**master 中间态不部署**（批末单发布） |
| **Z2 落定** | 元数据先行（已有 project.service 通道，零新往返）；客户端检查 schema 后固定 {uid,pid,g,schema,sessionEpoch} 再建 IDB/Y.Doc/provider（携段名）；localStorage 非当前 g 真源；服务端认证/装载/append 三层核验（TOCTOU）；4410 仅处理竞态与真正换代（完整新会话——非仅换 provider）；同目标世代纠偏限一次+退避+总预算；合法 g 提示仅在登录/项目 ACL 通过后返回 |
| **Z3 落定** | 当前代 2 份+最近两旧代各 1 份（有界起步，另修①语义）；不回填不归档搬运存量 |
| **Z4 落定** | 连续 3 次不完整=告警+关闭破坏性维护+诊断；人工重建仅对已证明完整源执行；identity 命令不得作「修复」出口 |
| **Z5 落定** | origin 机制表+服务端可信 actor/command 审计**与内容 delta 同事务**；Origin.Server 无生产消费的客户端别名删、真正服务端写 origin 保留；per-user origin 不提前做（clientID/origin 非可信署名）；高频文本按批次审计连接/作者集合 |
| **Z6 落定** | 基础后台调度/事务外重放/显式超时/bloat 观测随 -1；自适应频率/分层归档留 Y6 |
| **Z7/Z8 落定** | 四片序维持；真实 PG 交错+两浏览器换代+kill 演练=发布门（§7），不以单测替代 |

## 0.3 v3 轮定案（2026-10-23 外审二轮采纳——用户确认）

| # | 定案 |
|---|---|
| **v3-1** | R1-R12+§3-§10 全采纳为 v3 修订依据（「Y1c-v2生产级架构复审报告」——四路代码验证承重主张全实证；与 C-1~C-6 零冲突、两项收回均被遵守；报告「确定方案，不新增待用户裁决项」立场照单核实后采纳） |
| **v3-2** | **R5 受理层生命周期提取**采纳：原生帧的生命周期效果（created/restored/deleted/引用增删）在项目窗口提取，与内容增量/取消退款义务/审计 receipt 同 PG 事务（§2.7-e）；**§2.10 全局锁序=绑定契约**（用户点头） |
| **v3-3** | **套餐降级不压缩既有 reservation**：既有承诺按冻结权利完成，新预留按新限制（用户点头） |
| **v3-4** | 保留预算起步值：单管理器 100 项/4MiB 上界+**文档级总预算 16MiB**（跨管理器同 struct 去重计费）——按目标压力实测调整（用户点头） |
| **v3-5** | B1-B20 并入四片门禁（§7.2 映射）——不另造批次流程；G1-G33 维持 |
| **v3-6** | **v3→v4 存量迁移器不做**：当前上线 v4 走测试环境重建；保留同 schema 类型化重建机器+语义 fixture，未来真实 schema 变化时再提供唯一对应 transformer，不预埋兼容读写 |

## 0.4 偏离登记表（滚动）

| # | 偏离 | 落地形态与依据 |
|---|---|---|
| 1 | E2 绑定裁定修订（exec 不入 undo scope/客户端不删 exec） | §0.2-C1 用户终裁；undo 恢复被删子树不剔除 server origin 字段（用户内存验证实证）——原绑定前提不成立 |
| 2 | E22 单调源修订（exec 内自增→PG execSeq+三计数） | §0.2-C1；doc 内计数受 undo/重建生命周期影响（undo 复活旧计数/重建归零→迟到写重获资格） |
| 3 | E27「no-op 不建」→帧级整体拒绝 | §0.2-C2；部分应用破坏 CRDT 因果 |
| 4 | E33②「回收唯一路径=重建」→tryGc 路径并存，再扩文档级 RetentionCoordinator+自动 GC 覆盖 | §0.1b E26 修订（v2 探针+R9 三实证） |
| 5 | E3 GREATEST 水位/E62 CAS 形态→appendSeq 行锁取号+短事务 CAS(generation,rev,epoch) | §2.2；v1 方案前缀缺口 |
| 6 | E61 导出载体→类型化 manifest 导出；fixture→语义比对 | §0.1a E61 修订 |
| 7 | E60 providerVersion 协商→shared csv 精确门 | §0.1a E60 修订（P6 勘误+报告 10.1 实证） |
| 8 | Y0c Z32 客户端 schema 门载体：docStatus 下行字段→元数据+有序首水合 | §0.1e Z32 修订（buildDocStatus 无字段+异步竞态实证） |
| 9 | Y1b T15「node 删除观察=poller written:false 权威观察点」→受理层生命周期效果提取+同事务义务 | §0.3 v3-2（R5——懒观察有 poller 盲区：删除与 finalize 竞态/义务无持久提交点） |
| 10 | E61「空库=删行重造」→空画布保头升代（删行重造收窄为初始 v4 切换/test reset 专用） | §2.4（报告 3.4——存续项目删头回 g0 复用旧历史命名空间；缓存键含 g） |

---

## 1. 基线快照（2026-10-23 一手核验；1.1/1.2=master c5fc6982+v2 修正；1.3=v3 轮 9350dfc1）

### 1.1 载体域

| # | 现状主张 | 亲验锚点 |
|---|---|---|
| 1 | csv=CLIENT_PROTOCOL_VERSION=3（T18 硬切 5ebdf6ce）；docSchema=CANVAS_DOC_SCHEMA_VERSION=3；协商四档 negotiateClientVersion | collab-protocol.ts:11,:14-28；docShape.ts:40；session-guard:147-148 |
| 2 | 装载版本门 null 行放行（E61 两档收敛对象） | collab-doc-registry.service.ts:387-397 |
| 3 | docName 无段；#g<N> 语法冻结未接线（isValidDocName 拒放带段名；isGenerationMismatch 备而未用）；注释 :13 表名笔误（canvasProject→应为 CanvasDoc） | doc-name.util.ts:16-45；客户端 canvasCollabRuntime.ts:1601 |
| 4 | **世代获取通道已在**：project.service findById 返回 collabGeneration/collabSchemaVersion/collabViewerUid（零新往返） | project.service.ts:87-108 |
| 5 | **客户端缓存四维键已含 generation**：`{DB_PREFIX}{uid}:{pid}:g{g}:s{schema}`；世代三元不完整=禁缓存+遥测 | local-cache-key.ts:24-25；canvasCollabRuntime.ts:1666-1677 |
| 6 | CanvasDoc=projectId 单行（state/stateSeq/generation/preVacuumSv?/schemaVersion）；CanvasDocUpdate=(projectId,seq) 唯一；无 revision/appendSeq/lifecycle 列、无 CanvasDocSnapshot；append 取号在项目 advisory lock 内（前缀完整性现状由锁保证） | schema.prisma:862-876,:897-906；canvas-doc-update.repository.ts:63-69 |
| 7 | 内存表全 projectId/documentName 单维键 | collab-persistence.service.ts:132-153；collab-doc-registry.service.ts:167-204 |
| 8 | compact 守卫=abandoned 语义；世代重建无 CLI；rebuildVacuumDoc 克隆覆盖有限：非 Map 根→null 降级；exec 等价断言只比键集合 | canvas-doc-update.repository.ts:272-275；collab-doc-registry.service.ts:628-662 |
| 9 | spool 完整（fsync/回灌/30s reconciler/关停 drain）；键无世代段；关停 drain 兜底=force-spool 落盘非落 PG | collab-spool.service.ts:49；collab.gateway.ts:756-778,:869-913 |
| 10 | **同步 ACK≠PG 保存**：readUpdate 内存应用后立即 writeSyncStatus(true)；stateless 回调不 await；auth 拒绝只发 PermissionDenied 不关连接 | MessageReceiver.ts:116-124,:241-280；ClientConnection.ts:517-557 |
| 11 | terminal recovery=provider-only 重建（同 doc 复用）——换代需全 doc 拆卸 | canvasCollabRuntime.ts:514-526 |
| 12 | origin：SERVER_TRANSACT_ORIGIN 单源+web Origin 枚举（trackedOrigins 仅 LocalUser）；无 origin 契约表/actor 审计；服务端写门面=CollabDocWriter 六 op/withSession | docShape.ts:51-56；canvasUndo.ts:11；collab-doc-writer.service.ts:197-226 |
| 13 | residency releaser 单项目档丢弃 tryRelease 结果（维护方拿不到类型化 quiesce 结果） | collab-residency.service.ts:166-175 |
| 14 | closeTeamDocuments 单代寻址；公开快照缓存键未拼 g | collab-session-guard.service.ts:1205；snapshot-doc-cache.ts:14-28 |

### 1.2 执行/产物域（v2 更正——Y1a/Y1b T13-T16+F1 已重写）

| # | 现状主张 | 亲验锚点 |
|---|---|---|
| 15 | **交付唯一 owner=ArtifactProjection 投影 poller**（worker 零 doc 写；data.{fileId|result}+exec done=deliverArtifact 复合 op 专写面）；SUCCEEDED 后残余异常=零退款零 error 投影（F1） | execution.service.ts:389-423,:455-459；projection-outbox.poller.ts:258-295 |
| 16 | **PG 执行代际已在**：GenerationIntent.execSeq BigInt @unique+NodeArtifact（权威=(sourceIntentRowId,execSeq,artifactIndex) 唯一；rev=CAS 锚=artifactRevision 现成载体）+ArtifactProjection（六终态 outbox；lease/runId） | schema.prisma:1074-1205 |
| 17 | AI 对象键已 content-addressed；finalize 资金 quota=软限 | artifact-commit.service.ts:23-24,:53-56 |
| 18 | doc 侧 exec 守卫仍比对 attempts（missing/older/terminal-superseded）——维度落后于 PG execSeq | collab-document.service.ts:307-325 |
| 19 | poller 内容等值 fast path：doc 当前值等值=跳 apply（含 exec 状态不修正的风险面） | projection-outbox.poller.ts:265-290 |
| 20 | rollback 族 CAS 仅 status 维度——无 expectedExecSeq/精确 ledger 行身份 | team-credit.service.ts:257-284 |
| 21 | 存储配额：getUsage=completed 之和；assertOnConfirm 超限→删 MinIO 对象+删 Media 行（重复 confirm 误删路径）；assertCanUpload 无锁 | storage-quota.service.ts:15-49 |
| 22 | TextInputNode=Tiptap（StarterKit+onUpdate getHTML 整串写 data.content） | TextInputNode.tsx:37-50 |
| 23 | yjs 13.6.32 库源：UndoManager clear 路径 keepItem(item,false)；Transaction 导出 tryGc+事务清理调 tryGcDeleteSet | UndoManager.js:43；Transaction.js:251,:325 |

### 1.3 二轮外审核验锚点（v3 轮一手核验=9350dfc1）

| # | 现状主张 | 亲验锚点 |
|---|---|---|
| 24 | 租约 DB 语句 owner-only（append/compact SQL 无 epoch 断言——同 owner 旧 epoch 在飞可通过）；flushDocument 入口有捕获 epoch 前置门但不覆盖 DB 语句与其余 store 路径（debounce/soft/断连/退避梯/drain） | canvas-doc-update.repository.ts:64-69,:248-249；collab-persistence.service.ts:495-498 |
| 25 | owner=进程生命周期常量；每次 acquire epoch+1；同进程失守重获=新 epoch（rejoin 同一 UPDATE） | collab-lease.service.ts:46,:158-163,:80-86 |
| 26 | raceDeadline=Promise.race+timer fallback 只让等待者超时（op 继续跑）；update 监听只 push 内存队列（无逐帧业务裁决） | collab-persistence.service.ts:85-87,:197-209 |
| 27 | FK 错误全量归类「项目已删」终态丢批（不区分约束） | pg-error.util.ts:4-7；collab-persistence.service.ts:356-365 |
| 28 | afterHandleMessage 全仓零接线（before hooks 仅四个）；y-protocols readUpdate 吞 apply 异常仅 console.error 不重抛 | collab-server.factory.ts:59-63；y-protocols/sync.js:82-89 |
| 29 | 物化 claim=时间 lease（无 runId 身份）；失败路径=读 lease 判归属→退款（事务外）→另一事务 CAS 置 failed（退款先于终态裁定） | materialize-job.service.ts:175-197,:441-482 |
| 30 | 下载字节上限=全局 env 常量（默认 2GiB），无 per-task upperBound 传入 | safe-remote-fetch.service.ts:91-94,:136,:154-161 |
| 31 | 媒体 GC=扫引用后直接 MinIO delete+行删，无 delete-claim/排他在飞写/finalize | media-gc.service.ts:113-194 |
| 32 | 投影 mark 只验 epoch/rev/runId 无文档 generation；flush 返回 FlushOutcome{persisted/retry/terminal} | projection-outbox.poller.ts:323,:364-373,:390 |
| 33 | 运行态展示三源回落（doc.exec→execAligned→data.status→idle） | execStatusView.ts:34-52 |
| 34 | ArtifactProjection 必选 artifactId+artifactRev、唯一键仅 artifact 维度（无 artifact 的 loading/error 无法落表）；全 schema 无 eventVersion 列 | schema.prisma:1186-1205 |
| 35 | keep=纯布尔非计数（一个 manager clear 释放全部）；事务清理自动 tryGcDeleteSet（尊重 keep）；服务端 gcFilter=()=>true 零保护（仅覆盖 Hocuspocus 托管 doc，独立 doc 无参构造） | Item.js:68-73；Transaction.js:321-327；collab-server.factory.ts:79 |
| 36 | pendingStructs/pendingDs 挂起待依赖到达自动重放（「无可见变化」≠空操作） | encoding.js:395-447 |
| 37 | diverged 持久通路已在（bootRecord.diverged→suppressCacheWrites/bootDiverged/exportDivergedContent/discardLocalDiverged）；incarnation 概念未有（新增） | canvasCollabRuntime.ts:1743-1761,:665-690 |
| 38 | 画布侧单 UndoManager（nodes+edges 双 scope 模块单例）；attach/detach/clear 调用点各一/三处 | canvasUndo.ts:25-31；canvasCollabRuntime.ts:1733,:2054,:600,:1771,:2011 |
| 39 | 破坏性发布不安全序：DROP/migrate 时旧 api/worker 在线（注释自证「安全性由 additive 锚承担非由顺序承担」）；gate 仅 own 四零、stranded 仅警告、storeInFlight 现成字段不进判据；无独立 daemon 进程（定时器在 api 角色内） | deploy.sh:134-159；gate-decision.mjs:15-35；collab-persistence.service.ts:563,571 |

---

## 2. Y1c-1 载体与原子准入（首片——全深）

### 2.1 版本两门口径（Z1）

csv→4（-1：docName 段+4410 hardClose+准入拒绝+装载门两档收敛——旧 bundle 走版本终态档 reload）；docSchema 维持 3 至 -2a 变换同刻升 4；master 中间态不部署（批末单发布，C-6）；双常量「协议/内容」独立语义注记进 docShape.ts 头注。**版本门载体（E60 修订）**：shared csv 精确比较维持（providerVersion=库内部版本号禁用——P6 勘误）；装载门两档：`schemaVersion===current ∨ 拒`（null=拒；服务端种子路径显式写值豁免）。

### 2.2 PG 载体协议 v3（appendSeq 行锁取号+世代内聚+提交点围栏）

**表形**（Prisma 迁移；dev 库硬切——additive 门禁按 Y1a/Y1b v11 先例登记豁免：spec 载明 reset runbook/无存量）：

- `CanvasDoc(projectId PK, generation, schemaVersion, lifecycle, currentSnapshotRev BigInt, appendSeq BigInt, maintenanceId?, maintenanceStage?, maintenanceError?, admissionCutoff BigInt?, maintenanceSourceGeneration?, maintenanceTargetGeneration?, targetSchemaVersion?)`——小型头部。**删 state/stateSeq/preVacuumSv 列**（职责分别由追加表/指针行/世代 fencing 承接）。maintenance 族字段随维护状态机（§2.4）；**重复维护命令只推进同一 operation，不二次加 generation**。
- `CanvasDocSnapshot(projectId, generation, snapshotRev BigInt, stateSeq BigInt, state, stateHash, schemaVersion, createdAt)`——`@@id([projectId,generation,snapshotRev])` 追加式（禁 UPDATE；DELETE 仅保留策略动作）。
- `CanvasDocUpdate(projectId, generation, seq BigInt, update, updateHash, createdAt)`——`@@id([projectId,generation,seq])` 只追加；哈希=字节校验/同代重复识别（不与业务幂等混同）。
- 序号全 BigInt，wire 十进制 string（**比较先解析 BigInt，禁字典序**——"10"<"9" 反例）。
- **genesis（R12）**：每个新项目/每新世代**原子创建 Snapshot(g,rev=0,stateSeq=0) 与头指针**（项目创建事务=CanvasProject+CanvasDoc 头+snapshot0+指针同一事务——project.service :45-79 原子种子先例扩展）；初始快照可有种子内容——**stateSeq=0=尚无后续增量≠可见态空**。快照 FK 只关联稳定 CanvasProject 身份（禁依赖会变化的头 generation）；头指针关联精确 (projectId,generation,snapshotRev)（数据库延迟检查复合指针 FK）；保留策略禁删当前指针引用行、限制级联路径。
- **缺头判别三态**：missing/present/corrupt 分档 reason——已创建项目应有原子种子头；缺头异常不得以 schema=null 或 generation=0 自愈掩盖（现 project.service :106 `?? 0` 回落修正）；真实创建只在明确种子入口。

**append（高频路径）**：短事务统一锁序——稳定读 CollabLease 行（**FOR SHARE** 短锁，阻止并发改 owner/epoch；takeover 用冲突锁；**禁 KEY SHARE**——不阻止非键列 UPDATE）→ 锁 CanvasDoc 行 → 验证 **{owner=捕获 owner ∧ epoch=捕获 leaseEpoch ∧ expectedGeneration ∧ lifecycle=SERVING}**（R1——同 owner 重获新 epoch 的 ABA：owner-only 检查放行实证）→ 去重（updateHash 活行优化）→ **appendSeq+1（行锁内取号，事务回滚连同回滚——提交前缀由构造保证）** → INSERT Update → 更新 appendSeq → COMMIT。**epoch 用已授权操作的捕获值，禁止到提交前才读「最新 epoch」替旧操作洗身份**；TTL 仅为接管时延，不入数据正确性门。**spool 恢复**：同代可信 spool 由新写尝试建立（捕获新租约+保留源批身份重新核验）；旧在飞调用不得随 mutable 当前 epoch 自动复活，旧代 payload 禁改贴新 generation。

**装载**：只读 RR 事务读头（generation,appendSeq=N,指针 R）→ 同代 Snapshot(R)（stateSeq=S）→ 读 S<seq<=N 全增量 → **检查顺序连续+数量=N-S+哈希校验** → 事务外 apply（重放失败=拒载不返回可编辑半文档）。首个可信 snapshot0+「每次 successor 覆盖完整提交前缀」=归纳证明；RR+连续后缀不能反证任意导入快照本就完整，hash 只证字节未损坏。SV/pendingStructs=附加 CRDT 诊断哨兵（E42④）。

**compact（基础调度随本片，Z6）**：RR 取快照 R+完整前缀至 N+拷贝数据退出事务→事务外（有界后台任务，worker thread 隔离+RSS 限制——非 async 包装即宣称不占 WS 事件循环）重放/编码/校验（显式 {timeout}）→短事务按同锁序**先比较 (generation,currentSnapshotRev=R,epoch,lifecycle) 全四元组，成功才 INSERT R+1**——两 compact 正常竞争不先撞 PK；**仍现 PK 冲突=事务回滚后按不变量异常/幂等重放实查分类**，不把所有唯一异常折成正常 CAS miss——**允许 appendSeq 已大于 N**→CAS 成功才 INSERT Snapshot(R+1)+指针前移+stateSeq=N+删实读同代行集；CAS 失败分类计数（conflict/not-owner/epoch/generation-changed/incomplete），不留孤儿快照不删增量。触发：1,000 行/2MiB/最老增量 60s；单项目最短间隔 30s；全局重放并发 1 起步。

**保存语义与 receipt（3.5）**：本批=**至少一次增量保存**——updateHash 作完整性/活行重复优化，**非稳定提交 receipt**（compact 删活增量后旧 hash 消失，同内容再灌获新 seq；重复 append 对 Yjs 无害但不声称返回原提交号）；保存屏障确认完整前缀（§2.8）；**需精确幂等的维护/原子生命周期批次/outbox 用独立 receipt 身份**（§2.7-e/§4），不因 compact 被删除。

**持久错误模型（R10）**：约束级判别（识别具体 constraint/table）——仅**确证项目 FK 缺失且 DB 确认 CanvasProject 不存在**才终态丢弃（splice 队列+计数）；内部 FK/快照悬空/世代错误/缺 maintenance 行=fail-closed 保留批次+告警；错误码与内容/维护/outbox 结果共享判别类型，禁一个 broad FK catch 吞所有问题（现 pg-error.util 全 23503=项目已删——新增 snapshot 指针/lifecycle/reservation/receipt 内部 FK 后必误丢，B4）。

**保留（Z3+另修①）**：当前代留最近 2 份+最近两旧代各最终 1 份（≤4/项目）；**=历史检查点语义，非无损回滚保证**。

### 2.3 世代通道与三层 fencing（E23 六连带+Z2）

1. **元数据先行（零新往返，通道已在）**：客户端取项目元数据（collabGeneration/collabSchemaVersion/viewerUid 已返回）→**检查 schema 匹配（客户端 schema 主门①——Z32 修订载体）**→固定 {uid,pid,g,schema,sessionEpoch}→再建 IDB/Y.Doc/provider（name=`project:<pid>#g<N>`——isValidDocName 谓词翻转为**要求段**）。localStorage 仅展示提示非真源。
2. **三层 fencing**：①认证（onAuthenticate：name 段 vs DB 列——**独立拒因走 hardClose 主动关**〔4.6.0 auth catch 只发 PermissionDenied 实证——复用 Y0b-3 close 单源机制〕+版本/世代验证，4410 携当前 g 仅在登录/ACL 通过后返回）；②装载（onLoadDocument 再核验）；③**append 原子验证三元组 {owner,epoch,expectedGeneration}+lifecycle**（§2.2——在飞 store/spool 回灌/内部写换代后晚到=数据库原子拒绝）。**断言任一时刻单世代可加载**。客户端首个 update 前断言（如需）走有序首次水合路径；doc-status 携 schema 仅观测/失效提示（异步 stateless 通告不能证明先于 SyncStep2——非安全屏障）。
3. **4410 消费端到端**：触发重新取元数据+**创建完整新会话**（停写→清旧重试→本地未确认日志写完→拆 observers/UndoManager/cache writer/provider→destroy 旧 doc→新 doc——非仅换 provider）；同目标世代纠偏限一次+退避+总次数预算（超预算=维护中终态）；缓存隔离=四维键结构性（purge 仅卫生；未获 PG 确认内容保留至 detached 恢复区）；二进制备份导入校验项目/世代/schema，跨代仅类型化导入禁 raw applyUpdate。
4. **六连带其余**：closeTeamDocuments 全世代寻址；withDoc/withSession 用当前世代名+docGeneration 随 g 失效重播种；spool 键加代（§2.5）；gate/e2e 装置世代感知。
5. **公开快照缓存键拼 generation**。

### 2.4 维护状态机与世代切换协议（E61+E23+C7③+R2）

**PG lifecycle+maintenanceId（§2.2 表形）**：SERVING→QUIESCING→DRAINED→REBUILDING→SERVING；maintenanceId 幂等/可观察/可继续——进程任一步 kill 后由持久状态决定继续/中止。

**受理截止点（R2）**：在项目串行入口内关闭新受理，**记录冻结截止序/可信批次边界（服务端产生——不信客户端时间或裸 seq）**，然后进入 QUIESCING。普通新写一律拒绝；**只有冻结前已受理且归属当前 g 的批次，可持 maintenanceId 经专用 drain 写入**（drain 授权档=.lifecycle=QUIESCING ∧ maintenanceId 匹配 ∧ 批次截止点前——append 主档 SERVING-only 与 drain 通路自洽，v2 自相矛盾消除）。

步序（**先阻新生产者，再排空，不先禁 drain**）：
①项目级停收新写+暂停任务 claim（已飞外部任务保留 PG）→②旧连接只读，等待在应用/写入结束→③flush pending+回灌当前代 spool 落 PG（经 drain 授权档）→**DRAINED 六条件证明**：pending=0 ∧ 当代 spool=0 ∧ 受理在飞=0 ∧ **真实 append Promise/PG 事务结束**（非 Promise.race fallback——raceDeadline 只让等待者超时 op 仍跑实证）∧ 项目写窗口空闲 ∧ 投影生产者已暂停/移交；**超时=未排空保持封闭**，不销毁 doc 不发布新代；releaser 返回值类型化修复（基线 13）→④关闭旧连接卸载，基于已提交一致快照**按 manifest 类型化导出可见态**（非 encodeStateAsUpdate）→⑤纯函数变换 transform（-1=identity；-2a=v3→v4 内容变换；fixture=语义比对）→⑥全新 Y.Doc 按 manifest 重建（Y.Map/Y.Text/Y.Array/Y.XmlFragment 全类型）+同短事务封存旧代最终快照+**写新代头+snapshot0（genesis，§2.2）**+清旧代增量（仅归档与覆盖证明成立后）→⑦精确清旧代内存键（§2.5）恢复受理→⑧客户端 4410→重取元数据→新会话（§2.3-3）。

- **维护窗口纪律**：维护开始后禁并行 compact；已有后台计算结果在发布处仍检查 lifecycle/maintenanceId/generation（不允许 appendSeq>N 借维护窗口闯入）。
- **世代重建命令**：`pnpm collab:rebuild-gen <projectId>`（与归档同机）；REST vacuum 端点收编为同协议服务面。
- **互斥判据（类型化可见态判定+偏离 10）**：**初始 v4 切换与 test reset**（dev 整库 reset 与在线单项目维护完全分开）可走删行重造（reset-canvas-schema.mjs 先例）；**存续项目即使可见内容为空也保留头并建立更高 generation**（仅新项目身份从 0 开始——删头回 g0 复用旧历史命名空间，缓存键含 g）；项目物理删除=独立生命周期，非维护命令空内容分支。禁「零增量=空」判据。
- **compact 3 败出口（Z4）**：连续 3 次不完整=告警+关闭破坏性维护+诊断；人工重建仅对已证明完整源；identity 不作修复出口。
- **排空切换 runbook**（C7③）：停写→drain→归档→换代→部署→强刷，进 collab-ops-runbook.md；dev 演练+首次部署各一遍（Z8）。
- **禁「看版本分支」兼容代码**（E61 铁律）：旧数据只经协议⑤变换进新代。**v3→v4 存量迁移器不做**（v3-6）。

### 2.5 spool 键世代作用域+内存表精确清理（E39）

spool 段键 `${projectId}.g${N}.${segSeq}.spool`；replayAll 只收养当前代段；错代段=quarantine+计数；换代③步后旧代段必空——残留=告警。内存表键统一升维（documentName 含段或 (projectId,generation) 复合）：pendingQueues/pendingSince/lastCompactAt/storeFailedDocs/persistUnhealthy/persistRetry/vacuumingDocs/preVacuumSvCache/docResidue/docStatusRev——换代⑦步按 (projectId,generation) 精确清理（docEpoch=WeakMap 随实例释放）。

### 2.6 读侧完整性与降级出口（E20 移入项按 E42④ 口径）

**前缀连续性三守卫**（主判据）+SV 哨兵：①装载组装后判（前缀连续+哈希+指针存在——「有头指针悬空」独立 reason=snapshot-missing）；②readCanvas 服务端读出口同判据拒绝+独立 reason；③compact 发布前判（构建态前缀完整性预检）。指标 yjs_doc_incomplete_total{reason}；**装载降级出口**：拒载≠永久卡死——doc-incomplete 档+admin 告警+runbook 指路 §2.4；delete-only 延期数据编码语义保留；**未解析因果数据不得在可见态重建中静默丢弃**（§2.7-c 分档处理）。

### 2.7 原子准入（C-2）+串行窗口+拒帧恢复+生命周期受理（Z5+R3/R4/R5）

**(a) 串行窗口与 FrameGate 生命周期（R4）**：验证与实际 apply 共用项目级串行窗口；**服务器投影写/维护发布/节点恢复投影同用入口**。固定版本 CollabFrameGate 在 **beforeSync 获取项目+世代令牌**→执行原始权限及候选验证→**持令牌直到 actual apply/同步 update 事件处理结束**→**afterHandleMessage 幂等、令牌匹配地释放**（现全仓零接线——factory :60-62 补线）。异常边界（4.6.0 源码钉死）：beforeSync 抛错经 receiver finally（afterHandle 仍执行）；**beforeHandleMessage 抛错不经该 finally——取得资源后失败必须自释放**（两种边界不混用）；写回调必须同步（transactSync Promise 检测实证——检测到 Promise 时 struct 已写入不可回滚）。**接收处显式失败边界**：y-protocols readUpdate 吞 apply 异常仅 console.error（sync.js:82-89 实证）→帧接收边界提供**重抛式错误处理**、成功后才发协议 ACK；**同步广播在帧受理成功前受控**，不提前向其他副本发布半成品；**广播只传播 authoritative doc 实际整合产生的有效 update**，不裸广播未经语义确认的输入帧。**PG 已提交而 live apply/observer 失败→隔离并重载共享项目文档及全部相关连接**（非仅报错客户端——共享文档完整性优先）；任何持久保存屏障不确认失败实例。依赖边界改动以固定版本源码适配+上游修复留证，禁运行时 monkeypatch 私有方法。

**(b) 候选验证基底与二进制权限（4.2/4.3）**：候选验证采用**当前 authoritative doc 的二进制历史副本** apply 候选帧（非维护时可见态 fresh rebuild——struct/parent/删除因果不匹配；candidate 临时历史实例=明确安全基础设施，非 live doc 回滚垫片）。检查面：已存在 struct 区间/重叠区间/新尾部/已删 DeleteSet 区间/新发生删除/explicit parent 与 origin·rightOrigin 推导父归属；已确认 no-op 的服务器投影历史重传放行（**clientID/clock 非可信签名**——伪造 old ID 不授权新尾部）；新受保护根写/父容器替换/隐藏败选写/仍 live 受保护 struct 删除均拒（**非只检查最终 JSON 暂时不变**）；服务端 GC 后不保证保留原 parent 内容→服务器写入域区间/provenance 与快照同步持久化；无法辨明 ancestry 不以「已知 clientID」豁免。**成本纪律（10.3）**：candidate 历史拷贝/权限解析不每击键全 doc encode——固定上限+结构分域索引+实际受影响集合增量验证；完整校验仅冷启/维护/定期自检；worker thread 隔离+RSS 限制。

**(c) 未解析因果（4.4）**：U2 在 U1 前到达时候选可见态可能无变化而 pendingStructs/pendingDs 留内容，U1 后到自动激活（encoding.js 实证）——**无变化≠合法空操作，也非自动恶意**。本批不建复杂因果等待队列：候选帧无法完成父域/因果授权=**禁入 live doc pending**，发可重试 **RESYNC_REQUIRED**+关闭本连接（保留合法未确认编辑，要求完整依赖重同步；限重试/帧历史字节/时间，超限明确失败）。分档：clean 缓存可提供完整同代状态补依赖；**已判业务/权限违规的 diverged 缓存只走语义 rebase 禁 raw merge**；native 接收/保存 ACK 不把未授权 pending 算作成功。

**(d) 拒帧恢复协议（R3——C-2「草稿+重提」的操作化）**：被业务/权限拒绝且本地已整合的更新使实例进 REJECTED/DIVERGED：①停上传与自动重试，未获持久确认内容存**独立草稿**（记 reason/generation/客户端会话/本地 edit watermark）；②IndexedDB **持久 diverged 标记**+同项目同代标签页通知；缓存写入/回放以 **incarnation/version fence**（新增）防旧 tab 覆盖正常缓存——**复用已有 bootRecord.diverged 通路**（suppressCacheWrites/bootDiverged/exportDivergedContent/discardLocalDiverged 实证）不造第二逃生框架；③拆 provider/observers/UndoManager/cache writer，**同服务器 generation 创建 authoritative fresh Y.Doc**——**禁 apply 被拒绝的 raw snapshot/update**（CRDT 合并单调性反例：重同步服务器完整态不清除本地已整合历史，双方 pending 均空仍分叉）；④向用户展示选择的语义差异，基于 fresh 态以**新 struct 身份**重新生成允许的编辑；未选草稿留 detached 区不自动全量再投；⑤重建完成或明确放弃后才切换本地正常缓存 incarnation。不因单客户端冲突全体项目换 generation；**不复用 provider-only recovery**（:514-526 同 doc 复用形态）。强不变量与离线并发非合并闭包（删节点 vs 对端新建引用边/相向 reparent 各自合法合并违规）——**服务器整帧拒绝+同代 rebase 真实演练本批完成**（B6），Y5 只扩离线窗口。

**(e) 生命周期效果受理接口（R5——接口 -1 定义、闭环 -2b；偏离 9）**：在项目窗口内比较 authoritative 前态与候选后态，**提取 created/restored/deleted 节点身份+引用增删+必要可交付状态变化**；PG NodeLifecycle/DeliveryFence 只存版本/存在删除/业务围栏（**不复制完整节点内容为第二真源**）。带生命周期效果的整帧：先 flush 其依赖的此前已受理增量→**同一 PG 事务**：append 有效内容增量+生命周期/引用准入结果+取消与退款义务+同批审计/receipt（§2.7-f）→native apply 到 live doc→广播。**PG 失败不 apply 不广播不 ACK**；PG 成功 live apply 失败按 (a) 隔离重载；**commit token 防 update listener 二次排队**；receipt 支持整帧重试幂等。finalize/交付在事务中核对 NodeLifecycle/DeliveryFence；取消外部任务与实际冲销可异步执行，**义务一旦提交不能消失**。**删除围栏持久提交即取消该执行段节点交付**；恢复节点允许新 execSeq 不解除旧段取消/退款；并发 finalize 先提交→删除流程依同锁序（§2.10）登记已完成段交付撤销/退款义务（保留证据，不凭 poller 瞬时缺节点裁定）。**新媒体引用同事务核验 Media 未入删除 claim**（§5 GC 互锁——GC 不删刚 ACK 进 doc 的引用对象）。普通文本/几何叶子帧**保留现批写与 durable marker**（不每击键强制跨业务表事务）；不增加命令总线、补偿撤销或第二内容协议。

**(f) origin 契约与审计（Z5）**：origin 机制表（TS 单源，shared）：`{writer, origin, trackedOrigins, undoScope, projectionRebuild}`——本地机制记录（用户/编辑器 binding/UndoManager/provider·connection/服务端命令/维护）；断言=写事务 origin∈表内枚举（api+web 双侧）；Origin.Server 无生产消费的客户端别名删、服务端写 origin 保留。**DocWriteAudit（append-only）**：`{id,projectId,generation,actor,command,origin,nodeId?,meta,createdAt}`——服务端可信 actor+command 与内容 delta/receipt **同事务**（有审计无内容/有内容无审计皆禁）；高频文本按批次审计连接/作者集合。

**闩锁删除**：Y1b §3.3 resync 闩锁——plan 期 census 定位删除+Y1b 只读域回归全绿（G11）。

### 2.8 保存屏障（C-4）

- **三档保存状态**：本地修改/同步中→服务器已接收待保存→已保存到服务器（synced∧unsyncedChanges=0 只到第二档——库源实证 ACK 在内存应用后即发）；spool fsync=本机故障保护已写，不冒充 PG。
- **同连接有序 marker**：客户端先 provider.flushPendingUpdates()→同连接发 save-barrier（nonce+sessionEpoch+generation+本地 edit watermark）→服务端在**被 await 的有序入口**识别 marker（stateless 回调不 await 实证）→捕获此前所有已受理更新的项目前缀→等该前缀进 PG→回 (nonce,g,committedSeq)。
- 回执只清 marker 之前 dirty；跨连接/旧 provider/旧 generation 迟到 ACK 无效；**连接曾拒帧=屏障不可成功**；断线后新 nonce 重发；delete-only update 同经 marker 序列；PG 批写 ~3s 上界保留但屏障前不对用户宣布已保存；保存/执行/离页可触发提前 flush。**屏障不确认失败实例**（§2.7-a）。
- 本地 IDB append 以事务 complete 为成功；日志 GC 只删已覆盖且已确认记录。

### 2.9 manifest 契约冻结前移（C-6→-1+10.2）

四层 manifest TS 单源在 -1 冻结为契约（E17+E38 形态）：顶层 map 集合/嵌套类型唯一创建者/每键写入者与读者/归属+撤销 scope+禁键（progress/viewport/selection/hover/drag）；**创建面与行为面同步**：不预建无消费方的 meta/threads/时间轴空根；字段/type/creator/permission/Undo 归属/导入导出/引用扫描与 PG 投影关系**逐项消费**；相关域入口当片执法（-2a 写错类型当片即红）；**nodes.data 键分类含「服务器投影字段（迁出→exec）/用户可编辑引用（保留）」二分**（C-1）；schema 创建/projection/导入导出/静态门禁从此消费；**新字段未分类构建红**（-1 即生效）；断言族行为门全量执法 -3。**读者面全枚举进基线**：data.fileId/status 读者 census（27 处/14 文件）+binding/事实订阅/GC/复制粘贴/公开快照/执行输入（media-refs 现单扫 nodes.data——fileId/result 迁移后不改即误判无引用）+snapshot-filter util:133 写者。

### 2.10 全局锁序契约（v3-2——绑定契约）

**统一锁序（claim/finalize/退款/物化/删除/配额/GC/维护/准入全部按此核对与迁移；同层多行按稳定主键排序；某路径仅取所需子集，禁反向取得此前层级；PG 事务禁先持资金/媒体锁再等项目窗口——统一「项目受理排程→必要前置 flush→数据库锁→提交→同步 apply」）**：

CollabLease SHARE → TeamBalance → StorageAccount → NodeLifecycle/DeliveryFence → GenerationIntent → StorageReservation → CanvasDoc → NodeArtifact 稳定槽位 → Media/ObjectManifest → outbox/receipt。

保留既有 TeamBalance→GenerationIntent 方向（Y1b）；不以「局部用了事务」证明无死锁——交错验收=B5/B12（§7.2）。

---

## 3. Y1c-2a 内容模型（C-5 定案版+R9）

- **文本分型（现在分清）**：纯文本域=Y.Text 直接 delta/splice（禁每键整串覆盖/全串 diff 绕行——canApplyIntent 单一 seam）；中文 IME composition/粘贴/选区/两端同位置插入独立验收。**TextInputNode 富文本=Y.XmlFragment+最小 Collaboration 绑定（前移本片）**：禁用 StarterKit 本地 history、编辑器与画布 UndoManager 快捷键归属分界（文本焦点内 Ctrl+Z=编辑器协作历史）、配置适配 Tiptap 2 固定版；格式化 HTML 仅渲染/导出非合并真源；批注/高级富文本留 Y4。**用户 content 与 generated result 不合并**（result=PG 产物走 exec 投影，§4）。
- **唯一创建者（E27 修订+4.5）**：节点与 data/文本容器在结构创建时一次性创建，叶子写者只取现有实例；**新建/恢复 node incarnation 可一次性创建其用户容器——允许合法 undo 重建**（Yjs undo 删除节点时复制内容生成新共享类型 Item 是机制本身）；**live incarnation 的容器不得整体替换**；服务端投影不在该子树（恢复不得夹带服务器字段——准入层拦）；引用/parent 校验仍适用，不信任客户端「这是 undo」声明；census 门禁+用例先红：两副本并发同 key 建容器→旧路径只剩一支（红），新路径创建者唯一+两后续字段修改均可见（绿）+undo 重建合法（B10）。
- **完整重建序列化（E61 消费）**：类型化导出/重建覆盖 Y.Text/Y.Array/Y.XmlFragment 全类型；v3→v4 纯函数变换+**schema→4 与变换同刻**（Z1）；fixture=语义比对（canonical 可见语义/类型/稳定 ID/引用/排序）。
- **bounded undo+文档级保留协调（E26+E33 修订+R9）**：
  - **RetentionCoordinator（文档级）**：统一登记画布管理器+每个编辑器管理器的 undo/redo/当前 popped item/redone 与祖先依赖；协调清栈/redo 自动清空/编辑器关闭/项目退出；**GC 前重新建立所有有效管理器保护并集，仅退休集合解除 keep**；各入口不得直接 um.clear()/destroy() 后自行 GC——必须交协调器；未注册新管理器不自动启用回收；**祖先保护=闭包**（非仅同 clock 区间相减；适配器显式建立祖先闭包——仅对 keep=true 子项调 keepItem(true) 不修复已 false 祖先）。
  - **覆盖自动 GC**：事务清理即跑 tryGcDeleteSet（Transaction.js 实证）——保护并集在原生栈变更后、自动 GC 前**同步更新**；**gcFilter 与显式 tryGc 同一保护判定**（现 gcFilter=()=>true 零保护实证替换）；保护索引失效且无法同步证明=**fail-closed 保留**（不先释放后等下一 idle 重新保护）。
  - **预算（v3-4）**：100 项/4MiB=单管理器上界；**文档级总保留预算 16MiB 起步**（跨管理器同 struct 去重计费，不把全量 encode 字节当 retained payload 精确计量）；超限按**明确历史过期策略**退休最旧记录，不隐式清所有历史。
  - Yjs 与协作 binding 固定版本；释放与 tryGc 仅非重入窗口；版本钉死适配器禁散调；验收=退休结构内容可回收+有效历史可恢复+GC 后字节不含退休负载（tombstone metadata 另计）+**多管理器互不破坏**（B16：清一个/关编辑器/自动 redo 清栈后其他有效历史仍恢复；tryGc 不破坏 active/popped 祖先）。原生 Yjs undo 依赖删除内容留存（Yjs 机制本身），非补偿命令语义。
  - 常规 GC 不销毁 provider/Y.Doc 不清剩余历史（世代维护/项目切换/显式清撤销=历史重置边界，前置=PG 保存屏障+本地写完成）。
- **单人文本泄漏格**（Y0b-4 移交）：结构上限（节点数/data 字节/文本长度——按字节计不分类型）+单键 256KB 间隔门重切。
- **时间轴域**：真实消费的 VideoProject.data 读写同步迁移（不放空根宣称完成）；PG 衍生产物 cells 不重复入 doc 成第二真源；未迁移功能保留原真源禁双写；复杂高级功能留原唯一源不建空新根。
- **typed draft rebase**：§2.7-d 拒帧恢复的草稿重生成消费端（结构/文本类型化）在本片落地。

## 4. Y1c-2b exec 契约 v3（C-1 定案版+R6/R7/R11/6.3/6.4）

- **doc.exec=服务器专写持久投影根（受保护根——准入层拒客户端写，含 undo 恢复路径）**：
  - `exec[nodeId]`=**整条不可分 JSON 投影值，单一服务端写者原子替换**（Y.Map 值整体 set——无嵌套共享类型=并发创建点连根消灭+无混合 attempt 字段）；**内部责任分开组合（R6）**：
    - `execution={intentId,execSeq,eventVersion,status,error,deliveryState,…}`——按数值 **(execSeq,eventVersion) 排序**取当前（旧任务迟到完成不复活任何槽位）；
    - `artifacts[stableSlot]={artifactRevision,mediaId/resultText,state,sourceExecSeq,…}`——**每槽位独立按 PG rev 选择当前（空值/clear 也具有版本）**：旧任务整条覆盖不复活用户已 clear 的产物；新任务 loading 不吞掉仍被选择的上一产物（两反例均封死，B13）。
  - **展示唯一源=doc.exec（R11）**：冷装载在首轮权威 Sync 前，服务器将 PG 当前运行态对账回 doc；重连/恢复节点/换代后同样由服务器重投影；**客户端不合并另一份运行态快照**（v2「runtime snapshot 按 runtimeRevision 追赶」残留删除——服务器重投影即追赶）；stateless 仅可丢 wake-up/progress 提示，不承担状态真实性；**execAligned 与 data.status fallback 随读者迁移删除（-3）**；公开快照读取同一合成投影；媒体事实保留既有独立事实通道，不争夺 exec 真源。
  - **单一 dispatcher**：事件=「需刷新当前态」的可靠通知，读取**同一 PG 快照**里的当前 execution 与全部当前槽位；提交投影 delta 时锁/CAS 核对 **GI 代际+eventVersion+每槽位 rev+节点围栏+doc g/epoch+outbox runId**（读取 RR 一致≠提交仍有效——commit-time fence 必在）；有界传播 lag 允许，**旧任务不得重新覆盖已发布到 doc 的较新 execution/slot**；更高完整投影版本仅控制整条 doc 值的发布顺序，不替代各业务维度真源。
  - **exec 不入 UndoManager scope；客户端 deleteNode 不删 exec**；节点删除→读侧立即屏蔽（不变量⑤读侧全函数；**读侧先检查 node 存在，后取 exec——孤儿 exec 不独立为真**）+服务端幂等清理；节点恢复→按 PG 当前执行/交付/退款状态重投影（alignExecFromIntents 族）——已退款显示「已取消需重新生成」/在飞未取消=真实 loading/已完成未撤销交付=合法产物；**禁幽灵 loading 复活与免费重跑已退款生成**。
  - **所有服务器产物投影字段移出 nodes.data 子树**（fileId/result/status 迁 exec 投影）；用户上传素材选择等可编辑引用按 manifest 分类保留；用户 content 与 generated result 不合并（§3）。
- **PG 唯一执行序与三计数（E22 修订+R6）**：execSeq=执行代际（claim/rearm）；attempts=免费重试计数；eventVersion=同代 loading/done/error 推进——**在 PG 真正持久化（状态更新与 version++/outbox 同事务）**；artifactRevision=NodeArtifact.rev（独立保护用户 replace/clear）。doc 守卫改 execSeq 比对+stale 写计数；执行门三态矩阵维持+未知 nodeId/零可执行显式拒。
- **outbox 延伸（E64 修订+6.3）**：**演进同一 outbox，不并行造队列**——ArtifactProjection 扩：事件类别+eventId+intentRowId/execSeq/eventVersion+可选 artifactId/rev+可选生命周期围栏身份+claim runId/state+投影 generation/receipt；**artifact 事件保留自身唯一性；运行态事件以业务身份唯一**（现表必选 artifactId+artifactRev——无 artifact 的 loading/error 无法落表，实证修正）；状态转移历史在 PG 留证；dispatcher 可按节点合并刷新当前态，不必保证用户看见每个瞬时 loading。coalescing pending 行：mark/清 pending 条件匹配捕获版本（新事件投递中到达不被旧 mark 清掉）；**消费幂等≠投影存在**（同一业务版本仍修复缺失/错误 doc.exec）；claim 带 runId/leaseUntil，完成标记验证 runId+期望状态+目标修订号；**内容等值 fast path 不跳状态修正**（基线 19）；jobId=eventId 或 intent+execSeq+eventVersion 非冒号分隔；kill 锚维持（PG 终态成功且产物可交付→恢复 30s 展示当前终态；materializing=真实物化中）。
- **换代与恢复重投影（6.4）**：投影尝试固定当前 g；flush 返回 {g,committedSeq}，mark 条件验证该 g+runId/状态（**代变返回 pending，不消耗失败次数**——现 mark 无 generation 维度实证修正）；换代重建优先复制用户可见内容，**exec 从当前 PG 派生再验证**（旧 exec 非业务真源不照搬）；旧世代事件已 marked projected 不免除新代对账——cold load 和 restoration **主动刷新所有相关条目**（不仅选 legacy loading 且 exec 缺失节点）。
- **退款代际闭环+物化 run fence（C-1+R5/R7）**：rollback 族全 API 补 **expectedExecSeq+精确 ledger 行身份**（现 CAS 仅 status 维度）；删除围栏=受理层持久提交（§2.7-e——B11/B12）；provider 不可取消→orphaned/discarded 显式状态+退款指向确切 execSeq 与原 settle ledger 行；**物化 run fence（R7）**：claim 为每次物化创建明确 materializeRunId/epoch（leaseUntil 只控制接管时间——现时间 lease 无身份实证）；**终态失败事务同时校验 runId+status+execSeq+产物身份，持久写失败裁定与精确 RefundObligation——只有裁定赢者可安排冲销**（现退款先于终态 CAS 且不同事务=旧 run 读通过后新 run 接管完成、旧 run 仍退款的竞态封死，B17）；完成事务用相同 run fence 和终态互斥条件；退款异步重试引用 exact settle row+幂等 reversesId，失败不漏义务；**不在 CAS 终态前退款**。第三方 provider 无幂等时不承诺跨 provider exactly-once（提交前 requestId/提交后 taskId/超时 query-first·UNKNOWN 人工可见不自动重复付费 submit）。

## 5. Y1c-3 门禁与预算（R8+10.2/10.3）

- **读者改道与字段删除同单元（C-3+10.2）**：图像完成判断/工作流素材/媒体引用/复制粘贴/公开快照/binding/事实订阅/GC/执行输入**全部读者**改道投影合成→删旧持久化字段+写者+fallback（E17 写侧）——**无双写过渡无 broken reader**；时间轴按消费者真实迁移；media-refs collector 随迁（现单扫 nodes.data）。
- **E68 不变量执法**：五条三列落地；读侧全函数/写侧显式拒绝（业务错误码禁丢帧禁静默跳过）/禁修复写回；「合法维护命令级联删除=业务写非投影修复」；普通删除后远端视图按确定规则屏蔽悬空引用；execute topology 数量断言。
- **manifest 断言族全量**（-1 冻结契约的执法）：新字段未分类红+二进制授权/父容器替换/跨代 replay/未知类型/URL 写 exec 行为门；manifest+静态扫描不替代真实网络测试。
- **E63 修订版+R8（reservation 状态机）**：外呼前原子预留（StorageAccount(teamId,usedBytes,reservedBytes,version)+StorageReservation(reservationId,operationId,team/execSeq,upperBoundBytes,state,leaseUntil)——未知视频大小按服务端上界预留禁零预留）；**reservation 拥有唯一 operation 身份+可恢复工作状态；lease 超时只转移处理责任，不自动释放在飞额度**（provider 可能已提交/视频已付费在物化/提交结果 UNKNOWN——把容量让给新任务=oversale）；只有持久 **NO_SUBMIT/CANCELED/FAILED 终态围栏赢得后**才按条件 release；已付费终态失败先有退款义务；**upperBoundBytes 作为此次下载、原对象及约定派生对象的明确 cap 传入 safe fetch/materialize**（现全局 env 2GiB 实证替换）；超 cap 在付款前拒/扩额；**付款后发现真实超 cap=持久失败+精确退款，不直接删除用户已付产物并只抛 quota 错**；**套餐降级不立即压缩已取得的 reservation**（v3-3：新预留按新限制，现有承诺按冻结 entitlement 完成）；字节计量 BigInt；重复 confirm 完成态零副作用；reconcile 不重复释放（验 lease/version 防双减）；物化同事务结算维持。
- **对象 GC delete-claim（R8）**：对象 manifest 按不可变 key/version 管状态 staged/committed/delete-claimed/deleted，关联有效上传/物化 lease；GC 在 **PG 条件事务 claim 删除并证明无有效引用/工作**（现扫完直接 MinIO delete 竞态实证）；**所有引用创建、finalize、重试 put 都必须核验并尊重 delete claim**；已有在飞 PUT 删除前取消/排空，或以对象版本/唯一写身份 fence+保留晚到上传的补偿 GC；确认无活动写后再外部删除，最后标记完成；对象版本开启时删除精确版本（不误删同 key 新对象）；**原生引用帧在生命周期效果提交点写 PG 引用准入**（§2.7-e——非只靠后台扫描；用户离线恢复已删除素材引用=业务拒绝+提示重新选择，不宣称离线引用免于授权）。**G31 修订**：零重复已提交 Media+零永久未登记对象+**临时 orphan 有界回收+零活引用对象误删**（数据库与对象存储非同一事务，不承诺瞬时跨存储 exactly-once，B19）。
- **D7 预算与 Geometry（另修②）**：预算公式=fixture 经验描述非配额真值；编码字节/JS heap/Undo 保留/XML·文本负载/tombstone 数/快照写放大分别监控；删除项 100,000 或历史残留>30% 且≥2MiB=人工维护候选；**Geometry 既有契约维持**；预算断言入 CI。
- **E45 移入项+观测**：低基数指标（durable_save_lag/append_gap/generation_fenced/runtime_outbox_oldest_age/storage_reservation_expired/object_gc_pending）；Prometheus 标签不带 projectId/nodeId/userId。
- **容量与起步预算（10.3）**：**双负载验收**——10,000 短节点（结构开销）+**8MiB 真实混合内容**（文本/XML/素材，字节上限）两条约束独立测试（不默认 1KB×10k 在 8MiB 内）+10 用户/同人多标签真实并发编辑（B20）；真实输入 admission/全文 clone/PG flush/投影合成分阶段计时；SLO 拟定值全部标为预算，达不到就降准入上限或优化影响域，**不准为达标放开权限**。起步数字：读事务 8s/短提交 5s/重放 10s；10,000 节点/10 活跃连接：单键投影 P95≤16ms·P99≤50ms/事件循环延迟 P99≤50ms/保存屏障 P95≤1s·P99≤3s/冷开当前上限画布 P95≤3s。

## 6. 片序、执行门与批末发布（C-6+§9）

| 片 | 内容 | 出口=用户确认点 |
|---|---|---|
| **-1 载体与原子准入** | §2 全部（版本门/载体协议 v3 含 genesis+错误模型/世代三层 fencing 含 epoch/维护状态机 含受理截止点+drain 授权/spool·内存表代际化/读侧完整性/串行窗口+FrameGate 生命周期+拒帧恢复协议+RESYNC 分档+生命周期受理接口+锁序契约/origin 契约+审计/保存屏障/manifest 契约冻结/基础 compact/闩锁删除） | G1-G14+B1-B9+verify 全绿+世代切换演练——**世代切换首次执行前单独请用户确认（:163 执行门）** |
| **-2a 内容模型** | §3（Y.Text/XmlFragment 最小绑定/唯一创建者含 undo 重建/完整重建序列化+schema→4/RetentionCoordinator+预算/结构上限/时间轴真实迁移/typed draft rebase） | G15-G20+B10+B16+E61 fixture 语义比对绿 |
| **-2b exec 契约 v3** | §4（execSeq 守卫/服务器专写投影根+组合规则/undo 边界/outbox 演进全状态/单展示源/换代重投影/退款代际+物化 run fence/删除义务闭环） | G21-G27+B11-B15+B17+kill 恢复锚 |
| **-3 门禁与预算** | §5（读者改道+字段删除同单元含 execAligned/data.status fallback 删除/E68 执法/断言族/reservation 状态机/GC delete-claim/预算+Geometry 契约维持/E45/观测/双负载） | G28-G33+B18+B19 |

- 四片分别验收；**相互依赖的半成品不分别部署——批末一个完整 v4 发布单元**（无兼容读写/旧 spool 收养/存量双写；dev 库重建；运维脚本对生产环境默认拒绝 reset）；片间接口有可执行契约测试。
- **批末 v4 破坏性发布流程（B20——additive 锚失效后现 deploy.sh 顺序不安全实证）**：外层维护关闭 HTTP/WS 写与任务受理→严格 drain（§2.4 六条件）→**停止所有旧 api/worker 数据库消费者**→执行明确 allowlist 的测试 DB reset/schema deploy→部署新 api/web→api 种子/准入/投影就绪检查→启动 worker→最后开放写；**外层维护不依赖即将 DROP 的 PG lifecycle**；gate 判据扩**实际在飞/全部可恢复段/后台事务**（storeInFlight 现成字段进判据；stranded 不再仅警告；无法观测=阻断）；未来正式环境恢复用非 reset 专用流程与当前测试 reset 分离。
- 回滚：测试部署可重建回旧测试版本；正式内容恢复走新世代（不把 DB 二进制降级+bundle 回退假称无损回滚——另修①）。

## 7. 验收判据与先红门禁（v3——按片；全部记录测试载体/故意变红证据/修复提交）

**-1（G1-G14）**

| # | 门禁 | 先红 | 绿 |
|---|---|---|---|
| G1 | 载体迁移+genesis | —（新表形+删旧列；additive 豁免登记） | 迁移链+装载新读路径全绿+**新头指向真实 snapshot0（原子种子）** |
| G2 | appendSeq 前缀 | 旧无锁协议交错反例复现 | 新协议前缀无缺口（交错用例 CI postgres） |
| G3 | compact CAS | 两 compact+append 三方交错 | 仅一快照发布/append 零丢/CAS 败零副作用/**PK 冲突实查分类不折正常 miss**/epoch 维度 |
| G4 | 世代+租约 fencing | 旧代异步 append/spool/内部写换代后到达：现无 expectedGeneration=贴当前代；**同 owner epoch7 操作在重获 epoch9 后提交：现 owner-only 放行** | 数据库原子拒绝 {owner,epoch,g}+generation_fenced 计数（B1） |
| G5 | 装载完整性 | 删增量整行/删指针行/改字节：分档 reason | 拒载+独立 reason+yjs_doc_incomplete_total+**missing/present/corrupt 三态**+降级出口指路 |
| G6 | 元数据+段名 | 现状 isValidDocName 拒带段=红前置；错段/缺段连接放行=红 | 三层 fencing+4410 hardClose 携 g+单世代断言 |
| G7 | 4410 会话重建+diverged 缓存 | 现状 provider-only recovery（同 doc）=换代后旧历史并入=红；旧 tab 迟到写覆盖=红 | 全 doc 拆卸+新会话+四维键隔离+incarnation fence+diverged 持久标记（B7） |
| G8 | 静默投毒免疫 | 旧代 update 并入新代 doc（实验 D） | 并入结构性不可能（错代键≠新代键+三层 fencing） |
| G9 | 维护状态机+drain | 维护每步 kill：现无持久状态=人工猜测；**QUIESCING 后 drain 写被 SERVING-only 拒=排空不可能** | maintenanceId 恢复不重复换代不开放旧写；受理截止点+专用 drain 授权；DRAINED 六条件；超时不假排空；**存续空项目保头升代**（B2/B3） |
| G10 | 类型化重建 | encodeStateAsUpdate 形态（旧身份保留）=红；rebuild 非 Map 根降级=红 | manifest 全类型重建+语义等价断言（exec 内容级） |
| G11 | 闩锁删除回归 | Y1b §3.3 域任一红 | 全绿+census 零残留 |
| G12 | 原子准入+FrameGate | 手工二进制写未知根/exec/替换父 map/DeleteSet 删受保护对象：现放行=红；部分过滤形态=红；**A.check/B.check/A.apply/B.apply 交错=红；live observer 抛错被吞成成功 ACK=红** | 整帧拒绝+close+诊断；令牌持到 apply+三类 hook 失败不漏锁；服务器投影重传放行；候选态不变量验证；本地草稿+重提路径（B5/B6/B8/B9） |
| G13 | 保存屏障 | Sync ACK 后 PG 提交前 kill：界面称已保存+本地内容丢失=红 | 三档状态；marker 前缀确认；拒帧连接屏障不可成功；spool 不冒充 PG |
| G14 | origin 契约+审计 | 表外 origin=红；服务端写零审计/有审计无内容=红 | 双侧断言+同事务审计+批次审计 |

**-2a（G15-G20）**：G15 纯文本并发（IME/粘贴/选区/两端同位插入）｜G16 富文本绑定（禁本地 history/快捷键归属/树有效性——现 HTML 整串=红）｜G17 唯一创建者（两副本同 key 并发=红→唯一+两字段均可见）｜G18 重建序列化全类型+语义 fixture｜G19 bounded undo+tryGc（退休可回收+100 项可恢复+祖先/redone 正确）｜G20 结构上限+文本泄漏格。
**-2b（G21-G27）**：G21 exec 专写根（客户端写 exec/undo 恢复带投影字段=准入拒）｜G22 三计数+组合（(execSeq,eventVersion) 数值序/槽位独立 rev/**旧 done 不回滚较新 clear、新 loading 保留合法旧槽位**/BigInt 数值比较）｜G23 undo 边界（A 删→B 完成/退款→A undo=无幽灵 loading 无免费交付）｜G24 outbox 全状态（kill/Redis 清空→恢复 30s 展示终态；**无 artifact 的 loading/error 可靠落事件**；状态错配被修正）｜G25 退款代际（迟到退款遇 rearm 不误命中新代；**物化 run 接管：旧 run 读通过后新 run 完成，旧 run 不得退款**）｜G26 节点恢复重投影（按 PG 三态；**lease 不变 g 变的换代对账不被 dedup 屏蔽**）｜G27 attempts→execSeq 守卫切换回归。
**-3（G28-G33）**：G28 读者改道同单元（改道后删字段=全读者投影合成绿——**execAligned/data.status fallback 删除**）｜G29 E68 执法（缺口先红）｜G30 配额预留（两并发 confirm/完成素材重复 confirm=不过售不重计不删资产；**lease 过期但 provider/materializing/UNKNOWN 在飞不释放；cap 实际执行；付款后超 cap 有持久退款义务；降级不毁既有承诺**）｜G31 落盘幂等三层（同 intent 重试零重复 Media 零永久未登记对象+**临时 orphan 有界回收+新引用/在飞 PUT/晚到 finalize 与 DELETE 交错不误删**）｜G32 manifest 断言族（未分类字段红）｜G33 预算+Geometry 回归（**10k 短节点+8MiB 混合双负载**）。

**发布门（批末，Z8+B20）**：真实 PG 交错全组（G2-G5）+两浏览器换代+多标签 IDB delete blocked+kill 演练（维护每步）+双负载（10,000 节点/8MiB 混合/10 连接真实并发——投影/保存/事件循环/heap/压缩写放大）+**破坏性发布实弹**（旧 DB 消费者全停后 reset；own 队列零但 inflight/stranded 非零拒发布）。

### 7.2 B1-B20 并入映射（v3-5——二轮外审先红后绿，不另造批次流程）

| B# | 摘要 | 片 | 并入 |
|---|---|---|---|
| B1 | 租约 ABA：同 owner epoch7 操作在重获 epoch9 后提交——append/compact/维护/投影均拒 | -1 | G4 扩 |
| B2 | drain 特权：QUIESCING 普通新写拒；截止前可信批/spool 落 PG；超时底层在跑不宣称 DRAINED | -1 | G9 扩 |
| B3 | genesis/空画布：新头指真实 snapshot0；存续空项目维护后 g 单调增；缺头/空 schema/悬空指针分档 | -1 | G1/G5/G9 扩 |
| B4 | FK 误分类：注入内部 snapshot/lifecycle FK 错——pending/spool 保留；真实项目删除才终态丢弃 | -1 | §2.2 错误模型（新门，随 G5 载体同测） |
| B5 | 原子 FrameGate：两连接交错串行化；beforeSync/beforeHandle 失败及 afterhook 异常不漏锁；live observer 故意抛错不被吞成成功 ACK；广播/保存不确认半成品；共享项目可从 PG 重载 | -1 | G12 扩 |
| B6 | 离线图冲突：相向 reparent/删节点与新引用冲突被拒后 fresh 同代实例收敛；「重复 apply 服务器态到旧 doc」错误方案先红 | -1 | G12/G8 扩 |
| B7 | 多标签缓存：diverged 持久标记/旧 tab 迟到写/重启读取/IDB blocked 拒绝历史不回正常 cache | -1 | G7 扩 |
| B8 | pending 因果：U2 先到 U1 后到及 delete-only 未知 target——未授权 pending 不入 live 不获 ACK；补齐与业务拒绝分档 | -1 | G12 扩 |
| B9 | 权限历史：overlap/newtail/伪造 origin 指向 exec/已删 DS 重传/live 保护对象新删/GC 祖先缺失；正常服务器投影重传不误拒 | -1 | G12 扩 |
| B10 | 原生恢复：node 删除再 undo 重建 data/text 容器合法；替换 live 容器拒；恢复不夹带 server 字段 | -2a | G17/G21 扩 |
| B11 | 删除提交点：accepted DeleteSet→kill/删后马上 undo/群组 delete 及 undo 创建——内容与业务围栏均不漏；已承诺退款不被恢复撤销 | -2b | G23 扩 |
| B12 | 并发 finalize：删除与 finalize 两种先后——钱和交付裁定由事务赢者确定，没有 poller 盲区 | -2b | G23/G25 扩 |
| B13 | 投影多维：新 loading 保留合法旧槽位；旧 done 不回滚较新 clear；数值 10/9 不按字符串排 | -2b | G22 扩 |
| B14 | outbox 形状：无 artifact 的 loading/error 可靠落事件；并发新版本与旧 mark 不丢唤醒 | -2b | G24 扩 |
| B15 | 换代重投影：lease 不变 g 变/旧 projected 事件/新代冷开恢复缺 exec 按 PG 修复不被 dedup 屏蔽 | -2b | G26 扩 |
| B16 | 多 UndoManager：清一个/关闭编辑器/自动 redo 清栈后其他有效历史仍恢复；tryGc 不破坏 active/popped 祖先 | -2a | G19 扩 |
| B17 | 物化 run 接管：旧 run 读通过后新 run 完成——旧 run 不得退款；终态失败裁定与 refund 义务同事务；退款失败可重扫 | -2b | G25 扩 |
| B18 | 预留状态：lease 过期但 provider/materializing/UNKNOWN 在飞不释放；cap 实际执行；付款后超 cap 持久退款义务；降级不毁既有承诺 | -3 | G30 扩 |
| B19 | GC 并发：新引用/在飞 PUT/晚到 finalize 与 DELETE 交错不误删；临时 orphan 有记录有界回收 | -3 | G31 扩 |
| B20 | 发布实弹：所有旧 DB 消费者停止后测试 reset；own 队列零但 inflight/stranded 非零时拒发布；10k 短节点+8MiB 真实混合双负载 | 批末 | 发布门扩 |

所有用例保留反面、正面、版本、环境与故障点证据；纯内存探针不替代 PG/浏览器/对象存储真实集成。

## 8. 非目标与移交

| 项 | 归属 |
|---|---|
| 「exec 整体出 doc」「全部结构操作命令化」 | **已裁定不采**（2026-10-23 用户收回） |
| 批注/高级富文本 | Y4（最小 Collaboration 绑定已前移 -2a） |
| 离线结构操作合并的扩展离线窗口验收 | Y5（**基础拒绝+同代 rebase 行为本批已验**——Y5 只扩窗口不后置基础正确性） |
| 快照恢复能力（增量保留/完整备份/K 份策略扩展/自动恢复/分层云归档） | Y6（本批保留=历史检查点语义） |
| compact 频率自适应 | Y6 |
| Geometry 契约调整 | 领域内依实测（本批维持） |
| z 序 UI | 后续批 |
| vacuum 自动回退 | 维持禁止（Y2 行回填） |
| Y2 已登记两项观测 | Y2 不变 |
| 多实例/运维监控 | Y7 |
| v3→v4 存量迁移器 | **不做**（v3-6——测试环境重建；未来真实 schema 变化再提供唯一 transformer） |

## 9. 纪律与观察项

- **最终原则**（用户终裁）：统一 Yjs 协作路径不新增无必要同步平面；PG 业务权威；doc 内受控投影与用户编辑/撤销/网络写权限**结构性隔离**。根修=让 CRDT 收敛、PG 耐久、业务围栏、不可逆副作用**分别拥有唯一且可验证的责任点**——不是把能力搬出 Yjs，也不是每个动作命令化。
- TDD 先红（每 G+每 B）；世代切换首演=执行门（:163）；四片出口=用户确认点一道不少。
- 禁垫片/禁版本分支兼容码（E61）；csv 消费一律 shared 单源（65accbe7）；**锁序（§2.10）与 receipt 身份为绑定契约，交错验收以 B5/B12 为准，不以「局部用了事务」证明无死锁**。
- 观察项：①行锁取号吞吐 vs 现 advisory lock（基准后定）；②串行窗口+candidate 历史副本对 WS 事件循环压力（worker thread 隔离+RSS 限实测）；③「几何已有 x/y 分键」plan 期 census 复核；④CollabLease FOR SHARE 短锁与现租约三入口合成（Y0a-3 沿用+epoch 捕获点定义）；⑤Tiptap 2 固定版 Collaboration 配置差异（禁照抄在线最新版）；⑥RetentionCoordinator 对 13.6.32 自动 GC 窗口的适配实证（探针入测试）。
- 护栏自查：本 spec v3 ~470 行（表格化压缩）＜1500 行护栏——行数不作为承重契约完整性证据（完整性以 §0.3 定案+G/B 门全覆盖为准）。

---

*版本确认：v1（2026-10-23 起草呈裁）→ v2（2026-10-23 外审一轮+用户终裁 C-1~C-6）→ **v3（2026-10-23 外审二轮采纳 R1-R12+B1-B20+用户三项确认——待用户评审）**。*
