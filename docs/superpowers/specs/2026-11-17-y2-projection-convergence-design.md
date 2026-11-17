<!-- doc-status: active | created: 2026-11-17 | confirmed: 2026-11-17（用户授权按项目现实终裁，不另行仲裁；D1–D7 为本文终裁）；同日实现侧锚核：§2 锚全中+五处修订；同日 v2：第三轮外部终裁稿（F1–F8+维持清单）逐锚核实成立、用户确认落盘——装配序（gesture 折入+liveFrame 进内核+墓碑步）/作者缓存与渲染列表两份数据/全量投影+身份复用/不变量事务前判定/跨团队粘贴重写（空槽+commandId 幂等+持久化执法腿）/翻禁移至第③步/词表收窄六键/拷贝=拷→插→补偿；另补四处（服务端 targetField 写点 census/CellNodeInfo 改名面勘正/T22 feed-only 现状锚/去抖基线注记）；撤回 v1 两处错断（「auto 组也持久 position」「乐观写源 id」）；同日 v2.1：第四轮外部终裁七条逐锚核实成立落盘——墓碑改进内核**前**剔除（v2 装配序 bug）/渲染列表独立接线（nodes 保持作者缓存）/CANVAS_BRIDGE_KEYS 桥白名单收口/schemaVersion @default(3) 同批改 4/配额门复用 assertCanUploadInTx+Media.bindCommandId 幂等列/执法腿宿主钉 doc 持有会话非投影器/hidden 属性写机制退役+分镜现拼扫描删除+格子 referenceImage 兜底退役；同日 v2.2：第五轮外部终审六条逐锚核实成立落盘（含我方三注记）——D8 主槽唯一解析函数 resolvePrimaryMediaId+生成替代删键（撤 v2.1「有产物用产物」优先序）/粘贴填槽收归驻留会话条件写+NodeArtifact 护栏行（推翻第四轮「命令不写 NodeArtifact」——槽竞争窗 GC 护栏）/拷贝改占坑先行 pending 行（推翻「拷→插→补偿」——崩溃幂等锚）/执法腿三条（SERVER_TRANSACT_ORIGIN=maintenance 档落库、删键后直调 projectBindings、装入同谓词重扫）/第②步 census 补六符号+CHECK 与写者同一次提交（F6 约束机理）/装配约束四条+出口用例七条 -->
# Y2 投影消费收口 设计 spec

> 范围：A 类单独立项。四步按序做在同一分支，每步有独立出口，四步一起部署——第③步（翻禁+版本 4）单独上线时画面主槽为空，禁止单独部署。依据=总目录 v11 Y2 行 + 裁决 A1 / C1 / C3 / C5 / D3 / D6 / E67 + 本文对现库的复核。
> 开发测试档无用户画布需要保留。禁止 normalizer、双键读、影子双跑、版本分支、以及「先留着以后再删」的垫片。

## 0 本文解决什么

画布的作者态在 Y.Doc，执行态在 RuntimeEvent，渲染必须是纯函数。现在渲染仍由 `applyDocToStore` 全量灌进 zustand，再由 `reconcileGroupGeometry` 把 store 与 doc 仲裁回同一套坐标。主槽 `fileId` 与执行态 `status` 仍写在 doc 里，而 `frame-deny` 对 `server-forbidden` 只登记、不拒绝。Y2 把这三件事收成一条链：schema 4 只接受作者键，`projectCanvas` 是唯一渲染出口，主槽由唯一解析函数裁决，节点状态与产物从运行时投影读，余额仍走现有 socket。

## 1 目标 / 非目标 / 反目标

**目标**

1. 协议与 doc 版本 3→4 硬切。主槽作者键为 `mediaId`。`server-forbidden` 全键族在 L1 与 L2 都拒绝。
2. `projectCanvas` 成为主画布唯一渲染出口。`reconcileGroupGeometry` 生产调用为 0。帧算法仍是 `deriveGroupFrame`。
3. 主槽显示与上游注入由全仓唯一的 `resolvePrimaryMediaId` 裁决（D8）。节点上的执行状态与产物从 `RuntimeProjection` 读。余额继续从 socket 的 credits 对象读，留到 Y3。

**非目标**

- 不删 `/execution`，不把余额改成 REST（Y3）。
- 不重写 14 处复合写路径为 intent-first（桥保留，见 D2）。
- 不改对象删除面的引用计数（跨团队粘贴改为字节拷贝，避免踩现行删除面，见 D5）。
- 不恢复单人团队的 awareness 广播。
- 不新建名为 CopyMedia 的路由。仓内无此 API。

**反目标**（做成了也算失败）

- 为 schema 3 文档写键重命名器，或读路径同时认 `fileId` 与 `mediaId`。
- 再实现一套组帧公式，使公开页与主画布各算各的。
- 主槽出现第二份判定逻辑（画面、格子、缩略图、上游各算各的）。
- 删掉 reconcile 之后，diff 桥继续把派生宽高、hidden、相对坐标写回 doc 当权威。
- 跨团队粘贴把源团队的对象键挂到目标团队的新 Media 行上；或新行在任何窗口内处于零护栏状态。
- 任何时刻把对方团队的 media id 写进 doc「图先显示着」——包括命令在途的乐观形态。

## 2 现库锚（2026-11-17 复核）

