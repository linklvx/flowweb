<!-- doc-status: draft | created: 2026-11-11 | v2（同日两份外审评审实证后重裁重写）：评审 A（架构评审 9×P0）+评审 B（独立复核 8×P0+20×P1）关键主张逐条亲证属实——数组域 splice 零 MEDIA_REF 效应（actor observeDeep 只读 changes.keys，YArrayEvent keys 空 Map）/appendBatch 水位 UPDATE 不写 CanvasDoc.updatedAt/additive 门 BREAKING 正则拦 ALTER COLUMN TYPE+仓内已有 squash 先例（BASELINE=y0b2_init）/deploy-guard T31 断言钉死 AT TIME ZONE/media-registration:249 ::timestamp cast/init 迁移 37 处种子 now()/facts 端点无 projectId 过滤（跨项目误删面）/recovery-import 绕过帧管线/reconcileDaily 24h 从启动计时/dead 枚举有代码面/frames 三元式依赖 lifecycleObserver/frame-effects CONTRACT-FREEZE。三路线用户重裁（2026-11-11）：C1=rebaseline/squash（推翻 v1 genesis 勘正+转换迁移）；C2=MediaFact(mediaId,factType) 当前态表根修（推翻 v1 死龄清扫+双守卫）；C3=拆 C3a/C3b+复核窗保留+影子对拍（强化 v1 等价性门序）。v1 裁定史与评审消化全录 §6。 -->
# 地基修复批 v2（时间语义 rebaseline + MediaFact 当前态 + MediaBinding 投影真值）设计 spec

日期：2026-11-11（v1=b849381b；v2=同日两份外审实证重裁重写版）

定位：production-readiness 批后继的**正确性地基批**（评审共识定名：foundation correctness batch——不宣称架构升级，不改变单实例/无 HA/无 S3 边界）。四卡：**C1 时间语义根修（rebaseline）→ C2 MediaFact 当前态表 → C3a MediaBinding 投影真值成立 → C3b 消费面切换（影子期）**。全环境 reset 部署窗=用户显式指令时点。

## §0 已裁定（不再议——v2 重裁后）

- **C1=rebaseline/squash**（评审 A/B 一致首选+用户重裁）：单一新 init 基线（全列 `@db.Timestamptz(3)`），消解 v1 路线的六个面（T7 编辑/init 37 处种子/75 表 additive 豁免/immutability 棘轮/C2 enum DROP TYPE/C3 binding 加列）；仓内先例=y0b2_init（「Y0b-2 T1 squash 基线=唯一 init」）；配套**对象级 diff 门**（pg_dump --schema-only 前后对拍，缺 raw 对象即红）。
- **C2=MediaFact 当前态表根修**（用户重裁，推翻 v1 死龄清扫）：纯拉取+客户端 factVersion 去重模型下，per-project fan-out 行是 Z1'' 推送模型遗产；当前态表 `(mediaId,factType)` 唯一行消解死行/lag/守卫/staleness/调度一整族问题。
- **C3=拆两卡**（用户重裁）：**C3a 真值成立**（效应完整性/单写者/失败隔离/水位——不拆任何消费面）→ **C3b 消费面切换**（影子对拍+水位前置+条件删除；**复核窗保留，拆窗单独立项**）。
- 命令面 `bindInTx` 改道（不再写 binding——binding=纯 doc 投影）；`BindingReconcileService` 降级只读漂移检测。
- 流程纪律：superpowers TDD（红先行→绿）、TypeScript strict、subagent-driven+每卡双评审、迁移串行、新 commit 禁 amend。

## §1 事实基线（v2 勘正版——两评审实证锚点，2026-11-11）

### §1.1 时间语义（v1 审计+两评审补漏）

墙别判定与 13 风险点处置表承 v1（b849381b §1.1）不变，**v2 勘正/补充**：

