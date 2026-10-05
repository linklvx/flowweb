<!-- doc-status: canonical | anchors: - | superseded_by: - | verified_at: 2026-10-06 | verified_at_commit: 4af57719 -->
# socket.io /execution 通道退役评估（批 1-7 前移——只盘点出结论，不退役）

> 【2026-10-05 状态注】/execution 为**现行通道**（node:status 主路径 dual-write 已落）；本文结论=**保留+冻结分两步退役（TD-21）**——"退役"为计划态非既成事实。

日期：2026-09-30。依据：F7 ADR（新实时面一律走 Yjs doc/stateless；/execution socket.io 通道冻结不再扩展）+ master plan Task 1-7 Step 1b。
盘点命令：`grep -rn "emitNodeStatus\|emitTrimStatus\|emitSeparateStatus\|emitStitchStatus\|emitExecutionComplete\|executionSocket" apps/api/src apps/web/src --include="*.ts*"`（剔除 *.spec/*.test）。

## 一、载体与载荷全量清单

**Gateway**：`apps/api/src/modules/gateway/execution.gateway.ts`（socket.io namespace `/execution`，cookie session 直查 join 鉴权，`@SkipThrottle` 豁免）。

### ① 已死（0 消费方）——可直接删

| 事件 | 服务端调用点 | web 消费方 | 状态 |
|---|---|---|---|
| `execution:complete`（emitExecutionComplete） | execution.service.ts:358（1 处） | **无任何监听** | 死载荷 |

### ② 仍活——node:status 族（doc 侧已 dual-write，待批 1-6 切读点）

| 事件 | 服务端调用点 | web 消费方 |
|---|---|---|
| `node:status`（emitNodeStatus，含 edit-result/edit-failed 状态值与 credits 搭车） | 共 **17 处**：ai-download.processor(87,118)、ai-image-edit.processor(119,199,224)、lighting.consumer(145,228,261)、execution.service(58,110,130,174,198,251,273,333,348) | executionSocket.ts 单例监听 → subscribeNodeStatus（AudioGenNode/ImageGenNode/VideoGenNode/shadowJob 4 组件）+ subscribeNodeEditResult（ImageGenNode，按 shadowNodeId 分发）+ credits:update CustomEvent（CanvasTopBar） |

关键事实：批 0.5 后**主路径调用点已伴随 `writeExecStatus`/`writeNodeData` 落 doc**（exec map / data map——同函数内 dual-write）；**批 1-6 已落库（e11444f0，与本评估同日）**——web 侧 exec 合并视图（`stores/execStatusView` selectExecStatus）已就绪，但五组件的 socket 订阅仍在（**双通道并存**，如 VideoGenNode.tsx:357 subscribeNodeStatus 与 exec 视图并列）——退役前置条件就绪度已高，缺的只是收尾切换。
两个缺口（退役前需补）：
- **emit-only 残留分支**：扣费失败早退（ai-image-edit.processor:119 `edit-failed`、lighting.consumer:145 `lighting-failed`——均为 reserve 失败路径，只 emit 不写 doc）及幂等重放 done（execution.service:130——doc 侧依赖首次执行的落档，重放本身不补写）。
- **credits 余额推送无 doc 写者**（v5.8 定案）——它搭 node:status 的车，是本族唯一需要替代设计的载荷。

### ③ 仍活——socket.io 为唯一推送通道（无 doc 写，轮询兜底已在）

| 事件 | 服务端调用点 | web 消费方 | 兜底 |
|---|---|---|---|
| `video-trim:status`（emitTrimStatus） | video-trim.service.ts(198,212)（2 处） | useTrimTaskStatus → useAsyncMediaTask(socketEvent)（VideoGenNode） | HTTP 轮询 3s/10s（videoTrimApi.getTaskStatus）✓ |
| `video-separate:status`（emitSeparateStatus） | video-separate.service.ts(136,148,177)（3 处） | useVideoSeparateTask → useAsyncMediaTask（VideoGenNode） | HTTP 轮询同上 ✓ |
| `storyboard:stitch:completed`（emitStitchStatus） | stitch.consumer.ts(119)（1 处） | useStitchTask（socket.once(taskId 过滤)） | 5s 轮询 getStitchTask ✓ |

三个服务**零 doc 写**（grep writeNodeData/writeExecStatus 无命中）——socket.io 是它们唯一的主动推送面；web 侧均有 HTTP 轮询兜底（迁移期天然安全网）。

## 二、退役消除面 vs 成本

**消除面**（退役 /execution 后消失）：
1. execution.gateway.ts 整体（~110 行）+ 三个登记在案的 tech-debt：①cors 配置漂移（CORS_ORIGIN env 解析逻辑只服务此通道）②join 鉴权（每次 join 2~3 次 DB 查询：session→project→teamMember）③内存 adapter 不对称（多实例部署跨实例推送失效——hocuspocus 侧已有 Redis 扩展，socket.io 侧没有）+ ④throttler WS 行为豁免（批0c-8 登记项）。
2. web executionSocket.ts 单例（~66 行）+ 5 个订阅文件改源 + canvas page ensure/teardown。
3. **注意**：socket.io **包级依赖不会被消除**——`apps/api/src/modules/recharge/payment.gateway.ts`（namespace `/payment`，支付状态推送，web 消费 WeChatQRModal/MembershipPage）仍在用。全量移除 socket.io 需另立 /payment 迁移评估（低频推送，可轮询/复用 collab stateless——不在本评估范围）。

**迁移成本**（按 F7 判据：剩余载荷能否落 doc/stateless）：
- node:status 族：服务端补写 emit-only 残留分支 **2 处**（ai-image-edit:119、lighting:145 各加一行 writeExecStatus best-effort）；web 读点切换=批 1-6 本体工作（非额外成本）。credits 推送替代：GET /credits 惰性刷新或 collab stateless 帧（小）。
- trim/separate/stitch：服务端补 writeExecStatus 共 **6 个调用点**（2+3+1，与批 0.5b SERVER_OWNED_NODE_DATA_KEYS 同机制）；web 三个 hook 的 socket 快路径改 doc 观测（useAsyncMediaTask 已参数化 socketEvent——改源面小）。
- execution:complete：删 1 行调用 + gateway 方法（零风险）。
- 合计 ≈ 1~1.5 个批的工作量；风险集中两点：credits 替代设计、shadowJob 的 edit-result 按 shadowNodeId 分发需 doc 投影覆盖 shadow 容器（shadow 容器组判据已在 spec）。

## 三、结论

**建议：保留 + 冻结现状（F7 既定），随后分两步退役——而非现在退役。**

1. **现在可做（零依赖）**：删 `execution:complete` 死载荷（emitExecutionComplete + execution.service.ts:358 调用）。
2. **批 1-6 已落库，随时可做**：补写 2 处 emit-only 残留分支（ai-image-edit:119/lighting:145）→ 五组件 node:status/edit-result 订阅摘除（exec 合并视图已就位）→ 17 处 emitNodeStatus 删除；credits 推送换 stateless/HTTP。
3. **批 1-6 之后一小批**：trim/separate/stitch 补 6 处 writeExecStatus + 三 hook 改 doc 观测（轮询兜底已在，迁移安全）→ 删 gateway + executionSocket.ts。
4. socket.io **包级**移除挂 /payment 迁移（另立评估，登记 tech-debt）。

理由：剩余活事件中 node:status 族已有 doc 落地+批 1-6 客户端视图已就位——退役只是双通道收尾；3 个（trim/separate/stitch）迁移成本低（6 个写点）且 web 兜底已在；execution:complete 零消费即删。越早完成 2/3 步，cors/join 鉴权/adapter 不对称三个 tech-debt 越早消失；批 1-6 既已落库，顺序障碍已清除。
