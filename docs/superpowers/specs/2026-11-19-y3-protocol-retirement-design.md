<!-- doc-status: active | created: 2026-11-19 | v2.8（2026-11-19 plan 外审五轮——五组逐锚核实全实锤：worker done 黑名单 403〔collab-write.controller:36/:122-124〕+端口 permanent 吞错不上抛〔collab-write.port:219-227〕+作废行 superseded 永不被 poller 领〔artifact-commit:631-639+poller claim:206-213 只领 pending/projecting〕+mergeSlot 只比 nodeVersion〔runtime-projection:98-102——nodeVersion=feedSeq 后写恒大〕+loading 无 execSeq〔execution.service:416/:865〕；**v2.7 定案③「四臂直接 writeExecStatus done」在生产链路写不进——认账重写**：①**作废终态改投影 poller 单写**——四臂照旧只交 authorVoid、作废行初始态 superseded→pending〔commit 返回仍 outcome:'superseded'/幂等短路按键查〕、poller 查 NodeArtifact 之前认 author-void: 前缀岔开〔不走 deliverArtifact——必写 exec.artifact 且 artifactRev=0 撞他 0 代幂等键；不岔开会走 artifact-missing orphaned〕——事务内 nodeId+intentId+execSeq+status=done 查重后单写一条 exec.status done〔行身份+attempts 从 GenerationIntent 行读〔投影行 attempts 列=重试计数非生成次数〕、不带 error、零 exec.artifact〕+行标 projected+notifyProject；fence 拒档/节点已删=不写 Feed 不调 refundOrphaned〔钱已核销产物在素材库；R3 窗⑥ JOIN NodeArtifact 认不出作废键不误扫〕行标终态；worker 崩溃在 finalize 后无碍下轮补；回放臂仍只认作废键；**supersedeProjections 排除 author-void: 前缀**〔generation-intent.service:303-308 rearm/takeover 窗内会灭 pending 票据——我方补刀；cleanProjection :612 同款先例〕②**mergeSlot execStatus 加 execSeq 代际规则进 shared**——两边都有十进制 execSeq 大者胜→相同比 nodeVersion→缺 execSeq 仍只比 nodeVersion〔无行档不受影响〕；生效前提=带行 exec.status〔loading/skipped/error/done〕全携 execSeq〔feedError 侧已带；deliverArtifact ④ 段透传 poller execDonePatch 已造被丢的 intentId/execSeq〕；测试钉死 execSeq=6 loading〔nodeVersion=20〕不被 execSeq=5 done〔nodeVersion=30〕盖掉③**基线 mediaId 读源=Runtime 投影 artifact 槽非 Yjs 节点 mediaId**〔作废场景 Yjs 值已变投影槽不变——读 Yjs 值误判「变了」误退出〕④**voided 收场=processing false 留编辑态**〔今天 edit-result 无 fileId 档两分支都不进永转圈 ImageGenNode:1080-1095——v2.4 旧句作废；v2.7 落盘 :134 残句「保持 processing」本轮同步清——修订传播不完整第五次命中〕；测试三处：作废终态测 poller〔一条 done/零 exec.artifact/行变 projected/结算行数不变/重放 poller 仍一条〕+artifact-commit.int 作废行创建态 pending+shared 合并测试「大 execSeq 挡住更大 nodeVersion 的旧终态」；两笔 commit 边界不动）；v2.7（2026-11-19 plan 外审四轮四定案逐锚核实采纳——四条删 socket 后无终态事件的补写进第一笔：①**reaper 常驻门删**——projectReaped isDocResident===false 早退〔:526-538——Yjs 时代遗留：当时写投影装文档、回来靠 alignExecFromIntents 补〔该函数生产零调用已不存在——仅 emit.port 头注/processor 注释残句提及〕；writeExecStatus 现=PG 追加零装载、notifyProject 无人在线本就空操作〕——标签页关着时回收成功退款成立但 Feed 无 error：用户再开节点停旧 loading、面板〔done 或 error∧rearmable===false 才 rotateToken〕下一击仍拿旧手势；改=**始终 feedError**〔REAPER_DEADLINE/REAPER_STALE+行 intentId/attempts/execSeq〕+删常驻判断与 execProjectionDeferredTotal 支+exec-partial-success.int.spec「无连接零调用」用例翻「无连接也写入」并断言 intentId/execSeq②**编辑与打光 intent-stale 补 Feed**——processor :239-241/lighting.consumer :184-186 同形态 return {status:'completed'} 零 Feed 写〔HTTP 入队时已返回、工具条只能等 Feed——socket 删后 processing 永不清〕——补 feedError('INTENT_DEADLINE_EXCEEDED','EXEC_DEADLINE',row)〔**EXEC_DEADLINE 句子 id 定死与 REAPER_DEADLINE 分开**——同码异句靠 id〕句「生成已被系统回收（超时）——产物未投递」+行读〔票 cuid 不进事件〕③**作者槽作废臂补 done 事件**——作废臂不写 NodeArtifact、投影 poller 不补 exec.status done〔今天唯一信号=edit-result 不带 fileId；客户端只在 failed 或有 fileId 收场——转圈本就不会停〕+已核销下一次应新付费手势〔面板 done→rotateToken :63-66 实证〕——四处作废臂〔execution 主路径+冻结路径+processor+lighting.consumer〕写 status:'done' 带 intentId/execSeq/attempts 不带 error 不写 exec.artifact〔组装器允许 done 无 error〕；工具条两档：done∧mediaId 变非空→退出+清基线/done∧mediaId 未变→processing false 留编辑态不弹错；**outcome==='voided' 同样 processing false 留编辑态**〔重放不再写更新事件——不能拿版本大于基线等一条已存在的 done〕；打光去重不补 Feed〔控制器刚 fail 新 claim 行、再写 error 会盖另一条在跑意图〕④**errors[] 码与 Feed 一致**——冻结缺节点 :796 errors[] 仍写 PLAN_MISSING 与 Feed FROZEN_INPUT_MISSING 两边对不上——errors[] 同改 FROZEN_INPUT_MISSING+「节点缺少冻结输入」不拼 id；Feed 走无行档〔attempts 0+rearmable false+不写身份键〕。发布序：**第一笔先 api 后 worker 或一起**〔worker 先上+api 旧 writeExecStatus=error 字段被丢〕+第二笔先 web 后 api+worker；verify/E64 批末不变+第一笔提交前加跑 exec-partial-success.int.spec〔锁「无连接零写入」与 reaper 载荷形状——默认池跑不到〕；测试提示三条：provider-convergence :258 error:'stale worker' 等值检查后变「生成失败」/executionSocket.test.ts 随文件删/useAsyncMediaTask 后续一拍返回终态须清已建 interval+序号失配拍不 setState；v2.6=三轮〔feedError 句子 id/等值检查/rearmable 按码按行/插入点〕；更早链见 git 历史；未开工） -->
# Y3 协议退场 设计 spec

> 范围：A 类单独立项。删 `/execution` socket.io 命名空间与 `node:status`/`edit-result`/trim/separate/stitch 五族 socket 事件，执行进度走 RuntimeFeed（Hocuspocus stateless 通知+HTTP 游标读），余额改 REST 可刷新。依据=总目录 v11 Y3 行 + 裁决 E64/E65/D9 + 2026-11-19 全消费面 census（A-G 七节，file:line 全锚）。
> 开发测试档无用户画布需要保留。禁止「socket 与 Feed 双通道并存」的过渡垫片、禁兼容层、禁「先留着以后再删」。

## 0 本文解决什么

执行态交付已经是 feed-only（`deliverArtifact` 只 append 事件，「禁回落 doc 写」），节点渲染已从 RuntimeProjection 读（Y2 完成）。但执行/编辑/媒体任务的通知仍走 `/execution` socket.io 命名空间：五族 emit 共 33 个生产调用点、客户端 executionSocket 单例+三节点组件零副作用订阅+三处真实消费者。Y3 把这层 socket 通知退场：**通知统一走 stateless `feed-hint`（已在库、已在生产接线），事件体唯一通道=HTTP 游标（已在库），任务三族改 REST 轮询单通道，余额推送改 REST 拉取+事件驱动刷新**。`/payment` 独立保留（E65 原文既定：包级依赖不作判据）。

## 1 目标 / 非目标 / 反目标

