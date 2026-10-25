# Y0b-5 终态与观测 Implementation Plan（v2.5·冻结版）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Y0b 批收官子批——客户端单连接所有权+终态/瞬态消费闭环+本地持久化最小内核（消除"刷新即丢"）+遥测 sink 全链+观测收口+W3C 追踪+PG 熔断与降级矩阵+资金链冒烟进部署链+迁移链根修四件，并收口 Y0b-1/2/3/4 四批移交项。

**Architecture:** 客户端侧以 **CollabConnectionSupervisor 收归唯一所有权**（瞬态/终态/1012/普通掉线全归 supervisor——库 pin maxAttempts:1+autoConnect:false+**open 事件 setConfiguration({autoConnect:false}) 归零 shouldConnect**〔库 onClose 1s 重连定时器结构性失效——v2.3 裁定 23⑴：maxAttempts:1 下"普通掉线归库"会单次失败即停摆〕+connectOnce 槽位守卫；watchdog 降级纯观测）取代"四套所有者无声明并存"；**自研最小 IDB 适配器**（世代可见通道四维缓存键前置——F1 无限刷新循环/F2 静默投毒两种确定性故障的结构性消除；尺寸闸+IDB 降级+diverged 标记+E36 双保险——v2.3 裁定 23⑷：y-indexeddb 无 pin 旋钮，自研 ~150 行零新依赖）把"未保存"从丢数据降级为未上行；服务端侧纯增量：telemetry 端点（detail 受控枚举进有界 label+复合聚合键）+prom-client 指标改造（E19 直方图回归+collect reader 惯例）+Sentry 单版本收敛+x-request-id（W3C traceparent 折中，traceId 普通索引）+PG 熔断（准入+store 短路 spool，连接族码表判定）+documentName 前缀守卫；运维侧 verify 前缀切片+plan 符号锚门禁+迁移 sha256 棘轮+巡检投递。

**Tech Stack:** NestJS+React/zustand+prom-client+@sentry/nestjs+native IndexedDB（自研适配器——v2.3 裁定 23⑷ 零新依赖）+vitest/int(collab-core)+node scripts。TypeScript strict。

**前置（plan 生效条件）：** spec=2026-10-08-y0b-funds-and-access-design.md **v2.8 §578-642（Y0b-5 章节）+§0.4/0.4b/0.4c 偏离表+§5.2 观测面总表+§6 门禁表**。**Y0b-4 服务器部署（api+web 同批 csv=2）已执行或与本批同窗**（T18 部署清单首行核对）。HEAD 基线=2026-10-12 master（71fa57f3）。§5.x 引用约定：本 plan 所引 §5.1-5.11 为 spec Y0b-5 节内小节；顶层 §5.1-5.3（RPO/观测面/CI）显式标注"顶层"。

---

## 0. v2 修订依据（三轮外审+四项用户裁定——2026-10-12 定稿；v2.3 裁定 23/v2.4 裁定 24/v2.5 裁定 25 增补第七/八/九轮收敛）

> v1 经三份外审报告+四项范围裁定（各有独立验证报告，16+32 项事实主张全部一手核验）修订。**裁决单源如下，执行期禁重议；同主题冲突时以编号大者为最新**（本仓 spec 先例——E 内联裁决同款）：

