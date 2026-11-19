<!-- doc-status: active | created: 2026-11-19 | plan v4（依 spec v2.6 落盘——plan 外审三轮四定案采纳：①feedError 进 shared 带句子 id〔FeedSentenceId 闭枚举——同码异句 TEXT_PROVIDER_UNKNOWN 两句/INTENT_DEADLINE_EXCEEDED 执行链 vs reaper 无法从码推句；调用点=execution 八+processor 三+reaper+lighting 资金；票 intentRowId=行 cuid 非事件 intentId；冻结缺节点=FROZEN_INPUT_MISSING「节点缺少冻结输入」新档非 PLAN_MISSING 句〕②组装器 error 只放行封闭句不截断〔全文等值表内句否则整段「生成失败」——截断档作废，等值检查盖 worker HTTP 透传写点〕③rearmable 按码与有无行〔无行档 attempts 0+rearmable false 不写身份键；有行 TEXT_PROVIDER_UNKNOWN 恒 true——UNKNOWN 靠同 token rearm voidInTx 释放；其余 FUNDS/EXHAUSTED false、attempts<3〕④冻结资金分支插 catch 内 AuthorSlotReleaseError 重抛后 void 块前〔v3「:919 前」在 catch 外错认账〕+intent-stale 保 per-item void 只补 Feed 写+受理四档联合类型进 shared+handleGenerate 接住 withSyncRetry 泛型返回只认 outcome；v3=二轮〔显式结局四档/feedError 出口+冻结三臂〕；v2=一轮〔封闭句表/受理响应/基线禁0/必填键〕；v1=初稿；两笔 commit 边界不动） -->
# Y3 协议退场 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删 `/execution` socket.io 命名空间与五族 socket 通知——执行进度走 RuntimeFeed、三族任务改 REST 轮询单通道、余额改 REST 事件驱动刷新；先补 Feed 字段与扣费失败写入（第一笔），再双端同删（第二笔）。

**Architecture:** 服务端 exec.status 载荷收口到 shared 一个允许清单组装器（八键+必填键定死+error 封闭句等值检查兜底）；**Feed error 唯一出口=feedError(errorCode, sentence, row|null)**（进 shared——FeedSentenceId 闭枚举，句子与原因码分开：同码异句由调用点显式选 id）+组装器 error 只放行封闭句（全文等值否则整段「生成失败」——不截断）；编辑成功信号=受理响应显式结局四档（replayed:false/intentId、delivered、voided、deduped——联合类型进 shared）+投影（客户端只认 outcome——接住 withSyncRetry 泛型返回）；客户端 edit 失败匹配=intentId 身份+版本严格大于基线；三族任务轮询钉发起者组件（3s/5s 单值+单调序号作废在途）；最后整体删除 EmitPort 端口族+ExecutionGateway+executionSocket 单例。

**Tech Stack:** NestJS (api/worker 双进程)、BullMQ、Prisma+PG、RuntimeFeed（RuntimeEvent 表+feed-hint stateless）、zustand (web)、vitest（三池：默认/heavy/int——int 须显式 `-c vitest.int.config.ts`）。

**Spec:** `docs/superpowers/specs/2026-11-19-y3-protocol-retirement-design.md`（v2.6——本 plan 的一切裁决以 spec 为准，执行者读两份）。

## Global Constraints