1. **门禁冲突（v1 漏）**：`check-migration-additive.mjs` BREAKING 正则拦 `ALTER COLUMN ... TYPE`（转换迁移需 ~75 表逐表豁免且永久登记）；`check-migration-immutability` tree 对拍拦已提交迁移编辑；`deploy-guard.test.mjs:402-411`（T31-P1 红①②）把 `AT TIME ZONE 'utc'` 钉成必须断言——C1 后需翻转。⇒ rebaseline 一并消解。
2. **种子面（v1 漏）**：init 迁移 37 处种子 `now()`（NodeType/AIModel/ModelResolution/ModelDuration/PricingRule，:1330-1390）；+8 会话重放下 `USING 'UTC'` 转换会整体偏 8h。rebaseline 下 timestamptz 列裸 `now()` 天生正确——种子问题消失。
3. **`::timestamp` cast（v1 归类错）**：`media-registration.service.ts:249` `${toISOString()}::timestamp`——C1 后 naive cast 进 timestamptz 按会话解释 → +8 偏移；须改 `::timestamptz` 或参数绑定。
4. **CanvasDoc.updatedAt 写入语义 bug（v1 漏——独立于时间墙）**：appendBatch 水位 UPDATE（canvas-doc-update.repository.ts:285-290）只写 walCheckpointSeq/pgSeq；updatedAt 仅 genesis/maintenance/compact 写 → canary 7d 活跃窗（`d.updatedAt > now()-'7 days'`）对「只编辑无 compact」项目恒判不活跃。
5. **脚本锚（v1 漏）**：reset-collab.mjs:283 / drill-fault.mjs:152 / drill-cutover.mjs:605 bump SQL + deploy-guard 断言两处——grep 清零范围必须含 scripts/。
6. 全仓 `AT TIME ZONE` 文本命中 41 处（v1 写 ~20 低估，含注释/测试）；补偿谓词拆除以「grep 全仓（apps/packages/scripts）+ 负控」为口径，不逐文件手清单。

### §1.2 MediaFactOutbox → MediaFact（消费语义勘正）

- **facts 端点是 team 级 mediaId 级消费**（media-facts.controller.ts:61-75：teamId 过滤+按请求 mediaIds 拉，**无 projectId 过滤**）——v1 的 per-(mediaId,projectId) binding 守卫在跨项目复制场景误删唯一行（评审 B-P0-7 实证：A 生成 fact 行→复制到 B→A 引用移除→行被删→B 休眠重开拿空）。
- 写面 5 处 createMany（media-registration:258/:298、media-probe:425、materialize:412/:557——v1 §3.2.5 写 4 处系笔误）按「当时 union(Media.projectId, binding.projectId)」扇出——扇出语义只对推送模型有意义，纯拉取下是遗产。
- `dead` 枚举非零代码面（v1 错写零面）：intent-reconcile.service.ts:547-551 dead-letter count+`reconcile_manual_required_total` 告警+r3 测试 seed。
- `reconcileDaily`=24h setInterval 从进程启动计时（:116）——部署频繁期可能长期不跑（随 C2 表退役一并消失）。
- `media_fact_outbox_lag` 未接告警链（THRESHOLDS 无 media 指标）；soak 脚本引用两处（collab-soak-metrics.mjs:79、collab-soak.mjs:361）。

### §1.3 MediaBinding 投影真值（v1 事实基线勘正——三缺口实证）

1. **效应不完整（评审 B-P0-1/A-P0-6 实证）**：actor observeDeep（collab-project-actor.service.ts:202-270）只遍历 `ev.changes.keys`——**YArrayEvent（allImages/images 列表槽 splice）的 keys 为空 Map → 已有节点上追加/删除列表项零 MEDIA_REF 效应**；仅节点新建分支读字段初值。recovery-import（collab-recovery-import.service.ts:283-289 注释自认）`Y.applyUpdate` 直写零效应；replayAll 机械落帧不派生。⇒ v1「帧效应已在位，缺持久化」的判断不成立——**效应派生本身不完备**。
2. **多写者 LWW（评审 A-P0-3/B-P0-3）**：BindingReconcileService 头注自认「与 finalize bindInTx 并发 last-writer-wins：doc 快照旧于 finalize ⇒ upsert 回写旧 mediaId；finalize 新建行可能被误判 stale 删」且「**GC 以 doc 扫描为终裁，不依赖 binding 完整性**」；reconcileProject T1 读 doc / T2 写 DB 两窗。命令面 bindInTx 写 binding 时 doc 交付异步滞后（binding=doc 超集窗）。⇒ v1「帧效应=权威+命令面保留+reconcile anti-entropy 三写者同键幂等」的口径在交错下不成立。
3. **拆除安全网的论据不成立（评审 A-P0-4/B-P0-5）**：fenceProject 只围被擦除项目——**同 team 他项目 doc 写者不经 fence**（跨项目 TOCTOU：t1 判独占→t2 间 Q 粘贴引用→删→Q 裂图）；binding 同事务只覆盖 PG 已提交前缀（appliedSeq>pgSeq 在飞帧不可见——与 doc 扫描 oracle 可见面等价，见 §3.4 水位门）；复核窗=「标记与删除不得同窗」的近似门非精确门。⇒ v1「sameSet 恒成立故拆复核窗」论据撤回。
4. **FK/ACL 毒帧面（评审 A-P0-5/B-P0-6）**：MediaBinding 有 Media FK——doc 写不存在 fileId → binding INSERT P2003 → 整批帧回滚 → 客户端可用字符串打死项目协作写；跨 team mediaId 越权引用面。
5. **挂点条件化（评审 A-P0-7）**：appendBatch 的 frames 仅 lifecycleObserver 存在时构造（actor:1518-1520）——binding 挂点须无条件化。
6. MediaBinding 现形（schema:1623-1638）：槽位唯一键 `[projectId,nodeId,role,targetField,targetItemId]`、无水位/版本列；mediaIdListOf 把列表拍平丢 item 身份；效应差分序=ADDED 先 REMOVED 后（actor:248-251）。
7. **CONTRACT-FREEZE**（frame-effects.ts 头注明示）：FrameEffect 契约冻结——v2 路线**不解冻**（终态投影不扩载荷，见 §3.3）。
8. Y2 登记（typed-ref/Artifact 一等表/稳定 Media.id）承 v1——MediaFact 当前态表与 binding 投影均与之兼容。

