<!-- doc-status: active | created: 2026-11-19 | v2.5（2026-11-19 plan 外审二轮三定案逐锚核实采纳：①**重放结果不能靠 resultRef 是否为空**——runGuarded 作废臂/交付臂返回同一体 {replayed:true,resultRef}〔ai-image-edit.controller:91-97——作废只是 socket 不带 fileId，intent.resultRef 仍在；lighting.controller:86-92 同形〕+lighting 第三形态 60s 去重 {replayed:true,taskId,status}〔:108 无 resultRef〕——「resultRef 非空=交付」会把作废重放当成功关编辑、去重回放当作废停处理中〔**v2.4 我方判据错认账**〕；改**显式结局**四档：新建入队 {replayed:false,intentId,+现有入队字段}/交付重放 {replayed:true,outcome:'delivered',resultRef}/作废重放 {replayed:true,outcome:'voided'}/打光去重 {replayed:true,outcome:'deduped',taskId,status}——客户端只认 outcome〔delivered 退出+清基线/voided 保持/deduped 本批无画布消费者不进编辑工具条——LightingModal 实证 TODO 桩未接线 :93〕；「重放体保持 {replayed,resultRef} 不加」作废②**Feed error 唯一出口=feedError(code,row|null)**——errorPatch 自由字符串第二参删〔v2.4 封闭句漏冻结路径 generic+PLAN_MISSING〕；冻结 generic catch :946-948 **三叠错**：err.message 进团队投影+7 天 IDB+attempts 写死 0〔重试次数显示错〕+rearmable 写死 false〔面板 rearmable===false 当次数用尽→铸新付费手势而非免费 rearm——代次守卫已随 doc 写面退役 0 挡不住〕；:934 TEXT_PROVIDER_UNKNOWN 同病 attempts 0；PLAN_MISSING :358 拼节点 id+内部断言进 Feed〔改「节点缺少定价快照」不拼 id——原文只进日志〕；冻结路径三缺：PLAN_MISSING :796 只进 errors[] 不写 Feed〔画布停 loading〕+intent-stale :894-897 同病〔非冻结 :486 已写超时句〕+catch 无 FundsInvariantError 分支〔:919-924 直接 void+fail——主路径 :575-584 有「不 void 不 fail 留对账」分义〕——冻结路径补齐三臂与主路径同规则〔feedError 统一：有行写 intentId/attempts/execSeq=row.execSeq.toString()；rearmable=资金不变量与 INTENT_EXHAUSTED 为 false 其余 attempts<3——冻结与主路径同一规则〕；发起者 HTTP errors[].error 仍可带原文〔「err.message 只进 logger」不扩到响应体〕；reaper 两句维持现状不并进执行链超时文案③plan v2 T6/T8「按 v1 原文执行」自指断链〔v1 已被 v2 覆盖不存在〕——改指 spec：余额=§3 D1、删除面=§3 S1+S2 含 page.tsx ensureExecutionSocket/teardownExecutionSocket；行为不改；v2.4=plan 外审一轮〔封闭句表/受理响应/基线禁0/必填键〕①**Feed error 只用封闭句**——errorPatch 第二参今天就是 err.message、TEXT_PROVIDER_UNKNOWN 两处〔execution.service:599-603/:926-934〕把异常原文拼在「不会重复扣费」前——err.message 带换行/URL 时三档消毒整句改「生成失败」连资金承诺一起丢、不带时内部路径/参数回显原样进团队投影+7 天 IDB；**err.message 禁止再进 errorPatch**〔异常原文只进日志；节点执行接口 errors[].error 仍可带原文=请求响应非团队投影〕+节点执行通用失败 Feed 句改「生成失败」〔errorCode=实际码缺省 EXECUTION_FAILED——:622 现推导 err instanceof BusinessException?err.errorCode:'EXECUTION_FAILED' 承接〕+TEXT_PROVIDER_UNKNOWN 两句/超时回收句/资金不变量句全按封闭句表落；三档消毒留组装器当最后一道不代替封闭句②**编辑幂等重放无 Feed 事件**——runGuarded !created 臂〔ai-image-edit.controller:82-98〕+lighting createTask 同形态〔lighting.controller:82-97〕只 emit 不写事件、返回 {replayed:true,resultRef}；socket 删后成功信号只剩投影——重放时投影 mediaId 就是基线、「变了才退出」永远停在处理中；方案=**受理响应即这次点击的结果**：新建成功返回补 intentId〔行身份列〕→客户端写入 ref+立刻读一次投影〔Feed 可能已先到〕；重放 resultRef 非空→退出编辑+processing false+清基线、作废重放无 resultRef→保持编辑态〔同今天 edit-result 无 fileId〕③**基线禁记 '0'**——历史 error 版本严格大于 '0' 会把上一次失败当这一次弹；同节点在途意图有 partial unique 行锁〔generation-intent.service:175 RUNNING 闸〕协作者插不进第二次执行⇒身份判据=intentId 非版本单查；基线 nodeVersion=当前槽合法十进制版本/无则当前 cursor.feedSeq/再无为 null〔禁 '0'〕+intentId 点击时 null、响应后写入；错误匹配三条件=ref 非 null∧intentId 对上∧版本严格大于基线；**「三次写入」漏的两个生产写点一并补**——reaper projectReaped〔intent-reconcile.service:529-536 现无 intentId/execSeq〕+lighting 资金分支〔lighting.consumer:252-258 现无 intentId——编辑超时要能对上这次点击〕④**组装器必填键定死**——status 非空字符串否则抛错；attempts 有限数字缺则 0 始终写入；execSeq 仅 /^\d+$/ 字符串才写入〔typeof 收敛会把数字 execSeq 写进 JSON 破坏 wire 纪律〕；截断按 UTF-16 码元 200；fileId/jobId/reason/nodeVersion/v/kind 一律不写；**projectRuntimeExecToNodeStore intentId 缺失回落 execSeq 那行删掉**〔runtimeStore.ts:42-43 两列非同一身份无用户数据=垫片〕⑤**文档残句**——spec §6 第三件/plan commit body 仍写 RESERVE_FAILED 与 D2 矛盾〔以 D2 为准：errorCode=实际原因码、凭证例=CREDIT_INSUFFICIENT+「积分不足」〕+plan Review Focus 残段档钉 T2 应 T1〔组装器单测面〕；维持面=TEXT_PROVIDER_UNKNOWN 封闭句表五场景/trim/separate 钉 3s〔现码 socket 连 10s/断 3s——删快路径后常态即 3s〕/useAsyncMediaTask 单调序号作废在途〔cleanup 与 taskId 变化各 +1〕/拼接 done 锁收迟到 COMPLETED/发起者关页=现架构不塞本批；v2.3=四轮〔三档序/intentId 行身份/errorCode 原因码/信号恰一次〕；v2.2=三轮〔错误句只走一份 shared 允许清单组装器〔status/attempts/execSeq/errorCode/artifactRev/intentId/rearmable/error 八键——writeExecStatus+deliverArtifact 同调；error 收口三档：非串/空白省键、截 200 字、含换行或 http(s) 整句改「生成失败」不保留残片——PII 门只扫键名实证 runtimeEventPayloadPiiViolations 遍历 Object.keys 值不扫〕+顺带补洞：deliverArtifact 状态字面量现丢 intentId/execSeq〔:319-324 只拷 status/attempts/errorCode vs writeExecStatus spread :253/:259 有拷——两份组装器形状不一致〕+服务端 slotOfEvent 无 execSeq+服务端/客户端 slot 函数改调同一 shared 投影函数带 nodeVersion②工具条订阅 useRuntimeFeedStore((s)=>s.projection?.nodes[id])〔未改节点保持原对象引用〕+基线 BigInt 严格大于+退出/卸载清基线+刷新后基线丢可接受③余额信号恰一次〔fetchRuntimeSnapshot 加用途参数——init 首次快照不发+四条回落全量各发一次（游标<水位/historyId 不符/doc.vacuumed/缺口）+增量批次 done/error/exec.artifact 整批一次+缺口转快照不重算被弃批〕+默认团队比较结果放 ref④删除面补 census 漏的 worker.module.ts:274 EmitPort provider〔我 A 节漏报认账〕+collab_emit_degraded_total 仅在 emit.port.ts 定义、*.metrics.ts 围栏无此项——删 Counter 即可勿进围栏勿跑 --write-metric-names〔v2.1「spec §10 同步 -1 项」作废〕+grep 门禁排除测试树+超时后迟到 COMPLETED 不得 spawnResultNode+轮询返回终态不再建 interval+在途响应作废；扣费失败封闭原因码六行词表〔CREDIT_INSUFFICIENT 积分不足/QUOTA_EXCEEDED 本月额度已用尽/NOT_MEMBER 不在该团队，无法扣费/TEAM_BALANCE_MISSING 团队积分账户不存在/RESERVE_GATE_LOST 及其他 扣费失败，请重试——原因码只进日志〕+通用失败固定句「AI 处理失败」error.message 只留日志+编辑扣费失败 intentId/attempts 从意图行读〔job 上无手势 token〕+同文件资金不变量写补 intentId+PROJECT_TEAM_MISSING/INTENT_GUARD_MISSING 现状零 emit 零 Feed 写不动；维持=一 PR 两笔先加后删一次发布/第一笔可单独进库/流水线分步先 web 后 api//payment/EVENT_KINDS 五值/三族不进 Feed/轮询留发起者/E64 只复跑；PII 门=runtime-event.ts:98 正则+feed 写入 :138 调用〕；v2.1=二轮〔复制链五处/基线读投影/先加后删/§1 残句清〕；v2=一轮〔静默重拉/补 error 键/轮询钉发起者/两 commit〕；v1=初稿；未开工） -->
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
| **PII 门只扫键名**（`runtimeEventPayloadPiiViolations` 遍历 Object.keys 值不扫——供应商原文/预签名 URL 可过门直进 PG+全员投影+IDB 7 天）；错误句现状=调用方传 error.message 原文+errorPatch 亦带异常原文（**v2.4：原文禁入 Feed——封闭句表+三档消毒双层**） | `runtime-event.ts:98-107`、`runtime-feed.service.ts:138` | 值收口双层（非门禁）：封闭句表为第一道（§3 D2——err.message 只进日志）；组装器三档消毒为最后一道（先检原文再截断：空白省键/命中换行 `\r` http(s) `://` 整句改「生成失败」/其余才截 200 字） |
| **调用方两处 `.slice(0,200)` 先截后检**（errorPatch execution.service:169+processor 通用失败 :337——组装器若只延续截断：URL 落第 200 位之后被切掉、残段绕消毒档照样入库）；契约类型 exec.status 缺 `execSeq?: string`（载荷 :253 已在写——类型滞后）；客户端 slotOfEventWire:176 `?? e.feedSeq` 对缺 nodeVersion 事件**伪造版本兜底** | `execution.service.ts:169`、`ai-image-edit.processor.ts:337`、`runtime-event.ts:31-44`、`runtimeStore.ts:176` | D2 v2.3：三档序=先检查原文再截断；两处调用方截断随组装器删除；契约类型补 execSeq?+error?；缺 nodeVersion 不算一条状态（伪造兜底删） |
| 节点执行链扣费失败现句=`扣费失败：${原因码}` 落执行接口 `errors[].error`+投影（execution.service :436-438/onReserveFail :174-179）——原因码原文直达调用方 | `execution.service.ts:434-439/:174-179` | 词表句子同步进 errors[].error；onReserveFail 与编辑 processor 同走一份词表（§3 D2） |
| 测试侧两处随第二笔删（生产 grep 排除测试树扫不到）：worker.module.spec:116/:143「EmitPort=WorkerEmitPort」断言+gateway/emit.port.spec.ts 端口单测 | `worker.module.spec.ts:116/:143`、`gateway/emit.port.spec.ts` | 删除面显式列名（§3 S1 v2.3）——断言随装配段翻新/文件随端口删 |
| socket 挂载：main.ts（或 app.module）的 /execution gateway 注册 | census A1（gateway 装饰器即挂载） | 删 gateway 类=删挂载（Nest @WebSocketGateway 自注册） |

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

