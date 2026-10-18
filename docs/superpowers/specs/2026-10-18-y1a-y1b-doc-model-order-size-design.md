<!-- doc-status: active -->
# Y1a+Y1b：doc 模型 v3·序与尺寸/只读（B 类合并批设计）

- **立项日**：2026-10-18；**唯一上游依据**：[2026-10-06-canvas-yjs-arch-upgrade-review.md](2026-10-06-canvas-yjs-arch-upgrade-review.md)（master spec v8.3）§0.2 Y1a/Y1b 两行+§0.1 裁决（D5/D4/E68/C7③）。
- **B 类合并立项**（Y1a+Y1b——E6 序域与 C5↔D4 同批硬约束共用）；plan=`../plans/2026-10-18-y1a-y1b-doc-model-order-size.md`（writing-plans 产出）。
- **用户立项三澄清（2026-10-18 一轮）**：①单 spec 单 plan+多段片序（每片出口=用户确认点）；②收敛 harness=内存双端基底+期望序断言+真连集成；③UI 变更面=零（VIEWER 拒写视觉沿用现有只读横幅体系）。
- **修订链**：
  - **v2（二轮）**：v1 五条 Z 裁决废止（Z1 第七 op/Z2 读侧 throw/Z3 全局排序/Z4④ 运行期 rebalance/Z5 总是覆盖/Z6 闩锁核销/Z8 text auto——违反 D5/D4/E68）；v1 两处基线核验错误勘正（execution.gateway.ts 实存 modules/gateway/〔:116-126 emitStitchStatus 带 wh/cellCount〕；reportNodeSize 7 调用点=内容事件拟合非 DOM 测量〔contentEventSize naturalW/H 三分支〕——C5 真删除对象=dispatchFixtureSizeIntents 链）；用户二轮裁决：固有尺寸=data 层 natural*+contentEventSize 三分支+零新 op。
  - **v3（三轮·三份 v2 外审逐钉核验后，载荷性主张全部实证）**：**v2 两处自相矛盾修正**——①严格读「仅装载门/投影入口一次」的「投影入口」=热路径（applyDocToStore 三调用点 :1870/:1906/onRemote 50ms timer 均无 catch——throw 即白屏/卡水合，E68 修正只完成一半）；②G10 引用已砍的第七 op。**类型三句话不能同时成立**（DocNodeRecord.order 必填 vs total 读 undefined vs cs 往返+NODE_ENVELOPE_KEYS 锚不动）→三型分裂。**裁决间分歧裁定**：cs Node 携带 order（采完整闭环——diffProjectionToIntents 是 group/ungroup/paste 实际写路径，cs 不携带则父变更 order 无 diff 面无写 intent）。**新实证**：hocuspocus 库层 readOnly 发 `SyncStatus(false)`（server.cjs:295-313）——「静默丢帧」表述修正，客户端 unsyncedChanges>0 即现有信号；loadDocument replay spool（:393-395）——reset 漏 spool 即旧 v2 帧回灌；onUpdateDelta 只排除 SERVER_TRANSACT_ORIGIN（:295）——Maintenance origin 会计进 docDelta 触发 freeze。

## 0.1 本批有效裁决（master 内联+本批 Z'' 系）

