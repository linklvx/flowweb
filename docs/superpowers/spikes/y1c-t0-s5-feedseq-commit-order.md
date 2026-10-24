# Y1c T0-S5 spike 结论：feedSeq 提交顺序（裸 sequence 分配序≠提交序复现+计数行行锁方案验证）

- **日期**：2026-10-24（plan v1.7 Task 0 spike S5；plan v1.5 ③/S5 实验锚；spec v5.4 ⑮/偏离 38⑮「锁序简化业务行→counter」）
- **交付物**：`apps/api/src/modules/collab/feedseq-commit-order.int.spec.ts`（int 池 vitest **6/6 绿**，1.5s；真本地 PG 16.13，scratch schema `y1c_s5_spike` 自建自清，零生产表触碰）+ 本文档。
- **性质**：SPIKE——零生产码改动。实验对象=plan T5b/T7/T22 的 `RuntimeFeedCursor` 计数行方案最小化（feed_counter/business_row/feed_event 三表镜像目标形状）。

## 0. 结论速览

| 实验 | 结论 | 处置 |
|---|---|---|
| (a) 裸 sequence 分配序≠提交序 | **复现**：A 取号(seq=1)未提交→B 取号(seq=2)先提交→游标停在 max(committed)=2→A 后提交，`seq>cursor` **永久漏 A 行**（A 已提交却永不可达=feed 漏事件洞） | repro-locked（int spec 用例 1） |
| (b)① counter 行锁：分配序≡提交序 | A 持 counter 行锁未提交 ⇒ B 的 UPDATE **阻塞至 A 提交**（pg_stat_activity Lock 等待结构证据+150ms 未完成）⇒ seq 序=提交序，可见集恒为前缀（count==max） | verified |
| (b)② 仅 per-project 串行 | A 持 P1 counter 未提交期间，P2 完整业务事务（业务行→counter→事件→commit）**~5ms 全程无阻塞**完成于 A 提交之前 | verified |
| (b)③ 锁序契约 | **counter 先拿+业务行后拿（对向获取）→ 40P01 死锁复现**（库默认 deadlock_timeout=1s 后检测）；统一「业务行→counter」=无死锁且序≡提交序 | verified |
| (b)④ abort 语义 | counter 取号随事务回滚**回收**（连空洞都不留；对照：裸 sequence abort 留空洞但无害——致命类是倒挂非空洞） | verified |
| 先例对照 | canvas_doc_update_seq（advisory lock 先拿）与 credit-ledger lockBalance（FOR UPDATE 第一环）=「门锁先行」家族；feed counter=「终点锁」家族——**同目标（序≡提交序）不同锁位，成因=被锁对象是否事务的根变更对象** | §5 定案 |

**裁定**：`UPDATE "RuntimeFeedCursor" SET "lastSeq"="lastSeq"+1 WHERE "projectId"=$1 RETURNING "lastSeq"` 在事件业务事务内、**counter 最后拿（业务行→counter）**——plan v1.7/spec v5.4 ⑮ 原文**实证成立**，无保留。发现仅 F-S5-1（deadlock_timeout 是 superuser GUC——drill 环境注意项），不推翻 plan 假设。

## 1. 装置

- 真 PG：`postgresql://flowweb:flowweb_dev@localhost:5432/flowweb`（PG 16.13；用户 flowweb **非 superuser**）。
- 连接形态：4 个独立 `pg` Client（A/B=实验事务方、C=第三事务方、R=读者/结构观测）——每 Client 一连接，显式 `BEGIN`/`COMMIT` 控制事务边界；阻塞的结构证据=`pg_stat_activity.wait_event_type='Lock'` 轮询（非纯时序判定）。
- scratch schema `y1c_s5_spike`：`bare_seq`/`bare_events`（(a) 裸形态）+ `feed_counter`/`business_row`/`feed_event`（(b) 目标形状最小化）。beforeAll 重建、afterAll `DROP SCHEMA CASCADE`；用例间 `ROLLBACK` 复位（半途失败不泄漏悬挂事务给下一用例）。
- pg 注意：bigint 恒以 string 返回——BigInt 显式解析；引号标识符 `"lastSeq"` 保大小写。

