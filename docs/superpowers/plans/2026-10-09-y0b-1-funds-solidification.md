# Y0b-1 资金固化 Implementation Plan（v2.2——四轮外审收敛+第四轮接缝修复：PG 事务语义/部署链/重试语义/UI 键所有权）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 Y0b 资金固化子批（v2 终裁范围）——**Y0b-0 spec 一致性门禁** + **T1a 基线重置**（24→1 init，census 自证）+ **T1b 纯 additive 迁移**（intent 定价快照列+台账两列真值+reversesId 1:1 冲销链含 settle 配对+DB 约束全家+定价数据进迁移）+ **pricing-resolver 单源**（modelId 可空+kind 级规则+video duration 维度修复+十处改道）+ **plan 无条件固化**（claim 携快照+reserve 金额单源 intent 行）+ **CreditLedgerService 台账唯一写入口**（FOR UPDATE 单式+真值表+reversal 三配对+11 写点+账户域幂等锚）+ **settle 失败对账闭环**（status 判据第四分支+运行时巡检三层）+ **生命周期资金门**（准入谓词+单事务销毁+force-void 出口）——达成修订后出口判据，Y0b-1 收口。

**Architecture:** 迁移两刀——T1a 重造基线消化**只能靠重建实现的变更**（enum 终态删 `consumption` 加 `release`、假 `@@unique` 删、两处 `teamId` 去 FK 改 NOT NULL、`PricingRule.modelId` 改可空），T1b 纯 additive 成为 additive 门禁首个真实受检对象；验收=对象级 census 双向比对（Prisma diff 对 raw 对象假绿）。定价唯一解析器=`PricingResolverService`（AIModel 单源判存在性+全四键**精确匹配无阶梯**；`modelId IS NULL`=kind 级规则——假 internal 模型行与"唯一 active 模型"断言删除）。台账唯一写入口=`CreditLedgerService.mutate(品牌tx, {...})`——FOR UPDATE 单式、两列真值表逐型复核、`reversesId` 1:1 三配对（`settle↔reserve / release↔reserve / refund↔settle`——`settle_once` 删除，rearm 冲突结构性消失）。台账锚 `referenceId='intent:'+intentRowId`（服务端 cuid）；`reserve` 金额只读 intent 行（plan 固化的完整含义，TOCTOU 结构性消失）。交付判据=`complete()` 即产物门序（`deliveredAt` 列删除）。解散保持物理级联删（`TeamCreditTransaction.teamId` 无 FK NOT NULL 一行解决审计留痕——`teamIdSnapshot` 不引入）+ 准入侧 `team.status` 谓词。冻结不进钱包（reservedCredits 保持唯一权威），代价由三层巡检补偿（未闭合义务巡检+mutate 写侧复核+锁序静态锚）。

**Tech Stack:** Prisma 5.22（migrate diff 生成+手工组目录——无 TTY 下 `migrate dev` 拒交互；census 脚本自证）/ PG16（NULLS NOT DISTINCT+partial unique+CHECK）/ vitest（单元+int 真库）/ node:test（scripts 自测）/ zod（env——本批零新键）。

**执行门：** Task 0/1a/1b/2 各有 Step 0 只读探针（输出粘 commit message）；**T1a Step 8=【告知用户点】**（本地 dev 库 reset 重建——数据全清，备份按 backup_methodology 记忆自行决定）；**T1a Step 10=【告知用户点】**（服务器 dev 库重建=**deploy.sh `--rebuild-db` 分支**（四轮 Z34——清远端迁移目录+②备份后 DROP SCHEMA→③migrate deploy 于空库一次跑完 T1a+T1b→④⑤正常切换重启→seed；pm2 stop 删——旧码对新 schema fail-closed 为设计行为；登记 runbook，部署时人工执行）；**T8 子批出口=【用户确认点】**。每 Task 收尾 `git commit`，红→绿→commit。

**执行序：**

```
T0（Y0b-0 门禁微修——先清 spec 自身） → T1a（基线重置 24→1+census 自证）
  → T1b（Y0b-1 迁移纯 additive——additive 门禁首个真实受检）
  → T2（resolver 单源+十处改道+覆盖度门禁——依赖 T1b modelId 可空+定价 INSERT）
  → T3（plan 固化+reserve 金额同源+onFailed 反查——依赖 T1b 列+T2 resolver）
  → T4（CreditLedgerService+11 写点+账户域幂等——依赖 T1b 列+枚举）
  → T5（第四分支 status 判据+巡检三层——依赖 T4） → T6（生命周期门——依赖 T1b teamId 列）
  → T7（出口汇聚） → T8（回填+呈报）
```

**TDD 纪律：** 红→绿→commit，红相留档（commit message 粘红/绿两态）。**真红门**：跨团队串账/混合符号二次退款/rearm 二次退款/同键定价重复/无规则零外呼/admin 并发撕裂/解散在飞冻结蒸发/chargeRows anti-join/并发 reserve×release 零锁等待超时。**片段即产物**：代码块来自工作树粘贴或结构模板+探针回填。**int 纪律（X16）**：新增 **6** 个 int 文件（四轮 P1-7：di-smoke.int.spec.ts 是第 6 个——v2.1 误计 5） ⇒ T7 回填逐文件下限。**census 验收 grep**：`CREDIT_COST_PER_EDIT`+`'consumption'`（查询过滤清零；枚举值 T1a 真空删）+`executeWorkflow`+模型键位断言。**sv 全链保留**（退役归 Y0b-2 与准入门同 commit——本批零触碰）。

---

## 0. 终裁记录（三轮外审 22 项 P0+8 项分歧终裁——执行者必读的设计依据）

| # | 裁定 | 一句话理由 |
|---|------|-----------|
| Z1 | **迁移两刀**：T1a 基线重置消化 enum 终态/假唯一/两处去 FK/modelId 可空；T1b 纯 additive | 单 init 含终态会使 additive 门禁 fresh 集合永空（退回空转病）；"只能靠重建实现的变更"（DROP NOT NULL/枚举删值=重建类型）放增量永远过不了门禁 |
| Z2 | **census 自证**（dump-schema-objects.mjs 对 shadow_old vs 新 init 重放双向比对），非 Prisma diff 零差异 | Prisma diff 不建模序列/partial WHERE/约束形态——对 9 索引+1 序列+1 约束+1 种子行共 12 类对象"零差异"是假绿 |
| Z3 | **库处置=drop & recreate**（本地 reset、服务器 DROP SCHEMA），不重标记 `_prisma_migrations` | 无生产环境已裁定；重标记是 TD-10 保数据机制，现为纯风险面。deploy.sh:66/88 的 `migrate deploy` 前置硬依赖成步骤 |
| Z4 | **解散保持物理级联删**；`TeamCreditTransaction.teamId`+`TeamRechargeOrder.teamId` 去 FK 改 NOT NULL；`teamIdSnapshot` 不引入 | 软关闭不改变画布级联删事实（净收益仅保留归零池行），成本=15 条关系删除清单；无 FK NOT NULL 一行达成台账 append-only+审计留痕。`GenerationIntent.teamId` 同为无 FK 纯列（FK Restrict 与物理删不兼容——终态 intent 行 7 天保留期会挡删除） |
| Z5 | **PricingRule.modelId 可空，无解析阶梯、无 pricingDimensions 列** | `modelId IS NULL`=kind 级规则仍是精确匹配；假 internal 模型行（admin 面可见+唯一断言脆弱）删除；维度声明由 ModelResolution/ModelDuration 表自身承载（门禁键集从表派生） |
| Z6 | **settle 纳入 reversesId（指向被核销 reserve 行），删 settle_once** | rearm→refund→重试→settle 撞 `(referenceId,creditType)` →永久悬留的路径无报告反驳成功；reversesId @unique 更强（同 reserve 行既 settle 又 release 在 DB 层不可能）；配对等额校验按记账轴（settle 比 frozenDelta、release/refund 比 balanceDelta） |
| Z7 | **heartbeatAt/deadlineAt/inputHash/docStateSeq/deliveredAt 五项全删**，随 Y0b-2 消费者同批 | deadline 值无 p99.9 标定=写谎言；docStateSeq 撞契约 10 且语义错（compact 水位≠append 水位）；deliveredAt 的 4 编辑 kind 漏写洞→判据折进 complete()（status 即交付事实） |
| Z8 | **amount/balanceAfter 保留**；amount 加 `CHECK = CASE` 派生式 | team.controller.ts:46-58 用户侧展示读点消费 amount（实测）；CHECK 是 DB 级强制等价、零读改写 |
| Z9 | **账户域幂等锚**：`UNIQUE(type,referenceId,creditType) WHERE type IN ('recharge','subscription_grant','expire_clear','register_grant')`+referenceId NOT NULL CHECK；**admin_\* 不进键**；前置修复三件（expire_clear 补 `subId:periodEnd`、register_grant 补 userId、personal-ledger clear/grant 分键） | 三支付入口已有同事务订单 CAS（实测 payment-success:42-52）——真缺口在 admin_\*（合法重复操作面）/expire_clear（无 referenceId）/expireSubscriptions（CAS 返回值不检查）；契约 4 增补"referenceId=事件 id 禁实体 id，clear/grant 分键" |
| Z10 | **reserve 金额单源 intent 行**（签名删 amount）+`alreadyReserved→mayCall:false` | claim 固化快照的完整含义；TOCTOU 结构性消失；H7 双外呼洞一并关 |
| Z11 | **冻结不进钱包**（reservedCredits 唯一权威），三层补偿：未闭合义务巡检（reserve 行未被 settle/release 冲销∧意图不存活→幂等 release+指标）/mutate 写侧读 intent 行复核/`frozen partial index` | 一批不做两次资金模型迁移；台账行自带完整释放信息（reversesId 即 1:1 排斥器）——"意图行丢失⇒钱不可释放"的结构洞由巡检关闭 |
| Z12 | **单写入口防线=本批静态锚扩面**（全写操作集+teamBalance.\*+裸 SQL+AST 自有键判定+静态锁序锚）；$extends 运行时拦截登记 Y0b-2 | 区分调用者的运行时机制需设计，不在资金批发明；api lint 提进 verify（f2e14241 先例） |
| Z13 | **锁序红相改静态锚**（现存代码全 GI→TB 同序、等待图无环——ABBA 红相产不出来，实测）；理由改写"建立全序+消灭无界锁等待" | 契约 20 保留（CAS 仍在，ABBA 面未结构性消除——(b) 的已知代价，spec §9 登记） |
| Z14 | **sv 全链保留零触碰**；Y0b-1 只删 executeWorkflow 残留+'consumption' 过滤（并入 T1a）+onFailed 死代码反查 | remove-after-replace：sv 退役与 Y0b-2 canExecute/SYNC_PENDING/pre-call 断言同 commit；本批→Y0b-2 之间 sv 仍在（无裸奔窗口） |
| Z15 | **T0 门禁微修**：METRIC_FILES 改 glob `**/*.metrics.ts`（实测 4 文件）；denylist 收窄为代码型 token（release_once/COLLAB_RSS_SOFT_LIMIT_BYTES/replay_kill）——自然语言短语项删（spec:572 实测命中即误报例证）；env 域保留 | 门禁会被误报训练绕过——收窄到零误报形态 |
| Z16 | **定价数据进迁移**（编辑 4 kind+multiImageGen 的 NodeType+kind 级规则 INSERT ON CONFLICT）；删 seed-pricing.ts 与 1 积分兜底；主链规则留 seed.ts（模型行是 seed 固定 ID，迁移时不存在） | 定价是部署契约；CI 无 seed（实测 ci.yml:48-50）下 kind 级规则随 deploy 进库、主链空表门禁自然绿 |
| Z17 | **第四分支判据=status**（SUCCEEDED∧冻结未销→补 settle；FAILED/VOIDED∧冻结未销→release），挂 5min 档+逐行容错 | complete() 本就是产物门序；与 E53"推理已发生不退款"一致；24h 悬留压到 5min |
| Z18 | **G-1 拆两条断言**（定价同源：validation.totalCost≡Σresolver；扣费自洽：Σsettle≡Σintent.creditCost），限定首跑 | 重放分支 `if(!created) continue` 不产生计费——混一条断言必误报 |
| Z19 | **check-int-coverage 改逐文件下限**（资金门 5 spec 各设最低条数），MIN_TOTAL 全局保留更新 | "两个地方一个数"是漂移源；MIN_TOTAL 是下界非红相（v1 表述错误更正） |
| Z20 | **视频定价维度修复**：video 链从 `data.duration` 秒经 `ModelDuration(modelId,seconds)` 解析 durationId 传入 resolver；validation 同键 | seed 实测（seed.ts:159-163）视频规则按 durationId 建键（10/18/25）——现状执行链查 null∧null 零命中=视频实扣 0+预检虚报（G-1 现实撕裂证据）；死亡线用例：video 实扣≡预检 |
| Z21 | **模型键 census**：`pricingInputOf(node)` 单源（imageExtGen 读 `data.extConfig.model`、主流读 `data.model`、null→kind 级）；"EXECUTABLE_TYPES 每成员的模型键位"进 verify 静态断言 | multiImageGen 无模型键/imageExtGen 后端不读 extConfig（实测）——v1 改道后会 PrismaClientValidationError 500；resolver 入口参数校验 4xx（undefined≠500） |
| Z22 | **DI compile smoke**（Test.createTestingModule 编译）进 T7（int 套件+overrideProvider 队列） | `nest build` 不解析 Nest provider 图——循环依赖只在运行时炸 |
| Z23（三轮①） | **`ensureBalance` 唯一钱包创建口**（ON CONFLICT DO NOTHING，`gen_random_uuid()::text` 自带 id）——bootstrap/personal-ledger 兜底/recharge 自愈/admin upsert/createTeam 五路收敛；`lockBalance` 保持纯锁 | v2 的"钱包在建团队同事务必建"与仓内四处**承重懒创建**冲突（实测 2/7 团队无钱包；personal-team-ledger:16 注释自证"bootstrap 失败被吞掉的用户"）；纯锁不收口=注册入口断、收钱入口断 |
| Z24（三轮②） | **money_in 周期事件键**：`${subId}:${periodKey}`（grant-credit 按期发放 1/3/12 期——同 sub.id 每期必撞索引）+ 契约补"可重复事件必须用周期/事件 id 建键"+ **跨期发放用例**（同 sub.id 两期两行成功） | v2 只做了 clear/grant 分键没做实体 id→事件 id——付费订阅从第 2 期起事务回滚+catch 吞掉=永久断供（资损级） |
| Z25（三轮③） | **孤儿巡检三层修正**：`releaseOrphanReserve` 窄口（`skipIntentCheck` 其余纪律保留）+ 谓词收窄 `gi.id IS NULL OR gi.status IN ('FAILED','VOIDED')`（SUCCEEDED 独占归 settleStranded——E53）+ 钱包存在前置（缺失→`ledger_orphan_unreleasable_total` 计数排除）+ **SUCCEEDED 不被释放反例用例** | v2 的 mutate 强校验挡住孤儿释放（自相矛盾必失败）；`status<>'RUNNING'` 含 SUCCEEDED→已交付冻结被退（免费生成） |
| Z26（三轮④） | **准入谓词进 claim 且 `FOR SHARE`**：`SELECT status FROM Team FOR SHARE`（与解散 FOR UPDATE 真互斥）+ 谓词提到分支分派前（rearm 同设防）+ `assertSettled(tx, scope)` 事务内计数 + 删"同事务先置 DISBANDED 再 delete"无效墓碑语句 | 普通 SELECT 不被行锁阻塞——v2 的"持锁检查=窗口关闭"是假陈述；`this.prisma` 在事务外另一连接 |
| Z27（三轮⑤） | **`findByActiveNode(projectId, nodeId, jobId?)`** + fail 侧同限定 | 迟到的失败钩子会 fail 掉同节点新活意图（付费生成静默丢弃）——jobId 是已知可靠归属 |
| Z28（三轮⑥） | **`resolvePricingKey(prisma, node)` 全四键单源**（label→id 归一化禁原值回退）+ `pricingInputOf` 返回 `{modelId, pricingKey}`（node.type→NodeType.key 映射表：`textInput→text/imageGen→image/imageExtGen→imageExt/videoGen→video`，编辑 kind/multiImageGen 同名直通）+ 门禁静态断言 `EXECUTABLE_TYPES ⊆ dom(map)` | `node.type` 与 `NodeType.key` 是两个命名空间（seed 实测 text/image/imageExt/video）；validation/execution 各写一遍解析=两形状分叉复现；前端 `resolution:'2K'` 是 label 非 id（原值回退=静默 400） |
| Z29（三轮⑦） | **主链定价全家进 T1b 迁移 INSERT**（NodeType/AIModel/ModelResolution/ModelDuration/PricingRule 固定 id 常量原样搬——id 本就是 seed 固定值）；门禁改维度矩阵断言（每个 ModelResolution/ModelDuration 一条，**不要求基础行**——前端默认恒带维度）；seed.ts 对应段保留幂等共存、标注"定价真源=迁移" | CI 无 seed 主链空集=门禁空转；seed 无基础行 vs 门禁要求基础行=自相矛盾；固定 id 常量使"迁移时模型不存在"不成立 |
| Z30（三轮⑧） | **客户端字面量同批清理**：`nodeStore` 默认 `model:'sdxl'` 注入删除（面板 `!nodeData?.model` 本就自动选 `list[0].id` 被假默认短路）+ `?? 'sdxl'`/`?? 'hyvideo-v1.5'` 生产兜底删除 + `MODEL_NOT_SELECTED` 显式 4xx + 报价端点与实扣同源（web 补传维度，禁 `.catch(0)` 改"定价不可用"） | fail-closed 把"静默免费+mock 假图"换成"以前能用现在 400"且成因是前端默认值；`.catch(()=>setCreditCost(0))` 是 `?? 0` 的客户端镜像 |
| Z31（三轮⑨） | **audioGen/imageExtGen 裁定选③**：保留白名单，无模型/无规则时 `MODEL_NOT_SELECTED`/`PROVIDER_UNKNOWN_MODEL` 显式 4xx——登记 Y0b-2 音频/imageExt 管线 | 两类型今天实际是死的（audioGen 无 NodeType、imageExt 无模型，跑进错误分支靠 mock 假成功）；补假规则=新垫片；移出白名单牵动前端删除面过大 |
| Z32（三轮⑩） | **admin 写侧守卫**：updateRule/删除"某 (nodeType×model×维度) 最后一条 active 规则"时 409 `PRICING_LAST_ACTIVE_RULE`；**`LedgerTx` 改 `declare const` 品牌形态**；T4/T5 构造器签名写死一致；`register_grant` 键=`register:<teamId>`（userId 是实体 id 违反自身契约+个人团队重建撞全局唯一）；mutate 零额实现 `noop:true` 不写行；reserve `amount===0` 仍过 member 检查；`'pricing-kind-'` 拼写修正；api lint 归属 T0；`$queryRaw` 含 `TeamCreditTransaction` 必含 `teamId` 字符串检查；锁序锚措辞降级"同函数内序不变量"（spec 契约 20 同步）；FILES_MIN 归一 basename；seed.ts 两处自破前提修复（default-team 100 无流水→走 ensureBalance registerGrant；platform-team 无钱包→补零额） | 逐项证据见三份第三轮评审——全部一手核实属实 |
| Z33（四轮①） | **claim 事务化不破坏 P2002 分义**：create 改 `createMany({skipDuplicates:true})`（ON CONFLICT DO NOTHING 不抛错）+ `count===0` 判胜 + **健康事务内**按"本 intentId 是否有行"分义（generation-intent.service.ts:97-107 既有三档语义原样保留）；纪律条款："**禁在 `$transaction` 内 catch 驱动错误后再查**（PG aborted 态——语句报错后事务内任何查询 25P02）"；**并发用例**：同节点双 intentId 并发 claim ⇒ 一 created 一 NodeBusy（非 500）——串行测试永远测不出 | PG 交互式事务一报错即 aborted；既有 catch-P2002-再查是双击互斥唯一实现，"原样入事务"的自然改写（this.prisma→tx）必炸 |
| Z34（四轮②） | **服务器重建=deploy.sh `REBUILD_DB=1` 分支**（独立时序整体废弃）：deploy_api 上传段**之前** `ssh rm -rf $REMOTE_DIR/apps/api/prisma/migrations/*`（tar 解包无删除语义——:172 实测）；cutover ②备份与③之间 DROP SCHEMA（DSN 按 :85 同款 `grep .env` 解析；owner 只读前置核查；DROP 前计数仅日志留档）；pm2 stop **删**——旧码对新 schema fail-closed（claim 缺 teamId 必 500）为设计行为，窗口秒级且 ⓪guard/①/②pg_dump（回退锚）全保留 | 独立时序绕开 guard/backup/upload 三语义（guard 假定应用在线/备份是链上唯一不可逆防线/tar 叠加使"目录已新"不可保证）；"残留目录随 rsync 覆盖对齐"是错误陈述 |
| Z35（四轮③） | **mayCall:false（alreadyReserved）=静默退出零副作用**：warn+新指标 `intent_duplicate_attempt_total`，不 void_/不 fail/不写 exec/不 emit——stall 重排（同 jobId 重入）持有者可能活着，败者终态化会让持有者 complete() CAS 归 0=付费产物被丢；悬挂收敛归 reconcile（其本职）；`RESERVE_GATE_LOST` 才走既有 onReserveFail | "已有人在跑"≠"该终态化"；v2.1 的"不悬挂等 15min"与 F13/reconcile 设计意图相反 |
| Z36（四轮④） | **维度三命名空间根修**：①`normalizeDimensions` 声明参与制——模型无 `ModelResolution`/`ModelDuration` 行 ⇒ 该维度**不参与**（返回 null 不抛错——video 的 `'1080p'` 被忽略、image 的 duration 同理）；②UI 预设认领方案 A——image 面板从 `model.resolutions` 渲染选项（public.service.ts:14 已 `include:{resolutions,durations}` 零 API 改动）+**存行 id**（label 仅显示）+缺省自动选首行（对齐 model `list[0].id` 先例）+nodeStore `resolution:'2K'` 注入删（并入 Z30 清单）；③两条死亡线：客户端真实载荷预检≡实扣 + 门禁选择器可达性（每个维度行 resolve 必成功——"门禁绿∧运行期选不中"不可能同时成立）；G-1 红相表述修正=image/video 实扣 0+text 预检跳过 | UI 存 `'2K'/'1080p'` 预设串（既非 id 也非 label）⇒ 归一化全 4xx；validation `errors>0` 即 `valid:false` ⇒ 单节点维度不可解析阻断整画布；image 今天也是 0 收费（`resolutionId:'2K'` 永不命中） |
| Z37（四轮⑤） | **T1b Step 6 改 `migrate reset --force --skip-seed`**（本地已 seed 库上：seed 的 NodeType 是 cuid id ⇒ 迁移 `ON CONFLICT ("key")` 0 行插入 ⇒ AIModel INSERT 引用 `'node-type-*'` FK 必炸；兼解空表守卫×int 残留自撞）+"迁移→seed 顺序写死"；kind 级 INSERT 5→**4** 键（multiImageGen 并入 Z31 显式 4xx——mock 管线禁定价）；覆盖度门禁**纯表驱动**（删 VIDEO_KEYS/IMAGE_KEYS——有 res 行⇒res 维/有 dur 行⇒dur 维/皆无⇒基础行）；admin 守卫改**覆盖级**（自然键唯一下"最后一条 active"恒真锁死 admin） | 报告3 A2 必然失败+报告2 P0-3 条件失败同根同解；multiImageGen 无模型键走 image 分支靠 MODEL_CONFIG mock 假成功——给它定价=为 mock 产物收费与 Z31 自相矛盾；门禁 SQL 取 `nt.key`（'video'）vs JS 常量 `'videoGen'` 恒不匹配 |
| Z38（四轮⑥） | **settle 早退分支补修补**（`reservedCredits===0∧consumed>0` 时 anti-join 查未冲销 reserve 行，存在则补写 settle 行——reversesId 唯一幂等——CAS 后崩溃洞否则永久告警）；孤儿谓词收窄 **`gi.id IS NULL` only**（FAILED/VOIDED 归 void_/settleStranded 全权处理——quota 回滚随之修复；真丢失情形 quota 无法归因登记残余）；`LedgerRuleError` 的 `TEAM_BALANCE_MISSING`/`CREDIT_LEDGER_NEGATIVE` 转 BusinessException（409/400），TRUTH_TABLE/REVERSAL_* 保持 500；drift① 巡检 LEFT JOIN+COALESCE+两池分列（INNER JOIN 检不出"有钱包有余额零流水"）；unreasable 扫描加龄过滤+ORDER BY；孤儿扫描 partial index 进 T1b | 全部为闭环缺口：CAS-崩溃中间态/孤儿 quota 永久占用/业务条件 500/巡检盲区 |
| Z39（四轮⑦） | 契约 20 全序补 **Team 首环**（`Team → TeamBalance → GenerationIntent → 流水/TeamMember`——claim 的 FOR SHARE 引入新参与者）；FILES_MIN **6** 文件（di-smoke.int.spec.ts 是第 6 个新 int）；G-1/video 死亡线夹具改 seed 固定 id+真实维度（`resolution:null` 在无阶梯模型下必 PRICING_RULE_MISSING）；`Number.isFinite` 守卫（`Number('5s')`=NaN→PG invalid syntax 500）；`planMap.get` 缺失→`PLAN_MISSING` 4xx；register 键 catch 23505 幂等；noop `rowId:null`；扫描锚 raw 分支补 `"TeamBalance"`；B6 死调用删+platform-team.seed 传 ledger+C4 tx timeout+P2-5 owner 核查 | 机械项合集——逐项见三份第四轮评审 |
| Z40（四轮驳回） | resolveExact 多行**保留 500**（不变量破坏=服务端缺陷非用户可行动错误）；A2 的 nodeTypeId 按 key 解析**驳回**（reset 后空库固定 id 成立——对不存在路径的防御违 YAGNI，补偿=顺序写死）；DI smoke **保持 compile**（元数据走查弱于真 DI 解析——循环依赖恰在 compile() 暴露；int 环境 Redis 在位+compile 不触发 onModuleInit）；census **保持 bash diff**（Git Bash 下 /tmp 与 diff 均可用——会话环境即 bash），仅 Step 5 加 `$TEMP` 回退；T1a 空表断言**删**（REBUILD 分支应用在线窗口断言无意义，回退锚=②pg_dump） | 驳回理由均为一手核验 |

**范围外登记（本 plan 明示不做，移交 Y0b-2 同 commit 约束组）**：sv 全链删除+客户端准入门（`isSynced ∧ !hasUnsyncedChanges`）+服务端 pre-call 存在性断言（nodeIds ⊆ allNodes）+权威修订锚（repository 出口 append 水位+STALE_DOC）+heartbeatAt/deadlineAt 列（附 p99.9 标定前置）+api-caller mock 硬失败+admin Idempotency-Key+冻结进钱包（触发条件：巡举报孤儿/重开资金状态机/多阶段计费需求）+$extends 拦截+sweepOrphanExec 懒回收+monthlyUsed 派生化+writeNodeData 耐久判定+int 独立测试库（登记候选）+**audioGen/imageExtGen 模型管线**（Z31——本批只保证显式 4xx）+**multiImageGen 多图管线**（Z37——并入 Z31 处理：不建 kind 规则、KIND_LEVEL_KEYS 移除、resolvePricingKey 显式 MODEL_NOT_SELECTED 4xx）。**产品级登记**：解散团队级联删协作画布的"归档→清理"两阶段语义（本批不做，Y0b-3 产品决策）；`TeamRechargeOrder.teamId` 去 FK 后"订单挂已删团队"的按 teamId join 对账路径取不到团队（订单归属=历史事实，runbook 登记）。**残余登记（四轮）**：①`assertSettled` 在 project.service delete/cleanDrafts/template.service 三处传 `this.prisma`（无锁）——删项目与 claim 间仍有读后写窗口（新意图挂已删项目→孤儿→reconcile 收敛兜底；团队解散侧已被 FOR UPDATE/FOR SHARE 覆盖）；②孤儿 reserve 真丢失情形（意图行已灭失）的 monthlyUsed 无法归因回滚（登记监控，不可回收既知状态）。

---

## 0.5 基线快照（2026-10-09 一手核验；行号以 master=1121f548 为准）

| 位置 | 现状 | 消费 Task |
|------|------|-----------|
| `execution.service.ts:64` | execute 签名含 `sv?: Uint8Array`（**保留不动**——Z14）；:84-88 nodeIds filter 静默不匹配 | T3（仅 plans 消费面） |
| `execution.service.ts:144-147/:212-215/:287-294` | pricingRule.findFirst 三处+`?? 0`（text/video/image 链） | T2 |
| `execution.service.ts:148/:216/:296` | reserve 被 `if(cost>0)` 包裹（T4 改单源后保留 reserve 只做钱语义） | T3/T4 |
| `generation-intent.service.ts:50-111` | claim 五分支状态机；create 分支 `data: {...input, jobId, status:'RUNNING'}`——plan 固化扩展点 | T3 |
| `team-credit.service.ts:58-159` | reserve 四守卫+乐观 version 重试环（:98-153 MAX_RETRIES=3——T4 删改 FOR UPDATE） | T4 |
| `team-credit.service.ts:136` | `referenceId='intent:'+guard.intentId`（客户端可控——F1 串账根） | T4 |
| `team-credit.service.ts:90-94` | `alreadyReserved:true` 被三调用点当"可外呼"许可（H7 双外呼洞） | T4 |
| `intent-reconcile.service.ts:133-135` | chargeRows 无 amount/reversesId 过滤；type 含 'consumption'（T1a 随枚举删） | T1a/T5 |
| `intent-reconcile.service.ts:162-199/:203-240` | unfreeze CAS 缺 `reservedCredits:{gt:0}`；两事务首句=GenerationIntent CAS（GI→TB 同序——Z13 证据） | T4 |
| `intent-reconcile.service.ts:261-263` | 7 天清理不看 reservedCredits（F7） | T5 |
| `schema.prisma:978-1002` | GenerationIntent 无 teamId/定价快照列 | T1b |
| `schema.prisma:631-643` | TeamCreditTransactionType 11 值无 release、含死值 consumption | T1a |
| `schema.prisma:720-734` | TeamCreditTransaction：teamId String? SetNull FK、无两列真值/seq/reversesId | T1a/T1b |
| `schema.prisma:262` | PricingRule 假 `@@unique` 四列含两可空 | T1a（删）/T1b（真唯一索引） |
| `schema.prisma:251` | PricingRule.modelId NOT NULL | T1a（改可空） |
| `seed.ts:159-163` | 视频规则按 durationId 建键（5s=10/10s=18/15s=25）——Z20 证据 | T2 |
| `public.service.ts:23-33` | 第十处 `findFirst+?? 0`（用户可见报价端点）——v1 漏算 | T2 |
| `admin/pricing/pricing.service.ts:42-63/:65-75` | batchCreate upsert 可空列退化 create；calculatePrice `?? 0` | T2 |
| `validation.service.ts:35` | textInput continue 跳过定价（G-1 红相）；:46-52 查询不带 durationId（video 预检虚报） | T2/T3 |
| `ai-image-edit.constants.ts:3` | `CREDIT_COST_PER_EDIT=1` 编译期旁路（实扣 processor:112-114+lighting.consumer:130-132、预检 lighting.service:86-92） | T2 |
| `is-executable-node.ts:1` | 白名单含 imageExtGen（模型在 `data.extConfig.model` 后端不读）/multiImageGen（无模型键）——Z21 | T2 |
| `api-caller.service.ts:53-72` | MODEL_CONFIG 三模型硬编码（测试密钥——project_test_keys_ruling 裁定勿升级） | T2（注记） |
| `team.service.ts:395-440` | disbandTeam 二事务：:426 置空流水 teamId（T1a 随 NOT NULL 强制删）+:428 team.delete 级联 | T1a/T6 |
| `team.guard.ts:43`+`team.util.ts:37` | DISBANDED tombstone 已全仓通行（准入谓词先例） | T6 |
| `payment-success.processor.ts:42-52` | 订单 CAS 同事务（updateMany where PENDING+count===0 return）——Z9 三支付 CAS 证据（另两处 team-subscription:110-114/team-recharge:169-178 同构） | T4（明文保留） |
| `personal-team-ledger.ts:26-46/:64-91` | clear/grant 共用 referenceId 参数（Z9 前置修复） | T4 |
| `admin-subscription.service.ts:62-84` | 无事务+referenceId=sub.id（按月重复发放合法——不进幂等键） | T4 |
| `team-subscription.service.ts:147-157` | expire_clear 无 referenceId+expireSubscriptions CAS 返回值不检查（Z9 缺口②③） | T4 |
| `team.controller.ts:46-58` | 用户侧台账展示读整行含 amount（Z8 证据） | — |
| 账户域写点（全量核验） | 唯一无事务=admin-subscription:62-84；其余事务内：team-subscription:76/:89/:147、team-recharge:152-167、team.bootstrap:25-31、personal-team-ledger、grant-credit.processor:42-53、payment-success.processor:118-121 | T4 |
| 9 条 partial unique+1 序列+1 约束+1 种子行 | 只活在迁移 SQL 不在 schema.prisma：`team_owner_default_unique`/`folder_team_{root,parent}_name_unique`×2/`material_folder_team_{root,parent}_name_unique`×2/`user_subscription_one_active`/`team_subscription_one_active`/`announcement_single_active`/`generation_intent_active_node_unique`（claim P2002 分义依据 generation-intent.service.ts:33-36 直依赖）+`canvas_doc_update_seq` 序列（append nextval——协作写命脉）+`CanvasDocUpdate_projectId_seq_key`（约束形态）+CollabLease 种子行 | T1a（census 搬运清单） |
| `scripts/check-migration-additive.mjs:13-20` | BASELINE='20261007170319_lease_collab_audit'=最大目录⇒fresh 集合**永空（空转病）**；BREAKING 正则不含 DROP TYPE/TRUNCATE/DROP NOT NULL；**不在 verify/CI**（只 deploy.sh:67/:88） | T1a |
| `scripts/check-int-coverage.mjs:15` | MIN_TOTAL=26（下界；不在 verify 链） | T7 |
| `collab-contract-guards.spec.ts:37-39` | 契约 10：repository 外生产文件零 `/stateSeq/`（Z7 docStateSeq 必红证据） | — |
| `.github/workflows/ci.yml:48-50` | migrate deploy→pnpm verify 之间无 seed（Z16 CI 必红证据） | T1b/T2 |
| `apps/api/package.json` | `"prisma":{"seed":"tsx prisma/seed.ts"}`；根 package.json verify 链=...verify-indexes→check-ecosystem→node --test（api lint 不在——Z12） | T0/T1a/T7 |

