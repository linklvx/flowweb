<!-- doc-status: active -->
# Y1a+Y1b：doc 模型 v3·序与尺寸/只读（B 类合并批设计）

- **立项日**：2026-10-18；**唯一上游依据**：[2026-10-06-canvas-yjs-arch-upgrade-review.md](2026-10-06-canvas-yjs-arch-upgrade-review.md)（master spec v8.3）§0.2 Y1a/Y1b 两行+§0.1 裁决（E 系适用批次以 §0.2 行内引用为反向索引）。
- **B 类合并立项**（Y1a+Y1b——E6 序域与 C5↔D4 同批硬约束〔删 reportNodeSize 整链与服务端元数据写同批〕共用）；plan=`../plans/2026-10-18-y1a-y1b-doc-model-order-size.md`（writing-plans 产出）。
- **用户立项三澄清（2026-10-18）**：
  1. 单 spec 单 plan+**三段片序**（C0→A→B——执行序驱动，Y0c 片序 C0→A1→A2→D→E→B 非顺序先例；每片出口=用户确认点）；
  2. Y1a 收敛 harness=**内存双端 vitest**（N 个 Y.Doc+手动 applyUpdate 交换——纯 CRDT 层，无 provider/无 WS；TD-28/R5' 批立的 provider guard 约定对本 harness 不适用，因无 provider 参与）；
  3. **UI 变更面=零**（VIEWER 拒写视觉沿用现有只读横幅体系；如设计深化发现需新视觉，再单触发 ui-ux-pro-max 立项——本 spec 明示豁免）。
- **用户总裁定（2026-10-18）**：两域均按方案 A 走（B/C 弃定维持）；Y1b 服务端尺寸写走 `writeNodeEnvelope` 第七 op（P0——writeNodeData 键域不含信封层键）；Y1a 消费面分流勘正（P1——**=master spec §0.2 原文回归**：「sortNodesByPosition/sortForArrange id tie-break；readRecordsFromMaps 迭代序消费显式化（主画布 z 序由它决定）」——原文从未要求空间序函数改 order 主键，故无须裁定号豁免）；order 缺键 fail-closed（P0）；分数索引四钉/闩锁同批删/固有尺寸最后写胜（P1）；执行序=Y1b-P0 前置。

## 0.1 本批有效裁决（master spec 内联+本批新裁 Z 系）

