<!-- doc-status: draft | created: 2026-11-11 | 三路线用户裁定（2026-11-11 对话三轮）：C1 时间墙=A 全列 timestamptz（外审报告时间墙章节并入+三点修正）；C2 Outbox=A+processing 守卫（用户修正采纳；「confirm 时建 binding」经评审否决——语义污染，理由见 §3.2.3）；C3 refcount=路线 1+等价性门序（用户修正：loopback/复核窗等价性红测通过后再拆）。C1 genesis 种子勘正=用户裁定（全环境 reset 使 T31「迁移不可改」前提失效，同批删登记条目）。心跳 sidecar 等=登记不进批。 -->
# 地基修复批（时间墙 timestamptz 全列化 + MediaFactOutbox 死行清扫 + MediaBinding 写路径事务化）设计 spec

日期：2026-11-11（立项日；spec v1=三路线裁定落库版）

定位：production-readiness 批（2026-11-11 全闭+改档 production）后继开发批。**三项地基修复**：①时间墙混用类级根修（claim 租约时区根修时发现的潜伏 bug 族，全仓审计已完成）②MediaFactOutbox 死行（纯拉取模型下 pending 永不转态的观测面失真+无界增长）③媒体引用索引写路径事务化（erasure/media-gc 免 doc 扫描免复核窗，Y2 typed-ref 底座）。批序 C1→C2→C3，三卡全闭环后批末出口门；**全环境 reset 部署窗=用户显式指令时点**（C1 全列类型变更所致）。

**本批不做**：可用性/HA/分片/快照分层/IDB 增量/tracing 等架构项——外审报告（2026-11-11 用户转呈《Yjs 核心协作架构升级评审报告》）评审结论=方向正确但多为已登记触发型 backlog，仅时间墙章节并入本批；其余按 §6 登记带触发条件，不改变本批范围。

## §0 已裁定（不再议）

- **C1 路线 A（全列 timestamptz）**：167 列（以 schema.prisma 全量为准）`@db.Timestamptz(3)`；裸 `now()` 全部自动合法（瞬时语义）；现有 ~20 处 `(now() AT TIME ZONE 'utc')` 补偿谓词整体拆除；会话时区依赖类级消失（CI=UTC vs 生产=+8 分歧同灭）。仓内先例=CollabLease（唯一 timestamptz 列，审计确认无墙问题）。
- **C1 genesis 种子勘正（用户裁定）**：T7 迁移种子笔裸 `now()` 改 UTC 写法；T31 登记「迁移不可改残留+新装漂移窗+必经 bump 自愈」条目**删除**（其「不可改」前提=迁移已应用于生产服务器，本批全环境 reset 使前提失效）；转换迁移的 `USING ... AT TIME ZONE 'UTC'` 只对 reset 回放/新装有意义，不用于转换 seed 行。
- **C2 路线 A+processing 守卫（用户修正采纳）**：死龄直删+binding 守卫**+processing 守卫**（生成期 binding 要到 finalize 才写、doc 引用先于 binding 存在的真实窗口）；lag gauge 挪 worker 周期+staleness 伴随指标；四死列+索引+dead 枚举同批拆。
- **C2「confirm 时建 binding」否决**：MediaBinding=doc 引用真值（erasure/media-gc 消费面），无槽位归属锚行会被 reconcile stale 删（白写）或污染 erasure 保留面（错误方向）——见 §3.2.3。
- **C3 路线 1+等价性门序（用户修正采纳）**：消费既有 MEDIA_REF_* 帧效应同事务维护 MediaBinding；**loopback 端点与复核窗的退役以「等价性红测」（双读对照）通过为前置**，不先拆。
- 流程纪律：superpowers TDD（红先行→绿）、TypeScript strict、subagent-driven+每卡双评审、根修禁垫片、迁移串行不并行、新 commit 禁 amend。

## §1 事实基线（2026-11-11 三路探索锚点）

### §1.1 时间墙审计（全仓 167 列摸排完毕）

**墙别判定规则**：`@default(now())`=DB 会话墙（DDL 落 `DEFAULT CURRENT_TIMESTAMP(3)`，生产=Asia/Shanghai +8、CI=UTC）；`@updatedAt`/typed Prisma Date=UTC 墙；raw 裸 `now()`=会话墙；`(now() AT TIME ZONE 'utc')`=对齐式 UTC（naive）。

