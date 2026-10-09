<!-- doc-status: draft-v2.4 | created_at: 2026-10-08 | note: Y0b 资金与准入批 design spec v2.3——v2.2（同日）经第八轮外审收敛（增量外审+v2.2 复审+三轮评审三报告，deploy.sh 时序/provider sendStateless/SyncStep1 往返全部一手实证，修正 v2.2 三处自身错误）：**canExecute 判据再改**（v2.2"显式 forceSync→等 SyncStatus(true)"证伪——SyncStep1 往返不产生 SyncStatus 帧且 forceSync 置 1 后静默空闲无 ack 永续=常态禁用+readOnly 放行风险——改服务端 inputHash 回显校验 SYNC_PENDING 零外呼+客户端数值基线门）；**空闲保活改 stateless ping**（v2.2"stateless 不可行"系误驳——provider sendStateless opcode 5 公共 API 实证可发，唯 BroadcastStateless opcode 6 才 throw；forceSync keepalive 作废（计数毒性+每 20s 全量 SV 编码 CPU），forceSyncInterval 放长 60s 补传）；**迁移清账改自门控**（deploy.sh:87-88 注释自证"HTTP 面继续打库"+drain 60s 自动解除——v2.2"被 drain 挡住"假设错误；自门控 DO $$ 真实资金 refuse+独立文件⓿顺序固定+文件尾自校验+advisory lock+monthlyUsed 归零+additive 门禁加数据破坏性正则）；heap 阈值按实测基线重标（896=杀线算式非工作区——第七轮基准勘误：trip 750MiB/release 600MiB+pressure 谓词去 arrayBuffers 重复计数）；控制面升幂等状态快照（含解除——shrink 后客户端只读恢复）；版本过期逃生=导出+强制刷新不受守卫约束；awareness 归属机制/runId 生命期落正文；计费读分流判据改结构性 isPersistedComplete（时间窗判据会把空闲文档推回活读）；shrink 后 undoManager.clear+墓碑文档唯一出路=导出+gc:true pin；硬阈文案改"一键瘦身/导出"（readOnly 发不出删除帧="自行删除"做不到）；refusalCache 白名单四类+桶/信号量拒绝不入缓存；mutate 落地约束（balanceAfter 按池分量/锁序/reserve 四守卫/无行锁解法）；四层防线顺序钉死；门禁载体点名；全文一致性清扫（forceSync 30s 残留/TTL 5min 残留/release_once 残留/五 kind/seq 全序/3s 轮询/P4 30-60s/:941 引证）；E41 维持+§9.6 补"对外可访问部署前"失效半句。v2.2 记录：第七轮收敛——v1（同日）经两轮外审收敛（三份对照报告+三份裁定报告+两份 D-A/D-B 终裁，承重论断 40+ 条全部一手复核）：v1 三处机制性踩空修正（connected 钩子在首批消息之后且放行装载会 stamp 旧档→改保留拒载 throw+客户端终态；Connection.close 丢 code→全部改 webSocket.close；onStatelessCallback→onStateless）；资金四缺陷并入（F1 台账串账/F2 混合符号二次退款/F4 产物门序/F7 清理吞冻结）+DB 级不变量+台账锚改 intentRowId+deliveredAt；配额执行点改 beforeHandleMessage apply 前拒绝+三级阶梯+自救；升级限流 IP 源修正（X-Real-IP）；D-A heap 压力闸采纳（三报告细节合并）；D-B 组执行不做 enqueue 化+六收口（幂等键争议经 claim 状态机代码裁决=必做：分支⑤仅同 intentId 生效）；R-1~R-6 维持既定裁定（v8-C/E41/Y5/E45/D1/query 通道）+E41 自动失效条件+持久化契约显式化。v2.4 记录：第九轮三报告收敛（增量外审/v2.3 复审/四轮收尾评审）——P0 两项采纳：**stateless 保活服务端 hook=库内未 await async 回调**（esm:219 未 await+esm:1070-1076 重抛+main.ts 零 unhandledRejection 兜底+Node22 默认 throw+ecosystem min_uptime 30s/max_restarts 10 全实证=任意认证成员可把 pm2 打成 errored）⇒hook 全函数化+全局兜底+P14 库锚+红锚；**清账门控极性反**（空库 fresh replay 必炸）⇒真实资金标记守卫三态+迁移首句 LOCK TABLE ACCESS EXCLUSIVE（结构豁免替代注释豁免）。判据级：**同步判据服务端化=SV 支配准入**（inputHash 降回 §1.1② 纯审计——服务端自算，双侧耦合消失；UX 门=自持未确认标记，数值基线 n0 作废——库计数三路不可靠实证：批量档每批 +1 vs 按 ack 减/resetUnsyncedChanges 幻影置 1/readOnly false-ack 不减）；**全局锁序 TeamBalance→GenerationIntent** 三处落地（mutate/reconcile 两事务/迁移 LOCK TABLE）+死锁自由锚；runId 成功后轮换（未决窗口外即换）；**pong=ping 前置**+15s+双向出口锚；awareness 归属键=payload.socketId（d.ts:609+esm:1512 双证——评审"context 唯一通道"证伪，connectionId 注入驳回）；env 补 COLLAB_BYTES_RATE_PER_CONN/EXEC_MAX_NODES；一致性门禁提前 Y0b-0（方向=spec↔code 单向 fenced 块+退役短语 denylist，非正文扫数字）；heap 锚上界修 824MiB；清扫 17 处副本漂移（§0 release_once/三分表、§3.2 谓词 bullet、契约 18、§9.16 新鲜度、896 区间×2、旧指标名、轮次计数等） -->
# Y0b 资金与准入批——设计 spec（v2.4）

日期：2026-10-08（v1+六轮外审收敛同日：两轮裁定+第六/七/八/九轮对照与增量评审）
批次定位：Y0 系拆分 2/3（E31）。**上线门槛组成批**（E39：★=0号+Y0a+**Y0b**+Y0.5+Y1a+Y1b+Y1c-2 三项）。A 类单独启动（v8 §0.2）。
执行方式：TDD（superpowers 红-绿-重构）；TypeScript strict。
前置：Y0a-1~4 已完成（2026-10-08）——本批直接消费其产物：/api/ready 八值 reason、write-frozen 通告（gateway:664）、计费读活读+503 fail-closed（SV15）、closeAll1012、collabState 状态机、spool、/api/drain。

---

## 0. 顶层目标（可证伪出口；非门禁清单）

> **Y0b 出口 = 以下六条全部成立：**
>
> 1. **资金全链 fail-closed**：请求内一次解析（预估=plan 同源），plan 无条件固化（creditCost:0 也不例外）；settle/void/refund/对账只读 intent 行；无 active 定价规则/未知模型/路由缺失 = 明确业务错误 + **零外呼 + 零冻结**；**既有四条资金缺陷修复**（台账跨团队串账/混合符号二次退款/产物门序倒置/清理吞冻结——§1.1A 实证）；同键定价规则 DB 层不可重复（先红后绿）；**图像编辑 4 kind（outpaint/erase/redraw/lighting——实扣 2 写点+预检 1 写点）改道 resolver**（CREDIT_COST_PER_EDIT 硬编码旁路消灭——§1.1A 实证）；**团队/项目生命周期资金门**（解散/删项目前置：无 RUNNING∧reservedCredits>0 否则 409——解散置空流水+级联删 balance 黑洞实证 §1.1A）。
> 2. **台账可对账**：`Σ(balanceDelta) ≡ 各池余额变化 ∧ Σ(frozenDelta) ≡ 冻结变化`（第五查**机器可读**——balanceDelta/frozenDelta 每行自描述（settle 行实证不变动余额池：reserve 时已扣，settle 只做 intent 迁移+记账行），两列真值表（§1.4bis 权威表）进冻结契约非代码注释）；终态∧`reservedCredits>0` 行数恒 0（巡检指标）；台账 type 分域白名单（intent 资金域/账户域）；跨团队同 intentId 隔离用例绿；**写入口唯一**（CreditLedgerService——11 写点改道+扫描锚）；**冲销链 1:1**（reversesId @unique 全局唯一——F2 根治）。
> 3. **准入面收口**：鉴权拒绝按 reason 全计数；VIEWER/匿名不可伪造 awareness 身份（服务端覆写，两端快照断言）；缺版本参数客户端拒连（独立 reason+计数+**拒连后 N 秒内升级次数==0 联合锚**）；**SCHEMA_OUTDATED reason 通路可达**（拒载 throw 附 reason+词表第五终态档——现状 gateway:344 只附 schemaRefusal 标记、客户端收字面量 permission-denied 落瞬态桶、版本过期档永不触发，断链实证 §1.1B）；**拒绝路径防放大**（认证尝试桶+refusalCache 零 DB 短路——30s 窗口 Auth 重放无限制实证 §1.2 P13）；sweep 默认开+权限失效事件驱动；升级限流 IP 源经反代校正；**heap 压力自保闸**（仅拒新物化、瞬态档、fail-open、**有释放路径**——5min reaper）。
> 4. **配额三层各就位**：客户端前置拒（不产生本地写入）/服务端 **apply 前拒绝**（**投影制**：docBytesEstimate+update.byteLength>预算⇒throw{code:4404}——帧不物化，§4.1②）/maxPayload DoS 兜底+不可达性断言；装载路径单行硬拒绝（Y0a 移交项）；超配额用户**可自救**（幂等快照通告+REST 一键瘦身/导出通道——**禁"自行删除"文案**）。
> 5. **客户端消费闭环（pre-real-user 一级阻断项，用户锁定）**：write-frozen 通告消费+503 语义化提示+authenticationFailed 四档终端 UX——服务端信号不再哑（E24/E56/V15）。**1012 短退避已消费（runtime:835-845）勿重做**。
> 6. **观测与降级**：资金链冒烟进部署链（creditCost:0 正例+fail-closed 负例）；客户端遥测 sink 闭环（故意 1 次 hydration failed+1 次投影异常→API 侧计数可见）；依赖降级矩阵一页+PG 熔断（范围=新装载/新会话准入）。
>
> **明示非目标**：不动持久化语义（Y0a 域）；exec 契约 v2/outbox 归 Y1c-2b；doc 字节预算正式值/数值型准入归 Y1c-3；执行传输形态重构（组执行队列化）归执行链重构工程（D1 判例——§9.x 已收窄缺陷登记）。UI 变更集中在 Y0b-5。

### 0.1 立项纪律自检（v8.3 十一条）

| # | 纪律 | 本批落点 |
|---|------|----------|
| 1 | 基线快照表 | §1.1（2026-10-08 四路勘察+九轮复核；行号以当日 master=1121f548 为准） |
| 2 | 删除类任务五行 census | §1.3（sv 公开参数链/'consumption' 过滤/mock 路径三分支/query token 通道/console.log/executeWorkflow 残留六个对象） |
| 3 | 出口判据+回滚动作+冻结契约 | §4（按子批独立出口=用户确认点） |
| 4 | 禁止垫片/兼容层 | 迁移无去重无 down；cookie-only 直接删 query token；sv 参数直接删；台账 type 直接切 'release'（独立迁移文件——PG ADD VALUE 同事务限制）；无灰度开关 |
| 5 | 门禁先红（D13） | §6 两分类——含 v1 修正教训：topology:37 是不可达防御代码，红用例必须打真判据 |
| 6 | RPO/RTO+观测面+CI 载体 | §5 |
| 7 | 门禁载体声明制 | §6 表 |
| 8 | 运行面三件套 | §7（进程定义不变；heap 闸 env+check-ecosystem 断言链） |
| 9 | 同步预算+库选项 pin | §7.2（maxPayload/forceSyncInterval 显式 pin+启动断言；字节累加 O(1) 不引入编码） |
| 10 | 探针前置+失败分支推演 | §1.2 库锚十五条已探针实证；新守卫各附三分支（heap 闸三红用例/deliveredAt/配额阶梯） |
| 11 | 修改类任务冲击面清点 | §2.3 六大面（+apiFetch 契约/claim 消费点） |

---

## 1. 基线快照（2026-10-08 当日一手核验+九轮外审复核；行号以 master=1121f548 为准）

### 1.1 代码基线表

**A 资金链路（Y0b-1/2 输入）**

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| `apps/api/src/modules/execution/execution.service.ts:64` | execute 签名收 `sv?: Uint8Array`（客户端可控头进公开 API）；sv 等待 3s 超时仅 warn 后**降级陈旧快照继续**（collab-document.service.ts:84-93） | E25③/E49③ |
| `execution.service.ts:79` | `readCanvas(projectId, sv)`——计费输入读 CRDT | E12 |
| `execution.service.ts:147/:215/:294` | `cost = rule?.creditCost ?? 0` 三处——无 active 规则 cost=0 外呼照发 | E49① |
| `execution.service.ts:144-146/:212-214/:287-293`+`validation.service.ts:46-52`+`admin/pricing/pricing.service.ts:65-75` | PricingRule 查询**五种形状**（text/video 强制 null∧null；image/validation 无 durationId 键；admin calculatePrice **不带 nodeTypeId** 且又一处 `?? 0`）；读侧四处无 orderBy | E48/F8 |
| `admin/pricing/pricing.service.ts:42-63` | **batchCreate upsert 复合唯一 where 传 `(rule.resolutionId ?? null) as any`**（:49-50——可空列进复合唯一 where，Prisma 不接受 null ⇒ upsert 退化为 create 持续插行=**同键重复行的生产来源**） | F8 |
| `validation.service.ts:35` | textInput continue 跳过定价校验——**且 totalCost（:59/:75）系统性少算全部 text 节点而实扣照收（execution:147）=「显示价格≠实扣价格」**（v2.2 勘重——第七轮 P1-e：非"缺一道校验"而是 G-1 客户端可见值恒错）；text 链 modelId 兜底硬编码 `'seed-model-kimi'`（execution.service.ts:131/:145） | E49① |
| `execution.service.ts:148/:216/:296` | **reserve 被 `if(cost>0)` 包裹**——creditCost:0 时无 reserve；settle 失败 warn 后 `totalDeducted+=cost` 照加（:159-163/:226-230/:308-312）+`:365` emit totalCost | A2/E49② |
| `execution.service.ts:84-85` | nodeIds 过滤静默不匹配——**未知 nodeId 零报错**（topology.service.ts:37 的 `.filter(Boolean)` 是不可达防御代码：result 全来自 nodes 键——真静默丢点=本行+**环不入 Kahn result**） | E36/E40（v1 勘误） |
| `execution.service.ts:152/:220/:300` | 任一节点失败 `return {success:false}` **丢弃已完成节点 results**——doc 已写/余额已扣/用户看整批失败 | D-B 收口④ |
| `execution.service.ts:157/:304`（vs video :233 门先行） | **text/image 产物在 `complete()` 门序之前 push**——意图 VOIDED（已退款）时客户端仍从响应拿产物 | F4 |
| `execution.service.ts:364-366` | 零可执行节点 `return {success:true, errors:[], results:[]}` | E40 W14 |
| `execution.service.ts:251/:333` | `taskId: task-${Date.now()}`（落盘幂等归 Y1c-3 E63——登记界） | E63 界 |
| `generation-intent.service.ts:43-106` | **claim 五分支状态机**：①无行 create ②RUNNING 同 jobId 可重入 ③RUNNING 异 jobId→NodeBusy ④FAILED/VOIDED 同上下文守卫再激活 ⑤SUCCEEDED 同上下文→`created:false` 幂等重放；**分支⑤入口=`findUnique({projectId_intentId})` 只对同 intentId 生效**——组执行无 x-intent-id（executionApi.ts:19-25 实证仅 svHeaders）⇒ SUCCEEDED 后重试=新 intentId⇒分支①重复执行重复扣费 | D-B 幂等键（代码裁决） |
| `execution.processor.ts:47-57` | `@OnWorkerEvent('failed')` 兜底读 `job.data.intentRowId`——controller 从不传=**死代码**；但表已有 `generation_intent_active_node_unique`（migration 20260930062038:47，(projectId,nodeId) WHERE status='RUNNING' 部分唯一）可按索引反查 | N4 |
| `prisma/schema.prisma:978-1002` | GenerationIntent **无 teamId/定价快照列/heartbeatAt/deliveredAt**；`@@unique([projectId,intentId])`+`(status,updatedAt)` 索引；IntentStatus 四值 | E1/F1/F10 |
| `schema.prisma:631-643` | **TeamCreditTransactionType 是 PG enum 实有 11 值**（recharge/subscription_grant/consumption/expire_clear/register_grant/upgrade_clear/admin_grant/admin_clear/refund/reserve/settle）——账户域写点真实存在（team-subscription/payment-success/admin/personal-team-ledger） | E50 分域 |
| `modules/team/team-credit.service.ts:136/:146` | **台账引用键 `referenceId='intent:'+guard.intentId`**（intentId=客户端可控 runId，schema:983 自注）；**:177-179 settle /:212-214 void 镜像查询只按 referenceId——无 teamId 过滤**；void_ 写正向 `type:'reserve'` 冲销行（:216-241，:229 注释"与 refund 分义"） | F1（P0 真漏项） |
| `intent-reconcile.service.ts:133-135/:163-176` | **threeCheck chargeRows 无 amount 过滤**（含 void_ 正向冲销行）+unfreeze 逐行 `Math.abs`——混合符号重复退款（void_ 成功+fail 未落地⇒-10/+10 都当冻结⇒余额+20）；:183 第二处正向 reserve 写点 | F2/E7 |
| `intent-reconcile.service.ts:118-123` | **resultRef 是 best-effort**（自注"job completed 但无产物锚点——留空"）——交付/退款判定以它为准会误判（对账第四分支"有 resultRef→补 settle"） | deliveredAt 判据 |
| `intent-reconcile.service.ts:261-263` | **7 天清理 deleteMany 不看 reservedCredits**——settle 失败悬留行第 7 天被删=冻结额静默消失 | F7 |
| `intent-reconcile.service.ts:13/:69-71` | 退款门判据 updatedAt（15min）；:57 reconcileDaily 24h（首跑=启动后 24h）；:271-290 sweepOrphanExec **遍历全部项目 withDoc**（O(项目数) 装载——不能进启动路径） | E51/E72①/A13 |
| `api-caller.service.ts` | 无 AbortSignal/超时（裸 fetch 8 处）；**mock 路径四分支**：:241（text mock）/`:262 [Unknown model type]`/:310-314（image）/`:320-322`（video）——有规则=付费 mock、无规则=免费 mock 两种洞；**:244-259 text 链无 res.ok 断言**（4xx/5xx→json 解析出空串→当成功 settle+写空产物）；**:274/:281 console.log 打印完整 prompt 与响应**；:83-87 COLLAB_FAKE_AI（API 进程构造读取——子进程注入无效） | E51/P-3 |
| `api-caller.service.ts:53-72`+`validation.service.ts:21-31` | **模型身份双源**：DB AIModel（apiUrl/apiKey 列齐备+validation 已查 active）vs 代码 MODEL_CONFIG 硬编码——两源不一致正是 mock 路径根因 | A3/N1 |
| `ai-download.processor.ts:76-80` | project-missing 只写 Sentry 无 doc 终态；:99-113 media.create 无 bucket；:82 仅 assertCanUpload 一道（E63 界） | E53①/E72② |
| `prisma/schema.prisma:709-718` | **TeamBalance 无 CHECK**（全仓迁移零 CHECK）；version 唯一写点=reserve（:109/:113-114）——admin/subscription/recharge 写点裸 increment；资金事务未 pin 隔离级别 | F5/A9 |
| `schema.prisma:255`+`:262` | durationId 是 `String?`（v1 的 COALESCE(,0) 类型错误）；`@@unique` 四列含两可空列=PG 假唯一 | E11/F8 |
| `main.ts:87` | `app.set('trust proxy', true)` **已生效**（全代理信任——比假设更宽；@nestjs/throttler 的 req.ip 取 XFF 最左值=**HTTP 层付费端点限流可绕过**——XFF 收口归 Y0.5 E58 既定，本批只登记"开放真实支付前置"§9.13） | 限流 IP 源 |
| `team-credit.service.ts:106-111/:171-193` | **settle 行不变动余额池**（reserve=credits/subscriptionCredits decrement 真扣+reserve 行负额；settle=仅 intent 行迁移 reservedCredits→creditsConsumed + 记账行 `amount:r.amount` 同额负——**纯状态转移非余额变动**）⇒ "Σ(全部台账行)≡池变化"结构性不成立，第五查需机器可读分类 | 第六轮 P0-3 |
| `intent-reconcile.service.ts:165-167` | **unfreeze CAS 缺 `reservedCredits>0`**（vs void_ :207 有）——rearm 后 RUNNING∧reservedCredits=0∧reserve 行存在（含 void_ 正向冲销行）⇒ `Math.abs` 把正向行再退一遍=二次退款窗口 | 第六轮 P0-4 |
| `team.service.ts:423-429`+`schema.prisma:722-723/:712` | **团队解散=资金黑洞**：:426 流水 teamId 置空（SetNull）→:428 级联物理删 TeamBalance（:712 Cascade）/CanvasProject/CanvasDoc；GenerationIntent.projectId **无 FK**（:980 纯列）不级联但成永久孤儿→verifyActive 三查对 `r.teamId!`=null 的 `teamBalance.update` **崩溃循环**（每日 warn 不收敛）；置空行对"必带 teamId"对账查询永不可见 | 第六轮 3.2/P1-8 |
| `subscription/admin/admin-subscription.service.ts:62-84`+账户域写点 7 处 | **余额 upsert(increment) 与流水 create 两条独立语句无事务**（非原子——崩溃窗口余额与台账撕开；balanceAfter 读 upsert 返回值并发下不可靠）；账户域生产写点=team-subscription:92/team-recharge:162/team.bootstrap:29/personal-team-ledger:86/grant-credit.processor/payment-success.processor/admin-subscription 共 **7 处**散写 | 第六轮 3.3 |
| `ai-image-edit.constants.ts:3`+`ai-image-edit.processor.ts:113`+`lighting.consumer.ts:131`+`lighting.service.ts:86` | **CREDIT_COST_PER_EDIT=1 编译期常量旁路**（预检+实扣 3 写点硬编码，完全不查 PricingRule）——冻结契约"一切走 resolver"从落地第一天即假，除非同批改道 | 第六轮 3.4 |

