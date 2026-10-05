<!-- doc-status: canonical | verified_at: 2026-10-06 | note: 画布 Yjs 升级工程开发计划文档目录——本工程唯一执行依据；各批次由用户单独启动 spec→plan→TDD 三阶段（每阶段确认后执行），本目录不承载执行过程记录；2026-10-06 v7：A+C+D+E 四系（E 系含 v7 修订 E33-E40：撤回 Y6 零回收论证/E26 修法改重建/Y.Text 升格/stateSeq/租约四语义/上线门槛/Y1c 拆三片），批次 0号→Y0a/b/c→Y0.5→Y1a/b/c-1/2/3→Y2-Y7 -->
# 画布 Yjs 协作架构升级——开发计划文档目录

日期：2026-10-06
定位：**开发计划文档目录**——升级工程的批次索引。后续开发以本目录为入口，由用户逐批启动，每批单独走 spec → plan → TDD 三阶段（每阶段经用户确认后执行）；本目录只维护批次范围与 spec/plan 链接回填。
由来：基于 2026-10-06 代码实证审核（三路并行勘察：写路径/撤销系统/协作持久化，关键事实二次人工核实）升格而成，审核结论即各批次范围依据（见 §1-§5）。

---

## 0. 结论速览

| 议题 | 裁定 |
|------|------|
| Q1：裸写 `capture+dispatchProjectionDiff` 是否全部重构为 `runCommand` | **建议执行**，定性为"写入口规约收敛"而非架构重写；推翻 R2 过渡期"既有命令不动"裁定（canvasStore.ts:1758），风险可控、分片迁移 |
| Q2：是否改用 Y.UndoManager 绑定 Y.Doc 共享类型 | **无需切换——现行实现已经是**（canvasUndo.ts:16-19，2026-09-30 Yjs 上线时同步切换，旧 zundo 快照方案已退役）。评估转为"补强清单" |
| Q3：Y.UndoManager 是否为 Yjs 原生撤销重做模块 | **属实**：`yjs` 包原生导出，专为共享类型（Y.Map/Y.Array/Y.Text）设计；本项目已在生产使用（yjs ^13.6.32） |
| 目标架构四要素 | 服务端权威持久化 **行级已落地**（v5 E11 勘误：compact 竞态/失败蒸发/Redlock skip 三条丢数据路径——Y0 修）；PG 内快照+GC 行级已落地（struct 不回收，Y6 可见态重建）；**y-indexeddb 离线缓存缺失**（TD-19）；**COS 定时快照缺失**；**水合优先本地缓存缺失** |

**一个重要澄清**：用户背景陈述中"彻底淘汰老旧个人项目架构"——勘察证实画布链路的个人模式架构**已在 collab 恢复工程中淘汰完毕**：`openSession` 一律 `initCollab`（canvas/page.tsx:115-125），单人=成员数 1 的协作特例，autosave PUT 链路已退役（canvasStore.ts:185，ADR 0001）。现存"老"的只是**写法习惯**（裸 capture/diff 展开式），不是架构分叉。这把 Q1 从"架构迁移"降格为"代码规约收敛"，风险量级显著下降。

---

## 0.1 架构裁决（v7，2026-10-06 十八轮评审收敛；A=方向，C=终局细化，D=落地闭环，E=正确性前置与事实校正（E20-E32=v6 修订，E33-E40=v7 修订））

