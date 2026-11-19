<!-- doc-status: active | created: 2026-11-19 | plan v2（依 spec v2.4 落盘——plan 外审一轮五定案采纳：①Feed error 封闭句表〔err.message 禁入 errorPatch——TEXT_PROVIDER_UNKNOWN 两处原文拼接锚〕+三档消毒降为最后一道②受理响应即结果〔runGuarded/lighting 重放只 emit 无 Feed 事件——新建返回补 intentId+重放看 resultRef〕③基线禁 '0'〔身份判据=intentId 三条件匹配+reaper/lighting 两写点补行 intentId/execSeq〕④组装器必填键定死〔status 抛错/attempts 恒写/execSeq 十进制 string——typeof 收敛破坏 wire 纪律〕+intentId 回落 execSeq 垫片行删⑤Review Focus 残段档归 T1+凭证例 CREDIT_INSUFFICIENT；trim/separate 常态 3s〔现码 socket 连 10s/断 3s〕+单调序号作废在途；commit 纪律维持两笔） -->
# Y3 协议退场 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删 `/execution` socket.io 命名空间与五族 socket 通知——执行进度走 RuntimeFeed、三族任务改 REST 轮询单通道、余额改 REST 事件驱动刷新；先补 Feed 字段与扣费失败写入（第一笔），再双端同删（第二笔）。

**Architecture:** 服务端 exec.status 载荷收口到 shared 一个允许清单组装器（八键+必填键定死+error 三档消毒兜底），Feed error 只用封闭句表（err.message 禁入）；编辑成功信号=受理响应（新建返回 intentId）+投影（幂等重放看 resultRef）；客户端 edit 失败匹配=intentId 身份+版本严格大于基线；三族任务轮询钉发起者组件（3s/5s 单值+单调序号作废在途）；最后整体删除 EmitPort 端口族+ExecutionGateway+executionSocket 单例。

**Tech Stack:** NestJS (api/worker 双进程)、BullMQ、Prisma+PG、RuntimeFeed（RuntimeEvent 表+feed-hint stateless）、zustand (web)、vitest（三池：默认/heavy/int——int 须显式 `-c vitest.int.config.ts`）。

**Spec:** `docs/superpowers/specs/2026-11-19-y3-protocol-retirement-design.md`（v2.4——本 plan 的一切裁决以 spec 为准，执行者读两份）。

## Global Constraints

