# 协作面依赖降级矩阵（E57——单源一页）

> 载体：spec Y0b §5.9 E57（v2.8）；plan 2026-10-12-y0b-5-terminal-and-observability.md T16。
> 行=依赖 × 失败模式；列=用户面六通道；格=行为+用户文案+指标+告警级。
> 文案纪律：PG 行文案≡`db-unavailable` 瞬态档词表（客户端横幅「服务繁忙/稍后重试」族——禁自造第二词表）。
> 验证状态：**本批（Y0b-5 T16）只逐格验证 PG 行**（int 真实连接级注入）；Redis/MinIO/外呼三行标「未验证」——
> 后续批次触达时按 PG 行同法逐格验证后摘标。teamId 变更行同样只验静态面（见行注）。

## PG（Y0b-5 T16 已验证——int 真实连接级注入：dead-port PrismaClient → open → 准入/store 短路 → 恢复 → 半开 → closed）

| 失败模式 | 读画布 | 写画布 | 执行（Generation） | 上传 | 公开页 | 资金 |
|---|---|---|---|---|---|---|
| **停**（连接拒绝/不可达） | 新装载拒：503 `COLLAB_NOT_SERVING`（db-unavailable 面，Retry-After 由 filter 附）；存量连接只读不受影响（内存 doc 常驻） | WS 写不碰 PG——帧照常；store 批经 spool 兜底落盘（熔断面②短路省 5s 事务等待；「不拒 append」契约） | 受理 503（sv 门/租约同族；执行链查 PG 失败折 error→退款闭环） | 直传链查 PG 失败→5xx（未验证——本批未触） | 快照读（isPersistedComplete 谓词满足时）可用；活读 fallback 撞装载门同拒 | 巡检资金不变量探针失败→P1；settle/refund 写失败走状态机重试（deadline reaper） |
| **超时**（慢查询/池等待） | 同停档（30s 窗≥5 次且连接族失败率>50% → open） | 同停档 | 同停档 | 同停档 | 同停档 | 同停档 |
| **慢**（RTT 抬升未超阈值） | 无降级（auth deadline 3s 折 db-unavailable 计入窗口） | 无降级 | 无降级 | 无降级 | 无降级 | 无降级 |
| **行为+指标+告警级（PG 全模式共用面）** | 熔断 open：`collab_pg_breaker_state=1`；准入拒计 `collab_auth_reject_total{reason=db-unavailable}`+`collab_load_rejected_total{reason=db-unavailable}`；ready 503 `reason=db-unavailable`；refusalCache 15s 防重放风暴（半开成功清空） | store 短路计 `yjs_store_drain_total{result}` 批落 spool：`yjs_spool_depth_bytes` 抬升；恢复后 confirm 排空（帧回收断言 int 在位） | — | — | — | — |
| **恢复** | 冷却 10s→half-open→下一调用探测：成功→closed+`refusalCache.clear()`；失败→回 open（冷却重启）。`collab_pg_breaker_state=2/0` | 同左（探测=store 走 PG+补排空 spool） | — | — | — | — |
| **告警级** | state=1 持续 >1 冷却窗（>30s）→P1（误开有界自愈；持续=真停机+零流量死区）；`collab_pg_breaker_failures_total{class}` 异常增高→P2 观测 | state=1 期 spool 深度增速异常→P2 | — | — | — | — |

## spool 容量（本地磁盘满——Y0a-2 已验证档，本批复核措辞）

| 失败模式 | 读画布 | 写画布 | 执行 | 上传 | 公开页 | 资金 |
|---|---|---|---|---|---|---|
| **容量超限**（256MB 线，`COLLAB_SPOOL_CAPACITY_BYTES` 可调） | 不受影响（装载读 PG） | **readOnly 降级**：新连接 auth 期置 readOnly（freezeIntent=spool+connected 登记）；存量连接批次继续由内存队列+PG 承接（容量态不停梯=自愈通道） | withDoc 写意图 503（isWritableOrDegraded≠ok） | 不受影响 | 不受影响 | 不受影响 |
| 指标+告警 | `yjs_spool_capacity_total` inc+`yjs_spool_depth_bytes` 持平不下→P1（depth 只降不升才解——探针无权解除） | 同左 | — | — | — | — |

## shrink/导出（可用性等级高于普通写路径——专格标注）

| 通道 | PG 停/熔断 open 期行为 | 说明 |
|---|---|---|
| shrink（超配额自救） | **不可用**（同步段需 PG 事务） | 标注：**可用性等级高于普通写路径**——超配额冻结期 PG 同时故障=唯一自救通道失效，用户只剩导出+刷新；runbook 值班须知（P2） |
| export-fresh（导出自救） | **可用**（快照读不触熔断面；谓词门不满足时活读 fallback 撞装载门同拒） | 同上标注：等级高于普通写路径——冻结期导出是用户侧唯一出口，禁在熔断面误伤 |

## 团队形态变更（个人→团队邀请成员瞬间——Y0b-5 T16 增行；裁定 25⑨）

| 变更 | 权限面 | 配额归属 | writeFrozen 语义 | 验证状态 |
|---|---|---|---|---|
| 邀请成员（个人项目纳入团队协作） | 成员表+awareness role 注入生效；VIEWER 降权/EDITOR 升权走 `collab.perm.changed`→即时 sweep（Y0b-5 T16 升权活路径回归锚在位） | GenerationIntent.teamId 归属从个人池切团队池——**在飞 intent 结算归属与快照重推：未验证**（触达资金结算测试批时补 int 格） | 新成员连接按其角色施加 freeze（writeFreeze 单源 per-conn 原因集——不跨连接串扰） | 权限面已验（perm-events 升/降权+踢线全路径）；配额归属格**未验证** |
| solo→团队 collabScope | 客户端 collabScope 字段（conn-status 一字段+文案分支最小形态）——**登记偏离表，Y0c 输入** | 同上 | 同上 | 未实施（Y0c） |

## Redis（未验证——本批未触达）

| 失败模式 | 读画布 | 写画布 | 执行 | 上传 | 公开页 | 资金 |
|---|---|---|---|---|---|---|
| 停/超时/慢 | ready `redis=down` 不 gating（仅报不拦）；BullMQ 队列面预期降级——**未验证** | 同左 | BullMQ 停摆=执行排队不可用——**未验证** | — | — | 幂等键 Redis 面——**未验证** |

## MinIO（未验证——本批未触达）

| 失败模式 | 读画布 | 写画布 | 执行 | 上传 | 公开页 | 资金 |
|---|---|---|---|---|---|---|
| 停/超时/慢 | 不受影响（画布面不依赖 MinIO） | 不受影响 | 产物上传/取回失败→error→退款——**未验证** | 上传 5xx——**未验证** | 分享渲染产物 404——**未验证** | settle 前产物存在性断言失败路径——**未验证** |

## AI provider（外呼——未验证；E48/E49 定价 fail-closed 已单验）

| 失败模式 | 读画布 | 写画布 | 执行 | 上传 | 公开页 | 资金 |
|---|---|---|---|---|---|---|
| 停/超时/慢 | 不受影响 | 不受影响 | claim→error→refund 闭环（资金语义 int 已覆盖）；真外呼超时档——**未验证** | — | — | 冻结释放 int 已验；慢档（RTT 抬升）——**未验证** |
