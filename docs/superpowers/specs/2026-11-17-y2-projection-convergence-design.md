<!-- doc-status: active | created: 2026-11-17 | confirmed: 2026-11-17（用户授权按项目现实终裁，不另行仲裁；D1–D7 为本文终裁）；同日实现侧锚核：§2 九锚全中+五处修订（result 键勘正/片① census 补 VideoGenNode 分离固化+复制携带面/D1 媒体事实通道钉/D4 生产断言失败分支/单人回归锚） -->
# Y2 投影消费收口 设计 spec

> 范围：A 类单独立项。三片按序合并，每片有独立出口，后一片不提前一片的出口。依据=总目录 v11 Y2 行 + 裁决 A1 / C1 / C3 / C5 / D3 / D6 / E67 + 本文对四条勘察的复核。
> 开发测试档无用户画布需要保留。禁止 normalizer、双键读、影子双跑、版本分支、以及「先留着以后再删」的垫片。

## 0 本文解决什么

画布的作者态在 Y.Doc，执行态在 RuntimeEvent，渲染必须是纯函数。现在渲染仍由 `applyDocToStore` 全量灌进 zustand，再由 `reconcileGroupGeometry` 把 store 与 doc 仲裁回同一套坐标。主槽 `fileId` 与执行态 `status` 仍写在 doc 里，而 `frame-deny` 对 `server-forbidden` 只登记、不拒绝。Y2 把这三件事收成一条链：schema 4 只接受作者键，`projectCanvas` 是唯一渲染出口，节点状态与产物从运行时投影读，余额仍走现有 socket。

## 1 目标 / 非目标 / 反目标

**目标**

1. 协议与 doc 版本 3→4 硬切。主槽作者键为 `mediaId`。`server-forbidden` 全键族在 L1 与 L2 都拒绝。
2. `projectCanvas` 成为主画布唯一渲染出口。`reconcileGroupGeometry` 生产调用为 0。帧算法仍是 `deriveGroupFrame`。
3. 节点上的执行状态与产物从 `RuntimeProjection` 读。余额继续从 socket 的 credits 对象读，留到 Y3。

**非目标**

- 不删 `/execution`，不把余额改成 REST（Y3）。
- 不重写 14 处复合写路径为 intent-first（桥保留，见 D2）。
- 不改对象删除面的引用计数（跨团队粘贴改为字节拷贝，避免踩现行删除面，见 D5）。
- 不恢复单人团队的 awareness 广播。
- 不新建名为 CopyMedia 的路由。仓内无此 API。

**反目标**（做成了也算失败）

- 为 schema 3 文档写键重命名器，或读路径同时认 `fileId` 与 `mediaId`。
- 再实现一套组帧公式，使公开页与主画布各算各的。
- 删掉 reconcile 之后，diff 桥继续把派生宽高写回 doc 当权威。
- 跨团队粘贴把源团队的对象键挂到目标团队的新 Media 行上。
- 拒绝绑定后仍把对方团队的 media id 留在 doc 里「图先显示着」。

## 2 现库锚（2026-11-17 复核）

| 事实 | 锚 | 对 spec 的后果 |
| --- | --- | --- |
| `composeRenderFromNodeStore` 存在，读 `useNodeStore`，生产调用为零 | `apps/web/src/stores/runtimeStore.ts:228` | 它是 `projectCanvas` 要换掉的种子，本批删除，不改成第二出口 |
| reconcile 生产调用恰 4 处 | `canvasCollabRuntime.ts:1789`（`applyDocToStore` 尾）、`canvasIntents.ts:459`（漏斗尾 `source:'doc'`）、`canvasIntents.ts:662`（diff 桥首行 `source:'cs'`）、`canvasStore.ts:1739` | 出口锚=这 4 处消失。测试里的直接调用随套件重写，不算生产调用 |
| 复合写仍是 capture → mutate → `dispatchProjectionDiff` | `canvasStore.ts` 批 4b-2 换芯；漏斗=`dispatchCanvasIntent`（`canvasIntents.ts:432`）先过 `canEditCommand` 再过 `canEdit` | 桥保留。桥内两处 reconcile 删除 |
| CopyMedia 不存在。粘贴命令是 `BindMedia` | `POST /api/projects/:projectId/collab/bindings`，`collab-binding.controller.ts:37`。跨团队在 `:77` 直接 403。`rebindCopiedMedia`（`canvasStore.ts:568`）发命令后不读返回的 mediaId，失败则把源 id 留在 doc | 跨团队腿做在这条命令里。客户端必须消费返回的 id |
| `server-forbidden` 放行点 | L1 `frame-deny.ts:222`；L2 `:442`、`:472`、`:499`、`:513` | 五处同批改为拒绝。禁止只改其中一处 |
| 版本常量仍是 3，矩阵文件已经叫 V4 | `CANVAS_DOC_SCHEMA_VERSION`（`docShape.ts:57`）、`CLIENT_PROTOCOL_VERSION`（`collab-protocol.ts:11`）均为 3。键矩阵在 `DOC_SCHEMA_V4` | 只把两个数字 bump 到 4。不新建 V5 矩阵文件 |
| 对象删除按「被删 Media 行的键」删对象，不看是否还有别的行用同一键 | `deriveObjectDeletionSurface`（`project-erasure.objects.ts:57`） | 禁止两行 Media 共享对象键 |
| 远端投影 50ms 去抖，无 max-wait | `canvasCollabRuntime.ts:2616` | 保留 50ms idle，加 200ms max-wait |
| 组帧与第 4 渲染面已是纯函数 | `deriveGroupFrame`（`geometry.ts:147`）、`deriveRenderCanvas`（`renderCanvas.ts:40`） | 主画布复用这两份，不重写 |

