<!-- doc-status: active -->
# Y1c：doc 模型 v3·载体与契约（B 类合并批设计——Phase 0 / -1a 载体 / -2a 内容模型 / -1b 准入 / -2b exec 契约 / -3 门禁预算）

- **立项**：2026-10-23，用户指令「Y1a+Y1b 完成，继续下一个任务」。按目录 §0.2 顺序节 B 类分组「Y1c 全批」合并立项（:159）；分阶段验收、批末一个完整发布单元（§0.2-C6+v4-2）。
- **唯一上游依据**：[2026-10-06-canvas-yjs-arch-upgrade-review.md](2026-10-06-canvas-yjs-arch-upgrade-review.md)（master v8.3）§0.2 Y1c 行（:145）+启动方式/执行门机制（:154-164）+§0.1 裁决（§0.1 内联）；Y0c spec 世代契约冻结直采；Y1a/Y1b spec v14.3 移交行承接。
- **硬前置**（Y1c 行）：Y0a+Y0.5 迁移链——已满足。
- **门槛重申**（E39，不因合并变化）：上线门槛=0 号+Y0a+Y0b+Y0.5+Y1a+Y1b+（**Y1c-2 三项 exec v2 修订版/E26/Y.Text+XmlFragment 随上线批强制**）。
- **最终原则（用户 2026-10-23 终裁）**：统一 Yjs 协作路径，不新增无必要同步平面；PG 保持业务权威；doc 内允许受控投影，但**投影必须与用户编辑、撤销和网络写权限结构性隔离**。

**修订链**：
- v1（2026-10-23）——首版合稿：三路一手核验+四片锚定+Z1-Z8 呈裁。
- v2（2026-10-23）——外审一轮+用户终裁 C-1~C-6+两收回+两修正（详见 v3 存档；要点：C-1 exec 留 doc 隔离撤销写权限/C-2 不建全量命令系统但补原子准入/C-3 读者改道同单元/C-4 保存屏障随载体/C-5 最小富文本绑定前移/C-6 四片+批末单发布）。
- v3（2026-10-23）——外审二轮采纳（R1-R12+B1-B20 四路验证全实证+用户三项确认 v3-1~v3-6：leaseEpoch 提交围栏/drain 受理截止点/拒帧恢复协议/FrameGate 生命周期/受理层生命周期提取+锁序契约/三计数组合+doc.exec 单展示源/materializeRunId/reservation 终态释放/GC delete-claim/RetentionCoordinator/FK 约束级分类/B1-B20 并片）。
- **v4（2026-10-23）——外审三轮采纳（「Y1c v3 架构复审终裁报告」——综合报告 A/B；三路验证承重主张全实证，含**两个现行生产 bug**）+用户两项裁定（v4-1 三档准入/v4-2 片序重排）**：①**C-2 修订=三档准入**（DENY 仅权威/安全/资源；图语义合并异常 ACCEPT+NORMALIZE 读侧屏蔽；E68「写侧显式拒绝」回归业务写本义）；②**片序重排**（Phase 0 契约冻结→-1a 载体→-2a→-1b 准入→-2b→-3——validator 必须吃最终内容类型防返工；Z1 微调 docSchema 批末置 4）；③Phase 0（per-node-type schema 表+DocCodec+textInput 统一+content 分键契约+创建路径双路 census+执行输入快照契约+耐久性契约表；两现行 bug 修复=首日）；④exec 扁平组件键（execution:<nodeId>/artifact:<nodeId>:<slot> 各自整条原子替换+NodeExecution/ExecutionOutbox+watermark）；⑤admissionEpoch+spool 受理标签+维护执行者=租约持有者；⑥租约锁形修正（advisory shared 替 FOR SHARE——3s 心跳互斥实证）；⑦准入机制补（FrameGate 显式 SS2+Update+后置校验+CanvasDocProvenance 表+patch fork 合同+DraftEnvelope+decode/父链/provenance 替全量副本）；⑧直接采纳包（客户端增量投影/本地缓存文本对齐实现/shift 泄漏修复/compact 分批 purge/barrier forces flush/公开快照安全/BigInt gate/帧级 trace/耐久性四档契约）；⑨v4-9 评审收敛——不再全文评审轮。偏离登记 11-15。

---

## 0.1 本批有效裁决（master 内联——E30 纪律：spec 自包含）

### 0.1a 载体系（-1a 域）

| 编号 | 裁决（master 原文摘引） | 本批效力（v4） |
|---|---|---|
| E3 | generation 走合并前可见载体=docName `project:<id>#g<N>`（服务端按 DB 列校验）或鉴权握手返回；客户端建 provider/Y.Doc 前丢弃本地缓存；CanvasDoc 加 generation+revision 双列 | **修订采纳**：revision 水位语义→**appendSeq 行锁内取号**（§2.2）；世代获取通道=已有项目元数据（零新往返） |
| E23 | docName 世代 6 处连带+双校验+单世代断言；最小世代重建前移 Y1c；compact 守卫连续 3 败→世代重建出口；公开快照缓存键拼 generation | **修订采纳**：重建=类型化可见态导出全新 Y.Doc；3 败出口=Z4；**v4 补（P0-3）**：「六连带」低估——裸 `project:${pid}` 构造实测 **39 处**（docName 域 26）→ **buildDocName 唯一构造器+check-collab-census 静态门+DocKey 全清单**（§2.3） |
| E39 | 排空 runbook 补两步+世代重建命令与归档同批；内存表按 (projectId,generation) 精确清理 | 采纳；drain 授权形 v4-5（admissionEpoch+spool 受理标签）；内存表全清单=registry 12 张+persistence 10 张（§1.4-15） |
| E60 | 版本协商走 providerVersion | **修订（v3）**：providerVersion 为 4.6.0 库内部版本号禁用（P6 勘误）；版本门=shared csv 精确比较维持 |
| E61 | 世代切换=唯一 doc 迁移载体；禁「看版本分支」兼容码；空库=删行 vs 非空=迁移命令互斥判据；schemaVersion 门两档收敛 | **修订采纳**：类型化 manifest 导出；互斥判据=类型化可见态判定且**空画布保头升代**（偏离 10）；**v4 补**：创建路径双路（POST /canvases 现不建 doc 头实证）——genesis 双路种子（§2.2） |
| E62 | CanvasDocSnapshot 追加式+指针；compact 补分块/事务外重放/{timeout}/后台调度 | **修订采纳**：Snapshot PK=(projectId,generation,snapshotRev)+stateHash；**v4 补**：分批 purge（1k/批）+重放出 API 进程（worker/thread——现单事务全量+进程内重放实证） |
| C7③ | 排空切换 runbook | 采纳（§2.4+§6 批末发布） |
| E20 移入项+E42④ | 读侧守卫三处/装载降级出口/doc-incomplete 码；SV 支配性=对账哨兵非 compact 放行判据；装载一致性=单 RR 事务 | 采纳（主判据=RR+前缀连续性）；未解析因果禁入 live pending+RESYNC 分档（§2.7-c） |
| E45 移入项 | 准入 env 预留 enforcement 档 | 采纳（-3） |

### 0.1b 内容系（-2a 域）

| 编号 | 裁决（master 原文摘引） | 本批效力（v4） |
|---|---|---|
| C8 | 文本只允许原地 splice；建好 Y.Text 后禁整块替换；扩 data 全键整块替换禁令 | 采纳；载体分型（C-5）：纯文本=Y.Text；TextInputNode 富文本=**嵌套 Y.XmlFragment+y-prosemirror**（**v4-4.3 定案**：`ySyncPlugin(fragment)/yUndoPlugin` 直绑嵌套 fragment——**否决根级 fragment**：节点删除不删根/undo 恢复不随 scope/rebuild 非 Map 根三坏；不用 @tiptap/extension-collaboration 根 fragment 选项，Tiptap 2 registerPlugin 可行）；**Tiptap 面全清单**：TextInputNode/PromptInput(prompt-input)/TextNodeFullscreen/TextNodeToolbar 逐面定载体 |
| E26+E33 | keep GC：释放被截断出栈项∧扣除交集；回收唯一路径=客户端 doc 重建 | **修订（v2+v4）**：tryGc 可回收（探针）；文档级 RetentionCoordinator（多管理器 keep 并集+覆盖自动 GC+gcFilter 统一保护判定）；**v4 补实证**：现 canvasUndo `undoStack.shift()` 截断不释放 keep=**现行泄漏**（yjs 无内建上限、释放唯一口 clear()）——drop 路径算祖先闭包释放；协调器挂 **afterTransaction**（Transaction.js 实证先于 finally 中 tryGcDeleteSet——GC 前生效）；服务端 gcFilter `()=>true` 维持（无撤销栈——协调器是客户端域） |
| E27 | 嵌套类型唯一创建者；服务端对无权创建 key no-op 不建 | **修订**：帧级整体拒绝取代 no-op；容器唯一创建+**允许合法 undo 重建 incarnation**；**v4 补（4.4）**：incarnation 身份=`nodes[id]` Y.Map Item 的 **(clientID,clock)**——内容 UUID 会被 undo 复制（探针实证）不可用 |
| Y0b-4 移交 | 单人文本泄漏格+单键 256KB 间隔门 | 采纳（-2a） |