**目标**

1. `/execution` 命名空间整体删除：ExecutionGateway、executionSocket.ts、EmitPort 四方法全部生产调用点、`/execution` 挂载点——一个 PR、一次发布；先加 Feed 字段与扣费失败写入（第一笔 commit），再同时删两端 socket（第二笔 commit，见 §4 commit 序）。
2. 五族终态可达性不降：node 执行族走 Feed（已全落事件）；**edit 族扣费失败今天只有 emit——本批先补 writeExecStatus，再删 emit**（D2）；trim/separate/stitch 三族改 REST 轮询单通道（轮询兜底已在生产，删 socket 快路径+轮询间隔钉常态值）。
3. 余额改 REST 可刷新：`credits:update` 空 detail 信号+静默重拉（D1）；删 node:status credits 搭车。
4. edit 失败分支 UI 保留：**工具条读投影里的 error 句子；空则「AI 处理失败」。不展示 errorCode**（D2）。
5. E64 锚回归维持：删 socket 后恢复语义不变（30s 必达 done 的恢复链=IntentReconcileService 启动扫+Feed 追平，E64 门测试随批保持绿）。

**非目标**

- 不删 `/payment` 命名空间（WeChatQRModal/MembershipPage 族照旧——E65② 原文「/payment 仍用 socket.io，包级依赖不作判据」）。
- 不动 socket.io 服务端基础设施（collab.gateway 主体、adapter、main.ts 挂载框架）——只删 /execution 一个命名空间。
- 不给 trim/separate/stitch 三族新增 Feed 事件（三族任务=用户主动发起的短任务，REST 轮询单通道足够；若 Y4+ 有需再立项——本批显式不扩 EVENT_KINDS 闭表）。
- 不动余额的扣费时序与资金面（REST 只改读面；`applyBalance` 随本链**删除**）。
- 客户端改动面=CanvasTopBar、creditsStore、runtimeStore、ImageGenNode、page.tsx、useTrimTaskStatus/useVideoSeparateTask（三族的 settle 回调不改——useAsyncMediaTask 轮询本体只去 socket 参数）。
- 不做 E65⑤「保留期最小加固」（连接上限/join 速率/帧上限——随命名空间删除面整体消失，无需加固退役面）。

**反目标**（做成了也算失败）

- 留任何「socket 优先、REST 兜底」的双通道形态（三族任务必须是轮询单通道；node 执行族必须是 Feed 单通知通道）。
- 留 ExecutionGateway/EmitPort 的空壳或降级 no-op 形态在库（WorkerEmitPort 的「降级安全」语义随端口整体退役——不是保留理由）。
- 客户端出现第二份 Feed 拉取链（handleFeedHint→syncRuntimeFeed 唯一；不新建轮询 store）。
- 余额刷新引入新的长连通道或新增 socket 事件。
- 删除五族任何一处终态可达路径而验收锚变红。

## 2 现库锚（2026-11-19 census，行号=开工基线快照）

