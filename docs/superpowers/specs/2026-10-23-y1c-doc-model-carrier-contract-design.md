<!-- doc-status: active -->
# Y1c：doc 模型 v4·载体与契约（B 类合并批设计——v5 四平面架构：P0 契约 / P1 载体 / P2 内容 / P3 业务与恢复 / P4 交付）

- **立项**：2026-10-23，用户指令「Y1a+Y1b 完成，继续下一个任务」。按目录 §0.2 顺序节 B 类分组「Y1c 全批」合并立项（:159）；分阶段验收、批末一个完整发布单元。
- **唯一上游依据**：[2026-10-06-canvas-yjs-arch-upgrade-review.md](2026-10-06-canvas-yjs-arch-upgrade-review.md)（master v8.3）§0.2 Y1c 行+启动方式/执行门机制+§0.1 裁决；Y0c spec 世代契约冻结直采；Y1a/Y1b spec v14.3 移交行承接。
- **硬前置**（Y1c 行）：Y0a+Y0.5 迁移链——已满足。
- **最终原则（用户 2026-10-24 裁定文档——v5）**：批准第六轮终裁架构反转。**Yjs 只负责协作内容；PostgreSQL 是业务状态唯一权威源；Spool WAL 是协作更新快速持久化入口；Runtime Feed 承担业务状态投影传输（Stateless 只通知不交付）**。推翻 v4「doc 内受控投影」原则——投影整体出 doc，服务端 serving 期零业务 doc 写入。

**修订链**：
- v1（2026-10-23）——首版合稿：三路一手核验+四片锚定+Z1-Z8 呈裁。
- v2（2026-10-23）——外审一轮+用户终裁 C-1~C-6+两收回+两修正（C-1 exec 留 doc 隔离撤销写权限/C-2 补原子准入/C-3 读者改道同单元/C-4 保存屏障随载体/C-5 最小富文本绑定前移/C-6 四片+批末单发布）。
- v3（2026-10-23）——外审二轮采纳（R1-R12+B1-B20 全实证+用户三项确认 v3-1~v3-6）。
- v4（2026-10-23）——外审三轮采纳+用户两项裁定（v4-1 三档准入/v4-2 片序重排）+v4-3~v4-9 直接采纳；偏离登记 11-15。
- plan v1（12fa3e8e）→第四轮终裁全采→v1.1（87c8507f）→第五轮终裁全采→v1.2（47e37467）。
- **v5（2026-10-24）——第六轮外审「复核终裁」评估（方向批准）+用户裁定文档落定：架构反转版（非补丁）**。三支柱实证：①`deliverArtifact` 同事务写 `data.fileId/result`+`exec`（collab-document.service.ts:248-264——服务端写 doc 的真源是交付投影）；②**服务端决策零读 doc.exec**（全 api 仅写守卫/GC/vacuum 搬运三处；决策全 PG）；③web 单点摄入 projectExecToStore+UI 只读 execStatusView+execAligned PG feed 已在。辅证=单实例钉死（ecosystem instances:1〔E35〕+factory:66-67〔Y0a-3〕）+vacuum/generation/缓存键三重耦合+NODE_TYPES 缺 group/videoEdit+受理行断链（GenerationIntent claim 才建）+spool 已是 WAL（CRC/fsync/目录 fsync）+y-protocols errorHandler 钩已在。**废止 v4-4/v4-5/v4-7/§2.7-e 及 plan v1.2 的 provenance/shadow/candidate/admissionEpoch/屏障拦截/y-protocols fork/RetentionCoordinator/transform**——偏离登记 §0.3 16-25。处置：本 spec 定案（用户过门）→plan v1.3 重写（五阶段）→实施。

---

## §0 裁定与定案

### 0.1 v5 定案（v5-1～v5-15，冻结——实施期不得重新引入旧机制）

