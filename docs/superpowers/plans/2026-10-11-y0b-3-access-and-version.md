<!-- doc-status: draft-v1 | created_at: 2026-10-11 | note: 基线勘察 2026-10-11 HEAD=2eb7e74b（Explore agent 全量重验+库 d.ts 抽验：onUpgradePayload socket: any/beforeHandleAwareness/onStateless/connected 四钩子齐备+onAuthenticatePayload.socketId d.ts:480+onAuthenticationFailedParameters 仅 {reason} d.ts:127——版本 loop 键载体据此定为 /api/ready 单次探测）；spec=2026-10-08-y0b-funds-and-access-design.md v2.6 §3 全节+§5.1/5.2/5.3 锁定项（§2.1 行 227 v2.2 锁死同批范围） -->
# Y0b-3 准入与版本 Implementation Plan（v1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 Y0b 准入与版本批（spec v2.6 §3 全节+§5.1/5.2/5.3 锁定项）——**E13 准入收口**（sweep 默认开+事件驱动权限复验+Origin 403+cookie-only+升级限流）+**拒绝路径防放大四层防线**（refusalCache→信号量→per-socket 桶→heap 闸，执行序钉死）+**heap 压力自保闸**（双量纲谓词+仅拒新物化+5min reaper 释放路径）+**E73 awareness 覆写与归属**+**E60 版本门**（csv/cb query 通道+三档拒+loop 保护自愈）+**E56 修订**（SCHEMA_OUTDATED reason 断链修复+连接寿命 4402+close code 分配表）+**客户端锁定项**（authenticationFailed→wsAuthNotice 写点+四/五档终态 UX+(code,reason) 双键映射表+退避与重连所有权+write-frozen 消费+503 retryAfter）+**stateless ping 保活**（15s 双向+onStateless 全函数化+unhandledRejection 兜底——P14 崩溃向量根修）。

**Architecture:** 防线按「零 DB/零分配优先」分层插入 onAuthenticate（spec §3.1bis 钉死执行序：`refusalCache → 并发信号量 → per-socket 桶 → heap 闸 → 版本门 → 四次 DB 查询`），跨 T3/T4/T5 三批插入、每批红测断言相对序；不变量交给结构——拒绝理由一律经 `Object.assign(new Error, {reason})` deny 工厂单点埋计数，词表 append-only（shared 单源），close code 全集进 `shared/constants/collab-close-code.ts`（(code,reason) 双键分型——4401 双 reason 族只判 code 会把库 Unauthorized 当会话过期无限续期）；awareness 身份权=服务端覆写注入+clientId 归属表（伪造帧丢弃非改写）；heap 闸仅拒新物化永不驱逐存量（`!documents.has(documentName)` 防自伤）+迟滞双阈值+fail-open。

**Tech Stack:** Nest 10 + @hocuspocus/server 4.6.0（契约锁 check-hocuspocus-pin）/ @hocuspocus/provider 4.6.0 / yjs 13.6.32 / prom-client / zod / EventEmitter2 / vitest（单元+collab-core 真连装置+int 真库）/ vite define。

**执行门：** 每 Task Step 0 只读探针（输出粘 commit message）；**每 Task 收尾 `git commit`，红→绿→commit**；**T11 子批出口=【用户确认点】**；**服务器部署步=【告知用户点】**（.env 增 `COLLAB_TRUSTED_PROXY=1` 必须——不设则升级限流退化为全站 127.0.0.1 单桶；部署窗口=已打开的旧 bundle 会话全部进版本终态拒绝——§9.1 fail-closed 既定语义非风险）。

**执行序：**

```
T0（shared 契约地基——词表追加 5 值+isTerminalReason 五档+close-code 模块+协议版本常量
     +兼容矩阵+ready reason 补全核对；零运行时风险）
  → T1（进程地基——env 九键注册+SWEEP 默认开翻转+trust proxy loopback+unhandledRejection
        全局兜底+Server 构造 websocketOptions/pre-auth 三 pin+单测键集断言）
  → T2（upgrade 面——cookie-only+Origin 403 socket 直写+升级限流 token bucket
        +address 默认翻转 127.0.0.1）
  → T3（认证防线——refusalCache+全局信号量+per-socket 桶+执行序骨架+auth_reject 单点计数
        +验收三锚）
  → T4（heap 闸——谓词单源 util+双点落点+已加载豁免+5min reaper 前置谓词
        +check-ecosystem 区间断言链+四红用例）
  → T5（版本门服务端——csv/cb query+三档拒+__CLIENT_BUILD__ 注入+collabUrl 单次构造）
  → T6（SCHEMA_OUTDATED 断链修复〔拒载 throw 附 reason〕+连接寿命 4402〔connected 播种
        +自建 Map+键控清理〕+close code 常量化迁移〔gateway 四处+runtime 1012〕）
  → T7（E73 awareness——beforeHandleAwareness 覆写注入+clientId 归属表+伪造丢弃
        +客户端 setLocalUser 退化；‖可与 T8 并行）
  → T8（sweep 升级——perm.resolve 复验+降级 readOnly+awareness role 改写+事件驱动即时踢权
        +间隔 5min+jitter+会话级结论缓存）
  → T9（客户端锁定项——authenticationFailed→wsAuthNotice 写点+terminal disconnect
        +映射表消费〔4401 双 reason/静默续期一次〕+退避表+重连所有权 5 步+write-frozen
        消费+横幅+版本过期 reload〔loop 键=ready 探测〕+503 retryAfter+四/五档终态 UX）
  → T10（stateless ping 保活——服务端 onStateless 全函数化+pong 单发+客户端 15s ping
         +forceSyncInterval 60s pin+P14 红锚+双向出口锚）
  → T11（出口汇聚——verify 三连+census 清零组+int 覆盖回填+spec §0.4 偏离登记
         +v8 目录 Y0b 行回填+部署告知清单；【用户确认点】）
```

**TDD 纪律：** 红→绿→commit，红相留档（commit message 粘红/绿两态）。**真红门**（改前必红）：Origin 拒=真连+伪造 Origin→握手失败+计数（现状无 onUpgrade 钩子=零计数）；cookie-only 伪造 query token 拒绝（现状 query 优先=放行红）；防放大三锚（①N 次被拒 Auth→prisma 计数不随 N 增长 ②并发 M socket→在飞峰值≤INFLIGHT_MAX ③桶满后续 Auth 全拒零 DB）；heap 闸四红（stub 0.9 拒新 doc/已加载豁免/谓词抛错放行/释放路径 reaper——现实现 store 失败 doc 永驻为红）；版本门三档+计数（现状零校验）；schema-outdated 拒载 throw 附 reason（现状仅 schemaRefusal 标记=客户端收字面量 permission-denied 红）；awareness 伪造锚（现状客户端自写 user 直进 states 红）+归属锚（伪造他人 clientId 覆盖对端 state 红）+双标签断连不冻结；sweep 降级（现状 recheckConnection 不判 PROJECT_VIEWER 红）+事件即时踢权；连接寿命 fake timers+4402；**P14 红锚**（真连发 sendStateless('not-json')→改前 unhandledRejection 兜底计数+1 且 bad_payload 零〔无钩子〕；改后 bad_payload+1 且 unhandledRejection 零）；退避期间升级次数==0 且无并发 socket；4401 双 reason 分型（只判 code 会静默续期库 Unauthorized=红）。**census 验收 grep**（统一 `\|` 转义）：`requestParameters?.get\('token'\)`（T2 后 gateway 清零）+`close\(1012\|close\(4401\|close\(1000`（T6 后 gateway+runtime 裸字面量清零——shared 常量单源）+`'0\.0\.0\.0'`（T2 后 gateway 默认值清零）+`setAwarenessField\('user'\|setLocalUser\|replayLocalUser`（T7 后清零）。**int 纪律**：新增 int/真连用例优先并入现有 `*.spec.ts`（collab-core 装置族）；确需新文件先 `git add`+T11 回填 check-int-coverage 下限。**spec 同步**：各 Task 新增 env 键/指标名/close code/词表值与 spec §7.1 fenced 块同 commit 对齐（check-spec-consistency.mjs 已进 verify——滞后=verify 红）。

---

## 0. 基线勘察锚点表（2026-10-11 HEAD=2eb7e74b 一手核验；执行者以此为准，spec §1.1B 行号已漂移）

> 路径总漂移：spec 写 `apps/api/src/collab/`——实际 `apps/api/src/modules/collab/`。gateway 1373 行。

| 锚点 | 现状 | 本批动作 |
|---|---|---|
| `modules/collab/collab.gateway.ts:207-232` | Server 构造：`address ?? '0.0.0.0'`（:219）；hooks 现挂 onAuthenticate/onLoadDocument/onStoreDocument/afterStoreDocument/onDisconnect/beforeUnloadDocument 六项（:224-229）；**无 websocketOptions**（ws 默认 maxPayload=100MiB 生效） | address 默认翻 127.0.0.1（T2）；websocketOptions+pre-auth 三 pin（T1）；新增 onUpgrade（T2）/onStateless（T10）/beforeHandleAwareness（T7）/connected（T6）四钩子 |
| `gateway:246-295` | `authenticate`：`:249-250 token = requestParameters?.get('token') ?? parseSessionToken(cookie)`（query 优先）；:255 draining deny/:256 lease deny/:259 spool 降级 readOnly/:262 touchWithReason/:274 perm.resolve/:278 VIEWER readOnly；catch :292-293 分型透传+DB_UNAVAILABLE 折叠 | cookie-only（T2）；顶部插防线（T3-T5 按 §3.1bis 序）；deny 工厂 :247 单点埋 auth_reject 计数（T3） |
| `gateway:311-370` | onLoadDocument：:312-313 lease 门（三入口汇聚点先例）；:354-360 ensureSchemaVersion catch→`Object.assign(e, { schemaRefusal: true })` **无 reason**；:361-362 stamp 自愈 | :359 追加 `reason: SCHEMA_OUTDATED`（T6）；:312 前插 heap 闸第二落点（T4） |
| `gateway:44-45` | `SESSION_SWEEP_INTERVAL_MS=60_000`/`GRACE=5_000` | 间隔 5min+jitter±20%（T8） |
| `gateway:1132-1198` | sweep：:1139 `!== 'true'` return（**默认关**）；recheckConnection :1166-1181 **手写三段查询（session→project→teamMember），不调 perm.resolve、不判 PROJECT_VIEWER**；scheduleSweepClose :1183-1198（4401 'session-expired' :1191） | 默认翻转（T8）；复验改 perm.resolve+降级 readOnly+awareness role 改写+事件驱动（T8） |
| `gateway:662-685` | beginDraining：:672 `close(1012,'drain released')`；:681 readOnly=true；:682 `conn.sendStateless?.({type:'write-frozen',reason:'draining'})`（注释"Y0b 消费"） | 客户端消费接线（T9）；frozenConnections :121 |
| close code 字面量 | gateway 四处：:672/:1206 1012、:1191 4401、:1368 1000；runtime :850 1012 | 全部迁移 shared 常量（T6） |
| `packages/shared/src/constants/collab-auth-reason.ts`（37 行） | 七值词表+TERMINAL_AUTH_REASONS 四档 Set（:27-32）+isTerminalReason | 追加 5 值+终态表加版本族三档（T0） |
| `shared/constants/collab-close-code.ts` | **不存在**（全 grep 零命中） | 新建（T0，exemptions.json 已登记前向引用豁免 expires 2027-01-06——落地后自然空转） |
| `apps/web/src/stores/canvasCollabRuntime.ts`（1112 行） | createProvider :867-884：`collabUrl()` **两处调用**（:868 transport/:871 provider）+`token:'cookie-auth'` 占位+无版本参数；1012 消费 :846-857（plannedRestartUntil :108/:164）；collabReadOnly 授权写点 :841（authenticated）；**wsAuthNotice 零生产写点**（声明 canvasStore.ts:171/消费 syncStatus.ts:9+runtime:960）；sessionEpoch :84/:910/:1000 | collabUrl 单次+版本参数（T5）；authenticationFailed 写点+close 映射+onStateless write-frozen+ping（T9/T10） |
| `apps/web/src/collab/awareness.ts`（94 行） | setLocalUser :54-56 客户端自写 user（生产调用方 CanvasView.tsx:113）；replayLocalUser :60-62；setSelection :70-72 死代码（:68 注释钉死勿接） | user 写入全链退位（T7）——setLocalUser/replayLocalUser 删除+CanvasView 调用点删 |
| `apps/api/src/config/env.ts`（111 行） | COLLAB_* 族 :65-81（blankToUnset+zod optional 不写 default——默认值落使用点）；COLLAB_SWEEP_ENABLED :72 enum；COLLAB_MAX_LOADED_DOCS :78 预留零消费；**COLLAB_TRUSTED_PROXY 不存在** | 新增九键（T1） |
| `ecosystem.config.cjs` | max_memory_restart '1G'（:15）/old-space 512（:16）/min_uptime 30s/max_restarts 10；env 白名单仅 SPOOL_DIR+BIND_ADDR（check-ecosystem :63 ENV_ALLOWLIST） | **不动**（heap 闸是运行时自保非进程档位）；断言链新增（T4） |
| `deploy/nginx/collab-location.replace.conf` | access_log off（:6）+X-Real-IP（:14）已设——升级限流可信 IP 前提成立；**替换语义指令清单**（头注 :1-4——禁整段直贴） | 零变更；`nginx -T` 断言 /collab 段含 access_log off（T5 落 deploy 校验） |
| `scripts/check-ecosystem.mjs`（108 行） | :51-59 heap/rss 断言（896MB 算式保留）；:63 ENV_ALLOWLIST | 区间断言链插入 :61 后（T4） |
| `modules/collab/store.metrics.ts`（242 行） | prom-client 显式 registers 传参；yjs_hydration_huge_row_total :115（帮助文本自注"硬拒绝归 Y0b 配额批"——**Y0b-4 域**本批不动） | 本批新增指标 14 个（见 §0.2 表） |
| `apps/api/src/main.ts`（102 行） | :87 `app.set('trust proxy', true)` 全信任；**无 process.on 任何兜底** | :87 改 'loopback'+unhandledRejection 兜底（T1） |
| `apps/web/src/stores/syncStatus.ts` | canEdit :8/canExecute :15 已落地（writeFrozen 字段 canvasStore.ts:189 恒 false 等接线） | 零改动；writeFrozen 写点 T9 |
| 库契约（d.ts 一手抽验） | onUpgradePayload `{request, socket: any, head}`（:702-707）；beforeHandleAwarenessPayload `{awareness, clientsCount, context, document, documentName, instance, requestHeaders, socketId...}`（:586-609）；onStatelessPayload `{connection, documentName, document, payload: string}`（:467-472）；onAuthenticatePayload 含 `socketId`（:480）/`token`（:481——Authentication 帧 token，现未消费）/`providerVersion`（:483——P6 勘误：硬编码不可用，版本门走 csv query）；provider `sendStateless(payload: string)`（:430 公共 API）；**onAuthenticationFailedParameters 仅 `{reason: string}`**（:127——无 message 通道⇒版本 loop 键必须走 /api/ready 探测）；pre-auth 三配置键齐备（:54-56）+websocketOptions `Record<string,any>`（:120） | — |

