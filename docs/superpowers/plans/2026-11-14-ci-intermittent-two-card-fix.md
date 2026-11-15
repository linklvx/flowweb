<!-- doc-status: active | created: 2026-11-14 | confirmed: 待确认（plan v10——对齐 spec v16 第十六轮：新 T9b blocked run 支 dryRun/scopeType 过滤〔P0——dry-run run 永久 PENDING〕+T17 改 closeListenerForRetry〔禁 server.destroy——4.8.0 destroyPromise ??= 记忆化污染〕+listenCollab transition('serving') 紧前无 await 终检+双 timer drain 不停〔drain-auto-release 不经 listenCollab；tick isLeaseServing 守卫承载〕+refresh single-flight+失败保留旧 Map〔erasure_refresh_failures_total〕+sweep drop 前先 mark+⊆断言+manifest_missing per-pid 去重+gate 第三 section COLLAB_PORT 非0 勘正+blocked 收割后 ready/drain 红测+T25 timeout-minutes+runbook team 恢复两档+metric 口径单源〔C1b 5 gauge+3 counter——v15 新增 3+1+v16 新增 1〕；否决项留痕 spec 头；v9——对齐 spec v15 第十五轮：initGeneration〔init 中 write-fence isolate〕+terminal run+ACTIVE→blocked restore-pending〔反转 v14 PITR 放行〕+blocked 收割不 confirm+purgeable 去 manifestPath 门+双 timer 生命周期〔refresh 10s/sweep 60s〕+onRecovered+load 全路径 force 删短缓存+scan test-only+gate 第三 section+锚净零+3 枚 gauge+1 counter；否决项留痕 spec 头） -->
# CI 间歇两卡根修批（TD-32/TD-33）实施计划 v10

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers test-driven-development（每任务红-绿-重构）；分片尾三命令验证。
> **上游 spec:** docs/superpowers/specs/2026-11-14-ci-intermittent-two-card-fix-design.md（v16）。
> **批次:** C1a TD-33 机制（spec+plan 随此入库）→ C1b 擦除一致性（DB 权威）→ C2 TD-32 → C3 清零+门禁+证据面。
> **锚纪律:** 行号锚随上游 commit 漂移——每 task 开工前重新 grep 符号定位；本表行号=当前 HEAD 基准。

## C1a：TD-33 机制

### T1 owner-name.ts 单源（红先行）
- 新建 `apps/api/src/modules/collab/owner-name.ts`：`buildOwnerName`（**`o-` 前缀+sanitized host+短 hash+pid+ts+rand**，fs-safe ≤64）/`parseOwnerName` 从右严格解析（**前缀不符=unknown**）。
- 红测：host 含 `-`/owner-like 后缀/无前缀格式合法名=unknown/pid 非法/合法往返。
- lease :46 改用 build；验证：owner-name spec+tsc。

### T2 删三处 rmdir+根锚（红先行）
- 红测：单项目 append→confirm→目录仍存在（旧红）。
- 删 :1330/:1477/:1490；断言 :52/:167/:251/:261 更新；:347-361 三段式改写（`o-` 前缀合法名删/owner-A 保留/显式 GC）。

### T3 writeNewSegmentFile 提取+暂停缝（红先行）
- :925/:1064 'wx' 写+EEXIST 重试循环收编 protected 单点——**签名返回 `{seq,path}`（终值 segSeq——调用方以返回值更新 meta/segKey/isNewSegment）**；并发暂停缝红测（旧红）+**EEXIST 重试用例**（预置 0/1 段占名→落 2 且 meta/文件名一致）。

### T4 switchGeneration+quarantineTruncatedFrames 入链（红先行）
- switch 入链；**quarantine 改 index 驱动**（枚举 `this.index.get(pid)` 段集**且 `m.foreign` 段 skip 零 sidecar 写入**——外来 owner 段不越权处置，不扫根——:1351 全根+readFile 无 catch :1357 跨项目 ENOENT 病根；index 驱动天然 per-pid 一致+O(该项目)；「unindexed 段漏检」不成立：recoverScan boot 扫盘全收+运行期写中段被 root 扫描反而误伤）；**新增 `readSegmentFile` protected 暂停缝**（adopt/quarantine/peek 共用读口；**ENOENT catch skip——段被外部 unlink 跳过不抛**）。
- 红测：switch 暂停序+**quarantine×append 交叉**（单项目）+**双项目同 owner 并发 confirm×quarantine**（零 ENOENT/零 sidecar 残留）。