| # | 裁定 | 依据摘要 |
|---|------|----------|
| 1 | **Y5 最小内核前移本批**（用户裁定 Q1）——但以**世代可见通道为硬前置**（T5→T8 顺序）；离线冷启动恒只读（`canEdit` 谓词零改动——hydration 枚举不加第五态，新增 `localCacheReady` 正交字段）；驳回 lib0/persistence（模块不存在）+navigator.locks（与 E5 直写裁定冲突）+BroadcastChannel（离线恒只读分叉无从产生） | F1/F2 故障实证：docName=`project:${pid}` 无 generation（runtime:1086）+SV 门新 clientID 放行假设空 doc（gateway:1656-1657 注释自证）⇒缓存键不含 generation=无限刷新循环/静默投毒 |
| 2 | **迁移不 squash（维持 Y0c）**（用户裁定 Q2），但根修四件进本批：tar 先清后传+集合断言（deploy.sh:214 只覆盖不删除——runbook:96 实录 44 目录残留踩坑）/raw DDL 拆 prisma/raw 幂等应用/correlationId 改 migrate dev --create-only（撤销手写）/fresh-replay 门禁接线（dump-schema-objects.mjs 已写好未接门禁）；**驳回删 allowlist**——Prisma 5.22 引擎无 nullsNotDistinct 符号（二进制实证），两行=表达力缺口永久登记；DROP INDEX pricing_rule_natural_key 从 WARNING 升硬拦 | 第二次 squash 已于 Y0b-2 完成（现仅 2 迁移目录），再 squash=为不存在的问题执行单向门重建 |
| 3 | **verify 拆档采纳（前缀切片形态）+check-plan-anchors 门禁；文档淘汰不采纳**（用户裁定 Q3）——unloadImmediately 默认 true 且 gateway:449 已 pin+shouldUnloadDocument 手动入口复检（库 :1576）=触发策略所有者已是库；守卫内驱逐边际收益≈0 且抹掉 yjs_doc_stuck_total 真信号；改为 T15 巡检 P1 接线+runbook 分诊行 | nest build 与 check-no-testutils-in-dist 必须同档（后者 dist 缺失 SKIP exit 0=fail-open，拆开即空转门禁）；判据禁写墙钟 |
| 4 | **W3C traceparent 折中**（用户裁定 Q4）：32hex traceId 严格校验（version 00+非全零）+x-request-id 恒等+ALS/job.data 双通路+WS connectionId 独立命名+traceId 列普通索引（裁定 16⑪ 修正——原"部分唯一索引"废）；Sentry 单版本收敛为本批第一动作；scrub **白名单保留 csv/cb**（WS 无法设自定义头，URL query 是唯一通道，csv/cb=版本事故唯一线索且非机密——推翻"剥全 query"）；全量 OTel 否决（无下游+关停链风险+双 SDK） | Sentry v10 已带 OTel 核心包上盘（api 1.9.1+sdk-trace-base）——数据面零迁移+单文件局部替换的接入路径 |
| 5 | **T3 形态=单连接所有者**（三报告共识+我裁决报告1 形态）：supervisor 独占 connect/disconnect+库 pin maxAttempts+watchdog 降级观测/UI 分级；报告3 闸门下沉方案证伪（库 new WebSocketPolyfill 同步构造器契约 esm:292，无法 await admit） | authenticationFailed 后 socket 保持 OPEN（permissionDeniedHandler 只 emit 不断开 esm:949-952）+watchdog 判 isAuthenticated 永假⇒唯一恢复者=60s stale-inbound 门——不加双接触发则"快速退避"反而更慢 |
| 6 | **PG 熔断**=spec 主体（新装载/新会话准入）+store 短路 spool 扩展（open 时 append 直落 spool 省 5s 交互事务超时——与"不拒 append"同语义）+~~复用 isRetryableAppendError（含 P2024/undefined——池满是最典型信号）~~（**v2.2 删——被裁定 20 连接族码表推翻**）+窗口失败率下限（30s 窗≥5 次且>50%——被裁定 20 继承）；报告2"放行装载"证伪（装载需读 PG 快照，spool 只有增量，放行=装载残缺 doc）；refusalCache 半开钩子同批改写 Y0b-3 两处锚（collab-auth-defense.spec:257 单一 clear 点+钩子表 :221-241） | denial 唯一工厂 gateway:694；close (code,reason) 全集 14 点无 auth reason |
| 7 | **遥测 detail=受控枚举进有界 label**（裁决报告1 形态）：detail 四键白名单 {code?,reason?,ms?,n?} 全受控；close_code→collab_telemetry_close_total{code}（CollabCloseCode 值域+other）/auth_reject→{reason}（13 值闭集）/ms→Histogram；E40 时长经 ws_status.reason='unsynced-lag' 枚举+独立 label 序列（不新增第 13 类——冻结契约 11"≤12"维持）；禁自由文本不变；一律 204（413 也是 4xx 且 sendBeacon 不可观测响应） | store.metrics.ts:113-115 自述客户端遥测存在理由="库自发断连服务端不可观测"——detail 不上报则链路建成信息量为 0 |
| 8 | **yjs_doc_bytes=Histogram**（E19 原文裁定"改尺寸直方图+无标签超阈计数"——spec §5.2 观测面②，v2.3 行号修正：~:625【原引 spec:74 为偏离表 13 reaper——第七轮报告2 实证】）；与 yjs_loaded_doc_bytes help 互写分工（直方图=尺寸分布/gauge=驻留总量）；awareness 两 gauge=collect()+reader（onAwarenessUpdate 未注册+仓内 8 处惯例）；指标门禁=spec §10 canonical 块+check-spec-consistency.mjs（census 零指标名——v1 依赖写错） | yjs_canvas_doc_bytes 读者 4 处代码（store.metrics:33+gateway:928/:1134+persist-status.spec:371） |
| 9 | **unsyncedDirty 自持标记单源**（spec §5.7 v2.3 裁定；报告3"库侧计数"被 spec 否定——forceSync 置 1/resetUnsyncedChanges 幻影/readOnly false-ack 三路不可靠）：唯一置位=本地 origin update；唯一清零=provider.hasUnsyncedChanges===false&&isSynced 的 tick（**删 p.on('sync')（事件不存在）与 on('synced')（握手+归零两处触发会提前清零）**）；自持标记绑定 doc 实例而非 provider 实例（terminal 重建换 provider 不失效） | esm 事件表无 'sync'；synced emit 两处（:472/:721-723） |
| 10 | **横幅单链仲裁**（spec §5.7 v2.2 互斥裁定"以 §5.3 为准"）：四类（persist/syncLag/write-frozen/connUi）进 SyncBanner 既有优先级链单组件；denylist 面=链全分支+**能力位**（T8 落地后"未保存请勿刷新"→"本地已缓存，恢复后自动合并"） | v1 两独立组件可同屏且文案对立 |
| 11 | **导出双产物+导入器+safeReload 收敛 9 处**：escapeWithLocalExport 现读 store 投影（hydration failed 时=空画布）+reload 在 catch 外无条件执行（runtime:262-263/:271）；改 Y.encodeStateAsUpdate(.yjs 可回灌)+doc 反投影 JSON+不自动 reload+importLocalBackup()；9 处 reload 全走 safeReload+census 静态锚"生产代码禁裸 location.reload()"（合法点 :239/:271 白名单）；census encodeStateAsUpdate 白名单计数同批更新 | reload 9 处验证清单（page.tsx:219/:406/QuotaBanner:96/ShrinkDialog:90/SaveStatusIndicator:14/runtime:239/:254/:271/:1053） |
| 12 | **演练进 collab-core**（gate-collab 只挂 e2e-collab dispatch-only=纸门禁；collab-core=push/PR 必跑+PG/Redis+已跑 kill9 七模式）；withSyncRetry 已存在（executionApi.ts:26，Y0b-3 T9）**禁新建**，只扩消费到保存/上传；补 shrink 出口锚（spec:594）+422 用例（spec:642） | |
| 13 | **exec-smoke 哨兵定案**：AIModel apiUrl 必填（schema:207）+三链读行级（api-caller:179/:223/:439）+apiKey 空→fetch 前 503（:199-205）⇒哨兵=apiUrl `http://127.0.0.1:1`+apiKey 假值（非空——空只验业务错漏 settle/refund 环）→ECONNREFUSED 毫秒级→error→零扣费闭环；负例用从未注册 modelId（modelCache 5min TTL :103——注册后删除会被缓存击穿）；禁走图片编辑链（dashscope 硬编码 :112/:266/:343）；清理含产物文件+失败=fail deploy | |
| 14 | **projection_duration 打点改包 applyDocToStore**（含 reconcile+invariant——runtime:1263-1273；与 alignExecFromIntents 互不包含）；checkProjectionInvariant 生产采样化（1%+hydration 后必跑+DEV 全跑——去热路径调试垫片） | invariant 现生产无条件执行（:1266 仅日志分支判 DEV） |
| 15 | 杂项裁定：`__CLIENT_BUILD__`（__BUILD_HASH__ 不存在）；flush 禁走 apiFetch（client.ts:30 对 401 无差别置 httpExpired 电平）改 pagehide 挂载；beforeunload 谓词=reason 集合并集（ExportModal=export-inflight 语义独立）；ErrorBoundary 挂 router.tsx:62-65（pages/canvas/index.ts——.tsx 不存在）；collab_idle_timeout_total 决议=登记删除+同步 spec §5.2（P-T 证伪后无 idle 路径，禁双源）；yjs_client_doc_bytes=E33 指定的 E26 触发源（spec:88）随 T8 落地；job.data 零客户端状态断言（execution.processor.spec:70）对 traceparent 显式豁免+注理由；health/ready 职责维持 E44（degraded 块挂 ready token 视图，/api/health 不引 Collab 模块）；tmp-pricing-probe.mjs 未跟踪残留 T18 清理 | |
| **16** | **v2.1 增补轮（三份 v2 外审+逐条验证 6 组主张）**：**⑪traceId 索引唯一→普通**——一次组执行请求=N 行 intent（execution.service:221 循环 claim 每节点一行）∧`skipDuplicates:true`（generation-intent.service:206）⇒唯一索引冲突**静默跳过**=少冻结少计费（资金域最坏失败形态），且唯一约束否定自身审计用途（"该 trace 下所有 intent"结果集强制 1 行）；**⑫raw DDL 不拆**——幂等前提逐条证伪（migration.sql:1245 CREATE SEQUENCE/:1252 起 9 条 UNIQUE INDEX 均无 IF NOT EXISTS、:1432/:1435 CREATE TRIGGER 无幂等形态——"拆出+幂等应用"首跑必炸；改造补幂等=修改已应用迁移=破坏不可变性），且拆出掉出 additive 门禁+5 处 DB 构建点（ci.yml:48/:178/gate-collab:188/deploy.sh:67/:119）接线负担；T12-0b 改为**迁移 sha256 棘轮**（偏离 52 根因门）；traceId 迁移纯 Prisma 可表达不需要 raw | traceId 修复=报告1/2 共识；raw=报告1/3 vs 报告2 裁决 2:1（幂等实证一票定音） |
| **17** | **库行为修正**：cancelWebsocketRetry 生命周期=connect 置位（esm:251）→**onOpen 清空（:191）**→成功连接后正常关闭时 1s 重连定时器**正常排程**（报告3"永不排程"证伪——reconnectTransport:11-12 仓内注释自证）⇒①行为锚①（disconnect 废定时器）有效维持；②supervisor 所有权**诚实边界声明**：管瞬态/终态/1012；普通掉线维持库 onClose 定时器+watchdog 兜底（conn.spec 既有锚不动——报告2 P1-2 采纳）；③maxAttempts:1 的 connect() promise 会 reject（retry().catch rethrow :242-244）⇒supervisor `connectOnce()` 封装必带 `.catch(noop)`+`connectionAttempt/webSocket` 槽位守卫（防重复 connect cancel 旧 attempt 新建双 socket 竞态——库 :220-223）+零 unhandled rejection 用例；maxDelay pin 改 **30_000（=库默认）**——v2 的 3_000 声明与"pin=默认"自相矛盾已修 | 报告1 P0-3+报告2 P1-2+报告3 P0-2/P1-2 各对一半，验证合一 |
| **18** | **遥测形状修正**：①close handler 保持 `({event})` 解构+`event?.code/reason` 取值（库载荷恒 {event} 包装 esm:257/:461/:662——现有 runtime:1023/:1029 形状**本就正确**，v2"解构补齐"是退化已撤销）；②批量聚合键改**复合 `type\|code\|reason`**（按 type 聚合会把同窗 4408/1008 压一条——detail 分布客户端侧丢失=v1 病复发）；聚合键复合后截断分支真实可达（12 上限按聚合后条数）——永真用例自愈；③loop 启停绑定 `initCollab`/`destroyCollab`（无会话零 beacon——防匿名页 2/min 永久 401 噪声）；④~~@Throttle 桶键=自定义 getTracker=req.user?.id~~（**v2.2 撤回——裁定 22⑵：APP_GUARD 顺序 ThrottlerGuard→AuthGuard 使 req.user 恒 undefined=静默失效，且 80<120 已不超限；保留 120/min+容量注释，cookie 哈希键为升级路径**） | 报告1 P0-4+报告3 P0-3/P2-2/P1-5 |
| **19** | **T8 四补**：①**E36 不可达性断言**——本地缓存回放上行=单 SyncStep2 帧=整个会话未同步量，服务端闸=SyncStep2>maxDocBytes→**1009 terminal**（gateway:1669-1673 实证）=本地内容永远上不去；②**单 doc 尺寸闸** LOCAL_CACHE_MAX_DOC_BYTES=QUOTA_DEFAULTS.maxDocBytes 同源——超阈 doc 不缓存（"本地已缓存"是能力承诺必须有"太大没缓存"诚实分支——文案不谎报）；③**IDB 全交互 try/catch 降级**（QuotaExceededError 等在 initCollab 调用栈上——失败→禁用本会话缓存+`ws_status.detail.reason='local-cache-degraded'` 遥测，协作主链不受影响）+总量闸（estimate 超限按最后修改时间删最旧**已确认**库）；④**readOnly 期间本地写语义**：服务端拒写的本地编辑被缓存+重连重推=已拒内容复活风险——语义=缓存保留标注未上行；重连被拒维持只读+横幅引导导出（复用 collab_quota_writes_dropped_total{reason} 做服务端证据禁第二词表） | 报告1 P1-6/7+报告2 P1-1+报告3 P1-3 合流 |
| **20** | **其余 P1/P2 采纳**：熔断分类=**连接族码表**（P1001/P1002/P1008+超时）参与 open 判定；**P2024（池满）与 undefined 只计 failures_total{class} 观测**（池满时拒新装载=压力下赶走用户方向反了；isRetryableAppendError 继续供重试——码表单源同模块两策略）；死线**总封顶 25s**（多次瞬态不无限重排——到点 failed→localCacheReady 分支，后台 supervisor 续试）；单次探测独立函数（不复用 handleVersionTerminal——语义取 reason 非 csv）；invariant 采样改**确定性节律**（每 30 次 apply 或 30s+hydration/结构性变更后必跑——1% 概率在 vitest flaky 且现场无法估率）；top-N 日志只读已 observe 尺寸缓存（**零新增 encode 断言**——病态 doc 编码≈75×）；check-spec-consistency 扩"每个 *.metrics.ts 指标名必须在 spec（canonical 块或 §5.2 总表）出现"；safeReload('generation') 固定次序=**导出（标注旧代）→purge→reload**（世代被超的编辑本就无法合并——给用户留一份而非尝试合并）；generation 未知⇒**fail-closed 不启用缓存**+遥测；哨兵 `provider='smoke'`（∉ADAPTERS——public 选择器 executableModel 谓词过滤=用户不可见，claim 侧不查该谓词执行期首核）；DROP INDEX 纪律统一=生成产物**人工裁剪后提交**+硬拦兜底（禁"确认放行"）；unsyncedDirty 论据修正+T3/T6 接缝用例（断连期编辑→重连 forceSync 归零） | 报告1 P1-5/8/9/10/11/12+报告2 P1-3/4/6+报告3 P1-1/P2-4/5/6 |
| **21** | **批次结构终裁（用户裁定 2026-10-12）**：**单批出口+两个检查点**（CP-A 客户端链出口=用户确认点「客户端形态冻结」/CP-B 服务端运维出口→续 T18 部署）——拆 5a/5b 驳回：①拆批=两次走部署链麻烦段（--rebuild-db/迁移清理/spool 清账/冒烟——本仓在此已踩坑两次 runbook:96）；②5a 单独上线的真实风险面=T3 maxAttempts:1 新旧 bundle 混跑窗口（重连语义最不该被单独观察的时刻）〔v2.2 论据纠偏：T1 端点归 5a，"sendBeacon 打向不存在端点"的窗口不存在——原表述依据不实已删〕；③检查点即得"客户端先手验再下走"价值无需两次服务器操作。**能力位两段落地**：T6 只落 `localCacheReady` 字段（初值 false）+单链分支结构——文案维持"未保存"档**永不谎报**（靠字段默认值兜住用户可见承诺=脆弱排列）；T8 才落翻转（whenSynced→setState+尺寸闸）——文案真值只由"缓存真的建成"驱动，两任务各自可独立回滚。**顺序**：T3 提至 T2 前（T2 遥测记录点落在 close/authFailed handler 上——先 T3 定型 handler 结构再接记录点）；T9 固定 CP-A 末项（演练价值=所有权与未确认标记已定型——提前跑=移动靶取证）；T3/T8 不相邻维持（同窗口叠加会把"偶发多 socket"症状变"内容不一致"——归因从小时级变天级）。**CP-A 硬门**：T10 及之后任务在 CP-A 绿前禁开工（显式禁令）；手验三件必须留档（截图/日志/命令输出——防检查点退化为"看一眼"） | 用户裁定（第五轮）+第六轮约束补强 |
| **22** | **第六轮收敛（三份 v2.1 外审——2 必修+9 建议，关键主张补验 2 点全证实）**：**⑴锚①改双顺序锚**——disconnect() 无 clearTimeout（esm:367-376 实证：只置 shouldConnect=false+close+清队列，已排程 1s setTimeout 不可取消）⇒守卫在调度时刻求值：disconnect→close 顺序（authFailed 族主动断/CLOSE 帧族消息栈内同步 handler）守卫有效；close→disconnect 顺序（纯传输 close 1006/掉线）定时器照跑归库——锚①拆两用例各断言其顺序；`close(4408,'forced')` 降级为**纯分类器单测**（库内部合成路径不 emit close——anchor1 已录，客户端不可观测禁作生产路径用例）。**⑵限流 tracker 撤回**——APP_GUARD 顺序 ThrottlerGuard→AuthGuard（app.module:94-97 边缘限流不依赖 req.user 的安全不变量）⇒getTracker 里 req.user 恒 undefined=静默失效；且 80req/min<120/min 已不超限——删自定义 guard，保留 @Throttle 120/min+注释容量边界（NAT 并发上限约 60 人；超过再上 cookie 哈希键——sha256(parseSessionToken) 方案登记为升级路径）。**⑶TD-19"终态禁本地 hydrate+清副本"补落**——purge 触发点四→五（terminal 族 forbidden/not-found/session-expired/版本族/quota 终态）+**读权分型**：quota/writeFrozen/draining（仍有读权）→保留+只读+引导导出；forbidden/not-found/team-disbanded（已无读权）→purge 且**不提供导出**（否则=帮用户外带已无权内容）；T18 §3.7"残留无害"论断随之改写。**⑷哨兵三例**——主例=真实 adapter slug+apiUrl=127.0.0.1:1+假 key（ECONNREFUSED 传输失败真实发生——assertDispatch 的 adapterFor 检查最先实证 :187-195，provider='smoke' 时 PROVIDER_UNKNOWN_MODEL 400 在 fetch 前=传输路径没被验）；负例1=从未注册 modelId；负例2=provider='smoke'（PROVIDER_UNKNOWN_MODEL 业务码断言——adapter 层 fail-closed 顺手验证）。**⑸尺寸闸留余量+量真实帧**——闸=floor(0.75×maxDocBytes)（SS2 帧含包装，doc 编码=闸值必越界=1009 terminal 本地内容永远上不去）；断言改量 encodeSyncStep2 产物 byteLength 非从编码推断。**⑹autoConnect:false**——库构造器 :186 首连未 await 未 catch（maxAttempts:1 下页面加载遇重启必 unhandled rejection 且 connectOnce 管不到）⇒pin autoConnect:false+supervisor 首连（所有权声明自洽+⑯可达）；conn.spec 首连用例核对（断言连接结果非触发者）。**⑺connectOnce 三补**——镜像锚⑥（disconnect 后 webSocket===null⇒放行——"非空即退"在 CLOSED 残留时永不重连，死锁比双 socket 严重一个量级）+守卫改按 readyState∈{CONNECTING,OPEN} 判定+失败/被关后立即复置 shouldConnect=false（否则库 1s 定时器在 authTimer 10s 窗内抢跑）。**⑻退避表真合并**——删 connectionMachine.ts:9 的旧退避表（RECOVER_BACKOFF_MS——T3b 实施期已删，符号锚随之退役），改 import shared TRANSIENT_BACKOFF_STEPS_MS 单表（supervisor 首档退避/watchdog cooldown 两消费点同源——"声称一张实为两张"的第三态禁）。**⑼棘轮补全**——覆盖删除/重命名（同事故类）+双载体（pnpm verify+deploy preflight deploy.sh:67 段）。**⑽T15 挂真实序列**——collab_auth_attempt_blocked_total 仓内零代码命中（spec :674 改名从未落地）→改挂 collab_auth_reject_total{source="bucket"}（store.metrics:71-76 已落）+偏离表登记 spec §5.2 该族未落指标名同步清理。**⑾T8 指标落点+写入预算**——collab_telemetry_client_doc_bytes 显式落 store.metrics.ts（服务端遥测族单文件——禁 service 内联定义掉出 *.metrics.ts glob 门禁）+spec canonical 同步进 Commit；y-indexeddb 写放大三防（pin flush/trim 配置+本地编辑期 flush 间隔下限 ≥1s+尺寸闸周期复检复用 T7 5s interval+超闸停写降级非写至 QuotaExceeded）。**⑫T-prep 语义冲突扫描**——check-plan-anchors 增"已修订条款旧表述残留检查"（对修订条款强制 grep 旧短语如"部分唯一索引"不得在其余章节命中）+双源残留九处清理（裁定 6 P2024/风险表 raw 行/锚点表 #1#2#9/T13 与 T3 Commit 行/T2 Files 解构/invariant 描述/T15 指标名） | 三份报告共识+两处报告间矛盾裁决（限流=报告2 简案 vs 报告1 cookie 方案——算术 80<120 一票定音）；disconnect 无 clearTimeout/adapterFor 最先两点补验证实 |
| **23** | **第七轮收敛（三报告——2 P0 级事实修正+载体修订+12 项 P1 采纳+驳回清单；全部关键主张本人一手复验）**：**⑴maxAttempts:1 切断普通掉线重连（证实——推翻裁定 17②）**：库源码实证 `cancelWebsocketRetry` 是**取消函数引用**（connect :225-251 置位→onOpen :191 清空→onClose 定时器守卫 `!cancelWebsocketRetry && shouldConnect` :411-413）⇒"曾 open 过再掉线"场景：掉线 close→1s 定时器排→库内 connect() 单次尝试（maxAttempts:1）→**失败即永久停摆**（下次不再排）——"普通掉线归库+watchdog 兜底"在 maxAttempts:1 下不可维持（watchdog=45-60s gate+hidden 永不恢复）。**修法=收归唯一所有者（报告3 技巧）**：每个 open 事件里 `ws.setConfiguration({autoConnect:false})`（公开 setter——`if (!autoConnect) shouldConnect=false` esm:211-217）⇒shouldConnect≡false⇒库定时器**结构性永不排程**（无需与监听器赛跑）⇒supervisor 独占全部重连（普通掉线也归 supervisor 指数表）；连带：watchdog 降级纯观测（needKick/RECOVER_BACKOFF_MS cooldown 消费点删除——connectionMachine.spec:36 锚随 watchdog 角色重写同批改写，非静默改值）；锚①双顺序锚简化（结构性不排定时器后 (b) 分支不可达）；锚⑥/槽位守卫维持。**⑵T0 退避函数修正（报告3 P1-1 证实）**：`CollabCloseCode.PLANNED_RESTART` 不存在（实为 `APP_RESTART:1012`——tsc 必错）；且 `transient=(reason!==''&&!isTerminalReason(reason))‖…` 对 (4401,'Unauthorized') 第一子句误真（'Unauthorized'∉七档 terminal reason 集合）而测试期望 none——**修法=按路由分流**：code!==undefined→resolveCloseAction 单源判定；code===undefined→isTerminalReason（auth 路由）；AUTH_WAIT_TIMEOUT（socket OPEN 未认证）→exponential（独立路由——传 `(undefined,'')` 会得 none 与 Step③ 重排自相矛盾）。**⑶1012 重连抖动扩 0-60s full jitter**：部署触发 NAT 出口 40 客户端同时重连→upgradeBucket(容量 20,refill 60/min,per-IP gateway:372-375) 必 429+destroy→客户端落 AUTH_WAIT_TIMEOUT 10s/次；算术：40/60s=0.67/s<refill 1/s ✓（原 1-3s 窗 40/3s≈13/s 必炸）。**⑷T8 载体改自研最小 IDB 适配器（~150 行，零新依赖）**：y-indexeddb 9.x 无公开 flush/trim 旋钮（构造器仅 (name,doc)、PREFERRED_TRIM_SIZE/_storeTimeout 均私有——裁定 22⑾"pin 配置显式钉值"不可实现，唯一路径 monkeypatch=垫片违禁令）⇒自研：键=四维+updates(autoIncrement) 追加+whenSynced 快照压缩+meta{lastAckedSv,docBytes,lastWriteAt,dirty}（dirty=EVICT/PURGE 决策唯一可信依据——"只删已确认的库"靠库计数做不到）+trailing ≥1s 合并+全交互 try/catch 降级；**维持用户裁定 1 的能力语义（渲染本地副本/离线恒只读）不变**——报告2 pending-journal 增量日志载体驳回（无基线→刷新后空画布=与裁定 1"渲染本地副本"冲突的产品降级；D11 禁的是"离线可编辑的回放半态"非 E5"离线恒只读"），吸收其流控思想（Σpending>1MB→forceSync+同步积压态）。**⑸SS2 帧闸+ALLOWANCE(64KB)（报告3 P0-2 折中采纳）**：闸=严格大于（gateway:1669）+仓内既有测试断言 8MB(==maxDocBytes) SS2 两次通过合法（rate-gate.spec:79-104）⇒真实边界缺口=帧包装 ~20B——0.75×闸维持（与 softEnter 0.8 同族语义）+服务端闸改 `>maxDocBytes+64KB`（一行——覆盖 SV+包装+编码膨胀余量，E36 双保险）；**驳回移出闸落 4404**（重开 Y0b-4 收口执法链+doc-over-quota 语义混用——SS2 大帧≠doc 超配额；1009 terminal 是刻意选择防 1008 重连循环）。**⑹documentName 前缀守卫（报告1 P1-1 采纳）**：parseProjectId 裸 replace(:148-150)⇒别名 docName("abc"≡"project:abc") 连接=同一 projectId **双 doc 实例**——freezeQuota/beginVacuumEra/closeTeamDocuments 均按 `project:${pid}` 寻址⇒别名实例绕过冻结通告/vacuum 关闭=执法分叉（需有效会话+成员身份——已授权用户绕 softEnter 只读）；修法=认证期 docName 缺 `project:` 前缀即拒（冻结契约 7 缺参即拒同精神）+用例——进 T16 同批。**⑺T4 armSession 抽取（报告3 P1-3 证实）**：initCollab 超时 return(:1241) 跳过 :1245-1283 整段——viewport 恢复/recomputeConnStatus/applyDocToStore+ready/onRemote observeDeep(nodes/edges)/projectExecToStore+exec observer/awarenessBridge——**只做"迟到 synced→applyDocToStore+ready"会得到"ready 但冻结"会话**（首帧后远端编辑零投影+零成员光标+视图位置丢）；修法=:1245-1283 抽 `armSession(doc,provider,epoch)` 成功/自愈两路径共用+一次性 latch（防重复注册 observeDeep）。**⑻T3 存在理由改写**：瞬态档现状恢复=**15-18s** 非上轮所写 60s（fastLaneEligible=FAST_LANE_MS 15s+库 1s runtime:1183——60s 为通用 unhealthy gate）；真风险面=①服务端拒绝后 socket 保持 OPEN 无人关（permissionDeniedHandler 只 emit）②**无退避的 1s 热循环打 draining 中的服务端**（重连风暴面）——T3 收益="15-18s→2-4s"+热循环消除。**⑼发散闩锁防御（报告3 P1-4 采纳——T6+T7+T8 组合缺陷）**：readOnly 期间本地编辑→T8 缓存→unsyncedDirty 永不清零（服务端对拒帧回 SyncStatus(false)——client esm:474-476 `if(applied) decrement` **applied=false 静默丢弃**）→永久横幅→刷新回放重发散=不可退出循环；修法=**diverged 标记**：readOnly∧本地新 update→缓存条目标记 diverged→下次会话**不自动 hydrate**（横幅"有本地未上行副本"导出/放弃二选一→清标记）；判据用客户端已知 readOnly 状态（**报告2 sync-ack.ts wire 解析方案登记升级路径不进本批**——varString+varUint 手工解析=新增库耦合锚族，成本>收益）。**⑽T7 判据扩 `!collabReadOnly`**：viewer/spool 连接级 readOnly 不在 writeFrozen/quotaOver 两字段——现判据落 syncLag 档=把"服务端拒绝"误诊为"同步慢"。**⑾importLocalBackup 分片化（进 T6）**：.yjs 回灌按 maxTxBytes 分片逐帧 Update（每片过 Update 闸 2×maxTxBytes）——**超大 doc 显式恢复出口**（绕 SS2 帧闸；报告1 merge 端点驳回——分片客户端实现零新端点，端点登记 Y5 评估）。**⑿client_build_info gauge 删除**：build 值客户端可控=无界 label 基数面——clientBuild/csv/generation 全走结构化日志（T1 修正"有界"误判）。**⒀指标登记纪律四任务化**：check-spec-consistency **已存在**双向比对（:78-82——T10"扩域"用例不可能红，改写为执行纪律）；T1/T13/T14/T16 凡新增指标=同 commit 同步 spec §10 canonical 块（doc-gate --write-canonical）+必须落 *.metrics.ts（glob 外=静默逃逸）。**⒁T-prep 三修**：切档由 manifest 派生并标注 DB 依赖（步骤 2/4/5 DB 硬依赖——verify-indexes/check-migrate-diff/check-pricing-coverage 无 DATABASE_URL 即 exit 2，fast 档须跳 DB 步）；check-no-testutils-in-dist fail-open 修（--require-dist 3 行）；check-plan-anchors 主断言=文件存在∧±5 行符号命中（行号 advisory 防腐烂——报告1 §5.4/报告3 P1-7：纯行号硬门在本批大改 runtime 后必集体红）。**⒂T9 补"编辑中 kill -9"档**：现 kill9 drill 只在 quiescence barrier 后断言（collab-kill9-drill.ts:179-208）——spec:700"编辑中 kill -9 断言 ≤8s 恢复"未满足；+演练装置放 apps/api/scripts/*.mjs（census ⑧ 组断言 src 生产代码零 'write-frozen' 字面量）。**⒃T17 补 stub server 正例④+幂等清理**：本地 HTTP stub（脚本自起 127.0.0.1:<port>）作哨兵 apiUrl→零外呼走完 true settle+失败退款全链（裁定 13 三例保留——ECONNREFUSED 只验 error 环，spec §5.10 否决理由针对进程内 fake 不适用 HTTP stub）；清理幂等（启动先扫 smoke:y0b5:* 遗留）。**⒄T11 扩三件**：Sentry release='unknown' 修复（pm2 剥 GIT_*——改读 build-info.json）；unhandledRejection 兜底安装提前到 NestFactory.create 之前+补 uncaughtException（guard.ts:7-11 现只计数且装在 :99 晚于 create :77）；collab 关键 catch 扩 lease/spool/repo。**⒅T15 补 spool 预阈值告警**（50%/80% 两档——现方案满仓后才告警太晚）；T18 部署清单补 PROMETHEUS_TOKEN（/metrics 生产 403 fail-closed——prometheus-auth.guard.ts:13+T18 原清单漏）+巡检 curl 200 自证+web 回滚行。**⒆出口判据补 ⑱⑲**：⑱掉线 30s 后恢复≤5s（fake transport 自动化——锁死⑴）；⑲全仓测试基座 unhandledrejection 即失败（一条 setup 覆盖整类含库定时器路径）。**⒇驳回清单**：代际进 docName（报告3——Y1c-1 既定 E23 六处连带+4410/preVacuumSv 是 Y0b-4 刚收口域，本批 T5 字段通道=用户裁定 1 明示；论点登记 Y1c-1 设计输入）；pending-journal 载体（⑷已述）；迁移重基线删棘轮（三报告共识 vs 用户裁定 2——**棘轮与 fresh-replay 功能不重叠**：棘轮判"已提交迁移未被改"（不可变性——改注释/列序对象集仍等价时 fresh-replay 绿棘轮红），fresh-replay 判"迁移集重放≡目标库"（内容等价）——维持裁定 2/16⑫）；guard 顺序 Auth→Throttler 调换（Y0b-3 安全设计=边缘限流先于鉴权防未认证打穿 auth/DB——维持裁定 22⑵）；T15 提级 T10 前（依赖倒置：阈值表单源派生自 T10/T14 指标清单）；soak/COLLAB_MAX_LOADED_DOCS 落地（E45 deny/LRU 移 Y1c-3=Y0a-1 v2.1 已裁）；stuck 出口（维持裁定 3——Y1c-3 LRU）；Sentry 客户端/solo-team profile/projection.ts 拆分/WS ticket/merge 端点/版本历史 N 份/spill 对象存储/多实例启动断言（租约 fail-fast 已覆盖）——均登记后续批次 | 第七轮三报告（累计 16 份）；⑴-⑻/⑽/⑬/⒂为本人一手复验实证（库 esm 三段/shared 常量/runtime 1183-1290/闸 1665-1705/rate-gate.spec 75-105/parseProjectId:148/check-spec-consistency:78-82/client esm:474-476/SyncStatus(false) 丢弃） |
| **24** | **第八轮收敛（三份 v2.3 复核报告——5 P0 全证实全采纳+14 P1 采纳+2 驳回；P0 均本人一手复验）**：**⑴路由穷尽性（报告1 P0 证实——v2.3 遗漏）**：`CloseActionKind` **五档**（terminal/silent-renew-once/planned-restart/backoff/normal——close-code.ts:38-43）而 v2.3 T3 路由表只列三档：①`silent-renew-once`（4401+'session-expired' 服务端 sweep **常规事件**——runtime:1039-1041 现状已有 silentRenewUsed 闩锁+recoverConnection 处理，supervisor 收编时漏此档=每个被 sweep 会话永久断线）；②`normal`(1000 含库抹码形态) 落 idle=无重连（单所有者下"不重连"从暂时变**永久**）。**修法**：T0 resolveBackoffPlan 增 silent-renew 档+normal 档改**带退避的一次重连**（非 none——库抹码后 (1000,reason) 可能掩盖瞬态关闭，客户端无法区分；真终态服务端下次握手以带 reason 的 auth 拒档权威分型）；`none` 语义显式命名"永久断线"=不可扩展集合（仅 terminal+应用主动销毁两处）；**五档穷尽性表驱动用例**（未来新增 kind 未映射即红——拆兜底后防漏档的唯一门）。**⑵bytes 桶与 SS2 ALLOWANCE 耦合（报告2 P0-a 证实——v2.3 引入的确定性 bug）**：TokenBucket `cost>capacity 结构性恒 false`（token-bucket.ts:22-23 注释自述"桶容量必须≥最大合法帧"）+bytesBuckets capacity=maxDocBytes（gateway:391）⇒ 裁定 23⑸ 帧闸抬到 +64KB 后，(maxDocBytes, maxDocBytes+64KB] 的帧过 ⓪ 被 ⓪′ 桶**结构性拒绝→1008→backoff→重连重发同一帧→无限循环**（正是 1009 当初要防的形态）。修法：桶容量同步 `maxDocBytes+FRAME_ALLOWANCE_BYTES`+头注释/断言更新+**成对用例**（过 ⓪ 且过 ⓪′）+Update 闸不放宽反向用例。**⑶verify 三正交轴（报告3 P0-A 证实——v2.3 自相矛盾）**：元测试②"fast===full.slice(0,N) 前缀"与裁定 23⒁"fast 跳中间 DB 步（2/4/5）"**数学互斥**。修法：`--tier=fast|full`（前缀语义维持）⊥`--skip-db`（manifest db:true 过滤）⊥`--static-only`（=fast∩skip-db，pre-commit 用）+元测试 `skip-db(full)===full.filter(!db)`；exit code 口径改"非零"（verify-indexes 是 throw exit 1 非 exit 2）。**⑷shouldConnect 失效锚清单补全（报告3 P0-B 证实——v2.3 只列 2 处，实际 40 处引用/10 spec）**：①runtime:194 `terminal=!p.isAttached‖!ws?.shouldConnect` 谓词**语义反转**（归零后健康连接 shouldConnect≡false⇒恒判终态）——点名改写为 isAttached 单判据+phase 消费；②t9.spec:198-211 整条重写（:204 expect(shouldConnect).toBe(true) 必红+:206-211 watchdog kick 计数断言必红——描述的是已删机制）；③reconnectTransport.ts 整模块契约废弃（needKick 定义="shouldConnect 未被我们动过"——归零后恒假）→**改造为 socket 单实例注册表**（保留注入类唯一构造点，删 reconnect()/needKick，导出 activeSocketCount()+构造期"已有 CONNECTING/OPEN 实例则强关"不变量——顺带把 phantom-socket 隐患从纪律变结构）；④MachineInputs 的 cooldownMs/recoveryAttempts/lastRecoveryAt 与 MachineOutput.action 一并删（留不消费字段=第三态）；⑤**fakeHocuspocusProvider fixture**（10 个 spec 手搓 websocketProvider mock——库契约改后静默各漂；收敛为 test/fixtures 唯一载体，api 侧 behavior-anchors.fixture 同源）。**⑸指标登记指令修正（报告3 P0-C 证实）**：`doc-gate --write-canonical` 落盘 canonical.json（文档路径清单——doc-gate.mjs:219-223）**不写 spec §10 metric-names 围栏块**，v2.3 三处该指令=无效命令（新增指标名不改变路径清单=no-op）。修法：check-spec-consistency.mjs 加 `--write-metric-names` 模式（已持有两侧集合，10 行），三处指令改它。**⑹T0 detail schema 表+census 锚（报告2 P0-b 证实）**：v2.2 白名单 {code,reason,ms,n} 与 18 处调用点不匹配——ws_status{from,to}/recover_triggered{level}/conn_scope{scope}/auth_reject{terminal}/watchdog_fire{executed}/invariant_violation{where}（T2 又写 surface=自相矛盾）/write_reject 值域未定义（复用 auth 闭集⇒全落 other）——sanitize 在**服务端**执行⇒客户端无感⇒指标恒 other 且**无测试红**（TD-26 同族）。修法：T0 出逐 type 允许键+值域表（write_reject reason 五值闭集）；census 新增静态锚"调用点键集⊆允许键集"（未来新增自动生效）；T2 ErrorBoundary 改 where:'react-boundary' 对齐既有 4 处。**⑺T8 载体再简化=单快照覆盖（报告3 P1-A 采纳——~40-60 行）**：`put{key,snapshot=encodeStateAsUpdate(doc),unsyncedDirty,at}` 单键 put **原子无撕裂**+无压缩（每次写即压缩）+跨页 last-writer-wins 且两侧皆收敛中 CRDT 态任一份可用（**无需协调**——encodeStateAsUpdate 同步重活+日志异步读取塞同一 IDB 事务不可行=经典坑，事务让出事件循环自动提交）；触发=trailing ≥1s+pagehide 强制+结构性变更立即；删 updates 日志/压缩/lastAckedSv 三件（unsyncedDirty 布尔随快照存——T6 单源已有判据）；**裁定 23⑪ 分片化撤销**（Yjs update 编码流无合法切分 API——报告1 实证；快照形态无记录可回放）：导入器上限=单帧 ≤2×maxTxBytes（Update 闸），超大 .yjs 明示+merge 端点升格 Y5 **必做**（超大 doc 恢复唯一通道）。**⑻尺寸闸同源+SS2 落 4404（修正 v2.3 两处）**：①客户端闸改 `=maxDocBytes` 同源（删 0.75 系数——立论被同批 ALLOWANCE 证伪+softEnter 0.8 是配额滞回与帧包装无语义关系；编码≤maxDocBytes⇒回放帧=编码+包装≤闸+ALLOWANCE 恒过）；②SS2 帧>maxDocBytes+ALLOWANCE **改落 4404**（v2.3 驳回理由"语义混用"不成立——4404 同为 terminal 档**无重连循环**+带 QuotaBanner/shrink/export 自救通道+"本地持有 ≥8MB 服务端没有的内容经合并必然超配额"=4404 语义**准确**；复用 gateway:1697-1699 两行非重开执法链；Update 帧 1009 维持——DoS/意外帧）；既有"SS2>闸→1009"用例同批改写。**⑼⑱两段式+kickNow（报告1 P1-1 证实）**：退避表 [2,5,10,30] 下 30s 断网后下一次尝试 t=47s=17s 恢复>5s 判据不成立。修法：bindReevaluateOnce（:1104-1114 现成挂点）的 online/visibilitychange(可见) 接 `supervisor.kickNow()`（0-1s jitter 防惊群，已排程则忽略——事件驱动非轮询，不违"删 ready 轮询"裁定）；⑱改"**事件触发 ≤2s／无事件 ≤当前阶梯步骤（上界 30s）**"。**⑽watchdog assertHealthy 单向边（修正 23⑴"纯观测"）**：每 3s tick 判不变量（phase!=='terminal'∧connStatus==='offline'∧无在飞 timer∧无在飞 attempt）成立→**经 supervisor 公开入口排程**+watchdog_fire{reason:'stalled'}（supervisor 卡死兜底——不直接碰 socket，恢复权仍唯一）；supervisor 订阅 'disconnect'（库合成 4408 路径不 emit close、onClose 恒 emit disconnect——锚③互补）；open 后不变量自愈（shouldConnect===true 时重放归零+遥测——hook 单点自证）；T3 注释写明**楔死检测所有权**（检测=库 checkConnection strike1 close→真实 close→supervisor；重连=supervisor）。**⑾T3 模型式不变量用例（报告2 N5）**：fake timer+transport 对任意事件序列断言 (a)活跃 socket≤1 (b)瞬态恰一待触发 timer (c)terminal 后零 timer (d)teardown/epoch 变更后零 timer 且旧 timer 不 kick 新会话——覆盖"偶发双 socket/静默停摆"整类。**⑿第 14 reason 跨任务耦合显式化（报告2 N3）**：invalid-doc-name 同 commit 更新 shared 枚举+terminal 集+T0 值域+spec §5.2（13→14——T0 先于 T16 写 13 值闭集，漏改=静默 other 或非 terminal 无限重连）；守卫改全匹配 `^project:[A-Za-z0-9_-]{1,64}$`（挡空名/异常字符）；onAuthenticate/loadDocument/direct 三入口统一。**⑬T6 文案优先级+diverged 三出边（报告2 N6+报告3 P1-E②）**：单链固定 `diverged>oversized>degraded>localCacheReady>未保存` 逐档用例；"放弃本地副本"排在"导出 .yjs"后+二次确认（不可逆动作禁先于保全动作）；diverged 三出边完备性断言（导出/放弃/**服务端最终接受**——放弃必须同时清 diverged+unsyncedDirty 解除闩锁——否则 beforeunload 永久确认框）。**⑹尾.T8 失败面清单（报告2 N7）**：固定 DB version+onupgradeneeded/onblocked/versionchange/deleteDatabase **前先 close**（多标签 purge 阻塞——await close）/适配器自身布局版本（区别 docShape schemaVersion）/QuotaExceededError 之外 InvalidStateError/UnknownError 同路径降级/persist() Safari 可用性判据。**⑸尾.T9 kill9 双断言（报告1 P1-6）**：(a)服务端独存丢失 ≤8s（契约上界）(b)**客户端存活经重连差分零丢失**（T8 落地后用户可见 RPO≈0——本批最强产品论据）。**soak 测量（报告2 N4 采纳——执法与测量分离）**：collab-soak.mjs（N doc×M client×速率→RSS/heap/驻留/store 延迟/p99/spool bytes/min）→两张 runbook 数（并发容量上限+spool 存活窗——T15 预阈值的"还剩多久"换算依据）；进 T15、CP-B 人工留档（运行时依赖不进 verify）。**T1 getTracker cookie 哈希（报告1 P1-7 采纳）**：req.headers.cookie 直接读+sha256[0:16]（不依赖 req.user 不动 guard 顺序——边缘限流先于鉴权不变量保持+全站单桶→per-user+canonical tech-debt 消掉）。**T2 SLO 两条（报告1 P1-5 部分）**：hydration_duration/reconnect_duration 直方图（事件驱动零轮询；edit→ack 依赖 sync-ack 登记升级路径）+T15 runbook SLO 行。**杂项批量**：T0 route 参数替代哨兵（`route:'auth'|'close'|'timeout'`——先例 CloseAction.synthetic；reason 只承载协议串）；T16 死代码处置（isRetryableAppendError 零调用点+retryPausedByCircuit 只写不读——接线或删）；T12 DROP INDEX 硬拦名单与人工裁剪名单同源；⑲ unhandledrejection 基座带白名单（防 abort 类库 flaky）；T15 stuck 手工出口 runbook 行（drain→重启→观察 zero_conn_docs 回落）；令牌双设（COLLAB_ADMIN_TOKEN 显式设——禁依赖 PROMETHEUS_TOKEN 回退）；1012 UX 行（"正在恢复连接"+runbook 部署窗恢复时长≤60s）；T17 SSRF 前提核对（AIModel.apiUrl 无协议白名单——执行期首步与 claim 并核）；ErrorBoundary 错误栈受控枚举（error.name+首帧 file:line 折 detail——Y5 前可诊断）；偏离表补产品裁定行（**离线恒只读=设计选择非遗漏**——放开归 Y5 重审）；traceparent 不称 W3C 合规（traceId 列=资金审计键）。**驳回**：4410 原地换代（报告3 P1-C——维持裁定 20 reload：次序锚=导出→purge→reload 是用户裁定内容；换代复杂度〔新 generation 获取/undo 清理/awareness 重挂〕与 Y1c-1 docName 世代通道重叠，登记 Y1c-1 届时换代是通道自然形态；低频管理路径不值得本批复杂度）；拆批（报告3 §五自认"按现结构执行也不会出错"——维持裁定 21）；awareness 字段白名单（P2 登记——user 已服务端覆写）；/api/ready 分档（登记 Y0c） | 第八轮三报告（累计 19 份）；⑴-⑹⑼⑿为本人一手复验实证（五档定义 :38-43/runtime:1039-1041 silent-renew 现状/token-bucket:22-23+gateway:391/t9.spec:198-211/reconnectTransport:10-20 needKick 契约/doc-gate.mjs:219-223/runtime detail 七键 grep/bindReevaluateOnce:1104-1114） |
| **25** | **第九轮收敛（三份 v2.4 复核——报告1 确认通过附收口条件；6 项接缝全采纳；**v2.5=冻结版**——设计空间已探尽〔报告1 判定"后续评审轮期望收益为负"〕，此后只在实现期发现"计划与代码不符"时回改）**：**⑴T0 detail 表修正（报告1 A+报告2 P0-2 实证）**：v2.4 write_reject 五值**三缺两多**——实际值域=`QuotaRejectReason` 四值〔key-too-large/tx-too-large/too-many-nodes/doc-over-budget——canvasIntents.ts:73〕∪{selection-too-large, quota-soft}；msg-rate-exceeded/doc-over-quota 是服务端词表客户端零出现；**`via` 键漏**（dispatch-fallback/redo-precheck）——修正：`QuotaRejectReason` **上移 shared 单源**（客户端产出与服务端 sanitize 同类型）+via 闭集进表；**census 锚起始必须绿**（表由代码派生禁凭记忆——否则 T0/T2 一开跑就红被误判回归）。**⑵T0 常量矛盾（报告2 P0-3）**：v2.4 注释给逐 type 表但实现样例仍导出 `COLLAB_TELEMETRY_DETAIL_KEYS=['code','reason','ms','n']`——**删除该常量**（表替代，第二真源禁存在）；表增第三列 **sink**（`metric:<name>{label}` 或 `log-only` 逐键必填——v2.4 表 6 键在 T1 无指标消费者=过 sanitize 仍被指标层丢弃，观测还是拿不到）；`ws_status{from,to}` 落有界指标（4×4=16 组合基数安全——连接迁移分布唯一客户端证据）；去 `code!` 断言（code===undefined 归 auth 路由）；census 锚处理对象简写（按变量名解析）与展开（**报红禁展开进 detail**——防永真锚）。**⑶T3 补 api 侧锚文件（报告2 P0-1 实证）**：`ws-polyfill.gate.spec.ts:79-83`（断言"close(1000) 触发库自持重连"——归零模型下该行为不存在）+`collab.behavior-anchors.fixture.json:8`（events=["close(1000)"] 必然改变）——T3 Files 补两文件（前者重写为 socket 注册表装置、后者**重录**+gate 断言同步）；风险表加"**这两文件红是设计使然，禁以放宽断言方式转绿**"（否则被执行期当 flaky 重录掉=库行为锚失效）；T3 文档内部一致性（"5 行为锚"→实际 ①-⑥ 六条；Commit 行"纯观测"→"assertHealthy 单向边"；silent-renew 闩锁断言落 supervisor 用例非 T0 纯函数〔函数无状态——报告3 P2〕）；assertHealthy 加 `navigator.onLine` 前置（飞行模式不烧阶梯——报告1 D）+kickNow 抖动 0-1s→**0-3s**（40 人同刻回前台 burst 20 会 429——可自愈但正是 23⑶ 要避的形态）。**⑷T6 导入路径修正（报告1 C 机制+报告2 P1-1 上限合流）**：默认 `Y.applyUpdate(doc,bin)` origin≠provider ⇒ documentUpdateHandler〔esm:762 `if(origin===this) return` 实证〕不早退 ⇒ **整个 bin 一条 Update 帧上送** ⇒ 512KB 闸 ⇒ 3MB 备份被拒（导出 8MB/导入 512KB 不对称=逃生通道产品级断点）；修正：`Y.applyUpdate(doc,bin,provider)`（origin 抑制 Update 帧）+`forceSync()` ⇒ 上行走 **SS2 差分**（maxDocBytes+ALLOWANCE 闸）——上限判据改 `LOCAL_CACHE_MAX_DOC_BYTES`（=maxDocBytes 同源，非 2×maxTxBytes）；**导入后显式置 unsyncedDirty**（suppress-origin 同时抑制 unsyncedChanges 计数——禁"已缓存"文案对导入内容撒谎）；≤2 次尝试收敛断言（8MB SS2 抽干 bytes 桶 refill 2MB/s≈4s——单发可能 1008 退避后第二次成功）。**⑸close 分型双 reason（报告3 P0-1/P0-2 实证）**：①SS2 落 4404 后客户端归宿 QuotaBanner"一键瘦身"——但该成因超额在**客户端本地**（服务端 doc 往往小），瘦身治不了 ⇒ 新增 `SS2_OVER_LIMIT_TERMINAL_REASON='ss2-over-limit'`+resolveCloseAction(4404,reason) 按 reason 分型+客户端文案「导出 .yjs→丢弃本地副本」（走 diverged 放弃出边——非瘦身）；②`closeTeamDocuments` 用 `close(NORMAL,'team disbanded')`〔gateway:3009 裸字面量〕——24⑴ normal→exponential 使**团队解散先重连一次**（自愈但浪费+UX 差）⇒ 'team-disbanded' 升 shared 常量+NORMAL 分支按 reason 分型落 terminal（与 :68-72 doc-over-quota 特例同款形态——一个函数两处特例）。**⑹T8 dirty 守卫+触发面（报告1 B+报告3 P1-4+报告2 P1-3）**：单快照跨标签 last-writer-wins 有**clean 覆盖 dirty** 窗（标签 A diverged 唯一副本→标签 B 干净态 pagehide 覆盖→A 崩溃=真丢）⇒ put 前同事务读旧记录：`existing.unsyncedDirty && !mine.unsyncedDirty → skip+遥测 local-cache-preserved-foreign-dirty`（3 行；两 dirty LWW 是罕见边角可接受——分行方案〔报告2 按 clientID 分行+getAll 并集〕登记升级路径）；主 flush 挂 `visibilitychange→hidden`（**pagehide 里的 IDB 写是 best-effort**——浏览器不保证完成；T2 遥测 flush 同款结构）+pagehide 最后一道；结构性变更**限定增删节点**（低频）+改"置脏+提前到期"（encode 落宏任务/idle——8MB 全量编码禁占交互帧）；`collab-rate-gate.spec.ts:70-75` 两条断言**点名改写**（capacity===maxDocBytes 等式+consume(maxDocBytes+1) 探针值——24⑵ 改容量后必红且 :75 探针须改 capacity+1 否则恒真假断言；标题"=Step2 帧闸上界"→"=SS2 闸上界"）。**⑺T16 VIEWER→EDITOR 升权活路径（报告3 P1-5 实证 gateway:2516-2522）**：sweepSessions→recheckConnection `!revoked` 分支**只刷死线不施加角色**（perm.changed 双向发出但无人清 auth 期直写的 readOnly）⇒ 升级 EDITOR 必须手动刷新才能编辑（团队协作核心流程缺口）；修法：viewer 只读走 auth 期意图+connected 登记（freezeIntent 先例 :412-413）+`!revoked` 分支比较 re.role 经 `applyWriteFreeze` 施加+广播 conn-status——升权即时生效+census ⑪ readOnly 直写 3→2+升降级同出口。**⑻T1 顺序不变量用例（报告3 P1-6）**：cookie tracker 换键源后失效模式仍在（guard 顺序若变=静默退全站单桶）——照抄 collab-not-serving.filter.http-order.spec 先例断言限流守卫先于 AuthGuard 执行。**⑼措辞与登记**：24⑦"无合法切分 API"改"**无字节切分 API**"（`Y.encodeStateAsUpdate(doc,sv)` SV 分区是公开 API——Y5 merge 端点评估输入，勿因这句放弃更便宜路径）；T16 降级矩阵加"团队形态变更"行+solo `collabScope` 字段登记偏离表 **Y0c 输入**（连续三轮提——最小形态=服务端 conn-status 一字段+客户端文案分支，本批不落维持范围纪律）；**T18 偏离登记补"开真实收费前门"两项**（服务端版本历史/恢复〔compact 快照现成基座——一次误删可永久损坏团队画布〕+merge 端点〔>8MB 恢复唯一通道〕——从"后续批次"无期限篮子升为收费前门）。**出口判据补 ㉔-㉗**：㉔api 侧两锚文件在归零模型下重新绿（fixture 事件序列含 disconnect）；㉕detail 表三列齐备+census 锚对 18 调用点全绿；㉖多标签 dirty 守卫用例（A diverged+B pagehide→刷新后 A 未上行编辑仍在）；㉗.yjs 2MB 备份导入成功（上限判据换文档预算的证明）。**驳回**：快照按 clientID 分行（升级路径登记——守卫已覆盖真实丢失路径+分行有崩溃行生命周期问题）；solo collabScope 本批落地（Y0c 登记——范围纪律） | 第九轮三报告（累计 22 份）；⑴-⑸⑺为本人一手复验实证（QuotaRejectReason:73/ws-polyfill.gate:79-83+fixture:8/gateway:3009 'team disbanded'/gateway:2516-2522 只刷死线/plan:191 常量残留/esm:762 origin===this return） |

---

## 0b. 基线勘察锚点表（2026-10-12 三轮验证定稿；行号以 HEAD=71fa57f3 为准）

> 已落边界（**禁重做**）与剩余缺口。**行号已经两轮独立验证（Explore×3+本人抽查 40+ 处全命中）**。

| # | 面 | 现状（已落） | 缺口（本批） |
|---|------|----------|----------|
| 1 | 客户端 close 分型 | runtime:1023-1066 resolveCloseAction 双键（`({event})` 解构+`event?.code` 取值——形状本就正确维持）；terminal→disconnect+SyncBanner 四档（:40-82）；watchdog terminal 抑制（:1190/:188） | 触发双接（authFailed 瞬态档现零动作——socket 保持 OPEN+isAuthenticated 永假⇒恢复=fastLane 15-18s〔★裁定 23⑧：FAST_LANE_MS 15s——"60s"为通用 unhealthy gate 非本路径〕+1s 热循环风险） |
| 2 | 重连所有权 | **四套并存**：库 onClose 1s 定时器（esm:411-413——守卫调度时刻求值，disconnect 无 clearTimeout :367-376）+库内阶梯（factor2/max30s/无限）+库 watchdog（3s tick+30s 4408 forced）+app watchdog（connectionMachine）+1012 手写 timer（:1035-1038）+app recovery（:183-223）；库选项 **0 pin**（:1084-1091 一个没传） | supervisor **收归唯一**（瞬态/终态/1012/普通掉线全归——裁定 23⑴；maxAttempts:1 下"普通掉线归库"单次失败即停摆〔cancelWebsocketRetry 函数引用守卫实证〕）+open 归零 shouldConnect+库 pin（autoConnect:false——裁定 22⑹）+5 行为锚进 fixture |
| 3 | hydration | 固定 10s（:1224-1227）；failed 后 setHydration 无守卫单写点（canvasStore:1879）+ready 唯一写点不可再达（:1254）+offline.test:78-90 钉死+failed 后 watchdog 反而更快 eligible（hydrationPending=false）=**永久只读死局** | 死线 reason 分型+failed→ready 自愈（completeHydration——用例名已预留接口）+localCacheReady 三分支 |
| 4 | persist/V15 | 服务端通告已有（gateway:2016 broadcastStateless）；客户端零消费（runtime:971-973 静默透传） | 消费横幅（进单链）；reload 9 处守卫（现仅 :239 有）；导出双产物+导入器；beforeunload reason 集合+pagehide |
| 5 | 遥测 | ring 完整（collabDiagnostics 9 类型+500 环+计数）；sendBeacon/端点全仓零命中 | 全链：端点+批量上报+detail 受控枚举+ErrorBoundary（挂 router.tsx:62-65） |
| 6 | E40/C6 | unsyncedChanges 消费仅 rebuildPending（:1069-1071）+forceSyncAndWait（:1338-1346）；hasUnsyncedCanvasChanges 双源（:115-117）；updateText 无 VIEWER 门（nodeStore:579-605） | unsyncedDirty 单源+60s 横幅+updateText 三行早退（先例 applyNodeDataPatch:562-577） |
| 7 | 指标面 | /metrics 已聚合（无全局前缀——@Controller('metrics')；spec §10 canonical 块+check-spec-consistency 才是指标门禁）；~60 指标；yjs_loaded_doc_bytes collect 先例（:382-387）；spool 容量两指标已在（:283-287/:234-239） | E19 直方图+awareness 两 gauge（collect）+heap 倍率+耗时直方图+删 yjs_canvas_doc_bytes（4 读者）+yjs_client_doc_bytes（E33 触发源，随 T8） |
| 8 | Sentry | main.ts:64-75 动态 init；**双 SDK**（@sentry/nestjs 10.68+@sentry/node 10.63 直接依赖，video-separate:5 静态 import）；collab 零接线零 scrub | 单版本收敛+接线+scrub（白名单保留 csv/cb）+WS connectionId |
| 9 | HTTP 观测 | 三项全缺；TransformInterceptor 只包 body（响应头可行）+@NoTransform 装饰器已有先例（recharge.controller:13） | W3C traceparent 中间件+HTTP RED+在飞 gauge+traceId 列（普通索引 @@index——裁定 16⑪） |
| 10 | health/ready | /api/ready 五键+@SkipThrottle+token 双档（collab-ready.controller:12-39）；/api/health 极简 | degraded 块挂 ready token 视图（E54⑤ 三件+stuckDocs）；admin coverage 端点+红标 |
| 11 | 巡检/部署 | census 11 组代码模式断言（**零指标名**）；deploy.sh post=ready 轮询+guard+collab-smoke（:133-142）；SMS SDK 已依赖；runbook §6 手动四行；**deploy.sh:214 tar 只覆盖不删除**（清理仅 REBUILD_DB :199，runbook:96 实录踩坑） | check-collab-health.mjs（根 scripts/）+上次采样持久化+spool 两 P0+stuck P1+心跳自证+crontab+SMS |
| 12 | 熔断 | 仅 spool 磁盘面（WRITE_FAILURE_CIRCUIT=5，spool:76/:132）；isRetryableAppendError 含 P2024/undefined（pg-error.util:9-13）；retryPausedByCircuit 先例（gateway:2061） | PG 熔断（准入+store 短路+窗口失败率+refusalCache 半开）+矩阵（含 spool 容量行+未验证格如实标注） |
| 13 | 本地持久化 | **全仓零**（web 无 y-indexeddb/lib0 直接依赖）；runtime:1117 注释自证"无本地 seed"；escapeWithLocalExport 读 store 投影+无条件 reload（:262-263/:271）；G27 登出清理点已有（:1315-1319）；fetchProjectMeta 先于 initCollab（page.tsx:132-133 promise 链）；CanvasDoc.generation 列（schema:819）+CANVAS_DOC_SCHEMA_VERSION=2（docShape:41） | 世代通道（/projects/:id 加两字段——E3"鉴权握手返回"通道）+四维缓存键+自研 IDB 适配器内核（裁定 23⑷） |
| 14 | 迁移 | 仅 2 目录（y0b2_init 55KB+y0b4_vacuum 440B）；migrate dev 阻塞=一次 ALTER ROLE CREATEDB；check-migration-additive WARN_ONLY=DROP INDEX **不拦截**（:23/:31-36）；dump-schema-objects.mjs 写好未接门禁 | 根修四件（T12） |
| 15 | verify | 23 步串行单链（package.json:10，CI 直跑 ci.yml:53）；check-no-testutils-in-dist **fail-open**（dist 缺失 SKIP exit 0:6）；pre-commit 仅 gitleaks 且需手工启用；plan 文件**未入 git** | 前缀切片+plan-anchors 门禁+pre-commit 静态档 |

**明示非目标（本批禁做）**：空闲保活 ping/pong 整族（Y0b-3 偏离 11 证伪）；Alertmanager/监控栈；app 侧文档驱逐/reaper（触发策略所有者=库——裁定 3；容量驱逐维持 Y1c-3 与 D7 同批）；yjs_doc_bytes 红线 enforcement（合成值待标定）；writeExecStatus 复活（Y0c）；全量 OTel（裁定 4）；离线编辑上行（Y5 原批——离线窗口判据/配额水位失效/执行门失效会击穿子批出口）；第三次迁移 squash（Y0c——触发条件已升格为可判定：目录≥5 ∧ 破坏性增量 ∧ 重建窗口 ∧ 定价键哨兵化立项）；ready 周期轮询（spec §5.4 已删）；BroadcastChannel/Leader/锁（E5 直写裁定）。

---

## T-prep：verify 前缀切片+plan 锚点门禁+pre-commit（本批第一个 commit——后续所有任务吃它反馈）

**Files:**
- Create: `scripts/verify-manifest.mjs`（23 步单源数组——**命令与顺序一字不改**照抄现 package.json:10 verify 链；每步标注 `db: boolean`）+ `scripts/verify-chain.mjs`（runner：--tier=fast|full 前缀 ⊥ --skip-db=manifest db:true 过滤 ⊥ --static-only=fast∩skip-db——★裁定 24⑶ 三正交轴）+ `scripts/verify-chain.test.mjs`（元测试）
- Create: `scripts/check-plan-anchors.mjs`（解析 plans/specs 的 `path:line` 引用断言+**语义冲突扫描**——裁定 22⑫：对"已修订"标记条款（~~删除线~~/【v2.x 修正】标记）强制 grep 旧短语（如"部分唯一索引"）不得在其余章节命中——本批 v2→v2.1 六轮修订产生的双源漂移正是此类别，人工清理不可靠）+ 测试
- Modify: `package.json`（verify 改走 runner+新增 verify:fast；**禁写第二份步骤清单**）+ `scripts/hooks/pre-commit`（gitleaks 后追加 `node scripts/verify-chain.mjs --tier=fast --static-only`）

- [ ] **Step 1: 红测（verify-chain.test.mjs 元测试）**

```js
// ①每个步骤 id 唯一；cmd 引用的 scripts/*.mjs 与 --filter 目标存在（防拼写漂移）
// ②fast 的 id 序列逐字等于 full.slice(0, N)——前缀切片结构断言（两档不可能漂移）
// ③full 的 id 序列逐字等于引入时的 23 步基线常量（改门禁=改常量=有意识动作）
// ④check-plan-anchors（★裁定 23⑭ 符号锚形态——行号 advisory 防腐烂）：主断言=文件存在 ∧ 引用行 ±5 内含该行引用的标识符（从 `path:line` 后的符号文本提取）；纯行号越界只 WARN（本批大改 canvasCollabRuntime 后行号必漂——纯行号硬门=必关之门）；坏路径/坏符号→exit 非 0
// ⑤强制计划文件已入 git（未跟踪的 plan → 红消除"未跟踪的 plan 无门禁"洞——本文件首commit即自证）
```

- [ ] **Step 2: 跑红** → FAIL。
- [ ] **Step 3: 绿实现**。★裁定 24⑶ **三正交轴**（v2.3"前缀∩跳 DB 步"数学互斥的修正）：`--tier=fast|full`=前缀长度（元测试② fast===full.slice(0,N) 维持）⊥`--skip-db`=按 manifest `db:true` 过滤（步骤 2/4/5〔verify-indexes/check-migrate-diff/check-pricing-coverage〕无 DATABASE_URL 即**非零**退出属 DB 硬依赖——exit code 口径改"非零"：verify-indexes 是 throw exit 1 非 exit 2）⊥`--static-only`=fast∩skip-db（pre-commit 用）；元测试增 `skip-db(full)===full.filter(s=>!s.db)`；**nest build 与 check-no-testutils-in-dist 同档硬约束**（后者 dist 缺失 SKIP exit 0=fail-open，拆开即空转）——**顺带修复该 fail-open**（`--require-dist` 档：verify 链上调用改传该旗标，dist 缺失即 exit 1，3 行）；`node --test "scripts/**/*.test.mjs"` 空 glob exit 0 同批修（node --test 列举式或 glob 库——Windows 空 glob 展开为字面量）。**判据禁写墙钟**（"<3min"是 D13 假门禁原型）；`verify:fast` 非出口判据（出口只认 `pnpm verify` 全量——写进 T18 与 CLAUDE.md 级说明）。
- [ ] **Step 4: 跑绿**：`pnpm verify:fast`+`pnpm verify`（全量）双绿；元测试绿。
- [ ] **Step 5: Commit**：`feat(y0b-5): T-prep verify 前缀切片（manifest 单源+元测试）+check-plan-anchors 静态门禁+pre-commit 静态档`

