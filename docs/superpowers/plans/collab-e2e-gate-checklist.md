<!-- doc-status: canonical | anchors: - | superseded_by: - | verified_at: 2026-10-06 | verified_at_commit: 122cdf81 -->
# Collab E2E 发布门禁清单（批 7 文件化——CI 缺位期/发布前手动 gate）

> 用途：双客户端 E2E（`apps/web/e2e/collab-recovery.e2e.spec.ts`）对应的 8 链路发布 gate 清单。
> 自动化入口：`node scripts/gate-collab.mjs`（预检→自拉 API〔COLLAB_FAKE_AI=1〕→playwright→清理）；
> CI：nightly `e2e-collab` job（PR 不跑）。CI 缺位/发布前按本清单手动跑，判据=8 链路全绿。
> 底稿：`smoke-dual-client.md`（批 0a-4）已并入本文（场景 1-4 与其同源）。

## 环境准备

1. 基础设施：PG(5432)/Redis(6379) 在跑（MinIO 不需要——collab 链路无上传/产物消费）
2. 端口 3000/3001/5173 空闲（gate 自拉 API + vite preview 独占）
3. 测试账号（`apps/api/prisma/collab-gate-seed.ts` 幂等生成）：
   - A=collab-a@flowweb.local / collab12345678（OWNER，画布属主）
   - B=collab-b@flowweb.local / collab12345678（A 团队 MEMBER）
   - 共享画布 `collab-gate-canvas`
4. 一键：`node scripts/gate-collab.mjs`（退出码 0=门禁绿）

## 8 链路清单（自动化映射 + 手动判据）

| # | 链路 | 自动化用例 | 判据（手动等价） |
|---|---|---|---|
| 1 | 杀 API→自动恢复 | S1 | 双端开画布已连接→杀 API→断连期 A 加节点→重启 API→双端零刷新回「已连接」→B 见 A 断连期编辑（≤自动重连周期） |
| 2 | 断连期双端编辑合并 | S2 | 断连窗口 A/B 各加节点→恢复→两端均见对方编辑（最终一致，L19 双向） |
| 3 | AI 执行态对齐 | S3 | A 触发 fake AI 生成（图片节点「⏳ 生成中...」双端可见）→完成收敛；外呼在飞时杀 API→重启→BullMQ stalled 重排（同 jobId 可重入 claim）→节点 ≤150s 退出 loading（不永转圈） |
| 4 | 会话过期→重登重连 | S4 | DB 置 session 死线 now+10s（**连接前**置——sweep 快照在 authenticate 定格，连后续置不进快照；置已过期则鉴权即拒无从连入）→连接（鉴权时仍有效）→死线越界→sweep（COLLAB_SWEEP_ENABLED）≤75s close(4401)→A 离开已连接→reload 引导 /login?next=<原画布>→重登→回原画布「已连接」 |
| 5 | VIEWER 只读 | S5 | DB 置 B=PROJECT_VIEWER→B reload→B 加节点→A 全程不可见（零 doc 写）+ B 刷新后幻影消失 |
| 6 | 新建画布刷新仍在 | S6 | /canvas 无参→自动新建→加节点→刷新→节点仍在+projectId 指针不变（R5 终验） |
| 7 | 编辑器杀 API→失败可见 | S7 | 多轨剪辑节点→全屏编辑→已保存基线→杀 API→改画布比例→红点「保存失败，点击重试」→重启→点红点重试→回「已保存」 |
| 8 | 传输级掐断→编辑→恢复 | S8 | playwright routeWebSocket 透明管道→已连接→close(1006) 掐断→离线加节点→库自持重连→「已连接」+节点仍在+刷新后仍在（服务端持久化佐证） |
| 9 | 恢复风暴（扩展） | S9 | 10 并发 context 同项目→杀 API→重启→全部恢复 connected+每页 /api/health <500+子进程日志无 UnhandledPromiseRejection/EADDRINUSE |

## fake AI 接入（外呼 stub）