| 编号 | 裁决 | 效力 |
|------|------|------|
| **D5** | order 仅同 parentId 层内生效；投影数组序=层序遍历（父先子后）+同层 (order,id)；不设跨层全局序；Origin 枚举加第 5 常量 Maintenance；rebalance 仅会话开始一次；ensureParentOrder 冻结「仅 RF 父先子后契约，禁承担 z 序」 | §2 |
| **D4** | 上传=服务端元数据命令写；生成=落地补一次解码写；**视频=受控一次性 bootstrap（doc 已有 wh 零写首写者胜**/独立 origin 不入撤销栈/量化幂等）；维度缺失=合法态+DEFAULT_CHILD_SIZE 兜底；text=持久化作者尺寸；measured 仅节点内部视觉禁入帧派生 | §3 |
| **E68** | 读侧全函数（绝不抛）/写侧显式拒绝（业务错误码）/禁修复写回 doc（[canvas-invariants.ts:33-35](../../../packages/shared/src/canvas/canvas-invariants.ts)；adversarial-readers.spec 断言不抛） | §2/§3 |
| **C7①③** | 版本协商拒旧+「排空切换 runbook 进 Y1（第一个弄脏 doc 的批次）」 | §6 |
| C5/C6/C5↔D4/D13/E6/E8/E15 | 宽高三源/序分层/同批硬约束/门禁先红/键长上限/元数据可取性前置/收敛 harness | §2/§3 |
| **Z1''** | **服务端写事实不写布局**：`SERVER_NODE_DATA_KEYS` 扩 `naturalWidth/naturalHeight`（valueTypes 逐键表 number；**上限 100000**〔16384 太低——2 万像素全景合法；且 natural* 超限会连带 fileId 同 op 整条拒=产物丢失〕；校验 finite/正整数/>0）；与 fileId/resultUrl 同 op 同事务；**类型 allowlist=仅 patch 含 natural\* 时校验节点类型**（按 **node.type** 拒 group/text/audio/multiImage/videoEdit；**storyboard 格子里的 imageGen 允许**——那是 natural* 正消费者；落点=`applyWriteNodeDataToDoc`〔validateWriteBatch 无 doc〕返回 typed reason 进 collabWriteRejectedTotal）；**同值 no-op 返回 `written:true`**（Z44 交付判据——false=误判退款）；cellCount 零读者不做；probeArtifacts 不加 natural* | §3.1 |
| **Z2''** | **类型三分裂+严格读正确落点**：`DocNodeRecord.order?: string`（作者投影——total 读出口）+`OrderedDocNodeRecord=DocNodeRecord&{order:string}`（严格——fillDoc/applyRecordToYMap/applyIntentToDoc 只收此型）+cs `ProjectedCanvasNode=CanvasNodeRecord&{order?:string}`（NODE_ENVELOPE_KEYS 锚**不动**）；`readOrderedRecords` 做 Raw→Ordered 窄化（校验 `/^[0-9A-V]{1,128}$/`〔非泛 ASCII——防 ~/Unicode 破坏 between 前缀假设〕），**全链禁 `as`**；**严格读落点=装载门（loadDocument shape 校验→terminal `doc-shape-invalid`）+种子门（project.service/gate）+写侧——绝不落 applyDocToStore 热路径**；`readCanvas` **双出口分流**：total 档（计费 execution:167/探针 :259/REST :24/write port :51）+`readCanvasOrdered`（公开快照/clone/render 面）；**客户端 catch 层**：applyDocToStore 三调用点（:1870/:1906/onRemote timer）包 try/catch→`enterDocInvalid()` 终态（停 observer/remoteApplyTimer+terminal banner+`doc_integrity_invalid_total{stage}` 计数+导出出口——复用 SyncBanner 终态零新视觉）；**运行期信任边界**=服务端事务级 order 校验（doc update observer 检查本事务变更节点 order 合法性——Yjs wire 是真边界，客户端类型不设防）+离线 `scripts/repair-doc-order` 维护命令（按层重分配+审计——terminal 的修复路径非读侧兜底） | §2.1 |
| **Z3''** | **D5 层序+接线闭合**：读出口=pre-order 层序 DFS（孤儿/环=根处理——环内先访问者按 (order,id) 定序**三面固定同一语义**）；**DOC_NODE_KEYS 三处接线**（`DOC_WRITE_OPS.fillDoc.keys=[...DOC_NODE_KEYS,...DOC_EDGE_RECORD_KEYS]`/validateWriteBatch fillDoc 分支改 DOC_NODE_KEYS+required order 校验/`DOC_KEY_MANIFEST.nodes[0].path`——漏接=服务端 seed/clone 带 order 整批 UNKNOWN_KEY 拒）；**renderCanvas Pass2/snapshot-filter.ensureParentFirst 是「保序+父先子后」非排序**——须喂 readOrderedRecords 输出或 `RawNode` 加 order 内排（三选一片 A2 定）；`ensureParentOrder` **中间态策略**：`setWithParentOrder`（groupNodes/ungroup/move 命令中间 set）保留拓扑整理（只保证父在子前不承诺 z 序）+`assertLayerOrder` 仅挂 dispatch 后/doc 投影后收口点（中间命令态误炸合法命令=禁）；snapshot-filter `RawNode` 加 order+公开载荷白名单显式收录（防无意泄漏/丢失）；`checkProjectionInvariant` 补「store 数组 id 序==doc 层序」断言（现按 id 排序比较对序盲） | §2.2/§2.3 |
| **Z4''** | **装载期 rebalance 四钉闭合**：①**origin 记账**——服务端重排事务用 `SERVER_TRANSACT_ORIGIN`（或 Maintenance 入 `onUpdateDelta` 排除表〔现只排除 server :295〕+shared 常量——**禁**让重排字节计进 docDelta 触发 freeze）；重排后 **docTruth 补账**（新增 update 字节入 cheap 或强制 `encodeStateAsUpdate` 重测）；②**完整性门**——`pendingStructs/pendingDs !== null`（degraded 态）跳过重排记 `rebalance_skipped{reason='pending-structs'}`；③**首连窗口**——loadDocument 仅首次装载：direct/REST 先驻留的 doc 须 `needsRebalance` 标记+**首个 WS connected/beforeSync 执行一次**（REST/direct 读路径仍禁写）；④**预算与分块**——512KB 帧闸是**入站**（装载期服务端写不经它；真预算=SS2 8MB 闸+持久化行+出站）——10k 节点重排字节=C0a **实测预算**（先测 2k/5k/10k encode 字节，禁当设计前提）；按 parent 分块（~1000 键/事务 ≤128KB）+只重排键长>32 的层（非全量） | §2.4 |
| **Z5''** | **三分类写者+首拟合闭合**：单写者表——`commitIntrinsicFit`（natural*/fileId 变化→contentEventSize→wh+aspectRatio，Geometry）/`commitAuthorSize`（resize 松手/卸载，LocalUser）/`commitLayoutSize`（multiImage 展开/增删图/错误 fallback，Geometry）；**component `<img>/<video>` load 只更新本地预览禁写 doc**（v2「保留 reportNodeSize 调用链」收口为三分类——双写者禁）；**首拟合缺口修复**（实证：contentEventSize ratioChanged 需 existingAspectRatio≠null，工厂只写 wh 不写 aspectRatio⇒新节点永不 fit——代码「类型谎言」注释自证）→**工厂创建默认 wh 同时写 `data.aspectRatio` 初始值**；**D4 按类型策略表**：上传/图片生成=已有 wh 且比例未变零写/比例变 contain-fit；**视频 bootstrap=已有 wh 一律零写只更新 natural*/aspectRatio**（D4 四硬约束字面）；作者 resize 后禁自动 fit（除显式「适应内容」）；`applyIntrinsicFit` owner=store 级 applyDocToStore 之后单点（lastAppliedNatural 去重+同值零写+readOnly 跳过+group/multiImage 跳过——非组件 effect〔离屏不 fit〕非 doc observer 回环） | §3.2 |
| **Z6''** | **readOnly 机制实证修正+resync 分流**：丢帧非静默（库层 `SyncStatus(false)`→provider unsyncedChanges 保持>0——**利用现有信号**：hasUnsyncedChanges+thaw 后 `provider.forceSync()`；`write-rejected` stateless 仅 app 层补充+**按连接合并节流**〔100ms-1s 窗口累计 count+reason，纳入出站预算〕+客户端 payload 白名单〔doc-status/conn-status 同型域〕）；**resync 按 reason 分流**（viewer=本地未确认编辑不可恢复→discardLocalDiverged+服务端重载；quota/drain/spool=冻结解除后 forceSync 重发待 `synced∧unsyncedChanges===0` 超时转 diverged；角色升权=先确认角色再重发；schema/doc-shape=终态禁重放）；**onNodesChange 按变更类型分表**（select 放行〔VIEWER 可选中查看〕/remove·position·dimensions·edges 拒——「cs 零写」修正为「零 collaborative 写」）+`cascadeDeleteVideoProject` **gate 前置**（remove 先拒禁级联删）；nodeStore **命令/投影机制分离**（投影 sink 不 gate〔盲加会拦远端投影〕——`applyProjectionNode`/origin:'projection' 参数或命令面收口 canvasStore）；undo 门细化（redo precheck 前先 canEdit/键盘 Ctrl+Z 统一入口/cancelNodeProcess 仅 undo 成功后）；断言=**零 local-origin update**（非零 transact——远端 apply 也 transact）+**本地命令引起的零写**（远端投影照常） | §3.3 |
| **Z7''** | E8 锚=产物 probe→doc natural*（EXIF orientation 5-8 交换/视频 side_data rotation 交换——media-process 现状不含）；`confirmUpload` **probe 分流**：图片 sharp 流式同步（上限/超时）；**视频 ffprobe 异步**（MinIO 对象需下载/临时文件秒级——confirmUpload 入 probe 队列返回 `{width:null,height:null,probe:'pending'}`，客户端先用创建默认，probe 完成 Media.metadata+doc natural* 更新）；`Media.metadata` 落 probe 值；**「六类」勘正为 8 类**（AI 生图/改图/光照/stitch/trim/separate/上传/text——C0a 按实际 writeNodeData/建点路径枚举禁「等」字） | §3.1 |
| **Z8''** | **工厂类型感知**：text/image/video/imageExt/multiImage 写默认 wh+**data.aspectRatio 初始值**；**auto/storyboard 组不写 wh**（0 帧键——键集表 applyKeySetTable 见 wh 即判 manual=帧派生全乱）；storyboard 子节点写 wh（网格单元）；audio/videoEdit 补默认（videoEdit 320×180 或显式合法无 wh 档——片 B2 定）；`fallbackSize(node,reason)` 单函数收编 8+ 消费点+metric 带 reason+**按 nodeId+reason+会话去重**（热渲染重复计数刷爆防）；happy-path=0（text 有作者 wh 不豁免） | §3.4 |
| **Z9''** | 版本双 bump 3（A1 首任务）+**reset runbook 六步**（①停写+drain ②**清 spool/quarantine**〔实证 loadDocument :393 replay——漏清即旧 v2 帧回灌〕③truncate CanvasDoc/CanvasDocUpdate ④清 Redis 相关键/停进程清内存 doc ⑤部署 api+web 同窗 ⑥IDB 键自然失效确认+seed/gate 重生成 v3）+**`doc-shape-invalid` reason 档**（shared CollabAuthReason 新增+客户端 terminal 处理〔现折 permission-denied/db-unavailable 分型错误〕+shapeRefusal 透传同 schemaRefusal 形态）；Y1c SCHEMA 职责改 4（master 目录表回填） | §6 |
| **Z10''** | **校验链收口（v2 Z10' 半程修正）**：`validateWriteBatch` 入参 `readonly unknown[]`——**switch+never 不成立**（op.op 是 unknown 无窄化）→**`Record<DocWriteOpType,Validator>` 表驱动**（新增 op 缺 validator=编译红）；`applyOp` 入参 DocWriteOp 联合——switch+never 维持成立；manifest.test 六 op 硬编码数组显式同步；G10 红相改「人为删一个 validator/case」（第七 op 已砍禁引用） | §3.1 |
| **Z11''** | **禁写门与写入路径矛盾修复**：`SERVER_ONLY_DATA_KEYS` 禁写门=`updateNodeData`/`updateConfig` 的 **patch 入口过滤**（剔客户端传入的 natural* 键；merged 输出保留 existing 的 natural*——**非 delete**）+`applyIntentToDoc(updateNodeData)` 对 natural* skip；**客户端新建节点**（stitch/trim/separate 结果）natural* 走 **addNode 工厂 data 域**（工厂允许初始值——addNode 不在禁写门辖下）；**上传替换已有节点**=显式 `updateNodeMediaFact` intent（带来源标记走校验）或 addNode 通道——禁「命令体一次性写入」无载体说法；`ImageNodeData/VideoNodeData` 补 natural* 类型声明 | §3.2 |
| **Z12''** | **创建+父变更/重排全路径 census**（v2 漏父变更）：创建路径（addNode/addChildNode/addChildNodes/addNodeWithEdge/addNodeAndBatchConnect/duplicateNodes/pasteGroupClipboard/mergeStoryboard/splitImageNode/createDerivedExtNode/dropImageIntoStoryboard/视频导出/素材库/AI 标注·改图·trim·separate 结果/seed/clone/gate）+**父变更/重排路径**（groupNodes/ungroup/addToGroup/dropIntoGroup/attachMember/removeNodeFromGroup/addImageToStoryboardCell/convertGroup——换 parent 必重分配 order，旧键属另一兄弟集）；**命令级 allocator**（先按目标父层分组顺序分配——禁每 action 自读 doc）+`buildNodeBase`（纯构造）+`allocateOrder(doc,parentId,anchor)`（dispatch 事务内）拆分；`NodeEnvelopePatch` 加 `order?:string`+`applyIntentToDoc(updateNodeEnvelope)` 写 order+`diffProjectionToIntents` 比较含 order（**cs 携带 order 裁定**——无此则父变更 order 无 diff 面）；`buildCopyPlan` 副本**子节点按新父层分配**（非仅置顶层）+`chunkCopyPlan` 整 plan 分配后切块（后块置顶反序防）；`assignSeedOrder` 按 parent 分组输入序均匀分配 | §2.5 |
| **Z13''** | harness 载体=**apps/web**（shared 零 yjs import 边界维持——不加 devDep）+独立 `vitest.node.config` 或 environmentMatchGlobs（jsdom setupFiles 用 window 实证约束）；期望序五件套+参考模型+seed/clientIDs/transcript 失败输出；**真连用例三条**（旧 csv 拒连版本终态/降权 viewer 本地 update 被拒+write-rejected+零 store·doc 写/服务端 natural* 同事务双端读一致——归 heavy/e2e） | §2.6 |

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
- **严格读落点**：装载门（`loadDocument` shape 校验→terminal `doc-shape-invalid`〔CollabAuthReason 新档+shapeRefusal 透传〕）+种子门+写侧（validateNodeRecord 五处共用）。**投影热路径恒走 total**；`applyDocToStore` 三调用点包 try/catch→`enterDocInvalid()`（停 observer/remoteApplyTimer+terminal banner+`doc_integrity_invalid_total{stage}`+导出出口——复用 SyncBanner 零新视觉）。
- **readCanvas 双出口**：`readCanvas`（total——计费/探针/REST/write port）+`readCanvasOrdered`（严格——公开快照/clone/渲染面）。
- **运行期信任边界**：服务端 doc update observer 事务级校验本事务变更节点 order（Yjs wire 是真边界——客户端类型不设防；违例=丢弃帧+`collab_doc_shape_violation_total`）+离线 `scripts/repair-doc-order`（terminal 修复路径）。