| # | 裁决 | 结论 |
|---|------|------|
| A1 | 真源反转主轴 | **确认（v2）**：Y.Doc 唯一真源、canvasStore 退瞬态。v3 补关键二分（C1）：要删的是**双真源仲裁层**（reconcile 仲裁身份/手势让位/写者账本/EPS 容差/ratchet），**坐标换算保留**并收敛为唯一纯投影出口（deriveRenderCanvas，已存在且 0.7ms 级）。原 U1 作废不变 |
| A2 | 时间轴文档粒度 | **确认（v2）**：同 doc，按视频节点 id 键控；跨 doc 无事务破坏 sourceNodeId 级联。v3 补两项入 Y4 spec：编辑器与画布同开的连接/驻留放大预算；sourceNodeId @unique 处置（同 doc 后时间轴以 nodeId 寻址，@unique 恰为 doc 键唯一性背书，倾向保留——spec 时终裁） |
| A3 | 组渲染与坐标 | **v3 修订（坐标半条作废）**：doc **保持 abs**（O0b-0 格式批刚完成 rel→abs 且 rel-as-abs 洞已根治——docShape.ts:41 注释实证；再翻一次=churn+重写新落地帧 oracle 族+新造 rebase 机器，rel 边际收益=移组 1 写 vs N 写不足以支付）。RF parent/child 维持（即现状，交互层零重写成立）；背景矩形维持远期选项。v2 的"doc 存 rel"论证缺陷自认：只分析了移组场景，漏了 auto 组子移动重基与持久化 origin 的循环定义问题 |
| A4 | 批次切分 | **v3 修订**：拆分标准="单实例下是否已成立"。成立的正确性项前移 Y0（WS 准入/连接与节点上限/资金路径 fail-closed/观测三指标/版本协商门）；纯多实例运维项留 Y7 挂上线前 |
| A5 | y-indexeddb 库行为复核 | **确认（v2）并强化（v3）**：立项首件事=库源码复核（丢失机制/trim 阈值/Leader 交接时序全部用例化）；防御性设计直接采纳；追加两条前置约束——新持久化模块不得自建 provider/直碰 hydration（走 setHydration 单写者，已有静态扫描锚）、缓存 DB/键名编码 schema 版本+generation |
| C1 | 坐标语义终局 | doc=abs 世界坐标终局；rel 仅在唯一投影出口派生（deriveRenderCanvas）。Y1 **无坐标翻转、无 rebase 规则**；帧 oracle 族（assertions.ts/geometry.ts 帧判据）保留不重写。reconcileGroupGeometry 职责二分：仲裁身份删除（Y3），换算职责并入投影出口 |
| C2 | 手势期 doc 零写 | 现状核验：拖动/组 resize **已会话化**（commitIntents/commitResizeGesture 松手单 transact，"手势期 doc 零写"注释实证）；残留缺口=叶 resize 逐帧落 doc（无 session 常规路由 position 批走 Geometry）+无 session 门仅 DEV 告警。Y3 补齐：会话模型铺满全部手势、DEV 告警升生产断言、提交点补 pointercancel/pagehide/visibilitychange→hidden。验收锚：任一手势 doc update 恰 1 次。已知限制：硬崩溃丢当前手势（回起点），接受 |
| C3 | 执行态单一真源=exec | nodes.*.data 的 status/fileId **降级为投影期合成**（Y2 落地）；服务端停写这两键（产物字段 content/result/videoUrl 保留）；节点删除同事务清 exec[nodeId]；sweepOrphanExec **整删**（全量加载问题随之消失，投影期忽略孤儿+健康计数兜底）；socket.io node:status 第三真源随 Y3 收口。前置：Y1 spec 时 grep data.fileId 全读者并改道 |
| C4 | 读一致性两步走 | **Y0（最小诚实修复）**：全资金路径强制 sv+fail-closed（超时 503 不降级；execute 已传、regenerate 补齐——现状不传属资金路径裸奔）；公开快照缓存键拼 schema 版本。**根治（登记 AI 执行链路重构工程，非本工程）**：reserve 事务内固化执行计划入 PG、读计划不读 doc。**tx-watermark 不采纳**——为 demo 执行链造自定义分布式协议不值，且其价值被 plan-in-PG 完全覆盖。sv 对删除盲区（删除不推进 SV）如实登记为已知缺口 |
| C5 | 宽高三源分类 | 测量值（DOM 上报）**一律不入 doc**：Y1 删 reportNodeSize/dispatchFixtureSizeIntents 整链+measured 白名单族；作者态尺寸=命令体写；媒体固有尺寸=服务端上传/生成落地时元数据命令写（确定性输入两端一致）。前置：Y1 spec 验证上传/生成链路服务端可取 naturalWidth/视频元数据，不可得则回落方案重议。此裁决使派生帧确定 ⇒ reconcile 失去存在理由（C1 闭环） |
| C6 | order 硬项 | fractional index 显式顺序键+确定性 tie-break（同值按 id 字典序）+重平衡走 maintenance origin（不入撤销栈）；**Y1 第一验收项**（正确性缺口非优化——Y.Map 插入序跨端不确保，ensureParentOrder 是本地补偿）。验收锚：双端同 doc 渲染序逐位相等。撤销 scope 同步裁定：order 键在节点 map 内（天然入栈）；threads/时间轴域 scope 全集 Y1/Y4 spec 冻结 |
| C7 | 版本/世代三件套 | ①客户端版本协商：onAuthenticate requestParameters 携带客户端 schema 版本，不匹配拒连（独立 reason 档）+前端"版本过期"终态（清缓存强刷，不留只读编辑）——Y0；②CanvasDoc 加 generation 列（Y1 迁移时点，B5 缓存失效/Y6 恢复/删除防复活三用）；③排空切换 runbook（停写→drain→reset→部署→强刷）进 Y1（第一个弄脏 doc 的批次） |
| C8 | Y.Text 硬约束 | 文本只允许原地 splice 更新；addNode 建好 Y.Text 后，该节点**禁止任何"整块替换 data/子 map"写入**（delete+insert 静默吞并发编辑）——Y1 起回归禁区，静态门禁化 |
| C9 | 快照与恢复协议 | 恢复=世代切换+排空（断开该 doc 全部连接→停写→新 generation 写快照→清增量→客户端代不符强刷），**非**"拉回写入 state"（CRDT 并 Union 合并会使恢复失效）；快照带 schemaVersion/state vector/checksum/createdAt；恢复演练为验收用例；导出事务外执行（不阻塞 compact）。Y6 重设计 |
| C10 | 批次编号 Y 化 | B 编号已被 Spec B 组升级批次占用（git log 实证 B4'-2/B5'-1/B5'-2/B7-1/B7-2），本工程批次改 **Y0-Y7**（B≡Y 映射：B0→Y0 … B7→Y7） |
| D1 | C4 根治归属 | plan-in-PG **不进 Y0**（AI 执行链=demo 待重构，既定方向登记项并入重构勿零修——预写 reserve/settle 改造会被重构丢弃）；登记为**执行链重构工程首项**（触发条件=上线收费真实化前落地）；Y0 spec 写已知风险接受记录：删除在途窗口可能按陈旧节点集计费，fail-closed 不覆盖此盲区 |
| D2 | C3 补强：exec 契约+撤销闭环 | exec 进 UndoManager scope=[nodes,edges,exec]（trackedOrigins 仍仅 LocalUser；服务端 withDoc 写无 origin 天然不入栈——删除↔undo 对称恢复节点与 exec）；exec 字段契约冻结：status 状态机+稳定产物引用（mediaId/对象键），**URL 一律不入 exec**（现状 fileId 一处 Media id 一处 URL 混用随之消灭）；nodeStatus(multiImageGen) 归 exec 派生；**data.\* 全键读写矩阵=Y1 spec 交付物**（键→写入者→读者→归属 doc/exec/PG/投影合成/删除）；is-executable-node 执行门改读 exec.status（Y2）；exec 派生字段进公开载荷白名单+泄漏计数断言（Y2，snapshot-filter 红线联动） |
| D3 | C1 修订：投影出口表述 | 实证 deriveRenderCanvas=第 4 渲染面专用（renderCanvas.ts:2、唯一调用点 ProcessSnapshot.tsx:87），主画布复用被终裁 57② 否决（层倒置——其时代 store 仍真源故正确；A1 反转后前提变更，Y2 spec 显式声明取代）。Y2 形态=**共享派生内核（deriveGroupFrame/groupHidesChildren，已单源同参）+主画布新建投影出口 projectCanvas**（落 apps/web，含手势瞬态覆盖合并）；公开页第 4 面不动；"快照≡主画布逐位"既有断言升格为对拍基线组成。Y2 验收锚：store 帧快照清空条件下 doc 单方重算帧≡现值；Y2→Y3 交接门=store 帧停止被 reconcile 写入的时点写死 |
| D4 | C5 修订：尺寸缺口分档 | 上传=服务端元数据命令写（confirmUpload 已持对象）；生成=落地时补一次解码写元数据；**视频=受控一次性 bootstrap**（四硬约束：doc 已有 wh 零写首写者胜/独立 origin 不入撤销栈/世代戳/量化幂等——命名"媒体固有尺寸迟到落地"非测量回写）；维度缺失=合法态+DEFAULT_CHILD_SIZE 兜底；ffprobe 否决；text 节点=持久化作者尺寸+盒内滚动/裁剪禁 DOM 高度回写；**几何派生只读 doc**：measured 仅影响节点内部视觉，禁入帧派生/命中/上游尺寸（renderCanvas/帧派生 import 面门禁） |
| D5 | C6 修订：分层 order | order 仅同 parentId 层内生效；投影数组序=层序遍历（父先子后）+同层 (order,id) 排序；不设跨层全局序；Origin 枚举加第 5 常量 Maintenance；rebalance 仅会话开始一次（运行期重写 order 与 undo 反演冲突）；ensureParentOrder 冻结为"仅 RF 父先子后契约，禁承担 z 序"+断言 |
| D6 | 组帧载体完整性（方案 α） | 组 position 恒为 doc 权威字段（**auto 组也持久 position**，wh 仍派生）；键集表"auto 组恒 0 帧键"放宽为"auto 组仅 position 键"（groups.test 冻结断言同批改写）；空 auto 组天然有原点，fallbackOrigin:{0,0} 整条退役；Y1 验收项（与 C6 并列）——Y2 投影必须先知道帧从哪来 |
| D7 | doc 增长/GC | Y1 定 doc 字节预算（按节点数线性+常数，spec 给数字与依据）+yjsCanvasDocBytes 告警阈值+Origin.Geometry 帧写上限（同一手势最多 K 条超出合并——C2 外第二道闸；tombstone/删除集不被 compact 回收、A2 时间轴并入同 doc 叠加）；Y6 把 C9 恢复协议与 struct 世代重建合并为"**世代化维护**"（导出可见状态为新 doc 丢弃旧 struct store——恢复+GC 一次实现两用） |
| D8 | 执行取消/终态竞争 | 实证 writeExecStatus else 分支复活条目（collab-document.service.ts:92-95）。双守卫：writeNodeData+writeExecStatus **节点存在性前置**（nodes 无该 id 直接返回不建条目；前者 Y0、后者 Y2 随 C3）；已删节点 job 完成的产物=丢弃+计数，spec 明写"已付费未交付"为可接受语义；nodeProcessMap(zustand)=本地瞬态 UI、exec=权威态，投影合成只影响渲染不回写任一者 |
| D9 | Y3 三裁定+退场顺序 | 手势提交事务内先判节点存在（防拖拽中远端删除→松手复活）；手势期 Ctrl+Z 处置 spec 冻结；**socket.io node:status 退场不早于 Y5 水合失败态重写**（它是 hydration failed 时唯一结果可见通道——Y3/Y4 双通道并存、doc 为真源）；TD-21 前置=trim/separate/stitch 6 写点先补 writeExecStatus（census 100% 后前端消费点=0）；既有断言（assertDocAbsMatchesCsRel/assertStoryboardMembership 族）逐条去向（删/改/移入对拍）进 Y3 census |
| D10 | Y4 富文本安全 | schema 内节点/marks 白名单；链接与图片 src 协议白名单（禁 javascript:/data:）；渲染层消毒+CSP 收紧；批注正文同规则+节点级锚点孤儿展示与清理计数；注入用例（javascript: 链接/data: 图片/畸形 PM JSON）全拒或降纯文本 |
| D11 | Y5 修订：离线与多标签 | 离线窗口判据=**授权可证明期（session 有效期）+服务端重连终裁**（被拒→丢弃本地未提交+明示；不做"只读回放"半态——可编辑即暂定，否则不进编辑态）；多标签**先库源码验证是否需要 Leader**（IndexedDB 事务自身串行+update 幂等可交换⇒直写可能天然收敛；两档结论：写入安全→直写+收敛用例，存在非幂等写→才上 Web Locks，Leader+只读镜像仅第二档候选不预采纳）；TD-19 第二要件：项目删除按 not-found 清库/世代版本不符整库删/登出删全部本地 DB/定期清扫孤儿，四场景各一条用例 |
| D12 | 观测补强 | Y0 补三计数：fail-closed 503、投影异常、版本协商拒绝（含**缺参=拒连**档——旧 bundle 不带版本参数同拒，否则 Y1 上线无从区分版本门与网络拒） |
| D13 | 立项纪律第 5 条 | 门禁类任务必须先故意变红再落地，红因与门禁声明一致（G4 双向自证推广至 G1-G3/C6 序门禁/C8/D4 measured 门禁） |
| E1 | 修订 D1：plan-in-PG 进 Y0 | GenerationIntent 加 plan Json+unitPrice Int（表已备幂等锚/attempts/reservedCredits，加列边际≈一天）；claim/reserve 事务固化节点集+model/resolution+单价，settle/void/refund 只读该行不再 readCanvas；validation 覆盖 textInput+无 active 规则 fail-closed 新错误码（`?? 0` 消灭，仅显式 creditCost:0 免费）；执行路径 sv 超时 503；regenerate 补 sv；enqueue 全项目兜底收口同批。理由：Y2/Y3 后 doc 写者更多/可见延迟更长，读 doc 计费风险只增；账本本身 100% PG，风险面=计费输入读 CRDT；根修原则。AI 执行链重构工程保留链路本体重构 |
| E2 | 修订 D2/C3：exec 契约 v2+绑定裁定 | attempt 维度（attemptId=intentId/attemptSeq 单调/artifact{mediaId,objectKey}，URL 不入）；仅 attemptSeq>=现值允许整组覆盖、终态不倒退仅对同一 attemptId（根治二次生成 loading 不可见+重跑失败被吞——E2E gate 已知缺陷转验收）；**绑定裁定**：客户端 deleteNode intent 同事务 exec.delete(nodeId) 与 exec 进 scope=[nodes,edges,exec] 必须同批（服务端 withDoc origin={source:'local'} 库默认非 trackedOrigins，单加 scope 捕获面为 0——客户端现零 exec 写，execView.spec:320-328 断言从"零写"收窄为"只删不设"）；writeExecStatus 存在性守卫（nodes.has 前置，复活分支 :92-95）Y2→**Y0 前移**；sweepOrphanExec 整删改为源头消除后"doc 装载时廉价自检+计数"（禁 24h 全项目 withDoc 扫描）；Origin.Server 死常量删除；origin 契约表（写入者→origin→入栈→投影重建）进 Y1c |
| E3 | 修订 C7②/C9：世代通道前移 | generation 必须走**合并前可见**载体=docName 编码 `project:<id>#g<N>`（服务端按 DB 列校验）或鉴权握手返回；客户端建 provider/Y.Doc 前丢弃本地缓存（实验 D：老世代 update 并入新 doc 无异常无 pendingStructs=静默投毒——doc 内 meta 是事后通道）；CanvasDoc 加 **generation+revision 双列**（revision=append 返回 seq 同事务 GREATEST(revision,seq) 单调水位，通用读路径 fail-closed 等待——PG 既有 seq 的暴露非新协议，tx-watermark 否决不翻案；资金路径主屏障=E1 plan，revision 降辅助）；y-indexeddb DB 名由 docName 派生→世代自然隔离，Y5 代不符清库简化。docName 通道 Y1c 落地 |
| E4 | 修订 D9：socket.io 绑拓扑 | 退场底线不变（不早于 Y5——hydration failed 结果可见性唯一通道，功能依赖非垫片）；但 **Y3 spec 与部署拓扑钉死合并一次决策**（socket.io 无 Redis adapter 实证：多实例下实时通道本就跨实例失效；extension-redis 挂着=多实例安全假象）；persist-status/session-expiring 客户端消费闭环进 Y0（服务端 :325/:505 全套已建、web 零消费——flushPendingUpdates 预通知从未触发） |
| E5 | 修订 A5/D11：直写定论+离线要件 | 多标签**直写定论**（IDB 事务自身串行+update 幂等可交换、官方 y-indexeddb 无 leader 选举——不上 Web Locks/Leader，省决策环）；A5 复核范围收窄=丢失机制+trim 阈值（Leader 时序不再复核）；必补 IDB update 日志 trim/compaction；Y5 前置三修=本地授权 scope+session 过期持久化（canEdit=ready&&!collabReadOnly&&!terminal，collabReadOnly 唯一授权写点=authenticated 事件 :827-830——离线冷启动恒只读）、hydration failed 自愈（observers 在早返回后注册，现唯一出路 location.reload×3）、onAuthenticationFailed 接线（wsAuthNotice 生产零写者→terminal 恒 false）；provider forceSyncInterval 采纳 |
| E6 | 修订 C6 论证 | 结论与 Y1 第一验收不变；论证双理由=①跨端迭代序由整合序决定（实验实证：同一 doc 两种到达序得 k0,alpha,beta vs k0,beta,alpha——成因非"库不保证"而是"无独立可寻址顺序位"）+②RF v12 父先子后契约（D5 已冻结 ensureParentOrder"仅 RF 契约禁承担 z 序"——勿引作 Y.Map 序证据，其自述动机=RF nodeOrder）；readRecordsFromMaps 直吃 Y.Map 迭代序——主画布 z 序实际由它决定；顺带修 sortNodesByPosition/sortForArrange id tie-break（决定分镜 cells 序）。验收锚=双端渲染序逐位相等，不引库语义 |
| E7 | 修订 C8/Y4：XmlFragment 分域 | Tiptap Collaboration 绑定 **Y.XmlFragment**（field）非 Y.Text——C8 原地 splice 纪律只适用纯文本节点（data.content），富文本门禁分域另设（整块替换禁令之外叠加 PM 层约束）；@tiptap/extension-collaboration/y-prosemirror 均未安装（现装 react/starter-kit/image/mention/placeholder） |
| E8 | 修订 C5/D4：同批约束+ffprobe 撤回 | **C5↔D4 同批硬约束**：reportNodeSize 7 生产调用点（ImageGen×3/VideoGen×3/MultiImage×1）+dispatchFixtureSizeIntents 经 updateNodeEnvelope{width,height} **实写 doc**（canvasIntents.ts:132-136 实证）——删测量链与服务端元数据写必须同批，否则图片/视频节点 doc 尺寸零写者→DEFAULT_CHILD_SIZE 退化（触布局/命中/组帧派生）；**ffprobe 否决撤回**：ffmpeg/ffprobe 已是仓内依赖在用（11 文件）——媒体固有尺寸主路径=服务端落地作业提取（复用既有通道），D4 四硬约束降为"确实拿不到"兜底；表述更正="这条链从浏览器搬到服务端"，非"保留浏览器回写只删 textInput" |
| E9 | 修订 CollabRedisSync 判据 | 非死代码（loadDocument:224 活调用）但**冗余**——extension-redis@4.6.0 内建 afterLoadDocument→syncInitialStateFromPeers（awaitInitialSyncTimeout=1000）覆盖同职责，现状=双重 1s 阻塞；删除结论保留，判据改"与库能力重复"（非"死代码"），证明方式=单进程双 Hocuspocus Server 实例共享 Redis 用例（Y0 建，兼作多实例回归基线——E4 拓扑决策的实证载体） |
| E10 | 事实基线校正（全部一手核验） | writeNodeData 已有存在性守卫（:70-71，撤 Y0 项）；公开快照缓存键已拼版本（video-work.service.ts:34，撤 Y0 项→改立"编辑不失效最长 300s 陈旧+主动失效"）；reconcile census **12→4**（canvasIntents:265/464+runtime:774+store:1354；geometry.test:608"恰 4 处"门禁钉死——Y3 删除同批改写 census 门禁）；测试成本 68→**文件名 77/内容命中 125**；helper 名=**captureStoreProjection**（canvasIntents.ts:352）；hydration 已四态；connUi 零读者（写点 :166 无组件消费——SyncBanner 存在但读 connStatus）→删；writeNodeData 不跳 undefined（:77）vs writeExecStatus 跳（:96）→统一 skip；§1.3"仅 extension-redis"不实（另有自研 CollabRedisSync）；§5"持久化无差距"降级为"行级落地+E11 三丢数据路径"；§2 runCommand 章标 DELETED；B→Y 映射缩一行历史注记 |