| 编号 | 裁决 | 对本批的效力 |
|------|------|--------------|
| C5 | 宽高三源：测量值（DOM 上报）**一律不入 doc**；作者态=命令体写；媒体固有尺寸=服务端落地时元数据命令写（确定性输入两端一致） | Y1b §3 全域——删 reportNodeSize/dispatchFixtureSizeIntents 整链+measured 白名单族 |
| C6 | order 分层 fractional index | Y1a §2 |
| C5↔D4 | 同批硬约束：删测量链与服务端元数据写同批，否则图片/视频节点 doc 尺寸零写者 | 片 C0（服务端写）与片 B（删除面）同一 plan 内闭环 |
| D5 | fractional index 双理由（跨端迭代序实验分叉+RF v12 父先子后契约） | Y1a §2.2 |
| D13 | 门禁类任务先故意变红再落地，红因与门禁声明一致 | §5 先红门禁清单全员 |
| E6 | order 键长度上限 ≤32+超限触发 rebalance（maintenance origin）+断言 | §2.1/§2.2 |
| E8 | 上传/生成链路服务端可取 naturalWidth/视频元数据=前置；不可得则回落方案重议 | 片 C0 首任务一手核验（master spec 行号 execution.gateway.ts:106-118 已漂移——文件不存在，六类产物落地链重定向核验，见 §1 登记） |
| E15 | 收敛 harness：Node 无浏览器 N 客户端随机操列，双端渲染序逐位相等+扰动到达序仍收敛 | §2.4（Y0a 拆交的 E70 完整版本批兑现） |
| Z1（本批） | 服务端信封尺寸写=**新第七 op `writeNodeEnvelope{nodeId, patch:{width?,height?}}`**——键域纯（信封子集），与 writeExecStatus 并列同构（键级 set 幂等）；`cellCount` 属产物参数=data 层，扩 `SERVER_NODE_DATA_KEYS`；禁把信封键混进 writeNodeData 做双层语义 op；六类产物=data 写+envelope 写（如需）同 writeBatch 单事务（尺寸与产物引用原子同现，无中间态） | §3.1 |
| Z2（本批） | order=信封**必填期望键**：读侧（readRecordsFromMaps 排序）与写侧门面（normalizeCanvasRecord/toDocRecords）遇缺 order 一律 throw+专项计数；禁 `?? ''`/按 position 猜（缺键静默兜底=垫片入口）。测试 fixture 全量补 order 由 manifest 断言矩阵强制 | §2.1——与既有「键可选三层表」的关系=order 是唯一必填期望键（特例显式登记，其余信封键维持可选三层表语义） |
| Z3（本批） | 消费面分流：order 真消费面=渲染 z 序/读出口序（readRecordsFromMaps 出口 order+id 排序+web 投影 nodes 数组序同源）；sortForArrange（落格空间序）/sortNodesByPosition（拼接/组子网格空间序）**仅补 id tie-break**（现状无 tie-break，同坐标依赖输入序——分镜 cells 序确定性即此钉） | §2.3 |
| Z4（本批） | 分数索引四钉：①字符集=ASCII 递增连续段（0-9A-V base32 或 0-9A-F base16，禁 RFC 4648 字母表——2-7 段字典序≠数值序）；compare 用原生 `<`（禁 localeCompare）；「字典序≡数值序」进单测（相邻字符码差 1 全扫）②头尾插入用虚拟边界锚，between(null,first)/(last,null) 深度耗尽→键长>32→rebalance 兜底闭环，不允许生成失败路径③并发同位插入双端 midpoint 同值→order 相同→id tie-break 定序收敛（视觉次序随机=画布场景可接受）；harness 断言矩阵必须含并发同位插入用例④rebalance：触发=生成结果超 32 键长（条件触发非定期）；范围=全量重排（以当前收敛序 order+id 为基序均匀分配；区段重排边界兼容复杂度不值）；确定性+幂等（双端各自触发亦收敛——后到端键长复原条件自然不再满足）；maintenance origin 事务；均匀分配后键长必然 ≪32 天然防重入；单测覆盖前缀对（a vs ab）与邻接对 | §2.2 |
| Z5（本批） | 固有尺寸覆盖语义：产物 regenerate 时固有尺寸**总是覆盖**信封 wh（最后写胜）；作者随后手改=作者态写覆盖。禁「作者已手改则保留」分支（需尺寸来源标记元数据=新白名单面+复杂化，垫子） | §3.2 |
| Z6（本批） | diverged 闩锁（canvasStore.ts:230，裁定 23⑨）同批核销：四写点「先拒绝」后 readOnly 期间本地 update 触发面=零（留着=假防御面）。**核销以先红门禁为证据前提**（readOnly 下零 Y.Doc transact 断言全绿后才删——执行序「先门禁后删除」）；:797 addNode append 回弹/:849 deleteNode 回弹同批改先拒绝 | §3.3 |
| Z7（本批） | E8 验收锚取值：六类产物断言的 width/height/cellCount 值**从产物实体元探测**（文件探测/HTTP 头），禁从请求参数回填（防参数≠产物的漂移假绿） | §3.1 |
| Z8（本批） | DEFAULT_CHILD_SIZE 兜底：assertions.ts:131 与 renderCanvas.ts:63 两消费点同源计数进 metric；CI happy-path 用例断言兜底计数=0（防兜底常态化）；文本节点高度=渲染层 auto，doc 无 height 键=合法态（键可选三层表既有语义），不走兜底路径 | §3.5 |
| Z9（本批） | harness 断言口径：双向断言——(i) 收敛后双端 readRecordsFromMaps 出口 nodes 的 id 序列逐位相等；(ii) 同一 update 集合以不同到达序/分段到达，终态仍满足 (i)。随机操列 seed 固定且进失败输出（可复现） | §2.4 |

## 0.4 偏离登记表（滚动——实现与设计的差异单源）