**真实混墙风险点（C1 处置对象；行号=2026-11-11 摸排）**：

| # | 风险点 | 机理 | C1 处置 |
|---|---|---|---|
| 1 | LightingTask 60s 幂等窗（lighting.service.ts:74-81 vs :99 省略 createdAt） | typed UTC 窗 vs DB 墙列→+8 下窗实际≈8h | 类型改后零代码自愈 |
| 2 | canary 7d 活跃窗/last_check_age（collab-replay-canary.poller.ts:109、collab-canary-verify.worker.ts:322-328） | 裸 now() vs CanvasDoc.updatedAt（异墙两写者列） | 零代码自愈（两写者列同时归一为瞬时语义） |
| 3 | RuntimeEvent 7d 保留窗（runtime-feed.retention.service.ts:73,111） | UTC 谓词 vs DB 墙列→实际 7d+8h | 拆补偿谓词（§3.1.3 清单） |
| 4 | MediaFactOutbox.nextAttemptAt 首投 8h 不可认领（projection-outbox.poller.ts:207） | DB 墙默认 vs UTC claim 谓词 | 死代码（claim 路径未实现）；C2 拆列根治 |
| 5 | ArtifactProjection 30d / ReconcileAction 90d 清理（intent-reconcile.service.ts:542,554） | typed 窗 vs DB 墙列 | 零代码自愈 |
| 6 | ObjectManifest 24h 孤儿门（object-manifest.service.ts:91,104） | UTC 谓词 vs DB 墙列 | 拆补偿谓词 |
| 7 | TeamCreditTransaction 15min 冻结释放窗（intent-reconcile.service.ts:592,604） | 当前同墙但前提脆弱（新增显式写者即翻转） | 类型改后类级免疫 |
| 8 | SystemHistory.epochStartedAt（T7 迁移种子裸 now()） | DB 墙种子+typed UTC 读=+8h 漂移（T31 登记） | **种子勘正**（§3.1.2） |
| 9 | Session.createdAt 滑动续期（auth/session.service.ts:42） | DB 墙列 JS 读回做年龄 | 零代码自愈（低危，方向安全） |
| 10 | StyleRecentUsage.lastUsedAt 两写者异墙（styles.service.ts:149） | 排序面跨行可比性偏 8h | 零代码自愈 |
| 11 | 潜伏异墙两写者列：TeamBalance/MaintenanceOperation/CollabJobCursor/NodeExecution.updatedAt | 裸 now 写+@ua 写并存 | 零代码自愈（瞬时语义归一） |
| 12 | projection-outbox.poller.ts:482 dead-requeue 窗 | UTC 谓词 vs DB 墙 createdAt | 拆补偿谓词 |
| 13 | GenerationIntent.createdAt（createMany 省略，无窗读者） | 潜伏 | 零代码自愈 |

**已核实一致面（不动）**：ExecutionRequest/ExecutionInput.expiresAt 全链、GenerationIntent heartbeat/deadline 族、Media 全 lease/expiry 族、CollabLease（tsz）、CanaryPin/CollabCanaryCursor（裸 now 自洽族）、ProjectErasureRun lease 族（C4-b 根修在位）、订阅日级到期、media-gc deletedAt 族。

### §1.2 MediaFactOutbox 现状

- 模型 schema.prisma:1642-1660；枚举 `MediaFactState=pending|published|dead`（**dead 从未被写入**）；唯一键 `[mediaId,projectId,factType,factVersion]`。
- **四死列**：`attempts/leaseUntil/nextAttemptAt/lastError`+`@@index([state,nextAttemptAt])`——spec Z1'' 推送式 emitter 设计残骸（全仓零读写；本次审计还被误导出「8h 不可认领」假 bug）。
- 写面 5 个插入点全 `createMany skipDuplicates`（media-registration:258/298、media-probe.poller:419、materialize-job:406/551）——上传路径唯一写点=probe doneNatural；**生成链 stage 时即写 processing fact，binding 要到 finalize 才经 bindInTx 建立**（artifact-commit:573-610）——processing 期 doc 引用先于 binding 存在。
- 消费面：纯拉取——唯一端点 `POST /api/media/facts`（media-facts.controller.ts:40-97），pending→published 唯一转换；拉取集=客户端 doc 九键引用集（mediaFactsRuntime.ts）∪ feed 事件定向补拉。
- 清理：`IntentReconcileService.reconcileDaily`（24h 定时器）只清 `published ∧ publishedAt<now−7d`（OUTBOX_RETENTION_MS=7d，intent-reconcile.service.ts:36）；**pending 行无任何 sweeper 管辖**（整项目擦除除外）。
- 指标：`media_fact_outbox_lag`=全局最老 pending 行龄（delivery-lag.metrics.ts:31-35），**只在 facts 端点被调用时刷新**（消费即观测）；未接告警链（THRESHOLDS 无 media 指标）——失真面=soak 观测+表无界增长（dev 库 144 行 fixture 死行实证）。

