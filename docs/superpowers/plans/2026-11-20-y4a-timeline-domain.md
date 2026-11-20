<!-- doc-status: active | created: 2026-11-20 | v10. 执行规则只读 spec §0。本头注不是指令。 -->
# Y4a 时间轴域迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 时间轴（视频编辑器）数据面迁入画布 Y.Doc 唯一真源（新顶层 `timelines` 根按剪辑节点 id 键控），整删 `VideoProject` 表与 REST autosave 链，画布/时间轴撤销按 origin 分域，配额与撤销装回全部用现有两把尺子执法。

**Architecture:** 四柱冻结：同 doc 键控（新 `timelines` Y.Map 根，per-node 四层 Y.Map+span/transform 等标量整值替换）；表整张删（一条 DROP TABLE 迁移，零数据搬移，行协议/SAVEPOINT/sweeper 臂全随表消失）；origin 分撤销（画布栈 scope=[nodes,edges,timelines] trackedOrigins=[LocalUser,ySyncPluginKey]，时间轴栈只盯当前节点子 Map trackedOrigins=[timeline-user]，创建/删除=LocalUser 与节点同事务）；REST autosave 整删（编辑器写穿 Y——commit 改为 codec diff 写 timeline-user 事务，拖动=本地覆盖层+松手一笔）。**删除与量法以 spec §0 为准**：每笔事务临时 doc 量正向+逆操作两帧任一超 maxTxBytes 拒；节点删除=片段块（local-user、块间 stopCapturing、每块两帧≤262144）+最后一笔删小节点；520096 只挡撤销按钮，不实现整棵装回拒写；装回字节删除当时记栈项、undo() 前读累计值不弹栈；onNodesChange/deleteNode 走同一分割函数组骨架最后删。绑定投影三调用方走并集单源函数（节点 refs∪timeline clip mediaId）；真空/金丝雀/扫描根全扩 timelines。

**Tech Stack:** Yjs 13.6.32（UndoManager/popStackItem 一次 transact）、zustand、NestJS、Prisma+PG（一条删表迁移）、vitest 三池（默认/heavy/int——int 必须 `-c vitest.int.config.ts`）、Hocuspocus WS（零新增连接）。

**Spec:** `docs/superpowers/specs/2026-11-20-y4a-timeline-domain-design.md`（v10——唯一裁决是 spec §0；与 §0 冲突的计划句子作废）。

## Global Constraints

- TypeScript strict；根修零垫片；开发期无存量数据（无兼容面）；禁新 REST 端点/新 PG 表替代 doc（spec 反目标）。
- **字节闸只有两把（spec §0 条 1）**：软闸=`QUOTA_DEFAULTS.maxTxBytes`（262144，shared/constants/collab-quota.ts:10）——每笔事务/每一块的正向与逆操作任一超即拒；硬闸=`NORMAL_FRAME_GATE_BYTES`（524288，shared/collab/doc-protocol.ts:506）——服务端 frame-gate 与撤销按钮后挡共用；**RESTORE_GATE_BYTES=520096（=硬闸−4096，timeline-gate.ts 单一派生常量、本批唯一新常量）只留作撤销按钮后挡**（弹栈前读栈项装回字节>RESTORE_GATE_BYTES→不弹栈保持删除态提示「单次操作过大」）、**不再作「能不能删这个节点」的判据**（2026-11-21 独立实验 yjs@13.6.32：临时文档预检帧与 live 真撤销帧删除后立即撤销逐字节等长、撤销者自身 clock 越 2^21 差 +5976——520096 预检的 4096 余量被击穿〔「量小放行→真撤销帧 1009 本地装回服务端没有」终态真实可达〕；切块每块预检 262144 距硬闸 256KB 余量、实测漂移最大 ~6KB/16000 struct 病态外推 ~48KB 穿不过硬闸）；节点删除改用切块；chunkCopyPlan 的 utf8 JSON 预算不拿来切时间轴；实测数不进代码不当阈值。
- **删除顺序只有一条（spec §0 条 3/6）**：onNodesChange（canvasStore.ts:1853-2017，含 :1965/:2013-2015 现二次级联）与 deleteNode（:1142-1173，组递归 :1152-1156 删掉）与 deleteTransformNode（:1194——第三条删除入口、现直派 deleteNode intent 不经预检）**各只调用一次 executeDeleteSplit、分割函数内部不调 deleteNode、不经 dispatchCanvasIntent（最外层事务——dispatch 单事务折叠〔canvasIntents.ts:362-364〕会把整批删除合成一帧）**；删除集=选中节点+被删组全部后代（分割函数一次收齐）。**先对整批做完切块计划、再写第一笔活文档事务**。带时间轴剪辑节点逐个：**先卸该节点的时间轴 UndoManager+作废拖动覆盖层**→**用现有切块把片段删掉**（origin local-user 进画布栈不进时间轴栈；块间 stopCapturing；每块临时 doc 量两帧、任一>262144 拒；单片段仍超→该节点一笔都不写）→**最后一笔 local-user 删节点+连边+已变小的 timelines.<nodeId>**（组骨架仍在最后这笔、排在片段块之后；前后 stopCapturing）；**保护集=切块失败节点+它在删除集里的全部祖先组（都不进最后一笔）**；无剪辑节点时其余节点合成现状一笔不额外 stopCapturing（500ms 合并窗保持）。**落笔前栈容量预检：undoStack.length+块数+1>UNDO_STACK_LIMIT(100)→整次删除不写**（不清栈——第 101 项 stack-item-added 整栈 clear() 会把已删片段变不可撤销=「删除已生效撤销回不来」同类终态）。撤销后进先出：先回「节点在、时间轴已变小」、再逐块装回片段——中间态是文档里的节点非 parentId 悬空。组善后=分割函数返回之后独立成步。
- **doc 形态（spec §3.1）**：`timelines: Y.Map<nodeId, Y.Map>`；per-node `{version:1, fps:30, canvasSize?, tracks: Y.Map, clips: Y.Map}`；clip Y.Map 键=span/transform/style/fade/transitionIn/transitionOut/keyframes(Y.Map)/type/mediaId/sourceNodeId/volume/playbackSpeed/text/visible；span 等标量=JSON 整值替换；**keyframes 随片段创建同笔事务建空 Map（字幕无此键）**；Track 补 `order: string`；默认轨 id=`${nodeId}:video`、order=FIRST_ORDER_KEY('5000')、名「视频」；版本 4→5（CANVAS_DOC_SCHEMA_VERSION docShape.ts:59 + CLIENT_PROTOCOL_VERSION constants/collab-protocol.ts:13 同步）；baseline `--write` 同 commit。
- **键矩阵封死（spec §0 条 8 键矩阵）**：帧谓词拒绝——标量槽出现 Y.Map/Y.Array/Y.Text（deepCopyYMap registry:93-100 对后两型会跨 doc 直 set）、非有限数/负 start/sourceStart、非正 duration、空 clipId、canvasSize 宽高非有限正数、volume/fade.in/fade.out/opacity/fontSize 非有限数（fontSize 需正、fade 两段非负）、mediaId 非空字符串、Transition 五 type+非正 duration、easing 仅 'linear'、playbackSpeed∈{0.5,1,2}、version 只能 1、fps 只能 30、音量关键帧无 property、Map 键≠记录自身 id、给已存在键 set 新 Map。
- **一把尺子（spec §0 条 2——不实现 measureWholeTreeRestore）**：量这一笔自己的撤销=measureTransactionFrames（临时 doc=applyUpdate(encodeStateAsUpdate(live)) 不连 provider、**applyUpdate 之后任何事务之前 temp.clientID=live.clientID**〔先设会被 yjs 换号——transaction.js:357-360：applyUpdate 吃进的状态里已有该 clientID 时静默 generateNewClientId、量出来的是另一个 client 的帧〕、UndoManager 落笔前挂上且 scope/origin 与即将落笔那笔同构；字节=temp.on('update') 未包装 byteLength；整份 encodeStateAsUpdate 量全文档不能当闸）——**T4 编辑事务与 T5 切块每块共用**（切块 apply=deleteTimelineClips 生产原语同源；每块正向+逆操作两帧任一超 262144 拒）。**不实现「删掉整棵时间轴再 undo」这把写闸**——切块定案后无任何用户操作一帧装回整棵、这把尺会把时间轴卡在 ~256KB（加片段=树变大→量整棵装回→超 262144 拒）。**切块候选两帧各跑 validateFrameDeny**（undo 装回帧 struct 密度比正向高一档、262144 全小 struct 病态可越 FRAME_MAX_STRUCTS/DS_RANGES=16000——预检两帧不过谓词同拒）。子 Map 上的编辑 UndoManager 看不见父键删除，undo() 撤掉的是刚才那笔编辑帧很小——节点删除撤销由画布栈按块装回、不经这把尺。
- **正向字节与装回字节两张表（spec §0 条 5——捕获策略记账，不实现 openCapture 重放）**：canvasUndo `stackItemBytes` 只记正向帧（redoCanvas:112-118 软限额预检消费——不动）；**新 WeakMap `stackItemRestoreBytes` 只记装回字节**、itemNeedingBytes 同款回填机制（事件序沿用 canvasUndo.ts:24-26 钉死配对——stack-item-added/updated 在 afterTransaction、doc 'update' 在其后同事务 cleanup；**pendingRestoreBytes=本笔预检量的 undoBytes，update 事件写完立刻清、下一笔不继承；afterTransaction 里无条件清该 origin 的 pending——只有本笔确实发出 update 才把这笔 undoBytes 加到对应栈项上**（删除缺 id/空片段列表这类事务不发 update，只在 update 里清会把待记装回字节挂到下一笔同 origin 栈项上、小撤销被误拦））。**捕获策略三类（spec §0 条 5）**：①片段/轨道/关键帧增删与删除的每一块=**写之前和写之后都 stopCapturing、每一笔单独成栈项**——栈项装回字节就是这一笔 undoBytes（**预检和入栈用同一个数**）；②**拖动松手（span 标量整值替换）=同一次手势单独成步**、写前写后 stopCapturing（锚 8 只约束这一类——不走 500ms 窗）；③其余标量整值替换（transform/style/fade/音量）用 500ms 窗、栈项装回字节=窗内各笔 undoBytes 之和；写下一笔之前「当前栈顶已记装回字节+这一笔 undoBytes>RESTORE_GATE_BYTES」→先 stopCapturing、这一笔单独成步；和超闸先切开=**保守方向**（合并后的一帧不会比各笔逆操作之和大到能穿过硬闸；标量一笔 struct 差几十字节量级、500ms 合不了几百笔）。undoCanvas 与 timelineUndo 都在弹栈前读栈项装回字节>RESTORE_GATE_BYTES→不弹栈保持删除态提示「单次操作过大」；**undoCanvas 这道判断放 await import 与 `undoManager !== um` 之后、`um.undo()` 之前**（canvasUndo.ts:85-90 现序保持——S-1 活跃进程取消逻辑不动）；**redoCanvas 消费正向表不动**；时间轴栈 captureTimeout=UNDO_CAPTURE_TIMEOUT_MS(500)。合并后栈顶若永远过闸、再往下的撤销步暂时够不着=可接受限制（比发出 1009 毒帧好；新编辑仍压在这项上面）。**装回字节随栈项对象双向抄（spec §0 条 5）**：undo()/redo() 每次都 new StackItem（yjs.cjs:3697）非挪对象——undoCanvas 现只在弹栈后把正向字节抄到新 redo 项（canvasUndo.ts:88-92）、redo() 再生成的新 undo 项上没有装回字节，闸把缺失当 0 则「撤销→重做→再撤销」放行同一次大删除（本地装回、服务端 1009）；**所以 stackItemRestoreBytes 双向抄——undoCanvas/timelineUndo 弹栈前读栈顶、弹栈后写到新 redo 栈项；redoCanvas 弹栈后同样抄回新 undo 项**；pendingRestoreBytes 按 origin 分开（local-user 与 timeline-user 各持一份）、update 写完就清、**afterTransaction 无条件清该 origin 的 pending——只有本笔确实发出 update 才把这笔 undoBytes 加到栈项**（无 update 事务不清数=下一笔继承误拦小撤销）；
- **分割函数唯一控制流（spec §0 条 3）**：deleteNode/onNodesChange/deleteTransformNode 各只调一次 executeDeleteSplit；函数内部不调 deleteNode（防递归重入）、**不经 dispatchCanvasIntent、直接调 deleteNodesWithTimelines、不派 deleteNode intent**；**先对整批做完切块计划再写第一笔活文档事务**；带时间轴剪辑节点逐个=先卸该节点时间轴 UndoManager+作废覆盖层→切块删片段（deleteTimelineClips、每块两帧≤262144、块间 stopCapturing）→最后一笔删小节点；**落笔前 undoStack.length+块数+1>100→整次不写**；保护集=切块失败节点+全部祖先组；已删过闸兄弟保持删除；无剪辑节点时其余合成现状一笔不额外 stopCapturing。撤销序=组骨架与小节点同笔先回（parentId 不悬空）→再逐块装回片段。
- **删除原语单源（spec §0 条 3/4——两个原语+嵌套即抛+服务端同切块）**：`deleteNodesWithTimelines(doc,nodeIds,origin)` 与 `deleteTimelineClips(doc,nodeId,clipIds,origin)` **各自只开一层事务；文档已在事务里时直接抛 `nested-transact-forbidden`、禁止静默并帧**（Yjs 嵌套 transact 并进外层、内层 origin 被丢掉——「先测一笔、不过再改服务端切块」退路走不通：原语在 withDoc〔collab-document.service.ts:107-119 包 SERVER_TRANSACT_ORIGIN〕/writeBatch（单次 withSession{mode:'write'}）里被调用、切多少块都还是一帧）。消费方=分割函数（客户端唯一删除写入、**不经 dispatchCanvasIntent**）、applyIntentToDoc 删除分支（**只删无时间轴或空时间轴的节点、遇非空片段拒绝 reason `timeline-chunk-required`**——供投影差分与其他 intent 组合用）。**服务端三路逐块化（spec §0 条 4）**：①shrink 影子预演继续量整份文档字节（8MB 配额）——**活文档写入改走不包外层事务的会话、由调用方逐块开事务**（现 :110 withDoc 包 shrinkSync、:186 影子预演/:195 活写两腿）；任一块过不了 validateFrameDeny 或 262144、活文档一笔都不写；②writeBatch 的 deleteNodes 遇非空片段时间轴返回 `timeline-chunk-required`、不在批事务里硬删；③恢复导入 **effectiveDeletions 先对活文档逐块提交并逐块过闸**（现 :274-291 read 会话+单份 commitDiff——改逐块）、再克隆候选、再算信封 commitDiff；每块单独一层 SERVER_TRANSACT_ORIGIN。**客户端 intent 层 fail-closed（漏网后挡，非第二条删除实现）**：canApplyIntent/applyIntentToDoc 删除分支遇带非空片段时间轴的节点拒写（reason `timeline-chunk-required`）——dispatch 单事务折叠会把单帧删除折叠、undo 装回帧直冲硬闸；**投影差分（diffProjectionToIntents :495-509）的删除半边保持原样、继续产出 deleteNode intent**——ungroup（canvasStore.ts:2457-2466）/clearStoryboard/removeStoryboardCell/多图展开四条漏斗经它删无时间轴节点，砍掉=store 已滤节点而 doc 还在、下一帧快照把节点装回来；**差分删除集里含「文档中仍带非空片段」的节点时整份差分不派发**（带时间轴节点只由 executeDeleteSplit 写）。切块每块预检在临时 doc 上调 deleteTimelineClips 同一原语——预检和真删同一个函数、两套删除形态量出的字节不能当闸。
- **timelines 根装载时物化（spec §0 条 7）**：fillDoc 加 getMap('timelines') 盖不住装载——loadDocument 水合走 applyReplayed/applyUpdate（collab-doc-registry.service.ts loadDocument）不调 fillDoc。**loadDocument hydrate 完成后：`document.share.has('timelines')` 为假→SERVER_TRANSACT_ORIGIN 一笔事务 getMap('timelines')（不放工程）；已有根零事务；actor install 在这之后 observeDeep 这棵根**；客户端写入只走已有根。**同名根就是同一对象（spec §0 条 7）**——getMap 对同一个名字返回同一个对象（yjs.cjs:614-620 setIfUndefined）、远端更新也按 doc.get(名字)挂进同一棵根（:1467）——**不存在「两客户端各造一棵根、后同步的被丢掉」**（该句作废：与 nodes/edges 的启动方式矛盾）；会丢数据的只是给已存在的键 set 一棵新 Y.Map，该约已禁止；**画布撤销挂接时（空文档、早于同步 canvasCollabRuntime.ts:2067-2068——与 nodes/edges 完全同款）getMap('timelines') 进 scope**；编辑器只读已存在的 timelines.<nodeId>、键不在不创建工程；addNode 里 fillDoc 再 getMap 时根已在（造根不进用户撤销步）。
- **版本门配套同笔（spec §0 条 9）**：schema.prisma CanvasDoc.schemaVersion `@default(4)`（:905）改 `@default(5)`+迁移 `ALTER TABLE "CanvasDoc" ALTER COLUMN "schemaVersion" SET DEFAULT 5`（**不 UPDATE 旧行**——开发库已 4 的行被版本门拒载重置文档，不写数据迁移）；历史 CREATE TABLE 里的 DEFAULT 4 保持不动（c3a-schema.int.spec 扫这条历史 SQL）；collab-version-gate.spec.ts:170 现放行的 4 改成拒载、当前值改 5——**默认值变更与 CANVAS_DOC_SCHEMA_VERSION=5 同一笔 commit**（漏写该列的懒插入落 4 会被版本门拒载）。
- **文档重建只有一条路（spec §0 条 7）**：toReadModel 公开读模型继续不含 timelines（防泄漏保持）；丢数据的是把这份读模型当成整份文档——**rebuildCanonical:399-411 只 toReadModel+fillDoc、exportFreshRun:141-156 同形、recordsOfHydration:388+EXPORTING:375/VERIFYING:473 hash 只算 records（canonical 重建删掉时间轴后校验仍过=表删后这份 Y.Map 是时间轴唯一一份、该次维护就是清盘）；rebuildVacuumDoc:748-765 是唯一认得非 nodes/edges 根的路径**。抽出 **rebuildDocFaithful(source):Y.Doc|null**（做 rebuildVacuumDoc 已在做的事：fillDoc(nodes,edges)+除 nodes/edges/exec 外每个 Y.Map 根 deepCopyYMap；Text/Array 序列根返 null 维持），**rebuildVacuumDoc/rebuildCanonical/exportFresh 三处只调它**；vacuumEquivalent 与 VERIFYING 的 hash 都加 timelines 稳定序列化（节点/边公开读模型比较保持原样）；谓词继续拒时间轴槽 Y.Array/Y.Text（deepCopyYMap 不跨 doc 直 set 这两型）；**不给时间轴写第二套拷贝器**。
- **一个函数一条执法链（spec §0 条 11——媒体三件）**：媒体引用=collectNodeRefsUnion 调 **codec 导出的 clip mediaId 提取**（video/image/audio、targetItemId=clipId、空 clipId 不产行——不另写独立第二套扫描）；collectMediaRefs/takeBindingDelta/slot-write.port+**rescanEnforcedMediaRefs（registry:354-361 现直调 collectMediaRefsForNode——同改并集**，时间轴跨团队/缺失/已软删 mediaId 装载时剥掉）。帧谓词=commit 在 live transact **之前**对临时 doc 落这一笔：那一帧 update 跑 validateFrameDeny（L1）+**物化过的事件跑 validateAppliedL2（L2）**——只跑帧级不够（改已有键时父项不在本帧 L1 跳过、服务端 L2 仍会 4411）；失败则 live doc 不写（服务端 validateFrameDeny 失败=hardClose 而本地已写——写前自检堵这个窗口）；谓词下钻 span/transform/style/fade/transitionIn/transitionOut JSON 标量内（fontSize/opacity/fade.in 在标量里面）。**编辑器重绑听 timelines 根上该 nodeId 键的替换与删除（非仅 observeDeep 子 Map——子 Map 被换掉后旧监听收不到替换事件）**：替换先 clear() 再销毁旧 UndoManager、覆盖层作废、栈从空开始；键消失关编辑器；observeDeep 回调只 setState 不调用 commit。
- **Y.Map 四处**（per-node/tracks/clips/keyframes）之外全标量；**写入纪律**：创建者事务建好后只增删键/改已有键的值；空工程种点唯一=applyIntentToDoc addNode 分支（canvasIntents.ts:153，节点已存在于 nodes 时不写）；复制/粘贴不复制时间轴（粘贴走 addNode=新节点种空工程）。
- **撤销域（spec §4）**：画布栈 scope=[nodes,edges,timelines]（undo-policy.ts UNDO_STACK_BASE 同步；**attachUndoManager 在空文档上、早于同步（canvasCollabRuntime.ts:2067-2068）——这里和 nodes/edges 一样调用 doc.getMap('timelines') 并进 scope（spec §0 条 7：撤销恢复只复活 scope 之内的 item（yjs.cjs:3535-3545 isParentOf）——scope 缺这棵根则删除的撤销带回节点边、时间轴仍消失；同名根同对象=早挂 scope 无时序风险）、trackedOrigins 不变；时间轴栈=编辑器打开时创建、只盯当前节点子 Map、trackedOrigins=['timeline-user']（Origin 枚举 canvasUndo.ts:18 加 `TimelineUser: 'timeline-user'`）；栈上限 UNDO_STACK_LIMIT=100 同源；尾动作取消（undoCanvas/redoCanvas 零种/删 Map，只跑 AutoEdge ensureAutoEdges）；删除事务只 clear 被删节点自己的时间轴栈。
- **VideoProject 整张删**：schema.prisma model（:500）+一条删表迁移；保留路由只有 regenerate/export-precheck/generated-media/register、generated-media/confirm（video-project.controller.ts 其余 POST/GET by-node/PATCH/DELETE by-node 整删）；登记面核销=scope-column.registry.ts:80/:101/:131+lifecycle-obligation.sweeper.ts:196-207 级联臂+media-referrer.registry.ts:116-124 VideoProject 臂+project-erasure.stages.ts:22/:278/:286 文案+project-erasure.assert.ts:117 豁免行+web cascadeDeleteVideoProject（canvasStore.ts:127/:1163/:1856）+videoProjectApi.ts upsert/patch/getByNode/deleteByNode+media-gc collectJsonMediaIds 的 VideoProject 消费点。
- **绑定投影并集单源**：`collectNodeRefsUnion(nodeId, entry, timelines)` =collectMediaRefsForNode（shared/canvas/media-refs.ts:70）∪该节点 timeline video/image/audio clips mediaId（role='primary'、targetField='mediaId'、targetItemId=clipId、**clipId 空串拒**）；三调用方=takeBindingDelta（actor:213-218）、collectMediaRefs 聚合（media-refs.ts:93）、slot-write.port.ts:62/:99；collector observeDeep 加 timelines 根（actor:232 一族）、路径首段并入 touched、position-only 判定（actor:275-278）不动。
- **门禁先红后绿（D13）**：manifest/frame-deny/oracle SCAN_ROOTS/vacuum shapeOf 四处加 timelines 各先红一次再落地绿。
- **测试命令**：shared=`pnpm --filter @flowweb/shared test`；web=`pnpm --filter @flowweb/web test`（默认池）；api=`pnpm --filter @flowweb/api test`；int 池必须 `pnpm --filter @flowweb/api exec vitest run -c vitest.int.config.ts <file>`；双端 tsc=`pnpm --filter @flowweb/web exec tsc --noEmit`/`pnpm --filter @flowweb/api exec tsc --noEmit`；批末 `pnpm verify`（full 36 步）。
- **commit 纪律：全批恰四笔大 commit**（组内任务完成只跑门禁不 git commit，组末一次提交）：第一笔 T1-T3（`feat(y4a): timelines doc 域+撤销闸地基——schema v5/manifest/frame-deny/undo-policy/帧谓词`——**提交前门=shared+api 单测+collab-version-gate.spec.ts+schema @default(5) 迁移进库**〔c3a-schema.int.spec 默认值迁移后即绿〕）；第二笔 T4-T7（`feat(y4a): 时间轴写穿 Y——codec/editorStore/分割函数/绑定并集`——**git add 含 apps/api/src/modules/collab**：T5 collab-document/collab-recovery-import、T6 actor/slot-write/registry 都动 api，只 add web/shared 会把 api 改动漏进第三笔）；第三笔 **T8-T10 全绿后**（`refactor(y4a): VideoProject 表整删+REST autosave 链退场+读链改道`——**T9 步骤不再单独提交，提交点在 T10 双客户端 int spec 落盘之后**）；第四笔 T11-T12（`feat(y4a): canUndo UI+双端收口 verify`）。
- **T8 文件表非封闭清单**：闭合条件=「VideoProject」「videoProjectId」两条 grep 零命中，另加三件——OBLIGATION_KIND_CONSUMERS.NODE_DELETED（packages/shared/src/collab/lifecycle.ts:26）与 lifecycle.spec 的 VideoProject 字面量同改（**义务种类枚举本身不动**）；User:41/Team:167/CanvasProject:766 三处 `videoProjects VideoProject[]` 关系字段随 model 删（否则 prisma generate 失败）；videoProjectId→sourceNodeId 全链=product-node 写点+doc-schema videoGen 槽（T3 已换）+video-work 剥离名单+公开快照（生成物 metadata 仍是字符串非外键）。

