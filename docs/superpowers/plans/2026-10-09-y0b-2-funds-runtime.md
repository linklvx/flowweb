<!-- doc-status: draft-v2.4 | created_at: 2026-10-09 | note: v2.4=第五轮外审收敛（三报告 ~90 论断一手核验——落点核验：processor 装饰器/queue-options/11 处投影调用点/execution.service:53 铸造值/CreditType enum/init:1092 索引）。**P0 采纳十二项=Z109-Z118+撤销一项+合并一项**：Z109 Z103 接线修正（execution.service:53 `intentId ?? randomUUID()` 实锤——直接接 token 位=每次调用变新手势〔claim②③死代码+每次重试新扣费〕⇒claim 入参拆 gestureToken?〔只收客户端原始〕/intentId〔服务端铸造〕+isFirstExec 三处门随 T1 删+token 整批施加前移 T1+normalizeRegenToken 随 T1 落+T1 红测直调 service）；Z110 **maxStalledCount:0 撤销**（processor:10-12 注释自证"防双跑双扣——扣费幂等由意图表 intentGuard 兜底"——stalled 重排同 jobId⇒claim②续跑⇒alreadyReserved mayCall:false〔Z35 结构门〕⇒静默退出零外呼；改 0 收益≈零代价真实〔lock 过期≠进程死：活 worker 被置 FAILED⇒complete CAS=0⇒平台已付费产物丢弃〕——安全链写成注释+保留 claim ⓪ 合取与并发红测；queue-options=JobsOptions 落点错论断成立但随撤销消解）；Z111 守卫 fail-closed 完整形态（判据两子句：非 number⇒drop+严格更老一律丢不看终态〔否则老代 error(1) 覆盖新代 loading(2)〕+equal∧终态⇒drop；attempts 必填+请求级投影传 0 代+**11 处生产调用点全量补**〔实测零 attempts〕+failed 钩子先查后写〔现 :58 写 :61 查——同 patch 结构做不到〕+census）；Z112 Z106 分治（UX 投影 isDocResident 才写+deferred 计数+重连 alignExecFromIntents 对齐；钱事实探针有界+sweep 限条数+loaded_by_reconciler 计量；errorCode 两码分诊——withDoc 装载+provider 故障批量收敛=故障自放大正撞 E39/heap 闸）；Z113 T8 admin 幂等重构（**全文清剿 skipDuplicates 四处残留**+pg_advisory_xact_lock 收并发窗〔前置查对并发同键无效——两方都 miss⇒后者撞唯一 500〕+指纹比对 409+replayed:true 与 noop 语义分离）；Z114 T1 DDL/datamodel 对账（起草稿删 GenerationIntent_status_completedAt_idx〔init:1092 已存在——Step 6 already exists 硬停〕+Step 2 补删 @@index([status,updatedAt])〔schema:1009〕+**三个性能索引保持 partial**〔partial 零棘轮成本+普通化有计划器弃用风险——第四轮普通化撤销〕——仅 idemKey/idempotencyKey/projectId_nodeId_status_createdAt 进 datamodel）；Z115 棘轮脚本化（check-migrate-diff.mjs 照抄 check-pricing-coverage 范式进 verify+--update+归一化共用——v2.3 的 diff <(sort) 集合相等+行文本不匹配永红）；Z116 checker 混合制（生产位置制+测试文件能力制〔窗口含通行证放行〕——wipeForTests 移出生产服务消垫片+deleteMany 幂等〔P2025 会把 afterAll 异常算文件失败〕+checker 改动带 test+夹具清单补 credit-ledger:104/generation-intent:139 两处 teamBalance 直删）；Z117 env/谓词写边界（admin activate/toggle/写 apiKey 用 ready+MODEL_NOT_READY 4xx〔启动断言只是快照——运行期可造 executable∧!ready 行实测〕+EXEC_MAX_NODES 移 T8〔键随读者同批防死键红〕+EXEC_DEFAULTS 常量表单源+读点字面量〔方向②只认字面量实测〕+check-nginx-budget.mjs 进根 verify）；Z118 杂项（creditType 'regular'〔enum 无 credits——v2.3 笔误 TS2345〕+catch 掩码收窄+自锁表述修正〔intentRecord 有 rotate 逃生门〕+lastSubmitRef 刷新丢失=T6 显式动机+pathspec 一行修根级〔修门禁非绕〕+hasDb skip 约定+getBalanceView bounds 可选参+Z102 反向锚+video-project 进程内直调表述+Σ 与 SV 门共用 doc 读+基线快照过期行）。**证伪四处**：报告三"12 处"（实测生产 11）/报告二"queue-options 不存在"（存在但落点错结论仍立）/y0b1 frozen partial 形态存疑（Step 0 核对）/报告一 P1-3 自我修正成立（v2.3 普通化撤销）。v2.3=第四轮外审收敛（三报告 ~100 论断一手核验+master 原地实测 migrate diff）。**P0 十二项全采=Z97-Z108**：Z97 ledgerWipe 进唯一写入口（wipeForTests——test-utils 命中规则①实测）+checker 规则②补 createMany\|deleteMany+deleteTeamsWithPass 六文件十二处+catch 掩码二十一处删；Z98 ArtifactProbe 端口反转（readCanvas 禁入 intent-reconcile——规则⑤三文件清单实测；探针事务外）；Z99 投影守卫代次化（终态∧attempts 比较——error(attempt1) 后 rearm 的 loading/done(attempt2) 被 :126-128 守卫整体吞掉实测=Z95 核心承诺失效）+NodeBusy 投影 skipped+ExecStatusEntry 三字段+web 白名单加 skipped；Z100 mutate 前置查替代 skipDuplicates（lockBalance 后 findFirst——skipDuplicates 吞唯一冲突=钱包已变流水缺失击穿不变量①实测 ：91-95 顺序）+reversesId/money_in_once 抛错 backstop 保留；Z101 selectable 拆 executable（目录属性——选择器/预检）/ready（运维就绪——只进启动断言）——apiKey 从用户面谓词消失+fakeAiEnabled 消失（CI 零密钥 executable 仍可选+运行中进程缺键结构性不可达）；Z102 rollbackStranded 第三入口（CAS SUCCEEDED∧reservedCredits>0+判龄+事务内活读复核——settleStranded 唯一；三分支表 SUCCEEDED∧产物⇒补 settle/SUCCEEDED∧无产物⇒rollbackStranded/FAILED\|VOIDED⇒void_〔现状 ：317 else 保留〕）+第四不变量；Z103 T1 就接 regenToken（input.intentId 接 token 位+intentId 纯服务端铸造——消解 T1→T6 静默回放窗口+同 id 异内容 NodeBusy 自锁链 :118-126/:135 实测+服务端 mint 陷阱）；Z104 claim ⓪ jobId 合取固化（null 永不等于 null——:90 合取项实测）+queue-options maxStalledCount:0+并发红测进 T1；Z105 停滞判据只计异常（lastGoodResponseAt 时间计数——"非终态计数"会在 ~100s 杀一切长任务=Z90 批判过的回归）+PROVIDER_TASK_LOST（404 立即终态）+负向红测；Z106 reaper 终态投影（intent-reconcile 零 writeExecStatus+CollabDocumentService 已注入 :61 实测——Z65 被 worker 侧六路径证伪）；Z107 migrate diff 棘轮（**master 实测输出恰 2 行**——唯一 DROP=pricing_rule_natural_key〔普通唯一索引但 NULLS NOT DISTINCT 语义 Prisma 不可表达〕；partial/CHECK 在 diff 词汇外不产出行=报告三金标 9+2 行论据证伪；allowlist 金标一行+可表达优先：idemKey 派生名/idempotencyKey 去 partial/新性能索引普通化+两个新复合索引）；Z108 spec §10 同 commit+指标 8 增 1 删（snapshot_fallback_total 定义 store.metrics.ts）+Y0b spec=canonical 文档 doc-gate --write-canonical 同 commit。**证伪四处**：报告三 P0-1 机制论据（结论对金标仅 1 行）/报告二 P1-8 doc-gate 必红（collab-delete-persist-fix.md 非 canonical 仅警告）/报告三 CI 必红（int 零 .init() 实测——FAKE_AI=1 兜底采纳）/报告二夹具 7 文件（实测 4 文件 19 处）。P1/P2 二十项：HARD_CAP 启动断言锁相对关系/nginx=HARD_CAP+60s+静态单测/冻结腿谓词 reservedCredits>0/夹具配方完整链（ensureBalance 建 0 额钱包——register_grant 灌额）+referenceId 后缀化/跨月回填 GUC 唯一/int 九文件/admin-idempotency.int 定名/zod 内联移出棘轮桶/env 单源锚扩前缀/SV 门 stateVector 必填+retake 豁免/CASE ELSE provider/EXEC_SCOPE_TOO_LARGE 改名/writeNodeData {written,reason} 类型化/x-intent-id 删/多节点 token 整批/单实例注释/测试②判别性/amount 符号锚/LRU 登记/y0b2-squash.mjs 不采纳（本机 bash+psql 实测可用）。v2.2=第三轮外审收敛（三报告 ~70 论断一手核验+用户三裁定子报告收敛）。**P0 六项全采**：Z89 ledger.tx 十四处普查+删 tx()+FK 级联通行证（T1 触发器落地当天会打断注册建团队/充值/订阅发放/admin 授予/团队解散五条链路——单测 mock ledger 全绿假象）；Z90 Σdeadline 55s 门撤销（量纲错误：超时上界非期望耗时，text 90s 单节点即超=默认配置拒绝一切）+EXEC_SYNC_HARD_CAP 病态批硬闸（1800s=lighting 最坏值）+停滞检测（接管老轮询次数上限的停滞出口）+nginx /api 墙钟钉仓（api-location.replace.conf 1200s 推导式入库——整条同步链唯一墙钟）；Z91 enqueue 链 regenToken 三处管道（五面板全走 enqueue，token 断管=重新生成静默回放）；Z92 rollback 双入口拆分（rollbackRunning/rollbackDeliveryFailed——reaper×complete 竞态"退款后仍交付"结构性关闭）；Z93 启动断言 fail-closed（NODE_ENV 从不为 production 实证=永不触发；两类密钥源=AIModel 行∪adapter kind 级 seedEnv；CI 零密钥实证=fixture 行自建）；Z94 claim ⓪ RUNNING 闸前移（回放分支绕节点互斥=画布倒退闪回）；Z95 error 保留 token（轮换=done|exhausted——Z83 providerTaskId 复用前提=重试同行；error 轮换=attempts/EXHAUSTED 通路结构性死代码+平台重复 submit）+投影 rearmable 判据单源+客户端 held 一律上送+T5 gated!==1 缺终态投影补（Z65）；Z96 T0 独立 commit（expand/contract 方向论——T0=expand 安全向，"注定红"窗口实测为空）+通行证夹具纪律+红相重写（原用例①"同月退款回落"系假红门——现行 decrement 写点存在）。**用户三裁定**：①删门+硬闸+nginx 入库（EXEC_MAX_CALL_MS 驳回——180s 单呼上界会杀 video/lighting 真实长任务，子报告内部矛盾；EXEC_MAX_NODES 保留）；②error 保留（token 农场内容基上限驳回——与 EXHAUSTED→新 token 付费重试语义冲突，登记残余归限流域）；③T0 独立（intent-fixture 前移驳回——createIntentFixture 默认三列是 T1 新列，改 T0 本地 helper+T1 工厂替换）。P1 十七采/二修正（claim⓪/selectable fakeAi 豁免/settleStranded 活读替代前置门/编辑链裸 fetch 改 apiFetch+rotate 族三删/月界北京时区/waiting 阈值具名常量/census BRE 修/listMembers 批量/CTE 合并/admin 回放当前余额/双钉理由修正/身份字段因果修正/租约门表述修正等）；P2 十六采；外审证伪五处登记（快照读 503/video-work 装载/balanceAfter 前提/双钉 create 分支/两段索引论证）。v2.1=第二轮外审收敛（三报告 ~80 论断逐条一手核验：5 P0 根修+Task 重排+裁定4/5 两项用户裁定落地）。v2→v2.1 关键变化：①T1 步骤序重排（Step 6.5 移出旧目录防 reset 四目录共存炸〔deploy.sh:171 自证〕+commit 前置服务器步〔deploy.sh:46/54 preflight 以 git SHA 为收据〕+`_prisma_migrations` 恰一行断言+census 行级三验）；②不变量与消费者同 commit（R3-P0-3 三断裂：触发器 vs runInTx/seed/bootstrap、idemKey NOT NULL vs claim、删月列 vs 读者编译——T1 吸收 claim 最小 idemKey 化+ledgerTx 统一改造，monthlyUsed 派生化前置独立 commit=T0）；③rollbackIntentFunds 补 lockBalance（契约 20：TB→GI 序；附 checker 加固——GI 写函数含 mutate 而无 lockBalance=违规）；④settleStranded 收窄 reservedCredits>0（v2 扩 consumed>0=历史成功单退款套利）+isPersistedComplete 前置门+产物键白名单；驳回 deliveredAt 列（Z17 维持）；⑤int 夹具工厂+ledgerWipe（19+ 直写+触发器含 DELETE 拦清理）；⑥信封双层包裹全量清剿 6 处（execution:59/ai-image-edit:49/lighting:46/52/56/69/71——外审漏 :69）+alignExecFromIntents 激活 web 测试——T6 前置（token 轮换依赖 replayed 可读）；⑦裁定4 regenToken：客户端手势 token+终态投影轮换+claim ②最新回放+regenerate 布尔退役+身份字段补全（erase 白名单空=同节点二次擦除回放旧产物——R3 独有发现）；⑧裁定5 AIModel：provider slug 化+apiModelName/providerLabel 新列+三模型 active=false+recommended=false（迁移+seed create 双钉）+selectable 三处+密钥行级 apiKey 单源+seed 裸 pricingRule.create 收口；⑨startedAt 列（phase 判据 heartbeatAt>createdAt 恒真修复）；⑩waiting/delayed 超界升级+UTC 月界+admin skipDuplicates+Σdeadline 预算门+观测补强（claim 三分计数/gestureKey 审计列/cause 拆分）。 -->
# Y0b-2 资金运行时 Implementation Plan（v2.1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 Y0b 资金运行时子批（spec v2.5 §3 Y0b-2 节全量+Y0b-1 移交约束组+五项裁定）——**schema 重建一次到位**（squash：heartbeatAt/deadlineAt/startedAt/idemKey/gestureKey/idempotencyKey+ledger DB 触发器+monthlyUsed 直删+AIModel 列变更）+**provider 硬化**（AIModel 单源 adapter/密钥行级/mock 四分支硬失败/deadline 驱动轮询/onTick 双职）+**心跳与 deadline**（判据单源+reaper 双批+A 路径禁绕过+waiting 升级档）+**完成时退款**（complete→settle→deliver 时序+rollback 双入口单事务含 lockBalance〔Z92〕+{written} 交付判定+settleStranded 收窄活读）+**真·finish 单出口**（try/finally+终态投影必达含 skipped）+**regenToken 幂等**（客户端手势 token+终态投影轮换+claim ②最新回放+身份字段补全）+**canExecute 硬态+反应式同步重发**+**sv 全链退役**+**计费读显式分源**+**E71**+**monthlyUsed 派生化**+**admin 幂等 DB 列**+**信封双层包裹清剿**。

**Architecture:** 不变量交给结构、启发式降级为观测（五项裁定同向）：①幂等权威=服务端 `idemKey = sha256(projectId|nodeId|kind|paramsHash|(token?'regen:'+token:'run'))` + `@@unique`——内容维度跨客户端跨设备只扣一次（claim ②：无 token 取同内容**最新** SUCCEEDED 回放），"重新生成"=客户端手势 token（regenToken：点击铸造、终态前重试复用、终态投影轮换——响应丢失/双击/EXHAUSTED 重发结构性单次）；②同步权=服务端 SV 支配门在**四个受理端点**（claim 之前；`ExecutionJobData` 删 SV 字段），客户端 canExecute 只留硬态+反应式重发（`unsyncedChanges` 归零边沿——禁 `synced` 一次性事件）；③资金回滚=rollback **双入口**单事务单实现（**lockBalance 前置**+Z92 拆分：rollbackRunning=RUNNING 严格 CAS〔reaper 唯一〕/rollbackDeliveryFailed=SUCCEEDED∧written:false〔交付路径唯一〕→逐行 release/refund→两金额归零→VOIDED 同事务）；④台账唯一写入口=DB 触发器+`ledgerTx()` 统一事务入口——**触发器与其全部消费者同 commit**（runInTx/seed/bootstrap/夹具同批改造）；⑤交付判定=writeNodeData `{written}`+settleStranded 收窄（reservedCredits>0 only+前置门+白名单）；⑥deadline 三线收敛+waiting 升级档；⑦AIModel=唯一模型源（provider slug+apiModelName+行级 apiKey；selectable 谓词三处消费）。

**Tech Stack:** Prisma 5.22（squash 手工汇编+census 对象级+行级三验证）/ PG16（partial index/触发器/NULLS NOT DISTINCT）/ vitest（单元+int 真库）/ prom-client / zod / BullMQ / React+zustand。

**执行门：** 每 Task Step 0 只读探针（输出粘 commit message）；**T1 含两个【告知用户点】**（本地库 reset 重建；服务器 `deploy.sh api --rebuild-db`——**数据确认丢弃**+服务器 `.env` 三枚密钥人工步）；**每 Task 收尾 `git commit`，红→绿→commit；不变量与其消费者同 commit**（R3-P0-3 纪律：schema 落地与读取/写入代码不允许跨 Task 分离）；**T9 子批出口=【用户确认点】**。

**执行序：**

```
T0（monthlyUsed 派生化先行——独立 commit〔Z96：expand/contract 的 expand 侧——列暂留无读者，
  main 全绿；通行证夹具纪律+红相三条=成员移除保留/跨月归因口径/写点漂移面锚〕）
  → T1（schema squash 一次到位+不变量消费者同 commit：claim 最小 idemKey 化+ledgerTx 统一改造
        〔**删 tx()——14 处消费者普查交 tsc+解散/建团队 FK 级联通行证（Z89）**〕
        +夹具工厂+AIModel 列变更+startedAt/gestureKey+步骤序修正+BASELINE 抬高）
  → T2（api-caller 硬化+slug adapter+EDIT 例外+selectable 三处+断言三件+verify 断言
        +deadline 驱动轮询+onTick 双职+providerTaskId）
  ‖ T3（计费读显式分源+SnapshotDocCache 单源+fallback 活读+无租约门）
  → T4（心跳+deadline 双批 reaper+startedAt phase+waiting 升级档+A 路径禁绕过）
  → T5（rollback 双入口〔rollbackRunning/rollbackDeliveryFailed——Z92 竞态封死+lockBalance 前置〕
        +complete→settle→deliver+真单出口+终态投影含 skipped（gated≠1/written:false 补 error 投影）
        +emitExecutionComplete 删除+settleStranded 收窄+rearm 保留 providerTaskId+第三不变量+runIntentLifecycle 收口）
  → T6（信封清剿前置→regenToken 全协议+身份字段补全+claim ②最新回放+intentRecord 族退役+按钮手势态）
  → T7（SV 门移四受理端点+canExecute 硬态+反应式重发+sv 全链退役——同 commit+DENYLIST 围栏迁移）
  → T8（admin 幂等 advisory 锁+前置查形态〔Z113〕+E71+月界收尾+**Σdeadline 准入门撤销→EXEC_SYNC_HARD_CAP
        病态批硬闸+nginx /api 墙钟钉仓（Z90）+EXEC_MAX_NODES 移入（Z117）+check-nginx-budget.mjs**）
  → T9（出口三连 verify+test:int:ci+check-int-coverage+census 回填+spec 偏离登记+残余登记）
```

