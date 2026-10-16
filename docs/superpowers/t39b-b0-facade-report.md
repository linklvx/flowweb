# T39b B0 测试基座落档报告（Y0c 片 B 波 1——步骤 0 清单+收敛比+门禁基座+试点验证）

> 执行时点：2026-10-16（HEAD=1d004ca8 基线；**波 1 评审勘正轮**=b335d94f 后收口修复——I-1 受体
> 限定+词面扩面/I-3 三形态检测扩展/M-1 @ts-ignore/M-2 get-set 排除/重基线，偏离 62 行号勘正+63 号）。重跑命令：
> - 步骤 0 枚举/三列清单/触达统计：`node scripts/check-collab-test-facade.mjs --report`
> - 门禁（登记红对账）：`node scripts/check-collab-test-facade.mjs`（verify 链 id=check-collab-test-facade，census 邻位 fast 外）
> - 门禁自测：`node --test scripts/check-collab-test-facade.test.mjs`（29 例）
> 注意：--report 输出随替换推进滚动变化（基线态=**重基线后 538 处/29 文件**——勘正轮前旧口径
> 534/31 见 git 历史 b335d94f；波 1 试点后=403 处/28 文件；**波 2 终态=78 处/15 文件——全部
> 直调族保留 cast（登记 until='B1-B3'），替换 325 处，见 §8**）。
> 本文「步骤 0 基线」节=波 1 替换前全量快照（附录全文=勘正轮重跑输出；旧 534 快照留 git 历史）；偏离登记=spec §0.6 62 号+63 号（勘正轮）。

## 1. 门禁口径（违规定义终态——写死于脚本头注）

违规 = **绕过类型系统访问 gateway 内部状态** = cast 形态 ∧ gateway 私有成员触达（Z140② 合取语义）：

- cast 形态 ∈ { `as any`、`as unknown as`、`@ts-expect-error`、`@ts-ignore`（M-1 勘正轮扩展——Z140② 同族绕过形态，eslint 无 ban-ts-comment 兜底；偏离 63） }（现状实测：`as unknown as` **活命中 ×3**——collab-reconnect-storm :79/:126/:132 `(kit.gateway as unknown as { authInflightPeak: number }).authInflightPeak` 形态=**Z140② 换写法防线的正面实证**〔勘正轮前本行误记「零后置成员访问」——I-2 勘正〕；`@ts-expect-error`/`@ts-ignore` 现态零命中=前置防线，自测钉正例）
- 成员 universe = 脚本现场解析 collab.gateway.ts 的 `private` 声明（字段+方法+static 常量+构造器参数属性+get/set 访问器名〔M-2：修饰词跳过——`private get x()` 的 `get` 入集会让所有 `.get(` cast 链误报；现 gateway 零 private 访问器=universe 不变 191〕）=**191 个 distinct**（gateway 演进自动跟随，零人工名单）
- 检测规则（勘正轮终态）：R1 直接 cast 成员链（跨行/`?.`/`['member']` 括号计算访问〔I-3①〕/平衡括号/类型名跳过≤1）+**受体限定**（I-1：cast 链受体须含 gateway 词面 `/gateway|\bgw/i` ∨ gateway 别名/型化局部名——universe 含 logger/repo/transition/quota 等通用名，对象无关检测=8 处假阳性实锤根修；评审原案窄词面 `\bgw\b|\bgateway\b` 丢 6 真阳性〔CollabGateway 类名静态 ×2/gw2 ×2/别名受体 ×2〕⇒实测裁决扩面）｜R2 gateway any 别名 `alias.member` 逐处（三形态：const 初始化/`: any` 注解/I-3③ 赋值语句；RHS 资格=**头部**标识符链 gateway 词面〔深层构造参数词面不算——controller=new CollabReadyController(…gatewayMock as any…) 假阳性根修〕∧ cast/:any；免 cast 型化局部另集仅供 R1 受体判定——公有 DTO/façade 转发对象同名成员裸读不误计〔degraded ×7/试点 ×9 实锤〕）+R2b 解构形态（I-3②：`const { member } = gateway as any` 属性键 ∈ universe 逐处）｜R3 `spyOn(cast|别名|gateway 词, '私有方法名字符串')`｜R4 ts 指令（@ts-expect-error/@ts-ignore，kind=ts-directive）下一行成员触达（与 R1-R3 同行去重）
- **已知边界（I-3④ 披露）**：函数参数别名 `function f(g: any) { g.pendingQueues }` + 调用点传入 gateway=已知逃逸面——行级符号检测不可行（需数据流分析），波 2 全量替换纪律+评审承担，自测钉逃逸实证；同族近似（波 2 勘正——偏离 64 R2①）：RHS **头部属性链**词面（`x = harness.gateway as any`）实测**入别名集且检出**（头部标识符链含 gateway 词面即资格）；真实逃逸形态=**调用断链**（`x = buildKit().gateway as any`——头部词面=buildKit 不含 gateway，`(...)` 后属性链不回溯）；二级别名不传播（现状零出现）
- 非违规面：payload cast（`} as any)`）、mock 链（`(repo.append as any).mock`）、非 gateway 受体对象（`(kit.spool as any).ioBroken`/`(fx.residency as any).logger`/`(controller as any).logger`——spool/residency 私有面归后续任务）、gateway 公有成员冗余 cast（`(gateway as any).server/hooks`）、公有方法 DTO 同名字段裸读（`gateway.computeDegraded().oldestUnflushedAt`——无 cast 非绕过）、façade 直调转发（`gatewayFacade(gw).listenCollab()`=sanctioned 面）
- 执法范围 = `apps/api/src/modules/collab/*.spec.ts` 顶层 75 文件（含 *.int.spec.ts；**collectSpecFiles 非递归**〔M-6 披露：collab 子目录 spec 现无、出现时执法面需扩——偏离 62① 同口径〕；collab 域外 spec 经 grep 实证零 gateway 私有触达；扩面复验归 B 出口 T43）
- 豁免面 = test-utils/collab-gateway-test-facade.ts 本体（唯一 sanctioned 绕点——非 .spec 后缀天然出扫描面，脚本 assert 自证不混入；落位 test-utils/=偏离 62④ 勘正——RB2 原路径会被 nest build 编入 dist，test-utils 目录=tsconfig 结构性排除+dist 门禁覆盖）
- 登记红 = 文件级单 symbol `'facade-bypass'`，reconcileRegisteredRed（census :267）复用三向对账；until='T39b-2'（波 2）；计数降=drift 红强制同步、清零=stale 红强制移除、终态登记空

