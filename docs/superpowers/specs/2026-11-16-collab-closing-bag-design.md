<!-- doc-status: active | created: 2026-11-16 | confirmed: 2026-11-16（用户确认 v12——十一轮评审裁定全采纳；v12 修订与 v7-v11 留痕见 §0） -->
# 卡② 收口袋（TD-32/33 遗留 Minor+观测面补全）设计 spec v12

> 范围：两卡短批**卡②**。八项=三枚指标（import 覆盖 gauge/barrier 拒绝计数/backfill_remaining scrape 化）+两处装置（drill settle/sentry mock×2）+一处门禁+一处权威文档+销项表（随本 spec 入库）——**唯一机制项=1.5 删除 shadow 双轨+认领拍 fence 化（第二引用面退役——删除权威仍=围栏快照+isMediaReferenced+事务内复检三层，唯一例外=擦除认领拍纳入 prepare 围栏）**；逐项独立 TDD（适用项红先行）、**独立 commit、独立评审**；批末出口=verify full。
> 依据：用户 2026-11-15 卡②裁定+卡① spec §5 登记+2026-11-16 十一轮评审裁定（全部事实主张实锚核验命中）。

## 0 评审留痕

**第一轮（v1→v2）**：六处修正采纳（COLLAB_PORT 引号洞/只改权威源/scrape collect/Counter+「拒写留队非弃帧」/shadow 闭集 reason/drill 同拍落定化）；Minor×8 零代码裁定；我方两处事实错误纠正+三处勘误回敬；元裁定=指标无 team/personal/项目 id 标签+开发期直接替换不留旧名。

**第二轮（v2→v3）**：我方两处事实错误纠正（deletion-barrier.metrics 15/25——锚保持；int 红测锚定 ⑧ 非 ②）；锚原则入纪律（余量没用完不改锚；唯一抬锚=persistence 1241→1242）；红测 Prometheus 化；shadowSkipOf 串扰同 commit 修；销项表随 spec 首 commit。

**第三轮（v3→v4）**：P1×3（数字分支形态洞/sentry mock 扩两文件/当前段双锚）+P2×8 采纳；我方三处勘误回敬（无引号数字现仓零命中——分支=堵未来形态洞；census 不在 §3 扫描集；评审正则位数有误）。

**第四轮（v4→v5）**：shadow 对拍移出围栏+数字档对称化+撤「待回填」第三态+settle 判别式+双 gauge；charter 仓内不存在勘误。

**第五轮（v5→v6）**：移位块唯一形态禁读 expiresAt/撤 extra 存在守卫（controlledRebuildForMedia 查 MediaBinding）/⑫ 二次画布装置/dirty gauge async collect/runbook 时态句+§13.3；我方慢扫描配比补正（3.5s 窗+4s sleep 才过预算门）。

**第六轮（v6→v7，K8 终态反转——「移位」作废，四~五轮方案留痕不删）**：
- **删除权威三层在役实锚**：①barrier.prepare 六步序（deletion-barrier.service.ts:139-189）——oracle 预扫→CAS+seal→逐项目 flushThrough 收敛（bail flush-timeout）→③'陈旧 header 重扫→③''ACTIVATE（appendBatch 面封=决策宇宙冻结）→④`decideTeamReferenceSnapshot`→返回前全程预算复检；②`decideTeamReferenceSnapshot`（media-reference.service.ts:90-127）九腿校验链——header-missing/not-complete/stale-verified-seq/generation-mismatch/epoch-stale+**binding-watermark-lagging(:113)+binding-dirty(:114)**+pgseq-moved CAS 复读；③`isMediaReferenced`（:130-173）=registry 臂∪Binding 臂∪**Oracle 臂**（join CanvasReferenceOracle PG doc 证人+决策级 header 校验——陈旧 header 流到不了本臂，时序兜底头注 :15-17 自书）。
- **旧面=结构性冗余**：旧面 PG 快判各臂⊆registry 臂；doc 扫臂⊆oracle 臂（同一地面，oracle=增量+header 门控）；GC 判决从不用旧面（unionRefs+recheck）；擦除终裁同样（unionFace+in-tx recheck）。旧面只在擦除**首扫分类**参与并集——删后 doc-only 引用由 oracle 臂决策级保护；「snapshot 宣称收敛却仍漏引用」=投影器/oracle 缺陷显形，用测试钉住而非扫描器永久藏住（双轨根修）。
- **移位形态=写路径放大器**（五轮已自认「释放后新帧假差由 rebuild 收敛」）：协作中每轮假 extra 触发 controlledRebuildForMedia→new BindingRebuildService **绕开 runner 单飞队列**全量重写绑定——用写路径填观测竞态，垫片链第二环。
- **K6 盲区实锚**：catch-up 回灌故意不推绑定水位（barrier :197-199「pgSeq 可超前 applied：repo 直供/replayAll catch-up 落定的行非本 actor applied 前缀」）——`bindingsDirty=true` 单谓词 gauge 在 seq 落后窗显示 0；runner/countCandidates 谓词=`bindingsDirty OR mediaBindingSeq<pgSeq`（:221-223）才是收敛真面。
- **K2 边界**：无引号档 `[1-9][0-9]{0,4}(?!\d)`（否则 `COLLAB_PORT: 123456` 吃前五位误拦）；FIXED_LISTEN 无引号档同改；引号档闭引号失配天然不受六位影响。

