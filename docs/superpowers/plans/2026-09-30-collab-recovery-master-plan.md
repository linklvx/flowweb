<!-- doc-status: canonical | anchors: - | superseded_by: - | verified_at: 2026-10-06 | verified_at_commit: 122cdf81 -->
# Collab 会话断连恢复 Master Plan（spec v5.10 全批次：批 0c → 批 7）
> ⛔ **本 plan 已完成（2026-10-01 批 7 gate 9/9 绿）。状态真源=下方「完成记录表」。正文 `- [ ]` 为任务模板，非待办——请勿按 checkbox 执行。**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec v5.10（`docs/superpowers/specs/2026-09-29-collab-conn-status-recovery-design.md`）修复 connStatus 状态机断链、堵住资损/安全活漏洞（越权扣费/免费算力/免费产品）、建立执行态意图表+exec map 单一写者、两级恢复原语与服务端权威，最终以双客户端 E2E 作为发布门禁。

**Architecture:** connStatus 由事件派生（recomputeConnStatus 单写点+代际制）；幂等与在飞互斥由 GenerationIntent 表承载（复合唯一+活跃 partial unique，净删 SETNX/dedup/五段键五套机制）；执行态走 doc `exec` map 服务端唯一写者、客户端零 exec 写、恢复读合并视图；恢复原语两级（瞬态传输级 kick / 终态重建+awareness clock 播种）；autosave 与 WS 态解耦（REST 直发）。

**Tech Stack:** NestJS + Hocuspocus 4.6.0（pin 精确版本）+ BullMQ + Prisma/PostgreSQL + Redis + zustand + Yjs + vitest + Playwright（批 7）。

---

## 执行总览（顺序、决策门、通用纪律）

**执行顺序**（绑定条件⑥⑦⑧⑩⑪⑫ 已编入）：

```
决策门 A（F11 载体夹具裁决——先于批 0a：0a 的 recomputeConnStatus 实现与 mock 形状依赖载体）
→ 批 0c（安全止血）→ 批 0a（connStatus 派生+漏斗）→ 批 0b（baseline 守卫）
→ 批 0d（编辑器止血）→ 批 0e（CI 地基）
→ 批 0.5（意图表+exec map）
→ 决策门 B（F6 WebSocketPolyfill spike）→ 批 1（恢复原语+客户端半边）
→ 批 2（hydration/VIEWER/redirect）→ 批 3（服务端三件套+B6）
→ 批 4a（读路径归一）→ 决策门 C（F5 意图漏斗 spike）→ 批 4b
→ 决策门 D（E1/E2 核验）→ 批 5（删信箱+socket.io 退役评估）
→ 批 6（护栏收尾）→ 批 7（双客户端 E2E 发布门禁）
```

**决策门自治规则**：各门按 spec 既定判据自治裁决，结论**回写本 plan 完成记录表**（含证据）。仅四类情况打断用户：①设计级发现改变后续任务 ②决策门结果无本 plan 预写分支 ③spec 判据被现场证伪 ④需用户资源/破坏性操作。

**深度分层纪律**：批 0c~0.5 任务含完整代码（立即可执行）；批 1~7 关键机制含完整代码、其余判据按 spec 判据表编号映射（executor 必读对应判据行——spec 是断言的单一真相源）。**每批开工第一步：重读本 plan 该批任务 + spec 对应判据行 + 用 grep 重校准漂移行号**（前批会改动同文件）；**第二步：产出该批"生效裁决摘要"（十几行——本批涉及的 spec B#/F# 裁决+本 plan 增补）回写完成记录表备注列**（四层文档归并风险从"读文档的人"转移到"开工的门禁"——第九轮评估建议）。

**估时口径**（第九轮评估校准）：批 0c 标称"约半天"实际 **1.5~2 天**（9 任务/12+ 文件/5 测试文件/含手动验证）；整体 plan 真实量级 **4~8 周**。排期按此，不按 spec 原标称压。

**每批通用收尾（每批最后一个 task 的一部分，不单列）**：
```bash
# 受影响侧全量回归（web 侧批跑 web+shared，api 侧批跑 api）
pnpm --filter @flowweb/web test -- --run
pnpm --filter @flowweb/api test -- --run
# 批尾最终闸门（0e 落地前手动执行，之后交给 CI）
pnpm verify
# commit（遵循仓内风格：中文主题 + (collab) scope）
git add <本批文件> && git commit -m "feat(collab): 批 X …"
```

**单测运行命令**（红/绿步骤用）：
- web：`pnpm --filter @flowweb/web test -- --run <文件路径片段>`
- api：`pnpm --filter @flowweb/api test -- --run <文件路径片段>`

## 完成记录表（每批尾滚动填写）

| 批 | 状态 | commit | 决策门结论/批尾备注 |
|---|---|---|---|
| 门 A（F11） | 完成 | 见夹具 commit | 载体结论：**候选 1（inboundAttemptId===attemptId）**。实测（health-carrier.gate.spec.ts）：双发第一发（onOpen）connAttempt 非 null、第二发（resolveConnectionAttempt，首帧触发）已 null；resolve 与 message 同一入站帧同同步栈 ⇒ 两候选防护范围行为等价；候选 1 仅依赖公开事件（mock 零内部状态伪造）胜出——候选 2 需 mock 建模 connectionAttempt 生命周期与双发耦合，正是 F11 立门所防"mock 继承错误信念"。伴生锚固化：provider.onClose() 复位布尔（kick 处方半边）、kick 后恰 1 socket（㉝ 同栈锚）、双发事件序 [非null,null]×2——夹具常驻 CI。批 0a-1 按默认版（候选 1）实现。 |
| 0c | **完成** | 74956249/9d31ae5c/166200c4/cf8b41ae/641f9c3f/e29698fd+82e2e184/24f2682f/e140086f + 质量修复 bebd6ef0/ef658df7 | **批尾备注（2026-09-30）**：8 任务全 TDD 落地，两阶段评审（spec×3 全 PASS+质量×2 修复闭环），api 全量 1249 测试绿+pnpm verify 绿。质量修复1=consume 前移至产物落库前（F4 不变量补全：lighting getTask 免费产物泄露根堵）；修复2=payment.gateway 补 @SkipThrottle()（throttler 6.5.0 WS context res.header 抛 TypeError——0c-8 引入的真回归，已 grep 确认全仓仅 2 个 WS gateway 均豁免）+lighting FAILED 覆写清产物字段+parseSessionToken 5 处收口。**已知残留登记**：①ProjectPermissionService.resolve 对不存在项目抛 404、存在无权 403——非成员枚举仍可区分"不存在 vs 无权"（0c-6 只关 execute 自身 oracle；改 resolve 全局影响，登记上线前必修项）②扣费成功后产物链路异常无补偿对账——批 0.5 F13 根修（CAS 扣费门+complete 门序+对账 job），不在本批扩面③payment.gateway cors:'*' 仍在（范围外——批 5 socket.io 退役评估连带）④PROJECT_TEAM_MISSING 分支无 emitNodeStatus（既有行为）⑤Throttle trust proxy/tracker（代码注释已登记）⑥双客户端冒烟按计划挂批 0a-4。 |
| 0a | **完成** | b4097f90/5165251b/d0c3ec91/00e3a565 | **批尾备注（2026-09-30）**：4 任务全 TDD 落地，两阶段评审全过（spec×2 ✅+质量 Approved），web 全量 2836 绿。0a-1 载体=候选 1（门 A 裁决）；destroyGate 装置真实构造 R23 竞态窗口（非假绿）；0a-3 偏差均合理（loadError 'network'→'unavailable' 更名/散射按钮删除/cancelled+epoch 双保险）。**0a-4 冒烟实测通过**：杀 API→offline→重启 5s 内零刷新恢复 connected（R1 症状根修验证）；首屏零 429（批 0c-8 验证）；smoke-dual-client.md 文件化（场景 2 双端编辑合并登记批 1 验证——批 1 前靠 library ladder）。质量评审 Important（唯一写点注释补 :309 超时豁免）已顺手修；Minor 登记：旧 provider 迟到事件闭卫随批 1 bindProviderListeners 重构一并关死；批 0e lint-gate connStatus 白名单=runtime.ts:89/:309+canvasStore.ts:182（spec 评审摸底）。 |
| 0b | **完成** | a2a92a3a/8988b646 + Minor 顺手修 188dc002 | **批尾备注（2026-09-30）**：孤儿生命周期决策=**服务端 7 天年龄清理（SHADOW_TTL_MS）+onLoadDocument 时点单查（有效触发）+1h interval 兜底（unref）**，批 5 随信箱消失。两阶段评审全过（spec ✅：null 语义校准与水合基线播种均裁定正确——plan 片段 `===null‖has` 系笔误，实现按测试权威 `!==null&&has`；水合播种防"平坦画布首删不传播"回归且 readCanvasFromDoc 过滤影子永不入基线；质量 Approved）。Minor 顺手修：sweep 定时器 shutdown 清理+baseline 测试缝 `_resetBaselineForTest`（防用例顺序依赖）。影子 type 装置保真度（videoGen/audioGen vs imageGen）与"无时间戳旧形状保守保留"均为已锚定行为。web 2839+api 1253 绿。 |
| 0d | **完成** | a12290d1/39045a40 | **批尾备注（2026-09-30）**：三任务完成（0d-3 扫描=**无 F3 同类门控残留**——connStatus 生产命中仅 SaveStatusIndicator 只读展示+注释）。两阶段合并评审 ✅合规+Approved（红点对旧实现实测 4/4+2/2 真实必红；latch 三窗口 409/耗尽/请求中确认不清；门删净 grep 零残留）。Minor 登记不阻断：M1 onStateChange('saving') 仍在 try 外（理论自旋残余——flush 直接 reject 出循环不自旋，批 1 顺手可修）；M2 editorDirty 清零靠 Shell effect cleanup 非 dispose 回调；M3 Shell catch 用例未断言 toast 文案（仅 open）。web 2843 绿。 |
| 0e | **完成**（待 push 首绿） | a7a18b36/ac6f93a1/50f19650/5b528232 + 评审修复 2ff959ba | **批尾备注（2026-09-30）**：4 任务+评审修复落地。评审判 ❌ 的 High（三条静态断言缺常驻 fixture 负例=门禁自身防假绿缺位）已修——fixture 30/30 绿+gateActive 置 false 红检恰 3 负例红；Medium（pin 脚本逐包存在断言）已修（删包负例 exit 1）。存量 eslint error 19→0（逐类最小改动无行为变化）。**偏差登记**：①JWT_SECRET 不设（全仓 0 引用）②MINIO_* 必填不设（spec 不 import AppModule，validateEnv 不触发——已核实）③setState 白名单现状锁定 8 个 UI 文件（既有 UI 态写点非 collab 路径，注释逐条归因+批 2 收口注记——ConfigPanel 收口后同步删条目）。**CI 首绿待 push**（用户确认推送时机后执行+回填首绿 commit）。 |
| 0.5 | **完成** | 67439acb/4195cd53/3c931098/e105290e/041d4af3/11e08010/ee6efd0a/975e6566/607dbce2/9f8dbc79/6d57cf1f | **批尾备注（2026-09-30）**：9 任务+3 补丁（8b 夹缝/8c 死循环/评审修复）全部落地，两阶段评审（组 1-4 ✅/0.5-7 ✅/0.5-8 ✅/8b-8c-9 评审进行中）。**保留策略 N=7 天**（reconcileDaily deleteMany）。**重大实证（回写 spec 候选）**：①真库 P2002 meta.target 恒 null（Prisma 5.22+PG）——plan 预设索引名等值匹配系死代码，已改约束排除法（P2002+无行⇒partial unique〔复合唯一撞击必有行〕）；②@nestjs/bullmq @OnWorkerEvent('failed') 实为 worker.on 直绑位置参数 (job,error)——解构形态静默 no-op。**裁定登记**：resultRef 锚点 text=摘要/video=url/image=url；组执行每节点独立 UUID+首节点用入参；lighting 白名单实修 ['prompt']（无 strength）；lighting 与 ai-image-edit 共用一队列（reconcile kind 路由两队列）；consume 保留未删（五扣费点已切 reserve→settle，退役登记后续）。**死文件处置**：video-separate.cron 功能搬入 reconcileDaily 后删除；team-subscription-expire.processor 删除（expireSubscriptions 成孤儿方法——只登记）。**api 1389+web 2885 绿+verify 绿**。 |
| 门 B（F6） | **完成** | ws-polyfill.gate 夹具 commit（见下） | spike 结论：**四点全过 ⇒ 改道 transport**。实测（ws-polyfill.gate.spec.ts）：①构造签名（首连即走自定义类，created=1）②onOpen 派发（isSynced/isAuthenticated 完整同步链）③kick 注入+重连走自定义类（created=2、第二个 synced 到达、旧实例 CLOSED/新实例 OPEN）④destroy 清理（liveAfter=0 零泄漏零异常）。裁定：批 1 恢复原语瞬态分支=自持传输薄层 transport.reconnect()（新增 transport 薄层任务——原生 WebSocket 包装+reconnect() 公开方法），㉕/㉝ 契约约束随传输自持整体删除（kick 同栈论证/无条件 connect 处方不再需要）；spike 夹具升格契约锁夹具常驻（升级 provider 必复验）。 |
| 1 | **完成** | bcfa2ac3/bd2c317b/315665fd/2049996a/f2edc493/0fe95f67/e11444f0/fb74cb1d | **批尾备注（2026-09-30）**：8 任务（含门 B 裁决新增 1-0 transport 薄层）全 TDD 落地，spec 评审 ✅ 全 PASS（含 watchdog 与 recompute 一致性专项——watchdog 严格更强系设计意图）。**浏览器验收达成**：杀 API→offline→断连期 UI 加节点→重启→自动恢复 connected（connUi=hint 分级正确）→**reload 后断连期编辑仍在（L19 持久化实证）**。**transport 裁定**：close(1000) 对 OPEN socket 足够（库自接管）、needKick 仅非 OPEN 四态。**socket.io 退役评估（前移完毕）**：已死 1（execution:complete 零消费）+仍活 23 调用点（node:status 17〔主路径 dual-write 已落、缺口=reserve-fail 2 分支+credits 推送〕+trim/separate/stitch 6〔唯一通道但 web 轮询兜底在〕）——建议保留+冻结分两步退役（trim/separate/stitch 补 6 写点后切 doc；包级移除被 /payment gateway 阻塞另立评估）；评估文件 docs/superpowers/plans/socketio-retirement-assessment.md。**瑕疵登记**：①runtime :407 注释"七监听"实为 6（顺手可改）②1012 处 Math.random 在 runtime（无纯度要求，合规）。admin 页 4 测试曾现 flaky（干净树复现+单跑绿+后续 3 轮全量未复现——登记观察）。web 2958/api 全量绿。 |
| 2 | **完成** | 025bd5e0/10ce8f15/f4840ecf + /videos 白名单补 24 用例 | **批尾备注（2026-09-30）**：3 任务全 TDD 落地，合并评审 ✅ 通过（修 D 结构性验证成立：超时不 destroy+heartbeat 先启动+failed 态 watchdog 可达；S1 偏差〔collabReadOnly 单键代 canEdit——水合窗口 ready 分量结构性为假〕论证与回归锚互证）。isHydrating 删净（12 命中全注释）；latch 职责迁 applyingRemote 模块级（R17 双门保留）。VIEWER：硬门三路径+wrapper 10+1 处（setFileResult AI 落地含）+ESLint C 条豁免收窄（四 ConfigPanel 删条目+负例 31 绿）。redirect 17→**19 条矩阵**（评审补 /videos 真实路由）。**用户可见变更登记**：register 无 next 登录后默认 /canvas→/works（spec"无参→/works"既定语义）。Info 登记不修：wsAuthNotice.reason 暂宽 string（批 3 五档收紧）。web 全量 3047（theme-perf 超时系环境 flaky——热机 stash 基线复现+隔离跑恒绿，登记观察）+verify 绿。 |
| 3 | **完成**（评审进行中） | 01171e4c/b56deac4/072d40ec/518d4416 | **批尾备注（2026-09-30）**：4 任务全 TDD 落地+verify 绿（api 1462/web 3060）。**.reason 直达链源码钉死**（hocuspocus-server esm:939 writePermissionDenied(error.reason)——A1 维持）；真协议 DENY{reason} 透传+socket 不关用例在案。**B6 现场清单 13 实例**：已有钩子 3+本次收口 10（8 工厂→createManagedRedis 统一 REDIS_CLIENT 常量+auth.service 硬编码拔除+auth.ts 顶层单例受管化）。touch 四处统一（含 execution.gateway 顺统一——鉴权读面续期语义一致；过期→null 零写禁复活）。**sweep 灰度锚钉死**（关=零查询零通知零关闭）；复验含移除成员也踢；fail-open 5 次上限。**裁定登记**：①persist-status 退避梯 1s/2s/5s/15s/30s（spec 定值——任务文字 15m/30m 系笔误）②doc epoch 落服务端 WeakMap 非 meta（不持久化伪红重放判据+持久化破零写放大双重排除）③COMPACT_THRESHOLD(32 行)→COMPACT_INTERVAL_MS(≥60s 时间门限)——主 spec 绿5/5b/6/10 契约更新④me 探活对有效 session 重发 cookie（F8 cookie 滑动续期必要半边）⑤theme-perf 预算 15s→30s（满载实测 14.3s 贴线+干净树取证）。遗留：repo.count() 无调用方（API 保留）；apiFetch 401 电平未甄别登录失败（横幅消费批 2 域）。 |
| 4a | 完成 | 62b5d314 | 读归一/不变量/quiescence（依据 4b 行备注引用） |
| 门 C（F5） | **完成** | spike 报告回写（本行） | 意图漏斗可行性：**可行，裁漏斗**。成本比 **1.75:1**（17.5 vs ~10 人日）——判据③单看超 1.5 带宽，但①六+1 action 全覆盖（envelope 变更需第 7 个 updateNodeEnvelope ~15 行；复合=intent 序列单 transact）②VIEWER 硬门**更优**（拦截点从 bindBridge 订阅层前移到 dispatch 入口——回弹结构性消失）+架构权重条款（成本接近必倾向漏斗）+diff 引擎自认非终局需 ADR 弃用计划+全生命周期维护反超——综合裁漏斗。**关键发现**：最小迁移=store action 内换芯（setState→dispatch intent），UI 调用点/ESLint 门零改动（写点实底=51 store action，UI 消费 24 文件；syncStoreToDoc 生产调用仅 3 处全在 runtime）。**baseline 存续条款兑现**：裁漏斗⇒prevNodeIds/prevEdgeIds/leafDiff/对账/latch 四件套+0b baseline 随 bindBridge 删除——删除语义由 deleteNode/deleteEdge intent 显式携带（committed intent 即删除答案），initCollab 基线播种同删。Spike 文件未 commit（留工作区参考）。**批 4b 分两批落地**（首批六+1 action+高频写点 ≈7 人日，bindBridge 过渡兜底）。 |
| 4b | **完成**（漏斗分支） | 91819cf0/b7aa31f0 | **批尾备注（2026-09-30）**：**走漏斗**（门 C 裁决）。组1 七 action（+updateNodeEnvelope 第 7 个）+dispatch 入口（canEdit 前置=doc+store 双零写——判据②前移）+首批换芯；组2 全量换芯（51 store action——复合写点差分换芯 captureStoreProjection/dispatchProjectionDiff 单 transact）+**四件套退役**（syncStoreToDoc/bindBridge 写半边/applyingRemote latch/prevNodeIds baseline——R17 新防线三层：结构无翻译路径+teardown doc 生命周期+epoch）+lint-gate 第四条 no-delete-scan 静态断言。**伴生修复**：①组1 抓真 bug——dispatch 前置投影 filter 破坏级联删除判型（已修+rw 回归锚）②组2 不变量序敏感误报（子先建组后建插入序 vs 渲染序——按 id 排序内容等价）。批 4a 不变量/quiescence 单路径终态绿。评审 ✅（4 Minor：M1 addNode no-op 守卫/M2 applyRecordToYMap 残留导出——顺手修；M3 红1b④ 由机制消失间接覆盖——登记）。**批 4a**（62b5d314）：读归一单源 normalizeCanvasRecord+真不变量（变异实验非恒真）+**S1 组几何=第二个设计内分叉源发现**（双重归一扩展）+quiescence 无乒乓+getMap 门三文件复核通过；评审 ✅（1 Minor 注释措辞）。web 3116 绿+verify 绿。 |
| 门 D（E1/E2） | **完成** | 结论回写（本行） | E1：**可**——execute 节点唯一来源 readCanvas doc nodes（getScope 过滤后 doc 外节点静默空跑假成功），但批 5 落点 B=retake 直连**真实节点**（天然在 doc）零改造可跑；shadow- 白名单 hack（:107）仅放行已在 doc 的影子——现状影子本就先 insertNode。**批 5 附带清理清单**（非 gating）：shadow- 白名单/is-executable-node __ephemeral 排除/collab.gateway SHADOW_TTL_MS 影子 GC 三处死代码（均有行内注释预告）。E2：**成立**——sv=null（controller :44 ?? null→processor :29 undefined）跳过 SV 等待直读服务端当前 doc 全量（collab-document :38 `if (sv && ...)` 旁路+spec"无 sv 直接读"用例佐证）；影子由服务端 insertNode 写同一 doc 必可见；直连真实节点更无牵连。唯一语义损失：sv=null 放弃"等客户端最新编辑同步"——参数新鲜度靠 WS 常规同步+intent 幂等兜底，无新增风险。**门 D 通过，批 5 按落点 B 开工**。 |
| 5 | **完成**（评审后台中） | e4d310dc/bf028a17 | **批尾备注（2026-09-30）**：落点 B 兑现——**信箱整体消失**（R19 接触面/回流守卫/孤儿 GC/容器化四项 spec 预言的伴生成本全部随行删除）。**retakeId=intentId 幂等透传**（同 id 重放 claim ⑤ SUCCEEDED 零外呼零扣费；DTO 必填——服务端兜底=重放无幂等）；sv 位恒 undefined（E2 根因消失锚）；返回 {retakeId, result}（mediaId 异步不可靠——Media 由 execute/ai-download 既有链落真实节点）。**接触面删除**：api 17 文件（shadowJob 段/insertNode/removeNode/白名单 hack/__ephemeral/SHADOW_TTL GC/remove-shadow 端点/dropIdPrefixes）+web（shadowJob.ts 整删/PreviewPlayer 改 exec 投影真实源节点/readNodeFileIdFromDoc 孤儿删/isShadowOnlyEvents/ydocBuilder:56/editorStore shadowJobs 三 action+生成结果区——产物回归真实节点 Media+素材库）。**静态断言**：web lint-gate 第五条 no-shadow-literal（AST 双形态+接线锚防假绿）+api AST 扫描 spec（自测负例）；dev 巡检 /^shadow-/ 抛。**TRUNCATE "CanvasDoc","CanvasDocUpdate"**（表名 pg 实证纠正；0/0 终态+commit 注记）。**socket.io 退役评估结论（批1 末前移已完成）**：保留+冻结分两步——已死 1（execution:complete）+活 23（node:status 17 主路径 dual-write/trim 6 唯一通道轮询兜底）；本批冻结确认零新增载荷（消费者 4→3 系 shadowJob 删除）；trim/separate/stitch 补 6 写点后切 doc；包级移除被 /payment gateway 阻塞另立评估——评估文档 socketio-retirement-assessment.md。双侧 3113/1464 绿+verify exit 0。 |
| 6 | **完成** | 98186490 | **批尾备注（2026-09-30）**：红2f″ 八场景矩阵全落（其中 3 条即绿=既有实现无缺口的防回归锚；**装置假绿自纠**：409/耗尽用例最初把 edit 写在 useFakeTimers 前——防抖入真实时钟永不触发形成无效装置，被"正常保存后"哨兵用例捕获并根因修正）；handleClose 三选 ConfirmModal（重试=retry 补发+退避重置再 flush；放弃=显式清 editorDirty+release+close；取消留编辑器）+原 toast 出口删除；hasPendingWork 五分量导出（inFlight 隔离红锚）；无 ctrl 路径 release 缺口补齐；recoverConnection 不清 editorDirty 结构性锚。评审 ✅（2 Minor：几何路径以结构性锚代表/重试循环重弹系用户驱动）。sticky activation 平台残留注记。web 3131 绿。 |
| 7 | **完成** | 见 feat(collab) 批7 commit | **批尾备注（2026-10-01）**：gate 9/9 全绿（`node scripts/gate-collab.mjs`，GATE_EXIT=0，全套 ~4min）+api 1470/web 3131 绿。形态=gate 脚本自拉 API（node dist/main 单进程+HTTP 控制面 :3100 kill/start——playwright webServer 杀不掉）+双 context（collab-a/collab-b seed 账号）+COLLAB_FAKE_AI=1/COLLAB_SWEEP_ENABLED=true；CI=ci.yml e2e-collab 独立 job（nightly 19:17 UTC+workflow_dispatch，PR 不跑；test job 加 event_name 门）；手动清单 collab-e2e-gate-checklist.md。**落地挖出 4 个真实缺陷**：①已修——批3-3 给 AuthGuard 加 SessionService 后 media/recharge/storage 冗余类级 @UseGuards 启动即炸（单测全 mock 从未暴露，gate 首跑即抓；修复=删三处冗余注册）；②登记——UI 分辨率词表(1K/2K/4K)与 pricingRule.resolutionId 脱节，面板补写默认 resolution 后执行被"无有效定价规则"**静默拦截**（gate seed 词表规则兜底，产品级映射另立）；③登记——exec map 按 nodeId 键控无 intentId 维度，同节点二次生成 loading 被终态防倒退吞掉（3b 以新节点绕行）；④注记——enqueue 必带 intentId（stalled 可重入 claim 依赖），脚本直调不带则 NodeBusy 静默。**机制锚**：sweep 快照死线在 authenticate 定格——S4 用连前置 now+10s（sweep 单测 mock context 形态真链路不可达，S4 是首个真实回归锚）；S3 3b 走队列 stalled 重排 ≤150s 恢复（同 jobId 可重入 claim 实证）。调试入口 COLLAB_E2E_GREP 单用例快跑。 |

