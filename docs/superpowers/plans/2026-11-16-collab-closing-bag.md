<!-- doc-status: active | created: 2026-11-16 | confirmed: 2026-11-16（用户确认 v9 开工——依据 spec v12 十一轮终审机制终态） -->
# 卡② 收口袋 Implementation Plan v9

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers test-driven-development（每任务红-绿）；步骤用 checkbox 跟踪。
> **Goal:** 八项收口袋——三枚指标（import 覆盖 gauge/backfill_remaining scrape 化/barrier 拒绝计数）+两处装置（drill settle/sentry mock×2）+端口门两洞+备份权威文档+Minor×8 销项档。
> **Architecture:** 唯一机制项=K8 删除 shadow 双轨+**认领拍 fence 化（cohort 规范化+四规则+一拍一段+进程内退避）**（第二引用面退役——删除判决三层零动：unionRefs/unionFace/in-tx recheck/decideTeamReferenceSnapshot 九腿不动；唯一例外=擦除认领拍纳入 prepare 围栏——认领写与删除写同门），其余零机制变更；**每任务=一个独立 commit+独立评审**（提交序=spec v12 §2）；锚原则=余量没用完不改锚（全卡唯一抬锚=persistence 1241→1242）。
> **Tech Stack:** NestJS/vitest/prom-client/node scripts/node --test。
> **Spec:** docs/superpowers/specs/2026-11-16-collab-closing-bag-design.md（**v12**——逐项修法/验收/红测以 spec 为准）。

## Global Constraints

- TypeScript strict；superpowers TDD；精准修改——只动本表文件；行号锚=HEAD 6cf7c7f4，开工前重新 grep 符号定位。
- **红绿序**：适用项红测先行跑红再实现；int 用例改动=纯判决面既有断言零删改（shadow 族/docScan 断言例外——spec v12 §1.5 钉死随删/改写；**E2/E3 断言一字不改且必须绿**）；**int 命令显式带** `DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb`（Git Bash prefix 形态实证可用）+**输出实跑数核对非 skipped**。
- **锚原则**：persistence 1241→1242（K6 唯一抬锚，.mjs+.test.mjs 两处断言同 commit）；tracker（17→18≤23）/gateway（1221→1223≤1225）/deletion-barrier.metrics（15→~21≤25）用余量；runner（271）/binding-rebuild（273）/media-reference（231）净缩不抬；media-gc/stages/binding-reconcile.metrics/env.ts 未入锚。
- **指标纪律**：指标三 commit（K6/K7/K8）各 `node scripts/check-spec-consistency.mjs --write-metric-names` 同 commit+`pnpm verify`（full）；无 team/personal/项目 id 标签；直接替换/删除不留旧名。
- 跑 verify 前先 `git add`（verify-chain ⑤）；**push=确认门**（K8 批末收口呈报后按当轮确认）。
- 不做=spec v12 §3（唯一机制项=K8 删除+认领拍 fence 化；删除判决三层零动〔唯一例外=认领拍同门〕；@flowweb/shared collectMediaRefs/collectMediaRefsForNode 投影器单源零动；不重建 PITR/不引 AST/不改 claimMediaForDeletion 的 deletionRequestedAt 同 run 刷新语义/卡外不夹带）。

## Review Focus（五类失效面→任务映射）

