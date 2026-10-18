<!-- doc-status: active -->
# Y1a+Y1b：doc 模型 v3·序与尺寸/只读（B 类合并批设计）

- **立项日**：2026-10-18；**唯一上游依据**：[2026-10-06-canvas-yjs-arch-upgrade-review.md](2026-10-06-canvas-yjs-arch-upgrade-review.md)（master spec v8.3）§0.2 Y1a/Y1b 两行+§0.1 裁决（D5/D4/E68/C7③）。
- **B 类合并立项**（Y1a+Y1b——E6 序域与 C5↔D4 同批硬约束共用）；plan=`../plans/2026-10-18-y1a-y1b-doc-model-order-size.md`（writing-plans 产出）。
- **用户立项三澄清（2026-10-18 一轮）**：①单 spec 单 plan+多段片序（每片出口=用户确认点）；②收敛 harness=内存双端基底+期望序断言+真连集成；③UI 变更面=零（VIEWER 拒写视觉沿用现有只读横幅体系）。
- **修订链**：
  - **v2（二轮）**：v1 五条 Z 裁决废止（Z1 第七 op/Z2 读侧 throw/Z3 全局排序/Z4④ 运行期 rebalance/Z5 总是覆盖/Z6 闩锁核销/Z8 text auto——违反 D5/D4/E68）；v1 两处基线核验错误勘正（execution.gateway.ts 实存 modules/gateway/〔:116-126 emitStitchStatus 带 wh/cellCount〕；reportNodeSize 7 调用点=内容事件拟合非 DOM 测量〔contentEventSize naturalW/H 三分支〕——C5 真删除对象=dispatchFixtureSizeIntents 链）；用户二轮裁决：固有尺寸=data 层 natural*+contentEventSize 三分支+零新 op。
  - **v3（三轮）**：（摘要——v2 两处自相矛盾修正〔严格读热路径/G10〕+三型分裂+cs 携带 order 裁定+SyncStatus(false)/spool replay/onUpdateDelta 实证；全文见 git 历史 ee41624f）
  - **v4（四轮·三份 v3 外审逐钉核验后，四 P0 全部实证）**：
    1. **「observer 丢弃帧」机制误判废止**（Yjs `doc.on('update')` 在事务 apply 后触发——persistence 入队即挂此事件〔persistence :165-177 实证〕，observer 看到时 update 已入 doc/入队/将广播，**丢不了**）→改为**检测→隔离→修复**（quarantine+close 违规连接+repair-doc-order）；beforeSync scratch 预校验仅作 C0a 成本评估可选项。
    2. **`forceSync` 假重发废止**（provider.cjs:756 实证：`forceSync()=resetUnsyncedChanges()+send(SyncStep1)`——**只拉服务端缺失不推本地被拒 update**，且 reset 后 unsynced=1 非 0）→resync 改**重连/重放/丢弃三路**（重发本地 update 须完整重连握手）。
    3. **主画布 total vs ordered 矛盾修正**（v3 Z2''「热路径恒 total」与 Z3''「applyDocToStore 读层序」不能同时成立）→**三函数模型**：`orderRecordsStrict`（装载/种子/写侧 throw）+**`orderRecordsTotal`（投影热路径——缺/非法 order 确定性落位〔按 (parentId,id)〕+计数不抛）**+公开快照用 total-ordered（**禁 strict——一个坏节点不能让公开页 500**）。
    4. **natural\* 定性修正+键级跳过**：natural*=**server-provided hint**（显示拟合输入，非权限事实——客户端可覆盖仅影响自己的显示，不入计费/权限判据）+`applyWriteNodeDataToDoc` 对 natural\* **键级校验跳过**（非法/类型不允许→跳过该键+计数，fileId/resultUrl 照常写，返 `written:true`+`skippedKeys`——**只有节点不存在才 written:false**；v3「typed reason 拒整 op」=交付误杀废止）。
    5. **上传 probe 绑定链路补全**（presignUpload Media.create 只写 userId/teamId **无 projectId/nodeId**〔:21-24 实证〕——异步 probe 完成后无 doc 写依据）→**方案①**：图片 confirmUpload 同步 sharp probe 返回 `{width,height}`+**Media.projectId 落库**（列已存非迁移）；视频异步 probe 完成经 socket/poll 事件回客户端→`updateNodeMediaFact` 写 doc。

## 0.1 本批有效裁决（master 内联+本批 Z'' 系）