| 事实 | 锚 | 对 spec 的后果 |
| --- | --- | --- |
| `/execution` 命名空间=ExecutionGateway：join 鉴权+五 emit 方法（node:status/video-trim:status/video-separate:status/storyboard:stitch:completed/join:error） | `execution.gateway.ts:21/:72-79/:81-128` | 整体删除。gateway.spec 的 join 鉴权用例随套件退役 |
| EmitPort 四方法生产调用点 33 处（v2.3 行内勘正——段内合计本就 33）：execution.service 15（loading×2/error×6/done×6 回放+主路径/credits 搭车唯一点 :542）+ai-image-edit 6+lighting 5（含 `lighting-result`/`lighting-failed` 词表外值 :217/:256/:280 `as any`）+materialize 1（:568 worker 侧本就 no-op）+trim 2+separate 3+stitch 1（仅 COMPLETED，FAILED 路径=throw 无 emit） | `emit.port.ts:59-116`、各 service（census A2 全列） | 全删。materialize :568 与 WorkerEmitPort 的「worker 无 WS 面」注释同步清理；lighting 词表外值随 emit 消失（零分型消费面——无迁移） |
| 客户端三节点组件 node:status 订阅已全部零副作用（Y2 B3 退役：handler 体 `void data`） | `ImageGenNode.tsx:382-388`、`AudioGenNode.tsx:62-68`、`VideoGenNode.tsx:368-374` | 直接删订阅+`subscribeNodeStatus` 调用；对应「零 store 写」断言用例随批翻新为「无订阅」不变量锚 |
| edit-result 真实消费者仅 ImageGenNode editMode UI：failed→setEditError+setProcessing(false)；成功分支只收 editMode 局部态（fileId 回填已退役） | `ImageGenNode.tsx:1075-1098`（EditToolbar errorMessage 渲染 :1170） | failed 档改读投影 **error 句**（空则「AI 处理失败」——不展示 errorCode，D2）；成功档 editMode 收敛保留（触发源改投影到达，基线=nodeVersion+artifact.mediaId） |
| 余额链：node:status credits→`credits:update` CustomEvent（唯一派发点 executionSocket.ts:39）→CanvasTopBar `'credits' in d` 守卫→applyBalance | `executionSocket.ts:39`、`CanvasTopBar.tsx:60-68`（守卫实证 ：62-64——**空 detail 事件会被直接丢弃**）、`creditsStore.ts:36-71` | v1「空事件+消费面零改」自相矛盾——v2：CanvasTopBar 消费逻辑改「空 detail→按 scope 静默重拉」；applyBalance 删除；fetchBalance/fetchTeamBalance 加 silent 档+响应序号（D1） |
| **writeExecStatus payload 组装丢 error**（`ExecStatusPatch` 开放签名+调用方已传——errorPatch/processor :315/:326 传了被丢）；**复制链共五处**：writeExecStatus spread+deliverArtifact 字面量（collab-document.service.ts:319-324）+服务端 slotOfEvent（runtime-feed.service.ts:336-339——重连/缺口/换代走 foldEventsToSnapshot）+客户端 slotOfEventWire（runtimeStore.ts:174-186）+projectRuntimeExecToNodeStore（runtimeStore.ts:32-56 不拷 error）；worker HTTP 通道全透传（collab-write.controller:108-132 无 whitelist） | 见左列五锚 | v2.1 D2：五处同批带上可选 error；selectRuntimeEntry（runtimeStore.ts:208）返回类型补 error+nodeVersion；PII 门=shared runtime-event.ts:98 正则（feed 写入 :138 调用）——error 键不命中 |
| **扣费失败分支零 Feed 写**（只 emit edit-failed——删 socket 后编辑模式停在处理中） | `ai-image-edit.processor.ts:143-151`（execution 链对照 `onReserveFail` :174-179 有 Feed 写） | D2：扣费失败分支先 writeExecStatus（errorCode=实际原因码+词表句+attempts+rearmable+行 intentId/execSeq——v2.3 勘正）再返回——与 onReserveFail 对齐；通用失败分支补 EDIT_FAILED |
| `ExecStatusEntry` 已备 `error?: string`（现恒 undefined——类型零改）；`projectRuntimeExecToNodeStore` 投影槽未透传 error | `execStatusView.ts:13-23`、`runtimeStore.ts:32-56`（slotOfEventWire :176-186 投影槽） | v2.4 D2 客户端：投影槽+透传补 error——工具条读投影 error（空则「AI 处理失败」）；基线=nodeVersion+artifact.mediaId+intentId（await 前写入、响应后补 intentId——§3 D2） |
| **调用点实数 33**（v1 标题 32 系 census 算术错：15+2+4+2+3+1+2+3+1） | 逐文件重数（execution.service 15/controller 2/processor 4/lighting.controller 2/lighting.consumer 3/trim 2/separate 3/stitch 1/materialize 1） | 验收=「生产代码零命中」grep 门禁，不锚计数 |
| page.tsx 画布级连接 | `pages/canvas/page.tsx:296-297`（mount ensure/unmount teardown） | 第二笔文件表必含——grep 门禁自然拦住 |
| 三族轮询现状=「发起者组件态+socket 快路径+REST 兜底」双通道；stitch socket.once 团队房间串扰缺陷（别人完成事件消费掉 once） | `useAsyncMediaTask.ts:23-24/:78-103`、`useStitchTask.ts:70-92` | v2 T1：删 socket=去缺陷；轮询钉发起者组件（禁项目级 store）；先打一枪消 setInterval 首间隔 |
| Feed 通知链已生产接线：`feed-hint` stateless 帧（节流 ≤1/s）+心跳 latestFeedSeq 增补双通道；客户端 `handleFeedHint`→`syncRuntimeFeed` HTTP 游标增量追平（缺口/换代四情形回落全量快照） | `runtime-feed.service.ts:32-33/:90-102/:205-215`、`canvasCollabRuntime.ts:1658-1659`、`runtimeStore.ts:316-388` | node 执行族通知零新增工作——删 socket 后即此链单通道。census C/F 节全链 file:line 在册 |
| RuntimeFeed 事件覆盖：node 执行族+edit 族全档落 `exec.status`/`exec.artifact`（13+2+1 写入点）；trim/separate/stitch 三族零 Feed 事件；credits 不进 Feed（EVENT_KINDS 五值闭表） | `runtime-event.ts:17`、`collab-document.service.ts:244-339`、census G2/G3 | 三族不扩 Feed（§1 非目标）；credits 不进 Feed（§3 D1 REST 读面）——EVENT_KINDS 闭表零动 |
| 三族任务客户端现状=socket 快路径+REST 轮询兜底双通道（trim/separate 10s/3s 双档轮询；stitch 5s 轮询+65s 超时+`socket.once`） | `useAsyncMediaTask.ts:23-24/:78-103`、`useStitchTask.ts:70-92`、REST 端点 `video-trim.controller.ts:32`/`video-separate.controller.ts:32`/`storyboard.controller.ts:23` | 删 socket 腿，轮询间隔钉为常态值（§3 T1 裁决）；useStitchTask 的 `socket.once` 与 65s 超时语义重定（§3 T2） |
| trim/separate 消费端写 store：trim done→addChildNode（mediaId 作者放置）；separate done→addChildNodes+addEdge+toast；separate error→toast+finishNodeProcess | `VideoGenNode.tsx:170-241` | 保留（消费语义非 socket 语义）——触发源改轮询 settle |
| /payment 独立：PaymentGateway（join:order 鉴权+四 emit）+WeChatQRModal 每次开新建连接+轮询兜底；socket.io-client 生产引用恰两处（executionSocket+WeChatQRModal） | `payment.gateway.ts:15-85`、`WeChatQRModal.tsx:81-85`、census E 节 | /payment 零改动。删 /execution 后 socket.io-client 生产引用只剩 /payment 一处——包保留 |
| E64 门测试在库：kill collab 进程→恢复 30s 内执行完成节点必达 done（负控腿承载判别力） | `intent-reconcile.e64-gate.int.spec.ts`（commit c268b890） | 验收锚之一：批末保持绿（恢复链与通知面正交——删 socket 不触恢复语义） |
| E56 close-code 读点已单源（routeClose→resolveBackoffPlan/resolveCloseAction shared 单源分型）；session-expiring 客户端消费未检出（仅 e2e 间接覆盖） | `connection-supervisor.ts:183-213`、census C2 | E56 面=Y3 复核锚非改造项（勘察已证收口在位）。session-expiring 消费缺口登记不修（属会话域非执行通知域） |
| EmitPort 装配面：execution-core.module.ts useFactory 按 COLLAB_ROLE 选 Direct/Worker 形态；**另有 worker.module.ts:274 直供 `{ provide: EmitPort, useValue: new WorkerEmitPort() }`（census A 节漏报——v2.2 补）** | `execution-core.module.ts:81-96`、`worker.module.ts:274` | 端口整体退役后两处装配段都删；删除面 census 以 grep 门禁兜底非清单穷举 |
| **deliverArtifact 的 exec.status 字面量丢 intentId/execSeq**（:319-324 只拷 status/attempts/errorCode——writeExecStatus spread :253/:259 有拷，两份组装器形状不一致）；服务端 slotOfEvent 无 execSeq | `collab-document.service.ts:319-324`、`runtime-feed.service.ts:336-339` | 第一笔 shared 组装器统一两份形状+slot 投影函数补 execSeq（§3 D2） |
| **PII 门只扫键名**（`runtimeEventPayloadPiiViolations` 遍历 Object.keys 值不扫——供应商原文/预签名 URL 可过门直进 PG+全员投影+IDB 7 天）；错误句现状=调用方传 error.message 原文+errorPatch 亦带异常原文（**原文禁入 Feed——封闭句表+等值检查双层**） | `runtime-event.ts:98-107`、`runtime-feed.service.ts:138` | 值收口双层（非门禁）：封闭句表为第一道（§3 D2——err.message 只进日志）；组装器**封闭句等值检查**为最后一道（error 先 trim、全文必须等于封闭句表某句否则整段换「生成失败」——不截断不保留残段，等值检查盖住 worker HTTP 透传写点〔v2.6 定案②——截断档作废〕） |
| **调用方两处 `.slice(0,200)` 截断**（errorPatch execution.service:169+processor 通用失败 :337 手拼——供应商原文无换行无 URL 时照样过门进投影）；契约类型 exec.status 缺 `execSeq?: string`（载荷 :253 已在写——类型滞后）；客户端 slotOfEventWire:176 `?? e.feedSeq` 对缺 nodeVersion 事件**伪造版本兜底** | `execution.service.ts:169`、`ai-image-edit.processor.ts:337`、`runtime-event.ts:31-44`、`runtimeStore.ts:176` | D2 v2.6：两处调用方截断随 errorPatch/手拼删除（等值检查不截断）；契约类型补 execSeq?+error?；缺 nodeVersion 不算一条状态（伪造兜底删） |
| 节点执行链扣费失败现句=`扣费失败：${原因码}` 落执行接口 `errors[].error`+投影（execution.service :436-438/onReserveFail :174-179）——原因码原文直达调用方 | `execution.service.ts:434-439/:174-179` | 词表句子同步进 errors[].error；onReserveFail 与编辑 processor 同走一份词表（§3 D2） |
| 测试侧两处随第二笔删（生产 grep 排除测试树扫不到）：worker.module.spec:116/:143「EmitPort=WorkerEmitPort」断言+gateway/emit.port.spec.ts 端口单测 | `worker.module.spec.ts:116/:143`、`gateway/emit.port.spec.ts` | 删除面显式列名（§3 S1 v2.3）——断言随装配段翻新/文件随端口删 |
| socket 挂载：main.ts（或 app.module）的 /execution gateway 注册 | census A1（gateway 装饰器即挂载） | 删 gateway 类=删挂载（Nest @WebSocketGateway 自注册） |
| **worker 的 done 写不进生产链路**：exec-status 端点对 status=done 固定 403（WORKER_EXEC_DONE_FORBIDDEN={done}）；HttpCollabWritePort.writeExecStatus 对非 2xx 只记 permanent 计数后 resolve 不上抛（调用方 .catch 看不到）——mock writeExecStatus 的测试绿、生产 Feed 无此事件 | `collab-write.controller.ts:36/:122-124`、`collab-write.port.ts:219-227` | v2.8：作废终态不能由 worker 四臂直接写 done——改投影 poller 单写（§3 D2 v2.8 重写③） |
| **作废投影行 state=superseded**：poller claim 只领 pending/projecting——作废行永不被领不产事件；键 author-void:${intentRowId}:${execSeq}、artifactRev=0、不写 NodeArtifact | `artifact-commit.service.ts:631-639`、`projection-outbox.poller.ts:206-213` | v2.8：行初始态改 pending=出站票据，poller 前缀分流单写 done（§3 D2 v2.8③） |
| **mergeSlot 只比 nodeVersion**（=本事件 feedSeq 后写恒大——服务端快照折叠+客户端增量同一函数）；**loading 写点无 execSeq**（只有 intentId/attempts——skipped :379/:430 同） | `runtime-projection.ts:98-102`、`runtime-feed.service.ts:329`、`execution.service.ts:416/:865` | v2.8：execStatus 槽加 execSeq 代际规则+带行 exec.status 全携 execSeq（§3 D2 v2.8②） |
| **supersedeProjections 把节点一切 pending/projecting 置 superseded**（rearm/takeover 事务内）——作废行改 pending 后会被同窗灭掉（旧点击者永转圈） | `generation-intent.service.ts:303-308` | v2.8：谓词排除 author-void: 前缀（cleanProjection :612 同款先例） |

