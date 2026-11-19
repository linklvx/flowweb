<!-- doc-status: active | created: 2026-11-19 | plan v1（依 spec v2.3 784e28a3 落盘——两笔 commit 切法：第一笔=纯补写〔shared 组装器八键+error 三档+slot 统一+扣费失败 Feed 写〕可单独进库；第二笔=双端同删〔客户端 socket 消费+EmitPort 全族+gateway〕；执行序=T1→T8 后停：commit 纪律为两笔大 commit，任务边界≠commit 边界——T1-T4 组成第一笔、T5-T8 组成第二笔，组内不中间提交、组末一次提交；int 池跑法/DATABASE_URL/pollUntil 形态环境事实在 T0） -->
# Y3 协议退场 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删 `/execution` socket.io 命名空间与五族 socket 通知——执行进度走 RuntimeFeed、三族任务改 REST 轮询单通道、余额改 REST 事件驱动刷新；先补 Feed 字段与扣费失败写入（第一笔），再双端同删（第二笔）。

**Architecture:** 服务端 exec.status 载荷收口到 shared 一个允许清单组装器（八键+error 三档消毒），服务端/客户端 slot 函数改调同一 shared 投影函数；扣费失败分支补 writeExecStatus（封闭原因码词表+行 intentId/execSeq）；客户端 edit 失败 UI 与余额刷新改读投影/REST；三族任务轮询钉发起者组件；最后整体删除 EmitPort 端口族+ExecutionGateway+executionSocket 单例。

**Tech Stack:** NestJS (api/worker 双进程)、BullMQ、Prisma+PG、RuntimeFeed（RuntimeEvent 表+feed-hint stateless）、zustand (web)、vitest（三池：默认/heavy/int——int 须显式 `-c vitest.int.config.ts`）。

**Spec:** `docs/superpowers/specs/2026-11-19-y3-protocol-retirement-design.md`（v2.3——本 plan 的一切裁决以 spec 为准，执行者读两份）。

## Global Constraints

- TypeScript strict；禁垫片/禁兼容层/禁「socket 优先 REST 兜底」双通道（spec 反目标）。
- EVENT_KINDS 五值闭表零动；exec.status 补 `execSeq?`/`error?` 为该 kind 可选字段，非新 kind。
- 组装器八键恰：`status、attempts、execSeq、errorCode、artifactRev、intentId、rearmable、error`；fileId 不进状态事件（留 exec.artifact）；nodeVersion 只由 appendEventInTx 盖（runtime-feed.service.ts:134-136），组装器/调用方禁自带。
- error 三档序（先检原文再截断）：①非字符串或 trim 后空→省键②trim 后全文命中换行/`\r`/大小写不敏感 `http:`/`https:`/`://`→整句改「生成失败」③其余才截 200 字。
- 扣费失败词表（errorCode 仍写实际原因码；void_/日志仍原因码；Feed error 与执行接口 `errors[].error` 写词表句）：CREDIT_INSUFFICIENT→积分不足／QUOTA_EXCEEDED→本月额度已用尽／NOT_MEMBER→不在该团队，无法扣费／TEAM_BALANCE_MISSING→团队积分账户不存在／RESERVE_GATE_LOST 及其他→扣费失败，请重试。
- 通用失败固定句「AI 处理失败」（errorCode EDIT_FAILED），error.message 只留日志。
- intentId=GenerationIntent 行上 `intentId` 列（claim 时 randomUUID 铸）；三次失败写入（扣费/通用/资金不变量）都从意图行读 intentId/attempts/execSeq（`execSeq=row.execSeq.toString()`）。
- 缺 nodeVersion 的 exec.status 不算一条状态；共享投影函数只在键有值时拷贝、缺的可选键不写 undefined。
- /payment 与 socket.io-client 包保留（WeChatQRModal 恰一处引用）；PROJECT_TEAM_MISSING/INTENT_GUARD_MISSING 维持零写不动；stitch spawnResultNode 载荷（fileId+status:'done'）不改。
- **commit 纪律：全批恰两笔大 commit**——T1-T4 组成第一笔（`feat(y3): exec.status 组装器八键+error 三档+扣费失败 Feed 写`），T5-T8 组成第二笔（`refactor(y3): 删 /execution 命名空间——通知退场 Feed/轮询/REST 单通道`）。任务边界≠commit 边界：组内任务完成只跑门禁不 `git commit`，组末一次提交；第一笔提交前须全量绿（含 socket 仍在的既有测试）。

