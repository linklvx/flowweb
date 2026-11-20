<!-- doc-status: active | created: 2026-11-20 | v10. 唯一有效规则是正文 §0。本头注不是指令。 -->
# Y4a 时间轴域迁移设计 spec v10

日期：2026-11-20
批次：Y4a（总目录 Y4 行拆两件之第一件——「时间轴入 doc+撤销域隔离+canUndo/canRedo 事件驱动 UI+连接预算终裁」；第二件 Y4b=批注+富文本安全面 D10，另行立项——拆批本身是我的提案 §10-1，确认门可推翻）
定位：**功能设计文档**——Yjs 升级工程 Y4 的第一片。总目录行：2026-10-06-canvas-yjs-arch-upgrade-review.md:153（v10 收窄后七项中本批承载④⑤⑦+②③终裁件）。

---

## 0. 唯一有效规则（v10）

本节与 §1–§9 及计划任务是同一套规则——§0 是 §1-§9 的浓缩，冲突处以 §0 为准。头注只标明文档状态，不宣布正文作废。§10 与 §13 只保留裁定史，里面不出现可执行的闸值或删除顺序。不再追加轮次。

1. 软闸 262144。每一笔编辑、每一个删除片段块，正向帧与逆操作帧任一超过就拒绝，活文档不写。硬闸 524288，服务端入站帧与撤销按钮共用。520192（=硬闸−4096）只用于撤销按钮：弹栈前读栈项上的装回字节，超过就不弹栈。
2. 不实现、不调用「删掉整棵时间轴再 undo」这把尺。时间轴可以大于一把撤销帧。
3. 客户端删除只走 `executeDeleteSplit`，并且它是最外层事务，不经过 `dispatchCanvasIntent`。先对整批做完切块计划，再写活文档。每个片段块的 origin 是 `local-user`，前后都 `stopCapturing`，只删这一块的片段。全部块之后，一笔 `local-user` 删掉未保护的节点、边、已经变小的 `timelines` 键和组。这次选择里没有剪辑节点时，维持一笔事务，不额外 `stopCapturing`。单个片段的逆操作仍超过 262144：该节点一笔都不写，它和删除集里的全部祖先组不进最后一笔。`undoStack.length + 块数 + 1 > 100`：整次删除不写。撤销先回到节点和组都在、片段还没装回。**投影差分（diffProjectionToIntents）的删除半边保持原样、继续产出 deleteNode intent——ungroup/clearStoryboard/removeStoryboardCell/多图展开四条漏斗经它删无时间轴节点；删除集里含「文档中仍带非空片段时间轴」的节点时整份差分不派发，canApplyIntent 对这种 deleteNode 拒绝（reason `timeline-chunk-required`）——漏网后挡，不是第二条删除实现。**
4. 服务端与客户端用同一套切块，每一块都是最外层事务。`deleteTimelineClips` 与 `deleteNodesWithTimelines` 各自只开一层事务；文档已在事务里时直接抛 `nested-transact-forbidden`，禁止静默并帧（Yjs 嵌套 transact 并进外层、内层 origin 被丢掉——「先测一笔、不过再改切块」的退路走不通：原语在 withDoc/writeBatch 里被调用，切多少块都还是一帧）。片段还在的节点：先按与客户端相同的块预算删片段，每块单独一层 SERVER_TRANSACT_ORIGIN；壳节点、边、已变小的 timelines 键进最后一笔。shrink 影子预演继续量整份文档字节（8MB 配额）；活文档写入改走不包外层事务的会话、由调用方逐块开事务；任一块过不了 validateFrameDeny 或 262144，活文档一笔都不写。writeBatch 的 deleteNodes 遇非空片段时间轴返回 `timeline-chunk-required`，不在批事务里硬删。恢复导入的 effectiveDeletions 先对活文档逐块提交并逐块过闸，再克隆候选、再算信封 commitDiff。replace 仍只删 nodes 条目并留下同名时间轴；写回的节点不再是 videoEdit 时同一笔删掉这个键。客户端撤销毒帧仍只由客户端切块解决；服务端 origin 不进画布撤销栈。
5. `stackItemBytes` 记正向帧，`stackItemRestoreBytes` 记装回字节。画布栈和时间轴栈各持各的表。`undo()` 和 `redo()` 弹栈后，把两张表都抄到新栈项上。**捕获窗三类**：片段/轨道/关键帧的增删与删除的每一块=写前写后 `stopCapturing`、单独成步；拖动松手（span 标量整值替换）=同一手势单独成步、写前写后 `stopCapturing`；其余标量整值替换=500ms 窗、栈项装回字节为窗内之和，写下一笔前栈顶已记装回字节加本笔 undoBytes 超 520192 先 `stopCapturing`。不做 openCapture 重放。
6. 删除某节点的第一块之前，卸下该节点的时间轴 UndoManager，拖动覆盖层作废。
7. `rebuildDocFaithful` 是真空重建、金丝雀重建、瘦身副本的唯一拷贝。`toReadModel` 继续不含 timelines。哈希和真空等价比较包含 timelines。标量槽拒绝 Y.Array 和 Y.Text。**同名根就是同一对象**（doc.getMap 对同一名字返回同一对象）——装载时根不在用 SERVER_TRANSACT_ORIGIN 做一笔空事务 getMap('timelines') 不放工程；画布撤销挂接时同样 getMap('timelines') 进 scope（与 nodes/edges 同一启动方式 canvasCollabRuntime.ts:2067-2068）；编辑器只读已存在的 timelines.<nodeId>，键不在不创建。
8. L1 只检查本帧插入。L2 用观察者安装时拿到的 timelines 根做 `currentTarget` 比较，谓词内部不对 timelines 调用 `getMap`。**两个观察者分开写：actor 的 observeDeep 先读 `ev.changes` 再 noteEvents（不读=事务结束后 Y.Event 抛 errorComputeChanges、actor 收成 4411 关连接）；编辑器的子 Map observeDeep 只 setState、不 commit（防 observe→commit 循环）——键的替换和删除听 timelines 根上该 nodeId 键**。删除片段、轨道、关键帧和整棵节点键合法；删除 version、fps、tracks、clips 非法。
9. 单人团队和多人团队同一份 Y.Doc。`VideoProject` 整表删除。`schemaVersion` 与协议版本同笔改为 5，不 UPDATE 旧行。`videoProjectId` 改为 `sourceNodeId`。粘贴不复制时间轴。
11. **媒体三件（并集/悬空键照投/装载重扫）**：绑定快照单源并集（节点 refs∪timeline clips mediaId，targetItemId=clipId、空 clipId 不产行）——帧投影/全量 rebuild/slot-write 三调用方共用；**悬空键照投：节点已删而 timelines 同名键还在时仍投该键片段行，节点和键都不在才 null**；装载重扫（rescanEnforcedMediaRefs）候选收集改并集且在早退之前、剥除=节点槽+时间轴片段键两腿同 mediaId 集、事务内写后快照改并集。
10. T1 在高时钟的 live doc 上逐块 undo，每一块未包装帧必须 ≤ 524288。超过就把块预算从 262144 下调到能通过的值，测试写明测到的字节。这项通过之后才写删除实现。**T1 大时间轴档为负控：超预算的一笔删除必须被拒（nested-transact-forbidden 档+超 524288 档）；切块后的每一帧 ≤ 524288 且 countDsRanges ≤ 16000**（多 client 交错 clock 夹具——连续 clock 夹具几乎必过、盖不住上线形态）。

---


## 1. 意图与动机

**为什么做**：时间轴（视频编辑器）是全仓唯一剩存的非 doc 数据面——数据在 PG `VideoProject.data` Json 列整档存储，写路径=REST PATCH last-writer-wins（`updatedAt` 毫秒全等比对，`video-project.service.ts:70-83`），两人同开同一工程撞 409 停自动保存、无字段级合并；撤销=前端 editorStore JSON 快照史 50 步（`timeline/history.ts:6-30`），与画布 Y.UndoManager 100 步两套独立系统。这与工程主轴「Y.Doc 唯一真源」（A1）直接矛盾。本批把时间轴数据面迁入画布 doc，消灭第二真源、整删 REST autosave 链，协作模式全覆盖时间轴域。