**第七轮（v7→v8，外部双评审交叉核验——全部事实主张实锚核验命中）**：
- **认领时序洞（两评审同发现，我方实证）**：resolveMediaDisposition（stages:421）早于 barrier；!sameSet 分支 claimMediaForDeletion+写 sidecar（:443-444）先于 prepare（:456 仅删除窗）——删旧面后他项目绑定落后窗（oracle header 非决策级+MediaBinding 行未落）三臂皆假→**活体媒体误认领 DELETING**（命令面拒绑；后拍 departed 释放回 ACTIVE，误删由删除拍挡但误认领无遮挡）。修法=**认领拍 fence 化**（§1.5）：干跑只读零 fence 零认领；认领拍先 prepare→**verified 之内（fence 窗内）用 isMediaReferenced 算独占集**（不得沿用窗前 ③ 判定——③→seal 间新落引用窄窗）→claim+写 sidecar→release；未 verified=不认领不重写独占集走既有 pending-review（不造第三态）；删除拍保持第二次 prepare+unionFace+in-tx recheck。裸调 decideTeamReferenceSnapshot 版本否决（CAS 窗 barrier 外未闭合 media-reference :116-118+不主动 flush 收敛）。GC 同形（claim :208 先于 prepare）但候选=软删过宽限期媒体，副作用不同量级——GC 不动。
- **K8 闭包三补（v7 漏）**：①census :1203-1204 要求 media-reference.service.ts 出现 MEDIA_REF_ORACLE_ONLY 恰 1 次——同 commit 删条目否则 verify 必红；②runbook :664 末「对拍成本超预算形态——查 media_ref_shadow_skip_total…」分诊句随删（v7 只列 :666-668）；③残留 grep 扩充六符号（httpMediaRefsCollector/MediaRefsCollector/docScanFailed/ERASURE_MEDIA_REFS_BATCH/controlledRebuildForMedia/mediaBindingStaleTotal）；另补 auth.guard :39-40 media-refs 精确放行行随删。
- **§0 勘误+安全钉补**：第六轮「doc 扫臂⊆oracle 臂（同一地面）」不准确——两算法不同地面（词表投影 vs 候选无关全容器 UUID 叶整串正则+JOIN Media，oracle-worker :85-144/:266-271）；⊆ 仅对 UUID 形态 id 结构性成立；非 UUID id（dev 种子）=oracle 已知漏采面（:46-50 自书，binding 臂兜底）。v7 安全钉保留（shadow spec ⑤ :333-349 已全链覆盖+补直调断言）；可选补 ⊆ 契约测试（**限 UUID 形态**——不限则 dev 种子必红无解）。
- **K6 两驳一勘**：部分索引驳（需迁移文件超卡半径+表空+updatesRows 先例同类已接受——关切登记 §5）；catch{set(0)} 统一驳（**勘误：实测 22 处非 11**——部分 gauge 采集失败归零才是诚实值，统一需逐 gauge 裁=§5 登记项）；env.spec 勘误回敬（无 MEDIA_REF_ORACLE_ONLY 用例——v7「env.spec 用例删」半句落空）。
- **顺序断言改判**：MediaGcService docs 注入（:167，唯一使用 :394）与 collector 契约整链删——不留只为断言零调用的端口；plan 两条顺序断言作废由残留 grep 承载。docScanFailed 断言连坐仅 purge :231/:438（:438 detach/exclusive 数值与字段同 toEqual——改等式保数值断言）；kill9/redrive 无 docScanFailed 仅传参随删；prepare 次数断言仓内不存在（评审指令落空）。

**第八轮（v8→v9，外部双评审交叉核验——我方 v8 认领拍形态被证伪，撤销留痕修订）**：
- **复核窗重置洞（实证）**：③ 无 fence 时对未 flush 帧系统性失明（oracle 默认 60s 一拍 oracle-worker :40+binding apply 落后窗）——多人持续编辑团队任意时刻 ③ 独占集大概率含幻影 id；v8 形态 `!sameSet` 触发认领拍→窗内重算得较小集→写 sidecar（现码 :444 markAt=new Date()）→下一拍 ③ 又含幻影→再触发→**markAt 每拍重写、60s 复核窗永不满、真独占媒体被永久按在 DELETING**。轮询 5s（poller :39）/窗 60s（stages :66）前提实证。修正=**四规则**（§1.5）：①干跑零 fence；②认领拍=仅无 sidecar 时 prepare（窗内重算+claim 前过期检查）；③sidecar 在档∧窗未满=零 prepare、③ 只许缩小（释放 departed、**markAt 不变**）、多出 id 忽略；④**删除拍入口放宽为「sidecar 非空∧窗满」**（撤 exact sameSet 预筛——③ 波动令 sameSet 恒假则删除拍永不进入，规则「留到删除拍」不可达；此条为我方补全，评审未言明）。
- **认领前过期检查**：verified 后逐 id 循环可越 expiresAt，claim+写 sidecar 前补 `Date.now()>=expiresAt`→release+零认领+pending-review（删除拍 :463 同款）。
- **闭包范围修正（三处实证）**：spool=collectProjectMediaRefs **整段 :2286-2326**（节注释到 return，非仅 :2300-2303 签名）+**MediaRefsDocsPort :173-176**（该方法 deps 专用孤儿——评审未列，我方补）；auth.guard=**:36-40（注释+谓词）+:55（isPublic 链调用）**——只删 :39-40 留悬空引用编译红；media-gc **:161「四参构造签名」注释**+media-deleting.int.spec 构造点/makeDocsStub 随 docs 注入删改。
- **GC 不动论据补强**：conservativeRetain（media-gc :342-348）确在同一次调用 releaseMediaDeletionClaim 放回 ACTIVE（日志自书「回 ACTIVE 释放持有」）——bail-out 不留 DELETING 到下一拍。
- **⊆ 契约测试改必做（限 UUID 形态）**——spec/plan 统一同一句，撤 v8「可选」。
- **§4 台账改判**：四项无源句无实现（Z79/wantsEphemeral/drill.http 兜底/GC symlink）**从台账删除、不设「出卡重进」条款**（第八轮裁定，第二轮重提采纳）；表尾留一句出处对账非账目。
- **残留登记（§5）**：纯幻影尾段下 ⑥（:536 长度不等条件）不写 marker→无 sidecar→规则②以 5s 轮询节奏持续 prepare 直到他项目停笔≥一个 oracle 拍——保守自愈但团队 append 可用性代价真实；本卡不建机制，实测显形另开卡裁（⑥ 补写 marker 方案已勘否决——会引入 :521 幻影 claim churn）。

