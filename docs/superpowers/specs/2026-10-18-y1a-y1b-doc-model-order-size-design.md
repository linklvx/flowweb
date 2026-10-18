<!-- doc-status: active -->
# Y1a+Y1b：doc 模型 v3·序与尺寸/只读（B 类合并批设计）

- **立项日**：2026-10-18；**唯一上游依据**：[2026-10-06-canvas-yjs-arch-upgrade-review.md](2026-10-06-canvas-yjs-arch-upgrade-review.md)（master spec v8.3）§0.2 Y1a/Y1b 两行+§0.1 裁决（含 **D5/D4/E68/C7③——v1 漏检三条已冻结裁决，v2 修正**）。
- **B 类合并立项**（Y1a+Y1b——E6 序域与 C5↔D4 同批硬约束〔删 RF 布局测量链与服务端固有尺寸写同批〕共用）；plan=`../plans/2026-10-18-y1a-y1b-doc-model-order-size.md`（writing-plans 产出）。
- **用户立项三澄清（2026-10-18 一轮）**：①单 spec 单 plan+多段片序（每片出口=用户确认点）；②Y1a 收敛 harness=内存双端为基底（v2 修订：须含期望序断言+真连集成用例，见 Z8'）；③UI 变更面=零（VIEWER 拒写视觉沿用现有只读横幅体系；如深化发现需新视觉再单触发 ui-ux-pro-max）。
- **v2 修订记录（2026-10-18 二轮·三份外审逐钉核验后）**：
  - **v1 五条 Z 裁决废止**（经核验违反 master 已冻结裁决）：Z1（writeNodeEnvelope 第七 op——废止：固有尺寸归 data 层与 fileId 同 op 同事务，零新 op）；Z2 读侧 throw（违反 E68 读侧全函数铁律）；Z3 全局 order+id 排序（违反 D5「order 仅同 parentId 层内生效+层序遍历」）；Z4④ 运行期条件全量 rebalance（违反 D5「rebalance 仅会话开始一次」且撞 2×maxTxBytes 帧闸）；Z5 固有尺寸总是覆盖（违反 D4「doc 已有 wh 首写者胜」且 Yjs 冲突胜者≠墙钟 LWW）；Z6 闩锁核销（undo/redo 无 canEdit 门+服务端 readOnly 静默丢帧——闩锁是分叉唯一检测器，须保留）；Z8 text auto 高度（违反 D4「text=持久化作者尺寸」）。
  - **v1 基线两处核验错误勘正**：①`execution.gateway.ts` 存在于 [apps/api/src/modules/gateway/execution.gateway.ts:116](../../../apps/api/src/modules/gateway/execution.gateway.ts)（`emitStitchStatus` 带 width/height/cellCount；separate/trim 事件无尺寸）——v1 断言「文件不存在」错误（Glob 漏 `gateway/` 段）；②`reportNodeSize` 7 调用点=**内容事件拟合/错误兜底/resize 中途卸载提交/派生布局**（[contentEventSize](../../../packages/shared/src/canvas/geometry.ts:301) 输入 naturalW/H 三分支），**非 DOM 测量**——C5 真删除对象=`dispatchFixtureSizeIntents`+RF `dimensions` 首测固化链。
  - **用户二轮裁决（2026-10-18）**：固有尺寸载体=**data 层 naturalWidth/naturalHeight+contentEventSize 三分支**（「首写者胜」字面维持）；第七 op 本批不做；cellCount 零读者不做；probeArtifacts 不加 natural*（非产物存在性判据）。

## 0.1 本批有效裁决（master 内联+本批 Z' 系）