**成功画面**：两人同开同一视频工程，各自拖动片段实时互见；各自 Ctrl+Z 只撤销自己域的操作；编辑器仍复用画布那条 WS；导出/预览/GC/迷你画布全部从 doc 读；**`VideoProject` 表整张删除**（v8 勘正——原「data 列退役、表只留元数据」与 §3.3 矛盾，照 §3.3 改同一句）。

**非目标**：
- 不做批注/threads 域（→Y4b）；不做富文本安全面 CSP/消毒/注入用例（→Y4b）。
- 不改导出渲染/音频合成本身（只换数据读取源）。
- 不碰序域/几何域（Y1a/Y1b 已落）；不做离线/多标签新语义（Y5）；不做快照机制（Y6）；不做多实例（Y7）。

**反目标**：给时间轴做「新 REST 端点+新 PG 表」=背离 doc 主轴把第二真源固化；给 50 步快照史打补丁=垫片。

---

## 2. 现状与事实基线（census 2026-11-20，锚点经子代理勘察核实）

| 面 | 现状 | 锚点 |
|---|---|---|
| 数据模型 | `VideoProject.data Json` 非空存整档 ProjectData（version/fps/canvasSize?/tracks[]/clips{}），类型单源 shared/types/video-project.ts:4-10；`sourceNodeId String @unique`（一剪辑节点一工程） | schema.prisma:500-518 |
| 乐观锁 | DTO `baseUpdatedAt`（非列名）比对 `updatedAt` 毫秒全等→409 | video-project.service.ts:70-83 |
| autosave | 防抖 1500ms+退避 [1s,4s,16s]；409→toast「自动保存已暂停」+停自动保存（**非三选 modal**） | autosave.ts:1-2,:57-60; Shell:104 |
| 关闭排空 modal | 三选 ConfirmModal（重存/放弃/取消）只在**关闭排空失败**路径 | VideoEditorShell.tsx:133-168 |
| 编辑器入口 | 画布页内全屏 Modal，复用画布 WS；时间轴持久化走 REST 独立于 WS | page.tsx:396; autosave.ts:13 |
| 两套撤销 | 画布 Y.UndoManager（scope=[nodes,edges]，undo-policy.ts:27 单源；trackedOrigins=[LocalUser,ySyncPluginKey]）vs 编辑器 JSON 快照史 50 步 | canvasUndo.ts:33-38; timeline/history.ts:6-30 |
| 交叉点 | editorStore 结构变更调 stopCapturing() 切画布合并窗；时间轴 undo/redo 经 ensureAutoEdges 反向改画布 edges（AutoEdge origin 不入栈） | editorStore.ts:97-100; auto-edges.ts:14-38 |
| 导出链 | runExport 消费 data（totalDuration/mixdown/renderFrameAt）——客户端 | export/controller.ts:35-57 |
| media-GC | collectJsonMediaIds 深扫 data JSON 收 clip.mediaId | media-gc.service.ts:116-131 |
| 迷你画布 | VideoEditNode REST 读 p.data 画轨道缩略 | VideoEditNode.tsx:45-46,:192-205 |
| 引用登记 | media-referrer.registry.ts:120 findMany 扫 VideoProject | 引用扫描面 |
| 级联清理 | lifecycle-obligation.sweeper.ts:207 级联 deleteMany（workflowId FK Cascade）——**v7 本行随表删消失**（§3.3） | sweeper 面 |
| 生成重做 | regenerate 读画布 doc 不读 data——不受波及 | video-project.service.ts:110-124 |
| 公开页 | 零消费 VideoProject.data | 公开快照面 |
| 顶层域 manifest | closed 四 map（meta/nodes/edges/exec——exec 根已 DENY〔T32〕、meta 零写者零读者〔T18〕） | canvas-doc-manifest.ts:15; frame-deny.ts:36 |
| vacuum 约束 | rebuildVacuumDoc 顶层 **Map 根**逐 key 深拷贝（U-2 守恒）；非 Map 根（Y.Array/Y.Text）return null 降级导出 | collab-doc-registry.service.ts:751-756,:784 |
| sourceNodeId | 一词两义：表列=剪辑节点自身 canvas nodeId；clip.sourceNodeId=素材源节点 id（RegenerateDto:15 注释自警） | schema:505; dto.ts:15 |
| 富文本载体 | 已落 Y1c T16（yXmlFragmentBinding 三件套+L1 actor:1158/L2 actor:1366 执法）——本批不重装、Y4b 只做安全面 | yXmlFragmentBinding.ts; collab-project-actor.service.ts |
| 审计基建 | 帧级 actorRanges 已落（CanvasDocUpdate 批行+铺满校验）；DocAuditEvent kind 封闭五值 | system-history.ts:39-44,:109 |

**勘误入档（总目录 Y4 行与现实不符处）**：①「含三选 ConfirmModal 冲突语义」——三选 modal 只在关闭排空失败路径存在，autosave 409 实际=toast 停自动保存；本批整删链路后 409 场景随数据入 doc 消失，无需补建三选功能。②其余描述与现状相符，无第二处不符。

**退役面防误引**：doc.exec 读写链（Y1c T32）/meta.schemaVersion（T18）/`/execution` WS 通知面（Y3 2026-11-19）/autosave PUT（ADR 0001）——本文档任何设计不引用这些已退役面。

---

## 3. 核心设计：时间轴域入 doc

### 3.1 doc 形态（A2 裁定既定——v6 按用户第四轮收口方案定形）

A2（总目录 :28）已终裁：**同 doc，按剪辑节点 id 键控**。

```
doc.getMap('timelines'): Y.Map<nodeId, Y.Map>   // 键=剪辑节点自身 canvas nodeId（=VideoProject.sourceNodeId 同义）
  entry: Y.Map {
    version: 1 / fps: 30        // 字面量（shared 类型单源 video-project.ts:5-6）
    canvasSize: JSON 标量        // 整值替换（非 Y.Map）
    tracks: Y.Map<trackId, Y.Map>   // 每轨 {id,type:'video'|'subtitle'|'audio',name,muted,hidden,order}
    clips: Y.Map<clipId, Y.Map>
      span: JSON 标量 {trackId,start,duration,sourceStart?}   // 整值替换——移动/裁切都替换整个 span
      transform/style/fade/transitionIn/transitionOut: JSON 标量（整值替换）
      keyframes: Y.Map<kfId, JSON 标量>   // **随片段出生（v6 修订④）**；显示序按 t 再按 id
      type:'video'|'image'|'audio'|'subtitle'；video/image/audio 有 mediaId；subtitle 有 text（字符串整段）
  }
```

- **v6 修订④（keyframes Map 随片段出生）**：video/image/audio 在**创建片段的同一条事务里放入空的 keyframes Map**，之后只增删键；字幕没有这个键。**若等第一条关键帧再 set 一棵新 Map，两个客户端同时下第一笔时后写的整棵覆盖先写的**（v5「关键帧值=标量入 keyframes Map」未定出生时机=此洞）。
- **v6 修订⑤（写路径=diff）**：editorStore.commit 今天每次交出**整份 ProjectData**（:104）——codec 对前后两份做**结构 diff**，一条 timeline-user 事务里**只改碰到的键**；span/transform/style/fade/transitionIn/transitionOut 任一子字段变化都整值替换；track.clips 只在读回时推导不参与 diff；**禁止对已存在的键 set 一棵新 Map**。种空工程继续只走 applyIntentToDoc 的 addNode 分支，**不调用现有 createDefaultProjectData()**（它用 genId('track')）；默认轨 id=`${nodeId}:video`、order=FIRST_ORDER_KEY。
- **v6 修订③（remapForCanvasSize 补全）**：切画布尺寸同一条 timeline-user 事务里替换 canvasSize、就地替换每个片段的 transform，**并替换 property∈{x,y} 的关键帧标量**（remapForCanvasSize 现行为——editorStore:435 同时改 transform 与 x/y 关键帧；v5 只写 canvasSize+transform=切比例后关键帧留旧坐标系）。
- **v6 修订⑤（标量闭集与帧谓词）+v7 修订③（按类型键矩阵定形）**：
  - **Map 键必须等于记录自己的 id**；空 clipId 拒绝；标量用普通 JSON 值放进 Y.Map.set。
  - **按片段类型允许的键**：**video**=span（含 sourceStart）/transform/mediaId/sourceNodeId/playbackSpeed/transitionIn/transitionOut/keyframes；**image**=同 video 但 span 不含 sourceStart、无 playbackSpeed；**audio**=span（含 sourceStart）/mediaId/sourceNodeId/volume/fade/playbackSpeed/keyframes（**音量关键帧 {id,t,value,easing} 无 property——切比例不改它们**）；**subtitle**=span（不含 sourceStart）/text/visible/style，无 keyframes/mediaId/transform。
  - **轨上的键**=type/name/muted/hidden/order；**入口上的键**=version/fps/canvasSize/tracks/clips。version 只能是 1、fps 只能是 30、playbackSpeed 只能是 0.5|1|2；非有限数、负的 start/sourceStart、非正 duration，帧谓词拒绝。
  - **v7 类型补件**：shared Track 补 `order: string`（现型 video-project.ts:11-18 无此字段）；clips 只在读回时生成（排序=start 再比 clipId）；diff 不看这个数组；轨道排序=order 再比 trackId；关键帧排序=t 再比 id；新轨 order 用现有 `orderKeyAfter`（返回空就拒绝加轨）；默认轨 id=`${nodeId}:video`、order=FIRST_ORDER_KEY('5000')、名称「视频」。
