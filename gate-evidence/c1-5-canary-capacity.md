# C1-5 canary 容量评估（spec §3.3-6「canary 容量评估收口」）

日期：2026-11-12（v2 评审收口：吞吐模型按「worker 单飞+整批串行」重算）；卡：C1-5；结论：**当前设计无
按时间无界增长面，容量上界由 worker 吞吐/项目基数决定；不实现配额/限流**（未发现真实泄漏）。
本文件=评审登记面（plan Task C1-5 工程项 3 落档）。

## 事实源（读码锚）

| 面 | 位置 | 事实 |
|---|---|---|
| pin 行模型 | `apps/api/prisma/schema.prisma:1772` `CanaryPin` | `projectId @id` → **每项目至多 1 pin**（窗不重叠）；列=坐标 3×BigInt + 两 hash 64B + SV + 两时间戳（≈1–2KB 上界） |
| 捕获排程 | `collab-replay-canary.poller.ts:104-114` | `active`=CanvasDoc.updatedAt>now−7d∧ACTIVE；`n=ceil(active×1.25/24)`；每项目 `nextDueAt≈ceil(active/n)h≈19.2h`；tick=60s；每 tick 捕获 cap 8 |
| 捕获冻结预算 | 同上 `:45-47` + `withFrozenPrefix`（gateBudget 500ms） | 最坏 8×0.5s=4s 冻结临界区/分钟/api 实例 |
| pin TTL | `collab-replay-canary.service.ts:34` `CANARY_PIN_TTL_MS` | 15min；`expiresAt` 建立时定死**不续**；`leaseUntil` 由 worker 选择批续租（`collab-canary-verify.worker.ts:179-182`） |
| 过期清扫 | `collab-replay-canary.poller.ts:98` | 每 tick（不论是否 serving）`DELETE FROM "CanaryPin" WHERE expiresAt < now()` |
| verify 消费 | `collab-canary-verify.worker.ts:56-60,143-160,179-183` | tick=60s（env `CANARY_VERIFY_INTERVAL_MS`）；**单飞**（`running` 守卫：批未完时下一 tick 直接返回）；**每批 ≤8 pin 且 `for..await` 串行**；单 pin 重放预算 10s；正常/mismatch 档 compare-and-delete，skip 档保 pin 至 TTL |
| 游标 | `CollabCanaryCursor`（`projectId @id`） | 每项目 1 行 upsert；行数=项目基数（非时间） |
| 项目删除 | `project-erasure.assert.ts:90`（registry 驱动逐模型零行断言）+ `scope-column.registry.ts` `PROJECT_COLUMN_MODELS` 含 `CanaryPin`/`CollabCanaryCursor`（C 档） | 两表无 FK——清理由 erasure scope 批删承担，完成态由 registry 零行断言覆盖 |
| 观测/告警 | `collab-health-thresholds.mjs` CANARY_CHECKS；`collab-canary.metrics.ts` | `last_check_age>24h=P1`（覆盖 SLO）、`skip_lag` 连续 3=P0、freeze 实弹/`pin_retry` |

## 数值结论

1. **增长速率（稳态）**：pin 创建率=active/19.2h；存活 pin 上界=active×min(TTL,消费时延)/19.2h≈
   **active×1.3%**（最坏 skip 档滞留 15min）；**绝对上界=项目基数**（近期转非 ACTIVE 的项目的 pin 仍存活
   至 TTL 由清扫回收——捕获侧只对 ACTIVE 建 pin）。**无按时间累积**：过期恒被 tick 清扫，正常路径
   ≤2 tick 内被 compare-and-delete。
2. **吞吐上界 vs 需求**：需求≈active/19.2h（≈52/h @1000 项目，即 0.87/min）。verify worker 单飞+整批 8
   串行（tick 60s；批跨过下一 tick 时该 tick 被 `running` 跳过）：
   - 批在 60s 内完成（平均重放 ≪10s）：≤8 pin/60s＝480/h → 打平点 active≈**9,216**；
   - **全 worst-case 10s 重放：一批 8×10s=80s → 下一 60s tick 跳过 → 实际 8 pin/120s＝240/h →
     打平点 active≈240×19.2h≈4,608（≈4.6k）**——容量下界口径。
   低于对应规模 due 率远小于容量，队列不积压；超过后表现为 pin TTL 到期被清扫+`last_check_age` P1
   （可调 `CANARY_VERIFY_INTERVAL_MS`/批常量，无需 schema 变更）。
3. **窗重叠/阻塞**：单项目单 pin ⇒ 同项目真空换代/compact 清理 defer 上界=15min（`canary-pin-active`
   返回契约=defer 非死锁）；跨项目并发 pin 上界≈active×1.3%，各自只挡本项目维护/清理。
4. **其他有界性（不改变结论）**：
   - **skip/error 占满 verify 批**：保 pin 档（lifecycle/maintenance/prune/budget）会随批重复选中，
     最坏 =8 pin×TTL 15min 的队头阻塞窗（`skip-generation`/`skip-stale-pin` 主动删 pin 不占位）；
     过期即被 poller 清扫，属有界观测延迟而非无界积压。
   - **多 api 实例捕获竞争**：`CanaryPin` PK=projectId → 同项目并发捕获的 INSERT 冲突折
     `capture-failed`+`collab_canary_pin_retry_total`（TTL 清扫兜底不误删他 pin）；事件有界、无跨实例互锁。
   - **候选查询全扫成本**：poller 的 `CanvasProject JOIN CanvasDoc`（active 计数/候选）与 worker 的
     `CanaryPin JOIN CanvasProject/CanvasDoc` 无专用索引，按表基数全扫；两表行数=项目基数（非事件量），
     每 60s 一次的常量级扫描；规模化后按 EXPLAIN 评估加索引（不改判定）。
5. **表扫描成本**：`CanaryPin`/`CollabCanaryCursor` 无 `expiresAt`/`status` 索引，但行数按构造 ≤项目基数
   （非事件表），每 60s 全表 DELETE/批读为 O(项目基数)，当前与可预见规模无瓶颈（零索引=写入零放大）。
6. **清理责任**：①poller 每 tick 过期清扫；②worker compare-and-delete（ok/语义等/编码差异/mismatch）；
   ③erasure scope 批删（C4-c；无 FK 兜底故 registry 条目是唯一保障——`project-erasure.assert.ts:90`
   按 registry 逐模型零行断言）；④cursor 行随项目删除清理，无按时间增长。

## 登记（不实现，留评审）

- **无配额/限流实现对**：无真实泄漏面（每项目 1 行+TTL 清扫+erasure 清理），加限流反而新增拒绝路径；
  容量拐点（**≈4.6k 全 worst-case–9.2k 快路径**活跃项目）由 `last_check_age` P1 与 pin 过期率可观测，
  超限处置=调 interval/批建或独立立项扩容。
- **观测缺口（登记，不阻塞）**：`CanaryPin` 现存行数/年龄无专用 gauge（`last_check_age` 只反映游标侧）；
  大规模 skip 滞留时需 SQL 查表分诊（runbook §14 处置序）。