## 3 方案与终裁

### D1 余额刷新=空 detail 信号事件+静默 REST 重拉（v2 定案/v2.3 信号恰一次收紧）

事件名仍是 `credits:update`，**detail 为空**。runtimeStore 不引用 creditsStore、不判个人/团队余额。CanvasTopBar 收到事件后按挂载时已定的 scope 重拉：非默认团队 `fetchTeamBalance(teamId)`、否则 `fetchBalance()`（团队项目余额=团队池，每个成员的 Feed 都会到，各自重拉正确）。两端点同读 TeamBalance 一张表（credit.controller:16 默认团队/team.controller:41 `:id/balance`——**读口路由，资金仍是团队钱包**）。

- **静默**：给两个拉取函数加 `silent: true` 档（现 fetchBalance 会置 loading=true——顶栏数字灭一下再出来）；挂载时第一次拉取仍显 loading。
- **慢响应不覆盖新结果**：每次请求带递增序号，仅最后一次响应可写入 store（挂载拉取与终态重拉会重叠）。
- **触发范围（信号恰一次——v2.3 收紧）**：`fetchRuntimeSnapshot` 用途参数**必填 `'init' | 'resync'`、无默认值**（调用点恰五：init 一+回落四）。`initRuntimeFeed` 传 'init'——首次快照**不发** credits:update。游标低于水位、historyId 不符、doc.vacuumed、缺口——这四条**各调用一次 'resync'**。`syncRuntimeFeed` 一轮最多 10 次增量；**终态标记跨轮累加，但一次函数调用只派发一次**：以追上或轮次用尽结束——这批里出现过 exec.status 且 status 为 done/error、或出现过 exec.artifact→结束时派发一次；**中途改走快照**——只由这次 'resync' 派发一次、累加标记清掉、被丢弃的那一页不另算。loading、skipped、删除、换代本身不触发。runtimeStore 不引用 creditsStore。
- **拉取侧**：fetchBalance/fetchTeamBalance 增加 `silent` 档。静默拉取失败时**不改 loading、不改 error、不改数字**。挂载时第一次拉取仍显示 loading。两次拉取共用一个递增序号，只有最后一次响应能写 store。
- **CanvasTopBar**：把「默认团队还是团队池」判断收成一个刷新函数，挂载与空事件共用；**默认团队比较结果放 ref**——终态事件不再每次请求默认团队。`applyBalance` 第二笔删除。
- 时序边界（如实登记不扩展）：扣费在 finalize 内，Feed done 由投影 poller 其后写入（poller 3s+feed-hint ≤1/s）——重拉读到已入账余额。对账退款若不写 Feed，余额停在该值直到下次终态或重进画布——与今天 socket 只在 execution.service:542 搭车一次同边界。
- 禁新建轮询 store、禁长连、禁 credits 进 Feed kind。

### D2 编辑失败先落 Feed：exec.status 补 error 键（v2.5 修订——feedError 唯一出口+显式结局+冻结路径补臂）

**服务端**（锚实证）：`writeExecStatus` payload 组装丢 `error`（`collab-document.service.ts:249-261` spread 清单无 error 键——`ExecStatusPatch` 开放签名+调用方已在传：errorPatch/processor :315/:326）；扣费失败分支只 emit 不写 Feed（`ai-image-edit.processor.ts:143-151`）；worker HTTP 通道 `POST /api/collab/doc/exec-status` 全透传 patch（collab-write.controller :108-132 无 whitelist 管道）——丢 error 的是手写字段清单。

- **shared 允许清单组装器**（第一笔）：writeExecStatus 与 deliverArtifact 的 exec.status 组装收口为 shared 里一个组装器，两边同调。允许键恰八：`status、attempts、execSeq、errorCode、artifactRev、intentId、rearmable、error`。fileId 留在 exec.artifact 不进状态事件。**组装器必填键定死（v2.4 定案④——「键有值才写」只适用可选键）**：status=非空字符串否则抛错；attempts=有限数字、缺则 0、**始终写入**；execSeq=仅 `/^\d+$/` 字符串才写入（typeof 收敛会把数字 execSeq 写进 JSON——破坏 wire 纪律 BigInt 一律 string）；errorCode/intentId=非空字符串才写入；artifactRev=有限数字才写入；rearmable=布尔才写入；error=**封闭句等值检查**（先 trim、全文必须等于封闭句表某句否则整段换「生成失败」——不截断不保留残段〔v2.6：截断档作废——'好'.repeat(300) 也是「生成失败」〕）。fileId/jobId/reason/nodeVersion/v/kind 一律不写——nodeVersion 由 `appendEventInTx` 以本事件 feedSeq 单源盖上（runtime-feed.service:134-136），组装器/调用方禁自带。execDonePatch 本体不改（fileId 仍只在 exec.artifact）。**顺带补洞**：deliverArtifact 状态字面量现丢 intentId/execSeq（:319-324 只拷 status/attempts/errorCode——与 writeExecStatus spread :253/:259 形状不一致）；服务端折叠快照 slotOfEvent 现无 execSeq（重连/缺口/换代走这份快照）。jobId/reason 今天就被现有字段清单丢掉——八键不丢任何一个正在生效的键。契约类型 `RuntimeEventPayload.exec.status` 同笔补**已在落库的** `execSeq?: string`+新增 `error?: string`（:31-44 现缺——类型滞后勘正）。
- **服务端 slotOfEvent 与客户端 slotOfEventWire 改调同一个 shared 投影函数**（字段=允许清单一致+nodeVersion）。**共享投影函数只在键有值时拷贝——缺的可选键不写成 undefined**。**缺 nodeVersion 的 exec.status 不算一条状态**——客户端 slotOfEventWire:176 `?? e.feedSeq` 伪造版本兜底删除，不另用 feedSeq 补一个版本。`projectRuntimeExecToNodeStore` 同批拷 error；**intentId 缺失回落 execSeq 的那行（runtimeStore.ts:42-43）删除**——两列不是同一个身份、无用户数据，不留垫片；`selectRuntimeEntry`（runtimeStore.ts:208）返回类型补 `error`+`execStatus.nodeVersion`；`ExecStatusEntry` 已有 error 不加 nodeVersion。`EVENT_KINDS` 仍五值；契约类型（RuntimeEventPayload exec.status+RuntimeProjectionExecStatusFact）加可选 error。
- **error 收口=封闭句表（v2.4 定案①——Feed 只用封闭句）**：writeExecStatus 今天丢 error、组装器一旦放开=这条句子进 RuntimeEvent+每个协作者投影+7 天 IDB（PII 门只扫键名）；errorPatch 第二参今天就是 `err.message`、TEXT_PROVIDER_UNKNOWN 两处（:599-603/:926-934）把异常原文拼在「不会重复扣费」前——原文进 Feed 后无任何值面拦截（PII 门只扫键名）。**err.message 禁止再进 errorPatch**——异常原文只进日志；节点执行接口返回发起者的 `errors[].error` 仍可带原文（请求响应非团队投影）。组装器封闭句等值检查留在最后一道（v2.6 定案②）。同码异句无法从码推句——句子由调用点显式选 id（feedError 签名，见下）。封闭句表：

| 场景 | Feed error | errorCode |
| --- | --- | --- |
| 扣费失败五码 | 现有词表（未命中：扣费失败，请重试） | 实际原因码 |
| 编辑通用失败 | AI 处理失败 | EDIT_FAILED |
| 节点执行通用失败 | 生成失败 | 实际码，缺省 EXECUTION_FAILED（:622 现推导承接） |
| 超时回收 | 生成已被系统回收（超时）——产物未投递 | INTENT_DEADLINE_EXCEEDED |
| 资金不变量 | 生成结果暂缓交付（资金核销异常，待对账处理） | FUNDS_INVARIANT_VIOLATION |
| 外呼结果不明，已 markUnknown | 可能重复生成、不会重复扣费（请稍后查询或重试） | TEXT_PROVIDER_UNKNOWN |
| 外呼结果不明，mark 失败 | 外呼结果不明，扣费状态待对账（请稍后查询或重试） | TEXT_PROVIDER_UNKNOWN |
| reaper 两句 | 保持现句（已是封闭句）——**v2.7 起始终写入**（常驻门删） | 现码（REAPER_DEADLINE/REAPER_STALE） |
| 编辑/打光 intent-stale | 生成已被系统回收（超时）——产物未投递（id EXEC_DEADLINE） | INTENT_DEADLINE_EXCEEDED |