## Review Focus

1. **切块后的 live 撤销帧仍超硬闸（spec §0 条 10）**：节点删除切成片段块+最后一笔小节点删——表征测试锁「每一块 live 撤销帧≤524288」（undo clientID 与历史写入 clientID 钉死；**撤销者自身 clock 越过 2^14 档必测**——独立实验实测漂移 +3268@2^14/+5976@2^21，262144 预算距硬闸 256KB 余量盖得住；单片段逆操作仍超→该节点一笔都不写；RESTORE_GATE_BYTES 只留撤销按钮后挡、不再当删除判据；「刚小于 520096 的最大树」不再是开工门）。测试：T1 切块表征（带历史的 live doc 上逐块 undo→每块未包装帧≤NORMAL_FRAME_GATE_BYTES；差超则下调 TIMELINE_CHUNK_UNDO_BUDGET 重跑、测试写明测到的帧与块规模）。
2. **合并窗把多笔装回字节叠一步（undo 弹一帧=线上多笔合成帧）**：500ms 捕获窗把多笔标量整值替换并成一个栈项——undo() 弹的是一个栈项、线上是一帧；合并帧由各笔逆操作之和上界（收敛方向），写下一笔前「栈顶已记+这笔 undoBytes>RESTORE_GATE_BYTES」先 stopCapturing 切开；undo 读装回字节不弹栈。测试：T4 ⑥——两笔片段删除各成一步；两笔标量同窗、栈项装回字节=两笔之和；第三笔越闸先被 stopCapturing 切开；pending 不继承；**高 clock 档：约 30 笔标量同窗→live 这一下撤销未包装字节≤累加值且≤524288（「和是保守的」由测试锁死）**；**负控：把正向 update 用 applyUpdate 灌进克隆再 undo、字节≠measureTransactionFrames 的 undoBytes（applyUpdate 强制 transaction.local=false :1688-1691、收栈只看 origin :3662-3668、redoItem 对 Map 覆盖项判远端冲突返回 null :9734-9746）——用来禁止把重放量法加回来**。
3. **组先删、剪辑子节点撤销中间态 parentId 悬空飞原点且同步他人**（deleteNode:1149 注记形态+onNodesChange 二次级联 :2013-2015 形态）：分割函数必须组骨架最后删、**且废除 onNodesChange 的第二次级联**（分割函数内部不调 deleteNode 防递归重入）、**保护集=预检失败节点+它的全部祖先组都不进最后一笔**（只跳直接父组=更外层组仍被删、中间态照样悬空）。测试：T5 组含剪辑子节点删除→undo 第一步组骨架回来、第二步子节点回来、中间态断言子节点 parentId 指向已在的组；预检失败档断言祖先组全保留。
4. **绑定投影把片段 MediaBinding 删掉（touched 误标+装载重扫快照漂移+悬空键漏扫）**：只改时间轴的帧若按「节点 data 引用」整表替换=clip 绑定被清到下次 rebuild 才补回；**装载重扫候选收集+写后快照 :390-396 现都是 collectMediaRefsForNode——只改收集不改快照=剥不到 clips.<clipId>.mediaId、projectBindings 按节点槽快照盖掉绑定**；**takeBindingDelta 只按 nodes.has 推导——节点已删而 timelines.<id> 仍在（并发删除与编辑、clientID 较大一侧）时把绑定清掉、GC 看不见这段引用**。测试：T6 只改时间轴帧→takeBindingDelta 交出并集；slot-write 不清片段绑定；重扫双档（非法片段键被删+写后快照并集）；**悬空键档：节点删键在→collectMediaRefs/takeBindingDelta 都投该键片段行（nodes.has(id)?union:null 的清绑定形态=负控）**。
5. **非法标量漏进 doc 破坏真空/导出**（NaN/负 duration/Y.Text 塞进标量槽——deepCopyYMap 会跨 doc 直 set Y.Array/Y.Text 造成真空后类型畸变）：帧谓词六类拒绝面+负控。测试：T3 谓词负控矩阵（每类拒绝至少一例）+T9 真空等价负控（漏拷片段时比较为假）。

---

### Task 1: shared 契约地基——undo-policy 扩 timelines、Origin 加 timeline-user、Track.order、装回闸常量

**Files:**
- Modify: `packages/shared/src/collab/undo-policy.ts`（UNDO_STACK_BASE 三根+TimelineUser origin 常量登记）
- Modify: `packages/shared/src/types/video-project.ts:11-18`（Track 补 `order: string`；createDefaultProjectData 默认轨 order=FIRST_ORDER_KEY）
- Create: `packages/shared/src/canvas/canvas-node-delete.ts`（**两个删除原语先进 T1**——deleteNodesWithTimelines 同一事务删节点+source/target 指向它的边+timelines 同名键〔缺 id 跳过；非 Map 边跳过；幂等〕+deleteTimelineClips 恰好一次事务只删这些片段键〔T4 清空/T5 切块同源、T1 表征按它切块——量的是上线那一帧非整键删除〕）
- Create: `packages/shared/src/collab/timeline-gate.ts`（装回闸常量+两帧量法纯函数）- Test: `packages/shared/src/collab/undo-policy.spec.ts`（既有契约面扩断言）
- Test: `packages/shared/src/collab/timeline-gate.spec.ts`
- Test: `packages/shared/src/canvas/canvas-node-delete.spec.ts`

