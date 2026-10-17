# T41（片 B·B2）SessionGuard+DocRegistry 切出——只读域分析与切分设计

> 性质：设计报告（只读分析产物，零生产代码改动）。唯一执行依据=specs/2026-10-13-y0c-y05-runtime-plane-design.md（片 B 目标形态表+Z24+偏离 65-68）+plans/2026-10-13-y0c-y05-runtime-plane.md T41 行。
> 行为零变化红线：本设计一切搬移=逐字平移+host 缝机械替换（B1/T40 同款）；任何断言修改=偏离登记。
> 枚举口径：全部行号/计数为 2026-10-17 现场实测（master，gateway 2658 行/residency 761 行/persistence 950 行/façade 799 行；`node scripts/check-collab-test-facade.mjs --report`=57 处/14 文件；`node scripts/check-collab-census.mjs`=23/23 PASS）。禁人估（Z140① 教训）——行数预估的构成明细见 §7，实测重标以 W5 出口为准（偏离 65 裁决）。

## 0. 结论摘要

- **切分骨架**：`CollabSessionGuardService`（collab-session-guard.service.ts，预估 ≈1070 行）+ `CollabDocRegistryService`（collab-doc-registry.service.ts，预估 ≈1030 行）+ gateway 本体余量（预估 ≈950-1100 行）。三锚按偏离 65 裁决以 B2 完成时实测重标（一次性适用免逐个再问）。
- **residency 并入**：推荐**候选 B（组合持有=域归属搬迁，residency 文件/类/DI/直构面/注册缝零改动）**——P1「搬迁非重写」最小字面形态；候选 A（文本吸收）被否（§3）。
- **同步块链**：三条链（fenced→selfIsolate→closeAll→spool 入账 / drain / 关停步骤 0）全部以 gateway 本体为唯一编排点，跨域动作=同步缝调用或 inline await——**不切两半**（§2 逐链核验）。
- **停下问项**：RC1-RC6（§10），其中 RC1（residency 并入形态）与 RC2（quota 执法链归属）为边界级分歧，需控制方裁决后 W2 才可偏离登记。

## 1. 成员三列清单（成员 → 归属 → 依据）

归属判定单源=Z24「按状态所有权界定边界」：**状态的写点/清理点所在域=所有者**；行号区间仅体量参考。域缩写：SG=CollabSessionGuardService，DR=CollabDocRegistryService，GW=gateway 本体保留，GW*=委托语义位（本体 1 行转发，B1 8 委托位同款——非壳堆判据=既有外部消费方零触碰）。

### 1.1 SessionGuard 域（连接鉴权/限流/awareness 判定——状态键=socketId/connection 对象）

| 成员（gateway 现行号） | 归属 | 依据（状态所有权） |
|---|---|---|
| upgradeBucket :178 / msgBuckets :183 / bytesBuckets :184 / awareBuckets :186 | SG | 限流桶=per-IP/per-socketId 连接准入态；census ⑥ 四定义点随迁（§8） |
| refusalCache :682 / authInflight :683 / authInflightPeak :684 / authAttemptBuckets :685 | SG | 认证防线三层态（P-F/P-Q）；清空点：serving 转移汇点+PG 半开钩子+sweepStaleAuthMaps 全 SG 域 |
| connEstablishedAt :690 / connectionIds :694 | SG | socketId 键连接寿命/标识台账；写点=connected/auth 播种，清点=disconnect/unload/closeTeamDocuments（清理缝见 §4） |
| clientIdOwner :700 / ownedClientIds :701 / socketIdentity :702 / awarenessDriftLogged :704 | SG | E73 awareness 归属双索引+认证身份表（socketId/clientId 键） |
| permCache :708 / sweepGrace :356 / sweepRecheckFails :357 / sweepKickPending :2295 | SG | sweep 复验会话级结论缓存（connection 键 WeakMap） |
| writeFreeze :223 | SG | conn→原因集=连接级写许可状态（Q-A v5 单源）；DR 冻结族经缝 applyWriteFreeze 驱动（§4） |
| backpressureWrapped :1669 | SG | ws 对象键幂等 wrap 台账 |
| authMapsSweepTimer :705 / sessionSweepTimer :358 | SG | 域内定时器（老化/sweep 自排链） |
| REFUSAL_CACHEABLE :717 / AUTH_DB_DEADLINE_MS :725 / PERM_RECHECK_TTL_MS :726 / AWARENESS_CLIENT_ID_LIMIT :2376（static） | SG | 判定常量随判定体迁 |
| handleUpgrade :611 / rejectUpgrade :633 / allowedOrigins :644 / trustedProxyEnabled :657 / clientIpOf :665 | SG | 升级面准入（§3.1ter）；clientIpOf=既有近纯函数（§5） |
| withAuthDeadline :727 / refusalTtlMs :740 / authAttemptsPerMin :741 / authInflightMax :742 | SG | AUTH 段超时+env 使用点默认值（census ㉒ 键随迁） |
| sweepStaleAuthMaps :749 / startAuthMapsSweeper :757 | SG | 防线 Map 老化（P-V⑦）；overPush 老化经 DR 缝 ageOverPush（§4） |
| denyAuth :792 / authenticate :834 / authenticateInner :881 | SG | 鉴权外壳+内层（§3.1bis 三层防线）；判定核纯函数化见 §5 |
| guardMessageFrame :1512 / guardAwarenessRate :2515 / guardAwareness :2395 / stripTransientFields :2498 / isEmptyState :2525 / serverIdentityOf :2531 | SG | awareness/帧判定族（E73/Q-K/Q-L）；guardMessageFrame 含 msg 桶（SG 所有） |
| wrapBackpressure :1671 / hardCloseWs :1653 / hardClose :1644 | SG | 连接关闭/背压协议适配（census ①⑤ 锚随迁）；hardClose 为 DR guardSyncFrame 消费→SG 公有+DR host 缝 |
| freezeReasons :1694 / applyWriteFreeze :1707 | SG | writeFreeze 单源读写（唯一出口）；census ⑪ applyWriteFreeze 体内 conn.readOnly 直写点随迁 |
| broadcastSpoolDegraded :1916 | SG | B1 归属注记原文已裁「通告载体=document.connections 广播面（SessionGuard/协议适配域）」（gateway :1915）；唯一消费=authenticateInner（SG 同域） |
| startSessionSweep :2200 / sweepIntervalMs :2213 / enforceConnMaxLifetime :2219 / connMaxLifetimeMs :2234 / sweepSessions :2236 / permRecheckDue :2268 / scheduleImmediateSweep :2296 / recheckConnection :2313 / scheduleSweepClose :2535 | SG | sweep 兜底+事件踢权链（P-K/T8）；perm-events :114+sweep :220 源码文本锚随迁（§8） |
| wirePermChangedEvents :2279 | SG | collab.perm.changed 监听（内存两步：permCache 失效+立即 tick）；GW onModuleInit 调用点改 `sg.wirePermChangedEvents()` |
| socketIdOf :2344 / ownedClientIdsOf :2345 / rewriteAwarenessRole :2357 | SG | T8 role 改写（awareness 归属表写者） |
| closeAllConnections1012 :2556 / closeTeamDocuments :2635 | SG | 连接批量关闭（协议适配）+connEstablishedAt 反查清理；消费=selfIsolate/shutdown（GW）与 handleProjectsGone（GW）经缝/公有 |
| overloadTripped :711 / heapPressureSample :800 / syncOverloadGauge :824 | SG | heap 闸=准入判定态（auth/装载两闸消费）；isHeapPressureTripped 委托位读此（RC3） |
| 【新增语义操作】onConnected / onDisconnectCleanup(socketId) / onDocUnloadCleanup(document) / clearAllWriteFreeze() / stopTimers() / clearRefusalCache() | SG | 钩子体清理块与关停清理行的机械提取载体（B1「10 新语义操作」同款——非新逻辑） |

### 1.2 DocRegistry 域（doc 生命周期账目——状态键=projectId/document 对象；含 residency 委托位）