### 0.1c exec 系（-2b 域）

| 编号 | 裁决（master 原文摘引） | 本批效力（v4） |
|---|---|---|
| E2 | attempt 维度+绑定裁定（deleteNode 同事务删 exec+scope 含 exec） | **绑定裁定修订（C-1）**：exec 不入 UndoManager scope；客户端 deleteNode 不删 exec（undo 恢复被删子树不剔除 server origin 字段实证）；execView 断言=客户端对 exec 零写（含 undo 恢复——准入门拦） |
| E22 | attemptSeq 单调源=exec 内自增+执行门三态矩阵+撤销×exec 洞+退款 | **单调源修订（C-1）**：PG execSeq=唯一执行序；attempts=重试计数；三计数分离（execSeq/eventVersion/artifactRevision）+**确定组合规则**（execution 数值序+槽位独立 rev+BigInt 禁字典序——v4 扁平组件键承载）；doc 守卫改 execSeq 比对 |
| E64 | PG 侧 outbox+吞错修复+kill 恢复 30s 必达 | **修订采纳**：主路径已修；全状态走**演进 outbox**（v4=NodeExecution/ExecutionOutbox partial unique 形）；**doc.exec 单展示源**（删 runtime snapshot/execAligned/data.status 随读者迁移删）；内容等值不跳状态修正；kill 锚维持；**v4 补**：执行输入快照（受理事务冻结入 PG——现 claim 时活读 doc+重放漂移代码自认实证） |

### 0.1d 门禁系（-3 域）

| 编号 | 裁决（master 原文摘引） | 本批效力（v4） |
|---|---|---|
| E17+E38 | manifest 四层 TS 单源派生断言族+第五层禁键；新字段未分类即红 | **冻结前移 Phase 0**（v4-3）；**v4 补**：manifest 现为全局键表非 per-node-type schema（实证）→ **docSchemaV4 per-node-type 表+DocCodec**（shared 单源——readRecordsFromMaps 只许 codec 内 import）；**运行时准入面**（受影响节点键/值类型/字节/nodeId 语法/每节点键数——与静态表共用，P1#12） |
| E30 | 字段冲突语义表 | 采纳（-3；exec=扁平组件键服务器专写/纯文本=字符级/富文本=嵌套 XmlFragment/几何与 config=LWW） |
| E68 | 不变量五条三列；读侧全函数/写侧显式拒绝/禁修复写回 | 采纳（-3）；**v4-1 边界回归本义**：「写侧显式拒绝」=**业务写操作**（intent/command/server 修复命令）——图语义 CRDT 合并结果走 ACCEPT+NORMALIZE（读侧确定性屏蔽——renderCanvas 现状规则收编单一 shared 单源；只读不写回；超阈值告警 graph_anomaly_total{kind}） |
| D7+E33 | doc 字节预算+Geometry 帧写上限 | 采纳（-3）；Geometry 既有契约本批不推翻；**双负载**（10k 短节点+8MiB 混合两约束独立）+**客户端增量投影验收 G33b**（v4-8） |
| E63 | 配额预留-结算+落盘幂等 | **修订采纳**+v3 R7/R8（materializeRunId/reservation 终态释放/upperBoundBytes 传入 fetch/GC delete-claim）维持 |
| 存量删除 | data.status/fileId 一次性删除 | 同发布单元（-3）；读者枚举扩全（binding/事实订阅/GC/复制粘贴/公开快照/执行输入+exec 扫描增补 collectMediaRefs） |

### 0.1e 前批冻结契约与移交（直采）

| 项 | 内容 | 效力 |
|---|---|---|
| Y0c R0c-4 世代契约 | docName 语法+双校验+单世代断言；世代真源=DB 列；spool 键世代作用域 | 采纳（§2.3/§2.5） |
| Y0c Z32 | 客户端 doc schema 门 | 修订载体（v3）：元数据+服务器认证/装载主门+有序首水合；doc-status 仅观测 |
| Y0b-4 4410 | generation-superseded close code | 采纳（hardClose 主动关） |
| Y1a/Y1b 移交 | 闩锁删除→-1a；SCHEMA=4→本批（**Z1 微调：批末一次性置 4，-2a 用内部 4-draft 不写 PG/缓存键**） | 采纳；Y1b T15 删除观察→受理层提取（偏离 9） |
| Y1a/Y1b §6 :536 | vacuum 自动回退禁止 | 采纳（Y2 行回填） |

---

## 0.2 裁决定案（2026-10-23 用户终裁——外审一轮收敛；v4 修订注记内联）

| # | 定案 |
|---|---|
| **C-1** | **exec 留同一 Y.Doc，但隔离撤销与写权限**。PG=业务真源；doc.exec=服务器专写持久投影。三计数不混（execSeq/eventVersion/artifactRevision）；**载体形态 v4 细化（v4-4）**：扁平组件键各自整条原子替换（意图不变：无嵌套共享类型+单一服务端写者+原子替换）；exec 不入 undo scope+客户端不删 exec；服务器投影字段移出 nodes.data；全状态走 outbox（内容等值不跳状态修正） |
| **C-2** | 不建全量命令系统，补齐原子准入。【**v4 修订（v4-1）**：强不变量中的**图语义合并异常改 ACCEPT+NORMALIZE**——三档准入（DENY 仅权威/安全/资源）；「无环/引用存在」的写侧执法回归业务写操作（E68 本义）；DENY 面对行为良好客户端的结构操作不可达】 |
| **C-3** | 读者改道前移，与字段删除同发布单元（-3） |
| **C-4** | 保存屏障随载体落地（-1b）；**barrier forces flush 显式化（v4-8）** |
| **C-5** | 最小富文本绑定前移 -2a；**载体=嵌套 Y.XmlFragment+y-prosemirror（v4-4.3）** |
| **C-6** | 四片质量出口+批末一个完整 v4 发布单元。【**v4 修订（v4-2）**：执行序 Phase 0→-1a→-2a→-1b→-2b→-3；四片验收语义保留（-1a/-1b=-1 两半）；每阶段出口=用户确认点；批末单发布不变】 |
| **报告收回×2/另修×2** | 维持（exec 出 doc/全量命令化不采；快照保留=检查点语义；Geometry 契约维持） |
| **Z1-Z8** | 维持；**Z1 微调（v4-2）**：docSchema 数字批末一次性置 4——master 中间态不部署，实质等价 |

## 0.3 v3/v4 轮定案（外审二/三轮采纳——用户确认）

**v3 轮（外审二轮）**：v3-1 R1-R12+B1-B20 全采纳｜v3-2 R5 受理层生命周期提取+§2.10 锁序=绑定契约｜v3-3 套餐降级不压缩既有 reservation｜v3-4 保留预算（单管理器 100 项/4MiB+文档级 16MiB 起步）｜v3-5 B1-B20 并片｜v3-6 v3→v4 存量迁移器不做（测试环境重建）。

**v4 轮（2026-10-23 外审三轮「终裁报告」采纳——用户两项裁定确认）**：