**Interfaces:**
- Produces: `UNDO_STACK_BASE = ['nodes','edges','timelines']`（as const）；`UNDO_TIMELINE_ORIGIN = 'timeline-user'`（新常量，web Origin 枚举引用同值）；`Track.order: string`；
- Produces: `deleteNodesWithTimelines(doc: Y.Doc, nodeIds: readonly string[], origin: unknown): void`（**shared 删除原语单源——带 origin+嵌套即抛（spec §0 条 4）**：函数内部**恰好一次** `doc.transact(mutate, origin)`（同一事务删节点+source/target 指向它的边+timelines 同名键；缺 id 跳过、非 Map 边跳过、幂等）——**文档已在事务里时直接抛 `nested-transact-forbidden` 禁止静默并帧**（Yjs 嵌套 transact 并进外层、内层 origin 被丢掉——「原语不带 origin=删除不进栈、预检量到 0 闸等于没装」的旧论证已被更强的并帧问题取代：在 withDoc/writeBatch 里调用、切多少块都还是一帧）；客户端分割删除与 T1 表征测试传 'local-user' 且该调用就是最外层事务；**三条路径调用它**：客户端 applyIntentToDoc deleteNode 分支〔**只删无时间轴或空时间轴节点——外层 dispatch 的 transact 已带 origin、原语在事务里被调用对空时间轴合法**〕、服务端 applyDeleteNodesToDoc（collab-document.service.ts:414——**须改为不包外层事务的会话逐块调用**，见 T5 Files 服务端三路）、恢复导入 **effectiveDeletions 段**〔replace 段不调用；**逐块提交逐块过闸**〕；**服务端非空片段时间轴与客户端同切块（每块单独一层 SERVER_TRANSACT_ORIGIN）**）；
- Produces: `deleteTimelineClips(doc: Y.Doc, nodeId: string, clipIds: readonly string[], origin: unknown): void`（**片段键删除原语**：恰好一次事务只删这些片段键；T4 清空时间轴与 T5 节点删除切块同源；T1 切块表征测试按它逐块量——预检和真删同一个函数）；
- Produces（timeline-gate.ts，T4/T5 消费）:
  - `RESTORE_GATE_BYTES = NORMAL_FRAME_GATE_BYTES - 4096`（520096 单源——本批唯一新常量；**只作 undoCanvas/timelineUndo 弹栈后挡、不作删除判据**）；
  - `TIMELINE_CHUNK_UNDO_BUDGET`（切块逆操作预算、初值=QUOTA_DEFAULTS.maxTxBytes〔262144〕——T1 表征某块超 524288 时下调到此预算、只影响切块上限；派生值放本文件与两把闸同源）；
  - `measureTransactionFrames(live: Y.Doc, apply: (temp: Y.Doc) => void): { forwardBytes: number; undoBytes: number }`（**量这一笔自己的撤销**：临时 doc=applyUpdate(encodeStateAsUpdate(live)) 不连 provider、**applyUpdate 之后任何事务之前 `temp.clientID = live.clientID`**〔先设会被 yjs 静默换号〔transaction.js:357-360〕、量出来的是另一个 client 的帧〕、UndoManager 落笔之前挂上且 scope/origin 与 apply 里那笔同构、apply 回调在 temp 上落这一笔、量 temp.on('update') 正向帧→undo()→量逆操作帧——**apply 由调用方组装**：T4 编辑事务传 diff 写、T5 切块预检传 deleteTimelineClips 同源形式→undoBytes 即该块装回帧（每块两帧任一超 262144 拒；切块算法与 T4 清空时间轴同一条规则）；**两边都量未包装 update 与 guardSyncFrame payload.byteLength 一致**）；
  - 不实现 measureWholeTreeRestore（**整棵装回写闸有害**：切块后无任何用户操作一帧装回整棵、这把尺会把时间轴卡在 ~256KB）。


- [ ] **Step 1: 写失败测试（undo-policy.spec.ts 扩断言+timeline-gate.spec.ts 新建）**

undo-policy.spec.ts 追加：`UNDO_STACK_BASE` 深等 `['nodes','edges','timelines']`；`UNDO_TIMELINE_ORIGIN === 'timeline-user'`。
timeline-gate.spec.ts 首测（用真实 Yjs 装置，非 mock）：

```ts
// 量法契约：
// ① measureTransactionFrames：一笔 addClip 的 forwardBytes 与 undoBytes 都 >0；
//    整份 encodeStateAsUpdate(live).byteLength ≠ forwardBytes（证明量的是这一笔不是全文档）
// ② 不测整棵装回。RESTORE_GATE_BYTES === NORMAL_FRAME_GATE_BYTES - 4096 === 520096
// ③ clientID 顺序：applyUpdate 之后设 temp.clientID=live.clientID——先设再 applyUpdate 会被
//    yjs 静默换号（transaction.js:357-360），断言 temp.clientID 保持不变。
// ④ 切块表征测试（spec §0 条 10——锁「每一块 live 撤销帧≤524288」）：
//    带历史的 live doc（数百笔小事务、至少两个写入 clientID、undo 用另一个钉死 clientID、
//    撤销者自身 clock 越过 2^14 档——独立实验实测漂移 +3268@2^14/+5976@2^21，余量盖得住要锁进断言），
//    一个剪辑节点+至少一条指向它的边+一棵大时间轴；按切块规则用 deleteTimelineClips 清空
//    再删小节点，逐块 undo→每一块未包装撤销帧≤NORMAL_FRAME_GATE_BYTES（未包装口径与
//    guardSyncFrame payload.byteLength 一致）。
//    某块超→下调 TIMELINE_CHUNK_UNDO_BUDGET 重跑，测试写明测到的帧与块规模。
// ⑤ 立即撤销等长档：删除后立刻 undo 的 live 帧与 measureTransactionFrames 同笔 undoBytes 等长
//    （temp==live——量法忠实性断言）。
// ⑥ 大时间轴服务端帧档（spec §0 条 10——负控）：同一棵大时间轴（420 片段、多 client 交错 clock）
//    上——超预算的一笔删除必须被拒（nested-transact-forbidden 档+超 524288 档各一例）；
//    切块后的每一帧 ≤ 524288 且 countDsRanges ≤ 16000（连续 clock 夹具几乎必过、盖不住上线形态
//    ——夹具必须多 client 交错）。服务端三路（shrink/writeBatch/恢复导入）逐块化是定案非退路。
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm --filter @flowweb/shared exec vitest run src/collab/undo-policy.spec.ts src/collab/timeline-gate.spec.ts`
Expected: FAIL（UNDO_STACK_BASE 现值 ['nodes','edges']；timeline-gate.ts 不存在）

- [ ] **Step 3: 实现**