## §2 卡序

| 卡 | 内容 | 重量 |
|---|---|---|
| C1 | 时间语义根修：rebaseline（全列 timestamptz）+补偿谓词/脚本锚/断言翻转+::timestamp+updatedAt 写入语义+三门禁+对象 diff 门 | 中 |
| C2 | MediaFact 当前态表替换（5 写点 upsert+端点改道+旧表/enum/lag/清理路径退役） | 中 |
| C3a | binding 投影真值成立：终态投影器+命令面改道+reconcile 只读化+失败隔离+水位列+效应完整性不再依赖（终态口径） | **重** |
| C3b | 消费面切换：全库 backfill+影子对拍+水位门+条件删除+退役清单；**复核窗保留** | 中 |

C2 与 C3 无依赖（当前态表不读 binding）；C3a→C3b 严格串行（影子期前置=真值成立）。

## §3 卡设计

### §3.1 C1 时间语义根修（rebaseline）

**3.1.1 rebaseline 主体**：
1. schema.prisma 全部 DateTime 列改 `@db.Timestamptz(3)`（CollabLease 两列已是）——以 schema 全量为准（~167 字段）。
2. 生成单一新 init 迁移替代全部历史迁移链；**raw 对象保留清单**（prisma diff 不生成的）：`system_history_single_row_check`、`media_binding_target_field_domain`、`maintenance_operation_one_active_idx`、`team_credit_transaction_guard`/`team_balance_guard`、CanvasDoc `pgSeq≤walCheckpointSeq` CHECK、既有 partial unique 全族——以 squash 前 `pg_dump --schema-only` 对拍为门（缺任一即红；载体=dump-schema-objects/check-fresh-replay 既有基建扩展）。
3. 种子：init catalog seed+SystemHistory 引导行保留于新 init；列已 timestamptz → 裸 `now()` 即瞬时语义（**v1 的 T7 勘正不再需要**；T31「genesis 裸 now() 残留+新装漂移窗+bump 自愈」登记条目销案——runbook §16 步⑥ 同步）。
4. 迁移基建同批重建：check-migration-additive `BASELINE` 抬至新 init（fresh 集空、EXEMPTIONS 清评估）、migration-checksums 重建（--write）、migrate-diff baseline --write。
5. reset 序：dev=`prisma migrate reset`；服务器=reset-collab §16 人工序（部署窗=用户指令）。

**3.1.2 代码面**：
- 拆补偿谓词：全仓 grep（apps/packages/scripts）`AT TIME ZONE 'utc'/'UTC'` 清零（豁免=报表层显式时区转换+注释）；含 v1 清单+脚本三件（reset-collab:283/drill-fault:152/drill-cutover:605）。
- `media-registration.service.ts:249` `::timestamp` → `::timestamptz`（或 Date 参数绑定）。
- **deploy-guard 断言翻转**（T31-P1 红①②→新形态）：断言 bump SQL 含裸 `now()` 且**不含** `AT TIME ZONE`，+新增 schema 断言（epochStartedAt 列=timestamptz）——锚测试纪律保留不删。
- **CanvasDoc.updatedAt 写入语义修复**：appendBatch 水位 UPDATE 两形态同事务补 `"updatedAt" = now()`；红测=只 append 不 compact 的项目在 canary 7d 活跃窗内必被计入。
- 测试锚同步翻转（generation-intent.service.spec.ts:619-625 等全仓同款）。