| 成员（gateway 现行号） | 归属 | 依据（状态所有权） |
|---|---|---|
| docTruth :195 / docDelta :196 / truthMeasuredAt :197 / degradedDocs :198 / truthBudgetState :260 | DR | Q-B 真值三件套+降级标记+测量预算（pid 键 doc 账目）；persistence host 的 onUpdateDelta/calibrateTruth/observeDocBytes 三位实现改接 DR（§9⑤） |
| unloadHeapAnchors :201 / docTopNLogTimer :203 / docEpoch :207 | DR | 卸载边界锚+top-N 日志（数据源=docTruth/delta）+doc 代际 |
| quota :189（四值） | DR | 配额执法唯一落点 guardSyncFrame/freeze 族/buildDocStatus 全 DR；SG 桶容量以构造参数取 msgRate/bytesRate/maxDocBytes（不持 quota 对象）；activeQuota getter→GW* |
| quotaFrozenDocs :225 / freezePending :228 / freezePendingTimers :230 / recheckRounds :234 / thawCooldown :235 / frozenRecheckTimer :258 / overPush :232 | DR | Q-C/Q-D 冻结族=pid 键 doc 级配额状态；overPush 虽 socketId 键但主消费面=guardSyncFrame ①/thawQuota/purgeDocState（全 DR），SG 仅老化/断连清理（2 缝位，RC2） |
| vacuumingDocs :242 / preVacuumSvCache :243 / docGeneration :244 / docResidue :245 / vacuumRunner :248 / autoVacuumLastAt :252 | DR | Q-U 真空代际进程态（pid 键） |
| docStatusRev :255 / docStatusState :256 | DR | doc-status 广播账目（pid 键） |
| docStuckRounds :712 / stuckDocsSeen :715 / heapObserverTimer :716 | DR | 零连接 doc 卡住观测=doc 生命周期账目（Z73 口径改读后仍 doc 键）；每轮首行 heapPressureSample 经 host 缝（RC3） |
| loadDocument :982 | DR | 装载=doc 生命周期入口（docEpoch/truth 播种/preVacuumSv/docGeneration/degradedDocs 写点全 DR）；persistence.observeDocument 等经同实例直引（§9⑤）；钩子接线留 GW |
| observeDocBytes :1311 / heapUsedNow :1317 / logDocTopN :1323 / calibrateTruth :1359 | DR | truth 族单点（census ④ encode 白名单点随迁） |
| isQuotaFrozen :1343 / broadcastDocStatusForce :1350 / quotaStateOf :1862 / buildDocStatus :1873 / broadcastDocStatus :1899 | DR | 冻结判定域+广播态域（Q-A/T5 分立语义随迁） |
| isVacuuming :1372 / setVacuuming :1377 / setVacuumRunner :1383 / docResidueOf :1388 / beginVacuumEra :1398 / purgeDocState :1420 / abortVacuumRestore :1449 / rebuildVacuumDoc :1468 / vacuumEquivalent :1494 | DR | 真空纪元五步（Q-U v6）；GW* 保 shrink 15 处消费零触碰（§4.3） |
| guardSyncFrame :1535 | DR | 配额执法唯一落点（⓪帧闸→⓪′bytes 桶→①readOnly→②over→③快路径→④实测）——分层链**不得切两半**（Z24 同款论证）；bytes 桶/freezeReasons/hardClose 三处经 SG 缝（RC2） |
| scheduleFreezePending :1722 / freezeQuota :1747 / thawQuota :1765 / startFrozenRecheckTimer :1788 / recheckFrozenDocs :1793 / updateResidue :1829 / measureTruth :1841 / truthBudgetTryTake :1849 / truthBudgetRecord :1857 | DR | 冻结/解冻/重测状态机全体（跃迁穷举对象，§6） |
| startHeapObserver :768 / observeIdleDocs :773 | DR | stuck 观测（docStuckRounds 写点）；heapPressureSample 经缝 |
| afterUnloadDocument :2030 | DR | 真卸载终态清理（12 键普查表，§6.4）；钩子接线留 GW |
| 【handleProjectsGone 清理子步 :1139-1158】 | DR | truth/冻结/代际族 14 键清理=新语义操作 `onProjectGoneStateCleanup(pid)`（B1 persistence.onProjectGone 同款提取）；事件编排壳留 GW |
| 【unloadDocument 播种子步 :1989】 | DR | unloadHeapAnchors 播种=`beforeUnloadAnchor(pid)`；钩子壳留 GW（X4 永不抛语义在壳） |
| residentSessionReleaser :307 / registerResidentSessionReleaser :308 / residentSessionsProbe :313 / registerResidentSessionsProbe :314 / tryReleaseResidentSession :319 / releaseAllResidentSessions :325 | DR（委托位迁域） | 常驻会话释放入口+探针=「常驻表归此」的所有权载体（§3 候选 B）；GW 保留 register* 公有注册点 1 行转发（residency 构造期注册缝+mock 断言面零触碰，§3.3）与 tryRelease*/releaseAll* 公有委托（shrink/selfIsolate/beginDraining/shutdown 消费零触碰） |
| 【新增语义操作】attachResidencyReleaser / attachResidencyProbe / probeResidentSessions / onUpdateDelta / beforeUnloadAnchor / onProjectGoneStateCleanup / stopTimers | DR | 机械提取+residency 组合缝载体 |
| deepCopyYMap :146 / REASON_BY_VERDICT :158（模块级） | REASON_BY_VERDICT→SG；deepCopyYMap→DR | 版本门四档映射=auth 判定（SG）；深拷贝=rebuildVacuumDoc 专属（DR） |
| 模块常量：OVER_PUSH_* :90-92 / THAW_COOLDOWN_MS :94 / FROZEN_RECHECK_INTERVAL_MS :96 / VACUUM_* :101-103 / RESIDUE_EVAL_ROUNDS 等 :105-107 / TOPN_* :139-140 / TRUTH_COOLDOWN_MS :57 / QuotaConfig :60 | DR | 随消费体迁；**导出常量 gateway 再导出保 import 面**（B1 COMPACT_INTERVAL_MS 先例；spec 实测导入面：TRUTH_COOLDOWN_MS×2/TOPN×2/QuotaConfig type×6，§8.4） |
| AWARENESS_FRAME_LIMIT_BYTES :112 / AWARENESS_STATES_LIMIT_BYTES :118 / AWARENESS_DISTINCT_USER_STRIP_OVER :123 / BACKPRESSURE_* :128-129 / SESSION_SWEEP_* :133-134 | SG | 同上（spec 导入面各 ×1） |
| FreezeReason 类型 :71 / CollabConnection 接口 :75 | 新文件 collab-conn.util.ts（type-only）+gateway 再导出 | SG/DR/GW 三域共消费的类型；`import type` 零运行时环，但按偏离 67 doc-name.util 先例提 util 文件更稳（RC6） |

### 1.3 gateway 本体保留（库钩子编排+协议适配+collabState 生命周期）

| 成员 | 归属 | 依据 |
|---|---|---|
| logger :168 / server :169 / persistence :174 / pgBreaker :180 / hooks :360 | GW | 库实例+已切域 service 引用+钩子签名面（B3 目标形态「hook 签名→service 调用」的载体） |
| collabState :211 / LEGAL_TRANSITIONS :263 / transition :272 / getCollabState :261 / isLeaseServing :283 / isShuttingDown :1169 / isPgBreakerOpen :1175 | GW | **collabState 七态状态机单一所有者=gateway**（V33 迁移单点；serving=唯一放行态判据 V12）——B2 不迁（跃迁穷举单测归本域，§6.1） |
| initDone :212 / startInFlight :213 / shuttingDown :214 / listenerClosed :215 / listenRetries :216 / watchdogFired :217 / watchdogTimer :218 | GW | 启动/关停编排闸（V9-V11/N2-N3） |
| onModuleInit :2059 / startCollabAfterLease :2093 / listenServer :2141 / listenCollab :2158 / startServingWatchdog :1211 / isPortError :1223 | GW | 租约接线+listen 编排（W5/W8 单点）；listenCollab 内 startSessionSweep/persistence.startSpoolReconciler 调用改 `sg.startSessionSweep()`（1 行缝） |
| selfIsolate :1184 | GW | E35 自隔离=链 1 唯一编排点（§2.1——不得切两半的锚） |
| drainAutoReleaseTimer :1228 / beginDraining :1235 / clearDrainTimer :1272 | GW | **drain 编排域**（承接账②裁决：drainAutoReleaseTimer 驱动 draining→serving 跃迁=collabState 所有者的定时器；冻结循环经 sg.applyWriteFreeze+dr.broadcastDocStatus 缝调用，编排体不迁） |
| onApplicationShutdown :2572 / graceDirectConnections :2625 | GW | 关停六步编排（链 3）；各域 timer 清理改 `sg.stopTimers()`/`dr.stopTimers()` 两行缝 |
| handleProjectsGone :1132（壳） | GW | 事件编排：persistence.onProjectGone+dr.onProjectGoneStateCleanup+sg.closeTeamDocuments+yjsDeletedProjects.set（V11 禁慢操作纪律在壳注释随迁） |
| disconnect :1935（壳）/ unloadDocument :1985（壳）/ afterStoreDocument :1280 | GW | 钩子体=「hook 签名→service 调用」编排：disconnect 壳=sg.onDisconnectCleanup+clientsCount 门+persistence.storeDocumentSerialized/maybeCompact 尾段；unloadDocument 壳=dr.beforeUnloadAnchor+persistence.handoffOnUnload+finally{persistence.onDocumentUnload+sg.onDocUnloadCleanup+persistence.recycleEmptyQueue}（X4 永不抛在壳） |
| connected 钩子体 :466-489 | SG（onConnected，RC4） | 消费面=wrapBackpressure/connEstablishedAt/connectionIds/applyWriteFreeze（SG 自有）+isVacuuming/quotaFrozenDocs/buildDocStatus（SG→DR 直引，§4.1）；GW hooks.connected 改 1 行接线 |
| isPersistedComplete :290 / isDocResident :301 / isDocDegraded :331 / isHeapPressureTripped :336 / hasPendingWrites :338 / hasInFlightStore :342 / storeFailedDocs :347 / docBytesOf :352 / isWritableOrDegraded :1170 / computePending :1288 / computeDegraded :1297 / handoffPendingToSpool :1974 | GW* | B1 委托位①-⑧存续+新增：isDocDegraded/docBytesOf→DR、isHeapPressureTripped→SG、computeDegraded 内 stuckDocsSeen 读→DR 缝；消费方（residency/document.service/ready.service/shrink/video-work/intent-reconcile/write.port）零触碰 |
| resolveCollabDebounce :47 / parsePositiveInt :64 / CollabState 类型 :33 | GW | server 构造/debounce/quota 解析仍 GW 构造期；导出面不动 |

### 1.4 57 处登记红按文件映射（门禁 --report 实测，2026-10-17）