| # | 定案 |
|---|---|
| **v4-1** | **C-2 修订：三档准入**。**DENY**（整帧拒绝+close+诊断→REJECTED/DIVERGED）仅限权威/安全/资源：写 exec/meta/服务器投影字段、替换 live 容器、重复创建 live nodes[id]、DS 删 live 受保护 struct、伪造 provenance、未知类型/未知 data 键/值类型错、超预算；**ACCEPT+NORMALIZE**：图语义合并异常（悬挂边/父链环/跨组 parent/重复边——并发合并产生非单方可归责）接受广播、读侧确定性屏蔽、只读不写回、超阈值告警（graph_anomaly_total{kind}）；**ACCEPT**：正常帧。理由：删节点 A 与对端建边 B→A 各自合法合并才违规=CRDT 正常收敛；读侧屏蔽规则已在（renderCanvas 环守卫/悬空边整删实证）；三档制下**不建全量 CanvasDocIndex**（准入=decode+父链+provenance，O(structs×depth)）。原 C-2 离线结构门不再必需（NORMALIZE 兜底）；拒绝率仍观测 |
| **v4-2** | **片序重排（C-6 修订）**：**Phase 0（契约冻结 3-5 天）→ -1a 载体 → -2a 内容 → -1b 准入 → -2b exec → -3 门禁**。理由：validator 必须吃最终内容类型（XmlFragment/content 分键/exec 组件键）——先建准入再改内容=权限表/fixture/G12·G17 写两遍；-2a fixture 才是 -1b 测试输入。四片验收语义保留；每阶段出口=用户确认点；批末单发布不变。**Z1 微调**：docSchema 批末置 4，-2a 用内部 4-draft |
| **v4-3** | **Phase 0 契约冻结**：①docSchemaV4 **per-node-type 表**（type→{envelope, data: key→{yType:text/xml/array/lww, writer, reader, ownership, undo, permission, mediaRef, importExport}}——覆盖 textInput.content=XmlFragment/audioGen.content=Y.Text prompt/imageGen·videoGen.prompt.text/multiImageGen.prompt/allImages=Y.Array/几何 config=LWW/exec=server-only）；②**DocCodec**（shared 单源：encodeNode/decodeNode/serializeCanvas/semanticEqual；readRecordsFromMaps 只许 codec 内 import；REST/导出/执行/公开快照/备份/重建全走 codec）；③textInput 统一+**两现行 bug 修复=首日**（isTextNode 'text'/'textInput' 分裂→文本节点重挂载正文读空+夹具掩蔽；TextConfigPanel 生成覆盖正文）；④content 正文/prompt 分键**契约**冻结（物理迁移随 -2a——保持 Phase 0 除两 bug 外零生产代码变更）；⑤创建路径双路 census（POST /canvases 不建 doc 头实证）；⑥**执行输入快照契约**（受理事务冻结 {promptText,promptHtml?,upstreamMediaIds,paramsHash} 入 PG——worker 不再 claim 时读 doc）；⑦耐久性契约表（四档 local/synced/durable/archived——只有 durable 承诺不丢）。**出口**：schema-contract.spec 全绿+codec round-trip 属性测试（随机 text/marks/XML 语义相等）+-2a/-2b fixture 冻结。没有此出口 -1a 不开工 |
| **v4-4** | **exec 扁平组件键（C-1 形态细化）**：doc.exec 根 server-only 不变；`execution:<nodeId>` 与 `artifact:<nodeId>:<slot>` 各为 plain object **整条原子替换**（原子单位从节点级细化到组件级——封死旧任务整条覆盖回滚已清槽位/新 loading 吞合法旧槽位两反例；删节点按前缀清；读取按前缀合成；undo 恢复后按 PG 重投影）；PG **NodeExecution**(projectId,nodeId,execSeq,eventVersion,status,…)+**ExecutionOutbox**（partial unique：runtime 事件 UNIQUE(intentRowId,execSeq,eventVersion,kind) WHERE artifactId IS NULL；artifact 事件 UNIQUE(artifactId,artifactRev)）；artifacts[slot] rev=NodeArtifact.rev（clear 同行 rev++/mediaId=null）；**execProjectionWatermark**（冷装载只对 eventVersion>watermark 重投影；换代/恢复/人工修复才全量）；单组件 64KB（大文本拆独立不可变字段）；**writer API 迁移表**（claim loading/skipped/error、deliver、replace/clear、sweepOrphan→outbox/setExecProjection/删除 分派——writeExecStatus 族逐步退役） |
| **v4-5** | **维护授权形**：admissionEpoch（非裸 seq）+spool 帧/批头持久受理标签 `{maintenanceId?,admissionEpoch,generation}`+drain 只受理 epoch≤cutoff 且 maintenanceId 匹配/为空；maintenanceId **partial unique**（WHERE NOT NULL）+maintenanceStage→{允许动作,幂等键,超时}表+每 stage kill 测试；DRAINED=可查询六元组；**维护执行者=租约持有者**（CLI 只写 request/轮询——不直接写 CanvasDoc/CanvasDocUpdate；无租约拒绝；租约丢失=中止）；旧代归档窗口 **7 天**再删 |
| **v4-6** | **租约锁形修正**：append/compact 租约读改 **pg_advisory_xact_lock_shared**（租约域键控；takeover 用 exclusive advisory）或拆 epoch/heartbeat 两行——v3 FOR SHARE 锁租约行与 **3s 心跳 UPDATE 互斥**（collab-lease :70/:224-227 实证）；心跳只更新 expiresAt 不取锁 |
| **v4-7** | **准入机制补**：FrameGate 显式覆盖 **SS2+Update**（beforeSync MessageReceiver:190 单调用点三类型统一触发实证；SS2 独立字节/struct 预算；awareness/stateless 不覆盖——现 guardSyncFrame 已三分支先例）；候选验证=**decode structs+DS→父链上溯→受保护判定→provenance 精确命中**（禁热路径全量历史副本；三档制无 CanvasDocIndex）；**CanvasDocProvenance**(projectId,generation,clientId,clockStart,clockEnd)（或快照压缩区间列）随服务器写/快照持久化——validator 只放行精确命中区间，新尾部一律按客户端写（C-1 前提：区分「自己写过的旧 struct」与「伪造 server clientID」）；**apply 后置校验**（beforeSync 记预期 SV/事务计数→afterHandleMessage 对比，不一致隔离重载）；**y-protocols 补丁合同**=最小 fork（pnpm patch/包内 fork 只改 readSyncStep2/readUpdate：apply 失败重抛+成功后才 ACK）+patch 校验和+CI 红+上游 PR，禁运行时 monkeypatch；**DraftEnvelope**（typed/versioned/project/generation/schema/checksum）+RESYNC 先 pull-only 再重放，禁 raw 跨代 |
| **v4-8** | **直接采纳包**：①**客户端增量投影**（YEvent path[0] 收集变更节点只 patch 变更节点/未变保引用/结构变更才全量 reconcile——现 50ms 防抖全量实证）+不变量检查出热路径（采样/worker/批量）+8MiB SS2 **permessage-deflate/HTTP seed 二选一实测**；②本地缓存 spec 文本对齐实现（**单快照+savedSeq/stateVector/generation**——「IDB append 日志」文本废弃；多标签 LWW 残余风险登记不重写）；③canvasUndo shift 泄漏修复入 -2a；④compact 分批 purge（1k/批）+重放出 API 进程；⑤barrier forces flush 显式化；⑥公开快照缓存键 (pid,g,appendSeq)+doc-saved 失效+服务端 sanitize+URL allowlist+exec 产物按分享策略过滤+collectMediaRefs 增补 exec 扫描；⑦BigInt wire 显式 String()+bigint-json gate；⑧每类事务 lock_timeout/statement_timeout+40P01/40001 有界重试；⑨每帧 trace 五段耗时（decode/validate/PG/apply/broadcast——frameId/connectionId/projectIdHash/generation/outcome）；⑩耐久性：**dev/test RPO=24h 诚实登记已知限制**（单机拓扑写明不声称 HA）；生产发布门=PITR(RPO≤5min)+MinIO 版本化+restore drill+replay canary |
| **v4-9** | **评审收敛**：三轮外审（v1→v4）已收敛——报告自评「载体协议可施工」+剩余=边界细化；**不再全文评审轮**，剩余不确定性在 plan/TDD 消解 |

## 0.4 偏离登记表（滚动）

| # | 偏离 | 落地形态与依据 |
|---|---|---|
| 1-10 | （v3 存档：E2 绑定/E22 单调源/E27 帧级拒绝/E26+E33 RetentionCoordinator/E3 appendSeq/E61 类型化导出/E60 csv 门/Z32 载体/Y1b T15 删除观察→受理层/E61 空画布保头） | §0.2/§0.3 v3 轮 |
| 11 | C-2「图违反=整帧拒绝」→三档准入（图语义合并异常 ACCEPT+NORMALIZE） | §0.3 v4-1（用户 2026-10-23 再裁定；E68「写侧显式拒绝」本义=业务写——读侧容忍现状 renderCanvas/topology 实证） |
| 12 | C-6 片序 -1→-2a→-2b→-3 → Phase 0→-1a→-2a→-1b→-2b→-3 | §0.3 v4-2（用户裁定；validator 须吃最终内容类型——防权限表/fixture/G12·G17 双写返工） |
| 13 | Z1「docSchema→4 于 -2a 变换同刻」→批末一次性置 4（-2a 内部 4-draft） | §0.3 v4-2（master 中间态不部署——实质等价；避免开发期版本号写 PG/缓存键混乱） |
| 14 | v3 §2.2「FOR SHARE 稳定读租约行」→pg_advisory_xact_lock_shared（或拆 epoch/heartbeat 行） | §0.3 v4-6（3s 心跳 UPDATE 与 FOR SHARE 互斥实证） |
| 15 | v3 §2.8「本地 IDB append 日志」→单快照+savedSeq/stateVector/水位 | §0.3 v4-8（local-collab-cache 单快照 LWW 实现实证——spec 文本对齐实现；多标签 LWW 残余风险登记） |

---

## 1. 基线快照（2026-10-23 一手核验；1.1/1.2=v2 轮；1.3=v3 轮；1.4=v4 轮 2d62fcfc）

### 1.1 载体域（v2 轮锚点，存档）

| # | 现状主张 | 亲验锚点 |
|---|---|---|
| 1-14 | csv=3/docName 无段/世代元数据通道已在/缓存四维键含 g/CanvasDoc 单行无 lifecycle·snapshot/spool 键无代/ACK≠PG 保存/provider-only recovery/origin 无契约表/releaser 弃值/closeTeamDocuments 单代（全文见 v3 存档） | collab-protocol.ts:11；doc-name.util.ts:16-45；project.service.ts:87-108；local-cache-key.ts:24-25；schema.prisma:862-906；collab-spool.service.ts:49；MessageReceiver.ts:116-124,:241-280；canvasCollabRuntime.ts:514-526；collab-residency.service.ts:166-175 |

