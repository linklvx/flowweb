<!-- doc-status: active | created: 2026-11-19 | v9（2026-11-19 依 spec v3.1 落盘——外审八轮四合同（开工合同）：①**收场函数改命中即返回三闸三分支**〔v3.0 第⑥条排 error/done 后——同 intentId 上一代 done 先走进清 processing/退出、第⑥条永远走不到；正序=ⓐref/intentId 闸ⓑintentId 闸ⓒexecSeq 闸〔缺也算不匹配〕→ⓓerror 版本闸〔基线 null 视为大于、非十进制视为不大于〕ⓔdone mediaId 变非空ⓕdone 未变/空〕②**regen-token 三步进第一笔**〔rotateToken(pid,nid,execSeq) 同 execSeq 只轮换一次+小则忽略/markGestureConsumed 只在真发受理那次〔渲染读不算〕/回滚三条件（非终态∧槽 execSeq 更大∧未消费→恢复轮换前值）；无 execSeq 无行终态维持今天行为；六面板+PreviewPlayer done 即轮换无代际——两次同步间旧代 done 先轮换+高 execSeq loading 后到=撤不回来→旧 token 再发/新 token 重试=服务端对不上原手势再开一笔扣费〕③**七步序两细化+状态只在持锁事务改**〔CanvasProject FOR SHARE；skipped 第三处=:616 NODE_BUSY 带 claimed 档补 execSeq；作废行状态转移全在行锁事务内不调 mark()〔runId CAS 失败只打日志——事件先提交行仍 projecting〕；开发库清废票范围 state IN ('orphaned','superseded')〕④**本批不扩大**〔冻结资金臂 :920 后 :939 前不 void 不 fail 留 RUNNING 写 FUNDS_HELD continue——reaper 按 deadline 收敛 RUNNING 行=资金域既有行为不改扫描条件；冻结 same-job-alive :811 零 Feed 写维持不补 skipped；EVENT_KINDS/三族//payment/拼接载荷/墓碑合并不动〕；规格残句清〔§4 表新建档补 execSeq/:156-157 重复句删〕；执行顺序=第一笔 T1-T4 含轮换+持锁事务〔api 默认池+web+三 int 绿〕/第二笔 T5-T8 含 page.tsx；发布序维持）；v8（2026-11-19 依 spec v3.0 落盘——外审七轮三定案修正 v2.9 两句撞车：①**作废行串行锁=投影行 FOR UPDATE 非 fence 行锁**〔deliveryFenceCheckInTx 在 DeliveryFence 上 FOR UPDATE——fence 行不存在锁 0 行、「未注册」恰是要照写 done 的档=锁不住；ArtifactProjection 行一定在——claim SKIP LOCKED 锁的就是它〕+项目没了判据=同事务读 CanvasProject（灭失或 lifecycleState≠'ACTIVE'——非 flush deletedProjects、非 fence 结果；RuntimeEvent 无外键）+事务前 assertWriteAdmitted（租约/spool 不可写=作废行 fencedBail 回 pending）+七步序〔再查 epoch/CanvasProject 判据/投影行 FOR UPDATE/锁后查重（命中只跳插入仍标 projected）/键读 GenerationIntent——**execSeq=键末段非行上现值**〔行没了 attempts 0+execSeq 仍键值照写〕/行标 projected WHERE id 非 mark() runId CAS（0 行=回滚）/提交后 notifyProject〕+载荷 assembleExecStatusPayload 非 execDonePatch〔带 fileId〕②**done execSeq=键值+收场第⑥条 execSeq 相等**〔rearm 同行换代不重铸 intentId :240-263——读行现值=上一代 done 写成新代序号盖新代 loading；受理新建档补 execSeq {replayed:false,intentId,execSeq}；基线 ref 加 execSeq；旧 done 先落槽清 processing+新 loading 不会设回=假结束态〕③**发布序维持+开发库清废票**〔先删 artifactId LIKE 'author-void:%' AND state='orphaned' 行——不写迁移不进代码〕；收口维持：mergeSlot 仅 execStatus 槽比 execSeq〔测试 "10" vs "9"——BigInt 非字符串〕+带行四态全携 execSeq=intent.execSeq.toString()〔无行档不写〕+supersedeProjections 排前缀〔保留矩阵同款排除已在勿再改〕+worker 不写 done 403 原样/作废行 pending+commit 返回 superseded/feedError 封闭句/显式四档/两笔 commit；规格「此后 mediaId 变化退出」句与两句重复「跟 poller 走」**不实现**——收场只实现收场函数）；v7（2026-11-19 依 spec v2.9 落盘——外审六轮三定案：①**作废 done 终态三条分档**〔epoch 失守=整批回 pending 可再领/项目还在含节点删与 fence 未注册=照写 done 行 projected 不退款/项目没了=零事件行 orphaned〕+不进 deliverable·flushDocument 批次+单 appendEventTransaction〔deliveryFenceCheckInTx FOR UPDATE 行锁先拿、锁到手不管放行与否都写——作废 done 是收场信号非产物投递；查重必须在 fence 行锁后防 M-10 TOCTOU 复发；行标 projected 同事务+提交后 notifyProject〕+attempts/intentId 从键拆出的意图行 cuid 读〔行没了 attempts 0 照写〕②**编辑收场只认这一次的 intentId 收成单函数**〔done 档补身份判据——上一代产物落地 mediaId 变≠这一次成功/上一代作废 done 早到≠这一次结束；五条：ref 空或 intentId null 不动/error∧同 intentId∧版本大于基线=投影句+processing false/done∧同∧mediaId 变非空=退出清基线/done∧同∧未变或空=processing false 留编辑态/intentId 对不上不动——artifact 槽仍只比 nodeVersion 不为收场改产物槽；delivered 响应内直接退出〔产物点击前已在槽上——不走变了才退出〕；产物事件不加 intentId〕③**第一笔必须先 api 后 worker（或同批一次上）**〔理由换硬：旧 poller 收到 pending 作废行查 NodeArtifact 不到即 orphaned 不再领=票据永久报废——比旧理由「error 字段被丢」硬一档；发布窗单边缺 execSeq 退回 nodeVersion+NodeBusy 防双扣非改规则理由；开发库跑过旧顺序清 author-void:∧orphaned 行〕）''；v6（2026-11-19 依 spec v2.8 落盘——plan 外审五轮五组全实锤：worker done 黑名单 403〔collab-write.controller:36/:122-124〕+端口 permanent 吞错不上抛〔collab-write.port:219-227〕+作废行 superseded 永不被 poller 领〔artifact-commit:631-639+claim 只领 pending/projecting〕+mergeSlot 只比 nodeVersion〔runtime-projection:98-102〕+loading 无 execSeq〔:416/:865〕；**v5 定案③「四臂直接 writeExecStatus done」生产写不进——认账重写为作废终态投影 poller 单写**：四臂照旧只交 authorVoid〔黑名单与 403 集成测试原样〕+作废行初始态 superseded→pending〔commit 返回仍 superseded/幂等按键查〕+poller 查 NodeArtifact 之前认 author-void: 前缀岔开〔不走 deliverArtifact——必写 exec.artifact+artifactRev=0 撞 0 代幂等键〕——事务内查重后单写一条 exec.status done〔行身份+attempts 从 GenerationIntent 行读——投影行 attempts 列=重试计数〕+行标 projected+notifyProject；fence 拒/节点删=零 Feed 零退款行标终态；supersedeProjections 排除 author-void: 前缀〔:303-308 rearm/takeover 窗灭票补刀〕+mergeSlot execStatus execSeq 代际规则进 shared〔大 execSeq 胜→同 seq 比 nodeVersion→缺 seq 仍比 nodeVersion；带行 loading/skipped 补 execSeq〕+基线 mediaId 读源=Runtime 投影 artifact 槽非 Yjs 值+voided 收场=processing false 留编辑态〔今天无 fileId 档两分支都不进永转圈 :1080-1095——v4 旧句作废〕；v5 定案①②④与组装器/封闭句/feedError/显式结局/两笔 commit 边界全维持）；plan v5（依 spec v2.7 落盘——plan 外审四轮四定案采纳〔四条删 socket 后无终态事件的补写进第一笔〕：①reaper 常驻门删——projectReaped isDocResident=false 早退是 Yjs 时代遗留〔alignExecFromIntents 已不存在——writeExecStatus 现=PG 追加零装载〕，始终 feedError〔REAPER_DEADLINE/REAPER_STALE+行身份〕+删 deferred 计数支+exec-partial int 用例翻「无连接也写入」②编辑/打光 intent-stale 补 Feed〔processor :239-241/lighting.consumer :184-186 现 return completed 零写——feedError('INTENT_DEADLINE_EXCEEDED','EXEC_DEADLINE',row) 句子 id 与 REAPER 分立〕③四处作者槽作废臂补 done 事件〔execution 主+冻结+processor+lighting.consumer——带行身份不带 error 不写 exec.artifact；工具条 done∧mediaId 变→退出/done∧未变→processing false 留编辑态；voided 同收场——重放不写新事件不能拿版本大于基线等已存在的 done；打光去重不补 Feed〕④冻结缺节点 errors[] 同改 FROZEN_INPUT_MISSING 同句。发布序：第一笔先 api 后 worker 或一起/第二笔先 web 后 api+worker；第一笔提交前加跑 exec-partial-success.int.spec。测试提示：provider-convergence 'stale worker' 等值后「生成失败」/executionSocket.test.ts 随删/useAsyncMediaTask 后续拍终态清已建 interval+序号失配拍不 setState；v4=三轮〔feedError 句子 id/等值检查/rearmable 按码按行/插入点〕；两笔 commit 边界不动） -->
# Y3 协议退场 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删 `/execution` socket.io 命名空间与五族 socket 通知——执行进度走 RuntimeFeed、三族任务改 REST 轮询单通道、余额改 REST 事件驱动刷新；先补 Feed 字段与扣费失败写入（第一笔），再双端同删（第二笔）。