| 编号 | 裁决 | 效力 |
|------|------|------|
| **D5** | order 仅同 parentId 层内生效；投影数组序=层序遍历（父先子后）+同层 (order,id)；不设跨层全局序；Origin 枚举加第 5 常量 Maintenance；rebalance 仅会话开始一次；ensureParentOrder 冻结「仅 RF 父先子后契约，禁承担 z 序」 | §2 |
| **D4** | 上传=服务端元数据命令写；生成=落地补一次解码写；**视频=受控一次性 bootstrap（doc 已有 wh 零写首写者胜**/独立 origin 不入撤销栈/量化幂等）；维度缺失=合法态+DEFAULT_CHILD_SIZE 兜底；text=持久化作者尺寸；measured 仅节点内部视觉禁入帧派生 | §3 |
| **E68** | 读侧全函数（绝不抛）/写侧显式拒绝（业务错误码）/禁修复写回 doc（[canvas-invariants.ts:33-35](../../../packages/shared/src/canvas/canvas-invariants.ts)；adversarial-readers.spec 断言不抛） | §2/§3 |
| **C7①③** | 版本协商拒旧+「排空切换 runbook 进 Y1（第一个弄脏 doc 的批次）」 | §6 |
| C5/C6/C5↔D4/D13/E6/E8/E15 | 宽高三源/序分层/同批硬约束/门禁先红/键长上限/元数据可取性前置/收敛 harness | §2/§3 |
| **Z1''（v4 修订）** | **服务端写 hint 不写布局+键级跳过**：`SERVER_NODE_DATA_KEYS` 扩 natural*（逐键表 number/上限 100000/finite 正整数>0，**并入 validateNodeRecord 校验域**——防客户端 raw write 负数/Infinity）；**natural\*=server-provided hint**（显示拟合输入非权限事实——客户端可覆盖仅影响自己显示，不入计费/权限判据）；**`applyWriteNodeDataToDoc` 键级跳过**（natural* 非法/类型不允许〔按 node.type 拒 group/text/audio/multiImage/videoEdit；storyboard 格子 imageGen 允许〕→**跳过该键+skippedKeys 计数，fileId/resultUrl 照常写，返 `written:true`**——只有节点不存在/非 Y.Map 才 `written:false`；**typed reason 拒整 op 废止=交付误杀**）；同值 no-op 返 written:true；cellCount 不做；probeArtifacts 不加 natural* | §3.1 |
| **Z2''（v4 修订）** | **类型三分裂+三函数读模型**：`DocNodeRecord.order?: string`（total 读出口）+`OrderedDocNodeRecord`（严格——fillDoc/applyRecordToYMap/applyIntentToDoc 只收）+cs `ProjectedCanvasNode`（NODE_ENVELOPE_KEYS 锚不动）；**三函数**：`orderRecordsStrict`（装载门/种子门/写侧——缺/非法 throw→terminal `doc-shape-invalid`）+**`orderRecordsTotal`（投影热路径——缺/非法 order 按 (parentId,id) 确定性落位+`doc_integrity_invalid_total{stage}` 计数，不抛不白屏）**+公开快照/clone 走 **total-ordered**（禁 strict——一个坏节点不能让公开页 500）；校验正则 `/^[0-9A-V]{1,128}$/` **补「不得以最小字符 `0` 结尾」不变量**（前缀安全前提——`between(a,a0)` 无解防）；全链禁 `as`；**readCanvas 六消费者逐项分类**（billing execution:167/探针:259/REST:24 worker-only/write port:51=total；公开快照/clone=total-ordered）；**catch 层只接已知 shape 错误**（OrderInvalid/DocShapeInvalid→enterDocInvalid 停 observer+terminal+导出；**其他异常 rethrow〔DEV〕/计数重试〔prod〕——catch-all 会把普通 bug 永久终态化**）；**运行期=检测→隔离→修复**（服务端 update observer 检测本事务变更节点 order 非法→doc 置 `quarantined`+停服务端写+close 违规连接+广播 terminal+保留导出——**禁「丢弃帧」表述**〔Yjs update 事件在 apply 后，丢不了〕；beforeSync scratch 预校验=C0a 成本评估可选项非承诺）+`scripts/repair-doc-order`（输入 PG/spool 重放 doc+输出审计〔节点/旧新 order/操作者〕+幂等） | §2.1 |
| **Z3''** | **D5 层序+接线闭合**：读出口=pre-order 层序 DFS（孤儿/环=根处理——环内先访问者按 (order,id) 定序**三面固定同一语义**）；**DOC_NODE_KEYS 三处接线**（`DOC_WRITE_OPS.fillDoc.keys=[...DOC_NODE_KEYS,...DOC_EDGE_RECORD_KEYS]`/validateWriteBatch fillDoc 分支改 DOC_NODE_KEYS+required order 校验/`DOC_KEY_MANIFEST.nodes[0].path`——漏接=服务端 seed/clone 带 order 整批 UNKNOWN_KEY 拒）；**renderCanvas Pass2/snapshot-filter.ensureParentFirst 是「保序+父先子后」非排序**——须喂 readOrderedRecords 输出或 `RawNode` 加 order 内排（三选一片 A2 定）；`ensureParentOrder` **中间态策略**：`setWithParentOrder`（groupNodes/ungroup/move 命令中间 set）保留拓扑整理（只保证父在子前不承诺 z 序）+`assertLayerOrder` 仅挂 dispatch 后/doc 投影后收口点（中间命令态误炸合法命令=禁）；snapshot-filter `RawNode` 加 order+公开载荷白名单显式收录（防无意泄漏/丢失）；`checkProjectionInvariant` 补「store 数组 id 序==doc 层序」断言（现按 id 排序比较对序盲） | §2.2/§2.3 |
| **Z4''（v4 修订）** | **装载期 rebalance 四钉+维护锁**：①origin 记账（SERVER_TRANSACT_ORIGIN 或入 onUpdateDelta 排除表）+**docTruth 重测**（重排后强制 `encodeStateAsUpdate` 一次——load 期一次性成本，非「补账」含糊）；②完整性门（pendingStructs/pendingDs 跳过+计数；**门顺序=加载一致性门→shape 门→rebalance→对外服务**——防不完整被误分类 doc-shape-invalid）；③首连窗口+**维护锁**（`rebalancePromises: WeakMap<Y.Doc,Promise<void>>` per-doc——多首连并发恰一次；首连 `beforeSync` await 该 Promise〔禁 connected 后异步裸跑〕；**chunk 间检查 connections.size**——有新连接/编辑则中止保留标记下次再试；**meta 置 `rebalancePending`/epoch**——进程 chunk 中间崩溃后 load 无条件重跑〔新键短使 max>32 条件消失的半重排态防〕；**quota 门**：接近 softLimit/已 freeze 跳过重排+计数〔重排自触发冻结防〕；每 chunk 幂等）；④预算实测（2k/5k/10k encode 字节——512KB 是入站帧闸不适用）+按 parent 分块（~1000 键/事务）+仅重排键长>32 层 | §2.4 |
| **Z5''（v4 修订）** | **三分类写者+首拟合+作者标记**：单写者三分类（commitIntrinsicFit/commitAuthorSize/commitLayoutSize）；component load 只更新本地预览禁写 doc；首拟合修复=工厂写默认 wh+`data.aspectRatio` 初始值；**作者 resize 标记=`data.sizeMode:'auto'\|'author'`**（resize 提交置 author；显式「适应内容」置 auto——**「作者 resize 后禁自动 fit」的执行前提**，现有 contentEventSize 无此判据〔existingAspectRatio 不区分作者/固有比例——实证〕）；D4 按类型策略表（视频 bootstrap 已有 wh 一律零写只更新 natural*/aspectRatio）；**`currentWH` 从 doc 记录读**（非 cs——投影滞后/手势期非确定值）；`applyIntrinsicFit` owner=store 级单点（lastAppliedNatural 去重+同值零写+readOnly 跳过+group/multiImage 跳过） | §3.2 |
| **Z6''（v4 修订）** | **readOnly 机制+resync 三路（forceSync 假重发废止——provider.cjs:756 实证只发 SyncStep1）**：resync 载体=**重连/重放/丢弃**（**viewer=不自动 discard**〔静默删降权前输入=数据丢失——只置 terminal/横幅+保留导出/放弃显式出边〕；quota/drain/spool 冻结解除=**完整重连**〔disconnect→connect 重握手——SyncStep1/2 交换带本地状态重发被拒 update〕待 `synced∧unsyncedChanges===0` 超时转 diverged〔**禁以 reset 后 unsynced=1 当接受证明**〕；角色升权=确认角色后完整重连；schema/doc-shape=终态禁重放）；write-rejected stateless 按连接合并节流+payload 白名单；**onNodesChange 按变更类型分表**（select 放行/remove·position·dimensions·edges 拒）+cascadeDeleteVideoProject gate 前置+nodeStore 命令/投影机制分离（`applyProjectionNode` 内部面+lint/census 防组件直调）+undo 门细化；断言=零 local-origin update+本地命令零写（远端投影照常——select 例外显式排除） | §3.3 |
| **Z7''（v4 修订）** | E8 锚=产物 probe→doc natural*（EXIF orientation 5-8 交换/视频 side_data rotation 交换）；**probe 绑定链路定案〔方案①〕**：`Media.projectId` presign 落库（列已存非迁移——现 data 只写 userId/teamId :21-24 实证）+图片 confirmUpload **同步** sharp probe 返回 `{width,height}`（客户端绑定媒体同命令写 natural*+frame）+视频异步 probe 完成经 **socket/poll 事件**回客户端→`updateNodeMediaFact` 写 doc（禁「Media.metadata+doc 更新」无载体说法）；`updateNodeMediaFact` 全链定义（CanvasIntent 变体+applyIntentToDoc+projectIntentToStore+diff+权限/来源校验——受信事件/上传确认路径可调）；**矩阵按绑定形态四类**（非产品名数枚举：已有节点+服务端产物〔AI 生图/改图/光照〕/客户端新建+服务端事件〔stitch/trim/separate〕/客户端新建+上传〔素材/标注/split/视频导出 videoEdit/generated-media register〕/客户端复制派生〔duplicate/paste/merge——复制 natural+display〕+无 natural 类〔text/group/audio〕——C0a 按此枚举含 videoEdit/导出/split/annotation/material/duplicate 禁漏） | §3.1 |
| **Z8''** | **工厂类型感知**：text/image/video/imageExt/multiImage 写默认 wh+**data.aspectRatio 初始值**；**auto/storyboard 组不写 wh**（0 帧键——键集表 applyKeySetTable 见 wh 即判 manual=帧派生全乱）；storyboard 子节点写 wh（网格单元）；audio/videoEdit 补默认（videoEdit 320×180 或显式合法无 wh 档——片 B2 定）；`fallbackSize(node,reason)` 单函数收编 8+ 消费点+metric 带 reason+**按 nodeId+reason+会话去重**（热渲染重复计数刷爆防）；happy-path=0（text 有作者 wh 不豁免） | §3.4 |
| **Z9''** | 版本双 bump 3（A1 首任务）+**reset runbook 六步**（①停写+drain ②**清 spool/quarantine**〔实证 loadDocument :393 replay——漏清即旧 v2 帧回灌〕③truncate CanvasDoc/CanvasDocUpdate ④清 Redis 相关键/停进程清内存 doc ⑤部署 api+web 同窗 ⑥IDB 键自然失效确认+seed/gate 重生成 v3）+**`doc-shape-invalid` reason 档**（shared CollabAuthReason 新增+客户端 terminal 处理〔现折 permission-denied/db-unavailable 分型错误〕+shapeRefusal 透传同 schemaRefusal 形态）；Y1c SCHEMA 职责改 4（master 目录表回填） | §6 |
| **Z10''** | **校验链收口（v2 Z10' 半程修正）**：`validateWriteBatch` 入参 `readonly unknown[]`——**switch+never 不成立**（op.op 是 unknown 无窄化）→**`Record<DocWriteOpType,Validator>` 表驱动**（新增 op 缺 validator=编译红）；`applyOp` 入参 DocWriteOp 联合——switch+never 维持成立；manifest.test 六 op 硬编码数组显式同步；G10 红相改「人为删一个 validator/case」（第七 op 已砍禁引用） | §3.1 |
| **Z11''** | **禁写门与写入路径矛盾修复**：`SERVER_ONLY_DATA_KEYS` 禁写门=`updateNodeData`/`updateConfig` 的 **patch 入口过滤**（剔客户端传入的 natural* 键；merged 输出保留 existing 的 natural*——**非 delete**）+`applyIntentToDoc(updateNodeData)` 对 natural* skip；**客户端新建节点**（stitch/trim/separate 结果）natural* 走 **addNode 工厂 data 域**（工厂允许初始值——addNode 不在禁写门辖下）；**上传替换已有节点**=显式 `updateNodeMediaFact` intent（带来源标记走校验）或 addNode 通道——禁「命令体一次性写入」无载体说法；`ImageNodeData/VideoNodeData` 补 natural* 类型声明 | §3.2 |
| **Z12''** | **创建+父变更/重排全路径 census**（v2 漏父变更）：创建路径（addNode/addChildNode/addChildNodes/addNodeWithEdge/addNodeAndBatchConnect/duplicateNodes/pasteGroupClipboard/mergeStoryboard/splitImageNode/createDerivedExtNode/dropImageIntoStoryboard/视频导出/素材库/AI 标注·改图·trim·separate 结果/seed/clone/gate）+**父变更/重排路径**（groupNodes/ungroup/addToGroup/dropIntoGroup/attachMember/removeNodeFromGroup/addImageToStoryboardCell/convertGroup——换 parent 必重分配 order，旧键属另一兄弟集）；**命令级 allocator**（先按目标父层分组顺序分配——禁每 action 自读 doc）+`buildNodeBase`（纯构造）+`allocateOrder(doc,parentId,anchor)`（dispatch 事务内）拆分；`NodeEnvelopePatch` 加 `order?:string`+`applyIntentToDoc(updateNodeEnvelope)` 写 order+`diffProjectionToIntents` 比较含 order（**cs 携带 order 裁定**——无此则父变更 order 无 diff 面）；`buildCopyPlan` 副本**子节点按新父层分配**（非仅置顶层）+`chunkCopyPlan` 整 plan 分配后切块（后块置顶反序防）；`assignSeedOrder` 按 parent 分组输入序均匀分配 | §2.5 |
| **Z13''（v4 修订）** | harness 载体=apps/web+**投影纯函数抽取**（「doc records→store nodes 数组」抽为 shared/web utils 纯函数——**零 antd/RF/zustand import**，Node config 测纯函数；applyDocToStore 集成用例放 jsdom/heavy——模块加载期摸 window 实证约束）；期望序五件套+参考模型+seed 失败输出；真连用例三条（旧 csv/降权 write-rejected+零写/服务端 natural* 同事务双端一致） | §2.6 |
| **Z14''（v4 新）** | **Ordered 桥全链闭环清单**（v3 只改读侧——构造/复制/填充入口五处断点）：`MinimalCSNode.order?`+`toDocRecords` 读 order；`toDocRecord(n, order)`（新签名）/`buildDocFromSnapshot` 走 `assignSeedOrder`；`CanvasIntent.addNode.node` 类型改 `OrderedDocNodeRecord`（applyIntentToDoc 才能合法 fillDoc）；**vacuum/exportFresh/snapshot 迁移清单**（collab-doc-registry.vacuum+collab-shrink.exportFresh+`readCanvasSnapshotCached`/`DecodedSnapshot.nodes`——total→ordered 窄化或 requireOrder，快照缓存双型同步；漏列=A1 全链零 as 过不了 tsc 或 as 埋回）；`DOC_KEY_MANIFEST` **order 独立行**（writers=客户端创建·重排+服务端维护；undo scope **双值拆分**——client-undo〔客户端 order 写〕/server-only〔Maintenance 重排〕——禁单 undo 覆盖两种写者） | §2.1/§2.5 |
| **Z15''（v4 新）** | **cs 类型链+allocator 时序**：`useCanvasStore.nodes: ProjectedCanvasNode[]`（React Flow Node 泛型化——现 `Node[]` 无 index signature 读 order 须 as，与 G13 冲突）；`projectIntentToStore` **updateNodeEnvelope 分支补 order 投影**（现 :281-293 只投影 type/parentId——父变更后 cs 旧 order）；**allocator 时序定死**（action 入口 capture before→目标父层分配 order 写入 cs→结构变更→capture after/diff→dispatch——顺序错则 NodeEnvelopePatch.order 永不触发）；**diff 数据键显式排除 `SERVER_ONLY_DATA_KEYS`**（cs 从 doc 投影带 natural*——diff 会生成无效果 intent 被 applyIntentToDoc skip） | §2.5 |
| **Z16''（v4 新）** | **杂项闭合**：multiImage 主图尺寸源=store `previewSize` 字段（组件写本地/commitLayoutSize 读——现 containerSize 依赖 imgSize 本地态）；`renderCanvas`/snapshot-filter **定案=API 出口一律 pre-order+Pass2/ensureParentFirst 降恒等断言**（不再三选一——三个面各留保序逻辑迟早分叉）；`fallbackSize` 去重 key 生命周期（会话级 Map+stage 标签——render/assert 双计防）；`CLIENT_PROTOCOL_VERSION` 注释钉死「本批因 doc v3 不可读而强制升级」语义（防以后误当 doc schema 同义词） | §2.3/§3.4 |