---

## 决策门 A（F11）：健康判据载体夹具裁决（先于批 0a，~1h）

**裁决问题**：healthy 合取的"每 attempt 入站确认项"载体取哪个——
- 候选 1（spec 原文）：`inboundAttemptId === attemptId`（'message' 事件驱动、消息处理后写 inboundAttemptId）
- 候选 2（B5）：`ws.connectionAttempt === null`（resolveConnectionAttempt、消息处理**前**清空——公开字段，d.ts:261）

**判据（A4 修正后的签名）**：黑洞/4408 形态下 `status==='connected' && connectionAttempt!==null`；healthy 不得在新握手**首帧**早宣（D.3 必红的裁决载体）。

**Task A-1：载体裁决夹具（真协议，丢弃式——不进生产代码）**

**Files:**
- Create: `apps/api/src/modules/collab/health-carrier.gate.spec.ts`（@Gate 注记，结论落 plan 后**保留**为契约锁夹具——它就是"kick 后只建一个 socket"红测的宿主）

- **Step 1: 读夹具先例**——通读 `apps/api/src/modules/collab/collab.gateway.spec.ts`（R12：随机端口真 Server + 真 provider + mock Prisma 的搭法），照抄其建 Server/provider 手法。

- **Step 2: 写夹具**（先写断言占位——本夹具的"断言"是**记录事件序**，跑完人工判定后固化断言）：

```ts
// apps/api/src/modules/collab/health-carrier.gate.spec.ts
// 决策门 A（F11）：裁定 healthy 合取的入站确认项载体。结论回写 master plan 完成记录表。
import { describe, it, expect } from 'vitest';
import { Server } from '@hocuspocus/server';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { vi } from 'vitest';

function freePort(): Promise<number> {
  return new Promise((r) => {
    const n = require('net').createServer();
    n.listen(0, () => { const p = (n.address() as any).port; n.close(() => r(p)); });
  });
}

describe('F11 健康判据载体裁决夹具', () => {
  it('4408 形态：记录 status/message/authenticated/synced 事件序与 connectionAttempt 取值', async () => {
    const port = await freePort();
    const server = new Server({ port, async onAuthenticate() { return {}; } });
    await server.listen();
    const log: string[] = [];
    const doc = new (require('yjs').Doc)();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${port}`,
      name: 'gate:carrier',
      document: doc,
      token: 'gate',
    });
    const ws: any = (provider as any).configuration.websocketProvider;
    provider.on('status', (e: any) => {
      log.push(`status:${e.status} wsStatus=${ws?.status} connAttempt=${JSON.stringify(ws?.connectionAttempt)}`);
    });
    provider.on('message', () => {
      log.push(`message connAttempt=${JSON.stringify(ws?.connectionAttempt)}`);
    });
    provider.on('authenticated', () => log.push(`authenticated connAttempt=${JSON.stringify(ws?.connectionAttempt)}`));
    provider.on('synced', () => log.push(`synced connAttempt=${JSON.stringify(ws?.connectionAttempt)}`));

    await new Promise<void>((r) => provider.on('synced', r));
    log.push('--- KICK 4408 ---');
    // 合成 4408（v5.3 瞬态原语同款——公开方法）
    (provider as any).onClose?.();
    ws.onClose({ event: { code: 4408, reason: 'gate-kick' } });
    // kick 后同同步栈无条件 connect（㉝ 处方）
    void ws.connect();
    // 等待重连完成（第二个 synced 或 10s）
    let secondSynced = false;
    provider.on('synced', () => { secondSynced = true; });
    await new Promise<void>((r) => setTimeout(r, 10000));

    console.log(log.join('\n'));
    // 裁决断言（占位——跑完按实际事件序固化）：
    // 1) 第二次 status:connected 时 connectionAttempt 是否已为 null？
    // 2) provider.onClose 后 provider.isSynced 是否陈旧 true（L13）？
    // 3) kick 后新 socket 是否只建了一个（ws.connect 调用后无第二连接）？
    expect(secondSynced).toBe(true);
    provider.destroy(); await server.destroy();
  }, 30000);
});
```

- **Step 3: 跑夹具并记录**

Run: `pnpm --filter @flowweb/api test -- --run health-carrier.gate`
Expected: 输出完整事件序日志。**人工判定三件事并写入完成记录表**：
1. `ws.connectionAttempt` 在双发第二次 status:connected 时是否已为 null（是⇒候选 2 可用作"无在飞 attempt"判据）；
2. `'message'` 事件与第二次 status:connected 的先后（候选 1 的 inboundAttemptId 在 message 时才写——若 connected 先于本 attempt 首个 message，则 healthy 合取在 connected 重算时短暂为假=防早宣成立）；
3. kick 后 socket 只建一个（㉝ 同栈锚——此断言固化常驻）。

- **Step 4: 固化裁决**——按结论在批 0a Task 0a-1 的 `recomputeConnStatus` 里二选一（两版代码都在该任务中给出），并把夹具中的占位断言改为实测事件序断言。Commit：

```bash
git add apps/api/src/modules/collab/health-carrier.gate.spec.ts
git commit -m "test(collab): F11 载体裁决夹具（决策门 A）——事件序实测+同栈单 socket 锚固化"
```

---

## 批 0c：安全止血（先于一切——标称半天，校准口径 1.5~2 天）

**Files:**
- Modify: `apps/api/src/modules/ai-image-edit/ai-image-edit.controller.ts`（三端点守卫）
- Modify: `apps/api/src/modules/ai-image-edit/ai-image-edit.processor.ts`（consume 检查+getMediaKey 归属）
- Modify: `apps/api/src/modules/ai-image-edit/ai-image-edit.module.ts`（attempts:1 + TeamModule 确认）
- Modify: `apps/api/src/modules/ai-image-edit/lighting/lighting.controller.ts:16`（无条件守卫）
- Modify: `apps/api/src/modules/ai-image-edit/lighting/lighting.consumer.ts:175`（consume 检查）
- Modify: `apps/api/src/modules/ai-image-edit/lighting/dto/create-lighting-task.dto.ts`（projectId 必填）
- Modify: `apps/api/src/modules/gateway/execution.gateway.ts`（cors+handleJoin 鉴权）
- Modify: `apps/api/src/modules/execution/execution.controller.ts:47-53`（jobs/:id 归属）
- Modify: `apps/api/src/modules/execution/execution.service.ts`（oracle 重排 + F4 产物序）
- Modify: `apps/api/src/modules/execution/execution.module.ts:33-36`（attempts:1）
- Modify: `apps/api/src/app.module.ts:55`（ThrottlerGuard）
- Create: `apps/api/src/modules/execution/execution.queue-options.ts`
- Test（Create）: `apps/api/src/modules/ai-image-edit/ai-image-edit.controller.spec.ts`、`apps/api/src/modules/ai-image-edit/ai-image-edit.processor.spec.ts`、`apps/api/src/modules/execution/execution.security.spec.ts`、`apps/api/src/modules/gateway/execution.gateway.spec.ts`、`apps/api/src/modules/execution/execution.queue-options.spec.ts`

**Task 0c-1：ai-image-edit 三端点 perm.assertEditor**

- **Step 1: 写失败测试**

```ts
// apps/api/src/modules/ai-image-edit/ai-image-edit.controller.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiImageEditController } from './ai-image-edit.controller';
import { ProjectPermissionService } from '../team/project-permission.service';

describe('AiImageEditController 安全止血（spec 批0c 判据①：非成员 403 且外部 provider 零调用）', () => {
  let service: any; let perm: any; let ctrl: AiImageEditController;
  const body = { projectId: 'p1', nodeId: 'n1', fileId: 'f1', rect: { x: 0, y: 0, width: 10, height: 10 }, imageWidth: 10, imageHeight: 10 };

  beforeEach(() => {
    service = { enqueueOutpaint: vi.fn(), enqueueErase: vi.fn(), enqueueRedraw: vi.fn() };
    perm = { assertEditor: vi.fn() };
    ctrl = new AiImageEditController(service, perm as ProjectPermissionService);
  });

  it('outpaint：assertEditor 拒绝时 service 不被调用（越权扣费面）', async () => {
    perm.assertEditor.mockRejectedValue(new Error('forbidden'));
    await expect(ctrl.outpaint(body as any, { user: { id: 'u1' } } as any)).rejects.toThrow('forbidden');
    expect(perm.assertEditor).toHaveBeenCalledWith('p1', 'u1');
    expect(service.enqueueOutpaint).not.toHaveBeenCalled();
  });

  it('erase/redraw 同守卫', async () => {
    perm.assertEditor.mockRejectedValue(new Error('forbidden'));
    await expect(ctrl.erase({ projectId: 'p1', nodeId: 'n1', fileId: 'f1', maskFileId: 'm1' } as any, { user: { id: 'u1' } } as any)).rejects.toThrow();
    await expect(ctrl.redraw({ projectId: 'p1', nodeId: 'n1', fileId: 'f1', maskFileId: 'm1', prompt: 'x', strength: 0.5 } as any, { user: { id: 'u1' } } as any)).rejects.toThrow();
    expect(service.enqueueErase).not.toHaveBeenCalled();
    expect(service.enqueueRedraw).not.toHaveBeenCalled();
  });
});
```

- **Step 2: 跑红**——Run: `pnpm --filter @flowweb/api test -- --run ai-image-edit.controller.spec`，Expected: FAIL（controller 构造器现只收 1 参 / assertEditor 未被调）。

- **Step 3: 实现**——controller 注入 `ProjectPermissionService`（复用 lighting.controller.ts:10 同款 import：`../team/project-permission.service`），三端点首行加：

```ts
await this.perm.assertEditor(body.projectId, req.user.id);
```

构造器：

```ts
constructor(
  @Inject(AiImageEditService) private readonly service: AiImageEditService,
  @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
) {}
```

- **Step 4: 跑绿** + Step 5: Commit `fix(collab): 批0c-1 ai-image-edit 三端点补 assertEditor（越权扣费止血）`

**Task 0c-2：processor consume 返回值检查（免费算力）+ getMediaKey 归属**

- **Step 1: 写失败测试**

```ts
// apps/api/src/modules/ai-image-edit/ai-image-edit.processor.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiImageEditProcessor } from './ai-image-edit.processor';

/** 最小驱动装置：只验证扣费失败分支的副作用序（consume 失败⇒不写产物⇒failed）。
 *  复杂外部依赖（axios/minio/apiCaller）全 mock；走 outpaint 分支。 */
function makeProcessor(consumeResult: { success: boolean; reason?: string }) {
  const prisma = {
    media: { findUnique: vi.fn().mockResolvedValue({ id: 'f1', key: 'k', userId: 'u1', projectId: 'p1' }) },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
    mediaCreate: vi.fn(),
  };
  prisma.media.create = prisma.mediaCreate;
  const minio = {
    generatePresignedGetUrl: vi.fn().mockResolvedValue('http://img'),
    buildKey: vi.fn().mockReturnValue('key'),
    upload: vi.fn(),
  };
  const apiCaller = { callOutpainting: vi.fn().mockResolvedValue({ url: 'http://result' }), configureRetry: vi.fn() };
  const teamCredit = { consume: vi.fn().mockResolvedValue(consumeResult) };
  const collabDoc = { writeNodeData: vi.fn() };
  const gateway = { emitNodeStatus: vi.fn() };
  const processor: any = new (AiImageEditProcessor as any)(prisma, minio, apiCaller, teamCredit, collabDoc, gateway, { log: vi.fn(), error: vi.fn() });
  return { processor, teamCredit, collabDoc, gateway };
}

describe('AiImageEditProcessor 扣费守卫（spec 批0c：consume 失败→不写产物+job failed）', () => {
  it('consume 失败（余额不足）→ writeNodeData 零调用 + emitNodeStatus edit-failed + 返回 failed', async () => {
    const { processor, collabDoc } = makeProcessor({ success: false, reason: 'INSUFFICIENT_CREDITS' });
    const r = await processor.process({ data: { taskType: 'outpaint', userId: 'u1', projectId: 'p1', nodeId: 'n1', fileId: 'f1', rect: { x: 0, y: 0, width: 1, height: 1 }, imageWidth: 1, imageHeight: 1 } } as any);
    expect(r.status).toBe('failed');
    expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
  });
});
```

注：Processor 构造器参数序以实际文件为准（Step 1 前先读 `ai-image-edit.processor.ts:1-60` 对照并修正装置的注入顺序——mock 顺序错了就照实际构造器调整，断言不变）。

- **Step 2: 跑红**（现状 :152 丢弃返回值⇒走 completed+writeNodeData）。
- **Step 3: 实现**——`ai-image-edit.processor.ts` :152 改：

```ts
// 7. Deduct credit (team pool)——返回值必须检查（批0c：免费算力止血）
const consumeResult = await this.teamCredit.consume(projectTeamId, userId, CREDIT_COST_PER_EDIT, `edit:${nodeId}`);
if (!consumeResult.success) {
  this.logger.warn(`Edit credit-consume failed for node ${nodeId}: ${consumeResult.reason ?? 'unknown'}`);
  this.gateway.emitNodeStatus(projectId, { nodeId, status: 'edit-failed', error: `扣费失败：${consumeResult.reason ?? ''}` });
  return { status: 'failed', reason: consumeResult.reason ?? 'CREDIT_CONSUME_FAILED' };
}
```

同文件 `getMediaKey`（:63-69）补归属：

```ts
private async getMediaKey(fileId: string, userId: string, projectId: string): Promise<string> {
  const media = await this.prisma.media.findUnique({ where: { id: fileId } });
  if (!media || (media.userId !== userId && media.projectId !== projectId)) {
    throw new Error(`Media not found: ${fileId}`); // 404 语义——不泄露存在性
  }
  return media.key;
}
```

（调用点 :79/:84 同步传 `userId, projectId`。）

- **Step 4: 跑绿** + Step 5: Commit `fix(collab): 批0c-2 ai-image-edit consume 检查+getMediaKey 归属（免费算力/越权产物双堵）`

**Task 0c-3：lighting 无条件守卫 + consumer consume 检查 + originalImageUrl 越权面根修**

- **Step 1: 写失败测试**（新建 `lighting.controller.spec.ts`：省略 projectId 的请求也必须触发 assertEditor→抛错；`lighting.consumer.spec.ts`：consume 失败→task failed+writeNodeData 零调用——手法与 0c-2 装置同构，从 lighting.consumer.ts 实际构造器照抄注入顺序）。
- **Step 2: 跑红**。
- **Step 3: 实现**——lighting.controller.ts:16 删条件式：

```ts
await this.perm.assertEditor(body.projectId, userId); // 无条件（批0c：省略 projectId 即旁路）
```

DTO `create-lighting-task.dto.ts` 的 projectId 改必填（`@IsNotEmpty()`/必填校验——按仓内 class-validator 风格）。lighting.consumer.ts:175 同 0c-3 手法检查返回值，失败→`lightingTask.update status=FAILED`+return `{status:'failed', reason}`，不走 :180 writeNodeData。
**B1 根修（第九轮评估）**：DTO 的 `originalImageUrl: string`（presigned URL 直传，consumer :112 对任意路径截取重签=任意 media 越权读）**改 `originalImageId: string`**（mediaId 引用）——consumer 内走 getMediaKey 归属校验后自签 presigned；web 调用点（grep `lighting/tasks`）同步改传 mediaId（dev 阶段无兼容包袱，正该这么干——不加 URL 归属校验层）。
**预检口径对齐（顺手）**：lighting.service.ts:100 `estimatedCost = 15`（TODO 自证未接定价）与实扣 `CREDIT_COST_PER_EDIT = 1`（ai-image-edit.constants.ts:3）不一致——余额 1~14 的团队被误拦；改引用同一常量（真正接定价随批 0.5 paramsHash 白名单一起做，本批先消口径分叉）。
- **Step 4: 跑绿** + Step 5: Commit `fix(collab): 批0c-3 lighting 守卫无条件化+consumer 扣费检查+originalImageId 根修`

**Task 0c-4：F4 execution text/video 产物序（免费产品洞）**

- **Step 1: 写失败测试**

```ts
// apps/api/src/modules/execution/execution.security.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionService } from './execution.service';

/** F4 必红：consume 失败后 doc 不得含本次新产物（text/video 今天违反——:96-99/:138 先写产物后扣费）。
 *  装置只驱动 execute 的 text/video 两分支；依赖全 mock。 */
