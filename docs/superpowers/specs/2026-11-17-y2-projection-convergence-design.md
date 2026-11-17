<!-- doc-status: active | created: 2026-11-17 | confirmed: 2026-11-17（用户授权按项目现实终裁，不另行仲裁；D1–D7 为本文终裁）；同日实现侧锚核：§2 锚全中+五处修订；同日 v2：第三轮外部终裁稿（F1–F8+维持清单）逐锚核实成立、用户确认落盘——装配序（gesture 折入+liveFrame 进内核+墓碑步）/作者缓存与渲染列表两份数据/全量投影+身份复用/不变量事务前判定/跨团队粘贴重写（空槽+commandId 幂等+持久化执法腿）/翻禁移至第③步/词表收窄六键/拷贝=拷→插→补偿；另补四处（服务端 targetField 写点 census/CellNodeInfo 改名面勘正/T22 feed-only 现状锚/去抖基线注记）；撤回 v1 两处错断（「auto 组也持久 position」「乐观写源 id」） -->
# Y2 投影消费收口 设计 spec

> 范围：A 类单独立项。四步按序做在同一分支，每步有独立出口，四步一起部署——第③步（翻禁+版本 4）单独上线时画面主槽为空，禁止单独部署。依据=总目录 v11 Y2 行 + 裁决 A1 / C1 / C3 / C5 / D3 / D6 / E67 + 本文对现库的复核。
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
- 删掉 reconcile 之后，diff 桥继续把派生宽高、hidden、相对坐标写回 doc 当权威。
- 跨团队粘贴把源团队的对象键挂到目标团队的新 Media 行上。
- 任何时刻把对方团队的 media id 写进 doc「图先显示着」——包括命令在途的乐观形态。

## 2 现库锚（2026-11-17 复核）