**TDD 纪律：** 红→绿→commit，红相留档（commit message 粘红/绿两态）。**真红门**：regenToken **十三用例**（含丢响应重试/不同 token/erase 不同 mask/refresh 复用/regenerate 后普通点击取最新/token 非法 400/**enqueue 重生成 Z91/RUNNING 在飞 NodeBusy Z94/error 后同 token rearm 判别性断言 Z95**）/未知模型预检零外呼/deadline 双向/交付退款单事务原子性/reaper×settle 交错+**Z92 竞态封死（complete 后注入 reaper）**/UNKNOWN_NODE_IDS+CYCLE+EMPTY_SCOPE/部分成功四断言/空串当成功/SV 门四用例（含**缺 stateVector 400**——第四轮）/admin 幂等回放（含**同 reversesId 二次入账仍抛错**——Z100 backstop）/monthlyUsed 三漂移（**成员移除保留/跨月归因判别性〔lastMonthBounds 断言〕/冻结计入+complete→settle 窗口不减**）/触发器拦截（含 raw 面+DELETE 面+**FK 级联解散+money-in 五链路冒烟 Z89**）/**T1 三条：改 prompt 同 held id 新行非 NodeBusy（Z103）/并发双 execute 恰一次外呼（Z104）/重新生成新行（Z103）**/终态投影必达六路径（**含 gated≠1/written:false+reaper 侧**——Z95/Z106）+**投影代次化三条（Z99：error(a1)→rearm loading/done(a2) 可写=改前红）**/**settleStranded 三分支表驱动+Z102 真悬留（改前红=恒 no-op）**/身份完整性表驱动/启动断言 fail-closed（**无 DASHSCOPE_API_KEY 非 FAKE_AI 拒启+HARD_CAP≥max(deadline) 相对关系**——Z93/Z90 红测）/**停滞负向（12 次 running 后成功不抛——Z105 改前红按字面读必杀）+PROVIDER_TASK_LOST（404 立即终态）**。**census 验收 grep**（**统一 `\|` 转义——BRE 裸 | 永真假绿，v2.2 修**）：`x-yjs-sv\|svBytes\|sv\?:`（T7 后清零）+`Unknown model type\|Mock response for\|MODEL_CONFIG`（T2 后清零）+`console\.log`（api-caller 清零）+`INTENT_CONTEXT_MISMATCH\|isFirstExec\|currentIntentId\|newIntentId\|intentRotateMessage\|lastSubmitRef`（T6 后清零）+**`ledger\.tx\(`**（T1 后清零——含 :11 头注释同 commit 改，Z89）+**`readCanvas\(`**（intent-reconcile 文件清零——Z98）+**`x-intent-id`**（T6 后清零——Z103）。**int 纪律**：新增 **9 个** int 文件 ⇒ T9 回填 check-int-coverage 逐文件下限+INT_MIN_TOTAL 按实测上调；**新 int 文件必须先 `git add`**（git ls-files 取文件集）+**check-int-coverage pathspec 一行修根级**（补 `"apps/api/src/*.int.spec.ts"`——Z118 修门禁非"放子目录"绕）+保持 `(hasDb ? describe : describe.skip)` 约定。**第五轮补真红门**：Z109 无 token 路径命中 claim②③（服务端铸造值禁入 token 位）/Z111 无 attempts 迟到投影被拦+老代不覆盖新代/Z112 无连接项目收敛 doc 未装载+deferred 计数/Z113 并发同键同 transactionId+同 reversesId 仍抛错/Z115 diff ⊆ 金标（脚本化双向）/Z117 admin activate∧!ready 被 4xx 拒/停滞负向两条（12 次 running/12 次未知中间态均不抛）。

---

## 0. 终裁记录（v2.1——执行者必读的设计依据）

### 0.1 五项裁定（2026-10-09 用户确认——同向：把不变量交给结构，把启发式降级为观测）

| # | 裁定 | 一句话理由 |
|---|------|-----------|
| **裁定 1** | **monthlyUsed 列删除走二次 squash（T1 一次到位）**，不做两步走停写 | 开发期无灰度无存量；squash 是仓内既定机制（Y0b-1 T1a 24→1 先例+`deploy.sh --rebuild-db` 已验证）；破坏性增量迁移=给门禁开口子 |
| **裁定 2** | **canExecute 只留硬态+反应式同步重发** | 自持标记两个方向都会漂（`synced` 一次性事件 dist 实证）；已同步的绝大多数点击零延迟零 forceSync |
| **裁定 3** | **幂等键=服务端 idemKey 本批落地** | 客户端铸造的**内容键**在多客户端语境结构性失效；现行键协议三义；净删代码 |
| **裁定 4**（本轮） | **regenerate 单次性=客户端手势 token（regenToken）**：`idemKey=sha256(projectId\|nodeId\|kind\|paramsHash\|(token?'regen:'+token:'run'))`；token 点击铸造（uuid 校验 ≤64）、终态前重试复用、**终态投影轮换（v2.2 修订=Z95：done\|exhausted only——error 保留 token 走免费 rearm；轮换判据单源=doc 投影〔done 或 rearmable:false〕）**；**regenerate 布尔退役**（token 存在即手势）；claim 无 token 路径取同内容**最新** SUCCEEDED 回放；身份字段补全=前置 | 服务端每请求 mint nonce ⇒ regenerate 响应丢失重试=双扣（R2-P0-1）；"这是不是同一次手势"只有客户端知道——retakeId 仓内既有判词自证（video-project.dto.ts:18"服务端兜底=每次新 id=重放无幂等"+dto.spec:41 红测试）；失败模式不对称：客户端铸 token 最坏=静默重放（方向安全），服务端铸 nonce 最坏=双扣；对裁定 3 仅修订铸造权归属，三条论据全保留 |
| **裁定 5**（本轮） | **AIModel 三模型（sdxl/dalle/gpt4）active=false+recommended=false**（迁移 INSERT+seed create 块**双钉**）；provider 列语义改 **slug**（moonshot/tencent；NOT NULL，未实现行照填 openai/stability——"未实现"由 active 表达）；新列 `apiModelName`（可空，断言强制 active 行非空）+`providerLabel`（显示）；**密钥行级 `AIModel.apiKey` 单源**（运行时唯一读取口；seed 从 PROVIDER_* env 灌值；deploy 不传 .env ⇒ env-only=静默 401）；`selectable` 谓词三处消费（选择器/validation 预检/启动断言）；DashScope 编辑链=adapter 表显式例外（不建模型行——定价 kind 级结构不动） | active 已是结构性 fail-closed 闸（resolver:28-31 validation 阶段 4xx 零外呼零冻结零行）；**seed create 分支会把 active 翻回 true**（schema default(true)——T1 squash=服务器重建+人工 seed 恰是 create 分支触发时刻，双钉是唯一闭环）；recommended 不清=默认选中必 4xx 模型；provider 现值=显示名且三 seed 文件间漂移（'腾讯混元' vs 'Tencent Maas'）永不自愈 |

**五项耦合句**（写进实现注释）：squash 让 idemKey/gestureKey/apiModelName 列零迁移成本（1↔3↔5）；doc 投影驱动的 token 轮换让"点击即发"有确定的用户语义（2↔4）；反应式重发让 SV 门保持严格 fail-closed（2↔7）；触发器与 ledgerTx 同 commit 让台账护栏从第一天无裸奔窗口（1↔4）。

### 0.1bis 裁定 4/5 三子报告收敛纪要（冲突点处置——防后人翻案）

| 冲突点 | 处置 | 理由 |
|---|---|---|
| token 轮换判据：成功响应（子报告 A）vs 终态投影（B/C） | **终态投影**（**v2.2 修订=Z95：done\|exhausted 轮换，error 保留**） | A 的规则在 EXHAUSTED→重新发起路径留死 token（命中已耗尽行=按钮失效）；响应丢失场景恰恰最需要复用——终态投影是服务端权威答案且不依赖响应送达；**error 保留的三重理由（第三轮终裁）**：①失败行已 release 不扣费——error 保留⇒claim① FAILED⇒免费 rearm（attempts≤3 既定设计语义），error 轮换=用户为平台故障付费重试；②attempts 只在同键重入既有终态行时自增（generation-intent:97）——error 轮换=每次新行=attempts 恒 1=`IntentExhaustedError`+`intent_claim_result_total{rearm}` 结构性死代码；③Z83 rearm 保留 providerTaskId 的 query-first 防平台重复付费，前提=重试落**同一行**——error 轮换=新行 providerTaskId=null=重新 submit=平台白付（Z83 在唯一需要它的路径失效） |
| 编辑入口：恒手势（C/v2 原案）vs 不需要恒 regenerate（A 修改） | **恒手势**（每次应用=新 token；终态前重试复用） | A 反对的"每次点击=新 token⇒丢响应重试双扣"已由生命周期复用结构性关闭；编辑是生成性重跑——同遮罩重做回放旧图="点了没反应"（A 自己在 token 校验论证里点名的最劣失败形态）；且编辑工具条非 exec 状态按钮，两态映射不成立 |
| regenerate 布尔：保留（A/B）vs 退役（C） | **退役**——token 存在即手势 | 二者语义完全相同（"我要新一版"）；双信号=忘带一方的静默 bug 面（B 的互斥校验就是在修这个）；DTO 单字段 |
| claim 无 token 回放：findUnique 内容键（v2/A/B）vs findFirst 最新（C） | **findFirst 最新**（`{projectId,nodeId,kind,paramsHash,status:'SUCCEEDED'}` orderBy createdAt desc） | findUnique 命中**第一版**行——regenerate 得到 v2 后普通点击（如改位置重置 exec）会回放 v1=产物倒退；最新回放消解 |
| provider 列：可空 NULL=无实现（A）vs NOT NULL 照填（C） | **NOT NULL 照填**（openai/stability） | provider 是既有 NOT NULL 列，改可空加迁移摩擦+夹具破面；"未实现"由 active 表达语义更正（有 slug 无密钥会被四条件断言抓住） |
| DashScope 编辑链：建 4 行 AIModel（C 主案）vs 显式例外登记（C 自述 fallback） | **显式例外登记**（adapter 表 kind 级档+注释钉死） | 编辑定价是 kind 级（modelId NULL）——建模型行会造成"有行但规则不挂它"的新漂移面；模型化归 Z57 重构统一 |
| 启动断言：拒启（A）vs 结构层 CI+密钥层运行时（C） | **onModuleInit 四条件含 apiKey 在位，production 拒启**；dev COLLAB_FAKE_AI=1 豁免 | deploy 不传 .env——漏配密钥 env-only 形态=外呼时 `Bearer undefined` 401（比启动炸难查一个量级）；拒启把配置错误提到部署期 |
| 密钥载体：env 单源（v2 原案）vs 行级 apiKey（A/C） | **行级 `AIModel.apiKey` 单源**；apiKeyEnv 降级为 seed 灌值来源+断言提示 | admin console 已在写该列（model.service:30/51）+seed 已在写（仅 env 名未登记）；行级=不重启轮换+启动可断言；HY_IMAGE_API_KEY 未进 envSchema 是既有缺陷顺带归并为 PROVIDER_TENCENT_API_KEY |

### 0.2 v1 终裁处置对照（Z41-Z59 → v2 语义——v2.1 维持，从略见 git 历史）

Z41-Z59 处置表 v2 原文维持（Z42 撤销→裁定 1 squash；Z47 撤销→裁定 3 idemKey；Z49 修订→门移四受理端点；Z51 撤销→DB 触发器；Z53 撤销→squash 直删；Z55 撤销→只留硬态〔writeFrozen 字段维持 Y0b-5 接线既定，见 Z86 驳回〕；Z56 修订→反应式；Z58 撤销→intentRecord 族退役）。

### 0.3 v2 新增终裁（Z60-Z73——v2.1 维持有效）

Z60 squash"起草-验证-汇编-删除"双验证（禁 `prisma migrate diff --from-empty`；本批 DDL 先以 additive 形态受检再汇编）/ Z61 BASELINE 抬高三件 / Z62 idemKey 协议（**v2.1 由裁定 4 修订：regenNonce→regenToken 客户端铸造+`'regen:'/'run'` 命名空间分隔**）/ Z63 regenerate 受理语义（**v2.1 修订：判据=按钮手势档+doc 投影，regenerate 布尔退役**）/ Z64 rollbackIntentFunds 单事务（**v2.1 补 lockBalance 前置=Z75**）/ Z65 终态投影必达+emitExecutionComplete 删除 / Z66 AIModel 单源 adapter（**v2.1 由裁定 5 细化=Z80**）/ Z67 synced 事件禁用清单 / Z68 deadline 三线收敛+双批 reaper（**v2.1 补 waiting 升级档=Z84**）/ Z69 轮询 deadline 驱动+onTick 双职+providerTaskId（**v2.1 修订：rearm 保留 providerTaskId=Z83**）/ Z70 monthlyUsed 派生公式（**v2.1 修订：UTC 月界+查询拆两段=Z86**）/ Z71 admin 幂等 DB 列（**v2.1 修订：skipDuplicates 形态=Z87**）/ Z72 交付判据族（**v2.1 收窄=Z76**）/ Z73 机械组。

### 0.4 第二轮外审终裁（Z74-Z88——2026-10-09 三报告合一核验后采纳；驳回登记附后）

| # | 裁定 | 一句话理由（一手证据） |
|---|------|----------------------|
| Z74 | **T1 步骤序重排+commit 前置**：汇编新 init 后**先移出** draft+两旧目录（至 .bak 可回退）再 reset/verify/census；`_prisma_migrations` 恰一行断言；**服务器重建排在 commit 之后** | 四目录共存 reset 必炸（字典序重放二次 CREATE TYPE——deploy.sh:171 自证"不清=旧 24 目录字典序先跑必炸"）；deploy.sh:46/54/69 preflight 收据=git SHA——部署未提交代码=同 SHA 缓存命中=preflight 被跳过 |
| Z75 | **rollbackIntentFunds 补 lockBalance 前置**：读 intent（无锁 SELECT）→`lockBalance(tx, intent.teamId)`→GI CAS→逐行冲销；checker 加固——函数含 `ledger.mutate(`/`ledgerTx(` 且有 GI 写而无 `lockBalance(` 先行者=违规（现锚只报"有锁但序反"，缺锁是漏报） | 契约 20 全序 TB→GI；现设计 GI CAS 先于 mutate 内锁=与 reserve 反向加锁的 ABBA 面；checker :56-58 `lock>=0&&giWrite>=0&&giWrite<lock` 对 lock=-1 静默 |
| Z76 | **settleStranded 收窄**：判据只收 `TERMINAL ∧ reservedCredits>0`（`consumed>0` 永不进本分支——E53 已交付不退款）；SUCCEEDED∧doc 无产物→rollback、有产物→补 settle；`isPersistedComplete` 为**前置门**（不满足本轮跳过该行——快照不含 spool 帧=假阴性方向退款）；产物键白名单（text=result/image=resultUrl/video=videoUrl）+未知 kind 不裁决只计数；**驳回 deliveredAt 列**（Z17 status 判据维持；"consumed>0 永未交付且无重试"登记 T9 残余） | v2 扩判据把"交付后删节点"（合法操作）判为未交付⇒每 5min 一轮按 completedAt asc 稳定推进退款历史成功单=可重复套利 |
| Z77 | **int 夹具工厂+ledgerWipe 同批**：`apps/api/src/test-utils/intent-fixture.ts`（createIntentFixture 自带 idemKey/heartbeatAt/deadlineAt 默认）+`ledgerWipe`（SET LOCAL app.ledger_tx 包装的 deleteMany——**触发器拦 DELETE，清理也要通行证**）；四文件 19+ 处直写全替换；台账直写夹具改经 ledger.runInTx | 三列 NOT NULL+触发器双重打击（generation-intent:156/162/199、credit-ledger:12、team-lifecycle:29、ledger-invariants:19/45 裸 createMany/$executeRaw INSERT 核实）；红因指向门禁而非被测逻辑=训练绕过反模式 |
| Z78 | **信封双层包裹全量清剿**：删 6 处手包（execution.controller:59/ai-image-edit:49/lighting:46/52/56,**69**,71——:69 是外审漏计的第 6 处）统一交全局拦截器；HTTP body 形状断言+`Array.isArray(rows)` 断言+静态锚 `grep "code: 0, data:" apps/api/src` 仅允许拦截器实现；**alignExecFromIntents 从 no-op 变激活**——补 web 测试 | TransformInterceptor 无条件包（仅 @NoTransform 例外全仓 1 处）+client.ts:37 返 json.data⇒canvasCollabRuntime:203 `rows?.[0]`=undefined⇒断连恢复对齐**生产静默 no-op**（既有功能故障非顺手修） |
| Z79 | **regenToken 协议**（裁定 4 全文）：键派生单一派生点 intent-key.util；服务端严格校验（形态非法⇒400 IDEMPOTENCY_TOKEN_INVALID **禁静默忽略**——静默忽略把"重新生成"降级成"重放"="点了没反应"）；token 生命周期四态（铸造=手势档点击/复用=终态前任何重试/轮换=终态投影后清除/存储=sessionStorage 每节点一键跨刷新存活）；claim 三入口（①token→findUnique 手势键状态机；②无 token→findFirst 同内容最新 SUCCEEDED 回放；③否则 content 键状态机/new）；`gestureKey String?` 审计列（行↔点击可排障）；retakeId=token 零客户端改动；**信封清剿（Z78）是硬依赖同批**——token 轮换判"replayed:true"需可读 | 见裁定 4；`video-project.dto.spec.ts:41` 既有红测试=选 1 的直接验收证据（选 3 与 E0 判词正面冲突） |
| Z80 | **AIModel 列变更+selectable**（裁定 5 全文）：新 init 的 AIModel INSERT 改写（provider slug+apiModelName/providerLabel 三列+三模型 active=false/recommended=false）+**seed.ts create 块同步钉死**（update:{} 不回写——create 分支是 fresh-rebuild 唯一写径）+seed 裸 `pricingRule.create` 分支（seed.ts:117-124，`as any` 逃逸类型检查）收口为只读校验或与 init 逐字一致 upsert；`selectable(m)=m.active∧adapterFor(m.provider)∧m.apiModelName∧m.apiKey` 三处消费（models 端点过滤/validation 预检 `MODEL_NOT_AVAILABLE` 4xx claim 前零冻结零 attempts〔存量 dev 节点引用停用模型的显式出口〕/启动断言）；启动断言四条件 onModuleInit（production 拒启；COLLAB_FAKE_AI=1 豁免）；**funds-four-way.int.spec:113-114 夹具换 kimi+hy-image**（断言全关系式两行改动）；api-caller 注入 PrismaService 后三 spec 编译面预算进 T2 | active 是 resolver:28-31 结构闸；recommended=true 是 sdxl/gpt4 现值（seed:54/108）=默认选中死模型；`check-pricing-coverage` 只审 active（:40）⇒不触红；pricing-resolver.int 的 take:1 active 查询剩 hy-image/hy-video 不受影响（已核） |
| Z81 | **ledgerTx 统一入口与触发器同 commit（T1）**：runInTx 内置双 SET LOCAL（lock_timeout+app.ledger_tx）；intent-reconcile/team-credit 既有手写 SET LOCAL 收敛；ensureBalance 裸 INSERT 走 guarded 路径；seed.ts:204/platform-team.seed.ts:35/team.bootstrap.ts:29-35 生产调用点同批 | runInTx 现只 SET lock_timeout（:42-47 核实）——触发器落地即拦 bootstrap（建团队）+seed+ensureBalance raw INSERT：T1-T5 之间 main 不可运行且红因指向触发器 |
| Z82 | **不变量-消费者同 commit（Task 重排）**：claim 最小 idemKey 化进 T1（deriveIdemKey 基础形态+三列写入+claim spec 同批改写——T6 只做语义层 token/退役族）；monthlyUsed 派生化前置独立 commit（T0：读者/写者改道，列暂留至 T1 删） | idemKey NOT NULL（T1）vs claim 写入（T6）/触发器（T1）vs ledgerTx（T5）/删月列（T1）vs 读者编译（T8）——三断裂全部成立；PG 有数据后 ADD COLUMN NOT NULL 无默认不可补+SET NOT NULL 被门禁拦=无法事后补救 |
| Z83 | **startedAt 列+phase 判据+rearm 保留 providerTaskId**：`startedAt DateTime?`（外呼真正开始=reanchorDeadline 时写一次）；`phase=row.startedAt?'call':'queue'`；rearm data 清 resultRef 但**保留 providerTaskId**（重试路径 query-first 防平台重复付费——Z69 与 Z72 原文自相矛盾的消解） | claim 显式写 heartbeatAt 后 `heartbeatAt>createdAt` 恒真⇒queue 档永不可达（调度积压信号消失）；rearm 清 providerTaskId⇒重试必再 submit=平台重复付费 |
| Z84 | **waiting/delayed 超界升级档**：deadline 批对 `jobState∈{waiting,delayed} ∧ now>max(deadlineAt×3, 30min)` 的行不再 A 路径跳过——VOID+release（迟归 job 走 claim rearm 自愈：job 进 processor 时行已 VOIDED⇒分支④再激活，语义自洽）；T9 残余登记处置行 | A 路径 active/waiting/delayed 零动作（:126-131 核实）+deadline 批 jobActive 跳过⇒worker 死亡+job 留 waiting=冻结资金永久悬挂无上界 |
| Z85 | **观测补强三件**：`intent_claim_result_total{result=replay\|rearm\|new\|busy}`（"用户以为重新生成实际被回放"运行期唯一可观测面）；`ai_artifact_discarded_total` cause 拆分（`precall-miss` 恒 0 断言/`node-deleted` 在飞真计量——两处自增污染 spec 恒 0 断言）；gestureKey 审计列（Z79） | idemKey 生效后回放类问题四个新指标都不覆盖 |
| Z86 | **月界 UTC 单源+派生查询拆两段**：`currentPeriodBounds()` 用 `Date.UTC`/`toISOString` 算月界（消灭 Node 本地时区 vs Prisma naive UTC 的 8h 差）；派生 SQL 拆两段（月内 settle 集+该集 reversesId 上的 refund 集——`COALESCE(rev.createdAt,t.createdAt)` 表达式不吃 `(teamId,operatorUserId,createdAt)` 索引）；int 加 23:59/00:01+TZ 注入边界用例 | currentPeriod 用 `d.getFullYear()/getMonth()`（:13-16 核实）=服务器本地时区；月界在 UTC+8 部署差 8h 且 int 用例随机器 TZ 漂移 |
| Z87 | **admin 幂等 skipDuplicates 形态+回放补全**（**v2.4 撤销=Z113**：skipDuplicates 会吞唯一冲突⇒钱包已变流水缺失——改 advisory 锁+前置查；回放当前余额/operatorUserId 一致性两子项保留）；一致性判据含 `operatorUserId`（换操作员同 key≠重放） | Z33 同款；v2"23505 catch 回读"违反仓内已立纪律 |
| Z88 | **机械组**（逐项实证采纳；v2.2 部分修订见 Z90）：verify 断言拆三件（静态 unit=迁移 provider slug 集合 vs adapter 表 DB-free/`onModuleInit` 启动/int 真库——`.verify.spec.ts` 名落单元池无 DATABASE_URL 必红；**v2.2：int 真库断言的密钥面用 fixture 行自建——CI 零密钥实证**）；`readCanvasSnapshotCached` 谓词不满足→**活读**（isPersistedComplete 语义="快照可信否"，不满足用快照=定义性错误；doc 常驻时活读零成本）+快照出口本无租约门（实测 :66-77 不查——**v2.2 表述修正**：谓词满足⇒快照（无门，drain 完成后可读）；不满足⇒活读需租约（drain 进行中 503——T9 登记）+fallback 计数观测）+collab-document.service:65 矛盾注释改写；execute service 形参 sv 删（门只在 controller）；`'skipped'` 进 NodeExecStatus union+**不进** writeExecStatus 终态守卫（:127-128 只认 done/error——skipped 可被后续 loading 覆盖）；errors 结构化同批改 executionApi 类型+**PreviewPlayer.tsx:65 真消费点**（`errors?.[0]` 模板串化 [object Object]；**v2.2：实际路径=video-editor/components/**）；~~EXEC 预算门=Σdeadline≤55s~~（**v2.2 撤销=Z90**——EXEC_MAX_NODES=20 保留）；DENYLIST 加 token 同 commit 先把 spec 正文行内 token 迁围栏（stripForDenylist 不剥行内反引号:29-32 核实；**v2.2 增补 intentRecord 族**）；census 行级三验（五定价表行计数+`SUM(creditCost)` 双侧比对）+Step 0 createdb 探针（--replay-new CREATE DATABASE :51-52；**v2.2 补 SHADOW_DB 探针**）；`prisma migrate diff --from-migrations --to-schema-datamodel` 输出空后验（**v2.2 改 `-z` 硬断言**）；verify-indexes 实际路径=`apps/api/prisma/verify-indexes.sql`（v2 写错 scripts/）+块数快照粘 commit；T1 Step 4 seed 命令=`pnpm exec prisma db seed`（db execute 只吃 SQL；package.json:55-57 已配 tsx）+删 `|| true` 吞错+删多余 mid-deploy；settleStranded 超窗与既有 STALE_MS/RETENTION_MS 集中具名常量；text 链 providerTaskId 显式 null；emitExecutionComplete 删除同步 5 处 spec 夹具；selectExecStatus 真签名 `(s,nodeId)`（v2 示例笔误）；**v2.2：census grep 统一 `\|` 转义范式（BRE 裸 `\|`=字面量永真——T2 Step 5 实锤）** |

### 0.4bis 第三轮终裁（Z89-Z96——2026-10-09 三报告一手核验+用户三裁定子报告收敛）

| # | 裁定 | 一句话理由（一手证据） |
|---|------|----------------------|
| Z89 | **ledger.tx 十四处普查+删 tx()+FK 级联通行证**：`tx()`（credit-ledger:49 纯品牌转换无 SET LOCAL）**删除**——普查交 tsc（每个未改造调用点=编译错误）；14 处生产调用全改 `ledgerTx(raw)`（team-credit:62/128/179、intent-reconcile:195/227/357、team.bootstrap:29 ✓已在单+**team.service:62〔建团队〕/:431〔解散——`tx.team.delete()` 级联删 TeamBalance 触发行级触发器，解散事务须持通行证〕、team-recharge:141〔充值〕、team-subscription:72/138、admin-subscription:71、personal-team-ledger:55/73〔公开签名收 LedgerTx；四个调用方 payment-success:125/grant-credit:59/expire-subscription:53/admin-subscription:51 的事务首句取通行证〕**）；checker 加 `ledger.tx(` 禁用锚；充值/grantToPersonalTeam 真库 int 冒烟；Step 0 探针 `grep ledger.tx(` 清零 | 触发器落地当天先断的是五条 money-in 产品链路（注册建团队/充值/订阅发放/到期清零/admin 授予/解散），而它们的单测全 mock ledger⇒verify 全绿假象；FK 级联（schema:711 onDelete Cascade）对行级触发器同样生效 |
| Z90 | **Σdeadline 门撤销+硬闸+停滞检测+nginx 钉仓**（**v2.3 修订——以下四处旧表述以 Z97-Z108 为准**：①默认值语义="同步组 ≤2×video"规模上限〔非"lighting 最坏值"——lighting 不走组端点〕+zod 不设硬地板改启动断言锁相对关系；②停滞判据=**lastGoodResponseAt 时间计数只计异常**〔"连续 10 次非终态"会杀一切长任务=Z105〕；③nginx=**HARD_CAP+60s(1860s) 相对式**〔1200s<HARD_CAP=合法 2×video 批必 504〕+静态单测；④错误码=EXEC_SCOPE_TOO_LARGE）：删 `EXEC_SYNC_BUDGET_MS`（保 EXEC_MAX_NODES）；新增 **`EXEC_SYNC_HARD_CAP`（默认 1_800_000）**——`Σ deadlineForKind ≤ HARD_CAP`（判据=请求时长**真实上界**非耗时预估；只挡 20×video=5h 资源钉死）；pollLoop 停滞检测（接管老轮询次数上限的停滞出口职责）；**`deploy/nginx/api-location.replace.conf` 新建**（推导式注释锁死+"改 HARD_CAP 或任一 EXEC_DEADLINE_* 必须同批重算"）；504 语义=「已受理」：组执行 catch 文案+按钮忙态以 exec 投影为主判据+withSyncRetry 只重 SYNC_PENDING 不重 5xx+禁把 504 当换 token 信号；execute 循环注释钉死**禁后人加"断连即取消"**（req.on('close')/aborted 全仓零命中实证——服务端不因断连中止=期间不变量，504=回执丢失非工作丢失，重试精确性由 idemKey+claim②买回）；`execution_group_duration_seconds{nodeCount}` 本批埋点；**删门安全性依赖 T6 claim ② 同批生效**（纪律句：若 T6 推后则门推后——无 claim② 的 504 重试=真双扣） | 55s 门量纲错误（deadline=保守上界非 expected；text 90s 单节点即超=默认配置拒绝一切，"引导单节点路径"不存在——单节点同样被拒）；T2 删硬编码轮询上限后墙钟从 60/180s 有界升到 300/900/1800s 是真实回归但解法不是 4xx；整条同步链唯一墙钟=nginx（apiFetch 无 timeout/Node requestTimeout 只管收请求/server.timeout=0——三处实测均非上界），把未知旋钮变显式契约；nginx 提前断开不中止 Node handler⇒产物经 doc 投影照达 |
| Z91 | **enqueue 链 regenToken 三处管道**：`ExecutionJobData` 增 `regenToken?: string\|null`；enqueue 端点 `regenToken: body.regenToken ?? null` 入 job.data；processor `execute(projectId, nodeId, userId, undefined, { regenToken, jobId })`；红用例**经 enqueue 的"重新生成"断言新行新扣费**；AudioConfigPanel:144 现状不传 intentId 一并统一 | 五面板（Text:152/Video:200/Audio:144/imageNodeApi:63/imageExtNodeApi:71）全走 enqueueWorkflow（组执行仅 CanvasView:746）——token 断管=claim 无 token 路径⇒回放旧产物="点了没反应"最劣形态（v2.1 Files 只列了 DTO/executionApi，types/controller job payload/processor 三处零规划） |
| Z92 | **rollback 双入口拆分**：`rollbackRunning`（CAS 严格 `status:'RUNNING'`——reaper/threeCheck 唯一入口）/`rollbackDeliveryFailed`（CAS `status:'SUCCEEDED'` ∧ written:false 凭据——交付路径唯一入口）共用私有 `doRollback`；checker 锚：intent-reconcile 文件禁现 rollbackDeliveryFailed；红测=**complete 后注入 reaper⇒行仍 SUCCEEDED 无 refund 行 worker 正常写 doc** | 单入口 CAS `where:{id,status:intent.status}` 接受 SUCCEEDED+reaper 进事务前 worker complete（RUNNING→SUCCEEDED 产物未写）⇒事务内读到 SUCCEEDED⇒CAS 成功⇒退款⇒worker 写 doc=既交付又退款；闭包论证只靠"调用方自觉传 RUNNING"非结构保证 |
| Z93 | **启动断言 fail-closed+两类密钥**：断言与 NODE_ENV 解耦（缺密钥**默认拒启**，COLLAB_FAKE_AI=1 显式豁免档）；断言输入=selectable(AIModel 行) ∪ adapterFor 的 kind 级 seedEnv 非空（DashScope 四编辑 kind 覆盖）；CI 形态=provider-adapters.int 的密钥断言用 **fixture 行自建**（CI 跑 test:int:ci 且零密钥 env 实证——断言 seed 行 apiKey 非空必红） | NODE_ENV=production 从不设置（ecosystem:5 注释明言不注入/deploy.sh:118 仅检查）⇒"production 拒启"在唯一真实服务器永不触发；DashScope kind 级密钥只从 env 读不在 AIModel 行⇒缺 DASHSCOPE_API_KEY 时断言全绿外呼 Bearer undefined 401 |
| Z94 | **claim ⓪ RUNNING 闸前移**：claim 顺序=⓪ 同 nodeId 存在 RUNNING 行（且非本 jobId）⇒NodeBusy（零新行零回放，partial unique 已保证至多一行——一次索引查）→①token 键状态机→②无 token 最新 SUCCEEDED 回放→③content 键状态机/new；红测=RUNNING 在飞+无 token 普通点击⇒NodeBusy **非回放**（断言 doc 产物未被旧版覆盖） | ②只查 SUCCEEDED 且回放不产生 INSERT——partial unique 对它无力；"重新生成"RUNNING 中另一标签页普通点击⇒②命中旧 SUCCEEDED⇒回放旧产物写 doc⇒新产物随后覆盖=画布倒退闪回（现行实现此场景=NodeBusy，回放分支新引入倒退） |
| Z95 | **error 保留 token+投影 rearmable 单源+held 一律上送**：轮换条件=done\|exhausted（error 保留⇒免费 rearm）；**轮换判据单源=doc 投影**（服务端权威跨刷新存活）：error 投影与 `status:'error'` **同 patch** 携 `errorCode`+`rearmable`（INTENT_EXHAUSTED 的 catch 写 `rearmable:false`——writeExecStatus 终态守卫:127-128 约束事后补写被吞）+投影带 `attempts`（文案"重试（剩 N 次）"）；客户端 onClick=**held（sessionStorage 现有 token）一律上送**（error 后重试/在飞复用），held 空∧（投影 done∨rearmable:false）⇒铸新；轮换 useEffect=投影 done 或 error∧rearmable:false；**红测判别性断言**（行数恰 1/attempts 推进 1→2→3/submit 调用次数/providerTaskId 保留——"零扣费"两设计下都成立无判别性）；**T5 顺带修复：gated!==1 与 written:false 两分支补终态 error 投影**（原缺=节点永挂 loading 违反 Z65——进"终态投影必达六路径"）；残余登记：token 农场（同内容每次新 token=免费重置 FAILED 额度，与 attempts 农场同源归 Y0b-4/Y0.5 限流；内容基时间窗上限**驳回**——与 EXHAUSTED→新 token 付费重试语义冲突）/supportsTaskQuery 覆盖面（adapter 注释登记） | 见 §0.1bis 修订行三重理由；EXHAUSTED 后刷新死路（409 循环无法自救）由投影 rearmable 单源消解（跨刷新存活非 sessionStorage 内存态）；held 一律上送消解"error 后面板不上送 token⇒失败 regen 键行被孤立+多余内容键新行"（v2.1 面板片段实锤） |
| Z96 | **T0 独立 commit+通行证夹具纪律+红相重写**：T0=expand/contract 的 expand 侧（列暂留无读者，main 全绿——T0 后 T1 前中间态合法；T1 夹具工厂到时一行替换）；**夹具纪律**=T0 新 spec 一律 `ledger.runInTx(ensureBalance/mutate)` 通行证写法（funds-four-way:36-53 既有范式"T5 教训"）+禁直写 teamBalance/禁裸 raw 台账写+禁给 monthlyUsed/monthlyPeriod 赋值（证明"派生值与旧列无关"）+意图行用本地 helper（createIntentFixture 留 T1——其三列默认是 T1 新列）；跨月回填=月界参数注入（`bounds` 可选参）或 GUC 包裹 raw UPDATE（T1 前无害占位/T1 后通行证）；**红相重写三条**（原用例①"同月退款回落"系假红门——现行 unfreeze:203-208/refund:250-253 decrement 写点存在，改前就是绿的）：①成员移除后重加入⇒派生保留本月已用量（改前红：TeamMember 行删重建归零=配额宽恕；口径翻案显式固化）②跨月归因口径（上月 settle 本月 refund⇒本月用量不变——口径定义非 bug 修复）③写点漂移面静态锚（grep monthlyUsed 写侧零命中+三读点指派生）；T0 Files 补 4 个 spec（intent-reconcile.service.spec:12/164/216/258/293、team-credit.atomic.spec:104-107/266-267、team-credit.service.spec:50-63、team.service.spec:441/457）；T0 收尾跑**全量** int（used 语义扩大=RUNNING 冻结立即计入——commit message 留档）；T1 Step 0 普查 grep（monthlyUsed\|monthlyPeriod 生产零命中+teamBalance 直写 int 文件清单粘 commit）；验收=T0^/T0 两 commit 都绿+git revert T1 本地演练 T0 仍绿 | Z82 禁的是"schema 先落消费者后补"危险方向；T0 是消费者侧前置（安全向）——合并的真正代价=bisect 不可行（T1 六候选因）+回滚牵连（T0 钱语义独立可回滚 vs 合并体回滚拖回已落地服务器的 squash）；int 池跑活库——T1 前无触发器无新列，"注定红"窗口实测为空 |

**第三轮驳回登记**：①**EXEC_MAX_CALL_MS 单呼上界 180s**（裁定子报告 2）——内部矛盾：一边承认 video 真实墙钟 1-3min/lighting 更长，一边 180s 封顶=杀死长 kind 真实任务；与 deadline 语义重叠（设 960s 即退化成 deadline 本身）。②**attempts 内容基+时间窗上限**（裁定子报告 3）——与"EXHAUSTED→新 token 新行付费重试"既定语义（子报告 2 用例⑫）正面冲突；token 农场与 attempts 农场同源登记归 Y0b-4/Y0.5 限流。③**markExhausted/exKey sessionStorage 独立键**（裁定子报告 2）——与投影 rearmable 形成双源；投影在 doc 内跨刷新存活即单源。④**intent-fixture.ts 前移 T0**（裁定子报告 2）——createIntentFixture 三列默认（idemKey/heartbeatAt/deadlineAt）是 T1 新列，T0 时编译必错；改 T0 本地 helper。⑤**EXEC_MAX_NODES 删除**（裁定子报告 2）——DTO 数组校验独立价值（spec §2.5 v2.4 单列 env），2:1 保留。⑥外审证伪五处留档：快照读 fallback "仍 503"（readCanvasFromSnapshot:66-77 实测不查租约）；video-work "openDirectConnection 装载"（:330 走快照读注释自证）；admin 现行响应"含 balanceAfter"（grantCredit 实测返回 void——批评对象是本 plan 规划）；Z80"seed create 分支是翻转源"（迁移 INSERT ON CONFLICT DO NOTHING 先建行+gate-collab:188-189 顺序实证=create 永不触发；承重钉=新 init INSERT 值，seed 钉降级纯防御）；"两段查询因 COALESCE 不吃索引"（settle 腿索引完全可用——但单查询 SQL 有 settle 归因变 reserve 时间偏差，改 CTE 合并）。

### 0.4ter 第四轮终裁（Z97-Z108——2026-10-09 三报告一手核验+master 原地实测；共同形态="结构件换对了，判据还挂在旧载体上"）

| # | 裁定 | 一句话理由（一手证据） |
|---|------|----------------------|
| Z97 | **ledgerWipe 进唯一写入口+checker 规则②补漏**：`CreditLedgerService.wipeForTests(where)`（VITEST 环境守卫+SET LOCAL 通行证），intent-fixture 只调用；checker 规则②备选集补 `createMany\|deleteMany`（实测正则 `delete` 后须紧跟 `(`——`teamBalance.deleteMany(` 现可绕过）；`deleteTeamsWithPass(ids)`（GUC 包裹 `team.delete` 让级联带证）替换 **6 文件 12 处**（generation-intent:54/141、pricing-resolver:28、ledger-invariants:23/104/162、funds-four-way:80、credit-ledger:22、team-lifecycle-funds:19/36/49/73）；**21 处 `.catch(()=>{})` 掩码删**（触发器报错被吞=测试假绿+跨轮残留污染）；ledger-invariants:55 CHECK 断言移入通行证事务+改 message 匹配（`/balance_non_negative/`——触发器抢答使裸 toThrow 失去约束回归覆盖） | walker 只排除 .spec.ts（:70-73 实测）——test-utils/intent-fixture.ts 的 `teamCreditTransaction.deleteMany(` 必被规则①命中⇒T1 verify 必红 |
| Z98 | **ArtifactProbe 端口反转**：collab 侧 `probe(projectId, nodeId, kind): Promise<boolean>`（内部 readCanvas 查产物键白名单）注入 intent-reconcile（**CollabDocumentService DI 已在位 :61 实测**）；settleStranded **先探针（事务外）取事实→再开 rollback 事务**（锁内不做慢 IO）；intent-reconcile 文本零 `readCanvas(` | 规则⑤禁 readCanvas 清单=team-credit/intent-reconcile/credit-ledger 三文件（:43 实测）——T5 活读方案直接撞锚 |
| Z99 | **投影守卫代次化+skipped**：writeExecStatus 守卫从"终态一刀切"改 **"终态 ∧ `incoming.attempts <= stored.attempts` 才 return"**（每次写投影携 intent.attempts——listByNode select 补 attempts+web ExecStatusEntry 补 errorCode/rearmable/attempts+canvasCollabRuntime:177 白名单加 'skipped'+execStatusView 类型域补）；**NodeBusy 投影 skipped+reason（禁 error**——它不是节点失败是"别处在飞"，Z88 已把 skipped 排除终态守卫）；红测三条：同代次迟到 loading 被吞（保持）/error(attempt1)→rearm 后 loading/done(attempt2) 可写（**改前红**）/in-flight+重试⇒投影 skipped 且首跑 done 可写 | :126-128 守卫在写循环前整体丢弃（实测）——error 保留 token 的 rearm 链路：loading(:308)/done(:343) 全被吞⇒产物已进 doc 钱已结清而画布永停 error=**Z95 核心承诺功能性失效** |
| Z100 | **mutate 前置查替代 skipDuplicates**：lockBalance 后 `findFirst({idempotencyKey})` 命中⇒回放 `{rowId 原值, credits/subscriptionCredits=同事务当前两池, noop:true}`；**原样 create**（reversesId @unique/money_in_once 的抛错 backstop 全保留）；红测"同 reversesId 二次入账仍抛错" | mutate 顺序实测 ：91-94 teamBalance.update 加钱→:95 create——`createMany({skipDuplicates})` 吞唯一冲突⇒行不写钱已加事务提交⇒不变量①当场破；而 money_in_once 存在前提=事件 id 会重复投递 |
| Z101 | **selectable 拆两谓词**：`executable(m)=active∧adapterFor(provider)∧apiModelName`（**目录属性**——models 端点/validation 预检 MODEL_NOT_AVAILABLE/admin 标记/选择器）；`ready(m)=executable∧apiKey`（**运维就绪——只进启动断言**与 adapter seedEnv 并列）；fakeAiEnabled 从用户面谓词消失——CI 零密钥 executable 仍可选（funds-four-way 夹具换 kimi/hy-image 零密钥可跑）；运行中进程缺键结构性不可达（Z93 拒启兜底⇒用户面 401 不存在） | CI collab-core 无 seed 步+AIModel INSERT 显式 apiKey NULL（y0b1:73-80 实测）⇒含 apiKey 的预检让 funds-four-way:102/:141 必红；用 4xx 掩盖运维故障=与 Z93"配置错误提到部署期"自相矛盾 |
| Z102 | **rollbackStranded 第三入口**：`rollbackRunning`（CAS 严格 RUNNING——reaper/deadline 唯一）/`rollbackDeliveryFailed`（CAS SUCCEEDED∧written:false 凭据——交付路径唯一；checker 禁 intent-reconcile）/`rollbackStranded`（CAS `{status:'SUCCEEDED', reservedCredits:{gt:0}, completedAt:{lt:cutoff}}` **判龄是安全要件**（"无活 worker 持有"的结构证明）+事务内 ArtifactProbe 复核 doc 无产物——settleStranded 唯一）；**settleStranded 三分支表**：SUCCEEDED∧有产物⇒补 settle（:315 语义）/SUCCEEDED∧无产物⇒rollbackStranded/**FAILED\|VOIDED⇒void_（:317 else 现状保留——不收紧判据**，兜底不丢）；第四不变量（FAILED/VOIDED⇒reservedCredits=0）并入 verifyLedgerInvariants 巡检；红测"SUCCEEDED∧reserved>0∧超窗∧无产物⇒VOIDED+两金额归零（改前红=rollbackRunning 恒 no-op 冻结永挂）" | Z92 拆分把 settleStranded 的合法入口删掉了——悬留行恰是 SUCCEEDED，rollbackRunning CAS RUNNING 恒 count=0 静默 no-op |
| Z103 | **T1 就接 regenToken**：claimForNode 把 `input.intentId`（enqueue 链 body.intentId→job.data→execute 第 6 参→claim 已通；video retakeId 同路）接到 deriveIdemKey 的 **token 位**；`GenerationIntent.intentId` 字段改**纯服务端 randomUUID 铸造**（删 `?? randomUUID()` 兜底语义）；DTO intentId T1 标废弃、T6 删；`@@unique([projectId,intentId])` 保留（服务端随机永不冲突）；红测两条进 T1：改 prompt 同 held id 重试⇒**新行新扣费（非 NodeBusy）**/"重新生成"（新手势 id）⇒新行 | 换轨半截留三洞：①T1→T6 窗口键末段恒 'run'⇒重新生成静默回放（裁定 4 要灭的最劣形态）；②同 id 异内容⇒skipDuplicates 吞复合唯一(:118-126)+:135 映射 NodeBusy⇒**永久自锁**（实测链）；③执行者照搬 `?? randomUUID()` 进 token 位=服务端 mint=推翻裁定 4 |
| Z104 | **claim ⓪ jobId 合取固化**（**v2.4：maxStalledCount:0 部分撤销=Z110——保留现状 1+安全链注释**）：判定=`RUNNING && !(row.jobId != null && row.jobId === currentJobId)` ⇒ NodeBusy（**null 永不等于 null**——jobId 相等是 BullMQ 同 job 重排唯一凭据，缺省不构成凭据；禁 `?? null` 归一化）；~~queue-options 增 maxStalledCount:0~~（Z110 撤销）；分支②（同 jobId 续跑）保留+注释"~~maxStalledCount:0 下不可达~~安全链：stall→同 jobId 重排→claim②→alreadyReserved mayCall:false→静默退出（配置可被改回）"；红测（T1 内）：同 project/node/content 并发两次同步 execute⇒恰一行 intent、恰一次外呼、第二次 NodeBusy | 现状 :90 `input.jobId && ...` 合取实测✓——v2.2 ⓪ 文本丢掉它后 null==null 被当续跑⇒同步路径双外呼双扣费；且内容键复用走查行不触发 partial unique=洞在 T1 就存在（非 T6） |
| Z105 | **停滞判据只计异常**：`lastGoodResponseAt` 在"2xx ∧ status∈已知集合（**含 running/pending**）"时刷新；`now-lastGoodResponseAt > EXEC_POLL_TIMEOUT_MS × stallLimit(10)` ⇒ `pollStallTotal.inc`+throw `PROVIDER_POLL_STALLED`（独立 errorCode 非 deadline）；**404/任务不存在⇒立即终态 `PROVIDER_TASK_LOST`**（这才是"对死任务 hammer"的真实信号——supportsTaskQuery 适用面）；help 文案改"连续异常（不含处理中）"；**负向红测**：mock 连续 12 次 running 后 succeeded⇒成功且计数不增 | 三轮询循环正常态=非终态（:111-125/:286-306/:342 实测）——"连续 10 次非终态"按字面读=video 第 30s/image 第 20s 被杀，Z90 刚撤销的量纲错误原地复活 |
| Z106 | **reaper 终态投影**：rollbackRunning 成功后由 reaper 追加投影——`writeExecStatus(projectId,nodeId,{status:'error', errorCode:'INTENT_DEADLINE_EXCEEDED', rearmable:attempts<3, attempts})`（Z99 代次化后可写；**同 patch**）；drain 503 best-effort 记数（不因投影失败回滚资金）；红测"deadline 批收敛 RUNNING⇒doc exec[nodeId]={status:'error',errorCode,rearmable,attempts}" | intent-reconcile 全文件零 writeExecStatus+CollabDocumentService 已注入（:61 实测）——T5 六条终态路径全 worker 侧，reaper VOIDED 后节点永挂 loading=Z65 被自身路径证伪 |
| Z107 | **migrate diff 棘轮+可表达优先**：Step 0 **master 原地跑基线探针**（实测输出恰 2 行：`Removed unique index on (nodeTypeId,modelId,resolutionId,durationId)`——粘 commit）；`apps/api/prisma/migrate-diff-allowlist.txt` 金标=**pricing_rule_natural_key 一行**（NULLS NOT DISTINCT 语义 Prisma 不可表达——普通 @@unique 会漏可空列重复，必须留 raw）；断言"diff 行集 ⊆ 金标"（只许收窄，新增行人工审+理由）；**可表达优先**（squash 索引集一次定终身）：idemKey 索引名用 Prisma 派生名 `GenerationIntent_idemKey_key`（`@unique`）/idempotencyKey **去 partial 改 `@unique`**（PG 唯一索引 NULL 默认不冲突=与 WHERE IS NOT NULL 语义等价，进 datamodel）/四个新性能索引（running_deadline/heartbeat/running_user/settle_user_month）**改普通 `@@index`**（性能索引语义不受 partial 影响）+补 `@@index([status,completedAt])`（settleStranded 扫描+清理）与 `@@index([projectId,nodeId,status,createdAt])`（claim② 同内容最新回放） | master 实测非空——"输出空"硬断言在 T1 不可达且处在旧目录已移出的不可逆位置⇒诱逼绕门禁；报告三"partial/CHECK 产 DROP 行"论据证伪（diff 词汇外不产出行——金标仅 1 行非 9+2） |
| Z108 | **spec §10 同 commit+指标 8 增 1 删**：T1/T2/T3 Files 各补 Y0b spec 文件（§10 env/metric 双向门禁——缺/多均红）；指标精确口径=**8 增**（exec_outbound_duration_seconds/intent_deadline_exceeded_total/exec_sync_pending_total/ai_artifact_discarded_total/intent_claim_result_total/execution_group_duration_seconds/exec_poll_stall_total/**yjs_snapshot_fallback_total**）+**1 删**（yjs_sv_wait_timeout_total）；snapshot_fallback_total 定义在 **store.metrics.ts**（yjs_snapshot_read_total 同族 :82——*.metrics.ts glob 收进）；**Y0b spec 是 canonical 文档——每次 spec 变更同 commit `node scripts/doc-gate.mjs --write-canonical`**（canonical-drift 红 verify） | check-spec-consistency 双向判据+metric 源=*.metrics.ts glob（实测）；spec §10 现状零 EXEC_ 键+yjs_sv_wait_timeout_total 在 :811（实测）；T2"五名"与实际七名差 2 必红 |

### 0.4quater 第五轮终裁（Z109-Z118——2026-10-09 三报告落点核验+maxStalledCount 裁决；共同失效模式="裁定—正文—工具面三处不同步"+"结构件选对、落点挂旧物"）

| # | 裁定 | 一句话理由（一手证据） |
|---|------|----------------------|
| Z109 | **Z103 接线修正**：claim 入参拆 **`gestureToken?: string`（只收客户端原始入参——idemKey 消费）**与 **`intentId: string`（服务端 randomUUID 铸造的行身份——`@@unique([projectId,intentId])` 消费）**两字段；execution.service 三处 `isFirstExec ? intentId : undefined` 门（:148/:222/:302）**随 T1 删**+客户端原始 id **无条件透传**+**token 整批施加前移 T1**（intentId 已服务端铸造⇒整批同 token 不撞复合唯一——v2.1 不能整批的原因消失）；`normalizeRegenToken` **随 T1 落**（gestureKey TEXT 在 T1 窗口是客户端可控无界字符串——超长/非法⇒截断+warn 非 400 破兼容，T6 转严格；注释写清 join('\|') 无注入：token 是末段且前置字段均不含 `\|` 且带 regen: 前缀⇒结构性无碰撞）；T1-T6 窗口 wire 注释（intentId=手势 token 非行 id——DTO/Swagger 钉死防新调用方拿它查 intents 端点）；T1 红测**直调 service/enqueue**（面板 T1 期每次点击仍铸新 id〔intentRecord 未退役〕⇒claim② 面板路径不可达——走 UI 测②会误判"回放没生效"）；T1 Files 补 `execution.service.ts` | execution.service:53 `intentId: intentId ?? randomUUID()` 实测——claim 的 input.intentId **永远非空**（服务端兜底铸造），直接接 token 位=①token 段恒命中 regen:uuid⇒claim②③ 结构性死代码〔裁定 3 失效〕②每次重试新 uuid⇒每次新行新扣费——比它要修的问题更严重 |
| Z110 | **maxStalledCount:0 撤销**：保留现状 `@Processor(..., { maxStalledCount: 1, lockDuration: 60_000 })`（两 processor :10-12/:35-37）；**把安全链写成注释**："stall→BullMQ 同 jobId 重排→claim 分支②可重入→reserve 门 alreadyReserved→mayCall:false（Z35 结构门）→静默退出零外呼——重复 submit 结构性不可能；maxStalledCount=1 的代价=真死 worker 时任务悬挂由 deadline reaper 收敛（用户等 deadline）；改 0 的代价=lock 过期≠进程死：活 worker 被置 FAILED⇒complete CAS=0⇒平台已付费产物丢弃"；**claim ⓪ 合取固化与并发红测保留**（Z104 其余部分有效）；maxStalledCount:0 与其"改 processor 装饰器"方案登记驳回 | processor:10-12 既有注释自证"防双跑双扣——扣费幂等由意图表 intentGuard 兜底"——报告二的撤销论据被代码注释自证；queue-options=JobsOptions 落点错论断成立（agent 实测两文件 attempts:1）但随撤销消解 |
| Z111 | **守卫 fail-closed 完整形态**：判据**两子句+缺字段即拦**——`typeof incoming.attempts !== 'number' ⇒ drop（计数 exec_projection_dropped_total）`+`incoming.attempts < stored.attempts ⇒ drop（严格更老一律丢，不看终态——否则老代 error(1) 覆盖新代 loading(2)，用户在 attempt2 在飞时看到 error 去点重试）`+`equal ∧ stored 终态 ⇒ drop（原意图）`；attempts **必填**（patch 类型编译级；claim 前请求级投影〔plan 校验/UNKNOWN_NODE_IDS/reserve 失败〕传 **attempts:0**——"0 代不得覆盖任何 ≥1 代"注释钉死）；`stored.attempts ?? 0` 兜改动前遗留 doc 条目；**11 处生产调用点全量补**（execution.service :69/155/193/228/261/308/343/376+execution.processor :58+ai-image-edit.processor :225/254——实测零 attempts）；**failed 钩子先 findByActiveNode 后写投影**（现 processor :58 写 :61 查——"同 patch 携 attempts"在该点结构做不到必须换序，携 `running?.attempts ?? 0`）；census 锚 `writeExecStatus\(` 同窗口必含 attempts；红测三条（无 attempts 迟到 error 被拦〔改前红=照写〕/error(a1)→rearm 后 loading/done(a2) 可写/老代 error 不覆盖新代 loading） | JS 语义 `undefined <= 5` 为 false⇒不拦⇒写入放行（null<=5 true⇒拦）——v2.3 单子句判据 fail-open；11 处调用点实测全不带 attempts ⇒ 洞从缺字段路径复活 |
| Z112 | **Z106 分治（UX 投影/钱事实）**：**UX 投影不得成为装载源**——reaper 投影前判 `gateway.isDocResident(projectId)`（documents.has）：常驻才写；非常驻**跳过+`exec_projection_deferred_total` 计数**，用户重连时由 alignExecFromIntents 对齐（T6 激活——正是它的职责）；**钱事实（settleStranded 探测）允许强制装载但有界**：每次 sweep 限探测条数+`yjs_doc_loaded_by_reconciler_total` 计量（heap 闸原因可归因）；errorCode 两码分诊（`INTENT_DEADLINE_EXCEEDED`〔deadline 批=provider p99 越界〕/`INTENT_STALE_REAPED`〔心跳龄批=进程/调度异常〕——runbook 处置行分列）；红测两条（无连接项目收敛⇒退款成立∧**doc 未装载**∧deferred+1∧重连后投影 error；有连接项目⇒投影即时可见） | writeExecStatus 走 withDoc（装载）——被 reaper 收敛的意图典型场景=用户已关页（doc 非常驻）；provider 故障⇒一批 RUNNING 同到 deadline⇒批量装载⇒装载配额被后台吃⇒熔断⇒全站降级=故障自放大（正撞 E39/heap 闸） |
| Z113 | **T8 admin 幂等重构**：**全文清剿 skipDuplicates**（T8 标题/Step 2/红测④/commit message 四处 v2.2 残留——按 T8 落地=撤销 Z100 资金修复：mutate :91-94 先加钱后 :95 写行，吞唯一冲突=钱包已变流水缺失）；形态=**`pg_advisory_xact_lock(hashtext('admin:'+key))` → lockBalance → findFirst(idempotencyKey) → 命中⇒回放（指纹比对 type/amount/creditType/operatorUserId——不一致 409 IDEMPOTENCY_KEY_REUSED）/miss⇒原样 create**（Z100 前置查对**并发同键无效**——两方都 miss⇒后者撞唯一⇒事务 abort 500；advisory 锁收并发窗——admin 幂等路径唯一取锁者无 ABBA）；**`replayed:true` 与 noop 语义分离**（仓内 noop=零额不写行——混用调用方分支错）；红测"**并发同键恰一行台账+两次同一 transactionId**"+"同 reversesId 二次入账仍抛错（backstop）" | 同一机制两处实现（T1 Z100 vs T8 v2.2 旧文）——执行者按更靠后更具体的 T8 落地 |
| Z114 | **T1 DDL/datamodel 机械对账**：①起草稿**删 `GenerationIntent_status_completedAt_idx` 行**（init:1092 已存在——Step 6 `already exists` 硬停；Z107"补 @@index([status,completedAt])"标注**假新增**防再抄）；②Step 2 补**删 `@@index([status, updatedAt])`**（schema:1009 声明在——不删则 diff `[+]` 行棘轮红）；③**三个性能索引（deadlineAt/heartbeatAt/(teamId,userId,reservedCredits)）保持 partial**（migration-SQL-only）——**第四轮"普通化"撤销**：partial 零棘轮成本（实测 diff 词汇外）+普通化有"reaper 查 RUNNING 却扫终态旧行⇒计划器弃用"风险；进 datamodel 的只有 idemKey（@unique 派生名）/idempotencyKey（@unique）/`projectId_nodeId_status_createdAt`（普通——claim② 跨状态）；Step 0 探针补**与 y0b1 既有 frozen partial 冗余核对** | init:1092 实测已存在；schema:1009 实测在；partial/CHECK 不进 diff 词汇（第四轮实测）——为不存在的债付计划器风险 |
| Z115 | **棘轮脚本化**：`scripts/check-migrate-diff.mjs`（照抄 check-pricing-coverage.mjs:17-26 范式：.env 取 DATABASE_URL+建/删临时 shadow+结构性错误 exit 2）**进 package.json verify 链**；`--update` 重生成 allowlist；**allowlist 存逐字归一化后的 diff 行**（非裸索引名）且与提取器**共用同一归一化函数**；master 实测输出原样贴 commit | v2.3 Step 9 的 `diff <(sort allowlist) <(grep '\[-\]' ...)` =集合相等+金标裸名 vs diff 渲染列清单**永不匹配**；一次性命令没有再执行点="只许收窄"无人保证 |
| Z116 | **checker 混合制+夹具补全**：生产代码位置制维持（guard/真值表集中性）；**测试文件（\*.spec.ts/test-utils）改能力制**——窗口（800 字符）内含 `runInTx(`/`ledgerTx(`/`SET LOCAL app.ledger_tx` 即放行；**wipeForTests 从 credit-ledger 移除**（消垫片——test-utils 自持 `ledger.runInTx(tx=>tx.teamCreditTransaction.deleteMany(...))`）；`deleteTeamsWithPass` 用 **deleteMany 幂等**（`{ id: { in: ids } }`——删 catch 掩码后 delete 撞 P2025 会把 afterAll 异常算该文件失败）；**checker 改动同批带 test**（check-ledger-single-writer.test.mjs 在 verify node --test）；夹具清单补 **credit-ledger.int:104（teamBalance.delete().catch）与 generation-intent.int:139（teamBalance.deleteMany）**+Step 0 普查正则补 `delete\|deleteMany\|upsert`（现正则看不见 delete*）；catch 掩码**收窄**（台账/team 删禁掩码；media/project 非台账 best-effort 保留+注释） | 位置制逼出 wipeForTests 生产方法垫片（安全需求=写必须持通行证——触发器 DB 层已强制）；两处 teamBalance 直删实测漏网 |
| Z117 | **env/谓词写边界**：①admin **toggle active 与写 apiKey 路径一律用 `ready` 谓词**（不满足 400 `MODEL_NOT_READY`）——启动断言只是启动瞬间快照，运行期 admin 可造 executable∧!ready 行（model.service :30/:51 写 apiKey+:55-58 toggle 实测）；admin 列表"不可执行"标记用 ready（面向运维看密钥）；②**EXEC_MAX_NODES 整体移 T8**（键+DTO 长度校验+spec 行同 commit——键随读者同批；T2 扩前缀后 T2-T7 死键红；env.ts:56-57 自注纪律；豁免表兜=垫片）；③**EXEC_DEFAULTS 常量表单源**（zod `.default(EXEC_DEFAULTS.X)` 从表取+读点**字面量** `process.env.EXEC_*`〔方向②只认字面量实测——zod 解析值消费=9 死键红〕+HARD_CAP 默认常量与 nginx 检查共用）；④**`check-nginx-budget.mjs` 进根 verify**（deploy/ 件门禁归属根 scripts——apps/api 单测写 ../../ 路径且归属不符） | 报告一 P1-6/7+报告二 P1-3+报告三 P1-2/7/P2 合并 |
| Z118 | **杂项收口**：夹具配方 `creditType: 'regular'`（enum CreditType={regular,subscription} 实测无 'credits'——v2.3 笔误 TS2345）；Z103"永久自锁"表述修正（intentRecord:21-22 INTENT_CONTEXT_MISMATCH/EXHAUSTED 返回文案=客户端 rotate 逃生门实测——红测仍成立改理由为"409+rotate 的体验仍劣于新行"）；T6 动机补 **lastSubmitRef 刷新丢失**（ImageConfigPanel:97/ImageGenNode:628/PreviewPlayer:57 的 ref 记忆刷新即丢⇒失败后刷新再点=新 id 新扣费——held 一律上送〔sessionStorage〕正好修它——写成 T6 显式动机与红测）；**check-int-coverage pathspec 一行修根级**（`git ls-files "apps/api/src/**/*.int.spec.ts" "apps/api/src/*.int.spec.ts"`——修门禁而非"放子目录"绕）；新 int 保持 `(hasDb ? describe : describe.skip)` 约定（判据③ numPendingTests===0）；T0 跨月用例 bounds 读口=`getBalanceView(teamId, bounds?)` 可选参（derivedMonthlyUsed 是 private）；**Z102 反向锚**（checker：execution.service 禁 `rollbackStranded`——判龄入口只许 reaper/settleStranded）；video-project 表述改"**进程内直调**（service:90-102）不经 controller——SV 门天然不在覆盖面（执行输入全由服务端从 doc 读=豁免理由成立，既成事实进偏离表）"；Σ 计算与 SV 门**共用同一次 doc 读**+`deadlineForKind` 单源位置=exec 配置模块；§0.5 基线快照过期行同步 | — |

**第五轮驳回/证伪登记**：①**maxStalledCount:0 及"改 processor 装饰器"方案**（报告一 P1-2/报告三 P0-1）——撤销论据被既有注释自证（扣费幂等由意图表结构门兜底）；0 的代价（误杀活 worker=平台已付费产物丢弃）大于收益（重复 submit 已结构性不可能）。②**报告三"12 处 writeExecStatus"**——实测生产 11 处（execution.service 8+两 processor 3；报告含 spec 计 12）。③**报告二"两个目标文件名不存在（无 *.queue-options.ts）"**——实测存在（两文件 attempts:1）——但"queue-options=JobsOptions 落点错"结论仍成立。④**y0b1:51 frozen partial（WHERE reservedCredits>0）形态存疑**（本轮 Agent 在 init 侧未发现——报告二引自 y0b1 迁移）：T1 Step 0 探针核对与新 (teamId,userId) partial 的冗余性，不影响裁定方向。⑤**报告一 P1-3（partial 保持）对 v2.3 Z107 普通化的修正成立**——普通化撤销（Z114③）。①报告三 P0-1 机制论据（"schema 不声明 partial unique/CHECK ⇒ diff 恒有 DROP 行，金标 9+2 行"）——**结论对（非空）论据证伪**：master 实测 diff 仅 2 行且唯一 DROP=普通唯一索引 pricing_rule_natural_key；带 WHERE 的 partial 与 CHECK 在 Prisma diff 词汇外**不产出行**。②报告二 P1-8（"T7 删 sv-wait.metrics.ts ⇒ doc-gate 必红"）——**证伪**：collab-delete-persist-fix.md **非 canonical**（doc-gate :382 非 canonical 仅警告 continue）；canonical 的 Y0b spec 只提指标名无文件路径（codeRef 正则不匹配）；dead-symbols/exemptions 零命中。③报告三 P1-7（"CI int 撞 fail-closed 断言必红"）——**条件句不成立**（全仓 12 个 int spec 零 `.init()`/`createNestApplication` 实测——compile 不触发 onModuleInit）：CI collab-core job 显式 `COLLAB_FAKE_AI=1` 作无害兜底**采纳**（防未来有人加 .init()）。④报告二 P1-2 夹具"7 文件"——实测 generationIntent.create 19 处/**4 文件**（team.delete 6 文件 12 处 ✓）。⑤报告三 `scripts/y0b2-squash.mjs` 跨平台脚本化——**不采纳**（本机 git-bash+psql 实测可用〔本轮核验即用其建/删临时库〕；YAGNI——Step 0 加"bash/psql 可用性"探针即可）。①**deliveredAt 列恢复**（R3-P0-4）——Z17 status 判据=Y0b-1 终裁；Z76 收窄后套利与"退款后交付"两资损方向同灭（reaper 不再触碰 SUCCEEDED 行；rollbackIntentFunds 的 SUCCEEDED 臂唯一入口=written:false 即无产物写入）；未交付行由重放补投影兜底。②**两键制 contentKey+gestureKey 双列双索引**（R3-P0-2）——gestureKey 与 regenToken 是同一事物（客户端手势 UUID），拆两列多一索引一套三步判定换零表达力；内容维度可查询性由 claim ②的普通列查询承担（`@@index([projectId,nodeId,status])` 已覆盖）。③**writeFrozen 本批接线**（R2-P1-6）——Z55 已裁定（权威状态位默认 false 无害、Y0b-5 接线）；gateway 无 resumed 下发+drain 窗口 60s dev 期可忽略；drain 窗口点击行为（writeNodeData 503+回滚）登记 T9 残余。④**门读与计费读合并 withDoc**（R3-P1-6）——发起方必有 WS⇒doc 常驻⇒withDoc 是内存级 Map 查找；两次读间服务端只增不减无一致性险。⑤**模型缓存 5min 缩短**（R2-P1-8）——resolver 判活在 claim 真库新鲜查=杀开关闸门；缓存仅服务 claim 后外呼面不拦新执行。⑥**attempts 农场本批修**（R3-P1-2）——属实但属限流域（Y0b-4/Y0.5 速率闸/每节点时间窗上限）；登记残余。⑦**DashScope 编辑链建 4 行 AIModel**（R3 子报告主案）——见 0.1bis（例外登记制）。⑧外审事实勘误留档：R1-P0-2"verify 必红"机制错（checker 对缺 lockBalance 是漏报非误报——已按正确机制采纳并加固 checker）；R2-P1-2"outboundDuration 含排队时间"不成立（直方图本就包 call 域）；R1-P1-8"四编辑入口"实为三入口已接线（lighting 前端 LightingModal TODO 未接线——lighting 仅服务端链）。

---

## 0.5 基线快照（v2.1 增补——2026-10-09 第二轮一手核验；行号以 master=be51fe31 为准）

| 位置 | 现状 | 消费 Task |
|------|------|-----------|
| `schema.prisma:201-220` | AIModel 无 modelName 列；provider String 自由文本；apiKey String? 全 NULL | T1/T2 |
| `y0b1 migration :75-80` | provider 值=显示名（'腾讯混元'/'Stability AI'/'OpenAI'/'Moonshot AI'/'Tencent Maas'）；sdxl/gpt4 recommended=true、三模型 active=true | T1 |
| `y0b1 migration :117-120` | outpaint/erase/redraw/lighting 四键 kind 级 PricingRule（modelId NULL，1 credit） | T1/T2（例外登记依据） |
| `api-caller.service.ts:53-72` | MODEL_CONFIG 三键（DB id）+硬编码 sk- 密钥+modelName（'kimi-k2.6'/'hy-image-v3.0'/'hy-video-1.5'）；`:249/:273/:326` 发 `config.modelName` | T2 |
| `seed.ts:65-66` | `apiKey: process.env.HY_IMAGE_API_KEY` 写入 AIModel.apiKey（**env 名未进 envSchema**——归并改名对象）；:51-61/:105-109 三模型 upsert `update:{}`（create 分支无 active/recommended=默认回 true 的翻转源）；:117-124 裸 `pricingRule.create`（`as any`） | T1 |
| `credit-ledger.service.ts:42-47/:61-64/:70-74` | runInTx 只 SET lock_timeout；ensureBalance 裸 INSERT ON CONFLICT；mutate 首行 lockBalance | T1 |
| `platform-team.seed.ts:35`+`team.bootstrap.ts:29-35`+`seed.ts:204` | runInTx/ensureBalance 生产调用点（触发器落地即断的三处） | T1 |
| `check-ledger-single-writer.mjs:54-58` | 锚只报"有 lockBalance 且晚于 GI 写"；缺 lockBalance=漏报；`createMany(` 不匹配正则 | T5（checker 加固） |
| `intent-reconcile.service.ts:307-311/:126-131` | settleStranded `TERMINAL∧reservedCredits>0`；A 路径 active/waiting/delayed 零动作 | T4/T5 |
| `team-credit.service.ts:13-16` | currentPeriod=Node 本地时区 `getMonth()` | T8 |
| `normalize-intent-params.ts:8-16` | `erase: []`（白名单空=sha256('{}') 全局常量）；outpaint 无 fileId；redraw 无 fileId/maskFileId；lighting 无图身份 | T6 |
| `ai-image-edit.controller.ts:88/:97/:62-69/:105` | erase `params:{}`（body 带 fileId/maskFileId 稳定）；outpaint body 带 fileId；redraw 加 prompt/strength | T6 |
| `lighting.controller.ts:38-40`+`dto:38-55` | lighting 用 `originalImageId`（无 fileId/maskFileId）；paramsHash 只含 prompt | T6 |
| `video-project.service.ts:85-100`+`video-project.dto.ts:18`+`dto.spec:41` | retakeId=客户端手势键透传 execute 第 6 参（intentId 位）；"服务端兜底=每次新 id=重放无幂等"判词+缺 retakeId 拒绝红测试 | T6（retake=token 语义重定位） |
| `transform.interceptor.ts:22-28`+`main.ts:92` | 无条件包 {code,data,message}；@NoTransform 全仓仅 recharge.controller:13 | T6 |
| `execution.controller.ts:59`/`ai-image-edit.controller.ts:49`/`lighting.controller.ts:46/52/56/69/71` | 手包 6 处（:69=404 分支外审漏计） | T6 |
| `client.ts:32-37`+`canvasCollabRuntime.ts:203-207` | apiFetch 返 json.data；`rows?.[0]`=undefined⇒alignExecFromIntents 静默 no-op；:206-207 消费 latest.intentId | T6 |
| `executionApi.ts:10`+`PreviewPlayer.tsx:65` | executeGroupNodes 类型 `errors: string[]`；PreviewPlayer 真消费 `result.errors?.[0]`（重拍失败文案） | T5/T6 |
| `execStatusView.ts:5/:35`+`collab-document.service.ts:127-128` | NodeExecStatus 四值无 skipped；selectExecStatus(s,nodeId)；终态守卫只认 done/error | T5 |
| `collab.gateway.ts:664` | drain 期发 write-frozen（write-resumed 全仓零命中） | T7（Z55 维持+T9 登记） |
| `deploy.sh:46/54/69/:171-172` | preflight 收据=git SHA；REBUILD_DB 清迁移目录注释自证"不清=旧目录字典序先跑必炸" | T1（步骤序） |
| `vitest.config.ts:10`/`vitest.int.config.ts:10-11` | 单元池排除 int 且无 setupFiles/DATABASE_URL；int 池仅 `*.int.spec.ts` | T2（断言拆三件） |
| `check-spec-consistency.mjs:29-32` | stripForDenylist 剥 HTML 注释/围栏/全角括号——不剥行内反引号 | T7 |
| `dump-schema-objects.mjs:16-29/:51-52` | dump 六组对象+CollabLease 计数（零数据行）；--replay-new CREATE DATABASE 需 CREATEDB | T1 |
| `funds-four-way.int.spec.ts:113-114` | G-1 夹具用 gpt4+sdxl（断言全关系式——换 kimi/hy-image 两行改动） | T1/T2 |
| `ImageGenNode.tsx:620-688`+`LightingModal.tsx:88-91` | outpaint/erase/redraw 三入口经 handleGenerate（mask 先 presign+confirm）；lighting 前端 TODO 未接线 | T6 |
| `apps/api/prisma/verify-indexes.sql` | 实际路径（v2 误写 scripts/） | T1 |
| `credit-ledger.service.ts:49`+14 调用点 | `tx()` 纯品牌转换（无 SET LOCAL）；生产调用 14 处/8 文件：team-credit:62/128/179、intent-reconcile:195/227/357、team.bootstrap:29 已知，**team.service:62/:431、team-recharge:141、team-subscription:72/138、admin-subscription:71、personal-team-ledger:55/73（+四 processor 调用方）v2.1 漏列** | T1（Z89） |
| `schema.prisma:711`+`team.service.ts:419-431` | TeamBalance.teamId `onDelete: Cascade`；解散事务裸 `$transaction`（:419 仅 lock_timeout）内 `tx.team.delete()` ⇒ 级联 DELETE 触发器必炸 | T1（Z89） |
| `execution.types.ts:1-11`+`execution.controller.ts:40-46`+`execution.processor.ts:29-32` | ExecutionJobData 含 sv?/intentId?（无 regenToken）；enqueue 读 body.intentId 入 job.data；processor 第 6 参传 execute | T6/T7（Z91） |
| `executionApi.ts` 消费面+`ImageGenNode.tsx:662-666/:215/:630/:670` | Text:152/Video:200/Audio:144（不传 intentId）/imageNodeApi:63/imageExtNodeApi:71 全走 enqueueWorkflow；CanvasView:746 唯一 executeGroupNodes；编辑三入口**裸 fetch**；lastSubmitRef:215/newIntentId:630/intentRotateMessage:670 | T6（Z91+裸 fetch） |
| `PreviewPlayer.tsx`（实际路径 **video-editor/components/**）+intentRecord 三导出 | currentIntentId:58/newIntentId:59,73/intentRotateMessage:71/retakeId 多处/errors:63,65；intentRecord 导出 newIntentId/currentIntentId/intentRotateMessage——六消费文件（ImageGenNode/ImageExt/Video/Image/TextConfigPanel/PreviewPlayer） | T5/T6 |
| `ecosystem.config.cjs:5`+`deploy.sh:118`+`.github/workflows/ci.yml:177` | NODE_ENV=production **从不设置**；CI 跑 test:int:ci 且密钥 env **零注入**（仅 DATABASE_URL/REDIS_URL/MINIO 占位） | T2（Z93） |
| `client.ts:13-18`+`deploy/nginx/`（仅 collab 段） | apiFetch 无 timeout/signal；`/api` 段 nginx 配置**不在仓内**（仅 /collab 有 proxy_read_timeout 300s）——整条同步链唯一墙钟未知 | T8（Z90） |
| `req.on('close')/aborted` 全仓 | apps/api/src **零命中**（仅 PG 注释）——服务端不因客户端断连中止 handler=期间不变量 | T8（Z90 注释锚） |
| 4 个 spec 文件 | intent-reconcile.service.spec:12/164/216/258/293（monthlyPeriod 断言）、team-credit.atomic.spec:104-107/266-267（CAS/decrement 逐字断言）、team-credit.service.spec:50-63（惰性重置用例）、team.service.spec:441/457（listMembers mock 含 monthlyUsed:30）——T0 删写点全破 | T0（Z96） |
| `generation-intent.service.ts:97` | `attempts>=3 throw IntentExhaustedError`+REARMABLE=['FAILED','VOIDED'] updateMany——attempts 只在同键重入时自增 | T6（Z95） |
| `api-caller.service.ts:111/286/342` | 硬编码轮询上限 30×2s/30×2s/60×3s（=60/60/180s 有界）——T2 改 deadline 驱动后墙钟升 300/900/1800s（停滞出口需接管） | T2（Z90） |
| `team-credit.service.ts:203-208`+`intent-reconcile.service.ts:250-253` | unfreeze/refund 均有 monthlyUsed decrement（带 monthlyPeriod=currentPeriod 守卫）——**T0 原红用例①"同月退款不回落"系假红门** | T0（Z96） |
| seed AIModel upsert+迁移 INSERT | seed upsert where by id+update:{}（create 分支 fresh-rebuild 永不触发——迁移 INSERT ON CONFLICT DO NOTHING 先建行）；AIModel INSERT 实际在 y0b1:74-81 非 init | T1（双钉理由修正） |
| `normalize-intent-params.ts:8-16`+`ai-download.processor.ts:116` | image/video 白名单无 fileId ✓；fileId 由下载 worker **异步**回写节点——claim 时刻新生成节点无 fileId（主链禁入哈希的实证） | T6（注释钉死） |

---

## Task 0: monthlyUsed 派生化先行（独立 commit——Z96：expand/contract 的 expand 侧，列暂留无读者，main 全绿）

**Files:**
- Modify: `apps/api/src/modules/team/team-credit.service.ts`（`import type { Prisma }` 补+derivedMonthlyUsed CTE+两读点改道+两写点删+currentPeriod 删）、`apps/api/src/modules/execution/intent-reconcile.service.ts`（monthlyUsed decrement 两写点删 :210-213/:250-253+currentPeriod import 删）、`apps/api/src/modules/team/team.service.ts:161-173`（listMembers 第三读点——**两条 GROUP BY 批量聚合**）、`apps/web/src/api/teamApi.ts`（`TeamMemberRow.monthlyUsed` 保留〔值来自派生——响应字段是契约不删〕+**`monthlyPeriod` 字段删**——T1 删列后幽灵）
- Modify（Z96 补——T0 删写点全破的既有断言）: `intent-reconcile.service.spec.ts`（:12 import+:164/216/258/293 monthlyPeriod updateMany 断言删/改）、`team-credit.atomic.spec.ts`（:104-107/:266-267 CAS/decrement 逐字断言改）、`team-credit.service.spec.ts`（:50-63 惰性重置用例删——惰性重置随写点消失）、`team.service.spec.ts`（:441/457 listMembers mock 期望形状改派生）
- Test: Create `monthly-used-derived.int.spec.ts`

- [ ] **Step 0: 只读探针**

```bash
grep -rn "monthlyUsed\|monthlyPeriod" apps/api/src apps/web/src --include="*.ts*" | grep -v spec   # 写点 4+读点 3+类型面全集（Z96 普查基线）
grep -rn "currentPeriod" apps/api/src --include="*.ts"                                              # 消费者全集（team-credit:13/33/74/205+intent-reconcile:8/211/251+spec 五处——改道后生产消费者应归零）
grep -rln "teamBalance\.create\|teamBalance\.update\|\$executeRaw" apps/api/src --include="*.int.spec.ts"   # T1 夹具改造清单基线
```

- [ ] **Step 1: 红用例（Z96 重写——三条判别性红相；原用例①"同月退款回落"系假红门已删：现行 unfreeze:203-208/refund:250-253 decrement 写点存在，改前即绿）**

```ts
// monthly-used-derived.int.spec.ts（真库）
/** 夹具纪律（Z96）：一律 ledger.runInTx(ensureBalance/mutate) 通行证写法（funds-four-way:36-53
 *  既有范式"T5 教训"）——禁直写 teamBalance/禁裸 raw 台账写/禁给 monthlyUsed/monthlyPeriod 赋值
 *  （本 spec 要证明的恰是"派生值与旧列无关"）；意图行用本地 helper（createIntentFixture 留 T1）；
 *  跨月回填=月界参数注入（bounds 可选参）非裸 UPDATE createdAt；afterAll 登记 teamIds/userIds/projectIds
 *  三件+id 后缀化防上轮失败残留自撞（funds-four-way:33 纪律照抄）。 */