### §1.3 媒体引用图现状

- **erasure 八要素**（resolveMediaDisposition，project-erasure.stages.ts:194-254）：要素 1-7（MediaBinding/NodeArtifact/VideoWork/LightingTask/VideoTrimTask/VideoProject.data 深扫/ObjectManifest claim）=SQL 查询，快且不 racy；**要素 8=doc 面扫描**——worker 经 loopback `POST /api/collab/doc/media-refs`（collab-spool.service.ts:1983-2007：限批 200、项目数上限 500、非 serving=503 fail-closed、读失败上抛 503）→ `docScanFailed=true` 时本轮不删。
- **复核窗**：`ERASURE_MEDIA_REVIEW_MS=60_000`+pending-media sidecar（`<erasureId>.pending-media.json`，stages:61-141）——「标记与删除不得同窗」防扫描漂移；C4 批落成时 doc 扫描=最终一致性产物故必须双 tick。
- **帧效应已在位**：actor 临界区已派生 `MEDIA_REF_ADDED/REMOVED`（collab-project-actor.service.ts:229-263，含换绑 ADDED/REMOVED 对与 update 档 rebuild 修正）+ `ProjectDocIndex.mediaRefsByNode` 增量投影——**但只喂内存索引，无同事务持久化**。
- **MediaBinding**（schema:1623-1638）：槽位粒度 current-state 索引，唯一键 `[projectId,nodeId,role,targetField,targetItemId]`，`mediaId` 为行值；维护=`BindingReconcileService` 惰性收敛（post-apply requestReconcile 5s drain+5min 发现轮，binding-reconcile.service.ts:141-262，desired 集不含的槽位行删）。
- **media-gc 同族**：引用图=binding∪NodeArtifact∪VideoWork∪VideoProject.data 深扫∪**doc 扫描终裁**（media-gc.service.ts:112-168，读失败=保守保留）。
- **Y2 登记**（spec 2026-10-18 design :553）：mediaRef typed-ref 取代裸 fileId+Artifact 一等表；schema 已承诺「稳定 Media.id、不引入与 Artifact 表冲突字段」——本批 C3 表形不变，typed-ref 建于同一索引。
- 命令面直写点：bindInTx（media-registration:186-215）三调用方（finalize artifact-commit:601 / replaceMedia collab-media.controller:140 / BindMedia·CloneBinding collab-binding.controller:149-152）。

## §2 卡序与裁决

| 卡 | 内容 | 重量 | 先行理由 |
|---|---|---|---|
| C1 | 时间墙 timestamptz 全列化+三门禁 | 中（迁移机械+谓词拆除） | C2 死龄清扫谓词依赖时间语义先归一 |
| C2 | Outbox 死行清扫+死列拆除+观测面收口 | 轻 | 独立；fixture 144 行实证可即时验收 |
| C3 | MediaBinding 写路径事务化+消费面切换+复核窗拆除 | **本批最重**（动 actor→appendBatch 最敏感写路径） | 殿后；等价性门序要求 C2 后专注重锚 |

执行=subagent-driven、每卡 TDD 双评审（spec ✅+quality ✅）、每卡先红→绿→commit；卡间不并行。

## §3 卡设计

### §3.1 C1 时间墙 timestamptz 全列化

**3.1.1 schema/迁移**：schema.prisma 全部 DateTime 列加 `@db.Timestamptz(3)`（CollabLease 两列已是，保持）；单条转换迁移 `ALTER TABLE ... ALTER COLUMN ... TYPE timestamptz(3) USING <col> AT TIME ZONE 'UTC'`（全列一条迁移；语义=reset 回放/新装——本批全环境 reset，不承担存量转换）。混墙存量行（CanvasDoc.updatedAt 等异墙两写者列）不做逐列还原——reset 即清。