**B 网关准入（Y0b-3/4 输入）**

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| `collab.gateway.ts:234-236` | token=**query 优先**、cookie 兜底（query token 会进反代 access log；nginx `access_log off` 为止血） | E13 cookie-only |
| `collab.gateway.ts:204` | address 默认 `'0.0.0.0'`（ecosystem:27 已注入 127.0.0.1——绑定面已收口，默认值未翻转）+nginx 同机反代 ⇒ **socket.remoteAddress 恒 127.0.0.1**——v1 升级限流按此键控=全站 30/min 单桶（部署后重连风暴全站锁死） | A4/A6 |
| `collab.gateway.ts:1121` | sweep 默认关；:1148-1163 recheckConnection 不调 perm.resolve（项目级角色变更连接内不生效）；60s 固定脉冲（无 jitter/无会话缓存） | E13/O4 |
| `collab.gateway.ts:192-217` | Server 构造无 websocketOptions（ws 默认 maxPayload=100MiB 生效）/无 onUpgrade Origin 校验/无 beforeHandleMessage/无 awareness 钩子 | E13/E52/P1 |
| `collab.gateway.ts:313`+`ecosystem.config.cjs:15-16` | **pendingQueues 以 Uint8Array 常驻（external/arrayBuffers——不计 heapUsed）**；`max_memory_restart: '1G'`（RSS 口径——杀进程者）+`--max-old-space-size=512`（V8 口径）——**两个天花板两种计量** | D-A |
| `collab.gateway.ts:335-350` | **O0b-0 版本门已在**：ensureSchemaVersion 拒载 throw（schemaRefusal 标记透传）+stampDocSchema 自愈分支（`!==CANVAS_DOC_SCHEMA_VERSION` 即 stamp）——**若绕开 throw 放行装载，旧档会被静默盖章 v2 落库**（docShape.ts:57-60 禁止的按 abs 解释 rel） | A1/P5 |
| close code 现集 | 应用：1012（:655/:1188）/4401（:1173 sweep）/1000（:1350）；**库自发**（common/dist:48-80 一手实测，含 reason 字符串）：4205 ResetConnection（库通用重置码——pre-auth 队列超限 dist:891-896 等多处复用，**本身不携带"超限"语义**，配额提示必须配服务端计数指标，客户端禁由 4205 推断）/4401 Unauthorized（reason 字面量 `"Unauthorized"`）/4403 Forbidden（`"Forbidden"`）/4408 ConnectionTimeout/1009 MessageTooBig | E4/E5/映射表 |
| **4401 同码异 reason 双键族** | 库 `4401 "Unauthorized"`（认证失败族=终态）vs 应用 sweep `4401 'session-expired'`（静默续期一次）——**客户端只判 code 会混淆两者**（前者要求终态、后者要求静默重连）⇒ §5.2 映射表按 **(code,reason) 双键分型**，扫描锚禁组件裸判 code | 第六轮 close 码补验 |
| `collab.gateway.ts:340-344`+`docShape.ts:55-61`+`collab-auth-reason.ts:10-18` | **SCHEMA_OUTDATED 通路断链**：ensureSchemaVersion 抛裸 `new Error`（无 .reason）→gateway:344 只附 `schemaRefusal:true` 标记（未附 reason）→库 esm:939 `error.reason ?? "permission-denied"` →客户端收**字面量 permission-denied 落瞬态桶**——四档 UX"版本过期"分支永不触发（词表现值七值无 SCHEMA_OUTDATED；:352 db-unavailable 已有附 reason 惯例——补齐即通；onLoadDocument 的 throw 经 setUpNewConnection（:936）冒泡进 onAuthenticate 外层 catch 同走 PermissionDenied 帧=通路可行） | 第六轮 2.2(1) |
| `apps/web/src/collab/awareness.ts:54-56`+`CanvasView.tsx:108-125` | setLocalUser 客户端自写 user（可伪造）；光标 50ms 无条件上报；setSelection 零生产调用方（awareness.ts:68-70） | E73/E38/E39 |
| `deploy/nginx/collab-location.replace.conf:6/:12-14` | `access_log off`+`X-Real-IP` 已设+XFF 追加——限流可信 IP 源= X-Real-IP（仅 loopback peer 信任前提成立） | A4/R-6 |
| `store.metrics.ts:98-103` | yjsHydrationHugeRowTotal 帮助文本自注**"硬拒绝归 Y0b 配额批"**——Y0a 移交本批必落 | D-A④/Y0b-4 |

