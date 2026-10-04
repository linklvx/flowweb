<!-- doc-status: active | note: 在建工程 plan（§5.6），结项后随批 5 翻完成 | verified_at: n/a -->
# 存量文档治理与 Yjs 上线残留收口 实施计划（v1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> ⚠️ 本 plan 属 **active（在建）**——spec §5.6 三分法之中间态；批 4 状态行写回时本文件标 active，结项后随批 5 翻完成。

**Goal:** 按 spec v1.2（`docs/superpowers/specs/2026-10-05-doc-governance-closure-design.md`——**断言的单一真相源**，任务文字与 spec 冲突时以 spec 为准）落地：文档状态机（doc-gate 门禁+canonical 判据 C1~C4+死符号清单+README 权威链+DELETED）、删除 12 份 md+PRD 2 份、代码半拆除五项、资损文档校准，终态=spec §七总验收全绿。

**Architecture:** `scripts/doc-gate.mjs`（仓级门禁：findRepoRoot+扫零必红+C1 三态引用枚举+负例自证+vocabulary 仅扫 canonical+双向自校验+豁免通道）＋数据面 `docs/_meta/{dead-symbols,canonical,exemptions,tombstone-comments,supersede-map}.json`＋入口面 `docs/README.md`＋`docs/superpowers/DELETED.md`。批次：前置 0→批 0(机制)→批 1.5(资损校准)→批 1(代码)→批 2(删除)→批 3(canonical 校准)→批 4(三分法+注入)→批 5(收口)。

---

## 执行总览（顺序、依赖、通用纪律）

**依赖图（硬依赖仅三条）：**
1. 批 1 每项删除的"红"=先把符号登记进 `_meta/dead-symbols.json` → doc-gate 双向自校验抓"清单内符号仍存在于代码"⇒ exit 1；删除后转绿。**故批 0（Task 1-2/1-3）必须先于批 1。**
2. 批 4 的注入/状态行写回必须在批 2 删除之后（只给幸存者注入）。
3. 批 5 开工条件=Spec B 结项确认（specb-acceptance-checklist 收口或用户明示）。
批 1.5/批 2/批 3 相互独立（建议序：1.5→1→2→3，资损优先）。

**每批开工第一步**：重读本 plan 该批任务 + spec 对应节 + grep 重校准漂移行号（前批会改动同文件）。

**Task↔批号映射（防交叉引用错位）**：Task 1-x=批 0｜Task 2-x=批 1.5｜Task 3-x=批 1｜Task 4-x=批 2｜Task 5-x=批 3｜Task 6-x=批 4｜Task 7-x=批 5。

**每批通用收尾**：
```bash
node scripts/doc-gate.mjs        # 批 0 Task 1-3 落地后以 --warn-only 接入 pnpm verify 链首；批 4 转阻塞
pnpm verify
git add <本批文件> && git commit -m "<type>(<scope>): 批 X …"
```
commit 规范：纯文档批=`docs(meta)`/`docs`；含代码批（批 0④、批 1、批 5 断言）=`feat`/`chore`；**批 1 每项删除与其 removedIn 回填必须同一 commit**；Task 1-1 master plan 原子动作独立 commit。

## 完成记录表（每批尾滚动填写）