## 0.4 偏离登记表（滚动——实现与设计的差异单源）

| # | 偏离 | 落地形态与依据 |
|---|------|----------------|
| — | （空——v3 起点） | — |

## 1. 基线快照（2026-10-18 三轮一手核验；行号=master 96056a52）

### 1.1 序域与投影链

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [nodeOrder.ts:17](../../../apps/web/src/utils/nodeOrder.ts) ensureParentOrder | 拓扑输出（父先子后/环跳过）；[applyDocToStore:1301](../../../apps/web/src/stores/canvasCollabRuntime.ts) 消费；**setWithParentOrder（groupNodes/ungroup/move 中间 set）也调它**——中间态非层序 | D5/Z3''：中间态保留+收口点断言 |
| [canvasCollabRuntime.ts:1870/:1906](../../../apps/web/src/stores/canvasCollabRuntime.ts)+onRemote 50ms timer | applyDocToStore **三调用点均无 try/catch**——热路径 throw=白屏/卡水合（实证） | Z2''：enterDocInvalid catch 层 |
| [docShape.ts:138-166](../../../packages/shared/src/canvas/docShape.ts) | 裸迭代序 total 出口 | Z2''：total 维持+严格读新函数 |
| [docShape.ts:264-296](../../../packages/shared/src/canvas/docShape.ts) applyKeySetTable | 逐键显式构造——表外键静默丢（stripAuthorState/种子路径） | Z3''：order 保留 |
| [nodeEnvelope.ts:19-26](../../../packages/shared/src/canvas/nodeEnvelope.ts) | 双向编译锚；[projectCanvasNodes:29-37](../../../apps/web/src/utils/projectCanvasNodes.ts) 末尾 `as` 强转绕过检查 | Z2''：ProjectedCanvasNode+禁 as |
| [canvasIntents.ts:38-44](../../../apps/web/src/stores/canvasIntents.ts) NodeEnvelopePatch | 恰五键（type/parentId/position/width/height）**无 order**——diff 比较无写入路径（实证） | Z12''：加 order 键 |
| [canvasIntents.ts:462-481](../../../apps/web/src/stores/canvasIntents.ts) diffProjectionToIntents | addNode 无 order；updateNodeEnvelope 只比五键——group/ungroup/paste 实际写路径 | Z12''：cs 携带 order 裁定依据 |
| [copyPlan.ts:53-101](../../../packages/shared/src/canvas/copyPlan.ts) | 复制不重分配序 | Z12''：副本新键+子层分配 |
| arrangeSelection:79/geometry:68 | 落格/拼接空间序（四消费点） | 仅 id tie-break |