| 事实 | 锚 | 对 spec 的后果 |
| --- | --- | --- |
| `composeRenderFromNodeStore` 存在，读 `useNodeStore`，生产调用为零 | `apps/web/src/stores/runtimeStore.ts:228` | 它是 `projectCanvas` 要换掉的种子，本批删除，不改成第二出口 |
| reconcile 生产调用恰 4 处 | `canvasCollabRuntime.ts:1789`（`applyDocToStore` 尾）、`canvasIntents.ts:459`（漏斗尾 `source:'doc'`）、`canvasIntents.ts:662`（diff 桥首行 `source:'cs'`）、`canvasStore.ts:1739` | 出口锚=这 4 处消失。测试里的直接调用随套件重写，不算生产调用 |
| 复合写仍是 capture → mutate → `dispatchProjectionDiff` | `canvasStore.ts` 批 4b-2 换芯；漏斗=`dispatchCanvasIntent`（`canvasIntents.ts:432`）先过 `canEditCommand` 再过 `canEdit` | 桥保留。桥内两处 reconcile 删除 |
| `CANVAS_BRIDGE_KEYS` 桥白名单现行含 fileId/status | `docShape.ts:66`（`{fileId,referenceImage,status,images}`）；`nodeStore.ts:312` 据此把补丁桥进 cs 镜像——cs 是 diff 桥的基面 | 第②步收成 `{mediaId,referenceImage,images}`。否则禁键经桥回流 doc，第③步翻禁=自己的桥关自己的连接 |
| `deriveRenderCanvas` 输出=相对坐标、剔隐藏子树、内部生成 cellNodes | `renderCanvas.ts:40`（签名只收 `{records,edges}`）；「子 rel=abs−本遍新 origin」:4；`dropped` 剔除 :94-103；cellNodes :120 | 投影输出**不能**回灌 diff/持久域——作者缓存与渲染列表必须是两份数据（D2） |
| `deriveGroupFrame` 有 `liveFrame` 入参，但 `deriveRenderCanvas` 不传 | `geometry.ts:147`（manual/storyboard 值面消费、auto 恒派生，:142-146；`liveFrame?.width ?? size` :162）；`frameOf` 组装时不传（renderCanvas.ts:78-84） | 手势矩形经新增可选参数进内核（D1）；后贴宽高不进组帧 |
| 墓碑剔除今天在 `composeRenderModel`，且是**进合成前**丢整节点 | `runtime-projection.ts:108`（`isActiveTombstone`）、:184（迭代 readModel 即 continue） | 谓词不重写，且必须**进内核之前**剔除（D1 步 1）——否则死节点撑大 auto 组帧、留在 cellNodes |
| 键集表已规定组帧键规则 | `applyKeySetTable`（`docShape.ts:248`）：auto/collapsed 组=0 帧键（含 position）、storyboard 只留 position、manual 留宽高 | v1「auto 组也持久 position」与现行键集表矛盾，撤回（D2/不变量 4） |
| hidden 是 `applyDocToStore` 写的节点属性 | `deriveHiddenMap`/`edgeHidden`（`groupDerive.ts:10`；`canvasCollabRuntime.ts:1559` 写 `hidden:true`）——判定只吃 doc data（localCollapsed 不进隐藏） | 渲染列表换轨后该机制随出口退役，可见集合由内核剔除承担（内核自注「可见集合≡deriveHidden 不可见集合」——等价）。禁保留双轨 |
| 上游读点有两份写死 `'fileId'` 的 NodeArtifact 槽 SQL | `UpstreamMediaService.readUpstreamMediaId`（`upstream-media.service.ts:34`）；`ExecutionRequestService.readUpstreamMediaId`（`execution-request.service.ts:241`，注释自认「同源键形态」） | 两份 SQL 消失，收敛到 `resolvePrimaryMediaId`（D8）——禁留第二份 |
| 公开缩略图=产物优先回落 `data.fileId` | `computeThumbnailUrls`（`video-work.service.ts:347-352`，注释自书「T22 后 fileId 是陈旧面」）；公开过程页消费 join 后的 render model（`composeRenderModel`） | 回落改走解析函数；公开页不走 `projectCanvas`；收集函数改对，公开分镜即有图（D8/第②步） |
| 主槽展示兜底仍是 `fileId \|\| referenceImage` | `imageNodeGuards.ts:14`；`canvasStore.ts:1964`（分镜展开） | 改调解析函数；referenceImage 不再充当主槽兜底（D8）——否则只带参考图的节点主槽变空 |
| CopyMedia 不存在。粘贴命令是 `BindMedia`，现写 NodeArtifact、跨队 403、客户端不读返回值 | `POST /api/projects/:projectId/collab/bindings`（`collab-binding.controller.ts:37`）；跨队 403 :77；NodeArtifact `targetField:'fileId'` 写 :108/:128；`rebindCopiedMedia`（`canvasStore.ts:568`，bindMedia 生产唯一调用方 :580）fire-and-forget 失败留源 id | 跨团队腿做在这条命令里；`expectedRev` 删除（D5） |
| 投影器对跨团队引用只 skip 不删键，且拿不到 Y.Doc | `admitMediaRef`（`media-binding-projector.ts:62`，`skip('cross-team')` 头注 :10；projectBindings 输入=tx+引用增量） | doc 里的对方 id 会钉住引用——执法腿放在 doc 持有会话（D5），不进投影器 |
| doc 写 origin 分档在库：`server-direct`=仅告警；维护帧无投影面 | `classifyDocUpdateOrigin`（`collab-persistence.service.ts:221-261`——server-direct 观测面非阻断）；`canvas-doc-update.repository.ts:197`（void 返回=调用方无投影面，维护帧在内）；直调先例=`binding-rebuild.service.ts:136` 分页短事务直调 projectBindings | 删键/执法必须 SERVER_TRANSACT_ORIGIN（maintenance 档会落库）；删后必须直调 projectBindings——只删 Y.Doc 键，绑定行会钉住旧对象直到下一次用户编辑（D5/D8） |
| GC 护栏=引用图；`MediaBinding.targetField @default("fileId")` | `media-gc.service.ts`（guarded 族引用护栏——MediaBinding/NodeArtifact/作品/视频工程引用）；`schema.prisma` MediaBinding 行 | 粘贴新行必须有即时护栏（NodeArtifact 行，D5）；targetField 默认值随 CHECK 同批改（F6） |
| `server-forbidden` 放行点 | L1 `frame-deny.ts:222`；L2 `:442`、`:472`、`:499`、`:513` | 五处同批改为拒绝。禁止只改其中一处。翻禁在第③步 |
| 版本常量与列默认仍是 3，矩阵文件已经叫 V4 | `CANVAS_DOC_SCHEMA_VERSION`（`docShape.ts:57`）、`CLIENT_PROTOCOL_VERSION`（`constants/collab-protocol.ts:11`）均为 3；`CanvasDoc.schemaVersion` 列 `@default(3)`（`schema.prisma:898`） | 两个数字与列默认**三件同批**改 4（漏写该列的插入会落 3、下轮装载被拒）。不新建 V5 矩阵文件 |
| 服务端执行交付已是 feed-only；生成 CAS 锚在 NodeArtifact.rev；冻结切片含 data | `deliverArtifact` 只 append 事件，「禁回落 doc 写」（`collab-document.service.ts:293` 附近）；NodeArtifact「rev=finalize/replace/clear CAS 锚」（schema 自注）；`buildFrozenSlice`/`readSlice`（`execution-request.service.ts`） | 生成替代删键的判定载体全在（D8）；第②步只清**客户端**固化写，服务端交付不改道 |
| 服务端仍有 `targetField='fileId'` 写点 | `targetFieldOfKind`（`node-artifact.service.ts:17`，非 text 产物→'fileId'）；`replaceMedia` 槽位（`collab-media.controller.ts:32/66/71`） | CHECK 改名的 census 必须含这两处，否则约束一收紧就断（D7） |
| 对象存储客户端无拷贝方法；配额真门在事务内 | `minio.service.ts`（仅 `buildKey`:54）；`assertCanUploadInTx(tx,teamId,incomingBytes)`（`storage-quota.service.ts:59`——内部 `lockTeamQuota`:51+usage+ΣACTIVE 预留+incoming 三段和） | 拷贝腿在现有 S3Client 上新增同桶 CopyObject（单对象上限 2GB，一次调用够用）；配额复用现有真门，不另写公式（D5） |
| 对象删除按「被删 Media 行的键」删对象，不看是否还有别的行用同一键 | `deriveObjectDeletionSurface`（`project-erasure.objects.ts:57`） | 禁止两行 Media 共享对象键 |
| 远端投影 50ms 去抖，无 max-wait；本地 origin 已短路 | `canvasCollabRuntime.ts:2616`（setTimeout 50）；`onRemote` 对 LOCAL_ORIGINS/AutoEdge 先 return（:2590 附近——短路不 cancel 已挂定时器） | 保留 50ms idle，加 200ms max-wait；本地同步投影时取消在途远端定时器（D3） |
| cellNodes 的 fileId 是主画布通道键，公开快照不带 fileId | `CellNodeInfo.fileId`（`StoryboardCell.tsx:10`，经 useMediaUrl 现取）；主画布分镜现拼扫描在 `GroupNode.tsx:68-76`（`fileId\|\|referenceImage`+status，消费内核 cellNodes 的只有公开通道） | 改名面=主画布通道键与子节点 `data.fileId` 读点；公开快照本体无 fileId（D7 勘正）。现拼扫描随第①步删除（D1 步 4） |

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

