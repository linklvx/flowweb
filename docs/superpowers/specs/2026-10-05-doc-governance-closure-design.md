<!-- doc-status: active | note: 在建工程 spec（§5.6），结项后随批 5 翻完成 | verified_at: n/a -->
# 存量文档治理与 Yjs 上线残留收口设计（Spec）

> 日期：2026-10-05｜状态：v1.2 待用户确认（三阶段·第一阶段产出；v1.2 吸收第五轮复核 3 份裁决）
> 前置依赖：无（前置 0 自建基线）
> 关联：tech-debt.md（TD-17/18/21）、plans/socketio-retirement-assessment.md、plans/2026-09-30-collab-recovery-master-plan.md（完成档案）
> 来源：2026-10-05 全量非 vendor 文档逐份判定 + 四轮独立复核终裁，全部关键主张经代码实证

## v1.2 勘误与修订摘要（第五轮复核吸收——焦点：消灭"静默失效"）

1. **5.6 判据修正（P0）**：v1.1 的"含 dead 符号 ⇒ historical"让 canonical 文档**自我豁免**（存量死符号永远抓不到）——"含 dead 符号"是校验输出（红），不是分类输入；canonical 身份优先
2. **C1 引用形式枚举（P0）**：代码引用文档有三态写法（完整路径/裸文件名/裸短名如 `tech-debt`）——v1.1 只 grep 完整路径会**静默漏掉 master plan 与 tech-debt**（恰是最该守护的两份）；加扫描面自证+已知命中负例
3. **三分法**：canonical / **active（在建）** / historical——否则本 spec 自身按判据被判历史档
4. **historical 档注入一行 HTML 注释状态行**（`<!-- doc-status: historical | superseded-by: … -->`）——机器可读状态不止步于 canonical，agent 读文件第一行即知状态，不依赖先读 README
5. **门禁落点=根 scripts/doc-gate.mjs**：findRepoRoot（syncStatus.spec.ts 同款）+**扫零文件必红**（防 cwd 假设错→静默扫零→假绿）
6. **.worktrees 可回溯判断证伪**：实测嵌套 .git=0、git ls-files=0（纯目录副本，`git log --all` 恒空）——处置改"与主仓树 diff→删或移出工作区"
7. **verify-indexes.sql 三块两死一活+零引用孤儿**（:5 查询名全仓不存在、:10 表已 drop、:17-18 存在）——裁定方案 (a)：改名+删死块+接线
8. 干跑验收→**静态断言三件**（checkbox 计数==0/阻断块行序/关键词）；verified_at 增 **verified_at_commit**（单次 git log 判据）；命名规则区分一次性快照（必须日期）与活文档（禁日期）；adr 恒豁免句删除（冗余+违反无期豁免纪律）；credits UI 前置登记进 TD-21 条目本体；§九增"治理与所有权"元规则

**随 plan 评审（第六轮）微调**：dead-symbols 条目增 `scope` 字段（文件级/全仓级——裸符号名跨模块撞名：getProject 既死又活）；自校验扫描剥注释（墓碑注释不算存在，tombstone 白名单数据面取消）；自校验按 kind 分流（dead=scope 内零存在／never-built、frozen=不做代码存在性校验）；canonical/historical 统一 HTML 注释状态行形态；doc-gate 批 0 以 --warn-only 接入 verify 链首、批 4 转阻塞；credits 断言=双池和式且落 api int spec；verify-indexes 接线=node+pg runner 断言每块 ≥1 行。

## v1.1 勘误与修订摘要（第四轮复核吸收）

1. **去派生总数**：本 spec 落盘即使 §三 口令失效（specs 121→122）——正文一律不写文档总数，计数以命令输出为事实（同型缺陷第三次复发，就此封死）
2. **5.6 判据修正**：`plans/** ⇒ historical` 与 canonical 清单含 plan 矛盾——改为 `(plans/** ∧ ¬canonical) ∨ …`；ADR 独立目录豁免
3. **CRLF 前提修正**：git index 全 LF（i/crlf=0），"renormalize commit"是空操作——降级为 .gitattributes 配置变更，验收=git diff 为空
4. **删除清单补漏**：plans/2026-08-23-group-bugs-fix.md（139 行）——12 份 md 非 11
5. **canonical 补判据**（C1/C2/C3，清单可被判据推翻）；**豁免独立通道+仅绝对日期≤90 天**；**canonical 零违规上线不设棘轮**
6. **CLAUDE.md 政策条款不改**——删除授权由 dead-symbols 清单数据承载（防策略面散文例外侵蚀）
7. **资损校准提前**（批 1.5）；解除批 1↔批 2 伪串行；ARCHITECTURE 并入 README；PRD 第 6 个死机制（"仅创建者可见"=个人隔离模型 vs 团队模型）
8. verify-indexes.sql :7-10 查已 drop 的 UserBalance 约束=假绿块——删块+复核余块+纳入门禁扫描域；minio-data/ 未被忽略（真实风险，.gitignore 补）