## 2. (a) 裸 sequence 复现（the bug）——实测时序

| 步 | 动作 | 可见状态 |
|---|---|---|
| 1 | A：`BEGIN; INSERT ... nextval` → **seqA=1**（未提交） | 读者不可见 |
| 2 | B：`BEGIN; INSERT ... nextval` → **seqB=2**；**COMMIT**（先提交） | 读者见 {2} |
| 3 | 读者：`max(seq)`=2 → **游标 cursor=2** | — |
| 4 | A：**COMMIT**（后提交，更低 seq） | 读者见 {1,2} |
| 5 | 读者：`WHERE seq > cursor ORDER BY seq` → **0 行** | **A(seq=1<cursor) 已提交却永不可达** |

断言面：`seqB==seqA+1`（分配序 A 先）∧ B 提交时戳早于 A（提交序 B 先）——**倒挂成立**；步骤 5 恒 0 行 ∧ A 行存在（`payload='A'` 可查）——**游标漏 A**。这是「物化序≠分配序」的最小复现：任何以 `max(committed seq)` 推进的增量游标在该时序下必然跳过后提交的低 seq 行。plan v1.5 ③「裸 sequence 分配序≠提交序漏事件洞；S5 实验锚」兑现。

## 3. (b) counter 行锁方案验证（the fix）

### ① 同项目：分配序≡提交序（无洞可漏）

形态：`BEGIN; UPDATE business_row(业务行 r1); UPDATE feed_counter SET lastSeq=lastSeq+1 RETURNING(=分配); INSERT feed_event(seq); COMMIT`。

- A（P1）持 counter 行锁未提交 → B（P1、**不同业务行 r2**——排除业务行互斥干扰）的 UPDATE **阻塞**（`pg_stat_activity` Lock 等待命中+150ms 后仍未完成）。
- A `COMMIT` → B 才拿到 seq=2（B 完成时戳 ≥ A 提交时戳）——**行锁持有至事务结束 ⇒ 后拿号者必然后提交**。
- 读者前缀性质：**count(*)==max(seq)**（P1 事件恰 {1,2}）——任何时刻可见集恒为前缀，游标停在 max 可见 seq 永不跳行。A 未提交期间读者对 P1 看到空集（游标安全停 0）。

### ② 仅 per-project 串行（跨项目零互斥）

A 持 P1 counter 未提交期间，B 的 **P2 完整业务事务**（业务行→counter→事件→commit）**~5ms 完成**（远低于任何锁等待周期）且完成于 A 提交之前。行锁粒度=projectId 行——per-project 串行化，跨项目并行。

### ③ 锁序契约：counter 最后拿（业务行→counter）

- **反例复现（40P01）**：T1 `{BEGIN; UPDATE business_row r1（持业务行）}`，T2 `{BEGIN; UPDATE counter P1（持 counter）}`，随后 T1 再拿 counter（阻塞）、T2 再拿业务行 r1（阻塞）——**对向获取成环**，PG 死锁检测器在 `deadlock_timeout`（本库默认 **1000ms**）后选牺牲者：**恰一方 40P01**（`SET deadlock_timeout='100ms'` 收紧尝试被拒——**superuser GUC**，见 F-S5-1）。
- **正例（统一业务行→counter）**：T2 先抢业务行 r1 拿不到（T1 持有）——T2 在**持零锁**状态等待 ⇒ 无环；T1 counter 最后拿不被 T2 挡；T1 提交后 T2 依次拿 r1→counter(seq=2)。双方提交成功，seq 序=提交序，无 40P01。

**环分析（定案理由）**：counter 终点化 ⇒ 任何事务不会在「已持 counter」状态下再去等业务行锁 ⇒ **counter 不参与任何等待环**；反序（counter 先拿）则 counter 成为环枢纽——凡存在任一路径先拿业务行再拿 counter（=feed 事务的自然形态），对向即死锁。临界区维度同向支持终点化：counter-first 会把整个业务事务串行化在 per-project 热行上（业务阶段无法跨事务重叠）；counter-last 只串行化「分配+事件插入+提交」尾段。

