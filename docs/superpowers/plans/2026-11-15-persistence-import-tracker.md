<!-- doc-status: active | created: 2026-11-15 | confirmed: 2026-11-16（用户确认 v2——v1+第六轮执行口径评审七项 delta 落档；spec/机制零改动；**不开工——待用户指令**） -->
# persistence 结构性收口（ImportCoverageTracker 抽取）Implementation Plan v2

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers test-driven-development（每任务红-绿）；步骤用 checkbox 跟踪。
> **Goal:** importPending 生命周期收敛为零依赖 ImportCoverageTracker（单一所有者+落定谓词单源+settle 全触点直接断言），并根修 FK 终态 wart（已删项目不再入队 rebuild/不广播 healthy）。
> **Architecture:** 纯状态机叶子 tracker + persistence 薄落定入口 `releaseImportCoverage`（FK 守卫→短路→release→enqueue 同体）；9 物理点委托/改名；replay :1010 enqueue 行零触碰。零行为变化唯一例外=FK 终态守卫（⑨ 红先行+commit 披露）。
> **Tech Stack:** NestJS/vitest/node scripts（check-collab-module-size/census）。
> **Spec:** docs/superpowers/specs/2026-11-15-persistence-import-tracker-design.md（**v5**——机制/用例语义/锚纪律以 spec 为准，本 plan 只任务化）。

## Global Constraints

- TypeScript strict；superpowers TDD；精准修改——只动本表文件；行号锚=HEAD ea77bd0b，开工前重新 grep 符号定位。
- **红绿序硬门**：P2 ①-⑧=characterization（**现码必绿**——红=意外真回归停下呈报，禁删断言迁就）；P3 ⑨=红先行（**现码必红**——若绿=装置错或 wart 已变，停下呈报）；P4 后 ①-⑨ 全绿。
- **既有 C1 族（collab-persistence.service.spec.ts :164-296）+ int ①-⑤ 零删改**；C1 测试标题不动。
- **int 无静默跳过**：int spec 在无 DATABASE_URL 时 `describe.skip` 静默——命令形态按实际执行 shell（本 harness=Git Bash，**bash prefix 形态实证可用**：`DATABASE_URL=... pnpm ...`；PowerShell 形态 `$env:` 仅 pwsh 适用）；**硬门=输出必须「5 passed」非 skipped**（全套=实跑数核对），注入失效即停。
- **单笔 commit 收口**（P6；P1-P5 不提交）；跑 verify 前先 `git add` spec/plan/全部改动（verify-chain ⑤ 硬门）。
- **行数口径**：净变化按 **−2 左右**预期（紧贴 1242）——实测 **>1242 先删本卡新注释空行复测、仍超才停卡排查（禁抬锚）**；净减 <5 不阻断但 commit 不写容量收益。
- **守卫内禁调 onProjectGone**（会删不健康电平致 ⑨ 假红+误排收割梯——spec v5 守卫代码本就未调，钉死）；帧循环 FK 分支保持按帧 `continue` 收割不改 break。
- 不做清单=spec §6（不加 inFlight 门/不动 replay :1010/无 gauge·size()/不动 isPersistedComplete·writesSettled/不抽片 2 3/不动 SG 与其余 16 锚文件）。
- **P6 Step 7（push）=确认门**：执行到 Step 6 单笔 commit 为止，收口证据呈报后按用户当轮确认再 push+CI。

## Review Focus（五类失效面→任务映射）

1. settle 调用点改名中丢调用（尤其 :1090 全仓零历史覆盖）→ **①-⑨ 逐点直断**（P2/P3/P4）
2. replay enqueue 无条件性破坏（误并/移位/改条件）→ **⑤ 两阶段**+P5 `git diff -U0` :1010 字节核对
3. FK 已删项目入队/假 healthy（wart 未修或 ⑨ 误写成现状断言锁死/装置 vacuous 绿）→ **⑨ doc 在场装置**（P3）+守卫双点（P4）
4. 落定谓词误收三态（inFlight 耦合回归）→ **⑧**+importBytesLanded 禁令注（P4）
5. 锚自测 8 处漏改/抬锚绕行/门禁不同步/历史锚注释被误改 → **P6**（>1242 应急序；.mjs:22 链仅尾追）

---

### Task P1：ImportCoverageTracker 单测红先行（spec §4-T1）

**Files:**
- Create: `apps/api/src/modules/collab/collab-import-tracker.ts`
- Test: `apps/api/src/modules/collab/collab-import-tracker.spec.ts`（新）