行号是开工时的基线快照。实现中若漂移，以符号名为准，并在该片的第一条测试里重新钉住。

## 3 方案与终裁

### D1 投影形态：复用派生内核，主画布只做装配

考虑过两形态。

- 独立再写一套帧算法。公开页与主画布会分叉，直接违反 C1 的单源。否决。
- `projectCanvas` = `deriveRenderCanvas(readModel)` 的结果，再叠三层覆盖。帧与 hidden 剔除仍由共享内核完成。采用。

落点在 `apps/web`。签名：

```ts
projectCanvas(input: {
  readModel: { records: readonly RenderSourceNode[]; edges?: readonly RenderSourceEdge[] };
  runtime: RuntimeProjection | null;
  mediaFacts: ReadonlyMap<string, MediaFact>;
  gesture: ReadonlyMap<string, GestureOverlay>;
}): { nodes: RenderNode[]; edges: RenderEdge[] }
```

装配顺序固定：

1. `deriveRenderCanvas(readModel)` 产出几何、rel、hidden 剔除、边过滤。
2. 执行覆盖：有 `runtime.nodes[id].execStatus` 则渲染节点带该状态；有 `artifact.mediaId` 则**显示用**媒体 id 取它，否则取 doc 的 `data.mediaId`。doc 里不出现 `status` / `fileId`。
3. `mediaFacts` 只提供尺寸等事实，不改作者坐标。载体=既有 media-facts 批量通道与产物事件定向拉取（`mediaFactsRuntime` / `dispatchRuntimeArtifacts` sink），按 `mediaId` 取当前态；`factVersion` 是 Media 行全局单调计数快照（`schema.prisma:325`）、跨 factType 不可比——增量同步沿用既有定向拉取，本批不新造版本协议。
4. `gesture` 只覆盖会话中的 position / width / height，供当帧渲染。松手后这张表清空，doc 里才有提交结果。

`composeRenderFromNodeStore` 随片②删除。公开页继续直接调用 `deriveRenderCanvas`，不改成走 `projectCanvas`。

**等价域**（对拍锚，写进测试名）：`gesture` 为空、`runtime` 为空、`mediaFacts` 为空时，`projectCanvas` 的节点几何、parent、hidden 剔除、边集与 `deriveRenderCanvas` 逐位相等。运行时状态与手势不在这个等式里。

### D2 复合写路径：桥留下，仲裁层拆掉

考虑过把 14 处 capture/diff 改成直接发 intent。那是另一次写路径重构，不是本批已确认的范围。否决。

桥降级为：操作先改暂存 store → `diffProjectionToIntents` 只翻译**作者字段**（增删节点、parent、abs position、作者 data 键、边）→ `dispatchCanvasIntent` 单事务写入 doc → 立刻用 `projectCanvas` 回填 store 的持久域。

桥内删除：

- `dispatchProjectionDiff` 首行的 `reconcileGroupGeometry(doc, 'cs')`。
- `dispatchCanvasIntent` 尾的 `reconcileGroupGeometry(doc, 'doc')`。

diff **不得**把派生宽高、hidden、让位后的坐标编成 intent。组的 position 仍是 doc 里的作者字段（D6：auto 组也持久 position）；宽高仍只由 `deriveGroupFrame` 在投影时算出，不写回 doc。

同批删除的仲裁零件，不是另开卡：让位账本、`RECONCILE_EPS`、ratchet、`geometryTrap`、`assertReconcileSingleWriterWindow`、`reapplyGestureProtection`。四件前置按这个顺序做，避免假绿：