**第九轮（v9→v10，收口稿——全部主张实锚核验命中；我方 v9「入口放宽∧拍体零动」被证伪，撤销留痕修订）**：
- **E2 红洞（实证）**：E2（purge :489-506，reviewWindowMs:0+首扫后插他项目 binding+断言 ACTIVE/conflict 增量/detach）——v9 入口=marker 非空∧窗满→E2 进删除拍→拍体 :514 departed release 计 conflict 后 **:521 整份 claim(sidecar.mediaIds) 抢回 DELETING**→:502 红；且无复位路径（GC 只选 deletedAt≠null :197-198；MEDIA_DELETING_STALE_MS 只许接管）=永久 DELETING。根修=拍体收窄 kept=markerKeep−unionFace **只 claim kept**——E2/E3（:508-526）断言一字不改且必须绿（conflict 断言点全仓 project-erasure 侧仅 E2 :504，语义收窄安全）。
- **档 a 孤儿洞**：窗内收藏/入库→③ 判 detach（:260-261）→行不删（apply :315-319 先 detach、:328-330 projectId≠pid 跳删）+对象面=manifest−DB 现存（objects.ts:7-12）→对象在；坏形态=projectId=null∧DELETING 残留——markerKeep=sidecar∩exclusive 删除拍前释放（第一份 eligible=sidecar−unionFace 盖不住档 a：档 a 不在 unionFace）。**「窗内证人只增不减」不成立**——prepare flush 应用已排队帧可删引用→③ 判 detach 的 id 窗内认领=同拍 ⑤ 再 detach 留 DELETING 孤儿⇒**候选宇宙=本拍 exclusive、只减不增**。
- **markAt 继承洞**：现码 ⑥（:535-538）marker 内容=remainingExclusive（③ exclusive−deleted，非 sidecar 交集）——sidecar∩exclusive=∅ 且无删除时不重写（新 id 永远进不了 cohort）；旧 id 删后新 id 带旧 markAt 写入（60s 窗不存在）⇒⑥ marker=kept−deleted、markAt 不变、**exclusive 新 id 不写入**；推进门=marker 有 id/exclusive−deleted 非空/未 verified 或过期→pending-review。
- **claim 先后序**：claimMediaForDeletion SET 无条件 deletionRequestedAt=now()（:91-95 同 run 也刷新——「同 run 不刷新」改造=共享 CAS+media-deleting 断言连坐，**本卡不做**）；**marker 先写再 claim**（崩溃窗口=有 marker 未 claim，下一拍规则③/④接上；反向=DELETING 等 10min 陈旧接管）。
- **认领拍进程内退避**（stage 内按 erasureId 内存记：bail/空重算→15s 起倍增上限 5min；成功 claim 清掉；kill -9 重置；规则③不进退避）——**第八轮 §5 登记④就此销项**。
- **闭包三补（实锚）**：census **:1181-1184**（stages PORT/WORKER_WRITE_TOKEN 白名单条目——stages 内该两键直读点仅 httpMediaRefsCollector :91-92；删函数→stale→㉒ :1350-1351 红——**第二处硬阻塞**）+ :1185 与 cache.ts :102 注释同词改写；构造点 16 处（media-gc.int :131/:220/:261/:290〔:261 failDocs=shadow 族随删〕+shadow :130/:472/:494+media-deleting **9 处** :149/:168/:180/:189/:197/:206/:211/:219/:228）；**binding-rebuild.int.spec 无 controlledRebuildForMedia 用例**（零命中——plan「删该用例」步骤移除，spec 文件仍回归跑）；孤儿符号 MEDIA_GC_DOC_SCAN_PAGE/MEDIA_GC_TIMELINE_SCAN_PAGE（:58/:60，使用全在 shadow 内）+runWithIncludeDeleted/collectMediaRefs/toDocLike import（media-gc）+stages collectJsonMediaIds import（:57 唯一用 :231-234）+spool :162-163 注释。
- **K2-K7 文本修订**（完整正则+尾界/横幅+ :616 作废/fail 归一+finally 摘监听/register 直测+两补腿+countCandidates 2s 上限+PromQL 进 runbook/②排空+help 计 1+JSDoc≤3 行）；§5 运营承接句（oracle 巡检判据归下一卡）。
- **两处勘误回敬**：full-stack-backup.md 无 §13（实测 §1-§6，PITR=§5）——横幅落 **runbook §13**；media-deleting 构造点 9 处非泛指。

**第十轮（v10→v11，收口稿复核——v10 字面开工会令必须绿的 E2 与腿⑧变红；用户已确认→spec v11+plan v8 落盘）**：
- **差集 conflict 拆三档（v10「差集一律不计」令 E2 :504 红——复盘实证）**：E2 插入的他项目 binding 在 ③ binding 臂**直接命中**（binding 行已在 PG 无需收敛）→id 进 detach 不进 exclusive→规范化 markerKeep=∅→删 marker→规则④入口（marker 非空）进不去→unionFace 永不跑→conflict 永不计。修正=**③ 判被引用而离开 exclusive（在 detach 且非档 a）→ release 计 `media_deletion_conflict_total`**（现码 :436-441 复核集漂移腿同语义——E2 今天走的就是它）；档 a/行已不在 → 不计（腿⑥）；规则④ unionFace 命中且 ③ 仍留在 exclusive 的 → 在④内计一次；规范化已移出 marker 的不重复计。
- **一拍一段（v10「规范化后 marker 不存在就 prepare」令腿⑧红+reviewWindowMs=0 同拍串段）**：**分流锚点=进入本拍时的 marker，不看规范化后结果**——进入时无 marker∧exclusive 非空→只走规则②；进入时有 marker→只走规则③或④（规范化把 marker 删空后本拍不再 prepare、不再 claim——新 exclusive 留到下一拍走②、新 markAt；否则窗 0 用例同拍串段把新 cohort 在其窗起点同拍删掉）。**无论走哪段，⑤ detach 写批先于推进判定执行、deletable 为空不跳过**（E2 :503 projectId=null 靠 detach 写批）。
- **退避红测（十条腿未锁——补）**：腿⑨补「同一 erasureId 空重算之后 15s 内再进一次→prepare 次数不增加」；退避 Map=**project-erasure.stages.ts 模块级按 erasureId 记**（int spec 每用例新 erasureId 天然隔离）。
- **注释残留四处实证（Step 8 grep 必中）**：stages **:4-5** 文件头注 httpMediaRefsCollector（census ⑰ 纯度注记——头注改写）；poller **:31** import 两符号+**:63-64** 构造参数 JSDoc+**:289** processProjectRun 头注同词；spool **:159-163** 两常量整段 JSDoc 含 httpMediaRefsCollector（:161）与 MEDIA_GC_DOC_SCAN_PAGE（:163）双词面——**连注释整段删非仅 export const 行**；media-gc **:70-75** MEDIA_REF_SHADOW_MIN_BUDGET_MS 的 JSDoc 含 MEDIA_GC_DOC_SCAN_PAGE——常量连注释删。**K6 Files 补 runbook**（Step 6 PromQL 落盘冲突「只动本表文件」）。

**第十一轮（v11→v12，预开工终审——三处语义歧义收口，机制零改动；用户已确认落盘、不开工）**：
- **推进门「未 verified」在未调用 prepare 的拍无定义（E2 :500 会红或一拍一段漏锁）**：E2 拍走法=进入有 marker→③ 证人命中→markerKeep=∅ 删 marker→本拍零 prepare 零 claim→⑤ detach 照常——推进门前两条空、第三条取值未定义：实现默认 false 则 E2 停 pending-review（:500 `purging-objects` 红）；补一次 prepare 则测试绿（E2 不 spy prepare）但一拍一段没锁住。收口=「未 verified」精确定义为**本拍调用了 prepare 且结果非 verified，或调用后入口已过期**；进入时有 marker∧规范化后 markerKeep 为空的拍（未调用 prepare）**不计未 verified**——exclusive−deleted 空（E2 :500）→ purging-objects；仍非空（腿⑧）→ pending-review、下一拍走②。**④入口同步补「∧规范化后 markerKeep 非空」**（v11「进入时有 marker∧窗满」与一拍一段括注自相矛盾——E2 字面满足会进④）。
- **⑥ 作用域=仅规则④（v11 允许两种读法）**：按「每拍跑、kept 缺省 []」读法，②拍新写 marker/③拍规范化写回 markerKeep 会被当拍清掉→复核窗每拍重开→腿②/腿④红。收口=⑥ 只在**本拍进入④∧prepare 已 verified∧删除体已算出 kept** 时改写；②保留本拍新写 marker、③保留 markerKeep 与原 markAt；④未 verified 或未进删除体不覆盖。
- **E2 验收括注与第十轮正文矛盾**：「E2=unionFace 命中释放计 conflict」→按三档 E2 不进④、unionFace 不跑。改「E2=规范化差集（③ 证人命中）计 conflict、本拍不进④」；E3 括注不动（E3 markerKeep 非空→进④→所有权门，与现断言实测自洽）。
- 评审「已对齐」清单（E2 走法/分流锚/⑤ 先行/E3 路径/腿⑨ Map/注释四处/census 两条目/K1-K7 无新缺口）与我方核验一致；**四规则与 conflict 三档不再动**。