---

## Task 0: Y0b-0 spec 一致性机械门禁（微修版——先于一切，先把 spec 自身清干净）

**Files:**
- Create: `scripts/check-spec-consistency.mjs`、`scripts/check-spec-consistency.test.mjs`
- Modify: `docs/superpowers/specs/2026-10-08-y0b-funds-and-access-design.md`（文末追加 §10 机械规范块）、根 `package.json`（verify 链尾追加）

- [ ] **Step 1: 写 node:test 夹具（纯函数先行——"坏夹具必非零"）**

```js
// scripts/check-spec-consistency.test.mjs —— Y0b-0（spec §9.22，v2 微修 Z15）：一致性门禁纯函数自测
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripForDenylist, extractEnvKeys, parseFencedBlock, collectMetricFiles, DENYLIST } from './check-spec-consistency.mjs';

test('P7 三层剥离：HTML 注释/fenced 块/全角括号——代码型 token 合法提及不命中，正文命中', () => {
  const spec = [
    '<!-- doc-status: v2.4 ... release_once 残留清扫 ... -->',
    '## 1.1 迁移',
    '历史：`release_once`（v2.2 删除——冗余（嵌套（再嵌套）））。',
    '```yaml',
    'release_once: 已退役',
    '```',
    '正文规范句：禁用 replay_kill。',
  ].join('\n');
  const stripped = stripForDenylist(spec);
  const hits = DENYLIST.filter((d) => stripped.includes(d));
  assert.deepEqual(hits, ['replay_kill']);   // 注释/fenced/（）内全剥；正文命中且仅命中
});
test('extractEnvKeys：envSchema 块内两空格缩进键全提取、块外不取', () => {
  const src = [
    "export const envSchema = z.object({",
    "  DATABASE_URL: z.string().url(),",
    "  PORT: z.coerce.number().default(3000),",
    "});",
    "const NOT_A_KEY: z.string();",
  ].join('\n');
  assert.deepEqual(extractEnvKeys(src), ['DATABASE_URL', 'PORT']);
});
test('parseFencedBlock：标记后取第一 fenced 块内 `- key` 行；无标记/无块返回 null', () => {
  const md = '<!-- y0b0:env-keys -->\n```yaml\n- A\n- B\n```\n';
  assert.deepEqual(parseFencedBlock(md, 'y0b0:env-keys'), ['A', 'B']);
  assert.equal(parseFencedBlock(md, 'y0b0:missing'), null);
  assert.equal(parseFencedBlock('<!-- y0b0:x -->\n无围栏', 'y0b0:x'), null);
});
test('collectMetricFiles：glob **/*.metrics.ts 递归收集（含 video-separate——v1 硬编码 3 文件漏它）', () => {
  const files = collectMetricFiles();
  assert.ok(files.some((f) => f.endsWith('video-separate.metrics.ts')), 'video-separate 必须被 glob 收集');
  assert.ok(files.some((f) => f.endsWith('store.metrics.ts')));
});
```

- [ ] **Step 2: 跑红**——`node --test scripts/check-spec-consistency.test.mjs` 预期 FAIL（模块不存在）。

- [ ] **Step 3: 实现 check-spec-consistency.mjs（v2 微修形态）**

```js
#!/usr/bin/env node
// Y0b-0（spec §9.22，v2 微修 Z15）：spec↔code 单向一致性门禁。code 为源——spec 内
// <!-- y0b0:domain --> 标记的单一 fenced 规范块必须与 code 提取集逐项相等。
// v2 终裁：①指标域 glob 化（v1 硬编码 3 文件漏 video-separate.metrics.ts——实测 4 个）；
// ②denylist 收窄为代码型 token（自然语言短语项删——spec:572 forceSyncInterval…COLLAB_TIMEOUT
// 实测命中=误报例证，门禁会被误报训练绕过）；③env 域保留。
// 域（P6 收窄）：env-keys / metric-names。退出码：0=PASS；1=门禁违规；2=结构性错误（doc-gate.mjs 先例）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SPEC_PATH = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'docs/superpowers/specs/2026-10-08-y0b-funds-and-access-design.md');

export function collectMetricFiles() {
  const base = path.join(ROOT, 'apps/api/src');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.metrics.ts') ? [p] : [];
  });
  return walk(base).sort();
}

// 仅代码型 token——退役机制的标识符（可 grep 到 code/迁移历史），非自然语言短语
export const DENYLIST = ['release_once', 'COLLAB_RSS_SOFT_LIMIT_BYTES', 'replay_kill'];

export function stripForDenylist(text) {
  let t = text.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/```[\s\S]*?```/g, '');
  let prev;
  do { prev = t; t = t.replace(/（[^（）]*）/g, ''); } while (t !== prev);
  return t;
}