1. 先把假门禁改成会失败的测试（`geometryTrap` 只计数不抛、单写者窗口恒真），再删实现。
2. census 从「生产调用恰 4」改为「生产调用恰 0」，`ALLOW_FN` 白名单去掉 reconcile。
3. 现有几何测试改为对 `projectCanvas` 与 `deriveRenderCanvas` 对拍。禁止为了让旧测试编译而保留 reconcile 生产包装。
4. 字段闭环门禁（E17）改为：doc 组记录没有派生宽高键；store 持久域在无手势会话时等于投影。

新不变量：没有打开的手势会话时，store 里会持久的几何与成员关系等于 `projectCanvas(doc 读模型, 空覆盖)`。手势进行中，屏幕上多出来的部分只来自 `gesture` 参数。

### D3 增量：按变更 id 重算，数组按身份替换

全量重算只发生在：连接完成、世代切换、order 键变更。其余 doc 更新走增量。

机制：

- `observeDeep` 收集本批 `path[0]`（节点 id）。
- 重算集合 = 这些 id，加上沿 `parentId` 走到根的各组。不写死「组深只有 1」。
- 缓存 `Map<id, RenderNode>`。未重算的 id 保持原对象。
- 输出数组按投影顺序浅建。仅重算项换新对象。
- order 键脏：整序重排，节点对象能复用则复用。
- 远端：idle 50ms，自本轮第一个脏事件起 max-wait 200ms。本地作者事务：同步投影，不进这道去抖。

验收：单键编辑触发的 React 状态更新次数为 1；未编辑节点的对象身份不变。N 的取值为测试夹具规模（实现者定一个 ≥200 的夹具），阈值写在该测试里，不另造运行时指标。

### D4 手势：预览在 overlay，提交是一次 doc 事务

拖动与组 resize 已是松手提交。缺口是叶子 resize 仍走 `resizePending` 逐帧落点。片②把它收成同一会话：移动过程只写 `gesture` 表，doc 零写。

提交点（任一到达即提交，且只提交一次）：pointerup、pointercancel、pagehide、`visibilitychange` 且 `document.hidden`。提交是一个事务，doc update 恰 1 次，然后清空 overlay。

现在 `commitResizeGesture` 的不变量检查包在 `import.meta.env.DEV` 里。改为生产环境同样抛出。抛出表示这次提交没有把 store 收成投影，属于缺陷，不用第二轮 reconcile 补救。抛出的行为=该次手势提交整体丢弃（doc 未写，画布回到上一笔）+ 经既有 `invariant_violation` 遥测通道上报（`collab-telemetry.ts` 十二值词表内）；不蒙层、不重试、不静默吞。

硬崩溃丢掉进行中的手势，画布回到 doc 里的上一笔。接受（C2 已写明）。

### D5 跨团队粘贴：同一条 BindMedia，字节另存

项目只属于一个团队。跨团队粘贴不是「引用对方的 Media 行」。

服务端在现有 `bindMedia` 里加一条腿，不新路由、不恢复 CloneBinding：

1. 源媒体与目标项目同一团队：行为与现在相同，返回同一个 mediaId。
2. 源媒体属于另一团队：在服务端把对象字节拷到**新的**对象键（`key`，以及源行上非空的 `thumbnailKey` / `objectKey`），插入目标团队的新 Media 行，用新 id 做目标槽的 CAS，返回新 id。
3. 拷贝失败、源不存在、源配对失败：不建行，命令失败。doc 里不得留下源团队的 id。

不共享对象键。现行删除面按被删行的键删对象，另一行若挂着同一键会被一起删掉。引用计数要改的是删除面，不属于 Y2。

客户端不增加「是否跨团队」分支。`rebindCopiedMedia` 改为等待命令结果：

- 成功且返回 id 与 doc 中当前槽位不同：发一条 `updateNodeData`，把槽位写成返回的 id。同团队返回值相同，这条更新是空操作。
- 失败：从该副本节点删掉媒体槽位键。不再 toast 之后保留对方的 id。

乐观粘贴可以先把源 id 写入 doc（避免空图窗口），但失败路径必须把它清掉，成功路径必须换成返回值。这是同一条命令的收尾，不是第二条粘贴实现。

### D6 canEdit：不再造新门

写 doc 的入口已经是 `dispatchCanvasIntent`：先 `canEditCommand`，再 `canEdit`。Y1b 已收 VIEWER 的四处写点。

片②的出口包含一次 census：生产代码里写入 doc 的调用都经过这个函数。发现绕过的，就在本片改到漏斗上，不另开机制、不登记跟进。VIEWER 四处回归保持绿色。