**3.1.2 genesis 种子勘正**：T7 迁移（20261024120000）种子笔 `now(), now()` 改 `(now() AT TIME ZONE 'utc')` 同形写法（迁移编辑合法窗口=本批全环境 reset；CI 每次全新回放不受影响）；**同步删除 T31 在 runbook §16 步⑥ 的「T7 genesis 迁移 bootstrap 裸 now() 不可改残留+新装漂移窗+必经 bump 自愈」登记条目**（登记原文所在处以一行「2026-11-11 foundation C1 勘正销案」替代）。

**3.1.3 补偿谓词拆除清单**（`(now() AT TIME ZONE 'utc')`/`'UTC'` → 裸 `now()`；grep 全量清零不逐文件手改）：object-manifest.service.ts:91,104 / node-artifact.service.ts:93,105 / media-registration.service.ts:249-250 / materialize-job.service.ts:195-196 / media-probe.poller.ts:185-186 / projection-outbox.poller.ts:207-208,478,482 / execution-request.retention.service.ts:53,89,116,122,144,159 / execution-request.service.ts:562 / team-credit.service.ts:253 / generation-intent.service.ts:313 / intent-reconcile.service.ts:172,197,530,533 / project-erasure.poller.ts:177,180 / runtime-feed.retention.service.ts:73,111 + 测试锚同步翻转（generation-intent.service.spec.ts:619-625 等同款 AT TIME ZONE 锚）+ runbook §16 步⑥ bump SQL 注释更新。报表/展示层显式时区转换（如未来「按上海时区取日」）不在拆除面——显式 `AT TIME ZONE 'Asia/Shanghai'`+注释合法。

**3.1.4 三门禁**：
1. **schema 门禁**：解析 schema.prisma，任何 DateTime 字段缺 `@db.Timestamptz(3)` 即红（负控=故意加一 naive 列必须红）。
2. **raw SQL 门禁**：新代码/新迁移禁 `timestamp(3)`、`timestamp without time zone`、`now()::timestamp`、补偿式 `AT TIME ZONE 'utc'`；**豁免=历史迁移目录（C1 转换迁移之前）+报表层显式时区转换（带注释）**；负控=加一处补偿谓词必须红。
3. **双时区集成测试**：真 PG int spec，同一组用例在 `SET TIME ZONE 'UTC'` 与 `'Asia/Shanghai'` 两腿下断言同结果——用例集：lease 过期/续租、retention cutoff、canary age 窗、erasure claim 租约谓词、`@default(now())` 插入、`@updatedAt` 更新。会话时区注入方式（事务内 SET / 连接参数）归 plan。

**3.1.5 reset 序**：dev=`prisma migrate reset`；服务器=`reset-collab --rebuild-db --confirm` §16 七阶段人工序（消费者全停前置）。**部署时点=批末用户显式指令**。

**3.1.6 验收锚**：三门禁全绿+负控红证；双时区测试两腿绿；§1.1 风险点 1/2/5/9/10 既有测试在 +8 本机环境跑绿（时区漂移敏感用例的天然回归面）；verify FULL。

### §3.2 C2 MediaFactOutbox 死行清扫

**3.2.1 清扫谓词（双守卫）**：
```sql
DELETE FROM "MediaFactOutbox" o
WHERE o.state = 'pending'
  AND o."createdAt" < now() - make_interval(secs => $OUTBOX_RETENTION_MS/1000)
  AND NOT EXISTS (SELECT 1 FROM "MediaBinding" b
                  WHERE b."mediaId" = o."mediaId" AND b."projectId" = o."projectId")
  AND NOT EXISTS (SELECT 1 FROM "Media" m
                  WHERE m.id = o."mediaId" AND m."projectId" = o."projectId"
                    AND m.status = 'processing')
```
- binding 守卫：per-(mediaId,projectId) 粒度=拉取语义精确对应（跨项目事实行各归各项目的 binding 判定）。
- processing 守卫（用户修正）：生成期 doc 引用先于 binding 存在（stage 即写 processing fact、finalize 才 bindInTx）——processing 态媒体的事实行不删。
- 落点=`IntentReconcileService.reconcileDaily` 与既有 published 7d 清理同函数同事务族；计数指标入 intent 域 `.metrics.ts`（result 标签：deleted-orphan/kept-binding/kept-processing——低基数，禁 mediaId/projectId 标签）。

