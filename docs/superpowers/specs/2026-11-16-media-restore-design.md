<!-- doc-status: active | created: 2026-11-16 | confirmed: 2026-11-17（用户确认 v3——四轮裁定全采纳） -->
# 素材恢复接线（restore 端点+配额门+GC 抢占谓词）设计 spec v3

> 范围：顺后短批（两卡短批后）。三项=①恢复端点（单个+批量——foundation plan :306「恢复端点未建，原语在位——接线时消费」兑现，`restoreMediaToActive` 零生产调用方收口）②恢复事务配额门（软删即让出用量、恢复即重新占用——重入账字节必须过门）③GC 抢占谓词根修（`reason='media-gc'` ⇒ `deletedAt` 非空——封「候选读出→抢占」间恢复丢失竞态，无补偿式放回崩溃窗）。列表/回收站/前端/文件夹恢复不在本批。
> 依据：用户 2026-11-16 四轮设计裁定（全部事实主张实锚核验命中——留痕 §0）。
> v3 变更（定稿）：§1.2 媒体锁改 **FOR UPDATE NOWAIT**——v2 的 100ms lock_timeout 等待发生在已持有的 Team 配额锁内，重试按占空比把锁重新占住（v1 的 15s 堵锁被切成碎片、没有消失）；等待只发生在事务提交/回滚之后的无锁区间。GC 谓词、配额口径、擦除交叠、两腿不分区、原语签名零改维持 v2。

## 0 裁定留痕（brainstorm 四轮）

**第一轮**：A+收窄=只做文件恢复（folder 删除前置=自身及子孙清空〔`hasFilesRecursive` 不滤 deletedAt——软删文件也计入〕→无级联软删→无级联恢复面）；shadow 真采样随 K8 双轨退役自然消失（`MEDIA_REF_ORACLE_ONLY`/`shadowSkip`/`shadowMismatch`/`shadowStale`/`skipBindingArm` apps 全仓零命中）；GC 侧洞确认（claim 谓词不看 deletedAt+删除事务 FOR UPDATE 门只护 claim 后的恢复——claim 前提交的恢复对删除管线不可见，行被硬删恢复静默丢失）。

**第二轮**：配额前提勘正（`getUsage` 口径=completed∧`deletedAt: null` 的 size 和——**软删即释放配额、恢复即重新占用**，不过门会造成 usage>limit 超限态）；**GC 侧 guard 提案否决**——补偿式放回的崩溃窗是实的：claim 已提交、释放未写、进程死→行 DELETING 且 deletedAt 空→候选查询只读 deletedAt 非空永不再见+10min 陈旧接管也无入口（陈旧腿只能经候选 id 到达）=永久僵死（facts 被滤/新绑定被拒/内容可读）——**根修=抢占句谓词本身**；incoming=锁内 completed 字节和、0 时跳门。

**第三轮（v2）**：删除事务行锁最长持有 15s（media-gc.service.ts:298-323——FOR UPDATE 后 MinIO 删在事务内）+Prisma 交互事务默认 5s 时限——「Team 锁→候选 FOR UPDATE」直等会把整队 presign 拖 15s 且恢复被打成 500；锁序纪律不可倒（意图认领/解散/assertCanUploadInTx 均 Team 行先于业务行——storage-quota.service.ts:51-52 头注同源）；两腿次序降级非承重（候选 FOR UPDATE 持锁到提交，次序冒充锁被禁）；擦除按实际谓词重写（批删 `id∧projectId` 不看 deletionState〔stages :252-255〕、库资产 detach 留活〔:191-192/:240-242〕、GC-lost 只描述 GC）。