---

## 一、背景与问题定义

Yjs 协同上线（collab 恢复工程批 0c~7 + 组升级 Spec A/B）后，存在四类与现状脱节的残留。2026-10-05 审计确认：**人工"修订 57 份文档"是垫片**——真根因是没有任何机制告诉读者哪份文档是权威的，且既有门禁设施（lint-gate 9 条规则 + 9 个扫描守卫）扫描域显式排除 docs。

问题分解：

| # | 问题 | 实证锚点 |
|---|---|---|
| P2 | **（根因）**文档系统无状态机，全量等权重（"新"≠"对"） | 全仓无 docs 索引；09-16 比作废它的 09-18 更"新"；spec-version 守卫绿反证——挂载了机器判据的文档不腐烂 |
| P1 | （症状）文档内容与代码冲突，照做会复活死机制/重复扣费 | phase4 描述 UserBalance 乐观锁+同步扣费；phase6 attempts:3 语义；autosave/undo-redo 整链已死 |
| P3 | （后果）代码侧半拆除——文档说 REST，代码留着 REST 客户端 | projectApi.ts 4 导出零引用；blacklist 双方法零调用；consume() 零生产调用 |
| P4 | （后果）物理放大源：工作区第二/第三文档树 | .worktrees 1134 md、.claude/worktrees 1133（含 node_modules）、backups 101、docs 根 PRD（.txt+.docx 零引用孤岛） |
| P5 | 流程性风险：plan checkbox=模板，状态真源在完成记录表 | master plan 171 个未勾选/0 已勾；superpowers executing-plans skill 会消费 checkbox → agent 可能重做已完成批次 |

## 二、目标与非目标

**目标：**
- G1 建立机器可复算的文档状态机（门禁 + 权威链 + 死符号清单 + DELETED 索引），使本次成为**最后一次人工审计**
- G2 消除高误导文档（删除 / 萃取 / 指针化，而非贴横幅）
- G3 代码侧半拆除收口（死导出 / 死方法 / 坏注释，TDD 形态）
- G4 目标级验收：随机抽 10 份非 canonical 文档按文档实施最小改动，不产生已删符号 / 已删 endpoint / 已 drop 列

**非目标：**
- 不修订 Spec B 两份 FROZEN 文档内容本体（结项后批 5 重扫）
- 不做 socket.io 退役本体（TD-21 域；含 execution:complete 死载荷删除——虽然评估判定零依赖可删，仍归 TD-21 第一步，不混入本工程）
- 不动 docs/vendor/ 22 份（README 显式排除声明）
- .worktrees/backups/brainstorm 批 5 只出处置对照表，用户拍板后执行
- 不建 archive/ 目录（git 为归档 + DELETED.md 为可发现性）

## 三、范围与口径（可复算）

语料 = docs/superpowers/**/*.md（specs/plans/adr/根）+ docs 根的 团队功能说明.md 与 PRD（.txt/.docx）。**正文不写文档总数**——计数以命令输出为事实（本 spec v1 写"121/251"落盘即失效的教训）：

```bash
find docs/superpowers/specs -name "*.md" | wc -l
find docs/superpowers/plans -name "*.md" | wc -l
find docs/superpowers/adr   -name "*.md" | wc -l   # v1.1 新设目录，初始 0
find docs/superpowers -maxdepth 1 -name "*.md" | wc -l
```

门禁脚本（node mjs，批 0 落地）是口径的**唯一权威**——处置清单由脚本输出（`node scripts/doc-gate.mjs --list-canonical / --list-historical`），bash 命令仅为同源速查。**验收项：README 与 spec 正文不得出现可漂移的文档总数/份数**（含"~191 份"这类无来源数字——它是已证伪的 259 的算术残余）。

**脚本落点（v1.2 定死）**：`scripts/doc-gate.mjs`（根 scripts/——文档门禁是仓级关注，不属于 web 包；根 package.json lint=`turbo run lint` 路由到包内，根 scripts/ 是既有仓级脚本先例位）。**两条防静默失效断言**：①findRepoRoot 向上找 pnpm-workspace.yaml（syncStatus.spec.ts:13 同款，6 层找不到即 throw）；②**扫零文件必红**（`scannedFiles <= N` ⇒ exit 1——防 cwd 假设错导致 readdirSync 抛错或静默扫零的假绿）。

历史勘误：首轮审计"259"系双重计数（`*spec*`/`*plan*` glob 交叉 4 + specb 3 在"252+7 杂项"重复相加）。**本工程所有处置清单必须附生成命令**（验收项）。

## 四、现状基线（2026-10-05 实证，全部已核）

