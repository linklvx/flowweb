<!-- doc-status: canonical | anchors: - | superseded_by: - | verified_at: 2026-10-05 | verified_at_commit: 95f32cb9 -->
# docs 权威链与文档状态机（入口面）

> 本文件是 docs 语料的权威链入口（spec `docs/superpowers/specs/2026-10-05-doc-governance-closure-design.md` §5.1）。
> 状态机与门禁唯一权威=`scripts/doc-gate.mjs`；口径输出以命令运行为事实，正文不写可漂移的文档总数。

## ① 权威链（冲突时从上往下取）

**代码（含 schema/类型/守卫测试）> canonical 文档 > 历史记录。**

任何文档与代码冲突，一律以代码为准；发现冲突须提 spec 修正文档，不得以文档反推代码。

## ② canonical 清单（当前值）

生成命令：`node scripts/doc-gate.mjs --list-canonical`（判据 C1~C4 见 spec §5.4；清单是判据的派生物，可被判据推翻；**索引与登记表不计为入引用来源**——被 README 列出≠权威）。

| 判据 | 文档 |
|---|---|
| C1 | superpowers/plans/2026-09-18-css-base-layer-theme-plan.md |
| C1 | superpowers/plans/2026-09-18-video-work-admin-upload.md |
| C1 | superpowers/plans/2026-09-20-canvas-domain-theme.md |
| C1 | superpowers/plans/2026-09-26-image-node-panel-redesign.md |
| C1 | superpowers/plans/2026-09-30-collab-recovery-master-plan.md（批 7 完成态——判据源锚） |
| C1 | superpowers/plans/collab-e2e-gate-checklist.md（ci.yml 锚；含 smoke-dual-client 归并节——原文件批 2 退役） |
| C1 | superpowers/specs/2026-09-18-css-base-layer-theme-design.md |
| C1 | superpowers/specs/2026-09-20-creditsdropdown-light-draft.md |
| C1 | superpowers/specs/2026-09-26-image-node-panel-redesign.md |
| C1 | superpowers/specs/video-editor.md（视频剪辑域需求锚点） |
| C1 | superpowers/tech-debt.md（TD 台账） |
| C4 | superpowers/plans/socketio-retirement-assessment.md |
| C4 | superpowers/specs/2026-09-29-collab-conn-status-recovery-design.md（现行 collab 架构权威） |
| C4 | superpowers/specs/admin-console-refactor.md |
| C3 | superpowers/deployment-db-baseline.md（运维基线） |
| C3 | 团队功能说明.md（面向用户的产品说明） |
| C3 | README.md（本文件——权威链入口面） |

**frozen（冻结决策记录——不进权威链、门禁检查豁免，内容本体不动）**：Spec B 两份（specs/2026-09-28-group-geometry-batch-connect-design.md + plans/2026-10-02-canvas-group-spec-b-geometry-batch.md——spec-version 守卫锚）；DELETED.md（删除登记表——索引性载体）。

**active（在建/在用——vocabulary 告警级）**：specb-acceptance-checklist / specb-device-protocol / specb-risk-ledger（Spec B 结项前在用的验收输入，结项后翻 historical）。

新增 canonical 必须登记命中依据（criteria+evidence，人工增补走 `docs/_meta/canonical-manual.json`）。清单基线比较制：判据面变动时 doc-gate 报 canonical-drift 红，跑 `--write-canonical` 落盘并 review。

## ③ 兜底规则

**清单外任何文档一律视为历史设计记录**：实现歧义以代码+canonical 文档为准，禁止用历史文档反推现状。

## ④ 排除声明（门禁扫描域外）

- `docs/vendor/`（22 份，外部资料）
- `.worktrees/`、`.claude/worktrees/`、`backups/`、`.superpowers/brainstorm/`（工作区副产物/用户资产，处置对照表见 spec §十）
- docs 根逐名（禁通配，防新增文件自动豁免）：`README.md`、`团队功能说明.md`、`_meta/`（门禁数据面）；PRD txt/docx 已于批 2 退役（见 DELETED.md，萃取入本文件 ⑥ 节）
- `superpowers/adr/`：**显式说明其在 vocabulary 扫描域外**——ADR 是已否决决策的历史档案（不在 canonical 清单即自然豁免），其引用受 md 存在性检查约束（唯一机器约束，防孤岛化）

## ⑤ plan checkbox 全局声明

**plan 的 `- [ ]` 是任务模板，状态以完成记录表 + commit 为准。** 已完成 plan（如 collab master plan）文头带 ⛔ 阻断块——agent 勿按 checkbox 重做批次。