**第四轮（v3 定稿——v2 的 100ms lock_timeout 形态作废）**：
- **占空比残留洞**：v2 的媒体锁等待发生在**已持有的 Team 配额锁里面**——100ms 等不到任何进展（删除事务要的是媒体行不是 Team 行），回滚重试把 Team 锁按占空比重新占住；退避不显著大于 100ms 时占空比贴一半甚至满。同队 presign 排在「注定失败的等待」后面——v1 的 15s 堵锁被切成碎片，没有消失。
- **修复=FOR UPDATE NOWAIT**：等锁只发生在事务提交/回滚之后（退避睡眠不持任何行锁）；Team 锁持有=纯临界区毫秒级。锁序仍 Team 先行（NOWAIT 不改序、不引入会话状态、不碰连接池）。等待不能挪到 Team 锁之前（先媒体后 Team=与 Team→业务行纪律反序死锁面），只能从持锁区间里拿掉。
- **先例勘界**：credit-ledger 的 SET LOCAL lock_timeout（credit-ledger.service.ts:4）管的是它自己那一把串行锁——套到恢复会把配额锁变成停车场。55P03 判别=artifact-commit 双形状同款（artifact-commit.service.ts:47-51 `[err?.code, err?.meta?.code]`——P2010 包装 meta.code 或裸 SQLSTATE）。
- **预算域钉明**：GC 按文件逐个事务删（media-gc.service.ts:237 循环→:295 每文件一事务）——预算只覆盖「这一行自己的删除事务」，不按 MEDIA_GC_PAGE 去乘。

**实锚核验（累计）**：物化软限（materialize-job.service.ts:36/:581）/confirm ±1KB 卡值（storage.service.ts:84）/claim 调用方闭集恰三处（GC×1 :183+erasure×2 stages :412/:467）/erasure 认领行 deletedAt 空（media-facts.controller.ts:158）/TeamModule export StorageQuotaService 且仅 imports BullModule+forwardRef(RechargeModule)（team.module.ts:36/:22-27 无环）/media-gc.service.ts 依赖链不到 MaterialService（restore 端直接引原语无环）/dto-whitelist+dto-decorators spec 在位。

## 1 恢复端点

### 1.1 路由与形态（对称 delete 族，file.controller.ts）

- **`@Post(':id/restore')`**：`@Query('teamId')` 可选——同 deleteFile 的鉴权链；成功 `{success:true}`；零行（不存在/未软删/他团队）→ `BadRequestException('文件不存在')`，判在配额门之前。
- **`@Post('batch-restore')`**：body `{ids, teamId?}`（新 DTO 类，形态同 BatchDeleteFilesDto）；成功 `{success:true, count}`——count=实际恢复行数，对不上的 id 计 0 不报错。两路由无抢配（`batch-restore` 一段字面量 vs `:id/restore` 两段）。
- **鉴权在重试循环外做一次**：`resolveTeamId → assertTeamMember`（material.service.ts:27-31）；**批量 ids 为空时到此返回 `{success:true, count:0}`，不进事务**（鉴权先于短路——与 deleteFiles 的刻意不对称，auth-first）。
- 审计列（deletionRunId/Reason/RequestedAt）不动；folderId 不动（软删文件仍算「文件夹非空」）。

### 1.2 恢复事务（FOR UPDATE NOWAIT+事务外退避重试）

**单次尝试=一个交互事务，选项写死 `{ timeout: 5_000, maxWait: 5_000 }`**（超时=Prisma P2028 原样抛出，不重试、不映射 409）。事务内严格此序：