**C 客户端（Y0b-4/5 输入；路径基准 v2.1 校正：canvasCollabRuntime/syncStatus/canvasStore 均在 `apps/web/src/stores/`——`src/collab/` 仅 awareness/reconnectTransport/ydocBuilder 三件）**

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| `canvasCollabRuntime.ts:856-873` | provider 构造无版本参数/无 onStateless/**无 onAuthenticationFailed**；token='cookie-auth' 占位 | E24/E60 |
| `syncStatus.ts:8-9` | `canEdit=ready && !collabReadOnly && !wsAuthNotice.terminal`——不含连接态（断连可执行=按陈旧节点集计费常态；**断连期可编辑是既有设计 conn.spec:678 钉死——canEdit 不动，另立 canExecute**） | E36/A15 |
| `canvasCollabRuntime.ts:826-832` | collabReadOnly **唯一授权写点**=authenticated 事件（:830，v5.4 注释自证"授权"限定）；复位类写点另两处=initCollab 会话起点（:905 置真）+destroyCollab 登出路径（:1074）；**wsAuthNotice 生产写点=零（本批才创建写点）**（shared 七档 reason+isTerminalReason 四档终态已备 collab-auth-reason.ts:10-36）；离线冷启动恒只读 | E24/R-3（v2.1 精化） |
| `canvasCollabRuntime.ts:835-845` | 1012 已消费（30s 窗+1~3s 短退避，conn.spec:213-264）——**勿重做**；~~setTimeout 未登记清理+闭包读旧 provider；initCollab synced 监听绑旧实例~~ **第六轮证伪**（闭包读模块级 provider 调用时求值 :843；createProvider 新实例+bind 新监听 :859-867、旧实例经 teardownSession `p.destroy()` :1056 销毁无多重绑定；会话级 timer 两处均登记清理 :1049-1050）。**C6 降级=epoch 防回归锚**：1012 timer 回调加 sessionEpoch 对比（:899 已有 epoch 机制）防 teardown 后 kick 新会话——现状无实害证据=非缺陷修复，**不适用 D13 真红门**（防回归锚现状绿） | 锁定项/C6（v2.1 降级） |
| `utils/collabDiagnostics.ts:5-12/:20` | ring 500/7 类事件；auth_reject/write_reject 零调用点；**ring prod 也在写**（仅 window 挂载 DEV——v1 基线勘误）；无出站通道 | E55/O2 |
| `router.tsx:37-112` | 画布路由无 ErrorBoundary；**shared 无 close code 常量**（1012 仍是 runtime:839 字面量） | E55/C2 |
| `api/executionApi.ts:19-25` | **executeGroupNodes 无 x-intent-id**（vs executeWorkflow:15 有）；`:10 executeWorkflow 无生产调用方`（仅 TextConfigPanel:6 残留 import）——删除 census 候选 | D-B |
| `CanvasView.tsx:746` | `void executeGroupNodes(...)` **无 .catch=确定性 unhandled rejection**（apiFetch 非 2xx throw client.ts:19-30）；响应体被丢弃（交付通道=doc 投影——单节点已全走 enqueue：TextConfigPanel:152/VideoConfigPanel:200/AudioConfigPanel:144/imageNodeApi:53/imageExtNodeApi:64） | D-B 收口 |
| `client.ts`（apiFetch） | **status/errorCode 已透传**（:29 `status: res.status, errorCode` / :35 同；json.code :33 判据读取）——**仅 Retry-After 从未读取**；503 语义化传输层缺口收窄=补 retryAfter 解析挂上 error 对象（§5.3 改造范围同步收窄） | C3（v2.1 收窄） |
| `canvasStore.ts:2730-2745`+`canvasIntents.ts:256-269/:82-85` | 粘贴/批量单 transact 无字节上限（唯一防线=isEqual 同值去重）；content 整串覆盖单键 | E52 |
| `TextConfigPanel.tsx:137-171`+`CanvasView.tsx:743-747` | 执行入口零连接态检查 | E36 |
| `page.tsx:217/:400` | hydration failed reload 按钮**无守卫**（不查 hasUnsyncedCanvasChanges——丢弃断连期本地未同步编辑） | R-3/4-10 |
| `nodeStore.ts:579-601` | **updateText 缺 VIEWER 门**（vs applyNodeDataPatch:562-572 有）——只读会话打字=纯本地分叉 | C4（Y1b 交叉） |

**D 观测与降级（Y0b-5 输入）**

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| `store.metrics.ts:31-36`+gateway`:328/:468` | **yjsCanvasDocBytes=装载 set(快照)+store inc(增量) 累加近似，非 doc 真尺寸**（compact 后不回落）——带 projectId 无界标签；既有读者 persist-status.spec:369 | E10/S3 |
| `store.metrics.ts`（全文件）+`main.ts:87-96` | 无直方图/store 时长/tombstone/withDoc/鉴权/版本族指标；无 HTTP RED/无 x-request-id；Sentry collab 零命中（14 模块在用；web 零接入） | E54 |
| `video-work.service.ts:328-345` | 已走 readCanvasFromSnapshot（E71"全量装载"自愈）；残余=workId Redis TTL 300s 缓存**无单飞**+端点无单独限流+编辑不失效陈旧 | E71 残余 |
| `collab-not-serving.filter.ts:18-20` | 503 响应体=**`{code, message}`**（非 reason）+`Retry-After: 2` 已落——503 语义化按 code 字段对齐 | C3 |
| scripts/+deploy.sh:103/:110 | 无监控告警脚本；post-deploy=ready 轮询+collab-smoke——执行链路冒烟不存在 | E54⑥ |

### 1.2 库行为锚（十五条——P4/P12 第六轮 dist 复核修正+P13 新增+P14/P15 第九轮新增；全部 2026-10-08 node_modules dist 一手探针；随批落断言进 collab-core 锚族）

| # | 事实 | 证据 | 本批消费点 |
|---|------|------|-----------|
| P1 | **websocketOptions 存在**："Supports all ws ServerOptions, e.g. {maxPayload}" | server index.d.ts:118-120 | maxPayload 经此 pin 16MB+启动断言（E13"无配置项"勘误） |
| P2 | **beforeHandleAwareness 存在**：states=可变 Map（改写反映进广播；throw=拒整帧） | index.d.ts:312/:586-608；esm:201-208 | E73 覆写挂点 |
| P3 | **awareness 分支无 readOnly 门**（syncStep2 :265/update :284 有） | esm:196-214 | E73 缺口本体+锚用例 |
| P4 | **onAuthenticate 抛错=只发 PermissionDenied 不关 socket**（:937-945——`error.reason ?? "permission-denied"` 帧携带附着 reason；**旁路键生命周期（v2.3 补进证据列——第八轮 P0-2）：:902 在跑 onAuthenticate 前 add(rawKey)，失败路径 :941 delete 该键+:942-944 清队列⇒下一条 Auth 重新满足 :888 旁路⇒重放可行**）；**onLoadDocument 抛错=closeConnections+unloadDocument+rethrow**（:1481-1485）——rethrow 冒泡同走 PermissionDenied 帧；`documents.set` 仅成功路径（:1437）；**check() 基准=hasAuthenticated ? lastMessageReceivedAt : connectionEstablishedAt**（:826-829，setInterval(check,timeout)⇒**被拒连接死于 30-60s（首个 tick+timeout）——消息不延命**；但窗口内同 socket 重复 Auth 无限制） | esm:826-829/:888-945/:1481-1485 | E56：终态拒绝走 auth reason 通道；防放大四层（§3.1bis——拒绝计数含被拒连接）+refusalCache 零 DB 短路 |
| P5 | **connected 钩子在首批消息之后**（incomingMessageQueue 先 forEach handleMessage——含 SyncStep1→SyncStep2 整篇下发） | esm:871-877 | v1"放行装载+connected close"作废的根据之一（另一=§1.1B stamp 行）；**4403 从 close code 表删除**（且 4403=库 Forbidden） |
| P6 | provider `onAuthenticationFailed` 存在收 `{reason}`；`onStateless` 存在（**选项名非 onStatelessCallback**，payload={payload:string} 需自行 parse）；**providerVersion=provider 硬编码 "4.6.0" 无配置通道**；provider **无 query 配置项**（URL 调用方构造） | provider d.ts:127-129/:357/:369；provider esm:512/:518-521 | E24/E55 接线载体；E60 通道勘误（版本走 URL query） |
| P7 | **Connection.close(event) 丢弃 code**（只 removeConnection+协议 CLOSE 帧带 reason）；带 code 关 socket 唯一写法=`connection.webSocket.close(code,reason)`（gateway:1173/:1188 既有先例） | esm:418-426 | 所有服务端主动 CLOSE（4402/4404/4410）统一 webSocket.close |
| P8 | **beforeHandleMessage throw=断连+清空消息队列+帧不 apply**（可带自定义 code：`e.code ?? ResetConnection 4205`）——库官方 apply 前拒绝点，**不存在"拒单帧保连接"** | esm:456-476 | 配额执行点（**投影制**：docBytesEstimate+update.byteLength⇒throw{code:4404}——§4.1②）；"计帧 WARN"必须不抛 |
| P9 | **beforeHandleAwareness throw 同样断连**；`states.set(新 clientId)` 合成 state 会抛（encodeAwarenessUpdate 读 awareness.meta clock——scratch doc 无）；只能**改/删既有 state** | esm:456-476 族+awareness 协议 | E73 只覆写发送者 state/删他人；配额路径只改字段/置 readOnly 禁抛 |
| P10 | **库自有 close 码全集**：1009 MessageTooBig/4205 ResetConnection/4401 Unauthorized/4403 Forbidden/4408 ConnectionTimeout（common/dist:48-80 实测）——**4401/4403 均被库占用** | common dist | close code 分配表：4402=max-lifetime/4404=doc-over-quota/4410=generation 预留；映射表纳入库码 |
| P11 | `connectionEstablishedAt` 是 **private readonly**（d.ts:37）——hook 不可达 | d.ts:37 | 连接寿命 12h 自建 Map（connected 钩子播种，键控清理纪律 §2.3） |
| P12 | provider onClose=**固定 `delay:1e3` 1s 重连**（:411-413 `setTimeout(connect, configuration.delay)`——closeTries 清零无递增；connect() 内部 ladder 才有 maxAttempts/jitter）；crossws 构造 WSS=`new WSS({noServer:true, handleProtocols, ...serverOptions})`（node.mjs:20-24——serverOptions 在强制项**之后**=我们只传 maxPayload 时生效且不砸强制项，但**构造后不暴露 options 引用**⇒"启动后读回实际生效配置"=读回自配**恒真假门禁**） | provider esm:139/:404-414；crossws node.mjs:20-24 | maxPayload pin 生效证据改**行为断言**（collab-core：连接后发 >16MiB 帧断言库码 **1009** 关闭）+serverOptions 键集边界断言（禁塞 noServer/handleProtocols 覆盖强制项）；SERVER_OVERLOADED 档走应用层退避（RECOVER_BACKOFF_MS 族） |
| **P13** | **provider 收 PermissionDenied=emit authenticationFailed 后静默**（permissionDeniedHandler :949-952——不断开、不重发 Auth、isAuthenticated=false）；socket 关闭后才 1s 重连 | provider esm:949-952/:404-414 | 拒绝路径放大画像定形（§3.1）：**正常客户端=31s 周期循环**（30s 4408+1s 重连→重 Auth→再拒——根修=E24 terminal reason→客户端 disconnect()）；**自制客户端=30s 窗口 Auth 重放放大**（4 查询×N/秒×并发 socket——认证尝试桶兜底） |
| **P14** | **库对"未 await 的 async/同步回调钩子"无任何兜底——抛错=unhandledRejection=进程级崩溃向量**：①Stateless 分支 `connection?.callbacks.statelessCallback({...})` **未 await**（:219）+外层 async 包装 catch 后 **rethrow**（:1070-1076）⇒我们的 onStateless hook 抛错无人捕；②`beforeBroadcastStateless` 钩子同样未 await（:1498）；③onUpgrade async 监听器 `catch { if (error) throw error }` 同族（:1633-1634）。叠加 main.ts **零 `process.on('unhandledRejection')`**（grep 实证）+Node≥15 默认 throw=进程退出+ecosystem `min_uptime:'30s'/max_restarts:10`（文件实证）⇒**同一认证成员重复触发 10 次即把 pm2 打成 errored 全站停摆**（非"重启一下"）。payload=`readVarString` 客户端可控原始串（:223）⇒JSON.parse 必须自裹 | server esm:219-225/:1070-1076/:1498/:1633-1636；main.ts grep；ecosystem.config.cjs:17-18 | §5.2 保活 pong hook 全函数化+全局 unhandledRejection 兜底（日志+Sentry+计数不退出）；冻结契约 21；红锚=真连发非法 payload 断言进程存活+计数（§6.1） |
| **P15** | **provider unsyncedChanges 计数三路不可靠，禁作放行谓词**：①批量档每批仅 increment 1 次（:772 `pendingUpdates.length===0` 才 +1）而 ack 按消息——纯计数与 ack 粒度永不对齐；②`resetUnsyncedChanges()` 置 **1**（:714——forceSync 首句的幻影 +1，静默文档无 SyncStatus 永不清）；③readOnly 期 SyncStatus(false) **不减**（server :264-275+provider :474 applied 门）——冻结/配额期残留恒 dirty；另 authenticated 时刻在飞 ack 会把计数打到基线以下 | provider esm:714/:772/:474-475；server esm:264-281 | §2.6② UX 门改**自持未确认编辑标记**（本地 update 置位、任意 SyncStatus(true) 清零——§5.7 同源单谓词）；V15/beforeunload/E40 全族同源（冻结契约 8 信息源条款） |

### 1.3 删除类任务五行 census（纪律 2）

**对象 1：sv 公开参数链（E25③——删的是"降级+客户端可控头"，SV 服务端判据能力不动：sv.util.ts/svDominates 保留；v2.2 census 补 enqueue 链——第七轮 P1-d）**
生产=execute 签名:64/:79+controller DTO（:25 execute 头）+video-project:96-100（随退役消失）+**enqueue 链（controller:37 `@Headers('x-yjs-sv')`→:44 job.data.sv→processor:29-32 `svBytes` 间接消费——两处 v2.1 census 漏）**｜测试=带 sv 的 spec（plan 清点）｜门禁/allow=无｜re-export=sv 等待机制 collab-document.service.ts:84-93+yjs_sv_wait_timeout_total 整体删。处置全删；**验收 grep 三形态**：`x-yjs-sv|svBytes|sv?:`（只 grep 头名会漏 processor 间接消费）。

**对象 2：'consumption' 台账遗留（E50）**
生产=无写点（intent-reconcile:134/147/252 查询过滤）→删过滤；**枚举值本身禁删**（PG 删值=重建类型，check-migration-additive 会拦——显式禁止令）。

**对象 3：mock 路径四分支（E51/P-3；v2.1 勘定：第六轮所称"第 5 分支 fakeImageUrl 被 :266/:364 消费"证伪——两处均在 `if (this.fakeAi)` 守卫内=COLLAB_FAKE_AI 合法 E2E 路径，不删；v2.2 补第四档红相）**
生产=api-caller:241/:262/:310-314/:320-322→删改硬失败（:309-314/:320-322 本就在清单——**provider 失败/配置不匹配静默回退 mock=用户付费拿假产物 URL 的最直接形态**）；**red 相四档分别留档**（有规则付费 mock/无规则免费 mock/unknown type/**provider 失败静默回退 mock**）；:274/:281 console.log 删（prompt/响应**片段**外泄——:274 slice(0,80)/:281 slice(0,200)，截断不减轻严重性）；**:244-259 text 链空串当成功（无 res.ok+`?? ''`→4xx/5xx 空文本 settle 扣费）升独立红用例**（"用户付钱拿空内容"独立验收项，§2.1）；测试=依赖 mock 路径的 spec 改写。

**对象 4：query token 通道（E13）**
生产=gateway:234-236→删（仅读 cookie）｜夹具=collab.gateway.spec:43/:95+collab-smoke.mjs→改 cookie 头注入｜nginx access_log off 保留（纵深+断言锚，见 R-6）｜工具面=`?token=` 全量 grep（plan 纪律 11）。

**对象 5：executeWorkflow 残留（D-B 观察）**
生产调用方=零（executionApi.ts:10；TextConfigPanel:6 残留 import）→删除候选（plan 确认后删——组执行幂等键落地后组执行也带意图头，该函数无存在必要）。

**对象 6：COLLAB_FAKE_AI 豁免收口**
env.ts:44 豁免表→进 zod（superRefine：`NODE_ENV==='production'` 拒 `'1'`——现有"启动即炸"硬门不弱化）。

### 1.4 本批有效裁决内联（E30；〔〕=执行拆分）

**E1（plan-in-PG）**：GenerationIntent 固化执行计划+单价，settle/void/refund 只读该行不再 readCanvas。〔**Y0b-1**——形态=intent 行加列（pricingRuleId/modelId/resolutionId/durationId/creditCost NOT NULL/inputHash/docStateSeq 审计水位），**planVersion/unitPrice 不设**（表结构演进=迁移，机制消失）；**plan 无条件固化**（并进 claim——reserve 被 cost>0 包裹的洞）〕
**E12（P0 资金路径）**：`?? 0`/textInput 跳过/计费读 CRDT/sv 客户端可控+超时降级/regenerate 不传。〔**Y0b-1**（sv 按 v8-C 终裁退役）〕
**E13（P0 权限准入）**：sweep 默认开+复验+Origin 白名单+绑 127.0.0.1+cookie-only+鉴权失败计数限流+awareness 覆写+maxPayload+速率闸+内容配额+超限明确 UX。〔**Y0b-3**（maxPayload/速率闸/配额归 Y0b-4）；复验升级为**事件驱动为主+sweep 兜底**（报告 2 3.5 采纳）；单人特例分支删除〕
**E24（鉴权终态前移）**：authenticationFailed 接线+四档终端 UX。〔**Y0b-5**+**SERVER_OVERLOADED 瞬态档严禁入终态**〕
**E25（三补项）**：settle 对账闭环红用例+planVersion+sv 退役。〔**Y0b-1**（planVersion 随形态消失；对账第四分支判据=deliveredAt 非 resultRef）〕
**E28/E52（配额三层）**：客户端前置拒/服务端事后断连终态/maxPayload 仅 DoS 兜底+不可达性断言。〔**Y0b-4**——服务端档改 **apply 前拒绝**（P8）+三级阶梯（软阈 readOnly 通告/硬阈横幅/强推才 4404）+水位推送+自救通道；装载路径单行硬拒绝（Y0a 移交）同批〕
**E36（四链路落点）**：执行入口门/拒绝写三层+maxPayload/世代 close code/退款触发点改完成时存在性检查+exec 条目同处置/执行前断言。〔执行入口门=canExecute 一等谓词（**Y0b-2**，canEdit 不动）；退款=**存在性检查前移到 complete() 之前**（resultRef 时序）+deliveredAt；close code=分配表 **Y0b-3**〕
**E38（选区广播）/E39（单人零开销）/E40（分叉自检+awareness 三指标+零可执行节点）**：〔**Y0b-4/5/2**——E39"无 sweep 查询"格口径改"事件面零+兜底 5min"；"文本泄漏同灭"格登记 Y1c-2a〕
**E48（定价唯一化）**：单一 resolver+DB 层不可重复+三处相等。〔**Y0b-1**——索引选型 `UNIQUE NULLS NOT DISTINCT`（PG16 实核，无哨兵污染；同迁移 **drop 假 @@unique**——upsert 退化 create 的机制根源）+admin batchCreate 改 findFirst→create/update+resolver 查询带 nodeTypeId+**定价覆盖度门禁**（启用模型×节点类型必有不缺 active 行——fail-closed 安全网）〕
**E49（fail-closed+sv 终裁〔v8-C〕）**：`?? 0` 全灭+settle 语义倒置修正+sv 维持退役。〔**Y0b-1/2**〕
**E50（台账类型）**：release 分立+白名单断言。〔**Y0b-1**——**分域**：intent 资金域={reserve,settle,release,refund}（guard 挂 team-credit+intent-reconcile）/账户域=其余 7 值各自校验；release=ALTER TYPE ADD VALUE **独立迁移文件**；两写点同批（team-credit:230+intent-reconcile:183）〕
**E51（心跳+provider 硬化）**：heartbeatAt+退款门改判据+AbortSignal/per-attempt 超时/总 deadline/res.ok/未知模型硬失败。〔**Y0b-2**——heartbeatAt NOT NULL+`@@index([status,heartbeatAt])`（COALESCE 无索引）+选行与三处 CAS 守卫全改；模型判据**单源 AIModel**（MODEL_CONFIG 降为 adapter 映射，路由缺条目=verify/启动断言）〕
**E53（交付语义终裁〔v8-D〕）**：维持不退款+补两缺口。〔**Y0b-2**〕
**E54（观测告警收口）**：〔**Y0b-5**——yjs_canvas_doc_bytes 拆双指标（真值=装载播种+compact 全量编码校准；近似=apply 字节累加）；告警路由=巡检脚本+结构化日志（无 Alertmanager 诚实口径）〕
**E55（遥测 sink）/E57（降级矩阵+PG 熔断）**：〔**Y0b-5**——熔断范围=**新装载/新会话准入**（不裹 lease 心跳、不拒 append——WS 写不碰 PG）；失败分类（连接/超时类才计数）+半开探测〕
**E56（会话寿命+载入失败 CLOSE）**：〔**Y0b-3/5**——v2 修订：**保留拒载 throw**（SCHEMA_OUTDATED 走 permission-denied→authenticationFailed{reason} 通路）+**客户端终态映射**（websocketProvider.disconnect()=唯一官方停重连开关）；4403 从 close code 表删除；refusalCache 改"同 doc 连续重连的 onAuthenticate 短路"（防反复 4 次 DB 查询，非防装载）；连接最大寿命 12h→**4402**（自建 Map）〕
**E60（版本协商）**：〔**Y0b-3**——通道=query（R-6 终裁；providerVersion 硬编码勘误 P6）；**两常量分离**（CANVAS_DOC_SCHEMA_VERSION（docShape:41=2，既有）≠CLIENT_PROTOCOL_VERSION（csv 所指））+兼容矩阵 tsc 封闭+缺参=唯一硬拒档〕
**E71（读放大收口）**：〔**Y0b-2**——残余=单飞+单独限流+主动失效（canvas.saved 事件→video-work 清缓存）〕
**E72①③**：〔**Y0b-1**——启动补跑**只跑 PG 侧**（sweepOrphanExec O(项目) 装载不进启动路径，doc GC 限量按活跃排序）；③repo.count 当日核验已不存在=登记零；②bucket 随 E53 同文件〕
**E73（awareness 覆写）**：〔**Y0b-3**——beforeHandleAwareness 剥离 user+注入 serverIdentityOf(context.user)（{id,name,role}+color=id 确定性哈希）；**只改/删既有 state**（P9）；>8 人剥离 cursor/selection 只留成员表；服务端单连接短路（connectionsCount≤1 不转发）〕
**V15（persist-status 横幅+beforeunload）**：〔**Y0b-5**——beforeunload 断言改**谓词语义**（hasUnsyncedCanvasChanges+editorDirty latch，不断言挂载点数量）；+reload 守卫+导出本地 JSON+文案「请勿关闭**或刷新**」〕
**E19 半**：〔**Y0b-3/5**〕
**D1（已知风险接受记录）**：〔**§9.5 正式落档**（v2 改写版——因果序差口径+平台沉没成本计量）〕

---

## 2. 范围

### 2.1 执行结构：5 子批 + 门槛分期声明

| 子批 | 主题 | 依赖 |
|------|------|------|
| **Y0b-1** | 资金固化（迁移全套【含清账自门控⓿】+resolver 单源【含图像编辑 4 kind 改道】+plan 无条件固化+台账锚改造【balanceDelta/frozenDelta/seq/teamIdSnapshot+reversesId @unique 1:1】+**CreditLedgerService 唯一写入口（11 写点改道，FOR UPDATE）**+**团队/项目生命周期资金门**+DB 不变量+对账拆档） | — |
| **Y0b-2** | 资金运行时（provider 硬化+心跳+退款时序+门序+幂等键+onFailed+部分成功+执行入口门+E71） | Y0b-1 |
| **Y0b-3** | 准入与版本（E13+事件驱动复验+E73+E60+E56 修订版+连接寿命+升级限流+**heap 闸**） | —（可与 Y0b-1 并行） |
| **Y0b-4** | 配额与 awareness（apply 前拒绝+三级阶梯+装载硬拒绝+速率闸+背压+E38/E39） | Y0b-3 |
| **Y0b-5** | 终态与观测（E24+锁定项+V15+E55+E40+E54+E57+冒烟） | Y0b-3 |

**门槛分期声明（不砍范围、出口分两期达成；v2.2 锁死部署耦合）**：
- **门槛内（pre-real-user 一级阻断序列）**=Y0b-1→Y0b-2→**Y0b-3+Y0b-5 锁定项（同批部署，v2.2 锁死——版本门/拒绝面与 terminal 客户端处理必须同一提交上线**：版本门先上+旧 bundle 靠库 1s 固定重连无限循环=自伤，恰是认证桶要挡的流量；write-frozen/503/四档终态/canExecute）——每项直接对应"会错扣/不会扣钱/用户不知道发生了什么"。
- **门槛外（紧随，独立出口）**=Y0b-4 全部+Y0b-5 其余（配额/观测/遥测/矩阵/冒烟）。
- 每子批出口仍是用户确认点（不因分期稀释）。

### 2.2 Out of scope + 移交登记

| 项 | 去向 |
|----|------|
| E63 配额预留-结算/落盘幂等/taskId 确定性 | Y1c-3 |
| E64 exec 契约 v2/outbox/done 路径 catch 吞错 | Y1c-2b |
| E2 服务端半（writeExecStatus 存在性守卫——复活分支仍在） | Y0c |
| E65 控制帧协议/删 /execution/credits REST | Y3 |
| E59 worker 写通道/NODE_ENV/PITR/XFF 完整统一 | Y0.5（限流器可信 IP 源已先行本批——X-Real-IP loopback 信任） |
| D7 正式预算/数值型准入+LRU/COLLAB_MAX_LOADED_DOCS 消费 | Y1c-3（**heap 闸条件触发项**：RSS>800MB 或 loadedDocs>200 连续 3 天⇒实现数值软阈；有真实用户后 heap 闸与 LRU 同批重估） |
| E33 data Y.Text（单人文本泄漏上行格） | Y1c-2a |
| generation-superseded close code 消费 | Y1c-1（本批只分配 4410） |
| hydration failed 自愈（迟到 synced 补水合） | Y3（本批只做死线分型） |
| 执行传输形态（组执行队列化/请求内固化+入队） | 执行链重构工程首项（§9.x 两驱动+nginx -T 判据命令） |
| expectedStateVector/WS 内执行 | 执行链重构工程必做子项二选一（**备注：SV 对删除结构性失明**——删 90% 键 SV 逐字节不变，本仓 E12 实验） |
| E41 密钥轮换 | 驳回维持（**自动失效条件**：首个真实用户接入之日，密钥外置+轮换自动转一级阻断项）；MODEL_CONFIG 凭证载体归重构工程（本批只动判据来源） |
| updateText VIEWER 门 | 顺手修单点（canEdit 早退 3 行，与 Y1b 四写点收口不冲突） |
| ~~台账 admin/recharge/subscription 写点统一走 version CAS/FOR UPDATE~~ | **v2.1 改判：撤回移交，进本批 Y0b-1 CreditLedgerService**——第六轮实证 admin-subscription:62-84 余额 upsert 与流水 create 无事务非原子（CHECK 只把错变 500）；且 balanceDelta/frozenDelta 列必须由唯一写函数填（散写点各自填=新漂移面）；无用户数据时改最便宜，"移交重构工程"=最可能永远不做的归属 |

### 2.3 冲击面预警（纪律 11 plan 前置——六大面）

1. cookie-only 夹具改造（gateway.spec:43/:95+collab-smoke+一切 `?token=` 工具）。
2. sv 退役消费点（execute 签名/DTO/spec/regenerate）。
3. awareness user 消费面（CanvasTopBar/RemoteCursors 读 user——服务端注入同形字段=预期零改动，用例验证）。
4. yjsCanvasDocBytes 改造读者（persist-status.spec:369+drill/gate 脚本路径）。
5. **claim 消费点**（幂等键派生改动 claimForNode 调用族+execution.controller 头读取）。
6. **apiFetch 契约扩展**（透出 status/code/retryAfter——全部既有调用方的错误分支行为核对）。
7. **定价 spec stub 形状改造（v2.2 新增——第七轮 §七）**：29 个 spec 文件 stub `pricingRule.findFirst`（validation.service.spec×5/execution.service.spec×6——含 :204"0 走 if(vCost>0) 另一分支"**语义注释**用例/admin pricing spec×4 含 upsert 断言（该 upsert 即将消失）/public.service.spec×3）——resolver 改道后 mock 形状全改+旧分支语义用例重写（否则把旧行为固化进新测试）；plan 单列一步。

---

## 3. 工作项设计（按子批）

### Y0b-1 资金固化

**1.1 迁移（schema+raw 混合，无去重/无兼容；迁移名本地时间戳+fresh replay 必验；按依赖分四个文件）**

- ①（枚举先行——**ADD VALUE 独立文件**，PG 同事务不可用新值）：`ALTER TYPE "TeamCreditTransactionType" ADD VALUE 'release'`。
- ②（主迁移 A—intent 表）：GenerationIntent 加 `teamId String`（+索引——资金路径不再依赖 project→teamId 跨模块 join）、`pricingRuleId String?`（FK PricingRule）、`modelId/resolutionId?/durationId? String?`（定价快照）、`creditCost Int`（**NOT NULL**——无默认，claim 必填）、`inputHash String?`（hash(prompt+style+上游引用)——**仅审计用途，禁作幂等判据**（第六轮纪律：同 id 上游内容改后重试会被误判重放——唯一幂等判据=(projectId,intentId)+claim 状态机）；paramsHash 语义并入）、`docStateSeq BigInt?`（**审计水位**——本笔计费依据的服务端视图；**冻结契约禁作准入拒绝判据**）、`deliveredAt DateTime?`（**交付显式判据**——resultRef 是 best-effort 投影写入禁作判据）、`heartbeatAt DateTime @default(now())`（**NOT NULL**）+`@@index([status, heartbeatAt])`、`deadlineAt DateTime`（**NOT NULL——v2.2 补列**：Y0b-2 §2.2 reaper 判据列，claim/reserve 时按 kind 写入；空表加列合法）+`@@index([status, deadlineAt])`（reaper 扫描与 heartbeat 索引并列）；**`docStateSeq 写者接线`（v2.2——第七轮 1.6：v2.1 只描述无写者=假字段）**：claim 时从装载读回 CanvasDoc.stateSeq 写入（一次 SELECT 已在 readCanvas 路径内，零新增查询）。
- ③（主迁移 B—台账+余额 DB 级不变量）：TeamCreditTransaction 加 `balanceDelta Int **NOT NULL**`/`frozenDelta Int **NOT NULL**`（**余额语义自描述**——settle 行实证不变动余额池（reserve 时已扣），"变动余额"分类从隐含知识变每行显式列；第五查=纯 SQL 聚合 `Σ(balanceDelta)≡池变化 ∧ Σ(frozenDelta)≡冻结变化`，写侧由 CreditLedgerService 唯一填值）、`seq BigInt @default(autoincrement())`（**稳定行序**——同毫秒行不可靠，balanceAfter 链校验 `本行 balanceAfter ≡ 前行 balanceAfter + 本行 balanceDelta` 需要全序）、`teamIdSnapshot String **NOT NULL**`（**审计锚不随解散灭失**——team.service:426 解散置空 teamId 后该行仍可按 snapshot 全量对账）、`reversesId String? @unique`（冲销链 **1:1**——退款/解冻只处理 `reversesId IS NULL` 行，重复退款在 DB 层不可能；**第六轮扩展：refund 行同配**（refund 是 settle 的逆向，审计账本标准形态=每条逆向行指向被冲销原行且至多一次））；raw：`CREATE UNIQUE INDEX settle_once ON "TeamCreditTransaction"("referenceId","creditType") WHERE type='settle'`（**v2.2：release_once 部分索引删除**——`reversesId @unique` 全局唯一已含 1:1 冲销（PG 唯一索引多 NULL 合法⇒非冲销行不受限），再加部分唯一索引=一机制两载体冗余；settle_once 保留是因 settle 无 reversesId 对应物）；**账本清账（v2.2 新增；v2.3 改自门控+独立文件；v2.4 极性修正+LOCK TABLE 根治——第九轮 P0-B/P1-2：v2.3 骨架 `IF EXISTS(intent) THEN 清 ELSE RAISE` 极性反——空库落 ELSE ⇒ fresh replay 必炸（本 spec 自要求"fresh replay 必验"=CI 干净库第一条迁移即红）；且"DELETE→ADD COLUMN NOT NULL"窗口旧代码 INSERT 提交后 ALTER 全表校验先于文件尾自校验炸——RowExclusive 互不冲突，drain 不拦 HTTP 面（deploy.sh:87-88 自注）**：①**独立迁移文件⓿（清账专用，顺序固定：⓿清账→②intent 列→③台账列——同文件内语句顺序无保证，禁 prisma 重新生成该文件）**，**第一条语句（DO 块外顶层）**：`LOCK TABLE "TeamBalance", "GenerationIntent", "TeamCreditTransaction", "TeamMember" IN ACCESS EXCLUSIVE MODE;`（按 §1.4bis 全局锁序列表——并发写者在此排队，不可能夹进 DELETE 与 ALTER 之间 ⇒ 迁移**确定性成功**；代价=迁移提交至 pm2 重启间旧代码资金写 500=fail-closed 可接受）；随后 `SELECT pg_advisory_xact_lock(<key>)`（**事务级**——v2.3 session 级在 Prisma 迁移连接上语义含糊，xact 级随迁移事务自动释放）；门控块 **守卫=真实资金标记而非"有无测试数据"**：`DO $$ BEGIN IF EXISTS (SELECT 1 FROM "TeamCreditTransaction" WHERE type IN ('recharge','subscription_grant')) OR EXISTS (SELECT 1 FROM "TeamRechargeOrder") THEN RAISE EXCEPTION 'real money present — destructive reset refused'; END IF; DELETE FROM "TeamCreditTransaction"; DELETE FROM "GenerationIntent"; UPDATE "TeamBalance" SET credits=0, subscriptionCredits=0, version=0; UPDATE "TeamMember" SET "monthlyUsed"=0（月界字段同点重置——月度额度与清账账本同源，否则"从零起算"不完整） END $$;`——**三态全定义**：干净库⇒静默通过（破坏性语句对空表天然幂等）；纯开发数据（intent/reserve/settle 行）⇒清；含真实收款行⇒拒绝执行（fail-closed；开发库若测过支付含 recharge 行=同样 refuse，人工清后重放——保守方向登记）；②**文件尾自校验**：`IF EXISTS (SELECT 1 FROM "GenerationIntent" WHERE "creditCost" IS NULL) THEN RAISE`（锁后窗口已封，此为第二道——旧代码插入的无新列行⇒自检失败而非 ADD COLUMN 晦涩报错）；③NOT NULL 新列在**空表**上 `ADD COLUMN … NOT NULL` 合法（禁 `SET NOT NULL`——additive 拦截）；`DROP INDEX` 出 WARNING=预期（plan 注明）；④**additive 门禁扩检+结构豁免（v2.4 升级）**：`DELETE FROM`/无 WHERE 的 `UPDATE … SET` 进 BREAKING 正则；豁免从"头注释"升级为**结构豁免**——同一文件须 `-- additive-allow-data-wipe` 注释 ∧ `LOCK TABLE` 语句 ∧ `RAISE EXCEPTION` 自门控**三正则同时命中**才放行（注释豁免会被训练绕过，v2.3 刚把门禁从"训练绕过"里拉回来）；⑤不采 opening genesis 枚举行（E50 已 13 值，opening=14=永久负担）；⑥**登记**：维护窗迁移类别（deploy.sh 停机迁移）=更强方案归 Y0.5 部署链域评估——**LOCK TABLE 落地后"推迟 Y0.5"从风险接受变为结论正确**（竞态已确定性消除，秒级 500 窗=fail-closed）。`ALTER TABLE "TeamBalance" ADD CONSTRAINT balance_non_negative CHECK ("credits" >= 0 AND "subscriptionCredits" >= 0)`；`CREATE UNIQUE INDEX pricing_rule_natural_key ON "PricingRule"("nodeTypeId","modelId","resolutionId","durationId") NULLS NOT DISTINCT`（PG15+，CI postgres:16 实核）+ **DROP 既有假 `@@unique` 复合唯一**（schema.prisma:262 删+本索引替代——admin upsert 退化 create 的机制根源）。
- ④（数据/索引核对）：verify-indexes.sql 加块（settle_once/pricing_rule_natural_key 存在性+假唯一索引名不存在断言+CHECK 约束存在性）。

**1.2 pricing-resolver 单源（E48/E49/A3/N1）**

- `resolve({nodeTypeId, modelId, resolutionId?, durationId?})`：①查 `AIModel`（存在∧active）——**模型身份单源 DB**；②查 PricingRule（全四键+active）；任一缺失=`PRICING_RULE_MISSING`/`PROVIDER_UNKNOWN_MODEL`（业务错误码 4xx，零外呼零冻结）；`creditCost:0` 行=唯一合法免费；**查询带 nodeTypeId**（v1 四读形状全部不带而唯一键带）；orderBy 不加（索引已单源——多余排序只会掩盖约束失效），加"命中≤1 行"断言。
- `MODEL_CONFIG` 降级为 **adapter 映射**（模型族→调用实现；凭证载体 env 化仍归重构工程——E41 保留降级项①既定，本批只动判据来源）；"路由表缺条目"=**verify/启动断言**（非运行期兜底——判据=**模型×节点类型支持矩阵**（含参数形状：video 实扣 null∧null 形状必须与预检/覆盖度同形——validation:49 按 resolution 查 vs execution:213 强制 null∧null 的形状错位实证，**形状统一与覆盖度门禁同批验收**否则对 video 永远"有规则"假绿），即**定价覆盖度门禁**：缺失即红）。
- **图像编辑改道（第六轮新增；v2.2 修正措辞——第七轮 P0-c"六类"证伪：当前 HEAD 实测=4 编辑 kind）**：outpaint/erase/redraw（service enqueueOutpaint/enqueueErase/enqueueRedraw 三方法→ai-image-edit.processor:113 统一实扣点）+lighting（lighting.service:86 预检+lighting.consumer:131 实扣）=**4 kind×实扣 2 写点+预检 1 写点**——`CREDIT_COST_PER_EDIT` 编译期常量退役，全部经 resolver（nodeTypeId=对应编辑类型）；**规则行+NodeType 行 seed 同批**（PricingRule.nodeTypeId 是 NodeType FK（schema:203-204）——fail-closed 语义下漏 NodeType 行=该功能全灭；seed 与改道必须同一 commit）；**预检与实扣必须调同一 resolver**（批0c 已有预检/实扣分叉先例——防常量分叉变查询分叉）；**覆盖度门禁载体=verify+deploy preflight+admin 红标+/api/ready degraded（v2.2——禁进进程启动路径**：admin 误改规则+下次重启=全站不可用，而运行期 resolver fail-closed 已兜）。
- 消费方=validation+execution 三链+admin calculatePrice（补 nodeTypeId+删 `?? 0`）+admin batchCreate（改 findFirst→create/update）+**图像编辑三写点**——**九处 where 全部改道**（v2 六处+v2.1 三处）。
- **先红（D13）**：对当前 schema 直插第二条同键行（成功=红）→NULLS NOT DISTINCT 后拒绝（绿）；删 active 规则→现实现 cost=0 外呼照发（红相留档）→业务错误零外呼（绿）；三分支表=①规则行不存在→业务错误②active=false→同③model 缺失→PROVIDER_UNKNOWN_MODEL。

**1.3 plan 无条件固化（E1/A2）**

- **并进 claim 的 INSERT**：claim 时 resolver 已解析（执行链在 claim 前一次性 resolve 全部节点）→`create/updateMany` 携带 pricingRuleId/modelId/resolutionId/durationId/creditCost/inputHash/docStateSeq——**无条件**（creditCost:0 也固化）；reserve 只做钱（cost>0 才调）；预估与 plan 同一次解析派生（**请求内一次**——validation 与 execute 的两次读之间规则可改的 TOCTOU 消除：validation 产出的就是 plan 本身）。
- settle/void/refund/对账只读 intent 行（**含 creditCost 快照**——永不重算）；冻结契约：资金分支禁 readCanvas（扫描门禁）。
- enqueue 收口：processor 凭 `generation_intent_active_node_unique` 反查（见 2.2 N4——与 intentRowId 透传二选一，**选索引反查**：零契约变更）。
- sv 退役（v8-C）：execute 签名/DTO 删 sv；sv 等待机制+`yjs_sv_wait_timeout_total` 删除；readCanvas 读服务端权威态。

**1.4 台账锚与类型（E50/F1/F2/F3；v2.1 三项强化）**

- **referenceId 改 `'intent:'+intentRowId`**（行主键 cuid 服务端生成——客户端不可控）；全部台账查询（settle/void/unfreeze/reconcile）**追加 teamId 过滤**（解散置空行按 `teamIdSnapshot` 口径纳入对账全量——§1.4ter）；intent 行 teamId 列供直查。
- void_/unfreeze 解冻行 type='release'+**reversesId 指向被冲销的 reserve 行**（两写点同批：team-credit:230+intent-reconcile:183）；**refund 行同配 reversesId 指向被冲销的 settle 行**（intent-reconcile:203-219 写点同批）；settle 幂等=settle_once 唯一索引（应用层 CAS 保留为第一道）；release/refund 幂等=**reversesId @unique**（v2.2：release_once 部分索引删——全局唯一已含 1:1）。
- **unfreeze CAS 补 `reservedCredits: {gt: 0}`**（intent-reconcile:165-167 对齐 void_ :207——rearm 后 RUNNING∧reservedCredits=0∧reserve 行存在（含正向冲销行）的二次退款窗口关闭，3 行改动）。
- chargeRows 查询加 `amount:{lt:0}`（混合符号洞）+reversesId IS NULL（二次退款洞）；refund 同批归零 reservedCredits+rearm 与 refund 的交互用例（VOIDED 重激活后不得二次退款——reversesId @unique 链使其不可能）。
- 分域白名单 guard：intent 资金域 {reserve,settle,release,refund}（team-credit+intent-reconcile 写入点）；账户域 7 值——**guard 统一落 CreditLedgerService 单点**（§1.4bis）；全量枚举清单进契约表——**语义两列真值表（v2.2 权威=§1.4bis 表，取代 v2.1 一维三分表述：settle 行 balanceDelta=0 不入余额 Σ 但 frozenDelta=−X 必入冻结 Σ——一维表述按字面实现=第五查冻结腿首条即破）**；遗留=consumption（零写点，禁删枚举值）。
- 红用例：**跨团队同 intentId 各 reserve→一侧 settle/void→断言另一侧台账零变化+余额不变**（现实现必红）；**rearm 二次退款红**（rearm 后 RUNNING∧reserved=0→现 unfreeze 把正向冲销行再退一遍（红）→CAS 补齐后不可能（绿））。

**1.4bis CreditLedgerService——台账唯一写入口（v2.1 新增；v2.2 按 N1/N6 全面改写）**

- **并发纪律钉死=FOR UPDATE**（v2.1"两式选一进 plan"作废——第七轮 N6：本批自采纳的 balanceAfter 链校验要求严格串行，乐观 version 重试路径给不出可靠链值（READ COMMITTED 下 `update where version=x` 锁释放后重判谓词=充足性检查被绕过）；且账户域 team-recharge:140-144/team-subscription:142 已是 FOR UPDATE，统一原语消除双轨）：`mutate()` 首行 `SELECT … FOR UPDATE` 锁 TeamBalance 行→读旧态→算 delta→写→流水；`version` 列降级为**单调审计计数器**（每次 mutate bump，不作仲裁）；reserve 的 CAS 重试循环（team-credit:98-153）删除；余额不足一律业务码 `CREDIT_INSUFFICIENT`。
- **delta 由状态迁移计算（N1——禁 type→常量查表）**：`mutate(tx, {teamId, operatorUserId, type, creditType, balanceDelta, frozenDelta, referenceId?, reversesId?})`——**只收 deltas 单一表示**（v2.1"amount 或 deltas"双表示作废——同一量两种输入=漂移面；`amount` 退化为派生显示字段由 mutate 写入）；调用方给出语义意图（reserve/settle/release/refund/账户域值），**mutate 读旧态（intent 行+余额行）校验迁移合法性并复核 delta**——真值表不可能与实现漂移、新增 type 被迫声明两 delta（编译期）。**两列真值表（权威——从现行代码语义反推，进契约 4）**：

| type | balanceDelta | frozenDelta | 依据 |
|---|---|---|---|
| reserve | −X（分池行） | +X | reserve 真扣池（:106-120）+reservedCredits 0→X |
| **settle** | **0** | **−X** | 仅 reservedCredits→creditsConsumed（:171-174）池不动——**冻结核销恰在 settle**（v2.1 一维表"settle 不入 Σ"按字面实现=第五查 frozen 腿第一条 settle 即破） |
| release（void_/unfreeze） | +X | −X | 回补池+归零 reservedCredits |
| refund | +X | 0 | 只对已 settle 行（冻结已归零） |
| 账户域 7 值 | ±amount | 0 | 不涉冻结池 |

- **三条可执行不变量（G-2 权威形态）**：①`per (teamId, creditType): Σ balanceDelta ≡ 当前池余额`（清账后从零成立——**分区键必须 (teamId,creditType) 非"seq 全序"**（v2.1 措辞错误：双池行交错全序链必断））；②`per intent（referenceId 锚）: Σ frozenDelta ≡ intent.reservedCredits`（终态恒 0）；③`per intent 终态: Σ balanceDelta ∈ {0（VOIDED+release）, −creditsConsumed（settled）}`——③同时是 F2 二次退款的**直接检测器**（比 reversesId 唯一冲突更早报警）。
- **11 写点改道**：intent 域 4（reserve/settle/void_→release/unfreeze→release+refund）+账户域 7（team-subscription:92/team-recharge:162/team.bootstrap:29/personal-team-ledger:86/grant-credit.processor/payment-success.processor/admin-subscription:62-84）——admin-subscription 无事务非原子随之消灭。
- **扫描锚**：`TeamCreditTransaction.create|createMany|updateMany` 生产代码仅允许出现在 CreditLedgerService（allow 自证）+资金域禁新增 version 乐观重试（FOR UPDATE 单源锚）。
- 红用例：admin-subscription 并发撕裂（红→绿）；**两列真值表锚**（现设计 ΣfrozenDelta≠Σintent.reservedCredits 必红→按状态迁移算 delta 后恒等）。**落地约束（v2.3 补；v2.4 ②全局化——第九轮 P1-1：v2.3"锁序固定先 TeamBalance"与 reconcile 现行"先 GenerationIntent"并存=教科书 ABBA——实测 unfreeze/refund 两事务首句=GenerationIntent 行锁（guard CAS，intent-reconcile:165-176/:206-217）、同事务内再写 TeamBalance，并发 reserve×unfreeze（reaper×用户重试，现实可达）⇒40P01 中止其一；且账户域写点无 intent 行可锁⇒"intent 先行"不可能全局成立，**唯一全序=TeamBalance→GenerationIntent→（流水/TeamMember）**）**：①**balanceAfter 按池取分量**——reserve 同时扣两池写两行（team-credit:106-111 subDeduct/regDeduct），每行 delta 只取该行所属池分量（契约 4 已注分区，此处注**行级分量**）；②**全局锁序 `TeamBalance → GenerationIntent →（TeamCreditTransaction/TeamMember）` 三处同序落地**：(a) `mutate()` 首行 FOR UPDATE TeamBalance；(b) **intent-reconcile 的 unfreeze/refund 两事务首句补 `SELECT … FOR UPDATE` on TeamBalance**（现行 guard CAS intent 先行=ABBA 源头，改序非重构——首句加锁原 CAS 保留）；(c) 迁移⓿ LOCK TABLE 列序同此（§1.1③）；**出口锚=同团队并发 reserve×unfreeze×refund 各 N 轮零 40P01**（现设计必红，§6.1）；③**reserve 的意图 CAS 必须在持锁期间完成**——四条既有守卫（gate CAS:86-89/alreadyReserved/GATE_LOST:95/QUOTA_EXCEEDED）改道后**逐条保留+各一用例**（GATE_LOST 分支重构中极易被静默删掉）；④**TeamBalance.upsert 行不存在时 FOR UPDATE 无行可锁**——`insert … on conflict do nothing → SELECT FOR UPDATE` **有界重试 2-3 次**（v2.4：并发插入方回滚时单次重试仍可能空手——第九轮 P1-E）+并发首授用例。

**1.4ter 团队/项目生命周期资金门（v2.1 新增——第六轮 3.2 黑洞实证）**

- **解散/删项目前置清算门**：`disbandTeam`（team.service:423 前）与项目删除路径——存在该团队/项目 **RUNNING intent 或 GenerationIntent.reservedCredits>0**（v2.2 勘误：reservedCredits 列在 GenerationIntent 非 TeamBalance——TeamBalance 无冻结列，纯记账法批0.5-9 设计）⇒ 409 `TEAM_HAS_ACTIVE_FUNDS`（引导等待在飞完成或强制 VOID+release 后重试）；一个 guard service 两处调用，纯应用层无迁移。
- `GenerationIntent.teamId` 新列**不设 FK**（纯冗余列供资金路径直查——projectId 亦无 FK 同族；防级联语义吞审计行）。
- 台账 `teamIdSnapshot`（迁移③）承担解散后审计：置空 teamId 的行按 snapshot 进对账全量口径——**红用例**：解散后 reconcileDaily 对该团队流水 Σ 仍可计算（现实现：置空行从"必带 teamId"查询消失+在飞 intent 孤儿使 `teamBalance.update({teamId:null})` 崩溃循环（红）→清算门+snapshot 后 409 拒解散/终态后解散对账完整（绿））。

**1.5 settle 失败对账闭环+语义倒置修正（E25/E49②）**

- 红用例先行：注入 settle 失败→悬留行（终态∧reservedCredits>0）→现 reconcileDaily 落不进任何分支（红）。
- 第四分支（判据=**deliveredAt 非 resultRef**）：deliveredAt 有值→补 settle；无→VOIDED+release 释放；执行链：settle 失败时 totalDeducted 不加 cost（emit 的 totalCost=实扣真值）+`execution_settle_failure_total`——产物照发（E53），账由对账闭环。
- **F7 修复**：7 天清理加 `reservedCredits: 0` 守卫+`intent_frozen_stranded_total` 巡检指标。

**1.6 reconcileDaily 拆档（E72①/A13）**

- 启动补跑**只跑 PG 侧**（intent+流水对账——幂等由 guard.count CAS 保证）；sweepOrphanExec（O(项目) withDoc 装载）移出启动路径：每轮限量（上限 N=10 项目+按最近活跃排序）；@Cron 死注释删。

**1.7 子批出口**

- 四处相等（请求内同源断言：validation.totalCost≡Σintent.creditCost≡resolver totalCost≡Σsettle 流水+text+image+video 混合组用例）；同键规则 DB 拒绝（红→绿）；跨团队隔离绿；混合符号/二次退款红→绿（含 rearm 红用例+reversesId @unique DB 拒绝用例）；**第五查三不变量绿**（G-2 权威形态——balanceAfter 链按 **(teamId,creditType) 分区+seq 排序**）；**CreditLedgerService 扫描锚绿+admin 并发撕裂红→绿**；**解散/删项目清算门红→绿**（在飞冻结时 409；终态后解散 snapshot 对账完整）；**图像编辑 4 kind 改道绿**（CREDIT_COST_PER_EDIT census 清零+NodeType/规则行 seed 在位）；deliveredAt 判据用例绿；F7 守卫绿；定价覆盖度门禁绿（支持矩阵+NodeType 存在性+形状统一）；台账分域 guard 绿（单点=CreditLedgerService）；迁移 fresh replay+verify-indexes 新块绿（**清账⓿门控三态用例绿（v2.4 极性修正）：空库 replay 静默通过/纯测试数据清零归零/注入 recharge 行拒绝——红相留档**）；**资金写全局锁序锚绿（v2.4：并发 reserve×unfreeze×refund 各 N 轮零 40P01——§1.4bis②/§6.1）**；sv/consumption 过滤 census 清零；pnpm verify 全绿。

### Y0b-2 资金运行时

**2.1 provider 硬化（E51/P-3；v2.2 补计费读混合分流）**

- **计费读分流（v2.2 新增；v2.3 判据改结构性——第八轮 P1-3：v2.2"最新 update 时间在去抖窗内"的时间窗判据会把空闲文档（最新 update 可能是几天前）推回活读，抵消全部收益）**：execute 开头的 `readCanvas` 按**结构性完整谓词 `isPersistedComplete(projectId)`** 分流——`非常驻（documents/pendingQueues 无该 doc）∧ 无在飞 store ∧ spool 无未确认帧 ⇒ PG 已完整 ⇒ 快照读安全`；谓词不满足或常驻 ⇒ 活读（行为零变化）。**两点必须同补**：①`readCanvasFromSnapshot`（collab-document.service:66-77）只读 state+updates **不含 spool 帧**——降级期批在 spool 会漏未落库编辑⇒少节点计费，谓词含 spool 检查即免疫；②`readCanvasFromSnapshot` **不查租约**（withDoc 才有 isLeaseServing :23）——补 fail-closed 租约门（Y0a-3 T8 原意）。**谓词单源**：与 §3.1ter reaper 前置、§4.1④ shrink 前置**同族三处共用** `isPersistedComplete`（三份实现必然漂移——本 spec 一直在防的形态）。收益：无入画布执行不走 withDoc 全量装载（heap 闸耦合解除）+D1 读时机差压到去抖窗。**快照解码单飞（v2.4 补——第九轮 P2）**：readCanvasFromSnapshot 每次新建 Y.Doc 全量 apply——8MB doc 解码+内存尖峰×N 并发执行=trip 750MiB 下的新尖峰源；加 2-5s TTL 单飞缓存（键=projectId+stateSeq——stateSeq 推进天然失效；与 E71 video-work 缓存同族同一实现）。

- 全 fetch：`AbortSignal.timeout`（submit per-attempt 30s/轮询单次 10s）+总 deadline+**res.ok 断言**（text 链 4xx/5xx→空串当成功的洞）；**mock 四分支删除**（:241/:262/:310-314/:320-322）→PROVIDER_UNKNOWN_MODEL（intent fail+release 零外呼）；console.log:274/:281 删。

**2.2 心跳与绝对 deadline（E51+P0-4）**

- heartbeatAt 刷新=complete/settle/fail+provider 轮询每 tick（穿透到 api-caller——回调/信号参数）；选行+三处 CAS 守卫全改 heartbeatAt（**禁半途**：判据单源，不 COALESCE updatedAt）。
- **deadlineAt 并存**（claim/reserve 时按 kind 写入 env 可调：text 90s/video 15min/image 5min）：心跳只判"进程活着"；deadline 保证**任何情况下收敛**——reaper（复用 5min 扫）对 `now>deadlineAt ∧ RUNNING` 强制作废+release+`intent_deadline_exceeded_total`+尝试 abort。
- 红用例双向：挂起外呼+心跳持续+**未超 deadline**→不 VOIDED；心跳持续+**超 deadline**→必须 VOIDED+退款（v1 单向判据的补格）。

**2.3 完成时退款（E36/A11——时序前移；v2.1 定形完整时序+交错不变量）**

- **完成时序（资金安全序，三链统一）**：provider 返回→pre-call 存在性断言（§2.4）→`nodes.has(nodeId)` 存在性检查→**`complete()`（CAS RUNNING→SUCCEEDED）→成功才写 doc 投影+`deliveredAt` 同事务写入**（交付判据单源——complete/settle/对账共用）。
  - **complete 失败（CAS count=0——已被 reaper VOIDED）⇒产物丢弃不写 doc**+`ai_artifact_discarded_total{cause:'deadline-voided'}`——**交错不变量：`VOIDED 为吸收态 ∧ complete 先于写 doc`**（资金安全优先：宁可重放补物（P1-2），不可 reaper 退款后交付=平台损失；现实现 doc 先写+complete 失败仅 warn=白拿窗口）。
  - 存在性缺失⇒refund（VOIDED+refund 流水+reversesId）+产物丢弃+`ai_artifact_discarded_total{cause:'node-deleted'}`+exec 条目置 `error{reason:'node_deleted'}`。
- writeNodeData/writeExecStatus 返回 `{written}`（现 :105 静默 return 是"想退也没依据"的根由）；**覆盖 ai-download worker**（节点被删时不 media.create 孤儿行——E53 配额一致性）；竞态用例：删除在交付后=不退/交付前=退；**reaper×settle 交错用例（v2.1 新增）**：挂起外呼超 deadline→reaper VOIDED+release→worker 迟归 complete CAS 失败⇒断言 doc 无产物+已退款（不变量成立）。

**2.4 执行前断言+门序+部分成功（E36/E40/F4/D-B④；v2.1 补 pre-call 断言+finish 单出口）**

- 真静默丢点修复：execution.service:84-85 未知 nodeIds 显式收集→`UNKNOWN_NODE_IDS`；环不入 Kahn result→`sorted.length===可执行数` 断言不一致拒+告警；零可执行→`EMPTY_EXECUTION_SCOPE`。
- **pre-call 存在性断言（v2.1 新增——D1 窗口收窄）**：execute 开头已把服务端权威全量节点表读进内存（:79-81 `canvas.nodes`）——**每次外呼前一行**断言 `allNodes.some(n=>n.id===node.id)`（三链各一处），缺失⇒void_+release 零外呼+exec 置 error+continue（部分成功语义）；与固化同源（同一 `allNodes`）⇒"请求前已删"窗口关闭，D1 残余收窄至"外呼在飞期间被删"（物理不可约——由 §2.3 complete 前检查+退款兜底；§9.5 相应改写）。
- **F4 门序**：text/image 的 `results.push` 移到 `gated===1` 之后（video 已对）；`gated!==1` 断言 results 不含该节点产物。
- **部分成功批量语义+finish 单出口（v2.1 扩）**：消灭**全部 4 个提前 return**（:152/:220/:300 reserve 失败×3+:360 catch——现实现 reserve 失败整批 return：`emitExecutionComplete` 不执行（客户端 totalCost 永不到达/loading 悬挂）+已完成节点 results 丢弃（doc 已写/钱已扣=账实不符）+catch 的 void_ 兜底被绕过）——统一**单一出口函数 `finish(partialErrors)`**：保证 emit+逐节点 `{nodeId,error}`+`success=errors.length===0`；**reserve 失败（CREDIT_INSUFFICIENT 等）改"该节点置 error 并 continue"**非 return。用例（红→绿）：3 节点组、第 2 节点余额不足→断言 ①第 1 节点产物在 doc ②emit 被调且 totalCost==第 1 节点实扣 ③第 3 节点未执行 ④响应含 3 条逐节点结果。
- **空串当成功独立红用例（v2.1）**：text 链 stub 4xx 响应→现实现返回空串 settle 扣费写空节点（红）→res.ok 断言后业务失败+release（绿）——"用户付钱拿空内容"独立验收。

**2.5 组执行幂等键+onFailed+DTO（D-B 收口）**

- `executeGroupNodes(projectId,nodeIds,runId?)`：带 `x-intent-id: runId`；服务端按 `${runId}:${nodeId}` **确定性派生**每节点 intentId（claim 分支⑤只对同 intentId 生效——SUCCEEDED 后重试落入幂等重放零外呼零扣费；**代码裁决依据**：generation-intent.service.ts:64 findUnique 入口）；单节点 executeWorkflow 同族（无生产调用方→census 删除）。
- `@OnWorkerEvent('failed')` 按 `generation_intent_active_node_unique` 反查 RUNNING 行→fail（修死代码兜底——付费意图悬空从 15min 压到锁超时）。
- DTO zod：`nodeIds` 数组校验+长度上限 `EXEC_MAX_NODES`（**v2.4 单列 env——第九轮 P1-E：v2.3"与配额常量同源"复用 COLLAB_MAX_NODES_PER_TX(2000) 是两个量（单事务粘贴预算 vs 单次执行规模）**）；非数组直接 4xx（现 500）；**`runId` uuid 形态+长度≤64 校验+生命期规则（v2.3 落正文；v2.4 改"未决窗口"制——第九轮 P1-C：v2.3"成功/模糊都保留 key"×claim 分支⑤幂等重放=**成功后再执行同参数静默无效**（不报错不扣费无新产物——把"防重复扣费"做成了"禁止再次执行"））**：①客户端复用 `utils/intentRecord.ts` 既有范式——`sessionStorage['flowweb:intent:group:${projectId}:${hash(sortedNodeIds)}']` 存 `crypto.randomUUID()`；**保留 key 的条件收紧为"未决窗口"**（请求在飞/超时/网络错误/结果尚未出现在 doc 投影）；**轮换条件**：(a) 明确失败且用户已看到；(b) **上一次已终态且产物已在 doc 投影中出现（用户已见结果）——新点击=新意图，签发新 `crypto.randomUUID()`**；判据来源=服务端权威（契约 13：读 intents 端点或 doc exec 投影终态，**禁本地 nodeProcessMap**）；②组执行按钮本地 **in-flight latch**（签发到 finish 禁用）+消费 canExecute；③`groupExecuting` 真实化（由本组节点 exec 投影推导，非 nodeProcessMap）；出口锚=**同组连续两次点击→只发一次请求；同 runId 重试→零重复扣费；成功后再点执行→新 runId 新外呼新扣费**（v2.4 第三锚——与前两条成对才封闭）。
- **幂等重放补 doc 投影（v2.1 新增——P1-2）**：重放分支（created===false，:135-139/:204-207/:279-282）现只 emitNodeStatus 不写 doc——若首次执行 writeNodeData 失败（complete 已成功=SUCCEEDED）canvas **永无产物**（重放的唯一目的落空）；重放时校验 doc 投影（读 intent resultRef/deliveredAt），缺则按 intent 行快照重写。用例（红→绿）：注入首次 writeNodeData 失败→同 intentId 重试→断言 doc 出现产物且**零外呼**（stubGlobal fetch throw 证明）。
- `CanvasView:746` 补 `.catch`（失败不弹失败 toast——"执行请求已提交，进度见节点状态"）；NodeBusy 文案分型（"该节点正在执行中"）。

**2.6 执行入口门（E36/A15）**

- **canExecute 一等谓词（v2.4 三次改判——第九轮 P0-A 证伪 v2.3 双层判据的两侧：inputHash 回显=双侧归一化耦合（同字段集/同 style 文本解析（服务端查 DB style.promptText）/同 JSON 键序/同数值规范化——任何一处漂移=**全部执行请求恒判 SYNC_PENDING**）；数值基线 n0=库计数三路不可靠（P15：批量档每批 +1 vs ack 按消息⇒恒 dirty；resetUnsyncedChanges 幻影置 1；readOnly false-ack 不减；authenticated 时刻在飞 ack 打到基线以下）。**总原则进正文：客户端永远无法自证"服务端已有我的编辑"——同步权必须由服务端判**）**：
  ①**钱的门（权威）=服务端 SV 支配检查（准入判据，v2.4 主判据）**：execute/claim DTO 携带 `stateVector`（provider.doc `encodeStateVector` 客户端现成），服务端用**与 allNodes 同一份活文档**比 `svDominates(clientSV, serverSV)`（sv.util.ts:18 既有——v8-C 后本批明确保留；collab-core 已有锚族先例 canvas-doc-update.repository.compact.int.spec:17-29）——为假 ⇒ 业务码 `SYNC_PENDING`（4xx，**零外呼零冻结、在 claim 之前——不留 intent 行不烧 attempts（rearm 上限 3 勿耗）**）。**边界显式声明（禁读作推翻 v8-C）**：v8-C 否决的是"SV 当**计费范围**判据"（客户端扣住 SV 少报工作量——计费恒以服务端权威读+plan 固化，本门不碰）；此处 SV 当**准入**判据——客户端伪造/扣小 SV 只会让自己等待（dominance 更易成立但计费不变），伪造/超大 SV 只会让自己被拒，**两个方向都不影响钱**。**已知边界（诚实登记）**：SV 对"本地删除未同步"失明（删除不推进时钟——§2.2 移交表既有登记）——该窗口归 D1 既定接受域（§9.5：服务端按其权威视图计费=工作真实发生），且"删除上游后执行下游"的用户意图本就歧义。文档常驻（发起执行的客户端必持 WS ⇒ doc 常驻）⇒检查为内存级；**非常驻兜底**=从 PG 快照读路径同趟 decode SV（与计费读同源同价——§2.1 单飞缓存共用）。
  ②**inputHash 降回纯审计（v2.4）**：§1.1② 既定"仅审计用途"回归——**服务端 claim 时自算落列，客户端不算不传**（双侧耦合消失=零归一化约定=零跨包单源义务；第九轮报告一的"字段集锁定+跨包一致性锚"要求随之消解——没有第二侧就没有漂移面）。
  ③**UX 门（非权威启发式）=自持未确认编辑标记**：本地 update 置位、**收到任意 SyncStatus(true) 清零**（§5.7 既有自持标记——v2.4 与 §2.6 收敛为同一谓词单源；禁用库 unsyncedChanges 计数（P15））；canExecute=canEdit 基础 ∧ connState==='connected' ∧ !writeFrozen ∧ 自持标记为空——误清零方向由 ①兜底（钱的门权威）。
  ④**SYNC_PENDING 客户端处理=自动重试一次**：收到后 `forceSync()` → 等下一次往返 → **同一 runId 重发**（§2.5 幂等键保证零重复扣费）——最高频路径"改完立刻点执行"从"报错"变为约 200ms 隐形等待；文案"本地内容尚未同步"；归**业务码可重试档**（非 auth 分型、非终态、不计入 collab_auth_reject_total）。
  **canEdit 不动**；两入口+组执行按钮统一消费；**writeFrozen⇒禁执行进冻结契约**；**冻结/配额 readOnly 期客户端硬停写**（collabReadOnly 第二来源+`editor.setEditable(false)` 动态翻转——PromptInput editable 仅构造期生效）；**解除路径见 §5.3 幂等快照**（自救通道走通后界面恢复——§5.7 自持标记由快照 reducer 清零，与 §5.3 同源）。

**2.7 E71 残余+子批出口**

- `/api/video-works/:id/process` 单独限流（@Throttle 独立桶）+缓存单飞（同 workId 并发回源合并）+主动失效（collab store 完成后 emit `canvas.saved`→video-work 清对应缓存，监听器 try/catch 不阻塞 store）。
- 出口：未知模型零外呼红→绿（四分支删除）；deadline 双向用例绿；退款时序竞态两用例绿（+**reaper×settle 交错不变量用例绿**：VOIDED 吸收∧complete 先于写 doc）；UNKNOWN_NODE_IDS/EMPTY_SCOPE 绿；**pre-call 断言用例绿**（请求前已删节点零外呼零冻结）；F4 断言绿；部分成功用例绿（**finish 单出口四断言**——含 reserve 失败 continue 分支）；**空串红用例绿**；幂等键重放用例绿（同 runId 重试零重复扣费+**重放补投影用例绿**+**成功后再点=新 runId 新外呼新扣费（v2.4 第三锚——§2.5 未决窗口制）**）；onFailed 反查绿；canExecute 断连态禁用绿+**SV 支配准入四用例绿（v2.4 §2.6：改 prompt 即执行→SYNC_PENDING 零外呼零冻结零 intent 行/带客户端 SV 且被支配→放行/自动重试一次同 runId 成功/改上游→执行下游→SYNC_PENDING）**；E71 三件绿+**快照解码单飞缓存（§2.1 v2.4）**。

### Y0b-3 准入与版本

**3.1 E13 全项（v2 修订版）**

- **sweep 默认开**+复验补 perm.resolve（降级=置 connection.readOnly=true+`collab_sweep_close_total{cause:'role-downgraded'}`——不断连，E13 语义=修越权写；**v2.1 补：降级同时改写该连接 awareness state 的 role**——只置 readOnly 不改 awareness（E73 注入源=认证时 context.user）⇒被降级者成员表仍显示"编辑者"=只治写不治显示；改/删既有 state（P9 允许、禁 set 新 id））。
- **权限失效事件驱动为主**（报告 2 3.5）：team-member/project-member 变更点 emit EventEmitter2 事件（project.gone 先例）→gateway 即时匹配连接降级/踢除；sweep 降为兜底（60s→5min+jitter±20%+会话级结论缓存 5min）——**v1"单人团队特例分支"删除**（人数可变=缓存负资产；事件驱动下单人天然零事件）；E39"无 sweep 查询"格口径=事件面零+兜底 5min。
- **Origin 白名单**：onUpgrade 钩子校验 `Origin ∈ COLLAB_ALLOWED_ORIGINS`（默认=BETTER_AUTH_URL origin+dev localhost）；Origin 缺失=拒；非浏览器工具注入 Origin header；`collab_upgrade_rejected_total{reason}`。
- 默认绑定 127.0.0.1（:204 默认值翻转）；cookie-only（§1.3 对象 4）；鉴权拒绝计数 `collab_auth_reject_total{reason}`+结构化日志（deny 单点）。
- **升级限流（v2 修正 IP 源；v2.1 修正计量口径）**：键=`X-Real-IP`（**仅 socket peer 为 loopback 时信任**——绑定 127.0.0.1+nginx 同机使前提成立；nginx:12 已设）+`COLLAB_TRUSTED_PROXY` 门控；无 X-Real-IP 回落 socket peer；阈值 60/min+burst 20（多标签友好）；内存 token bucket+重启清零（DoS 兜底非配额，注释钉死）。~~"已升级未认证"连接排除~~ **v2.1 删除排除**（第六轮证伪：被拒连接恰是 Auth 重放载体——正常客户端 31s 周期循环（P13）、自制客户端 30s 窗口重放放大；升级桶计入**全部**升级尝试+配第二桶见 §3.1bis）。

**3.1bis 拒绝路径防放大（v2.2 全面改写——第七轮 Auth 旁路实证推翻 v2.1 落点）**

- **库内分流事实（esm:884-902 一手实证；v2.3 引证修正——第八轮 P0-2：v2.2 写"失败路径 :941 delete **不补**"表述歧义可被读成"delete 缺失"，实际 **:941 正是那个 delete**——:902 在跑 onAuthenticate **之前** add(rawKey)，失败路径 :941 把它 delete（且 :942-944 连带清空队列——重放连队列上限都不吃）⇒ 下一条 Auth 重新满足 :888 旁路条件⇒ 重放可行；结论不变、证据方向已正）**：`handleQueueingMessage` 对「Auth 帧 ∧ 该 rawKey 未建立连接」走**专属旁路**（:888/:902）；Connection 级钩子对 Auth 重放结构性不可达。未认证队列闸（:891-895）只作用于非 Auth 帧。
- **画像（P4/P13 维持）**：正常客户端=31s 周期×4 查询/轮无限循环（根修=E24 terminal disconnect）；自制客户端=单 socket 30-60s 窗口 Auth 重放无限制×并发 socket。**pre-auth 内存上界注记（v2.3）**：升级速率 60/min/IP×存活 30-60s×1MB 队列 ≈ **30-60MB/IP**——无全局上限，诚实登记（不新增机制；HTTP 层反代限流兜底归 Y0.5）。
- **四层防线（v2.3 钉死执行序——零 DB/零分配优先：`refusalCache → 并发信号量 → per-socket 桶 → heap 闸 → 版本门 → 四次 DB 查询`**，"heap 闸最前"与"refusalCache 最前"并存歧义消除——refusalCache/桶/信号量全部零 DB，heap 闸测量 O(1)）：
  1. **refusalCache（零 DB）**：命中即 throw。**白名单精确四类（v2.3——第八轮 5(b)）**：draining/lease-not-ready/db-unavailable/server-overloaded（**状态源可达的瞬态类**；terminal 不入=客户端已 disconnect；**信号量溢出与桶超限的拒绝不入缓存**——瞬时拥塞≠状态故障，入缓存=一次拥塞变 15s 确定性拒绝）；**TTL 15s 绝对过期不续期**+状态源变更主动清空（drain 解除/租约 rejoin/heap 闸释放/**spool 恢复与 PG 熔断半开成功**——并集）；键=(documentName, 身份指纹)；**锚用例"四个清空钩子缺一即缓存失效测试红"**（删钩子没人发现的防线）。
  2. **全局并发认证信号量**：`COLLAB_AUTH_INFLIGHT_MAX`（默认 8）——tryAcquire 满则 throw deny(SERVER_OVERLOADED)；finally 释放。唯一不依赖库内部结构的乘积闸。
  3. **per-socket 认证尝试桶**：`payload.socketId`（d.ts:480）为键，≤`COLLAB_AUTH_ATTEMPTS_PER_MIN`（10/min），计数在 onAuthenticate 顶部；超限 throw 带 reason——断连由库 30s 超时自然完成（P4：check 基准=establishedAt，**死于 30-60s（首 tick+timeout）**——v2.3 口径统一，"30s 必死"作废）。
  4. **pre-auth 库配置三 pin**（§7.1）：maxUnauthenticatedQueueMessages=256/Size=1MB/maxPendingDocuments=100+启动存在性断言。
- **验收锚（v2.2 改输出级——"第 11 次断连"在当前钩子面写不出来）**：①同一 socket 连续 N 次被拒 Auth→**mock prisma 调用计数不随 N 增长**（refusalCache+桶生效硬证据）；②并发 M socket 同时重放→**在飞 onAuthenticate 峰值 ≤ INFLIGHT_MAX**（信号量硬证据）；③超限 socket 在 ≤61s 内消失（库 30s 超时）。v2"拒连后 N 秒内升级次数==0"客户端终态锚保留。

**3.1ter 拒绝语义补（v2.2 新增——第七轮 P0）**

- **Origin 白名单拒绝形态改写**：onUpgrade hook throw 在库 async 监听器内=未处理 rejection（esm:1623-1636 实证）——**不回 HTTP 响应不关 socket**，白名单形同虚设。改：hook 内 Origin 非法⇒**直接 `socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')+socket.destroy()`**+计数（随后的 crossws.handleUpgrade 在已销毁 socket 上安全 no-op——ws completeUpgrade 首行判 readable/writable）；锚用例=真连+伪造 Origin→握手失败+计数。客户端侧区分不了 Origin 拒与网络故障（浏览器 WS API 只给 error）⇒映射表归"网络错误+退避"档，观测只靠服务端计数（§5.2 注明，防客户端找不存在的 code）。
- **reaper 前置谓词（§3.2 释放路径补）**：调 `server.unloadDocument()` 前必须 `零连接 ∧ !isLoading ∧ pendingQueue 空 ∧ 无 in-flight store ∧ spool 无未 confirm 帧`——不满足则**跳过并计入 `yjs_doc_stuck_total`**（stuck 非零=真问题该告警，而非被 reaper 掩盖；库 store 失败"保内存"是有意数据保全，reaper 打破它前必须确认屋里没人）+`yjs_doc_reaped_total`。

**3.2 heap 压力自保闸（D-A——三裁定报告细节合并）**

- **谓词**（单源 util 禁第二套；v2.4 与"配置即契约"段同步——第九轮清扫：谓词 bullet 是实施抄写处，v2.3 只改了下文漏改此处+旧 env 名残留）：`pressure = max(heapUsed/v8.getHeapStatistics().heap_size_limit, rss/COLLAB_RSS_TRIP_BYTES)`；`>0.8` tripped / `<0.7` 释放（迟滞防抖动——两阈值同常量块注明差异理由）。两项各管一种死法互不重叠：V8 比例管 GC 螺旋（heapUsed 纯 V8 口径）、RSS 项管原生内存膨胀（RSS 已含 external/arrayBuffers——再并入 V8 比例=重复计数+量纲错位）。
- **落点双点同源**：①onAuthenticate 内、四次 DB 查询之前（v2.4 措辞对齐 §3.1bis 执行序：位于零 DB 三层——refusalCache/信号量/桶——之后，"最前"仅相对 DB 访问；压力期被拒重连不得打 DB）+条件 `!documents.has(documentName)`（**已加载 doc 重连不拒=防自伤**）；②loadDocument 钩子第一行（唯一装载汇聚点——WS/DirectConnection/REST withDoc 全经此，Y0a-3 三入口门先例）；REST 物化入口同源命中→503 SERVER_OVERLOADED（并入 503 语义化）。
- **拒绝语义**：`CollabAuthReason.SERVER_OVERLOADED`（append-only 词表末尾追加；**瞬态档，严禁入 isTerminalReason 四档**——枚举处注释钉死：误入终态=一次内存尖峰把全部客户端钉死且不自愈）；客户端横幅「服务繁忙，正在自动重试」+**应用层退避**（**库 onClose=固定 1s 重连无递增（P12——v2.3 清扫"3s 固定轮询"旧口径：3s 是 connectionChecker 检查周期非重连间隔）**——RECOVER_BACKOFF_MS 族）+hydration 死线分型联动（§3.5.4）。
- **fail-open**：测量调用抛错/返回 0→放行（指标失败不得全站拒连）；压力期日志打四数（rss/heapUsed/heap_size_limit/external+arrayBuffers）**采样**（禁每拒一条 ERROR）。
- **释放路径（v2.1 新增；v2.2 补前置谓词）**：库在 store 失败时**主动保内存**（esm:1547 "Document stays in memory to avoid data loss"→return 不 unload 且无人再调 unload）⇒ 失败 doc 零连接后永驻=压力永不回落=**闸门触发即永久拒新物化（唯一恢复=pm2 1G OOM）**。修：①**5min reaper**——对候选 doc（零连接&&!isLoading）先过 **§3.1ter 前置谓词**（队列空∧无在飞 store∧spool 无未确认帧）再调 `server.unloadDocument()`（幂等：内部自带 shouldUnloadDocument 三守卫 esm:1571-1573）；不满足计 `yjs_doc_stuck_total` 跳过；②`collab_doc_store_failed_total`+`yjs_doc_reaped_total` 进 metrics/巡检。`COLLAB_MAX_LOADED_DOCS` 维持 env 预留零消费（env.ts:43 注释已诚实登记"enforcement 归 Y1c-3"，不接不删）。
- **配置即契约（v2.3 按实测基线重标——第八轮 P1-1 勘误第七轮基准：896MB 是"杀线下界算式"（old-space 512+384 余量）**非**"合法工作区"，实测 RSS 基线=138.8MB（server-profile F1）⇒ trip=912MiB=基线 6.9 倍才动手+杀线余量仅 112MB，而闸门只拒新物化不立即释放（reaper 5min+离线时延）——**可能来不及**：真到 912MiB 时一次 compact 编码尖峰（×5-10 放大）即顶杀线=闸门没起作用）**：标定规则**两端各据**：下界=实测基线×安全倍率（≈420-560MB）∧上界=杀线−缓解时延预算（≥200-250MiB）⇒ **`COLLAB_RSS_TRIP_BYTES`（默认 786432000=750MiB）/`COLLAB_RSS_RELEASE_BYTES`（默认 629145600=600MiB）**；§9.15 人工评估线同步降 600MiB（保持 评估线<闸门<杀线 单调——人先看见机器后动手）；check-ecosystem 断言链 `baseline×4 < release < trip < max_memory_restart−200MiB`（baseline=profile 常量，注明"加载演练后实测重标"；**896MB 断言保留原用途**=杀线相对 V8 cap 足够宽——两件事禁互相引用）；**trip 2 连续采样**。**pressure 谓词量纲修正（v2.3）**：`max(heapUsed/heap_size_limit, rss/TRIP_BYTES)`——~~(heapUsed+arrayBuffers)/heap_size_limit~~ **删 arrayBuffers 项**（RSS 已含 external/arrayBuffers，再加进 V8 比例=重复计数+量纲错位——external 不受 heap_size_limit 约束该比例可 >1 而 V8 无恙；它要覆盖的失效模式已由 RSS 项覆盖）——两项各管一种死法（GC 螺旋 vs 原生内存膨胀）互不重叠。
- **指标**：`collab_load_rejected_total{reason='server-overloaded'}`+`collab_overload_state{state=ok|tripped}` gauge（"熔断开着"与"真挂了"可区分）；巡检把"持续拒装载"列 P0（安全阀静默降级=全站少服务而无人知）。
- **边界写死**：仅拒新物化、**永不驱逐存量**（驱逐打断活跃编辑+重连风暴——**reaper≠驱逐**：仅卸载零连接 doc，活跃连接在=shouldUnloadDocument 拒绝不卸，两不矛盾）；不覆盖单 doc 病态装载（**装载路径单行硬拒绝=Y0b-4 承接**——Y0a 移交）与 compact 尖峰（compact 是释放路径不能因压力停——登记 Y1c-3 输入）；有真实用户后与 LRU 同批重估。
- **验收红用例（v2 三+v2.1 一）**：①stub pressure=0.9→新 doc 拒+计数+客户端瞬态档；②**同压力下已加载 doc 重连不被拒**（最易写错）；③谓词抛错→放行；④**释放路径**（v2.1）——stub store 失败+零连接→现实现 doc 永驻（红：gauge 持续非零/压力不回落）→reaper 5min 后卸载+压力回落可再装载（绿）。

**3.3 E73 awareness 覆写**

- beforeHandleAwareness：剥离 states 各项 `user` 字段+注入 `serverIdentityOf(context.user)`（{id,name,role}+color=userId 确定性哈希——与客户端现配色同源挪服务端）；context undefined（DirectConnection 内部写）不注入；**只改/删既有 state**（P9：states.set 新 id 会抛）；onAwarenessUpdate 仅观测禁改写（注释钉死）。
- **awareness 归属（v2.3 落正文机制——第八轮 P1-5：v2.2 只有锚无实现规则；E73 覆写只防身份伪造，防不了"移动/抹掉他人光标"——更新帧可携带任意 clientId（applyAwarenessUpdate 按帧内 clientId 应用，server :204-212 重编码后进真 doc））**：①网关维护 `Map<连接身份, Set<clientId>>`——**键=`payload.socketId`（v2.4 定案——第九轮评审"context 是唯一逐连接通道、须注入 connectionId"证伪：beforeHandleAwarenessPayload 声明含 `socketId: string`（d.ts:609——报告只读到 :608 截断）+运行时 esm:1512 同传（:1514 连 `connection` 也在）；socketId 逐连接唯一=同用户双标签天然隔离，connectionId 注入零新机制驳回）**；首次出现的 clientId 归该连接（首见登记）、单连接上限 4、断连/卸载清理**带所有权校验**（只清 owner===该 socketId 的条目）；②beforeHandleAwareness 对 states 中**非本连接登记的 clientId 一律丢弃**（丢弃非改写——不"替别人发声"）；③库侧 `document.connections` 的 `{clients:Set}`（esm:560/:601-603/:631-632）作一致性校验源——差异计数告警（不信赖库内部也为漂移留探针）。锚：伪造他人 clientId 帧→对端 state 不被覆盖（现状必红；"他人"=**跨用户**定义）+**同用户双标签断连不冻结对端光标**（socketId 隔离回归锚——廉价但钉住键选型）。
- 客户端 setLocalUser 退化（awareness.ts:54-56 删 user 写入）；消费面（CanvasTopBar/RemoteCursors）读注入同形字段=预期零改动（用例验证）。
- 锚用例：VIEWER/匿名伪造 user→两端快照=服务端值；伪造者身份不影响成员表。

**3.4 E60 版本门（两常量分离）**

- **`CANVAS_DOC_SCHEMA_VERSION`**（docShape:41=2，**既有**——文档结构，Y1c bump）与 **`CLIENT_PROTOCOL_VERSION`**（**本批新建**——客户端代码/线路协议，csv 参数所指；v2.1 勘正：全仓现零命中，非"分离既有两常量"而是新建并列）显式分离命名+兼容矩阵（`Record<ClientProtocolVersion×DocSchemaVersion, 允许|拒绝理由>` tsc 封闭）；video-work 缓存键（:34 已拼 doc 版本）核对用后者。
- URL query `?csv=&cb=`（R-6 终裁：query 通道——provider 无 query 配置项但 URL 调用方构造（P6）；csv/cb 非凭证与删 query token 不矛盾）；`collabUrl()` **只算一次**再传 transport 与 provider（v1 两处调用不一致风险）。
- onAuthenticate 校验序（最前廉价）：缺 csv→`CLIENT_VERSION_MISSING`（D12 缺参档——旧 bundle 不带参数同拒）/不可解析→`CLIENT_VERSION_INVALID`/不匹配→`SCHEMA_OUTDATED`；`collab_version_negotiation_reject_total{reason}`；**精确相等维持**（开发期禁兼容层——区间协商=多版本支持=兼容层，R 终裁驳回；区间协商建议同驳）。**拒绝后 UX（v2.1 折中；v2.3 补逃生动作——第八轮 P1-4：reload 守卫×粘滞×版本拒绝=三锁互扣死页）**：版本过期档=自动 `location.reload()` 前置 `!hasUnsyncedCanvasChanges()` 门（loop 保护键=**观测到的服务端协议版本**——下次部署仍能自愈一次）；门为真（有未同步编辑）时落**唯一逃生动作**=「导出本地画布→强制刷新」一键（序列化 store→下载 JSON→清 sessionStorage intent 标记→reload），**该按钮不受未同步守卫约束**（它就是为未同步而设；与 §5.5"请先导出"合并同一动作/同一按钮）。
- clientBuild 注入：vite `define __CLIENT_BUILD__`（git sha+build ts）+index.html no-store（nginx snippet）+资源 hash 天然。
- **access_log off 断言锚**（R-6）：部署前置门/smoke 读 `nginx -T` 断言 /collab 段含 `access_log off`；§9 登记依赖。

**3.5 E56 修订版（拒载保留+客户端终态）+连接寿命**

- **保留 onLoadDocument 拒载 throw**（`SCHEMA_OUTDATED` 标记——永不物化/下发旧档；绕开 throw 会触发 stamp 分支静默盖章 v2（§1.1B）+connected 钩子在首批消息之后拦不住内容下发（P5））。**reason 通路 v2.1 断链修复（第六轮 2.2(1) 实证）**：现状 gateway:344 只附 schemaRefusal 标记未附 reason+词表无 SCHEMA_OUTDATED ⇒ 客户端收字面量 permission-denied 落瞬态桶（四档 UX 版本过期档永不触发+31s 循环燃料）。修：拒载 throw **附 `reason: CollabAuthReason.SCHEMA_OUTDATED`**（词表 append-only 末尾追加，与 SERVER_OVERLOADED 同批；gateway :352 db-unavailable 已有附 reason 惯例——补齐同风格）+**SCHEMA_OUTDATED 进 isTerminalReason 终态白名单（第五终态档）**+锚用例断言客户端 `authenticationFailed.reason==='schema-outdated'`（库 esm:939 `error.reason ?? "permission-denied"` 透传+onLoadDocument throw 经 :936 冒泡进 onAuthenticate catch 同走 PermissionDenied 帧——通路 dist 实证可行）。
- **客户端终态映射**（Y0b-5 联合）：terminal reason→`websocketProvider.disconnect()`（唯一官方停重连开关）+四档 UX；refusalCache 语义/白名单/TTL（15s+状态源清空）**以 §3.1bis 为单源**（本行旧"TTL 5min"作废——v2.2 已改 15s 本行漏同步，v2.3 清扫）。
- 连接最大寿命 12h：**自建 `Map<connection,establishedAt>`**（connected 钩子播种——P11 connectionEstablishedAt 私有不可达；键控清理纪律：卸载/项目删除/团队解散清理+上限）；超时→`webSocket.close(4402,'max-lifetime')`（**P7：connection.close 丢 code——统一 webSocket.close**；4401 已被库 Unauthorized+ sweep 双占用）；env `COLLAB_CONN_MAX_LIFETIME_MS`。
- **close code 分配表**（shared 新常量模块，与 CollabAuthReason 同文件族）：应用=1012（已有）/4401（sweep session-expired，与库 Unauthorized 同族注明）/1000/**4402 max-lifetime（新）**/**4404 doc-over-quota（Y0b-4）**/**4410 generation-superseded（预留 Y1c-1）**；**库自发**=4205 ResetConnection/4403 Forbidden/4408 ConnectionTimeout/1009 MessageTooBig——映射表全含（客户端按表分型，禁字面量散落）。
- session-expired 静默续期一次（客户端 4401→静默重连一次，失败才终态）。

**3.6 子批出口**

- sweep 默认开+角色复验降级用例绿（**含降级 awareness role 改写断言**）；事件驱动即时踢权用例绿；**Origin 拒=握手失败锚（socket 403+destroy+计数——v2.2 形态）**；cookie-only 夹具全绿+`?token=` census 清零；awareness 伪造锚+**归属锚（伪造他人 clientId 不覆盖对端 state）**用例绿；版本门三档拒+计数+**联合锚（拒连后 N 秒内升级次数==0）**+**版本过期档自动 reload（前置 `!hasUnsyncedCanvasChanges()` 门——v2.2；真时落手动+导出；loop 键含观测到的服务端版本）用例绿**；schema 拒连演练=**客户端 `authenticationFailed.reason==='schema-outdated'`（第五终态档）**+disconnect 终态+**N 秒内重连次数==0**；**防放大（v2.2 输出级三锚）**：①连续 N 次被拒 Auth→prisma 计数不随 N 增长 ②并发 M socket→在飞 onAuthenticate 峰值≤INFLIGHT_MAX ③超限 socket ≤61s 消失+refusalCache 瞬态 TTL 15s/状态源清空用例；heap 闸四红用例绿（含**释放路径 reaper+前置谓词**④——stuck 计数/reaped 计数）；check-ecosystem 区间断言 `baseline×4 < release < trip < max_memory_restart−200MiB`（v2.4——第九轮：trip=750∉旧 (896,1024) 开区间，照旧锚实施必红）；连接寿命（fake timers）+4402；升级限流（X-Real-IP）+认证三防线用例绿；**stateless ping 15s 空闲保活（pong=ping 前置同批落地）+onStateless 全函数化+全局 unhandledRejection 兜底——红锚"真连发非法 payload→进程存活+bad_payload 计数"+双向出口锚（一次 ping 后 ≤5s 客户端 lastMessageReceived 刷新；collab_idle_timeout_total 趋零 ∧ 客户端零 4408——只测服务端计时器=假绿）**；access_log off 断言锚落。

### Y0b-4 配额与 awareness

**4.1 E52 三层（v2 修订：apply 前拒绝）**

- **①客户端前置校验=唯一"拒该次写入"点**：dispatchCanvasIntent 入口预算（事务字节≤256KB+单键字符串≤256KB+节点数≤2000）——超限业务 UX **不产生本地写入**+`recordCollabDiag('write_reject')`；pasteGroupClipboard 分块（多 transact——undo 合并靠 captureTimeout 500ms 窗，断言分块粘贴 undo 一步）；单键上限标注**临时闸门**（Y.Text 落地时重切——返工面登记 §9）；预算校验收敛单一 seam `canApplyIntent(intent):{ok|reason}`。**信息源契约（v2.1 新增）**：客户端本地维护 `serverWatermark + localBytesSinceWatermark` 预估（O(1) 累加，与服务端 apply 字节同源口径）——前置校验用**预估**、水位通告（③）到达时**校准**；偏差方向=高估安全（登记 §9.8：水位到达后本地又写 200KB 的窗口内，预估会放行一个可能被服务端拒的事务——服务端 apply 前拒绝兜底，两层不混）。
- **②服务端 apply 前拒绝（P8；v2.2 判据改投影制——N2：v2.1 累计入站字节与①③的 doc 体积不同源=客户端预测的变量≠服务端杀人的变量，且只增不减（粘贴→删除→再粘贴双计）/新连接从 0 起算对既有 doc 无意义）**：beforeHandleMessage（payload 含 `document`——server d.ts 证实）判据=`docBytesEstimate(docName) + update.byteLength > COLLAB_MAX_DOC_BYTES ⇒ throw{code:4404}`（帧不 apply 不物化+断连）——**docBytesEstimate=装载播种+apply 字节累加的同一 Map**（yjs_loaded_doc_bytes 同变量），①②③ 三环节收敛同一变量，水位通告天然可校准；**自救闭环经④达成**（shrink 写后真值校准下调水位，readOnly 解除——不依赖 compact 时机）；**原累计字节降级为字节速率闸**（滑动窗口 bytes/s， per-connection——滥用防护语义、允许随时间复位，替代原"消息速率闸"的字节维度；env `COLLAB_BYTES_RATE_PER_CONN` 默认 2MB/s——v2.4 补 env 契约，第九轮 P1-E：§7.1 原无对应变量）；"计帧 WARN"（单帧>1MB）**不抛**（抛=断连清队列）；`yjs_inbound_frame_bytes` 直方图；**4404 配额 throw 与认证桶不共用 hook，指标分列勿并轨**。
- **③三级阶梯（A4；v2.3 修文案与自救语义——第八轮 P1-5(a)：readOnly 连接**发不出删除帧**（update 被库拒）⇒"用户可自行删除自救"做不到=指示用户做被系统禁止的事）**：软阈（80%）→**幂等快照** `{type:'quota-status',over,bytes,limit}`（§5.3 快照模型——置位与解除同通道）+该 doc 全部连接 readOnly=true（内容保留、增长停止）；硬阈→常驻横幅「画布内容超限：**一键瘦身**或**导出到新项目**」+告警（**删"请删除内容"**——唯一自救=④ REST 瘦身/导出两通道）；持续强推才 4404（终态——不热重连防风暴）。**水位推送是①的前置校验依据**。
- **④4404 自救通道（v2.1 改 REST；v2.2 补影子预演+写门；v2.3 补 shrink 后客户端清理——第八轮 P1-4）**：**REST 瘦身端点** `POST /api/collab/doc/:projectId/shrink`（EDITOR+权限+独立限流；body=待删节点 id 集或保留集）——**影子副本预演**（Yjs 无逆 update：`encodeStateAsUpdate`→scratch Y.Doc→应用删除→再编码测量→**达标才写活 doc**；前置谓词=§2.1 `isPersistedComplete` 同源）；成功后**以应用删除后的活文档再编码校准 docBytesEstimate 真值（v2.4——第九轮 P2：预演与实际写之间可夹他人并发编辑，取预演值=系统性低估→配额很快再触发；该再编码=第三编码点白名单内）+广播解除快照（§5.3）**；**响应携带服务端签发的水位+已删节点集⇒客户端 `undoManager.clear()`（或截断到安全点）+重置 `localBytesSinceWatermark`+提示"已瘦身，撤销历史已重置"**（否则用户 Ctrl+Z 把内容带回来→帧超预算被②拒→readOnly/4404 循环——客户端撤销栈持引用阻止 GC，删除不减小编码字节）；预演编码=第三编码点白名单化兼作 yjs_doc_bytes 校准；走 assertWritable 同门+`collab_doc_shrink_total{result}` 审计；**`yDocOptions:{gc:true}` 显式 pin+启动断言**（仓库测试注释自认"gc 默认 true"但没 pin（collab.gateway.spec:514）——任何一处 gc:false 会让瘦身语义静默失效）；**`docBytesEstimate` Map 生命周期（v2.3 P2）：unload/项目删除时删条目**（防带 projectId 无界 Map）；**墓碑主导文档（反复粘贴→删除使 GC 壳/delete set 占编码主体，shrink 后仍超预算）唯一出路=导出到新项目**（§9.21 登记；in-place vacuum=重写 CRDT 历史=打断在场客户端 SV=等价导出，不做；**导出动作幂等**——in-flight latch 连续点击不建多项目，用户最焦虑时刻不制造垃圾数据，v2.4 补）；实现先经 withDoc，Y0c 门面化改道。
- **⑤装载路径单行硬拒绝（Y0a 移交必落）**：loadForHydration 读到单行>COLLAB_MAX_DOC_BYTES → decode 前拒绝（yjs_hydration_huge_row_total 帮助文本自证归属本批）。
- **⑥maxPayload DoS 兜底**：`websocketOptions:{maxPayload:16MB}` pin；~~启动后读回实际生效配置~~ **v2.1 改行为断言**（第六轮证伪"读回"：crossws 构造 WSS 后不暴露 options 引用——读回自配恒真假门禁）：①collab-core 锚用例**真连 WS 发送 >16MiB 帧断言库码 1009 关闭**（pin 生效唯一硬证据）；②**serverOptions 键集边界断言**（静态/单测：我们传入的键集 ⊆ {maxPayload}——防未来塞 noServer/handleProtocols 覆盖 crossws 强制项砸 upgrade 路径）；不可达性断言=构造系统允许最大合法写入（doc 配额 8MB 全量+首帧全量同步形态）断言编码帧<16MB。
- 数值反推表：单事务 256KB（Excel 千行级粘贴）/单键 256KB/节点 2000/doc 8MB（≈253B×2000+元数据余量）/awareness 单客户端 4KB——env 可调+Y1c-3 随 D7 复核。

**4.2 per-connection 消息速率闸+awareness 只读丢弃（E13 原项恢复）**

- 每连接 token bucket（200 msg/s env）超限计数+断连；awareness readOnly 连接整体丢弃（P3 缺口——覆写只治伪造不治刷屏）+awareness 帧独立限速。

**4.3 出站背压（E28/E36）**

- bufferedAmount 采样（broadcast 路径 1/10 抽样 O(1)——`yjs_outbound_backlog_bytes` 直方图）；一级 >1MB 跳过该连接 awareness 帧（`collab_awareness_dropped_total`）；二级 >4MB 持续 3 采样→`webSocket.close(1011,'slow-consumer')`+`collab_slow_consumer_disconnect_total`。

**4.4 E38 选区+E39 单人零开销+E40 awareness 指标**

- setSelection 接线（去抖≥200ms+只广播 id 集+RemoteCursors 高亮）；纳入 awareness 限额；>8 人服务端剥离 cursor/selection 只留成员表。
- awareness 三指标+幽灵光标 30s 空闲停上报（客户端短路）；**服务端单连接短路**（connectionsCount≤1 不转发——solo 判定用即时值不缓存团队人数）。
- E39 验收表：①1MB 文本+100 节点粘贴成功 ②单人（states.size===1）光标/选案零上报 ③sweep 口径=事件面零+兜底 5min ④对等同步等待已消灭（Y0a-3 登记）⑤文本泄漏格→Y1c-2a 登记。

**4.5 子批出口**

- 三层各一用例（前置拒不产生本地写入/apply 前拒绝帧不物化/巨帧 DoS 拒）；三级阶梯+水位通告+readOnly 自救用例（**含预估契约**：水位校准后预估误差单调收敛断言）；4404 终态+**REST 瘦身端点用例（v2.1**：写后>预算 422 回滚/EDITOR 权限/瘦身后 readOnly 解除）；装载单行硬拒绝用例；速率闸+awareness readOnly 丢弃用例；不可达性断言+**1009 行为断言+serverOptions 键集边界断言（v2.1）**；E39 表逐格绿/登记；背压一二级用例。

### Y0b-5 终态与观测

**5.1 E24 接线+四档终端 UX（+SERVER_OVERLOADED 瞬态）**

- `onAuthenticationFailed({reason})`（P6 载体）→`recordCollabDiag('auth_reject')`+wsAuthNotice 写点（reason+terminal=isTerminalReason）+遥测；terminal→`websocketProvider.disconnect()`（唯一官方停重连开关——E56 联合）。
- 四档终态：版本过期（清缓存强刷指引）/会话过期（重登）/无权（回工作区）/DB 不可用（**非终态**——横幅重试）；SERVER_OVERLOADED（非终态——横幅自动重试+应用层退避）；terminal 时 watchdog recover 抑制+不重建闭环（recoverConnection :126 TODO 收口）。

**5.2 close code+reason 统一映射表（shared 单源；v2.1 双键+全档退避）**

- 新建 `shared/constants/collab-close-code.ts`（C2）：close code 全集（应用+库自发 §3.5 分配表）+auth reason→`{UX 动作, terminal?, 重试策略}` Record 穷尽（**8 值 ready reason 补 not-serving/spool-unwritable——tsc 封闭**）；1012 迁入（runtime:839 字面量消除）；组件禁散落判 code/reason（扫描锚）。
- **(code,reason) 双键分型（v2.1——第六轮 close 码补验）**：同 code 异 reason 必须分型——库 `4401 "Unauthorized"`（认证失败族→终态）vs 应用 sweep `4401 'session-expired'`（→静默续期一次）：**只判 code 会把"库拒绝认证"当"会话过期"无限续期**；映射表键=code+reason 二元组（reason 缺失时按 code 的库默认语义分型）；`4205` 注明**库通用重置码无"超限"语义**——配额/队列超限的用户提示必须配服务端计数指标，客户端禁由 4205 推断成因。
- **reason→退避策略表（v2.1；v2.2 修正论据量级+补重连所有权——第七轮 §3.1/§5）**：`draining/lease-not-ready/db-unavailable/server-overloaded/rate-limited` **全部瞬态档**统一指数退避+jitter+上限（RECOVER_BACKOFF_MS 族一张表）。~~drain 期每客户端 20-60 次升级~~ **量级修正**（P13 画像下：被拒后 provider 静默 30s+4408+1s 重连=31s 周期，90s drain 窗≈**3 次/客户端**——v2.1 论据高估 10-20×；真实成本=客户端在周期里反复弹拒绝 UX，退避表是 UX 修复非风暴修复）；**rate-limited 必须落瞬态桶**（否则一次部署把客户端钉死）；terminal 档=disconnect 不重试。**重连所有权规则（v2.2 新增——应用层退避与库自动重连的划线，防双 socket）**：需要应用层退避/终态抑制时必须先 `websocketProvider.disconnect()`（置 shouldConnect=false——库 onClose 定时器因 !shouldConnect 不再排程）→按 reason→退避表计时→`connect()`→等 authenticated→失败再计；**正常路径禁触碰 connect()/disconnect()**（§5.2 退避表显式写为这 5 步状态机）+锚用例断言"退避期间升级次数==0 且无并发 socket"。
- **空闲保活（v2.3 改 stateless ping；v2.4 补 P0 处置+pong 前置+15s——第九轮 P0/收尾报告）**：`forceSyncInterval` **默认 false**（provider esm:626）⇒空闲连接零应用层消息⇒COLLAB_TIMEOUT 30s 判死（esm:826-829，check 首个 tick +30s ⇒ 实际死于 **30-60s**）→4408→1s 重连→重装载 doc=每 30-60s 一次新物化（四害：heap 闸豁免失效/12h 寿命被淹没/播种噪声/E39 后唯一心跳源消失）。**主保活=应用层 stateless ping/pong（15s——v2.4 由 20s 收紧：客户端 `messageReconnectTimeout` 默认 3e4+connectionChecker 每 timeout/10=3s tick（provider:138/:185/:342-349 三击 4408）⇒20s 仅 10s 余量，15s≈2×）**：客户端 `provider.sendStateless('{"type":"ping"}')`（**公共 API 实证可发**——provider esm:740-741+StatelessMessage opcode 5；v2.2 误把 E73 的"BroadcastStateless（opcode 6）对客户端 throw"扩大到单发——server :218-224 Stateless 分支正常入 hooks 且**无 readOnly 门=冻结期保活免疫**）；**pong=ping 的前置条件非可选项（v2.4 钉死——第九轮收尾报告：客户端 `lastMessageReceived` 只被入站帧刷新（provider:307）——服务端不回 pong="每 30-60s 新物化"原样保留，只是换成客户端侧 4408 触发，且服务端指标看不见=假绿）**：服务端 onStateless 见 ping **同批**回 pong——`connection.sendStateless`（gateway:660-664 write-frozen 既有先例；**禁 `document.broadcastStateless`（N 连接 O(N²) 帧）**）——双向刷新（server lastMessageReceivedAt :951-953+客户端 lastMessageReceived）；零文档工作量、不碰 awareness 不违反 E39。**服务端 onStateless hook 全函数化（v2.4 P0——P14 崩溃向量：`connection?.callbacks.statelessCallback(...)` 未 await（esm:219）+外层 async 包装 catch 后 rethrow（esm:1070-1076）+main.ts 零 unhandledRejection 兜底+Node≥15 默认 throw+ecosystem `min_uptime 30s/max_restarts 10`（文件实证）=**任意已认证成员（含 VIEWER）发非法 payload 可把 pm2 打成 errored 全站停摆**；payload=readVarString 客户端可控原始串）**：JSON.parse 与副作用全包 try/catch、异常只计数（`collab_stateless_bad_payload_total`/`collab_stateless_unknown_total`）**绝不 rethrow**；**全局 `process.on('unhandledRejection')` 兜底**（日志+Sentry+计数**不退出**——同族未 await 钩子 beforeBroadcastStateless esm:1498/onUpgrade :1633-1634 全由它兜底，冻结契约 21）；红锚=真连 WS 发 `sendStateless('not-json')` 断言①进程存活②bad_payload +1（§6.1）。**forceSync keepalive 作废**（每 20s SyncStep1=服务端为该连接全量 SV 差量编码（server:256-262）的 CPU 成本+forceSync 置 1 计数毒性见 P15）；`forceSyncInterval` 放长为**补传兜底 60s**（语义=离线补传非保活）；**禁以调大 COLLAB_TIMEOUT 换取**（pre-auth 存活窗=认证重放窗）；观测 `collab_idle_timeout_total`（趋近 0）+`collab_stateless_ping_total`（gauge——"保活是否在工作"可观测）+**双向出口锚（§3.6）**+SyncStep1 处理耗时进 §5.8 直方图。

**5.3 锁定项：write-frozen 消费+503 语义化（用户锁定 pre-real-user 一级阻断）**

- **write-frozen**：provider `onStateless`（P6 正名）收 `{type:'write-frozen'}`→transient `writeFrozen` 态：canExecute 关（**canEdit 面的写拦截已由服务端 readOnly 双保险**——gateway:663 drain 已置连接 readOnly）+横幅「服务维护中，编辑已暂停；恢复后可继续（**请勿刷新页面**）」+`recordCollabDiag('write_reject')`；恢复=drain 解除 1012→短退避重连→authenticated 清零（复用 1012 既有链路零新恢复逻辑）。**控制面幂等状态快照（v2.1 重放→v2.3 升格——第八轮 P1-3：只有"连接时重放"没有"解除下发"⇒自救通道走通、界面仍停写，唯一恢复=刷新恰好违反"请勿刷新"）**：控制消息模型=**幂等快照** `{writeFrozen, quotaState:{over|ok, bytes, limit}}`——服务端在 (a) 连接建立（connected 钩子）(b) **状态每次翻转**（进入/解除冻结、跨软阈/回落、**shrink 成功**）向该 doc 全部连接广播；客户端只按**最新快照**置位/清位（不按事件累加——乱序/丢帧免疫）；**出口锚补：shrink 成功后 <N 秒客户端本地只读态解除**（v2.2 形态写不出此锚）。
- **503 语义化（C3 前置；v2.1 收窄）**：apiFetch **仅补 `retryAfter`**（`res.headers.get('retry-after')` 挂上 error 对象——status/errorCode 已透传 client.ts:29/:35 实证，v2"丢 status"基线错误）→执行/保存/上传路径显示「服务重启/维护中，请稍后重试」+Retry-After 自动重试一次；SERVER_OVERLOADED 同族。
- 验收演练：POST /api/drain→横幅+停写→pending 排空→1012→重连恢复（双 client 装置复用）+**重连后权威快照重放断言**（模拟断线期间状态翻转→重连后 UI 与服务端一致）。

**5.4 hydration 死线分型（A16——reason 驱动非 ready 轮询）**

- `authenticationFailed{reason}` 驱动分型（**删 v1 ready 轮询设计**——auth 通道已含 draining/lease 族/db-unavailable；第二真源+惊群+限流桶三害）；瞬态档（overloaded/db-unavailable/draining/lease 族）：抑制重载引导+重试横幅+**死线延长 15s**（Y0a §9.14 中断上界 11s+装载余量）；终态档：四档 UX；边角兜底=重连成功但 ready 非 200 时单次探测（节流+抖动）。

**5.5 V15+R-3 闭环（持久化契约显式化）**

- persist-status 消费：unhealthy 常驻横幅「未保存——请勿关闭**或刷新**页面」+恢复自动消。
- **reload 守卫**：page.tsx:217/:400 reload 按钮 `hasUnsyncedCanvasChanges()` 真时禁用+文案「本地有未同步内容，请先导出」；**failed 态导出本地画布 JSON**（复用 store 序列化零依赖）——与 4404 导出通道复用。
- beforeunload 断言改**谓词语义**（hasUnsyncedCanvasChanges+editorDirty latch——不断言挂载点数量）；`unsynced_close` 遥测计数（beforeunload 判定真时一次，仅计数）。
- **持久化契约（冻结契约 12；v2.1 改写"当前态声明+自动失效条件"——第六轮 6.1 采纳折中）**：**当前态**：PG=唯一持久层/客户端无本地持久化/未同步编辑仅存活本页会话/刷新即丢——三处文案（write-frozen/4404/V15）不得承诺跨刷新恢复。**失效条件**：Y5（y-indexeddb local-first）落地之日本条前半自动作废（本地缓存成为持久化组件——E11 契约延伸），文案与导出通道随之重审；**local-first 是否提前进上线门槛=用户决策域**（E39 现行门槛结构不含 Y5——第六轮"提前"建议呈报用户，未采纳进本批范围）。**导出本地 JSON 保留**（第六轮"删垫片"建议驳回——E24 修订 D11/E5 既定裁定"保留本地可导出/可重试（不可信但不可删）"+R-3 闭环组成）。

**5.6 E55 遥测 sink（O2 细节并入）**

- `POST /api/collab/telemetry`：AuthGuard（cookie 会话——sendBeacon 不能带 Authorization）+@Throttle 独立桶+采样（ring 满或 30s 心跳批量）+**≤12 事件白名单 tsc 封闭**（7 ring 类+auth_reject/write_reject/close_code/unsynced_close/projection_duration）+无 PII（丢 query 与 hash）+白名单禁 projectId/docName+clientBuild/csv/generation 预留。
- `navigator.sendBeacon` 须 `new Blob([json],{type:'application/json'})`（text/plain 时 Nest body parser 不解析；**且禁改回 text/plain**——v2.2：text/plain=CORS simple request 不触发预检=第三方页面可跨站伪造上报，application/json 的预检正是防线）；body 上限 ≤12×512B；**type 服务端枚举映射**（禁客户端字符串进 label）；未知类型 **204**（禁 4xx 触发重试风暴）。
- ring 接 sink（prod 也在写——基线勘误后接上即有意义）；auth_reject/write_reject 接线；画布路由 ErrorBoundary；客户端直方图（doc 字节/投影耗时/同步往返）随事件携带。
- 验收：故意 1 次 hydration failed+1 次投影异常→`collab_telemetry_events_total{type}` 可见。

**5.7 E40 分叉自检+C6 客户端前置**

- unsyncedChanges 持续>60s 非零（连接健康态）→横幅+引导重载+遥测——**v2.2 限定：服务端强加的瞬态冻结/配额 readOnly 期间抑制本横幅**（N3 粘滞常亮+"引导重载"与 §5.3"请勿刷新"对立——以 §5.3 为准）；**v2.3 补消费者谓词解耦**：V15 reload 守卫/beforeunload/E40 一律改**应用自持未确认编辑标记**（本地 update 置位、收到任意 SyncStatus(true) 清零——与库计数同源但不受 forceSync reset 与 readOnly 粘滞影响）或 ≥5s 迟滞（防 stateless/同步抖动窗内点击被误拒）。
- **C6（v2.1 降级为防回归锚——"既有缺陷"定性第六轮证伪，见 §1.1C 行 107）**：1012 timer 回调加 sessionEpoch 对比（:899 既有 epoch 机制——teardown 后不 kick 新会话；现状绿非真红门）；`updateText` 补 VIEWER 门（canEdit 早退 3 行——独立成立的顺手修单点，维持）。

**5.8 E54 观测收口**

- ①Sentry collab 接线（gateway/lease/spool/repo 关键 catch+scope{docName,reason}——**URL scrub 统一规则**含 csv/cb）。
- ②**双指标拆分（E10；v2.1 补标签纪律——E54② 原裁定"去 projectId"此前漏写）**：`yjs_doc_bytes`（真值：装载播种+compact 全量编码校准——两个本来产出全量编码的事件，零新增）+`yjs_store_payload_bytes`（增量直方图）+`yjs_doc_bytes_over_threshold_total`；**全部无 projectId 标签**（histogram 按尺寸分桶——标签基数随项目数无界=Prometheus 内存增长源；"哪个项目病态"由结构化日志承担）；**指标改名连带读者**（persist-status.spec:369 等——plan 清单）。
- ③新增：`yjs_loaded_doc_bytes`（聚合 gauge——**近似口径=装载播种+apply 字节累加**（O(1) 不编码；GC 壳不回落=高估方向安全），compact 校准防漂移）+~~红线 Σ>192MB（≈堆 37%）~~ **v2.1 量纲修正（第六轮 4.2 采纳）**：编码字节≠堆占用（Yjs item/GC 结构/awareness/观察者放大倍率 5-10×）——"37% 堆占比"假设不成立，192MB 编码实际对应堆占用远超 512MB old-space=**红线永不以设计语义触发**。改：①新增**倍率实测指标** `yjs_doc_heap_amplification`（装载/卸载前后 heapUsed 差÷编码字节——两个既有事件零新增编码）；②红线**降为告警且标注"合成值待标定"**（标定前数值保守压低+双条件 loadedDocs>40 维持）；③真正承重的内存门=heap 闸（RSS/heapUsed 直接量纲）与本条互不替代；**两指标采样点区分（v2.4——第九轮 P2）：`yjs_doc_bytes` 第三校准点=shrink 应用删除后的活文档再编码（§4.1④），`yjs_doc_heap_amplification`=装载/卸载前后 heapUsed 差——时机相邻但量纲不同（编码字节 vs 堆差），禁合并实现**；store 时长/compact 时长+删除行数/load 时长/withDoc 次数耗时直方图；tombstone（compact 时 delete set 字节）。
- ④HTTP RED 四件套+在飞 gauge+x-request-id 中间件（uuid+响应头）——**correlationId 落 GenerationIntent**（"钱去哪了"不再靠字符串前缀 join）。
- ⑤/api/health 增 collab degraded 块（ready service 数据复用）。
- ⑥巡检脚本 `scripts/check-collab-health.mjs`：ready+metrics+**资金不变量**（intent_frozen_stranded_total/intent_reconcile_mismatch_total 增量/ai_artifact_discarded{cause}）+heap 闸持续拒绝 P0+not-serving 持续>1min（Y0a 承接）+**滞留 doc gauge/认证重放计数（v2.1）**；P0 阈值表+exit code；runbook §6 衔接。**调度者（v2.1 补；v2.2 增投递面——第七轮 §4.2）**：服务器 crontab 5min 一次+输出追加日志；**P0 级命中经 `ALERT_SMS_TO` 发一条短信**（复用既有腾讯云 SMS 依赖 apps/api/package.json——"只写日志"=没人看的告警；不建监控栈，Y0a 既定路线内的最小真实投递）；资金不变量块=**开放真实支付的前置条件之一**（§9.13）。

**5.9 E57 降级矩阵+PG 熔断（A5 范围修正）**

- 矩阵文档（行=PG/Redis/MinIO/AI provider×失败模式，列=读/写画布/执行/上传/公开页/资金，格=行为+文案+指标+告警级）。**shrink/导出端点进矩阵（v2.4——第九轮 P2：超配额态唯一自救通道，PG 降级时 shrink 不可用⇒用户只剩导出——矩阵单列一格+runbook 标注可用性等级高于普通写路径）。**
- **PG 熔断范围=新装载/新会话准入**（WS 写不碰 PG——内存+spool；防的是"每条新装载等满超时"）；**不裹 lease 心跳**（租约抖动→误自隔离）、**不拒 append**（失败走 spool 既有契约——拒=数据丢失）；失败分类（连接/超时类才计数，P2002 业务错不计）+半开探测（一次成功关闭）+`collab_pg_breaker{state}` 三态。
- 验收：故障注入逐格（int 核心：PG 停/Redis 停/MinIO 停/外呼超时——Y0a-2 DB 触发器基座复用）。

**5.10 资金链冒烟（Y0a-4 移交，A14 收窄）**

- deploy post 段：`exec-smoke`（**收窄为资金链面**——creditCost:0 正例+未知模型 fail-closed 负例+plan/台账/状态机断言，**不触外呼**（fake-AI 子进程注入无效——api-caller 构造读 env）；真外呼冒烟归重构工程验收）；哨兵数据自建+标记+清理（collab-smoke 同族）；--skip-exec-smoke 显式档。

**5.11 子批出口**

- 终态分档用例（四档+**SCHEMA_OUTDATED 第五档（v2.1）**+SERVER_OVERLOADED 瞬态——含"误入终态"反向断言）；映射表单源（**(code,reason) 双键（v2.1）**：4401 双 reason 分型用例）+**全瞬态档退避表用例（drain 期重连次数收敛）**+组件零字面量扫描锚；write-frozen 演练 e2e 绿（**含重连后权威快照重放**）；503/422 语义化+apiFetch **retryAfter** 用例（收窄后）；死线分型（瞬态档延长+抑制重载）用例；reload 守卫+导出+unsynced_close；遥测验收锚绿；C6 epoch 防回归锚（现状绿）；新指标全可见+双指标拆分读者改造（**无 projectId 标签断言**）+**倍率指标可见+红线"合成值"标注**；巡检脚本 exit code 语义+资金不变量+**crontab 调度落位**；矩阵文档+熔断范围用例（不裹心跳/不拒 append）；exec-smoke 进链。

---

## 4. 出口判据+回滚动作+冻结契约

### 4.1 出口判据（§0 六条展开；每子批独立出口=用户确认点——分项见各子批尾节）

| # | 判据 | 载体 |
|---|------|------|
| G-1 | **资金三处相等（请求内同源；v2.2 扩四侧+混合组——第七轮 P1-e）**：validation.totalCost（**含 text 链——textInput continue 修复后**）≡Σintent.creditCost（plan 快照）≡resolver 聚合≡Σsettle 流水——同一请求内四读比对+**text+image+video 混合组用例（现实现 validation 侧必红——totalCost 恒少算 text）**；无规则/未知模型=业务错误+零外呼+零冻结 | vitest+int |
| G-2 | **台账对账三查（v2.2 权威形态=§1.4bis 三不变量）**：①`per (teamId,creditType): Σ balanceDelta ≡ 池余额`（清账后从零成立）②`per intent: Σ frozenDelta ≡ reservedCredits`（终态恒 0——**两列真值表锚：settle frozenDelta=−X，一维表实现必红**）③`per intent 终态: Σ balanceDelta ∈ {0, −creditsConsumed}`（F2 直接检测器）；balanceAfter 链按 **(teamId,creditType) 分区+seq 排序**（全序链在双池交错下必断）；终态∧reservedCredits>0 行数=0；跨团队同 intentId 隔离（一侧结算另一侧零变化）；**reversesId 1:1 @unique+settle_once DB 拒绝用例**（~~release_once~~ v2.2 删——冗余）；**CreditLedgerService 扫描锚+FOR UPDATE 单源锚**；**解散清算门**（在飞冻结 409/终态后 snapshot 对账完整） | vitest+int+巡检 |
| G-3 | 准入：鉴权拒绝七档逐一计数（+server-overloaded/schema-outdated 第八九档）；awareness 伪造锚（两端快照=服务端值+**降级 role 改写**）；缺 csv 拒连+**拒连后 N 秒内升级次数==0（联合锚）+拒绝期 DB 查询次数==0（refusalCache 锚）**；**认证重放三防线（v2.2 输出级锚：prisma 计数不随 N 增长/在飞峰值≤INFLIGHT_MAX/超限 socket ≤61s 消失）**；heap 闸四用例（含已加载 doc 重连不拒+释放路径 reaper **前置谓词**）；cookie-only 后 `?token=` census 清零；**SCHEMA_OUTDATED reason 客户端可达锚**；**Origin 拒绝握手失败锚（socket 403+destroy）**；**awareness 归属锚（伪造他人 clientId 不覆盖对端）** | vitest+collab-core |
| G-4 | 配额三层：前置拒（无本地写入）/apply 前拒绝（帧不物化）/巨帧 DoS 拒+不可达性断言；三级阶梯+水位+自救；装载单行硬拒绝 | vitest+collab-core |
| G-5 | **锁定项**：write-frozen 演练（drain→横幅+停写→1012→恢复）；503 语义化；四档终端 UX；schema 拒连后重连 0 次 | e2e+vitest |
| G-6 | 观测：遥测验收锚；PG 熔断（范围限定+不裹心跳+不拒 append）；资金链冒烟进 deploy 链；巡检 exit code | vitest+int+deploy |

### 4.2 回滚动作（revert 提交制；开发期=git revert+prisma migrate reset，不写 down 迁移）

| 变更 | 回滚 |
|------|------|
| schema（intent 列/台账列+索引+CHECK/release 枚举/定价索引） | revert+migrate reset（release 枚举值留库无害） |
| cookie-only/sweep/绑定默认值/版本门/awareness/配额/heap 闸 | revert（前后端同仓同批；sweep 另有 env 逃生阀） |
| 遥测/指标/矩阵/巡检 | revert（纯增量） |
| deploy exec-smoke | revert 或 --skip-exec-smoke |

### 4.3 冻结契约（本批后不得绕过；19 条——v2 12 条+v2.1 修订+13/14+v2.2 的 15-19）

1. 定价唯一解析器=pricing-resolver；模型身份单源=AIModel(active)；任何直接 findFirst PricingRule/以 MODEL_CONFIG 判存在性/**以编译期常量定扣费额（CREDIT_COST_PER_EDIT 形态）**的新代码=违规（双扫描锚——**域含图像编辑 4 kind**）。
2. 资金计费输入唯一来源=intent 行快照（creditCost/pricingRuleId）；settle/void/refund/对账资金分支禁 readCanvas（扫描锚）；**pre-call 存在性断言与固化同源（allNodes 同一次读）**。
3. `?? 0` 禁令：无规则=PRICING_RULE_MISSING；唯一免费=显式 creditCost:0 行。
4. 台账：referenceId 只用 intentRowId（**禁客户端可控值进台账锚点**）；查询必带 teamId（解散置空行按 teamIdSnapshot 进对账全量）；**两列真值表（v2.2 权威——§1.4bis 表）**：reserve(−X,+X)/settle(**0,−X**——冻结核销)/release(+X,−X)/refund(+X,0)/账户域(±X,0)/consumption 遗留禁删；**delta 单源=CreditLedgerService 按状态迁移计算（禁 type→常量查表；`TeamCreditTransaction.create|createMany` 生产代码仅允许出现在该服务）**；**并发纪律=FOR UPDATE 单式（version 降审计计数器；禁乐观重试）**；三条不变量按 **(teamId,creditType) 分区**（非全序）；reversesId 1:1（@unique）；settle_once DB 兜底。
5. onAuthenticate 拒绝必计数（deny 与 collab_auth_reject_total 同点）；**认证尝试桶超限拒绝计入 `collab_auth_attempt_blocked_total{reason}`（v2.3 改名——"replay_kill"名不符实：断连由库 30-60s 超时完成非我们 kill）**。
6. awareness user 字段唯一写者=服务端（beforeHandleAwareness）；onAwarenessUpdate 仅观测；**权限降级同步改写该连接 state 的 role**。
7. 版本门缺参即拒（唯一硬拒档）；禁加"缺参放行"分支；区间协商=多版本支持变体，同禁。
8. 客户端"拒该次写入"唯一点=写前校验（不产生本地写入；信息源=serverWatermark+本地 O(1) 累加预估，水位到达校准）；服务端超配额=apply 前拒绝（throw{code:4404}）或断连终态——禁静默丢帧；**瘦身走 REST 端点（写后<预算校验），WS 侧禁开例外帧通道**。
9. 终态/close code/reason 映射表单源=shared（含库码全集）；**键=(code,reason) 二元组**（同 code 异 reason 必分型——4401 族实证）；组件禁字面量比较（扫描锚）。
10. 库选项显式 pin（maxPayload/forceSyncInterval）——**pin 生效证据=行为断言（>16MiB 帧→1009）+serverOptions 键集边界（禁塞 noServer/handleProtocols）**，读回配置恒真不作证据（v2.1）。
11. 遥测白名单≤12+无 PII+type 服务端枚举；新增事件先扩白名单（tsc 封闭）。
12. **持久化契约（当前态+失效条件）**：当前 PG=唯一持久层/客户端无本地持久化/未同步编辑仅存活本页会话，write-frozen/4404/V15 文案不得承诺跨刷新恢复；**失效条件=Y5 local-first 落地之日**（届时文案与导出通道重审）；**交付判定禁以 resultRef 为准（用 deliveredAt）**；heap 闸仅拒新物化永不驱逐活跃存量（零连接 reaper 释放≠驱逐）；writeFrozen⇒canExecute=false。
13. **exec 投影单写者=服务端；GenerationIntent=执行态唯一权威**——客户端禁以 HTTP 响应体或本地 nodeProcessMap 判完成（进度经 doc 投影+intents 端点；Y0b-2 部分成功/重放补投影的实现依据）。
14. **生命周期资金门**：解散团队/删除项目前置清算（存在 RUNNING∧reservedCredits>0 ⇒ 409）——禁绕过门直改 DB；GenerationIntent.teamId 无 FK 纯列（禁加级联语义）。
15. **升级拒绝语义（v2.2）**：Origin/限流类升级拒绝必须走"对 socket 写 HTTP 响应+destroy"——**禁依赖 hook throw**（库层 throw=async 监听器内未处理 rejection，不拒不回帧，esm:1623-1636 实证）。
16. **refusalCache 纪律（v2.2；v2.3 白名单精确）**：只收**四类状态源可达瞬态**（draining/lease-not-ready/db-unavailable/server-overloaded）；**信号量溢出/桶超限拒绝不入缓存**；terminal 不入；TTL 15s 绝对过期**不续期**；状态源变更（drain 解除/租约 rejoin/spool 恢复/PG 熔断半开成功/heap 闸释放）**主动清空**（钩子覆盖锚：缺一即缓存失效测试红）。
17. **pre-auth 控制落点（v2.2）**：认证前阶段的限流/短路一律落在 `onAuthenticate` 可达面且**先于任何 DB 访问**——禁依赖 Connection 级钩子（beforeHandleMessage 对 Auth 帧结构性不可达——Auth 旁路 esm:888-902）；断连靠库 30s 超时（P4），不自建 pre-auth kill。
18. **doc 卸载前置（v2.2；v2.4 保活口径改写）**：任何卸载（库自发或 reaper）前置=`零连接 ∧ 队列空 ∧ 无在飞 store ∧ spool 无未确认帧`；空闲会话存活靠 **stateless ping 15s+pong（pong=ping 前置、双向时钟）**——forceSyncInterval=60s 仅补传兜底非保活；**禁调大 COLLAB_TIMEOUT 换取**（放大认证重放窗）。
19. **writeExecStatus 归属澄清（v2.2）**：本批只做 writeNodeData 返回 `{written}`+ai-download worker 存在性；writeExecStatus 复活分支修复留 Y0c（E2 服务端半既定）——两处措辞统一禁互踢。
20. **资金写全局锁序（v2.4）**：`TeamBalance → GenerationIntent →（TeamCreditTransaction/TeamMember）` 全仓唯一序——CreditLedgerService.mutate / intent-reconcile 两事务 / 迁移 LOCK TABLE 三处同序；账户域写点无 intent 行可锁=TeamBalance 先行是唯一可行全序；禁新增逆序资金事务（int 锚=并发 reserve×unfreeze×refund 零 40P01）。
21. **未 await 钩子自兜底（v2.4——P14）**：库回调钩子（onStateless/onUpgrade/beforeBroadcastStateless 面）一律**全函数化绝不 rethrow**（payload 客户端可控原始串——JSON.parse 自裹）；全局 `process.on('unhandledRejection')` 兜底只记不退；红锚"真连发非法 stateless payload→进程存活+计数"常驻。

---

## 5. RPO/RTO+观测面+CI 载体

### 5.1 RPO/RTO（E18）

| 维度 | 影响 |
|------|------|
| RPO | 无恶化（不动持久化链）；plan 固化与 claim 同事务；客户端写前校验拒绝不产生本地写入。**数字化口径（v2.1 补——Y0a 三腿契约延续）**：正常腿 ≤maxDebounce 3s；**SIGKILL 最坏 ≈8s 编辑**（debounce 2000/maxDebounce 3000（gateway:29-34/:194-195）+append 事务 timeout 5000（canvas-doc-update.repository.ts:58）在飞窗）——spool 只覆盖故障腿不覆盖 3s 内存队列；**编辑中 kill -9 演练进门槛**（复用 CI 既有 7 次演练基座 ci.yml:185-193，断言重启后 ≤8s 编辑可恢复） |
| RTO | 改善：heap 闸把"OOM 全站重启（含 15min 资金悬空+执行中断）"换"新画布暂拒（零悬空）"；PG 熔断把故障期新装载超时等待变快速失败 |
| 新增面 | 版本门缺参拒连：同批部署窗口=0（单仓单批）；旧 bundle 会话部署瞬间进终态拒绝——fail-closed 语义登记非风险 |

### 5.2 观测面（新增总表）

**资金族**：execution_settle_failure_total / ai_artifact_discarded_total{cause}（D1 平台沉没成本计量）/ intent_frozen_stranded_total / intent_deadline_exceeded_total / intent_reconcile_mismatch_total（复用）。
**准入族**：collab_auth_reject_total{reason}（含 server-overloaded/schema-outdated）/ collab_upgrade_rejected_total{reason=origin|rate-limited} / **collab_auth_attempt_total+collab_auth_attempt_blocked_total{reason}（认证尝试桶——v2.3 改名后单名）+collab_stateless_ping_total/bad_payload_total/unknown_total（v2.4 保活与 P14 兜底观测）** / collab_sweep_check_total{layer} / collab_sweep_close_total{cause:+role-downgraded} / collab_version_negotiation_reject_total{reason} / **collab_load_rejected_total{reason=server-overloaded}+collab_overload_state{state}** / **collab_doc_store_failed_total+yjs_doc_stuck_total（v2.1 释放路径观测）**。
**配额/awareness 族**：yjs_inbound_frame_bytes / collab_quota_*（软硬阈命中/4404） / yjs_doc_bytes+yjs_doc_bytes_over_threshold_total+yjs_store_payload_bytes / **yjs_loaded_doc_bytes（告警·合成值待倍率标定——§5.8③ v2.1 已降红线；双条件 loadedDocs>40 维持）+yjs_doc_reaped_total+yjs_doc_stuck_total** / awareness_states/awareness_bytes/collab_awareness_dropped_total/collab_slow_consumer_disconnect_total/yjs_outbound_backlog_bytes / 消息速率闸计数+字节速率闸计数（COLLAB_BYTES_RATE_PER_CONN 维度分列，v2.4）/ **collab_idle_timeout_total**。
**观测收口族**：store/compact/load/withDoc 直方图+compact 删除行数+tombstone 字节 / HTTP RED+在飞 gauge+x-request-id / /api/health collab degraded。
**遥测族**：collab_telemetry_events_total{type≤12}（含 unsynced_close）。
**删除**：yjs_sv_wait_timeout_total / yjsCanvasDocBytes（双指标替代+读者同批改）。

### 5.3 CI 载体

collab-core（required）纳入本批 int/锚/演练；pnpm verify 纳入新扫描锚（冻结契约 1/2/5/6/9）；e2e-collab 维持 dispatch-only（write-frozen 演练进 gate-collab 本地面）；deploy 链+exec-smoke。

---

## 6. 门禁载体声明表（纪律 5/7）

### 6.1 真红门（对旧实现可先红——红相留档）

| 门 | 载体 | 阻塞 | 变红证据 |
|----|------|------|----------|
| 同键定价规则 DB 拒绝 | int+verify-indexes | 是 | 现状直插第二条同键行成功（红）→NULLS NOT DISTINCT 后拒绝（绿）；admin batchCreate 重复调用持续插行（红）→findFirst 化后幂等（绿） |
| 跨团队台账串账 | int | 是 | 同 intentId 两团队 reserve→一侧 settle→另一侧多出 settle 行/余额变动（红）→intentRowId 锚+teamId 过滤后零变化（绿） |
| 混合符号二次退款 | int | 是 | void_ 冲销行+行仍 RUNNING→unfreeze 把 +10 行再退一遍（红）→amount<0+reversesId 后不可能（绿） |
| 无规则/未知模型零外呼 | vitest | 是 | 现实现 cost=0 外呼+mock 产物计费（红相三档留档：有规则付费 mock/无规则免费 mock/unknown type）→业务错误零外呼零冻结（绿） |
| F4 产物门序 | vitest | 是 | text/image VOIDED 意图仍 push 产物（红）→gated 后 push（绿） |
| F7 清理吞冻结 | vitest | 是 | settle 失败悬留行第 7 天被删（红）→守卫后保留+stranded 计数（绿） |
| 组执行幂等键 | int | 是 | 同组重试（新 intentId）SUCCEEDED 节点重复执行重复扣费（红——claim 分支⑤入口代码实证）→runId 派生后幂等重放零扣费（绿） |
| deadline 双向 | vitest | 是 | 挂起+心跳持续+超 deadline 仍不退款（红）→reaper 强制收敛（绿） |
| awareness 覆写 | collab-core 双端 | 是 | 伪造 user→对端快照含伪造值（红）→剥离+注入后=服务端值（绿） |
| 版本门三档+联合锚 | collab-core | 是 | 无 csv 连接成功（红）→拒+计数+拒连后升级 0 次（绿） |
| heap 闸四用例 | vitest | 是 | ①压力拒+瞬态②**同压力已加载 doc 重连被拒=红相**③谓词抛错全站拒连=红相→fail-open 放行（绿）④**store 失败+零连接 doc 永驻=闸门触发后永久拒新物化（红——esm:1547 保内存+无人 unload 实证）→5min reaper 释放（绿）** |
| 配额 apply 前拒绝 | collab-core | 是 | 超限帧已 apply 落库后才发现（红）→throw{4404} 帧不物化（绿）；已加载 doc 重连撞墙（红相）→水位通告+readOnly 自救（绿） |
| PG 熔断范围 | int | 是 | 熔断误裹心跳（租约误自隔离=红相）/误拒 append（数据面=红相）→范围限定+不裹不拒（绿） |
| 升级限流 IP 源+认证重放放大 | int+vitest | 是 | 按 socket peer 键控=全站单桶（第 31 个用户被拒=红相）→X-Real-IP+loopback 信任后按真实 IP（绿）；**同 socket 连续 N 次 Auth=现实现每条 4 次 DB 查询无限重放（红——Auth 旁路 esm:888-902 实证，v2.1"桶落 beforeHandleMessage"结构性不可达已作废）→onAuthenticate 顶部桶+refusalCache 零 DB+并发信号量（绿：prisma 计数不随 N 增长+在飞峰值≤上限+超限 socket ≤61s 消失）** |
| 团队解散在飞冻结蒸发 | int | 是 | 在飞 RUNNING∧reservedCredits>0 时解散：流水 teamId 置空+TeamBalance 级联删+intent 孤儿使 reconcile 对 null teamBalance 崩溃循环（红）→清算门 409+snapshot 对账（绿） |
| admin 授予并发撕裂 | int | 是 | admin-subscription upsert(increment) 与流水 create 两语句无事务——注入中途失败=余额与台账撕开（红）→CreditLedgerService.mutate 单事务（绿） |
| rearm 二次退款 | int | 是 | rearm 后 RUNNING∧reservedCredits=0+reserve 行（含正向冲销）→unfreeze CAS 无 reservedCredits 条件再退一遍（红——intent-reconcile:165-167 实证）→CAS 补齐+reversesId 1:1 @unique DB 拒绝（绿；~~release_once~~ v2.3 清扫——已删冗余索引） |
| pre-call 存在性 | vitest | 是 | 请求前已删节点：现实现外呼照发+产物丢弃退款（沉没成本，红相留档）→allNodes 断言零外呼零冻结（绿——D1 窗口收窄实证） |
| stateless 崩溃向量（P14） | collab-core | 是 | hook 落地即引入：直写 throw 版本（或裸 JSON.parse）发一条非法 payload⇒unhandledRejection=进程退出（红——esm:219/:1070-1076+main.ts 零兜底实证）→全函数化+全局兜底后进程存活+bad_payload 计数（绿） |
| 资金写全局锁序 | int | 是 | mutate（TeamBalance 先序）×reconcile unfreeze/refund（现行 GenerationIntent 先序，:165-176/:206-217）并发=40P01 中止其一（红——ABBA 实证）→三处同序（§1.4bis②）后并发 reserve×unfreeze×refund 各 N 轮零 40P01（绿） |
| 清账门控三态 | int（migrate replay） | 是 | 空库 replay：v2.3 极性反骨架直接 RAISE=必炸（红）→静默通过（绿）；注入测试数据→清零；注入 recharge 行→拒绝执行（fail-closed 红相留档） |
| SV 支配准入 | int+vitest | 是 | 改 prompt 立即 execute：现实现按服务端旧视图照常外呼扣费（红相留档）→SYNC_PENDING 零外呼零冻结零 intent 行（绿）；带客户端 SV 且被支配→放行；自动重试一次同 runId 成功；改上游→执行下游→SYNC_PENDING（SV 天然覆盖） |
| runId 成功后再执行 | int | 是 | SUCCEEDED 后同参数再点：v2.3"成功保留 key"规则命中幂等重放静默无效（红——无新外呼无新产物）→新 runId 新外呼新扣费（绿——与"同 runId 重试零重复扣费"成对） |

### 6.2 结构不变量锚（对"破坏后的代码"红，如实声明）

| 锚 | 载体 | 变红方式 |
|----|------|----------|
| 定价/模型 findFirst 唯一入口双扫描 | verify | resolver/MODEL_CONFIG 判存在性新增→红 |
| 资金分支零 readCanvas+台账查询必带 teamId | verify（静态） | 新增 readCanvas/缺 teamId 条件→红 |
| 台账写侧 guard（分域白名单+reversesId） | vitest | 白名单外 type/reversesId 缺失→红 |
| settle 唯一索引+CHECK+reversesId @unique | int | 第二条 settle/负余额/同 reversesId 第二条 release 或 refund→DB 拒（证明约束存在）。**资金门载体点名（v2.3——纪律 7）**：`credit-ledger.int.spec.ts`（CreditLedgerService 并发撕裂/FOR UPDATE）+`ledger-invariants.int.spec.ts`（三不变量/settle_once/reversesId/两列真值表）+`team-lifecycle-funds.int.spec.ts`（解散清算门/快照对账）——check-int-coverage MIN_TOTAL 与集合断言同步（plan 首项） |
| **CreditLedgerService 唯一写入口（v2.1）** | verify（静态扫描） | 生产代码新增 `TeamCreditTransaction.create\|createMany` 于服务外→红 |
| **maxPayload 行为断言（v2.1）** | collab-core | 发 >16MiB 帧未以 1009 关闭→红（读回配置恒真不作证据） |
| **服务器键集边界** | vitest | serverOptions 出现 maxPayload 以外键（noServer/handleProtocols）→红 |
| close code/reason 映射单源 | verify（web 扫描） | 组件新增字面量比较→红 |
| 库选项 pin（maxPayload 未被覆盖/forceSyncInterval） | 启动断言+锚用例 | 移除配置/crossws 覆盖→红 |
| 库行为锚 P2/P3/P7/P8/P9/P10/P11 | collab-core 锚族（Y0a 族扩七条） | 升级改语义→锚红（pin 变更强制重跑） |
| beforeunload 谓词/组件禁读 execute results | vitest | 谓词失效/组件读 results→红 |
| check-ecosystem 三数字链 | check-ecosystem | 断言链 `baseline×4 < release < trip < max_memory_restart−200MiB` 任一破坏→红（v2.4 与 §3.2/§7.1 同步——旧 (896,1024) 开区间与 trip=750 空交集，照旧锚实施必红；"896=old-space+384"系 ecosystem 文件注释的杀线算式历史口径，不作本批闸门判据） |
| access_log off | 部署前置门 | nginx -T 无该指令→红 |
| spec 一致性门禁（Y0b-0 件） | pnpm verify | 退役短语 denylist 命中（release_once/TTL 5min/五 kind/seq 全序/COLLAB_RSS_SOFT_LIMIT_BYTES/forceSyncInterval<COLLAB_TIMEOUT/replay_kill/新鲜度断言）或 spec fenced 规范块与 code（env.ts/metrics/shared 常量）不符→红（§9.22） |

---

## 7. 运行面三件套+同步预算+库选项 pin

### 7.1 三件套（纪律 8）

进程定义不变（ecosystem 不动）；内存上限不变（heap 闸是运行时自保非进程档位——check-ecosystem 断言链新增）；关停时长不变（Y0a 45s 维持）。
新增 env（全部进 zod；v2.2 更新——RSS 改字节制+认证防线三项+pre-auth 三 pin）：COLLAB_ALLOWED_ORIGINS / COLLAB_CONN_MAX_LIFETIME_MS（12h）/ COLLAB_MAX_DOC_BYTES（8MB）/ COLLAB_MAX_TX_BYTES（256KB）/ COLLAB_MAX_NODES_PER_TX（2000）/ COLLAB_MSG_RATE_PER_CONN（200/s）/ **COLLAB_BYTES_RATE_PER_CONN（默认 2MB/s——§4.1② 字节速率闸，v2.4 补契约）/ EXEC_MAX_NODES（§2.5 单次执行规模上限——独立于 COLLAB_MAX_NODES_PER_TX 粘贴预算，两个量，v2.4 分列）** / **COLLAB_AUTH_ATTEMPTS_PER_MIN（默认 10——桶落 onAuthenticate 顶部 §3.1bis）/COLLAB_AUTH_INFLIGHT_MAX（默认 8——全局并发信号量）/COLLAB_REFUSAL_CACHE_TTL_MS（默认 15000）** / **COLLAB_RSS_TRIP_BYTES（默认 786432000=750MiB）+COLLAB_RSS_RELEASE_BYTES（默认 629145600=600MiB）——v2.3 按实测基线 138.8MB×倍率+杀线−缓解预算标定（断言链 baseline×4<release<trip<max_memory_restart−200MiB）+COLLAB_HEAP_PRESSURE_RATIO（0.8/0.7——heap 项=heapUsed/heap_size_limit 纯 V8 口径，v2.3 删 arrayBuffers 重复计数）** / COLLAB_TRUSTED_PROXY / COLLAB_FAKE_AI（superRefine 生产拒 '1'）/ COLLAB_SWEEP_ENABLED 默认翻转 'true'；**库选项 pin（v2.2）**：maxUnauthenticatedQueueMessages=256/maxUnauthenticatedQueueSize=1MB/maxPendingDocuments=100 显式 pin+启动存在性断言（§3.1bis）；**`app.set('trust proxy','loopback')` 一行统一（v2.2——R12：main.ts:87 全代理信任与 COLLAB_TRUSTED_PROXY 两套模型同批并存=自造分歧；一行收口 REST XFF 解析与 WS 同信任前提；E58 完整收口仍归 Y0.5）**。（COLLAB_MAX_LOADED_DOCS 维持 env.ts:43 预留零消费——enforcement 归 Y1c-3。）

### 7.2 同步预算+库选项 pin（纪律 9）

| 项 | 预算/契约 |
|----|----------|
| maxPayload=16MB 显式 pin+启动断言（含 P12 覆盖核验） | 禁回落 ws 默认 100MiB |
| forceSyncInterval=60_000 pin（**v2.3：放长为补传兜底非保活**——空闲保活=stateless ping 15s+pong 见 §5.2；30_000 与 COLLAB_TIMEOUT 同值竞态+每 20s SyncStep1 全量 SV 编码 CPU 成本，均作废） | E40/§5.2 |
| stateless ping=15_000 常量（客户端；与 provider messageReconnectTimeout 默认 3e4 的 2× 余量——provider:138/:185 实证；pong 同批前置、走 connection.sendStateless 禁 broadcast） | §5.2 保活主通道 |
| 字节累加 | apply/store 路径 update.byteLength O(1) 加法——**禁 encodeStateAsUpdate 进每帧路径**（全量编码只在装载/compact 两个既有事件+**shrink 影子预演（v2.2 白名单第三点——§4.1④，兼作 yjs_doc_bytes 校准）**） |
| awareness 限额 4KB/单客户端；速率闸 200 msg/s env | |
| 遥测批量 ≤30s/≤12 事件×512B；sendBeacon Blob | |
| provider 预算 | submit 30s/轮询 10s AbortSignal；deadlineAt 按 kind（text 90s/image 5min/video 15min） |
| ready 边角探测 | 仅"重连成功但 ready 非 200"单次+节流+抖动（常态零轮询） |
| heap 闸谓词 | memoryUsage+getHeapStatistics 调用（压力期每升级一次 O(1)）；日志采样 |

---

## 8. 实施顺序（每子批出口=用户确认点；门槛分期见 §2.1）

```
Y0b-0 一致性门禁（半天，先于一切子批——v2.4 提前：check-spec-consistency.mjs 进 pnpm verify，§9.22；规范量 fenced 块 spec↔code 单向比对+退役短语 denylist——先把本 spec 自身清干净再动代码：连续三轮每轮修改平均引入 1-2 处跨节漂移，人工清扫已跟不上修改速度）
Y0b-1 资金固化（迁移含清账+resolver+CreditLedgerService+台账锚——资金面地基）
  → Y0b-2 资金运行时（依赖新列）
  ‖（可并行）
Y0b-3 准入与版本（含 heap 闸+防放大三防线+Origin 403+空闲保活——独立于资金面）
  ‖ **同批必含（v2.2 锁死）Y0b-5 锁定项**（terminal 客户端处理+wsAuthNotice 写点+canExecute——版本门与 terminal 处理同一提交上线，禁裸奔）
  → Y0b-4 配额与 awareness（依赖版本门/配额终态形态；判据=投影制+影子预演瘦身）
  → Y0b-5 其余（观测/遥测/矩阵/冒烟）
收尾：v8 目录 Y0b 行回填+D1 落档确认+runbook §4 客户端现状表改写+§6 补 tripped 处置行+重构工程首项两驱动登记
```

## 9. 已知风险与限制登记（诚实清单；v2.4 二十三条——v2.3 二十二条+v2.4 增 §9.23、改 §9.15/§9.16/§9.22）

1. **版本门缺参拒连的部署窗口**：单仓单批部署窗口=0；已打开的旧 bundle 会话在部署瞬间进终态拒绝——fail-closed 语义（非风险，登记）；依赖 access_log off 为纵深（断言锚锁定）。
2. **awareness color 一致性**：服务端注入后客户端配色函数废弃——注入单源保证；部署前旧客户端自报 user 被剥离=显示服务端身份（无可见回归）。
3. **单人零上报判定面**：states.size===1 短路；断线残影最长 30s 误判双人（多上报一次无害）。
4. **PG 熔断边界**：仅 collab 新装载/新会话准入（auth/execution REST 不在面）；误开最长 10s 快速失败窗口（N/T 可调，与 lease unknown 档同族"不误杀"）。
5. **D1 正式落档（v2.1 二次改写——从"接受沉没成本"降为"有界风险"）**：pre-call 存在性断言（§2.4，与固化同源 allNodes 内存判据）落地后，在途窗口收窄至**外呼在飞期间被删**（物理不可约——CRDT 删除无服务端事件；由 complete 前存在性检查+退款+产物丢弃兜底）；**用户资金零损失**（冻结先行/产物丢弃/对账退款+reaper×settle 交错不变量）；**平台沉没成本有界**（`ai_artifact_discarded_total{cause}` 计量——**pre-call 落地后 cause='node-deleted' 期望恒 0（非 0 即 bug，断言工具化）**，残余 'deadline-voided'=外呼在飞窗口的真实计量，D7/Y1c-2a 复核依据）；不采纳客户端视图令牌作门槛（v8-C）；判据纪律：交付判定禁以 resultRef 为准（deliveredAt）。**期望 SV/WS 内执行二选一=降级为重构工程评估项**（非必做——窗口已收窄至外呼在飞，二选一的边际收益缩小；备注 SV 对删除结构性失明维持）。「删除即 abort」（gateway 删除帧→AbortSignal 取消在飞外呼）同登记为重构工程可选项（省外呼沉没成本，事件线+Signal 贯穿成本本批不付）。
6. **E41 自动失效条件（v2.3 补半句——第八轮报告三 §五）**：首个真实用户接入之日**或任何一次对外可访问部署之前**（后者更早更准确——nginx 已在跑端口对外），密钥外置+轮换自动转一级阻断项（无需重新提案；本批维持 E41 三次驳回记录）。
7. **§9.x 同步执行窗（已收窄缺陷，非"已知限制"）**：组执行经同步 HTTP，多节点串行可超代理窗口⇒最终回执丢失。已收窄：资金逐节点正确（plan 固化+claim 互斥/幂等+存在性退款+对账）；付费意图不悬空（onFailed 反查+deadline reaper+客户端以 intents/exec 为完成判据+loading 回收）；进度经 node:status 逐节点实时。残留：HTTP 报错与真实进展短暂不一致+**部署窗口工作量丢失**（kill_timeout 45s<N×上界，SIGKILL 后组内未执行节点无队列接管——资金自愈工作量不可恢复）。归属=执行链重构工程首项，判据=`nginx -T | grep -A8 'location /api'` 实测 proxy_read_timeout vs 180s+`execution_group_duration_seconds{nodeCount}` p99（**观测采集随 Y0b-5 落**，触发线 p99>60s）；第二条实证=NodeBusy 部分推进语义（不本批修）。
8. **配额近似口径**：闸门/gauge 用"装载播种+apply 字节累加"近似（GC 壳不回落=高估方向安全）；真值只在装载/compact 校准——两口径标注差异；Y1c-3 随 D7 复核。
9. **返工面登记**：单键 256KB 闸门与整串覆盖拒绝语义在 Y1c-2a（Y.Text）落地时重切（canApplyIntent 单一 seam 使只改一处）；4410 消费=Y1c-1；heap 闸=有真实用户后与 LRU 同批重估（条件触发项：RSS>800MB 或 loadedDocs>200×3 天）；doc 预算 8MB=D7 前保守默认。
10. **write-frozen 期间编辑不暂存**：canEdit 面被拦输入不暂存不补写（用户重输）；与 Y5 离线"保留可导出"语义分界在用户文案体现。
11. **执行链冒烟覆盖边界**：不触真外呼（fake-AI 子进程注入无效）；真外呼面由 E51 用例+线上验证覆盖。
12. **sweepOrphanExec 限量**：每轮≤10 项目按活跃排序——大库全量 GC 周期变长（接受——装载时自检为 E2 既定方向，Y0c 评估）。
13. **开放真实支付前置（v2.1 新增）**：Y0b 上线≠开放真实支付——前置=Y0.5 PITR/离机备份（账本可恢复性：现仅 cutover 同机 pg_dump 5 份，主机级故障同归于尽）+Y0.5 XFF/trust proxy 收口（main.ts:87 全代理信任+nginx 站级 X-Real-IP 只在 /collab 段=HTTP 付费端点限流可绕过——第六轮 5.1 实证，归 E58 既定）+巡检 crontab 调度落位（§5.8⑥）。三项齐才可开真实付费。
14. **doc 版本 bump 纪律（v2.1 新增——与 §9.6 E41 同族自动失效机制）**：首个真实用户接入之前，必须建立 doc schema 迁移器**或明确声明"bump=清库"**（现行开发期语义=拒载旧档+部署时清库脚本（reset-canvas-schema.mjs 先例）+启动不变量断言（库内无旧版档，违反拒启动））；二者互斥判据上线前定案。零用户期不建迁移器（禁垫片）。
15. **单实例扩容评估线（v2.1 统一数字；v2.4 四线单调声明——第九轮清扫：§3.2 评估线改 600MiB 后本条与 §9.9 未同步形成 600/750/800 三线无序）**：全内存线单调序=**人工评估线 600MiB（§3.2——人先看见）=release 600MiB < trip 750MiB < Y1c-3 实施线 800MiB（§9.9——工程触发非运行闸门，高于 trip 合法：闸门先挡住、实施线=该建 LRU 的信号）< 杀线 1024MiB**；评估触发=RSS>600MiB 持续 15min ∨ loadedDocs>40 ∨ 部署窗口不可接受 → 启动 Y7 评估（多实例=移除租约+所有权注册表，E23/E35/E44 既定）；数值软阈 enforcement 触发线维持 §9.9（RSS>800MB 或 loadedDocs>200×3 天⇒Y1c-3）——线并存各司其职：40 docs=评估线（人看）、200 docs=实施线（自动）。
16. **计费读混合分流（v2.2 改判采纳进本批 §2.1——第六轮"全量快照化"仍驳回）**：~~快照陈旧度=compact 60s 门限~~ **数字勘正**（第七轮 1.5：快照读=CanvasDoc.state+updates 已含全部落库内容，陈旧度=去抖窗 ≤3s/最坏 8s，非 compact 门限）；全量切换仍驳回（活跃编辑者行为变化）；**混合分流采纳**：常驻⇒活读/不常驻（isPersistedComplete 谓词满足）⇒快照读（v2.4 清扫：v2.2 的"新鲜度断言（超窗回退活读）"时间窗判据已被第八轮结构性谓词取代，残留句删）——消 heap 闸压力期"闲置画布执行被 503"耦合+D1 读时机差压到去抖窗。
17. **客户端预估偏差（v2.1；v2.2 已随投影制收敛主偏差）**：前置校验用"水位+本地累加"预估——水位到达后本地又写 200KB 的窗口内预估偏低（放行一个可能被服务端拒的事务）：两层不混（服务端 apply 前拒绝兜底），偏差方向登记（§4.1①）；~~②与①③量纲不一致~~ **已修**（N2 投影制——三环节同变量）。
18. **成员移除的 monthlyUsed 语义（v2.2 登记——第七轮 §4.5）**：teamMember.updateMany（月度回滚）对被移除成员 no-op——资金归属不变（无资金洞），monthlyUsed 计数残留=已知语义（"移除成员不回收当月已用量"）；不修（重算路径成本>收益，月界自动清零）。
19. **heap 闸 tripped 运行处置（v2.2——runbook 衔接条目）**：`collab_overload_state=tripped` 持续 >10min ⇒ 人工 drain+有序重启（主动优于等 pm2 1G OOM——若压力来自谓词覆盖不到的原生内存段，pm2 先杀=12h 会话全断+全量卸载）；随批尾 runbook §6 补一行。
20. **PITR 判据细化（v2.2——§9.13 前置的验收形态，实施归 Y0.5/E47）**：开放真实支付的备份前置=WAL 归档开启+pg_dump 离机（异机/对象存储）+**一次真实恢复演练记录**（时间+数据点+耗时）——三项缺一即"前置"未发生。
21. **墓碑主导文档不可原地瘦身（v2.3 登记——第八轮 P1-4）**：反复"粘贴→删除"使 GC 壳+delete set 占编码主体，shrink 删完仍超预算——**唯一出路=导出到新项目**（in-place vacuum=重写 CRDT 历史=打断在场客户端 SV=等价导出，不做）；硬阈横幅"导出到新项目"与"一键瘦身"同级主按钮；`yDocOptions:{gc:true}` pin（§4.1④）是瘦身语义前提。
22. **spec 一致性机械门禁（v2.3 登记；v2.4 提前至 Y0b-0 第一件+方向修正——第九轮三报告同判：连续三轮每轮修改平均引入 1-2 处跨节漂移，v2.4 自身清扫 17 处含两处规范级自相矛盾（§6.2 旧区间会强制错值/契约 18 教已失效机制）——人工清扫已跟不上修改速度；方向=**spec↔code 单向**：env 名+默认值/阈值带/指标名/close code 表/契约编号从 code（env.ts/metrics 模块/shared 常量）导出，断言 spec 内单一 fenced 规范块与之逐项相等；正文只跑**退役短语 denylist**（release_once/TTL 5min/五 kind/seq 全序/COLLAB_RSS_SOFT_LIMIT_BYTES/forceSyncInterval<COLLAB_TIMEOUT/replay_kill/新鲜度断言…命中即红）——**禁正文扫数字**（行号/"第 11 次"/"30-60s" 误报多了门禁就会被 disable，本仓有先例））**：`scripts/check-spec-consistency.mjs` 进 pnpm verify（§8 Y0b-0）；先例=doc-gate.mjs/check-ecosystem.mjs/verify-indexes.mjs 同族。
23. **SV 支配准入的删除盲区（v2.4 随 §2.6 判据改判登记）**：准入门 `svDominates(clientSV, serverSV)` 对"本地删除未同步"失明（删除不推进时钟——§2.2 移交表既有实验）——该窗口服务端按其权威视图计费外呼=工作真实发生（非错账），语义归 D1 既定接受域（§9.5"外呼在飞期间被删"同族），且"删除上游后立即执行下游"的用户意图本就歧义；不修（修法=内容级哈希回显，已被 §2.6 v2.4 以"双侧耦合脆断"否决）；上游**新增/编辑**未同步均被 SV 覆盖（时钟推进）。

---

## 10. 机械规范块（Y0b-0——check-spec-consistency 比对源；code 为源，块随 code 同 commit 变更）

<!-- y0b0:env-keys -->
```yaml
- COLLAB_ADMIN_TOKEN
- COLLAB_BIND_ADDR
- COLLAB_DEBOUNCE
- COLLAB_LEASE_HEARTBEAT_MS
- COLLAB_LEASE_TTL_MS
- COLLAB_MAX_LOADED_DOCS
- COLLAB_PORT
- COLLAB_SPOOL_CAPACITY_BYTES
- COLLAB_SPOOL_DIR
- COLLAB_SWEEP_ENABLED
- COLLAB_TIMEOUT
- COMPACT_INTERVAL_MS
- CORS_ORIGIN
- DATABASE_URL
- MINIO_ACCESS_KEY
- MINIO_BUCKET
- MINIO_ENDPOINT
- MINIO_SECRET_KEY
- MINIO_USE_SSL
- PORT
- PROMETHEUS_TOKEN
- REDIS_URL
- SENTRY_DSN
- WECHAT_APP_ID
- WECHAT_APP_SECRET
- WECHAT_LOGIN_REDIRECT_URI
- WECHAT_PAY_API_V3_KEY
- WECHAT_PAY_APP_ID
- WECHAT_PAY_MCH_ID
- WECHAT_PAY_MERCHANT_CERT
- WECHAT_PAY_MERCHANT_SERIAL_NO
- WECHAT_PAY_NOTIFY_URL
- WECHAT_PAY_PRIVATE_KEY
- WECHAT_PAY_PUBLIC_KEY
- WECHAT_PAY_PUBLIC_KEY_ID
```

<!-- y0b0:metric-names -->
```yaml
- collab_lease_denied_total
- collab_lease_epoch
- collab_lease_lost_total
- collab_lease_row_missing_total
- collab_start_failure_total
- collab_sweep_close_total
- execution_settle_failure_total
- intent_duplicate_attempt_total
- intent_frozen_orphan_total
- intent_frozen_stranded_total
- intent_reconcile_mismatch_total
- ledger_balance_drift_total
- ledger_frozen_drift_total
- ledger_orphan_unreleasable_total
- yjs_canvas_doc_bytes
- yjs_compact_abandoned_total
- yjs_compact_not_owner_total
- yjs_connection_count
- yjs_deleted_projects
- yjs_hydration_huge_row_total
- yjs_loaded_documents
- yjs_pending_batches
- yjs_pending_projects
- yjs_snapshot_read_total
- yjs_spool_capacity_total
- yjs_spool_depth_bytes
- yjs_spool_depth_files
- yjs_spool_quarantined_total
- yjs_spool_truncated_total
- yjs_spool_write_failures_total
- yjs_store_append_failure_total
- yjs_store_compact_failure_total
- yjs_store_drain_total
- yjs_store_hook_calls_total
- yjs_store_in_flight_docs
- yjs_store_tail_anomaly_total
- yjs_sv_wait_timeout_total
- yjs_unload_cleanup_failure_total
- yjs_unload_handoff_failure_total
- yjs_updates_discarded_deleted_total
```