- TypeScript strict；禁垫片/禁兼容层/禁「socket 优先 REST 兜底」双通道（spec 反目标）。
- EVENT_KINDS 五值闭表零动；exec.status 补 `execSeq?`/`error?` 为该 kind 可选字段，非新 kind。
- **Feed error 只用封闭句表（err.message 禁入 Feed——异常原文只进日志；errors[].error 仍可带原文=请求响应）**：扣费失败五码→现有词表（未命中「扣费失败，请重试」）；编辑通用失败→「AI 处理失败」(EDIT_FAILED)；节点执行通用失败→「生成失败」(实际码缺省 EXECUTION_FAILED)；超时回收→「生成已被系统回收（超时）——产物未投递」(INTENT_DEADLINE_EXCEEDED)；资金不变量→「生成结果暂缓交付（资金核销异常，待对账处理）」(FUNDS_INVARIANT_VIOLATION)；TEXT_PROVIDER_UNKNOWN 已 markUnknown→「可能重复生成、不会重复扣费（请稍后查询或重试）」/mark 失败→「外呼结果不明，扣费状态待对账（请稍后查询或重试）」；reaper 两句维持现句。三档消毒留组装器当最后一道不代替封闭句。
- 组装器八键恰：`status、attempts、execSeq、errorCode、artifactRev、intentId、rearmable、error`；必填键定死：status 非空字符串否则抛错；attempts 有限数字缺则 0 **始终写入**；execSeq 仅 `/^\d+$/` 字符串才写入；errorCode/intentId 非空字符串才写入；artifactRev 有限数字才写入；rearmable 布尔才写入；error 三档（先检 trim 后全文，再决定替换或截断——UTF-16 码元 200）。fileId/jobId/reason/nodeVersion/v/kind 一律不写；nodeVersion 只由 appendEventInTx 盖（runtime-feed.service.ts:134-136）。
- intentId=GenerationIntent 行上 `intentId` 列（claim 时 randomUUID 铸）；**五处失败写入**（扣费/通用/资金不变量/reaper projectReaped/lighting 资金分支）都从意图行读 intentId/attempts/execSeq（`execSeq=row.execSeq.toString()`）。
- 缺 nodeVersion 的 exec.status 不算一条状态；共享投影函数只在键有值时拷贝、缺的可选键不写 undefined；**projectRuntimeExecToNodeStore 的 intentId 回落 execSeq 行删除**（两列非同一身份=垫片）。
- 受理响应即结果：runGuarded/lighting 新建成功返回补 intentId；重放体保持 `{replayed:true, resultRef}` 不加。
- 客户端错误匹配三条件：ref 非空 ∧ `entry.intentId === ref.intentId` ∧ 版本（十进制 BigInt）严格大于基线；**基线禁 '0'**（nodeVersion=槽上合法十进制/无则 cursor.feedSeq/再无 null）。
- trim/separate 轮询常态 3s（现码 socket 连 10s/断 3s——删快路径后恒 3s）；stitch 先请求一次之后 5s、65s 从 start() 起算；useAsyncMediaTask 单调序号作废在途（cleanup 与 taskId 变化各 +1）；终态不再 setInterval。
- /payment 与 socket.io-client 包保留；PROJECT_TEAM_MISSING/INTENT_GUARD_MISSING 维持零写不动；stitch spawnResultNode 载荷（fileId+status:'done'）不改；发起者关页后三族结果节点不出现=现架构（不塞本批）。
- **commit 纪律：全批恰两笔大 commit**——T1-T4 组成第一笔（`feat(y3): exec.status 组装器+封闭句表+扣费失败 Feed 写`），T5-T8 组成第二笔（`refactor(y3): 删 /execution 命名空间——通知退场 Feed/轮询/REST 单通道`）。任务边界≠commit 边界：组内任务完成只跑门禁不 `git commit`，组末一次提交；第一笔提交前须全量绿（含 socket 仍在的既有测试）。

## Review Focus

1. **先截后检残段**：error 原文第 200 位后才出现 `https:`——截断把协议头切掉、残段绕过消毒档入库。测试：组装器单测「长前缀+尾部 URL」档（T1 Step 1——组装器面非写面）。
2. **供应商原文直进团队投影**：err.message 不带换行/URL 时三档消毒放行——内部路径/参数回显原样进全员投影+7 天 IDB。测试：T3 断言所有 Feed error 键值∈封闭句表枚举（text 链 TEXT_PROVIDER_UNKNOWN 两句档随附）。
3. **幂等重放停在处理中**：重放无 Feed 事件、投影 mediaId 就是基线——「变了才退出」永不触发。测试：T7 受理响应分支（重放 resultRef 非空→退出+清基线/作废重放→保持）。
4. **历史失败当成这一次**：基线记 '0' 或只查版本不查身份——晚到的全量折叠弹旧错误。测试：T7 三条件匹配（ref null 不动/intentId 对上才弹/版本严格大于）+T3 reaper 补 intentId（编辑超时对得上点击）。
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
- Produces: `assembleExecStatusPayload(patch)`——必填键定死（Global Constraints 第四条）；**不写 nodeVersion/kind/v/fileId/jobId/reason**。
- Produces: `execStatusSlotOfPayload(p: Record<string, unknown>): { execStatus: RuntimeProjectionExecStatusFact } | null`——p 缺合法 nodeVersion（非十进制 string）返回 null；键有值才拷。
- Produces: `RESERVE_FAIL_SENTENCES`（五码词表）+`reserveFailSentence(code)`（未命中→「扣费失败，请重试」）+`GENERIC_EDIT_FAIL_MESSAGE='AI 处理失败'`+`GENERIC_EXEC_FAIL_MESSAGE='生成失败'`。