| 事实 | 锚 | 对 spec 的后果 |
| --- | --- | --- |
| `composeRenderFromNodeStore` 存在，读 `useNodeStore`，生产调用为零 | `apps/web/src/stores/runtimeStore.ts:228` | 它是 `projectCanvas` 要换掉的种子，本批删除，不改成第二出口 |
| reconcile 生产调用恰 4 处 | `canvasCollabRuntime.ts:1789`（`applyDocToStore` 尾）、`canvasIntents.ts:459`（漏斗尾 `source:'doc'`）、`canvasIntents.ts:662`（diff 桥首行 `source:'cs'`）、`canvasStore.ts:1739` | 出口锚=这 4 处消失。测试里的直接调用随套件重写，不算生产调用 |
| 复合写仍是 capture → mutate → `dispatchProjectionDiff` | `canvasStore.ts` 批 4b-2 换芯；漏斗=`dispatchCanvasIntent`（`canvasIntents.ts:432`）先过 `canEditCommand` 再过 `canEdit` | 桥保留。桥内两处 reconcile 删除 |
| `deriveRenderCanvas` 输出=相对坐标、剔隐藏子树、内部生成 cellNodes | `renderCanvas.ts:40`（签名只收 `{records,edges}`）；「子 rel=abs−本遍新 origin」:4；`dropped` 剔除 :94-103；cellNodes :120 | 投影输出**不能**回灌 diff/持久域——作者缓存与渲染列表必须是两份数据（D2） |
| `deriveGroupFrame` 有 `liveFrame` 入参，但 `deriveRenderCanvas` 不传 | `geometry.ts:147`（manual/storyboard 值面消费、auto 恒派生，:142-146；`liveFrame?.width ?? size` :162）；`frameOf` 组装时不传（renderCanvas.ts:78-84） | 手势矩形经新增可选参数进内核（D1）；后贴宽高不进组帧 |
| 墓碑剔除今天在 `composeRenderModel` | `runtime-projection.ts:108`（`isActiveTombstone`）、:184（过滤位） | 删 `composeRenderFromNodeStore` 后这步必须留在 projectCanvas 链上，谓词不重写（D1 步 3） |
| 键集表已规定组帧键规则 | `applyKeySetTable`（`docShape.ts:248`）：auto/collapsed 组=0 帧键（含 position）、storyboard 只留 position、manual 留宽高 | v1「auto 组也持久 position」与现行键集表矛盾，撤回（D2/不变量 4） |
| CopyMedia 不存在。粘贴命令是 `BindMedia`，现写 NodeArtifact、跨队 403、客户端不读返回值 | `POST /api/projects/:projectId/collab/bindings`（`collab-binding.controller.ts:37`）；跨队 403 :77；NodeArtifact `targetField:'fileId'` 写 :108/:128；`rebindCopiedMedia`（`canvasStore.ts:568`，bindMedia 生产唯一调用方 :580）fire-and-forget 失败留源 id | 跨团队腿做在这条命令里；`expectedRev` 随 NodeArtifact CAS 一并删除（D5） |
| 投影器对跨团队引用只 skip 不删键 | `admitMediaRef`（`media-binding-projector.ts:62`，`skip('cross-team')` 头注 :10） | doc 里的对方 id 会钉住引用——需要持久化执法腿（D5 步 7） |
| `server-forbidden` 放行点 | L1 `frame-deny.ts:222`；L2 `:442`、`:472`、`:499`、`:513` | 五处同批改为拒绝。禁止只改其中一处。翻禁在第③步 |
| 版本常量仍是 3，矩阵文件已经叫 V4 | `CANVAS_DOC_SCHEMA_VERSION`（`docShape.ts:57`）、`CLIENT_PROTOCOL_VERSION`（`constants/collab-protocol.ts:11`）均为 3。键矩阵在 `DOC_SCHEMA_V4` | 只把两个数字 bump 到 4。不新建 V5 矩阵文件 |
| 服务端执行交付已是 feed-only | `deliverArtifact` 只 append `exec.artifact`/`exec.status`，「禁回落 doc 写」（`collab-document.service.ts:293` 附近） | 第②步只清**客户端**固化写与本地 store 写，不涉及服务端交付改道 |
| 服务端仍有 `targetField='fileId'` 写点 | `targetFieldOfKind`（`node-artifact.service.ts:17`，非 text 产物→'fileId'）；`replaceMedia` 槽位（`collab-media.controller.ts:32/66/71`） | CHECK 改名的 census 必须含这两处，否则约束一收紧就断（D7） |
| 对象存储客户端无拷贝方法；配额门=Team 行锁 | `minio.service.ts`（仅 `buildKey`:54）；`lockTeamQuota`=`SELECT id FROM Team FOR UPDATE`（`storage-quota.service.ts:51`） | 拷贝腿在现有 S3Client 上新增同桶 CopyObject；配额在插行事务内重检（D5） |
| 对象删除按「被删 Media 行的键」删对象，不看是否还有别的行用同一键 | `deriveObjectDeletionSurface`（`project-erasure.objects.ts:57`） | 禁止两行 Media 共享对象键 |
| 远端投影 50ms 去抖，无 max-wait；本地 origin 已短路 | `canvasCollabRuntime.ts:2616`（setTimeout 50）；`onRemote` 对 LOCAL_ORIGINS/AutoEdge 先 return（:2590 附近——短路不 cancel 已挂定时器） | 保留 50ms idle，加 200ms max-wait；本地同步投影时取消在途远端定时器（D3） |
| cellNodes 的 fileId 是主画布通道键，公开快照不带 fileId | `CellNodeInfo.fileId`（`StoryboardCell.tsx:10`，经 useMediaUrl 现取）；公开通道剥 fileId 只注入 thumbnailUrl（`snapshot-filter.util.ts:138`） | 改名面=主画布通道键与子节点 `data.fileId` 读点；公开快照本体无 fileId（D7 勘正） |

行号是开工时的基线快照。实现中若漂移，以符号名为准，并在该步的第一条测试里重新钉住。

## 3 方案与终裁