### 1.2 执行/产物域（v2 轮锚点，存档）

| # | 现状主张 | 亲验锚点 |
|---|---|---|
| 15-23 | 交付 owner=ArtifactProjection poller/PG execSeq·NodeArtifact·rev 在/对象键 content-addressed/doc 守卫比对 attempts/等值 fast path/rollback 仅 status 维度/配额误删路径/TextInputNode=Tiptap getHTML 整串/yjs tryGc 库源（全文见 v3 存档） | execution.service.ts:389-459；schema.prisma:1074-1205；artifact-commit.service.ts:23-56；collab-document.service.ts:307-325；projection-outbox.poller.ts:265-290；team-credit.service.ts:257-284；storage-quota.service.ts:15-49；TextInputNode.tsx:37-50 |

### 1.3 二轮外审核验锚点（v3 轮，存档）

| # | 现状主张 | 亲验锚点 |
|---|---|---|
| 24-39 | 租约 DB 语句 owner-only+flushDocument 前置门/owner 进程常量 epoch 递增/raceDeadline 不取消/全 23503=项目已删/afterHandleMessage 零接线+y-protocols 吞错/物化时间 lease+退款先于终态 CAS/全局 2GiB cap/GC 扫后直删/投影 mark 无 g/三源回落/ArtifactProjection 必选 artifact 维度+无 eventVersion/keep=布尔+自动 GC+gcFilter ()=>true/pendingStructs 自动激活/diverged 通路已在/单 UndoManager/deploy 顺序+gate 四零（全文见 v3 存档） | canvas-doc-update.repository.ts:64-69；collab-lease.service.ts:46-163；pg-error.util.ts:4-7；collab-server.factory.ts:59-63；materialize-job.service.ts:175-482；safe-remote-fetch.service.ts:91-161；media-gc.service.ts:113-194；projection-outbox.poller.ts:323-390；execStatusView.ts:34-52；Item.js:68-73；Transaction.js:321-327；encoding.js:395-447；canvasCollabRuntime.ts:1743-1761；deploy.sh:134-159；gate-decision.mjs:15-35 |

### 1.4 三轮外审核验锚点（v4 轮=2d62fcfc 业务代码）

| # | 现状主张 | 亲验锚点 |
|---|---|---|
| 40 | **现行 bug①**：NODE_TYPES.TEXT='textInput' 但 isTextNode 判 'text'——生产文本节点 isTextNode 恒 false→重挂载正文读 ''；updateText 幽灵分支建 type:'text'；测试夹具+自 mock 同用 'text' 掩蔽 | nodeStore.ts:20,:225,:613-621；TextInputNode.tsx:28；TextInputNode.test.tsx:84,:91 |
| 41 | **现行 bug②**：data.content 一键双义（textInput=正文/audioGen=prompt）；TextConfigPanel 生成时 applyNodeDataPatch(nodeId,{content:prompt}) 把正文覆盖成 prompt | AudioConfigPanel.tsx:45,:155；TextConfigPanel.tsx:31,:157 |
| 42 | POST /canvases 主路径只建 CanvasProject+Template 不建 CanvasDoc（懒建注释自证）；project.service.create 才 seed——v3「缺头=corrupt」会误伤全部 Workspace 新建画布；现状缺头=放行懒建 | canvas.service.ts:37-47；project.service.ts:75-79；registry:385 |
| 43 | beforeSync 单调用点位于 type 分派前——SS1/SS2/Update 三类型统一触发；现 guardSyncFrame 已三分支处理 | MessageReceiver.ts:186-196,:190；registry:678,:705,:710 |
| 44 | exec 现状=嵌套 Y.Map（缺则 new Y.Map() 建）；web 读侧 instanceof Y.Map 判型 | collab-document.service.ts:311-324；canvasCollabRuntime.ts:728-729 |
| 45 | 裸 `project:${pid}` 构造实测 39 处（docName 域 26；registry 6/persistence 8/residency 4/document 3/gateway/session-guard/canvas-doc-update/spool/client 各 1-3）——全仓无 buildDocName helper | grep 实测（评审点名 19 行号全中） |
| 46 | 执行输入 claim 时活读 doc（readCanvas→prompt 组包）；PG 只存 paramsHash 无 prompt 列；重放漂移窗口代码自认 | execution.service.ts:183,:305,:512；generation-intent.service.ts:159-160；schema.prisma:1052 |
| 47 | canvasUndo STACK_LIMIT=100 shift() 截断不释放 keep；yjs 无内建上限、keep 释放唯一口 clear() | canvasUndo.ts:13,:41-42；UndoManager.js:40-43,:304-308 |
| 48 | afterTransaction 先于 tryGcDeleteSet（GC 在 cleanup finally）——协调器挂 afterTransaction 可在 GC 前生效；doc update 事件在 GC 后 | Transaction.js:313-325,:363-368 |
| 49 | 客户端 onRemote 50ms 防抖→applyDocToStore 全量读+全量 setState+全量 reconcile；events 仅做 origin 过滤无 path 增量 | canvasCollabRuntime.ts:1958-1990,:1308-1358 |
| 50 | 本地缓存=单快照整份覆盖+LWW+dirty 守卫；record 无 savedSeq/SV/generation（generation 只在库名键）；无 BroadcastChannel | local-collab-cache.ts:3-14,:34-42,:148-151 |
| 51 | manifest=全局键路径表（通配 path）非 per-node-type schema；nodes.\<id\>.data 三创建点 unique:false | canvas-doc-manifest.ts:41-46,:124 |
| 52 | registry 侧 projectId 单维表 12 张（docTruth/docDelta/truthMeasuredAt/degradedDocs/quotaFrozenDocs/freezePending/docStatusRev/vacuumingDocs/preVacuumSvCache/docGeneration/docResidue/autoVacuumLastAt 等）+persistence 侧 10 张 | collab-doc-registry.service.ts:149-213；collab-persistence.service.ts:132-168 |
| 53 | 心跳 3s UPDATE expiresAt/renewedAt（owner CAS）；FOR SHARE 与该 UPDATE 互斥（v3 提案形态冲突）；现 append 为无锁 EXISTS | collab-lease.service.ts:70,:206,:223-228；canvas-doc-update.repository.ts:67-68 |
| 54 | 读侧容忍已在：renderCanvas 环守卫+悬空边整删；topology 跳缺失上游；validateParentGraph 纯报告（生产调用方 400 拒绝不修） | renderCanvas.ts:68,:144,:98,:160-163；topology.service.ts:79-80；validateParentGraph.ts:43 |
| 55 | compact 单事务全量 findMany+API 进程内重放+一条 deleteMany（零分批；PAGE_ROWS=500 仅装载侧） | canvas-doc-update.repository.ts:240-290 |
| 56 | web 依赖：yjs/y-protocols/@hocuspocus/provider 在列；无 extension-collaboration/y-prosemirror（Tiptap 面四处：TextInputNode/PromptInput/TextNodeFullscreen/TextNodeToolbar） | web package.json:23-48 |

---

## 2. Y1c-1 载体（-1a）与原子准入（-1b）

### 2.1 版本两门口径（Z1+v4-2）

csv→4 于 -1a（docName 段+4410 hardClose+装载门两档）；**docSchema 数字批末一次性置 4——-2a 期间用内部 4-draft（不写 PG/缓存键）**（v4-2：master 中间态不部署，实质等价）；双常量独立语义注记进 docShape.ts 头注；版本门载体=shared csv 精确比较（E60 修订）。

### 2.2 PG 载体协议（appendSeq 行锁取号+世代内聚+提交点围栏）

**表形**（Prisma 迁移；dev 库硬切——additive 豁免登记）：

- `CanvasDoc(projectId PK, generation, schemaVersion, lifecycle, currentSnapshotRev BigInt, appendSeq BigInt, maintenanceId?, maintenanceStage?, maintenanceError?, admissionCutoff BigInt?, maintenanceSourceGeneration?, maintenanceTargetGeneration?, targetSchemaVersion?)`；**maintenanceId partial unique（WHERE NOT NULL）**；重复维护命令只推进同一 operation。
- `CanvasDocSnapshot(projectId, generation, snapshotRev BigInt, stateSeq BigInt, state, stateHash, schemaVersion, createdAt)`——`@@id([projectId,generation,snapshotRev])` 追加式；hash=SHA-256。
- `CanvasDocUpdate(projectId, generation, seq BigInt, update, updateHash, createdAt)`——`@@id([projectId,generation,seq])`；按 (pid,g,seq) 分区/purge 策略 plan 期定。
- `CanvasDocProvenance(projectId, generation, clientId, clockStart, clockEnd)`（或快照压缩区间列）——**随服务器写/快照持久化**（§2.7-b：区分自己写过的旧 struct 与伪造 server clientID——C-1 前提）。
- `DocWriteAudit`（§2.7-f，按时间分区）。
- 序号全 BigInt，wire 十进制 string（**比较先解析 BigInt 禁字典序**；bigint-json gate）。
- **genesis 双路（v4）**：每个新项目/每新世代原子创建 Snapshot(g,rev=0,stateSeq=0)+头指针——**两条创建路径（project.service.create+canvas.service.create/POST /canvases）都必须在同一事务建头+snapshot0**（现分裂实证：POST /canvases 懒建——缺头=corrupt 会误伤）；初始快照可有种子内容（stateSeq=0=尚无增量≠可见态空）；快照 FK 只关联稳定 CanvasProject；头指针=精确 (projectId,generation,snapshotRev) 复合指针 FK；保留策略禁删当前指针引用行。
- **缺头判别三态**：missing/present/corrupt 分档——已创建项目应有原子种子头；缺头异常不以 schema=null/generation=0 自愈掩盖（现 `?? 0` 回落修正）；真实创建只在明确种子入口。