### 1.2 尺寸域

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [geometry.ts:301-322](../../../packages/shared/src/canvas/geometry.ts) contentEventSize | 三分支；**ratioChanged 需 existingAspectRatio≠null**——「类型谎言」注释自证：wh 有而 ratio 未立档时 changed=false 永不 fit（首拟合缺口实证） | Z5''：工厂写 aspectRatio 初始值 |
| reportNodeSize 7 调用点 | 内容事件拟合/错误兜底/resize 卸载/multiImage 派生（非 DOM 测量）；真测量链=dispatchFixtureSizeIntents（:374+canvasStore:1575/:1579/:1640） | C5 删除对象=测量链；7 点收口三分类 |
| [canvasStore.ts:778-788](../../../apps/web/src/stores/canvasStore.ts) addNodeInner | text 300×300/videoEdit width=320 无 height；image/video/audio 无默认 | Z8''：工厂类型感知补全 |
| [docShape.ts:324](../../../packages/shared/src/canvas/docShape.ts) measured 注记 | MinimalCSNode 类型注记（非白名单——assertions:20 实为 hidden/selected/dragging） | 删除面=类型注记+split 兜底改 |
| DEFAULT_CHILD_SIZE | 8+ 消费点（renderCanvas:63/:75+assertions:131+canvasCollabRuntime:1031+canvasStore:1390/:1966/:2008/:2029/:2132/:2278） | Z8''：单函数+去重计数 |
| [media-process.service:93-135](../../../apps/api/src/modules/media-process/media-process.service.ts) | 只取 wh——图片无 probe/视频无 rotation | Z7'' |