### ④ abort 语义：取号随事务回滚回收

A `BEGIN; UPDATE counter(P2)→2; ROLLBACK` → 增量回滚，`lastSeq` 回到 1；C 随后分配仍得 **2**——counter 方案**连空洞都不产生**。语义对照定案：**空洞无害**（游标按已提交可见集推进，跳号不隐藏任何已提交行；裸 sequence abort 也只是留空洞）、**倒挂致命**（(a) 形态，counter 方案结构性消灭）。

## 4. 先例对照（定案）

| 先例 | 锁形态 | 锁位 | 目标 |
|---|---|---|---|
| `canvas-doc-update.repository.ts` append（:59-72，注释锚 :61-63「SV3/W14 …seq 序≡提交序」） | `pg_advisory_xact_lock(hashtext(projectId))` 先拿，同语句 `INSERT ... nextval` | **门锁先行** | seq 序≡提交序（stateSeq 可信水位）——与 S5 同目标 |
| `credit-ledger.service.ts` lockBalance（:58-64「锁序第一环（契约 20）」） | `SELECT ... FOR UPDATE` on TeamBalance，事务首句 | **门锁先行** | 账序/version 单调（并发纪律=FOR UPDATE 单式） |
| **S5 feed counter（本 spike 定案）** | `UPDATE counter ... RETURNING`，业务行之后 | **终点锁** | feedSeq 分配序≡提交序 |

- **一致性**：三者同构实现「分配/账序≡提交序」——per-scope 行锁/咨询锁**持有至事务结束**，后取号/记账者必然后提交。这是「序≡提交序」的充分条件本身，锁位不是目标的一部分。
- **锁位差异的成因**（S5 与两先例的对照定案）：canvas append 与 ledger mutate 的被锁对象是**事务的根变更对象**（advisory key 序列化整个 append 族；TeamBalance 是记账根），且其后继写全是 **append-only INSERT**（新行无前置行锁）——门锁先行+后续无反向锁序=统一序无环。feed counter 不同：它**不是业务对象**，而是追加于**任意业务事务**（先触达若干既有业务行、锁序不可控）之上的记账行——先拿 counter 会把 counter 变成环枢纽（③ 反例实证）。故 spec v5.4 ⑮「锁序简化：feed 事务只锁业务行+counter……锁序=业务行→counter」原文成立，且与两先例不矛盾——**锁位由「被锁对象是否事务根」决定，不由偏好决定**。
- 附带对齐：canvas append 的 advisory-lock 先行同时承担 compact 同键互斥（SV3/W14）——feed counter 无此双职能，无需咨询锁。

## 5. 发现登记

- **F-S5-1（drill 环境注意）**：`deadlock_timeout` 是 **superuser-only GUC**——生产/db 用户 `SET` 被拒（本库 flowweb 非 superuser，实测 catch）。死锁 drill 实测耗时=库默认 1s（用例 1009ms 实证）；T22 负控（spec v5.4 ⑮「受控死锁用例标 heavy 不进 PR」）在 staging 复演时按 1s 预算，勿依赖 SET 收紧。
- **F-S5-2（装置面，已消化）**：pg bigint 参数/返回恒 string——`RETURNING "lastSeq"` 行键保引号大小写（`lastSeq` 非 `lastseq`）、BigInt 显式解析；int 用例对 pg 原生协议的这个坑已写进装置注释（T22 移植时同款处理）。
- **无发现推翻 plan v1.7/S5 假设**：v1.5 ③ 的洞复现成立、v5.4 ⑮ 的方案与锁序契约实证成立。

## 6. 运行结果

```bash
DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb \
  pnpm --filter @flowweb/api exec vitest run -c vitest.int.config.ts src/modules/collab/feedseq-commit-order.int.spec.ts
```

**6/6 绿**（1.5s；含 40P01 死锁用例 1009ms）。自清验证：`y1c_s5_spike` schema afterAll 丢弃，生产表零触碰（全语句 schema 限定）。类型面：`@types/pg` devDep 补齐后 `tsc -p tsconfig.scripts.json --noEmit` 零错误。