## 1 逐项清单（八项）

### 1.1 端口门引号+数字洞（代码+红测）

- `scripts/check-no-random-ports.mjs`：
  - **FIXED_LISTEN** 字符类改 `['"\`]`（:20）；**无引号档改 `[1-9][0-9]{0,4}(?!\d)`**（原 `{1,4}` 2-5 位→1-5 位+尾边界）。
  - **FIXED_COLLAB_ENV** 两分支统一：`COLLAB_PORT:\s*(?:['"\`][1-9][0-9]{0,4}['"\`]|[1-9][0-9]{0,4}(?!\d))`——引号/数字档同 1-5 位+数字档尾边界（`'0'` 首字符非 1-9 天然放行）。
- `` listen(`0`) `` 继续放行；`` listen(`${port}`) `` 不命中；`listen(0)` 不命中（首位类 [1-9]）；引号不配对宁可误拦。**不引 AST**（行扫描+注释/`expect(`/`safeParse(` 排除规则不动）。
- 头注改**扫描范围声明**：§3=testish 文件（test-utils/collab-harness/`*.spec.ts`/`*.int.spec.ts`/`*.e2e-spec.ts`/`*.test.mjs`）里的数字字面量端口档；生产入口、drill、census 不在 §3（census 非 testish；drill `String(opts.fixedWsPort)` :138 非 testish）；**另写明引号档不匹配 6 位数字（非合法端口形态）**。**plan Step 2 落完整正则**（第九轮）：无引号档以 `\s*[,)]` 收尾、引号档闭引号后同接 `\s*[,)]`——不写「改造指令」写终态正则。
- 红测六条（scanSource 内联形态）：①`` listen(`3001`) `` 命中 ②`` listen(`0`) `` 放行 ③`COLLAB_PORT` 双引号与反引号命中 ④`` listen(`${port}`) `` 不命中 ⑤`COLLAB_PORT: 3001` 命中+**`COLLAB_PORT: 123456` 不命中**（尾边界）⑥路径分类双断言——`scanSource('…/x.spec.ts','COLLAB_PORT: 1',{section:3})`=命中；`scanSource('scripts/check-collab-census.mjs',同文本,{section:3})`=零命中。

### 1.2 备份权威文档（纯文档，只改权威源）

- `docs/superpowers/full-stack-backup.md` §5 **拆两段**：**历史段**保留 2026-11-11 证据路径+§5.2 六步正文（=重建步骤，正文零动）；**当前段一句写死**：「**未启用**——来源=用户 2026-11-14 告知：服务器硬件升级+系统重装，旧机已建状态（PITR+daily crontab）随重装清零」；下一句重开条件：「下次服务器窗跑完 §5.2 并留下 `crontab -l`/`SHOW archive_mode` 证据文件后，才允许把本句改为已启用」。:55 标题与当前段一致——修 :55/:59 矛盾。**不设第三态**。
- `collab-ops-runbook.md`：§13 节首（:604 邻位）升**横幅**「**2026-10-16 历史记录，2026-11-14 重装后不在役，勿照此操作**」+「在役状态以权威文档『当前』段为准」（:605-615 原文保留；**:616「自动首跑核对义务归片 B 执行窗首日顺手项」句写成作废**——不单靠节首时态句；第九轮勘误：评审所指「full-stack-backup.md §13」不存在——横幅落 runbook §13）；:809 **分句级替换**——只换「（daily pg_dump 03:17，无 PITR——Y7 门槛项）」为权威文档指针，同段联动句留下。
- production-charter 仓内无对象（旧机 charter.json=服务器侧物随重装清零）——本卡无动作；不重建 PITR 不上服务器。

### 1.3 回填余量 gauge scrape 化+import 覆盖 gauge（卡① 登记）

- **v6 双 gauge 方案作废**（canvas_bindings_dirty_projects 不建——dirty 单谓词漏 catch-up seq 落后窗）。
- **A. 复用 `media_binding_backfill_remaining`**（media-binding.metrics.ts:78 现役名，不新造）：改 **reader 模式+updatesRows 族 async collect**（store.metrics.ts:1033-1040 先例）——reader=`() => runner.countCandidates()`（**谓词单源**=`bindingsDirty OR mediaBindingSeq<pgSeq`，与 drain 候选同一 SQL）；成功 set、失败**不 set（保上次值）+`yjs_metrics_collect_errors_total.inc({ reader: 'bindings_backfill' })`**；help 改「投影未收敛的画布数，一人团队与多人团队同一计数」；**drain 末尾 set（runner:160）删除**（避免两处写入）。`countCandidates` 转**公有**；wiring 第 4 参=runner（gateway :131 已注入 `bindingBackfill`，调用行同行加参零行增）。reader 只在 api 进程注册（wiring=gateway-only；worker 未注册刮 0——避免 Prometheus 双端点相加双计）。runner.spec :41-73 刷新面 describe 改写为「drain 零 COUNT/不触 backfill_remaining」。全表 COUNT 每 scrape 一次=updatesRows 同类（当前规模可接受）；**不加 bindingsDirty 索引**；**reader 侧 countCandidates 外包 2 秒上限**（超时不 set+`inc({reader:'bindings_backfill'})`——防 scrape 挂在慢 COUNT，第九轮）。
- **B. `yjs_import_coverage_open`**（新）：help「本进程 import 覆盖尚未 release 的项目数；重启归零」；collect reader=`() => gw.persistence.importPendingCount()`（**同步**）；失败保上次值+`inc({ reader: 'import_coverage' })`；无 label。
- tracker 加 `size()`（17/锚 23 不抬锚；零依赖保持）；tracker.spec 补直接断言（mark 1/`release(pid,true)` 0/`forget` 0）。persistence 加一行 `importPendingCount()`——**锚 1241→1242（全卡唯一抬锚）**。
- **新 Counter** `yjs_metrics_collect_errors_total`（labelNames `['reader']`，**闭集 `import_coverage`/`bindings_backfill`**）：定义 store.metrics.ts，media-binding.metrics.ts import 消费；仅上述两 gauge 的 collect catch 触发；既有 reader 的 `catch{set(0)}` 零动（第七轮勘误：实测 **22** 处非 11——逐行点数 store.metrics.ts）。未注册 reader 仍报 0。
- unregister×2 加 gateway onApplicationShutdown 现有块——新符号并入 :10 import 同行+调用 +2 行→**1221→1223≤1225 不抬锚**；runner（锚 271）净缩。
- Prometheus 红测（collab-metrics-observability.spec.ts **直接 `registerImportCoverageReader`/`registerBindingsBackfillReader`——updatesRows 同式**，第九轮）：coverage——mark 1/`release(true)` 0/`release(false)` 仍 1/forget 0/unregister 后 collect 0；**同步 reader 抛错→上次值仍在+`{reader="import_coverage"}`+1**（新腿）；backfill——stub runner.countCandidates 返 `Promise.resolve(3)`→刮值数字 3；reader 抛错→上次值仍在+`{reader="bindings_backfill"}`+1；**注销后刮 0**（新腿）。同 commit `--write-metric-names`+verify full；**告警判据两行 PromQL 进 runbook 同 commit**（告警看 `yjs_metrics_collect_errors_total` 速率、不看 keep-last 的 gauge）。