function makeService(consumeOk: boolean) {
  const prisma = {
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ id: 'p1', teamId: 't1' }) },
    pricingRule: { findFirst: vi.fn().mockResolvedValue({ creditCost: 1 }) },
  };
  const topology = { collectUpstreamData: vi.fn().mockReturnValue({ textContents: ['hi'], imageUrl: null }) };
  const apiCaller = {
    callTextGen: vi.fn().mockResolvedValue({ content: 'AI结果' }),
    callVideoGen: vi.fn().mockResolvedValue({ url: 'http://v' }),
    callImageGen: vi.fn(),
  };
  const teamCredit = {
    consume: vi.fn().mockResolvedValue(consumeOk ? { success: true } : { success: false, reason: 'INSUFFICIENT_CREDITS' }),
    getBalanceView: vi.fn().mockResolvedValue({ credits: 1 }),
  };
  const collabDoc = { readCanvas: vi.fn().mockResolvedValue({ nodes: [], edges: [] }), writeNodeData: vi.fn() };
  const gateway = { emitNodeStatus: vi.fn() };
  const svc: any = new (ExecutionService as any)(prisma, topology, apiCaller, teamCredit, collabDoc, gateway, { log: vi.fn() }, { findFirst: prisma.pricingRule.findFirst });
  return { svc, collabDoc, teamCredit };
}
```

（构造器参数序以 `execution.service.ts:1-40` 实际为准校正——断言不变。）

```ts
describe('F4 产物序（spec v5.10：看到产物 ⇒ 已扣费）', () => {
  it('text：consume 失败 → writeNodeData 零调用（今天 :96-99 先写——必红）', async () => {
    const { svc, collabDoc } = makeService(false);
    const r = await svc.execute('p1', 'n1', 'u1');
    expect(r.success).toBe(false);
    expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
  });

  it('video：consume 失败 → writeNodeData 零调用（今天 :138 先写——必红）', async () => {
    const { svc, collabDoc } = makeService(false);
    // 拓扑返回 videoGen 节点：见 Step 1b
  });

  it('text：consume 成功 → writeNodeData 正常写（回归锚）', async () => {
    const { svc, collabDoc } = makeService(true);
    await svc.execute('p1', 'n1', 'u1');
    expect(collabDoc.writeNodeData).toHaveBeenCalled();
  });
});
```

Step 1b：装置里 readCanvas 返回的 nodes 决定走哪条分支——text 用例返回 `[{ id: 'n1', type: 'textInput', data: { model: 'seed-model-kimi' } }]`；video 用例返回 `[{ id: 'n1', type: 'videoGen', data: { model: 'v1' } }]`（validation/isExecutableNode 的放行以实际实现 mock 掉——`validationService` 若独立注入则 mock 其通过）。

- **Step 2: 跑红**（text/video 两用例今天必失败）。
- **Step 3: 实现**——`execution.service.ts` 把 text 的 `writeNodeData({content,result})`（:96-99）移到 consume 成功之后（即 `totalDeducted += cost;` 后、`getBalanceView` 前）；video 的 `writeNodeData({videoUrl})`（:138）同样移到 `vDeduct` 成功后。**不变量注释写进代码**：`// 看到产物 ⇒ 已扣费（F4：text/video 曾先写产物后扣费=免费产品洞）`。image 路径（:212 已正确）不动。
- **Step 4: 跑绿**（三用例全过）+ Step 5: Commit `fix(collab): 批0c-4 F4 产物序统一"扣费成功才写产物"（text/video 免费产品洞）`

**Task 0c-5：execution.gateway cors 收口 + handleJoin 鉴权 + jobs/:id 归属**

- **Step 1: 写失败测试**（`execution.gateway.spec.ts`：handleJoin 传伪造 cookie→session 查无→不 join 且 client 被断开；合法 session+成员→join。`execution.security.spec.ts` 增补：jobs/:id 的 job.data.projectId 非本人项目→404。装置：gateway 直构（注入 mock PrismaService），client 用 `{ join: vi.fn(), leave: vi.fn(), handshake: { headers: { cookie } } }`。）

```ts
// execution.gateway.spec.ts 核心断言
it('handleJoin：无有效 session → 拒绝 join', async () => {
  const prisma = { session: { findUnique: vi.fn().mockResolvedValue(null) } };
  const gw: any = new (ExecutionGateway as any)(prisma);
  const client: any = { join: vi.fn(), leave: vi.fn(), handshake: { headers: { cookie: 'flowweb.session_token=bad' } } };
  await gw.handleJoin(client, 'p1');
  expect(client.join).not.toHaveBeenCalled();
});
```

- **Step 2: 跑红**。
- **Step 3: 实现**——`execution.gateway.ts`：

```ts
@WebSocketGateway({ namespace: '/execution', cors: { origin: process.env.WEB_ORIGIN?.split(',') ?? ['http://localhost:5173'] } })
export class ExecutionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 鉴权：镜像 collab.gateway.authenticate 的 session 直查（cookie 名 flowweb.session_token）。
   *  只校验团队成员身份（读面——VIEWER 也应可见状态）；批5 socket.io 退役评估后本通道可能整体消失。 */
  private async authorize(client: Socket, projectId: string): Promise<boolean> {
    const token = (client.handshake.headers?.cookie || '').match(/flowweb\.session_token=([^;]+)/)?.[1];
    if (!token) return false;
    const session = await this.prisma.session.findUnique({ where: { token }, include: { user: true } });
    if (!session || session.expiresAt < new Date()) return false;
    const project = await this.prisma.canvasProject.findUnique({ where: { id: projectId }, select: { teamId: true } });
    if (!project) return false;
    const member = await this.prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: project.teamId, userId: session.user.id } } });
    return !!member;
  }

  @SubscribeMessage('join')
  async handleJoin(client: Socket, projectId: string) {
    if (!(await this.authorize(client, projectId))) {
      client.emit('join:error', 'unauthorized');
      return;
    }
    client.join(`project:${projectId}`);
  }
}
```

（`execution.module.ts` providers 已含 ExecutionGateway——注入 PrismaService 无需额外 import，PrismaModule 全局。）

`execution.controller.ts:47-53` jobs/:id 补归属（**default-deny + 成员级**——读面 VIEWER 也应可见，非 editor 独占；jobProjectId 缺失不得放行）：

```ts
@Get('jobs/:id')
async getJob(@Param('id') id: string, @Req() req: Request) {
  const job = await this.executionQueue.getJob(id);
  const jobProjectId = (job?.data as any)?.projectId as string | undefined;
  if (!job || !jobProjectId) return { error: 'Job not found' }; // default-deny——无归属信息即 404（fail-closed，不枚举 state/progress）
  const role = await this.perm.resolve(jobProjectId, (req as any).user?.id);
  if (!role) return { error: 'Job not found' };                  // 非成员 404（不泄露存在性）
  const state = await job.getState();
  return { id: job.id, state, progress: job.progress };
}
```

- **Step 4: 跑绿** + Step 5: Commit `fix(collab): 批0c-5 execution gateway 鉴权收口（cors/handleJoin/jobs 归属）`

**Task 0c-6：存在性 oracle 重排（assertEditor 早于 findUnique）**

- **Step 1: 读 `execution.service.ts:30-60`**，确认现状反序（findUnique 先于 assertEditor）。
- **Step 2: 测试**——`execution.security.spec.ts` 增补：`perm.assertEditor` mock 抛错时，`prisma.canvasProject.findUnique` 零调用（重排锚）。装置的 makeService 增加 `perm` 注入。
- **Step 3: 实现**——execute() 入口段重排为 `assertEditor(projectId, userId)` 最先（assertEditor 自带存在性判定——非成员枚举 projectId 无法区分"不存在"vs"无权"）。
- **Step 4: 跑绿** + Step 5: Commit `fix(collab): 批0c-6 存在性 oracle 重排（assertEditor 先于 findUnique）`

**Task 0c-7：队列 attempts:1（两队列）**

- **Step 1: 写失败测试**

```ts
// apps/api/src/modules/execution/execution.queue-options.spec.ts
import { describe, it, expect } from 'vitest';
import { EXECUTION_JOB_OPTIONS } from './execution.queue-options';
import { AI_IMAGE_EDIT_JOB_OPTIONS } from '../ai-image-edit/ai-image-edit.queue-options';

describe('队列重试配置（批0c：全局 attempts:3 继承链=重试重复扣费）', () => {
  it('execution 与 ai-image-edit 两队列 attempts===1', () => {
    expect(EXECUTION_JOB_OPTIONS.attempts).toBe(1);
    expect(AI_IMAGE_EDIT_JOB_OPTIONS.attempts).toBe(1);
  });
});
```

- **Step 2: 跑红**（两文件不存在）。
- **Step 3: 实现**——新建 `execution.queue-options.ts`：

```ts
/** 批0c：付费任务队列禁自动重试（全局 defaultJobOptions attempts:3 继承链下 processor 内扣费后抛错
 *  会自动重试再扣——重复扣费今天就在发生）。语义：部署杀在飞任务的恢复出口=用户显式重跑（意图表幂等保证只扣一次）。 */
export const EXECUTION_JOB_OPTIONS = { attempts: 1 } as const;
```

`ai-image-edit.queue-options.ts` 同款（`AI_IMAGE_EDIT_JOB_OPTIONS`）。`execution.module.ts:33-36` 的 EXECUTION_QUEUE registerQueue 加 `defaultJobOptions: { ...EXECUTION_JOB_OPTIONS }`；`ai-image-edit.module.ts:19` 的 registerQueue 同样加。**顺手（第九轮评估）**：`app.module.ts` BullModule.forRoot 的 connection 增 `maxRetriesPerRequest: null`（BullMQ 要求——Redis 抖动时阻塞式连接会抛错）。
- **Step 4: 跑绿** + Step 5: Commit `fix(collab): 批0c-7 付费队列 attempts:1（堵重试重复扣费）`

**Task 0c-8：ThrottlerGuard 挂载（B3 约束：首屏零 429）**

- **Step 1: 实现**——`app.module.ts:55` 抬全局上限 + 挂 guard：

```ts
ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]), // B3：现值 10/min 会打死画布首屏——全局抬至安全带宽，敏感端点显式收紧
```

providers 增（注册在 AdminGuard 后）：

```ts
{ provide: APP_GUARD, useClass: ThrottlerGuard },
```

敏感端点显式收紧（各自 controller 顶部装饰器）：

```ts
import { Throttle } from '@nestjs/throttler';
// AiImageEditController 类级：@Throttle({ default: { limit: 20, ttl: 60000 } })
// LightingController.createTask、ExecutionController.execute/enqueue、auth 登录端点：同上 20/min
```

- **Step 2: 验证**——`pnpm --filter @flowweb/api test -- --run`（既有套件零 429 类破坏）+ 手动起 API 打开画布首屏（dev 双击 D 之外的最小验证——`GET /api/projects` 序列无 429，network 面板确认）。**两个部署前提注记（第九轮评估，写进代码注释）**：①APP_GUARD 会触达 socket.io WS context（AdminGuard 注释自证）——throttler 在 WS 上的 IP 解析行为未验证，ExecutionGateway 类级加 `@SkipThrottle()` 豁免；②反代（nginx）后 `req.ip` 全是代理 IP——300/min 会变成全站共享单桶，生产部署前需 `app.set('trust proxy', 1)` 或 throttler 自定义 tracker（登记 tech-debt）。
- **Step 3: Commit** `feat(collab): 批0c-8 ThrottlerGuard 挂载（全局 300/min+敏感端点 20/min，首屏零 429）`

**显式跳过登记**：spec 0c 行原列"shadow- 白名单改内部参数 allowEphemeral"——**本 plan 跳过**（v5.10 后裁决：批 5 删信箱时该机制随行消失，中间改参数是纯浪费；spec 切批表已加跳过注记）。

**Task 0c-9：批尾收尾**

- **Step 1**: `pnpm --filter @flowweb/api test -- --run` 全绿 + `pnpm verify`。
- **Step 2**: 完成记录表填 0c 行。双客户端冒烟**挂到批 0a 尾**（其判据"杀 API→双端自动恢复"依赖 0a 的 connStatus 修复——执行顺序注记，spec 内容不变）。
- **Step 3**: Commit（若有收尾文件）。

---

## 批 0a：connStatus 派生 + 漏斗（今天止血）

**Files:**
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（recomputeConnStatus+代际制 / destroyCollab 实例守卫 / deletion baseline 与影子清理见批 0b）
- Modify: `apps/web/src/pages/canvas/page.tsx`（openSession 漏斗+resetSession+403/404 分义）
- Test（Create）: `apps/web/src/stores/canvasCollabRuntime.conn.spec.ts`
- Test（Modify）: `apps/web/src/pages/canvas/page.test.tsx`（新建画布组判据增补）

**Task 0a-1：recomputeConnStatus 唯一写点 + 代际制（缺陷 A 根修）**

- **Step 1: 写失败测试**

```ts
// apps/web/src/stores/canvasCollabRuntime.conn.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

/** mock 按 L16 锚：provider 无 status 字段；isAuthenticated/isSynced 公开布尔；
 *  事件序按 spec 红1（v5.8 ⑨：connected 双发第二次与 'message' 同同步栈）。 */
const instances: any[] = [];
vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: class extends EventEmitter {
    isAuthenticated = false;
    isSynced = false;
    configuration: any = {};
    constructor() { super(); instances.push(this); }
    async destroy() {}
  },
}));

const runtime = await import('./canvasCollabRuntime');
const { useCanvasStore } = await import('./canvasStore');

async function driveToSynced(p: any) {
  const done = runtime.initCollab('p1');
  p.emit('status', { status: 'connected' });   // L1 双发第一发（onOpen）
  p.emit('status', { status: 'connected' });   // 双发第二发（resolveConnectionAttempt）
  p.isAuthenticated = true;
  p.emit('authenticated', { scope: 'read-write' });
  p.isSynced = true;
  p.emit('synced');
  await done;
}

describe('红1：connStatus 派生（真实事件序）', () => {
  beforeEach(() => {
    instances.length = 0;
    vi.clearAllMocks();
    useCanvasStore.setState({ connStatus: 'connecting', syncFailed: false });
  });

  it('双发 connected 但未 authenticated → 保持 connecting', async () => {
    const p = instances[instances.length - 1];
    const done = runtime.initCollab('p1');
    p.emit('status', { status: 'connected' });
    p.emit('status', { status: 'connected' });
    expect(useCanvasStore.getState().connStatus).toBe('connecting');
    p.emit('synced');
    await done;
  });

  it('完整序（双发+authenticated+synced+message）→ connected（今天 :251 映射 connecting——必红）', async () => {
    const p = instances[instances.length - 1];
    await driveToSynced(p);
    p.emit('message', {});   // 本 attempt 首个入站——代际确认
    expect(useCanvasStore.getState().connStatus).toBe('connected');
  });

  it('代际防早宣：离开 connected 后新 attempt 首帧前不得早宣 connected', async () => {
    const p = instances[instances.length - 1];
    await driveToSynced(p);
    p.emit('message', {});
    expect(useCanvasStore.getState().connStatus).toBe('connected');
    // 断连（离开 connected → attemptId++）
    p.emit('status', { status: 'disconnected' });
    expect(['offline', 'connecting']).toContain(useCanvasStore.getState().connStatus);
    // 新 attempt：status 双发 + 布尔陈旧 true（4408 形态——close 事件不发，布尔不复位）但本 attempt 尚无 message
    p.emit('status', { status: 'connected' });
    p.emit('status', { status: 'connected' });
    p.emit('authenticated', { scope: 'read-write' });
    expect(useCanvasStore.getState().connStatus).not.toBe('connected'); // 防早宣锚
    p.emit('message', {});
    expect(useCanvasStore.getState().connStatus).toBe('connected');
  });
});
```

（若 vi.mock 时序导致 `instances` 取不到——用 `beforeEach` 里 `instances[instances.length-1] ?? (await runtime.initCollab('p1'), instances[instances.length-1])` 兜底；装置服务于断言。）

- **Step 2: 跑红**——Run: `pnpm --filter @flowweb/web test -- --run canvasCollabRuntime.conn.spec`，Expected: FAIL（现状 :249-253 把 connected 映射成 connecting）。

- **Step 3: 实现**——`canvasCollabRuntime.ts`：

模块级新增（`let currentPid` 声明旁）：

```ts
// 批0a：connStatus 派生（缺陷 A 根修）——唯一写点 recomputeConnStatus + 代际制。
// 载体按决策门 A 结论二选一（默认候选 1；若门 A 裁定候选 2，把 inboundAttemptId===attemptId
// 整项替换为 (provider.configuration.websocketProvider as any)?.connectionAttempt === null）。
// 纯派生纪律（第九轮评估）：代际跃迁（attemptId++/入站重置）是事件处理器的事——
// recomputeConnStatus 只读不写模块状态，"唯一写点=connStatus" 的声明才成立（多事件源调用无顺序敏感）。
let lastWsStatus: 'connecting' | 'connected' | 'disconnected' = 'connecting';
let attemptId = 0;
let inboundAttemptId = -1;

export function recomputeConnStatus() {
  const p = provider;
  const healthy = !!p
    && lastWsStatus === 'connected'
    && p.isAuthenticated === true
    && p.isSynced === true
    && inboundAttemptId === attemptId;
  const s = useCanvasStore.getState();
  const next = healthy ? 'connected' : (lastWsStatus === 'disconnected' ? 'offline' : 'connecting');
  if (next !== s.connStatus) useCanvasStore.setState({ connStatus: next });
}
```

initCollab 会话起点复位（`const seq = ++initSeq;` 旁）：

```ts
lastWsStatus = 'connecting';
attemptId = 0;
inboundAttemptId = -1;
```

事件接线（替换 :249-253 的 status 处理块；provider 创建后——**代际跃迁在此**）：

```ts
provider.on('status', ({ status }: any) => {
  if (status !== lastWsStatus && lastWsStatus === 'connected') attemptId++;        // 离开 connected——旧 attempt 入站不再计入
  if (status === 'connecting') inboundAttemptId = -1;                              // 边沿重置——关死"旧 socket 迟到帧写入新代际"竞态（第九轮评估）
  lastWsStatus = status;
  recomputeConnStatus();
});
provider.on('authenticated', () => recomputeConnStatus());
provider.on('synced', () => recomputeConnStatus());
provider.on('message', () => { inboundAttemptId = attemptId; recomputeConnStatus(); });
provider.on('close', () => recomputeConnStatus());
```

`await new Promise` 的 synced 处理维持（水合驱动不动）；:282 的 `connStatus: 'connected'` 直写删除，改 `useCanvasStore.setState({ syncFailed: false }); recomputeConnStatus();`。

- **Step 4: 跑绿** + 全量 `pnpm --filter @flowweb/web test -- --run`（既有 page.test 若锁了旧行为需同步更新——用 grep `connStatus` 于 apps/web/src 找断言）。
- **Step 5: Commit** `fix(collab): 批0a-1 recomputeConnStatus 派生+代际制（缺陷A 根修——connStatus 唯一写点）`

**Task 0a-2：destroyCollab 实例守卫（R23）**

- **Step 1: 写失败测试**（追加到 conn.spec.ts）

```ts
describe('红1-并发：destroyCollab 实例守卫（R23）', () => {
  it('旧 destroy 的 await 恢复后不得置空新会话', async () => {
    const p1 = instances[instances.length - 1];
    await driveToSynced(p1);
    const destroying = runtime.destroyCollab();   // 进入 await provider.destroy()
    const p2 = instances[instances.length - 1];
    const second = runtime.initCollab('p2');      // 新会话（p2 = 新 provider）
    p2.emit('status', { status: 'connected' });
    p2.isAuthenticated = true; p2.isSynced = true;
    p2.emit('authenticated', {}); p2.emit('synced'); p2.emit('message', {});
    await destroying;
    await second;
    expect(runtime.getDoc()).not.toBeNull();      // 旧 destroy 恢复不得 null 掉新 doc（今天必红）
  });
});
```

- **Step 2: 跑红**。
- **Step 3: 实现**——destroyCollab 改实例守卫版：

```ts
export async function destroyCollab(): Promise<void> {
  if (remoteApplyTimer) { clearTimeout(remoteApplyTimer); remoteApplyTimer = null; }
  unbindStores?.();
  unbindStores = null;
  // R23 实例守卫：await 恢复后仅当模块引用仍是"当时那个实例"才置空——新会话不被旧销毁波及
  const p = provider;
  const d = doc;
  if (p) {
    try { await p.destroy(); } catch { /* 已销毁 */ }
    if (provider === p) provider = null;
  }
  if (awarenessBridge && provider === null) awarenessBridge = null;
  detachUndoManager();
  if (d) d.destroy();
  if (doc === d) { doc = null; currentPid = null; }
}
```

- **Step 4: 跑绿** + **Step 5: Commit** `fix(collab): 批0a-2 destroyCollab 实例守卫（R23 交错置空）`

**Task 0a-3：openSession 单一漏斗 + resetSession 原子 + 403/404 分义（R5 三路径）**

- **Step 1: 通读 `apps/web/src/pages/canvas/page.tsx:40-150`**——确认四条就绪路径现状锚点：正常加载（fetch 后 initCollab）、新建（:130 附近 finish）、404 回退（:110-114）、`json.code!==0` 早退（:50 附近只 finish）、切项目 effect 清空（:88-93）、unmount destroyCollab（:141-144）。

- **Step 2: 写失败测试**（page.test.tsx 增补——spec 新建画布组判据）

```ts
// 新建画布组（批0a）：三条"可编辑但无 doc 会话"路径走 openSession；5xx 走错误态（F14）
it('404 回退路径：initCollab 以新 id 被调用（R5 复发锚——今天早退不建会话）', async () => {
  // 装置：mock fetch 返回 404 → 组件挂载 → expect(initCollab).toHaveBeenCalledWith(expect.any(String))
});
it('F14：5xx/网络错 → loadError=unavailable + 重试行动，openSession 零调用、storedId 指针不变（不散射新画布）', async () => {
  // mock fetch 返回 500 / reject → expect(initCollab).not.toHaveBeenCalled()
  //   + localStorage.getItem('canvas:project-id') 值未变 + loadError 文案渲染
});
it('403：不清 localStorage、不自动新建、loadError=inaccessible（与 404/5xx 三义分家锚）', async () => {
  // mock fetch 403 → 断言 localStorage.getItem('canvas:project-id') 未被清 + 无新建调用 + loadError 文案
});
```

（page.test.tsx 现有 mock 骨架照抄——文件内已有 initCollab mock 先例 :368。）

- **Step 3: 跑红**（三条今天全失败——早退/403 现状行为相反）。
- **Step 4: 实现**——page.tsx 引入漏斗（完整目标代码；锚点按 Step 1 实读微调）：

```ts
const sessionEpochRef = useRef(0);

/** R17 硬契约前置（批0a 版）：先推 epoch/抬 hydrate 门，再清 store——清空不被桥翻译成删除 */
function resetSession() {
  sessionEpochRef.current++;
  useCanvasStore.getState().setHydrating(true);
  useCanvasStore.setState({ nodes: [], edges: [] });
  useNodeStore.setState({ nodes: {} });
}

/** R5 结构性根修：四条项目就绪路径唯一入口（finish 私有化） */
async function openSession(id: string, name: string) {
  sessionEpochRef.current++;
  const epoch = sessionEpochRef.current;
  useCanvasStore.getState().setHydrating(true);
  await initCollab(id);
  if (epoch !== sessionEpochRef.current) return; // 期间用户切项目——丢弃陈旧结果
  useCanvasStore.setState({ projectId: id, projectName: name, syncFailed: false });
  useCanvasStore.getState().setHydrating(false);
}
```