### 2.2 分数索引（四边界+两函数）

`generateOrderKeyBetween` 返回 typed `{ok}|{ok:false,reason}`（非异常控制流）；字符集 base32 断言**数组严格递增**（非字符码差 1——`'9'→'A'` 差 8）；生成键**不得以最小字符结尾**不变量（防前缀无解）；头尾虚拟边界+首键中位前缀；等值键 `between(a,a)` 定死；纯函数；阈值 32/硬上限 128（客户端不因长度失败——超阈置标志，耗尽=typed `OrderKeyExhausted` 命令拒绝）。单测：严格递增/前缀对（a vs ab+a vs a0 无解）/等值/邻接/头插 1000 次/property 10k。

### 2.3 层序读出口与三面收编（Z3''）

- `orderRecords`（shared）=pre-order 层序 DFS（每层 (order,id)；孤儿/环=根处理——**环内先访问者 (order,id) 定序三面固定同一语义**）。
- **DOC_NODE_KEYS 三处接线**（fillDoc.keys/validateWriteBatch fillDoc+required/manifest path）——漏接=服务端 seed/clone 整批 UNKNOWN_KEY。
- **renderCanvas Pass2/snapshot-filter.ensureParentFirst=保序非排序**：输入须 pre-order（或 RawNode 加 order 内排——片 A2 定）；snapshot-filter `RawNode` 加 order+公开载荷白名单显式收录。
- **ensureParentOrder 中间态**：`setWithParentOrder` 保留拓扑整理（只保证父先子后）；`assertLayerOrder` 仅挂 dispatch 后/投影后收口点（中间命令态误炸=禁）；`applyDocToStore` 读层序后 ensureParentOrder 断言**引用恒等**（传新数组——内容相等不够，防静默改写）。
- `checkProjectionInvariant` 补「store 数组 id 序==doc 层序」断言。