undo-policy.ts:24 UNDO_STACK_BASE 加 'timelines'（头注登记 spec §0）；新增 `UNDO_TIMELINE_ORIGIN` 常量+消费现状注记（T5 时间轴栈 trackedOrigins）。video-project.ts Track 接口加 `order: string`；createDefaultProjectData 默认轨 `order: FIRST_ORDER_KEY`（import 自 canvas/order-key.ts——shared 内域内引用）。**canvas-node-delete.ts 先落两个原语**（删除原语〔**带 origin 形参、内部恰一次 doc.transact(mutate, origin)**〕+切块表征测试先于撤销闸常量——`deleteNodesWithTimelines(doc, nodeIds, origin)`：删节点+source/target 边+timelines 同名键、缺 id 跳过、非 Map 边跳过；`deleteTimelineClips(doc, nodeId, clipIds, origin)`：恰好一次事务只删这些片段键）。timeline-gate.ts 新建：RESTORE_GATE_BYTES+TIMELINE_CHUNK_UNDO_BUDGET 单源+measureTransactionFrames（量这一笔自己的撤销——UndoManager 在 apply 前挂、**applyUpdate 之后任何事务之前 temp.clientID=live.clientID**、`temp.on('update')` 单次收数、undo 后再收一次；**量未包装 update 与 guardSyncFrame 同口径**）。**切块表征测试④（spec §0 条 10）**：夹具=真实删除形态（一个剪辑节点+至少一条指向它的边+一棵大时间轴）且切块按 deleteTimelineClips、最后一笔调 deleteNodesWithTimelines（传 'local-user'、每笔就是最外层事务）；**undo 用同一个钉死 undo clientID、历史用另外两个钉死写入 clientID 叠、撤销者自身 clock 越过 2^14 档**（随机 clientID 改变 varuint 宽度、闸边界会抖）；按切块规则清空再删小节点，逐块 undo 断言每块 live 未包装撤销帧≤NORMAL_FRAME_GATE_BYTES；某块超→下调 TIMELINE_CHUNK_UNDO_BUDGET 重跑、测试写明测到的帧与块规模；**⑤立即撤销等长档**（temp==live 量法忠实性）；**⑥大时间轴服务端帧档（负控形——spec §0 条 10）**：同一棵大时间轴（420 片段、**多 client 交错 clock 夹具**——连续 clock 夹具几乎必过盖不住上线形态）上：超预算一笔删除必须被拒（nested-transact-forbidden 档+超 524288 档各一例）、切块后每一帧≤524288 且 countDsRanges≤16000——**服务端三路逐块化（shrink/writeBatch/恢复导入）是 §0 条 4 定案、非「不过再改」的退路**；过④⑤⑥后才实现 T5 切块消费。

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm --filter @flowweb/shared exec vitest run src/collab/undo-policy.spec.ts src/collab/timeline-gate.spec.ts`
Expected: PASS

- [ ] **Step 5: 跑 shared 全量+双端 tsc（Track.order 波及面首查）**

Run: `pnpm --filter @flowweb/shared test && pnpm --filter @flowweb/web exec tsc --noEmit 2>&1 | head -20`
Expected: shared 全绿；web tsc 若因 Track 缺 order 报错→错误点登记为 T4 改道清单（不本任务修——web 侧构造 Track 的调用点在 T4/T8 补 order；若报错仅测试文件可先把调用点补上 order 字面量 '5000'）

- [ ] **Step 6: Commit（组内不提交，记入第一笔）**

本任务与 T2/T3 同组，组末一次 `git add`+commit（见 Global Constraints commit 纪律）。

---

### Task 2: timelines 根物化+版本 4→5+manifest/frame-deny/oracle/vacuum 四门禁

**Files:**
- Modify: `packages/shared/src/canvas/docShape.ts:59`（SCHEMA_VERSION 4→5；fillDoc :99/:153 加 getMap('timelines') 不放工程）
- Modify: `packages/shared/src/canvas/canvas-doc-manifest.ts:15`（DOC_TOP_LEVEL_MAPS +timelines；层③/④ 注记按 spec §3.2 表）
- Modify: `packages/shared/src/canvas/frame-deny.ts:33/:155`（FRAME_DENY_ROOTS +timelines+矩阵接线）
- Modify: `packages/shared/src/constants/collab-protocol.ts:13`（CLIENT_PROTOCOL_VERSION 4→5）
- Modify: `apps/api/prisma/schema.prisma:905`（CanvasDoc.schemaVersion `@default(4)`→`@default(5)`）
- Create: `apps/api/prisma/migrations/<ts>_canvas_schema_v5_default/migration.sql`（`ALTER TABLE "CanvasDoc" ALTER COLUMN "schemaVersion" SET DEFAULT 5;`——**不 UPDATE 旧行**〔开发库已 4 的行被版本门拒载重置文档，不写数据迁移〕；历史 CREATE TABLE 里的 DEFAULT 4 不动〔c3a-schema.int.spec:110-116 扫历史 SQL 且锁「缺省插入=常量」〕）
- Modify: `apps/api/src/modules/collab/collab-doc-registry.service.ts`（loadDocument 水合完成缝〔applyReplayed/spool 重放后、`this.host.onDocLoadedAndReplayed?.` 前后——以实际行序为准〕：`document.share.has('timelines')` 为假→`document.transact(() => { document.getMap('timelines'); }, SERVER_TRANSACT_ORIGIN)` 不放工程；已有根零事务；**actor install/observeDeep 在这之后对这棵根**；vacuumEquivalent :778-788 **比形状前两侧 getMap('timelines')**——单侧造根=形状比较永远失败〔meta :780-781 假红同根因〕；timelines 内容比较=T9 扩 stableStringify，本任务只落两侧声明+shapeOf 天然覆盖〔根集合守恒〕）
- Modify: `apps/api/src/modules/collab/collab-doc-registry.service.ts`（**rebuildDocFaithful 单源（spec §0 条 7）**：现 rebuildVacuumDoc:748-765 的「fillDoc+其余 Y.Map 根 deepCopyYMap」逻辑抽成 `rebuildDocFaithful(source): Y.Doc|null`〔Text/Array 序列根返 null 维持〕；**rebuildVacuumDoc/rebuildCanonical（collab-maintenance.service.ts:399-411）/exportFreshRun（collab-shrink.service.ts:140-156）三处都只调它**——三处各自手搓第二套拷贝器=禁形；shrink 的 buildRebuildPayload:315 委托天然走 rebuildVacuumDoc 同源）
- Modify: `apps/api/src/modules/collab/collab-maintenance.service.ts`（rebuildCanonical:399-411 改调 rebuildDocFaithful；**EXPORTING:375/VERIFYING:473 hash 面扩 timelines**——recordsOfHydration:388 返回值加 timelines 稳定序列化（stableStringify——T9 单源导出）进 hash，节点/边公开读模型保持原样；canonical 重建删掉时间轴后校验仍过的清盘形态由负控测试钉死）
- Modify: `apps/api/src/modules/collab/collab-shrink.service.ts`（exportFreshRun:141-156 改调 rebuildDocFaithful——现「toReadModel+fillDoc 直写」在时间轴进 doc 后=瘦身副本丢整棵 timelines〔spec §0 条 7〕；瘦身副本带 timelines 后 bytes 口径不变）
- Modify: `apps/api/src/modules/collab/collab-version-gate.spec.ts:170`（现「行=4（当前）→ 放行」改「行=4→拒载；行=5（当前）→放行」——字面量随常量批同笔）
- Modify: `apps/api/src/modules/collab/oracle-worker.service.ts:54`（SCAN_ROOTS +timelines——头注 :23 同步）
- Modify: `apps/api/src/modules/collab/collab-canary-semantic.ts`（stableStringify 导出 :15；canonicalDocView :31 加 timelines 根；SCAN_ROOTS 同文件处若有独立清单同步）
- Test: `packages/shared/src/canvas/canvas-doc-manifest.spec.ts`（既有面扩 timelines 断言）
- Test: `apps/api/src/modules/collab/collab-version-gate.spec.ts`（常量 5 改档）
- Test: `apps/api/src/modules/collab/c3a-schema.int.spec.ts`（@default(5) 缺省插入档——**默认值迁移进库后即绿，不拖到 T8**）
- Test: `apps/api/src/modules/collab/canvas-doc-hydration.int.spec.ts` 或新增 load-root 装置档（装载物化 timelines 根断言）
- Test: `apps/api/src/modules/collab/canvas-doc-t12-vacuum.int.spec.ts`（vacuum shapeOf 先红档——int 池）

**Interfaces:**
- Consumes: T1 的 UNDO_STACK_BASE（manifest 层④ undo scope 注记）。
- Produces: `DOC_TOP_LEVEL_MAPS` 含 'timelines'；`FRAME_DENY_ROOTS` 含 'timelines'；`stableStringify` 从 collab-canary-semantic.ts export（T9 vacuumEquivalent 消费）；`fillDoc` 物化 timelines 根（T7 水合/T9 真空重建消费）；**loadDocument 装载物化 timelines 根**（SERVER_TRANSACT_ORIGIN 零工程根——水合走 applyUpdate 不经 fillDoc、装载缝须主动补根；**同名根就是同一对象**〔spec §0 条 7〕——不存在两客户端各造一棵根的问题；actor observeDeep 在其后）；CANVAS_DOC_SCHEMA_VERSION=5、CLIENT_PROTOCOL_VERSION=5、**CanvasDoc.schemaVersion @default(5)+迁移**（全仓单源同笔——懒插入落 4 会被版本门拒载）；**公开零泄漏结构断言**：doc-codec.ts toReadModel/CanvasReadModel 输出键集不含 'timelines'（公开读模型里根本没有 timelines——结构性保证非先放再剔除——T12 锚 12 载体）。

- [ ] **Step 1: 门禁先红（D13——不先改实现，先跑红）**

Run: `pnpm --filter @flowweb/shared exec vitest run src/canvas/canvas-doc-manifest.spec.ts`
Expected: 红——manifest 键集断言不含 timelines 的现状测试对新增根（若既有断言写死四根则改断言前先确认红的方向=「新根未登记」负控用例先行新增）。

- [ ] **Step 2: 写失败测试（manifest/frame-deny/oracle 三面 timelines 断言+fillDoc 根物化断言）**

manifest：`DOC_TOP_LEVEL_MAPS` 含 'timelines' 且 manifest 派生断言（E17 单源）对新根成立。frame-deny：timelines 根帧（合法 timeline-user 事务形状）准入通过、未准根前 DENY。oracle：SCAN_ROOTS 扫到 timelines 根内 mediaId（喂一个带 mediaId clip 的 doc→canonical hash 变化/SCAN_ROOTS 覆盖断言）。fillDoc：空文档 fillDoc 后 `doc.getMap('timelines')` 存在且 size===0（根物化不种工程）。

- [ ] **Step 3: 跑红**

Run: `pnpm --filter @flowweb/shared exec vitest run src/canvas/canvas-doc-manifest.spec.ts && pnpm --filter @flowweb/shared exec vitest run src/canvas/doc-codec.roundtrip.spec.ts`
Expected: 新增断言红（roundtrip spec 扩一条：doc 带 timelines 根+内容→toReadModel 输出无 timelines 键——现应绿则该断言为回归锁非先红档，登记即可）。

- [ ] **Step 4: 实现（四处单源+版本双 5）**

docShape.ts fillDoc 在 edgesMap 填充后加 `doc.getMap('timelines')`（一行物化——头注引 spec §0 条 7「根集合守恒」）；SCHEMA_VERSION 4→5。manifest DOC_TOP_LEVEL_MAPS 追加 'timelines'（层③ 写者=客户端 LocalUser/timeline-user、读者=编辑器/导出/迷你画布/GC 扫描、层④ undo scope=T1 三根形态——注释按 spec §3.2 表写）。frame-deny FRAME_DENY_ROOTS 加 'timelines'（validateFrameDeny 矩阵接线——timelines 帧谓词详细执法在 T3）。oracle SCAN_ROOTS=['nodes','edges','timelines']。canary stableStringify 加 export 关键字+canonicalDocView 加 timelines 根遍历。registry vacuumEquivalent：shapeOf 比较前 `oldDoc.getMap('timelines'); newDoc.getMap('timelines');`（两侧对称——:780-781 meta 假红根因注记同款防御）。collab-protocol.ts CLIENT_PROTOCOL_VERSION=5。**loadDocument 装载物化**：水合/spool 重放完成后（actor observeDeep 安装之前）`document.share.has('timelines')` 为假→`document.transact(() => { document.getMap('timelines'); }, SERVER_TRANSACT_ORIGIN)`（已有根零事务；头注引 spec §0 条 7（两客户端造根的形态由版本门+同名根同对象共同挡掉））。**schema 默认值同笔**：schema.prisma:905 `@default(5)`+迁移 SQL（ALTER COLUMN SET DEFAULT 5、不 UPDATE 旧行、历史 CREATE TABLE 不动）+collab-version-gate.spec:170 放行值改 5/4 改拒载。baseline：若 census/manifest 门禁有 baseline 文件（grep `--write` 消费点）同 commit 重写。

- [ ] **Step 5: 跑绿+int 池（vacuum 档+缺省插入档+装载物化档）**

Run: `pnpm --filter @flowweb/shared test && pnpm --filter @flowweb/api exec vitest run -c vitest.int.config.ts src/modules/collab/canvas-doc-t12-vacuum.int.spec.ts src/modules/collab/c3a-schema.int.spec.ts`
Expected: 全绿（vacuum int 若因根集合变化红→按两侧 getMap 对称修实现侧不是改测试；c3a 缺省插入档在 @default(5) 迁移进库后即绿；装载物化档断言=loadDocument 后 share 有 timelines 根且根内零键）。

- [ ] **Step 6: 记入第一笔（不单独 commit）**

---

### Task 3: timeline 帧谓词+codec 骨架（Y.Map↔ProjectData 互转+diff 写路径）

**Files:**
- Create: `packages/shared/src/canvas/timeline-codec.ts`（互转+diff+读回排序三档单源）
- Create: `packages/shared/src/canvas/timeline-frame-predicate.ts`（**纯字段检查**——三消费面共用：frame-deny L1 矩阵/L2 timelines 分支/客户端写前自检；span/transform/style/fade/转场/fontSize/mediaId/类型键矩阵逐字段；**删除三级只在 L2 执法（spec §0 条 8）**：合法=clips/tracks/keyframes 里删一条+删整棵 timelines.<nodeId>〔装载重扫 SERVER_TRANSACT_ORIGIN 删片段键——维护写在 applyGate 之外〕；非法=删 version/fps/tracks/clips 四个容器键+已存在键 set 新 Y.Map；〔**L1 不执法删除三级**——validateFrameDeny 只遍历本帧插入的 struct（frame-deny.ts:122-159），删除集只有 client 和 clock、帧内没有这些 item、读不出键名——L1 无法判断删的是 version 还是某个片段；三级与“删除一律合法”的对比只在 L2（已物化事件读得到键名与 action）与客户端写前自检那次 validateAppliedL2〕）
- Modify: `packages/shared/src/canvas/frame-deny.ts`（**双面接线（spec §0 条 8——L1 framePathOf/L2 currentTarget）**：①**L1 两支只检查插入（spec §0 条 8）**——:153-159 已知根直接子项档（**根的直接子项必须是 Y.Map**；tracks/clips/keyframes 三层是 Y.Map 其余槽标量；**容器创建本身合法**——防把工程 Map 当「标量槽里的 Map」拒掉）与 :178 帧内深链档都跑字段谓词；**删除三级不在 L1**（删除集只有 client 和 clock、帧内读不出键名——非法删除由 L2 执法）〔timelines 进 FRAME_DENY_ROOTS 后这两处直接跳过=导入新时间轴树零检查——恢复导入 recovery-import:275 只跑 validateFrameDeny、mode:'read'+origin 'import' 不进 actor=L1 唯一门〕；**父类型不在本帧里的协作改动仍归 L2**〔:142 父出帧不可判定维持〕；②**validateAppliedL2 加 timelines 身份分支（spec §0 条 8——currentTarget 公开面）**：**插在循环第一行、path.length===0 那个总会 continue 的块之前**（插到 :365 节点启发式之前不够——path 空的事件在 :363 已 continue、根上整棵新工程仍不检查），`ev.currentTarget === doc.getMap('timelines')` 时走时间轴谓词然后结束这条事件——**YEvent.currentTarget 是公开字段**（YEvent.d.ts:20；yjs.cjs :3321 observeDeep 回调前赋值、:4558 构造——:330-332 已用身份比对给三根分类、Yjs 无公开 rootName）；**path 空与非空同一条**；**path 空且 action==='add' 新值 Y.Map 时按路径递归这棵值**（同事务 new Y.Map() 填好再 set、子 Map 不另发事件——actor :255 已注记；只查「这是个 Map」漏掉整棵新工程）；**action==='delete' 按三级删除规则**（删 version/fps/tracks/clips 容器键非法——「删除一律合法」会放过拆容器再塞新 Map；删片段/轨道/关键帧条目与整棵 timelines.<nodeId> 合法）；**不写 rootNameOf、不沿 _item.parent 走再反查 doc.share**（根 Map 集成后 _item 保持 null :5050/:5097-5100 属实但那是私有字段——身份比对已够用）；**比较用安装观察者时拿到的那棵根做身份、不在谓词里重新 getMap（身份比较约定）**；**装载重扫 SERVER_TRANSACT_ORIGIN 在 applyGate 之外、下一帧 begin() 清 eventBuffer——不进 validateAppliedL2，不为重扫再开一路 L2**）
- Create: `apps/api/src/modules/collab/timelines-observer.wiring.ts` 或就近接线（**回调内物化 ev.changes 后再 noteEvents——v6 已坐实保持**：`doc.getMap('timelines').observeDeep((events) => { for (const ev of events) void ev.changes; noteEvents(events); })` 接入 actor 安装点 :225-232 一族——**YEvent.changes getter（yjs :4699-4705）在 _changes===null 且 _transactionCleanups.length===0 时抛 errorComputeChanges『You must not compute changes after the event-handler fired』：noteEvents 只推事件进 buffer、事务结束 validateAppliedL2 一读 ev.changes 就抛→actor 收成 l2-internal 毒帧 4411 关该项目全部连接、每笔时间轴编辑都触发**；edges 观察者 :313 已有 `void ev.changes.keys` 物化先例——同款形态；**T3 测试须在事务结束后把缓冲交 validateAppliedL2（缓冲长度>0 盖不住这个抛错）**；监听与 L2 分支同一笔落地、先于部署；**T6 只加绑定用 touched 与并集投影**）
- Modify: `packages/shared/src/canvas/doc-schema-v4.ts` → 更名或扩 v5 矩阵（timelines 谓词+videoGen `videoProjectId` 键改 `sourceNodeId` :210、旧键 forbidden）
- Modify: `packages/shared/src/canvas/schema-contract.spec.ts:22-24`（**spec §0 条 9：videoGen 写面实测键集写死的 `'videoProjectId'` 同批改 `'sourceNodeId'`——**doc-schema 换键而契约测试不改=shared 红**；T3 与换键同一步落地）
- Test: `packages/shared/src/canvas/timeline-codec.spec.ts`
- Test: `packages/shared/src/canvas/timeline-frame-predicate.spec.ts`
- Test: `packages/shared/src/canvas/frame-deny.spec.ts`（既有面扩——L2 timelines 分支+L1 帧内档）

**Interfaces:**
- Consumes: T1 Track.order、T2 timelines 根。
- Produces（T4/T7/T8/T9 消费）:
  - `seedEmptyTimeline(nodeId: string): Y.Map<unknown>`（version=1/fps=30/tracks 含默认轨 `${nodeId}:video` order='5000' 名「视频」/clips 空 Map——**不调 createDefaultProjectData**）；
  - `readTimelineFromDoc(entry: unknown): ProjectData | null`（非 Y.Map 返 null；读回排序=轨 order 再 trackId、片段 start 再 clipId、关键帧 t 再 id；track.clips 推导生成）；
  - `diffProjectDataToDoc(timelines: Y.Map, before: ProjectData, after: ProjectData): Array<(tx: Y.Transaction) => void>`（结构 diff 只改碰到的键；标量整值替换；**禁止给已存在键 set 新 Map**；clip 创建同笔事务放空 keyframes Map（字幕除外）；
  - **不实现 rootNameOf（撤销——私有字段路）**：根身份走 **currentTarget 公开面**——validateAppliedL2 循环第一行 `ev.currentTarget === timelinesRoot` 身份比对（**timelinesRoot=安装观察者时拿到的那棵根、非谓词里重新 getMap（身份比较约定）**；YEvent.currentTarget=YEvent.d.ts:20 公开字段；yjs.cjs :3321 observeDeep 回调前赋值、:330-332 三根身份比对同款先例；临时 doc 自检同源——临时 doc 上 getMap 则创建比对所需的那棵根再同步进来、不同步写入也不会混线上根；_item.parent 链/doc.share 反查不写）；
  - `TIMELINE_FRAME_PREDICATE: (update: Uint8Array, doc: Y.Doc) => { ok: boolean; reason?: string }`（L1 签名适配；**纯字段检查三消费面**：frame-deny **L1 两个分支**〔:153-159 直接子项档〔**根直接子项必须 Y.Map、tracks/clips/keyframes 三层 Y.Map 其余槽标量、容器创建本身合法**〕+:178 帧内深链档——导入整棵新树走这条；**删除三级只在 L2（spec §0 条 8）——L1 帧内读不出键名不执法删除；三级归 L2 与客户端写前自检那次 validateAppliedL2（片段/轨道/关键帧条目与整棵 timelines.<nodeId> 放行、version/fps/tracks/clips 容器键拒；恢复导入只跑 L1、它自己只会删整棵 timelines.<nodeId> 本档合法）**〕/validateAppliedL2 **currentTarget 身份分支**〔循环第一行、path 空 continue 块之前；`ev.currentTarget===timelinesRoot` 走谓词结束事件；**根上 action==='add' 新值 Y.Map 递归检查**；**action==='delete' 三级删除规则**（删容器键非法）；**装载重扫 SERVER_TRANSACT_ORIGIN 在 applyGate 之外不进 validateAppliedL2——不为重扫再开一路 L2**〕/客户端 commit 写前自检〔T4——live transact 前对临时 doc 落这笔：帧 update 跑 validateFrameDeny+物化事件跑 validateAppliedL2 两级，失败 live 不写〕；**谓词下钻 span/transform/style/fade/transitionIn/transitionOut JSON 标量内**——fontSize/opacity/fade.in 都在标量里面；**timelines observeDeep 回调内先 `void ev.changes` 物化再 noteEvents**〔YEvent.changes getter 事后读抛 errorComputeChanges→l2-internal 毒帧 4411 关全部连接——edges :313 同款形态〕与本任务同一笔落地——不放到 T6〔T6 只加绑定 touched 与并集投影〕）；
  - `extractTimelineClipMediaIds(entry: unknown): Array<{ clipId: string; mediaId: string }>`（**codec 导出的 clip mediaId 提取单源**——video/image/audio 按类型键矩阵取 mediaId、空 clipId/空 mediaId 不产行、subtitle 无槽；**T6 collectNodeRefsUnion 消费——不另写独立第二套扫描**）；
  - doc-schema-v5：videoGen 键 `videoProjectId`→`sourceNodeId`（LWW 槽换键、旧键 forbidden——:210）。

- [ ] **Step 1: 写失败测试（codec roundtrip+diff 最小性+谓词负控矩阵）**

codec.spec.ts：①seedEmptyTimeline→readTimelineFromDoc roundtrip=空工程（单默认轨 order '5000'）；②setCanvasSize diff（before 无 canvasSize→after 1920×1080）只写 canvasSize 键、tracks/clips map 不动（断言 update 里无 tracks 键变更）；③双端并发各加一个 clip 到同一棵 Map→两个都在、互不覆盖；④keyframes 随片段出生（创建 video clip 的事务里 keyframes 已是空 Y.Map）；⑤读回排序三档（构造乱序 start 的 clips+order 乱序的 tracks→读回已排序）。
谓词负控矩阵（每类至少一例拒+一例过）：标量槽 Y.Map/Y.Array/Y.Text；NaN/Infinity start；负 sourceStart；非正 duration；空 clipId；canvasSize 负宽；fontSize 非正；fade 负段；mediaId 空串；Transition 非法 type；easing 非 linear；playbackSpeed 3；version 2；fps 24；Map 键≠id；已存在键 set 新 Map（结构拒绝）；subtitle 带 keyframes/mediaId；音量关键帧带 property。
frame-deny.spec.ts 扩（**spec §0 条 8——L1 只查插入/L2 执法删除三级**）：①L1 两个分支——直接子项档（:153-159 形态：timelines 根上新建工程 struct）与帧内深链档（:178 形态：帧内新建片段 span/transform struct）都跑同一按路径字段谓词拒非法值放行合法树；**L1 删除入作不执法三级（删除集只有 client/clock、帧内读不出键名——本档只验插入档谓词面）**；②L2 currentTarget 分支——**根上键增删（path 空）**：分支插在 :363 path 空 continue 块之前、`ev.currentTarget === doc.getMap('timelines')` 命中走时间轴谓词（**负控：分支插在 :365 启发式前=根事件在 :363 已 continue、整棵新工程不检查——插入点钉死**）；**根上 action==='add' 新值 Y.Map**→谓词**递归这棵值**（同事务建好的子 Map 不另发事件——只查「这是个 Map」漏掉新工程=负控）；**根上删 version/fps/tracks/clips 容器键→拒**（「删除一律合法」负控）；删片段键/删整棵 timelines.<nodeId>→放行；入口 Map 直接键事件（path=[nodeId] 改 canvasSize）→**不进节点启发式**（现形态 :383 node-key:* 毒帧误杀——改造后走 timelines 谓词放行合法键）；片段 Map 标量事件（path[1]=clips）非法 duration → L2 拒（现形态 :398 放行——改造后拒）；③改造不破坏现有面——节点/edges/meta 事件照旧执法（回归断言现毒帧用例不动）；④observeDeep 物化——**事务结束后把缓冲交 validateAppliedL2**（不物化 ev.changes 的形态=l2-internal 抛错→毒帧 4411——负控钉死；物化后全部通过；缓冲长度>0 盖不住抛错——断言在事务结束后的读面）。
- [ ] **Step 2: 跑红**

Run: `pnpm --filter @flowweb/shared exec vitest run src/canvas/timeline-codec.spec.ts src/canvas/timeline-frame-predicate.spec.ts src/canvas/frame-deny.spec.ts`
Expected: FAIL（两文件不存在；frame-deny L2 分支未挂）

- [ ] **Step 3: 实现**

timeline-codec.ts：读回=per-node Y.Map→ProjectData（version/fps/canvasSize 直读+tracks Map 逐轨读五键+clips Map 逐片段按键矩阵读+keyframes 按 t/id 排序标量化数组+track.clips 由 order→trackId、start→clipId 推导）；diff=对 before/after 做结构比较产 Y.Map 操作序列（span/transform/style/fade/transitionIn/transitionOut 整值替换、clip 增删走键级、keyframes 增删走键级——**diff 输入基线=「doc 已合入状态」由调用方组合**（T4 拖动档：doc 读回叠本地覆盖层），codec 只对两份 ProjectData diff）；seedEmptyTimeline 按 Interface 描述；extractTimelineClipMediaIds 按类型键矩阵提取（T6 消费单源）。timeline-frame-predicate.ts：**纯字段检查**（Global Constraints 键矩阵封闭集逐条执法——六类拒绝面下钻标量内：span 数字档/transform 五字段/style.fontSize/fade.in/fade.out/transitionIn.duration 等都在整值替换的 JSON 标量里，谓词解包后逐字段执法；**删除三级只在 L2（spec §0 条 8）**：片段/轨道/关键帧条目与整棵 timelines.<nodeId> 删=合法〔装载重扫 SERVER_TRANSACT_ORIGIN 删片段键在 applyGate 之外〕；version/fps/tracks/clips 容器键删=非法〔「删除一律合法」会放过拆容器再塞新 Map〕；**L1 删除集只有 client/clock 帧内读不出键名——三级不进 L1**；其余照旧只检查 add/update 新值。frame-deny.ts **双面接线（spec §0 条 8——L1 只查插入/L2 才执法删除）**：L1 **两个分支**——:153-159 已知根直接子项档（根直接子项必须 Y.Map、容器创建合法、逐字段谓词）与 :178 帧内深链档都跑字段谓词（父类型就在本帧内的 timelines struct；:142 父出帧归 L2 维持）；**validateAppliedL2 加 currentTarget 身份分支**（**循环第一行、path.length===0 那个总会 continue 的块之前**：`ev.currentTarget === doc.getMap('timelines')`→跑谓词→结束这条事件——YEvent.currentTarget 公开字段〔yjs :3321 observeDeep 回调前赋值〕、:330-332 三根身份比对同款；**根上 action==='add' 新值 Y.Map 递归检查**；**action==='delete' 三级删除规则**——删 version/fps/tracks/clips 容器键非法、删片段/轨道/关键帧条目与整棵 timelines.<nodeId> 合法；**不写 rootNameOf 不走 _item/share 私路**；**装载重扫在 applyGate 之外不进本面**）。**actor timelines observeDeep 接线**：`doc.getMap('timelines').observeDeep((events) => { for (const ev of events) void ev.changes; noteEvents(events); })` 挂入 :225-232 安装段——**回调内物化 ev.changes 再 noteEvents**（edges :313 同款——不物化=事务后读抛 errorComputeChanges→l2-internal 毒帧）**与 L2 分支同一笔**（T6 只加绑定 touched）。doc-schema 矩阵：videoGen 换键。

- [ ] **Step 4: 跑绿+shared 全量**

Run: `pnpm --filter @flowweb/shared exec vitest run src/canvas/timeline-codec.spec.ts src/canvas/timeline-frame-predicate.spec.ts src/canvas/frame-deny.spec.ts && pnpm --filter @flowweb/shared test`
Expected: PASS（含 L2 timelines 分支双面新断言+现有 nodes/edges/meta 毒帧用例回归绿+shared 全量）

- [ ] **Step 5: 组末提交第一笔**

```bash
git add packages/shared/src apps/api/src/modules/collab/oracle-worker.service.ts apps/api/src/modules/collab/collab-canary-semantic.ts apps/api/src/modules/collab/collab-doc-registry.service.ts apps/api/src/modules/collab/collab-maintenance.service.ts apps/api/src/modules/collab/collab-shrink.service.ts apps/api/src/modules/collab/timelines-observer.wiring.ts apps/api/src/modules/collab/collab-version-gate.spec.ts apps/api/prisma 2>/dev/null; git commit -m "feat(y4a): timelines doc 域+撤销闸地基——schema v5/manifest/frame-deny/undo-policy/帧谓词"
```

（commit 前：`pnpm --filter @flowweb/shared test && pnpm --filter @flowweb/api test` 全绿+**collab-version-gate.spec.ts 绿〔行=5 放行/4 拒载〕**+**schema @default(5) 迁移已进开发库**〔c3a-schema.int.spec 缺省插入档即绿〕——版本门配套与本笔同 commit，否则第一笔落地后新建项目的懒插入落 4 会被拒载。）

---

### Task 4: 撤销闸执行器+时间轴栈——两帧量法接入 editorStore 写路径

**Files:**
- Create: `apps/web/src/stores/timelineUndo.ts`（时间轴 UndoManager 生命周期+栈项字节累计+undo/redo 拦截）
- Modify: `apps/web/src/stores/canvasUndo.ts`（scope 三根+stackItemBytes 换逆操作字节语义+undoCanvas 硬拒后挡）
- Modify: `apps/web/src/pages/canvas/video-editor/store/editorStore.ts`（commit 改穿 timeline-user 事务+量法前置）
- Test: `apps/web/src/stores/timelineUndo.spec.ts`
- Test: `apps/web/src/stores/canvasUndo.spec.ts`（既有面扩+新拦截断言）

**Interfaces:**
- Consumes: T1 measureTransactionFrames/RESTORE_GATE_BYTES/UNDO_TIMELINE_ORIGIN；T3 diffProjectDataToDoc/readTimelineFromDoc/TIMELINE_FRAME_PREDICATE。
- Produces（T5/T11 消费）:
  - `attachTimelineUndo(nodeId: string, entry: Y.Map): Y.UndoManager`（scope=[entry]、trackedOrigins=['timeline-user']、**captureTimeout=UNDO_CAPTURE_TIMEOUT_MS(500)**、STACK_LIMIT 同源 100、**装回字节表 stackItemRestoreBytes+捕获策略记账**〔与 canvasUndo 正向字节两张表分立——片段/轨道/关键帧增删写前后双 stopCapturing 单独成栈项（栈项装回字节=这笔 undoBytes）；标量窗内之和；写前「栈顶已记+这笔 undoBytes>RESTORE_GATE_BYTES」先切开〕；**装回字节随栈项对象双向抄（spec §0 条 5）**：timelineUndo 弹栈前读栈顶、弹栈后写到新 redo 栈项；timelineRedo 弹栈后同样抄回新 undo 项（undo()/redo() 每次 new StackItem 非挪对象——不抄=缺失当 0、同一次大删除的撤销→重做→再撤销放行））；
  - `timelineUndo(): boolean`（undo() 前读栈项累计**装回**字节>RESTORE_GATE_BYTES→不弹栈+返回 false+提示「单次操作过大」；否则执行）；
  - `timelineRedo(): boolean`（沿用软限额预检同构——redo=再删一次正向帧小）；
  - `clearTimelineStackOf(nodeId: string): void`（删除事务前清被删节点自己的栈——T5 消费）；
  - **两张表纪律（spec §0 条 5——捕获策略记账，不实现 openCapture 重放）**：canvasUndo `doc.on('update')`（:43-46）**继续只写正向表 stackItemBytes**（redoCanvas:112-118 预检消费——不动）；**新 WeakMap `stackItemRestoreBytes` 只记装回字节**、**itemNeedingBytes 同款回填机制**（事件序沿用 :24-26 钉死配对——stack-item-added/updated 在 afterTransaction、doc 'update' 在其后同事务 cleanup；**pendingRestoreBytes=本笔预检量的 undoBytes，update 事件写完立刻清、下一笔不继承；afterTransaction 里无条件清该 origin 的 pending——只有本笔确实发出 update 才把这笔 undoBytes 加到对应栈项上**（删除缺 id/空片段列表这类事务不发 update，只在 update 里清会把待记装回字节挂到下一笔同 origin 栈项上、小撤销被误拦））。**捕获策略**：①片段/轨道/关键帧增删与节点删除=**写之前和写之后都 stopCapturing、每一笔单独成栈项**——栈项装回字节就是这一笔 undoBytes（**预检和入栈用同一个数**）；②标量整值替换（span/transform/style/fade/音量）仍用 500ms 窗、栈项装回字节=窗内各笔 undoBytes 之和（stack-item-updated 增量累加）；③写下一笔之前「当前栈顶已记装回字节+这一笔 undoBytes>RESTORE_GATE_BYTES」→先 stopCapturing、这一笔单独成步；和超闸先切开=**保守方向**（合并后的一帧不会比各笔逆操作之和大到能穿过硬闸；标量一笔 struct 差几十字节量级、500ms 合不了几百笔）。undoCanvas 与 timelineUndo 都在弹栈前读栈项装回字节>RESTORE_GATE_BYTES→不弹栈保持删除态提示「单次操作过大」；**undoCanvas 这道判断放 await import 与 `undoManager !== um` 之后、`um.undo()` 之前**（canvasUndo.ts:85-90 现序保持——S-1 活跃进程取消逻辑不动）；**redoCanvas 消费正向表不动（但 redo 弹栈后抄回新 undo 项的装回字节——双向抄〔spec §0 条 5〕）**；pendingRestoreBytes 按 origin 分开（local-user 与 timeline-user 各持一份）、update 写完就清；
  - editorStore.commit 新语义：`commit(mutate)` =量法（正向+逆操作两帧任一超 262144 拒「单次操作过大」live doc 不写、不调用整棵装回尺）→**live transact 之前对临时 doc 落这笔两级自检：那一帧 update 跑 validateFrameDeny+物化过的事件跑 validateAppliedL2**（失败 live 不写——只跑帧级不够：改已有键时父项不在本帧 L1 跳过、服务端 L2 仍会 4411）→写前栈顶装回预检（标量档）→一条 timeline-user 事务（diff 写——**片段/轨道/关键帧增删档前后 stopCapturing 每笔成步；标量档窗内合并**）→AutoEdge 尾动作；
  - **时间轴栈捕获窗三类+写前栈顶装回预检（spec §0 条 5——与 §0 完全同套）**：片段/轨道/关键帧增删与删除的每一块写前后双 stopCapturing、每笔单独成栈项（栈项装回字节=这笔 undoBytes）；**拖动松手（span 标量整值替换）=同一次手势单独成步、写前写后 stopCapturing——不进 500ms 窗**；其余标量整值替换窗内合并、栈项装回字节=窗内各笔 undoBytes 之和；写下一笔前「当前栈顶已记装回字节+这笔 undoBytes>RESTORE_GATE_BYTES」→先 stopCapturing、这笔单独成步；已入栈项装回字节超 RESTORE_GATE_BYTES 的，undo() 前不弹栈；
  - **片段增删切块算法（spec §0 条 1——按合成帧复测）**：①先按一笔事务量两帧——全过则写一笔；②否则在临时 doc 上按 clipId 排序**逐片段各做一笔（captureTimeout:0）**、记每片段正向字节与逆操作字节；③单个片段任一帧>262144：整笔拒绝 live doc 不动；④否则按逐片段字节**挑候选**贪心装箱——**候选定下后按合成帧复测：落笔前在临时 doc 上把这一箱真的写成一笔、再量这一笔的正向帧和逆操作帧、两帧都要≤262144；任一帧超就把最后一片移出再量**（「两帧之和≤262144」比规格更严且加总不是这一笔的真实大小——废弃）；⑤**候选两帧各跑 validateFrameDeny**（structs/DS Ranges≤16000——undo 装回帧 struct 密度高一档）；箱间对时间轴栈 stopCapturing；⑥**不用 chunkCopyPlan 的 utf8 JSON 预算**；⑦切比例不拆多笔（超限=整笔拒绝）。

- [ ] **Step 1: 写失败测试（量法六档+栈字节累计+域隔离）**

timelineUndo.spec.ts（真实 Yjs 装置）：
①一笔加 clip：forwardBytes/undoBytes 均 ≤262144→写入成功、时间轴栈 +1；
②伪造超限事务（直接构造大 span）→拒绝、live doc 不写、栈不变；
③clientID 顺序档：applyUpdate 之后设 temp.clientID=live.clientID——先设再 applyUpdate 会被 yjs 静默换号、量出来的是另一个 client 的帧（temp.clientID 保持断言）；
④切块（**v3 收紧——按合成帧复测**）：清空一棵大时间轴→单笔两帧量法拒；逐片段档（captureTimeout:0 逐笔记两帧）→贪心挑候选→**候选箱落笔前在临时 doc 写成一笔复测两帧、超了把最后一片移出再量**→每箱一条事务、箱间 stopCapturing、全树清空成功；单片段任一帧仍超→整笔拒 doc 不动；**切比例不拆多笔**（超限整笔拒绝）；不用 chunkCopyPlan 预算；
⑤栈项装回记账（**spec §0 条 5——捕获策略**）：两笔片段删除**各成一步不合成一个栈项**（各自写前后 stopCapturing 断言）；两笔标量整值替换落进同一 500ms 窗→**栈项装回字节=两笔 undoBytes 之和**；第三笔会越闸（栈顶已记+这笔 undoBytes>RESTORE_GATE_BYTES）→**先被 stopCapturing 切开**（单独成步断言）；**pending 不继承**（update 写完就清断言——下一笔不带上一笔的数）；undo 读装回字节>RESTORE_GATE_BYTES→不弹栈档；**负控：把正向 update 用 applyUpdate 灌进克隆再 undo、字节≠measureTransactionFrames 的 undoBytes**（applyUpdate 强制 transaction.local=false :1688-1691、收栈只看 origin :3662-3668、redoItem 对 Map 覆盖项判远端冲突返回 null :9734-9746——**用来禁止把 openCapture 重放加回来**）；**双向抄档（spec §0 条 5）**：删除→undo→redo→再 undo——新 redo 栈项与再生成的新 undo 栈项要么已抄回装回字节、要么再撤销被闸拦住（**缺失当 0 放行=负控钉死**）；**高 clock 合并窗档（spec §0 条 5 锁「和是保守的」）**：高 clock 文档上约 30 笔标量整值替换落同一捕获窗→live 上这一下撤销的未包装字节≤记录的累加值且≤NORMAL_FRAME_GATE_BYTES（合帧不会比各笔逆操作之和更大到穿硬闸——这句假设由测试锁死而非口头声明）；**贴闸档（评审第 4 条）**：同一捕获窗里把记账装回字节累到 518000 以上（多笔大 span 标量）→live 上这一下撤销的未包装字节仍≤524288——不过才把撤销按钮闸从 520096 下调、数字以该次实测为准；
⑥域隔离三行为（spec 锚 4）：timeline-user 事务不动画布栈；LocalUser 画布事务不动时间轴栈；删除→装回后 stableStringify 与删除前一致（无并发档）。
canvasUndo.spec.ts 扩：scope 含 timelines（画布栈捕获 timelines 根删除——undo 带回节点+时间轴）；undoCanvas 后挡（栈项累计>RESTORE_GATE_BYTES 不执行 undo、doc 保持删除态）；redoCanvas 软限额预检不动（现状断言保持）。

- [ ] **Step 2: 跑红**

Run: `pnpm --filter @flowweb/web exec vitest run src/stores/timelineUndo.spec.ts src/stores/canvasUndo.spec.ts`
Expected: FAIL（timelineUndo.ts 不存在；scope 现两根）

- [ ] **Step 3: 实现**

canvasUndo.ts：构造 scope 加 `doc.getMap('timelines')`（UNDO_STACK_BASE 消费——**attachUndoManager 在空文档上、早于同步（canvasCollabRuntime.ts:2067-2068）：同名根同对象（yjs.cjs:614-620/:1467）、早挂零时序风险；**不设 share.has 位位门——scope 缺这棵根则撤销恢复不复活 timelines item（:3535-3545 isParentOf）、删除的撤销带回节点边而时间轴丢失（spec §0 条 7）**）；**两张表分立（spec §0 条 5——捕获策略记账，不实现 openCapture）**——`doc.on('update')`（:43-46）继续只写正向表 stackItemBytes（redoCanvas:112-118 预检消费）；新增 `stackItemRestoreBytes` WeakMap 只记装回字节、**itemNeedingBytes 同款回填机制**（事件序沿用 :24-26 钉死配对——stack-item-added/updated 在 afterTransaction、doc 'update' 在其后；pendingRestoreBytes=本笔预检量的 undoBytes，update 写完就清、下一笔不继承）；**片段/轨道/关键帧增删与节点删除=commit 编排写前后双 stopCapturing**（每笔单独成栈项、栈项装回字节=这笔 undoBytes——预检与入栈同一个数）；**标量档窗内合并=增量累加**（stack-item-updated 时栈项装回字节加上这笔 undoBytes）；undoCanvas **装回闸判断放 await import 与 `undoManager !== um` 之后、`um.undo()` 之前**（canvasUndo.ts:85-90）——读栈项装回字节>RESTORE_GATE_BYTES→return 不弹栈提示「单次操作过大」（S-1 活跃进程取消逻辑不动）；**弹栈前读栈顶装回字节、弹栈后写到新 redo 栈项（与 :88-92 正向字节抄写同位——undo()/redo() 每次 new StackItem 非挪对象、不抄=缺失当 0**）。timelineUndo.ts：attach/detach/clearTimelineStackOf/timelineUndo/timelineRedo 按 Interface（**captureTimeout=UNDO_CAPTURE_TIMEOUT_MS**；装回表同款捕获策略双向抄；timelineUndo 弹栈前读、弹栈后写新 redo 项；timelineRedo 弹栈后抄回新 undo 项）；**写前栈顶装回预检**（栈顶已记+这笔 undoBytes>RESTORE_GATE_BYTES→先 stopCapturing 这笔单独成步）。editorStore.ts commit：`mutate(prev)` 得 next→组合基线（T7 水合后 doc 真值读回）→measureTransactionFrames→**临时 doc 落这笔两级自检（帧 update 跑 validateFrameDeny+物化事件跑 validateAppliedL2）**→写前栈顶装回预检→过闸才 `doc.transact(() => diffProjectDataToDoc(...), 'timeline-user')`（片段/轨道/关键帧增删档前后 stopCapturing；标量档窗内合并）→afterStructuralChange（ensureAutoEdges 现语义 :93-99 保持）；片段增删超限走**切块算法**（captureTimeout:0 逐片段量、贪心挑候选、**候选箱合成帧复测+两帧各跑 validateFrameDeny**、箱间 stopCapturing）；量法函数体内 **applyUpdate 之后** `temp.clientID = live.clientID`（先设会被 yjs 静默换号〔transaction.js:357-360〕、量出来的是另一个 client 的帧）。
- [ ] **Step 4: 跑绿**

Run: `pnpm --filter @flowweb/web exec vitest run src/stores/timelineUndo.spec.ts src/stores/canvasUndo.spec.ts`
Expected: PASS

- [ ] **Step 5: 记入第二笔（不单独 commit）**

---

### Task 5: 删除分割函数——三入口同一函数、剪辑节点先切块清片段再删小节点

**Files:**
- Create: `apps/web/src/stores/canvasDeleteSplit.ts`（分割函数+预检编排单源；**executeDeleteSplit 从计划到最后一笔之间不 await**——切块序一旦让出事件循环、并发编辑会插进块间）
- Modify: `packages/shared/src/canvas/canvas-node-delete.ts`（T1 已建（删除原语+切块表征测试）——本任务只接三条路径，**不再定义**）
- Modify: `apps/web/src/stores/canvasIntents.ts:227-240`（deleteNode 分支改调 shared 删除原语）+`:153` addNode 分支加空工程种点+**canApplyIntent 删除分支 fail-closed（reason `timeline-chunk-required`——带非空片段时间轴的节点经 intent 删除=漏网后挡）+diffProjectionToIntents 删除半边保持产出 deleteNode（ungroup :2457-2466/clearStoryboard/removeStoryboardCell/多图展开四漏斗继续走差分、不改它们的删除形态）——差分删除集含「文档中仍带非空片段」节点时整份差分不派发**
- Modify: `apps/api/src/modules/collab/collab-document.service.ts:414-428`（applyDeleteNodesToDoc 改调 shared 删除原语——**writeBatch 的 deleteNodes 遇非空片段时间轴返回 `timeline-chunk-required` 不在批事务硬删〔spec §0 条 4〕**）
- Modify: `apps/api/src/modules/collab/collab-shrink.service.ts:110/:186/:195`（**spec §0 条 4 服务端逐块化**：影子预演继续量整份文档字节〔8MB 配额〕；**活文档写入改走不包外层事务的会话、由调用方逐块开事务**——现 :110 withDoc 包 shrinkSync、:186 影子预演/:195 活写须改；任一块过不了 validateFrameDeny 或 262144、活文档一笔都不写）
- Modify: `apps/api/src/modules/collab/collab-recovery-import.service.ts:214/:230`（**replace 段 :214 只删 nodes 条目、留 timelines.<id>——不调删除原语〔spec §0 条 4〕**：先删节点再信封加回同 id、信封里没有时间轴——replace 走删除原语再补种空工程=这次导入把该节点的轨道片段清空（timelines.<id> 是新模型唯一一份数据非旧数据兼容问题）；**补条：写回去的节点若不再是 videoEdit，同一笔候选事务里删掉 timelines.<id>**——否则这个键一直占着媒体引用、GC 扔不掉；**effectiveDeletions 段 :230 先对活文档逐块提交并逐块过闸（spec §0 条 4——非单份 commitDiff 一笔）、再克隆候选、再算信封 commitDiff**；**:291 commitDiff 计算前补种——只针对信封里新出现、且 timelines 还没有同名键的 videoEdit**（已有键不 set 新 Map）；悬挂 parentId 仍只剥这个键）
- Modify: `apps/web/src/stores/canvasStore.ts`（deleteNode :1142-1173 **组递归 :1152-1156 删掉、后代由分割函数一次收齐（spec §0 条 3）** 与 onNodesChange :1853-2017 与 **deleteTransformNode :1194（第三条删除入口——spec §0 条 3——现直派 dispatchCanvasIntent({type:'deleteNode'}) 不经预检，改调同一个 executeDeleteSplit）** 改走分割函数各一次；**:2013-2015 二次级联〔removedGroupsChildren 再走 get().deleteNode〕废除**；**store 投影=原语事务后 applyUnifiedDocSnapshot——deleteNode/onNodesChange 里最后一次 store 写入、排在 applyNodeChanges（:1973）之后**（否则 React Flow 的 remove 会把预检留下的节点从 store 拿走、doc 里还在；不按 id 清单平行删 store；nodeStore 清理/unregisterSaveHandler 按分割函数收齐的全部 id〔选中+组全部后代−保护集〕）；**同根同对象（spec §0 条 7）**——getMap 对同名根返回同一对象（yjs.cjs:614-620）不构成「造根」，此处无需 share.has 门；cascadeDeleteVideoProject 三点 :127/:1163/:1856 随 T8 删——本任务先留注释占位）
- Test: `packages/shared/src/canvas/canvas-node-delete.spec.ts`
- Test: `apps/web/src/stores/canvasDeleteSplit.spec.ts`

**Interfaces:**
- Consumes: T1 measureTransactionFrames/RESTORE_GATE_BYTES/UNDO_TIMELINE_ORIGIN/**deleteNodesWithTimelines（T1 已建——本任务只接线不重定义）**；T4 clearTimelineStackOf/timelineUndo 栈；T3 seedEmptyTimeline。
- Produces:
  - `splitDeletePlan(state: { nodes: CanvasNode[] }, removedIds: string[]): { timelineNodes: string[]; others: string[] } & { ancestors: Map<string, string[]> }`（收齐=选中+被删组全部后代〔递归〕；分两类；**祖先组索引**=每个 timelineNode 在删除集里的全部祖先组——纯函数不碰 doc）；
  - `executeDeleteSplit(plan): DeleteSplitResult`（**函数内部不调用 deleteNode（防递归重入）、客户端唯一一次删除写入直接调 deleteNodesWithTimelines、不再派 deleteNode intent（spec §0 条 3）**；逐 timelineNode：清该节点自己的时间轴栈→**切块删片段**（与 T4 清空同一条规则：captureTimeout:0 逐片段量两帧、每块逆操作≤262144、贪心装箱、候选箱合成帧复测、块间 stopCapturing；origin local-user 进画布栈不进时间轴栈；单片段仍超→该节点入 aborted、文档不动）→**最后一笔 local-user 删小节点+连边+已变小的 timelines.<nodeId>**（组骨架仍在最后这笔、排在片段块之后；前后 stopCapturing）；**保护集=aborted 节点+它在删除集里的全部祖先组（都不进最后一笔）**；撤销后进先出：先回「节点在、时间轴已变小」、再逐块装回片段——中间态是文档里的节点非 parentId 悬空；**每笔原语/切块事务之后调 applyUnifiedDocSnapshot(doc)——deleteNode/onNodesChange 里最后一次 store 写入、排在 applyNodeChanges（:1973）之后**（canvasCollabRuntime:1458——与 dispatchCanvasIntent 漏斗尾同一条；否则 React Flow 的 remove 把预检留下的节点从 store 拿走、doc 里还在；**onRemote :2386-2390 见本地 origin 直接返回——本地事务不把 doc 投影回 store，删除后必须主动尾投**；**进程取消按 doc 前后节点 id 的差来做——不再按 id 清单平行删一遍 store**）；**无剪辑节点时 others 合成现状一笔不额外 stopCapturing（500ms 合并窗保持）**；组善后（ungroup/dispatchProjectionDiff）=函数返回之后、最后一次 stopCapturing 之后独立成步）；
  - applyIntentToDoc addNode 分支：节点已存在守卫后 `timelines.set(intent.node.id, seedEmptyTimeline(intent.node.id))`（videoEdit 类型才种）。

- [ ] **Step 1: 写失败测试（分割矩阵+切块保护+组骨架序）**

canvasDeleteSplit.spec.ts（真实 Yjs 装置+假 dispatch）+canvas-node-delete.spec.ts：
①多选两个剪辑节点→各自的片段块加最后一笔共同信封（不是每个节点一笔、也不是两次 dispatch）；
②组含两个剪辑子节点删除→事务序=[剪辑子 1 事务, 剪辑子 2 事务, 组骨架最后事务]——**undo 第一步组骨架整棵回来、第二步/第三步子节点回来、parentId 指向的组已在**（断言 undo 中间态子节点 parentId 不悬空）；
②′**差分漏斗档（spec §0 条 3——四漏斗保持现状）**：ungroup/clearStoryboard/removeStoryboardCell/多图展开各删一个无时间轴节点→差分照常产出 deleteNode、doc 落删（四漏斗删除形态零改动断言）；差分删除集里构造一个「文档中仍带非空片段」的剪辑节点→整份差分不派发+canApplyIntent 对该 deleteNode 拒绝 reason `timeline-chunk-required`（漏网后挡断言）；**executeDeleteSplit 从计划到最后一笔之间无 await**（序完整性断言——并发编辑不能插进块间）；
③**切块失败保护档（spec §0 条 3）**：构造单片段逆操作仍超 262144 的时间轴→该节点入 aborted 不删、文档不动（切块已落地的过闸兄弟保持已删、aborted 节点与其片段原样保留即返回不开切块）、**该节点的全部祖先组都保留（嵌套组档：外层组也不进最后一笔）**；**store 快照序断言：applyUnifiedDocSnapshot 是最后一次 store 写入、排在 applyNodeChanges :1973 之后——React Flow remove 后 store 仍保留 aborted 节点**；
④纯普通节点删除（无剪辑节点）→单事务现状等价（**不额外 stopCapturing——500ms 合并窗保持现状**）；
⑤applyIntentToDoc：addNode videoEdit→timelines.<id> 空工程已种（version/fps/默认轨）；addNode 已存在同 id→不重写；deleteNode→timelines 键同事务消失；**撤销创建→节点与空工程同去；撤销删除→原样装回（stableStringify 一致——无并发档）**；
⑥组善后（dispatchProjectionDiff/删空解组）不并进装回那笔（独立成步断言）；组内有被闸住的剪辑节点时「组空才解组」不拆它（组仍非空）；
⑦**onNodesChange 二次级联废除断言**：组删除经 onNodesChange 一条路径→组 id 与子节点全部经同一 executeDeleteSplit（:2013-2015 形态不再发生——dispatch spy 断言无重入 deleteNode 调用）；**deleteNode :1142-1155 组递归废除断言（spec §0 条 3）**：后代由分割函数一次收齐（单层 parentId 再要深层嵌套组档收不全=负控）；**store 全删除集清理断言（v3 收紧）**：组多选删除→applyNodeChanges 后 store.nodes 不含组后代（React Flow remove 只给选中 id——store 清理按分割函数收齐集〔选中+组全部后代−保护集〕）；预检失败档→store 保留 aborted 节点与保护集祖先组；
⑧**三条路径共用原语+replace 留时间轴+导入补种（spec §0 条 4）**：canvas-node-delete.spec 断言 deleteNodesWithTimelines（**带 origin 形参**——local-user 调用进画布撤销栈、外层事务已有 origin 时嵌套不破）幂等/边级联/timelines 键同删（缺 id=skip、E68 非 map 边跳过）；recovery-import 与 applyDeleteNodesToDoc 各自现有 spec 扩「timelines 键随删」断言（**effectiveDeletions 段**）；**replace 保留断言**：replace 删除既有剪辑节点再信封加回→timelines.<id> 原样保留（轨道片段不清空——replace 不调删除原语）；**补种断言**：信封新出现且 timelines 无同名键的 videoEdit→seedEmptyTimeline 已种；已有键不重种（禁 set 新 Map）。**replace 类型变更断言（spec §0 条 4）**：replace 写回的节点不再是 videoEdit→同一笔候选事务删掉 timelines.<id>；仍为 videoEdit→键原样保留；**deleteTransformNode 断言（第三入口）**：经 deleteTransformNode 删除→同一 executeDeleteSplit（dispatch spy 断言无直派 deleteNode intent 形态、切块同走）；**分割函数直调原语断言（spec §0 条 3）**：删除写入路径只有 deleteNodesWithTimelines 一次调用（无 dispatch deleteNode intent 中转——dispatch spy 钉死）。

- [ ] **Step 2: 跑红**

Run: `pnpm --filter @flowweb/web exec vitest run src/stores/canvasDeleteSplit.spec.ts`
Expected: FAIL（文件不存在）

- [ ] **Step 3: 实现**

canvasDeleteSplit.ts：splitDeletePlan 纯函数（组后代收齐=现 deleteNode :1152-1156 递归形态提取+祖先组索引）；executeDeleteSplit 按 Interface 编排（**不调 deleteNode 防重入、直接调 deleteNodesWithTimelines、不派 deleteNode intent（spec §0 条 3）**；**逐 timelineNode=清栈→切块删片段（T4 切块算法同源复用——captureTimeout:0 逐片段量、每块逆操作≤262144、块间 stopCapturing；单片段超→该节点 aborted）→最后一笔删小节点+连边+已变小的 timelines.<nodeId>**（组骨架仍在最后一笔、排在片段块后）；**每笔切块/原语事务后 applyUnifiedDocSnapshot(doc) 尾投+进程取消按 doc 前后节点 id 差——onRemote :2386-2390 本地 origin 早退=本地事务不会把 doc 投影回 store**）。canvasIntents.ts addNode 分支种点/**deleteNode 分支只删无时间轴或空时间轴节点、遇非空片段拒绝 reason `timeline-chunk-required`（供投影差分与其他 intent 组合用——spec §0 条 3/8）**；**onNodesChange 接线序定案**：删除集与祖先组在 applyNodeChanges 之前从当前 store 算完；**:1893-1897 不再产出 deleteNode intent（resize 等其它 struct intent 留原处）；:1973 applyNodeChanges 之后调用一次 executeDeleteSplit；:2013-2015 二次级联删掉**；**deleteNode 与 onNodesChange 删除路径上的 set(nodes.filter)（:1169-1173/:1973）删掉——store 只由每次事务后的 applyUnifiedDocSnapshot 写回**（快照若被后续 applyNodeChanges/过滤 set 盖掉、预检留下的节点会从 store 消失而 doc 还在）；deleteTransformNode（:1194）同样只调这一次、不直派 deleteNode intent；nodeStore 清理/unregisterSaveHandler 按分割函数收齐的全部 id〔选中+组全部后代−保护集〕；canvasUndo 域 undoCanvas 尾动作零种/删 Map（AutoEdge ensureAutoEdges 维持——现 :80-98 只加拦截不种删）。

- [ ] **Step 4: 跑绿+web 既有面+shared 面**

Run: `pnpm --filter @flowweb/web exec vitest run src/stores/canvasDeleteSplit.spec.ts src/stores/canvasUndo.spec.ts && pnpm --filter @flowweb/shared exec vitest run src/canvas/canvas-node-delete.spec.ts && pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab-recovery-import.service.spec.ts 2>/dev/null || true`
Expected: PASS（recovery-import/applyDeleteNodesToDoc 既有 spec 若因 timelines 键断言挂→随「timelines 键随删」实现同批绿；web 全量若因 editorStore 尚未接水合而挂→登记 T7 接线清单，非本任务回归）

- [ ] **Step 5: 记入第二笔**

---

### Task 6: 绑定投影并集单源——takeBindingDelta/rebuild/slot-write 三调用方+collector 扩根

**Files:**
- Modify: `packages/shared/src/canvas/media-refs.ts`（collectNodeRefsUnion 新单源+collectMediaRefs 聚合扩 timelines）
- Modify: `apps/api/src/modules/collab/collab-project-actor.service.ts`（observeDeep 加 timelines 根 :232 一族+takeBindingDelta :213-218 改并集）
- Modify: `apps/api/src/modules/collab/slot-write.port.ts:62/:99`（槽写快照改并集）
- Modify: `apps/api/src/modules/collab/collab-doc-registry.service.ts:354-396`（**spec §0 条 11——重扫三件**：①**候选收集 :361 改并集 collectNodeRefsUnion 且必须发生在 :363 `candidates.length === 0` 早退之前**——只有片段引用、没有节点槽引用的文档不会被扫到；②剥除=同一 mediaId 集两腿——节点槽走现有 removeMediaRefsForNode（media-refs.ts:113-137）+**时间轴里 video/image/audio 片段 mediaId 命中则删掉该片段键**〔SERVER_TRANSACT_ORIGIN 维护事务在 applyGate 之外不进 L2；**谓词删片段键合法**（三级规则）保证维护写不被拒〕；③**事务内写后快照（:390-396）改并集函数**——现 collectMediaRefsForNode 快照会让 projectBindings 按节点槽盖掉该节点绑定）
- Test: `packages/shared/src/canvas/media-refs.spec.ts`（既有面扩）
- Test: `apps/api/src/modules/collab/collab-project-actor.service.spec.ts`（既有面扩 touched/projection 断言）

**Interfaces:**
- Consumes: T2 timelines 根+公开零泄漏断言（锚 12 载体）；**T3 extractTimelineClipMediaIds（codec 导出的提取单源——不另写独立第二套扫描，键矩阵只有一份）**。
- Produces: **`collectTimelineRefs(timelines: Y.Map<unknown> | DocMapLike, nodes: Y.Map<unknown> | DocMapLike): Map<string, MediaRef[]>`（spec §0 条 11——枚举 timelines 键不从节点在不在推导**：键还在就投影片段行〔nodeId 用这个键〕；**节点已不在而 timelines 同名键还在**（并发删除与编辑、clientID 较大一侧留下这棵 Map）也投片——takeBindingDelta 写 `nodes.has(nodeId) ? union : null` 会把绑定清掉、GC 看不见这段引用；**节点和键都不在才不投**）；`collectNodeRefsUnion(nodeId: string, entry: unknown, timelineEntry: unknown): MediaRef[]`（=collectMediaRefsForNode ∪ extractTimelineClipMediaIds 行〔role='primary'、targetField='mediaId'、targetItemId=clipId——库里 CHECK 已含 mediaId、唯一键带 targetItemId 与节点槽空 targetItemId 不冲突；空 clipId 不产行〕）；**`removeNodeRefsUnion(entry: unknown, timelineEntry: unknown, mediaIds: ReadonlySet<string>): { removedNodeSlots: number; removedClips: string[] }`（剥除腿——同一 mediaId 集：节点槽走现有 removeMediaRefsForNode+时间轴里 video/image/audio 片段 mediaId 命中则删该片段键并返回删掉的 clipId 列表）**；`collectMediaRefs(doc)` 聚合**枚举 timelines 键+nodes 键**同集口径；actor takeBindingDelta/slot-write 快照/**rescanEnforcedMediaRefs 剥除+写后快照**=同函数族（增量=全量=装载重扫同集合；**四调用方都枚举 timelines 键非只在 nodes.entries() 里取 timelines.get(nodeId)**）。

- [ ] **Step 1: 写失败测试（并集三档+touched 语义）**

media-refs.spec.ts 扩：①剪辑节点带 timeline clips（video clip mediaId=m1/image clip mediaId=m2/subtitle clip 无槽）→union 含节点 data 槽行+clip 行（targetItemId=clipId 非空）；②clipId 空串→不产行；③非剪辑节点（无 timelines 键）→与现状同集。actor spec 扩：①只改 timelines.<nodeId>.clips.<cid>.span 的帧→touched 含 nodeId（binding delta 走并集——clip 行不被「节点 data 替换」清掉）；②只改节点 position 的画布帧→touched 不含（position-only 判定 :275-278 不动）；③slot-write 对剪辑节点槽写→快照含 clip 行（不清片段绑定）。**rescan 档（spec §0 条 11）**：装载重扫对「时间轴 clip 引用跨团队 mediaId」→**剥掉该片段键**（SERVER_TRANSACT_ORIGIN 维护事务在 applyGate 之外不进 L2——谓词删除键合法定形）+节点 data 槽同剥；**事务内写后快照=并集函数**；**纯片段引用档**：doc 只有 clip 引用无节点槽引用→重扫仍触达（候选收集发生在 :363 早退之前断言）；**悬空键档（spec §0 条 11）**：节点已删、timelines.<id> 仍在（构造并发残留形态）→collectMediaRefs/takeBindingDelta 都投该键片段行（`nodes.has(id)?union:null` 会清掉绑定的形态=负控钉死）；合法 clip 行保留。int 池 binding-rebuild 档（既有 c3a int 若可复用）：rebuild 后 clip binding 与帧投影同集。

- [ ] **Step 2: 跑红**

Run: `pnpm --filter @flowweb/shared exec vitest run src/canvas/media-refs.spec.ts && pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab-project-actor.service.spec.ts`
Expected: 新断言红（union 不存在/actor 无 timelines observe）

- [ ] **Step 3: 实现**

media-refs.ts：**collectTimelineRefs 枚举 timelines 键**（键在即投片段行——不查 nodes.has；节点键双亡才不投）+union 函数（timeline clips 扫描=**T3 codec 导出的 extractTimelineClipMediaIds**——键矩阵单源不第二套）+**剥除腿 removeNodeRefsUnion**（节点槽走现有 removeMediaRefsForNode+时间轴 video/image/audio 片段 mediaId 命中删片段键——一对函数都认识片段槽）；collectMediaRefs 聚合改** timelines 键∪nodes 键**双枚举 union。actor：observeDeep 安装点（:225-232 一族）——**timelines 根 observeDeep 已在 T3 同笔挂上（回调内物化 ev.changes）**；本任务只加**绑定用 touched**（path 首段=剪辑节点 id 并入 touched；position-only 判定不扩——timelines 路径永不 position-only）与**并集投影**（takeBindingDelta：touched 含该键且键在→投片段行〔nodeId 用键〕；节点在另并节点槽；**双亡才 null**）。slot-write.port.ts 两处快照改 union。**registry rescanEnforcedMediaRefs**：①候选收集 :361 改 timelines∪nodes 双枚举 union（**在 :363 早退之前**）；②剥除 :391-393 改 removeNodeRefsUnion（两腿同事务）；③**写后快照 :394-396 改 union**（同事务回调内——禁另开读会话）。

- [ ] **Step 4: 跑绿+int 池**

Run: `pnpm --filter @flowweb/shared test && pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab-project-actor.service.spec.ts && pnpm --filter @flowweb/api exec vitest run -c vitest.int.config.ts src/modules/collab/binding-rebuild.int.spec.ts`
Expected: PASS

- [ ] **Step 5: 记入第二笔**

---

### Task 7: editorStore 水合+写穿接线+拖动覆盖层+重绑语义

**Files:**
- Modify: `apps/web/src/pages/canvas/video-editor/store/editorStore.ts`（loadProject 改 doc 水合；history.ts 快照史整删；transient/拖动改覆盖层）
- Modify: `apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.tsx`（upsert 加载改订阅既有 Map；关闭排空三选 modal/autosave 挂点整删）
- Delete: `apps/web/src/pages/canvas/video-editor/persist/autosave.ts`（整链随 T8——本任务先删 Shell 消费点，文件删除在 T8 commit 同笔）
- Delete: `apps/web/src/pages/canvas/video-editor/timeline/history.ts`
- Test: `apps/web/src/pages/canvas/video-editor/store/editorStore.spec.ts`（既有面改造）
- Test: `apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.test.tsx`

**Interfaces:**
- Consumes: T3 readTimelineFromDoc/diffProjectDataToDoc；T4 attachTimelineUndo/timelineUndo/timelineRedo+commit 新语义；T5 addNode 种点（编辑器只订阅已存在 Map——键不在不创建）。
- Produces:
  - editorStore.loadProject 新语义：`(nodeId) => { entry = doc.getMap('timelines').get(nodeId); if (!entry) return; data=readTimelineFromDoc(entry); attachTimelineUndo(nodeId, entry); status='ready' }`（**同名根同对象——getMap 对同一个名字返回同一棹根（yjs.cjs:614-620）、这里不是造根（spec §0 条 7：v6 share.has 守卫撤除——早挂 scope 同款同理）**；订阅=observeDeep entry→读回 data setState；**键不在不创建工程**）；
  - editorStore.undo/redo=timelineUndo()/timelineRedo()（PreviewPlayer:135-138 与 useEditorKeyboard:24-26 既有两入口自动改道——不换按钮）；
  - 拖动语义：transient 阶段=本地覆盖层（不写 doc）；松手=组合基线 `readTimelineFromDoc(entry)` 叠覆盖层作 before、UI 终值作 after→commit（一条 timeline-user 事务+前后 stopCapturing——栈恰+1）；**片段键或轨道键已没了（并发删除）→丢覆盖层**；
  - 重绑语义（**spec §0 条 7——听 timelines 根上该 nodeId 键的替换与删除，非仅 observeDeep 子 Map**：子 Map 被换掉之后，旧 Map 上的监听收不到替换事件）：节点在、Map 被换→**根键监听**捕获 → 销毁旧 UndoManager（先 clear()——避免对已脱离父键的 Map 再 undo）再绑当前这棵、本地覆盖层作废、时间轴栈从空栈开始；节点没了（键删除）→编辑器关掉；**observeDeep 回调只 setState 读回，不调用 commit**（写路径唯一入口=commit——防 observe→commit 循环）。

- [ ] **Step 1: 写失败测试（水合/写穿/拖动/重绑四组）**

①水合：doc 里 timelines.<nodeId> 含两轨三片段→loadProject→editorStore.data 等价 readTimelineFromDoc（track.clips 排序已生成）；键不存在→status 停 loading 不创建不抛；
②写穿 roundtrip：commit 加 clip→doc 里 clips Map 新键+span 标量+keyframes 空 Map→读回等价；undo→doc 回到 before（stableStringify 一致）；
②′公开零泄漏（spec 锚 12）：doc-codec toReadModel 输出对带 timelines 的 doc 断言键集不含 timelines（结构性——非剔除后比对）；
③拖动零中间写（spec 锚 8）：transient 改 start→对端 doc 观察回调零触发；松手 commit→对端见终值、**栈恰+1（松手=span 标量但同一次手势单独成步：事务前后双 stopCapturing 断言——不走 500ms 窗）**；**diff 基线=doc 已合入状态叠覆盖层——并发改过的另一片段键不被写回**（远端把 clip B 的 start 改 5、本地只拖 clip A→commit 后 clip B 在 doc 里仍是 5）；
④重绑（**spec §0 条 7 形态**）：手动 set 新 Map 换掉 entry→**timelines 根键监听**捕获替换（非旧子 Map 上的 observeDeep）→重绑后栈空、旧 manager destroyed（clear() 已调）；键删除→根键监听捕获→编辑器 close；**observeDeep 回调只 setState——断言 commit 不被 observe 触发**（写路径唯一入口）。
⑤创建唯一性（spec 锚 7）：第二端从不调「给已存在键 set 新 Map」；两端同 Map 各加一个片段→两个都在、撤销互不吃对方栈。

- [ ] **Step 2: 跑红**

Run: `pnpm --filter @flowweb/web exec vitest run src/pages/canvas/video-editor/store/editorStore.spec.ts`
Expected: FAIL（loadProject 现为 REST 形态）

- [ ] **Step 3: 实现**

editorStore.ts：状态面改 sourceNodeId 为主键（projectId/baseUpdatedAt/title 退场——**编辑器组件 identity 接线表**：ExportModal:22-24 三函数 currentEditorProjectId/currentEditorProjectTitle 改读 `useVideoEditorStore.sourceNodeId`/EditorTopBar 常量「多轨剪辑」、currentEditorSourceNodeId 已是正确主键保留；VideoEditNode 迷你画布/ExportModal data 读改 doc 读回缓存）；**AssetPanel useTeamAssets 改订 `useCanvasStore.teamId`**（spec §3.3——page.tsx:55/:88 加载时已 setTeamId，删经行派生入参）；loadProject 改 doc 水合+attachTimelineUndo+**水合完成时 AutoEdge 对账一次**（补崩溃窗没写上的边——ensureAutoEdges 现函数）；clip.sourceNodeId 写前检查（源节点不在不发事务——canvas-invariants clipSourceNodeExists 注释同批改写侧说明）；commit 接 T4 事务写（mutate 形态保持——上层组件不动）；undo/redo 改 timelineUndo/timelineRedo；history.ts import 全删；**unloadGuard/editorDirty REST 闩随链删**（grep currentEditorProjectId 落点：unloadGuard.ts 若引用 projectId 闩→删该闩；VideoEditorShell autosave 挂点同删）。VideoEditorShell.tsx：`open` effect（:76-90）改订阅既有 Map（upsertProject/getProjectByNode/createAutosaveController 调用全删）；三选 ConfirmModal（:133-168）删；关闭=直接关。VideoEditNode.tsx:45-46 迷你画布改内存 doc 直读（zero REST）。

- [ ] **Step 4: 跑绿+web tsc**

Run: `pnpm --filter @flowweb/web exec vitest run src/pages/canvas/video-editor/store/editorStore.spec.ts src/pages/canvas/video-editor/components/VideoEditorShell.test.tsx && pnpm --filter @flowweb/web exec tsc --noEmit`
Expected: PASS+0 错（videoProjectApi 剩余消费=ExportModal register 载荷与 T8 删除面——tsc 应干净，登记例外）

- [ ] **Step 5: 组末提交第二笔**

```bash
git add apps/web/src packages/shared/src apps/api/src/modules/collab; git commit -m "feat(y4a): 时间轴写穿 Y——codec/editorStore/分割函数/绑定并集"
```

（commit 前 web 全量+shared 全量绿。）

---

### Task 8: VideoProject 表整删+REST autosave 链退场+读链改道

**Files:**
- Modify: `apps/api/prisma/schema.prisma:500-518`（model VideoProject 删除——**User:41/Team:167/CanvasProject:766 三处 `videoProjects VideoProject[]` 关系字段随 model 同删**，否则 prisma generate 失败）
- Create: `apps/api/prisma/migrations/<ts>_drop_video_project/migration.sql`（一条 DROP TABLE——手写 SQL 迁移）
- Modify: `apps/api/src/modules/video-project/video-project.controller.ts`（POST /、GET by-node、PATCH :id、DELETE by-node 四路由删；留 regenerate/export-precheck/register/confirm）
- Modify: `apps/api/src/modules/video-project/video-project.service.ts`（upsertByNode/getByNode/patch/deleteByNode/defaultProjectData 删；exportPrecheck :127-137 保持〔teamId 已从 CanvasProject 派生 :130-135 零依赖表〕）
- Modify: `apps/api/src/modules/video-project/generated-media.service.ts`（register :28/:61 videoProjectId 字段保留=元数据字符串非 FK——**零改动**；若 prisma client 类型因表删报错→DTO 键保持字符串校验不动）
- Modify: 登记面核销（全部 grep `VideoProject` 收口）：`apps/api/src/modules/collab/scope-column.registry.ts:80/:101/:131`、`lifecycle-obligation.sweeper.ts:196-207`（级联臂删+NODE_DELETED 义务文案）、`media-referrer.registry.ts:116-124`（VideoProject 臂删+collectJsonMediaIds 引用清）、`project-erasure.stages.ts:22/:278/:286`（引用图文案改）、`project-erasure.assert.ts:117`（豁免行删）、`collab-document.service.ts`（grep videoProject 零命中则不动）
- Modify: `packages/shared/src/collab/lifecycle.ts:26`（**OBLIGATION_KIND_CONSUMERS.NODE_DELETED 文案去 VideoProject 级联段——义务种类枚举本身不动**）+`packages/shared/src/collab/lifecycle.spec.ts`（VideoProject 字面量同改）
- Modify: `apps/web/src/pages/canvas/video-editor/export/product-node.ts`（grep 落点——videoProjectId 写点改 sourceNodeId；**T3 doc-schema videoGen 槽已换键，本任务改组件/REST 写点同链**）
- Modify: `apps/web/src/api/videoProjectApi.ts`（upsertProject/patchProject/getProjectByNode/deleteProjectByNode 删；register/exportPrecheck/regenerate fetch 保留——**RegisterGeneratedDto 契约随 spec §3.5 re-key**：成片去重键/register 元数据 `videoProjectId` 改 `sourceNodeId`〔doc 字符串非外键——generated-media.service.ts:61 metadata 与 dto.ts:23 键名同批改，RegisterGeneratedDto 契约变更进验收面〕；公开快照/video-work 剥离名单同改剥 sourceNodeId——grep `videoProjectId` 收口：product-node 写点〔spec §3.2 doc-schema-v4:210 已在 T3 换键〕+video-work 剥离+公开页〕）
- Modify: `apps/web/src/stores/canvasStore.ts:127/:1163/:1856`（cascadeDeleteVideoProject+deleteProjectByNode import :16 删）
- Delete: `apps/web/src/pages/canvas/video-editor/persist/autosave.ts`
- Test: `apps/api/src/modules/video-project/video-project.controller.spec.ts`（路由面断言）
- Test: `apps/api/src/modules/collab/lifecycle-obligation.sweeper.spec.ts`（既有面——级联臂删除断言）

**Interfaces:**
- Consumes: T7（编辑器已零依赖表）。
- Produces: prisma client 无 videoProject 委托（`npx prisma generate` 重生成）；sweeper NODE_DELETED 只剩 MediaBinding 入队+ArtifactProjection 收尾两臂；media-referrer 只剩 doc/node 族扫描臂。

- [ ] **Step 1: 写失败测试（真源归一 grep 门+路由面）**

controller spec：POST /、GET by-node/:id、PATCH :id、DELETE by-node/:id 四路由 404/不存在断言（Nest 未注册路由=404）；regenerate/export-precheck/register/confirm 四路由保持 200 契约。sweeper spec：NODE_DELETED 处理后 `prisma.videoProject` 零调用（mock spy 断言）。

- [ ] **Step 2: 跑红**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/video-project/video-project.controller.spec.ts src/modules/collab/lifecycle-obligation.sweeper.spec.ts`
Expected: 新断言红