| 事实 | 锚点 |
|---|---|
| spec-version-consistency 守卫**绿**（静态核锚点；以前置 0 实跑为准） | 三锚点齐全：PLAN `## 数字冻结表`:41 / `## 附录一`:382（均在 plan），SPEC H1 v3.20（"# 组几何所有权变更与 +号批量连线（Spec B）— 设计 spec v3.20"） |
| **git index 全 LF**（i/lf 2679 / i/crlf **0** / i/-text 91 / i/none 3）；工作区 w/crlf 1449 系 `core.autocrlf=true`（system 级）正常检出形态 | `git ls-files --eol`——**renormalize 是空操作**；.gitattributes 的价值=固化策略（eol 属性覆盖 autocrlf，CI/Linux 与 Windows 行为一致），非"净化脏文件" |
| .gitignore:15 死规则 + **minio-data/ 未被忽略** | `flowweb.dataminio/` 指向不存在路径（真实目录 flowweb.data/minio 已被 :16 `flowweb.data/` 覆盖）→ 删该行；`minio-data/` 独立顶层目录未被忽略（git status 恒显 ??，本地 MinIO 数据有误提交风险）→ 补忽略 |
| attempts 分层（非"被推翻"） | 全局 app.module.ts:49=3；execution/ai-image-edit 队列=1（批 0c 注释在案）；storyboard=2、subscription=3、video-separate 按 3 设计 |
| execute 同步路径仍活 | executionApi.executeWorkflow POST /execution/execute（x-intent-id）；TD-18 登记"统一入队"未做 |
| loadProjectIntoStore 死符号 | 文档侧 37 处 / 15 份（代码零定义） |
| 批 1 死码 | projectApi.ts 4 导出全仓零 import；auth.service.ts:32-50 双方法零生产调用（仅自测引用）；team-credit.service.ts:58 consume() 零生产调用 |
| master plan 状态矛盾 | 171 未勾选/0 已勾（全仓 plan 共性）；65 行「4a 待执行」vs 67 行 4b 备注引 62b5d314（批 4a 实际完成）——真实数据错误 |
| PRD 内部自相矛盾 | 11 行技术栈 Better Auth vs 102 行功能节 Keycloak；.docx 18745B / .txt 10547B 内容差异待核；**第 6 个死机制**：:102"仅创建者可查看编辑修改自己的数据"=个人隔离模型，与团队协作模型（teamId 非空+两层角色）方向相反 |
| verify-indexes.sql 假绿块 | **三块两死一活+零引用孤儿**（v1.2 修正：比 v1.1 描述严重）：:5 查 `UserSubscription_userId_active_key`——**该名全仓从未存在**（真名是 migration 20260829201000:104 的 `user_subscription_one_active`）；:7-10 查已 drop 的 UserBalance 约束；:17-18 复合索引存在（init:701/704）。grep 全仓（apps/packages/scripts/.github/package.json）零引用——接线前无实际后果，风险=将来被接线并信任 |
| 撤销上限 100 现行 | canvasUndo.ts:12 `STACK_LIMIT = 100` |
| 死符号族（生产零残留，部分存于注释） | zundo / flowweb_canvas_v2 / isHydrating / UserBalance / CanvasNode / CanvasEdge / saveCanvas / deleteRefs / syncCanvas / pickStructNodes / useCanvasPersistence / canvasSnapshot / loadProjectIntoStore / templateData / Keycloak（never-built） |
| 既有门禁范式 | lint-gate.mjs 9 条规则+棘轮 allowlist（lint-gate-constants.mjs）；扫描型守卫 9 个（syncStatus.spec / template.market-removal.guard 等）；spec-version-consistency.guard.test（文档参与门禁先例）；扫描域显式排除 docs |

## 五、核心机制设计（判据源六件套）

### 5.1 docs/README.md（放 docs/ 根，覆盖 PRD/团队功能说明两个历史逃逸区）

内容六件事：
①**权威链第一条写死**：`代码（含 schema/类型/守卫测试）> canonical 文档 > 历史记录`——任何文档与代码冲突一律以代码为准，并须提 spec 修正文档（一句话覆盖大部分未来漂移）；
②权威链（见 5.4 判据派生的清单，当前值随批次日更，不写死份数）；
③兜底规则——**清单外任何文档一律视为历史设计记录，实现歧义以代码+权威文档为准，禁止用历史文档反推现状**；
④排除声明（vendor / .worktrees / .claude/worktrees / backups / brainstorm 不在扫描域；docs/ 根文件逐名列举，禁通配防新增文件自动豁免）；
⑤全局声明——**plan 的 `- [ ]` 为任务模板，状态以完成记录表 + commit 为准**（一条声明覆盖所有 plan）；
⑥**ARCHITECTURE 节**（不另建顶层文件，防新逃逸区）：PRD 萃取的产品定位句+现行技术栈块（约 15 行）+ 每域一行权威文档指针；PRD 的内部矛盾注记**不入本节**（留 DELETED.md 死因列）。