- TypeScript strict；禁垫片/禁兼容层/禁「socket 优先 REST 兜底」双通道（spec 反目标）。
- EVENT_KINDS 五值闭表零动；exec.status 补 `execSeq?`/`error?` 为该 kind 可选字段，非新 kind。
- **Feed error 只用封闭句表（err.message 禁入 Feed——异常原文只进日志；发起者 HTTP 的 errors[].error 仍可带原文=请求响应非团队投影，「err.message 只进日志」不扩到响应体）**：扣费失败五码→现有词表（未命中「扣费失败，请重试」）；编辑通用失败→「AI 处理失败」(EDIT_FAILED)；节点执行通用失败→「生成失败」(实际码缺省 EXECUTION_FAILED)；超时回收→「生成已被系统回收（超时）——产物未投递」(INTENT_DEADLINE_EXCEEDED)；资金不变量→「生成结果暂缓交付（资金核销异常，待对账处理）」(FUNDS_INVARIANT_VIOLATION)；PLAN_MISSING→「节点缺少定价快照」（不拼节点 id——仅主路径 planMap 缺失；冻结缺节点=FROZEN_INPUT_MISSING→「节点缺少冻结输入」）；TEXT_PROVIDER_UNKNOWN 已 markUnknown→「可能重复生成、不会重复扣费（请稍后查询或重试）」（id TEXT_UNKNOWN_HELD）/mark 失败→「外呼结果不明，扣费状态待对账（请稍后查询或重试）」（id TEXT_UNKNOWN_UNMARKED）；reaper 两句维持现句（id REAPER_DEADLINE/REAPER_STALE——事件码仍现两码）。组装器封闭句等值检查留最后一道（不代替封闭句——表外句整段换「生成失败」不截断）。
- **feedError(errorCode, sentence, row | null) 是 Feed error 唯一出口**（放 packages/shared/src/collab/runtime-exec-status.ts；errorPatch 删除）：sentence=FeedSentenceId 闭枚举；有意图行写 intentId/attempts/`execSeq=row.execSeq.toString()`；**rearmable 按码与有无行**：无行档（主 PLAN_MISSING/冻结 FROZEN_INPUT_MISSING/claim 前失败）attempts 0+rearmable false+**不写 intentId/execSeq**；有行 TEXT_PROVIDER_UNKNOWN **恒 true**（UNKNOWN 冻结靠同 token rearm voidInTx 释放——写成 attempts<3 会让面板提前轮换铸新付费手势）；其余有行 FUNDS_INVARIANT_VIOLATION 与 INTENT_EXHAUSTED 为 false、其他 attempts<3。票上的 intentRowId=行 cuid 非事件 intentId。冻结输入缺节点（:796）=FROZEN_INPUT_MISSING「节点缺少冻结输入」（不拼 id）——PLAN_MISSING 句只给主路径 planMap 缺失。
- 组装器八键恰：`status、attempts、execSeq、errorCode、artifactRev、intentId、rearmable、error`；必填键定死：status 非空字符串否则抛错；attempts 有限数字缺则 0 **始终写入**；execSeq 仅 `/^\d+$/` 字符串才写入；errorCode/intentId 非空字符串才写入；artifactRev 有限数字才写入；rearmable 布尔才写入；error **封闭句等值检查**（先 trim、全文必须等于封闭句表某句否则整段换「生成失败」——不截断不保留残段；表内句原样通过）。fileId/jobId/reason/nodeVersion/v/kind 一律不写；nodeVersion 只由 appendEventInTx 盖（runtime-feed.service.ts:134-136）。
- **受理响应显式结局四档**（联合类型放 shared——api 与 web 都引）：新建入队 `{replayed:false, intentId}`+现有入队字段；交付重放 `{replayed:true, outcome:'delivered', resultRef}`；作废重放 `{replayed:true, outcome:'voided'}`；打光去重 `{replayed:true, outcome:'deduped', taskId, status}`。客户端只认 outcome：delivered→退出+清基线/voided→保持/deduped→本批无画布消费者（LightingModal TODO 桩未接线——不进编辑工具条等待）。
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
- Produces: `FeedSentenceId` 闭枚举+`FEED_SENTENCES`（句子表单源——TEXT_UNKNOWN_HELD/TEXT_UNKNOWN_UNMARKED/REAPER_DEADLINE/REAPER_STALE/EDIT_FAILED/EXEC_GENERIC/FUNDS_HELD/扣费五码/超时/PLAN_MISSING/FROZEN_INPUT_MISSING 全部 id→句）+`feedError(errorCode, sentence, row|null): ExecStatusPatch`（rearmable 按码与有无行）+`reserveFailSentence(code)`+受理四档联合类型（discriminated union：replayed:false{intentId}/delivered{resultRef}/voided/deduped{taskId,status}）。

- [ ] **Step 1: 写失败测试**（runtime-exec-status.spec.ts）——七组：①八键全值载荷恰含八键②必填键档：status 空串/非字符串→抛错；attempts 缺→0 始终在；execSeq 数字/非十进制串→键不出现③error **封闭句等值检查**：表内「积分不足」原样通过／表外任意句——`'see https://x'`、`'好'.repeat(300)`、**长前缀+尾部 URL**（`'x'.repeat(210)+' https://evil'`）——全档整段换「生成失败」（不截断）／非字符串与空白→键不存在④feedError：无行档→attempts 0+rearmable false+无 intentId/execSeq 键；有行 TEXT_UNKNOWN_HELD attempts=3→rearmable 仍 true；有行 EXEC_GENERIC attempts=2→true、FUNDS_HELD→false⑤词表五码+未命中码+句子 id 全枚举断言⑥execStatusSlotOfPayload：全值→Fact 八键+nodeVersion；缺 nodeVersion/`nodeVersion:'abc'`→null⑦fileId/jobId/reason/nodeVersion/v/kind 传入也不出现。

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
- Produces: writeExecStatus/deliverArtifact 载荷形状=八键（deliverArtifact 侧 exec patch 同调组装器——execDonePatch 已带 intentId/execSeq，改调后不再丢，execDonePatch 本体零改）。