> 纪律：实现与本文任何差异必须在本表登记（偏离号递增+commit 锚）；执行期裁定以代码仲裁为准（CI 修复批「照抄未验」教训——进 spec 断言一律先实证）。

| # | 偏离 | 落地形态与依据 |
|---|------|----------------|
| — | （空——立项起点） | — |

## 1. 基线快照（2026-10-18 一手核验；行号=master 07b6c436）

### 1.1 信封与序域

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [nodeEnvelope.ts:9-26](../../../packages/shared/src/canvas/nodeEnvelope.ts) | `CanvasNodeRecord`：id/type/parentId/width/height/position{x,y}/data——**无 order 键**；`NODE_ENVELOPE_KEYS` 双向编译锚（satisfies+Exclude 防漂移） | Z2/Z3：order 入信封正道（position 拆键 Y1c-2a 同款先例） |
| [docShape.ts:138-166](../../../packages/shared/src/canvas/docShape.ts) | `readRecordsFromMaps` 出口 nodes=裸 `[...nodes.entries()]` 迭代序（键可选三层表；null≡缺键） | Z3：读出口排序改造点 |
| [arrangeSelection.ts:79](../../../packages/shared/src/canvas/arrangeSelection.ts) | `sortForArrange`：y 分行（容差）+行内 x 升序——落格空间序 | Z3：仅补 id tie-break |
| [geometry.ts:68-71](../../../packages/shared/src/canvas/geometry.ts) | `sortNodesByPosition`：positionX/Y 升序——拼接/组子网格空间序 | Z3：仅补 id tie-break |
| canvasStore.ts:1969/:2005（sortForArrange 消费——排列落格）、:2512（拼接格序）、:2579（组子网格序） | 空间功能排序四消费点（一手核验 2026-10-18） | Z3：此四处语义不动 |

### 1.2 尺寸写面（Y1b）

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [canvasIntents.ts:224](../../../apps/web/src/stores/canvasIntents.ts)（reportNodeSize 定义）+ImageGenNode:270/:285/:703+VideoGenNode:279/:292/:560+MultiImageNode:122 | reportNodeSize **7 生产调用点**（DOM 测量上报→doc）——C5 裁决删除对象 | C5/D4：片 B 删除面 |
| canvasIntents.ts:374（dispatchFixtureSizeIntents 定义）+canvasStore.ts:1575/:1579（session∨resizePending 门）+:1640（固化调用） | 首测固化链（RF dimensions 批→doc） | C5/D4：片 B 删除面 |
| docShape.ts:324 `measured?:{width?,height?}`+assertions.ts:20-23 `CS_ONLY_DERIVED_DATA_KEYS` 注记 | measured 白名单族残面 | C5/D4：片 B 对称核销 |
| canvasStore.ts:786（addNode envelope 形参——显式 wh 优先于类型默认值，同 intent 单 transact） | 作者态尺寸=命令体写**现状已走** | C5 三源其一零改动 |
| assertions.ts:131（组 bounds `m.width ?? DEFAULT_CHILD_SIZE`）+renderCanvas.ts:63（rawRect 同式） | DEFAULT_CHILD_SIZE 两兜底消费点 | Z8：计数进 metric |

### 1.3 只读面（Y1b）

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| canvasStore.ts:315 区域（R2 新命令唯一入口 canEdit 门+单 undo 步） | runCommand 门在位 | Z6：写点收口基础 |
| canvasStore.ts:797（addNode append 回弹注释原文）/:848-849（deleteNode 回弹——store 侧 set 后回弹） | 「readOnly 先应用后回弹」语义 | Z6：改先拒绝 |
| canvasStore.ts:230-234 | diverged 闩锁（裁定 23⑨）三出边=导出 .yjs/放弃/服务端接受 | Z6：门禁证据后核销 |