## 2. 步骤 0 基线（波 1 评审勘正轮**重基线**实测——以重跑脚本输出为权威；旧口径 534/31 快照留 git 历史 b335d94f 附录）

- **M1（触达处数=违规点）= 538**；**M2（distinct 触达成员）= 88**；触达文件 **29/75**
- 重基线推导（新检测规则下重建波 1 替换前全量态实测）：旧口径 534 −8（I-1 受体限定假阳性根修：residency-reaper ×6/ready.controller ×1/telemetry.controller ×1——三文件清零出表）+12（词面扩面真绕过回收：shrink `gw2 as any` 别名 ×6/sweep 解构 perm ×1/read-canvas-routing `makeGateway() as any` 别名 ×5——旧窄词面 `\bgateway\b` 漏 camelCase 工厂名）= **538**；旧 gateway.spec ×135 保持（`(makeBareGateway() 型化局部 as any).selfIsolate` 形态经型化局部受体判定回收）
- kind 分布：cast 325 / alias 196 / spyOn 17（合计 538）
- top 触达成员：pendingQueues 100｜persistRetry 28｜docTruth 27｜collabState 23｜lastCompactAt 21｜quotaFrozenDocs 16｜sweepIntervalMs 14｜docDelta 14｜docStatusRev 14｜docProject 14｜startSessionSweep 13｜loadDocument 11
- 归属分布（三列清单第二列，Z24 地图，零 UNMAPPED）：Persistence 218 处｜SessionGuard 131 处｜DocRegistry 130 处｜不搬 59 处（全量逐成员表见附录）
- 评审参考数字（kind cast 333/alias 184/spyOn 17；归属 213/130/124/67=534）与本次重跑实测不一致——按任务口径「以重跑脚本输出为权威」，本节数字为唯一权威基线
- v8 旧基准（245/18、368/20、436、1659/51）与实测全部对不上——按 plan「精确数以步骤 0 输出为准」原则同样适用于勘正轮

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

类型面：读面字段 `CollabGateway['member']` 索引访问单源（成员演进=编译红漂移面）；内部受控 cast 集中单点（internals()/methods() 两函数）。M-5 勘正轮收紧：forceCollabState 入参 `(state: string)`→`CollabGateway['collabState']` 联合型（typo 即编译红=façade 类型面收益兑现，内部 cast 消失）；pendingQueueRef/persistRetryEntry/seedPersistRetry 手写形状改索引访问派生（`ReturnType<GatewayInternals['pendingQueues']['get']>` 等——两者均可派生，零手写漂移面）。

## 4. 试点替换验证（collab.gateway.spec.ts 全文件）