- **Feed 的 intentId=行上 `intentId` 列**（claim 时服务端 `randomUUID()` 铸造的**行身份**——gestureKey 才是客户端手势的审计列、不进事件；`id`=行 cuid；job 上没有这列。v2.2「行上手势 token」术语勘正）。扣费失败、通用失败、资金不变量**三次写入都从意图行读出 intentId/attempts/execSeq 放进 patch**：intentId=行上 intentId、`execSeq=row.execSeq.toString()`、扣费失败另写 `rearmable: attempts<3`。writeExecStatus 的第四个参数是 worker HMAC 作用域 `{ intentRowId, execSeq }`——Direct 端口忽略它、它不进事件体。**v2.4 补漏两个生产写点**（v2.3「三次写入」清单漏）：reaper `projectReaped`（intent-reconcile.service:529-536——现无 intentId/execSeq）与 lighting 资金分支（lighting.consumer:252-258——现无 intentId）一并从行上补 intentId+execSeq，否则编辑超时（走 reaper 收敛）对不上这次点击。
- **Feed error 唯一出口=feedError(errorCode, sentence, row | null)（v2.6 定案①——进 shared，句子与原因码分开）**：同一 errorCode 对应不同句子、函数无法从码推句（TEXT_PROVIDER_UNKNOWN marked/unmarked 两句；INTENT_DEADLINE_EXCEEDED 执行链超时句 vs reaper 超时句——「句子只从 feedError(code) 来」与「reaper 不并进执行链」不能同时成立）。签名带**句子 id（FeedSentenceId 闭枚举，句子表只在这一处）**：`feedError(errorCode: string, sentence: FeedSentenceId, row: { intentId: string; attempts: number; execSeq: bigint } | null)`，放 packages/shared/src/collab/runtime-exec-status.ts。句子 id 分立：TEXT_UNKNOWN_HELD（已 markUnknown）/TEXT_UNKNOWN_UNMARKED（mark 失败）——事件码仍 TEXT_PROVIDER_UNKNOWN；REAPER_DEADLINE/REAPER_STALE——事件码仍现两码；EXEC_DEADLINE（编辑/打光 intent-stale——事件码 INTENT_DEADLINE_EXCEEDED、句=执行链超时句与 REAPER 分立）；编辑通用 EDIT_FAILED→「AI 处理失败」；节点执行通用 EXEC_GENERIC→「生成失败」（errorCode 仍写实际码缺省 EXECUTION_FAILED）；资金不变量 FUNDS_HELD。**调用点全改调它**：execution 八处（:179/:358/:486/:582/:603/:625/:934/:947）+processor 扣费失败/资金不变量/通用失败（三处今天手拼 patch 不经 errorPatch）+reaper projectReaped+lighting 资金分支+编辑与打光的 intent-stale 返回前（v2.7 定案②——feedError('INTENT_DEADLINE_EXCEEDED','EXEC_DEADLINE',row)，EXEC_DEADLINE 与 REAPER_DEADLINE 分开、同码异句靠 id）；调用前从意图行读 intentId/attempts/execSeq（票上的 intentRowId=行 cuid，非事件中的 intentId）。**冻结输入缺节点（:796——frozen.input.nodes 无该 id 而 plan 行在）不写 PLAN_MISSING 句**：errorCode:'FROZEN_INPUT_MISSING'、句「节点缺少冻结输入」不拼 id；「节点缺少定价快照」只给主路径 planMap 缺失（:354-358）。
- **rearmable 按码与有无行（v2.6 定案③）**：面板六文件只认 `rearmable === false`（false→rotateToken 铸新付费手势；true/缺键都保留 token=同手势免费 rearm——ImageConfigPanel:63-66）。**无行档**（主 PLAN_MISSING/冻结 FROZEN_INPUT_MISSING/claim 前失败）：attempts 0+rearmable false+不写 intentId/execSeq——`attempts<3→true` 会让面板保留一个没有行可 rearm 的手势。**有行 TEXT_PROVIDER_UNKNOWN 恒 true**（现码 :603/:934 恒 true；UNKNOWN 不进 reaper 扫描、冻结靠同 token rearm 的 voidInTx 释放——generation-intent.service:39-41 REARMABLE 含 UNKNOWN+:236-238 voidOldGenFreeze；写成 attempts<3 则次数到 3 面板铸新付费手势、旧冻结滞留 UNKNOWN；attempts>=3 的 INTENT_EXHAUSTED 是服务端上限，不靠面板提前轮换）。其余有行：FUNDS_INVARIANT_VIOLATION 与 INTENT_EXHAUSTED 为 false、其他 attempts<3；冻结 generic catch 用行上 attempts（不写死 0/false）。
- **冻结 catch 补臂（v2.6 定案④——插入点定死）**：①FundsInvariantError 分支必须写在冻结 catch **内**、紧跟 AuthorSlotReleaseError 重抛之后、voidForExecutionRequestItem/void_/fail（:939-944）**之前**（v2.5 写「插 :919 前」在 catch 外——行号算术错认账；插错位置 void 仍会退掉应留对账的冻结）：不 void、不 fail、行留 RUNNING、`feedError('FUNDS_INVARIANT_VIOLATION','FUNDS_HELD', row)`、continue。②intent-stale（:894-897）**保持现有 per-item void**（请求预留与意图冻结不是同一笔），只补 Feed 超时句（主路径 :486 已在写）。③冻结 PLAN_MISSING（:796）补 FROZEN_INPUT_MISSING Feed 写。冻结 TEXT_PROVIDER_UNKNOWN :934 attempts 随行读修复（现写死 0）。- 发起者 HTTP 的 `errors[].error` 仍可带原文（「err.message 只进日志」不扩到响应体）；但冻结缺节点的 errors[] 同改 FROZEN_INPUT_MISSING+「节点缺少冻结输入」（v2.7 定案④——与 Feed 同码同句，两边不拆）。
- **reaper 常驻门删除（v2.7 定案①——删 socket 后无人在线时终态悬缺）**：projectReaped 的 `isDocResident===false` 早退（:526-538）是 Yjs 时代遗留——当时写投影会把文档装进内存、回来靠 alignExecFromIntents 对齐补投影（该函数生产零调用已不存在——仅 emit.port 头注/processor 注释残句提及；恢复只靠 RuntimeFeed）；writeExecStatus 现在是 PG 追加零装载、notifyProject 无人在线本就空操作。门留下的结果：标签页关着时回收成功、钱退了、Feed 里没有这条 error——用户再打开节点停在上一次 loading，面板（done 或 error∧rearmable===false 才 rotateToken）下一次点击还拿旧手势。**改法：projectReaped 始终 feedError**（REAPER_DEADLINE/REAPER_STALE+行 intentId/attempts/execSeq）——删常驻判断与 execProjectionDeferredTotal 支；exec-partial-success.int.spec「无连接零调用」用例翻「无连接也写入」并断言 intentId 与 execSeq。
- **编辑与打光的 intent-stale 补 Feed（v2.7 定案②）**：processor :239-241 与 lighting.consumer :184-186 同形态 `return {status:'completed'}` 零 Feed 写——HTTP 入队时已返回、工具条只能等 Feed，socket 删后 processing 永不清。补 feedError('INTENT_DEADLINE_EXCEEDED','EXEC_DEADLINE',row)，行从 intentRowId 读出 intentId/attempts/execSeq（票上 cuid 不进事件）。
- **作废终态由投影 poller 单写（v2.8 重写 v2.7 定案③——worker 的 done 写不进生产链路）**：四条作废臂全在 worker 进程（execution.processor 调 ExecutionService.execute 的主路径与冻结路径、ai-image-edit.processor、lighting.consumer），worker 的 CollabWritePort=HttpCollabWritePort 只打 POST /api/collab/doc/exec-status；该端点对 status=done 固定 403 WORKER_EXEC_STATUS_NOT_ALLOWED（collab-write.controller:36/:122-124——done 今天只由 API 进程的投影 poller 在 deliverArtifact 里与 exec.artifact 一起写），且端口对非 2xx 只记 permanent 计数后直接 resolve 不上抛（collab-write.port.ts:219-227——调用方 .catch 看不到失败）：对着 mock 的 writeExecStatus 写的测试会绿、生产 Feed 里没有这条 done、删掉 socket 之后工具条继续转（**v2.7「四臂直接 writeExecStatus done」在生产链路写不进去——本轮认账重写**）。**改法**：
  - 作废臂照旧只把 `authorVoid: true` 交给 commitImage/finalizeVideo，四处都不调用 `writeExecStatus({status:'done'})`；worker done 黑名单与「403 零事件」集成测试保持原样。
  - 作废投影行初始状态 `superseded` 改 **pending**（artifact-commit.service:631-639）；commit 返回值仍 `outcome:'superseded'`；入口幂等短路继续按 [artifactId,artifactRev] 键等值查、不按状态查。
  - poller 在查 NodeArtifact **之前**认 `author-void:` 前缀岔开（不岔开会走 artifact-missing orphaned 分支——byId.get 认不出该键），不走 deliverArtifact（那条路必写 exec.artifact，且 artifactRev=0 会与其他 0 代撞幂等键）：新方法在事务内先按 nodeId+intentId+execSeq+status=done 查重，再追加一条 exec.status `status:'done'`——带行上 intentId/execSeq、**attempts 从 GenerationIntent 行读**（投影行 attempts 列=投影重试计数非生成次数）、不带 error、不写 exec.artifact；然后行标 projected，提交后 notifyProject。
  - 节点已删除或 fence 不放行：不写 Feed、不调 refundOrphaned（钱在 finalize 里已核销、产物在素材库），行标终态避免 poller 反复领；保留矩阵继续按 `author-void:` 前缀豁免（cleanProjection :612 谓词原样）；R3 窗⑥ sweepOrphanedRefund JOIN NodeArtifact 认不出作废键不会误扫、collab-media:129 同理不误触。
  - worker 崩溃发生在 finalize 提交之后无碍：行已在库，下一轮 poller 补上这条 done；回放臂继续只认作废键等值查（第二笔删其 socket emit、不写第二条 Feed）。
  - **supersedeProjections 排除前缀（v2.8 补刀）**：generation-intent.service:303-308 在 rearm/takeover 事务内把该节点一切 pending/projecting 投影行置 superseded——作废行改 pending 后，poller 3s tick 窗内用户同节点再点会把这张出站票据灭掉永不投影（旧点击者永转圈）；谓词排除 `author-void:` 前缀（cleanProjection :612 同款先例）。

  客户端收场见下「done 收场两档」（v2.8 基线读源钉死）；**打光去重不补 Feed**（控制器会把刚 claim 的行 fail 掉，再写一条 error 会盖住另一条仍在跑的意图）。reaper 两句维持现句不并进执行链那句超时文案。