**Architecture:** 服务端 exec.status 载荷收口到 shared 一个允许清单组装器（八键+必填键定死+error 封闭句等值检查兜底）；**Feed error 唯一出口=feedError(errorCode, sentence, row|null)**（进 shared——FeedSentenceId 闭枚举，句子与原因码分开：同码异句由调用点显式选 id）+组装器 error 只放行封闭句（全文等值否则整段「生成失败」——不截断）；编辑成功信号=受理响应显式结局四档（replayed:false/intentId、delivered、voided、deduped——联合类型进 shared）+投影（客户端只认 outcome——接住 withSyncRetry 泛型返回）；客户端 edit 失败匹配=intentId 身份+版本严格大于基线；**作废终态=投影 poller 单写一条 done**（worker 403 黑名单不可越——作废行 pending 出站票据+前缀分流）；execStatus 合并加 execSeq 代际规则（大代终态不被迟到旧代覆盖）；三族任务轮询钉发起者组件（3s/5s 单值+单调序号作废在途）；最后整体删除 EmitPort 端口族+ExecutionGateway+executionSocket 单例。

**Tech Stack:** NestJS (api/worker 双进程)、BullMQ、Prisma+PG、RuntimeFeed（RuntimeEvent 表+feed-hint stateless）、zustand (web)、vitest（三池：默认/heavy/int——int 须显式 `-c vitest.int.config.ts`）。

**Spec:** `docs/superpowers/specs/2026-11-19-y3-protocol-retirement-design.md`（v3.1——本 plan 的一切裁决以 spec 为准，执行者读两份）。

## Global Constraints