- **v5-1 四平面架构**：Yjs 协作平面（多人文本/结构合并）/PG 业务权威平面（执行、交付、计费、生命周期、维护、幂等、恢复）/Spool WAL 持久化平面（协作更新快速持久化入口——fsync 后 apply，PG 批量后置）/Runtime Feed 平面（业务状态投影传输——有序、可恢复、游标续传）。Yjs 更新的交换/结合/幂等性只保证可安全合并重放，**不替代授权、事务与幂等控制**；不采用 Hocuspocus 常规持久化钩子——保留自有 WAL/批处理管线并明确其与 Hocuspocus 生命周期的集成契约。
- **v5-2 权威边界**：doc 三根 `meta/nodes/edges`（**exec 根删除**；meta 收缩为 schema 白名单内的用户可编辑配置——身份/权限/维护标志等服务端控制字段禁入）。迁出：`doc.exec` 全部、`data.fileId/result/status` 等服务端交付字段、任何「服务端计算又写回 nodes」的派生元数据、维护标志/执行围栏/内部身份/业务版本字段。**服务端 serving 期零业务 doc 写入=可测试不变量**；初始化/硬重置/离线导入=受控生命周期操作，不入普通请求路径。
- **v5-3 spool-first 写管线**：准入→帧字节精确 copy+帧 ID/单调序号→WAL fsync（含新段目录 fsync）→apply→广播→后台按**连续 WAL 前缀**批量写 PG（单事务多行）→推进持久水位。**禁止逐帧 PG 事务为默认路径**；保留现有批处理（512 条/8MiB+1MiB 分片实证在役）。
- **v5-4 ACK 持久性三档**：`Applied`（已应用未持久化）/`Spooled`（WAL fsync——本批同步接收的 ACK 等级，仅本机故障模型内可恢复）/`Durable`（PG 连续前缀已提交）。客户端按实际 ACK 级别展示状态，不得把三档映射成同一个「已保存」。耐久契约五档：`local→synced(applied)→spooled→durable(PG)→archived`——spooled 档=kill -9 可恢复、整机丢失不可（诚实登记）；机损 RPO=PG 批延迟（有界秒级），生产由 T29 PITR 兜。
- **v5-5 代际四元解耦**：`generation`（文档身份/schema 代际——硬重置与 schema 迁移才变）/`vacuumEpoch`（压缩操作代次——每次 vacuum）/`snapshotRev`（快照版本）/`appendSeq`（协作更新持久化序号）。普通 vacuum 不触发文档身份切换（不换 docName、不换缓存键族——4410 `doc-vacuuming` 载荷带 `discardLocalCache:true` 显式清）；`schemaVersion` 变⇒`generation` 必变（启动断言，违反拒绝启动）。八版本维度各司其职（§5.2），禁单一全局数字。
- **v5-6 全类型 schema 矩阵**：以真实创建/保存/加载/执行/导入/导出路径建立**唯一节点类型清单**（含 `group`/`videoEdit` 等 NODE_TYPES 之外的持久类型——33+2 处实证）+全路径字段矩阵（容器类型/写者/读者/权限/预算/撤销/导入导出）。未知类型不静默降级：写侧明确 schema 错误拒绝；读侧必须有显式只读保真策略。
- **v5-7 字段容器语义按真实协作行为**：字符级并发纯文本=`Y.Text`；Tiptap 富文本正文/prompt=`Y.XmlFragment`（PromptInput=Tiptap+Mention(/,@)+Image 实证——不得当纯文本、不得留过渡形状）；稳定配置/布局 `position{x,y}`=`Y.Map` 逐键；集合=顶层共享结构（稳定 ID+结构操作规则）；媒体列表=`Y.Array` 或显式 LWW（不默认整数组覆盖——迁移单卡读写同卡）；执行/交付/计费状态**不入 Yjs**。
- **v5-8 ExecutionRequest 受理行**：受理时单事务冻结 `projectId/nodeId/generation/docSeq`（绑定已受理文档前缀——必要时等待该前缀持久化或用可验证已持久检查点）/规范化 prompt+富文本快照/referencedImageIds/upstreamMediaIds/参数快照/paramsHash/requestId（唯一幂等键）/userId/权限裁定/输入 schema 版本；前缀/权限/大小校验失败=整体失败不落半条记录。`GenerationIntent`=执行意图记录（claim 时创建并关联 requestId，不再承担受理职责）。**worker 零 doc 读**。
- **v5-9 Runtime Feed**：PG 当前状态表+Outbox 事件+客户端投影。每项目/订阅域可比较事件游标；首连=快照+游标；重连=游标续传，游标失效=全量快照；事件应用幂等（旧版本忽略、缺口触发对账）；旧 generation 事件不污染新代。`docSeq/execSeq/eventVersion/artifactRev` 语义独立。**Stateless 消息只做通知/唤醒，不承担唯一数据交付责任**。
- **v5-10 单 UndoManager**：画布级单管理器（nodes/edges+编辑器挂载时 `addToScope(fragment)`）；编辑器不挂第二套 UndoManager/yUndoPlugin；Tiptap 焦点快捷键经薄 keymap 路由到统一管理器；文本+画布共享同一撤销栈（跨编辑器顺序非全局=产品语义，写入契约）；**历史清理=精确依赖交集释放（E26 承袭——禁粗暴 clear 作默认策略），`clear()` 仅预算耗尽兜底**；doc rebuild 仅在测量超标后做。
- **v5-11 本地缓存 per-tab+merge**：每标签独立记录（tabId/snapshot/stateVector/savedSeq/unsyncedDirty/diverged/at）；boot 读同键全部记录 `Y.mergeUpdates` 后 apply（CRDT 并集——两标签离线编辑都保留，SV 支配不够：互不支配仍丢）；clean 不覆盖/删除 dirty；同步成功删己记录；generation/vacuum 变更清整族；IDB blocked/quota 降级不阻断协作。
- **v5-12 单实例 ADR**：`instances:1` 为有意识选择的复杂度边界（非 HA）；同一时刻仅一个协作进程持有某项目活动文档写入权；**重启恢复顺序=先恢复 WAL→校验 PG 前缀→重建文档→再开放写入**；扩容=另立批（跨实例路由/所有权转移/持久化 fencing/分布式恢复），不得直接改大 instances。
- **v5-13 硬重置**：无存量数据——不维护 v3→v4 双读/双写/fallback/渐进兼容；DB schema+doc schema+客户端模型统一切换；reset 脚本（drop/recreate 表/清 spool/清本地缓存键/清公开快照缓存）可重复执行+测试种子+迁移验证+回滚到已知代码版本说明。
- **v5-14 恢复模式**：握手比较 `g_client` vs `g_server`；`g_client>g_server`（服务端 PITR 回滚）→4410 `server-restored` **不清缓存**，进入只读 recovery+可导出草稿，管理员选择接受客户端世代或从备份恢复（现状导出→purge→reload 承袭，补接受/合并路径——现状非静默丢，有导出备份）；`g_client<g_server`（主动换代）→4410 全会话重建维持。
- **v5-15 质量门结构**：六项 go/no-go（§9.1）=**工程门**（实施团队按证据自判，不是用户审批节点）；阶段出口（P0-P4）=用户确认点维持；世代切换首次真跑=执行门（单独请用户确认）。