### D1 投影形态：复用派生内核，主画布只做装配

考虑过两形态。

- 独立再写一套帧算法。公开页与主画布会分叉，直接违反 C1 的单源。否决。
- `projectCanvas` = `deriveRenderCanvas(readModel)` 的结果，再叠覆盖。帧与 hidden 剔除仍由共享内核完成。采用。

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

1. **gesture 折进记录再进内核**。叶子/顶层节点：会话中的 position / width / height 折入 records 副本。正在 resize 的组：该会话矩形作为该组的 `liveFrame` 传入 `deriveGroupFrame`——`deriveRenderCanvas` 增加这个可选入参（按组 id 索引；公开页不传，恒 undefined）。内核现行语义即所需：`liveFrame` 只被 manual/storyboard 值面消费、auto 恒派生——后贴的宽高不进组帧，storyboard 预览尺寸只认 liveFrame。禁止在内核输出之上叠一层「手势帧改写」——rel、hidden、cellNodes 都必须带着手势一次性算出。
2. `deriveRenderCanvas` 产出几何、rel、hidden 剔除、边过滤、cellNodes。
3. **墓碑剔除**：用现有 `isActiveTombstone` 谓词剔除运行时墓碑节点。这步今天由 `composeRenderModel` 做；删 `composeRenderFromNodeStore` 之后必须留在本链上，谓词不重写。
4. **执行覆盖**：有 `artifact.mediaId` 则显示用媒体 id 取它，否则取 doc 的 `data.mediaId`；`execStatus` 只来自投影。这条覆盖要**写进 cellNodes**——分镜子被 hidden 剔除、不在 React Flow 节点列表里，格子上的媒体与状态只能随组载荷走。doc 里不出现 `status` / `fileId`。
5. `mediaFacts` 只提供尺寸等事实，不改作者坐标，不写 doc。载体=既有 media-facts 批量通道与产物事件定向拉取（`mediaFactsRuntime` / `dispatchRuntimeArtifacts` sink），按 `mediaId` 取当前态；`factVersion` 是 Media 行全局单调计数快照（`schema.prisma:325`）、跨 factType 不可比——增量同步沿用既有定向拉取，本批不新造版本协议。

`composeRenderFromNodeStore` 随第①步删除。公开页继续直接调用 `deriveRenderCanvas`（现行锚：`ProcessSnapshot.tsx:87`），不改成走 `projectCanvas`。

**等价域**（对拍锚，写进测试名）：`gesture` 为空、`runtime` 为空、`mediaFacts` 为空、liveFrame 不传时，`projectCanvas` 的节点几何、parent、hidden 剔除、边集与 `deriveRenderCanvas` 逐位相等。运行时状态与手势不在这个等式里。

### D2 两份数据：作者缓存与渲染列表分开，桥只读作者缓存

`deriveRenderCanvas` 的输出是相对坐标，且不含分镜子与折叠子节点（dropped 集）。v1 的「store 持久域 = projectCanvas 输出」与「diff 只翻译作者字段」不能同时成立：store 若等于投影，下一轮 diff 会把隐藏子节点编成删除、把相对坐标当绝对坐标写回。采用两份数据：

- **作者缓存 = doc 读模型**：全部节点（含隐藏节点）、绝对坐标、parent、作者 data、边。`dispatchProjectionDiff` 只读这份。持久化出口继续用现成的 `toDocRecords` → `applyKeySetTable`，不另写一套剥键。
- **React Flow 列表 = `projectCanvas` 的输出**。只渲染，不进入 diff。

无手势时：作者缓存等于 doc；渲染列表等于 `projectCanvas(作者缓存, 空覆盖)`。复合写桥降级为：操作先改作者缓存 → `diffProjectionToIntents` 只翻译**作者字段**（增删节点、parent、abs position、作者 data 键、边）→ `dispatchCanvasIntent` 单事务写入 doc → 立刻用 `projectCanvas` 重填渲染列表。