**verified_at 三条操作规则**（写入 README 操作节，让新鲜度成为改代码时的义务）：a) `anchors` 限定为**契约文件**（docShape.ts / canvasIntents.ts / schema.prisma / 相关守卫测试），不指整个 src/；b) `warn_deadline = verified_at + 180d` 显式字段，到期升红；c) 改动 A 契约文件 ⇒ 同一 commit 内更新指向 A 的 canonical 文档 verified_at。**d)（v1.2）状态行增 `verified_at_commit`**——新鲜度判据用 `git log --oneline <verified_at_commit>..HEAD -- <anchors…>` **单次调用**覆盖全部 anchors（数十份 × 多 anchors 的逐文件 git log 会给每次 verify 加 5~15s；且 commit 区间比较消除时钟/时区偏差）。

### 5.2 docs/_meta/ 死符号清单（门禁唯一输入，带证据链；亦是删除授权面）

三分类：`dead`（曾存在已删）/ `never-built`（从未实现，如 Keycloak）/ `frozen`（现行通道勿误杀，如 emitNodeStatus）。每条含 symbol / kind / removedIn(commit) / reason。**门禁双向自校验**：①清单内 dead 符号在代码扫描域（apps/*/src + packages/*/src + prisma/verify-indexes.sql 等运维脚本，**不含** migration SQL——partial index 真相源在 SQL，显式声明不扫）确不存在，防符号回流；②canonical 文档禁现 dead 符号。

**删除授权语义（替代修改 CLAUDE.md 政策条款）**：不改 CLAUDE.md"不删既存无效代码"原则——README 操作规则写明"删除**清单内**符号=已授权动作；删除清单**外**的既存无效代码=须先登记进清单（附 removedIn/reason）再删"。政策不动、授权可审计、清单是唯一入口。

### 5.3 lint-gate 第 10 条规则（接入既有基建，不立孤立 spec）

- vocabulary 检查**仅扫 canonical allowlist**（历史档按 5.6 机器派生豁免）；宁漏报不误报（syncStatus.spec.ts:34 先例）
- **零违规上线，不设棘轮**：canonical 初始仅数十份且批 1.5/3 本来就要改它们——棘轮（单调下降）为海量存量设计，此处自相矛盾；若确有短期无法清的残留，须写死上限数字+到期日且到期值=0
- **豁免走独立通道（不进棘轮计数）**：叙述性豁免（"该机制已删"说明文字）必须有 `expires_at`——**仅允许绝对日期，禁止 milestone 形态**（门禁无法判定"批 5 是否完成"），硬上限 **90 天**，到期门禁红并输出"新增豁免 N 条/已到期 M 条"
- md 路径引用存在性：只查路径存在，**不查行号**；引用必须目录限定（`specs/xxx.md` 而非裸 `xxx.md`，消同名歧义——已知 td5-6-8 等 specs/plans 同名）
- **新增文档命名规则**（只约束新增，存量不改名——改名会撞 spec-version 守卫等路径硬编码；v1.2 二分）：**一次性快照**（specs/plans 设计与实施文档）必须 `YYYY-MM-DD-<slug>` 日期前缀+目录正确，**禁裸名新增**（裸名是存量口径混乱的源头）；**活文档**（台账/清单/checklist/README/ADR 等持续更新者）**禁日期前缀**（日期暗示"一次性"，误导读者以为不再更新）；`-design`/`-plan` 等既有后缀惯例沿用，不强制统一
- 上线前先在现有语料跑误报率（已知 d.ts 路径假阳性形态 7 条）
- **agent 干跑验收改静态断言**（v1.2——干跑不可进 CI、不可机器判定，违反 G1）：①目标 plan 内 `^- \[ \]` 计数 == 0；②阻断块行号 < `> **For agentic workers:**` 行号（顺序断言）；③阻断块文本含"已完成/勿按 checkbox 执行"关键词——三条全覆盖干跑想验证的东西，成本≈0

### 5.4 canonical：判据先行，清单是派生物（两步走，防"给待拆的墙刷漆"）

**入选判据（可机器判定，清单可被判据推翻、判据不能被清单推翻；v1.2 补 C4）：**

```
canonical ⟺ 满足任一：
  C1 被代码/测试/CI 引用——**引用形式三态全枚举**（v1.2：只 grep 完整路径会静默漏掉裸名引用）：
     完整路径（docs/superpowers/…）/ 裸文件名（2026-09-30-collab-recovery-master-plan）/
     裸短名（tech-debt、gate-checklist、socketio-assessment）——扫描域 apps/**、packages/**、scripts/**、.github/**
  C2 唯一承载某现行不变量且该不变量有守卫断言
  C3 面向用户的产品说明（团队功能说明.md）或运维基线（deployment-db-baseline.md）
  C4 被 canonical 文档引用（入引用 ≥2）的活文档（v1.2：如 video-editor.md——9 份文档的需求锚点，
     C1/C2/C3 全不满足但事实权威；**仅统计 C1 命中文档的入引用**——打破"清单派生依赖清单"的自引用递归）
排除：status≠ACTIVE/CANONICAL 者
```