- [ ] **Step 3: 实现（一条迁移+登记面核销）**

schema.prisma 删 model（含 User videos 关系字段）；migration.sql 手写 `DROP TABLE IF EXISTS "VideoProject";`（开发期无存量——不搬数据不建备份表）；`npx prisma generate`（经 .pnpm 实路径——本机 psql/docker 不在 PATH，prisma 走 prisma generate 不触 DB）；controller/service/web api 面删；登记面逐行核销（scope-column 数组两处+别名行、sweeper :207 deleteMany 臂+义务文案、media-referrer :116-124 臂、erasure stages/assert 文案与豁免）；canvasStore 三点删；autosave.ts 文件删（Shell 消费点 T7 已清）。collectJsonMediaIds 函数本身保留（media-gc JSON 深扫还有其它 JSON 消费面与否按 grep 定——只删 VideoProject 调用点）。

- [ ] **Step 4: 跑绿+双端 tsc+int 池**

Run: `pnpm --filter @flowweb/api test && pnpm --filter @flowweb/api exec tsc --noEmit && pnpm --filter @flowweb/web exec tsc --noEmit && pnpm --filter @flowweb/api exec vitest run -c vitest.int.config.ts src/modules/collab/c3a-schema.int.spec.ts`
Expected: 全绿（prisma client 重生成后旧委托引用全消）