| 批 | 状态 | commit | 批尾备注 |
|---|---|---|---|
| 前置 0 | 完成 | —（无变更） | pnpm verify 全绿：api 162 文件/1458 测试 PASS + web lint-gate 全 PASS（setState 棘轮 216/40 只降不升）；spec-version-consistency.guard.test.ts 实跑绿 |
| 0 | 完成 | a44c0277（+Task 1-1 独立 commit f858d1a3） | **批尾备注（2026-10-05）**：7 任务全落地，doc-gate PASS（语料 256 份=canonical 19/active 2/historical 226/ordinary 9；违规 0；active 叙述警告 58 条不阻断）。**执行修正 10 项**（spec §5.2/5.4/5.6 字面 vs 实态）：①C1 砍日期剥离短名形态——裸短名与模块目录名系统性撞名（material-library/audio-waveform 等 6 例假阳性实证），forms=完整路径/裸文件名（含日期前缀）/别名，无日期文档裸文件名天然即短名；②master plan 代码引用实态=空格别名 "master plan"（e2e/api spec 判据源注），别名机制显式登记；③负例自证 7 命中按实态修正——"Spec B spec+plan"=spec-version 守卫锚的 2026-09-28-group-geometry-batch-connect-design+2026-10-02-canvas-group-spec-b-geometry-batch，video-editor.md 按裸文件名实命中 C1（非预写 C4，证据=e2e 注释，语义上仍是视频域需求锚）；④自校验扫描域=**生产代码 only**（剥 *.spec/test）——守卫测试以符号名为断言素材（template.market-removal.guard/syncStatus.spec/canvasO0b4 首跑 13 条假红实证），测试块清理由批 1"连带 describe 同删"纪律承载；⑤active 判据=doc-status: active 机器标记唯一（遗留"状态：待确认"系 18 份旧文档陈旧文本不作数），治理 spec/plan 批 0 即写机器标记（批 4 幂等更新）；⑥vocabulary 对 active 文档**降为警告**、离开 active 态硬化（spec §5.6"校验适用"字面偏差——治理文档自身以死符号为主题×58，行键豁免在编辑期不可维护）；⑦豁免实际生成面=**105 条/7 份**（Spec B spec 56+plan 35=拆除决策本体叙述、master plan 6=isHydrating 删除锚、tech-debt 4=台账清账行、css-base-layer 两份 4=选型史），expires_at=2027-01-02；⑧补设 `_meta/canonical-manual.json`（C2/C3 人工增补宿主——canonical.json 每次运行重生成，人工条目需独立数据面），初始 3 条 C3=团队功能说明/deployment-db-baseline/docs-README；⑨ref-existence 剥代码围栏（命令输出路径非文档引用）+解析候选补 docs//apps/web//apps/api/ 前缀（包内相对路径实态）；⑩verify 链首接入 --warn-only ✓。TDD 三步红绿留痕：SyncCanvasPayload(repo)红 2 处→getProject(文件 scope)仅 projectApi.ts:11 红→getProject(repo scope)活 controller project.controller.ts 同弹（scope 字段必要性得证）→phase4 临时入 canonical UserBalance 红 2 处→复原 PASS。master plan 静态断言三件随 Task 1-1 commit f858d1a3 落实（阻断块=行 2/agentic=行 4/checkbox 171→0/纯 CRLF 无 mixed）。**待用户**：确认 GitHub 分支保护中 ci/test 是否 required check（G1 强度前提）。 |
| 1.5 | 完成 | 69cce17d | 六件文头 historical 状态行全落（首行校验 OK×6）；phase4 三注/phase6 attempts 分层注/phase2 §4.1+§7+§8 指针化（标题全保留）；TD-25 新条目登记（付费队列 attempts 兜底守卫提案）；**行漂移豁免机制首次实证**——TD-25 插行使 tech-debt 4 条行键豁免失效转红，重登记 4 条复绿（"行漂移迫使复核"按设计工作）。doc-gate PASS（verify 未单独重跑——纯文档批，链首 doc-gate + api/web 无涉）。 |
| 1 | 完成 | 5f725ea4/507e5c3a/c456ac47/ee5e92e7+补登 7155245b+回填收口 commit | **批尾备注（2026-10-05）**：五项全 TDD 落地（每项登记→红→删→绿），removedIn 由 --fill-removed-in 自动回填真 hash（git log -S）。**执行发现 4 项**：①consume 落**文件级 scope**——裸词扫描生产代码唯一命中即方法本体，但"consume"在文档叙述面歧义（master plan 完成记录提及），文件级 scope 使 vocabulary 按归属规则跳过；连带 vocabulary 规则修正：**文件级 scope 死符号不入词法检查**（video-editor.md 的活 ProjectData 撞名 5 条假阳性实证）；②Task 3-2 连带孤儿链比预期深——删双方法后 service 的 @Inject(REDIS_CLIENT)/ioredis 导入/spec mockRedis/provider/描述块全链清（模块级工厂保留：auth.controller/rate-limiter 仍消费）；③Task 3-4 runner 三修：pg 需 createRequire 锚 apps/api 解析（根 scripts 解析不到包级依赖）、fileURLToPath（URL.pathname 在 Windows 产 /D:/ 假路径）、块解析先剥注释再判空；牙齿负例自证（假名→1/2 块断言失败→复原 PASS）；④**C4 级联发现**：verify-indexes.sql 注释引用 docs/README.md → README 升 C1 → collab spec（2026-09-29）凑满 ≥2 C1 入引用**升 C4 canonical**（语义正确=现行权威，原拟批 3 手动晋升被机制自动完成）→ 其 11 条 isHydrating 等退役判据记录按叙述豁免补登（7155245b）。**教训登记**：`node doc-gate | tail` 管道掩退出码致一次带红 commit（ee5e92e7 时点）——门禁判绿禁接管道，改 `>file; echo $?` 形态。Task 3-5 零操作：seed.ts 墓碑注释合理（"UserBalance 已删，账本唯一 TeamBalance"）+剥注释扫描覆盖（tombstone 数据面已随第六轮裁决取消）。team 139+auth 72 测试绿、tsc 净、doc-gate PASS。**web admin flaky 登记（观察）**：全量三跑失败集轮换（5→5→1，均 admin 域：Announcement/Models/Plans/VideoWorksPage），全部隔离复跑绿（9+23 测试），web tsc 双跑过、本批 web 侧唯一 diff=projectApi.ts 孤文件删除 27 行（git diff f858d1a3..HEAD 实证）——与 master plan 批 1 已登记"admin 页 flaky（单跑绿）"同家族，机器负载相关，非本批回归。 |
| 2 | 完成 | 0cb7b630 | 14 文件删除（12 md+PRD 2）+DELETED 14 行登记+README ⑥ ARCHITECTURE 实体化（定位句+现行技术栈——APISIX/Prometheus 族/Loki/Jaeger/ECharts 剔除〔never-built，package.json 零命中实证〕；Sentry 保留〔@sentry/nestjs+node 已接线〕；Socket.io 注记画布协同已迁移）。**PRD 比对结论：txt/docx 归一化后逐节完全一致（4290 字符）——"待核差异"坍缩为零，无权威链裁决需求**。**执行发现 2 项**：①master plan :785 全路径提及 smoke-dual-client 绊红 ref-existence——就地注记化（保完成记录、去路径形态）；②**DELETED.md 升 C4 canonical**（master plan+README 双"见 DELETED.md"指针凑满 ≥2 C1 入引用——机制本体入权威链合理），其表内路径记法改"目录 · 文件名"（去 .md——登记路径即数据非引用）+死因列 5 条豁免登记。验收：存在性复跑全 No such file ✓；残留 grep=设计内指针形态（2026-08-24 注记/README 行注/gate-checklist 归并节/master plan 历史记录，均非路径形态）；doc-gate PASS（语料 244=canonical 20/active 2/historical 214/ordinary 8）。批 2 首条 git rm 短路径静默失败教训——删除命令一律全路径。 |
| 3 | 完成 | 22c2c2a8 | 团队功能说明 3 处校准（§1.2 归属口径重写=create 接收 body.teamId〔project.controller.ts:16 实证〕+个人/团队双页签〔WorkspacePage Tabs 实证〕，删"后续补齐"承诺；§2.4 删"模板保存为团队模板"行〔M0 已整删〕；§5 充值注翻正〔WeChatQRModal 已接线〕）。tech-dept TD-4/5/6(+8)/15 三清账行尾退役指针（原措辞不动，行内追加零漂移——豁免无需重登记）。socketio-assessment 文头状态注（现行通道+退役=计划态）。canonical 面无漂移（20/244 稳定）；doc-gate PASS。 |
| 4 | 完成 | fa2cbacb | **批尾备注（2026-10-05）**：--write-status 落地（EOL 探测+幂等：canonical 行机器所有随跑刷新 verified_at_commit、historical/active 手写含注记跳过——批 1.5 六件手写行完整保留实证）+historical 208 份首行写回+canonical 19 份注入（本地日期修正——首版误用 UTC）；转阻塞（verify 链首去 --warn-only）后全量 EXIT=0（web 3606+api 1447+lint 全绿）。**执行发现 4 项**：①**两份 ADR 源论证均不存在**——CRDT 否决仅存结论行（"方案论证已否决"引注已丢失会话记录）、phase2 无 ReactFlow 选型论证段（spec 自始假设 xyflow）——ADR-0001 按结论型决策记录萃取（明示论证未存档+"否决 CRDT→后采用 Yjs"弧线与教训），ADR-0002 无源跳过（plan"必抽两份"前提证伪，phase2 批 1.5 状态行注记同步修正）；②首行注入=全体 canonical 豁免 +1 行漂移→**全量重登记 123 条**（行漂移迫使复核机制再次按设计工作，同文件同符号沿用理由）；③template-marketplace 判定①删除（M0 整删+8 死命中+零外部引用）；pan-select spec 死符号段注（:150-:250 白名单护栏对象已消失）；09-16 /candidates 注（生产 controller 零路由实证）；td11/blank-node-size/history-page 留历史档随写回；④**被掩真回归现形**：批 1 删 auth.service redis 注入后 managed-redis.spec B6 断言旧形态红——此前批 1 verify 均在 web flaky 段中断、api 套件从未执行（&&链掩下游）——断言翻正（not.toContain REDIS_CLIENT+注释归因），redis 5/5 绿。freshness 首跑=canonical 状态行 anchors 均为"-"（未登记）——anchor 登记为批 5/常规维护义务（README 规则 a 在位）。语料 243=canonical 19/active 2/historical 213/ordinary 8（adr/ 目录入语料——ADR-0001 historical）。**偏差补登（第七轮）**：附录 A"canvas-autosave-design 抽 ADR 后处置"执行为**保留未删**——ADR-0001 自承论证未存档，源文档是结论行唯一载体，删除即销毁（保留正确，当时未登记系疏漏）；canvas-undo-redo 引擎替换注当时漏做、第七轮已补（状态行并入 zundo→Y.UndoManager+STACK_LIMIT=100 现行）。 |
| 5a | 7-1 完成（TDD 红 61→绿 60×2 连跑）/7-3 进行中 | — | **第七轮拆分/第八轮加约束**：7-1 credits 双池断言（apps/api generation-intent.int.spec.ts 真库 hasDb 模式——双池**和式** Δcredits+ΔsubscriptionCredits==ΣcreditsConsumed ∧ 该 intent 终态唯一。**断言形态已查证定死**〔第八轮报告三之问〕：GenerationIntent 无 creditType 列〔schema.prisma:967-991，池归属仅在 TeamCreditTransaction.creditType:726〕——intent 侧单池差值不可判，和式是唯一可落形态=原案。**弱化点（第八轮用户裁决明写）**：和式只验总量守恒（抓扣费遗漏/重复扣费），**不验池归属**——日后池级断言路径=沿 TeamCreditTransaction 的 `intent:` 关联分组求和（int spec 已含该补充覆盖：Δ分池==reserve 负流水分池合计）。**第八轮硬约束（已遵）**：①增量断言非绝对值；②禁断言客户端 UI；③fixture 隔离+测后清理；④独立于 gate-collab）+7-3 三树处置对照表（见下方"批 5a Task 7-3"节）——**不依赖 Spec B** |
| 5b | 等 Spec B 结项四条件 | — | 7-2 全量重扫+7-4 总验收。**四条件（第八轮编号收紧：①②③机器可判、④外部输入，同时满足）**：①spec-version 守卫绿；②Spec B 两份 frozen 文档 git log <verified_at_commit>..HEAD 为空——**正文零变动；首部状态/指针行由本工程统一注入者除外**（例外条款为 frozen 读者指针开通道：Spec B spec 含 templateData×48/saveCanvas×25 已删符号历史叙述，frozen 机器语义〔不进权威链/检查豁免〕不在文档内、读者无从知晓——首部补一行指针引 DELETED.md，报告二建议）；③specb 三件套（active）人工验收项有明确结论；④结项由用户明示。**终态语义（第八轮报告一）**：结项时两份 frozen 转 historical（frozen 是过渡态非终态——真冻结合同在代码：docShape.ts/几何守卫），README 权威链补"组几何权威=代码"一行。**5b 附带复议项（第八轮报告一，非阻断）**：ordinary 5 份="被 canonical 恰好引用 1 次"的治理中间地带（C4 阈值 ≥2 挡外又排除出 historical）——复议 C4 阈值或设显式类别；244 基线含本工程自身文档（治理 spec+plan=active），本 plan 转 historical 后 --stats 预期值需在总验收记录；死符号清单派生工具化 --gen-dead-candidates（git log --diff-filter=D 提议已删文件候选——canvasSyncRuntime/projectApi 裸名不在死词干清单的覆盖缺口，命中今日全在 historical 零假红） |

