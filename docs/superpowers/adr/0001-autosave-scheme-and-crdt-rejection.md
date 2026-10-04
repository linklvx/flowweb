<!-- doc-status: historical | superseded-by: specs/2026-09-29-collab-conn-status-recovery-design.md | verified_at: n/a -->
# ADR-0001：画布自动保存选型（方案 2）与 CRDT 否决

- 日期：2026-08-26（决策）；2026-10-05 抽档（文档治理批 4）
- Status: Rejected（CRDT 等备选）/ Superseded（本决策本体亦已被取代，见文末）

## Decision

画布自动保存采用**方案 2：脏标志收敛 + debounce 全量 PUT + 乐观锁**（单端点 `PUT /api/projects/:id/canvas`，409 冲突重载，三态指示器）。源 spec：`docs/superpowers/specs/canvas-autosave-design.md`（历史档）。

## Rejected

- CRDT（协同数据结构）
- Command 层重构 / 操作日志双表双 Worker
- 可观测性全家桶

**论证存档状态**：方案对比与事实核查存于当时会话记录，**未落盘**（spec :5 明示"见会话记录"）——本 ADR 仅存结论与下述历史弧线，不重构论证细节。

## 历史弧线（后见）

该否决的作用域是"单人自动保存问题"（CRDT 对该问题是过度设计）；**2026-09-30 画布协作上线后，协作数据层恰采用 CRDT（Yjs doc+服务端持久化）整体取代了本决策的 REST 保存链**。两次决策不矛盾——问题域不同；但教训成立：否决论证不落盘，后继者只能从结论反推。