### T5 adoptSilentForeignSegments 三防护（收录面统一）
- ①提交面入链（读链外〔经 `readSegmentFile` 缝〕，index/floor/dedup 提交入 `chainWalIo(pid)`+链内复核）；②**全收养分支抬 floor+入 dedup**（干净分支 :684-688 现漏——补）；③owner 存活判据**收紧且统一到一切收录面**（**recoverScan 收录外来段同判**——防护仅挂 adopt 分支则 peek/confirm/switchGeneration 经 index 仍碰活 owner 段，第十四轮 R1'；**收养/收录仅当 parse 成功∧同 host∧isPidAlive===false 明确死；EPERM/unknown/parse fail/跨 host 四负控一律不收录不收养不 unlink 不写 sidecar——recoverScan 对未收录外来段零写入**，与 GC「EPERM=活」对齐）。
- 擦除过滤谓词**默认 `()=>false`**（C1a 自洽无 C1b 依赖；C1b T9 接线 registry）。
- 测试：live foreign owner 不收录不收养/**EPERM/unknown/parse fail/跨 host 四负控不收录不收养不 unlink**/**live owner 段不进 index→peek/confirm/switchGeneration 零接触+零 sidecar**/干净分支高 seq 段后新 append 零重复 seq/暂停交叉零幽灵段。
- **既有红迁移**（spec §2.3.6 清单：spool.service.spec:347/wal.spec:760 等改合法 `o-` 名+活/死两态）。
- **scan() 退役面（v15）**：标 `@deprecated test-only`；spool spec 源码断言生产代码（除定义/测试）零 `scan()` 调用——不给 scan 加过滤（防误用面扩大）。

### T6 GC+boot 接线+锚净零（红先行）
- 红测：GC 矩阵（buildOwnerName 名，spec §2.3.5 全集）——dead pid（**含 10min mtime 下限分档**）/live pid/EPERM（**spy 注入 isPidAlive**）/非 owner 名+格式合法无前缀一律留/**未知 host 新旧 mtime+host 含 owner-like 后缀**/根 ENOENT/幂等。
- 实现：`reclaimStaleOwnerDirs`（顶层 catch+严格解析+年龄下限+**同 host 判据=parse 返回 hostKey 短 hash 比较**）+gateway `!initDone` 块内 replayAll 后调用（**每次 init/reinit 幂等——dead pid 目录已清即 no-op，rejoin reinit 同跑**）；counter 注册+**metric-names 写盘落 `2026-10-08-y0b-funds-and-access-design.md`**（check-spec-consistency 默认路径）；gateway 锚=净零：新建 `collab-start-failure.ts` 并迁入 `isPortError`（4 行）抵消 GC +2；锚维持 1162，不默认上调——超限先抽委托，最后才显式例外。

### T7 makeSpoolDir 加固+t9 恢复
- `rm(...,{maxRetries:10,retryDelay:50})`；t9 :146-147 删规避（S-M2 保留）单文件 ×3。

### T8 C1a 出口
- 三命令+**spec+plan 两文件随本 commit 入库**（verify-chain ⑤ 连 plans 目录——只 commit spec 仍红）；commit。**C1a 不单独部署**（擦除过滤谓词默认 `()=>false`=fail-open；与 C1b 同 release）。

## C1b：擦除一致性（DB 权威）