**批 5a Task 7-3 三树处置对照表（2026-10-05，处置建议交用户拍板后执行）**：

> 判据声明（第九轮用户裁决修正）：三目录均在 .gitignore 内、从未被 git 跟踪——`git log --all -- <path>` 零命中是**必然结果，不构成内容可回溯的证明**（该判据已从表中移除）。成立的判据=**内容级对比**（独有文件清单及其中未保存价值）；辅证=嵌套 .git=0+worktree 登记仅主仓（⇒游离副本，非独立仓库/工作树）。

| 对象 | md | 体积 | 嵌套 .git | worktree 登记 | 独有内容（内容级对比——唯一成立判据） | 建议 |
|---|---|---|---|---|---|---|
| .claude/worktrees | 1133 | 420MB/41061 文件 | 0 | 仅 D:/flowweb 主仓 | 未比对（用户已直接批准删） | **已删除**（用户批准链：mv 出仓 07:23:15 → pnpm verify EXIT=0+git status 干净 → rm 07:28:01，420MB/41061 文件回收） |
| .worktrees/edge-flow-animation | 1134 | 419MB | 0 | 仅主仓 | 独有仅 3 文件：PRD txt/docx（批 2 已删、内容已萃取入 README ⑥）+template-marketplace spec（批 4 判定①已删的旧拷贝）——其余内容主仓可找回，3 文件均无未保存价值 | **已删除**（第九轮批准：mv 出仓 07:50:40 → pnpm verify EXIT=0+git status 干净 → rm 07:54:37，419MB/1134 md 回收） |
| backups/ | — | v3.x 快照 | — | — | 未比对（挂起） | 用户定（挂起）；注：原"git 能定位对应 commit 即可删"判据**同样不成立**（.gitignore:14 内必然零命中）——处置时须做内容级对比 |
| .superpowers/brainstorm | 0 | — | — | — | 实测零 md | 排除声明已覆盖，无需动作 |