### 0.2 master 裁决效力（v5 精简重注——E30 自包含）

| 裁决 | v5 效力 |
|---|---|
| E3（generation 载体=docName #g） | 采纳+**v5-5 修订**：#g 仅 schema 迁移/硬重置变化；vacuum 不动 name |
| E23/E61/E62（世代连带/重建命令/Snapshot 追加） | 采纳：buildDocName 唯一构造器+静态门维持；重建=类型化导出 fresh doc；Snapshot(g,rev) 追加+stateHash；compact 分批+worker 进程（授权=行锁+CAS 不拿租约） |
| E26+E33（keep GC 交集） | **全量承袭**（v5-10 单管理器形态——比 v4 协调器更简）；shift 泄漏现行 bug 修复维持 |
| E27（嵌套类型唯一创建者） | 采纳+**incarnation→PG lifecycleSeq**（数值序；不做 Yjs Item/struct adapter——私有 API 禁令维持） |
| C8（Y.Text 原地 splice） | 采纳（v5-7 容器矩阵） |
| E17/E38（manifest 派生断言） | 采纳（全类型矩阵+未分类即红+运行时准入面共用） |
| E2/E22/E64（exec 契约/undo 绑定/outbox） | **v5 反转**：exec 出 doc（§6）；undo scope=[nodes,edges+fragments]；outbox=ExecutionOutbox（generation+businessKey） |
| C7③/E45 | 采纳（维护窗口+drain runbook；env 预留档 -3） |
| Z 系列/E30/E35 | 承袭（spec 自包含/单实例 ADR 化——v5-12） |

### 0.3 偏离登记（spec 级，续 v4 的 11-15）

| # | 偏离 | 废止/修订对象 | 依据 |
|---|---|---|---|
| 16 | exec 根删除，运行时状态走 PG+Runtime Feed | 反转 v4-4（doc 扁平组件键/单展示源=doc.exec）与 v2-C1 | 第六轮三支柱实证 |
| 17 | 服务端 serving 期零业务 doc 写（含 data.fileId/result/尺寸——尺寸改 feed 下发→客户端以用户域 origin+显式白名单写回） | 反转 §2.7-e「带效果整帧同 PG 事务→apply」及 v1.2 candidate-first/shadow/clone/ServerDocWrite 服务端写链 | deliverArtifact:248-264 实证 |
| 18 | admissionEpoch 删除——单 gate 串行受理+freeze 标志+drain 全部已受理帧（单入口下「冻结前后」由 gate 停收直接界定） | 反转 v4-5 及 v1.2 懒块分配 | CollabLease 单行+gate 单串行口实证 |
| 19 | CanvasDocProvenance 删除——服务端零写 doc→客户端上行永不携带 server structs→区间授权/每代缓存威胁模型整体蒸发 | 反转 v4-7 及 v1.2 偏离 27 | B3 reset 场景随架构消失 |
| 20 | 保存屏障=onStateless flush+回执 {nonce,committedSeq}（处理器**首语句同步捕获已受理前缀**——statelessCallback 同步调用但不被 await 的竞态纪律）；v1.2 的 beforeHandleMessage 拦截/frameSeq 绑定废止 | 修订 v1.2 偏离 29 | round-5 A1/A3 实证+第六轮终裁 |
| 21 | vacuumEpoch 独立——vacuum 不改 generation/docName/缓存键族 | 修订 v4 T11 #g 语义 | vacuumReplace generation+1（:211-217）+缓存键含 g（local-cache-key:24-26）实证 |
| 22 | 耐久契约 v4-8 四档→五档（插 spooled）+ACK 三档 | 修订 v4-8 | spool WAL 资产实证（CRC/fsync/目录 fsync） |
| 23 | inputSnapshot 废止→ExecutionRequest 受理行+docSeq 前缀绑定 | 修订 v1.2 偏离 18（GenerationIntent claim 才建行——受理写不存在的行） | generation-intent.service:251+execution.controller:33 实证 |
| 24 | RetentionCoordinator 删除（单 manager+E26 精确释放+addToScope）；y-protocols fork 删除（优先服务端注入 errorHandler+post-check；最小 patch 仅 server 侧+上游差分回归） | 修订 v1.2 偏离 26/33/24 | 单管理器现状（canvasUndo:28-31）+sync.js:82 errorHandler 实证 |
| 25 | NODE_TYPES 不作全集——全类型矩阵（group/videoEdit 入册+只读保真策略）；T2 最小修（:157 停覆盖，prompt 只随请求发送不落 doc，终形 P2 落） | 修订 v1.2 T3/T2 | nodeStore:17-24+canvasStore 33+2 处+PromptValue/PromptInput 实证 |