| spec 文件 | 处数 | 触达成员（归属） | 核销机制 |
|---|---|---|---|
| collab-perm-events.spec.ts | 13 | wirePermChangedEvents×7/sweepSessions×3/guardAwareness×2/sweepIntervalMs×1（全 SG） | SG 公有化+直调改 `gw.sessionGuard.*`；:105 bind 读点同改（承接账④）；:114 源码锚随迁 |
| collab.gateway.sweep.spec.ts | 10 | startSessionSweep（SG） | SG 公有化；:220 源码锚随迁 |
| collab-auth-defense.spec.ts | 7 | heapPressureSample×2/withAuthDeadline×2 等（SG） | SG 公有化；:266 refusalCache.clear 锚随迁改写（§8.5） |
| collab-shrink.spec.ts | 6 | freezeQuota×3/scheduleFreezePending×1（DR） | DR 公有化；freezeDoc(gw:any) 参数别名逃逸面消灭（承接账④） |
| collab-metrics-observability.spec.ts | 5 | loadDocument×4/logDocTopN×1（DR） | DR 公有化 |
| collab-upgrade.spec.ts | 5 | handleUpgrade×2/clientIpOf×3（SG） | SG 公有化 |
| collab-t20-ripples.spec.ts | 3 | recheckFrozenDocs（DR） | DR 公有化 |
| collab-heap-gate.spec.ts | 2 | loadDocument（DR） | DR 公有化 |
| collab-backpressure.spec.ts | 1 | wrapBackpressure（SG） | SG 公有化 |
| collab-degraded.spec.ts | 1 | loadDocument :58（DR） | DR 公有化 |
| collab-quota-truth.spec.ts | 1 | loadDocument :50（DR） | DR 公有化 |
| collab-runtime-metrics.spec.ts | 1 | loadDocument :57（DR） | DR 公有化 |
| collab-write-endpoint.int.spec.ts | 1 | clearDrainTimer（**不搬**） | until 改 B3（承接账②——drain 编排域留 GW） |
| write-frozen-chain.int.spec.ts | 1 | recheckFrozenDocs（DR） | DR 公有化 |

合计 56 处随 SG/DR 公有化自动核销（cast 消失机制同 B1）+1 处 clearDrainTimer 留登记至 B3。B0 归属账（SessionGuard 34/DocRegistry 22/不搬 1）与本表逐文件核对一致。

## 2. 同步块链完整性核验（Z24：不得切两半）

### 2.1 链 1：租约失守→selfIsolate→closeAll→spool 入账（RC4/B1 已钉语义，B2 继承）

源码实测调用序（fenced-by-write 变体，全链单 async 流）：

```
repo.append fenced ⇒ persistence.storeDocumentUnlocked :303-306（fenced=true→host.onFencedByWrite() inline await）
  ⇒ gateway.selfIsolate('fenced-by-write') :1184-1207【GW 本体——唯一编排点，B2 不迁】
     ├ transition('isolated') :1186【GW collabState 单一所有者】
     ├ collabLeaseLostTotal.inc :1187
     ├ onServingTransition→clearRefusalCache :1188【SG 缝——同步调用】
     ├ clearDrainTimer :1189【GW 本体】
     ├ writeFreeze.clear→sg.clearAllWriteFreeze() :1190【SG 缝——同步调用】
     ├ listenerClosed=Promise(httpServer.close) :1191-1197【GW 本体——同步段先行创建，B1 I-2 结构保持】
     ├ await releaseAllResidentSessions('self-isolate') :1202【DR 委托位→releaser→residency.releaseAllSessions——inline await，try/finally 保证下步必达】
     └ finally closeAllConnections1012 :1204【SG 缝——inline】
  ⇒ 返回 storeDocumentUnlocked 续行：批走 spool.append（:306 后同方法体——「spool 入账」段）
```

心跳变体：lease.heartbeat→classifyZeroRow/isolate（lease 文件，零触碰）→onLost 回调→selfIsolate 同链。
**核验结论**：selfIsolate 全链留 GW 本体；SG/DR 触点全部为同步缝调用或 inline await（无缝间插队窗）；spool 入账段在 persistence（B1 已切，host.onFencedByWrite 缝原样存续——persistence 文件零改动）。链未被切成两半。✓

### 2.2 链 2：drain（beginDraining→冻结→释放→60s 自动解除）

```
POST /api/drain ⇒ ready.controller :45 ⇒ gateway.beginDraining :1235-1271【GW 本体——drain 编排域，承接账②】
  ├ transition('draining') :1236 → 冻结循环 :1262-1266【dr.broadcastDocStatus+dr.quotaStateOf+sg.applyWriteFreeze——同步缝，逐 conn】
  ├ drainAutoReleaseTimer 60s :1240-1260【GW 定时器（draining→serving 跃迁=collabState 所有者持有）；解除循环同上用缝】
  └ void releaseAllResidentSessions('drain') :1269【DR 委托位——fire-and-forget 语义逐字保持（Z129 drain 常规档不阻塞 API 响应）】
```
**核验结论**：编排体+定时器留 GW，冻结/广播/释放三个跨域动作=缝调用，await 语义（含 fire-and-forget 的 void）逐字平移。✓

### 2.3 链 3：关停步骤 0-6（onApplicationShutdown :2572-2621）

```
步骤0 await releaseAllResidentSessions('shutdown')【DR 委托位→residency.releaseAllSessions——预算/Σdirect 断言/handoff→persistence 全在 residency+persistence，零触碰】
步骤1 shuttingDown=true+transition('draining')【GW】
定时器族清理 :2577-2595【拆三缝：sg.stopTimers()（sessionSweepTimer/authMapsSweepTimer）+dr.stopTimers()（frozenRecheckTimer/freezePendingTimers/docTopNLogTimer/heapObserverTimer）+GW 自有（watchdogTimer/drainAutoReleaseTimer）+sg.clearAllWriteFreeze() :2579——清理行逐字平移进各 stopTimers，GW 壳只剩缝调用；顺序保持：清理段在 unregister readers 之前的相对序不动】
unregister×9 :2586-2594【GW——metrics reader 接线留本体（B1 同款：注册在 gateway 构造器、读值经委托/直引）】
persistence.cancelAllRetries→graceDirectConnections→sg.closeAllConnections1012→flushPendingStores→pollPendingDrained→drainAllDocuments→destroy race→hangReason（residentSessionsProbe→dr.probeResidentSessions()）→lease release【GW 编排序逐字保持】
```
**核验结论**：六步编排唯一所有者=GW；跨域清理收敛为 stopTimers/clearAll 缝（机械提取，非重写）。Z81 destroy_timeout 断言链（hangReason 三分型）读面经 DR 探针委托位，语义不变。✓

**跨缝协作显式化原则**（三条链共用）：凡链上跨域动作，缝=**方法级同步调用或 inline await**，禁止「回调注册+异步派发」形态插入链中（会造出缝间窗）；唯一的注册型缝（residentSessionReleaser）是 A2 既有形态逐字承继，非 B2 新增。

## 3. residency 并入方案（P1：搬迁非重写）

### 3.1 消费面实测（并入方案的硬约束）

- **DI 注入点**：collab.module.ts :41 provider+:64 export；collab-document.service.ts :49 `@Optional() residency?` 尾参+缺省自建 `new CollabResidencyService(gateway)` :51（DI/直构双兼容先例——与 gateway.persistence 同形）。
- **测试直构点（5 处，全部 `new CollabResidencyService(gateway)`）**：test-utils/dual-client-server.ts :95、collab-write-idempotency.int :108、collab-write-endpoint.int :88、collab-residency-reaper.spec :99、collab-residency-durability.int :90。
- **mock gateway 注册缝断言（关键约束）**：residency 构造器 :165/:177 调 `gateway.registerResidentSessionReleaser?.()`/`registerResidentSessionsProbe?.()`；reaper spec :96/:104 的 mock gateway 以 `registerResidentSessionReleaser: vi.fn()` 承载，且 **:494-497/:661/:791 直接断言该 vi.fn 的调用次数与注册闭包内容**。⇒ 注册缝的宿主（gateway 公有方法名+调用形态）**不可动**，动=断言修改=红线。
- **residency→gateway 读面（12 位，全部已是 gateway 公有/委托位）**：isLeaseServing/isWritableOrDegraded/isVacuuming/hasPendingWrites/hasInFlightStore/storeFailedDocs/isPgBreakerOpen/isHeapPressureTripped/isDocDegraded/docBytesOf/handoffPendingToSpool/server.hocuspocus（openDirectConnection/documents/unloadDocument）。B2 后这些位全部存续（GW* 委托改接 SG/DR 实现）⇒ **residency 文件对 gateway 的依赖面零触碰**。
- **Z65/㉕ 锚**：`hocuspocus.unloadDocument` 生产唯一调用点=residency forceEvictStoreFailed :612（census ㉕ 白名单按文件路径钉 collab-residency.service.ts）；Z65 不变量断言在 collab-residency.service.spec :375-390（读 fx.residency().holds）。

### 3.2 候选对比

| 维度 | A：类文本吸收（residency 761 行成员逐字并入 DR 类） | **B：组合持有（推荐）** | C：仅注释宣告域归属 |
|---|---|---|---|
| P1「搬迁非重写」字面 | 弱符合——成员级平移但类/构造器/DI 形态重写 | **强符合——服务本体（文件/类/构造器）零改动，域归属经委托位迁置表达** | 不符合——「并入」无可消费的所有权载体 |
| DI/直构面 | 5 直构点+document.service 自建路径+module provider 全改；residency 构造器签名重写 | **零改动**（residency 仍 inject gateway；DR 不注入 residency——无环，§3.3） | 零改动 |
| mock/断言面 | reaper/durability/service spec 的 fixture 与 :494-497 注册断言全触=红线大面积 | **零触碰**（register* 缝留 GW，1 行转发 attach） | 零触碰 |
| census/锚 | ㉕ 文件路径迁+⑮ residency openDirectConnection 登记红迁+Z65 spec 宿主迁（≈3 项锚随迁） | **㉕/⑮/Z65 零迁移** | 零迁移 |
| 行数锚 | DR ≈1030+761−重叠 ≈**1750-1800**（单文件巨无霸，锚重标失真） | DR ≈1030（residency 761 独立文件，域合计账 1791 如实呈报） | 无变化 |
| 「常驻表归此」实质 | 表本体入 DR 文件 | **释放入口+探针读面（4 委托位）所有权迁 DR**；表本体在 DR 域成员 residency（独立文件）——Z65 合计口径断言经 DR 域读面可达 | 名义归属 |
| B1 模式一致性 | 类 absorption 无先例 | **persistence 组合先例同款**（gateway.persistence 字段+委托位；此处 DR.residency 能力面+委托位） | — |