- TypeScript strict；禁垫片/禁兼容层/禁「socket 优先 REST 兜底」双通道（spec 反目标）。
- EVENT_KINDS 五值闭表零动；exec.status 补 `execSeq?`/`error?` 为该 kind 可选字段，非新 kind。
- **Feed error 只用封闭句表（err.message 禁入 Feed——异常原文只进日志；发起者 HTTP 的 errors[].error 仍可带原文=请求响应非团队投影，「err.message 只进日志」不扩到响应体）**：扣费失败五码→现有词表（未命中「扣费失败，请重试」）；编辑通用失败→「AI 处理失败」(EDIT_FAILED)；节点执行通用失败→「生成失败」(实际码缺省 EXECUTION_FAILED)；超时回收→「生成已被系统回收（超时）——产物未投递」(INTENT_DEADLINE_EXCEEDED)；资金不变量→「生成结果暂缓交付（资金核销异常，待对账处理）」(FUNDS_INVARIANT_VIOLATION)；PLAN_MISSING→「节点缺少定价快照」（不拼节点 id——仅主路径 planMap 缺失；冻结缺节点=FROZEN_INPUT_MISSING→「节点缺少冻结输入」）；TEXT_PROVIDER_UNKNOWN 已 markUnknown→「可能重复生成、不会重复扣费（请稍后查询或重试）」（id TEXT_UNKNOWN_HELD）/mark 失败→「外呼结果不明，扣费状态待对账（请稍后查询或重试）」（id TEXT_UNKNOWN_UNMARKED）；reaper 两句维持现句（id REAPER_DEADLINE/REAPER_STALE——事件码仍现两码）。组装器封闭句等值检查留最后一道（不代替封闭句——表外句整段换「生成失败」不截断）。
- **feedError(errorCode, sentence, row | null) 是 Feed error 唯一出口**（放 packages/shared/src/collab/runtime-exec-status.ts；errorPatch 删除）：sentence=FeedSentenceId 闭枚举；有意图行写 intentId/attempts/`execSeq=row.execSeq.toString()`；**rearmable 按码与有无行**：无行档（主 PLAN_MISSING/冻结 FROZEN_INPUT_MISSING/claim 前失败）attempts 0+rearmable false+**不写 intentId/execSeq**；有行 TEXT_PROVIDER_UNKNOWN **恒 true**（UNKNOWN 冻结靠同 token rearm voidInTx 释放——写成 attempts<3 会让面板提前轮换铸新付费手势）；其余有行 FUNDS_INVARIANT_VIOLATION 与 INTENT_EXHAUSTED 为 false、其他 attempts<3。票上的 intentRowId=行 cuid 非事件 intentId。冻结输入缺节点（:796）=FROZEN_INPUT_MISSING「节点缺少冻结输入」（不拼 id）——PLAN_MISSING 句只给主路径 planMap 缺失。
- 组装器八键恰：`status、attempts、execSeq、errorCode、artifactRev、intentId、rearmable、error`；必填键定死：status 非空字符串否则抛错；attempts 有限数字缺则 0 **始终写入**；execSeq 仅 `/^\d+$/` 字符串才写入；errorCode/intentId 非空字符串才写入；artifactRev 有限数字才写入；rearmable 布尔才写入；error **封闭句等值检查**（先 trim、全文必须等于封闭句表某句否则整段换「生成失败」——不截断不保留残段；表内句原样通过）。fileId/jobId/reason/nodeVersion/v/kind 一律不写；nodeVersion 只由 appendEventInTx 盖（runtime-feed.service.ts:134-136）。
- **受理响应显式结局四档**（联合类型放 shared——api 与 web 都引）：新建入队 `{replayed:false, intentId, execSeq}`+现有入队字段（execSeq=intent.execSeq.toString()——收场第⑥条消费；delivered/voided/deduped 不带）；交付重放 `{replayed:true, outcome:'delivered', resultRef}`；作废重放 `{replayed:true, outcome:'voided'}`；打光去重 `{replayed:true, outcome:'deduped', taskId, status}`。客户端只认 outcome：delivered→退出+清基线/voided→保持/deduped→本批无画布消费者（LightingModal TODO 桩未接线——不进编辑工具条等待）。
- **作废终态由投影 poller 单写（v2.8/v2.9/v3.0）**：worker 四臂照旧只交 `authorVoid:true` 给 commitImage/finalizeVideo，**四处都不调 `writeExecStatus({status:'done'})`**（exec-status 端点对 done 固定 403 WORKER_EXEC_STATUS_NOT_ALLOWED——collab-write.controller:36/:122-124；HttpCollabWritePort 对非 2xx 只记 permanent 计数不上抛——collab-write.port.ts:219-227：mock 测试绿≠生产 Feed 有此事件）；worker done 黑名单与「403 零事件」集成测试**保持原样**。作废投影行初始态 `superseded` 改 **pending**（artifact-commit.service:631-639——出站票据）；commit 返回仍 `outcome:'superseded'`；幂等短路按键等值查不按状态。poller 查 NodeArtifact **之前**认 `author-void:` 前缀岔开（键解析 `^author-void:(.+):(\d+)$`——中间=意图行 cuid、末段=该代 execSeq），不走 deliverArtifact（必写 exec.artifact 且 artifactRev=0 撞 0 代幂等键）、**不进 deliverable/flushDocument 批次且不得被兄弟行 flush 失败卷进 fencedBail**；**事务前先 `assertWriteAdmitted`**（与 deliverArtifact 同扇门 collab-document.service:234-235——租约/spool 不可写=该行与同批未写作废行 fencedBail 回 pending 不耗 attempts不标 orphaned）。**每行单独一个 appendEventTransaction、串行锁=投影行 FOR UPDATE（v3.0——fence 行锁在未注册档锁 0 行恰锁不住）**，七步：①事务内再查 epoch（失守=本行+同批未终态作废行 fencedBail；已 projected 的不进 bail）②项目没了判据=同事务读 **CanvasProject**（行灭失或 lifecycleState≠'ACTIVE'〔schema:151-160〕⇒零事件行标 orphaned——RuntimeEvent.projectId 无外键插入不失败；**不用 flush deletedProjects、不把 fence 未注册/fence-stale/节点已删当项目没了**——节点在不在画布以 Yjs 读模型为准，后写 done 不把已删节点画回来，不改墓碑合并）③`SELECT … FROM "ArtifactProjection" WHERE id=$rowId FOR UPDATE`（这行一定在——claim SKIP LOCKED 锁的就是它；零行防御档结束事务）；**fence 检查不参与分支也不当锁**（四种结果都写事件）④投影行锁后按 nodeId+**作废键 execSeq**+status='done' 查重（命中只跳插入**仍标 projected**——只跳不标=票永停 projecting 租约过期再被领）⑤键读 GenerationIntent：行在写 intentId/attempts/execSeq（**execSeq=键末段非行上现值**——rearm/takeover 同一行换代不重铸 intentId :240-263，读现值=上一代 done 写成新代序号、序号同值比 nodeVersion 时后写 done 盖新代 loading）、不带 error 零 exec.artifact；行没了日志+attempts 0+不写 intentId+**execSeq 仍用键值**、done 照写（无 intentId 的 done 无收场作用——如实写）⑥行标 projected 同事务、**WHERE id=$rowId 不走 mark() runId CAS**（租约重叠 CAS 0 行而事件已提交=外部见「有事件行仍 projecting」；0 行更新=事务回滚）⑦提交后 notifyProject。**载荷走 assembleExecStatusPayload、不复用 execDonePatch**（带 fileId）。R3 窗⑥ JOIN NodeArtifact 认不出作废键不误扫。**supersedeProjections 谓词排除 `author-void:` 前缀**（generation-intent.service:303-308；cleanProjection :612 同款先例——intent-reconcile 保留矩阵的同款排除已在，**勿再改那一处**）。保留矩阵按前缀豁免原样。
- **mergeSlot execStatus 加 execSeq 代际规则（进 shared——折叠与客户端增量同源）**：两边都有十进制 execSeq→大的胜；相同→比 nodeVersion；任一边缺→仍只比 nodeVersion（无行档不受影响）。生效前提=**带行 exec.status（loading/skipped/error/done）全携 execSeq**（feedError 侧已带；execution.service :416/:865 loading 与 :379/:430 skipped 现无——补上；deliverArtifact 正常 done 侧 poller execDonePatch 已造 intentId/execSeq 但 ④ 段字面量丢弃——随组装器改道一并透传）。
''- **编辑收场只认这一次的 intentId 与 execSeq、命中即返回三闸三分支（v3.1——v3.0 第⑥条排在分支后永远走不到）**：settleEditOutcome 订阅与响应后立刻读都走它。**三闸（任一不过即返回）**：ⓐref 空或 ref.intentId null→不动ⓑentry.execStatus.intentId≠ref.intentId→不动（产物槽照旧按 nodeVersion 换上）ⓒ**两边 execSeq 不是同一十进制串→不动（槽上缺 execSeq 也算对不上）**。**三分支**：ⓓerror∧槽上 nodeVersion 合法十进制∧严格大于基线→投影句（空缺键→「AI 处理失败」）+processing false（基线 nodeVersion null 时合法十进制视为大于；非十进制视为不大于）ⓔdone∧投影 artifact 槽 mediaId 相对基线变非空→退出编辑+清基线ⓕdone∧mediaId 未变或空→processing false 留编辑态不弹错。**基线 mediaId 读源=当前 Runtime 投影的 artifact 槽非 Yjs 节点 mediaId**；基线 ref 含 execSeq（受理新建档 {replayed:false,intentId,execSeq}——intent.execSeq.toString()；delivered/voided/deduped 不带）；intentId/execSeq 先写 null、replayed:false 响应写入后立刻调本函数。delivered 直接退出+清基线（产物点击前已在槽上）；voided 直接 processing false 留编辑态；deduped 不进工具条。**产物事件不加 intentId**——身份以 done 上的 intentId 为准。
- **regen-token 三步进第一笔（v3.1 合同二——面板轮换换代际）**：六面板+PreviewPlayer 今天 done 即 rotateToken 不看 execSeq（ImageConfigPanel:63-66 同族）；窗口=两次同步之间旧代 done 先应用已轮换 token、更高 execSeq loading 随后进槽——mergeSlot 保得住槽面撤不回轮换、这次点击仍持旧 token+失败重试拿新 token=服务端对不上原手势再开一笔扣费。①`rotateToken(projectId, nodeId, execSeq)` 同一 execSeq 只轮换一次、槽上 execSeq 比已轮换的更小则忽略；②`markGestureConsumed` 只在真正发出受理请求的那一次调用（渲染读 token 不算消费）；③回滚三条件：当前槽非终态（非 done 且非 error∧rearmable===false）∧槽上 execSeq 更大∧本轮换出 token 未被消费→恢复轮换前值。**无 execSeq 的无行终态维持今天行为**（error∧rearmable===false 照常轮换）；有 execSeq 的 done/不可 rearm error 必传 execSeq。**规格正文「此后 mediaId 相对基线变化且非空就退出」句与两句重复「跟 poller 走」不实现**——收场只实现本函数。''
- 客户端错误匹配三条件：ref 非空 ∧ `entry.intentId === ref.intentId` ∧ 版本（十进制 BigInt）严格大于基线；**基线禁 '0'**（nodeVersion=槽上合法十进制/无则 cursor.feedSeq/再无 null）。
- intentId=GenerationIntent 行上 `intentId` 列（claim 时 randomUUID 铸）；**七处失败写入**（扣费/编辑通用/资金不变量/reaper projectReaped/lighting 资金分支/冻结路径各臂）都从意图行读 intentId/attempts/execSeq。
- 缺 nodeVersion 的 exec.status 不算一条状态；共享投影函数只在键有值时拷贝、缺的可选键不写 undefined；**projectRuntimeExecToNodeStore 的 intentId 回落 execSeq 行删除**（两列非同一身份=垫片）。
- trim/separate 轮询常态 3s（现码 socket 连 10s/断 3s——删快路径后恒 3s）；stitch 先请求一次之后 5s、65s 从 start() 起算；useAsyncMediaTask 单调序号作废在途（cleanup 与 taskId 变化各 +1）；终态不再 setInterval。
- /payment 与 socket.io-client 包保留；PROJECT_TEAM_MISSING/INTENT_GUARD_MISSING 维持零写不动；stitch spawnResultNode 载荷（fileId+status:'done'）不改；发起者关页后三族结果节点不出现=现架构（不塞本批）。
- **commit 纪律：全批恰两笔大 commit**——T1-T4 组成第一笔（`feat(y3): exec.status 组装器+封闭句表+失败写入收口`），T5-T8 组成第二笔（`refactor(y3): 删 /execution 命名空间——通知退场 Feed/轮询/REST 单通道`）。任务边界≠commit 边界：组内任务完成只跑门禁不 `git commit`，组末一次提交；第一笔提交前须全量绿（含 socket 仍在的既有测试）。

