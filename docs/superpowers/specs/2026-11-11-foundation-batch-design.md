<!-- doc-status: active | created: 2026-11-11 | confirmed: 2026-11-12（用户确认 v5——五轮外审收敛终态；下一步=writing-plans） | v5（2026-11-12 第五轮三外审裁定并入）：共识 P0 全采纳——①DELETING 投影改「照写不跳过」（引用命中→删除中止回 ACTIVE——doc 帧写 DELETING 媒体时 recheck 可见，封盲点）+deletionState 列进 C3a additive（解列序冲突）；②oracle coverage 可证明化：CanvasReferenceOracleScan header（VERIFYING|COMPLETE|FAILED，零引用 refCount=0 也写行，coverage 只认 COMPLETE∧verifiedSeq===决策 pgSeq）+decision snapshot（扫描后 CAS）；③水位=连续投影前缀不变量（dirty 期间任何增量成功不得推进；rebuild 开始即置 dirty、CAS 成功才清+推水位；genesis 同事务置 dirty）；④对象门三向 allowlist（removed/added/changed 由 pg_dump 生成不手写）+期望转换由列级 census 派生（不 hardcode）；⑤触发器语义=UPDATE 始终 now+INSERT 仅 NULL 时（保 restore/backfill/测试历史值）；⑥touched 修剪改保守（root add/delete/update+node 级 data 键变更全标——现有 actor root update 零分支实证）。第五轮 P1 采纳：CloneBinding 直接删除命令（替代 v4「doc 命令」——避免未声明迷你执行器）；ProjectDocIndex 经 bindingDelta 旁路更新；上传 state fact（端点 Media.status 合成+confirmInTx 同事务写）；ProjectionBackfill runner；oracle 候选驱动+增量+Yjs 全类型覆盖；isMediaReferenced 带 scope；MediaBinding.projectId FK Cascade；单写者门禁白名单+raw SQL 扫描。**我方替代裁定**：C2 naive 过渡垫片→Date 参数绑定方案（参数化 JS Date 在 naive/timestamptz 两期均正确——零过渡代码不动批序，替代报告 3 的「开发序终态」案）。Node 日历维持登记（五轮一致）。v4=1035c6c6 留史。 -->
# 地基修复批 v5（时间语义终态 baseline + MediaFact 当前态 + MediaBinding 帧级投影 + PG oracle 证人）设计 spec

日期：2026-11-11（v1=b849381b；v2=bafd26de；v3=7ad592da；v4=1035c6c6；v5=第五轮三外审裁定并入版）

定位：foundation correctness batch（正确性地基批——投影平面第一 installment，Y2 typed-ref 底座；不宣称架构升级，不改变单实例/无 HA/无 S3 边界）。**四卡序：C2（MediaFact 代码）→ C3a（binding 帧级投影）→ C1（终态 rebaseline）→ C3b（PG oracle 证人+候选化）**。核心原则：**派生索引不能是「不存在」的唯一证人；删除保护=引用并集（任一证人命中→保留）；证人必须可证明完整（coverage）、一致（同 seq）、当前（决策时点）**。

## §0 已裁定（不再议——v5 累计终态）