**Interfaces（P4 消费）:**
- `ImportCoverageTracker`：`mark(pid)`（幂等）/`isUncovered(pid): boolean`/`release(pid, landed: boolean): boolean`（=landed∧pending.delete）/`forget(pid)`。头注契约=spec §3 代码块**逐字**（进程内窗口/持久权威=bindingsDirty+boot :1005-1010 直连不经 :480 face/两变体禁合并/purge 不清/landed 单源 importBytesLanded）。

- [ ] **Step 1: 写测（先只有测试文件）**——7 例：①初始未标记（isUncovered=false；release(true)=false 零清除）②mark 幂等 ③release(pid,false)=false 且保持 ④release(pid,true)=true 且清除 ⑤恰一次（清除后二次 release(true)=false）+forget 后再武装（forget→mark→release(true)=true）⑥forget 终态（未标记 no-op）⑦跨项目隔离（A 的 release 不影响 B）。
- [ ] **Step 2: 跑红**——`pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab-import-tracker.spec.ts` → FAIL（模块不存在）。
- [ ] **Step 3: 实现**——spec §3 tracker 代码块逐字落地（零依赖、全同步、零定时器）。
- [ ] **Step 4: 跑绿**——同 Step 2 → 7 例 PASS。

### Task P2：int 基线 + characterization ①-⑧（spec §4-T2 前半）

**Files:**
- Test: `apps/api/src/modules/collab/collab-persistence.service.spec.ts`（新 describe「卡① wiring：settle 全触点 characterization」——装置沿 C1 族 :150-296 形态：createMockRepo/spoolForTest/makeHost/PID/NAME/SERVER_TRANSACT_ORIGIN；enqueue spy 经 setBindingRecoveryFace 注入）

**Interfaces（装置契约——九例只调两个 helper，P4 Step 3 只换 helper 内部）：**
```ts
function importUncovered(svc: CollabPersistenceService): boolean {
  return (svc as unknown as { importPending: Set<string> }).importPending.has(PID);   // P4 后 → importTracker.isUncovered(PID)
}
function settle(svc: CollabPersistenceService): void {
  (svc as unknown as { settleImportPending(id: string): void }).settleImportPending(PID);   // P4 后 → releaseImportCoverage(PID)
}
```
- describe 顶部两 helper；**afterEach 加 `svc.cancelAllRetries()`**（⑥ 失败支重排 1s 梯——防定时器跨例污染 enqueue 计数）。

- [ ] **Step 1: int 基线**——`DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api run test:int -- src/modules/collab/import-maintenance-coverage.int.spec.ts`（本 harness Git Bash 形态；pwsh 下用 `$env:DATABASE_URL='...'` 前置）→ **输出必须「5 passed」非 skipped**——记录命令+输出为基线证据（skip=注入失效，停）。
- [ ] **Step 2: 写 ①-⑧（现状断言；读数/直调只经 helper）**——
  - **①discard 终态**：import 写（`Y.applyUpdate(doc, ..., 'import')`）→白盒 `deletedProjects.add(PID)`→`storeDocumentUnlocked` 返 false→`importUncovered(svc)` false∧enqueue 0 次（盖 :449/:308 路径）。
  - **②onProjectGone**：import 写→直调 `svc.onProjectGone(PID)`→importUncovered false∧enqueue 0（经 :1213 discard——**不断言 forget 次数**）。
  - **③retry 梯 :930（getDocument 恒 undefined 装置）**：import 写→`repo.appendBatch` mockRejectedValueOnce(pg 瞬态 pgPending)→store false（帧入 spool、队列已 splice、失败路径已排梯——**不 cancel，entry 须在**）→接 sink mock（resolve **且承接 actor 落定语义：预读 `spool.peek(PID)` 帧集→`spool.confirm`**——否则 spool 门挡 settle 断言）→白盒直调 `retryPersist(NAME)`→enqueue `toHaveBeenCalledTimes(1)`∧importUncovered false（**路径钉死：doc 不活+队列空+spool 有帧=detached 帧通道；doc 活且队列非空会落 :421**）。
  - **④handoffPendingToSpool 两形态（queue 必须非空——空队列早退 true 不 settle）**：成功=import 写入队（无 spool 帧）→sink resolved→`handoffPendingToSpool(PID)` true→enqueue 恰一次（:1063）；未清=先经 pg 瞬态失败播种 spool 帧+cancel 梯+再入队一批→sink resolved（不 confirm 旧帧）→handoff true 但 spool 未清→enqueue 0∧importUncovered true。
  - **⑤replay 两阶段**（replayAll 每项目 projectReplayed>0 调一次 onReplayed）：装置沿 C1 #2（:269-296）阶段 A/B→白盒 `reconcileSpool()`——**阶段 A**（spool+队列均空）：enqueue `toHaveBeenCalledTimes(1)`∧importUncovered false（锁「落定后不双入队」）；**阶段 B**（回灌前预置未 flush 维护写入队）：enqueue **仍恰一次**∧importUncovered true（锁「有残留也先入队」）。既有 :269 弱断言零动。
  - **⑥handoffOnUnload 两支（:1090 全仓首覆盖）**：成功=queue 非空+sink resolved→`await svc.handoffOnUnload(PID, NAME)`→enqueue 恰一次；失败=sink 抛非 pgPending（pre-WAL）→importUncovered true∧enqueue 0。
  - **⑦purge 负测**：import 写→`svc.purgePersistenceState(PID)`→importUncovered 仍 true **∧ enqueue 0 次**（「不清+无人入队」双锁）。
  - **⑧inFlight 不阻挡**：import 写→白盒 `pendingQueues.get(PID).splice(0)`（模拟并发取批）+`inFlightProjects.add(PID)`→`settle(svc)`→enqueue 恰一次∧importUncovered false。