路径改接（逐条——**F14 三义分家**）：
- 正常加载：原 `initCollab(id)`+finish 段 → `await openSession(project.id, project.name)`；
- 新建/404 回退：原"只 finish" → 先取/建新项目 id 再 `await openSession(newId, '未命名画布')`（404 提示 toast 维持）；
- **5xx/网络错/非 404 语义的 json.code!==0 → `loadError='unavailable'` + 「重试」行动（重跑 effect）——不建会话、不清 storedId 指针**（F14：API 异常时新建 POST 同样不可达，且覆写 `canvas:project-id` 指针=把用户真实画布入口换掉——数据入口事故，比"刷新蒸发新编辑"更重）；
- **403/404/5xx 三义分家**：403 → `loadError='inaccessible'`（不清 key、不自动新建）；404（确定性不存在）→ 新建+提示；5xx/网络错 → unavailable+重试；
- 切项目 effect（:88-93 同步清空段）→ 调 `resetSession()`。

**过渡注记**：openSession 用的 `setHydrating(true/false)` 是现状字段——批 2-1 整体替换为 hydration 四态后此处随改（本 plan 内自注，防 executor 困惑）。

- **Step 5: 跑绿**（新三条 + 既有 page.test 全量）+ **Step 6: Commit** `fix(collab): 批0a-3 openSession 漏斗+resetSession+403/404 分义（R5 三路径蒸发根修）`

**Task 0a-4：最小双客户端冒烟（自批 0c 前移至此——判据依赖本批 connStatus 修复）**

- **Step 1: 手动冒烟**（原文件化手册已删——内容归并 gate-checklist 历史底稿节，见 DELETED.md；批 7 脚本化的底稿）：
  1. 起 api（`pnpm --filter @flowweb/api dev`）+ web dev server；两个浏览器 profile 开同一项目；
  2. `pm2 restart` 或杀 API 进程 → 等 ~10s 重启 → 两端 connStatus 指示器回到"已连接"（本批后 ≤ 自动重连周期）；
  3. 断连期 A 端加节点 → 重连后 B 端可见（编辑合并在批 1 前靠 library 重连+SS2——若合并失败登记批 1 验证，不阻塞本批）。
- **Step 2**: 完成记录表填 0a 行 + Commit smoke 文档 `docs(collab): 批0a-4 双客户端最小冒烟清单文件化`

---

## 批 0b：deletion baseline 守卫 + 孤儿影子生命周期（独立 commit/独立回滚）

**Files:**
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（syncStoreToDoc 删除段收窄 + 影子年龄清理）
- Test（Create）: `apps/web/src/stores/canvasCollabRuntime.baseline.spec.ts`

**Task 0b-1：delete-scan 收窄为"只删上次投影内、本次消失的 key"**

- **Step 1: 写失败测试**

```ts
// apps/web/src/stores/canvasCollabRuntime.baseline.spec.ts
// 装置：直驱 syncStoreToDoc（projection.test 先例——vi.mock canvasStore 或直用真 store set nodes）
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { syncStoreToDoc, initCollab } from './canvasCollabRuntime';
import { useCanvasStore } from './canvasStore';

function setStoreNodes(nodes: any[]) {
  useCanvasStore.setState({ nodes, edges: [] });
}

describe('批0b：deletion baseline 守卫', () => {
  beforeEach(() => { useCanvasStore.setState({ nodes: [], edges: [] }); });

  it('红1b②：doc 放 shadow-x + 本地任意编辑 → doc 仍含 shadow-x（今天确定性删除——必红）', () => {
    const d = new Y.Doc();
    // 直接在 doc 摆影子（服务端 insertNode 形状）
    const m = new Y.Map(); m.set('type', 'imageGen'); d.getMap('nodes').set('shadow-img-1-abc', m);
    setStoreNodes([{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }]);
    syncStoreToDoc(d, 'local-user');
    expect(d.getMap('nodes').get('shadow-img-1-abc')).toBeTruthy();
  });

  it('对端新增（上次投影无、本次也无）不删——50ms 窗口误删修复', () => {
    const d = new Y.Doc();
    setStoreNodes([{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }]);
    syncStoreToDoc(d, 'local-user');                       // 基线立起（prev={n1}）
    d.getMap('nodes').set('n2', new Y.Map());              // 对端新增（不在本端投影）
    useCanvasStore.setState({ nodes: [ { id: 'n1', type: 'textInput', position: { x: 1, y: 1 }, data: {} } ], edges: [] });
    syncStoreToDoc(d, 'local-user');
    expect(d.getMap('nodes').get('n2')).toBeTruthy();      // 今天会被删除扫描干掉——必红
  });

  it('本地删除仍生效：基线内、本次消失 → 删', () => {
    const d = new Y.Doc();
    setStoreNodes([{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }, { id: 'n2', type: 'textInput', position: { x: 0, y: 0 }, data: {} }]);
    syncStoreToDoc(d, 'local-user');
    setStoreNodes([{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }]);
    syncStoreToDoc(d, 'local-user');
    expect(d.getMap('nodes').get('n2')).toBeUndefined();
  });
});
```

- **Step 2: 跑红**（前两条失败）。
- **Step 3: 实现**——`canvasCollabRuntime.ts`：

```ts
/** 批0b deletion baseline：只删"上次投影内、本次消失"的 key——doc 独有（影子/对端刚写）不删。
 *  它就是 delta 写的删除半边（批4b 同规则）；initCollab 每会话重置 null（首同步 doc 为源不删）。 */
let prevNodeIds: Set<string> | null = null;
let prevEdgeIds: Set<string> | null = null;
```

syncStoreToDoc 的 nodes 删除段（:92-94）替换：

```ts
for (const id of [...nodesMap.keys()]) {
  if (nodeIds.has(id)) continue;
  if (prevNodeIds === null || prevNodeIds.has(id)) nodesMap.delete(id);
}
```

edges 删除段（:117 同理，保留 auto 边守卫）：

```ts
for (const id of [...edgesMap.keys()]) {
  if (isAutoEdgeId(id)) continue;
  if (!edgeIds.has(id) && (prevEdgeIds === null || prevEdgeIds.has(id))) edgesMap.delete(id);
}
```
transact 结束后（函数尾）：

```ts
prevNodeIds = new Set(nodeIds);
prevEdgeIds = new Set(edgeIds);
```

initCollab 会话起点复位：`prevNodeIds = null; prevEdgeIds = null;`

- **Step 4: 跑绿** + 全量 web 回归。
- **Step 5: Commit** `fix(collab): 批0b-1 deletion baseline 守卫（影子确定性删除+50ms 窗口误删双修）`

**Task 0b-2：孤儿影子生命周期决策（R32）——GC 归服务端，不在客户端建机制**

- **决策落地（第九轮评估修订——所有权归位）**：~~客户端 initCollab 内 purgeAgedShadowNodes~~ **移除**——服务端实体（shadow- 影子）的生命周期由客户端连接时清理是所有权错位：批 2 VIEWER doc 零写落地后，VIEWER 首连触发 purge 会被服务端 NACK、造成只读连接本地分叉（L20 形态）；且批 5 信箱整体删除前客户端建 GC=注定要删的机制。
- **实现（~15 行，服务端）**：`collab.gateway.ts` 内原生 `setInterval(每小时).unref()` + **onLoadDocument 完成后对该 doc 顺手跑一次同款检查**——24h interval×hocuspocus.documents 只含内存中 doc×短会话 ≈ 永远扫不到（10 分钟会话撞 24h 定时器概率 ~0.7%，加载时点单查才是有效触发；第十轮评估）。API 形状**已核实（第十轮）**：`this.server.hocuspocus.documents` 的值即 `Document extends Y.Doc`（@hocuspocus/server 4.6.0 d.ts:747），getMap/transact 直接可用，gateway:233 已有 `documents.get(name)` 先例——不需要走 withDoc 通道。

```ts
/** 批0b：孤儿影子 GC（服务端所有权）——id 内嵌时间戳（video-project.service:93），删除失败/响应丢失
 *  从未进投影的影子按年龄清出。批 5 删信箱后本任务整体消失。 */
const SHADOW_TTL_MS = 7 * 24 * 3600 * 1000;
private startShadowSweep() {
  const t = setInterval(() => void this.sweepAgedShadows().catch((e) => this.logger.warn(`shadow sweep: ${e}`)), 60 * 60 * 1000); // 1h——24h×短会话≈扫不到
  t.unref?.();
}
/** onLoadDocument 钩子尾对当前 doc 调用本方法（短会话的有效触发点）——与定时器共用同一段检查 */
private sweepDocument(document: Document) {
  const nodesMap = document.getMap('nodes');
  const stale = [...nodesMap.keys()].filter((id) => {
    if (!id.startsWith('shadow-')) return false;
    const m = /^shadow-[a-z]+-(\d+)-/.exec(id);
    return !!m && Date.now() - Number(m[1]) > SHADOW_TTL_MS;
  });
  if (stale.length) document.transact(() => { for (const id of stale) nodesMap.delete(id); }); // 带 delete set
}
private async sweepAgedShadows() {
  for (const [, document] of this.server.hocuspocus.documents) this.sweepDocument(document);
}
```

- **Step 2: 测试**——gateway 单测（mock documents map 摆新旧影子，断言只删旧的）；R32 绑定条件②（同批决策孤儿生命周期）由此满足：**决策=服务端 7 天年龄清理，批 5 随信箱消失**。
- **Step 3: 跑绿** + **Step 4: Commit** `fix(collab): 批0b-2 孤儿影子服务端年龄清理（R32 GC 出口——所有权归位）`
- **Step 5**: 完成记录表填 0b 行（孤儿生命周期决策：服务端 7 天清理）。

---

## 批 0d：编辑器数据止血（零依赖 ~20 行级）

**Files:**
- Modify: `apps/web/src/pages/canvas/video-editor/persist/autosave.ts`（F3 删门 + B4 latch + flush 判据）
- Modify: `apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.tsx`（删 isConnected/notifyConnected 接线 + .catch 不 close + beforeunload）
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（导出 hasUnsyncedCanvasChanges）
- Modify: `apps/web/src/stores/canvasStore.ts`（新增 editorDirty 字段）
- Test: `apps/web/src/pages/canvas/video-editor/persist/autosave.spec.ts`（存在则改+增补，不存在则建）

**Task 0d-1：F3 删 isConnected 门 + B4 editorDirty 单向 latch + flush 判据**

- **Step 1: 写失败测试**

```ts
// autosave.spec.ts（批0d 组——装置照现有 autosave 测试骨架；此处列新增用例全文语义）
// makeController(deps) 装置：patch 可注入 resolve/reject；fake timers 推进 RETRY_DELAYS_MS。

it('F3 必红：connStatus 非 connected 时 PATCH 照发（今天 :39 早退——缺陷A 编辑器丢失链拆除锚）', async () => {
  // deps 不再有 isConnected——patch 被调用即过（控制器层面无法再表达"离线不发"）
  const patch = vi.fn().mockResolvedValue({ updatedAt: 't1' });
  const ctrl = createAutosaveController(makeDeps({ patch }));
  ctrl.notifyChange();
  await vi.advanceTimersByTimeAsync(1500);
  expect(patch).toHaveBeenCalledTimes(1);
});

it('B4/409 必红：409 后 flush() 返回 false（今天 retryCount===0 判据返回 true 放行关闭）', async () => {
  const patch = vi.fn().mockRejectedValueOnce(Object.assign(new Error(), { status: 409 }));
  const ctrl = createAutosaveController(makeDeps({ patch }));
  ctrl.notifyChange();
  await vi.advanceTimersByTimeAsync(1500);
  const ok = await ctrl.flush();
  expect(ok).toBe(false);
});

it('B4/耗尽必红：3 次退避耗尽后 onDirtyChange 仍 true（今天三标志全 false——beforeunload 不拦）', async () => {
  const patch = vi.fn().mockRejectedValue(new Error('network'));
  const onDirtyChange = vi.fn();
  const ctrl = createAutosaveController(makeDeps({ patch, onDirtyChange }));
  ctrl.notifyChange();
  expect(onDirtyChange).toHaveBeenCalledWith(true);
  await vi.advanceTimersByTimeAsync(1000 + 4000 + 16000 + 100);
  expect(onDirtyChange).not.toHaveBeenCalledWith(false); // 耗尽不清 latch
});

it('保存成功清 latch：onDirtyChange(false) 恰在成功路径', async () => {
  const patch = vi.fn().mockResolvedValue({ updatedAt: 't1' });
  const onDirtyChange = vi.fn();
  const ctrl = createAutosaveController(makeDeps({ patch, onDirtyChange }));
  ctrl.notifyChange();
  await vi.advanceTimersByTimeAsync(1500);
  expect(onDirtyChange).toHaveBeenCalledWith(false);
});
```

- **Step 2: 跑红**（第一条：isConnected 缺省 undefined→!undefined 为真反而…——装置不传 isConnected 时现状 `!deps.isConnected()` 为 false 早退⇒patch 零调用，红；后三条按现状判据/标志语义红）。
- **Step 3: 实现**——`autosave.ts`：

```ts
export interface AutosaveDeps {
  getProjectId: () => string;
  patch: (id: string, body: { data: unknown; baseUpdatedAt: string }) => Promise<{ updatedAt: string }>;
  getData: () => { data: unknown; baseUpdatedAt: string };
  onSaved: (updatedAt: string) => void;
  onStateChange: (s: 'saving' | 'saved' | 'error') => void;
  onConflict: () => void;
  /** 批0d F3：isConnected 门删除——REST PATCH 不被 WS 连接态门控（HTTP 结果+现有退避自兜）。
   *  B4 单向 latch：置位=首次变更；清除仅"保存成功"；409/耗尽不清（beforeunload 拦截的判据）。 */
  onDirtyChange?: (dirty: boolean) => void;
}
```

控制器内：删 `:39` isConnected 早退；`notifyChange` 首行加 `onDirtyChanged(true)`；doSave 成功路径（`deps.onSaved` 后）加 `onDirtyChanged(false)`；新增闭包：

```ts
let dirtyLatch = false;
const onDirtyChanged = (v: boolean) => { dirtyLatch = v; deps.onDirtyChange?.(v); };
```

`flush()` 尾行 `return retryCount === 0;` 改：

```ts
return !dirtyLatch; // B4：latch 判据（409/耗尽不清⇒拦截；成功清⇒放行）
```

`flush()` 内 `if (!deps.isConnected()) return false;` 删除；`notifyConnected` 从 AutosaveController 接口与实现整体删除。**顺手修（第九轮评估发现的真实缺陷）**：`const body = deps.getData();`（现 :43）在 try **之外**——getData 抛错则 `finally { inFlight = false }` 不执行、inFlight 永久 true、flush() 的 while 循环每 10ms 自旋（编辑器假死且 handleClose 的 .catch 因永远 pending 不触发）——getData 调用移入 try 块首行。
- **Step 4: 跑绿** + **Step 5: Commit** `fix(collab): 批0d-1 autosave 删 isConnected 门+editorDirty 单向 latch+flush 判据（409/耗尽/早退三洞）`

**Task 0d-2：Shell 接线（.catch 不 close + beforeunload 补绑）**

- **Step 1: 实现**——`VideoEditorShell.tsx`：
  - 删 `:96` `isConnected: ...` 与 `notifyConnected` 的全部调用点（connStatus 订阅若只为它存在则一并删）；
  - deps 增 `onDirtyChange: (d) => useCanvasStore.setState({ editorDirty: d })`；
  - `:117-121` handleClose 的 `.catch(()=>{releaseEditorRuntime(); close();})` 改：

```ts
.catch(() => {
  // 批0d：异常不直接放行——数据在 editorStore，留在编辑器给用户重试（close=丢出口）
  toastApiRef.current?.error('保存失败，请重试或放弃修改');
});
```

  - 新增 beforeunload（组件内 effect）：

```ts
useEffect(() => {
  const h = (e: BeforeUnloadEvent) => {
    const st = useCanvasStore.getState();
    if (st.editorDirty || hasUnsyncedCanvasChanges()) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', h);
  return () => window.removeEventListener('beforeunload', h);
}, []);
```

  - `canvasStore.ts` state 增 `editorDirty: false`（字段注释：B4 单向 latch——由 autosave onDirtyChange 维护；dispose/收起清零）。

`canvasCollabRuntime.ts` 导出：

```ts
/** 批0d beforeunload 谓词半边（provider 公开 API）；rebuildPending 项批 1 接入（届时并入） */
export function hasUnsyncedCanvasChanges(): boolean {
  return provider?.hasUnsyncedChanges ?? false;
}
```

- **Step 2: 测试**——Shell 现有测试更新 + 两条必红：①flush reject 时 handleClose 不调 close（今天直接 close——必红）②editorDirty true 时 beforeunload preventDefault。
- **Step 3: 跑绿** + 全量 web 回归 + **Step 4: Commit** `fix(collab): 批0d-2 Shell 接线（catch不放行+beforeunload+editorDirty 入 store）`

**Task 0d-3：同类门控扫描 + 批尾**

- **Step 1**: `grep -rn "connStatus" apps/web/src --include="*.ts*" | grep -v canvasCollabRuntime | grep -v canvasStore | grep -v test` ——逐条人工审：是否有别的 HTTP/REST 功能被 connStatus 门控（F3 同类）；发现即同批拆（登记完成记录表）。
- **Step 2**: `pnpm --filter @flowweb/web test -- --run` + `pnpm verify`；完成记录表填 0d 行。

---

## 批 0e：CI 地基（0c 后批 1 前）

**Files:**
- Modify: `apps/web/package.json:23` + `apps/api/package.json`（devDeps）——pin `@hocuspocus/*` 4.6.0
- Create: `.github/workflows/ci.yml`
- Create: `scripts/check-hocuspocus-pin.mjs`
- Create: `apps/api/eslint.config.mjs` + Modify `apps/api/package.json`（devDeps：eslint/typesscript-eslint）
- Modify: `apps/web/scripts/lint-gate.mjs`（静态断言扩容）

**Task 0e-1：pin 精确版本 + 漂移检查脚本**

- **Step 1: pin**——`apps/web/package.json:23` `"@hocuspocus/provider": "^4.6.0"` → `"4.6.0"`；api devDependencies 同款处理（若有）→ `pnpm install`（更新 lockfile）。
- **Step 2: 写检查脚本**

```js
// scripts/check-hocuspocus-pin.mjs
// 契约锁㉗/F9：spec 全部行号引证基于 4.6.0——版本漂移=契约锁整表重验前置。CI 必跑。
import { readFileSync } from 'node:fs';
const lock = readFileSync('pnpm-lock.yaml', 'utf8');
const re = /'@hocuspocus\/(provider|server|common|extension-redis)@([\d.]+)'/g;
const found = new Set();
let m;
while ((m = re.exec(lock))) found.add(`${m[1]}@${m[2]}`);
if (found.size === 0) { console.error('未在 lockfile 找到 @hocuspocus 条目（正则失配？）'); process.exit(1); }
const bad = [...found].filter((s) => !s.endsWith('@4.6.0'));
if (bad.length) { console.error('契约锁：@hocuspocus 版本漂移（必须 pin 4.6.0 且跑契约锁全量用例）:', bad); process.exit(1); }
console.log('hocuspocus pinned @4.6.0 ✓', [...found]);
```

- **Step 3: 验证**——`node scripts/check-hocuspocus-pin.mjs` 输出 ✓；临时改 lock 测负例（改回）。
- **Step 4: Commit** `build(collab): 批0e-1 @hocuspocus pin 4.6.0+漂移检查脚本（F9）`

**Task 0e-2：CI workflow（PG+Redis service）**

- **Step 1: 写 workflow**

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push: { branches: [master] }
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: flowweb, POSTGRES_PASSWORD: '123456', POSTGRES_DB: flowweb }
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
      redis:
        image: redis:7
        ports: ['6379:6379']
        options: >-
          --health-cmd "redis-cli ping" --health-interval 10s --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgresql://flowweb:123456@localhost:5432/flowweb
      REDIS_URL: redis://localhost:6379/0
      JWT_SECRET: ci-secret
      # 其余必填键以 apps/api/src/config/env.ts 对照补齐（Step 1 前先读）——
      # MinIO 不起 service：api 单测全 mock，勿留 MINIO_* env 造成"看似需要实际连不上"的误导（第九轮评估）
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @flowweb/shared build
      - run: node scripts/check-hocuspocus-pin.mjs
      # 表必须先于 verify 建好（第十轮评估修正）：0.5 的 int spec 直连真库且 skip 条件只看
      # DATABASE_URL 存在——CI env 有值而表未建时 verify 必炸。0.5 落地时启用下面这行：
      # - run: pnpm --filter @flowweb/api exec prisma migrate deploy
      # 单一真相源：CI 直接跑 verify（含 shared typecheck/test + web/api tsc --noEmit + 全测 + web lint）
      # ——手抄步骤清单会与 verify 漂移（第九轮评估：vitest 不做类型检查，漂移=CI 放行类型炸裂的 PR）
      # int spec 随 verify 全量跑（migrate deploy 已建表），不单列 test:int 步骤
      - run: pnpm verify
      # 增量步骤（verify 之外的门）：
      - run: pnpm --filter @flowweb/api exec eslint "{src,test}/**/*.ts"
      # e2e-collab job 预留（批 7 启用，独立 job 非本 job 步骤）：nightly schedule + workflow_dispatch，PR 不跑