### 3.3 推荐=B，落地形态（无环 DI 论证）

1. **委托位迁域**：residentSessionReleaser/residentSessionsProbe 字段+tryReleaseResidentSession/releaseAllResidentSessions 方法体逐字迁 DR；GW 保留 4 个公有位：`registerResidentSessionReleaser(fn)`/`registerResidentSessionsProbe(fn)`（1 行转发 `this.docRegistry.attachResidencyReleaser(fn)`——residency 构造器与 mock 断言零触碰）+`tryReleaseResidentSession`/`releaseAllResidentSessions`（1 行委托——shrink :310/selfIsolate :1202/beginDraining :1269/shutdown :2574 消费零触碰）。未 attach 时语义逐字保持：tryRelease→`Promise.resolve(undefined)`、releaseAll→no-op、probe→0（直构 gateway 无 residency=「会话表概念不存在」，gateway :315-318 注释语义随迁）。
2. **DI 图**：GW→DR（@Optional 尾参+缺省自建，B1 persistence 同款）；residency→GW（既有边不变）；DR **不**注入 residency（能力经 attach 缝后置绑定）⇒ 无环，di-smoke 零风险。
3. **residency 文件改动面=0 行**（连 import 都不动——其对 gateway 的 12 位读面全部存续）。若 RC1 裁 A，则按偏离 66/68 先例做 3 项锚随迁登记。
4. **E35 owner 抽象落点**：DR 的 owner 门=bindHost 谓词组 `isServingState()/isDrainingState()/isIsolated()`（GW 实现=collabState 派生+lease 接线）——单实例租约=平凡实现；Y7 多实例只换 host 实现不重写（不新建 port 文件，简洁优先；抽象点以 DR 文件头注+接口注释显式声明）。

## 4. host 缝最小接口设计（B1「全消费零投机」纪律：每位附消费点证明）

### 4.1 跨 service 直引（构造注入，非 host 缝）

- **DR 构造注入**：repo（loadDocument :1049 hydrateWithRecovery）、persistence 同实例（observeDocument/withReplaySuppressed/seedCompactBaseline/peekSpoolFrames :1044-1062、writesSettled :1403、purgePersistenceState :1437、recycleEmptyQueue :1443、storeFailedDocs :2043、deletedProjects :1159、hasPendingWrites :780）、pgBreaker 同实例（admitQuery :993/recordSuccess :1111/recordFailure :1116）、quota 四值（构造参数）。
- **SG 构造注入**：sessionSvc（@Optional sessions 尾参+缺省自建——gateway :398 形态平移）、perm（resolveWithTeam :931/:2318）、pgBreaker 同实例（admitQuery :912/recordSuccess :953/recordFailure :963）、persistence 同实例（spoolStateForAuth :913/persistUnhealthy :947/pushPersistStatus :948/isWritableOrDegraded :2336）、eventEmitter（wirePermChangedEvents :2280）、**docRegistry**（connected 钩子体 :476 isVacuuming/:484 quotaFrozenDocs.has/:486 buildDocStatus+authenticateInner :943 quotaFrozen 兜底——RC4/RC5）。
- 环核验：SG→DR（构造）、DR→SG 能力仅经 bindHost 缝（后置）、两 service 均不注入 GW ⇒ 无环。GW 直构顺序：DR→SG→bindHost×2。
- **persistence 文件零加行**（承接账⑤）：以上全部为 persistence 既有公有面（实测 :570/:597/:116/:118/:135 等已 public/readonly）；persistence.bindHost 的 host 接口**签名不变**，仅 gateway 侧接线实现改指：onUpdateDelta/calibrateTruth/observeDocBytes→`this.docRegistry.*`（docDelta 写点守卫 :417-426 逐字迁 DR.onUpdateDelta）、onSpoolRecoveredFlip→`this.sessionGuard.clearRefusalCache()`、onFencedByWrite/getDocument/docStats/三谓词留 GW 原实现。

### 4.2 SG.bindHost 最小接口（GW 提供；逐位消费点）

| 位 | 消费点证明（现行号） |
|---|---|
| logger | 全域日志（spyLogger 断言面——B1 同款共享实例） |
| allDocuments() | enforceConnMaxLifetime :2220/sweepSessions :2239/wirePermChangedEvents :2281/closeAllConnections1012 :2557/closeTeamDocuments :2641/broadcastSpoolDegraded :1918/rewriteAwarenessRole :2359（getDocument(name)） |
| isServingState() | authenticateInner :908（P0-1 三入口①） |
| isShuttingDownFlag() | authenticateInner :907/recheckConnection 升回守卫 :2336 |
| heapSampleRoleEnv?（不设） | heapPressureSample 的 env 读随方法迁 SG——无缝位（census ㉒ 键随迁） |

（4 位。isWritableOrDegraded 经 persistence 直引，不设缝位；docStats 属 persistence host 不重复设。）

### 4.3 DR.bindHost 最小接口（GW 提供；逐位消费点）

| 位 | 消费点证明（现行号） |
|---|---|
| logger | 全域日志 |
| getDocument(name) / allDocuments() | freezeQuota :1752/thawQuota :1767/recheckFrozenDocs :1795/scheduleFreezePending :1729/beginVacuumEra :1407/broadcastDocStatus :1905/observeIdleDocs :775/loadDocument 门 :1018+:1031（unloadingDocuments/documents.has 经同缝或 host 暴露 hocuspocus 读面——落地取 documents/unloadingDocuments 两个只读访问器位） |
| isServingState() | loadDocument :983（P0-1 三入口②） |
| isDrainingState() | buildDocStatus :1880/broadcastDocStatus :1900（writeFrozen 复合键） |
| heapPressureSample() | observeIdleDocs :774（F-2 每轮采样）/loadDocument :1031（heap 闸）——实现=SG 同名公有 |
| applyWriteFreeze(conn,reason,on) | freezeQuota :1755/thawQuota :1772/beginVacuumEra :1411（SG 公有转发） |
| releaseFreezeForDoc(pid): socketId[] | purgeDocState :1438-1442/abortVacuumRestore :1454-1456（writeFreeze 条目解除+返回 socketId 供 DR 清 overPush——SG 侧新语义操作=循环体逐字平移） |
| hardClose(conn,code,reason) | guardSyncFrame :1551/:1566/:1572/:1582/:1598/beginVacuumEra :1412（SG 公有转发） |
| consumeBytesBucket(sid,bytes) | guardSyncFrame ⓪′ :1580（SG 桶所有） |
| ageOverPush(now) / dropOverPush(socketId) | SG sweepStaleAuthMaps :753/disconnect :1952（overPush 台账 DR 所有，SG 老化/清理两缝） |

（10 位。vacuumRunner/setVacuumRunner 为 DR 自有注入点非缝；residency attach 两位=§3.3 组合缝。）

### 4.4 gateway 委托位清单（既有消费方零触碰）

- **persistence 委托（B1 8 位存续，实现不变）**：isPersistedComplete/isWritableOrDegraded/hasPendingWrites/hasInFlightStore/storeFailedDocs/computePending/handoffPendingToSpool/+computeDegraded（内 oldestUnflushed 读 persistence、stuckDocsSeen 改读 DR）。
- **DR 委托（新增/改接，消费方零触碰）**：isVacuuming/setVacuuming/setVacuumRunner/beginVacuumEra/purgeDocState/abortVacuumRestore/rebuildVacuumDoc/vacuumEquivalent/thawQuota/isQuotaFrozen/broadcastDocStatusForce/calibrateTruth/docResidueOf/activeQuota（shrink 15 处）；isDocDegraded/docBytesOf（residency）；isDocResident（document.service/write.port/intent-reconcile——读库 documents，留 GW 本体非委托）；tryReleaseResidentSession（shrink）/releaseAllResidentSessions/registerResidentSessionReleaser/registerResidentSessionsProbe（residency 构造缝）。
- **SG 委托**：isHeapPressureTripped（residency reaper）；closeTeamDocuments 消费方=GW handleProjectsGone 内部（不设公有委托，直调 sg）。
- 消费方文件零改动清单（grep 实测）：collab-shrink.service/collab-document.service/collab-residency.service/collab-ready.service/collab-ready.controller/collab-write.port/execution.service/intent-reconcile.service/video-project.service/video-work.service——**全部经 GW 公有面，无一触碰 SG/DR 新文件**。

## 5. 判定纯函数化设计（SG 硬判据：request/context→verdict）

纪律：**搬移+参数化**（判定表达式逐字对应，读态改入参）或**导出既有纯函数**；禁借机重写；执法副作用（计数/close/throw/字段写）一律留在方法壳，按 verdict 分支执行——副作用与判定的相对顺序逐字保持。