**§0.1 设计裁定（本 plan 钉死，执行者不再决策）**

| # | 裁定 | 依据 |
|---|------|------|
| P-A 词表追加 5 值 | `SERVER_OVERLOADED:'server-overloaded'`/`SCHEMA_OUTDATED:'schema-outdated'`/`CLIENT_VERSION_MISSING:'client-version-missing'`/`CLIENT_VERSION_INVALID:'client-version-invalid'`/`RATE_LIMITED:'rate-limited'`；isTerminalReason 追加**版本族三档**（schema-outdated/client-version-missing/client-version-invalid——均落 reload 档 UX）；server-overloaded/rate-limited **严禁入终态**（枚举处注释钉死：误入=一次内存尖峰/一次拥塞把全部客户端钉死且不自愈） | spec §3.2/§3.4/§5.2；rate-limited 承接 per-socket 桶超限 deny（§3.1bis 3"throw 带 reason"+§5.2"必须落瞬态桶"） |
| P-B heap 拒绝双指标口径 | onAuthenticate 落点→`collab_auth_reject_total{reason='server-overloaded'}`+`collab_load_rejected_total{reason='server-overloaded'}` **两者都记**（auth 面计数与物化面计数两个维度）；loadDocument 落点→仅 `collab_load_rejected_total` | §3.2 指标原文泛指"拒新物化"；两维度不重叠 |
| P-C 版本 loop 键载体 | **/api/ready 响应增 `collabProtocolVersion` 字段**；客户端版本终态时单次探测（节流——非 §5.4 已删的轮询形态，属其"边角单次探测"同族）→loop 键=`collab-version-reloaded:${服务端版本}` 存 sessionStorage——键在=已 reload 过一次还没救=落逃生动作；下次部署服务端版本变=键异=可再自愈一次 | d.ts:127 实证 authenticationFailed payload 仅 {reason}——message/版本经拒绝帧结构性不可达；spec §3.4"loop 保护键=观测到的服务端协议版本"原文语义 |
| P-D E73 边界 | >8 人剥离 cursor/selection 与服务端单连接短路（connectionsCount≤1 不转发）**归 Y0b-4**（spec §4.4 详情节为准；总表 E73 行括号内容与 §4.4 重复出现——详细节优先） | §3.3/§3.6 出口清单均未含此二项 |
| P-E refusalCache 清空钩子 | 本批落四钩子：①drain 解除 ②租约 rejoin ③heap 闸释放 ④spool 恢复（isWritableOrDegraded 状态翻转点）；**PG 熔断半开成功=同 ④ 钩子位，Y0b-5 落熔断时接线**（锚用例表驱动按已注册钩子数断言） | §3.1bis 1"spool 恢复与 PG 熔断半开成功——并集"；§5.9 PG 熔断=Y0b-5 域 |
| P-F 信号量/桶拒绝不入缓存 | 实现结构=authenticate 拆外层（防线：桶/信号量 throw **不经过**写缓存的 catch）+内层（状态类拒绝 throw 进 catch→reason∈白名单→写缓存）——按 throw 来源区分，非按 reason 值 | §3.1bis 1"信号量溢出与桶超限的拒绝不入缓存"钉死 |
| P-G 升级限流拒绝形态 | Origin 非法→`HTTP/1.1 403`+destroy；限流超限→`HTTP/1.1 429`+destroy（同为 socket 直写不回握手；spec 只钉 403 形态，429 为同族补全——登记 §0.4 偏离） | §3.1ter 形态（esm:1623-1636 hook throw=未处理 rejection 形同虚设的实证） |
| P-H sweep 翻转落点 | gateway:1139 判据 `!== 'true'`→`=== 'false'`（显式 'false' 才关=env 逃生阀维持——§4.2 回滚表"sweep 另有 env 逃生阀"） | spec §4.2 |
| P-I trusted proxy 收口 | main.ts:87 `'loopback'` 一行统一（REST XFF 与 WS 同信任前提；E58 完整收口仍归 Y0.5）；**生产必须 .env 增 `COLLAB_TRUSTED_PROXY=1`**（不设=不信任 X-Real-IP=限流全站单桶——【告知用户点】） | spec §7.1 v2.2 R12+§3.1 |
| P-J write-frozen 本批形态 | 服务端：进入冻结广播（:682 既有）+**connected 钩子重放**（幂等快照的 (a) 半——frozen 态连接建立时重发通告防重连丢态）；解除=drain 释放 1012 既有链路（复用零新恢复逻辑）；消息形态 `{type:'write-frozen',reason}`（quotaState 字段 Y0b-4 同通道扩展）；客户端：writeFrozen 写点+横幅「服务维护中，编辑已暂停；恢复后可继续（请勿刷新页面）」+authenticated 清零 | §5.3 锁定项+spec 原文"复用 1012 既有链路零新恢复逻辑" |

**§0.2 本批新增指标全表（store.metrics.ts 单源；进 spec §7 fenced 同步）**

| 指标 | 类型/标签 | Task |
|---|---|---|
| `collab_upgrade_rejected_total` | Counter, reason=origin\|rate-limited | T2 |
| `collab_auth_reject_total` | Counter, reason（deny 工厂单点+信号量/桶/heap 拒绝点） | T3/T4 |
| `collab_auth_inflight` | Gauge（当前在飞 onAuthenticate 数——验收锚②读此） | T3 |
| `collab_load_rejected_total` | Counter, reason=server-overloaded | T4 |
| `collab_overload_state` | Gauge, state=ok\|tripped（互斥两 series） | T4 |
| `collab_doc_store_failed_total` | Counter（onStoreDocument catch 处） | T4 |
| `yjs_doc_stuck_total` / `yjs_doc_reaped_total` | Counter（reaper 前置谓词不满足/成功卸载） | T4 |
| `collab_version_negotiation_reject_total` | Counter, reason=client-version-missing\|client-version-invalid\|schema-outdated | T5 |
| `collab_stateless_bad_payload_total` / `collab_stateless_unknown_total` | Counter（onStateless catch/未知类型） | T10 |
| `collab_stateless_ping_total` | Gauge（set 最近 ping 时间戳——"保活是否在工作"可观测） | T10 |
| `collab_unhandled_rejection_total` | Counter, source（全局兜底） | T1 |

（`collab_idle_timeout_total` 载体=客户端遥测 close_code 事件族——**Y0b-5 sink 域**，本批仅在映射表分型 4408→idle-timeup+diag ring 记录，登记 §0.4。）

**§0.3 env 新键全表（env.ts :65-81 形态：blankToUnset+optional 不写 default——默认值落使用点；COLLAB_MAX_LOADED_DOCS 预留维持零消费不动）**

| 键 | zod | 默认（使用点） | Task |
|---|---|---|---|
| COLLAB_ALLOWED_ORIGINS | string.min(1).optional() | BETTER_AUTH_URL origin+http://localhost:5173 运行时推导 | T2 |
| COLLAB_TRUSTED_PROXY | z.enum(['1']).optional() | 未设=不信任 X-Real-IP | T2 |
| COLLAB_UPGRADE_RATE_PER_MIN | coerce.number.int.positive.optional() | 60（burst=20 常量，注释"多标签友好"） | T2 |
| COLLAB_AUTH_ATTEMPTS_PER_MIN | 同上 | 10 | T3 |
| COLLAB_AUTH_INFLIGHT_MAX | 同上 | 8 | T3 |
| COLLAB_REFUSAL_CACHE_TTL_MS | 同上 | 15000 | T3 |
| COLLAB_RSS_TRIP_BYTES | 同上 | 786432000（750MiB） | T4 |
| COLLAB_RSS_RELEASE_BYTES | 同上 | 629145600（600MiB） | T4 |
| COLLAB_HEAP_PRESSURE_RATIO | coerce.number.min(0.5).max(0.95).optional() | 0.8（release 比例=trip−0.1 迟滞带，常量块注释两阈值差异理由） | T4 |
| COLLAB_CONN_MAX_LIFETIME_MS | 同上 | 43_200_000（12h） | T6 |

---

### Task T0: shared 契约地基（词表+close-code+协议版本+兼容矩阵+ready reason 核对）

**Files:**
- Modify: `packages/shared/src/constants/collab-auth-reason.ts`（追加 5 值+终态表）
- Create: `packages/shared/src/constants/collab-close-code.ts`
- Create: `packages/shared/src/constants/collab-protocol.ts`
- Modify: `packages/shared/src/index.ts`（导出）
- Test: `packages/shared/src/constants/collab-auth-reason.test.ts`（扩）+新建 `collab-close-code.test.ts`/`collab-protocol.test.ts`
- 核对: `packages/shared/src/constants/collab-ready.ts`（ready reason 词表——spec §5.2"8 值补 not-serving/spool-unwritable tsc 封闭"）

- [ ] **Step 0: 探针**——读 collab-ready.ts 现值清单（若已含 not-serving/spool-unwritable 八值=登记"已备"零改动；缺则补）；读 index.ts 导出形态。输出粘 commit message。

- [ ] **Step 1: 红测——词表扩展+终态五档**

```ts
// collab-auth-reason.test.ts 追加
it('server-overloaded/rate-limited 是瞬态——严禁终态（误入=一次尖峰把客户端钉死且不自愈）', () => {
  expect(isTerminalReason(CollabAuthReason.SERVER_OVERLOADED)).toBe(false);
  expect(isTerminalReason(CollabAuthReason.RATE_LIMITED)).toBe(false);
});
it('版本族三档是终态（reload 档 UX 依赖 isTerminalReason 分流）', () => {
  for (const r of ['schema-outdated', 'client-version-missing', 'client-version-invalid']) {
    expect(isTerminalReason(r)).toBe(true);
  }
});
it('词表 append-only 全集=12 值（七旧+五新）', () => {
  expect(COLLAB_AUTH_REASONS).toHaveLength(12);
});
```

- [ ] **Step 2: 红跑**——`pnpm --filter shared test`（或仓内既有 test 命令，Step 0 探针确认）。预期 FAIL：`SERVER_OVERLOADED` 不存在。

- [ ] **Step 3: 实现**

```ts
// collab-auth-reason.ts 追加（词表末尾）
  SERVER_OVERLOADED: 'server-overloaded',
  SCHEMA_OUTDATED: 'schema-outdated',
  CLIENT_VERSION_MISSING: 'client-version-missing',
  CLIENT_VERSION_INVALID: 'client-version-invalid',
  RATE_LIMITED: 'rate-limited',
} as const;
// TERMINAL_AUTH_REASONS 追加三档：
    CollabAuthReason.SCHEMA_OUTDATED,
    CollabAuthReason.CLIENT_VERSION_MISSING,
    CollabAuthReason.CLIENT_VERSION_INVALID,
// Set 上方注释：SERVER_OVERLOADED/RATE_LIMITED 瞬态档严禁入终态（spec §3.2/§5.2——误入=一次内存尖峰/一次拥塞把全部客户端钉死且不自愈）
```

- [ ] **Step 4: 绿跑** ✓ 后 **commit**：`feat(y0b-3): T0 词表追加五值+isTerminalReason 五档终态（版本族 reload 档）`

- [ ] **Step 5: 新建 collab-close-code.ts（红测先行）**

```ts
// collab-close-code.test.ts
import { resolveCloseAction, CollabCloseCode } from './collab-close-code';
it('4401 双 reason 分型：库 Unauthorized=终态重登档 ≠ 应用 sweep session-expired=静默续期一次', () => {
  expect(resolveCloseAction(4401, 'session-expired').kind).toBe('silent-renew-once');
  expect(resolveCloseAction(4401, 'Unauthorized').kind).toBe('terminal');
});
it('4401 无 reason 按库默认语义=终态', () => {
  expect(resolveCloseAction(4401, undefined).kind).toBe('terminal');
});
it('1012=planned-restart（既有 30s 窗+短退避——runtime 链路收编进表）', () => {
  expect(resolveCloseAction(1012, '').kind).toBe('planned-restart');
});
it('4402 max-lifetime=正常重连非终态（寿命尽=重连新会话）', () => {
  expect(resolveCloseAction(4402, 'max-lifetime').kind).toBe('reconnect');
});
it('库自发瞬态族=4205/4408/1009 落 backoff 档（4205 无超限语义——客户端禁由它推断成因）', () => {
  for (const c of [4205, 4408, 1009]) expect(resolveCloseAction(c, '').kind).toBe('backoff');
});
it('1000=normal', () => {
  expect(resolveCloseAction(1000, '').kind).toBe('normal');
});
it('未知 code=backoff（fail-safe 重连）+diag 记录', () => {
  expect(resolveCloseAction(4999, '').kind).toBe('backoff');
});
```