### 1.3 只读域

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [canvasUndo.ts:67-105](../../../apps/web/src/stores/canvasUndo.ts) | undo/redo 无 canEdit 门（origin=UndoManager 本地 update） | Z6''：门细化 |
| [nodeStore.ts:524-560](../../../apps/web/src/stores/nodeStore.ts) | addNode/updateNodeData/deleteNode 无门——**同时被命令与投影调用**（盲加门拦远端投影） | Z6''：命令/投影机制分离 |
| [canvasStore.ts:1529-1530/:1648/:1699](../../../apps/web/src/stores/canvasStore.ts) | onNodesChange 无条件 applyNodeChanges+**cascadeDeleteVideoProject 在 gate 前**；onEdgesChange 同 | Z6''：类型分表+级联前置 |
| [hocuspocus-server.cjs:295-313](../../../node_modules/.pnpm) | 库层 readOnly 对 SyncStep2/Update **发 SyncStatus(false)**（实证）——客户端 unsyncedChanges 保持>0 | Z6''：利用现有信号+forceSync |
| guardSyncFrame（doc-registry:706-746） | 帧闸 1009；readOnly=app 层 return+计数（库层照发 SyncStatus(false)） | Z4''/Z6'' |
| [canvasStore.ts:230-234](../../../apps/web/src/stores/canvasStore.ts) diverged 闩锁 | 三出边+boot-diverged 持久恢复 | Z6''：保留 |