### 1.4 服务端写面（Y1b-P0）

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| [canvas-doc-manifest.ts:83](../../../packages/shared/src/canvas/canvas-doc-manifest.ts) | `SERVER_NODE_DATA_KEYS=['fileId','resultUrl','videoUrl','content','result','errorCode']`——writeNodeData 键域=data 层 | **Z1 P0 依据**：width/height 是信封键，现 op 写不进（Z108 UNKNOWN_KEY 拒） |
| canvas-doc-manifest.ts:156-230 | DocWriteOp **六 op** 词汇+`DOC_WRITE_OPS: Record<DocWriteOpType,…>` 穷尽编译断言（:195「新增第七 op 忘分类即 tsc 红」——扩展点已预留） | Z1：writeNodeEnvelope 第七 op 落点 |
| canvas-doc-manifest.ts:223 | fillDoc 键域=`[...NODE_ENVELOPE_KEYS,...]`（种子专用、非幂等、T27 端点拒收）——**不可借用**为服务端增量信封写通道 | Z1：须新 op 而非复用 fillDoc |
| collab-doc-writer.service（Y0c 片 B 产物）+collab-document.service.writeNodeData/writeExecStatus | 服务端批量写面 writeBatch 在位（A1 T8/T27 端点） | Z1：第七 op 与 writeExecStatus 并列同构 |
| **E8 前置登记**：master spec 引 `execution.gateway.ts:106-118` **已不存在**（文件级漂移实证） | 六类产物落地链现状=execute→ai-download / stitch / trim / separate processor 各自 writeNodeData——**载荷是否可取 width/height/cellCount 属片 C0 首任务一手核验**（先红断言驱动，禁照抄行号） | E8/Z7 |

## 2. Y1a 序域设计

### 2.1 order 键（信封必填期望键——fail-closed）

- **载体**：`CanvasNodeRecord` 新增 `order: string`；`NODE_ENVELOPE_KEYS` 扩（双向编译锚自动跟随）；`DOC_KEY_MANIFEST.nodes[0]`（信封键域行）键清单+writers/readers 同批扩——manifest 派生断言矩阵自动覆盖。
- **必填期望键语义（Z2）**：order 是信封中唯一必填期望键（显式特例——其余信封键维持「键可选三层表」）。执法点两处：
  - 读侧：`readRecordsFromMaps` 出口排序前遇节点缺 `order` → **throw**+专项计数（如 `canvas_doc_order_missing_total`——指标名以 --write-metric-names 落盘惯例定稿）；
  - 写侧门面：`normalizeCanvasRecord`/`toDocRecords`（经 fillDoc/applyRecordToYMap/ydocBuilder 六写面）缺 order → **throw** 同计数。
  - 禁 `?? ''`/按 position 推断（垫片入口）。**零迁移纪律**：开发期无存量，不做缺键兼容/回填——测试 fixture 全量补 order 由 manifest 断言矩阵强制（矩阵红=fixture 未补齐）。
- **六写面同批扩**（fillDoc/applyRecordToYMap/normalizeCanvasRecord/toDocRecord/ydocBuilder+manifest 矩阵）：单事务写 order 与其余信封键同写（同 addNode envelope 形态——canvasStore.ts:786 先例）。

### 2.2 分数索引（自实现，四钉 Z4）

- **两函数**（shared `fractional-index.ts` 新文件，纯函数零依赖）：`generateOrderKeyBetween(prev: string|null, next: string|null): string`（头尾 null=虚拟边界锚）+`compareOrderKeys(a,b)`（原生 `<`）。
- **字符集**：ASCII 递增连续段（实现取 base32 `0-9A-V`——与 32 键长预算匹配；单测全扫「相邻字符码差 1」钉死字典序≡数值序；禁 RFC 4648 字母表）。
- **键长预算与 rebalance**：生成路径深挖使键长将 >32 时走 rebalance 而非生成失败。rebalance=**全量重排**：以当前收敛序（order+id 排序）为基序均匀分配新键；maintenance origin 事务（E6 直译）；确定性+幂等（双端各自触发亦收敛——后到端键长复原、条件自然不再满足）；均匀分配后键长必然 ≪32 天然防重入。触发=条件触发（生成超 32）非定期。
- **单测面**：前缀对（`a` vs `ab`——短键是长键前缀时的序语义钉死）+邻接对（两键间插入的收敛性）+头尾插入（null 边界）+并发同位插入（双端 midpoint 同值→order 相同→id tie-break 定序）+字典序≡数值序全扫。
- **消费协议**：插入节点=相邻两节点键间 between；无相邻参照（空画布/无邻居）=虚拟边界。**不引第三方库**（fractional-indexing 等——库行为锚纪律+需求仅两函数）。