### 1.4 deletion_barrier_append_rejected_total（M6 观测面）

- **Counter**：定义在 `deletion-barrier.metrics.ts`（实测 15/锚 25——counter 至 ~21 仍 ≤25 **锚保持 25**）；help 单句「ACTIVE 窗内拒绝，帧留队，释放后落定；**一次 appendBatch 事务计 1**」；无 label；**新 Counter JSDoc ≤3 行**（第九轮——文件停 25 行锚内）。**计数=尝试次数**——告警按速率读；一人/多人团队共用 DeletionBarrier.teamId，不加团队标签。
- `inc()` 只挂 `canvas-doc-update.repository.ts:271` 唯一拒绝 return 前。WS 4413 close 族已计（collab-maintenance.metrics.ts:13），不加第二枚。
- **红测=int 三层承载（三条全取本用例前后差〔delta〕）**：**②**（:225）**差锁定=1**——**断言前排空该 team 的 actor 队列**（显式 flush——现用例无显式排空，由 prepare 内部 flushThrough :204-206 等价承担，补显式动作防残留队列产生第二次拒绝串扰 delta，第九轮）；实跑若不是 1 修的是 inc 位置不改断言；**①或任一非 ACTIVE 用例**差=0；**⑧**（:429）释放前差 **≥1**。既有断言零动。同 commit `--write-metric-names`+verify full。

### 1.5 删除 shadow 双轨+认领拍 fence 化（**唯一机制项**——第二引用面退役；删除判决三层零动，唯一例外=擦除认领拍纳入 prepare 围栏）

- **删除权威不动（唯一例外=认领拍 fence 化）**：删除判决=GC unionRefs（media-gc:253-255/:306）+擦除 unionFace（stages:480-483/:522）+两处事务内 recheck（GC :419/擦除 apply 头注 :530-532）；围栏快照门（decideTeamReferenceSnapshot 九腿）照旧在每次 prepare 前执法。
- **认领拍 fence 化（第七轮时序洞+第八轮窗口重置+第九轮 cohort 收口根修，project-erasure.stages.ts 单文件不新增持久状态）**：
  - **每拍非干跑先 cohort 规范化（认领集/删除集只允许缩小）**：exclusive=本拍 resolveMediaDisposition 独占集（档 a :260-261 只进 detach 不进 exclusive）；**markerKeep = sidecar.mediaIds ∩ exclusive**——差集立即 releaseMediaDeletionClaim，**按原因计 conflict（第十轮拆三档）**：③ 判被引用而离开 exclusive（在 detach 且非档 a——证人命中，即 E2 路径）→ **计 `media_deletion_conflict_total`**（现码 :436-441 复核集漂移腿同语义）；档 a/行已不在 → 不计（腿⑥）；规则④ unionFace 命中且 ③ 仍留在 exclusive 的 → 在④内计一次，规范化已移出 marker 的不重复计。markerKeep 空→删 marker，非空→**原 markAt 写回**；差集 id 不再 claim。**候选宇宙=本拍 exclusive，窗内只做逐 id isMediaReferenced 剔除、不增补**（「窗内证人只增不减」不成立——flush 应用已排队帧可删引用；③ 判 detach 的 id 窗内认领=同拍 ⑤ 再 detach 留 projectId=null∧DELETING 孤儿）。
  - **一拍一段（第十轮——分流锚点=进入本拍时的 marker，不看规范化后结果）**：进入时无 marker∧exclusive 非空→**只走规则②**；进入时有 marker→**只走规则③或④**（规范化把 marker 删空后，本拍不再 prepare、不再 claim——新 exclusive 留到下一拍走②、新 markAt；否则 reviewWindowMs=0 用例同拍串段会把新 cohort 在其复核窗起点的同一拍删掉）。**无论走哪段，⑤ detach 写批先于推进判定执行、deletable 为空不跳过**（E2 :503 projectId=null 靠 detach 写批）。
  - **规则①（干跑）**：:422 前返回，零 fence/零 claim/零 marker（预览计数=窗前三臂口径，非决策级）。
  - **规则②（认领拍——仅进入本拍时无 marker）**：进入时 marker 不存在且 exclusive 非空才 prepare（deps.barrier ?? HttpDeletionBarrierPort 同删除窗；本拍只走此段）——未 verified：零 claim 零 marker 走 pending-review（**不造第三态**）；verified 后只对 exclusive 逐 id 重算（**不得沿用窗前 ③**——③ 对未 flush 帧系统性失明：oracle 60s 一拍+binding apply 落后窗；重算循环内 `Date.now()>=expiresAt` 即中止）；**重算结果为空：零 claim 零 marker**（进退避）；非空：**先写 marker（新 markAt）再 claim**（崩溃窗口=有 marker 未 claim，下一拍规则③/④接上）；**claim 返回后再查时钟**——过期则 release 本批+删 marker+pending-review；finally release 围栏（配对纪律同删除窗）。
  - **规则③（窗未满——仅进入时有 marker）**：进入时有 marker∧复核窗未满=**零 prepare**；markAt 不动；exclusive 多出 id 不进 marker、只参加推进门。
  - **规则④（删除拍——仅进入时有 marker）**：进入时有 marker∧窗满∧**规范化后 markerKeep 非空**才进入（撤 exact sameSet 预筛；markerKeep=∅=cohort 已消解——本拍不 prepare 不 claim，出口见推进门）；**kept = markerKeep − unionFace**（unionFace 命中释放并计 `media_deletion_conflict_total`——④内只此一计，与规范化差集不重复）；**只 claim kept**；deletable = kept ∩ owned；prepare 未 verified 或入口处已过期：不删、不丢 marker、不推进。**机器不变量：deletable ⊆ exclusive ∧ deletable ∩ unionFace = ∅**。第二次 prepare+窗内 unionFace+in-tx recheck 原样。
  - **⑥ 收口（作用域=仅规则④——第十一轮消歧）**：⑥ 只在**本拍进入规则④∧prepare 已 verified∧删除体已算出 kept** 时改写 marker：marker 内容 = **kept − deleted**（只留事务内 recheck 中止的 id），markAt 不变；**exclusive 新 id 不写入 marker**（本 cohort 清空后下一拍走规则②、新 markAt=每个 cohort 有自己的复核窗）。规则②保留本拍新写的 marker；规则③保留规范化写回的 markerKeep 与原 markAt；④未 verified 或未进入删除体时不覆盖。**推进门**：marker 仍有 id / exclusive−deleted 非空 / 本拍 prepare 未 verified 或已过期 → pending-review；三者皆空才 PURGING_OBJECTS。**「未 verified」精确定义（第十一轮）=本拍调用了 prepare 且结果非 verified，或调用后入口已过期——进入时有 marker∧规范化后 markerKeep 为空的拍（本拍未调用 prepare）不得计为未 verified**：exclusive−deleted 为空（E2 :500）→ purging-objects；exclusive 仍非空（腿⑧）→ pending-review、下一拍走规则②。
  - **认领拍进程内退避**（**Map=project-erasure.stages.ts 模块级按 erasureId 记**，第十轮：本拍 bail 或窗内重算为空→下次 prepare 延后 15s 起倍增上限 5min；成功 claim 后清掉；kill -9 映射消失即重试；规则③不进退避；poller 仍 5s 醒、醒了不 prepare；红测=腿⑨）——吸收第八轮 §5 登记④（幻影尾段 5s fence 循环销项）。
  - 代价=认领拍多持一次围栏（退避封顶占空比）——擦除非热路径。