- 违规 135 → **0**（门禁 stale 红强制核销登记——机制实证）；diff 174+/173-
- **90/90 用例全绿**；四处身份契约（现行号 :698 firstRef/:1233+:1295 tailRef/:1312 before/:1334+:1339 before/:1395 qBefore——toBe 数组身份断言**注释与断言原样**；行号=M-3 勘正轮 grep 实测，旧记 :1231/:1293/:1310/:1332/:1336-7/:1393 系漂移）全部经 façade 仍绿：pendingQueueRef/RefForDoc 返回真实引用，q.unshift/q.splice 折并交织装置直接操作真实数组
- 剩余 `as any` 77 处全为合法面（payload cast/mock 链/public 成员冗余 cast——精准修改不动）
- 试点发现的形态事实：①computePending(:1669)/handoffPendingToSpool(:2593)/beginDraining 实为 **public**——不入 façade，直调公有（`(g as any).collabState` 读点同理改公有 getCollabState()）②别名 `const g = kit.gateway as any` 是主流触达形态（82/135）——R2 规则必要性的实证③façade 缺口两处现场扩（pendingQueueRefForDoc 两跳归并/persistRetrySize）——操作化归并原则未破④**类型面恢复的首个实证**：api-tsc-scripts（spec 类型检查面——主 tsconfig 排除 spec）暴露 `spyStoreSerialized().mockResolvedValue(undefined)` 类型红（storeDocumentSerialized 真型 Promise<boolean>，any 时代宽松不红）——修=运行时逐字保留断言 `undefined as unknown as boolean`+注释（波 2 替换将系统性暴露同族类型债，属 façade 收益非成本）

## 5. N/M 收敛比（两口径）+ 重裁建议

| 口径 | 波 1 现值（勘正轮重基线口径） | 波 2 终态预估 | 判读 |
|---|---|---|---|
| N/M1（触达处数） | 41/538 = **0.076**（试点文件口径 41/135=0.30） | ~85/538 ≈ **0.16** | 实质收敛（pendingQueues 100 处→6 方法） |
| N/M2（distinct 成员） | 41/88 = 0.47 | ~85/88 ≈ **0.97** | **≈1:1**——结构性事实：直调族成员（~25 个：startSessionSweep/loadDocument/maybeCompact/wirePermChangedEvents/recheckConnection…约 130/538≈24% 触达处）转发即操作本体，无归并空间；字段族（Map/Set ~76% 触达处）平均 2-4 操作归并 |

**如实报告**：按「方法数缩减」判据，直调族部分=1:1 映射垫片形态。但收益结构不在方法数：①类型面恢复（façade 方法全型——spec 触达代码回到 tsc 检查面）②sanctioned cast 集中单点③索引访问类型单源=gateway 演进编译红跟随④三列清单=B1/B2/B3 切分地图原料。

**波 2 重裁建议（控制方裁决项）**：关键洞察——B1/B2/B3 service 化后，现私有**方法**将成为 service 公有方法，直调族 cast 自然消失（波 2 先行 façade 化直调族=二次工作）。两个选项：
- **(a) 全量替换**：403 处全 façade 化（含直调族 ~80 处）——门禁登记清零彻底，但直调族 façade 方法在 B1-B3 后废弃
- **(b) 收窄替换（推荐）**：波 2 只替换字段/状态族（~320 处——收敛收益主体），直调族 ~80 处登记红改 until='B1-B3'（service 拆分时随公有化自然消除+登记同步核销）——省 ~25 个短命 façade 方法

## 6. 波 2 剩余工作量分级（28 文件×403 处——按触达数排序；难度=触达密度×形态复杂度；勘正轮重基线口径：−8 假阳性〔reaper/ready.controller/telemetry.controller 三文件出表〕+12 真绕过回收〔shrink+6/sweep+1/read-canvas-routing+5 新入表〕）

| 文件（collab/ 前缀省略） | 触达 | kind | 难度 |
|---|---|---|---|
| collab-shrink.spec.ts | 73 | cast30+alias43 | 高（docTruth/quotaFrozenDocs/docStatusRev 多成员交织+vacuum 预演装置+gw2 工厂别名族） |
| collab-quota-truth.spec.ts | 41 | cast41 | 中（docTruth/docDelta/truthMeasuredAt 三件套+lastCompactAt） |
| collab-metrics-observability.spec.ts | 32 | cast29+spyOn3 | 中（maybeCompact/storeDocumentUnlocked 直调+heapUsedNow spy） |
| collab-auth-defense.spec.ts | 30 | cast24+alias6 | 中（refusalCache/transition/permCache+withAuthDeadline） |
| collab-perm-events.spec.ts | 29 | cast28+spyOn1 | 中（socketIdentity/wirePermChangedEvents/sweepSessions） |
| collab.gateway.persist-status.spec.ts | 27 | cast19+alias8 | 中（persistUnhealthy/persistRetry/docEpoch） |
| collab.gateway.sweep.spec.ts | 27 | cast26+alias1 | 中（sweepIntervalMs/startSessionSweep/connEstablishedAt+解构 perm 提取×1） |
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
| read-canvas-routing.spec.ts | 5 | alias5 | 低（makeGateway() as any 工厂别名——勘正轮词面扩面回收的旧逃逸） |
| collab-degraded.spec.ts | 4 | cast4 | 微 |
| collab-pg-breaker.int.spec.ts | 4 | cast4 | 微 |
| collab-runtime-metrics.spec.ts | 4 | cast4 | 微 |
| collab-reconnect-storm.spec.ts | 3 | cast3 | 微 |
| collab-write-endpoint.int.spec.ts | 2 | cast2 | 微 |
| collab.gateway.auth-reason.spec.ts | 2 | cast2 | 微 |
| collab-backpressure/collab-perm-chain/collab-version-gate/write-frozen-chain.int（4 文件） | 各 1 | cast1 | 微 |