### 2.3 消费面（Z3 分流）

| 消费面 | 改造 | 语义 |
|---|---|---|
| `readRecordsFromMaps` 出口（docShape.ts:138） | nodes 出口改 `order` 主键+`id` tie-break 排序（「迭代序消费显式化」实义） | **渲染 z 序唯一真源** |
| web 投影 nodes 数组序（applyDocToStore/reconcile 换芯路径） | 与读出口同源（消费 readRecordsFromMaps 出口序——投影数组序=doc 序） | 主画布 z 序 |
| `sortForArrange`（arrangeSelection.ts:79）/`sortNodesByPosition`（geometry.ts:68） | **仅补 id tie-break**（主键 x/y 不动） | 空间功能序（落格/拼接/组子网格）——非 z 序，语义不变 |
| 客户端插入/移动写点 | 生成 order 键走六写面（addNode envelope 形参扩 order；移动=改 order 键事务） | 跨端迭代序收敛 |

### 2.4 收敛 harness（E15/E70 完整版——内存双端 vitest）

- **载体**：**apps/web vitest Node 环境单文件**（shared 无 yjs 依赖——DocLike 抽象故；web 侧直 import shared `readRecordsFromMaps`+分数索引两函数+N 个 `Y.Doc`）。**无 provider/无 WS**（纯 `Y.encodeUpdateAsUpdate`+`Y.applyUpdate` 手动交换）。
- **装置**：N 客户端（Y.Doc 实例）随机操列（seed 固定且进失败输出——可复现）；扰动到达序=同一 update 集合以不同顺序/分段 apply 到对端。
- **断言（Z9 双向）**：(i) 收敛后双端 readRecordsFromMaps 出口 nodes 的 **id 序列逐位相等**；(ii) 同一 update 集合异到达序/分段到达，终态仍满足 (i)。**必含并发同位插入用例**（双端 midpoint 同值→order 相同→id tie-break 定序收敛）。
- **先红验收（D13）**：harness 在 order 键落地前必须红（现状=迭代序本地操作序——readOnly append 分支 canvasStore.ts:797 实证的投影数组序非 doc 单源，即 E70 根因：Yjs Y.Map 迭代序双端收敛，但渲染序现状=本地 store 投影数组序）。

## 3. Y1b 尺寸/只读域设计

### 3.1 服务端信封尺寸写（Z1 第七 op——P0）

- **新 op**：`writeNodeEnvelope{nodeId, patch:{width?,height?}}`——DocWriteOpType 第七成员；`DOC_WRITE_OPS` 补条目（keys=`['width','height']`，valueTypes=number，idempotent=true 键级 set 语义；`Record<DocWriteOpType,…>` 穷尽断言 :195 自动执法「忘分类即 tsc 红」）。与 writeExecStatus 并列同构。
- **cellCount**：属产物参数=data 层——`SERVER_NODE_DATA_KEYS` 扩 `'cellCount'`（valueTypes=number）。
- **写面**：六类产物落地链（ai-download/stitch/trim/separate 等——C0 一手核验后的实际清单）在 writeBatch 内 data 写+envelope 写（如需）**同单事务**（尺寸与产物引用原子同现，无中间态——客户端不会观察到「有 fileId 无尺寸」中间帧）。
- **E8 验收锚（Z7）**：六类产物逐一断言 doc 尺寸由服务端写入且与渲染实测一致；**取值从产物实体元探测**（文件探测/HTTP 头——sharp metadata/ffprobe 现役形态），禁从请求参数回填。
- **probeArtifacts 产物键白名单**（canvas-doc-manifest.ts:133 readers 侧）同批跟随（cellCount 入白名单）。

### 3.2 三源写面与覆盖语义（C5/Z5）

| 源 | 写面 | 语义 |
|---|---|---|
| 作者态尺寸 | 客户端命令体（addNode envelope 形参/runCommand patch——**现状已走零改动**） | 作者手改=命令写覆盖 |
| 媒体固有尺寸 | 服务端 `writeNodeEnvelope`（Z1） | regenerate 时**总是覆盖**（最后写胜，Z5——禁「作者已手改则保留」分支） |
| 测量值（DOM 上报） | **删除**（C5 终裁——reportNodeSize/dispatchFixtureSizeIntents/measured 族整链） | 三源收口后派生帧确定 ⇒ reconcile 失去存在理由（C1 闭环——reconcile 删除归 Y3 批） |