1. **墓碑前置剔除**：先从记录副本去掉活动墓碑（谓词=现有 `isActiveTombstone`，不重写——`composeRenderModel` 现行次序就是进合成前丢整节点），再把剩余记录送进内核。死节点不进内核，才不会撑大 auto 组帧、不会留在 cellNodes 里。对着墓碑节点的手势项不折入。悬空边由内核既有过滤去掉。
2. **gesture 折进记录再进内核**。叶子/顶层节点：会话中的 position / width / height 折入 records 副本。正在 resize 的组：该会话矩形作为该组的 `liveFrame` 传入 `deriveGroupFrame`——`deriveRenderCanvas` 增加这个可选入参（按组 id 索引；公开页不传，恒 undefined）。内核现行语义即所需：`liveFrame` 只被 manual/storyboard 值面消费、auto 恒派生——后贴的宽高不进组帧，storyboard 预览尺寸只认 liveFrame。禁止在内核输出之上叠一层「手势帧改写」——rel、hidden、cellNodes 都必须带着手势一次性算出。
3. `deriveRenderCanvas` 产出几何、rel、hidden 剔除、边过滤、cellNodes。
4. **执行覆盖（主槽与状态走 D8 解析）**：显示用媒体 id=「作者键 `data.mediaId` 非空用它，否则运行时产物」；`execStatus` 只来自投影。这条覆盖要**写进 cellNodes**——分镜子被 hidden 剔除、不在 React Flow 节点列表里，而内核产出的格子只有 id/thumbnailUrl/slot：执行覆盖必须**按格子 id 回到剔除前的作者记录**上取 `data.mediaId`/产物再写进 cellNodes——只遍历 React Flow 输出节点，格子是空的。主画布分镜改为只消费这份 cellNodes（删除 GroupNode 现行的 store 二次扫描——见第①步）；`CellNodeInfo.fileId` 改名 `mediaId`。doc 里不出现 `status` / `fileId`。
5. `mediaFacts` 只提供尺寸等事实，不改作者坐标，不写 doc。载体=既有 media-facts 批量通道与产物事件定向拉取（`mediaFactsRuntime` / `dispatchRuntimeArtifacts` sink），按 `mediaId` 取当前态；`factVersion` 是 Media 行全局单调计数快照（`schema.prisma:325`）、跨 factType 不可比——增量同步沿用既有定向拉取，本批不新造版本协议。

`localCollapsed`（viewer 本地折叠 override）今天就不进隐藏判定（`deriveHiddenMap` 只吃 doc data），本批不把它塞进 `projectCanvas`。

`composeRenderFromNodeStore` 随第①步删除。公开页继续直接调用 `deriveRenderCanvas`（现行锚：`ProcessSnapshot.tsx:87`），不改成走 `projectCanvas`。

**等价域**（对拍锚，写进测试名）：`gesture` 为空、`runtime` 为空、`mediaFacts` 为空、liveFrame 不传时，`projectCanvas` 的节点几何、parent、hidden 剔除、边集与 `deriveRenderCanvas` 逐位相等。运行时状态与手势不在这个等式里。

### D2 两份数据：作者缓存与渲染列表分开，桥只读作者缓存