**append（高频路径）**：短事务统一锁序——**pg_advisory_xact_lock_shared（租约域键控）稳定租约语义**（v4-6——心跳 UPDATE 不与 advisory 锁互斥；takeover 用 exclusive advisory；备选=拆 epoch/heartbeat 两行）→ 锁 CanvasDoc 行 → 验证 **{owner=捕获 ∧ epoch=捕获 leaseEpoch ∧ expectedGeneration ∧ lifecycle=SERVING}**（drain 授权档见 §2.4）→ 去重（updateHash 活行优化）→ **appendSeq+1 行锁内取号** → INSERT Update → 更新 appendSeq → COMMIT。epoch 用已授权操作捕获值，禁提交前读最新 epoch 洗身份；TTL 仅为接管时延。spool 恢复=新写尝试新捕获+保留源批身份重核验。

**装载**：只读 RR 事务读头→同代 Snapshot(R)→S<seq<=N 全增量→顺序连续+数量+哈希校验→事务外 apply（失败=拒载）。SV/pendingStructs=诊断哨兵（E42④）。

**compact**：RR 取快照+完整前缀退出事务→**事务外 worker/thread 重放/编码/校验**（RSS 限制；v4-8——现 API 进程内全量重放实证替换）→短事务同锁序比较 (generation,currentSnapshotRev=R,epoch,lifecycle) 四元组成功才 INSERT R+1——PK 冲突=回滚后实查分类不折正常 miss——允许 appendSeq>N→CAS 成功才 INSERT Snapshot(R+1)+指针前移+stateSeq=N+**分批 purge 实读行集（1k/批）**；CAS 失败分类计数。触发：1,000 行/2MiB/最老增量 60s；单项目最短 30s；全局并发 1 起步；积压/快照量监控。

**保存语义与 receipt**：至少一次增量保存——updateHash=完整性/活行去重优化非稳定 receipt；保存屏障确认完整前缀；精确幂等的维护/生命周期批次/outbox 用独立 receipt 身份。

**持久错误模型（R10）**：约束级判别——仅确证项目 FK 缺失且 DB 确认 CanvasProject 不存在才终态丢弃；内部 FK/快照悬空/世代错误/缺 maintenance 行=fail-closed 保留+告警；共享判别类型。

**保留（Z3+另修①）**：当前代 2 份+最近两旧代各 1 份=历史检查点语义。

### 2.3 世代通道与三层 fencing（E23+v4 P0-3）

1. **元数据先行**：客户端取项目元数据→schema 匹配（客户端主门①）→固定 {uid,pid,g,schema,sessionEpoch}→建 IDB/Y.Doc/provider（name=`project:<pid>#g<N>`）。localStorage 非真源。
2. **三层 fencing**：①认证（name 段 vs DB 列+版本/世代验证——hardClose 主动关，4410 携 g 仅登录/ACL 后）；②装载再核验；③append 原子验证 {owner,epoch,expectedGeneration}+lifecycle。断言任一时刻单世代可加载。客户端首个 update 前断言走有序首水合；doc-status 仅观测。
3. **4410 消费端到端**：重新取元数据+完整新会话（拆 observers/UndoManager/cache writer/provider→destroy→新 doc）；纠偏限一次+退避+总预算；缓存隔离=四维键结构性；跨代仅类型化导入。
4. **buildDocName 唯一构造器+静态门（v4 P0-3）**：`buildDocName(projectId,generation)` 唯一构造点；**生产禁裸 `project:${pid}` 模板串**（实测 39 处）；`check-collab-census` 静态门扩此检查；withDoc/withSession/openDirectConnection/closeTeamDocuments/readCanvas 全走 buildDocName+单代断言；**DocKey={pid,g}**（稳定串或 documentName）覆盖 registry 12 张+persistence 10 张单维表（§1.4-52 清单）——换代按 (pid,g) 精确清不按 pid 全清。
5. **公开快照缓存键 (pid,g,appendSeq)**（v4-8：现仅 projectId；doc-saved 失效；换代清旧键）。

### 2.4 维护状态机与世代切换协议（R2+v4-5）

**PG lifecycle+maintenanceId**（§2.2 表形）：SERVING→QUIESCING→DRAINED→REBUILDING→SERVING；maintenanceStage→{允许动作,幂等键,超时}持久表——每 stage kill 测试。

**受理截止点（admissionEpoch）**：项目串行入口内关闭新受理，**等 in-flight settle（非 Promise.race 超时）**，记录 `cutoff=admissionEpoch`；此后新帧带 maintenanceId 标签直接拒。**spool 帧/批头持久受理标签 `{maintenanceId?,admissionEpoch,generation}`**；drain 只接受 `admissionEpoch<=cutoff` 且 maintenanceId 匹配/为空的帧（append 授权档=lifecycle=QUIESCING ∧ maintenanceId 匹配 ∧ cutoff 前）。

步序：①停收新写+暂停任务 claim→②旧连接只读等待→③flush pending+spool 回灌（drain 授权档）→**DRAINED=可查询六元组**：pendingBatches=0 ∧ spoolCurrentGen=0 ∧ admissionInFlight=0 ∧ appendTxInFlight=0 ∧ projectWriteWindowIdle ∧ projectionProducerPaused（**任一不可观测=阻断**；超时=未排空保持封闭）→④关连接+manifest 类型化导出→⑤纯函数变换（-1a=identity；-2a=v3→v4）→⑥新 Y.Doc 重建+封存旧代最终快照+**新代头+snapshot0**+清旧代增量（**旧代归档窗口 7 天再删**）→⑦按 (pid,g) 精确清内存键恢复受理→⑧客户端 4410→新会话。

- **维护执行者=租约持有者**：CLI（collab:rebuild-gen）只写 request/轮询——不直接写 CanvasDoc/CanvasDocUpdate；无租约拒绝；租约丢失=中止。
- 维护窗口禁并行 compact（发布处仍查 lifecycle/maintenanceId/generation）。
- **互斥判据（偏离 10）**：初始 v4 切换与 test reset 可删行重造；**存续项目空画布保头升更高 g**；项目物理删除=独立生命周期。
- compact 3 败出口（Z4）；排空 runbook 进 collab-ops-runbook.md；禁「看版本分支」兼容码；v3→v4 迁移器不做（v3-6）。

### 2.5 spool 键世代作用域+内存表精确清理

spool 段键 `${projectId}.g${N}.${segSeq}.spool`+**帧级受理标签（v4-5）**；replayAll 只收养当前代；错代段=quarantine+计数；内存表键 DocKey 升维全清单（§2.3-4）。

### 2.6 读侧完整性与降级出口

前缀连续性三守卫+SV 哨兵（v3 维持）；装载降级出口 doc-incomplete 档+告警+runbook 指路；未解析因果数据不得静默丢弃（§2.7-c 分档）。

### 2.7 原子准入（C-2′ 三档）+串行窗口+拒帧恢复+生命周期受理

**三档准入（v4-1——取代「图语义整帧拒绝」）**：

| 档 | 判据 | 处置 |
|---|---|---|
| **DENY** | 写 exec/meta/服务器投影字段；替换 live 容器；重复创建 live nodes[id]；DS 删 live 受保护 struct；伪造 provenance（未精确命中 CanvasDocProvenance 区间的 server 身份）；未知类型/未知 data 键/值类型错；超预算（maxStructs/maxDsRanges/maxFrameBytes+每项目 CPU 预算） | 整帧拒绝+close+诊断→REJECTED/DIVERGED（(d) 协议） |
| **ACCEPT+NORMALIZE** | 悬挂边、父链环、跨组 parent、重复边——并发合并产生、非单方可归责 | 接受广播；读侧确定性屏蔽（规则收编 renderCanvas 现状=单一 shared 单源）；只读不写回；超阈值告警 graph_anomaly_total{kind} |
| **ACCEPT** | 正常帧 | 正常 apply |

DENY 面对行为良好客户端的结构操作不可达（离线结构编辑维持允许——NORMALIZE 兜底）；服务端修复命令（server origin+audit）作为业务写可修图异常（E68 边界：合法维护命令=业务写非投影修复）。