## Review Focus

1. **表外句子漏进 Feed**：err.message 无换行无 URL 时任何机械消毒（截断/关键词）都放行——供应商原文/参数回显直进全员投影。测试：T1 等值检查档（表外任意句含长前缀尾部 URL 与超长句→整段「生成失败」；表内「积分不足」原样通过）。
2. **作废重放当成交付**：作废臂与交付臂返回同一个体（resultRef 都在）——按 resultRef 判定会把作废当成功关掉编辑。测试：T3 显式结局断言（voidRow 档 outcome='voided' 无 resultRef 键）+T7 客户端只认 outcome。
3. **冻结路径写死 0/false**：attempts 0 使重试次数显示错；rearmable false 使面板把可免费 rearm 的失败当次数用尽铸新付费手势。测试：T3 冻结三臂断言（attempts=行值/rearmable=统一规则/资金不变量不 void 不 fail）。
4. **供应商原文直进团队投影**：err.message 无换行无 URL 时机械消毒放行。测试：T3 断言所有 Feed error∈封闭句表枚举（PLAN_MISSING/FROZEN_INPUT_MISSING 档不拼节点 id 随附）。
6. **作废终态经 worker 通道写 done 或被错误分档**：端点 403+端口吞错（mock 绿生产无事件——工具条永转）；epoch 失守被标终态/fence 未注册不写事件=同样永转。测试：poller 单写（一条 done/零 exec.artifact/行 projected/结算行数不变）+**fence 三条分档**+**事件与 projected 同事务**+worker done 黑名单用例原样在库。7. **迟到旧代 done 盖新代 loading（槽面与收场面两档）**：槽面=nodeVersion 后写恒大——mergeSlot execSeq 规则测试（execSeq=6 loading·nodeVersion=20 不被 execSeq=5 done·nodeVersion=30 盖掉）；收场面=上一代产物落地 mediaId 变被当这一次成功——收场函数 intentId 判据测试（别的 intentId 的 done 不收场/上一代 artifact 变 mediaId 但 execStatus.intentId 非本次不退出）。
5. **迟到响应覆盖终态**：轮询终态后 interval 再起/在途序号迟归写旧态/超时后迟到 COMPLETED 再 spawn。测试：T5 单调序号+终态不建 interval+done 锁收迟到 COMPLETED。

---

### Task 0: 环境事实（执行前读——不产码）

无 Files/Steps。执行者须知：

- bash cwd 会漂移到 apps/api——`node scripts/doc-gate.mjs` 须绝对路径 `node /d/flowweb/scripts/doc-gate.mjs`。
- int 池跑法（apps/api 下）：`DATABASE_URL="postgresql://flowweb:flowweb_dev@localhost:5432/flowweb" pnpm vitest run <file> -c vitest.int.config.ts`（默认池 exclude int/heavy——int 必须显式 -c）。
- web 测试在 apps/web：`pnpm vitest run <file>`；`pnpm verify`（全量档）批末才跑。
- onModuleInit fire-and-forget——等收敛用 pollUntil 形态（E64 gate 同款，见 intent-reconcile.e64-gate.int.spec.ts）。
- pre-commit 钩子跑 gitleaks+verify-chain fast（两笔 commit 各过一次）。

### Task 1: shared 组装器+投影函数+契约类型（第一笔）

**Files:**
- Create: `packages/shared/src/collab/runtime-exec-status.ts`（组装器+投影函数+封闭句常量）
- Test: `packages/shared/src/collab/runtime-exec-status.spec.ts`
- Modify: `packages/shared/src/collab/runtime-event.ts:31-44`（exec.status 分支补 `execSeq?: string`/`error?: string`）
- Modify: `packages/shared/src/collab/runtime-projection.ts:20-33`（RuntimeProjectionExecStatusFact 补 `error?: string`——execSeq 已有）
- Modify: shared 出口面（若存在 re-export 则补）

**Interfaces:**
- Produces: `assembleExecStatusPayload(patch)`——必填键定死（Global Constraints 第五条）；**不写 nodeVersion/kind/v/fileId/jobId/reason**。
- Produces: `execStatusSlotOfPayload(p: Record<string, unknown>): { execStatus: RuntimeProjectionExecStatusFact } | null`——p 缺合法 nodeVersion（非十进制 string）返回 null；键有值才拷。
- Produces: `FeedSentenceId` 闭枚举+`FEED_SENTENCES`（句子表单源——TEXT_UNKNOWN_HELD/TEXT_UNKNOWN_UNMARKED/REAPER_DEADLINE/REAPER_STALE/EDIT_FAILED/EXEC_GENERIC/FUNDS_HELD/扣费五码/超时/PLAN_MISSING/FROZEN_INPUT_MISSING 全部 id→句）+`feedError(errorCode, sentence, row|null): ExecStatusPatch`（rearmable 按码与有无行）+`reserveFailSentence(code)`+受理四档联合类型（discriminated union：replayed:false{intentId,execSeq}/delivered{resultRef}/voided/deduped{taskId,status}）+**mergeSlot execStatus execSeq 代际规则**（两边都有十进制 execSeq 大者胜→相同比 nodeVersion→任一边缺仍只比 nodeVersion——execStatus 槽专用，artifact/deletedAt/restored 槽不动；**比较经 seq() BigInt——测试用 execSeq="10" vs "9"**，"6" 对 "5" 字符串比较发现不了）。

- [ ] **Step 1: 写失败测试**（runtime-exec-status.spec.ts）——七组：①八键全值载荷恰含八键②必填键档：status 空串/非字符串→抛错；attempts 缺→0 始终在；execSeq 数字/非十进制串→键不出现③error **封闭句等值检查**：表内「积分不足」原样通过／表外任意句——`'see https://x'`、`'好'.repeat(300)`、**长前缀+尾部 URL**（`'x'.repeat(210)+' https://evil'`）——全档整段换「生成失败」（不截断）／非字符串与空白→键不存在④feedError：无行档→attempts 0+rearmable false+无 intentId/execSeq 键；有行 TEXT_UNKNOWN_HELD attempts=3→rearmable 仍 true；有行 EXEC_GENERIC attempts=2→true、FUNDS_HELD→false⑤词表五码+未命中码+句子 id 全枚举断言⑥execStatusSlotOfPayload：全值→Fact 八键+nodeVersion；缺 nodeVersion/`nodeVersion:'abc'`→null⑦fileId/jobId/reason/nodeVersion/v/kind 传入也不出现。⑧mergeSlot execSeq 规则：**execSeq="10" loading 不被 execSeq="9" done 盖掉**（BigInt 比较非字符串——"6"对"5"发现不了）+execSeq=6 loading（nodeVersion=20）不被 execSeq=5 done（nodeVersion=30）盖掉；execSeq 相同比 nodeVersion；单边缺 execSeq 仍比 nodeVersion。