### 1.4 服务端写面与产物绑定

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [execution.gateway.ts:116-126](../../../apps/api/src/modules/gateway/execution.gateway.ts) | emitStitchStatus 带 wh/cellCount；separate/trim 无 | Z7''：C0a 8 类矩阵 |
| [canvas-doc-manifest.ts:199/:223/:358/:113](../../../packages/shared/src/canvas/canvas-doc-manifest.ts) | valueTypes 全 string；fillDoc.keys=NODE_ENVELOPE_KEYS（**无 order——漏接=seed/clone 整批拒**）；validateWriteBatch if 链（新 op 不进分支）；manifest path 同 | Z1''/Z3''/Z10'' |
| [collab-doc-writer.service.ts:181](../../../apps/api/src/modules/collab/collab-doc-writer.service.ts) | applyOp default=运行时 throw | Z10''：never 穷尽 |
| [collab-document.service.ts:286-300](../../../apps/api/src/modules/collab/collab-document.service.ts) | applyWriteNodeDataToDoc 无条件 set（**无同值短路**——worker 重试膨胀） | Z1''：同值守卫+written:true |
| [canvas-doc-manifest.test.ts:165](../../../packages/shared/src/canvas/canvas-doc-manifest.test.ts) | 六 op expected 硬编码 | Z10'' |
| readCanvas 消费面 | **单出口六消费者**：execution 计费:167/video-project:98/video-work-clone:33/REST:24/探针:259/write port:51 | Z2''：双出口分流 |

### 1.5 版本与装载面

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| docShape:41/collab-protocol:8 | schemaVersion=2/csv=2 | Z9''：双 bump |
| [local-cache-key.ts:24-33](../../../apps/web/src/collab/local-cache-key.ts) | 键含 schemaVersion | Z9'' |
| [collab-doc-registry.service.ts:295/:393/:399](../../../apps/api/src/modules/collab/collab-doc-registry.service.ts) | onUpdateDelta 只排除 SERVER_TRANSACT_ORIGIN；loadDocument **replay spool**+cheap 上界；docTruth=cheap | Z4''/Z9'' |

## 2. Y1a 序域设计（D5 分层直译+数据流闭合）

### 2.1 类型三分裂与读出口（Z2''）

- **三型**：`DocNodeRecord.order?:string`（total 读/作者投影）｜`OrderedDocNodeRecord`（严格——fillDoc/applyRecordToYMap/applyIntentToDoc 入参）｜`ProjectedCanvasNode=CanvasNodeRecord&{order?:string}`（cs 面，NODE_ENVELOPE_KEYS 锚不动）。`readOrderedRecords`=Raw→Ordered 窄化（校验 `/^[0-9A-V]{1,128}$/`），全链禁 `as`；`projectCanvasNodes` 删 cast 显式构造。
- **三函数读模型（v4）**：`orderRecordsStrict`（装载门/种子门/写侧 throw→terminal）+**`orderRecordsTotal`（投影热路径——缺/非法 order 按 (parentId,id) 确定性落位+计数不抛——E68 与 D5 层序同时成立）**+公开快照/clone=total-ordered。`applyDocToStore`=total 读+orderRecordsTotal→层序 store（坏节点 canary 不整 doc 终态）；catch 层只接 shape 错误（其他 rethrow/计数重试）。
- **readCanvas 六消费者逐项分类**：billing/探针/REST worker-only/write port=total；公开快照/clone=total-ordered。
- **运行期=检测→隔离→修复**：update observer 检测变更节点 order 非法→quarantine+close 违规连接+广播 terminal+保留导出（**「丢弃帧」不可实现**——Yjs update 事件在 apply 后，persistence 入队即挂此事件实证）；`scripts/repair-doc-order`（审计+幂等+处理 spool/PG 重放 doc）。

### 2.2 分数索引（四边界+两函数）

`generateOrderKeyBetween` 返回 typed `{ok}|{ok:false,reason}`（非异常控制流）；字符集 base32 断言**数组严格递增**（非字符码差 1——`'9'→'A'` 差 8）；生成键**不得以最小字符结尾**不变量（防前缀无解）；头尾虚拟边界+首键中位前缀；等值键 `between(a,a)` 定死；纯函数；阈值 32/硬上限 128（客户端不因长度失败——超阈置标志，耗尽=typed `OrderKeyExhausted` 命令拒绝）。单测：严格递增/前缀对（a vs ab+a vs a0 无解）/等值/邻接/头插 1000 次/property 10k。

### 2.3 层序读出口与三面收编（Z3''）

- `orderRecords`（shared）=pre-order 层序 DFS（每层 (order,id)；孤儿/环=根处理——**环内先访问者 (order,id) 定序三面固定同一语义**）。
- **DOC_NODE_KEYS 三处接线**（fillDoc.keys/validateWriteBatch fillDoc+required/manifest path）——漏接=服务端 seed/clone 整批 UNKNOWN_KEY。
- **renderCanvas/snapshot-filter 定案（v4·Z16''）**：API 出口一律 pre-order（消费 orderRecordsTotal/Strict 输出）+Pass2/`ensureParentFirst` 降**恒等断言**（不再各留保序逻辑——三面迟早分叉）；`RawNode` 加 `order?:string` 仅为公开载荷显式收录。
- **ensureParentOrder 中间态**：`setWithParentOrder` 保留拓扑整理（只保证父先子后）；`assertLayerOrder` 仅挂 dispatch 后/投影后收口点（中间命令态误炸=禁）；`applyDocToStore` 读层序后 ensureParentOrder 断言**引用恒等**（传新数组——内容相等不够，防静默改写）。
- `checkProjectionInvariant` 补「store 数组 id 序==doc 层序」断言。

### 2.4 装载期 rebalance（Z4''）

四钉+维护锁（§0.1 Z4'' v4）：origin 记账+**docTruth 重测**（encodeStateAsUpdate 一次）；**门顺序=加载一致性门→shape 门→rebalance→对外服务**；pendingStructs/pendingDs 跳过+计数；**维护锁**（`rebalancePromises` WeakMap per-doc 恰一次+首连 `beforeSync` await+chunk 间 connections.size 检查中止保留标记+meta `rebalancePending`/epoch 崩溃恢复+**quota 门**〔接近 softLimit/已 freeze 跳过+计数〕+chunk 幂等）；**预算=实测**（2k/5k/10k encode 字节——512KB 是入站帧闸不适用）+按 parent 分块+仅重排键长>32 层。断言：docDelta 不增/不触发 freeze；REST 预装载后首 WS 重排恰一次；chunk 中间崩溃后 load 重跑；重排后首帧投影相对序一致。