- **shared 允许清单组装器**（第一笔）：writeExecStatus 与 deliverArtifact 的 exec.status 组装收口为 shared 里一个组装器，两边同调。允许键恰八：`status、attempts、execSeq、errorCode、artifactRev、intentId、rearmable、error`。fileId 留在 exec.artifact 不进状态事件。**组装器必填键定死（v2.4 定案④——「键有值才写」只适用可选键）**：status=非空字符串否则抛错；attempts=有限数字、缺则 0、**始终写入**；execSeq=仅 `/^\d+$/` 字符串才写入（typeof 收敛会把数字 execSeq 写进 JSON——破坏 wire 纪律 BigInt 一律 string）；errorCode/intentId=非空字符串才写入；artifactRev=有限数字才写入；rearmable=布尔才写入；error=三档（先检查 trim 后全文，再决定替换或截断；截断按 UTF-16 码元 200）。fileId/jobId/reason/nodeVersion/v/kind 一律不写——nodeVersion 由 `appendEventInTx` 以本事件 feedSeq 单源盖上（runtime-feed.service:134-136），组装器/调用方禁自带。execDonePatch 本体不改（fileId 仍只在 exec.artifact）。**顺带补洞**：deliverArtifact 状态字面量现丢 intentId/execSeq（:319-324 只拷 status/attempts/errorCode——与 writeExecStatus spread :253/:259 形状不一致）；服务端折叠快照 slotOfEvent 现无 execSeq（重连/缺口/换代走这份快照）。jobId/reason 今天就被现有字段清单丢掉——八键不丢任何一个正在生效的键。契约类型 `RuntimeEventPayload.exec.status` 同笔补**已在落库的** `execSeq?: string`+新增 `error?: string`（:31-44 现缺——类型滞后勘正）。
- **服务端 slotOfEvent 与客户端 slotOfEventWire 改调同一个 shared 投影函数**（字段=允许清单一致+nodeVersion）。**共享投影函数只在键有值时拷贝——缺的可选键不写成 undefined**。**缺 nodeVersion 的 exec.status 不算一条状态**——客户端 slotOfEventWire:176 `?? e.feedSeq` 伪造版本兜底删除，不另用 feedSeq 补一个版本。`projectRuntimeExecToNodeStore` 同批拷 error；**intentId 缺失回落 execSeq 的那行（runtimeStore.ts:42-43）删除**——两列不是同一个身份、无用户数据，不留垫片；`selectRuntimeEntry`（runtimeStore.ts:208）返回类型补 `error`+`execStatus.nodeVersion`；`ExecStatusEntry` 已有 error 不加 nodeVersion。`EVENT_KINDS` 仍五值；契约类型（RuntimeEventPayload exec.status+RuntimeProjectionExecStatusFact）加可选 error。
- **error 收口=封闭句表（v2.4 定案①——Feed 只用封闭句）**：writeExecStatus 今天丢 error、组装器一旦放开=这条句子进 RuntimeEvent+每个协作者投影+7 天 IDB（PII 门只扫键名）；errorPatch 第二参今天就是 `err.message`、TEXT_PROVIDER_UNKNOWN 两处（:599-603/:926-934）把异常原文拼在「不会重复扣费」前——原文带换行/URL 时三档消毒整句改「生成失败」连资金承诺一起丢、不带时内部路径/参数回显原样进团队投影。**err.message 禁止再进 errorPatch**——异常原文只进日志；节点执行接口返回发起者的 `errors[].error` 仍可带原文（请求响应非团队投影）。三档消毒留在组装器当最后一道，不代替封闭句。封闭句表：