## Review Focus

1. **先截后检残段**：error 原文第 200 位后才出现 `https:`——截断把协议头切掉、残段绕过消毒档入库。测试：组装器单测加「长前缀+尾部 URL」档（T2 Step 1）。
2. **旧错误误判为本次失败**：打开编辑模式时节点已有旧 error——投影一变就被当成本次失败弹出。测试：T7 基线用例「ref 未写时投影变化不改编辑态」。
3. **重复信号循环重拉**：一次 syncRuntimeFeed 多轮/多回落并发触发多次 credits:update→余额接口被打成轮询。测试：T6「一次函数调用只派发一次」+「缺口转快照被弃批不另算」。
4. **迟到事件覆盖终态**：轮询终态后 interval 再起/在途响应迟归写旧态/超时后迟到 COMPLETED 再 spawn。测试：T5「终态不再建 interval+清理作废在途」+「超时后迟到 COMPLETED 不 spawn」。
5. **第一笔单独进库破旧端**：载荷扩键后旧客户端（仍在 socket 档）读事件——必须忽略未知字段不崩。测试：T4 taxonomy 契约测试「旧键集事件照常投影」+既有 web 全量绿兜底。

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
- Create: `packages/shared/src/collab/runtime-exec-status.ts`（组装器+投影函数）
- Test: `packages/shared/src/collab/runtime-exec-status.spec.ts`
- Modify: `packages/shared/src/collab/runtime-event.ts:31-44`（exec.status 分支补 `execSeq?: string`/`error?: string`）
- Modify: `packages/shared/src/collab/runtime-projection.ts:20-33`（RuntimeProjectionExecStatusFact 补 `error?: string`——execSeq 已有）
- Modify: `packages/shared/src/collab/index.ts` 或等价出口（若存在 re-export 面则补）

**Interfaces:**
- Produces: `assembleExecStatusPayload(patch: { status: unknown; attempts?: unknown; execSeq?: unknown; errorCode?: unknown; artifactRev?: unknown; intentId?: unknown; rearmable?: unknown; error?: unknown }): Record<string, unknown>`——八键中键有值才写（number/string/boolean 各按 typeof 收敛），error 走三档；**不写 nodeVersion/kind/v**（appendEventInTx 单源）。
- Produces: `execStatusSlotOfPayload(p: Record<string, unknown>): { execStatus: RuntimeProjectionExecStatusFact } | null`——p 缺合法 nodeVersion（非十进制 string）返回 null；键有值才拷。
- Produces: 常量 `RESERVE_FAIL_SENTENCES: Record<string, string>`（五原因码词表）+`reserveFailSentence(code: string): string`（未命中→「扣费失败，请重试」）+`GENERIC_EDIT_FAIL_MESSAGE = 'AI 处理失败'`。

- [ ] **Step 1: 写失败测试**（runtime-exec-status.spec.ts）——六组：①八键全值载荷恰含八键（无 nodeVersion/v/kind）②缺键省略（undefined 不写成键）③error 三档：`'积分不足'` 原样／`'see https://x'` 与 `'line1\nline2'` 与 `'a\r b'` 与 `'x ://y'`（大小写不敏感各档）→`'生成失败'`／非字符串与 `'   '`→键不存在／**长前缀+尾部 URL**（'x'.repeat(210)+' https://evil'——残段档：先检后截→整句「生成失败」）④`'好'.repeat(300)` 截 200 字⑤词表五码+未命中码句子⑥execStatusSlotOfPayload：全值→Fact 含八键+nodeVersion；缺 nodeVersion→null；`nodeVersion:'abc'`→null。

- [ ] **Step 2: 跑测试确认红** — `cd /d/flowweb/packages/shared && pnpm vitest run src/collab/runtime-exec-status.spec.ts`，Expected: FAIL（文件不存在）。
- [ ] **Step 3: 实现 runtime-exec-status.ts**——组装器按 Interfaces；三档序严格按 Global Constraints（trim 后检查→替换→才截断）；投影函数 nodeVersion 判定用 `/^\d+$/`。
- [ ] **Step 4: 跑测试确认绿**（同 Step 2 命令，PASS）。
- [ ] **Step 5: 契约类型两处扩键**（runtime-event.ts:31-44 exec.status 分支+runtime-projection.ts Fact）——`execSeq?: string`/`error?: string`，注释标「Y3 v2.3：载荷已在写（类型滞后勘正）」。跑 `pnpm -C /d/flowweb/packages/shared test`（全套含 runtime-event.spec 契约测试——若 taxonomy 键集断言红，随批更新断言加两键）。