diff **不得**把派生宽高、hidden、相对坐标编成 intent。组帧键规则=现行键集表，一字不改：auto/collapsed 组零帧键（**含 position**——v1「auto 组也持久 position」撤回，它会给 auto 组造出派生+持久两个原点）；storyboard 组只留 position；manual 组留宽高；「最后一名成员离开」时 `emptyGroupSealFrame` 保留，把当时的原点封成 manual 帧（`canvasStore.ts:1670` 现行语义）。

桥内删除：

- `dispatchProjectionDiff` 首行的 `reconcileGroupGeometry(doc, 'cs')`。
- `dispatchCanvasIntent` 尾的 `reconcileGroupGeometry(doc, 'doc')`。

同批删除的仲裁零件，不是另开卡：让位账本、`RECONCILE_EPS`、ratchet、`geometryTrap`、`assertReconcileSingleWriterWindow`、`reapplyGestureProtection`。四件前置按这个顺序做，避免假绿：

1. 先把假门禁改成会失败的测试（`geometryTrap` 只计数不抛、单写者窗口恒真），再删实现。
2. census 从「生产调用恰 4」改为「生产调用恰 0」，`ALLOW_FN` 白名单去掉 reconcile。
3. 现有几何测试改为对 `projectCanvas` 与 `deriveRenderCanvas` 对拍。禁止为了让旧测试编译而保留 reconcile 生产包装。
4. 字段闭环门禁（E17）与投影不变量改为新形态：doc 组记录零派生帧键；无手势会话时作者缓存≡doc 读模型、渲染列表≡`projectCanvas(作者缓存, 空覆盖)`。

新不变量见 §5-5。

### D3 增量：全量投影 + 逐字段对象身份复用

子节点一移动，auto 组的原点就变，兄弟节点的相对坐标一起变；折叠或分镜开关改变整棵子树的 hidden。v1 的「脏 id 加祖先组」重算集不含兄弟，必留过期几何——等于在 `deriveRenderCanvas` 旁边再写一套帧算法。否决。采用：

- 每次 doc 批次（`observeDeep` 事件批）都对**完整作者记录**调用 `deriveRenderCanvas`。
- 与上一帧输出逐字段比较：相等的节点复用原对象，输出数组浅建。仅变化项换新对象。
- 边的 `observeDeep` 与节点分开（现行即两个独立注册）：只改边时重跑边过滤，节点对象能复用则复用。
- 时序：远端=idle 50ms，自本轮第一个脏事件起 max-wait 200ms；本地作者事务=同步投影、不进去抖，**并取消尚未触发的远端定时器**，避免同一次编辑刷两次渲染列表（基线注记：现 `onRemote` 已对本地 origin 短路返回，但短路不 cancel 已挂定时器——本批补上）。

验收：单键编辑触发的 React 状态更新次数为 1；未编辑节点的对象身份不变。这两条就是验收。不设绝对毫秒门槛；同一次测试里，带复用的投影必须短于同夹具的**全量重建对照**（`applyDocToStore` 删除后以测试内等价全量路径为对照——全量投影+全新对象的工作量口径）。夹具不少于 200 个节点，数字写在该测试里。

### D4 手势：预览在 overlay，提交是事务前判定 + 恰一次 doc 事务

拖动与组 resize 已是松手提交。缺口是叶子 resize 仍走 `resizePending` 逐帧落点。第①步把它收成同一会话：移动过程只写 `gesture` 表，doc 零写。

会话与提交点：pointerdown 时 `setPointerCapture`。提交点（任一到达即提交，一次性标志保证只提交一次）：pointerup、pointercancel、pagehide、`visibilitychange` 且 `document.hidden`。

不变量检查在生产环境同样执行，且**在打开事务之前**：对「意图应用后的作者记录」做纯函数判定。Yjs 的 `transact` 内写操作即时生效、回调抛错不回滚已发生的写——检查放进事务是有窗形态。失败：不调用 transact，清掉 gesture，作者缓存与画布保持上一笔，经既有 `invariant_violation` 遥测通道上报（`collab-telemetry.ts` 十二值词表内）；不蒙层、不重试、不静默吞。成功：doc update 恰 1 次，然后清空 gesture，再用 `projectCanvas` 重填渲染列表。