- [ ] **Step 3: 跑绿**——`pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab-persistence.service.spec.ts` → 新 8 例+既有全 PASS（**红=意外真回归停下呈报**）。

### Task P3：⑨ 红先行——FK 终态守卫（spec §0.4-1；唯一有意行为变化）

**Files:**
- Test: 同 P2 describe（第 9 例）

- [ ] **Step 1: 写 ⑨（期望态断言——非现状；doc 在场装置抓广播面）**——
  - 装置序：import 写→appendBatch pg 瞬态失败播种 spool 帧（失败路径已排梯，**禁 cancel——!entry 早退会让守卫测 vacuous 绿**）→白盒预置不健康电平 `persistUnhealthy.add('project:'+PID)`（=projectDocName(PID)=persistKey(NAME)）→**rebindHost：getDocument 返回 `{ broadcastStateless: vi.fn(), connections: new Map() }`**（doc 在+队列空⇒:882 条件假⇒仍走 detached 帧通道，且 setPersistStatus(true) 会向活 doc 广播）→接 sink 逐帧抛 `Object.assign(new Error('fk'), { fk: true })`（**mock 不 confirm——:919 分支自 confirm**）→白盒直调 `retryPersist(NAME)`。
  - **红面三条（现码必红）**：enqueue `toHaveBeenCalledTimes(1)` 反例（现码恰一次）、`broadcastStateless` 收到 `{"type":"persist-status","healthy":true}`、电平键被删。
  - **绿面（修后期望）**：enqueue 0 次∧broadcastStateless 0 次∧importUncovered false∧电平键仍在。
  - 与 ③ 不共用 sink（③ getDocument=undefined+sink 自 confirm；⑨ doc 在场+sink 纯抛）。
- [ ] **Step 2: 跑红**——P2 Step 3 命令→⑨ FAIL（三红面至少 enqueue/电平两条成立即目标——wart 实证）；若绿=装置错，停下呈报。
- [ ] **Step 3: 持红进 P4**——⑨ 与 P1-P2 同批在 P4 收绿（不单独 commit）。

### Task P4：接线改写（spec §3 全表）

**Files:**
- Modify: `apps/api/src/modules/collab/collab-persistence.service.ts`（:226/:449/:568-585 整段/:593/:421/:930/:1063/:1090/:1009-1017/:1207/文件头 :4/retryPersist 成功尾 :931-932）
- Modify: `apps/api/src/modules/collab/collab.gateway.ts:465`（**单行原位替换**——gateway 实测 1221/1225 有余量但不消耗）、`apps/api/src/modules/collab/collab-recovery-import.service.ts:301`（**只替换含旧字段那一句，下一行「本服务仅保留前置 markDirty」保留**——未入锚仍保持行数不变）

**Interfaces:** 消费 P1 `ImportCoverageTracker`；产私有 `importBytesLanded(projectId): boolean`/`releaseImportCoverage(projectId): void`。