**(a) 串行窗口与 FrameGate 生命周期（R4+v4-7）**：CollabFrameGate 在 beforeSync 获取项目+世代令牌→原始权限+候选验证→持令牌到 actual apply/同步 update 处理结束→afterHandleMessage 幂等令牌匹配释放。**显式覆盖 SS2+Update**（beforeSync 三类型统一触发实证；SS2 独立字节/struct 预算；awareness/stateless 不覆盖）。异常边界：beforeSync 抛错经 receiver finally；beforeHandleMessage 抛错自释放；写回调同步。**接收处显式失败边界**：y-protocols 吞错→**补丁合同=最小 fork**（只改 readSyncStep2/readUpdate：apply 失败重抛+成功后才 ACK；pnpm patch/包内 fork+patch 校验和+CI 红+上游 PR，禁 monkeypatch）；广播只传播 authoritative 整合产生的有效 update。**apply 后置校验**：beforeSync 记预期 SV/事务计数→afterHandleMessage 对比，不一致=隔离重载共享项目文档及全部相关连接；保存屏障不确认失败实例。每帧 trace 五段耗时（decode/validate/PG/apply/broadcast）。

**(b) 候选验证（4.2/4.3+v4-7）**：**decode structs+DS→父链上溯→受保护判定→provenance 精确命中**——禁热路径全量历史副本/shadow doc（v3「二进制历史副本」形态废弃）；三档制下**不建全量 CanvasDocIndex**；**运行时 manifest 准入面**：受影响节点校验允许键/值类型/字节上限/nodeId 语法/每节点键数/共享类型创建规则（与静态 per-node-type 表共用）；已确认 no-op 服务器投影历史重传放行（provenance 精确命中；clientID/clock 非签名）；成本纪律：固定上限+受影响集合增量验证，完整校验仅冷启/维护/定期自检；fuzz corpus 入 CI。

**(c) 未解析因果（4.4）**：pendingStructs/pendingDs 挂起自动激活实证——无变化≠空操作。候选帧无法完成父域/因果授权=禁入 live pending，发可重试 RESYNC_REQUIRED+关连接（限重试/字节/时间）；**RESYNC 先 pull-only 再重放**；clean 缓存可完整同代状态补依赖，diverged 缓存只走语义 rebase 禁 raw merge。

**(d) 拒帧恢复协议（R3）**：REJECTED/DIVERGED：①停上传+独立草稿（**DraftEnvelope**：typed/versioned/project/generation/schema/checksum——禁 raw 跨代）；②IndexedDB 持久 diverged 标记+incarnation/version fence（复用 bootRecord.diverged 通路）；③同代 authoritative fresh Y.Doc（禁 apply 被拒 raw update——CRDT 合并单调性反例）；④语义差异展示+基于 fresh 态新 struct 身份重生成允许编辑；⑤重建完成/明确放弃后切正常缓存 incarnation。强不变量与离线并发=合并结果走 NORMALIZE；DENY 违规的整帧拒绝+同代 rebase 演练本批完成（B6）。

**(e) 生命周期效果受理（R5+4.4）**：项目窗口内比较前后态提取 created/restored/deleted+引用增删；PG **NodeLifecycle/DeliveryFence 主键 (nodeId,incarnationId,generation)**——**incarnationId=nodes[id] Y.Map Item (clientID,clock)**（内容 UUID 被 undo 复制不可用）；exec 仍按 nodeId，交付/退款判断读 incarnationId；测试补 delete→undo→re-delete/delete→refund→undo/undo 后新 incarnation 不继承旧取消退款（B10/B11）。带效果整帧：前置 flush→同 PG 事务（内容增量+准入结果+取消退款义务+审计 receipt）→native apply→广播；PG 失败不 apply 不广播不 ACK；commit token 防 listener 二次排队；媒体引用同事务核验未入删除 claim；普通文本/几何帧维持批写+durable marker。

**(f) origin 契约与审计（Z5+P1#4）**：origin 机制表（TS 单源）+**ServerDocWrite 统一写面**：捕获 WriteContext{actor,command,generation,epoch}，项目窗口内 apply+捕获 update+**同一 PG 事务** append+DocWriteAudit+lifecycle/outbox；withDoc/withSession 写面 census 迁移；高频文本按批次审计。

**闩锁删除**：Y1b §3.3 resync 闩锁——plan 期 census 定位删除（G11）。

### 2.8 保存屏障（C-4+v4-8）

- 三档保存状态（synced∧unsyncedChanges=0 只到第二档）；spool fsync 不冒充 PG。
- 同连接有序 marker（flushPendingUpdates→nonce+sessionEpoch+generation+edit watermark→被 await 的有序入口→等前缀进 PG→回 (nonce,g,committedSeq)）；**barrier 强制显式 flush**（现 ~2s debounce 下 P95 1s 承诺不成立——屏障触发即 flush，v4-8）；回执只清 marker 前 dirty；拒帧连接屏障不可成功；断线新 nonce。
- **本地缓存（偏离 15）**：单快照+savedSeq/stateVector/generation（对齐实现——「IDB append 日志」文本废弃）；重连允许 Yjs 差分重发；多标签 LWW 残余风险登记（clean 禁覆盖 dirty 守卫已在）；日志 GC 只删已覆盖且已确认记录。

### 2.9 manifest→per-node-type schema 契约（Phase 0 冻结+v4-3）

**docSchemaV4 per-node-type 表**（Phase 0 冻结）+**DocCodec**（shared 单源：encodeNode/decodeNode/serializeCanvas/semanticEqual；readRecordsFromMaps 只许 codec 内 import；REST/导出/执行/公开快照/备份/重建全走 codec）；**运行时准入面共用同表**（§2.7-b）；创建面与行为面同步（不预建无消费方空根；相关域入口当片执法）；nodes.data 键分类二分（C-1）；新字段未分类构建红；断言族行为门全量执法 -3；读者面全枚举（media-refs 单扫 nodes.data 实证——fileId/result 迁移后同步改+collectMediaRefs 增补 exec 扫描）。

### 2.10 全局锁序契约（v3-2 维持+v4-6 锁形）

**CollabLease（advisory shared）→ TeamBalance → StorageAccount → NodeLifecycle/DeliveryFence → GenerationIntent → StorageReservation → CanvasDoc → NodeArtifact 稳定槽位 → Media/ObjectManifest → outbox/receipt**。同层多行稳定主键排序；禁反向取得；PG 事务禁先持资金/媒体锁再等项目窗口；**每类事务 lock_timeout/statement_timeout+40P01/40001 有界重试**；交错验收=B5/B12。

---

## 3. Y1c-2a 内容模型（-2a——C-5+v4）

- **文本分型**：纯文本域=Y.Text splice（canApplyIntent 单一 seam；IME/粘贴/选区/两端同位独立验收）。**TextInputNode 富文本=嵌套 Y.XmlFragment+y-prosemirror**（`ySyncPlugin(fragment)`/`yUndoPlugin`——fragment 在 nodes 子树内：删除/undo 重建/唯一创建者天然跟随；yUndoPlugin 注册进 RetentionCoordinator 与画布管理器分 scope；StarterKit history:false；Tiptap 2 registerPlugin 适配固定版）；**Tiptap 面全清单逐面定载体**：TextInputNode（XmlFragment）/PromptInput·prompt 面板（Y.Text——imageGen/videoGen/multiImageGen prompt）/TextNodeFullscreen（复用编辑器实例）/TextNodeToolbar（type-only）；格式化 HTML 仅渲染/导出。**用户 content 与 generated result 不合并**。
- **content 分键（v4-3 契约→本片物理迁移）**：textInput 正文=content（XmlFragment）/prompt 另键；audioGen.content（prompt 义）→prompt 键；**TextConfigPanel 覆盖写修复**（Phase 0 首日 bug②）。
- **唯一创建者+undo 重建**：每 node incarnation 一次性创建用户容器（**允许合法 undo 重建**——incarnation=Item(clientID,clock)）；live 容器禁整体替换；恢复不得夹带服务器字段（准入层拦）；B10。
- **完整重建序列化**：DocCodec 全类型覆盖（Y.Text/Y.Array/嵌套 XmlFragment）；v3→v4 纯函数变换+语义 fixture（-2a fixture=-1b 测试输入——v4-2 片序理由）；**docSchema 批末置 4（内部 4-draft）**。
- **bounded undo+RetentionCoordinator**：文档级登记全部管理器 undo/redo/popped/redone/祖先依赖；**挂 afterTransaction**（GC 前生效实证）；GC 前重建保护并集仅退休集合解除；**修 shift 泄漏**（drop 算祖先闭包 keepItem(false)——现行泄漏实证）；覆盖自动 GC；gcFilter 与显式 tryGc 同判定；fail-closed 保留；预算=单管理器 100 项/4MiB+文档级 16MiB（跨管理器去重计费）；明确历史过期策略退休最旧；**服务端 gcFilter ()=>true 维持**。
- **单人文本泄漏格**+结构上限（字节计不分类型）；**时间轴域真实迁移**（不放空根；未迁移功能留原真源禁双写）；**typed draft rebase**（DraftEnvelope 消费端）。