export function extractEnvKeys(envSrc) {
  const m = envSrc.match(/envSchema\s*=\s*z\.object\(\{([\s\S]*?)\n\}\)/);
  if (!m) return null;
  return [...m[1].matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((x) => x[1]).sort();
}

export function extractMetricNames(src) {
  return [...src.matchAll(/name:\s*'([a-z0-9_]+)'/g)].map((x) => x[1]).sort();
}

export function parseFencedBlock(md, marker) {
  const i = md.indexOf(`<!-- ${marker} -->`);
  if (i < 0) return null;
  const m = md.slice(i).match(/```[a-z]*\n([\s\S]*?)```/);
  if (!m) return null;
  return m[1].split('\n').map((l) => l.replace(/^- /, '').trim()).filter(Boolean);
}

const problems = [];
const structural = (m) => { console.error(`check-spec-consistency: 结构性错误（exit 2）——${m}`); process.exit(2); };

const spec = fs.readFileSync(SPEC_PATH, 'utf8');
const stripped = stripForDenylist(spec);
for (const d of DENYLIST) {
  if (stripped.includes(d)) {
    const line = stripped.split('\n').findIndex((l) => l.includes(d));
    problems.push(`退役标识符 "${d}" 命中正文（剥离后第 ${line + 1} 行）——该机制已退役，勿在规范正文复述（合法提及请置于（）历史注记或围栏内）`);
  }
}
const envSrc = fs.readFileSync(path.join(ROOT, 'apps/api/src/config/env.ts'), 'utf8');
const envKeys = extractEnvKeys(envSrc) ?? structural('env.ts 无法提取 envSchema 键集');
const specEnv = parseFencedBlock(spec, 'y0b0:env-keys') ?? structural('spec 缺 <!-- y0b0:env-keys --> fenced 块');
const envMissing = envKeys.filter((k) => !specEnv.includes(k));
const envStale = specEnv.filter((k) => !envKeys.includes(k));
if (envMissing.length) problems.push(`env 键未进 spec §10 块: ${envMissing.join(', ')}`);
if (envStale.length) problems.push(`spec §10 块含已删 env 键: ${envStale.join(', ')}`);
const metricFiles = collectMetricFiles();
const metricNames = extractMetricNames(metricFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n'));
const specMetrics = parseFencedBlock(spec, 'y0b0:metric-names') ?? structural('spec 缺 <!-- y0b0:metric-names --> fenced 块');
const mMissing = metricNames.filter((k) => !specMetrics.includes(k));
const mStale = specMetrics.filter((k) => !metricNames.includes(k));
if (mMissing.length) problems.push(`指标未进 spec §10 块: ${mMissing.join(', ')}`);
if (mStale.length) problems.push(`spec §10 块含已删指标: ${mStale.join(', ')}`);

if (problems.length) { console.error(`check-spec-consistency FAIL:\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log(`check-spec-consistency OK: denylist ${DENYLIST.length} 项零命中；env-keys ${envKeys.length} 键 ≡ spec；metric-names ${metricNames.length} 项（${metricFiles.length} 文件）≡ spec`);
```

- [ ] **Step 4: 夹具绿 + 生成 spec §10 块（提取产物粘贴——禁手抄）**

```bash
node --test scripts/check-spec-consistency.test.mjs          # 预期 4 测全绿
node -e "const fs=require('fs');const src=fs.readFileSync('apps/api/src/config/env.ts','utf8');const m=src.match(/envSchema\s*=\s*z\.object\(\{([\s\S]*?)\n\}\)/);const keys=[...m[1].matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map(x=>x[1]).sort();console.log(keys.map(k=>'- '+k).join('\n'))"
node -e "const fs=require('fs'),path=require('path');const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>{const p=path.join(d,e.name);return e.isDirectory()?walk(p):(e.name.endsWith('.metrics.ts')?[p]:[])});const files=walk('apps/api/src').sort();const src=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');console.log([...src.matchAll(/name:\s*'([a-z0-9_]+)'/g)].map(x=>'- '+x[1]).sort().join('\n'))"
```

spec 文末追加（两段命令输出原样粘贴进对应围栏）：

````markdown
---

## 10. 机械规范块（Y0b-0——check-spec-consistency 比对源；code 为源，块随 code 同 commit 变更）

<!-- y0b0:env-keys -->
```yaml
（粘贴 env 键清单输出）
```

<!-- y0b0:metric-names -->
```yaml
（粘贴指标名清单输出）
```
````

- [ ] **Step 5: 对真 spec 跑门禁+denylist 红探针（临时副本——禁改仓内文件）**

```bash
node scripts/check-spec-consistency.mjs    # 预期 OK（v2 denylist 已收窄——若仍红：该标识符按报错行移入（）历史注记或围栏）
cp docs/superpowers/specs/2026-10-08-y0b-funds-and-access-design.md "$TEMP/y0b0-probe.md" 2>/dev/null || cp docs/superpowers/specs/2026-10-08-y0b-funds-and-access-design.md /tmp/y0b0-probe.md
printf '\nxxx release_once yyy\n' >> "$TEMP/y0b0-probe.md" 2>/dev/null || printf '\nxxx release_once yyy\n' >> /tmp/y0b0-probe.md
node scripts/check-spec-consistency.mjs "$TEMP/y0b0-probe.md" 2>/dev/null || node scripts/check-spec-consistency.mjs /tmp/y0b0-probe.md ; echo exit=$?    # 预期 exit=1
rm -f "$TEMP/y0b0-probe.md" 2>/dev/null; rm -f /tmp/y0b0-probe.md
node scripts/check-spec-consistency.mjs    # 复绿（仓内 spec 零改动）
```

- [ ] **Step 6: verify 挂链（含 api lint 归属——Z32）+ Commit**

根 package.json `verify` 链在 `node --test "scripts/**/*.test.mjs"` 之前追加 `&& node scripts/check-spec-consistency.mjs`；同 Step 把 `pnpm --filter @flowweb/api exec eslint "{src,test}/**/*.ts"` 提进 verify 链尾（现只在 CI ci.yml:52——f2e14241 先例：本地 verify 不含 api lint 故未拦）。**若提进后暴露既有 eslint 报错：本 Step 内清干净（不计入其他 Task）**。

```bash
git add scripts/check-spec-consistency.mjs scripts/check-spec-consistency.test.mjs docs/superpowers/specs/2026-10-08-y0b-funds-and-access-design.md package.json
git commit -m "feat(gate): Y0b-0 spec 一致性门禁（v2 微修）——glob 指标域（4 metrics 文件）+denylist 收窄代码型 token+env 域；spec §10 块（提取产物粘贴）；红探针留档"
```

---

## Task 1a: 基线重置（24→1 init——只能靠重建实现的变更在此消化；census 自证）

**Files:**
- Create: `scripts/dump-schema-objects.mjs`（census 工具）、`apps/api/prisma/migrations/20261010XXXXXX_init/migration.sql`（XXXXXX=执行日本地时间——保持字典序最大）、`apps/api/scripts/rebuild-db.mjs`（四轮 Z34——服务器 REBUILD 分支的清库脚本，随 deploy.sh :174 tar 上传）
- Delete: 既有 24 个迁移目录（保留 `migration_lock.toml`）
- Modify: `apps/api/prisma/schema.prisma`（enum 终态/假唯一删/两处去 FK 改 NOT NULL/modelId 可空）、`scripts/check-migration-additive.mjs`（BASELINE 上移+补盲区+进 verify）、`apps/api/prisma/verify-indexes.sql`（census 对象定义断言）、`deploy.sh`（四轮 Z34——`--rebuild-db` 旗标+两处分支）、`apps/api/src/modules/execution/intent-reconcile.service.ts`（'consumption' 引用清）、`apps/api/src/modules/execution/intent-reconcile.service.spec.ts`（夹具同步）、`apps/api/src/modules/team/team.service.ts`（:426 置空语句删——NOT NULL 强制连带）、`apps/api/src/modules/team/team.service.spec.ts`（三轮 P1-12——断言置空行为的既有用例同批删/改）、`docs/superpowers/deployment-db-baseline.md`、根 `package.json`（additive 进 verify）、`apps/api/src/modules/execution/team-credit.service.ts`（若 TS 类型因枚举删值报错的最小修复）

- [ ] **Step 0: 只读探针——census 搬运清单实测落档（12 类对象）**

```bash
cd apps/api && npx tsx -e "
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
const p = new PrismaClient();
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const idx = await c.query(\"SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND indexdef LIKE '%WHERE%' ORDER BY indexname\");
  const seq = await c.query(\"SELECT relname FROM pg_class WHERE relkind='S' AND relnamespace='public'::regnamespace ORDER BY relname\");
  const con = await c.query(\"SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='u' ORDER BY conname\");
  const lease = await p.collabLease.count();
  const ver = await c.query('SHOW server_version');
  console.log(JSON.stringify({ partialIndexes: idx.rows, sequences: seq.rows.map(r=>r.relname), uniqueConstraints: con.rows, collabLeaseRows: lease, pg: ver.rows[0].server_version }, null, 1));
  await c.end(); await p.\$disconnect();
})();" ; cd ../..
```

判读：partial 索引应含 9 条（§0.5 清单）；序列应含 `canvas_doc_update_seq`；约束形态唯一应含 `CanvasDocUpdate_projectId_seq_key`；CollabLease≥1 行；PG≥15。**输出粘 commit message——Step 5 搬运以实测为准。**

- [ ] **Step 1: schema.prisma 终态化编辑（四处——全部是"增量实现=DROP/重建=BREAKING"类）**

1. enum `TeamCreditTransactionType`：删 `consumption` 行、加 `release` 行（其余 10 值不动；`upgrade_clear` 等有写者的保留）。
2. `PricingRule`：删 `@@unique([nodeTypeId, modelId, resolutionId, durationId])` 行（假唯一——真唯一索引 T1b 落）；`modelId String` 改 `modelId String?`（Z5——kind 级规则 `modelId IS NULL`；需同步删与 AIModel 的 relation 或改可选：`model AIModel? @relation(fields:[modelId], references:[id])`）。
3. `TeamCreditTransaction`：`teamId String?` 改 `teamId String`；删 `team Team? @relation(...)` 行（去 FK——Z4）。
4. `TeamRechargeOrder`：`teamId` 若为 relation FK 则同 3 处理（去 relation 改纯 NOT NULL 列）。

- [ ] **Step 2: 'consumption' 代码引用清除（编译 fail-closed——enum 删值后 Prisma client 类型不含它）**

`intent-reconcile.service.ts` 三处：`:134` `type: { in: ['reserve', 'settle', 'consumption'] }` → `['reserve', 'settle']`；`:147` 与 `:252` 同款（以 grep 实测为准）：

```bash
grep -rn "'consumption'" apps/api/src --include="*.ts"    # 逐处改：查询过滤删该值；spec 夹具同步；schema 枚举已删
```

- [ ] **Step 3: team.service.ts:426 置空语句删（NOT NULL 强制连带）**

```ts
// 删除该行（TeamCreditTransaction.teamId 已 NOT NULL——置 null 必 SQL 报错；Z4：台账行永不 UPDATE，append-only）：
// await tx.teamCreditTransaction.updateMany({ where: { teamId }, data: { teamId: null } });
```

（二事务结构与 team.delete 级联保留不动——T6 再单事务化；TeamRechargeOrder 若存在同款置空/级联语义语句则一并删。）

- [ ] **Step 4: 生成 init 骨架 + 手工搬运 raw 段**

```bash
cd apps/api
mkdir -p prisma/migrations/20261010XXXXXX_init   # XXXXXX=执行日时间，保证字典序最大
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261010XXXXXX_init/migration.sql
```

在生成文件**末尾**追加 raw 段（从 Step 0 探针实测的 indexdef 反查旧迁移源文件搬运；Prisma 表达不了这 12 类对象）：

```sql
-- ====== 以下为 Prisma diff 不可见的 raw 对象（census 搬运——来源旧迁移，实测定义粘自 Step 0） ======
-- 1. append 序列（协作写命脉——丢=每次 nextval 抛错）
CREATE SEQUENCE IF NOT EXISTS "canvas_doc_update_seq";   -- 以旧 20260828044715:63 实测语句为准（含 START/OWNED BY 则原样搬）

-- 2. 九条 partial unique 索引（旧迁移逐条搬运——以下为清单，执行时粘实测 indexdef 的 CREATE 形态）
-- team_owner_default_unique / folder_team_root_name_unique / folder_team_parent_name_unique /
-- material_folder_team_root_name_unique / material_folder_team_parent_name_unique /
-- user_subscription_one_active / team_subscription_one_active / announcement_single_active /
-- generation_intent_active_node_unique（claim P2002 分义依据——generation-intent.service.ts:33-36 直依赖）

-- 3. 约束形态唯一（pg_constraint 口径——verify-indexes 块按约束断言；勿改建索引形态）
-- CanvasDocUpdate_projectId_seq_key（来源旧 20261006120655:20）

-- 4. CollabLease 种子行（来源旧 20261006120655:23——ON CONFLICT DO NOTHING 幂等形态搬运）
```

- [ ] **Step 5: census 自证（旧侧=现有 dev 库，新侧=临时库重放新 init——对象级双向比对，白名单外零差）**

新建 `scripts/dump-schema-objects.mjs`（三轮评审修订：**node/pg 化**——psql 不在 PATH；**dump 扩全量四组**——partial/唯一约束限定 dump 对"普通索引/FK/列可空性"失明，T1a 四项变更中三项会不可见=假绿换位复现；**旧侧直接用现有 dev 库**——它本就是旧 24 迁移的终态，免重放免删除互斥）：

```js
#!/usr/bin/env node
// Y0b-1 T1a（Z2+三轮⑤）：squash census 工具。两模式：
//   node scripts/dump-schema-objects.mjs <URL>                          —— dump 指定库全量对象清单（stdout JSON）
//   node scripts/dump-schema-objects.mjs <URL> --replay-new <init.sql>  —— 建临时库 flowweb_census_new 重放 init 后 dump（stdout JSON，完毕即删临时库）
// 全量四组：columns（is_nullable/column_default）/constraints（全部 contype 含 FK）/indexes（全集 indexdef）/enums（全量）+ CollabLease 行数。
// 这是 squash 的唯一可信验收：Prisma migrate diff 不建模序列/partial WHERE/约束形态——"零差异"是假绿。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { Client } = createRequire(path.join(ROOT, 'apps/api/package.json'))('pg');   // 根 node_modules 无 pg——verify-indexes.mjs:22-23 同款理由

async function dump(client) {
  const q = async (sql) => (await client.query(sql)).rows;
  return {
    columns: await q(`SELECT table_name, column_name, is_nullable, data_type, column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name NOT LIKE '\_prisma%' ORDER BY table_name, column_name`),
    constraints: await q(`SELECT conname, contype, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE connamespace='public'::regnamespace ORDER BY conname`),
    indexes: await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY indexname`),
    sequences: await q(`SELECT relname FROM pg_class WHERE relkind='S' AND relnamespace='public'::regnamespace ORDER BY relname`).then((r) => r.map((x) => x.relname)),
    enums: await q(`SELECT t.typname, ARRAY_AGG(e.enumlabel ORDER BY e.enumsortorder) AS values FROM pg_type t
      JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typnamespace='public'::regnamespace GROUP BY t.typname ORDER BY t.typname`),
    collabLeaseRows: (await q('SELECT COUNT(*)::int AS n FROM "CollabLease"'))[0].n,
  };
}

const [url, mode, initPath] = [process.argv[2], process.argv[3], process.argv[4]];
if (!url || (mode === '--replay-new' && !initPath)) {
  console.error('usage: dump-schema-objects.mjs <URL> [--replay-new <init.sql>]'); process.exit(2);
}
if (mode !== '--replay-new') {
  const c = new Client({ connectionString: url });
  await c.connect();
  console.log(JSON.stringify(await dump(c), null, 1));
  await c.end();
} else {
  // admin 连接（postgres 库）建/删临时库——CREATE DATABASE 不能在事务内，独立连接执行
  const admin = new URL(url); admin.pathname = '/postgres';
  const ac = new Client({ connectionString: admin.toString() });
  await ac.connect();
  await ac.query('DROP DATABASE IF EXISTS flowweb_census_new');
  await ac.query('CREATE DATABASE flowweb_census_new');
  const nc = new Client({ connectionString: new URL(url).toString().replace(/\/[^/]*$/, '/flowweb_census_new') });
  await nc.connect();
  await nc.query(fs.readFileSync(initPath, 'utf8'));   // client.query 支持多语句脚本
  console.log(JSON.stringify(await dump(nc), null, 1));
  await nc.end();
  await ac.query('DROP DATABASE flowweb_census_new');
  await ac.end();
}
```

比对流程（**全程 node 零 psql**；`TMPD` 兼容回退——Z40：Git Bash 下 /tmp 可用，非 bash 环境落 $TEMP）：

```bash
# ① 旧侧：现有 dev 库（旧链终态——_prisma_migrations 24 行即该链；含开发数据不影响 schema 组比对）
TMPD="${TMPDIR:-/tmp}"
node scripts/dump-schema-objects.mjs "$DATABASE_URL" > "$TMPD/census-old.json"
# ② 新侧：临时库重放新 init（脚本自建自删）
node scripts/dump-schema-objects.mjs "$DATABASE_URL" --replay-new apps/api/prisma/migrations/20261010XXXXXX_init/migration.sql > "$TMPD/census-new.json"
# ③ 双向比对
diff "$TMPD/census-old.json" "$TMPD/census-new.json" ; echo exit=$?
```

**预期：差异仅限白名单（按对象名+方向列举，禁按类别；白名单只列语义差异——枚举值集内容差，非顺序噪声：dump 已 `ORDER BY enumsortorder` 确定性，顺序差=真实回归不豁免）**——①`enums.TeamCreditTransactionType.values`：old 多 `consumption`/new 多 `release`；②`indexes`：old 多 `PricingRule_nodeTypeId_modelId_resolutionId_durationId_key`（假唯一删）；③`constraints`：old 多 `TeamCreditTransaction_teamId_fkey`+`TeamRechargeOrder_teamId_fkey`（去 FK）；④`columns`：`TeamCreditTransaction.teamId`+`TeamRechargeOrder.teamId` 的 `is_nullable YES→NO`、`PricingRule.modelId` 的 `NO→YES`；⑤`collabLeaseRows` 两侧均 ≥1（init 搬运了种子行）。**任何白名单外差异=搬运遗漏或 dev 库手工 DDL 污染——人工判读后回 Step 4 补齐重跑。两态输出粘 commit message。**

- [ ] **Step 5.5: 删除旧迁移目录（census 通过后、reset 之前——步骤序钉死，三轮 H1）**

```bash
git rm -r $(ls -d apps/api/prisma/migrations/*/ | grep -v 20261010XXXXXX_init)
ls apps/api/prisma/migrations/    # 预期：仅 20261010XXXXXX_init/ 与 migration_lock.toml（git rm 不含散文件）
```

- [ ] **Step 6: verify-indexes 定义断言（census 对象进永久门禁——存在性+定义双断言）**

`apps/api/prisma/verify-indexes.sql` 文末追加（每块空行分隔——runner 按块断言 ≥1 行；`SELECT 'ok' WHERE NOT EXISTS` 负断言形态保持块非空）：

```sql
-- Y0b-1 T1a（Z2）：census 对象定义断言——存在性+定义（防被重建为普通索引/序列静默丢失）
SELECT indexdef FROM pg_indexes WHERE indexname='generation_intent_active_node_unique' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='team_owner_default_unique' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='user_subscription_one_active' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='team_subscription_one_active' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='announcement_single_active' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='folder_team_root_name_unique' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='folder_team_parent_name_unique' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='material_folder_team_root_name_unique' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='material_folder_team_parent_name_unique' AND indexdef LIKE '%WHERE%';

SELECT 'seq-ok' AS assert WHERE EXISTS (SELECT 1 FROM pg_class WHERE relkind='S' AND relname='canvas_doc_update_seq');

SELECT conname FROM pg_constraint WHERE conname='CanvasDocUpdate_projectId_seq_key';

SELECT COUNT(*) AS n FROM "CollabLease" HAVING COUNT(*) >= 1;

SELECT 'fake-pricing-unique-gone' AS assert WHERE NOT EXISTS (
  SELECT 1 FROM pg_indexes WHERE indexname='PricingRule_nodeTypeId_modelId_resolutionId_durationId_key'
);

SELECT 'consumption-gone' AS assert WHERE NOT EXISTS (
  SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
  WHERE t.typname='TeamCreditTransactionType' AND e.enumlabel='consumption'
);

SELECT 'release-in-enum' AS assert WHERE EXISTS (
  SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
  WHERE t.typname='TeamCreditTransactionType' AND e.enumlabel='release'
);
```

- [ ] **Step 7: additive 门禁更新（BASELINE 上移+补盲区+进 verify）**

`scripts/check-migration-additive.mjs`：
1. `BASELINE = '20261010XXXXXX_init'`（**必须替换为实际目录名**——`XXXXXX` 占位符直接保留会被存在性断言拦下 exit 1；`:17` 附近的 `dirs.includes(BASELINE)` 断言即为此设）。
2. BREAKING 正则补三类（现盲区）：`DROP\s+TYPE`、`TRUNCATE`、`DROP\s+NOT\s+NULL`（并入既有正则数组——以文件实测结构为准）。

根 package.json `verify` 链 `verify-indexes` 之后追加 `&& node scripts/check-migration-additive.mjs`（现只在 deploy.sh:67/:88——CI 全程看不见，Z12）。

- [ ] **Step 8: 【告知用户】本地库重建 + 全量回归（前置断言防旧目录残留，三轮 H1）**

```bash
# 前置断言：旧目录已删（Step 5.5）——残留则 reset 会重放旧链与新 init 双建表必炸
ls apps/api/prisma/migrations/ | grep -v 20261010 | grep -v migration_lock ; echo residual=$?    # 预期 residual=1（零残留）
# 本地 dev 库数据全清（备份按 backup_methodology 记忆自行决定是否先 pg_dump）——【告知用户点】
cd apps/api && npx prisma migrate reset --force --skip-seed    # drop+recreate+新 init deploy 一步到位
npx prisma migrate status                                       # 预期：1 migration found, up to date
pnpm exec tsx prisma/seed.ts                                    # 开发数据（default-team/用户——定价真源已进迁移 Z29，seed 幂等共存）
npx vitest run -c vitest.int.config.ts                          # 既有 int 全绿（append.int 真跑 nextval——丢序列即红）
npx vitest run && npx tsc --noEmit ; cd ../..
node scripts/verify-indexes.mjs && node scripts/check-migration-additive.mjs
pnpm verify                                                     # 全绿
```

- [ ] **Step 9: 文档更新 + Commit**

`docs/superpowers/deployment-db-baseline.md` 更新：新基线目录名/commit、本地与服务器清库流程（Z3）、census 白名单差异四类、9 索引+序列+约束+种子行清单备注；跑 `node scripts/doc-gate.mjs --write-canonical`（该文档是 canonical——头部 verified_at 与 canonical.json 会漂移报红）。

```bash
git add -A apps/api/prisma/ scripts/ apps/api/src/ docs/superpowers/deployment-db-baseline.md package.json docs/_meta/
git commit -m "feat(funds): Y0b-1 T1a 基线重置——24→1 init（enum 终态删 consumption 加 release/假唯一删/两处 teamId 去 FK NOT NULL/modelId 可空）+12 类 raw 对象 census 搬运+dump-schema-objects 双向比对自证（白名单四类差异外零差）+verify-indexes 定义断言 14 块+additive BASELINE 上移补盲区进 verify+'consumption' 引用清+置空语句删；本地库重建全绿（探针输出与 census 两态在案）"
```

- [ ] **Step 10: 【告知用户】服务器 dev 库重建=deploy.sh `--rebuild-db` 分支（四轮 Z34——独立时序废弃；runbook 登记，T8 呈报）**

先落码两件（与既有 `&&` 链/set -e 语义一致——分支内失败即中止；⓪guard/①/②pg_dump 全保留）。

`deploy.sh` 改动三处——①旗标解析（:19-29 区域）加 `--rebuild-db) REBUILD_DB=1`（默认 0）；②deploy_api 上传段（:164 `echo "=== 上传…"` 之前）加：

```bash
if [[ "$REBUILD_DB" == "1" ]]; then
  echo "=== REBUILD_DB：清远端迁移目录（tar 解包无删除语义——:172 实测；不清=旧 24 目录字典序先跑，新 init 的 CREATE TYPE already exists 必炸） ==="
  ssh -i "$KEY" "$SERVER" 'rm -rf '"$REMOTE_DIR"'/apps/api/prisma/migrations/* && [ -z "$(ls '"$REMOTE_DIR"'/apps/api/prisma/migrations/ 2>/dev/null)" ] || { echo "清理后仍有残留"; exit 1; }'
fi
```

③cutover_api 的 ②备份（:85）与 ③迁移（:88）之间加：

```bash
if [[ "$REBUILD_DB" == "1" ]]; then
  echo "=== REBUILD_DB：DROP SCHEMA 重建（回退锚=上方②pg_dump；owner 前置核查；DROP 前计数仅日志留档——应用在线窗口断言无意义） ==="
  ssh -i "$KEY" "$SERVER" 'DSN=$(grep -m1 "^DATABASE_URL=" '"$REMOTE_DIR"'/apps/api/.env | cut -d= -f2- | tr -d "\"" | sed "s/?.*$//") && node '"$REMOTE_DIR"'/apps/api/scripts/rebuild-db.mjs "$DSN"'
fi
```

`apps/api/scripts/rebuild-db.mjs`（**Create**——随 :174 tar 上传，cutover 时已在位；置于 apps/api 下因 'pg' 自 apps/api/node_modules 解析）：

```js
#!/usr/bin/env node
// Y0b-1 T1a（四轮 Z34）：REBUILD_DB 分支清库脚本——owner 只读核查（P2-5）+DROP 前计数留档+DROP/CREATE SCHEMA。
// 不设"空表断言"门：pm2 不停（应用在线）窗口断言无意义；不可逆操作的回退锚=cutover ②已落的 pg_dump。
import { Client } from 'pg';
const c = new Client({ connectionString: process.argv[2] });
await c.connect();
const owner = await c.query("SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='public'");
console.log('public schema owner:', owner.rows[0].owner);
if (owner.rows[0].owner !== 'flowweb') { console.error('owner 非 flowweb——DROP 需 schema owner，人工核查（Z34/P2-5）'); process.exit(1); }
const n = await c.query('SELECT COUNT(*)::int AS n FROM "GenerationIntent"').catch(() => ({ rows: [{ n: 0 }] }));
console.log('DROP 前 GenerationIntent 计数（仅留档）:', n.rows[0].n);
await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
console.log('schema rebuilt');
await c.end();
```

部署时序（runbook 登记，人工执行；③起全链不变——additive 双检（rm 后远端=新两迁移，BASELINE 在位）→migrate deploy 于空库一次跑完 T1a+T1b（空表使 ADD COLUMN NOT NULL/CHECK 合法）→④切换→⑤重启→⑥post+冒烟。**pm2 stop 删**——旧码对新 schema fail-closed（claim INSERT 缺 teamId 必 500）为设计行为，窗口=③~⑤秒级）：

```
./deploy.sh api --rebuild-db        # preflight（本地已 reset 全绿）→ REBUILD 两分支 → 全链 → 冒烟
ssh -i "$HOME/.ssh/flowweb_server" ubuntu@101.42.94.107 "cd /home/ubuntu/flowweb/apps/api && pnpm exec tsx prisma/seed.ts"   # 服务器开发数据（定价真源已在迁移——Z29）
```

---

## Task 1b: Y0b-1 迁移（纯 additive——additive 门禁首个真实受检对象）

**Files:**
- Create: `apps/api/prisma/migrations/20261010XXXXX1_y0b1_funds_columns/migration.sql`（字典序紧随 init）
- Modify: `apps/api/prisma/schema.prisma`（GenerationIntent/TeamCreditTransaction 新列）、`apps/api/prisma/verify-indexes.sql`（新约束块）
- Test: Create `apps/api/src/modules/execution/ledger-invariants.int.spec.ts`（约束档——本 Task 只写约束用例；不变量档 T4 补、闭环档 T5 补）

- [ ] **Step 1: 写 DB 约束红用例（对 T1a 后库——六约束全红）**

```ts
// apps/api/src/modules/execution/ledger-invariants.int.spec.ts —— Y0b-1 资金门载体（spec §6.2 点名）
// 约束档（本 Task）：同键定价重复/reversesId 1:1（settle/release 同配同斥）/负余额 CHECK/creditCost CHECK/
// money_in partial unique/amount 派生 CHECK——对 T1a 后 schema 全红，本迁移后全绿。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const OWNER = `it-fund-u-${Date.now()}`;

describe('Y0b-1 DB 级资金不变量（迁移约束档）', () => {
  const T = { teamId: '', teamId2: '' };
  beforeAll(async () => {
    // Team.owner onDelete Restrict——user 必须先建（否则 FK 拒绝被吞=CHECK 用例假绿）
    await prisma.user.create({ data: { id: OWNER, name: 'it-fund', email: `${OWNER}@x.invalid`, emailVerified: false } });
    T.teamId = `it-fund-${Date.now()}-a`;
    T.teamId2 = `it-fund-${Date.now()}-b`;
    await prisma.team.create({ data: { id: T.teamId, name: 'it-fund-a', ownerId: OWNER } });
    await prisma.team.create({ data: { id: T.teamId2, name: 'it-fund-b', ownerId: OWNER } });
    await prisma.teamBalance.createMany({ data: [{ teamId: T.teamId, credits: 100 }, { teamId: T.teamId2, credits: 100 }] });
  });
  afterAll(async () => {
    await prisma.teamCreditTransaction.deleteMany({ where: { teamId: { in: [T.teamId, T.teamId2] } } }).catch(() => {});
    await prisma.team.deleteMany({ where: { id: { in: [T.teamId, T.teamId2] } } });
    await prisma.user.deleteMany({ where: { id: OWNER } });
    await prisma.$disconnect();
  });

  it('同键定价规则 DB 拒绝（NULLS NOT DISTINCT——可空列同 null 视为重复；含 modelId IS NULL 的 kind 级行）', async () => {
    const nt = await prisma.nodeType.create({ data: { id: `it-nt-${Date.now()}`, name: 'it', key: `it-nt-${Date.now()}` } });
    // modelId IS NULL 的 kind 级规则：同 nodeTypeId 两条 = 重复
    await prisma.$executeRaw`INSERT INTO "PricingRule" (id, "nodeTypeId", "modelId", "creditCost", active, "createdAt", "updatedAt")
      VALUES ('it-pr-dup-1', ${nt.id}, NULL, 1, true, now(), now())`;
    await expect(prisma.$executeRaw`INSERT INTO "PricingRule" (id, "nodeTypeId", "modelId", "creditCost", active, "createdAt", "updatedAt")
      VALUES ('it-pr-dup-2', ${nt.id}, NULL, 2, true, now(), now())`).rejects.toThrow();
    await prisma.pricingRule.deleteMany({ where: { id: { in: ['it-pr-dup-1', 'it-pr-dup-2'] } } });
    await prisma.nodeType.deleteMany({ where: { id: nt.id } });
  });

  it('reversesId @unique 1:1：同 reversesId 第二条冲销行 DB 拒绝（settle/release 共用此约束——Z6）', async () => {
    const mk = async (id: string, type: string, reversesId: string | null) =>
      prisma.$executeRaw`INSERT INTO "TeamCreditTransaction" (id, "teamId", amount, type, "creditType", "balanceDelta", "frozenDelta", "reversesId", "createdAt")
        VALUES (${id}, ${T.teamId}, -1, ${type}::"TeamCreditTransactionType", 'regular', -1, 1, ${reversesId}, now())`;
    await mk('it-tx-res', 'reserve', null);
    await mk('it-tx-rel-1', 'release', 'it-tx-res');
    await expect(mk('it-tx-rel-2', 'release', 'it-tx-res')).rejects.toThrow();   // 同 reserve 行二次冲销=DB 拒
    await expect(mk('it-tx-set-1', 'settle', 'it-tx-res')).rejects.toThrow();    // 已被 release 的行再 settle=DB 拒（双花不可能）
    await prisma.teamCreditTransaction.deleteMany({ where: { id: { startsWith: 'it-tx-' } } });
  });

  it('TeamBalance 非负 CHECK：credits 置负 DB 拒绝', async () => {
    await expect(prisma.teamBalance.update({ where: { teamId: T.teamId }, data: { credits: -1 } })).rejects.toThrow();
  });

  it('PricingRule.creditCost>=0 与 GenerationIntent.creditCost>=0 CHECK', async () => {
    const nt = await prisma.nodeType.findFirst();
    if (!nt) return;
    await expect(prisma.$executeRaw`INSERT INTO "PricingRule" (id, "nodeTypeId", "creditCost", active, "createdAt", "updatedAt")
      VALUES ('it-pr-neg', ${nt.id}, -1, true, now(), now())`).rejects.toThrow();
    await expect(prisma.generationIntent.create({
      data: { projectId: 'it-p', teamId: T.teamId, nodeId: 'n', userId: OWNER, intentId: `neg-${Date.now()}`, kind: 'text', paramsHash: 'h', creditCost: -1 } as any,
    })).rejects.toThrow();
  });

  it('money_in partial unique（Z9）：同 (type,referenceId,creditType) 第二条 recharge 行 DB 拒绝', async () => {
    const ins = (id: string) => prisma.$executeRaw`INSERT INTO "TeamCreditTransaction" (id, "teamId", amount, type, "creditType", "balanceDelta", "frozenDelta", "referenceId", "createdAt")
      VALUES (${id}, ${T.teamId2}, 10, 'recharge', 'regular', 10, 0, 'it-order-1', now())`;
    await ins('it-tx-rc-1');
    await expect(ins('it-tx-rc-2')).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE "TeamCreditTransaction" SET "referenceId" = NULL WHERE id = 'it-tx-rc-1'`).rejects.toThrow();   // money_in 类 referenceId NOT NULL CHECK
    await prisma.teamCreditTransaction.deleteMany({ where: { id: { startsWith: 'it-tx-rc' } } });
  });

  it('amount 派生 CHECK（Z8）：amount≠CASE 式 DB 拒绝', async () => {
    await expect(prisma.$executeRaw`INSERT INTO "TeamCreditTransaction" (id, "teamId", amount, type, "creditType", "balanceDelta", "frozenDelta", "createdAt")
      VALUES ('it-tx-amt', ${T.teamId}, 999, 'admin_grant', 'regular', 10, 0, now())`).rejects.toThrow();   // 999≠10
    await prisma.teamCreditTransaction.deleteMany({ where: { id: 'it-tx-amt' } }).catch(() => {});
  });
});
```

- [ ] **Step 2: 跑红**

```bash
cd apps/api && npx vitest run -c vitest.int.config.ts src/modules/execution/ledger-invariants.int.spec.ts ; cd ../..
```

预期：定价重复/`reversesId` 唯一/CHECK/`money_in`/`amount` CHECK 用例 FAIL（列不存在或约束不存在=红）。**红相粘 commit message。**

- [ ] **Step 3: schema.prisma 新列声明**

`GenerationIntent`（:978-1002 区域）改为（既有列注释不动，新列注释如下）：

```prisma
model GenerationIntent {
  // ……既有列原样（id/projectId/nodeId/userId/intentId/kind/paramsHash/status/jobId/
  // creditsConsumed/reservedCredits/attempts/resultRef/error/createdAt/updatedAt/completedAt）……
  teamId          String // Y0b-1（Z4/E1）：无 FK 纯列（契约 14——Restrict 与物理删不兼容；资金路径直查锚）
  pricingRuleId   String? // 定价快照（FK SET NULL——规则行删除时快照仍可空存活）
  pricingRule     PricingRule? @relation(fields: [pricingRuleId], references: [id])
  modelId         String?
  resolutionId    String?
  durationId      String?
  creditCost      Int // NOT NULL——claim 无条件固化（creditCost:0 也固化——E1/A2）

  @@unique([projectId, intentId])
  @@index([teamId]) // 资金路径（生命周期门/对账）直查
  @@index([teamId]) WHERE reservedCredits > 0 → 以 raw 落（Prisma 不支持 partial index——见 Step 4）
  // ……既有 @@index 全保留……
}
```

（`@@index([teamId]) WHERE ...)` 行为示意——实际 partial 索引进 migration raw 段，schema 只声明普通 `@@index([teamId])`。）

`TeamCreditTransaction` 改为：

```prisma
model TeamCreditTransaction {
  id             String                     @id @default(cuid())
  teamId         String // Z4：无 FK NOT NULL——append-only 事实+解散后审计留痕（置空语句已随 T1a 删）
  operatorUserId String?
  amount         Int // 派生显示字段（Z8 CHECK 强制 =balanceDelta≠0?balanceDelta:frozenDelta——由 CreditLedgerService 写入）
  type           TeamCreditTransactionType
  creditType     CreditType
  referenceId    String? // intent 域恒 'intent:'+intentRowId；账户域=事件 id（Z9 契约：订单号/subId:period，禁实体 id）
  balanceDelta   Int // 两列真值（§1.4bis 权威）——Σ(balanceDelta)≡池变化
  frozenDelta    Int // settle 行=−X（冻结核销）；Σ(frozenDelta)≡intent.reservedCredits（派生审计量）
  seq            BigInt                     @default(autoincrement()) // 稳定行序——balanceAfter 链按 (teamId,creditType) 分区+seq 排序
  balanceAfter   Int // 本池分量（行级快照）
  reversesId     String?                    @unique // Z6 三配对 1:1：settle/release→reserve 行 / refund→settle 行
  createdAt      DateTime                   @default(now())

  @@index([teamId, createdAt])
  @@index([referenceId])
}
```

- [ ] **Step 4: 生成迁移 + raw 追加（约束/索引/定价数据）**

```bash
cd apps/api
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script > /tmp/y0b1.sql
# 组目录 20261010XXXXX1_y0b1_funds_columns/migration.sql ← /tmp/y0b1.sql（核对：应只含 ADD COLUMN/CREATE INDEX/ADD CONSTRAINT——出现 DROP/ALTER COLUMN 即 schema 编辑越界回 T1a）
```

文件**头部**追加空表守卫（三轮 H6——只断言不清账，把晦涩的 "column contains null values" 换成可读错误；本地 reset（T1b Step 6）/服务器 REBUILD_DB（T1a Step 10）两条空库路径下正常不触发）：

```sql
-- Y0b-1（三轮 H6）：本迁移的 ADD COLUMN NOT NULL 与 CHECK 只在空表合法——空库前提由
-- 本地 migrate reset（T1b Step 6）或服务器 deploy.sh --rebuild-db（T1a Step 10，四轮 Z34）保证。
-- 守卫只断言不清账（与 v1 清账⓿ 的分界：这里不 DELETE 任何行，非空即中止人工判读）。
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "GenerationIntent") OR EXISTS (SELECT 1 FROM "TeamCreditTransaction") THEN
    RAISE EXCEPTION 'Y0b-1 funds migration requires empty ledger tables (空库前提被破坏？见 plan T1b Step 6 reset 形态 / T1a Step 10 REBUILD_DB)';
  END IF;
END $$;
```

文件末尾追加 raw 段：

```sql
-- ====== Y0b-1 DB 级不变量（raw——Prisma 不支持 partial index/CHECK） ======
-- 定价自然键真唯一（PG15+ NULLS NOT DISTINCT——kind 级 modelId IS NULL 行同受约束）。
CREATE UNIQUE INDEX "pricing_rule_natural_key" ON "PricingRule"("nodeTypeId", "modelId", "resolutionId", "durationId") NULLS NOT DISTINCT;
-- 余额非负（F5）。
ALTER TABLE "TeamBalance" ADD CONSTRAINT "balance_non_negative" CHECK ("credits" >= 0 AND "subscriptionCredits" >= 0);
-- 定价与意图非负（Z 终裁 CHECK 全家——空库免费）。
ALTER TABLE "PricingRule" ADD CONSTRAINT "pricing_credit_cost_non_negative" CHECK ("creditCost" >= 0);
ALTER TABLE "GenerationIntent" ADD CONSTRAINT "intent_credit_cost_non_negative" CHECK ("creditCost" >= 0 AND "reservedCredits" >= 0 AND "creditsConsumed" >= 0);
ALTER TABLE "TeamMember" ADD CONSTRAINT "member_monthly_non_negative" CHECK ("monthlyUsed" >= 0);
-- 台账 amount 派生强制（Z8）。
ALTER TABLE "TeamCreditTransaction" ADD CONSTRAINT "ledger_amount_derived"
  CHECK ("amount" = CASE WHEN "balanceDelta" <> 0 THEN "balanceDelta" ELSE "frozenDelta" END);
-- 账户域幂等锚（Z9）：money_in 类每事件每池至多一条 + referenceId 必填。
CREATE UNIQUE INDEX "money_in_once" ON "TeamCreditTransaction"("type", "referenceId", "creditType")
  WHERE "type" IN ('recharge', 'subscription_grant', 'expire_clear', 'register_grant');
ALTER TABLE "TeamCreditTransaction" ADD CONSTRAINT "money_in_reference_required"
  CHECK ("type" NOT IN ('recharge', 'subscription_grant', 'expire_clear', 'register_grant') OR "referenceId" IS NOT NULL);
-- 冻结悬留直查（Z11 性能补偿：生命周期门与第四分支的 reservedCredits>0 扫描）。
CREATE INDEX "generation_intent_frozen_partial" ON "GenerationIntent"("teamId") WHERE "reservedCredits" > 0;
-- 孤儿/不可释放扫描性能（四轮 Z38）：T5 巡检 5min 档扫 type='reserve' 全表的 partial 化。
CREATE INDEX "ledger_reserve_open_partial" ON "TeamCreditTransaction"("createdAt") WHERE type = 'reserve';

-- ====== 定价数据进迁移（Z16+三轮 Z29——主链全家+kind 级：固定 id 常量原样搬自 seed.ts；
-- 定价真源=迁移；seed.ts 对应段 upsert-by-id/key 幂等共存） ======
-- ① 主链 NodeType（seed.ts:24-46 同名四键——id 用固定常量）
INSERT INTO "NodeType" ("id", "key", "name", "description", "active", "createdAt", "updatedAt") VALUES
  ('node-type-text', 'text', '文本生成', '文本Prompt输入与优化', true, now(), now()),
  ('node-type-image', 'image', '图片生成', '文生图、图生图', true, now(), now()),
  ('node-type-image-ext', 'imageExt', '图片扩展', '图片扩展节点', true, now(), now()),
  ('node-type-video', 'video', '视频生成', '文生视频、图生视频', true, now(), now())
ON CONFLICT ("key") DO NOTHING;

-- ② kind 级 NodeType（Z5——编辑 4 kind 的 modelId IS NULL 规则载体；multiImageGen 并入 Z31 显式 4xx 不建规则——
--   mock 管线禁定价，四轮 Z37）
INSERT INTO "NodeType" ("id", "key", "name", "active", "createdAt", "updatedAt") VALUES
  ('node-type-outpaint', 'outpaint', '局部重绘（外扩）', true, now(), now()),
  ('node-type-erase', 'erase', '擦除', true, now(), now()),
  ('node-type-redraw', 'redraw', '局部重绘', true, now(), now()),
  ('node-type-lighting', 'lighting', '打光', true, now(), now())
ON CONFLICT ("key") DO NOTHING;

-- ③ AIModel（id=seed 固定常量；hy-image 的 apiKey 迁移置 NULL——env 密钥由 seed.ts 补写（本 Task 微改一行，见下注））
INSERT INTO "AIModel" ("id", "nodeTypeId", "name", "provider", "apiUrl", "apiKey", "sortOrder", "recommended", "active", "createdAt", "updatedAt") VALUES
  ('seed-model-hy-image', 'node-type-image', 'HY-Image-V3.0', '腾讯混元', 'https://tokenhub.tencentmaas.com/v1/api/image', NULL, 0, true, true, now(), now()),
  ('seed-model-sdxl', 'node-type-image', 'Stable Diffusion XL', 'Stability AI', 'https://api.stability.ai/v1/generation', NULL, 1, true, true, now(), now()),
  ('seed-model-dalle', 'node-type-image', 'DALL-E 3', 'OpenAI', 'https://api.openai.com/v1/images/generations', NULL, 2, false, true, now(), now()),
  ('seed-model-gpt4', 'node-type-text', 'GPT-4o', 'OpenAI', 'https://api.openai.com/v1/chat/completions', NULL, 1, true, true, now(), now()),
  ('seed-model-kimi', 'node-type-text', 'Kimi K2.6', 'Moonshot AI', 'https://api.moonshot.cn/v1', NULL, 2, true, true, now(), now()),
  ('seed-model-hy-video', 'node-type-video', 'HY-Video 1.5', 'Tencent Maas', 'https://tokenhub.tencentmaas.com/v1/api/video', NULL, 1, true, true, now(), now())
ON CONFLICT ("id") DO NOTHING;

-- ④ 分辨率/时长（固定 id——resolver 归一化与覆盖度门禁的键集来源；列集以 schema 实测校准）
INSERT INTO "ModelResolution" ("id", "modelId", "label", "width", "height", "createdAt") VALUES
  ('seed-res-hy-1024', 'seed-model-hy-image', '1024×1024', 1024, 1024, now()),
  ('seed-res-hy-2048', 'seed-model-hy-image', '2048×2048', 2048, 2048, now()),
  ('seed-res-hy-512', 'seed-model-hy-image', '512×512', 512, 512, now()),
  ('seed-res-sdxl-1024', 'seed-model-sdxl', '1024×1024', 1024, 1024, now()),
  ('seed-res-sdxl-2048', 'seed-model-sdxl', '2048×2048', 2048, 2048, now()),
  ('seed-res-dalle-1024', 'seed-model-dalle', '1024×1024', 1024, 1024, now()),
  ('seed-res-dalle-512', 'seed-model-dalle', '512×512', 512, 512, now())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ModelDuration" ("id", "modelId", "label", "seconds", "createdAt") VALUES
  ('seed-dur-5', 'seed-model-hy-video', '5秒', 5, now()),
  ('seed-dur-10', 'seed-model-hy-video', '10秒', 10, now()),
  ('seed-dur-15', 'seed-model-hy-video', '15秒', 15, now())
ON CONFLICT ("id") DO NOTHING;

-- ⑤ 主链规则（seed.ts:79-129/:159-163 原价目——text (model,null,null)、image (model,res,null)、video (model,null,dur)）
INSERT INTO "PricingRule" ("id", "nodeTypeId", "modelId", "resolutionId", "durationId", "creditCost", "active", "createdAt", "updatedAt") VALUES
  ('seed-pricing-gpt4', 'node-type-text', 'seed-model-gpt4', NULL, NULL, 2, true, now(), now()),
  ('seed-pricing-kimi', 'node-type-text', 'seed-model-kimi', NULL, NULL, 2, true, now(), now()),
  ('seed-pricing-sdxl-1024', 'node-type-image', 'seed-model-sdxl', 'seed-res-sdxl-1024', NULL, 3, true, now(), now()),
  ('seed-pricing-sdxl-2048', 'node-type-image', 'seed-model-sdxl', 'seed-res-sdxl-2048', NULL, 6, true, now(), now()),
  ('seed-pricing-dalle-1024', 'node-type-image', 'seed-model-dalle', 'seed-res-dalle-1024', NULL, 5, true, now(), now()),
  ('seed-pricing-dalle-512', 'node-type-image', 'seed-model-dalle', 'seed-res-dalle-512', NULL, 2, true, now(), now()),
  ('seed-pricing-hy-img-512', 'node-type-image', 'seed-model-hy-image', 'seed-res-hy-512', NULL, 3, true, now(), now()),
  ('seed-pricing-hy-img-1024', 'node-type-image', 'seed-model-hy-image', 'seed-res-hy-1024', NULL, 5, true, now(), now()),
  ('seed-pricing-hy-img-2048', 'node-type-image', 'seed-model-hy-image', 'seed-res-hy-2048', NULL, 10, true, now(), now()),
  ('seed-pricing-hy-video-5', 'node-type-video', 'seed-model-hy-video', NULL, 'seed-dur-5', 10, true, now(), now()),
  ('seed-pricing-hy-video-10', 'node-type-video', 'seed-model-hy-video', NULL, 'seed-dur-10', 18, true, now(), now()),
  ('seed-pricing-hy-video-15', 'node-type-video', 'seed-model-hy-video', NULL, 'seed-dur-15', 25, true, now(), now())
ON CONFLICT DO NOTHING;   -- 冲突目标=pricing_rule_natural_key（本文件先建）

-- ⑥ kind 级规则（Z5：modelId IS NULL——编辑 4 kind；承接 CREDIT_COST_PER_EDIT 旧值 1；multiImageGen 不建——Z37）
INSERT INTO "PricingRule" ("id", "nodeTypeId", "modelId", "resolutionId", "durationId", "creditCost", "active", "createdAt", "updatedAt")
SELECT 'seed-pricing-kind-' || k."key", k."id", NULL, NULL, NULL, 1, true, now(), now()
FROM "NodeType" k WHERE k."key" IN ('outpaint','erase','redraw','lighting')
ON CONFLICT DO NOTHING;
```

（执行时校准三件：①若 Prisma 生成的 `seq` 列为 `ADD COLUMN ... DEFAULT` 形态与 `autoincrement()` 语义不符，以 raw `ALTER COLUMN ... ADD GENERATED BY DEFAULT AS IDENTITY` 校正；②`ModelResolution`/`NodeType`/`AIModel` 的 INSERT 列集以 schema 实测校准（createdAt/updatedAt 等列名）；③**seed.ts 微改一行**：hy-image 的 upsert `update: {}` 改 `update: { apiKey: process.env.HY_IMAGE_API_KEY }`——迁移先建行后 seed 需补写 env 密钥，否则 apiKey 永缺失。**T1b Files 增补：`apps/api/prisma/seed.ts`。**）

- [ ] **Step 5: additive 门禁首个真实受检**

```bash
node scripts/check-migration-additive.mjs ; echo exit=$?
# 预期 exit=0 且输出含新迁移受检记录（INSERT/ADD COLUMN/CREATE INDEX/CHECK 均非 BREAKING；
# 若红：说明 Step 4 混入了 DROP/ALTER COLUMN 类——回 T1a 边界检查）
```

- [ ] **Step 6: 应用（reset 形态——四轮 Z37）+ 约束档绿**

```bash
# migrate reset 而非 deploy（四轮 Z37）：T1a Step 8 已 seed 的库上，seed 的 NodeType 是 cuid id——
# 迁移的 ON CONFLICT ("key") DO NOTHING 0 行插入后，AIModel INSERT 引用 'node-type-*' 固定 id 必 FK violation
# （必然失败）；兼解空表守卫×int 残留自撞（generation-intent.int.spec :43/:125/:161 写 GenerationIntent）。
# reset=drop+replay 两迁移于空库，两案同消。顺序纪律（写死）：**迁移 → seed**——seed 先于本迁移 deploy 的流程非法。
cd apps/api && npx prisma migrate reset --force --skip-seed && npx prisma migrate status
npx vitest run -c vitest.int.config.ts src/modules/execution/ledger-invariants.int.spec.ts    # 全绿
node scripts/verify-indexes.mjs ; cd ../..    # 含 T1a 14 块继续绿
```

- [ ] **Step 7: fresh replay 必验**

```bash
cd apps/api && npx prisma migrate reset --force --skip-seed && npx prisma migrate status    # 两迁移全应用
npx vitest run -c vitest.int.config.ts ; cd ../..    # 既有 int 全绿（迁移无回归）——kind 级规则在位
pnpm exec tsx apps/api/prisma/seed.ts 2>/dev/null || (cd apps/api && pnpm exec tsx prisma/seed.ts)    # 恢复开发数据
```

- [ ] **Step 8: verify-indexes 新块 + Commit**

```sql
-- Y0b-1 T1b：资金不变量定义断言
SELECT indexdef FROM pg_indexes WHERE indexname='pricing_rule_natural_key' AND indexdef LIKE '%NULLS NOT DISTINCT%';

SELECT indexdef FROM pg_indexes WHERE indexname='money_in_once' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='generation_intent_frozen_partial' AND indexdef LIKE '%WHERE%';

SELECT conname FROM pg_constraint WHERE conname='balance_non_negative';

SELECT conname FROM pg_constraint WHERE conname='ledger_amount_derived';

SELECT indexdef FROM pg_indexes WHERE indexname='ledger_reserve_open_partial' AND indexdef LIKE '%WHERE%';

SELECT COUNT(*) AS n FROM "PricingRule" WHERE "modelId" IS NULL AND active HAVING COUNT(*) >= 4;
```

```bash
git add apps/api/prisma/ apps/api/src/modules/execution/ledger-invariants.int.spec.ts
git commit -m "feat(funds): Y0b-1 T1b 迁移纯 additive——intent 定价快照列（teamId/五列/creditCost NOT NULL）+台账两列真值+seq+reversesId @unique+amount 派生 CHECK+balance/creditCost/monthlyUsed CHECK 全家+pricing NULLS NOT DISTINCT+money_in partial unique+frozen partial index+kind 级定价数据 INSERT 进迁移；additive 门禁首个真实受检 exit 0；约束档红→绿两态在案"
```

---

## Task 2: pricing-resolver 单源+video duration 维度修复+十处改道+覆盖度门禁（E48/E49/Z5/Z20/Z21）

**Files:**
- Create: `apps/api/src/modules/execution/pricing-resolver.service.ts`、`apps/api/src/modules/execution/pricing-input.util.ts`（模型键+pricingKey 映射+归一化单源）、`apps/api/src/modules/execution/pricing-resolver.int.spec.ts`、`scripts/check-pricing-coverage.mjs`
- Modify: `apps/api/src/modules/execution/validation.service.ts`、`execution.service.ts`（三链 findFirst→resolvePricingKey+resolver）、`is-executable-node.ts`（export EXECUTABLE_TYPES——映射断言消费）、`admin/pricing/pricing.service.ts`（batchCreate+calculatePrice+**写侧守卫**）、`admin/public/public.service.ts`（第十处+报价同源）、`ai-image-edit.constants.ts`（删 CREDIT_COST_PER_EDIT）、`ai-image-edit.processor.ts`、`lighting.consumer.ts`、`lighting.service.ts`、ExecutionModule/AdminModule providers、根 `package.json`（coverage 进 verify）
- Modify（三轮 Z30+四轮 Z36②a 字面量/键形清理——web）: `apps/web/src/stores/nodeStore.ts`（删默认 `model:'sdxl'` **与 `resolution:'2K'`** 注入）、`ImageConfigPanel.tsx`（删 `?? 'sdxl'`/`?? '2K'`）、`EraseBottomToolbar.tsx`（删 `?? 'sdxl'`）、`VideoGenNode.tsx`（删 `?? 'hyvideo-v1.5'` 两处）、`config-panel/RatioResolutionPopover.tsx`（选项 `['1K','2K','4K']` 改从当前模型 `resolutions` 渲染——label 显示/**存行 id**）、`imageNodeApi.ts`/`imageExtNodeApi.ts`（getCreditCost 补传维度参数——行 id 形态）
- Test: 既有 stub `pricingRule.findFirst` 的 spec 改造（grep 清单逐文件——勿固化旧行为）；**点名连带**：`public.service.spec.ts`（5/8/0 三断言）+`public.controller.spec.ts`（参数形状）+`nodeStore.test.ts`/`canvasIntents.spec.ts`（'sdxl'/'2K' 默认值断言改自动选语义）+`imageNodeApi.test.ts`+`ImageConfigPanel.test.tsx`（"1K/2K/4K options"断言改"选项自模型 resolutions 渲染"）

- [ ] **Step 0: 只读探针——NodeType 键集/模型归属/规则维度矩阵（coverage 门禁实测输入）**

```bash
cd apps/api && npx tsx -e "
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const nts = await p.nodeType.findMany({ select: { key: true, active: true }, orderBy: { key: 'asc' } });
  const models = await p.aIModel.findMany({ select: { id: true, name: true, nodeTypeId: true, active: true } });
  const ntById = Object.fromEntries(nts.map(n => [n.id ?? n.key, n.key]));
  // NodeType 无 id select 时以 key 关联——修正：重查含 id
  const nts2 = await p.nodeType.findMany({ select: { id: true, key: true } });
  const keyOf = Object.fromEntries(nts2.map(n => [n.id, n.key]));
  const rules = await p.pricingRule.findMany({ select: { nodeTypeId: true, modelId: true, resolutionId: true, durationId: true, creditCost: true, active: true } });
  const matrix = rules.map(r => ({ nt: keyOf[r.nodeTypeId], model: r.modelId, res: !!r.resolutionId, dur: !!r.durationId, cost: r.creditCost, active: r.active }));
  console.log(JSON.stringify({ nodeTypeKeys: nts.map(n=>n.key), models: models.map(m => [m.name, keyOf[m.nodeTypeId], m.active]), ruleMatrix: matrix }, null, 1));
  await p.\$disconnect();
})();" ; cd ../..
```

判读：① 主链键集（imageGen/videoGen/textInput/audioGen 对应 NodeType key 实名）；② 既有规则维度分布（video 应=duration 维、image 应=resolution 维——seed.ts:159-163 证据）；③ imageExtGen 前端 `extConfig.model` 的模型行是否存在。**输出粘 commit message；门禁已纯表驱动（四轮 Z37——无键常量回填项），本探针仅供判读与死亡线夹具选型。**

- [ ] **Step 1: 写红用例（对现状跑——resolver 模块缺失=红）**

```ts
// apps/api/src/modules/execution/pricing-resolver.int.spec.ts —— Y0b-1（E48/E49/Z5/Z20/Z21）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PricingResolverService } from './pricing-resolver.service';

const prisma = new PrismaClient();
const svc = new PricingResolverService(prisma as any);

describe('Y0b-1 pricing-resolver 单源（fail-closed，精确匹配无阶梯）', () => {
  const S = { team: '', nt: '', model: '', kindKey: '' };
  beforeAll(async () => {
    const ts = Date.now();
    const user = await prisma.user.create({ data: { id: `it-res-u-${ts}`, name: 'it', email: `it-res-${ts}@x.invalid`, emailVerified: false } });
    S.team = `it-res-${ts}`;
    await prisma.team.create({ data: { id: S.team, name: 'it', ownerId: user.id } });
    S.nt = (await prisma.nodeType.create({ data: { id: `it-nt-${ts}`, name: 'it-image', key: `it-image-${ts}` } })).id;
    S.model = (await prisma.aIModel.create({ data: { id: `it-m-${ts}`, nodeTypeId: S.nt, name: 'it-m', provider: 'it', apiUrl: 'http://x', active: true } })).id;
    await prisma.pricingRule.create({ data: { id: `it-pr-${ts}`, nodeTypeId: S.nt, modelId: S.model, creditCost: 3, active: true } });
    S.kindKey = `it-kind-${ts}`;
    const kindNt = await prisma.nodeType.create({ data: { id: `it-nt-kind-${ts}`, name: 'it-kind', key: S.kindKey } });
    await prisma.pricingRule.create({ data: { id: `it-pr-kind-${ts}`, nodeTypeId: kindNt.id, modelId: null, creditCost: 1, active: true } });
  });
  afterAll(async () => {
    await prisma.pricingRule.deleteMany({ where: { id: { startsWith: 'it-pr-' } } });
    await prisma.aIModel.deleteMany({ where: { id: { startsWith: 'it-m-' } } });
    await prisma.nodeType.deleteMany({ where: { id: { startsWith: 'it-nt-' } } });
    const t = await prisma.team.findUnique({ where: { id: S.team } });
    if (t) { await prisma.team.delete({ where: { id: S.team } }); await prisma.user.deleteMany({ where: { id: { startsWith: 'it-res-u-' } } }); }
    await prisma.$disconnect();
  });

  it('主链命中：modelId 派生 nodeTypeId，全四键精确匹配返回快照', async () => {
    const r = await svc.resolve({ modelId: S.model });
    expect(r).toMatchObject({ pricingRuleId: expect.stringContaining('it-pr-'), modelId: S.model, creditCost: 3 });
  });

  it('三分支①：规则行不存在 ⇒ PRICING_RULE_MISSING 业务错误（红相=现实现 ?? 0 外呼照发）', async () => {
    const m2 = await prisma.aIModel.create({ data: { id: `it-m-nr-${Date.now()}`, nodeTypeId: S.nt, name: 'it-m-nr', provider: 'it', apiUrl: 'http://x', active: true } });
    await expect(svc.resolve({ modelId: m2.id })).rejects.toMatchObject({ errorCode: 'PRICING_RULE_MISSING' });
    await prisma.aIModel.delete({ where: { id: m2.id } });
  });

  it('三分支②：active=false 规则 ⇒ 同 PRICING_RULE_MISSING', async () => {
    await prisma.pricingRule.update({ where: { id: `it-pr-${S.model ? '' : ''}` || undefined } , data: {} }).catch(() => {});
    const rule = await prisma.pricingRule.findFirstOrThrow({ where: { modelId: S.model } });
    await prisma.pricingRule.update({ where: { id: rule.id }, data: { active: false } });
    await expect(svc.resolve({ modelId: S.model })).rejects.toMatchObject({ errorCode: 'PRICING_RULE_MISSING' });
    await prisma.pricingRule.update({ where: { id: rule.id }, data: { active: true } });
  });

  it('三分支③：model 缺失/停用 ⇒ PROVIDER_UNKNOWN_MODEL（模型身份单源 AIModel）', async () => {
    await expect(svc.resolve({ modelId: 'no-such-model' })).rejects.toMatchObject({ errorCode: 'PROVIDER_UNKNOWN_MODEL' });
  });

  it('Z21：modelId undefined/null ⇒ 4xx 业务错误（禁 PrismaClientValidationError 500）', async () => {
    await expect(svc.resolve({ modelId: undefined as any })).rejects.toMatchObject({ errorCode: 'PROVIDER_UNKNOWN_MODEL' });
    await expect(svc.resolve({ modelId: '' })).rejects.toMatchObject({ errorCode: 'PROVIDER_UNKNOWN_MODEL' });
  });

  it('creditCost:0 行=唯一合法免费（resolve 成功返回 0——?? 0 禁令正面形态）', async () => {
    const rule = await prisma.pricingRule.findFirstOrThrow({ where: { modelId: S.model } });
    await prisma.pricingRule.update({ where: { id: rule.id }, data: { creditCost: 0 } });
    expect((await svc.resolve({ modelId: S.model })).creditCost).toBe(0);
    await prisma.pricingRule.update({ where: { id: rule.id }, data: { creditCost: 3 } });
  });

  it('Z5 kind 级路径：modelId IS NULL 规则精确命中（无阶梯无唯一模型断言）', async () => {
    const r = await svc.resolveByNodeTypeKey(S.kindKey);
    expect(r).toMatchObject({ modelId: null, creditCost: 1 });
  });

  it('Z5：kind 级 NodeType 无规则 ⇒ PRICING_RULE_MISSING（非裸 Error 500）', async () => {
    const nt = await prisma.nodeType.create({ data: { id: `it-nt-nr-${Date.now()}`, name: 'x', key: `it-nr-${Date.now()}` } });
    await expect(svc.resolveByNodeTypeKey(nt.key)).rejects.toMatchObject({ errorCode: 'PRICING_RULE_MISSING' });
    await prisma.nodeType.delete({ where: { id: nt.id } });
  });

  it('Z28：EXECUTABLE_TYPES ⊆ dom(NODE_TYPE_KEY_MAP)（命名空间映射全覆盖——imageExtGen≠imageExt 类错配由断言非人眼负责）', async () => {
    const { NODE_TYPE_KEY_MAP, resolvePricingKey, KIND_LEVEL_KEYS } = await import('./pricing-input.util');
    const { EXECUTABLE_TYPES } = await import('./is-executable-node');
    for (const t of EXECUTABLE_TYPES) expect(NODE_TYPE_KEY_MAP[t], `节点类型 ${t} 缺 pricingKey 映射`).toBeDefined();
    // 主链类型缺模型 ⇒ MODEL_NOT_SELECTED（禁 kind 回退——resolvePricingKey 的主链/kind 分界）
    await expect(resolvePricingKey({ modelResolution: {}, modelDuration: {} } as any, { type: 'textInput', data: {} }))
      .rejects.toMatchObject({ errorCode: 'MODEL_NOT_SELECTED' });
    // kind 级类型缺模型 ⇒ 走 pricingKey（不抛 MODEL_NOT_SELECTED）
    const k = await resolvePricingKey({ modelResolution: {}, modelDuration: {} } as any, { type: 'lighting', data: {} });
    expect(k.pricingKey).toBe('lighting');
    // Z37：multiImageGen 并入 Z31——缺模型 ⇒ MODEL_NOT_SELECTED 显式 4xx（非 kind 回退）
    await expect(resolvePricingKey({ modelResolution: {}, modelDuration: {} } as any, { type: 'multiImageGen', data: {} }))
      .rejects.toMatchObject({ errorCode: 'MODEL_NOT_SELECTED' });
    void KIND_LEVEL_KEYS;
  });

  it('Z28 前置探针用例：normalizeDimensions label→id 归一化 + 声明参与制（四轮 Z36）', async () => {
    const { normalizeDimensions } = await import('./pricing-input.util');
    const imgModels = await prisma.aIModel.findMany({ where: { active: true, nodeType: { key: 'image' } }, take: 1 });
    if (imgModels.length >= 1) {
      const res = await prisma.modelResolution.findFirstOrThrow({ where: { modelId: imgModels[0].id } });
      const byLabel = await normalizeDimensions(prisma as any, imgModels[0].id, res.label);
      expect(byLabel.resolutionId).toBe(res.id);   // label 归一化到行 id
      await expect(normalizeDimensions(prisma as any, imgModels[0].id, '2K')).rejects.toMatchObject({ errorCode: 'PRICING_DIMENSION_MISSING' });   // 已声明而键不可解析——UI 预设串禁回退（四轮 Z36 死亡线①的前置）
    }
    // 声明参与制：video 模型未声明 resolution ⇒ '1080p' 不参与（null 不抛）+秒数归一
    const vidModels = await prisma.aIModel.findMany({ where: { active: true, nodeType: { key: 'video' } }, take: 1 });
    if (vidModels.length >= 1) {
      const r = await normalizeDimensions(prisma as any, vidModels[0].id, '1080p', 5);
      expect(r.resolutionId).toBeNull();
      expect(r.durationId).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: 跑红**——`cd apps/api && npx vitest run -c vitest.int.config.ts src/modules/execution/pricing-resolver.int.spec.ts ; cd ../..` 预期 FAIL（模块不存在）。

- [ ] **Step 3: 实现 PricingResolverService + pricing-input.util**

```ts
// apps/api/src/modules/execution/pricing-resolver.service.ts —— Y0b-1（E48/E49/Z5/Z20）：定价唯一解析器
// 冻结契约 1/3：任何直接 findFirst PricingRule / MODEL_CONFIG 判存在性 / 编译期常量定扣费额的新代码=违规。
// fail-closed：无 active 规则/未知模型/键缺失 ⇒ 业务错误（零外呼零冻结）；creditCost:0 行=唯一合法免费。
// Z5 终裁：全四键精确匹配、无解析阶梯；modelId IS NULL = kind 级规则（编辑 4 kind/multiImageGen）。
import { Inject, Injectable, HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';

export interface ResolvedPricing {
  pricingRuleId: string;
  nodeTypeId: string;
  modelId: string | null;
  resolutionId: string | null;
  durationId: string | null;
  creditCost: number;
}

@Injectable()
export class PricingResolverService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 主链：modelId 必给——nodeTypeId 自 AIModel 行派生（单值确定，消除 NodeType 键猜测）。
   *  Z21：键缺失先于 Prisma 校验（undefined 进 findUnique=PrismaClientValidationError 500）。 */
  async resolve(input: { modelId: string; resolutionId?: string | null; durationId?: string | null }): Promise<ResolvedPricing> {
    if (!input.modelId) {
      throw new BusinessException('PROVIDER_UNKNOWN_MODEL', '模型键缺失（节点未配置模型——kind 级规则走 resolveByNodeTypeKey）', HttpStatus.BAD_REQUEST);
    }
    const model = await this.prisma.aIModel.findUnique({ where: { id: input.modelId } });
    if (!model || !model.active) {
      throw new BusinessException('PROVIDER_UNKNOWN_MODEL', `模型不存在或已停用: ${input.modelId}`, HttpStatus.BAD_REQUEST);
    }
    return this.resolveExact(model.nodeTypeId, model.id, input.resolutionId ?? null, input.durationId ?? null);
  }

  /** kind 级路径（Z5）：NodeType by key → (nodeTypeId, modelId IS NULL, null, null) 精确匹配。
   *  无"唯一 active 模型"断言、无假模型行——多模型分叉对本路径无影响。 */
  async resolveByNodeTypeKey(nodeTypeKey: string): Promise<ResolvedPricing> {
    const nt = await this.prisma.nodeType.findUnique({ where: { key: nodeTypeKey } });
    if (!nt) throw new BusinessException('PRICING_RULE_MISSING', `节点类型未登记: ${nodeTypeKey}`, HttpStatus.BAD_REQUEST);
    return this.resolveExact(nt.id, null, null, null);
  }

  private async resolveExact(nodeTypeId: string, modelId: string | null, resolutionId: string | null, durationId: string | null): Promise<ResolvedPricing> {
    const rules = await this.prisma.pricingRule.findMany({
      where: { nodeTypeId, modelId, resolutionId, durationId, active: true },
    });
    if (rules.length > 1) throw new Error(`pricing-resolver: 同键命中 ${rules.length} 行——pricing_rule_natural_key 索引疑似缺失`);
    const rule = rules[0];
    if (!rule) {
      throw new BusinessException('PRICING_RULE_MISSING',
        `无有效定价规则（nodeType=${nodeTypeId} model=${modelId} res=${resolutionId} dur=${durationId}）`, HttpStatus.BAD_REQUEST);
    }
    return { pricingRuleId: rule.id, nodeTypeId, modelId, resolutionId, durationId, creditCost: rule.creditCost };
  }
}
```

```ts
// apps/api/src/modules/execution/pricing-input.util.ts —— Y0b-1（Z21+三轮 Z28+四轮 Z36/Z37）：节点→定价输入单源
// ①模型键位 census（is-executable-node 白名单）：
//   textInput/imageGen/videoGen/audioGen → data.model；imageExtGen → data.extConfig.model（后端此前从不读——v1 盲区）；
//   multiImageGen → 无模型键 → null（四轮 Z37 并入 Z31：KIND_LEVEL_KEYS 移除 ⇒ MODEL_NOT_SELECTED 显式 4xx）
// ②pricingKey 映射（三轮 Z28：node.type 与 NodeType.key 是两个命名空间——seed 实测 text/image/imageExt/video；
//   映射表与 EXECUTABLE_TYPES 同处定义，pricing-resolver.int.spec 断言白名单 ⊆ dom(map)）
// ③normalizeDimensions（四轮 Z36 声明参与制）：维度是否参与定价由**模型声明**（有无该维度类行）决定——未声明 ⇒
//   不参与（返回 null 不抛错：video 的 '1080p' 预设/image 的 duration 被忽略）；已声明而键无法解析 ⇒
//   PRICING_DIMENSION_MISSING fail-closed 禁回退。行 id/label/秒数统一归一到行 id——validation/execution/
//   报价端点/覆盖度门禁四处同源消费。UI 侧配套（Z36②a）：面板从 model.resolutions/durations 渲染并**存行 id**。
import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';

export const NODE_TYPE_KEY_MAP: Record<string, string> = {
  textInput: 'text', imageGen: 'image', imageExtGen: 'imageExt', videoGen: 'video',
  audioGen: 'audio',   // 库内无此 NodeType（Z31 登记 Y0b-2）——映射预留，运行期 PROVIDER_UNKNOWN/PRICING_RULE_MISSING 显式 4xx
  multiImageGen: 'multiImageGen', outpaint: 'outpaint', erase: 'erase', redraw: 'redraw', lighting: 'lighting',
};
/** kind 级键（modelId IS NULL 规则的合法载体）——主链键缺模型时是 MODEL_NOT_SELECTED 而非 kind 回退。
 *  四轮 Z37：multiImageGen 移除（mock 管线禁定价——落入 MODEL_NOT_SELECTED 显式 4xx，Y0b-2 登记多图管线）。 */
export const KIND_LEVEL_KEYS = ['outpaint', 'erase', 'redraw', 'lighting'];

export function pricingInputOf(node: { type: string; data?: Record<string, unknown> | null }): { modelId: string | null; pricingKey: string | null } {
  const d = (node.data ?? {}) as any;
  const modelId = node.type === 'imageExtGen' ? (d?.extConfig?.model ?? null) : (d?.model ?? null);
  return { modelId, pricingKey: NODE_TYPE_KEY_MAP[node.type] ?? null };
}

/** 维度归一化（Z28+四轮 Z36）：声明参与制——每维度类恰一次查询（取声明全集后本地匹配 id/label/秒数）。 */
export async function normalizeDimensions(
  prisma: { modelResolution: { findMany: (a: any) => Promise<any[]> }; modelDuration: { findMany: (a: any) => Promise<any[]> } },
  modelId: string, resolution?: unknown, duration?: unknown,
): Promise<{ resolutionId: string | null; durationId: string | null }> {
  let resolutionId: string | null = null;
  if (resolution != null && resolution !== '') {
    const rows = await prisma.modelResolution.findMany({ where: { modelId }, select: { id: true, label: true } });
    const hit = rows.find((r) => r.id === resolution || r.label === String(resolution));
    if (hit) resolutionId = hit.id;
    else if (rows.length > 0) throw new BusinessException('PRICING_DIMENSION_MISSING', `分辨率键无法解析: ${String(resolution)}（model=${modelId}，已声明 ${rows.length} 档——UI 应存行 id，Z36）`, HttpStatus.BAD_REQUEST);
    // rows 空=模型未声明分辨率维度 ⇒ 不参与（video 的 '1080p' 预设被忽略）
  }
  let durationId: string | null = null;
  if (duration != null && duration !== '') {
    const rows = await prisma.modelDuration.findMany({ where: { modelId }, select: { id: true, label: true, seconds: true } });
    const idStr = String(duration);
    const secs = Number(duration);   // Number('5s')=NaN——isFinite 守卫（四轮 B4：NaN 入 Prisma Int 查询=invalid syntax 500）
    const hit = rows.find((r) => r.id === idStr || r.label === idStr || (Number.isFinite(secs) && r.seconds === secs));
    if (hit) durationId = hit.id;
    else if (rows.length > 0) throw new BusinessException('PRICING_DIMENSION_MISSING', `时长键无法解析: ${String(duration)}（model=${modelId}，已声明 ${rows.length} 档）`, HttpStatus.BAD_REQUEST);
  }
  return { resolutionId, durationId };
}

/** 全四键单源解析（Z28）——validation/execution 三链/报价端点的唯一入口（两形状分叉的根修） */
export async function resolvePricingKey(
  prisma: any, node: { type: string; data?: Record<string, unknown> | null },
): Promise<{ modelId: string | null; resolutionId: string | null; durationId: string | null; pricingKey: string | null }> {
  const { modelId, pricingKey } = pricingInputOf(node);
  if (!modelId) {
    if (!pricingKey || !KIND_LEVEL_KEYS.includes(pricingKey)) {
      throw new BusinessException('MODEL_NOT_SELECTED', `节点 ${node.type} 未选择模型（主链类型禁 kind 回退）`, HttpStatus.BAD_REQUEST);
    }
    return { modelId: null, resolutionId: null, durationId: null, pricingKey };
  }
  const d = (node.data ?? {}) as any;
  const { resolutionId, durationId } = await normalizeDimensions(prisma, modelId, d?.resolution, d?.duration);
  return { modelId, resolutionId, durationId, pricingKey };
}
```

（module 注册：ExecutionModule providers+exports 加 PricingResolverService；AdminModule/PublicModule/AiImageEditModule import ExecutionModule——以 T7 DI compile smoke 验证零循环。）

- [ ] **Step 4: 跑绿 + 十处改道**

4a `validation.service.ts` 重写 validateAll 循环体（textInput 不再跳过；**全四键经 resolvePricingKey 单源**——validation/execution 两形状分叉根修。**G-1 红相扩面（四轮 Z36 核验）**：现状不止 text 预检跳过——image 链 `resolutionId: data?.resolution || null` 以 `'2K'` 预设串查询永不命中=**实扣 0**、video 链 where 无 durationId=实扣 0——即 image/video 免费真外呼+text 预检漏算三条并存）：

```ts
    for (const node of nodes) {
      if (!isExecutableNode(node)) continue;
      // Y0b-1（E48/E49/Z20/Z21/Z28）：textInput 不再跳过（totalCost 曾系统性少算 text）；
      // 全四键单源 resolvePricingKey（label→id 归一化禁回退；video duration 维预检=实扣同键——
      // 旧实现两形状分叉：预检随机命中 10/18/25、实扣 ?? 0=免费）
      try {
        const key = await resolvePricingKey(this.prisma, node);
        const r = key.modelId
          ? await this.resolver.resolve({ modelId: key.modelId, resolutionId: key.resolutionId, durationId: key.durationId })
          : await this.resolver.resolveByNodeTypeKey(key.pricingKey!);
        totalCost += r.creditCost;
      } catch (e: any) {
        errors.push(`节点 ${node.id}: ${e.message}`);
      }
    }
```

（**余额不足档也返回 plans**（三轮 M2——用户恰恰这时最需要看构成）：T3 扩 plans 时该分支 `plans` 照常累计非 `[]`。`:62` errors 早退段不动。**本步只切查询与计价；plans 产出扩展归 T3。**）

4b `execution.service.ts` 三链改道（findFirst+`?? 0` 全删；**三链统一经 resolvePricingKey**——与 validation 同键同归一化；text 链删 `|| 'seed-model-kimi'` 兜底=缺模型 `MODEL_NOT_SELECTED` 4xx fail-closed）：

```ts
          // Y0b-1（E49①/Z20/Z28）：定价单源 resolver——全四键经 resolvePricingKey（归一化单源），
          // 无规则=业务错误零外呼零冻结（原 ?? 0 旁路消灭）
          const key = await resolvePricingKey(this.prisma, node);
          const pricing = key.modelId
            ? await this.resolver.resolve({ modelId: key.modelId, resolutionId: key.resolutionId, durationId: key.durationId })
            : await this.resolver.resolveByNodeTypeKey(key.pricingKey!);
          const cost = pricing.creditCost;
```

（三链同款——video 链的 duration 维由 resolvePricingKey 内归一化承载（`data.duration` 秒数→ModelDuration 行 id），image 链 resolution 同；**三链不再各写 findFirst**。三处 `if (cost > 0)` reserve 包裹保留（reserve 只做钱——T4 改金额单源）。**过渡态标注（四轮 C4）：本步三处 resolvePricingKey 调用在 T3 改 planMap 消费后即退役——两形态禁并存，T3 落地时删此三处解析。**）

4c `admin/pricing/pricing.service.ts`：calculatePrice 改 `const r = await this.resolver.resolve({ modelId: dto.modelId, resolutionId: dto.resolutionId ?? null, durationId: dto.durationId ?? null }); return r.creditCost;`（删 `?? 0`）；**batchCreate 重写**（upsert 可空列退化 create 根修——findFirst 全四键显式比对）：

```ts
  async batchCreate(rules: CreateRuleDto[]) {
    const results = [];
    for (const rule of rules) {
      // Y0b-1（F8）：可空列进复合唯一 where=Prisma 不接受 null ⇒ upsert 恒走 create 持续插行——
      // 同键重复行的生产根源。改 findFirst（全四键含 null 显式比对）→create/update。
      const existing = await this.prisma.pricingRule.findFirst({
        where: {
          nodeTypeId: rule.nodeTypeId, modelId: rule.modelId ?? null,
          resolutionId: rule.resolutionId ?? null, durationId: rule.durationId ?? null,
        },
      });
      const r = existing
        ? await this.prisma.pricingRule.update({ where: { id: existing.id }, data: { creditCost: rule.creditCost, active: true } })
        : await this.prisma.pricingRule.create({
            data: {
              nodeTypeId: rule.nodeTypeId, modelId: rule.modelId ?? null,
              resolutionId: rule.resolutionId ?? null, durationId: rule.durationId ?? null,
              creditCost: rule.creditCost,
            },
          });
      results.push(r);
    }
    return results;
  }
```

4d `public.service.ts`（第十处——用户可见报价，三轮 P3 报价同源）：calculatePrice 改道 **normalizeDimensions+resolver**（与实扣同键同归一化——web 侧补传维度后端归一化，禁 `(model,null,null)` 对 image 模型的错形查询）：

```ts
  async calculatePrice(modelId: string, resolution?: string, duration?: string | number): Promise<number> {
    // Y0b-1（三轮 P3）：报价=实扣同源——同 normalizeDimensions 归一化（label/id 双收）+同 resolver。
    // 无规则抛 PRICING_RULE_MISSING（4xx）——web 侧禁 .catch(0)（那是 ?? 0 的客户端镜像），改显示"定价不可用"
    const { resolutionId, durationId } = await normalizeDimensions(this.prisma, modelId, resolution, duration);
    const r = await this.resolver.resolve({ modelId, resolutionId, durationId });
    return r.creditCost;
  }
```

web 侧配套（`imageNodeApi.ts:41`/`imageExtNodeApi.ts:52` 的 `getCreditCost(modelId)` 改 `getCreditCost(modelId, resolution?, duration?)` 透传 node.data 维度；`ImageConfigPanel.tsx:120-123` 等调用点的 `.catch(() => setCreditCost(0))` 改 `.catch(() => setCreditCost(null))`+UI 显示"定价不可用"）。

4f **客户端字面量清理（三轮 Z30/P0-6+四轮 Z36②a——fail-closed 的客户端配套）**：

1. `nodeStore.ts` mergeNodeData 的 imageGen 默认 `model: 'sdxl'` **与 `resolution: '2K'` 两行同批注入删除**（:308/:311——同一对象的两个假默认；Z30 清单扩面）——面板 `!nodeData?.model` 本就自动选 `list[0].id`（被假默认短路）；新节点首次渲染自动选真实模型。
2. `ImageConfigPanel.tsx:40`、`EraseBottomToolbar.tsx:68` 的 `?? 'sdxl'` 与 `VideoGenNode.tsx:162/:188` 的 `?? 'hyvideo-v1.5'` 删除——空值走 MODEL_NOT_SELECTED/未选择态，不再伪造模型 id（这些 id 本就不在 AIModel 表——今天靠 `?? 0`+mock 假成功掩盖）。
3. **UI 存行 id（四轮 Z36②a——image 主链）**：`ImageConfigPanel.tsx:42` 的 `?? '2K'` 删除；`RatioResolutionPopover.tsx:63` 硬编码选项 `['1K','2K','4K']` 改**从当前模型的 `resolutions` 渲染**（`imageNodeApi.fetchModels` 的载荷已含——public.service.ts:14 `include:{resolutions,durations}` 零 API 改动）：label 显示、`onResolutionChange` 写**行 id**；缺省自动选首行（对齐 model `list[0].id` 先例）。Video 侧零改动：`resolution:'1080p'` 保留为纯展示字段（服务端声明参与制忽略——video 模型无 resolution 行）、duration 已是秒数直通归一。
4. 测试连带：`nodeStore.test.ts`/`canvasIntents.spec.ts` 的 `'sdxl'`/`'2K'` 默认值断言改为"缺省不注入，面板自动选首模型/首分辨率"语义；`ImageConfigPanel.test.tsx` 的 "1K/2K/4K resolution options" 断言改为"选项自模型 resolutions 渲染"。

4g **admin 写侧守卫（三轮+四轮 Z37 覆盖级——门禁的写侧闭环）**：`pricing.service.ts` 增私有守卫，updateRule 置 `active:false` 与 deleteRule 前以**被改规则行**调用。旧"同键 count<=1"判据在自然键唯一（NULLS NOT DISTINCT）下恒真（同键至多一行 ⇒ count∈{0,1}）——任何禁用都 409=admin 被锁死：

```ts
  /** Y0b-1（四轮 Z37 覆盖级）：禁用/删除不得使任何"已声明维度组合"失去可解析规则——与 check-pricing-coverage
   *  同源判据（表驱动：有 res 行⇒每行 (model,res,null)；有 dur 行⇒每行 (model,null,dur)；皆无⇒(model,null,null)）。 */
  private async assertCoverageAfterDeactivate(rule: { id: string; nodeTypeId: string; modelId: string | null; resolutionId: string | null; durationId: string | null }): Promise<void> {
    if (rule.modelId === null) {
      const n = await this.prisma.pricingRule.count({ where: { nodeTypeId: rule.nodeTypeId, modelId: null, active: true, id: { not: rule.id } } });
      if (n === 0) throw new BusinessException('PRICING_LAST_ACTIVE_RULE', 'kind 级 active 规则不得清零（该类编辑功能将全灭）', HttpStatus.CONFLICT);
      return;
    }
    const actWithoutSelf = (where: any) => this.prisma.pricingRule.count({ where: { ...where, modelId: rule.modelId, active: true, id: { not: rule.id } } });   // 排除本规则=模拟失活后
    const ress = await this.prisma.modelResolution.findMany({ where: { modelId: rule.modelId }, select: { id: true } });
    const durs = await this.prisma.modelDuration.findMany({ where: { modelId: rule.modelId }, select: { id: true } });
    for (const r of ress) {
      if (await actWithoutSelf({ nodeTypeId: rule.nodeTypeId, resolutionId: r.id, durationId: null }) === 0)
        throw new BusinessException('PRICING_LAST_ACTIVE_RULE', `禁用后分辨率档 ${r.id} 无 active 规则（该档位将全灭）`, HttpStatus.CONFLICT);
    }
    for (const d of durs) {
      if (await actWithoutSelf({ nodeTypeId: rule.nodeTypeId, resolutionId: null, durationId: d.id }) === 0)
        throw new BusinessException('PRICING_LAST_ACTIVE_RULE', `禁用后时长档 ${d.id} 无 active 规则（该档位将全灭）`, HttpStatus.CONFLICT);
    }
    if (ress.length === 0 && durs.length === 0 && await actWithoutSelf({ nodeTypeId: rule.nodeTypeId, resolutionId: null, durationId: null }) === 0)
      throw new BusinessException('PRICING_LAST_ACTIVE_RULE', '禁用后该模型无 active 规则（模型将全灭）', HttpStatus.CONFLICT);
  }
```

4e **图像编辑 4 kind 改道**：`ai-image-edit.constants.ts` 删 `CREDIT_COST_PER_EDIT` 行（保留队列两常量）；`ai-image-edit.processor.ts:112-114` 改：

```ts
      // Y0b-1（§1.2/Z5）：编译期常量旁路退役——预检与实扣同经 resolver（kind 级：modelId IS NULL）
      const pricing = await this.resolver.resolveByNodeTypeKey(job.data.taskType);
      const reserveResult = await this.teamCredit.reserve(
        projectTeamId, userId, pricing.creditCost, { intentRowId, intentId },
      );
```

（resolver 注入 processor；`lighting.consumer.ts:130-132` 同款 `resolveByNodeTypeKey('lighting')`；`lighting.service.ts:86-92` 预检 `(await this.resolver.resolveByNodeTypeKey('lighting')).creditCost`——三处同源。三处 reserve 调用形状 T4 再改单源，本 Task 保持旧签名。）

- [ ] **Step 5: check-pricing-coverage.mjs（纯表驱动——Z5/Z20+四轮 Z37：键常量全删，判据只看表的声明行）**

```js
#!/usr/bin/env node
// Y0b-1（E48/Z5/Z20+三轮 Z29+四轮 Z37）：定价覆盖度门禁——**纯表驱动**（无 VIDEO_KEYS/IMAGE_KEYS 常量：
// 门禁 SQL 取 nt.key（'video'/'image'）vs JS 常量 'videoGen' 是两个命名空间——恒不匹配会落 else 误报基础行缺失）。
// ①kind 级：四键（outpaint/erase/redraw/lighting——multiImageGen 并入 Z31 不建规则）各有 active 的 modelId IS NULL 规则；
// ②主链：每个 active AIModel 按其**声明行**断言——有 ModelResolution 行 ⇒ 每行一条 (model,res,null)；有 ModelDuration 行
//   ⇒ 每行一条 (model,null,dur)；皆无 ⇒ (model,null,null) 基础行。此断言与 resolver 精确匹配同键 ⇒ 兼任"选择器可达性"
//   死亡线（Z36②：门禁绿 ∧ 运行期选不中 不可能同时成立）。
// 载体=verify（deploy preflight 同链）；三轮 Z29 后主链定价数据进迁移——CI 空库也有数据，主链断言全程生效（非空转）。
// 禁兜底补行（Z16——价格臆造=?? 0 同类）。admin 红标+/api/ready degraded 载体归 Y0b-5（P11）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { Client } = createRequire(path.join(ROOT, 'apps/api/package.json'))('pg');
let url = process.env.DATABASE_URL;
if (!url) {
  const envPath = path.join(ROOT, 'apps/api/.env');
  const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) { console.error('check-pricing-coverage: DATABASE_URL 未设置'); process.exit(2); }
  url = m[1];
}