- **批序**：`C2 → C3a → C1（终态 rebaseline）→ C3b`，每卡 additive 独立绿、批末一次 reset 终态部署、零 DROP 迁移零豁免。**C2/C3a 开发期时间写法=Date 参数绑定**（参数化 JS Date 对 naive/timestamptz 列均按 UTC 墙/instant 正确写入——零过渡代码；v4 的 `AT TIME ZONE` 过渡句销案）。
- **C3a 帧级快照**（apply-post 逐帧捕获，inTx 绝不读活 doc）+SAVEPOINT 失败隔离+去 MediaBinding.mediaId FK+**MediaBinding.projectId FK Cascade**（项目删除非帧写不挡帧）+命令面读写两改（**CloneBinding 命令删除**——copy/paste=客户端 doc 帧自足，binding 投影收敛）+静态单写者门禁（Prisma delegate+raw SQL 文本扫描；白名单=projector/rebuild/erasure-purge/orphan-cleanup/tests）。
- **水位不变量**：`mediaBindingSeq`=**连续投影前缀**——dirty 期间任何增量成功不得推进；仅全量 rebuild（锁外读 pgSeq 快照+分页写+短事务 CAS）清 dirty 并推水位；rebuild 开始即置 dirty；genesis 同事务置 dirty（种子 doc 可能含引用——修 0==0 假覆盖）；恢复四路（boot/replay/import/vacuum）dirty+受控 rebuild；ProjectionBackfill runner（首次启动分页/限速/可恢复，未完成期 GC/erasure bail-out）。
- **C3b**：PG oracle 永久证人+通用 UUID 候选驱动扫描+`CanvasReferenceOracleScan` coverage header+decision snapshot（每项目 `verifiedSeq === 决策时 pgSeq`，扫描后 CAS）；**DELETING 语义=「引用即中止删除」**（投影照写 binding 不跳过——删除事务 recheck 可见→DELETING→ACTIVE 回退+审计；命令面拒新绑定维持）；`isMediaReferenced(mediaId,{teamId,excludeProjectId})` scope 化；复核窗保留（拆窗单独立项）。
- **C1**：终态 init（全列 timestamptz+触发器+全部 raw 对象含 ledger_guard）；四层对象 delta 门**三向 allowlist**（removed/added/changed 由 pg_dump 生成不手写；期望类型转换由列级 census 派生不 hardcode）；触发器=UPDATE 始终 now+INSERT 仅 NULL；三门禁+双时区连接级注入+CI +8 矩阵；updatedAt 写入语义修复随触发器类级达成。
- 流程纪律承前（TDD 红先行/strict/subagent-driven 双评审/迁移串行/禁 amend）。

## §1 事实基线（v5 增补锚点；v1-v4 锚点承前）

1. **actor root 分支只处理 add/delete**（collab-project-actor.service.ts:207-237 实证——`nodes.set(existingId, newMap)` 的 root update 无分支零处理）——touched 修剪若「仅 data 子树/媒体键/数组事件」会继承此缺口（第五轮 P0）。
2. **上传 confirm 不写 state fact**（media-registration.service.ts:148-160——confirmInTx 只置 Media completed/probeState；state fact 仅 registerInTx/completeRegisteredInTx 生成路径写）→ 上传媒体纯 natural → 客户端 unionFact「纯 natural 无 state」丢弃（mediaFacts.ts:100-102 实证）——服务端归一变不出不存在的 state（第五轮 P1）。
3. appendBatch inTx 回调在水位 UPDATE **之前**执行（canvas-doc-update.repository.ts:275-293）——失败批后下一批无条件 set 水位会跳过 gap（第五轮 P0）。
4. 现有 retention 测试用显式历史 updatedAt 构造窗外行（deadline-reaper/intent-reconcile-r3 等）——`BEFORE INSERT` 无条件触发器会破坏测试语义（第五轮 P0）。
5. v4「恰好 165 个转换」算术错：C2 删 MediaFactOutbox 4 个 DateTime → 存活转换 161+新增 1（MediaFact.updatedAt）——硬编码必红；且终态 init 故意删除对象（outbox 表/enum/binding mediaId FK）无 removal allowlist 会判红（第五轮 P0）。
6. oracle「×team 全媒体 UUID 集」表述会引导全量交叉实现——GC/erasure 本有候选集（≤50/批），候选驱动（doc 字符串叶∈候选集）成本从 O(team 媒体×doc) 降为 O(doc 字符串)（第五轮 P1）。

## §2 卡序（终态）

| 序 | 卡 | schema 动作 | 出口 |
|---|---|---|---|
| 1 | C2 MediaFact 当前态 | additive 建表 | 写点/端点切换+state fact 合成+客户端契约红测+旧表停写 |
| 2 | C3a binding 帧级投影 | additive：CanvasDoc.{mediaBindingSeq,bindingsDirty}+**Media.deletionState** | 帧级快照/savepoint/水位不变量/命令面两改/恢复四路/backfill 红测+bench-smoke |
| 3 | C1 终态 rebaseline | 单一新 init=最终 schema | 三向 allowlist 对象门+三门禁+双时区+verify FULL |
| 4 | C3b oracle 证人 | additive：CanvasReferenceOracle(当前态)+OracleScan header | coverage 可证明+decision snapshot+DELETING 中止语义+并集删除 |