### T9 ErasureRegistry service（红先行）
- 红测：**blocked 五档**（DELETING→拒写 ERASING / DISBANDING→拒写 ERASING / **active run〔state∉{DONE,FAILED}——无论行在否〕→拒写 ERASING** / **terminal run〔DONE/FAILED〕∧ACTIVE 行→拒写 ERASING（restore-pending——v15 反转 v14 PITR 放行）** / 终态 run∧行不在→拒写 ERASED——v13 分档，旧「run∧无 ACTIVE→ERASED」矛盾已勘正）；**purgeable 九档〔行存在权威〕**（DELETING 无 manifest〔行在〕→不清/DISBANDING 子项目无 manifest→不清/DRAINING∧manifest 已写〔行必在〕→不清/**PURGING_DB∧行在〔pending-review 复核窗〕→不清**/**PURGING_DB∧行缺〔删行后窄窗〕→清**/**FAILED∧行在→不清**/**FAILED∧行缺〔post-delete 失败〕→清**/DONE∧行缺→清/terminal run∧ACTIVE 行〔restore-pending〕→不清+拒写）；**media conflict 中止档**（Media 回 ACTIVE 但 CanvasProject 仍 DELETING+run 停 PURGING_DB→不清+仍拒写——「FAILED 回 ACTIVE 放行」用例删除：状态不存在）；**purgeable⊆blocked 断言**（行无⇒blocked 必中；**同快照一致性**：两集合查询间暂停→删行/插 ACTIVE→集合仍一致，断言失败 fail-closed 按 blocked）；**active run+ACTIVE 行→blocked ERASING**（合成态分档收紧）；**Team DISBANDING 子项目 ACTIVE 且无子 run→blocked ERASING**（重启后 load 覆盖——起点 SQL 关键档）；**10s refresh 新鲜度**（serving 中 worker 批置 DELETING 无事件→10s 内 append 拒）；**端点 live 不卡死**（registry 快照不含〔加载时行在〕→模拟 worker 删行→调端点 200 清段——不得预置 purgeable fixture）；**version/merge 竞态**（load 暂停→mark→load 返回不含→仍 blocked；无终态 run 的 restore 无 during-mark→放行；terminal run∧ACTIVE 保持 blocked）；**force 全路径**（无短缓存——rejoin/start-failed 重试均取新擦除）；**fail-closed 两负向**（缺 source→start-failed/缺 guard→typed error）；**refresh 失败语义**（注入查询抛错→旧 blocked 保持不清空+age 增长+`erasure_refresh_failures_total` inc；恢复后新状态才替换）；**refresh single-flight**（注入慢查询 >2×周期→在飞即跳过→旧快照不覆盖新状态）；team.disbanding add+rejoin 仍在；加载失败→start-failed；既有 gateway spec 显式 EmptyErasureSource 夹具不红。
- 实现：独立 service `apps/api/src/modules/collab/collab-erasure-registry.service.ts`（**gateway 一行委托——编排进 service**）；**一条 SQL 同快照产出两集合——起点=CanvasProject JOIN Team ∪ run.scopeId 双支 UNION**（**CanvasProject 起点必需**：Team DISBANDING 子 run 建立前子项目=ACTIVE 行无 run 从 run 支扫不到=写屏障失效窗，第十四轮 R3 P0；DELETING 无 run 行同覆盖；断言失败 fail-closed）；`blockedMap()`=Map<pid,'ERASING'|'ERASED'>（分档：`lifecycleState <> 'ACTIVE'`〔非等值 fail-closed〕/`Team.status <> 'ACTIVE'`/**active run〔state∉{DONE,FAILED}——无论行在否〕/terminal run∧ACTIVE 行（restore-pending）**→ERASING / run 终态∧行不在→ERASED；无放行档〔v15〕）；`listPurgeableProjectIds()`=`run∧NOT EXISTS CanvasProject`（**load 快照——仅 boot sweep/gauge**；v15 去 manifestPath 门，缺失计 `erasure_manifest_missing_total`）；**`listPurgeableProjectIdsLive()`=live 批量**（端点删除授权+registry refresh/spool sweep 共用；**不设 `isPurgeable` 单点 API**——批量化后无调用者；快照/live 两法分离，第十三轮 R1+第十四轮 R6-2 矛盾勘正）；**version/merge load**（mark 记版本，load 合并 during-marks；**startCollabAfterLease 全路径 force:true——v15 删除短缓存**）；**生产必需注入**（缺失 start-failed）；load 于 `startCollabAfterLease` 最前+single-flight；isBlocked 读实时 Map；**gauge 五枚 yjs_blocked_projects/yjs_purgeable_projects/restore_pending_projects/purgeable_spool_bytes/erasure_registry_age_ms+counter 三枚 purge_sweep_failures_total/erasure_manifest_missing_total〔per-pid Set 去重——每 pid 每进程一次 inc，防 10s refresh 重复计数无界增长〕/erasure_refresh_failures_total〔v16——refresh 失败保留旧 Map 计数〕（C1b 合计 5 gauge+3 counter 单源口径——spec §3.1）**；另 recoverScan `blocked_spool_preserved`（注册名 `_total` 惯例——不在三枚口径，catalog 全量提取涵盖）；`project.gone`/`team.disbanding` 经 handleProjectsGone mark（**委托 persistence 侧钩子——gateway 零新增**）；**refresh 实现面（10s——timer 接线归 T14）：single-flight 在飞即跳过+失败保留旧 Map 不替换**（age 继续增长+`erasure_refresh_failures_total`；成功才替换）。

### T9b blocked run 支 dryRun/scopeType 过滤（红先行——第十六轮 P0）
- 红测四例：ACTIVE+`dryRun=true,state=PENDING`→不 blocked+append 放行+restore_pending 0（dry-run run 永久 PENDING〔poller dryRun:false 不消费+执行体零状态写〕——不过滤=对活项目跑一次删除预览即永久锁 blocked ERASING）/ ACTIVE+`dryRun=true,state=DONE`→不 blocked 不 restore-pending / `dryRun=true` team run→零项目影响 / 反向 `dryRun=false` 同形态仍 blocked（防过滤放过真 run）。
- 实现：blocked SQL run 支（UNION 双支+active/terminal 全分档+restore_pending Set）统一加 `scopeType='project' ∧ dryRun=false`（team run scopeId=teamId 跨 id 空间本不撞项目——过滤=零成本卫生；purgeable 侧已有同过滤，两法同源）。

### T10 assertNotErased 双层+typed 错误（红先行）
- **入口层**（append/appendTracked/appendBatchInner 顶部 dedup 前）+**链内层**（appendRawInner/appendBatchInner 最顶——幽灵段窗口闭环）；`append()` 薄包装化（去重/容量单源 appendTracked）**但仍是计账 owner**（成功〔非 dedup〕noteWriteSuccess/失败〔非 blocked〕noteWriteFailure+capture——薄包装丢计账=静默废 ioBroken 熔断与 Sentry；dedup 命中不计账；appendTracked 不碰 streak/Sentry）；typed `SpoolProjectBlockedError`（collab-spool.service.ts 定义导出；state:'ERASING'|'ERASED'——数据源 T9 blockedMap；无 HTTP 409/410 宣称）；`append()` catch 对 `SpoolProjectBlockedError`（ERASING/ERASED 两 state）rethrow 不计账不 capture。
- 红测：三入口+dedup/整批早退全拒+**链内幽灵段用例**（外层过检暂停→purge 完成→放行→链内拒+磁盘零新增）+`writeFailureStreak===0`+`isWritable()` 真+capture spy 零调用+**dedup 命中 `noteWriteSuccess` 零调用（append :712 早退现状锁）**+**IO 计账三例**（非 blocked IO 失败×5 开 ioBroken+capture 被调/dedup 命中 streak 不变/成功重置）+**既有 spool 直构 spec 批量注入 EmptyErasureGuard 夹具**（`src/test-utils/erasure-fixtures.ts`；不红）。

### T11 FrameRejectError.reason 修复（红先行）
- **字段直改命名 `reason`**（开发期无序列化兼容负担——getter 序列化不带出=垫片，第十四轮 R6-7；全读者随改 frame gate :94/:104）；frame-gate 单测锁 reason。

### T12 actor 双 catch 4414（红先行）
- :1282 主批+:1220 detached：**终态族分支（`instanceof SpoolProjectBlockedError`〔ERASING/ERASED 两 state 全档〕∨ FrameRejectError.code===4414——team DISBANDING 档帧同 4414 不落 1011）**——连接项先 `hardClose(conn,4414,PROJECT_ERASED_TERMINAL_REASON)` 再 rejectItem；维护项仅 reject；不 Sentry 不计 wal-failed。
- 红测：4414+reason+`resolveCloseAction=terminal`+三路径（主/detached/sink）丢弃断言。

### T13 persistence 终态+purge emit gone（红先行）
- **`isProjectErasedError(e)` 四形状 helper**（`SpoolProjectBlockedError`〔两 state 均识别〕 ∨ `FrameRejectError 4414` ∨ reason ∨ **`ProjectErasingError`〔PG fence 终态族〕**）；`retryPersist` 顶部短路（blocked→**只 cancel/停梯不 confirm**〔v15：段留 purge 删除——ERASING 未落 PG 帧不得被收割丢弃〕，帧通道同覆盖；**catch :922 同调 helper——blocked 不 rung 不再排梯**）；`:339/:389` catch 第一分支调 helper（splice+leaveInFlight+onProjectGone+return 不排梯）；**onProjectGone blocked 判定先于 hasFrames 排梯检查**（:1183 判序勘正）；:589 回退面同 helper；**emit `project.gone` 唯一落点=controller `finally` 仅对 `markedProjectIds`**（`purgeErasureScope` 返回 `{purgedSegments, markedProjectIds}`，mark 后中途 throw 错误携带已 mark 集；mark 前失败〔限批/NOT_PURGEABLE/503〕=零 emit 零 4414 零 deletedProjects——第十三轮 R2 P0；与 T14 同源不两写）。
- 红测：维护帧不排梯不重试（**sink 与 fallback 两路**）；**blocked 收割不 confirm（cancel 后 peek 仍可读 ERASING 帧；purge 后段删）**；**收割后 /api/ready pending 归零+drain 不超时**（onProjectGone discardForGoneProject 单点——锁显式）；purge→连接收 4414；**4xx 零 emit**（限批/NOT_PURGEABLE→零 project.gone 零 4414 零 deletedProjects）；**mark 后失败仍 emit 4414**。

### T14 purge 本体+boot 顺序+auth fallback（红先行）
- purge 顺序钉死 `guard → **purgeable 复检〔live 批量〕**（一条 `WHERE scopeId IN (...)` 批量查询——非 purgeable→`BadRequestException({code:'PROJECT_NOT_PURGEABLE', missingProjectIds})` 拒〔带缺失 pid 列表〕零删除零 mark；check 与 mark 间插行窄窗=runbook「restore 离线」约束；落点=`CollabSpoolService.purgeErasureScope` 头部〔collab-spool.service.ts:1954——controller :73 注入 registry 后经 per-call `deps.erasure` 传入，逻辑单点在 service，避 spool↔gateway DI 环〕）→ mark(pids) → per-pid chain`（mark 先于 chain）；**返回 `{purgedSegments, markedProjectIds}`**（controller 签名/注释随改；mark 后中途 throw 携带已 mark 集）；清理体走共享 `dropSpoolProjectState(pid,{unlinkFiles})`（全状态清单源：段+sidecar+index+dedup/watermarks/walSeq/generation——**段清单扫盘为准**+**drop 后重算 overCapacityFlag；true→false 调 `onRecovered`〔容量恢复唤醒 rearm——v15〕**）；`unlinkIfExists`+root ENOENT 折空；sidecar 孤儿清理。
- **boot 顺序+rejoin 清残+reinit**：`load(force) → sweepPurgeableSpoolOnLoad（**更名**——清的是 purgeable 非 blocked；每次一次 listSpoolFiles 按 pid 分组——只对盘上有文件的 pid 调 drop）→ recoverScan（**excludeProjectIds=blocked 全集**+**收录面防护=T5 同判**）→ replayAll → GC → listen`；**serving 期双 unref timer（v15 生命周期；v16 drain 修订）**：①registry refresh 默认 10s（`COLLAB_ERASURE_REFRESH_MS` 可配上限 60s；live 同快照 refresh blockedMap+`erasure_registry_age_ms`；**single-flight 在飞即跳过+失败保留旧 Map**——T9 实现面）②spool sweep 60s（`listPurgeableProjectIdsLive()` 批量+`purge_sweep_failures_total`+`purgeable_spool_bytes` 同次分组累计；**drop 前先对 live purgeable pids mark(pid,'ERASED')（内存写——restore-reerase 无事件路径的 in-flight append 幽灵段窗闭合）+`purgeable⊆blocked` 断言失败 fail-closed 不 drop 只计数**）；两 timer serving 启动、**selfIsolate/shutdown 停止（v16：drain 不停——drain-auto-release 直接 transition('serving') 不经 listenCollab 不会重启；drain 期零 DB 由 tick 首行 `isLeaseServing()` 守卫承载——draining 态守卫不过）**、句柄 shutdown clear；首轮 EACCES 不挡 listen 下轮清空+gauge 回落；**env.ts 注册键+y0b spec env-keys 块同批更新**（check-spec-consistency）；**rejoin reinit：initDone=false 置位点=selfIsolate+gateway 一切 release() 调用点（:298 release 不经 onLost 现状缺口）+initEpoch+initGeneration（isolate/release 各 +1；init 尾+listenCollab 入口+**transition('serving') 紧前**三比对——**紧前终检与 transition 之间零 await**〔listenServer 与 transition 间 requireSystemHistory 等 await 窗内 write-fence isolate，非法迁移仅日志会覆盖成 serving；不符→closeListenerForRetry 关 listener+返回——**与 T17 同一 helper**〕）+listenCollab `isolated` 早退+isolateSettled 屏障**（spec §3.1）。
- auth：`lifecycleStateOf` 无行时查 ErasureRun→'DELETING'。
- **manifest spoolSegs 单调保留**（spec §3.3.6——stages:409-413 重写取旧值∪新采集，只增不减）。
- 红测：purgeable 坏段 boot 不 blocked+段清+仍拒；**DELETING 无 manifest 坏段→boot 成功+仍 blocked+段保留（recoverScan skip）**；**boot index 空+盘上有 purgeable 段→扫盘清除（非 no-op）**；**sweep EACCES→listen 不挡→60s timer 下轮清空+gauge 回落**；**10s refresh**（默认；serving 中 worker 批置 DELETING 无事件→10s 内 append 拒）；**端点复检〔live〕**（快照不含→模拟删行→端点 200；DRAINING∧manifest/FAILED 行在→NOT_PURGEABLE+磁盘零删除+零 emit；PURGING_CACHE 档→正常清）；**rejoin reinit 三例**（A fenced→B 写同根→A rejoin append seq>磁盘最大段+零 dup-seq；**A release〔无 isolate〕→B 写同根→A re-acquire→重扫零 dup-seq**；暂停 selfIsolate release→lease 重获取→不进 recoverScan 直到 isolate 完成；**init 中 write-fence isolate→完成后不置 initDone 不 listen+未 serving**）；**timer 生命周期**（isolate 后 tick 零 DB/零删盘；drain 期 tick 守卫跳过+drain-auto-release 回 serving 后恢复不停摆；rejoin 重启；shutdown clear）；**sweep 先 mark**（refresh 后 restore-reerase 建 run+删行〔无同进程事件〕→sweep tick→先 mark 再 drop→并发 in-flight append 链内层拒+磁盘零新增；⊆断言失败 fail-closed 不 drop）；**purge 大项目后 overCapacityFlag 回落+onRecovered 被调+其他项目 append 放行**；**收录面防护**（live foreign 段不进 index→peek/confirm/switch 零接触+零 sidecar）；**manifest spoolSegs 保留**（行删后 spool 清空→PURGING_DB 重试重写 manifest→spoolSegs 非空）；purge 半途 kill9 重启自愈；purge 幂等（清残后再 purge 200 零段）；503 后仍拒；handover 仍拒；全状态清后 restore-reerase 行删→purgeable 清段；新 projectId append seq 正确；**manifestPath 缺失照清**（行缺+manifestPath=null→purgeable+`erasure_manifest_missing_total`+段清）；WS 级 4414（**ERASING 档帧同 4414**）；**mark 后 unlink 失败→错误带 marked→emit→连接仍收 4414**；auth 行删后重连 4414。

### T15 C1b 出口
- 三命令+t26 定向+int 全池 1 次；gateway 锚=**净零**（isPortError 已迁 tracker；C1b 接线单行委托；超预算先抽委托，最后才显式例外）；**metric catalog 写盘=C1b 全量 5 gauge+3 counter**〔v15 新增 3+1+v16 新增 erasure_refresh_failures_total——spec §3.1 单源口径〕（`node scripts/check-spec-consistency.mjs --write-metric-names`——`2026-10-08-y0b-funds-and-access-design.md`）；commit。

## C2：TD-32 基础+接线

### T16 resolveCollabPort 单源+env schema 修（红先行）
- 红测：blank=unset/'0'=0/非法 fail-fast（**严格十进制——`0x10`/`1e3` 拒**）/**`.int().min(0).max(65535)` 后 `COLLAB_PORT=0` 全环境 schema 合法**/**`assertProductionCollabPort` 纯函数单测四组**（production+0 抛〔无 opt-in〕/production+3001 过/development+0 过/test+0 过）/**`COLLAB_ALLOW_EPHEMERAL` 进 env schema 严格 `'0'|'1'`**（非裸 env 读）/**opt-in=1 时 production+0 亦过**/**drill `NODE_ENV` 缺省=production 坑**（env.ts:94——控制库 spawn env 显式带 opt-in=1，否则 drill 腿全拒启）/drill `DRILL_HTTP_PORT=0`+`COLLAB_PORT=0` 合法/**drill-server 实报非 3000**（`||3000` 修后；**DRILL_HTTP_PORT blank 回 3000 非 `Number('')===0`**）。
- 实现：helper **只解析**；**env.ts:161 `.positive()`→`.int().min(0).max(65535)`**+`COLLAB_ALLOW_EPHEMERAL` 枚举+可导出纯函数 `assertProductionCollabPort(env)`（main.ts 调用）；**drill-server:42 `Number(...)||3000`→显式判空（blank 回 3000）+`listen(port)`**；三处共用（module:60〔含 `|| 3001`〕/factory:35 内层/drill-server:42——外层 `??` 勿动但 `||` 形态一律换）；collab.module.spec 锚改行为断言。

### T17 gateway lastStartFailure+listener 后置失败关闭（红先行）
- **`CollabStartFailureTracker`**（C1a T6 已建 `apps/api/src/modules/collab/collab-start-failure.ts` 并迁入 `isPortError`；本 task 扩 tracker 面——gateway 只委托，C2 锚零净增）；`{code?,message,at,attempt,kind,stateSince}`（**stateSince=进入当前状态时刻（start-failed 档=grace 起算点）；在 transition 时写**）；catch 先赋值再 transition；attempt 入口+serving 清空。
- **listener 后置失败关闭**（spec §4.2.7 既有缺陷）：listenServer 成功→后置步骤（requireSystemHistory 等）抛错→catch 判 listener 已开→**closeListenerForRetry（selfIsolate 同款：closeAllConnections+`httpServer.close`+2s 兜底——v16 禁 `server.destroy()`：4.8.0 `destroyPromise ??= runDestroy()` 记忆化污染后，最终 onApplicationShutdown 拿旧 promise 关不掉 re-listen 的新 listener）**（否则重试 ERR_SERVER_ALREADY_LISTEN 非 EADDRINUSE→release=占口半死）；**T14 pre-serving 终检复用同一 helper**；红测：注入 requireSystemHistory 抛错→端口可被下一次 bind+**post-listen 失败→重试 serving→shutdown destroy 后 `httpServer.listening===false`**。
- 红测：时序三态（失败可见/清空/再失败读新值）。

### T18 drill-server IPC（apps/api/scripts/collab-drill-server.ts）
- HTTP/WS=0；消息 `drill.http`+`drill.collab-state`（state/stateSince/attempt/wsPort?/lastStartFailure?；元组变化发送；轮询 50ms unref）；验证 `tsc -p tsconfig.drill.json`。

### T19 控制库+fake-child（红先行）
- 红测族（平铺+**manifest 登记**）：http-only 两态/exit1<2s/EADDRINUSE 即拒（首包 null 次包补发+旧 attempt 不误判）/转 serving/超 grace/二次重试 10s 不误杀/后置三态/failure code 变化补发。
- 实现：`scripts/lib/drill-server-control.js`（CJS+.d.ts）+`scripts/drill-server-control.test.mjs`；同步读挂；grace 从 stateSince；entry 显式；port0×production 断言。

### T20 kill9 重接
- 控制库接入；`[31001..31003]` 回退循环（stopServer+clearLeaseRow 每次；**删旧 `WS_PORT=31001` 常量与 `port+1` 推导，保留 handover 段循环**）；**B 顺序钉死**：非 usurp=先起 B HTTP（expectCollab:false——断言 B HTTP ready 时 A 仍持租约；A 心跳正常→B CAS 恒败=安全）→terminate A→`await A.exit`→`B.waitCollab(15s)`；**usurp=B 后起（第十四轮 R10 回退 v13 R11——drill:345 既有顺序修正实证：B 先起则 break-glass 后 B 的 acquire loop 可在 A 下次心跳前经 expiresAt 夺行→A 见 heartbeat-fenced 而非 revoked〔~25% 翻转〕）**：A revoked（break-glass 先行）→listener 释放 3s→terminate A+await A.exit（≤30s）→**start B**→`B.waitCollab(15s)`（terminate 对齐单实例拓扑+A 死后 B 收养其段——与 T5 自洽；kill9 腿覆盖暴死，usurp 差异=优雅退出+租约抢占）；**epoch 断言恰 +N（usurp=+2 break-glass 契约 drill:350；B 不得因端口重试 release 多跳 epoch）**；全部 expectCollab:true await 后进断言面（**ready 语义=serving 完成+wsPort 可用**）；**wait 统一 15s**。

### T21 write-frozen 重接+kit 迁移
- write-frozen-drill.**mjs**（node 直跑驱动——CJS 控制库形态天然匹配）同款接控制库；kit 迁移（lease-held 分支 url=null 不 connect）。

### T22 C2 出口
- 本地 9 腿（**构成=kill9 族 7〔ci.yml :284-290：kill9-normal/fault+sigterm±spool-fail+handover×3 变体〕+write-frozen 2〔:297-298 frozen-chain/mid-edit-kill9〕实锚**）+usurp×10+frozen 两模式+双负控（A 预绑/B usurp 形态）≤2s typed；三命令；commit。

## C3：清零+门禁+证据面

### T23 census 40 处迁移（附录 A，分组）
- 绑定面 10 处（kit+7 int/e2e+**auth-reason:55（onModuleInit+URL :177——迁 address().port）**+**execseq:278（真 listen :304）**）→port 0+读实际口；直构参数面 **28 处**传 0；分组验证（直构组→int 组→e2e 组→execseq 组）。

### T24 freePort 全迁+gate（红先行）
- 4 文件 10 调用→listen(0)+address().port，删 helper；gate `scripts/check-no-random-ports.mjs`+`scripts/check-no-random-ports.test.mjs` 三 section 零 allowlist（①宽正则 `\d{2,5}\s*\+\s*Math\.floor\(Math\.random\(\)\s*\*\s*\d{1,5}` ②freePort 零残留 ③测试/harness 文件固定端口档 `listen(<非0字面量>)`/`COLLAB_PORT: '<非0数字>'`（**`'0'` 与 `listen(0)` 放行——v16 勘正：v15 文本此处漏非0限定**；生产入口/drill 手测配置排除；排注释/自身/定义行/测试意图行；自测三 section 口径用例含 `'0'` 放行例）+**`--list` 输出 file:line**（附录 A 单源落地——spec §5 既定）；manifest 登记。

### T25 ci.yml 证据面
- 两个 drill step `set -euo pipefail`+tee；failure() upload 日志+`apps/api/int.json`；`sudo ss -ltnp`（command -v 守卫）；step 预算按实测复核+**drill step 加 `timeout-minutes` 安全网**（按实测值设——防 8min 顶爆挂死，v16）。

### T26 台账+终验
- tech-debt 核销（观察期区分；**initDone 缺陷随本批核销+§7.1 卡改写仅余文件级面+§7.6 tombstone 立项卡登记**）；flakes 三条目分开改写（**gate-evidence/registered-flakes.md**：10-28 t26 指针/11-13 t26 指针+t9-actor ENOTEMPTY 注 maxRetries 缓解/10-26 端口条判据）；**runbook 约束（v15+v16）**（ProjectErasureRun 行禁清理/restore 走 restore-reerase+离线重启/旧格式 owner 目录手工清理/**manifestPath 缺失不阻断清理仅计数**/**team 恢复两档：子 run 未建立→重启即恢复；已 terminal→restore-reerase+离线重启**——spec §7.4）；doc-gate；`pnpm verify`；push CI。

