<!-- doc-status: draft | created: 2026-11-11 | v3（同日第三轮三份外审实证后重写）：三审共识 P0 全采纳——C3a 投影时点改帧级快照（inTx 读活 doc=v2 实错：applied 队列领先 pgSeq，水位说谎）/C3b 改 PG-based oracle worker（binding=候选筛选，doc 扫描语义永久保留为删除独立证人——换实现不退役；v2「applied 对两者均不可见」等价句实错：活读注释自证 doc oracle 可见 applied）/投影 SAVEPOINT 隔离不挡帧/去 MediaBinding FK/命令面读写两改（CloneBinding 只写 binding 无他写者+BindMedia pairBinding 读 binding——均实证）/C2 补四口（unionFact 丢 natural 实证+factType 契约+去 if(projectId)+观测替代）/C1 四层对象 delta 门（schema-dump 五组不含 function/trigger——ledger_guard() 资金触发器会静默丢，实证）+updatedAt 触发器/批序重排 C2→C3a→C1→C3b（C2 DROP 撞 additive 门——v2 §4 流程矛盾）。两处用户前裁定的变化点：①批序（v2 裁 C1→C2→C3a→C3b→技术必要性重排）；②C3b 不再退役 doc 扫描（v2 裁影子期满退役→三审一致改永久证人）。降级不采纳：clock_timestamp/Node 日历/旧 lag 保留期/lastWalSeq 列/30d tombstone/所有权重设计/doc schema lazy migration=登记。 -->
# 地基修复批 v3（时间语义终态 baseline + MediaFact 当前态 + MediaBinding 帧级投影 + PG oracle 证人）设计 spec

日期：2026-11-11（v1=b849381b；v2=bafd26de；v3=第三轮三外审实证重写版）

定位：foundation correctness batch（正确性地基批——不宣称架构升级，不改变单实例/无 HA/无 S3 边界）。**四卡序（v3 重排）：C2（MediaFact 代码）→ C3a（binding 帧级投影）→ C1（终态 rebaseline）→ C3b（PG oracle 证人+候选化）**。核心原则（三审共识）：**派生索引可以很快，但不能是"不存在"的唯一证人**——binding=快速候选，PG 重建 oracle=删除独立证人（永久）。

## §0 已裁定（v3——含两处对 v2 裁定的修正，请用户确认）

- **批序重排**：`C2-code → C3a-code → C1（终态 rebaseline，含全部最终 schema）→ C3b`。理由（技术必要性）：C2 的 `DROP TABLE MediaFactOutbox/DROP TYPE` 撞 check-migration-additive BREAKING 门（v2 §4「此后走普通 additive」自相矛盾）；C1 先行则 C2 旧代码写已删表=verify 红。新序每卡 additive 独立绿、终态 init 一次 reset、零豁免零 DROP 迁移。C2/C3a 开发期在 naive 时间列上过渡（C2 的 raw upsert 用 `AT TIME ZONE 'utc'` 对齐式——C1 批内统一拆除，grep 清零覆盖）。
- **C3b 方向修正**：doc 扫描**不退役**——换实现（活读 withSession→PG-based oracle worker：Snapshot+Update 在 pgSeq 重建，same-seq、无 residency/lease 依赖）；binding=快速候选筛选+Y2 底座。loopback 退役后移为单独立项（PG oracle 跑满一个保留期后）。
- C3a 帧级快照（apply-post 逐帧捕获，绝不读活 doc）+SAVEPOINT 失败隔离+去 MediaBinding.mediaId FK+命令面读写两改+静态单写者门禁。
- C1 终态 init 含 C2/C3a 全部最终 schema+`set_updated_at()` 触发器全 updatedAt 表+四层对象 delta 门。
- 流程纪律承前（TDD 红先行/strict/subagent-driven 双评审/迁移串行/禁 amend）。

## §1 事实基线（v3 增补——三审实证锚点）

承 v2 §1（13 风险点/门禁冲突/37 种子/::timestamp/updatedAt 写入语义/facts 端点语义/数组效应缺口/LWW 头注/TOCTOU/FK 毒帧/CONTRACT-FREEZE），**v3 增补实证**：