- **v6 修订⑤（读回顺序定死）**：轨道按 order 键再按 track id；轨道内片段按 start 再按 clip id；关键帧按 t 再按 id。
- **Map/标量分界（v5 维持）**：Y.Map 只用在四处（每剪辑节点一棵/tracks/clips/keyframes）；创建者事务建好后只增删键、改已有键的值，禁止 set 换一棵新 Map；两人同时拖同一片段=其中一个落点（span 整值替换）。轨道命令域维持：本批无轨道重排命令，新轨 orderKeyAfter 接最大键后、genId('track') 只用于后加轨 id。
- **v9 修订②（timelines 根物化定形——规则 3）**：fillDoc 今天无条件 getMap('nodes')〔docShape.ts:99〕与 getMap('edges')〔:153〕——空文档也有这两根。**timelines 加在同一函数里 getMap('timelines')，不往里面放工程**；服务端装载声明根类型的地方同样声明这根；真空重建走既有「非 nodes/edges 的 Map 根逐 key 深拷贝」。**vacuumEquivalent 在比形状之前对两侧文档都 getMap('timelines')**——只对旧文档 getMap 会凭空造根、形状比较永远失败（meta 那次等价失败就是这个原因〔:780-781 注记〕）；内容比较用导出后的 stableStringify(timelines)。客户端只在同步完成之后往已有的根里写 timelines.<nodeId>；**创建空工程仍只有 applyIntentToDoc 的 addNode 分支，并且节点已存在于 nodes 时不写**；水合和真空深拷贝不种第二棵 Map。
- **v9 修订③（标量槽封死——规则 4）**：键矩阵仍以 video-project.ts 为准。Track 增加 order: string；clips 只在读回时按 start、再按 clipId 生成。version 只能是 1、fps 只能是 30、playbackSpeed 只能是 0.5|1|2。start/sourceStart 有限且非负、duration 有限且为正；Transition 五种 type 保留、非正 duration 拒；音量关键帧无 property、easing 只能 linear；切比例只替换 x|y 关键帧。**另外封上会进导出的数**：canvasSize 宽高有限且为正；volume/fade.in/fade.out/opacity/fontSize 有限数（fontSize 为正、fade 两段非负）；video/image/audio 的 mediaId 非空字符串。**标量槽上出现 Y.Map、Y.Array 或 Y.Text 都拒绝**（deepCopyYMap 对后两种会把另一份文档里的类型直接 set 进新文档〔registry:93-100〕）。Map 的键等于记录自己的 id；空 clipId 拒；已有的 Map 键只改值、不换一棵新 Map；keyframes 在创建片段的同一笔事务里写成空 Map；字幕片段没有这个键。

### 3.2 manifest/门禁接线（新增顶层域的七处单源——E17/E38 四层）

| 单源文件 | 变更 |
|---|---|
| canvas-doc-manifest.ts | DOC_TOP_LEVEL_MAPS +`'timelines'`；层③ timelines 写者=客户端（LocalUser=创建/删除、timeline-user=编辑），读者=编辑器/导出/迷你画布/GC 扫描；层④ undo scope=v6 形态（画布栈含 timelines、origin 隔离——§4） |
| frame-deny.ts | FRAME_DENY_ROOTS +`'timelines'`（客户端帧准入新根）+validateFrameDeny 矩阵接线 |
| doc-schema-v4.ts → v5 矩阵 | timelines 帧形状谓词：**封闭键集+四类片段〔video/image/audio/subtitle〕+三轨〔video/subtitle/audio〕+字面量 version=1/fps=30+非负 start/sourceStart+正 duration+playbackSpeed∈{0.5,1,2}+合法 order 键（order-key 单源）+mediaId 只出现在有媒体片段上**；videoGen 的 `videoProjectId` 键改 `sourceNodeId`（:210 LWW 槽随卡换键，旧键标禁）；**SCHEMA_VERSION 4→5**（§6） |
| collab-doc-registry.service.ts | rebuildVacuumDoc timelines 根逐 key 深拷贝走既有 U-2 路径；**vacuumEquivalent 增时间轴内容比较（v5 定形——用 collab-canary-semantic.ts 现成 stableStringify 按键排序稳定序列化，非 JSON.stringify(toJSON())——Y.Map 键序不稳定深拷贝后字符串比较误报假红）**；深拷贝漏内容时比较结果为假（负控变异可验） |
| **oracle-worker.service.ts**（builder check 补遗） | `SCAN_ROOTS=['nodes','edges']`（:54，常备注释「新增可写根必须同步扩」）+timelines——比对覆盖闸随之 |
| **collab-canary-semantic.ts**（builder check 补遗） | 语义摘要视图根清单 +timelines；canonicalDocView 同步加 timelines 根；**stableStringify 现为文件私有函数（:15）、canonicalDocView 只盖 nodes/edges（:31）——本批导出共享单源**（vacuumEquivalent 与 canary 同函数） |
| doc-codec.ts | **toReadModel/CanvasReadModel 不挂 timelines**（v3 修订⑤——执行/公开页画布读模型面不动；公开页防泄漏=「读模型里根本没有 timelines」结构性保证，非先放再剔除）；服务端 GC/erasure 消费走 media-refs 扫描谓词（§3.3）非读模型 |
| undo-policy.ts | **v6 修订——UNDO_STACK_BASE 改 ['nodes','edges','timelines']**（画布栈 scope 含 timelines——撤销删除带回时间轴）；Origin 枚举加 `timeline-user`（时间轴编辑专属 origin——域隔离由 origin 保证非根不相交，总目录 C6「根类型不相交」按字面作废见 §4）；timeline 管理器 policy 常量复用同源 |
| **collectMediaRefs/media-refs.ts** | **v4 修订②——绑定快照单源并集函数**：节点 refs（collectMediaRefsForNode）∪该节点 timeline clips refs（video/image/audio 的 mediaId、role=primary、targetField=mediaId、targetItemId=clipId；subtitle 无槽）——单源函数被帧投影与全量 rebuild 两处共用（增量=全量同集合）；collectMediaRefs 聚合同步扩 |
| **FrameEffectsCollector（actor）** | **v4 修订②——observeDeep 加 timelines 根**：变更路径首段=剪辑节点 id 并入现有 touched 集（:276 position-only 判定不动——只改坐标的画布帧仍不进集）；takeBindingDelta 走并集单源函数并**枚举 timelines 键——键还在就投该键片段行、节点和键都不在才 null**（详 §3.3） |
| **canvas-invariants.ts** | clipSourceNodeExists 写侧说明改为「客户端写入前检查源节点在不在；并发删除后悬挂 id 只忽略（导出/播放走 mediaId 继续）」——状态维持 partial（详 §3.4） |
| **collab-protocol.ts** | CLIENT_PROTOCOL_VERSION 4→5 与 SCHEMA_VERSION 同步（旧包拒连——§6） |
| **公开剥离名单/video-work 面** | videoGen `videoProjectId` 剥离项随键改名同步为 sourceNodeId |
| docShape.ts | **readRecordsFromMaps 不扩展**（v3 用户裁定——timelines 无装载对称读回件，走 codec 专径） |

