<!-- doc-status: active | created: 2026-11-15 | confirmed: 待确认（v1——依据 2026-11-15 TD-32/33 双审报告〔P1×1+Important×6〕起草；全部锚点已对 HEAD=156f9c6a 实核） -->
# TD-32/TD-33 双审修复批 Implementation Plan v1

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers test-driven-development（每任务红-绿-重构）；步骤用 checkbox 跟踪。
**Goal:** 修复双审 P1（purge mark 后失败零 emit）与 6 项 Important（adopt 隔离复核/V28 计时空转化/TD-28 回归恢复/timer 名实对齐/覆盖缺口七例/gate 字符串口+台账登记）。
**Architecture:** 全部为既有机制的小修+测试补全，无新机制；spec 依据=docs/superpowers/specs/2026-11-14-ci-intermittent-two-card-fix-design.md（v16）既有条款（P1 即 spec §3.3.3 钉死行为），修复不扩面。
**Tech Stack:** NestJS/vitest/prom-client/Node scripts。
**Spec:** 2026-11-15 双审报告（本会话）+ spec v16 §2.2/§3.3.3/§3.4/§4.2.5/§5。

## Global Constraints

- TypeScript strict；superpowers TDD；精准修改——只动本表文件；行号锚=HEAD 156f9c6a，开工前重新 grep 符号定位。
- **不做（Minor 已登记不阻塞）**：Z79 负向断言恢复/wantsEphemeral trim/drill.http 回退 0/2s 兜底 timer 清/GC symlink/load·refresh 互斥闸/drop 重扫性能/runtime 防 stop/purge 容量重算延迟。
- 单笔 fix commit 收口（评审修复批同型，C3b-5 先例）；三命令=api typecheck+api 单测池+scripts-node-test。
- 覆盖补全类任务（F3/F4/F5/F7）预期绿；红=意外真回归，**停下呈报根修，不得删断言迁就**。

## Review Focus（双审已证五类失效面→任务映射）

1. purge mark 后中途失败：错误对象带 marked 集但 finally 不读→零 emit → **F1**
2. adopt 收录面：链外读窗内 switchGeneration 原地隔离→复核三条件全过→收养复活 → **F2**
3. 非 blocked 档收割梯原语义（TD-28 回归价值）被改写丢失 → **F3**
4. timer「shutdown 清/rejoin 重启」宣称未断言 → **F4**
5. release 路径（非 isolate）initDone 复位→重扫零 dup 无直测 → **F5g**

---

### Task F1（P1）：purge 端点 mark 后失败仍 emit

**Files:**
- Modify: `apps/api/src/modules/collab/collab-write.controller.ts:80-91`
- Test: `apps/api/src/modules/collab/collab-write.controller.purge-emit.spec.ts`

- [ ] **Step 1: 红测**——purge-emit.spec 新增第 4 例「mark 后中途失败→仍 emit 一次+错误上抛」：`spool.purgeErasureScope` mock 为 `async () => { const e = new Error('unlink boom'); Object.assign(e, { markedProjectIds: ['p1'] }); throw e; }`；断言 `rejects.toThrow('unlink boom')` 且 `events.emit` 恰一次、载荷 `{ projectIds: ['p1'] }`。
- [ ] **Step 2: 跑红**——`pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab-write.controller.purge-emit.spec.ts` → FAIL（emit 零调用——现 finally 只读成功路径局部变量）。
- [ ] **Step 3: 修复**——controller `try` 后加 catch：`markedProjectIds = (e as { markedProjectIds?: string[] }).markedProjectIds ?? markedProjectIds; throw e;`（finally 单 emit 点不动；service 侧 :2163 挂集不动）。
- [ ] **Step 4: 跑绿**——同 Step 2 命令 → 4 例全 PASS。

### Task F2（Important-1）：adopt 链内复核补隔离态

**Files:**
- Modify: `apps/api/src/modules/collab/collab-spool.service.ts:800`
- Test: `apps/api/src/modules/collab/collab-spool.service.spec.ts`（adopt 族旁）