| verdict 纯函数（SG 文件顶层导出） | 输入 context 字段 | 输出 verdict | 来源（现行号）与类别 |
|---|---|---|---|
| `decideUpgrade({originAllowed, rateAllowed})` | originAllowed:boolean（allowedOrigins 判定结果）、rateAllowed:boolean（惰性——仅 originAllowed 才 consume，保持 :620 桶不空转语义） | `{allow}｜{reject, status:'403'｜'429', reason:'origin'｜'rate-limited'}` | handleUpgrade :611-623 判定核（搬移+参数化；rejectUpgrade socket 直写+inc 留壳） |
| `resolveAllowedOrigins(env)` | COLLAB_ALLOWED_ORIGINS/BETTER_AUTH_URL/NODE_ENV 三键快照 | string[] | allowedOrigins :644-655（搬移+参数化；方法壳传 process.env） |
| `clientIpOf(request, socket, trustedProxy)` | headers/remoteAddress/trustedProxy:boolean | ip:string | :665-673（既有近纯函数——env 读参数化；façade 3 直调核销） |
| `decideAuthAdmission(ctx)` | hasDoc、heapTripped、csv、docNameValid、shuttingDown、leaseServing、breakerOpen（七门快照——§3.1bis 执行序钉死） | `{proceed}｜{deny, reason:CollabAuthReasonCode, source:'heap'｜'version'｜'state', loadRejectCount?:'server-overloaded'}` | authenticateInner :887-912 确定性门前段（搬移+参数化；inc/connectionConfig.readOnly/broadcastSpoolDegraded 留壳按 verdict 执行；DB 段 :920-960 不纯函数化——IO 本体） |
| `REASON_BY_VERDICT` + `negotiateClientVersion` | csv | VersionVerdict→reason | :158-163+shared（**导出既有纯函数**类别——随迁再导出） |
| `decideFrameGate({type,bytes,maxTxBytes,maxDocBytes})` | beforeSync type/payload.byteLength/quota 两值 | `{pass}｜{reject:'frame-too-large'(1009)｜'doc-over-quota'(4404)}` | guardSyncFrame ⓪ :1564-1574（搬移+参数化——**函数落 DR 文件**：quota 判定域随状态所有权，SG 硬判据不强制跨域搬运；RC2） |
| `decideAwarenessStrip({readOnly,distinctUsers})` | conn.readOnly/并集去重数 | `'read-only'｜'solo'｜'over-8'｜null` | guardAwareness :2406-2426 档位判定核（搬移+参数化；stripTransientFields 改 states 留壳） |
| `decideClientOwnership({owner,socketId,emptyState,docHasState,ownCount})` | 归属表快照 | `'pass-inject'｜'forged'｜'ghost'｜'owner-limit'｜'register'` | guardAwareness 三分支 :2441-2462（搬移+参数化；states.delete/set+计数+登记留壳） |
| `decideOverPushEscalation({count,bytes,firstAt,lastAt,now,maxTxBytes})` | overPush 条目快照 | boolean | guardSyncFrame Q-D :1595（搬移+参数化；台账写+hardClose 留壳；**落 DR 文件**同 RC2） |
| `decideSweepRecheck({expiresAt,now,cachedAt,ttl})` | ctx.sessionExpiresAt/permCache 快照 | `'skip'｜'recheck'` | sweepSessions 判据门 :2245-2248+permRecheckDue :2268-2271（搬移+参数化） |
| `isEmptyState` / `serverIdentityOf` | state/u | boolean/注入形 | :2525/:2531（**既有纯函数导出**——static→顶层导出，等价形态） |

限流桶判定本体=TokenBucket.consume（既有类，census ⑥/⑨ 锚不动）——不重复造 verdict 函数（简洁优先）。

## 6. 生命周期状态机穷举（DR 硬判据：单一所有者+跃迁穷举单测）

### 6.1 状态机盘点（源码实测）

**collabState 七态（GW 单一所有者——既有，B2 补穷举单测）**：LEGAL_TRANSITIONS :263-271 实测 15 条合法有向边+7 自环；非法对=7×7−15−7=**27 对**。现行语义（V33 :272-280）：非法迁移=ERROR 点名（collab_illegal_transition）但**仍置位**（日志非拦截）——穷举单测必须钉死此语义防「顺手改成拦截」=行为变化。**覆盖缺口实测：grep LEGAL_TRANSITIONS/collab_illegal_transition 于 76 spec 文件=0 命中**⇒ 全矩阵无覆盖=B2 新增（W2 先红）。

> **W3a 勘正注记（2026-10-17，控制方核准——W2 上报分歧折入，原文留痕不改写）**：本节「15 条合法边/27 非法对」系报告计数笔误——源码实测（collab-state-machine.spec 现场解析单源，53 用例全绿）=**18 条合法有向边+7 自环/24 非法对**（49=18+7+24）；§11 W2「42+7 对矩阵」同勘正为 49 全矩阵。

**doc 生命周期七维（DR 单一所有者——B2 起）**（跃迁矩阵按维枚举；每维：状态集/合法跃迁/写点/清点/非法跃迁的结构性不可达证明）：

| 维 | 状态与跃迁（实测写点） | 清理点 |
|---|---|---|
| ①物化 | absent→loading(库 isLoading)→present(documents.set 库)→unloading(unloadingDocuments 库 :1018 读)→absent；守卫=装载拒 unloading 窗（T19/Z64②） | 库所有（DR 只读+守卫） |
| ②真空 | ¬vacuuming→vacuuming（beginVacuumEra :1399/setVacuuming :1378）→¬vacuuming（setVacuuming(false) shrink :344/projectsGone :1157 兜底） | purgeDocState/afterUnload 不含 vacuumingDocs（实测——service finally+projectsGone 双保险，:1157 注释随迁） |
| ③配额 | ok→pending（scheduleFreezePending :1724）→frozen（freezeQuota setImmediate :1754）→ok（thawQuota :1769）；pending→ok（确认定时器实测<soft :1732-1735）；pending→frozen（:1737）；frozen→frozen 幂等（:1748） | afterUnload :2044-2049/purgeDocState :1425-1430/projectsGone :1145-1150/abortVacuumRestore :1450-1453/recheckFrozenDocs 卸载残留 :1796 |
| ④降级 | ¬degraded→degraded（loadDocument :1108）→¬degraded | afterUnload :2042/purge/projectsGone |
| ⑤store 失败 | persistence.storeFailedDocs（add=append 失败点；delete=store 成功+真卸载 :2043）——persistence 所有，DR 清理点接线随迁 | afterUnload（DR 经直引 delete） |
| ⑥常驻（residency 域成员） | held→releasing（releaseSessionFor :256）→removed｜zombie（doRelease 超时 :278）；zombie→held（acquire 覆盖新开 :453）；Z83 并发协议/Z109 硬超时 | residency 文件零改动（候选 B）——既有 spec 覆盖存续 |
| ⑦代际 | docGeneration/preVacuumSvCache 装载播种 :1053-1054→卸载/终态清 | afterUnload :2054-2055/purge/projectsGone |

### 6.2 清理点普查表（穷举单测对象——实测键集）

- afterUnloadDocument（DR，12 键+1 persistence 委托）：docTruth/docDelta/truthMeasuredAt/degradedDocs/storeFailedDocs/quotaFrozenDocs/freezePending+Timers/recheckRounds/thawCooldown/docStatusRev/docStatusState/docGeneration/preVacuumSvCache/docResidue（:2039-2056 实测 15 delete+1 timer clear）。
- purgeDocState（DR，15 键+2 persistence 步+SG 缝）：上表+autoVacuumLastAt+writeFreeze/overPush（经 releaseFreezeForDoc 缝）+persistence.purgePersistenceState/recycleEmptyQueue（:1420-1444）。
- onProjectGoneStateCleanup（DR，14 键）：:1139-1157 实测。
- **三入口键集差异=穷举断言核心**（vacuumingDocs 仅 projectsGone 清、autoVacuumLastAt 仅 purge 清——差异逐键钉死，防「补齐清理」式行为漂移）。

> **W3a 勘正注记（2026-10-17，控制方核准——W2 上报分歧折入，原文留痕不改写）**：本节键数以源码实测为准（collab-doc-lifecycle.spec D1/D2/D3 逐键钉死，25 用例全绿）：afterUnloadDocument=**15 容器**（14 DR 键+storeFailedDocs persistence 台账）+1 timer 族+锚结算；onProjectGoneStateCleanup=**15 容器**（14+vacuumingDocs 专属兜底——与 §6.1 ②「仅 projectsGone 清」自洽）；purgeDocState=15 键（含 autoVacuumLastAt 专属）+2 persistence 步+SG 缝。「12 键+1 委托/14 键」旧记为盘点口径不一。

### 6.3 穷举单测清单（W2 先红→W3 绿）

新 spec：collab-state-machine.spec.ts（GW 域）+collab-doc-lifecycle.spec.ts（DR 域）：
1. collabState 15 合法边逐条（transition 后状态+collab_state 日志）；27 非法对逐条（ERROR 点名+仍置位语义）；7 自环（无 error、无重复 serving 副作用——onServingTransition 恰在 next==='serving' 触发 :279）。
2. doc 七维每维：合法跃迁逐条+非法跃迁结构性不可达（无写点断言=源码文本锚或反射）+幂等重入（freezeQuota 双调/scheduleFreezePending 去重/releaseSessionFor releasing 复调）。
3. 清理点普查表三入口逐键全断言（含差异键）+Z65 合计口径随迁绿（residency.service.spec :375-390 零触碰+DR 域视角复断言）。
4. Z66 stacked 计数、Z83 释放窗并发、Z109 zombie 懒重建——既有 residency spec 覆盖存续（候选 B 零迁移），DR 域只补「委托位未 attach 语义」三断言（undefined/no-op/0）。
5. 既有反射普查锚（shrink spec I-1，偏离 68 产物）：枚举对象 [gateway, gateway.persistence] 双对象→**[gateway, persistence, docRegistry] 三对象扩面**（pid 键控容器 23 个中 ~19 个迁 DR；must 锚名单逐字零变化——偏离 68 同款第 4 处锚随迁，W2 登记）。