const client = new Client({ connectionString: url });
await client.connect();
const q = (s: string, p: unknown[] = []) => client.query(s, p).then((r) => r.rows);   // 三轮：参数化禁字符串插值
const problems = [];

// ① kind 级
const kindRows = await q(`SELECT nt."key", COUNT(pr.id) FILTER (WHERE pr.active AND pr."modelId" IS NULL) AS kind_rules
  FROM "NodeType" nt LEFT JOIN "PricingRule" pr ON pr."nodeTypeId" = nt.id
  WHERE nt."key" IN ('outpaint','erase','redraw','lighting') GROUP BY nt."key"`);
for (const k of ['outpaint', 'erase', 'redraw', 'lighting']) {
  const row = kindRows.find((r) => r.key === k);
  if (!row || Number(row.kind_rules) < 1) problems.push(`kind 级 "${k}" 缺 active 的 modelId IS NULL 规则（迁移 INSERT 缺失或被删）`);
}

// ② 主链（纯表驱动：维度参与=模型声明——与 normalizeDimensions 声明参与制同源，四轮 Z36/Z37）
const models = await q('SELECT m.id, m.name, nt."key" FROM "AIModel" m JOIN "NodeType" nt ON m."nodeTypeId" = nt.id WHERE m.active');
for (const m of models) {
  const rules = await q('SELECT "resolutionId", "durationId", active FROM "PricingRule" WHERE "modelId" = $1', [m.id]);
  const act = (pred: (r: any) => boolean) => rules.some((r) => r.active && pred(r));
  const ress = await q('SELECT id FROM "ModelResolution" WHERE "modelId" = $1', [m.id]);
  const durs = await q('SELECT id FROM "ModelDuration" WHERE "modelId" = $1', [m.id]);
  for (const rr of ress) {
    if (!act((r) => r.resolutionId === rr.id && r.durationId === null))
      problems.push(`模型 ${m.name} 缺 (model,${rr.id},null) active 规则——该分辨率档全灭（选择器不可达）`);
  }
  for (const d of durs) {
    if (!act((r) => r.durationId === d.id && r.resolutionId === null))
      problems.push(`模型 ${m.name} 缺 (model,null,${d.id}) active 规则——该时长档全灭（选择器不可达）`);
  }
  if (ress.length === 0 && durs.length === 0 && !act((r) => r.resolutionId === null && r.durationId === null))
    problems.push(`模型 ${m.name}(${m.key}) 缺 (model,null,null) active 基础规则——模型全灭`);
}
await client.end();
if (problems.length) { console.error(`check-pricing-coverage FAIL:\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log(`check-pricing-coverage OK: kind 级 4 键齐 + active 模型 ${models.length} 个声明维度全覆盖（纯表驱动）`);
```

- [ ] **Step 6: 门禁+回归+census**

```bash
node scripts/check-pricing-coverage.mjs           # 预期 OK（红探针：临时 UPDATE 一条规则 active=false 重跑必红后复原——输出粘 commit）
cd apps/api && npx vitest run -c vitest.int.config.ts src/modules/execution/pricing-resolver.int.spec.ts && npx vitest run && npx tsc --noEmit ; cd ../..
grep -rn "pricingRule.findFirst" apps/api/src --include="*.ts" | grep -v spec | grep -vE "pricing-resolver.service|admin/pricing/pricing.service" ; echo exit=$?
# 预期 1（零命中——admin batchCreate 的 findFirst 是唯一性预查非定价解析，白名单保留）
grep -rn "CREDIT_COST_PER_EDIT" apps/api/src | grep -v spec ; echo exit=$?    # 预期 1
```

（测试面改造：`grep -rln "pricingRule.findFirst" apps/api/src --include="*.spec.ts"` 清单逐文件把 stub 改为 `pricingResolver.resolve/resolveByNodeTypeKey` stub；旧分支语义用例按新行为重写。）

- [ ] **Step 7: verify 挂链 + Commit**

根 package.json verify 链 `check-migration-additive.mjs` 后追加 `&& node scripts/check-pricing-coverage.mjs`。

```bash
git add apps/api/src/ scripts/check-pricing-coverage.mjs package.json
git commit -m "feat(funds): Y0b-1 resolver 单源——PricingResolverService（AIModel 单源+全四键精确匹配无阶梯+kind 级 modelId IS NULL+参数校验 4xx）+pricingInputOf 模型键 census（extConfig.model/null 两补）+video duration 维度修复（Z20 死亡线：实扣≡预检）+十处改道（含 public.service 第十处）+batchCreate findFirst 化+覆盖度门禁键集自表派生进 verify（D13 红相三档留档）"
```

---

## Task 3: plan 无条件固化+reserve 金额同源+onFailed 反查（E1/E12/Z7/Z10/Z14）

**Files:**
- Modify: `apps/api/src/modules/execution/generation-intent.service.ts`（claim 扩展+Z33 ON CONFLICT 形态）、`validation.service.ts`（产出 plans）、`execution.service.ts`（消费 plans+settle 失败语义）、`ai-image-edit.controller.ts`、`lighting.controller.ts`（claim 前解析 pricing 传入）、`execution.processor.ts`（onFailed 反查+整函数兜底）、`ai-image-edit.processor.ts`（onFailed 同款整函数兜底——四轮 P1-4）、`apps/web/src/api/executionApi.ts`（executeWorkflow 删）、`apps/web/src/pages/canvas/components/nodes/TextConfigPanel.tsx`（import 收窄）
- Test: `generation-intent.service.spec.ts`（claim 输入扩）+`generation-intent.int.spec.ts`（Z33 并发用例追加）+`execution.intent.spec.ts`+`execution.processor.spec.ts`+Create `funds-four-way.int.spec.ts` 骨架（T7 收口四侧）

- [ ] **Step 1: 写红用例①（claim 固化——对现状跑）**

`generation-intent.service.spec.ts` 追加（input() helper 补 `pricing`+`teamId` 必填字段后写入）：

```ts
  it('Y0b-1/E1：claim 无条件固化定价快照（creditCost:0 也固化）+teamId 自落', async () => {
    const { intent, created } = await service.claim(input({ creditCost: 0, modelId: 'm1', pricingRuleId: 'pr1' }));
    expect(created).toBe(true);
    expect(intent).toMatchObject({
      teamId: 'team-1',
      pricingRuleId: 'pr1', modelId: 'm1', creditCost: 0,
    });
  });

  it('Y0b-1：creditCost 缺省（pricing 未给）⇒ 编译期即拒（必填参数——无条件固化由类型保证非运行时约定）', async () => {
    // @ts-expect-error pricing 必填——本用例即文档（tsc 层面保证）
    expect(() => service.claim(input({}) as any)).toThrow();
  });

`generation-intent.int.spec.ts` 追加（**int 真库——Z33 并发用例，串行单测测不出 aborted-tx 缺陷，四轮①**）：

```ts
  it('Y0b-1/Z33：同节点双 intentId 并发 claim ⇒ 一 created 一 NodeBusy（非 25P02/500）', async () => {
    const base = { projectId: PID, nodeId: `conc-${Date.now()}`, userId: UID, kind: 'text', paramsHash: 'h',
      teamId: TID, pricing: { pricingRuleId: 'pr', modelId: null, resolutionId: null, durationId: null, creditCost: 1 } };
    const r = await Promise.allSettled([
      svc.claim({ ...base, intentId: `conc-a-${Date.now()}` }),
      svc.claim({ ...base, intentId: `conc-b-${Date.now()}` }),   // 同 nodeId 异 intentId——撞 active partial unique
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rej = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(String(rej.reason)).toMatch(/busy|409/i);   // "current transaction is aborted"/500=红相（Z33 缺陷形态）
  });
```
```

（input() helper 扩展：`pricing: { pricingRuleId, modelId, resolutionId: null, durationId: null, creditCost }` + `teamId: 'team-1'` 必填。）

- [ ] **Step 2: 跑红①** —— `cd apps/api && npx vitest run src/modules/execution/generation-intent.service.spec.ts ; cd ../..` 预期 FAIL。

- [ ] **Step 3: 实现 claim 扩展**

```ts
import { randomUUID } from 'node:crypto';
// …
export interface ClaimPricing {
  pricingRuleId: string;
  modelId: string | null;
  resolutionId: string | null;
  durationId: string | null;
  creditCost: number;
}
```

**Step 3 前置 census（三轮小项 8）**——`grep -rn "\.claim(\|claimForNode(" apps/api/src --include="*.ts" | grep -v spec` 落档全部调用点（实测≥5：execution 三链/image-edit controller/lighting controller——video-project regenerate 经 execute 间接受益无需改）；**"三调用方均已持有 teamId"是错的**（三轮 P1-4：两 controller 只有 projectId）——`ProjectPermissionService` 的 resolve 本就 `select: { teamId: true }`，把 `teamId` 一起返回（**零额外查询**），controller 从 `assertEditor` 返回值取。

claim input 增 `pricing: ClaimPricing`（**必填**）与 `teamId: string`（**必填**）；**claim 方法体包 $transaction+首句 FOR SHARE 准入谓词**（三轮 Z26——普通 SELECT 不被行锁阻塞，谓词必须与 create 同事务且取共享锁才与解散的 FOR UPDATE 真互斥；谓词在五分支分派之前=rearm/重放同设防；四轮 Z33——分支①create 改 `createMany skipDuplicates` 不抛错形态，P2002 分义在健康事务内完成，禁 catch-驱动错误-后再查）：

```ts
  async claim(input: ClaimInput) {
    // Z33（四轮①）：PG 交互式事务一报错即 aborted——既有 catch-P2002-再查（:97-107，双击互斥的唯一实现）若随五分支
    // "原样入事务"（this.prisma→tx 的自然改写）必 25P02。分支①改 createMany skipDuplicates（ON CONFLICT DO
    // NOTHING 不抛错）+count 判胜，分义在**健康事务内**完成。纪律：**禁在 $transaction 内 catch 驱动错误后再查**。
    return this.prisma.$transaction(async (tx) => {
      // Z26（三轮 P0-4）：FOR SHARE 与 disbandTeam 的 FOR UPDATE 互斥——谓词与后续 create 同事务，穿门窗口真正关闭
      const teamRow = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "Team" WHERE id = ${input.teamId} FOR SHARE`;
      if (teamRow.length !== 1 || teamRow[0].status !== 'ACTIVE') {
        throw new BusinessException('TEAM_CLOSED', `团队不存在或已关闭（teamId=${input.teamId}）`, HttpStatus.CONFLICT);
      }
      // ……既有五分支状态机入事务（findUnique→②同 job 重入/③NodeBusy/④rearm/⑤幂等重放——只读与 updateMany 分支无唯一冲突风险，原样迁移）……
      // 分支①create（Z33 形态——解构剔除：...input 直接展开会把 pricing 对象带进 Prisma data=unknown field 报错）：
      const { pricing, teamId, ...rest } = input;
      const ins = await tx.generationIntent.createMany({
        data: [{
          ...rest, jobId: input.jobId ?? null, status: 'RUNNING', teamId,
          pricingRuleId: pricing.pricingRuleId, modelId: pricing.modelId,
          resolutionId: pricing.resolutionId, durationId: pricing.durationId,
          creditCost: pricing.creditCost,   // 无条件固化——creditCost:0 也不例外（E1/A2）
        }],
        skipDuplicates: true,   // ⇒ INSERT ... ON CONFLICT DO NOTHING（裸目标覆盖复合唯一+active partial unique）
      });
      const w = { projectId_intentId: { projectId: input.projectId, intentId: input.intentId } };
      if (ins.count === 1) {
        return { intent: await tx.generationIntent.findUniqueOrThrow({ where: w }), created: true };
      }
      // count===0 ⇒ 撞唯一（复合唯一或 active partial unique）——健康事务内分义（原 :98-107 三档语义原样迁移）：
      const again = await tx.generationIntent.findUnique({ where: w });
      if (again && sameCtx(again) && input.jobId && again.jobId === input.jobId && again.status === 'RUNNING') {
        return { intent: again, created: true };   // create 与同 job 重入并发——按可重入处理
      }
      if (!again) throw new NodeBusyError();          // 本 intentId 无行 ⇒ 撞活跃 partial unique（同节点异 intentId 在飞）
      if (sameCtx(again)) throw new NodeBusyError();  // 同上下文异 jobId 撞复合唯一=在飞非错配
      throw new IntentContextMismatchError();
      // ……分支④rearm 不重写定价快照（plan 固化于首次 claim，重试沿用）……
    }, { timeout: 10_000, maxWait: 5_000 });   // 四轮 C4：显式超时（默认 5s 对含 FOR SHARE 等锁的五分支偏紧）
  }
```

（rearm 分支④不重写定价快照——plan 固化于首次 claim，重试沿用。Z7：无 inputHash/docStateSeq/deadlineAt/heartbeatAt/deliveredAt 五列。）

- [ ] **Step 4: validation 产 plans + execution 三链消费（预估=plan 同源）**

`validation.service.ts` 返回形状扩展：

```ts
export interface NodePlan {
  nodeId: string;
  pricingRuleId: string;
  modelId: string | null;
  resolutionId: string | null;
  durationId: string | null;
  creditCost: number;
}
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  totalCost: number;
  plans: NodePlan[];   // Y0b-1（E1）：逐节点 resolver 快照——execute 的 claim 消费（预估=plan 同源，TOCTOU 消除）
}
```

循环内成功分支累计 `plans.push({ nodeId: node.id, pricingRuleId: r.pricingRuleId, modelId: r.modelId, resolutionId: r.resolutionId, durationId: r.durationId, creditCost: r.creditCost })`；errors 早退与余额不足档补 `plans: []`。

`execution.service.ts` 消费：

```ts
    const planMap = new Map(validationResult.plans.map((p) => [p.nodeId, p]));