| E11 | 新增 P0：持久化三修（Y0） | **①compact 竞态**（append=nextval+INSERT 两语句无事务 :16-21；RepeatableRead 内按 seq 水位 deleteMany :67；advisory lock 只 compact 持有不阻塞 append→"取号<水位但快照后提交"的行被删且从未进快照——现有测试只覆盖顺序写者故 CI 恒绿）：修法三件套=(projectId,seq) 唯一约束+append 单语句 INSERT..nextval..RETURNING+compact **按实读行 id 精确删除**（弃水位删除）；重放移出长事务；**完整性守卫=重放后断言 pendingStructs==null**（不满足放弃 compact+计数+保留全部行；禁逐行 SV 并集比对——decodeStateVector(update) 对 update 格式解出垃圾）。**时序硬约束：今天全 Y.Map 缺行只丢序不丢数据；Y.Text（Y1c）/XmlFragment（Y4）起=pendingStructs 静默内容丢失在线化（实验 B 实证）——本修必须先于 Y1c**。**②失败蒸发**（storeDocument 失败塞回 doc 键控 WeakMap+抛错→库 0ms 卸载无连接 doc→retryPersist 拿 undefined→cancelPersistRetry→批次消失；重试梯 5 档仅≈53s；takeStash 先删后写 append 抛错不回灌 :379-391，与"禁止 drop"注释自相矛盾）：修法=失败即 putStash（与 doc 生命周期解耦，unflushed 升格待落库权威台账）+读-写-成功-删三段式+重试无上限（指数退避封顶 60s）+yjs_unflushed_projects/bytes 告警+beforeUnloadDocument 队列非空拒卸载。**③Redlock skip+锁悬挂**（extension-redis 抢锁失败抛 SkipFurtherHooksError→store 钩子链整条跳过：不落库/不进 stash/无指标；网关 onStoreDocument throw→afterStoreDocument 不可达→锁悬挂至 1s TTL→多实例 skip 风暴）：修法=onStoreDocument 不 throw 改内部 try/catch 自管退避（钩子链走完锁自然释放）+afterStoreDocument 对账+yjs_store_skipped_total+关停 drain 覆盖 pendingUpdates+unflushed 双容器（8s race 前）。RPO/RTO 入契约（稳态≤maxDebounce 3s/故障期=进程存活窗口/Y5 后本地缓存重估）。验收=并发写者交错用例先红后绿+kill -9 灾难演练重放完整 |
| E12 | 新增 P0：资金路径（Y0，与 E1 同项） | 现状：textInput continue 跳过定价校验（validation.service.ts:35）+cost=rule?.creditCost??0（execution.service.ts:142/210/289）=无 active 规则 cost=0 外呼照发；计费输入读 CRDT（readCanvas→节点集/model/resolution→pricingRule）；sv 客户端头可伪造+删除盲区（实验：删 90% 键 SV 逐字节不变）+超时仅 warn（:45-51）；regenerate 不传 sv（video-project.service.ts:92）。修法=E1 全项；表述修正：账本（余额/冻结/流水/幂等）100% PG，风险面收敛为"计费输入读 CRDT" |
| E13 | 新增 P0：权限准入（Y0） | sweep 默认关（COLLAB_SWEEP_ENABLED!=='true' return :458→默认开）+复验重解项目角色（现只查 session+teamMember，EDITOR 降 VIEWER 连接生命周期内仍可写）；onUpgrade Origin 白名单（现 SameSite=lax 唯一防线）；绑 127.0.0.1（现监听全部网卡）；cookie-only（撤 query token 优先路径——会进 nginx access log）；鉴权失败关连接+按 reason 计数+限流（现零日志零指标）；awareness user 字段服务端覆写（现全由客户端定——成员可冒充他人在线列表/光标）；websocketOptions.maxPayload=1MB（Hocuspocus 4.6 无顶层配置项，现生效=ws 默认 100MiB）+beforeHandleMessage 速率闸（区分 awareness/sync 帧防打断在场光标）+内容配额（节点数/键长/字符串长/doc 字节——多小帧堆大内容 WS 帧限额挡不住）+awareness 限额；超限拒绝写+明确 UX 非静默丢 |
| E14 | 新增 CollabDocWriter 门面（Y0 接口+Y2 全量改道） | 服务端写唯一门面=单操作单连接+批量事务（一次执行全部 doc 写合并 1-2 次 withDoc——现一次执行 2-4 次 withDoc/节点）+进门 ensureSchemaVersion（现服务端写不过版本门）+存在性守卫统一+origin 显式+失败幂等重放；withDoc 驻留（任务在飞 disconnect{unloadImmediately:false}+空闲回收器+进度写≥1s 合并——现每写=全量装载+重放+1s 对等同步+store+compact+卸载，长任务关页后完成即最常见路径）；unflushed/lastCompactAt/persistUnhealthy 无界 Map 清理；验收=单节点执行 withDoc ≥4→1+yjs_doc_load 计数可见下降 |
| E15 | 批次重排原则（v5→v6 演进，细节以 §0.2 为准） | Y0=正确性前置（v6 拆 Y0a/b/c，E31）；Y1 拆三批（序/尺寸/载体契约）；Y2 三门 PR 级可跑+禁复用被绕过 DEV 断言+CollabDocWriter 改道；Y3 前置=缺陷台账+字段闭环门禁+假门禁先红；Y4=XmlFragment+@unique 保留；Y5=直写定论；Y6=可见态重建+CanvasDocSnapshot K 份+worker 实施化；Y7=多实例全家桶。**本行只存原则——批次范围细节一律以 §0.2 批次表为单源，防双源漂移**（Y6 实测锚：encodeStateAsUpdate 零回收 struct，2000 节点删 90% 后 80.3KB→重编码仍 80.3KB vs 可见态重建 50.7KB；253B/节点=服务端口径，客户端口径见 E26） |
| E16 | Y4/Y5 交换否决 | 维持 Y4→Y5。交换理由（先缓存后塞大 payload）不成立——IDB 存 update 流与 doc 内容模型正交；Y4 先做使 Y5 离线/多标签验收用例直接覆盖时间轴/富文本域（交换则 Y5 只验画布域，Y4 上线后新域离线行为从未验证） |
| E17 | 交付物机器化 | data.\* 全键读写矩阵+写域迁移表+真源清单=从**显式 doc schema manifest（TS 单源）派生的断言族**，非人工表格（键集知识现分散≥5 处：docShape 私有谓词/NODE_ENVELOPE_KEYS/GROUP_NODE_DATA_KEYS/EPHEMERAL_DATA_KEYS/CANVAS_BRIDGE_KEYS——人工表落地日即漂移，重演第二真源）；新字段未分类即红（字段闭环门禁，兼防 store-only 字段清空复发）；与既有 guard idiom 同构（envelope-serialization-guard/doc-shape-single-source.guard）复用不新造。data.fileId/status 读者 census（27 处/14 文件；video-work.service.ts:304/312 公开缩略图=泄漏面最高）与 snapshot-filter.util.ts:133（data.status='idle' **写者**——验收断言计写侧）进 Y1c 基线 |
| E18 | 立项纪律第 6 条 | 每批 spec 必给 **RPO/RTO 影响+新增观测面+CI 载体** 三项，缺一不得立项。动因：三门已现"设计但无人跑"（nightly 摘除/e2e-collab workflow_dispatch 已知红/520 锚"本地手动跑入档"）+假门禁实证（geometryTrap 不抛/恒真断言）——无 CI 承载的门禁是纸门禁 |
| E19 | 观测与容量（Y0/Y6 分载） | Y0 补：鉴权拒绝按 reason（现零指标）/store 延迟直方图/in-memory doc 数+连接数仪表/compact 时长+删除行数/对等同步超时/store_skipped/退避耗尽/版本协商拒绝（D12 缺参=拒连档不变）；yjs_canvas_doc_bytes 去 projectId 标签（基数随项目数无界，D7 告警阈值直接叠加=火上浇油）改尺寸直方图+无标签超阈计数；destroy timeout WARN 升计数告警；Y6 起服务端容量模型（连接数×doc 字节×compact 频率） |
| E20 | 修订 E11①：竞态机制改写+判据升级 | 实证改判：写侧 RR 论证成立（compact 事务 SELECT/DELETE 同快照，被删≡被重放，不丢）——原"DELETE 看见快照外行"论证作废；**真路径=读侧撕裂**：loadDocument :218-223 非事务两步读（t1 读旧快照→t2 compact 提交删行→t3 读增量缺行⇒旧快照+缺行=内容丢失）。严重性更正：**今天缺行=内容丢失**（实验实证：Y.Map 键整条消失+SV 洞→readCanvas 烧满 3s 后带残缺集继续；洞两端共享时 SV/revision 栅栏均静默通过——revision 由 append 驱动测不出删除），E11"只丢序不丢数据"删除。修法=硬化三件套（(projectId,seq) 唯一约束+append 单语句 RETURNING+按实读行 id 精确删除）+**loadDocument 事务化或 revision CAS 短事务**（替换 advisory lock 长事务——revision 从辅助读屏障升格 compact 原子性工具）+**完整性判据=SV 支配性**（`encodeStateVectorFromUpdate`：被删各行 SV 并集⊆新快照 SV；pendingStructs 仅辅助——抓不到"整条未达"）+**读路径 fail-closed 三处守卫**（装载三步后判/readCanvas 拒绝+独立 reason+yjs_doc_incomplete_total/compact 写新快照前判）；Y0a 首件事=三方交错红用例（装载×compact×写者，CI postgres service） |
| E21 | 修订 E11②③：顺序+对偶配对 | **②是③硬前置**（吞 throw 后库按 unloadImmediately 正常卸载=队列消失——②失败即入账先落，③才有安全网）；**对偶三配对**：拒卸载∧关停顺序（停收新写→drain 到 spool→放行——只拒卸载=destroy 等 doc 归零→挂死→8s 超时→丢）；无上限重试∧项目删除清账（Cascade FK 永久失败→无限重试+告警风暴；现只有 team.disbanded :440 无 project.deleted：删项目事件→关连接+清 unflushed/persistRetry/lastCompactAt+终态禁再入账）；内存台账→**落盘 spool**（追加文件+fsync+启动回灌，≈50 行消灭最后内存单点；RPO 数字化=spool fsync 窗口，"进程存活窗口"措辞废止）；mergeUpdates 挪出 WS 消息路径（:205-207 同步 103ms/3000 条 4.8s——入队只 append，合并只在取批时）；持久化模型显式声明："PG=各实例 delta 并集日志，CRDT 幂等收敛，锁只管 compact"（E11③ 是合法化现状须写明）+doc bytes/行数按去重口径标注 |
| E22 | 修订 E2：attemptSeq 单调源+语义闭环 | **attemptSeq 单调源=exec 内自增**（attempts 列仅同一 intentId 内单调——二次生成=新 intentId 从 1 重来，迟到旧写同放行=竞争复现）；写入门槛：seq>现值 ∨（seq=现值∧同 attemptId）+stale 写计数 yjs_exec_stale_write_total；artifact 仅更大 seq 可覆写。**执行门三态矩阵**（loading 拒/done 按入口分流——execute-all 跳过、显式 regenerate 放行凭 attempt/error 放行——Y2 冻结）+修 execute 未知 nodeId 静默 success（topology filter(Boolean) 吞）。**撤销×exec 洞语义**：删期间被丢弃的 exec 写不补投，恢复后 alignExecFromIntents 呈现最近终态，job 在飞=无状态重跑恢复（用例：A 删→B 完成→A undo→无幽灵 loading）。**已付费未交付裁定 (a) 退款**（删时在飞 intent 标待退款，产物到达即 refund——与资金 fail-closed 自洽；产品语义用户可改判）+ai_artifact_discarded_total 计数。**exec 不变量写死**：exec 无对应 node⇒视同不存在，禁任一读者当独立真源 |
| E23 | 修订 E3/E4/E9：拓扑前移+世代连带 | **拓扑决策前移 Y0a=单实例+启动租约**（Redis SET collab:owner NX PX 30s+心跳续租+抢不到 fail-fast 拒启——多实例变结构性不可能；删 extension-redis+CollabRedisSync（E9 判据"冗余"升"无用途"），E11③ 从加固变删除，双 Server 用例改租约 fail-fast 用例；Y7 多实例=移除租约+所有权注册表）。**docName 世代 6 处连带**：parseProjectId :44 解析收口 parseDocName→{projectId,generation}/closeTeamDocuments :547 全世代/withDoc 用当前世代名+随 generation 缓存/客户端建 provider 前 REST 取 g/unflushed 键=(projectId,generation)（否则 stash 回灌新 doc=E3 自己点名的静默投毒）/gate·e2e 装置世代感知；onAuthenticate∧onLoadDocument 双校验+独立 reason；断言任一时刻单世代可加载。**最小世代重建前移 Y1c**（手工触发命令：导出可见态→新 generation→断连→清增量→强刷；Y6 只做自动化/K 份/COS）；**compact 守卫连续 3 败→世代重建出口**（防 fail-stuck：永久 pending→永不 compact→增量无界增长；出口=Y6 同一台机器，登记为指定降级路径）；公开快照缓存键拼 generation（世代 bump 主动失效）。socket.io/拓扑决策随 Y3 一次定死（failed 自愈已前移，E24） |
| E24 | 修订 E5/D11：两项前移+离线语义 | 鉴权终态 Y5→**Y0b**（authenticationFailed 接线+wsAuthNotice 生产写者+版本过期/会话过期/无权/DB 不可用四档终端 UX——否则 E13 reason 分型客户端不可见、canEdit 第三项恒死）；hydration failed 自愈 Y5→**Y3**（迟到 synced 补水合——observers 现在早返回后注册；几十行解锁 socket.io 决策）；离线被拒语义"丢弃+明示"改"**保留本地可导出/可重试**"（不可信但不可删——修订 D11/E5） |
| E25 | 修订 E12：三补项 | **settle 失败对账闭环**（:154-157 warn 后仍 totalDeducted+emit done；三查①有 resultRef 即 SUCCEEDED 不退款；每日对账过滤 creditsConsumed>0——reservedCredits>0∧creditsConsumed=0 行可能落不进任何分支、冻结不释放；红用例定盲区边界后修）；planJson 加 **planVersion**（reconcile 读历史行，结构演进后老行解析失败→VOIDED+告警，禁静默兜底）；**sv 从公开 API 退役**（客户端可控头+可触发 3s 服务端停顿；E1 后资金路径不需要——readCanvas 的 sv 等待降内部） |
| E26 | 新增 P0：客户端 keep GC | UndoManager 对被删 struct 置 keep=true 阻断 GC（库源码：keep setter/Transaction GC 判据含 !struct.keep），STACK_LIMIT shift() 截断只砍数组不解 keep——客户端 doc 随会话无界增长（Map.set 覆盖旧键=删除，每次旧值滞留），Y5 IDB 跨会话固化；修复落 **Y1c**（与 exec 进 scope 同批——undo 恢复恰依赖 keep，不能粗暴 clear()）：对被截断出栈的项释放 keep、**扣除仍被剩余栈项引用的 struct 交集**（栈项 merge deleteSet 同 struct 多挂）；验收=删 200 个 1KB 节点后 encodeStateAsUpdate 字节回落（今天恒上升）；**Y6 字节预算分服务端 PG/客户端浏览器双口径**（253B/节点是服务端口径——keep 保留量只存在客户端，服务端测量会系统性低估） |
| E27 | 新增：嵌套共享类型唯一创建者 | 同一 key 并发创建=败者 Item 被删、其字段在胜者视图不可见且无异常无日志（canvasIntents:81/writeNodeData:73-76/writeExecStatus:92-95 均"缺则建"；单进程安全但 E14 门面/E13 配额/Y1c 服务端字段放大敞口）；manifest（E17）硬规则：**嵌套类型只允许父容器唯一创建者创建**，服务端对无权创建的 key 一律 no-op 不建；门禁=扫 getMap().set(k, new Y.Map()/Array/Text) 逐点登记创建者唯一性；用例=两 doc 并发对同一 nodeId 写 exec 不同字段，merge 后两字段俱在（今天红） |
| E28 | 新增：准入配额分层与出站背压 | **客户端大写入分块**（单事务≤256KB，Y.Text 分段 insert 天然可合并——大粘贴/分镜批量导入/富文本初始化=单帧超限被拒且 UX 无法解释半途帧）；配额判定以 doc 字节/节点数为主、单帧上限为辅（防 DoS 不承担内容治理）；数值按单用户最坏粘贴/导入反推入 spec（与 RPO 同栏）；分层处置：超帧上限=断连留证据，超 doc 配额=拒该次写入+明确 UX，两层不混；**服务端强制点写死**（onChange/afterStoreDocument 可数节点字节+beforeHandleMessage 可数帧——客户端上限只是 UX）；**出站背压**（按连接出站积压统计：一级降级丢 awareness 帧保 doc 同步，二级断开+collab_slow_consumer_disconnect_total——库只有 pre-auth 队列上限，广播侧现无策略） |
| E29 | 新增：工程基座（Y0c） | **库行为锚扩表 5 条**（store 失败→库 setTimeout unload/SkipFurtherHooksError 跳整条钩子链/onStoreDocument 抛错→afterStoreDocument 不可达→Redlock 悬挂 TTL/DirectConnection.disconnect unloadImmediately 默认 true/extension-redis afterLoadDocument 对等同步——每条一测试+fixture 快照，与 check-hocuspocus-pin 联动，升级必重跑）；**gateway 切四模块**（CollabPersistence/CollabSessionGuard/CollabDocRegistry/CollabDocWriter，单文件≤200 行——E11 故障注入用例可只装 Persistence 不启 Server）；**故障注入基座**（可编程 Prisma 故障器 fail-after-N/delay/SQL 匹配+kill -9 灾难演练脚本进 scripts/ 纳入发布门禁）；CollabDocWriter 补四项：validateParentGraph 进门（父子环/孤儿边——Kahn 静默丢环内节点=少执行少计费）+transactSync（类型层拒绝 async 回调——DirectConnection.transact 不 await 回调）与 readDoc 两 API+配额强制点（E28）+gc/gcFilter 显式 pin（库默认翻转会静默改变删除可恢复性）；beforeunload 接画布页（hasUnsyncedCanvasChanges 已存在只挂 VideoEditorShell）+persist-status unhealthy 常驻横幅明示"未保存勿关页" |
| E30 | 新增：协同语义补面 | awareness 选区广播（**Y1a 同批最省**——选区即投影一部分：去抖≥200ms+只广播 id 集+纳入 awareness 限额+>8 人自动关远端光标只留成员表；现 setSelection 无生产调用方）；**字段冲突语义表**（Y1c origin 契约表邻域并写进用户可见文档：data.content=Y.Text 字符级合并/几何与 config=LWW 绝对值/exec=attempt 维度——否则协同语义永远是实现细节）；E 系表加适用批次列+每批 spec 首节**内联该批有效裁决全文**（自包含，不跨文档追踪修订链） |
| E31 | 批次重排 v6+0 号动作 | **Y0 拆三批**：Y0a 数据完整性（E11 全部+E20 判据/E21 配对/V3 三守卫/E23 拓扑租约删扩展/V14 故障注入基座/RPO 数字化/loadUpdates 分页）→ Y0b 资金与准入（E12/E25+E13+V5 鉴权终态+E28 配额背压+V15+E19 半）→ Y0c 门面与门禁（E14/E29+G1-G4 定义冻结+删 CollabRedisSync/死物+E23 世代契约冻结+E17 manifest 形态+V10 行为锚）；**b/c 可并行，Y1c 硬前置=Y0a+Y0.5 迁移链**（worker 拆分可并行主线）。**0 号动作（先于一切批次，今日）**：.env 密钥轮换（先轮换→git rm --cached+ignore→gitleaks 进 CI/pre-commit→历史处置 filter-repo/BFG 或接受历史+已轮换二选一——顺序反了白轮换）+CanvasDoc 存量盘点（本地已数：6 doc/116KB/246 增量/152 项目；**线上待验**——非空则 Y1c 补一次性 v2→v3 迁移脚本，一天级）；Y4→Y5 维持（E16 重申） |
| E32 | 文档治理 | §6 加留档横幅（v1 结论"Q1 成立：执行 runCommand 收敛"与 §0 A1/E10 矛盾——已执行）；§1-§6 物理移出至 docs/superpowers/audits/2026-10-06-canvas-yjs-baseline-audit.md，索引只留批次表+裁决集（≤8KB——**待执行机械动作，与 0 号动作同批**）；G1-G4 定义冻结于 Y0c spec 首节（本目录不引用未定义符号）；E15 行精简为重排原则（已执行——细节以 §0.2 为准防双源） |
| E33 | 修订 E26/Y6/D7：回收机制纠错（W1/W2 撤回+实测） | **撤回"encodeStateAsUpdate 零回收 struct"论证**（v5 引入的实验系误读）：Yjs 删除即 GC（回收发生在删除时刻，残留=GC 壳 ~15B/项+delete set；2MB 内容删完剩 28.9KB），且 **keep 不随 update 传输**——任何"编码→新 doc"装载即回收成壳。Y6 机制重定位：可见态重建**非回收必需**，真实价值=①恢复/世代切换（CRDT 并 Union 无法回滚）②消灭 GC 壳与 delete set 线性残留；50.7KB/63% 数字整句删除。D7 预算改 `A + 253B×活节点 + ~15B×累计删除项`（253B=活节点内容口径，显式标注不含 tombstone 与客户端 keep 保留量）；世代维护触发=恢复需求/schema 翻转/删除项数阈值（spec 给数字），非字节增长。**E26 修法改**：释放 keep 实测零回收（GC 只扫当前事务 delete set，clear() 后字节不变；destroy() 也不清）→①struct 粒度直接置 struct.keep=false（**禁走 keepItem——沿 parent 向上传播会误释放仍被保护的祖先=栈项 undo 恢复出 GC 壳=静默内容丢失**；StackItem.deletions 是 DeleteSet 区间，扣除须 struct 粒度）②回收唯一路径=**客户端 doc 重建**（复用 terminal rebuild 机制，前置 synced∧unsyncedChanges===0，触发=yjs_client_doc_bytes 阈值或空闲窗口）。E26 严重性=**会话内活跃泄漏**（实测 99.3% doc 增长来自整串覆盖×UndoManager：300 击键 45,942B vs Y.Text 309B=153×；刷新归零、Y5 IDB 固化跨会话）——**data Y.Text 从协作语义升格为内存与流量必做项**（现每击键整串上行+广播；Y.Text 后 1 字符/击键），与 E26 同批同目标（一个修来源一个修保留）；验收锚=文本连续输入 N 次 doc 增量<阈值（先红后绿）+双回收链字节断言（客户端/服务端各自证"删节点后 encodeStateAsUpdate 回落"）+保留栈项 undo 仍可恢复回归用例；项目切换 destroy() 升断言 |
| E34 | 修订 E20：修法收敛+判据豁免+可达性证明 | 装载读一致性=**单事务 RR 覆盖"快照+全部分页读"**（apply 放事务外——事务内只 SELECT；Prisma 交互式事务显式放宽 timeout，信贷路径 {timeout:10_000} 先例；超时 fail-closed 不降级）+**换序第二道保险**（先读增量后读快照，两行改动——compact 提交后的快照必为超集，union 天然完整）+**stateSeq 三件套**：CanvasDoc 加 stateSeq 列（写快照同事务写入=本次重放覆盖到的 maxSeq）+装载读 `seq > stateSeq` 增量+同事务复查 stateSeq 未变（变了重载）；**撤回 revision 兼作装载守卫**（revision=append 写进度，非快照覆盖度；保留 compact CAS 用途）。**SV 支配性判据豁免写死**：delete-only 行 SV 贡献为空（encodeStateVectorFromUpdate=1 字节）永"通过"——此类行不丢（pendingDs 随快照编码，删除信息不依赖 struct），附用例；不写豁免=守卫误判→compact 永久放弃→fail-stuck。三子情形表写死 spec（t3 无行=pendingStructs 空不可检测=主路径；t3 新行=pendingStructs 非空可检测；正常）——pendingStructs 仅辅助。read fail-closed 补**降级出口**：连续失败计数→告警→以最近一次已验证快照降级打开（明确 UX+审计——防一次历史撕裂=单项目永久 DoS；与 §4 归档表同源）。**Y0a 首件事改可达性证明**：单实例 loadingDocuments 串行化+compact 只由已加载 doc 触发——撕裂两并发体可达性未证，故障注入确定性状态验证；可达→真红用例；不可达→登记 Y7 多实例前置用例不阻塞，硬化三件套+stateSeq+守卫照做（防假红违反 D13） |
| E35 | 修订 E23：租约四语义+fencing | TTL≤10s+心跳≤3s（独立 timer/子进程——事件循环卡顿时心跳不停）；**续租失败=自隔离**：拒新 WS 升级+关现有 collab 连接+health degraded+计数（不自杀不硬撑；**租约只 gate collab 就绪度**——HTTP API 照常，onModuleInit 无条件 listen 须由就绪门管住）；启动=有界重试+就绪门（未持租约不 listen 不接流返回 not-ready，进程不退出）+COLLAB_FORCE_TAKEOVER 逃生阀+**部署钉死 pm2 restart 禁 reload/cluster**（零停机 reload 新进程永远抢不到）；关停末尾显式释放（deploy 不等 TTL）；**fencing token**：续租前 GET 校验持有人+发现间隙即 fence 停写+collab_lease_denied/lost_total 指标；**语义写清=活性机制非数据完整性**（PG=delta 并集+CRDT 幂等+compact advisory lock 已保证数据面；租约防两个实例各持 doc 而客户端互不可见——理由写错会加固错地方）；CollabDocRegistry 从 Y0c 起带 owner 抽象（单实例租约=平凡实现，Y7 只换实现不重写） |
| E36 | 修订 E22/E25/E28：四链路落点 | **退款触发点改"完成时存在性检查发现缺失⇒refund"**（"删时"不可实现——删除是 CRDT 操作，服务端无事件，读时才知道；E2 守卫生效时刻=唯一权威时点；15min stale 兜底已有）+**产物丢弃同时处置 exec 条目**（置 error{reason:'node_deleted'} 或删——否则 artifact{mediaId,objectKey} 指向不存在 Media=投影悬空+泄漏计数误触）+竞态边界用例（删除在交付后=正常不退/交付前=退）。**执行入口门**=provider.isSynced && !provider.hasUnsyncedChanges（谓词已存在——canEdit 不含连接状态，断网仍可点执行=按陈旧节点集计费从竞态变常态；sv 退役后此信号是唯一防线；不满足禁用执行+提示）。**"拒绝写"三层**（Yjs 无应用层 NACK——传输层拒绝=客户端本地已写服务端没有=静默分叉；原子大写入无法分块——2MB 字符串 set 进 data.content 是单 item，事务分块对它无效）：①客户端写前校验（原子写长度上限+事务分块，超限直接业务 UX **不产生本地写入**）②服务端拒绝走业务错误回执（对这次 intent 拒绝且前端可见，不靠丢帧）③maxPayload 只作 DoS 兜底**提到 8-16MB**（1MB 会拦 Y5 离线编辑回连 delta>1MB→1009 关闭→无限重连→**离线内容永远回不来**）+**不可达性断言**（构造系统允许的最大合法写入，断言编码帧<maxPayload）+数值反推输入含"Y5 离线回归最大 delta"+超限独立终态+导出本地内容出口。**世代切换 close code**：4xxx generation-superseded→客户端清缓存硬刷（与 authenticationFailed 接线同址——同一处 close/reason 映射表；防世代 bump=重连风暴+旧缓存再并入）。**出站背压挂点**：先测 ws.bufferedAmount 采样，实现挂点 beforeHandleAwareness/onAwarenessUpdate 或自管发送二选一（禁写没有挂点的动作）。**执行前断言**：sorted.length===scope 内可执行节点数，不一致拒绝执行+告警（覆盖父子环静默丢+未知 nodeId 同族） |
| E37 | 修订 E21：spool 细则 | 写入次序二选一入 RPO 契约（接受"失败→落盘"ms 窗口+yjs_spool_write_failures_total vs WAL-first 每批 fsync）；**帧格式=长度前缀+CRC**（尾部截断记录可识别——半条=从未持久化的更新⇒计数+告警禁静默截断）；**回灌必须在该 doc 对外可服务之前**（fail-closed——先服务后回灌=第二次撕裂）；**世代作用域**：文件名带 (projectId,generation)，启动回灌丢弃世代不符文件（否则 E3 的"静默投毒"从内存搬到磁盘）；容量上限+超限行为（拒写 vs 丢最旧）明写+fsync 频率×批量权衡入 spec；**spool 目录进 deploy/rollback runbook**（PM2 重启换 CWD=spool 消失——归 Y0.5） |
| E38 | 修订 E17/E30：manifest 四层+选区移批 | manifest 扩**四层**（不只 data.*）：顶层 map 集合（nodes/edges/exec/meta/时间轴/threads——Y1c 起新增顶层域）/每个嵌套类型的唯一创建者（E27 规则）/每个键的写入者与读者/归属（doc·exec·PG·投影合成）+撤销 scope——否则第二真源只是从 data.* 挪到顶层就复发；**awareness 选区广播移出 Y1a→Y0b**（W15：Y1a 主题是序且是第一验收批——选区是新功能（setSelection 现无生产调用方），塞入会稀释验收锚；与 awareness 限额/覆写同批更内聚） |
| E39 | 修订批次结构：Y1c 拆三片+上线门槛+单人零开销 | **Y1c 拆三片**（W16：大爆炸 schema 迁移回滚成本）：**Y1c-1 载体**（SCHEMA_VERSION=3+generation/revision+stateSeq+docName 世代通道+排空 runbook 补两步：**排空 pending+spool 落 PG** 与 **归档旧世代快照**——CanvasDoc 是 projectId 单行主键，新世代写快照=覆盖唯一副本=**单向门，第一次世代切换必须与旧世代归档同批**[CanvasDocSnapshot 表 K=1 即可]/世代重建命令[与归档同机]）；**Y1c-2 内容模型**（data Y.Text+E26 keep 修复——同批同目标+exec 契约 v2+undo scope+attemptSeq+positionXY 拆键+cells 稳定 id+时间轴域结构）；**Y1c-3 门禁与预算**（manifest 派生断言+字段冲突语义表+doc 字节预算+Geometry 帧写上限+存量 data.status/fileId 一次性删除）。**上线门槛**（5.1）：0 号+Y0a+Y0b+Y0.5+Y1a+Y1b+（Y1c-2 三项 exec v2/E26/Y.Text 随上线批强制）——运行安全全来自这五项半；Y0c/Y1c 其余/Y2/Y3 收益是维护成本与模型完备性，**上线后按序**。**单人零开销**验收进 Y0b（单人团队=成员 1 特例不得因协作退化：大粘贴不被帧上限打断/无 awareness 广播（现 50ms 光标无条件上报）/无 sweep 查询/无对等同步等待/文本泄漏单人场景同灭）。内存表（docEpoch/lastCompactAt/persistUnhealthy/persistRetry/unflushed）世代 bump 时按 (projectId,generation) 精确清理（按 projectId 清会误清活跃世代）；docName `#g<N>` 协议安全已验证（文档名走协议 routing key 不进 URL——provider 只把 url 交给 WebSocket 构造） |
| E40 | 新增杂项（W10-W14+§6） | **0 号动作补会话凭证**（W13：SESSION_SECRET 轮换不作废已发 session——同批清 session 表+处置 backups/ 明文 token 与 db-snapshot.json 及 config-files/api.env——否则"已轮换"是假安全）；分叉自检（unsyncedChanges 长期非零⇒可见告警+引导重载+forceSyncInterval——客户端唯一廉价分叉信号）；awareness 三指标（awareness_states/awareness_bytes/collab_slow_consumer_disconnect_total）+幽灵光标上限（30s 空闲超时期间仍在广播——明示）；**"零可执行节点"fail-closed 通则**（W14：执行入口零可执行节点一律返回明确业务错误，禁 {success:true,results:[]}——未知 nodeId/textInput 豁免同族）；CanvasDoc TOAST/autovacuum（快照每 compact 整行重写 500KB——死元组堆积：Y0c 建表参数+Y7 监控）；**审计归属**（Y1c-1 origin 契约表加 actor+command 落 append-only 表——Y4 批注一上线就要"谁说的/谁改的"，届时补=重挖所有命令入口）；IndexedDB 淘汰承诺（E24"保留可导出"落地：navigator.storage.persist()+estimate() 监控+缓存被清明示+未同步/已同步内容 UI 区分+Safari 7 天清理对策）；**Y2 三门装置提前造**（Y0a/Y0c 落地"无 MinIO/无外部依赖的双 client+单进程单 Server"装置——否则 Y2 一半预算耗在造装置）；E 系适用批次以 §0.2 各行 E 引用为反向索引（W18 简化处置） |