## §1 基线与实证锚点

### 1.5 第六轮新增锚点（2026-10-24 三路核验全 CONFIRMED，B8 为 PARTIAL）

- **服务端写路径**：deliverArtifact 同事务写 data+exec（collab-document.service.ts:248-264；writeExecStatus 嵌套 Y.Map 缺则 new :307-326）；**服务端 doc.exec 仅 3 触碰**（写守卫 :311/GC :380/vacuum 搬运 registry:640,661）——readCanvas 出口不带 exec（docShape:103-131）；执行决策全 PG（execution.service:183,:445；materialize 零 doc 读；poller 决策全 PG）；注释自认「exec=UI cache 面，非交付判据」。
- **web 摄入面**：projectExecToStore 唯一（runtime:726-744+observeDeep:1996）；execStatusView store 切片唯一 UI 源；**execAligned PG REST 已在**（alignExecFromIntents:756-778）。
- **拓扑**：ecosystem.config.cjs:15,:44 `instances:1`（E35）；factory:66-67 跨实例挂载删除（Y0a-3）。
- **代际耦合**：vacuumReplace `generation+1`（repository:211-217）；shrink 关连接后同 doc name（:292-347）。
- **shape 现实**：NODE_TYPES 6 个无 GROUP/VIDEO_EDIT（nodeStore:17-24）；group（33 处）/videoEdit（2 处）真实持久（ydocBuilder.test:44-64 往返锚）；PromptValue{text,html,referencedImageIds}（nodeStore:99-103）；PromptInput=Tiptap+Mention+Image（PromptInput.tsx:10-14,:295-331）；position=嵌套 Y.Map{x,y} 逐键（collab-doc-ops:44-59）；allImages=plain array 整串替换全仓零 Y.Array 写点（nodeStore:716-720/canvasIntents:151-157/useImageUpload/CanvasView:261-264）。
- **受理断链**：enqueue「claim 之前零外呼零冻结零意图行」by design（execution.controller:33）；GenerationIntent 仅 claim 时 createMany（generation-intent.service:251-264）。
- **WAL 资产**：spool `[len][crc32][payload]`+fsync（spool.service:2,:294-296,:302-303）+新段目录 fsync（:320-329）；批 512 条/8MiB+1MiB 分片（persistence:45-46,:229-239,:280-282）。
- **协议**：y-protocols readSyncStep2 第 4 参 errorHandler 已在（sync.js:82——内部吞错仅 console.error）；Hocuspocus 不传+无条件 writeSyncStatus(true)（esm:277-281,:286-292）——吞错假 ACK 实证。
- **undo/缓存**：单 UndoManager(nodes/edges,LocalUser,500ms) 现状（canvasUndo:28-31）；shift 不释放 keep（:41-43）；keepItem 沿 parent 链（yjs.cjs:9593-9598）；本地缓存记录仅 4 字段无 SV/savedSeq（local-collab-cache:34-42；两 dirty LWW 注释自认 :12-14）；缓存键 uid:pid:g:s（local-cache-key:24-26）。
- **恢复现状（B8 PARTIAL）**：SV 门=clock 覆盖比较（registry:687-696）；PITR 回滚后 preVacuumSv 随回滚消失→门放行；客户端 doc-status `!==` 无方向（runtime:1479-1480）→导出→purge→reload（非静默丢；缺=接受/合并路径）。
- **权限**：perm.changed 即时踢权已在（session-guard:919-947；5min=兜底 TTL :313）。
- （承袭：v4 §1.3/§1.4 的 24-56 号锚点继续有效——两现行 bug〔isTextNode 'text'/'textInput' 分裂；TextConfigPanel:157 覆盖正文〕/POST /canvases 缺头/39 裸构造/50ms 全量投影/FOR SHARE 心跳冲突等。）

## §2 四平面架构总纲

```
Web 客户端          Y.Doc / Tiptap / 单 UndoManager / 本地草稿(per-tab) / Runtime Store
协作入口(Hocuspocus) 身份与权限 · 帧解码 · 结构/字段校验 · 限流与预算
                    合法更新 → WAL spool fsync → apply → 广播
协作持久化平面      Spool WAL → 批量 PG append（连续前缀单事务）→ Snapshot / Vacuum
业务执行平面        ExecutionRequest → GenerationIntent → Worker → NodeArtifact → Runtime Outbox
Runtime Feed/REST   PG 事件与当前状态 → 有序推送 · 游标续传 · 客户端增量投影
```

| 数据 | 权威源 | 传输 | 客户端 |
|---|---|---|---|
| 协作内容（meta 白名单/nodes/edges） | Y.Doc（经 WAL→PG 前缀） | CRDT 同步 | Y.Doc+投影 |
| 执行/交付/计费/生命周期/维护 | PG | Runtime Feed（游标） | Runtime Store（只读缓存，不参与 CRDT 合并） |
| 服务端计算尺寸等派生 | PG 业务记录 | Feed 下发 | 客户端以用户域 origin+显式白名单写入 doc（离线可见） |