```

`claimForNode` 签名增 `pricing: ClaimPricing`（必填）与 `teamId: string` 并透传：

```ts
  private claimForNode(
    projectId: string, node: any, userId: string, intentId: string | undefined,
    kind: string, params: Record<string, unknown>, jobId: string | undefined,
    pricing: ClaimPricing, teamId: string,
  ) {
    return this.intentService.claim({
      projectId, nodeId: node.id, userId, intentId: intentId ?? randomUUID(), kind,
      paramsHash: normalizeIntentParams(kind, params), jobId, pricing, teamId,
    });
  }
```

三链调用点各补两实参（`const plan = planMap.get(node.id)!;` 的五字段即 ClaimPricing 形状；`teamId=project.teamId`）；**三链 cost 改从 planMap 读**（Z10 前半——T2 的即时 resolve 变 plan 同源快照）：

```ts
          const plan = planMap.get(node.id);   // 四轮 P1-6：! 断言=TypeError 500——显式 4xx 暴露节点集分叉
          if (!plan) throw new BusinessException('PLAN_MISSING', `节点 ${node.id} 无定价快照（validation/execution 节点集分叉？）`, HttpStatus.BAD_REQUEST);
          const cost = plan.creditCost;   // plan 固化快照——reserve 前零额外解析（T4 改 reserve 内单源后此读仅为日志）
```

`ai-image-edit.controller.ts` runGuarded 与 `lighting.controller.ts` createTask 在 claim 前补 `const pricing = await this.resolver.resolveByNodeTypeKey(input.kind);`（resolver 注入两 controller）并传 `{ pricingRuleId: pricing.pricingRuleId, modelId: pricing.modelId, resolutionId: pricing.resolutionId, durationId: pricing.durationId, creditCost: pricing.creditCost }` 与 teamId——**teamId 取自 `perm.assertEditor`/`resolve` 返回值**（三轮 P1-4：`ProjectPermissionService` 的 select 已含 teamId，改为随结果返回，零额外查询；两 controller 本不持有 teamId）。

跑绿后 `npx vitest run src/modules/execution/execution.intent.spec.ts`（claim 调用断言扩 pricing 字段）。

- [ ] **Step 5: 红用例②（G-1 骨架——validation totalCost 含 text+video 维度）**

`funds-four-way.int.spec.ts` 建骨架（真实库；T4 后补台账腿、T7 收口）：

```ts
// apps/api/src/modules/execution/funds-four-way.int.spec.ts —— Y0b-1（G-1/Z18/Z20）：四处相等
// ①定价同源：validation.totalCost ≡ Σ resolver(node)（含 text 腿+video duration 维）
// ②扣费自洽：Σ settle 流水 ≡ Σ intent.creditCost（首跑限定——重放分支 if(!created) continue 不计费）
// 本 Task 只断言①的 text 腿；T4 补②；T7 混合组收口。
import { describe, it, expect } from 'vitest';

describe.skipIf(!process.env.DATABASE_URL)('Y0b-1 G-1（拆两条断言）', () => {
  it('①定价同源：validation.totalCost 含 text 节点（红相=旧实现 continue 跳过恒少算——T2 已修，此处为守护）', async () => {
    const { ValidationService } = await import('./validation.service');
    const { PricingResolverService } = await import('./pricing-resolver.service');
    const { PrismaService } = await import('../../prisma/prisma.service');
    const prisma = new PrismaService();
    const resolver = new PricingResolverService(prisma as any);
    const svc = new ValidationService(prisma as any, resolver as any);
    const models = await prisma.aIModel.findMany({ where: { active: true }, take: 3 });
    if (models.length < 1) return;
    const nodes = [
      { id: 'n-text', type: 'textInput', data: { model: models[0].id } },
      { id: 'n-img', type: 'imageGen', data: { model: models[0].id, resolution: null } },
    ];
    const r = await svc.validateAll(nodes as any[], 'team-x', 'user-x');
    expect(r.totalCost).toBeGreaterThan(0);
    expect(r.plans).toHaveLength(2);   // text 节点也产出 plan（三轮 M2：用例建真 team+balance 的形态在 T7 收口版落地）
  });
});
```

- [ ] **Step 6: onFailed 反查+整函数兜底（Z14 三件之资金面件）+executeWorkflow 删**

`execution.processor.ts` onFailed 重写：

```ts
  @OnWorkerEvent('failed')
  async onFailed(job: Job<any> | undefined, err: Error) {
    // Z 终裁（P14）：未 await 钩子抛错=unhandledRejection=进程退出——整函数兜底，绝不外抛
    try {
      if (!job) return;
      const { projectId, nodeId, intentId } = job.data ?? {};
      if (!projectId || !nodeId) return;
      const reason = String(err?.message ?? err);
      await this.collabDoc.writeExecStatus(projectId, nodeId, {
        status: 'error', error: reason.slice(0, 200), intentId: intentId ?? undefined,
      }).catch(() => {});
      // Y0b-1（§1.3/N4）：intentRowId 从不入队（死代码）——改凭 partial unique
      // generation_intent_active_node_unique 反查在飞行：付费意图悬空从 15min 压到 worker failed 即时
      // Z27：jobId 限定——迟到的失败钩子只 fail 本 job 自己的在飞意图（同节点新活意图归属不同 job，无 jobId 会被误杀=付费生成静默丢弃）
      const running = await this.intentService.findByActiveNode(projectId, nodeId, job.id);
      if (running) await this.intentService.fail(running.id, reason, job.id);
    } catch {
      // best-effort——reconcile 仍是兜底
    }
  }
```

generation-intent.service 追加：

```ts
  /** Y0b-1（N4/Z27）：partial unique 反查——worker failed 钩子用；jobId 限定防迟到钩子误杀新活意图 */
  async findByActiveNode(projectId: string, nodeId: string, jobId?: string) {
    return this.prisma.generationIntent.findFirst({ where: { projectId, nodeId, status: 'RUNNING', ...(jobId ? { jobId } : {}) } });
  }
  // Z27 双保险：fail(id, reason, jobId?) 内部 updateMany 的 where 补 jobId 条件（钩子迟到+rearm 换 job 的极限窗口）
```

`ai-image-edit.processor.ts:239-249` 的 `onFailed` **同款整函数兜底**（四轮 P1-4——spec P14 同族：未 await 钩子抛错=unhandledRejection=进程退出；writeExecStatus 补 `.catch`）：

```ts
  @OnWorkerEvent('failed')
  async onFailed(job: Job<any> | undefined, err: Error) {
    try {   // 整函数兜底——绝不外抛（unhandledRejection=worker 进程退出）
      if (!job) return;
      // ……既有 writeExecStatus 段（每步 .catch(() => {}) best-effort）+ Z27 同款 findByActiveNode(job.id) 反查 fail……
    } catch { /* best-effort——reconcile 兜底 */ }
  }
```

web 侧：`executionApi.ts` 删 `executeWorkflow` 整函数（:10-17，零生产调用方）；`TextConfigPanel.tsx` import 改 `import { enqueueWorkflow } from '@/api/executionApi';`。**sv 其余全链零触碰**（Z14——headers/getStateVector/waitForSV/指标全保留，Y0b-2 同 commit 退役）。

- [ ] **Step 7: settle 失败语义（P8）+execution_settle_failure_total 指标**

`intent-reconcile.metrics.ts` 追加 Counter `execution_settle_failure_total`（同 commit 更新 spec §10 metric-names 块——加 `- execution_settle_failure_total` 行，重跑 T0 门禁复绿）。三链 settle 段统一：

```ts
          if (cost > 0) {
            const settled = await this.teamCredit.settle({ intentRowId: intent.id, intentId: intent.intentId });
            if (settled.success) totalDeducted += cost;   // P8：已消费才计入——emit 的 totalCost=实扣真值（冻结≠消费）
            else { settleFailureTotal.inc(); this.logger.warn(`[reserve-settle] 意图 ${intent.intentId} settle 失败（对账第四分支兜底——产物照发）`); }
          }
```

- [ ] **Step 8: 回归+census+Commit**

```bash
cd apps/api && npx vitest run && npx vitest run -c vitest.int.config.ts && npx tsc --noEmit ; cd ../..
cd apps/web && npx tsc --noEmit && pnpm test -- --run ; cd ../..
grep -rn "executeWorkflow" apps/web/src ; echo exit=$?             # 预期 1
grep -rn "'consumption'" apps/api/src --include="*.ts" ; echo exit=$?   # 预期 1（T1a 已清——终验）
node scripts/check-spec-consistency.mjs    # §10 块同步后复绿
git add apps/api/src/ apps/web/src/ docs/superpowers/specs/2026-10-08-y0b-funds-and-access-design.md
git commit -m "feat(funds): Y0b-1 plan 无条件固化——claim {pricing,teamId} 必填（解构剔除防 Prisma unknown field）+creditCost NOT NULL 固化（0 也固化）+validation 产 plans（G-1 拆①定价同源：text 腿守护）+三链 planMap 消费（cost=快照同源）+settle 失败语义 P8+execution_settle_failure_total+onFailed 反查整函数兜底+executeWorkflow 删（sv 零触碰——Z14）"
```

---

## Task 4: CreditLedgerService 唯一写入口+11 写点+账户域幂等前置修复（E50/F1/F2/Z6/Z9/Z10/Z11/Z13）

**Files:**
- Create: `apps/api/src/modules/team/credit-ledger.service.ts`、`apps/api/src/modules/team/credit-ledger.int.spec.ts`、`scripts/check-ledger-single-writer.mjs`、`scripts/check-ledger-single-writer.test.mjs`
- Modify: `team-credit.service.ts`（reserve/settle/void_ 重写——金额单源）、`intent-reconcile.service.ts`（unfreeze/refund 改造+锁序）、`admin-subscription.service.ts`、`team-subscription.service.ts`（CAS 返回值检查+currentPeriodEnd select+周期键）、`team-recharge.service.ts`（CAS 保留明文化+惰性补行经 ensureBalance）、`team.bootstrap.ts`（ensureBalance+register:<teamId> 键）、`personal-team-ledger.ts`（clear/grant 分键+兜底经 ensureBalance）、`grant-credit.processor.ts`（**周期事件键**——三轮 Z24）、`payment-success.processor.ts`（referenceId 统一 order.id）、`expire-subscription.processor.ts`（周期键）、`team.service.ts`（createTeam 建钱包改经 ensureBalance——白名单收窄连带）、`apps/api/prisma/seed.ts`+`apps/api/src/prisma/platform-team.seed.ts`（三轮 M4 两处自破前提修复）、`ledger-invariants.int.spec.ts`（不变量档补齐）、相关 module providers
- Test: 既有 team-credit/intent-reconcile spec 的 mock 形状改造

- [ ] **Step 1: 写红用例（真红门——对现状跑，红相留档；CreditLedgerService 未实现=import 红）**

`credit-ledger.int.spec.ts`（真库；**全部走 `ledger.runInTx` 真事务——Z12 品牌类型禁根 client 直传**）：

```ts
// apps/api/src/modules/team/credit-ledger.int.spec.ts —— Y0b-1 资金门载体（spec §6.2 点名）
// 并发纪律=FOR UPDATE 单式；两列真值表；reversal 三配对（Z6）；台账锚 intentRowId（F1）；锁序全序（Z13——静态锚+零锁等待）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { CreditLedgerService } from './credit-ledger.service';

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as any);

function mkTeam(tag: string) {
  return prisma.team.create({ data: { id: `it-led-${tag}-${Date.now()}`, name: `it-${tag}`, ownerId: 'it-led-owner' } })
    .then((t) => prisma.teamBalance.create({ data: { teamId: t.id, credits: 100 } }).then(() => t));
}