- [ ] **Step 2: 跑测试确认红** — `cd /d/flowweb/packages/shared && pnpm vitest run src/collab/runtime-exec-status.spec.ts`，Expected: FAIL（文件不存在）。
- [ ] **Step 3: 实现 runtime-exec-status.ts**——按 Interfaces+Global Constraints 第五条；error 封闭句等值检查（trim 后全文等值表内句否则整段「生成失败」）。
- [ ] **Step 4: 跑测试确认绿**（同 Step 2 命令，PASS）。
- [ ] **Step 5: 契约类型两处扩键**（runtime-event.ts:31-44+runtime-projection.ts Fact）——`execSeq?: string`/`error?: string`。跑 `pnpm -C /d/flowweb/packages/shared test`（taxonomy 键集断言若红随批加两键）。

### Task 2: 两写面改调组装器+服务端 slot 改调投影函数（第一笔）

**Files:**
- Modify: `apps/api/src/modules/collab/collab-document.service.ts:244-262`（writeExecStatus payload 体）、`:319-324`（deliverArtifact exec.status 字面量）
- Modify: `apps/api/src/modules/collab/runtime-feed.service.ts:336-344`（slotOfEvent exec.status 分支）
- Test: 既有 `collab-document.exec-map.spec.ts` 载体+新增断言

**Interfaces:**
- Consumes: Task 1 `assembleExecStatusPayload`/`execStatusSlotOfPayload`。
- Produces: writeExecStatus/deliverArtifact 载荷形状=八键（deliverArtifact 侧 exec patch 同调组装器——execDonePatch 已带 intentId/execSeq，改调后不再丢〔v2.8：④ 段字面量透传被丢的键即组装器改道自然收口〕，execDonePatch 本体零改）。

- [ ] **Step 1: 写失败测试**——三件第一/二件服务端半：①writeExecStatus 传 `error:'积分不足'`→appendEvent 载荷含该句②传 `error:'see https://x'`→载荷 error=`'生成失败'`③deliverArtifact 落的 exec.status 事件含 intentId/execSeq（mock intent 行）。
- [ ] **Step 2: 红确认** — `cd /d/flowweb/apps/api && pnpm vitest run src/modules/collab/collab-document.exec-map.spec.ts`，Expected: 新断言 FAIL。
- [ ] **Step 3: 实现三处改道**——writeExecStatus payload 体改调 `assembleExecStatusPayload`（nodeId 单独拼）；deliverArtifact ④段字面量改同调；runtime-feed slotOfEvent exec.status 分支改调 `execStatusSlotOfPayload(p)`（null→整事件跳过=unknown 计数）。
- [ ] **Step 4: 绿确认**（同 Step 2；再跑 `pnpm -C /d/flowweb/apps/api vitest run src/modules/collab/`——**provider-convergence.e2e-spec.ts :258 现写 `error:'stale worker'`：等值检查后落「生成失败」，断言随批更新**〔该文件属 CI-only e2e 池——本机默认池跑不到，改动随断言更新即入〕）。

### Task 3: feedError 全调用点改道+冻结 catch 内补臂+受理显式结局（第一笔）

**Files:**
- Modify: `apps/api/src/modules/execution/execution.service.ts`——errorPatch :167-172 **删除**改调 shared `feedError(errorCode, sentence, row)`；**loading :416/:865 与 skipped :379/:430/:616（NODE_BUSY——带 claimed intentId 档同样）补 execSeq**（`execSeq:intent.execSeq.toString()`——mergeSlot 代际规则生效前提）；作废臂（主路径 deliverFileId 档+冻结路径 committed 档）**零 done 写**（v2.8 重写——作废终态归 poller，四臂只交 authorVoid）；冻结缺节点 :796 errors[] 同改 FROZEN_INPUT_MISSING+「节点缺少冻结输入」；八调用点全改（主 :179/:358/:486/:582/:603/:625+冻结 :934/:947——TEXT_PROVIDER_UNKNOWN 两处按 marked 分选 TEXT_UNKNOWN_HELD/TEXT_UNKNOWN_UNMARKED id）；PLAN_MISSING :358 改 PLAN_MISSING id（「节点缺少定价快照」不拼 id）；**冻结补臂**：FundsInvariantError 分支**插冻结 catch 内、AuthorSlotReleaseError 重抛（:920）之后、voidForExecutionRequestItem/void_/fail（:939-944）之前**（v3「:919 前」在 catch 外——错认账）——不 void 不 fail 行留 RUNNING+feedError('FUNDS_INVARIANT_VIOLATION','FUNDS_HELD',row)+continue（**合同四：reaper 之后仍按 deadline 收敛这种 RUNNING 行=资金域既有行为，本批不改 reaper 扫描条件；冻结 same-job-alive :811 零 Feed 写维持——旁边那次执行的 Feed 就是状态，不补 skipped**）；intent-stale :894-897 **保持现有 per-item void** 只补 Feed 执行链超时句；冻结 PLAN_MISSING :796 改 FROZEN_INPUT_MISSING id 补 Feed 写
- Modify: `apps/api/src/modules/ai-image-edit/ai-image-edit.processor.ts:143-152/:336-346`（编辑扣费失败+通用失败行读封闭句）+`:309-320`（资金不变量补行读）+`:239-241`（intent-stale 返回前补 feedError('INTENT_DEADLINE_EXCEEDED','EXEC_DEADLINE',row)）+作废臂零 done 写（v2.8——归 poller）
- Modify: `apps/api/src/modules/execution/intent-reconcile.service.ts:526-538`（**常驻门删**：isDocResident 早退+execProjectionDeferredTotal 支删——projectReaped 始终 feedError〔REAPER_DEADLINE/REAPER_STALE+行 intentId/attempts/execSeq〕）
- Modify: `apps/api/src/modules/execution/generation-intent.service.ts:303-308`（**supersedeProjections 谓词排除 `author-void:` 前缀**——rearm/takeover 事务内否则会灭 pending 作废票据；谓词加 `artifactId: { not: { startsWith: 'author-void:' } }`）
- Modify: `apps/api/src/modules/artifact-core/artifact-commit.service.ts:631-639`（作废臂投影行初始态 `superseded`→`pending`——出站票据；commit 返回仍 outcome:'superseded'；幂等短路按键查不动）
- Modify: `apps/api/src/modules/media-delivery/projection-outbox.poller.ts`（**作废终态单写（v3.0 七步）**：processProject ② 段读 NodeArtifact **之前**按 `author-void:` 前缀岔开（键解析 ^author-void:(.+):(\d+)$）、不进 deliverable/flushDocument 批次、不得被兄弟行 flush 失败卷进 fencedBail；**事务前 assertWriteAdmitted**（租约/spool 不可写=作废行 fencedBail 回 pending）；每行单独 appendEventTransaction——①再查 epoch（失守=本行+同批未终态作废行回 pending，已 projected 不进 bail）②同事务读 **CanvasProject FOR SHARE**（`SELECT … WHERE id=$projectId FOR SHARE`——判据行非争用行；行不在或 lifecycleState≠'ACTIVE'=零事件行标 orphaned——不用 flush deletedProjects、不把 fence 未注册/fence-stale/节点已删当项目没了）③`SELECT … FROM "ArtifactProjection" WHERE id=$rowId FOR UPDATE`（**串行锁=投影行非 fence——fence 行锁在未注册档锁 0 行锁不住**；零行防御档结束事务；fence 检查不参与分支）④锁后按 nodeId+**作废键 execSeq**+status=done 查重（命中只跳插入仍标 projected）⑤键读 GenerationIntent（行在：intentId/attempts/execSeq——**execSeq=键末段非行上现值**〔rearm 同行换代不重铸 intentId〕、不带 error零 exec.artifact；行没了：日志+attempts 0+不写 intentId+execSeq 仍用键值照写）⑥行标 projected 同事务 **WHERE id=$rowId 不走 mark() runId CAS**（作废行三种状态转移 projected/orphaned/epoch 回 pending **全在行锁事务内、不调现有 mark()**——runId CAS 失败只打日志：事件先提交行仍 projecting；0 行更新=回滚）⑦提交后 notifyProject；**载荷走 assembleExecStatusPayload 不复用 execDonePatch**〔带 fileId〕——不走 deliverArtifact 不撞 0 代幂等键）
- Modify: `apps/api/src/modules/ai-image-edit/lighting/lighting.consumer.ts:252-258`（资金分支补行读）+`:184-186`（intent-stale 返回前补 EXEC_DEADLINE Feed 写）+作废臂零 done 写（归 poller；去重档本就不写）
- Modify: `apps/api/src/modules/ai-image-edit/ai-image-edit.controller.ts:82-112`（runGuarded 显式结局：新建 return `{...r, replayed:false, intentId:intent.intentId}`；交付重放 `{replayed:true, outcome:'delivered', resultRef:intent.resultRef}`；作废重放 `{replayed:true, outcome:'voided'}`）
- Modify: `apps/api/src/modules/ai-image-edit/lighting/lighting.controller.ts:82-110`（同形状+去重档 `{replayed:true, outcome:'deduped', taskId, status}`）
- Test: execution.service/processor/reconcile/lighting/controller spec 断言更新+封闭句表断言