## 4. Y1c-2b exec 契约（-2b——C-1+v4-4）

- **doc.exec=服务器专写持久投影根（单展示源）**：**扁平组件键**——`execution:<nodeId>`={intentId,execSeq,eventVersion,status,error,deliveryState,…}（按数值 (execSeq,eventVersion) 取当前）；`artifact:<nodeId>:<slot>`={artifactRevision,mediaId/resultText,state,sourceExecSeq,…}（每槽位按 PG rev；空值/clear 也具版本）——各为 plain object **整条原子替换**；删节点按前缀清；读取按前缀合成；**展示唯一源=doc.exec**（冷装载前服务器 PG 对账回投+execProjectionWatermark 只补 eventVersion>watermark；重连/恢复/换代服务器重投影；stateless 仅 wake-up；execAligned/data.status fallback 随读者迁移删除）；读侧先查 node 存在后取 exec。
- **PG 表形（v4-4）**：`NodeExecution(projectId,nodeId,execSeq,eventVersion,status,…)`+`ExecutionOutbox`（partial unique：runtime 事件 UNIQUE(intentRowId,execSeq,eventVersion,kind) WHERE artifactId IS NULL；artifact 事件 UNIQUE(artifactId,artifactRev) WHERE artifactId IS NOT NULL）——**演进既有交付链非平行队列**；eventVersion 与状态/outbox 同事务持久化；mark CAS 加 **generation+runId+期望状态**（代变返回 pending 不耗 attempts）；claim runId/leaseUntil；内容等值不跳状态修正；单组件 64KB（大文本拆独立不可变字段）；**writer API 迁移表**（writeExecStatus 族→outbox/setExecProjection/删除 分派逐步退役）；kill 锚维持（PG 终态成功且产物可交付→30s 展示；materializing 真实物化中）。
- **执行输入快照（v4-3）**：受理事务冻结 {promptText,promptHtml?,upstreamMediaIds,paramsHash} 入 GenerationIntent/InputSnapshot——**worker 只读 PG 不再 claim 时读 doc**（现活读+重放漂移实证封死——计费/执行一致）。
- **undo 边界**：exec 不入 undo scope+客户端不删 exec；节点删除读侧屏蔽+幂等清理；恢复按 PG 三态重投影（incarnationId 维度——交付/退款判断）；禁幽灵 loading 复活与免费重跑。
- **退款代际+物化 run fence（R7 维持）**：expectedExecSeq+精确 ledger 行身份；materializeRunId 终态裁定事务（runId+status+execSeq+产物身份同校验+RefundObligation 同事务——只有裁定赢者冲销）；退款异步幂等 reversesId；不在 CAS 终态前退款。

## 5. Y1c-3 门禁与预算（-3——v4-8 补）

- **读者改道与字段删除同单元（C-3）**：全部读者（含 execAligned/data.status fallback 删除/GC/复制粘贴/公开快照/binding/事实订阅/执行输入）改道投影合成→删旧字段+写者+fallback。
- **E68 执法**：五条三列；读侧全函数+NORMALIZE 规则单一 shared 单源；写侧显式拒绝=业务写；禁修复写回。
- **客户端规模化（G33b）**：**增量投影**（YEvent path[0] 收集变更节点只 patch；未变保引用；结构变更才全量 reconcile；nodes map 结构共享）；不变量检查出热路径（采样/worker/批量）；**8MiB SS2 permessage-deflate/HTTP seed 二选一实测**；验收 10k/8MiB/10 连接 P99≤50ms+changed-node≤delta+冷开 3s。
- **公开快照/媒体安全**：缓存键 (pid,g,appendSeq)+doc-saved 失效+服务端 sanitize+URL allowlist+exec 产物按分享策略过滤+collectMediaRefs 增补 exec 扫描。
- **E68 断言族+quota/GC（v3 维持）**：reservation 状态机（终态释放+cap 传入 fetch+降级不压缩）；GC delete-claim+G31 有界 orphan；BigInt gate；E45 观测+帧级 trace 消费。
- **D7 预算+Geometry 契约维持+双负载**（v3 维持）。

## 6. 阶段序、执行门与批末发布（v4-2）