新键未分类即红（字段闭环门禁 D13 先红后绿：manifest 未加 timelines 前先跑红）。

### 3.3 PG 侧：VideoProject 表整张删除（v7 修订②——取代 v3-v6「元数据留表」）

- **`VideoProject` 表整张删掉**（v7 关键翻转）：data 列+创建/读取/整档 PATCH+按节点 DELETE 去掉之后，这张表**没有剩余读者**——regenerate、导出预检、成片 register/confirm 都不读它（census 实证）；媒体保护走 MediaBinding；编辑器要的 teamId 用画布页已有团队上下文（**useTeamAssets 改订这份上下文**——现经行派生）；标题固定「多轨剪辑」放界面上（EditorTopBar:22 既有文案）不放列里。
- **总目录留表动机作废**：留这张表是想靠 sourceNodeId 唯一约束做悬空时间轴防护——**这个防护已由文档本身承担**：节点和 timelines.<nodeId> 在 applyIntentToDoc 的同一条 LocalUser 事务里一起创建、一起删除；表上的唯一约束防不住 doc 里的悬空键。
- **v6 行插入协议整条随表消失**：ON CONFLICT DO NOTHING 补行、自带 SAVEPOINT、帧落库时条件 deleteMany、sweeper:207 无条件臂——全部不再需要（P2003 那条外键失败路径一起消失，落库队列不再为它增加失败形态；v6 对「表必须留」前提下这些协议是对的，表删则协议无对象）。客户端 cascadeDeleteVideoProject 同批去掉。**User 的 onDelete:Cascade 随表消失**。
- **schema 变更=一条删表迁移，不搬数据**（开发期无存量）。同批去掉的登记面：scope-column 里的 VideoProject 登记、NODE_DELETED 义务文案里的 VideoProject 级联（lifecycle-observer）、媒体引用扫描里扫 VideoProject.data 的那一臂（media-referrer+`collectJsonMediaIds`）、**擦除流程对这张表的点名**（project-erasure 引用图「VideoProject.data 深扫」要素+assert:117 FK Cascade 豁免随表消）。
- **引用收集改道（v5/v7 维持——凡按节点替换的快照都走并集）**：takeBindingDelta（actor:213-218）现形态=`nodes.has(nodeId) ? collectMediaRefsForNode(nodeId, nodes.get(nodeId)) : null`——collectMediaRefsForNode 只扫画布节点 data；**只改时间轴的帧若把该节点标 touched，投影会用「节点 data 的引用」盖掉该节点全部槽位=片段 MediaBinding 被删，到下次全量 rebuild 才补回，中间媒体失去保护**。projectBindings 对 delta 里的节点做**整表 diff**——因此**任何调用方交出的都必须是该节点的完整槽位集**：
  - **单源并集函数**：节点 refs（collectMediaRefsForNode）∪该节点时间轴 video/image/audio 片段 mediaId（role=primary、targetField=mediaId、targetItemId=clipId；subtitle 无槽）。**投影与聚合都枚举 timelines 键：键还在就投该键的片段行（并发残留键不丢 GC 保护）；节点和键都不在才交 null（清该节点全部槽位）**。帧投影（takeBindingDelta）与全量 rebuild（collectMediaRefs 聚合）共用。
  - **slot-write.port.ts:62 同改并集**（现只返回 collectMediaRefsForNode，对剪辑节点做一次槽写会清掉全部片段绑定）。
  - **clipId 禁止空串**：空串是节点标量 mediaId 槽的 targetItemId，撞上互相覆盖；非空 clip id 与节点自己的槽并存（唯一键五元组已保证）。
  - **收集器 observeDeep 加 timelines 根**：路径首段=剪辑节点 id 并入 touched；只改坐标的画布帧仍不进集（:276 position-only 判定不动）。
  - role=primary/targetField=mediaId 均在既有 CHECK 词表（schema:1609/:1662）——**零新词**。
  - 保护链=帧事务内投影+全量 rebuild 同一并集+oracle SCAN_ROOTS 加 timelines 对拍；**GC 热路径不解码团队全部 doc**。

### 3.4 web 侧：editorStore 写穿 Y（v6 定形）

- **空工程种点（v5 维持——挂钩只有一处）**：`applyIntentToDoc` 的 **addNode 分支**（canvasIntents.ts:153），条件=nodes 里还没有这个 id 且类型是 videoEdit——同一条 LocalUser 事务写入空 `timelines.<nodeId>`（默认轨 `${nodeId}:video`+FIRST_ORDER_KEY('5000')、零片段）。菜单新建/duplicateNodes/组复制/粘贴全经此路。**fillDoc 水合与真空深拷贝不走这里**——不给已有键再 set 一棵新 Map。编辑器只订阅已存在的 Map。**不调用现有 createDefaultProjectData()**（它用 genId('track')）。
- **写路径（v6 修订⑤——diff）**：
  - **结构操作**：一条 `timeline-user` 事务——codec 对 editorStore.commit 交出的前后两份 ProjectData 做**结构 diff，只改碰到的键**（§3.1 v6 修订⑤）；keyframes Map 随片段出生（§3.1 v6 修订④）。
  - **拖动（spec §0 条 5——diff 基线+捕获窗独立成步）**：本地覆盖层跟手，过程中不写 doc；**松手时的 diff 基线=当时 doc 里已经合入的状态，再叠上本地覆盖层**（没被这手势碰到的键不会把远端更新写回去）；片段键或它的轨道键已经没了就丢掉覆盖层；**松手是 span 标量整值替换但不走 500ms 窗——同一次手势单独成步、事务前后双 stopCapturing（§0 捕获窗三类之第二类，锚 8 只约束这一类）**。
  - **setCanvasSize（v6 修订③）**：同一条 timeline-user 事务替换 canvasSize+每个片段 transform+property∈{x,y} 关键帧标量（remapForCanvasSize 现行为）。
  - overlap 规则维持现状：本地落点先 canPlaceAt；远端重叠照样渲染，读侧不抛不写回「修好」——现有不变量铁律。
  - **clip.sourceNodeId 写前客户端检查**：源节点不在就不发事务；并发删除后悬挂 id 只忽略（导出/播放走 mediaId 继续）；服务端不拒已写帧——canvas-invariants.ts clipSourceNodeExists 写侧说明照此改，状态维持 partial。
  - **自动边**：片段增删之后仍是下一条 AutoEdge 事务调现有 ensureAutoEdges；**编辑器水合完成时对账一次**（补上崩溃窗口里没写上的边）；**时间轴 undo/redo 返回后同样跑一次**（§4——自动边不负责时间轴的生死）；stopCapturing 继续只切断画布合并窗。
- **v7 修订③（编辑器重绑语义定形）**：编辑器只订阅已经存在的 Map。**节点还在、Map 被换掉→销毁旧的 UndoManager 再绑当前这棵**（销毁之前先 clear()——避免对已经脱离父键的 Map 再 undo），本地覆盖层作废，时间轴栈从空栈开始；**节点没了→编辑器关掉**。
- timeline 纯函数族（clip-math/overlap/placement 12 文件）不动——只换入栈目标。
- `timeline/history.ts` JSON 快照史整删（反目标：不打补丁）。
- autosave 链整删：autosave.ts+onConflict toast+关闭排空三选 modal+`createAutosaveController`——编辑器关闭=直接关（doc 落库走 collab flush；beforeunload 已挂画布页；**editorDirty REST 闩随链删除**）。
- 读链四改道：①editorStore.loadProject→doc 水合+订阅；②导出 runExport→**读 doc 已提交结构**（不读拖动覆盖层——竞态按此定义关闭）；③VideoEditNode 迷你画布→画布页内存 doc 直读（零 REST）；④video-project REST 控制器**工程创建/读取/整档 PATCH+按节点 DELETE 面**整删（regenerate/导出预检/register、confirm 留现有控制器）。
- **复制/粘贴剪辑节点不复制时间轴**：粘贴事务走 addNode 分支=新节点种空工程（与今天「新 sourceNodeId 另建一行空数据」一致）。