**Interfaces:** 复核谓词镜像收录谓词 ：788（`segQuarantined != null && !== 'chain-stopped'` 拒）。

- [ ] **Step 1: 红测**——「adopt×switchGeneration 交叉：读暂停窗内换代隔离→链内复核拒」：外来段装置沿 wal.spec:62-66 形态（`buildOwnerName(hostname(), <死 pid>)`+isPidAlive→false 子类）；子类暂停缝挂 `readSegmentFile`；暂停内 `await spool.switchGeneration(pid)`（adopt 在链外暂停，同 pid 链空闲——原地 `m.segQuarantined='generation-switch'`+sidecar 落盘）；放行收养链。断言：index meta 仍 `foreign===true` 且 `segQuarantined==='generation-switch'`、`walSeqCounters` 未被抬、quarantine sidecar 文件存在。
- [ ] **Step 2: 跑红**——vitest run 该 spec → FAIL（现复核三条件全过→按链外快照收养写 `segQuarantined: null`）。
- [ ] **Step 3: 修复**——:800 复核追加一项：`|| (cur.segQuarantined != null && cur.segQuarantined !== 'chain-stopped')`。
- [ ] **Step 4: 跑绿**——含既有 adopt 族（:661-755）全 PASS（既有用例不含该交错=不红）。

### Task F3（Important-5）：TD-28 回归价值恢复

**Files:**
- Test: `apps/api/src/modules/collab/collab-doc-lifecycle.spec.ts`（:424 TD-33 案后新增）

- [ ] **Step 1: 回植**——从基线 `git show e1bb92fa:apps/api/src/modules/collab/collab-doc-lifecycle.spec.ts`（TD-28 regression 段）整段回植为独立用例，命名标注「TD-28 regression（非 blocked 路径——TD-33 语义迁移后保留）」：spool 播帧→`project.gone`→`persistRetryHas('project:p-gone2')` 真+裸 pid 键假+`timer` 真值→`gf.retryPersist` 实耗→`hasFrames` false+`repo.appendBatch` 四参形态断言。现 spec 的 ：424 blocked 案保留不动。
- [ ] **Step 2: 跑**——预期绿（现判序 blocked 先判，非 blocked 档回排梯原语义）；**若红=真回归停下呈报根修**。

### Task F4（Important-4）：timer 用例名实对齐

**Files:**
- Test: `apps/api/src/modules/collab/collab.gateway.spec.ts:1966-1980`

- [ ] **Step 1: 补断言**——「timer 生命周期」用例体在 isolate 停（:1977）后追加：①`await gf.startCollabAfterLease()` → `erasureRuntimeRunning()` true（rejoin 重启）；②`await kit.gateway.onApplicationShutdown()` → false（shutdown 清）。用例名不变（名实从此一致）。
- [ ] **Step 2: 跑**——预期绿（行为 :1125/:1164 已在）；红则根修。

### Task F5（Important-3）：覆盖缺口七例

**Files:**
- Test: `apps/api/src/modules/collab/collab-spool.service.spec.ts`（5a/5b/5c/5d/5f）、`collab-erasure-registry.service.spec.ts`（5e）、`collab.gateway.spec.ts`（5g）