- [ ] **Step 1: 写失败测试**——三件第一/二件服务端半：①writeExecStatus 传 `error:'积分不足'`→appendEvent 载荷含该句②传 `error:'see https://x'`→载荷 error=`'生成失败'`③deliverArtifact 落的 exec.status 事件含 intentId/execSeq（mock intent 行）。
- [ ] **Step 2: 红确认** — `cd /d/flowweb/apps/api && pnpm vitest run src/modules/collab/collab-document.exec-map.spec.ts`，Expected: 新断言 FAIL。
- [ ] **Step 3: 实现三处改道**——writeExecStatus payload 体改调 `assembleExecStatusPayload`（nodeId 单独拼）；deliverArtifact ④段字面量改同调；runtime-feed slotOfEvent exec.status 分支改调 `execStatusSlotOfPayload(p)`（null→整事件跳过=unknown 计数）。
- [ ] **Step 4: 绿确认**（同 Step 2；再跑 `pnpm -C /d/flowweb/apps/api vitest run src/modules/collab/`）。

### Task 3: feedError 全调用点改道+冻结 catch 内补臂+受理显式结局（第一笔）

**Files:**
- Modify: `apps/api/src/modules/execution/execution.service.ts`——errorPatch :167-172 **删除**改调 shared `feedError(errorCode, sentence, row)`；八调用点全改（主 :179/:358/:486/:582/:603/:625+冻结 :934/:947——TEXT_PROVIDER_UNKNOWN 两处按 marked 分选 TEXT_UNKNOWN_HELD/TEXT_UNKNOWN_UNMARKED id）；PLAN_MISSING :358 改 PLAN_MISSING id（「节点缺少定价快照」不拼 id）；**冻结补臂**：FundsInvariantError 分支**插冻结 catch 内、AuthorSlotReleaseError 重抛（:920）之后、voidForExecutionRequestItem/void_/fail（:939-944）之前**（v3「:919 前」在 catch 外——错认账）——不 void 不 fail 行留 RUNNING+feedError('FUNDS_INVARIANT_VIOLATION','FUNDS_HELD',row)+continue；intent-stale :894-897 **保持现有 per-item void** 只补 Feed 执行链超时句；冻结 PLAN_MISSING :796 改 FROZEN_INPUT_MISSING id 补 Feed 写
- Modify: `apps/api/src/modules/ai-image-edit/ai-image-edit.processor.ts:143-152/:336-346`（编辑扣费失败+通用失败行读封闭句）+`:309-320`（资金不变量补行读）
- Modify: `apps/api/src/modules/execution/intent-reconcile.service.ts:529-536`（reaper projectReaped 补行 intentId/execSeq——现句维持）
- Modify: `apps/api/src/modules/ai-image-edit/lighting/lighting.consumer.ts:252-258`（资金分支补行读）
- Modify: `apps/api/src/modules/ai-image-edit/ai-image-edit.controller.ts:82-112`（runGuarded 显式结局：新建 return `{...r, replayed:false, intentId:intent.intentId}`；交付重放 `{replayed:true, outcome:'delivered', resultRef:intent.resultRef}`；作废重放 `{replayed:true, outcome:'voided'}`）
- Modify: `apps/api/src/modules/ai-image-edit/lighting/lighting.controller.ts:82-110`（同形状+去重档 `{replayed:true, outcome:'deduped', taskId, status}`）
- Test: execution.service/processor/reconcile/lighting/controller spec 断言更新+封闭句表断言

**Interfaces:**
- Consumes: Task 1 全部常量。
- Consumes: Task 1 `feedError`/`FeedSentenceId`/受理联合类型（皆 shared）。
- Produces: 全部 exec.status error 写入经 feedError（execution 八+processor 三+reaper+lighting 资金）；两控制器受理返回=shared 联合类型形状（T7 客户端消费）。