`deriveRenderCanvas` 的输出是相对坐标，且不含分镜子与折叠子节点（dropped 集）。v1 的「store 持久域 = projectCanvas 输出」与「diff 只翻译作者字段」不能同时成立：store 若等于投影，下一轮 diff 会把隐藏子节点编成删除、把相对坐标当绝对坐标写回。采用两份数据：

- **作者缓存 = doc 读模型**：全部节点（含隐藏节点）、绝对坐标、parent、作者 data、边。`dispatchProjectionDiff` 只读这份。持久化出口继续用现成的 `toDocRecords` → `applyKeySetTable`，不另写一套剥键。**store 管线**：`nodes` 继续作为作者缓存——diff 桥、组缩放的最小尺寸（`calcGroupMinSize` 读绝对坐标）、组渲染的 data 面都继续读它；React Flow 改接画布状态上另一份渲染列表（`renderNodes`，命名实现者定），`CanvasView` 不再把 `nodes` 直接交给 ReactFlow。
- **React Flow 列表 = `projectCanvas` 的输出**。只渲染，不进入 diff。可见集合由内核剔除承担——今天 `applyDocToStore` 里 `deriveHiddenMap` 写 `hidden:true` 属性+`edgeHidden` 的机制随出口换轨退役（行为等价），禁保留双轨。

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

同名异构点名：`projectCanvasNodes`（`apps/web/src/utils/`）是 doc 写入前的 EPHEMERAL 剥键适配（投影快照与漏斗入口共用），与本批的 `projectCanvas` 不是同一个函数，第①步不删。

新不变量见 §5-5。

### D3 增量：全量投影 + 逐字段对象身份复用

子节点一移动，auto 组的原点就变，兄弟节点的相对坐标一起变；折叠或分镜开关改变整棵子树的 hidden。v1 的「脏 id 加祖先组」重算集不含兄弟，必留过期几何——等于在 `deriveRenderCanvas` 旁边再写一套帧算法。否决。采用：

- 每次 doc 批次（`observeDeep` 事件批）都对**完整作者记录**调用 `deriveRenderCanvas`。
- 与上一帧输出逐字段比较：相等的节点复用原对象，输出数组浅建。仅变化项换新对象。**身份复用发生在执行覆盖写完之后**——比较对象是上一帧**最终渲染对象**（含写进 cellNodes 的覆盖）；格子内容未变时组节点复用上一帧对象，包括原来的 cellNodes 引用。
- 边的 `observeDeep` 与节点分开（现行即两个独立注册）：只改边时重跑边过滤，节点对象能复用则复用。
- 时序：远端=idle 50ms，自本轮第一个脏事件起 max-wait 200ms；本地作者事务=同步投影、不进去抖，**并取消尚未触发的远端定时器**。同步投影读的是这笔事务之后的 `toReadModel(doc)`，同时写作者缓存与渲染列表——读滞后的 zustand 再去取消定时器，会丢掉已经进文档、还没进 store 的远端更新（基线注记：现 `onRemote` 已对本地 origin 短路返回，但短路不 cancel 已挂定时器——本批补上）。

验收：单键编辑触发的 React 状态更新次数为 1；未编辑节点的对象身份不变（身份复用比较的对象是**上一帧最终渲染对象**的值，不是内核当次新分配的对象）。夹具不少于 200 个节点且含一个分镜组；格子内容未变时，该组节点对象必须被复用。不设绝对毫秒门槛；同一次测试里，带复用的投影必须短于同夹具的**全量重建对照**（`applyDocToStore` 删除后以测试内等价全量路径为对照——全量投影+全新对象的工作量口径），数字写在该测试里。

### D4 手势：预览在 overlay，提交是事务前判定 + 恰一次 doc 事务

拖动与组 resize 已是松手提交。缺口是叶子 resize 仍走 `resizePending` 逐帧落点。第①步把它收成同一会话：移动过程只写 `gesture` 表，doc 零写。

会话与提交点：pointerdown 时 `setPointerCapture`。提交点（任一到达即提交，一次性标志保证只提交一次）：pointerup、pointercancel、pagehide、`visibilitychange` 且 `document.hidden`。

不变量检查在生产环境同样执行，且**在打开事务之前**：对「意图应用后的作者记录」做纯函数判定。判定与 transact 在同一次同步调用里、中间没有 await；一次手势的所有脏节点同一次事务。Yjs 的 `transact` 内写操作即时生效、回调抛错不回滚已发生的写——检查放进事务是有窗形态。失败：不调用 transact，清掉 gesture，作者缓存与画布保持上一笔，经既有 `invariant_violation` 遥测通道上报（`collab-telemetry.ts` 十二值词表内）；不蒙层、不重试、不静默吞。成功：doc update 恰 1 次，然后清空 gesture，再用 `projectCanvas` 重填渲染列表。

硬崩溃丢掉进行中的手势，画布回到 doc 里的上一笔。接受（C2 已写明）。

### D5 跨团队粘贴：BindMedia 驻留会话写槽，拷贝占坑先行

项目只属于一个团队。跨团队粘贴不是「引用对方的 Media 行」。v2.1 的客户端回写有两个洞：Yjs map 后写获胜——命令在途时另一成员写入槽位，返回后的那一笔会盖掉他；客户端写回前崩溃——新 Media 行零护栏，对象与配额一起没。填槽收归服务端。现状锚（§2 表）都在这条命令与它的调用方上改，不新路由、不恢复 CloneBinding：

