# T39b B0 测试基座落档报告（Y0c 片 B 波 1——步骤 0 清单+收敛比+门禁基座+试点验证）

> 执行时点：2026-10-16（HEAD=1d004ca8 基线）。重跑命令：
> - 步骤 0 枚举/三列清单/触达统计：`node scripts/check-collab-test-facade.mjs --report`
> - 门禁（登记红对账）：`node scripts/check-collab-test-facade.mjs`（verify 链 id=check-collab-test-facade，census 邻位 fast 外）
> - 门禁自测：`node --test scripts/check-collab-test-facade.test.mjs`（18 例）
> 注意：--report 输出随替换推进滚动变化（基线态=534 处/31 文件；波 1 试点后现态=399 处/30 文件）。
> 本文「步骤 0 基线」节=波 1 替换前全量快照（附录全文）；偏离登记=spec §0.6 62 号。

## 1. 门禁口径（违规定义终态——写死于脚本头注）

违规 = **绕过类型系统访问 gateway 内部状态** = cast 形态 ∧ gateway 私有成员触达（Z140② 合取语义）：

- cast 形态 ∈ { `as any`、`as unknown as`、`@ts-expect-error` }（现状实测：`as unknown as` 零后置成员访问、`@ts-expect-error` 零命中——两规则=防换写法绕过的前置防线，自测钉正例）
- 成员 universe = 脚本现场解析 collab.gateway.ts 的 `private` 声明（字段+方法+static 常量+构造器参数属性）=**191 个 distinct**（gateway 演进自动跟随，零人工名单）
- 检测四则：R1 直接 cast 成员链（跨行/`?.`/平衡括号/类型名跳过≤1）｜R2 gateway any 别名 `alias.member` 逐处｜R3 `spyOn(cast|别名|gateway 词, '私有方法名字符串')`｜R4 `@ts-expect-error` 下一行成员触达（与 R1-R3 同行去重）
- 非违规面：payload cast（`} as any)`）、mock 链（`(repo.append as any).mock`）、非 gateway 对象（`(kit.spool as any).ioBroken`——spool 私有面归后续任务）、gateway 公有成员冗余 cast（`(gateway as any).server/hooks`）
- 执法范围 = `apps/api/src/modules/collab/*.spec.ts` 顶层 75 文件（含 *.int.spec.ts；collab 域外 spec 经 grep 实证零 gateway 私有触达；扩面复验归 B 出口 T43）
- 豁免面 = test-utils/collab-gateway-test-facade.ts 本体（唯一 sanctioned 绕点——非 .spec 后缀天然出扫描面，脚本 assert 自证不混入；落位 test-utils/=偏离 62④ 勘正——RB2 原路径会被 nest build 编入 dist，test-utils 目录=tsconfig 结构性排除+dist 门禁覆盖）
- 登记红 = 文件级单 symbol `'facade-bypass'`，reconcileRegisteredRed（census :267）复用三向对账；until='T39b-2'（波 2）；计数降=drift 红强制同步、清零=stale 红强制移除、终态登记空

## 2. 步骤 0 基线（2026-10-16 实测——红证据：空登记跑门禁 exit 1，输出存档于 git 历史本文件附录）

- **M1（触达处数=违规点）= 534**；**M2（distinct 触达成员）= 87**；触达文件 **31/75**
- kind 分布：cast 384 / alias 143 / spyOn 7（合计 534）
- top 触达成员：pendingQueues 97｜persistRetry 28｜docTruth 26｜collabState 23｜lastCompactAt 21｜logger 17｜sweepIntervalMs 14｜docDelta 14｜quotaFrozenDocs 14｜docProject 14｜startSessionSweep 13｜docStatusRev 12｜loadDocument 11
- 归属分布（三列清单第二列，Z24 地图，零 UNMAPPED）：Persistence ≈212 处｜SessionGuard ≈128 处｜DocRegistry ≈121 处｜不搬 ≈63 处（全量逐成员表见附录）
- v8 旧基准（245/18、368/20、436、1659/51）与实测全部对不上——按 plan「精确数以步骤 0 输出为准」，本节数字为唯一权威基线

## 3. façade 终态 API（N=41——collab-gateway-test-facade.ts，class GatewayTestFacade+gatewayFacade(gw) 工厂）