### 2.4 装载期 rebalance（Z4''）

四钉（§0.1 Z4''）：origin=SERVER_TRANSACT_ORIGIN 或入 onUpdateDelta 排除表（重排字节禁入 docDelta）+docTruth 补账；pendingStructs/pendingDs 非空跳过+计数；needsRebalance 标记+首个 WS connected 执行（REST/direct 读禁写维持）；**预算=实测**（2k/5k/10k encode 字节——512KB 是入站帧闸不适用；真预算=SS2 8MB+持久化+出站）+按 parent 分块（~1000 键/事务 ≤128KB）+仅重排键长>32 的层。断言：重排后 docDelta 不增/不触发 freeze；REST 预装载后首 WS 重排恰一次；分块事务幂等；重排后首帧投影相对序一致。

### 2.5 创建+父变更全路径（Z12''）

工厂拆分（`buildNodeBase` 纯构造+`allocateOrder(doc,parentId,anchor)` 事务内）+**命令级 allocator**（多节点命令先按目标父层分组顺序分配）；`NodeEnvelopePatch.order?`+applyIntentToDoc 写 order+diff 比较含 order（cs 携带 order）；父变更/重排路径 census（§0.1 Z12'' 清单）；copyPlan 副本按新父层分配+chunkCopyPlan 整 plan 后切块；assignSeedOrder 按 parent 分组。