façade 波 2 扩展预估：字段/状态族 ~30 方法（docTruth/docDelta/quotaFrozenDocs/docStatusRev/sweepIntervalMs/refusalCache/clientIdOwner/socketIdentity/overPush/permCache/connectionIds/degradedDocs/truthMeasuredAt/freezePending/thawCooldown/docResidue/docGeneration/preVacuumSvCache/docStatusState/authAttemptBuckets/authInflightPeak/awarenessDriftLogged/oldestUnflushedAt 族等）+直调族 ~25 方法（选项 (a) 时；选项 (b) 免）。

## 7. 出口链数字（波 1 评审勘正轮复验；原波 1 出口记录属 git 历史 b335d94f）

- 门禁自测 **29/29 绿**（+11 例：I-1 受体限定族 ×5〔非 gateway 受体放行/gateway 受体命中/词面扩面三形态/DTO-façade 假阳性钉/别名 RHS 词面扩〕、I-3 四形态 ×4、M-1、M-2；另 R4 既有用例 kind 断言随 ts-directive 更名同步）｜scripts-node-test 全列举 **187/187 绿**（176+11；verify-chain 元测试含——26 步基线常量本轮零触碰）
- 门禁登记态 **PASS exit 0**（403 处/28 文件/28 项登记红 until=T39b-2——重基线：reaper/ready.controller/telemetry.controller 三项清零 stale 核销+shrink 67→73/sweep 26→27 drift 同步+read-canvas-routing ×5 新登记）
- api tsc spec 面（tsconfig.spec.json）--noEmit 绿（M-5 类型收紧后 façade+试点 spec）
- collab.gateway.spec.ts **90/90 绿**（身份契约断言原样——M-5 后复验）
- census **23/23 PASS**（exit 0）｜pnpm verify:fast PASS
- 勘正轮零 spec 运行时改动（façade 纯类型面+脚本/文档），collab 目录全量 818 用例绿记录沿用 b335d94f 波 1 出口

## 附录：步骤 0 基线 --report 全文（**波 1 评审勘正轮重基线快照**=波 2 替换前全量态——2026-10-17 重跑；旧 534/31 口径快照留 git 历史 b335d94f 本文件附录）