- **GC 删**：sweepTeam 整段 shadow（预算判定/shadowOldFaceReferenced 调用/faceB/missing-extra 计数/extra rebuild/「对拍段后」过期检查 :261-293）+`shadowOldFaceReferenced` 方法（:349-402）+常量 `MEDIA_REF_SHADOW_MIN_BUDGET_MS`（**:70-75 JSDoc 连 :76 常量行一起删——JSDoc 含 MEDIA_GC_DOC_SCAN_PAGE 词面，第十轮**）+**孤儿符号随删：`MEDIA_GC_DOC_SCAN_PAGE`/`MEDIA_GC_TIMELINE_SCAN_PAGE`（:58/:60，使用全在 shadow 方法内）+`runWithIncludeDeleted`/`collectMediaRefs`/`toDocLike`/`controlledRebuildForMedia` 四 import（删整段后全闲置）**+docs 注入（:167，this.docs 唯一使用 :394）+「四参构造签名」注释 :161 改写+**16 处构造点随删改**（media-gc.int.spec :131/:220/:261/:290〔:261 failDocs=shadow 族用例随删〕、shadow spec :130/:472/:494、media-deleting.int.spec 9 处 :149/:168/:180/:189/:197/:206/:211/:219/:228+makeDocsStub）。:247/:257/:302 过期自查与删除循环**零动**（⑩ 继续锁 :302）。
- **擦除删**：`erasureOldFaceReferenced` 函数（:206-251）；resolveMediaDisposition 旧面腿（:265 引用集判定）——引用集只留 isMediaReferenced overlay；`docScanFailed`/`docScanSkipped` 状态删（interface :199/:264/:266/:280+复核分支 :435-437/:446/:543+结果类型 :373-374/:422 简化——prepare 未 verified=既有 pending-review，**不造第三态**）；窗内 shadow 段（:484-511）；**stages :4-5 文件头注 httpMediaRefsCollector 词面改写（第十轮——残留 grep 命中面）**。**活文档扫描链整链删**（第七轮清单+第八轮范围修正+第十轮注释补）：`MediaRefsCollector` 类型（:85）+`httpMediaRefsCollector`（:89-110）+deps.collectMediaRefs 参数+poller **:31 import 两符号/:63-64 构造参数 JSDoc/:289 processProjectRun 头注**/:62-64 注入/:298 缺省腿+spool `collectProjectMediaRefs` **整段 :2286-2326（节注释到 return，非仅签名）**+常量 `ERASURE_MEDIA_REFS_BATCH`/`ERASURE_MEDIA_REFS_SCAN_MAX`（**:159-163 整段 JSDoc 连 export 行一起删——JSDoc 含 httpMediaRefsCollector（:161）与 MEDIA_GC_DOC_SCAN_PAGE（:163）双词面，第十轮**）+**MediaRefsDocsPort（:165 起 JSDoc+:173-176——该方法 deps 专用孤儿）**+路由 `POST /api/collab/doc/media-refs`（collab-write.controller:56-64）+**auth.guard :36-40（注释+谓词）+:55（isPublic 链调用——漏 :55 即悬空引用）**+`dto/collect-media-refs.dto.ts`+`project-erasure.media-refs.c4c1.spec.ts`；kill9/redrive/purge spec 的 collector 传参行随删+**stages 的 `collectJsonMediaIds` import（:57，唯一使用 :231-234 旧面）**（同名陷阱：`collectMediaRefs`/`collectMediaRefsForNode`（@flowweb/shared，投影器单源——actor :217/binding-rebuild :63 在用）**不动**；purgeErasureScope 独立路由 controller :73-82 **不动**；collectJsonMediaIds 定义留——registry VideoProject 臂 media-referrer.registry:124 在用）。
- **周边同删**：`controlledRebuildForMedia`（binding-rebuild.service:97-115，两调用点俱在 shadow）+`mediaBindingStaleTotal`（唯一点 inc 在其体内）——**binding-rebuild.int.spec 无该用例（零命中实证），无「用例删」动作，spec 文件仍回归跑**；`mediaRefShadowMismatchTotal`+`mediaRefShadowSkipTotal`（binding-reconcile.metrics——**停止产出并从 catalog 删**）；`skipBindingArm` 选项（media-reference.service:73-75/:146）+`MEDIA_REF_ORACLE_ONLY`（env.ts:195+isMediaReferenced :142-146 读腿+runbook :668 回滚开关段+**census 两条目**：:1203-1204 media-reference 条目+**:1181-1184 stages PORT/WORKER_WRITE_TOKEN 条目**〔第九轮补——stages 内该两键直读点仅 httpMediaRefsCollector :91-92，删函数→stale→㉒红，**第二处硬阻塞**〕+**:1185 与 project-erasure.cache.ts:102 注释同词改写**〔残留 grep 命中面〕——「绑定不可信时修投影器，不留进程内旁路」；勘误：env.spec **无**该键用例）。
- **doc-only 引用保护钉**（我方安全钉）：「帧有引用（UUID 叶）、无 MediaBinding 行、oracle 已扫（expectOracleFresh=包装 scanProject，shadow spec :160）且 header 决策级 → isMediaReferenced 判引用=true」——shadow spec ⑤（:333-349）已全链覆盖（guarded 断言承载），随本 commit 补直调 isMediaReferenced 断言收紧（钉住旧面退役后的替代保护证人=oracle 臂）。**⊆ 契约测试（必做，限 UUID 形态 id）**（第八轮：撤 v8「可选」，spec/plan 统一同一句）：同一份 state+updates 上 collectMediaRefs 产出 ⊆ scanUuidLeaves 过滤出的 Media id——防 SCAN_ROOTS/遍历/整串正则回归；**必须限定 UUID 形态**（oracle-worker :46-50 自书：非 UUID id=已知漏采面由 binding 臂兜底，不限则 dev 种子必红无解）。
- **测试随删/替换**：⑪⑫（预算装置用例）与 shadowSkipOf/mismatchOf/staleOf helpers 及其引用用例删（**不**改写成 4s 睡眠形态）；⑩ 原样；纯判决面既有用例（不涉 shadow 断言者）零动。**两条顺序断言作废**（第七轮裁定——MediaGcService docs 注入 :167〔唯一使用 :394〕与 collector 契约整链删，不留只为断言零调用的端口；由残留 grep 承载）。**fail-closed 用例替换为认领门红测**（purge :339-361 collector-null 场景随 HTTP 链消失）——**十条腿+E2/E3 断言一字不改且必须绿**：①prepare 未 verified（stub bail-out 或真 binding-dirty）→零认领〔无 DELETING 行+无 marker 写+pending-review〕；②verified→claim+marker 落盘；③窗前判独占、围栏内 isMediaReferenced=true→该 id 无 DELETING 行、不进 marker（锁「不得沿用窗前 ③」——装置=barrier stub 的 prepare() 返回 verified 前写入他项目引用，③ 与窗内重算共用 isMediaReferenced）；④sidecar 在档∧窗未满→barrier.prepare 零调用（spy）+③ 见引用仅释放 departed、markAt 不变；⑤verified+claim 返回后时钟已过→release 本批被调用、无 marker、无 DELETING 残留；**E2/E3（:489-526）原样**（E2=**规范化差集〔③ 证人命中〕计 conflict、本拍不进④**+ACTIVE+detach；E3=他 run 新鲜持有不删/陈旧接管删——E3 markerKeep 非空进④走所有权门）；⑥档 a：sidecar 含 id、窗满前 isFavorite 置真→行在+ACTIVE+projectId=null+不在 marker+conflict 不增；⑦不增补：sidecar {A}、本拍 exclusive {A,X}、A 被删→marker 不含 X、A 因 recheck 留下则 markAt 仍旧、outcome=pending-review；⑧换 cohort：sidecar 与 exclusive 不相交→marker 删除、旧 id ACTIVE、下一拍才 claim 新 exclusive 且 markAt 新；⑨空重算：窗内全被引用→零 claim、零 marker、不推进+**同一 erasureId 15s 内再进一次→prepare 次数不增加（退避红测，第十轮）**；⑩删除拍入口：sidecar {A,B}、exclusive {A,B,X}、窗满→prepare 发生、A/B 按 unionFace 删或留、**X 不在本拍 deletable**。**docScan 断言连坐**：purge :231/:438 两处 toEqual 改等式删字段、detach/exclusive 数值断言保留（:438 连坐）。
- **runbook §13.3 同 commit 重写（:664+:666-668）**：:664 末「对拍成本超预算形态——查 media_ref_shadow_skip_total…」分诊句随删（第七轮补——v7 只列 :666-668）；删「同窗同快照/预算地板 3s/skip 持续增长查团队规模」+回滚开关段；改三句——删除证人是围栏快照+isMediaReferenced+事务内复检（认领与删除同门）；绑定收敛只走 backfill；valve-bailout 只解释围栏内判决和删除。
- **残留 grep 零命中**（同 commit 自证；第九轮再扩充）：`MEDIA_REF_SHADOW_MIN_BUDGET_MS`/`skipBindingArm`/`MEDIA_REF_ORACLE_ONLY`/`shadowOldFaceReferenced`/`erasureOldFaceReferenced`/`media_ref_shadow`/`httpMediaRefsCollector`/`MediaRefsCollector`/`docScanFailed`/`ERASURE_MEDIA_REFS_BATCH`/`controlledRebuildForMedia`/`mediaBindingStaleTotal`+**`ERASURE_MEDIA_REFS_SCAN_MAX`/`MediaRefsDocsPort`/`collectProjectMediaRefs`/`CollectMediaRefsDto`/`doc/media-refs`/`MEDIA_GC_DOC_SCAN_PAGE`/`MEDIA_GC_TIMELINE_SCAN_PAGE`**（apps/api/src+runbook+**scripts/check-collab-census.mjs**——census 注释/条目同词面）。
- 同 commit `--write-metric-names`（三指标出表）+verify full。