```ts
// collab-close-code.ts
/** close code 全集分配表（spec §3.5）——应用侧与库自发侧单源；组件禁散落判 code（扫描锚）。
 * 库自发（@hocuspocus/common 4.6.0 实测）：4205 ResetConnection（通用重置码，pre-auth 队列超限等多处复用，
 * 本身不携带"超限"语义——配额提示必须配服务端计数指标）/4401 Unauthorized（reason 字面量 "Unauthorized"）/
 * 4403 Forbidden/4408 ConnectionTimeout/1009 MessageTooBig。
 * 应用侧：1012 计划内重启（既有）/4401 'session-expired'（sweep）/1000 team disbanded/
 * 4402 max-lifetime（本批新）——4404 doc-over-quota/4410 generation-superseded 为 Y0b-4/Y1c-1 预留值（注释钉死）。 */
export const CollabCloseCode = {
  NORMAL: 1000,
  APP_RESTART: 1012,
  MESSAGE_TOO_BIG: 1009,
  SESSION_EXPIRED: 4401,        // 应用 sweep（reason='session-expired'）与库 Unauthorized 同码异 reason——双键分型
  MAX_LIFETIME: 4402,
  LIB_RESET: 4205,
  LIB_FORBIDDEN: 4403,
  LIB_CONNECTION_TIMEOUT: 4408,
  // 预留（本批不产生，Y0b-4/Y1c-1 消费）：DOC_OVER_QUOTA: 4404, GENERATION_SUPERSEDED: 4410,
} as const;

export type CloseActionKind =
  | 'terminal'            // 终态：不重连（terminalReason 转四/五档 UX）
  | 'silent-renew-once'   // 4401 'session-expired'：静默重连一次，失败才终态
  | 'planned-restart'     // 1012：既有 30s 窗+1~3s 短退避链路（runtime :846-857 收编）
  | 'reconnect'           // 正常重连（4402/1000 之外的正常服务侧行为）
  | 'backoff';            // 瞬态退避（4205/4408/1009/未知——RECOVER_BACKOFF_MS 族）

export interface CloseAction { kind: CloseActionKind; terminalReason?: string }

export function resolveCloseAction(code: number, reason: string | undefined): CloseAction {
  // (code,reason) 双键分型（spec §5.2 v2.1）——只判 code 会把库 Unauthorized 当会话过期无限续期
  if (code === CollabCloseCode.SESSION_EXPIRED) {
    if (reason === 'session-expired') return { kind: 'silent-renew-once' };
    return { kind: 'terminal', terminalReason: 'session-expired' }; // 含库默认 'Unauthorized'/reason 缺失
  }
  if (code === CollabCloseCode.APP_RESTART) return { kind: 'planned-restart' };
  if (code === CollabCloseCode.MAX_LIFETIME) return { kind: 'reconnect' };
  if (code === CollabCloseCode.NORMAL) return { kind: 'normal' };
  return { kind: 'backoff' }; // 4205/4403/4408/1009/未知——全瞬态退避档
}
```

（4403 Forbidden 库自发——落 backoff：它出现在认证后权限撤销族，sweep/事件驱动会先踢，此处 fail-safe 重连后由 auth 面给出权威 reason。）

- [ ] **Step 6: 绿跑+commit**：`feat(y0b-3): T0 close code 分配表+(code,reason) 双键分型单源`

- [ ] **Step 7: 新建 collab-protocol.ts（两常量分离+兼容矩阵）**

```ts
// collab-protocol.test.ts
import { CLIENT_PROTOCOL_VERSION, PROTOCOL_COMPAT, negotiateClientVersion } from './collab-protocol';
it('csv 缺失/不可解析不进矩阵——分档在 negotiate 前置分支', () => {
  expect(negotiateClientVersion(null)).toBe('client-version-missing');
  expect(negotiateClientVersion('')).toBe('client-version-missing');
  expect(negotiateClientVersion('abc')).toBe('client-version-invalid');
  expect(negotiateClientVersion('1.5')).toBe('client-version-invalid');
});
it('精确相等——矩阵外一切版本值拒绝（开发期禁兼容层/区间协商，R 终裁）', () => {
  expect(negotiateClientVersion('1')).toBe('allow');
  expect(negotiateClientVersion('2')).toBe('schema-outdated');
  expect(negotiateClientVersion('0')).toBe('schema-outdated');
});
it('CLIENT_PROTOCOL_VERSION 与 docShape 的 CANVAS_DOC_SCHEMA_VERSION 是两个常量（csv≠doc 版本）', () => {
  expect(CLIENT_PROTOCOL_VERSION).not.toBe(2); // docShape:41=2 既有——csv 首版=1，显式分离
});
```

```ts
// collab-protocol.ts
/** 两常量分离（spec §3.4）：CANVAS_DOC_SCHEMA_VERSION（docShape.ts=2，既有——文档结构，Y1c bump）
 * ≠ CLIENT_PROTOCOL_VERSION（本文件——客户端代码/线路协议，URL ?csv= 所指）。
 * 通道=query（R-6 终裁：provider 无 query 配置项，URL 由调用方构造；csv/cb 非凭证，与 cookie-only 不矛盾）。
 * 4.6.0 onAuthenticatePayload.providerVersion 为库内部硬编码值（d.ts:483）——与本协议无关，禁用（P6 勘误）。 */
export const CLIENT_PROTOCOL_VERSION = 1 as const;
export type ClientProtocolVersion = typeof CLIENT_PROTOCOL_VERSION;

/** 兼容矩阵——tsc 封闭（Record 穷尽已发布版本）；只允许精确相等，无区间协商（开发期禁兼容层）。
 * 新版本发布=在矩阵加键+改 CLIENT_PROTOCOL_VERSION，两处同 commit。 */
export const PROTOCOL_COMPAT = {
  [CLIENT_PROTOCOL_VERSION]: 'allow',
} as const satisfies Record<number, 'allow'>;

export type VersionVerdict = 'allow' | 'client-version-missing' | 'client-version-invalid' | 'schema-outdated';

export function negotiateClientVersion(csv: string | null | undefined): VersionVerdict {
  if (!csv) return 'client-version-missing';
  const n = Number(csv);
  if (!Number.isInteger(n) || n <= 0 || String(n) !== csv.trim()) return 'client-version-invalid';
  return PROTOCOL_COMPAT[n as keyof typeof PROTOCOL_COMPAT] === 'allow' ? 'allow' : 'schema-outdated';
}
```

- [ ] **Step 8: index.ts 导出+全绿+commit**：`feat(y0b-3): T0 协议版本常量+兼容矩阵 tsc 封闭（csv≠doc 版本显式分离）`

---

### Task T1: 进程地基（env 九键+SWEEP 默认开+trust proxy loopback+unhandledRejection 兜底+库选项 pin）

**Files:**
- Modify: `apps/api/src/config/env.ts:65-81`（新键——§0.3 表 T2/T3/T4/T6 全部十个键本 Task 一次注册，消费点随后续 Task 落地；**键随读者同批防死键红**的 Y0b-2 教训适用单批内=本批读者在 T2-T6 全落地，非跨批死键）
- Modify: `apps/api/src/main.ts:87`+文件尾（trust proxy+兜底）
- Modify: `apps/api/src/modules/collab/collab.gateway.ts:207-232`（Server 构造 pin）
- Modify: `apps/api/src/modules/collab/store.metrics.ts`（collab_unhandled_rejection_total）
- Test: `apps/api/src/modules/collab/collab-gateway.options.spec.ts`（新建）+main 兜底测试（进程级——见 Step 5）

- [ ] **Step 0: 探针**——main.ts 是否已 import Sentry（兜底日志形态）；store.metrics register 导出形态；gateway spec 现有命名族（对齐 *.spec.ts 惯例）。输出粘 commit message。

- [ ] **Step 1: env.ts 注册**——按 §0.3 表十键插入 COLLAB 族块（形态=blankToUnset+optional；默认值注释指向消费 Task）。红测：env schema 解析测试（现有 env.spec 形态——Step 0 确认文件名）断言新键可解析+非法值拒。

- [ ] **Step 2: trust proxy 收口（P-I）**

```ts
// main.ts:87
app.set('trust proxy', 'loopback'); // P-I：与 WS 侧 X-Real-IP 同信任前提（E58 完整收口归 Y0.5；全信任=true 收敛为一跳 loopback）
```

跑 apps/api 全测——**@nestjs/throttler 相关测试若因 req.ip 语义变化变红**：逐个核对是「测试夹具直连无代理=peer 即 req.ip（不变）」还是夹具自带 XFF（后者=夹具随真实语义修，登记进 commit message）。

- [ ] **Step 3: unhandledRejection 全局兜底（P14 崩溃向量根修半——钩子函数化在 T10，兜底先行=同族未 await 钩子〔beforeBroadcastStateless esm:1498/onUpgrade :1633-1634〕全由此兜）**

```ts
// store.metrics.ts
export const collabUnhandledRejectionTotal = new Counter({
  name: 'collab_unhandled_rejection_total',
  help: '进程级 unhandledRejection 兜底计数（P14：库内未 await async 钩子 rethrow 的安全网——计数不退出）',
  labelNames: ['source'],
  registers: [register],
});
```

```ts
// main.ts bootstrap 尾部（listen 前）
process.on('unhandledRejection', (reason: unknown) => {
  try {
    collabUnhandledRejectionTotal.inc({ source: 'process' });
    // 结构化日志（logger 可用则用，兜底 console.error）+Sentry（已接线则 captureException）
  } catch { /* 兜底自身禁抛 */ }
});
```

红测（改前红：无监听=注入 promise rejection 后 process 抛 `ERR_UNHANDLED_REJECTION`——vitest worker 隔离下断言计数器恒 0；绿：计数+1 且事件循环存活）：

```ts
it('unhandledRejection 兜底：计数不退出（P14 安全网）', async () => {
  const before = await register.getSingleMetric('collab_unhandled_rejection_total')!.get();
  Promise.reject(new Error('probe'));
  await new Promise(r => setImmediate(r)); // 让微任务队列冲洗
  const after = await register.getSingleMetric('collab_unhandled_rejection_total')!.get();
  expect((after as any).values[0].value - (before as any).values?.[0]?.value ?? 0).toBeGreaterThanOrEqual(1);
});
```

（main bootstrap 副作用在测试进程的可达性——Step 0 探针：若 main.ts 不宜直接 import（bootstrap 即 listen），把 `process.on` 注册提为 `installUnhandledRejectionGuard()` 导出函数放 main.ts 顶部或独立 `apps/api/src/bootstrap/guard.ts`，main 调用+测试直接调用。按探针定，倾向后者。）

- [ ] **Step 4: Server 构造 pin+键集断言（§7.1/§7.2——行为断言 1009 归 Y0b-4 §4.1⑥，本 Task 落配置 pin+静态键集）**

```ts
// collab.gateway.ts Server 构造（:207-232 块内追加）
    websocketOptions: { maxPayload: 16 * 1024 * 1024 }, // §7.2 禁回落 ws 默认 100MiB；键集 ⊆ {maxPayload}（T1 断言）
    maxUnauthenticatedQueueMessages: 256, // §3.1bis 4 pre-auth 三 pin
    maxUnauthenticatedQueueSize: 1024 * 1024,
    maxPendingDocuments: 100,
```

```ts
// collab-gateway.options.spec.ts（新建）
it('pre-auth 库配置三 pin+maxPayload 显式在位（启动存在性断言——读回不可行，断言构造入参）', () => {
  const ctor = lastServerConstructorOptions(); // spy Server 构造（vi.mock '@hocuspocus/server' 抓入参——Step 0 探针 gateway spec 现有 mock 形态对齐）
  expect(ctor.websocketOptions).toEqual({ maxPayload: 16 * 1024 * 1024 });
  expect(ctor.maxUnauthenticatedQueueMessages).toBe(256);
  expect(ctor.maxUnauthenticatedQueueSize).toBe(1024 * 1024);
  expect(ctor.maxPendingDocuments).toBe(100);
});
it('websocketOptions 键集 ⊆ {maxPayload}（防未来塞 noServer/handleProtocols 覆盖 crossws 强制项砸 upgrade 路径）', () => {
  const ctor = lastServerConstructorOptions();
  expect(Object.keys(ctor.websocketOptions ?? {}).every(k => k === 'maxPayload')).toBe(true);
});
```

- [ ] **Step 5: SWEEP 默认开翻转（P-H）**

```ts
// gateway:1139
if (process.env.COLLAB_SWEEP_ENABLED === 'false') return; // 默认开（spec §3.1）；'false'=env 逃生阀（§4.2 回滚表）
```

红测：不设 env→startSessionSweep 注册 timer（现有 sweep spec 夹具改默认态断言——Step 0 探针 sweep spec 现有形态）。

- [ ] **Step 6: 全绿+commit**：`feat(y0b-3): T1 env 十键+trust proxy loopback+unhandledRejection 兜底+库四 pin+sweep 默认开`

---

### Task T2: upgrade 面（cookie-only+Origin 403+升级限流+address 默认翻转）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（:219 address/:249-250 token/onUpgrade 钩子+clientIpOf+upgradeBucket+allowedOrigins）
- Modify: `apps/api/src/modules/collab/store.metrics.ts`（collab_upgrade_rejected_total）
- Test: `apps/api/src/modules/collab/collab-upgrade.spec.ts`（新建——collab-core 真连装置复用，Step 0 探针 ws-polyfill/behavior-anchors 装置形态）

- [ ] **Step 0: 探针**——collab-core 真连装置（behavior-anchors/ws-polyfill spec）如何起 gateway+连 WS（Origin header 可否随 new WebSocket(url, {headers}) 注入——Node ws 构造支持 headers 选项）；parseSessionToken import 位置。输出粘 commit message。

- [ ] **Step 1: 红测①——Origin 拒=握手失败锚（§3.1ter v2.2 形态）**

```ts
it('伪造 Origin→握手失败（socket 403+destroy）+计数（改前红：无 onUpgrade 钩子=握手成功）', async () => {
  await startGatewayForTest(); // 装置既有
  await expect(connectWs({ headers: { origin: 'https://evil.example' } })).rejects.toThrow(); // 握手被拒
  expect(await metricValue('collab_upgrade_rejected_total', { reason: 'origin' })).toBe(1);
});
it('合法 Origin（BETTER_AUTH_URL 推导表）→握手成功', async () => {
  await expect(connectWs({ headers: { origin: 'http://localhost:5173' } })).resolves.toBeDefined();
});
it('Origin 缺失=拒（非浏览器工具注入不了也就不需要它）', async () => {
  await expect(connectWs({ headers: {} })).rejects.toThrow();
  expect(await metricValue('collab_upgrade_rejected_total', { reason: 'origin' })).toBe(1);
});
```