### 修订关系（D 对 C、E 对 C/D 的修订链）

D1 修订 C4（根治归属）、D2 修订 C3（契约+scope）、D3 修订 C1（出口表述）、D4 修订 C5（尺寸分档）、D5 修订 C6（分层 order）；D6-D13 为新增闭环项。E 系：E1 修订 D1、E2 修订 D2/C3、E3 修订 C7②/C9、E4 修订 D9、E5 修订 A5/D11、E6 修订 C6 论证、E7 修订 C8/Y4、E8 修订 C5/D4、E9 修订 CollabRedisSync 判据；E10-E19 为事实校正与新增正确性/纪律项。v6：E20 修订 E11①、E21 修订 E11②③、E22 修订 E2、E23 修订 E3/E4/E9、E24 修订 E5/D11、E25 修订 E12、E31 修订 E15；E26-E30/E32 为新增。v7：E33 修订 E26/Y6/D7（撤回零回收论证——W1/W2）、E34 修订 E20、E35 修订 E23、E36 修订 E22/E25/E28、E37 修订 E21、E38 修订 E17/E30、E39 修订批次结构（Y1c 拆三片+上线门槛）；E40 为新增。被修订条目以最新修订系为准（C→D→E，E 内部以编号大者为最新）。

## 0.2 批次目录（v7，后续开发按此逐批执行）