### 3.5 导出与注册链（v7 定形——表已删，行协议消失）

- **写门（v4-v7 维持——时间轴 Map 只创建一次，种点=applyIntentToDoc addNode 分支）**：创建剪辑节点事务同时写空 timelines.<nodeId>（默认轨 `${nodeId}:video`+FIRST_ORDER_KEY，名称「视频」）；**编辑器只订阅已存在的 Map，键不在不创建**。编辑器看到键被换掉或消失的处理见 §3.4 v7 重绑段。**timelines 根与 nodes、edges 同一批物化点创建**（v7 修订③——装载/水合时根集合守恒）。
- **行：无**（v7——VideoProject 表整张删除，§3.3）；编辑器 teamId=画布页团队上下文（useTeamAssets 改订）；标题「多轨剪辑」界面常量。
- **导出/注册链 re-key**：成片去重键、register 元数据、schema videoGen 的 `videoProjectId` 改 `sourceNodeId`（**那是 doc 里的字符串不是这张表的外键**——doc-schema-v4.ts:210 LWW 槽换键、旧键 v5 矩阵标禁）；公开快照与 video-work 剥离名单同改剥 sourceNodeId；导出守卫只看「编辑器已载入该节点且 doc 里有这份时间轴」。RegisterGeneratedDto 契约变更进本批验收面。

---

## 4. 撤销域隔离（总目录 ⑤——v6 按用户第四轮收口方案重写：画布栈要能带回时间轴）

- **v6 核心翻转——总目录「根类型不相交」按字面作废**：Yjs 13.6.32 捕获谓词=changedParentTypes 沿父链命中 scope 类型（canvasUndo.nested-scope.spec.ts 头注级锁：tracked root 命中任一祖先键即捕获）。timelines.<nodeId> 的删除发生在 timelines 这棵**根**上——画布栈 scope=[nodes,edges] 看不见父链外的根；v5「删除入画布栈但 scope 不含 timelines」=撤销只把节点装回、**时间轴键不被带回**，v5 尾动作接着种一棵空 Map=**片段、轨道、关键帧全部丢失**。根不相交就无法在撤销删除时带回时间轴。
- **v6 定形（scope 三件）**：
  - **画布 UndoManager scope 改为 [nodes, edges, timelines]**；trackedOrigins 仍是 [LocalUser, ySyncPluginKey]（canvasUndo.ts:33-38 只扩 scope）。
  - **时间轴编辑用新 origin `timeline-user`**：编辑器打开时创建的 UndoManager 只盯当前剪辑节点那棵子 Map，trackedOrigins 只有 timeline-user（Origin 枚举加此常量）。
  - **创建仍是一条 local-user 事务：addNode 同时种空时间轴**（applyIntentToDoc 的 addNode 分支——撤销创建会同时去掉节点和空工程）。**删除按 §0 条 3 的 executeDeleteSplit 形态**（撤销第一步回到节点和组都在、片段未装回，之后按块装回——**不是「一条事务删整棵 Map、一次撤销原样装回」**；applyIntentToDoc 的 deleteNode 分支只删无时间轴或空时间轴的节点，遇非空片段拒绝 reason `timeline-chunk-required`）。
- **v6 尾动作取消（取代 v5 双入口种/删 Map）**：undoCanvas/redoCanvas **不再种 Map、也不再删 Map**——画布栈已含 timelines，撤销/重做本身带回时间轴；时间轴 undo/redo 返回后，下一条事务用 AutoEdge 跑现有 ensureAutoEdges 把素材边补齐——**自动边不负责时间轴的生死**（v5「执行端崩溃在 um.undo() 与尾动作之间→远端等一棵不会出现的 Map」结构性消除）。
- **删除事务只 clear 被删节点自己的时间轴栈**（v5 是清「当前编辑器栈」——编辑器开在别的剪辑节点上时那一栈不动）；节点重新出现后，编辑器重新绑定装回来的那棵 Map，时间轴栈从空栈开始。
- **域隔离改由 origin 保证（v6/v7 验收三行为，取代「根不相交断言」）**：①timeline-user 事务不动画布栈（scope 含 timelines 但 trackedOrigins 不含 timeline-user 以外的编辑 origin）；②只改画布的 LocalUser 事务不动时间轴栈；③撤销删除后 stableStringify(timelines.<nodeId>) 与删除前一致——**v7 限定：③只在无并发写入时逐字节成立；并发落在这棵 Map 上的后续片段跟着 Map 身份回来，不要求与删除前字符串逐字节相等**。
- **删除与撤销装回的语义就是 §0 条 3**（executeDeleteSplit 最外层切块、组骨架最后删、撤销第一步回到节点和组都在、片段未装回——不是「一条事务删整棵、一次撤销原样装回」；历史规则 1/2 与裁定 3/4 的文本见 §10 裁定史）。
- undo/redo 语义变化如实登记：撤销深度 50 步→100 步（与画布同源单源常量）；跨会话撤销仍不可用（Yjs 撤销为会话内语义——现状快照史同为会话内，无退化）。
- **拖动手势语义（与 §0 条 5 同一套捕获窗）**：拖动=本地覆盖层+松手一条 **timeline-user** 事务（过程不写 doc；松手=span 标量整值替换但**同一次手势单独成步**、事务前后双 stopCapturing——不走 500ms 合并窗；松手时片段键或它的轨道键已没了就丢覆盖层——详 §3.4）。

---

## 5. canUndo/canRedo 事件驱动 UI（总目录 ⑦——v3 按用户方案修订）

- 现状：画布撤销零按钮零状态 UI（纯键盘 useGroupKeyboard:41-43）；编辑器撤销按钮两颗已在 **PreviewPlayer:135-138**（点 editorStore.undo/redo）。
- 键盘路由维持现状：编辑器开时 Ctrl+Z 走 useEditorKeyboard；useGroupKeyboard:12 编辑器开时已退场——不做新路由。
- 落地：两管理器各自订阅栈事件（`stack-item-added/updated/popped`+`undo/redo`）→ 新 undoUiStore（zustand，per-manager canUndo/canRedo 布尔）→ 按钮消费。**UI 面（v3 修订——取代 v2 §10-4）**：PreviewPlayer 既有两颗改接 timelineUndoManager 栈事件+CanvasTopBar 新增 undo/redo 两颗接 canvasUndo；**不在轨道面板另放一对**；禁用态事件驱动（不再经 editorStore 长度派生）。

---

## 6. 版本与接线（v3 按用户方案修订）

- **CANVAS_DOC_SCHEMA_VERSION 4→5**（docShape.ts:59 单源；doc-schema-v4.ts 更名/矩阵扩 timelines 谓词+videoGen 换键）。baseline `--write` 同 commit（门禁纪律既定）。
- **CLIENT_PROTOCOL_VERSION 同步 4→5**（collab-protocol.ts:13 单源——旧包拒连；本地文档按既有排空、重置、强刷处理，**不写迁移**〔开发期无存量〕）。
- 帧白名单加 timelines：谓词校验封闭键、四类片段、三轨、字面量 version/fps、非负时间、正 duration、playbackSpeed∈{0.5,1,2}、合法 order 键、mediaId 只出现在有媒体的片段上（§3.2 表）。
- 配额不新做（v5 重申）：单次事务走现有 256KB 前置检查、驻留上界仍 maxResidentDocBytes——**不另做时间轴预算式**（撤销按钮后挡=§0 第 1 条 NORMAL_FRAME_GATE_BYTES−4096 单一派生常量）；验收用一份约 200 个片段的时间轴证明仍被现有闸接受、超 256KB 的单事务被拒绝（§9 锚 13）。
- 排空切换 runbook 引用（C7③——Y1c 已建）：照「停写→drain→reset→部署→强刷」既定序，无新增步骤；单机部署不变（PM2 instances:1 钉死）；服务器仍停等用户部署指令（foundation 批移交项），本批纯本地。

---

## 7. A2 终裁：编辑器与画布同开连接/驻留预算（总目录 ③——本批承载件之一）