- [ ] **Step 2: 红跑**——预期 FAIL（无钩子=伪造 Origin 握手成功）。

- [ ] **Step 3: 实现 onUpgrade（P-G 形态——hook throw=库 async 监听器内未处理 rejection 形同虚设〔esm:1623-1636 实证〕，必须 socket 直写+destroy）**

```ts
// hooks 块追加（类型声明块 :173-180 同步扩）
onUpgrade: ({ request, socket }: onUpgradePayload) => {
  // 全函数化：钩子自身炸不能阻断升级面（fail-open）
  try {
    const origin = request.headers.origin;
    if (!origin || !this.allowedOrigins().includes(origin)) {
      this.upgradeRejectedTotal.inc({ reason: 'origin' });
      socket?.write?.('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket?.destroy?.();
      return;
    }
    const ip = this.clientIpOf(request, socket);
    if (!this.upgradeBucket.consume(ip)) {
      this.upgradeRejectedTotal.inc({ reason: 'rate-limited' });
      socket?.write?.('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      socket?.destroy?.();
    }
  } catch { /* fail-open */ }
},
```

```ts
// gateway 私有成员（env 读法对齐 env.ts 单源——经 ConfigService 或 process.env 直读，Step 0 探针现有 COLLAB_* 读法对齐）
private allowedOrigins(): string[] {
  const raw = process.env.COLLAB_ALLOWED_ORIGINS;
  if (raw) return raw.split(',').map(s => s.trim()).filter(Boolean);
  const base = process.env.BETTER_AUTH_URL ?? 'http://localhost:5173';
  const origins = [new URL(base).origin];
  if (!origins.includes('http://localhost:5173')) origins.push('http://localhost:5173'); // dev 默认
  return origins;
}
private trustedProxyEnabled(): boolean { return process.env.COLLAB_TRUSTED_PROXY === '1'; }
clientIpOf(request: { headers: Record<string, unknown> }, socket: { remoteAddress?: string }): string {
  // X-Real-IP 仅 socket peer 为 loopback 时信任（绑定 127.0.0.1+nginx 同机使前提成立；nginx conf :14 已设）+COLLAB_TRUSTED_PROXY 门控（P-I）
  const peer = socket?.remoteAddress ?? '';
  const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  if (loopback && this.trustedProxyEnabled()) {
    const xri = request.headers['x-real-ip'];
    if (typeof xri === 'string' && xri) return xri;
  }
  return peer || 'unknown';
}
// upgradeBucket=内存 token bucket（60/min 补充+burst 20 容量；DoS 兜底非配额——注释钉死；重启清零；Map 上界 10_000 清最旧防无界）
```

（token bucket 实现体 ~20 行：`Map<string, {tokens: number; last: number}>`，consume=按 elapsed 补充后扣减；独立文件 `apps/api/src/modules/collab/token-bucket.ts` 便于单测。）

- [ ] **Step 4: 红测②——升级限流**

```ts
it('同 IP 超 60/min+burst 20→429+计数；异 IP 互不影响（X-Real-IP 仅 loopback 信任）', () => {
  const bucket = new TokenBucket({ capacity: 20, refillPerMin: 60 });
  for (let i = 0; i < 20; i++) expect(bucket.consume('a')).toBe(true);
  expect(bucket.consume('a')).toBe(false);
  expect(bucket.consume('b')).toBe(true);
});
it('信任门控：COLLAB_TRUSTED_PROXY 未设→peer 恒 127.0.0.1（限流全站单桶=生产必须设 env——部署告知项）', () => {
  expect(gw.clientIpOf({ headers: { 'x-real-ip': '1.2.3.4' } }, { remoteAddress: '127.0.0.1' })).toBe('127.0.0.1');
  process.env.COLLAB_TRUSTED_PROXY = '1';
  expect(gw.clientIpOf({ headers: { 'x-real-ip': '1.2.3.4' } }, { remoteAddress: '127.0.0.1' })).toBe('1.2.3.4');
  delete process.env.COLLAB_TRUSTED_PROXY;
});
```

- [ ] **Step 5: 红测③+实现——cookie-only（:249-250）**

```ts
it('伪造 query token+无 cookie→UNAUTHENTICATED 拒（改前红：query 优先=放行）', async () => {
  const denial = await authViaQueryTokenOnly('forged-token');
  expect(denial).toBe('unauthenticated');
});
```

```ts
// :249-250 改
const token = parseSessionToken(requestHeaders?.get('cookie')); // cookie-only（§1.3 对象 4）——query token 通道删除（access_log off 止血转纵深）
```

- [ ] **Step 6: address 默认翻转**

```ts
// :219
address: process.env.COLLAB_BIND_ADDR ?? '127.0.0.1', // 默认收口（ecosystem:27 已注入同值——默认值翻转对齐；对外暴露必须显式 COLLAB_BIND_ADDR）
```

- [ ] **Step 7: 全绿+census `requestParameters?.get\('token'\)` gateway 清零+commit**：`feat(y0b-3): T2 Origin 403 socket 直写+升级限流+cookie-only+绑定默认翻转`

---

### Task T3: 认证防线（refusalCache+全局信号量+per-socket 桶+执行序骨架+auth_reject 单点计数）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（authenticate 拆外层/内层+三个新成员+deny 单点计数）
- Modify: `apps/api/src/modules/collab/store.metrics.ts`（collab_auth_reject_total/collab_auth_inflight）
- Test: `apps/api/src/modules/collab/collab-auth-defense.spec.ts`（新建）

**结构（P-F，写进实现注释）：** `authenticate()`=外层防线壳（桶→信号量→`try { inner } finally`）；`authenticateInner()`=原方法体改名（token→状态检查→DB）。**桶/信号量的 throw 不经过写缓存的 catch**（spec §3.1bis 1"信号量溢出与桶超限的拒绝不入缓存——瞬时拥塞≠状态故障"）；inner 的 throw 进外层 catch→`reason ∈ REFUSAL_CACHEABLE`（draining/lease-not-ready/db-unavailable/server-overloaded 四类）→写 cache。heap 闸（T4）与版本门（T5）插入 inner 内（状态类/廉价前置），落在缓存白名单语义内。

- [ ] **Step 0: 探针**——现有 collab spec 如何 mock prisma（装置族 spy 形态）；Connection 生命周期测试怎么构造 onAuthenticatePayload（现有 authenticate 单测形态）。输出粘 commit message。

- [ ] **Step 1: 红测——验收锚①（§3.1bis 验收锚 v2.2 输出级）**

```ts
it('同一 socket 连续 N 次被拒 Auth（db-unavailable）→prisma 调用计数不随 N 增长（refusalCache+桶生效硬证据）', async () => {
  const prismaCalls = spyPrismaCallCount(); // 装置既有 mock 形态
  for (let i = 0; i < 10; i++) {
    await expect(gw.authenticate(makeAuthPayload({ token: 't-disabled' }))).rejects.toMatchObject({ reason: 'db-unavailable' });
  }
  // 首次后进 refusalCache（15s TTL 内）：后续 9 次零 DB——prisma 计数只随首次+1 或不变（touchWithReason mock 直接 throw db）
  expect(prismaCalls.delta()).toBeLessThanOrEqual(1);
});
it('refusalCache 白名单外不入：UNAUTHENTICATED 重复→每次都走完整路径（缓存恒空）', async () => {
  for (let i = 0; i < 5; i++) {
    await expect(gw.authenticate(makeAuthPayload({}))).rejects.toMatchObject({ reason: 'unauthenticated' });
  }
  expect(gw['refusalCache'].size).toBe(0);
});
it('桶超限 deny rate-limited 且不写缓存（第 11 次/分钟）', async () => {
  for (let i = 0; i < 10; i++) await expect(gw.authenticate(makeAuthPayload({ socketId: 's1' }))).rejects.toBeTruthy();
  await expect(gw.authenticate(makeAuthPayload({ socketId: 's1' }))).rejects.toMatchObject({ reason: 'rate-limited' });
  expect(gw['refusalCache'].size).toBe(0);
});
it('信号量满→SERVER_OVERLOADED deny+并发峰值≤INFLIGHT_MAX（验收锚②——collab_auth_inflight gauge）', async () => {
  gateDbCalls(); // 装置：挂起 inner 的 DB 步骤直至放行
  const inflight: number[] = [];
  const burst = Array.from({ length: 16 }, () =>
    gw.authenticate(makeAuthPayload({ socketId: `s${Math.random()}` })).catch(() => 0)
      .then(() => inflight.push(gw['authInflightPeak']()))); // 峰值经 gauge 读
  await Promise.all(burst);
  expect(Math.max(...inflight)).toBeLessThanOrEqual(8);
  releaseDbCalls();
  // 第 9 个并发请求被拒：SERVER_OVERLOADED
});
it('drain 解除清空 refusalCache（四钩子①——表驱动：drain/lease/heap/spool 四态翻转各一用例）', () => {
  gw['refusalCache'].set('doc|t:abc', { reason: 'draining', at: Date.now() });
  gw.onDrainReleased(); // 钩子①
  expect(gw['refusalCache'].size).toBe(0);
  // ②onLeaseRejoined ③onHeapReleased（T4 接）④onSpoolRecovered 同形态——T4 前先落①②+spool 翻转点，heap 释放钩子 T4 同 commit 接线（锚用例表驱动扩）
});
```

- [ ] **Step 2: 红跑**——预期 FAIL（无防线=N 次 prisma 全调/无 rate-limited reason/无 gauge）。

- [ ] **Step 3: 实现**

```ts
// gateway 成员
private readonly refusalCache = new Map<string, { reason: CollabAuthReasonCode; at: number }>();
private authInflight = 0;
private authInflightPeak = 0;
private readonly authAttemptBuckets = new Map<string, { count: number; windowStart: number }>();
private static readonly REFUSAL_CACHEABLE = new Set<string>([
  CollabAuthReason.DRAINING, CollabAuthReason.LEASE_NOT_READY,
  CollabAuthReason.DB_UNAVAILABLE, CollabAuthReason.SERVER_OVERLOADED,
]); // §3.1bis 白名单精确四类（terminal 不入=客户端已 disconnect；信号量溢出/桶超限不经此——P-F 结构分离）

private refusalTtlMs(): number { return numEnv('COLLAB_REFUSAL_CACHE_TTL_MS', 15_000); }
private authAttemptsPerMin(): number { return numEnv('COLLAB_AUTH_ATTEMPTS_PER_MIN', 10); }
private authInflightMax(): number { return numEnv('COLLAB_AUTH_INFLIGHT_MAX', 8); }

private clearRefusalCacheOnStateChange() { this.refusalCache.clear(); } // 四钩子共点：drain 解除/租约 rejoin/heap 释放（T4）/spool 恢复（P-E）
onDrainReleased() { /* drain 60s 自动解除处（:667 附近）调用 */ this.clearRefusalCacheOnStateChange(); }

private async authenticate(payload: onAuthenticatePayload): Promise<...> {
  // —— 外层防线（§3.1bis 执行序：refusalCache → 信号量 → 桶 → heap〔T4〕→ 版本门〔T5〕→ DB）——
  const fingerprint = payload.token && payload.token !== 'cookie-auth'
    ? `t:${sha256Hex(payload.token).slice(0, 16)}` : 'anon';
  const cacheKey = `${payload.documentName}|${fingerprint}`;
  const cached = this.refusalCache.get(cacheKey);
  if (cached && Date.now() - cached.at < this.refusalTtlMs()) {
    this.authRejectTotal.inc({ reason: cached.reason });
    throw Object.assign(new Error(`refusal cached: ${cached.reason}`), { reason: cached.reason });
  }
  // per-socket 认证尝试桶（键=payload.socketId d.ts:480；计数在 onAuthenticate 顶部——§3.1bis 3）
  const bucket = this.authAttemptBuckets.get(payload.socketId) ?? { count: 0, windowStart: Date.now() };
  if (Date.now() - bucket.windowStart >= 60_000) { bucket.count = 0; bucket.windowStart = Date.now(); }
  bucket.count += 1; this.authAttemptBuckets.set(payload.socketId, bucket);
  if (bucket.count > this.authAttemptsPerMin()) {
    this.authRejectTotal.inc({ reason: CollabAuthReason.RATE_LIMITED });
    throw Object.assign(new Error('auth attempts exceeded'), { reason: CollabAuthReason.RATE_LIMITED });
    // 断连由库 30s 超时自然完成（P4：死于 30-60s 首 tick+timeout）——不主动 close
  }
  // 全局并发认证信号量（唯一不依赖库内部结构的乘积闸）
  if (this.authInflight >= this.authInflightMax()) {
    this.authRejectTotal.inc({ reason: CollabAuthReason.SERVER_OVERLOADED });
    throw Object.assign(new Error('auth inflight limit'), { reason: CollabAuthReason.SERVER_OVERLOADED });
  }
  this.authInflight += 1;
  this.authInflightPeak = Math.max(this.authInflightPeak, this.authInflight);
  try {
    return await this.authenticateInner(payload);
  } catch (err: any) {
    const reason = err?.reason as CollabAuthReasonCode | undefined;
    if (reason && CollabGateway.REFUSAL_CACHEABLE.has(reason)) {
      this.refusalCache.set(cacheKey, { reason, at: Date.now() }); // TTL 15s 绝对过期不续期
    }
    throw err;
  } finally {
    this.authInflight -= 1;
  }
}
// 原 :246-295 方法体整体改名 authenticateInner（内容本 Task 不动——deny 工厂埋点除外）
```

（deny 工厂 :247 埋 `this.authRejectTotal.inc({ reason })`——`collab_auth_reject_total{reason}` deny 单点计数〔§3.1〕；SHA 摘要用 node:crypto 单行 helper——仓内既有 sha 工具探针复用，无则 `createHash('sha256')` 内联。桶条目清理=onDisconnect 钩子按 socketId 删。）

- [ ] **Step 4: 绿跑+commit**：`feat(y0b-3): T3 认证防线四层之前三层（refusalCache 15s/信号量 8/per-socket 桶 10pm）+执行序骨架+auth_reject 单点`