| 批次 | 主题 | 范围要点 | spec | plan | 状态 |
|------|------|----------|------|------|------|
| Y0a | 数据完整性（v6 拆分 1/3） | E11 三修·机制 v6 修正（E20：真路径=**读侧撕裂**——loadDocument :218-223 非事务两步读并发 compact；**首件事=三方交错红用例**（装载×compact×写者，CI postgres）；硬化=(projectId,seq) 唯一约束+append 单语句+按实读行 id 删+loadDocument 事务化或 revision CAS 短事务；完整性判据=**SV 支配性**（encodeStateVectorFromUpdate：被删行 SV 并集⊆新快照 SV，pendingStructs 仅辅助）+**读路径 fail-closed 三处守卫**：装载三步后判/readCanvas 拒绝+独立 reason+yjs_doc_incomplete_total/compact 写快照前判）+E21 对偶配对（**②失败即入账先于③**/落盘 spool+启动回灌/项目删除事件清账[现只有 team.disbanded]/关停停收→drain spool→放行/mergeUpdates 挪出 WS 消息路径/RPO 数字化=spool fsync 窗口）+**拓扑裁定：单实例+启动租约（E23）+删 extension-redis+CollabRedisSync**（E11③ 从加固变删除）+compact 守卫连续 3 败→世代重建出口（E23）+loadUpdates 分页+V14 故障注入基座（可编程 Prisma 故障器+kill -9 演练脚本进 scripts/）+E34 修法收敛（单事务 RR 全分页+换序+stateSeq 三件套+SV 豁免+**可达性证明先行**）+E35 租约四语义+fencing+E37 spool 帧格式/世代作用域+Y2 三门装置提前造（E40） | 待立 | 待立 | 未启动 |
| Y0b | 资金与准入（v6 拆分 2/3） | E12 全项（E1 plan-in-PG+**planVersion**（E25）+text 定价 fail-closed+sv 超时 503+**sv 公开 API 退役**（E25）+enqueue 兜底收口+**settle 失败对账闭环**红用例（E25））+E13 权限准入（sweep 默认开+perm.resolve 复验+Origin 白名单+绑 127.0.0.1+cookie-only+鉴权失败关连接限流+awareness 服务端覆写）+E28 配额分层与出站背压（客户端大写入分块≤256KB/doc 字节配额为主/数值按最坏粘贴反推/超帧=断连 vs 超配额=拒写+UX/出站分级丢 awareness 保 sync）+**鉴权终态前移**（E24：authenticationFailed 接线+wsAuthNotice 四档终端 UX）+V15（persist-status unhealthy 常驻横幅+beforeunload 接画布页）+E36 四链路落点（执行入口门 isSynced∧!hasUnsyncedChanges/拒绝写三层+maxPayload 8-16MB+不可达性断言/世代 close code 4xxx/退款触发点改完成时存在性检查+exec 条目同处置/执行前断言）+E38 awareness 选区移入本批+E39 单人零开销验收（大粘贴不断/无 awareness 广播/无 sweep/无对等同步等待）+E40 分叉自检+awareness 三指标+E19 观测半 | 待立 | 待立 | 未启动 |
| Y0c | 门面与门禁（v6 拆分 3/3） | E14 CollabDocWriter+E29 补项（validateParentGraph 进门——父子环 Kahn 静默丢=少执行少计费/transactSync·readDoc 类型约束/gc·gcFilter 显式 pin/配额服务端强制点）+门禁基线棘轮（门禁清单与定义冻结于本批 spec 首节——本目录不引用未定义编号符号，E32/W17）+V10 库行为锚扩表 5 条（升级 Hocuspocus 必重跑）+V11 gateway 切四模块（CollabPersistence/SessionGuard/DocRegistry/DocWriter，单文件≤200 行）+E23 世代契约冻结（parseDocName 收口/onAuthenticate∧onLoadDocument 双校验/unflushed 键=(projectId,generation)——实现随 Y1c）+E17 manifest 形态+E27 嵌套唯一创建者规则入 manifest+删死物（Origin.Server/connUi）+writeNodeData undefined 统一+版本协商三层（clientBuild 独立 reason+缺参=拒连）+E2 服务端半（writeExecStatus 存在性守卫） | 待立 | 待立 | 未启动 |
| Y0.5 | 部署与进程形态（v5 新增；v6 调整） | 迁移进部署链（migrate deploy 前置 step+prisma/ 入 api tarball+migrate status 入 CI——**唯一 Y1c 硬前置项**）；BullMQ worker 进程拆分（~20 processor 与 WS 同事件循环：sharp 4K/ffmpeg→事件循环卡顿→30s 空闲判死→连接重建——可并行主线）；trust proxy=1（TD-24）+query token 退役+gitleaks 进 CI/pre-commit（**.env 密钥轮换+git rm --cached+历史处置已升 0 号动作**，E31——先轮换后处置，顺序反了白轮换） | 待立 | 待立 | 未启动 |
| Y1a | doc 模型 v3·序（Y1 拆分 1/3，E15） | **order 分层 fractional index=第一验收**（C6+D5+E6 双理由：跨端迭代序实验分叉+RF v12 父先子后契约）；sortNodesByPosition/sortForArrange id tie-break（分镜 cells 序确定性）；readRecordsFromMaps 迭代序消费显式化（主画布 z 序由它决定）；收敛 harness（Node 无浏览器 N 客户端随机操列：双端渲染序逐位相等+扰动到达序仍收敛）；序门禁先红（D13） | 待立 | 待立 | 未启动 |
| Y1b | doc 模型 v3·尺寸与只读（Y1 拆分 2/3） | 宽高三源（C5+D4+E8：**C5↔D4 同批硬约束**——7 处 reportNodeSize+dispatchFixtureSizeIntents 删除与服务端元数据写同批落地，否则图片/视频节点 doc 尺寸零写者；ffmpeg 主路径提取、D4 四硬约束降兜底；text 作者尺寸+盒内裁剪禁 DOM 高度回写；几何派生只读 doc 门禁先红）；measured 白名单族删除；只读门禁收口（VIEWER 弹回 nodeStore 四写点先红）；上传/生成链路服务端元数据可取性验证（E8 前置） | 待立 | 待立 | 未启动 |
| Y1c | doc 模型 v3·载体与契约（Y1 拆分 3/3；硬前置=Y0a+Y0.5 迁移链；**v7 执行拆三片 Y1c-1 载体/Y1c-2 内容模型/Y1c-3 门禁预算——划分见 E39；-1 含世代归档同批（单行主键=单向门），-2 含 Y.Text+E26 同批同目标，-1 origin 契约表加 actor（E40 审计归属）**） | SCHEMA_VERSION=3+**generation/revision 双列**（E3）+**docName 世代通道**（`project:<id>#g<N>`，合并前可见）+排空 runbook（C7③）；data Y.Text（C8 原地 splice 回归禁区+禁令扩 data 全键整块替换）；exec 契约 v2 落地+**删除同事务清 exec 与 undo scope=[nodes,edges,exec] 绑定裁定**（E2）+origin 契约表+execView 断言收窄"只删不设"；组帧载体 α（D6 九点连带 census：assertNoAutoGroupFrameKeys/assertEmptyAutoGroupCollapsedSize/assertDocAbsMatchesCsRel/fallbackOrigin/CLONE_WHITELIST/snapshot-filter {0,0} 归一/renderCanvas 注释/specb e2e 断言族/公开载荷形态）；**doc schema manifest 派生断言**（E17：data.* 全键矩阵+写域迁移表+真源清单三合一机器化，新字段未分类即红）；positionX/Y 拆键（末尾只经门面）+分镜 cells 稳定 id+index-keyed+时间轴域同 doc 结构；UndoManager scope 全集（D2）+attemptSeq=exec 内自增+写入门槛（E22）+**客户端 keep GC 修复（E26：释放被截断出栈项∧扣除仍被剩余栈项引用的交集——undo 恢复恰依赖 keep，禁粗暴 clear）**+E27 并发创建用例+字段冲突语义表（E30）+**存量 data.status/fileId 一次性删除**（E17 写侧）+**手工触发世代重建命令（E23；N4 compact 守卫出口同机）**；doc 字节预算（253B/节点=服务端 PG 口径；客户端浏览器口径含 keep 保留量，E26）+yjsCanvasDocBytes 告警+Geometry 帧写上限（D7）；原子批纪律+丢失更新用例先红后绿 | 待立 | 待立 | 未启动 |
| Y2 | 投影层统一 | **共享派生内核+主画布新建投影出口 projectCanvas**（D3 不变：落 apps/web 含手势瞬态覆盖合并；公开页第 4 面不动；终裁 57② 取代声明）；投影=渲染帧来源验收锚（store 帧清空条件下 doc 单方重算≡现值）+Y2→Y3 交接门；**三门（差分/收敛/自足）PR 级可跑**（E15：COLLAB_FAKE_AI=1/无 MinIO/双 client+单进程双 Server，全量 gate 留夜间/发布前；**禁复用被绕过的 DEV 断言**——readOnly 会话跳过+__yield-guarded__ 哨兵豁免，先门禁化再谈验收）；exec→RenderNode 合成（C3+D2：字段契约、is-executable-node 改读 exec.status、公开载荷白名单+泄漏计数）；**服务端写全量改道 CollabDocWriter**（E14：单节点执行 withDoc ≥4→1 验收）；doc 自足性独立验证（清缓存冷启投影≡今天产出，Y5 复用）；性能预算断言式入 CI（520 节点锚） | 待立 | 待立 | 未启动 |
| Y3 | 画布真源反转 | 前置=**缺陷台账**（E15：store-only 字段被全量重建清空/VIEWER 弹回 nodeStore 四写点/等价性绕过/节点状态 4 真源/渲染序/测量回写/仲裁层——逐条标"修完即消失"归属+独立退出切片）+**字段闭环门禁先行**（E17）+**假门禁先红**（geometryTrap 生产只计数不抛+assertReconcileSingleWriterWindow 恒真——先改成会红的门再升生产断言）；符号删除 census 五行表（**reconcile 生产调用恰 4 处**：canvasIntents:265/464+runtime:774+store:1354——geometry.test:608 census 门禁同批改写，E10；既有断言族逐条去向 D9）；canvasStore 瘦身瞬态；删 reconcile 仲裁层/手势保护三层/写者账本/EPS/ratchet/geometryTrap；C2 手势补齐（叶 resize 会话化+生产断言+提交点扩展）+手势提交节点存在守卫+手势期 Ctrl+Z 裁定（D9）；canEdit 重定位（写入口+服务端 readOnly 两层）；socket.io 退场随本批一次定死（E23/E24：拓扑已 Y0a 钉死=单实例+租约；**hydration failed 自愈前移本批**——迟到 synced 补水合，失败态可见性不再依赖 socket.io；TD-21 前置=trim/separate/stitch 6 写点先补）；测试套重写（成本警示：文件名 77/内容命中 125，勿低估） | 待立 | 待立 | 未启动 |
| Y4 | 时间轴+富文本+批注 | Tiptap collaboration（**Y.XmlFragment** 同 doc 非子文档，E7 分域门禁——C8 splice 纪律只管纯文本节点 data.content）+富文本安全（D10：协议白名单/消毒/CSP/注入用例）；sourceNodeId @unique 终裁=**保留**（doc 键唯一性背书+时间轴寻址/生命周期与节点删除联动——悬空时间轴防护，E15）；编辑器与画布同开连接/驻留预算（A2 spec 终裁）；VideoProject.data 退役（元数据留表）+autosave 整档 PATCH/baseUpdatedAt 乐观锁/onConflict 链路整删（含三选 ConfirmModal 冲突语义——同 doc 后 409 消失）；时间轴 Y.UndoManager 域隔离+根类型不相交门禁；批注 Y.RelativePosition 锚点+孤儿展示与清理计数；canUndo/canRedo 事件驱动 UI | 待立 | 待立 | 未启动 |
| Y5 | y-indexeddb+local-first 水合 | **直写定论**（E5：不上 Web Locks/Leader——IDB 事务串行+update 幂等可交换；A5 复核收窄=丢失机制+trim 阈值）+IDB update 日志 trim/compaction；世代感知缓存（键编码 schema 版本+generation；docName 世代隔离→代不符清库简化，E3）；本地授权 scope+session 过期持久化（canEdit 离线冷启动恒只读修复）+forceSyncInterval+**客户端 doc 重建（E33：keep 回收唯一路径——触发 yjs_client_doc_bytes 阈值/空闲，前置 synced∧unsynced===0）**+IndexedDB 淘汰承诺（E40：persist()+estimate()+未同步/已同步 UI 区分+被清明示）；多标签直写+四用例（双标签编辑/拖拽预览/undo/离线重连）；离线窗口=授权可证明期+服务端重连终裁（D11 不做只读回放半态）；TD-19 四场景清库用例+登出销毁会话；**RPO 重估**（本地缓存=持久化组件非 UX，E11 契约延伸） | 待立 | 待立 | 未启动 |
| Y6 | 快照与恢复能力（世代化维护） | C9 世代化恢复+struct 世代重建 GC 合并（D7）+**机制重定位（E33/W1 纠错：Yjs 删除即 GC——服务端回收本就工作，"零回收"论证撤回）**：可见态重建非回收必需，真实价值=①恢复/世代切换（CRDT 并 Union 无法回滚）②消灭 GC 壳与 delete set 线性残留（~15B/累计删除项）；触发=恢复需求/schema 翻转/删除项数阈值（给数字），非字节增长+**CanvasDocSnapshot 表保留 K 份**（Y1c-1 已建 K=1——本批扩策略+自动化）+恢复演练验收；compact 补行数/字节门限（时间门限非门限）+worker 隔离**实施化**+loadUpdates 分页（Y0a 已做）；快照导出事务外+元数据（sv/checksum/createdAt）+导出失败告警重试；PG 逻辑备份/PITR 纳入验收；保留策略分层；本地 MinIO 同构验证；COS 归档（§5.2 设计留档）；容量模型（E19）；字节预算双口径口径声明（253B=活节点服务端口径，E33） | 待立 | 待立 | 未启动 |
| Y7 | 上线前运维（gate：上线前） | **拓扑钉死前提**（单实例 or 集群——extension-redis 假象消除后决策，E4/E9）；多实例全家桶（所有权注册表/HTTP 写转发/迁移协议/seq 水位锚/双实例 E2E——Y0 双 Server 用例扩展+extension-redis Redlock skip 丢失分析）；nginx location 分档（read_timeout≥stale 阈值+sticky 入仓）；指标告警+health degraded 语义；权限中途变更复查；Prisma 连接池显式参数+CanvasDocUpdate autovacuum+表膨胀监控；kill-timeout 余量≥30s+退出前 stash 落库+flush at risk 告警；COLLAB_* 进 env zod 校验+密钥管理清单；回滚 runbook；容量预算复验（进程拆分已前移 Y0.5） | 待立 | 待立 | 挂起（上线前） |

