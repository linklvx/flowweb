# C1-5 canary 容量评估（spec §3.3-6「canary 容量评估收口」）

日期：2026-11-12；卡：C1-5；结论：**当前设计无按时间无界增长面，容量上界由 worker 吞吐/项目基数决定；
不实现配额/限流**（未发现真实泄漏）。本文件=评审登记面（plan Task C1-5 工程项 3 落档）。

## 事实源（读码锚）

| 面 | 位置 | 事实 |
|---|---|---|
| pin 行模型 | `apps/api/prisma/schema.prisma:1772` `CanaryPin` | `projectId @id` → **每项目至多 1 pin**（窗不重叠）；列=坐标 3×BigInt + 两 hash 64B + SV + 两时间戳（≈1–2KB 上界） |
| 捕获排程 | `collab-replay-canary.poller.ts:104-114` | `active`=CanvasDoc.updatedAt>now−7d∧ACTIVE；`n=ceil(active×1.25/24)`；每项目 `nextDueAt≈ceil(active/n)h≈19.2h`；tick=60s；每 tick 捕获 cap 8 |
| 捕获冻结预算 | 同上 `:45-47` + `withFrozenPrefix`（gateBudget 500ms） | 最坏 8×0.5s=4s 冻结临界区/分钟/api 实例 |
| pin TTL | `collab-replay-canary.service.ts:34` `CANARY_PIN_TTL_MS` | 15min；`expiresAt` 建立时定死**不续**；`leaseUntil` 由 worker 选择批续租（`collab-canary-verify.worker.ts:179-182`） |
| 过期清扫 | `collab-replay-canary.poller.ts:98` | 每 tick（不论是否 serving）`DELETE FROM "CanaryPin" WHERE expiresAt < now()` |
| verify 消费 | `collab-canary-verify.worker.ts:56-60,164-184` | tick=60s（env `CANARY_VERIFY_INTERVAL_MS`）、批 8、单 pin 重放预算 10s；正常/mismatch 档 compare-and-delete（坐标谓词）；skip 档保 pin 至 TTL |
| 游标 | `CollabCanaryCursor`（`projectId @id`） | 每项目 1 行 upsert；行数=项目基数（非时间） |
| 项目删除 | `scope-column.registry.ts` `PROJECT_COLUMN_MODELS` 含 `CanaryPin`/`CollabCanaryCursor`（C 档） | 两表无 FK——清理由 erasure scope 批删承担（`project-erasure.purge.c4c1.int.spec.ts:170` 断言） |
| 观测/告警 | `collab-health-thresholds.mjs` CANARY_CHECKS；`collab-canary.metrics.ts` | `last_check_age>24h=P1`（覆盖 SLO）、`skip_lag` 连续 3=P0、freeze 实弹/`pin_retry` |

## 数值结论

1. **增长速率（稳态）**：pin 创建率=active/19.2h；存活 pin 上界=active×min(TTL,消费时延)/19.2h≈**active×1.3%**
   （最坏 skip 档滞留 15min）；绝对上界=active（PK 每项目 1 行）。**无按时间累积**——过期恒被 tick 清扫，
   正常路径 ≤2 tick 内被 compare-and-delete。
2. **吞吐上界 vs 需求**：捕获与 verify 各 8 次/60s＝480/h。需求=active/19.2h。打平点：
   - verify 平均重放 ≪10s 时：active≈**9,216**；
   - 全 worst-case 10s 重放（tick 单飞，有效 ~6 次/tick=360/h）：active≈**6,912**。
   低于此规模 due 率（≈0.87/h @1000 项目）远小于容量，队列不积压；超过后表现为 pin TTL 到期被清扫+
   `last_check_age` P1（可调 `CANARY_VERIFY_INTERVAL_MS`/批常量，无需 schema 变更）。
3. **窗重叠/阻塞**：单项目单 pin ⇒ 同项目真空换代/compact 清理 defer 上界=15min（`canary-pin-active`
   返回契约=defer 非死锁）；跨项目并发 pin 上界≈active×1.3%，各自只挡本项目维护/清理。
4. **表扫描成本**：`CanaryPin`/`CollabCanaryCursor` 无 `expiresAt`/`status` 索引，但行数按构造 ≤项目基数
   （非事件表），每 60s 全表 DELETE/批读为 O(active×1.3%)，当前与可预见规模无瓶颈（零索引=写入零放大）。
5. **清理责任**：①poller 每 tick 过期清扫；②worker compare-and-delete（ok/语义等/编码差异/mismatch）；
   ③erasure scope 批删（C4-c，无 FK 兜底故 registry 条目是唯一保障——本轮复核仍在册）；④cursor 行随项目
   删除清理，无按时间增长。

## 登记（不实现，留评审）

- **无配额/限流实现对**：无真实泄漏面（每项目 1 行+TTL 清扫+erasure 清理），加限流反而新增拒绝路径；
  容量拐点（≈6.9k–9.2k 活跃项目）由 `last_check_age` P1 与 pin 过期率可观测，超限处置=调 interval/批建
  或独立立项扩容。
- **观测缺口（登记，不阻塞）**：`CanaryPin` 现存行数/年龄无专用 gauge（`last_check_age` 只反映游标侧）；
  大规模 skip 滞留时需 SQL 查表分诊（runbook §14 处置序）。