---

## Task 0：shared 契约——遥测白名单+detail 受控 schema+退避纯函数

**Files:**
- Create: `packages/shared/src/constants/collab-telemetry.ts` + `.test.ts`
- Modify: `packages/shared/src/constants/collab-close-code.ts`（尾追加纯函数）+ `.test.ts`
- Modify: `packages/shared/src/constants/index.ts`

- [ ] **Step 1: 红测——白名单+detail schema**

```ts
import { COLLAB_TELEMETRY_EVENT_TYPES, isKnownTelemetryType,
         MAX_TELEMETRY_EVENTS_PER_BATCH, MAX_TELEMETRY_EVENT_BYTES, sanitizeTelemetryDetail } from './collab-telemetry';

describe('遥测白名单+detail 受控四键（冻结契约 11）', () => {
  it('12 值封闭：ring 九类+close_code/unsynced_close/projection_duration', () => {
    expect(COLLAB_TELEMETRY_EVENT_TYPES).toHaveLength(12);
    for (const t of ['ws_status','recover_triggered','watchdog_fire','hydration_fail','auth_reject','write_reject','invariant_violation','sync_pending_retry','conn_scope','close_code','unsynced_close','projection_duration'] as const)
      expect(isKnownTelemetryType(t)).toBe(true);
  });
  it('detail 键白名单={code,reason,ms,n}——其余键剥除（projectId/docName/query/hash 全剥）', () => {
    const out = sanitizeTelemetryDetail('close_code', { code: 4408, projectId: 'p1', evil: 'x' });
    expect(out).toEqual({ code: 4408 });
  });
  it('code/reason 值域校验：code∉CollabCloseCode 值域→other；reason∉CollabAuthReason 13 值→other（ws_status.reason 另含 unsynced-lag/local-cache-degraded 受控值）', () => {
    expect(sanitizeTelemetryDetail('close_code', { code: 9999 })).toEqual({ code: 'other' });
    expect(sanitizeTelemetryDetail('auth_reject', { reason: 'made-up' })).toEqual({ reason: 'other' });
  });
  it('批量上限 12 条按【复合聚合键 type|code|reason 聚合后的条数】计（单 type 多 code=多条——分布不被压掉）/单条 512B 常量', () => {
    expect(MAX_TELEMETRY_EVENTS_PER_BATCH).toBe(12); expect(MAX_TELEMETRY_EVENT_BYTES).toBe(512);
  });
});
```