| 场景 | Feed error | errorCode |
| --- | --- | --- |
| 扣费失败五码 | 现有词表（未命中：扣费失败，请重试） | 实际原因码 |
| 编辑通用失败 | AI 处理失败 | EDIT_FAILED |
| 节点执行通用失败 | 生成失败 | 实际码，缺省 EXECUTION_FAILED（:622 现推导承接） |
| 超时回收 | 生成已被系统回收（超时）——产物未投递 | INTENT_DEADLINE_EXCEEDED |
| 资金不变量 | 生成结果暂缓交付（资金核销异常，待对账处理） | FUNDS_INVARIANT_VIOLATION |
| 外呼结果不明，已 markUnknown | 可能重复生成、不会重复扣费（请稍后查询或重试） | TEXT_PROVIDER_UNKNOWN |
| 外呼结果不明，mark 失败 | 外呼结果不明，扣费状态待对账（请稍后查询或重试） | TEXT_PROVIDER_UNKNOWN |
| reaper 两句 | 保持现句（已是封闭句） | 现码 |

- **Feed 的 intentId=行上 `intentId` 列**（claim 时服务端 `randomUUID()` 铸造的**行身份**——gestureKey 才是客户端手势的审计列、不进事件；`id`=行 cuid；job 上没有这列。v2.2「行上手势 token」术语勘正）。扣费失败、通用失败、资金不变量**三次写入都从意图行读出 intentId/attempts/execSeq 放进 patch**：intentId=行上 intentId、`execSeq=row.execSeq.toString()`、扣费失败另写 `rearmable: attempts<3`。writeExecStatus 的第四个参数是 worker HMAC 作用域 `{ intentRowId, execSeq }`——Direct 端口忽略它、它不进事件体。**v2.4 补漏两个生产写点**（v2.3「三次写入」清单漏）：reaper `projectReaped`（intent-reconcile.service:529-536——现无 intentId/execSeq）与 lighting 资金分支（lighting.consumer:252-258——现无 intentId）一并从行上补 intentId+execSeq，否则编辑超时（走 reaper 收敛）对不上这次点击。
- **Feed error 唯一出口=feedError(code, row | null)（v2.5 定案②——errorPatch 自由字符串第二参删除）**：句子只来自封闭句表；有意图行时写入 intentId、attempts、`execSeq=row.execSeq.toString()`；**rearmable 统一规则：资金不变量与 INTENT_EXHAUSTED 为 false，其余 attempts<3——冻结路径与主路径同一规则**（现冻结 generic catch :946-948 写死 0/false——attempts 0 使重试次数显示错、rearmable false 使配置面板把可免费 rearm 的失败当次数用尽铸新付费手势）。**PLAN_MISSING 用「节点缺少定价快照」不拼节点 id**（现 :358 `节点 ${node.id} 无定价快照（validation/execution 节点集分叉？）` 进 Feed）；原文只进日志。**冻结路径补齐三臂与主路径同规则**：①FundsInvariantError 不 void 不 fail（现 :919-924 直接 `voidForExecutionRequestItem`+`void_`+`fail`——主路径 :575-584 有「行留 RUNNING 交对账第四分支」分义，冻结 catch 把应留对账的冻结 void 掉）②intent-stale（:894-897 现只进 errors[] 不写 Feed——画布停 loading；非冻结 :486 已写超时句）补同一条 Feed 写③冻结 PLAN_MISSING（:796 现只进 errors[]）同补。冻结 TEXT_PROVIDER_UNKNOWN :934 attempts 同病（写死 0——feedError 统一后随行读修复）。发起者 HTTP 的 `errors[].error` 仍可带原文（「err.message 只进日志」不扩到响应体）。reaper 两句维持现状不并进执行链那句超时文案。

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

  客户端只认 outcome：delivered→退出编辑+processing false+清基线；voided→保持编辑态与 processing（同今天 edit-result 无 fileId 行为）；**deduped 本批无画布消费者**（LightingModal 实证 TODO 桩未接线 :93——不塞进编辑工具条的等待）；新建成功→intentId 写入 ref+**立刻读一次当前投影**（Feed 可能已经先到——不能只等 effect）。