**Interfaces:**
- Consumes: Task 1 全部常量。
- Consumes: Task 1 `feedError`/`FeedSentenceId`/受理联合类型（皆 shared）。
- Produces: 全部 exec.status error 写入经 feedError（execution 八+processor 三+reaper+lighting 资金）；两控制器受理返回=shared 联合类型形状（T7 客户端消费）。

- [ ] **Step 1: 写失败测试**——①编辑扣费失败（CREDIT_INSUFFICIENT）：Feed payload={errorCode:'CREDIT_INSUFFICIENT', error:'积分不足', intentId:行值, execSeq:row.execSeq.toString(), rearmable:attempts<3}+void_ 原因仍原因码②冻结 generic catch（err=new Error('boom http')）：Feed error='生成失败'/attempts=行值（非 0）/rearmable=attempts<3（非 false）/intentId=行值③冻结 FundsInvariantError：**不调 voidForExecutionRequestItem/void_/fail**+Feed=暂缓交付句+rearmable:false④冻结 intent-stale：per-item void 照旧调用+补 Feed 执行链超时句⑤冻结缺节点：Feed={errorCode:'FROZEN_INPUT_MISSING', error:'节点缺少冻结输入'}（此前零 Feed 写）⑥主路径 PLAN_MISSING：Feed error='节点缺少定价快照'（无节点 id 子串）+无行档 rearmable:false+无 intentId 键⑦TEXT_PROVIDER_UNKNOWN 两档：marked 选 TEXT_UNKNOWN_HELD/unmarked 选 TEXT_UNKNOWN_UNMARKED（无 err.message 前缀）+attempts=行值+rearmable 恒 true（attempts=3 档也 true）⑧reaper projectReaped 两句 id（REAPER_DEADLINE/REAPER_STALE——事件码仍现两码）+行 intentId/execSeq⑨runGuarded 三档+lighting 四档返回形状断言（新建档 {replayed:false,intentId,execSeq}——execSeq=intent.execSeq.toString()/作废档无 resultRef 键/去重档 outcome='deduped'）⑩reaper 无连接（isDocResident=false）也写入（exec-partial int 用例翻新——payload 含行 intentId/execSeq+deferred 计数支删除）⑪processor/lighting intent-stale：返回 completed 前有一条 Feed 写（EXEC_DEADLINE 句+行身份）⑫作废终态 poller 单写（v3.0 七步断言）：行初始态 pending+一轮后恰一条 exec.status done（intentId=行 intentId 列/**execSeq=作废键末段**〔行已被 rearm 换代时 done 载荷 execSeq 仍=键值非新代〕、attempts=行值、error 键不在）+零 exec.artifact 事件+行变 projected+settle 结算行数不变；重跑 poller（幂等）仍只有一条事件且**行仍标 projected**（只跳插入不漏标）；**CanvasProject 灭失/lifecycleState≠ACTIVE=零事件行标 orphaned**；**fence 未注册/fence-stale/节点已删档照写 done**（fence 不参与分支）；**assertWriteAdmitted 拒=回 pending 零事件**；**查重在投影行锁后**（并发两 poller 同作废行恰一条事件——TOCTOU 负控）；**projected 更新 WHERE id 非 runId CAS**（租约重叠负控：不出现「有事件行仍 projecting」）；**rearm 换代负控**：作废票 pending 期间同节点 rearm→票不被 supersedeProjections 灭+poller 写出的 done execSeq=旧代键值（mergeSlot 挡它盖新代 loading）；**载荷无 fileId 键**（不复用 execDonePatch）；lighting 去重档零 Feed 写。⑬worker done 黑名单原样：writeExecStatus status=done ⇒ 403（既有集成用例不删不改）。⑭mergeSlot 代际：execSeq=6 loading（nodeVersion=20）不被 execSeq=5 done（nodeVersion=30）盖掉（shared spec）。⑮loading/skipped 补 execSeq：:416/:865/:379/:430/:616 载荷含 execSeq（行 execSeq.toString()——:616 NODE_BUSY 带 claimed 档同样）。⑰**regen-token 三步**：rotateToken 同 execSeq 只轮换一次/槽上更小 execSeq 忽略/markGestureConsumed 只在真发受理那次（渲染读不算）/回滚三条件全中才恢复轮换前值（缺一不恢复）/无行终态（error∧rearmable===false 无 execSeq）照常轮换。⑱**收场函数顺序**：三闸先于分支——同 intentId 异 execSeq 的 done 不清 processing 不退出（ⓒ闸在ⓔⓕ前命中即返回）。⑯supersedeProjections 排除前缀：rearm/takeover 后 author-void pending 行仍在（不被置 superseded）。
- [ ] **Step 2: 红确认** — `pnpm -C /d/flowweb/apps/api vitest run src/modules/execution/ src/modules/ai-image-edit/`，Expected: 新断言 FAIL。
- [ ] **Step 3: 实现**——八调用点+processor 三处+reaper+lighting 改调 shared feedError（各调用点 err.message 改 logger.warn/log 保留原文；票 intentRowId≠事件 intentId）；冻结 catch 内 FundsInvariant 分支插 :920 后 :939 前；reaper 门删+两处 intent-stale 补写+loading/skipped 补 execSeq+作废臂零 done 写（行初始态 pending+poller 前缀分流单写+supersedeProjections 排除前缀）+errors[] 码改；两控制器返回 shared 联合类型形状。
- [ ] **Step 4: 绿确认**（同 Step 2 命令+`pnpm -C /d/flowweb/apps/api test` 默认池全量+**int 池三件**：`DATABASE_URL="postgresql://flowweb:flowweb_dev@localhost:5432/flowweb" pnpm vitest run src/modules/execution/exec-partial-success.int.spec.ts -c vitest.int.config.ts`〔无连接写入翻新用例〕+`src/modules/artifact-core/artifact-commit.int.spec.ts`〔作废行创建态 pending 断言翻新——int 池跑法同〕+`src/modules/media-delivery/projection-outbox.poller.int.spec.ts`〔作废终态单写用例〕）。
- [ ] **Step 5: api 侧类型门禁** — `pnpm -C /d/flowweb/apps/api exec tsc --noEmit`（0 错）+`pnpm -C /d/flowweb/apps/api lint`（0 error；存量 warning 不动）。

### Task 4: 第一笔 commit（含客户端投影链三处+regen-token 轮换代际）

**Files:**
- Modify: `apps/web/src/stores/runtimeStore.ts:174-186`（slotOfEventWire 改调 shared 投影函数——删 :176 伪造兜底）、`:32-56`（projectRuntimeExecToNodeStore 拷 error+**删 :42-43 intentId 回落 execSeq 行**）、`:208`（selectRuntimeEntry 返回类型补 error/nodeVersion）
- Modify: `apps/web/src/utils/regen-token.ts`（**v3.1 合同二**：rotateToken 加第三参 execSeq——同 execSeq 只轮换一次（sessionStorage 记已轮换 execSeq）+槽上更小则忽略；新增 markGestureConsumed(pid,nid)——真发受理请求那次调用，渲染读不算消费；回滚三条件 API（非终态∧execSeq 更大∧未消费→恢复轮换前值））
- Modify: 六面板+PreviewPlayer 轮换调用点（ImageConfigPanel:63-66 同族——有 execSeq 的 done/不可 rearm error 传 entry.execStatus.execSeq；无 execSeq 无行终态维持现状；ImageGenNode handleGenerate 真发请求处调 markGestureConsumed）
- Test: regen-token spec（新建）+面板轮换代际断言
- Test: `runtimeStore.exec-status.spec.ts`（新建）+ImageGenNode.test.tsx 投影链断言

**Interfaces:**
- Consumes: Task 1 `execStatusSlotOfPayload`。
- Produces: 客户端投影槽含 error 且 intentId 无回落——T7 工具条读 `entry.execStatus?.error`/`.intentId`。

- [ ] **Step 1: 写失败测试**——第一件客户端半+轮换三步（同 execSeq 只一次/更小忽略/未消费回滚三条件/markGestureConsumed 消费语义/无行终态照常）：`applyEventsToProjection` 喂含 error:'积分不足' 的 exec.status 事件→projectRuntimeExecToNodeStore 后 entry.error==='积分不足' 且 entry.intentId===载荷 intentId（execSeq-only 载荷→entry.intentId===undefined——垫片行已删）；缺 nodeVersion 事件→unknown 计数+1、投影无新槽。
- [ ] **Step 2: 红确认** — `cd /d/flowweb/apps/web && pnpm vitest run src/stores/runtimeStore.exec-status.spec.ts`。
- [ ] **Step 3: 实现三处**——slotOfEventWire exec.status 分支改调 `execStatusSlotOfPayload(p)`；projectRuntimeExecToNodeStore 补 error 拷贝+删回落行；selectRuntimeEntry 类型补。
- [ ] **Step 4: 绿确认**（Step 2 命令+`pnpm -C /d/flowweb/apps/web vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx`）。
- [ ] **Step 5: 第一笔提交**——`pnpm -C /d/flowweb/apps/api test`+`pnpm -C /d/flowweb/apps/web test`+exec-partial/artifact-commit/projection-outbox.poller 三 int（全绿）→`git add`第一笔全部文件→（发布序若分步：**必须 api 先上、worker 后上（或同批一次上）**——worker 先上则旧 poller 收到 pending 作废行查 NodeArtifact 不到即 orphaned 不再领=票据永久报废〔比「error 字段被丢」硬一档〕；发布窗单边缺 execSeq 退回 nodeVersion+NodeBusy 防双扣=窗口形态非改规则；开发库跑过旧顺序先清废票〔`DELETE FROM "ArtifactProjection" WHERE "artifactId" LIKE 'author-void:%' AND state IN ('orphaned','superseded')`——旧 superseded 行新 poller 也不领；不写迁移不进代码〕）→`git commit -m "feat(y3): exec.status 组装器+封闭句表+失败写入收口"`（body 凭证：CREDIT_INSUFFICIENT/「积分不足」/intentId=行上列/表外句等值换「生成失败」/冻结 catch 内资金臂/无行档 rearmable false/TEXT_UNKNOWN 恒 true/显式结局四档/作废终态 poller 单写+行 pending/mergeSlot execSeq 代际规则）。

### Task 5: 三族轮询单通道+useStitchTask 重定（第二笔）

**Files:**
- Modify: `apps/web/src/hooks/useAsyncMediaTask.ts`（去 socket/socketEvent 参数+双档间隔删；taskId 到位立即首请求+未终态 setInterval 3_000 单值；单调序号：cleanup 与 taskId 变化各 +1、回调序号不一致不 setState）
- Modify: `apps/web/src/hooks/useTrimTaskStatus.ts`/`useVideoSeparateTask.ts`（签名收窄）
- Modify: `apps/web/src/hooks/useStitchTask.ts:70-92`（删 socket.once；先请求一次+5s；65s 超时起算不变；**done 锁**——超时结算后迟到 COMPLETED 走同一把 done 锁不得再 spawnResultNode）
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx:88-98`（taskSocket/ensureExecutionSocket 引用删）
- Test: `useStitchTask.test.ts`/`useTrimTaskStatus.test.ts` 翻新+新断言

**Interfaces:**
- Produces: useTrimTaskStatus/useVideoSeparateTask 签名 `(taskId: string | null, nodeId: string)`；useAsyncMediaTask options 去 socket/socketEvent。

- [ ] **Step 1: 写失败测试**——useAsyncMediaTask：taskId 出现→立即一次 pollFn+未终态建 3s interval+**后续一拍返回终态时清掉已建好的 interval**+cleanup/taskId 变化后序号失配的迟归 resolve 不 setState（失配那一拍不 setState）。useStitchTask：超时结算后迟到 COMPLETED→不 spawnResultNode（done 锁）；先请求一次；65s 起算。
- [ ] **Step 2: 红确认** — `pnpm -C /d/flowweb/apps/web vitest run src/hooks/`，Expected: FAIL（旧签名用例随批翻新）。
- [ ] **Step 3: 实现四文件**——轮询骨架按 spec §3 T1（终态判定/addChildNode/addChildNodes/addEdge/toast 消费语义零改）。
- [ ] **Step 4: 绿确认**（`pnpm -C /d/flowweb/apps/web vitest run src/hooks/ src/pages/canvas/components/nodes/VideoGenNode.test.tsx`）。

### Task 6: 余额信号恰一次+静默重拉（第二笔）

**裁决与验收全按 spec §3 D1（v2.3 收紧+ref 化面）执行**——`fetchRuntimeSnapshot` 用途参数必填 'init'|'resync'（调用点恰五：init 一+回落四）；`syncRuntimeFeed` 终态标记跨轮累加、一次函数调用只派发一次（追上/轮尽且有 done|error exec.status 或 exec.artifact→结束时一次；中途转快照=该次 resync 派发+清标记+被弃批不另算）；creditsStore silent 档+共用递增序号（静默失败不改 loading/error/数字）+**applyBalance 删除**；CanvasTopBar 空 detail 收号+默认团队比较结果 ref 化（teamId 变化随现有 effect 重算）+统一刷新函数。

**Files:** `apps/web/src/stores/runtimeStore.ts:324-411`、`apps/web/src/stores/creditsStore.ts`、`apps/web/src/pages/canvas/components/CanvasTopBar.tsx:59-68`；Test: runtimeStore/creditsStore spec+CanvasTopBar 用例。
**Steps（TDD）：** Step 1 写失败测试七断言（init 零派发/四回落各一次/增量整批一次〔多轮合成〕/缺口转快照被弃批不另算/loading·skipped 不触发/silent 失败三不改/旧响应迟归不覆盖）→Step 2 红（`pnpm -C /d/flowweb/apps/web vitest run src/stores/`）→Step 3 按上述裁决实现→Step 4 绿（同 Step 2+CanvasTopBar 相关 spec）。

### Task 7: ImageGenNode 受理结局+投影读+删订阅（第二笔）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx:780-838`（handleGenerate：await 前写基线 ref {nodeVersion, mediaId, intentId:null, execSeq:null}——nodeVersion=槽上合法十进制/无则 cursor.feedSeq/再无 null **禁 '0'**；**mediaId=当前 Runtime 投影 artifact 槽（非 Yjs 节点 mediaId）**；响应分支=**接住 withSyncRetry 返回值**（泛型直通 executionApi:38-39）**只认 outcome**：`outcome==='delivered'`→直接退出编辑+processing false+清基线〔产物点击前已在槽上、不走「变了才退出」〕/`outcome==='voided'`→**保持编辑态、processing 置 false**/`replayed:false`→intentId+execSeq 入 ref+**立刻调收场函数**〔Feed 可能先到〕；deduped 形态不进本工具条）、`:1071-1098`（subscribeNodeEditResult 段删→useRuntimeFeedStore 订阅）、`:382-388`（node:status 订阅删）；**收场收成一个函数（v3.1 三闸三分支、命中即返回）**——订阅与响应后立刻读都走它：ⓐref 空或 intentId null→不动ⓑintentId≠ref.intentId→不动ⓒ**execSeq≠ref.execSeq（缺也算）→不动**——三闸先于一切分支（同 intentId 异 execSeq 的旧代 done 不清 processing 不退出）ⓓerror∧nodeVersion 合法十进制∧严格大于基线→投影句+processing falseⓔdone∧mediaId 变非空→退出+清基线ⓕdone∧未变或空→processing false 留编辑态（上一代的图照常换上）
- Modify: `AudioGenNode.tsx:62-68`、`VideoGenNode.tsx:368-374`（零副作用订阅删）
- Test: `ImageGenNode.test.tsx` G2/G3 族翻新