describe('Y0b-2 T0：monthlyUsed 派生化', () => {
  it('①成员移除后重加入 → 派生保留本月已用量（改前红：TeamMember 行删重建 monthlyUsed 归零=配额宽恕；口径翻案显式固化——spec §9.18"计数残留"语义升级为"真实用量保留"）', async () => {
    await settleOne(teamId, uid, 10);
    await removeMember(teamId, uid); await reAddMember(teamId, uid);
    expect(await viewUsed(teamId, uid)).toBe(10);   // 台账行按 operatorUserId 聚合——行还在
  });
  it('②跨月归因判别性（第四轮修正）：上月 settle 本月 refund → 本月用量 0 且**上月视图（传 lastMonthBounds）回落**——真正测 refund 腿的月份归因（"本月=0"在任何实现下都绿=非判别）；跨月回填必须 GUC 包裹 raw UPDATE（T1 前无害占位/T1 后通行证——**bounds 参数注入造不出跨月 refund 场景**，settle 行 createdAt 必须物理回填；WHERE 必须带 teamId——checker 规则③）', async () => {
    await settleInLastMonth(10); await refundNow();
    expect(await viewUsed(bounds = thisMonth)).toBe(0);
    expect(await viewUsed(bounds = lastMonth)).toBe(0);   // 上月视图：10-settle 被 refund 抵扣回落
  });
  it('③活跃冻结计入（谓词=reservedCredits>0 **非 status='RUNNING'**——第四轮修正：complete→settle 窗口 status 已 SUCCEEDED 而钱仍冻结，按状态门控会让 used 瞬间回落；且 frozen 腿**不受 bounds 约束**恒计当前在飞——有意的不对称写注释：上月 reserve 至今 RUNNING⇒本月用量含它、上月视图不含它）+complete 后 settle 前 used 不减（窗口用例）+月界北京时区单源（月界恒北京时间月首 0 点——process.env.TZ 注入任意值断言月界不变）', async () => { /* reserve+窗口+边界 */ });
});
// 附：amount 四 type 符号回归锚（reserve/settle 负、release/refund 正——防未来改真值表时静默改掉退款符号）。
```

- [ ] **Step 2: 绿——derivedMonthlyUsed（Z86+Z96 修订：CTE 单语句+北京时区月界+类型收窄）**

```ts
// team-credit.service.ts 顶部补：import type { Prisma } from '@prisma/client';
/** 月界单源（Z86 修订：业务时区=Asia/Shanghai 固定 +8 无 DST——纯 UTC 会使配额在每月 1 日 08:00
 *  重置，产品语义错；Date.UTC 计算后平移 -8h，消灭 Node 本地时区 vs Prisma naive UTC 的错位）。 */