**3.2.2 观测面收口**：`observeOutboxLag` 的 SQL 挪 worker 周期（挂既有 poller tick，≤60s 级，facts 端点原刷新点保留）；新增伴随 gauge `media_fact_outbox_lag_refresh_age_seconds`（距上次刷新秒数——staleness 心跳性质，防 worker 半死后 gauge 停僵值）；worker 进程死=既有 check-collab-health 三档分诊承载（不重复建）。

**3.2.3「confirm 时建 binding」否决登记（用户替代方案评审）**：MediaBinding 是 erasure/media-gc 的 doc 引用真值消费面——confirm 时无 nodeId/槽位的「项目归属锚」行，要么被 reconcile stale 清扫删除（写而无用），要么存活污染 erasure 保留判定（从未上画布的媒体被当作「被引用」永不删——与本卡目标相反）。正确收口=processing 守卫（已并入谓词）+ 残差登记（§3.2.4）+C3 事务化从根收敛。

**3.2.4 残差诚实登记**：completed 媒体+已进 doc+binding 缺失>7d 的误删面=reconcile 失灵残差（正常路径 5s-5min 收敛）——C3 落地后 binding 写入移入 doc 写路径事务，残差收敛至近零；reconcile 健康度观测（漂移计数/收敛年龄告警）=后续登记项（§6）。

**3.2.5 死列拆除**：`attempts/leaseUntil/nextAttemptAt/lastError` 四列+`@@index([state,nextAttemptAt])`+`MediaFactState.dead` 枚举值（PG enum 删值=类型重建，reset 窗口下干净）+schema 注释中 emitter claim 设计描述同步删。4 处 createMany 写点本就省略这些列——零生产代码面。emitter（Z1''）=Y2 域，届时按新设计重建。

**3.2.6 验收锚**：红测四族——①孤儿 pending 7d+（无 binding 非 processing）→删；②binding 在档 pending 7d+→保留（休眠重开补拉路径）；③processing 媒体 pending 7d+→保留；④published 7d 清理既有锚不回归+gauge 无端点流量下周期刷新+staleness gauge 推进。验收含 dev 库 144 行 fixture 死行清零实证。

### §3.3 C3 MediaBinding 写路径事务化

**3.3.1 效应载荷扩展**：`MEDIA_REF_ADDED/REMOVED` 增 `targetField/targetItemId`（actor 派生处已知 key path；shared frame-effects.ts 类型+词表扩展）。**冻结面核点**：frame-effects 属 T5b 契约族——若带 CONTRACT-FREEZE 标记则走偏离登记修订（spec 评审内核点，plan 派发前核）。

**3.3.2 同事务挂点**：appendBatch inTx 尾参挂点（T26 lifecycle obligation 同款纪律）消费 media-ref 效应→MediaBinding 槽位 upsert/delete：ADDED→upsert（唯一键 `[projectId,nodeId,role,targetField,targetItemId]` 置 mediaId）；REMOVED→按同键删；换绑对（同 walSeq REMOVED+ADDED 同槽）=upsert 单行换 mediaId。**NODE_DELETED 帧效应同事务清该 nodeId 全部 binding 行**（节点删除的引用语义即时化，不再依赖 reconcile stale 清扫）。

**3.3.3 写者口径**：①帧效应事务面=**权威派生**（doc 状态变化即 binding 落库）；②命令面 `bindInTx` 三调用方**保留**（replaceMedia/BindMedia/CloneBinding 不经 doc 帧，命令即真值）；③`BindingReconcileService` 降级 **anti-entropy**（漂移修复；频次不动——降频是优化非本批目标）。三者同键幂等，归属语义：命令面写后帧效应 upsert 同值幂等；漂移（命令面失败/历史窗）由 reconcile 收敛。

**3.3.4 等价性门（用户裁定序——先证等价后退役）**：
1. 载荷+挂点落地（红测：效应→binding 同事务断言——崩溃窗「效应落而 binding 未落」不可达；换绑对→槽位行换 mediaId；NODE_DELETED→行清）。
2. **等价性红测**：resolveMediaDisposition 与 media-gc 终裁的 doc 扫描面 vs binding 面双读对照断言同 disposition（既有 erasure int 38 用例面+新增交错用例：换绑/节点删/跨项目引用/休眠项目）。
3. 等价绿后退役清单：loopback 端点 `POST /api/collab/doc/media-refs`+`collectProjectMediaRefs`+`httpMediaRefsCollector`+DTO+`ERASURE_MEDIA_REFS_BATCH/SCAN_MAX` env 键（env.spec §10+census ㉒ 同步）+**复核窗**（`ERASURE_MEDIA_REVIEW_MS`+pending-media sidecar 族+两 tick 收敛逻辑）。
4. **复核窗拆除论据链**（红测锚钉死）：doc 面事务权威（首扫即终局）+REST/结构化写点已被 fence/写锁门禁覆盖（C4-b A 档 census 写点）→ sameSet 恒成立；注入漂移场景证伪旧行为已不可达。