**第八轮复核落地（2026-10-05，commit 见 git log）**：①tech-debt.md NUL 字节事故修复——f5f8bbd7 引入的单颗 NUL 实为吞噬了 `$?` 两字符（非多余字节），已还原本意文本（纯删会留语义缺失行）；全仓唯一含 NUL 文本文件，字级 diff 审阅后替换。②doc-gate 三硬化：[binary-corpus] 红守卫（语料含 NUL ⇒ 红，TD-26 第四例）+退出码三分 0=PASS/1=违规/2=结构性环境错误（apps/web/scripts/lint-gate.mjs:271 先例；fail()→2、git ls-files 环境错误显式化）+ls-files tracked-only 假设注记。③CI 拆 doc-gate 独立 job（required check 粒度——TD-26②：verify && 链内红绿互掩）。④TD-26 第四例登记+文件修改纪律成文（README 治理节+tech-debt 处置⑥）。**驳回/已满足**：报告一"--write-canonical 报错须含修复命令"——doc-gate :383 本就含（基于旧版）；报告二 frozen 读者指针、报告一 frozen→historical 终态语义已并入 5b 行。**红绿实证**：临时 NUL md → [binary-corpus] 红 EXIT=1 → 清理复绿 EXIT=0；PATH 清空模拟 git 不可用 → 结构错误 EXIT=2（与违规 1 区分）。**.claude/worktrees 删除前凭据**：1133 md／41061 文件／420 MB（du 块计）／git worktree list 仅 D:/flowweb 主仓／嵌套 .git 指针 0——目录副本非 worktree 登记，.gitignore 内不进 git 历史，删除零门禁接触面（等用户明示后执行）。

---

## 前置 0：verify 基线

**Task 0-1 建立绿基线**
- [ ] Step 1: 运行 `pnpm verify`，逐项记录红绿清单到完成记录表备注。若红：甄别归属——环境 flaky（theme-perf 超时先例：干净树隔离复跑）vs 真红；**真红则停工上报用户**，不在红基线上叠门禁。
- [ ] Step 2: 实跑确认 `apps/web/src/utils/spec-version-consistency.guard.test.ts` 绿（spec §四静态判绿的终验）。

---

## 批 0：机制落地（7 任务）

### Task 1-1 master plan 原子动作（独立 commit，一次提交四步）

**Files:** Modify `docs/superpowers/plans/2026-09-30-collab-recovery-master-plan.md`

- [ ] Step 1: 在 H1（:1）之后、`> **For agentic workers:**`（:3）**之前**插入阻断块（顺序是生效前提）：

  > ⛔ **本 plan 已完成（2026-10-01 批 7 gate 9/9 绿）。状态真源=下方「完成记录表」。正文 `- [ ]` 为任务模板，非待办——请勿按 checkbox 执行。**

- [ ] Step 2: 4a 行校正：`| 4a | 待执行 | — | — |` → `| 4a | 完成 | 62b5d314 | 读归一/不变量/quiescence（依据 4b 行备注引用） |`
- [ ] Step 3: 171 个 checkbox 文本化（**node 重写，不用 sed**——该文件 w/crlf 且 Step 1 插入已使行号漂移；node 按 CRLF 探测写回防 mixed）：`node -e` 读文件→按原 EOL split/join→逐行 `l.replace(/^- \[ \] /, '- ')`→写回；覆盖变体计数（`^- \[ \]`、缩进 `\s+- \[ \]`、已勾 `- [x]` 不动）；跑前后计数 171→0。
- [ ] Step 4: 静态断言三件自验：①`grep -c '^- \[ \]'`==0（含缩进变体==0）；②**阻断块首行行号 == 2**（H1=:1、agentic=:3，插入点唯一——比大小比较更防假绿）；③阻断块含"已完成"与"勿按 checkbox 执行"关键词。
- [ ] Step 5: 单独 commit（`docs(collab): master plan 翻完成态历史档——阻断块+171 checkbox 文本化+4a 行回填`）。

### Task 1-2 _meta 数据面（三件套+死符号初始清单）

**Files:** Create `docs/_meta/dead-symbols.json`、`docs/_meta/exemptions.json`、`docs/_meta/supersede-map.json`

- [ ] Step 1: dead-symbols.json 初始清单=**已从代码消失的符号族**（spec §四），**条目结构含 `scope` 字段**（第六轮修订：裸符号名会跨模块撞名——`getProject` 同时是死导出与活 controller 方法、`ProjectData` 有三个同名者）：

```jsonc
{ "symbol": "isHydrating", "kind": "dead", "scope": "repo",
  "removedIn": "025bd5e0", "reason": "hydration 四态取代（批 2-1）" }
{ "symbol": "syncCanvas",  "kind": "dead", "scope": "apps/web/src/api/projectApi.ts",
  "removedIn": "<批1回填>", "reason": "REST 画布同步客户端整删" }   // scope=文件：只在该文件内断言不存在
```