export function currentPeriodBounds(now = new Date()): [Date, Date] {
  const bj = new Date(now.getTime() + 8 * 3600_000);                     // 平移到东八区视角
  const y = bj.getUTCFullYear(), m = bj.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1) - 8 * 3600_000);              // 北京月首 0 点
  const next = new Date(Date.UTC(y, m + 1, 1) - 8 * 3600_000);
  return [start, next];
}
/** Z70/Z86/Z96：月度用量派生——settle+refund 净额 CTE 单语句（JOIN 内联免 Prisma.join/参数上限；
 *  冲销行归因被冲销 settle 行月份〔refund 无时间条件〕+frozen 独立查询=2 往返。
 *  settle 归因=settle.createdAt（禁经 reversesId 改挂 reserve 时间——跨月订单会归错月）。
 *  事务内必须传 tx（交互式事务内 this.prisma 另开连接=死锁+看不到未提交写）。
 *  quota 判定必须在 lockBalance 之后读且所有写者遵守契约 20 才有意义（Z96 残余②注释）。 */
private async derivedMonthlyUsed(tx: Prisma.TransactionClient, teamId: string, userId: string, bounds?: [Date, Date]): Promise<number> {
  const [start, next] = bounds ?? currentPeriodBounds();
  const [row] = await tx.$queryRaw<{ settled: bigint | null; refunded: bigint | null }[]>`
    WITH s AS (SELECT id, amount FROM "TeamCreditTransaction"
               WHERE "teamId" = ${teamId} AND "operatorUserId" = ${userId} AND type = 'settle'
                 AND "createdAt" >= ${start} AND "createdAt" < ${next} AND amount < 0)
    SELECT (SELECT COALESCE(SUM(-amount), 0) FROM s) AS settled,
           (SELECT COALESCE(SUM(t.amount), 0) FROM "TeamCreditTransaction" t
            JOIN s ON t."reversesId" = s.id WHERE t.type = 'refund') AS refunded`;
  const [frozen] = await tx.$queryRaw<{ s: bigint | null }[]>`
    SELECT COALESCE(SUM("reservedCredits"), 0) AS s FROM "GenerationIntent"
    WHERE "teamId" = ${teamId} AND "userId" = ${userId} AND "reservedCredits" > 0`;   // 第四轮修正：列语义（与 generation_intent_frozen_partial 同谓词）非状态——complete→settle 窗口冻结不回落；frozen 腿不受 bounds 约束（有意不对称）
  return Math.max(Number(row.settled) - Number(row.refunded), 0) + Number(frozen.s);
}
```

读点改道三处：getBalanceView（used——**Z118：加可选 `bounds` 形参**供跨月用例直读〔derivedMonthlyUsed 是 private〕）、reserve quota 判定（**传 tx**+注释钉死"lockBalance 之后读"）、listMembers（**两条 GROUP BY 批量聚合**：`GROUP BY operatorUserId` settle 净额+`GROUP BY userId` 冻结〔**谓词同 reservedCredits>0 单源**——一个 SQL 片段/一个方法返回 Map，单成员读=批量读特例+`getBalanceView.used === listMembers.used` 一致性红测〔Z118/第五轮 P1-3〕〕）。写点全删四处+惰性重置删。`currentPeriod()` 删（改道后生产消费者归零——月界唯一源=currentPeriodBounds）。

- [ ] **Step 3: 全量 int（Z96——used 语义扩大：RUNNING 冻结立即计入，既有夹具的 RUNNING 行会影响他 spec 的 quota 断言——红因指向语义变更非缺陷，commit message 留档）+commit**

```bash
pnpm --filter api test          # 单元池：4 个改造 spec 全绿（tsc 前置含 Prisma import 面）
pnpm --filter api test:int      # 全量（不只新 spec）
git add -A && git commit -m "feat(y0b-2): T0 monthlyUsed 派生化先行（独立 commit=expand 侧）——CTE 单语句+北京时区月界+三读点改道（listMembers 批量聚合）+四写点删+currentPeriod 退役+四 spec 同批改（红相三条：成员移除保留/跨月归因/冻结计入；假红门'同月退款回落'已删——现行 decrement 存在改前即绿；通行证夹具纪律留档）"
```

（验收〔Z96〕：T0^ 与 T0 两 commit 上 `pnpm --filter api test` 均绿——中间态非"注定要红"；T1 内夹具一行替换后本 spec 仍绿。）

---

## Task 1: schema squash 一次到位+不变量消费者同 commit（claim 最小 idemKey+ledgerTx 统一+AIModel 列+夹具工厂）

**Files:**
- Create: `apps/api/prisma/migrations/20261009140000_y0b2_draft/migration.sql`（中间文件）、`apps/api/prisma/migrations/20261009140100_y0b2_init/migration.sql`（新 init 手工汇编）、`apps/api/src/test-utils/intent-fixture.ts`（夹具工厂+ledgerWipe 作用域形参）
- Delete: `20261009140000_y0b2_draft`+`20261009031416_init`+`20261009040355_y0b1_funds_columns`（Step 6.5 移出→Step 8 确认删）+**`credit-ledger.service.ts` 的 `tx()` 方法（Z89——普查交 tsc）**
- Modify: `apps/api/prisma/schema.prisma`（终态+**Z114：idemKey @unique/idempotencyKey @unique/`@@index([projectId,nodeId,status,createdAt])` 进 datamodel——三个性能索引保持 partial 不声明；删 `@@index([status, updatedAt])` 行**）、`apps/api/src/modules/team/credit-ledger.service.ts`（runInTx 内置 ledgerTx+**mutate 前置查 idempotencyKey（Z100）**〔wipeForTests 已移除——Z116 测试能力制〕）、`apps/api/src/modules/team/team-credit.service.ts`+`intent-reconcile.service.ts`（SET LOCAL 收敛）、**Z89 消费者改造 7 文件：`team.service.ts`（:62 建团队+解散事务 :419-431 通行证——`tx.team.delete()` 级联删 TeamBalance 触发行级触发器）、`team-recharge.service.ts:141`、`team-subscription.service.ts:72/138`、`admin-subscription.service.ts:71`（+:51 personal-team-ledger 调用点）、`personal-team-ledger.ts`（公开签名收 LedgerTx）、`payment-success.processor.ts:125`、`grant-credit.processor.ts:59`、`expire-subscription.processor.ts:53`（事务首句取通行证）**、`apps/api/src/modules/execution/generation-intent.service.ts`（claim 最小 idemKey 化+**Z109：claim 入参拆 gestureToken?/intentId 两字段**+三列写入）、**`apps/api/src/modules/execution/execution.service.ts`（Z109：claimForNode 拆 gestureToken 透传——:53 `?? randomUUID()` 兜底拆除〔拆到 claim 内部行身份铸造〕+:148/:222/:302 三处 isFirstExec 门删+客户端原始 id 无条件透传+token 整批施加）**、两个 processor（**Z110：maxStalledCount:1 保留——安全链注释改写**）、`apps/api/src/config/env.ts`（zod **十一键**〔EXEC_MAX_NODES 移 T8——Z117 死键〕+**EXEC_DEFAULTS 常量表单源**）、`scripts/check-migration-additive.mjs:14`（BASELINE）、`scripts/check-ledger-single-writer.mjs`（**+`ledger.tx(` 禁用锚+缺 lockBalance 漏报加固+规则②备选集补 `createMany|deleteMany`+测试文件能力制〔Z116〕——同批改 test**）、`docs/superpowers/collab-ops-runbook.md:90`、`apps/api/prisma/verify-indexes.sql`（块集终态重写+块数快照）、`apps/api/prisma/seed.ts`（AIModel create 块钉 active/recommended〔防御性——承重钉=新 init INSERT 值〕+apiKey env 改名+定价段收口）、**夹具改造（Z116 补全：generation-intent/ledger-invariants/credit-ledger/team-lifecycle-funds 四文件 19 处 generationIntent.create+6 文件 12 处 team.delete+**credit-ledger.int:104 teamBalance.delete().catch 与 generation-intent.int:139 teamBalance.deleteMany 两处直删**+台账/team 删的 catch 掩码删〔非台账 best-effort 保留+注释〕+ledger-invariants:55 CHECK 断言 message 匹配**；T0 的 monthly spec 意图行夹具也换 createIntentFixture）、`docs/superpowers/specs/2026-10-08-y0b-funds-and-access-design.md`（**Z108：§10 env-keys 块同 commit 增 11 键+doc-gate --write-canonical**）
- Create: `apps/api/prisma/migrate-diff-allowlist.txt`（Z107 棘轮金标——**Z115：存逐字归一化 diff 行非裸名**）、**`scripts/check-migrate-diff.mjs`（Z115 脚本化进 verify 链）**
- Test: 扩展 `generation-intent.int.spec.ts`+Create `ledger-trigger.int.spec.ts`（含五链路 money-in 冒烟+**Z104 并发红测+Z109 三条红测〔直调 service——面板 T1 期总带新 id，claim② 须走无 token 路径测〕**）

- [ ] **Step 0: 只读探针（输出粘 commit message）**

```bash
node scripts/dump-schema-objects.mjs "$DATABASE_URL" > /tmp/y0b2-before.json    # census 保险基线
psql "$DATABASE_URL/postgres" -c "SELECT 1" && echo "psql/bash 可用（第四轮：y0b2-squash.mjs 不采纳的前提）" || echo "CHECK: bash/psql 环境"
psql "$DATABASE_URL/postgres" -c "SELECT 1 FROM pg_roles WHERE rolcreatedb AND rolname = current_user" || echo "CHECK: --replay-new 与 migrate diff --shadow-database-url 均需 CREATEDB（Z88+Z90 探针）"
# Z107 基线探针（master 原地跑——不可逆步骤前唯一护门）：
psql "$DATABASE_URL/postgres" -c "DROP DATABASE IF EXISTS flowweb_shadow_tmp" && psql "$DATABASE_URL/postgres" -c "CREATE DATABASE flowweb_shadow_tmp"
pnpm exec prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url "$SHADOW_DB" | tee /tmp/diff-baseline.out   # 实测预期恰 2 行（pricing_rule_natural_key DROP）——粘 commit
psql "$DATABASE_URL/postgres" -c "DROP DATABASE flowweb_shadow_tmp"
ls apps/api/prisma/migrations/    # 预期恰 2 目录
grep -n "BASELINE" scripts/check-migration-additive.mjs && grep -rn "20261007170319" docs/ | head -3
grep -n "verify-indexes" package.json   # runner 路径确认
grep -rn "monthlyUsed\|monthlyPeriod" apps/api/src apps/web/src --include="*.ts*" | grep -v spec   # Z96：必须空（T0 已清）
grep -rn "ledger\.tx(" apps/api/src --include="*.ts" | grep -v spec                              # Z89 基线（15 命中=14 调用+1 头注释 :11——本 Task 改造后归零，注释同 commit 改）
grep -rn "generationIntent\.create\|team\.delete\|teamBalance\.\(delete\|deleteMany\|upsert\|create\|update\)" apps/api/src --include="*.int.spec.ts"   # Z97/Z116 夹具普查（19 处/4 文件+12 处/6 文件+teamBalance 直删 2 处〔credit-ledger:104/generation-intent:139〕——粘 commit）
grep -n "reservedCredits" apps/api/prisma/migrations/20261009040355_y0b1_funds_columns/migration.sql   # Z114：既有 frozen partial 谓词核对（新 (teamId,userId) partial 冗余性）
ssh server "nginx -T 2>/dev/null | grep -A12 'location /api'" || echo "CHECK: /api 段现值（Z90——T8 钉仓对照基线）"
```

- [ ] **Step 1: 起草 additive 迁移（本批全部 DDL——Z60 双验证）**

```sql
-- Y0b-2 T1 起草稿（验证后汇编进新 init 并删除本目录）。
-- 心跳与 deadline（Z68/Z83）：显式写入无默认（空表 ADD COLUMN NOT NULL 合法——本地/服务器 2026-10-09 刚重建均无数据）。
ALTER TABLE "GenerationIntent" ADD COLUMN "heartbeatAt" TIMESTAMP(3) NOT NULL;
ALTER TABLE "GenerationIntent" ADD COLUMN "deadlineAt" TIMESTAMP(3) NOT NULL;
ALTER TABLE "GenerationIntent" ADD COLUMN "startedAt" TIMESTAMP(3);            -- Z83：外呼真正开始（phase 判据）
ALTER TABLE "GenerationIntent" ADD COLUMN "idemKey" TEXT NOT NULL;
ALTER TABLE "GenerationIntent" ADD COLUMN "gestureKey" TEXT;                   -- Z79：手势 token 审计列（nullable）
ALTER TABLE "GenerationIntent" ADD COLUMN "providerTaskId" TEXT;               -- Z69：submit 后落库
ALTER TABLE "TeamCreditTransaction" ADD COLUMN "idempotencyKey" TEXT;
-- AIModel 列变更（裁定 5）
ALTER TABLE "AIModel" ADD COLUMN "apiModelName" TEXT;                          -- provider 侧模型 id（active 行断言非空）
ALTER TABLE "AIModel" ADD COLUMN "providerLabel" TEXT;                         -- 显示名（原 provider 内容迁移至此）
-- provider 值改 slug（UPDATE 数据非结构变更——additive 门禁不拦）。第四轮修正：CASE 必带 ELSE——
-- 任何非 seed 行（admin 建过模型 provider=显示名）无 ELSE 会被置 NULL ⇒ NOT NULL 违约整迁移回滚。
UPDATE "AIModel" SET provider = CASE id
  WHEN 'seed-model-kimi' THEN 'moonshot'
  WHEN 'seed-model-hy-image' THEN 'tencent'
  WHEN 'seed-model-hy-video' THEN 'tencent'
  WHEN 'seed-model-sdxl' THEN 'stability'
  WHEN 'seed-model-dalle' THEN 'openai'
  WHEN 'seed-model-gpt4' THEN 'openai' ELSE provider END,
  apiModelName = CASE id
    WHEN 'seed-model-kimi' THEN 'kimi-k2.6'
    WHEN 'seed-model-hy-image' THEN 'hy-image-v3.0'
    WHEN 'seed-model-hy-video' THEN 'hy-video-1.5' ELSE "apiModelName" END,
  providerLabel = CASE id
    WHEN 'seed-model-kimi' THEN 'Moonshot AI'
    WHEN 'seed-model-hy-image' THEN '腾讯混元'
    WHEN 'seed-model-hy-video' THEN 'Tencent Maas'
    WHEN 'seed-model-sdxl' THEN 'Stability AI'
    WHEN 'seed-model-dalle' THEN 'OpenAI'
    WHEN 'seed-model-gpt4' THEN 'OpenAI' ELSE provider END;   -- 旧 provider=显示名，保留最自然
UPDATE "AIModel" SET "active" = false, "recommended" = false
  WHERE id IN ('seed-model-sdxl','seed-model-dalle','seed-model-gpt4');        -- 裁定 5：无外呼实现=不可售
-- 验收：census 断言 SELECT COUNT(*) FROM "AIModel" WHERE provider NOT IN ('moonshot','tencent','stability','openai') = 0

-- Z107+Z114 可表达与 partial 各归其位（squash 索引集一次定终身）：
-- 进 datamodel 的三件（普通唯一/普通复合——Prisma 可表达）：
CREATE UNIQUE INDEX "GenerationIntent_idemKey_key" ON "GenerationIntent"("idemKey");                            -- @unique 派生名（先例 init:1005）
CREATE UNIQUE INDEX "TeamCreditTransaction_idempotencyKey_key" ON "TeamCreditTransaction"("idempotencyKey");   -- 去 partial：PG 唯一索引 NULL 默认不冲突=语义等价
CREATE INDEX "GenerationIntent_projectId_nodeId_status_createdAt_idx" ON "GenerationIntent"("projectId", "nodeId", "status", "createdAt");  -- claim ② 跨状态——普通 @@index
-- 保持 partial 的三件（migration-SQL-only 不进 datamodel——partial 零棘轮成本〔diff 词汇外〕+查询谓词与 WHERE 严格匹配防计划器弃用）：
CREATE INDEX "GenerationIntent_running_deadline_idx" ON "GenerationIntent"("deadlineAt") WHERE "status" = 'RUNNING';
CREATE INDEX "GenerationIntent_running_heartbeat_idx" ON "GenerationIntent"("heartbeatAt") WHERE "status" = 'RUNNING';
CREATE INDEX "GenerationIntent_frozen_user_idx" ON "GenerationIntent"("teamId", "userId") WHERE "reservedCredits" > 0;   -- 与既有 frozen partial 冗余核对进 Step 0
CREATE INDEX "TeamCreditTransaction_settle_user_month_idx" ON "TeamCreditTransaction"("teamId", "operatorUserId", "createdAt") WHERE "type" IN ('settle', 'refund');
-- 注意：GenerationIntent_status_completedAt_idx **已存在**（init:1092）——Z114 假新增，本稿禁再建。

-- 台账唯一写入口=DB 触发器（Z51 替代——跨进程/raw/未来调用者结构性拦截）
CREATE OR REPLACE FUNCTION ledger_guard() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.ledger_tx', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'LEDGER_SINGLE_WRITER: % 写操作必须经 CreditLedgerService 事务（SET LOCAL app.ledger_tx）', TG_TABLE_NAME;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER team_credit_transaction_guard BEFORE INSERT OR UPDATE OR DELETE ON "TeamCreditTransaction"
  FOR EACH ROW EXECUTE FUNCTION ledger_guard();
CREATE TRIGGER team_balance_guard BEFORE INSERT OR UPDATE OR DELETE ON "TeamBalance"
  FOR EACH ROW EXECUTE FUNCTION ledger_guard();

-- 破坏性语句（仅 squash 路径合法——起草文件受检前注释掉；汇编进 init 时以"从未存在"形态消失）：
--   ALTER TABLE "TeamMember" DROP COLUMN "monthlyUsed";
--   ALTER TABLE "TeamMember" DROP COLUMN "monthlyPeriod";   （连同 member_monthly_non_negative CHECK 不进 init）
--   DROP INDEX "GenerationIntent_status_updatedAt_idx";
-- 注意：GenerationIntent_projectId_intentId_key **保留**（Z88——intentId 唯一是 exec 投影对齐的零成本保险）
```

- [ ] **Step 2: schema.prisma 终态同步**

`GenerationIntent` 加：`heartbeatAt DateTime`/`deadlineAt DateTime`/`startedAt DateTime?`/`idemKey String @unique`（Z107 派生名）+`gestureKey String?`/`providerTaskId String?`+`@@index([projectId,nodeId,status,createdAt])`（普通——claim②）+**删 `@@index([status, updatedAt])` 行（Z114②——不删则 diff `[+]` 行棘轮红）**；三个性能索引**不在此声明**（Z114③：保持 partial 走 migration-SQL-only——schema:1009 既有注释"partial index 不进 Prisma 声明"惯例）；`@@unique([projectId, intentId])` **保留**（Z109：intentId 纯服务端铸造后永不因客户端冲突）。`TeamCreditTransaction` 加 `idempotencyKey String? @unique`（去 partial 语义等价）。`AIModel` 加 `apiModelName String?`/`providerLabel String?`。`TeamMember` 删 monthlyUsed/monthlyPeriod 两行（读者已在 T0 改道）。

- [ ] **Step 3: env zod 十二键（config/env.ts）**

```ts
// Z117：EXEC_DEFAULTS 常量表单源（zod .default 从表取+读点【字面量】process.env.EXEC_* 直读
// 〔collab-env-single-source 方向②只认字面量实测——zod 解析值消费=死键红〕+HARD_CAP 默认与
// check-nginx-budget.mjs 共用同一常量——禁两处各写数值）。EXEC_MAX_NODES **整体移 T8**（键随读者同批）。
EXEC_SUBMIT_TIMEOUT_MS: z.preprocess(blankToUnset, z.coerce.number().int().min(1_000).optional()),       // 默认 EXEC_DEFAULTS.SUBMIT=30_000
EXEC_POLL_TIMEOUT_MS: z.preprocess(blankToUnset, z.coerce.number().int().min(1_000).optional()),         // 默认 10_000
EXEC_DEADLINE_TEXT_MS: z.preprocess(blankToUnset, z.coerce.number().int().min(10_000).optional()),       // 默认 90_000
EXEC_DEADLINE_IMAGE_MS: z.preprocess(blankToUnset, z.coerce.number().int().min(30_000).optional()),      // 默认 300_000
EXEC_DEADLINE_VIDEO_MS: z.preprocess(blankToUnset, z.coerce.number().int().min(60_000).optional()),      // 默认 900_000
EXEC_DEADLINE_EDIT_MS: z.preprocess(blankToUnset, z.coerce.number().int().min(30_000).optional()),       // 默认 300_000
EXEC_DEADLINE_LIGHTING_MS: z.preprocess(blankToUnset, z.coerce.number().int().min(120_000).optional()),  // 默认 1_800_000
EXEC_SYNC_HARD_CAP: z.preprocess(blankToUnset, z.coerce.number().int().min(60_000).optional()),         // 默认 EXEC_DEFAULTS.SYNC_HARD_CAP=1_800_000（Z90 病态批硬闸——默认值语义="同步组 ≤2×video(900s)"规模上限；相对关系由启动断言锁：HARD_CAP ≥ max(所有 EXEC_DEADLINE_*_MS) 否则拒启〔与 Z93 同批〕）
PROVIDER_MOONSHOT_API_KEY: z.string().optional().default(''),   // Z80：seed 灌值来源（运行时读 AIModel.apiKey）
PROVIDER_TENCENT_API_KEY: z.string().optional().default(''),    // 归并 HY_IMAGE_API_KEY（env 名登记+seed 改读此键）
DASHSCOPE_API_KEY: z.string().optional().default(''),
```

（.env 本地补三枚密钥值——从 MODEL_CONFIG 原常量搬；服务器 .env 人工步进 runbook——deploy.sh 不传 .env。）

- [ ] **Step 4: ledgerTx 统一入口+**删除 tx()**+14 处消费者改造+夹具工厂（Z81+Z89）**

```ts
// credit-ledger.service.ts——双 SET LOCAL 两个形态（Z81）；tx() 删除（Z89——普查交 tsc）：
/** 装饰既有事务（自定义 timeout 的资金事务首句调用——Z89 全部 14 处的唯一入口）。 */
async ledgerTx(raw: Prisma.TransactionClient): Promise<LedgerTx> {
  await raw.$executeRaw`SET LOCAL lock_timeout = '3s'`;
  await raw.$executeRaw`SET LOCAL app.ledger_tx = 'on'`;   // 触发器通行证
  return raw as unknown as LedgerTx;
}
/** 标准事务入口（seed/bootstrap——15s 默认档）。 */
async runInTx<T>(fn: (tx: LedgerTx) => Promise<T>): Promise<T> {
  return this.prisma.$transaction((raw) => this.ledgerTx(raw).then(fn), { timeout: 15_000, maxWait: 5_000 });
}
// **tx() 删除**（原 :49 纯品牌转换无 SET LOCAL=触发器时代无正确用法）；intent-reconcile/team-credit
// 手写 SET LOCAL 收敛调 ledgerTx；Z89 七文件（team.service/team-recharge/team-subscription/
// admin-subscription/personal-team-ledger+三 processor）的事务首句改 `await ledgerTx(raw)`；
// personal-team-ledger 公开签名改收 LedgerTx（调用方自取通行证）；team.service 解散事务+建团队
// 事务首句通行证——注释钉死"team.delete 级联进受触发器保护的表（schema:711 Cascade），本事务必须持通行证"。
// checker 同批：生产代码出现 `ledger.tx(` 即违规。
```

```ts
// Z97+Z116（第五轮修订）：wipeForTests 不进生产服务（垫片）——checker 测试文件改【能力制】
// （窗口含 runInTx(/ledgerTx(/SET LOCAL app.ledger_tx 即放行——安全需求=写必持通行证，触发器 DB 层
// 已强制；生产代码维持位置制不弱化）。test-utils 自持清理：
// apps/api/src/test-utils/intent-fixture.ts：
export async function createIntentFixture(prisma: PrismaService, over: Partial<Prisma.GenerationIntentCreateInput> & { projectId: string; nodeId: string; userId: string; teamId: string }) {
  return prisma.generationIntent.create({ data: {
    ...over, status: over.status ?? 'RUNNING',
    idemKey: over.idemKey ?? randomUUID(), heartbeatAt: over.heartbeatAt ?? new Date(),
    deadlineAt: over.deadlineAt ?? new Date(Date.now() + 90_000),
  } });
}
export async function ledgerWipe(ledger: CreditLedgerService, where: { teamId?: string } = {}) {
  await ledger.runInTx(async (tx) => {          // 通行证在 runInTx 内置——能力制窗口命中
    await tx.teamCreditTransaction.deleteMany(where.teamId ? { where: { teamId: where.teamId } } : {});
    await tx.teamBalance.deleteMany(where.teamId ? { where: { teamId: where.teamId } } : {});
  });
}
/** team.delete 级联删 TeamBalance 触发行级触发器——GUC 包裹让级联带证；**deleteMany 幂等**
 *  （Z116：删 catch 掩码后 delete 撞 P2025 会把 afterAll 异常算该文件失败——清理语义=零命中不抛）。 */
export async function deleteTeamsWithPass(prisma: PrismaService, ids: string[]) {
  await prisma.$transaction(async (raw) => {
    await raw.$executeRaw`SET LOCAL app.ledger_tx = 'on'`;
    await raw.team.deleteMany({ where: { id: { in: ids } } });
  });
}
```

**Z100 mutate 前置查（同批落 credit-ledger）**：`lockBalance` 之后 `findFirst({where:{idempotencyKey: input.idempotencyKey}})` 命中 ⇒ 返回 `{rowId: prev.id, credits/subscriptionCredits: 同事务当前两池, replayed: true}`（**Z113：replayed 与 noop 语义分离**——仓内 noop=零额不写行）；miss ⇒ **原样 create**（reversesId @unique/money_in_once 抛错 backstop 全保留——**禁 skipDuplicates**：mutate 先 :91-94 update 加钱后 :95 create，吞掉唯一冲突=钱包已变流水缺失击穿不变量①）。同批红测"同 reversesId 二次入账仍抛错"。

**夹具替换配方（Z116 修正）**：
- 台账夹具：`ledger.runInTx(async tx => { await ledger.ensureBalance(tx, teamId); await ledger.lockBalance(tx, teamId); await ledger.mutate(tx, { teamId, operatorUserId: uid, type: 'register_grant', creditType: 'regular', balanceDelta: +100, frozenDelta: 0, referenceId: \`it-fix-${randomUUID().slice(0,8)}\` }); })`——**creditType: 'regular'（Z118：enum={regular,subscription} 无 'credits'——v2.3 笔录 TS2345）**；ensureBalance 建 0 额度钱包⇒register_grant 灌额是完整链；referenceId 后缀化（money_in_once 全局不含 teamId）；
- 意图行夹具（19 处/4 文件）：全换 `createIntentFixture`（T0 的 monthly spec 同批换）；
- team.delete 清理（12 处/6 文件）换 `deleteTeamsWithPass`；**teamBalance 直删两处**（credit-ledger.int:104 的 `delete().catch`——Z23 用例改 `ledgerWipe(ledger, {teamId})`；generation-intent.int:139 的 `deleteMany`——改经 ledgerWipe）；
- **catch 掩码收窄（Z118）**：台账/team 删的掩码全删（触发器报错被吞=假绿+跨轮残留）；media/project 等非台账 best-effort 清理保留+注释；
- ledger-invariants:55 CHECK 断言：移入通行证事务+message 匹配 `/balance_non_negative/`（:73 同款 `/money_in_reference_required/`）。

- [ ] **Step 5: 红用例（int——起草库上先行；Z89 补五链路 money-in 冒烟）**

```ts
it('Y0b-2 T1：触发器拦截——非 ledger 上下文直写/直删 TeamCreditTransaction 抛 LEDGER_SINGLE_WRITER', async () => {
  await expect(prisma.teamCreditTransaction.create({ data: anyTxnRow })).rejects.toThrow(/LEDGER_SINGLE_WRITER/);
  await expect(prisma.$executeRaw`UPDATE "TeamBalance" SET credits = credits WHERE true`).rejects.toThrow(/LEDGER_SINGLE_WRITER/);
  await expect(prisma.teamBalance.deleteMany({ where: { teamId } })).rejects.toThrow(/LEDGER_SINGLE_WRITER/);   // DELETE 面
});
it('ledger 上下文（SET LOCAL）放行', async () => { /* runInTx 内 ensureBalance 零额写 */ });
it('idemKey 唯一——同键第二行 DB 拒绝；三 NOT NULL 列缺省插入拒绝', async () => { /* createIntentFixture 双插 */ });
// Z89 五链路冒烟（改前红=LEDGER_SINGLE_WRITER——单测 mock ledger 全绿假象的 int 层证据）：
it('money-in 五链路真库 happy-path：充值入账/订阅发放/到期清零/admin 授予/个人团队发放+建团队+解散 全部经通行证零异常', async () => {
  /* team-recharge 入账 / grantToPersonalTeam / admin grantCredit / disbandTeam（级联删 TeamBalance）各一轮 */
});
```

- [ ] **Step 6:【告知用户点①】本地 reset 验证起草文件（此时仅跑两个新 spec——存量套件待代码追平）**

```bash
cd apps/api && pnpm exec prisma migrate reset --force --skip-seed
pnpm exec prisma migrate deploy                      # 起草文件空库应用
node ../../scripts/check-migration-additive.mjs && node ../../scripts/verify-indexes.mjs
pnpm exec tsx prisma/seed.ts                         # seed 直跑（db execute 只吃 SQL——Z88）
pnpm --filter api test:int -- generation-intent ledger-trigger
```

- [ ] **Step 7: claim 最小 idemKey 化（Z82——不变量消费者同 commit）**

`generation-intent.service.ts`：claim 判据 `findUnique({where:{idemKey}})` 替代 `projectId_intentId` 复合键（五分支结构/attempts/NodeBusy 语义原样）；**Z109（第五轮接线修正）**：claim 入参拆两字段——**`gestureToken?: string`（只收客户端原始入参——deriveIdemKey 的 token 位消费）**与 **`intentId: string`（服务端 randomUUID 铸造的行身份——`@@unique([projectId,intentId])` 消费）**；execution.service 的 claimForNode 包装（:53 `intentId: intentId ?? randomUUID()` 兜底）**拆除**——gestureToken=客户端原始入参无条件透传（**:148/:222/:302 三处 `isFirstExec ? intentId : undefined` 门随 T1 删**——Z103 接线后组执行非首节点会拿铸造值=每次新手势；**token 整批施加**〔intentId 已服务端铸造⇒整批同 token 不撞复合唯一——v2.1 不能整批的原因消失〕）；`normalizeRegenToken` **随 T1 落**（gestureKey TEXT 在 T1 窗口是客户端可控无界字符串——超长/非法⇒截断+warn 非 400〔T1 的 DTO 还是 intentId 位不能破兼容；T6 转严格 400〕；注释写清 `join('|')` 无注入：token 是末段且前置字段均不含 `|` 且带 regen: 前缀⇒结构性无碰撞）；DTO `intentId` T1 标废弃注释（**wire 语义=手势 token 非行 id——防新调用方拿它查 intents 端点**）、T6 改名 regenToken；create data 补 `heartbeatAt/deadlineAt`+`gestureKey: gestureToken ?? null`；`IntentContextMismatchError` 删除。**Z110：maxStalledCount 保留 1 不改**——两 processor 的既有注释改写为安全链："stall→BullMQ 同 jobId 重排→claim② 可重入→reserve 门 alreadyReserved→mayCall:false（Z35 结构门）→静默退出零外呼——重复 submit 结构性不可能；=1 的代价=真死 worker 悬挂由 deadline reaper 收敛；改 0 的代价=lock 过期≠进程死：活 worker 被置 FAILED⇒complete CAS=0⇒平台已付费产物丢弃"。**intent-key.util.ts 本步落地**（T6 只改名/客户端轮换生命周期）：

```ts
export function deriveIdemKey(input: { projectId: string; nodeId: string; kind: string; paramsHash: string; regenToken?: string }): string {
  return createHash('sha256')
    .update([input.projectId, input.nodeId, input.kind, input.paramsHash,
             input.regenToken ? `regen:${input.regenToken}` : 'run'].join('|')).digest('hex');
}
```

seed.ts 同批：AIModel create 块钉 `active:false, recommended:false`（三行）+`apiKey: process.env.PROVIDER_TENCENT_API_KEY`（kimi/hy-video 同族补写）+apiModelName/providerLabel/provider slug 同步+定价段收口（:117-124 裸 create 改与 init 逐字一致 upsert）。**Z80 双钉理由修正（第三轮）**：迁移 INSERT `ON CONFLICT ("id") DO NOTHING`（y0b1:74-81）先于 seed 执行（gate-collab:188-189 顺序实证）⇒ fresh-rebuild 时 seed upsert 走 update:{} **create 分支永不触发**——承重钉=新 init INSERT 值；seed 钉=纯防御（行被删后重建场景），防后人误以 seed 为权威。claim spec 全套改写（where 形态 idemKey 化）+**三条 T1 红测（Z109/Z104——直调 service/enqueue：面板 T1 期每次点击仍铸新 id〔intentRecord 未退役〕⇒claim② 面板路径不可达，走 UI 测会误判）**：①改 prompt 后用同一 held 手势 id 重试 ⇒ **新行新扣费**（非 NodeBusy/非 409——改前红=复合唯一被 skipDuplicates 吞+:135 映射 NodeBusy〔表述修正 Z118：intentRecord 有 rotate 逃生门非"永久自锁"——但 409+rotate 体验仍劣〕）；②同 project/node/content **并发**两次同步 execute ⇒ 恰一行 intent、恰一次外呼、第二次 NodeBusy（现状 :90 合取保证——锁行为防 ⓪/换轨丢合取项）；③"重新生成"（新手势 id）经 enqueue 与组执行各一次 ⇒ 新行新扣费+**无 token 路径（gestureToken=undefined）命中 claim②③ 内容键**（Z109 关键断言——服务端铸造值禁入 token 位否则 ②③ 死代码）。

- [ ] **Step 8: 全量绿→汇编新 init（手工——Z60 禁 diff --from-empty）**

```bash
pnpm test:int && pnpm verify    # 存量套件在代码追平后全绿
```

新目录 `20261009140100_y0b2_init/migration.sql` = `cat 旧init 旧y0b1` 基础上：①删 TeamMember 月列+member_monthly_non_negative CHECK+`GenerationIntent_status_updatedAt_idx`；②**AIModel INSERT 段改写**（三模型 active=false/recommended=false+provider slug+apiModelName/providerLabel 三列值——裁定 5 落点）；③追加 Step 1 全部对象（六列+六索引+触发器，provider UPDATE 语义并入 INSERT 值）；④原样保留 9 partial unique+2 CHECK 族+money_in 两约束+frozen/reserve partial+定价真源 INSERT 五表顺序+CollabLease 种子+pricingRuleId FK+`GenerationIntent_projectId_intentId_key`；⑤逐块 diff `diff <(cat 旧init 旧y0b1) 新init` 留档 commit。

- [ ] **Step 8.5: 移出旧目录（Z74——reset 前必做）**

```bash
mkdir -p /tmp/y0b2-mig-bak && mv apps/api/prisma/migrations/20261009140000_y0b2_draft apps/api/prisma/migrations/20261009031416_init apps/api/prisma/migrations/20261009040355_y0b1_funds_columns /tmp/y0b2-mig-bak/
# migrations/ 仅剩 20261009140100_y0b2_init + migration_lock.toml
```

- [ ] **Step 9: 终验五连+census 三验**

```bash
cd apps/api && pnpm exec prisma migrate reset --force --skip-seed && pnpm exec prisma migrate deploy
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM _prisma_migrations"            # 断言恰 1 行（Z74）
node ../../scripts/verify-indexes.mjs && echo "块数快照粘 commit" | tee /tmp/blocks.txt
node scripts/dump-schema-objects.mjs "$DATABASE_URL" --replay-new apps/api/prisma/migrations/20261009140100_y0b2_init/migration.sql > /tmp/y0b2-after.json
diff /tmp/y0b2-before.json /tmp/y0b2-after.json                              # 差异=本次故意删除/新增对象清单（人工逐条确认）
# 行级三验（Z88）：五定价表行计数+PricingRule SUM(creditCost) 双侧比对
pnpm exec prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url "$SHADOW_DB" | tee /tmp/diff.out
node scripts/check-migrate-diff.mjs    # Z115 脚本化棘轮（verify 链常驻+--update 重生成；归一化提取与 allowlist 共用函数；金标=pricing_rule_natural_key 一行——NULLS NOT DISTINCT 语义 Prisma 不可表达；只许收窄禁新增；未识别 diff 行大声失败）
pnpm exec tsx prisma/seed.ts && pnpm test:int                                # 全量
```

- [ ] **Step 10: BASELINE 抬高+护栏+runbook+确认删除（同 commit）**

- 删 `/tmp/y0b2-mig-bak` 三目录（确认终验全绿后）；
- `check-migration-additive.mjs:14` → `BASELINE='20261009140100_y0b2_init'`+头注释：`// Y0b-2 squash（2026-10-10）：第三次基线重置。护栏：BASELINE 只允许在"无生产环境"期间抬高；失效条件=spec §9.6——此后一切 schema 变更回到 expand/contract 两步走。squash 后 fresh 集合空为预期（本批 DDL 的 additive 审计发生在起草阶段，终态由 census 对象级+行级三验保证）。`;
- runbook :90 修正+新增：`服务器 rebuild（Y0b-2 squash）：deploy.sh api --rebuild-db + 人工 tsx prisma/seed.ts + gate-seed + MinIO 孤儿清理 scripts/cleanup-orphaned-media.ts；数据=确认丢弃；**服务器 .env 需人工补三枚 PROVIDER_*/DASHSCOPE 密钥**（deploy.sh 不传 .env——缺失=启动断言拒启）。`

- [ ] **Step 11: commit（先于服务器步——Z74）**

```bash
git add -A && git commit -m "feat(y0b-2): T1 schema squash 一次到位+不变量消费者同 commit——claim 最小 idemKey 化+ledgerTx 统一（runInTx 双 SET LOCAL）+AIModel 列变更（slug/apiModelName/providerLabel+三模型 active=false 双钉）+触发器+夹具工厂/ledgerWipe+startedAt/gestureKey+census 对象级+行级三验+BASELINE 抬高（步骤序：移出→reset→断言恰一行→commit）"
```

- [ ] **Step 12:【告知用户点②】服务器重建（commit 之后）**

```bash
./deploy.sh api --rebuild-db    # git SHA 收据=已提交状态；preflight 正常执行
# 人工：服务器 .env 补三枚密钥 → ssh tsx prisma/seed.ts + gate-seed → node scripts/cleanup-orphaned-media.ts
```

---

## Task 2: api-caller 硬化——slug adapter+selectable 三处+断言三件+deadline 驱动轮询+onTick 双职+mock 四分支硬失败

**Files:**
- Modify: `apps/api/src/modules/execution/api-caller.service.ts`（全文重构——注入 PrismaService+resolveModel）、`validation.service.ts`（**executable** 预检——Z101）、`execution.module.ts`（adapter provider）、`apps/api/src/modules/admin/model/model.service.ts`（provider→slug/providerLabel/apiModelName 字段）、**`apps/api/src/config/collab-env-single-source.spec.ts`（第四轮：校验前缀扩 `EXEC_\|PROVIDER_\|DASHSCOPE`+schemaKeys 同步——豁免表理由串里 api-caller:83 引用随 fakeAiEnabled 单源化改写）**、**`docs/superpowers/specs/2026-10-08-y0b-funds-and-access-design.md`（Z108：§10 metric 块同 commit 八增+doc-gate --write-canonical）**
- Create: `apps/api/src/modules/execution/exec.metrics.ts`、`provider-adapters.ts`
- Delete: `MODEL_CONFIG` 常量（:53-72——含三枚硬编码密钥）
- Test: Create `api-caller.hardening.spec.ts`+`provider-adapters.spec.ts`（静态 unit）+`provider-adapters.int.spec.ts`（真库）；Modify `api-caller.fake-ai.spec.ts`（**第四轮：:51-53 的用例正是 Z93 要删的 NODE_ENV=production 守卫——显式替换为"缺密钥拒启+FAKE_AI 豁免"判别性用例，非随删重写**）+`api-caller.service.spec.ts:51`（mock 分支用例随删重写）+`funds-four-way.int.spec.ts:113-114`（夹具换 kimi/hy-image——executable 谓词零密钥可跑〔Z101〕）

- [ ] **Step 0: 只读探针**

```bash
grep -rn "MODEL_CONFIG" apps/api/src --include="*.ts" | grep -v spec      # 消费面（预期仅 api-caller）
grep -n "active" apps/web/src/api/adminApi.ts apps/web/src/pages/admin/pages/ModelsPage.tsx | head -5   # admin UI 消费
grep -rn "fetchModels" apps/web/src/pages/canvas/components --include="*.tsx" -l                          # 选择器消费面
```

- [ ] **Step 1: provider-adapters.ts（Z80——slug 键+EDIT 例外登记）**

```ts
// E51 补全：AIModel 是唯一模型源（provider=slug+apiModelName+apiUrl+行级 apiKey）；
// 本表只做"provider→外呼方式"映射。DashScope 编辑链=显式例外（定价 kind 级 modelId NULL——不建
// AIModel 行，配置留代码侧——**kind 级密钥只从 seedEnv 读，非"运行期只读 AIModel.apiKey"的全局真理**；
// 模型化归 Z57 重构统一）。
export interface ProviderAdapter {
  type: 'openai-chat' | 'tencent-submit-poll' | 'dashscope-submit-poll';
  seedEnv: 'PROVIDER_MOONSHOT_API_KEY' | 'PROVIDER_TENCENT_API_KEY' | 'DASHSCOPE_API_KEY';  // seed 灌值来源+断言输入
}
const ADAPTERS: Record<string, ProviderAdapter> = {
  moonshot: { type: 'openai-chat', seedEnv: 'PROVIDER_MOONSHOT_API_KEY' },
  tencent: { type: 'tencent-submit-poll', seedEnv: 'PROVIDER_TENCENT_API_KEY' },
  dashscope: { type: 'dashscope-submit-poll', seedEnv: 'DASHSCOPE_API_KEY' },   // 编辑四 kind 例外
};
export const adapterFor = (provider: string | null) => (provider ? ADAPTERS[provider] : undefined);
/** fakeAiEnabled 单源 helper（Z90/第三轮 P1-3）——COLLAB_FAKE_AI 豁免表唯一读点（多读点会漂）。
 *  v2.3（Z101）：只被启动断言/CI 兜底消费——用户面谓词（executable）不含密钥维度故无需豁免。 */
export const fakeAiEnabled = () => process.env.COLLAB_FAKE_AI === '1';
/** Z101 两谓词拆分（第四轮）：
 *  executable=目录属性（可售性）——models 端点/validation 预检 MODEL_NOT_AVAILABLE/admin 标记/选择器消费。
 *  CI 零密钥（无 seed 步+INSERT 显式 NULL 实测）下 executable 仍可选——funds-four-way 夹具换 kimi/hy-image 零密钥可跑；
 *  运行中进程缺密钥结构性不可达（Z93 拒启兜底）⇒用户面 401 不存在——禁用 4xx 掩盖运维故障。 */
export const executable = (m: { active: boolean; provider: string; apiModelName: string | null }) =>
  m.active && !!adapterFor(m.provider) && !!m.apiModelName;
/** ready=运维就绪——只进启动断言（与 adapter seedEnv 并列为断言输入）。 */
export const ready = (m: { active: boolean; provider: string; apiModelName: string | null; apiKey: string | null }) =>
  executable(m) && !!m.apiKey;
// Z117①：ready 的**写边界**——admin toggle active（model.service:55-58）与写 apiKey（:30/:51）路径
// 一律校验：active=true ∧ !ready ⇒ 400 MODEL_NOT_READY（启动断言只是快照——运行期 admin 可造
// executable∧!ready 行⇒用户可选外呼 Bearer undefined 401）；admin 列表"不可执行"标记用 ready（面向运维）。
```

断言三件（Z88+Z93+**Z101 修订**）：①`provider-adapters.spec.ts` 静态 unit（DB-free——对迁移 INSERT 的 slug 集合断言 adapter 存在+active 行断言清单）；②execution 模块 `onModuleInit` 断言**与 NODE_ENV 解耦默认 fail-closed**（缺密钥**拒启**；`COLLAB_FAKE_AI=1` 显式豁免档——**CI collab-core job 同批显式注入该键作兜底**〔全仓 int 零 .init() 实测=断言在 CI 不触发，兜底防未来加 .init()〕；**日志只报缺失键名不报值**；di-smoke 列"不得红"清单）；断言输入=**ready 谓词（AIModel 行）∪ adapterFor(...).seedEnv 非空**（DashScope 四编辑 kind 覆盖）+**启动断言锁相对关系 `EXEC_SYNC_HARD_CAP ≥ max(所有 EXEC_DEADLINE_*_MS)` 否则拒启**（Z90 第四轮——zod 不设硬地板）；③`provider-adapters.int.spec.ts` 真库（**executable 谓词用 fixture 行自建**〔带/不带 apiKey 两形态——CI 零密钥下 executable 不受影响〕；ready 谓词断言仅在有密钥环境生效或用 fixture 行带 apiKey）。validation 预检：节点引用模型 `!executable` ⇒ 400 `MODEL_NOT_AVAILABLE`（claim 前零冻结零 attempts）。admin ModelsPage provider 输入改 **adapter 下拉**（`Object.keys(ADAPTERS)`；列表页"不可执行"标记=executable）。

- [ ] **Step 2: exec.metrics.ts（Z85——全部新指标单文件）**

```ts
export const outboundDuration = new Histogram({ name: 'exec_outbound_duration_seconds',
  help: 'Y0b-2（Z41/Z69）：外呼全程时长（call 域——claim 之后到 Deliverable；不含排队）', labelNames: ['kind'],
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1200, 1800], registers: [register] });
export const intentDeadlineExceededTotal = new Counter({ name: 'intent_deadline_exceeded_total',
  help: 'Y0b-2（Z68/Z84）：deadline 强制收敛计数（phase=queue 排队期/call 外呼期/waiting 队列升级）', labelNames: ['kind', 'phase'], registers: [register] });
export const syncPendingTotal = new Counter({ name: 'exec_sync_pending_total',
  help: 'Y0b-2：SV 支配门拒绝计数（phase=first/retry）', labelNames: ['phase'], registers: [register] });
export const artifactDiscardedTotal = new Counter({ name: 'ai_artifact_discarded_total',
  help: 'Y0b-2（Z85）：外呼产物丢弃计量——cause=precall-miss 断言恒 0（非 0 即 pre-call 断言被绕过）；cause=node-deleted 在飞窗口真实计量；cause=deadline-voided', labelNames: ['cause'], registers: [register] });
export const intentClaimResultTotal = new Counter({ name: 'intent_claim_result_total',
  help: 'Y0b-2（Z85）：claim 出口三分——"用户以为重新生成实际被回放"的唯一可观测面', labelNames: ['result'], registers: [register] });   // replay|rearm|new|busy
export const groupDuration = new Histogram({ name: 'execution_group_duration_seconds',
  help: 'Y0b-2（Z90）：组执行全程墙钟（spec §9.x-7 触发线判据 p99>60s 的采集——本批埋点不等 Y0b-5）',
  labelNames: ['nodeCount'], buckets: [5, 15, 30, 60, 120, 300, 600, 1200, 1800], registers: [register] });
export const pollStallTotal = new Counter({ name: 'exec_poll_stall_total',
  help: 'Y0b-2（Z90/Z105）：轮询停滞触发计数（连续异常——fetch 抛错/非 2xx/解析失败，**不含"处理中"稳态**）', labelNames: ['kind'], registers: [register] });
```

（**Z108：spec §10 metric-names 块同 commit 增 8 名删 1 名**——八名=exec_outbound_duration_seconds/intent_deadline_exceeded_total/exec_sync_pending_total/ai_artifact_discarded_total/intent_claim_result_total/execution_group_duration_seconds/exec_poll_stall_total/yjs_snapshot_fallback_total〔T3 落 store.metrics.ts〕；一删=yjs_sv_wait_timeout_total〔T7〕；**Y0b spec 是 canonical 文档——每次 spec 变更同 commit `node scripts/doc-gate.mjs --write-canonical`**。）

（~~spec §10 metric-names 块同 commit 追加五名——T9 终核对。~~ **v2.4 删除——以 Z108"八增一删"口径为唯一指令（第五轮：同 Step 双指令互斥）**）

- [ ] **Step 3: 红用例（api-caller.hardening.spec.ts 节选——Z73：断言字段=errorCode）**

```ts
describe('Y0b-2 T2：mock 四分支硬失败+AIModel 单源', () => {
  it('text：模型无 adapter → 4xx PROVIDER_UNKNOWN_MODEL（改前红：MODEL_CONFIG 缺=mock 假产物）', async () => {
    await expect(svc.callTextGen({ prompt: 'p', model: noAdapterModelStub }))
      .rejects.toMatchObject({ errorCode: 'PROVIDER_UNKNOWN_MODEL' });
  });
  it('text 链 4xx → HTTP 错误（改前红：json 解析空串当成功）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"x"}', { status: 429 })));
    await expect(svc.callTextGen({ prompt: 'p', model: kimiStub })).rejects.toThrow(/HTTP 429/);
  });
  it('200 但 choices 空 → PROVIDER_EMPTY_RESPONSE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"choices":[]}', { status: 200 })));
    await expect(svc.callTextGen({ prompt: 'p', model: kimiStub })).rejects.toMatchObject({ errorCode: 'PROVIDER_EMPTY_RESPONSE' });
  });
  it('selectable 预检：引用停用模型 → 400 MODEL_NOT_AVAILABLE 零外呼零意图行', async () => { /* gpt4 引用 */ });
});
describe('Y0b-2 T2：deadline 驱动轮询+onTick 双职（Z68/Z69/Z83）', () => {
  it('onTick 返回 abort → 轮询立即停止', async () => { /* fake timers+fetchMock——同 v2 */ });
  it('deadline 到点 → 轮询停止（改前红：30×2s 硬编码先于 deadline）', async () => { /* fake timers */ });
});
```

- [ ] **Step 4: 绿——api-caller 重构骨架（v2 形态维持+三处修订）**

`OutboundModel = { provider: string; apiUrl: string; apiModelName: string; apiKey: string }`（resolveModel 从 AIModel 行取——**密钥行级**；5min 模块级缓存仅服务 claim 后外呼面；**单实例假设注释**：readServerSV/SnapshotDocCache/prom-client registry/模型缓存四处均依赖 PM2 `instances:1`〔ecosystem:11 已钉 E35〕——多实例下 SV 门拿陈旧本地 doc=最隐蔽错，各缓存处一行注释钉死）；`withDeadline` 显式 AbortController+finally clearTimeout（Z45）；`fetchGuarded` res.ok 断言；`pollLoop` while-deadline 驱动+onTick 双职（同 v2）+**停滞检测（Z90+Z105+第五轮修订）**：`lastGoodResponseAt` 在"**任意 2xx 且响应可解析**"时刷新（**禁"status∈已知集合"词表悬崖**——provider 新增中间态〔queued/processing_v2〕会停刷新⇒100s 误杀；未知 status 记 `exec_poll_unknown_status_total`+WARN 不判停滞——pending 的上界永远是 deadline）；`now - lastGoodResponseAt > EXEC_POLL_TIMEOUT_MS × stallLimit(10)` ⇒ `pollStallTotal.inc`+throw `PROVIDER_POLL_STALLED`（独立 errorCode 非 deadline；时间计数器对轮询间隔不敏感——**禁"连续 N 次非终态"字面读**：三轮询循环正常态即非终态〔:111-125/:286-306/:342 实测〕）；**404/任务不存在 ⇒ 立即终态 `PROVIDER_TASK_LOST`**（supportsTaskQuery 适用面登记）；**负向红测两条**：mock 连续 12 次 running 后 succeeded ⇒ 成功且计数不增；mock 连续 12 次**未知中间态**（2xx 可解析）⇒ 不抛不计数；方法改造表同 v2（callTextGen 单次 fetch 无轮询/onTick 不适用——text 链外呼前 touchHeartbeat 一次；providerTaskId：submit-poll 类回传、**text 显式 null**〔Z88〕）；fakeAi 分支保留优先（COLLAB_FAKE_AI=1 合法 E2E）。**三枚密钥从 MODEL_CONFIG 挪 env→seed 灌行（T1 已落）——api-caller 只读行级 apiKey；adapter 的 seedEnv 用字面量读（`process.env.PROVIDER_TENCENT_API_KEY`）禁动态 `process.env[key]`（collab-env-single-source 扩前缀后动态读点假红）。**

- [ ] **Step 5: 跑测+census+commit**

```bash
pnpm --filter api test -- api-caller provider-adapters **fake-ai** && pnpm --filter api test:int -- provider-adapters funds-four-way
grep -rn "MODEL_CONFIG\|Unknown model type\|Mock response for" apps/api/src --include="*.ts" | grep -v spec   # 清零（v2.2：裸 | 在 grep BRE=字面量永真——统一 \| 转义）
node scripts/check-spec-consistency.mjs
git add -A && git commit -m "feat(y0b-2): T2 api-caller 硬化——slug adapter（MODEL_CONFIG 退役+密钥行级）+selectable 三处（选择器/预检 MODEL_NOT_AVAILABLE/启动断言 fail-closed 两类密钥源——Z93）+停滞检测（Z90）+组时长/停滞指标+fake-ai.spec 回归锚显式留档"
```

---

## Task 3: 计费读显式分源+SnapshotDocCache 单源+fallback 活读+无租约门

**Files:**
- Modify: `collab.gateway.ts`（isPersistedComplete 谓词）、`collab-document.service.ts`（decodeSnapshot 单源+出口族+:65 矛盾注释改写）、`video-work.service.ts`（缓存复用）、`execution.service.ts:87`（分源消费）、**`apps/api/src/modules/collab/store.metrics.ts`（Z108：snapshotFallbackTotal 定义于此——yjs_snapshot_read_total 同族 :82，*.metrics.ts glob 收进）+spec §10 同 commit加名+doc-gate --write-canonical**
- Create: `apps/api/src/modules/collab/snapshot-doc-cache.ts`（TTL 单飞；**LRU 容量上界登记 Y0c/heap 闸同族——T9 残余**）
- Test: Create `read-canvas-routing.spec.ts`

- [ ] **Step 0: 只读探针**

```bash
grep -n "hasFrames" apps/api/src/modules/collab/collab-spool.service.ts   # :122 在位
sed -n '60,80p' apps/api/src/modules/collab/collab-document.service.ts    # :65 注释原文
```

- [ ] **Step 1: 红用例**

```ts
describe('Y0b-2 T3：isPersistedComplete 谓词+SnapshotDocCache', () => {
  it('谓词四合一（documents/inFlight/pending/spool 任一非空→false）', () => { /* 四态工厂 */ });
  it('TTL 窗内并发 N 次 → 底层解码恰 1 次；TTL 过期重新解码', async () => { /* fake timers */ });
  it('谓词不满足 → 活读（withDoc——非陈旧快照）', async () => { /* resident doc 注入 */ });
});
```

- [ ] **Step 2: 绿——谓词+缓存+出口族（Z88：fallback 活读+去租约门）**

```ts
// collab.gateway.ts——Z50 修订：PG 完整性谓词（断言语义+settleStranded 前置门+Y0b-3/4 消费）。
isPersistedComplete(projectId: string): boolean {
  const name = `project:${projectId}`;
  return !this.server.hocuspocus.documents.has(name) && !this.inFlightProjects.has(projectId)
    && (this.pendingQueues.get(projectId)?.length ?? 0) === 0 && !this.spool.hasFrames(projectId);
}
// snapshot-doc-cache.ts 同 v2（TTL 单飞原语）。
// collab-document.service.ts：
/** 计费/语义读统一出口（执行恒活读——Z49 修订：发起方必有 WS⇒doc 常驻⇒零成本；分源判定在受理端点门）。 */
async readCanvas(projectId: string): Promise<{ nodes: any[]; edges: any[]; serverSV: Uint8Array }> { /* withDoc+encodeStateVector */ }
/** 快照读专用出口（无客户端面：video-work 等）——Z88+第三轮表述修正：快照路径**本无租约门**
 *  （readCanvasFromSnapshot:66-77 实测不查——谓词满足=drain 已冲刷完成，快照读可正常返回 ✓）；
 *  谓词不满足（drain 进行中 spool 有帧）→活读（快照不可信定义性不使用）——活读经 withDoc 撞
 *  租约门（:23）⇒drain 进行中 503（可达性边界 T9 登记）+fallback 计数观测（低频边缘：
 *  卸载后 spool 未落库窗内外部分享请求触发 withDoc 装载——E71 残余登记）。 */
async readCanvasSnapshotCached(projectId: string): Promise<DecodedSnapshot> {
  if (!this.gateway.isPersistedComplete(projectId)) { snapshotFallbackTotal.inc(); return this.readCanvasLive(projectId); }
  return this.snapshotCache.get(projectId, () => this.readCanvasSnapshotUncached(projectId));
}
```

:65 注释改写为分源规则（"计费/语义读走 readCanvas 活读；本快照出口仅无客户端面"）。video-work process 改 `readCanvasSnapshotCached`+invalidate。

- [ ] **Step 3: 跑测+commit**

```bash
pnpm --filter api test -- read-canvas-routing
git add -A && git commit -m "feat(y0b-2): T3 计费读显式分源——SnapshotDocCache 单源+fallback 活读+去租约门（对齐偏离表）+:65 注释改写"
```

---

## Task 4: 心跳刷新+判据切换+deadline 双批 reaper+waiting 升级档+startedAt phase

**Files:**
- Modify: `generation-intent.service.ts`（touchHeartbeat/reanchorDeadline〔写 startedAt〕/claim 三分支重锚/complete/fail/void_ 补 heartbeat）、`intent-reconcile.service.ts`（判据切换五处+双批+waiting 升级）、`execution.service.ts`+`ai-image-edit.processor.ts`+`lighting.consumer.ts`（onTick 接线）、`execution.processor.ts`（deadlineAt 传递）
- Test: Create `deadline-reaper.int.spec.ts`

- [ ] **Step 0: 只读探针**

```bash
grep -n "updatedAt" apps/api/src/modules/execution/generation-intent.service.ts apps/api/src/modules/execution/intent-reconcile.service.ts | grep -v "@updatedAt" | grep -v spec   # 判据读点全集（含 :92 staleMin）
```

- [ ] **Step 1: 红用例（Z73：写过去时间戳——fake timers 不控 PG 时钟）**

```ts
describe('Y0b-2 T4：心跳与 deadline', () => {
  it('挂起外呼+心跳持续+未超 deadline → 不 VOIDED', async () => { /* 同 v2 */ });
  it('超 deadline+心跳停 → VOIDED+退款+intent_deadline_exceeded_total{phase=call}（startedAt 非空）', async () => { /* 写过去时间戳 */ });
  it('心跳新于 deadline → 不误杀（外呼仍在跑）', async () => { /* 同 v2 */ });
  it('判据切换：heartbeatAt 新+updatedAt 旧的 RUNNING 行不被 stale 批收（改前红）', async () => { /* 同 v2 */ });
  it('phase=queue：claim 后未外呼（startedAt null）即超 deadline → phase=queue（改前红：heartbeatAt>createdAt 恒真=queue 永不可达）', async () => {
    const { intent } = await claimIntent({ kind: 'text' });
    await prisma.generationIntent.update({ where: { id: intent.id }, data: { deadlineAt: new Date(Date.now() - 1_000), heartbeatAt: new Date(Date.now() - 2_000), startedAt: null } });
    await reconcile.verifyActive();
    expect(metricDelta('intent_deadline_exceeded_total', { phase: 'queue' })).toBeGreaterThanOrEqual(1);
  });
  it('waiting 升级档（Z84）：jobId 活跃且 waiting 且超 max(deadline×3,30min) → VOIDED+release（迟归 job 走 rearm 自愈）', async () => {
    const { intent } = await claimIntent({ kind: 'video', jobId: 'j1' });
    await mockJobState('j1', 'waiting');
    await prisma.generationIntent.update({ where: { id: intent.id }, data: { deadlineAt: new Date(Date.now() - 40 * 60_000), heartbeatAt: new Date(Date.now() - 41 * 60_000) } });
    await reconcile.verifyActive();
    await expect(status(intent.id)).resolves.toBe('VOIDED');   // 改前红：A 路径 waiting 零动作永久悬挂
  });
  it('jobId active 短窗 → 仍零动作（长任务防误杀——:111 禁绕过）', async () => { /* active+刚过期 */ });
});
```

- [ ] **Step 2: 绿——generation-intent.service（v2 形态+startedAt）**

`touchHeartbeat`（best-effort updateMany where ACTIVE；注释钉死"与 reserve gate CAS 同行锁竞争有界（reserve 事务 ≤15s 封顶）"）；`reanchorDeadline`（data 补 `startedAt: new Date()`——终锚+外呼起点双职）；claim 三分支 data 全带 heartbeatAt/deadlineAt（分支②同 jobId 重入**重锚**=新执行段）；complete/fail/void_ 补 heartbeatAt。

- [ ] **Step 3: 绿——intent-reconcile 判据切换+双批+升级档**

- 判据切换五处（`:95` 选行/`:183` threeCheck③/`:199` unfreeze CAS/`:231` refund CAS/generation-intent:92 staleMin 文案）全部 updatedAt→heartbeatAt；
- deadline 批（verifyActive 开头）：`RUNNING ∧ deadlineAt<now ∧ heartbeatAt<deadlineAt` 过滤后——`heartbeatAt>=deadlineAt` continue（轮询还活着）；jobActive 检查：`active` continue（防误杀）；**waiting/delayed 且 now>deadlineAt+WAITING_UPGRADE_GRACE_MS（具名常量默认 30min——v2.2：原 `max(deadlineAt×3,30min)` 时间戳乘法=1970 量级远未来永不可达〔第三轮 P1 实锤〕）⇒ 升级处理**（threeCheck{mode:'deadline'}+phase='waiting'+**本次升级 attempts 不递增**——非用户发起重试〔runbook 处置行注明〕），否则 continue（A 路径禁绕过）；phase 标注 `row.startedAt ? 'call' : 'queue'`（Z83）。

- [ ] **Step 4: 绿——onTick 接线（三链+编辑链——同 v2：reanchorDeadline+AbortSignal.timeout+onTick 读意图状态 VOIDED/FAILED⇒abort；编辑 processor/consumer 首行查 intent 行取 deadlineAt 再 reanchor）**

- [ ] **Step 5: 跑测+commit**

```bash
pnpm --filter api test:int -- deadline-reaper
git add -A && git commit -m "feat(y0b-2): T4 心跳+deadline 双批 reaper——判据单源 heartbeatAt 五处+startedAt phase（queue 档可达）+waiting/delayed 超界升级档+A 路径禁绕过（红相六向留档）"
```

---

## Task 5: rollback 双入口（Z92：rollbackRunning/rollbackDeliveryFailed）+complete→settle→deliver+真单出口+settleStranded 收窄+runIntentLifecycle

**Files:**
- Modify: `team-credit.service.ts`（rollback **三入口** rollbackRunning/rollbackDeliveryFailed/**rollbackStranded**〔Z102〕+私有 doRollback）、`credit-ledger.service.ts`（ledgerTx 已 T1——本 Task 补导出形态）、`execution.service.ts`（runIntentLifecycle+三 executor+真单出口+**NodeBusy 投影 skipped+reason**〔Z99〕+**11 处 writeExecStatus 调用点全量补 attempts〔Z111——:69/155/193/228/261/308/343/376 实测零 attempts；请求级投影传 0 代〕**）、`generation-intent.service.ts`（rearm 清 resultRef **保留 providerTaskId**+listByNode select 补 attempts）、**`execution.processor.ts`+`ai-image-edit.processor.ts`（Z111：failed 钩子先 findByActiveNode 后写投影——现 :58 写 :61 查"同 patch"结构做不到必须换序，携 `running?.attempts ?? 0`；:225/:254 两处补 attempts）**、`intent-reconcile.service.ts`（settleStranded **三分支表+ArtifactProbe 事务外探测**〔Z98/Z102+第五轮：探针只在 SUCCEEDED 分支+按 projectId 记忆化〔take:100 行防 100 次直连〕+探针失败〔503/超时/未知〕=本轮跳过该行**永不把"不知道"当"无产物"**+注释"探针结果可能过期——CAS 才是权威"〕+**reaper 终态投影分治**〔Z106/Z112〕+第三/第四不变量）、**`collab-document.service.ts`（writeNodeData 返回 `{written:boolean, reason?}` 类型化——现 :104-105 节点缺失静默 return void；writeExecStatus 守卫 fail-closed 两子句〔Z111〕）**、`execution.gateway.ts`（emitExecutionComplete 删除）、`modules/ai-download/ai-download.processor.ts`+`ai-image-edit.processor.ts`+`lighting.consumer.ts`（nodeAlive 守卫）、`scripts/check-ledger-single-writer.mjs`（checker 加固+**Z102 双向锚：intent-reconcile 禁 rollbackDeliveryFailed+execution.service 禁 rollbackStranded**〔Z118〕——同批带 test）、web：`apps/web/src/api/executionApi.ts`（errors 类型结构化）+`PreviewPlayer.tsx:65`（消费点适配）+**`execStatusView.ts`（ExecStatusEntry 补 errorCode/rearmable/attempts+projectExecToStore 抄键）+`canvasCollabRuntime.ts:177`（投影白名单加 'skipped'）**
- Test: Create `exec-partial-success.int.spec.ts`+`deliver-refund.int.spec.ts`

- [ ] **Step 0: 只读探针**

```bash
grep -rn "emitExecutionComplete" apps/api/src apps/web/src --include="*.ts" | grep -v spec    # service:385+gateway+5 spec 夹具
grep -n "return { success\|throw err" apps/api/src/modules/execution/execution.service.ts      # 出口全集
```

- [ ] **Step 1: 红用例（核心六族——v2 用例+收紧断言）**

```ts
// deliver-refund.int.spec.ts（真库）
describe('Y0b-2 T5：交付退款单事务（Z64/Z75/Z76）', () => {
  it('外呼期间节点被删 → writeNodeData {written:false} → rollback → VOIDED+两金额归零+refund 行', async () => { /* 同 v2 */ });
  it('原子性：注入 refund 抛错 → 整体回滚行仍 RUNNING（方向安全交 reaper）', async () => { /* 同 v2 */ });
  it('reaper×settle 交错：reaper 先手 VOIDED → 迟归 complete CAS=0 → 产物不写 doc（不变量：VOIDED 吸收∧complete 先于写 doc）', async () => { /* 同 v2 */ });
  it('Z92 竞态封死：complete 之后注入 reaper（rollbackRunning）→ 行仍 SUCCEEDED、无 refund 行、worker 正常写 doc（改前红：单入口接受 SUCCEEDED=退款后仍交付）', async () => { /* 时序注入 */ });
  it('Z76 套利防回归：SUCCEEDED∧consumed>0∧reservedCredits=0 超窗 → settleStranded 不退款（改前红：v2 扩判据退历史成功单）', async () => {
    const { intent } = await claimReserveSettle({ kind: 'image' }); await deliverIt(intent);
    await deleteNode(intent.projectId, intent.nodeId);        // 交付后删节点=合法操作
    await advanceClockPastWindow(); await reconcile.verifyActive();
    await expect(status(intent.id)).resolves.toBe('SUCCEEDED');   // 不退
    await expect(refundRowExists(intent.id)).resolves.toBe(false);
  });
  it('Z76/Z102 真悬留：SUCCEEDED∧reservedCredits>0∧超窗∧doc 无产物 → rollbackStranded ⇒ VOIDED+两金额归零+release 行（**改前红=v2.2 错指 rollbackRunning 恒 no-op 冻结永挂**）', async () => { /* settle 失败悬留 */ });
  it('Z102 三分支表驱动：FAILED 行不得进 settle 腿（只 void_）；SUCCEEDED∧有产物⇒补 settle 非 refund', async () => { /* 表驱动 */ });
  it('第三不变量：人工 VOIDED∧creditsConsumed>0 无 refund 行 → drift 计数', async () => { /* craftOrphanVoided */ });
});
// exec-partial-success.int.spec.ts（Z44/Z65/Z88）
describe('Y0b-2 T5：真单出口+终态投影', () => {
  it('3 节点组第 2 节点 NODE_BUSY → ①n1 产物在 doc ②success:false+errors 含 n2{status:skipped} 不含 n1 ③n3 照常 ④n2 投影 skipped（改前红：:367 throw 整批 409）', async () => { /* 同 v2 */ });
  it('UNKNOWN_NODE_IDS/CYCLE/EMPTY_SCOPE 4xx+SYNC_PENDING 前置 4xx（请求级——循环前 throw 合法）', async () => { /* 三小例 */ });
  it('F4：gated!==1 时 results 不含该节点产物', async () => { /* stub complete 归 0 */ });
  it('部分成功：n2 余额不足 → n2 error+n3 照常+errors 含 n2（组内顺序执行不阻断）', async () => { /* drain balance */ });
});
```

- [ ] **Step 2: 绿——rollback 双入口（Z75 lockBalance 前置+Z92 语义拆分——"退款后仍交付"结构性关闭）**

```ts
/** Z64/Z75/Z92/Z102：资金回滚单实现三入口。锁序=契约 20：读 intent（无锁）→lockBalance（TB 行锁）→GI CAS→逐行冲销。
 *  Z92：reaper 竞态封死——rollbackRunning（CAS 严格 RUNNING）=reaper/deadline 唯一；
 *  rollbackDeliveryFailed（CAS SUCCEEDED ∧ written:false 凭据）=交付路径唯一；**Z102 第三入口**：
 *  rollbackStranded（CAS SUCCEEDED∧reservedCredits>0∧判龄——settleStranded 唯一；判龄是安全要件
 *  〔"无活 worker 持有"的结构证明——也是它可被 reaper 侧调用而不重开 Z92 竞态的原因〕）。 */
async rollbackRunning(intentRowId: string, reason: string): Promise<void> { return this.doRollback(intentRowId, reason, { status: 'RUNNING' }); }
async rollbackDeliveryFailed(intentRowId: string, reason: string): Promise<void> { return this.doRollback(intentRowId, reason, { status: 'SUCCEEDED' }); }
async rollbackStranded(intentRowId: string, reason: string, cutoff: Date): Promise<void> {
  return this.doRollback(intentRowId, reason, { status: 'SUCCEEDED', reservedCredits: { gt: 0 }, completedAt: { lt: cutoff } });
}
private async doRollback(intentRowId: string, reason: string, from: { status: 'RUNNING' | 'SUCCEEDED'; reservedCredits?: { gt: 0 }; completedAt?: { lt: Date } }): Promise<void> {
  await this.prisma.$transaction(async (raw) => {
    const tx = await this.ledger.ledgerTx(raw);            // 双 SET LOCAL（lock_timeout+ledger_tx）
    const intent = await tx.generationIntent.findUnique({ where: { id: intentRowId } });
    if (!intent || intent.status !== from.status) return;
    await this.ledger.lockBalance(tx, intent.teamId);      // ← TB 行锁先于 GI 写（契约 20）
    const guard = await tx.generationIntent.updateMany({ where: { id: intentRowId, ...from }, data: { status: 'VOIDED', reservedCredits: 0, creditsConsumed: 0, error: reason.slice(0, 500) } });
    if (guard.count === 0) return;                         // 并发已抢/判龄不满足
    const rows = await tx.$queryRaw<any[]>`
      SELECT r.* FROM "TeamCreditTransaction" r
      WHERE r."teamId" = ${intent.teamId} AND r."referenceId" = ${'intent:' + intentRowId}
        AND r.type IN ('reserve', 'settle') AND r.amount < 0
        AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)`;
    for (const r of rows) { await this.ledger.mutate(tx, r.type === 'settle'
      ? { teamId: r.teamId, operatorUserId: intent.userId, type: 'refund', creditType: r.creditType, balanceDelta: Math.abs(r.amount), frozenDelta: 0, referenceId: r.referenceId, reversesId: r.id }
      : { teamId: r.teamId, operatorUserId: intent.userId, type: 'release', creditType: r.creditType, balanceDelta: Math.abs(r.amount), frozenDelta: -Math.abs(r.amount), referenceId: r.referenceId, reversesId: r.id }); }
  }, { timeout: 15_000, maxWait: 5_000 });
}
```

checker 加固（check-ledger-single-writer.mjs）：函数块含 `ledger.mutate(`/`ledger.ledgerTx(` 且有 GI 写而无 `lockBalance(` 先行者 ⇒ 违规（补"缺锁漏报"面）；**Z92/Z102 锚：intent-reconcile.service.ts 出现 `rollbackDeliveryFailed` 即违规（允许 rollbackRunning/rollbackStranded）**。intent-reconcile 两事务首句改经 runInTx 形态（Z81 已 T1 落，本 Task 核对 threeCheck 分义入口收敛调用 rollbackRunning）。**Z98：settleStranded 的产物探测经注入的 ArtifactProbe（collab 侧 probe(projectId,nodeId,kind)——DI 已在位 :61），intent-reconcile 文本零 `readCanvas(`（规则⑤三文件禁入）；先探针（事务外）取事实→再开 rollbackStranded 事务（锁内不做慢 IO）。**

- [ ] **Step 3: 绿——runIntentLifecycle+真单出口（v2 形态+三处修订）**

`NodeExecutor` 表（text/video/image 三 exec）+`runNodeLifecycle` 单序列（plan 校验〔pre-call miss⇒artifactDiscarded{cause:'precall-miss'}+error 投影〕→claim→loading→reserve 失败 onReserveFail+error+return→mayCall:false（skipped 投影+return）→**claim NodeBusy⇒投影 skipped+reason（Z99 禁 error——"别处在飞"非节点失败，Z88 已把 skipped 排除终态守卫）**→reanchorDeadline+call（onTick 双职）→complete CAS（gated≠1⇒discarded{deadline-voided}+**终态 error 投影+emitNodeStatus**〔Z95 补——原缺=节点永挂 loading 违反 Z65"每个请求节点必落终态"〕+return）→settle（失败 settleFailureTotal+照发）→writeNodeData **`{written:boolean, reason?:'node-deleted'|'no-node-map'}`**（第四轮类型化：现 :104-105 节点缺失静默 return void=退款判据不可辨；**只有 written===false 触发 rollbackDeliveryFailed**+discarded{node-deleted}+终态 error 投影〔Z95 同补〕+return——drain/租约 503 是**抛错**走悬留闭环非 written:false）→done 投影+results.push+emitNodeStatus+credits）。execute 主体：请求级错误循环前 throw（:80/:104 归入+UNSUPPORTED_NODE_TYPE 显式 switch）；catch 内 BusinessException 降级逐节点 error+continue（**:367 throw 整批退役**）；**error 投影与 status:'error' 同 patch 携 errorCode+rearmable+attempts**（Z95——writeExecStatus 终态守卫:127-128 约束事后补写被吞；INTENT_EXHAUSTED 的 catch 写 rearmable:false——客户端轮换判据单源）；**Z99/Z111 守卫 fail-closed 两子句（collab-document.service.ts）**：终态守卫从"done\|error 一刀切"改——`typeof incoming.attempts !== 'number' ⇒ drop`（**fail-closed**——JS 语义 `undefined <= 5` 为 false⇒不拦⇒写入放行，v2.3 单子句 fail-open〔11 处调用点实测零 attempts=洞从缺字段路径复活〕；丢弃计数 `exec_projection_dropped_total`）+`incoming.attempts < stored.attempts ⇒ drop`（**严格更老一律丢不看终态**——否则老代 error(1) 覆盖新代 loading(2)，用户在 attempt2 在飞时看到 error 去点重试）+`equal ∧ stored 终态 ⇒ drop`（原意图——同代次迟到 loading 不倒退）；attempts **必填**（patch 类型编译级；请求级投影传 **0 代**+注释"0 代不得覆盖任何 ≥1 代"；`stored.attempts ?? 0` 兜改动前遗留 doc 条目）；红测三条=无 attempts 迟到 error 被拦〔**改前红=照写**〕/error(a1)→rearm 后 loading/done(a2) 可写/老代 error 不覆盖新代 loading；`errors: {nodeId,status:'error'|'skipped',error:string}[]`+`success=errors.length===0`；**无 finally 死代码**（emit 已删，总额进 return——totalCost 无真消费者注记：组执行响应 void 丢弃/PreviewPlayer 只读 errors[0]，保留作审计）；execute 循环处注释钉死**"禁加断连即取消"**（Z90——req.on('close') 全仓零命中=服务端不因断连中止的期间不变量；加了会把 504"回执丢失"退化成"工作丢失但仍扣费"）。executionApi.ts 类型同批改+PreviewPlayer（video-editor/components/ 实际路径）`errors?.[0]` 适配（`e.error ?? e.nodeId`）。

- [ ] **Step 4: 绿——配套四件**

- rearm data：`resultRef: null`（**providerTaskId 保留**——Z83 重试 query-first）；分支②重入同理；
- **settleStranded 收窄（Z76+第三轮活读+第四轮 Z98/Z102 三分支表）**：判据 `TERMINAL ∧ reservedCredits>0 ∧ completedAt<now-SETTLE_STRANDED_GRACE_MS`（具名常量；**FAILED/VOIDED 兜底不丢——:317 else void_ 分支保留**）；**三分支表（状态维度不可省）**：`SUCCEEDED∧有产物⇒补 settle（:315 语义）/SUCCEEDED∧无产物⇒rollbackStranded（Z102 第三入口——v2.2 错指 rollbackRunning 对 SUCCEEDED 恒 no-op 冻结永挂）/FAILED|VOIDED⇒void_（:317 else 现状）`；产物探测走 **ArtifactProbe（Z98 端口反转——事务外先探后开事务；探针内部 readCanvas 活读含 spool 帧无假阴性+doc 常驻内存级+忙项目不饥饿）**；产物核对白名单（text=result/image=resultUrl/video=videoUrl）；**未知 kind 不裁决只计数告警**；`consumed>0∧reservedCredits=0` 行永不进本分支；**第四不变量（FAILED/VOIDED⇒reservedCredits=0）并入 verifyLedgerInvariants 巡检**（Z102——"泛 TERMINAL"口子的结构性保险）；
- **reaper 终态投影分治（Z106+Z112——Z65 补全）**：rollbackRunning 成功后——**UX 投影不得成为装载源**：投影前判 `gateway.isDocResident(projectId)`（documents.has）：常驻才写 `writeExecStatus({status:'error', errorCode, rearmable:attempts<3, attempts})`；**非常驻跳过+`exec_projection_deferred_total` 计数**（用户重连时 alignExecFromIntents 对齐——T6 激活正是它的职责）；**errorCode 两码分诊**（`INTENT_DEADLINE_EXCEEDED`〔deadline 批=provider p99〕/`INTENT_STALE_REAPED`〔心跳龄批=进程/调度异常〕——runbook 处置行分列）；drain 503 best-effort 记数；红测两条：①无连接项目收敛⇒退款成立∧**doc 未被装载**∧deferred+1∧重连后投影 error（**改前红=withDoc 批量装载=故障自放大正撞 E39/heap 闸**）②有连接项目⇒投影即时可见；**钱事实（settleStranded 探针）允许强制装载但有界**：每次 sweep 限探测条数+`yjs_doc_loaded_by_reconciler_total` 计量（heap 闸原因可归因）；
- 三查① resultRef 判据改 doc 事实（spec §9.5）；第三不变量聚合进 verifyLedgerInvariants（VOIDED∧creditsConsumed>0∧无 refund 行⇒drift+WARN）；
- nodeAlive 守卫覆盖四处产物写入点（`modules/ai-download/`〔路径〕+ai-image-edit:171+lighting:231 前——`artifactDiscardedTotal.inc({cause:'node-deleted'})`）。

- [ ] **Step 5: 跑测+census+commit**

```bash
pnpm --filter api test:int -- deliver-refund exec-partial-success
grep -rn "emitExecutionComplete" apps/api/src apps/web/src --include="*.ts"   # 清零（含 5 处 spec 夹具同步删）
git add -A && git commit -m "feat(y0b-2): T5 rollback 双入口（rollbackRunning/rollbackDeliveryFailed——Z92 竞态封死+lockBalance 前置+checker 加固）+complete→settle→deliver+runIntentLifecycle 收口+真单出口+终态投影必达含 skipped（gated≠1/written:false 补 error 投影——Z95）+error 投影携 errorCode/rearmable/attempts+emit 删除+settleStranded 收窄活读（套利防回归+忙项目不饥饿）+rearm 保留 providerTaskId+errors 契约（红相九族留档）"
```

---

## Task 6: 信封清剿前置→regenToken 幂等全协议+身份字段补全+claim ②最新回放+intentRecord 族退役

**Files:**
- Modify: `execution.controller.ts`（intents 手包删+DTO regenToken+**enqueue 端点 regenToken 入 job.data——Z91**）、`execution.types.ts`（ExecutionJobData **增 regenToken 字段**——与 T7 删 sv 字段互不冲突）、`execution.processor.ts`（**execute 第 5 参 opts 传 {regenToken, jobId}——Z91**）、`ai-image-edit.controller.ts`（replayed 手包删+params 身份字段+claim 传 token）、`lighting.controller.ts`（五处手包删+params 身份字段——**实际路径 modules/ai-image-edit/lighting/**）、`generation-intent.service.ts`（**claim ⓪ RUNNING 闸——Z94**+①②三入口+gestureKey 落列）、`normalize-intent-params.ts`（白名单身份字段）、`execution.service.ts`（三 claim 调用点 token 传递——`isFirstExec/execIdx` 删）、`video-project.service.ts`（retakeId→regenToken 重定位）、web：`utils/intentRecord.ts` 删（三导出 newIntentId/currentIntentId/intentRotateMessage——**六消费文件**：ImageGenNode:32/ImageExtConfigPanel:7/VideoConfigPanel:11/ImageConfigPanel:7/TextConfigPanel:7/**PreviewPlayer:13〔实际路径 video-editor/components/〕**）+六面板+`CanvasView.tsx`+`ImageGenNode.tsx`（**编辑三入口裸 fetch :662-666 改走 apiFetch 形态**+lastSubmitRef:215/newIntentId:630/intentRotateMessage:670 三处退役+编辑三入口恒手势）+`PreviewPlayer.tsx`（retakeId→gestureToken+errors 结构化消费）+`executionApi.ts`（token 字段——enqueueWorkflow 与 executeGroupNodes 双管道）+`client.ts`（无改）+`canvasCollabRuntime.ts`（alignExecFromIntents 激活后核对）
- Test: Create `group-idempotency.int.spec.ts`（**十三用例**+身份完整性表驱动）+web `regen-token.spec.ts`+`envelope-shape.spec.ts`

- [ ] **Step 0: 只读探针**

```bash
grep -rn "currentIntentId\|intentRecord\|INTENT_CONTEXT_MISMATCH\|isFirstExec\|newIntentId\|intentRotateMessage\|lastSubmitRef" apps/api/src apps/web/src --include="*.ts*" | grep -v spec   # 退役面清单（v2.2 补后三项——Z95/census 面扩大）
grep -rn "code: 0, data:" apps/api/src --include="*.ts" | grep -v spec | grep -v interceptor     # 手包 6 处定位（interceptor 实际路径 src/interceptors/transform.interceptor.ts）
grep -rn "originalImageId" apps/api/src/modules/ai-image-edit --include="*.ts" | head -5          # lighting 实际路径（v2.1 探针路径笔误修正）
grep -rn "fetch(" apps/web/src/pages/canvas/components/ImageGenNode.tsx | head -3                  # 裸 fetch 定位（:662-666）
```

- [ ] **Step 1: 信封清剿（Z78——token 轮换的硬依赖，先落）**

删 6 处手包（execution.controller:59/ai-image-edit:49/lighting:46/52/56,**69**,71——统一 `return 裸值`交全局拦截器）；补：

```ts
// envelope-shape.spec.ts
it('intents 端点 body 单层：data 即数组（非 {code,data} 再包）', async () => {
  const res = await req.get(`/execution/intents?projectId=${pid}&nodeId=${n1}`);
  expect(res.body.code).toBe(0); expect(Array.isArray(res.body.data)).toBe(true);   // 改前红：data.data 双层
});
it('fetchNodeIntents 消费面：rows 为数组（alignExecFromIntents 激活后对齐成功）', async () => { /* web 侧 mock 断言 latest.intentId 写入 */ });
```

静态锚：`grep -rn "code: 0, data:" apps/api/src | grep -v transform.interceptor` 清零。

- [ ] **Step 2: 身份字段补全（R3-P0-1——regenToken 的前置）**

```ts
// normalize-intent-params.ts——白名单语义从"实读外呼参数"改为"稳定操作身份（输入集）"：
// 原注释拒绝的是 presigned URL（会轮换）；fileId/maskFileId/originalImageId 是 Media 行 id（稳定）。
// **v2.2 因果注释修正（第三轮 P1）**：身份字段的价值=「参数变⇒idemKey 变」——error 保留 token+终态前
// 重试复用场景下 mask 变更必须换键（否则同 token 异 mask 命中 FAILED rearm=语义错位）；防回放已由
// 编辑链恒 token 结构性保证，非本表职责。**主链禁补 fileId**（image/video 白名单维持现状）：
// fileId 由 ai-download.processor:116 异步回写——claim 时刻新生成节点无 fileId，入哈希=同一操作
// 下载前后两键（重试即新行重扣费）。主链身份=imageUrl（生成即存的稳定串）。
const WHITELIST: Record<string, string[]> = {
  text: ['model', 'prompt'], image: ['model', 'prompt', 'extraPrompt', 'style', 'resolution', 'imageUrl'],
  video: ['model', 'mode', 'prompt', 'imageUrl', 'startImageUrl', 'endImageUrl', 'imageUrls', 'ratio', 'quality', 'duration', 'audio'],
  outpaint: ['fileId', 'rect', 'imageWidth', 'imageHeight'],          // +fileId（基底图身份——claim 时已存在）
  erase: ['fileId', 'maskFileId'],                                      // 空集→双身份（改前 sha256('{}') 全局常量）
  redraw: ['fileId', 'maskFileId', 'prompt', 'strength'],
  lighting: ['originalImageId', 'prompt'],                              // +图身份
};
// 表驱动身份完整性红测：每 kind 的 IDENTITY_FIELDS ⊆ WHITELIST[kind]（新增 kind/字段自动受检）
```

三 controller params 构造同步（erase 传 {fileId, maskFileId}；outpaint/redraw 加 fileId；lighting 加 originalImageId）。

- [ ] **Step 3: claim 三入口+DTO+服务端校验（Z79）**

```ts
// claim（generation-intent.service.ts）——Z94 ⓪ 前置+三入口（regenerate 布尔已退役——token 存在即手势）：
// ⓪ 同 nodeId 存在 RUNNING 行且 **!(row.jobId != null && row.jobId === currentJobId)** ⇒ NodeBusy
//    （零新行零回放——partial unique 已保证至多一行，一次索引查）。**Z104 合取固化（第四轮）**：
//    null 永不等于 null——jobId 相等是 BullMQ 同 job 重排的唯一凭据，缺省不构成凭据（禁 `?? null`
//    归一化——那会让同步路径双击变可重入续跑=双外呼双扣费；现状 :90 `input.jobId && ...` 合取实测✓）。
//    **为什么必须在②之前**：②只查 SUCCEEDED 且回放不产生 INSERT——partial unique 对它无力；
//    "重新生成"RUNNING 中另一标签页普通点击⇒②命中旧 SUCCEEDED⇒回放旧产物写 doc⇒新产物覆盖=画布倒退闪回。
// ① 有 token：findUnique({where:{idemKey: deriveIdemKey({...基础, regenToken: token})}}) → 五分支状态机
//    （RUNNING 同 jobId 续跑/异 jobId NodeBusy；SUCCEEDED→created:false 重放；FAILED/VOIDED 同键 rearm
//    ——**error 后同 token 重试命中此臂=免费 rearm，attempts 1→2→3 后 INTENT_EXHAUSTED**〔Z95〕）
// ② 无 token：findFirst({projectId,nodeId,kind,paramsHash,status:'SUCCEEDED'}, orderBy createdAt desc)
//    命中 → 重放**最新**一次（修复 regenerate 后普通点击回放第一版旧产物的倒退 bug）
// ③ 否则：findUnique(content 键 'run' 段) → 状态机；miss → create（RUNNING partial unique 挡并发⇒NodeBusy）
// create data 补 gestureKey: token ?? null；三入口（claimForNode/ai-image-edit/lighting）传 token。
// intentClaimResultTotal.inc({result: 'replay'|'rearm'|'new'|'busy'})（Z85）——claim 出口全覆盖。
// DTO：regenToken?: string——形态校验 ^[0-9a-zA-Z_-]{8,64}$，非法 ⇒ 400 IDEMPOTENCY_TOKEN_INVALID（禁静默忽略）。
// **body 参数走 zod 内联解析（第四轮：body-param-ratchet 只查增长——改 inline 类型会新增棘轮条目；
//   zod 内联=移出 inline 桶+与 spec"DTO zod"措辞一致）；T6 删 ai-image-edit inline 的 intentId 与
//   execution.controller:26 的 x-intent-id 头（Z103 后无消费者——census 加符号）。**
// Z91 enqueue 管道三处：ExecutionJobData 增 regenToken；enqueue 端点 body.regenToken ?? null 入 job.data；
// processor execute(projectId, nodeId, userId, undefined, { regenToken, jobId })。
// **多节点组执行的 token 路由=整批施加**（idemKey 含 nodeId 故无碰撞——注释钉死；禁"落在首个节点"隐式规则）。
```

- [ ] **Step 4: web token 助手+按钮手势态（Z79 生命周期四态）**

**T6 显式动机（Z118 第五轮补）**：现状 `lastSubmitRef.current?.failed` 门（ImageConfigPanel:97/ImageGenNode:628/PreviewPlayer:57）是**组件 ref 记忆——刷新即丢**⇒失败后刷新页面再点=新 id 新扣费（用户以为在重试实际付费重来）；`held 一律上送`（sessionStorage 跨刷新存活）正好修它——写成红测："失败→刷新→再点⇒同 token 免费重试（改前红=新 id 新扣费）"。

```ts
// utils/regen-token.ts（intentRecord 族的全部残余——Z95 形态：held 一律上送+轮换判据单源=doc 投影）
const key = (pid: string, nid: string) => `flowweb:regen:${pid}:${nid}`;
export function gestureToken(pid: string, nid: string): string {      // 惰性铸造
  const k = key(pid, nid); let t = sessionStorage.getItem(k);
  if (!t) { t = crypto.randomUUID(); sessionStorage.setItem(k, t); }
  return t;
}
export const storedToken = (pid: string, nid: string): string | null => sessionStorage.getItem(key(pid, nid));
export function rotateToken(pid: string, nid: string): void { sessionStorage.removeItem(key(pid, nid)); }
// 面板（六面板同型）——轮换/上送判据**单源=doc 投影**（服务端权威跨刷新存活——Z95）：
const exec = useNodeStore((s) => execStatusView.selectExecStatus(s, nodeId));   // 真签名 (s, nodeId)
const projection = useNodeStore((s) => s.nodes[nodeId]?.exec);                  // {status, errorCode?, rearmable?, attempts?}
const held = storedToken(pid, nodeId);
const onClick = () => submit(
  held ? { regenToken: held }                                        // error 后重试/在飞复用——免费 rearm（Z95 held 一律上送）
       : (exec === 'done' || projection?.rearmable === false) ? { regenToken: gestureToken(pid, nodeId) } : {});
// 轮换 useEffect（done 或 error∧rearmable:false——EXHAUSTED 投影机器码，刷新后不自锁）：
useEffect(() => {
  if (exec === 'done' || (exec === 'error' && projection?.rearmable === false)) rotateToken(pid, nodeId);
}, [exec, projection?.rearmable]);
// 按钮三态文案：error→「重试（剩 N 次）」（projection.attempts）/done→「重新生成」/otherwise→「执行」。
// 编辑三入口（ImageGenNode handleGenerate）：**裸 fetch :662-666 改走 apiFetch 形态**（withSyncRetry+
// envelope 一致+errorCode 分型——付费面与面板路径行为一致）；lastSubmitRef/newIntentId/intentRotateMessage
// 三处退役（census 锚）；每次应用恒带 regenToken（生成性重跑——终态前重试复用同 token）。
// video-project：retakeId 语义重定位为 regenToken（execute opts）——DTO 必填与 dto.spec:41 红测试零改动。
// execute 签名：execute(projectId, nodeId, userId, nodeIds?, opts?: { regenToken?, jobId? })——sv 形参删。
```

- [ ] **Step 5: 红用例（regenToken 十用例——裁定 4 验收）**

```ts
// group-idempotency.int.spec.ts（真库）——v2.2 十三用例（Z91/Z94/Z95 增补；判别性断言=行身份非"零扣费"）
describe('Y0b-2 T6：regenToken 幂等（裁定 4）', () => {
  it('①同参数二次 execute（无 token）→ 零外呼零新增扣费+投影补齐（最新回放）', async () => {});
  it('②新"客户端上下文"（同参数新请求）→ 同上（跨标签/跨设备结构性生效）', async () => {});
  it('③同参数 enqueue 与组执行交叉 → 同行一次扣费（跨路径）', async () => {});
  it('④改 prompt 重试 → 新行新扣费（无 INTENT_CONTEXT_MISMATCH——改前红 409 死路）', async () => {});
  it('⑤显式 token（done 后重新生成）→ 新行新外呼新扣费', async () => {});
  it('⑥同 token 丢响应重试 ×3 → 恰一次外呼一次扣费+第二次起 replayed:true（改前红：服务端 nonce 双扣）', async () => {});
  it('⑦token 撞 RUNNING 行 → NodeBusy 零新行（partial unique 结构性挡）', async () => {});
  it('⑧EXHAUSTED 后新手势 token → 新行（attempts 不共享）', async () => {});
  it('⑨erase 不同 maskFileId → 新 idemKey 新行（改前红：空 whitelist 同键回放旧产物）', async () => {});
  it('⑩token 形态非法（>64/非法字符）→ 400 IDEMPOTENCY_TOKEN_INVALID 不静默（含 regenerate 后无 token 普通点击→最新回放断言）', async () => {});
  // Z91 enqueue 管道（改前红：五面板全走 enqueue 而管道未接=静默回放旧产物）：
  it('⑪经 enqueue 的"重新生成"（regenToken 入 job.data）→ 新行新外呼新扣费——非回放', async () => { /* enqueueWorkflow 带 token 断言 */ });
  // Z94 claim ⓪（改前红：RUNNING 在飞+无 token 普通点击=②回放旧产物写 doc=画布倒退）：
  it('⑫RUNNING 在飞+无 token 普通点击 → NodeBusy 非回放（断言 doc 产物未被旧版覆盖）', async () => {});
  // Z95 error 保留 token（判别性断言=行身份：行数恰 1/attempts 推进/submit 次数——"零扣费"两设计下都成立）：
  it('⑬error 后同 token 重试 → 命中 FAILED 行免费 rearm：同一行（row.id 不变）、attempts 1→2、provider submit 恰 1 次（query-first 命中已存在任务）、providerTaskId 保留、零新增扣费（改前红：error 轮换⇒新行 attempts 恒 1+重新 submit）', async () => {});
});
// 身份完整性表驱动（改前红：erase 空集）；既有回归锚：video-project.dto.spec:41+regenerate.spec:40-43 保持绿。
// web regen-token.spec.ts：held 一律上送（error 后两请求体同 token）→done 轮换（第三击新 token）→
//   EXHAUSTED（投影 rearmable:false）后刷新页面再点⇒新 token（不自锁——投影跨刷新存活的验收锚）。
```

- [ ] **Step 6: 跑测+census+commit**

```bash
pnpm --filter api test:int -- group-idempotency && pnpm --filter web test -- regen-token envelope-shape
grep -rn "INTENT_CONTEXT_MISMATCH\|isFirstExec\|intentRecord\|currentIntentId\|newIntentId\|intentRotateMessage\|lastSubmitRef" apps/api/src apps/web/src --include="*.ts*" | grep -v spec   # 清零（v2.2 补后三项——Z95）
git add -A && git commit -m "feat(y0b-2): T6 regenToken 幂等全协议——信封清剿 6 处前置+身份字段补全（erase 空集根修+主链 fileId 禁入注释）+claim ⓪ RUNNING 闸（Z94）+②最新回放+enqueue 三处管道（Z91）+gestureKey 审计列+token 生命周期（error 保留/rearmable 投影单源/held 一律上送——Z95）+编辑链裸 fetch 改 apiFetch+retakeId 重定位+intentRecord 族七符号全退役（十三用例红绿留档）"
```

---

## Task 7: SV 门移受理端点+canExecute 硬态+反应式重发+sv 全链退役（单 commit）

**Files:**
- Modify: `execution.controller.ts`（execute/enqueue 门+DTO stateVector body）、`ai-image-edit.controller.ts`+`lighting.controller.ts`（claim 前门）、`collab-document.service.ts`（sv/waitForSV/sv-wait.metrics 删+readServerSV 补）、`execution.processor.ts`+`execution.types.ts`（**ExecutionJobData 删 SV 字段——删除非改名**）、web `executionApi.ts`（svHeaders 删+body stateVector+withSyncRetry）、`syncStatus.ts`（canExecute 硬态）、`canvasCollabRuntime.ts`（forceSyncAndWaitUnsynced+writeFrozen 字段）、六面板+CanvasView（canExecute 消费）
- Delete: `apps/api/src/modules/collab/sv-wait.metrics.ts`
- 同 commit: spec §10 metric-names 删 yjs_sv_wait_timeout_total+`check-spec-consistency.mjs` DENYLIST 增 `x-yjs-sv`/`waitForSV`/**`INTENT_CONTEXT_MISMATCH`/`isFirstExec`（v2.2——intentRecord 族进 spec 门禁，census 手工 grep 与 DENYLIST 双轨收敛防正文措辞漂移）**（**加 token 前先把 spec 正文行内 token 迁入围栏/注释**——stripForDenylist 不剥行内反引号：29-32 实证）
- Test: Create `sv-admission.int.spec.ts`+web `can-execute.spec.ts`；Modify `execution.controller.spec.ts`

- [ ] **Step 0: 只读探针**

```bash
grep -rn "x-yjs-sv\|svBytes\|sv\?:" apps/api/src apps/web/src --include="*.ts" | grep -v spec    # census 十点基线
grep -n "recomputeConnStatus" apps/web/src/stores/canvasCollabRuntime.ts | head -3
```

- [ ] **Step 1: 红用例（SV 门四用例——红相=客户端当前 SV；canExecute；反应式重发）**

（v2 三组用例原样：红①改 prompt 立即 execute 携编辑后当前 SV→SYNC_PENDING 零外呼零冻结零 intent 行；②编辑已上行→放行；③改上游执行下游→SYNC_PENDING；④enqueue 门在 controller+job.data 零 SV 断言；canExecute 四态+无 pendingLocalEdits 字段断言；withSyncRetry 三例——409→forceSyncAndWaitUnsynced→重发恰一次/再 409 抛出不循环/已同步零 forceSync。）

- [ ] **Step 2: 绿——受理端点门（四端点同型）+readServerSV**

```ts
// execution.controller.ts（execute+enqueue 两端点；ai-image-edit/lighting 两 controller 同型）
// 第四轮（P1）：stateVector **DTO 必填**——缺省静默 return 是垫片（fail-open 回到旧行为）；缺 ⇒ 400
// SYNC_STATE_VECTOR_REQUIRED。video-project retake=**进程内直调**（video-project.service:90-102 直调
// execute，不经 controller）——SV 门天然不在其覆盖面【既成事实进偏离表，表述修正 Z118：非"端点豁免"；
// 豁免理由成立=执行输入全部由服务端从 doc 读出，客户端未同步内容不参与判定】；e2e/preflight 工具面
// 同批补 SV；Σ 计算与 SV 门共用同一次 doc 读（防组执行双装载），deadlineForKind 单源=exec 配置模块。
private async assertSyncAdmitted(projectId: string, stateVector: string): Promise<void> {
  const clientSV = new Uint8Array(Buffer.from(stateVector, 'base64'));
  const serverSV = await this.collabDoc.readServerSV(projectId);   // withDoc 内存级（发起方必有 WS⇒doc 常驻）
  if (!svDominates(clientSV, serverSV)) {
    syncPendingTotal.inc({ phase: 'first' });
    throw new BusinessException('SYNC_PENDING', '本地内容尚未同步到服务端，请稍后重试', HttpStatus.CONFLICT);
  }
}
// collab-document 补 readServerSV(projectId) = withDoc(doc => Y.encodeStateVector(doc))
// ExecutionJobData（execution.types.ts）：**删除** sv/stateVector 字段（enqueue 门入队时判定——job 载荷零客户端状态）；processor :30-32 svBytes 删。
```

- [ ] **Step 3: 绿——客户端三件**

```ts
// syncStatus.ts（裁定 2：只留硬态）
export const canExecute = (s: CanvasState): boolean =>
  canEdit(s) && s.connStatus === 'connected' && !s.writeFrozen;
// writeFrozen 进 canvasStore 默认 false（Z55——Y0b-5 接线既定；gateway 无 resumed 下发+drain 窗口行为登记 T9 残余）

// canvasCollabRuntime.ts
/** Z67：等 unsyncedChanges 归零边沿——禁用 'synced'（一次性握手事件，dist :862-869 同态提前 return 不 emit）。 */
export function forceSyncAndWaitUnsynced(timeoutMs = 2_000): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => { provider?.off('unsyncedChanges', onZero); resolve(false); }, timeoutMs);
    const onZero = ({ number }: { number: number }) => {
      if (number === 0) { clearTimeout(t); provider?.off('unsyncedChanges', onZero); resolve(true); }
    };
    provider?.on('unsyncedChanges', onZero); provider?.forceSync();
  });
}
// executionApi.ts——Z56 修订：反应式（先发→409 才同步重发恰好一次；超时也重发——claim 前判定零代价）
async function withSyncRetry<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e?.errorCode !== 'SYNC_PENDING') throw e;
    await forceSyncAndWaitUnsynced(2_000);
    try { return await fn(); }
    catch (e2: any) { if (e2?.errorCode === 'SYNC_PENDING') syncPendingRetryObserved(); throw e2; }   // 再拒=服务端停滞信号（观测经诊断 ring）
  }
}
```

（六面板+组执行按钮 `disabled={!canExecute}` 消费+latch 防重复提交。）

- [ ] **Step 4: sv 十点删除（同 commit）**

（v2 清单原样：readCanvas sv 参数+waitForSV+sv-wait.metrics.ts 文件+controller/processor/types/web svHeaders——`getStateVector()` web 函数保留 body 传参；controller.spec 两用例改 stateVector body。）

- [ ] **Step 5: 跑测+census+DENYLIST 围栏迁移+commit**

```bash
pnpm --filter api test:int -- sv-admission && pnpm --filter api test -- execution.controller && pnpm --filter web test -- can-execute executionApi
grep -rn "x-yjs-sv\|svBytes\|sv\?:" apps/api/src apps/web/src --include="*.ts" | grep -v spec | grep -v "svSatisfied\|svDominates"   # 清零
pnpm verify    # DENYLIST 新 token 零命中（spec 围栏迁移后）
git add -A && git commit -m "feat(y0b-2): T7 SV 门移四受理端点+canExecute 硬态+反应式重发（unsyncedChanges 边沿）+sv 全链退役同 commit+DENYLIST 增补（围栏迁移前置）"
```

---

## Task 8: admin 幂等（advisory 锁+前置查形态——Z113）+E71+月界收尾+Σdeadline 门撤销→硬闸+nginx 钉仓+EXEC_MAX_NODES 移入（Z90/Z117）

**Files:**
- Modify: `team-credit.service.ts`（T0 已改道——本 Task 仅核对 quota 读点 tx 纪律）、`admin-subscription.controller.ts`+`admin-subscription.service.ts`（Idempotency-Key DB 列+skipDuplicates+**回放返回当前余额**）、`video-work.controller.ts`+`video-work.service.ts`+`collab.gateway.ts`（E71 三件）、`execution.controller.ts`（**EXEC_MAX_NODES+EXEC_SYNC_HARD_CAP 硬闸——Z90 替换原 Σbudget 准入门**；T6 已去手包，此处加校验）
- Create: `deploy/nginx/api-location.replace.conf`（**Z90 /api 段墙钟钉仓**）
- Test: Create `admin-idempotency.int.spec.ts`（**必须 .int 后缀**——真库断言落单元池〔无 DATABASE_URL〕必红；**Z118：check-int-coverage pathspec 一行修根级**〔`git ls-files "apps/api/src/**/*.int.spec.ts" "apps/api/src/*.int.spec.ts"`——修门禁非绕〕+FILES_MIN 逐文件补条+保持 `(hasDb ? describe : describe.skip)` 约定〔判据③ numPendingTests===0〕）；**CI collab-core job 同批显式 `COLLAB_FAKE_AI=1`**（Z93 兜底——int 零 .init() 实测断言不触发，防未来加 .init()）

- [ ] **Step 1: 红用例（admin 回放四用例——Z87+v2.2 当前余额修订）**

```ts
describe('Y0b-2 T8：admin Idempotency-Key（DB 列+回放）', () => {
  it('同 key 二次 grant → 200 {replayed:true, transactionId 原值, credits/subscriptionCredits=同事务读当前两池余额（v2.2：不回历史 balanceAfter=台账行发生时值⇒UI 显示陈旧数字）}+台账恰一行+余额一次', async () => {});
  it('同 key 改 amount 或换操作员 → 409 IDEMPOTENCY_KEY_REUSED（一致性含 operatorUserId）', async () => {});
  it('不带 key 两次 → 两行（Z9 合法重复面维持）', async () => {});
  it('入账成功响应丢失重放 → 返回原 transactionId（崩溃窗口闭合——advisory 锁+前置查同事务回读〔Z113〕）', async () => {});
  it('并发同键恰一行台账+两次返回同一 transactionId（改前红=500——Z113）', async () => {});
});
```

- [ ] **Step 2: 绿——admin 幂等（Z87+Z113 第五轮重构：advisory 锁+前置查——**全文清剿 skipDuplicates**〔T8 旧文的"createMany skipDuplicates+count 判胜"已撤销：mutate :91-94 先加钱后 :95 写行，吞唯一冲突=钱包已变流水缺失击穿不变量①；且前置查对并发同键无效——两方都 miss⇒后者撞唯一⇒500〕）**

```
pg_advisory_xact_lock(hashtext('admin:'+key))   // 事务首句——收并发窗（admin 幂等路径唯一取锁者无 ABBA）
→ lockBalance → findFirst({idempotencyKey})
→ 命中⇒指纹比对（type/amount/creditType/operatorUserId——不一致 409 IDEMPOTENCY_KEY_REUSED）
        ⇒回放 {replayed:true, transactionId 原值, credits/subscriptionCredits=同事务当前两池}
        （replayed 与 noop 语义分离——仓内 noop=零额不写行，混用调用方分支错）