```

（migrate deploy 为批 0.5 真库集成测试预留——0.5 落地时启用且**必须上移到 verify 之前**：int spec 的 skip 条件只看 DATABASE_URL 存在，CI env 有值而表未建则 verify 必炸〔第十轮评估修正〕；int spec 随 verify 全量跑，本地跑需 shell 显式 export DATABASE_URL——vitest 不自动加载 .env。另批 7 启用独立 `e2e-collab` job：nightly schedule + workflow_dispatch 手动触发，**PR 不跑**——双客户端 E2E+起停 API 时长不适合逐 PR，发布门禁语义=发布前必绿〔本地 gate 清单+nightly CI 双保险〕。）

- **Step 2: 本地等价验证**——`pnpm verify` 全绿（CI 是 verify 的云端化）。
- **Step 3: Commit** `ci(collab): 批0e-2 最小 CI（PG+Redis service+api/web test+pin 检查）`

**Task 0e-3：api eslint 从零**

- **Step 1: 安装**——`pnpm --filter @flowweb/api add -D eslint typescript-eslint @eslint/js`
- **Step 2: 配置**

```js
// apps/api/eslint.config.mjs
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['{src,test}/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // 仓内 any 密度高——先建底座再收紧（B3 门禁 AST 规则的载体）
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
```

- **Step 3: 跑通**——`pnpm --filter @flowweb/api exec eslint "{src,test}/**/*.ts"`：修复 error 级违规（warn 放行）；若存量 error 超过 ~30 处，error 一律最小改动修复（dev 阶段无豁免清单）。**B3 门禁规则占位（spec 0c 行"门禁 AST/ESLint 规则"的载体）**：底座建好后先挂一条最小规则——`no-restricted-syntax` 禁止在**未注入 ProjectPermissionService** 的 service 文件中出现 `queue.add(`/`teamCredit.consume(`/`writeNodeData(` 调用（B3 完整形态"副作用前置守卫"的 AST 规则随批 0.5 三模块 claim 接线稳定后挂——断言形态依赖接线范式；短期负例判据测试已在 0c 兜底）。
- **Step 4: Commit** `build(collab): 批0e-3 api eslint 从零建（B3 门禁/B6 的载体）`

**Task 0e-4：lint-gate 静态断言扩容（3 条）**

- **Step 1: 读 `apps/web/scripts/lint-gate.mjs`** 全文，按其规则形态追加（同构退出码约定）：
  - **A. connStatus 单写点**：生产代码中 `connStatus:` 出现的文件 ⊆ `{canvasCollabRuntime.ts, canvasStore.ts}`（测试豁免）——违例 exit 1，message 说明"唯一写点 recomputeConnStatus（批0a）"；
  - **B. getMap 三文件门**：生产代码 `getMap(` 仅 `{canvasCollabRuntime.ts, ydocBuilder.ts, canvasUndo.ts}`（测试豁免；exec map 读点批 0.5 落地时增补 `ydocBuilder`/runtime 内聚合）；
  - **C. setState 白名单**：`useCanvasStore.setState(`/`useNodeStore.setState(` 仅 `{canvasStore.ts, nodeStore.ts, canvasCollabRuntime.ts, canvasHistory.ts}`+生命周期豁免点 `page.tsx`/`nodeStore.ts` 桥——按 spec 静态断言⑤清单，测试豁免。
- **Step 2: 跑通**——`pnpm --filter @flowweb/web lint` 全绿（存量违例按白名单/豁免清单核清——这正是"旁路枚举"本身）。
- **Step 3: Commit** `build(collab): 批0e-4 lint-gate 静态断言 3 条（connStatus 单写点/getMap 门/setState 白名单）`
- **Step 4**: push 后确认 CI 首绿；完成记录表填 0e 行（CI 首绿 commit）。

---

## 批 0.5：GenerationIntent 意图表 + exec map（B1/B2/F1/F2/F13 合并工程）

**规模注记（第十轮评估）**：九任务现实量级 3~4 天；**可停在 0.5-7 独立回滚**——0.5-8（扩面）与 0.5-9（两阶段扣费）对主链（0.5-1~0.5-7 的 execution 链）无反向依赖，各自独立 commit。

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（GenerationIntent 模型 + IntentStatus 枚举 + TeamCreditTransactionType 增 `refund` 值——退款逆向记账载体）
- Create: `apps/api/prisma/migrations/<本地时间戳>_generation_intent/migration.sql`（migrate dev 生成后**手改追加 partial unique**）
- Create: `apps/api/src/modules/execution/generation-intent.service.ts`、`normalize-intent-params.ts`、`intent-reconcile.service.ts`、`generation-intent.controller.spec.ts`
- Modify: `apps/api/src/modules/team/team-credit.service.ts:60-130`（consume $transaction 原子化）
- Modify: `apps/api/src/modules/collab/collab-document.service.ts`（writeExecStatus——exec map 服务端唯一写者）
- Modify: `apps/api/src/modules/execution/execution.service.ts`（claim→外呼→扣费→产物→complete 全链挂意图）+ `execution.processor.ts`（@OnWorkerEvent('failed') 终态兜底）+ `execution.controller.ts`（GET intents + intentId 透传）
- Modify: `apps/api/src/modules/execution/execution.module.ts`（providers 注册）
- Create: `apps/web/src/utils/intentRecord.ts`（客户端意图记录）
- Test（Create）: `generation-intent.service.spec.ts`、`normalize-intent-params.spec.ts`、`team-credit.atomic.spec.ts`、`collab-document.exec-map.spec.ts`

**Task 0.5-1：schema + 迁移（复合唯一 + 活跃 partial unique + F13 补列/索引）**

- **Step 1: schema 追加**（`schema.prisma` 文件尾）：

```prisma
/// 会话恢复 spec v5.10 B1/F1/F13——幂等与在飞互斥载体（净删 SETNX/dedup/五段键/失败重放计数）
model GenerationIntent {
  id              String       @id @default(cuid())
  projectId       String
  nodeId          String
  userId          String       // F13：退款回滚 monthlyUsed 需归因到人；对账三面 join 键
  intentId        String       // 客户端 runId——与 projectId 复合唯一（F1：跨项目撞键=两行独立不误伤）
  kind            String       // text|video|image|outpaint|erase|redraw|lighting
  paramsHash      String       // 服务端规范化哈希——命中比对谓词（防客户端改参复用 intentId）
  status          IntentStatus @default(RUNNING)
  jobId           String?      // 同步路径为空——reconcile 三查特判（F13）
  creditsConsumed Int          @default(0)  // F13：扣费时即写（consume 事务内 CAS）——崩溃窗口对账可判；退款事务归零（F13 补强——CAS 门不变量）
  attempts        Int          @default(1)  // F13 补强：免费重放上限——rearm 自增，≥3 拒绝再激活（幂等≠无限白嫖外呼；v5.8 ⑭ 随净删误删的回归封堵）
  resultRef       String?      // Media id / 产物 URL
  error           String?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  completedAt     DateTime?

  @@unique([projectId, intentId])
  @@index([projectId, nodeId, status])
  @@index([jobId])             // F13：reconcile 活跃核验按 jobId 查 BullMQ 状态
  @@index([status, updatedAt]) // F13：活跃核验扫描（partial index 不进 Prisma 声明——migration SQL 唯一真相）
  @@index([status, completedAt]) // 保留策略清理扫描用（终态 N 天清理——F1）
}

enum IntentStatus {
  RUNNING     // claim 直建 RUNNING——PENDING 删除（F13 补强：无写者的死枚举值；两阶段扣费冻结载体用列不用状态，不复活）
  SUCCEEDED
  FAILED
  VOIDED
}
```

- **Step 2: 生成迁移并手改**——`pnpm --filter @flowweb/api exec prisma migrate dev --name generation_intent`；打开生成 的 `migration.sql` **末尾追加**（Prisma schema 不支持 partial index 声明——SQL 层唯一真相）：

```sql
-- F1: per-node in-flight mutex (takes over from SETNX) — at most one active intent per node;
-- terminal-state rows fall out of index range, naturally allowing new intents; group execution = one row per node, unaffected.
-- PENDING deleted (F13 补强) — claim creates RUNNING directly.
CREATE UNIQUE INDEX "generation_intent_active_node_unique"
ON "GenerationIntent"("projectId", "nodeId")
WHERE status = 'RUNNING';
```

- **Step 3: fresh replay 验证**（记忆纪律：迁移必 fresh replay）——`pnpm --filter @flowweb/api exec prisma migrate reset` 全量重放成功；`psql` 确认 partial index 存在（`\d "GenerationIntent"`）。
- **Step 3b: 真库集成测试（F13——全方案唯一"只被 mock 验证过的数据库行为"）**——新建 `apps/api/src/modules/execution/generation-intent.int.spec.ts`（本地直连 DATABASE_URL 跑，CI 随 0e workflow 的 migrate deploy+int 步骤）：

```ts
// 并发双 claim 真库行为：P2002 meta.target 的真实形态（字符串 or 数组）与等值匹配——
// 0.5-3 的分义逻辑以此实测为准修正（禁字符串包含匹配的纸上推演）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { GenerationIntentService } from './generation-intent.service';

const prisma = new PrismaClient();
describe('GenerationIntent 真库并发行为（int）', () => {
  afterAll(async () => { await prisma.generationIntent.deleteMany({}); await prisma.$disconnect(); });
  it('同节点两个不同 intentId 并发 claim → 第二个 P2002 且 meta.target 含 partial 索引名（实测形态）', async () => {
    const svc = new GenerationIntentService(prisma as any);
    await svc.claim({ projectId: 'pi', nodeId: 'n1', userId: 'u1', intentId: 'i1', kind: 'image', paramsHash: 'h' });
    try {
      await svc.claim({ projectId: 'pi', nodeId: 'n1', userId: 'u1', intentId: 'i2', kind: 'image', paramsHash: 'h' });
      expect.unreachable('应撞活跃 partial unique');
    } catch (e: any) {
      expect(e.errorCode).toBe('NODE_BUSY');
      console.log('P2002 meta.target 实测形态:', JSON.stringify(e.__meta)); // 断言时按实测改等值匹配
    }
  });
  it('同 intentId 异参数 → 409 INTENT_CONTEXT_MISMATCH（真库复合唯一命中路径）', async () => { /* 同构 */ });
});
```

（vitest 配置需让 `*.int.spec.ts` 在无 DATABASE_URL 时 skip：文件首 `const hasDb = !!process.env.DATABASE_URL; (hasDb ? describe : describe.skip)`。）
- **Step 4: Commit** `feat(collab): 批0.5-1 GenerationIntent 表（复合唯一+活跃 partial unique+保留索引）`

**Task 0.5-2：normalizeIntentParams（五扣费点共用规范化）**

- **Step 1: 写失败测试**——`normalize-intent-params.spec.ts`：①同 payload 两次 → 同 hash；②同 payload 键序打乱 → 同 hash；③`sv/nonce/ts/requestId` 字段差异 → 同 hash；④`model` 差异 → 异 hash；⑤同步/异步同逻辑意图（execution image vs ai-image-edit redraw 的 prompt+strength 集）→ 同 hash。
- **Step 2: 跑红** → **Step 3: 实现**：

```ts
// apps/api/src/modules/execution/normalize-intent-params.ts
import { createHash } from 'node:crypto';
/** F1：服务端白名单规范化——只取稳定意图参数；剔 sv/时间戳/nonce/请求 id；键排序后稳定 JSON 的 sha256。
 *  五扣费点（execution text/video/image + ai-image-edit/lighting）共用同一函数——
 *  两点各自实现会产生两键=双扣（spec 幂等组⑬）。 */
const WHITELIST: Record<string, string[]> = {
  text: ['model', 'prompt'],
  video: ['model', 'mode', 'prompt', 'imageUrl', 'startImageUrl', 'endImageUrl', 'imageUrls', 'ratio', 'quality', 'duration', 'audio'],
  image: ['model', 'prompt', 'extraPrompt', 'style', 'resolution', 'imageUrl'],
  outpaint: ['rect', 'imageWidth', 'imageHeight'],
  erase: [],
  redraw: ['prompt', 'strength'],
  lighting: ['prompt', 'strength'],
};
export function normalizeIntentParams(kind: string, params: Record<string, unknown>): string {
  const whitelist = WHITELIST[kind];
  if (!whitelist) throw new Error(`normalizeIntentParams: unknown kind '${kind}'——新扣费点必须登记白名单（fail-closed：静默回退全键会让 sv/nonce 进哈希，失败重试必然 409、"重试"按钮永久坏死）`);
  const keys = whitelist.slice().sort();
  const picked: Record<string, unknown> = {};
  for (const k of keys) picked[k] = params[k] === undefined ? null : params[k];
  return createHash('sha256').update(JSON.stringify(picked)).digest('hex');
}
```

（白名单覆盖面以五扣费点实读为准补齐——Step 1 前通读 execution.service :85-135/:176-200 与 ai-image-edit/lighting 的外呼参数集。）
- **Step 4: 跑绿** + Commit。

**Task 0.5-3：GenerationIntentService（claim 完整状态机——F13 重写版）**

- **Step 1: 写失败测试**（`generation-intent.service.spec.ts`，mock Prisma 的事务/异常码）：
  - **同项目同 intentId 异上下文 → 409 INTENT_CONTEXT_MISMATCH**（B1 必红）；
  - **同 intentId 同 jobId 命中 RUNNING → 可重入续跑（equivalent created:true）**——stalled 重排同 jobId 重进 claim 不得自锁（F13 必红：`@Processor{maxStalledCount:1}` 的"部署杀任务自动恢复"以此为前提）；
  - **同 intentId 异 jobId 命中 RUNNING → NodeBusy**；
  - **命中 FAILED/VOIDED 且 sameCtx → 原子再激活成功（拥有执行权）/并发抢走 → NodeBusy**（F13 必红：否则"失败重试复用同 intentId"每次重试都扣费且 complete() 零匹配永不落 SUCCEEDED——重试死循环双扣）；
  - **命中 SUCCEEDED 且 sameCtx → created:false 幂等重放**（返回既有结果引用）；
  - **P2002 且 meta.target===partial 索引名 → NodeBusy**（等值匹配——真实形态以 0.5-1 Step 3b 真库实测为准修正）；
  - **P2002 catch 路径同上下文异 jobId（并发同 intentId 超时重发）→ NodeBusy 非 INTENT_CONTEXT_MISMATCH**（第十轮必红——mismatch 标签对在飞请求是误导）；
  - **attempts≥3 的 FAILED/VOIDED → 409 INTENT_EXHAUSTED；rearm 成功 → attempts 自增**（免费重放上限锚——第十轮必红）；
  - complete/fail 幂等迁移：SUCCEEDED 行再 fail → 零变更（`updateMany where status in active` 天然幂等）；complete 返回 count 0/1 两锚（产物门序消费端判据在 0.5-6）。
- **Step 2: 跑红** → **Step 3: 实现**：

```ts
// apps/api/src/modules/execution/generation-intent.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export class IntentContextMismatchError extends Error {
  readonly status = 409; readonly errorCode = 'INTENT_CONTEXT_MISMATCH';
  constructor() { super('意图上下文不匹配（intentId 复用到不同节点/参数）'); }
}
export class NodeBusyError extends Error {
  readonly status = 409; readonly errorCode = 'NODE_BUSY';
  constructor(msg?: string) { super(msg ?? '该节点正在生成中'); }
}
export class IntentExhaustedError extends Error {
  readonly status = 409; readonly errorCode = 'INTENT_EXHAUSTED';
  constructor() { super('重试次数已用尽——请重新发起生成（新意图将正常扣费）'); }
}

const ACTIVE = ['RUNNING'] as const; // PENDING 删除（0.5-1）——claim 直建 RUNNING
const REARMABLE = ['FAILED', 'VOIDED'] as const;
/** partial unique 索引名（migration SQL 唯一真相）——P2002 等值匹配用 */
export const ACTIVE_NODE_INDEX_NAME = 'generation_intent_active_node_unique';

@Injectable()
export class GenerationIntentService {
  constructor(private readonly prisma: PrismaService) {}

  /** claim 完整状态机（F13）——五个分支：
   *  ①无行 → create（RUNNING）=新执行权
   *  ②RUNNING 且 intent.jobId===input.jobId → 可重入续跑（stalled 同 job 重排不得自锁）=执行权
   *  ③RUNNING 且 jobId 不同 → NodeBusy（双击互斥——F1 partial unique 的应用层镜像）
   *  ④FAILED/VOIDED 且 sameCtx → 守卫式原子再激活（updateMany FAILED/VOIDED→RUNNING，
   *    count===1 才拥有执行权；并发抢走 → NodeBusy）——失败重试复用同 intentId 的语义闭环
   *  ⑤SUCCEEDED 且 sameCtx → created:false 幂等重放（调用方返回既有产物引用，零外呼零扣费）
   *  异上下文（nodeId/kind/paramsHash 任一不匹配）→ 409 INTENT_CONTEXT_MISMATCH（绝不静默按"已扣过"跳过）
   */
  async claim(input: { projectId: string; nodeId: string; userId: string; intentId: string; kind: string; paramsHash: string; jobId?: string }) {
    const where = { projectId_intentId: { projectId: input.projectId, intentId: input.intentId } };
    const sameCtx = (r: { nodeId: string; kind: string; paramsHash: string }) =>
      r.nodeId === input.nodeId && r.kind === input.kind && r.paramsHash === input.paramsHash;
    const existing = await this.prisma.generationIntent.findUnique({ where });
    if (existing) {
      if (!sameCtx(existing)) throw new IntentContextMismatchError();
      if (existing.status === 'SUCCEEDED') return { intent: existing, created: false };
      if (existing.status === 'RUNNING') {
        if (input.jobId && existing.jobId === input.jobId) return { intent: existing, created: true }; // 同 job 可重入
        // 同步路径孤儿（updatedAt 龄 >10min）与真在飞的 UX 分义——文案提示回收窗口（第十轮 N5）
        const staleMin = (Date.now() - existing.updatedAt.getTime()) / 60_000;
        throw new NodeBusyError(staleMin > 10 ? '系统回收中（约 15 分钟），请稍后重试' : undefined);
      }
      // FAILED/VOIDED → 原子再激活（守卫式——并发双请求只有一个成功）
      // creditsConsumed 不动（按终态分义——F13 补强真值表）：FAILED=押金还押着（重试 alreadyCharged 免费续跑）；
      // VOIDED=退款事务已归零（重试正常扣费）——四格语义由此全部分叉正确。
      if (existing.attempts >= 3) throw new IntentExhaustedError(); // 免费重放上限（幂等≠无限白嫖外呼）
      const rearmed = await this.prisma.generationIntent.updateMany({
        where: { id: existing.id, status: { in: [...REARMABLE] } },
        data: { status: 'RUNNING', error: null, jobId: input.jobId ?? null, completedAt: null, attempts: { increment: 1 } },
      });
      if (rearmed.count === 1) {
        const intent = await this.prisma.generationIntent.findUnique({ where: { id: existing.id } });
        return { intent: intent!, created: true };
      }
      throw new NodeBusyError(); // 再激活被并发抢走
    }
    try {
      const intent = await this.prisma.generationIntent.create({ data: { ...input, jobId: input.jobId ?? null, status: 'RUNNING' } });
      return { intent, created: true };
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const again = await this.prisma.generationIntent.findUnique({ where });
        if (again && sameCtx(again) && input.jobId && again.jobId === input.jobId && again.status === 'RUNNING') {
          return { intent: again, created: true }; // create 与重入并发——按可重入处理
        }
        const target = e?.meta?.target;
        if (target === ACTIVE_NODE_INDEX_NAME || (Array.isArray(target) && target.join(',').includes('active_node'))) {
          throw new NodeBusyError(); // 同节点异 intentId 在飞（真实形态以真库 int 测试实测为准——等值优先）
        }
        if (again && sameCtx(again)) throw new NodeBusyError(); // 同上下文异 jobId 撞复合唯一=在飞非错配（第十轮：mismatch 标签误导用户）
        if (again) throw new IntentContextMismatchError();
      }
      throw e;
    }
  }

  /** complete 幂等迁移——返回受影响行数（F13 补强产物门序）：count===1 调用方才写 doc/exec；
   *  count===0=行已被 reconcile VOIDED+退款——调用方跳过产物写入（"看到产物 ⇒ 意图仍有效"）。 */
  async complete(id: string, resultRef: string): Promise<number> {
    const r = await this.prisma.generationIntent.updateMany({
      where: { id, status: { in: [...ACTIVE] } },
      data: { status: 'SUCCEEDED', resultRef, completedAt: new Date() },
    });
    return r.count;
  }
  async fail(id: string, error: string) {
    await this.prisma.generationIntent.updateMany({
      where: { id, status: { in: [...ACTIVE] } },
      data: { status: 'FAILED', error: error.slice(0, 500), completedAt: new Date() },
    });
  }
  /** 扩面模块 controller claim→queue.add 后回写 jobId（F13 补强）：不回写则 reconcile A 路径
   *  （查 BullMQ 真实状态）对 ai-image-edit/lighting 永久失效，且与同步路径（合法无 jobId）
   *  不可区分——长任务会被三查②按"同步路径崩溃"误判 VOIDED。 */
  async attachJob(id: string, jobId: string) {
    await this.prisma.generationIntent.update({ where: { id }, data: { jobId } });
  }
  async listByNode(projectId: string, nodeId: string) {
    return this.prisma.generationIntent.findMany({
      where: { projectId, nodeId },
      orderBy: { createdAt: 'desc' }, take: 20,
      select: { id: true, intentId: true, kind: true, status: true, resultRef: true, error: true, creditsConsumed: true, createdAt: true, completedAt: true },
    });
  }
}
```

（错误抛出形态若与仓内 BusinessException 惯例不一致——先读一处现有用法对齐，保持 errorCode 透出链路一致。）
- **Step 4: 跑绿** + Commit `feat(collab): 批0.5-3 意图表服务（claim 409 分义/幂等迁移/恢复查询）`

**Task 0.5-4：consume $transaction 原子化 + CAS 扣费门 + 流水键意图维度（F13）**

- **Step 1: 通读 `team-credit.service.ts:55-135`**（现有余额拆分/乐观循环/两行记账逻辑全貌）。
- **Step 2: 写失败测试**（`team-credit.atomic.spec.ts`——mock prisma.$transaction 直接执行回调（透传 tx=prisma mock））：
  - **QUOTA_EXCEEDED → 余额不变 + 零流水**（现状 :103 return 前余额已扣无补偿——必红）；
  - **正常成功 → claim+扣减+两行记账同一 tx**（断言 createMany 在 tx 内调用）；
  - **CAS 扣费门（F13 必红）：同 intent 第二次 consume → 意图行 updateMany creditsConsumed:0 匹配零行 ⇒ 不扣余额零流水返回 alreadyCharged**（崩溃/重跑/重试全组合只扣一次——净删五套机制后的扣费幂等接替物）；
  - 充值/订阅路径零影响（回归）。
- **Step 3: 实现**——consume 增可选 intentGuard 参数（保留现有余额拆分算法，整体搬进 $transaction 回调）：

```ts
// 骨架（余额拆分/乐观循环原逻辑原样内联到 tx——以下为结构契约）
async consume(
  teamId: string, userId: string, amount: number, referenceId: string,
  intentGuard?: { intentRowId: string },   // F13：带守卫时流水 referenceId 用 intent: 维度 + CAS 扣费门
  txOpts: { timeout: 10_000, maxWait: 5_000 },  // 显式超时（第九轮评估）：交互式事务默认 5s，乐观锁重试在争用下会假失败
) {
  class QuotaExceeded extends Error {}
  try {
    return await this.prisma.$transaction(async (tx) => {
      // —— CAS 扣费门（必须在扣余额之前）——
      // 门的不变量：creditsConsumed>0 ⇒ 钱在我们手里。退款路径由 0.5-7 退款事务在 VOID 的同一事务内
      // 归零（F13 补强）；FAILED 押金语义不归零——真值表四格依赖此分义。
      if (intentGuard) {
        const gate = await tx.generationIntent.updateMany({
          where: { id: intentGuard.intentRowId, creditsConsumed: 0 },
          data: { creditsConsumed: amount },       // 扣费时即写（F13）——崩溃窗口对账可判
        });
        if (gate.count === 0) return { success: true, alreadyCharged: true }; // 本意图已扣过——不扣不记，续产物
      }
      // …现有乐观循环扣减（tx.team.updateMany…）——一次扣成功才继续
      // …配额复验：超限 throw new QuotaExceeded()（v5.8 写死：正常 return=提交已扣余额——必须 throw 整体回滚；
      //   带 intentGuard 时 CAS 已在本次事务内、回滚同时撤销 creditsConsumed——门与钱同生共死）
      // …两行记账 tx.teamCreditTransaction.createMany（referenceId=intentGuard ? `intent:${intentId}` : 原值；
      //   禁唯一约束契约锁㉛ 不变——意图维度天然可判重，不需要约束）
      return { success: true, /* 余额视图 */ };
    }, txOpts);
  } catch (e) {
    if (e instanceof QuotaExceeded) return { success: false, reason: 'QUOTA_EXCEEDED' }; // 回滚后返回——余额不变+零流水
    throw e;
  }
}
```

**调用点改造（F13）**：execution.service 三处 + ai-image-edit processor + lighting consumer 的 consume 调用全部改传 `intentGuard: { intentRowId: intent.id }`——referenceId `node:`/`edit:`/`lighting:` 前缀**退役**（同节点两次生成共享键=对账数学上不可判定；意图表既是幂等载体、流水键必须同粒度才能精确 join）。
- **Step 4: 跑绿**（含既有 team-credit 测试更新——单测④补余额断言，spec v5.8 ⑤勘正）+ Commit `fix(collab): 批0.5-4 consume 原子化+CAS 扣费门+流水键 intent: 维度（F13）`

**Task 0.5-5：exec map 服务端唯一写者（writeExecStatus）**

- **Step 1: 写失败测试**（`collab-document.exec-map.spec.ts`——真 Y.Doc 直驱，装置照 collab.gateway.spec 的 mock gateway 直构）：
  - writeExecStatus 写 `doc.getMap('exec')` 的 nodeId 条目（status/jobId/intentId）；
  - **终态防倒退**：已 `{status:'done'}` 再写 loading → 仍 done（幂等读锚）；
  - **节点不存在**：nodes 无该 id 时仍写 exec 条目（异步落地竞态——best-effort 语义）；
  - 同 nodeId 第二次写补键不覆盖已有键（patch 语义）。
- **Step 2: 跑红** → **Step 3: 实现**（`collab-document.service.ts` 追加）：

```ts
/** B2/F2：exec map 服务端唯一写者（客户端零 exec 写——批0.5 起静态断言）。
 *  写前幂等读：同 nodeId 已终态（done/error）→ 跳过（迟到 loading 不倒退终态）。
 *  投影写失败 ⇒ 服务端有界退避重试（F2——批3 persist-status 同款机制落地前先 log+metric，机制位留好）。 */
async writeExecStatus(projectId: string, nodeId: string, patch: Record<string, unknown>) {
  await this.withDoc(projectId, (doc) => {
    const exec = doc.getMap('exec');
    let m = exec.get(nodeId);
    if (m instanceof Y.Map) {
      const s = m.get('status');
      if (s === 'done' || s === 'error') return; // 终态不倒退
    } else {
      m = new Y.Map();
      exec.set(nodeId, m);
    }
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) m.set(k, v);
  });
}
```

- **Step 4: 跑绿** + Commit `feat(collab): 批0.5-5 exec map 服务端唯一写者（终态防倒退+patch 语义）`

**Task 0.5-6：execution 全链挂意图（claim→外呼→扣费→产物→complete）+ failed 钩子 + GET intents**

- **Step 1: 写失败测试**（`execution.security.spec.ts` 扩展 + 新 `execution.intent.spec.ts`）：
  - **幂等重放**：claim 返回 created=false（既有 RUNNING/SUCCEEDED）→ 外呼零调用（apiCaller mock 计数）；SUCCEEDED 同上下文 → 返回既有结果引用（不再扣费——幂等组②）；
  - **双击 409**：NodeBusyError 冒泡为 `{success:false, errors:['节点生成中']}`（幂等组语境）；
  - **job failed 钩子**：@OnWorkerEvent('failed') 调 writeExecStatus {status:'error'}（mock 断言）；
  - **complete 门序（F13 补强必红）**：complete 返回 0（行已 VOIDED——mock updateMany count=0）→ writeNodeData 零调用 + 告警计数；count===1 → writeNodeData 正常（"看到产物 ⇒ 意图仍有效"锚）；
  - **GET intents**：非成员 404（不泄露存在性——与 jobs/:id 同口径）；**VIEWER（成员非 editor）200**（第十轮：assertEditor 会把批 1-6 判据④ VIEWER 恢复对齐的 REST 兜底挡掉）；成员返回 listByNode 投影。
- **Step 2: 跑红** → **Step 3: 实现**：
  - `execution.controller.ts`：enqueue body 增 `intentId`（透传 job.data）；execute 读 `@Headers('x-intent-id') intentId`；新增：

```ts
@Get('intents')
async listIntents(@Query('projectId') projectId: string, @Query('nodeId') nodeId: string, @Req() req: Request) {
  const role = await this.perm.resolve(projectId, (req as any).user?.id); // 成员级——读面 VIEWER 也可见（与 jobs/:id 同口径）
  if (!role) throw new NotFoundException(); // 404 不泄露存在性
  return { code: 0, data: await this.intentService.listByNode(projectId, nodeId) };
}
```

  - `execution.service.ts`：execute() 每节点段前置（外呼之前）——**claim 状态机的全部分支已收进 service（0.5-3），调用方只剩两种返回处理**：

```ts
const paramsHash = normalizeIntentParams(kindOf(node, data), intentParamsOf(node, data, upstream));
const { intent, created } = await this.intentService.claim({
  projectId, nodeId: node.id, userId, intentId: intentId ?? randomUUID(),
  kind: kindOf(node, data), paramsHash, jobId,   // jobId 传入——同 job stalled 重排可重入续跑（F13）
});
if (!created) {
  // 唯一到这里的路径：SUCCEEDED 幂等重放——返回既有产物引用，零外呼零扣费（幂等组②）
  this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'done', fileId: intent.resultRef! });
  continue;
}
// created:true（新行 / 同 job 重入续跑 / FAILED 原子再激活）——往下执行外呼→consume（带 intentGuard CAS 门）→产物
```

  consume 调用改带 `intentGuard: { intentRowId: intent.id }`（0.5-4——重跑/重试全组合只扣一次）；产物链序（F13 补强门序）：`media.create`（产物持久事实）→ `const n = await this.intentService.complete(intent.id, mediaOrResultRef)` → **`n===1` 才 `writeNodeData` + `writeExecStatus({ status: 'done', jobId, intentId: intent.intentId, fileId })`**；`n===0`（行已被 reconcile VOIDED+退款）→ 跳过 doc 写 + 对账告警计数（Media 行留作物证）——"看到产物 ⇒ 意图仍有效（钱没被退）"；catch 路径 `await this.intentService.fail(intent.id, String(e))` + `writeExecStatus(projectId, node.id, { status: 'error', error })`（error 展示不受门序限——无产物即无资损方向）；enqueue/执行开始 `writeExecStatus({ status: 'loading', jobId, intentId })`（best-effort，失败仅计数）。
  - `execution.processor.ts`：**@Processor 第二参补回（spec 切批表原有、第九轮评估发现 plan 丢失）**：

```ts
@Processor(EXECUTION_QUEUE_NAME, { maxStalledCount: 1, lockDuration: 60_000 })
```

  类内追加 failed 钩子（照 `banner-cleanup.processor.ts:17-20` 先例——**双写：exec map + 意图表**，F13 修正"只写 exec map 不落表"的遗漏：SIGKILL 场景 processor catch 不执行，意图终态只能靠钩子）：

```ts
@OnWorkerEvent('failed')
async onFailed({ job, failedReason }: { job: Job<any>; failedReason: string }) {
  const { projectId, nodeId, intentId, intentRowId } = job.data ?? {};
  if (!projectId || !nodeId) return;
  await this.collabDoc.writeExecStatus(projectId, nodeId, { status: 'error', error: String(failedReason).slice(0, 200), intentId });
  if (intentRowId) await this.intentService.fail(intentRowId, String(failedReason)); // F13：意图终态必达
}
```

  （enqueue 时 job.data 增传 intentRowId=intent.id。）
  - `execution.module.ts` providers 增 GenerationIntentService + IntentReconcileService。
- **Step 4: 跑绿** + Commit `feat(collab): 批0.5-6 execution 全链挂意图表（幂等重放/双击409/failed 终态兜底/GET intents）`

**Task 0.5-7：客户端意图记录 + 每日资损对账 job**

- **Step 1: 实现**（`apps/web/src/utils/intentRecord.ts`）：

```ts
/** 批0.5：客户端意图记录（B1 同批硬约束）——失败重试复用同 intentId ⇒ 表命中 ⇒ 不双扣；
 *  新生成点击 rotate 新 id ⇒ 照常扣费。存 sessionStorage（第九轮评估：标签隔离+刷新存活两个语义同时满足——
 *  localStorage 会被同项目双标签共享导致同节点撞 id：同参静默变重放、异参吃 409；
 *  "关标签后新标签重试换 id"本就该是新意图）。R1c 落地后随本地记录器迁移。 */
const keyOf = (projectId: string, nodeId: string) => `flowweb:intent:${projectId}:${nodeId}`;
export function newIntentId(projectId: string, nodeId: string): string {
  const id = crypto.randomUUID();
  sessionStorage.setItem(keyOf(projectId, nodeId), id);
  return id;
}
export function currentIntentId(projectId: string, nodeId: string): string {
  return sessionStorage.getItem(keyOf(projectId, nodeId)) ?? newIntentId(projectId, nodeId);
}
```

（生成按钮调用点：grep `executionSocket` / fetch '/execution' 的发起处——新点击 `newIntentId`、失败态「重试」`currentIntentId`；发起时随 body/header 上送。INTENT_EXHAUSTED 处理：web 侧收到该 409 → 调 `newIntentId` rotate 并提示"请重新发起生成"〔免费重放上限到达，attempts≥3〕。）

- **Step 2: 实现**（`intent-reconcile.service.ts`——F12+F13 重写版：**两档三查**，修"RUNNING 孤儿把节点锁死 ≤24h"）：

```ts
/** 意图表对账与回收（F12 每日全量 + F13 活跃核验 5min）——R28 纪律：原生 setInterval+unref。
 *
 *  档一【活跃核验，每 5min】（partial unique 使同节点新意图被 RUNNING 孤儿 409 锁死——
 *        本档把锁死窗口从 24h 压到 ≤15min；@@index([status, updatedAt]) 让扫描近乎免费）：
 *    A. 有 jobId → 查 BullMQ 真实状态（禁"job 不存在即判死"——removeOnComplete {age:3600} 假阳性：
 *       已完成被清理的 job 查无，但意图可能已扣费有产物）：
 *       completed → 按产物回填 SUCCEEDED；failed/不存在 → 走 B 的三查裁决
 *    B. 无 jobId（同步路径 HTTP 内联）且 age>15min → 三查——**age 一律取 updatedAt**（rearm/续跑/CAS 扣费
 *       天然刷新它，防"分钟 14 重试被按 createdAt 判死"竞态；F13 补强）；isCharged=单入口谓词（流水按
 *       referenceId `intent:${intentId}` 精确查——0.5-9 切两阶段时只改此函数，reconcile 不重写第二遍）：
 *       ①isCharged && 产物/Media 已落 → SUCCEEDED 回填（resultRef 补写）
 *       ②isCharged && 无产物 → 退款事务（F13 补强：四写单 $transaction，幂等+归零）：
 *          守卫式 updateMany({where:{id, status:'RUNNING', updatedAt:{lt: now-15min}},   ← CAS 二次判龄（关死 rearm 竞态）
 *                            data:{status:'VOIDED', creditsConsumed: 0}})                ← 归零=CAS 扣费门不变量修复（退款+重试≠免费产品）
 *          count===1 才在同一事务内：按原扣费流水两池拆分逆向记账（type=refund——禁拿 creditsConsumed
 *          单值猜拆分）+ TeamMember.monthlyUsed 回滚；count===0 ⇒ 已处理/并发已抢（崩溃重扫不双退、
 *          先状态后退款不永失——QUOTA"throw 非 return"同课）+ 对账告警 Counter（日志带 intentId 可追溯）
 *          VOIDED 枚举由此获得写者，与 FAILED 分义：FAILED=执行失败（押金还押着——重试 alreadyCharged 免费续跑），
 *          VOIDED=系统回收（钱已退、creditsConsumed 已归零——重试正常扣费）
 *       ③未扣费 → VOIDED 免费放行（creditsConsumed 本就 0；用户重试=新意图）
 *
 *  档二【全量三方对账，每日】（键统一 intent: 后从启发式变精确 join）：
 *    SUCCEEDED 行 creditsConsumed vs TeamCreditTransaction（referenceId=intent:xxx）数额差异 → Counter+WARN
 *    （差异=资损前兆，SLO 计数——阈值上线前定）；终态行 N=7 天清理（F1 保留策略）；
 *    exec map 孤儿条目清理（F2 GC——nodes map 无该 nodeId 的 exec 条目，经 withDoc 删除）。
 *
 *  进程启动时全量扫一遍（天然覆盖"部署杀在飞任务"——pm2 restart 后第一时间回收）。
 *  顺手处置两个 @Cron 死文件：video-separate.cron（承载"陈旧任务对账+并发额度归还"——
 *  功能已被本服务档一吸收，删除并注记理由）/ team-subscription-expire.processor（确认无消费后删除）。 */
@Injectable()
export class IntentReconcileService implements OnModuleInit, OnApplicationShutdown {
  private timers: NodeJS.Timeout[] = [];
  onModuleInit() {
    void this.verifyActive();          // 启动全量扫
    const t1 = setInterval(() => void this.verifyActive().catch(warn), 5 * 60 * 1000);
    const t2 = setInterval(() => void this.reconcileDaily().catch(warn), 24 * 3600 * 1000);
    for (const t of [t1, t2]) t.unref?.();
    this.timers = [t1, t2];
  }
  onApplicationShutdown() { for (const t of this.timers) clearInterval(t); }
  // verifyActive()/reconcileDaily() 按 iamge 上述两档实现（~80 行）；退款走 team-credit 正向记账方法
}
```

- **Step 2b: 测试**——三查三态各一锚（F13 判据 ④：已扣+产物在→SUCCEEDED 回填；已扣无产物→VOIDED+退款流水+**creditsConsumed 归零**；未扣→VOIDED）；锁死窗口锚（RUNNING 孤儿 age>15min 后新 claim 不再 NodeBusy——**F13 判据 ⑤**）；启动扫描触发锚；**F13 补强四锚（第十轮）**：①退款幂等——同孤儿连续两轮 verifyActive 只退一次（第二轮守卫 count===0 零流水零回滚）②退款后同 intentId 重试 → consume 正常扣费（真值表 VOIDED 格——"退款+白送"必红）③rearm 竞态——updatedAt 新鲜（<15min）的 RUNNING 行三查零动作 ④退款两池拆分——逆向流水金额=原扣费流水的 credits/subscriptionCredits 各自拆分（非 creditsConsumed 单值）。
- **Step 3: 测试**——intentRecord 单测（rotate/复用语义）+ reconcile 三面各一条（mock prisma）。
- **Step 4: 跑绿** + `pnpm verify` + 完成记录表填 0.5 行（保留策略 N=7 天）+ Commit `feat(collab): 批0.5-7 客户端意图记录+两档三查对账 job`

**Task 0.5-8：意图表扩面 ai-image-edit + lighting（F13——五扣费点兑现，~1 天）**

- **Step 1: 写失败测试**——两模块 processor 各增：双击生成（同节点两个不同 intentId 并发）→ 第二个 409 NODE_BUSY（attempts:1 只堵队列重试，双击双扣只有意图表互斥能堵——A3 必红）；同 intentId 重放 → 零外呼零扣费返回既有。
- **Step 2: 实现**——三模块共用同一条链：
  - `ai-image-edit.controller.ts` 三端点：body 增 intentId（web 调用点随 0.5-7 intentRecord 上送）→ enqueue 前 `claim`（nodeId=body.nodeId、kind=outpaint/erase/redraw、paramsHash 用 0.5-2 白名单）→ `const job = await queue.add(...)` 后 **`await intentService.attachJob(intent.id, job.id)`**（F13 补强：不回写则 reconcile A 路径〔查 BullMQ〕对两模块永久失效，且与同步路径〔合法无 jobId〕不可区分——20min lighting 任务第 15min 被三查②误判 VOIDED、第 20min 照常扣费=资损盲区；claim→attach 间崩溃窗口由 15min 三查兜底）→ intentRowId 随 job.data 下传；
  - `ai-image-edit.processor.ts`：consume 调用带 `intentGuard`（0.5-4）；产物链序同 0.5-6 门序——`complete(media.id)` 返回 1 才 writeNodeData/emit（F13 补强——"看到产物 ⇒ 意图仍有效"）；catch 路径 `fail()` + `writeExecStatus error`；`@Processor` 第二参补 `{ maxStalledCount: 1, lockDuration: 60_000 }`；failed 钩子同 0.5-6 双写；
  - `lighting.controller.ts`/`lighting.consumer.ts` 同构（kind=lighting）；
  - web 侧：`getOrCreateIntentId` 调用点覆盖 image-edit/lighting 的发起按钮（grep `image-edit/`、`lighting/tasks` 的 fetch 处）。
- **Step 3: 跑绿** + Commit `feat(collab): 批0.5-8 意图表扩面三模块（五扣费点兑现+双击互斥）`

**Task 0.5-9：reserve→settle 两阶段扣费（spec F1"落地后首个 P1"——任务化，防静默掉落）**

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（冻结载体列〔GenerationIntent.reservedCredits 或 TeamCredit.frozen——Step 1 裁决〕+ TeamCreditTransactionType 增 `reserve`/`settle` 值——独立迁移，fresh replay 必验）
- Modify: `apps/api/src/modules/team/team-credit.service.ts`（reserve/settle/void 三方法）
- Modify: `apps/api/src/modules/execution/intent-reconcile.service.ts`（三查切两阶段口径——只改 isCharged/refund 单入口）

- **Step 1: 设计落位**（~半天）：consume 拆 `reserve(intentGuard, amount)`（事务内 CAS 门+冻结额+流水 type='reserve'）与 `settle(intentRowId)`（冻结核销 type='settle'）/`void(intentRowId)`（解冻+反向流水）——**余额不足在 reserve 即失败**（消灭"白付外呼"沉没面）；组执行"前 N 已扣第 N+1 失败整批 return"改为逐节点 reserve→执行→settle（消灭"组执行部分成功"沉没面）。**三条设计约束（第十轮评估——executor 必读，防按 0.5-4 既有 CAS 语义惯性实现）**：①**reserve 事务内置位 CAS 标记**——冻结载体用列不用 PENDING 状态（已删，不复活）；reserve 不置位则 stalled 同 job 重入二次通过 CAS 门=双冻结；②**reserve-only 行的退款=解冻非补记**——档一三查经 isCharged 单入口切到两阶段口径后（isCharged=已 reserve），void 走解冻+反向 reserve 流水，不得再走 refund 正向记账（否则双倍回滚）；③**组执行 void 边界**——前 N 已 settle 保留产物；第 N+1 reserve 失败即 void 该行意图（重试=新意图照常扣费），与 FAILED 分义不混。**实现顺序契约：0.5-7 的 isCharged/refund 单入口在本任务一次性切换——reconcile 不重写第二遍（防两次返工）。**
- **Step 2: 测试**——余额不足 → 外呼零调用（reserve 先行）；组执行第 N+1 失败 → 前 N 已 settle 保留产物、第 N+1 零扣费；void 后重试 → 新意图照常；**reserve 孤儿（reserve 后进程死、无 settle/void）→ 档一第四查按超龄解冻回收（冻结额不永久占用）**；stalled 同 job 重入 → 冻结只发生一次（约束①锚）；reserve-only 退款走解冻而非 refund 补记（约束②锚）。
- **Step 3: 跑绿** + Commit `feat(collab): 批0.5-9 reserve→settle 两阶段扣费（余额不足不再白付外呼）`

---

## 决策门 B（F6）：WebSocketPolyfill 自定义传输 spike（批 1 前，1h）

**裁决问题**：恢复原语形态——自持 ~100 行传输薄层（`transport.reconnect()`，㉕/㉝ 语义归我方）vs 照 v5.9 kick 方案。

**已核实依据**（写死，免重验）：esm:171 构造器 `WebSocketPolyfill = configuration.WebSocketPolyfill ?? WebSocket`、:292 `new WebSocketPolyfill(url)`——传**类**不触发 ㉔ 禁令（㉔ 禁的是 `websocketProvider` **实例**注入）。

**Task B-1：兼容性 spike（丢弃式，不写生产代码）**

- **Step 1: 写 spike 夹具**（`apps/api/src/modules/collab/ws-polyfill.gate.spec.ts`）：

```ts
import { describe, it, expect } from 'vitest';
import { Server } from '@hocuspocus/server';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

/** F6 spike：自定义 WebSocket 类与库假设的兼容性。通过 ⇒ 批1 恢复原语改 transport.reconnect()；
 *  不通过 ⇒ kick 方案（合理退路）。验证四点：构造签名/onOpen 派发/onClose 注入（4408 kick）/destroy 清理。 */
class PinnedWebSocket extends WebSocket {
  static created = 0;
  constructor(url: string) { super(url); (PinnedWebSocket as any).created++; }
}

describe('F6 WebSocketPolyfill spike', () => {
  it('自定义类全程可用：连接/同步/注入 onClose 触发重连/销毁无泄漏', async () => {
    const port = await getFreePort(); // 照 health-carrier.gate.spec 的 freePort
    const server = new Server({ port, async onAuthenticate() { return {}; } });
    await server.listen();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${port}`, name: 'gate:polyfill',
      document: new Y.Doc(), token: 'gate',
      WebSocketPolyfill: PinnedWebSocket as any,   // 关键：类注入
    } as any);
    await new Promise<void>((r) => provider.on('synced', r));
    expect(PinnedWebSocket.created).toBe(1);
    // 注入 kick：自定义类实例上派发 CloseEvent 形态
    const ws = (provider as any).configuration.websocketProvider as any;
    (provider as any).onClose?.();
    ws.onClose({ event: { code: 4408, reason: 'gate' } });
    void ws.connect();
    await new Promise<void>((r) => setTimeout(r, 5000));
    expect(PinnedWebSocket.created).toBeGreaterThanOrEqual(2); // 重连走了自定义类
    provider.destroy();
    await server.destroy();
  }, 30000);
});
```

- **Step 2: 跑并判定**——四点全过 ⇒ 结论"改道 transport"（批 1 Task 1-3 的瞬态分支换成自持传输薄层方案，工作量 +~100 行，㉕/㉝ 相关约束整体删除）；任一失败 ⇒ kick 方案。**通过权重（第九轮评估抬高）：即使四点只过三点、补齐成本 +50 行，也倾向改道传输层**——kick 这条路依赖的 ㉕/㉝ 两条契约锁本身就是"库行为不可依赖"的实证，留越久越危险（pin+契约锁夹具只是兜底不是豁免）。**结论写完成记录表（门 B 行）**，批 1 按结论走对应分支（两分支代码都给在 Task 1-3）。
- **Step 3: Commit** `test(collab): F6 WebSocketPolyfill spike 夹具（决策门 B）`

---

## 批 1：两级恢复原语 + 恢复门 + 执行态客户端半边

**Files:**
- Create: `apps/web/src/stores/connectionMachine.ts`（纯函数 reduce——阈值/分级/jitter/冷却表驱动）
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（watchdog tick / recoverConnection / rebuildPending / createProvider 工厂+bindProviderListeners / session 对象化 / 1012 / awareness 播种与自愈 / R33）
- Create: `apps/web/src/utils/collabDiagnostics.ts`
- Modify: `apps/web/src/components/CanvasTopBar.tsx:29`（R33）
- Modify: `apps/web/src/components/VideoGenNode.tsx` 等 AI 状态读点（B2 合并视图）
- Test: `canvasCollabRuntime.conn.spec.ts` 扩展（红2 全组）+ `apps/api/src/modules/collab/collab.gateway.spec.ts`（库行为锚 5 条）

**Task 1-1：connectionMachine 纯函数 + watchdog tick + 恢复门**

- **Step 1: 写失败测试**（spec 红2 组逐条：快线 15s / unhealthy 45s 含从未健康初值 / jitter / 冷却 ≥15s / 退避 5→10→20→30 封顶永不停止 / 打扰分层 45s 轻提示·90s 横幅 / terminal·hidden·offline 零自动——装置用 fake timers 驱动 reduce）。断言源=spec 判据表"红2-恢复组"行（executor 逐条照抄判据栏写用例）。
- **Step 2: 跑红** → **Step 3: 实现**：

```ts
// apps/web/src/stores/connectionMachine.ts
/** 批1：连接状态机判定纯函数（表驱动——阈值/分级/jitter/冷却可枚举可回归）。
 *  纯度纪律：jitter 阈值由 runtime 侧生成后**作为入参传入**（gateMs/cooldownMs）——本模块零 Math.random，测试可注入固定值。
 *  电平输入（禁读派生 connStatus——黑洞下恒 connecting）；输出=恢复动作+UI 级别。 */
export const TICK_MS = 3_000;
export const STALE_INBOUND_MS = 45_000;
export const FAST_LANE_MS = 15_000;
export const BANNER_MS = 90_000;
export const RECOVER_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000]; // 封顶永不停止

export interface MachineInputs {
  now: number;
  healthy: boolean;                        // recomputeConnStatus 同式合取 + now-lastInboundAt<=45s（runtime 算好传入）
  fastLaneEligible: boolean;               // lastWsStatus==='connected' && !isAuthenticated && now-lastConnectedAt>15s（runtime 算好传入）
  gateMs: number;                          // 本周期抖动后的 unhealthy 门限（45s+rand(0,15s)——runtime 生成）
  cooldownMs: number;                      // 本周期抖动后的冷却（≥15s+jitter——runtime 生成）
  hydrationPending: boolean;
  unhealthySince: number | null;           // 初值=session.startedAt（从未健康也计时）
  recoveryAttempts: number;
  lastRecoveryAt: number;
  terminal: boolean; hidden: boolean; offline: boolean;
}
export type MachineOutput = {
  action: 'none' | 'recover';
  ui: 'ok' | 'hint' | 'banner';            // 打扰分层
  unhealthySince: number | null;           // healthy 跃迁清零；从未健康 → 维持初值计时
};

export function reduce(s: MachineInputs): MachineOutput {
  const unhealthySince = s.healthy ? null : (s.unhealthySince ?? s.now);
  const elapsed = unhealthySince == null ? 0 : s.now - unhealthySince;
  const gateHit = !s.hydrationPending && unhealthySince != null && elapsed > s.gateMs;
  const eligible = s.fastLaneEligible || gateHit;
  const cooldownOk = s.now - s.lastRecoveryAt >= s.cooldownMs;
  const suppressed = s.terminal || s.hidden || s.offline;
  const ui = s.healthy ? 'ok'
    : (elapsed >= BANNER_MS || s.recoveryAttempts >= 3 ? 'banner'
      : (elapsed >= STALE_INBOUND_MS ? 'hint' : 'ok'));
  return {
    action: !s.healthy && eligible && cooldownOk && !suppressed ? 'recover' : 'none',
    ui, unhealthySince,
  };
}
```

runtime 侧 watchdog（initCollab 内）：

```ts
// 批1：心跳 3s——顶部防御 + tick-gap clamp（hidden 期间 timers 冻结，恢复后首 tick 的 now-lastInbound 直接判）
let unhealthySince: number | null = session.startedAt; // 从未健康也计时（v5.4）
let recoveryAttempts = 0; let lastRecoveryAt = 0;
const heartbeat = setInterval(() => {
  const now = Date.now();
  const healthyNow = /* recomputeConnStatus 同式 */ computeHealthy(now);
  // 组装完整 MachineInputs 逐字段（禁 as any——占位草图会被 executor 照抄，第十轮 N7）。
  // cooldownMs 在此消费 RECOVER_BACKOFF_MS：5→10→20→30 封顶 + 0~5s jitter（退避数组在 runtime 侧接线，reduce 只收参数）
  const inputs: MachineInputs = {
    now,
    healthy: healthyNow,
    fastLaneEligible: lastWsStatus === 'connected' && provider !== null && !provider.isAuthenticated && now - lastConnectedAt > FAST_LANE_MS,
    gateMs: STALE_INBOUND_MS + Math.random() * 15_000,
    cooldownMs: RECOVER_BACKOFF_MS[Math.min(recoveryAttempts, RECOVER_BACKOFF_MS.length - 1)] + Math.random() * 5_000,
    hydrationPending: useCanvasStore.getState().hydration === 'pending',
    unhealthySince,
    recoveryAttempts,
    lastRecoveryAt,
    terminal: useCanvasStore.getState().wsAuthNotice?.terminal === true,
    hidden: document.hidden,
    offline: typeof navigator !== 'undefined' && !navigator.onLine,
  };
  const out = reduce(inputs);
  if (healthyNow) { unhealthySince = null; recoveryAttempts = 0; }
  else if (out.unhealthySince != null) unhealthySince = out.unhealthySince;
  if (out.action === 'recover') { recoveryAttempts++; lastRecoveryAt = Date.now(); void recoverConnection(); }
  updateConnectionUi(out.ui);   // hint=非阻断"正在重连…"；banner=sessionLost 横幅
}, TICK_MS);
heartbeat.unref?.();
```

（awareness 本地态自愈/visible 宽限 5-10s/offline 抑制/online 复评/hidden 挂起——照 spec 修 B §1 全段落位；红2-awareness/红2-健康前提 两条判据照 spec 写。）
- **Step 4: 跑绿** + Commit `feat(collab): 批1-1 恢复门+心跳+connectionMachine 纯函数（快线/unhealthy/jitter/分层）`

**Task 1-2：1012 计划内重启短退避**

- **Step 1: 实现**（runtime 内）：

```ts
provider.on('close', ({ event }: any) => {
  recomputeConnStatus();
  if (event?.code === 1012) {          // 服务端 shutdown 主动 close（批3 落地 1012 前不会出现——分支先在）
    plannedRestartUntil = Date.now() + 30_000;
    setTimeout(() => void (provider?.configuration.websocketProvider as any)?.connect?.(), 1000 + Math.random() * 2000); // 1~3s 首连
  }
});
```

横幅抑制：connectionMachine 的 ui 分级在 `plannedRestartUntil` 窗口内强制 'ok'→'hint'（不弹 banner）。判据：收到 1012 后 1~3s 内首重连发出、该窗口无失联横幅（fake timers 用例）。
- **Step 2: 测试+Commit** `feat(collab): 批1-2 1012 短退避+横幅抑制窗口`

**Task 1-3：recoverConnection 两级原语（含门 B 两分支）**

- **Step 1: 写失败测试**——spec 红2-恢复组余下判据：级别选择（`!provider.isAttached || !ws.shouldConnect` ⇒ 终态重建——瞬态 kick 在此是空操作必红）；瞬态=实例不变（provider 引用同一、六监听不重挂、消息队列保留）；终态=实例变更+同 doc+本地编辑在+hydration 保持+clock 播种（读 destroy 后值）；单飞互斥；用户点击同原语。
- **Step 2: 跑红** → **Step 3: 实现**（runtime）：

```ts
let recovering = false;
export async function recoverConnection(): Promise<void> {
  if (recovering) return;                     // 单飞
  const p = provider; if (!p) return;
  const ws: any = (p as any).configuration.websocketProvider;
  const terminal = !p.isAttached || !ws?.shouldConnect;   // 级别按状态选（v5.4 G1——结构而非意图）
  try {
    recovering = true;
    if (terminal) {
      // —— 终态：会话级重建 ——
      const d = doc!;
      const clockSeed = (() => { p.destroy(); return readClockAfterDestroy(p); })(); // destroy 后读旧实例 meta（N+2——㉖）
      createProvider(d);                       // 工厂：新 provider 绑同 doc（六监听单函数 bindProviderListeners）
      seedAwarenessClock(clockSeed);           // meta.set(clientID, {clock: 种子, lastUpdated})
      awarenessBridge?.attach(provider!);
      replayLocalAwareness();                  // setLocalUser(lastLocalUser)+setLocalState(上次完整态)
      rebuildPending = true;                   // 旧实例 hasUnsyncedChanges 不可读——标记武装
    } else {
      // —— 瞬态：传输级 kick ——（门 B 结论若为"改道"：本分支整体替换为 transport.reconnect() 并删㉕/㉝ 约束）
      (p as any).onClose?.();                  // 复位 isAuthenticated/synced（4408 不 emit close——L13）
      ws.onClose({ event: { code: 4408, reason: 'app-recovery' } });
      void ws.connect();                       // 无条件（㉝）——清陈旧 cancelWebsocketRetry+防挂起；与 onClose 同同步栈
    }
  } finally { recovering = false; }
}
```

配套：`createProvider(doc)` 工厂 + `bindProviderListeners(p)`（六监听单函数——status/message/synced/authenticated/authenticationFailed/close 全收口）+ `readClockAfterDestroy`（`p.awareness.meta.get(clientID)?.clock ?? 0`）+ `seedAwarenessClock`（新实例 `awareness.meta.set(clientID, { clock, lastUpdated: Date.now() })`）。守卫：terminal/document.hidden/offline 不下手（回前台/上线复评——visibilitychange/online 监听模块级一次）。
- **Step 4: 跑绿** + Commit `feat(collab): 批1-3 recoverConnection 两级原语（kick/重建+clock 播种/级别选择）`

**Task 1-4：rebuildPending 标记制（实例绑定）+ hasUnsyncedCanvasChanges 完整谓词**

- **Step 1: 测试**（spec 护栏组判据——真库事件序建模：终态重建置位 → synced（计数仍 1）仍真 → `unsyncedChanges{number:0}` 才解除；旧实例 emit 不清新实例标记）。mock 补：startSync 置 1、synced 时计数仍 1、decrement 归零同置 synced=true（HP:333-335）。
- **Step 2: 实现**：

```ts
let rebuildPending = false;
// 挂当前 provider（实例绑定）：bindProviderListeners 内
p.on('synced', () => { /* 水合驱动维持 */ });
p.on('unsyncedChanges', ({ number }: any) => { if (number === 0 && p === provider) rebuildPending = false; });
// 3s tick 兜底：provider?.hasUnsyncedChanges===false && provider.isSynced → 清
export function hasUnsyncedCanvasChanges(): boolean {
  return rebuildPending || (provider?.hasUnsyncedChanges ?? false);
}
```

- **Step 3: 跑绿** + Commit。

**Task 1-5：awareness 即刻播种/自愈 + bridge 稳定对象化 + session 对象化 + R33 + collabDiagnostics**

- 按spec 修 A/修 B §1 与 R24/R33 落位：openSession 即刻 `setLocalState`（authUser 或占位）；tick 自愈 `getLocalState()==null → 重放 lastLocalUser 完整态`（禁 `{}`）；AwarenessBridge 改自持 `Set<cb>`+`attach(p)` 迁移+判空；模块变量收 `let session: Session | null`（epoch 校验读写）；CanvasTopBar:29 排除本机 `clientID !== awareness.clientID`；collabDiagnostics 环形缓冲（ws_status/recovery/watchdog_fire/auth_reject/write_reject）+prod 计数+kill switch（env `COLLAB_AUTO_RECOVER=off` 时 tick 只记录不重建）。
- 判据照 spec：红2-awareness（重放完整态+200s 无循环）、红2-健康前提两变体、presence 两验收（30s outdated/断开即时清——真协议组）。
- Commit `feat(collab): 批1-5 awareness 播种自愈+bridge/session 对象化+R33+诊断环形缓冲`

**Task 1-6：执行状态恢复客户端半边（B2 合并视图）**

- **Step 1: 测试**——spec 执行态组客户端侧：①exec map 变更（服务端写）→ useNodeStore.status 到达（桥监听 `doc.getMap('exec')` observeDeep）；②读合并视图 `execStatusOf(nodeId) = exec[id]?.status ?? data.status`（isImageCompletedNode 等读点换源——grep `data.status`/`isImageCompletedNode` 于 apps/web/src 改）；③终态优先不回退；④刷新/断连后 `GET intents?projectId&nodeId` 对齐（loading 且无 exec 条目 → 查表终态写 UI）；⑤storyboard/裁剪/标注/拼接客户端终态刷新仍在（回归锚——这些写 data 不受影响）；⑥visibilitychange 回前台对齐一次。
- **Step 2: 实现**——runtime 内 exec 监听（`doc.getMap('exec').observeDeep` → 投影进 useNodeStore 新字段 `execStatus`）+ `execStatusOf` 工具 + 发起处带 intentId（Task 0.5-7 接线点）+ 恢复对齐函数（connect 边沿+visibilitychange 调 GET intents）。
- **Step 3: 跑绿** + Commit `feat(collab): 批1-6 执行态客户端半边（exec 合并视图+intents 恢复对齐+终态优先）`

**Task 1-7：库行为锚 5 条 + 批尾验收**

- **Step 1**: `collab.gateway.spec.ts` 增补 fixture 回放锚（onClose 不 emit 'close'/destroy 双推 clock 仅首帧发布/send 未 attach 静默 return/SS1 应答帧序先 SS1 后 SS2/synced 时计数=1+decrement 归零置 synced=true）——fixture JSON 固化供单测重放（G24）。
- **Step 1b: socket.io 退役评估前移至本批末**（spec 批 1 行 v5.10 后增——三评估共识）：emitNodeStatus 已随批 0.5 扩面全改 writeExecStatus → 盘点 /execution 通道剩余载荷（grep emitNodeStatus/emitTrimStatus/emitSeparateStatus/emitStitchStatus/emitExecutionComplete 调用点清单文件化）→ "退役 or 保留+冻结"结论回写完成记录表（退役本身另立批，不塞批 1）。越早退役 cors/join 鉴权/adapter 不对称三个 tech-debt 越早消失。
- **Step 2**: 浏览器验收（spec 浏览器验收行逐条：重启 API 恢复链/杀 API 90s 横幅/断连期编辑重连仍在/恢复后 presence 两级各验/后台标签 5 分钟/首帧黑洞 routeWebSocket 挂起 95s/AI 执行中重启对齐/慢任务 >2min 无墙钟误判）——dev 手动跑，结果记完成记录表。
- **Step 3**: `pnpm verify` + 完成记录表填批 1 行 + Commit。

---

## 批 2：hydration 四态 + VIEWER 双层 + redirect 前移

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts`（hydration 四态替换 isHydrating + collabReadOnly + wsAuthNotice/httpExpired）
- Create: `apps/web/src/stores/syncStatus.ts`（canEdit 纯函数）
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（openSession/completeHydration 驱动 hydration + readOnly doc 零写门 + 异步落地单列）
- Modify: `apps/web/src/pages/canvas/page.tsx`（蒙层分型+R27 首屏可达性）+ 四 ConfigPanel + `nodeStore.ts:243` 桥改 action
- Create: `apps/web/src/utils/loginRedirect.ts` + Modify `RequireAuth/RequireAdmin/CanvasTopBar/login/register`
- Modify: `apps/api/src/modules/collab/*`（doc meta schemaVersion 字段）

**Task 2-1：hydration 四态 + canEdit + 蒙层（含 isHydrating 删除）**

- **Step 1: 重跑承重数字**（spec R13 纪律）——`grep -rn "isHydrating" apps/web/src --include="*.ts*" | grep -v test` 列出生产写/读点；`grep -rl "vi.mock('@/stores/canvasStore')" apps/web/src | wc -l`（预期 30——mock 计数以现场为准）。
- **Step 2: 写失败测试**——spec hydration 组+canEdit 门组判据：四态定向断言（getInitialState 'idle'/openSession 首行 'pending'/synced→'ready'/超时→'failed'/destroy→'idle'）；canEdit 合取（ready && !collabReadOnly && !terminal）+ httpExpired 反向断言；粘滞（openSession 初值 true/onClose 后仍 true/authenticated(scope) 权威覆盖/登出复位）；idle→蒙层+dev console.error（非抛错）。
- **Step 3: 实现**——canvasStore：

```ts
hydration: 'idle' as 'idle' | 'pending' | 'ready' | 'failed',  // 默认 idle（无会话）；openSession→pending；synced→ready；10s 超时→failed；destroy→idle
wsAuthNotice: null as { reason: CollabAuthReason; terminal: boolean } | null,
httpExpired: false,
collabReadOnly: true,   // 会话级粘滞初值 true（只读保守——HTTP 无 role 字段 R30；authenticated scope 权威覆盖）
```

`syncStatus.ts`：

```ts
export const canEdit = (s: CanvasState) =>
  s.hydration === 'ready' && !s.collabReadOnly && s.wsAuthNotice?.terminal !== true;
```

isHydrating 字段删除：写点全改 setHydration 四态；两生产读点（viewportPersistence.ts:14/useGroupKeyboard.ts:51）改 `hydration !== 'ready'`；点名更新的 mock 测试文件（useGroupKeyboard.test 等按 Step 1 清单）。蒙层：page.tsx 按 idle/pending/failed 分型（idle=「画布会话未建立」+dev console.error；pending=「正在同步」非阻断骨架；failed=「重试连接/刷新」行动）+ R27 首屏可达性（!projectId 分支按 hydration 分档——projectId/name 提前落地的二选一按实读 page.tsx 定）。
- **Step 4: 跑绿** + Commit `feat(collab): 批2-1 hydration 四态+canEdit+蒙层分型（isHydrating 删除）`

**Task 2-2：VIEWER 双层（doc 硬门 + store wrapper + ESLint 门）**

- **Step 1: 测试**——spec VIEWER 组+canEdit 门组三类入口判据：readOnly ⇒ ①cs 拖拽/doc 零写+store 零变更 ②组配置面板同 ③AI 状态落地同（第三类现零测试）；断连窗口仍只读（粘滞锚）。
- **Step 2: 实现**：
  - 第一层（硬门）：bindBridge 两订阅回调 + S1 回写点 + syncAutoEdgesToDoc 调用点统一前置 `if (!canEdit(useCanvasStore.getState())) return;`（readOnly 会话 doc 零写含 system intent——几何修正在 store 层完成）；
  - 第二层（UX 预检）：ns 内容写收口 wrapper——四 ConfigPanel 10 处（AudioConfigPanel:67/93/146/200、ImageConfigPanel:58、TextConfigPanel:62/88/147/200、VideoConfigPanel:185）+ nodeStore.ts:243 桥直灌改走 action 入口（`nodeStore.ts` 内 `applyNodeDataPatch(nodeId, patch)` action，canEdit 假时早退+toast 节流）；page.tsx:92 清空/runtime hydrate 生命周期豁免；
  - ESLint 正式化：`apps/web/eslint.config`（若无则建 flat config）加 no-restricted-syntax 规则——`useCanvasStore.setState(`/`useNodeStore.setState(` 仅白名单文件（store 文件/canvasCollabRuntime/nodeStore 桥/page 生命周期）——lint-gate 的 C 条同步退役或保留双保险。
- **Step 3: 跑绿**（含"readOnly 拖拽零写 doc"必红转绿）+ Commit `feat(collab): 批2-2 VIEWER 双层强制点（doc 硬门+store wrapper+ESLint setState 门）`

**Task 2-3：异步落地单列 + schemaVersion + redirect 收口**

- 异步落地（R20）：canEdit 假时生成回调 addChildNode(s) 不回弹丢弃——toast「生成完成，但画布会话不可用，未插入画布——可从素材库手动插入」+ addChildNode 静默 return null 修复；判据照 spec 异步落地组。
- schemaVersion：doc meta（`doc.getMap('meta').set('schemaVersion', 1)` 于 fillDoc/openSession）——R1c 前置物，判据：刷新后 meta 字段仍在。
- **redirect 收口**（v5.10 前移）：`loginRedirect.ts`：

```ts
export function loginUrl(returnTo?: string): string {
  const target = returnTo ?? location.pathname + location.search;
  return `/login?next=${encodeURIComponent(target)}`;
}
export function resolvePostLoginTarget(next: string | null): string {
  // 17 条矩阵：白名单路径前缀（/canvas/projects/:id 等）→ 透传；非白名单/外链/异常 → '/works'
  // 静态断言：login/register/RequireAuth/RequireAdmin/CanvasTopBar 零硬编码 '/login'/'/canvas' 字面量
}
```

消费收口：login/register/RequireAuth/RequireAdmin/CanvasTopBar 五处换调；e2e fixture 复核（R9——@deprecated AuthModal 选择器依赖若有断言更新）。判据：redirect 组 17 条矩阵 + 三处裸跳转收口静态断言 + 批 2 终态蒙层「新标签登录」返回原画布链路。
- Commit `feat(collab): 批2-3 异步落地单列+schemaVersion+redirect 收口（前移自批6）`

---

## 批 3：服务端三件套 + reason 五档 + B6 Redis 生命周期（可与批 1/2 并行）

**Files:**
- Modify: `packages/shared/src/*`（CollabAuthReason 五值 + dist 重建）
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（reason/. close(1012)/8s race/sweep/touch 接入/closeTeamDocuments/persist-status 退避/env 接线/doc epoch）
- Create: `apps/api/src/auth/session.service.ts`；Modify `auth.guard.ts`/`auth.service.ts`
- Modify: `apps/api/src/filters/http-exception.filter.ts`（errorCode 透出）+ `apps/web/src/api/client.ts`（apiFetch 不丢 status）+ 画布 2 处裸 fetch 收编 + me 探活
- Modify: `apps/api/src/app.module.ts` + 各 Redis 工厂（B6 DI 收口）
- Test: 真协议 12 条（collab.gateway.spec 扩展）+ 服务端组判据

**Task 3-1：reason 五档 + 终态白名单 + onLoadDocument try/catch**

- shared 增 `CollabAuthReason = 'unauthenticated' | 'session-expired' | 'not-found' | 'forbidden' | 'db-unavailable'`（const-object + 派生 union + dist 重建进 task）；gateway 三个裸 throw（:91/:97/:101）改带 `.reason` 的类型化错误（`Object.assign(new Error(msg), { reason })`——hooks 链原样 rethrow，A1 已核实 .reason 直达客户端）；鉴权期 DB 调用包 try/catch → db-unavailable；onLoadDocument 补 try/catch → db-unavailable；终态白名单=显式四档（未打标一律瞬态桶）。
- 判据：红3/红3-r 五档矩阵（真协议组④ DENY{reason} 透传且 socket 不关）。
- Commit `feat(collab): 批3-1 reason 五档+终态白名单+loadDocument 兜底`

**Task 3-2：shutdown 有界化 + close(1012) + B6 Redis 收口**

- 实现三件：
  1. `new Server({ ..., stopOnSignals: false })`（默认 true 会 process.exit(0) 抢跑 Nest drain 链）；
  2. 关停前对存活连接 `webSocket.close(1012, 'service restart')`——自遍历 `this.server.hocuspocus.documents` + `document.connections` **先复制后关**（库不暴露清单）；
  3. `onApplicationShutdown = Promise.race([server.destroy(), 8s 超时])` + 超时点名 doc + metric（总预算 ≤8s 计入 Redis disconnectDelay 累计）。
- B6：Redis 13 实例统一 DI token（`REDIS_CLIENT` 复用/新增专用 token）+ `onApplicationShutdown disconnect`；拔除 `auth.service.ts:5` 硬编码 `new Redis({host:'localhost'})`（统一 env.REDIS_URL）。实例清单现场重跑：`grep -rn "new Redis" apps/api/src`（spec 定案 13——以现场为准）。
- 判据：deploy 不再挂（本地 `kill -TERM` 模拟 ≤8s 退出+进程退净——B6 修的是 8s 后退不出）；真协议组②。
- Commit `feat(collab): 批3-2 shutdown 8s race+1012+B6 Redis 生命周期收口`

**Task 3-3：SessionService.touch + AuthGuard 修正 + 401 契约 + me 探活**

- `session.service.ts`：

```ts
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}
  /** better-auth 式滑动续期：session 年龄 > updateAge（1d）即续——expiresAt 顺延 7d。
   *  仅未过期能话（过期一律终态禁复活）；HTTP 路径 touch 后 res.cookie(新 maxAge)——
   *  WS 路径只能 touch DB（cookie 靠画布页 15min /api/auth/me 探活——F8）。 */
  async touch(token: string): Promise<Session | null> { /* findUnique→未过期且 age>updateAge→update expiresAt */ }
}
```

- auth.guard/auth.service/collab.gateway 三处手写 `prisma.session.findUnique` 统一走 touch；AuthGuard 单例 PrismaClient + DB 异常不吞 401（503 语义或排除在 401 横幅外）；COOKIE_OPTIONS 与 SESSION_COOKIE_OPTIONS 同批统一（secure/httpOnly 对齐）。
- filter 透 errorCode（HttpExceptionFilter 调 getResponse() 透出——37 处 BusinessException 现全丢，批3 一次透出、消费面只做 collab 档位）；apiFetch json.code!==0 不再丢 HTTP status；画布 2 处裸 fetch（page.tsx:46/ProjectTitle.tsx:40）收编 apiFetch；画布页 15min 静默 me 探活（unref+hidden 暂停）。
- 判据：服务端组④ touch 后活跃用户 session 被续期（红测）；apiFetch 契约单测。
- Commit `feat(collab): 批3-3 SessionService.touch 三处统一+401 契约+me 探活`

**Task 3-4：sweep + closeTeamDocuments + env 接线 + persist-status + 批尾**

- sweep（灰度默认关）：gateway 内原生 `setInterval(...).unref()` 60s 遍历——`sessionExpiresAt < now` 时**先复验**（session+teamMember 查询——顺手关能力 latch 债）→ stateless 预通知 `{type:'session-expiring'}` → 客户端 flushPendingUpdates → 5s grace → `connection.webSocket.close(4401, 'session-expired')`（禁 Connection.close——L6 僵尸；调用处自行 catch）；复验异常 fail-open 但连续 5 次/5min 仍关 + metric。判据：服务端组①（含灰度锚"关=零行为差异"）。
- closeTeamDocuments：解散事件逐连接补 `connection.webSocket.close()`（自遍历先复制）——判据⑥解散 ≤15s 恢复。
- env 接线：COLLAB_DEBOUNCE（dev 1000/prod 2000）+ maxDebounce ≤ debounce×1.5 + COMPACT_THRESHOLD 改时间门限（≥60s）或字节 + COLLAB_TIMEOUT 接线（双语义注记——用例注入小值时握手超时+检查周期一起变小）。
- persist-status 电平 + 退避重试：storeDocument 成功/失败转折点 `Document.broadcastStateless({type:'persist-status',healthy})`；失败后排有界退避（1s/2s/5s/15m/30s 上限 5 次 unref、shutdown 清、成功广播 healthy、覆盖 doc 级+stash projectId 级两阶段——F2 exec 投影修复同款机制接入点）+ 新连接补推 Connection.sendStateless；客户端只驱动横幅/诊断（不进 hasUnsavedWork）。
- doc epoch 字段（服务端 onAuthenticate 写 meta）+ canvas_doc 大小 gauge。
- 判据：真协议 12 条全过 + 服务端组；批尾 `pnpm verify` + 完成记录表。
- Commit `feat(collab): 批3-4 sweep+1012 收尾+env 接线+persist-status 退避（批3 完）`

---

## 批 4a：读路径归一 + 真不变量 + 双端 quiescence（与 getMap 门同批）

**Files:** `apps/web/src/utils/normalizeCanvasRecord.ts`（或落 ydocBuilder）、`apps/web/src/stores/canvasCollabRuntime.ts`、测试。

- 读出口归一：`readCanvasFromDoc` 输出过 `normalizeCanvasRecord`（消除"null 键真删 vs normalize 真删键"形状差）——写侧 projectCanvasNodes→normalize 同形；
- 真不变量：读归一后断言 `projectionFromDoc(doc) ≡ storeProjection()`（测量点=一次 apply 周期末尾含 S1 补跑；dev 断言双向、prod 只 log+metric）——**非恒真式**（红1-不变量判据）；**shadow 排除条款（第九轮评估——消除与批 5 的时序矛盾）**：批 5 删信箱前 doc 仍含 shadow- 节点而 store 投影经 isShadowOnlyEvents 挡在其外——不变量**两侧都显式过滤 `/^shadow-/` 键**后断言（否则从第一天起对每个含影子 doc 恒假，安全网失效/executor 被迫放宽断言）；
- 双端 quiescence：两端并发 burst 后 N ms 内 doc 写次数归零 + 两 doc/store 相等（判据=写放大/乒乓可机检——applyGroupDerivations/applyGroupFrame 是"派生写 doc"写者）；
- getMap 三文件门复核（批 0e 已建——本批确认 exec 读点收口后仍三文件+runtime）。
- 判据：红1-不变量 + quiescence；Commit `feat(collab): 批4a 读归一+真不变量+quiescence（安全网先行）`

## 决策门 C（F5）：意图漏斗 spike（gating 批 4b，1~2 天）

**裁决问题**：批 4b 走意图漏斗（action→doc 意图直写+store 投影回填，删 committed/leafDiff/投影对账/applyRemote latch 四件套）vs diff 引擎+弃用 ADR。

- **Spike 内容**：最活跃三类变更（add/update/delete node、edges、ConfigPanel 写）各选一代表改"action 直写"：
  1. 写面枚举核对：`grep -rn "syncStoreToDoc\|Origin.LocalUser" apps/web/src --include="*.ts"` 现场重跑；
  2. 三类各实现 `applyIntentToDoc(doc, intent, origin)` 最小版（addNode/updateNodeData/deleteNode/moveNode/upsertEdge/deleteEdge 六 action）+ store 投影回填点；
  3. 估算全量迁移成本（剩余写点数×单位成本）vs diff 引擎（committed 基线+leafDiff+latch+对账四件实现成本）。
- **判据（可行性）**：①六 action 覆盖三类无残留旁路 ②VIEWER doc 硬门零改动仍成立（都走 action=同构）③成本比 ≤ ~1.5×。**架构权重（第九轮评估）**：27+ 写点 action 化是把本仓从"全量同步+删除扫描"结构性反模式里捞出来的唯一根治路径——diff 引擎只是把同一反模式做得更精细；门 C 比较的不只是成本，还有终局架构，成本比接近时**必须倾向漏斗**。
- **baseline 存续条款（第九轮评估）**：0b deletion baseline 的存续绑定在门 C 选"漏斗"上——**若门 C 裁走 diff 引擎分支，必须同时给出 baseline 的替代删除语义**（committed 基线本身就是答案——delta 写的删除半边回归 committed 驱动）**或 0b 升级方案**，否则一个靠"上次投影"猜测删除意图的间接层会成为常驻机制（正是要杜绝的形态）——无此条款则成本比再高也倾向漏斗分支。
- **结论回写**完成记录表门 C 行（含成本比数据+baseline 条款裁决）；可行→批 4b 走漏斗分支，不可行→diff 分支+**显式 ADR 弃用计划**（触发条件+拆除路径，防"非终局"成永久遗产）+baseline 条款裁决。

## 批 4b：按门 C 结论执行（两分支预写）

**分支 漏斗（可行）**：
- Create: `apps/web/src/stores/canvasIntents.ts`（六 action + applyIntentToDoc）+ 全部写点迁移（R29/R10 清单——cs 15+ns 12 现场 grep）；**删** committed 基线/leafDiff/applying latch/投影对账四件套（不建）；删 syncStoreToDoc + 零删除扫描静态断言（lint-gate 挂"delete-scan 模式零命中"）；批 0b baseline 守卫随 syncStoreToDoc 消失（守卫职责被意图漏斗吸收——删除意图显式化）。
- 判据：红1b 10 锚按漏斗载体重写（①-⑤⑨⑩ 语义不变）；`projectionFromDoc ≡ storeProjection()` 真不变量维持（4a 安全网）。

**分支 diff 引擎（不可行）**：committed 基线+leafDiff delta 写+S1 收编+删 syncStoreToDoc+零删除扫描断言——照 spec 对账节 §1-11 全文落位（executor 以 spec 为断言源）+ ADR 弃用计划落 `docs/decisions/`。
- Commit `feat(collab): 批4b <分支名>——写路径收口（syncStoreToDoc 删除）`

## 决策门 D（E1/E2 核验，gating 批 5，各 ~30min）

- **E1**：execute() 对"不在 doc nodes 的虚拟节点"能否运行——读 `execution.service.ts:70-80`（shadow- 白名单 hack）+ 拓扑 getScope 判定；结论=可/不可+最小改造清单；
- **E2**：retake 入队 `sv=null` 契约——确认 processor 透传 job.data.sv（execution.processor.ts:22-25）与 sv 裁剪语义（video-project.service.ts:84 注释）；结论=sv=null 时影子可见性成立与否。
- 结论不出 ⇒ 批 5 冻结（绑定条件⑤）。回写完成记录表门 D 行。

## 批 5：删信箱（默认落点 B）+ socket.io 退役评估

**Files:** `apps/api/src/modules/video-project/*`（regenerate 直连化）、`shadowJob.ts` 删除、`collab-document.service.ts`（insertNode/removeNode/shadows 容器随信箱消失）、web `readNodeFileIdFromDoc` 改读真实节点、R19 接触面/回流守卫/`isShadowOnlyEvents` 整套删除、`video-separate.cron` 处置。

- retakeId 客户端生成（`intentRecord.ts` 复用）随请求上送；execute 对虚拟节点按 E1 结论处理（若 E1=不可，最小=在 doc 放真实占位节点后执行——**不复活信箱**）；retake 结果落 Media（projectId/nodeId 关联）+ writeNodeData 写真实节点 + socket 通知；
- 恢复：`GET intents` + Media 按 (projectId,nodeId) 查询（组合索引成本已计入 E4 结论——现场核对 schema.prisma Media 索引）；
- **shadow- 前缀机器全量删除静态断言**（lint-gate：`shadow-` 字面量仅存在于本 plan 历史文档）；nodes 出现 `/^shadow-/` dev 抛；`truncate canvas_doc, canvas_doc_update` 原子切换（同 commit——dev 零存量）；
- **F7 socket.io 退役：按批 1 末（Task 1-7 Step 1b）结论执行**——评估已前移批 1，本批不再重复盘点；若批 1 结论=退役，退役工作另立批不塞本批；若=保留+冻结，本批仅确认冻结契约未被违反。
- 判据：regenerate 真产物；刷新/断连后 retake 状态从 Media+doc 恢复；shadow 静态断言。Commit `feat(collab): 批5 删信箱——retake 直连真实节点（R19 接触面整体消失）`

## 批 6：护栏收尾

- editorDirty 单向 latch 全量语义复核（0d 基础件之上：dispose/收起清零、recoverConnection 不清）；handleClose 三选+`hasPendingWork()` 暴露（VideoEditorShell）；persistHealthy/rebuildPending 完整谓词接入 hasUnsyncedCanvasChanges；sticky activation 已知残留进验收注记。
- 判据：autosave 组/编辑器出口组/卸载 flush 组/红2f″ 全组。Commit `feat(collab): 批6 护栏收尾（handleClose 三选+完整谓词）`

## 批 7：双客户端 E2E 发布门禁

**Files:** `e2e/collab-recovery.e2e.spec.ts`（新）+ `e2e/fixtures/`（双 context）+ `scripts/gate-collab.sh`（自拉 API）+ `docs/superpowers/plans/collab-e2e-gate-checklist.md`（手动清单文件化）。

- **外呼 stub 策略（第九轮评估）**：E2E 真起 API 会打真外呼（KIMI 等）——API 侧加 dev-only fake provider 开关（env `COLLAB_FAKE_AI=1` → ApiCallerService 各 callXxx 返回固定结果，生产 env 校验拒绝该值），gate 脚本与 CI E2E job 统一带上；不做则 E2E 随机失败或产生真实账单。
- **三个最值钱场景脚本化**（0e CI 落地后立即做，不等全批）：杀 API→自动恢复；断连期双端编辑合并；AI 执行态对齐——gate 脚本自拉 API（playwright webServer 自起服务杀不掉——v5.7 注记）；
- **CI 形态写死（第十轮裁决）**：独立 `e2e-collab` job——nightly schedule + workflow_dispatch 手动触发，**PR 不跑**（双客户端 E2E+起停 API 时长不适合逐 PR；发布门禁语义=发布前必绿——本地 gate 清单 + nightly CI 双保险）；0e workflow 预留注释行，本批启用；
- 全链路：会话过期→重登重连；VIEWER 只读横幅；新建画布刷新仍在；编辑器打开杀 API→横幅可见；
- **恢复风暴用例（F12）**：10+ 并发客户端同时重连（脚本多 context/headless 并行）+ collabDiagnostics 服务端 reconnect 突刺计数观测（先观测后谈 shed；多实例退避协调已登记 tech-debt）；
- e2e routeWebSocket 掐断→编辑→恢复→内容仍在且回"已连接"；
- 手动 gate 清单文件化（CI 缺位期防退化）；判据=目标 8 链路全绿。
- Commit `feat(collab): 批7 双客户端 E2E 发布门禁+恢复风暴观测`

## R1c 登记（本轮不实施——立项要件随 tech-debt.md 更新）

- tech-debt.md 增补：编辑器数据双轨 ADR（F10——R1c 立项时裁决"入 doc vs 本地持久化"，入 doc 前置=canvas_doc payload 体积量化；**弃用触发条件（第九轮评估）**：R1c 立项被否决时 0d 五件套升级为长期件并重新设计——防"过渡"变"永久"）；**同步执行统一入队（execute 内联→全走队列——F13 登记不本期做：前端 await 契约变更超出批 0.5，三查判死已闭环恢复语义；第十轮标注提级：这是"同步路径恢复语义残缺"的根因——队列路径有 stalled 重入、同步路径永远只能等 15min 三查，两套恢复语义长期并存的根源在此，非单纯一致性美化）**；y-indexeddb 立项要件 +2（tombstone 清理/多标签协调）；意图表+客户端意图记录=R1c 一半地基（B8——防下轮重做）；socket.io 退役结论（批 1 末评估）；多实例退避协调（F12）；配对式看门狗 R3；Throttler trust proxy/tracker（0c-8 注记）。

---

## Self-Review（writing-plans 检查单——已执行）

1. **Spec 覆盖**：切批表 14 批全部有对应任务段（0a-7）；v5.10 新增件落位——F4→Task 0c-4、F3→0d-1、F1→0.5-1/0.5-3、F2→0.5-5/1-6、F5→门C、F6→门B、F7→批5、F8→3-3、F9→0e-1、F10/F11/F12→门A/批7/R1c 登记。判据表映射：红1→0a-1、红1-并发→0a-2、新建画布组→0a-3、红1b→0b/4b、红2 全组→批1、hydration/canEdit/VIEWER→批2、幂等组→0.5、执行态组→0.5+1-6、服务端组/真协议 12 条→批3、shadow 容器组→批5、autosave/编辑器出口→0d/6、redirect→2-3、E2E→批7。
2. **占位符扫描**：无 TBD/TODO；批 1-5 段中"照 spec 判据 X 行"的映射是**断言源引用**（spec 判据表自包含断言全文），非实现占位；两处显式"实读后定"（page.tsx 锚点/env 键清单）附带了判定规则。
3. **类型一致性**：recomputeConnStatus/hasUnsyncedCanvasChanges/writeExecStatus/claim/complete/fail/canEdit/loginUrl/normalizeIntentParams 等跨任务引用的签名已逐一核对一致；GenerationIntent 列名与 partial index 列一致。