```
# check-collab-test-facade --report（步骤 0 枚举——重跑命令：node scripts/check-collab-test-facade.mjs --report）
# universe：collab.gateway.ts 私有成员 191 个（脚本现场解析——gateway 演进自动跟随）
# 执法面：apps/api/src/modules/collab/*.spec.ts 75 文件；豁免面：apps/api/src/modules/collab/test-utils/collab-gateway-test-facade.ts（唯一 sanctioned 绕点，非 spec 后缀天然出圈）

## 触达统计（M 双口径=执法口径单源）
M1（触达处数=违规点数）= 538
M2（distinct 触达成员数）= 88
触达文件数 = 29/75

## 三列清单（成员 → 所属目标 service〔Z24〕 → 访问形态）
| 成员 | 归属 | 触达数 | 形态分布 | 触达文件（top3） |
|---|---|---|---|---|
| pendingQueues | Persistence | 100 | 读61/写39 | collab.gateway.spec.ts:56, collab-shrink.spec.ts:8, collab-quota-truth.spec.ts:7 |
| persistRetry | Persistence | 28 | 读22/写4/引用2 | collab.gateway.spec.ts:14, collab.gateway.persist-status.spec.ts:9, collab.gateway.project-gone.spec.ts:3 |
| docTruth | DocRegistry | 27 | 读16/写11 | collab-shrink.spec.ts:12, collab-quota-truth.spec.ts:10, collab-quota-gate.spec.ts:3 |
| collabState | 不搬 | 23 | 赋值写21/引用2 | collab.gateway.spec.ts:4, collab-auth-defense.spec.ts:3, collab.gateway.auth-reason.spec.ts:2 |
| lastCompactAt | Persistence | 21 | 写19/读2 | collab.gateway.spec.ts:9, collab-metrics-observability.spec.ts:7, collab-quota-truth.spec.ts:2 |
| quotaFrozenDocs | DocRegistry | 16 | 读14/写2 | collab-shrink.spec.ts:10, collab-quota-gate.spec.ts:5, collab-t20-ripples.spec.ts:1 |
| sweepIntervalMs | SessionGuard | 14 | 赋值写13/引用1 | collab.gateway.sweep.spec.ts:10, collab-auth-defense.spec.ts:3, collab-perm-events.spec.ts:1 |
| docDelta | DocRegistry | 14 | 写4/读10 | collab-quota-truth.spec.ts:8, collab-shrink.spec.ts:4, collab-metrics-observability.spec.ts:1 |
| docStatusRev | DocRegistry | 14 | 读12/写2 | collab-shrink.spec.ts:10, collab-quota-gate.spec.ts:4 |
| docProject | Persistence | 14 | 读12/写2 | collab.gateway.spec.ts:11, collab.gateway.persist-status.spec.ts:2, collab.gateway.shutdown.spec.ts:1 |
| startSessionSweep | SessionGuard | 13 | 直调13 | collab.gateway.sweep.spec.ts:10, collab-auth-defense.spec.ts:3 |
| loadDocument | DocRegistry | 11 | 直调11 | collab-metrics-observability.spec.ts:4, collab-heap-gate.spec.ts:2, collab-shrink.spec.ts:2 |
| clientIdOwner | SessionGuard | 9 | 读9 | collab-awareness-guard.spec.ts:9 |
| logger | 不搬 | 9 | 引用9 | collab.gateway.spec.ts:4, collab-awareness-guard.spec.ts:1, collab-metrics-observability.spec.ts:1 |
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
| inFlightProjects | Persistence | 4 | 写3/读1 | read-canvas-routing.spec.ts:2, collab.gateway.project-gone.spec.ts:1, collab.gateway.spec.ts:1 |
| selfIsolate | 不搬 | 4 | 直调4 | collab.gateway.spec.ts:4 |
| heapUsedNow | DocRegistry | 3 | spyOn直调3 | collab-metrics-observability.spec.ts:3 |
| repo | Persistence | 3 | 赋值写1/引用2 | collab-shrink.spec.ts:2, collab-pg-breaker.int.spec.ts:1 |
| freezeQuota | DocRegistry | 3 | 直调3 | collab-shrink.spec.ts:3 |
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
| docStatusState | DocRegistry | 2 | 写2 | collab-shrink.spec.ts:2 |
| recheckRounds | SessionGuard | 2 | 写2 | collab-shrink.spec.ts:1, collab-t20-ripples.spec.ts:1 |
| docResidue | DocRegistry | 2 | 写2 | collab-shrink.spec.ts:1, collab-t20-ripples.spec.ts:1 |
| handleUpgrade | SessionGuard | 2 | 直调2 | collab-upgrade.spec.ts:2 |
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
| perm | SessionGuard | 1 | 引用1 | collab.gateway.sweep.spec.ts:1 |

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
apps/api/src/modules/collab/collab-reconnect-storm.spec.ts  ×3  (cast:3)
apps/api/src/modules/collab/collab-runtime-metrics.spec.ts  ×4  (cast:4)
apps/api/src/modules/collab/collab-sentry.spec.ts  ×9  (cast:9)
apps/api/src/modules/collab/collab-shrink.spec.ts  ×73  (cast:30 alias:43)
apps/api/src/modules/collab/collab-t20-ripples.spec.ts  ×9  (cast:1 alias:6 spyOn:2)
apps/api/src/modules/collab/collab-upgrade.spec.ts  ×8  (cast:7 spyOn:1)
apps/api/src/modules/collab/collab-version-gate.spec.ts  ×1  (cast:1)
apps/api/src/modules/collab/collab-write-endpoint.int.spec.ts  ×2  (cast:2)
apps/api/src/modules/collab/collab.gateway.auth-reason.spec.ts  ×2  (cast:2)
apps/api/src/modules/collab/collab.gateway.persist-status.spec.ts  ×27  (cast:19 alias:8)
apps/api/src/modules/collab/collab.gateway.project-gone.spec.ts  ×15  (alias:14 cast:1)
apps/api/src/modules/collab/collab.gateway.shutdown.spec.ts  ×14  (cast:12 spyOn:2)
apps/api/src/modules/collab/collab.gateway.spec.ts  ×135  (alias:82 cast:46 spyOn:7)
apps/api/src/modules/collab/collab.gateway.sweep.spec.ts  ×27  (cast:26 alias:1)
apps/api/src/modules/collab/read-canvas-routing.spec.ts  ×5  (alias:5)
apps/api/src/modules/collab/write-frozen-chain.int.spec.ts  ×1  (cast:1)
违规总数 = 538（29 文件）
```

---

# 波 2 执行记录（2026-10-17——偏离 64 收窄裁决落地；façade 门禁全量机械替换 B0 收口）

> 起点=403 处/28 文件/28 项登记（until='T39b-2'）；终点=**78 处/15 文件/15 项登记（全部 until='B1-B3'
> =仅直调族）**；替换 325 处、13 文件清零 stale 核销。commit 链：15b8cf9e（基座+微档）→dec06f6f
> （低档）→d1eee575（中档）→本文件落档 commit（高档 shrink+报告）。生产代码零改动（`git diff
> 3ef63ceb --name-only` 实测：26 spec+façade+门禁脚本+spec §0.6+本报告——collab.gateway.ts/service
> 面一行未碰；façade 模块扩方法=偏离 64 授权面）。