### 2.6 收敛 harness（Z13''）

载体=apps/web 独立 node config（shared 零 yjs 维持）；期望序五件套+参考模型（模型基准防两端一起错）+seed/clientIDs/transcript 失败输出；真连用例三条（旧 csv/降权 write-rejected+零写/服务端 natural* 同事务双端一致）归 heavy/e2e。

## 3. Y1b 尺寸/只读域设计

### 3.1 服务端固有尺寸写（Z1''/Z10''）

`SERVER_NODE_DATA_KEYS` 扩 natural*（逐键 number/上限 100000/finite 正整数>0）+同值 no-op 返 `written:true`；**allowlist 仅 natural\* 键时按 node.type 校验**（group/text/audio/multiImage/videoEdit 拒；storyboard 格子 imageGen 允许）——落点 `applyWriteNodeDataToDoc` typed reason；校验链=validateWriteBatch **表驱动 Record<DocWriteOpType,Validator>**（unknown[] 无 switch 窄化）+applyOp switch+never 维持+manifest.test 显式同步；probe 分流（图片同步 sharp 流式/视频异步 probe 队列）+EXIF/rotation 守卫+Media.metadata 落值；**8 类产物绑定矩阵**（C0a 产出——producer/绑定形态/探测法/写入键/失败回落）。