1. **客户端**：副本节点先写入 doc，槽上**没有媒体 id**。命令体带源 id（取当前画面的解析值：作者键非空用作者键，否则产物）与客户端生成的 `commandId`；源 id 不进 doc。复制者屏幕上的预览来自本会话已拿到的字节，放在与 gesture 同类的本地表里，不进 doc。
2. **校验**：调用者是目标项目的编辑；源 Media 存在、ACTIVE、未软删；调用者是**源 Media 所属团队**的成员（防凭 id 拿别队媒体）；源配对沿用两腿——源上的 NodeArtifact 三维对齐，或 doc 源节点引用兜底（词表六键后，doc 腿扫的是 `mediaId`）。
3. **同一团队**：不拷贝、不建行，返回原 id。
4. **跨团队拷贝=占坑先行**（顺序钉死，S3 不进 PG 事务）：
   - 幂等查 `(teamId, bindCommandId)`：命中且 completed→返回已有 id，不再拷贝；命中且 pending→沿用行上新键继续，不生成第二套键；同一 `commandId` 的源媒体/源团队/目标项目任一不同→409。
   - 事务内 `assertCanUploadInTx(tx, 目标团队, Number(源.size))`，插入 **pending** Media 行（写上新键与 `bindCommandId`）后提交。`size` 只在这次调用边界转 number，列保持 BigInt（单对象上限 2GB 内安全）。不另写配额公式。
   - 按源键去重后同桶 CopyObject（元数据随对象复制）：`key`、非空 `thumbnailKey`、非空 `objectKey` 若指向同一对象，新行仍指向同一把新键；新键走现有 `buildKey`。
   - 拷贝成功→把行标成 completed、`probeState` 置 pending（现有探针重算事实，**不复制 MediaFact 行**）。
   - 拷贝失败或完成标记失败→删掉已拷出的新键、删掉 pending 行。
5. **新行字段**：`teamId`=目标团队、`userId`=调用者、`status`=completed、`deletionState`=ACTIVE；复制 `mimeType`、`size`、`originalName`、`type`、`naturalWidth`/`naturalHeight`、`sniffedMimeType`、`objectSha256`；不复制文件夹、收藏与资金血缘列（`projectId`/`nodeId`/`taskId` 等关联列不随行）。幂等锚=Media 可空列 `bindCommandId`+唯一约束 `(teamId, bindCommandId)`（PG 多 NULL 相容）；不复用 `clientUploadId`/`sourceRegistrationKey`（各有既有语义）。`expectedRev` 随 CAS 删除（bindMedia 生产唯一调用方=粘贴，`canvasStore.ts:580`）。
6. **GC 护栏行**：同一 PG 事务把目标节点的 NodeArtifact 主槽写成返回 id（`targetField='mediaId'`；不写 exec.status、不建 ArtifactProjection——粘贴不得被标成「生成完成」）。此行是 doc 槽竞争窗内新行的唯一护栏。常规用户放置**不加**命令腿：放置的护栏=doc 键→帧级投影→MediaBinding（见 D8 注）。
7. **doc 槽由驻留会话条件写**：在已持有该文档的驻留会话里开一笔 `SERVER_TRANSACT_ORIGIN` 事务——槽仍为空才写 `data.mediaId`；槽已有值不覆盖，响应带「槽已被占」分档。客户端不发第二笔 `updateNodeData`；本地预览表在命令失败或槽被占时清掉，成功时等 doc 回放。
8. **持久化执法腿**（三条现库约束，缺一删了等于没删）：
   - 事务 origin 必须=现有 `SERVER_TRANSACT_ORIGIN`——它在 `classifyDocUpdateOrigin` 里归 maintenance 档、会落库；在控制器里另开 DirectConnection 会落成 `server-direct` 档（仅告警），还可能写到另一份文档实例上。
   - 这次更新必须进 projectBindings：跨团队引用当帧已被 skip（绑定行本来不在），同团队的过期主键要靠这次更新把绑定行删掉——直调先例=`binding-rebuild.service.ts:136` 分页短事务直调（维护帧本身无投影面，`canvas-doc-update.repository.ts:197`）。
   - **装入重扫**：进程若在用户帧落库之后、执法事务之前崩溃，非法键会留在已持久化的更新里。文档被驻留会话装入时，用同一个 `admitMediaRef` 谓词扫一遍主槽与五个作者媒体键——同一条执法，不是第二套规则；键已不在=空操作。
   - 同一连接在一个短窗口里反复写入会被删掉的键，关闭连接。计数用现有 binding skip 面。内容接口的团队成员检查（`MediaContentController` 经 findReadable）保持不动。

不共享对象键。现行删除面按被删行的键删对象，另一行若挂着同一键会被一起删掉。引用计数要改的是删除面，不属于 Y2。

### D6 canEdit：不再造新门

写 doc 的入口已经是 `dispatchCanvasIntent`：先 `canEditCommand`，再 `canEdit`。Y1b 已收 VIEWER 的四处写点。

第②步的出口包含一次 census：生产代码里写入 doc 的调用都经过这个函数。发现绕过的，就在本步改到漏斗上，不另开机制、不登记跟进。VIEWER 四处回归保持绿色。

### D7 schema 4：两个数字一起加，doc 不迁移

`CLIENT_PROTOCOL_VERSION` 与 `CANVAS_DOC_SCHEMA_VERSION` 同时从 3 改为 4。拒连形态沿用现在的 T18：`csv<4` → `schema-outdated` → 连接关闭；`CanvasDoc.schemaVersion ≠ 4` 的行拒载。不写 doc 字节级迁移。开发库里的 schema 3 行用既有世代重建 / 删行重置清掉——**禁止只把 `schemaVersion` 列改成 4 而留下仍含旧键的 Y.Doc 字节**。旧 bundle 走现成的 `handleVersionTerminal` 一次重载。

矩阵仍是 `DOC_SCHEMA_V4` 这份对象。主槽 `mediaId: mediaLww()` 只加在现在写着 `fileId: forbidden()` 的四个类型上：`imageGen`（:131）、`imageExtGen`（:157）、`videoGen`（:191）、`audioGen`（:219）。`fileId: forbidden()` 保留——旧键的拒绝原因是 `forbidden-data-key`，不是含糊的未知键。`textInput`、`group`、`multiImageGen`、`videoEdit` 不加 `mediaId`。

`status`、`trimmedFileId`、`trimTaskStatus`、`nodeStatus` 保持 `forbidden()`，并把放行改为拒绝。`result` 在矩阵本无条目——写 `result` 键今天已是 unknown-key 拒，无翻禁动作。