1. **lockTeamQuota(tx, teamId)**：`SELECT "id" FROM "Team" WHERE "id" = … FOR UPDATE`——从 assertCanUploadInTx 首句抽成 StorageQuotaService 公开方法，该方法改为调用它；同事务重入同一行无害。恢复/presign/恢复-恢复经此串行化。
2. **候选（NOWAIT）**：`SELECT "id" FROM "Media" WHERE "id" = ANY(请求 ids) AND "teamId" = 本团队 AND "deletedAt" IS NOT NULL FOR UPDATE NOWAIT`——行锁立即取得或立即 55P03，**等待零发生**。
3. 单个恢复且本句 0 行→`BadRequestException('文件不存在')`，判在配额门之前。
4. **配额门**：incoming=本事务 `media.aggregate`（id in 锁内 id ∧ `status='completed'` ∧ deletedAt 非空）取 `_sum.size` 再 `Number(… ?? 0)` 一次——与 getUsage 同一算术域；**incoming>0 才** `assertCanUploadInTx(tx, teamId, incoming)`（同事务重入 Team 锁无害）；超限抛该方法的现文案，整批回滚——批量不部分成功。个人项目（默认团队）限额已在 getLimits 内走 UserSubscription，恢复侧不另查。
5. **plain 腿**：`UPDATE SET "deletedAt"=NULL WHERE id=ANY(锁内 id) AND "teamId"=本团队 AND "deletionState"='ACTIVE' AND "deletedAt" IS NOT NULL`。
6. **restoreMediaToActive(tx, 锁内 id)**——不传请求体原文（跨团队 id 已被②滤除——原语不看 teamId，原文直传会把别人的 DELETING 行拉回 ACTIVE）。两腿 WHERE 互斥不双计；候选 FOR UPDATE 持有到提交，**两腿之间 GC 插不进**（次序非承重——阅读顺序 plain 在前；⚠️ 维护纪律：不得拿掉候选 FOR UPDATE 改用次序冒充锁）。返回两腿行数和。

**事务内错误纪律**：55P03 在事务回调里**不能吞**——Postgres 此时已把事务标成 aborted，吞掉再查用量会得到 25P02；回调直接抛，由 Prisma 回滚。

**事务外重试（只重试锁不可用）**：判别器认 `code === '55P03'` 或 `meta.code === '55P03'`（Prisma 5.22 raw 路径 P2010 形状——与 artifact-commit :47-51 同一双形状）；其余异常（配额 BadRequestException、文件不存在、P2028、P2024）**原样抛出不重试**。
- 时钟预算=`MEDIA_DELETING_TX_TIMEOUT_MS + 1000`（从第一次尝试起算，不抄数字 15000——单源常量）。
- 第一次立即尝试；失败后退避基数 50ms 翻倍、上限 500ms，睡眠取该值一半到全值之间的均匀抖动；**睡眠时不持有任何行锁**。
- 耗尽→`ConflictException('文件正在删除，请稍后重试')`。
- 锁到手但行已没了=**0 行档**（单条'文件不存在'/批量 count:0），不是 409。
- 预算域=「这一行自己的删除事务」（GC 按文件逐个事务删——别的文件的 15s 不握着这一行；不按 MEDIA_GC_PAGE 乘）。

### 1.3 交错闭包

- **恢复先提交**：GC claim 因新谓词（§2）匹配 0 行——行全程 ACTIVE、无一段可见的 DELETING。
- **GC claim 先提交**（行 DELETING 且仍软删——仅 GC 面的表述）：候选②命中（deletedAt 非空）→后腿拉回 ACTIVE→GC 删除事务 FOR UPDATE 门（deletionState='DELETING'∧own runId）失守→'lost' 零计数。**此条不适用擦除**（擦除无此门）。
- **GC 删除事务在飞持有行锁**：恢复尝试②立即 55P03→整笔回滚（Team 锁随放——无持锁等待）→事务外退避；删除事务提交后行没了→重试 NOWAIT 成功但 0 行→零行档。
- **擦除（不另写特判，按既有谓词自然成立）**：批删谓词 `id∧projectId` 不看 deletionState（stages :252-255）——拉回 ACTIVE 挡不住本拍；库资产（folderId 非空∨收藏∨type='uploaded' :191-192）走 detach（:240-242）不进批删——恢复留得住；无文件夹未收藏生成物随项目独占删——恢复侧不否决不放行。活行（deletedAt 空）进不了恢复谓词②。

## 2 GC 抢占谓词根修（media-gc.service.ts claimMediaForDeletion）——v2 原文维持