### Task 2: 两写面改调组装器+服务端 slot 改调投影函数（第一笔）

**Files:**
- Modify: `apps/api/src/modules/collab/collab-document.service.ts:244-262`（writeExecStatus payload 体）、`:319-324`（deliverArtifact exec.status 字面量）
- Modify: `apps/api/src/modules/collab/runtime-feed.service.ts:336-344`（slotOfEvent exec.status 分支）
- Test: 既有 `apps/api/src/modules/collab/collab-document.exec-map.spec.ts` / `worker-scope-token.spec.ts` 载体随断言更新；新断言入既有 spec

**Interfaces:**
- Consumes: Task 1 `assembleExecStatusPayload`/`execStatusSlotOfPayload`。
- Produces: writeExecStatus/deliverArtifact 载荷形状=八键（deliverArtifact 侧 exec patch 同调组装器——顺带补 intentId/execSeq 洞）。

- [ ] **Step 1: 写失败测试**（进既有 exec-map spec 或其同目录新 describe）——三件第一/二件的服务端半：①writeExecStatus 传 `error:'积分不足'`→appendEvent 载荷含该句②传 `error:'see https://x'`→载荷 error=`'生成失败'`③deliverArtifact 落的 exec.status 事件含 intentId/execSeq（mock intent 行）。
- [ ] **Step 2: 红确认** — `cd /d/flowweb/apps/api && pnpm vitest run src/modules/collab/collab-document.exec-map.spec.ts`，Expected: 新断言 FAIL。
- [ ] **Step 3: 实现三处改道**——writeExecStatus payload 体改调 `assembleExecStatusPayload`（nodeId 单独拼——组装器只管八键）；deliverArtifact ④段字面量改同调组装器（exec patch 来自 poller execDonePatch——其已带 intentId/execSeq，改调后两键不再被丢，execDonePatch 本身零改）；runtime-feed slotOfEvent exec.status 分支改调 `execStatusSlotOfPayload(p)`（null→整事件跳过=unknown 计数）。
- [ ] **Step 4: 绿确认**（同 Step 2；再跑 `pnpm -C /d/flowweb/apps/api vitest run src/modules/collab/`——collab 池全绿防邻接破面）。

### Task 3: 扣费失败+通用失败 Feed 写（第一笔）

**Files:**
- Modify: `apps/api/src/modules/execution/execution.service.ts:434-439/:174-180`（onReserveFail+主路径扣费失败）
- Modify: `apps/api/src/modules/ai-image-edit/ai-image-edit.processor.ts:143-152/:336-346`（编辑扣费失败+通用失败）+`:309-320`（资金不变量写补 intentId）
- Test: 既有 execution.service/processor spec 断言更新+新增词表断言

**Interfaces:**
- Consumes: Task 1 `reserveFailSentence`/`GENERIC_EDIT_FAIL_MESSAGE`。
- Produces: 扣费失败路径 errors[].error=词表句+Feed error=词表句（errorCode=实际原因码）；通用失败 EDIT_FAILED+固定句；三次写入带行 intentId/attempts/execSeq。