**终裁=零连接放大+预算并入既有面**（我的裁定 §10-2）：编辑器=画布页内全屏 Modal 复用同一条 WS（census 实证 page.tsx:396），不新增连接、不新增 per-user 连接闸（Y7 多实例再议）；新域字节并入既有三层配额（E52）与 `maxResidentDocBytes` 全局驻留上界（registry:280）——**单事务闸与撤销按钮后挡按 §0 第 1、2 条执法（QUOTA_DEFAULTS.maxTxBytes+NORMAL_FRAME_GATE_BYTES 两个现有单源，撤销按钮后挡=NORMAL_FRAME_GATE_BYTES−4096 单一派生常量），不另做时间轴预算式**。

---

## 8. E18 立项纪律三件

- **RPO/RTO 影响（v5 语义改写）**：时间轴持久化从「REST autosave 防抖 1.5s+409 停摆后**丢失窗口无上界**」改为「doc flush 链 spool-first fsync+maxDebounce 3s」——**稳态窗口更长（1.5s→3s），但真正去掉的是 409 之后自动保存停住、丢失窗口没有上界这件事**（诚实登记：非全面改善，是上界换语义）；spool-first 是崩溃安全面；RTO 不变（装载链既有）。
- **新增观测面**：census 族更新（manifest/frame-deny/registry shapeOf 三断言含 timelines）+既有 yjs_canvas_doc_bytes 直方图天然覆盖新域字节；不新增指标文件。
- **CI 载体**：verify full 36 步族+census 门禁（既有 CI 档）+**双 client 测试装置 int spec**（Y0a E40-装置复用：A 端拖片段→B 端断言互见→A 端 undo→B 端断言回滚）。

---

## 9. 验收标准（可验证锚——v9 改锚 9/10/13，其余保持 v7/v8）

1. **真源归一 grep 门**：`VideoProject` 表整张删除（model+迁移）；`VideoProject.data` 零读者零写者（collectJsonMediaIds 删+六读链改道）；autosave PATCH/GET 面零路由；`createAutosaveController`/onConflict/排空失败 modal 零引用；客户端 `cascadeDeleteVideoProject` 零引用；erasure/scope-column/NODE_DELETED 文案中的 VideoProject 登记全清。
2. **协作锚**（双 client 装置）：A 拖 clip→B 互见；A undo→B 回滚；两管理器域隔离。
3. **门禁先红后绿**（D13）：manifest 未加 timelines=字段闭环红；frame-deny 未准 timelines=帧 DENY 红；vacuum shapeOf 未同步=U-2 红——各先红一次再落地绿。
4. **域隔离三行为（v7 限定）**：①`timeline-user` 事务不动画布栈；②只改画布的 LocalUser 事务不动时间轴栈；③撤销删除后 stableStringify(timelines.<nodeId>) 与删除前一致——**③只覆盖无并发写入档**（并发后续片段随 Map 身份回来，不要求逐字节相等）；加双端同格位断言。
5. **基线**：api 316f 族/web 384f 族/shared 全绿+双端 tsc 0 错+verify full 36/36。
6. **canUndo/canRedo UI**：按钮事件驱动禁用态（断言不轮询——订阅事件计数）。
7. **创建唯一性**：第二端从不调用「给已存在键 set 新 Map」这记写；两端在同一棵 Map 上各加一个片段，**两个都在**；撤销互不吃对方的栈。
8. **拖动零中间写+diff 基线+手势独立成步**：拖动过程中对端文档 start 不变；松手后变为终值；**松手是 span 标量但单独成步（写前写后双 stopCapturing——不走 500ms 窗）**、撤销栈恰增一条；**diff 基线=当时 doc 已合入状态叠覆盖层——未碰键不把远端更新写回**。
9. **删除与撤销带回**：以 §0 第 3、4、5、6 条为准。撤销先回到节点和组都在；520192 只挡撤销按钮；栈将超过 100 则整次不写。
10. **真空内容等价（v9 增根断言）**：**两侧都先声明 timelines 根，空根的真空形状比较为真**；真空前后时间轴内容 stableStringify 相等；深拷贝漏内容时等价判断为假（负控变异）；**漏拷贝一个片段时 stableStringify 比较为假**。
11. **绑定投影并集**：只改时间轴的帧写下 targetItemId=clipId 的 MediaBinding 且不被帧内投影删掉；slot-write 端口对剪辑节点的槽写不清掉片段绑定；随后的全量 rebuild 不删它；只改坐标的画布帧仍不进 touched；clipId 空串被拒；**节点已删而 timelines 同名键还在→投影仍带该键片段行（双亡才清空）**。
12. **公开零泄漏**：公开读模型的键里没有 timelines（结构性断言非剔除）。
13. **撤销装回闸**：以 §0 第 1、2、10 条为准。每笔和每块只量自己的正向帧与逆操作帧；不测整棵装回；520192 不参与能不能删除。
14. **键矩阵与类型（v9 补封标量槽）**：按片段类型键矩阵全执法（video/image/audio/subtitle 四档清单+轨五键+入口五键+字面量 version=1/fps=30/playbackSpeed∈{0.5,1,2}）；帧谓词拒非有限数/负 start/sourceStart/非正 duration/空 clipId/**标量槽 Y.Map/Y.Array/Y.Text**/**canvasSize 宽高非有限正数/volume、fade.in、fade.out、opacity、fontSize 非有限数（fontSize 需正、fade 两段非负）/mediaId 非空字符串**；**Map 键=记录自身 id**；Track 补 order:string；新轨 orderKeyAfter 返回空=拒加轨；音量关键帧无 property 且切比例不改；**keyframes 创建片段同笔事务空 Map、字幕无此键**；**已有 Map 键只改值不换新 Map**。

---

## 10. 提案与裁定记录（v9——七轮用户收口方案裁定史）

| # | 提案/裁定 | 状态 |
|---|---|---|
| 1 | 拆批 Y4a/Y4b（时间轴先行） | 用户 v3 方案确认维持 |
| 2 | A2 终裁=零连接放大+预算并入既有配额 | 用户 v3 方案确认（「配额不新做」） |
| 3 | ~~stopCapturing 桥删除~~ | **推翻——保留**（v3：切断画布合并窗；v8 起还切断删除事务/切块间/拖动松手事务） |
| 4 | ~~canUndo/canRedo UI=TimelinePanel+CanvasTopBar~~ | **取代**——PreviewPlayer 既有两颗+CanvasTopBar 两颗（v3） |
| 5 | ~~行创建协议（首见新键→ON CONFLICT 补行→表条件删除）~~ | **v7 整体作废——表整张删**：VideoProject 零剩余读者（regenerate/导出预检/register/confirm 均不读）；悬空防护由 doc 同事务生灭承担（表约束防不住 doc 悬空键）；行协议+P2003 失败形态+User Cascade 全随表消失 |
| 6 | timeline STACK_LIMIT=100 与画布同源 | v3 同构确认 |
| 7 | ~~GC 双臂~~→~~touched 并轨~~→~~并集单源~~ | **v6/v7 维持**——凡按节点替换的绑定快照全走并集（takeBindingDelta+rebuild+slot-write.port 三调用方）+clipId 禁空串 |
| 8 | 导出/注册链全链 re-key 到 sourceNodeId | v3-v7 确认维持（doc 字符串非外键） |
| 9 | ~~非追踪 origin~~→~~双入口尾动作~~→~~undo 前再量装回帧~~ | **v6 推翻（尾动作取消+scope 扩 timelines）→v8 量法修正→v9 执行细则→v10 由 §0 取代**（v8/v9 段的 520096 删除预检与整棵装回拒写作废存档）：undo() 前再量在删除后量到空树（克隆不带撤销栈）；v8 四裁定定形；v9 五条执行规则；v10 冻结稿=§0（两帧量法+切块删除+撤销按钮后挡）；总目录「根类型不相交」按字面作废（§11） |
| 10 | ~~拖动=live doc 写~~ | **推翻**（v3）——本地覆盖层+松手一条 timeline-user 事务；v7 diff 基线=当时 doc 已合入状态叠覆盖层 |

**v3 新增裁定**：类型/字面量勘正；tracks=Y.Map+order；track.clips 不入库；默认轨 id=`${nodeId}:video`；subtitle text 保持字符串；复制粘贴不复制时间轴；regenerate/导出预检/register、confirm 留控制器；title 固定「多轨剪辑」；CLIENT_PROTOCOL_VERSION 同步 4→5；配额不新做。