- [ ] **Step 2: 红测——退避纯函数（真协议路径；jitter 入参）**

```ts
import { resolveBackoffPlan, TRANSIENT_BACKOFF_STEPS_MS } from './collab-close-code';
import { CollabAuthReason } from './collab-auth-reason';

describe('退避计划（spec §5.2 v2.2——RECOVER_BACKOFF_MS 族一张表；纯函数零 Math.random）', () => {
  it('auth 瞬态档（code=undefined）：五瞬态 reason 全落指数档（真协议路径①——denyAuth→authenticationFailed）', () => {
    for (const r of [CollabAuthReason.DRAINING, CollabAuthReason.LEASE_NOT_READY, CollabAuthReason.DB_UNAVAILABLE,
                     CollabAuthReason.SERVER_OVERLOADED, CollabAuthReason.RATE_LIMITED, CollabAuthReason.SERVER_OUTDATED]) {
      expect(resolveBackoffPlan('auth', undefined, r, 0, 0).kind).toBe('exponential');
    }
  });
  it('close 瞬态档（真协议路径②③）：close(1008,"msg-rate-exceeded")与 close(4408,"forced") 落指数档', () => {
    expect(resolveBackoffPlan('close', 1008, 'msg-rate-exceeded', 0, 0).kind).toBe('exponential');
    expect(resolveBackoffPlan('close', 4408, 'forced', 0, 0).kind).toBe('exponential');
  });
  it('阶梯+封顶：jitter=0 时 ms=STEPS[min(attempt,3)]；attempt≥3 恒 30_000；jitter 注入加成', () => {
    expect(resolveBackoffPlan('auth', undefined, CollabAuthReason.DRAINING, 0, 0).ms).toBe(2_000);
    expect(resolveBackoffPlan('auth', undefined, CollabAuthReason.DRAINING, 99, 0).ms).toBe(30_000);
    expect(resolveBackoffPlan('auth', undefined, CollabAuthReason.DRAINING, 0, 2_000).ms).toBe(4_000);
  });
  it('planned-restart(1012)=short（★裁定 23⑵：键名 APP_RESTART——库无 PLANNED_RESTART 键，v2.2 写法 tsc 必错；jitter 0-60s full 由调用方生成传入——★裁定 23⑶：NAT 40 客户端部署窗算术 40/60s=0.67/s<upgradeBucket refill 1/s，原 1-3s 窗必 429）', () => {
    const p = resolveBackoffPlan('close', 1012, '', 0, 0);
    expect(p.kind).toBe('short');
  });
  it('terminal/close-normal=none（★裁定 23⑵ 按路由分流：code!==undefined 时 resolveCloseAction 单源判定——(4401,"Unauthorized") 落 terminal 档（v2.2 的 isTerminalReason 子句对库默认 reason 误判 transient=对服务器将持续拒绝的连接无限重试，resolveCloseAction :57 注释自述当初要防的同型 bug）；★none 语义显式命名"永久断线"=不可扩展集合（仅 terminal 档+应用主动销毁两处——裁定 24⑴）', () => {
    expect(resolveBackoffPlan('close', 4401, 'Unauthorized', 0, 0).kind).toBe('none');
  });
  it('★silent-renew 档（裁定 24⑴——v2.3 路由表漏此档=每个被 sweep 会话永久断线）：(4401,"session-expired")→{kind:"silent-renew",ms:500+jitter} 立即重连一次不进阶梯（runtime:1039-1041 现状 silentRenewUsed 闩锁语义收编——第二次同因回落 terminal）', () => {
    const p = resolveBackoffPlan('close', 4401, 'session-expired', 99, 0);
    expect(p.kind).toBe('silent-renew'); expect(p.ms).toBeLessThanOrEqual(1_500);
  });
  it('★normal(1000) 改带退避的一次重连（裁定 24⑴——库抹码形态 (1000,reason) 可能掩盖瞬态关闭，客户端无法区分；真终态服务端下次握手以带 reason 的 auth 拒档权威分型——单所有者下落 idle=永久断线）', () => {
    expect(resolveBackoffPlan('close', 1000, '', 0, 0).kind).toBe('exponential');
  });
  it('★五档穷尽性表驱动用例（裁定 24⑴——拆兜底后防漏档的唯一门）：对 CloseActionKind 全五档 × 常见 reason 矩阵断言 kind 映射穷尽且合法（terminal→none/silent-renew-once→silent-renew/planned-restart→short/backoff→exponential/normal→exponential）；未来新增 kind 未映射即红（kind 联合类型驱动编译期+运行时双重穷尽）', () => { /* 表驱动 */ });
  it('★AUTH_WAIT_TIMEOUT 独立路由（裁定 23⑵）：socket OPEN 但 10s 未 authenticated（permissionDeniedHandler 只 emit 不断开——含被限流 429+destroy 后的握手失败形态）→exponential（传 (undefined,"") 会得 none 与 supervisor Step③ attempt++/重排自相矛盾）', () => {
    expect(resolveBackoffPlan('timeout', undefined, '', 0, 0).kind).toBe('exponential');
  });
  it('非 terminal reason 判据派生自 isTerminalReason 单源——未来新增瞬态 reason 自动落指数档（禁第二张 reason 表）', () => {
    // SERVER_OUTDATED 已覆盖（上上用例）；本用例锁实现形态：resolveBackoffPlan 内禁出现独立 TRANSIENT_REASONS 集合字面量
  });
});
```

- [ ] **Step 3: 跑红** → FAIL。
- [ ] **Step 4: 绿实现**

`collab-telemetry.ts`：

```ts
/** Y0b-5 T0（spec §5.6 冻结契约 11）：遥测白名单 ≤12 + detail 受控四键——无 PII=无自由文本
 *  （受控枚举/数值不是 PII）；禁 projectId/docName/query/hash。E40 经 ws_status.detail.reason='unsynced-lag' 携带。 */
export const COLLAB_TELEMETRY_EVENT_TYPES = [
  'ws_status','recover_triggered','watchdog_fire','hydration_fail',
  'auth_reject','write_reject','invariant_violation','sync_pending_retry','conn_scope',
  'close_code','unsynced_close','projection_duration',
] as const;
export type CollabTelemetryEventType = (typeof COLLAB_TELEMETRY_EVENT_TYPES)[number];
// ★裁定 25⑵：COLLAB_TELEMETRY_DETAIL_KEYS 四键常量删除（与逐 type 表构成第二真源）——
// detail 键域唯一来源=下方逐 type 表（允许键∪值域∪sink 三列）；write_reject 值域=QuotaRejectReason
// （★上移 shared 单源——canvasIntents re-export）∪{'selection-too-large','quota-soft'}，via∈{dispatch-fallback,redo-precheck}；
// 表由代码调用点派生禁凭记忆（census 锚起始必须绿）；sink 列逐键必填（metric:<name>{label}｜log-only——
// 无 sink 的允许键=过 sanitize 仍被指标层丢弃）；ws_status{from,to} 落有界指标（4×4=16 组合）。
export type CollabTelemetryEvent = { type: CollabTelemetryEventType; at: number; n?: number; ms?: number;
  code?: number | 'other'; reason?: string };
export const MAX_TELEMETRY_EVENTS_PER_BATCH = 12;
export const MAX_TELEMETRY_EVENT_BYTES = 512;
export const isKnownTelemetryType = (t: string): t is CollabTelemetryEventType =>
  (COLLAB_TELEMETRY_EVENT_TYPES as readonly string[]).includes(t);
// sanitizeTelemetryDetail(type, detail)：★裁定 24⑶ 逐 type detail schema 表（v2.2 四键白名单与 18 处调用点不匹配——
// sanitize 在服务端执行⇒客户端无感⇒越界键静默剥除且无测试红=TD-26 同族）。表（允许键 ⊇ 仓内既有调用点实测形状）：
//   ws_status           → {from,to}（迁移对——runtime:946）∪ {reason}（'unsynced-lag'/'local-cache-degraded' 受控值）
//   recover_triggered   → {level: 'terminal'|'transient'}（runtime:197）
//   conn_scope          → {scope}（runtime:955）
//   auth_reject         → {reason ∈ CollabAuthReason ∪'other', terminal?: boolean}（runtime:1012）
//   write_reject        → {reason ∈ QuotaRejectReason 四值〔key-too-large/tx-too-large/too-many-nodes/doc-over-budget——★上移 shared 单源〕∪{selection-too-large, quota-soft}, via? ∈ {dispatch-fallback, redo-precheck}}（★裁定 25⑴：v2.4 五值三缺两多+漏 via——msg-rate-exceeded/doc-over-quota 系服务端词表客户端零产生；census 锚起始必须绿）
//   watchdog_fire       → {executed: boolean} ∪ {reason: 'stalled'}（裁定 24⑩）
//   hydration_fail      → {}（无 detail）
//   invariant_violation → {where}（applyRemote/applyBootstrap/react-boundary——T2 ErrorBoundary 统一 where 禁 surface）
//   close_code          → {code ∈ CollabCloseCode 值域 ∪'other'}
//   projection_duration → {ms}；unsynced_close → {n}；sync_pending_retry → {n}
// 表外键一律剥除；★census 新增静态锚：生产代码每个 recordCollabDiag(type,detail) 调用点键集 ⊆ 该 type 允许键集
// ∧ reason 值域 ⊆ 枚举（新增调用点自动受检——机器可判根治整类，非逐点登记）。
```

`collab-close-code.ts` 尾追加（纯函数，jitter 全额由调用方生成传入）：

```ts
/** Y0b-5 T0（spec §5.2 v2.2；v2.3 裁定 23⑵ 按路由分流+v2.4 裁定 24⑴ 穷尽性/⑸杂项 route 参数）：
 *  显式路由参数 route:'auth'|'close'|'timeout'（先例 CloseAction.synthetic 标志——reason 只承载协议串，禁内部哨兵）；
 *  close 路由以 resolveCloseAction 五档穷尽映射（silent-renew-once→silent-renew 立即一次/normal→exponential
 *  带退避一次重连——库抹码可能掩盖瞬态；terminal→none）；auth 路由 isTerminalReason；
 *  ★none=「永久断线」显式语义——不可扩展集合，仅 terminal 档与应用主动销毁两处产生。 */
export const TRANSIENT_BACKOFF_STEPS_MS = [2_000, 5_000, 10_000, 30_000] as const;
export type BackoffRoute = 'auth' | 'close' | 'timeout';
export type BackoffPlan =
  | { kind: 'none'; ms: 0 }                        // 永久断线（terminal 档/应用销毁）
  | { kind: 'silent-renew'; ms: number }           // 4401 'session-expired'——500ms+jitter 立即一次，闩锁第二次回落 terminal
  | { kind: 'short'; ms: number }                  // 1012——jitter 0-60s full（裁定 23⑃）
  | { kind: 'exponential'; ms: number };
export function resolveBackoffPlan(route: BackoffRoute, code: number | undefined, reason: string, attempt: number, jitterMs: number): BackoffPlan {
  const exponential = (): BackoffPlan => ({
    kind: 'exponential',
    ms: TRANSIENT_BACKOFF_STEPS_MS[Math.min(attempt, TRANSIENT_BACKOFF_STEPS_MS.length - 1)] + jitterMs,
  });
  if (route === 'timeout') return exponential();                                    // socket OPEN 未认证 10s 超时
  if (route === 'auth' || code === undefined) return isTerminalReason(reason) ? { kind: 'none', ms: 0 } : exponential(); // code 缺失归 auth 路由（裁定 25⑵ 去 code! 断言）
  // close 路由：五档穷尽（kind 联合类型+default exhaustiveness check——新增档未映射即编译红）
  const action = resolveCloseAction(code, reason);
  switch (action.kind) {
    case 'planned-restart': return { kind: 'short', ms: 1_000 + jitterMs };
    case 'silent-renew-once': return { kind: 'silent-renew', ms: 500 + jitterMs };
    case 'backoff': return exponential();
    case 'normal': return exponential();                                            // 裁定 24⑴——库抹码掩盖瞬态；真终态由下次握手 auth 拒档权威分型
    case 'terminal': return { kind: 'none', ms: 0 };
  }
}
```

（`isTerminalReason` 从 collab-auth-reason 导入——shared 内部跨文件引用已有先例；★裁定 22⑻退避表真合并+★裁定 23⑴ 收归唯一：T3 删 `connectionMachine.ts:9` 的旧退避表（RECOVER_BACKOFF_MS——T3b 实施期已删）改 import 本表——单所有者形态下 watchdog 降级纯观测、cooldown 消费点消失，**connectionMachine.spec.ts:36 硬锚 `[5,10,20,30]s` 随 watchdog 角色重写同批改写**（"表已删、消费点已删"锚——非静默改值非两表并存）。）

- [ ] **Step 5: 跑绿**：shared 全测 PASS（既有 collab-close-code 用例零回归）。
- [ ] **Step 6: Commit**：`feat(y0b-5): T0 shared 遥测白名单 12 值+detail 受控四键 schema+退避纯函数（jitter 入参+isTerminalReason 单源派生）`

---

## Task 1：遥测端点——POST /api/collab/telemetry（一律 204+detail 枚举 label）

**Files:**
- Create: `apps/api/src/modules/collab/telemetry.controller.ts` + `telemetry.service.ts` + `telemetry.controller.spec.ts`
- Modify: `apps/api/src/modules/collab/collab.module.ts`；`store.metrics.ts`（尾部）

- [ ] **Step 1: 红测**

```ts
it('合法批次（含 detail 受控值）→204 空体（@NoTransform+@HttpCode(204)——TransformInterceptor 会包 {code:0,data}）', ...);
it('close_code→collab_telemetry_close_total{code="4408"} 计数；code 越界值→{code="other"}（防基数）', ...);
it('auth_reject→collab_telemetry_auth_reject_total{reason="draining"}；未知 reason→{reason="other"}', ...);
it('projection_duration.ms→collab_telemetry_projection_ms Histogram observe；ws_status.reason=unsynced-lag→collab_telemetry_ws_reason_total{reason}', ...);
it('未知 type→204 且只计 collab_telemetry_unknown_total（禁 4xx——sendBeacon 不可观测响应，413 同为重试风暴面；超限同样 204+collab_telemetry_rejected_total{reason}）', ...);
it('Content-Type text/plain→204 零计数（Nest json parser 不解析=预检防线维持——禁加 Parser 容错）', ...);
it('@Throttle 独立桶 120/min+★getTracker=cookie 哈希（裁定 24 杂项采纳报告1 P1-7：req.headers.cookie 直接读+sha256(parseSessionToken)[0:16]——**不依赖 req.user**⇒与 APP_GUARD 顺序解耦，边缘限流先于鉴权的安全不变量保持；缺 cookie 回落 req.ip；全站单桶→per-user〔canonical tech-debt app.module:92 消掉〕；部署/事故期客户端集体 flush 场景成立——升级路径转正；★裁定 25⑧ **顺序不变量用例**：照抄 collab-not-serving.filter.http-order.spec 先例断言限流守卫先于 AuthGuard 执行——cookie 键源失效模式〔guard 顺序若变=静默退全站单桶〕已发生过两次，5 行锁死）', ...);
it('AuthGuard：无 cookie 401（sendBeacon 唯一凭据面）', ...);
it('采样上限：单 type 单 flush 窗 ≤N（N=5——降频防单一事件刷屏）', ...);
it('断言无客户端自由字符串进任何 labelNames（反向 grep 型用例——服务端枚举唯一来源）', ...);
```

- [ ] **Step 2: 跑红** → FAIL。
- [ ] **Step 3: 绿实现**：controller `@NoTransform()+@HttpCode(204)+@Post()+AuthGuard+@Throttle({default:{limit:120,ttl:60_000}})`；service.ingest=手写 guard（events≤12/每条 stringify≤512/sanitizeTelemetryDetail 复用 shared 单源）+计数族：`collab_telemetry_events_total{type}`+`close_total{code}`+`auth_reject_total{reason}`+`ws_reason_total{reason}`+Histogram `projection_ms`（buckets [5,25,100,500,2500]）+`unknown_total`+`rejected_total{reason}`；clientBuild/csv/generation 三键进**结构化日志字段**（Logger JSON——禁进 label；★裁定 23⑫：v2.2"clientBuild 有界可作 info gauge"撤销——build 值**客户端可控**=无界 label 基数面〔被篡改/陈旧客户端可逐次刷新 gauge label 集〕，clientBuild/csv/generation 一律只走结构化日志，零 info gauge）。
- [ ] **Step 4: 跑绿**；Commit：`feat(y0b-5): T1 telemetry 端点——一律 204+detail 枚举有界 label（close/auth/直方图）+独立桶 120/min`

---

## Task 2：客户端遥测接线+ErrorBoundary+投影打点+invariant 采样化

**Files:**
- Modify: `apps/web/src/utils/collabDiagnostics.ts`（批量缓冲+flush）+测试；`apps/web/src/stores/canvasCollabRuntime.ts`（close_code/projection 记录+invariant 采样——close handler 维持 `({event})` 解构形状，裁定 18①）；`apps/web/src/pages/canvas` 路由挂载
- Create: `apps/web/src/pages/canvas/CanvasErrorBoundary.tsx` +测试

- [ ] **Step 1: 红测**

```ts
// collabDiagnostics.test.ts：
it('30s 心跳批量：聚合键=type|code|reason 复合（同窗 3×4408+2×1008=两条各自计数 n=3/2——分布不被压掉）且 Blob type=application/json（禁 text/plain=CORS simple request 跨站伪造面）', ...);
it('loop 启停绑定 initCollab/destroyCollab——无会话零 beacon（防匿名页 2/min 永久 401 噪声）', ...);
it('flush 走 sendBeacon/fetch keepalive 直连——禁走 apiFetch（其 401 无差别置 httpExpired 电平=误报登录过期；client.ts:30 锚）', ...);
it('pagehide（主）+visibilitychange hidden（辅）即刻 flush——应用侧 pagehide 现为零挂载', ...);
it('聚合后 ≤12 条截断+丢弃计数（复合键下截断分支真实可达——按 type 聚合时 12 类封顶此分支不可达=永真用例已废）；白名单外类型不入批（运行时防御）', ...);
it('clientBuild=__CLIENT_BUILD__（vite.config:11 define——__BUILD_HASH__ 不存在禁出现）', ...);
// runtime 侧：
it('close handler 保持 ({event}) 解构+event?.code 取值（库载荷恒 {event} 包装 esm:257/:461/:662——现有 :1023/:1029 形状本就正确，"解构补齐 {event,code,reason}"是退化禁采纳）——recordCollabDiag("close_code",{code:event?.code}) 反向断言：emit("close",{event:{code:4408}}) 下取到 4408（防整片落 other 哑写点）', ...);
it('projection_duration 打点包 applyDocToStore（含 reconcile+invariant——runtime:1263-1273；与 alignExecFromIntents 互不包含禁打错位）', ...);
it('checkProjectionInvariant 生产采样改确定性节律：每 30 次 apply 或每 30s 一次+hydration synced 后必跑+结构性变更（增删节点）后必跑+DEV 全跑（1% 概率在 vitest flaky 且现场无法估率——现生产无条件执行 :1266=热路径调试垫片）', ...);
// ErrorBoundary：
it('componentDidCatch→invariant_violation{where:"react-boundary"}（★裁定 24⑶ 对齐既有 4 处 where 键——T2 初稿 surface 与 T0 schema 表矛盾）+同步 flushTelemetry+降级 UI（刷新+导出按钮）；★错误栈受控枚举（裁定 24 杂项）：error.name+首帧 file:line 折 detail——Y5 前可诊断非只知崩了', ...);
it('★SLO 两条直方图（裁定 24）：hydration_duration（initCollab→ready 事件驱动）+reconnect_duration（掉线→authenticated）——零轮询事件打点；edit→ack 依赖 sync-ack wire 解析=登记升级路径不进本批', ...);
it('挂载=canvas 路由根（router.tsx:62-65 对应 pages/canvas——不裹全局 App）', ...);
```