- 顺序：**0 号动作**（.env 密钥轮换→git rm --cached+gitleaks→历史处置+**会话凭证作废**（清 session 表+处置 backups/ 明文，E40）；线上 CanvasDoc 存量盘点，E31）→ Y0a → Y0b → Y0c（b/c 可并行）→ Y0.5 → Y1a → Y1b → Y1c-1 → Y1c-2 → Y1c-3 → Y2 → Y3（Y2 三门全绿才准删 reconcile；Y1c-1 硬前置=Y0a+Y0.5 迁移链）；**★上线门槛=0 号+Y0a+Y0b+Y0.5+Y1a+Y1b+（Y1c-2 三项 exec v2/E26/Y.Text 随上线批强制，E39）**——Y0c/Y1c 其余/Y2/Y3 收益是维护成本与模型完备性，上线后按序；Y4 → Y5 → Y6 按序（E16）；Y7 挂上线前（多实例=移除租约+所有权注册表，E23/E35）
- 命名规则：spec → `docs/superpowers/specs/<立项日>-y<N>-<slug>-design.md`；plan → `docs/superpowers/plans/<立项日>-y<N>-<slug>.md`；立项后回填链接、更新状态列
- 旧编号映射：B0→Y0…B7→Y7（C10）；更早 U 系处置不变（U1 作废；U2 并入 Y1/Y4；U3→Y5；U4→Y6）