**v4 新增裁定（第二轮）**：写入纪律（禁 set 换新 Map）+绑定投影并集+地图只创建一次（addNode 分支种空工程）。

**v5 新增裁定（第三轮）**：删除=LocalUser 同事务+时间轴栈前置 clear；行插入 SAVEPOINT 外；空工程种点唯一挂钩；slot-write 端口同改并集+clipId 禁空串；Y.Map 四处+标量整值替换+span 形态；双 stopCapturing；stableStringify 真空比较。

**v6 新增裁定（第四轮）**：画布栈 scope=[nodes,edges,timelines]+新 origin timeline-user+尾动作取消+remapForCanvasSize 补全+keyframes Map 随片段出生+写路径 diff+读回顺序三档。

**v7 新增裁定（第五轮）**：撤销装回停在现有单笔闸（量法以 v8 修正为准）+VideoProject 表整张删（行协议随表消失；登记面核销；一条 DROP TABLE）+codec 键矩阵定形（Track 补 order/四档键清单/diff 基线=doc 已合入叠覆盖层/重绑语义/timelines 根同批物化）。

**v8 新增裁定（第六轮四条——全部代码核实属实）**：①**每笔时间轴事务量两帧**——临时 doc（Y.applyUpdate(temp, encodeStateAsUpdate(live))）量正向 update+只撤销这一笔的逆操作 update，任一超 QUOTA_DEFAULTS.maxTxBytes(262144) 拒；整棵装回帧只在变大时参加同一把尺子（变小写入留下=并发超 256KB 时间轴仍能逐块删）；清空整棵逆操作=整棵装回超 262144 必须切块（chunkCopyPlan:538 同款+块间 stopCapturing）；切比例仍一笔（200 片段正向≈40KB 两头量）。②**一次画布事务只删一个带时间轴剪辑节点**（onNodesChange 现把全部 remove 放进同一次 transact〔canvasIntents:362-364〕+组删除 500ms 窗合并——两棵 400 片段叠一步≈600KB 直接 1009；带时间轴剪辑节点拆各自 LocalUser 事务+前后画布栈 stopCapturing；组节点/非剪辑子节点留同一步；撤销逆序 parentId 随子装回）。③**装回字节删除当时记栈项**（删除后 Map 不在 doc、克隆不带撤销栈——「undo 前再量」量到空树=闸等于没装；删除事务提交同次同步流程量逆操作字节记栈项，undoCanvas+时间轴 UndoManager 都在 undo() 前读、>NORMAL_FRAME_GATE_BYTES(524288) 不弹栈保持删除态——画布栈+时间轴栈都要；redo=再删一次正向帧小沿用现有软限额预检）。④**装回过硬闸的节点删除不发生**（删除前量这笔逆操作>524288 拒绝删除「单次操作过大」、节点与时间轴留 doc；用户先逐块删片段装回落入硬闸再删节点——不出现「删除已生效、撤销被闸、时间轴回不来」）。**闸的事实实证**：undo()=popStackItem 一次 transact〔yjs.cjs:3509〕；服务端 >2×maxTxBytes 才 1009〔frame-gate:65-68〕——262144~524288 合法区间；stackItemBytes 现记正向 update〔undo.ts:42〕删除正向帧仅≈11B 拿它预检=低估。**照写两条**：VideoProject 整张删（exportPrecheck teamId 从 CanvasProject 派生〔:130-135〕+register videoProjectId=生成物元数据字符串〔generated-media.service.ts:61〕+useTeamAssets 改订 useCanvasStore.teamId〔page.tsx:55/:88 已 setTeamId〕）；键矩阵按 video-project.ts 封闭（Transform 五字段/Transition 五 type+非正 duration 拒/音量关键帧无 property/easing 仅 linear）。**§1 成功画面句勘正**（原「表留元数据」与 §3.3 矛盾）。

**v9 新增裁定（第七轮五条执行规则——全部代码核实属实；**自 v10 起本段的 520096 删除预检、整棵装回拒写、裁定 4 形态全部由 §0 取代作废，仅存档**）**：**判定面**=frame-gate:65 严格大于+262144~524288 进 admitFrameQuota:845-877 放行（超 doc 配额才事后冻结）=合法帧；**yjs.cjs:3664-3669 非追踪 origin 直接 return**（远端事务进不了撤销栈、栈项 delete set 不事后变大——删除当时量出的逆操作字节持续有效）；onNodesChange:1853-1897 全部 remove 同一次 dispatch；deleteNode:1149-1156 组先递归删子再删组+悬空 parentId 飞原点注记；deepCopyYMap:93-100 对 Y.Array/Y.Text 会跨 doc 直 set；vacuumEquivalent:786 只比 toReadModel+:780-781 单侧 getMap 造根=meta 假红根因注记。**规则 1（量法+4096）**：临时 doc 不连 provider、UndoManager 落笔之前挂上（scope/origin 与即将落笔那笔相同）、字节=这一笔 temp.on('update') byteLength（整份 encodeStateAsUpdate 量全文档不能当闸）；每笔量正向+只撤销这一笔的逆操作两帧任一超 262144 拒；整棵装回=另一场模拟（写后临时 doc 删这棵再 undo），树变大且这帧>262144 才拒（变小写入留下）；切比例一笔；清空/批量删按片段贪心切块每块逆操作≤262144、块间对时间轴栈 stopCapturing（chunkCopyPlan utf8 JSON 预算不能拿来切时间轴）；一块只剩一个片段且逆操作仍超→整笔拒 doc 不动；**节点删除前同一种模拟、逆操作>NORMAL_FRAME_GATE_BYTES−4096(520096) 拒删除**（4096 盖 sync 包装与临时 doc/真撤销编码差——写「刚好>524288」会量小放行→真撤销帧 1009 本地装回服务端没有）；软闸与硬闸间合法区间不再减 4096（给 undo 套软限额会把合法装回再闸死）；**允许落笔时逆操作字节记栈项 meta——stack-item-added 写入+stack-item-updated 累计**；undoCanvas+时间轴栈都在 undo() 前读累计值>520096 不弹栈提示「单次操作过大」（stopCapturing 到位=单笔字节、硬拒只是合并漏网后挡）；redo=再删一次正向帧小沿用 redoCanvas 软限额预检〔undo.ts:112-118〕。**规则 2（删除只有一条顺序组骨架最后删）**：onNodesChange 与 deleteNode 走同一个分割函数——先收齐删除集（选中+被删组全部后代）分两类；带时间轴剪辑节点逐个处理（先规则 1 装回预检→过闸 stopCapturing→一条 LocalUser 事务删节点+边+timelines.<nodeId>→再 stopCapturing；预检失败那个节点不删、本次也不再删组、已删过闸兄弟保持）；其余节点（组/非剪辑子节点/嵌套组）合成最后一条 LocalUser 事务（组善后=最后一条 stopCapturing 之后独立成步不并进装回那笔）——撤销第一步整棵装回组骨架、之后每步装回一个剪辑节点 parentId 指向的组已在（组先删=撤销中间态 parentId 悬空飞原点且同步给他人——排除此序）。**规则 3（timelines 根物化）**：fillDoc〔docShape.ts:99/:153〕加 getMap('timelines') 不放工程；服务端装载声明根处同声明；真空走既有非 nodes/edges Map 根深拷贝；**vacuumEquivalent 比形状前两侧都 getMap('timelines')**（单侧造根=形状比较永远失败）；内容比较=stableStringify(timelines)；客户端只在同步完成后往已有根写；空工程种点仍唯一=addNode 分支且节点已存在不写；水合/真空深拷贝不种第二棵 Map。**规则 4（标量槽封死）**：canvasSize 宽高有限正数；volume/fade.in/fade.out/opacity/fontSize 有限数（fontSize 正、fade 两段非负）；mediaId 非空字符串；**标量槽 Y.Map/Y.Array/Y.Text 全拒**（deepCopyYMap 对后两型会跨 doc 直 set）；Map 键=记录自身 id；空 clipId 拒；已有 Map 键只改值；keyframes 创建片段同笔空 Map、字幕无此键。**规则 5（验收改三处）**：锚 9+四条（多选两步/装回超硬闸删除不写 doc/undo() 前读栈项累计字节/组删除撤销第一步后组已在中间无悬空 parentId）；锚 13 按两帧量法重写（断言打 update 字节、片段数不进代码——六档必覆盖：正向或逆操作超 262144 拒/树变大整棵装回超 262144 拒/树变小整棵虽超也放行/400 一笔清空拒切块通过/单片段逆操作超整笔不写/节点删除逆操作超 520096 doc 不变）；锚 10+两条（两侧先声明根空根形状比较真/漏拷片段 stableStringify 假）。