- [ ] **Step 5: 真源归一 grep 门（spec 锚 1）**

Run: `grep -rn "VideoProject" apps/api/src apps/web/src packages/shared/src --include=*.ts | grep -v spec | grep -v test | grep -v "generated-media"` 
Expected: 零命中（generated-media register 元数据字符串注释豁免；erasure/scope-column/sweeper/media-referrer 全清）；
再跑 `grep -rn "videoProjectId" apps/api/src apps/web/src packages/shared/src --include=*.ts | grep -v spec | grep -v test`
Expected: 零命中（register DTO 键/生成物 metadata 键/video-work 剥离/公开快照全改 sourceNodeId——T3 doc-schema 键+本步 REST/公开面同收口）

- [ ] **Step 6: 记入第三笔（不单独 commit）**

---

### Task 9: 重建单路验收+真空等价扩 timelines+canary 语义摘要+GC 媒体扫描

**Files:**
- Verify: `apps/api/src/modules/collab/collab-doc-registry.service.ts`（rebuildDocFaithful（T2 已抽）三消费只剩单源——rebuildVacuumDoc 本体改薄壳调它；vacuumEquivalent 内容比较扩 timelines stableStringify）
- Verify: `apps/api/src/modules/collab/collab-maintenance.service.ts`（rebuildCanonical 只调 rebuildDocFaithful；EXPORTING:375/VERIFYING:473 hash 含 timelines 稳定序列化）
- Verify: `apps/api/src/modules/collab/collab-shrink.service.ts`（exportFreshRun 只调 rebuildDocFaithful——瘦身副本带 timelines）
- Modify: `apps/api/src/modules/collab/collab-canary-semantic.ts`（canonicalDocView timelines 根语义）
- Modify: `apps/api/src/modules/media-delivery/media-gc.service.ts`（GC 引用扫描扩 timelines——若走 collectMediaRefs 聚合则 T6 已覆盖，仅断言）
- Test: `apps/api/src/modules/collab/canvas-doc-t12-vacuum.int.spec.ts`（既有面扩 timelines 档+重建三路断言）
- Test: `apps/api/src/modules/collab/collab-maintenance.t27.int.spec.ts`（**重建三路档（spec §0 条 7）**——canonical 重建后 timelines 仍在+hash 校验含 timelines）