- [ ] **Step 1: 写失败测试**（runtime-exec-status.spec.ts）——七组：①八键全值载荷恰含八键②必填键档：status 空串/非字符串→抛错；attempts 缺→0 始终在；execSeq 数字/非十进制串→键不出现③error 三档：`'积分不足'` 原样／`'see https://x'`/`'line1\nline2'`/`'a\r b'`/`'x ://y'`→`'生成失败'`／非字符串与空白→键不存在／**长前缀+尾部 URL**（`'x'.repeat(210)+' https://evil'`——先检后截→整句「生成失败」）④`'好'.repeat(300)` 按 UTF-16 码元截 200⑤词表五码+未命中码⑥execStatusSlotOfPayload：全值→Fact 八键+nodeVersion；缺 nodeVersion/`nodeVersion:'abc'`→null⑦fileId/jobId/reason/nodeVersion/v/kind 传入也不出现。

- [ ] **Step 2: 跑测试确认红** — `cd /d/flowweb/packages/shared && pnpm vitest run src/collab/runtime-exec-status.spec.ts`，Expected: FAIL（文件不存在）。
- [ ] **Step 3: 实现 runtime-exec-status.ts**——按 Interfaces+Global Constraints 第四条；三档先检 trim 后全文再决定替换或截断。
- [ ] **Step 4: 跑测试确认绿**（同 Step 2 命令，PASS）。
- [ ] **Step 5: 契约类型两处扩键**（runtime-event.ts:31-44+runtime-projection.ts Fact）——`execSeq?: string`/`error?: string`，注释标「Y3 v2.3：载荷已在写（类型滞后勘正）」。跑 `pnpm -C /d/flowweb/packages/shared test`（taxonomy 键集断言若红随批加两键）。

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
- [ ] **Step 4: 绿确认**（同 Step 2；再跑 `pnpm -C /d/flowweb/apps/api vitest run src/modules/collab/`——collab 池全绿防邻接破面）。

### Task 3: 五处失败写入封闭句化+行读补全（第一笔）

**Files:**
- Modify: `apps/api/src/modules/execution/execution.service.ts:434-439/:174-180`（onReserveFail+主路径扣费失败）、`:599-603/:622-626`（TEXT_PROVIDER_UNKNOWN 两句+generic catch——err.message 禁入 errorPatch）、`:926-934`（冻结路径 TEXT_PROVIDER_UNKNOWN）
- Modify: `apps/api/src/modules/ai-image-edit/ai-image-edit.processor.ts:143-152/:336-346`（编辑扣费失败+通用失败）+`:309-320`（资金不变量补行读）
- Modify: `apps/api/src/modules/execution/intent-reconcile.service.ts:529-536`（reaper projectReaped 补行 intentId/execSeq——现句维持）
- Modify: `apps/api/src/modules/ai-image-edit/lighting/lighting.consumer.ts:252-258`（资金分支补行 intentId/execSeq）
- Modify: `apps/api/src/modules/ai-image-edit/ai-image-edit.controller.ts:103-107`（runGuarded enqueue 成功返回补 intentId）+`lighting.controller.ts`（新建成功返回补 intentId）
- Test: execution.service/processor/reconcile/lighting spec 断言更新+封闭句表断言

**Interfaces:**
- Consumes: Task 1 `reserveFailSentence`/`GENERIC_EDIT_FAIL_MESSAGE`/`GENERIC_EXEC_FAIL_MESSAGE`。
- Produces: 全部 Feed error∈封闭句表；五处写入带行 intentId/attempts/execSeq；编辑受理新建返回体含 intentId（T7 客户端消费）。