- [ ] **Step 2: 跑红** → FAIL。
- [ ] **Step 3: 绿实现**：collabDiagnostics 扩批量聚合（聚合键=**type|code|reason 复合**——pendingByType 旧名单参改复合键 Map）+`_startTelemetryLoop/_stopTelemetryLoop` 测试缝+`flushTelemetry()`（Blob application/json→`navigator.sendBeacon('/api/collab/telemetry',blob)`，不可用降 `fetch(...,{keepalive:true})`——**两路均不经 apiFetch**；loop 绑 initCollab/destroyCollab）；runtime close handler **维持 `({event})` 解构+`event?.code` 取值**+`recordCollabDiag('close_code',{code:event?.code})`；`applyDocToStore` 调用点外包 `performance.now()` 耗时（禁 Date.now——单调钟）→`recordCollabDiag('projection_duration',{ms})`；invariant **确定性节律**（apply 计数每 30 次+30s 上限取先到+hydration synced 后必跑+结构性变更（增删节点）后必跑+DEV 全跑——计数器/时间戳两判据）。
- [ ] **Step 4: 跑绿**；Step 5: **手验（spec §5.6 验收锚）**：dev 制造一次 hydration failed+一次投影异常（临时 throw 组件）→30s 后 Network 见 POST 200+api 侧 `collab_telemetry_events_total{type="hydration_fail"}`/`{type="invariant_violation"}` 可见（curl /metrics 核对）+ErrorBoundary 降级 UI（验后删临时代码）。
- [ ] **Step 6: Commit**：`feat(y0b-5): T2 ring 接 sink（pagehide+30s 批量+直连禁 apiFetch）+close_code/projection 打点（applyDocToStore 位）+invariant 采样化+ErrorBoundary`

---

## Task 3：CollabConnectionSupervisor——单连接所有权（重写 v1 的"5 步状态机"）

**Files:**
- Create: `apps/web/src/collab/connection-supervisor.ts` + `connection-supervisor.test.ts`（**全仓唯一允许调 provider connect()/disconnect() 的模块**——结构性所有权，非注释约定）
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（:1023-1066 close handler+:1009-1022 authFailed handler+:1035-1038 删 1012 手写 timer+:183-223 recoverConnection 收编〔★:194 `terminal=!p.isAttached‖!ws?.shouldConnect` 谓词**语义反转点名改写**——归零后健康连接 shouldConnect≡false⇒恒判终态，改 isAttached 单判据+supervisor phase 消费——裁定 24⑷①〕；:1084-1091 provider 构造加 pin+open 归零挂点）+ `connectionMachine.ts`（★裁定 23⑴/24⑷④：watchdog 降级观测+**assertHealthy 单向边**〔裁定 24⑩——见 Step 3〕；kick 路径/RECOVER_BACKOFF_MS cooldown 消费点删除+spec:36 锚同批改写；MachineInputs 的 cooldownMs/recoveryAttempts/lastRecoveryAt 与 MachineOutput.action **一并删**——留不消费字段=第三态）
- Modify: `apps/web/src/collab/reconnectTransport.ts`（★裁定 24⑷③ 整模块契约废弃——needKick 定义="shouldConnect 未被我们动过"归零后恒假：**改造为 socket 单实例注册表**——保留注入类唯一构造点+删 reconnect()/needKick+导出 activeSocketCount()+构造期"已有 CONNECTING/OPEN 实例则强关"不变量〔phantom-socket 从纪律变结构〕；reconnectTransport.spec 84 行同批改写）+ `canvasCollabRuntime.t9.spec.ts:198-211`（★裁定 24⑷② 整条重写为"瞬态→supervisor 指数表接管"——:204 expect(shouldConnect).toBe(true) 必红+:206-211 watchdog kick 计数必红）
- Create: `apps/web/test/fixtures/fakeHocuspocusProvider.ts`（★裁定 24⑪⑤：10 个 spec 手搓 websocketProvider mock〔canvasIntents.quota:30/viewer:44/version-channel:29/invariant:47/quota:36/t9:44/force-sync:31/paste-chunk:27/execView:38/conn:46〕收敛为唯一载体——库契约一改 mock 静默各漂；亦为 6 条库行为锚客户端侧装置，api 侧 behavior-anchors.fixture 同源；各 spec 同批改 import）
- Modify: `apps/api/src/modules/collab/ws-polyfill.gate.spec.ts`（★裁定 25⑶：:79-83 断言"close(1000) 触发库自持重连"——归零模型下该行为不存在，**重写**为 socket 单实例注册表装置〔activeSocketCount+构造期强关不变量〕）+ `collab.behavior-anchors.gate.spec.ts` + `collab.behavior-anchors.fixture.json`（:8 events=["close(1000)"] 随归零锚**重录**+gate 断言同步——事件序列含 disconnect）；⚠️ 风险表条目："这两文件红是设计使然，**禁以放宽断言方式转绿**"（否则被执行期当 flaky 重录掉=库行为锚失效）
- Create/Modify: `apps/api/scripts/../..` 库行为锚：`apps/web` 侧新增 `collab.behavior-anchors` 客户端 fixture（若锚族在 api 侧则同 fixture 加条目——执行期按 fixture 实际位置）

- [ ] **Step 0: 库 pin+行为锚（正确性前置）**

```ts
// runtime createProvider（:1084-1091）加显式 pin（现状 0 pin——一切正确性建立在库默认上=裸底座）：
new HocuspocusProvider({
  url, name, document, token, WebSocketPolyfill,
  // T3 pin（supervisor 收归唯一形态——所有权边界见 Step 3 注释）：
  maxAttempts: 1,                    // 关单次 connect 内部的 retry ladder（factor2/max30s）——所有重试由 supervisor 承接，库内零重试；connect() promise 在 ladder 用尽时 reject（retry().catch rethrow）⇒ supervisor connectOnce 必 catch（:242-244）
  delay: 1_000, maxDelay: 30_000,    // 显式钉=库默认值（防升级漂移；收紧是 supervisor 职责非库配置）
  messageReconnectTimeout: 30_000,   // 显式钉（库 3s tick+30s 判死+4408'forced' 合成路径保留——纳入 app 分级口径）
  autoConnect: false,                // ★裁定 22⑹：库构造器首连未 await 未 catch——首连改 supervisor connectOnce()；conn.spec 首连用例核对（断言连接结果非触发者）
});
// ★裁定 23⑴ 核心机制——open 事件归零 shouldConnect（收归唯一所有者的结构保证）：
//   ws = provider.configuration.websocketProvider
//   provider.on('open', () => ws.setConfiguration({ autoConnect: false }))
// 库源码实证（esm:211-217）：setConfiguration 显式 `if (!autoConnect) this.shouldConnect = false`；
// onClose 1s 重连定时器守卫=`!this.cancelWebsocketRetry && this.shouldConnect`（:411-413）——
// shouldConnect≡false ⇒ 库定时器结构性永不排程（公开 setter，零 override 零 monkeypatch）。
// ⚠️ 为何必须如此（v2.2"普通掉线归库+watchdog 兜底"被推翻的实证链——裁定 23⑴）：
//   cancelWebsocketRetry 是取消函数引用：connect() 置位（:225-251）→onOpen 清空（:191）→
//   "曾 open 过再掉线"close 时守卫放行→库 1s 定时器→connect() 单次尝试（maxAttempts:1）→
//   失败即永久停摆（cancelWebsocketRetry 复为 truthy，不再排）——服务端已恢复也不重试；
//   watchdog=45-60s gate（STALE_INBOUND_MS+15s jitter runtime:1185）+hidden 永不恢复（suppressed）。
// 显式 connect() 不受影响（:225 置 shouldConnect=true，下一次 open 再归零）——supervisor connectOnce 即显式调用。
// 行为锚 6 条（collab.behavior-anchors fixture+gate spec——升级必重跑；装置=真实库+fake WebSocket 基类——ws-polyfill.gate.spec 先例，禁纯 mock 自证）：
// ①★归零锚（裁定 23⑴，取代 v2.2 双顺序锚）：open 后掉线（fake ws open→close 1006）→**库零定时器排程**（fake timer 断言 setTimeout 未被库调用）+supervisor 按指数表接管；disconnect() 无 clearTimeout 的既有事实不再需要顺序锚（定时器根本不排）
// ②cancelWebsocketRetry 生命周期锚：connect 置位（取消函数引用 truthy）→onOpen 清空（void 0）→失败尝试的 onClose 守卫被 truthy 引用拦（库不排定时器的第二道保险——v2.2"两套并存"叙事删除的实证基础）
// ③checkConnection 30s 无入站→前两击软关清 messageQueue+第三击合成 4408'forced' 且不清队列（:342-357 互斥分支）——该路径不 emit close=客户端不可观测，**4408 用例仅作分类器单测禁作生产路径**
// ④库内 ladder delay/maxDelay 生效形态（maxAttempts:1 下单次+ladder 用尽 connect() reject 形态 :242-244）
// ⑤connect() 在飞 attempt 槽位（connectionAttempt/webSocket 非空）时重复调用会 cancel 旧 attempt 新建第二 socket（:220-223/:335-340）——connectOnce 守卫的结构依据；⑥镜像锚：disconnect() 后 webSocket===null⇒connectOnce 放行（"非空即退"在 CLOSED 残留时永不重连=死锁）——守卫按 readyState∈{CONNECTING,OPEN} 判定（裁定 22⑺维持）
```

- [ ] **Step 1: 红测（真协议路径——禁不可达配对；锚用真实库装置）**

```ts
// connection-supervisor.test.ts（真实 provider+fake WebSocket 基类——transport 注入类计数新实例）：
it('真协议①：authenticationFailed("server-overloaded")（瞬态档）→状态机接管：先 disconnect（废库 1s 定时器）→按表计时→connect', ...);
it('真协议②：close(1008,"msg-rate-exceeded") 同入退避（close 次级触发面）；close(4408,"forced") 仅作分类器单测（库内部合成不 emit close——客户端不可观测）', ...);
it('★connectOnce 三防（裁定 22⑺）：⑥镜像锚——disconnect 后 webSocket===null⇒放行（死锁反向锚）；守卫按 readyState∈{CONNECTING,OPEN} 判定（CLOSED 残留非死锁条件）；connectOnce 失败/被关后立即复置 shouldConnect=false（与归零机制一致性——open 前失败窗内 shouldConnect 仍 true，防任何残余路径排定时器）', ...);
it('Step④ 显式超时：connect 后 AUTH_WAIT_TIMEOUT_MS（10s）内未 authenticated→attempt++ 重排（防 socket OPEN 但 isAuthenticated 永假的挂起——permissionDeniedHandler 只 emit 不断开 esm:949-952）', ...);
it('authenticated 到达→attempt=0 清零', ...);
it('退避期间零并发 socket：activeSocketCount()≤1（transport 实例计数）+ws.connectionAttempt 非空期间不产生第二实例（connectOnce 槽位守卫——真实库观测非 mock 自证）；jitter=0 注入做确定性阶梯断言', ...);
it('零 unhandled rejection：maxAttempts:1 下首连失败（fake ws 立即 error）→connectOnce().catch(noop) 吞掉（:242-244 rethrow 实证）——unhandledRejection 计数==0', ...);
it('1012 planned-restart 并入状态机（删 :1035-1038 手写 timer）——short 档 1s+full jitter 0-60s（★裁定 23⑃ NAT 部署窗算术）+sessionEpoch 捕获对比（destroy→新会话后旧 timer 不得 kick 新 provider——真实缺陷路径用例）', ...);
it('terminal→disconnect 终局不重试（复发防线维持）；★watchdog 降级纯观测（裁定 23⑴）：recoverConnection/needKick/cooldown 消费点全删——零 kick 路径（stale-inbound 判定保留仅喂 recordCollabDiag/ui 电平；RECOVER_BACKOFF_MS 删除+其 spec:36 硬锚改写"表已删消费点已删"）', ...);
it('瞬态档恢复时延断言：server-overloaded 后首 connect 在 2-4s 窗内（★裁定 23⑻ 理由改写：现状=fastLaneEligible 15s+库 1s≈15-18s〔FAST_LANE_MS runtime:1183——v2.2 所写"60s stale-inbound 门"为通用 unhealthy gate 非本路径〕；真风险面=①socket 保持 OPEN 无人关②无退避 1s 热循环打 draining 服务端——T3 收益=15-18s→2-4s+热循环消除）', ...);
it('★普通掉线收归 supervisor（裁定 23⑴——推翻 v2.2"普通掉线归库"）：open 过→掉线 1006→库零定时器（归零锚①）→supervisor 指数表接管首连 2-5s；服务端仍不可用时阶梯续试**不因单次失败停摆**（maxAttempts:1 切断库重连的实证反面——本任务存在理由核心用例）；hidden 期间不连（visibilitychange 恢复即连——对照现状 hidden 永不恢复）', ...);
it('★silent-renew 档收编（裁定 24⑴——v2.3 路由表漏此档）：close(4401,"session-expired")〔服务端 sweep **常规事件**——runtime:1039-1041 现状 silentRenewUsed 闩锁语义收编〕→立即重连一次（500ms+jitter 不进阶梯）+闩锁；第二次同因回落 terminal 不重试（一会话一次语义保持）', ...);
it('★normal(1000) 带退避一次重连（裁定 24⑴——库抹码形态 (1000,reason) 可能掩盖瞬态；真终态由下次握手 auth 拒档权威分型）：close(1000)→exponential 档重连', ...);
it('★模型式不变量用例（裁定 24⑾——覆盖"偶发双 socket/静默停摆"整类）：fake timer+transport 对任意 open/close/authFailed/teardown/epoch 变更事件序列（随机化驱动 N 轮）断言 (a)活跃 socket≤1 (b)瞬态恰一待触发 timer（不多不少） (c)terminal 后零 timer (d)teardown/epoch 变更后零 timer 且旧 timer 不 kick 新会话', ...);
it('★kickNow 事件触发恢复（裁定 24⑨+25⑶ 抖动 0-3s）：bindReevaluateOnce 挂点（:1104-1114）的 online/visibilitychange(可见)→supervisor.kickNow()（**0-3s** jitter——0-1s 下 40 人同刻回前台 burst 20 必 429，可自愈但正是 23⑶ 要避的形态；已排程则忽略）——⑱两段式"事件触发 ≤2s"的用例面', ...);
it('★supervisor 卡死兜底+覆盖面（裁定 24⑩+25⑶ onLine 前置）：watchdog assertHealthy 单向边（3s tick 判 **navigator.onLine**〔飞行模式不烧阶梯——恢复归 online 事件→kickNow〕∧phase!=="terminal"∧connStatus==="offline"∧无在飞 timer∧无在飞 attempt→经 supervisor 公开入口排程+watchdog_fire{reason:"stalled"}——不直接碰 socket恢复权唯一）；supervisor 订阅 disconnect 事件（库合成 4408 路径不 emit close、onClose 恒 emit disconnect——锚③互补；真实关闭两事件同源**必须去重**）；open 后不变量自愈（shouldConnect===true 时重放归零+遥测——hook 单点自证）；楔死检测所有权注释（检测=库 checkConnection strike1 close→真实 close→supervisor；重连=supervisor）', ...);
```

- [ ] **Step 2: 跑红** → FAIL。
- [ ] **Step 3: 绿实现**

```ts
// connection-supervisor.ts 骨架：
// ★所有权边界（裁定 23⑴ 收归唯一——Architecture 段措辞以此为准）：supervisor 独占【全部】connect/disconnect——
//   瞬态退避/终态/1012/普通掉线全归 supervisor；库定时器被"open 归零 shouldConnect"结构性禁用（setConfiguration
//   公开 setter）；watchdog 降级纯观测（零 kick 路径）。conn.spec 既有断言中与"库自动重连"相关的锚随本任务改写，
//   首连/快线行为锚零回归。
// state: {phase:'idle'|'waiting'|'connected'|'terminal', attempt, reason, code, timer, authTimer, epoch}
// 构造期：provider.on('open', () => ws.setConfiguration({ autoConnect: false }))   // ★归零锚——库重连结构性失效
// connectOnce()——全仓唯一 connect 调用封装：
//   const ws = provider?.configuration?.websocketProvider; if (!ws) return;
//   if (readyState(ws) ∈ {CONNECTING, OPEN}) return;                      // 槽位守卫（锚⑤⑥——非空即退会死锁）
//   void ws.connect()?.catch?.(() => {});                                 // maxAttempts:1 下 reject 必吞（锚④）
//   connectOnce 失败/被关后复置 shouldConnect=false（失败窗内一致性）
// scheduleReconnect(plan)——统一排程入口（瞬态/普通掉线/1012/AUTH_WAIT 全走此函数）：
//   timer=setTimeout(→connectOnce(), resolveBackoffPlan(code,reason,attempt,jitter).ms)
//   // 普通掉线（1006/无 reason close）路由：resolveCloseAction→backoff 档→同表指数退避（首档 2s——远优于库 1s 热循环）
//   // 1012 路由：short 档+jitter=full 0-60s（裁定 23⑃）
//   // AUTH_WAIT 路由：resolveBackoffPlan('timeout',…)（裁定 23⑵+24 杂项 route 参数——哨兵方言已弃）
// beginTransientBackoff({reason, code})——瞬态入口（runtime authFailed 瞬态档+close backoff 档同调）：
//   ①ws.disconnect()（shouldConnect=false——归零锚外又一道保险）
//   ②scheduleReconnect(resolveBackoffPlan(...))
//   ③connect 后 authTimer=setTimeout(→attempt++/scheduleReconnect, AUTH_WAIT_TIMEOUT_MS=10_000)
//   ④on('authenticated')→{clearTimeout(authTimer); attempt=0}
//   ⑤terminal（isTerminalReason〔code===undefined〕/resolveCloseAction terminal〔code!==undefined〕）→disconnect 终局，phase='terminal'
// close/disconnect 事件路由（★裁定 24⑴ 五档穷尽——none="永久断线"仅 terminal+应用销毁）：
//   resolveBackoffPlan('close',code,reason,attempt,jitter) 统一分派（T0 单源）：
//   terminal→disconnect 终局 phase='terminal'｜silent-renew→立即一次+silentRenewUsed 闩锁（第二次同因回落 terminal）
//   ｜planned-restart→short 档｜backoff→exponential（普通掉线归此）｜normal→exponential 带退避一次重连
//   同时订阅 'disconnect'（库合成 4408 不 emit close、onClose 恒 emit disconnect——去重：两事件同一 close 只处理一次）
// kickNow()：公开入口（bindReevaluateOnce 的 online/visibilitychange 接入——0-1s jitter，已排程则忽略）
// assertHealthy()：watchdog 3s tick 单向边调用的公开入口（无 timer 无 attempt 且 offline→立即 scheduleReconnect+遥测 stalled）
// 模块导出唯一 provider 句柄注入+teardown；runtime 各散点（:1018/:1036/:1041/:1058/:219 connect/disconnect 调用）全部改道 supervisor。
```

- [ ] **Step 4: 跑绿**：runtime 全量既有用例零回归+新增用例绿（`pnpm --filter web test -- --run canvasCollabRuntime connection-supervisor`）。
- [ ] **Step 5: Commit**：`feat(y0b-5): T3 CollabConnectionSupervisor 收归唯一所有权——库 pin+open 归零 shouldConnect（库重连结构性失效）+6 行为锚+五档穷尽排程（含 silent-renew/normal）+api 侧锚文件重录+watchdog assertHealthy 单向边`

---

## Task 4：hydration 死线 reason 分型+failed→ready 自愈+localCacheReady 三分支

**Files:**
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（:1224-1241 死线段+:1009-1022 authFailed 联动）+ canvasStore（`localCacheReady: boolean` 正交字段——**不新增 hydration 第五态**）
- Modify: `apps/web/src/pages/canvas/page.tsx`（:373-413 蒙层分型）

- [ ] **Step 1: 红测**

```ts
it('瞬态 authFailed 且 hydration pending→死线延长：10s 不死、25s（BASE 10_000+GRACE 15_000）才 failed；★总封顶=25s（多次瞬态不无限重排——到点 failed→localCacheReady 分支渲染本地副本/failed 蒙层，后台 supervisor 续试——"禁死 spinner"由封顶保证）；期间蒙层文案=「服务繁忙，正在自动重试…」', ...);
it('终态档不延长（终态 UX 即出口）；无瞬态信号基线 10s 零回归', ...);
it('★failed→ready 自愈（completeHydration——offline.test.ts:78-90 用例名预留接口的本批落位）：failed 后迟到 synced→applyDocToStore+setHydration("ready")+canEdit 恢复（现状=永久只读死局：无守卫单写点 canvasStore:1879+ready 唯一写点 :1254 不可再达+failed 后 watchdog 反而更快 eligible）', () => {
  initCollab(...); vi.advanceTimersByTime(10_000);   // →failed
  emitSynced();                                       // 迟到 synced（supervisor 恢复路径自然到达）
  expect(hydration()).toBe('ready');
  expect(canEdit(useCanvasStore.getState())).toBe(true);
});
it('★自愈会话非"ready 但冻结"（裁定 23⑺ armSession）：自愈后远端编辑→onRemote 投影仍生效（observeDeep 已注册）+awarenessBridge 非空（成员/光标可见）+viewport 恢复——v2.2 只 applyDocToStore+ready 的形态=首帧后彻底无响应比现状更难诊断；幂等：completeHydration 在成功路径后再触发不重复注册 observeDeep（一次性 latch——投影工作量翻倍防线）', ...);
it('自愈后 undoManager 不含缓存/装载操作（本地 update 起点语义——非用户编辑不入 undo 栈）', ...);
it('localCacheReady 分支（T8 联动预埋）：failed 且 localCacheReady∧有缓存内容→applyDocToStore 渲染本地副本+只读横幅「本地副本（只读）· 正在重连」+导出可用；canEdit 因 hydration!=="ready" 恒 false（谓词零改动）', ...);
it('删 ready 周期轮询：无任何 interval GET /api/ready（spec §5.4 明令删——第二真源+惊群+限流桶三害）；边角兜底=重连成功但状态异常时单次事件驱动探测（节流 60s+抖动——★独立函数 probeReadyReason()：只取 /api/ready 的 reason 写横幅 hint，禁复用 handleVersionTerminal（:232-244 语义=取 csv 作版本 reload 键，与连通性探测正交——未来改版本逻辑不得误伤连通性探测）', ...);
it('五瞬态误入终态反向断言（SERVER_OVERLOADED/db-unavailable/draining/lease-not-ready/rate-limited/server-outdated——isTerminalReason 全 false+SyncBanner 落自动重试档）', ...);
```