初始登记（kind=dead）：zundo/flowweb_canvas_v2/isHydrating/UserBalance/CanvasNode/CanvasEdge/saveCanvas/deleteRefs/pickStructNodes/useCanvasPersistence/canvasSnapshot/loadProjectIntoStore/templateData（scope 均=repo，removedIn 已知者填 commit、否则 `pre-2026-10`）+ Keycloak（kind=**never-built**）+ emitNodeStatus（kind=**frozen**，note=现行通道见 TD-21）。**syncCanvas/getProject/SyncCanvasPayload/ProjectData/signOutWithBlacklist/isBlacklisted/consume 不在此列**——批 1 才删，登记即红（TDD 驱动）。
- [ ] Step 2: exemptions.json 由 **doc-gate `--gen-exemptions` 生成草案**（扫 canonical 文档的 dead 符号命中→输出 `file:line:symbol` 三元组；**行号入键**——行漂移使豁免失效迫使复核，防二元组静默永久豁免），人工只填 reason+expires_at（≤90 天绝对日期）。初始预期命中：tech-debt.md 已清账行（:84 deleteRefs、:89 flowweb_canvas_v2+isHydrating、:90 isHydrating）——**不手写数字，以生成结果为准**。
- [ ] Step 3: ~~tombstone-comments.json~~ **取消该数据面**（第六轮裁决：按注释文本维护的白名单=会腐烂的无期豁免）——代码侧墓碑注释（seed.ts:175 UserBalance、canvasCollabRuntime.ts:338 canvasHistory、canvasStore.ts:152 isHydrating 等）由**自校验扫描时剥注释**覆盖（行 `//`+块 `/* */`，syncStatus.spec.ts:33 剥注释先例）。
- [ ] Step 4: supersede-map.json（批 4 状态行 superseded-by 数据源）：初始已知映射（执行时以既有【已废止】头指针为源收集）。

### Task 1-3 scripts/doc-gate.mjs（门禁本体，先红后绿）

**Files:** Create `scripts/doc-gate.mjs`；Modify `package.json`（verify **链首**插入 `node scripts/doc-gate.mjs --warn-only && …`——秒级检查放最前，失败最快发现；**批 0 以 --warn-only 接入、批 4 Task 6-3 转阻塞**，防新门禁误报即卡全队 PR 诱发"为过门禁而放宽规则"）