| 组 | 方法 | 替代的成员访问形态 |
|---|---|---|
| pendingQueues（6） | pendingQueueRef/pendingQueueLen/pendingQueueHas/seedPendingQueue/clearPendingQueue/pendingQueueRefForDoc | `.pendingQueues.get/?.length/has/set/delete`+两跳 `.get(.docProject.get(doc))` 归并；**Ref 返回 Map 内真实数组引用（身份契约+splice/unshift 原地语义承载面）** |
| docProject（2） | docProjectOf/seedDocProject | `.docProject.get/set`（Y4 两跳第一跳） |
| persistRetry（4） | persistRetryEntry/persistRetryHas/persistRetrySize/seedPersistRetry | `.persistRetry.get/has/size/set`（entry 返回真实引用——rung/timer 直改语义保留） |
| 状态台账（11） | backdateLastCompactAt/lastCompactAtHas/addPersistUnhealthy/persistUnhealthyHas/addRetryingPersistDoc/seedLegacyRetryingFlag/flushScheduledHas/inFlightHas/isInitDone/forceCollabState/forceShuttingDown | `.lastCompactAt.set/has`、`.persistUnhealthy.add/has`、`.retryingPersistDocs.add`、幻影字段 `retryingPersist=`（I-2 双形态装置）、`.flushScheduled.has`、`.inFlightProjects.has`、`.initDone`、`.collabState=`、`.shuttingDown=` |
| writeFreeze（2） | seedWriteFreeze/hasWriteFreezeReason | `.writeFreeze.set(conn,{pid,reasons})`/`.get(conn)?.reasons.has(r)` |
| stub（2） | stubSpool/stubTransition | `.spool =` 整体替换/`.transition =` 方法遮蔽（V11 非法迁移捕获装置） |
| spy（5） | spyLogger/spyEventEmit/spyListenServer/spyCloseAll1012/spyStoreSerialized | `vi.spyOn((gw as any).logger/eventEmitter,…)`+`vi.spyOn(gw as any,'listenServer'/'closeAllConnections1012'/'storeDocumentSerialized')` 字符串成员形态 |
| 直调转发（9） | startCollabAfterLease/selfIsolate/listenCollab/recheckConnection/reconcileSpool/schedulePersistRetry/cancelPersistRetry/retryPersist/transitionState | 私有方法直调（签名经 `CollabGateway['method']` 索引访问类型单源） |

类型面：读面字段 `CollabGateway['member']` 索引访问单源（成员演进=编译红漂移面）；内部受控 cast 集中单点（internals()/methods() 两函数）。

## 4. 试点替换验证（collab.gateway.spec.ts 全文件）

- 违规 135 → **0**（门禁 stale 红强制核销登记——机制实证）；diff 174+/173-
- **90/90 用例全绿**；四处身份契约（现行号 :698 firstRef/:1231+:1293 tailRef/:1310 before/:1332+:1336 before/:1393 qBefore——toBe 数组身份断言**注释与断言原样**）全部经 façade 仍绿：pendingQueueRef/RefForDoc 返回真实引用，q.unshift/q.splice 折并交织装置直接操作真实数组
- 剩余 `as any` 77 处全为合法面（payload cast/mock 链/public 成员冗余 cast——精准修改不动）
- 试点发现的形态事实：①computePending(:1669)/handoffPendingToSpool(:2593)/beginDraining 实为 **public**——不入 façade，直调公有（`(g as any).collabState` 读点同理改公有 getCollabState()）②别名 `const g = kit.gateway as any` 是主流触达形态（82/135）——R2 规则必要性的实证③façade 缺口两处现场扩（pendingQueueRefForDoc 两跳归并/persistRetrySize）——操作化归并原则未破④**类型面恢复的首个实证**：api-tsc-scripts（spec 类型检查面——主 tsconfig 排除 spec）暴露 `spyStoreSerialized().mockResolvedValue(undefined)` 类型红（storeDocumentSerialized 真型 Promise<boolean>，any 时代宽松不红）——修=运行时逐字保留断言 `undefined as unknown as boolean`+注释（波 2 替换将系统性暴露同族类型债，属 façade 收益非成本）

## 5. N/M 收敛比（两口径）+ 重裁建议