## 8. 逐文件替换表（原登记数=波 1 勘正轮重基线口径；替换+保留=原登记数 精确对账）

| 文件（collab/ 前缀省略） | 原登记 | 替换 | 保留直调（until=B1-B3） | 保留成员明细 | 该文件 vitest |
|---|---|---|---|---|---|
| collab-shrink.spec.ts | 73 | 67 | 6 | freezeQuota×3+scheduleFreezePending×1+loadDocument×2 | 26/26 绿 |
| collab-quota-truth.spec.ts | 41 | 36 | 5 | loadDocument×1+maybeCompact×2+unloadDocument×2 | 12/12 绿 |
| collab-metrics-observability.spec.ts | 32 | 15 | 17 | loadDocument×4+maybeCompact×7+storeDocumentUnlocked×3+unloadDocument×2+logDocTopN×1 | 16/16 绿 |
| collab-auth-defense.spec.ts | 30 | 23 | 7 | startSessionSweep×3+heapPressureSample×2+withAuthDeadline×2 | 28/28 绿 |
| collab-perm-events.spec.ts | 29 | 16 | 13 | sweepIntervalMs bind 读点×1+wirePermChangedEvents×7+sweepSessions×3+guardAwareness×2 | 19/19 绿 |
| collab.gateway.persist-status.spec.ts | 27 | 27 | 0（登记移除） | — | 全量批绿 |
| collab.gateway.sweep.spec.ts | 27 | 17 | 10 | startSessionSweep×10 | 16/16 绿 |
| collab-quota-gate.spec.ts | 25 | 25 | 0（登记移除） | —（freezeDoc(gw:any) 参数别名内 freezeQuota 直调=I-3④ 已知逃逸面，直调族同款保留至 B1-B3——门禁不计数、纪律面披露） | 18/18 绿 |
| collab.gateway.project-gone.spec.ts | 15 | 15 | 0（登记移除） | — | 全量批绿 |
| collab.gateway.shutdown.spec.ts | 14 | 11 | 3 | drainAllDocuments×3 | 全量批绿 |
| collab-awareness-guard.spec.ts | 12 | 12 | 0（登记移除） | — | 全量批绿 |
| collab-heap-gate.spec.ts | 9 | 7 | 2 | loadDocument×2 | 全量批绿 |
| collab-pg-breaker.service.spec.ts | 9 | 9 | 0（登记移除） | — | 全量批绿 |
| collab-sentry.spec.ts | 9 | 9 | 0（登记移除） | — | 全量批绿 |
| collab-t20-ripples.spec.ts | 9 | 6 | 3 | recheckFrozenDocs×3 | 全量批绿 |
| collab-upgrade.spec.ts | 8 | 3 | 5 | clientIpOf×3+handleUpgrade×2 | 全量批绿 |
| collab-rate-gate.spec.ts | 6 | 6 | 0（登记移除） | — | 全量批绿 |
| read-canvas-routing.spec.ts | 5 | 5 | 0（登记移除） | — | 全量批绿 |
| collab-degraded.spec.ts | 4 | 3 | 1 | loadDocument×1 | 5 文件批绿 |
| collab-pg-breaker.int.spec.ts | 4 | 4 | 0（登记移除） | — | int 链绿 |
| collab-runtime-metrics.spec.ts | 4 | 1 | 3 | loadDocument×1+storeDocumentUnlocked×2 | 6/6 绿 |
| collab-reconnect-storm.spec.ts | 3 | 3 | 0（登记移除） | —（authInflightPeak Z140② 活命中三处归状态台账组） | 1/1 绿 |
| collab-write-endpoint.int.spec.ts | 2 | 1 | 1 | clearDrainTimer×1 | int 链绿 |
| collab.gateway.auth-reason.spec.ts | 2 | 2 | 0（登记移除） | — | 12/12 绿 |
| collab-backpressure.spec.ts | 1 | 0 | 1 | wrapBackpressure×1（文件零改动，仅登记改 until） | 全量批绿 |
| collab-perm-chain.spec.ts | 1 | 1 | 0（登记移除） | — | 5 文件批绿 |
| collab-version-gate.spec.ts | 1 | 1 | 0（登记移除） | — | 5 文件批绿 |
| write-frozen-chain.int.spec.ts | 1 | 0 | 1 | recheckFrozenDocs×1（文件零改动，仅登记改 until） | int 链绿 |
| **合计** | **403** | **325** | **78（15 文件）** | 20 distinct 直调族成员 | **75 文件 818 用例绿** |