- [ ] **Step 1: 写失败测试**——①编辑扣费失败（CREDIT_INSUFFICIENT）：Feed payload={errorCode:'CREDIT_INSUFFICIENT', error:'积分不足', intentId:行值, execSeq:row.execSeq.toString(), rearmable:attempts<3}+void_ 原因仍原因码②冻结 generic catch（err=new Error('boom http')）：Feed error='生成失败'/attempts=行值（非 0）/rearmable=attempts<3（非 false）/intentId=行值③冻结 FundsInvariantError：**不调 voidForExecutionRequestItem/void_/fail**+Feed=暂缓交付句+rearmable:false④冻结 intent-stale：per-item void 照旧调用+补 Feed 执行链超时句⑤冻结缺节点：Feed={errorCode:'FROZEN_INPUT_MISSING', error:'节点缺少冻结输入'}（此前零 Feed 写）⑥主路径 PLAN_MISSING：Feed error='节点缺少定价快照'（无节点 id 子串）+无行档 rearmable:false+无 intentId 键⑦TEXT_PROVIDER_UNKNOWN 两档：marked 选 TEXT_UNKNOWN_HELD/unmarked 选 TEXT_UNKNOWN_UNMARKED（无 err.message 前缀）+attempts=行值+rearmable 恒 true（attempts=3 档也 true）⑧reaper projectReaped 两句 id（REAPER_DEADLINE/REAPER_STALE——事件码仍现两码）+行 intentId/execSeq⑨runGuarded 三档+lighting 四档返回形状断言（作废档无 resultRef 键/去重档 outcome='deduped'）。
- [ ] **Step 2: 红确认** — `pnpm -C /d/flowweb/apps/api vitest run src/modules/execution/ src/modules/ai-image-edit/`，Expected: 新断言 FAIL。
- [ ] **Step 3: 实现**——八调用点+processor 三处+reaper+lighting 改调 shared feedError（各调用点 err.message 改 logger.warn/log 保留原文；票 intentRowId≠事件 intentId）；冻结 catch 内 FundsInvariant 分支插 :920 后 :939 前；两控制器返回 shared 联合类型形状。
- [ ] **Step 4: 绿确认**（同 Step 2 命令+`pnpm -C /d/flowweb/apps/api test` 默认池全量）。
- [ ] **Step 5: api 侧类型门禁** — `pnpm -C /d/flowweb/apps/api exec tsc --noEmit`（0 错）+`pnpm -C /d/flowweb/apps/api lint`（0 error；存量 warning 不动）。

### Task 4: 第一笔 commit（含客户端投影链三处）

**Files:**
- Modify: `apps/web/src/stores/runtimeStore.ts:174-186`（slotOfEventWire 改调 shared 投影函数——删 :176 伪造兜底）、`:32-56`（projectRuntimeExecToNodeStore 拷 error+**删 :42-43 intentId 回落 execSeq 行**）、`:208`（selectRuntimeEntry 返回类型补 error/nodeVersion）
- Test: `runtimeStore.exec-status.spec.ts`（新建）+ImageGenNode.test.tsx 投影链断言

**Interfaces:**
- Consumes: Task 1 `execStatusSlotOfPayload`。
- Produces: 客户端投影槽含 error 且 intentId 无回落——T7 工具条读 `entry.execStatus?.error`/`.intentId`。

- [ ] **Step 1: 写失败测试**——第一件客户端半：`applyEventsToProjection` 喂含 error:'积分不足' 的 exec.status 事件→projectRuntimeExecToNodeStore 后 entry.error==='积分不足' 且 entry.intentId===载荷 intentId（execSeq-only 载荷→entry.intentId===undefined——垫片行已删）；缺 nodeVersion 事件→unknown 计数+1、投影无新槽。
- [ ] **Step 2: 红确认** — `cd /d/flowweb/apps/web && pnpm vitest run src/stores/runtimeStore.exec-status.spec.ts`。
- [ ] **Step 3: 实现三处**——slotOfEventWire exec.status 分支改调 `execStatusSlotOfPayload(p)`；projectRuntimeExecToNodeStore 补 error 拷贝+删回落行；selectRuntimeEntry 类型补。
- [ ] **Step 4: 绿确认**（Step 2 命令+`pnpm -C /d/flowweb/apps/web vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx`）。
- [ ] **Step 5: 第一笔提交**——`pnpm -C /d/flowweb/apps/api test`+`pnpm -C /d/flowweb/apps/web test`（全量绿）→`git add`第一笔全部文件→`git commit -m "feat(y3): exec.status 组装器+封闭句表+失败写入收口"`（body 凭证：CREDIT_INSUFFICIENT/「积分不足」/intentId=行上列/表外句等值换「生成失败」/冻结 catch 内资金臂/无行档 rearmable false/TEXT_UNKNOWN 恒 true/显式结局四档）。