1. 端口门数字分支误报面（census 表/合法 String() 形态/六位数误拦）→ **K2 六红测**（含尾边界+路径分类双断言+全仓门 PASS 实跑）
2. 锚纪律破口（多抬/漏改锚断言）→ **K6**（唯一抬锚；.mjs 注释链条目+test.mjs :81 同值同 commit）
3. 指标 catalog 漂移（--write-metric-names 漏跑/删表漏项）→ **K6/K7/K8**（各 commit 内固定序：改指标→write-metric-names→verify full）
4. int 串扰（②/①/⑧ 绝对值互串）→ **K7**（三条全 delta；② 锁定=1——实跑不符修 inc 位置不修断言）
5. shadow 删除破面（判决面误动/**认领时序+窗口重置+E2 抢回+E2 计数/一拍一段**〔claim :443 先于 prepare :456+③ 波动重写 markAt+:521 整份 claim 抢回+差集计数拆档+同拍串段——cohort 规范化+四规则+一拍一段根修+认领门红测十条腿（腿⑨含退避）〕/**shared collectMediaRefs 同名误删**/孤儿残留〔端点/客户端/env 开关/**census 两条目**/auth 放行行/spec 断言/孤儿符号/**注释四处**〕/oracle 臂保护钉缺失）→ **K8**（删除清单逐项 grep 自证+残留 grep 扩充零命中+安全钉+⊆ 契约测试+认领门红测十条腿+runbook §13.3〔含 :664〕+census 两条目同 commit）

---

### Task K1：spec v12 入库+TD 台账索引（commit ①）

**Files:**
- Modify: `docs/superpowers/specs/2026-11-16-collab-closing-bag-design.md`（doc-status→confirmed）
- Modify: `docs/superpowers/tech-debt.md`（TD-33 条目邻位加一行索引）

- [ ] **Step 1**: spec doc-status 改 `confirmed: 2026-11-16（用户确认 v12——十一轮评审裁定全采纳）`。
- [ ] **Step 2**: tech-debt.md TD-33 条目（:185-192）邻位加索引行：「双审 Minor×8 处置（2 销项/2 移出/4 无源句无实现——不处置不登记，重提须带源句+文件行号）→ `specs/2026-11-16-collab-closing-bag-design.md` §4——2026-11-16 卡②」。
- [ ] **Step 3**: `git add` 两文件→commit `docs(collab): 卡② 收口袋 spec v12 入库+Minor×8 销项台账索引`（pre-commit 自动跑 verify fast）。

### Task K2：端口门引号+数字洞（commit ②）

**Files:**
- Modify: `scripts/check-no-random-ports.mjs`（:20/:21 两正则+文件头注）
- Test: `scripts/check-no-random-ports.test.mjs`

- [ ] **Step 1: 红测六条先行**——①`` listen(`3001`) `` 命中 ②`` listen(`0`) `` 放行 ③`COLLAB_PORT: "3001"` 与 `` COLLAB_PORT: `3001` `` 命中 ④`` listen(`${port}`) `` 不命中 ⑤`COLLAB_PORT: 3001`（无引号）命中+**`COLLAB_PORT: 123456` 不命中（尾边界）** ⑥路径分类双断言：`scanSource('apps/api/src/x.spec.ts','COLLAB_PORT: 1',{section:3})`=1 命中+`scanSource('scripts/check-collab-census.mjs',同文本,{section:3})`=零命中。→ `node --test scripts/check-no-random-ports.test.mjs` 跑红。
- [ ] **Step 2: 实现（完整正则终态，第九轮——不写改造指令写终态）**——FIXED_LISTEN=`/\.listen\(\s*(?:['"\`][1-9][0-9]{0,4}['"\`]|[1-9][0-9]{0,4}(?!\d))\s*[,)]/`（无引号档 `(?!\d)` 尾界+整体 `\s*[,)]` 收尾；引号档闭引号后同接 `\s*[,)]`）；FIXED_COLLAB_ENV=`/COLLAB_PORT:\s*(?:['"\`][1-9][0-9]{0,4}['"\`]|[1-9][0-9]{0,4}(?!\d))/`；头注改扫描范围声明（§3=testish 文件数字字面量端口档；生产入口/drill/census 不在 §3）+「引号档不匹配 6 位数字（非合法端口形态）」句。
- [ ] **Step 3: 绿+门自跑**——`node --test scripts/check-no-random-ports.test.mjs` PASS+`node scripts/check-no-random-ports.mjs` 全仓 PASS→commit。

### Task K3：备份权威文档（commit ③，纯文档）

**Files:**
- Modify: `docs/superpowers/full-stack-backup.md`（§5）
- Modify: `docs/superpowers/collab-ops-runbook.md`（:809+§13 节首）

- [ ] **Step 1**: §5 拆两段——历史段保留 2026-11-11 证据路径+§5.2 六步正文；**当前段一句写死未启用**（来源=用户 2026-11-14 告知：硬件升级+系统重装，旧机 PITR+daily crontab 随重装清零）+重开条件（下次服务器窗跑完 §5.2 并留 `crontab -l`/`SHOW archive_mode` 证据文件后才允许改已启用）；:55 标题同步未启用。
- [ ] **Step 2**: runbook §13 节首（:604 邻位）升**横幅**「**2026-10-16 历史记录，2026-11-14 重装后不在役，勿照此操作**」+「在役状态以权威文档『当前』段为准」（:605-615 原文保留；**:616「自动首跑核对义务归片 B 执行窗首日顺手项」句写成作废**——不单靠节首时态句，第九轮；勘误：横幅落 runbook §13，full-stack-backup.md 无 §13）；:809 分句级替换——只换「（daily pg_dump 03:17，无 PITR——Y7 门槛项）」为权威文档指针，同段联动句零动。
- [ ] **Step 3**: 验收=矛盾消除+当前段无第三态+runbook 无现在时残留误导（diff 自审）→commit。

### Task K4：sentry mock 半径两文件（commit ④）

**Files:**
- Test: `apps/api/src/modules/collab/collab-spool.service.spec.ts`（:29-30 vi.mock）、`apps/api/src/modules/collab/collab-actor-erased.spec.ts`（:9 同款）

- [ ] **Step 1: spool 改造**——vi.mock 改 importOriginal 展开（照 `collab-canary-verify.c22b.int.spec.ts:30-33` 先例）：`{...actual, captureCollabException: spoolCapture}`（**同一 hoisted 函数**）；补断言：`scrubEvent` 仍为函数+`captureCollabException===spoolCapture`。→ `pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab-spool.service.spec.ts` 全绿（F5f 断言零动）。
- [ ] **Step 2: actor-erased 同款**——:9 改 importOriginal+同款断言（`capture` 同一 hoisted 函数）→跑绿。
- [ ] **Step 3**: 两文件绿（零生产代码改动）→commit。

### Task K5：drill 计时 Promise 所有权（commit ⑤）

**Files:**
- Modify: `apps/api/scripts/lib/drill-server-control.js`（+.d.ts）——settle 导出（全仓唯一实现）
- Test: `apps/api/scripts/drill-server-control.test.mjs`（settle 测试）
- Modify: `apps/api/scripts/collab-kill9-drill.ts`（非 usurp 分支测量块；usurp 零动）

- [ ] **Step 1: 红测先行**——补 settle 测试：拒绝通道（`settle(Promise.reject(new Error('boom')))`→`{ok:false,e.message==='boom'}`）/成功通道（`settle(Promise.resolve(42))`→`{ok:true,v===42}`）+监听卫生：`process.on('unhandledRejection', on)`→`await settle(...)` 后再等一个 `setImmediate`→断言零触发（**监听摘除放 finally——断言失败也不漏监听**，第九轮）。→ `node --test apps/api/scripts/drill-server-control.test.mjs` 跑红（settle 未导出）。
- [ ] **Step 2: lib 实现**——settle 判别式（spec v12 §1.6 代码形态）+.d.ts 类型行→测试绿。
- [ ] **Step 3: driver 接线**——测量体提成具名 async 函数；同拍 `settle(...)` 包裹（lib 导入不另写副本）；waitExit/waitCollab 后取结果；失败分支 `fail(e instanceof Error ? (e.stack ?? e.message) : String(e))`（第九轮归一）调既有 `fail()`；usurp 零动。
- [ ] **Step 4: 两腿实跑**——`DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=handover` 与+` --graceful` 双腿 `DRILL PASS`。
- [ ] **Step 5**: commit（消息留痕 settle 测试+两腿 PASS）。

### Task K6：backfill_remaining scrape 化+import 覆盖 gauge（commit ⑥，唯一抬锚）

**Files:**
- Modify: `apps/api/src/modules/collab/collab-import-tracker.ts`（+size()）、`collab-import-tracker.spec.ts`
- Modify: `apps/api/src/modules/collab/collab-persistence.service.ts`（+importPendingCount 一行）
- Modify: `apps/api/src/modules/collab/store.metrics.ts`（coverage Gauge+`yjs_metrics_collect_errors_total` Counter+reader 对）
- Modify: `apps/api/src/modules/collab/media-binding.metrics.ts`（backfill_remaining 改 reader 模式 async collect）
- Modify: `apps/api/src/modules/collab/collab-observability-wiring.ts`（两注册行+第 4 参 runner+头注）、`collab.gateway.ts`（import 同行+unregister×2+wire 调用行加参）
- Modify: `docs/superpowers/collab-ops-runbook.md`（告警判据两行 PromQL——Step 6 落盘；第十轮补 Files，消「只动本表文件」冲突）
- Modify: `apps/api/src/modules/collab/projection-backfill.runner.ts`（countCandidates 转公有+drain 末 set 删）、`projection-backfill.runner.spec.ts`（刷新面 describe 改写）
- Test: `apps/api/src/modules/collab/collab-metrics-observability.spec.ts`
- Modify: `scripts/check-collab-module-size.mjs`+`.test.mjs`（锚 1241→1242 两处+注释链）

- [ ] **Step 1: tracker size() 红先行**——spec 补断言（mark 1/`release(pid,true)` 0/`forget` 0）→跑红→加 `size(): number`→绿。
- [ ] **Step 2: 指标+接线**——store.metrics.ts：Gauge `yjs_import_coverage_open`（同步 collect；catch 保上次值+`inc({reader:'import_coverage'})`）+Counter `yjs_metrics_collect_errors_total`（labelNames ['reader']）+`registerImportCoverageReader` 对→media-binding.metrics.ts：`media_binding_backfill_remaining` 改 reader 模式（**updatesRows 族 async collect**；catch 不 set+`inc({reader:'bindings_backfill'})`——counter 自 store.metrics import；help 改「投影未收敛的画布数，一人团队与多人团队同一计数」）+`registerBindingsBackfillReader` 对（**collect 外包 2 秒上限——超时不 set+inc，第九轮**）→runner：`countCandidates` 转公有+`:160` drain 末 set 及 I-3r 注释删→wiring：签名加第 4 参 `runner: ProjectionBackfillRunner`，两注册行（coverage=`() => gw.persistence.importPendingCount()`；backfill=`() => runner.countCandidates()`）+头注→gateway：wire 调用行同行加第 4 参 `this.bindingBackfill`+`:10` import 加两 unregister 符号+shutdown 块 +2 行（1223≤1225）→persistence 加 `importPendingCount()` 一行。
- [ ] **Step 3: runner.spec 改写**——刷新面 describe（:41-73）改为「drain 零 COUNT/不触 backfill_remaining」（countCandidates mock 若被 drain 调用即红）。
- [ ] **Step 4: 锚**——persistence 实测 1242→`.mjs` SIZE_LIMITS 1242+注释链+`.test.mjs:81` 同值（runner 净缩 ≤271 不动锚）。
- [ ] **Step 5: Prometheus 红测**（**直接 `registerImportCoverageReader`/`registerBindingsBackfillReader`——updatesRows 同式，第九轮**）——observability spec：coverage——mark 1/`release(true)` 0/`release(false)` 仍 1/forget 0/unregister 后 0+**同步 reader 抛错→上次值在+`{reader="import_coverage"}`+1（新腿）**；backfill——stub runner.countCandidates 返 `Promise.resolve(3)`→刮值数字 3；reader 抛错→上次值在+`{reader="bindings_backfill"}`+1+**注销后刮 0（新腿）**。→跑绿。
- [ ] **Step 6**: `--write-metric-names`→**runbook 告警判据两行 PromQL 同 commit**（告警看 `rate(yjs_metrics_collect_errors_total[5m])` 速率、不看 keep-last 的 gauge）→`pnpm verify`（full 36/36）→commit。

### Task K7：deletion_barrier_append_rejected_total（commit ⑦，锚保持 25）

**Files:**
- Modify: `apps/api/src/modules/collab/deletion-barrier.metrics.ts`（Counter——import 行加 Counter 同行）
- Modify: `apps/api/src/modules/collab/canvas-doc-update.repository.ts`（:271 唯一拒绝 return 前加 inc）
- Test: `apps/api/src/modules/collab/deletion-barrier.int.spec.ts`（三层 delta 红测）

- [ ] **Step 1: 实现**——Counter（help「ACTIVE 窗内拒绝，帧留队，释放后落定；一次 appendBatch 事务计 1」；无 label；**JSDoc ≤3 行——文件停 25 行锚内**，第九轮）+repository `:271` inc。
- [ ] **Step 2: int 三层红测**（DATABASE_URL 前置，三条全 delta；**② 断言前显式排空该 team 的 actor 队列**——防残留队列产生第二次拒绝串扰 delta，第九轮）——**②** delta **锁定=1**（实跑不符修 inc 位置不改断言）；**①或任一非 ACTIVE 用例** delta=0；**⑧** 释放前 delta **≥1**。既有断言零动。→ `DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api run test:int -- src/modules/collab/deletion-barrier.int.spec.ts` 全绿（实跑数核对）。
- [ ] **Step 3**: `--write-metric-names`→`pnpm verify`（full）→commit。

### Task K8：删除 shadow 双轨+认领拍 fence 化（commit ⑧，唯一机制项）

**Files:**
- Modify: `apps/api/src/modules/media-delivery/media-gc.service.ts`（shadow 段+方法+常量 **:70-75 JSDoc 连注释**+docs 注入/import+:161 四参注释删改）
- Modify: `apps/api/src/modules/collab/project-erasure.stages.ts`（**认领拍 fence 化（cohort 规范化+四规则+一拍一段+退避）**+erasureOldFaceReferenced+旧面腿+docScanFailed+shadow 段+collector 契约删+**:4-5 文件头注 httpMediaRefsCollector 词面改写**）
- Modify: `apps/api/src/modules/collab/project-erasure.poller.ts`（**:31 import 两符号+:63-64 构造参数 JSDoc+:289 processProjectRun 头注**+注入 :62-64+缺省腿 :298 删）
- Modify: `apps/api/src/modules/collab/collab-write.controller.ts`（media-refs 路由 :56-64 删；purge-scope :73-82 不动）
- Modify: `apps/api/src/modules/collab/collab-spool.service.ts`（collectProjectMediaRefs 整段 :2286-2326+常量 **:159-163 整段 JSDoc 连 export 行**〔含 httpMediaRefsCollector :161+MEDIA_GC_DOC_SCAN_PAGE :163 双词面〕+MediaRefsDocsPort :165 起 JSDoc+:173-176 删）
- Modify: `apps/api/src/auth/auth.guard.ts`（:36-40 注释+谓词+:55 isPublic 链调用删——第八轮修正，漏 :55 即悬空引用）
- Modify: `apps/api/src/modules/collab/binding-rebuild.service.ts`（controlledRebuildForMedia+stale import 删）
- Modify: `apps/api/src/modules/media-delivery/binding-reconcile.metrics.ts`（mismatch/skip/stale 三指标删+头注同步）
- Modify: `apps/api/src/modules/collab/media-reference.service.ts`（skipBindingArm+ORACLE_ONLY 读腿删）
- Modify: `apps/api/src/config/env.ts`（MEDIA_REF_ORACLE_ONLY 删——env.spec 无该键用例，spec v8 勘误零动作）
- Modify: `scripts/check-collab-census.mjs`（**:1203-1204** media-reference 条目+**:1181-1184** stages PORT/WORKER_WRITE_TOKEN 条目删——均为 stale 红硬阻塞〔stages 内该两键直读点仅 httpMediaRefsCollector :91-92〕；**:1185** 注释同词改写，第九轮）
- Modify: `apps/api/src/modules/collab/project-erasure.cache.ts`（:102 注释 httpMediaRefsCollector 同词改写——残留 grep 命中面）
- Modify: `docs/superpowers/collab-ops-runbook.md`（§13.3 :664+:666-668 重写+回滚开关段删）
- Delete: `apps/api/src/modules/collab/dto/collect-media-refs.dto.ts`、`apps/api/src/modules/collab/project-erasure.media-refs.c4c1.spec.ts`
- Test: `apps/api/src/modules/media-delivery/media-gc.shadow.c3b5.int.spec.ts`（shadow 族断言随删+安全钉+⊆ 契约测试）、`apps/api/src/modules/collab/project-erasure.purge.c4c1.int.spec.ts`（fail-closed 用例 :339-361 替换为认领门红测十条腿+docScan 等式 :231/:438 改写；**E2/E3 :489-526 断言一字不改**）、`binding-rebuild.int.spec.ts`（回归跑——**无 controlledRebuildForMedia 用例，无「用例删」动作**，第九轮实证）、`media-deleting.int.spec.ts`（9 处构造点 :149/:168/:180/:189/:197/:206/:211/:219/:228+makeDocsStub 随 docs 注入删改）、`media-gc.int.spec.ts`（4 处构造点 :131/:220/:261/:290——:261 failDocs=shadow 族用例随删）、kill9/redrive spec（collector 传参行随删）

- [ ] **Step 1: 孤儿盘点**——`grep -rn "MediaRefsCollector\|collectMediaRefs\|ERASURE_MEDIA_REFS" apps/api/src`（**排除 @flowweb/shared 的 collectMediaRefs/collectMediaRefsForNode——投影器单源不动**）+`grep -rn "docScanFailed" apps/api/src`——与 Files 明单核对（auth 放行行+kill9/redrive/purge 传参行=第七轮已锚定消费点，漏项补列）。
- [ ] **Step 2: GC 删**——sweepTeam shadow 段（:261-293——对拍体+「对拍段后」过期检查）+`shadowOldFaceReferenced` 方法（:349-402）+`MEDIA_REF_SHADOW_MIN_BUDGET_MS`（**:70-75 JSDoc 连 :76 常量行删——JSDoc 含 MEDIA_GC_DOC_SCAN_PAGE 词面**+import 清理）+**孤儿符号随删：`MEDIA_GC_DOC_SCAN_PAGE`/`MEDIA_GC_TIMELINE_SCAN_PAGE`（:58/:60）+`runWithIncludeDeleted`/`collectMediaRefs`/`toDocLike`/`controlledRebuildForMedia` 四 import（删整段后全闲置，第九轮实证）**+docs 注入（:167，this.docs 唯一使用 :394）——不留只为断言零调用的端口+「四参构造签名」注释 :161 改写+**16 处构造点随删改**（media-gc.int :131/:220/:261〔:261 failDocs 用例随删〕/:290+shadow :130/:472/:494+media-deleting 9 处）；:247/:257/:302 与删除循环零动（diff 逐块自审）。
- [ ] **Step 3: 擦除删**——`erasureOldFaceReferenced`（:206-251）；resolveMediaDisposition 引用集只留 isMediaReferenced overlay；`docScanFailed`/`docScanSkipped` 删（interface :199/:264/:266/:280+复核分支 :435-437/:446/:543+结果类型 :373-374/:422——prepare 未 verified=既有 pending-review 不造第三态）；窗内 shadow 段（:484-511）；**stages :4-5 文件头注 httpMediaRefsCollector 词面改写（census ⑰ 纯度注记——第十轮）**；**活文档扫描链整链删**（类型 :85+httpMediaRefsCollector :89-110+deps.collectMediaRefs 参数+poller **:31 import 两符号/:63-64 构造参数 JSDoc/:289 processProjectRun 头注**/:62-64 注入/:298 缺省腿+controller :56-64+spool **collectProjectMediaRefs 整段 :2286-2326**+两常量 **:159-163 整段 JSDoc 连 export 行（含 :161 httpMediaRefsCollector/:163 MEDIA_GC_DOC_SCAN_PAGE 双词面）**+**MediaRefsDocsPort（:165 起 JSDoc+:173-176）**+dto 文件+**auth.guard :36-40+:55**+media-refs spec 文件+kill9/redrive/purge 传参行）。
- [ ] **Step 4: 认领拍 fence 化（cohort 规范化+四规则+一拍一段+退避）**（spec v12 §1.5——红测先行见 Step 7；第九~十一轮收口）——executePurgingDbStage 改造：
  **每拍非干跑先 cohort 规范化（认领集/删除集只允许缩小）**：exclusive=本拍 ③ 独占集（档 a 只进 detach）；markerKeep=sidecar.mediaIds∩exclusive——差集 release，**按原因计 conflict（第十轮拆三档）**：③ 判被引用离开 exclusive（在 detach 且非档 a=E2 路径）→**计**（现码 :436-441 同语义）；档 a/行不在→不计（腿⑥）；④ unionFace 命中计一次、规范化已移出 marker 的不重复。markerKeep 空→删 marker、非空→**原 markAt 写回**；差集 id 不再 claim。**候选宇宙=exclusive，窗内只剔除不增补**（③ 判 detach 的 id 窗内认领=同拍 ⑤ 再 detach 留 DELETING 孤儿）。
  **一拍一段（分流锚点=进入本拍时的 marker，不看规范化后结果）**：进入无 marker∧exclusive 非空→**只走②**；进入有 marker→**只走③或④**（规范化删空 marker 后本拍不再 prepare/claim——新 exclusive 留下一拍走②、新 markAt；防 reviewWindowMs=0 用例同拍串段把新 cohort 窗起点同拍删掉）。**无论走哪段，⑤ detach 写批先于推进判定执行、deletable 为空不跳过**（E2 :503 projectId=null 靠它）。
  **①干跑**：:422 前返回，零 fence/零 claim/零 marker。**②认领拍（仅进入时无 marker）**：进入时 marker 不存在且 exclusive 非空才 prepare——未 verified=零 claim 零 marker 走 pending-review；verified 后只对 exclusive 逐 id 重算（**不得沿用窗前 ③**；循环内过期即中止）；空→零 claim 零 marker（进退避）；非空→**先写 marker（新 markAt）再 claim**→claim 后再查时钟（过期→release 本批+删 marker+pending-review）→finally release。**③窗未满（仅进入时有 marker）**：零 prepare、markAt 不动、exclusive 多出 id 只参加推进门。**④删除拍（仅进入时有 marker）**：进入时有 marker∧窗满∧**规范化后 markerKeep 非空**才进入（markerKeep=∅=cohort 已消解——本拍不 prepare 不 claim，出口见推进门）——kept=markerKeep−unionFace（unionFace 命中释放+计 conflict——④内只此一计）；**只 claim kept**；deletable=kept∩owned；未 verified/入口过期=不删不丢 marker 不推进；**机器不变量 deletable⊆exclusive∧∩unionFace=∅**。**⑥（作用域=仅规则④——第十一轮消歧）**：只在进入④∧prepare verified∧kept 已算出时改写 marker=kept−deleted（只留 recheck 中止 id）、markAt 不变、exclusive 新 id 不写入；②拍新写 marker/③拍规范化写回 markerKeep 保留、④未 verified 或未进删除体不覆盖。**推进门**：marker 有 id/exclusive−deleted 非空/未 verified 或过期→pending-review；皆空才 PURGING_OBJECTS；**「未 verified」=本拍调用了 prepare 且非 verified 或入口过期——进入有 marker∧markerKeep=∅ 拍（未调用 prepare）不计未 verified：exclusive−deleted 空（E2 :500）→purging-objects、仍非空（腿⑧）→pending-review 下一拍走②（第十一轮）**。**进程内退避**（**Map=stages 模块级按 erasureId 记**：bail/空重算→15s 起倍增上限 5min；成功 claim 清掉；kill -9 重置；规则③不进退避——红测=腿⑨）。