### D7 schema 4：两个数字一起加，doc 不迁移

`CLIENT_PROTOCOL_VERSION` 与 `CANVAS_DOC_SCHEMA_VERSION` 同时从 3 改为 4。拒连形态沿用现在的 T18：`csv<4` → `schema-outdated` → 连接关闭；`CanvasDoc.schemaVersion ≠ 4` 的行拒载。不写 doc 字节级迁移。开发库里的 schema 3 行用既有世代重建 / 删行重置清掉，不在进程里改键名。

矩阵仍是 `DOC_SCHEMA_V4` 这份对象。每个现在写着 `fileId: forbidden()` 的类型：

- 保留 `fileId: forbidden()`，这样旧键的拒绝原因是 `forbidden-data-key`，不是含糊的未知键。
- 旁边增加 `mediaId: mediaLww()`，作为用户放置的媒体引用。

`status`、`trimmedFileId`、`trimTaskStatus`、`nodeStatus` 保持 `forbidden()`，并把放行改为拒绝。`result` 在矩阵本无条目——写 `result` 键今天已是 unknown-key 拒，无翻禁动作（勘正：原文把它列进「保持 forbidden()」系矩阵条目误记）。

**作者写与执行写分开**（否则实现者会把所有 `fileId` 赋值改名了事，执行态又写回 doc）：

- 用户放置（上传确认、粘贴、拖入分镜格、把已有图展开进格子）：写 `data.mediaId`，不写 `status`。
- 任务完成才出现的 id（`setFileResult`、`setTrimmedResult`、socket 上的 node status）：不写 doc。画面用 `RuntimeProjection.artifact.mediaId` 与 `execStatus`。服务端交付已经走 `exec.artifact`（T22）。客户端这两处 doc 写删除。

八个非主槽名字保持不变：`referenceImage`、`referenceVideo`、`referenceAudio`、`images`、`allImages`、`trimmedFileId`、`videoFileId`、`audioFileId`。词表里唯一的替换是 `fileId` → `mediaId`。`trimmedFileId` 仍在词表里（扫描名不变），同时矩阵禁止把它写入 doc；现有 `setTrimmedResult` 的 doc 写删除。

PG：一条迁移把 `NodeArtifact.targetField`、`ArtifactProjection.targetField`、`MediaBinding.targetField` 中的值 `'fileId'` 更新为 `'mediaId'`，然后收紧 CHECK。应用代码与 CHECK 之后只认 `mediaId` 作为主槽名。这是换约束，不是读分支。公开快照里对应主槽的 `StoryboardCell.fileId` 改为 `mediaId`；`thumbnailUrl` 不动。快照读侧只读新名字。

片①的拒绝开关放在该片最后：写者与「这些键的读者」都已离开 doc 之后才翻。否则一翻禁，画面就从 doc 读到空。

## 4 三片

### 片① schema 3→4

顺序：

1. 红测试先失败：帧内写入 `data.status` 或 `data.fileId` 时期望连接因 `forbidden-data-key` 关闭；今天 `:222` 的 `continue` 让它失败不了。L2 五处各一条。另有一条 `csv=3` 被拒、`schemaVersion=3` 的行拒载。
2. 词表、矩阵、三张 PG 表的值与 CHECK、公开快照字段，按 D7 改完。
3. census：生产代码里对 `server-forbidden` 键的每一处写入，按 D7 的作者/执行分档改完。基线符号包括 `canvasStore` 分镜展开与 `addImageToStoryboardCell` 的 `status:'done'+fileId`、`VideoGenNode` 分离结果固化两处（`fileId=videoFileId/audioFileId`）、复制/粘贴副本的 `fileId` 携带与读点（`rebindCopiedMedia` 的 `n.data.fileId` 面）、`nodeStore.setFileResult`、`nodeStore.setTrimmedResult`。行号允许漂移，符号不允许漏。
4. 翻禁：`frame-deny.ts` 五处 `server-forbidden` 从跳过改为返回失败。
5. 双常量 bump 到 4。旧 bundle 走现成的 `handleVersionTerminal` 一次重载。

**出口：** 上述红测试变绿；全仓生产写入不再出现这些禁键；`mediaId` 是主槽唯一作者键；没有读取 `fileId` 与 `mediaId` 两个名字的函数。

### 片② 投影函数

顺序：