- 订阅：`useRuntimeFeedStore((s) => s.projection?.nodes[id])`（合并时未改动的节点保持原对象引用——其他节点的事件不误触发）。
- **基线在 await 之前写入 ref，但身份判据=intentId 非版本单查（v2.4 定案③——禁记 '0'）**：点击处理函数里发出请求之前，同步写入：`nodeVersion`=当前槽上合法十进制版本，没有则当前 `cursor.feedSeq`，再没有则 **null（禁止写 '0'**——历史 error 的版本严格大于 '0' 会把上一次失败当这一次弹）；`mediaId`=当前 artifact；`intentId`=null（此时还没有）。**响应回来后把 intentId 写进 ref 并立刻读一次当前投影**。此后判定：
  - ref 为 null，或 intentId 仍为 null：不改编辑态（ref 未写时投影变化不算——打开编辑模式时节点旧错误不当成这一次的失败）。
  - `status==='error'` 且 `entry.intentId === ref.intentId` 且版本严格大于基线（十进制 BigInt）：工具条显示投影 error（空串与缺键→「AI 处理失败」）+setProcessing(false)。
  - 此后 mediaId 相对基线变化且非空→仍退出编辑模式（成功信号——新建档）。
  - 退出编辑或卸载：清 ref；刷新后基线丢失、处理中回到可再点击——接受（如实登记）。
  - 同节点在途意图有 partial unique 行锁（generation-intent.service:175 RUNNING 闸）——协作者插不进第二次执行，intentId 身份判据不会误伤上一次失败（投影槽只留最后一条 exec.status）。