### Task 5: 三族轮询单通道+useStitchTask 重定（第二笔）

**Files:**
- Modify: `apps/web/src/hooks/useAsyncMediaTask.ts`（去 socket/socketEvent 参数+双档间隔删；taskId 到位立即首请求+未终态 setInterval 3_000 单值；单调序号：cleanup 与 taskId 变化各 +1、回调序号不一致不 setState）
- Modify: `apps/web/src/hooks/useTrimTaskStatus.ts`/`useVideoSeparateTask.ts`（签名收窄）
- Modify: `apps/web/src/hooks/useStitchTask.ts:70-92`（删 socket.once；先请求一次+5s；65s 超时起算不变；**done 锁**——超时结算后迟到 COMPLETED 走同一把 done 锁不得再 spawnResultNode）
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx:88-98`（taskSocket/ensureExecutionSocket 引用删）
- Test: `useStitchTask.test.ts`/`useTrimTaskStatus.test.ts` 翻新+新断言

**Interfaces:**
- Produces: useTrimTaskStatus/useVideoSeparateTask 签名 `(taskId: string | null, nodeId: string)`；useAsyncMediaTask options 去 socket/socketEvent。

- [ ] **Step 1: 写失败测试**——useAsyncMediaTask：taskId 出现→立即一次 pollFn+未终态建 3s interval+终态不建+cleanup/taskId 变化后序号失配的迟归 resolve 不 setState。useStitchTask：超时结算后迟到 COMPLETED→不 spawnResultNode（done 锁）；先请求一次；65s 起算。
- [ ] **Step 2: 红确认** — `pnpm -C /d/flowweb/apps/web vitest run src/hooks/`，Expected: FAIL（旧签名用例随批翻新）。
- [ ] **Step 3: 实现四文件**——轮询骨架按 spec §3 T1（终态判定/addChildNode/addChildNodes/addEdge/toast 消费语义零改）。
- [ ] **Step 4: 绿确认**（`pnpm -C /d/flowweb/apps/web vitest run src/hooks/ src/pages/canvas/components/nodes/VideoGenNode.test.tsx`）。

### Task 6: 余额信号恰一次+静默重拉（第二笔）

**裁决与验收全按 spec §3 D1（v2.3 收紧+ref 化面）执行**——`fetchRuntimeSnapshot` 用途参数必填 'init'|'resync'（调用点恰五：init 一+回落四）；`syncRuntimeFeed` 终态标记跨轮累加、一次函数调用只派发一次（追上/轮尽且有 done|error exec.status 或 exec.artifact→结束时一次；中途转快照=该次 resync 派发+清标记+被弃批不另算）；creditsStore silent 档+共用递增序号（静默失败不改 loading/error/数字）+**applyBalance 删除**；CanvasTopBar 空 detail 收号+默认团队比较结果 ref 化（teamId 变化随现有 effect 重算）+统一刷新函数。

**Files:** `apps/web/src/stores/runtimeStore.ts:324-411`、`apps/web/src/stores/creditsStore.ts`、`apps/web/src/pages/canvas/components/CanvasTopBar.tsx:59-68`；Test: runtimeStore/creditsStore spec+CanvasTopBar 用例。
**Steps（TDD）：** Step 1 写失败测试七断言（init 零派发/四回落各一次/增量整批一次〔多轮合成〕/缺口转快照被弃批不另算/loading·skipped 不触发/silent 失败三不改/旧响应迟归不覆盖）→Step 2 红（`pnpm -C /d/flowweb/apps/web vitest run src/stores/`）→Step 3 按上述裁决实现→Step 4 绿（同 Step 2+CanvasTopBar 相关 spec）。

### Task 7: ImageGenNode 受理结局+投影读+删订阅（第二笔）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx:780-838`（handleGenerate：await 前写基线 ref 三元 {nodeVersion, mediaId, intentId:null}——nodeVersion=槽上合法十进制/无则 cursor.feedSeq/再无 null **禁 '0'**；响应分支=**接住 withSyncRetry 返回值**（泛型直通 executionApi:38-39）**只认 outcome**：`replayed:true && outcome==='delivered'`→退出编辑+processing false+清基线/`outcome==='voided'`→保持编辑态与 processing/`replayed:false`→intentId 入 ref+**立刻读一次当前投影**〔Feed 可能先到〕；deduped 形态不进本工具条）、`:1071-1098`（subscribeNodeEditResult 段删→useRuntimeFeedStore 订阅+三条件匹配）、`:382-388`（node:status 订阅删）
- Modify: `AudioGenNode.tsx:62-68`、`VideoGenNode.tsx:368-374`（零副作用订阅删）
- Test: `ImageGenNode.test.tsx` G2/G3 族翻新