**3.3.5 消费面切换**：erasure 要素 8（docScanFailed fail-closed 路径）整体退役→binding 查询（要素 1 吸收）；media-gc doc 扫描终裁→binding 读（引用图=binding∪NodeArtifact∪VideoWork∪VideoProject.data 深扫）。

**3.3.6 Y2 对齐注记**：表形不变（槽位唯一键），mediaRef typed-ref 演进建于本索引；「稳定 Media.id+不引入 Artifact 冲突字段」承诺维持。

**3.3.7 验收锚**：等价性红测全绿+退役清单清零（grep 锚）+erasure 全链 e2e（含 kill -9 resume）绿+verify FULL；binding-reconcile anti-entropy 漂移注入修复用例绿。

## §4 机器门与登记影响面（批级）

- 指标纪律：新指标入 `.metrics.ts`+`--write-metric-names` 同 commit；涉指标 commit 跑 verify FULL；标签全低基数。
- env 键退役（C3）：env.spec §10+census ㉒ 同 commit；env 新键零新增。
- 新门禁（C1 schema/raw-SQL 门）入 verify 链（fast+full 两档）；负控自测随门禁脚本。
- 模块尺寸锚：collab 域文件如有行数变化按「净增面非膨胀」纪律补登锚值。
- 迁移：C1 一条（全列转换）+C2 一条（死列/enum）+C3 如有（binding 零 schema 变更预期——载荷进帧效应非 DB 列）串行不并行；baseline `--write` 同 commit。
- runbook：§16 步⑥ bump SQL 注释（C1）+§13 恢复面（复核窗退役语义，C3）+§14 分诊面（outbox 指标 staleness，C2）随卡。

## §5 确认点（批流程门）

1. **spec 确认门（本文件）**——用户审阅后转 active。
2. **plan 确认门**——writing-plans 出 plan 后用户确认。
3. 卡序 C1→C2→C3，每卡双评审（spec ✅+quality ✅）。
4. **批末出口门**：三卡全闭+verify FULL+三门禁负控红证+dev 库死行清零实证+呈报包（gate-evidence/foundation-exit.txt——限制诚实登记：C2 残差/C3 anti-entropy 保留面）。
5. **部署窗（用户显式指令）**：服务器 reset-collab §16+全环境重置后冒烟。

## §6 登记/偏离表

| 项 | 内容 | 触发/归属 |
|---|---|---|
| 销案 | T31「T7 genesis 裸 now() 不可改残留+新装漂移窗+必经 bump 自愈」——C1 勘正后删除 | 本批 C1 |
| 修订 | Z1'' emitter 死列拆除（attempts/leaseUntil/nextAttemptAt/lastError+dead 枚举）——Y2 typed-ref/emitter 设计时按需重建 | 本批 C2 |
| 登记 | C2 残差：completed+已进 doc+binding 缺失>7d 误删面=reconcile 失灵——C3 后收敛近零；reconcile 健康度观测（漂移计数/收敛年龄）后续项 | 本批 C2/C3 |
| 登记 | 心跳 sidecar（E35「独立 timer/子进程」vs 实现同 loop setInterval+unref 偏离——spec 2026-10-06:90 实证；单调钟自检在位；T33 F2 移交同族） | 独立小卡，紧随本批 |
| 登记（外审报告消化） | S3 快照分层（触发=snapshot p95 尺寸/bloat）/IDB snapshot+delta/追平状态机（=T33 F1 在册）/tracing·RUM/noisy-neighbor 压测场景/per-doc 公平预算/active-passive（Y7 联动） | 触发型，不进本批 |
| 既有在册维持 | wal-g 异地归档/16G 扩容校准/SMS 实弹演练/DocumentStore 不变量状态机表（runbook 文档化） | 运营窗/后续批 |
| 偏离核点 | frame-effects 载荷扩展若触 CONTRACT-FREEZE→偏离登记修订 | C3 plan 前 |