- [ ] **Step 1: 改写（逐项=spec §3 表）**——**旧 :568-585 整段删除**（importPending 字段+两段文档注释+settleImportPending 方法——契约只存 tracker 头注与 releaseImportCoverage 头注**两处，禁三处并存**）；新增字段 `importTracker`/`importBytesLanded`（inFlight 禁令注随体）/`releaseImportCoverage`（FK 守卫→isUncovered 短路→release→`bindingRecoveryFace?.enqueue`；face-null 豁免注；**守卫禁调 onProjectGone**）；:226 mark/:449 forget/:593 isUncovered/:421·:930·:1063·:1090 四处单行改名/:1014-1016 缩一行（**:1010 enqueue 行与 :1011-1013 注释零触碰**）/:1207 删除（onProjectGone 头注补一行「终态清单点=discardForGoneProject〔自文档唯一必然执行点〕」）/retryPersist 成功尾 cancelPersistRetry 后加 `if (this.deletedProjects.has(projectId)) return;`（跳过假 healthy）/文件头 :4 改「行数锚以 SIZE_LIMITS 为准」/两处接线注释按 spec §3 表文案。
- [ ] **Step 2: 跑绿**——P2 Step 3 命令→**①-⑨+全量 persistence spec PASS**（含 C1 族 :164-296 零删改）；P1 Step 2 命令→tracker 7 例 PASS。⑨ 仍红=守卫/跳过实现错，修至绿。
- [ ] **Step 3: helper 内部替换**——P2/P3 两 helper 内部：`importPending.has`→`importTracker.isUncovered`、`settleImportPending`→`releaseImportCoverage`（**仅 helper 体内两处——九例断言/spy/路径零动**）→重跑绿。

### Task P5：残留扫描+实测披露（spec §4-T2 末段）

- [ ] **Step 1: 三口径扫描**——①`grep -in "importpending" apps/api/src/modules/collab/collab-persistence.service.ts`=**0 命中**；②`grep -rn "settleImportPending" apps/api`=**0**（**范围=apps/api——scripts/check-collab-module-size.mjs:22 锚注释链为 13 次上抬审计原文，禁改**）；③`grep -n "bindingRecoveryFace?.enqueue\|bindingFace.enqueue" apps/api/src/modules/collab/collab-persistence.service.ts`=**恰 2 处**（releaseImportCoverage+onReplayed）。任一不符→修后复跑 P4 Step 2。
- [ ] **Step 2: 字节核对**——`git diff -U0 apps/api/src/modules/collab/collab-persistence.service.ts` 核对 **:1010 enqueue 行与 :1011-1013 注释行不在 diff 中**（字节未变）。
- [ ] **Step 3: 实测披露**——Z96 计法实测 persistence 行数（`node -e "const c=require('fs').readFileSync('apps/api/src/modules/collab/collab-persistence.service.ts','utf8');console.log(c.replace(/\n$/,'').split('\n').length)"`）→回填 spec §5 披露位；**>1242 应急序：先删本卡新注释空行复测→仍超停卡排查（禁抬锚）**。

### Task P6：锚+出口+单笔 commit（spec §4-T3）——**push 为确认门**

**Files:**
- Modify: `scripts/check-collab-module-size.mjs`（SIZE_LIMITS 新条目+persistence 值+:17 头注+:22 注释链）
- Modify: `scripts/check-collab-module-size.test.mjs`（8 处）

- [ ] **Step 1: 锚自测 8 处同批**——.mjs：新条目 `'apps/api/src/modules/collab/collab-import-tracker.ts': <ceil(实测×1.3)>`（注释「卡① 新文件入锚（实测 X+1.3 余量）」）+persistence 值→P5 实测（:22 注释链**仅尾追**「→卡① <X>（-N：ImportCoverageTracker 抽取+FK 终态守卫——**反向收紧**，13 次上抬后首次）」——历史句子禁改）+:17 头注「十三文件」→「十八」+新文件补列；test.mjs：:51/:53/:97「十七」→「十八」、:55 `keys.length` 17→18、追加 `keys.some(k=>k.endsWith('collab-import-tracker.ts'))` 断言、追加新条目精确值断言、:81 persistence 值→实测。
- [ ] **Step 2: 门自跑**——`node --test scripts/check-collab-module-size.test.mjs` PASS；`node scripts/check-collab-module-size.mjs` PASS；`node scripts/check-collab-census.mjs` PASS。
- [ ] **Step 3: 全量单测**——`pnpm --filter @flowweb/api test -- --run` → 全绿。
- [ ] **Step 4: int 全套**——`DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int`（去掉文件过滤参数）→ 全套绿（**实跑数核对非意外 skip**；flake 单文件复跑定性并记录命令/环境/结果——禁跳过/静默过滤）。
- [ ] **Step 5: verify full**——`git add`（spec/plan+全部代码与锚文件）→`pnpm verify` → **36/36**。
- [ ] **Step 6: 单笔 commit（本批终点）**——消息含：实测行数差（1242→X，净 -N）+int 全套实跑数+锚反向收紧依据+**「已删项目不再从落定入口入队 rebuild，也不再广播 healthy」行为变化披露**（spec §0.4-1）。
- [ ] **Step 7: push+CI（确认门——非自动执行）**——Step 6 完成后**停**：收口证据（实测/int/verify/commit）呈报用户→**当轮明确确认后** `git push origin master`→REST 轮询 GitHub Actions（7890 代理）→test job 绿（红则按既有 flake 判定流程处置）。