功能清单（对应 spec 5.2/5.3/5.4/5.6，逐项实现）：
1. findRepoRoot：向上找 pnpm-workspace.yaml，6 层找不到 throw（syncStatus.spec.ts:13 同款）
2. **扫零必红（结构性断言，非计数魔数）**：specs/ 非空 ∧ plans/ 非空 ∧ 每个声明扫描子树 >0 文件 ∧ **分类完备性**（扫描总数 == canonical+active+historical+ordinary 四态之和——同时验证分类器覆盖全部语料）
3. 口径输出：`--list-canonical` / `--list-historical` / `--stats` / `--sample N` / `--gen-exemptions` / `--write-status`（批 4）/ `--fill-removed-in`（批 1）/ `--audit-sample N`（批 5）
4. C1 派生扫描：**三态引用枚举**（完整路径 `docs/superpowers/…` / 裸文件名 / 裸短名）扫 apps/**、packages/**、scripts/**、.github/**；**负例自证**：已知 7 命中（Spec B spec+plan/master plan/gate-checklist/tech-debt/canvas-domain-theme/css-base-layer-theme）任一缺失于候选集 ⇒ exit 1
5. canonical 终判：C1 ∨ C2 ∨ C3 ∨ C4（**C4 只统计 C1 命中文档的入引用**——打破"清单派生依赖清单"的自引用递归），产出 `docs/_meta/canonical.json`（每项 criteria+evidence 命中行；C2/C3 人工增补项必须带理由）
6. vocabulary：canonical 文档禁 dead/never-built 符号（exemptions 豁免；expires_at 过期 ⇒ 红；输出"新增豁免 N/已到期 M"）
7. **双向自校验（按 kind 分流）**：`dead` 条目在**其 scope 内**（scope=repo 则全扫描域，scope=文件则仅该文件）零存在，存在 ⇒ 红——扫描时**剥注释**（行 `//`+块 `/* */`，墓碑注释不算存在；syncStatus.spec.ts:33 先例）；`never-built` 条目**不做**代码存在性校验（若有人真实现了 Keycloak 是正常设计变更，走清单修订而非门禁拦截）；`frozen` 条目**双不做**（活通道）。代码扫描域=apps/*/src+packages/*/src+apps/api/prisma/verify-indexes.sql；**不含** migrations/
8. canonical 存在性：清单项指向不存在文件 ⇒ 红
9. 引用存在性：canonical 文档内目录限定 md 路径必须存在（不查行号、不查锚点——**锚点安全靠 Task 2-1 Step 4 "指针化保留原标题行"保障**）
10. 豁免不进任何计数（独立通道，无棘轮）

**红绿步骤：**
- [ ] Step 1（红·自校验有牙齿且理由正确）：临时登记 `SyncCanvasPayload`（scope=repo——全仓活代码命中仅 projectApi.ts 内 2 处，无撞名）⇒ exit 1；再临时登记 `getProject`（scope=`apps/web/src/api/projectApi.ts`）⇒ 同样 exit 1——**scope 演示**：改 scope=repo 时活 controller（project.controller.ts:23）也命中，证明 scope 字段区分"死导出"与"活方法"的必要性。
- [ ] Step 2（红·vocabulary 有牙齿）：canonical.json 临时追加 phase4 spec 路径 → exit 1（抓到 UserBalance）→ 移除演示条目。
- [ ] Step 3（绿）：演示条目移除后 exit 0；负例自证 7 命中全在候选集；四态完备性断言通过。
- [ ] Step 4: `--warn-only` 接入 verify 链首后全量 `pnpm verify` 绿；**提醒用户确认 GitHub 分支保护中 ci/test 是否为 required check**（G1 强度前提——非 required 则"机器门禁"只是建议性）。

### Task 1-4 .gitattributes/.editorconfig/.gitignore

**Files:** Create `.gitattributes`（`*.md text eol=lf` 单规则+一行注释说明 autocrlf=true system 级背景）、`.editorconfig`（root=true；[*] charset=utf-8；[*.md] end_of_line=lf）；Modify `.gitignore`（删 :15 死规则 `flowweb.dataminio/`；补一行 `minio-data/`）

- [ ] Step 1: 三文件落地。
- [ ] Step 2: 验证（**两层分开**——`git diff` 为空只证 index 已全 LF，不证工作区）：①`git diff` 为空（index 实证）②`git status` 不再显示 `?? minio-data/` ③`git ls-files --eol | grep -c "mixed"` == 0（工作区无 mixed——批 4 注入前的基线）。

### Task 1-5 docs/README.md（入口面）

**Files:** Create `docs/README.md`

- [ ] Step 1: 按 spec 5.1 六节落地：①权威链第一条（**代码 > canonical 文档 > 历史记录**，冲突以代码为准+须提 spec 修文档）②canonical 清单（Task 1-3 生成后贴当前值+生成命令 `node scripts/doc-gate.mjs --list-canonical`）③兜底规则 ④排除声明（vendor/.worktrees/.claude/worktrees/backups/brainstorm+**docs 根逐名**：README.md、团队功能说明.md+**adr/ 显式一行**：说明其在 vocabulary 扫描域外的原因，防误认遗漏）⑤plan checkbox 全局声明 ⑥ARCHITECTURE 节（骨架：定位句与现行技术栈为占位〔批 2 Task 4-3 填 PRD 萃取〕+每域一行权威指针表）+verified_at 操作规则（a~d 四条，含 verified_at_commit）+**治理与所有权 3 行**（登记 dead 符号=删除动作的一部分、同 commit 完成；到期复核由门禁红/warn 驱动；元规则"新增门禁规则必须同时定义误报率测试与豁免通道"）。
- [ ] Step 2: 链接逐一点击/解析验证有效。

### Task 1-6 DELETED.md

**Files:** Create `docs/superpowers/DELETED.md`（表头：文件｜删除 commit｜死因｜决策承载于）

### Task 1-7 批 0 收尾

- [ ] doc-gate 全绿+verify 全绿+Task 1-1 静态断言三件复核+完成记录表回填。

---

## 批 1.5：资损校准（纯文档，不依赖批 0/1 之外的任何批次）

**Task 2-1 phase4/phase6/phase2 三对 spec+plan 校准**

**Files:** Modify `specs/2026-05-10-phase4-execution-pipeline-design.md`+`plans/同名`、`specs/2026-05-16-phase6-bullmq-complete-design.md`+`plans/同名`、`specs/2026-05-10-phase2-canvas-engine-design.md`+`plans/同名`

- [ ] Step 1: 每份文头加状态块（HTML 注释形态，禁 `^#` 行）：`<!-- doc-status: historical | superseded-by: specs/2026-09-29-collab-conn-status-recovery-design.md 等 | verified_at: n/a -->`+一句"数据流/持久化/扣费章节已死"。
- [ ] Step 2: phase4 内联标注三处（**措辞三定**，禁写"已退役/已切队列"）：①扣费：UserBalance 乐观锁描述标"已死——现行=TeamCreditService reserve→settle/void"②执行：同步 HTTP 与 BullMQ **并存**（TD-18 统一入队未做）+GenerationIntent 幂等+读 doc 真实节点 ③socket：/execution **仍为现行通道**，退役计划见 TD-21。
- [ ] Step 3: phase6：attempts 分层精确表述（全局 app.module.ts:49=3；execution/ai-image-edit 队列显式=1〔批 0c 防重复扣费〕；storyboard=2、subscription=3 免费域保留重试）；**在 tech-debt.md 登记新条目**：「付费能力新队列静默继承全局 attempts:3 的风险+守卫断言提案」（spec §6.2 措辞三定随附义务）。
- [ ] Step 4: phase2：持久化章节（§4.1/§7/§8）**保留原标题行**、标题下加指针句（"本节机制已由 Yjs doc+CanvasDoc 取代，见 collab spec v5.10"）——删标题会击穿外部 `#§` 锚点链接；ReactFlow 选型论证保留原位。
- [ ] Step 5: 验收（**不依赖批 0**——doc-gate 能力属批 0，本批只验文件自身）：六份文件首行均含 `<!-- doc-status: historical` 行；tech-debt 新条目已登记。
- [ ] commit：`docs: 批 1.5 资损校准——phase4/6/2 措辞三定+指针化`。

---

## 批 1：代码半拆除（五项，每项独立红绿）

**通用红绿形态（Task 3-1/3-2/3-3 适用）：**
- Step A（红）：目标符号按 **scope 形态**追加进 dead-symbols.json（removedIn 留空）→ doc-gate exit 1（scope 内仍存在）。
- Step B：删除代码+连带测试块，commit（removedIn 仍空）。
- Step C（绿+回填）：批尾统一跑 `node scripts/doc-gate.mjs --fill-removed-in`——用 `git log -S <symbol> --format=%h` 自动回填真 hash（消占位中间态与第二个手写 commit），回填后一个小 commit 登记 → exit 0+api/web 全量绿。

**Task 3-1 projectApi.ts 整删**
**Files:** Delete `apps/web/src/api/projectApi.ts`
- [ ] Step 0（证据）: `grep -rn "projectApi" apps packages --include="*.ts*"` 零 import 命中记录在案（4 导出：ProjectData/getProject/SyncCanvasPayload/syncCanvas）。
- [ ] Steps A/B/C：登记 4 符号（红）→ 整文件删除 → 绿（`client.ts` 的 apiFetch 不动——活模块）。

**Task 3-2 auth.service blacklist 双方法**
**Files:** Modify `apps/api/src/auth/auth.service.ts`（删 :32-50 signOutWithBlacklist/isBlacklisted）、`apps/api/src/auth/auth.service.spec.ts`（删对应 it 块）
- [ ] Step 0（证据）: grep 两方法生产零调用（仅自测引用）。
- [ ] Steps A/B/C。