- **受理四档联合类型放 shared（v2.6 定案④尾）**：api 与 web 都引同一类型（新建 `{replayed:false, intentId}`+现有入队字段/交付 `{replayed:true, outcome:'delivered', resultRef}`/作废 `{replayed:true, outcome:'voided'}`——对象上没有 resultRef/去重 `{replayed:true, outcome:'deduped', taskId, status}`）；handleGenerate 接住 withSyncRetry 返回值（泛型直通——executionApi.ts:38-39），只认 outcome。

| 原因码 | 句子 |
| --- | --- |
| CREDIT_INSUFFICIENT | 积分不足 |
| QUOTA_EXCEEDED | 本月额度已用尽 |
| NOT_MEMBER | 不在该团队，无法扣费 |
| TEAM_BALANCE_MISSING | 团队积分账户不存在 |
| RESERVE_GATE_LOST 及其他 | 扣费失败，请重试 |

- **通用失败**：编辑 errorCode:'EDIT_FAILED'、句固定「AI 处理失败」；节点执行 errorCode=实际码（BusinessException 取 err.errorCode，缺省 EXECUTION_FAILED）、句「生成失败」；error.message 只留日志；feedError 从意图行读 intentId/attempts/execSeq。同文件资金不变量那次写入补行读。
- lighting-result/lighting-failed 两处 emit 第二笔删；打光失败已写 Feed 或抛回 processor 的写入。
- PROJECT_TEAM_MISSING/INTENT_GUARD_MISSING 现状零 emit 零 Feed 写——本批不动。

**客户端**（受理响应即结果+基线读 RuntimeProjection）：

- **受理响应就是这次点击的结果，不另开通知通道（v2.4 定案②/v2.5 定案①显式结局）**：编辑幂等重放今天只 emit 不写 Feed 事件（runGuarded `!created` 臂 ai-image-edit.controller:82-98+lighting createTask 同形态 :82-97——**作废臂与交付臂返回同一个体 `{replayed:true, resultRef}`，作废只是 socket 不带 fileId、`intent.resultRef` 仍在**——「resultRef 非空=交付」判据不成立，会把作废重放当成功关编辑；lighting 还有第三形态：60s 去重返回 `{replayed:true, taskId, status}` 无 resultRef——会被当成作废停在处理中，且在途任务失败时 Feed 上的 intentId 是那条在途意图、对不上这次点击）。故两处控制器同一形状改**显式结局**：

| 结局 | 返回 |
| --- | --- |
| 新建入队 | `{ replayed: false, intentId }` +现有入队字段 |
| 交付重放 | `{ replayed: true, outcome: 'delivered', resultRef }` |
| 作废重放 | `{ replayed: true, outcome: 'voided' }` |
| 打光去重 | `{ replayed: true, outcome: 'deduped', taskId, status }` |

  客户端只认 outcome：delivered→退出编辑+processing false+清基线；voided→保持编辑态、processing 置 false（v2.8：今天 edit-result 无 fileId 档两分支都不进=永转圈实证 ImageGenNode:1080-1095——v2.4「保持 processing 同今天行为」旧句作废）；**deduped 本批无画布消费者**（LightingModal 实证 TODO 桩未接线 :93——不塞进编辑工具条的等待）；新建成功→intentId 写入 ref+**立刻读一次当前投影**（Feed 可能已经先到——不能只等 effect）。
- 订阅：`useRuntimeFeedStore((s) => s.projection?.nodes[id])`（合并时未改动的节点保持原对象引用——其他节点的事件不误触发）。
- **基线在 await 之前写入 ref，但身份判据=intentId 非版本单查（v2.4 定案③——禁记 '0'）**：点击处理函数里发出请求之前，同步写入：`nodeVersion`=当前槽上合法十进制版本，没有则当前 `cursor.feedSeq`，再没有则 **null（禁止写 '0'**——历史 error 的版本严格大于 '0' 会把上一次失败当这一次弹）；`mediaId`=当前 **Runtime 投影的 artifact 槽**（非 Yjs 节点上的 mediaId——v2.8：作废原因=用户换了节点图，Yjs 值相对点击时已变、artifact 槽无新 exec.artifact 不变；读 Yjs 值会把每次作废误判「变了」而误退出）；`intentId`=null（此时还没有）。**响应回来后把 intentId 写进 ref 并立刻读一次当前投影**。此后判定：
  - ref 为 null，或 intentId 仍为 null：不改编辑态（ref 未写时投影变化不算——打开编辑模式时节点旧错误不当成这一次的失败）。
  - `status==='error'` 且 `entry.intentId === ref.intentId` 且版本严格大于基线（十进制 BigInt）：工具条显示投影 error（空串与缺键→「AI 处理失败」）+setProcessing(false)。
  - 此后 mediaId 相对基线变化且非空→仍退出编辑模式（成功信号——新建档）。
  - 退出编辑或卸载：清 ref；刷新后基线丢失、处理中回到可再点击——接受（如实登记）。
  - 同节点在途意图有 partial unique 行锁（generation-intent.service:175 RUNNING 闸）——协作者插不进第二次执行，intentId 身份判据不会误伤上一次失败（投影槽只留最后一条 exec.status）。