### 2.5 创建+父变更全路径（Z12''）

工厂拆分（`buildNodeBase` 纯构造+`allocateOrder(doc,parentId,anchor)` 事务内）+**命令级 allocator**（多节点命令先按目标父层分组顺序分配）；`NodeEnvelopePatch.order?`+applyIntentToDoc 写 order+diff 比较含 order（cs 携带 order）；父变更/重排路径 census（§0.1 Z12'' 清单）；copyPlan 副本按新父层分配+chunkCopyPlan 整 plan 后切块；assignSeedOrder 按 parent 分组。

### 2.6 收敛 harness（Z13''）

载体=apps/web 独立 node config（shared 零 yjs 维持）；期望序五件套+参考模型（模型基准防两端一起错）+seed/clientIDs/transcript 失败输出；真连用例三条（旧 csv/降权 write-rejected+零写/服务端 natural* 同事务双端一致）归 heavy/e2e。

## 3. Y1b 尺寸/只读域设计

### 3.1 服务端固有尺寸写（Z1''/Z10''）

`SERVER_NODE_DATA_KEYS` 扩 natural*（逐键 number/上限 100000/finite 正整数>0）+同值 no-op 返 `written:true`；**allowlist 仅 natural\* 键时按 node.type 校验**（group/text/audio/multiImage/videoEdit 拒；storyboard 格子 imageGen 允许）——落点 `applyWriteNodeDataToDoc` typed reason；校验链=validateWriteBatch **表驱动 Record<DocWriteOpType,Validator>**（unknown[] 无 switch 窄化）+applyOp switch+never 维持+manifest.test 显式同步；probe 分流（图片同步 sharp 流式/视频异步 probe 队列）+EXIF/rotation 守卫+Media.metadata 落值；**8 类产物绑定矩阵**（C0a 产出——producer/绑定形态/探测法/写入键/失败回落）。

### 3.2 三分类写者+禁写门（Z5''/Z11''）

单写者三分类表（§0.1 Z5'' v4——component load 只更新本地预览禁写 doc）；**工厂写默认 wh+`data.aspectRatio` 初始值**（首拟合缺口修复）；**`data.sizeMode:'auto'|'author'` 标记**（resize 置 author/显式适应内容置 auto——「作者 resize 后禁自动 fit」执行前提）；D4 按类型策略表（视频 bootstrap 已有 wh 一律零写）；**`currentWH` 从 doc 记录读**（非 cs——投影滞后非确定值防）；`applyIntrinsicFit` owner=store 级单点（去重/同值零写/readOnly 跳过）；`SERVER_ONLY_DATA_KEYS` patch 入口过滤（保留 existing 非 delete）+新建节点走 addNode 工厂 data 域+上传替换走 `updateNodeMediaFact`（全链定义：intent 变体+apply/project/diff+受信路径校验）；`ImageNodeData/VideoNodeData` 类型声明。

### 3.3 只读命令边界+resync 分流（Z6''）

命令入口 gate（canvasStore addNode/deleteNode/onNodesChange 按变更类型分表〔select 放行〕/onEdgesChange/onConnect+nodeStore 命令/投影机制分离+useGroupKeyboard 全键含 undo/redo+deleteKeyCode 置空+**cascadeDeleteVideoProject gate 前置**）；库层 SyncStatus(false) 实证（unsyncedChanges>0 信号）+write-rejected 合并节流+payload 白名单；**resync=重连/重放/丢弃三路（v4——forceSync 只发 SyncStep1 不重发本地被拒 update〔provider.cjs:756 实证〕：重发须完整重连握手；viewer 不自动 discard 只置 terminal+显式导出/放弃）**；闩锁全保留；测试断言=零 local-origin update+本地命令零写（远端投影照常）+VIEWER 键盘矩阵+降级中拖拽不提交+冻结→解冻**完整重连** resync 收敛。

### 3.4 创建默认与兜底（Z8''）

工厂类型感知（组不写 wh 0 帧键/storyboard 子写网格 wh/audio·videoEdit 片内定）；`fallbackSize` 单函数+reason 标签+去重计数；happy-path=0。

### 3.5 删除面（收窄）

删 dispatchFixtureSizeIntents+RF dimensions 首测固化链+measured 类型注记（split 兜底改创建默认）；reportNodeSize 收口三分类（§0.1 Z5''）；grep 全零+台账核销。

## 4. 片序与执行门（C0a→C0b→A1-A3→B1-B3；每片出口=用户确认点）