- 成功但 mediaId 相对基线没变、或新值为空→编辑模式保持打开、处理中保持（作者槽作废档——同今天行为）。
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

**第一笔测试三件（先红后绿）**：①带 error:'积分不足' 的 exec.status 经写入、折叠快照、客户端槽——投影里仍是该句②error:'see https://x' 落成「生成失败」（**先检原文再截断**——第 200 位后才出现 `https:` 的残段档随附）③删 emit 之前扣费失败分支就有一条 Feed 写：errorCode=**实际原因码**（凭证例 CREDIT_INSUFFICIENT）、error=词表句「积分不足」、intentId 等于行上 intentId 列（v2.4 残句勘正——不再写「统一 RESERVE_FAILED」）。

## 4 切法（一个 PR、两个 commit、一次发布——先加后删）

| commit | 内容 | 出口锚 |
| --- | --- | --- |
| **第一笔（可单独运行/可单独进库）** | shared 允许清单组装器（八键+必填键定死〔status 抛错档/attempts 恒写/execSeq 十进制 string 档〕+error 三档消毒**先检原文再截断**）+writeExecStatus/deliverArtifact 改调组装器（补 deliverArtifact 丢 intentId/execSeq 洞）+服务端 slotOfEvent/客户端 slotOfEventWire 改调同一 shared 投影函数（删 ：176 伪造兜底+删 intentId 回落 execSeq 垫片行）+projectRuntimeExecToNodeStore 拷 error+selectRuntimeEntry 类型补+契约类型补 execSeq?/error?+taxonomy 契约测试+**errorPatch 删除→feedError(code,row|null) 唯一出口**（八调用点全改：主路径 :179/:358/:486/:582/:603/:625+冻结 :934/:947——封闭句表+行读 intentId/attempts/execSeq+rearmable 统一规则〔资金不变量与 INTENT_EXHAUSTED=false 其余 attempts<3〕+PLAN_MISSING「节点缺少定价快照」不拼 id）+**冻结路径补三臂**（FundsInvariantError 不 void 不 fail/intent-stale 补 Feed 写/冻结 PLAN_MISSING 补 Feed 写）+processor 扣费失败/通用失败行读+reaper projectReaped 与 lighting 资金分支补行读+**runGuarded/lighting 受理响应改显式结局四档**（新建 {replayed:false,intentId}+delivered/voided/deduped——§3 D2 客户端半）。**socket 与 applyBalance 都还在**（多出的 error 是事件载荷扩键——画布文档模型不动，旧客户端忽略未知字段） | api/web 全量绿+第一笔测试三件（§3 S2）红→绿 |
| **第二笔（同一次发布、不得先于第一笔上线）** | 删客户端订阅、page.tsx 生命周期、executionSocket.ts、三族 socket 参数（先打一枪 3s/5s 轮询）、余额改空事件静默重拉（D1）+applyBalance 删除；再删 EmitPort（含 worker.module.ts:274 provider）、ExecutionGateway、全部 emit 调用（33 处）、构造注入、`collab_emit_degraded_total` Counter+emit.port.spec.ts/worker.module.spec 断言两测试面；S2 断言翻新+双端 grep 门禁+验收锚 | web+api 全量绿+双端 grep 零命中（§3 S2 清单）+验收锚两用例+E64 门复跑绿+E56 复核+verify fast 全绿 |