| 编号 | 裁决 | 对本批的效力 |
|------|------|--------------|
| **D5** | **C6 修订：分层 order**——order 仅同 parentId 层内生效；投影数组序=层序遍历（父先子后）+同层 (order,id) 排序；**不设跨层全局序**；Origin 枚举加第 5 常量 `Maintenance`；**rebalance 仅会话开始一次**（运行期重写 order 与 undo 反演冲突）；`ensureParentOrder` 冻结为「仅 RF 父先子后契约，**禁承担 z 序**」+断言 | §2 全域——v2 核心修正（v1 Z3/Z4④ 违反本条） |
| **D4** | **C5 修订：尺寸缺口分档**——上传=服务端元数据命令写（confirmUpload 已持对象）；生成=落地时补一次解码写元数据；**视频=受控一次性 bootstrap**（doc 已有 wh 零写**首写者胜**/独立 origin 不入撤销栈/量化幂等）；维度缺失=合法态+DEFAULT_CHILD_SIZE 兜底；text 节点=**持久化作者尺寸**+盒内滚动/裁剪禁 DOM 高度回写；measured 仅影响节点内部视觉，禁入帧派生 | §3 全域——v2 核心修正（v1 Z5/Z8 违反本条） |
| **E68** | 不变量登记表+铁律：**读侧全函数**（任意 doc 投影出可渲染结果绝不抛）/写侧**显式拒绝**（业务错误码，禁丢帧禁静默跳过）/**禁修复写回 doc**（[canvas-invariants.ts:33-35](../../../packages/shared/src/canvas/canvas-invariants.ts) 三行原文在案；adversarial-readers.spec 直接断言不抛） | §2 读 profile 双轨+§3 尺寸守卫（v1 Z2 违反本条） |
| **C7①③** | 版本/世代三件套——客户端版本协商拒旧+「**排空切换 runbook（停写→drain→reset→部署→强刷）进 Y1（第一个弄脏 doc 的批次）**」 | §6 版本门——order 键即「弄脏 doc」，本批承担 bump+reset |
| C5/C6/C5↔D4/D13/E6/E8/E15 | （同 v1 内联——宽高三源/序分层/同批硬约束/门禁先红/order 键长上限/元数据可取性前置/收敛 harness） | §2/§3 |
| **Z1'（二轮裁决）** | **服务端写事实不写布局**：`SERVER_NODE_DATA_KEYS` 扩 `naturalWidth/naturalHeight`（`valueTypes` 改**逐键显式表**——natural*=number，禁沿用 `Object.fromEntries(... ['string'])`；校验 finite/正整数/>0/≤上限如 16384；**同值 no-op**——Yjs `Y.Map.set` 无同值短路，worker 重试持续建 item=doc 膨胀）；与 `fileId/resultUrl` **同一 writeNodeData op/同 writeBatch 事务**（天然原子，零新 op）；**服务端类型 allowlist**=仅 image/video/imageExt 类产物节点（group/text/storyboard 子节点拒绝）；`cellCount` 零读者本批不做；`probeArtifacts` **不加** natural*（它是产物存在性探针非布局参数） | §3.1 |
| **Z2'** | **读侧全函数+写侧/装载门执法**：`readRecordsFromMaps` 保持 total（order 有则带、无则 undefined；不抛——adversarial 不变量维持）；新增**严格读边界**=`readOrderedRecords`（缺/非法 order throw——仅装载门/投影入口调用一次，非渲染热路径）+服务端 `loadDocument` shape 校验（失败=terminal `doc-shape-invalid`，非静默非 throw 穿透）；写侧（fillDoc/applyRecordToYMap/applyIntentToDoc）缺 order **显式拒绝**（业务错误码）；`validateNodeRecord`（shared 单源：order=string 非空 ASCII **≤128 硬上限**〔32=服务端重排触发阈值非校验线——32-128 区间合法待装载期重排，与 Z4' 两线分明〕；wh finite>0≤上限；parentId string）客户端命令/服务端 op/fillDoc/装载门/测试五处共用 | §2.1 |
| **Z3'** | **D5 分层 order 直译**：读出口=**层序遍历 DFS**（根按 (order,id)→父先子后→子层再 (order,id)；孤儿/环按根处理——复用 ensureParentOrder 环守卫语义）；`ensureParentOrder` 冻结为**断言**（输入已层序⇒恒等返回原引用；「仅 RF 父先子后契约，禁承担 z 序」注释+断言收编）；**三份拓扑排序收编 shared 单函数**（nodeOrder.ts/renderCanvas Pass2/snapshot-filter.ensureParentFirst——三个渲染面〔主画布/公开页/clone〕必须同序）；**order 载体=doc 记录**（`DocNodeRecord.order` 必填+`DOC_NODE_KEYS`；`NODE_ENVELOPE_KEYS` 不动——信封通用键不含媒体专属/序细节，view/copy 面 order 可选）；**`applyKeySetTable` 必须保留 order 键**（有则带——否则 stripAuthorState/种子路径静默丢序） | §2.2/§2.3 |
| **Z4'** | **rebalance=装载期服务端**（D5「仅会话开始一次」直译）：客户端**零重排**；服务端 `loadDocument` replay 后、对外服务前——per-parent 扫描超阈值层（键长>32）单事务重分配（`Origin.Maintenance` 常量新增，不入 UndoManager；此时 undo 栈未挂载天然无反演冲突；WS 装载〔socketId 存在〕才做，REST/direct 读路径禁写）；生成器键长允许超 32 硬上限 128（客户端不因长度失败——耗尽返回 typed `OrderKeyExhausted`，命令拒绝+提示刷新，非异常控制流）；「双端各自触发亦收敛」断言废止——并发重排不存在（装载期单实例租约+load 幂等） | §2.4 |
| **Z5'** | **尺寸覆盖语义=D4 三分支字面维持**（[contentEventSize](../../../packages/shared/src/canvas/geometry.ts:301) 现役）：`data.natural*`=服务端事实（**最新产物覆盖**，regenerate 亦覆盖——natural 是事实非布局）；`width/height`=作者/命令体（ratio 未变**沿用作者 wh**=D4 首写者胜；ratio 变才 contain-fit）；**单触发点 `applyIntrinsicFit`**：监听 fileId/natural* 变化→纯函数 contentEventSize→写 envelope wh+`data.aspectRatio`（同值零写、`Origin.Geometry` 不入 undo、**禁 ResizeObserver 触发**）；已知取舍（登记接受）：仅 VIEWER 在线时新产物 frame 先按旧比例 letterbox，EDITOR 打开才 contain-fit——比服务端覆盖作者 resize 安全 | §3.2 |
| **Z6'** | **闩锁保留+undo 门+resync**：`canvasDiverged`/boot-diverged/导出·放弃出边**全保留**（它是服务端 readOnly 静默丢帧〔guardSyncFrame return+计数〕分叉的唯一检测器+数据恢复路径，非假防御）；**`undoCanvas/redoCanvas` 补 canEdit 门**（readOnly 下 toast+计数+零本地 update——origin=UndoManager 也是本地 update）；服务端补 `write-rejected` stateless 通告（readOnly 丢帧非纯静默）；readOnly 解除/重连时若拒绝计数>0 → 强制 resync（重握手重发被拒 update）；闩锁删除移出本批（挂 Y1c-1 后按「发布周期 diverged=0+全写点门测试」证据再裁） | §3.3 |
| **Z7'** | **E8 验收锚=产物 probe→doc natural***：值从产物实体元探测（**图片 EXIF orientation 5-8 交换/视频 side_data rotation 交换**——`media-process.service` 现只取 width/height 无 rotation，probe 须补）；禁从请求参数回填；禁用 DOM 渲染实测当 oracle（非确定输入）；`Media.metadata` 落 probe 值（后续读方单一服务端事实源）；上传链路=`confirmUpload` probe 返回 `{width,height}`，客户端绑定媒体时**同一命令体**写 natural*+frame（不持久化依赖 DOM）；六类产物绑定矩阵=片 C0a 产出（producer/绑定形态/探测方法/写入键/失败回落逐类列表，禁「等」字） | §3.1 |
| **Z8'** | **创建默认+兜底单函数**：`addNodeInner` 创建默认 wh（text 300×300 作者尺寸〔D4〕/image·video 按 ratio/multiImage 按 multiImageSize/videoEdit 320）——每节点从创建起有 doc wh，消灭 DEFAULT_CHILD_SIZE 常态兜底；`fallbackSize(node, reason)` **shared 单函数**，全部 `?? DEFAULT_CHILD_SIZE` 消费点（实测 8+ 处：renderCanvas:63/:75、assertions:131、canvasCollabRuntime:1031、canvasStore:1390/:1966/:2008/:2029/:2132/:2278——片内一手再核）同源计数进 metric 带 reason；happy-path 断言=0（text 不豁免——有作者 wh） | §3.4 |
| **Z9'（新）** | **版本双 bump+reset runbook**（C7③「Y1=第一个弄脏 doc 的批次」直译）：`CANVAS_DOC_SCHEMA_VERSION` 2→3+`CLIENT_PROTOCOL_VERSION` 2→3（A1 片首任务——先 bump 后动 doc）；本地缓存键含 schemaVersion 自动分库（旧 IDB 自然失效）；seed/clone/gate-canvas-state 补 order 并盖章 3；部署窗=服务端+客户端同批+开发/测试库 truncate CanvasDoc/CanvasDocUpdate（reset runbook 进 plan）；**Y1c-1 的 SCHEMA_VERSION=3 职责改为 4**（master 目录表 Y1c 行同步勘正——plan 期回填）；旧标签页走版本终态强刷禁续写；**零迁移**（不做 v2→v3 兼容分支） | §6 |
| **Z10'（新）** | **校验链收口**：`validateWriteBatch` if 链改 **`switch (op.op)`+`never` 穷尽**（新 op 忘校验分支=编译红——v1「Record 穷尽即 tsc 红」过度承诺废止：Record 只保证表有条目）；`applyOp` default 改 `never` 穷尽断言（现 default=运行时 throw）；`canvas-doc-manifest.test.ts:164` 六 op 硬编码 expected 数组**显式同步**（非自动矩阵）；manifest 服务端 data 域 writers/readers 行随 natural* 扩 | §3.1 |
| **Z11'（新）** | **客户端服务端事实键禁写门**：`SERVER_ONLY_DATA_KEYS=['naturalWidth','naturalHeight']`——`applyIntentToDoc(updateNodeData)` 跳过+`updateConfig` 全量回写过滤（客户端命令禁写服务端事实键；上传路径不持久化 natural*——confirmUpload 返回值走命令体一次性写入）；data 层无 `NODE_ENVELOPE_KEYS` 级编译锚→`ImageNodeData/VideoNodeData` 补 `naturalWidth?: number/naturalHeight?: number` 类型声明+manifest/fixture 矩阵显式覆盖 | §3.2 |
| **Z12'（新）** | **创建路径 census+工厂**：节点创建**全部**走单一工厂（生成 id+分配 order+创建默认 wh+构造 DocNodeRecord）——路径清单（片 A2 一手 census 定稿）：addNode/addChildNode/addChildNodes/addNodeWithEdge/addNodeAndBatchConnect/duplicateNodes/pasteGroupClipboard/mergeStoryboard/splitImageNode/createDerivedExtNode/dropImageIntoStoryboard/视频导出/素材库插入/AI 标注·改图·trim·separate 结果插入/seed/clone/gate——**禁各 action 自拼 intent**；`buildCopyPlan` 接受 newOrder 分配器（副本新键置顶层，**禁继承源 order**——副本同键=靠 id tie-break 随机穿插）；`diffProjectionToIntents` 比较含 order；`assignSeedOrder`（按输入数组序均匀分配）服务种子/导入 | §2.5 |
| **Z13'（新）** | **harness 修订**：断言=**期望序**非重言式双端相等——①构造 Map 插入序与业务 order 相反的 doc 断言读出口=order 序（真红相）②真实 `applyDocToStore`/层序投影断言 store 数组序（含本地 add 后=doc 序）③`deriveRenderCanvas` 公开页同层序④双端并发插入/删除/重排 vs **参考模型**（模型基准：每 parent 期望序列——两端可以一起错，模型不能）⑤并发同位插入 id tie-break；seed+clientIDs+update transcript 进失败输出；**环境**：apps/web vitest 文件级 node 环境仍跑 jsdom setupFiles（test-setup 用 window）→shared 投影纯函数+**shared 加 yjs devDependency**（运行时零依赖不变——devDep 仅测试）或独立 vitest config，片 A3 定载体；真连集成用例（帧闸 1009/旧 csv 拒连/降权）归 heavy/e2e 域一条 | §2.6 |

## 0.4 偏离登记表（滚动——实现与设计的差异单源）

> 纪律：实现与本文任何差异必须在本表登记（偏离号递增+commit 锚）；「进 spec 断言一律先实证」。v1→v2 修订本身=设计期外审收敛（非实现偏离），登记于头部 v2 修订记录。

| # | 偏离 | 落地形态与依据 |
|---|------|----------------|
| — | （空——v2 起点） | — |

## 1. 基线快照 v2（2026-10-18 二轮一手核验；行号=master c96fecc1）

### 1.1 序域与投影链

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [nodeOrder.ts:17](../../../apps/web/src/utils/nodeOrder.ts) `ensureParentOrder` | 按原顺序拓扑输出（父先子后；环=visiting 跳过不抛）；[applyDocToStore:1301](../../../apps/web/src/stores/canvasCollabRuntime.ts) 消费——**读出口若做全局排序会被它再打乱一次** | D5/Z3'：冻结为断言 |
| [docShape.ts:138-166](../../../packages/shared/src/canvas/docShape.ts) `readRecordsFromMaps` | 裸 `[...entries()]` 迭代序出口（键可选三层表） | Z2'：保持 total；严格读=新函数 |
| [docShape.ts:264-292](../../../packages/shared/src/canvas/docShape.ts) `applyKeySetTable` | 逐键显式构造 `{id,type,data}`+条件 position/parentId/wh——**不在表内键静默丢弃**（stripAuthorState/toDocRecords 出口） | Z3'：order 键必须保留 |
| [nodeEnvelope.ts:19](../../../packages/shared/src/canvas/nodeEnvelope.ts) `NODE_ENVELOPE_KEYS` | 双向编译锚（satisfies+Exclude）；`CanvasNodeRecord` 无 order；[projectCanvasNodes:29-37](../../../apps/web/src/utils/projectCanvasNodes.ts) 末尾 `as CanvasNodeRecord` 强转**绕过编译检查** | Z3'：order 载体=doc 记录非信封 |
| [copyPlan.ts:53-101](../../../packages/shared/src/canvas/copyPlan.ts) | 复制逐字段构造，**不重分配序** | Z12'：副本新键禁继承 |
| [canvasIntents.ts:245-263](../../../apps/web/src/stores/canvasIntents.ts) `projectIntentToStore` addNode | `[...s.nodes, 新节点]` append——本地乐观序≠doc 序 | Z13'：投影断言覆盖 |
| [arrangeSelection.ts:79](../../../packages/shared/src/canvas/arrangeSelection.ts)/[geometry.ts:68](../../../packages/shared/src/canvas/geometry.ts) | 落格/拼接空间序（canvasStore:1969/:2005/:2512/:2579 四消费点） | 仅补 id tie-break（v1 同裁维持） |

### 1.2 尺寸域（v1 勘正+扩面）

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [geometry.ts:301-322](../../../packages/shared/src/canvas/geometry.ts) `contentEventSize` | 三分支纯函数（输入 naturalW/H+currentWH+bounds：沿用档/比例变 contain-fit/冷启动） | Z5'：策略单源维持 |
| reportNodeSize 7 调用点（ImageGen:270/:285/:703+VideoGen:279/:292/:560+MultiImage:122） | **v1 勘正**：内容事件拟合（naturalW→fit）/错误 ratio 兜底/resize 中途卸载提交/multiImageSize 派生——**非 DOM 测量**；真测量链=`dispatchFixtureSizeIntents`（canvasIntents:374+canvasStore:1575/:1579/:1640，RF dimensions 首测仅 textInput） | C5 删除对象=dispatchFixtureSizeIntents 链 |
| [docShape.ts:324](../../../packages/shared/src/canvas/docShape.ts) `measured?:` | MinimalCSNode 类型注记（非 doc 白名单——assertions:20 白名单实为 hidden/selected/dragging） | 删除面=类型注记+split 兜底改 |
| [canvasStore.ts:778-781](../../../apps/web/src/stores/canvasStore.ts) addNodeInner | text 固定 300×300（与 D4「持久化作者尺寸」一致——v1 Z8 text auto 废止） | Z8'：创建默认扩展全类型 |
| DEFAULT_CHILD_SIZE 兜底 | 实测 8+ 消费点（renderCanvas:63/:75+assertions:131+canvasCollabRuntime:1031+canvasStore:1390/:1966/:2008/:2029/:2132/:2278） | Z8'：单函数全站点计数 |
| [media-process.service:93-135](../../../apps/api/src/modules/media-process/media-process.service.ts) | 只取 width/height——**图片无 probe/视频无 rotation** | Z7'：EXIF/rotation 补 |

### 1.3 只读域（v1 扩面——「四写点」低估勘正）

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [canvasUndo.ts:67-105](../../../apps/web/src/stores/canvasUndo.ts) | undo/redo **无 canEdit 门**（只查栈/预算）——readOnly 期 Ctrl+Z 产生 origin=UndoManager 本地 update | Z6'：补门（第五写点） |
| [nodeStore.ts:524-560](../../../apps/web/src/stores/nodeStore.ts) | addNode/updateNodeData/deleteNode 等多写方法无 canEdit | Z6'：命令入口 gate（**非投影 sink**——nodeStore 同时被投影使用，盲加门会拦远端投影） |
| [canvasStore.ts:1648](../../../apps/web/src/stores/canvasStore.ts) onNodesChange | 无条件 `applyNodeChanges`（VIEWER Delete 键路径）+`:1699` onEdgesChange 同 | Z6'：命令入口矩阵收口 |
| [collab-doc-registry.service.ts:706-746](../../../apps/api/src/modules/collab/collab-doc-registry.service.ts) guardSyncFrame | 帧闸 `Update>2×maxTxBytes(512KB)→1009`；readOnly=**静默 return+计数**（丢帧不回执） | Z4'（帧闸否决运行期全量 rebalance）+Z6'（write-rejected 通告） |
| [canvasStore.ts:230-234](../../../apps/web/src/stores/canvasStore.ts) diverged 闩锁 | 裁定 23⑨ 三出边（导出/放弃/服务端接受）+boot-diverged 持久恢复路径（canvasCollabRuntime:1720-1733） | Z6'：**保留**（v1 Z6 核销废止） |

### 1.4 服务端写面与产物绑定矩阵（v1 勘正）

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [execution.gateway.ts:116-126](../../../apps/api/src/modules/gateway/execution.gateway.ts) | **v1 勘正**：`emitStitchStatus` 带 width/height/cellCount；`emitSeparateStatus`(:105-113)/trim 事件**无尺寸** | Z7'/C0a 矩阵输入 |
| 六类产物绑定形态（C0a 一手核验定稿） | AI 生图/改图/光照=**已有节点**+服务端已写 data（resultUrl/fileId）；stitch/trim/separate=**客户端新建节点**（useStitchTask:25/VideoGen:160-207——服务端不知道 nodeId，事件载荷 stitch 带尺寸 trim/separate 无）；素材上传=客户端新建+confirmUpload 只 statSize 无 probe | Z1'/Z7'：新建节点走事件载荷+命令体；已有节点走服务端 data op |
| [canvas-doc-manifest.ts:199](../../../packages/shared/src/canvas/canvas-doc-manifest.ts) | `writeNodeData` valueTypes=`Object.fromEntries(...['string'])` 全 string | Z1'：逐键表（natural*=number） |
| [canvas-doc-manifest.ts:358-368](../../../packages/shared/src/canvas/canvas-doc-manifest.ts) validateWriteBatch | **if 链非穷尽 switch**——新 op 不进 patch 校验分支 | Z10'：switch+never |
| [collab-doc-writer.service.ts:181](../../../apps/api/src/modules/collab/collab-doc-writer.service.ts) applyOp | default=**运行时 throw**（六 case 之外） | Z10'：never 穷尽 |
| [canvas-doc-manifest.test.ts:164-176](../../../packages/shared/src/canvas/canvas-doc-manifest.test.ts) | 「六 op 全分类」expected 硬编码数组 | Z10'：显式同步（非自动矩阵） |

### 1.5 版本面

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [docShape.ts:41](../../../packages/shared/src/canvas/docShape.ts) | `CANVAS_DOC_SCHEMA_VERSION=2`（注释「Y1c bump」——**执行序倒置**，本批先弄脏 doc 须先 bump） | Z9' |
| [collab-protocol.ts:8](../../../packages/shared/src/constants/collab-protocol.ts) | `CLIENT_PROTOCOL_VERSION=2` | Z9'：双 bump |
| [local-cache-key.ts:24-33](../../../apps/web/src/collab/local-cache-key.ts) | 缓存键含 schemaVersion——bump 即旧 IDB 自然失效 | Z9' |
| project.service seed/gate-canvas-state | `stripAuthorState(nodes)+fillDoc` 无 order | Z12'/Z9'：assignSeedOrder+盖章 3 |

## 2. Y1a 序域设计（D5 分层直译）

### 2.1 order 键与双读 profile（Z2'/Z3'）

- **载体**：`DocNodeRecord.order: string` 必填+`DOC_NODE_KEYS=[...NODE_ENVELOPE_KEYS,'order']`（manifest/fillDoc 域）；`NODE_ENVELOPE_KEYS` **不动**（信封通用键不含序细节——view/copy 面经 `OrderedDocNodeRecord=DocNodeRecord&{order:string}` 严格形态，cs Node 附加 order 投影往返）。
- **双读 profile**：`readRecordsFromMaps`（total——order 有则带无则 undefined，adversarial 不变量维持）+`readOrderedRecords`（严格——缺/非法 throw，仅装载门/投影入口一次调用；非法含非 string/空串/charset 外/超 128）。`validateNodeRecord` 五处共用（客户端命令/服务端 op/fillDoc/装载门/测试）。
- **投影链保序**：`applyKeySetTable` 保留 order；`projectCanvasNodes` 删 `as` 强转改显式构造；cs Node 携带 order 投影往返（applyDocToStore 投影/`toDocRecords` 带回/ensureParentOrder·applyNodeChanges·duplicate 不丢字段）。

### 2.2 分数索引（自实现，钉四边界+两函数）

- 两函数（shared `fractional-index.ts`）：`generateOrderKeyBetween(prev,next)` 返回 `{ok:true,key}|{ok:false,reason:'no-space'|'too-long'|'invalid-range'}`（**typed 结果非异常控制流**——调用方决定拒绝命令）；`compareOrderKeys` 原生 `<`。
- 字符集=base32 `0-9A-V`（**断言字母表数组严格递增无重复**——非「字符码差 1」：`'9'→'A'` 码差 8）；**生成键不得以最小字符结尾**不变量（防 `between("a","a0")` 前缀无解）；头尾虚拟边界锚+首键中位前缀预留；**等值键** `between(a,a)` 定义返回（a 靠 id tie-break 或 a+mid——单测定死）；纯函数（无随机——并发同位 midpoint 同值用例成立前提）。
- 键长：阈值 32（E6）/硬上限 128——客户端不因长度失败，超阈置标志上报；**耗尽=服务端装载期重排兜底**（Z4'）。
- 单测：字母表严格递增/前缀对（a vs ab 比较+a vs a0 无解两型）/邻接对/等值/头插 1000 次严格 between+增长曲线/property 随机 10k 插入。

### 2.3 读出口层序与三排序收编（Z3'）

- `readOrderedRecords` 出口=**pre-order 层序 DFS**（每层 (order,id)；孤儿/环=根处理复用环守卫）；`orderRecords` 收编 shared 单函数，三个渲染面（applyDocToStore 主画布/renderCanvas 公开页/snapshot-filter clone）**同序消费**；`ensureParentOrder` 降为断言（输入已层序⇒恒等返回原引用——防「静默改写」）。
- 本地结构命令（add/delete/parentId 变更/duplicate/paste）dispatch 后按 doc pre-order 重排 store 数组；**position 空间移动不重排**（拖拽≠z 序——UI 变更面零）。

### 2.4 装载期服务端 rebalance（Z4'）

- 服务端 `loadDocument` replay 后、对外服务前：per-parent 扫键长>32 的层→单事务均匀重分配（固定宽度 base32+中位前缀+大间隔，新键 ≪32）；`Origin.Maintenance`（Origin 枚举第 5 常量）；仅 WS 装载做（REST/direct 读路径禁写）；undo 栈未挂载窗口=无反演冲突。
- 断言：1 万节点重排 update 字节 < 2×maxTxBytes（512KB 帧闸）；两客户端并发装载单次重排（单实例租约+load 幂等）；重排后客户端首帧投影与重排前**相对序一致**。

### 2.5 创建路径 census+工厂（Z12'）

单一节点创建工厂（id+order+创建默认 wh+DocNodeRecord 构造）——全路径走它（清单 §0.1 Z12'，片 A2 census 定稿+grep 锚）；`buildCopyPlan` 接受 newOrder 分配器；`diffProjectionToIntents` 比较 order；`assignSeedOrder` 服务 seed/clone/gate。

### 2.6 收敛 harness（Z13'）

断言=期望序五件套（§0.1 Z13'：反向插入序红相/真实投影 store 序/公开页同层序/参考模型基准/并发同位 tie-break）；seed+clientIDs+失败输出；载体=shared 投影纯函数+shared yjs devDep 或独立 config（片 A3 定——jsdom setupFiles 实证约束）；真连集成（帧闸/旧 csv/降权）归 heavy/e2e 一条。

## 3. Y1b 尺寸/只读域设计

### 3.1 服务端固有尺寸写（Z1'/Z10'）

- `SERVER_NODE_DATA_KEYS` 扩 `naturalWidth/naturalHeight`；`valueTypes` 逐键表（number）+值域（finite/正整数/>0/≤16384）+**同值 no-op**（防 worker 重试膨胀——`applyWriteNodeDataToDoc` 现役直 set 无短路，本批一并补 writeNodeData 同值守卫）；服务端类型 allowlist（image/video/imageExt 产物节点——group/text/storyboard 子节点拒绝，reason 词表进 `collabWriteRejectedTotal`）。
- 与 fileId/resultUrl 同 op 同 writeBatch 事务（原子——产物引用与固有尺寸同现）；**客户端新建节点**（stitch/trim/separate 结果）：服务端事件载荷补尺寸（stitch 现有 wh 复用；trim/separate 事件补 probe 值）→客户端建点命令体一并写——服务端不写未知 nodeId。
- `confirmUpload` probe（EXIF orientation 5-8 交换/视频 side_data rotation 交换）返回 `{width,height}`+落 `Media.metadata`；**probeArtifacts 不动**（存在性探针语义）。
- 校验链收口（Z10'）：switch+never 两处+manifest.test 显式同步+服务端 data 域 writers/readers 行扩。

### 3.2 三分支拟合与事实键禁写（Z5'/Z11'）

- `applyIntrinsicFit` 单触发点（监听 fileId/natural* 变化→contentEventSize→写 envelope wh+data.aspectRatio，同值零写、Origin.Geometry 不入 undo）；输入改 `data.natural*`（DOM naturalWidth 只影响本地预览禁写 doc）。
- `SERVER_ONLY_DATA_KEYS` 客户端禁写门（applyIntentToDoc 跳过+updateConfig 回写过滤）；`ImageNodeData/VideoNodeData` 补类型声明。
- natural* 只对单产物节点定义（multiImage 按各图+multiImageSize 派生——由 doc 状态触发禁 ResizeObserver）。

### 3.3 只读命令边界+闩锁保留（Z6'）

- **命令入口 gate**（非投影 sink）：canvasStore addNode/deleteNode/onNodesChange（select 类放行）/onEdgesChange/onConnect+nodeStore 命令路径+useGroupKeyboard 全键（group/merge/ungroup/remove/**undo/redo**）+CanvasView deleteKeyCode（!editable 置空）+`cascadeDeleteVideoProject` 仅删除被接受后调用——readOnly 下 cs/ns/doc **三零写**+拒绝计数。
- 服务端 `write-rejected` stateless 通告（丢帧非纯静默）+readOnly 解除时计数>0→强制 resync；**闩锁/boot-diverged/导出·放弃全保留**（diverged=canary 计数）。
- 测试：VIEWER 键盘矩阵（add/delete/edge/drag 松手不提交/undo/redo/paste/duplicate/drop）+EDITOR→VIEWER 降级中拖拽+配额冻结→解冻 resync 收敛；断言=**零 local-origin update**（非「零 transact」——远端 apply 也 transact）。

### 3.4 创建默认与兜底单函数（Z8'）

`addNodeInner` 创建默认 wh 全类型；`fallbackSize(node,reason)` 单函数收编 8+ 消费点+metric 带 reason；happy-path=0（text 有作者 wh 不豁免）。

### 3.5 删除面（收窄）

删 `dispatchFixtureSizeIntents`+RF dimensions 首测固化链+`measured` 类型注记（splitImageNode measured 兜底改创建默认）；**保留** reportNodeSize 调用链但语义收口为两入口（`commitIntrinsicFit`=applyIntrinsicFit 触发面/`commitAuthorSize`=resize 提交面——改名收口片内定）；grep 面全零（dispatchFixtureSizeIntents/measured）+台账核销。

## 4. 片序与执行门（v2 修订——C0a→C0b→A1-A3→B1-B3；每片出口=用户确认点）

| 片 | 内容 | 出口判据 |
|----|------|----------|
| **C0a（spike·契约修正）** | 六类产物绑定矩阵一手核验（producer/绑定形态/探测方法/写入键/失败回落逐类）+probe 可取性证伪（EXIF orientation/视频 rotation fixture——`media-process.service` 现状不含）+stitch/trim/separate 事件载荷核验；writeNodeData 逐键 valueTypes/同值守卫先行 | 矩阵落盘（禁「等」字）+不可得项回落方案（客户端命令体非 DOM） |
| **C0b（服务端事实写）** | `SERVER_NODE_DATA_KEYS` 扩 natural*+逐键表+值域/类型 allowlist/同值 no-op+校验链收口（switch+never 两处+manifest.test 同步）+**E8 断言先红**（服务端写未落）+客户端禁写门（SERVER_ONLY_DATA_KEYS）+confirmUpload probe 返回 | E8 六类逐项绿（值=实体 probe）+先红证据留档 |
| **A1（doc 契约）** | **版本双 bump 3（首任务）**+reset runbook+`DocNodeRecord.order`/`DOC_NODE_KEYS`/双读 profile/`validateNodeRecord`+applyKeySetTable 保序+projectCanvasNodes 去 cast+cs 往返 | adversarial 不变量仍绿+装载门用例+旧 csv/schema 拒连拒载用例先红后绿 |
| **A2（序域主线）** | 分数索引两函数（四边界单测）+`orderRecords` 层序 DFS+三排序收编+ensureParentOrder 降断言+创建工厂+路径 census+assignSeedOrder/copyPlan 新键+装载期服务端 rebalance | 层序三面同序断言+10k 节点重排<512KB+创建路径 grep 锚全走工厂 |
| **A3（harness）** | Z13' 五件套断言+参考模型+seed 复现+载体定稿（shared yjs devDep 或独立 config） | 期望序红相（先红）→绿；并发同位插入绿 |
| **B1（只读收口）** | 命令入口 gates（含 undo/redo/Delete 键/onNodesChange/onEdgesChange）+write-rejected 通告+resync+**闩锁保留** | VIEWER 键盘矩阵零 local-origin update+降级中拖拽不提交+冻结→解冻 resync 收敛 |
| **B2（删除面+写者补齐）** | 删 dispatchFixtureSizeIntents/RF dimensions/measured 注记+创建默认 wh 全类型+applyIntrinsicFit 单触发+multiImage/upload/error/resize 替代写者+fallbackSize 单函数全站点 | 删除面 grep 全零+multiImage 展开/增删图 doc wh 正确+兜底稳态 0 |
| **B3（终出口）** | verify 全链 28 步×2 轮+CI 四 job+部署窗（版本双 bump 同窗服务端+客户端+开发库 truncate；TD-28/R5' 修复 07b6c436 同车兑现） | 全绿+旧标签页版本终态强刷实证 |

- **执行门**：本批无单向门；truncate 开发库=片 B3 部署窗动作（停写→drain→reset→部署→强刷——C7③ runbook 直译，执行前单独确认）。
- **master 目录表回填义务**：Y1c 行 SCHEMA_VERSION=3→4 勘正（本批 Z9'）——plan 期回填 master spec §0.2。

## 5. 验收判据与先红门禁清单（v2 重排——G1-G12）

| # | 门禁 | 先红判据 | 绿判据 |
|---|------|----------|--------|
| G1 | order 写侧显式拒绝 | 写边界缺 order=业务错误码红（fixture 未补时） | 五处共用 validateNodeRecord 全绿 |
| G2 | 读侧全函数 | adversarial 套件**不许红**（现存不变量维持）——严格读 throw 仅装载门，红相=装载门拒绝坏 doc 用例 | total 读零抛+装载门 terminal 拒 |
| G3 | 期望序（真红） | Map 插入序≠order 时读出口=插入序（**先红**）→层序 DFS 绿 | 层序三面（主画布/公开页/clone）同序 |
| G4 | 字母表/边界 | 无效红相=人为注入乱序字母表 | 严格递增+前缀对/等值/头插 1000 次/10k property 绿 |
| G5 | rebalance 装载期 | （无运行期重排——红相=帧闸用例：注入>512KB update 收 1009） | 10k 重排<512KB+并发装载单次+相对序一致 |
| G6 | E8 产物 probe | C0b 断言先写即红 | 六类逐项绿+EXIF/rotation fixture 绿+Media.metadata 落值 |
| G7 | 三分支拟合 | ratio 未变沿用作者 wh 断言（v1 Z5 覆盖语义红相对照） | 沿用/contain-fit/冷启动三用例+双端同 fact 同 wh |
| G8 | 只读命令矩阵 | 收口前红（现状回弹+undo 无门） | VIEWER 全键盘零 local-origin update+三零写+拒绝计数+resync |
| G9 | 创建默认 | DEFAULT_CHILD_SIZE 兜底先红（现状无创建默认） | 兜底稳态 0（全站点单函数计数） |
| G10 | 校验链 | 第七 op 场景红相=人为漏校验分支（switch+never 编译红自证） | switch+never 落地后该红不可复现（编译级） |
| G11 | 版本门 | bump 前旧 csv 拒连用例红（现状放行） | 旧 csv 拒连+旧 schema 拒载+旧 IDB 不命中 |
| G12 | 收敛 harness | 期望序红相（G3 同源）+参考模型 | 五件套全绿+seed 复现 |

## 6. 非目标与移交

| 项 | 归属 | 依据 |
|----|------|------|
| z 序 UI 命令（bringToFront/sendToBack/reorderNode） | 后续 UI 需求批 | 本批只保证创建/粘贴/复制/父变更序确定性（UI 变更面零） |
| 闩锁删除 | Y1c-1 后按证据再裁 | Z6'（保留） |
| SCHEMA/generation/CanvasDocSnapshot/positionX-Y 拆键/Y.Text/E26 | Y1c（SCHEMA_VERSION 职责改 **4**——Z9' 勘正回填 master） | master §0.2 |
| reconcile 仲裁层删除 | Y3（三门全绿前置） | C1 闭环条件本批深化 |
| v2→v3 兼容/迁移 | **无**（reset runbook） | 无存量纪律 |
| 运行期客户端 rebalance | **永不做** | Z4'（帧闸+undo 反演） |
| cellCount | 不做（零读者）——消费方出现时按「事实 vs 派生」定归属 | Z1' |
| 第七 op writeNodeEnvelope | 本批不做；未来若需「服务端直落有效 wh」须语义 op（writeNodeMediaSize 读改写）非裸 patch | Z1'（用户二轮裁决） |

## 7. 纪律与观察项

- v1 两处核验错误（execution.gateway 路径/reportNodeSize 分类）已入头部修订记录——**「进 spec 断言一律先实证」**双重教训（本轮我方 Glob 路径漏段+调用点语义未读源码即概括）。
- harness 真连用例涉及 provider——**destroy 走 scripts/lib/provider-late-reconnect-guard 约定自本批真连面恢复生效**（TD-28/R5' 批立）；纯内存部分不涉。
- 观察项带入：B15 心跳 FIFO（无大帧链路不触发）；collab.gateway.spec 满载 flaky（verify 二连命中同用例转根修）。
- manifest 矩阵扩+缩对称（natural* 入服务端 data 域；measured 类型注记出）——双侧同批。