| 口径 | 波 1 现值 | 波 2 终态预估 | 判读 |
|---|---|---|---|
| N/M1（触达处数） | 41/534 = **0.077**（试点文件口径 41/135=0.30） | ~85/534 ≈ **0.16** | 实质收敛（pendingQueues 97 处→6 方法） |
| N/M2（distinct 成员） | 41/87 = 0.47 | ~85/87 ≈ **0.98** | **≈1:1**——结构性事实：直调族成员（~25 个：startSessionSweep/loadDocument/maybeCompact/wirePermChangedEvents/recheckConnection…约 130/534≈24% 触达处）转发即操作本体，无归并空间；字段族（Map/Set ~76% 触达处）平均 2-4 操作归并 |

**如实报告**：按「方法数缩减」判据，直调族部分=1:1 映射垫片形态。但收益结构不在方法数：①类型面恢复（façade 方法全型——spec 触达代码回到 tsc 检查面）②sanctioned cast 集中单点③索引访问类型单源=gateway 演进编译红跟随④三列清单=B1/B2/B3 切分地图原料。

**波 2 重裁建议（控制方裁决项）**：关键洞察——B1/B2/B3 service 化后，现私有**方法**将成为 service 公有方法，直调族 cast 自然消失（波 2 先行 façade 化直调族=二次工作）。两个选项：
- **(a) 全量替换**：399 处全 façade 化（含直调族 ~80 处）——门禁登记清零彻底，但直调族 façade 方法在 B1-B3 后废弃
- **(b) 收窄替换（推荐）**：波 2 只替换字段/状态族（~320 处——收敛收益主体），直调族 ~80 处登记红改 until='B1-B3'（service 拆分时随公有化自然消除+登记同步核销）——省 ~25 个短命 façade 方法

## 6. 波 2 剩余工作量分级（30 文件×399 处——按触达数排序；难度=触达密度×形态复杂度）

| 文件（collab/ 前缀省略） | 触达 | kind | 难度 |
|---|---|---|---|
| collab-shrink.spec.ts | 67 | cast30+alias37 | 高（docTruth/quotaFrozenDocs/docStatusRev 多成员交织+vacuum 预演装置） |
| collab-quota-truth.spec.ts | 41 | cast41 | 中（docTruth/docDelta/truthMeasuredAt 三件套+lastCompactAt） |
| collab-metrics-observability.spec.ts | 32 | cast29+spyOn3 | 中（maybeCompact/storeDocumentUnlocked 直调+heapUsedNow spy） |
| collab-auth-defense.spec.ts | 30 | cast24+alias6 | 中（refusalCache/transition/permCache+withAuthDeadline） |
| collab-perm-events.spec.ts | 29 | cast28+spyOn1 | 中（socketIdentity/wirePermChangedEvents/sweepSessions） |
| collab.gateway.persist-status.spec.ts | 27 | cast19+alias8 | 中（persistUnhealthy/persistRetry/docEpoch） |
| collab.gateway.sweep.spec.ts | 26 | cast26 | 中（sweepIntervalMs/startSessionSweep/connEstablishedAt） |
| collab-quota-gate.spec.ts | 25 | alias25 | 中（quota 注入+overPush/writeFreeze） |
| collab.gateway.project-gone.spec.ts | 15 | alias14+cast1 | 低 |
| collab.gateway.shutdown.spec.ts | 14 | cast12+spyOn2 | 低 |
| collab-awareness-guard.spec.ts | 12 | cast12 | 低（clientIdOwner） |
| collab-heap-gate.spec.ts | 9 | cast8+spyOn1 | 低 |
| collab-pg-breaker.service.spec.ts | 9 | cast9 | 低 |
| collab-sentry.spec.ts | 9 | cast9 | 低（connectionIds） |
| collab-t20-ripples.spec.ts | 9 | cast1+alias6+spyOn2 | 低 |
| collab-upgrade.spec.ts | 8 | cast7+spyOn1 | 低 |
| collab-rate-gate.spec.ts | 6 | alias6 | 低 |
| collab-residency-reaper.spec.ts | 6 | cast6 | 低 |
| collab-degraded.spec.ts | 4 | cast4 | 微 |
| collab-pg-breaker.int.spec.ts | 4 | cast4 | 微 |
| collab-runtime-metrics.spec.ts | 4 | cast4 | 微 |
| collab-reconnect-storm.spec.ts | 3 | cast3 | 微 |
| collab-write-endpoint.int.spec.ts | 2 | cast2 | 微 |
| collab.gateway.auth-reason.spec.ts | 2 | cast2 | 微 |
| collab-backpressure/collab-perm-chain/collab-ready.controller/collab-version-gate/telemetry.controller/write-frozen-chain.int（6 文件） | 各 1 | cast1 | 微 |