（验收锚③"超限 socket ≤61s 消失"=库 connectionChecker 行为，属 int/真连验证——归 T11 出口演练登记：装置真连+65s 观察断连；单元级以"桶满后第 11 次 Auth 立即 deny rate-limited 零 DB"为判据，§0.4 登记口径。）

---

### Task T4: heap 压力自保闸（谓词单源+双点落点+reaper 释放路径+check-ecosystem 区间链）

**Files:**
- Create: `apps/api/src/modules/collab/heap-pressure.ts`（谓词单源 util——禁第二套）
- Create: `apps/api/src/modules/collab/token-bucket.ts` 若 T2 未拆（T2 已建则跳过）
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（authenticateInner 插入点+loadDocument :312 前插入+5min reaper+onStoreDocument catch 计数+spool 恢复钩子接 refusalCache 清空）
- Modify: `apps/api/src/modules/collab/collab-document.service.ts`（withDoc 物化入口 503——Step 0 探针 withDoc 形态后定插入行）
- Modify: `scripts/check-ecosystem.mjs`（区间断言链）
- Modify: `apps/api/src/modules/collab/store.metrics.ts`（四指标）
- Test: `apps/api/src/modules/collab/heap-pressure.spec.ts`+`collab-heap-gate.spec.ts`（新建）

- [ ] **Step 0: 探针**——onStoreDocument 现 catch 形态（collab_doc_store_failed_total 埋点处）；spool 服务"未 confirm 帧"查询 API（canSafelyUnload 前置谓词④）；in-flight store 集合现名（勘察报 storeInFlightDocs gauge 源）；withDoc 入口首行形态；check-ecosystem.mjs regex 提取先例（node_args :53）。输出粘 commit message。

- [ ] **Step 1: 红测——谓词与迟滞**

```ts
// heap-pressure.spec.ts
import { resetHeapPressure, measureHeapPressure, stubHeapMeasure } from './heap-pressure';
it('V8 比例管 GC 螺旋、RSS 项管原生膨胀——两项各管一种死法，max 取大者（量纲不混：RSS 已含 external，V8 比例禁再并 arrayBuffers）', () => {
  stubHeapMeasure({ heapUsed: 0.9 * 1e9, heapLimit: 1e9, rss: 100 * 1024 * 1024 });
  expect(measureHeapPressure().ratio).toBeCloseTo(0.9); // heap 项主导
  stubHeapMeasure({ heapUsed: 0.1 * 1e9, heapLimit: 1e9, rss: 800 * 1024 * 1024 }); // trip=750MiB
  expect(measureHeapPressure().ratio).toBeGreaterThan(1); // rss 项主导
});
it('迟滞：>0.8 连续 2 采样才 trip；中间带维持；<0.7 单次释放（两阈值差异=迟滞防抖动，常量块注明）', () => {
  resetHeapPressure();
  stubHeapMeasure({ heapUsed: 0.85e9, heapLimit: 1e9 }); // ratio 0.85
  expect(measureHeapPressure().tripped).toBe(false); // 第 1 采样未 trip
  expect(measureHeapPressure().tripped).toBe(true);  // 第 2 连续采样 trip
  stubHeapMeasure({ heapUsed: 0.75e9, heapLimit: 1e9 }); // 迟滞带
  expect(measureHeapPressure().tripped).toBe(true);  // 维持
  stubHeapMeasure({ heapUsed: 0.6e9, heapLimit: 1e9 });
  expect(measureHeapPressure().tripped).toBe(false); // 释放（<0.7=trip−0.1）
});
it('fail-open：测量抛错/返回 0→放行（指标失败不得全站拒连）', () => {
  stubHeapMeasure(null); // 模拟抛错
  expect(measureHeapPressure().tripped).toBe(false);
});
it('释放回调触发（reaper/onHeapReleased 钩子③接 refusalCache 清空——表驱动用例）', () => { /* T3 表驱动扩展形态 */ });
```

- [ ] **Step 2: 实现 heap-pressure.ts**

```ts
import { getHeapStatistics } from 'node:v8';
/** heap 压力谓词——单源 util，禁第二套（spec §3.2）。
 * 两项各管一种死法互不重叠：heapUsed/heap_size_limit 管 GC 螺旋（纯 V8 口径）；
 * rss/TRIP_BYTES 管原生内存膨胀（RSS 已含 external/arrayBuffers——再并入 V8 比例=重复计数+量纲错位）。
 * trip=2 连续采样 >TRIP_RATIO（0.8）；release=单次 <TRIP_RATIO−0.1（0.7）——迟滞带防抖动。
 * 默认值标定（v2.3 实测基线 138.8MB）：release 600MiB=基线×安全倍率 ∧ trip 750MiB=杀线−缓解预算；
 * 单调链 baseline×4 < release < trip < max_memory_restart(1G)−200MiB 由 check-ecosystem 断言。 */
export const DEFAULT_RSS_TRIP_BYTES = 786_432_000;   // 750MiB
export const DEFAULT_RSS_RELEASE_BYTES = 629_145_600; // 600MiB（§9.15 人工评估线同值——人先看见机器后动手）
export interface HeapPressureSample { tripped: boolean; ratio: number; rssBytes: number; heapUsedBytes: number; heapLimitBytes: number }
// 模块级迟滞状态 + resetHeapPressure()（测试用）+ stubHeapMeasure()（测试注入——prod 走 process.memoryUsage/getHeapStatistics）
export function measureHeapPressure(now?: number): HeapPressureSample { /* try/catch 包裹，异常→{tripped:false,ratio:0,...} fail-open */ }
export function releaseHook(): (() => void) | undefined { /* tripped→false 翻转时返回一次性回调（gateway 接清 refusalCache+gauge） */ }
```

（实现细节：trip/release 阈值经参数或 env 读取函数注入——env 读放 gateway 侧包装，util 收纯数值参数保持可测；stub 机制=模块级可替换 measure 函数引用，仅测试 import。）

- [ ] **Step 3: 红测——双点落点+已加载豁免（最易写错）**

```ts
// collab-heap-gate.spec.ts
it('①tripped→新 doc 连接拒+auth_reject{server-overloaded}+load_rejected 双计数+瞬态档（isTerminalReason=false）', async () => {
  stubHeap({ tripped: true });
  await expect(gw.authenticate(makeAuthPayload({ documentName: 'project:new-doc' })))
    .rejects.toMatchObject({ reason: 'server-overloaded' });
  expect(await metricValue('collab_load_rejected_total', { reason: 'server-overloaded' })).toBe(1);
});
it('②同压力下已加载 doc 重连不被拒（!documents.has 防自伤——压力期放行存量编辑）', async () => {
  stubHeap({ tripped: true });
  markDocResident('project:resident'); // server.hocuspocus.documents.set 形态（装置）
  await expect(gw.authenticate(makeAuthPayload({ documentName: 'project:resident' }))).resolves.toBeDefined();
});
it('③谓词抛错→放行（fail-open 落点级）', async () => {
  stubHeap(new Error('probe'));
  await expect(gw.authenticate(makeAuthPayload({ documentName: 'project:x' }))).resolves.toBeDefined();
});
it('④释放路径：store 失败+零连接 doc 永驻（红）→reaper 5min 前置谓词→卸载+stuck/reaped 计数+压力回落可再装载', async () => {
  vi.useFakeTimers();
  stubStoreFailure('project:doomed'); // onStoreDocument throw
  await loadThenDisconnect('project:doomed'); // 装载后断连——现实现：库保内存永不卸载
  stubHeap({ tripped: true });
  expect(gw.server.hocuspocus.documents.has('project:doomed')).toBe(true); // 红：永驻
  await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000);
  expect(gw.server.hocuspocus.documents.has('project:doomed')).toBe(false);
  expect(await metricValue('yjs_doc_reaped_total')).toBe(1);
  stubHeap({ tripped: false });
  await expect(gw.authenticate(makeAuthPayload({ documentName: 'project:doomed' }))).resolves.toBeDefined(); // 再装载成功
});
it('前置谓词不满足→跳过+yjs_doc_stuck_total（stuck 非零=真问题该告警，而非被 reaper 掩盖）', async () => {
  vi.useFakeTimers();
  await loadThenDisconnect('project:queued'); // pendingQueue 有帧
  enqueuePending('project:queued', new Uint8Array([1]));
  await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000);
  expect(gw.server.hocuspocus.documents.has('project:queued')).toBe(true);
  expect(await metricValue('yjs_doc_stuck_total')).toBe(1);
});
```

- [ ] **Step 4: 实现 gateway 落点**

```ts
// authenticateInner 顶部（token 提取后、:255 draining 检查前——§3.1bis 序：桶/信号量（外层）→heap→DB；
// "压力期被拒重连不得打 DB"+"仅拒新物化"）
if (!this.server.hocuspocus.documents.has(documentName) && measureHeapPressure().tripped) {
  this.authRejectTotal.inc({ reason: CollabAuthReason.SERVER_OVERLOADED }); // P-B 双计数（auth 面）
  this.loadRejectedTotal.inc({ reason: 'server-overloaded' });
  this.logOverpressureSampled(); // 四数采样日志（rss/heapUsed/heap_size_limit/external+arrayBuffers）——禁每拒一条 ERROR
  throw Object.assign(new Error('server overloaded'), { reason: CollabAuthReason.SERVER_OVERLOADED });
}
// loadDocument（onLoadDocument :311 方法体首行——三入口汇聚点〔WS/DirectConnection/REST withDoc〕Y0a-3 先例）
if (!this.server.hocuspocus.documents.has(documentName) && measureHeapPressure().tripped) {
  this.loadRejectedTotal.inc({ reason: 'server-overloaded' });
  throw Object.assign(new Error('server overloaded'), { reason: CollabAuthReason.SERVER_OVERLOADED });
}
```

```ts
// REST 物化入口（collab-document.service.ts withDoc 首行——Step 0 探针后钉行号）：同源命中→503 SERVER_OVERLOADED（并入 503 语义化）
if (heapPressureTrippedForNew(projectId)) throw new ServiceUnavailableException({ code: 'SERVER_OVERLOADED', retryAfter: 15 });
```

```ts
// 5min reaper（startSessionSweep 同族：listenCollab 注册、clear-first 幂等、关停注销）
private startHeapReaper() {
  this.heapReaperTimer = setInterval(() => void this.reapIdleDocs(), 5 * 60_000);
  this.heapReaperTimer.unref?.();
}
private async reapIdleDocs() {
  for (const [name, doc] of this.server.hocuspocus.documents) {
    if (doc.connections.size > 0 || doc.isLoading) continue; // 候选=零连接&&!isLoading（活跃连接在=shouldUnloadDocument 拒绝不卸——reaper≠驱逐，两不矛盾）
    if (!(await this.canSafelyUnload(name))) { this.docStuckTotal.inc(); continue; } // §3.1ter 前置谓词
    try {
      await this.server.unloadDocument(name); // 幂等：库自带 shouldUnloadDocument 三守卫（esm:1571-1573）
      this.docReapedTotal.inc();
    } catch { /* 计数已由 store 失败指标承担 */ }
  }
}
private async canSafelyUnload(name: string): Promise<boolean> {
  // 前置谓词（§3.1ter）：零连接 ✓ && !isLoading ✓ && pendingQueue 空 && 无在飞 store && spool 无未 confirm 帧
  // ——库 store 失败"保内存"是有意数据保全，reaper 打破它前必须确认屋里没人
  if ((this.pendingQueues.get(name)?.length ?? 0) > 0) return false;
  if (this.isStoreInFlight(name)) return false;      // Step 0 探针现名
  if (await this.spool.hasUnconfirmed?.(name)) return false; // Step 0 探针 API 名
  return true;
}
```

（onStoreDocument catch 处 `collab_doc_store_failed_total.inc()`；heap tripped→released 翻转钩子③接 `clearRefusalCacheOnStateChange()`+`collab_overload_state` gauge 翻转+P-B 口径注释。）

- [ ] **Step 5: check-ecosystem 区间断言链**

```js
// check-ecosystem.mjs :61 后插入（v2.4 口径——trip=750∉旧 (896,1024) 开区间，照旧锚实施必红）
const RSS_BASELINE_BYTES = 145_000_000; // server-profile F1 实测 138.8MB（加载演练后实测重标——§3.2 注）
const defaults = extractHeapDefaults(); // regex 提取 heap-pressure.ts 的 DEFAULT_RSS_TRIP_BYTES/DEFAULT_RSS_RELEASE_BYTES 字面量（先例：:53 node_args regex）
const release = defaults.release, trip = defaults.trip;
if (!(RSS_BASELINE_BYTES * 4 < release)) fail('heap release 必须大于 baseline×4（当前 release 无法覆盖基线膨胀）');
if (!(release < trip)) fail('heap release 必须小于 trip（迟滞方向）');
if (!(trip < rss - 200 * 1024 * 1024)) fail('heap trip 必须小于 max_memory_restart−200MiB（缓解时延预算）');
// 既有 :57（rss ≥ old-space+384MB=896MB 断言）保留原用途=杀线相对 V8 cap 足够宽——两件事禁互相引用
```

- [ ] **Step 6: 绿跑（红相留档——④释放路径改前红粘 commit）+commit**：`feat(y0b-3): T4 heap 压力闸（RSS/V8 双量纲+迟滞+fail-open+仅拒新物化）+5min reaper 前置谓词+check-ecosystem 区间链`

---