1. **活读领先 pgSeq**（collab-document.service.ts:187-188 注释原文「活读内容可能领先 pgSeq」）：doc 扫描 oracle（withSession 活读，doc 常驻时）可见 applied>pgSeq 在飞帧；binding 只覆盖 pg 前缀——**v2「两者均不可见」等价句错误**。可见面随 residency 漂移=非稳定边界。
2. **applied 队列领先 flush**（水位三元 0≤pgSeq≤appliedSeq≤spoolHeadSeq 的运行常态）：appendBatch inTx 时活 doc=applied 状态（含本批 prefix 之后的帧）——**v2「inTx 内读内存 doc 终态」会把后续帧投影进本批 binding 而 mediaBindingSeq=newPgSeq——水位说谎**（帧 1 加 M/帧 2 删 M/只 flush 帧 1/崩溃重启→PG doc 有 M 而 binding 无 M→GC 误删）。
3. **命令面读写两面**（collab-binding.controller.ts:87-93/:126-155 实证）：BindMedia `pairBinding` **读** MediaBinding 做源配对校验（投影滞后→SOURCE_MEDIA_MISMATCH 400）；**CloneBinding 只写 binding**（findMany 源槽位→bindInTx 克隆，NodeArtifact 零写/注释自认）——改道后该命令无任何写者。
4. **客户端合并契约**（web mediaFacts.ts unionFact/mergeFactRows 实证）：每 media 单 factVersion 合并——纯 natural 无 state 先到=**丢弃**（`base===undefined && part.state===undefined → undefined`）；旧版本 natural 对新版本 state base=`naturalFill` 仅等版本生效→忽略。**v2「客户端零改动」不成立**（natural v5+state v6 场景 natural 必丢）。
5. **schema-dump 五组不含 function/trigger/policy/grants/comments**（schema-dump.mjs:14-25 实证）；init 迁移含 `ledger_guard()` 函数+TeamCreditTransaction/TeamBalance 两资金触发器（migration.sql:1422-1435）——**v2 对象 diff 门若用现有基建会静默丢资金不变量**。
6. **scope-column.registry.ts:59 列 MediaFactOutbox**——v2 退役清单漏项（表删后 erasure 对不存在表批删=红）。
7. media-registration 两写点包 `if (params.projectId)`（:258-270/:298-305）——当前态模型下无意义（素材库/未归项目媒体应有 fact）。
8. **GC 引用图漏 LightingTask.resultMediaId**（media-gc 引用图=binding∪NodeArtifact∪VideoWork∪VideoProject.data∪doc 扫描——无 Lighting/Trim/Manifest；erasure 八要素有）——引用图需单源化。
9. check-fresh-replay 语义=主库 vs scratch 重放——rebaseline 下循环自证，不能作 squash 验收主门。
10. PG FK 失败=事务 aborted（非跳过）——「INSERT..SELECT JOIN 预校验」防不了并发删 media 的竞态窗口。

## §2 卡序（v3）

| 序 | 卡 | schema 动作 | 出口 |
|---|---|---|---|
| 1 | C2 MediaFact 当前态 | additive 建表（naive 期） | 写点/端点切换+客户端契约红测+旧表停写 |
| 2 | C3a binding 帧级投影 | additive 加 CanvasDoc.{mediaBindingSeq,bindingsDirty} | 帧级快照/savepoint/命令面两改/恢复四路红测+bench-smoke |
| 3 | C1 终态 rebaseline | **单一新 init=最终 schema**（全 timestamptz+无 outbox+触发器+去 FK 形） | 四层对象 delta+三门禁+双时区+verify FULL |
| 4 | C3b oracle 证人+候选化 | 无（或 oracle 水位表 additive） | PG oracle+全局 coverage+抽样+回滚开关+引用图单源 |

## §3 卡设计

### §3.1 C2：MediaFact 当前态表（代码先行，schema 过渡）