### 3.3 VIEWER 四写点收口+闩锁核销（Z6）

- **四写点先拒绝**：nodeStore 四写方法（addNode/deleteNode/updateNode\*/moveNode——以 plan 一手枚举为准）readOnly 下从「先应用后回弹」（:797/:849）改「**先拒绝+拒绝计数**」。dispatch 门已在（canEdit 假时 doc+store 双零写——现状 store 侧 set 走 append 回弹分支即改造对象）。
- **先红门禁断言**：readOnly 下**零 Y.Doc transact**+拒绝计数递增（VIEWER 四写点全覆盖）。
- **闩锁核销**：上述门禁全绿后（readOnly 期间本地 update 触发面=零的证据），diverged 闩锁（:230 裁定 23⑨）及其三出边 UI 面同批核销——**顺序不可倒置**（先删闩锁=先失去防御再补门禁）。caveat：核销前 grep 全量确认闩锁无其它触发路径（Y.Doc observer origin!==provider 的写点全量枚举——plan 任务）。

### 3.4 删除面（片 B 收口）

- 删 `reportNodeSize` 7 调用点+定义；删 `dispatchFixtureSizeIntents` 全链（:1575/:1579 门+:1640 调用+定义 :374）；删 `measured` 类型声明（docShape.ts:324）+assertions.ts:20-23 注记随族清。
- **对称核销判据**：grep 面全零+TD 台账登记（如涉）+相关既有测试（canvasO0b2.sizing.test 等依赖 mock 的用例）同批改写或删除。

### 3.5 兜底计数与合法态（Z8）

- `DEFAULT_CHILD_SIZE` 两消费点（assertions.ts:131+renderCanvas.ts:63）同源计数进 metric；CI happy-path 断言**兜底计数=0**（防兜底常态化=尺寸零写者回归的探测器）。
- 文本节点高度=渲染层 auto：doc 无 height 键=**合法态**（键可选三层表既有语义），不走兜底路径、不计数。

## 4. 片序与执行门（C0→A→B；每片出口=用户确认点）

| 片 | 内容 | 出口判据（用户确认点） |
|----|------|------------------------|
| **C0（前置·Y1b-P0）** | ①六类产物落地链一手核验（E8——行号漂移已登记，禁照抄）②`writeNodeEnvelope` 第七 op+`cellCount` 键扩+manifest 矩阵/writers/probeArtifacts 同批扩③**E8 六类断言先红**（服务端尺寸写未落=红相）④服务端写落地（writeBatch 单事务）转绿 | ①E8 核验报告（六类产物元数据可取性+漂移行号勘正）②第七 op 词汇表+矩阵绿③六类断言绿+先红证据留档 |
| **A（Y1a 主线）** | ①信封 order 必填期望键+六写面扩+fail-closed 两执法点（先红：缺键 throw 计数）②分数索引两函数+四钉单测③读出口排序+投影同源+两空间函数 id tie-break④harness（双向断言+并发同位插入——**先红**：现状投影数组序非 doc 单源即红相） | ①harness 双向断言绿（先红证据留档）②字典序≡数值序/前缀对/邻接对单测绿③manifest 矩阵绿④web-tsc/vitest 全绿 |
| **B（Y1b 余量+删除面收口）** | ①VIEWER 四写点先拒绝+拒绝计数门禁（**先红**：现状回弹语义即红相）②readOnly 零 transact 断言全绿→闩锁核销（触发面 grep 全量枚举前置）③固有尺寸覆盖语义断言（最后写胜）④删除面（reportNodeSize/dispatchFixtureSizeIntents/measured 族+对称核销）⑤兜底计数 metric+CI 断言=0 | ①四写点门禁绿（先红证据留档）②闩锁核销+grep 全零③删除面 grep 全零+既有测试改写④终出口=verify 全链+CI 四 job |