**Interfaces:**
- Consumes: Task 3 受理响应四档（shared 联合类型）+作废臂 done 事件；Task 4 `entry.execStatus?.error`/`.intentId`/`.nodeVersion`。
- Produces: 基线 ref `editBaselineRef.current: { nodeVersion: string | null; mediaId: string | undefined; intentId: string | null; execSeq: string | null } | null`+**收场函数 `settleEditOutcome(entry): void`（三闸三分支命中即返回——GC 段全录）**：订阅 effect 与响应到达后立刻读共用。

- [ ] **Step 1: 写失败测试**——①delivered→退出编辑+processing false+清基线②voided→processing false+保持编辑态（今天无 fileId 档两分支都不进=永转圈——重放不写新事件，不能拿版本大于基线等已存在的 done）③新建成功（replayed:false+intentId+execSeq）→intentId/execSeq 入 ref+立刻调收场函数（Feed 先到场景——响应前投影已含该 intentId 的 error 也要弹）④收场函数五条全测：ref null 或 intentId null→不动/error∧intentId 同∧版本大于基线→投影句+processing false/entry.intentId≠ref.intentId→不动（含 done 档——别的 intentId 的 done 不收场）/版本≤基线→不动⑤done∧mediaId 相对基线变且非空→退出编辑+清基线⑥**done∧mediaId（投影 artifact 槽）未变/空→processing false+留编辑态不弹错**（作废终态=poller 单写那条 done 的收场）⑧**槽上已是别的 intentId 的 done：响应 replayed:false 后立刻读投影——编辑态与 processing 都不变**（收场函数第⑤条）⑨**上一代 artifact 使 mediaId 相对基线变化、但当前 execStatus.intentId 不是这一次→不退出编辑**（上一代的图照常显示、工具条继续等这一次）⑩**同 intentId 换代档：execStatus.execSeq≠ref.execSeq（旧代 done 先落槽）→processing 不被清、编辑态不动**（ⓒ闸在 ⓔⓕ 分支前命中即返回——顺序断言：done∧mediaId 变∧execSeq 不匹配也不退出）⑦退出编辑/卸载→ref 清。
- [ ] **Step 2: 红确认** — `pnpm -C /d/flowweb/apps/web vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx`。
- [ ] **Step 3: 实现**——useRuntimeFeedStore selector 订阅+三条件匹配（BigInt 比较 try/catch 非十进制按不大于处理）；三组件订阅段删。
- [ ] **Step 4: 绿确认**（Step 2 命令+Audio/VideoGenNode 相关 spec「无订阅」锚×3）。