**Task 3-3 team-credit consume()**
**Files:** Modify `apps/api/src/modules/team/team-credit.service.ts`（删 :58 consume）+`team-credit.service.spec.ts`（删 :70 起"consume 校验顺序"describe）+`team-credit.atomic.spec.ts`（删 consume 相关块）
- [ ] Step 0（证据）: `grep -rn "\.consume(" apps/api/src --include="*.ts"` 仅 spec 自引用。
- [ ] Steps A/B/C。

**Task 3-4 verify-indexes.sql 方案 (a)（修正型，非删除）**
**Files:** Modify `apps/api/prisma/verify-indexes.sql`、`apps/api/package.json`、`docs/README.md`；Create `scripts/verify-indexes.mjs`
- [ ] Step 1: :5 `UserSubscription_userId_active_key` → `user_subscription_one_active`；删 :7-10 死 CHECK 块；保留 :12-19。
- [ ] Step 2: **node+pg runner 定死唯一形态**（psql 分支删除——psql 不在 PATH 且全仓零使用；`$DATABASE_URL` 在 Windows npm script 不展开；psql 空结果集退出码 0 恰是假绿机制）：`scripts/verify-indexes.mjs` 读 DATABASE_URL（apps/api 的 pg 依赖）逐块执行 SQL，**断言每块返回 ≥1 行**——从机制上消灭"查询名不存在⇒恒空集⇒静默通过"；apps/api package.json scripts 加 `"verify:indexes": "node ../../scripts/verify-indexes.mjs"`。
- [ ] Step 3: README 运维节登记运行时机（上线前/订阅迁移后）。
- [ ] Step 4（绿）: `pnpm --filter @flowweb/api run verify:indexes` 输出含 `user_subscription_one_active` 行且三块全 ≥1 行。
- [ ] Step 5: `UserSubscription_userId_active_key`/`UserBalance_subscription_credits_check` 登记 dead-symbols（scope=该 sql 文件）。

**Task 3-5 seed.ts:175 注释核对**
- [ ] 确认注释为合理墓碑（"UserBalance 已删，账本唯一 TeamBalance"）→ 保留并确认 tombstone-comments.json 覆盖（Task 1-2 已建）；无代码变更则本任务零操作，完成记录表注明。

**Task 3-6 批 1 收尾**
- [ ] verify 全绿+removedIn 真 hash 回填完成+DELETED.md 不涉及（代码删除登记在 dead-symbols 的 removedIn，不进 DELETED——DELETED 只收文档）+完成记录表回填。

---

## 批 2：删除 12 份 md + PRD 2 份

**Task 4-1 前置引用行修正（3 处）**
**Files:** Modify `apps/web/e2e/collab-recovery.e2e.spec.ts`（:6 注释"smoke-dual-client.md 底稿"→"gate-checklist 历史底稿归并节"）、`specs/canvas-create-unify-fix.md`（:5 前置行→指向 tech-debt TD-5/6 清账行）、`specs/2026-08-24-shift-multiselect-toolbar-suppress.md`（:10 "上次 spec（2026-08-23-group-bugs-fix.md Bug A）"→"（已删文档，见 DELETED.md；Bug A 修复=useIsSingleSelected）"）

**Task 4-2 短文档唯一结论萃取核对**
- [ ] account_balance：读现行 `team-credit.service.ts`（reserve/settle/void+credits/subscriptionCredits 双字段）记录"积分池冲突动机已被吸收"的证据行 → 写入 DELETED.md 死因列。

**Task 4-3 PRD 萃取+退役**
- [ ] Step 1: docx/txt 各转 md（临时文件，**不提交**），逐节 diff。
- [ ] Step 2: 萃取三件：产品定位句（:2）、**现行**技术栈块（:4-15，剔除 Keycloak/Socket.io 画布项等已死描述并注记）、自相矛盾事实（:11 Better Auth vs :102 Keycloak）→ 矛盾注记只进 DELETED.md 死因列，不进 README。
- [ ] Step 3: 删 `docs/AI多模态内容创作SaaS平台产品设计文档.txt`+`.docx`。
- [ ] Step 4: README ARCHITECTURE 节填入定位句+技术栈（Task 1-5 骨架就位）。

**Task 4-4 删除 12 份 md（清单内联，可直接执行）**
```bash
for f in canvas-refresh-data-loss-fix td2-allimages-unify-td1-projectid-fix \
         td4-hydrate-window-seal td5-6-8-persistence-refactor 2026-08-23-group-bugs-fix; do
  ls docs/superpowers/specs/$f.md docs/superpowers/plans/$f.md
done; ls docs/superpowers/plans/smoke-dual-client.md docs/superpowers/specs/account_balance.md
```
- [ ] Step 1: 上述命令先跑一遍（14 项存在性确认，缺一停工核对）→ `git rm` 删除 12 份。
- [ ] Step 2: DELETED.md 登记 14 行（12 md+2 PRD：文件/commit/死因/决策承载）。

**Task 4-5 验收**
- [ ] ①for 循环命令复跑（全部 No such file）②`git grep -l "<每个被删文件名>" -- docs apps packages` 零命中 ③doc-gate 绿（canonical 存在性断言确认清单无悬空——smoke-dual-client 曾入候选，删除后清单由脚本重派生自动缩）。

---

## 批 3：canonical 校准

**Task 5-1 团队功能说明 3 处**
- [ ] ①§1.2 重写归属口径（create 已接收 body.teamId〔project.controller.ts:16〕、personal/team 双页签、"后续补齐"承诺已兑现——删）②§2.4 删"模板保存为团队模板"行（M0 已整删）③§5 删"充值二维码未接线"注（WeChatQRModal 已实现）。

**Task 5-2 tech-debt 退役指针**
- [ ] TD-4/5/6/8/15 清账行尾追加"→ 机制已于 2026-09-30 Yjs 上线退役，见 <successor>"（原措辞不动）；随后撤销 Task 1-2 登记的 4 条 exemptions 中已不需要者。

**Task 5-3 socketio-assessment 状态注**
- [ ] 文头加：`状态注：/execution 为现行通道；本文结论=保留+冻结分两步退役（TD-21），"退役"为计划态。`

**Task 5-4 收尾**
- [ ] README canonical 清单同步重派生+commit（`docs(meta): 批 3 canonical 校准`）。