- [ ] **Step 1: 写失败测试**——三件第三件：编辑扣费失败（reserve 返回 success:false, reason:'CREDIT_INSUFFICIENT'）→①writeExecStatus 被调（payload: status='error'/errorCode='CREDIT_INSUFFICIENT'/error='积分不足'/intentId=行 intentId/execSeq=row.execSeq.toString()/rearmable:attempts<3）②void_ 原因仍='扣费失败：CREDIT_INSUFFICIENT'。节点执行链 onReserveFail 同形断言（errors[].error='积分不足'）。通用失败断言：error.message 只进 logger、Feed error='AI 处理失败'/errorCode='EDIT_FAILED'。
- [ ] **Step 2: 红确认** — `pnpm -C /d/flowweb/apps/api vitest run src/modules/execution/execution.service.spec.ts src/modules/ai-image-edit/`，Expected: 新断言 FAIL。
- [ ] **Step 3: 实现四处**——execution.service :436 `msg` 改 `reserveFailSentence(errorCode)`（errors[].error+onReserveFail 传参同步）；errorPatch :169 删 `.slice(0,200)`（组装器收口）；processor :143-152 补行读+writeExecStatus（先读 intentId/attempts/execSeq 再写，词表句）；processor :336-346 通用失败改 EDIT_FAILED+固定句+行读（删 `.slice(0,200)`）；:309-320 资金不变量 writeExecStatus 补 intentId（行读已在 attempts 处扩展）。
- [ ] **Step 4: 绿确认**（同 Step 2 命令+`pnpm -C /d/flowweb/apps/api test`（默认池）——第一笔全量绿门槛）。
- [ ] **Step 5: api 侧类型门禁** — `pnpm -C /d/flowweb/apps/api exec tsc --noEmit`（0 错）+`pnpm -C /d/flowweb/apps/api lint`（0 error；本批前存量 warning 不动）。

### Task 4: 第一笔 commit（含客户端投影链三处）

**Files:**
- Modify: `apps/web/src/stores/runtimeStore.ts:174-186`（slotOfEventWire 改调 shared 投影函数——删 :176 `?? e.feedSeq` 伪造兜底）、`:32-56`（projectRuntimeExecToNodeStore 拷 error）、`:208`（selectRuntimeEntry 返回类型补 error/nodeVersion）
- Test: 既有 runtimeStore 相关 spec+ImageGenNode.test.tsx 投影链断言（第一件「积分不足」经客户端槽仍是该句）

**Interfaces:**
- Consumes: Task 1 `execStatusSlotOfPayload`。
- Produces: 客户端投影槽含 error——T7 工具条读 `entry.execStatus?.error`。

- [ ] **Step 1: 写失败测试**——第一件客户端半：`applyEventsToProjection` 喂含 error:'积分不足' 的 exec.status 事件→projectRuntimeExecToNodeStore 后 nodeStore.execStatus 该节点 entry.error==='积分不足'；缺 nodeVersion 事件→unknown 计数+1、投影无新槽。
- [ ] **Step 2: 红确认** — `cd /d/flowweb/apps/web && pnpm vitest run src/stores/runtimeStore.test.ts`（或该逻辑所在 spec——runtimeStore 无独立 spec 则落 `src/stores/runtimeStore.exec-status.spec.ts` 新文件）。
- [ ] **Step 3: 实现三处**——slotOfEventWire exec.status 分支改调 `execStatusSlotOfPayload(p)`；projectRuntimeExecToNodeStore 补 `...(entry.execStatus?.error !== undefined ? { error: entry.execStatus.error } : {})`；selectRuntimeEntry 类型补。
- [ ] **Step 4: 绿确认**（Step 2 命令+`pnpm -C /d/flowweb/apps/web vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx`——G3 socket 用例零写不变量锚不破）。
- [ ] **Step 5: 第一笔提交**——跑 `pnpm -C /d/flowweb/apps/api test`+`pnpm -C /d/flowweb/apps/web test`（全量绿）→`git add`全部第一笔文件→`git commit -m "feat(y3): exec.status 组装器八键+error 三档+扣费失败 Feed 写"`（spec 第一笔测试三件全绿凭证在 commit body：积分不足/生成失败/RESERVE_FAILED+行 intentId）。

### Task 5: 三族轮询单通道+useStitchTask 重定（第二笔）