describe('Y0b-1 CreditLedgerService（真库）', () => {
  const teams: string[] = [];
  beforeAll(async () => {
    await prisma.user.create({ data: { id: 'it-led-owner', name: 'it', email: `it-led-${Date.now()}@x.invalid`, emailVerified: false } }).catch(() => {});
  }, 20000);
  afterAll(async () => {
    await prisma.teamCreditTransaction.deleteMany({ where: { teamId: { startsWith: 'it-led-' } } }).catch(() => {});
    for (const t of [...teams].reverse()) await prisma.team.delete({ where: { id: t } }).catch(() => {});
    await prisma.generationIntent.deleteMany({ where: { intentId: { startsWith: 'led-' } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: 'it-led-owner' } }).catch(() => {});
    await prisma.$disconnect();
  }, 20000);

  it('F1 跨团队同 intentId 隔离：referenceId=intentRowId+teamId 过滤——一侧 settle 另一侧零变化', async ({ }) => {
    const a = await mkTeam('xa'); const b = await mkTeam('xb'); teams.push(a.id, b.id);
    const ia = await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: a.id, nodeId: 'n', userId: 'it-led-owner', intentId: 'led-shared', kind: 'text', paramsHash: 'h', status: 'RUNNING', creditCost: 10, deadlineAt: undefined } as any });
    const ib = await prisma.generationIntent.create({ data: { projectId: 'it-p2', teamId: b.id, nodeId: 'n', userId: 'it-led-owner', intentId: 'led-shared', kind: 'text', paramsHash: 'h', status: 'RUNNING', creditCost: 10, reservedCredits: 10 } as any });
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: a.id, type: 'reserve', creditType: 'regular', balanceDelta: -10, frozenDelta: 10, referenceId: `intent:${ia.id}` }));
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: b.id, type: 'reserve', creditType: 'regular', balanceDelta: -10, frozenDelta: 10, referenceId: `intent:${ib.id}` }));
    // settle A（镜像查询=anti-join 形态——Z6：未被 settle/release 冲销的 reserve 行）
    await ledger.runInTx(async (tx) => {
      const rowsA = await tx.$queryRaw<any[]>`
        SELECT r.* FROM "TeamCreditTransaction" r
        WHERE r."teamId" = ${a.id} AND r."referenceId" = ${'intent:' + ia.id} AND r.type = 'reserve'
          AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)`;
      for (const r of rowsA) {
        await ledger.mutate(tx, { teamId: a.id, type: 'settle', creditType: r.creditType, balanceDelta: 0, frozenDelta: r.amount, referenceId: r.referenceId, reversesId: r.id });
      }
    });
    const bSettle = await prisma.teamCreditTransaction.count({ where: { teamId: b.id, type: 'settle' } });
    const bBal = await prisma.teamBalance.findUnique({ where: { teamId: b.id } });
    expect(bSettle).toBe(0);
    expect(bBal?.credits).toBe(90);   // 仅 reserve 冻结——无 settle 侵入（红相=旧 referenceId=intentId 串账）
    await prisma.generationIntent.deleteMany({ where: { id: { in: [ia.id, ib.id] } } });
  }, 20000);

  it('两列真值表锚：settle 行 balanceDelta=0 ∧ frozenDelta=−X ∧ reversesId→reserve 行', async () => {
    const t = await mkTeam('tt'); teams.push(t.id);
    const intent = await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: t.id, nodeId: 'n', userId: 'it-led-owner', intentId: `led-tt-${Date.now()}`, kind: 'text', paramsHash: 'h', status: 'SUCCEEDED', creditCost: 5, reservedCredits: 0, creditsConsumed: 5 } as any });
    const res = await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'reserve', creditType: 'regular', balanceDelta: -5, frozenDelta: 5, referenceId: `intent:${intent.id}` }));
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'settle', creditType: 'regular', balanceDelta: 0, frozenDelta: -5, referenceId: `intent:${intent.id}`, reversesId: res.rowId }));
    const settle = await prisma.teamCreditTransaction.findFirstOrThrow({ where: { teamId: t.id, type: 'settle' } });
    expect(settle.balanceDelta).toBe(0);
    expect(settle.frozenDelta).toBe(-5);
    expect(settle.reversesId).toBe(res.rowId);
    expect(settle.balanceAfter).toBe(95);   // settle 不动余额池——balanceAfter=本池现值
    expect(settle.amount).toBe(-5);         // Z8 派生式（CHECK 强制）
    await prisma.generationIntent.deleteMany({ where: { id: intent.id } });
  }, 20000);

  it('F2 混合符号二次退款：anti-join 谓词——已 release 的 reserve 行不再进 chargeRows（红相=v1 reversesId:null 谓词必失败）', async () => {
    const t = await mkTeam('mx'); teams.push(t.id);
    const intent = await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: t.id, nodeId: 'n', userId: 'it-led-owner', intentId: `led-mx-${Date.now()}`, kind: 'text', paramsHash: 'h', status: 'RUNNING', creditCost: 10 } as any });
    const res = await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'reserve', creditType: 'regular', balanceDelta: -10, frozenDelta: 10, referenceId: `intent:${intent.id}` }));
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'release', creditType: 'regular', balanceDelta: 10, frozenDelta: -10, referenceId: `intent:${intent.id}`, reversesId: res.rowId }));
    // 新形态查询（anti-join）：已冲销行被 NOT EXISTS 排除 ⇒ 空
    const rows = await prisma.$queryRaw<any[]>`
      SELECT r.* FROM "TeamCreditTransaction" r
      WHERE r."teamId" = ${t.id} AND r."referenceId" = ${'intent:' + intent.id} AND r.type IN ('reserve','settle') AND r.amount < 0
        AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)`;
    expect(rows).toHaveLength(0);   // v1 的 reversesId:null 谓词会命中 reserve 行（其自身 reversesId 就是 null）=断言自相矛盾
    const bal = await prisma.teamBalance.findUniqueOrThrow({ where: { teamId: t.id } });
    expect(bal.credits).toBe(100);   // 冻结→release 回补，无二次退款
    await prisma.generationIntent.deleteMany({ where: { id: intent.id } });
  }, 20000);

  it('Z9 money_in 幂等：同 (recharge, outTradeNo) 二次入账 DB 拒（应用层外——直插第二条必撞唯一索引）', async () => {
    const t = await mkTeam('rc'); teams.push(t.id);
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'recharge', creditType: 'regular', balanceDelta: 10, frozenDelta: 0, referenceId: 'led-order-1' }));
    await expect(ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'recharge', creditType: 'regular', balanceDelta: 10, frozenDelta: 0, referenceId: 'led-order-1' }))).rejects.toThrow();
    const rows = await prisma.teamCreditTransaction.count({ where: { teamId: t.id, type: 'recharge', referenceId: 'led-order-1' } });
    expect(rows).toBe(1);
  }, 20000);

  it('Z24 跨期发放（三轮最重 P0 的唯一事前防线）：同 sub.id 两个周期 → 两行都写入、余额两期叠加——周期键不撞 money_in_once', async () => {
    const t = await mkTeam('pd'); teams.push(t.id);
    // 第 1 期与第 2 期（周期键不同——grant-credit.processor 的 periodKey 形态）
    for (const periodKey of ['2026-10-01', '2026-11-01']) {
      await ledger.runInTx((tx) => ledger.mutate(tx, {
        teamId: t.id, type: 'subscription_grant', creditType: 'subscription',
        balanceDelta: 30, frozenDelta: 0, referenceId: `led-sub-1:${periodKey}`,
      }));
    }
    const rows = await prisma.teamCreditTransaction.count({ where: { teamId: t.id, type: 'subscription_grant', referenceId: { startsWith: 'led-sub-1:' } } });
    expect(rows).toBe(2);   // v2 缺陷形态（同键）下第二行必撞索引本用例红
    const bal = await prisma.teamBalance.findUniqueOrThrow({ where: { teamId: t.id } });
    expect(bal.subscriptionCredits).toBe(60);
  }, 20000);

  it('Z23 ensureBalance：钱包缺失团队经 ensureBalance 后可 mutate（注册链路收口验证——lockBalance 单独用则必炸）', async () => {
    const t = await mkTeam('nb'); teams.push(t.id);
    await prisma.teamBalance.delete({ where: { teamId: t.id } }).catch(() => {});   // 模拟无钱包团队（实测 2/7 现状）
    await expect(ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'admin_grant', creditType: 'regular', balanceDelta: 5, frozenDelta: 0, referenceId: 'led-nb' }))).rejects.toThrow(/TEAM_BALANCE_MISSING/);   // lockBalance 保持严格
    await ledger.runInTx(async (tx) => {
      await ledger.ensureBalance(tx, t.id);   // 唯一创建口（幂等）
      await ledger.mutate(tx, { teamId: t.id, type: 'admin_grant', creditType: 'regular', balanceDelta: 5, frozenDelta: 0, referenceId: 'led-nb' });
    });
    const bal = await prisma.teamBalance.findUniqueOrThrow({ where: { teamId: t.id } });
    expect(bal.credits).toBe(5);
  }, 20000);

  it('admin 并发撕裂修复：8 路并发 mutate 余额与流水原子（ΣbalanceDelta≡池变化）', async () => {
    const t = await mkTeam('ad'); teams.push(t.id);
    await Promise.all([...Array(8)].map((_, i) =>
      ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'admin_grant', creditType: 'regular', balanceDelta: 10, frozenDelta: 0, referenceId: `led-admin-${i}` }))));
    const bal = await prisma.teamBalance.findUniqueOrThrow({ where: { teamId: t.id } });
    const sum = await prisma.teamCreditTransaction.aggregate({ where: { teamId: t.id, type: 'admin_grant' }, _sum: { balanceDelta: true } });
    expect(bal.credits).toBe(180);
    expect(sum._sum.balanceDelta).toBe(80);   // 不变量①（不变量档正式化）
  }, 30000);

  it('Z13 锁等待：并发 reserve×release 各 N 轮零死锁零锁等待超时（lock_timeout=3s 内完成）', async () => {
    const t = await mkTeam('lk'); teams.push(t.id);
    const intents = [];
    for (let i = 0; i < 5; i++) {
      intents.push(await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: t.id, nodeId: `n${i}`, userId: 'it-led-owner', intentId: `led-lk-${Date.now()}-${i}`, kind: 'text', paramsHash: 'h', status: 'RUNNING', creditCost: 5 } as any }));
      await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'reserve', creditType: 'regular', balanceDelta: -5, frozenDelta: 5, referenceId: `intent:${intents[i].id}` }));
    }
    const results = await Promise.allSettled(
      intents.map((x) => ledger.runInTx(async (tx) => {
        const r = await tx.teamCreditTransaction.findFirstOrThrow({ where: { referenceId: `intent:${x.id}`, type: 'reserve' } });
        return ledger.mutate(tx, { teamId: t.id, type: 'release', creditType: 'regular', balanceDelta: 5, frozenDelta: -5, referenceId: `intent:${x.id}`, reversesId: r.id });
      })),
    );
    const bad = results.filter((r) => r.status === 'rejected' && !/CREDIT_LEDGER|REVERSAL|40P01/i.test(String((r as PromiseRejectedResult).reason)));
    expect(bad).toHaveLength(0);   // 全部成功或业务拒绝——全序下死锁自由（静态锚另证）
    await prisma.generationIntent.deleteMany({ where: { id: { in: intents.map((x) => x.id) } } });
  }, 30000);

  it('rearm 二次退款（F2 姊妹）：release 后 rearm 新 reserve 行——新 settle 配新 reversesId 无冲突（Z6——settle_once 删除的根由）', async () => {
    const t = await mkTeam('rm'); teams.push(t.id);
    const intent = await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: t.id, nodeId: 'n', userId: 'it-led-owner', intentId: `led-rm-${Date.now()}`, kind: 'text', paramsHash: 'h', status: 'RUNNING', creditCost: 10 } as any });
    const res1 = await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'reserve', creditType: 'regular', balanceDelta: -10, frozenDelta: 10, referenceId: `intent:${intent.id}` }));
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'release', creditType: 'regular', balanceDelta: 10, frozenDelta: -10, referenceId: `intent:${intent.id}`, reversesId: res1.rowId }));
    // rearm 后第二次 reserve（同 referenceId 新行）+ settle（挂新 reserve 行）——settle_once 形态此处必撞键
    const res2 = await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'reserve', creditType: 'regular', balanceDelta: -10, frozenDelta: 10, referenceId: `intent:${intent.id}` }));
    await expect(ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'settle', creditType: 'regular', balanceDelta: 0, frozenDelta: -10, referenceId: `intent:${intent.id}`, reversesId: res2.rowId }))).resolves.toBeTruthy();
    await prisma.generationIntent.deleteMany({ where: { id: intent.id } });
  }, 20000);
});
```

（注：GenerationIntent 手工行不再带 deadlineAt（Z7 删列）——`as any` 兜底字段多余时移除。红阶段另以旧 team-credit 直跑 F1 一案留红相：旧 settle 镜像查询无 teamId 过滤的串账证据。**两态输出粘 commit message。**）

- [ ] **Step 2: 跑红**——`cd apps/api && npx vitest run -c vitest.int.config.ts src/modules/team/credit-ledger.int.spec.ts ; cd ../..` 预期 FAIL（模块不存在）。

- [ ] **Step 3: 实现 CreditLedgerService（品牌 tx+真值表+reversal 三配对+纯锁）**

```ts
// apps/api/src/modules/team/credit-ledger.service.ts —— Y0b-1（§1.4bis/Z6/Z9/Z10/Z11/Z12）：台账唯一写入口
// 冻结契约 4：TeamCreditTransaction 全部写操作（create/update/upsert/delete 及 Many）仅允许出现在本服务；
// delta 单源=调用方声明+本服务按真值表语义拒绝不合法组合（Z11：并持锁读 intent 行复核）。
// 并发纪律=FOR UPDATE 单式（version=单调审计计数器）+ SET LOCAL lock_timeout（Z13：55P03/超时映射可重试）。
import { Inject, Injectable, HttpStatus } from '@nestjs/common';
import type { CreditType, Prisma, TeamCreditTransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/exceptions/business.exception';

/** Z12：品牌 tx——防根 PrismaClient 结构兼容直传（锁立刻释放、"同生共死"静默失效）。
 *  唯一获得途径=ledger.runInTx 回调或 ledger.tx() 显式转换（测试绕过须 as any 留痕）。
 *  三轮修正：unique symbol 只能由 const 声明——declare const 品牌键形态（v2 的内联 unique symbol 非法 TS）。 */
declare const ledgerBrand: unique symbol;
export type LedgerTx = Prisma.TransactionClient & { readonly [ledgerBrand]: true };

export const INTENT_FUND_TYPES: readonly TeamCreditTransactionType[] = ['reserve', 'settle', 'release', 'refund'];

/** Z9：money_in 域（referenceId 必填+partial unique 承载幂等） */
export const MONEY_IN_TYPES: readonly TeamCreditTransactionType[] = ['recharge', 'subscription_grant', 'expire_clear', 'register_grant'];

export interface LedgerMutateInput {
  teamId: string;
  operatorUserId?: string | null;
  type: TeamCreditTransactionType;
  creditType: CreditType;
  /** 两列真值（§1.4bis 权威表，逐行=本池分量）：
   *  reserve(−c,+c) / settle(0,−c) / release(+c,−c) / refund(+c,0) / 账户域(±X,0)。 */
  balanceDelta: number;
  frozenDelta: number;
  referenceId?: string | null;
  reversesId?: string | null;
}

class LedgerRuleError extends Error {
  constructor(readonly code: string, msg: string) { super(`[${code}] ${msg}`); }
}

@Injectable()
export class CreditLedgerService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 唯一事务入口——测试与简单调用方用；复合事务（reserve 等）自行 $transaction 后经 tx() 转换。 */
  async runInTx<T>(fn: (tx: LedgerTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (raw) => {
      await raw.$executeRaw`SET LOCAL lock_timeout = '3s'`;   // Z13：热团队锁排队以可重试错误暴露，非 10s 事务超时
      return fn(raw as unknown as LedgerTx);
    }, { timeout: 15_000, maxWait: 5_000 });
  }

  tx(raw: Prisma.TransactionClient): LedgerTx { return raw as unknown as LedgerTx; }

  /** 锁序第一环（契约 20）。纯 SELECT FOR UPDATE——缺行=业务错误（解散物理删后行不存在；
   *  账务系统里"钱包不存在"是 bug 非可自愈状态——自愈路径收敛到下方 ensureBalance 唯一创建口）。
   *  三轮 P0-1 实测：现有 dev 库 2/7 团队无钱包行，personal-team-ledger:16 的兜底补建是承重补偿（bootstrap 失败用户）——
   *  严格性不回退，韧性经 ensureBalance 单点收口。四轮 P1-3：业务条件转 BusinessException 409（原 LedgerRuleError=500——
   *  解散竞态下用户看到 500 而非可理解错误）；TRUTH_TABLE/REVERSAL_* 保持 LedgerRuleError 500（编码 bug 非业务条件）。 */
  async lockBalance(tx: LedgerTx, teamId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ teamId: string }[]>`SELECT "teamId" FROM "TeamBalance" WHERE "teamId" = ${teamId} FOR UPDATE`;
    if (rows.length !== 1) throw new BusinessException('TEAM_BALANCE_MISSING', `TeamBalance 行不存在 teamId=${teamId}（团队未建钱包或已解散）`, HttpStatus.CONFLICT);
  }

  /** 三轮 Z23：钱包唯一创建口（幂等）——register/建团队/四处懒创建收敛于此；lockBalance 保持"缺行=错误"检测语义。
   *  Prisma 的 @default(cuid()) 是客户端生成——raw INSERT 必须自带 id（gen_random_uuid()::text——仓内先例 canvas-doc-update.repository.ts:53）。 */
  async ensureBalance(tx: LedgerTx, teamId: string): Promise<void> {
    await tx.$executeRaw`INSERT INTO "TeamBalance" ("id", "teamId", "credits", "subscriptionCredits", "version", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${teamId}, 0, 0, 0, now(), now()) ON CONFLICT ("teamId") DO NOTHING`;
  }

  /** 唯一写入口——锁 TeamBalance → 读旧态 → 校验迁移合法性 → 写池+流水。
   *  amount=派生显示字段（Z8：DB CHECK 强制同式）。Z11：intent 域持锁复核 intent 行存在+teamId 匹配（防串写）。
   *  三轮 P0-2：opts.skipIntentCheck=孤儿释放窄口（Z25）专用——跳过"意图行在场"一条，其余纪律全保留；
   *  三轮小项 12：账户域零额 noop 实现化（不写行——报表零额行无价值且 amount CHECK 会强制它=0）。 */
  async mutate(tx: LedgerTx, input: LedgerMutateInput, opts?: { skipIntentCheck?: boolean }): Promise<{ rowId: string | null; balanceAfter: number; noop?: boolean }> {
    if (MONEY_IN_TYPES.includes(input.type) && !input.referenceId) {
      throw new LedgerRuleError('LEDGER_DOMAIN', `money_in type=${input.type} referenceId 必填（Z9：事件 id）`);
    }
    await this.lockBalance(tx, input.teamId);
    if (!opts?.skipIntentCheck && (INTENT_FUND_TYPES as readonly string[]).includes(input.type)) {
      const intentRowId = input.referenceId?.startsWith('intent:') ? input.referenceId.slice(7) : null;
      if (!intentRowId) throw new LedgerRuleError('LEDGER_DOMAIN', `intent 域 type=${input.type} referenceId 必须 intent:<intentRowId>`);
      const intent = await tx.generationIntent.findUnique({ where: { id: intentRowId }, select: { teamId: true } });
      if (!intent || intent.teamId !== input.teamId) throw new LedgerRuleError('LEDGER_DOMAIN', `intent 行不存在或 teamId 不匹配（${intentRowId}）`);
    }
    const balance = await tx.teamBalance.findUniqueOrThrow({ where: { teamId: input.teamId } });
    this.assertTruthTable(input);
    if (input.reversesId) await this.assertReversal(tx, input);

    const pool = input.creditType === 'subscription' ? 'subscriptionCredits' : 'credits';
    if (input.balanceDelta === 0 && input.frozenDelta === 0) {
      return { rowId: null, balanceAfter: balance[pool], noop: true };   // 三轮：账户域零额（plan.monthlyCredits=0 档位）合法 noop；四轮 P2-7：rowId=null（空串会被当 reversesId 源消费——禁）
    }
    const next = balance[pool] + input.balanceDelta;
    if (next < 0) throw new BusinessException('CREDIT_LEDGER_NEGATIVE', `余额将变负 teamId=${input.teamId} pool=${pool}`, HttpStatus.BAD_REQUEST);   // 四轮 P1-3：业务条件 4xx（原 LedgerRuleError=500）
    await tx.teamBalance.update({
      where: { teamId: input.teamId },
      data: { [pool]: next, version: { increment: 1 } },   // version=审计计数器（禁作仲裁）
    });
    const row = await tx.teamCreditTransaction.create({
      data: {
        teamId: input.teamId,
        operatorUserId: input.operatorUserId ?? null,
        amount: input.balanceDelta !== 0 ? input.balanceDelta : input.frozenDelta,
        type: input.type,
        creditType: input.creditType,
        referenceId: input.referenceId ?? null,
        balanceAfter: next,
        balanceDelta: input.balanceDelta,
        frozenDelta: input.frozenDelta,
        reversesId: input.reversesId ?? null,
      },
    });
    return { rowId: row.id, balanceAfter: next };
  }

  /** 两列真值表逐型复核（编译期穷尽+运行时 default 拒绝）。Z9 附：账户域零额=合法 noop（plan.monthlyCredits===0 档位）。 */
  private assertTruthTable(input: LedgerMutateInput): void {
    const isIntent = (INTENT_FUND_TYPES as readonly string[]).includes(input.type);
    if (!isIntent && input.frozenDelta !== 0) {
      throw new LedgerRuleError('LEDGER_DOMAIN', `账户域 type=${input.type} frozenDelta 必须 0`);
    }
    switch (input.type) {
      case 'reserve':
        if (input.balanceDelta >= 0 || input.frozenDelta !== -input.balanceDelta) throw new LedgerRuleError('TRUTH_TABLE', 'reserve 须 (−c,+c)');
        break;
      case 'settle':
        if (input.balanceDelta !== 0 || input.frozenDelta >= 0 || !input.reversesId) throw new LedgerRuleError('TRUTH_TABLE', 'settle 须 (0,−c) 且 reversesId 指向被核销 reserve 行');
        break;
      case 'release':
        if (!input.reversesId || input.balanceDelta <= 0 || input.frozenDelta !== -input.balanceDelta) throw new LedgerRuleError('TRUTH_TABLE', 'release 须 (+c,−c) 且 reversesId');
        break;
      case 'refund':
        if (!input.reversesId || input.balanceDelta <= 0 || input.frozenDelta !== 0) throw new LedgerRuleError('TRUTH_TABLE', 'refund 须 (+c,0) 且 reversesId 指向 settle 行');
        break;
      default:
        break;   // 账户域（±X,0）——零额 noop 由调用方先 return 或此处照写零行（报表完整）
    }
  }

  /** Z6 三配对+记账轴等额：settle↔reserve（比 frozenDelta 轴）/ release↔reserve（比 balanceDelta 轴）/ refund↔settle。
   *  reversesId @unique 是 DB 兜底，这里是语义第一道。 */
  private async assertReversal(tx: LedgerTx, input: LedgerMutateInput): Promise<void> {
    const reversed = await tx.teamCreditTransaction.findUnique({ where: { id: input.reversesId! } });
    if (!reversed) throw new LedgerRuleError('REVERSAL_TARGET', `reversesId=${input.reversesId} 行不存在`);
    const pair: Record<string, string> = { settle: 'reserve', release: 'reserve', refund: 'settle' };
    const expectType = pair[input.type as keyof typeof pair];
    if (!expectType || reversed.type !== expectType) throw new LedgerRuleError('REVERSAL_PAIR', `${input.type} 须冲销 ${expectType ?? '?'} 行（实测 ${reversed.type}）`);
    if (reversed.creditType !== input.creditType) throw new LedgerRuleError('REVERSAL_POOL', '冲销行必须同池');
    const axis = input.type === 'settle' ? Math.abs(input.frozenDelta) : Math.abs(input.balanceDelta);
    if (axis !== Math.abs(reversed.amount)) throw new LedgerRuleError('REVERSAL_AMOUNT', `冲销分量不等额（${axis} ≠ ${Math.abs(reversed.amount)}——记账轴：settle 比 frozenDelta、release/refund 比 balanceDelta）`);
  }
}
```

（module：TeamModule providers+exports；SubscriptionModule/AdminModule/AiImageEditModule/ExecutionModule 按依赖图 import——T7 DI compile smoke 验证零循环。**构造器签名基准（三轮小项 2——T5/T6 测试与调用方照抄禁漂移）**：`TeamCreditService(prisma, ledger)` 两参；`IntentReconcileService(prisma, collabDoc, queue, gateway, intentService, teamCredit, ledger)`——以执行时实际依赖集为准在 T4 定稿、T5 mkSvc 逐参对齐。）

- [ ] **Step 4: team-credit.service.ts 三方法重写（金额单源+四守卫保留+mayCall）**

```ts
  /** Z10：金额单源 intent 行（plan 固化快照）——调用方无"定多少钱"的权力；TOCTOU 结构性消失。 */
  async reserve(
    userId: string,
    guard: { intentRowId: string },
  ): Promise<{ success: boolean; reason?: string; alreadyReserved?: boolean; mayCall?: boolean }> {
    try {
      return await this.prisma.$transaction(async (raw) => {
        const tx = this.ledger.tx(raw);
        await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
        const intent = await tx.generationIntent.findUniqueOrThrow({ where: { id: guard.intentRowId } });
        const teamId = intent.teamId;
        const amount = intent.creditCost;   // 单源：plan 快照
        await this.ledger.lockBalance(tx, teamId);   // 锁序①（契约 20）
        const balance = await tx.teamBalance.findUnique({ where: { teamId } });
        if (!balance) return { success: false, reason: 'TEAM_BALANCE_MISSING' };
        const member = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
        if (!member) return { success: false, reason: 'NOT_MEMBER' };   // 三轮：member 检查先于零额早退（防非成员免费外呼——reserve 是钱的入口守卫全集）
        if (amount === 0) return { success: true, mayCall: true };   // 唯一合法免费——零冻结零流水
        if (balance.credits + balance.subscriptionCredits < amount) return { success: false, reason: 'CREDIT_INSUFFICIENT' };
        const period = currentPeriod();
        const inPeriod = member.monthlyPeriod === period;
        const used = inPeriod ? member.monthlyUsed : 0;
        if (member.monthlyQuota > 0 && used + amount > member.monthlyQuota) return { success: false, reason: 'QUOTA_EXCEEDED' };
        // 锁序②：gate CAS 持锁期间完成（四守卫逐条保留——重构中禁静默删除）
        const gate = await tx.generationIntent.updateMany({
          where: { id: guard.intentRowId, reservedCredits: 0, creditsConsumed: 0 },
          data: { reservedCredits: amount },
        });
        if (gate.count === 0) {
          const row = await tx.generationIntent.findUnique({ where: { id: guard.intentRowId } });
          if (row && (row.reservedCredits > 0 || row.creditsConsumed > 0)) {
            return { success: true, alreadyReserved: true, mayCall: false };   // Z10/H7：幂等续跑但禁再外呼（同 intent 双 worker 只烧一次钱）
          }
          return { success: false, reason: 'RESERVE_GATE_LOST' };
        }
        // monthlyUsed CAS（守卫式 updateMany——FOR UPDATE 持有下无竞态）
        const usedWhere: Record<string, unknown> = { id: member.id };
        if (inPeriod) {
          usedWhere.monthlyPeriod = period;
          if (member.monthlyQuota > 0) usedWhere.monthlyUsed = { lte: member.monthlyQuota - amount };
        } else {
          usedWhere.OR = [{ monthlyPeriod: { not: period } }, { monthlyPeriod: null }];
        }
        const usedResult = await tx.teamMember.updateMany({
          where: usedWhere,
          data: { monthlyUsed: { increment: amount }, monthlyPeriod: period },
        });
        if (usedResult.count === 0) throw new ConsumeAbort('QUOTA_EXCEEDED');
        // 两池拆分——逐池经 mutate（balanceAfter=池分量 §1.4bis①）
        const subDeduct = Math.min(balance.subscriptionCredits, amount);
        const regDeduct = amount - subDeduct;
        if (subDeduct > 0) await this.ledger.mutate(tx, {
          teamId, operatorUserId: userId, type: 'reserve', creditType: 'subscription',
          balanceDelta: -subDeduct, frozenDelta: subDeduct, referenceId: `intent:${guard.intentRowId}`,
        });
        if (regDeduct > 0) await this.ledger.mutate(tx, {
          teamId, operatorUserId: userId, type: 'reserve', creditType: 'regular',
          balanceDelta: -regDeduct, frozenDelta: regDeduct, referenceId: `intent:${guard.intentRowId}`,
        });
        return { success: true, mayCall: true };
      }, { timeout: 15_000, maxWait: 5_000 });
    } catch (e) {
      if (e instanceof ConsumeAbort) return { success: false, reason: e.reason };
      throw e;
    }
  }
```

三调用点（execution 三链/processor/lighting.consumer）改 `reserve(userId, { intentRowId })`，外呼前判 `mayCall === false` → **静默退出零副作用**（四轮 Z35——推翻三轮小项 5 的"立即终态化"：`alreadyReserved`=该意图已被别人冻结/结算，典型来源是 BullMQ stall 重排且**原 worker 可能仍在跑长外呼**；败者 void_+fail 会让持有者 complete() CAS 归 0=付费产物被丢、外呼成本平台承担。改：不 void_/不 fail/不写 exec/不 emit error——warn 日志+`intent_duplicate_attempt_total` 指标后 return；悬挂收敛归 reconcile 本职〔verifyActive 5min/15min 判龄+第四分支〕）。`success:false`（含 `RESERVE_GATE_LOST` 归零态——本轮无任何冻结轨迹）才走既有 `onReserveFail` 终态化；幂等重放产物由 claim 分支⑤承担。`settle` 重写（台账锚+anti-join+锁序+reversesId 配对+CAS 崩溃修补）：

```ts
  async settle(guard: { intentRowId: string }): Promise<{ success: boolean; settled: boolean }> {
    return this.prisma.$transaction(async (raw) => {
      const tx = this.ledger.tx(raw);
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
      const row = await tx.generationIntent.findUnique({ where: { id: guard.intentRowId } });
      if (!row?.teamId) return { success: false, settled: false };
      if (row.reservedCredits === 0 && row.creditsConsumed > 0) {
        // 四轮（报2 P1-1）：CAS 后崩溃的中间态——reservedCredits 已归零但 settle 行未写（未冲销 reserve 行仍在）。
        // anti-join 查未冲销行：存在则补写（reversesId 唯一=幂等重试安全）；空才是正常的已结清早退。
        // 不修补 ⇒ 不变量②永久破+reconcileDaily "creditsConsumed vs Σ|settle|" 永久告警无法消除（告警疲劳）。
        const patchRows = await tx.$queryRaw<any[]>`
          SELECT r.* FROM "TeamCreditTransaction" r
          WHERE r."teamId" = ${row.teamId} AND r."referenceId" = ${'intent:' + guard.intentRowId} AND r.type = 'reserve'
            AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)
          FOR UPDATE OF r`;
        for (const r of patchRows) {
          await this.ledger.mutate(tx, {
            teamId: r.teamId, operatorUserId: row.userId, type: 'settle', creditType: r.creditType,
            balanceDelta: 0, frozenDelta: r.amount, referenceId: r.referenceId, reversesId: r.id,
          });
        }
        return { success: true, settled: patchRows.length > 0 };
      }
      if (row.reservedCredits === 0) return { success: false, settled: false };
      await this.ledger.lockBalance(tx, row.teamId);   // 锁序①：先于 intent CAS（契约 20 全序）
      const cas = await tx.generationIntent.updateMany({
        where: { id: guard.intentRowId, reservedCredits: row.reservedCredits },
        data: { reservedCredits: 0, creditsConsumed: row.reservedCredits },
      });
      if (cas.count === 0) return { success: true, settled: false };
      // 台账锚（F1）+anti-join（Z6）：未被 settle/release 冲销的 reserve 行——逐行配对核销
      const reserveRows = await tx.$queryRaw<any[]>`
        SELECT r.* FROM "TeamCreditTransaction" r
        WHERE r."teamId" = ${row.teamId} AND r."referenceId" = ${'intent:' + guard.intentRowId} AND r.type = 'reserve'
          AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)
        FOR UPDATE OF r`;
      for (const r of reserveRows) {
        await this.ledger.mutate(tx, {
          teamId: r.teamId, operatorUserId: row.userId, type: 'settle', creditType: r.creditType,
          balanceDelta: 0, frozenDelta: r.amount, referenceId: r.referenceId, reversesId: r.id,
        });
      }
      return { success: true, settled: true };
    }, { timeout: 15_000, maxWait: 5_000 });
  }
```

`void_` 同构（`reservedCredits: { gt: 0 }` CAS → anti-join reserveRows → `type:'release'+reversesId:r.id` → monthlyUsed decrement）。**MAX_RETRIES 常量删。**

- [ ] **Step 5: intent-reconcile unfreeze/refund 改造（锁序+CAS 补齐+anti-join）**

threeCheck 查询（:133-135）改：

```ts
    const chargeRows = await this.prisma.$queryRaw<any[]>`
      SELECT r.* FROM "TeamCreditTransaction" r
      WHERE r."teamId" = ${row.teamId ?? ''} AND r."referenceId" = ${'intent:' + row.id}
        AND r.type IN ('reserve', 'settle') AND r.amount < 0
        AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)`;
```

（row.teamId null 时空串=零命中兜底。）`:147` `finalRows = chargeRows.filter((r) => r.type === 'settle')`。

unfreeze/refund 事务重写骨架（两方法同构）：

```ts
    const done = await this.prisma.$transaction(async (raw) => {
      const tx = this.ledger.tx(raw);
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
      await this.ledger.lockBalance(tx, row.teamId!);   // 锁序①（契约 20 全序——原首句 intent CAS 是无序根源）
      const guard = await tx.generationIntent.updateMany({
        where: { id: row.id, status: 'RUNNING', updatedAt: { lt: cutoff }, reservedCredits: { gt: 0 } },   // CAS 补 reservedCredits>0（rearm 二次退款窗口关闭）
        data: { status: 'VOIDED', reservedCredits: 0, completedAt: new Date() },
      });
      if (guard.count === 0) return false;
      for (const r of reserveRows) {   // chargeRows 同 anti-join 形态（refund 用 settle 行）
        const amt = Math.abs(r.amount);
        await this.ledger.mutate(tx, {
          teamId: r.teamId, operatorUserId: row.userId, type: 'release', creditType: r.creditType,
          balanceDelta: amt, frozenDelta: -amt, referenceId: r.referenceId, reversesId: r.id,
        });
      }
      await tx.teamMember.updateMany({ where: { teamId: row.teamId!, userId: row.userId, monthlyPeriod: currentPeriod() }, data: { monthlyUsed: { decrement: total } } });
      return true;
    }, { timeout: 15_000, maxWait: 5_000 });
```

（refund：guard CAS 不变+补 `creditsConsumed: { gt: 0 }` 语义条件+事务内**重读** chargeRows（防 threeCheck 事务外旧读）；逐 settle 行 `mutate(type:'refund', balanceDelta:+amt, frozenDelta:0, reversesId:r.id)`。）

- [ ] **Step 6: 账户域 7 写点改道+Z9 前置修复+ensureBalance 收口+周期事件键（三轮 Z23/Z24）+seed 修复**

逐点（`ensureBalance+lockBalance+mutate`，事务包裹维持/补齐）：

1. **admin-subscription.service.ts grantCredit**（唯一无事务点——撕裂根修）：单事务 `ensureBalance+lockBalance+mutate({type:'admin_grant'|'admin_clear', balanceDelta:amount, frozenDelta:0, referenceId: userId})`——admin_* 不进幂等键（合法重复操作面）；原 `teamBalance.upsert` 自愈改经 ensureBalance。
2. **team-subscription.service.ts**：①`expireSubscriptions` CAS 补 `if (count === 0) return`（Z9 缺口③）+ **select 补 `currentPeriodEnd`**（三轮 M3——周期键原料）；②expire_clear 段 `referenceId = \`${sub.id}:${currentPeriodEnd.toISOString().slice(0,10)}\``（周期事件键）后改 `mutate({type:'expire_clear', creditType:'subscription', balanceDelta:-remaining, frozenDelta:0, referenceId})`；③发放段 `mutate({type:'subscription_grant', balanceDelta:plan.monthlyCredits, frozenDelta:0, referenceId: \`${order.outTradeNo}\`})`（订单号=事件 id——续期订单各不相同天然周期安全）；既有 `$queryRaw FOR UPDATE` 删（lockBalance 取代）；**月发放 CAS（:110-114）保留**。
3. **team-recharge.service.ts**：**订单状态 CAS（:169-178 updateMany where PENDING+count 判定）明文保留——本批最容易被重构吃掉的防线**（每入口一个对应用例）；:146-149 的惰性补行**保留自愈语义但改经 `ensureBalance`**（收钱路径不因钱包缺失丢账）；`FOR UPDATE` 原生行+`balance.update(increment)`+`create` 改 `lockBalance+mutate({type:'recharge', balanceDelta:order.credits, frozenDelta:0, referenceId:order.outTradeNo})`。
4. **team.bootstrap.ts**（三轮 Z23——v2 的 `lockBalance+mutate` 是鸡生蛋：钱包不存在 mutate 先炸，注册断）：`teamBalance.create+teamCreditTransaction.create` 改 `ensureBalance+lockBalance+mutate({type:'register_grant', balanceDelta:100, frozenDelta:0, referenceId: \`register:${team.id}\`})`（三轮小项 11：userId 是实体 id 违反"事件 id"契约+个人团队重建会撞全局唯一——按团队一次）；**四轮 P1-5：mutate 外层 catch P2002/23505 视为"已发放"幂等成功**（register 键撞 money_in_once=同团队既往已发——注册链路禁 500；正常路径单事务原子不会重复，此为防御纵深）。bootstrapPersonalTeam 非 DI 类——改为接收 ledger 参数（调用方传入，TeamModule 已导出）。
5. **personal-team-ledger.ts**：**clear/grant 分键**（Z9 前置③）：`grantToPersonalTeam` 内 clear 行 `referenceId: \`${referenceId}:clear\``、grant 行 `referenceId: \`${referenceId}:grant\``；`lockAndRead` 的兜底补建（:16-23 承重注释）**保留但改经 `ledger.ensureBalance`**——三路懒创建（本处/recharge/admin）全部收敛到唯一创建口；update+create 对改 mutate。
6/7. **grant-credit.processor / payment-success.processor**：**周期事件键修复（三轮 Z24——v2 最重 P0：同 sub.id 按期发放 1/3/12 期，分键后 `sub-1:grant` 每期相同 → 第 2 期撞 money_in_once → 事务回滚被 catch 吞 → 付费订阅从第 2 期起永久断供）**：

```ts
// grant-credit.processor.ts —— 周期事件 id（回滚后 nextGrantDate 不变 ⇒ 同键重试天然幂等；下一期新键）
const periodKey = sub.nextGrantDate.toISOString().slice(0, 10);
await grantToPersonalTeam(tx, sub.userId, plan.monthlyCredits, 'expire_clear', `${sub.id}:${periodKey}`);
```

（expire-subscription.processor 的 `clearPersonalTeamSubscription(..., sub.id)` 同款补 `:${currentPeriodEnd 日期}`；payment-success.processor:121 的 `newSub?.id || order.id` 统一为 `order.id`（订单号=事件 id，禁实体 id）。processor 内**订单 CAS（payment-success:42-52）保留**。）
8. **seed.ts 两处自破前提修复（三轮 M4/G2——否则不变量①巡检首日起永久 WARN=训练样本）**：`default-team` 的 `teamBalance.create({credits:100})` 无流水 → 改走 `ensureBalance+mutate(register_grant 100, referenceId:'register:default-team')`；`platform-team.seed.ts` 无钱包 → 补 `ensureBalance` 零额（四轮 C3：与 bootstrapPersonalTeam 同为纯函数——同款显式传 ledger 参数，调用方传入）。**T4 Files 增补：`apps/api/prisma/platform-team.seed.ts`。**
9. **死调用清理（四轮 B6）**：T2 4e 在 `ai-image-edit.processor.ts:112-114` 与 `lighting.consumer.ts:130-132` 加的 `resolveByNodeTypeKey` 调用随金额单源（intent 行）成为**丢弃结果的死调用**——本 Step 三调用点改道时同批删除（每笔编辑少一次无意义查询）；`lighting.service.ts:86-92` 的预检**保留**（UX 显示面）。

- [ ] **Step 7: 扫描锚（check-ledger-single-writer.mjs——全写操作集+teamBalance+裸 SQL+静态锁序锚）**