硬崩溃丢掉进行中的手势，画布回到 doc 里的上一笔。接受（C2 已写明）。

### D5 跨团队粘贴：同一条 BindMedia，字节另存，槽位空到命令返回

项目只属于一个团队。跨团队粘贴不是「引用对方的 Media 行」。现状四个锚（:2 表）都在这条命令与它的调用方上改，不新路由、不恢复 CloneBinding：

1. **客户端**：副本节点先写入 doc，槽位上**没有媒体 id**。复制者屏幕上的预览来自本会话已拿到的字节，放在与 gesture 同类的本地表里，不进 doc。其他成员在命令完成前看到空槽。不写源 id 的乐观形态（v1 该句撤回——服务端执法腿在位时，乐观写会被删键打乒乓）。
2. **BindMedia 校验**：调用者是目标项目的编辑；源 Media 存在、ACTIVE、未软删；调用者是**源 Media 所属团队**的成员（新门——防凭 id 拿别队媒体）；源配对沿用现两腿（pairArtifact 三维对齐，或 doc 源节点引用兜底——粘贴不再产生 NodeArtifact 后，doc 腿为主）。
3. **同一团队**：不拷贝、不建行、不写 NodeArtifact，返回原 mediaId。
4. **另一团队**：同桶 CopyObject（`MinioService` 现无拷贝方法，在现有 S3Client 上补同桶拷贝）。`key`、非空的 `thumbnailKey`、非空的 `objectKey` 各拷到**新键**，新键走现有 `buildKey`。拷贝失败不建行。拷贝成功后在目标团队的配额事务里 `lockTeamQuota`、按源 size 重检配额、插入新 Media 行（teamId=目标团队，status=completed）。**插行失败则补偿删除刚拷出的新键**。S3 调用不进 PG 事务——顺序钉死：拷→插→（失败）补偿删。
5. **幂等**：命令体带客户端生成的 `commandId`。同一 `commandId` 重试返回已创建的 id，不第二次拷贝。`expectedRev` 随 NodeArtifact CAS 从这条命令删除（bindMedia 生产唯一调用方就是粘贴，`canvasStore.ts:580`）。
6. **收尾**：成功且返回 id 与槽位不同——客户端发一条 `updateNodeData`，只写 `data.mediaId`（同团队返回值相同，空操作）。失败：清本地预览，doc 槽位保持为空。
7. **持久化执法腿**：doc 帧级投影里 `admitMediaRef` 不通过的引用（恶意或错误客户端写入的跨团队/死 id），由服务端用现有 `SERVER_TRANSACT_ORIGIN` 删掉对应 data 键。这是执法点，不是新投影规则；计数用现有 binding skip 面。内容接口的团队成员检查（`MediaContentController` 经 findReadable）保持不动。

不共享对象键。现行删除面按被删行的键删对象，另一行若挂着同一键会被一起删掉。引用计数要改的是删除面，不属于 Y2。

### D6 canEdit：不再造新门

写 doc 的入口已经是 `dispatchCanvasIntent`：先 `canEditCommand`，再 `canEdit`。Y1b 已收 VIEWER 的四处写点。

第②步的出口包含一次 census：生产代码里写入 doc 的调用都经过这个函数。发现绕过的，就在本步改到漏斗上，不另开机制、不登记跟进。VIEWER 四处回归保持绿色。

### D7 schema 4：两个数字一起加，doc 不迁移

`CLIENT_PROTOCOL_VERSION` 与 `CANVAS_DOC_SCHEMA_VERSION` 同时从 3 改为 4。拒连形态沿用现在的 T18：`csv<4` → `schema-outdated` → 连接关闭；`CanvasDoc.schemaVersion ≠ 4` 的行拒载。不写 doc 字节级迁移。开发库里的 schema 3 行用既有世代重建 / 删行重置清掉，不在进程里改键名。旧 bundle 走现成的 `handleVersionTerminal` 一次重载。