保留直调族 20 成员（B1-B3 service 化公有化后 cast 自然消失⇒门禁 stale 红强制核销登记）：
startSessionSweep 13｜loadDocument 11｜maybeCompact 9｜wirePermChangedEvents 7｜storeDocumentUnlocked 5｜
unloadDocument 4｜recheckFrozenDocs 4｜freezeQuota 3｜sweepSessions 3｜clientIpOf 3｜drainAllDocuments 3｜
heapPressureSample 2｜withAuthDeadline 2｜handleUpgrade 2｜guardAwareness 2｜scheduleFreezePending 1｜
wrapBackpressure 1｜clearDrainTimer 1｜logDocTopN 1｜sweepIntervalMs(bind 读点) 1（合计=78）。

## 9. façade 终态（N=114 class 方法+gatewayFacade 工厂+1 模块级函数——实测口径；波 1 class 方法 40〔§3 表格口径 41 含工厂〕+波 2 扩 73。T40 W5 勘正：原记 N=113 系盘点漏计 1——文件实测 grep `^  \w+\(` 115 行−constructor=114；B1 改道 persistOf 不增减方法数）

波 2 新增 73 方法+1 模块函数（全部 R4 合规：entry 型索引访问派生/NonNullable<ReturnType<…>>、JSDoc「替代的成员访问形态」、新扩方法零新增内联 cast——受控 cast 收敛三单点 internals()/methods()/+波 2 新增 bucketInternals()（TokenBucket 私有 options/buckets 镜像）与 writeFreezeMap()（conn 键形态镜像））：

| 组 | 新方法 | 归并论证（触达点→操作） |
|---|---|---|
| DocRegistry 真值台账（12） | docTruthOf/docTruthHas/seedDocTruth/docDeltaOf/docDeltaHas/seedDocDelta/truthMeasuredAtOf/truthMeasuredAtHas/seedTruthMeasuredAt/degradedDocsHas/addDegradedDoc/docEpochOf | 三件套读写 45+ 触达点归并 9 操作（Of/Has/seed 三形态=波 1 pendingQueues 族同款动词前缀） |
| 配额冻结台账（13） | quotaFrozenHas/addQuotaFrozen/freezePendingHas/addFreezePending/thawCooldownHas/seedThawCooldown/seedRecheckRounds/docStatusRevOf/seedDocStatusRev/seedDocStatusState/seedDocGeneration/seedDocResidue/seedPreVacuumSv | shrink 普查播种块 15 连发+quota-gate/t20 冻结断言 30+ 触达点 |
| Persistence 扩（8） | clearLastCompactAt/pendingSinceOf/persistRetryNames/deletedProjectsHas/addInFlight/removeInFlight/repoRef/stubRepo | persistRetryNames=枚举形态归并（shutdown `for…of [...Map]` ×2）；repoRef/stubRepo=身份引用/整体替换（pendingQueueRef/stubSpool 先例） |
| SessionGuard 台账（26） | refusalCacheSize/seedRefusal/authInflightPeak/resetAuthInflightPeak/seedPermCache/evictPermCache/seedConnectionId/connectionIdOf/connectionIdHas/clientIdOwnerHas/clientIdOwnerOf/clientIdOwnerSize/ownedClientIdsOfClient/seedSocketIdentity/socketIdentityOf/socketIdentityHas/addAwarenessDriftLogged/awarenessDriftLoggedHas/seedConnEstablishedAt/connEstablishedAtHas/seedAuthAttemptBucket/authAttemptBucketHas/seedOverPush/overPushHas/overPushStates/writeFreezeHas | ownedClientIdsOfClient=两跳归并单操作（awareness-guard :129 双触达合一——pendingQueueRefForDoc 先例）；overPushStates 返回**活 entry 引用数组**（quota-gate `st.firstAt -= 10_000` 白盒改写直落台账——身份语义保留） |
| 限流桶操作化（5） | consumeUpgradeBucket/bytesBucketCapacity/consumeBytesBucket/bytesBucketTokens/rateBucketHasKey | rateBucketHasKey 三桶三形态一操作归并（rate-gate :208 三触达合一） |
| stub 族扩（2） | pgBreakerRef/stubSweepInterval | pgBreakerRef=身份引用（recordFailure/recordSuccess/stateName 均 breaker **公有**面——4 触达点一 Ref；auth-defense/pg-breaker.service 的 `as CollabPgBreakerService` cast 消失）；stubSweepInterval=方法实例属性遮蔽（stubTransition 先例——赋值写 13 触达点） |
| spy 组扩（7） | spyHeapUsedNow/spyPeekSpoolFrames/spySweepSessions/spyMeasureTruth/spyUpdateResidue/spyAllowedOrigins/spyGraceDirectConnections | R3 检测 17 处 spyOn 形态覆盖度自查：波 1 5 方法覆盖 7 处（gateway.spec 已清）+波 2 扩 7 方法覆盖 10 处缺口（已知陷阱条「缺口按 R4 扩」字面执行）；spyLogger level 面扩 'log'（sentry/metrics-obs 结构化日志断言） |
| 模块级（1） | authDbDeadlineMs() | `(CollabGateway as any).AUTH_DB_DEADLINE_MS` 类名静态私有常量读 ×2——静态面不依赖实例=façade 唯一非 class 方法出口 |