- [ ] **Step 2: 跑红** → FAIL（offline.test.ts:78-90 既有钉死用例随实现同步改写——"属后续批次"注释落地）。
- [ ] **Step 3: 绿实现**：死线改可延长 deadline（`HYDRATION_DEADLINE_BASE_MS=10_000`/`HYDRATION_DEADLINE_TRANSIENT_GRACE_MS=15_000` 两常量=runtime 常量段，纯客户端量纲不进 shared）；supervisor authFailed 瞬态档联动重排；**★armSession 抽取（裁定 23⑺）**：initCollab 超时 return 后被跳过的 :1245-1283 整段（viewport 恢复/recomputeConnStatus/applyDocToStore+setHydration('ready')/onRemote observeDeep(nodes/edges)/projectExecToStore+exec observer/awarenessBridge）抽成 `armSession(doc, provider, epoch)`——水合成功路径与 completeHydration 自愈路径**共用同一函数**+一次性 latch（防重复注册 observeDeep 投影翻倍）；completeHydration()（迟到 synced→armSession()+undoManager.clear()——**v2.2 只做"applyDocToStore+ready"会得到"ready 但冻结"会话**：首帧后远端编辑零投影+零成员光标+视图位置丢）；蒙层三分支（terminal 指引/瞬态自动重载/localCacheReady 只读副本）。
- [ ] **Step 4: 跑绿**；Commit：`feat(y0b-5): T4 hydration 死线分型+failed→ready 自愈（completeHydration）+localCacheReady 三分支+删 ready 轮询`

---

## Task 5：世代可见通道+四维缓存键（T8 硬前置——不做则本地缓存=F1 无限刷新循环/F2 静默投毒）

**Files:**
- Modify: `apps/api/src/modules/projects/`（projects 服务/controller——/projects/:id 响应追加两字段）
- Modify: `apps/web/src/pages/canvas/page.tsx`（fetchProjectMeta 传递两值）+ `canvasCollabRuntime.ts`（session 结构扩展+purge 挂点）
- Create: `apps/web/src/collab/local-cache-key.ts`（缓存键合成+purgeForeignCaches）+测试

- [ ] **Step 1: 红测**

```ts
// api 侧：
it('GET /projects/:id 响应含 collabGeneration（CanvasDoc.generation ?? 0——schema:819）+collabSchemaVersion（CANVAS_DOC_SCHEMA_VERSION=2 docShape:41）——E3「鉴权握手返回」通道（fetchProjectMeta 先于 initCollab 已有：page.tsx:132-133 promise 链——零新往返零新端点）', ...);
// web 侧：
it('缓存键=flowweb:collab:${uid}:${pid}:g${generation}:s${schemaVersion} 四维合成（uid 隔离 origin 级越权——换账号不读他人库；generation 隔离 F1/F2；schemaVersion 隔离旧 schema 内容）', ...);
it('purgeForeignCaches：indexedDB.databases() 枚举同前缀（uid+pid）异代库→deleteDatabase；能力不可用→跳过（降级不阻断）', ...);
it('purge 触发点【v2.2 四→五——裁定 22⑶ TD-19 补落】：登出（G27 :1315-1319 清理点扩）/切用户/项目删除/世代变化（consumeGenerationJump :251-255 与 4410 close :1053 两路均走 safeReload("generation")——固定次序=导出（.yjs 双产物，标注旧代——世代被超的编辑本就无法合并，给用户留一份而非尝试合并/静默销毁）→await purge()→reload()；purge 在 reload 前的顺序锚维持：反了=重载读脏库 F1 复发）/**★terminal 族**（forbidden/not-found/session-expired/版本族/quota 终态——禁本地 hydrate+purge：权限撤销后本地副本仍在=看得见已无权画布，与 uid 隔离同类泄漏）', ...);
it('★读权分型（裁定 22⑶）：quota/writeFrozen/draining（仍有读权）→保留+只读+引导导出；forbidden/not-found/team-disbanded（已无读权）→purge 且**不提供导出**（帮用户外带已无权内容禁发生）——T6 单链 persist 档加"是否仍具读权"分型输入', ...);
it('世代跳变检测：装载后首快照 generation>本地记录→safeReload("generation")（现有 consumeGenerationJump 扩——Y0b-4 T5 doc-status generation 维度已下行）', ...);
it('★generation 未知（fetchProjectMeta 失败/超时/字段缺失）⇒fail-closed 不启用本地缓存（走服务端水合——E3「建 provider 前丢弃」推论；undefined 键=F2 原样复发）+ws_status detail.reason="local-cache-degraded" 遥测（"缓存从不生效"可观测非静默）', ...);
```

- [ ] **Step 2: 跑红** → FAIL。
- [ ] **Step 3: 绿实现**：api projects 响应两字段（CollabDocumentService 读 generation——已有 vacuum 代际域）；web local-cache-key.ts（纯函数+幂等 purge）；session 携带 {collabGeneration, collabSchemaVersion}；两路 reload 前置 purge。**本任务不接 IDB 适配器**（purge 幂等空转）；T8 才绑定持久化实例。
- [ ] **Step 4: 跑绿**；Commit：`feat(y0b-5): T5 世代可见通道（/projects/:id 两字段）+四维缓存键+purge 四触发点（4410 两路先 purge 后 reload 顺序锚）`

---

## Task 6：unsyncedDirty 单源+横幅单链仲裁+safeReload 收敛 9 处+导出双产物+导入器

**Files:**
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（unsyncedDirty+safeReload+escape 重写）+ canvasStore（syncLag/persistUnhealthy 字段）
- Create: `apps/web/src/utils/unloadGuard.ts`（reason 集合谓词）+ `apps/web/src/collab/canvas-local-backup.ts`（双产物导出+导入）+测试
- Modify: `apps/web/src/pages/canvas/components/SyncBanner.tsx`（单链扩档）+ page.tsx（:217-224/:396-413）+ QuotaBanner.tsx:96 + ShrinkDialog.tsx:90 + SaveStatusIndicator.tsx:14 + runtime :254/:1053（safeReload 改道）
- Modify: `scripts/check-collab-census.mjs`（新增两锚：裸 location.reload() 白名单+encodeStateAsUpdate 白名单计数更新）

- [ ] **Step 1: 红测**

```ts
// unsyncedDirty 单源（spec §5.7 v2.3 裁定）：
it('唯一置位=本地 origin update（doc.on("update",_,origin)=>origin==="local"）；唯一清零=3s tick 判 provider.hasUnsyncedChanges===false&&isSynced——删 p.on("sync")（事件不存在）与 on("synced") 直清。★论据修正（v2.1）：synced 是幂等边沿事件（setter 同值不 emit esm:832-839）故"提前清零"非其害；真风险=unsyncedChanges 的减量只发生在服务端 SyncStatus 确认帧（applySyncStatusMessage :474-476）——断连期确认帧永不到达且 startSync 曾置计数 1（:726-727），故 tick 判据必须合取 isSynced（理由写进注释——防将来被"简化"掉合取项）', ...);
it('自持标记绑定 doc 实例（supervisor terminal 重建换 provider 不失效）', ...);
it('★T3/T6 接缝用例：断连期连续编辑→unsyncedChanges 单调递增且零确认帧→重连后必须经 forceSync() 归零（自持标记清零依赖 supervisor 主动 forceSync 的隐性契约显式化——两 Task 接缝锁死）', ...);
it('hasUnsyncedCanvasChanges() 改读单源（:115-117 双源 rebuildPending∨库计数退役——rebuildPending 并入单源置位）', ...);
// 横幅单链（spec §5.7 v2.2 互斥裁定）：
it('resolveCanvasBanner 单链：terminal 鉴权>配额终态>**diverged（裁定 24⑬ 最优先——服务端已明确拒收，"自动合并"承诺为假）**>oversized>degraded>persist 未保存（最高运营优先）>write-frozen>syncLag>connUi——persistUnhealthy∧syncLagOver60s 同真时只渲 persist 档且 syncLag 文案降级为「请导出本地副本」（禁「可尝试刷新」与「请勿刷新」同屏）；★破坏性次序锚："放弃本地副本"排在"导出 .yjs"**之后**+二次确认（不可逆动作禁先于保全动作出现）；diverged 三出边完备性：导出/放弃/**服务端最终接受**——放弃必须同时清 diverged+unsyncedDirty 解除闩锁（否则 beforeunload 永久确认框）', ...);
it('能力位【T6 只落字段不落承诺——裁定 21】：localCacheReady 字段（初值 false）+单链 persist 档分支结构就位——T6 阶段文案**恒维持「未保存」档永不谎报**（文案翻转归 T8 whenSynced 真值驱动；靠字段默认值兜住用户可见承诺=脆弱排列禁采纳——反例用例：手动 setState({localCacheReady:true}) 而缓存未建成属 T8 禁用路径）', ...);
it('文案 denylist 面=单链全分支（非三处字符串）——跨刷新承诺词扫描', ...);
// safeReload：
it('safeReload(reason)：unsyncedDirty 真→导出对话框+return（禁直接 reload）；假→location.reload()——9 处全部改道（page.tsx:219/:406、QuotaBanner:96、ShrinkDialog:90、SaveStatusIndicator:14、runtime:254/:1053、版本自愈:239、逃生:271）', ...);
it('census 静态锚：生产代码裸 location.reload() 仅 safeReload 内部+白名单（:239 版本自愈已带守卫/:271 逃生设计如此）——新增第 9 处即红', ...);
// 导出双产物+导入器：
it('escapeWithLocalExport 重写：Y.encodeStateAsUpdate(doc)→.yjs 二进制（可回灌——hydration failed 时 store 为空=现导出空画布的根修）+doc 反投影 JSON（禁 store 投影）；导出后不自动 reload（reload=用户显式第二次动作——现 :271 无条件=唯一持有者销毁）', ...);
it('importLocalBackup(bin)：★裁定 25⑷ 导入路径修正——`Y.applyUpdate(doc,bin,provider)`（**origin===provider 抑制 Update 帧回发**〔documentUpdateHandler esm:762 `if(origin===this) return` 实证——默认形态整个 bin 一条 Update 帧上送 ⇒512KB 闸 ⇒3MB 备份被拒=导出 8MB/导入 512KB 不对称的逃生断点〕）+`forceSync()` ⇒上行改走 **SS2 差分**（maxDocBytes+ALLOWANCE 闸）——上限判据=LOCAL_CACHE_MAX_DOC_BYTES（=maxDocBytes 同源，非 2×maxTxBytes）；**导入后显式置 unsyncedDirty**（suppress-origin 同时抑制 unsyncedChanges 计数——禁"已缓存"文案对导入内容撒谎）；≤2 次尝试收敛断言（8MB SS2 抽干 bytes 桶 refill≈4s——单发可能 1008 退避后第二次成功）；超上限明示"该备份会使画布超过单文档上限"+引导（merge 端点=Y5 **必做**——>8MB 恢复唯一通道；其评估输入：`Y.encodeStateAsUpdate(doc,sv)` SV 分区是公开 API〔裁定 25⑨——"无字节切分 API"非"无切分 API"〕）', ...);
it('★close 分型双 reason（裁定 25⑸——报告3 P0-1/P0-2）：①`SS2_OVER_LIMIT_TERMINAL_REASON='ss2-over-limit'` 新 reason+resolveCloseAction(4404,reason) 按 reason 分型——客户端该档文案=「导出 .yjs→丢弃本地副本」（diverged 放弃出边）**非瘦身**（超额在客户端本地、服务端 doc 往往小——QuotaBanner 瘦身指引治不了此病）；②`'team disbanded'`〔gateway:3009 裸字面量〕升 shared 常量 TEAM_DISBANDED_TERMINAL_REASON+resolveCloseAction NORMAL 分支按 reason 分型落 terminal（团队解散**禁先重连一次**——24⑴ normal→exponential 的已知终局例外；与 :68-72 doc-over-quota 特例同款形态，一个函数两处特例）', ...);
it('★diverged 标记（裁定 23⑨——T6+T7+T8 组合发散闩锁防御）：服务端 readOnly（collabReadOnly/writeFrozen/quotaOver 任一）期间产生本地 update→缓存条目标记 diverged→下次会话**不自动 hydrate**（横幅「有本地未上行副本」：导出 .yjs / 放弃本地 二选一→清标记恢复自动缓存）；判据=客户端已知 readOnly 状态∧本地新 update（不引 wire 层 SyncStatus(false) 解析——报告2 sync-ack 方案登记升级路径）', ...);
it('census encodeStateAsUpdate 白名单 6 文件 13 点计数→加入本文件后 7 文件（同批更新计数——禁先加调用后补锚）', ...);
// beforeunload 谓词（reason 集合）：
it('shouldWarnUnload():Set<"unsynced"|"editor-dirty"|"export-inflight">——三挂载点各注册 reason 取并集（ExportModal=export-inflight 语义独立禁破坏 :25-37 模块级 arm/disarm；ImageGenNode=transformMode 旋转翻转；VideoEditorShell=editorDirty∨unsynced）', ...);
it('pagehide 挂 unsynced_close 计数+flush（beforeunload 只负责确认框——移动端 Safari 对无交互 preventDefault 静默忽略）', ...);
// persist-status 消费：
it('persist-status {healthy:false}→persistUnhealthy=true→单链 persist 档；healthy:true→自动消；doc-status 快照与 persist-status 两通道独立字段互不覆盖（runtime:971-973 静默透传终结）', ...);
```

- [ ] **Step 2: 跑红** → FAIL。
- [ ] **Step 3: 绿实现**：按用例清单逐项（safeReload 进 runtime 导出；三组件 reload 改道；SyncBanner resolveContent 扩三档+能力位参数）；unsynced_close 遥测 `recordCollabDiag('unsynced_close',{n:1})` once per page-life。
- [ ] **Step 4: 跑绿**+手验：编辑画布→各 reload 点点击=导出确认非直接刷新；pg 停 5s→persist 横幅→恢复自动消；.yjs 导出→清 store→导入回灌一致。
- [ ] **Step 5: Commit**：`feat(y0b-5): T6 unsyncedDirty 单源+横幅单链（互斥+能力位）+safeReload 九处收敛+导出双产物+importLocalBackup+beforeunload reason 集合`

---

## Task 7：E40 分叉自检+C6 收口（updateText VIEWER 门）

**Files:**
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（60s 计时）+ canvasStore（syncLagOver60s）+ SyncBanner（syncLag 档——T6 单链内）
- Modify: `apps/web/src/stores/nodeStore.ts:606-632`（updateText 首段三行——T18 补正：T17 812909bb 上移 +10 行锚漂移未同步；Y1c T12 期间再漂 +10（599）重定位；Y1c T15 收口 A applyNodeDataPatch outcome 剥除 +4 再漂（606）重定位）

- [ ] **Step 1: 红测**

```ts
it('unsyncedDirty>60s 且 connStatus==="connected" 且 !writeFrozen 且 !quotaOver 且 ★!collabReadOnly（裁定 23⑩——viewer/spool 连接级 readOnly 不在 writeFrozen/quotaOver 两字段，缺此判据=把"服务端拒绝"误诊为"同步慢"〔服务端对拒帧回 SyncStatus(false) 被 client esm:474-476 `if(applied)` 静默丢弃——unsyncedDirty 永不归零〕）→syncLag 档横幅+ws_status 事件 detail.reason="unsynced-lag"（遥测经 T1 ws_reason_total{reason} 可见）', ...);
it('瞬态冻结/quota readOnly 期间抑制（N3 粘滞反向——spec §5.7 v2.2「以 §5.3 为准」）', ...);
it('连接不健康不计窗；条件失效横幅自动消', ...);
it('updateText VIEWER 门：canEdit false→零写入+toast 节流（先例 applyNodeDataPatch :562-577 三行早退同款）；EDITOR 零回归', ...);
```

- [ ] **Step 2: 跑红** → FAIL。Step 3: 绿实现（5s interval 检查消费 T6 单源——禁新建第二判据）。
- [ ] **Step 4: 跑绿**；Commit：`feat(y0b-5): T7 E40 60s 横幅（瞬态抑制+unsynced-lag 遥测）+updateText VIEWER 门`

---

## Task 8：本地持久化最小内核——自研 IDB 适配器（依赖 T5 通道+T4 localCacheReady+T6 单源；★v2.3 裁定 23⑷ 载体改自研）