矩阵仍是 `DOC_SCHEMA_V4` 这份对象。主槽 `mediaId: mediaLww()` 只加在现在写着 `fileId: forbidden()` 的四个类型上：`imageGen`（:131）、`imageExtGen`（:157）、`videoGen`（:191）、`audioGen`（:219）。`fileId: forbidden()` 保留——旧键的拒绝原因是 `forbidden-data-key`，不是含糊的未知键。`textInput`、`group`、`multiImageGen`、`videoEdit` 不加 `mediaId`。

`status`、`trimmedFileId`、`trimTaskStatus`、`nodeStatus` 保持 `forbidden()`，并把放行改为拒绝。`result` 在矩阵本无条目——写 `result` 键今天已是 unknown-key 拒，无翻禁动作。

**作者词表与三条 CHECK 收窄到六键**：`mediaId`、`referenceImage`、`referenceVideo`、`referenceAudio`、`images`、`allImages`。`trimmedFileId`、`videoFileId`、`audioFileId` 从词表（`MEDIA_REF_TARGET_FIELDS`）与 MediaBinding 的 CHECK 去掉——矩阵禁入、且 `videoFileId`/`audioFileId` 从不是 doc 键，它们是死词表。`NodeArtifact` 与 `ArtifactProjection` 的 CHECK 从 `'fileId','result'` 改为 `'mediaId','result'`。一条迁移先把三张 PG 表里的存量值 `'fileId'` 更新为 `'mediaId'`，再收紧 CHECK。开发库直接改约束；无用户数据，不做读分支。

**服务端 `targetField='fileId'` 写点同批换名**（census 必含，否则 CHECK 一收紧就断）：`targetFieldOfKind`（`node-artifact.service.ts:17`——非 text 产物映射，单点）；`replaceMedia` 槽位读写（`collab-media.controller.ts:32/66/71`）。

**读点改名面（勘正）**：cellNodes 的 fileId 是主画布通道键——`CellNodeInfo.fileId` 改为 `mediaId`（`StoryboardCell.tsx:10`）及其子节点 `data.fileId` 读点。公开快照本体**不带** fileId（泄漏红线剥除，只注入 thumbnailUrl）——`thumbnailUrl` 不动，公开读侧无改名动作。

**作者写与执行写分开**（否则实现者会把所有 `fileId` 赋值改名了事，执行态又写回 doc）：

- 用户放置（上传确认、粘贴、拖入分镜格、把已有图展开进格子）：写 `data.mediaId`，不写 `status`。
- 任务完成才出现的 id：不写 doc、不写本地 store 的 data 面。画面用 `RuntimeProjection.artifact.mediaId` 与 `execStatus`。服务端交付已经走 `exec.artifact`（T22 起 feed-only，「禁回落 doc 写」）——第②步清的是**客户端**固化写：`nodeStore.setStatus`/`setTrimTaskStatus`/`setTrimmedResult`/`updateMultiImageNodeStatus` 的 dispatch（:737/:898/:913/:861）、`canvasStore` 分镜展开与 `addImageToStoryboardCell` 的 `status:'done'+fileId`、`VideoGenNode` 分离结果固化两处（新建子节点携带 `fileId+status:'done'`）、复制/粘贴副本的 `fileId` 携带与读点（`rebindCopiedMedia` 的 `n.data.fileId` 面）、以及 `setFileResult` 的本地双 store 写（:753——`applyDataPatchToStores` 的 `fileId+status` 也删，画面只跟投影）。

**翻禁放第③步，最后做**：渲染出口（第①步）、写者与读者（第②步）都已离开 doc 之后才翻。否则一翻禁，画面就从 doc 读到空。v1 把翻禁放在片①与 D7 末行「读者离开后才翻」自相矛盾，本版改正。