## 7. 行数锚预估（供偏离 65 重标登记——实测重标以 W5 出口为准）

测定法：成员声明行→下一成员声明行的区间和（含前置注释——B1「注释随迁」同款口径），现场脚本实测（非人估）：**SG 区间和 874 / DR 区间和 794 / GW 区间和 587**（原始 823 扣除 hooks :360→611 区间误含构造器 228 行后的净值；构造器另计）。

### 7.1 三锚预估构成明细

| 域 | 搬移区间和 | +头注/imports | +host 接口/构造器 | +新语义操作/缝 | +常量族随迁 | 预估合计 | 重标建议 |
|---|---|---|---|---|---|---|---|
| CollabSessionGuardService | 874 | ≈45 | ≈30+35 | onConnected/onDisconnectCleanup/onDocUnloadCleanup/clearAll/clearRefusalCache/stopTimers/releaseFreezeForDoc/ageOverPush ≈60 | AWARENESS/BACKPRESSURE/SWEEP 常量族 ≈15 | **≈1030-1100** | ≤1100 |
| CollabDocRegistryService | 794 | ≈50 | ≈35+40 | attach×2/probe/onUpdateDelta/beforeUnloadAnchor/onProjectGoneStateCleanup/stopTimers ≈45 | OVER_PUSH/THAW/FROZEN/VACUUM/TOPN/TRUTH_COOLDOWN/QuotaConfig/deepCopyYMap ≈60 | **≈1020-1090** | ≤1100（候选 B；若 RC1 裁 A：+residency 761−重叠 ≈**1750-1800**→≤1850，且 3 项锚随迁） |
| gateway 余量 | 587 | ≈70（头注+imports 收缩+再导出块） | 构造器重构后 ≈285（server options 85+hooks 接线 40+metrics reader 100+DI/bindHost×2/桶参数 60） | 委托位新增 ≈110（~30 位×3-4 行）；钩子壳净减 ≈−60（connected/disconnect/unload 体迁出） | — | **≈950-1100** | B2 出口实测重标（偏离 65 已授权） |

总账核对：B2 后 GW+SG+DR ≈3000-3290 vs 现 gateway 2658——净增 ≈350-630=host 缝×2+委托位+verdict 纯函数+双头注/构造器（B1 净增 229 的同构放大，两 service 故更高）；片 B 四文件+persistence 950+residency 761 合计 ≈4700-5000。**≤500 原锚数学不可达再证**（偏离 65 论证同构：纯搬移守恒+切分开销只增不减）。

### 7.2 gateway ≤600 的 B3 可达性判断

B2 后 gateway 剩：构造器 285+生命周期编排（onModuleInit/startCollabAfterLease/listenServer/listenCollab/watchdog）141+shutdown/grace 63+selfIsolate/beginDraining/drainTimer 121+状态机/谓词 60+钩子壳 65+handleProjectsGone 壳 17+委托位 ~110+头注/字段/常量 ~115 ≈ **1075**。
B3 收敛手段（预估挪出量）：①server 构造 options 块提取 collab-server.factory.ts（canvas-doc.factory 先例）≈−95；②metrics reader 注册块提取（collab-observability-wiring 或各 service 构造器——B1 留 gateway 的先例可在 B3 复议）≈−100；③委托位退役一半：shrink/ready/document.service 等消费方改直注 DR/SG（跨模块面，需 module exports 扩）≈−55；④钩子壳再薄化 ≈−30。合计 ≈−280 → **B3 后 ≈795±80**。
**判断：≤600 字面在 B3 手段全开下仍差 ≈200——除非委托位全退役+生命周期启动编排再切（startCollabAfterLease/listenCollab 族 ≈141 行属「库钩子编排」核心，切出即造第二编排点，Z24 反对）**。结论：≤600 为防倒退锚非可达目标值（spec 原文口径），按偏离 65 裁决以 B3 完成实测重标（预估 700-850），本报告数字供 T42 门禁（check-collab-module-size）定值参考。
> **B3 完结注记（2026-10-17，T42 W6）**：commits **ece315f0**（收敛+承接账①-⑤）+**8fdeee44**（行数门禁）——gateway 实测 1031→**934**=锚终标 ≤934（偏离 76 登记，spec §0.6）：手段①factory 76 行/②wiring 69 行/④钩子壳内联两件落地，**手段③委托位零退役**（控制方默认裁决+31 位逐位 grep 实证外部消费均 ≥1，releaseAllResidentSessions 唯一例外因 spec spy 消费面保留）；与预估 795±80 差=③未执行+①②实测挪出量小于预估口径。承接账①-⑥ 全清（①façade stub 核销登记红终态 0/②persistence 删参 eslint warning 57→56/③verdict 直调单测 18 用例/④SG host 位更名 isDrainingDerived/⑤门禁受体词面扩=执法加强现状 0 违规 0 误报/⑥canonical 勘正：W2 披露「+16 行」经 numstat 复核与当时 diff 一致，条目现值 21 行=W3a/W3b 再生演进——偏离 76④ 入账）。出口=verify full **27 步** PASS（manifest 26→27，新步 25 邻位 fast 外）+collab unit **882**（864+18）+int 37+di-smoke 3+census 23/23+scripts-node-test **201**。**B3 步门达成=T43 前置就绪**。

## 8. 门禁/façade/census 同步清单

### 8.1 façade 门禁（check-collab-test-facade.mjs）

- 57 处登记红核销路径=§1.4 表（56 处公有化自动核销——登记行 stale 强制移除；clearDrainTimer 1 处 until 改 'B3'+注记「drain 编排域」）。
- **universe 扩面（建议同批）**：脚本 universe 现仅解析 collab.gateway.ts 私有成员（150 个）——B2 后 ~110 个迁出，执法面空心化。扩为三文件（gateway+两 service）universe；façade 豁免面不变。脚本改动=执法加强非放松，W4 落地+自测扩例（B1 时 universe 未扩系 persistence 私有触达全经 façade persistOf 收敛——B2 同款前提成立则扩面为可选加强，RC6 附项）。
- 违规基线表（14 文件×count）随核销递减，drift 强制同批（偏离 62⑥ 机制）。

### 8.2 census（check-collab-census.mjs）同批更新项（Z24 点名义务）

| 组 | 现锚 | B2 后 | 动作 |
|---|---|---|---|
| ④+⑮ | ENCODE_WHITELIST/纯符号表：gateway {decodeStateVector:2, encodeStateAsUpdate:3}（:709-710） | 5 点全迁 DR（loadDocument :1053/:1088+guardSyncFrame :1548+updateResidue :1833+measureTruth :1844） | 白名单条目 gateway→collab-doc-registry.service.ts 同计数；文件数 7 不变 |
| ⑤ | bufferedAmount 生产读点唯一=collab.gateway.ts（脚本 :496 硬编码路径） | wrapBackpressure→SG | 期望文件路径改 collab-session-guard.service.ts |
| ⑥ | new TokenBucket 恰四定义点扫 gateway 文件（脚本 :502） | 四桶构造迁 SG 构造器 | 扫描目标文件改 SG（字段名四个不变） |
| ㉒ | env 白名单 106 键项/34 文件（gateway 22 键） | 14 键迁 SG（ALLOWED_ORIGINS/BETTER_AUTH_URL/NODE_ENV/TRUSTED_PROXY/UPGRADE_RATE/AUTH×3/REFUSAL_TTL/CONN_MAX_LIFETIME/SWEEP_ENABLED/RSS×2/HEAP_RATIO/COLLAB_ROLE）；8 键留 GW（PORT/DEBOUNCE/TIMEOUT/BIND_ADDR+quota 四值解析） | 白名单条目按文件随迁 14 键项 |
| ㉕ | unloadDocument 库直调唯一=residency forceEvict（按文件路径） | 候选 B：residency 文件零改动 | **零迁移**（裁 A 则锚随迁登记） |
| ①②③⑨⑪⑭⑯ | 文件无关全局计数（hardClose/applyWriteFreeze/closeTeamDocuments 体内形态） | 体迁 SG 文件、形态逐字 | 预期零脚本改动——W3 每 commit 复跑验证（如实测红再登记） |

### 8.3 spec 源码文本锚随迁（偏离 66 先例族——W2 先登记后实施，实测 4+1 处）

1. collab-auth-defense.spec :266：gateway 文本 `refusalCache.clear()` 恰 2→B2 后 0（onServingTransition 体迁 SG；setOnRecovered 接线改 `sessionGuard.clearRefusalCache()`）——锚改写=SG 文件 `refusalCache.clear()` 恰 1（方法体单点）+GW 文件 `setOnRecovered→clearRefusalCache` 接线恰 1+SG 内 serving 汇点调用恰 1（「清空点恰 2」语义按新宿主重述，判别力不降）。
2. collab-perm-events.spec :114 + 3. collab.gateway.sweep.spec :220：sessionSweepTimer setTimeout 自排链三件套→SG 文件（readFileSync 路径改+断言逐字保留）。
4. collab-pg-breaker.service.spec :279：闸门恰四=「gateway+persistence 双文件求和」（偏离 66① 产物）→B2 后 admitQuery×2 分迁 SG（auth :912）/DR（load :993），stateName×1 留 GW、isOpen×1 在 persistence——改**四文件求和恰 4**（断言语义「恰四+不裹心跳/不拒 WS 帧」逐字保留）。
5. shrink spec 反射普查锚：双对象→三对象（§6.3-5，偏离 68 同款）。