### 立项纪律（每批 spec 首节必带，v7 六条；内容同 v5/v6 未变）

1. **基线快照表**：对当日代码 grep 出的行号/符号/census 计数落档为 spec 首节，替代跨文档内嵌事实（外部评审行号漂移已多次实证此风险）
2. **删除类任务五行 census**：生产调用点/测试夹具引用/扫描门禁命中/allow 自证/re-export，逐行标改·删·放行；删除类红相来自 test/守卫/allow，不适用"排除 spec"计数纪律
3. **每批出口判据+回滚动作+冻结契约**三件齐全方可立项
4. 禁止垫片/兼容层：旧版拒载、旧缓存禁读、旧 bundle 拒连接，一律 fail-closed 且给明确 UX
5. **门禁先红**（D13）：门禁类任务必须先故意变红再落地，红因与门禁声明一致（G1-G3/C6 序门禁/C8/D4 measured 门禁通用）；假门禁先修真——恒真断言/只计数不抛的"门"不算门禁（E15-Y3 前置）
6. **RPO/RTO+观测面+CI 载体三件**（E18）：每批 spec 必给 RPO/RTO 影响、新增观测面、CI 载体三项，缺一不得立项——无 CI 承载的门禁是纸门禁（nightly 摘除/e2e-collab 手动触发已知红/520 锚手动跑已实证）

---

## 1. 事实基线（现状勘察，全部实证）

> 以下 §1-§5 为审计基线（2026-10-06 上午时点快照，行号已随后续提交漂移），仅作背景与沿革；执行判据一律以 §0（A+C+D 裁决+批次表）为准。

### 1.1 写路径三层现状

底层单漏斗已存在：`dispatchCanvasIntent`（canvasIntents.ts:256-269）= canEdit 门 + `applyIntentToDoc`（Y.Doc 单 transact 首写）+ `projectIntentToStore`（zustand 投影回填）。7 种 `CanvasIntent`（canvasIntents.ts:44-51）是原子写词汇表。**三条上层路径最终全部收敛到它**：

| 路径 | 现状 | 入口数 |
|------|------|--------|
| A. `runCommand(fn)` 封装 | canvasStore.ts:1763-1777：canEdit 门 → `stopCapturing()` → capture 投影 → 执行 fn（catch 提示不 rethrow）→ finally `dispatchProjectionDiff(before, Origin.LocalUser)` | 6 处（arrangeSelection :1790、arrangeGroupChildren :1833、组改名 :2501、组色 :2517、duplicateNodes :2688、pasteGroupClipboard :2733） |
| B. 裸写 `capture + dispatchProjectionDiff` | 与 A 同模式的手工展开，**缺 `stopCapturing()`** | 14 处（deleteNode :672→715、onNodesChange 尾 :1507→1531、groupNodes :1868、ungroup :1941、addToGroup :1967、removeNodeFromGroup :2076、dropIntoGroup :2147、dropImageIntoStoryboard :2301、mergeStoryboard :2360、convertGroup :2400、resizeStoryboardGrid :2592、clearStoryboard :2627、addImageToStoryboardCell :2644、removeStoryboardCell :2673） |
| C. 单原子直发 intent | 不经 capture/diff，直接 `dispatchCanvasIntent` | ~37 处（canvasStore 拖拽提交 :1294、resize :1201、连线 :1549 等 22 处；nodeStore 文本编辑/生成回写/裁剪共 15 处） |

关键历史裁定：runCommand 注释（canvasStore.ts:1758）明确"仅新命令使用；既有 16 处 capture/diff 点不迁移（spec:169 既有命令不动）"——即裸写共存是 **R2 过渡期的范围裁定**，不是架构认可。当时动机是风险隔离（Yjs 改造进行中不扩大回归面）；如今 Yjs 已是唯一路径、组/分镜测试套齐备，该裁定的前提已失效。

辅助设施：`geometryWriterRegistry.ts`（写者枚举+全量归类账本：外部 setState 29 处+内部 set 44 处，供写者上下文校验）；`dispatchProjectionDiff`（canvasIntents.ts:462）= reconcileGroupGeometry 反推 → diffProjectionToIntents 差分翻译 → 单 transact 落 doc+store——**diff 桥本身就是复杂度热点**。

### 1.2 撤销重做现状

**现行 = Y.UndoManager 绑定 Y.Doc 共享类型**（canvasUndo.ts:16-19）：

- 绑定 `[doc.getMap('nodes'), doc.getMap('edges')]`，`trackedOrigins` 仅 `Origin.LocalUser`（:17）
- Origin 四常量分型（:8）：Server/AutoEdge/Geometry **刻意不入栈**（:6-7 注释——自动边与几何修复不入撤销栈，防啃 STACK_LIMIT）
- `captureTimeout: 500`（:18）内建合并窗口；`stopCapturing()`（:35）手动切断
- `STACK_LIMIT=100`（:10），`stack-item-added` 事件手动 `shift()` 截断（:20-25，Yjs 无内建上限）
- `undoCanvas()`（:44-57）：undo 后比对节点 id，消失节点取消活跃进程（防幽灵任务）；项目切换防串（:49）
- 快捷键：useGroupKeyboard.ts:41-43（Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y），守卫输入框/AntD 弹层/视频编辑器（:9-27）

协作语义正确：本地 undo 产生反演事务经 Hocuspocus 同步远端（CRDT 合并）；远端更新 origin 非 LocalUser 天然不入本地栈（选择性撤销）。doc→store 回写由 runtime `applyDocToStore` 50ms debounce 重建（canvasCollabRuntime.ts:1015-1036）。

旧 zundo 快照方案 spec 已标 historical（canvas-undo-redo.md:1）。视频剪辑器 history（video-editor/timeline/history.ts）为独立域，不纳入本次范围。tech-debt.md 无 undo 现行专项登记。

### 1.3 协作与持久化现状

服务端（apps/api/src/modules/collab/）：

- Hocuspocus Server 4.6.0 独立端口 3001（collab.gateway.ts:107），两套 Redis 协同：库 extension-redis（pub/sub 广播+Redlock store 锁+跨实例 diff 同步）+自研 CollabRedisSync（装载时向对等实例要 diff，loadDocument:226 活调用——v5 E9 判定冗余：与库内建 syncInitialStateFromPeers 重复，Y0 删）
- 持久化 PG 双表：`CanvasDoc`（projectId PK，state=Y.encodeStateAsUpdate 全量快照，schema.prisma:808-813）+ `CanvasDocUpdate`（追加式增量，全局 SEQUENCE 取 seq，schema.prisma:834-843）
- 加载 = 快照+增量按 seq 重放（gateway:195-246）；写入 = onStoreDocument debounce 2000ms 批量单行 append（gateway:266-303，pending 队列 64 封顶合并）
- **compact 已有**：advisory lock 事务内重放快照+删增量行（repository:43-71），时间门限 60s（gateway:306-311）+断连收敛——即"PG 内定时快照+GC"已实现，仅缺 COS 归档
- 鉴权：WS query token 或 httpOnly cookie，teamMember+ProjectMember 校验，VIEWER 只读（gateway:143-162）