**扫描面自证 + 已知命中负例（v1.2 防静默漏）**：门禁自带断言——已知 C1 命中（Spec B spec+plan、master plan、gate-checklist、tech-debt、canvas-domain-theme、css-base-layer-theme）在候选集中**必须出现**，任一缺失即红（否则 grep 形态变化会让清单静默缩水——master plan 与 tech-debt 恰是裸名引用，恰含存量 dead 符号，恰最该守护）。

清单落 `_meta/canonical.json`：每项带 `criteria: "C1"|"C2"|"C3"|"C4"` + `evidence`（命中行），人工增补必须写 C2/C3/C4+理由——**清单即日志**，不需要"重跑手写清单核对"这个中间动作（v1.2 删）。

- **批 0**：按判据由脚本生成清单（含三态引用枚举+负例自证）
- **批 4**：删改完成后，幸存者注入**文档头状态行**（HTML 注释形态，与 historical 状态行统一——单一解析器+幂等简单+零 `^#` 谓词风险；字段：status/anchors/superseded_by/**verified_at+verified_at_commit**）+ 新鲜度判据（见 5.1 操作规则）。**注入以文件系统为准**（批 0 清单是常量，删除发生后集合运算可能失配）+ **门禁加断言：canonical 清单项指向不存在的文件 ⇒ 红**（防清单腐烂，C1 grep 派生面在文件删除后不会自动缩）。注入块**不得含 `^#`/`^## ` 行**（spec-version 守卫按谓词抓标题行——SPEC H1 依赖小写 `spec` 字样）；Spec B 两文件注入后必跑 spec-version 测试+全量 web 套件

### 5.5 docs/superpowers/DELETED.md

| 文件 | 删除 commit | 死因 | 决策承载于 |
|---|---|---|---|

git 为归档，DELETED.md 为可发现性（"在 git 里"只在知道文件名时成立）。批 2 起逐行登记。

### 5.6 状态三分与机器派生判据（不人工打标；v1.2 修正静默失效）

**"含 dead 符号"是校验输出（红），不是分类输入**——v1.1 的"含 dead 符号 ⇒ historical"让 canonical 文档自我豁免（phase4 含 UserBalance 会被判 historical → 门外 → 永远抓不到）。修正后判据（**canonical 身份优先**）：

```
canonical  = 5.4 清单命中 → vocabulary 校验适用（含 dead 符号 ⇒ 红，含叙述性豁免通道）
active     = status: ACTIVE ∧ 批次表存在非"完成"行（在建工程文档，如本 spec/后续 plan）
             → vocabulary 校验适用，但不进权威链
historical = (plans/** ∨ 无 canonical 入引用) ∧ ¬canonical ∧ ¬active
ordinary   = 其余（既非 canonical 也非 historical 的活文档，如独立域 spec）→ 校验豁免，
             可经 C4 入引用数 ≥2 晋升 canonical
（adr/ 无需特权条款——不在 canonical 清单即自然在 vocabulary 扫描域外，
  其引用受 5.3 存在性检查约束=唯一机器约束，正好）
```

**historical 档注入一行 HTML 注释状态行**（v1.2 新增——机器可读状态不止步于 canonical）：

```html
<!-- doc-status: historical | superseded-by: specs/2026-XX-YY-<slug>.md | verified_at: n/a -->
```

由 5.6 分类器**同趟输出写回**（零新增人工）；HTML 注释 markdown 渲染不可见、不含 `^#` 行（满足 spec-version 守卫约束）、不改路径。**效果**：agent/读者打开文件第一行即知状态，不依赖先读 README——P5 的机制级闭合（README 兜底规则只挡"读过 README 的人"，挡不住直接读文件的 agent）。

## 六、处置分类结论（审计+四轮复核终裁）

### 6.1 删除（12 份 md + PRD 2 份；存在性核对命令——可粘贴执行）：

```bash
for f in canvas-refresh-data-loss-fix td2-allimages-unify-td1-projectid-fix \
         td4-hydrate-window-seal td5-6-8-persistence-refactor 2026-08-23-group-bugs-fix; do
  ls docs/superpowers/specs/$f.md docs/superpowers/plans/$f.md
done; ls docs/superpowers/plans/smoke-dual-client.md docs/superpowers/specs/account_balance.md
```

| 文件 | 死因 | 决策承载 |
|---|---|---|
| specs+plans/canvas-refresh-data-loss-fix.md | 四 Fix 全绑死 localStorage 双 key 恢复链 | tech-debt TD-5/6 已清账行 |
| specs+plans/td2-allimages-unify-td1-projectid-fix.md | deleteRefs 已被 TD-15 删 | TD-2/TD-1 清账行 |
| specs+plans/td4-hydrate-window-seal.md | isHydrating 机制已亡 | TD-4 清账行 |
| specs+plans/td5-6-8-persistence-refactor.md | flowweb_canvas_v2 本体已死 | TD-5/6 清账行 |
| **specs+plans**/2026-08-23-group-bugs-fix.md（v1.1 补 plan，139 行） | Fix 全是 REST+localStorage 机制，照做会复活已删代码 | Spec A/B + 08-24 spec |
| plans/smoke-dual-client.md | 已被 gate-checklist 归并节显式归并 | gate-checklist + master plan 批注 |
| specs/account_balance.md | UserBalance 方案从未落地 | TeamBalance 双字段已吸收动机 |
| docs/AI多模态…产品设计文档.txt/.docx | 6 个死/未实现机制（含"仅创建者可见"个人隔离模型）+零引用孤岛（先萃取，见批 2） | 萃取约 15 行入 docs/README.md 的 ARCHITECTURE 节 |