### Task T5: 版本门（服务端三档拒+csv/cb query 通道+__CLIENT_BUILD__+collabUrl 单次）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（authenticateInner 插入版本门——heap 闸后 DB 前）
- Modify: `apps/api/src/modules/collab/collab-ready.service.ts`（ready 响应增 collabProtocolVersion——P-C loop 键载体）
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts:867-884`（collabUrl 单次+版本参数）
- Modify: `apps/web/vite.config.ts`+`apps/web/src/env.d.ts`（__CLIENT_BUILD__）
- Modify: `deploy/deploy.sh` 或 `scripts/`（access_log off 断言——Step 0 探针部署校验链形态）
- Test: `apps/api/src/modules/collab/collab-version-gate.spec.ts`（新建）+web 侧 collabUrl 测试（现有 runtime spec 扩）

- [ ] **Step 0: 探针**——ready service 响应组装形态（增字段位）；deploy.sh preflight/verify 链现结构（check-nginx-budget.mjs 挂载点——断言并入它或 deploy.sh 步骤）；vite.config define 现有项。输出粘 commit message。

- [ ] **Step 1: 红测——三档拒+计数+精确相等**

```ts
it('缺 csv→CLIENT_VERSION_MISSING（D12 缺参档——旧 bundle 不带参数同拒；最廉价检查在 DB 前）', async () => {
  await expect(gw.authenticate(makeAuthPayload({ query: '' }))).rejects.toMatchObject({ reason: 'client-version-missing' });
  expect(await metricValue('collab_version_negotiation_reject_total', { reason: 'client-version-missing' })).toBe(1);
});
it('csv 不可解析→CLIENT_VERSION_INVALID（"abc"/"1.5"/"0"/负数）', async () => { /* 同形态 */ });
it('csv 可解析但不匹配→SCHEMA_OUTDATED（精确相等——区间协商=兼容层，R 终裁驳回）', async () => {
  await expect(gw.authenticate(makeAuthPayload({ query: 'csv=999' }))).rejects.toMatchObject({ reason: 'schema-outdated' });
});
it('csv=1（当前）→放行进 DB 环节（版本门不是 DB 拦截）', async () => {
  await expect(gw.authenticate(makeAuthPayload({ query: 'csv=1&cb=dev' }))).resolves.toBeDefined();
});
it('版本门在 heap 闸之后 DB 之前（执行序——stub heap tripped+无 csv→server-overloaded 先于 version 档）', async () => {
  stubHeap({ tripped: true });
  await expect(gw.authenticate(makeAuthPayload({ query: '' }))).rejects.toMatchObject({ reason: 'server-overloaded' });
});
```

- [ ] **Step 2: 实现 gateway**

```ts
// authenticateInner——heap 闸后、touchWithReason 之前
const verdict = negotiateClientVersion(requestParameters?.get('csv') ?? null);
if (verdict !== 'allow') {
  const reason = verdict === 'client-version-missing' ? CollabAuthReason.CLIENT_VERSION_MISSING
    : verdict === 'client-version-invalid' ? CollabAuthReason.CLIENT_VERSION_INVALID
    : CollabAuthReason.SCHEMA_OUTDATED;
  this.versionRejectTotal.inc({ reason });
  throw Object.assign(new Error(`client protocol ${verdict}`), { reason });
}
// cb（client build）=审计透传通道：本批服务端不消费（遥测 clientBuild 预留=Y0b-5 §5.6）——URL 带上即通道建立
```

- [ ] **Step 3: ready 增字段（P-C）**——`collab-ready.service.ts` 响应体增 `collabProtocolVersion: CLIENT_PROTOCOL_VERSION`（PUBLIC 端点——客户端版本终态时单次探测拿服务端版本作 loop 键；**非轮询**，§5.4 边角单次探测同族）。红测：GET /api/ready 响应含该字段。

- [ ] **Step 4: 客户端通道**

```ts
// vite.config.ts
define: { __CLIENT_BUILD__: JSON.stringify(process.env.GIT_SHA ? `${process.env.GIT_SHA}@${Date.now()}` : 'dev') },
// env.d.ts：declare const __CLIENT_BUILD__: string;
```

```ts
// canvasCollabRuntime.ts createProvider（:867-884）——collabUrl() 只算一次（v1 两处调用不一致风险）
const base = collabUrl();
const sep = base.includes('?') ? '&' : '?';
const url = `${base}${sep}csv=${CLIENT_PROTOCOL_VERSION}&cb=${__CLIENT_BUILD__}`;
const { WebSocketClass, handle } = createReconnectingWebSocket(url);
provider = new HocuspocusProvider({ url, /* ...原参数不动 */ });
```

红测（web 单测）：provider 构造 URL 恰含 `csv=1&cb=`；transport 与 provider 同一 URL 字符串（spy 断言两参相等——单次构造证据）。

- [ ] **Step 5: access_log off 断言锚（R-6）**——`nginx -T` 输出断言 /collab 段含 `access_log off`：并入 `scripts/check-nginx-budget.mjs`（Y0b-2 先例——deploy 侧 verify 链已挂载；本断言在服务器上下文执行=deploy.sh 校验步骤；本地 verify 跳过条件同该脚本现约定）。红测：stub nginx -T 输出（无 access_log off 的 /collab 段）→脚本 exit 1。

- [ ] **Step 5bis: video-work 缓存键核对（spec §3.4——只读核对零改动）**——video-work process 缓存键（:34 已拼 doc 版本）拼的是 `CANVAS_DOC_SCHEMA_VERSION`（doc 版本）而非 csv：确认键成分维持 doc 版本（缓存失效语义跟随文档结构版本——csv 变更不影响缓存键）；若发现误拼 csv=改为 doc 版本并登记 §0.4。

- [ ] **Step 6: 全绿+commit**：`feat(y0b-3): T5 版本门三档拒（csv 精确相等）+ready 协议版本下发+__CLIENT_BUILD__+collabUrl 单次+access_log 断言`

---

### Task T6: SCHEMA_OUTDATED 断链修复+连接寿命 4402+close code 常量化迁移

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（:356-360 附 reason+connected/寿命 Map+四处字面量迁移）
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts:846-857`（1012 常量化——映射表消费在 T9，本 Task 仅常量替换零行为变化）
- Test: `apps/api/src/modules/collab/collab-schema-refusal.spec.ts`（扩现有版本门测试文件）+连接寿命新用例

- [ ] **Step 0: 探针**——库 Connection 类型在 gateway 的 import 可达性（Map<Connection,number> 类型标注用）；connected 钩子 payload 形态（d.ts HookName :326 有 'connected'——payload 接口名探针）；onDisconnect 现清理块（:hooks）追加位。输出粘 commit message。

- [ ] **Step 1: 红测——reason 通路**

```ts
it('拒载 throw 附 reason=schema-outdated（改前红：仅 schemaRefusal 标记→客户端收字面量 permission-denied 落瞬态桶）', async () => {
  seedOldSchemaDoc('project:old'); // doc 行 schemaVersion=1
  const denial = await loadDocumentExpecting denial('project:old');
  expect(denial.reason).toBe('schema-outdated');   // 库 esm:939 error.reason ?? 'permission-denied' 透传——附上即通
  expect(denial.schemaRefusal).toBe(true);          // 既有标记保留（无害）
});
it('schema-outdated ∈ isTerminalReason（第五终态档——客户端四档 UX 版本过期分支的权威分型）', () => {
  expect(isTerminalReason('schema-outdated')).toBe(true);
});
```

- [ ] **Step 2: 实现（:356-360）**

```ts
} catch (e) {
  this.logger.error(`[O0b-0] 版本门拒绝载入 ${documentName}：...`);
  // E56 v2.1 断链修复：附 reason（词表第五终态档）——库 esm:939 透传 error.reason，
  // 客户端 authenticationFailed.reason==='schema-outdated' 通路可达（:352 db-unavailable 已有附 reason 惯例——补齐同风格）
  throw Object.assign(e as Error, { schemaRefusal: true, reason: CollabAuthReason.SCHEMA_OUTDATED });
}
```

- [ ] **Step 3: 连接寿命（红测先行——fake timers）**

```ts
it('连接超 12h→webSocket.close(4402,"max-lifetime")；P7 统一 webSocket.close（connection.close 丢 code）', async () => {
  vi.useFakeTimers();
  const ws = await connectAuthenticated('project:aged');
  await vi.advanceTimersByTimeAsync(12 * 3600_000 + 60_000);
  expect(ws.closeCode).toBe(4402);
  expect(ws.closeReason).toBe('max-lifetime');
});
it('键控清理：断连即删 Map 条目（防无界）+disconnect 后零残留', () => { /* onDisconnect 后 map.size 断言 */ });
```

```ts
// gateway 实现
private readonly connEstablishedAt = new Map<any, number>(); // Connection 键（P11 connectionEstablishedAt 私有不可达——自建 Map）
// hooks 追加：connected: ({ connection }) => { this.connEstablishedAt.set(connection, Date.now()); }
// onDisconnect 现钩子尾部：this.connEstablishedAt.delete(connection); this.authAttemptBuckets.delete(socketId);
// 寿命检查并进 startSessionSweep 同一脉冲（sweep tick 首部——复用既有周期装置）：
for (const [conn, at] of this.connEstablishedAt) {
  if (Date.now() - at > numEnv('COLLAB_CONN_MAX_LIFETIME_MS', 43_200_000)) {
    conn.webSocket?.close(CollabCloseCode.MAX_LIFETIME, 'max-lifetime'); // 4401 已被库 Unauthorized+sweep 双占用——4402 新码
  }
}
// 键控清理纪律：closeTeamDocuments（:1354-1372）与 beforeUnloadDocument 清该 doc 全部 connection 条目
```

- [ ] **Step 4: close code 常量化迁移（零行为变化——纯常量替换）**——gateway :672/:1206/:1191/:1368+runtime :850 全部换 `CollabCloseCode.*`；census `close\(1012\|close\(4401\|close\(1000` 双侧清零。

- [ ] **Step 5: 全绿+commit**：`feat(y0b-3): T6 拒载附 reason（第五终态档通路）+连接寿命 4402+close code 单源迁移`

---

### Task T7: E73 awareness 覆写+clientId 归属（‖可与 T8 并行）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（beforeHandleAwareness 钩子+归属表+serverIdentityOf）
- Modify: `apps/web/src/collab/awareness.ts`（setLocalUser/replayLocalUser 退位）
- Modify: `apps/web/src/components/CanvasView.tsx:113`（调用点删）
- Test: `apps/api/src/modules/collab/collab-awareness-guard.spec.ts`（新建）+web 现有 awareness spec 扩（消费面零改动验证）

- [ ] **Step 0: 探针（关键时序）**——库 esm:1495-1530 beforeHandleAwareness 调用时序：states 是否已应用 incoming update（决定"改写"与"丢弃"两形态实现）；客户端现配色函数位置（color=userId 哈希——挪服务端同源：grep RemoteCursors/CanvasTopBar 的 color 计算）；awareness.states 的 set 语义（P9：set 新 id 抛、改既有=允许）——`yjs` Awareness 的 `states: Map<number, Record<string, any>>` 直改是否进广播流（esm:204-212 server 重编码路径）。输出粘 commit message+**实现形态判定**：
  - 形态 A（states 已含新帧）：覆写=遍历 `awareness.states` 改 user 字段（set 既有 key）；丢弃=对"非本连接登记的 clientId"从 states delete（不进广播=对端不可见）。
  - 形态 B（states 未应用）：改 `payload`（AwarenessUpdatePayload 的 update 字节）重编码——若库不暴露改帧通道则放弃 B 取 A（spec 引证 esm:1512 传 socketId+connection 即为 A 形态设计意图）。

- [ ] **Step 1: 红测——伪造锚+归属锚+双标签锚**

```ts
it('VIEWER/匿名伪造 user 字段→states 内被剥离/替换为服务端身份（两端快照=服务端值；改前红：客户端自写直进 states）', () => {
  const applied = applyAwarenessFrom('socket-v1', { clientId: 111, user: { id: 'fake-admin', name: 'x', role: 'owner' } });
  expect(applied.get(111)?.user).toEqual({ id: 'u-1', name: '真实名', role: 'viewer', color: expect.any(String) }); // serverIdentityOf 注入
});
it('归属锚：伪造他人 clientId 帧（跨用户）→对端 state 不被覆盖（丢弃非改写——不替别人发声）', () => {
  registerOwner('socket-a', 111); // 用户 A 的连接登记 clientId 111
  const applied = applyAwarenessFrom('socket-b', { clientId: 111, cursor: { x: 1 } }); // 用户 B 伪造 A 的 clientId
  expect(applied.get(111)?.cursor).toBeUndefined(); // 伪造帧整体丢弃
});
it('同用户双标签断连不冻结对端光标（socketId 隔离——键选型回归锚）：标签1 断连只清自己登记的 clientId', () => {
  registerOwner('socket-a1', 111); registerOwner('socket-a1', 112); registerOwner('socket-a2', 113);
  disconnect('socket-a1'); // 带 ownership 校验：只清 111/112，不误清 113
  expect(isRegistered('socket-a2', 113)).toBe(true);
});
it('单连接 clientId 上限 4（第 5 个丢弃+计数）', () => { /* 上界锚 */ });
it('context undefined（DirectConnection 内部写）不注入（跳过——serverIdentityOf 只对连接流量）', () => { /* */ });
it('一致性校验源：库 document.connections 的 clients 集与归属表差异→计数告警（不信赖库内部也为漂移留探针）', () => { /* diff 计数 */ });
```

- [ ] **Step 2: 实现**

```ts
// gateway 成员
private readonly awarenessOwnership = new Map<string, Set<number>>(); // socketId → clientIds（键=payload.socketId——d.ts:609+esm:1512 双证：逐连接唯一，同用户双标签天然隔离；connectionId 注入零新机制已驳回）
private readonly socketIdentity = new Map<string, { id: string; name: string; role: string }>(); // socketId → 认证身份（authenticate 成功路径播种+onDisconnect 清）

// hooks 追加
beforeHandleAwareness: ({ awareness, context, documentName, socketId, clients }: any) => {
  try {
    const identity = socketId ? this.socketIdentity.get(socketId) : undefined;
    const owned = socketId ? (this.awarenessOwnership.get(socketId) ?? new Set<number>()) : new Set<number>();
    for (const clientId of clients ?? awareness.states.keys()) {
      const state = awareness.states.get(clientId);
      if (!state) continue;
      if (!owned.has(clientId)) {
        awareness.states.delete(clientId); // 非本连接登记→丢弃（伪造他人 clientId 帧；首见登记见下）
        continue;
      }
      if (identity && state.user !== undefined) {
        awareness.states.set(clientId, { ...state, user: serverIdentityOf(identity) }); // 覆写注入（只改既有——P9 允许 set 新 id 会抛）
      } else if (state.user !== undefined) {
        delete state.user; awareness.states.set(clientId, state); // 无身份（DirectConnection 等）→剥离防伪造
      }
    }
    // 首见登记：本帧新 clientId（states 有、归属表无）且来自有身份 socket → 归该连接（上限 4）
    if (identity && socketId) {
      const set = this.awarenessOwnership.get(socketId) ?? new Set<number>();
      for (const clientId of awareness.states.keys()) {
        if (!this.isOwnedByOther(socketId, clientId) && !set.has(clientId) && set.size < 4) set.add(clientId);
      }
      this.awarenessOwnership.set(socketId, set);
    }
    // 库侧一致性校验（esm:560/:601-603 clients 集差异计数——探针后接线）
  } catch { /* 观测面禁抛——onAwarenessUpdate 仅观测禁改写（注释钉死） */ }
},

// serverIdentityOf——客户端现配色函数同源挪服务端（Step 0 探针函数体原样迁移）
function serverIdentityOf(u: { id: string; name: string; role: string }) {
  return { id: u.id, name: u.name, role: u.role, color: colorOfUserId(u.id) }; // color=userId 确定性哈希（与客户端现配色同源）
}
```