## 附录 A：census 清单（**单源=gate `--list` 输出**——本表为 2026-11-14 快照 40 处/39 文件，实现以脚本输出为准）

**绑定面（10）**：dual-client-server:88、residency:83、recovery-import:121、write-endpoint:99、deletion-barrier:139、projection-outbox:146、t24-clientid:165、provider-convergence:206、**auth-reason:55**、**execseq-generation:278**
**直构参数面（28/27 文件）**：auth-defense:57、backpressure:40、degraded:36、doc-lifecycle:76、gateway.options:25、heap-gate:52、metrics-observability:48、perm-chain:57、perm-events:51、pg-breaker:197、quota-config:34、quota-truth:39、runtime-metrics:46、sentry:56、shrink:46、state-machine:82、t12-generation-channel:224、t20-ripples:39、t24-closeout:303、t24-version-gate:45、t25-closeout:38、t9:38、t9:186、version-gate:55、gateway.env:28、gateway.persist-status:65、gateway.sweep:43、t12-vacuum:180
**drill（2）**：kill9:119、write-frozen:94（C2 重接）

## 出口判据（对齐 spec §6 v16）

四 commit 各自三命令绿；**擦除面**（blocked 五档+purgeable 行存在九档+media conflict 中止档+端点〔live〕四例〔不卡死/4xx 零删除零 emit/marked emit 一次/mark 后失败 4414〕+同快照一致性+recoverScan skip+boot index 空扫盘+60s sweep 重试+isolateSettled 屏障+manifest spoolSegs 单调+503/handover 后仍拒+terminal run+ACTIVE 拒写（restore-pending）+全状态清（restore-reerase 行删→清段；新 ID seq 正确）+manifestPath 缺失照清+timer 生命周期（含 drain-auto-release 恢复档）+blocked 收割不 confirm+收割后 ready/drain 不挂+refresh 10s+失败保留旧 Map+sweep 先 mark 零幽灵段+dry-run 四例+WS 4414 两 state 全档+auth 4414+actor 三路径+reason+append 计账+rejoin reinit 零 dup-seq+gauge 五枚+counter 三枚）；WAL 链交叉零 ENOENT；GC 矩阵含下限/EPERM/前缀/host 分档；本地 9 腿（kill9 族 7+frozen 2）+usurp×10（terminate A 形态）+双负控 ≤2s+epoch 恰 +N（usurp +2）+**post-listen 失败→closeListenerForRetry→重试 serving→shutdown 后 `httpServer.listening===false`**+**pre-serving 终检**（init 中 isolate→不置 serving+listener 关）；t26 ×20+int 全池；`pnpm verify` 全绿（含 y0b metric catalog 写盘：C1a 1 counter+C1b 5 gauge+3 counter〔v15 新增 3+1+v16 新增 1〕）；CI 全绿；台账核销（TD-32/33+initDone；runbook 四约束；flakes 三条目；tombstone 立项卡）。