| 阶段 | 内容 | 出口=用户确认点 |
|---|---|---|
| **Phase 0 契约冻结**（3-5 天） | v4-3 全部（per-node-type 表/DocCodec/textInput 统一+两 bug 首修/content 分键契约/创建路径双路 census/执行输入快照契约/耐久性契约表）；**除两 bug 外零生产代码变更** | PC1-PC3：schema-contract.spec 全绿+codec round-trip 属性测试+fixture 冻结+两 bug 先红后绿 |
| **-1a 载体** | §2.1-§2.6+§2.9 冻结+§2.10（表形+genesis 双路/appendSeq/snapshot+provenance 表/epoch fencing/维护状态机 admissionEpoch/spool·内存键 DocKey 化/buildDocName+静态门/compact 分批+worker 重放/闩锁删除/读侧完整性）——**不含 FrameGate** | G1-G11+B1-B4+代际 census 静态门+verify 全绿 |
| **-2a 内容** | §3（Y.Text/嵌套 XmlFragment+y-prosemirror/唯一创建者+incarnation/DocCodec 接线+分键物理迁移/RetentionCoordinator+shift 修复/结构上限/时间轴/typed draft） | G15-G20+B10+B16+E61 fixture 语义比对绿 |
| **-1b 准入** | §2.7 全部+§2.8（FrameGate SS2+Update/三档准入/decode+父链+provenance/拒帧恢复+DraftEnvelope/lifecycle 受理+incarnation/保存屏障+forces flush/ServerDocWrite+审计/patch fork/后置校验） | G12+G12b+G13+G14+B5-B9+部分应用反例绿+SS2 越权红+伪造 provenance 红 |
| **-2b exec** | §4（扁平组件投影/NodeExecution+ExecutionOutbox/eventVersion/execSeq 守卫/undo 边界/退款+物化 run fence/writer API 迁移/执行输入快照落地） | G21-G27+B11-B15+B17+kill 恢复锚 |
| **-3 门禁** | §5（读者改道+字段删除/E68/reservation/GC delete-claim/预算/观测/**客户端增量投影**） | G28-G33+G33b+B18+B19 |
| **批末** | v4 破坏性发布+双负载+两浏览器换代+kill 演练+（生产则 PITR/restore drill/replay canary） | 发布门+B20 |

- 每阶段出口=用户确认点一道不少；**世代切换首次执行前单独请用户确认（:163 执行门）**；相互依赖半成品不分别部署——批末一个完整 v4 发布单元；破坏性发布流程+gate 扩在飞判据（v3 §6 维持）。
- **耐久性契约表（v4-8）**：`local`（本地已写）/`synced`（服务器内存已收）/`durable`（PG 已提交——唯一承诺不丢档）/`archived`（快照归档=检查点）；客户端存 savedSeq/stateVector，重连允许差分重发；**单机拓扑写明不声称 HA**；dev/test RPO=24h 诚实登记已知限制；**生产发布门**=PITR(RPO≤5min)+MinIO 版本化+restore drill+replay canary。
- 回滚：测试部署可重建；正式恢复走新世代（检查点语义）。

## 7. 验收判据与先红门禁（v4——按阶段）

**Phase 0（PC1-PC3）**

| # | 门禁 | 先红 | 绿 |
|---|---|---|---|
| PC1 | schema 契约 | manifest 现全局键表无类型 schema=红前置 | per-node-type 表+DocCodec round-trip 属性测试（随机 text/marks/XML 语义相等）+-2a/-2b fixture 冻结 |
| PC2 | 两现行 bug | **isTextNode 分裂**：夹具改生产名 'textInput'→现守卫判 false 正文空=红；**TextConfigPanel 覆盖写**：生成后正文≠原正文=红 | 统一 textInput+删幽灵分支；prompt/正文分键（生成不再触碰正文） |
| PC3 | 创建路径 census | POST /canvases 无 CanvasDoc 行=红前置（census 报告） | 双路种子契约定稿（实现落 -1a genesis）+执行输入快照契约+耐久性契约表 |

**-1a（G1-G11+B1-B4）**

| # | 门禁 | 先红 | 绿 |
|---|---|---|---|
| G1 | 载体迁移+genesis 双路 | — | 迁移链+装载新读路径+**两条创建路径同事务头+snapshot0** |
| G2 | appendSeq 前缀 | 旧无锁交错反例 | 新协议前缀无缺口（CI postgres） |
| G3 | compact CAS+分批 | 两 compact+append 三方交错 | 仅一快照发布/PK 冲突实查分类/**worker 重放+分批 purge** |
| G4 | 世代+租约 fencing | 同 owner epoch ABA=现 owner-only 放行 | {owner,epoch,g} 原子拒绝+**advisory shared 锁形+心跳不受阻**（B1） |
| G5 | 装载完整性 | 删行/指针/字节分档 | 拒载+missing/present/corrupt 三态+**内部 FK fail-closed 保留**（B4） |
| G6 | 元数据+段名+buildDocName | isValidDocName 拒带段=红；**裸构造静态门红（39 处）** | 三层 fencing+4410 hardClose+**census 零裸构造+DocKey 全表换代精确清** |
| G7 | 4410 会话重建 | provider-only recovery 同 doc 复用=红 | 全 doc 拆卸+新会话+四维键隔离 |
| G8 | 静默投毒免疫 | 旧代 update 并入新代 | 结构性不可能 |
| G9 | 维护状态机 | QUIESCING drain 被拒=红；每步 kill | admissionEpoch+spool 标签+drain 授权+**DRAINED 可查询六元组（不可观测=阻断）**+空画布保头+归档窗口+**CLI 无租约拒绝**（B2/B3） |
| G10 | 类型化重建 | encodeStateAsUpdate 旧身份=红 | manifest 全类型+语义等价 |
| G11 | 闩锁删除回归 | Y1b §3.3 域红 | 全绿+census 零残留 |

**-2a（G15-G20+B10+B16）**：G15 纯文本并发｜G16 富文本绑定（**嵌套 fragment+y-prosemirror**：删除随子树/undo 重建随 scope/树有效——现 HTML 整串=红）｜G17 唯一创建者+incarnation（**undo 重建合法/替换 live 拒/新 incarnation 不继承旧取消退款**）｜G18 重建序列化全类型+DocCodec 语义 fixture｜G19 bounded undo（**shift 泄漏先红**+退休可回收+100 项可恢复+祖先/redone+多管理器互不破坏）｜G20 结构上限。
**-1b（G12+G12b+G13+G14+B5-B9）**：

| # | 门禁 | 先红 | 绿 |
|---|---|---|---|
| G12 | 三档 DENY 面+FrameGate | 手工二进制写 exec/未知根/替换父 map/DS 删受保护=现放行红；**部分应用反例（bit-flip 探针语料）**；SS2 全量帧越权；**伪造 server clientID（provenance 未命中）**；A.check/B.check/A.apply/B.apply 交错；observer 抛错假 ACK | 整帧拒绝+close+诊断；令牌持到 apply 三类 hook 失败不漏锁；**后置校验不一致隔离重载**；重传放行（provenance 命中）；patch 哈希变红门 |
| G12b | 图语义 NORMALIZE | 删节点 vs 对端建边合并→**整帧拒绝形态=红（废止验证）** | 悬挂边/环/跨组 parent/重复边合并→读侧确定性屏蔽收敛+graph_anomaly_total 告警+无 rebase 中断 |
| G13 | 保存屏障 | ACK 后 PG 前 kill=假已保存红 | 三档状态+marker 前缀+**barrier forces flush**+拒帧连接不可成功+spool 不冒充 |
| G14 | origin+审计+ServerDocWrite | 表外 origin 红；写零审计红 | 双侧断言+**ServerDocWrite 同事务**+批次审计 |

**-2b（G21-G27+B11-B15+B17）**：G21 exec 专写根（客户端写/undo 恢复带投影字段=准入拒）｜G22 三计数+扁平组件（execution 数值序/槽位独立 rev/旧 done 不回滚新 clear/新 loading 保留旧槽位/BigInt 10/9/单组件 64KB）｜G23 undo 边界（A 删→B 完成/退款→A undo=无幽灵无免费；**incarnation 不继承旧取消退款**）｜G24 outbox 全状态（**无 artifact 的 loading/error 落表=现形状红**；kill 恢复 30s；代变 mark 不耗 attempts）｜G25 退款代际+物化 run 接管（旧 run 不得退款）｜G26 换代重投影（**watermark 不屏蔽换代/恢复全量对账**）｜G27 attempts→execSeq 回归。
**-3（G28-G33+G33b+B18/B19）**：G28 读者改道同单元（fallback 删除）｜G29 E68 执法｜G30 配额预留（含 cap 执行/付款后超 cap 退款/降级不毁承诺）｜G31 落盘幂等+GC 并发（delete-claim/在飞 PUT/晚到 finalize 不误删+有界 orphan）｜G32 manifest 断言族+运行时准入面｜G33 预算+Geometry 双负载｜**G33b 客户端规模化**（增量投影 changed-node≤delta+10k/8MiB P99+冷开 3s+压缩/seed 实测）。

**发布门（批末+B20）**：真实 PG 交错全组+两浏览器换代+多标签 IDB blocked+kill 演练（维护每 stage）+双负载+破坏性发布实弹（旧消费者全停后 reset；inflight/stranded 非零拒发布）+（生产则 PITR/restore drill/replay canary）。

### 7.2 B1-B20 并入映射（v4 更新落片）

| B# | 摘要 | 阶段 | 并入 |
|---|---|---|---|
| B1-B4 | 租约 ABA/drain 特权/genesis·空画布/FK 误分类 | -1a | G4/G9/G1·G5·G9/G5 扩 |
| B5 | 原子 FrameGate（交错串行化+三类 hook 失败+observer 抛错不假 ACK+共享文档 PG 重载） | -1b | G12 扩 |
| B6 | 离线图冲突（**v4 改三档语义**：合并冲突 NORMALIZE 收敛+DENY 违规 fresh 收敛+错误方案「重复 apply 服务器态」先红） | -1b | G12/G12b 扩 |
| B7-B9 | diverged 多标签缓存/pending 因果分档/权限历史（overlap/newtail/伪造 origin/已删 DS 重传/GC 祖先缺失+重传不误拒） | -1b | G7 扩/G12 扩/G12 扩 |
| B10 | 原生恢复 incarnation（重建合法/替换拒/不夹带 server 字段/**不继承旧取消退款**） | -2a | G17/G21 扩 |
| B16 | 多 UndoManager（清一个/关编辑器/redo 清栈后其他有效+tryGc 不破坏祖先） | -2a | G19 扩 |
| B11/B12 | 删除提交点/并发 finalize（事务赢者裁定无 poller 盲区） | -2b | G23/G25 扩 |
| B13-B15/B17 | 投影多维（数值 10/9）/outbox 形状/换代重投影/物化 run 接管 | -2b | G22/G24/G26/G25 扩 |
| B18/B19 | 预留状态/GC 并发 | -3 | G30/G31 扩 |
| B20 | 发布实弹+双负载 | 批末 | 发布门扩 |

## 8. 非目标与移交

| 项 | 归属 |
|---|---|
| 「exec 整体出 doc」「全部结构操作命令化」 | 已裁定不采 |
| 批注/高级富文本 | Y4（嵌套 XmlFragment+y-prosemirror 已定 -2a） |
| 离线结构操作扩展离线窗口 | Y5（基础行为本批已定：NORMALIZE 兜底+DENY 权威面） |
| 快照恢复能力 | Y6（检查点语义；分层归档/自适应频率） |
| compact 频率自适应/多实例运维监控 | Y6/Y7 |
| Geometry 契约调整 | 领域内依实测（本批维持） |
| z 序 UI | 后续批 |
| vacuum 自动回退 | 维持禁止 |
| v3→v4 存量迁移器 | 不做（v3-6） |
| HA/多实例 | Y7（本批单机拓扑写明；耐久性契约表登记限制） |

## 9. 纪律与观察项

- **最终原则**（用户终裁）+根修=CRDT 收敛/PG 耐久/业务围栏/不可逆副作用分别拥有唯一可验证责任点。
- TDD 先红（每 G+每 B+每 PC）；世代切换首演=执行门（:163）；每阶段出口=用户确认点。
- **Phase 0 纪律**：除两现行 bug 外零生产代码变更。
- **评审收敛（v4-9）**：三轮外审（v1→v4）后不再全文评审轮——剩余边界（锁形备选二选一/分区策略/8MiB 压缩 vs HTTP seed/-1b 内部拆分与否）在 plan/TDD 消解。
- 禁垫片/禁版本分支兼容码；csv 单源；锁序与 receipt 身份=绑定契约（B5/B12 验收）。
- 观察项：①行锁/advisory 吞吐基准；②串行窗口+decode 验证事件循环压力（worker 隔离实测）；③几何分键 census；④advisory shared vs 拆行二选一（plan 期定）；⑤y-prosemirror 与 Tiptap 2 固定版配置差异（禁照抄最新版）；⑥RetentionCoordinator 自动 GC 窗口探针入测试；⑦执行输入快照表形（GenerationIntent 扩列 vs InputSnapshot 表——plan 期定）。
- 护栏自查：v4 ~600 行＜1500 护栏；行数非完整性证据（以 §0.3 定案+PC/G/B 门全覆盖为准）。

---

*版本确认：v1（起草呈裁）→ v2（外审一轮+终裁 C-1~C-6）→ v3（外审二轮 R1-R12+B1-B20）→ **v4（2026-10-23 外审三轮「终裁报告」采纳+用户两项裁定 v4-1 三档准入/v4-2 片序重排——待用户过门后进 plan）**。*