## ⑥ ARCHITECTURE（现行架构速览）

> 萃取自 PRD（AI多模态内容创作SaaS平台产品设计文档，2026-10-05 批 2 退役；txt/docx 归一化后逐节一致，无裁决分歧）。技术栈已按仓内实态核对剔除未建设项。

**产品定位**：Web 端的 AI 多模态内容创作 SaaS 平台——基于无限画布和节点，通过调用大模型 API 实现文生文、文生图、图生图、图生视频、文生视频等功能。

**现行技术栈**（PRD 原文剔死项+注记）：

| 层 | 技术 |
|---|---|
| 前端 | React 18.3 / TypeScript 5.6（strict）/ Vite 5.4 / Ant Design 5.22 / Zustand 4.5 / Tailwind 3.4 |
| 无限画布与节点 | @xyflow/react 12.10 + Zustand + **Yjs/Hocuspocus 4.6 协同**（PRD 原列 Socket.io——现仅剩 /execution 执行通道，画布协同已迁移，见 TD-21） |
| 后端 | Node.js 20 LTS / NestJS 10.4 / Prisma 5 / PostgreSQL 16 / Better Auth（session cookie） |
| 中间件 | Redis 7 / BullMQ 5.75 / MinIO |
| 可观测 | Sentry（@sentry/nestjs + @sentry/node，api 已接线） |

PRD 剔除项（均未建设，全文决策见 DELETED.md）：Apache APISIX（网关实为 Nginx）、Prometheus/Grafana/Loki/Jaeger 自建观测族、ECharts。

| 域 | 权威指针 |
|---|---|
| 画布协同（Yjs/恢复/执行态） | specs/2026-09-29-collab-conn-status-recovery-design.md + plans/2026-09-30-collab-recovery-master-plan.md |
| 组几何/批量连线（Spec B） | specs/2026-09-28-group-geometry-batch-connect-design.md |
| 主题（画布域跟随/语义 token） | specs/2026-09-18-css-base-layer-theme-design.md + plans/2026-09-20-canvas-domain-theme.md |
| 视频剪辑（WebCodecs 剪辑器） | specs/video-editor.md |
| socket.io 通道现状与退役计划 | plans/socketio-retirement-assessment.md + tech-debt TD-21 |
| 技术债台账 | superpowers/tech-debt.md |
| 部署/DB 迁移 | superpowers/deployment-db-baseline.md |
| 订阅域索引断言 | `pnpm --filter @flowweb/api run verify:indexes`（运行时机：**上线前/订阅迁移后**——逐块断言 ≥1 行，消灭空集假绿） |
| 团队协作产品口径 | 团队功能说明.md |

## verified_at 操作规则（新鲜度是改代码时的义务）

- a) `anchors` 限定为**契约文件**（docShape.ts / canvasIntents.ts / schema.prisma / 相关守卫测试），不指整个 src/。
- b) `warn_deadline = verified_at + 180d` 显式字段，到期 doc-gate 输出清单驱动复核。
- c) 改动 A 契约文件 ⇒ **同一 commit 内**更新指向 A 的 canonical 文档 `verified_at`。
- d) 状态行带 `verified_at_commit`——新鲜度判据用 `git log --oneline <verified_at_commit>..HEAD -- <anchors…>` **单次调用**覆盖全部 anchors（消除时钟/时区偏差，避免逐文件 git log）。

## 治理与所有权

- **dead 符号登记是删除动作的一部分**：删除清单外既存无效代码者，须在同一 commit 内登记 `docs/_meta/dead-symbols.json`（symbol/removedIn/reason）。
- **到期复核**：豁免 `expires_at` 到期由门禁红强制触发（谁触发谁处理）；canonical `warn_deadline` 到期由 doc-gate 输出清单驱动。
- **元规则**：任何新增门禁规则必须同时定义其**误报率测试**与**豁免通道（含 TTL）**——无测试的规则=假绿，无 TTL 的豁免=永久豁免。
- **执行频率**：文档门禁挂在 `pnpm verify` 链首（阻塞态）——执行频率=PR/push（CI test job）；nightly 的 e2e-collab job **不跑 verify**。查询模式（--stats/--list-*/--sample）只读；canonical.json 唯一写者=`--write-canonical`。
- **验证链纪律（TD-26）**：门禁命令禁接管道（`| tail` 掩退出码）；flaky 必须隔离复跑并显式记录；派生器源集不得包含索引/登记表。