**作者词表与三条 CHECK 收窄到六键**：`mediaId`、`referenceImage`、`referenceVideo`、`referenceAudio`、`images`、`allImages`。`trimmedFileId`、`videoFileId`、`audioFileId` 从词表（`MEDIA_REF_TARGET_FIELDS`）与 MediaBinding 的 CHECK 去掉——矩阵禁入、且 `videoFileId`/`audioFileId` 从不是 doc 键，它们是死词表。`NodeArtifact` 与 `ArtifactProjection` 的 CHECK 从 `'fileId','result'` 改为 `'mediaId','result'`。`MediaBinding.targetField` 的 `@default("fileId")` 同批改 `mediaId`。一条迁移先把三张 PG 表里的存量值 `'fileId'` 更新为 `'mediaId'`，再收紧 CHECK。开发库直接改约束；无用户数据，不做读分支。

**服务端 `targetField='fileId'` 写点同批换名**（census 必含，否则 CHECK 一收紧就断）：`targetFieldOfKind`（`node-artifact.service.ts:17`——非 text 产物映射，单点）；`replaceMedia` 槽位读写（`collab-media.controller.ts:32/66/71`）。

**读点改名面（勘正）**：cellNodes 的 fileId 是主画布通道键——`CellNodeInfo.fileId` 改为 `mediaId`（`StoryboardCell.tsx:10`）及其子节点 `data.fileId` 读点。公开快照本体**不带** fileId（泄漏红线剥除，只注入 thumbnailUrl）——`thumbnailUrl` 不动，公开读侧无改名动作。

**作者写与执行写分开**（否则实现者会把所有 `fileId` 赋值改名了事，执行态又写回 doc）：

- 用户放置（上传确认、拖入分镜格、把已有图展开进格子）：客户端经漏斗写 `data.mediaId`，不写 `status`。
- 任务完成才出现的 id：不写 doc、不写本地 store 的 data 面。画面与上游走 D8 解析。服务端交付已经走 `exec.artifact`（T22 起 feed-only，「禁回落 doc 写」）——第②步清的是**客户端**固化写：`nodeStore.setStatus`/`setTrimTaskStatus`/`setTrimmedResult`/`updateMultiImageNodeStatus` 的 dispatch（:737/:898/:913/:861）、`canvasStore` 分镜展开与 `addImageToStoryboardCell` 的 `status:'done'+fileId`、`VideoGenNode` 分离结果固化两处（新建子节点携带 `fileId+status:'done'`）、复制/粘贴副本的 `fileId` 携带与读点（`rebindCopiedMedia` 的 `n.data.fileId` 面）、以及 `setFileResult` 的本地双 store 写（:753——`applyDataPatchToStores` 的 `fileId+status` 也删，画面只跟投影）。生成完成后对被替代作者键的删除见 D8。

**翻禁放第③步，最后做**：渲染出口（第①步）、写者与读者（第②步）都已离开 doc 之后才翻。否则一翻禁，画面就从 doc 读到空。

### D8 主槽：唯一解析函数与生成替代

v2.1 不变量「有 artifact 用 artifact」与「`data.mediaId`=作者权威」互斥：生成之后产物常驻投影——用户再放置，产物优先会把新放置吃掉；作者键优先则生成结果上不了画面，且 MediaBinding 永久钉住旧 id、配额放不掉。全仓只留一个解析函数，放 `packages/shared`，画面、分镜格子、公开缩略图、上游注入都调它：

```
resolvePrimaryMediaId(node)：
  data.mediaId 非空 → 用它（作者权威）
  否则 → 运行时产物的 artifact.mediaId
  都没有 → 主槽为空
```

事件表（缺一条，解析函数就是错的）：

| 事件 | doc `data.mediaId` | NodeArtifact / feed | 画面与上游 |
| --- | --- | --- | --- |
| 用户放置 | 客户端经漏斗写键（护栏=键→MediaBinding 投影；放置无 NodeArtifact 命令腿） | 不动 | 解析读到作者 id，下游注入同 |
| 粘贴填槽 | 驻留会话槽仍为空才写（D5） | 同一 PG 事务写护栏行，不写 status、不建 ArtifactProjection | 解析读到作者 id |
| 生成 CAS 成功 | **仅当键仍=任务开始时冻结的旧值**才删掉这个键（冻结切片 `buildFrozenSlice`/`readSlice` 现成载体） | 继续走现有 `deliverArtifact`，不把新 id 写进 doc | 作者键删除后回落到产物 |
| 生成 CAS 失败 | 保持用户刚写的值（旧任务不得覆盖槽） | 不动 | 继续读作者 id |
| 清空 | 删除键 | 槽位 mediaId 置空、不写 status（现有 clear CAS） | 主槽为空 |
| 跨团队或死 id | 执法腿删除键（D5） | 不新建绑定 | 装入时同谓词重扫（D5） |

- 生成赢了之后的删键，与跨团队执法是**同一条驻留会话通道**（`SERVER_TRANSACT_ORIGIN`）；删完必须直调 projectBindings（维护帧无投影面——`repository:197`；直调先例 `binding-rebuild:136`）。只删 Y.Doc 键不重投影，绑定行会继续钉住旧对象直到下一次用户编辑。
- `referenceImage` 继续是参考输入键，不再充当主槽兜底（`imageNodeGuards:14`、`canvasStore:1964` 改调解析函数）。
- 公开缩略图 `computeThumbnailUrls` 的回落改走解析函数；公开过程页的 `composeRenderModel` join 保持，公开页不走 `projectCanvas`；格子的 thumbnailUrl 在进 `deriveRenderCanvas` 之前按节点 id 注入——收集函数改对了，公开分镜就有图。

## 4 四步（同一分支，一起部署）

### 第①步 投影与作者缓存分离