**Files:**
- Modify: `apps/web/src/hooks/useAsyncMediaTask.ts`（去 socket/socketEvent 参数；taskId 到位立即首请求；终态不再建 interval；清理作废在途响应）
- Modify: `apps/web/src/hooks/useTrimTaskStatus.ts`/`useVideoSeparateTask.ts`（签名收窄）
- Modify: `apps/web/src/hooks/useStitchTask.ts:70-92`（删 socket.once；5s 轮询；65s 超时起算不变；超时后迟到 COMPLETED 不 spawnResultNode）
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx:88-98`（taskSocket/ensureExecutionSocket 引用删）
- Test: `useStitchTask.test.ts`/`useTrimTaskStatus.test.ts` 既有套件翻新+新断言

**Interfaces:**
- Produces: useTrimTaskStatus/useVideoSeparateTask 签名 `(taskId: string | null, nodeId: string)`（socket 参删）；useAsyncMediaTask options 去 socket/socketEvent。

- [ ] **Step 1: 写失败测试**——useAsyncMediaTask：taskId 出现→立即一次 pollFn（不等 interval）+未终态建 3s interval+终态返回后不建+cleanup 后在途 resolve 不写 state。useStitchTask：超时结算后迟到 COMPLETED 响应→不 spawnResultNode；5s 间隔；65s 起算。
- [ ] **Step 2: 红确认** — `pnpm -C /d/flowweb/apps/web vitest run src/hooks/`，Expected: 新形态 FAIL（旧签名用例随批翻新）。
- [ ] **Step 3: 实现四文件**——轮询骨架按 spec T1（先打一枪=taskId 就位即调；终态判定/addChildNode/addChildNodes/addEdge/toast 消费语义零改）；stitch 超时旗标拦截迟到 spawn。
- [ ] **Step 4: 绿确认**（`pnpm -C /d/flowweb/apps/web vitest run src/hooks/ src/pages/canvas/components/nodes/VideoGenNode.test.tsx`——VideoGenNode 既有用例随签名翻新）。

### Task 6: 余额信号恰一次+静默重拉（第二笔）

**Files:**
- Modify: `apps/web/src/stores/runtimeStore.ts:324-411`（fetchRuntimeSnapshot 用途参数必填 'init'|'resync'；syncRuntimeFeed 终态标记+派发；四条回落传 'resync'；initRuntimeFeed 传 'init'）
- Modify: `apps/web/src/stores/creditsStore.ts`（fetchBalance/fetchTeamBalance 加 silent 档+共用递增序号；**applyBalance 删除**）
- Modify: `apps/web/src/pages/canvas/components/CanvasTopBar.tsx:59-68`（守卫改空 detail 收号+scope ref 化+统一刷新函数）
- Test: runtimeStore spec+creditsStore spec（既有/新增）+CanvasTopBar 相关用例翻新

**Interfaces:**
- Produces: `fetchRuntimeSnapshot(projectId, purpose: 'init' | 'resync')`；credits 信号=`window.dispatchEvent(new CustomEvent('credits:update', { detail: null }))`（runtimeStore 内派发，不引用 creditsStore）。

- [ ] **Step 1: 写失败测试**——①init 快照零派发②四回落各恰一次③增量批 done/error/exec.artifact 整次同步恰一次（多轮合成一次）④缺口转快照：resync 一次+被弃批不另算⑤loading/skipped 不触发⑥silent 拉取失败不改 loading/error/数字⑦序号：旧响应迟归不覆盖新值。
- [ ] **Step 2: 红确认** — `pnpm -C /d/flowweb/apps/web vitest run src/stores/`，Expected: FAIL。
- [ ] **Step 3: 实现**——按 spec D1 逐条（终态标记跨轮累加、函数退出统一派发点、中途转快照清标记；CanvasTopBar 默认团队比较进 ref；creditsStore 序号模块级计数器）。
- [ ] **Step 4: 绿确认**（Step 2 命令+`pnpm -C /d/flowweb/apps/web vitest run src/pages/canvas/components/CanvasTopBar.test.tsx` 若在——否则 grep 该组件相关 spec 跑）。

### Task 7: ImageGenNode edit 失败改投影读+删订阅（第二笔）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx:1071-1098`（subscribeNodeEditResult 整段删→useRuntimeFeedStore 订阅+基线 ref）+`:382-388`（node:status 订阅删）
- Modify: `apps/web/src/pages/canvas/components/nodes/AudioGenNode.tsx:62-68`、`VideoGenNode.tsx:368-374`（零副作用订阅删）
- Test: `ImageGenNode.test.tsx` G2/G3 族用例翻新（editError=投影 error 读径+基线档）

**Interfaces:**
- Consumes: Task 4 `entry.execStatus?.error`（selectRuntimeEntry）。
- Produces: 基线 ref 形态——`editBaselineRef.current: { nodeVersion: string; mediaId: string | undefined } | null`；生成点击 handler 在 await 前写、退出编辑/卸载清。