写管线不变量：①客户端帧由 gate 拥有持久化——update listener 不得对 connection-origin 二次 append；②ACK 前帧已在 WAL fsync；PG 失败不丢帧只延迟；③snapshot/compact 只从 PG log 的 seq 前缀生成；④save barrier 返回的 committedSeq 是此前本连接全部帧的前缀；⑤业务输赢由 PG 事务+fencing token 裁定——doc 状态/网络通知/客户端缓存不得反向决定业务结果。

## §3 协作平面（Yjs=可协作内容唯一职责）

### 3.1 doc shape（v5-6/v5-7）

- 顶层三根：`meta`（用户可编辑配置白名单）/`nodes`/`edges`；`exec` 根及读写链路删除。
- 全类型矩阵（plan 冻结具体表，冻结自真实路径 census）：textInput{content:XmlFragment, prompt:Y.Map{text:Y.Text}}；audioGen/multiImageGen{prompt:Y.Text}；imageGen/videoGen/imageExtGen{prompt:XmlFragment（mention/image=PM 节点）→PromptValue{text,html,referencedImageIds}}；allImages/images=Y.Array（迁移单卡：写读同卡改道）；通用{position:Y.Map{x,y} 逐键, width/height/parentId:标量 LWW}；group{groupType/name/color/collapsed/order/storyboard/cells}；videoEdit{videoProjectId 等}；edges{source/target}。DataKeySpec 增 `map`/`items`/create·write·delete 写者矩阵；组合合法性断言（writer=server⇒ownership=server 等）。
- 字段所有权不止 TS 类型：运行时校验+写入 API 双落；未分类字段默认拒绝——用户不能靠构造 update 绕过前端限制。

### 3.2 FrameGate（收缩面）

准入序：身份/项目权限/generation/帧格式→解码+结构/字段权限/预算/图约束→帧字节**精确 copy 至独立 buffer**（禁 subarray 共享 buffer 直解——lib0 越界读实测）→WAL。**DENY 面**：受保护 root（exec 已不存在——写入即拒；meta 服务端字段）/未知类型/未知键/值类型错/容器替换（G17b 对抗面）/超预算（maxStructs/maxDsRanges/maxFrameBytes——**解压后大小**限；普通帧 1MiB；8MiB SS2 走 HTTP seed/worker；大帧 apply 不阻塞主线程）。**NORMALIZE 面**：悬挂边/父链环/跨组 parent/重复边（读侧确定性屏蔽+graph_anomaly_total{kind}；只读不写回）。**clientID 绑定**：struct clientID 首见绑定会话身份（扩展 session guard awareness 绑定链——perm.changed 即时路径复用），跨连接冒用 DENY。**无 provenance/无区间授权/无 shadow/clone**——服务端零写 doc 后威胁模型消失。

### 3.3 单 UndoManager（v5-10）

画布级 `UndoManager([nodes,edges],{trackedOrigins:LocalUser,captureTimeout:500})`+编辑器挂载时 `addToScope(fragment)`；不挂 yUndoPlugin；Ctrl+Z 薄 keymap 按焦点归属路由；文本+画布同一撤销栈（跨编辑器顺序非全局=产品语义）。栈上限=精确依赖交集释放（E26 单管理器形态）；`clear()` 仅字节预算硬兜底；doc rebuild 先测后建。

### 3.4 本地缓存（v5-11）

per-tab 记录+boot mergeUpdates 并集；clean 不覆盖 dirty；同步成功删己记录；generation/vacuum 清整族（vacuum 经 4410 `discardLocalCache:true` 显式清，不靠改键）；IDB blocked/quota 降级。

### 3.5 容器规则（G17 收缩）

结构创建时一次性建合法共享容器（唯一创建者=写 seam）；普通业务写禁懒创建掩盖结构错误；undo 重建合法（新容器）；恢复不得夹带服务器字段。**nodeId 即身份**；生命周期需要代际时用 PG `lifecycleSeq`（数值 BigInt——字符串序禁），不做 Yjs Item/struct adapter。

## §4 持久化平面（spool-first）

### 4.1 写入次序（七步）

①验证会话身份/项目权限/generation/帧格式→②解码验证结构/字段权限/预算/图约束→③帧字节精确 copy+帧 ID+单调序号→④追加 WAL+fsync（新段含目录 fsync）→⑤apply 到内存 Y.Doc→⑥广播成功应用的更新→⑦后台按批将连续 WAL 前缀写 PG（单事务多行），提交后推进持久水位。**spool-first≠先 ACK 后验证**——准入先于一切；ACK 与承诺的持久等级严格一致。

### 4.2 ACK 与耐久契约（v5-4）

Applied/Spooled/Durable 三档；save barrier=onStateless：flush 批量队列→回执 `{nonce,committedSeq}`（Durable 级前缀）；处理器首语句同步捕获前缀；barrier 触发即冲刷；拒帧连接屏障不可成功；断线新 nonce。

### 4.3 WAL 与内存 doc 原子性边界（状态机）