（onDisconnect：`awarenessOwnership.delete(socketId)`+`socketIdentity.delete(socketId)`——带所有权校验=只删自己键下条目（Map 按 socketId 键控天然满足，双标签锚验证）；beforeUnloadDocument 清该 doc 全部相关条目。）

- [ ] **Step 3: 客户端退化**

```ts
// awareness.ts：删 setLocalUser（:54-58）/replayLocalUser（:60-62）——user 写入全链退位（服务端注入单源）；
// setSelection（:68-72）死代码维持现状注释（E38 接线=Y0b-4）；lastLocalUser 字段同删。
// CanvasView.tsx:113：删 bridge.setLocalUser({...}) 调用+import 清理。
```

消费面零改动验证：CanvasTopBar/RemoteCursors 现有测试全绿（读注入同形字段 `{id,name,role,color}`——客户端写 user 时形同，仅值源换服务端）；新增用例断言"服务端注入后 RemoteCursors 渲染服务端 color"（web 侧 store 级 mock）。

- [ ] **Step 4: 全绿+census `setAwarenessField\('user'\|setLocalUser\|replayLocalUser` 清零+commit**：`feat(y0b-3): T7 awareness 身份服务端覆写+clientId 归属表（伪造丢弃）+客户端 user 写入退位`

---

### Task T8: sweep 升级+事件驱动权限（‖可与 T7 并行）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（:44-45 间隔+1139 已翻转〔T1〕+:1166-1181 recheckConnection 改造+事件监听+结论缓存）
- Modify: 权限变更点（Step 0 探针清单：`apps/api/src/modules/team/team.service.ts` 成员移除/角色变更+project 删除路径）——emit 新事件
- Test: `apps/api/src/modules/collab/collab-sweep.spec.ts`（扩）+`collab-perm-events.spec.ts`（新建）

- [ ] **Step 0: 探针**——`project.gone` 既有事件先例（emitter 名/listener 挂载/payload 形态——gateway 现有 @OnEvent 若有）；team.service 成员变更方法名清单（removeMember/updateRole/transferOwner 等）+project 权限变更点；recheckConnection :1166-1181 现查询链全文；connection→token/userId 现取法（sweep 拿 connection 上下文的既有形态）。输出粘 commit message。

- [ ] **Step 1: 红测**

```ts
it('复验降级：成员被改 PROJECT_VIEWER→不断连+readOnly=true+awareness state 的 role 同步改写（v2.1——只置 readOnly 不改 awareness=被降级者成员表仍显示编辑者=只治写不治显示；改前红：recheckConnection 不判 role）', async () => {
  const conn = await connectAs('editor-then-downgraded');
  downgradeToViewer(teamId, userId); // DB 直改
  await vi.advanceTimersByTimeAsync(5 * 60_000 * 1.2 + 1_000); // sweep 兜底窗（jitter 上界）
  expect(conn.readOnly).toBe(true);
  expect(conn.isOpen).toBe(true);                    // 不断连（E13 语义=修越权写）
  expect(awarenessStateOf(conn).user.role).toBe('viewer'); // role 改写断言
  expect(await metricValue('collab_sweep_close_total', { cause: 'role-downgraded' })).toBe(1);
});
it('复验升权：VIEWER→EDITOR 恢复读写（perm.resolve 双向）', () => { /* 对称锚 */ });
it('事件驱动即时踢权：removeMember 事件→该成员全部连接 ≤1s 内 scheduleSweepClose（revoked）；sweep 5min 只是兜底（E39 口径=事件面零+兜底 5min）', async () => {
  const conn = await connectAs('member-to-remove');
  await teamService.removeMember(teamId, userId); // 变更点 emit
  await vi.advanceTimersByTimeAsync(1_100);
  expect(conn.closeCode).toBe(4401); expect(conn.closeReason).toBe('session-expired');
});
it('会话级结论缓存 5min：同连接复验结论缓存内零 DB（事件到达即失效该连接缓存）', async () => {
  await sweepTickOnce();
  const before = prismaCallCount();
  await sweepTickOnce(); // 缓存命中
  expect(prismaCallCount().delta()).toBe(0);
  emitPermChanged({ userId, teamId }); // 事件清缓存
  await sweepTickOnce();
  expect(prismaCallCount().delta()).toBeGreaterThan(0);
});
it('jitter±20%：连续 10 次间隔 ∈ [4min, 6min]（不聚集脉冲）', () => { /* 区间断言 */ });
```

- [ ] **Step 2: 实现**

```ts
// :44
const SESSION_SWEEP_INTERVAL_MS = 5 * 60_000; // 60s→5min：事件驱动为主（报告 2 3.5）——sweep 降为兜底；±20% jitter 见 scheduleSweep
// scheduleSweep 间隔处：SESSION_SWEEP_INTERVAL_MS * (0.8 + Math.random() * 0.4)

// recheckConnection（:1166-1181 手写三段查询整体替换）：
private async recheckConnection(connection: any, token: string): Promise<void> {
  const cached = this.permCache.get(connection);
  if (cached && Date.now() - cached.at < 5 * 60_000) return; // 会话级结论缓存 5min（事件到达时 invalidate——下）
  // 原三段查询保留拿 userId/projectId（sessionSvc.resolve+prisma.canvasProject），随后：
  const role = await this.perm.resolve(projectId, userId); // 复验补 perm.resolve（降级=置 readOnly 不断连）
  this.permCache.set(connection, { role, at: Date.now() });
  if (role === 'PROJECT_VIEWER' && !connection.readOnly) {
    connection.readOnly = true;
    this.rewriteAwarenessRole(connection, 'viewer'); // 改写该连接 awareness state 的 user.role（P9：改既有 state）
    this.sweepCloseTotal.inc({ cause: 'role-downgraded' });
    return;
  }
  if (role === 'PROJECT_EDITOR' && connection.readOnly) { connection.readOnly = false; this.rewriteAwarenessRole(connection, 'editor'); }
  if (!role) this.scheduleSweepClose(connection, 'revoked'); // 无角色（移除/解散）→踢
  // 5 连败兜底（:1158 现状）维持
}

private rewriteAwarenessRole(connection: any, role: string) {
  // 以该连接登记的 clientId 名义改其 state.user.role——awareness update 构造经 encodeAwarenessUpdate+applyAwarenessUpdate 广播
  // （实现细节按 T7 Step 0 探针的 awareness API 形态；owned clientIds 从 T7 归属表查）
}

// 事件驱动（EventEmitter2——project.gone 先例形态对齐）：
// 变更点 emit（team.service 移除成员/角色变更+project 删除路径，Step 0 清单全量）：
this.eventEmitter2.emit('collab.perm.changed', { userId, teamId, projectId? });
// gateway 监听（@OnEvent('collab.perm.changed')）：
//   遍历活跃连接匹配 userId+teamId（connection→userId 从 socketIdentity/authenticate 上下文——Step 0 探针取法）
//   →立即 recheck 该连接（绕过 permCache——事件=缓存失效信号+即时复验）→ 降级/踢除
//   →同时清 permCache 中受影响条目
```

（"单人团队特例分支删除"——v2 已裁删除；探针现 gateway 若已无该分支=登记"已不存在零改动"，若有=删除并用例覆盖。）

- [ ] **Step 3: 全绿+commit**：`feat(y0b-3): T8 sweep 复验 perm.resolve+降级 readOnly/awareness role 改写+事件驱动即时踢权+5min jitter 兜底`

---

### Task T9: 客户端锁定项（wsAuthNotice 写点+终态 UX+映射表消费+退避/重连所有权+write-frozen+503 retryAfter+版本 reload）

**Files:**
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（authenticationFailed 写点/close 映射消费/onStateless write-frozen/退避状态机/静默续期/版本 reload）
- Modify: `apps/web/src/utils/collabDiagnostics.ts`（auth_reject/write_reject 接线——ring 类型族扩）
- Modify: `apps/web/src/api/client.ts`（retryAfter 解析挂载）
- Modify: `apps/web/src/components/CanvasView.tsx` 或 banner 组件（Step 0 探针现挂点——四/五档终态+write-frozen+瞬态横幅 UI）
- Test: `apps/web/src/stores/canvasCollabRuntime.spec.ts`（扩——现有 conn.spec 形态）+`client.spec.ts` 扩+`collab-close-code` 消费测试

- [ ] **Step 0: 探针**——runtime 现有 provider 事件接线清单（:835-860 形态）；banner UI 现挂点（plannedRestartUntil 消费 :164 updateConnectionUi）；hasUnsyncedCanvasChanges 自持标记存在性（Y0b-2 T7 反应式重发落的谓词——grep）；executeGroupNodes catch 现形态（SYNC_PENDING 自动重试一次先例——同范式接 503）；vite 环境下 sessionStorage 键约定。输出粘 commit message。

- [ ] **Step 1: 红测——wsAuthNotice 写点+终态停连（§5.1）**

```ts
it('authenticationFailed→wsAuthNotice{reason,terminal} 写点（改前红：生产零写点——声明+消费在、写入侧缺失）+auth_reject diag', () => {
  const p = initProviderForTest();
  p.emit('authenticationFailed', { reason: 'forbidden' });
  const s = useCanvasStore.getState();
  expect(s.wsAuthNotice).toEqual({ reason: 'forbidden', terminal: true });
  expect(diagCount('auth_reject')).toBe(1);
});
it('terminal reason→provider.disconnect()（唯一官方停重连开关——recoverConnection 抑制不重建闭环）', () => {
  const p = initProviderForTest(); const disconnect = vi.spyOn(p, 'disconnect');
  p.emit('authenticationFailed', { reason: 'schema-outdated' });
  expect(disconnect).toHaveBeenCalled();
});
it('瞬态 reason（server-overloaded/db-unavailable/draining/lease-not-ready）→不 disconnect+wsAuthNotice.terminal=false', () => { /* 对称 */ });
it('4401 'session-expired' close→静默重连一次（connect() 一次），二次失败才终态；库 4401 'Unauthorized'（经 authenticationFailed）→终态不续期（双键分型红：只判 code 必混淆）', async () => { /* 双分支 */ });
```

- [ ] **Step 2: 实现——runtime 接线**

```ts
// createProvider 内（:846-857 close 块附近追加/扩展）
p.on('authenticationFailed', ({ reason }: { reason: string }) => {
  const terminal = isTerminalReason(reason);
  useCanvasStore.setState({ wsAuthNotice: { reason, terminal } });
  recordCollabDiag('auth_reject');
  if (terminal) {
    // 版本族三档→版本过期 UX（Step 4）；其余终态→四档 UX 由 wsAuthNotice 消费组件渲染
    p.disconnect(); // 库 onClose 定时器因 !shouldConnect 不再排程——停 31s 循环燃料
  }
});
// close 块扩（1012 既有分支保留）：
const action = resolveCloseAction(event?.code, event?.reason);
if (action.kind === 'silent-renew-once' && !sessionStateChanged()) {
  // 静默续期一次：4401 'session-expired'（sweep）——重连一次失败才落终态（§3.5）
  scheduleReconnectOnce();
}
if (action.kind === 'backoff') {
  // 应用层退避（库 onClose=固定 1s 无递增——P12）：RECOVER_BACKOFF_MS 族指数+jitter+上限
  // 重连所有权 5 步（§5.2 v2.2）：disconnect()〔置 shouldConnect=false〕→按 reason 计时→connect()→等 authenticated→失败再计
  scheduleBackoffReconnect(event?.code, event?.reason);
}
// planned-restart（1012）：既有 :850 分支收编为 resolveCloseAction 分派（行为不变）
```

```ts
// 退避表（新常量，runtime 顶部或 shared——组件禁散落）：
const RECOVER_BACKOFF_MS = { base: 1_000, max: 30_000, factor: 2 }; // 指数+jitter±20%；draining/lease-not-ready/db-unavailable/server-overloaded/rate-limited 全瞬态档统一（§5.2 v2.1）
// 锚：退避期间升级次数==0 且无并发 socket（disconnect 后排程 connect 前的窗口断言——测试断言 spy 顺序）
```

- [ ] **Step 3: 红测+实现——write-frozen 消费（P-J）**

```ts
it('onStateless 收 write-frozen→writeFrozen=true+横幅态+canExecute=false（canEdit 面由服务端 readOnly 双保险）', () => {
  const p = initProviderForTest();
  p.emit('stateless', { payload: JSON.stringify({ type: 'write-frozen', reason: 'draining' }) });
  expect(useCanvasStore.getState().writeFrozen).toBe(true);
  expect(canExecute(useCanvasStore.getState())).toBe(false);
});
it('恢复：drain 解除 1012→短退避重连→authenticated 事件清零 writeFrozen（复用 1012 既有链路零新恢复逻辑）', async () => { /* 事件序列 */ });
it('服务端 connected 钩子重放：frozen 态重连后立即再收通告（幂等快照 (a) 半——重连不丢冻结态）', async () => {
  // 服务端侧用例（gateway spec）：beginDraining 后新连接 connected 时重发 write-frozen
});
```

（runtime `onStateless` 监听 try/catch 包裹 JSON.parse；服务端 :682 既有发送点+frozenConnections 在 connected 钩子重放——gateway 侧小改同 commit。）

- [ ] **Step 4: 红测+实现——版本过期 reload UX（P-C）**