→ miss⇒原样 create（reversesId @unique/money_in_once 抛错 backstop 全保留——真正的"重复事件"闸）
```

红测：**并发同键恰一行台账+两次返回同一 transactionId**（改前红=500）+同 reversesId 二次入账仍抛错；UI key 用户手势生成+在飞/失败保留+成功轮换——与 regenToken 同范式。

- [ ] **Step 3: 绿——E71 三件+病态批硬闸+nginx 钉仓+月界收尾核对（Z90 全量替换原 Σbudget 门）**

- `video-work.controller.ts:36-39` 加 `@Throttle({default:{limit:30,ttl:60_000}})`；process 缓存=Redis 300s 跨进程层+SnapshotDocCache 进程内单飞（T3 原语）+invalidate 双清；gateway store 成功路径 emit `'canvas.doc-saved'`（EventEmitter2）+video-work `@OnEvent` 双层失效；
- execute/enqueue DTO 校验：`nodeIds.length ≤ EXEC_MAX_NODES`（**Z117：env 键+spec 行随本 Task 定义**——键随读者同批，T1-T7 无读者不死键）**且** `Σ deadlineForKind(node.kind) ≤ EXEC_SYNC_HARD_CAP(默认 1_800_000)`（超限 4xx **`EXEC_SCOPE_TOO_LARGE`**〔第四轮改名——EXEC_SCOPE_BUDGET_EXCEEDED 是已撤销 55s 门的旧名，考古歧义〕——Z90 判据=请求时长最坏上界非耗时预估；默认值语义="同步组 ≤2×video(900s)"规模上限；只挡 20×video=5h 类资源钉死批；**相对关系由启动断言锁**〔T1 Step 3 已注〕：HARD_CAP≥max(所有 EXEC_DEADLINE_*_MS) 否则拒启——zod 不设硬地板防拦合法上调；原 `EXEC_SYNC_BUDGET_MS(55s)` 门**撤销**登记防翻案；**删门安全性依赖 T6 claim ② 同批生效**〔执行序 T6<T8 ✓〕）；
- **`deploy/nginx/api-location.replace.conf` 新建**（与 /collab snippet 同族——整条同步链唯一墙钟：apiFetch 无 timeout/Node requestTimeout 只管收请求/server.timeout=0 实测均非上界）。**第四轮修正（N-2）：v2.2 的 1200s < HARD_CAP 1800s=每个合法 2×video 批必 504——自相矛盾**：

```nginx
location /api {
  proxy_read_timeout 1860s;   # = EXEC_SYNC_HARD_CAP(1800s) + 60s 核销/响应余量——相对式推导（禁写死单节点值：
                              # 合法批的时长上界就是 HARD_CAP 本身）。**修改 EXEC_SYNC_HARD_CAP 或任一
                              # EXEC_DEADLINE_* 必须同批重算本值**（两旋钮一条算术关系绑定——runbook
                              # 联动行+静态单测双锚）。超此值只可能是已被 4xx 挡住的病态批⇒504 只剩
                              # 回执丢失语义（服务端继续跑、产物经 doc 投影照达——spec §9.x-7）。
  proxy_send_timeout 1860s;
}
```

- **nginx↔HARD_CAP 检查脚本**（Z117④：`scripts/check-nginx-budget.mjs` 进根 verify——deploy/ 件门禁归属根 scripts，apps/api 单测写 ../../ 路径且归属不符）：读 conf 文本解析数值，断言 `≥ EXEC_DEFAULTS.SYNC_HARD_CAP + 60_000`（与 zod 默认共用同一常量——禁两处各写数值）；
- 504 用户语义=「已受理」：组执行 catch 文案"执行请求已提交，进度见节点状态"（CanvasView——v2.1 已有）+按钮忙态以 exec 投影为主判据（本地 latch 仅防重复提交）+`withSyncRetry` 只重 SYNC_PENDING **不重 5xx/超时**（现有设计保持+注释钉死"504 不当换 token 重试信号——换 token=新扣费"）；
- 月界核对（T0 已落——本步跑 monthly-used-derived 边界用例确认北京时区月界恒定绿）。

- [ ] **Step 4: 跑测+commit**

```bash
pnpm --filter api test:int -- admin-idempotency monthly-used-derived
git add -A && git commit -m "feat(y0b-2): T8 admin 幂等 advisory 锁+前置查形态（并发同键同 transactionId+指纹比对 409+当前余额回放——Z113）+E71 三件+Σdeadline 准入门撤销→EXEC_SYNC_HARD_CAP 病态批硬闸+nginx /api 墙钟钉仓（api-location.replace.conf 1860s=HARD_CAP+60s 相对式+check-nginx-budget.mjs 进 verify）+EXEC_MAX_NODES 移入（键随读者）+504 已受理语义+月界收尾（Z90/Z117）"
```

---

## Task 9: 出口汇聚+回填+spec 偏离登记

**Files:**
- Modify: `scripts/check-int-coverage.mjs`（FILES_MIN 5 文件+INT_MIN_TOTAL 按实测上调）、v8 目录 §0.2 Y0b 行、Y0b spec §9 增补+§0.4 偏离登记、`collab-ops-runbook.md`（deadline/waiting 处置行+服务器 .env 密钥步）

- [ ] **Step 1: 出口三连（verify 链不含 int——Z73）**

```bash
pnpm verify
pnpm --filter api test:int:ci        # script 名已探针确认
node scripts/check-int-coverage.mjs  # FILES_MIN+INT_MIN_TOTAL 按实测值更新后绿
```

（**第四轮修正：新 int 9 文件**——monthly-used-derived〔T0〕/ledger-trigger〔T1〕/provider-adapters〔T2〕/deadline-reaper/deliver-refund/exec-partial-success/group-idempotency/sv-admission〔T4-T7〕/**admin-idempotency**〔T8〕——全部放子目录+**先 git add 再跑**；FILES_MIN 逐文件九条+MIN_TOTAL 按实测上调〔脚本内默认字面量 check-int-coverage.mjs:13——env 可覆盖〕。）

- [ ] **Step 1.5: doc-gate canonical 收口（Z108）**

```bash
node scripts/doc-gate.mjs               # T1/T2/T3 的 spec §10 变更已在各 Task 同 commit --write-canonical——本步终核零 drift
# 若红：node scripts/doc-gate.mjs --write-canonical && git diff docs/_meta/ 人工审阅后落盘
```

- [ ] **Step 2: census 四形态+浏览器手验**

```bash
grep -rn "x-yjs-sv\|svBytes\|sv\?:" apps/api/src apps/web/src --include="*.ts" | grep -v spec | grep -v "svSatisfied\|svDominates"   # 空
grep -rn "MODEL_CONFIG\|Unknown model type\|Mock response for" apps/api/src --include="*.ts" | grep -v spec                        # 空
grep -rn "INTENT_CONTEXT_MISMATCH\|isFirstExec\|currentIntentId" apps/api/src apps/web/src --include="*.ts*" | grep -v spec        # 空
grep -n "console.log" apps/api/src/modules/execution/api-caller.service.ts                                                          # 空
```

浏览器（golden path）：①A 端改 prompt 立即点执行→一次 409 重发自愈→正常执行；②同参数再点"执行"→秒回（最新回放零扣费）+按钮变"重新生成"；③"重新生成"→新扣费新产物；**③b 快速重试 regenerate（响应超时模拟）→同 token 不双扣**；④双开标签同组执行→一次扣费；⑤断网→按钮禁用；⑥停用模型（gpt4）旧节点执行→MODEL_NOT_AVAILABLE 4xx 零冻结；⑦video-work 分享页 process 正常（**drain 冲刷完成后可读；drain 进行中 503=登记边界**）；**⑧provider 失败（拔密钥模拟）→error 投影+按钮"重试（剩 N 次）"→重试免费（rearm 零新扣费）→3 次后"重试次数已用尽"+刷新页面后重试仍不 404/409 死锁**；**⑨组执行含 video 正常放行（硬闸 1800s 不误拒单节点）**。

- [ ] **Step 3: 回填四件+偏离登记表（v2 表全保留+增补六行）**

- v8 目录 Y0b 行：plan 链接+状态+第三次 squash 登记；
- spec §9 增补残余：**attempts 农场**（同内容改一字符新行重置免费额度——限流归 Y0b-4/Y0.5）+**token 农场**（同内容每次新 token=免费重置 FAILED 额度，与 attempts 农场同源归限流域——内容基时间窗上限已驳回：与 EXHAUSTED→新 token 付费重试语义冲突〔Z95〕；观测口径=`intent_claim_result_total{result=new}` 突增）/ **drain 窗口执行**（writeFrozen Y0b-5 接线前 canExecute 不拦——点击后 writeNodeData 503+回滚，白烧一次 attempts，窗口 60s）/ **consumed>0 永未交付且无重试行**（settleStranded 收窄后不退款——重放补投影兜底，对账可见）/ **waiting 升级档处置行**（intent_deadline_exceeded_total{phase=waiting} 非零=队列积压；本次升级 attempts 不递增——非用户重试）/ **同步链墙钟**（最坏=Σ实际耗时、上界=Σdeadline；nginx 已钉仓 1200s 推导式〔Z90〕——超过=回执丢失非工作丢失：服务端不因断连中止〔req.on('close') 零命中=期间不变量，**禁加断连即取消**——会把"回执丢失"退化成"工作丢失但仍扣费"〕；根治=组执行队列化归重构工程；retake=第二同步长路径〔video-project regenerate 直调同步 execute——同步语义无法 enqueue 化〕）/ **"Σdeadline 类准入否决理由"**（超时上界非期望耗时——误拒单 image/video/regenerate；防后人重复提案）/ **SnapshotDocCache 容量上界**（本批仅 TTL 单飞——LRU 条数/字节+gauge 归 Y0c/heap 闸同族）/ **CI int 无 seed 静默直返**（ledger-invariants:59-60 findFirst null 即 return——现状非本批引入，零密钥 CI 下部分用例空跑；Z101 fixture 行自建不受影响，登记）/ **单实例假设**（readServerSV/SnapshotDocCache/prom-client/模型缓存四处依赖 PM2 instances:1〔ecosystem:11 已钉 E35〕——多实例下 SV 门拿陈旧本地 doc=假接纳/假 SYNC_PENDING，各缓存处注释+runbook 首行）/ **在飞删节点烧平台成本**（ai_artifact_discarded{node-deleted} 已埋——与 token/attempts 农场同族归限流）/ **drain 期公开读可达性**（谓词满足=drain 冲刷完成快照可读；drain 进行中 spool 有帧⇒fallback 活读撞租约 503）/ **fallback 活读装载面**（谓词 false∧doc 非常驻时分享请求触发 withDoc 装载——低频边缘，fallback 计数观测）/ **supportsTaskQuery 覆盖面**（query-first 仅对支持按 taskId 查询的 provider 成立——dashscope/hy 系 ✓；adapter 注释登记）/ **跨设备 regenerate 不去重**（token 会话级——语义正确登记）/ **replay 不入 monthlyUsed**（B 端回放 A 产物不扣费亦不计 B 月度用量=配额显式免回放——裁定 3 本意，用例固化）/ **:69 语义变更**（lighting 任务不存在手包删后 HTTP 200+code:404→真 404——前端未接线零影响，接线时禁按"200+code"写判据）/ **同步执行并发上界**（@Throttle 20/min×最坏墙钟⇒单实例在飞同步执行有界——规模化路径=enqueue）/ **totalCost 无真消费者**（响应被 void 丢弃——保留作审计）/ **E40 横幅与 writeFrozen 降级消费归 Y0b-5**；
- spec 偏离登记表（§0.4）v2 十行全保留+新增：regenToken 协议（裁定 4+v2.2 error 保留修订——spec §2.5 runId 节重写指引）/ startedAt 列（phase 判据）/ AIModel 列变更+三模型 active=false（裁定 5）/ census 行级三验 / claim ⓪+②最新回放语义（Z94）/ 跨用户内容回放语义显式声明（B 端同内容点击回放 A 产物不扣费亦不计 B 月度用量=裁定 3 本意，用例固化）/ 信封 6 处清剿+alignExecFromIntents 激活 / **rollback 双入口（Z92）+Σdeadline 门撤销→硬闸+nginx 钉仓（Z90）+error 投影 rearmable（Z95）+ledger.tx 退役（Z89）+月界北京时区**；
- runbook：`intent_deadline_exceeded_total` 持续非零处置行（phase 分布：queue=调度积压查 worker/call=provider p99.9 调 EXEC_DEADLINE_*/waiting=队列积压·本次升级不耗 attempts）+**504 处置行**（服务端仍在执行——**禁止重启/发版**〔丢尾部未执行节点〕；`GET /execution/intents`+doc exec 投影确认进度；`intent_claim_result_total{result="busy"}` 非零=幽灵执行期重复点击已被幂等吸收非资损）+**nginx 联动行**（改任一 EXEC_DEADLINE_* 必须同批重算 api-location.replace.conf 并 nginx -T 复核）+服务器 .env 三枚密钥人工步（T1 已加，本步核对——缺失=启动断言拒启=部署期暴露 ✓）。

- [ ] **Step 4:【用户确认点】出口判据对照呈报**

| 出口判据 | 载体 | 对应 |
|---|---|---|
| regenToken **十三用例**（含丢响应重试/erase 不同 mask/最新回放/token 非法 400/**enqueue 重生成〔Z91〕/RUNNING 在飞点击 NodeBusy〔Z94〕/error 后同 token rearm 判别性断言〔Z95：同行/attempts 推进/submit 恰 1 次〕**）+身份完整性表驱动 | int+web | T6 |
| 信封 6 处清剿+body 形状断言+静态锚 | vitest+grep | T6 |
| 未知模型预检零外呼+selectable 三处（fakeAi 豁免）+启动断言 fail-closed 两类密钥源 | vitest+int+启动 | T2 |
| deadline 双向+queue phase+waiting 升级（WAITING_UPGRADE_GRACE_MS 具名常量）+jobActive 不误杀 | int | T4 |
| 交付退款单事务原子性（lockBalance 前置）+reaper×settle 交错+**Z92 竞态封死（complete 后注入 reaper）**+**套利防回归**+第三不变量+**终态投影必达含 gated≠1/written:false** | int | T5 |
| 真单出口+终态投影必达（NODE_BUSY 降级/部分成功/F4）+error 投影携 errorCode/rearmable/attempts | int | T5 |
| SV 门四用例+job.data 零 SV（**regenToken 字段保留**）+census 清零 | int+grep | T7 |
| canExecute 硬态+反应式重发调用序列 | vitest | T7 |
| 触发器拦截（含 raw+DELETE 面+**FK 级联解散**）+ledgerTx 放行+**money-in 五链路冒烟+`ledger.tx(` census 清零〔Z89〕** | int+grep | T1 |
| monthlyUsed 三漂移（**成员移除保留/跨月归因/冻结计入**）+北京时区月界边界+TZ 注入 | int | T0/T8 |
| admin 幂等回放四用例（含换操作员 409+**当前余额回放**） | vitest | T8 |
| E71 三件+SnapshotDocCache 单飞+fallback 活读+fallback 计数 | vitest | T3/T8 |
| **EXEC_SYNC_HARD_CAP 硬闸（20×video 拒/单 video 放行）+MODEL_NOT_AVAILABLE 存量出口** | vitest | T8/T2 |
| **nginx /api 钉仓：api-location.replace.conf 在位+服务器 nginx -T 实测值==文件值+curl --max-time 长请求不 504+execution_group_duration_seconds 样本可见（bucket 覆盖 60/300/900s）** | 部署+手工 | T8/T9 |
| census 四形态+出口三连+浏览器手验七路径 | grep+bash+手工 | T9 |

```bash
git add -A && git commit -m "docs(y0b-2): T9 出口汇聚——int 覆盖下限+census 四形态清零（+ledger.tx/newIntentId 族）+v8 回填+spec §9 残余十九项（token 农场/同步墙钟/504 禁重启/drain 可达性/支持面等）+§0.4 偏离登记增补+runbook deadline/waiting/504/nginx 联动处置行"
```

---

## 冲击面预警（纪律 11——v2.1 修订版）

| # | 面 | 处置 |
|---|----|------|
| 1 | **squash 波及面**：四目录共存 reset 炸（Step 8.5 移出前置）/`_prisma_migrations` 恰一行断言/verify-indexes 块数快照/seed 幂等重放（create 分支 active 翻转——双钉）/MinIO 孤儿/服务器 .env 三枚密钥人工步 | T1 步骤内置 |
| 2 | **claim 判据换轨**（T1 最小化+T6 语义层两波）：listByNode/intents 端点/processor failed 钩子反查（findByActiveNode 不受影响）/claim spec 全套 where 形态 | T1 Step 7+T6 Step 0 探针 |
| 3 | **emitExecutionComplete 删除**：socketio 评估文档同步+**5 处 spec 夹具**（execution.service.spec:69 等） | T5 |
| 4 | **MODEL_CONFIG 退役**：api-caller 注入 PrismaService 后 `new ApiCallerService()` 三 spec 编译红（api-caller.service.spec/funds-four-way:116/fake-ai.spec）；密钥行级化（seed 灌值+admin UI 已有写面）；seed 裸 pricingRule.create 收口；ModelsPage provider 表单三处（slug/providerLabel） | T2 Step 0 |
| 5 | **monthlyUsed 列删除**：T0 前置改道（getBalanceView/reserve/listMembers+teamApi 类型）——T1 删列时零编译残留 | T0/T1 |
| 6 | **runIntentLifecycle 重构**：execution.service.spec 六文件 stub 形状/DI compile smoke/errors 契约（PreviewPlayer:65 真消费点） | T5 跑全量单测 |
| 7 | **writeFrozen 字段**（T7）：默认 false+Y0b-5 接线（Z55 维持）；drain 窗口行为 T9 登记 | T7 |
| 8 | **alignExecFromIntents 激活**（T6 信封修复后从 no-op 变生效）：exec 对齐行为变化需 web 测试+手验 | T6 |
| 9 | **spec §10 机械块**：env 十二键（+EXEC_SYNC_HARD_CAP——v2.2 替换 BUDGET）/指标七增一删（+group_duration/poll_stall/fallback）/DENYLIST 四 token（围栏迁移前置）——各 Task 同 commit | T1/T2/T7 |
| 10 | **funds-four-way 夹具换模型**（gpt4/sdxl→kimi/hy-image）+四夹具文件 ledgerWipe 替换+意图夹具三列默认 | T1/T2 |
| 11 | **retakeId 语义重定位**（intentId 位→regenToken）：video-project.dto.spec:41/regenerate.spec:40-43 既有红测试=回归锚（必须保持绿） | T6 |
| 12 | **三模型 active=false 产品面**：选择器少三模型（imageGen 剩 hy-image；text 剩 kimi）+存量 dev 节点 MODEL_NOT_AVAILABLE 出口+admin 可翻回 | T2/T9 手验⑥ |
| 13 | **ledger.tx() 删除的编译波及面（Z89）**：7 文件 14 处改造+personal-team-ledger 签名变更（四 processor 调用方同批）+解散事务通行证；这些路径单测 mock ledger ⇒ **int 五链路冒烟是唯一真证据** | T1 Step 4/5 |
| 14 | **enqueue 管道与 T7 的边界（Z91）**：T6 给 ExecutionJobData **加** regenToken 字段/T7 **删** sv 字段——两 Task 都动 types+processor，互不冲突但 Step 探针互相引用对方状态 | T6/T7 |
| 15 | **intentRecord 七符号退役（Z95）**：六消费文件（含 PreviewPlayer〔video-editor 路径〕）+ImageGenNode 裸 fetch→apiFetch+lastSubmitRef 重试逻辑换 held 复用——census 七符号 grep 兜底 | T6 |
| 16 | **error 投影携 errorCode/rearmable/attempts（Z95）**：writeExecStatus 终态守卫约束=必须与 status:'error' 同 patch；web 投影类型（nodeStore exec 字段）+六面板按钮三态文案同批 | T5/T6 |
| 17 | **nginx api-location.replace.conf 上线（Z90）**：与服务器现有站点配置的合并方式（replace.conf 族既有机制）；EXEC_DEADLINE_* 联动纪律进 runbook；T9 手验 curl 实测 | T8/T9 |
| 18 | **T0 的 used 语义扩大（Z96）**：RUNNING 冻结立即计入当月用量——既有 int 夹具的 RUNNING 行（ledger-invariants:170/189/214/231、team-lifecycle:30）影响他 spec quota 断言——T0 收尾跑**全量** int 留档 | T0 |
| 19 | **checker 规则②盲区+test-utils 扫描面（Z97）**：规则②正则缺 createMany\|deleteMany 同批补；ledgerWipe/wipeForTests 收进唯一写入口——**禁开 test-utils 白名单**（垫片=锚变装饰） | T1/T5 |
| 20 | **spec §10 双向门禁×canonical（Z108）**：T1/T2/T3 的 env/指标变更同 commit 进 spec 块+`doc-gate --write-canonical`——漏任何一侧=该 Task verify 必红（缺/多均红+canonical-drift） | T1/T2/T3/T7/T9 |
| 21 | **body-param-ratchet 棘轮（第四轮）**：T6/T7/T8 的新 body 字段全走 zod 内联解析（移出 inline 桶）——改 inline 类型=新增棘轮条目必红；fake-ai.spec/env-single-source 两被动 spec 同批改写非随删 | T2/T6/T7/T8 |
| 22 | **投影契约三件跨端（Z95/Z99/Z106）**：error 投影携 errorCode/rearmable/attempts〔api〕+ExecStatusEntry 三字段与白名单加 skipped〔web〕+守卫代次化〔collab-document〕+reaper 投影〔intent-reconcile〕——四处不同步任一则红测或编译红 | T5/T6 |
| 23 | **migrate diff 棘轮与不可逆步骤（Z107/Z115）**：Step 0 基线探针在**任何移动/删除之前**跑（master 原地）；check-migrate-diff.mjs 进 verify+金标只许收窄；**DDL/datamodel 机械对账（Z114）**：起草 SQL 索引名集≡Step 2 Prisma 派生名集∪金标——status_completedAt_idx 已存在禁重建+[status,updatedAt] datamodel 删+性能索引保持 partial 不声明 | T1 |
| 24 | **HARD_CAP↔nginx 算术绑定（第四轮 N-2+Z117④）**：conf 数值=HARD_CAP+60s 相对式+check-nginx-budget.mjs 进根 verify（与 zod 默认共用 EXEC_DEFAULTS 常量）——任一旋钮单独改动被 verify 拦 | T8 |
| 25 | **裁定—正文—工具面三处同步纪律（第五轮收尾纪律）**：每轮新增 Z 裁定后 `grep -n "<被撤销标识符>" 全文` 把 Step 正文/commit message/残余登记的旧表述清一遍（本轮该 grep 抓出 skipDuplicates×4/1200s×2/追加五名×1/maxStalledCount×2）；Z 表裁定与 Step 正文冲突时**以 Step 正文为准修订 Z 表加撤销标注**——防执行者按任一侧落地 | 全程 |
| 26 | **Z109 接线（第五轮）**：claimForNode 拆 gestureToken/intentId 两参（execution.service:53 兜底拆除+三处 isFirstExec 门删）——T1 红测直调 service（面板 T1 期总带新 id）；normalizeRegenToken 随 T1 落（截断+warn） | T1 |
| 27 | **Z111/Z112 投影三件跨结构（第五轮）**：守卫 fail-closed 两子句〔collab-document〕+11 处调用点+failed 钩子换序〔execution.service+两 processor〕+reaper 分治 isDocResident〔intent-reconcile+gateway〕+alignExecFromIntents 兜底〔T6〕——五处不同步任一则红测或编译红 | T5/T6 |


---