### Task 8: 服务端删除面+第二笔 commit（第二笔）

**裁决与验收全按 spec §3 S1+S2 执行**——含 **`pages/canvas/page.tsx:296-297` 的 ensureExecutionSocket/teardownExecutionSocket 画布级连接删（spec §2 page.tsx 锚——文件表必含）**。

**Files:** Delete `apps/api/src/modules/gateway/emit.port.ts`+`emit.port.spec.ts`+`execution.gateway.ts`+`execution.gateway.spec.ts`+`apps/web/src/services/executionSocket.ts`+**`executionSocket.test.ts`**（随文件删）；Modify `execution-core.module.ts:81-96`（EmitPort useFactory+gateway 装配+exports 删）、`worker.module.ts:274`（provider 删+spec :116/:143 断言翻新）、33 emit 调用文件（execution.service 15〔含 :542-546 credits 搭车+balancePayload :99-101 随删〕/ai-image-edit.controller 2/processor 4/lighting.controller 2/lighting.consumer 3/video-trim 2/video-separate 3/stitch 1/materialize-job :561）、`pages/canvas/page.tsx:296-297`；各 spec emit 断言删/翻。

**Steps（TDD）：** Step 1 grep 门禁先红（13 符号零命中断言——客户端 5+服务端 8，排除测试树）→Step 2 删客户端面（executionSocket.ts/page.tsx 两行/三组件三 hook 残余 import）→Step 3 删服务端面（调用行+@Inject+import/两 gateway 文件+两 spec/两装配段/Counter 随端口文件删不进围栏/幂等回放臂 :402/:408/:842/:845 emit 断言删）→Step 4 全量门禁（双端 grep 转绿+api tsc/lint+api test 3366 基线+web test 4121 基线+E64 门 int 复跑 2/2+socket.io-client=WeChatQRModal 恰一处）→Step 5 第二笔提交 `refactor(y3): 删 /execution 命名空间——通知退场 Feed/轮询/REST 单通道`（body 录双端 grep 零命中+两池基线+E64 复跑）。

### Task 9: 批末收口（主会话）

- `pnpm verify`（全量 36 步）+E56 复核锚（connection-supervisor routeClose 单源——只读确认零改动）+census/行数锚类门禁按批同步（execution.gateway/collab-doc-registry 行数锚若有）→ledger/记忆收口→push=用户确认门（本地累计：a746ca21/96fe4887/c268b890/784e28a3/017f66c8/4edd2cfd+本批两笔）。