### 1.6 drill 计时 Promise 所有权（终审 Minor）

- 测量体提成**具名 async 函数**；**settle 判别式**（创建 Promise 同拍落定化——成功值为 Error 不并通道）：

```ts
function settle<T>(p: Promise<T>): Promise<{ ok: true; v: T } | { ok: false; e: unknown }> {
  return p.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
}
```

- waitExit/waitCollab 之后取结果；失败分支收成 Error 后 `fail(e instanceof Error ? (e.stack ?? e.message) : String(e))`（第九轮归一——非 Error 抛出值不丢栈不吐 `[object Object]`）——走既有 `main().catch(die)` 出口（fail=throw：main finally 先行清理）。**usurp 分支不动**。
- **settle 宿主**：`apps/api/scripts/lib/drill-server-control.js`（+.d.ts）导出，全仓唯一实现；测试进既有 `drill-server-control.test.mjs`：拒绝/成功各一条+断言无 unhandledRejection——监听卫生：断言后 removeListener+`await settle(...)` 后再等一个 setImmediate 才摘监听。driver 本体不可 import（:579 顶层 main+watchdog :571 保 ref），不做 run-guard 手术。
- 验收：settle 仓内测试绿+handover `kill9` 与 `--graceful` 两腿实跑 DRILL PASS。**临时注入不作证据**。

### 1.7 sentry mock 半径（两文件同 commit）