## 4 四步（同一分支，一起部署）

### 第①步 投影与作者缓存分离

1. 红测试：空覆盖下 `projectCanvas` 几何必须对拍 `deriveRenderCanvas`（禁手写第二套帧）；墓碑剔除缺失用例；单键编辑 setState 次数断言（增量落地前失败）。
2. 实现 `projectCanvas`（D1 装配序五步）与 D3 全量+身份复用；`applyDocToStore` 不再做渲染出口。作者缓存与渲染列表两份数据落位（D2）。
3. 删 reconcile 四处与仲裁零件（D2 前置四步的顺序执行）。
4. 按 D4 把叶子 resize 会话化，`setPointerCapture`+四个提交点+一次性标志，生产断言常开且在事务前。
5. 删除 `composeRenderFromNodeStore`。

**出口：** 生产代码 `reconcileGroupGeometry(` 调用次数为 0；等价域逐位相等；墓碑用例绿；单键编辑 setState 为 1 且未改节点身份不变；任一手势 doc update 恰 1 次、事务前判定失败路径不写 doc；无手势时作者缓存≡doc、渲染列表≡`projectCanvas(作者缓存, 空覆盖)`。

### 第②步 写者改 mediaId，执行写离开 doc，读点迁移

1. census（D7 清单+服务端 targetField 两点+复制携带面）按作者/执行分档改完：客户端固化写全部消除，用户放置写 `data.mediaId`；`setFileResult` 本地 data 面写删除。
2. 组件读点迁移：节点组件改读 `RuntimeProjection`（经 `projectCanvas` 叠到渲染节点的字段，或直接读 runtime store）；不再订阅 `node:status` 画节点；cellNodes 主画布通道键换 `mediaId`。`CanvasTopBar` 的 credits 仍从 socket 的完整余额对象读，不动。
3. 跑 D6 census。

**出口：** 全仓生产写入不再出现这些禁键；`mediaId` 是主槽唯一作者键；没有读取 `fileId` 与 `mediaId` 两个名字的函数；`node:status` 的生产消费只剩余额。

### 第③步 翻禁 + 版本 4

1. 红测试先失败：帧内写入 `data.status` 或 `data.fileId` 期望连接因 `forbidden-data-key` 关闭——今天 `:222` 的 `continue` 让它失败不了；L2 四处各一条。另有一条 `csv=3` 被拒、`schemaVersion=3` 的行拒载。
2. `frame-deny.ts` 五处 `server-forbidden` 从跳过改为返回失败，reason 仍是 `forbidden-data-key`。
3. 双常量 bump 到 4。

**出口：** 上述红测试变绿；第①②步出口复核仍绿。

### 第④步 跨团队粘贴服务端腿

D5 步 2-7：校验+同团队直返/跨团队 CopyObject+配额重检+补偿删+`commandId` 幂等+客户端收尾+`SERVER_TRANSACT_ORIGIN` 执法腿。

**出口：** §6 D5 组全绿（跨团队返回新 id、新行 teamId 是目标团队、三把对象键与源行不同、源对象仍在、同 commandId 重试不二次拷贝、命令失败后 doc 不含源 id、同团队不拷贝字节）。

四步在同一分支完成后再部署。第③步单独合并时画面仍从 doc 读 `fileId`，翻禁后主槽为空——禁止单独部署。每步先红后绿，测试与该步同一次提交；不单独为旧测试编译保留已删除符号的生产包装。

## 5 不变量