1. **建表**（additive）：`MediaFact{mediaId,factType CHECK IN ('state','natural'),factVersion BigInt,payload Json,updatedAt,media FK Cascade}`+`@@id([mediaId,factType])`+`Media.facts` 反向关系；payload 写前 zod/共享类型校验（state: status∈processing|completed|failed；natural: 宽高/旋转/source），端点读侧再校验+坏行计数跳过。
2. **写点改道**（5 处 createMany→单行 upsert）：`INSERT ... ON CONFLICT DO UPDATE SET ..., "updatedAt"=now() WHERE EXCLUDED."factVersion" > "MediaFact"."factVersion"`（版本单调；**updatedAt 显式写**——raw SQL 不吃 @updatedAt）；naive 过渡期 `now()` 处用 `(now() AT TIME ZONE 'utc')`（C1 统一拆除）；**去掉两处 `if (params.projectId)`——media 级无条件写**（素材库/未归项目媒体同样有 fact）；probe/materialize 路径用 `INSERT..SELECT..WHERE EXISTS(Media)` 形态防 FK 竞态（media 并发硬删=跳过+计数，不炸 poller 事务）；finalize 路径保留 FK 严格性。
3. **端点改道+服务端版本归一**（修客户端丢 natural）：`POST /api/media/facts` 按 mediaIds+team ACL（补 `deletedAt:null` 过滤）直查当前态行；**每 media 以 `max(factVersion)` 合成版本返回、state 在前 natural 在后**——客户端 `equalVersion+naturalFill` 生效，natural 不丢；不 mark published。
4. **旧面退役**（表暂留到 C1）：5 写点/端点读/intent-reconcile `cleanProjectionAndOutbox` outbox 段+dead-letter count 告警/r3 测试 seed/`media_fact_outbox_lag` gauge/soak 两处引用/**scope-column.registry 条目**（表还在但 erasure 不再清它——C1 删表）；`reconcileDaily` 保留（仍清 ArtifactProjection/ReconcileAction）。
5. **观测替代**（不能「无替代」）：`media_fact_age_seconds{factType}`（当前态行最大年龄）+`media_fact_read_total{result=hit|miss}`+事实 canary（定时写读回断言 version/payload，失败告警）。
6. 红测：版本单调（旧版本不倒退）/natural v5+state v6 两顺序合并条目同时有 state+natural/无 projectId 媒体有 state fact/跨项目 B 拉得到/休眠>7d 拉得到/Media 删除级联/FK 竞态跳过/退役 grep 锚清零。

### §3.2 C3a：MediaBinding 帧级投影（真值成立，不动消费面）

1. **帧级快照（v2 错误的根修）**：apply-post 临界区逐帧捕获——本帧 touched nodeIds（**修剪：仅 data 子树/媒体键/数组事件标 touched**，position/edge 不标）→ 对每 touched node 调 `collectMediaRefsForNode(nodeId, node)`（**新单源函数**：按节点 type+DOC_SCHEMA_V4+ARRAY_DOMAINS 计算槽位终态集，targetField/targetItemId 天然可得；`collectMediaRefs(doc)` 改为其逐节点聚合）→ 存 `AppliedEntry.bindingDelta`（Map<nodeId,槽位集>）；批 flush 按 walSeq 合并（后帧覆盖前帧）传 inTx；**inTx 只持久化快照，绝不读活 doc**——binding 严格=batch prefix，`mediaBindingSeq=newPgSeq` 语义成立。
2. **SAVEPOINT 失败隔离**（投影不挡帧）：inTx 内 `SAVEPOINT media_binding_projection`→投影→`RELEASE`；异常→`ROLLBACK TO SAVEPOINT`+同事务置 `bindingsDirty=true`+**水位不推进**+`media_binding_projection_failed_total{reason}` 计数——帧照常提交。数据性无效（media 不存在/跨队/软删/超长值）=预检跳过+`media_binding_skip_total{reason}`，非异常。
3. **去 FK+单写者**：`MediaBinding.mediaId` FK 移除（终态 init 落地；过渡期先靠 SAVEPOINT 兜 FK 竞态）+周期孤儿清扫（`DELETE WHERE NOT EXISTS Media`——reconcile 漂移检测的一部分）；**命令面读写两改**：`bindInTx` 全调用方退役——BindMedia 源配对改 `pairArtifact` 唯一腿（NodeArtifact，现状已备选）+doc 源节点兜底；**CloneBinding 改为 doc 命令**（服务端代发目标节点 data 引用帧→投影器落 binding）+copy/paste e2e；replaceMedia 只写 NodeArtifact/Projection；**静态门禁**：`mediaBinding.upsert/create/delete` 仅允许出现于 projector/rebuild 文件（其他文件出现即红）。
4. **水位+dirty**：`CanvasDoc.mediaBindingSeq`（appendBatch 同事务推进）+`bindingsDirty Boolean`；**恢复四路**——①boot：`replayed>0 ∨ mediaBindingSeq<pgSeq`→置 dirty+启动受控 rebuild；②replayAll：接帧级投影同链重派生（或 dirty+rebuild）；③recovery-import：**前置**置 dirty（与 apply 同事务窗，修崩溃窗）→消费前锁内 rebuild；④vacuum/换代：`vacuumReplace` 同事务置 dirty。rebuild=锁外读 pgSeq 快照+分页写+短事务 CAS（清 dirty+推水位）；`BindingReconcileService` 降只读漂移检测（`media_binding_drift_total` 告警+触发受控 rebuild），发现面扩 CanvasDoc 全表轮转。
5. **索引单源化**：`ProjectDocIndex.mediaRefsByNode` 改由同一 `collectMediaRefsForNode` 维护（修数组 splice 漏洞——不再留两套词表）；slot 键含 role。
6. 指标：`media_binding_write_total{source}`/`skip_total{reason}`/`drift_total`/`projection_failed_total`/`watermark_lag`（低基数）+`append_effects_per_frame` 直方图。
7. 红测全族：**数组-only 帧（append/remove/replace/reorder）→binding==独立 oracle**；node delete+re-add/undo；**帧 1 加 M/帧 2 删 M/只 flush 帧 1/kill -9 重启→PG doc 有 M∧binding 有 M**（v2 形态必红的负控）；投影注入异常→帧仍提交+dirty+水位不进；并发删 media FK 竞态→savepoint 兜底不挡帧；BindMedia/CloneBinding 不再触 binding 读写面+e2e；reconcile 并发交错 100 次 binding==doc 最新；kill -9 全链/replayAll/import 崩溃窗/vacuum 换代 dirty。**oracle=独立实现**（测试专用递归扫描或 property-based，禁共用生产函数防同模假绿）；对拍契约=`binding@lastWalSeq == oracle(doc@lastWalSeq)`。
8. 收口：T33 bench-smoke 档（append p95/写放大/投影成本不回归）。

### §3.3 C1：终态 rebaseline（时间语义+最终 schema 一次切）

1. **前置**：C2/C3a 代码已兼容终态 schema。
2. **新 init=最终 schema**：全列 timestamptz；MediaFact 终态形；**无 MediaFactOutbox/MediaFactState**；MediaBinding 去 FK 形+无 lastWalSeq（无消费者不加）；CanvasDoc.{mediaBindingSeq,bindingsDirty}；**`set_updated_at()` 触发器挂全部 updatedAt 表**（BEFORE INSERT OR UPDATE——appendBatch/raw UPDATE 不再手补，类级根修；触发器与 Prisma @updatedAt 共存：DB 钟覆盖）；全部 raw 对象（CHECK/partial unique/**ledger_guard()+两资金触发器**/enum 域——逐字保留）。
3. **四层对象 delta 门**（主门；schema-dump 基建降辅助）：reset 前 `pg_dump --schema-only` 旧库留档（gate-evidence/schema-before.sql+manifest）vs 新 init 重放同 dump——①对象集合（table/column/constraint/index/sequence/enum/**function/trigger/policy/grant/comment**）全覆盖+新增对象白名单；②列类型 delta **恰好 165 个 timestamp(3)→timestamptz(3)**（白名单外零变化）；③默认值/种子 delta（now() 形态+catalog 种子等价）；④函数/触发器 body 逐字对拍。
4. **时间代码**：补偿谓词全仓拆（含 C2 过渡形态）+`::timestamp`→`::timestamptz`/参数绑定+脚本三件 bump SQL+deploy-guard 断言翻转（裸 now()+不含 AT TIME ZONE+新增 epochStartedAt=timestamptz schema 断言）+测试锚全量翻转。
5. **三门禁+连接纪律**：schema 门（DateTime 必带 Timestamptz）/raw SQL 门（timestamp(3)/::timestamp 参数 cast/补偿式 AT TIME ZONE/无显式时区的 ::date·date_trunc·extract——报表层显式时区+注释豁免）/双时区集成测试（**连接级注入**：独立 client `options=-c timezone=...` 或 $transaction 内 SET LOCAL；用例集扩全部 claim 面：lease/probe/materialize/projection-outbox/object-manifest/erasure/runtime-retention/execution-retention/heartbeat+epochStartedAt 用例改 DB 钟比较）；CI +8 矩阵腿（TZ+PGTZ）；生产连接 `timezone=UTC` 显式参数。
6. canary 容量评估收口（updatedAt 修复后 active 宇宙变大→采样量复核）；runbook：回滚=旧备份+旧代码树（非 down migration）+旧 dump/tag 留档+baseline ADR+本地状态文件（deploy-guard-state/reset-collab-state）重置清单。
7. reset 序：dev=prisma migrate reset；服务器=reset-collab §16（部署窗=用户指令）。

### §3.4 C3b：PG oracle 证人 + binding 候选化（doc 扫描不退役）

1. **PG-based oracle worker**（新组件）：从 `CanvasDocSnapshot+CanvasDocUpdate` 在 `pgSeq` 重建 doc→`collectMediaRefs`→产出 `(projectId,pgSeq,refsHash)`——same-seq、无 residency/lease 依赖、分页无 500 上限。**doc 扫描语义永久保留为删除独立证人**（金句裁定：派生索引不能是「不存在」的唯一证人）。
2. **binding=快速候选筛选**（便宜预判+Y2 typed-ref 底座）；erasure/media-gc 判定改：binding 候选∩oracle 裁决。
3. **全局 coverage epoch**：删除前要求 team 内全部 CanvasDoc 项目的 oracle 结果到齐（同 epoch）∧`mediaBindingSeq≥pgSeq`∧非 dirty——任一缺/落后→整体 bail-out 保留（fail-closed，不按项目抽样）。
4. **引用图单源**：抽 `isMediaReferenced(mediaId)`（erasure 八要素单源：binding+NodeArtifact+VideoWork+LightingTask+VideoTrim+VideoProject.data+ObjectManifest+oracle）——**GC 引用图补 Lighting/Trim/Manifest 缺口**；每个 referrer 单独保护红测。
5. **删除纵深**：软删 7d grace 维持+条件删除同事务 re-check（`DELETE..WHERE NOT EXISTS isMediaReferenced`）+复核窗保留（拆窗=单独立项维持）+对象删除失败重试容忍（404 行清理既有语义）。
6. **抽样长期对拍+回滚开关**：`media_ref_shadow_mismatch_total{consumer=media-gc|erasure,dir=missing-in-binding|extra-in-binding}`（missing=阻断保留，extra=仅告警）；运行时开关（binding 候选可一键降级纯 oracle）；mismatch 修复 runbook。
7. **退役后移**：loopback 端点/collectProjectMediaRefs/httpMediaRefsCollector/DTO/auth.guard 例外/路由/常量/测试三件=**单独立项**（前置：PG oracle 跑满一个保留期+coverage 零缺口证据）。
8. 红测：注入 binding 少一行/多一行→保留+告警不删；某项目水位落后/dirty→全局 bail-out；「GC 扫描后新增 binding」交错→保留；每个 referrer 单独保护；删除窗内新增引用→re-check 保留；对象删除失败→行保留下轮重试；团队大项目集/大 doc/超时→保守保留不部分扫描。

### §3.5 批级出口门

verify FULL+四卡双评审 ✅+四层对象 delta 门/三门禁/单写者门禁负控红证+bench-smoke 不回归（C3a 收口）+PG oracle coverage 证据+抽样影子首轮零 mismatch（或 mismatch 全部处置留痕）+呈报包（gate-evidence/foundation-exit.txt——诚实登记：loopback 未退役/投影异常挡帧已由 savepoint 隔离但投影 bug 仍致 binding 降级/Node 日历族/clock_timestamp）+部署窗（用户指令，全环境 reset §16）。

## §4 机器门与登记影响面（批级）

- 迁移：C2/C3a additive→C1 单一新 init（additive BASELINE 抬新 init+immutability 重建+migrate-diff --write+本地状态文件重置）→C3b 如需 oracle 水位表 additive。零 DROP 迁移零豁免。
- 新门禁入 verify 链：schema timestamptz 门/raw SQL 门（含 ::timestamp/日历函数）/双时区测试/四层对象 delta（C1 一次性）/单写者静态门（C3a）——负控自测随脚本。
- 指标纪律承前（.metrics.ts+--write-metric-names 同 commit+涉指标 commit 跑 verify FULL+低基数）。
- module-size：MediaBindingProjector/PG oracle worker 新文件入锚；actor 行数净增面补登。
- runbook：§13（oracle+coverage+抽样语义）、§14（media 段分诊）、§16（bump 注释+回滚=旧备份+状态文件清单）随卡。

## §5 确认点（批流程门）

1. spec v3 确认门（本文件——**含两处 v2 裁定修正：批序重排+C3b oracle 永久证人**）→ 2. plan 确认门 → 3. C2→C3a→C1→C3b 每卡双评审 → 4. 批末出口门（§3.5）→ 5. 部署窗（用户显式指令）。

## §6 登记/偏离表（v3 全量）

| 项 | 内容 | 归属 |
|---|---|---|
| 销案 | T31 genesis 登记（承 v2）；v2「applied 对两者均不可见」等价句（v3 撤回改写）；v2「inTx 读内存 doc 终态」（v3 改帧级快照）；v2「客户端零改动」（v3 服务端归一）；v2 C3b「影子期满退役 doc 扫描」（v3 改永久证人） | v3 修订记录 |
| 登记 | loopback 退役单独立项（前置=PG oracle 跑满保留期+coverage 证据） | C3b 后 |
| 登记 | 复核窗拆除单独立项（维持 v2 裁定） | C3b 后 |
| 登记 | 媒体所有权语义（Media.projectId=来源 provenance 非所有权——team=ACL 边界；erasure detach 语义钉死） | Y2 |
| 登记 | doc schema 演进（docSchemaVersion+版本化 normalizer+lazy migration——加字段=跨版本 doc 兼容非加列） | Y2/后续批 |
| 登记 | 长期领域事件日志（WAL compact 后不可回放——审计/webhook 需求驱动） | 需求驱动 |
| 登记 | 「真 Yjs 核心升级」候选批（读模型 watermark 客户端契约/恢复演练覆盖 derived 重建/多实例前置） | 后续路线图 |
| 登记 | clock_timestamp（claim 谓词事务时间 5s 推迟=安全方向）/Node 日历族（维持——CI TZ 显式化已并入 C1 测试矩阵） | 后续 |
| 登记 | 30d 硬删保留+MediaDeletion tombstone（生产桶 MinIO 版本化已在位部分覆盖） | 后续 |
| 偏离登记 | DerivedIndexContract 升格：七条语义（source/watermark/total-write/read-check/rebuild/verify/repair）以 MediaBindingProjector 接口+测试承载（不建泛型框架——Y2 第二投影出现再抽象） | C3a |
| 不采纳 | `MediaBinding.lastWalSeq` 行级列（无消费者——R3 4.8 自证）；旧 lag gauge 保留过渡期（旧表即删无意义）；R2 P0-4 方案 B（C1+C2 合并卡——R2 方案 A 批序更优） | 裁定记录 |

**v1→v2→v3 裁定史**：v1（A/A/路线1，b849381b）→两外审重裁→v2（rebaseline/MediaFact/C3a+C3b 影子，bafd26de）→三外审实证（核心：inTx 读活 doc 时点错+水位等价句反了+CloneBinding 无写者+客户端丢 natural+对象门会丢资金触发器+C2 DROP 撞门）→v3（帧级快照/PG oracle 永久证人/批序重排/四层 delta 门/updatedAt 触发器/命令面读写两改/去 FK+SAVEPOINT）。三轮评审采纳/降级/反对逐项记录于 2026-11-11 对话。