1. 红测试：空覆盖下 `projectCanvas` 几何必须对拍 `deriveRenderCanvas`（禁手写第二套帧）；墓碑用例（死节点不进组帧、不进 cellNodes）；单键编辑 setState 次数断言（增量落地前失败）。
2. 实现 `projectCanvas`（D1 装配序——墓碑前置+手势折入+liveFrame+格子覆盖回剔除前作者记录）与 D3 全量+身份复用（复用在覆盖写完之后）；`nodes` 保持作者缓存，React Flow 改接渲染列表；同步投影读事务后的 `toReadModel(doc)` 再取消在途 50ms 远端定时器；`applyDocToStore` 不再做渲染出口，其 `hidden:true` 属性写机制（`deriveHiddenMap`/`edgeHidden`）随之退役（可见集合由内核剔除承担——等价，禁双轨）。
3. 删 reconcile 四处与仲裁零件（D2 前置四步的顺序执行）。
4. 按 D4 把叶子 resize 会话化，`setPointerCapture`+四个提交点+一次性标志，生产断言常开、事务前判定与 transact 同一次同步调用无 await。
5. 删除 `composeRenderFromNodeStore`；删除 GroupNode 分镜的 store 现拼扫描（`fileId||referenceImage`+status 那段），分镜渲染只消费渲染节点 `data.cellNodes`（与公开页同通道）。`projectCanvasNodes`（EPHEMERAL 剥键适配）不删——与 `projectCanvas` 同名异构。

**出口：** 生产代码 `reconcileGroupGeometry(` 调用次数为 0；等价域逐位相等；墓碑用例绿；单键编辑 setState 为 1 且未改节点身份不变；任一手势 doc update 恰 1 次、事务前判定失败路径不写 doc；无手势时作者缓存≡doc、渲染列表≡`projectCanvas(作者缓存, 空覆盖)`；ReactFlow 消费的不再是 `nodes`；分镜渲染零 store 扫描。

### 第②步 写者改 mediaId，执行写离开 doc，读点迁移，约束同批收紧

1. census（D7 清单+下列读点+复制携带面）按作者/执行分档改完：客户端固化写全部消除，用户放置写 `data.mediaId`；`setFileResult` 本地 data 面写删除。
2. **上游与展示读点收敛到 `resolvePrimaryMediaId`**：`UpstreamMediaService.readUpstreamMediaId` 与 `ExecutionRequestService.readUpstreamMediaId` 两份 SQL 消失、改调解析函数（禁留第二份 SQL）；`computeThumbnailUrls` 回落改解析；`imageNodeGuards`/`canvasStore:1964` 的 `fileId||referenceImage` 改解析。
3. 组件读点迁移：节点组件改读 `RuntimeProjection`（经 `projectCanvas` 叠到渲染节点的字段，或直接读 runtime store）；不再订阅 `node:status` 画节点；cellNodes 主画布通道键换 `mediaId`。`CanvasTopBar` 的 credits 仍从 socket 的完整余额对象读，不动。
4. **桥白名单收口**：`CANVAS_BRIDGE_KEYS` 从 `{fileId,referenceImage,status,images}` 改为 `{mediaId,referenceImage,images}`——status/fileId 出白名单（否则禁键经 cs 镜像回流 doc，第③步翻禁时自己的桥以 `forbidden-data-key` 关掉自己的连接）、`mediaId` 进白名单。
5. **约束与写者同一次提交**（机理：MediaBinding 的 CHECK 今天九键不含 `mediaId`——本步投影器开始产 `targetField='mediaId'` 行，CHECK 不一起收，中间那次提交在开发库上直接约束失败）：三张表的 CHECK（先把存量 `'fileId'` 更新成 `'mediaId'` 再收紧）、`MediaBinding.targetField` 默认值、`MEDIA_REF_TARGET_FIELDS` 收成六键、`targetFieldOfKind`、`replaceMedia`、两处上游读点、公开缩略图回落——同一 commit。
6. 跑 D6 census。

**出口：** 全仓生产写入不再出现这些禁键；`mediaId` 是主槽唯一作者键；生产代码里不再出现把 `fileId` 与 `mediaId` 当同一个槽来读的函数；上游两处 SQL 消失；公开快照对「只有 `data.mediaId`」和「只有产物」两种节点都能注出 thumbnailUrl；桥白名单只含 `{mediaId,referenceImage,images}`；`node:status` 的生产消费只剩余额。

### 第③步 翻禁 + 版本 4

1. 红测试先失败：帧内写入 `data.status` 或 `data.fileId` 期望连接因 `forbidden-data-key` 关闭——今天 `:222` 的 `continue` 让它失败不了；L2 四处各一条。另有一条 `csv=3` 被拒、`schemaVersion=3` 的行拒载。
2. `frame-deny.ts` 五处 `server-forbidden` 从跳过改为返回失败，reason 仍是 `forbidden-data-key`。
3. **三件同批**：双常量 bump 到 4；`CanvasDoc.schemaVersion` 列 `@default` 改 4（`schema.prisma:898`——否则漏写该列的插入落 3、下轮装载被拒）；现有把 csv=3 当放行的测试在同一提交改为拒连。

**出口：** 上述红测试变绿；第①②步出口复核仍绿。

### 第④步 跨团队粘贴服务端腿

D5 全节：校验+同团队直返/占坑先行拷贝（pending 行+幂等查+源键去重+配额真门+补偿删）+NodeArtifact 护栏行+驻留会话条件写槽+`SERVER_TRANSACT_ORIGIN` 执法腿（origin 档+projectBindings 直调+装入重扫）。

**出口：** §6 D5 组全绿（跨团队返回新 id；新行 `teamId` 是目标团队；三把对象键与源行不同、两源键同对象时新行指向同一把新键；源对象仍在；命中 `bindCommandId` 行不二次拷贝；同 `commandId` 换源/换团队/换项目返回 409；拷贝或标记失败后无 pending 行残留、已拷新键删除；命令失败或槽被占后 doc 不含源 id 且槽不被覆盖；执法腿删键且键已不在时 no-op、装入重扫用例绿）。