**待 Y4b/后批终裁**：批注锚定形态（推荐全节点类型+文本精锚）；URL 白名单生产值（部署窗）；D10 CSP/DOMPurify 面（Y4b）。

---

## 11. 约束与已决事项（内嵌裁决全文——E30 自包含承诺）

本批直接消费的总裁决（全文引总目录）：**A2**（时间轴同 doc 按节点 id 键控——:28）；**E16**（Y4→Y5 维持，交换否决——:71）；**E38**（时间轴/threads=manifest 四层新顶层 Y.Map——:93）；**E28/E52**（配额三层执行模型+大写入分块——:83/:107）；**D13**（门禁先红后绿——:54）；**E17**（manifest 单源派生断言——:72）；**E18**（RPO/观测/CI 三件——:74）；**U-2/vacuum Map 根约束**（registry:751-756 头注）；**C7③ 排空 runbook**（:38）；**A1 真源反转主轴**（:27）。
**本批显式作废的总裁决字面**：**C6「threads/时间轴域 scope 全集冻结」中的「根类型不相交」读法**（:37）——Yjs 13.6.32 捕获谓词=changedParentTypes 沿父链命中 scope 类型（canvasUndo.nested-scope.spec.ts 级锁），根不相交则撤销删除无法带回时间轴（§4）；域隔离语义由 origin（timeline-user vs LocalUser）承载，C6 的其余部分（order 键入撤销栈等）不动。

---

## 12. 计划期清单（v7 定性——写计划时用 grep 列全，不改变 doc 形态/事务 origin/投影语义）

1. video-project 控制器路由最终删除表——只留 regenerate/导出预检/register、confirm，其余整删（grep 定全表）。
2. 编辑器组件 sourceNodeId 接线表（currentEditorProjectId/currentEditorProjectTitle/editorDirty 逐点改道——方向已定 §3.5 re-key）。
3. VideoProject 表删除的登记面核销表（scope-column/NODE_DELETED 义务文案/erasure 引用图要素与 assert 豁免/media-referrer 臂——grep 定全表，§3.3 已列方向）。
4. 删除分割函数两入口接线点（onNodesChange:1853-2017 结构批与 deleteNode:1142-1173 显式路径——§0 第 3 条同一分割函数落点、组善后独立成步位置）。

---

## 13. 评审史（builder check + 用户七轮收口）

- **builder check**（子代理 65 调用）回报四条规划阻塞——v2 按我方判断裁定，此后逐轮被用户收口取代。审读员对 census 锚点精度独立核实认可。
- **第一轮（2026-11-20）→v3**：五处代码冲突属实（类型字面量/deepCopyYMap 只递归 Y.Map/拖动模型/五元组装得下/真空等价盲区）。
- **第二轮→v4**：三处协作隐患属实（整图覆盖/touched 并轨有害/两份 Y.Map 不合并）。
- **第三轮→v5**：六处属实（LocalUser 删除/双入口尾动作/addNode 种点/SAVEPOINT 位置/slot-write 端口/Map-标量分界）。
- **第四轮→v6**：撤销域重写（scope 扩 timelines+origin timeline-user+尾动作取消）+行生命周期重写（P2003 终态语义）+remap 补全+keyframes 出生+diff 写路径。
- **第五轮→v7**：撤销装回停在现有单笔闸（量法后被 v8 修正）+VideoProject 表整张删（行协议随表消失）+codec 键矩阵定形。
- **第六轮（2026-11-20）→v8**：撤销闸量法对齐 yjs/删除路径事实——**undo()=popStackItem 一次 transact〔yjs.cjs:3509〕**、服务端 >2×maxTxBytes 才 1009〔frame-gate:65-68〕（262144~524288 合法区间）、stackItemBytes 现记正向 update〔undo.ts:42〕（删除正向≈11B 拿它预检=装回低估）；v7「undo 前再量装回帧」字面读法作废——删除后 Map 不在 doc、克隆不带撤销栈、量到空树=闸等于没装。四条执行裁定落案：每笔量正向+逆操作两帧（清空=逆操作整棵装回超 262144 切块〔chunkCopyPlan:538 同款〕）/一次画布事务只删一个带时间轴剪辑节点（onNodesChange 单次 transact〔canvasIntents:362-364〕+组删除 500ms 窗合并=两棵 400 叠一步 600KB 1009）/装回字节删除当时记栈项（undoCanvas+时间轴栈双执法）/装回过硬闸的删除不发生。两条照写：VideoProject 整张删（exportPrecheck teamId 从 CanvasProject 派生〔:130-135〕/register=元数据字符串〔generated-media.service.ts:61〕/useTeamAssets 改订 useCanvasStore.teamId〔page.tsx:55/:88〕）；键矩阵按 video-project.ts 封闭。§1 成功画面句勘正（表删）。锚 9/13 按 v8 改形。
- **第七轮（2026-11-20）→v9（自 v10 起由 §0 取代，本段为历史记录）**：**按字面开工会在删除顺序、装回量法、真空根上做出会断连或把组子节点挂飞的实现——五条执行规则定死**（判定面全部代码核实：admitFrameQuota:845-877 放行 262144~524288 合法区间+超限事后冻结；yjs.cjs:3664-3669 非追踪 origin 早退=栈项 delete set 不事后变大、删除当时量出的数持续有效；onNodesChange:1853-1897 全部 remove 同一次 dispatch；deleteNode:1149 组先递归删子+悬空 parentId 飞原点注记；deepCopyYMap:93-100 对 Y.Array/Y.Text 跨 doc 直 set；vacuumEquivalent:786 只比 toReadModel+单侧 getMap 造根=meta 假红根因〔:780-781〕）。**规则 1**：字节=这一笔 temp.on('update')（UndoManager 落笔前挂上；整份 encodeStateAsUpdate 不能当闸）；整棵装回=另一场模拟只在变大时参加；清空切块每块逆操作≤262144；**硬闸留 4096 余量（520096）**防「量小放行→真撤销帧 1009、本地装回服务端没有」终态；软闸区间不再减 4096（undo 不套软限额）；栈项逆操作字节 stack-item-updated 累计=合并漏网后挡。**规则 2**：onNodesChange 与 deleteNode 走同一个分割函数；带时间轴剪辑节点逐个（预检→stopCapturing→一条 LocalUser 事务删节点+边+timelines.<nodeId>→stopCapturing；预检失败不删、本次不再删组）；其余节点合成最后一条事务、组善后独立成步——**撤销第一步组骨架先回、剪辑子节点后一步回、中间无悬空 parentId**（组先删序排除）。**规则 3**：timelines 根与 nodes/edges 同一处物化（fillDoc:99/:153 同函数 getMap('timelines') 不放工程）；vacuumEquivalent 比形状前两侧都 getMap('timelines')；客户端只在同步完成后往已有根写。**规则 4**：标量槽封死——canvasSize 宽高有限正数/volume、fade.in、fade.out、opacity、fontSize 有限数（fontSize 正、fade 非负）/mediaId 非空串；标量槽 Y.Map/Y.Array/Y.Text 全拒；keyframes 同笔空 Map、字幕无此键。**规则 5**：锚 9/10/13 改形（断言打 update 字节、片段数不进代码）。**四柱七轮维持冻结；计划=v8 四裁定+本五条。**
- **方向四柱（冻结）**：同 doc 按剪辑节点 id 键控/VideoProject 整张删/画布撤销与时间轴撤销用 origin 分开/REST 自动保存整段删除。**v10 对齐指令：执行只读 §0；spec 与 plan 两份自此唯一一套指令，本节其余文字皆为历史记录。**