- WAL 写成功+apply 失败：隔离当前文档，停止后续可见写入，按持久前缀重建——**不得跳过该帧继续提交后续序号**。
- apply 成功+广播失败：不回滚已持久接收的更新；客户端经重连+SV 同步补齐。
- PG 批量提交失败：保留 WAL，不推 PG 水位，重试。
- 进程重启：先恢复连续前缀（从 PG 已提交水位重放 WAL），再开放写入。
- 无法证明状态一致：拒绝服务（fail-closed），不静默跳坏帧。
- SV 适合确定双方缺失结构，**不替代 WAL 提交水位**。

### 4.4 WAL 能力清单

单调帧序号/唯一帧 ID/CRC+可验证记录边界；持久确认水位+PG 提交水位+恢复时连续前缀校验；重复帧去重（幂等重放零重复业务效果）；部分批次失败重试；坏段隔离+告警；磁盘空间上限+写入背压+故障停收；崩溃恢复从 PG 水位重放（不依赖进程内状态）；快照指针发布与 WAL 清理分离（purgeBelowSeq 水位先持久再分批删，启动续跑）。

### 4.5 compact/vacuum

compact=快照前缀发布+WAL 分批清理（指针短事务+水位同事务持久+提交后 worker 进程后台删——COLLAB_ROLE worker，真进程隔离；授权=CanvasDoc 行锁+generation/appendSeq CAS，不拿租约）。vacuum=关连接（4410 doc-vacuuming）→重放重建→替换快照→**vacuumEpoch+1（不动 generation/docName）**→客户端 discardLocalCache 后同 name 重连（空 SV 放行不循环）。保留策略=检查点语义（当前代最近 2 份+旧代最终 1 份；禁删指针引用行）。

## §5 代际与版本模型

### 5.1 四元（v5-5）