**Files:**
- Create: `apps/web/src/collab/local-collab-cache.ts`（★裁定 24⑦ **单快照覆盖形态 ~40-60 行**，零新依赖——native IndexedDB：`put{key:四维键, snapshot: Y.encodeStateAsUpdate(doc), unsyncedDirty: boolean, at: number}` 单键 put **原子无撕裂**+无压缩（每次写即压缩）+跨页 last-writer-wins 且两侧皆收敛中 CRDT 态任一份可用〔**无需协调**——encodeStateAsUpdate 同步重活+日志异步读取塞同一 IDB 事务不可行=事件循环让出自动提交的经典坑〕；触发=trailing ≥1s 去抖+pagehide 强制一次+结构性变更（增删节点）立即；删 v2.3 日志形态三件〔updates 追加/快照压缩/lastAckedSv——unsyncedDirty 布尔随快照存，T6 单源已有判据〕；★失败面清单：固定 DB version+onupgradeneeded/onblocked/versionchange 处理/**deleteDatabase 前先 close**（多标签 purge 阻塞——await close）/适配器自身布局版本〔区别 docShape schemaVersion〕/QuotaExceededError 之外 InvalidStateError/UnknownError 同路径降级/persist() Safari 可用性判据；★裁定 25⑹：**dirty 不可被 clean 覆盖**——put 前同事务读旧记录 `existing.unsyncedDirty && !mine.unsyncedDirty → skip+遥测 local-cache-preserved-foreign-dirty`（3 行——clean 覆盖 dirty=标签 A diverged 唯一副本被标签 B pagehide 覆盖→A 崩溃真丢；两 dirty LWW 罕见边角可接受，按 clientID 分行方案登记升级路径）；**主 flush 挂 visibilitychange→hidden**（pagehide 里的 IDB 写是 best-effort 浏览器不保证完成——T2 遥测 flush 同款结构）+pagehide 最后一道；结构性变更**限定增删节点**（低频）+改"置脏+提前到期"（encode 落宏任务/idle——8MB 全量编码禁占交互帧））+测试；Modify runtime（initCollab 绑定）+ SyncBanner（能力位翻转）
- Modify: `apps/api/src/modules/collab/store.metrics.ts`（collab_telemetry_client_doc_bytes Histogram——★裁定 22⑾：服务端遥测族单文件落点，禁 service 内联定义掉出 *.metrics.ts glob 门禁）+spec §10 canonical 同步进本任务 Commit
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（★裁定 24⑧ SS2 落 4404+⑵ 桶耦合：①帧闸 SS2 分支改 `>maxDocBytes+FRAME_ALLOWANCE_BYTES(64KB)` 且超限**落 4404 doc-over-quota**〔复用 :1697-1699 两行 sendStateless(docStatus)+hardClose——修正 v2.3 驳回：4404 同为 terminal 档无重连循环+带 QuotaBanner/shrink/export 自救+"本地≥8MB 内容合并后必然超配额"语义准确；Update 帧 1009 维持——DoS/意外帧；既有"SS2>闸→1009"用例同批改写〕；②**bytesBuckets 容量同步 `maxDocBytes+FRAME_ALLOWANCE_BYTES`**〔token-bucket `cost>capacity 结构性恒 false`:22-23——v2.3 只抬闸不同步桶=(maxDocBytes,+64KB] 帧→⓪′ 结构性拒→1008→重连重发无限循环；头注释"桶容量≥最大合法帧"不变量断言同步〕；③成对用例：maxDocBytes+30B SS2 帧**同时过 ⓪ 与 ⓪′**+`2×maxDocBytes+allowance` Update 帧仍 1009〔放宽未顺带放宽 Update 闸〕+既有 8MB 两次通过零回归；④★裁定 25⑹ **collab-rate-gate.spec.ts:70-75 两条断言点名改写**（capacity===maxDocBytes 等式与 consume(maxDocBytes+1) 探针——改容量后必红且 :75 探针须改 `capacity+1` 否则恒真假断言；标题"=Step2 帧闸上界"→"=SS2 闸上界〔maxDocBytes+ALLOWANCE〕"））+collab-rate-gate.spec 增上述用例

- [ ] **Step 1: 红测**

```ts
it('initCollab：doc=new Y.Doc() 后 new LocalCollabCache(cacheKey,doc)（T5 四维键；★单快照形态裁定 24⑦：启动=get→Y.applyUpdate(doc,snapshot)——whenSynced〔本地库加载〕不抬 hydration 门〔渲染门仍=服务端 synced〕；unsyncedDirty 布尔随快照存=EVICT/PURGE"只删已确认库"判据〔T6 单源同值——禁第二判据〕）', ...);
it('装载后 undoManager.clear()（缓存装载非用户编辑——consumeGenerationJump :252 同款先例）', ...);
it('离线冷启动恒只读：hydration failed ∧ localCacheReady ∧有缓存→applyDocToStore 渲染本地副本+canEdit=false（谓词零改动——hydration!=="ready" 天然拦；E5 授权语义）', ...);
it('编辑→硬刷新→本地缓存回放→服务端 synced 后内容复合（Yjs SV 差分上行——未确认从根消除）【出口判据⑫a】', ...);
it('★E36 不可达性断言【出口判据⑫b——v2.4 裁定 24⑧ 形态】：本地缓存回放的上行=单 SyncStep2 帧=整个未同步量——断言**量 encodeSyncStep2 产物真实 byteLength**<服务端闸（SS2 闸=maxDocBytes+64KB **落 4404**〔terminal 带 shrink/export 自救——非 1009 裸逃生〕；结构性保证=②同源闸（快照编码 ≤maxDocBytes⇒帧=编码+包装 ≤闸+ALLOWANCE 恒过）', ...);
it('★单 doc 尺寸闸【v2.4 裁定 24⑧ 同源化——删 0.75 系数（立论被同批 ALLOWANCE 证伪+softEnter 类比不成立）】：LOCAL_CACHE_MAX_DOC_BYTES=QUOTA_DEFAULTS.maxDocBytes **同源无第二系数**——编码>闸→不缓存该 doc+persist 档文案维持"未保存"档（「本地已缓存」是能力承诺必须有"太大没缓存"诚实分支）；★周期复检（复用 T7 5s interval 零新定时器——装载时小/编辑后大的增长路径；**复用既有 localDelta 测量点零新增 encode**）：超闸→**停止缓存更新**（保留已有内容）+local-cache-degraded 遥测——非写至 QuotaExceeded', ...);
it('★写入预算（v2.4 裁定 24⑦ 快照形态）：快照写=trailing ≥1s 去抖+pagehide 强制一次+结构性变更（增删节点）立即；单键 put 原子——大 doc 快照 encode 成本受尺寸闸上界约束（E33 实测装载即回收口径）；IDB 全交互 try/catch 降级面见 Files 失败面清单', ...);
it('★未上行增量流控（裁定 23⑷ 吸收报告2 思想）：Σpending（未确认 update 字节）>UNSYNCED_MAX_BYTES(1MB)→forceSync() 并置"同步积压"态+横幅（**永不阻塞用户输入**——日志已保全最坏=等待/刷新；同时使本地回放帧结构性远离 8MB 闸=E36 又一道保险）', ...);
it('★terminal 族清副本用例（裁定 22⑶——TD-19 立项要件"终态禁本地 hydrate+清副本"）：terminal forbidden → 缓存被清+后续刷新不再出现内容（权限撤销后看得见已无权画布=泄漏）', ...);
it('★IDB 全交互 try/catch 降级：QuotaExceededError/任何 IDB 异常（在 initCollab 调用栈上）→禁用本会话缓存+ws_status detail.reason="local-cache-degraded" 遥测（协作主链不受影响——异常冒泡=协作初始化失败禁发生）', ...);
it('★dirty 守卫多标签用例【出口判据㉖——裁定 25⑹】：标签 A diverged（unsyncedDirty=true 快照已落盘）→标签 B 干净态 pagehide 写快照→**skip 不覆盖**（遥测 local-cache-preserved-foreign-dirty）→刷新后 A 的未上行编辑仍在（clean 覆盖 dirty=单快照形态新增丢失窗——击中 T8 存在理由本身）', ...);
it('★总量闸：estimate() 超限→按最后修改时间删最旧库（只删已被服务端确认的——与驱逐白名单同纪律）', ...);
it('★readOnly 期间本地写语义：服务端拒写（quota/viewer/draining/spool readOnly）期间的本地编辑→缓存保留标注未上行+**diverged 标记（T6）置位**；重连后被拒→维持只读+横幅引导导出（复用 collab_quota_writes_dropped_total{reason} 做服务端证据——禁第二词表）；"已拒内容复活"语义用例钉死——**发散闩锁回归用例（裁定 23⑼）**：readOnly 编辑→硬刷新→不自动 hydrate（diverged）→横幅二选一→放弃后清标记恢复自动缓存（v2.2 形态=永久横幅+每次刷新重发散不可退出）', ...);
it('navigator.storage.persist() 申请+estimate() 监控→容量 gauge 上报（ws_status 事件 detail 进本地 ring；Safari ITP 7 天清理=能力缺口进文案契约——「已本地缓存」不承诺永久）', ...);
it('yjs_client_doc_bytes：doc 字节数 gauge 随 ws_status 批量上送（E33 指定的 E26 重建触发源——spec:88；服务端 Histogram collab_telemetry_client_doc_bytes）', ...);
it('T5 purge 四触发点生效（世代变化→safeReload("generation") 导出→purge→reload 后无旧代内容且不循环【出口判据⑬】；切 uid→不读前 uid 库【出口判据⑭】）', ...);
it('★能力位翻转【T8 才落——裁定 21】：whenSynced 真值→setState({localCacheReady:true})+尺寸闸通过→persist 档文案切「本地已缓存，恢复后自动合并」（文案真值只由"缓存真的建成"驱动；横幅族从数据保全承诺降级为状态显示）；尺寸闸不过/IDB 降级→字段保持 false 维持"未保存"档', ...);
```

- [ ] **Step 2: 跑红** → FAIL。Step 3: 绿实现（local-collab-cache.ts 零业务逻辑：绑库/清库/容量上报，**不自建 provider、不越 setHydration 单写者、无 Leader/锁/通道**——E5 直写裁定）。
- [ ] **Step 4: 跑绿**+手验：断网编辑→刷新→本地副本可见只读→恢复网络→自动同步复合。
- [ ] **Step 5: Commit**：`feat(y0b-5): T8 自研 IDB 适配器最小内核——四维键绑定+离线只读+容量监控+diverged 标记+SS2 闸 ALLOWANCE（Y5 边界外：Leader/离线上行不做）`

---

## Task 9：write-frozen 全链演练（collab-core 载体）+503/422 语义化收口

**Files:**
- Create: `apps/api/scripts/write-frozen-drill.mjs`（双 ws client 装置——collab-smoke 同族）+ collab-core int 套件内等价用例
- Modify: `.github/workflows/ci.yml`（collab-core job :190-198 kill9 族旁追加 drill 步骤）
- Modify: 保存/上传路径 503 消费（**withSyncRetry 已存在 executionApi.ts:26 禁新建**——扩消费）

- [ ] **Step 1: 演练断言链（spec §5.3 验收）**

```ts
// ①双 EDITOR client 连接→②POST /api/drain→两 client 收 doc-status writeFrozen=true→断言A：drain 后新编辑帧 readOnly 拒不物化
// ③pending 排空→closeAll1012→④断线期间服务端状态翻转（quota bytes 维度直改）→client 不知情
// ⑤重连→断言B：authenticated 后首 doc-status 快照=服务端权威值（幂等快照重放——Y0b-4 T5 rev 机制验证）
// ⑥恢复→断言C：编辑放行物化对端可见+shrink 成功后 <N 秒客户端本地只读态解除（spec:594 出口锚——v1 全无 shrink 用例）
// ★⑦编辑中 kill -9 档（裁定 23⑮——spec:700 要求未满足）：现 kill9 drill 只在 quiescence barrier（inFlight===0）后断言
//   （collab-kill9-drill.ts:179-208）——本档**不等待静默**直接 SIGKILL，**双断言（裁定 24）**：
//   (a) 服务端独存：编辑流持续中杀进程→重启→断言"≤debounce(2s)+maxDebounce(3s)+append 在飞窗(5s)≈8s 的编辑可恢复"
//       （RPO 契约上界——spec:700 明令"编辑中"演练）
//   (b) ★客户端存活：同场景保留浏览器页→重连握手 SS2 差分补回→**零丢失断言**（T8 落地后用户可见 RPO≈0——
//       本批最强产品论据：服务端丢的 ≤3s 编辑仍留客户端内存+本地快照）
// ⚠️ census ⑧ 组坑（裁定 23⑮）：apps/api **src** 生产代码禁出现 'write-frozen' 字面量（已被 doc-status.writeFrozen
//   取代）——演练装置/断言全放 apps/api/scripts/*.mjs（census 只扫 src 面）
// CI 载体=collab-core（push/PR 必跑+PG/Redis+kill9 七模式同族）；gate-collab 的 e2e-collab=dispatch-only 已知红=纸门禁禁依赖
```

- [ ] **Step 2: 503/422 用例**

```ts
it('执行路径 503+Retry-After→withSyncRetry toast+Retry-After 后恰重试一次（executionApi.test.ts:94 既有形态——扩消费到保存/上传两路径，禁三处复制）', ...);
it('422 shrink 语义化：预演超限 422 {code,bytes,limit}→ShrinkDialog 引导（spec:642 出口「503/422 语义化」半边）', ...);
it('SERVER_OVERLOADED errorCode 同族', ...);
```

- [ ] **Step 3: 跑红→绿**（本地 dev api 跑 drill 全断言 PASS 留档+CI 绿）。
- [ ] **Step 4: Commit**：`test(y0b-5): T9 write-frozen 演练进 collab-core（权威快照重放+shrink 解除锚+编辑中 kill9 RPO 档）+503/422 三路径 withSyncRetry 扩消费`

---

## Task 10：服务端指标面——E19 直方图+awareness collect+heap 倍率+耗时直方图+删 yjs_canvas_doc_bytes

**Files:**
- Modify: `apps/api/src/modules/collab/store.metrics.ts` + gateway 装配点 + **spec §10 canonical 块同步**（指标门禁=check-spec-consistency.mjs glob *.metrics.ts 双向比对——census 无指标名）
- Modify: 读者 4 处：store.metrics:33+gateway:928/:1134+persist-status.spec:371
- Modify: `scripts/check-int-coverage.mjs`（MIN_TOTAL/FILES_MIN 上调）

- [ ] **Step 1: 红测**

```ts
it('yjs_doc_bytes=Histogram（buckets 64KiB/256KiB/1MiB/4MiB/16MiB——E19「改尺寸直方图」原文回归）+无 projectId 标签断言；yjs_loaded_doc_bytes 维持唯一聚合 gauge，两者 help 互写分工（直方图=尺寸分布/gauge=驻留总量）', ...);
it('真值三锚 observe：装载播种/compact 全量编码/shrink 后活文档再编码（Y0b-4 T3 docTruth 既有事件挂 observe 零新增编码）+yjs_store_payload_bytes（append 增量）+yjs_doc_bytes_over_threshold_total', ...);
it('awareness_states/awareness_bytes=Gauge{collect(){reader()}}——reader 注册模式（yjs_loaded_doc_bytes :382-387 同族 8 处惯例；onAwarenessUpdate 未注册禁依赖——help 注明「不解码不取字段仅 Σ 编码字节」）', ...);
it('yjs_doc_heap_amplification gauge（装载/卸载前后 heapUsed 差÷编码字节——与 yjs_doc_bytes 采样点区分禁合并；help 注明合成值待标定）', ...);
it('耗时直方图四件 yjs_{store,compact,load,withdoc}_duration_seconds+yjs_compact_deleted_rows+yjs_compact_tombstone_bytes（tombstone 计数=histogram_count 口径 help 注明）', ...);
it('yjs_canvas_doc_bytes 删除后不再注册（重复注册抛错即红）+4 读者全改+spec §10 指标块同步（★check-spec-consistency --write-metric-names——裁定 24⑸ 指令修正）', ...);
it('collab_idle_timeout_total 决议：登记删除+spec §5.2 总表同步（P-T 证伪后无 idle 超时路径——禁 spec 与代码双源）', ...);
it('snapshot-doc-cache 容量上界：条目上限（如 32）+yjs_snapshot_cache_entries gauge（现 30s TTL 无容量上界=与 LRU 同源的第二条无界增长路径且零指标覆盖——报告2 §4.2）', ...);
it('top-N doc 结构日志：每 5min 输出 top10——★只读已 observe 的尺寸缓存（T10 直方图同一数据源，零新增 encode——病态 doc 编码≈75× 全量重编=风暴；"零新增 encode"断言：top-N 周期内 encodeStateAsUpdate 调用计数不变）', ...);
it('★指标登记纪律（裁定 23⑬+24⑸ 指令修正——check-spec-consistency :78-82 已做双向集合相等（87≡87），"扩域"不可能红=假门禁违纪律 5；**doc-gate --write-canonical 落盘 canonical.json 路径清单不写 metric-names 块——v2.3 该指令=no-op 无效命令**）：本用例改为执行期纪律断言——T8/T10/T13/T14/T16 凡新增/删除指标名，同 commit 跑 **check-spec-consistency.mjs --write-metric-names**（本任务给该脚本加落盘模式——已持有两侧集合，10 行）同步 spec §10 围栏块且复跑绿；指标定义必须落 *.metrics.ts 文件（middleware/service 内联定义=glob 外静默逃逸——T13 HTTP RED 落点红测）', ...);
it('spec §5.8③ 红线降告警行：yjs_loaded_doc_bytes 双条件 loadedDocs>40 维持——runbook 行（T15 落）', ...);
```

- [ ] **Step 2: 跑红** → FAIL。Step 3: 绿实现（全部 collect/事件挂点，零定时器——v1 的"1s 去抖"废弃）。
- [ ] **Step 4: 跑绿**：`pnpm verify`（含 check-spec-consistency+doc-gate）+`node scripts/check-collab-census.mjs`。
- [ ] **Step 5: Commit**：`feat(y0b-5): T10 E19 直方图回归+awareness collect reader+heap 倍率+耗时直方图+yjsCanvasDocBytes 删除（4 读者+spec §10 同步）`

---

## Task 11：Sentry 单版本收敛+collab 接线+scrub（白名单保留 csv/cb）+WS connectionId

**Files:**
- Modify: `apps/api/package.json`（删 `@sentry/node` 直接依赖）+ `apps/api/src/modules/execution/video-separate.service.ts:5`（唯一静态 import 改指 @sentry/nestjs）
- Create: `apps/api/src/utils/sentry-scrub.ts` +测试；Modify main.ts（beforeSend）+ collab 模块关键 catch

- [ ] **Step 1: 红测**

```ts
it('单版本收敛：@sentry/node 出依赖树；全仓 capture 路径唯一经 @sentry/nestjs（两路径均被 beforeSend 覆盖用例）', ...);
it('scrub=剥 query 中除 csv/cb 外全部（token/任意参数）；csv/cb 白名单保留——WS 无法设自定义头 URL query 是唯一通道+版本事故唯一线索+非机密（仓库已公有）', ...);
it('对象递归 scrub：键名含 query/url/token 的字符串值→[scrub]；docName=project:<id> 无 PII 断言', ...);
it('gateway/lease/spool/repo 关键 catch（store 失败/装载失败/compact 放弃三处样本）→captureException+scope{docName,reason,connectionId}', ...);
it('WS connectionId：onAuthenticate 生成（crypto.randomUUID）+进结构化日志三元组（traceId+connectionId+docName）+Sentry scope+回传客户端（doc-status 通道预留字段——供遥测 join）', ...);
it('SENTRY_DSN 未设→no-op（可选不阻塞维持）+scrub 只护 Sentry 事件面不护日志面（偏离表登记——project id 非机密裁定）', ...);
it('★release 修复（裁定 23⑰）：pm2 剥离 GIT_* ⇒ 现恒 release="unknown"（事故查不出对应提交）——改读 build-info.json（部署链既有产物）；★unhandledRejection 兜底安装提前到 NestFactory.create **之前**（guard.ts 现装在 main.ts:99 晚于 create :77=引导期窗口裸奔）+补 uncaughtException handler（现缺）+除计数外加 Sentry capture；collab 关键 catch 扩 lease/spool/repo 三处', ...);
```

- [ ] **Step 2: 跑红** → FAIL。Step 3: 绿实现（收敛为第一动作——OTel TracerProvider 唯一性前置）。
- [ ] **Step 4: 跑绿**；Commit：`chore(y0b-5): T11 Sentry 单版本收敛+collab 接线（docName/reason/connectionId scope）+scrub 白名单保留 csv/cb`

---

## Task 12：迁移链根修四件（先于 T13 的 traceId 列）

**Files:**
- Modify: `deploy.sh`（:214 先清后传）；`scripts/deploy-guard.mjs`（--post-restart 集合断言）
- Create: `scripts/check-migration-immutability.mjs`（迁移 sha256 棘轮）+基线文件 `scripts/migration-checksums.json` + 测试
- Modify: `scripts/check-migration-additive.mjs`（DROP INDEX 硬拦名单）；verify 链（fresh-replay 接线）

- [ ] **Step 1: 红测/断言**

```bash
# T12-0a tar 先清后传+集合等价：
# deploy.sh:214 改前=远端命令无 rm（只覆盖不删除——runbook:96 实录 44 目录残留）；改后=rm -rf migrations/* + 清后残留断言 + tar 传
# deploy-guard --post-restart 断言：远端 migrations 目录集合≡仓内 ∧ _prisma_migrations 无「库有仓无」applied 行
# 验收锚：故意远端留仓外目录→断言步红
# T12-0b ★迁移 sha256 棘轮（v2.1 替换 raw 拆分方案——裁定 16⑫）：
#   raw 段【留在 y0b2_init 不动】：幂等前提逐条证伪（:1245 CREATE SEQUENCE/:1252 起 9 条 UNIQUE INDEX 均无
#   IF NOT EXISTS、:1432/:1435 CREATE TRIGGER 无幂等形态——"拆出+幂等应用"首跑必炸；改造补幂等=修改已应用迁移
#   =破坏不可变性）；且拆出掉出 additive 门禁+5 处 DB 构建点（ci.yml:48/:178/gate-collab:188/deploy.sh:67/:119）
#   接线负担+"忘了跑 raw"静默降级面（缺 ledger_guard/canvas_doc_update_seq=资金正确性对象丢失）。
#   check-migration-immutability.mjs：记录每个已提交迁移目录的 sha256 基线（migration-checksums.json 棘轮），
#   任何已提交迁移文件内容变更/★删除/★重命名（基线键消失——同事故类，裁定 22⑼）→红；新增迁移→基线自增（有意识动作）。
#   ★双载体：进 pnpm verify 与 deploy preflight（deploy.sh:67 段）——单载体=服务器侧可绕过。
#   验收锚（先红后绿）：故意改 y0b2_init/migration.sql 一行注释→红；恢复→绿。
#   ——这才是偏离 52 的根因门（checksum 漂移防的是"已应用迁移被改"，sha256 棘轮直接判它）。
# T12-0c 准备：ALTER ROLE flowweb CREATEDB;（一次性本地授权——记忆既有流程）→后续迁移走 migrate dev --create-only
#   （traceId 迁移纯 Prisma 可表达——@@index 生成，不需要 raw；生成产物中附带的无关 DROP INDEX 必须【人工裁剪后
#   提交】，与 0d 硬拦口径统一——禁"确认放行"两纪律自相矛盾）
# T12-0d fresh-replay 门禁：dump-schema-objects.mjs 接入 verify（scratch 库重放 migrations/*→与 DATABASE_URL 库
#   对象清单双向比对——squash 的唯一可信验收，写好未接门禁的终结）
# DROP INDEX 硬拦：迁移语句含 DROP INDEX "pricing_rule_natural_key"（或触及 PricingRule 唯一性）→exit 1
#   （现 WARN_ONLY 不拦截 :23/:31-36——traceId 迁移是第一个会踩的）
# allowlist 定性维持裁定 2：两行=Prisma 表达力缺口永久登记（raw 未拆⇒diff 源不变⇒allowlist 稳定——报告2 的
#   "raw 拆出致 allowlist 涨 15 行"场景随不拆消失）
```

- [ ] **Step 2: 跑红→绿**（本地 fresh 库演练全锚 PASS；sha256 基线首建=T12 commit 自身；服务器侧部署验证归 T18 清单）。
- [ ] **Step 3: Commit**：`fix(y0b-5): T12 迁移链根修——tar 先清后传+集合断言+迁移 sha256 棘轮（不可变性门禁）+fresh-replay 进 verify+DROP INDEX 硬拦`

---

## Task 13：W3C traceparent 折中（六硬化）——x-request-id/HTTP RED/在飞 gauge/traceId 列

**Files:**
- Create: `apps/api/src/middleware/request-trace.middleware.ts`（校验+生成+ALS+响应头）+ `http-red.middleware.ts`（计时+在飞+path 归一）+测试
- Modify: `apps/api/src/main.ts`（中间件注册）；`execution.controller.ts:56`（job.data 携带）+`execution.processor.ts:32`（重建上下文）+其 spec :70（豁免注释）
- Modify: `apps/api/prisma/schema.prisma`（GenerationIntent.traceId String?+**普通索引 `@@index([traceId])`**）+迁移（**migrate dev --create-only 生成——T12-0c 后禁手写**；生成产物附带的无关 DROP INDEX **人工裁剪后提交**+硬拦兜底——统一"裁剪后提交"纪律禁"确认放行"）

- [ ] **Step 1: 红测**

```ts
it('入站 traceparent 严格校验：/^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/ 且 version=00 且 trace-id/parent-id 非全零（W3C 明文）——不合法丢弃新建禁宽松解析（客户端可控输入）', ...);
it('响应头 x-request-id≡traceId 恒等（测试锚——id 我们生成故结构性成立，不依赖 SDK 续接行为）；采样位不回声入站值（未开 tracing⇒不带 traceparent 响应头或 -00）', ...);
it('ALS 不过 Redis：queue.add 时 job.data.traceId 显式携带+processor 首行重建（enqueue 的 traceId==processor 日志 traceId——跨 Redis 保真锚，最易漏）', ...);
it('job.data 零客户端状态断言（execution.processor.spec:70）显式豁免 traceId+注理由（服务端生成不违断言意图——禁改错安全断言）', ...);
it('★traceId 落 GenerationIntent（claim 行同值）+普通索引 @@index([traceId])——【v2.1 修正：唯一→普通】一次组执行请求=N 行 intent（execution.service:221 循环 claim 每节点一行）∧skipDuplicates:true（generation-intent.service:206）⇒唯一索引冲突静默跳过=少冻结少计费（资金域最坏失败形态）且唯一约束否定自身审计用途（"该 trace 下所有 intent"结果集强制 1 行）；"防同请求重复 claim 同节点"是既有 generation_intent_active_node_unique 的职责勿用 traceId 兼职', ...);
it('★出口⑮：带 x-request-id 的三节点 execute→HTTP 200∧3 行 intent 同 traceId 全落库∧Σ冻结正确（组执行资金审计锚）', ...);
it('HTTP RED：http_request_duration_seconds{method,route,status}——route=/api/x/:id 归一（/\\d+→:id 防基数）；在飞 gauge inc/dec 配对（并发 3 峰值断言）', ...);
it('WS 帧不进 HTTP RED（显式声明——含义模糊禁）；jobId 复用禁（claim 业务 CAS 键）', ...);
it('kill-9 关停七模式全绿（关停链零新参与者——tracesSampler/tracing 开关不做=独立决策）', ...);
```

- [ ] **Step 2: 跑红** → FAIL。Step 3: 绿实现（`crypto.randomBytes(16).toString('hex')` 32hex——零新依赖；ALS=node:async_hooks 内置；外呼出站/客户端上行 traceparent 不做）。
- [ ] **Step 4: 跑绿**（含 migrate dev --create-only 产物过 check-migration-additive+check-migrate-diff 双绿+int claim 落库断言）。
- [ ] **Step 5: Commit**：`feat(y0b-5): T13 W3C traceparent 折中——严格校验+x-request-id 恒等+ALS/job.data 双通路+traceId 列普通索引+HTTP RED（WS connectionId=T11）`

---

## Task 14：/api/ready token 视图 degraded 块+admin coverage 端点+定价红标（Y0b-1 移交收口）

**Files:**
- Modify: `apps/api/src/modules/collab/collab-ready.service.ts`（token 档全字段视图扩）+ store.metrics（yjs_oldest_unflushed_age_seconds reader）
- Create: `apps/api/src/modules/admin/pricing-coverage.controller.ts`（GET /api/admin/pricing/coverage）+测试
- Modify: web admin 定价页（执行期定位）红标组件+测试

- [ ] **Step 1: 红测**

```ts
it('E44 职责维持：/api/health 不引 Collab 模块（liveness+db 面）；degraded 块挂 /api/ready token 档视图', ...);
it('degraded 三件+stuckDocs（E54⑤）：dirtyDocs（yjs_pending_projects 同源）/oldestUnflushedAt（新 reader gauge）/spoolDepthBytes（yjs_spool_depth_bytes 已有）/stuckDocs（yjs_doc_stuck_total 同源）——T15 巡检按此四键设阈值', ...);
it('GET /api/admin/pricing/coverage：AdminAuthGuard+{ok,missing:[model...]}（浏览器拿不到 prometheus token——红标必须走 admin 端点；复用 pricing.service 覆盖度判据与 check-pricing-coverage.mjs 同源）', ...);
it('ready 布尔不翻（deploy gate 不受 pricing 缺失影响——coverage 执域=admin 红标+preflight 脚本）', ...);
it('admin 定价页：missing 非空→红标 Alert「N 个模型无生效定价规则」；全覆盖零红标', ...);
```

- [ ] **Step 2: 跑红** → FAIL。Step 3: 绿实现。Step 4: 跑绿。
- [ ] **Step 5: Commit**：`feat(y0b-5): T14 ready token 视图 degraded 块（E54⑤ 三件+stuckDocs）+admin coverage 端点+定价红标（Y0b-1 移交收口）`

---

## Task 15：巡检 check-collab-health.mjs（根 scripts/）+crontab+SMS+runbook（Y0b-3 移交②收口）

**Files:**
- Create: `scripts/check-collab-health.mjs` + `scripts/check-collab-health.test.mjs`（SMS SDK 经 createRequire 解析 apps/api/node_modules——脚本独立于 api 部署树）
- Create: 阈值单源 `scripts/collab-health-thresholds.mjs`（与 T10 指标清单同源派生——runbook 表+测试断言同源，禁手抄）
- Create: `apps/api/scripts/collab-soak.mjs`（★裁定 24：**测量非执法**——E45 deny/LRU 归 Y1c-3 驳回的是执法；N doc×M client×编辑速率→输出 RSS/heap 曲线/驻留 doc 数/store 延迟/p99 帧延迟/spool bytes/min→**两张 runbook 数：并发容量上限+spool 存活窗**（预阈值 50%/80% 的"还剩多久"换算依据——只给告警答不出该否立刻介入是 T16×spool 交互的缺口）；CP-B 人工留档，运行时依赖真实 api 不进 verify）
- Modify: `docs/superpowers/collab-ops-runbook.md` §6（+stuck 手工出口行：drain→重启 api→观察 yjs_zero_conn_docs 回落——裁定 24 杂项；+SLO 表行：hydration p95≤2s/重连〔事件触发〕p95≤2s——T2 两条直方图的数据侧；+1012 部署窗恢复时长 ≤60s 行）

- [ ] **Step 1: 红测**

```js
// P0（exit 2）：heap 闸持续拒绝（collab_overload_state 连续样本）/not-serving>1min/资金不变量增量>0
//   （intent_frozen_stranded_total/intent_reconcile_mismatch_total 两样本差/ai_artifact_discarded{cause}）
//   ★spool 键三档（裁定 23⑱ 预阈值）：yjs_spool_capacity_total>0（全系统唯一「用户再也存不了东西」硬停面——指标已在 store.metrics:283-287）
//   +yjs_spool_depth_bytes 阈值 +**预阈值 50%/80% 两档 P1**（v2.2 只在满仓后告警太晚——PG 长故障经 T16 熔断短路
//   全部落 spool，预阈值给人工介入窗；spill 对象存储登记后续批次）
// P1（exit 1）：ready=false 任何 reason/yjs_doc_stuck_total 增量>0（连续 2 轮=10min——runbook 分诊行：查库卸载守卫为何不满足，禁用驱逐器掩盖）
//   /yjs_zero_conn_docs 持续不回落（stuck 候选池）/collab_auth_reject_total{source="bucket"} 高增（collab_auth_attempt_blocked_total 仓内零代码命中——spec :674 改名未落地，改挂既有 bucket 序列+偏离表登记）/yjs_doc_bytes_over_threshold_total 增量
//   /T14 四键（dirtyDocs/oldestUnflushed/spoolDepth/stuckDocs）/awareness_states>8 持续/ws_close 4410/4404 占比
// 机制：上次采样持久化（状态文件两份：.data/collab-health-last.json+sms-throttle——/tmp 重启即丢禁用；跨 run 增量可测——10s 窗测不出 5min 事故的修复）
//   节流 per-check（非全局 15min——新 P0 不被旧 P0 吞）；心跳自证（每次运行写 collab-health-heartbeat.txt+外层停更>15min=P0 判据进 runbook）
//   ALERT_SMS_TO 未设→SMS 跳过 exit 不变（最小可用降级）；crontab */5 进部署清单（禁提交 crontab 文件——runbook 命令行复制即用）
it('阈值表单源断言：THRESHOLDS 导出键覆盖 T10+T14 指标清单（机器派生禁手抄）', ...);
it('P0 命中→exit 2+SMS 恰一条+per-check 节流（同 check 重跑不重发、异 check 各发）', ...);
it('样本不足（首跑）→P1+insufficient-samples 标注', ...);
it('外部整机可达性探测：runbook 行（第二机 curl /api/health 或第三方 uptime——巡检脚本无法自证整机死亡）', ...);
```

- [ ] **Step 2: 跑红→绿**（本地 dev api 实跑 exit 0 留档）。Step 3: Commit：`feat(y0b-5): T15 巡检脚本（上次采样持久化+spool/stuck P0P1+per-check 节流 SMS+心跳自证）+阈值单源派生（Y0b-3 移交收口）`

---

## Task 16：PG 熔断（准入+store 短路 spool）+降级矩阵

**Files:**
- Create: `apps/api/src/modules/collab/collab-pg-breaker.service.ts` + vitest spec + int spec（Y0a-2 故障器基座）
- Modify: gateway（loadDocument/onAuthenticate 两入口+storeDocumentUnlocked PG 分支首行+★onAuthenticate docName 前缀守卫〔裁定 23⑶〕）+ store.metrics（collab_pg_breaker_state+failures_total{class}——新指标同 commit 登记 canonical：裁定 23⑬）
- Modify: `apps/api/src/modules/collab/collab-auth-defense.spec.ts`（**两锚同批改写**：:257 单一 clear 点 1→2+钩子表加「PG 半开成功」行——加钩子必红是 Y0b-3 按设计埋的，禁误判回归而放宽）
- Create: `docs/superpowers/collab-degradation-matrix.md`

- [ ] **Step 1: 红测**

```ts
it('失败分类=【连接族码表】导出 PG_CONNECTION_CODES（P1001/P1002/P1008+连接超时）参与 open 判定；P2024（池满——压力期拒新装载=赶走用户方向反了）与 code undefined 只计 failures_total{class} 观测【不参与 open】；isRetryableAppendError 继续供 append 重试——同模块码表单源两策略（v2.1 修正：复用 isRetryable 会把业务错/池满算成 PG 故障推开闸门）', ...);
it('open 判据=30s 窗≥5 次∧失败率>50%（纯连续计数在低 QPS 假阳性——窗口下限采纳；仅连接族样本计数）', ...);
it('熔断面①准入：open 时 loadDocument/onAuthenticate 直接 503 db-unavailable 面（零 Prisma 调用断言——防「每条新装载等满 5s 交互事务超时」）', ...);
it('熔断面②store 短路：open 时 storeDocumentUnlocked PG 分支首行直落 spool（省超时等待；与「不拒 append」同语义——数据仍进 spool 契约；retryPausedByCircuit gateway:2061 同族先例）；half-open 成功→走 PG+补排空 spool', ...);
it('范围限定：不裹 lease 心跳/不拒 WS 帧路径（breaker 只在三调用点——静态扫描锚）', ...);
it('★documentName 守卫（裁定 23⑹+24⑿ 强化）：认证期 docName **全匹配** `^project:[A-Za-z0-9_-]{1,64}$` 即拒（独立 reason=invalid-doc-name——全匹配挡空名/异常字符，非仅前缀判断；onAuthenticate/loadDocument/direct 三入口统一）——parseProjectId 裸 replace(:148-150) 下别名 docName("abc"≡"project:abc") 解析同 pid=**同一 projectId 双 doc 实例**：freezeQuota/beginVacuumEra/closeTeamDocuments 均按 `project:${pid}` 寻址⇒别名实例绕过冻结通告/vacuum 关闭=配额执法分叉（docTruth/docDelta/docFreeze 记账亦互相污染）；★跨任务四联动（裁定 24⑿——T0 先行写 13 值闭集）：invalid-doc-name 作**第 14 个 reason** 同 commit 更新 shared 枚举+terminal 集（漏加=客户端对永不可合法 docName 无限重连——⑵ 同型错误）+T0 detail 值域+spec §5.2（13→14）；用例=别名/空名/超长/异常字符连接被拒+正常名零回归+新指标 collab_auth_reject_total{reason="invalid-doc-name"}', ...);
it('★死代码处置（裁定 24 杂项——T16 同批）：isRetryableAppendError（pg-error.util.ts:9-13 零生产调用点）接线 PG_CONNECTION_CODES 分类或删除；retryPausedByCircuit（gateway:234/:2061/:2164 只写不读）接线观测或删——禁留考古层', ...);
it('★VIEWER→EDITOR 升权活路径（裁定 25⑦——报告3 P1-5 实证 gateway:2516-2522：sweepSessions→recheckConnection `!revoked` 分支**只刷死线不施加角色**，perm.changed 双向发出但无人清 auth 期直写的 readOnly ⇒ 升级 EDITOR 必须手动刷新才能编辑=团队协作核心流程缺口）：viewer 只读改走 auth 期意图+connected 登记（freezeIntent 先例 gateway:412-413）+`!revoked` 分支比较 re.role 经 `applyWriteFreeze(conn,"viewer", role==="PROJECT_VIEWER")` 施加+广播 conn-status——升权即时生效+降级/升级同出口+census ⑪ connectionConfig.readOnly 直写 3→2；用例=连接中 VIEWER 被 addMember 升 EDITOR→sweep 复验后 ≤5s 可写（禁手动刷新）', ...);
it('refusalCache 半开联动：half-open 成功→refusalCache.clear()（冻结契约 16 五钩子补全——Y0b-3 两锚改写后绿）', ...);
it('三态指标 collab_pg_breaker_state{0/1/2}+failures_total{class} 可见', ...);
it('int 故障注入：PG 停→open→ready reason=db-unavailable；恢复→半开探测→closed（Y0a-2 基座）', ...);
// 矩阵文档：行=PG/Redis/MinIO/AI provider×失败模式（停/超时/慢），列=读画布/写画布/执行/上传/公开页/资金；
// 格=行为+文案+指标+告警级；★spool 容量行（256MB 线 readOnly 降级 gateway:800-806）；★shrink/导出行标注「可用性等级高于普通写路径」；
// PG 行文案≡db-unavailable 瞬态档词表（禁自造第二词表）；本批只验 PG 格——Redis/MinIO/外呼三格标「未验证」（spec:634 如实声明）
// ★增行（裁定 25⑨）：「团队形态变更」（个人→团队邀请成员瞬间：权限面/GenerationIntent.teamId 配额归属/writeFrozen 语义三连变——
// 在飞 intent 结算归属与快照重推为未验证格如实标注；solo collabScope 字段登记偏离表 Y0c 输入——服务端 conn-status 一字段+客户端文案分支最小形态）
```

- [ ] **Step 2: 跑红→绿**。Step 3: Commit：`feat(y0b-5): T16 PG 熔断（准入+store 短路 spool+窗口失败率+refusalCache 半开五钩子补全+Y0b-3 两锚改写）+docName 前缀守卫（别名执法分叉根修）+降级矩阵一页`

---

## Task 17：exec-smoke 资金链冒烟进 deploy post

**Files:**
- Create: `apps/api/scripts/exec-smoke.mjs`；Modify: `deploy.sh`（post 段+--skip-exec-smoke 显式档）

- [ ] **Step 1: 断言链（零外部流量档=唯一档）**

```
①哨兵：AIModel 行 apiUrl='http://127.0.0.1:1'（必填列 schema:207；三链读行级 api-caller:179/:223/:439——毫秒级 ECONNREFUSED）
  +apiKey='smoke-dummy' 假值（非空——空走 PROVIDER_API_KEY_MISSING 503 只验业务错漏 settle/refund 环 :199-205）
  +★provider='smoke'（∉shared ADAPTERS——public 选择器 executableModel 谓词（public.service:28：active∧provider∈ADAPTERS∧apiModelName 非空）过滤=用户不可见；claim 侧不查该谓词——执行期首步核对确认 claim 可走）
  +creditCost:0 定价规则+标记前缀 smoke:y0b5:*（禁走图片编辑链——dashscope 硬编码 :112/:266/:343 会真外呼）