façade 波 2 扩展预估：字段/状态族 ~30 方法（docTruth/docDelta/quotaFrozenDocs/docStatusRev/sweepIntervalMs/refusalCache/clientIdOwner/socketIdentity/overPush/permCache/connectionIds/degradedDocs/truthMeasuredAt/freezePending/thawCooldown/docResidue/docGeneration/preVacuumSvCache/docStatusState/authAttemptBuckets/authInflightPeak/awarenessDriftLogged/oldestUnflushedAt 族等）+直调族 ~25 方法（选项 (a) 时；选项 (b) 免）。

## 7. 出口链数字（波 1）

- 门禁自测 18/18 绿｜scripts-node-test 全列举 176/176 绿（含 verify-chain 元测试 11/11——26 步基线常量同步）
- 门禁登记态 PASS exit 0（30 项登记红 until=T39b-2 可见展开）
- api tsc --noEmit 绿（façade+替换后 spec）
- collab.gateway.spec.ts 90/90 绿（身份契约七断言原样）
- collab 目录全量：unit 65 文件 782 用例绿 + int 10 文件 36 用例绿 = **75 文件 818 用例全绿**

## 附录：步骤 0 基线 --report 全文（波 1 替换前快照——2026-10-16）

```
# check-collab-test-facade --report（步骤 0 枚举——重跑命令：node scripts/check-collab-test-facade.mjs --report）
# universe：collab.gateway.ts 私有成员 191 个（脚本现场解析——gateway 演进自动跟随）
# 执法面：apps/api/src/modules/collab/*.spec.ts 75 文件；豁免面：apps/api/src/modules/collab/collab-gateway-test-facade.ts（唯一 sanctioned 绕点，非 spec 后缀天然出圈）

## 触达统计（M 双口径=执法口径单源）
M1（触达处数=违规点数）= 534
M2（distinct 触达成员数）= 87
触达文件数 = 31/75

## 三列清单（成员 → 所属目标 service〔Z24〕 → 访问形态）
| 成员 | 归属 | 触达数 | 形态分布 | 触达文件（top3） |
|---|---|---|---|---|
| pendingQueues | Persistence | 97 | 读61/写36 | collab.gateway.spec.ts:56, collab-shrink.spec.ts:8, collab-quota-truth.spec.ts:7 |
| persistRetry | Persistence | 28 | 读22/写4/引用2 | collab.gateway.spec.ts:14, collab.gateway.persist-status.spec.ts:9, collab.gateway.project-gone.spec.ts:3 |
| docTruth | DocRegistry | 26 | 读16/写10 | collab-shrink.spec.ts:11, collab-quota-truth.spec.ts:10, collab-quota-gate.spec.ts:3 |
| collabState | 不搬 | 23 | 赋值写21/引用2 | collab.gateway.spec.ts:4, collab-auth-defense.spec.ts:3, collab.gateway.auth-reason.spec.ts:2 |
| lastCompactAt | Persistence | 21 | 写19/读2 | collab.gateway.spec.ts:9, collab-metrics-observability.spec.ts:7, collab-quota-truth.spec.ts:2 |
| logger | 不搬 | 17 | 引用17 | collab-residency-reaper.spec.ts:6, collab.gateway.spec.ts:4, collab-awareness-guard.spec.ts:1 |
| sweepIntervalMs | SessionGuard | 14 | 赋值写13/引用1 | collab.gateway.sweep.spec.ts:10, collab-auth-defense.spec.ts:3, collab-perm-events.spec.ts:1 |
| docDelta | DocRegistry | 14 | 写4/读10 | collab-quota-truth.spec.ts:8, collab-shrink.spec.ts:4, collab-metrics-observability.spec.ts:1 |
| quotaFrozenDocs | DocRegistry | 14 | 读12/写2 | collab-shrink.spec.ts:8, collab-quota-gate.spec.ts:5, collab-t20-ripples.spec.ts:1 |
| docProject | Persistence | 14 | 读12/写2 | collab.gateway.spec.ts:11, collab.gateway.persist-status.spec.ts:2, collab.gateway.shutdown.spec.ts:1 |
| startSessionSweep | SessionGuard | 13 | 直调13 | collab.gateway.sweep.spec.ts:10, collab-auth-defense.spec.ts:3 |
| docStatusRev | DocRegistry | 12 | 读10/写2 | collab-shrink.spec.ts:8, collab-quota-gate.spec.ts:4 |
| loadDocument | DocRegistry | 11 | 直调11 | collab-metrics-observability.spec.ts:4, collab-heap-gate.spec.ts:2, collab-shrink.spec.ts:2 |
| clientIdOwner | SessionGuard | 9 | 读9 | collab-awareness-guard.spec.ts:9 |
| socketIdentity | SessionGuard | 9 | 读2/写7 | collab-perm-events.spec.ts:8, collab-awareness-guard.spec.ts:1 |
| maybeCompact | Persistence | 9 | 直调9 | collab-metrics-observability.spec.ts:7, collab-quota-truth.spec.ts:2 |
| overPush | SessionGuard | 9 | 引用7/写1/读1 | collab-quota-gate.spec.ts:7, collab-shrink.spec.ts:2 |
| persistUnhealthy | Persistence | 9 | 读7/写2 | collab.gateway.persist-status.spec.ts:5, collab.gateway.project-gone.spec.ts:2, collab.gateway.spec.ts:2 |
| refusalCache | SessionGuard | 8 | 读5/引用3 | collab-auth-defense.spec.ts:6, collab-heap-gate.spec.ts:2 |
| transition | 不搬 | 8 | 直调7/赋值写1 | collab-auth-defense.spec.ts:5, collab.gateway.spec.ts:2, collab-write-endpoint.int.spec.ts:1 |
| writeFreeze | SessionGuard | 8 | 写2/读6 | collab.gateway.spec.ts:3, collab-quota-gate.spec.ts:2, collab-shrink.spec.ts:2 |
| wirePermChangedEvents | SessionGuard | 7 | 直调7 | collab-perm-events.spec.ts:7 |
| truthMeasuredAt | DocRegistry | 7 | 写4/读3 | collab-quota-gate.spec.ts:3, collab-quota-truth.spec.ts:3, collab-shrink.spec.ts:1 |
| permCache | SessionGuard | 5 | 写4/引用1 | collab-auth-defense.spec.ts:2, collab-perm-events.spec.ts:2, collab.gateway.sweep.spec.ts:1 |
| storeDocumentUnlocked | Persistence | 5 | 直调5 | collab-metrics-observability.spec.ts:3, collab-runtime-metrics.spec.ts:2 |
| cancelPersistRetry | Persistence | 5 | 直调5 | collab.gateway.shutdown.spec.ts:2, collab.gateway.spec.ts:2, collab-pg-breaker.service.spec.ts:1 |
| degradedDocs | DocRegistry | 5 | 读4/写1 | collab-quota-truth.spec.ts:4, collab-shrink.spec.ts:1 |
| connectionIds | SessionGuard | 5 | 写3/读2 | collab-sentry.spec.ts:5 |
| authInflightPeak | SessionGuard | 4 | 引用3/赋值写1 | collab-reconnect-storm.spec.ts:3, collab-auth-defense.spec.ts:1 |
| pgBreaker | DocRegistry | 4 | 引用4 | collab-pg-breaker.service.spec.ts:3, collab-auth-defense.spec.ts:1 |
| unloadDocument | 不搬 | 4 | 直调4 | collab-metrics-observability.spec.ts:2, collab-quota-truth.spec.ts:2 |
| sweepSessions | SessionGuard | 4 | spyOn直调1/直调3 | collab-perm-events.spec.ts:4 |
| bytesBuckets | SessionGuard | 4 | 引用4 | collab-rate-gate.spec.ts:4 |
| freezePending | DocRegistry | 4 | 读3/写1 | collab-shrink.spec.ts:4 |
| recheckFrozenDocs | DocRegistry | 4 | 直调4 | collab-t20-ripples.spec.ts:3, write-frozen-chain.int.spec.ts:1 |
| selfIsolate | 不搬 | 4 | 直调4 | collab.gateway.spec.ts:4 |
| heapUsedNow | DocRegistry | 3 | spyOn直调3 | collab-metrics-observability.spec.ts:3 |
| repo | Persistence | 3 | 赋值写1/引用2 | collab-shrink.spec.ts:2, collab-pg-breaker.int.spec.ts:1 |
| thawCooldown | DocRegistry | 3 | 读2/写1 | collab-shrink.spec.ts:3 |
| clientIpOf | SessionGuard | 3 | 直调3 | collab-upgrade.spec.ts:3 |
| schedulePersistRetry | Persistence | 3 | 直调3 | collab.gateway.spec.ts:2, collab.gateway.persist-status.spec.ts:1 |
| retryPersist | Persistence | 3 | 直调3 | collab.gateway.persist-status.spec.ts:2, collab.gateway.spec.ts:1 |
| docEpoch | DocRegistry | 3 | 读3 | collab.gateway.persist-status.spec.ts:3 |
| drainAllDocuments | Persistence | 3 | 直调3 | collab.gateway.shutdown.spec.ts:3 |
| listenServer | 不搬 | 3 | spyOn直调3 | collab.gateway.spec.ts:3 |
| closeAllConnections1012 | SessionGuard | 3 | spyOn直调3 | collab.gateway.spec.ts:3 |
| connEstablishedAt | SessionGuard | 3 | 引用3 | collab.gateway.sweep.spec.ts:3 |
| heapPressureSample | DocRegistry | 2 | 直调2 | collab-auth-defense.spec.ts:2 |
| withAuthDeadline | SessionGuard | 2 | 直调2 | collab-auth-defense.spec.ts:2 |
| AUTH_DB_DEADLINE_MS | SessionGuard | 2 | 引用2 | collab-auth-defense.spec.ts:2 |
| awarenessDriftLogged | SessionGuard | 2 | 写1/读1 | collab-perm-events.spec.ts:2 |
| guardAwareness | SessionGuard | 2 | 直调2 | collab-perm-events.spec.ts:2 |
| freezeQuota | DocRegistry | 2 | 直调2 | collab-shrink.spec.ts:2 |
| docStatusState | DocRegistry | 2 | 写2 | collab-shrink.spec.ts:2 |
| recheckRounds | SessionGuard | 2 | 写2 | collab-shrink.spec.ts:1, collab-t20-ripples.spec.ts:1 |
| docResidue | DocRegistry | 2 | 写2 | collab-shrink.spec.ts:1, collab-t20-ripples.spec.ts:1 |
| handleUpgrade | SessionGuard | 2 | 直调2 | collab-upgrade.spec.ts:2 |
| inFlightProjects | Persistence | 2 | 写1/读1 | collab.gateway.project-gone.spec.ts:1, collab.gateway.spec.ts:1 |
| deletedProjects | Persistence | 2 | 读2 | collab.gateway.project-gone.spec.ts:2 |
| storeDocumentSerialized | Persistence | 2 | spyOn直调2 | collab.gateway.shutdown.spec.ts:1, collab.gateway.spec.ts:1 |
| flushScheduled | Persistence | 2 | 读2 | collab.gateway.spec.ts:2 |
| startCollabAfterLease | 不搬 | 2 | 直调2 | collab.gateway.spec.ts:2 |
| listenCollab | 不搬 | 2 | 直调2 | collab.gateway.spec.ts:2 |
| authAttemptBuckets | SessionGuard | 2 | 写1/读1 | collab.gateway.sweep.spec.ts:2 |
| ownedClientIds | SessionGuard | 1 | 读1 | collab-awareness-guard.spec.ts:1 |
| wrapBackpressure | SessionGuard | 1 | 直调1 | collab-backpressure.spec.ts:1 |
| peekSpoolFrames | Persistence | 1 | spyOn直调1 | collab-heap-gate.spec.ts:1 |
| logDocTopN | DocRegistry | 1 | 直调1 | collab-metrics-observability.spec.ts:1 |
| pendingSince | Persistence | 1 | 读1 | collab-quota-truth.spec.ts:1 |
| msgBuckets | SessionGuard | 1 | 引用1 | collab-rate-gate.spec.ts:1 |
| awareBuckets | SessionGuard | 1 | 引用1 | collab-rate-gate.spec.ts:1 |
| scheduleFreezePending | DocRegistry | 1 | 直调1 | collab-shrink.spec.ts:1 |
| docGeneration | DocRegistry | 1 | 写1 | collab-shrink.spec.ts:1 |
| preVacuumSvCache | DocRegistry | 1 | 写1 | collab-shrink.spec.ts:1 |
| measureTruth | DocRegistry | 1 | spyOn直调1 | collab-t20-ripples.spec.ts:1 |
| updateResidue | DocRegistry | 1 | spyOn直调1 | collab-t20-ripples.spec.ts:1 |
| upgradeBucket | SessionGuard | 1 | 引用1 | collab-upgrade.spec.ts:1 |
| allowedOrigins | SessionGuard | 1 | spyOn直调1 | collab-upgrade.spec.ts:1 |
| clearDrainTimer | 不搬 | 1 | 直调1 | collab-write-endpoint.int.spec.ts:1 |
| graceDirectConnections | SessionGuard | 1 | spyOn直调1 | collab.gateway.shutdown.spec.ts:1 |
| eventEmitter | 不搬 | 1 | 引用1 | collab.gateway.spec.ts:1 |
| retryingPersistDocs | Persistence | 1 | 引用1 | collab.gateway.spec.ts:1 |
| spool | Persistence | 1 | 赋值写1 | collab.gateway.spec.ts:1 |
| initDone | 不搬 | 1 | 引用1 | collab.gateway.spec.ts:1 |
| recheckConnection | SessionGuard | 1 | 直调1 | collab.gateway.spec.ts:1 |
| shuttingDown | 不搬 | 1 | 赋值写1 | collab.gateway.spec.ts:1 |
| reconcileSpool | Persistence | 1 | 直调1 | collab.gateway.spec.ts:1 |

## 违规基线（执法口径=cast∧私有成员合取；file×count×kind）
apps/api/src/modules/collab/collab-auth-defense.spec.ts  ×30  (cast:24 alias:6)
apps/api/src/modules/collab/collab-awareness-guard.spec.ts  ×12  (cast:12)
apps/api/src/modules/collab/collab-backpressure.spec.ts  ×1  (cast:1)
apps/api/src/modules/collab/collab-degraded.spec.ts  ×4  (cast:4)
apps/api/src/modules/collab/collab-heap-gate.spec.ts  ×9  (cast:8 spyOn:1)
apps/api/src/modules/collab/collab-metrics-observability.spec.ts  ×32  (cast:29 spyOn:3)
apps/api/src/modules/collab/collab-perm-chain.spec.ts  ×1  (cast:1)
apps/api/src/modules/collab/collab-perm-events.spec.ts  ×29  (cast:28 spyOn:1)
apps/api/src/modules/collab/collab-pg-breaker.int.spec.ts  ×4  (cast:4)
apps/api/src/modules/collab/collab-pg-breaker.service.spec.ts  ×9  (cast:9)
apps/api/src/modules/collab/collab-quota-gate.spec.ts  ×25  (alias:25)
apps/api/src/modules/collab/collab-quota-truth.spec.ts  ×41  (cast:41)
apps/api/src/modules/collab/collab-rate-gate.spec.ts  ×6  (alias:6)
apps/api/src/modules/collab/collab-ready.controller.spec.ts  ×1  (cast:1)
apps/api/src/modules/collab/collab-reconnect-storm.spec.ts  ×3  (cast:3)
apps/api/src/modules/collab/collab-residency-reaper.spec.ts  ×6  (cast:6)
apps/api/src/modules/collab/collab-runtime-metrics.spec.ts  ×4  (cast:4)
apps/api/src/modules/collab/collab-sentry.spec.ts  ×9  (cast:9)
apps/api/src/modules/collab/collab-shrink.spec.ts  ×67  (cast:30 alias:37)
apps/api/src/modules/collab/collab-t20-ripples.spec.ts  ×9  (cast:1 alias:6 spyOn:2)
apps/api/src/modules/collab/collab-upgrade.spec.ts  ×8  (cast:7 spyOn:1)
apps/api/src/modules/collab/collab-version-gate.spec.ts  ×1  (cast:1)
apps/api/src/modules/collab/collab-write-endpoint.int.spec.ts  ×2  (cast:2)
apps/api/src/modules/collab/collab.gateway.auth-reason.spec.ts  ×2  (cast:2)
apps/api/src/modules/collab/collab.gateway.persist-status.spec.ts  ×27  (cast:19 alias:8)
apps/api/src/modules/collab/collab.gateway.project-gone.spec.ts  ×15  (alias:14 cast:1)
apps/api/src/modules/collab/collab.gateway.shutdown.spec.ts  ×14  (cast:12 spyOn:2)
apps/api/src/modules/collab/collab.gateway.spec.ts  ×135  (alias:82 cast:46 spyOn:7)
apps/api/src/modules/collab/collab.gateway.sweep.spec.ts  ×26  (cast:26)
apps/api/src/modules/collab/telemetry.controller.spec.ts  ×1  (cast:1)
apps/api/src/modules/collab/write-frozen-chain.int.spec.ts  ×1  (cast:1)
违规总数 = 534（31 文件）
```