**前置（删除前逐项完成）**：①修 3 处引用行——apps/web/e2e/collab-recovery.e2e.spec.ts:6 注释改指 gate-checklist、specs/canvas-create-unify-fix.md:5 前置行、specs/2026-08-24-shift-multiselect-toolbar-suppress.md:10 历史归属行（改指 DELETED.md）；②短文档唯一结论萃取核对（account_balance 等，核对对象是**现行活代码**如 team-credit.service，与批 1 被删项无交集）。

### 6.2 修订分级（按误读后果排序，非按主题）

- **批 1.5 资损两件（内联+文头双标注，文头横幅拦不住照步骤做的人；不依赖批 1，材料在 §四基线已齐）**：phase4-execution-pipeline、phase6-bullmq-complete。措辞三定：socket=/execution **仍为现行通道**（退役计划见 TD-21，非"冻结退役"）；attempts=**分层精准覆盖**（全局仍 3，付费队列显式 1——另登记 tech-debt："付费能力新队列静默继承全局 3"风险+守卫断言提案）；execute=**同步路径仍在、TD-18 未做**。phase2 一并处理（持久化章节整段指针化，非加注）
- **批 3 canonical 校准**：团队功能说明 3 处（归属已可选/模板行删/充值已通）；tech-debt 已清账行加退役指针（保留原措辞——台账记录当时事实）；socketio-assessment 状态注
- **批 4 历史档三分法**：spec 机制全死→删／部分有效→指针化重写／含否决论证（autosave 否决 CRDT、phase2 ReactFlow 选型）→抽 `adr/NNNN-<slug>.md`（**独立目录 docs/superpowers/adr/**——不污染 specs 计数、无需特权条款〔不在 canonical 清单即自然在 vocabulary 扫描域外〕、计数命令单列一行；骨架=Decision/Rejected 各一条+日期+Superseded-by+Status: Rejected，≤1 页，其引用进 5.3 存在性检查=其唯一机器约束，防孤岛化）后删；plan→一律历史档（机器派生，无需逐份动作）；**含漏审 4 份 09-28**（pan-select spec 死符号段标注、r0-hotfix/r1-infra/pan-select plan 归历史档）
- 原 P3"28 份统一⚠️注"**取消**——被 5.6 机器派生+门禁替代（21 份已带【已废止】横幅的先例表明手写横幅会推高噪声至失效）

### 6.3 保留（其余文档，聚类；份数以门禁统计为准，不写死）

现行权威（5.4 清单）/ 一次性已清账无误导面（td9/td10/cleanup-batch4 等）/ 独立域与协同无关（minio×6、支付×12、登录×6、lighting×6、audio-waveform×4 等）/ 纯 UI 交互 / 运维杂项（full-stack-backup、deployment-db-baseline）。

## 七、批次划分与验收

| 批 | 内容 | 验收 |
|---|---|---|
| 前置 0 | pnpm verify 建基线 | 记录既有红绿清单（静态核 spec-version 守卫锚点齐全，实跑为准） |
| 批 0 | ① **master plan 原子动作**（一次提交）：顶部 agent 阻断块（**必须置于 `> **For agentic workers:**` 行之前**，顺序错则无效；措辞：⛔ 本 plan 已完成（2026-10-01 批 7 gate 9/9 绿），状态真源=完成记录表，正文 `- [ ]` 为任务模板勿按其执行）+ status 翻完成态 + 171 checkbox 文本化 + 4a 行按 62b5d314 回填"完成"；README 同步落全局 checkbox 声明 ② canonical 判据 C1~C4 → 脚本派生清单落 `_meta/canonical.json`（criteria+evidence） ③ _meta 死符号清单+双向自校验 ④ **scripts/doc-gate.mjs**（findRepoRoot+扫零必红+三态引用枚举+已知命中负例+零违规上线不设棘轮+豁免独立通道≤90 天；误报率先行） ⑤ .gitattributes(\*.md eol=lf)+.editorconfig（低风险配置，验收=git diff 为空）+.gitignore 删 :15 死规则+补 `minio-data/` ⑥ docs/README.md（权威链第一条=代码优先+ARCHITECTURE 节+verified_at 操作规则+排除声明） ⑦ DELETED.md | doc-gate **先红后绿**（canonical 夹具注入死符号必红/移除必绿；扫零必红自证）；**静态断言三件**：master plan `^- \[ \]` 计数==0、阻断块行号<For agentic workers 行号、含"已完成"关键词；负例自证（master plan/tech-debt 必在 canonical 候选集）；README 链接全有效；.gitattributes 后 git diff 为空 |
| 批 1.5 | 资损校准：phase4/phase6/phase2（6.2 措辞三定；纯文档，不依赖批 1，材料=§四基线） | 死符号门禁绿（三份按三分法明确形态：指针化/豁免登记） |
| 批 1 | 代码半拆除（与批 1.5/2 无真依赖——萃取核对对象是活代码；唯一真约束是批 4 注入须在批 2 删除后）：projectApi.ts 整删、auth.service blacklist 双方法+自测用例、consume() 连带两个 describe 块、**verify-indexes.sql 方案 (a)**（:5 改 `user_subscription_one_active`、删 :7-10 死块、保留 :17-18、**接线**进 apps/api package.json scripts〔如 verify:indexes〕——否则仍是孤儿）、seed.ts:175 注释核对 | 每项 git grep 零引用断言先红→删→api+web 全量绿+verify 绿；**每项删除在同一 commit 内回填 _meta 的 removedIn=该 commit hash**（防批 3 延后造成 tech-debt 指针悬空无自证）；verify-indexes.sql 纳入 5.2 扫描域（判据：**历史事实载体〔migrations〕不扫；现行断言载体〔verify 脚本/守卫测试〕必扫**） |
| 批 2 | 删 12 份（前置引用行修正）+PRD 萃取约 15 行（定位句+现行技术栈；**docx/txt 先转 md 逐节比对，比对产物为临时文件不提交**，冲突按权威链裁决）入 docs/README.md ARCHITECTURE 节→退役+DELETED 登记 | 删除后 git grep 每个被删文件名在残留文档零命中；**清单附生成命令** |
| 批 3 | canonical 校准（6.2 第二档） | 每批同步 README 权威表；tech-debt 退役指针不改正文原措辞 |
| 批 4 | 三分法+漏审 4 份+幸存 canonical front-matter 注入+**historical 档 HTML 状态行写回**（分类器同趟输出） | Spec B 两文件注入后 spec-version+全量 web 绿；vocabulary 门禁绿；**canonical 清单项指向不存在文件 ⇒ 红**（注入以文件系统为准） |
| 批 5 | Spec B 结项后全量重扫；**credits 双断言**：DB 不变量 gate 用例（TeamBalance 差值==GenerationIntent.creditsConsumed 且终态唯一——通道无关）+ **credits UI 刷新覆盖面登记进 tech-debt.md 的 TD-21 条目本体**（退役时才被读到，本 spec 结项后无人翻）；三树处置对照表（用户拍板） | 总验收（下） |

**总验收（唯一标准，不靠人眼）**：pnpm verify 绿 + 文档门禁绿 + README 链接有效 + 抽 10 份非 canonical 文档按文档实施最小改动不产生死符号/死端点/死列 + 每份处置清单附可复算生成命令 + **README 与 spec 正文无任何可漂移的文档总数** + 新增 canonical 必须登记 C1/C2/C3 命中依据。

## 八、代码变更与 TDD 形态汇总

| 变更 | 形态 |
|---|---|
| 批 0④ lint-gate 规则 | 先红（夹具注入死符号到 canonical 样本）后绿；零违规上线 |
| 批 1 死码五项（含 verify-indexes.sql 死块） | 零引用断言先红→删→绿；consume 连带测试块同删（防删实现留测试必红） |
| 批 5 credits gate 用例 | 断言先行（生成前后余额差==intent 记录且无重复 settle） |

## 九、风险与纪律

1. **豁免必须带绝对日期 TTL（≤90 天）且走独立通道**——无期豁免=批 0e setState 白名单教训复发；milestone 形态不可机器判定，禁用；
2. 门禁规则先测误报率再上门禁（已知假阳性形态：d.ts 路径、叙述性"已删"文字）；
3. EOL 事实：`core.autocrlf=true` 为 **system 级**（CI/Linux 不生效，行为不同）；git index 全 LF，工作区 CRLF 是正常检出形态——.gitattributes 的作用是把 eol 策略显式化（跨平台一致），**不是净化操作**；其 commit 与内容编辑分开即可；
4. 批次真依赖只有一条：**批 4 front-matter 注入须在批 2 删除之后**（只给幸存者注入）；批 1 与批 1.5/2 无代码依赖（v1"萃取需读代码自证"的串行理由系逻辑颠倒——先删码反而失去证据，而萃取核对对象本就是活代码）；
5. front-matter 注入块禁含 `^#` 行（spec-version 守卫谓词抓取）；
6. 死符号清单显式声明**不扫 migration SQL**（partial index 真相源在 SQL，schema.prisma:989 注记）；
7. 生成命令以 bash 形态给出（本仓开发环境 shell=bash），门禁脚本（node mjs）为口径唯一权威，两者输出须同源。

### 治理与所有权（v1.2 新增——没有 owner 的机制会静默腐烂）

- **dead 符号登记是删除动作的一部分**：删除清单外既存无效代码者，须在同一 commit 内登记 `_meta`（symbol/removedIn=该 commit/reason）——与 5.2"删除授权语义"闭环，无需专人
- **到期复核节奏**：豁免 `expires_at` 到期由门禁红强制触发（谁触发谁处理）；canonical `warn_deadline` 到期由 doc-gate 输出清单驱动，挂批 5 后常规维护
- **元规则**：任何新增门禁规则必须同时定义其**误报率测试**与**豁免通道**（含 TTL）——无测试的规则=假绿，无 TTL 的豁免=永久豁免
- **canonical 增补**：新文档入 canonical 必须登记 C1~C4 命中依据（criteria+evidence），否则批 4 注入时退回人工判断

## 十、待裁决残留（批 5 前用户拍板）

三树按可恢复性分四类处置（v1"均不可恢复"判断有误）：

| 对象 | 可恢复性 | 建议 |
|---|---|---|
| .claude/worktrees/（1133 md+node_modules） | 会话工作树副产物，含完整 node_modules=纯磁盘垃圾 | 建议删除（批 5 用户拍板） |
| .worktrees/（1134 md，旧仓库**目录副本**） | **不可回溯**（v1.2 勘误：实测嵌套 .git=0、git ls-files=0——`git log --all` 恒空，"git 历史自证"是永远无法成功的验证） | 与主仓当前树做**目录级 diff** 确认无独有内容 → 删除；不确定则**移出工作区**（如 D:\flowweb-archive\）——留在工作区=承认第二文档树长期存在，与 P4 处置目标矛盾 |
| backups/（101 md，v3.3/v3.4/V3.10 版本快照） | 用户手动资产，**不替删** | 用户自行确认 v3.10 后决定 |
| .superpowers/brainstorm/（18 session，零 md） | 会话产物，未版本化 | **移出工作区**（v1.2 升级：排除声明只约束门禁扫描域，不约束 agent 的 glob/grep——移出成本极低） |

另：PRD .docx/.txt 差异（批 2 转 md 逐节比对，冲突按权威链裁决——"以更全者为准"不可操作，大小跨格式不可比）。

---

## 附录 A：修订要点明细（批 1.5/3 执行依据，来自审计终裁）

| 文件 | 过时点/修改要点 |
|---|---|
| phase4 spec+plan | ①扣费=UserBalance 乐观锁→TeamCreditService reserve→settle ②执行=同步 HTTP 与 BullMQ 并存（TD-18 未做）+GenerationIntent 幂等+读 doc 节点 ③socket=现行通道见 TD-21 |
| phase6 spec+plan | attempts 分层表述（见 6.2 措辞三定）；bull→bullmq 迁移决策史保留 |
| phase2 spec+plan | 持久化章节（localStorage+REST 批量同步+CanvasNode/Edge 行式模型）整段指针化；ReactFlow 选型论证抽 ADR |
| 团队功能说明.md | §1.2 归属口径重写（create 已接收 teamId，双页签+当前团队归属）；§2.4 删"模板保存为团队模板"行；§5 删"充值未接线" |
| tech-debt.md | TD-4/5/6/8/15 清账行尾加"→ 机制已于 X 退役，见 <successor>"指针，原措辞不动 |
| master plan | 顶部阻断块+翻完成态历史档+171 checkbox 文本化+4a 行校正 |
| socketio-assessment | 文头加"状态注：/execution 现行通道，本文结论=保留+冻结分两步退役（TD-21）" |
| auth spec+plan | JWT 双令牌/refresh/blacklist 标注从未实现（实为 session cookie）——blacklist 死码批 1 删 |
| folder-persistence spec+plan | Template 模型三处相悖（status/templateData 已删、teamId 已加、快照走 CanvasDoc） |
| canvas-autosave-design | 文头退役横幅+**保留否决 CRDT 论证**（抽 adr/ 后处置） |
| canvas-undo-redo | 引擎替换注（zundo→Y.UndoManager，STACK_LIMIT=100 现行） |
| canvas-create-unify-fix | Fix5 已退役注；Fix6-8（advisory lock）仍现行标注 |
| history-page / template-marketplace / td11 / blank-node-size / 09-16-video-works | 批 4 现场按三分法逐份判定，判定步骤：①grep 该文档是否含 §四 死符号族→含且机制主体已死⇒删；②仍活部分≥50%⇒指针化重写（过时段落替换为"见 <canonical 或 ADR>"）；③含"为什么否决 X"论证⇒先抽 adr/ 再处置。已知锚点：history-page/template-marketplace=userId→teamId 维度漂移；td11=保留 fileId 语义分化表；blank-node-size=保留方案 A/B 否决理由；09-16=/candidates 已删注 |
| 漏审 4 份 09-28 | pan-select spec 死符号段（pickStructNodes/canvasHistory/useCanvasPersistence）；r0/r1/pan-select plan 归历史档 |