②正例（传输失败环）：claim→plan 固化（intent 行 creditCost=0+pricingRuleId 快照）+reserve=0+台账零行（creditCost:0 不产资金行——两列真值表口径）
  +状态机收敛：ECONNREFUSED→error→零扣费闭环（balanceDelta 恒 0+终态 reservedCredits=0）
②b ★正例（settle/refund 环——裁定 23⑯）：本地 HTTP stub server（脚本自起 127.0.0.1:<port> 作哨兵 apiUrl——
  返回可控 JSON）→零外呼走完 **true settle 全链**（成功路径：plan 固化→reserve→provider 200→settle→台账对）
  +**失败退款环**（stub 返回 5xx→error→refund→冻结释放归零）——ECONNREFUSED 只验 error 环，资金闭环两环齐验
  （spec §5.10 否决理由针对**进程内** fake，不适用 HTTP stub；creditCost:0 时资金断言用 ledger 行形态非金额）
③负例：从未注册的 modelId（禁用刚删哨兵名——modelCache 5min TTL :103 缓存击穿）→4xx fail-closed+零外呼+零冻结+零 intent 行
④清理：哨兵全删（模型+规则+项目+intent+★产物文件）——finally 级+失败=fail deploy（清理失败必被发现）+★幂等
  （启动先扫 smoke:y0b5:* 遗留再建——上一次崩溃残留不永久污染）
⑤deploy.sh post 段 collab-smoke 后追加+--skip-exec-smoke 显式档（默认跑）
```

- [ ] **Step 2: 本地 dev 跑绿留档→deploy.sh 接线。** Step 3: Commit：`feat(y0b-5): T17 exec-smoke 资金链冒烟（哨兵 127.0.0.1:stub server 双环〔error+settle/refund〕零外呼+幂等清理+fail-deploy 兜底）进 deploy 链`

---

## Task 18：出口汇聚——verify 全量+偏离登记+部署清单【出口（CP-A/CP-B 两检查点已过——裁定 21；本任务=最终确认点】

- [ ] **Step 1: `pnpm verify`（全量——唯一出口判据；verify:fast 非判据）+`pnpm int:ci`+coverage；census 两新锚绿（裸 reload 白名单+encodeStateAsUpdate 计数）；check-plan-anchors 对本文件绿。
- [ ] **Step 2: spec §0.4d 偏离登记表（v2.9）**：本 plan §0 裁决 1-23 逐条落档（Y5 前移+世代通道/迁移四件/verify 切片+驳回驱逐/traceparent 六硬化+Sentry 收敛+csv/cb 白名单/熔断扩展/refusalCache 锚改写/演练 collab-core/exec-smoke 定案/白名单 12 值 E40 经 ws_reason 携带/invariant 采样化/idle_timeout 删除同步 §5.2；★裁定 23 七轮项：单所有者收归+watchdog 纯观测/T8 载体自研〔撤 y-indexeddb 依赖〕/SS2 闸 ALLOWANCE/docName 前缀守卫/armSession/diverged/退避路由分流/1012 jitter 0-60s/kill9 编辑中档/stub settle 环/release 修复/预阈值+TOKEN/⑱⑰⑱⑲⑳判据——冻结契约 12"客户端无本地持久化"三处文案随 T8 落地同批改写）+总目录 spec Y0b 行状态回填；★裁定 25⑨ **"开真实收费前门"两项**（从"后续批次"无期限篮子升为收费前门：服务端版本历史/恢复〔compact 快照现成基座——一次误删或一个坏客户端可永久损坏团队画布〕+`POST /api/collab/doc/merge`〔>8MB 恢复唯一通道，Y5 必做〕——与 spec §9.13 PITR/巡检同类）。
- [ ] **Step 3: 部署清单**（api+web 同批）：
  1. **前置核对**：Y0b-4 部署（csv=2）已执行？否=先执行或同窗。
  2. `.env` 新键：`ALERT_SMS_TO`（可选）、`SENTRY_DSN`（可选）、`PROMETHEUS_TOKEN`（★裁定 23⑱——/metrics 生产 fail-closed 403，原清单漏；巡检与外部抓取消费前提）；零新必填键；web 零新依赖（自研适配器）。
  3. 迁移：T12 后常规 `migrate dev --create-only` 产物+`prisma migrate deploy`+fresh-replay 门禁绿+**T12-0a 先清后传生效**（Y0b-4 偏离 52 pricing 索引 drift 残留形态由双向比对一并核对）。
  4. crontab `*/5` 巡检+日志追加+心跳文件外层判据（runbook §6 复制即用）+第二机/uptime 外部探测行+★巡检启动自证 `curl -H "x-prometheus-token: $PROMETHEUS_TOKEN" /metrics` 200（token 缺失=巡检全 P1 insufficient——先于 crontab 装）。
  5. deploy post：exec-smoke 进链（首跑观察）。
  6. 部署后验证：/api/ready token 视图 degraded 四键+/metrics 新指标族（带 PROMETHEUS_TOKEN 头——yjs_doc_bytes 直方图/awareness_states/collab_pg_breaker_state/collab_telemetry_*）+巡检 exit 0+浏览器手验：断网编辑→刷新→本地副本→恢复复合。
  7. 回滚说明：T8 回滚后浏览器残留 IDB 库**无害的前提=terminal 清副本已生效**（裁定 22⑶——残留窗口=terminal 到达前；清库后无残留读者）——runbook 记明；maxDelay pin=30_000（=库默认——声明与代码一致）。
- [ ] **Step 4: 出口判据对照（含新增⑫-㉓）**：⑫a 编辑→硬刷新→.yjs 字节复合；⑫b E36 不可达性（快照编码≤maxDocBytes⇒回放帧=编码+包装≤闸+ALLOWANCE 恒过——同源闸不变量+SS2 落 4404 带 shrink 自救）；⑬4410→导出→purge→reload（顺序锚）→无旧代内容不循环；⑭切 uid 不读前 uid 库；⑮三节点 execute 3 行同 traceId 全落库+Σ冻结正确；⑯零 unhandled rejection（浏览器端——connect catch 与 IDB 降级两处）；⑰单 flush 窗内多 code/reason 精确分列（复合聚合键）；⑱**两段式（裁定 24⑨）**：掉线后**事件触发（online/回前台）≤2s 自愈**／无事件 ≤当前阶梯步骤（上界 30s）——kickNow+fake transport 自动化（锁死收归唯一回归线；含 hidden 恢复即连档）；⑲全仓测试基座：任何 unhandledrejection 让用例失败（一条 setup 覆盖整类——**带白名单**防 abort 类库 flaky）；⑳diverged 闩锁回归（readOnly 编辑→刷新→不自动 hydrate→二选一→清标记恢复——三出边完备）；㉑帧闸-桶耦合成对用例绿（maxDocBytes+30B SS2 同过 ⓪ 与 ⓪′+Update 闸不放宽反向）；㉒census detail 白名单锚绿（调用点键集⊆允许键集——新增调用点即红）+五档穷尽性表驱动用例绿；㉓soak 报告留档（并发容量上限+spool 存活窗两数进 runbook——按"数字进 runbook"验收非"脚本跑过"）；㉔api 侧两锚文件（ws-polyfill.gate/behavior-anchors）在归零模型下重新绿（fixture 事件序列含 disconnect）；㉕detail 表三列齐备+census 锚对 18 调用点全绿（含 via 与六值值域）；㉖多标签 dirty 守卫用例（A diverged+B pagehide→刷新后 A 未上行编辑仍在）；㉗.yjs 2MB 备份导入成功（上限判据换文档预算的证明）；G-5 锁定项演练绿（collab-core）；G-6 观测/巡检/熔断/冒烟逐条留档。
- [ ] **Step 5: 清理 `apps/api/scripts/tmp-pricing-probe.mjs`（未跟踪残留）+提交用户确认。**

---

## 附：执行顺序与依赖（裁定 21——单批+两检查点）

```
【CP-A 客户端链出口——用户确认点「客户端形态冻结」】
T-prep ─→ T0 ─→ T1 ─→ T3 ─→ T2 ─→ T4 ─→ T5 ─→ T6 ─→ T7 ─→ T8 ─→ T9
（T3 先于 T2：遥测记录点落在 close/authFailed handler 上——先定型 handler 结构再接记录点；
  T3/T8 不相邻维持——同窗口叠加会把"偶发多 socket"症状变"内容不一致"，归因从小时级变天级；
  T9 固定 CP-A 末项——演练价值=所有权与未确认标记已定型）
CP-A 判据：web 全测绿+浏览器手验三件（断网编辑→刷新→本地副本只读→恢复复合｜瞬态 4408/1008
  退避 2-4s 内首连｜401/4401 终态不重连）+⑱两段式（事件触发 ≤2s/无事件 ≤当前阶梯——kickNow 用例）
  +模型式重连不变量用例绿（socket≤1/瞬态恰一 timer/terminal 零 timer）
  +census 无裸 location.reload()

【CP-B 服务端/运维出口——完成后续走 T18】
T10 ─→ T14 ─→ T15（巡检消费 T10/T14）│ T11（connectionId 供 T13 join）│ T12 ─→ T13（迁移先于 traceId 列）
T16（依赖 T10 指标）│ T17
CP-B 判据：pnpm verify 全量+int:ci 绿+/api/ready degraded 四键+/metrics 新指标族可见+巡检 exit 0
→ T18 出口汇聚（偏离登记+部署清单+判据 ⑫a-⑰ 对照）
```

## 附：执行风险预警

| 风险 | 缓解 |
|------|------|
| T3 supervisor 收编触发 runtime 大改（1346 行文件四套所有权收一处） | 行为锚先行（Step 0）+分两 commit（pin+锚→收编）；既有 conn.spec/offline.test 全量零回归为硬门 |
| T8 自研 IDB 适配器与既有幂等快照/undo 语义冲突 | T5 通道先行（独立可验）+undoManager.clear 先例+离线恒只读（canEdit 谓词零改动）；Y5 边界外项显式不做；自研=~150 行全部可控（无库黑盒面——裁定 23⑷） |
| T12 已提交迁移被意外修改（checksum 漂移——偏离 52 事故类） | check-migration-immutability.mjs sha256 棘轮直接判（覆盖内容变更+**删除/重命名**——裁定 22⑼）+verify 与 deploy preflight 双载体；验收锚=故意改 y0b2_init 一行注释→红；raw 段留在 init 内不动（v2 曾提"raw 本就幂等"系证伪结论——migration.sql:1245/:1252 起/:1432 实测无幂等形态，禁再引用） |
| T16 refusalCache 锚改写被误判回归 | plan 显式列出两锚（:257 计数 1→2+钩子表加行）——红是按设计（Y0b-3 预埋的覆盖锚机制） |
| T9 演练依赖双 client 装置稳定性 | collab-smoke/kill9 既有装置复用；CI flaky 逃逸=dispatch 手跑留档 |
| 库 pin（maxAttempts:1）改变首连/重连行为面 | ★裁定 23⑴ 收归唯一：maxAttempts:1 切断库重连（曾 open 掉线后库 1s 定时器单次尝试失败即停摆——实证）⇒**全部重连归 supervisor**（open 归零 shouldConnect=库定时器结构性失效；普通掉线走 supervisor 指数表首档 2s——远优于库 1s 热循环+watchdog 45-60s/hidden 永不恢复）；delay/maxDelay/messageReconnectTimeout=库默认值显式钉；connectOnce 必 catch（⑯）+⑱掉线 30s→≤5s 恢复回归线+行为锚④①；conn.spec 与"库自动重连"相关锚随任务改写、首连行为零回归 |
| exec-smoke 哨兵 active=true 暴露选择器 | creditCost:0+不可达端点双保险（免费+必败）；命名 smoke-y0b5-*+fail-deploy 清理兜底；偏离表登记 |