**Interfaces:**
- Consumes: Task 3 受理响应四档；Task 4 `entry.execStatus?.error`/`.intentId`/`.nodeVersion`。
- Produces: 基线 ref `editBaselineRef.current: { nodeVersion: string | null; mediaId: string | undefined; intentId: string | null } | null`。

- [ ] **Step 1: 写失败测试**——①delivered→退出编辑+processing false+清基线②voided→保持编辑态+processing③新建成功（replayed:false+intentId）→intentId 入 ref+立刻读投影（Feed 先到场景——响应前投影已含该 intentId 的 error 也要弹）④错误三条件：ref null→不动/entry.intentId≠ref.intentId→不动/版本≤基线→不动；三条件全中→editError=投影 error（空/缺键→「AI 处理失败」）+processing false⑤此后 mediaId 相对基线变且非空→退出编辑⑥成功但 mediaId 未变/空→保持⑦退出编辑/卸载→ref 清。
- [ ] **Step 2: 红确认** — `pnpm -C /d/flowweb/apps/web vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx`。
- [ ] **Step 3: 实现**——useRuntimeFeedStore selector 订阅+三条件匹配（BigInt 比较 try/catch 非十进制按不大于处理）；三组件订阅段删。
- [ ] **Step 4: 绿确认**（Step 2 命令+Audio/VideoGenNode 相关 spec「无订阅」锚×3）。

### Task 8: 服务端删除面+第二笔 commit（第二笔）

**裁决与验收全按 spec §3 S1+S2 执行**——含 **`pages/canvas/page.tsx:296-297` 的 ensureExecutionSocket/teardownExecutionSocket 画布级连接删（spec §2 page.tsx 锚——文件表必含）**。

**Files:** Delete `apps/api/src/modules/gateway/emit.port.ts`+`emit.port.spec.ts`+`execution.gateway.ts`+`execution.gateway.spec.ts`+`apps/web/src/services/executionSocket.ts`；Modify `execution-core.module.ts:81-96`（EmitPort useFactory+gateway 装配+exports 删）、`worker.module.ts:274`（provider 删+spec :116/:143 断言翻新）、33 emit 调用文件（execution.service 15〔含 :542-546 credits 搭车+balancePayload :99-101 随删〕/ai-image-edit.controller 2/processor 4/lighting.controller 2/lighting.consumer 3/video-trim 2/video-separate 3/stitch 1/materialize-job :561）、`pages/canvas/page.tsx:296-297`；各 spec emit 断言删/翻。

**Steps（TDD）：** Step 1 grep 门禁先红（13 符号零命中断言——客户端 5+服务端 8，排除测试树）→Step 2 删客户端面（executionSocket.ts/page.tsx 两行/三组件三 hook 残余 import）→Step 3 删服务端面（调用行+@Inject+import/两 gateway 文件+两 spec/两装配段/Counter 随端口文件删不进围栏/幂等回放臂 :402/:408/:842/:845 emit 断言删）→Step 4 全量门禁（双端 grep 转绿+api tsc/lint+api test 3366 基线+web test 4121 基线+E64 门 int 复跑 2/2+socket.io-client=WeChatQRModal 恰一处）→Step 5 第二笔提交 `refactor(y3): 删 /execution 命名空间——通知退场 Feed/轮询/REST 单通道`（body 录双端 grep 零命中+两池基线+E64 复跑）。

### Task 9: 批末收口（主会话）

- `pnpm verify`（全量 36 步）+E56 复核锚（connection-supervisor routeClose 单源——只读确认零改动）+census/行数锚类门禁按批同步（execution.gateway/collab-doc-registry 行数锚若有）→ledger/记忆收口→push=用户确认门（本地累计：a746ca21/96fe4887/c268b890/784e28a3/017f66c8/4edd2cfd+本批两笔）。