### 8.4 gateway 再导出义务（B1 COMPACT_INTERVAL_MS/parseDocName 先例——消费方零触碰）

spec 实测导入面（grep from './collab.gateway'）：type QuotaConfig×6、TRUTH_COOLDOWN_MS×2、TOPN_LOG_LIMIT/TOPN_LOG_INTERVAL_MS/BACKPRESSURE_DROP_BYTES/BACKPRESSURE_CLOSE_BYTES/AWARENESS_STATES_LIMIT_BYTES/AWARENESS_FRAME_LIMIT_BYTES/AWARENESS_DISTINCT_USER_STRIP_OVER/resolveCollabDebounce/parsePositiveInt/DOC_BYTES_OVER_THRESHOLD_BYTES（已再导出）各 ×1。随搬常量全部 gateway 再导出（TRUTH_COOLDOWN/TOPN/VACUUM_*/AWARENESS_*/BACKPRESSURE_* 族+QuotaConfig 类型）；resolveCollabDebounce/parsePositiveInt/DOC_BYTES_OVER_THRESHOLD_BYTES 再导出行不动。

### 8.5 façade 扩面预估

- 新增：`sessionGuardOf(gw)`/`docRegistryOf(gw)` 两单点受控 cast+SessionGuardInternals/DocRegistryInternals 两镜像接口（~35 成员，类型索引访问单源 `CollabSessionGuardService['member']`——gateway 前提=`readonly sessionGuard`/`readonly docRegistry` 公有字段，persistence 同款）。
- 改道：现经 internals(gw) 的 ~30 方法（docTruth/freeze 族/refusalCache/permCache/桶族/writeFreeze 等）改 sessionGuardOf/docRegistryOf——**方法数不增减、公有签名零变化、身份契约七处零变化**（persistOf 面不动；overPushStates 等活引用语义随镜像面平移）。
- 新增方法预估 ≤8：forceCollabState 不动（GW 域）；补 docRegistry/sessionGuard 直达访问器 2+缺失 spy/stub 若干（W4 按替换实测缺口扩，R4 纪律）。N=114→≈120-125。

## 9. B2 承接账逐项处置

| # | 事项 | 处置 |
|---|---|---|
| ① | 57 处门禁登记红核销 | §1.4 逐文件路径+§8.1 机制；W4 出口=门禁 --report 余 1 处（clearDrainTimer，until B3） |
| ② | clearDrainTimer 归属 | **裁：留 gateway 本体（drain 编排域）**——drainAutoReleaseTimer 驱动 draining→serving 跃迁，跃迁权=collabState 单一所有者（GW），定时器随权走；beginDraining/clearDrainTimer/drainAutoReleaseTimer 三件套整体不迁（链 2 编排点，§2.2）。write-endpoint.int :207 登记行 until 改 'B3'、注记改「drain 编排域——B3 收敛时裁公有化或 façade stub」 |
| ③ | 裸 pid 疑点（persistence :919 schedulePersistRetry(projectId)） | B2 零回写 persistence（⑤红线）⇒ **登记 TD 台账**：载体=docs/superpowers/tech-debt.md「后端（apps/api）」节，编号=台账现场最大 TD 号+1（写入前复核）；行文要素=【来源】T40 B1 照搬披露（service :919 注释原文「裸 pid 形态逐字承 gateway 前文 :1462——疑点照搬不修登记遗留」）【现状】handleProjectsGone→spool.hasFrames(projectId) 为真时 schedulePersistRetry(projectId) 传裸 pid，疑应传 `project:${projectId}`（退避梯键=documentName 口径族）【修复方向】裁决键口径后单行修+regression spec（project.gone 后 Z11① 收割梯保排断言）；W2 波登记（独立文档 commit，与偏离登记同批） |
| ④ | quota-gate freezeDoc(gw:any) :49+perm-events :105 | W4 消灭：freezeDoc 参数改 `gw.docRegistry.freezeQuota(pid)`（公有化 cast 消失，I-3④ 逃逸面闭合）；perm-events :105 改 `gw.sessionGuard.sweepIntervalMs.bind(gw.sessionGuard)`（jitter 区间断言逐字保留——访问形态改道非断言修改）+:114 锚随迁（§8.3-2） |
| ⑤ | Persistence 950 锚零余量——B2 零回写 | 硬约束落地：SG/DR 对 persistence 能力**全部经既有公有面直引**（§4.1 清单——实测所需 13 成员均已 public/readonly）；persistence host 接口签名不变（gateway bindHost 实现改接 DR/SG，§4.1）；persistence 文件 W3 全程零 diff（出口断言：git diff --stat 该文件=0） |
| ⑥ | eslint warning discardForGoneProject 未用参 | 实测确认：persistence :414 `documentName` 形参体内零消费。⑤红线优先⇒ **B2 不修**，B3 收口（删参=调用点两处同文件内、零断言面）；B2 出口报告登记该裁决 |
| ⑦ | flaky（auth-reason 负载窗） | 知悉不处理（既有环境陷阱归因，T40 出口报告在案） |

## 10. 风险与停下问项（RC 清单——B1 RC1-RC5 同款格式）

| RC | 分歧点 | 候选 | 推荐+理由 |
|---|---|---|---|
| RC1 | residency 并入形态 | A=类文本吸收；**B=组合持有（委托位迁域+attach 缝，residency 文件零改动）**；C=仅注释宣告 | **B**——P1「搬迁非重写」最小字面；reaper spec :494-497 注册缝断言+5 直构点+㉕/⑮/Z65 三锚全零触碰；A 的代价（断言面大触+1800 行巨文件+3 锚随迁）与收益（文本合一）倒挂。风险披露：B 下「会话表本体在 residency 文件」——目标形态表「常驻表归此」以域合计账（DR 1030+residency 761=1791）+委托位所有权呈报，T43 确认点⑥ 复核 |
| RC2 | guardSyncFrame/quota 冻结族归属 | A=DR（状态所有权：quota/truth/freeze/SV 代际全 pid 键 DR 态；bytes 桶/freezeReasons/hardClose 三处 SG 缝）；B=SG（「限流」字面）；C=拆 beforeSync 分层（帧闸+桶=SG，配额=DR） | **A**——Z24 单源判据：判定链读写的主状态在 DR；C 把「⓪→⓪′→①→②→③→④ 分层序钉死」的同一同步判定链切成两半（Z24 原文反对形态）；B 使 DR 冻结族被 SG 反向驱动（writeFreeze 之外再造跨域写面）。代价=SG 硬判据「限流」的 bytes 桶 consume 经缝（1 位） |
| RC3 | heap 家族拆分 | A=拆（heapPressureSample/overloadTripped/syncOverloadGauge→SG；observeIdleDocs/docStuckRounds/stuckDocsSeen/heapObserverTimer→DR+heapPressureSample 缝 1 位）；B=整族 SG；C=整族 DR | **A**——overloadTripped 消费者=准入闸（auth/load 两闸+isHeapPressureTripped 委托）属 SG 判定态；docStuckRounds/stuckDocsSeen=doc 账目（computeDegraded 读）属 DR；B 使 stuck 账目跨域读、C 使准入闸判定跨域读——A 缝最少（1 位）且状态所有权最纯 |
| RC4 | connected 钩子体落点 | A=B2 即迁 SG.onConnected（DR 读经 SG→DR 构造直引 3 位：isVacuuming/quotaFrozen/buildDocStatus）；B=留 GW 至 B3 | **A**——B3 目标「gateway 只余 hook 签名→service 调用」；connected 体消费面 8 成员中 5 个 SG 所有，留 GW 则 B3 二次搬迁同一块（两跳漂移面）；SG→DR 直引为 §4.1 既有边零新增。风险：connected 体 24 行含 hardClose 4410 terminal 语义——逐字平移+既有 spec（quota-gate/t20）守卫 |
| RC5 | clearDrainTimer/委托位退役节奏 | A=B2 全保留（§9② 裁决+委托位 ~30）；B=B2 即退役部分委托位（消费方改直注 DR/SG） | **A**——B2 消费方文件零触碰（§4.4 十文件清单）是行为零变化的结构保证；委托位退役=B3「本体收敛」的既有议程（§7.2 手段③），提前=范围蔓延 |
| RC6 | verdict 纯函数落点+门禁 universe 扩面 | A=service 文件顶层导出（SG/DR 各自）；B=独立 collab-verdict.util.ts；universe：a=B2 同批扩三文件 / b=延至 B3 | **A+a**——A：verdict 消费者=同文件方法壳+对应 spec，无跨文件环（B 的 util 仅在出现循环时才有必要，doc-name.util 先例的成立前提此处不存在）；a：B2 后 gateway universe 缩至 ~40，不扩则 SG/DR 私有成员裸奔（Z140② 防线空心化）——脚本改动小（parsePrivateMembers 多文件参数化）+自测扩例同批 |

## 11. 实施波次建议（commit 边界与出口判据）