- **执行门**：本批无单向门/破坏性动作（无世代切换/无删 reconcile——reconcile 删除归 Y3 三门全绿后）；删除面动作均在片 B 内、门禁证据前置。
- **批终出口**：verify 全链（28 步）×2 轮+push 后 CI 四 job 全绿+部署窗（epoch 递增——TD-28/R5' 修复批 07b6c436 未部署代码同车兑现）。

## 5. 验收判据与先红门禁清单（D13——红因须与门禁声明一致）

| # | 门禁 | 先红判据（变红时点） | 绿判据 |
|---|------|---------------------|--------|
| G1 | order 缺键 fail-closed | 六写面/读出口在 fixture 未补 order 时红（throw+计数） | 全量 fixture 补齐后绿；计数=0 |
| G2 | 收敛 harness 双向 | order 未落读出口排序时红（投影数组序≠doc 单源） | 双向断言+并发同位插入绿 |
| G3 | 字典序≡数值序 | 字符集选定后此门禁直接落绿前须先证红路径（人为构造乱序字符集注入=红）——单测内自证 | 全扫绿（相邻码差 1） |
| G4 | E8 六类产物服务端尺寸 | C0 断言先写即红（服务端写未落） | 六类逐一绿+值=实体元探测 |
| G5 | VIEWER 四写点先拒绝 | 收口前红（现状回弹语义——store 有中间态） | readOnly 零 transact+计数递增 |
| G6 | readOnly 零 transact | 闩锁核销前置门禁——四写点收口前红 | 全绿后授权闩锁核销 |
| G7 | 兜底计数=0 | 删除面未收口时 happy-path 可能红（测量链仍在→兜底常驻） | CI 断言 0 |
| G8 | manifest 断言矩阵扩 | 新键未分类即红（穷尽断言/矩阵测试面——既有机制） | 矩阵绿（order/width/height/cellCount 全分类） |

## 6. 非目标与移交（显式声明，防「引用了但没执行」）

| 项 | 归属 | 依据 |
|----|------|------|
| positionX/Y 拆键/`Y.Text`/E26 keep 修复/组帧载体 α | **Y1c-2a**（master spec §0.2 Y1c 行） | 本批 position 仍 `{x,y}` 单键（基线 §1.1 钉死） |
| SCHEMA_VERSION=3/世代通道/CanvasDocSnapshot | Y1c-1 | 本批 doc schema 变更=order 键+信封尺寸写（manifest 矩阵承载，无世代动作） |
| B14 写门面配额执法/maxDocBytes 评估/N_max/1013 | Y1c-3 | 排程项（CI 修复批 R5' 登记维持） |
| reconcile 仲裁层删除 | Y3（三门全绿前置） | C1 闭环=本批创造条件（派生帧确定），删除动作本身归 Y3 |
| exec 契约 v2/outbox | Y1c-2b | 本批 writeNodeEnvelope 是节点信封写，非 exec 面 |
| UI 视觉变更 | 零变更面（用户裁定③） | 如深化发现需新视觉再单触发 ui-ux-pro-max |
| 存量数据兼容/迁移 | **无**（开发测试阶段无用户数据——零迁移纪律） | 用户裁定（2026-10-18 重申） |

## 7. 纪律与观察项

- **执行纪律**：superpowers TDD（红-绿-重构）+门禁先红（D13）+偏离登记（§0.4 滚动）+「进 spec 断言一律先实证」（CI 修复批两处照抄未验教训——本 spec §1 基线全部一手核验，行号=07b6c436）。
- **harness 两约定带入**（TD-28/R5' 批立）：本批 harness 纯内存无 provider——guard 约定不适用；**yjs_pending 观测约定对本批 vitest 单文件同样不适用**（无 server/persistence 参与）——两项约定自 Y1c 起（涉及真连装置时）恢复生效。
- **观察项带入**：B15 心跳 FIFO 边界（本批无大帧链路，不触发）；collab.gateway.spec 满载 flaky（本批 verify 轮次若二连命中同一用例转根修——观察级）。
- **manifest 断言矩阵扩+缩对称**：新增键（order/width/height〔信封写域〕/cellCount）入矩阵；删除面（measured 族）出矩阵——双侧同批，防单向漂移。