## §3 卡设计

### §3.1 C2：MediaFact 当前态表

1. **建表**（additive）：`MediaFact{mediaId,factType CHECK IN ('state','natural'),factVersion BigInt,payload Json,updatedAt,media FK Cascade}`+`@@id([mediaId,factType])`+`Media.facts` 反向关系；payload zod/共享类型校验（state: status∈processing|completed|failed；natural: 宽高/旋转/source）+端点读侧再校验+坏行计数跳过。
2. **写点改道**（5 处 createMany→单行 upsert）：`INSERT ... ON CONFLICT DO UPDATE SET ..., "updatedAt"=$nowParam WHERE EXCLUDED."factVersion" > "MediaFact"."factVersion"`——**updatedAt=Date 参数绑定**（两期列类型均正确，零过渡）；版本单调；**去掉两处 `if (params.projectId)`**；probe/materialize 路径 `INSERT..SELECT..WHERE EXISTS(Media)` 防 FK 竞态（跳过+计数）；finalize 路径保留 FK 严格性。**confirmInTx 同事务补写 completed state fact**（上传媒体不再纯 natural）。
3. **端点改道+双保险**：按 mediaIds+team ACL（`deletedAt:null`）直查当前态行；每 media `max(factVersion)` 合成版本+**state 在前 natural 在后**；**无 state fact 的 media 从 `Media.status` 合成 state 行**（synthetic，版本=`Media.factVersion`——覆盖历史/边缘媒体）；不 mark published。契约测试：`Media.factVersion` 全局单调（两前提钉死：全局版本+每 media 必有 state〔含合成〕）。
4. **旧面退役**（表暂留 C1 删）：写点/端点读/cleanProjectionAndOutbox outbox 段+dead-letter/r3 seed/`media_fact_outbox_lag` gauge/soak 两处/scope-column.registry 条目；**退役 census 补全**：dev-reset-canvas.mjs/project-erasure.purge c4c1 表列表/provider-convergence.e2e/materialize·artifact-commit·media-probe·media-facts·media-fact-outbox 测试（逐处标改/删/放行）；`reconcileDaily` 保留（仍清 ArtifactProjection/ReconcileAction）。
5. **观测**：`media_fact_version_lag{factType}`（=max(0, Media.factVersion−MediaFact.factVersion)——version lag 是 staleness，age 仅 dashboard）+`media_fact_read_total{result}`+事实 canary（**synthetic 专用 media/team**，不污染生产媒体）。**probe 失败矩阵**：`Media.status/probeState` 全终态→state fact 映射逐项红测（probe 失败写 failed state fact 或端点合成，不留状态机空洞）。
6. 红测：版本单调/合成版本两前提/natural v5+state v6 双顺序合并双全/纯 natural（端点合成后）不丢/无 projectId 媒体有 state/跨项目 B 拉得到/休眠>7d/Media 删除级联/FK 竞态跳过/退役 grep 锚清零（含 census 补全清单）。

### §3.2 C3a：MediaBinding 帧级投影（真值成立，不动消费面）