- [ ] **Step 1: 写失败测试**——①编辑扣费失败（reason:'CREDIT_INSUFFICIENT'）：writeExecStatus payload={status:'error', errorCode:'CREDIT_INSUFFICIENT', error:'积分不足', intentId:行值, execSeq:row.execSeq.toString(), rearmable:attempts<3}+void_ 原因仍原因码②节点执行 onReserveFail 同形（errors[].error='积分不足'）③TEXT_PROVIDER_UNKNOWN 两档：Feed error=两句封闭句（无 err.message 前缀）、errors[].error 可带原文④generic catch：Feed error='生成失败'、errorCode=实际码缺省 EXECUTION_FAILED、err.message 只进 logger⑤编辑通用失败：error='AI 处理失败'/errorCode='EDIT_FAILED'⑥reaper projectReaped 载荷含 intentId/execSeq（句不变）⑦lighting 资金分支含 intentId/execSeq⑧runGuarded/lighting 新建成功返回含 intentId；重放体仍无 intentId。
- [ ] **Step 2: 红确认** — `pnpm -C /d/flowweb/apps/api vitest run src/modules/execution/ src/modules/ai-image-edit/`，Expected: 新断言 FAIL。
- [ ] **Step 3: 实现**——errorPatch 收口为「errorCode+封闭句」签名（err.message 禁入第二参——调用面全改）；TEXT_PROVIDER_UNKNOWN 两处 unknownMsg 去掉 `${err.message}——` 前缀改封闭句；generic catch errorPatch 传 GENERIC_EXEC_FAIL_MESSAGE（errorCode 推导 :622 承接不变）；processor 两分支+reaper+lighting 资金分支补行读（intentId/attempts/execSeq）；runGuarded/lighting enqueue 成功 return 加 `intentId: intent.intentId`。
- [ ] **Step 4: 绿确认**（同 Step 2 命令+`pnpm -C /d/flowweb/apps/api test` 默认池全量）。
- [ ] **Step 5: api 侧类型门禁** — `pnpm -C /d/flowweb/apps/api exec tsc --noEmit`（0 错）+`pnpm -C /d/flowweb/apps/api lint`（0 error；存量 warning 不动）。

### Task 4: 第一笔 commit（含客户端投影链三处）

**Files:**
- Modify: `apps/web/src/stores/runtimeStore.ts:174-186`（slotOfEventWire 改调 shared 投影函数——删 :176 伪造兜底）、`:32-56`（projectRuntimeExecToNodeStore 拷 error+**删 :42-43 intentId 回落 execSeq 行**）、`:208`（selectRuntimeEntry 返回类型补 error/nodeVersion）
- Test: runtimeStore spec（无独立 spec 则新建 `runtimeStore.exec-status.spec.ts`）+ImageGenNode.test.tsx 投影链断言

**Interfaces:**
- Consumes: Task 1 `execStatusSlotOfPayload`。
- Produces: 客户端投影槽含 error 且 intentId 无回落——T7 工具条读 `entry.execStatus?.error`/`entry.execStatus?.intentId`。

- [ ] **Step 1: 写失败测试**——第一件客户端半：`applyEventsToProjection` 喂含 error:'积分不足' 的 exec.status 事件→projectRuntimeExecToNodeStore 后 entry.error==='积分不足' 且 entry.intentId===载荷 intentId（execSeq-only 载荷→entry.intentId===undefined——垫片行已删）；缺 nodeVersion 事件→unknown 计数+1、投影无新槽。
- [ ] **Step 2: 红确认** — `cd /d/flowweb/apps/web && pnpm vitest run src/stores/runtimeStore.exec-status.spec.ts`。
- [ ] **Step 3: 实现三处**——slotOfEventWire exec.status 分支改调 `execStatusSlotOfPayload(p)`；projectRuntimeExecToNodeStore 补 error 拷贝+删回落行；selectRuntimeEntry 类型补。
- [ ] **Step 4: 绿确认**（Step 2 命令+`pnpm -C /d/flowweb/apps/web vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx`）。
- [ ] **Step 5: 第一笔提交**——`pnpm -C /d/flowweb/apps/api test`+`pnpm -C /d/flowweb/apps/web test`（全量绿）→`git add`第一笔全部文件→`git commit -m "feat(y3): exec.status 组装器+封闭句表+扣费失败 Feed 写"`（body 凭证：CREDIT_INSUFFICIENT/「积分不足」/intentId=行上列/生成失败消毒档/五处行读补全）。

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
- [ ] **Step 3: 实现四文件**——轮询骨架按 spec T1（终态判定/addChildNode/addChildNodes/addEdge/toast 消费语义零改）。
- [ ] **Step 4: 绿确认**（`pnpm -C /d/flowweb/apps/web vitest run src/hooks/ src/pages/canvas/components/nodes/VideoGenNode.test.tsx`）。