```js
#!/usr/bin/env node
// Y0b-1（§1.4bis/Z12/Z13）：台账唯一写入口+资金面纪律静态锚。
// ①TeamCreditTransaction 全写操作集（create/update/upsert/delete 及 Many）仅允许 credit-ledger.service.ts；
// ②teamBalance.(update|updateMany|upsert|create|delete) 仅允许 credit-ledger/team-credit/team.bootstrap（lockBalance 所在+两池写）；
// ③资金服务文件禁 readCanvas（冻结契约 2）；④台账 findMany 调用点 where 自有键含 teamId（禁子串假绿——teamIdSnapshot 已不存在）；
// ⑤静态锁序锚（Z13）：资金服务文件内每个函数体，generationIntent 写操作首现位置必须晚于 lockBalance 首现位置。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LEDGER = 'credit-ledger.service.ts';
// 三轮 Z23：ensureBalance 收口后白名单收窄为仅 ledger 服务（team.service/bootstrap/recharge/admin 均改调 ensureBalance——
// v2 的三文件白名单会在落地当天被 team.service.ts:55 误报打红）
const BALANCE_WRITERS = /credit-ledger\.service\.ts$/;

export function scanFiles(files) {
  const problems = [];
  for (const { rel, src } of files) {
    if (/(teamCreditTransaction\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\()/.test(src) && !rel.endsWith(`/team/${LEDGER}`)) {
      problems.push(`唯一写入口违规：${rel} 含 TeamCreditTransaction 写操作（仅允许 team/${LEDGER}）`);
    }
    if (/(teamBalance\s*\.\s*(update|updateMany|upsert|create|delete)\s*\()/.test(src) && !BALANCE_WRITERS.test(rel) && !rel.includes('.spec.')) {
      problems.push(`TeamBalance 写操作越权：${rel}（仅允许 credit-ledger.service——ensureBalance/lockBalance 唯一口）`);
    }
    // 三轮 G4：raw SQL 形态检查——T4/T5 核心查询全是 $queryRaw anti-join，正则只认 findMany 形态=新代码全在盲区
    for (const m of src.matchAll(/\$\{0,1\}(queryRaw|executeRaw)[\s\S]{0,800}?TeamCreditTransaction/g)) {
      if (!/teamId/.test(m[0])) {
        problems.push(`raw SQL 含 TeamCreditTransaction 但 800 字符内无 teamId（契约 4 raw 形态）：${rel}（偏移 ${m.index}）`);
      }
    }
    // 四轮 P1-4：raw 写 TeamBalance 检查——`UPDATE "TeamBalance" SET credits=999` 可同时躲过"写入口检查"（方法形态）
    // 与"balance 白名单"（teamBalance.* 方法形态）；只拦写（UPDATE/INSERT/DELETE），T5 drift 巡检的 raw SELECT 不误伤。
    for (const m of src.matchAll(/\$\{0,1\}(queryRaw|executeRaw)[\s\S]{0,800}?(UPDATE\s+"TeamBalance"|INSERT\s+INTO\s+"TeamBalance"|DELETE\s+FROM\s+"TeamBalance")/i)) {
      if (!/credit-ledger\.service\.ts$/.test(rel)) {
        problems.push(`raw SQL 写 TeamBalance（仅允许 credit-ledger.service——ensureBalance/lockBalance 唯一口，四轮 P1-4）：${rel}（偏移 ${m.index}）`);
      }
    }
    if (/readCanvas\s*\(/.test(src) && /(team-credit\.service|intent-reconcile\.service|credit-ledger\.service)\.ts$/.test(rel)) {
      problems.push(`资金分支禁 readCanvas（冻结契约 2）：${rel}`);
    }
    for (const m of src.matchAll(/teamCreditTransaction\s*\.\s*findMany\s*\(([\s\S]{0,600}?)\)\s*;/g)) {
      if (!/(^|[,{\s])teamId\s*:/.test(m[1])) {
        problems.push(`台账 findMany where 自有键缺 teamId（契约 4）：${rel}（偏移 ${m.index}）`);
      }
    }
    // ⑤ 静态锁序锚（三轮 M6 措辞降级：**同函数内序不变量**——跨函数/helper 调用链不在锚的覆盖面；
    //    真正的保证是 mutate/lockBalance 的调用契约+Z13 测试锚，本锚是防回归的下限而非充分条件）
    const fns = src.split(/\n(?= {2}(?:async |private |public )?\w+\s*\()/);
    for (const fn of fns) {
      const lock = fn.search(/lockBalance\s*\(/);
      const giWrite = fn.search(/generationIntent\s*\.\s*(update|updateMany|delete|deleteMany|create)\s*\(/);
      if (lock >= 0 && giWrite >= 0 && giWrite < lock) {
        problems.push(`锁序违规（契约 20：lockBalance 必须先于 GenerationIntent 写）：${rel}——GI 写出现在 lockBalance 之前`);
      }
    }
  }
  return problems;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (isMain) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const SRC = path.join(ROOT, 'apps/api/src');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'dist' ? [] : walk(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [p] : [];
  });
  const files = walk(SRC).map((f) => ({
    rel: path.relative(ROOT, f).split(path.sep).join('/'),
    src: fs.readFileSync(f, 'utf8'),
  }));
  const problems = scanFiles(files);
  if (problems.length) { console.error(`check-ledger-single-writer FAIL:\n  ${problems.join('\n  ')}`); process.exit(1); }
  console.log(`check-ledger-single-writer OK: ${files.length} 文件——写入口唯一（全操作集）+balance 写白名单+零 readCanvas+台账查询带 teamId+锁序静态锚`);
}
```

`scripts/check-ledger-single-writer.test.mjs`（node:test——合成夹具各档证红+正样本零误报；夹具含"函数内 GI 写先于 lockBalance=红"/"teamIdSnapshot 子串不满足自有键判定"/"raw UPDATE TeamBalance 越权=红"三案）。

- [ ] **Step 8: 不变量档补齐（ledger-invariants 追加）+verify 挂链**

```ts
describe('Y0b-1 G-2 三不变量+balanceAfter 分区链（§1.4bis）', () => {
  it('不变量①：per (teamId,creditType) Σ balanceDelta ≡ 当前池余额（零基线团队——全部变更仅经 mutate）', async () => {
    const ts = Date.now();
    const owner = await prisma.user.create({ data: { id: `it-inv-u-${ts}`, name: 'it', email: `it-inv-${ts}@x.invalid`, emailVerified: false } });
    const team = await prisma.team.create({ data: { id: `it-inv-${ts}`, name: 'it', ownerId: owner.id } });
    const { CreditLedgerService } = await import('../team/credit-ledger.service');
    const ledger = new CreditLedgerService(prisma as any);
    // 注意：零基线=不经 teamBalance.create 设初值——lockBalance 需行存在，故先 register_grant 建基线（计入 Σ）
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: team.id, type: 'register_grant', creditType: 'regular', balanceDelta: 100, frozenDelta: 0, referenceId: `it-inv-${ts}` }));
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: team.id, type: 'admin_grant', creditType: 'subscription', balanceDelta: 30, frozenDelta: 0, referenceId: `it-inv-${ts}:sub` }));
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: team.id, type: 'admin_clear', creditType: 'regular', balanceDelta: -40, frozenDelta: 0, referenceId: `it-inv-${ts}:clr` }));
    const rows = await prisma.$queryRaw<{ creditType: string; sum: bigint }[]>`
      SELECT "creditType", SUM("balanceDelta") AS sum FROM "TeamCreditTransaction"
      WHERE "teamId" = ${team.id} GROUP BY 1`;
    const bal = await prisma.teamBalance.findUniqueOrThrow({ where: { teamId: team.id } });
    const byPool = Object.fromEntries(rows.map((r) => [r.creditType, Number(r.sum)]));
    expect(byPool.regular).toBe(bal.credits);                    // 100−40=60
    expect(byPool.subscription).toBe(bal.subscriptionCredits);   // 30
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.user.delete({ where: { id: owner.id } });
  }, 20000);

  it('不变量②③：per intent Σ frozenDelta ≡ reservedCredits；终态 Σ balanceDelta ∈ {0,−creditsConsumed}（只核有台账行的意图）', async () => {
    const intents = await prisma.$queryRaw<any[]>`
      SELECT gi.id, gi."reservedCredits", gi."creditsConsumed", gi.status,
        COALESCE(SUM(t."frozenDelta"), 0) AS frozen_sum, COALESCE(SUM(t."balanceDelta"), 0) AS balance_sum
      FROM "GenerationIntent" gi JOIN "TeamCreditTransaction" t ON t."referenceId" = 'intent:' || gi.id
      WHERE gi."intentId" LIKE 'it-%' OR gi."intentId" LIKE 'led-%' GROUP BY gi.id`;
    for (const i of intents) {
      expect(Number(i.frozen_sum)).toBe(Number(i.reservedCredits));
      if (['SUCCEEDED', 'FAILED', 'VOIDED'].includes(i.status)) {
        expect([0, -Number(i.creditsConsumed)]).toContain(Number(i.balance_sum));
      }
    }
  }, 20000);

  it('balanceAfter 分区链：按 (teamId,creditType)+seq 排序——本行 balanceAfter ≡ 前行+本行 balanceDelta', async () => {
    const chains = await prisma.$queryRaw<any[]>`
      SELECT "teamId", "creditType", "balanceAfter", "balanceDelta" FROM "TeamCreditTransaction"
      WHERE "teamId" LIKE 'it-inv-%' OR "teamId" LIKE 'it-led-%' ORDER BY "teamId", "creditType", seq`;
    let prev = null;
    for (const r of chains) {
      const k = `${r.teamId}|${r.creditType}`;
      if (prev && prev.k === k) {
        expect(Number(r.balanceAfter)).toBe(prev.after + Number(r.balanceDelta));
      }
      prev = { k, after: Number(r.balanceAfter) };
    }
  }, 20000);
});
```

（不变量②③只核 `it-`/`led-` 前缀意图+JOIN 强制有台账行——手工构造 intent 行须补与台账一致的字段（ib reservedCredits:10/tt creditsConsumed:5 类）。verify 链 `check-pricing-coverage` 后追加 `&& node scripts/check-ledger-single-writer.mjs`。）

- [ ] **Step 9: 回归+两态留档+Commit**

```bash
cd apps/api && npx vitest run -c vitest.int.config.ts src/modules/team/credit-ledger.int.spec.ts src/modules/execution/ledger-invariants.int.spec.ts && npx vitest run && npx tsc --noEmit ; cd ../..
node scripts/check-ledger-single-writer.mjs && node --test scripts/check-ledger-single-writer.test.mjs
git add apps/api/src/ scripts/check-ledger-single-writer.mjs scripts/check-ledger-single-writer.test.mjs package.json
git commit -m "feat(funds): Y0b-1 CreditLedgerService 台账唯一写入口——品牌 tx+runInTx(lock_timeout 3s)+mutate(intent 行持锁复核+真值表+reversal 三配对记账轴校验+money_in referenceId 必填)+lockBalance 纯锁缺行业务错误；reserve 金额单源 intent 行+mayCall 收口 H7；settle/void_ anti-join 锚 intentRowId；账户域 7 写点+Z9 前置修复（expire_clear referenceId/CAS 返回值/clear-grant 分键/三支付 CAS 明文保留）；扫描锚全操作集+balance 白名单+静态锁序锚——真红门红绿两态留档"
```

---

## Task 5: settle 失败对账闭环+第四分支（status 判据）+运行时巡检三层（E25①/E49②/E72/Z11/Z17）

**Files:**
- Modify: `intent-reconcile.service.ts`（settleStranded 5min 档+逐行容错+F7 守卫提取+①查询锚切换+巡检+孤儿谓词四轮收窄）、`intent-reconcile.metrics.ts`（**指标名全量一次进 §10——四轮 B2**：`intent_frozen_stranded_total`/`ledger_balance_drift_total`/`ledger_frozen_drift_total`/`intent_frozen_orphan_total`/`ledger_orphan_unreleasable_total` 五新指标；另有 `execution_settle_failure_total`（T3 落）与 `intent_duplicate_attempt_total`（T4 Z35 落）——**七个名字同 commit 进 spec §10 metric-names 块**，缺一 T0 门禁即红）、`intent-reconcile.service.spec.ts`
- Test: `ledger-invariants.int.spec.ts` 追加闭环档

- [ ] **Step 1: 写红用例（对现状跑——settleStranded/cleanTerminalIntents/releaseOrphanedReserves 不存在=TypeError 红）**

`ledger-invariants.int.spec.ts` 追加（同文件 OWNER 复用）：

```ts
describe('Y0b-1 settle 失败对账闭环（§1.5/Z17）', () => {
  const mkSvc = async () => {
    const { IntentReconcileService } = await import('./intent-reconcile.service');
    const { TeamCreditService } = await import('../team/team-credit.service');
    const { CreditLedgerService } = await import('../team/credit-ledger.service');
    const ledger = new CreditLedgerService(prisma as any);
    const teamCredit = new TeamCreditService(prisma as any, ledger);   // 三轮小项 2：构造器按 T4 基准两参对齐
    return new IntentReconcileService(prisma as any, {} as any, {} as any, {} as any, {} as any, teamCredit, ledger);
  };
  afterAll(async () => {
    await prisma.generationIntent.deleteMany({ where: { intentId: { startsWith: 'cls-' } } });
    await prisma.team.deleteMany({ where: { id: { startsWith: 'it-cls-' } } });
  }, 20000);
  it('悬留已交付（SUCCEEDED∧reservedCredits>0）→ settleStranded 补 settle（红=方法不存在；判据=status 非 deliveredAt——Z7/Z17）', async () => {
    const ts = Date.now();
    const team = await prisma.team.create({ data: { id: `it-cls-a-${ts}`, name: 'it', ownerId: OWNER } });
    const intent = await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: team.id, nodeId: 'n', userId: OWNER, intentId: `cls-a-${ts}`, kind: 'text', paramsHash: 'h', status: 'SUCCEEDED', creditCost: 7, reservedCredits: 7 } as any });
    const { CreditLedgerService } = await import('../team/credit-ledger.service');
    const ledger = new CreditLedgerService(prisma as any);
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: team.id, type: 'reserve', creditType: 'regular', balanceDelta: -7, frozenDelta: 7, referenceId: `intent:${intent.id}` }));
    const svc = await mkSvc();
    await (svc as any).settleStranded();   // 红：现状无此方法
    const row = await prisma.generationIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(row.reservedCredits).toBe(0);
    expect(row.creditsConsumed).toBe(7);
    const settle = await prisma.teamCreditTransaction.findFirst({ where: { teamId: team.id, type: 'settle' } });
    expect(settle?.frozenDelta).toBe(-7);   // 两列真值表：settle(0,−c)
  }, 20000);
  it('悬留未交付（FAILED∧reservedCredits>0）→ VOIDED+release（reversesId→reserve 行）', async () => {
    const ts = Date.now();
    const team = await prisma.team.create({ data: { id: `it-cls-c-${ts}`, name: 'it', ownerId: OWNER } });
    const intent = await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: team.id, nodeId: 'n', userId: OWNER, intentId: `cls-c-${ts}`, kind: 'text', paramsHash: 'h', status: 'FAILED', creditCost: 5, reservedCredits: 5, completedAt: new Date() } as any });
    const { CreditLedgerService } = await import('../team/credit-ledger.service');
    const ledger = new CreditLedgerService(prisma as any);
    const res = await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: team.id, type: 'reserve', creditType: 'regular', balanceDelta: -5, frozenDelta: 5, referenceId: `intent:${intent.id}` }));
    const svc = await mkSvc();
    await (svc as any).settleStranded();
    const row = await prisma.generationIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(row.reservedCredits).toBe(0);
    const rel = await prisma.teamCreditTransaction.findFirst({ where: { teamId: team.id, type: 'release' } });
    expect(rel?.reversesId).toBe(res.rowId);   // 冲销链指向 reserve 行
  }, 20000);
  it('F7：终态∧reservedCredits>0 的 7 天行不被 cleanTerminalIntents 清理；普通终态行照清', async () => {
    const ts = Date.now();
    const old = new Date(Date.now() - 8 * 24 * 3600_000);
    const stranded = await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: 'it-none', nodeId: 'n', userId: OWNER, intentId: `cls-b1-${ts}`, kind: 'text', paramsHash: 'h', status: 'FAILED', creditCost: 5, reservedCredits: 5, completedAt: old } as any });
    const normal = await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: 'it-none', nodeId: 'n2', userId: OWNER, intentId: `cls-b2-${ts}`, kind: 'text', paramsHash: 'h', status: 'SUCCEEDED', creditCost: 1, reservedCredits: 0, creditsConsumed: 1, completedAt: old } as any });
    const svc = await mkSvc();
    await (svc as any).cleanTerminalIntents();   // 红：现状无此提取方法
    expect(await prisma.generationIntent.findUnique({ where: { id: stranded.id } })).not.toBeNull();   // 冻结未清禁删
    expect(await prisma.generationIntent.findUnique({ where: { id: normal.id } })).toBeNull();        // 正常终态照清
  }, 20000);
  it('Z11 未闭合义务巡检：reserve 行未被冲销∧意图不存活∧超时 → 幂等释放（意图行丢失⇒钱可释放的结构洞关闭）', async () => {
    const ts = Date.now();
    const team = await prisma.team.create({ data: { id: `it-cls-o-${ts}`, name: 'it', ownerId: OWNER } });
    const intent = await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: team.id, nodeId: 'n', userId: OWNER, intentId: `cls-o-${ts}`, kind: 'text', paramsHash: 'h', status: 'FAILED', creditCost: 6, reservedCredits: 0, creditsConsumed: 0, completedAt: new Date(Date.now() - 20 * 60_000) } as any });
    const { CreditLedgerService } = await import('../team/credit-ledger.service');
    const ledger = new CreditLedgerService(prisma as any);
    const res = await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: team.id, type: 'reserve', creditType: 'regular', balanceDelta: -6, frozenDelta: 6, referenceId: `intent:${intent.id}` }));
    await prisma.generationIntent.delete({ where: { id: intent.id } });   // 模拟意图行丢失——reserve 行成为孤儿
    const svc = await mkSvc();
    const released = await (svc as any).releaseOrphanedReserves();   // 红：现状无此方法
    expect(released).toBe(1);
    const rel = await prisma.teamCreditTransaction.findFirst({ where: { teamId: team.id, type: 'release', reversesId: res.rowId } });
    expect(rel).not.toBeNull();   // 台账侧幂等释放
    const again = await (svc as any).releaseOrphanedReserves();
    expect(again).toBe(0);   // 幂等——reversesId 唯一键保证二次调用零动作
  }, 20000);
  it('Z25 反例（防洞静默回归）：SUCCEEDED∧冻结未销的行不被 releaseOrphanedReserves 释放（settleStranded 独占——E53）', async () => {
    const ts = Date.now();
    const team = await prisma.team.create({ data: { id: `it-cls-s-${ts}`, name: 'it', ownerId: OWNER } });
    await prisma.teamBalance.create({ data: { teamId: team.id, credits: 0 } }).catch(() => {});
    const intent = await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: team.id, nodeId: 'n', userId: OWNER, intentId: `cls-s-${ts}`, kind: 'text', paramsHash: 'h', status: 'SUCCEEDED', creditCost: 8, reservedCredits: 8, completedAt: new Date(Date.now() - 20 * 60_000) } as any });
    const { CreditLedgerService } = await import('../team/credit-ledger.service');
    const ledger = new CreditLedgerService(prisma as any);
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: team.id, type: 'reserve', creditType: 'regular', balanceDelta: -8, frozenDelta: 8, referenceId: `intent:${intent.id}` }));
    const svc = await mkSvc();
    const released = await (svc as any).releaseOrphanedReserves();
    expect(released).toBe(0);   // 意图行存在（SUCCEEDED）——四轮 Z38 谓词 gi.id IS NULL 必零命中（settleStranded 独占，E53）
    const rel = await prisma.teamCreditTransaction.count({ where: { teamId: team.id, type: 'release' } });
    expect(rel).toBe(0);   // 未被退——等待 settleStranded 补收
  }, 20000);
});
```

- [ ] **Step 2: 跑红**（四用例对现状红）。

- [ ] **Step 3: 实现（reconcileDaily 五处改）**

① 对账查询锚切换（:251-252）：`referenceId: 'intent:'+r.id`（consumption 已随 T1a 清）。
② F7 守卫提取：

```ts
  /** F7（Y0b-1 §1.5）：终态保留清理——冻结未清的行禁删（stranded 计数告警）；第四分支清账后次轮自然可删。 */
  private async cleanTerminalIntents(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    const stuck = await this.prisma.generationIntent.count({
      where: { status: { in: [...TERMINAL] }, reservedCredits: { gt: 0 }, completedAt: { lt: cutoff } },
    });
    if (stuck > 0) strandedTotal.inc(stuck);
    await this.prisma.generationIntent.deleteMany({
      where: { status: { in: [...TERMINAL] }, reservedCredits: 0, completedAt: { lt: cutoff } },
    });
  }
```

③ **第四分支**（Z17：判据=status——SUCCEEDED=complete() 已达即交付事实，与 E53 一致；挂 5min 档）：

```ts
  /** Y0b-1（§1.5/E25①/Z17）第四分支：终态∧reservedCredits>0 悬留行（settle 失败崩溃窗——三查只扫 RUNNING）。
   *  SUCCEEDED ⇒ 补 settle（幂等 CAS）；FAILED/VOIDED ⇒ release（void_ 既有幂等链）。产物已照发（E53），账由本分支闭环。 */
  private async settleStranded(): Promise<void> {
    const stranded = await this.prisma.generationIntent.findMany({
      where: { status: { in: [...TERMINAL] }, reservedCredits: { gt: 0 } },
      orderBy: { completedAt: 'asc' },
      take: 100,   // 空预算：每轮 5min 最多 100 行
    });
    for (const row of stranded) {
      try {
        if (row.status === 'SUCCEEDED') {
          const r = await this.teamCredit.settle({ intentRowId: row.id });
          if (!r.success) this.logger.warn(`[intent-reconcile] 悬留补 settle 失败 意图 ${row.intentId}（次轮重试）`);
        } else {
          await this.teamCredit.void_({ intentRowId: row.id });   // FAILED/VOIDED 残留冻结——release 归零
          this.logger.warn(`[intent-reconcile] 悬留未交付 意图 ${row.intentId}——release ${row.reservedCredits}`);
        }
      } catch (e) {
        this.logger.warn(`[intent-reconcile] settleStranded 单行失败 意图 ${row.intentId}: ${e}`);   // 毒行不冻结整轮——次轮重试
      }
    }
  }
```

④ **Z11 未闭合义务巡检（三轮 Z25 三层修正）**——台账侧第二道（F7 降级为第一道）：

```ts
  /** Y0b-1（Z11/Z25+四轮 Z38）：台账侧孤儿冻结——reserve 行未被冲销 ∧ **意图行真丢失**（gi.id IS NULL）∧ 超 15min
   *  ⇒ 经 releaseOrphanReserve 窄口（skipIntentCheck）幂等释放。
   *  四轮收窄（推翻三轮的 `OR gi.status IN ('FAILED','VOIDED')`）：意图行**存在**的一切情形归 void_/settleStranded
   *  全权处理（含 monthlyUsed 回滚与 reservedCredits 同事务归零——窄口两样都跳过=quota 永久占用+不变量②中间态破）；
   *  孤儿=行已灭失（quota 无法归因——登记残余），窄口只为此类存在。
   *  钱包存在前置（解散后钱包已级联删——不可释放者计数排除，不每轮刷屏占 LIMIT 槽）。 */
  private async releaseOrphanedReserves(): Promise<number> {
    const orphans = await this.prisma.$queryRaw<{ id: string; teamId: string; creditType: string; amount: number; referenceId: string }[]>`
      SELECT r.id, r."teamId", r."creditType", r.amount, r."referenceId"
      FROM "TeamCreditTransaction" r
      LEFT JOIN "GenerationIntent" gi ON r."referenceId" = 'intent:' || gi.id
      WHERE r.type = 'reserve' AND r."referenceId" LIKE 'intent:%'
        AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)
        AND r."createdAt" < now() - interval '15 minutes'
        AND gi.id IS NULL   -- 四轮 Z38：意图行存在（任何 status——含 SUCCEEDED/FAILED/VOIDED）一律不在此释放
        AND EXISTS (SELECT 1 FROM "TeamBalance" b WHERE b."teamId" = r."teamId")   -- 钱包在者才可释放
      ORDER BY r."createdAt"   -- 确定性（四轮 P1-3：LIMIT 无 ORDER BY=不确定子集）
      LIMIT 100`;
    // 钱包已消失的未冲销 reserve 行（解散销毁）——**带龄过滤**计数（四轮 B2：无龄过滤=同一批每 5min 重复累加指标）
    await this.prisma.$queryRaw`SELECT r.id FROM "TeamCreditTransaction" r
      WHERE r.type = 'reserve' AND r."referenceId" LIKE 'intent:%'
        AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)
        AND NOT EXISTS (SELECT 1 FROM "TeamBalance" b WHERE b."teamId" = r."teamId")
        AND r."createdAt" < now() - interval '15 minutes'
      ORDER BY r."createdAt" LIMIT 50`.then((rows: unknown[]) => { if (rows.length) unreleasableTotal.inc(rows.length); });
    let released = 0;
    for (const r of orphans) {
      try {
        await this.prisma.$transaction(async (raw) => {
          const tx = this.ledger.tx(raw);
          await this.ledger.lockBalance(tx, r.teamId);
          await this.ledger.releaseOrphanReserve(tx, {
            teamId: r.teamId, creditType: r.creditType as any, referenceId: r.referenceId,
            reversesId: r.id, amount: r.amount,   // 唯一键=幂等；意图行在 FAILED/VOIDED 情形的 reservedCredits 由第四分支/void_ 既有 CAS 收敛
          });
        }, { timeout: 15_000 });
        released++;
        orphanTotal.inc();
        this.logger.warn(`[intent-reconcile] 孤儿冻结释放 reserve=${r.id} ref=${r.referenceId}`);
      } catch (e) {
        this.logger.warn(`[intent-reconcile] 孤儿释放单行失败 ${r.id}: ${e}`);   // 毒行次轮重试
      }
    }
    return released;
  }
```

ledger 服务补窄口方法（Step 3 同 commit）：

```ts
  /** Z25 窄口：意图行已灭失的孤儿冻结释放——只跳过"意图行在场"校验，真值表/冲销配对/锁序纪律全保留。 */
  async releaseOrphanReserve(tx: LedgerTx, r: { teamId: string; creditType: CreditType; referenceId: string; reversesId: string; amount: number }) {
    return this.mutate(tx, {
      teamId: r.teamId, type: 'release', creditType: r.creditType,
      balanceDelta: Math.abs(r.amount), frozenDelta: -Math.abs(r.amount),
      referenceId: r.referenceId, reversesId: r.reversesId,
    }, { skipIntentCheck: true });
  }
```

⑤ **三不变量运行时巡检**（Z11 条件②——不变量不能只活在测试里）+ **sweepOrphanExec 限量**（:271-290 改 `findMany({ select: { id: true }, orderBy: { updatedAt: 'desc' }, take: 10 })`——懒回收登记 Y0b-2）：

```ts
  /** Y0b-1（Z11）：运行时不变量巡检——聚合 SQL 命中即 drift 指标+WARN（台账为真源，钱包可据 Σ 重建） */
  private async verifyLedgerInvariants(): Promise<void> {
    // 四轮 B1：LEFT JOIN+COALESCE+两池分列——INNER JOIN 检不出"有钱包有余额但零流水"（恰是 M4 修的那类 seed 破坏，
    // 修复后本巡检仍要能抓它）；两池独立断言（有余额无行/有行无余额双向都报）。
    const drift1 = await this.prisma.$queryRaw<{ teamId: string }[]>`
      SELECT b."teamId" FROM "TeamBalance" b
      LEFT JOIN (SELECT "teamId", "creditType", SUM("balanceDelta") s FROM "TeamCreditTransaction" GROUP BY 1,2) t
        ON t."teamId" = b."teamId" AND t."creditType" = 'regular'
      WHERE COALESCE(t.s, 0) <> b.credits
      UNION
      SELECT b."teamId" FROM "TeamBalance" b
      LEFT JOIN (SELECT "teamId", "creditType", SUM("balanceDelta") s FROM "TeamCreditTransaction" GROUP BY 1,2) t
        ON t."teamId" = b."teamId" AND t."creditType" = 'subscription'
      WHERE COALESCE(t.s, 0) <> b."subscriptionCredits"
      LIMIT 20`;
    for (const d of drift1) { balanceDriftTotal.inc(); this.logger.warn(`[ledger-drift] 不变量①漂移 teamId=${d.teamId}`); }
    const drift2 = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT gi.id FROM "GenerationIntent" gi
      JOIN (SELECT "referenceId", SUM("frozenDelta") s FROM "TeamCreditTransaction" WHERE "referenceId" LIKE 'intent:%' GROUP BY 1) t
        ON t."referenceId" = 'intent:' || gi.id
      WHERE t.s <> gi."reservedCredits" AND gi.status = 'RUNNING' LIMIT 20`;
    for (const d of drift2) { frozenDriftTotal.inc(); this.logger.warn(`[ledger-drift] 不变量②漂移 intent=${d.id}`); }
    // 三轮 M4/Z23：钱包体检——ACTIVE 团队无钱包行=0（实测曾有 2/7；ensureBalance 收口后的回归检查）
    const noWallet = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT t.id FROM "Team" t LEFT JOIN "TeamBalance" b ON b."teamId" = t.id
      WHERE t.status = 'ACTIVE' AND b."teamId" IS NULL LIMIT 20`;
    for (const d of noWallet) { balanceDriftTotal.inc(); this.logger.warn(`[ledger-drift] ACTIVE 团队无钱包 teamId=${d.id}（ensureBalance 缺收口）`); }
  }
```

调度接线：`verifyActive`（5min 档）尾部追加 `await this.settleStranded(); await this.releaseOrphanedReserves();`；`reconcileDaily` 追加 `await this.verifyLedgerInvariants();`（①②锚切换+cleanTerminalIntents 调用点替换不变）。启动路径注记：onModuleInit 的 verifyActive 本就 PG-only（E72① 现状满足）。

- [ ] **Step 4: 跑绿+回归+Commit**

```bash
cd apps/api && npx vitest run -c vitest.int.config.ts src/modules/execution/ledger-invariants.int.spec.ts && npx vitest run ; cd ../..
node scripts/check-spec-consistency.mjs    # §10 metric-names 块加五指标后复绿（七名全量对齐——四轮 B2）
git add apps/api/src/modules/execution/ apps/api/src/modules/team/
git commit -m "feat(funds): Y0b-1 settle 失败对账闭环——第四分支（Z17 status 判据：SUCCEEDED 补 settle/FAILED release）挂 5min 档+逐行容错+F7 守卫提取+Z11 未闭合义务巡检（孤儿 reserve 幂等 release）+三不变量运行时巡检（drift 指标）+sweepOrphanExec 限量——红相=悬留行落不进任何分支+方法不存在四案留档"
```

---

## Task 6: 团队/项目生命周期资金门（Z4 准入谓词+单事务销毁+force-void 出口）

**Files:**
- Create: `apps/api/src/modules/team/team-funds-gate.service.ts`、`apps/api/src/modules/team/team-lifecycle-funds.int.spec.ts`
- Modify: `team.service.ts`（disbandTeam 单事务化）、`generation-intent.service.ts`（claim 准入谓词）、`project.service.ts`（delete/cleanDrafts）、`template.service.ts:158`、admin 模块（force-void 出口）、TeamModule providers+exports

- [ ] **Step 1: 写红用例（对现状跑）**