**3.1.3 三门禁+验收**：
1. schema 门禁：DateTime 缺 `@db.Timestamptz(3)` 即红（负控=加 naive 列必红）。
2. raw SQL 门禁：新代码/新迁移禁 `timestamp(3)`/`timestamp without time zone`/`now()::timestamp`/**任意 `::timestamp` 参数 cast**/补偿式 `AT TIME ZONE 'utc'`（豁免=报表层显式时区+注释）；负控同。
3. 双时区集成测试：同一组用例（lease 过期续租/retention cutoff/canary age/erasure claim/`@default(now())` 插入/`@updatedAt` 更新/sourceUrlExpiresAt round-trip）在 `SET LOCAL TIME ZONE 'UTC'` 与 `'Asia/Shanghai'` 两腿同结果（注入方式归 plan；+8 腿本机/UTC 腿 CI 矩阵）。
4. 验收：grep 全仓清零+对象 diff 零缺失+负控红证+`epochStartedAt` 读回与 `Date.now()` 差 ≤2s+verify FULL。

### §3.2 C2 MediaFact 当前态表

**3.2.1 新表**（C1 落地后走普通 additive 迁移）：
```prisma
model MediaFact {
  mediaId     String
  factType    String    // 'state' | 'natural'
  factVersion BigInt
  payload     Json
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)
  media       Media    @relation(fields: [mediaId], references: [id], onDelete: Cascade)
  @@id([mediaId, factType])
}
```
行数上界=media×factType（有界）；Media 删除/项目擦除随 FK 级联。

**3.2.2 写点改道**（5 处 createMany → 单行 upsert）：`INSERT ... ON CONFLICT ("mediaId","factType") DO UPDATE SET ... WHERE EXCLUDED."factVersion" > "MediaFact"."factVersion"`（版本单调防倒退/乱序）；per-project 扇出消失。payload 形状不变（客户端零改动面预期——核对归 plan）。

**3.2.3 端点改道**：`POST /api/media/facts` 按 mediaIds+team ACL 直查当前态行返回；不再 mark published；客户端 factVersion 去重契约不变；processing watcher 语义由 state fact 当前态承载。

**3.2.4 退役清单**：MediaFactOutbox 整表+`MediaFactState` enum+`@@index([state,nextAttemptAt])`+死列族（随表消失）+intent-reconcile `cleanProjectionAndOutbox` outbox 段+dead-letter count/告警+r3 测试 seed+`media_fact_outbox_lag` gauge（delivery-lag.metrics.ts）+soak 脚本两处引用+schema 注释 emitter 设计描述。观测面诚实登记：原 lag 指标随模型消失，替代观测=无（拉取+当前态下「投递滞后」语义不存在）。

**3.2.5 红测族**：版本单调（旧 factVersion 不倒退）/跨项目复制场景 B 客户端拉得到当前态（评审 B-P0-7 反例转绿）/休眠 >7d 重开拿得到/Media 删除级联/退役 grep 锚清零（含 dev 144 行死行随表消失实证）/端点无 published 标记行为。

### §3.3 C3a binding 投影真值成立（不拆任何消费面）

**3.3.1 终态投影器（评审 A-P0-6 路线——不解冻 FrameEffect 契约）**：新建独立 `MediaBindingProjector`（纯函数+批量 SQL，入 module-size 锚——actor 不再膨胀）：
- actor flush 收集本批 **touched nodeIds**（全事件形态：update/FIELD_CHANGED/NODE_*/数组 splice——不再依赖 MEDIA_REF_* 效应派生的完备性）；
- appendBatch inTx 闭包（**无条件化**，不依赖 lifecycleObserver/frames 三元式）内对每个 touched node 读内存 doc 终态 `data` 域，按 `MEDIA_REF_TARGET_FIELDS`+`array-domains` 词表算**槽位终态集**（targetField/targetItemId 天然可得；NODE_DELETED→终态空）；
- 与该 node 现存 binding 行 diff：upsert 新增/变更、delete 消失（**按槽位+mediaId 条件删**——换绑/重复项/undo/delete+re-add/数组重排天然正确，无效应顺序问题）；
- replay/reconcile 复用同一投影器做全项目 rebuild（锁内读终态）。