- **execStatus 合并加 execSeq 代际规则（v2.8 定案——迟到的旧代 done 不得盖新代 loading）**：mergeSlot 今天只比 nodeVersion（runtime-projection.ts:98-102），而 nodeVersion=本事件 feedSeq——后写入的事件永远更大。作废 done 要等 poller（3s tick），这段时间同一节点可以开始下一次执行（作废行已 SUCCEEDED、在途锁已放），后到的旧代 done 会盖掉新代 loading；服务端快照同走 mergeRuntimeProjection 折叠（runtime-feed.service:329），刷新之后仍是旧代 done。**规则放 shared（折叠与客户端增量同一处）**：execStatus 槽两边都有十进制 execSeq 时大的 execSeq 胜；execSeq 相同再比 nodeVersion；任一边没有 execSeq 仍只比 nodeVersion（无行档 PLAN_MISSING/FROZEN_INPUT_MISSING 无 execSeq，不受影响）。**规则生效前提=带行 exec.status 全携 execSeq**：现 :416/:865 loading 只有 intentId/attempts——同一批把从意图行发出的 exec.status（loading/skipped/error/done）都带上 execSeq（feedError 侧已带；deliverArtifact 正常 done 侧 poller execDonePatch 已造 intentId/execSeq 但 ④ 段字面量丢弃〔:319-326〕——随组装器改道一并透传）。测试钉死：execSeq=6 的 loading（nodeVersion=20）不被 execSeq=5 的 done（nodeVersion=30）盖掉。
- **done 收场两档（v2.7 定案③/v2.8 基线读源钉死）**：done∧mediaId 相对基线变了非空→退出编辑+清基线；done∧mediaId 未变/空→**processing 置 false、留在编辑态、不弹错误**（作废档——这次点击已核销、面板 done→rotateToken 铸新手势）。**基线里的 mediaId=当前 Runtime 投影的 artifact 槽，不是 Yjs 节点上的 mediaId**：作废的原因就是用户换了节点图——节点上 mediaId 相对点击时已经变了、artifact 槽没有新的 exec.artifact 所以不变；读 Yjs 值会把每次作废都判成「变了」而误退出。`outcome==='voided'` 同样 processing false 留编辑态——重放不会再写一条更新的事件，不能拿版本大于基线去等一条已经存在的 done。
- 编辑成功的界面跟投影 poller 走（可见延迟=poller 3s+feed-hint ≤1s）。
- 编辑成功的界面跟投影 poller 走（可见延迟=poller 3s+feed-hint ≤1s）。

### T1 三族轮询钉死在发起者组件（v2 补注）

trimTaskId/separateTaskId 与 useStitchTask 的 start() 都在发起者组件状态里——其他协作者无此状态不轮询不长子节点（新节点由发起者写 Yjs，其他人经文档同步看见）。**轮询抬到项目级 store=团队画布重复长子节点——禁**。

- useAsyncMediaTask 去掉 socket/socketEvent；useTrimTaskStatus/useVideoSeparateTask/VideoGenNode 的 `ensureExecutionSocket` 引用一起去掉（参数签名收窄）。
- **有 taskId 立即请求一次；未终态再 setInterval 3 秒**（请求返回终态就不再建 interval）；清理时作废在途响应。终态判定/addChildNode/addChildNodes/addEdge/toast 不变。
- 拼接同款先请求一次、之后 5 秒；65s 超时仍从 start() 起算；**超时结算之后迟到的 COMPLETED 不得再 spawnResultNode**。超时仍提示手动刷新；spawnResultNode 载荷不改。**现状缺陷注记**：socket.once 在团队房间会被别人的完成事件消费掉——删 socket 是去缺陷非少一条成功路径。失败档本就只有 REST 的 FAILED。
- **page.tsx:296 的 ensureExecutionSocket/teardownExecutionSocket 是画布级连接**——第二笔 grep 门禁会拦住它，plan 文件表须含 page.tsx。

### T2 （并入 T1——v2 合并）

### S1 服务端 emit 面整体退役（v2.2 补注）

EmitPort+Direct/Worker 两形态+四方法+全部生产调用点（**33 处**——execution.service 15/ai-image-edit.controller 2/processor 4/lighting.controller 2/lighting.consumer 3/video-trim 2/video-separate 3/stitch 1/materialize 1；验收用「生产代码零命中」grep 门禁非计数）+ExecutionGateway 类+装配段，第二笔单批删除。

- **删除面含 census 漏报的装配点**：`worker.module.ts:274`（`{ provide: EmitPort, useValue: new WorkerEmitPort() }`——census A 节只报了 execution-core.module.ts:81-96，**我方漏报认账**）+ `execution-core.module.ts` 的 gateway 与端口装配+全部构造函数注入。
- **测试侧两处随第二笔删（v2.3 补——生产 grep 排除测试树扫不到，spec 之外显式列名）**：`worker.module.spec.ts:116/:143`「EmitPort=WorkerEmitPort」断言随装配段翻新；`emit.port.spec.ts` 随端口文件删除（execution.gateway.spec.ts 同批随类删）。
- commit 序=先加后删（§4）；**一个 PR 两次提交、一次发布；第一笔只加字段和扣费失败的 Feed 写（socket 与 applyBalance 都还在）可单独进库（多出的 error 是事件载荷扩键，画布文档模型不动）；第二笔不得先于第一笔上线——流水线若分两步发，先发 web 再发 api**（只上第二笔时扣费失败既无 socket 也无 Feed——编辑停在处理中）。
- materialize 失败的用户可见通道仍是 media fact `MATERIALIZE_FAILED`（worker 上那次 emitNodeStatus 已是 no-op——删除即可）。
- `collab_emit_degraded_total` 定义在 emit.port.ts:92-96——**目录门禁只扫 *.metrics.ts、y0b spec metric-names 围栏无此项**：第二笔删掉这个 Counter 即可，**不写进围栏、不为它跑 --write-metric-names**（v2.1「spec §10 同步 -1 项」作废）。
- 幂等回放那几处**只 emit 不写 Feed**（execution.service :402/:408/:842/:845 回放臂）——删断言即可，投影仍由 poller 既有行负责（回放语义=幂等返回，非新增态）。

### S2 测试套件翻新+验收（v2.2 补注）