- `COLLAB_FAKE_AI=1`（gate/CI 注入）：`ApiCallerService` 七个 callXxx 返回固定结果（1.5~2s 延迟模拟真实节奏），零真实外呼
- 生产拒绝：`NODE_ENV=production` + 该值 → API 启动即抛错（防生产假成功产物）
- 单测锁定：`apps/api/src/modules/execution/api-caller.fake-ai.spec.ts`（零 fetch/延迟/生产拒绝/回归锚）

## 已知登记（不阻塞门禁）

### gate 落地过程挖出的真实缺陷（发布门禁的直接价值）

- **①已修：批3-3 后真启动即炸**——AuthGuard 加 SessionService 依赖后，media/recharge/storage 三控制器残留的冗余类级 `@UseGuards(AuthGuard)` 在宿主模块上下文解析不到该依赖（AuthModule 未导入）→ `node dist/main` 启动即炸。CI 单测全 mock（AppModule 不 boot）从未暴露；gate 首跑即抓。修复=删三处冗余注册（全局 APP_GUARD 已覆盖，类级注册本就是双重执行）。
- **②登记：UI 分辨率词表与定价表脱节**——图片配置面板异步补写默认 `resolution:'2K'`（词表 1K/2K/4K），而 execution 的 validation/pricing 按 `resolutionId` 精确查 pricingRule（seed 的是 ModelResolution id 如 `seed-res-hy-1024`）→ 补写后任何执行/重跑被「无有效定价规则」**静默拦截**（job 显示完成、零副作用、无日志）。gate seed 以词表规则（null+1K/2K/4K）兜底；产品级映射（词表→ModelResolution）另立修复。
- **③登记：同节点二次生成 loading 不可见**——exec map 按 nodeId 键控（无 intentId 维度），终态防倒退会把新执行的 loading 写吞掉（"迟到 loading 不倒退终态"设计对**新**执行同样生效）——发起端自己也看不到 loading。E2E 3b 以新节点绕行；键控加 intentId 维度随 exec map 迭代评估。
- **④注记：enqueue 必带 intentId**——stalled 重排的可重入 claim 依赖 job.data.intentId 与在飞意图行匹配；不带 intentId 的直调（脚本/工具）撞活跃 partial unique → NodeBusy 静默失败。真实 UI 均带（intentRecord）；gate helper 已对齐。
- **⑤机制锚：sweep 快照死线**——context.sessionExpiresAt 在 authenticate 时定格，连接后改 DB 不影响快照（死线必须连接前置于近未来，见 S4 行）；快照未越界=零 DB 查询（灰度设计内）。

### 既有登记

- **S4 邮箱重登无自动跳转**：AuthModal（@deprecated）登录成功不触发 login 页 onLoginSuccess 的 next 跳转——自动跳转随 LoginModal 替换落地；E2E 已断言 next 参数正确性（目标=原画布）+手动 goto 完成闭环（loginRedirect 白名单矩阵另有 19 条单测）
- **S7 编辑器"横幅"现形态=保存状态红点**（EditorTopBar save-state-dot title「保存失败，点击重试」）——完整 SyncBanner（connUi banner 消费）随批 6 落地后升级断言
- **同步路径（POST /execute 直连）中断恢复窗口 ≤15min**（意图表三查 STALE_MS）——E2E S3 走 enqueue 队列路径（stalled 重排 ≤150s 恢复）；同步路径的快速恢复登记 R1c（统一入队时收口）
- **S9 多实例退避协调**：单实例风暴已验证；多实例 reconnect 突刺协调登记 tech-debt（F12）
- 视口/性能：10 并发 context 需 ~2GB 空闲内存（headless Chromium）
- 调试：`COLLAB_E2E_GREP="S3" node scripts/gate-collab.mjs` 只跑匹配用例（全套 ~4-8min，单用例 ~1-2min）

## smoke-dual-client.md 历史底稿归并说明

- 场景 1（杀 API 自动恢复）：2026-09-30 批 0a 手动实测记录保留在原文档；本清单 S1 为其自动化形态
- 场景 2/3/4：分别升格为 S2/S3/S4（原"批 1 后启用"均已兑现）
- 测试账号 333@333.com 已随 migrate reset 消失——统一改用 collab-gate seed 账号