客户端（canvasCollabRuntime.ts）：

- `@hocuspocus/provider` 4.6.0（:859-866）；Y.Doc 顶层 `nodes`/`edges`/`meta`/`exec` 四 map
- **y-indexeddb 未接入**：apps/web package.json 无依赖、代码零引用（TD-19 已立项）；现状离线兜底=10s 未 synced 置 failed 蒙层（:992-999）
- connStatus 三态（connected/connecting/offline）+ 3s watchdog 两级恢复（transient reconnect / terminal 重建）
- 读取链路：元数据 REST `GET /api/projects/:id`；节点/边数据**完全来自 Yjs sync**（:890 注释"替代 GET nodes/edges"），projection=Y.Map→React Flow records（applyDocToStore :719-799）

---

## 2. Q1 评估：runCommand 统一改造

> ⚠️ 本章 **DELETED**（v5 E10）：A1 裁决已作废 runCommand 迁移（capture/diff 模式整体随 Y3 退役，14 处迁移不再执行），且本章行号/计数已漂移（现写路径 census=漏斗+dispatchProjectionDiff 桥；helper 实名 captureStoreProjection）。仅留档防按旧 census 施工，不得作为执行依据。

### 2.1 裁定：建议执行（推翻 R2 过渡期裁定）

**理由**：

1. **同一模式的手工重复**：路径 A 与 B 是同一事务编排（capture→mutate→diff dispatch），B 缺 `stopCapturing()` 意味着 14 处的 undo 步边界不受控——依赖 500ms 窗口默认合并，连续组操作（如 onNodesChange 尾部善后紧跟显式命令）可能产生步边界漂移，这是一类结构性 bug 温床
2. **过渡前提已失效**：R2"既有不动"的动机是 Yjs 改造期风险隔离；现 Yjs 为唯一路径、组/分镜域测试套齐备（canvasStore.groups.test.ts、canvas-dispatch-ratchet.test.ts 等），回归保护网已就位
3. **收敛认知与测试矩阵**：上层路径 3 条收敛为 2 条（runCommand 复合命令 + 单原子 intent 直发）；新写点默认获得 canEdit 门+单 undo 步+diff 收尾，不再依赖作者记忆
4. **为后续批次铺路**：统一入口=统一 origin 标注、统一合并策略挂点（Spec B 几何批量、离线编辑合并等都受益）
5. **压缩 diff 桥复杂度**：14 处各自为政的 before/after 差分翻译收拢后，`dispatchProjectionDiff` 的调用面收缩，审计面缩小

**收益**：删除 ~14 处三段式样板（每处 3-5 行→1 行调用）；undo 步边界全局一致（每命令恰一步）；写者账本（geometryWriterRegistry）以 runCommand 为口径校验更简单。

### 2.2 风险与对策

| # | 风险 | 对策 |
|---|------|------|
| R1 | runCommand **catch 吞错不 rethrow**（canvasStore.ts:1772-1773），与部分裸写点的错误传播语义不同（调用方若依赖异常中断后续逻辑会行为变化） | 迁移前逐点核对调用链；必要时 spec 中裁定 runCommand 契约是否需补 rethrow 选项 |
| R2 | 补上 `stopCapturing()` 会**改变 undo 合并粒度**（原先 500ms 内相邻操作可能被合并为一步的，现在强制分步） | 行为变化显式写进测试断言；粒度变化属改善（步边界=命令边界），但需用户知晓 |
| R3 | 14 处集中于**组/分镜不变量敏感区**（与 reconcileGroupGeometry 交互） | TDD 迁移：先为每处补特征测试（红）→ 迁移（绿）；现有 groups/batchConnect 测试套护栏 |
| R4 | 一次性迁移 14 处回归面大 | 分 3 片按域推进：组操作（group/ungroup/addTo/removeFrom/dropInto）→ 分镜操作（storyboard 7 处）→ 删除善后（deleteNode/onNodesChange 尾） |

### 2.3 边界建议

- 路径 C 的 ~37 处单原子直发**不需要**包 runCommand：单 intent 天然单 transact 单 undo 步，包装纯属冗余
- 建议顺带在 spec 中裁定：runCommand 签名是否升级为 `runCommand(name, fn)`（命名命令，便于 origin 标注与调试）；以及 fn 契约三条款（:1759-1762 注释：plain set only / 先校验后写 / finally 恒 diff）是否需类型层约束
- **非目标**：不重写 CanvasIntent 词汇表、不动 dispatchCanvasIntent 底层、不合并路径 C 进 runCommand

---

## 3. Q2 评估：撤销重做

### 3.1 裁定：无需切换，现行即目标方案

"升级后是否应使用 Y.UndoManager"——**答案是已经在用**：canvasUndo.ts:16-19 于 2026-09-30 Yjs 上线时同步切换（旧 zundo 快照式已退役，spec 标 historical）。问题从"是否采用"转为"是否补强"。

### 3.2 现行实现对照协同最佳实践核对（全部 ✓）

| 实践 | 现状 |
|------|------|
| 选择性撤销（仅撤本人操作） | ✓ trackedOrigins=[LocalUser] |
| 远端操作不入本地栈 | ✓ origin 过滤天然实现 |
| 自动衍生写排除（自动边/几何修复） | ✓ AutoEdge/Geometry 刻意不入栈（:6-7） |
| 栈深上限 | ✓ STACK_LIMIT=100 手动截断 |
| undo 副作用清理 | ✓ 消失节点取消活跃进程（:50-56） |
| 输入上下文守卫 | ✓ 快捷键拦截输入框/弹层/视频编辑器 |

该设计与 2026-08-28 enhancements spec（"Y.UndoManager 替换 zundo，origin 分型：仅 local-user 入栈"）一致，且经生产与测试验证。

### 3.3 补强清单（建议进入 spec，优先级从高到低）

1. **执行回写 origin 语义确认**：nodeStore 生成回写/裁剪走直发 intent（origin=LocalUser，即可撤销）——确认这是期望语义（用户 Ctrl+Z 撤掉 AI 生成结果通常符合直觉，但需明示裁定入档）
2. **undo 步边界盘点**：runCommand 收敛（Q1）自动解决大半；剩余路径 C 单 intent 直发点逐类确认步粒度（如连续拖拽依赖 500ms 窗口合并是否保留）
3. **canUndo/canRedo 事件驱动 UI**：核对撤销/重做按钮可用态是否监听 stack 事件（若当前为轮询/无态，补 stack-item-added/stack-item-popped 订阅）
4. **exec map 服务端写入隔离确认**：服务端 withDoc transact（Origin.Server 预留常量 :6）确认不进用户栈——防御性核对，勿改语义

### 3.4 不采用项

- 不回退自建 diff/快照栈（协作下必然分叉，属倒退）
- 视频剪辑器 history（timeline/history.ts）独立域不并入（快照栈对时间轴域合适）

---

## 4. Q3 知识点确认

**属实。** `UndoManager` 是 `yjs` npm 包的原生导出（`import { UndoManager } from 'yjs'`），专为 Yjs 共享类型（Y.Map/Y.Array/Y.Text）设计的撤销重做模块。核心机制：按事务 origin 追踪共享类型变更，`undo()/redo()` 生成反演事务；协同场景下默认仅撤销 trackedOrigins 内的本地变更（选择性撤销），远端变更不受影响；`captureTimeout` 提供事务合并窗口、`stopCapturing()` 手动切步。

本项目佐证：canvasUndo.ts:14-19 生产使用（yjs ^13.6.32，web/api 双端同版本），绑定 Y.Map('nodes')/Y.Map('edges')。

---

## 5. 目标架构差距分析（自动保存方案四要素）

| 要素 | 现状 | 裁定 |
|------|------|------|
| ① 前端离线缓存 y-indexeddb | 未接入（依赖+代码零，TD-19 已立项） | **全缺，需建设** |
| ② 服务端权威持久化 Hocuspocus | ✓ CanvasDoc 快照+增量 append+debounce | 行级落地；**v5 勘误（E10/E11）**：存在 compact 竞态/失败蒸发/Redlock skip 三条丢数据路径+withDoc 全量装载放大——Y0 修 |
| ③ 定时快照+GC | ✓ PG 内 compact（60s 门限+删增量行） | PG 内已落地；**COS 归档缺失** |
| ④ 水合加载优先本地缓存 | 仅 Yjs sync 水合（runtime:890） | **缺 local-first 水合管线** |

### 5.1 y-indexeddb + 水合管线设计要点（供 spec 展开）

- **绑定顺序**：`IndexeddbPersistence(docName, doc)` 与 provider 并行绑定同一 Y.Doc；本地缓存先回放（毫秒级出图）→ 服务端 sync 到达后 CRDT 自动合并——无"切换"逻辑，这是 CRDT 结构性优势
- **hydration 状态机扩展**：hydration 已四态（idle/pending/ready/failed，E10 勘误），需增加 `cache-ready` 档：cache 回放完成即可交互渲染，synced 后二次刷新——**注意与 10s failed 蒙层（runtime:992-999）的时序重构**：离线时 cache-ready 应可继续编辑（离线编辑暂存本地，恢复后自动合并）；failed 不自愈+connUi 零读者两项 E5/E10 已立项处置
- **离线编辑与 watchdog 交互**：terminal 重建策略与"离线可编辑"需在 spec 中合并裁定（离线期间 doc 仍可写，重连后 provider sync 携带本地 update 上行）
- **GC**： Indexeddb 库按 docName 生命周期清理（项目删除时联动）；y-indexeddb 自身无版本迁移需求（存的是 update 流）
- **风险提示**：多标签页（y-indexedbc 广播跨标签同步，与 provider 单飞原则核对）；IndexedDB 损坏兜底=清缓存重拉服务端（权威源在服务端，安全）

### 5.2 COS 定时快照设计要点（供 spec 展开）

- **复用 compact 产物**：compact 事务产出全量 state 后同步 PUT COS（对象键含 projectId+时间戳），PG 内 compaction 逻辑零改动
- **保留策略**：建议分层（近 7 天每日 + 30 天内每周 + 更久每月），COS 生命周期规则可托管删除
- **恢复路径**：从 COS 拉回二进制 → 写入 CanvasDoc.state（需管理端点或脚本，走 withDoc 服务端唯一写者）
- **部署时序**：上线腾讯云 ECS 时启用（本地开发 MinIO 可同构验证：S3 兼容 API，CosSDK 换 endpoint 即可）；本批先落"PG→对象存储导出器+调度"，ECS/COS 凭证属部署项

---

## 6. 审核结论

> ⚠️ 本章为 v1 审核结论留档：第 1 条（Q1 runCommand 收敛）已被 §0.1 A1 裁决与 §2 DELETED 横幅取代；第 4 条"补全关系"经 v5 E10/E11 勘误（服务端存在三条丢数据路径）。执行判据一律以 §0 为准，勿引用本章结论。

1. **Q1 成立**：执行 runCommand 收敛，定性"规约收敛"而非"架构重写"；R2 过渡期"既有不动"裁定前提已失效，应推翻；分 3 片 TDD 迁移，风险对策见 §2.2
2. **Q2 已实现**：现行撤销即 Y.UndoManager 绑定 Y.Doc 共享类型，协作语义正确；按 §3.3 清单补强即可，无架构动作
3. **Q3 属实**：Y.UndoManager 为 yjs 原生模块，专为共享类型设计
4. **架构总判定**：目标架构与现状是"**补全**"关系而非"推翻"关系——个人模式架构已淘汰完毕（无兼容垫片需要拆除，符合项目"不留旧模式垫片"约束）；四要素中 ②③(PG 部分)已落地，①④与 COS 归档为本轮建设增量
5. **执行方式**：后续开发按 §0.1 批次目录逐批推进——每批由用户启动，单独走 spec → plan → TDD 三阶段，每阶段经用户确认后执行