```ts
// apps/api/src/modules/team/team-lifecycle-funds.int.spec.ts —— Y0b-1 资金门载体（spec §6.2 点名）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Y0b-1 团队/项目生命周期资金门（§1.4ter/Z4）', () => {
  const S = { keeper: '' };
  beforeAll(async () => {
    const ts = Date.now();
    S.keeper = `it-lf-keeper-${ts}`;
    await prisma.user.create({ data: { id: S.keeper, name: 'k', email: `${S.keeper}@x.invalid`, emailVerified: false } });
    await prisma.team.create({ data: { id: `it-lf-t1-${ts}`, name: 't1', ownerId: S.keeper } });
    await prisma.team.create({ data: { id: `it-lf-t2-${ts}`, name: 't2', ownerId: S.keeper } });   // 多团队（解散合法性前提）
    await prisma.teamMember.createMany({ data: [
      { teamId: `it-lf-t1-${ts}`, userId: S.keeper, role: 'OWNER' },
      { teamId: `it-lf-t2-${ts}`, userId: S.keeper, role: 'OWNER' },
    ] });
  }, 20000);
  afterAll(async () => {
    // 清理序（Team.owner Restrict）：意图 → 团队（级联）→ 用户
    await prisma.generationIntent.deleteMany({ where: { intentId: { startsWith: 'lf-' } } }).catch(() => {});
    await prisma.generationIntent.deleteMany({ where: { intentId: { startsWith: 'pf-' } } }).catch(() => {});
    await prisma.team.deleteMany({ where: { id: { startsWith: 'it-lf-' } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { startsWith: 'it-lf-' } } }).catch(() => {});
    await prisma.$disconnect();
  }, 20000);

  it('在飞 RUNNING∧reservedCredits>0 ⇒ 门 409 TEAM_HAS_ACTIVE_FUNDS（红=现状无门）', async () => {
    const ts = Date.now();
    const team = `it-lf-act-${ts}`;
    await prisma.team.create({ data: { id: team, name: 'act', ownerId: S.keeper } });
    await prisma.teamMember.create({ data: { teamId: team, userId: S.keeper, role: 'OWNER' } });
    await prisma.teamBalance.create({ data: { teamId: team, credits: 100 } });
    await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: team, nodeId: 'n', userId: S.keeper, intentId: `lf-${ts}`, kind: 'text', paramsHash: 'h', status: 'RUNNING', creditCost: 5, reservedCredits: 5 } as any });
    const { TeamFundsGateService } = await import('./team-funds-gate.service');
    const gate = new TeamFundsGateService(prisma as any);
    await expect(gate.assertSettled(prisma as any, { teamId: team })).rejects.toMatchObject({ errorCode: 'TEAM_HAS_ACTIVE_FUNDS' });
    await prisma.generationIntent.deleteMany({ where: { teamId: team } });
    await expect(gate.assertSettled(prisma as any, { teamId: team })).resolves.toBeUndefined();   // 终态后放行
    await prisma.team.delete({ where: { id: team } });
  }, 20000);

  it('Z4 准入谓词：DISBANDED 团队的 claim ⇒ 409 TEAM_CLOSED（红=现状 claim 不看 team.status）', async () => {
    const ts = Date.now();
    const team = `it-lf-dis-${ts}`;
    await prisma.team.create({ data: { id: team, name: 'dis', ownerId: S.keeper, status: 'DISBANDED' } });
    const { GenerationIntentService } = await import('../execution/generation-intent.service');
    const svc = new GenerationIntentService(prisma as any);
    await expect(svc.claim({
      projectId: 'it-p', nodeId: 'n', userId: S.keeper, intentId: `lf-dis-${ts}`, kind: 'text', paramsHash: 'h',
      teamId: team, pricing: { pricingRuleId: 'pr', modelId: null, resolutionId: null, durationId: null, creditCost: 1 },
    } as any)).rejects.toMatchObject({ errorCode: 'TEAM_CLOSED' });
    await prisma.team.delete({ where: { id: team } });
  }, 20000);

  it('项目删除同门（projectId 维度）', async () => {
    const ts = Date.now();
    const team = `it-lf-prj-${ts}`;
    await prisma.team.create({ data: { id: team, name: 'prj', ownerId: S.keeper } });
    await prisma.generationIntent.create({ data: { projectId: `it-pj-${ts}`, teamId: team, nodeId: 'n', userId: S.keeper, intentId: `pf-${ts}`, kind: 'image', paramsHash: 'h', status: 'RUNNING', creditCost: 3, reservedCredits: 3 } as any });
    const { TeamFundsGateService } = await import('./team-funds-gate.service');
    const gate = new TeamFundsGateService(prisma as any);
    await expect(gate.assertSettled(prisma as any, { projectId: `it-pj-${ts}` })).rejects.toMatchObject({ errorCode: 'TEAM_HAS_ACTIVE_FUNDS' });
    await prisma.generationIntent.deleteMany({ where: { projectId: `it-pj-${ts}` } });
  }, 20000);

  it('Z4 解散后审计留痕：物理删团队（级联删 balance）——台账行 teamId 仍在可 Σ（红相=旧置空行查询不可见）', async () => {
    const ts = Date.now();
    const team = `it-lf-snap-${ts}`;
    await prisma.team.create({ data: { id: team, name: 'snap', ownerId: S.keeper } });
    await prisma.teamBalance.create({ data: { teamId: team, credits: 0 } });
    const { CreditLedgerService } = await import('./credit-ledger.service');
    const ledger = new CreditLedgerService(prisma as any);
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: team, type: 'admin_grant', creditType: 'regular', balanceDelta: 50, frozenDelta: 0, referenceId: `lf-snap-${ts}` }));
    await prisma.team.delete({ where: { id: team } });   // 级联删 balance（teamId 无 FK 不级联流水）
    const sum = await prisma.$queryRaw<{ s: bigint }[]>`SELECT COALESCE(SUM("balanceDelta"), 0) AS s FROM "TeamCreditTransaction" WHERE "teamId" = ${team}`;
    expect(Number(sum[0].s)).toBe(50);   // 审计锚保留——解散后对账纯 SQL
  }, 20000);
});
```

- [ ] **Step 2: 跑红 → 实现 gate+准入谓词+单事务销毁+force-void**

```ts
// apps/api/src/modules/team/team-funds-gate.service.ts —— Y0b-1（§1.4ter/Z4）：解散/删项目前置清算门
import { Inject, Injectable, HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TeamFundsGateService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 存在 RUNNING 或 reservedCredits>0 ⇒ 409（等待在飞完成或 admin force-void 后重试）。两维度：
   *  teamId=解散前置；projectId=删项目/模板级联前置；projectIds=cleanDrafts 批量前置。
   *  三轮 P0-4：tx 参数——disbandTeam 事务内调用时与 FOR UPDATE 同连接同快照（"持锁检查"为真）。 */
  async assertSettled(tx: Prisma.TransactionClient | PrismaService, scope: { teamId?: string; projectId?: string; projectIds?: string[] }): Promise<void> {
    const base = scope.teamId
      ? { teamId: scope.teamId }
      : scope.projectIds
        ? { projectId: { in: scope.projectIds } }
        : { projectId: scope.projectId! };
    const [running, frozen] = await Promise.all([
      tx.generationIntent.count({ where: { ...base, status: 'RUNNING' } }),
      tx.generationIntent.count({ where: { ...base, reservedCredits: { gt: 0 } } }),
    ]);
    if (running > 0 || frozen > 0) {
      throw new BusinessException('TEAM_HAS_ACTIVE_FUNDS', '该范围存在进行中或冻结中的生成任务（资金未清算）——请等待任务完成或经 admin force-void 后重试', HttpStatus.CONFLICT);
    }
  }
}
```

**claim 准入谓词**：**已在 T3 Step 3 落地**（Z26 FOR SHARE 形态——谓词与 create 同事务，本 Task 只验证不重复实现）。

`TeamFundsGateService.assertSettled` 签名增 `tx` 参数（三轮 P0-4：v2 用 `this.prisma` 在事务外另一连接——"持锁检查"是假陈述）：

```ts
  async assertSettled(tx: Prisma.TransactionClient | PrismaService, scope: { teamId?: string; projectId?: string; projectIds?: string[] }): Promise<void> {
    // ……内部 this.prisma.* 全部改 tx.*（同连接同快照——门与锁同源）……
```

**disbandTeam 单事务化**（team.service.ts:395-440 改写骨架——emitAsync/队列投递移事务后 best-effort）：

```ts
    // Z4/Z26：单事务——FOR UPDATE 团队行（与 claim 的 FOR SHARE 互斥）→ 资金门（**tx 内计数**）→ 物理删（级联清理）；
    // 三轮 P0-4：删"同事务先置 DISBANDED 再 delete"的墓碑语句（同事务内不可见=无效语句）；台账行 teamId 无 FK 不受级联（审计留痕）。
    // 四轮 P2-3/C5：契约 20 全序补 Team 首环——Team → TeamBalance → GenerationIntent →（流水/TeamMember）：
    // claim=Team(S)→GI；reserve/settle/unfreeze=TB(X)→GI；disband=Team(X)→级联触 TB——全序成立且无环（claim 新引入的
    // Team 行锁参与者必须成文，否则未来"持 TB 时动 Team"即成环）
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Team" WHERE id = ${teamId} FOR UPDATE`;
      await this.fundsGate.assertSettled(tx, { teamId });
      await tx.team.delete({ where: { id: teamId } });   // 级联 members/projects/CanvasDoc/media/…
    });
```

调用点：① `project.service.ts` delete :106 前加 `await this.fundsGate.assertSettled(this.prisma, { projectId: id })`、cleanDrafts :118 改 `assertSettled(this.prisma, { projectIds: ids })`；② `template.service.ts:158` 同 ①（非事务调用传 `this.prisma`——union 类型兼容）。

**admin force-void 出口**（`TEAM_HAS_ACTIVE_FUNDS` 409 不能只会等 cron）：

```ts
  // admin/intents.controller.ts（AdminModule——admin.guard 既有守卫承载）
  @Post('intents/force-void')
  async forceVoid(@Body() dto: { intentRowId: string }) {
    return this.adminIntentService.forceVoid(dto.intentRowId);   // → teamCredit.void_({intentRowId})+intentService.fail+AuditLog 登记
  }
```

- [ ] **Step 3: 跑绿+回归+Commit**

```bash
cd apps/api && npx vitest run -c vitest.int.config.ts src/modules/team/team-lifecycle-funds.int.spec.ts && npx vitest run && npx tsc --noEmit ; cd ../..
git add apps/api/src/modules/team/ apps/api/src/modules/project/ apps/api/src/modules/template/ apps/api/src/modules/admin/ apps/api/src/modules/execution/generation-intent.service.ts
git commit -m "feat(funds): Y0b-1 生命周期资金门——TeamFundsGateService（RUNNING∨reservedCredits>0⇒409）+claim 准入谓词（TEAM_CLOSED——Z4 写路径判定）+disbandTeam 单事务化（FOR UPDATE 持锁检查——穿门窗口关闭）+项目/cleanDrafts/模板级联三调用点+admin force-void 运维出口+台账 teamId 无 FK 审计留痕（红相=无门+claim 不看状态+置空行查询不可见三案留档）"
```

---

## Task 7: 出口汇聚（G-1 四侧收口+逐文件下限+DI smoke+census 终验）

**Files:**
- Modify: `apps/api/src/modules/execution/funds-four-way.int.spec.ts`（②扣费自洽腿+混合组+video 死亡线）、`scripts/check-int-coverage.mjs`（逐文件下限+MIN_TOTAL 更新）、Create `apps/api/src/di-smoke.int.spec.ts`（三轮 G5——int 套件+overrideProvider）

- [ ] **Step 1: G-1 收口（真实执行链——api-caller stub 零真外呼；Z18 拆两条断言）**

`funds-four-way.int.spec.ts` 追加（骨架——构造器 stub 位以 `tsc --noEmit` 通过为准）：

```ts
  it('G-1 收口：①定价同源+②扣费自洽（text+image 混合组，首跑限定——重放分支不计费 Z18）', async () => {
    const { ExecutionService } = await import('./execution.service');
    const { ValidationService } = await import('./validation.service');
    const { PricingResolverService } = await import('./pricing-resolver.service');
    const { ApiCallerService } = await import('./api-caller.service');
    const { PrismaService } = await import('../../prisma/prisma.service');
    const prisma = new PrismaService();
    const resolver = new PricingResolverService(prisma as any);
    const validation = new ValidationService(prisma as any, resolver as any);
    // 团队/项目/节点脚手架（bal=100）——复用本文件工具。四轮 B5/Z36 死亡线①：夹具=**客户端真实载荷形态**
    // （seed 固定 id+image 带分辨率行 id——Z36②a 面板写入形态；resolution:null 在无阶梯模型下必 PRICING_RULE_MISSING）；
    // 聚合腿与 validation 同键（经 resolvePricingKey 单源——裸 resolve({modelId}) 与 validation 键形不同源=①腿自不成立）。
    const nodes = [
      { id: 'g1-text', type: 'textInput', data: { model: 'seed-model-gpt4' } },
      { id: 'g1-img', type: 'imageGen', data: { model: 'seed-model-sdxl', resolution: 'seed-res-sdxl-1024' } },
    ];
    const apiCaller = new ApiCallerService() as any;
    const stubText = vi.spyOn(apiCaller, 'callTextGen').mockResolvedValue({ content: 'r' });
    const stubImage = vi.spyOn(apiCaller, 'callImageGen').mockResolvedValue({ url: 'http://x/1.png' });
    const svc = new ExecutionService(prisma as any, {} as any, validation, apiCaller, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const v = await validation.validateAll(nodes as any[], team.id, user);
    const { resolvePricingKey } = await import('./pricing-input.util');
    let resolverTotal = 0;
    for (const n of nodes) {
      const key = await resolvePricingKey(prisma as any, n as any);   // 与 validation 同键——Z20/Z36 预检=实扣
      const p = key.modelId
        ? await resolver.resolve({ modelId: key.modelId, resolutionId: key.resolutionId, durationId: key.durationId })
        : await resolver.resolveByNodeTypeKey(key.pricingKey!);
      resolverTotal += p.creditCost;
    }
    const r = await svc.execute(project.id, undefined, user, nodes.map((n) => n.id));
    expect(r.success).toBe(true);
    const intents = await prisma.generationIntent.findMany({ where: { projectId: project.id, status: 'SUCCEEDED' } });
    const intentSum = intents.reduce((s, i) => s + i.creditCost, 0);
    const settles = await prisma.teamCreditTransaction.findMany({ where: { teamId: team.id, type: 'settle' } });
    const settleSum = settles.reduce((s, t) => s + Math.abs(t.amount), 0);
    expect(v.totalCost).toBe(resolverTotal);      // ①定价同源：validation ≡ resolver 聚合（含 text 腿）
    expect(v.totalCost).toBe(intentSum);          // ①延伸：validation ≡ Σintent 快照
    expect(settleSum).toBe(intentSum);            // ②扣费自洽：Σsettle ≡ Σintent.creditCost
    expect(v.totalCost).toBeGreaterThan(0);
    void stubText; void stubImage;
  }, 60000);
```

（writeNodeData 走 CollabDocumentService stub `{ readCanvas: async () => ({ nodes, edges: [] }), writeNodeData: async () => {}, writeExecStatus: async () => {}, isLeaseServing: () => true }`。**video 死亡线**（Z20+四轮 Z36）：同款单跑 videoGen 节点 `{ model: 'seed-model-hy-video', duration: 5, resolution: '1080p' }`（真实载荷——resolution 被声明参与制忽略）断言 `实扣额 ≡ 预检额 ≡ 10`。）

- [ ] **Step 2: 全量 int + check-int-coverage 逐文件下限（Z19）**

```bash
cd apps/api && npx vitest run -c vitest.int.config.ts --reporter=default --reporter=json --outputFile=int.json ; cd ../..
node scripts/check-int-coverage.mjs ; echo exit=$?
```

`check-int-coverage.mjs` 改造：`MIN_TOTAL` 更新为实测值（全局下界保留）+新增逐文件下限映射：

```js
// Y0b-1 新增 6 个资金门 int 文件的最低条数（T7 标定——记录现状非拔高，实测低于初值则按实测下调；
// 三轮 P1-7：既有比较器按 basename 集合比对（check-int-coverage.mjs:14-22）——键必须 basename，全路径永不命中；
// 四轮 P1-7：di-smoke.int.spec.ts 是第 6 个——漏登记=执行集合≡git 集合断言必红）
const FILES_MIN = {
  'ledger-invariants.int.spec.ts': 10,
  'pricing-resolver.int.spec.ts': 8,
  'funds-four-way.int.spec.ts': 2,
  'credit-ledger.int.spec.ts': 7,
  'team-lifecycle-funds.int.spec.ts': 4,
  'di-smoke.int.spec.ts': 1,
};
```

- [ ] **Step 3: DI compile smoke（Z22）**

```ts
// apps/api/src/di-smoke.int.spec.ts —— Y0b-1（Z22+三轮 G5）：nest build 不解析 provider 图——循环依赖只在运行时炸。
// 三轮修正三处：vitist 笔误/PricingResolverService 未 import/放单测套件会连真 BullMQ+Redis 必挂——
// 改 int 套件（*.int.spec.ts）+ overrideProvider 覆盖队列 token。
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { describe, it, expect } from 'vitest';

describe('DI 图可编译（PricingResolver/CreditLedger/FundsGate 跨模块注册零循环）', () => {
  it('ExecutionModule+TeamModule compile（队列 provider 覆盖）', async () => {
    const { ExecutionModule } = await import('./modules/execution/execution.module');
    const { TeamModule } = await import('./modules/team/team.module');
    const { PricingResolverService } = await import('./modules/execution/pricing-resolver.service');
    const moduleRef = await Test.createTestingModule({ imports: [ExecutionModule, TeamModule] })
      .overrideProvider(getQueueToken('ai-result-download')).useValue({ add: async () => {} })
      .compile();
    expect(moduleRef.get(PricingResolverService, { strict: false })).toBeTruthy();
  }, 60000);
});
```

（执行时以 `@InjectQueue` 实际出现的全部队列 token 覆盖；若模块链触发 validateEnv——int 套件已含 DATABASE_URL/MINIO 假值按 ci.yml:28-33 先例。）

- [ ] **Step 4: census 终验 + pnpm verify**

```bash
grep -rn "CREDIT_COST_PER_EDIT" apps/api/src | grep -v spec ; echo "edit census exit=$?"     # 预期 1
grep -rn "'consumption'" apps/api/src ; echo "consumption census exit=$?"                    # 预期 1（T1a 枚举真空删）
grep -rn "executeWorkflow" apps/web/src ; echo "exit=$?"                                     # 预期 1
grep -rnE "x-yjs-sv|svBytes|sv\?:" apps/api/src apps/web/src --include="*.ts" --include="*.tsx" | grep -v spec > /tmp/sv-census.txt ; wc -l < /tmp/sv-census.txt
# 三形态 census 记录留档（三轮 P2-5）：清单粘 T8 spec 执行注记——Y0b-2 的 sv 退役删除清单以此为准（禁凭记忆删）
grep -rn "teamCreditTransaction" apps/api/src --include="*.ts" | grep -v spec | grep -vE "credit-ledger.service|findMany|findFirst|aggregate|\\$queryRaw|count" ; echo "ledger census exit=$?"   # 预期 1
pnpm verify    # 全绿（doc-gate/verify-indexes/check-migration-additive/check-pricing-coverage/check-ledger-single-writer/check-spec-consistency/check-ecosystem/node --test+构建+全测）
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ scripts/check-int-coverage.mjs
git commit -m "test(funds): Y0b-1 出口汇聚——G-1 拆两条收口（①定价同源含 text/video 维度②扣费自洽——Z18 首跑限定）+video 实扣≡预检死亡线+check-int-coverage 逐文件下限（Z19）+DI compile smoke（Z22）+census 终验+pnpm verify 全绿"
```

---

## Task 8: 收尾回填（spec 修订+v8 目录+服务器重建+子批出口呈报）

- [ ] **Step 1: spec 同批修订**（各 Task commit 已同步 §10 指标块，此处收口结构性条目）：§1.1 清账段整删（squash 取代）+迁移段改两刀叙述+census 白名单四类；§1.2 九处→十处（含 public.service）+modelId 可空（Z5）+覆盖度键集自表派生+定价数据进迁移（Z16）；§1.3 sv 条目移 Y0b-2+五列删（Z7）；§1.4bis 契约 4 增 referenceId 派生规则（Z9）+扫描锚扩全操作集+settle 纳入 reversesId（Z6）+amount CHECK（Z8）；§1.4ter 改写（Z4：物理删+无 FK+准入谓词+单事务）；§1.5 第四分支判据=status+5min 档+未闭合义务巡检（Z11/Z17）；§1.7 出口表 sv census 移 Y0b-2；契约 20 论据改写（Z13"建立全序+消灭无界锁等待"+三轮 M6 措辞降级"同函数内序不变量——静态锚是防回归下限非充分条件"）；§9 登记"锁序未结构性消灭（(b) 代价）"+冻结进钱包触发条件；§9.22 门禁判据修正（Z15）；**三轮增补**：契约 4 补 money_in 周期事件键规则（Z24——可重复事件必须用周期/事件 id 建键+禁实体 id）+`reservedCredits` 唯一权威身份（D2 补——防 Y0b-2 当缓存改）+`ensureBalance` 唯一钱包创建口契约（Z23）+node.type→NodeType.key 映射表契约（Z28）；TeamRechargeOrder.teamId 去 FK 的对账语义登记（§范围外已注）；audioGen/imageExtGen 模型管线登记 Y0b-2（Z31）。**四轮增补**：契约 20 全序补 Team 首环（P2-3——`Team → TeamBalance → GenerationIntent →（流水/TeamMember）`成文，Team 行锁参与者=claim FOR SHARE/disband FOR UPDATE）；**维度键所有权契约**（Z36——计费维度键=ModelResolution/ModelDuration 行 id，UI token/label 仅显示；面板选项从模型声明渲染）；Z33 纪律进规范（禁在 `$transaction` 内 catch 驱动错误后再查——PG aborted 态 25P02）；multiImageGen 并入 Z31 登记（Z37）；`assertSettled` 项目/模板侧 `this.prisma` 无锁的读后写窗口登记为残余（兜底=reconcile+孤儿巡检；团队解散侧已被 FOR SHARE/FOR UPDATE 覆盖）；孤儿 reserve 意图行真丢失情形的 monthlyUsed 无法归因回滚登记（不可回收既知状态）；REBUILD_DB 部署分支进 runbook（Z34——**tar 叠加语义警示**：远端迁移目录不随部署清理，squash 类重建必须显式 rm）。
- [ ] **Step 2: v8 目录 Y0b-1 行**——状态 `完成`+本 plan 链接+两项 Y0b-5 移交（admin 红标+ready degraded 载体）+Y0b-2 依赖项清单（§0 范围外登记全表）。
- [ ] **Step 3: 服务器 dev 库重建执行**（T1a Step 10 登记——部署时人工：DROP SCHEMA→migrate deploy→seed；`migrate status` 判据）。
- [ ] **Step 4: 终验+Commit**——`pnpm verify`+`pnpm --filter @flowweb/api test:int`+`node scripts/check-int-coverage.mjs` 三绿；`docs(collab): Y0b-1 收尾回填——spec 结构性修订+v8 目录+服务器重建登记+Y0b-2/5 移交清单`。
- [ ] **Step 5: 【请用户确认】Y0b-1 子批出口**——逐条呈报：①定价同源+扣费自洽（含 video 维度死亡线）/②同键规则红→绿/③跨团队隔离/④混合符号+rearm 红绿/⑤三不变量（测试+运行时双层）/⑥扫描锚全操作集+admin 撕裂修复/⑦生命周期门+准入谓词+审计留痕+force-void/⑧图像编辑 4 kind census 清零/⑨覆盖度门禁/⑩台账分域 guard/⑪squash census 自证+定义断言/⑫锁序静态锚/⑬consumption 真空删/⑭pnpm verify 全绿。确认后 Y0b-1 闭合→Y0b-2（sv 退役+准入门同 commit 约束组）或 Y0b-3（可并行）。

---

## 出口判据对照（修订后）

| 出口条款 | 承载 Task | 证据形态 |
|---|---|---|
| ①定价同源+②扣费自洽（含 text 腿+video duration 死亡线） | T2（修复）+T3（plans）+T7（收口） | funds-four-way 绿+T2 红相留档 |
| 同键规则 DB 拒绝（红→绿，含 kind 级 modelId IS NULL） | T1b | ledger-invariants 约束档 |
| 跨团队隔离绿 | T4 | credit-ledger F1 案 |
| 混合符号/二次退款红→绿（含 rearm+anti-join 谓词） | T1b（reversesId）+T4（F2/rearm） | 两 spec 红→绿两态 |
| 三不变量绿（G-2+分区链）+运行时巡检双层 | T4（测试）+T5（drift 指标） | ledger-invariants+verifyLedgerInvariants |
| 扫描锚绿（全操作集+静态锁序）+admin 撕裂红→绿 | T4 | check-ledger-single-writer+并发案 |
| 生命周期门红→绿（409+准入谓词+审计留痕+force-void） | T6 | team-lifecycle-funds 四案 |
| 图像编辑 4 kind 改道绿（census 清零+迁移 INSERT 在位） | T1b+T2 | grep 零命中+门禁绿 |
| status 判据第四分支绿（含未闭合义务巡检） | T5 | 闭环档四用例 |
| F7 守卫绿 | T5 | ledger-invariants F7 案+stranded 指标 |
| 定价覆盖度门禁绿（键集自表派生） | T2 | check-pricing-coverage OK |
| 台账分域 guard 绿（money_in referenceId+intent 行复核） | T4 | assertTruthTable 域案+money_in 用例 |
| squash census 自证+verify-indexes 定义断言+fresh replay | T1a/T1b | census 两态+新块全绿 |
| 锁序静态锚+零锁等待 | T4 | 并发案+scanFiles 锚 |
| consumption 真空删+executeWorkflow census 清零 | T1a/T3 | grep 零命中 |
| claim 并发双击=NodeBusy 非 500（Z33） | T3 | generation-intent.int 并发用例（串行测不出） |
| 维度键所有权（声明参与制+UI 存行 id+选择器可达性——Z36） | T2 | 死亡线①客户端真实载荷预检≡实扣+门禁纯表驱动 |
| pnpm verify 全绿 | T7 | verify 链（六个门禁脚本） |

**范围外登记**：见 §0 末尾（Y0b-2 同 commit 约束组全表+产品级登记一项）。

---

## Self-Review 记录（v2）

1. **终裁覆盖**：三轮外审 22 项 P0+8 项分歧（Z1-Z22）逐条落位——T0（Z15）/T1a（Z1/Z2/Z3/Z4 FK 部分/Z5 可空）/T1b（Z6 索引部分/Z8/Z9 键部分/Z11 索引/Z16）/T2（Z5/Z20/Z21）/T3（Z7/Z10 前半/Z14）/T4（Z6 配对/Z9 前置修复/Z10 单源/Z11 写侧复核/Z12/Z13）/T5（Z11 巡检/Z17）/T6（Z4 准入谓词+单事务）/T7（Z18/Z19/Z22）。v1 删除项：清账⓿全家族/additive 结构豁免/settle_once/teamIdSnapshot/deliveredAt+markDelivered/inputHash/docStateSeq/heartbeatAt/deadlineAt/假 internal 模型行+唯一断言/seed-pricing.ts+1 积分兜底/denylist 自然语言项/ABBA 伪红相/MIN_TOTAL 假红回填。
2. **占位符扫描**：无 TBD/TODO。探针回填型三处（Y0a-4 M0 先例）：T1a Step 0 census 清单（搬运以实测 indexdef 为准）/T1a Step 4 raw 段（12 类对象清单+来源标注，执行时粘实测 SQL）/T7 Step 1 构造器 stub 位（tsc 通过为准）。T2 Step 0 键集探针仅判读用（四轮 Z37 后门禁纯表驱动——无键常量回填项）。
3. **类型一致**：`LedgerTx`（T4 定义=runInTx/tx/lockBalance/mutate；T5 巡检经 ledger.tx 转换一致）；`mutate → {rowId, balanceAfter}`（T4=T4 用例+T5 orphan 释放消费）；`resolve/resolveByNodeTypeKey → ResolvedPricing`（T2=T3 claim+T7 聚合）；`ClaimPricing`（T3=execution 三链/image-edit/lighting controller+T6 准入用例）；`claim({pricing 必填, teamId 必填})`（T3=T6 一致）；`reserve(userId,{intentRowId}) → {success,reason?,alreadyReserved?,mayCall?}`（T4=T4 调用点+T5 settleStranded 消费）；`assertSettled({teamId?|projectId?|projectIds?})`（T6=四调用点）；reversal 三配对（T4 assertReversal=T1b 约束档+T4 用例+T5 anti-join 同构）。
4. **红相可产性**：v2 全部红相验证可产——T1b（约束不存在=SQL 红）/T2（模块缺失+三分支现状红）/T3（断言缺失红）/T4（import 红+F2 anti-join 对 v1 谓词红+rearm 撞键案红）/T5（方法不存在 TypeError 红+F7 判据红）/T6（无门红+claim 不看状态红）。已删不可复现红相：ABBA 40P01（Z13——改静态锚+锁等待）。
5. **风险登记**：T1a 两告知点（本地/服务器库重建）；census 白名单外差异=搬运遗漏（机械可检回 Step 4）；T1b `migrate diff --from-url` 需连库（reset 后 init 已应用——快照正确）；T2 resolution 形态（id vs label）探针定夺——错猜致 image 链 4xx（fail-closed 方向安全）；T4 三真实支付入口改道（CAS 保留用例逐条）；T6 disbandTeam 单事务化牵动 emitAsync 时序（best-effort 后置）；seed.ts 主链规则本地/服务器跑（CI 空库门禁自然绿）。
6. **v1→v2 修复轮记录**：v1 chargeRows `reversesId:null` 谓词方向错误（用例与实现自相矛盾）→ anti-join；v1 视频定价维度盲区（null∧null 会致视频全灭/1 积分坍缩）→ duration 维解析+死亡线用例；v1 docStateSeq 撞契约 10 → 列删；v1 `alreadyReserved` 当外呼许可 → mayCall:false；v1 seed-pricing 人工步骤+兜底价 → 迁移 INSERT；v1 deliveredAt 4 kind 漏写洞 → status 判据；v1 硬编码 METRIC_FILES 漏文件 → glob；v1 MIN_TOTAL"红→绿回填"空转 → 逐文件下限标定。
7. **v2→v2.1 第三轮修复记录（8 P0+约 30 P1/P2 全采纳，三项裁定选择）**：money_in × 周期发放冲突（付费订阅第 2 期断供）→ 周期事件键+跨期用例；lockBalance 纯锁 × 四处承重懒创建（实测 2/7 无钱包，注册/收钱入口断）→ ensureBalance 唯一创建口+白名单收窄；孤儿巡检三洞（mutate 强校验自相矛盾/SUCCEEDED 被退/不变量②漂移）→ skipIntentCheck 窄口+谓词收窄+钱包前置+SUCCEEDED 反例；"持锁检查=窗口关闭"假陈述 → claim FOR SHARE 事务内谓词+assertSettled(tx)+删墓碑；T1a 步骤序自相矛盾+census 工具盲区+psql 不可用 → 旧侧=现有 dev 库+node 化+全量 dump 四组+Step 5.5 删除步骤；ADD COLUMN NOT NULL 空表限定 → 迁移头守卫+停机部署时序（裁定不加 @default(0)——静默默认价与 fail-closed 哲学冲突）；node.type≠NodeType.key 命名空间+两形状分叉复现 → 映射表+resolvePricingKey 单源；客户端 'sdxl'/'hyvideo-v1.5' 字面量+报价键形不同源+`.catch(0)` → 同批清理+MODEL_NOT_SELECTED+报价同源。裁定选择：C-2 audioGen/imageExtGen 选③显式 4xx+登记（不补假规则不移白名单）；C-3 主链定价全家进迁移（消 CI 空转+seed/门禁矛盾）；连带机械项（LedgerTx declare const/FILES_MIN basename/di-smoke int 化+override/'pricing-kind-' 拼写/register:<teamId>/noop 实现/零额 member 先检/mayCall 终态/构造器基准/$queryRaw 盲区检查/锁序锚措辞降级/seed 两处自破前提/api lint 归属 T0/测试连带 Files 补全）逐项落位对应 Task。
8. **v2.1→v2.2 第四轮修复记录（三报告合并：6 P0+9 P1+7 P2/C 级——Z33-Z40 终裁，4 项驳回）**：claim 事务化×P2002 分义（PG aborted 态 25P02——双击即 500）→ createMany skipDuplicates+count 判胜+健康事务内分义+**并发用例**（串行测不出）+"禁 tx 内 catch 驱动错误后再查"纪律（Z33）；服务器迁移目录 tar 叠加不删（deploy.sh:172 实测）+独立停机时序绕开 guard/backup → deploy.sh `--rebuild-db` 分支（上传前 rm migrations+②备份后 DROP SCHEMA+DSN 按 .env 解析+owner 只读核查；pm2 stop 删——旧码对新 schema fail-closed 为设计行为）（Z34）；mayCall:false 终态化会杀 stall-重排下仍在跑的原 worker（付费产物被丢）→ 静默退出+`intent_duplicate_attempt_total`（Z35）；**维度第三命名空间**（UI '2K'/'1080p' 预设×行 id×label；video 模型无 resolution 行而 resolvePricingKey 无条件归一化=video 全量 4xx；image 链今天实扣 0——G-1 红相扩面）→ normalizeDimensions 声明参与制+UI 从 model.resolutions 渲染存行 id（public.service.ts:14 已返回——零 API 改动）+nodeStore '2K' 并入 Z30+两条死亡线（客户端真实载荷/选择器可达性）（Z36）；T1b 本地 FK 必炸（seed NodeType cuid id×迁移固定 id）+空表守卫×int 残留自撞 → Step 6 改 migrate reset+迁移→seed 顺序写死；multiImageGen mock 管线禁定价 → 并入 Z31；门禁键常量（'videoGen'）与查询键（'video'）命名空间错配 → 纯表驱动；admin "最后一条 active"守卫在自然键唯一下恒真 → 覆盖级判据（Z37）；settle CAS-崩溃中间态无修复路径 → 早退分支 anti-join 补写；孤儿谓词含 FAILED/VOIDED 与 void_/settleStranded 抢单且跳过 quota 回滚 → 收窄 `gi.id IS NULL` only；LedgerRuleError 业务码 500 → TEAM_BALANCE_MISSING/CREDIT_LEDGER_NEGATIVE 转 BusinessException；drift① INNER JOIN 检不出零流水钱包 → LEFT JOIN+两池分列；unreleasable 无龄过滤指标膨胀 → 加龄+ORDER BY+partial index（Z38）；契约 20 补 Team 首环；FILES_MIN 6 文件；G-1 夹具改 seed 固定 id+真实维度（Z39）。**驳回**：resolveExact 多行保留 500（不变量破坏=服务端缺陷非用户可行动）；A2 nodeTypeId 按 key 解析（reset 后空库固定 id 成立——对不存在路径防御违 YAGNI）；DI smoke 降级元数据断言（弱于真 DI 解析——int 环境 Redis 在位+compile 不触发 onModuleInit）；census 换 node 比对器（Git Bash 下 /tmp+diff 可用）+T1a 空表断言（REBUILD 分支应用在线窗口断言无意义——回退锚=②pg_dump）（Z40）。