- **发布序**：两笔一次发布；第一笔可单独进库（载荷扩键不影响旧客户端）。若流水线分两步发，**先发 web 再发 api**——只上第二笔时扣费失败既无 socket 也无 Feed（编辑停在处理中）。
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

- **第一笔三件（先红后绿——§3 S2 已列）**：①error:'积分不足' 经写入→折叠快照→客户端槽投影仍是该句（slotOfEvent 链路完整性）②error:'see https://x' 落成「生成失败」（消毒档+200 位后才出现 `https:` 的残段档）③删 emit 前扣费失败即有 Feed 写：errorCode=实际原因码（凭证例 CREDIT_INSUFFICIENT）、intentId 等于行上 intentId 列、error=词表句子（词表各码句子档随附）。
- 第二笔：节点组件「无订阅」不变量锚×3；useAsyncMediaTask 轮询单通道（taskId 即刻首请求+单调序号作废在途——cleanup 与 taskId 变化各 +1+终态不再建 interval+零 socket 依赖）；useStitchTask 5s 轮询+65s 超时（超时后迟到 COMPLETED 走同一把 done 锁——不再 spawnResultNode）；余额=空 detail 信号恰一次（init 首次快照不发/四条回落各一次/增量整批一次/缺口转快照不重算被弃批）+CanvasTopBar 静默重拉（silent 档+序号+静默失败不改 loading/error/数字+默认团队比较结果 ref 化）；editError=**受理响应显式结局**（delivered→退出+清基线/voided→保持/新建→intentId 入 ref+立刻读投影——deduped 无画布消费者不进等待）+投影错误匹配三条件（ref 非空∧intentId 对上∧版本严格大于——基线禁 '0'：无合法版本用 cursor.feedSeq 再无 null）+空句兜底「AI 处理失败」+作废成功保持编辑态+退出/卸载清基线；emit 断言翻 appendEvent/writeExecStatus/deliverArtifact 断言（幂等回放臂四处 emit 断言直接删）。
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