```ts
async function handleVersionTerminal(p: HocuspocusProvider, reason: string) {
  // loop 保护键=观测到的服务端协议版本（/api/ready 单次探测——d.ts:127 实证拒绝帧无 message 通道）
  try {
    const ready = await fetch('/api/ready').then(r => r.json());
    const serverCsv = ready?.collabProtocolVersion;
    const key = `collab-version-reloaded:${serverCsv}`;
    if (!sessionStorage.getItem(key) && !hasUnsyncedCanvasChanges()) {
      sessionStorage.setItem(key, '1');
      location.reload(); // 自动刷新一次——下次部署服务端版本变=键异=可再自愈一次
      return;
    }
  } catch { /* ready 不可达→直接落逃生动作 */ }
  // 逃生动作（唯一）：「导出本地画布→强制刷新」一键（不受未同步守卫约束——它就是为未同步而设；与 §5.5"请先导出"同一动作/同一按钮）
  showVersionEscapeAction();
}
```

```ts
it('版本终态：未同步门为真→不自动 reload+逃生按钮出现（导出 JSON→清 intent 标记→reload 一键）', async () => { /* mock ready+unsynced */ });
it('loop 保护：同服务端版本已 reload 过→不再 reload（防三锁互扣死页）', async () => { /* sessionStorage 预置键 */ });
it('服务端版本变化（下次部署）→键异→可再自愈一次', async () => { /* mock ready 返回新版本 */ });
```

（导出动作复用 store 序列化（§5.5 既有"导出本地画布 JSON"通道——Step 0 探针现导出函数；无则本 Task 落最小版：Y.Doc encodeStateAsUpdate→下载 JSON。）

- [ ] **Step 5: 红测+实现——503 语义化（§5.3 v2.1 收窄=仅补 retryAfter）**

```ts
// client.ts apiFetch throw 分支（:29/:35 现有 status/errorCode 透传处）：
const retryAfterRaw = res.headers.get('retry-after');
// 挂 error 对象：err.retryAfter = retryAfterRaw ? Number(retryAfterRaw) * 1000 : undefined;
it('apiFetch 503 带 Retry-After→error.retryAfter 毫秒数；缺头→undefined', () => { /* mock fetch */ });
it('执行入口 503→横幅「服务重启/维护中，请稍后重试」+Retry-After 后自动重试一次（同 SYNC_PENDING 范式——同 runId/regenToken 幂等保证零重复扣费）', async () => { /* executeGroupNodes catch 分支 */ });
```

- [ ] **Step 6: 四/五档终态 UX 横幅组件**——wsAuthNotice 消费（Step 0 探针 banner 挂点）：版本过期（reload/逃生动作——Step 4）/会话过期（重登链接）/无权（回工作区）/SCHEMA_OUTDATED+CLIENT_VERSION_*（并入版本过期档文案）；DB 不可用/SERVER_OVERLOADED/RATE_LIMITED（非终态——横幅自动重试+退避中提示「服务繁忙，正在自动重试」）；write-frozen 横幅「服务维护中，编辑已暂停；恢复后可继续（请勿刷新页面）」。UI 测试：分档快照/文案断言。

- [ ] **Step 7: 全绿+commit**：`feat(y0b-3): T9 客户端锁定项——wsAuthNotice 写点+terminal disconnect+双键映射消费+退避 5 步+write-frozen+版本 reload 自愈+503 retryAfter`

---

### Task T10: stateless ping 保活+onStateless 全函数化（P14 根修）+forceSyncInterval pin

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（hooks.onStateless）
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（15s ping 定时器+forceSyncInterval 60_000）
- Modify: `apps/api/src/modules/collab/store.metrics.ts`（三指标）
- Test: `apps/api/src/modules/collab/collab-stateless.spec.ts`（新建——真连装置）+runtime spec 扩

- [ ] **Step 0: 探针**——真连装置发送 stateless 帧的客户端侧 API（provider.sendStateless 或裸 WS 写 Message 编码——装置层级定测试形态）；provider lastMessageReceived 内部字段可达性（双向出口锚②读法）；ping 定时器挂载点（sessionEpoch 对齐+teardown 清理登记——runtime :1049-1050 纪律）。输出粘 commit message。

- [ ] **Step 1: 红测——P14 红锚（§5.2 v2.4）**

```ts
it('P14：真连发 sendStateless("not-json")→①进程存活②bad_payload+1③unhandledRejection 不增长（改前红：无 onStateless 钩子=库 esm:219 未 await+esm:1070-1076 重抛→兜底计数+1 且 bad_payload 恒 0）', async () => {
  const ws = await connectAuthenticated('project:ping');
  const unhandled0 = await metricValue('collab_unhandled_rejection_total');
  await ws.sendStateless('not-json');
  await settle(500);
  expect(processAlive()).toBe(true); // pm2 errored 全站停摆向量的判据（min_uptime 30s/max_restarts 10——ecosystem 实证）
  expect(await metricValue('collab_stateless_bad_payload_total')).toBe(1);
  expect((await metricValue('collab_unhandled_rejection_total')) - unhandled0).toBe(0);
});
it('ping→pong 同批回（connection.sendStateless 单发——禁 broadcastStateless O(N²)）+双向刷新：一次 ping 后 ≤5s 服务端 lastMessageReceivedAt 更新（esm:951-953）', async () => {
  const ws = await connectAuthenticated('project:ping');
  await ws.sendStateless(JSON.stringify({ type: 'ping' }));
  await expect.poll(() => serverLastMessageAt('project:ping'), 5_000).toBeTruthy();
});
it('未知类型→unknown 计数不炸', async () => { await ws.sendStateless('{"type":"mystery"}'); /* 断言 */ });
```

- [ ] **Step 2: 实现——服务端 onStateless（全函数化：JSON.parse 与副作用全包 try/catch、异常只计数绝不 rethrow）**

```ts
// hooks 追加
onStateless: ({ connection, payload }: onStatelessPayload) => {
  // P14：本钩子经库 esm:219 未 await 调用+外层 rethrow——任何抛出都成 unhandledRejection
  // （Node≥15 默认 throw；main.ts 兜底=T1 安全网，此处函数化=第一道防线）。绝不 rethrow。
  try {
    const msg = JSON.parse(payload);
    if (msg?.type === 'ping') {
      connection.sendStateless?.(JSON.stringify({ type: 'pong' })); // pong=ping 前置（v2.4：客户端 lastMessageReceived 只被入站帧刷新 provider:307——不回 pong=保活原样失效且服务端不可见=假绿）
      this.statelessPingTotal.set(Date.now()); // gauge：最近 ping 时间——"保活是否在工作"可观测
      return;
    }
    this.statelessUnknownTotal.inc();
  } catch { this.statelessBadPayloadTotal.inc(); }
},
```

- [ ] **Step 3: 实现——客户端 15s ping+forceSyncInterval pin**

```ts
// createProvider 配置追加：
forceSyncInterval: 60_000, // §7.2：放长为补传兜底非保活（30s 与 COLLAB_TIMEOUT 同值竞态+每 tick 全量 SV 编码 CPU——均作废；禁以调大 COLLAB_TIMEOUT 换保活=pre-auth 存活窗=认证重放窗）
// 15s 心跳（provider messageReconnectTimeout 3e4 的 2× 余量——provider:138/:185 实证）：
establishedTimers.set(epoch, setInterval(() => {
  try { provider?.sendStateless?.(JSON.stringify({ type: 'ping' })); } catch { /* teardown 竞态忽略 */ }
}, 15_000));
// teardownSession/destroyCollab：clearInterval+Map 删（键控清理纪律 :1049-1050——登记清理）
// 双向出口锚（客户端侧）：ping 后 ≤5s provider lastMessageReceived 刷新（探针可达性——私有字段读法或 onStateless pong 监听计数代理判据）
```

- [ ] **Step 4: 双向出口锚登记（§3.6 出口——"只测服务端计时器=假绿"警告）**——客户端用例：连接健康态空闲 90s（ping 工作）→无 4408 close+provider 未重连（sessionEpoch 不变）；`collab_stateless_ping_total` gauge 值随 ping 更新（服务端侧）。

- [ ] **Step 5: 全绿+commit**：`feat(y0b-3): T10 stateless ping/pong 15s 双向保活+onStateless 全函数化（P14 崩溃向量根修）+forceSyncInterval 补传化`

---

### Task T11: 出口汇聚（verify+census+int 回填+spec 回填+部署清单；【用户确认点】）

**Files:**
- Modify: `scripts/check-int-coverage.mjs`（新 int 文件下限——若有新建 int 文件）
- Modify: `docs/superpowers/specs/2026-10-08-y0b-funds-and-access-design.md`（§0.4 偏离登记表追加 Y0b-3 行——P-B/P-C/P-G/§0.1 各裁定落记）
- Modify: `docs/superpowers/specs/2026-10-06-canvas-yjs-arch-upgrade-review.md`（v8 目录 Y0b 行回填——Y0b-3 完成态+commit 区间）
- Modify: `docs/superpowers/runbook`（若有 §6 tripped 处置行要求——heap 闸 runbook 行归 Y0b-5 §5.8⑥；本批仅验登记）

- [ ] **Step 1: verify 三连**——`pnpm verify`（含 check-spec-consistency——spec §7 fenced 块与本批 env/指标/close code 对齐，各 Task 已同步则绿）+`pnpm test:int:ci`+`pnpm --filter web test`。全绿后逐文件核对 int 覆盖下限。

- [ ] **Step 2: census 四组清零验证**（§TDD 纪律清单——grep -P 或分次 grep）：
  - `requestParameters?.get\('token'\)`——gateway 零命中
  - `close\(1012\|close\(4401\|close\(1000`——gateway+runtime 裸字面量零命中（shared 常量引用除外）
  - `'0\.0\.0\.0'`——gateway 零命中
  - `setAwarenessField\('user'\|setLocalUser\|replayLocalUser`——web 零命中

- [ ] **Step 3: 出口演练核对（§3.6 清单逐项过）**——sweep 默认开/角色复验降级（含 awareness role）/事件即时踢权/Origin 握手失败锚/cookie-only+`?token=` census/awareness 伪造+归属锚/版本门三档+联合锚/版本过期 reload 用例/schema 拒连演练（authenticationFailed.reason==='schema-outdated'+disconnect+N 秒重连==0）/防放大三锚/heap 闸四红/check-ecosystem 区间链/连接寿命 4402/升级限流+三防线/ping 双向出口+P14 红锚/access_log 断言。缺项回补，逐项在 commit message 列勾。

- [ ] **Step 4: spec 回填**——§0.4 追加 Y0b-3 落地偏离行（P-A~P-J 中与正文措辞有出入者：P-B 双计数口径/P-C ready 载体〔正文"观测到的服务端协议版本"未钉通道〕/P-G 429 补全/P-E PG 熔断钩子时序/P-D 边界裁决）；v8 目录 Y0b 行回填（完成态+commit 区间+残余分派）。

- [ ] **Step 5: 部署清单（【告知用户点】——Y0b-2 先例形态）**：
  1. 服务器 `.env` 增 `COLLAB_TRUSTED_PROXY=1`（**必须**——不设=升级限流全站 127.0.0.1 单桶=重连风暴全站锁死，恰是限流要防的反面）；
  2. 可选 env（默认值即 spec 契约，不建议改）：COLLAB_ALLOWED_ORIGINS（默认 BETTER_AUTH_URL 推导——若生产域名≠BETTER_AUTH_URL origin 则必须显式设）/COLLAB_SWEEP_ENABLED（逃生阀）/COLLAB_RSS_*；
  3. 部署窗口语义：**已打开的旧 bundle 会话全部进版本终态拒绝**（CLIENT_VERSION_MISSING 档——fail-closed §9.1 既定非风险）——建议低峰部署；
  4. nginx/ecosystem 零变更（access_log off+X-Real-IP 已在；断言锚已进 deploy 校验链）；
  5. 部署后冒烟：伪造 Origin 握手 4xx+`collab_upgrade_rejected_total` 可见+`collab_overload_state{state="ok"}`=1+ready 含 collabProtocolVersion。

- [ ] **Step 6: commit+【用户确认点】**：`docs(y0b-3): T11 出口汇聚——verify 三连+census 四组+spec §0.4/v8 回填+部署清单`

---

## Self-Review 记录（plan 作者已执行）

- **Spec 覆盖**：§3.1（sweep/事件/Origin/cookie-only/限流）→T2/T8；§3.1bis 四层→T3/T4（序钉死）；§3.1ter→T2/T4（Origin 形态/reaper 谓词）；§3.2→T4 全量；§3.3→T7（P-D 边界裁决 >8 人/单连接短路归 Y0b-4）；§3.4→T5+T9（版本门/reload UX）；§3.5→T0/T6（词表/通路/寿命/分配表）；§3.6 出口→各 Task 锚+T11 汇总；§5.1/5.2 锁定项→T9/T10；§5.3 write-frozen/503→T9（P-J）；§7.1/7.2 env/pin→T1（maxPayload 三 pin/forceSyncInterval 在 T10——键随读者同批）；spec §4.1⑥ maxPayload 行为断言（1009 真连）**归 Y0b-4**（§4.5 出口清单在彼）。
- **已知移交**：collab_idle_timeout_total 遥测载体=Y0b-5 §5.6 sink（本批仅分型+diag ring）；refusalCache ④ PG 熔断半开钩子位=Y0b-5 §5.9；quotaState 快照扩展=Y0b-4 §4.1③；>8 人剥离/单连接短路=Y0b-4 §4.4；1012 已消费勿重做（:846-857 收编进映射表零行为变化）。
- **类型一致性**：CollabCloseCode/resolveCloseAction（T0 定义=T6/T9 消费）；negotiateClientVersion 三档名=CollabAuthReason.CLIENT_VERSION_*（T0 内同文件族对齐）；measureHeapPressure/releaseHook（T4 单源）；awarenessOwnership/socketIdentity（T7 定义=T8 rewriteAwarenessRole 消费）；`authAttemptBuckets`（T3 定义=T6 onDisconnect 清理）。
- **占位符扫描**：Step 0 探针均为只读验证性步骤（非设计空位）；「Step 0 探针后定」的四处（beforeHandleAwareness 时序形态/withDoc 行号/事件变更点清单/导出函数现值）皆有判定准则或双形态预案，不阻塞执行。