- 三腿 OR 括号外加：`AND (${audit.reason}::text <> 'media-gc' OR "deletedAt" IS NOT NULL)`（双臂常在形态，写法与句内既有 `${audit.reason}::text` 一致）。reason='media-gc' ⇒ 必须软删行；'project-erasure' 活行照抢、行为零变。谓词在抢占句内**原子**=不存在「claim 已提交、释放未写」中间态。
- reason 为 TypeScript 闭集 union（`'media-gc' | 'project-erasure'`）——新 reason 必改类型必见本谓词；「新 reason 默认不带软删条件、与擦除同侧、只有 GC 是特例」=用户裁定。
- **陈旧接管腿不受影响**：GC 陈旧行恒软删——谓词恒过；erasure 认领活行本就不在 GC 候选面（候选查询 deletedAt 非空、无 deletionState 条件——media-gc.service.ts:172-177）。
- claim 之后、byTeam 分组之前：**零释放、零日志、零新指标**。

## 3 配额门语义——v2 原文维持

- 不等式/报错文案单源=assertCanUploadInTx（usage+ΣACTIVE 预留+incoming ≤ limit——单门面零漂移）。
- **incoming=0 跳门**：物化软限（v10 裁决④）可致 usage>limit 已成立——恢复不计费行（pending/processing/failed）不该被上传文案拒；incoming>0 且已超限→照拒。
- **生成物无豁免**：completed 字节一律过门。
- confirm 边界保持 v2：assertOnConfirm 读用量不拿 Team 行锁，与恢复的用量读之间仍可能叠在飞 confirm——不在本批（presign 与恢复经 Team 行锁串行）。

## 4 测试面（TDD 红→绿锚点）

- **谓词腿（必做，media-deleting.int.spec.ts）**：deletedAt 已空的行+reason='media-gc' claim **匹配 0 行且行保持 ACTIVE**（=交错闭包证明，不做并发压测）；对照腿=reason='project-erasure' 活行照抢、reason='media-gc' 软删行照抢。
- **恢复事务腿（新文件 material-restore.int.spec.ts，真 PG）**：plain happy；DELETING 后腿回 ACTIVE+GC 删除序 'lost'；配额超限整批回滚——**断言事务只开了一次且 deletedAt 仍在**；incoming=0（pending 行）在已超限团队放行；跨团队 id/未软删 id 计 0；ids 空非成员 403 形态（鉴权在事务外先行）。
- **Team 锁不被占住红测（可判定版）**：会话 A 握目标媒体行 FOR UPDATE；恢复在重试；会话 C 反复 `SET LOCAL lock_timeout='50ms'` 后 `SELECT "id" FROM "Team" … FOR UPDATE` 随即提交——**400ms 内 C 不得出现 55P03**。C 的失败阈值=等待超 50ms，恢复一两毫秒的临界区不会打红；v2 那种持 Team 锁空等 100ms 会红。
- **判别器无库单测**：认裸 55P03 与 P2010+meta.code='55P03'；不认 P2028/P2024。
- **DTO 门禁**：新 DTO 补进 dto-whitelist.spec.ts+dto-decorators.spec.ts 既有断言面。

## 5 不在本批 / 非目标与反目标

- **不在本批**：文件夹恢复、已删列表、回收站、前端 UI（产品批定交互）；confirm 与物化软限的配额路径；restoreMediaToActive 原语签名（零改——只加消费方）。
- **反目标**：任何补偿式放回/claim 后 guard（崩溃窗=永久 DELETING 僵死）；恢复旁路配额（制造 usage>limit 超限态）；请求体原文直传原语（跨团队 DELETING 行误拉回 ACTIVE）；**持 Team 锁等媒体锁**（占空比停车场——v2 形态）；**先媒体后 Team 的锁序**（反序死锁面）；**会话级 SET lock_timeout**（污染连接池）；**事务回调吞 55P03 继续用事务**（aborted 后续查询 25P02）；**拿两腿次序冒充行锁**。