### 3.2 三分类写者+禁写门（Z5''/Z11''）

单写者三分类表（§0.1 Z5''——component load 只更新本地预览禁写 doc）；**工厂写默认 wh+`data.aspectRatio` 初始值**（首拟合缺口修复——实证 contentEventSize ratioChanged 前置）；D4 按类型策略表（视频 bootstrap 已有 wh 一律零写；上传/图片生成比例变 contain-fit；作者 resize 后禁自动 fit）；`applyIntrinsicFit` owner=store 级单点（去重/同值零写/readOnly 跳过）；`SERVER_ONLY_DATA_KEYS` patch 入口过滤（保留 existing 非 delete）+新建节点走 addNode 工厂 data 域+上传替换走显式 `updateNodeMediaFact` intent；`ImageNodeData/VideoNodeData` 类型声明。

### 3.3 只读命令边界+resync 分流（Z6''）

命令入口 gate（canvasStore addNode/deleteNode/onNodesChange 按变更类型分表〔select 放行〕/onEdgesChange/onConnect+nodeStore 命令/投影机制分离+useGroupKeyboard 全键含 undo/redo+deleteKeyCode 置空+**cascadeDeleteVideoProject gate 前置**）；库层 SyncStatus(false) 实证利用（hasUnsyncedChanges+thaw 后 forceSync）+write-rejected 合并节流+payload 白名单；**resync 按 reason 分流表**（§0.1 Z6''）；闩锁全保留；测试断言=零 local-origin update+本地命令零写（远端投影照常）+VIEWER 键盘矩阵+降级中拖拽不提交+冻结→解冻 resync 收敛。

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

## 5. 验收判据与先红门禁清单（G1-G14）

| # | 门禁 | 先红判据 | 绿判据 |
|---|------|----------|--------|
| G1 | order 写侧显式拒绝 | 写边界缺 order=业务错误码红 | validateNodeRecord 五处全绿 |
| G2 | 读侧全函数+catch 层 | 注毒缺 order：**投影不白屏/不卡水合/无 unhandled rejection**（v2 缺口——先红=无 catch 时注毒即炸） | enterDocInvalid terminal+可导出 |
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

