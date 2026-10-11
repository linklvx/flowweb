<!-- doc-status: draft-v3.1 | created_at: 2026-10-11 | note: v3=第三轮外审收敛（三报告逐项一手核验）。**T10 保活前提证伪〔本轮最重要〕**：y-protocols awareness.cjs:85-89 本地自续期（每 15s setLocalState 重发+构造即 setLocalState({}）使前提恒立）+provider esm:776-780 origin='local'≠实例⇒发送+server esm:671-673 broadcast 无 origin 过滤⇒回显发送者——三环全实证⇒空闲连接每 15s 双向帧、两侧计时器恒刷新、spec §5.2"空闲零消息⇒30-60s 判死四害"前提在本仓不成立⇒**T10 整删改证伪性只读锚**（今日即绿——用证据钉死不需要保活；后台标签节流下 ping 同被节流=前后台都无价值；P14 向量随钩子不注册而归零——库默认 onStateless=Promise.resolve(null) 不抛；T1 兜底保留独立成立）。**夹具缺口 S-1**：dual-client-server.ts:47 permSvc 无 resolveWithTeam mock——T3 落地全部真连红且伪装成 DB_UNAVAILABLE⇒并入 T1.5。**T8 clock**：applyAwarenessUpdate 按 currClock<clock 丢弃同钟更新——服务端改写必须先递增 meta.clock+对端可见锚。**权限语义 A**：removeMember 不触碰 ProjectMember 表⇒统一链后"移出团队但有显式授权=保留画布访问"（REST 既有语义的 WS 一致化）——§0.4 登记+int 两例+cause 分型。**reaper 卸载动作删**：自队列谓词与库守卫可达状态同真+库 store 后必排 setTimeout unload 自愈+保内存分支本仓不可达⇒reaper 唯一对象不存在——留卡住观测。heap 布尔结构改两量纲各自 trip/release（RELEASE_BYTES 真正生效）。S-2 跨包 import/PROTOCOL_COMPAT 删（"tsc 强制 bump"论证证伪）；S-5 提取式钉死 [\d_]+（下划线截断=静默错绿）；'0' 三处矛盾统一 invalid；S-4/S-3/P1 三项/sweep 逃生阀拆 timer/必修 2-3 全采纳。驳回：csv>current 放行改判（单仓同批部署下两事故场景不成立+fail-closed 助发现错配）；S-6 删 throw 指标（该 catch 实证存在）；P0-V2 编译红论（误读——原文即判定处翻转）。**v3.1=第四轮三报告收敛（文档级修订零代码，不出 v4 直接进 T0）**：必修五项——①T3 cacheKey/cached 重复声明（TS2451）删+无 cookie 不落缓存红测补②onDrainReleased 陈旧测试改打 onServingTransition 单点表驱动③observeIdleDocs pendingQueues 键=裸 projectId（gateway:321 播种/:151/:826 取用实证——get(doc.name) 恒 undefined=观测静默失效）④事件即时性恢复 scheduleImmediateSweep（v3 采纳 P1-2 过度=撤权退化 ≤6min 且 T8 自身红测 1.1s 断言不可达——setImmediate 请求一次 tick，仍单一执行路径）⑤pool_timeout 单位=秒改 5（原 5000≈83min=P2024 兜底近失效）。清扫——§0.1 四行 supersede（P-E/P-G/P-J/P-O）+六处陈旧引用（TDD 块 reaper 兜底/T4 标题+Files 薄 reaper/T1 Step 3 钩子化在 T10/锚点表 onStateless 四钩子与 +ping 两处——后两处为本轮自查新发现）。加固——T7 双索引（ownedClientIds Set 计数=.size 消 NaN+剪枝 O(自己)+ownedClientIdsOf/socketIdOf 落定义——T8 原引用未定义）；Map 老化拆独立 timer（SWEEP_ENABLED=false 禁关老化）；SUE 对象形态 {code:'COLLAB_NOT_SERVING'} 命中 filter（filter:17-22 只认 body.code 实证——字符串形态落 fallback=无 Retry-After）；T10 锚显式 timeout+90s 保留（45s 压缩驳回：只覆盖 30s 子档）；deadline≠DB 并发边界注释；message-too-big 第六终态档显式；T11 客户端 close code 断言+巡检小表。驳回——**pageHide no-op/幽灵用户 30s 论**（awareness.cjs:75 `this.clientID = doc.clientID` 直接证伪——pageHide 的 removeAwarenessStates([document.clientID]) 精确命中=正常广播下线帧；四轮评审第 4 处错误论断，模式=未读构造器 clientID 赋值行；其后台标签断连正常结论仍采纳）。P-T 补第四环（provider esm:305-307 onMessage 刷新客户端计时器）+第五环（esm:905 off('update') 注册面——handler 挂 update 非 change，续期帧必发非可能发）+机制精化（3s tick/15s 门限/clock 无条件+1 且 update 无条件 emit）+前提禁令（禁 setLocalState(null)——静默废保活）。v2 记录：两轮外审收敛（F-1 撤回确认/F-3 并批 T3 全量+判据门/color 五件套/重连所有权单一化/states 载体/socketId 键控/T1.5 夹具基座/INFLIGHT=4/双量纲维持+七项 spec 推翻案驳回）。v1 基线勘察 2026-10-11 HEAD=2eb7e74b；spec=2026-10-08-y0b-funds-and-access-design.md v2.6 §3 全节+§5.1/5.2/5.3 锁定项 -->
# Y0b-3 准入与版本 Implementation Plan（v3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 Y0b 准入与版本批（spec v2.6 §3 全节+§5.1/5.2/5.3 锁定项）——**E13 准入收口**（sweep 默认开+事件驱动权限复验+Origin 403+cookie-only+升级限流）+**拒绝路径防放大四层防线**（refusalCache→信号量→per-socket 桶→heap 闸，执行序钉死）+**heap 压力自保闸**（双量纲谓词各自 trip/release+仅拒新物化+卡住观测〔v3：卸载动作删——库自愈排程〕）+**E73 awareness 覆写与归属**（payload.states 载体+三分支+clock 递增改写）+**E60 版本门**（csv/cb query 通道+四档拒+loop 保护自愈）+**E56 修订**（SCHEMA_OUTDATED reason 断链修复+连接寿命 4402+close code 分配表）+**客户端锁定项**（authenticationFailed→wsAuthNotice 写点+终态 UX+(code,reason) 双键映射表+重连所有权单一化+write-frozen 消费+503 retryAfter）+**空闲保活证伪性锚**（v3：awareness 15s 自续期实证=不需要 ping——证据替代机制，spec §5.2 勘误登记）。

**Architecture:** 防线按「零 DB/零分配优先」分层插入 onAuthenticate（spec §3.1bis 钉死执行序：`refusalCache → 并发信号量 → per-socket 桶 → heap 闸 → 版本门 → 四次 DB 查询`），跨 T3/T4/T5 三批插入、每批红测断言相对序；不变量交给结构——拒绝理由一律经 `Object.assign(new Error, {reason})` deny 工厂单点埋计数，词表 append-only（shared 单源），close code 全集进 `shared/constants/collab-close-code.ts`（(code,reason) 双键分型——4401 双 reason 族只判 code 会把库 Unauthorized 当会话过期无限续期）；awareness 身份权=服务端覆写注入+clientId 归属表（伪造帧丢弃非改写）；heap 闸仅拒新物化永不驱逐存量（`!documents.has(documentName)` 防自伤）+迟滞双阈值+fail-open。

**Tech Stack:** Nest 10 + @hocuspocus/server 4.6.0（契约锁 check-hocuspocus-pin）/ @hocuspocus/provider 4.6.0 / yjs 13.6.32 / prom-client / zod / EventEmitter2 / vitest（单元+collab-core 真连装置+int 真库）/ vite define。

**执行门：** 每 Task Step 0 只读探针（输出粘 commit message）；**每 Task 收尾 `git commit`，红→绿→commit**；**T11 子批出口=【用户确认点】**；**服务器部署步=【告知用户点】**（.env 增 `COLLAB_TRUSTED_PROXY=1` 必须——不设则升级限流退化为全站 127.0.0.1 单桶；部署窗口=已打开的旧 bundle 会话全部进版本终态拒绝——§9.1 fail-closed 既定语义非风险）。

**执行序：**

```
T0（shared 契约地基——词表追加 6 值〔v2 +server-outdated〕+isTerminalReason 五档+close-code 模块〔库值从
     @hocuspocus/common 导入〕+协议版本常量+server-outdated 档；零运行时风险）
  → T1（进程地基——env 十键〔INFLIGHT 默认 4〕+SWEEP 默认开翻转+trust proxy loopback
        +unhandledRejection 兜底函数化+生产 Origin 双缺 fail-fast+Server 构造 pin）
  → T1.5【v2 新增】准入面夹具基座——dual-client-server 换注入式 ws（Origin/Cookie header
        可注入）+COLLAB_ALLOWED_ORIGINS 测试注入+?token= 全量替换（8 个真连 spec）。
        **T2 硬前置：不做则 T2 一落地真连 spec 全红且无从修**
  → T2（upgrade 面——cookie-only+parse-session-token 三形态门+Origin 403 socket 直写
        〔write+end〕+升级限流 token bucket+address 默认翻转+生产剔除 localhost）
  → T3（认证防线+F-3 全量——refusalCache→信号量→桶执行序+fingerprint 真实凭据
        +authenticate 改 resolveWithTeam 单源+**sweepSessions 判据门两分支
        （expired ∨ dueForPerm）**+recheckConnection 判据单源〔每函数恰一次切换〕
        +3×3 矩阵测试+AUTH deadline 常量+三 Map 老化）
  → T4（heap 闸——谓词单源 util **两量纲各自 trip/release**+onLoadDocument 单点落点〔删 withDoc
        平行判据+SUE 形态〕+已加载豁免+**卡住观测器**〔v3：卸载动作删——库自愈排程+守卫拒绝
        连续计数〕+check-ecosystem 提取式 fail-closed+四红用例〔④卡住观测形态〕）
  → T5（版本门服务端——csv/cb query+四档拒〔+server-outdated〕+__CLIENT_BUILD__ 用
        GIT_COMMIT_HASH+collabUrl 单次+ready 双分支下发+index.html no-store+access_log
        断言服务器侧）
  → T6（SCHEMA_OUTDATED 断链修复+连接寿命 4402〔**socketId 键控**+清理提至 early-return 前〕
        +close code 常量化迁移+collab_ws_close_total 单点埋）
  → T7（E73 awareness——**payload.states（scratch）载体**+三分支归属判定〔owned/他人/首见
        同一趟〕+DirectConnection 放行+color 五件套同 commit 收口〔shared 单源+消费面切
        字段+删客户端 userColor〕+replayLocalUser 承重保留；‖可与 T8 并行）
  → T8（sweep 收窄——**只留节奏与事件**：5min+jitter+事件驱动即时踢权+结论缓存失效
        +awareness role 改写〔词表 ProjectRole〕；判据已归 T3 零改动）
  → T9（客户端锁定项——**close 分型→machine 输入映射**〔删自建退避表——唯一源
        connectionMachine+唯一执行器 recovery〕+真停连开关 websocketProvider.disconnect
        +输出级验收锚+1012 收编+write-frozen 最小形态〔事件+Map 还原〕+版本 reload
        〔loop 键=ready 探测〕+503 retryAfter+四/五档终态 UX）
  → T10【v3 改写】空闲保活**证伪性验证锚**——ping/pong 与 onStateless 钩子整删（三环实证：
         awareness 15s 自续期+origin='local' 发送+服务端无过滤回显⇒空闲恒有双向帧——spec §5.2
         前提在本仓不成立）；只读锚=真连空闲 90s 断言无 4408/无重连/documents 常驻+服务端
         lastMessageReceivedAt 15s 尺度刷新（今日即绿——用证据钉死不需要保活）；spec 勘误登记
  → T11（出口汇聚——verify 三连+census 五组+int 覆盖回填+spec §0.4 偏离登记〔16 条〕+v8 目录回填
         +重连演练〔N=50+pendingDocumentCount 峰值<50〕+部署清单〔+.env connection_limit〕；【用户确认点】）
```

**TDD 纪律：** 红→绿→commit，红相留档（commit message 粘红/绿两态）。**判据同批规则（v2 新增）**：判据类改动一律与其全部消费点同批切换（authenticate+recheckConnection+sweepSessions 判据门=T3 一次）——禁同批内分 Task 切同一判据（中间态=双权威）。**真红门**（改前必红）：Origin 拒=真连+伪造 Origin→握手失败+计数（现状无 onUpgrade 钩子=零计数）；cookie-only 伪造 query token 拒绝（现状 query 优先=放行红）；**权限三形态**（仅 ProjectMember 不在团队/仅创建者不在团队——现状 teamMember 硬门必 403 红；无任何角色=FORBIDDEN；项目不存在=NOT_FOUND 分型不退化）；**sweep 判据门**（权限降级场景现状 :1144 快照未过期 continue=复验零调用红——**测试必须走 sweepSessions 全路径，禁只测 recheckConnection**=假绿）；防放大三锚（①N 次被拒 Auth→prisma 计数不随 N 增长〔db-unavailable 场景〕②并发 M socket→在飞峰值≤INFLIGHT_MAX ③桶满后续 Auth 全拒零 DB）；heap 闸四红（stub 0.9 拒新 doc/已加载豁免/谓词抛错放行/卡住观测〔v3 终形：stub 库守卫不满足→连续轮次计数 yjs_doc_stuck_total——**卸载动作删**（P-V①）；gateway 契约 3 不 throw 使库"保内存"分支本仓不可达〕）；版本门四档+计数（现状零校验）；schema-outdated 拒载 throw 附 reason（现状仅 schemaRefusal 标记=客户端收字面量 permission-denied 红）；awareness 伪造锚（现状客户端自写 user 直进 states 红）+归属锚（伪造他人 clientId 覆盖对端 state 红）+双标签断连不冻结+**首帧可见性锚**（新连接首个 awareness 帧即含 user→对端最终可见——丢弃与登记同一趟完成）；sweep 降级（T3 判据门后可红）+事件即时踢权；连接寿命 fake timers+4402；~~P14 红锚~~ **v3 作废**（库默认 `onStateless: () => Promise.resolve(null)` 不抛——不注册钩子=P14 向量归零；T10 整删后该锚无对象；T1 unhandledRejection 兜底独立保留〔真正买单者=T2 onUpgrade 的 catch→throw esm:1633-1634〕）；**T8 clock 锚**（role 改写后**对端可见值**变化——禁只断言服务端 awareness.states〔meta.clock 未递增时对端全丢弃而服务端自以为成功=假绿〕）；**权限语义 int 两例**（移出团队但有显式 ProjectMember 行→WS 仍可连〔预期行为 A〕；无显式行普通成员→≤1s 被踢）；**退避输出级锚**（退避窗口内 websocketProvider.connect 调用数==0+WebSocketPolyfill 构造计数==1〔单飞〕——禁 spy p.disconnect〔provider.disconnect 真转发但输出级锚更强〕）；4401 双 reason 分型（只判 code 会静默续期库 Unauthorized=红）。**census 验收 grep**（统一 `\|` 转义，五组）：`requestParameters?.get\('token'\)`（T2 后 gateway 清零）+`close\(1012\|close\(4401\|close\(1000`（T6 后 gateway+runtime 裸字面量清零——shared 常量/库导入单源）+`'0\.0\.0\.0'`（T2 后 gateway 默认值清零）+`setAwarenessField\('user'\|setLocalUser`（T7 后清零——user 写入退位；**replayLocalUser 保留**〔改形重放非 user 字段〕不入 census）+`userColor\(`（T7 后 apps/web 清零——shared 单源 userColorOfUserId 除外）。**int 纪律**：新增 int/真连用例优先并入现有 `*.spec.ts`（collab-core 装置族）；确需新文件先 `git add`+T11 回填 check-int-coverage 下限。**spec 同步**：各 Task 新增 env 键/指标名/close code/词表值与 spec §7.1 fenced 块同 commit 对齐（check-spec-consistency.mjs 已进 verify——滞后=verify 红）；env.ts 新键**恰好两空格缩进**+指标名**小写**（extractMetricNames/extractEnvKeys 正则约束，否则门禁提取不到=verify 红）。

---

## 0. 基线勘察锚点表（2026-10-11 HEAD=2eb7e74b 一手核验；执行者以此为准，spec §1.1B 行号已漂移）

> 路径总漂移：spec 写 `apps/api/src/collab/`——实际 `apps/api/src/modules/collab/`。gateway 1373 行。

| 锚点 | 现状 | 本批动作 |
|---|---|---|
| `modules/collab/collab.gateway.ts:207-232` | Server 构造：`address ?? '0.0.0.0'`（:219）；hooks 现挂 onAuthenticate/onLoadDocument/onStoreDocument/afterStoreDocument/onDisconnect/beforeUnloadDocument 六项（:224-229）；**无 websocketOptions**（ws 默认 maxPayload=100MiB 生效） | address 默认翻 127.0.0.1（T2）；websocketOptions+pre-auth 三 pin（T1）；新增 onUpgrade（T2）/beforeHandleAwareness（T7）/connected（T6）三钩子（~~onStateless~~ 随 T10 证伪整删——P-T） |
| `gateway:246-295` | `authenticate`：`:249-250 token = requestParameters?.get('token') ?? parseSessionToken(cookie)`（query 优先）；:255 draining deny/:256 lease deny/:259 spool 降级 readOnly/:262 touchWithReason/:274 perm.resolve/:278 VIEWER readOnly；catch :292-293 分型透传+DB_UNAVAILABLE 折叠 | cookie-only（T2）；顶部插防线（T3-T5 按 §3.1bis 序）；deny 工厂 :247 单点埋 auth_reject 计数（T3） |
| `gateway:311-370` | onLoadDocument：:312-313 lease 门（三入口汇聚点先例）；:354-360 ensureSchemaVersion catch→`Object.assign(e, { schemaRefusal: true })` **无 reason**；:361-362 stamp 自愈 | :359 追加 `reason: SCHEMA_OUTDATED`（T6）；:312 前插 heap 闸第二落点（T4） |
| `gateway:44-45` | `SESSION_SWEEP_INTERVAL_MS=60_000`/`GRACE=5_000` | 间隔 5min+jitter±20%（T8） |
| `gateway:1132-1198` | sweep：:1139 `!== 'true'` return（**默认关**）；recheckConnection :1166-1181 **手写三段查询（session→project→teamMember），不调 perm.resolve、不判 PROJECT_VIEWER**；scheduleSweepClose :1183-1198（4401 'session-expired' :1191） | 默认翻转（T8）；复验改 perm.resolve+降级 readOnly+awareness role 改写+事件驱动（T8） |
| `gateway:662-685` | beginDraining：:672 `close(1012,'drain released')`；:681 readOnly=true；:682 `conn.sendStateless?.({type:'write-frozen',reason:'draining'})`（注释"Y0b 消费"） | 客户端消费接线（T9）；frozenConnections :121 |
| close code 字面量 | gateway 四处：:672/:1206 1012、:1191 4401、:1368 1000；runtime :850 1012 | 全部迁移 shared 常量（T6） |
| `packages/shared/src/constants/collab-auth-reason.ts`（37 行） | 七值词表+TERMINAL_AUTH_REASONS 四档 Set（:27-32）+isTerminalReason | 追加 6 值〔v2 含 SERVER_OUTDATED〕+终态表加版本族三档（T0） |
| `shared/constants/collab-close-code.ts` | **不存在**（全 grep 零命中） | 新建（T0，exemptions.json 已登记前向引用豁免 expires 2027-01-06——落地后自然空转） |
| `apps/web/src/stores/canvasCollabRuntime.ts`（1112 行） | createProvider :867-884：`collabUrl()` **两处调用**（:868 transport/:871 provider）+`token:'cookie-auth'` 占位+无版本参数；1012 消费 :846-857（plannedRestartUntil :108/:164）；collabReadOnly 授权写点 :841（authenticated）；**wsAuthNotice 零生产写点**（声明 canvasStore.ts:171/消费 syncStatus.ts:9+runtime:960）；sessionEpoch :84/:910/:1000 | collabUrl 单次+版本参数（T5）；authenticationFailed 写点+close 映射+stateless 事件 write-frozen 监听（T9） |
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
| P-A 词表追加 5 值〔**v2 扩为 6 值**：+`SERVER_OUTDATED:'server-outdated'`——瞬态档，csv>current 的 reload 无效档（M-4）〕 | `SERVER_OVERLOADED:'server-overloaded'`/`SCHEMA_OUTDATED:'schema-outdated'`/`CLIENT_VERSION_MISSING:'client-version-missing'`/`CLIENT_VERSION_INVALID:'client-version-invalid'`/`RATE_LIMITED:'rate-limited'`；isTerminalReason 追加**版本族三档**（schema-outdated/client-version-missing/client-version-invalid——均落 reload 档 UX）；server-overloaded/rate-limited/**server-outdated** **严禁入终态**（枚举处注释钉死：误入=一次内存尖峰/一次拥塞把全部客户端钉死且不自愈） | spec §3.2/§3.4/§5.2；rate-limited 承接 per-socket 桶超限 deny（§3.1bis 3"throw 带 reason"+§5.2"必须落瞬态桶"） |
| P-B heap 拒绝双指标口径 | onAuthenticate 落点→`collab_auth_reject_total{reason='server-overloaded'}`+`collab_load_rejected_total{reason='server-overloaded'}` **两者都记**（auth 面计数与物化面计数两个维度）；loadDocument 落点→仅 `collab_load_rejected_total` | §3.2 指标原文泛指"拒新物化"；两维度不重叠 |
| P-C 版本 loop 键载体 | **/api/ready 响应增 `collabProtocolVersion` 字段**；客户端版本终态时单次探测（节流——非 §5.4 已删的轮询形态，属其"边角单次探测"同族）→loop 键=`collab-version-reloaded:${服务端版本}` 存 sessionStorage——键在=已 reload 过一次还没救=落逃生动作；下次部署服务端版本变=键异=可再自愈一次 | d.ts:127 实证 authenticationFailed payload 仅 {reason}——message/版本经拒绝帧结构性不可达；spec §3.4"loop 保护键=观测到的服务端协议版本"原文语义 |
| P-D E73 边界 | >8 人剥离 cursor/selection 与服务端单连接短路（connectionsCount≤1 不转发）**归 Y0b-4**（spec §4.4 详情节为准；总表 E73 行括号内容与 §4.4 重复出现——详细节优先） | §3.3/§3.6 出口清单均未含此二项 |
| P-E refusalCache 清空钩子 | **〔v2 后续 P-Q 取代——清空单点化：不再逐因由枚举四方法名，下表 P-Q 为准〕**本批落四钩子：①drain 解除 ②租约 rejoin ③heap 闸释放 ④spool 恢复（isWritableOrDegraded 状态翻转点）；**PG 熔断半开成功=同 ④ 钩子位，Y0b-5 落熔断时接线**（锚用例表驱动按已注册钩子数断言） | §3.1bis 1"spool 恢复与 PG 熔断半开成功——并集"；§5.9 PG 熔断=Y0b-5 域 |
| P-F 信号量/桶拒绝不入缓存 | 实现结构=authenticate 拆外层（防线：桶/信号量 throw **不经过**写缓存的 catch）+内层（状态类拒绝 throw 进 catch→reason∈白名单→写缓存）——按 throw 来源区分，非按 reason 值 | §3.1bis 1"信号量溢出与桶超限的拒绝不入缓存"钉死 |
| P-G 升级限流拒绝形态 | **〔v2 后续 P-R 修订——destroy→socket.end()（write 后立即 destroy 丢弃未发送字节=客户端收 RST 非 403），下表 P-R 为准〕**Origin 非法→`HTTP/1.1 403`+destroy；限流超限→`HTTP/1.1 429`+destroy（同为 socket 直写不回握手；spec 只钉 403 形态，429 为同族补全——登记 §0.4 偏离） | §3.1ter 形态（esm:1623-1636 hook throw=未处理 rejection 形同虚设的实证） |
| P-H sweep 翻转落点 | gateway:1139 判据 `!== 'true'`→`=== 'false'`（显式 'false' 才关=env 逃生阀维持——§4.2 回滚表"sweep 另有 env 逃生阀"） | spec §4.2 |
| P-I trusted proxy 收口 | main.ts:87 `'loopback'` 一行统一（REST XFF 与 WS 同信任前提；E58 完整收口仍归 Y0.5）；**生产必须 .env 增 `COLLAB_TRUSTED_PROXY=1`**（不设=不信任 X-Real-IP=限流全站单桶——【告知用户点】） | spec §7.1 v2.2 R12+§3.1 |
| P-J write-frozen 本批形态 | **〔v2 后续 P-S 修订——connected 重放删除（drain 期新连接被 :255 DRAINING 拒⇒重放无对象），下表 P-S 为准；connected 钩子本身保留但仅服务 T6 寿命 Map〕**服务端：进入冻结广播（:682 既有）+**connected 钩子重放**（幂等快照的 (a) 半——frozen 态连接建立时重发通告防重连丢态）；解除=drain 释放 1012 既有链路（复用零新恢复逻辑）；消息形态 `{type:'write-frozen',reason}`（quotaState 字段 Y0b-4 同通道扩展）；客户端：writeFrozen 写点+横幅「服务维护中，编辑已暂停；恢复后可继续（请勿刷新页面）」+authenticated 清零 | §5.3 锁定项+spec 原文"复用 1012 既有链路零新恢复逻辑" |
| **P-K（v2）F-3 并批 T3 全量** | authenticate+recheckConnection+**sweepSessions 判据门两分支（expired ∨ dueForPerm）**一次切换 `perm.resolveWithTeam` 单源（Y0b-1 落地权威链：显式>创建者>团队回退）；删 :265-272 独立 canvasProject/teamMember 查询（resolveWithTeam 已 select teamId——4-5 次冗余往返归 1-3 次）；teamMember 降级展示字段；`user.role` 词表统一 `ProjectRole`（TeamRole 大写 OWNER/MEMBER 与 ProjectRole 三值现混用）；NotFoundException catch 转 `deny(NOT_FOUND)` 保分型；**3×3 矩阵测试**（输入源 sweep-tick/perm-event/cache-hit × 结果 viewer 维持/editor 降级 readOnly 不断连/null 踢线）——测试必须走 sweepSessions 全路径 | 第二轮实证 :1144 判据门（快照未过期 continue——复验改造不并判据门=死代码+单测假绿）；判据单源不变量（分批=authenticate 走新链 sweep 走旧三段=双权威窗口）；信号量限流冗余查询无意义 |
| **P-L（v2）color 迁移收口五件套（同 commit）** | ①shared 新建 `collab-identity-color.ts` 单源（COLORS+hash\*31 算法从 awareness.ts:26-30 **原样挪**，两端 import 同一函数）；②serverIdentityOf 注入 `{id,name,role,color}`（spec §3.3 原文）；③RemoteCursors/CanvasTopBar 切读 `s.user.color`；④**删** awareness.ts 的 `userColor`+`setLocalUser` 只退位 user 字段写入（**replayLocalUser 保留**——runtime:147 终态重建/:982 pagehide 自愈两处承重，R24 终裁注释）；⑤等价性锚（服务端注入 color==客户端同源算法自算值）+首帧可见性锚（新连接首帧含 user→对端最终可见）。**fallback 驳回**（第三份 `s.user.color ?? userColor(id)` 提案）——同源算法迁移=等价性保证：旧 bundle 自算 userColor(id) 与新服务端注入必然同值（同一纯函数同一输入），部署窗口混合态不存在"同人两色"；fallback=开发期禁兼容层纪律下的第二真源入口。**role 注入维持 spec**（§3.1 v2.1"只治写不治显示"修复=T8 role 改写；消费方=Y0b-4 成员表，铺路登记 §0.4） | spec §3.3+§9.2 终裁；评审"无消费方"实证成立但推论错——证明的是"迁移只做了一半"（消费面需切字段，spec §3.6"预期零改动"措辞更正登记 §0.4） |
| **P-M（v2）重连所有权单一化** | **唯一退避源**=connectionMachine.RECOVER_BACKOFF_MS（:9 既有 [5s,10s,20s,30s]）+reduce()（recoveryAttempts/cooldownMs 已带）；**唯一执行器**=recovery.recoverConnection()（单飞）；close 事件**只写状态**（resolveCloseAction 分型→wsAuthNotice/plannedRestartUntil/machine 输入），**禁直调 connect()**；1012 分支 :854-855 裸 websocketProvider.connect() 收编（既有 30s 窗+1~3s 短退避行为经 conn.spec:213-264 锚维持）；库 delay/maxDelay/initialDelay 显式 pin 并声明从属（库 retry ladder 与 machine 表的关系注释钉死——禁两套并存不声明）；terminal 停连=`websocketProvider.disconnect()`（真开关 esm:367-376 置 shouldConnect=false——**provider.disconnect() 是真转发**〔manageSocket=true 分支 esm:843-849，F-1 no-op 论驳回〕但显式调 websocketProvider 层消歧）+terminalSuppressed 电平；recoverConnection terminal 判定补语义级（wsAuthNotice.terminal 值源——:960 machine 输入已接线）；**connect() 首行置回 shouldConnect=true（esm:225）⇒ terminal 后任何路径禁再调 connect**（watchdog/recovery 复发防线） | connectionMachine.ts:9/:31+runtime:955/:960 既有实证；四路并发重连风险（库 onClose 1s 定时器+库 retry ladder+watchdog+新建调度器）；输出级验收锚（websocketProvider.connect 调用数==0+WebSocketPolyfill 构造计数） |
| **P-N（v2）close code 库值单源** | 4205/4401 Unauthorized/4403/4408/1009 从 `@hocuspocus/common` 导入（esm:137 已 export 常量）——禁重写库值字面量；shared 仅定义应用侧自有码（1012/4402+预留 4404/4410 注释）；**(4408,'forced') 客户端合成码**（provider esm:342-357 三击强制）进映射表分型——区别于库 (4408,'Connection Timeout')；1009→terminal 档（内容确定性重连重发=无限循环；用户可达配额终态=Y0b-4 4404） | 与库漂移防线；第二轮 P1-4/P1-5 |
| **P-O（v2）heap 薄 reaper+观测补强〔v3 部分取代——卸载动作删（见 P-V①），观测指标与守卫复用维持〕** | reaper=5min 扫零连接 doc：**先 spec §3.1ter 自队列谓词**（pendingQueue 空∧无在飞 store∧spool 无未确认帧——终裁保留，库守卫不覆盖我们的队列）→**调 `server.hocuspocus.unloadDocument(doc)`**（Hocuspocus 实例+Document 参数——非 Server 名参）**先判 `shouldUnloadDocument(doc)`** 才计 reaped（守卫拒绝=跳过，连续 2 轮拒才计 stuck——库三守卫 isDebounced/saveMutex/connectionsCount 不重复实现）；**红锚④改形态**（gateway 契约 3"任何路径不 throw"实证⇒库"保内存"catch 分支〔esm:1541-1547〕本仓不可达——spec §3.2 前提修正登记 §0.4；锚改 stub 守卫不满足→reaper 兜底）；删 v1 的 withDoc 平行判据（onLoadDocument 单点已覆盖三入口+collab-document.service.ts:142"readCanvas/withDoc 本体不 gate"不变式注释尊重——spec §3.2"唯一装载汇聚点"原文即此义）；check-ecosystem 断言链**单源提取** heap-pressure.ts 导出 HEAP_DEFAULTS（消 145MB/138.8MB 双源）；新增 Gauge `yjs_pending_bytes`（池外内存——pendingQueues 在 external 不进 heapUsed，早于 RSS 可见）+`yjs_zero_conn_docs`（collect）+`yjs_store_unexpected_throw_total`（Y2 兜底 catch 处）；删 collab_doc_store_failed_total（spool 既有观测覆盖+契约 3 恒零） | 第二轮 P0-3+H-4/M-11/P-L 提案裁决合流 |
| **P-Q（v2）认证防线修正组** | refusalCache fingerprint=**sha256(parseSessionToken(cookie) ?? payload.token)**（cookie-only 后 payload.token 恒 'cookie-auth' 占位⇒'anon' 塌缩=跨用户 15s 放大——修正为真实凭据）；**清空钩子单点化**：任一 `transition('serving')` 转移清+heap 释放+spool 恢复（fence 解除含于 serving 转移——比枚举 drain/lease 因由稳，漏一即残留）；**执行序修正回 spec 钉死序** `refusalCache→信号量→桶`（v1 实现笔误桶在前）；三 Map 老化（refusalCache 过期条目定期清+authAttemptBuckets 定期清〔防只握手不认证风暴喂新 socketId〕+上界清最旧）；**INFLIGHT_MAX 默认 4**（池公式 cpu×2+1=5 对齐——8×3 查询>池 5=P2024 折 db-unavailable；spec §7.1 默认 8 修正登记 §0.4）；**AUTH deadline=常量 3s**（Promise.race 包 DB 段超时折 db-unavailable+collab_auth_timeout_total——防慢 DB 挂满信号量；不加 env=YAGNI）；auth_reject_total 加 `source` 标签（state/semaphore/bucket/heap/version） | M-5/M-12/P1-7/P-N 裁决合流 |
| **P-R（v2）Origin/upgrade 收紧组** | 生产剔除 localhost（仅显式 COLLAB_ALLOWED_ORIGINS 才含——非浏览器工具可注入任意 Origin，localhost 在表=多余绕过面；dev 推导表保留）；生产 `BETTER_AUTH_URL`∧`COLLAB_ALLOWED_ORIGINS` 双缺 superRefine **fail-fast**（env 层拒启——COLLAB_FAKE_AI 先例形态；防"忘配=推导默认值静默错"）；Origin 拒绝形态=`socket.write('HTTP/1.1 403...Content-Length:0')+socket.end()`（**end 替代 destroy**——write 后立即 destroy 可能丢弃未发送字节=客户端收 RST 非 403；spec §3.1ter 形态微偏离登记）；升级限流拒绝同形态 429；**parse-session-token 三形态门**（T2 Step 0：正则 `/flowweb\.session_token=([^;]+)/` 现锚定裸值——生产 https 下 BetterAuth 若用 `__Secure-` 前缀 cookie 名则不匹配=全站静默拒；探针确认 cookie 名+三形态用例：正常/前缀变体/多 cookie 并存）；同源 Origin 判据（Origin.host===Host）**驳回**——nginx $host 取请求行 Host=客户端可控，直连伪造 Host+Origin 同值即绕过；XFF 最右跳回退**驳回**（E58/Y0.5 既定域） | P-O/P1-3/A-1 裁决合流 |
| **P-S（v2）write-frozen 最小形态** | **connected 重放删除**（v1 P-J 的 (a) 半）——drain 期新连接被 :255 DRAINING 拒⇒"重连成功需重放冻结态"**无对象**（第二份实证论证）；spool 降级经 authenticate :257-261 每次重连自恢复（无需快照重放）；本批=`{type:'write-frozen',reason}` 事件+客户端 writeFrozen 写点+横幅+authenticated 清零+**H-5 修正**：frozenConnections 从 Set 升 **Map<conn,prevReadOnly>**，drain 解除**先还原 readOnly 再 close**（:669-673 现状只 close——close 在 CLOSING 态 no-op 的边角=永久只读；状态自洽而非依赖重连施舍）；幂等快照模型（含 quotaState）**整体归 Y0b-4 定型**（本批不做快照抽象） | 第二份 P-Q/H-5 论证采纳+范围收窄 |
| **P-T（v3）T10 保活整删** | **三环实证链**：①y-protocols awareness.cjs:85-89 `// renew local clock this.setLocalState(this.getLocalState())`——每 15s（outdatedTimeout/2）自续期，Awareness 构造即 setLocalState({}) 使 getLocalState()!==null 恒成立（远端清场删不掉本地态）；②provider esm:776-780 `if (origin === this) return`——续期帧 origin='local' 字符串≠provider 实例⇒发送；③server esm:671-673 broadcastAwarenessUpdate 无 origin 过滤⇒**回显发送者**（solo 单连接也收）⇒ **空闲连接每 ~15s 有双向 awareness 帧、两侧 lastMessage 计时器恒被刷新**——spec §5.2"空闲零应用层消息⇒30-60s 判死四害"前提在本仓不成立（spec 引证 forceSyncInterval=false 正确但漏了协议层自续期）。后台标签节流场景 15s setInterval ping 受同一节流=前后台都无价值。**P14 向量随钩子不注册归零**（库默认 onStateless=Promise.resolve(null) 不抛）；T1 unhandledRejection 兜底独立保留（真正买单者=T2 onUpgrade catch→throw）。删：ping/pong、服务端 onStateless 钩子、collab_stateless_* 三指标、messageReconnectTimeout 45s pin、forceSyncInterval pin（续期帧即保活+补传兜底已有 forceSyncAndWaitUnsynced :1104 按需）。T10 改写为证伪性只读锚（今日即绿）；spec §5.2/§7.2 两行勘误登记 | 第三份 P0-1 三环一手复核全实证 |
| **P-U（v3）T8 awareness clock+权限语义 A** | ①**rewriteAwarenessRole 必须先递增 meta.clock**：applyAwarenessUpdate 按 `currClock < clock \|\| (currClock===clock && state===null && has)` 判据——服务端直接改 states 不动 meta⇒编码用旧 clock⇒对端全丢弃而服务端自以为成功（假绿型同 T7 警告）；修=meta.set(clientId,{clock:(old)+1,lastUpdated:now})+states.set+广播；锚改断言**对端可见值**（T7 注入能生效恰因骑在入站帧更高 clock 上——服务端自发写无帧可骑）。②**权限语义选 A**：removeMember 不触碰 ProjectMember 表（实证）⇒统一 resolveWithTeam 后"移出团队但有显式项目授权=保留画布访问"=**REST 面既有行为（assertEditor 同链）的 WS 一致化**——非放宽；§0.4 登记+int 两例（显式授权存活/普通成员被踢）+recheckConnection 返回 cause 分型（no-role/session-invalid）；B 案（移除即全撤）会改 REST 语义超范围驳回；成员管理 UI 的项目级授权撤销入口登记 Y0b-4 | 第三份 P0-2/P0-3 实证 |
| **P-V（v3）观测与结构收尾组** | ①reaper **卸载动作删**：自队列谓词与库守卫在可达状态同真（队列非空⇔库 debounce/飞/mutex 必真）+库 store 后必排 setTimeout unload 自愈（esm:1550-1552）+保内存分支本仓不可达（偏离 1）⇒reaper 唯一对象不存在——保留 yjs_zero_conn_docs+shouldUnloadDocument===false 连续轮次计数（卡住探针），删 yjs_doc_reaped_total 与卸载用例；②heap 布尔结构改**两量纲各自 trip/release**（v2 标量 max 形态使 RSS 实效释放线=0.7×750=525MiB≠声明 600MiB——RELEASE_BYTES 从未进运行时）：`tripped = heapRatio>=0.8 \|\| rss>=750MiB；released = heapRatio<0.7 && rss<600MiB`——check-ecosystem 断言的三个数全部变运行时真值+§9.15 单调序恢复；③HEAP_DEFAULTS 提取式钉死 `([\d_]+)`+剥下划线+提取失败 fail-closed（`\d+` 在 786_432_000 截断成 786=静默错绿）；④`clientIdOwner` 反向索引（ownedByOthers 每帧 O(连接数) 是光标热路径——改 Map<clientId,socketId> O(1) 判定+顺带一致性校验源）+owned 剪枝（库 clients 集并集+本帧双向核对）+上限触发计数；⑤silentRenewUsed 在 authenticated 事件重置（每次成功认证重置一次静默额度）；⑥删 'reconnect' 死档（4402 归 backoff——T9 close 映射对 reconnect 零动作=死档复发）；⑦sweep 逃生阀拆 timer（寿命/reaper 观测/Map 老化各自独立——`SWEEP_ENABLED=false` 禁止静默关掉寿命与老化，只罩 session+perm 复验）；⑧1009 真连观测探针（ws 超 maxPayload 时客户端实际收 1009 或 1006 未验证——一次真连定论）+逃生按钮接 message-too-big；⑨CollabUser 扩 role/color（TS strict 下 s.user.color 类型必需）；⑩无 cookie 不写 refusalCache（anon 键互相覆盖状态拒绝）+dev Origin 表补 127.0.0.1:5173；⑪「准入四层全进程内状态、部署即复位」注释（kill switch 不需要的可查依据）；⑫S-1 夹具补 resolveWithTeam（dual-client-server:47 无此 mock——T3 落地全部真连红且伪装 DB_UNAVAILABLE）；⑬S-2 删 CANVAS_DOC_SCHEMA_VERSION_REF（shared→apps 跨包反向依赖=构建环）+删 PROTOCOL_COMPAT（单键 satisfies 恒满足——"tsc 强制 bump"论证证伪；negotiateClientVersion 改字面量比较，spec 矩阵形态偏离登记） | 第三轮 S 组/必修清单/7.x 采纳合流 |

**§0.2 本批新增指标全表（store.metrics.ts 单源；进 spec §7 fenced 同步；全部小写命名——extractMetricNames 正则约束）**

| 指标 | 类型/标签 | Task | v2 变更 |
|---|---|---|---|
| `collab_upgrade_rejected_total` | Counter, reason=origin\|rate-limited | T2 | — |
| `collab_auth_reject_total` | Counter, reason+**source**（state\|semaphore\|bucket\|heap\|version） | T3/T4/T5 | **v2 加 source 标签** |
| `collab_auth_inflight` | Gauge（collect 口径——registerPendingCollector 挂载） | T3 | v2 明确 collect 形态 |
| `collab_auth_timeout_total` | Counter（AUTH deadline 3s 触发） | T3 | **v2 新增**（随 P-Q deadline） |
| `collab_load_rejected_total` | Counter, reason=server-overloaded | T4 | — |
| `collab_overload_state` | Gauge, state=ok\|tripped（互斥两 series） | T4 | — |
| `yjs_doc_stuck_total` | Counter（**v3：零连接 doc 的库守卫〔shouldUnloadDocument〕连续 2 轮拒绝计数——卡住探针**；~~yjs_doc_reaped_total~~ v3 随卸载动作删除〔P-V①：reaper 唯一对象不存在〕） | T4 | **v3 观测收窄** |
| `yjs_pending_bytes` | Gauge（pendingQueues 字节和——池外内存早于 RSS 可见） | T4 | **v2 新增**（P-O） |
| `yjs_zero_conn_docs` | Gauge, collect（零连接常驻 doc 数——reaper 观测面） | T4 | **v2 新增**（P-O） |
| `yjs_store_unexpected_throw_total` | Counter（Y2 兜底 catch 处——契约 3 最后一道闸） | T4 | **v2 新增**（P-O） |
| `collab_version_negotiation_reject_total` | Counter, reason=client-version-missing\|client-version-invalid\|schema-outdated\|**server-outdated** | T5 | **v2 加第四档** |
| `collab_ws_close_total` | Counter, code+reason（gateway 应用侧 close 单点埋：drain 解除/closeAll/sweep/寿命/团队解散。**v3 边界登记**：onDisconnectPayload 无 close code 字段——库自发/自然断连的服务端观测结构性不可达，归 Y0b-5 客户端遥测；本指标=应用侧主动 close 分布） | T6 | **v2 新增+v3 边界钉死** |
| `collab_awareness_reject_total` | Counter, reason=owner-limit\|forged\|**ghost**（归属三分支的上限触发丢弃+伪造丢弃+空态首见帧剔除〔T10 修复补档——ghost 异常增高=客户端非空态播种退化信号〕——"用户光标消失"类故障的可观测出口） | T7 | **v3 新增**（S-3：上限触发无观测=静默故障；**ghost 档=T10 发现修复批补**） |
| `collab_unhandled_rejection_total` | Counter, source（全局兜底函数） | T1 | — |

**v2 删除**：~~collab_doc_store_failed_total~~（spool 既有观测 yjs_spool_write_failatures 等覆盖+gateway 契约 3"任何路径不 throw"使其恒零）。**v3 删除**：~~collab_stateless_bad_payload_total / collab_stateless_unknown_total / collab_stateless_ping_total / collab_stateless_last_ping_age_seconds~~（随 T10 整删——P-T；服务端 onStateless 钩子不注册=P14 向量归零）。~~yjs_doc_reaped_total~~（P-V① reaper 卸载动作删除）。（`collab_idle_timeout_total` 载体=客户端遥测 close_code 事件族——**Y0b-5 sink 域**，本批仅在映射表分型 4408→idle-timeout+diag ring 记录，登记 §0.4。）

**§0.3 env 新键全表（env.ts :65-81 形态：blankToUnset+optional 不写 default——默认值落使用点；新键恰好两空格缩进——extractEnvKeys 正则约束；COLLAB_MAX_LOADED_DOCS 预留维持零消费不动）**

| 键 | zod | 默认（使用点） | Task |
|---|---|---|---|
| COLLAB_ALLOWED_ORIGINS | string.min(1).optional() | BETTER_AUTH_URL origin 推导+**仅 dev 含 localhost:5173**（生产剔除——P-R） | T2 |
| COLLAB_TRUSTED_PROXY | z.enum(['1']).optional() | 未设=不信任 X-Real-IP（生产必设——部署告知） | T2 |
| COLLAB_UPGRADE_RATE_PER_MIN | coerce.number.int.positive.optional() | 60（burst=20 常量，注释"多标签友好"） | T2 |
| COLLAB_AUTH_ATTEMPTS_PER_MIN | 同上 | 10 | T3 |
| COLLAB_AUTH_INFLIGHT_MAX | 同上 | **4（v2——池公式 cpu×2+1=5 对齐，注释依据；spec §7.1 写 8 修正登记 §0.4）** | T3 |
| COLLAB_REFUSAL_CACHE_TTL_MS | 同上 | 15000 | T3 |
| COLLAB_RSS_TRIP_BYTES | 同上 | 786432000（750MiB——heap-pressure.ts 导出 HEAP_DEFAULTS 常量表单源） | T4 |
| COLLAB_RSS_RELEASE_BYTES | 同上 | 629145600（600MiB） | T4 |
| COLLAB_HEAP_PRESSURE_RATIO | coerce.number.min(0.5).max(0.95).optional() | 0.8（release 比例=trip−0.1 迟滞带；**双量纲维持 spec**——RSS 项管池外膨胀） | T4 |
| COLLAB_CONN_MAX_LIFETIME_MS | 同上 | 43_200_000（12h） | T6 |

**v2 非 env.ts 但同批登记**：生产 superRefine fail-fast——`NODE_ENV=production` 时 BETTER_AUTH_URL 与 COLLAB_ALLOWED_ORIGINS 至少其一（P-R）；`.env` 的 `DATABASE_URL` 显式 `connection_limit=5&pool_timeout=5`（**v3.1 修正：pool_timeout 单位=秒**——原 5000≈83min=P2024 兜底近失效；对照=池 5−REST/worker 预留≥INFLIGHT 4；部署清单+runbook 登记）；AUTH deadline=**常量 3s**（不加 env——YAGNI，P-Q）。

---

**§0.4 偏离预登记（v2 新建 v3 扩至 14 条，T3 评审修复补 15，T5 评审修复补 16——与 spec 正文措辞的差异单源；实施完随 T11 回填落地形态）**

| # | 偏离 | 依据 |
|---|------|------|
| 1 | 红锚④前提修正：spec §3.2「store 失败保内存⇒失败 doc 永驻」在本仓 gateway 契约 3（任何路径不 throw）下**不可达**——reaper 价值收窄为"库守卫（debounce/saveMutex）卡住窗口"兜底；锚形态改 stub 守卫不满足（spec 侧同步勘误建议） | P-O；esm:1541-1547+gateway store 路径实证 |
| 2 | write-frozen connected 重放删除：drain 期新连接被 :255 DRAINING 拒⇒重放无对象（spec §5.3 幂等快照 (a) 半的窗口分析修正）；快照模型整体归 Y0b-4 与 quotaState 同批定型 | P-S |
| 3 | spec §3.3「消费面读注入同形字段=预期零改动」更正：RemoteCursors/CanvasTopBar 现自算 userColor(id)——需同批切 s.user.color（等价性算法保证同色零回归） | P-L；userColor 消费面实证 |
| 4 | 版本门四档（spec 三档+server-outdated）：csv>current=reload 无效档（提示服务端待更新）——文案分型非放行，精确相等语义不变（R 终裁禁区间协商维持） | M-4 采纳 |
| 5 | Origin 拒绝形态 socket.end 替代 destroy（flush 保证客户端收 403 非 RST）；升级限流 429 同族补全（spec 仅钉 403） | P-R |
| 6 | INFLIGHT_MAX 默认 4（spec §7.1 写 8）——与池公式 cpu×2+1 对齐；AUTH deadline 常量 3s（spec 无此项）；**口径（v3.1）：信号量/deadline 约束的是槽位占用≠DB 在飞**——race 到期不取消底层 Prisma 查询，DB 真实并发由池 connection_limit=5 兜底 | P-Q |
| 7 | sweep 复验语义补正：spec §3.1「复验补 perm.resolve」隐含 sweep 会调用复验——现状 :1144 判据门使复验仅 session 过期死线触发；T3 加 dueForPerm 分支（5min 结论缓存到期=权限复验到期） | P-K；:1144 实证 |
| 8 | writeFrozen 置位点归属：syncStatus.ts:14 注释归 Y0b-5（Z55）——本批 T9 落置位点（writeFrozen 写点+横幅），Y0b-5 只扩 quotaState 载荷（跨批归属冲突消解；T9 同 commit 改注释） | 评审 9.2-1 |
| 9 | maxPayload 行为断言（>16MiB 真连验 1009）归 Y0b-4（spec §4.1⑥ 维持）——本批仅配置 pin+websocketOptions 键集断言 | spec §4.5 出口清单在彼 |
| 10 | awareness role 注入与 T8 role 改写维持 spec（评审"零消费方不注入"驳回）——消费方=Y0b-4 成员表+降级显示（§3.1 v2.1"只治写不治显示"修复），铺路登记 | P-L |
| 11 | **T10 保活整删**：spec §5.2 stateless ping 设计+§7.2 forceSyncInterval pin 两行前提在本仓证伪（awareness 15s 自续期+服务端回显=空闲恒有双向帧——P-T 三环实证）——**spec 侧勘误登记**（v2.3/v2.4 九轮外审漏了 y-protocols 协议层自续期）；T10 改写为证伪性只读锚 | P-T |
| 12 | **权限语义 A**：统一 resolveWithTeam 后"移出团队但有显式 ProjectMember 行=保留画布访问"——REST 面既有语义的 WS 一致化（非放宽）；int 两例固化+cause 分型；成员管理 UI 的项目级授权撤销入口登记 Y0b-4 | P-U② |
| 13 | **reaper 卸载动作删除**：spec §3.2 释放路径（5min reaper 调 unloadDocument）的可达性论证——自队列谓词与库守卫同真+库 store 后自愈排程+保内存分支本仓不可达（偏离 1）⇒ reaper 唯一对象不存在；保留卡住观测（zero_conn_docs+守卫拒绝连续计数）——**偏离 1 的彻底版** | P-V① |
| 14 | **PROTOCOL_COMPAT 矩阵删除**：spec §3.4"兼容矩阵 tsc 封闭"形态偏离——"单键 Record 强制 bump"论证证伪（satisfies 恒满足）；运行时等价=字面量精确比较（`n === CLIENT_PROTOCOL_VERSION`）；版本 bump 纪律=CLIENT_PROTOCOL_VERSION 常量单点+红测断言值 | P-V⑬（S-2） |
| 15 | **升回分支停写守卫+角色超集**：recheckConnection 升回（readOnly→false）在 E13「VIEWER 翻案」措辞外覆盖全部可写角色（OWNER/EDITOR 等非 viewer 非 null）；且追加停写状态守卫——draining/spool-unwritable 期 readOnly 连接（drain 冻结/spool 降级置位）复验即使 role 可写也不解冻（readOnly 三写者共享——升回撞 drain 冻结=≤60s 窗内静默解冻，破 SV9/B12 部署停写契约）；降级方向不加守卫（降级永远安全） | T3 评审 I-2（P-K 延伸） |
| 16 | **ready 公开档四键→五键**：无 token 档显式解构重组追加 `collabProtocolVersion`（翻新 Y0a-4「公开档四键契约不动」）——P-C loop 键载体最后一公里：客户端版本终态（schema-outdated）单次探测 /api/ready 拿服务端版本作 reload loop 键，浏览器仅可达 PUBLIC 档（无 token），授权档下发=字段结构性到不了客户端；V17 裁剪意图不变（holder/pending/host+pid 内部信息仍不出公网面，仅放开版本键——service base 三分支恒带，controller 公开档同步下发） | T5 评审 P-C 消费面断裂发现（loop 键载体失效） |

---

### Task T0: shared 契约地基（词表+close-code〔库值单源〕+协议版本+ready reason 核对）

**Files:**
- Modify: `packages/shared/src/constants/collab-auth-reason.ts`（追加 6 值〔v2 含 SERVER_OUTDATED〕+终态表）
- Create: `packages/shared/src/constants/collab-close-code.ts`（**应用侧自有码 only——库值从 @hocuspocus/common 导入重导出**，P-N）
- Create: `packages/shared/src/constants/collab-protocol.ts`
- Modify: `packages/shared/src/index.ts`（导出）
- Test: `packages/shared/src/constants/collab-auth-reason.test.ts`（扩）+新建 `collab-close-code.test.ts`/`collab-protocol.test.ts`
- 核对: `packages/shared/src/constants/collab-ready.ts`（ready reason 词表——**评审已核验 :4-7 八值含 not-serving/spool-unwritable=已备零改动**，Step 0 确认即登记）

- [ ] **Step 0: 探针**——读 collab-ready.ts :4-7 确认八值已备（预期零改动登记）；读 `node_modules/@hocuspocus/common/dist` 确认 4205/Unauthorized 4401/Forbidden 4403/ConnectionTimeout 4408/MessageTooBig 1009 常量导出名（esm:137 已 export——import 名照抄）；读 index.ts 导出形态。输出粘 commit message。

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
it('词表 append-only 全集=13 值（七旧+六新）', () => {
  expect(COLLAB_AUTH_REASONS).toHaveLength(13); // v2：七旧+六新（server-outdated 第四版本档——M-4）
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
  SERVER_OUTDATED: 'server-outdated', // v2 M-4：csv>current（客户端新于服务端）——瞬态档（服务端待更新提示，reload 无效不自动刷）
} as const;
// TERMINAL_AUTH_REASONS 追加三档：
    CollabAuthReason.SCHEMA_OUTDATED,
    CollabAuthReason.CLIENT_VERSION_MISSING,
    CollabAuthReason.CLIENT_VERSION_INVALID,
// Set 上方注释：SERVER_OVERLOADED/RATE_LIMITED/SERVER_OUTDATED 瞬态档严禁入终态（spec §3.2/§5.2——误入=一次内存尖峰/一次拥塞把全部客户端钉死且不自愈）
```

- [ ] **Step 4: 绿跑** ✓ 后 **commit**：`feat(y0b-3): T0 词表追加六值+isTerminalReason 五档终态（版本族 reload 档）`

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
it('4402 max-lifetime=backoff 档（v3：~~reconnect~~ 死档删除——T9 close 映射对 reconnect 零动作=死档复发；寿命尽重连走 machine 既有退避防极端齐步）', () => {
  expect(resolveCloseAction(4402, 'max-lifetime').kind).toBe('backoff');
});
it('库自发瞬态族=4205/4408 落 backoff 档（4205 无超限语义——客户端禁由它推断成因）；4408 双 reason 分型：库 "Connection Timeout"=backoff ≠ 客户端合成 "forced"=backoff-agg（三击强制的恶化档——诊断区分）', () => {
  for (const c of [4205, 4403]) expect(resolveCloseAction(c, '').kind).toBe('backoff');
  expect(resolveCloseAction(4408, 'Connection Timeout').kind).toBe('backoff');
  expect(resolveCloseAction(4408, 'forced').kind).toBe('backoff');
  expect(resolveCloseAction(4408, 'forced').synthetic).toBe(true); // provider esm:342-357 合成码标记
});
it('1009=terminal 档（内容确定性：重连重发同一超限帧=无限循环——用户可达配额终态归 Y0b-4 4404 自救）', () => {
  expect(resolveCloseAction(1009, '').kind).toBe('terminal');
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
/** close code 全集分配表（spec §3.5）——应用侧自有码本文件定义；**库自发码从 @hocuspocus/common 导入重导出**
 * （P-N 单源——禁重写库值字面量，与库漂移防线）。组件禁散落判 code（扫描锚）。
 * 库自发语义：4205 ResetConnection（通用重置码，pre-auth 队列超限等多处复用，本身不携带"超限"语义
 * ——配额提示必须配服务端计数指标）/4401 Unauthorized（reason 字面量 "Unauthorized"）/4403 Forbidden/
 * 4408 ConnectionTimeout（注意：provider 客户端合成 (4408,'forced') 三击强制〔esm:342-357〕——双键分型
 * 以 synthetic 标记区分诊断）/1009 MessageTooBig。
 * 应用侧：1012 计划内重启（既有）/4401 'session-expired'（sweep）/1000 team disbanded/
 * 4402 max-lifetime（本批新）——4404 doc-over-quota/4410 generation-superseded 为 Y0b-4/Y1c-1 预留值（注释钉死）。 */
import { WebSocketCloseError } from '@hocuspocus/common'; // Step 0 探针确认实际导出名/形态后照抄

export const CollabCloseCode = {
  // —— 应用侧自有码 ——
  NORMAL: 1000,
  APP_RESTART: 1012,
  SESSION_EXPIRED: 4401,        // 应用 sweep（reason='session-expired'）与库 Unauthorized 同码异 reason——双键分型
  MAX_LIFETIME: 4402,
  // —— 库自发码（@hocuspocus/common 单源重导出——P-N）——
  LIB_RESET: 4205,
  LIB_UNAUTHORIZED: 4401,
  LIB_FORBIDDEN: 4403,
  LIB_CONNECTION_TIMEOUT: 4408,
  LIB_MESSAGE_TOO_BIG: 1009,
  // 预留（本批不产生，Y0b-4/Y1c-1 消费）：DOC_OVER_QUOTA: 4404, GENERATION_SUPERSEDED: 4410,
} as const;

export type CloseActionKind =
  | 'terminal'            // 终态：不重连（terminalReason 转四/五档 UX；1009 内容确定性归此档）
  | 'silent-renew-once'   // 4401 'session-expired'：静默重连一次，失败才终态
  | 'planned-restart'     // 1012：既有 30s 窗+1~3s 短退避链路（runtime :846-857 收编）
  | 'backoff'             // 瞬态退避（4205/4403/4408/4402/未知——machine 既有退避表；v3：~~reconnect~~ 档删除）
  | 'normal';             // 1000

export interface CloseAction { kind: CloseActionKind; terminalReason?: string; synthetic?: boolean }

export function resolveCloseAction(code: number, reason: string | undefined): CloseAction {
  // (code,reason) 双键分型（spec §5.2 v2.1）——只判 code 会把库 Unauthorized 当会话过期无限续期
  if (code === CollabCloseCode.SESSION_EXPIRED) {
    if (reason === 'session-expired') return { kind: 'silent-renew-once' };
    return { kind: 'terminal', terminalReason: 'session-expired' }; // 含库默认 'Unauthorized'/reason 缺失
  }
  if (code === CollabCloseCode.APP_RESTART) return { kind: 'planned-restart' };
  if (code === CollabCloseCode.NORMAL) return { kind: 'normal' };
  if (code === CollabCloseCode.LIB_MESSAGE_TOO_BIG) return { kind: 'terminal', terminalReason: 'message-too-big' };
  if (code === CollabCloseCode.LIB_CONNECTION_TIMEOUT) {
    return reason === 'forced'
      ? { kind: 'backoff', synthetic: true }   // 客户端合成（三击强制）——诊断标记
      : { kind: 'backoff' };
  }
  return { kind: 'backoff' }; // 4205/4403/4402 max-lifetime/未知——全瞬态退避档
}
```

（4403 Forbidden 库自发——落 backoff：它出现在认证后权限撤销族，sweep/事件驱动会先踢，此处 fail-safe 重连后由 auth 面给出权威 reason。1009→terminal〔v2 P-N〕：重连重发同一超限帧=无限循环；用户可达的配额终态+自救通道=Y0b-4 的 4404 档。）

- [ ] **Step 6: 绿跑+commit**：`feat(y0b-3): T0 close code 分配表+(code,reason) 双键分型单源`

- [ ] **Step 7: 新建 collab-protocol.ts（两常量分离+兼容矩阵）**

```ts
// collab-protocol.test.ts
import { CLIENT_PROTOCOL_VERSION, negotiateClientVersion } from './collab-protocol';
it('csv 缺失/不可解析不进比较——分档在 negotiate 前置分支', () => {
  expect(negotiateClientVersion(null)).toBe('client-version-missing');
  expect(negotiateClientVersion('')).toBe('client-version-missing');
  expect(negotiateClientVersion('abc')).toBe('client-version-invalid');
  expect(negotiateClientVersion('1.5')).toBe('client-version-invalid');
});
it("精确相等——'0'（非正整数）=client-version-invalid（v3 三处矛盾统一：csv=0 只可能来自伪造/第三方客户端，无法推断语义）", () => {
  expect(negotiateClientVersion('1')).toBe('allow');
  expect(negotiateClientVersion('0')).toBe('client-version-invalid');
});
it('四档分型（v2 M-4+v3 修正）：csv>current=server-outdated（reload 无效档）；csv<current=schema-outdated 用 current 注入测——首版协议=1 下比 1 小的正整数不存在，该档结构性不可达（首次 bump 后才可达）', () => {
  expect(negotiateClientVersion('999')).toBe('server-outdated'); // 999 > 1
  expect(negotiateClientVersion('1')).toBe('allow');
  expect(negotiateClientVersion('1', 2)).toBe('schema-outdated'); // 注入 current=2（bump 后形态）——csv=1 旧客户端
});
it('版本 bump 纪律锚：CLIENT_PROTOCOL_VERSION 值断言（v3：矩阵已删——常量单点+bump 时本测改值即红）', () => {
  expect(CLIENT_PROTOCOL_VERSION).toBe(1);
});
```

```ts
// collab-protocol.ts
/** 两常量分离（spec §3.4）：CANVAS_DOC_SCHEMA_VERSION（docShape.ts=2，既有——文档结构，Y1c bump）
 * ≠ CLIENT_PROTOCOL_VERSION（本文件——客户端代码/线路协议，URL ?csv= 所指）。两常量分属 api/shared 两包
 * ——禁跨包 import（shared→apps 反向依赖=构建环，v3 S-2）；分离性由命名+注释表达，doc 版本核对归 T5 Step 5bis 只读。
 * 通道=query（R-6 终裁：provider 无 query 配置项，URL 由调用方构造；csv/cb 非凭证，与 cookie-only 不矛盾）。
 * 4.6.0 onAuthenticatePayload.providerVersion 为库内部硬编码值（d.ts:483）——与本协议无关，禁用（P6 勘误）。
 * v3：~~PROTOCOL_COMPAT 矩阵~~删除（单键 satisfies 恒满足——"tsc 强制 bump"论证证伪，偏离 14 登记）；
 * 运行时=字面量精确比较；无区间协商（开发期禁兼容层，R 终裁）。 */
export const CLIENT_PROTOCOL_VERSION = 1 as const;
export type ClientProtocolVersion = typeof CLIENT_PROTOCOL_VERSION;

export type VersionVerdict =
  | 'allow' | 'client-version-missing' | 'client-version-invalid'
  | 'schema-outdated'   // csv < current：客户端旧——reload 有效档
  | 'server-outdated';  // csv > current：客户端新于服务端——reload 无效档（v2 M-4 第四档）

export function negotiateClientVersion(csv: string | null | undefined, current: ClientProtocolVersion = CLIENT_PROTOCOL_VERSION): VersionVerdict {
  // current 参数=测试注入位（首版协议=1 下 schema-outdated 档无可达正整数输入——bump 后形态经注入测）；生产恒默认
  if (!csv) return 'client-version-missing';
  const n = Number(csv);
  if (!Number.isInteger(n) || n <= 0 || String(n) !== csv.trim()) return 'client-version-invalid';
  if (n === current) return 'allow';
  return n < current ? 'schema-outdated' : 'server-outdated';
}
```

- [ ] **Step 8: index.ts 导出+全绿+commit**：`feat(y0b-3): T0 协议版本常量+兼容矩阵 tsc 封闭（csv≠doc 版本显式分离）`

---

### Task T1: 进程地基（env 十键+SWEEP 默认开+trust proxy loopback+unhandledRejection 兜底函数化+库选项 pin）

**Files:**
- Modify: `apps/api/src/config/env.ts:65-81`（新键——§0.3 表 T2/T3/T4/T6 全部十个键本 Task 一次注册，消费点随后续 Task 落地；**键随读者同批防死键红**的 Y0b-2 教训适用单批内=本批读者在 T2-T6 全落地，非跨批死键）
- Modify: `apps/api/src/main.ts:87`+文件尾（trust proxy+兜底）
- Modify: `apps/api/src/modules/collab/collab.gateway.ts:207-232`（Server 构造 pin）
- Modify: `apps/api/src/modules/collab/store.metrics.ts`（collab_unhandled_rejection_total）
- Test: `apps/api/src/modules/collab/collab-gateway.options.spec.ts`（新建）+main 兜底测试（进程级——见 Step 5）

- [ ] **Step 0: 探针**——main.ts 是否已 import Sentry（兜底日志形态）；store.metrics register 导出形态；gateway spec 现有命名族（对齐 *.spec.ts 惯例）。输出粘 commit message。

- [ ] **Step 1: env.ts 注册**——按 §0.3 表十键插入 COLLAB 族块（形态=blankToUnset+optional；默认值注释指向消费 Task；**恰好两空格缩进——extractEnvKeys 正则约束**）。红测：env schema 解析测试（现有 env.spec 形态——Step 0 确认文件名）断言新键可解析+非法值拒。

- [ ] **Step 1bis: 生产 Origin 双缺 fail-fast（P-R）**

```ts
// env.ts schema 尾部 superRefine（COLLAB_FAKE_AI 生产拒 '1' 先例形态）
.superRefine((v, ctx) => {
  if (v.NODE_ENV !== 'production') return;
  if (!v.BETTER_AUTH_URL && !v.COLLAB_ALLOWED_ORIGINS) {
    ctx.addIssue({ code: 'custom', path: ['BETTER_AUTH_URL'], message: '生产必须显式 BETTER_AUTH_URL 或 COLLAB_ALLOWED_ORIGINS（Origin 白名单推导源缺失=部署配置错误 fail-fast）' });
  }
})
```

红测：production+双缺=zod 拒；任一在=过。

- [ ] **Step 2: trust proxy 收口（P-I）**

```ts
// main.ts:87
app.set('trust proxy', 'loopback'); // P-I：与 WS 侧 X-Real-IP 同信任前提（E58 完整收口归 Y0.5；全信任=true 收敛为一跳 loopback）
```

跑 apps/api 全测——**@nestjs/throttler 相关测试若因 req.ip 语义变化变红**：逐个核对是「测试夹具直连无代理=peer 即 req.ip（不变）」还是夹具自带 XFF（后者=夹具随真实语义修，登记进 commit message）。

- [ ] **Step 3: unhandledRejection 全局兜底（P14 崩溃向量兜底——T10 整删后本仓不自注册 async 钩子，真正买单者=库内部未 await 路径〔onUpgrade catch→throw esm:1633-1634 等〕全由此兜）**

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

（v2 定案〔评审 M-*/P-N 精化〕：**兜底必须函数化**——`installUnhandledRejectionGuard()` 独立导出（`apps/api/src/bootstrap/guard.ts` 新建），main.ts 调用+测试直接调用（实证 main.ts 直 import 即 listen——bootstrap 副作用不可测）；Sentry 接线在 main.ts:63-73 条件 import，guard 内复用 captureException 可选注入。）

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

- [ ] **Step 6: 全绿+commit**：`feat(y0b-3): T1 env 十键+Origin 双缺 fail-fast+trust proxy loopback+unhandledRejection 兜底函数化+库四 pin+sweep 默认开`

---

### Task T1.5: 准入面夹具基座（v2 新增——M-1；T2/T7/T10 全部真连红锚的共同硬前置）

**Files:**
- Modify: `apps/api/src/test-utils/dual-client-server.ts`（connect 换注入式 ws）
- Modify: 8 个真连 spec 的 `?token=` 调用点（Step 0 全量清单）
- Test: 夹具自身行为锚（Origin/Cookie 注入可见）

**背景（实证）**：①dual-client-server.ts:70 `connect(name, token)` 现用 `url: ${url}?token=${token}` + global WebSocket（Node ws 不发 Origin header）——T2 落地（Origin 校验+cookie-only+query token 删除）后**全部真连 spec 双杀**（无 Origin=403 拒+query token 无效）。②**v3 S-1**：dual-client-server.ts:47 `permSvc = { resolve: vi.fn() }` 无 `resolveWithTeam` mock（:29 类型声明同缺）——T3 落地后 `TypeError → catch 折 DB_UNAVAILABLE` =**全部真连红且症状伪装成 DB 故障**（误诊面）。本 Task 一并升级，T2/T3 零障碍落地。

- [ ] **Step 0: 探针**——grep `?token=` 全量调用点清单（评审计 8 spec ~60 处：dual-client-server/gateway.spec/auth-reason.spec/behavior-anchors.gate.spec/ws-polyfill.gate.spec/health-carrier.gate.spec/library-anchors.spec/shutdown.spec——以实测为准）；Node `ws` 构造器 headers 选项形态；装置 WebSocketPolyfill 注入路径（HocuspocusProvider WebSocketPolyfill 选项——runtime :876 同参）；**collab.gateway.spec.ts:159/:167 两处 `permSvc.resolve.mockResolvedValue` 覆写+collab.gateway.sweep.spec.ts:30 直构 perm 夹具**（resolveWithTeam 覆写改向清单）。输出粘 commit message。

- [ ] **Step 1: 红测——夹具注入可见性**

```ts
it('connect() 经注入式 ws 发送 Origin+Cookie header（网关侧 requestHeaders 可见）', async () => {
  const seen: Record<string, string> = {};
  await startGatewayWithAuthProbe(seen); // onAuthenticate 夹具记录 requestHeaders
  const { synced } = await connect('project:fx', 'tok', { origin: 'http://localhost:5173' });
  expect(seen.origin).toBe('http://localhost:5173');
  expect(seen.cookie).toContain('flowweb.session_token=tok');
});
```

- [ ] **Step 2: 实现**

```ts
// dual-client-server.ts connect 改造（签名向后兼容——token 语义改为 cookie 值）
connect(name: string, token = 'tok', opts: { origin?: string } = {}) {
  const ydoc = new Y.Doc();
  const origin = opts.origin ?? process.env.COLLAB_ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';
  class HeaderWs extends WebSocketPolyfillImpl { /* ws 构造器 headers 注入——Step 0 探针确定基类形态 */ }
  const provider = new HocuspocusProvider({
    url, name, document: ydoc,
    WebSocketPolyfill: makeHeaderWs({ origin, cookie: `flowweb.session_token=${token}` }),
  });
  // ...
}
```

（`?token=` query 全量删除——URL 不再带 query token；gateway 测试侧 origin 表经 `COLLAB_ALLOWED_ORIGINS` env 注入测试值或默认推导。）

- [ ] **Step 2.5: v3 S-1——夹具补 resolveWithTeam mock**

```ts
// dual-client-server.ts :47（:29 类型声明同步）——resolve 保留（project-member.service.ts:32-96 等 REST 侧消费不动，仅 gateway 判据换轨）：
const permSvc = {
  resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
  resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }),
};
// collab.gateway.spec.ts:159（VIEWER 场景）/:167（EDITOR 场景）覆写改打 resolveWithTeam：
//   permSvc.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_VIEWER', teamId: 't1' })
// collab.gateway.sweep.spec.ts:30 直构 perm 夹具同补。
```

- [ ] **Step 3: 全量真连 spec 回归**——8 spec 全绿（行为等价证明：cookie 通道承载原 token 语义）。若有 spec 断言 query token 形态本身（auth-reason.spec:165 等），按新装置语义改写断言（token 无效场景=cookie 缺失/伪造）。

- [ ] **Step 4: commit**：`feat(y0b-3): T1.5 准入面夹具基座——注入式 ws（Origin/Cookie header）+query token 退役+resolveWithTeam 夹具（S-1）`

---

### Task T2: upgrade 面（cookie-only+parse-session-token 三形态门+Origin 403+升级限流+address 默认翻转）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（:219 address/:249-250 token/onUpgrade 钩子+clientIpOf+upgradeBucket+allowedOrigins）
- Modify: `apps/api/src/common/utils/parse-session-token.ts`（三形态门——按 Step 0 探针结论定改否）
- Modify: `apps/api/src/modules/collab/store.metrics.ts`（collab_upgrade_rejected_total）
- Test: `apps/api/src/modules/collab/collab-upgrade.spec.ts`（新建——T1.5 夹具基座之上）

- [ ] **Step 0: 探针**——①**parse-session-token cookie 名形态**：better-auth 配置的 cookie 名生产 https 下是否带 `__Secure-` 前缀（`__Secure-flowweb.session_token`）——若是，现正则 `/flowweb\.session_token=([^;]+)/` 生产不匹配=**全站静默拒**（P-R 三形态门动机）；②COLLAB_ALLOWED_ORIGINS 测试注入路径（T1.5 装置约定对齐）。输出粘 commit message+**cookie 名结论**。

- [ ] **Step 0.5: 红测——parse-session-token 三形态门（P-R）**

```ts
it('三形态解析：①正常 ②__Secure- 前缀变体 ③多 cookie 并存（会话 cookie 不在首位）', () => {
  expect(parseSessionToken('flowweb.session_token=abc; other=1')).toBe('abc');
  // ② 前缀变体——Step 0 探针确认生产 cookie 名后二选一同 commit：
  //    a) 生产带 __Secure- 前缀⇒正则锚定实名（改 parse-session-token）；
  //    b) 确认裸名（useSecureCookies=false/自定义名）⇒本用例固化"无前缀"契约防未来漂移（零改动）
  expect(parseSessionToken('__Secure-flowweb.session_token=abc')).toBe(按探针结论);
  expect(parseSessionToken('a=1; flowweb.session_token=xyz; b=2')).toBe('xyz');
});
```

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
      socket?.write?.('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket?.end?.(); // v2 P-R：end 替代 destroy——write 后立即 destroy 可能丢弃未发送字节=客户端收 RST 非 403
      return;
    }
    const ip = this.clientIpOf(request, socket);
    if (!this.upgradeBucket.consume(ip)) {
      this.upgradeRejectedTotal.inc({ reason: 'rate-limited' });
      socket?.write?.('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket?.end?.();
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
  // v2 P-R：生产不注入 localhost（非浏览器工具可注入任意 Origin——localhost 在表=多余绕过面）；dev 推导表保留
  // v3：dev 补 127.0.0.1:5173（vite host:0.0.0.0 下用 127.0.0.1 打开时 origin 不含 localhost——403 全灭）；LAN IP 场景显式 COLLAB_ALLOWED_ORIGINS
  if (process.env.NODE_ENV !== 'production') {
    for (const dev of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
      if (!origins.includes(dev)) origins.push(dev);
    }
  }
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

### Task T3: 认证防线+F-3 全量（refusalCache→信号量→桶+权限判据单源+sweep 判据门+auth_reject 单点）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（authenticate 拆外层/内层+权限段替换 resolveWithTeam+sweepSessions 判据门+recheckConnection 判据单源+防线成员+deny 单点计数）
- Modify: `apps/api/src/modules/collab/store.metrics.ts`（collab_auth_reject_total{reason,source}/collab_auth_inflight/collab_auth_timeout_total）
- Test: `apps/api/src/modules/collab/collab-auth-defense.spec.ts`+`collab-perm-chain.spec.ts`（新建）

**结构（P-F+P-K+P-Q，写进实现注释）：** `authenticate()`=外层防线壳（**spec 钉死序：refusalCache→信号量→桶**→`try { inner } finally`——v1 实现笔误桶在前已修正）；`authenticateInner()`=原方法体改名（token→状态检查→**权限段改 `perm.resolveWithTeam` 单源**→DB）。**信号量/桶的 throw 不经过写缓存的 catch**（spec §3.1bis"瞬时拥塞≠状态故障"——按 throw 来源结构分离，非 reason 值）；inner 的 throw 进外层 catch→`reason ∈ REFUSAL_CACHEABLE`（四类）→写 cache。heap 闸（T4）与版本门（T5）插入 inner 内。**F-3 同批（P-K）**：sweepSessions 判据门两分支+recheckConnection 判据单源——**每函数恰一次切换**（判据同批规则），T8 只剩节奏/事件/缓存。

- [ ] **Step 0: 探针**——现有 collab spec 如何 mock prisma（装置族 spy 形态）；Connection 生命周期测试怎么构造 onAuthenticatePayload（现有 authenticate 单测形态）；resolveWithTeam 的 NotFoundException 形态（:20 throw）；sweepGrace/sweepRecheckFails 现挂点。输出粘 commit message。

- [ ] **Step 0.5: 红测——F-3 权限三形态（P-K 改前红锚：②③现状 teamMember 硬门必 403）**

```ts
// collab-perm-chain.spec.ts（表驱动五形态）
it.each([
  ['①仅 teamMember：无 ProjectMember、非创建者→连上 role=PROJECT_EDITOR', { teamMember: 'MEMBER' }, 'connected:PROJECT_EDITOR'],
  ['②仅 ProjectMember 不在团队（现状必 403——红锚）', { projectMember: 'PROJECT_VIEWER' }, 'connected:PROJECT_VIEWER'],
  ['③仅创建者不在团队（现状必 403——红锚）', { creator: true }, 'connected:PROJECT_OWNER'],
  ['④无任何角色→FORBIDDEN', {}, 'denied:forbidden'],
  ['⑤项目不存在→NOT_FOUND 分型不退化（resolveWithTeam throw NotFoundException 需 catch 转 deny）', { projectMissing: true }, 'denied:not-found'],
])('%s', async (_name, seed, expected) => { /* 夹具按 seed 建行，断言 expected */ });

it('词表单源：context.user.role=ProjectRole（PROJECT_OWNER/EDITOR/VIEWER）——TeamRole OWNER/MEMBER 与小写 viewer/editor 三套混用终结', async () => {
  const ctx = await authenticateAs('editor-then-check');
  expect(['PROJECT_OWNER', 'PROJECT_EDITOR', 'PROJECT_VIEWER']).toContain(ctx.user.role);
});
```

- [ ] **Step 0.6: 红测——sweep 判据门（P-K 核心：现状 :1144 快照未过期 continue=权限复验零调用）**

```ts
it('权限降级在 session 未过期时也会被发现（改前红：:1144 判据门跳过——dueForPerm 分支缺失）', async () => {
  const conn = await connectAs('u1', { role: 'PROJECT_EDITOR' }); // sessionExpiresAt=+7d（远期）
  await downgradeToViewerInDb('u1');                                // DB 直改——session 仍有效
  await vi.advanceTimersByTimeAsync(5 * 60_000 * 1.2 + 1_000);      // sweep 兜底窗（jitter 上界）
  expect(conn.readOnly).toBe(true);                                 // 现状红：复验未被调用
});
it('3×3 矩阵：输入源（sweep-tick/perm-event/cache-hit）×结果（viewer 维持/editor 降级 readOnly 不断连/null 踢线）——9 格数据数组全列（v3：两格骨架不足以防漏）', () => {
  it.each([
    ['tick×viewer 维持'], ['tick×editor 降级'], ['tick×null 踢线'],
    ['event×viewer 维持'], ['event×editor 降级'], ['event×null 踢线'],   // 事件与 tick 撞窗=缓存失效后事件先到（T8 补实连）
    ['cache×viewer 维持'], ['cache×editor 降级'], ['cache×null 踢线'],   // cache-hit 格断言零 DB（缓存命中不重查库锚）
  ])('%s', (cell) => { /* 按 cell 拆输入源注入方式×DB seed——执行时 9 格全写（禁 it.skip） */ });
});
```

- [ ] **Step 1: 红测——验收锚①（§3.1bis 验收锚 v2.2 输出级；fingerprint=真实凭据 P-Q——cookie-only 后 payload.token 恒 'cookie-auth' 占位）**

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
it('信号量满→SERVER_OVERLOADED deny+信号量计数峰值≤INFLIGHT_MAX（验收锚②——collab_auth_inflight gauge；**口径（v3.1）：计数≠DB 在飞**——deadline 到期即释放槽位但底层查询仍在飞，DB 真实并发由池 connection_limit 兜底）', async () => {
  gateDbCalls(); // 装置：挂起 inner 的 DB 步骤直至放行
  const inflight: number[] = [];
  const burst = Array.from({ length: 16 }, () =>
    gw.authenticate(makeAuthPayload({ socketId: `s${Math.random()}` })).catch(() => 0)
      .then(() => inflight.push(gw['authInflightPeak'])))); // v3 笔误修：字段直读（v2 写成调用=编译错）；生产观测走 collab_auth_inflight gauge
  await Promise.all(burst);
  expect(Math.max(...inflight)).toBeLessThanOrEqual(4); // v2 默认 4（P-Q 池对齐）
  releaseDbCalls();
  // 第 9 个并发请求被拒：SERVER_OVERLOADED
});
// v3.1：清空单点=onServingTransition（P-Q——不逐因由枚举方法名；v2 的 onDrainReleased/onLeaseRejoined/onSpoolRecovered 三名在实现中不存在，旧测调用=编译红）
it.each([['drain 解除'], ['租约 rejoin'], ['fence 解除'], ['spool 恢复'], ['heap 释放（T4 接线）']])(
  '%s → refusalCache 清空（不变量=只有 transition(serving)/spool 翻转一个清空点）', (flip) => {
    gw['refusalCache'].set('doc|t:abc', { reason: 'draining', at: Date.now() });
    driveStateFlip(flip); // 装置：驱动对应状态翻转（drain/fence/lease→transition('serving')；spool→isWritableOrDegraded 翻 ok；heap→T4 releaseHook）
    expect(gw['refusalCache'].size).toBe(0);
  });
it('无 cookie 的状态类拒绝（draining）→不落缓存（anon 键互覆防护——写入侧短路锚，v3.1 补）', async () => {
  await expect(gw.authenticate(makeAuthPayload({ cookie: undefined }))).rejects.toMatchObject({ reason: 'draining' });
  expect(gw['refusalCache'].size).toBe(0);
});
```

- [ ] **Step 2: 红跑**——预期 FAIL（无防线=N 次 prisma 全调/无 rate-limited reason/无 gauge）。

- [ ] **Step 3: 实现（防线壳+权限单源+sweep 判据门）**

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

/** v2 P-Q：AUTH deadline——DB 段超时折 db-unavailable（防慢 DB 挂满信号量；不加 env=YAGNI）
 *  v3.1 边界：Promise.race 到期**不取消**底层 Prisma 查询——约束的是信号量槽位占用，非 DB 工作量；
 *  DB 真实并发由池 connection_limit=5 兜底（池 5−REST/worker 预留≥INFLIGHT 4——禁单独调大任一破坏预算）。 */
private static readonly AUTH_DB_DEADLINE_MS = 3_000;
private withAuthDeadline<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) =>
    setTimeout(() => { this.authTimeoutTotal.inc(); rej(Object.assign(new Error('auth db deadline'), { reason: CollabAuthReason.DB_UNAVAILABLE })); }, CollabGateway.AUTH_DB_DEADLINE_MS).unref?.())]);
}

private refusalTtlMs(): number { return numEnv('COLLAB_REFUSAL_CACHE_TTL_MS', 15_000); }
private authAttemptsPerMin(): number { return numEnv('COLLAB_AUTH_ATTEMPTS_PER_MIN', 10); }
private authInflightMax(): number { return numEnv('COLLAB_AUTH_INFLIGHT_MAX', 4); } // v2 P-Q 默认 4——池公式 cpu×2+1=5 对齐（8×3 查询>池 5=P2024 折 db-unavailable）

/** v2 P-Q：清空钩子单点化——任一 transition('serving') 转移清（fence/drain 解除/租约 rejoin 全含于 serving 转移——
 *  比枚举因由稳，漏一即残留）+heap 释放（T4）+spool 恢复（isWritableOrDegraded 翻 ok）三点。 */
private onServingTransition() { this.refusalCache.clear(); }
// transition() 内 state==='serving' 时调 onServingTransition()（单点——drain 解除/租约 rejoin/fence 解除全含于 serving 转移）；
// spool 恢复点（isWritableOrDegraded 判定值 'spool-unwritable'→'ok' 翻转时——谓词非集合，在 :257-261 判定处记上一态检测翻转）同调；
// selfIsolate 进入时亦清（v3 防御性一行：隔离期写入的 LEASE_NOT_READY 缓存 15s TTL 内虽由 rejoin 的 serving 转移覆盖——提前清消残窗）
private sweepStaleAuthMaps() { // v2 P-Q：三 Map 老化——TTL 过期条目清+桶过期清+上界 10_000 清最旧（防只握手不认证风暴喂新 socketId）
  const now = Date.now();
  for (const [k, v] of this.refusalCache) if (now - v.at >= this.refusalTtlMs()) this.refusalCache.delete(k);
  for (const [k, v] of this.authAttemptBuckets) if (now - v.windowStart >= 60_000) this.authAttemptBuckets.delete(k);
} // v3.1：独立 1min timer 挂载（P-V⑦——SWEEP_ENABLED=false 逃生阀禁止静默关掉老化；与寿命/观测 timer 同归 T4 三 timer 清单，禁挂 sweep tick）

private async authenticate(payload: onAuthenticatePayload): Promise<...> {
  // —— 外层防线（§3.1bis 钉死执行序：refusalCache → 信号量 → 桶 → heap〔T4 inner〕→ 版本门〔T5 inner〕→ DB）——
  // v2 P-Q fingerprint=真实凭据：cookie-only 后 payload.token 恒 'cookie-auth' 占位——从 cookie 解析真值（'anon' 塌缩=跨用户 15s 放大）
  // v3：无 cookie ⇒ 不写缓存（anon 键会使不同来源的状态拒绝互相覆盖——UNAUTHENTICATED 本就不在白名单，短路在写入侧）
  const credential = parseSessionToken(payload.requestHeaders?.get('cookie')); // 无 cookie ⇒ null ⇒ 本轮拒绝不落缓存
  const fingerprint = credential ? `t:${sha256Hex(credential).slice(0, 16)}` : null;
  const cacheKey = fingerprint ? `${payload.documentName}|${fingerprint}` : null; // v3.1：唯一声明（读写两侧均 if(cacheKey) 短路——v3 修订残留的重复声明对已删）
  const cached = cacheKey ? this.refusalCache.get(cacheKey) : undefined;
  if (cached && Date.now() - cached.at < this.refusalTtlMs()) {
    this.authRejectTotal.inc({ reason: cached.reason, source: 'cache' });
    throw Object.assign(new Error(`refusal cached: ${cached.reason}`), { reason: cached.reason });
  }
  // 全局并发认证信号量（spec 序第二层——唯一不依赖库内部结构的乘积闸）
  if (this.authInflight >= this.authInflightMax()) {
    this.authRejectTotal.inc({ reason: CollabAuthReason.SERVER_OVERLOADED, source: 'semaphore' });
    throw Object.assign(new Error('auth inflight limit'), { reason: CollabAuthReason.SERVER_OVERLOADED });
  }
  // per-socket 认证尝试桶（spec 序第三层；键=payload.socketId d.ts:480；计数在 onAuthenticate 顶部——§3.1bis 3）
  const bucket = this.authAttemptBuckets.get(payload.socketId) ?? { count: 0, windowStart: Date.now() };
  if (Date.now() - bucket.windowStart >= 60_000) { bucket.count = 0; bucket.windowStart = Date.now(); }
  bucket.count += 1; this.authAttemptBuckets.set(payload.socketId, bucket);
  if (bucket.count > this.authAttemptsPerMin()) {
    this.authRejectTotal.inc({ reason: CollabAuthReason.RATE_LIMITED, source: 'bucket' });
    throw Object.assign(new Error('auth attempts exceeded'), { reason: CollabAuthReason.RATE_LIMITED });
    // 断连由库 30s 超时自然完成（P4：死于 30-60s 首 tick+timeout）——不主动 close
  }
  this.authInflight += 1;
  this.authInflightPeak = Math.max(this.authInflightPeak, this.authInflight);
  try {
    return await this.authenticateInner(payload);
  } catch (err: any) {
    const reason = err?.reason as CollabAuthReasonCode | undefined;
    if (reason && CollabGateway.REFUSAL_CACHEABLE.has(reason)) {
      if (cacheKey) this.refusalCache.set(cacheKey, { reason, at: Date.now() }); // TTL 15s 绝对过期不续期（+sweepStaleAuthMaps 兜底清）；无凭据不落缓存（v3）
    }
    throw err;
  } finally {
    this.authInflight -= 1;
  }
}
```

```ts
// authenticateInner 权限段替换（F-3 单源——P-K）：:265-278 的 canvasProject.findUnique+teamMember.findUnique
// 硬门+perm.resolve 三段整体换为一次解析（4-5 次冗余往返归 1-3 次——信号量才有意义）
const projectId = parseProjectId(documentName);
let resolved: { role: ProjectRole | null; teamId: string };
try {
  resolved = await this.withAuthDeadline(this.perm.resolveWithTeam(projectId, session.user.id));
} catch (e) {
  if (e instanceof NotFoundException) throw deny(CollabAuthReason.NOT_FOUND, '项目不存在'); // 保 NOT_FOUND/FORBIDDEN 分型（客户端 UX 分流依赖）
  throw e; // 其余进 catch 分型（DB_UNAVAILABLE 等）
}
if (!resolved.role) throw deny(CollabAuthReason.FORBIDDEN, '无项目访问权限');
const readOnly = resolved.role === 'PROJECT_VIEWER';
if (readOnly) connectionConfig.readOnly = true;
// token 校验/touchWithReason 段同样包 withAuthDeadline
// 返回值 user.role 词表统一 ProjectRole（TeamRole OWNER/MEMBER 混用终结）
return { user: { id: session.user.id, name: session.user.name, role: resolved.role }, readOnly, token, sessionExpiresAt: session.expiresAt };
```

```ts
// sweepSessions 判据门两分支（P-K——v2 重写 ：1138-1162 循环体判据段）
for (const connection of [...document.connections.keys()]) {
  const ctx = (connection.context ?? {}) as { token?: string; sessionExpiresAt?: Date };
  if (this.sweepGrace.has(connection)) continue;
  const expired = ctx.sessionExpiresAt instanceof Date && ctx.sessionExpiresAt.getTime() <= Date.now();
  const dueForPerm = this.permRecheckDue(connection); // 新增：per-connection 权限结论缓存（5min）到期=权限复验到期
  if (!expired && !dueForPerm) continue;              // ← 两分支判据门（原 :1144 单分支使权限复验零调用——v2 修）
  try {
    const re = await this.recheckConnection(connection, document.name);
    this.sweepRecheckFails.delete(connection);
    if (!re.revoked) { if (re.expiresAt) ctx.sessionExpiresAt = re.expiresAt; continue; }
    this.scheduleSweepClose(connection, 'revoked');
  } catch (err) { /* 5 连败兜底维持现状 */ }
}

// recheckConnection 判据单源化（:1166-1181 手写三段查询整体替换——与 authenticate 同链）
// v3 P-U②：返回 cause 分型——"没有角色"（no-role）与"会话失效"（session-invalid）分开计数（T8 事件路径同分型）
private async recheckConnection(connection: any, documentName: string): Promise<{ revoked: boolean; cause?: 'no-role' | 'session-invalid'; expiresAt?: Date }> {
  // sessionSvc.resolve(token) 保留（拿 userId+session 死线——纯读不续期，现注释维持）
  const { role } = await this.perm.resolveWithTeam(parseProjectId(documentName), userId); // 单源
  // ⚠ P-U② 权限语义 A：role 非 null 但用户已被移出团队（有显式 ProjectMember 行）=预期行为（REST 同链既有语义）——不踢
  this.permCache.set(connection, { role, at: Date.now() }); // 会话级结论缓存（T8 事件失效消费——仅清缓存不直接 recheck）
  if (role === 'PROJECT_VIEWER' && !connection.readOnly) {
    connection.readOnly = true;
    this.rewriteAwarenessRole(connection, 'PROJECT_VIEWER'); // 词表 ProjectRole（T8 接线——本 Task 先挂 no-op+计数）
    this.sweepCloseTotal.inc({ cause: 'role-downgraded' });
    return { revoked: false };
  }
  if (role === 'PROJECT_EDITOR' && connection.readOnly) { connection.readOnly = false; this.rewriteAwarenessRole(connection, 'PROJECT_EDITOR'); }
  return role === null ? { revoked: true, cause: 'no-role' } : { revoked: false, expiresAt };
}
```

- [ ] **Step 4: 绿跑+commit（v3.1 执行注：实现块先 `tsc --noEmit` 预跑——该块连续两轮出现同类笔误）**：`feat(y0b-3): T3 认证防线三层（refusalCache 15s/信号量 4/桶 10pm）+F-3 权限单源 resolveWithTeam+sweep 判据门两分支+auth_reject{reason,source}`

（验收锚③"超限 socket ≤61s 消失"=库 connectionChecker 行为，属 int/真连验证——归 T11 出口演练登记：装置真连+65s 观察断连；单元级以"桶满后第 11 次 Auth 立即 deny rate-limited 零 DB"为判据，§0.4 登记口径。）

---

### Task T4: heap 压力自保闸（谓词单源双量纲+onLoadDocument 单点+卡住观测器+check-ecosystem 单源链）

**Files:**
- Create: `apps/api/src/modules/collab/heap-pressure.ts`（谓词单源 util——禁第二套；**导出 HEAP_DEFAULTS 常量表供 check-ecosystem 单源提取**）
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（authenticateInner 插入点+loadDocument :312 前插入+卡住观测器+Y2 catch 计数+heap 释放钩子接 refusalCache 清空+三独立 timer〔寿命/观测/Map 老化——P-V⑦〕）
- Modify: `scripts/check-ecosystem.mjs`（区间断言链——HEAP_DEFAULTS 提取）
- Modify: `apps/api/src/modules/collab/store.metrics.ts`（指标组——见下）
- Test: `apps/api/src/modules/collab/heap-pressure.spec.ts`+`collab-heap-gate.spec.ts`（新建）

**v2 变更（P-O；v3.1 注：下述②的"薄 reaper 卸载"已被 v3 P-V① 取代为纯卡住观测——以 Step 4 实现块为准，本段仅存沿革）**：①**删 v1 的 withDoc 首行平行判据**——onLoadDocument 单点已覆盖三入口（spec §3.2"唯一装载汇聚点——WS/DirectConnection/REST withDoc 全经此"原文即此义）+`collab-document.service.ts:142`"readCanvas/withDoc 本体不 gate（PG 健康+数据在 PG——本地磁盘故障不放大成读不可用）"不变式注释尊重；REST 面压力经 onLoadDocument 拒载自然产生 `ServiceUnavailableException`（:48 既有先例）+retryAfter（T9 语义化）。②薄 reaper=spec §3.1ter 自队列谓词+**库 unloadDocument 自守卫（不重复实现 isDebounced/saveMutex/connectionsCount）+先判 `shouldUnloadDocument(doc)` 才计 reaped**。③删 collab_doc_store_failed_total（spool 既有观测覆盖+gateway 契约 3 恒零）；增 yjs_pending_bytes/yjs_zero_conn_docs/yjs_store_unexpected_throw_total。④红锚④改形态（gateway 契约 3"任何路径不 throw"实证⇒库"保内存"catch 分支〔esm:1541-1547〕本仓不可达——spec §3.2 前提偏离登记 §0.4-1）。

- [ ] **Step 0: 探针**——spool 服务"未 confirm 帧"查询 API（canSafelyUnload 前置谓词④）；in-flight store 集合现名（storeInFlightDocs gauge 源）；Y2 兜底 catch 位置（gateway store 路径"契约 3 最后一道闸"注释处——yjs_store_unexpected_throw_total 埋点）；check-ecosystem.mjs regex 提取先例（node_args :53）；lease 门 gateway:312-313 在 REST 面可达性核对（withDoc :48 先挡=不可达则登记不改——F5 附带，同函数两条 503 语义不分叉确认）。输出粘 commit message。

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
it('迟滞（v3 两量纲各自独立布尔——v2 标量 max 形态使 RSS 实效释放线=525MiB≠声明 600MiB 的缺陷修正）：tripped = heapRatio>=0.8 || rss>=750MiB；released = heapRatio<0.7 && rss<600MiB——RELEASE_BYTES 真正进运行时', () => {
  resetHeapPressure();
  stubHeapMeasure({ heapUsed: 0.85e9, heapLimit: 1e9, rss: 100 * 1024 * 1024 }); // heap 项 trip 触发
  expect(measureHeapPressure().tripped).toBe(false); // 第 1 采样未 trip（2 连续才 trip）
  expect(measureHeapPressure().tripped).toBe(true);
  stubHeapMeasure({ heapUsed: 0.6e9, heapLimit: 1e9, rss: 700 * 1024 * 1024 }); // heap 已回落但 rss ∈ (600,750)
  expect(measureHeapPressure().tripped).toBe(true);   // 迟滞带维持（rss 未低于 600MiB 释放线）
  stubHeapMeasure({ heapUsed: 0.6e9, heapLimit: 1e9, rss: 550 * 1024 * 1024 }); // 两项各自低于释放线
  expect(measureHeapPressure().tripped).toBe(false);  // 释放
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
 * v3 布尔结构（两量纲各自独立上下阈——RELEASE_BYTES 真正生效；v2 标量 max 形态缺陷见迟滞测试注）：
 *   tripped  = heapRatio >= TRIP_RATIO(0.8) || rss >= TRIP_BYTES(750MiB)   —— trip 需 2 连续采样
 *   released = heapRatio < RELEASE_RATIO(0.7) && rss < RELEASE_BYTES(600MiB) —— 单次即释放
 * 默认值标定（v2.3 实测基线 138.8MB）：release 600MiB=基线×安全倍率 ∧ trip 750MiB=杀线−缓解预算；
 * 单调链 baseline×4 < release < trip < max_memory_restart(1G)−200MiB 由 check-ecosystem 断言。 */
export const DEFAULT_RSS_TRIP_BYTES = 786_432_000;   // 750MiB
export const DEFAULT_RSS_RELEASE_BYTES = 629_145_600; // 600MiB（§9.15 人工评估线同值——人先看见机器后动手）
/** v3：check-ecosystem 提取锚=本文件 DEFAULT_RSS_* 字面量（regex `([\d_]+)`+剥下划线+失败 fail-closed）——
 *  ~~HEAP_DEFAULTS 常量表导出~~ 删除（脚本直读字面量，禁第二层间接） */
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
it('④卡住观测〔v3 卸载动作删除后〕：库守卫不满足（stub debounced/saveMutex）+零连接+队列空→连续 2 轮计 yjs_doc_stuck_total（观测器职责——卸载归库自愈排程；~~reaped 计数~~随动作删除）', async () => {
  vi.useFakeTimers();
  await loadThenDisconnect('project:doomed');
  stubLibUnloadGuard(false); // stub 库 shouldUnloadDocument 恒 false（卡住形态——真实成因见偏离 13 可达性论证）
  await vi.advanceTimersByTimeAsync(5 * 60_000 * 2 + 2_000); // 2 轮观测周期
  expect(await metricValue('yjs_doc_stuck_total')).toBe(1);  // 连续 2 轮=计数（瞬时 debounce 1 轮=不计数）
});
it('自队列非空（pendingQueue 有帧）=正常流转不计 stuck（轮内跳过≠stuck——区分观测）', async () => {
  vi.useFakeTimers();
  await loadThenDisconnect('project:queued');
  enqueuePending('project:queued', new Uint8Array([1]));
  await vi.advanceTimersByTimeAsync(5 * 60_000 * 2 + 2_000);
  expect(await metricValue('yjs_doc_stuck_total')).toBe(0);
});
it('yjs_pending_bytes/yjs_zero_conn_docs gauge 可见（池外内存早于 RSS 可见——pendingQueues 在 external 不进 heapUsed）', () => { /* collect 断言 */ });
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
// v3 P0-V1：throw 形态改 ServiceUnavailableException（Nest HttpException 有 .getStatus()）——REST 面（withDoc
// 经 openDirectConnection 收到）自然 503 语义化；WS 面 Object.assign 的 reason 保留⇒库 esm:939 透传进
// PermissionDenied 帧——两通路共用同一 throw（:365-369 兜底 catch 的 err.reason 透传分支直穿，无需 instanceof 档）
if (!this.server.hocuspocus.documents.has(documentName) && measureHeapPressure().tripped) {
  this.loadRejectedTotal.inc({ reason: 'server-overloaded' });
  // v3.1 F5：对象形态带 code——CollabNotServingFilter 只认 body.code==='COLLAB_NOT_SERVING' 才附 Retry-After: 2
  // （filter:17-22 实证；字符串形态落 fallback=503 无 Retry-After ⇒ T9 retryAfter 消费静默降级）。
  // 注：collab-document.service.ts:48 字符串先例=有意"通用入口非协议形态"，本处是协议分型面——形态不同不冲突。
  // WS 面 err.reason 透传进 PermissionDenied 帧不变（:365-369 兜底 catch 直穿）。
  throw Object.assign(new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'server overloaded' }), { reason: CollabAuthReason.SERVER_OVERLOADED });
}
```

```ts
// 5min 零连接 doc 观测器（v3 P-V①：**卸载动作删除**——自队列谓词与库守卫在可达状态同真〔队列非空⇔库
// debounce/飞/mutex 必真〕+库 store 后必排 setTimeout unload 自愈〔esm:1550-1552〕+保内存分支本仓不可达
// 〔偏离 1〕⇒ reaper 唯一对象不存在；保留卡住探针=守卫拒绝连续轮次计数〔若真出现=库行为异常的观测出口〕）
private startHeapReaper() { // 独立 timer（v3 P-V⑦：不挂 startSessionSweep——SWEEP_ENABLED=false 逃生阀禁静默关掉观测）
  this.heapReaperTimer = setInterval(() => void this.observeIdleDocs(), 5 * 60_000);
  this.heapReaperTimer.unref?.();
}
private observeIdleDocs() { // 纯观测零卸载动作
  for (const doc of this.server.hocuspocus.documents.values()) {
    const name = doc.name;
    if (doc.connections.size > 0 || doc.isLoading) { this.docStuckRounds.delete(name); continue; }
    // v3.1：pendingQueues 键=裸 projectId（gateway:321 播种/:151/:826 全裸键取用实证——get(doc.name) 恒 undefined=本守卫静默失效）
    const pid = parseProjectId(doc.name);
    if (pid && (this.pendingQueues.get(pid)?.length ?? 0) > 0) { this.docStuckRounds.delete(name); continue; } // 自队列非空=正常流转非 stuck
    if (!this.server.hocuspocus.shouldUnloadDocument(doc)) { // 守卫拒绝+零连接+队列空=疑似卡住
      const n = (this.docStuckRounds.get(name) ?? 0) + 1;
      this.docStuckRounds.set(name, n);
      if (n >= 2) { this.docStuckTotal.inc(); this.docStuckRounds.delete(name); } // 连续 2 轮=真 stuck（瞬时 debounce≠stuck）
    } else {
      this.docStuckRounds.delete(name);
    }
  }
}
// ~~canSafelyUnloadOwn/unloadDocument 调用~~ v3 随卸载动作删除；spec §3.2 释放路径偏离登记（偏离 13）
// ~~yjs_doc_reaped_total~~ 删除；yjs_zero_conn_docs gauge（collect）+ yjs_doc_stuck_total 保留
```

（Y2 兜底 catch 处 `yjs_store_unexpected_throw_total.inc()`〔该 catch 实证存在——gateway store 路径「契约 3 最后一道闸」注释处〕；heap tripped→released 翻转钩子接 `onServingTransition()` 同族的 refusalCache 清空〔P-Q 钩子②〕+`collab_overload_state` gauge 翻转+P-B 口径注释；~~collab_doc_store_failed_total~~ v2 删除。**连接寿命 timer 同批独立**：`connEstablishedAt` 扫描移出 sweep tick 为独立 1min timer〔P-V⑦〕；`sweepStaleAuthMaps` 老化同独立——三 timer 各自 clear-first+shutdown 注销。）

- [ ] **Step 5: check-ecosystem 区间断言链**

```js
// check-ecosystem.mjs :61 后插入（v3 提取式钉死——S-5：常量写法 786_432_000 含数字分隔符，
// \d+ 在 786 处截断=拿到错值且数值"合理"⇒fail 不触发=静默错绿；提取失败必须 fail-closed〔:54 纪律〕）
const RSS_BASELINE_BYTES = 138_800_000; // server-profile F1 实测 138.8MB（加载演练后实测重标——v2 消双源）
const src = readFileSync('apps/api/src/modules/collab/heap-pressure.ts', 'utf8');
const tripM = src.match(/DEFAULT_RSS_TRIP_BYTES\s*=\s*([\d_]+)/);
const releaseM = src.match(/DEFAULT_RSS_RELEASE_BYTES\s*=\s*([\d_]+)/);
if (!tripM || !releaseM) fail('HEAP_DEFAULTS 提取失败（常量被改名/删除）——禁"提取不到就算过"');
const trip = Number(tripM[1].replace(/_/g, ''));
const release = Number(releaseM[1].replace(/_/g, ''));
if (!(RSS_BASELINE_BYTES * 4 < release)) fail('heap release 必须大于 baseline×4（当前 release 无法覆盖基线膨胀）');
if (!(release < trip)) fail('heap release 必须小于 trip（迟滞方向）');
if (!(trip < rss - 200 * 1024 * 1024)) fail('heap trip 必须小于 max_memory_restart−200MiB（缓解时延预算）');
// 既有 :57（rss ≥ old-space+384MB=896MB 断言）保留原用途=杀线相对 V8 cap 足够宽——两件事禁互相引用
// v3：trip/release 现为运行时真值（两量纲独立布尔后 RELEASE_BYTES 真正生效——断言链校验生效值）
```

- [ ] **Step 6: 绿跑（红相留档——④释放路径改前红粘 commit）+commit**：`feat(y0b-3): T4 heap 压力闸（RSS/V8 双量纲+迟滞+fail-open+仅拒新物化）+5min reaper 前置谓词+check-ecosystem 区间链`

---

### Task T5: 版本门（服务端四档拒+csv/cb query 通道+__CLIENT_BUILD__+collabUrl 单次）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（authenticateInner 插入版本门——heap 闸后 DB 前）
- Modify: `apps/api/src/modules/collab/collab-ready.service.ts`（ready 响应增 collabProtocolVersion——**200 与 503 双分支都带**〔P-C 补强：版本拒绝时若 ready 本身 503，loop 键仍可得〕）
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts:867-884`（collabUrl 单次+版本参数）
- Modify: `apps/web/vite.config.ts`+`apps/web/src/env.d.ts`（__CLIENT_BUILD__）
- Modify: `deploy/nginx/` snippet+`deploy/deploy.sh` 服务器侧 verify（access_log off+**index.html no-store** 断言——spec §3.4 明文，v1 漏项 v2 补）
- Test: `apps/api/src/modules/collab/collab-version-gate.spec.ts`（新建）+web 侧 collabUrl 测试（现有 runtime spec 扩）

- [ ] **Step 0: 探针**——ready service 响应组装形态（:41 base 对象+:63/:64 两 return——**双分支增字段位**）；deploy.sh preflight/verify 链现结构（check-nginx-budget.mjs 挂载点）；vite.config define 现有项+deploy.sh:124 GIT_COMMIT_HASH 注入先例。输出粘 commit message。

- [ ] **Step 1: 红测——四档拒+计数+精确相等（v2：server-outdated 第四档——csv>current=reload 无效档）**

```ts
it('缺 csv→CLIENT_VERSION_MISSING（D12 缺参档——旧 bundle 不带参数同拒；最廉价检查在 DB 前）', async () => {
  await expect(gw.authenticate(makeAuthPayload({ query: '' }))).rejects.toMatchObject({ reason: 'client-version-missing' });
  expect(await metricValue('collab_version_negotiation_reject_total', { reason: 'client-version-missing' })).toBe(1);
});
it('csv 不可解析→CLIENT_VERSION_INVALID（"abc"/"1.5"/"0"/负数）', async () => { /* 同形态 */ });
it('csv<current→SCHEMA_OUTDATED（客户端旧——reload 有效档；精确相等——区间协商=兼容层，R 终裁驳回；v3：该档在首版协议=1 下结构性不可达〔无比 1 小的正整数〕——服务端锚经 vi.mock CLIENT_PROTOCOL_VERSION=2 形态测，T0 已用 current 注入单测覆盖）', async () => {
  vi.mock(CLIENT_PROTOCOL_VERSION_MODULE, { CLIENT_PROTOCOL_VERSION: 2 }); // 或装置注入——Step 0 探针定 mock 形态
  await expect(gw.authenticate(makeAuthPayload({ query: 'csv=1' }))).rejects.toMatchObject({ reason: 'schema-outdated' });
});
it('csv>current→SERVER_OUTDATED（客户端新于服务端——reload 无效档；本机 pull 前端未部署 api 的开发期真实场景）', async () => {
  await expect(gw.authenticate(makeAuthPayload({ query: 'csv=999' }))).rejects.toMatchObject({ reason: 'server-outdated' });
});
it('csv=1（当前）→放行进 DB 环节（版本门不是 DB 拦截）', async () => {
  await expect(gw.authenticate(makeAuthPayload({ query: 'csv=1&cb=dev' }))).resolves.toBeDefined();
});
it('版本门在 heap 闸之后 DB 之前（执行序——stub heap tripped+无 csv→server-overloaded 先于 version 档）', async () => {
  stubHeap({ tripped: true });
  await expect(gw.authenticate(makeAuthPayload({ query: '' }))).rejects.toMatchObject({ reason: 'server-overloaded' });
});
```

（T0 词表追加第五值 `SERVER_OUTDATED: 'server-outdated'`（v1 五值+此=六值——12 值总数变 13；**瞬态档**：服务端待更新非客户端错，横幅提示+不自动 reload；不入终态。）

- [ ] **Step 2: 实现 gateway**

```ts
// authenticateInner——heap 闸后、touchWithReason 之前
const verdict = negotiateClientVersion(requestParameters?.get('csv') ?? null);
if (verdict !== 'allow') {
  const reason = verdict === 'client-version-missing' ? CollabAuthReason.CLIENT_VERSION_MISSING
    : verdict === 'client-version-invalid' ? CollabAuthReason.CLIENT_VERSION_INVALID
    : verdict === 'server-outdated' ? CollabAuthReason.SERVER_OUTDATED
    : CollabAuthReason.SCHEMA_OUTDATED;
  this.versionRejectTotal.inc({ reason });
  this.authRejectTotal.inc({ reason, source: 'version' });
  throw Object.assign(new Error(`client protocol ${verdict}`), { reason });
}
// cb（client build）=审计透传通道：本批服务端不消费（遥测 clientBuild 预留=Y0b-5 §5.6）——URL 带上即通道建立
```

- [ ] **Step 3: ready 增字段（P-C 双分支）**——`collab-ready.service.ts` **200 与 503 两处 return 的 base 对象**都增 `collabProtocolVersion: CLIENT_PROTOCOL_VERSION`（PUBLIC 端点——客户端版本终态时单次探测拿服务端版本作 loop 键；**非轮询**，§5.4 边角单次探测同族；503 分支带字段=版本拒绝与 ready 降级同发时 loop 键仍可得）。红测：两个分支的 GET /api/ready 响应都含该字段。

- [ ] **Step 4: 客户端通道**

```ts
// vite.config.ts（v2 M-9：用既有 GIT_COMMIT_HASH——deploy.sh:124 已注入；禁 Date.now()〔每次 build 变值破坏可缓存性+与部署溯源双源〕；dev='dev'）
define: { __CLIENT_BUILD__: JSON.stringify(process.env.GIT_COMMIT_HASH ?? 'dev') },
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

- [ ] **Step 5: access_log off+index.html no-store 断言（R-6+spec §3.4 漏项补）**——**服务器侧** verify（v2 M-10 定案：`pnpm verify` 本地跑无 nginx——断言归 deploy.sh 服务器侧 verify 段+冒烟脚本；本地仅模板文本断言进 check-nginx-budget.mjs 既有约定）：①`nginx -T` 断言 /collab 段含 `access_log off`；②断言站点配置含 index.html no-store（防旧 bundle 静态缓存钉死版本拒绝循环——spec §3.4"index.html no-store（nginx snippet）"）。红测：stub nginx -T 输出缺任一项→exit 1。

- [ ] **Step 5bis: video-work 缓存键核对（spec §3.4——只读核对零改动）**——video-work process 缓存键（:34 已拼 doc 版本）拼的是 `CANVAS_DOC_SCHEMA_VERSION`（doc 版本）而非 csv：确认键成分维持 doc 版本（缓存失效语义跟随文档结构版本——csv 变更不影响缓存键）；若发现误拼 csv=改为 doc 版本并登记 §0.4。

- [ ] **Step 6: 全绿+commit**：`feat(y0b-3): T5 版本门四档拒（csv 精确相等+server-outdated）+ready 双分支下发+GIT_COMMIT_HASH 构建+collabUrl 单次+access_log/no-store 服务器侧断言`

---

### Task T6: SCHEMA_OUTDATED 断链修复+连接寿命 4402+close code 常量化迁移

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（:356-360 附 reason+connected/寿命 Map+四处字面量迁移）
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts:846-857`（1012 常量化——映射表消费在 T9，本 Task 仅常量替换零行为变化）
- Test: `apps/api/src/modules/collab/collab-schema-refusal.spec.ts`（扩现有版本门测试文件）+连接寿命新用例

- [ ] **Step 0: 探针**——connectedPayload 形态（d.ts :517-528 含 connection+**socketId :524**）；onDisconnect 现钩子结构（:934-935 early-return `document.getConnectionsCount() > 0` 位置——**清理必须提到它之前**）。输出粘 commit message。

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

- [ ] **Step 3: 连接寿命（红测先行——fake timers；v2 H-1：socketId 键控）**

```ts
it('连接超 12h→webSocket.close(4402,"max-lifetime")；P7 统一 webSocket.close（connection.close 丢 code）', async () => {
  vi.useFakeTimers();
  const ws = await connectAuthenticated('project:aged');
  await vi.advanceTimersByTimeAsync(12 * 3600_000 + 60_000);
  expect(ws.closeCode).toBe(4402);
  expect(ws.closeReason).toBe('max-lifetime');
});
it('键控清理：断连即删 Map 条目（防无界）——**清理在 early-return 之前执行（多标签 clientsCount>0 不跳清理）**', async () => {
  const [a, b] = await Promise.all([connectAuthenticated('project:multi'), connectAuthenticated('project:multi')]);
  await a.close();
  expect(gw['connEstablishedAt'].size).toBe(1); // b 仍在——但 a 的条目已删（现状红：清理在 clientsCount>0 早退之后=跳过）
});
```

```ts
// gateway 实现（v2 H-1：onDisconnectPayload 无 connection 字段〔d.ts:687-696 只有 socketId〕——Connection 键 Map=死代码；三钩子共有稳定键=socketId）
private readonly connEstablishedAt = new Map<string, number>(); // socketId 键（connected :524 / onDisconnect :695 / onAuthenticate :480 三钩子共有）
// hooks 追加：connected: ({ socketId }) => { this.connEstablishedAt.set(socketId, Date.now()); }
// onDisconnect 钩子【首行、early-return 之前】：
//   this.connEstablishedAt.delete(socketId);
//   this.authAttemptBuckets.delete(socketId);
//   if (clientsCount > 0) return;   // 用 payload.clientsCount（库已算好）替代 getConnectionsCount()——现 :935 形态改造
// 寿命检查并进 startSessionSweep 同一脉冲（sweep tick 首部）——socketId→Connection 反查经 document.connections 遍历：
for (const doc of this.server.hocuspocus.documents.values()) {
  for (const conn of doc.connections.keys()) {
    const at = this.connEstablishedAt.get(conn.socketId);
    if (at !== undefined && Date.now() - at > numEnv('COLLAB_CONN_MAX_LIFETIME_MS', 43_200_000)) {
      conn.webSocket?.close(CollabCloseCode.MAX_LIFETIME, 'max-lifetime'); // Connection.webSocket 公开字段（d.ts:912）；4401 已被库 Unauthorized+sweep 双占用——4402 新码
    }
  }
}
// 键控清理纪律：closeTeamDocuments（:1354-1372）与 beforeUnloadDocument 清该 doc 全部 connection 的 socketId 条目（经 connections 反查）
```

- [ ] **Step 4: close code 常量化迁移+close 分布指标+1009 观测探针（v3）**——gateway :672/:1206/:1191/:1368+runtime :850 全部换 `CollabCloseCode.*`；**四处 close 调用点单点埋 `collab_ws_close_total{code,reason}`**（v2 P-O 观测——4205/4408/1009 真实分布此前完全不可观测；**v3 边界**：onDisconnectPayload 无 close code 字段=库自发/自然断连的服务端观测结构性不可达，归 Y0b-5 客户端遥测——本指标=应用侧主动 close 分布）；**1009 真连探针**（v3 P-V⑧：ws 发送 >16MiB 帧→断言客户端实际观测到的 close code 是 1009 还是 1006〔ws 层 destroy 形态〕——一次定论；若 1006 则 T0 映射表 1009 分支登记死码+T9 逃生通道改挂 1006 观测面）；census `close\(1012\|close\(4401\|close\(1000` 双侧清零。

- [ ] **Step 5: 全绿+commit**：`feat(y0b-3): T6 拒载附 reason（第五终态档通路）+连接寿命 4402〔socketId 键控〕+close code 单源迁移+ws_close 分布指标`

---

### Task T7: E73 awareness 覆写+归属三分支+color 五件套收口（‖可与 T8 并行）

**Files:**
- Create: `packages/shared/src/constants/collab-identity-color.ts`（**color 单源**——COLORS+hash*31 从 awareness.ts:26-30 原样挪，两端 import 同一函数）
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（beforeHandleAwareness 钩子+归属表+serverIdentityOf）
- Modify: `apps/web/src/collab/awareness.ts`（userColor 删+setLocalUser 退位 user 写入——**replayLocalUser 保留**）
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx:113`（setLocalUser 调用点删——**v2 路径修正**：实为 pages/canvas/components/ 非 src/components/）
- Modify: RemoteCursors.tsx/CanvasTopBar.tsx（**消费面切 `s.user.color`**——P-L 五件套）
- Test: `apps/api/src/modules/collab/collab-awareness-guard.spec.ts`（新建）+web awareness/RemoteCursors spec 扩

**v2 关键修正（H-2/P0-1/P0-2/P-L）**：①载体=`payload.states`（**scratch Map**——d.ts:600-608 官方契约"Mutate this map in place to rewrite the update"，库从它重编码广播〔esm:197-207〕）；**禁碰 `payload.awareness.states`**（文档本体——删的是已应用真状态、伪造帧照旧广播=攻击面没关还误伤）。②**无条件注入**（不依赖帧内 user 字段存在性——局部帧〔只带 cursor〕跳过覆写=绕过）。③归属三分支**同一趟完成**（首帧不被丢弃——库 clients 集在 hook 之后填充〔esm:625-634〕，不能作权威，spec §3.3 自建表语义维持）。④`!connection || !context || !socketId`（空串含）→整体放行（DirectConnection/服务端内部写=我们自己写的，禁删禁改）。

- [ ] **Step 0: 探针**——RemoteCursors/CanvasTopBar 的 userColor 调用行（grep `userColor(`——v2 评审核验 RemoteCursors.tsx:30,34/CanvasTopBar.tsx:130，以实测为准）；awareness.test.ts:20-23/:48-54 现断言形态（随迁清单）；connectionMembership 三分支所需 `document.connections` 遍历形态。输出粘 commit message。

- [ ] **Step 1: 红测——伪造锚+归属锚+首帧锚+等价性锚**

```ts
it('伪造锚：伪造 user 字段→对端看到=服务端身份（改前红：客户端自写直进 states；**断言对端可见性**非仅服务端 states 被改——抓错字段时后者也会绿）', async () => {
  const { peer } = await twoClientFixture();
  await clientA.sendAwareness({ clientId: 111, user: { id: 'fake-admin', name: 'x', role: 'owner' } });
  expect(peer.seesUserOf(111)).toEqual({ id: 'u-1', name: '真实名', role: 'PROJECT_VIEWER', color: userColorOfUserId('u-1') });
});
it('无条件注入：局部帧（只带 cursor 不带 user）也覆写——伪造者先发真身再发局部帧不保留旧 user（v2 P0-2 绕过修正）', async () => {
  await clientA.sendAwareness({ clientId: 111, user: { id: 'fake', name: 'x', role: 'owner' } });
  await clientA.sendAwareness({ clientId: 111, cursor: { x: 1 } }); // 不带 user 的局部帧
  expect(peer.seesUserOf(111)?.id).toBe('u-1'); // user 仍是服务端值
});
it('归属锚：伪造他人 clientId 帧（跨用户）→对端 state 不被覆盖（丢弃非改写——不替别人发声）', async () => {
  await clientA.registerAndSend(111);                          // A 的连接首帧登记 111
  await clientB.sendAwareness({ clientId: 111, cursor: { x: 1 } }); // B 伪造 A 的 clientId
  expect(peer.seesCursorOf(111)).toBeUndefined();              // 伪造帧整体不进广播
});
it('首帧可见性锚（§6.3 存疑项显式覆盖）：新连接首个 awareness 帧即含 user→对端最终可见——丢弃与登记同一趟', async () => {
  const { peer } = await twoClientFixture();
  await clientA.sendAwareness({ clientId: 222, user: { id: 'fake', name: 'x' } }); // 首帧=首见 clientId
  expect(peer.seesUserOf(222)?.id).toBe('u-1'); // 首帧即注入广播（三分支判定不丢首帧）
});
it('同用户双标签断连不冻结对端光标（socketId 隔离回归锚）：标签1 断连只清自己登记的 clientId', async () => { /* 双标签装置 */ });
it('单连接 clientId 上限 4（第 5 个丢弃+计数）', () => { /* 上界锚——spec §3.3 终裁值 */ });
it('DirectConnection/服务端内部写（context undefined 或 socketId 空串）→整体放行禁删禁改（v2 P0-1）', async () => {
  const before = docAwarenessSnapshot();
  await withDocDirectWrite(projectId, () => {}); // REST 直连路径——不应触发剥离
  expect(docAwarenessSnapshot()).toEqual(before);
});
it('一致性校验源：库 document.connections clients 集与归属表差异→计数告警（spec §3.3 ③——不信赖库内部也为漂移留探针）', () => { /* diff 计数 */ });
```

- [ ] **Step 2: 实现（三分支同一趟）**

```ts
// gateway 成员（v3 P-V④+v3.1 双索引：ownedByOthers 每帧 O(连接数) 建并集是光标热路径开销，改 O(1) 判定；
// 剪枝/清理/上限改按 socketId 自有 Set 迭代 O(自己)——ownedCount 标量并入 .size，NaN 减数风险结构性消除）
private readonly clientIdOwner = new Map<number, string>();       // clientId → socketId（归属权威——spec §3.3 自建表语义；库 clients 集在 hook 后填充不能作权威〔esm:625-634〕）
private readonly ownedClientIds = new Map<string, Set<number>>(); // socketId → clientIds（上限计数=.size；剪枝/断连清理/T8 role 改写迭代源）
private readonly socketIdentity = new Map<string, { id: string; name: string; role: string }>(); // socketId → 认证身份（authenticate 成功路径播种+onDisconnect 清）
private socketIdOf(connection: any): string { return connection?.socketId ?? ''; }               // v3.1：T8 消费的 helper（此前引用未定义）
private ownedClientIdsOf(socketId: string): number[] { return [...(this.ownedClientIds.get(socketId) ?? [])]; }

// hooks 追加
beforeHandleAwareness: ({ states, socketId, context, connection, document }: any) => {
  // 钩子抛错被库 hooks() 链 catch 吞（esm:1563-1565）不中断链路——try/catch 仍留（禁污染日志）但非安全关键
  try {
    // v2 P0-1：非连接来源（DirectConnection/服务端内部写——connection undefined 或 socketId 空串）= 我们自己写的，禁删禁改
    if (!connection || !context || !socketId) return;
    const identity = this.socketIdentity.get(socketId);
    if (!identity) return; // 未认证连接的 awareness 帧（pre-auth 队列外不应出现——防御性放行）
    for (const [clientId, state] of [...states]) {
      const owner = this.clientIdOwner.get(clientId);
      if (owner !== undefined && owner !== socketId) {                          // ② 他人登记=伪造→整帧丢弃（O(1) 反向索引判定——不替别人发声）
        states.delete(clientId);
        this.awarenessRejectTotal.inc({ reason: 'forged' });
        continue;
      }
      if (owner === undefined) {                                               // ③ 首见=登记（同一趟——首帧不被丢弃）
        if ((this.ownedClientIds.get(socketId)?.size ?? 0) >= 4) {             // 上限 4（spec §3.3）——触发必须计数（S-3：光标消失类故障的观测出口）
          states.delete(clientId);
          this.awarenessRejectTotal.inc({ reason: 'owner-limit' });
          continue;
        }
        this.clientIdOwner.set(clientId, socketId);
        if (!this.ownedClientIds.has(socketId)) this.ownedClientIds.set(socketId, new Set());
        this.ownedClientIds.get(socketId)!.add(clientId);
      }
      states.set(clientId, { ...state, user: serverIdentityOf(identity) });    // ① owned（含刚登记）→无条件注入（不依赖帧内 user 存在性）
    }
    // v3 S-3 剪枝：陈旧 clientId（客户端 setLocalState(null) 移除自身后索引残留——防上限被垃圾占满卡死长会话）
    // 判据=既不在库 clients 集〔apply 后登记——对旧项可靠〕也不在本帧 states 且 doc awareness.states 已无此 id
    // v3.1：只迭代自己名下 Set（O(自己)——原全表扫描把热路径开销原地搬回）；计数随删除自然收敛无 NaN 面
    const libClients = document.getClients?.(connection) as Set<number> | undefined;
    for (const cid of this.ownedClientIds.get(socketId) ?? []) {
      if (!libClients?.has(cid) && !states.has(cid) && !document.awareness.states.has(cid)) {
        this.clientIdOwner.delete(cid);
        this.ownedClientIds.get(socketId)!.delete(cid);
      }
    }
    // spec §3.3 ③ 一致性校验：clientIdOwner 与库 clients 集差异计数（漂移探针——反向索引即现成数据源）
  } catch { /* 观测面禁抛 */ }
},

// serverIdentityOf——color 用 shared 单源（P-L：与客户端同源算法=迁移等价性保证）
import { userColorOfUserId } from '@flowweb/shared';
function serverIdentityOf(u: { id: string; name: string; role: string }) {
  return { id: u.id, name: u.name, role: u.role, color: userColorOfUserId(u.id) };
}
```

（onDisconnect 首行〔T6 同点〕：`for (const cid of this.ownedClientIds.get(socketId) ?? []) this.clientIdOwner.delete(cid); this.ownedClientIds.delete(socketId);`+`socketIdentity.delete(socketId)`——按 socketId 键控=所有权校验天然满足〔双标签锚验证〕；beforeUnloadDocument 清该 doc 全部相关条目；**库 removeConnection 已自动 removeAwarenessStates——断连清场库为主、自建表只清登记**。）

- [ ] **Step 3: 客户端 color 五件套收口（P-L 同 commit）**

```ts
// ① packages/shared/src/constants/collab-identity-color.ts（新建——COLORS+hash*31 从 awareness.ts:26-30 原样挪，两端同源 import）
export const COLLAB_USER_COLORS = ['#5DDCFF', '#FF7A9E', '#9EFF8A', '#FFC56D', '#C39EFF', '#7AD7FF'] as const; // 以实测现值为准原样挪
export function userColorOfUserId(userId: string | undefined = ''): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  return COLLAB_USER_COLORS[Math.abs(hash) % COLLAB_USER_COLORS.length];
}
// ②③ RemoteCursors.tsx/CanvasTopBar.tsx：userColor(s.user.id) → s.user.color（读注入字段——禁 fallback 双源）
// ④ awareness.ts：删 userColor 导出+setLocalUser 退位 user 写入（函数删）；replayLocalUser 保留（runtime:147 终态重建/:982 pagehide 自愈承重——R24 注释；改形重放非 user 字段或 no-op）
//    +CollabUser 类型扩 role?:string; color?:string（v3 P-V⑨：TS strict 下 s.user.color 类型必需——服务端注入字段进类型）
// ⑤ CanvasView.tsx:113：删 bridge.setLocalUser({...}) 调用+import 清理（路径=apps/web/src/pages/canvas/components/）
```

红测（web）：等价性锚——服务端注入 color（gateway 侧用 userColorOfUserId）== 客户端对 `s.user.color` 的渲染值==迁移前 `userColor(id)` 的值（三处同值——迁移零色变断言）；RemoteCursors/CanvasTopBar 现有测试随迁+`awareness.test.ts:20-23/:48-54` userColor 用例迁 shared 测试。

- [ ] **Step 4: 全绿+census（`setAwarenessField\('user'\|setLocalUser` + `userColor\(`〔apps/web——shared 除外〕）清零+commit**：`feat(y0b-3): T7 awareness states 三分支覆写+归属表（首帧可见）+color 五件套收口（shared 单源+消费面切字段）`

---

### Task T8: sweep 收窄——节奏与事件（‖可与 T7 并行；**判据已归 T3 零改动**）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（:44-45 间隔+jitter；事件监听；permCache 失效接线；rewriteAwarenessRole 实接〔T3 挂的 no-op 落地〕）
- Modify: 权限变更点（Step 0 探针清单：`apps/api/src/modules/team/team.service.ts` 成员移除/角色变更+project 删除路径）——emit 新事件
- Test: `apps/api/src/modules/collab/collab-perm-events.spec.ts`（新建——T3 的 3×3 矩阵中事件面两格在此扩实连）

**v2 收窄（P-K）**：recheckConnection 判据单源+sweepSessions 判据门两分支+降级 readOnly 已在 **T3** 落地（判据同批规则）——本 Task 只落节奏（5min+jitter）/事件驱动/结论缓存失效/awareness role 改写实接（词表 `ProjectRole` 大写三值——v1 红测小写 'viewer'/'editor' 为第三套词表混用，v2 修正）。

- [ ] **Step 0: 探针**——`project.gone` 既有事件先例（emitter 名/listener 挂载/payload 形态——gateway 现有 @OnEvent 若有）；team.service 成员变更方法名清单（removeMember/updateRole/transferOwner 等）+project 权限变更点；connection→userId 取法（T7 socketIdentity 表）。输出粘 commit message。

- [ ] **Step 1: 红测**

```ts
it('复验降级的 awareness role 改写【v3 对端可见锚——禁只断言服务端 states：meta.clock 未递增时对端全丢弃而服务端自以为成功】', async () => {
  const { conn, peer } = await twoClientFixture(); // 对端=可见性判官
  const editor = await connectAs('editor-then-downgraded'); // T3 判据门已使复验可达
  await downgradeToViewerInDb(userId);
  await vi.advanceTimersByTimeAsync(5 * 60_000 * 1.2 + 1_000);
  expect(editor.readOnly).toBe(true);
  expect(peer.seesUserOf(editorClientId).role).toBe('PROJECT_VIEWER'); // ★对端可见值（clock 递增的证据）——服务端 states 断言只作旁证
  expect(await metricValue('collab_sweep_close_total', { cause: 'role-downgraded' })).toBe(1);
});
it('权限语义 A（v3 P-U② int 两例之一）：移出团队但有显式 ProjectMember 行→WS 仍可连（REST 同链既有语义——预期行为非缺陷）', async () => {
  await seedExplicitProjectMember(userId, projectId, 'PROJECT_EDITOR');
  await teamService.removeMember(teamId, userId); // 不触碰 ProjectMember 表（实证）
  await expect(connectAs(userId, projectId)).resolves.toBeDefined(); // resolveWithTeam 显式档放行
});
it('权限语义 A（之二）：移出团队且无显式行→≤1s 被踢（事件路径 cause=no-role；v3.1 scheduleImmediateSweep——setImmediate 在 fake timers advance 中冲洗）', async () => {
  const conn = await connectAs('plain-member');
  await teamService.removeMember(teamId, userId);
  await vi.advanceTimersByTimeAsync(1_100); // 不再等 5min tick——事件→立即 sweep 复验踢线
  expect(conn.closeCode).toBe(4401);
});
it('事件驱动即时踢权：removeMember 事件→该成员全部连接 ≤1s 内 scheduleSweepClose（revoked）；sweep 5min 只是兜底（E39 口径=事件面零+兜底 5min）', async () => {
  const conn = await connectAs('member-to-remove');
  await teamService.removeMember(teamId, userId); // 变更点 emit
  await vi.advanceTimersByTimeAsync(1_100);
  expect(conn.closeCode).toBe(4401); expect(conn.closeReason).toBe('session-expired');
});
it('会话级结论缓存 5min：同连接复验结论缓存内零 DB（事件到达即失效该连接缓存）——3×3 矩阵 cache-hit 行', async () => {
  await sweepTickOnce();
  const before = prismaCallCount();
  await sweepTickOnce(); // 缓存命中
  expect(prismaCallCount().delta()).toBe(0);
  emitPermChanged({ userId, teamId }); // 事件清缓存=立即复验
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

// v2 P-K：recheckConnection 判据已在 T3 落地（resolveWithTeam 单源+降级 readOnly+revoked）——本 Task 零判据改动。

// rewriteAwarenessRole 实接（T3 挂的 no-op 落地——词表 ProjectRole；v3 P-U① **必须先递增 meta.clock**）：
private rewriteAwarenessRole(connection: any, role: 'PROJECT_VIEWER' | 'PROJECT_EDITOR') {
  // ⚠ clock 判据（y-protocols applyAwarenessUpdate）：`currClock < clock || (equal && state===null && has)`
  // ——服务端直接改 states 不动 meta ⇒ 编码用旧 clock ⇒ 对端全丢弃而服务端自以为成功（假绿型）。
  // T7 注入能生效恰因骑在入站帧更高 clock 上；本函数是服务端自发写——无帧可骑，必须自增：
  for (const clientId of this.ownedClientIdsOf(socketIdOf(connection))) {
    const aw = document.awareness;
    const meta = aw.meta.get(clientId);
    aw.meta.set(clientId, { clock: (meta?.clock ?? 0) + 1, lastUpdated: Date.now() }); // ← 先递增
    aw.states.set(clientId, { ...(aw.states.get(clientId) ?? {}), user: { ...(aw.states.get(clientId)?.user ?? {}), role } });
    // 再广播：applyAwarenessUpdate(aw, encodeAwarenessUpdate(aw, [clientId]), { source: 'local' })——
    // 服务端内部写 origin 不进 beforeHandleAwareness 三分支（该钩子只挂 inbound Awareness 分支 esm:196-214）——不被自己的闸剥离 ✓
  }
  // 锚（Step 1）：断言**对端可见的 role**——禁只断言服务端 awareness.states（clock 未递增时对端丢弃=假绿）
}

// 事件驱动（EventEmitter2——project.gone 先例 gateway:1006 形态对齐）：
// 变更点 emit（team.service 移除成员/角色变更+project 删除路径，Step 0 清单全量）：
this.eventEmitter2.emit('collab.perm.changed', { userId, teamId, projectId? });
// gateway 监听（@OnEvent('collab.perm.changed')）——v3 P1-2 只清缓存使撤权退化 ≤6min（v3.1 修：恢复 spec §3.1"即时"）：
//   遍历匹配 userId+teamId 的连接（connection→userId 从 T7 socketIdentity 表）
//   →permCache.set(conn, { role: null, at: 0 })（表达"立刻到期"）→ scheduleImmediateSweep()
private sweepKickPending = false;
private scheduleImmediateSweep() { // 事件=缓存失效信号+请求一次立即 tick——**仍单一执行路径 sweepSessions**（不新增第二执行器）
  if (this.sweepKickPending) return; // 事件风暴合并为一次（防惊群）
  this.sweepKickPending = true;
  setImmediate(() => { this.sweepKickPending = false; void this.sweepSessions().catch(() => {}); });
  // tick 与 event 撞窗的重叠 sweepSessions 为良性：double close 在 CLOSING 态 no-op+recheck 幂等（permCache 重写）
}
```

（"单人团队特例分支删除"——v2 已裁删除+**评审核验现状 gateway 已无该分支**=登记"已不存在零改动"。）

- [ ] **Step 3: 全绿+commit**：`feat(y0b-3): T8 sweep 节奏 5min+jitter+事件驱动即时踢权+permCache 事件失效+awareness role 改写实接（ProjectRole）`

---

### Task T9: 客户端锁定项（close 分型→machine 输入映射+真停连开关+write-frozen+503 retryAfter+版本 reload）

**Files:**
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（authenticationFailed 写点/close 分型映射/onStateless write-frozen/静默续期/版本 reload/1012 收编）
- Modify: `apps/web/src/stores/connectionMachine.ts`（若需扩输入字段——预期零改动：terminal 输入 :21/:31 已备）
- Modify: `apps/web/src/utils/collabDiagnostics.ts`（auth_reject/write_reject 接线——ring 类型族扩）
- Modify: `apps/web/src/api/client.ts`（retryAfter 解析挂载）
- Modify: banner 组件（Step 0 探针现挂点——四/五档终态+write-frozen+瞬态横幅 UI）+`apps/api` gateway（H-5 frozenConnections Map 还原——服务端半同 commit）
- Test: `apps/web/src/stores/canvasCollabRuntime.spec.ts`（扩——现有 conn.spec 形态）+`client.spec.ts` 扩+`collab-close-code` 消费测试

**v2 重写（P-M/F-2/F-1/H-5/P-S）**：①**唯一退避源=connectionMachine.RECOVER_BACKOFF_MS（:9 既有）+唯一执行器=recovery.recoverConnection()**——删 v1 自建退避表与 scheduleBackoffReconnect（四路并发重连风险）；close 事件**只写状态**禁直调 connect。②terminal 停连=**显式 `websocketProvider.disconnect()`**（真开关 esm:367-376 置 shouldConnect=false——provider.disconnect() 是真转发〔manageSocket=true〕但显式层调用消歧）+terminalSuppressed 电平；**connect() 首行置回 shouldConnect=true（esm:225）⇒ terminal 后任何路径禁再调 connect**（watchdog/recovery 复发防线——recoverConnection terminal 判定补 wsAuthNotice.terminal 值源）。③1012 分支 :854-855 裸 websocketProvider.connect() **收编**（行为经 conn.spec:213-264 既有锚维持——plannedRestartUntil 只驱动 UI 钳制）。④验收锚**输出级**。

- [ ] **Step 0: 探针**——runtime 现有 provider 事件接线清单（:835-860 形态）+watchdog/recovery 两级原语（:121-159/:942-988——cooldownMs 注入点 :955）；banner UI 现挂点（plannedRestartUntil 消费 :164）；hasUnsyncedCanvasChanges 自持标记存在性（Y0b-2 T7 反应式重发落的谓词——grep）；executeGroupNodes catch 现形态（SYNC_PENDING 自动重试先例——同范式接 503）；sessionStorage 键约定。输出粘 commit message。

- [ ] **Step 1: 红测——wsAuthNotice 写点+输出级终态停连锚（v2）**

```ts
it('authenticationFailed→wsAuthNotice{reason,terminal} 写点（改前红：生产零写点——声明+消费在、写入侧缺失）+auth_reject diag', () => {
  const p = initProviderForTest();
  p.emit('authenticationFailed', { reason: 'forbidden' });
  const s = useCanvasStore.getState();
  expect(s.wsAuthNotice).toEqual({ reason: 'forbidden', terminal: true });
  expect(diagCount('auth_reject')).toBe(1);
});
it('【输出级锚】terminal reason→websocketProvider 真停连：N 秒内 websocketProvider.connect 调用数==0 且 WebSocketPolyfill 构造计数==0（v2：spy p.disconnect 会假绿——provider.disconnect 是转发非空函数，断真开关的输出面）', async () => {
  vi.useFakeTimers();
  const p = initProviderForTest(); const wsConnect = vi.spyOn(p.configuration.websocketProvider, 'connect');
  p.emit('authenticationFailed', { reason: 'schema-outdated' });
  await vi.advanceTimersByTimeAsync(31_000); // 越过库 31s 重连周期
  expect(wsConnect).not.toHaveBeenCalled();
  expect(constructedSockets()).toBe(1);      // 初始 1 个——无新 socket（单飞）
});
it('瞬态 reason（server-overloaded/db-unavailable/draining/lease-not-ready/rate-limited）→不断连+wsAuthNotice.terminal=false+退避交给 watchdog/machine（connectionMachine 既有表——禁新建）', () => { /* 对称+cooldownMs 断言 */ });
it('4401 session-expired close→静默重连一次（recovery 单飞），二次失败才终态；库 4401 Unauthorized（经 authenticationFailed）→终态不续期（双键分型红：只判 code 必混淆）', async () => { /* 双分支 */ });
```

- [ ] **Step 2: 实现——close 分型→状态映射（禁直调 connect）**

```ts
// createProvider 内（:846-857 close 块重写——分型只写状态；恢复所有权 100% 归 watchdog+machine+recovery）
let terminalSuppressed = false; // 模块级电平（sessionEpoch 对齐重置）
p.on('authenticationFailed', ({ reason }: { reason: string }) => {
  const terminal = isTerminalReason(reason);
  useCanvasStore.setState({ wsAuthNotice: { reason, terminal } });
  recordCollabDiag('auth_reject');
  if (terminal) {
    terminalSuppressed = true; // 供 watchdog/machine suppressed 析取（:960 terminal 输入已有——值源补电平）
    p.configuration.websocketProvider.disconnect(); // 真开关：置 shouldConnect=false（esm:367-376）——onClose 定时器因 !shouldConnect 不再排程（esm:411-413）
    // ⚠ connect() 首行置回 shouldConnect=true（esm:225）——terminal 后 watchdog/recovery 任何路径禁再调 connect（复发防线注释钉死）
    // 版本族→handleVersionTerminal（Step 4）；其余终态→四档 UX 由 wsAuthNotice 消费组件渲染
  }
});
p.on('close', ({ event }: any) => {
  const action = resolveCloseAction(event?.code, event?.reason);
  if (action.kind === 'planned-restart') {
    plannedRestartUntil = Date.now() + 30_000; // 既有 :851 链路收编（UI 钳制 :164 消费）；重连交既有 1012 短退避（conn.spec:213-264 锚——行为不变）
  } else if (action.kind === 'silent-renew-once' && !silentRenewUsed) {
    silentRenewUsed = true;                    // 4401 'session-expired'（sweep）——静默一次（§3.5），失败落终态
    // v3 S-4：silentRenewUsed 在 authenticated 事件重置（:837-843 既有块内 silentRenewUsed = false——
    // "每次成功认证重置一次静默额度"；不重置=用户可感知的续期额度缩水：数小时后再次过期直接落终态本可再续）
    void recovery.recoverConnection();          // 唯一执行器
  } else if (action.kind === 'terminal') {
    useCanvasStore.setState({ wsAuthNotice: { reason: action.terminalReason!, terminal: true } });
    terminalSuppressed = true;
    p.configuration.websocketProvider.disconnect();
  }
  // backoff/normal/reconnect：零动作——watchdog 按既有 cooldownMs（RECOVER_BACKOFF_MS 表 :955）单飞恢复；
  // 库 onClose 1s 定时器与 machine 表的从属关系：库先连（应答快速失败）→watchdog 兜底——注释声明（禁两套不声明）
});
```

- [ ] **Step 3: 红测+实现——write-frozen 最小形态（P-S v2：connected 重放删除——drain 期新连接被 :255 DRAINING 拒⇒重放无对象）**

```ts
it('onStateless 收 write-frozen→writeFrozen=true+横幅态+canExecute=false（canEdit 面由服务端 readOnly 双保险）', () => {
  const p = initProviderForTest();
  p.emit('stateless', { payload: JSON.stringify({ type: 'write-frozen', reason: 'draining' }) });
  expect(useCanvasStore.getState().writeFrozen).toBe(true);
  expect(canExecute(useCanvasStore.getState())).toBe(false);
});
it('恢复：drain 解除 1012→短退避重连→authenticated 事件清零 writeFrozen（复用 1012 既有链路零新恢复逻辑）', async () => { /* 事件序列 */ });
it('服务端 H-5：drain 解除先还原 readOnly 再 close（frozenConnections=Map<conn,prevReadOnly>——close 在 CLOSING 态 no-op 的边角不再永久只读）', async () => {
  // gateway 侧用例（spec）：beginDraining→:669-673 解除路径断言 conn.readOnly===prevReadOnly 且 close(1012)
});
```

（runtime `onStateless` 监听 try/catch 包裹 JSON.parse；服务端 :682 既有发送点+**H-5 修正：frozenConnections 从 Set 升 Map<conn,prevReadOnly>，:669-673 解除路径先还原 readOnly 再 close**——gateway 侧小改同 commit；~~connected 钩子重放~~ v2 删除〔P-S：drain 期新连接被 :255 DRAINING 拒⇒重放无对象〕。）

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
  // v3 P-V⑧：同一按钮同时接 message-too-big 终态（1009 内容确定性——重连重发同一超限帧=无自救循环；
  // 若 T6 探针实测客户端观测为 1006 则逃生挂点随观测面调整）
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

- [ ] **Step 6: 四/五档终态 UX 横幅组件**——wsAuthNotice 消费（Step 0 探针 banner 挂点）：版本过期（reload/逃生动作——Step 4）/会话过期（重登链接）/无权（回工作区）/SCHEMA_OUTDATED+CLIENT_VERSION_*（并入版本过期档文案）/**message-too-big 第六终态档（v3.1 F9：1009→terminalReason='message-too-big' 不在 auth reason 词表——映射表必须显式列此档否则落未知档；逃生=版本逃生同一按钮〔P-V⑧〕）**；DB 不可用/SERVER_OVERLOADED/RATE_LIMITED（非终态——横幅自动重试+退避中提示「服务繁忙，正在自动重试」）；write-frozen 横幅「服务维护中，编辑已暂停；恢复后可继续（请勿刷新页面）」。UI 测试：分档快照/文案断言。

- [ ] **Step 7: 全绿+commit**：`feat(y0b-3): T9 客户端锁定项——wsAuthNotice 写点+真停连开关（输出级锚）+close 分型 machine 映射（删自建退避表）+1012 收编+write-frozen（H-5 Map 还原）+版本 reload 自愈+503 retryAfter`

---

### Task T10: 空闲保活证伪性验证锚（v3 整删改写——~~ping/pong+onStateless+三指标+messageReconnectTimeout/forceSyncInterval pin~~ 全部不作）

**Files:**
- Test: `apps/api/src/modules/collab/collab-idle-anchor.spec.ts`（新建——真连装置只读锚，零生产代码改动）

**P-T 四环实证（v3.1 补第四环+第五环——写进测试文件头注释，防后人"补保活"回潮）**：
1. y-protocols `awareness.cjs:85-103`：`setInterval(..., floor(outdatedTimeout/10))`=**3s tick**+`:87` 15s 门限（outdatedTimeout/2）触发 `:89 setLocalState(getLocalState())` 续期——机制=3s 轮询+15s 门限（净效果 ~15s 一帧）；`setLocalState`（:127-161）**clock 无条件 +1（:130）且无条件 emit 'update'（:160）**（equalityDeep 过滤只在 'change' :158——续期帧必发非"可能发"）；Awareness 构造器尾 `:107 setLocalState({})` 使 `getLocalState()!==null` 恒成立（远端清场删不掉本地态——"never let a remote client remove local"分支）。
   ⚠ **P-T 成立前提=本地态非 null**（构造器 :107 播种保证+本仓 runtime:882 显式播种冗余）——**禁引入 `setLocalState(null)` 清场调用**（会使续期分支永 false=静默废掉保活）。
2. provider `esm:776-780`：续期帧 origin='local'（字符串）≠provider 实例 ⇒ `if (origin === this) return` 不命中 ⇒ 发送。**第五环（v3.1）**：handler 挂 **'update'** 事件（`esm:905 off("update")` 注册面实证）——若挂 'change' 则续期帧被 equalityDeep 过滤=P-T 全塌，实际挂 'update' ⇒ 必发。
3. server `esm:671-673`：`broadcastAwarenessUpdate` 无 origin 过滤 ⇒ 回显发送者（solo 单连接也收）。
4. **（v3.1 第四环）** provider `esm:305-307`：`onMessage` 首行 `lastMessageReceived = getUnixTime()`——每入站帧（含回显）刷新 ⇒ 客户端 30s messageReconnectTimeout 恒满足。
⇒ **空闲连接每 ~15s 有双向 awareness 帧**，两侧 lastMessage 计时器恒被刷新——spec §5.2"空闲零应用层消息⇒30-60s 判死四害"前提在本仓不成立。**后台标签**：pageHide 删本地态（provider `esm:733-735`——`removeAwarenessStates([document.clientID])`，awareness `:75 clientID=doc.clientID` 命中生效）⇒续期停⇒30s 判死⇒回前台重连=**正常预期非缺陷**（第四轮"pageHide no-op/幽灵 30s"论经 `:75` 证伪驳回）。**P14 向量随 onStateless 不注册归零**（库默认 `onStateless: () => Promise.resolve(null)` 不抛——esm:1259）；T1 unhandledRejection 兜底独立保留（买单者=T2 onUpgrade catch→throw）。`forceSyncInterval` 零配置（续期帧即保活+补传兜底已有 forceSyncAndWaitUnsynced :1104 按需）。

- [ ] **Step 0: 探针**——真连装置空闲计时形态（fake timers 不可用于真连——用真实 90s 等待或装置级短超时注入）；`provider.awareness` 的 meta.lastUpdated 可读性（服务端帧时刻的旁证源）。输出粘 commit message。

- [ ] **Step 1: 只读验证锚（今日即绿——价值=用证据钉死不需要保活，防未来回潮）**

```ts
it('【证伪性锚】空闲 90s：零应用层保活配置下连接存活——无 4408 close/无重连（sessionEpoch 不变）/doc 常驻（无新物化）+服务端 lastMessageReceivedAt 15s 尺度被刷新（awareness 自续期双向帧——P-T 四环的行为级证据）', async () => {
  // 前台/可见标签语义下断言（后台标签 pageHide 清场触发一次重连=正常预期——头注第 1 条）
  const { provider, captureEpoch, serverLastMessageAt } = await connectIdle('project:idle');
  const epoch0 = captureEpoch();
  await sleep(90_000); // 真实等待（真连装置——禁 fake timers）；90s 覆盖 spec §5.2 死亡区间 30-60s 全谱
  //（45s 压缩提案驳回——只覆盖 30s 子档；CI 时长敏感可降 45s+timeout 60_000，服务端死线 30s 子档仍可证）
  expect(captureEpoch()).toBe(epoch0);                       // 未重连（无 4408/无新 socket）
  expect(await serverLastMessageAt('project:idle')).toBeGreaterThan(Date.now() - 20_000); // ≤20s 内有入站帧
  expect(gw.server.hocuspocus.documents.has('project:idle')).toBe(true);                  // 常驻无重装载
}, 120_000); // v3.1：显式 timeout 必须——vitest 默认 5s 必挂
```

- [ ] **Step 2: spec 勘误登记（偏离 11）**——spec §5.2 v2.3/v2.4 的 stateless ping 设计+§7.2 forceSyncInterval=60_000 pin 两行：前提（空闲零应用层消息）被 P-T 三环证伪——**勘误建议同步 spec 侧**（九轮外审漏了 y-protocols 协议层自续期）；本锚即"从根上解决"的执行形态（证据替代机制）。

- [ ] **Step 3: commit**：`test(y0b-3): T10 空闲保活证伪性锚——awareness 15s 自续期双向帧行为级证据（spec §5.2 前提勘误登记；ping/pong 整批不作）`

---

### Task T11: 出口汇聚（verify+census+int 回填+spec 回填+部署清单；【用户确认点】）

**Files:**
- Modify: `scripts/check-int-coverage.mjs`（新 int 文件下限——若有新建 int 文件）
- Modify: `docs/superpowers/specs/2026-10-08-y0b-funds-and-access-design.md`（§0.4 偏离登记表追加 Y0b-3 行——P-B/P-C/P-G/§0.1 各裁定落记）
- Modify: `docs/superpowers/specs/2026-10-06-canvas-yjs-arch-upgrade-review.md`（v8 目录 Y0b 行回填——Y0b-3 完成态+commit 区间）
- Modify: `docs/superpowers/runbook`（若有 §6 tripped 处置行要求——heap 闸 runbook 行归 Y0b-5 §5.8⑥；本批仅验登记）

- [ ] **Step 1: verify 三连**——`pnpm verify`（含 check-spec-consistency——spec §7 fenced 块与本批 env/指标/close code 对齐，各 Task 已同步则绿）+`pnpm test:int:ci`+`pnpm --filter web test`。全绿后逐文件核对 int 覆盖下限。

- [ ] **Step 2: census 五组清零验证**（§TDD 纪律清单——grep -P 或分次 grep）：
  - `requestParameters?.get\('token'\)`——gateway 零命中
  - `close\(1012\|close\(4401\|close\(1000`——gateway+runtime 裸字面量零命中（shared 常量/@hocuspocus/common 导入引用除外）
  - `'0\.0\.0\.0'`——gateway 零命中
  - `setAwarenessField\('user'\|setLocalUser`——web 零命中（replayLocalUser 保留不入）
  - `userColor\(`——apps/web 零命中（shared 单源 userColorOfUserId 除外）

- [ ] **Step 3: 出口演练核对（§3.6 清单逐项过；v3 更新）**——sweep 默认开/角色复验降级（含 awareness role=ProjectRole**对端可见锚**）/事件即时踢权（**仅清缓存**）+权限语义 A int 两例/Origin 握手失败锚/cookie-only+`?token=` census/parse-session-token 三形态/awareness 伪造+归属+首帧锚+上限计数/版本门四档+联合锚/版本过期 reload 用例/schema 拒连演练（authenticationFailed.reason==='schema-outdated'+disconnect+N 秒重连==0〔输出级〕）/防放大三锚/heap 闸四红〔④卡住观测形态〕/check-ecosystem 单源区间链（提取式 fail-closed）/连接寿命 4402〔socketId 键控〕/升级限流+三防线/**空闲 90s 证伪性锚（v3 替代 ping 双向出口+P14 红锚）**/access_log+no-store 服务器侧断言/**1009 客户端观测探针结论登记**/权限链五形态（F-3）。缺项回补，逐项在 commit message 列勾。

- [ ] **Step 3bis: 重连演练（v2 新增 v3 硬判据；单实例 2 核实测 N=50，N=200 服务器侧冒烟可选）**——N=50 客户端同时重连：全部 `authenticated` ≤30s、零 4205/4408（**由演练客户端记录的 close code 断言——v3.1 F9：服务端 ws_close 只覆盖应用侧主动 close，库自发码唯一可观测面=客户端**）、`collab_auth_inflight` 峰值≤4、`collab_unhandled_rejection_total` 与 `collab_overload_state{tripped}` 均不增、**库 `getPendingDocumentCount()` 峰值 <50（v3 硬判据——否则一次部署即批量 4205；超限则登记 §0.4 再评估 maxPendingDocuments 调值，spec 钉 100 维持）**。

- [ ] **Step 4: spec 回填**——spec §0.4 追加 Y0b-3 落地偏离行（**以本 plan §0.4 预登记 16 条为底**+实施期新增；spec 侧两处勘误建议同步：§3.2 红锚④前提〔偏离 1〕/§3.3"消费面零改动"措辞〔偏离 3〕）；v8 目录 Y0b 行回填（完成态+commit 区间+残余分派）。

- [ ] **Step 5: 部署清单（【告知用户点】——Y0b-2 先例形态）**：
  1. 服务器 `.env` 增 `COLLAB_TRUSTED_PROXY=1`（**必须**——不设=升级限流全站 127.0.0.1 单桶=重连风暴全站锁死，恰是限流要防的反面）；
  2. 服务器 `.env` 的 `DATABASE_URL` 追加 `?connection_limit=5&pool_timeout=5`（**v3.1 修正：pool_timeout 单位=秒**——原 5000≈83min=P2024 兜底近失效；对照=池 5−REST/worker 预留≥INFLIGHT 4；runbook 登记）；
  3. 可选 env（默认值即 spec 契约，不建议改）：COLLAB_ALLOWED_ORIGINS（默认 BETTER_AUTH_URL 推导+生产已剔除 localhost——若生产域名≠BETTER_AUTH_URL origin 则必须显式设）/COLLAB_SWEEP_ENABLED（逃生阀）/COLLAB_RSS_*；
  4. 部署窗口语义：**已打开的旧 bundle 会话全部进版本终态拒绝**（CLIENT_VERSION_MISSING 档——fail-closed §9.1 既定非风险）——建议低峰部署；
  5. nginx/ecosystem 零变更（access_log off+X-Real-IP 已在；access_log/no-store 断言已进 deploy 服务器侧校验链）；
  6. 部署后冒烟：伪造 Origin 握手 4xx+`collab_upgrade_rejected_total` 可见+`collab_overload_state{state="ok"}`=1+ready 含 collabProtocolVersion（200/503 双分支）+`collab_ws_close_total` 可见。
  7. runbook 巡检登记（v3.1 F7——"可观测"变"会被发现"的最后一步；spec §5.8 巡检脚本+结构化日志口径）：`collab_load_rejected_total` 持续非零（>0 连续 5min→heap 处置行）/`collab_auth_reject_total{reason="db-unavailable"}` 突增（→PG/池排查）/`yjs_doc_stuck_total`>0（→观测确认，不手动卸载）/`collab_ws_close_total` 分布漂移（4402/1012 占比异常→寿命/drain 频度核对）/`collab_awareness_reject_total{reason="owner-limit"}`>0（→单连接 clientId 泄漏，客户端版本核对）。

- [ ] **Step 6: commit+【用户确认点】**：`docs(y0b-3): T11 出口汇聚——verify 三连+census 五组+重连演练+spec §0.4〔预登记 16 条回填〕/v8 回填+部署清单`

---

## Self-Review 记录（v3 已执行——覆盖三轮评审裁决落位）

- **Spec 覆盖（v3）**：§3.1（sweep/事件/Origin/cookie-only/限流）→T2/T3/T8（判据门在 T3——P-K；事件=仅清缓存 P1-2）；§3.1bis 四层→T3/T4/T5（序钉死 refusalCache→信号量→桶→heap→版本→DB）；§3.1ter→T2（Origin end 形态）；§3.2→T4（两量纲独立布尔+ServiceUnavailableException 形态+**卡住观测替代卸载 reaper**〔偏离 13〕）；§3.3→T7（states 三分支+反向索引+剪枝+上限计数+color 五件套+首帧锚）+T8（**clock 递增+对端可见锚**）；§3.4→T0/T5/T9（四档〔'0'=invalid 统一+current 注入测〕/通道/reload UX；**矩阵删除**〔偏离 14〕）；§3.5→T0/T6/T9（词表/通路/寿命 socketId 键控/分配表〔reconnect 档删〕/静默续期〔authenticated 重置〕）；§3.6 出口→各 Task 锚+T11 汇总；§5.1/5.2 锁定项→T9（**T10 保活项随 P-T 证伪删除——spec 勘误〔偏离 11〕**）；§5.3 write-frozen/503→T9（P-S 最小形态）；§7.1/7.2 env/pin→T1（maxPayload 三 pin；~~forceSyncInterval/messageReconnectTimeout pin~~ 随 P-T 删）；spec §4.1⑥ maxPayload 行为断言（1009 真连）→**T6 观测探针先行**（形态定挂点）+行为断言归 Y0b-4 维持。
- **四轮评审裁决落位（v3.1 增第四轮·三报告合流）**：V-1 重复声明删+无 cookie 不落缓存红测补（T3 Step 1/3）；onDrainReleased 陈旧测试→onServingTransition 单点表驱动（T3——v2 方法名已不存在）；pendingQueues 键=裸 projectId 修正（T4 observeIdleDocs——gateway:321/:151/:826 实证）；**F2 事件即时性恢复 scheduleImmediateSweep**（v3 采纳 P1-2 过度=撤权退化 ≤6min 且 T8 红测 1.1s 断言不可达——setImmediate 请求一次 tick，仍单一执行路径，T8）；pool_timeout 单位秒改 5（§0.3/T11 Step 5.2）；§0.1 四行 supersede（P-E/P-G/P-J/P-O）+六处陈旧引用清扫（TDD 块/T4 标题+Files/T1 Step 3/锚点表 onStateless 四钩子与 +ping——后两处本轮自查新发现）；T7 双索引 ownedClientIds Set（计数=.size 消 NaN+剪枝 O(自己)+ownedClientIdsOf/socketIdOf 落定义+onDisconnect 清理名修正 awarenessOwnership→双索引迭代——T8 原引用未定义 helper）；Map 老化独立 timer（T3 挂载注+T4 三 timer 清单——SWEEP_ENABLED=false 禁关老化）；SUE 对象形态 COLLAB_NOT_SERVING（T4——filter:17-22 实证，字符串形态落 fallback=无 Retry-After）；T10 锚显式 timeout 120s+90s 保留（45s 压缩驳回：只覆盖 30s 子档）；deadline≠DB 并发边界注释（T3+偏离 6 口径）；message-too-big 第六终态档显式（T9 Step 6）；客户端 close code 断言（T11 Step 3bis）；巡检小表（T11 Step 5.7）。**驳回**：pageHide no-op/幽灵 30s 论（awareness.cjs:75 `clientID=doc.clientID` 直接证伪——四轮评审第 4 处错误论断，模式=未读构造器赋值行；其"后台标签断连正常+锚须前台断言"结论采纳进 T10 头注）；45s 压缩；V-3b 注释位置（核验本就在测试块=免动作）；占池实测探针（单位=文档语义，改值+注释足够）。**P-T 补强**：第四环（provider esm:305-307 onMessage 刷新客户端计时器）+第五环（esm:905 off('update')——handler 挂 update 非 change，续期帧必发非可能发）+机制精化（3s tick/15s 门限/clock 无条件+1 且 update 无条件 emit）+前提禁令（禁 setLocalState(null)——静默废保活）。
- **三轮评审裁决落位（v3 增第三轮）**：**P-T T10 保活证伪→整删改锚**（三环一手复核：awareness.cjs:85-89 自续期+provider :776-780 origin 发送+server :671-673 回显）；**P-U① clock 递增→T8**（对端可见锚）；**P-U② 权限语义 A→T3 cause 分型+T8 int 两例**（偏离 12）；S-1 夹具 resolveWithTeam→T1.5 Step 2.5；S-2 跨包 import+PROTOCOL_COMPAT 删→T0（偏离 14）；S-3 owned 剪枝+上限计数→T7（collab_awareness_reject_total）；S-4 silentRenew 重置→T9；S-5 提取式 [\d_]+ fail-closed→T4；必修 2 键型/必修 3 peak 笔误→T4/T3；P1-1 awareness Map 清理统一→T6 清单；P1-2 仅清缓存→T8；P1-3 reconnect 死档→T0；P1 sweep 拆 timer→T4/T1；7.1 reaper 卸载删→T4（偏离 13 彻底版）；7.2 clientIdOwner 反向索引→T7；7.3 1009 探针+逃生扩展→T6/T9；7.4 ws_close 边界→§0.2；csv>current 放行改判/**S-6 删 throw 指标/P0-V2 编译红论=驳回**（理由见 P-V/评审回应）。
- **两轮评审裁决落位（v2 沿革）**：F-1→P-M（真开关+输出级锚）；F-2→P-M（machine 单源）；F-3→P-K（T3 全量）；H-1→T6（socketId）；H-2/P0-1/P0-2→T7（states+三分支+放行+无条件注入）；H-3→T7（**归属表 spec 语义维持**——库 clients 集在 hook 后填充不能作权威，评审第二轮自我更正确认）；H-4→T4（删 withDoc）；H-5→T9（Map 还原）；M-1→T1.5；M-4→T0/T5（server-outdated）；M-5→P-Q（真实凭据）；M-9→T5（GIT_COMMIT_HASH）；M-10→T5（服务器侧）；M-11→T4（HEAP_DEFAULTS）；M-12→T3（序修正回 spec）；M-14→T4（reaper 定时器纪律）；§6.1→T7（replayLocalUser 保留）；§6.2→P-L（color 五件套）；sweep 判据门（第二轮重磅）→T3；v2 第三份大推翻案→**已驳回 7 项**（refusalCache 删/RSS 单量纲/reaper 删〔v3 部分反转：卸载动作删但观测保留——可达性论证被第三轮 7.1 补强〕/同源 Origin/kill switch/maxPending 500/区间协商——理由见裁定表与评审回应）。
- **已知移交**：collab_idle_timeout_total+库自发 close code 遥测载体=Y0b-5 §5.6 sink（本批仅 synthetic 分型+diag ring+ws_close 边界登记）；refusalCache PG 熔断半开钩子位=Y0b-5 §5.9（清空钩子已单点化为 serving 转移）；quotaState 快照模型=Y0b-4 §4.1③（含幂等快照整体定型——P-S）；>8 人剥离/单连接短路=Y0b-4 §4.4；awareness role 消费方+成员管理 UI 的项目级授权撤销入口=Y0b-4（role 注入+改写维持 spec——偏离 10/12 登记）；1012 已消费勿重做（conn.spec 锚维持）。
- **类型一致性（v3）**：CollabCloseCode/resolveCloseAction（T0 定义=T6/T9 消费——库值 common 导入+四档 kind〔reconnect 删〕）；negotiateClientVersion(csv,current) 双参（T0 定义=T5 消费——current 默认常量，测试注入位）；userColorOfUserId（shared T7 单源=serverIdentityOf 与等价性锚共用）；measureHeapPressure 两量纲独立布尔（T4 单源=check-ecosystem DEFAULT_* 字面量提取源）；clientIdOwner/ownedCount/socketIdentity（T7 定义=T8 rewriteAwarenessRole/事件匹配消费）；connEstablishedAt/authAttemptBuckets/clientIdOwner/ownedClientIds/socketIdentity 五 Map+socketIdOf/ownedClientIdsOf helper（T7 定义=T8 rewriteAwarenessRole/事件匹配消费——v3.1 双索引+helper 落定义；T6 onDisconnect 首行 socketId 统一清理）。
- **占位符扫描**：Step 0 探针均为只读验证性步骤（非设计空位）；「Step 0 探针后定」项（parse-session-token cookie 名二选一/事件变更点清单/userColor 调用行/1009 观测形态等）皆有判定准则或双形态预案，不阻塞执行。