| 字段 | 语义 | 变化时机 | 客户端行为 |
|---|---|---|---|
| generation | 文档身份/schema 代际 | 硬重置/schema 迁移 | 4410 换代，新 docName(#g)，清整族缓存 |
| vacuumEpoch | 压缩操作代次 | 每次 vacuum | 4410 doc-vacuuming，同 name，显式清缓存后重连 |
| snapshotRev | 快照版本 | compact 发布 | 不重连（最多 doc-status） |
| appendSeq | 协作更新持久化序号 | 每唯一 WAL/PG 更新 | ETag/水位 |

### 5.2 八版本维度

generation/appendSeq/snapshotRev/vacuumEpoch/docSeq（执行请求依赖的协作前缀）/execSeq（节点执行序）/eventVersion（节点运行时状态版本）/artifactRev（产物槽位版本）——作用域/比较方式/持久化位置/重置规则各自明确；**BigInt 入 JSON/WS payload 显式 String()**（bigint-json gate 进 verify）。

### 5.3 缓存键双轨

公开快照（已发布检查点）=(projectId,generation,snapshotRev)；read model 缓存（新鲜度）=(projectId,generation,appendSeq) 或等价持久水位——不混用。

## §6 业务平面（PG 唯一权威）

### 6.1 ExecutionRequest（v5-8）

受理事务冻结：projectId/nodeId/generation/**docSeq（绑定已受理前缀）**/规范化 promptText+promptHtml 快照/referencedImageIds/upstreamMediaIds/参数快照/paramsHash/requestId（唯一幂等键）/userId/权限裁定/输入 schema 版本。客户端流程：save barrier→拿 committedSeq→带 docSeq 调 execute；服务端等 `appendSeq>=docSeq` 再冻结输入。校验失败=整体失败零行。**输入大小上限+PII 策略**（promptHtml 仅存储不渲染/媒体引用白名单/日志禁整 payload）。

### 6.2 执行链

`ExecutionRequest → GenerationIntent（claim 创建/关联 requestId）→ Worker（零 doc 读）→ NodeArtifact（权威交付）→ ExecutionOutbox`。NodeExecution=**当前行表** PK(projectId,nodeId)+projectedExecSeq/projectedEventVersion 元组（历史留 GenerationIntent；artifact 槽位版本读 NodeArtifact 不建第二套）；ExecutionOutbox 唯一键含 generation+业务幂等键 businessKey（null intent 以 businessKey 去重）+claim lease（claimedAt/leaseUntil/nextAttemptAt+SKIP LOCKED）；pending outbox 行不按 watermark 过滤；冷装载/换代/恢复全量对账，watermark 只增量追赶；ArtifactProjection 分步退役（先证明新 outbox 覆盖六终态/重试再删）。

### 6.3 交付状态机与退款 fencing

文件生成/对象存储上传/DB 事务非原子——可恢复交付状态机：受控上传任务→受限 objectKey+版本标识→校验身份/大小/完整性/权限→带执行身份 fencing 的 DB 事务终局→outbox 事件→未完成/失效/孤儿可重试清理。退款/删除引用精确业务记录（exact settle row/reversesId 幂等），不依据客户端 doc 字段或过期 worker 状态。materializeRunId/expectedExecSeq/StorageReservation 终态释放/GC delete-claim 承袭 v4 §2.9。

### 6.4 尺寸元数据模式

服务端计算尺寸→写权威业务记录→Feed 下发→**客户端以专门用户域 origin+显式字段白名单写入 doc**（离线可见；不把任意服务器响应回灌用户可写字段）。

### 6.5 生命周期义务（G13/G14 收缩形态）

服务端**只读观察**已受理帧的 nodes/edges 事务→NodeLifecycle（lifecycleSeq 数值序+当前行 partial unique）/DeliveryFence 义务行**与对应帧前缀的 PG 批事务同事务落库**（帧↔义务原子）；incident-edge/media 反查用轻量反向索引（edgesByNode/mediaRefsByNode——装载建+增量维护）。delete 已删=no-op 不二次退款；undo 重建=新 lifecycleSeq+恢复态；delete+restore 同帧=两行；两项目同 nodeId 不互串。

### 6.6 维护窗口（T10-lite）与 genesis

freeze（gate 停收标志）→drain（全部已受理帧至 PG——单串行口无需 epoch）→unload→export（DocCodec canonical）→fresh doc→generation++→snapshot0；stage/水位持久化（MaintenanceOperation 表+幂等键+REST 控制面 admin guard；维护执行者=租约持有者）；空画布保头升代；归档=保留一份 PG dump 回滚（在线归档删除）。genesis 双路+缺头三态承袭（project.service/canvas.service 原子建头+snapshot0；missing/present/corrupt；先 reset 再 migrate）。

### 6.7 删除清单（frozen——P4 收口，删码与新路径同可编译切片）

`CanvasDocProvenance`/区间授权；shadow doc/full clone/candidate-first/ServerDocWrite 服务端写链；admissionEpoch 块分配与 spool epoch 帧头；RetentionCoordinator；`transformV3ToV4Draft` 与在线归档；y-protocols fork 与 FrameApplyReceipt wire 协议；doc.exec 读写链+writeExecStatus+deliverArtifact 的 doc 写+`data.fileId/result/status` 写者与 fallback（execAligned/data.status）；v3 兼容层；无调用方的多管理器协调与过度代际维护机制。

## §7 Runtime Feed 平面（v5-9）

每项目/订阅域可比较事件游标；首连快照+游标；重连续传，游标失效全量快照；事件幂等（旧版本忽略/缺口对账）；旧 generation 事件不污染新代。「WebSocket 没断」≠事件必达——feed 通道+REST 对账双路（execAligned 扩展为带游标订阅恢复）。UI 契约：feed 未到=exec `unknown`（生成按钮禁用，**不显示 idle**——防重复点击）；离线 exec 不可见不影响内容编辑。

## §8 恢复、耐久与安全

### 8.1 4410/4411 语义（v5-14）

4410 三分：`doc-generation-stale`（主动换代——全会话重建）/`doc-vacuuming`（同 name+discardLocalCache）/`server-restored`（g_client>g_server——不清缓存，只读 recovery+草稿导出+管理员裁定接受/备份恢复）。4411=REJECTED/RESYNC（shared collab-close-code 注册链+resolveCloseAction 档）。拒帧恢复（REJECTED/DIVERGED+DraftEnvelope+同代 fresh doc+TypedDraft）承袭；DraftEnvelope 补 merge policy 算法（类型冻结同步定）。

### 8.2 Yjs≠权限系统

文档准入按身份/项目权限/字段白名单/节点类型/预算；业务权限在 PG 事务内重新核验；客户端 origin 非安全凭证；服务器专有数据不因合法 CRDT update 被覆盖；**projectId=项目/团队/个人统一业务隔离边界**——团队权限由项目成员关系+服务端授权定，不据 WS 会话或 UI 状态推断。

### 8.3 双验收线（D12）

本批交付线：单实例+WAL 持久化+PG 批量提交+恢复重放+快照压缩+协作权限+运行时对账（诚实登记：单机不声称 HA；机损 RPO=PG 批延迟）。生产上线线=T29 独立批：PITR RPO≤5min/RTO≤30min+对象存储版本化 RPO≤15min+季度 restore drill+每小时 replay canary（snapshot+updates 重放 fresh doc，semanticEqual/SV 对比，不一致告警并冻结 compact）+HA 决策+告警处置——任一未过不得开放生产流量。

## §9 质量门与验收

### 9.1 六项 go/no-go（**工程门**——按证据自判；任一失败=对应任务先改再写码）

| 门 | 必须证明 | 不通过处理 |
|---|---|---|
| G1 真实 schema 与 PG 表形 | 全类型/全 Prisma 关系/迁移/事务约束过验证（prisma validate+migrate diff+dry-run） | 修模型重跑，禁绕过迁移校验 |
| G2 WAL 与 PG 连续前缀 | fsync/批次失败/重复帧/重启重放/快照发布与清理全正确（§4.3/4.4 故障矩阵） | 不得进内容迁移 |
| G3 富文本与撤销 | Y.Text/嵌套 XmlFragment/mention/undo-redo 双端并发通过 | 调容器或绑定，禁临时 JSON 垫片 |
| G4 ExecutionRequest 与 docSeq | 受理输入与文档前缀一致；重放不改已冻结输入 | 修受理事务与前缀协议 |
| G5 Runtime Feed 可靠性 | 断线/漏推/重复/乱序/旧代事件均可恢复 | 不得移除旧投影写者直至新链路过；最终只留一条权威路径 |
| G6 单实例故障恢复 | kill -9/坏 WAL/PG 不可用/磁盘满/重启符合耐久契约 | fail-closed+隔离恢复，禁静默丢弃或越过持久水位 |

P1 验收主线（真实故障顺序）：同帧重复送达零重复业务效果；PG 提交失败 WAL 可恢复且水位不越过失败帧；fsync 前后 kill 符合 ACK 等级；PG 提交成功但内存水位未更新即崩溃→重启零重复；snapshot 已发布 WAL 未清理时重启正确；WAL 达清理条件后重启不误删；坏 CRC/截断/缺号/重复 ID 分类隔离告警。

### 9.2 CI 测试清单

三面 tsc strict；Prisma validate+迁移重建+真 PG 集成；双客户端同节点/异节点/边/富文本/媒体列表并发；篡改类型/服务器字段/嵌套容器/序号/版本拒绝测试；WAL 崩溃点矩阵/重复批次/PG 故障/坏段/水位恢复；feed 断线/游标续传/重复/乱序/旧代；ExecutionRequest 冻结/worker 抢占/过期迟到写/退款重试；vacuum×append 并发/快照发布×分批清理交错；删除/undo 重建/媒体引用/GC claim 竞态；双浏览器/多标签/IDB blocked/拒帧恢复；10k 节点+8MiB 混合+10 连接压力基准。

### 9.3 观测指标

`wal_fsync_latency`/`wal_pending_bytes`/`doc_pg_lag_seq`/`doc_prefix_gap_total`/`doc_recovery_total`/`doc_frame_rejected_total{reason}`/`runtime_feed_lag`/`runtime_feed_gap_total`/`execution_fence_rejected_total`/`doc_snapshot_bytes`/`doc_compaction_duration`/`doc_append_gap_total`。按项目或有限维度聚合（禁高基数 user/pid 标签）；日志禁完整 prompt/正文/敏感 URL/整 payload。

### 9.4 性能门禁原则

10k 冷加载测服务端解码/装载/read model/首屏；8MiB 测传输/解码/fsync/apply/PG 批/投影；可见节点与文档总量分开（viewport culling 控 DOM 规模）；全部报 P50/P95/P99+CPU/RSS/磁盘 IO/PG 锁等待；**先建基准再把实测转 CI 门禁**，不预声称指标。

## §10 阶段表与任务处置

| 阶段 | 内容 | 出口 |
|---|---|---|
| **P0 契约** | 全类型 schema 矩阵+DocCodec 双出口（canonical+read model，zero-yjs DocLike 注入）+两现行 bug（T1 isTextNode 单源；T2 最小修——:157 停覆盖，prompt 只随请求发送不落 doc，终形 P2 落）+ExecutionRequest/RuntimeEvent/水位/WAL 帧协议契约冻结+census 静态门（含服务端读者） | **用户确认点①**（契约门） |
| **P1 载体** | PG 新表+genesis 双路+文档头/generation；单实例 ADR+spool-first 写管线+连续前缀+批量提交+快照发布+崩溃恢复（真实故障顺序验收）；Runtime Feed 最小闭环+游标续传；vacuumEpoch 解耦 | G1/G2/G6 过→**用户确认点②** |
| **P2 内容** | 全类型矩阵落地+Y.Text/XmlFragment/Y.Map/媒体数组语义；容器唯一创建者规则先行→Tiptap 双端绑定/mention/粘贴/IME；单 UndoManager+精确释放；全读者切 DocCodec read model；删旧字段与兼容层 | G3 过→**用户确认点③** |
| **P3 业务** | ExecutionRequest 受理冻结；PG 权威执行态+Outbox+Feed 全量；worker fencing/交付幂等/退款义务；收缩 FrameGate/图异常 NORMALIZE/拒帧恢复；可靠快照订阅+游标恢复+节点增量投影；维护窗口+4410 三分+恢复模式 | G4/G5 过→**用户确认点④**（含世代切换首次真跑执行门） |
| **P4 交付** | reset-collab 工具+部署顺序；多浏览器/并发/断网/kill/磁盘/PG 故障演练；10k+8MiB 负载；删除清单执行（删码与新路径同切片）；发布门禁+dev/test 限制登记+T29 前置条件 | **用户确认点⑤=全批终出口**（证据汇编） |

任务处置（plan v1.3 依据）：T0-T5=保留重写契约；T6-T9=重写 WAL-first/前缀/批量/vacuumEpoch；T10-T11=删 admissionEpoch 与换代 vacuum，保留维护+文档身份；T12-T15b=保留重构（内容/富文本/单 manager/lifecycleSeq/codec）；T16-T19=删 provenance/candidate/shadow/服务端写屏障，保留收缩 FrameGate/拒帧恢复/维护控制/生命周期义务观察器；T20-T23=重构 ExecutionRequest/PG 权威态/Outbox/Feed/交付退款 fencing；T24-T27=读者迁移/可靠 feed/增量投影/资源回收/压测；T28=发布门禁（硬重置/旧消费者清理/WAL 恢复/真实故障演练）；T29=独立生产前置批。迁移按依赖顺序串行，禁并行依赖同一 schema 状态。

**门禁映射**：v4 的 G1-G33/B1-B20 由 plan v1.3 按新架构重编号——requires 规则（任何 gate 依赖后序任务=评审红）与「每卡先红（真实变红+真 PG 并发）→绿→commit」纪律承袭。