### Task 6: 余额信号恰一次+静默重拉（第二笔）

（与 v1 相同——spec D1 v2.3/v2.4 无变化）Files/Steps 按 v1 原文执行：fetchRuntimeSnapshot 用途参数必填 'init'|'resync'（五调用点）；syncRuntimeFeed 终态标记跨轮累加一次派发；creditsStore silent 档+共用递增序号+**applyBalance 删除**；CanvasTopBar 空 detail 收号+scope ref 化（teamId 变化时随现有 effect 重算）。测试七断言：init 零派发/四回落各一次/增量整批一次（多轮合成）/缺口转快照被弃批不另算/loading·skipped 不触发/silent 失败不改 loading·error·数字/旧响应迟归不覆盖。跑 `pnpm -C /d/flowweb/apps/web vitest run src/stores/`+CanvasTopBar 相关 spec。

### Task 7: ImageGenNode 受理响应+投影读+删订阅（第二笔）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx:780-838`（handleGenerate：await 前写基线 ref 三元 {nodeVersion, mediaId, intentId:null}——nodeVersion=槽上合法十进制/无则 cursor.feedSeq/再无 null **禁 '0'**；响应分支：replayed∧resultRef 非空→退出编辑+processing false+清基线/replayed∧无 resultRef→保持/新建→intentId 入 ref+**立刻读一次当前投影**）、`:1071-1098`（subscribeNodeEditResult 段删→useRuntimeFeedStore 订阅+三条件匹配）、`:382-388`（node:status 订阅删）
- Modify: `AudioGenNode.tsx:62-68`、`VideoGenNode.tsx:368-374`（零副作用订阅删）
- Test: `ImageGenNode.test.tsx` G2/G3 族翻新

**Interfaces:**
- Consumes: Task 3 受理响应 intentId；Task 4 `entry.execStatus?.error`/`.intentId`/`.nodeVersion`。
- Produces: 基线 ref `editBaselineRef.current: { nodeVersion: string | null; mediaId: string | undefined; intentId: string | null } | null`。

- [ ] **Step 1: 写失败测试**——①重放 resultRef 非空→退出编辑+processing false+清基线②作废重放（无 resultRef）→保持编辑态+processing③新建成功→intentId 入 ref+立刻读投影（Feed 先到场景——响应前投影已含该 intentId 的 error 也要弹）④错误三条件：ref null→不动/entry.intentId≠ref.intentId→不动/版本≤基线→不动；三条件全中→editError=投影 error（空/缺键→「AI 处理失败」）+processing false⑤此后 mediaId 相对基线变且非空→退出编辑⑥成功但 mediaId 未变/空→保持⑦退出编辑/卸载→ref 清。
- [ ] **Step 2: 红确认** — `pnpm -C /d/flowweb/apps/web vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx`。
- [ ] **Step 3: 实现**——useRuntimeFeedStore selector 订阅+三条件匹配（BigInt 比较 try/catch 非十进制按不大于处理）；三组件订阅段删。
- [ ] **Step 4: 绿确认**（Step 2 命令+Audio/VideoGenNode 相关 spec「无订阅」锚×3）。

### Task 8: 服务端删除面+第二笔 commit（第二笔）

（与 v1 相同——13 符号 grep 门禁先红后删、33 调用点、两 gateway 文件+两 spec、两装配段、Counter 随端口文件删、幂等回放臂 emit 断言删、worker.module.spec 断言翻新、E64 门 int 复跑、socket.io-client=WeChatQRModal 恰一处）Files/Steps 按 v1 原文执行；`git commit -m "refactor(y3): 删 /execution 命名空间——通知退场 Feed/轮询/REST 单通道"`（body 录双端 grep 零命中+两池基线+E64 复跑）。

### Task 9: 批末收口（主会话）

（与 v1 相同）`pnpm verify` 全量+E56 复核锚+census/行数锚同步+ledger/记忆收口+push=用户确认门（本地累计：a746ca21/96fe4887/c268b890/784e28a3/017f66c8+本批两笔）。