- `collab-spool.service.spec.ts`（:29-30 `spoolCapture`）与 `collab-actor-erased.spec.ts`（:9）头部 vi.mock 改 **importOriginal 展开**只替换 `captureCollabException`，**必须引用同一 hoisted 函数**（恒等断言前提）；照 `collab-canary-verify.c22b.int.spec.ts:30-33` 先例。
- 两文件各补断言：`scrubEvent` 仍为函数+恒等各自 mock；既有断言（F5f 等）零动。不扫全仓其他 vi.mock。

### 1.8 Minor×8 销项档（零代码）

销项表（§4）随本 spec 作首个 commit 入库；**tech-debt.md 加一行索引指向本 spec §4**。

## 2 工作流与纪律

- **锚原则**：锚=wc -l 上限；**余量没用完不改锚**。本卡唯一抬锚=persistence 1241→1242；tracker（17→18≤23）/gateway（1221→1223≤1225）/deletion-barrier.metrics（15→~21≤25）用余量；runner（271）/binding-rebuild（273）/media-reference（231）**净缩不抬**；media-gc/stages/binding-reconcile.metrics/env.ts 未入锚。
- **提交序（8 commit，各自独立评审）**：①**spec v12（含 §4 销项表）+TD 台账索引入库** → ②端口门+六红测（含尾边界） → ③备份权威文档+runbook 时态句 → ④sentry mock 两文件 → ⑤drill settle+两腿实跑 → ⑥backfill_remaining scrape 化+import 覆盖 gauge（锚 1242+两处锚断言，verify full）→ ⑦barrier 拒绝计数（锚保持 25，verify full）→ ⑧删除 shadow 双轨+认领拍 fence 化（指标出表+**census 两条目**+runbook §13.3〔含 :664〕+残留 grep 扩充零命中+认领门红测十条腿，verify full）——**单 commit 内序=先红测试腿→改拍体→删旧面与闭包**（先删旧面后补围栏的中间提交=本卡要消灭的误认领窗口，第九轮）。
- **指标纪律**：指标三 commit（⑥⑦⑧）各 `node scripts/check-spec-consistency.mjs --write-metric-names` 同 commit+verify full；无 team/personal/项目 id 标签；直接替换/删除不留旧名。
- **int 命令**显式带 `DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb`（Git Bash prefix 形态实证可用）+**输出实跑数核对非 skipped**。
- 跑 verify 前先 `git add`（verify-chain ⑤）。**批末出口**：verify full 36/36；push=确认门。

## 3 不做（范围纪律）

- **唯一机制项=1.5 删除 shadow 双轨+认领拍 fence 化（第二引用面退役）**；其余七项零机制变更。删除判决/安全面（unionRefs/unionFace/in-tx recheck/decideTeamReferenceSnapshot 九腿/valve-bailout 判决删除路径）零动——**唯一例外=擦除认领拍纳入 prepare 围栏**（认领写与删除写同门；GC 不动——其 claim :208 虽亦在 prepare 前但候选=软删过宽限期媒体，且 bail-out 经 conservativeRetain〔:342-348〕同拍 releaseMediaDeletionClaim 放回 ACTIVE，不留 DELETING 到下一拍）；@flowweb/shared 的 collectMediaRefs/collectMediaRefsForNode（投影器单源）零动。
- 不重建 PITR/不上服务器；不引入 AST 解析；**不改 `claimMediaForDeletion` 的 `deletionRequestedAt` 同 run 刷新语义**（改「同 run 不刷新」=改共享 CAS+media-deleting 断言连坐，超卡半径——marker 先写再 claim 已收崩溃窗口，第九轮不做裁定）。
- **⑥ 不把新 id 写进旧 cohort**（不变量——新 id 经规则②开自己的复核窗，不继承旧 markAt）。
- 卡外事项不夹带（loopback/复核窗、TD-29/30/31/34、片 2/3、Y2/R2 决策——维持原挂）。

## 4 Minor×8 销项状态表（随 spec 首 commit 入库；TD 台账索引见 §1.8）

| 项 | 处置 | 依据（实锚） |
|---|---|---|
| load·refresh 互斥闸 | **销项** | refreshInFlight single-flight 已在位（registry :37/:83）+双测试——再加锁与之打架 |
| purge 容量重算延迟 | **销项** | spool spec :1090 已断言 purge 后 overCapacityFlag→false+onRecovered 唤醒 |
| runtime 防 stop | **移出** | 与既有裁定相反（drain 期定时器不停、tick 由 isLeaseServing 挡在 DB 外）——翻转=机制变更 |
| drop 重扫性能 | **移出** | 无测量基线+开发期无可服务数据量——需要时带基线另开 |

> Minor×8 的另四项（Z79 负向断言恢复/wantsEphemeral trim/drill.http 回退兜底/GC symlink）仓内既无双审源句也无对应实现——**不处置不登记**（第八轮裁定：从台账删除、不设「出卡重进」条款；重提须自带源句+文件行号）。本句仅为「8」的出处对账，非账目。

## 5 残余与登记

- **新增登记**：①三枚指标（import 覆盖 gauge/backfill_remaining scrape 化/deletion_barrier_append_rejected_total）+`yjs_metrics_collect_errors_total` 的**告警/巡检判据接线**归下一张观测卡或并入 check-collab-health；②collect `catch{set(0)}` 既有 **22** reader（第七轮勘误）长期观察——新两 gauge 已示范 keep-last+计数形态，是否迁移按未来 reader 实际可抛性再裁（部分 gauge 采集失败归零才是诚实值，统一需逐 gauge 裁）；③**backfill_remaining per-scrape COUNT 的规模校准+谓词部分索引**（第七轮裁定不进本卡：需迁移文件超卡半径+当前表空+updatesRows 先例同类——随容量校准/观测卡裁）；④~~繁忙团队擦除 run 尾段围栏占用观察~~ **已销项（第九轮）**——认领拍进程内退避（1.5 规则②尾）吸收幻影尾段 5s fence 循环；⑤**运营承接（第九轮）**：K8 后 live-doc 证人只剩 oracle 臂——`oracle_scan_age_seconds` > 2×扫描间隔持续 5min 或 `oracle_coverage_ratio` < 1 持续 10min 的巡检判据归下一张观测卡或并入 check-collab-health；**本卡不加指标**（避免再撞 deletion-barrier.metrics 的 25 行锚）。
- **shadow 双轨退役登记**：旧面/预算门/skip-mismatch-stale 三指标/MEDIA_REF_ORACLE_ONLY 旁路随 ⑧ 出仓；漂移观测面=media_binding_drift_total（binding-reconcile 在役）+backfill_remaining；doc-only 引用保护证人=oracle 臂（安全钉用例在档）。
- 卡① §5 gauge/排序条款由本卡 1.3 承接。另四项无源句 Minor 的处置说明在 §4 表尾句（不处置不登记）。