**3.3.2 单写者（评审 B-P0-3 修法）**：binding 权威写=appendBatch inTx 投影+锁内 rebuild 两形态；**命令面 `bindInTx` 三调用方（finalize/replaceMedia/BindMedia·CloneBinding）改道不写 binding**（只写 NodeArtifact/Projection/doc 命令——binding 滞后一步由投影收敛；facts 扇出已随 C2 消失，无即时性消费者）；`BindingReconcileService` 降级**只读漂移检测**（doc 终态 vs binding diff → `media_binding_drift_total` 计数+告警+触发受控 rebuild），**不再周期写**；发现面候选扩 CanvasDoc 全表轮转（修「binding 被误删且无 artifact 的项目永不收敛」面）。

**3.3.3 失败隔离（评审 A-P0-5/B-P0-6）**：投影写入前批量预校验 Media 存在∧teamId 匹配项目∧未软删（INSERT..SELECT JOIN 形态）；无效/跨队引用**跳过+`media_binding_skip_total{reason}` 计数，绝不 throw**；系统性异常随批回滚走 actor 既有重试链（张力登记：投影自身 bug 会挡帧——以投影器纯函数+批测纪律防，§6 登记）。红测：doc 写 `fileId='does-not-exist'`/跨队 mediaId → 帧仍落 PG、binding 零行、项目不 terminal。

**3.3.4 水位列与覆盖判据**：MediaBinding 增 `lastWalSeq`（行级覆盖水位）+ CanvasDoc 增 `mediaBindingSeq`（项目级，appendBatch 同事务推进至 newPgSeq）——消费者（C3b）判定前置=「mediaBindingSeq ≥ pgSeq」（与 doc 扫描 oracle 可见面等价：appliedSeq>pgSeq 在飞帧对两者均不可见）；recovery-import 后标 `bindingsDirty`（持久标记）→ 消费前强制锁内 rebuild（import 入帧管线=后续优化登记）。

**3.3.5 红测族**：touched 终态投影对数组 append/remove/replace/reorder/换绑/undo/delete+re-add 全形态 binding==doc 终态（**独立 oracle=真 Y.Doc 重放 collectMediaRefs，禁共用 ProjectDocIndex 防同模假绿**——评审 B §5.3）；kill -9（WAL fsync 后 PG 提交前）重启回灌 binding 追上；reconcile 只读化后并发交错 100 次 binding 恒等于 doc 最新；坏 mediaId/跨队不挡帧；recovery-import 后 dirty→rebuild 收敛；C3a 收口跑 T33 bench-smoke 档（append p95/写放大不回归——load-bench-hard 固定 runner 归部署窗）。

### §3.4 C3b 消费面切换（影子期）

1. **全库 backfill 前置**：遍历全部 CanvasDoc 锁内 rebuild（一次性运维动作+证据留档）。
2. **影子对拍**：media-gc/erasure 判定改为 binding 为主、**doc 扫描保留为 oracle 对拍**（双读）；mismatch → **保留媒体+`media_gc_shadow_mismatch_total` 告警**不删；影子期判据=≥7 天零差异（或用户裁定轮次）后退役 doc 扫描。
3. **水位门**：判定前检查 `mediaBindingSeq ≥ pgSeq`（含 bindingsDirty 检查），不满足 bail-out 保留。
4. **条件删除**：最终删除同一事务 `DELETE ... WHERE NOT EXISTS (binding/artifact/work/...)`。
5. **复核窗保留**：`ERASURE_MEDIA_REVIEW_MS`+sidecar 族不动；拆窗=单独立项（前置=team 级 fence/跨项目水位 drain 方案设计，§6 登记）。
6. **退役清单**（影子期满后）：loopback 端点+`collectProjectMediaRefs`+`httpMediaRefsCollector`+DTO+`auth.guard` worker 例外（isWorkerMediaRefs）+collab-write.controller 路由+`ERASURE_MEDIA_REFS_BATCH/SCAN_MAX` **常量**（非 env 键——v1 表述勘误）+测试三件（media-refs.c4c1.spec/collab-write-endpoint.int.spec/collab-write.controller.spec）+poller 注入面。
7. 红测：影子 mismatch 注入→保留+告警；水位落后→bail-out；「GC 扫描后新增 binding」交错→媒体保留（评审 A-P0-4 红测）；erasure 全链 e2e（kill -9 resume 含）绿。