## 10. 类型债修复清单（R3——api-tsc-scripts 面暴露；全部纯类型面，运行时语义逐字保留）

| 位置 | 形态 | 修法 |
|---|---|---|
| persist-status :125 | `clearTimeout(entry.timer)`——entry 型化后 timer 含 null（any 时代宽松） | `clearTimeout(entry.timer!)`（波 1 偏离 62⑥ 同款先例；null 传入 clearTimeout 运行时 no-op 不变） |
| persist-status/shutdown/quota-truth/degraded/shrink 队列取回 | `.get(…)` any→`Uint8Array[]\|undefined` 后 `.push/.splice/.length` | `pendingQueueRef(…)!` 非空断言（原代码缺条目即 TypeError=红；断言纯编译期） |
| quota-truth/shrink/quota-gate truth/rev 读点 | `as number` cast→索引派生 `number\|undefined` | `docTruthOf(…)!`/`docStatusRevOf(…)!`/声明点 `overRev!`（undefined+1=NaN 语义 any 时代同款） |
| awareness-guard :129/:198-199 | `as Set<number>`/`as string` 载荷 cast | `ownedClientIdsOfClient(301)!`/`clientIdOwnerOf(…)!` |
| rate-gate :121/:198 | 别名去 any 化后 `doc()` 型化 `Document\|undefined` | `doc()!.connections`（pollUntil 已保证存在——原 any 遮蔽同语义） |
| sweep :173 | 解构去 `as any` 后 `mockResolvedValue({ role: null })` 对推断型 `{role: string}` 不赋 | 载荷 `as never` 型收窄（对象字面量逐字保留——运行时零变化） |

无法保持运行时语义的修复：**零**（未触发「停下问」条款）。

## 11. 终态门禁输出+出口链数字（2026-10-17 实测）

- 门禁：`node scripts/check-collab-test-facade.mjs` **PASS exit 0**——`现状违规 78 处/15 文件；登记红 15 项 until=B1-B3`（**终态登记面=仅直调族**；until 值 header 现场聚合=偏离 64 伴生，双段/单段如实呈现）
- collab 全量：**unit 链 65 文件 782 用例+int 链 10 文件 36 用例=75 文件 818 用例全绿**（int 带 DATABASE_URL 真库；fileParallelism=false 串行）
- `pnpm verify:fast` **15 步 PASS**（含 api-tsc/api-tsc-scripts/web-tsc/shared 三件/check-migrate-diff+fresh-replay db 步）
- census **23/23 PASS**｜check-spec-consistency **OK**（denylist 7 零命中/env 73 键/metric 145 项）｜scripts-node-test 全列举 **187/187**｜门禁自测 **29/29**
- 生产代码零改动：`git diff 3ef63ceb --name-only` 全集=26 spec+façade+门禁脚本+spec §0.6（偏离 64）+本报告——collab.gateway.ts/service 面一行未碰

## 12. 执行期裁量与披露（单点自裁——大面积歧义零发生，未触发停下问）

- **sweepIntervalMs 双形态分治**：赋值写 13 处=stubSweepInterval（stub 族/stubTransition 先例）；perm-events :104 `.bind(gateway)` 原实现读取点=直调族保留（新建 `sampleSweepIntervalMs()` 即 1:1 转发垫片）。
- **spy 与直调同文件并存**（perm-events spySweepSessions 替换 :157 / sweepSessions 直调保留 :174/:177/:274）：两裁决面各自字面执行（spy 缺口按 R4 扩=已知陷阱条；直调 1:1 不转发=偏离 64②）——B1-B3 公有化后两侧同时消失。
- **别名族消除**：shrink gw2/g/g2、quota-gate g×9、rate-gate g×4、t20 g、persist-status g×2、sweep 解构 perm、read-canvas-routing makeGateway() as any——全部消除（替换后无残余触达的别名声明物理删除；quota-gate 公有成员冗余 cast `(kit.gateway as any).server/isVacuuming` 与 :429-497 直构 kit 面按精准修改原则保留不动=非门禁面）。
- **I-3④ 参数别名逃逸面残留**（如实披露不掩盖）：quota-gate `freezeDoc(gw: any)` 内 `gw.freezeQuota(pid)` 直调（门禁不计数）——直调族处置同款保留至 B1-B3；该形态是全量替换后唯一残存的参数别名逃逸点。
- **shrink 普查反射面**：`Object.entries(g)` 的 g=any 别名改 `Object.entries(gateway)`（façade 化不改枚举对象——反射语义逐字保留，15 播种全经 seed 方法）。
- 门禁误报：**零**（403→78 全程无一例假阳性主张——波 1 勘正轮执法面已收敛）。