- [ ] **Step 1: 写七例**（形态沿同文件既有用例）：
  - 5a 「sweep 失败计数+下轮重试清空+bytes 回落」：spy `dropSpoolProjectState` 首轮 throw 一次→`sweepPurgeableSpoolLive`：`purge_sweep_failures_total` delta=1+段留；还原后二轮→段清+`purgeable_spool_bytes` 回 0。
  - 5b 「全状态清后新 projectId：seq 正确+无 dedup 假命中」：清 p1 后新 pid 写**同字节帧**→非 dedup 早退（返回长度 1+全新 walSeq）+落盘。
  - 5c 「boot index 空+盘上 purgeable 段→扫盘清除」：新 svc 实例（index 空）+盘上 p1 段+live src→`sweepPurgeableSpoolOnLoad` 后 p1 段零。
  - 5d 「坏段∧blocked→不挡 boot」：:1011 用例富化——p1 预置截断坏段再 `recoverScan(exclude p1)`→不抛+report 不含 p1+文件保留+计数 delta。
  - 5e 「age 增长/回落」：:95-110 refresh 失败用例富化——`erasure_registry_age_ms` delta>0；恢复轮后 age 回落。
  - 5f 「IO 计账补断言」：IO 失败×5 熔断档补 capture spy 被调 ≥1；新增「成功重置」例（4 失败→成功→再 4 失败不熔断、第 5 失败才熔断）。
  - 5g 「start-failed release→re-acquire 重扫零 dup」：T17 直构 gateway 形态（requireSystemHistory 首轮抛**非端口**错→catch :1045 release 分支）；断言 `isInitDone()` false；同根另一 spool 句柄写入（B 形态）；systemHistory 复原后 `startCollabAfterLease()`→recoverScan 重跑+`appendTracked` seq>磁盘最大段+零 dup。5s 重试 setTimeout 沿 T17 既有处理（fake timers/直接再调）。
- [ ] **Step 2: 跑**——七例全绿（覆盖补全）；红=意外发现停下呈报。

### Task F6（Important-2）：V28 接管计时还原

**Files:**
- Modify: `apps/api/scripts/collab-kill9-drill.ts:429-469`

- [ ] **Step 1: 重构测量**——非 usurp 分支：`t0` 移至 terminate 语句（signal/kill）紧后；原 ：452 轮询改为**立即启动的并发 promise**（本地 measure helper：8s 窗轮询 leaseRow/readyOf，返回 `{acquiredAt,readyAt,bEpoch}`），与 `destroy()/waitExit(A,30s)/B.waitCollab(15s)` 并发执行，join 后按 t0 断言（acquireBudget graceful 4s/kill9 3.5s+ready ≤8s+epoch 恰 +N）。:447-451 SV12 注释更新一句：graceful drain 22s 窗内 B 已 CAS——测量必须与 waitExit 并发否则虚高（原注释推理恢复适用）。usurp 分支零触碰。
- [ ] **Step 2: 实跑验证**（drill 装置无单测面）：`pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=handover` 与 `--mode=handover --graceful`——日志 acquiredAt/readyAt **非 0** 且 ≤ 预算（修复前恒≈0——双审已证）。

### Task F7（Important-6）：gate §3 字符串口+台账

**Files:**
- Modify: `scripts/check-no-random-ports.mjs:20`、`scripts/check-no-random-ports.test.mjs`、`docs/superpowers/tech-debt.md`

- [ ] **Step 1: 正则扩**——FIXED_LISTEN 扩字符串形态：`\.listen\(\s*['"\`][1-9][0-9]{1,4}['"\`]\s*[,)]`（已核全仓零命中——gate 保持 PASS）。
- [ ] **Step 2: 自测补例**——正例 `server.listen('3001')` 命中、放行例 `listen('0')`。
- [ ] **Step 3: 台账**——tech-debt TD-32 节尾部登记 §1 宽正则已知边界（反序 `Math.floor(...)+M`/round·ceil·~~ 变体/crypto.randomInt/跨行拆分——**维持原正则防零 allowlist 误报**，裁定留痕）。
- [ ] **Step 4: 跑**——`node scripts/check-no-random-ports.mjs` → PASS；`node scripts/check-no-random-ports.test.mjs` → 全绿。

### Task F8：出口收口

- [ ] 三命令：api typecheck+`pnpm --filter @flowweb/api test`（全量单测）+scripts-node-test（manifest 列举≡磁盘——F7 自测已登记文件无新增）。doc-gate（tech-debt 尾部追加无行号锚漂移）。
- [ ] 单笔 commit：`fix(collab): TD-32/33 双审修复——P1 purge mark 后失败 emit+Important×6（adopt 隔离态复核/V28 接管计时还原/TD-28 回归恢复/timer 名实对齐/覆盖缺口七例/gate 字符串口+宽正则边界台账）`。
- [ ] push 后 CI 绿确认（补强 tech-debt 核销观察期判据）；双审记忆更新（td3233-batch-dual-review 补修复批笔）。