| 片 | 内容 | 出口判据 |
|----|------|----------|
| **C0a（spike）** | 8 类产物绑定矩阵一手核验+probe 可行性（图片同步/视频异步分流+EXIF/rotation fixture）+**10k rebalance 编码字节实测**（2k/5k/10k——预算非前提） | 矩阵+实测数据落盘 |
| **C0b（服务端事实写）** | natural* 逐键表+同值 no-op+allowlist（落 applyWriteNodeDataToDoc）+校验链表驱动收口+E8 断言先红+禁写门 | E8 逐类绿+先红证据留档 |
| **A1（doc 契约）** | **版本双 bump 3+reset runbook（六步含 spool）**+三型分裂+DOC_NODE_KEYS 三处接线+validateNodeRecord+applyKeySetTable 保序+ProjectedCanvasNode 禁 as+`doc-shape-invalid` reason 档 | adversarial 仍绿+tsc 挡构造+旧 csv/schema/IDB 三用例 |
| **A2（序域主线）** | 分数索引+orderRecords 层序+三面收编（含保序非排序处理）+ensureParentOrder 中间态策略+工厂/命令级 allocator+父变更 census+NodeEnvelopePatch.order+装载期 rebalance 四钉 | 层序三面同序+10k 实测预算内+docDelta 不增+REST 预装载后首 WS 重排一次 |
| **A3（harness）** | apps/web node config+期望序五件套+参考模型+真连三条 | 红相→绿+seed 复现 |
| **B1（只读收口）** | 命令 gates+变更类型分表+cascade 前置+nodeStore 机制分离+undo 门细化+write-rejected 节流+resync 分流+**闩锁保留**+enterDocInvalid catch 层 | VIEWER 矩阵零 local-origin update+resync 分流各路径用例+catch 层注毒用例（缺 order 不白屏） |
| **B2（删除面+写者补齐）** | 删测量链/measured 注记+工厂类型感知（aspectRatio 初始值+组 0 帧键）+三分类写者+applyIntrinsicFit 单点+multiImage/upload/error/resize 替代写者+fallbackSize | 删除面 grep 全零+首拟合用例（16:9 默认→1:1 媒体即 fit）+auto 组 0 帧键+兜底稳态 0 |
| **B3（终出口）** | verify 28 步×2+CI 四 job+部署窗（reset 六步执行前单独确认；07b6c436 同车兑现） | 全绿+旧标签页版本终态强刷实证 |

## 5. 验收判据与先红门禁清单（G1-G16）

| # | 门禁 | 先红判据 | 绿判据 |
|---|------|----------|--------|
| G1 | order 写侧显式拒绝 | 写边界缺 order=业务错误码红 | validateNodeRecord 五处全绿 |
| G2 | 读侧全函数+catch 层 | 注毒缺 order：**投影确定性落位渲染+`doc_integrity_invalid_total{stage}` +1 不白屏**（v4 修正——total-ordered 主路径即绿，非依赖 catch；terminal 只留结构性不可恢复）+无 catch 时注毒即炸（先红） | 确定性落位+计数+catch 层只接 shape 错误 |
| G3 | 期望序 | Map 插入序≠order 时读出口=插入序（真红）+store 数组序断言（invariant 补） | 层序三面同序 |
| G4 | 字母表/边界 | 注入乱序字母表红 | 严格递增+前缀/等值/头插/property 绿 |
| G5 | rebalance 四钉 | docDelta 计入红相（origin 未排除时）+REST 预装载不重排红相 | 不触发 freeze+首 WS 恰一次+实测预算内+pendingStructs 跳过 |
| G6 | E8 probe | C0b 断言先红 | 8 类逐项绿+EXIF/rotation fixture 绿 |
| G7 | 三分支拟合 | 首拟合缺口红相（无 aspectRatio 初始值时新节点永不 fit） | 三用例+双端同 fact 同 wh+视频 bootstrap 零写 |
| G8 | 只读命令矩阵 | 收口前红（回弹+undo 无门） | 零 local-origin update+select 放行+级联前置+投影不误拦 |
| G9 | 创建默认 | 现状红（image/video 无默认） | 兜底稳态 0+首拟合+auto 组 0 帧键 |
| G10 | 校验链表驱动 | **人为删一个 validator/case**（红相——第七 op 已砍禁引用） | 删即编译红（表驱动+never 自证） |
| G11 | 版本门 | bump 前旧 csv 放行红 | 旧 csv 拒连+旧 schema 拒载+fillDoc order 域通过+IDB 不命中 |
| G12 | 收敛 harness | 期望序红相+参考模型 | 五件套绿 |
| **G13** | 三型编译门 | `as` 残留红（结构测试+tsc） | 全链零 as |
| **G14** | repair-doc-order | 制造坏 order doc→terminal | 离线修复后装载通过+审计输出 |
| **G15**（v4 新） | natural* 键级跳过 | 现实现整 op 拒红相：`{fileId, natural*: 非法}` 同 patch→fileId 丢+written:false | fileId 落+skippedKeys 计数+written:true+不退款 |
| **G16**（v4 新） | 检测→隔离→修复 | 注入坏 order 远端 update：**禁断言「服务端拒收帧」**（observer 丢不了——机制不可实现） | doc quarantined+terminal 广播+导出可用+repair 后恢复 |

## 6. 非目标与移交

| 项 | 归属 |
|----|------|
| z 序 UI 命令（bringToFront 等） | 后续 UI 批（本批只保证创建/粘贴/复制/父变更序确定性） |
| 闩锁删除 | Y1c-1 后按证据再裁 |
| SCHEMA=4/generation/CanvasDocSnapshot/拆键/Y.Text | Y1c（本批 Z9'' 勘正回填 master） |
| reconcile 删除 | Y3 |
| v2→v3 兼容 | 无（reset runbook 六步） |
| 运行期客户端 rebalance | 永不做 |
| cellCount | 不做（零读者） |
| 第七 op | 不做；未来须语义 op（writeNodeMediaSize 读改写） |

## 7. 纪律与观察项

- v1/v2 共四处核验错误留痕（头部修订链）——「进 spec 断言先实证」三重教训（Glob 漏段/语义未读源码即概括/自相矛盾 G10）。
- harness 真连用例 provider destroy 走 scripts/lib/provider-late-reconnect-guard；纯内存部分不涉。
- 观察项：B15 心跳 FIFO（不触发）；collab.gateway.spec 满载 flaky（二连命中转根修）。
- manifest 矩阵扩+缩对称（natural* 入服务端 data 域行；measured 注记出）。