---

## 批 4：三分法+状态注入（必须在批 2 之后）

**Task 6-1 三分法处置（按 spec 附录 A 判定步骤逐份）**
- [ ] Step 1: `doc-gate --stats` 输出 historical 清单+死符号密度表。
- [ ] Step 2: 逐份判定：①机制主体已死→删+DELETED ②活部分≥50%→指针化重写 ③含否决论证→先抽 ADR。**必抽 ADR 至少两份**：`adr/0001-rejected-crdt-for-canvas.md`（autosave 否决 CRDT 论证）、`adr/0002-reactflow-selection.md`（phase2 选型依据）——骨架=Decision/Rejected 各一条+日期+Superseded-by+Status: Rejected，≤1 页。
- [ ] Step 3: 附录 A"批 4 现场判定"五份（history-page/template-marketplace/td11/blank-node-size/09-16-video-works）按已知锚点处置（td11 保留 fileId 语义分化表；blank-node-size 保留否决理由——若判"含否决论证"可并入 ADR）。
- [ ] Step 4: 漏审 4 份 09-28：pan-select spec 死符号段标注；r0-hotfix/r1-infra/pan-select plan 确认 historical。

**Task 6-2 historical 状态行写回（分类器同趟输出）**
- [ ] doc-gate `--write-status`：historical 档首行插 `<!-- doc-status: historical | superseded-by: <supersede-map 命中或省略> | verified_at: n/a -->`。**两条硬要求**：①按文件探测 EOL 写回（`content.includes('\r\n')` 则用 CRLF join——8 份 w/crlf 文件直接 LF 注入会产出 `w/mixed`，违反"内容与 EOL 不混批"纪律）②**幂等**（首行已有 doc-status 则跳过/更新，防 Task 2-1 已手写状态行的六份被重复注入）。
- [ ] 验收：diff 抽查 10 份仅首行新增；`git ls-files --eol | grep -c "mixed"` == 0（注入前后均无 mixed）。

**Task 6-3 canonical 状态行注入+门禁转阻塞**
- [ ] Step 1: 以**文件系统为准**重派生 canonical 清单 → 注入**文档头状态行（HTML 注释，与 historical 统一形态——单一解析器+幂等简单+零 `^#` 谓词风险）**：`<!-- doc-status: canonical | anchors: <契约文件列表> | superseded_by: - | verified_at: 2026-10-XX | verified_at_commit: <hash> -->`（字段语义=spec 5.4）。
- [ ] Step 2: **Spec B 两文件注入后立即跑 spec-version-consistency.guard.test+全量 web 套件**。
- [ ] Step 3: doc-gate 从 verify 链的 `--warn-only` **转阻塞**（批 0 观察期结束，零误报为前提）。
- [ ] Step 4: freshness 检查首跑（`git log --oneline <verified_at_commit>..HEAD -- <anchors>` 单次调用；首跑=基线，只 warn 不红）。

**Task 6-4 验收**
- [ ] doc-gate 绿（含 canonical 存在性断言）+verify 绿（此时 doc-gate 已阻塞态）+完成记录表回填。

---

## 批 5：收口（开工条件：Spec B 结项确认）

**Task 7-1 credits 双断言**
- [ ] Step 1（TDD）: 断言落 **apps/api 真库 int spec**（`generation-intent.int.spec.ts` 同款 hasDb 模式——浏览器 gate 上下文断言 DB 需新建装置，成本高一个量级）：`Δ(TeamBalance.credits) + Δ(TeamBalance.subscriptionCredits) == Σ GenerationIntent.creditsConsumed`（**双池和式**——creditsConsumed 是两池合计，单池差值在动用订阅池时必误报；team-credit.service.ts:269 成文纪律"流水镜像 reserve 行两池拆分（禁拿单值猜池）"）∧ 该 intent 终态唯一（无重复 settle）。断言先写先红后绿。
- [ ] Step 2: `tech-debt.md` TD-21 条目本体补一行："credits UI 刷新覆盖面=退役前置条件（DB 不变量断言不覆盖表现层）"。

**Task 7-2 全量重扫**
- [ ] `doc-gate --stats` 对照批 0 基线；漂移项逐个归因。

**Task 7-3 三树处置对照表（交用户拍板后执行，不擅自删）**
- [ ] 按 spec §十四类出表：.claude/worktrees（建议删）/.worktrees（diff 后删或移出）/backups（用户定）/.superpowers/brainstorm（移出工作区）。

**Task 7-4 总验收（spec §七逐项）**
- [ ] ①pnpm verify 绿 ②doc-gate 绿（阻塞态）③README 链接有效 ④**G4 机械化**：`doc-gate --audit-sample 10` 对抽出的 10 份非 canonical 断言三条——文件内 md 路径均存在／endpoint 字面量（/api/…、/projects/… 等）存在于 controller 路由文本／Prisma 模型名存在于 schema.prisma（"按文档做最小改动"的人工判定降为补充抽查，不再占"不靠人眼"的验收位）⑤README/spec 正文无可漂移总数 ⑥新增 canonical 均有 criteria+evidence ⑦每份处置清单附生成命令。
- [ ] 完成记录表全收口+spec 状态翻"已完成"+本 plan 状态行 historical 化。

---

## 附：风险速查（执行中随时对照 spec §九/§5）

- 豁免必须绝对日期≤90 天；禁止 milestone；豁免键=file:line:symbol 三元组（--gen-exemptions 生成，行漂移即失效迫使复核）。
- doc-gate 任何规则改动→先跑误报率（d.ts 假阳性形态已知）；**接入形态=批 0 链首 --warn-only → 批 4 转阻塞**（禁直接阻塞接入）。
- 批 1 removedIn 用 `--fill-removed-in` 自动回填（git log -S），禁占位值/手写。
- 状态行注入（canonical 与 historical 统一 HTML 注释形态）：禁 `^#` 行、按文件探测 EOL、幂等。
- 跨 shell 命令一律 node 形态（sed/psql 已证环境差异）；bash 形态仅用于本会话内的交互核验。