1. 红测试：空覆盖下 `projectCanvas` 几何不等于一份手写的第二套帧（它必须调用现成内核，对拍 `deriveRenderCanvas`）。另有一条单键编辑 setState 次数断言，在增量落地前失败。
2. 实现 `projectCanvas` 与 D3 增量。`applyDocToStore` 不再做渲染出口。
3. 按 D2 删除 reconcile 四处与仲裁零件，桥只翻译作者字段。
4. 按 D4 把叶子 resize 会话化，补三个提交点，生产断言常开。
5. 跑 D6 census。
6. 删除 `composeRenderFromNodeStore`。

**出口：** 生产代码 `reconcileGroupGeometry(` 调用次数为 0；等价域对拍通过；单键编辑 setState 为 1 且未改节点身份不变；任一手势 doc update 恰 1 次；无手势时 store 持久域等于投影。

### 片③ 读点

节点组件上仍然订阅执行 socket 来画状态或产物的，改为读 `RuntimeProjection`（经 `projectCanvas` 叠到渲染节点上的字段，或直接读 runtime store）。`CanvasTopBar` 的 credits 仍从 socket 的完整余额对象读，本片不动。

**出口：** 生产代码里 `node:status` 的消费只剩余额。屏蔽状态类事件后，节点状态与产物仍从投影更新；余额行为与片前一致。

## 5 不变量

1. doc 的 data 不含 `fileId`、`status`、`result`、`trimmedFileId`、`trimTaskStatus`、`nodeStatus`。
2. 用户放置的媒体 id 只写在 `data.mediaId`（及八个保留槽位里那些矩阵仍允许的键）。
3. 显示中的执行状态只来自运行时投影。显示中的媒体 id：有 artifact 用 artifact，否则用 `data.mediaId`。
4. 组帧只由 `deriveGroupFrame` 计算。doc 持久的是 position（含 auto 组），不是派生宽高。
5. 无手势会话时，store 持久域 = `projectCanvas` 输出。
6. 一次手势对应恰好一次 doc 事务。
7. 跨团队粘贴之后，doc 槽位里的 id 属于目标团队的 Media 行，且该行的对象键不与源行相同。

## 6 测试载体

每片先红后绿，测试与该片同一次提交。几何与增量用现有 canvas 单测与 collab 装置，不新造一套只在本地手动跑的门禁。

必有的失败先行用例：

- 片①：`fileId` 与 `status` 写入被 L1、L2 拒绝；`csv=3` 拒连；PG `schemaVersion=3` 拒载；作者放置写入并读回 `mediaId`；`setFileResult` 路径不再写 doc。
- 片②：等价域逐位相等；单键 setState 次数；手势 doc update 次数；生产 reconcile 调用计数为 0。
- 片③：节点状态在没有 `node:status` 时仍随投影变化；余额订阅仍在。
- D5：跨团队 BindMedia 返回新 id；新行 `teamId` 是目标团队；新对象键与源键不同；源对象仍在；命令失败后 doc 不含源 id。同团队 BindMedia 不拷贝字节。
- 回归锚（非本批新机制）：单人团队 awareness 双向短路（Y0b-4 T13 既有测试）维持绿——本批不触碰 awareness 面，防改动被误判为恢复了广播。

77 个文件名命中与 125 处内容命中是重写成本，不是保留 reconcile 的理由。对拍替换之后，仍直接调用已删除函数的测试删掉或改调用 `projectCanvas`。

## 7 RPO / RTO / 观测 / CI

- **RPO：** 不变。持久化路径不改。
- **RTO：** 旧页面一次重载换到 csv=4 的包（现成版本终态）。schema 3 的 doc 行拒载后，开发环境走世代重建或删行，不在线改字节。没有需要保留的用户画布。
- **观测：** 不新造指标。拒绝必须走现有关连接计数，reason 带 `forbidden-data-key`。投影耗时继续用现有 `projection_duration` 诊断。预算放在 CI 断言里。
- **CI：** 三片的红转绿用例进现有 verify。没有 CI 跑的断言不算出口。

## 8 留给实现者

- 增量夹具的节点数（≥200）与耗时阈值的具体毫秒数，写在片②测试里，用今天全量 `applyDocToStore` 做对照，阈值不得宽于对照的量级。
- `gesture` 表放在哪个模块，只要 `projectCanvas` 的第四个参数是唯一读点、松手清空、且不写回 doc。
- 字节拷贝沿用现有对象存储客户端的服务端拷贝。拷贝与插入 Media 行同一事务边界：行插入成功而拷贝失败则整腿失败，不留无对象的行。

## 9 与总目录的关系

总目录仍是批次顺序的唯一依据。本文件是 Y2 的规格。目录里「CopyMedia」没有落点，以本文 D5 为准。目录 Y2 行的 spec 列指向本文件。