### §3.5 批级出口门

verify FULL+四卡双评审全 ✅+三门禁/对象 diff 门负控红证+影子期判据达成+backfill 证据+bench-smoke 不回归+呈报包（gate-evidence/foundation-exit.txt——诚实登记：投影系统性异常挡帧张力/复核窗保留面/import 未入帧管线/Node 日历族未触）+部署窗（用户指令：全环境 reset §16）。

## §4 机器门与登记影响面（批级）

- 迁移基建：additive BASELINE 抬新 init+immutability 重建+migrate-diff --write（C1 一次性）；此后 C2 建表/C3a 加列走普通 additive。
- 新门禁入 verify 链：schema timestamptz 门/raw SQL 门（含 ::timestamp）/双时区测试/对象 diff 门——负控自测随脚本。
- 指标纪律：`media_binding_write_total`/`media_binding_skip_total{reason}`/`media_binding_drift_total`/`media_gc_shadow_mismatch_total`/`media_binding_watermark_lag`（低基数禁 projectId）+`--write-metric-names` 同 commit+涉指标 commit 跑 verify FULL。
- module-size：MediaBindingProjector 新文件入锚；actor 行数变化按净增面纪律补登。
- runbook：§16 步⑥ 注释（C1）/§13 恢复面 backfill+影子语义（C3b）/§14 分诊面 media 段（C3b 后）随卡。

## §5 确认点（批流程门）

1. spec 确认门（本文件 v2）→ 2. plan 确认门（writing-plans）→ 3. C1→C2→C3a→C3b 每卡双评审 → 4. 批末出口门（§3.5）→ 5. 部署窗（用户显式指令）。

## §6 登记/偏离表（v2 全量）

| 项 | 内容 | 归属 |
|---|---|---|
| 销案 | T31「genesis 裸 now() 残留+新装漂移窗+bump 自愈」（rebaseline 下不复存在） | C1 |
| 销案 | v1 C2-A 路线（死龄清扫+双守卫+staleness gauge）——被 MediaFact 当前态表替代；v1 的 staleness gauge 设计数学错误（评审 A-P0-9：set「距上次刷新秒数」恒 0）随路线消失 | C2 |
| 偏离登记 | FrameEffect 契约保持冻结（v2 终态投影路线不解冻——评审 A-P0-6/B-P0-1 路线择一记录：终态投影胜出，理由=派生完备性难证（数组/合并/update/undo 一族）而终态+diff 正确性论证简单） | C3a |
| 登记 | 复核窗拆除单独立项（前置=team 级 fence 或跨项目水位 drain 方案设计+影子零差异期） | C3b 后 |
| 登记 | recovery-import 入 actor 帧管线（C3a 先做 bindingsDirty+锁内 rebuild 保守形态） | 后续优化 |
| 登记 | 投影系统性异常挡帧张力（数据性无效已隔离跳过；系统性异常随批回滚走 actor 重试——投影器纯函数+批测纪律防） | C3a |
| 登记 | Node 进程日历逻辑族（setMonth/setDate/toISOString().slice 随 TZ 变——评审 B-P1-1；独立于 DB 时间墙的应用日历族） | 后续批 |
| 登记 | 派生索引合同（DerivedIndexContract 七条语义：source/watermark/total-write/read-check/rebuild/verify/repair——评审 A-4.2 建议泛型框架，降级为 spec/runbook 文档化，Y2 typed-ref 时再评估泛化） | 文档化 |
| 登记 | 心跳 sidecar（E35「独立 timer/子进程」偏离——spec:90 实证；T33 F2 同族） | 独立小卡紧随 |
| 登记（外审报告余项维持） | S3 快照分层/IDB snapshot+delta/追平状态机/tracing·RUM/noisy-neighbor/per-doc 公平预算/active-passive（Y7）——带触发不进批 | 触发型 |
| 既有在册维持 | wal-g 异地归档/16G 扩容校准/SMS 实弹演练 | 运营窗 |

**v1→v2 裁定史**：v1 三路线（A/A/路线1）经两份外审实证推翻重裁（rebaseline/MediaFact/C3a+C3b）——v1 文件见 git 历史 b849381b；两评审采纳/降级/反对逐项记录于 2026-11-11 对话（要点：A 的 DerivedIndexContract 泛型框架降级文档化；B 的 import 入帧管线降级登记；Node 日历登记不进批；RPO/RTO 专门条款不立项——出口门两行承载）。