- [ ] **Step 1: 写失败测试**——①ref 未写时投影变化不改编辑态（旧 error 不弹）②status='error' 且 nodeVersion BigInt 严格大于基线→editError=投影 error（空/缺键→「AI 处理失败」）+processing false③此后 mediaId 相对基线变且非空→退出编辑④成功但 mediaId 未变/为空→保持编辑态+processing 保持⑤退出编辑/卸载→ref 清。
- [ ] **Step 2: 红确认** — `pnpm -C /d/flowweb/apps/web vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx`，Expected: FAIL（订阅面已删、投影面未接）。
- [ ] **Step 3: 实现**——useRuntimeFeedStore selector 订阅+useEffect 处理基线判定（BigInt 比较 try/catch 非十进制按不大于处理）；三组件订阅段删。
- [ ] **Step 4: 绿确认**（Step 2 命令+AudioGenNode/VideoGenNode 相关 spec——「无订阅」不变量锚×3 翻新落地）。

### Task 8: 服务端删除面+第二笔 commit（第二笔）

**Files:**
- Delete: `apps/api/src/modules/gateway/emit.port.ts`+`emit.port.spec.ts`、`execution.gateway.ts`+`execution.gateway.spec.ts`
- Modify: `apps/api/src/modules/execution/execution-core.module.ts:81-96`（EmitPort useFactory+gateway 装配+exports 面删）、`apps/api/src/worker.module.ts:274`（provider 删；同文件 spec :116/:143 断言翻新）
- Modify: 全部 emit 调用文件（33 处——execution.service 15 调用点〔含 :542-546 credits 搭车+`balancePayload` :99-101 随删〕/ai-image-edit.controller 2/processor 4/lighting.controller 2/lighting.consumer 3/video-trim 2/video-separate 3/stitch 1/materialize-job.service :561 一处）+构造注入+imports
- Modify: `apps/web/src/services/executionSocket.ts` 删+`pages/canvas/page.tsx:296-297` 生命周期删
- Modify: worker.module.spec.ts/各服务 spec emit 断言删/翻

**Interfaces:**
- Consumes: 无（纯删除+断言翻新）。

- [ ] **Step 1: 先红后删（TDD 序）**——grep 门禁脚本先行：对生产树（排除 `*.spec.ts`/`*.test.ts`/`*.spec.tsx`）断言零命中 13 符号：客户端 5（executionSocket/subscribeNodeStatus/subscribeNodeEditResult/ensureExecutionSocket/teardownExecutionSocket）+服务端 8（emitNodeStatus/emitTrimStatus/emitSeparateStatus/emitStitchStatus/ExecutionGateway/EmitPort/WorkerEmitPort/`namespace: '/execution'`）。当前红（命中一堆）。
- [ ] **Step 2: 删客户端面**——executionSocket.ts 文件删；page.tsx 两行删；三组件/三 hook 残余 import 清（T5/T7 已删主体）。
- [ ] **Step 3: 删服务端面**——13 文件 emit 调用行删+@Inject(EmitPort) 构造参删+import 删；两 gateway 文件+两 spec 删；两装配段删；`collab_emit_degraded_total` Counter 随 emit.port.ts 删（不进围栏不跑 --write-metric-names）；幂等回放臂 :402/:408/:842/:845 emit 断言直接删（投影仍由 poller 既有行负责——回放=幂等返回非新增态）。
- [ ] **Step 4: 全量门禁**——①双端 grep 零命中（Step 1 脚本转绿）②`pnpm -C /d/flowweb/apps/api exec tsc --noEmit`+lint 0 error③`pnpm -C /d/flowweb/apps/api test`（3366 用例基线）④`pnpm -C /d/flowweb/apps/web test`（4121 用例基线——5 skipped）⑤E64 门复跑（int 池 intent-reconcile.e64-gate.int.spec.ts 2/2 绿——Task 0 跑法）⑥socket.io-client 生产引用 grep=WeChatQRModal 恰一处。
- [ ] **Step 5: 第二笔提交** — `git add -A`→`git commit -m "refactor(y3): 删 /execution 命名空间——通知退场 Feed/轮询/REST 单通道"`（body 录双端 grep 零命中+两池基线数+E64 复跑）。

### Task 9: 批末收口（主会话）

- `pnpm verify`（全量 36 步）+E56 复核锚（connection-supervisor routeClose 单源——只读确认零改动）+census/行数锚类门禁按批同步（execution.gateway/collab-doc-registry 行数锚若有）→ledger/记忆收口→push=用户确认门（本地累计领先 origin：a746ca21/96fe4887/c268b890/784e28a3+两笔）。