- [ ] **Step 5: 周边删+census**——`controlledRebuildForMedia`+`mediaBindingStaleTotal` import；`mediaRefShadowMismatchTotal`+`mediaRefShadowSkipTotal`+`mediaBindingStaleTotal` 三指标；`skipBindingArm` 选项+读腿；`MEDIA_REF_ORACLE_ONLY`（env.ts:195+media-reference :142-146+**census 两条目 :1203-1204+:1181-1184**+**:1185 注释**+cache.ts :102 注释+GC :251 注释同步）。
- [ ] **Step 6: runbook §13.3**——:664 末 media_ref_shadow_skip_total 分诊句删+:666-668 重写三句（删除证人=围栏快照+isMediaReferenced+事务内复检〔**认领与删除同门**〕；绑定收敛只走 backfill；valve-bailout 只解释围栏内判决和删除）+回滚开关段删。
- [ ] **Step 7: 测试**（DATABASE_URL 前置；认领门红测先行跑红）——shadow 族断言/helpers（shadowSkipOf/mismatchOf/staleOf）及 ⑪⑫ 用例删；⑩ 原样；纯判决面用例零动；**认领门红测十条腿**（替换 purge :339-361 fail-closed 用例）：①prepare 未 verified→零认领〔无 DELETING 行+无 marker 写+pending-review〕；②verified→claim+marker 落盘；③窗前判独占、围栏内 isMediaReferenced=true→该 id 无 DELETING、不进 marker（装置=barrier stub 的 prepare() 返回 verified 前写入他项目引用）；④sidecar 在档∧窗未满→barrier.prepare 零调用（spy）+③ 见引用仅释放 departed、markAt 不变；⑤verified+claim 返回后时钟已过→release 本批被调用、无 marker、无 DELETING 残留；**E2/E3（:489-526）断言一字不改且必须绿**；⑥档 a：sidecar 含 id、窗满前 isFavorite 置真→行在+ACTIVE+projectId=null+不在 marker+conflict 不增；⑦不增补：sidecar {A}、exclusive {A,X}、A 被删→marker 不含 X、A 因 recheck 留下则 markAt 仍旧、pending-review；⑧换 cohort：sidecar 与 exclusive 不相交→marker 删除、旧 id ACTIVE、下一拍才 claim 新 exclusive 且 markAt 新；⑨空重算：窗内全被引用→零 claim、零 marker、不推进+**同一 erasureId 15s 内再进一次→prepare 次数不增加（退避红测——Map=stages 模块级，第十轮）**；⑩删除拍入口：sidecar {A,B}、exclusive {A,B,X}、窗满→prepare 发生、A/B 按 unionFace 删或留、X 不在本拍 deletable；**docScan 断言连坐**：purge :231/:438 toEqual 改等式删字段、detach/exclusive 数值断言保留；**安全钉**：shadow spec ⑤ 已全链覆盖+补直调 isMediaReferenced=true 断言；**⊆ 契约测试（必做，限 UUID 形态 id）**：同一 state+updates 上 collectMediaRefs 产出 ⊆ scanUuidLeaves 过滤出的 Media id。→ `DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api run test:int -- src/modules/media-delivery/media-gc.shadow.c3b5.int.spec.ts`+`src/modules/collab/project-erasure.purge.c4c1.int.spec.ts`+`src/modules/collab/binding-rebuild.int.spec.ts`+`src/modules/media-delivery/media-deleting.int.spec.ts`+`src/modules/media-delivery/media-gc.int.spec.ts` 全绿（实跑数核对；E2/E3 同批实跑）。
- [ ] **Step 8: 残留自证**——`grep -rn "MEDIA_REF_SHADOW_MIN_BUDGET_MS\|skipBindingArm\|MEDIA_REF_ORACLE_ONLY\|shadowOldFaceReferenced\|erasureOldFaceReferenced\|media_ref_shadow\|httpMediaRefsCollector\|MediaRefsCollector\|docScanFailed\|ERASURE_MEDIA_REFS_BATCH\|controlledRebuildForMedia\|mediaBindingStaleTotal\|ERASURE_MEDIA_REFS_SCAN_MAX\|MediaRefsDocsPort\|collectProjectMediaRefs\|CollectMediaRefsDto\|doc/media-refs\|MEDIA_GC_DOC_SCAN_PAGE\|MEDIA_GC_TIMELINE_SCAN_PAGE" apps/api/src docs/superpowers/collab-ops-runbook.md scripts/check-collab-census.mjs` 零命中（第九轮再扩充七符号+census 同词面）。
- [ ] **Step 9**: `--write-metric-names`（三指标出表）→`pnpm verify`（full）→commit。

### 批末出口

- [ ] `pnpm verify`（full）复跑 36/36 → 八 commit 清单+各 commit 证据收口呈报（K2 六红测+全仓门 / K4 两文件绿 / K5 settle 测试+两腿 DRILL PASS / K6·K7 指标名写入+int 实跑数 / K8 删除清单+**认领门红测十条腿+E2/E3 同批绿**+残留 grep 扩充零命中+安全钉+⊆ 契约测试+census 两条目出册 / 锚 diff 唯一 1241→1242）+**两条完成标准自证：同一 marker 的 markAt 在窗内轮询中保持不变；过期路径上本拍 claim 的 id 最终无 DELETING 残留、无 marker**→ **push 按当轮确认**（确认门）。