1. **帧级快照**：apply-post 临界区逐帧捕获 touched nodeIds——**修剪规则保守**（第五轮 P0 修正）：root `nodes` add/delete/**update**、node 级 `data` 键变更、任何 path[0]=nodeId 的事件全标 touched；仅 `position`/edges 类字段跳过。对每 touched node 调 `collectMediaRefsForNode`（**不按 type/schema 收窄**——全 `MEDIA_REF_TARGET_FIELDS` 词表扫描，type 仅用于 array 形态解析；未知 type 照扫）→ 存 `AppliedEntry.bindingDelta`（Map<nodeId,槽位集>；字节计入 applied 队列预算+`binding_delta_bytes` 直方图）；批 flush 按 walSeq 合并（后帧覆盖）；inTx 只持久化快照绝不读活 doc。
2. **SAVEPOINT 失败隔离**：`SAVEPOINT media_binding_projection`→投影→`RELEASE`；异常→`ROLLBACK TO`+同事务置 dirty+**水位不推进**+`projection_failed_total{reason}`——帧照常提交。数据性无效（media 不存在/跨队/软删/超长值）=跳过+`skip_total{reason}`；**deletionState=DELETING 的引用照写 binding 不跳过**（第五轮 P0-1 修正：删除事务 recheck 必须能看见新引用→删除中止回 ACTIVE——「引用即取消删除」语义，非静默跳过）。
3. **水位不变量**（第五轮 P0-3 修正）：`mediaBindingSeq`=连续投影前缀——**dirty=true 时任何增量成功不得推进**（appendBatch 的 inTx 回调返回 bindingCovered，repository 据此决定推进；连续 CAS 形态）；仅全量 rebuild 清 dirty+CAS 到 pgSeq；**rebuild 开始即置 dirty**（CAS 失败保持 dirty——修锁外分页写覆盖竞态）；**genesis 同事务置 dirty**（种子 doc 含引用时修 0==0 假覆盖）；`media_binding_gap_seq` 观测。恢复四路（boot：`replayed>0 ∨ mediaBindingSeq<pgSeq ∨ dirty`；replayAll 同链重派生；import 前置 dirty；vacuum 换代置 dirty）+**ProjectionBackfill runner**（首次启动：枚举 CanvasDoc 分页/限速/可恢复/`backfillEpoch`；未完成期 GC/erasure bail-out；不阻塞服务启动）。
4. **单写者+命令面两改**：binding 权威写=appendBatch inTx 投影+锁内 rebuild；`bindInTx` 全调用方退役——BindMedia 源配对改 pairArtifact 唯一腿+doc 源节点兜底（读面语义 plan 定）；**CloneBinding 命令删除**（第五轮 P1：copy/paste=客户端 doc 帧自足，投影收敛——plan 内核实调用方后删命令+copy/paste e2e；若产品确需服务端克隆→Y2 doc 命令执行器立项，不在本批藏迷你执行器）；replaceMedia 只写 NodeArtifact/Projection；静态单写者门禁（delegate+raw SQL 文本扫描；白名单=projector/rebuild/erasure-purge/orphan-cleanup/tests，白名单变更需评审）。
5. **索引单源化**：`ProjectDocIndex.mediaRefsByNode` 由 **bindingDelta 旁路**同源更新（不经 FrameEffect——冻结契约不动；touched node 条目重建——数组-only 帧后正确）；slot 键含 role。
6. **schema（additive）**：CanvasDoc.{mediaBindingSeq,bindingsDirty}+**Media.deletionState（ACTIVE|DELETING——列在本卡落，解 C1 前引用冲突）**。
7. 指标：write_total{source}/skip_total{reason}/drift_total/projection_failed_total/gap_seq/watermark_lag/`binding_delta_bytes` 直方图/backfill_remaining。
8. 红测全族：数组-only 帧（append/remove/replace/reorder）/`nodes.set(existingId,newMapWithMedia)` root update/`set('data',newMap)` 整 map 替换/node delete+re-add/undo→binding==独立 oracle（`binding@lastWalSeq == oracle(doc@lastWalSeq)`）；**帧 1 加 M/帧 2 删 M/只 flush 帧 1/kill -9→PG doc 有 M∧binding 有 M**；**批 N 失败批 N+1 成功→水位停在 N−1 且 dirty（不跳 gap）**；**genesis 种子含引用→binding 存在或 dirty（coverage 不假绿）**；投影注入异常→帧仍提交+dirty+水位不进；FK 竞态→savepoint 兜底；**DELETING 媒体 doc 帧引用→binding 照写**（C3b recheck 可见）；rebuild×append 交错 100 次（CAS 失败 dirty 保持）；命令面零 binding 读写+copy/paste e2e；恢复四路 dirty→rebuild。oracle=独立实现（测试专用递归/property-based）。
9. 收口：T33 bench-smoke 档（append p95/写放大/投影成本/delta 预算不回归）。

### §3.3 C1：终态 rebaseline（时间语义+最终 schema 一次切）

1. **前置**：C2/C3a 代码已兼容终态 schema。
2. **新 init=最终 schema**：全列 timestamptz；MediaFact 终态形；无 MediaFactOutbox/MediaFactState；MediaBinding 去 mediaId FK+**加 projectId FK Cascade**+无 lastWalSeq；CanvasDoc.{mediaBindingSeq,bindingsDirty}；Media.deletionState；`set_updated_at()` 触发器——**UPDATE 始终 `NEW.updatedAt=now()`；INSERT 仅 `WHEN NEW.updatedAt IS NULL`**（第五轮 P0-6 修正：保 restore/backfill/测试显式历史值）；restore 运维通道（`SET LOCAL app.skip_updated_at`）入 runbook；trigger coverage gate（每个 updatedAt 表必挂，新增表漏挂即红）；全部 raw 对象（CHECK/partial unique/ledger_guard()+两资金触发器/enum 域逐字）。
3. **四层对象 delta 门（三向 allowlist）**：reset 前旧库 pg_dump 留档 vs 新 init 重放——①对象集合：old-only 必须命中 **removed** 白名单（MediaFactOutbox 表/MediaFactState enum/MediaBinding.mediaId FK/outbox 索引列）、new-only 必须命中 **added**（MediaFact/CanvasDoc 两列/Media.deletionState/set_updated_at 函数+触发器/projectId FK）、其余全覆盖；②列类型 delta：**期望转换集由列级 census 派生**（存活 naive 列恰好全部转换——不 hardcode 数目；outbox 删除列单列；新增 tsz 列单列）；③默认值/种子 delta（now() 形态+catalog 等价）；④函数/触发器 body 逐字。**allowlist 由 pg_dump 生成不手写**；对象集对比过滤 ownership/comments/SET 噪声。
4. **时间代码**：补偿谓词全仓拆+`::timestamp`→`::timestamptz`/参数绑定+脚本三件+deploy-guard 断言翻转（**含测试改名**——「T31-P1 红①」名随语义更新为裸 now+timestamptz 断言）+测试锚全量翻转。
5. **三门禁+连接纪律**：schema 门（DateTime 必带 Timestamptz）/raw SQL 门（timestamp(3)/::timestamp 参数 cast/补偿式 AT TIME ZONE/无显式时区日历函数——**extract(epoch) 瞬时安全豁免、date-part 类禁**）/双时区集成测试（连接级注入；用例集=全部 claim 面〔lease/probe/materialize/projection-outbox/object-manifest/erasure/runtime-retention/execution-retention/heartbeat〕+@default/@updatedAt/round-trip；epochStartedAt 用例=DB 钟比较）；CI +8 矩阵；生产连接 timezone=UTC。
6. canary 容量评估收口；runbook：回滚=旧备份+旧代码树+旧 dump/tag 留档+baseline ADR+本地状态文件重置清单。
7. reset 序：dev=prisma migrate reset；服务器=reset-collab §16（部署窗=用户指令）。

### §3.4 C3b：PG oracle 证人 + binding 候选化（doc 扫描不退役）

1. **PG-based oracle worker**：从 `CanvasDocSnapshot+CanvasDocUpdate` 在 `pgSeq` 重建 doc——same-seq、无 residency/lease 依赖、分页。删除独立证人（永久）。
2. **双表模型**（第五轮 P0-2/4 修正）：
   - `CanvasReferenceOracle`（**当前态**）：`@@id([projectId,mediaId])`+`verifiedSeq` 列+`@@index([mediaId])`——按 mediaId 直查证人；旧行随重扫原子替换（不累积历史行）。
   - `CanvasReferenceOracleScan`（**coverage header**）：`(projectId,historyEpoch,verifiedSeq,status:VERIFYING|COMPLETE|FAILED,refCount,scannedAt,error?)`——**零引用项目也写 COMPLETE,refCount=0 行**；coverage 只认 COMPLETE；扫描单 RR 事务（pgSeq+snapshot+updates+verifiedSeq 同快照）。
3. **通用 UUID 候选驱动扫描**：重建 doc 后遍历**全部 Yjs 容器类型**（Y.Map/Y.Array/Y.Text/Y.XmlElement/Y.XmlText——全类型覆盖红测）的 string 叶子值，判断 `∈候选 mediaId 集`（GC/erasure 自带候选 ≤50/批——O(doc 字符串) 非 O(team×doc)）；允许误保留绝不误删；**增量**：项目 pgSeq 未变→复用 header 不重扫；单 doc 预算/超时→bail-out 保留不部分扫描。
4. **decision snapshot**（第五轮 P0-4/移动靶修正）：删除决策序=①枚举 team 内全部 CanvasDoc 项目（DELETING/erased 项目用最后 COMPLETE 行或明确排除）读各自 `pgSeq=S_i`→②逐项目 oracle 扫描+**扫描后 CAS 校验 pgSeq 仍=S_i**（漂移重试，再漂移 bail-out）→③决策时要求每项目 `header.verifiedSeq===S_i ∧ status=COMPLETE`∧binding `mediaBindingSeq===pgSeq`∧非 dirty→④删除事务内候选 media 最终 `isMediaReferenced` re-check→⑤任一不满足整体 bail-out 保留。
5. **DELETING 状态机**（第五轮 P0-1 修正后终态）：GC/erasure `UPDATE...WHERE deletionState='ACTIVE' RETURNING` CAS 抢占进 DELETING；**DELETING 期语义=命令面拒新绑定+投影照写 binding（引用可见）+oracle 照常计入**；删除事务 recheck 命中任一证人→**删除中止+DELETING→ACTIVE 回退**+`media_deletion_conflict_total{reason}`+复核窗重置；审计列（deletionRequestedAt/RunId/Reason）；用户恢复（deletedAt=null）→回 ACTIVE；DELETING 期 content 仍可读、facts 端点过滤 DELETING；删除失败重试/人工复位语义入 runbook。
6. **删除保护=引用并集**：`isMediaReferenced(mediaId,{teamId,excludeProjectId?,includeDeletedProjects?})`（**scope 化**——erasure 排除被擦项目，被擦项目自身引用不算保护）∪ 成员=Binding+Oracle+NodeArtifact+VideoWork+LightingTask+VideoTrim+VideoProject.data+ObjectManifest+**ArtifactProjection.mediaId/GenerationIntent.resultRef 等 referrer registry**（同 scope-column.registry 形态——新增 mediaId 列必须登记否则 census 红，第五轮 P1 引用图补全）；任一命中→保留。
7. **删除纵深**：软删 7d grace+DELETING 状态机+同事务 re-check+复核窗保留（拆窗单独立项）+对象删除失败重试容忍；媒体行 `FOR UPDATE`+DB 行删先于对象删。
8. **抽样长期对拍+回滚开关**：`media_ref_shadow_mismatch_total{consumer,dir}`（missing=阻断保留；**extra=告警+触发受控 rebuild 清理**——修 stale binding 永久过度保留）；`media_binding_stale_total`；运行时开关（binding 候选一键降级纯 oracle）。
9. **退役后移**：loopback/auth.guard/DTO/常量/测试三件=单独立项（前置：PG oracle 跑满保留期+coverage 零缺口）。
10. 红测：零引用项目 coverage 通过；`verifiedSeq=100,pgSeq=110` bail-out；扫描中途崩溃不得 COMPLETE；DELETING/erased 项目不永久阻塞；**DELETING 媒体+doc 帧新引用（apply 未 append）→删除保留/中止**；未知字段含 media UUID→oracle 命中保留；每个 referrer 单独保护（binding-only/oracle-only/structured-only 三组）；双 GC worker 抢占；DELETING→ACTIVE 回退+审计；大团队/大 doc/超时→保守保留；oracle 全类型覆盖（五种容器各一用例）；shadow extra→rebuild 清理。

### §3.5 批级出口门

verify FULL+四卡双评审 ✅+三向 allowlist 对象门/三门禁/单写者门禁负控红证+bench-smoke 不回归+PG oracle coverage 证据（decision snapshot 全链）+抽样影子首轮零 mismatch（或全处置留痕）+指标面（durable-ack 延迟/恢复耗时/投影 lag+gap_seq/oracle coverage_ratio+scan_age/拒绝更新/GC fail-closed/deletion_conflict/backfill_remaining——低基数）+**RPO/RTO 四面成文**（C1 reset RPO=0；C2 facts 可重建 RPO=0；C3a binding 同事务 RPO=0；C3 media 删除=PITR 窗〔restore 后 derived 重建+verify 入恢复演练〕）+呈报包+部署窗（用户指令，全环境 reset §16）。

## §4 机器门与登记影响面（批级）

- 迁移：C2/C3a additive→C1 单一新 init（additive BASELINE 抬新 init+immutability 重建+migrate-diff --write+本地状态文件重置）→C3b oracle 双表 additive。零 DROP 零豁免。
- 新门禁入 verify 链：schema timestamptz 门/raw SQL 门（含 ::timestamp/日历函数分类）/双时区测试/三向 allowlist 对象门（C1 一次性）/单写者静态门（delegate+raw SQL）/trigger coverage gate——负控自测随脚本。
- 指标纪律承前（.metrics.ts+--write-metric-names 同 commit+涉指标 commit verify FULL+低基数）。
- module-size：MediaBindingProjector/PG oracle worker/BackfillRunner 新文件入锚。
- runbook：§13（oracle/coverage/decision snapshot/DELETING 状态机+复位）、§14（media 段分诊）、§16（bump 注释+回滚=旧备份+状态文件清单+skip_updated_at 运维通道）随卡。

## §5 确认点（批流程门）

1. spec v5 确认门（本文件）→ 2. plan 确认门 → 3. C2→C3a→C1→C3b 每卡双评审 → 4. 批末出口门（§3.5）→ 5. 部署窗（用户显式指令）。

## §6 登记/偏离表（v5 全量）

| 项 | 内容 | 归属 |
|---|---|---|
| 销案（v5） | v4「AT TIME ZONE naive 过渡」（Date 参数绑定替代）；v4「CloneBinding 改 doc 命令」（直接删除命令替代）；v4「DELETING 投影跳过」（照写+中止语义）；v4「恰好 165 转换」（列级 census 派生）；v4「BEFORE INSERT OR UPDATE」（UPDATE 始终+INSERT 仅 NULL） | v5 修订记录 |
| 登记 | loopback 退役单独立项（前置=oracle 跑满保留期+coverage 证据）；复核窗拆除单独立项 | C3b 后 |
| 登记 | 跨 team 复制/项目转移（个人→团队媒体重新归属流程——产品缺口，安全默认=跨 team 拒绝已在位） | Y2/产品 |
| 登记 | 媒体所有权语义（projectId=provenance）；doc schema 演进（docSchemaVersion+normalizer+lazy migration——Y2 第一枪）；长期事件日志；「真 Yjs 升级」候选批；多实例/HA（Y7 触发型） | Y2/后续 |
| 登记 | clock_timestamp（claim 谓词）/Node 日历族（五轮一致维持登记；CI TZ 显式化已并入 C1）/30d 硬删+MediaDeletion tombstone（minio 版本化部分覆盖）/app-DB 时钟偏差观测 | 后续 |
| 不采纳（第五轮） | R3「开发序终态 schema」方案——Date 参数绑定更简（零过渡零批序变动）；R1 P0-1 修法 B（frame admission deny-set——查询成本+拒帧复杂，投影照写更简）；R2 P0-4 方案 C（卡序再调——deletionState 进 C3a additive 已解）；Node 日历进 C2/C1（维持登记） | 第五轮裁定 |
| 偏离登记 | DerivedIndexContract 七条语义以 MediaBindingProjector 接口+测试承载（v4 裁定维持）；服务端版本归一=有前提的兼容做法（factVersion 全局单调+每 media 必有 state 两前提钉为契约测试——长期客户端 per-type 版本归 Y2） | 承前 |

**v1→v5 裁定史**：v1（b849381b）→两外审→v2（bafd26de）→三外审→v3（7ad592da）→四外审→v4（1035c6c6）→五外审（三报告：DELETING 盲点/coverage 可证明/水位跳缺口/161+removal allowlist/触发器 INSERT/root update 缺口/CloneBinding 删除/上传 state fact/backfill/候选驱动/scope 化/project FK）→v5。五轮评审采纳/降级/反对逐项记录于 2026-11-11/12 对话。