1. doc 的 data 不含 `fileId`、`status`、`result`、`trimmedFileId`、`trimTaskStatus`、`nodeStatus`。
2. 用户放置的媒体 id 只写在 `data.mediaId`，非主槽只允许矩阵仍允许的五个键：`referenceImage`、`referenceVideo`、`referenceAudio`、`images`、`allImages`。
3. 显示中的执行状态只来自运行时投影。显示中的媒体 id：有 artifact 用 artifact，否则用 `data.mediaId`。
4. 组帧只由 `deriveGroupFrame` 计算。doc 组记录零派生帧键：auto/collapsed 组零帧键（含 position）、storyboard 只留 position、manual 留宽高；空组离开时 `emptyGroupSealFrame` 密封 manual。
5. 无手势会话时：作者缓存≡doc 读模型；渲染列表≡`projectCanvas(作者缓存, 空覆盖)`。手势进行中，屏幕上多出来的部分只来自 `gesture` 参数。
6. 一次手势对应恰好一次 doc 事务，且事务开在前置纯函数判定通过之后。
7. 跨团队粘贴之后：doc 槽位里的 id 属于目标团队的 Media 行；该行的三把对象键不与源行相同；源对象仍在。

## 6 测试载体

每步先红后绿，测试与该步同一次提交。几何与增量用现有 canvas 单测与 collab 装置，不新造一套只在本地手动跑的门禁。

必有的失败先行用例：

- 第①步：等价域逐位相等（含 liveFrame 不传形态）；墓碑剔除；单键 setState 次数；手势 doc update 次数与事务前判定失败不写 doc；生产 reconcile 调用计数为 0；带复用投影短于同夹具全量对照（≥200 节点）。
- 第②步：作者放置写入并读回 `mediaId`；`setFileResult` 路径不再写 doc 也不写本地 data 面；节点状态在没有 `node:status` 时仍随投影变化；余额订阅仍在；服务端 targetField 写点随 CHECK 换名。
- 第③步：`fileId` 与 `status` 写入被 L1、L2 拒绝；`csv=3` 拒连；PG `schemaVersion=3` 拒载。
- D5：跨团队 BindMedia 返回新 id；新行 `teamId` 是目标团队；新对象键与源键不同；源对象仍在；同 `commandId` 重试返回已建 id 不二次拷贝；命令失败后 doc 不含源 id；同团队 BindMedia 不拷贝字节不建行不写 NodeArtifact；执法腿删键用例（跨队 id 写入 doc 后被持久化路径清除）。
- 回归锚（非本批新机制）：单人团队 awareness 双向短路（Y0b-4 T13 既有测试）维持绿——本批不触碰 awareness 面，防改动被误判为恢复了广播。

77 个文件名命中与 125 处内容命中是重写成本，不是保留 reconcile 的理由。对拍替换之后，仍直接调用已删除函数的测试删掉或改调用 `projectCanvas`。

## 7 RPO / RTO / 观测 / CI

- **RPO：** 不变。持久化路径不改（执法腿只是把本就非法的键清掉，不改变合法投影的写入）。
- **RTO：** 旧页面一次重载换到 csv=4 的包（现成版本终态）。schema 3 的 doc 行拒载后，开发环境走世代重建或删行，不在线改字节。没有需要保留的用户画布。
- **观测：** 不新造指标。拒绝必须走现有关连接计数，reason 带 `forbidden-data-key`。投影耗时继续用现有 `projection_duration` 诊断。预算放在 CI 断言里（D3 对照形态）。
- **CI：** 四步的红转绿用例进现有 verify。没有 CI 跑的断言不算出口。

## 8 留给实现者

- 增量夹具的节点数（≥200）与对照的具体口径写在第①步测试里，阈值不得宽于全量对照的量级。
- `gesture` 表与粘贴本地预览表放哪个模块，只要 `projectCanvas` 的第四个参数是 gesture 唯一读点、松手清空、且都不写回 doc。
- 字节拷贝顺序钉死为「拷→插→（失败）补偿删」，S3 不进 PG 事务；配额门=既有 `lockTeamQuota` Team 行锁内按源 size 重检。

## 9 与总目录的关系

总目录仍是批次顺序的唯一依据。本文件是 Y2 的规格（v2）。目录里「CopyMedia」没有落点，以本文 D5 为准。目录 Y2 行的 spec 列指向本文件。