**Interfaces:**
- Consumes: T2 rebuildDocFaithful 单源+两侧 getMap 防御+stableStringify 导出；T6 union 聚合。
- Produces: vacuumEquivalent 全根语义=shapeOf（除 exec）+nodes/edges toReadModel 深比+timelines stableStringify 深比；**三路重建（vacuum/canonical/exportFresh）全部只调 rebuildDocFaithful、hash/等价比较全部含 timelines**。

- [ ] **Step 1: 写失败测试（真空内容等价三档+空根档+重建三路档）**

int spec（真实 doc 装置）：
①两侧先声明 timelines 根（空根）→真空形状比较为真（空根档不假红）；
②doc 带一棵真实时间轴（两轨三片段+关键帧）→vacuum 前后 stableStringify(timelines) 相等；
③**负控**：deepCopyYMap 漏拷一个片段（mock 变异/手动构造 fresh 缺片段）→比较为假；
④canary：timelines 内容变化→canonical hash 变化（oracle SCAN_ROOTS T2 已扫——本档断言 canary 视图含 timelines）；
⑤**重建三路档（spec §0 条 7）**：带 timelines 的 doc→rebuildCanonical 路径重建→timelines 仍在（stableStringify 相等；**负控=改前形态只 toReadModel+fillDoc 会丢 timelines——钉死清盘形态已修**）；exportFreshRun 路径→瘦身副本 doc 含 timelines；VERIFYING hash 对「重建删掉 timelines」的变异 doc 判 mismatch。