- **W1（本报告）**：设计确认——RC1-RC6 控制方裁决（批执行期授权内可自裁的项按 §0.6 纪律先登记）。出口=RC 裁决记录落盘。
- **W2（偏离登记+先红用例）**：①RC 裁决+锚随迁 4+1 处（§8.3）+census 五组白名单预改（改完 census 应红——搬移未发生，红证据留存）→**此步单 commit 会红，故与 W3a/W3b 各自同批**；W2 实际独立 commit=TD 台账③登记+穷举单测先红（collab-state-machine.spec 42+7 对矩阵/doc-lifecycle 七维+清理点普查表——现状红：49 非法对无点名断言载体/清理点差异无钉死）+Z65 域视角复断言。出口=先红清单与用例数入账（八真红门纪律）。
- **W3a（DocRegistry 主体搬移）**：collab-doc-registry.service.ts 新建（DR 域逐字平移+host 接口+residency 委托位迁域+attach 缝）+gateway DR 侧瘦身（委托位/bindHost 接线/钩子改接）+census ④⑤㉒⑮ 白名单同批+反射锚三对象扩面同批+pg-breaker 四文件求和锚同批。出口=collab unit+int 全绿+census 23/23+persistence 文件 git diff=0（承接账⑤ 断言）+穷举单测 DR 部分转绿。
- **W3b（SessionGuard 主体搬移）**：collab-session-guard.service.ts 新建（SG 域逐字平移+verdict 纯函数化 §5+onConnected/onDisconnectCleanup 缝）+gateway SG 侧瘦身+auth-defense/perm-events/sweep 三锚随迁同批+census ⑤⑥ 目标文件切换同批。出口=同 W3a+verdict 函数逐条与原判定表达式对照表入 commit message（搬移+参数化自证）。
- **W4（测试面改道+门禁核销）**：façade 扩 sessionGuardOf/docRegistryOf+~30 方法改道+≤8 新方法；57 处登记红逐文件核销（56 处公有化改道+clearDrainTimer until 改 B3）；承接账④ 两点消灭；门禁 universe 扩面（RC6-a）+自测扩例；登记基线 drift/stale 同批。出口=门禁 --report 余 1 处+façade N 实测入账+collab 全目录绿（断言零修改自证：diff 中 expect 行仅访问形态改道）。
  > **W4 完结注记（2026-10-17）**：commit **215f759e**——façade 改道（sessionGuardOf/docRegistryOf 单点）/57→1 登记红核销/承接账④ 两点消灭均已随 W3a（919bf31f）/W3b（bb5bd2fc）切出批同批提前兑现（控制方波次分工调整，W3a 勘正注记同源）；本 commit 落地剩余件=门禁 universe 扩三文件（UNIVERSE_FILES_REL 写死 gateway+SG+DR/buildUniverseFromFiles 纯函数合并/缺失 exit 2；实测 universe 31→**108** 成员，现状违规仍 **1 处/1 文件**=clearDrainTimer until B3，扩面无新违规暴露）+自测扩例 **4** 用例（TDD 先红实证；facade 自测 29→**33/33** 绿）。
- **W5（出口链+B2 步门）**：pnpm verify 全链+di-smoke（新 provider×2 入图）+census+façade 门禁+scripts-node-test+行数三锚实测→偏离 65 重标登记（SessionGuard/DocRegistry 两值+gateway 中间值）+B2 出口报告（账目：三文件行数/委托位数/host 缝位数/核销数/锚随迁数/承接账①-⑥状态）。出口=B2 步门=T43 前置。
  > **W5 完结注记（2026-10-17）**：commit=本注记所在 docs commit——①偏离 **74** 登记（spec §0.6）：SG 锚 ≤500→**≤1238**（实测恰达；超 §7.1 预估 ≈1030-1100 构成=verdict 纯函数 9 个含 docstring ≈120+host 5 位含逐位消费点行注 ≈15+承重注释随迁）/DR 锚 ≤500→**≤1082**（W3a 实测=重标建议 ≤1100 内恰达）/gateway 本体 B2 中间实测 **1031**（B3 终标）；域合计账=GW 1031+SG 1238+DR 1082+persistence 950+residency 761=**5062 行**随确认点⑥（T43）呈报复核。②偏离 **75** 登记+W3b 遗留真红修复：dual-client-server.spec（src/test-utils/=门禁执法面外）spy 宿主 `gateway` 原型 `authenticate` 随 W3b 迁 SG 消失 ×2 用例红——改 `Object.getPrototypeOf(kit.gateway.sessionGuard)`（断言值/超时逐字零变化），verify full 首跑暴露非本波引入。③出口链实测：verify full **26 步 PASS**（修复后重跑）+collab unit **864×2 轮**（零 flaky）+int **37**+di-smoke **3**（DATABASE_URL 在位实跑非 skip）+census **23/23**+门禁 universe 108/登记红 1 PASS+scripts-node-test 全绿；行数四账=gateway **1031**/SG **1238**/DR **1082**/façade **904 行 N=124**（零增减）；git diff=0 终验=persistence/residency/外部消费方十文件零触碰+生产代码零改动（本波 diff=scripts 2+文档 2+spec 测试文件 1〔偏离 75〕）。**B2 步门达成=T43 前置就绪**。
- **风险预案**：W3a/W3b 任一出口红且根因=设计边界（非机械搬移误差）→ 停下问（禁垫片绕行）；flaky 复现按 T40 归因口径单跑复核后如实呈报（⑦）。

> **W3a 勘正注记（2026-10-17）**：W2 行「collab-state-machine.spec 42+7 对矩阵」勘正为 **49 全矩阵**（18 合法边+7 自环+24 非法对——§6.1 勘正注记同源，W2 已按 49 落地 53 用例全绿）；「49 非法对无点名断言载体」之「49」为笔误，非法对实测=24。W2 行「façade 扩面归 W4」表述经控制方波次分工调整：**façade DR 族改道（docRegistryOf 单点+镜像接口）已同批 W3a 兑现**（不改道则 DR 成员迁出后 façade 读 undefined=出口全绿不可达）；SG 族改道+universe 扩面（偏离 71）仍归 W3b/W4。

## 12. 控制方裁决记录（2026-10-17）

> §10 RC1-RC6 停下问项控制方裁决已出，本节=落盘记录（W1 出口「RC 裁决记录落盘」，§11）；§9 承接账②③⑥三项处置同记。先登记后实施纪律（spec §0.6）以偏离 69/70/71 三行同批兑现。

| RC | 裁决 | 一句话依据（自 §10 推荐理由提炼） |
|---|---|---|
| RC1 | **B（组合持有）**——residency 并入 DocRegistry=「域归属搬迁」：residentSessionReleaser/Probe 4 委托位+释放入口所有权迁 DR（attach 缝后置绑定），residency 文件/类/DI/5 直构点/reaper spec 注册断言（:494-497）/census ㉕⑮/Z65 三锚全零触碰 | P1「搬迁非重写」最小字面形态；候选 A（类文本吸收）注册缝断言大触=行为零变化红线+DR ≈1800 行巨文件+3 锚随迁代价与收益倒挂；域合计账（DR ≈1030+residency 761=1791）随确认点⑥ 呈报复核 |
| RC2 | **A**——guardSyncFrame+quota 冻结族归 DocRegistry（bytes 桶/freezeReasons/hardClose 三处 SG 缝） | Z24 状态所有权单源判据：判定链读写主状态（quota/truth/freeze/SV 代际）全 pid 键 DR 态；候选 C 把 ⓪→④ 分层同步判定链切两半（Z24 原文反对形态）；代价=SG 硬判据 bytes 桶经缝 1 位 |
| RC3 | **A**——heap 家族拆分：heapPressureSample/overloadTripped/syncOverloadGauge→SG；observeIdleDocs/docStuckRounds/stuckDocsSeen/heapObserverTimer→DR+heapPressureSample 缝 1 位 | 准入闸判定态消费方=SG（auth/load 两闸+isHeapPressureTripped 委托）；stuck 账目=doc 生命周期账目（computeDegraded 读）属 DR——A 缝最少（1 位）且状态所有权最纯 |
| RC4 | **A**——connected 钩子体 B2 即迁 SG.onConnected（DR 读经 SG→DR 构造直引 3 位） | 消费面 8 成员中 5 个 SG 所有；留 GW 则 B3 二次搬迁同一块（两跳漂移面）；SG→DR 直引为 §4.1 既有边零新增——B3 目标「gateway 只余 hook 签名→service 调用」本批即达 |
| RC5 | **A**——委托位 B2 全保留（§9② 裁决+~30 位），退役归 B3 | B2 消费方文件零触碰（§4.4 十文件清单）是行为零变化的结构保证；提前退役=B3「本体收敛」既有议程（§7.2 手段③），提前=范围蔓延 |
| RC6 | **A+a**——verdict 纯函数落 service 文件顶层导出（SG/DR 各自）+façade 门禁 universe 同批扩三文件现场解析 | A：verdict 消费者=同文件方法壳+对应 spec，无跨文件环（doc-name.util 先例的成立前提〔循环消解〕此处不存在——B 独立 util 仅在出现循环时才有必要）；a：B2 后 gateway universe 缩至 ~40，不扩则 SG/DR 私有成员裸奔=Z140② 防线空心化（spec 偏离 71 登记） |

**承接账处置（§9 三项）**：
- **②clearDrainTimer 留 gateway 本体（drain 编排域）until B3**——drainAutoReleaseTimer 驱动 draining→serving 跃迁，跃迁权=collabState 单一所有者（GW），定时器随权走；beginDraining/clearDrainTimer/drainAutoReleaseTimer 三件套整体不迁（链 2 编排点，§2.2）。write-endpoint.int :207 登记行 until 改 'B3'+注记「drain 编排域——B3 收敛时裁公有化或 façade stub」（W4 核销批执行）。
- **③裸 pid 疑点（collab-persistence.service.ts :919 schedulePersistRetry(projectId)）**——B2 零回写 persistence（⑤红线：950 锚恰达零余量）⇒ **登记 TD-28**（docs/superpowers/tech-debt.md「后端（apps/api）」节，本裁决同批落盘；修复方向=键口径裁决后单行修+regression spec）。
- **⑥eslint warning discardForGoneProject 未用参（persistence :414 documentName 形参体内零消费）**——⑤红线优先 ⇒ B2 不修，**归 B3 收口**（删参=调用点两处同文件内、零断言面）；B2 出口报告登记该裁决状态。