`execution.gateway.spec.ts` 随类删除；emit 载荷断言改既有 appendEvent/writeExecStatus/deliverArtifact 断言（多数套件已有）；「零 store 写」三件套翻「无订阅」不变量锚。**grep 门禁扫生产树、排除 *.spec.ts/*.test.ts/*.spec.tsx**：

- 客户端零命中：`executionSocket`、`subscribeNodeStatus`、`subscribeNodeEditResult`、`ensureExecutionSocket`、`teardownExecutionSocket`；socket.io-client 只许留在 WeChatQRModal。
- 服务端零命中：`emitNodeStatus`、`emitTrimStatus`、`emitSeparateStatus`、`emitStitchStatus`、`ExecutionGateway`、`EmitPort`、`WorkerEmitPort`、`namespace: '/execution'`。/payment 保留。

**第一笔测试三件（先红后绿）**：①带 error:'积分不足' 的 exec.status 经写入、折叠快照、客户端槽——投影里仍是该句②error:'see https://x' 落成「生成失败」（**封闭句等值检查**——表外任意句子含 `'x'.repeat(210)+' https://evil'` 与 `'好'.repeat(300)` 全档整段换「生成失败」；表内「积分不足」原样通过）③删 emit 之前扣费失败分支就有一条 Feed 写：errorCode=**实际原因码**（凭证例 CREDIT_INSUFFICIENT）、error=词表句「积分不足」、intentId 等于行上 intentId 列（v2.4 残句勘正——不再写「统一 RESERVE_FAILED」）。

## 4 切法（一个 PR、两个 commit、一次发布——先加后删）

| commit | 内容 | 出口锚 |
| --- | --- | --- |
| **第一笔（可单独运行/可单独进库）** | shared 允许清单组装器（八键+必填键定死〔status 抛错档/attempts 恒写/execSeq 十进制 string 档〕+error **封闭句等值检查**〔表内原样/否则整段「生成失败」——不截断〕）+writeExecStatus/deliverArtifact 改调组装器（补 deliverArtifact 丢 intentId/execSeq 洞）+服务端 slotOfEvent/客户端 slotOfEventWire 改调同一 shared 投影函数（删 ：176 伪造兜底+删 intentId 回落 execSeq 垫片行）+projectRuntimeExecToNodeStore 拷 error+selectRuntimeEntry 类型补+契约类型补 execSeq?/error?+taxonomy 契约测试+**errorPatch 删除→feedError(errorCode,sentence,row|null) 进 shared（FeedSentenceId 闭枚举+受理四档联合类型同文件）**（调用点全改：execution 八处+processor 三处+reaper+lighting 资金——行读+rearmable 按码与有无行〔无行 false 不写身份键/TEXT_UNKNOWN 恒 true/其余 attempts<3〕+PLAN_MISSING「节点缺少定价快照」不拼 id+FROZEN_INPUT_MISSING 新档）+**冻结 catch 内补臂**（FundsInvariantError 插 AuthorSlotReleaseError 重抛后 void 块前——不 void 不 fail 留对账/intent-stale 保 per-item void 只补 Feed 写/冻结 FROZEN_INPUT_MISSING 补 Feed 写）+processor 扣费失败/通用失败行读+reaper projectReaped 与 lighting 资金分支补行读+**runGuarded/lighting 受理响应改显式结局四档**（新建 {replayed:false,intentId}+delivered/voided/deduped——§3 D2 客户端半）+**reaper 常驻门删（始终 feedError）**+**processor/lighting intent-stale 补 Feed（EXEC_DEADLINE）**+**作废终态投影 poller 单写**（行初始态 pending+前缀分流+查重后单写一条 done〔行身份+attempts 从意图行读、不带 error、零 exec.artifact〕+行标 projected+supersedeProjections 排除 author-void: 前缀）+**mergeSlot execStatus execSeq 代际规则**（shared 折叠与客户端增量同源+带行 loading/skipped 补 execSeq）+**冻结缺节点 errors[] 同改 FROZEN_INPUT_MISSING**；第一笔提交前门禁加跑 exec-partial-success.int.spec（int 池——锁无连接写入与 reaper 载荷形状）。发布序：第一笔先 api 后 worker 或一起（worker 先上+api 旧 writeExecStatus=error 被丢）；第二笔先 web 后 api+worker。**socket 与 applyBalance 都还在**（多出的 error 是事件载荷扩键——画布文档模型不动，旧客户端忽略未知字段） | api/web 全量绿+第一笔测试三件（§3 S2）红→绿 |
| **第二笔（同一次发布、不得先于第一笔上线）** | 删客户端订阅、page.tsx 生命周期、executionSocket.ts、三族 socket 参数（先打一枪 3s/5s 轮询）、余额改空事件静默重拉（D1）+applyBalance 删除；再删 EmitPort（含 worker.module.ts:274 provider）、ExecutionGateway、全部 emit 调用（33 处）、构造注入、`collab_emit_degraded_total` Counter+emit.port.spec.ts/worker.module.spec 断言两测试面；S2 断言翻新+双端 grep 门禁+验收锚 | web+api 全量绿+双端 grep 零命中（§3 S2 清单）+验收锚两用例+E64 门复跑绿+E56 复核+verify fast 全绿 |

- **发布序（v2.7 收全）**：两笔一次发布；第一笔可单独进库（载荷扩键不影响旧客户端——旧客户端第一笔期间编辑仍走 socket）。若分步：**第一笔先 api 后 worker（或一起）**——worker 先上而 api 还是旧 writeExecStatus 时 error 字段会被丢；**第二笔先 web 后 api+worker**——web 先读 Feed、api 后停 emit。第二笔不能先于第一笔（扣费失败既无 socket 也无 Feed）。
- 第二笔内 TDD 序保持：失败测试先行再删 emit。

## 5 不变量

1. 五族终态可达性不降（E65 验收锚）：无 socket 通道后五族终态用例全绿。
2. 余额真值唯一读面=REST（`/api/credits/balance`+`/api/team/:id/balance` 同读 TeamBalance）；`credits:update` 信号 detail 为空、一次同步只派发一次（用途参数+序号——慢响应不覆盖新结果）。
3. RuntimeFeed EVENT_KINDS 五值闭表零动；exec.status 补 error 键为该 kind 可选字段（非新 kind）；三族任务不进 Feed。
4. E64 门测试恒绿（恢复链零触碰——只复跑不改语义）。
5. `/payment` 命名空间与 socket.io-client 包保留（引用恰一处）。
6. trim/separate 消费端写 store 语义零改（addChildNode/addChildNodes/addEdge/toast 形态保留）；**拼接结果节点仍写 fileId+status:'done'**（与裁剪子节点只写 mediaId 不一致——混进本批=改数据模型，明确不动）。
7. 三族轮询恒留发起者组件状态——禁抬项目级 store（团队画布重复长节点面）。
8. E56 close-code 单源=复核锚非改造项。

## 6 测试载体

- **第一笔三件（先红后绿——§3 S2 已列）**：①error:'积分不足' 经写入→折叠快照→客户端槽投影仍是该句（slotOfEvent 链路完整性）②error:'see https://x' 落成「生成失败」（封闭句等值检查——残段/超长全档整段换「生成失败」不截断）③删 emit 前扣费失败即有 Feed 写：errorCode=实际原因码（凭证例 CREDIT_INSUFFICIENT）、intentId 等于行上 intentId 列、error=词表句子（词表各码句子档随附）。
- 第一笔新增（v2.7 四写）：reaper 无连接也写入（翻「零调用」用例+intentId/execSeq 断言）；processor/lighting intent-stale 补 Feed（EXEC_DEADLINE 句+行身份）；作废终态 poller 单写（一条 done、零 exec.artifact、行变 projected、结算行数不变——重放 poller 后仍只有一条事件）+author-void 行创建态 pending（artifact-commit.int.spec 断言翻新）+shared 合并测试「大 execSeq 挡住更大 nodeVersion 的旧终态」；冻结缺节点 errors[] 码 FROZEN_INPUT_MISSING 同句。第二笔：节点组件「无订阅」不变量锚×3；useAsyncMediaTask 轮询单通道（taskId 即刻首请求+单调序号作废在途——cleanup 与 taskId 变化各 +1+**后续一拍返回终态须清掉已建 interval**+序号失配拍不 setState+零 socket 依赖）；useStitchTask 5s 轮询+65s 超时（超时后迟到 COMPLETED 走同一把 done 锁——不再 spawnResultNode）；余额=空 detail 信号恰一次（init 首次快照不发/四条回落各一次/增量整批一次/缺口转快照不重算被弃批）+CanvasTopBar 静默重拉（silent 档+序号+静默失败不改 loading/error/数字+默认团队比较结果 ref 化）；editError=**受理响应显式结局**（delivered→退出+清基线/voided→保持/新建→intentId 入 ref+立刻读投影——deduped 无画布消费者不进等待）+投影错误匹配三条件（ref 非空∧intentId 对上∧版本严格大于——基线禁 '0'：无合法版本用 cursor.feedSeq 再无 null）+空句兜底「AI 处理失败」+作废成功保持编辑态+退出/卸载清基线；emit 断言翻 appendEvent/writeExecStatus/deliverArtifact 断言（幂等回放臂四处 emit 断言直接删）。
- 验收：五族终态可达+credits REST 刷新两用例+E64 门复跑+E56 复核+双端 grep 门禁（§3 S2 清单）+`pnpm verify`（web/api 全量）。

## 7 观测 / CI

- `collab_emit_degraded_total` 随 WorkerEmitPort 删除（处置见 §3 S1——勿进 metric-names 围栏）。
- census/行数锚类门禁按批同步（execution.gateway/collab-doc-registry 行数锚若有）。
- CI 五项必检照旧；本批零迁移、零 schema 变更。

## 8 留给实现者

- D2 触发载体已关：观察本节点 RuntimeProjection（基线=execStatus.nodeVersion+artifact.mediaId，见 §3 D2）——不另建拉取。D1 触发档位已定（done/error/exec.artifact，见 §3）。
- main.ts/app.module 若有显式 gateway 挂载点（census A1 未检出显式挂载——@WebSocketGateway 自注册），以 grep 实证为准。
- VideoGenNode :90 `ensureExecutionSocket(projectId)` 引用删除时注意 useTrimTaskStatus/useVideoSeparateTask 的参数签名收窄（T1）。

## 9 与总目录的关系

本 spec 落地=总目录 Y3 行销案（E65② 退役顺序终点：「Y3 删 /execution」）；Y4+ 各行零耦合（时间轴/批注域不读本通知面）。D9 的「node:status 退场不早于 Y5」注记已被 E65 显式作废（hydration 自愈前移 Y0b-5）——总目录 v11 已收口，本批无需再改。