- [ ] **Step 2: 跑红（int 池）**

Run: `pnpm --filter @flowweb/api exec vitest run -c vitest.int.config.ts src/modules/collab/canvas-doc-t12-vacuum.int.spec.ts src/modules/collab/collab-maintenance.t27.int.spec.ts`
Expected: ②③⑤红（vacuumEquivalent 现只比 toReadModel；重建/哈希面现不含 timelines）

- [ ] **Step 3: 实现**

rebuildVacuumDoc :748-765 本体改薄壳（**rebuildDocFaithful 单源**——T2 已抽、本任务核销三消费只调它：rebuildCanonical/exportFresh 两处替换+循环迁入单源；**验证注释头 U-2 守恒已登记**）；vacuumEquivalent :786 后加 `stableStringify(exportTimelineView(oldDoc.getMap('timelines'))) === stableStringify(exportTimelineView(newDoc.getMap('timelines')))`（exportTimelineView=canary 文件内 timelines 读回视图小函数——stableStringify 消费）；recordsOfHydration+EXPORTING/VERIFYING hash 面加同一 exportTimelineView 稳定序列化进 hash（节点/边公开读模型保持原样）；canary canonicalDocView 加 timelines 遍历。GC 侧验证=collectMediaRefs 聚合（T6 union 已含 timeline 行）→media-gc 引用面天然覆盖（补一行断言即可，若 media-gc 有独立直扫臂则同改 union）。

- [ ] **Step 4: 跑绿（int 池+api 全量）**

Run: `pnpm --filter @flowweb/api exec vitest run -c vitest.int.config.ts src/modules/collab/canvas-doc-t12-vacuum.int.spec.ts && pnpm --filter @flowweb/api test`
Expected: PASS

- [ ] **Step 5: 本任务不提交（第三笔提交点在 T10 之后——commit 纪律）**

T9 全绿即完成，`git add`/`git commit` **延后到 T10 双客户端 int spec 落盘绿了之后**（四笔结构与提交信息不变——见 Global Constraints commit 纪律第三笔条）。

---

### Task 10: 双 client 协作装置 int spec（E40 复用）——A 拖→B 互见→A undo→B 回滚

**Files:**
- Create: `apps/api/src/modules/collab/collab-timeline-collab.int.spec.ts`
- Consumes: `apps/api/src/test-utils/dual-client-server.ts`（E40 现成装置）

**Interfaces:**
- Consumes: T2-T7 全链（双 client 经真实 WS 装置连单进程 Server；帧谓词放行 timeline-user 事务；undo 装回帧合法区间）。
- Produces: 协作验收锚 2/4/7/8/9 的端到端载体（A 端 timeline-user 事务→B 端 doc 观察→A 端 undo→B 端回滚断言）。

- [ ] **Step 1: 写失败测试（协作四锚）**

装置=dual-client-server 起 Server+两 client 连同一 doc：
①A 拖 clip（一条 timeline-user 事务）→B 端读回 start=终值（互见锚 2）；
②A undo→B 端读回回滚值（锚 2 后半）；
③域隔离：A 端画布栈长度在 timeline 事务前后不变、A 端时间轴栈在画布事务前后不变（锚 4①②）；
④A、B 各加一个 clip 到同一时间轴→两个都在、A undo 只撤 A 的（锚 7）；
⑤A 拖动过程（transient 覆盖层）B 端 doc 零变化、松手一笔（锚 8——本档在 int 装置模拟 transient=B 端断言窗内零 update）；
⑥A 删除剪辑节点→B 端节点与时间轴同去；A undo→B 端两者同回（锚 9 装回档）。

- [ ] **Step 2: 跑红（int 池）**

Run: `pnpm --filter @flowweb/api exec vitest run -c vitest.int.config.ts src/modules/collab/collab-timeline-collab.int.spec.ts`
Expected: FAIL（ timelines 根帧 DENY 或装置未接 timelines 事务形态——视 T2 已落则表现为 undo 域断言红）

- [ ] **Step 3: 实现测试（纯测试任务——断言全部经装置既有 API；实现侧若红按红因归位对应任务回修）**

- [ ] **Step 4: 跑绿**

Run: `pnpm --filter @flowweb/api exec vitest run -c vitest.int.config.ts src/modules/collab/collab-timeline-collab.int.spec.ts`
Expected: PASS

- [ ] **Step 5: 组末提交第三笔（T8/T9/T10 全绿后此步提交——commit 纪律）**

```bash
git add apps/api apps/web/src packages/shared; git commit -m "refactor(y4a): VideoProject 表整删+REST autosave 链退场+读链改道"
```

（commit 前 api 全量+双端 tsc 绿；**两条 grep 门〔T8 Step 5 VideoProject/videoProjectId〕零命中**；迁移文件与本 int spec 同 commit。）

---

### Task 11: canUndo/canRedo 事件驱动 UI

**Files:**
- Create: `apps/web/src/stores/undoUiStore.ts`（zustand——per-manager canUndo/canRedo 布尔）
- Modify: `apps/web/src/pages/canvas/video-editor/components/PreviewPlayer.tsx:135-138`（两颗改接 timelineUndoManager 栈事件）
- Modify: `apps/web/src/pages/canvas/components/CanvasTopBar.tsx`（新增 undo/redo 两颗接 canvasUndo）
- Test: `apps/web/src/stores/undoUiStore.spec.ts`
- Test: `apps/web/src/pages/canvas/components/CanvasTopBar.test.tsx`

**Interfaces:**
- Consumes: T4 attachTimelineUndo 返回的 manager+canvasUndo getUndoManager。
- Produces: undoUiStore `{ canvasCanUndo, canvasCanRedo, timelineCanUndo, timelineCanRedo }`+两管理器 stack-item-added/updated/popped+undo/redo 事件订阅→布尔同步。

- [ ] **Step 1: 写失败测试（事件驱动禁用态——断言不轮询）**

undoUiStore.spec.ts：manager 空栈→canUndo false；一笔事务→事件驱动变 true（**断言不轮询=订阅事件计数——0 个 interval/timeout**）；undo 弹栈→变 false；undo 出现 redo 项→canRedo true。CanvasTopBar.test.tsx：两按钮渲染+disabled 态随 store。

- [ ] **Step 2: 跑红**

Run: `pnpm --filter @flowweb/web exec vitest run src/stores/undoUiStore.spec.ts src/pages/canvas/components/CanvasTopBar.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现**

undoUiStore：attach/detach 时订阅四事件族（stack-item-added/updated/popped+undo/redo——um.on 同 canvasUndo 模式）→set 布尔；PreviewPlayer 两颗 onClick 改 timelineUndo()/timelineRedo()（aria-label 「撤销」「重做」保持——测试选择器零变）；CanvasTopBar 加 undo/redo 两颗（undoCanvas/redoCanvas——键盘 useGroupKeyboard:42-44 路由不动）。

- [ ] **Step 4: 跑绿+ui-ux 面**

按钮形态遵循画布页现有按钮风格（CanvasTopBar 既有 icon button 同款 className——**ui-ux-pro-max 技能在前端 UI 面启动时加载**，本任务两颗按钮为既有模式复制非新设计面）。

Run: `pnpm --filter @flowweb/web exec vitest run src/stores/undoUiStore.spec.ts src/pages/canvas/components/CanvasTopBar.test.tsx`
Expected: PASS

- [ ] **Step 5: 记入第四笔**

---

### Task 12: 批末收口——verify full+双端 tsc+基线

**Files:**
- 全仓门禁（无新文件——census/manifest baseline 若有 --write 消费点随 T2 已同 commit）

**Interfaces:**
- Consumes: T1-T11 全部。

- [ ] **Step 1: 全量门禁**

Run: `pnpm --filter @flowweb/shared test && pnpm --filter @flowweb/api test && pnpm --filter @flowweb/web test && pnpm --filter @flowweb/api exec vitest run -c vitest.int.config.ts && pnpm --filter @flowweb/web exec tsc --noEmit && pnpm --filter @flowweb/api exec tsc --noEmit`
Expected: 全绿（api ~316f 族/web ~4170 族/shared ~823——基线见 memory；新增 spec 全计数）

- [ ] **Step 2: verify full 36 步**

Run: `pnpm verify`
Expected: 36/36 绿

- [ ] **Step 3: 验收锚逐条过（spec §9 十四锚清单核对——执行者在报告里逐锚标绿/红）**

锚 1 grep 门（T8 Step 5）/锚 2-4 协作（T10）/锚 5 基线（本步）/锚 6 UI（T11）/锚 7-8 唯一性拖动（T7/T10）/锚 9 删除带回（T5/T10）/锚 10 真空（T9）/锚 11 绑定并集（T6）/锚 12 公开零泄漏（doc-codec toReadModel 无 timelines——T2 结构断言）/锚 13 两帧量法（T4）/锚 14 键矩阵（T3）。

- [ ] **Step 4: 组末提交第四笔**

```bash
git add -A; git commit -m "feat(y4a): canUndo UI+双端收口 verify"
```

- [ ] **Step 5: 呈报**

四笔 commit+verify 36/36+十四锚逐条状态+双端 tsc 0 错——交用户销案门。