四步在同一分支完成后再部署。第③步单独合并时画面仍从 doc 读 `fileId`，翻禁后主槽为空——禁止单独部署。每步先红后绿，测试与该步同一次提交；不单独为旧测试编译保留已删除符号的生产包装。

## 5 不变量

1. doc 的 data 不含 `fileId`、`status`、`result`、`trimmedFileId`、`trimTaskStatus`、`nodeStatus`。
2. 用户放置的媒体 id 只写在 `data.mediaId`，非主槽只允许矩阵仍允许的五个键：`referenceImage`、`referenceVideo`、`referenceAudio`、`images`、`allImages`。
3. 主槽显示与上游注入由全仓唯一的 `resolvePrimaryMediaId` 裁决：作者键 `data.mediaId` 非空用作者键，否则运行时产物；分镜格子同式；`referenceImage` 不再充当主槽兜底；生产代码不出现第二份主槽判定。
4. 组帧只由 `deriveGroupFrame` 计算。doc 组记录零派生帧键：auto/collapsed 组零帧键（含 position）、storyboard 只留 position、manual 留宽高；空组离开时 `emptyGroupSealFrame` 密封 manual。
5. 无手势会话时：作者缓存≡doc 读模型；渲染列表≡`projectCanvas(作者缓存, 空覆盖)`。手势进行中，屏幕上多出来的部分只来自 `gesture` 参数。
6. 一次手势对应恰好一次 doc 事务，且事务开在前置纯函数判定通过之后（同一同步调用，无 await）。
7. 跨团队粘贴之后：doc 槽位里的 id 属于目标团队的 Media 行；该行的对象键不与源行相同（同对象的两列指向同一把新键）；源对象仍在；新行自命令事务起即有 NodeArtifact 护栏，不存在零护栏窗口。
8. 生成完成不得把新 id 写进 doc；对被替代作者键的删除以「键仍=任务开始冻结旧值」为前置，删后绑定投影同帧收敛。

## 6 测试载体

每步先红后绿，测试与该步同一次提交。几何与增量用现有 canvas 单测与 collab 装置，不新造一套只在本地手动跑的门禁。

必有的失败先行用例：

- 第①步：等价域逐位相等（含 liveFrame 不传形态）；墓碑用例（死节点不进组帧/cellNodes）；单键 setState 次数；手势 doc update 次数与事务前判定失败不写 doc；生产 reconcile 调用计数为 0；带复用投影短于同夹具全量对照（≥200 节点含一个分镜组，格子未变时组对象复用含 cellNodes 引用）。
- 第②步：作者放置写入并读回 `mediaId`；`setFileResult` 路径不再写 doc 也不写本地 data 面；节点状态在没有 `node:status` 时仍随投影变化；余额订阅仍在；服务端 targetField 写点随 CHECK 换名；桥白名单收口后 fileId/status 不再到达 cs 镜像、`mediaId` 桥通；上游两份 SQL 消失。
- 第③步：`fileId` 与 `status` 写入被 L1、L2 拒绝；`csv=3` 拒连；PG `schemaVersion=3` 拒载；`@default` 缺省插入落 4。
- **主槽解析（D8）**：放置之后再生成——CAS 成功则画面变为产物、旧 id 的 MediaBinding 在删键那一帧消失；CAS 失败则画面仍是放置的 id。生成之后再放置——不依赖 exec.status，画面与下游 `readUpstreamMediaId` 都变为新 id。公开过程页对「只有 `data.mediaId`」和「只有产物」两种节点都返回 thumbnailUrl。
- **D5**：粘贴命令在客户端确认前崩溃——新行因 NodeArtifact 仍被引用；同一 `commandId` 重试不第二次拷贝；换源媒体/团队/项目返回 409。槽已被其他成员写入时，粘贴填槽不覆盖（响应带分档）。装入一份含对方团队 media id 的文档——驻留会话删键，且绑定行与文档一致。同团队 BindMedia 不拷贝字节不建行。拷贝中途失败——无 pending 行残留、已拷新键删除。
- 回归锚（非本批新机制）：单人团队 awareness 双向短路（Y0b-4 T13 既有测试）维持绿——本批不触碰 awareness 面，防改动被误判为恢复了广播。

77 个文件名命中与 125 处内容命中是重写成本，不是保留 reconcile 的理由。对拍替换之后，仍直接调用已删除函数的测试删掉或改调用 `projectCanvas`。

## 7 RPO / RTO / 观测 / CI

- **RPO：** 不变。持久化路径不改（执法腿与替代删键只是把本就非法/被替代的键清掉，不改变合法投影的写入）。
- **RTO：** 旧页面一次重载换到 csv=4 的包（现成版本终态）。schema 3 的 doc 行拒载后，开发环境走世代重建或删行，不在线改字节。没有需要保留的用户画布。
- **观测：** 不新造指标。拒绝必须走现有关连接计数，reason 带 `forbidden-data-key`。投影耗时继续用现有 `projection_duration` 诊断。预算放在 CI 断言里（D3 对照形态）。
- **CI：** 四步的红转绿用例进现有 verify。没有 CI 跑的断言不算出口。

## 8 留给实现者

- 增量夹具的节点数（≥200）与对照的具体口径写在第①步测试里，阈值不得宽于全量对照的量级。
- `gesture` 表与粘贴本地预览表放哪个模块，只要 `projectCanvas` 的第四个参数是 gesture 唯一读点、松手清空、且都不写回 doc。
- 字节拷贝顺序钉死为「幂等查→配额锁内插 pending 行→CopyObject→标 completed」，S3 不进 PG 事务；配额门=既有 `assertCanUploadInTx(tx, 目标团队, Number(源.size))`，不另写公式。
- `resolvePrimaryMediaId` 的入参形态（node 数据+投影槽）由实现者定，但全仓消费面一个不漏：画面、cellNodes、`computeThumbnailUrls`、两处上游读点。

## 9 与总目录的关系

总目录仍是批次顺序的唯一依据。本文件是 Y2 的规格（v2.2）。目录里「CopyMedia」没有落点，以本文 D5 为准。目录 Y2 行的 spec 列指向本文件。
