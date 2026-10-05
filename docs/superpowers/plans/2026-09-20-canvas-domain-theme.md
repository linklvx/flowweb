<!-- doc-status: canonical | anchors: - | superseded_by: - | verified_at: 2026-10-06 | verified_at_commit: 122cdf81 -->
# C8 画布域主题跟随 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画布域（含 video-editor 壳、videos 播放壳、WeChatFollowModal、CreditsDropdown、MaterialLibrary）全量跟随浅/深主题；主题模型两态化（删 system 档），默认深色。

**Architecture:** 主题真源 = html `.light`/`.dark` 类（防闪白内联脚本挂类 + themeStore 两态单值）；antd algorithm / ReactFlow colorMode / CSS 变量三通道同源由 `mode` 推导。迁移按 spec 七段执行：D0-0 仪器先行（采集器/differ/探针/台账脚本，before-D 深浅双基线采于 D0 收口后）→ D0 两态六件套 → D1a 定义层双值化（深档零 diff）→ D1b 并域+有意变更配对 → D2 colorMode 翻转 → D3 registry 清单逐域原子对迁移 → D4 收口全门禁。

**Tech Stack:** React 18 + xyflow 12.10.2 + antd 5（cssinjs）+ Tailwind（token 工具类 + 任意值 var）+ Playwright（preview:5173 产物门禁）+ vitest（jsdom）+ 自研门禁（lint-gate.mjs / css-baseline-diff.mjs / b0/b1/c0 e2e）。

**Spec:** `docs/superpowers/specs/2026-09-20-canvas-domain-theme-design.md`（v1.5 定稿冻结——实施期分歧以 registry 产出与 contrast-table.mjs 实测为准，不回改 spec 全文，走变更登记）。

---

## 执行总纲（先读）

0. **节奏停点**：Task 1-5（D0-0 全部仪器件）**一轮做完停一次**——拿 `e2e/audit/d0-probe-values.json`（探针钉值）+ 自比自跑噪声报告 + registry 产出回来复核，确认仪器可信后再进 D0 代码段（Task 6+）。
   - **before-D 采集窗口在 Task 10（D0 收口后、D1a 前），不在 Task 5**（第五轮 P0-1 修订）：D0 的 CanvasTopBar 新钮/TopActionBar 换钮是有意 DOM 变更（新增 dom: 键——配对闸必红；44px 平移半句第六轮删——几何层有 C:cascade 归因通道未必红，决定性论据只有配对闸），"D0 零 diff"在数学上不成立。基线语义 = **f(前置 commit, 采集器版本)**（Task 4 自比自跑已证采集器确定性）——Task 10 收口后采 before-D（深档）+ before-D-light（浅档 REAL_LIGHT）一对，此后 D1a 起各段 diff 均以它为锚。**入档后采集器冻结令=口径冻结（snapshotDom 函数体/页面清单/沉降/注入机制；指纹守卫 a0-collector-fingerprint.txt，Task 10 Step 4 详）——探针断言与注释不在冻结面**（第六轮语义化：Task 15/17/21/26 的探针反转改动合法）。
   - **light-B6 旧浅档基线不可复用**（属性集 A0 无 backgroundColor/color 全元素——Task 3 新加的同代校验会直接 exit 1 拦住，这是预期行为非误报）；浅档参照只有 before-D-light 一套。
   - **采集账号纪律**：采集用 USER 态 = seed 门禁账号，works 页元素集=f(seed)；D 段期间禁用该账号手工建画布/改数据（gate-seed 每次 e2e 运行幂等刷新，单仓 commit 已锚定 seed+API 源——无需额外机制，靠纪律）。
1. **段顺序不可换（spec §15 三把锁）**：D1 必须先于 D2；D2 与 D3 板面批次连续收口（中间态浅色画布不可用，禁止在 D2–D3 空隙做浅色档验收）；"深色档零 diff"验收锚只适用 D0-0/D0/D1a，D1b 起深档 diff 由 §9.2 总清单配对吸收（未配对=失败），D3 各域由域原子对清单吸收。
   - **配对闸已知残余（第六轮收窄 + 第七轮分类）**：differExpectedPairs 支持**可选 page 字段**（Task 3 Step 2 ④ 两级匹配：page 限定优先、全局兜底——**helper absorbedBy() 已接线三处属性块，第七轮 P1-1**）——跨位点误吸收面从"全仓"收窄到"同页"。**残余分两类（registry notes 同步登记，D3 三源核销按类别核，勿笼统写"已知残余"）**：① **全局继承族**："继承型"变更（body 底色/前景 → 全体无显式色元素的继承链）天然跨页，page 字段对它无效——此类必须**永久全局配对**（D1a body 两对即首例，见 Task 12/13）；② **元素级局部变更**：已由 page 字段收窄到同页。浅侧 pairs 量大的段（D2 板面/D3 各域）登记时**优先带 page**，全局配对只留给确属跨页同值的色对与全局继承族。残余补偿不变：每条配对附 why + D3 三源核销（清单/浅探针/B6）。
2. **原子对纪律**：每域/每岛拆除与断言反转同 commit；重构与有意视觉变更不得同 commit（differ 信号保全）。
3. **基线纪律**：禁 `UPDATE_BASELINE=1` 重采；A5 旧基线对（before-A0 × after-A）保持冻结管 A/B 段；本期新增独立 D 段基线对**两条**（before-D 深 × working 侧；before-D-light 浅 × working 侧 REAL_LIGHT——浅档是 C8 的目标方向，机械守卫不能只守"深档不变"）。after-D 不是一次性产物——每次段验收按当前 checkout 重新采集 working 侧快照比对。**浅侧 diff 的有意变更同样入 differExpectedPairs**（D1a 起浅侧已知中间态/各段翻转值全部预先可知：D1a=域 token 浅值落点、D2=板面、D3=各域，值表即 Task 11 DOMAIN_LIGHT）。**segcheck 结论留痕（§0 复核 P3-2 登记，Task 13 起每段执行）**：段验收清理原始产物前，把该段 dExpectedGate 要义（段名/深浅两侧 exit/absorbedByPair 键列/unexpected 计数）几行追加进常驻 `e2e/audit/c8-segcheck-log.md`——验收结论不能只活在 commit message 里（事后回溯无档可查）。
4. **常用命令**（全部在 `/d/flowweb/apps/web` 下执行；Bash CWD 会漂移，每条命令自带 `cd` 前缀；**命令均为 Git-Bash 形态**——`rm -rf`/`head` 等 PowerShell 下需换等价写法）：
   - 单测：`cd /d/flowweb/apps/web && npx vitest run <file>`
   - e2e 单文件：`cd /d/flowweb/apps/web && npx playwright test e2e/<file>`
   - 全门禁：`cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs && npx tsc --noEmit -p e2e/tsconfig.json`（⚠ e2e 经 playwright webServer 跑 `pnpm build`，而 build = `tsc -b && vite build`——**src 内任何 TS 类型不干净都以"preview 起不来/600s 超时"的形式在 e2e 层爆**，报错面不在类型层；e2e 自身的类型门禁=末尾 tsc 条（既有 e2e/tsconfig.json，Task 3 起逐段跑））
   - 基线采集（深）：`cd /d/flowweb/apps/web && COLLECT_BASELINE=1 BASELINE_DIR=<dir> npx playwright test e2e/a0-collect-baseline.spec.ts`
   - 基线采集（浅/REAL_LIGHT）：`cd /d/flowweb/apps/web && COLLECT_BASELINE=1 REAL_LIGHT=1 BASELINE_DIR=<dir>-light npx playwright test e2e/a0-collect-baseline.spec.ts`
   - 基线 diff：`cd /d/flowweb/apps/web && node scripts/css-baseline-diff.mjs --before before-D --after <segcheck-dir>`（D 深 对；浅对 `--before before-D-light --after <segcheck-dir>-light`；默认无参仍是 A5 旧行为）
   - **段验收双跑**（D1a 起）：深侧+浅侧各采一次各 diff 一次；两侧的有意变更都入 pairs，未配对=失败
   - segcheck 产物清理时 **.json 与 .md 一起删**（`--out` 前缀同时产出两者，漏删 .md 会被后续 `git add apps/web/e2e/audit/` 吃掉）
5. **探针生命周期表**（d-segment-probes.spec.ts 内每条探针注明所属段与翻转点；翻转在该段 commit 内同改。**全部探针断 computed 归一值**——var() 未被代换时 computed 落字面/空，同一断言可抓"代换失败"）：

| 探针 | D0-0 钉值（html.light 下） | 翻转段 → 新预期 |
|---|---|---|
| 画板 wrapper 底 | `rgb(0, 0, 0)`（colorMode 钉深） | D2 → `rgb(245, 245, 245)` |
| 画板网格点（读 `.react-flow__background` 的 `--xy-background-pattern-color-props` computed——自定义属性只向下继承，**不能从 wrapper 读**；Task 3 发现步同时读 `.react-flow__background circle` 的 computed `fill` 对照——若自定义属性返回未代换字面串（M5 假守卫风险）即改用 circle fill 断言，数据定形态） | `#555555` | D2 → `#c8c8c8` |
| gate 节点卡底 | `rgb(34, 34, 34)`（VideoGenNode:718 `bg-[#222222]` 卡面——**选择器必须锚卡面 div 非 `.canvas-node` 根**：根 :607 无底色（rgba(0,0,0,0)），用 `.react-flow__node[data-id="gate-node-1"] .canvas-node div.rounded-lg`；发现步照盘填） | D3-画板 → `rgb(255, 255, 255)`（**浅档白卡**——本探针恒 html.light 注入；深档变更 rgb(34,34,34)→rgb(30,30,30) 走 pairs） |
| CanvasTopBar 已连接前景 | `rgb(21, 128, 61)`（⚠ --fw-accent-text 是 B0 既有键，index.css:48 浅值 #15803d 早已生效——D0-0 即浅值，**无翻转点**，保留作浅档正向对照） | 不翻转 |
| videos 封面占位底 | `rgb(38, 38, 38)` | 不翻转（P6 内容垫底恒深，D4 组3 断言） |
| ve 壳底 | `rgb(20, 20, 20)` | D1b 仅键名并域（仍钉深：--fw-bg=#141414 + rgb(20,20,20) 不变）→ D3-ve → 双断言翻浅（--fw-bg `#f7f8fa` + 壳根 `rgb(247, 248, 250)`） |
| ve 面板底（EditorTopBar） | `rgb(38, 38, 38)` | D3-ve（壳岛拆除后）→ `rgb(240, 241, 242)`（--fw-surface-dim 浅值；D1b 并域期壳 .dark 岛仍钉深） |
| WeChatFollowModal 面前景 | `rgb(30, 30, 30)` / `rgb(226, 232, 240)` | D1b → `rgb(255, 255, 255)` / `rgb(31, 35, 41)` |
| VideoCard 卡标题前景 | `rgb(255, 255, 255)`（text-white 字面） | D3-videos → `rgb(31, 35, 41)`（卡面并 --fw-surface 浅 #ffffff 后白字白卡=不可见，必须探针化） |
| 图形档（D-6 发现步实测选定） | gate 画布真实渲染的 svg fill/stroke（GridIcon/粒子边不在 gate 渲染路径——见 D-6 注） | 不翻转；`--edge-flow-color` 无门禁覆盖（需粒子边）→ 显式登记 B6 目检兜底 |

---

## Task 1（D0-0 ⑴）: 四进程环境与 fixture 就位确认

零产品改动，只验证。四进程 = PostgreSQL + Redis（外部常驻）+ API(3000，collab 3001 同进程) + vite preview(5173)。playwright `webServer` 会自起后两者（`reuseExistingServer: false` 强制测自建 preview）；前两者必须已在跑。

**Files:** 无改动。

- [ ] **Step 1: 确认 PostgreSQL / Redis 在跑**

```bash
pg_isready -h localhost -p 5432 && redis-cli ping
```

Expected: `accepting connections` + `PONG`。失败则按 auto-memory `C:\Users\link\.claude\projects\D--flowweb\memory\project_startup.md`（启动流程备忘）启动基础设施后再继续；pg_isready/redis-cli 不在 PATH 时以端口探活替代（`netstat -an | grep -E "5432|6379"`）。

- [ ] **Step 2: 确认 gate fixture 与构建链路就位（跑一次现有全门禁）**

```bash
cd /d/flowweb/apps/web && npx playwright test
```

Expected: 41 passed + 5 skipped（collector skip；**用例数以当次输出为准，只作环境可用性判据**——Task 3 加探针后即变）。机制订正（第五轮）：**global-setup 只跑 `gate-seed.ts`（幂等，gate-canvas-1/gate-node-1/样例视频每次刷新）；migrate deploy 在 webServer[0] 的 command 里、API 已在跑时随复用整条跳过**——C8 零后端改动无新迁移，无影响；若 API 未在跑，webServer[0] 会自行 migrate+seed+起 API（300s 超时）。preview 5173 由 webServer[1] 自建（`reuseExistingServer: false`）。**此步兼验 `pnpm build`（= `tsc -b && vite build`）通过**——tsc 范围只有 `src`（tsconfig include），任何 src 内 TS 不干净都会以"preview 起不来/600s 超时"的形式在此爆红，报错面在 e2e 层而非类型层；**e2e/scripts 目录不在 tsc 范围**（第五轮 M8 实证）——e2e 类型门禁用**既有 `e2e/tsconfig.json`**（第六轮 B7：非新造配置——既有文件 extends base + noEmit + include e2e 全域，当前实跑 exit=0 干净），Task 3 起（首个新 spec 落地）纳入各段门禁命令，勿等 D4 收口堆类型债。**此步失败则修复环境后再进入 Task 2——扩了采集器却跑不通门禁等于白做（Task 4/10 的采集与窗口全都踩在这个环境上）。**

- [ ] **Step 3: 确认 USER storageState 就位**

```bash
cd /d/flowweb/apps/web && ls e2e/.auth/user.json
```

Expected: 文件存在（若缺失，跑一次 `npx playwright test e2e/a0-collect-baseline.spec.ts` 以外的任意需登录套件即可生成，或按 global-setup 说明手动登录生成）。

---

## Task 2（D0-0 ⑵a）: contrast-table.mjs 对比度台账脚本（自检向量 TDD）

spec §6-③（:87 动作 3）：全文对比度数字以脚本出表为准；内建自检向量不通过 `exit 1`（spec 在册 3 条 21.00/4.54/2.82 + 本计划补第 4 锚 #777777=4.48 组成双区分度）。

**Files:**
- Create: `apps/web/scripts/contrast-table.mjs`
- Create: `apps/web/e2e/audit/contrast-pairs.json`（配对表输入）

- [ ] **Step 1: 写配对表（spec 在册数字全量入册）**

`e2e/audit/contrast-pairs.json`：

```json
{
  "meta": {
    "formula": "WCAG 2.x relative luminance，(L1+.05)/(L2+.05)，全文同公式同口径",
    "gamma": "线性化常数 0.055（((c+0.055)/1.055)^2.4，WCAG 2.x 正式式）。仲裁定案：#767676@white=4.54 与 #777777@white=4.48 两组 WCAG 公布名值只在 0.055 下成立——自检双锚即判别式。错植指纹两族勿混引：加数错植 (c+0.05)/1.055 → #555555 2.76 / #767676 4.63 / #777777 4.56；除数错植 (c+0.055)/1.05 → 2.84 / 4.50 / 4.44——任一族都过不了 4.54/4.48 双锚",
    "tolerance": 0.01,
    "selfCheck": [
      { "fg": "#FFFFFF", "bg": "#000000", "expect": 21.00, "why": "极值锚" },
      { "fg": "#767676", "bg": "#FFFFFF", "expect": 4.54, "why": "经典 AA 贴线灰（WCAG 公布名值；0.05 错植给 4.50——区分力锚①）" },
      { "fg": "#777777", "bg": "#FFFFFF", "expect": 4.48, "why": "WCAG 公布名值（0.05 错植给 4.44——区分力锚②，双锚锁死 0.055）" },
      { "fg": "#555555", "bg": "#000000", "expect": 2.82, "why": "本 spec 深档网格点（0.055 下 L=0.0908→2.816；2.76 系 0.05 错植输出——审核两轮实证同一负例）" }
    ]
  },
  "pairs": [
    { "id": "P2-深档点", "fg": "#555555", "bg": "#000000", "specExpect": 2.82, "spec": "§2 P2" },
    { "id": "P2-浅档点-DCDCDC弃用", "fg": "#DCDCDC", "bg": "#F5F5F5", "specExpect": 1.26, "spec": "§2 P2" },
    { "id": "P2-浅档点-C8C8C8", "fg": "#C8C8C8", "bg": "#F5F5F5", "specExpect": 1.53, "spec": "§2 P2（spec :120 的 1.55 系内部不一致笔误——**spec v1.5.1 :326 已自行登记勘误、正确值 1.53**；本表按 1.53 入册引用既有登记，**勿改 spec :120 原文**——勘误条管辖，两处改会互相打脸）" },
    { "id": "P2-边线@浅板", "fg": "#3B82F6", "bg": "#F5F5F5", "specExpect": 3.37, "spec": "§8.1 edge-flow" },
    { "id": "P2-边高亮深档-999@浅板", "fg": "#999999", "bg": "#F5F5F5", "specExpect": 2.61, "spec": "§8.1 edge-highlight 换值动因" },
    { "id": "P2-边高亮浅档-6B7280@浅板", "fg": "#6B7280", "bg": "#F5F5F5", "specExpect": 4.43, "spec": "§8.1" },
    { "id": "P6-手柄深档-bg@白卡", "fg": "#9CA3AF", "bg": "#FFFFFF", "specExpect": 2.54, "spec": "§8.1" },
    { "id": "P6-手柄浅档-bg@白卡", "fg": "#6B7280", "bg": "#FFFFFF", "specExpect": 4.83, "spec": "§8.1" },
    { "id": "P6-手柄浅档-bg@板", "fg": "#6B7280", "bg": "#F5F5F5", "specExpect": 4.43, "spec": "§8.1" },
    { "id": "P6-手柄icon浅档@白卡", "fg": "#4B5563", "bg": "#FFFFFF", "specExpect": 7.56, "spec": "第五轮订正（v1.5.2 变更登记）：NodeHandle circle fill=transparent——icon 实落卡面非手柄底，spec §8.1 浅档 #FFFFFF 白字白卡 1.0:1 不可见 → #4B5563" },
    { "id": "P6-手柄icon深档@深卡", "fg": "#6B7280", "bg": "#1E1E1E", "specExpect": 3.45, "spec": "现状深档（icon 深值@bg-surface 深卡 ≥3 复核）" },
    { "id": "P6-手柄hover-icon浅档@白卡", "fg": "#111827", "bg": "#FFFFFF", "specExpect": 17.74, "spec": "第五轮订正：hover 仍 transparent fill——hover-icon 浅档 #FFFFFF 同样不可见 → #111827（与 hover 环同色系）。第六轮勘误：第五轮手算 18.53 系 g 通道误植（0x18=24 当了 17）——**新加行的 specExpect 一律以脚本首跑输出回填，禁手算定稿**（台账存在的意义即此）" },
    { "id": "面-面-卡面@板底(浅)", "fg": "#FFFFFF", "bg": "#F5F5F5", "spec": "分离度观测行（specExpect 空=无 drift 牙齿）：WCAG 1.4.11 UI 边界 3:1 适用性由 B6 目检裁定——浅档浮层/板分离度依赖边框+阴影承担" },
    { "id": "面-面-surface-dim@板底(浅)", "fg": "#F0F1F2", "bg": "#F5F5F5", "spec": "分离度观测行：--canvas-controls-bg 浅值 vs 板 ≈1.04——B6 必看（工具条/面板浮板感）" },
    { "id": "面-面-overlay2边@板底(浅)", "fg": "#F0F0F0", "bg": "#F5F5F5", "spec": "分离度观测行：rgba(0,0,0,0.06) 压白卡合成色 vs 板——B6 必看（卡边可辨性）" },
    { "id": "面-面-深档对照", "fg": "#262626", "bg": "#000000", "spec": "分离度观测行：深档工具条@板 ≈1.39——浅档同量级的分离度靠边框/阴影补" },
    { "id": "P9-欠账现状", "fg": "#6C5CE7", "bg": "#262626", "specExpect": 3.11, "spec": "§2 P9" },
    { "id": "P9-图形档白字", "fg": "#FFFFFF", "bg": "#6C5CE7", "specExpect": 4.86, "spec": "§2 P9" },
    { "id": "P9-图形档浅位", "fg": "#6C5CE7", "bg": "#F0F1F2", "specExpect": 4.30, "spec": "§2 P9" },
    { "id": "P9-文字档深@262626", "fg": "#9B8CF7", "bg": "#262626", "specExpect": 5.40, "spec": "§2 P9" },
    { "id": "P9-文字档深@141414", "fg": "#9B8CF7", "bg": "#141414", "specExpect": 6.57, "spec": "§2 P9" },
    { "id": "P9-文字档浅@f0f1f2", "fg": "#5F4FD1", "bg": "#F0F1F2", "specExpect": 5.27, "spec": "§2 P9" },
    { "id": "P9-文字档浅@f7f8fa", "fg": "#5F4FD1", "bg": "#F7F8FA", "specExpect": 5.61, "spec": "§2 P9" },
    { "id": "P4-GridIcon@白卡", "fg": "#6C5CE7", "bg": "#FFFFFF", "specExpect": 4.86, "spec": "§11.4" },
    { "id": "P4-GridIcon@深卡", "fg": "#6C5CE7", "bg": "#1E1E1E", "specExpect": 3.43, "spec": "§11.4" },
    { "id": "P4-品牌浅底反证-5DDCFF", "fg": "#5DDCFF", "bg": "#FFFFFF", "specExpect": 1.60, "spec": "§4 通道2 反证：深档品牌值直接落浅底不合格 → 双值变体 token 或迁恒深面，禁当『浅色档接受值』引用" },
    { "id": "P4-品牌浅底反证-4ade80", "fg": "#4ADE80", "bg": "#FFFFFF", "specExpect": 1.74, "spec": "§4 通道2 反证：#4ade80(--fw-accent 深值)落白底 1.74 → 前景必须走 --fw-accent-text 双档（浅 #15803d@white≈5.02）" }
  ]
}
```

- [ ] **Step 2: 写脚本（先跑 --self-check 应失败——脚本不存在即失败形态）**

`scripts/contrast-table.mjs`：

```js
#!/usr/bin/env node
// C8 对比度台账（spec §6-③）：输入 e2e/audit/contrast-pairs.json 配对表 → 输出 markdown 表；
// 内建 4 条自检向量（21.00 / 4.54 / 4.48 / 2.82），任一偏差 > tolerance 即 exit 1——历轮人工复算同格分歧以此终结。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'e2e', 'audit', 'contrast-pairs.json'), 'utf8'));

function channel(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function luminance(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrast(fg, bg) {
  const l1 = luminance(fg), l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const tol = data.meta.tolerance;
let fail = 0;
const fmt = (v) => v.toFixed(2);
const rows = [];
for (const c of data.meta.selfCheck) {
  const got = contrast(c.fg, c.bg);
  const ok = Math.abs(got - c.expect) <= tol;
  if (!ok) fail++;
  rows.push(`| 自检 | ${c.fg} | ${c.bg} | ${fmt(got)} | ${fmt(c.expect)} | ${ok ? '✅' : '❌'} | ${c.why} |`);
}
for (const p of data.pairs) {
  const got = contrast(p.fg, p.bg);
  const drift = p.specExpect != null && Math.abs(got - p.specExpect) > tol;
  if (drift) fail++; // drift 有牙齿：在册值机器核对，drift>0 即 exit 1（订正 spec 后复跑转绿）
  rows.push(`| ${p.id} | ${p.fg} | ${p.bg} | ${fmt(got)} | ${p.specExpect != null ? fmt(p.specExpect) : '—'} | ${drift ? '⚠︎drift' : '—'} | spec ${p.spec} |`);
}
const md = ['# C8 对比度台账（contrast-table.mjs 产出）', '', '| 配对 | 前景 | 底 | 实测 | spec 在册 | drift | 出处 |', '|---|---|---|---|---|---|---|', ...rows, ''].join('\n');
fs.writeFileSync(path.join(ROOT, 'e2e', 'audit', 'contrast-table.md'), md);
console.log(md);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: 跑自检向量**

```bash
cd /d/flowweb/apps/web && node scripts/contrast-table.mjs; echo "exit=$?"
```

Expected: `exit=0`，自检四行全 ✅（21.00 / 4.54 / **4.48** / 2.82），drift 列全空（drift>0 即 exit 1——在册值核对有牙齿；**第五轮新加行的 specExpect 若 drift 亮，先疑手算后疑实现**——#111827 手算 18.53 vs 脚本 17.74 即实例，新行期望值以脚本首跑输出回填后复跑转绿）。**常数仲裁定案（写入 meta.gamma 防翻案）**：0.055 是 WCAG 2.x 正式式常数——#767676@white=4.54、#777777@white=4.48 两组公布名值只在 0.055 下成立，自检双锚即判别式；错植指纹两族勿混引（加数错植 (c+0.05)/1.055 族给 2.76/4.63/4.56；除数错植 (c+0.055)/1.05 族给 2.84/4.50/4.44——两族数字不可互串，任一族都过不了双锚）。**若你的实现跑出 2.76：channel 加数错植（0.055→0.05），查 selfCheck[1]/[2] 两锚**；实现确认无误而 drift 亮：按脚本值订正 spec 走变更登记——禁止改配对表迁就实现，也禁止改实现迁就 spec。

- [ ] **Step 4: Commit（含 spec v1.5.1 变更登记）**

```bash
cd /d/flowweb && git add apps/web/scripts/contrast-table.mjs apps/web/e2e/audit/contrast-pairs.json apps/web/e2e/audit/contrast-table.md && git commit -m "feat(web): C8 D0-0 对比度台账脚本 contrast-table.mjs——WCAG 同口径出表 + 4 条自检向量（21.00/4.54/4.48/2.82 不过 exit 1，审核期 2.76 负例实证向量有效）+ specExpect/drift 列（在册值机器核对，drift 按脚本值订正走变更登记；:120 1.55 勘误引用 spec v1.5.1 :326 既有登记）+ 手柄 icon 配对三行（第五轮订正值 #4B5563/#111827）+ 面-面分离度观测四行"
```

---

## Task 3（D0-0 ⑵b）: a0 采集器扩展 + differ D 段基线对 + D 段探针族（同一 commit）

spec §6 动作 1/2/3。采集器冻结集扩 `backgroundColor` + 全元素 `color`；differ 新增独立 D 段属性集与配对闸；探针族先钉当前深值。

**Files:**
- Modify: `apps/web/e2e/a0-collect-baseline.spec.ts`
- Modify: `apps/web/scripts/css-baseline-diff.mjs`
- Create: `apps/web/e2e/d-segment-probes.spec.ts`
- Create（Step 4 产出）: `apps/web/e2e/audit/d0-probe-values.json`

- [ ] **Step 1: 扩采集器属性集（a0-collect-baseline.spec.ts）**

`snapshotDom` 内 `rec` 构造处（现 :118-132），`if (FORM_CONTROL.has(tag)) rec.color = cs.color;`（:133）替换为全元素采集，并新增 `backgroundColor`：

```ts
      const rec: Record<string, unknown> = {
        key: stableKey(el),
        tag,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        padding: { t: cs.paddingTop, r: cs.paddingRight, b: cs.paddingBottom, l: cs.paddingLeft },
        borderWidth: { t: cs.borderTopWidth, r: cs.borderRightWidth, b: cs.borderBottomWidth, l: cs.borderLeftWidth },
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        // 计算样式属性集 D1（C8 D0-0 扩面）：新增全元素 backgroundColor + color（原 color 仅表单控件）
        boxSizing: cs.boxSizing,
        borderStyle: { t: cs.borderTopStyle, r: cs.borderRightStyle, b: cs.borderBottomStyle, l: cs.borderLeftStyle },
        borderColor: { t: cs.borderTopColor, r: cs.borderRightColor, b: cs.borderBottomColor, l: cs.borderLeftColor },
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        clsHash: cls ? hashCls(cls) : null,
        clsLen: cls.length,
      };
```

同步删除 `const FORM_CONTROL = new Set([...])`（:105，已无消费）。**紧随 rec 之后的 `if (el.getAttribute('aria-disabled')) rec.ariaDisabled = …`（:134）保留勿误删**。`computedPropertySet` meta 字段（:314-317）**替换** :316 的 `'color(仅 input/textarea/select/button)'` 为 `'backgroundColor(全元素)', 'color(全元素,D1 起)'`（第八轮订正：原"追加"写法会让 meta 里两行 color 互相矛盾），并新增 meta 顶层字段 `attrSetVersion: 'D1'`（afterAll 写入对象第一层）。注释 `// color 仅表单控件（继承色噪声大）` 更新为 `// D1 起全元素采集——D 段基线对比色；旧基线（无 attrSetVersion=A0）跨代比对走"属性缺失=不判"`。

**同 commit 修复 :144 LIGHT 模式注入（第五轮 P0-5——修复窗口仅本任务，Task 10 后采集器冻结）**：`if (LIGHT) await page.evaluate(() => document.documentElement.classList.add('light'))` 是 D0 前的类注入——D0 起 themeStore 首渲染即挂 `dark`，add('light') 不移除 dark → html 双类（.light 源序胜但 React mode 仍 dark，D2 后 colorMode 钉暗）→ 浅色采集静默失真。**修法（第六轮简化：勿逐用例上移——seedRealLight 实有 5 处调用点 :175/:188/:211/:235/:271，逐点改必漏）**：LIGHT 与 REAL_LIGHT **路径合一**——`:33` 改 `const REAL_LIGHT = !!process.env.REAL_LIGHT || !!process.env.LIGHT_BASELINE;`。**ANY_LIGHT/LIGHT 删除面全清单（第七轮 P3 点名——原"删 :35/:144/:309"不全，遗漏处是未定义标识符，e2e tsc 会拦但按点名清单改是纪律）**：`:35 ANY_LIGHT` 定义、`:144` 注入行、`:198/:218/:248` 三处 `if (ANY_LIGHT)`、`:301` invocation 模板、`:302` meta.theme 三元、`:309` lightInjection 落盘分支（`LIGHT_PROBES`/`FLIP_PROBES` 落盘改由 REAL_LIGHT 分支承担）；改完 `grep -n "ANY_LIGHT\|LIGHT" e2e/a0-collect-baseline.spec.ts` 复核仅剩 REAL_LIGHT/LIGHT_BASELINE 语义行。文件头注释注明"旧 classList 注入路径已废止（D0 后双类失真）；light-B6 基线系旧机制产物不可复用"。历史 `LIGHT_BASELINE=1` 调用形态因 env 兼容保留，语义=REAL_LIGHT。

**同 commit 加采集器冻结标记（第七轮 P1-1、第八轮 P1-1 边界收窄——Task 10 Step 4 指纹守卫的判据基础，标记必须先于指纹基线存在）**：在 a0-collect-baseline.spec.ts 内用成对注释标记冻结区——`/* COLLECTOR-FROZEN-BEGIN */ … /* COLLECTOR-FROZEN-END */`（多对同名标记，`sed -n '/COLLECTOR-FROZEN-BEGIN/,/COLLECTOR-FROZEN-END/p'` 天然全取）。**第八轮收窄：只圈"决定基线可比性"的契约字段，勿按函数/段粒度圈**——四段：① SETTLE_MS 常量；② REAL_LIGHT/seedRealLight 注入机制本体；③ `snapshotDom` 函数体；④ afterAll meta 内**仅两小段**：`attrSetVersion: 'D1',` 单独成段 + `computedPropertySet: [...]` 数组单独成段。**标记注释点名排除的 afterAll 成员**（合法改动面）：`invocation`/`theme` 叙事串（Task 26 允许改）、`islandInvarianceProbes`/`flipProbes` spread（Task 17 允许改）、`stableKeyFormat`/`classNameStorage`/`excludedRegions`（若随 snapshotDom 冻结须显式含在标记内，勿依赖段位置隐含）。**探针块（LIGHT_PROBES/FLIP_PROBES/probeInvariance/probeFlip 的定义与调用）与叙事注释必须落在标记之外**——Task 15/17/21/26 的合法改动才不触发指纹（第七轮原方案圈整段 afterAll，与 Task 17 增 flipProbes 键/Task 26 改 :301-:305 叙事正面冲突——报警疲劳→指纹被例行重录→守卫名存实亡，与第六轮修掉的 git log 方案同病）。**页面清单/流程不进指纹**（探针调用与流程交织无法剥离；页集**减**由 differ 缺页比对守卫、页集**增**由 Task 3 Step 2 ②b 的 union 页循环守卫——第八轮补双向，勿再引"页数比对"单向旧口径），此边界在标记处注释写明。另：根 `.gitignore` 追加一行 `apps/web/e2e/test-results/`（该目录现存 c4/c5 png 未跟踪，Task 22/26 的 `git add apps/web/e2e/` 会吞——第五轮 P1-3 实证）。

- [ ] **Step 2: 扩 differ（css-baseline-diff.mjs）**

改动四处：

① `loadBaseline` 返回值带版本：`return { dir, meta, pages, attrSetVersion: meta.attrSetVersion ?? 'A0' };`

② 加载后立刻加同代校验（跨代 mixing 显式失败，而非静默空比）：

```js
if (before.attrSetVersion !== after.attrSetVersion) {
  console.error(`[gate] 属性集版本不一致：before=${before.attrSetVersion} after=${after.attrSetVersion}——同代基线对限制（D 对=D1×D1；A5 旧对保持 A0×A0），禁止跨代混比`);
  process.exit(1);
}
```

②b **页循环改 union + 双向缺页报错（第八轮 P1-2——现状 :125-128 只遍历 `before.pages`：删页 → "after 基线缺页" 红 ✓；加页 → 循环永不访问、全部属性 diff 不计算、静默 exit 0——页清单是冻结面里唯一被排除的子集，其守卫必须双向，否则"顺手加一页采集"基线口径已变而门禁全绿）**：

```js
const pageNames = [...new Set([...Object.keys(before.pages), ...Object.keys(after.pages)])].sort();
for (const page of pageNames) {
  const bPage = before.pages[page], aPage = after.pages[page];
  if (!aPage) { pairing[page] = { error: 'after 基线缺页（页清单被改？）' }; continue; }
  if (!bPage) { pairing[page] = { error: 'before 基线无此页（新增采集页未入锚？）' }; continue; }
  // ……原页内比对逻辑不动……
```

（A5 旧对两侧页集相同 → union 与原循环行为零变化 ✓；此改动是 Task 3 Step 1 冻结标记"页集增由 differ 守卫"承诺的兑现。）

③ 新属性 diff（元素配对循环内，`b.color` 段之后追加；null 检查天然实现"属性缺失=不判"跨代分支）。**⚠ 现状 `b.color` 段（:214-225）只查 b2Pairs/A1_COLOR_PAIRS、从不查 `reg`（OVERRIDES）——其余属性块（属性层 fontSize :207-212 / lineHeight :196-205 都查 `!reg`）**（第五轮 M2 实证；几何层另有 :291/:306 的驱动检查行，勿混）。新块与 b.color 改造都必须带 `!reg`，否则 Task 4 Step 3 的"扩 OVERRIDES 处置噪声"路径对 color/backgroundColor 恰好失效。**⚠ 第六轮 B3：色对键命名必须避开外层元素循环的 `key` 变量（遮蔽后 propUnexpected.push 写进色对键而非元素稳定键，报告字段错位；且勿学 OVERRIDES[page|色对键] 查表——那是死代码，OVERRIDES 键=page|元素键，reg 已在循环头按元素键算出）**——照 b.color 段的 `b2Key` 命名形态：

```js
    if (b.backgroundColor != null && a.backgroundColor != null && b.backgroundColor !== a.backgroundColor) {
      const hit = absorbedBy(page, 'backgroundColor', b.backgroundColor, a.backgroundColor); // 两级吸收（helper 见④）
      if (hit) bump(dAbsorbed, `backgroundColor ${b.backgroundColor}→${a.backgroundColor} [${hit}]`);
      else {
        bump(bucketCount, `backgroundColor.${b.backgroundColor}→${a.backgroundColor}`);
        if (!reg) propUnexpected.push({ page, key, tag: a.tag, prop: 'backgroundColor', before: b.backgroundColor, after: a.backgroundColor });
      }
    }
```

（push 里 `key` = 外层元素稳定键——与 fontSize/borderColor 块同形态。）`b.color` 段（:214-225）同步改：`b2Pairs` 判定外再经 `absorbedBy(page, 'color', …)`（D 段注册配对同吸收）+ 补 `!reg`；A1_COLOR_PAIRS 豁免仅当 `after.attrSetVersion === 'A0'`（D1 全元素 color 下旧豁免不再盲目放行）。borderColor 新块同款接 `absorbedBy(page, 'borderColor', …)`——**三处属性块共用同一 helper（第七轮 P1-1 接线：第六轮只定义了 dPairsPage 未消费=死变量，"优先带 page 登记"的文档承诺落空，D2/D3 大批量段按文档登记却红，最省事的错修恰是把 pair 改回全局=静默丢门禁强度）**。

④ D 段注册配对源 + 吸收表（B2_REGISTRY 加载处旁）。**D 对（attrSetVersion D1）时 registry 缺失 → exit 1 报指引**（"请在能产出 canvas-migration-registry.json 的 checkout 上跑"——比静默空表可读，第五轮采纳）；A5 旧对（A0×A0）完全不读 D_REGISTRY（无 EMPTY_PARTITIONS 崩溃面）：

```js
/* C8 D 段注册配对（canvas-migration-registry.json differExpectedPairs——D1b/D3 有意变更逐条配对，未配对=失败）。
 * D 对（任一侧 attrSetVersion=D1）registry 缺失即 exit 1 报指引；A5 旧对（A0×A0）不读不判（无 partitions 崩溃面）。
 * 第六轮：pair 增可选 page 字段，两级匹配——page 限定集（page|prop|before|after）优先、全局集（prop|before|after）兜底；
 * 浅侧 pairs 量大（D2/D3 板面与各域翻转）后，全局配对跨位点误吸收面会扩大在最想守的方向——page 维度把该残余收窄。 */
const D_REGISTRY_PATH = path.join(ROOT, 'e2e', 'audit', 'canvas-migration-registry.json');
const D_PAIR = before.attrSetVersion === 'D1' || after.attrSetVersion === 'D1';
let D_REGISTRY = null;
if (D_PAIR) {
  if (!fs.existsSync(D_REGISTRY_PATH)) {
    console.error('[gate] D 段基线对必须存在 canvas-migration-registry.json（node scripts/canvas-migration-registry.mjs 产出）——缺档拒绝静默空比');
    process.exit(1);
  }
  D_REGISTRY = JSON.parse(fs.readFileSync(D_REGISTRY_PATH, 'utf8'));
}
const dPairsRaw = (D_PAIR ? D_REGISTRY.differExpectedPairs?.pairs : undefined) ?? [];
const dPairsPage = new Set(dPairsRaw.filter((p) => p.page).map((p) => `${p.page}|${p.prop}|${normColorVal(p.before)}|${normColorVal(p.after)}`));
const dPairs = new Set(dPairsRaw.filter((p) => !p.page).map((p) => `${p.prop}|${normColorVal(p.before)}|${normColorVal(p.after)}`));
/* 两级吸收 helper（第七轮 P1-1 接线——backgroundColor/borderColor/color 三处共用；返回 'page' | 'global' | null）：
 * page 限定集优先、全局集兜底；dAbsorbed 记命中层级，冒烟验收据此确认 page 路径真被走过（Task 4 Step 2b）。 */
function absorbedBy(page, prop, before, after) {
  const b = normColorVal(before), a = normColorVal(after);
  if (dPairsPage.has(`${page}|${prop}|${b}|${a}`)) return 'page';
  if (dPairs.has(`${prop}|${b}|${a}`)) return 'global';
  return null;
}
const dAbsorbed = {};
/* C8 D3 涌现站点级登记（第五轮 M3 采纳 + 第六轮页无关化）：D 对下任何采集页的 border-width 0→N 涌现站点
 * 必须命中 d3EmergentSites（page|key），否则 offender。页无关的理由：文件级授权闸的恒真机制=页级 some() 判定
 * + 每页至少一个授权文件（works=['TopActionBar','Sidebar'] :62 皆在册）——枚举页集必漏（WeChatFollowModal 在
 * /works、弹层/浮层可能在任何页），页无关是唯一不漏形态。A5 旧对不走本分支。 */
const d3Sites = new Set(((D_PAIR ? D_REGISTRY.d3EmergentSites : undefined) ?? []).map((s) => `${s.page}|${s.key}`));
```

⑤ **涌现闸 D 对改站点级判定（页无关）**（`emergenceOffenders` 循环 :331-336 内追加分支，A5 旧路径零变化）：

```js
for (const site of emergentSites) {
  if (D_PAIR) {
    if (!d3Sites.has(`${site.page}|${site.key}`)) {
      emergenceOffenders.push(`${site.page}|${site.key} <${site.tag}> ${site.side} ${site.after}（D 段涌现站点未登记 d3EmergentSites——先登记再变更）`);
    }
    continue;
  }
  // ……原 A5 文件级判据不动……
}
```

⑥ **A5 归档写入段守卫（第五轮 M1）**：`:397-409` 无条件覆写 `e2e/audit/audit-A5-borderwidth.json`（`--out` 不影响它）——每次 D 段 diff 都会把 A5 历史审计档写成 D 段数据、再被 `git add apps/web/e2e/audit/` 吞提交。写入外包一层 `if (BEFORE_DIR === 'before-A0' && AFTER_DIR === 'after-A') { … }`（其余对只写 `--out` 产物）。

报告 `report` 增加 `dExpectedGate`（同 b2ExpectedGate 结构）与 `meta.attrSetVersion`；MD §2b 旁增加 D 段吸收段。**A5 旧对行为零变化**（默认 before-A0×after-A 同代 A0；`dPairs` 空表不吸收；涌现闸走原文件级路径）。

- [ ] **Step 3: 建 D 段探针族 spec（e2e/d-segment-probes.spec.ts，默认常驻套件）**

新建文件（结构照 b1：探针表 + locate 锚 + 断言；html.light 经 addInitScript 真实路径注入）：

```ts
// C8 D 段探针族（spec §6-③，b1 同构）：钉各域"当前主题应取值"——D0-0 先钉深值（html.light 下恒深面不变、
// 跟随面翻转点见文件头生命周期表）；随各段迁移同 commit 翻转预期值（探针是活断言，不是快照）。
// 探针生命周期表见 docs/superpowers/plans/2026-09-20-canvas-domain-theme.md 执行总纲 §5。
import path from 'node:path';
import { test, expect, type Browser, type Page, type Locator } from '@playwright/test';

const HERE = import.meta.dirname!;
const USER_STATE = path.join(HERE, '.auth', 'user.json');

type Probe = { id: string; expected: string; read: (page: Page) => Promise<string>; why: string };

/** 真实浅色路径：localStorage theme=light 先于一切页面脚本（同 c0/采集器口径） */
async function lightContext(browser: Browser) {
  const ctx = await browser.newContext({ storageState: USER_STATE });
  await ctx.addInitScript(() => localStorage.setItem('theme', 'light'));
  return ctx;
}

async function openCanvas(page: Page) {
  await page.goto('/canvas?projectId=gate-canvas-1');
  await expect(page.locator('.react-flow__node[data-id="gate-node-1"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('已连接', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
}
async function openWorks(page: Page) {
  await page.goto('/works');
  await expect(page.getByText('A0-0 门禁画布').first()).toBeVisible({ timeout: 15_000 });
}
async function openVideos(page: Page) {
  await page.goto('/videos');
  await expect(page.getByText('A0-0 门禁样例视频').first()).toBeVisible({ timeout: 15_000 });
}
const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase();
const bgOf = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
const colorOf = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).color);

test.describe('D-1 画板域（D0-0 钉深；D2 翻转）', () => {
  test('画板 wrapper 底=rgb(0,0,0)、网格点=#555555（html.light 下 colorMode 钉深）', async ({ browser }) => {
    const ctx = await lightContext(browser);
    const page = await ctx.newPage();
    try {
      await openCanvas(page);
      const wrapper = page.locator('.react-flow');
      expect(await bgOf(wrapper)).toBe('rgb(0, 0, 0)');
      // 网格点读 .react-flow__background 自身（自定义属性只向下继承，从 wrapper 读=空）；
      // computed 已被 var() 代换 → 断 RGB 可同时抓"代换失败"（失败落字面/空）
      const dot = await wrapper.evaluate((el) => getComputedStyle(el.querySelector('.react-flow__background')!).getPropertyValue('--xy-background-pattern-color-props'));
      expect(norm(dot)).toBe('#555555');
    } finally { await ctx.close(); }
  });

  test('gate 节点卡底=rgb(34,34,34)（D0-0 实测钉值；D3-画板翻浅白卡）', async ({ browser }) => {
    const ctx = await lightContext(browser);
    const page = await ctx.newPage();
    try {
      await openCanvas(page);
      // ⚠ gate 节点 type='videoGen'（gate-seed.ts:27）→ VideoGenNode：根 .canvas-node(:607) 无底色，
      // 卡面在 :718 bg-[#222222]——选择器必须锚卡面（.canvas-node 直接子 div 带 rounded-lg），
      // 照抄 locator('div').first() 会钉到根 div 的 rgba(0,0,0,0)=与主题无关的假守卫（第五轮 P0-1）
      const card = page.locator('.react-flow__node[data-id="gate-node-1"] .canvas-node div.rounded-lg');
      expect(await bgOf(card)).toBe('rgb(34, 34, 34)'); // ← Step 4 落盘发现值后照盘填（异值以发现为准）；D3-画板 → 'rgb(255, 255, 255)'（浅档白卡，本组恒 html.light 注入）
    } finally { await ctx.close(); }
  });

  // ⚠ --fw-accent-text 是 B0 既有键（index.css:48 浅值 #15803d 早已生效）——D0-0 即浅值、无翻转点，
  // 保留作浅档正向对照（勿写 rgb(74,222,128) 深值——那是暗档，本组恒 html.light 注入）
  test('CanvasTopBar 已连接前景=rgb(21,128,61)（accent-text 浅值 B0 既有；浅档正向对照，无翻转点）', async ({ browser }) => {
    const ctx = await lightContext(browser);
    const page = await ctx.newPage();
    try {
      await openCanvas(page);
      expect(await colorOf(page.getByText('已连接', { exact: true }).first())).toBe('rgb(21, 128, 61)');
    } finally { await ctx.close(); }
  });
});

test.describe('D-2 videos 域（封面=P6 内容垫底恒深，不翻转）', () => {
  test('门禁视频卡封面占位底=rgb(38,38,38)', async ({ browser }) => {
    const ctx = await lightContext(browser);
    const page = await ctx.newPage();
    try {
      await openVideos(page);
      const card = page.locator('a[data-card]', { hasText: 'A0-0 门禁样例视频' }).first();
      expect(await bgOf(card.locator('.aspect-video'))).toBe('rgb(38, 38, 38)');
    } finally { await ctx.close(); }
  });
});

test.describe('D-3 WeChatFollowModal（D0-0 钉深；D1b 拆岛翻浅）', () => {
  test('面=rgb(30,30,30)、标题前景=rgb(226,232,240)', async ({ browser }) => {
    const ctx = await lightContext(browser);
    const page = await ctx.newPage();
    try {
      await openWorks(page);
      await page.getByTestId('wechat-follow-entry').click();
      const content = page.locator('.ant-modal-content').first();
      await expect(content).toBeVisible({ timeout: 10_000 });
      expect(await bgOf(content)).toBe('rgb(30, 30, 30)');
      expect(await colorOf(content.getByText('关注公众号'))).toBe('rgb(226, 232, 240)');
    } finally { await ctx.close(); }
  });
});
```

ve 壳探针（`D-4 ve 域`）复用采集器"添加节点→多轨道剪辑→全屏编辑"**操作序列**（a0-collect-baseline.spec.ts:233-265 流程 + 清理段），断言 `[data-testid="video-editor-shell"]` backgroundColor === 'rgb(20, 20, 20)'（D1b 仅键名并域仍钉深，D3-ve 翻双断言）。**⚠ 浅色注入必须走本文件 lightContext 的 addInitScript（=c0 newSeededContext 口径）——禁抄 a0 采集器的 `classList.add('light')` 注入**（D0 起 storage 优先并回挂 html 类，直接加类会与 themeStore 打架）。

另补两组（浅色档功能性守卫——卡片白前景与图形档对 differ 不可见，探针是唯一机械守卫）：

```ts
test.describe('D-5 videos 卡面前景（D3-videos 翻转——白字白卡不可见防线）', () => {
  test('VideoCard 卡标题前景=rgb(255,255,255)（text-white 字面现状）', async ({ browser }) => {
    const ctx = await lightContext(browser);
    const page = await ctx.newPage();
    try {
      await openVideos(page);
      const title = page.locator('a[data-card]', { hasText: 'A0-0 门禁样例视频' }).first().getByText('A0-0 门禁样例视频');
      expect(await colorOf(title)).toBe('rgb(255, 255, 255)'); // D3-videos → rgb(31, 35, 41)
    } finally { await ctx.close(); }
  });
});

test.describe('D-6 图形档（fill/stroke——differ 属性集不可见，本组是唯一机械守卫；目标由发现步实测选定）', () => {
  // ⚠ gate 画布实测：两节点 type='videoGen'（gate-seed.ts:27，无 GridIcon）、gate-edge-1 无 type（无 EdgeFlowParticles
  // 粒子边）——"edge 线 stroke"读 .react-flow__edge path 是 xyflow 默认边（--xy-edge-stroke），与 --edge-flow-color 无关，
  // 照抄即假守卫。--edge-flow-color 唯一消费者 = EdgeFlowParticles circle 的 fill（edges/EdgeFlowParticles.tsx:24），
  // gate 画布不渲染 → **显式登记"图形档：--edge-flow-color 无门禁覆盖（需粒子边），B6 目检兜底"**，勿留探针。
  test('D-6 图形档发现：枚举 gate 画布 svg 元素 fill/stroke，据此钉 1-2 个真实存在的目标', async ({ browser }) => {
    const ctx = await lightContext(browser);
    const page = await ctx.newPage();
    try {
      await openCanvas(page);
      const svg = await page.evaluate(() =>
        [...document.querySelectorAll('.react-flow svg *')].slice(0, 30).map((el) => ({
          tag: el.tagName.toLowerCase(),
          fill: getComputedStyle(el).fill,
          stroke: getComputedStyle(el).stroke,
        })),
      );
      console.log('[D-6-svg-inventory] ' + JSON.stringify(svg));
      test.info().attach('d6-svg-inventory', { body: JSON.stringify(svg, null, 1), contentType: 'application/json' });
    } finally { await ctx.close(); }
  });
});
```

（发现步落盘后：挑 gate 画布**真实渲染**且颜色随主题应恒定/翻转的 1-2 个 SVG 目标写成断言（如节点工具条 SVG 图标 fill、NodeHandle 的 SVG 部分）；不可测目标（粒子边/GridIcon）在 registry 显式登记"无门禁覆盖，B6 目检兜"——**宁缺勿假**，勿把与主题无关的默认值固化成探针。**D-6 发现用例标注"一次性发现步"：钉值落定后该用例仅保留 attach 证据、不新增断言，D4 收口时可撤——防其沉淀为第二个无断言假守卫**。）

- [ ] **Step 4: 发现钉值（落盘照盘填，禁抄报错）**

在 d-segment-probes.spec.ts 顶部加一个仅本步使用的发现用例（全绿后删除或保留为 attach 证据）：

```ts
test('D-0 发现：探针钉值基线输出（落盘照盘填，防抄报错人因）', async ({ browser }) => {
  const ctx = await lightContext(browser);
  const page = await ctx.newPage();
  await openCanvas(page);
  const values = await page.evaluate(() => ({
    gateCardBg: getComputedStyle(document.querySelector('.react-flow__node[data-id="gate-node-1"] .canvas-node div.rounded-lg')!).backgroundColor,
    boardDot: getComputedStyle(document.querySelector('.react-flow__background')!).getPropertyValue('--xy-background-pattern-color-props'),
    // M5 对照读数：若 boardDotCustom 返回未代换字面串（如 'var(--canvas-board-dot)'）而 circleFill 是
    // 真实 RGB → 网格点探针必须改用 circle fill 断言（自定义属性假守卫风险，数据定形态）
    boardDotCircleFill: (() => { const c = document.querySelector('.react-flow__background circle'); return c ? getComputedStyle(c).fill : '(无 circle)'; })(),
  }));
  console.log('[D-0-probe-values] ' + JSON.stringify(values));
  test.info().attach('d0-probe-values', { body: JSON.stringify(values, null, 2), contentType: 'application/json' });
});
```

```bash
cd /d/flowweb/apps/web && npx playwright test e2e/d-segment-probes.spec.ts 2>&1 | tee /tmp/d0-probe.log && grep "D-0-probe-values" /tmp/d0-probe.log
```

把输出值写入 `e2e/audit/d0-probe-values.json`（探针 id → 钉值），再照盘填进对应 `toBe(...)`（含 test-results attach 副本）。重跑至全绿。

- [ ] **Step 5: 三件套同 commit**

```bash
cd /d/flowweb/apps/web && npx playwright test e2e/d-segment-probes.spec.ts e2e/c0-theme.spec.ts && npx vitest run && npx tsc --noEmit -p e2e/tsconfig.json; echo "e2e-tsc=$?"
cd /d/flowweb && git add apps/web/e2e/a0-collect-baseline.spec.ts apps/web/scripts/css-baseline-diff.mjs apps/web/e2e/d-segment-probes.spec.ts apps/web/e2e/audit/d0-probe-values.json .gitignore && git commit -m "feat(web): C8 D0-0 仪器扩展——a0 采集器 D1 属性集(backgroundColor+全元素 color+attrSetVersion+LIGHT 注入改 storage 路径防 D0 后双类失真)+differ 独立 D 段基线对(同代校验+D 注册配对闸 reg/OVERRIDES 接入+D3 涌现站点级闸+A5 归档写入段守卫)+d-segment-probes 探针族钉值(卡面选择器锚 .canvas-node>div.rounded-lg+circle fill 对照读数)+.gitignore 补 e2e/test-results/（三件同一 commit，spec §6 ⑵）"
```

---

## Task 4（D0-0 ⑶）: 自比自跑定 0 噪声基线

spec §6：before-D 自比自跑一次定 0 噪声——全元素继承色噪声先测预算，非 0 则就地扩分类器白名单并登记，**勿带噪声进 D1a**。

**Files:** 无产品改动（产出：`e2e/audit/d0-noise-report.md`；若出噪声：改 `css-baseline-diff.mjs` 分类器 + spec 变更登记）。

- [ ] **Step 0: bootstrap 落最小 stub registry（第六轮 N1——不先落这步，Step 2 的 diff 会被 Task 3 的"D 对缺 registry 即 exit 1"守卫卡死；此时 registry 脚本尚未创建（Task 5 Step 1），故用 inline stub）**

```bash
cd /d/flowweb/apps/web && node -e "require('fs').writeFileSync('e2e/audit/canvas-migration-registry.json', JSON.stringify({meta:{task:'stub——自比自跑前置（Task 5 Step 2 以脚本产出覆盖）'},differExpectedPairs:{pairs:[]},d3EmergentSites:[],adjudications:[],whitelistKeeps:[]},null,1))"
```

说明：d-noise-a/b 两侧 attrSetVersion 均为 D1 → D_PAIR=true → differ 要求 canvas-migration-registry.json 存在。自比自跑预期 0 diff——不查吸收/涌现表，空 stub 即可；stub 同时顺带验证 differ 的 D 对加载路径。正式产出（分区填充/adjudications/入库）仍归 Task 5 Step 2（脚本覆盖 stub）。

- [ ] **Step 1: 同 HEAD 采两次**

```bash
cd /d/flowweb/apps/web && COLLECT_BASELINE=1 BASELINE_DIR=d-noise-a npx playwright test e2e/a0-collect-baseline.spec.ts && COLLECT_BASELINE=1 BASELINE_DIR=d-noise-b npx playwright test e2e/a0-collect-baseline.spec.ts
```

Expected: 两次各 8 页落盘，元素计数逐页相同（视频编辑器页 252 上下）。

- [ ] **Step 2: 比对**

```bash
cd /d/flowweb/apps/web && node scripts/css-baseline-diff.mjs --before d-noise-a --after d-noise-b --out e2e/audit/baseline-diff-dnoise; echo "exit=$?"
```

Expected: `exit=0`、`unexpectedTotal=0`、配对闸 offender=0。

- [ ] **Step 2b: 配对闸两级吸收冒烟（第七轮 P1-1——page 限定匹配到 D2 大批量段才第一次被真用=太晚；本步用人为构造的 diff 验证 absorbedBy() 的 page 路径真被走过）**

```bash
# ① 手改 d-noise-b 一条记录制造已知 diff（改基线文件不入档，仅供本步）：
cd /d/flowweb/apps/web && node -e "
const fs=require('fs');const p='e2e/baseline/d-noise-b/works.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
const body=j.elements.find(e=>e.key==='dom:');body.backgroundColor='rgb(1, 2, 3)';
fs.writeFileSync(p,JSON.stringify(j,null,1));"
# ② 未登记跑 diff → 应 unexpected=1 红：
node scripts/css-baseline-diff.mjs --before d-noise-a --after d-noise-b --out e2e/audit/baseline-diff-dnoise-smoke; echo "unregistered=$?"
# ③ stub registry 登记带 page 的 pair → 复跑应吸收且 dAbsorbed 记 [page]：
node -e "
const fs=require('fs');const p='e2e/audit/canvas-migration-registry.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.differExpectedPairs.pairs=[{page:'works',prop:'backgroundColor',before:'rgb(20, 20, 20)',after:'rgb(1, 2, 3)',why:'冒烟——验证 page 限定匹配'}];
fs.writeFileSync(p,JSON.stringify(j,null,1));"
node scripts/css-baseline-diff.mjs --before d-noise-a --after d-noise-b --out e2e/audit/baseline-diff-dnoise-smoke; echo "registered-page=$?"
```

Expected: `unregistered=1`；`registered-page=0` 且报告 dAbsorbed 出现 `[page]` 标记（没有 [page] = helper 的 page 分支没接线，回 Task 3 Step 2 ③）。注意 pair 的 before 值取 d-noise-a 侧该记录的实际值（上例假定 body 底为 rgb(20,20,20)，以实际读到的为准照填——两侧值都要与 differ 的 normColorVal 序列化一致）。**完成后还原**：重跑 Step 1 的 d-noise-b 采集覆盖手改（或 git checkout 不适用——基线目录不入档，直接重采），stub registry 的冒烟 pair **必须手工删除**（§0 复核订正：Task 5 脚本是合并模式——读既有文件保留四手工键、**不覆盖**，冒烟 pair 留着会永久进入门禁真源；Task 5 实际执行=先清 pairs 再跑脚本）；删除 `e2e/audit/baseline-diff-dnoise-smoke.*` 两件。

- [ ] **Step 3（条件）: 非零噪声处置**

若 unexpected：先查 **backgroundColor 的 `transparent` / `rgba(0, 0, 0, 0)` 变体噪声**（新属性集特有——两值等价但序列化不同，跨运行可能因元素渲染顺序抖动）→ 有则先在 differ 侧加归一化（`transparent → rgba(0, 0, 0, 0)` 再比对），归一化后仍有噪声才走白名单。其余逐条归因：确定性噪声（antd 弹层动画态/时序性 class）→ differ 分类器扩"预期项"白名单（OVERRIDES 或桶预期标注；**color/backgroundColor 块的 OVERRIDES/reg 通道已在 Task 3 Step 2 ③ 接通**——第五轮 M2 修复前此路径对两个新属性恰好失效）并**在 spec §6 落一行变更登记**；非确定性噪声（元素计数漂移）→ 修采集稳定性（沉降等待/排除规则）而非白名单。循环 Step 1-2 直至 0。

- [ ] **Step 4: 清理噪声目录前先落结论文档（§0 停点复核物）**

```bash
cd /d/flowweb/apps/web && cat > e2e/audit/d0-noise-report.md << 'EOF'
# D0-0 自比自跑噪声报告（Task 4）
- unexpectedTotal: <填 Step 2 实测值（预期 0）>
- 归一化/白名单处置: <transparent 归一化或 OVERRIDES 条目，无则"无">
- 逐页元素计数: <d-noise-a vs d-noise-b 逐页对比（应全等）>
- 配对闸两级吸收冒烟（Step 2b）: unregistered=1 → registered-page=0 且 dAbsorbed 含 [page]（第七轮 P1-1 接线验证）
EOF
rm -rf e2e/baseline/d-noise-a e2e/baseline/d-noise-b e2e/audit/baseline-diff-dnoise.json e2e/audit/baseline-diff-dnoise.md e2e/audit/baseline-diff-dnoise-smoke.json e2e/audit/baseline-diff-dnoise-smoke.md
```

`d0-noise-report.md` 与 `d0-probe-values.json` 一起作为 §0 停点复核物随 Task 5 commit 入库（原始噪声产物删，结论文档留）。（若 Step 3 扩了白名单：单独 commit `fix(web): C8 D0-0 自比自跑噪声白名单——<条目与理由>`。）

---

## Task 5（D0-0 ⑷）: registry 脚本产出迁移清单 + 涌现闸站点级接线（before-D 采集已移 Task 10）

spec §5/§6.4：手写数字一律不作验收依据（§6-④"两处同步"已按 v1.5.2 改站点级登记，见 Step 3）。

**Files:**
- Create: `apps/web/scripts/canvas-migration-registry.mjs`
- Create（脚本产出，覆盖 Task 4 Step 0 的 stub）: `apps/web/e2e/audit/canvas-migration-registry.json`
- Modify: `apps/web/scripts/css-baseline-diff.mjs`（d3EmergentSites/pairs page 字段接线已在 Task 3 落地，本任务核对）

- [ ] **Step 1: 写 registry 脚本**

`scripts/canvas-migration-registry.mjs`（镜像 b2-migration-registry.json 结构：分区 + 排除集 + 逐键裁定列 + differExpectedPairs 空表起步）：

```js
#!/usr/bin/env node
// C8 迁移 registry（spec §5）：脚本产出迁移文件全集与分区计数——手写数字不作验收依据。
// 分区：画布域 / ve 域 / videos 域 / 域外单件 / 手写 CSS 块 / 测试分区 / 排除集（渲染产物白名单逐文件）。
// differExpectedPairs：D1b/D3 有意变更逐条登记（消费 css-baseline-diff.mjs D 段配对闸）。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

const RENDER_WHITELIST = [
  'src/pages/canvas/video-editor/renderer/canvas-renderer.ts',
  'src/pages/canvas/video-editor/export/worker.ts',            // 第五轮路径订正：worker 在 export/ 非 renderer/
  'src/pages/canvas/engine/Angle3DEngine.ts',                  // engine 在 pages/canvas/engine/（非 video-engine 下）
  'src/pages/canvas/engine/LightingEngine.ts',
  'src/pages/canvas/components/Lighting/ThreePreview.tsx',     // 预览产物在 components/Lighting|Angle3D/ 子目录
  'src/pages/canvas/components/Angle3D/Angle3DPreview.tsx',
];

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\(|\b(?:text|bg|border|ring|divide|fill|stroke|from|via|to)-(?:white|black)(?:\/\d{1,3})?\b|--canvas-|--ve-|--vw-/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
// 测试判据双形态：文件名后缀 + __tests__/ 目录（videos 域一等测试目录——抄 css-audit.mjs:165 既有写法）
const isTest = (f) => /\.(test|spec)\.[jt]sx?$/.test(f) || f.split(path.sep).includes('__tests__');
const stripTests = (files) => files.filter((f) => !isTest(f));

const canvas = stripTests(walk(path.join(SRC, 'pages/canvas')))
  .filter((f) => !f.includes(`${path.sep}video-editor${path.sep}`) && !RENDER_WHITELIST.includes(rel(f)));
const ve = stripTests(walk(path.join(SRC, 'pages/canvas/video-editor'))).filter((f) => !RENDER_WHITELIST.includes(rel(f)));
const videos = stripTests(walk(path.join(SRC, 'pages/videos')));
const extras = ['src/components/layout/WeChatFollowModal.tsx'];
const componentDirs = [path.join(SRC, 'components/MaterialLibrary'), path.join(SRC, 'components/BaseFullscreenModal.tsx')];
const cssBlocks = ['src/index.css', 'src/pages/canvas/components/nodes/prompt-input/PromptInput.css', 'src/pages/canvas/components/nodes/NodeHandle.css'];
const tests = [...walk(path.join(SRC, 'pages/canvas')), ...walk(path.join(SRC, 'pages/videos'))].filter(isTest);

const withHits = (files) => files.filter((f) => COLOR_RE.test(fs.readFileSync(f, 'utf8')));

/* 非 lint 可见盲区四分区（spec §11.1 + 审核补 <style> 块/rgba className 族/内容数据拆离；第六轮 P1-2 放宽）——
 * 两规则只拦 className 串 hex 与 white/black 类名；style 对象色值（#hex 与 rgba()/hsla() 蒙层——CreditsDropdown
 * :268 白辉光/:287-288 白系内阴影即活例，原 #hex-only 正则漏网）、SVG 呈现属性、JSX <style> 块、rgba( 任意值类
 * 全部漏网。styleObjects/svgAttrs/rgbaClasses 是核销清单；contentData（ve store 字幕默认 style:{color:'#FFFFFF'} 等
 * 内容语义色）显式排除——它们不是主题面，核销时勿混勾。 */
/* 第七轮 P1-2 订正：字段表补 backgroundImage|border\w*Color|fill|stroke|filter，量词改 [^;\n]*?——
 * [^,}]*? 过不去 gradient/boxShadow 内的逗号（CreditsDropdown :127 渐变基底/:287 白系内阴影均漏网）；
 * style 对象里逗号是常态、分号/换行才是语句边界。命名色工具类（zinc/amber/rose 族）仍不可见——
 * 第五盲区按"最小方案"专项覆盖（Task 19 Step 1 CreditsDropdown 逐类枚举），不建第五分区。 */
const STYLE_OBJECT_RE = /(?:backgroundImage|background|backgroundColor|boxShadow|color|border\w*Color|outline|fill|stroke|filter)\s*:\s*[^;\n]*?(?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/;
const SVG_ATTR_RE = /(?:fill|stroke|stopColor)\s*=\s*['"`][^'"`]*#[0-9a-fA-F]{3,8}/;
const STYLE_BLOCK_RE = /<style[^>]*>[\s\S]*?<\/style>/;
const RGBA_CLASS_RE = /(?:bg|text|border|ring|divide)-(?:\[[^\]]*rgba?\([^\]]*\])/;
const partitionBy = (files, re) => files.flatMap((f) => {
  const text = fs.readFileSync(f, 'utf8');
  return text.split('\n').map((line, i) => (re.test(line) ? { file: rel(f), line: i + 1, text: line.trim().slice(0, 120) } : null)).filter(Boolean);
});
const blindScope = [...canvas, ...ve, ...videos, ...stripTests(walk(path.join(SRC, 'components/MaterialLibrary')))];

const registry = {
  meta: {
    task: 'C8 画布域主题跟随——迁移 registry（spec 2026-09-20-canvas-domain-theme §5；D0-0 产出，D3 逐域核销）',
    generatedAt: new Date().toISOString(),
    renderWhitelist: RENDER_WHITELIST,
    notes: '逐键裁定列随 D1a/D1b/D3 各段填充；differExpectedPairs 为 D 段配对闸唯一来源（未配对=失败，adjudications 只记理由不吸收 diff）；盲区分区（styleObjects/svgAttrs/styleBlocks/rgbaClasses）是"两条 lint 规则都拦不到"位点的唯一清单产出，量级以脚本产出为准；CSS 声明形（如 background: #1a1a1a）实测会命中 styleObjects 正则——handwrittenCss（按文件）与 styleObjects（按位点）重叠收录属预期，核销按分区各自口径勾销勿互相推诿（第七轮 P1-2 订正，原"不匹配"表述作废）；配对残余分两类：全局继承族（body 底/前景→继承链，page 字段无效，永久全局配对——D1a body 两对即首例）与元素级（page 已收窄到同页），三源核销按类别核；命名色工具类（zinc/amber/rose 族）不属四分区可见面，唯一已知重灾区 CreditsDropdown 走 Task 19 专项枚举+B6；style 对象**跨行值**（属性名与值分行，如 CreditsDropdown:135-136 backgroundImage）逐行正则两行都不命中、不在 styleObjects 可见面——已知实例 CreditsDropdown:132-138 光斑层，逐行正则的结构限制，靠 Task 19 专项枚举兜底',
  },
  partitions: {
    canvasDomain: { files: withHits(canvas).map(rel), totalFiles: canvas.length },
    veDomain: { files: withHits(ve).map(rel), totalFiles: ve.length },
    videosDomain: { files: withHits(videos).map(rel), totalFiles: videos.length },
    externalSingles: { files: extras },
    componentDomains: { files: withHits(componentDirs.filter(fs.existsSync).flatMap((p) => (fs.statSync(p).isDirectory() ? stripTests(walk(p)) : [p]))).map(rel) },
    handwrittenCss: { files: cssBlocks },
    tests: { files: tests.map(rel) },
    styleObjects: { sites: partitionBy(blindScope, STYLE_OBJECT_RE) },
    svgAttrs: { sites: partitionBy(blindScope, SVG_ATTR_RE) },
    styleBlocks: { sites: [...canvas, ...ve, ...videos].filter((f) => STYLE_BLOCK_RE.test(fs.readFileSync(f, 'utf8'))).map(rel) },
    rgbaClasses: { sites: partitionBy(blindScope, RGBA_CLASS_RE) },
    contentDataExcluded: { why: 've store/测试内字幕默认 style:{fontSize,color} 等内容语义色非主题面，显式排除不核销' },
  },
  adjudications: [],
  differExpectedPairs: { pairs: [] },
  /* D3 涌现站点级登记（第五轮 M3/P1-7 采纳+第六轮页无关化）：{page, key, why}——D 对任何采集页 border-width 0→N 站点必须命中，
   * differ 消费（Task 3 Step 2 ⑤）。替代旧"PAGE_REGISTRY_FILES 粘贴 + 授权集并集"双写（D 域全量授权后
   * 文件级闸恒真 + 粘贴视图与 registry 双真源漂移），A5 旧路径不动。 */
  d3EmergentSites: [],
  whitelistKeeps: [],
};
/* 第八轮 P2-3 合并模式：adjudications/differExpectedPairs/d3EmergentSites/whitelistKeeps 四键是 D 段门禁真源、
 * 随各段手工累积——覆盖式重产（如 Task 22 新建 block-colors.ts 后刷新 partitions）会瞬间清零门禁。
 * 脚本只刷新 partitions/meta.renderWhitelist/meta.generatedAt，四手工键读既有文件保留。 */
const out = path.join(ROOT, 'e2e', 'audit', 'canvas-migration-registry.json');
if (fs.existsSync(out)) {
  const prev = JSON.parse(fs.readFileSync(out, 'utf8'));
  registry.adjudications = prev.adjudications ?? [];
  registry.differExpectedPairs = prev.differExpectedPairs ?? { pairs: [] };
  registry.d3EmergentSites = prev.d3EmergentSites ?? [];
  registry.whitelistKeeps = prev.whitelistKeeps ?? [];
}
fs.writeFileSync(out, JSON.stringify(registry, null, 1));
console.log('[registry] 分区计数：', Object.fromEntries(Object.entries(registry.partitions).map(([k, v]) => [k, v.files ? v.files.length : v.sites.length])));
```

- [ ] **Step 2: 跑脚本产出 registry**

```bash
cd /d/flowweb/apps/web && node scripts/canvas-migration-registry.mjs
```

Expected: 打印各分区计数（ve 源文件带色字面应约 8 个；videos 7 个左右——**以脚本产出为准，勿以本行数字为验收**；本步产出覆盖 Task 4 Step 0 的 stub）。

- [ ] **Step 3: 涌现闸接线核对（css-baseline-diff.mjs；D 对站点级闸已在 Task 3 Step 2 ⑤ 落地）**

第五轮订正：**原"PAGE_REGISTRY_FILES 三页数组粘贴 + authorizedFiles 并集"双写机制废止**——D 域全量文件授权后文件级闸在 canvas/ve/videos 三页退化为恒真（"必须归因登记组件"被整批吸收），且粘贴视图与 registry 构成双真源漂移（Task 22 新建 timeline/block-colors.ts 即会让视图过期）。替代 = **`d3EmergentSites` 站点级登记**（registry 新键，Task 5 Step 1 已加空表起步；differ 对 D 对**任何采集页**（页无关，第六轮）的 border-width 0→N 站点按 `page|key` 精确匹配，未登记即 offender）——D3 期间每处有意新增边框先跑 diff 拿 key 再登记，与 pairs 同工作流。A5 旧对完全不走新分支。spec 走 v1.5.2 变更登记（§6-④"两处同步"改写为站点级登记）。跑 `node scripts/css-baseline-diff.mjs --before before-A0 --after after-A` 确认 A5 旧行为零变化。

- [ ] **Step 4: before-D 采集已移除（第五轮 P0-1）——采集窗口在 Task 10 Step 4（D0 收口后、D1a 前）**

理由：D0 的 CanvasTopBar 新钮是有意 DOM 新增（新增 dom: 键——配对闸必红；位移走几何层 cascade 归因未必红，决定性论据是配对闸），若 before-D 采于 D0 之前，Task 10 的"D0 零 diff"数学上不成立。基线 = f(前置 commit, 采集器版本)，D0 收口后采集即得含两态 UI 的新基线，D1a 起各段 diff 语义不变。

- [ ] **Step 5: D0-0 段验收 + commit**

验收（spec §6）：D0-0 自身零产品改动 ✓（本任务只动脚本/审计档）；`npx playwright test e2e/d-segment-probes.spec.ts` 全绿（钉深值）✓；A5 旧对 diff 不回归 ✓。

```bash
cd /d/flowweb && git add apps/web/scripts/canvas-migration-registry.mjs apps/web/e2e/audit/canvas-migration-registry.json apps/web/e2e/audit/d0-noise-report.md apps/web/e2e/audit/d0-probe-values.json apps/web/scripts/css-baseline-diff.mjs && git commit -m "feat(web): C8 D0-0 收口——registry 脚本产出迁移清单(分区+渲染白名单路径实测订正 engine/export/worker+盲区四分区 styleObjects/svgAttrs/styleBlocks/rgbaClasses 位点级清单+componentDomains+__tests__ 判据+d3EmergentSites 站点级涌现登记空表)+噪声/探针结论文档入库；涌现闸 D 对改站点级判定(文件级授权在 D 域恒真废止，spec v1.5.2 登记)；before-D 采集窗口移至 Task 10(D0 新钮=有意 DOM 变更，零 diff 锚对 D0 不成立)"
```

---

## Task 6（D0）: themeStore 两态化（TDD 红→绿）

**Files:**
- Modify: `apps/web/src/stores/themeStore.test.ts`（大面积重写，spec §7.6）
- Modify: `apps/web/src/stores/themeStore.ts`
- 不动: `apps/web/src/stores/__tests__/matchMediaMock.ts`（保留——两态用例仍需 `media.set(反向值)` 钉「结果与 OS 偏好无关」）

- [ ] **Step 1: 重写测试（红）**

`themeStore.test.ts` 全量替换为：

```ts
// themeStore 单测（C8 D0 两态，spec 2026-09-20-canvas-domain-theme §7）：
// 真源=html 主题类；mode 两态（light/dark）持久化 localStorage['theme']；默认深（无跟随系统）；
// 'system' 残留读取侧映射 dark 不回写（P8）；storage 与 html 类冲突时 storage 优先并回挂（ensureInit 反转）。
// 懒加载契约：模块 import 零副作用——vi.resetModules + 每用例动态 import 取全新实例。
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMatchMediaMock, type MatchMediaMock } from './__tests__/matchMediaMock';

type ThemeModule = typeof import('./themeStore');

async function loadStore(): Promise<ThemeModule> {
  return import('./themeStore');
}

function htmlThemeClasses(): string[] {
  return Array.from(document.documentElement.classList).filter((c) => c === 'light' || c === 'dark');
}

describe('themeStore（两态）', () => {
  let media: MatchMediaMock;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');
    media = installMatchMediaMock();
  });

  it('模块导入零副作用（懒加载契约）——不挂 html 类、不读写 localStorage', async () => {
    await loadStore();
    expect(htmlThemeClasses()).toEqual([]);
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('无存储默认深（非跟随系统）——OS 浅下仍 mode=dark + html.dark，且不回写存储', async () => {
    media.set(true); // OS 浅：钉死「默认=深」而非「默认=跟随系统」
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'dark' });
    expect(htmlThemeClasses()).toEqual(['dark']);
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('非法存储值同默认深', async () => {
    localStorage.setItem('theme', 'blue');
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'dark' });
    expect(htmlThemeClasses()).toEqual(['dark']);
  });

  it('显式 light：mode=light + html.light（OS 深下不变）', async () => {
    media.set(false);
    localStorage.setItem('theme', 'light');
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'light' });
    expect(htmlThemeClasses()).toEqual(['light']);
  });

  it('显式 dark：mode=dark + html.dark（OS 浅下不变）', async () => {
    media.set(true);
    localStorage.setItem('theme', 'dark');
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'dark' });
    expect(htmlThemeClasses()).toEqual(['dark']);
  });

  it("'system' 残留 → 读取侧映射 dark + html.dark，且不回写存储（P8，保持 boot 不写盘契约）", async () => {
    media.set(true); // OS 浅——残留 system 也不跟随 OS，恒落深
    localStorage.setItem('theme', 'system');
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'dark' });
    expect(htmlThemeClasses()).toEqual(['dark']);
    expect(localStorage.getItem('theme'), '残留值原样保留，不回写').toBe('system');
  });

  it('storage 与 html 类冲突：storage 优先并回挂 html 类（ensureInit 反转，P8 配套）', async () => {
    localStorage.setItem('theme', 'light');
    document.documentElement.classList.add('dark'); // 内联脚本历史产物与 storage 冲突
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'light' });
    expect(htmlThemeClasses(), 'storage=light 必须重挂 html.light').toEqual(['light']);
  });

  it('读抛（隐私模式）+ html.light 提示 → light（三级回落第二级）', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    document.documentElement.classList.add('light');
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'light' });
    expect(htmlThemeClasses()).toEqual(['light']);
  });

  it('读抛（隐私模式）+ 无 html 类 → dark（三级回落兜底）', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'dark' });
    expect(htmlThemeClasses()).toEqual(['dark']);
  });

  it('setMode 两态：写 localStorage + 挂对应类 + 通知订阅者 + 快照引用更换', async () => {
    const store = await loadStore();
    const seen: Array<{ mode: string }> = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()));
    const before = store.getSnapshot();

    store.setMode('light');
    expect(localStorage.getItem('theme')).toBe('light');
    expect(htmlThemeClasses()).toEqual(['light']);

    store.setMode('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(htmlThemeClasses()).toEqual(['dark']);

    expect(seen.length, '每次 setMode 通知一次（2 次）').toBe(2);
    expect(store.getSnapshot()).not.toBe(before);

    unsubscribe();
    store.setMode('light');
    expect(seen.length, '退订后不再通知').toBe(2);
  });

  it('useTheme：useSyncExternalStore 集成——首渲染取默认深，setMode 触发重渲染', async () => {
    const { useTheme, setMode } = await loadStore();
    const { result } = renderHook(() => useTheme());
    expect(result.current).toEqual({ mode: 'dark' }); // 无存储默认深（懒 init 由首渲染触发）
    act(() => setMode('light'));
    expect(result.current).toEqual({ mode: 'light' });
  });
});
```

- [ ] **Step 2: 跑红**

```bash
cd /d/flowweb/apps/web && npx vitest run src/stores/themeStore.test.ts
```

Expected: FAIL——system 残留/回落/storage 优先等新用例对三态实现红（`mode:'system'` 不等于 `'dark'` 等）。

- [ ] **Step 3: 重写 store（绿）**

`themeStore.ts` 全量替换为：

```ts
// 主题 store（C8 D0 两态，spec 2026-09-20-canvas-domain-theme §7）：真源 = documentElement 的
// .light/.dark 类（非 React state）；mode 两态持久化 localStorage['theme']；无 system 档、无 matchMedia。
// - 缺省/非法存储默认深；'system' 残留读取侧映射 dark 不回写（P8）——残留**永不主动清理**（仅用户手动
//   切换覆盖），此为有意契约非遗漏；两标签页无 storage 事件同步（单用户开发期无影响，已知接受）。
// - mode 即唯一态（"用户选择"与"实际渲染"随 resolved 概念消亡不再可区分）——若将来做"跟随系统"回归
//   需重新引入第三概念，本简化是有意的（P1）。
// - 懒加载契约：模块 import 零副作用，首个 getSnapshot/subscribe/setMode 调用时才初始化。
// - useSyncExternalStore 兼容：subscribe/getSnapshot 直接可用，useTheme 为 React 绑定。
import { useSyncExternalStore } from 'react';

export type ThemeMode = 'light' | 'dark';

export interface ThemeState {
  /** 用户选择档 = html 类实际状态（两态单值，resolved 概念随 system 档消亡） */
  mode: ThemeMode;
}

const STORAGE_KEY = 'theme';
/** SSR/懒加载前占位快照（默认深）——getServerSnapshot 同引用 */
const INITIAL_STATE: ThemeState = { mode: 'dark' };

let state: ThemeState = INITIAL_STATE;
let initialized = false;
const listeners = new Set<() => void>();

/** 读存储两态；缺省/非法/'system' 残留/读抛（隐私模式）→ null（三级回落交 ensureInit：storage → html 类提示 → dark） */
function readStoredMode(): ThemeMode | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

/** html 恒有且仅有 .light/.dark 之一（内联脚本契约，store 同口径维护） */
function applyClass(mode: ThemeMode): void {
  const el = document.documentElement;
  el.classList.remove('light', 'dark');
  el.classList.add(mode);
}

function setState(next: ThemeState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** 幂等懒初始化（P8 反转）：storage 优先并回挂 html 类；storage 缺失回落 html 类提示（内联脚本产物），再回落 dark */
function ensureInit(): void {
  if (initialized || typeof document === 'undefined') return;
  initialized = true;
  const classList = document.documentElement.classList;
  const htmlHint: ThemeMode | null = classList.contains('light')
    ? 'light'
    : classList.contains('dark')
      ? 'dark'
      : null;
  const mode = readStoredMode() ?? htmlHint ?? 'dark';
  applyClass(mode);
  state = { mode };
}

/** 应用侧接线入口（main.tsx 调用）：显式初始化契约声明（spec §10.6——懒初始化下首帧与调用顺序无关） */
export function initThemeSync(): void {
  ensureInit();
}

/** 两态切换：写 localStorage + 挂 html 类 + 通知订阅者 */
export function setMode(mode: ThemeMode): void {
  ensureInit();
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* 隐私模式写失败——内存态与 html 类仍生效 */
  }
  applyClass(mode);
  setState({ mode });
}

export function subscribe(listener: () => void): () => void {
  ensureInit();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): ThemeState {
  ensureInit();
  return state;
}

/** React 绑定（useSyncExternalStore：subscribe/getSnapshot 直接兼容） */
export function useTheme(): ThemeState {
  return useSyncExternalStore(subscribe, getSnapshot, () => INITIAL_STATE);
}
```

- [ ] **Step 4: 跑绿（本任务不单独 commit——D0 段原子 commit 在 Task 10）**

```bash
cd /d/flowweb/apps/web && npx vitest run src/stores/themeStore.test.ts
```

Expected: PASS 全绿。随后全量 `npx vitest run`——TopActionBar/其他消费 `resolved`/`system` 的用例会红（Step 接 Task 7/8/9 修）。

---

## Task 7（D0）: App.tsx mode 派生 + index.html 两态脚本 + main.tsx 注释

**Files:**
- Modify: `apps/web/src/App.tsx:10-14`
- Modify: `apps/web/index.html:6-22`
- Modify: `apps/web/src/main.tsx:7-9`

- [ ] **Step 1: App.tsx**

`const { resolved } = useTheme();`（:10）→ `const { mode } = useTheme();`；algorithm 行（:14）→ `algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,`。注释改写：`// C8 D0 两态：algorithm 由 mode 派生——DOM 类 / antd algorithm / ReactFlow colorMode 三处同源由 mode 推导`。

- [ ] **Step 2: index.html 防闪白脚本两态化**

`<script>`（:10-21）替换为：

```html
      // C1 主题防闪白（C8 D0 两态）：先于一切模块脚本读 localStorage 并挂 html 类——
      // 真源 = html 类，恒有且仅有 .light/.dark 之一；light 显式浅、dark/缺省/非法/'system' 残留
      // 一律默认深（P8 残留映射，不回写、不 matchMedia）。与 themeStore 同口径。
      (function () {
        var theme = 'dark';
        try {
          if (localStorage.getItem('theme') === 'light') theme = 'light';
        } catch (e) {}
        var classList = document.documentElement.classList;
        classList.remove('light', 'dark');
        classList.add(theme);
      })();
```

- [ ] **Step 3: main.tsx 注释改写（初始化契约，spec §10.6）**

:7-8 注释替换为：

```ts
// 初始化契约（C8 D0）：initThemeSync 先于 createRoot().render() 是显式契约声明——懒初始化 +
// 内联脚本使首帧实际与调用顺序无关（useSyncExternalStore 首渲染 getSnapshot 即 ensureInit）；
// 非"不加就闪"（防后人据错误因果去"修"不存在的问题，spec §10.6）。
```

- [ ] **Step 4: 跑相关单测**

```bash
cd /d/flowweb/apps/web && npx vitest run
```

Expected: themeStore/App 相关绿；TopActionBar（THEME_CYCLE 消费）等仍红 → Task 8/9。

---

## Task 8（D0）: ThemeToggleButton 共享组件 + TopActionBar 两态 + CanvasTopBar 新钮

**Files:**
- Create: `apps/web/src/components/theme/ThemeToggleButton.tsx`
- Create: `apps/web/src/components/theme/ThemeToggleButton.test.tsx`
- Modify: `apps/web/src/components/layout/TopActionBar.tsx:5,11,15-20,33-34,89-97`
- Modify: `apps/web/src/pages/canvas/components/CanvasTopBar.tsx:127`

- [ ] **Step 1: 写失败测试**

`ThemeToggleButton.test.tsx`：

```tsx
// 两态切换钮（C8 D0）：aria/title 常量共享（G7 按 aria-label 锚定）；点击写存储 + 挂 html 类。
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ThemeToggleButton', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');
  });

  it('默认深：aria-label=切换主题，当前：深色；点击 → html.light + 存储写 light + aria 翻浅色', async () => {
    const { ThemeToggleButton } = await import('./ThemeToggleButton');
    const { unmount } = render(<ThemeToggleButton />);
    const btn = screen.getByRole('button', { name: '切换主题，当前：深色' });
    expect(btn).toHaveAttribute('title', '主题：深色（点击切换为浅色）');
    fireEvent.click(btn);
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('light');
    expect(screen.getByRole('button', { name: '切换主题，当前：浅色' })).toBeInTheDocument();
    unmount();
  });

  it('浅档点击回深（两态往返）', async () => {
    localStorage.setItem('theme', 'light');
    const { ThemeToggleButton } = await import('./ThemeToggleButton');
    render(<ThemeToggleButton />);
    fireEvent.click(screen.getByRole('button', { name: '切换主题，当前：浅色' }));
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
```

跑红：`cd /d/flowweb/apps/web && npx vitest run src/components/theme/ThemeToggleButton.test.tsx` → FAIL（模块不存在）。

- [ ] **Step 2: 实现组件**

`ThemeToggleButton.tsx`：

```tsx
// C8 D0 两态切换钮（spec §7.4/7.5）：TopActionBar 与 CanvasTopBar 共享——label/aria 常量同源，
// G7 按 aria-label 锚定防两处漂移。chrome 跟随主题（token 工具类）。
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { setMode, useTheme, type ThemeMode } from '@/stores/themeStore';

export const THEME_LABEL: Record<ThemeMode, string> = { light: '浅色', dark: '深色' };

const BTN = 'h-8 w-8 rounded-lg border border-overlay-2 bg-overlay-1 hover:bg-surface-dim hover:border-overlay-3 text-text-dim-3 hover:text-text flex items-center justify-center transition-colors duration-150';

export function ThemeToggleButton() {
  const { mode } = useTheme();
  const next: ThemeMode = mode === 'dark' ? 'light' : 'dark';
  const Icon = mode === 'dark' ? MoonOutlined : SunOutlined;
  return (
    <button
      onClick={() => setMode(next)}
      aria-label={`切换主题，当前：${THEME_LABEL[mode]}`}
      title={`主题：${THEME_LABEL[mode]}（点击切换为${THEME_LABEL[next]}）`}
      className={BTN}
    >
      <Icon className="text-base" />
    </button>
  );
}
```

跑绿：`npx vitest run src/components/theme/ThemeToggleButton.test.tsx` → PASS。

- [ ] **Step 3: TopActionBar 改两态**

① 删 import 中 `DesktopOutlined` 与 `setMode, useTheme, type ThemeMode`（:5/:11——改 import `ThemeToggleButton`：`import { ThemeToggleButton } from '@/components/theme/ThemeToggleButton';`）。② 删 THEME_CYCLE 块（:15-20）。③ 删 `:33-34` 两行（themeMode 解构）。④ 切换钮 JSX（:90-97 的 `<button …>`）替换为：

```tsx
      {/* C8 D0 两态切换：共享组件（aria/label 常量同源）；chrome 跟随主题 */}
      <ThemeToggleButton />
```

⑤ 同栏视觉一致（审核补）：`BTN` 常量（:22）`border-[rgba(255,255,255,0.1)]` → `border-overlay-2`（深值 rgba(255,255,255,0.1) **字节等值**，D0 内安全换）；`bg-[rgba(255,255,255,0.04)]` 与 overlay-1 深值 0.05 **不等值**——D0 不动，登记进 Task 15 的 D1b ② 收敛清单（0.04→0.05 换 `bg-overlay-1`，深档 diff 随该段配对吸收），避免浅色档下共享切换钮与相邻三钮裸奔不一致。

- [ ] **Step 4: CanvasTopBar 增设切换钮（/canvas 不套 AppLayout 的唯一入口，P1/§1.4）**

`CanvasTopBar.tsx` 顶部行容器（:127 `<div className="absolute top-3 right-4 z-50 flex items-center gap-3">`）的首个子元素位置插入：

```tsx
        <ThemeToggleButton />
```

并加 import `import { ThemeToggleButton } from '@/components/theme/ThemeToggleButton';`。

- [ ] **Step 5: 全量单测**

```bash
cd /d/flowweb/apps/web && npx vitest run
```

Expected: PASS（若有历史用例断言 TopActionBar 三态钮/aria，同步改两态——用例语义与 THEME_LABEL 常量对齐）。

---

## Task 9（D0）: c0 e2e 同步（G1/G2/G3/G7 两态改写）

**Files:**
- Modify: `apps/web/e2e/c0-theme.spec.ts`（G1 :102-122 / G2 静态 :168-191 / G3 :208-226 / G7 :379-483——第六轮 Files 头订正，与 Step 4 区间一致）

- [ ] **Step 1: G1 删 2 条 system 例**

`THREE_STATE_CASES` 删 `system+OS浅`、`system+OS深` 两行（保留 light/dark/无存储默认深三条）。`StoredTheme` 类型改 `'light' | 'dark'`。文件头组1 注释补一句：`（C8 D0 两态化：system 例删——残留映射深由 themeStore 单测覆盖）`。

- [ ] **Step 2: G2 静态判别式换两态**

:183 命中条件 `/theme/.test(m[1]) && /localStorage/.test(m[1]) && /matchMedia/.test(m[1])` 改为：

```ts
      if (/theme/.test(m[1]!) && /localStorage/.test(m[1]!) && !/matchMedia\(/.test(m[1]!)) { themeScriptIdx = m.index; break; }
```

（⚠ 判别式用**调用形态** `matchMedia\(` 非裸词——Task 7 落的内联脚本注释含"不 matchMedia"字样（dist 产物保留注释），裸词负向匹配会把唯一候选脚本判飞 → themeScriptIdx=-1 必红；调用形态跳过注释、真 `matchMedia(` 调用仍红。实施期实证修订。）

测试名与断言 message 同步：`head 内联主题脚本（含 theme/localStorage、不含 matchMedia、无 defer/async）先于 <script type="module">`——顺带成为"无 system 档"的机械断言。

- [ ] **Step 3: G3 改写为「OS 零影响 + matchMedia 计数 0」**

`G3 system 档随 OS 同页实时翻转` 用例（:208-226）整条替换为：

```ts
test('G3 OS 偏好零影响 + prefers-color-scheme matchMedia 调用计数 0（C8 两态无 system 档）', async ({ browser }) => {
  const ctx = await newSeededContext(browser, 'light');
  const page = await ctx.newPage();
  try {
    // wrap matchMedia 计数（按 query 过滤——matchMedia 亦被 antd responsiveObserver 用于响应式，不过滤会误红）
    await page.addInitScript(() => {
      const calls: string[] = [];
      (window as unknown as { __mqCalls: string[] }).__mqCalls = calls;
      const orig = window.matchMedia.bind(window);
      window.matchMedia = (q: string) => { calls.push(q); return orig(q); };
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await openWorks(page);
    expectHtmlTheme(await readHtmlTheme(page), 'light', '[G3/显式浅@OS深]');
    await page.emulateMedia({ colorScheme: 'light' }); // 同向翻转
    await page.waitForTimeout(300);
    expectHtmlTheme(await readHtmlTheme(page), 'light', '[G3/OS 翻转零影响]');
    const calls = await page.evaluate(() => (window as unknown as { __mqCalls: string[] }).__mqCalls);
    const themeCalls = calls.filter((c) => c.includes('prefers-color-scheme'));
    expect(themeCalls, `[G3] prefers-color-scheme 的 matchMedia 调用数必须为 0（无 system 档无订阅）；实际=${JSON.stringify(themeCalls)}`).toEqual([]);
  } finally {
    await ctx.close();
  }
});
```

- [ ] **Step 4: G7 两态往返 + 钮存在性扩三页**

① `THEME_UI`（:383-387）删 system 行——**类型同步收窄**（第五轮 M7）：`Record<'light' | 'dark', …>`，`expectThemeButton(page, mode: 'light' | 'dark')` 签名同改；c0 组7 区间实为 **:379-483**（:461-483 的 LoginModal 活体用例共享 THEME_UI 类型——本段不动其内容但类型收窄惠及）；`m[1]!` 非空断言保持现状。② 三态循环用例（:398-443）替换为两态往返：

```ts
test('G7 两态往返：默认深 → 浅（显式压 OS）→ 深；aria/图标随态', async ({ browser }) => {
  const ctx = await newSeededContext(browser, null); // 无存储默认深（D3）
  const page = await ctx.newPage();
  try {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openWorks(page);
    expectHtmlTheme(await readHtmlTheme(page), 'dark', '[G7/初始默认深]');
    const btn = await expectThemeButton(page, 'dark');
    await expect(btn).toHaveAttribute('title', '主题：深色（点击切换为浅色）');

    // 点击 1：dark → light
    await btn.click();
    await expectThemeButton(page, 'light');
    expect(await page.evaluate(() => localStorage.getItem('theme')), '[G7/light] 存储应写 light').toBe('light');
    expectHtmlTheme(await readHtmlTheme(page), 'light', '[G7/显式浅]');

    //（quality review 删"显式浅压 OS"块：初始 emulateMedia 已是 dark，再次 dark 是 no-op——
    //  change 不触发、300ms 等不到事件、断言与 [G7/显式浅] 重复；真翻转覆盖由 G3 承担。）

    // 点击 2：light → dark（往返闭合）——click() 本身须 await（第五轮 P2：floating promise flaky 源）
    await (await expectThemeButton(page, 'light')).click();
    await expectThemeButton(page, 'dark');
    expect(await page.evaluate(() => localStorage.getItem('theme')), '[G7/dark] 存储应写 dark').toBe('dark');
    expectHtmlTheme(await readHtmlTheme(page), 'dark', '[G7/循环回深]');
  } finally {
    await ctx.close();
  }
});
```

③ 钮存在性用例（:445-457）扩 /canvas：

```ts
test('G7 切换钮存在于 /works、/videos、/canvas（aria 锚定；新钮落地验证）', async ({ browser }) => {
  const ctx = await newSeededContext(browser, null); // 默认深
  const page = await ctx.newPage();
  try {
    await openWorks(page);
    await expectThemeButton(page, 'dark');
    await openVideos(page);
    await expectThemeButton(page, 'dark');
    await page.goto('/canvas?projectId=gate-canvas-1');
    await expect(page.locator('.react-flow__node[data-id="gate-node-1"]')).toBeVisible({ timeout: 20_000 });
    await expectThemeButton(page, 'dark'); // CanvasTopBar 共享钮（C8 D0）
  } finally {
    await ctx.close();
  }
});
```

- [ ] **Step 5: c0 全绿**

```bash
cd /d/flowweb/apps/web && npx playwright test e2e/c0-theme.spec.ts
```

Expected: 全绿（G4/G5/G8 本段不动——岛断言仍按现状绿）。

---

## Task 10（D0）: D0 段验收 + 原子 commit

**Files:** 无新增改动（验收 + 提交 Task 6-9 产物）。

- [ ] **Step 1: D 段探针 + c0 全绿（D0 验收锚——第五轮 P0-1 起不再有"D0 零 diff"）**

```bash
cd /d/flowweb/apps/web && npx playwright test e2e/d-segment-probes.spec.ts e2e/c0-theme.spec.ts
```

Expected: 全绿。**"segcheck-D0 × before-D = 0 diff"已废止**：D0 含有意 DOM 变更（CanvasTopBar 首位插入切换钮 = 新增 dom: 键，配对闸必红——位移有 cascade 归因，决定性论据是配对闸）——D0 的回归保障 = c0 两态断言（G1/G2/G3/G7 + 钮存在性三页）+ D 段探针 + Step 2 全门禁，"零 diff"锚从 D0 起让位给 before-D 采集（Step 4）。

- [ ] **Step 2: 全门禁**

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs
```

Expected: e2e 全绿（41±用例数变化：G1 -2、G3 重写 1）、vitest 全绿、lint 双规则 PASS。

- [ ] **Step 3: 原子 commit（D0 六件套 + c0 同步）**

```bash
cd /d/flowweb && git add apps/web/src/stores/themeStore.ts apps/web/src/stores/themeStore.test.ts apps/web/src/App.tsx apps/web/index.html apps/web/src/main.tsx apps/web/src/components/theme/ apps/web/src/components/layout/TopActionBar.tsx apps/web/src/pages/canvas/components/CanvasTopBar.tsx apps/web/e2e/c0-theme.spec.ts && git commit -m "feat(web): C8 D0 两态六件套——themeStore 单值 mode 删 system/matchMedia(P8 残留映射深不回写+storage 优先回挂 html 类)+App algorithm 由 mode 派生+index.html 两态脚本+ThemeToggleButton 共享组件(TopActionBar 两态化+CanvasTopBar 新钮三页入口)+c0 同步(G1 删 system 例/G2 判别式去 matchMedia/G3 OS 零影响+matchMedia 计数 0/G7 两态往返+钮存在性扩 /canvas)；D0 有意 DOM 变更=CanvasTopBar 新钮（before-D 采集于本 commit 后，见 Step 4）"
```

- [ ] **Step 4: 采 before-D + before-D-light（唯一时间窗：本 commit 后、Task 11/D1a 前；8 页 × 2）**

```bash
cd /d/flowweb/apps/web && COLLECT_BASELINE=1 BASELINE_DIR=before-D npx playwright test e2e/a0-collect-baseline.spec.ts && COLLECT_BASELINE=1 REAL_LIGHT=1 BASELINE_DIR=before-D-light npx playwright test e2e/a0-collect-baseline.spec.ts && head -20 e2e/baseline/before-D/meta.json && head -20 e2e/baseline/before-D-light/meta.json
```

Expected: 两侧各 8 页落盘 + meta 含 `attrSetVersion: 'D1'` + before-D-light 的 realLight.htmlClassPerPage 全 'light'。**采集自证判据（第六轮 P1-4）**：`before-D/canvas.json` 与 `before-D-light/canvas.json` 的 elementCount 同量级（±5）、两 meta.commit == 本 commit、各页 elementCount 与 Task 4 噪声运行同量级——防"采集于错误 HEAD/脏夹具"（gate-seed 是无条件重写式自愈非仅幂等，采集前勿手工改 gate 画布）。

**采集器冻结令（第六轮语义化重写——原"任何一行"与 Task 15/17/21/26 的探针改动正面冲突）**：
- **冻结面（改动即基线不可复采，停手）**：snapshotDom 函数体（属性集/元素集/排除规则/stableKey）、页面清单与页面流程、沉降参数、meta.attrSetVersion、浅色注入机制（REAL_LIGHT storage 路径）。
- **允许面（不进快照/meta 键集）**：ANY_LIGHT 探针块（LIGHT_PROBES/FLIP_PROBES/probeInvariance/probeFlip 的 id 与期望值——按探针生命周期表随段反转，Task 15/17/21 的改动全在此面）与叙事注释。
- **机械守卫（第七轮 P1-1 重写、第八轮边界收窄——原"snapshotDom 区间+git log"方案双重失效：git log -1 是文件最后一次提交哈希，Task 15/17/21 每次合法探针改动都会让指纹变=每次允许的改动都触发停手复核；而 SETTLE_MS/页清单/注入机制/meta 段又不在 snapshotDom 区间内=改了不红）**：本 Step 落指纹 `e2e/audit/a0-collector-fingerprint.txt`（内容 = `sed -n '/COLLECTOR-FROZEN-BEGIN/,/COLLECTOR-FROZEN-END/p' e2e/a0-collect-baseline.spec.ts | sha256sum` 的输出 + **sed 命令原文一行随档（§0 复核补："怎么算的"与"算出什么"同档可复算，勿只存哈希）**——标记随 Task 3 Step 1 同 commit 已加入，多对同名标记 sed 全取，**只圈契约字段四段：SETTLE_MS/注入机制本体/snapshotDom 函数体/afterAll 内 attrSetVersion 行+computedPropertySet 数组两小段——afterAll 其余成员（invocation/theme 叙事串、islandInvarianceProbes/flipProbes spread）显式排除在标记外，Task 17 增 flipProbes/Task 26 改叙事不触发**）；**此后每次 segcheck 采集前重跑该 sed|sha256sum 与指纹比对，指纹变 = 冻结面被改 = 停手复核**（探针块与叙事注释在标记外天然不触发；页清单/流程不进指纹——页集**减**由 differ 缺页比对守卫、页集**增**由 Task 3 Step 2 ②b union 页循环守卫，双向闭合）。

浅侧说明：D1a 起浅侧 diff 的有意变更（D2 板面/D3 各域翻转等）值全部预知（=DOMAIN_LIGHT 表等），逐段入 pairs（**优先带 page 字段**，见总纲 §1）；浅侧未配对=失败——这正是"目标方向有机械守卫"的落点（第五轮 P0-3：几百迁移位点不能只靠 ~12 条探针 + B6 目检守"必须变对的方向"）。

```bash
cd /d/flowweb && git add apps/web/e2e/baseline/before-D apps/web/e2e/baseline/before-D-light apps/web/e2e/audit/a0-collector-fingerprint.txt && git commit -m "chore(e2e): C8 before-D/before-D-light 基线入档（D1 属性集 8 页×2，D0 收口后 D1a 前唯一窗口；浅侧=REAL_LIGHT 真实路径）+采集器冻结面指纹（snapshotDom 函数体 sha256——此后 segcheck 前比对，冻结=口径/探针面允许随段反转，第六轮语义化）——此后 D1a 起段验收深浅双跑，有意变更入 differExpectedPairs（优先带 page 字段）未配对即失败"
```

---

## Task 11（D1a）: b0/b1 域 token 断言扩展（红）

**Files:**
- Modify: `apps/web/e2e/b0-token-blocks.spec.ts`
- Modify: `apps/web/e2e/b1-token-migration.spec.ts`

- [ ] **Step 1: b0 增域 token 值断言组**

`b0-token-blocks.spec.ts` 在 LIGHT 表（:63）后追加域 token 表，并新增两个 describe：

```ts
/** C8 D1a 域 token 双值化（spec §8.1 表）——深值=现状冻结；浅值=D1b 并域目标键浅值 */
const DOMAIN_TOKENS = [
  '--canvas-board-bg', '--canvas-board-dot', '--canvas-controls-bg', '--canvas-controls-border',
  '--canvas-controls-text', '--canvas-controls-hover', '--canvas-controls-active', '--canvas-controls-icon',
  '--canvas-handle-bg', '--canvas-handle-icon',
  '--canvas-handle-hover-bg', '--canvas-handle-hover-icon', '--edge-flow-color', '--edge-highlight-color',
  '--ve-bg', '--ve-panel', '--ve-border', '--ve-text', '--ve-text-dim', '--ve-accent',
  '--vw-card-bg', '--vw-card-border', '--vw-card-border-hover',
] as const;

const DOMAIN_DARK: Record<string, string> = {
  '--canvas-board-bg': '#000000',
  '--canvas-board-dot': '#555555',
  '--canvas-controls-bg': 'rgb(38,38,38)',
  '--canvas-controls-border': 'rgb(54,54,54)',
  '--canvas-controls-text': 'rgb(247,247,247)',
  '--canvas-controls-hover': 'rgba(255,255,255,0.08)',
  '--canvas-controls-active': 'rgba(255,255,255,0.12)',
  '--canvas-controls-icon': 'rgb(160,160,160)',
  '--canvas-handle-bg': '#9ca3af',
  '--canvas-handle-icon': '#6b7280',
  '--canvas-handle-hover-bg': '#ffffff',
  '--canvas-handle-hover-icon': '#ffffff',
  '--edge-flow-color': '#3b82f6',
  '--edge-highlight-color': '#999',
  '--ve-bg': '#141414',
  '--ve-panel': 'rgb(38,38,38)',
  '--ve-border': 'rgb(54,54,54)',
  '--ve-text': '#e2e8f0',
  '--ve-text-dim': 'rgba(226,232,240,0.6)',
  '--ve-accent': '#6c5ce7',
  '--vw-card-bg': '#1e1e1e',
  '--vw-card-border': 'rgba(255,255,255,0.1)',
  '--vw-card-border-hover': 'rgba(255,255,255,0.25)',
};

const DOMAIN_LIGHT: Record<string, string> = {
  '--canvas-board-bg': '#f5f5f5',
  '--canvas-board-dot': '#c8c8c8',
  '--canvas-controls-bg': '#f0f1f2',
  '--canvas-controls-border': '#e5e7eb',
  '--canvas-controls-text': '#111827',
  '--canvas-controls-hover': 'rgba(0,0,0,0.06)',
  '--canvas-controls-active': 'rgba(0,0,0,0.08)',
  '--canvas-controls-icon': '#6b7280',
  '--canvas-handle-bg': '#6b7280',
  '--canvas-handle-icon': '#4b5563',
  '--canvas-handle-hover-bg': '#111827',
  '--canvas-handle-hover-icon': '#111827',
  '--edge-flow-color': '#3b82f6',
  '--edge-highlight-color': '#6b7280',
  '--ve-bg': '#f7f8fa',
  '--ve-panel': '#f0f1f2',
  '--ve-border': '#e5e7eb',
  '--ve-text': '#1f2329',
  '--ve-text-dim': '#4b5563',
  '--ve-accent': '#6c5ce7',
  '--vw-card-bg': '#ffffff',
  '--vw-card-border': 'rgba(0,0,0,0.06)',
  '--vw-card-border-hover': 'rgba(0,0,0,0.12)',
};
```

`readTokens` 的 evaluate 参数 tokens 传 `[...TOKENS, ...DOMAIN_TOKENS]` 方式复用（**现签名已是 `(page, selector)` 两参（b0:67）——tokens 是加第三参** `function readTokens(page: Page, selector: string, tokens: string[] = [...TOKENS])`，勿与 selector 撞名）。**⚠ 第七轮 P1-4：两个 B0-6 用例必须显式传第三参 `[...TOKENS, ...DOMAIN_TOKENS]`——缺参时 tokens 默认只有 TOKENS（--fw-*），域 token 全取 undefined，断言消息还 dump 整份 s 误导排查方向"token 不存在"（Task 11 红相看不出、Task 12 永不绿）**。新增：

```ts
test.describe('B0-6 C8 域 token 双值化（D1a）', () => {
  test('默认深：域 token 全部深值 + 死键 --ve-text-control 已删（controls-active 复活为双值键在表内）', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: USER_STATE });
    const page = await ctx.newPage();
    try {
      await openWorks(page);
      // ⚠ 实施期订正（Task 11 红相实证）：死键断言要求 '--ve-text-control' 在读取列表内——不在列表则 s 恒
      // undefined≠''，Task 12 删键后仍红（结构性永红）。当前红=var 链值 rgb(247,247,247)≠''，删键后 getPropertyValue
      // 返回 ''→绿。第七轮 P1-4 的"显式传第三参"原则不变，仅列表多一死键探测位。
      const s = await readTokens(page, 'html', [...TOKENS, ...DOMAIN_TOKENS, '--ve-text-control']);
      for (const t of DOMAIN_TOKENS) {
        expect(s[t], `[B0-6] ${t} 深值期望 ${DOMAIN_DARK[t]}；实际=${JSON.stringify(s)}`).toBe(DOMAIN_DARK[t]);
      }
      // 第六轮：--canvas-controls-active 复活为激活态双值键（原"0 消费死键"判定撤销——它在 CanvasToolbar
      // 因内联 style 不消费 var() 而"死"，激活态语义没死，Task 22 BTN_BG_ACTIVE 复用；见 P1-1 裁定）
      expect(s['--ve-text-control'], '死 token 必须删除（D1a）').toBe('');
    } finally { await ctx.close(); }
  });

  test('html.light：域 token 全部浅值（双块源序）', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: USER_STATE });
    const page = await ctx.newPage();
    try {
      await openWorks(page);
      await page.evaluate(() => document.documentElement.classList.add('light'));
      const s = await readTokens(page, 'html', [...TOKENS, ...DOMAIN_TOKENS]);
      for (const t of DOMAIN_TOKENS) {
        expect(s[t], `[B0-6] ${t} 浅值期望 ${DOMAIN_LIGHT[t]}；实际=${JSON.stringify(s)}`).toBe(DOMAIN_LIGHT[t]);
      }
    } finally { await ctx.close(); }
  });
});
```

- [ ] **Step 2: b1 增域 token 块唯一性+源序断言**

`b1-token-migration.spec.ts` 文件尾追加：

```ts
test.describe('B1-4【C8 D1a】域 token 块唯一性 + 源序（:root,.dark/.light 各恰一块且 .light 在后）', () => {
  test('产品 sheet 内域 token（--canvas-/--ve-/--vw-，排除单值恒值键）恰一对主题块', async ({ page }) => {
    await openLogin(page);
    const snap = await page.evaluate(() => {
      const isProduct = (i: number) => {
        const n = document.styleSheets[i].ownerNode as HTMLLinkElement | null;
        return !!n && n.tagName === 'LINK' && /\/assets\/[^/]+\.css$/.test(n.getAttribute('href') ?? '');
      };
      // 单值恒值键（几何/内容承载）不入双块纪律——白名单排除；--ve-accent-text 是双值键（D1b 落地）不入此表
      const SINGLE = /--(?:z-panel|vw-close-reserve|vw-carousel-reserve|ve-track-video|ve-thumb-base|ve-preview-base)/;
      const hits: Array<{ idx: number; selector: string; keys: string[] }> = [];
      for (let i = 0; i < document.styleSheets.length; i++) {
        if (!isProduct(i)) continue;
        let rules: CSSRuleList;
        try { rules = document.styleSheets[i].cssRules; } catch { continue; }
        for (let j = 0; j < rules.length; j++) {
          const r = rules[j];
          if (!(r instanceof CSSStyleRule)) continue;
          // ⚠ 实施期订正（Task 11 红相实证）：原键正则不区分声明与 var() 引用——NodeHandle.css hover 规则与
          // 13 条 Tailwind 任意值工具类（消费方）都被计入 hits → darkBlocks=18≠1 永不绿。改声明位匹配（--x: 形态，
          // matchAll 取捕获组），只数定义块；var() 消费规则天然不命中。
          const keys = [...new Set([...r.style.cssText.matchAll(/(?:^|;)\s*(--(?:canvas-|ve-|vw-)[\w-]+)\s*:/g)].map((m) => m[1]!))].filter((k) => !SINGLE.test(k));
          if (keys.length) hits.push({ idx: j, selector: r.selectorText, keys });
        }
      }
      return hits;
    });
    const dump = JSON.stringify(snap);
    const darkBlocks = snap.filter((h) => !h.selector.includes('.light'));
    const lightBlocks = snap.filter((h) => h.selector.includes('.light'));
    expect(darkBlocks.length, `[B1-4] 域 token 深值必须集中在唯一 :root,.dark 块（散落多块=浅色静默恒输风险）；实际=${dump}`).toBe(1);
    expect(darkBlocks[0].selector, `[B1-4] 深块选择器须为 :root,.dark；实际=${dump}`).toBe(':root, .dark');
    expect(lightBlocks.length, `[B1-4] 域 token 浅值必须集中在唯一 .light 块；实际=${dump}`).toBe(1);
    expect(lightBlocks[0].idx, `[B1-4] .light 域块必须源序在深块之后；实际=${dump}`).toBeGreaterThan(darkBlocks[0].idx);
  });
});
```

- [ ] **Step 3: 跑红**

```bash
cd /d/flowweb/apps/web && npx playwright test e2e/b0-token-blocks.spec.ts e2e/b1-token-migration.spec.ts
```

Expected: B0-6 浅值组红（现状 :root 单值深，.light 不翻转）+ 死键断言红；B1-4 红（现状域 token 在裸 :root 块，无 .light 块）。

---

## Task 12（D1a）: index.css 域 token 双值化 + ve 拆分 + 手写 CSS 块（绿）

铁律：**只搬定义不改消费点语义；深色档 computed 零变更**（differ 判计算值非字节——ve 媒体侧 4 处换恒值 token 与手写 CSS var 换引均=同计算值代换，非语义变更；第五轮 A3 措辞对齐）。

**Files:**
- Modify: `apps/web/src/index.css:15-54,74-113,123-235`
- Modify: `apps/web/src/pages/canvas/video-editor/components/AssetPanel.tsx:111,144,184`
- Modify: `apps/web/src/pages/canvas/video-editor/components/PreviewPlayer.tsx:64`
- Modify: `apps/web/e2e/audit/b2-migration-registry.json`（死键删除登记列）
- Modify: `apps/web/e2e/audit/canvas-migration-registry.json`（adjudications 填充）

- [ ] **Step 1: 死键零消费确认（含 var 链引用侧）**

```bash
cd /d/flowweb/apps/web && grep -rn "canvas-controls-active\|ve-text-control" src/ --include="*.tsx" --include="*.ts" --include="*.css" | grep -v "index.css" ; grep -n "var(--canvas-controls-text)\|var(--canvas-controls-bg)\|var(--canvas-controls-border)" src/index.css
```

Expected: 第一组 0 命中（TSX/TS 直连消费为零）；第二组命中即 index.css:99/:100/:103 三条 var 链（`--ve-text-control: var(--canvas-controls-text)` 等）——**判据必须看引用侧**：`--ve-text-control` 直连 0 命中≠可删，若 :103 链仍在则删 `--canvas-controls-text` 定义会碎链。本 Step 在同 commit 内随 Step 2 重构一并处置（链随块删除），此处仅确认无 TSX 侧直连。有 TSX 命中则该键非死——停手按 registry 裁定列登记后再处置。

- [ ] **Step 2: index.css 重构（①-④ 同一次编辑原子完成——中间态会让 var 链断裂落 transparent）**

**删除按点名清单而非行号区间**：裸 `:root` 块（:75-94/:97-106/:109-113）中被搬运的全部双值键 + **死键 `--ve-text-control`（:103）显式点名删除**（第六轮订正：`--canvas-controls-active`（:90）不再删——复活为激活态双值键，随 ②③ 块搬运）+ 三条 var 链行（:99 `--ve-panel: var(--canvas-controls-bg)`、:100 `--ve-border: var(--canvas-controls-border)`、:103）——深块直写字面值后链不复存在。编辑完成后**全文不得再有任何裸 `:root` 双值域 token**（只剩 Step ④ 的单值恒值块；因双值键只存在于 `:root,.dark` 与 `.light` 一对块中，裸 :root 源序无关紧要，"只允许一对主题块"从纪律升级为结构不可能——b1-4 断言守卫）。

① 删除现 `:root` 域 token 块（:74-94 的 handle/edge/controls/shadow/z-panel 与 :96-106 的 ve 块、:108-113 的 vw 卡块——保留 :118-121 几何 px 块）。② 在 `:root,.dark` 块（:15-34）尾部 `--fw-overlay-3` 之后追加：

```css
  /* ===== C8 画布域 token（D1a 双值化，spec 2026-09-20 §8.1；深值=现状冻结字节等值） ===== */
  --canvas-board-bg: #000000;
  --canvas-board-dot: #555555;
  --canvas-controls-bg: rgb(38, 38, 38);
  --canvas-controls-border: rgb(54, 54, 54);
  --canvas-controls-text: rgb(247, 247, 247);
  --canvas-controls-hover: rgba(255, 255, 255, 0.08);
  --canvas-controls-active: rgba(255, 255, 255, 0.12);
  --canvas-controls-icon: rgb(160, 160, 160);
  --canvas-handle-bg: #9CA3AF;
  --canvas-handle-icon: #6B7280;
  --canvas-handle-hover-bg: #FFFFFF;
  --canvas-handle-hover-icon: #FFFFFF;
  --edge-flow-color: #3B82F6;
  --edge-highlight-color: #999;
  --canvas-shadow-menu: 0px 8px 32px 0px rgba(0, 0, 0, 0.15), 0px 2px 8px 0px rgba(0, 0, 0, 0.1);
  --canvas-shadow-dropdown: 0px 4px 10px 0px rgba(0, 0, 0, 0.25), 0px 2px 4px 0px rgba(0, 0, 0, 0.3);
  --ve-bg: #141414;
  --ve-panel: rgb(38, 38, 38);
  --ve-border: rgb(54, 54, 54);
  --ve-text: #e2e8f0;
  --ve-text-dim: rgba(226, 232, 240, 0.6);
  --ve-accent: #6C5CE7;
  --vw-card-bg: #1e1e1e;
  --vw-card-border: rgba(255, 255, 255, 0.1);
  --vw-card-border-hover: rgba(255, 255, 255, 0.25);
```

③ 在 `.light` 块（:36-54）尾部 `--fw-overlay-3` 之后追加（**置于全文件唯一深块对内，禁另起块**）：

```css
  --canvas-board-bg: #F5F5F5;
  --canvas-board-dot: #C8C8C8;
  --canvas-controls-bg: #f0f1f2;
  --canvas-controls-border: #e5e7eb;
  --canvas-controls-text: #111827;
  --canvas-controls-hover: rgba(0, 0, 0, 0.06);
  --canvas-controls-active: rgba(0, 0, 0, 0.08);
  --canvas-controls-icon: #6B7280;
  --canvas-handle-bg: #6B7280;
  --canvas-handle-icon: #4B5563;
  --canvas-handle-hover-bg: #111827;
  --canvas-handle-hover-icon: #111827;
  --edge-flow-color: #3B82F6;
  --edge-highlight-color: #6B7280;
  --canvas-shadow-menu: 0px 8px 32px 0px rgba(0, 0, 0, 0.08), 0px 2px 8px 0px rgba(0, 0, 0, 0.06);
  --canvas-shadow-dropdown: 0px 4px 10px 0px rgba(0, 0, 0, 0.12), 0px 2px 4px 0px rgba(0, 0, 0, 0.1);
  --ve-bg: #f7f8fa;
  --ve-panel: #f0f1f2;
  --ve-border: #e5e7eb;
  --ve-text: #1f2329;
  --ve-text-dim: #4b5563;
  --ve-accent: #6C5CE7;
  --vw-card-bg: #ffffff;
  --vw-card-border: rgba(0, 0, 0, 0.06);
  --vw-card-border-hover: rgba(0, 0, 0, 0.12);
```

（**手柄 icon 两行浅值第五轮订正，走 spec v1.5.2 变更登记**：spec §8.1 表原浅值 #FFFFFF 的前提是"icon 落 #6B7280 手柄底上"——实测 NodeHandle.tsx:24 circle `fill="transparent"`，icon（加号 path :28）实落**卡面**：浅档白卡上白加号 1.0:1 完全不可见、hover 态同理 → icon #4B5563（@白卡 7.56）/hover-icon #111827；对比度配对已入 Task 2 contrast-pairs.json。深档两值不动零 diff。）

④ 原 `:root` 位置保留单值恒值块（几何+内容承载+死键已删）：

```css
/* 单值恒值键（C8）：几何 px / z-index / 内容承载面深值（P6）——不随主题 */
:root {
  --z-panel: 400;
  --vw-close-reserve: 108px;
  --vw-carousel-reserve: 125px;
  --ve-track-video: #1f1f1f;   /* clip 块面=内容承载恒深（spec §8.2） */
  --ve-thumb-base: #363636;    /* 缩略图占位框/图标底垫底=内容承载恒深（原 --ve-border 深值字节等值） */
  --ve-preview-base: #141414;  /* 预览区媒体垫底=内容承载恒深（原 --ve-bg 深值字节等值） */
}
```

（--vw-close-reserve/--vw-carousel-reserve 注释块 :115-117 原样并入。）

⑤ 注释订正：文件头 `:6-7`「深色值 = 现状实测收编（body #141414 / --vw-card-bg #1e1e1e / --ve-text #e2e8f0 / 控件文本 rgb(247,247,247)）」与 `:19/:22/:23` 的"现值来源"注释——D1b 并域后这些键定义即删，注释同步改为「C8：域 token 详见各块内注释与 canvas-migration-registry.json adjudications」防后人按注释找已删键。

- [ ] **Step 3: ve 媒体侧 4 处换恒值 token（深档字节等值，非视觉变更）**

- `AssetPanel.tsx:111`、`:144`、`:184`：`bg-[var(--ve-border)]` → `bg-[var(--ve-thumb-base)]`（三处缩略占位框，P6 内容承载）。
- `PreviewPlayer.tsx:64`：`bg-[var(--ve-bg)]` → `bg-[var(--ve-preview-base)]`（预览垫底，P6）。

其余 ve 消费点（chrome 侧）**一律不动**——D1b 并域统一处理。

- [ ] **Step 4: 手写 CSS 块双值化（深值字节不动，追加 .light 覆盖）**

① `body`（:123-128）两条声明换等值 var：

```css
body {
  margin: 0;
  background: var(--fw-bg);   /* C8 D1a：#141414 = --fw-bg 深值字节等值；浅侧由本段两族全局 pair 吸收（见下） */
  color: var(--fw-text);      /* #e2e8f0 同上 */
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}
```

**⚠ 第七轮 P0-1（body 是岛外唯一消费者——浅侧必出两族 diff，本 commit 预登记）**：body 在采集器元素集内（a0:107-108 `const walk = document.body`，rect 1280×800 不被可见性过滤剔除），且 AppLayout.tsx:20 只有 `bg-bg` 无颜色类 → 未显式设色的整棵子树 color 全部继承 body。深档字节等值零 diff ✓；**浅档** body 取 --fw-bg/--fw-text 浅值（#f7f8fa/#1f2329）→ 浅侧必现两族 diff：`backgroundColor|rgb(20, 20, 20)|rgb(247, 248, 250)`（body 本体，8 页各 1 条）与 `color|rgb(226, 232, 240)|rgb(31, 35, 41)`（body + 全体继承元素——**全局继承族，量级可能每页几十条，全部收敛到同一配对键单键吸收**）。**本 commit 预写两条全局 pairs（不带 page——继承族天然跨页，page 字段无效，见总纲 §1 两类残余）**：

```json
  { "prop": "backgroundColor", "before": "rgb(20, 20, 20)", "after": "rgb(247, 248, 250)",
    "why": "D1a body background #141414 → var(--fw-bg) 浅值；body 不在任何 .dark 岛内 → 浅侧必变（8 页全有；全局继承族永久全局配对）" },
  { "prop": "color", "before": "rgb(226, 232, 240)", "after": "rgb(31, 35, 41)",
    "why": "D1a body color #e2e8f0 → var(--fw-text) 浅值；继承色波及全页无显式 color 的元素（单键吸收全部，量级随继承链放大属合法）" }
```

② `.tiptap-content` 族（:130-200）与 `.editor-scroll`（:218-235）、`PromptInput.css` 28 处、`NodeHandle.css` 1 处——**第六轮 N3 等值门重写（第五轮"能引即引"判据作废：按字面执行会把 #bbb 换成 var(--fw-text) 引入深档 #bbb→#e2e8f0 可见变更，违反 D1a 铁律）**：
- **可换引白名单（判据=深档字面值与目标 token 深值 computed 等值 + 浅档按语义取值——第七轮 P1-2 补后半句：等值只在深档成立，浅档是否等值取决于该 token 浅值语义（若该消费面在采集页渲染则需登记浅侧 pair，不在则预期无 diff）；勿以为"浅档自动等值"）**：body 两条（`#141414`≡`--fw-bg` 深、`#e2e8f0`≡`--fw-text` 深；浅侧两族 pair 已在上文预登记）与 `PromptInput.css:184`（`#ef4444`≡`--fw-accent-danger` 深值等值；**浅值 #dc2626 与 #ef4444 不等=浅档是值变化（该键存在的意义）——实测采集页不渲染 PromptInput（VideoGenNode:792 需 selected，采集器不选中）→ 预期无 diff，adjudications 记一句**）。
- **不可换引（实测无等值键，走覆盖块路径）**：`.tiptap-content` 族深值 `#bbb(:132)/#fff(:141)/#eee(:148)/#ddd(:155)/#ccc(:192)/#666(:195)/hr rgba(255,255,255,0.08)(:183)` 与 `.editor-scroll` 的 `rgba(255,255,255,0.12)(:221/:230)`——与 --fw-* 深值**无一等值**（--fw-text 深=#e2e8f0、text-strong=rgb(247,247,247)、dim-3=rgba(255,255,255,0.6)、dim-1=rgba(255,255,255,0.3)、border=#333、overlay-2/3=0.1/0.2）。**深值规则原样保留 + 文件尾追加 `.light` 作用域覆盖块**（特异性 (0,1,1) > (0,1,0) 源序无关），每条覆盖块在 adjudications 登记"无等值键（深值 X vs 最近键 Y）"。
- `NodeHandle.css` 的 `--canvas-handle-*` 消费处直接用 Task 12 ② 的双值 token，无需覆盖。
index.css 尾部追加（不可换引项的覆盖块形态）：

```css
/* ===== C8 D1a 手写 CSS 浅色覆盖（深值字节不动；浅值取 --fw-* 浅值体系） ===== */
.light .tiptap-content { color: var(--fw-text); }
.light .tiptap-content h1 { color: var(--fw-text-strong); }
.light .tiptap-content h2, .light .tiptap-content strong { color: var(--fw-text); }
.light .tiptap-content h3, .light .tiptap-content em { color: var(--fw-text-dim-3); }
.light .tiptap-content p, .light .tiptap-content ul, .light .tiptap-content ol { color: var(--fw-text); }
.light .tiptap-content hr { border-top: 1px solid var(--fw-border); }
.light .tiptap-content p.is-editor-empty:first-child::before { color: var(--fw-text-dim-1); }
.light .editor-scroll { scrollbar-color: rgba(0, 0, 0, 0.25) transparent; }
.light .editor-scroll::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.25); border-radius: 2px; }
.light .editor-scroll::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.4); }
```

`PromptInput.css` 28 处逐条按等值门裁定（除 :184 外预期全数走覆盖块——面色/边/文字/hover 蒙层的深值与 --fw-* 深值不等值，覆盖值取浅档对应语义：面色 #f0f1f2 系、边 #e5e7eb 系、文字深灰阶梯、hover 蒙层 rgba(0,0,0,0.06)）；每条改动（等值换引与覆盖块 alike）在 `canvas-migration-registry.json` adjudications 登记一行（file:line、深值、浅值、裁定依据 P6/通道/无等值键）。

- [ ] **Step 5: b2 registry 死键删除登记 + B0 json 三族重裁定标注**

`b2-migration-registry.json` meta 旁新增：

```json
 "c8DeadTokenRemovals": [
  { "key": "--ve-text-control", "removedAt": "D1a", "why": "0 消费死 token；index.css:103 var 间接链随 D1a 块删除同 commit 消失（与 Task 12 Step 2 口径一致，非 D1b）" }
 ],
 "c8TokenRevivals": [
  { "key": "--canvas-controls-active", "revivedAt": "D1a", "why": "第六轮 P1-1：原'0 消费死键'判定撤销——CanvasToolbar 因内联 style 不消费 var() 而死，激活态语义没死；复活为双值键（深 rgba(255,255,255,0.12)/浅 rgba(0,0,0,0.08)），Task 22 BTN_BG_ACTIVE 消费——防'常态/激活同键同色不可辨'静默回归（pairs 会把 58→38 吸收成预期）" }
 ],
```

`domain-token-adjudication-B0.json`：`--canvas-handle-*/--edge-flow-*/--edge-highlight-*/--canvas-shadow-*` 族 neverMerge 条目改标 `re-adjudicated-C8-D1a`（前提"画板恒深域"消失，已双值化；**第五轮注：B0 产物内实际模式串是 `--edge-flow-color`/`--edge-highlight-color`（无裸 `--edge-*`）——grep 用后者，spec E 表宽写法与产物不一致**）；`--z-panel` 维持永不并入（z-index 非颜色）；过期快照行（AddNodeMenu 15 处/HistorySidebar 2 处）订正为现状（AddNodeMenu.tsx:305 仅剩 --canvas-shadow-menu）。

- [ ] **Step 6: 跑绿（b0/b1/探针/c0 + vitest）**

```bash
cd /d/flowweb/apps/web && npx playwright test e2e/b0-token-blocks.spec.ts e2e/b1-token-migration.spec.ts e2e/d-segment-probes.spec.ts e2e/c0-theme.spec.ts && npx vitest run
```

Expected: 全绿。d-segment-probes 各探针复核仍为 D0-0 钉值（含「CanvasTopBar 已连接前景」rgb(21,128,61)——--fw-accent-text 浅值 B0 既有，D1a 无翻转，本段复核即可勿"制造"变化）。

---

## Task 13（D1a）: 段验收（深档 0 diff）+ commit

- [ ] **Step 1: segcheck-D1a 深浅双跑**

```bash
cd /d/flowweb/apps/web && COLLECT_BASELINE=1 BASELINE_DIR=segcheck-D1a npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D --after segcheck-D1a --out e2e/audit/baseline-diff-segcheck-D1a; echo "deep=$?" && COLLECT_BASELINE=1 REAL_LIGHT=1 BASELINE_DIR=segcheck-D1a-light npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D-light --after segcheck-D1a-light --out e2e/audit/baseline-diff-segcheck-D1a-light; echo "light=$?"
```

Expected: **深侧 `exit=0`、unexpectedTotal=0；浅侧 `exit=0` 且预期配对集**恰为 Task 12 预登记的 body 两条全局 pairs（第七轮 P0-1 订正——第六轮"浅侧也应是 0"在数学上不成立：body 换引是岛外唯一消费者，浅侧必现两族 diff；**原"理论上应为空集"作废，勿据此把 body 的 var 换引回退——那会让站点底色永不跟随主题，直接废掉 C8 目标之一**）。深侧依据：body var 等值、tiptap 深规则未动/等值换引、域 token 深值冻结、ve 4 处恒值等值。**浅侧其余部分=岛机制推演应为 0**：域 token 的浅值消费者此刻全部仍在 .dark 岛内——画板 wrapper colorMode="dark" 挂 .dark → `:root,.dark` 块的 `.dark` 选择器命中 wrapper → 域 token 在 wrapper 上重声明深值（a0:221 探针同款机制），19 处 `--canvas-controls-*` 消费者全在子树内 → 仍深值；`--vw-card-*` 在 /videos 路由 div.dark 岛内（Task 20 才拆）；`--ve-*` 在 ve 壳 .dark 岛内（Task 21 才拆）；Task 12 的 .light 覆盖块消费面（tiptap/prompt-input）在两个采集页不渲染（gate 画布只有 videoGen 节点）。**验收判据**：`dAbsorbed` 中 body 两键均有命中（backgroundColor 8 条=每页 body 1 条；color 量级=8+继承元素数——**大于 8×2 属继承链合法放大，adjudications 记一句实际计数即可**；若出现自设字面色元素的新键=查）；**除 body 两族外的任何浅侧 diff = 信号非中间态**：逐条归因——"路由岛/壳岛漏拆、域 token 泄漏到岛外"这类真实回归恰恰会以浅侧 diff 形式出现，**禁止预先豁免**（spec §13.3-3 的"3 个消费点取浅值落黑板"旧句与此机制矛盾，v1.5.3 订正）。清理 segcheck 产物（.json/.md 一起删，两侧共四件）。

- [ ] **Step 2: 全门禁 + commit**

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs
cd /d/flowweb && git add apps/web/src/index.css apps/web/src/pages/canvas/video-editor/components/AssetPanel.tsx apps/web/src/pages/canvas/video-editor/components/PreviewPlayer.tsx apps/web/e2e/b0-token-blocks.spec.ts apps/web/e2e/b1-token-migration.spec.ts apps/web/e2e/d-segment-probes.spec.ts apps/web/e2e/audit/b2-migration-registry.json apps/web/e2e/audit/canvas-migration-registry.json && git commit -m "feat(web): C8 D1a 定义层双值化——域 token 入 :root,.dark/.light 唯一块对(board-bg/dot 新增+controls/handle/edge/shadow/ve/vw 双值+controls-icon 工具条图标键第七轮新键——spec 变更登记 v1.5.x：深 rgb(160,160,160)/浅 #6b7280@#f0f1f2=4.27,与 MiniMap nodeColor 浅值同源,不在 §8.1 原表内+死键 ve-text-control 删+controls-active 复活为激活态双值键第六轮)+ve 媒体侧拆恒值键(thumb-base #363636/preview-base #141414 字节等值 4 处)+手写 CSS 块等值门换引(body/PromptInput:184)与 .light 覆盖(tiptap/editor-scroll/NodeHandle 无等值键项)+body 浅侧两族全局 pair 预登记(全局继承族,body 是岛外唯一消费者)+b0 B0-6 域 token 值断言/b1 B1-4 块唯一性源序；段验收：深侧 0 diff/浅侧恰为 body 两配对吸收——域 token 浅值消费者全在 .dark 岛内(其余浅侧 diff=信号禁止预先豁免)"
```

---

## Task 14（D1b-a）: --ve-accent-text 拆档 + 8 处文字钮改指 + ExportModal Progress 实测

spec §9.2①（P9）。**本段起深色档 diff 由 differExpectedPairs 配对吸收，未配对=失败。本段亦是配对闸干跑校准段**（第五轮 P1-4：用首个小配对集实测"跑 diff→拿 key/value→登记→转绿"的迭代宽度，校准 D3 大批量段的配对节奏——全局 prop|before|after 配对会跨页吸收同色变体，干跑时记下实际吸收面防 D3 误判）。

**路径注记（第五轮）**：本任务与 Task 15/21/22 涉及的 TrackRow/TimelinePanel/TimelineRuler/PlayheadLine/ClipBlock 均在 `src/pages/canvas/video-editor/components/timeline/` 子目录（非 components/ 直挂）。

**Files:**
- Modify: `apps/web/src/index.css`（两块各加一行）
- Modify: ve 域 8 处文字钮
- Modify: `apps/web/e2e/audit/canvas-migration-registry.json`（differExpectedPairs）
- Modify: `apps/web/e2e/b0-token-blocks.spec.ts`（DOMAIN 表增行）

- [ ] **Step 1: 定义新键（index.css）**

`:root,.dark` 块 `--ve-accent` 行后加 `--ve-accent-text: #9B8CF7;`；`.light` 块对应位置加 `--ve-accent-text: #5F4FD1;`。

- [ ] **Step 2: b0 DOMAIN 表增行（同 commit）**

`DOMAIN_TOKENS` 数组加 `'--ve-accent-text'`；`DOMAIN_DARK` 加 `'--ve-accent-text': '#9b8cf7'`；`DOMAIN_LIGHT` 加 `'--ve-accent-text': '#5f4fd1'`。

- [ ] **Step 3: 8 处文字钮改指（12px 前景 → 文字档）**

`text-[var(--ve-accent)]` → `text-[var(--ve-accent-text)]`，恰好 8 处：
`AssetPanel.tsx:59`（上传）、`PreviewPlayer.tsx:101`（添加字幕）/`:106`（生成音频）/`:111`（片段重拍）、`PropertiesPanel.tsx:23`（⏱ tab）、`TrackRow.tsx:38`（➕）、`TimelinePanel.tsx:297`（+ 视频轨）/`:299`（+ 音频轨）。

**其余 7 处不改指**（改完 grep 复核）：`ExportModal.tsx:245`（填充钮 bg）、`VideoEditorShell.tsx:153/:155/:160`（分隔柄 hover）、`PlayheadLine.tsx:9`、`TimelineRuler.tsx:60`、`TimelinePanel.tsx:322`（播放头/吸附线）——一律维持 `--ve-accent` 图形档。

```bash
cd /d/flowweb/apps/web && grep -rn "var(--ve-accent-text)" src/pages/canvas/video-editor/ | wc -l
```

Expected: 8（改指后计数）。

- [ ] **Step 4: ExportModal:236 Progress strokeColor 实测后落地**

实测判据 = **圆环实际渲染色**（非属性文本——antd Progress 用 SVG `stroke` 属性，取到 `var(--ve-accent)` 字面时浏览器可能回退 currentColor/上一有效值而圆环仍显色，只看属性文本会误判"生效"）：临时改 `ExportModal.tsx:236` 为 `strokeColor="var(--ve-accent)"`，构建后开导出弹层，`page.evaluate(() => getComputedStyle(document.querySelector('.ant-progress-circle path')).stroke)`——**computed stroke 等于 `rgb(108, 92, 231)`（#6C5CE7 代换成功）则 var() 生效保留**；否则（currentColor/黑/无色）**维持字面 `#6C5CE7`**（图形档双档同值，无需 JS 分支）。结论无论哪路：`c3-js-channel-census.json` 补登一行（file: ExportModal.tsx、channel: SVG 呈现属性 strokeColor、值: 双档同值 #6C5CE7 或 var()、裁定依据 §11.4）。

- [ ] **Step 5: differExpectedPairs 登记（本变更唯一 diff 源）**

`canvas-migration-registry.json` `differExpectedPairs.pairs` 追加：

```json
  { "prop": "color", "before": "rgb(108, 92, 231)", "after": "rgb(155, 140, 247)", "why": "P9 文字档 8 处深档提亮 #6C5CE7→#9B8CF7（@#262626 3.11→5.40），spec §9.2①" }
```

- [ ] **Step 6: 跑门禁 + commit**

```bash
cd /d/flowweb/apps/web && npx playwright test e2e/b0-token-blocks.spec.ts e2e/d-segment-probes.spec.ts && npx vitest run && node scripts/lint-gate.mjs
cd /d/flowweb && git add apps/web/src/index.css apps/web/e2e/b0-token-blocks.spec.ts apps/web/e2e/audit/canvas-migration-registry.json apps/web/e2e/audit/c3-js-channel-census.json apps/web/src/pages/canvas/video-editor/components/ && git commit -m "feat(web): C8 D1b① P9 拆档——--ve-accent-text 深浅双值(#9B8CF7/#5F4FD1)+8 处 12px 文字钮改指文字档+ExportModal strokeColor 实测裁定(图形档入 c3 census)+differExpectedPairs 登记深档提亮配对；其余 7 处维持 --ve-accent 图形档不改指"
```

---

## Task 15（D1b-b）: 不等值键收敛 + 等值键并域 ≈50 处 + AssetPanel hover + 死键清理

spec §9.1/§9.2②③⑤。三类改动同属 §9.2 预登记总清单（配对完备），允许同一 commit。

**Files:**
- Modify: `apps/web/src/index.css`
- Modify: ve 域 chrome 消费点 + `VideoCard.tsx`（--vw-* 并域）
- Modify: `apps/web/e2e/b0-token-blocks.spec.ts`（DOMAIN 表：改值/删行）
- Modify: `apps/web/e2e/a0-collect-baseline.spec.ts`（:250 探针改读 --fw-bg）
- Modify: `apps/web/e2e/audit/canvas-migration-registry.json`（pairs + adjudications）

- [ ] **Step 1: 值收敛（深档有意变更，逐条配对）**

index.css 深块改值：`--ve-border` 与 `--canvas-controls-border` 的 `rgb(54, 54, 54)` → `#333`；`--canvas-controls-hover` 的 `rgba(255, 255, 255, 0.08)` → `rgba(255, 255, 255, 0.1)`。b0 `DOMAIN_DARK` 同步改两行。pairs 追加：

```json
  { "prop": "borderColor", "before": "rgb(54, 54, 54)", "after": "rgb(51, 51, 51)", "why": "§9.2② Δ3 级收敛 #363636→#333（--ve-border/--canvas-controls-border 约 30 处）" }
```

（hover .08→.10 只改静态值——differ 快照不含 hover 态、无采集 diff，登记进 adjudications 说明即可；**单次登记规则**：AssetPanel ③ 的改指不重复登记此 diff。② 收敛清单另含 Task 8 登记的 TopActionBar `BTN` `bg-[rgba(255,255,255,0.04)]`→`bg-overlay-1`（0.04→0.05，深档微变随本段配对吸收——同栏视觉一致补收；**第七轮 P1-2 补浅侧 pair（实施期订正：TopActionBar 经 AppLayout 公开组渲染在 works+videos 两页且均岛外——"渲染在 /works"系漏 videos 的过期表述；pair 深/浅两条均不带 page（跨两页无法收窄），why 写明跨页证据**）：浅档 `rgba(255,255,255,0.04)`→`rgba(0,0,0,0.03)`（overlay-1 浅值）是可见变化——pair 随本段登记，Task 16 段验收浅侧清单含它）与 **`--vw-card-border-hover` 0.25→0.20**（第五轮订正：与 --fw-overlay-3 深值**不等值**（0.25 vs 0.20），原"等值并域"归组错误——hover 态不进快照无 diff，并域改指随本段落、有意变更登记 adjudications）。）

- [ ] **Step 2: 等值键并域（深档零 diff，无需配对）+ 六键删除**

先枚举：

```bash
cd /d/flowweb/apps/web && grep -rn "var(--ve-panel)\|var(--ve-text)\|var(--ve-bg)\|var(--vw-card" src/ --include="*.tsx" --include="*.css" | grep -v "\.test\." | grep -v "\.spec\." | grep -v "__tests__"
```

机械替换（深值全等，浅档首次一致）：
- `var(--ve-panel)` → `var(--fw-surface-dim)`（14 处：AssetPanel:55、EditorTopBar:21、PropertiesPanel:74/:81/:138、PreviewPlayer:79、ClipBlock:88、TimelineRuler:47、TrackRow:33/:53、TimelinePanel:280/:285/:292/:307）
- `var(--ve-text)` → `var(--fw-text)`（全部命中——**实测 .tsx 消费 34 处，与 spec §9.2⑤ 记数一致**：PropertiesPanel 16/PreviewPlayer 7/ExportModal 4/AssetPanel 3/EditorTopBar 3/TrackRow 1；index.css 只有定义无消费——勿再按 30 核销）
- `var(--ve-bg)` → `var(--fw-bg)`（1 处：VideoEditorShell:134——**若 grep 得 2 处说明 D1a Step 3 漏执行（PreviewPlayer:64 应已换 --ve-preview-base），停手回查**；spec 记 2 处系 D1a 前口径，以实测为准）
- `var(--vw-card-bg)` → `var(--fw-surface)`、`var(--vw-card-border)` → `var(--fw-overlay-2)`、`var(--vw-card-border-hover)` → `var(--fw-overlay-3)`（VideoCard.tsx 内，以 grep 实测为准）

随后 index.css 两块删六行：`--ve-bg/--ve-panel/--ve-text/--vw-card-bg/--vw-card-border/--vw-card-border-hover`。**`--ve-text-dim` 与 `--ve-border` 保留勿删**：前者 19-22 处消费（浅值 D1a 已落 `#4b5563`，spec §9.1 裁定"独立键"——勿顺手并入 dim-3，其深值 rgba(226,232,240,.6) 与 dim-3 的 rgba(255,255,255,.6) computed 字面不同、并域即深档未登记 diff）；后者按 ② 仅收敛值（收敛后与 --fw-border 双档同值，是否归并删键留作实施裁定登记——本计划按 spec §9.2② 字面保留键）。b0 DOMAIN 三处同步删对应 6 行。

**配套修订（实施裁定，登记 adjudications）**：`a0-collect-baseline.spec.ts:250` ve 壳探针改读 `--fw-bg`，**D1b 窗口内期望保持深值**（ve 壳根 .dark 岛到 Task 21 才拆——壳内 --fw-bg 仍 #141414、壳根底 rgb(20,20,20)；探针 id 同步去 "--ve-bg自持" 改 "--fw-bg@壳岛"），Task 21 岛拆除时才翻浅为双断言。（本改动属探针面，不触发采集器冻结令——冻结面只含 snapshotDom 口径，见 Task 10 Step 4。）

- [ ] **Step 3: AssetPanel hover 改指（§9.2③）**

`AssetPanel.tsx:110/:143/:183` `hover:bg-[var(--canvas-controls-hover)]` → `hover:bg-overlay-2`（ve 域已改跟随，浅色档取浅 hover 是正确行为）。

域纪律复核（§9.1 验收）：

```bash
cd /d/flowweb/apps/web && grep -rn "var(--canvas-" src/pages/canvas/video-editor/ | wc -l
```

Expected: 0（`--canvas-controls-*` 主键只在画布工具条域；ve 域用 --fw-*/--ve-*）。

- [ ] **Step 4: adjudications 填充 + 门禁 + commit**

adjudications 逐条登记（收敛 3 项/并域 6 键 + a0 探针修订/AssetPanel 3 处）。跑 `npx playwright test e2e/b0-token-blocks.spec.ts e2e/b1-token-migration.spec.ts` + `npx vitest run` + `node scripts/lint-gate.mjs`。

```bash
cd /d/flowweb && git add apps/web/src/index.css apps/web/src/pages/canvas/video-editor/components/ apps/web/src/pages/videos/VideoCard.tsx apps/web/e2e/b0-token-blocks.spec.ts apps/web/e2e/a0-collect-baseline.spec.ts apps/web/e2e/audit/canvas-migration-registry.json && git commit -m "feat(web): C8 D1b②③⑤ 并域收口——Δ3 收敛(ve/canvas border #363636→#333 配对登记)+等值键并域(ve-panel→fw-surface-dim/ve-text→fw-text/ve-bg→fw-bg/vw-card 三键，六键删除+b0 表同步+a0 探针改读 fw-bg)+AssetPanel hover 改指 fw-overlay-2(单次登记落②)+ve 域 var(--canvas- 0 命中域纪律实证"
```

---

## Task 16（D1b-c）: WeChatFollowModal 岛拆除 + G8① 反转（原子对）+ 段验收

**Files:**
- Modify: `apps/web/src/components/layout/WeChatFollowModal.tsx`
- Modify: `apps/web/e2e/c0-theme.spec.ts`（G8① :507-533）
- Modify: `apps/web/e2e/d-segment-probes.spec.ts`（D-3 组翻浅）
- Modify: `apps/web/e2e/audit/c5-portal-census.json`（条目退出登记）

- [ ] **Step 1: 拆岛（实现）**

`WeChatFollowModal.tsx` 全量替换：

```tsx
import { Modal } from 'antd';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function WeChatFollowModal({ open, onClose }: Props) {
  return (
    // C8 D1b 拆岛改跟随（spec §9.3/E 表 C5 三项废止）：删 ConfigProvider darkAlgorithm + rootClassName="dark"
    // ——继承 App algorithm 与 html 类；面底 token 化 var(--fw-surface)，文字沿用 text-text/text-dim-2（B2 已迁）；
    // mask rgba(0,0,0,0.6) 中性遮罩（通道 3，禁 token 化）。
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={320}
      styles={{ content: { background: 'var(--fw-surface)', borderRadius: 12, padding: '24px 16px' }, mask: { background: 'rgba(0,0,0,0.6)' } }}
    >
      <div className="flex flex-col items-center">
        <span className="text-base text-text">关注公众号</span>
        <img src="/img/wechat-qrcode.jpg" alt="公众号二维码" className="block w-[200px] h-[200px] rounded-lg mt-4" />
        <span className="text-xs text-text-dim-2 mt-4">扫码关注公众号，获取最新动态和专属福利</span>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: G8① 断言反转（同 commit）**

`c0-theme.spec.ts` G8① 用例（:507-533）替换为：

```ts
test('G8 ①WeChatFollowModal 跟随域（C8 D1b 拆岛反转）：html.light 下无岛类 + 面底/--fw-text 浅值 + antd 通道浅（defaultAlgorithm）', async ({ browser }) => {
  const ctx = await newSeededContext(browser, 'light');
  const page = await ctx.newPage();
  try {
    await openWorks(page);
    expectHtmlTheme(await readHtmlTheme(page), 'light', '[G8①/宿主浅]');
    await page.getByTestId('wechat-follow-entry').click();
    const content = page.locator('.ant-modal-content').first();
    await expect(content, '[G8①] WeChatFollowModal 内容应渲染').toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.ant-modal-root.dark'), '[G8①] 岛类 rootClassName="dark" 应已拆除（C8 D1b）').toHaveCount(0);
    const state = await content.evaluate((el) => ({
      fwText: getComputedStyle(el).getPropertyValue('--fw-text'),
      contentBg: getComputedStyle(el).backgroundColor,
      antdChannelColor: getComputedStyle(el.querySelector('.ant-modal-close') ?? el).color,
    }));
    expect(norm(state.fwText), '[G8①] 跟随域 --fw-text 浅值 #1f2329（继承 html.light）').toBe('#1f2329');
    // 第七轮 P1-3：contentBg 是 computed backgroundColor（rgb 形态），不是自定义属性——断 hex 必红且误导排查方向"岛没拆"
    expect(norm(state.contentBg), '[G8①] 面底 var(--fw-surface) 浅值 rgb(255,255,255)').toBe('rgb(255,255,255)');
    const ch = parseRgbChannels(state.antdChannelColor);
    expect(ch && ch[0] < 180, `[G8①] antd 通道跟随：关闭钮色应为深色系（defaultAlgorithm），实际="${state.antdChannelColor}"`).toBeTruthy();
    expectHtmlTheme(await readHtmlTheme(page), 'light', '[G8①/宿主仍浅]');
  } finally {
    await ctx.close();
  }
});
```

- [ ] **Step 3: 探针翻浅 + census 条目退出（同 commit）**

`d-segment-probes.spec.ts` D-3 组两断言改 `rgb(255, 255, 255)`（面）/ `rgb(31, 35, 41)`（标题前景——--fw-text 浅值 #1f2329），注释更新「D1b 拆岛翻浅」。`c5-portal-census.json` WeChatFollowModal 条目加 `"status": "exited-C8-D1b"`。

- [ ] **Step 4: D1b 段验收（diff 全配对）**

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs && COLLECT_BASELINE=1 BASELINE_DIR=segcheck-D1b npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D --after segcheck-D1b --out e2e/audit/baseline-diff-segcheck-D1b; echo "deep=$?" && COLLECT_BASELINE=1 REAL_LIGHT=1 BASELINE_DIR=segcheck-D1b-light npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D-light --after segcheck-D1b-light --out e2e/audit/baseline-diff-segcheck-D1b-light; echo "light=$?"
```

Expected: 全门禁绿；深侧 `exit=0` 且 dExpectedGate absorbed>0、unexpected=0——全部深档 diff 与 §9.2 总清单配对命中（① rgb(108,92,231)→rgb(155,140,247)；② rgb(54,54,54)→rgb(51,51,51)；⑤ 等值并域零 diff）。**浅侧**：D1a 已登记浅值对（body 两族）的继续吸收 + D1b 浅侧新变（WeChatFollowModal 翻浅/accent-text 浅值 #5F4FD1 落点/并域键浅值一致化/**TopActionBar BTN 0.04→rgba(0,0,0,0.03)（Task 15 已预登记）**）逐条入 pairs 后 exit=0。清理 segcheck 产物（**.json/.md 一起删、深浅共四件**；D2 像素参照由 Task 17 的 Playwright 快照工装自足承担——`--update-snapshots` 在 D2 改码前（即本任务验收后的 HEAD）落参照，快照随 Task 17 commit 固化）：`rm -rf e2e/baseline/segcheck-D1b e2e/baseline/segcheck-D1b-light e2e/audit/baseline-diff-segcheck-D1b.* e2e/audit/baseline-diff-segcheck-D1b-light.*`。

- [ ] **Step 5: commit**

```bash
cd /d/flowweb && git add apps/web/src/components/layout/WeChatFollowModal.tsx apps/web/e2e/c0-theme.spec.ts apps/web/e2e/d-segment-probes.spec.ts apps/web/e2e/audit/c5-portal-census.json && git commit -m "feat(web): C8 D1b④ WeChatFollowModal 原子对拆岛——删 darkAlgorithm+rootClassName dark 改跟随(var(--fw-surface) 面底)+G8① 反转(无岛类/浅值/defaultAlgorithm 判据 ch<180)+探针翻浅+census 条目退出；D1b 段验收：segcheck-D1b diff 全配对 absorbed>0 unexpected=0"
```

---

## Task 17（D2）: CanvasView colorMode 翻转 + 板面三机制 + 镜像断言 + 探针翻转

spec §10.1/10.3/10.4/10.5/10.6。**执行窗口纪律：本任务与 Task 18 连续收口，期间禁止浅色档验收画布（§13.3）。**

**Files:**
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx:341-530`（wrapper :341；ReactFlow JSX :342-530——第五轮行号订正）
- Modify: `apps/web/src/pages/canvas/components/CanvasView.test.tsx:90-100`
- Modify: `apps/web/e2e/a0-collect-baseline.spec.ts`（:220-221 探针改造 + probeFlip helper）
- Modify: `apps/web/e2e/d-segment-probes.spec.ts`（D-1 组翻浅）

- [ ] **Step 1: 建像素 diff 对账工装（e2e/d2-board-pixeldiff.spec.ts，先取 D1b 参照）**

```ts
// C8 D2 画板像素对账（spec §10.2/§10 验收）：深色档以 D1b 后 checkout 为参照 0 diff（toHaveScreenshot
// maxDiffPixels:0 + threshold:0 + animations disabled）；浅色档断 xyflow 皮肤变量取值（翻转正确性，非 0 diff——D2 本身就是翻转）。
// 基线采集：D2 改码前 `npx playwright test e2e/d2-board-pixeldiff.spec.ts --update-snapshots` 落参照。
// 第六轮 B4/P1-3：snapshotPathTemplate 定死直落 e2e/audit/——无 projects 的仓默认快照名实为
// d2-board-dark-win32.png（无 -chromium 段），字面硬编码必踩"文件不存在"；模板直落 audit 后文件名确定、
// 固化/校验/比对三处同一文件，"副本 vs 真身"缝隙从结构上消失（真身入 git，被 --update-snapshots 覆盖时
// sha256sum -c 红、git checkout -- 恢复）。
import path from 'node:path';
import { test, expect } from '@playwright/test';

// ⚠ 第七轮 M2：snapshotPathTemplate 配置在 playwright.config.ts 顶层（本 Step 第一动作，与快照同 commit）——
// 该键只声明在 PlaywrightTestConfig/TestProject（playwright/types/test.d.ts :111/:580/:878/:1203），
// test.use() 不解析它（静默无效，快照仍落默认 e2e/d2-board-pixeldiff.spec.ts-snapshots/d2-board-dark-win32.png，
// 随后 sha256sum -c 报"文件不存在"、git add 亦失败）。顶层已实证支持；本仓此前无任何 toHaveScreenshot，
// 全仓生效无副作用。config 增行：snapshotPathTemplate: '{testDir}/audit/d2-ref-{arg}{ext}'
// （若只想作用于截图可改 expect: { toHaveScreenshot: { pathTemplate: … } }——二选一，取顶层简形）。

const HERE = import.meta.dirname!;
const USER_STATE = path.join(HERE, '.auth', 'user.json');

async function openCanvasDark(page: import('@playwright/test').Page) {
  await page.goto('/canvas?projectId=gate-canvas-1');
  await expect(page.locator('.react-flow__node[data-id="gate-node-1"]')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800); // 沉降（动画/字体收尾，同采集器口径）
}

test('D2 深档像素对账：画板视口截图 vs D1b 参照（0 diff）', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: USER_STATE, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    await openCanvasDark(page);
    // fixture 前置断言（第五轮 P0-4）：残留 videoEdit 节点会让像素对账以"看不懂的 diff"爆红——
    // 三律自比自证救不了脏 fixture，先断言画布恰 2 节点
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    // 截图范围=画板本身（locator 截图），非整页——整页会把 SaveStatusIndicator 时序文本/antd 动画/
    // remote cursor 层算进 0-diff；threshold:0 关掉 Playwright 默认 0.2(YIQ) 容差（否则 maxDiffPixels:0
    // 仍放走低于感知阈的色移——"0 diff"≠逐字节等色，第五轮注）
    await expect(page.locator('.react-flow')).toHaveScreenshot('d2-board-dark.png', {
      maxDiffPixels: 0, threshold: 0, animations: 'disabled', caret: 'hide',
    });
  } finally { await ctx.close(); }
});

test('D2 浅档 xyflow 皮肤变量复测（--xy-* 翻转取值登记）', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: USER_STATE, viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem('theme', 'light'));
  const page = await ctx.newPage();
  try {
    await openCanvasDark(page);
    // ⚠ 网格点必须读 .react-flow__background 自身（自定义属性只向下继承，从 wrapper 读=空），
    // 且 computed 已被 var() 代换 → 断 RGB（代换失败落字面/空，同一断言可抓）——与 d-segment D-1 探针同口径
    const xy = await page.evaluate(() => {
      const wrapper = document.querySelector('.react-flow')!;
      const bg = wrapper.querySelector('.react-flow__background')!;
      return {
        backgroundPattern: getComputedStyle(bg).getPropertyValue('--xy-background-pattern-color-props'),
        wrapperBg: getComputedStyle(wrapper).backgroundColor,
        wrapperClasses: Array.from(wrapper.classList).filter((c) => c === 'light' || c === 'dark'),
      };
    });
    expect(xy.wrapperClasses).toEqual(['light']);
    expect(xy.wrapperBg).toBe('rgb(245, 245, 245)'); // --canvas-board-bg 浅值（bg-[var] utility 层）
    expect(xy.backgroundPattern.replace(/\s+/g, '').toLowerCase()).toBe('#c8c8c8'); // var 代换后的 computed RGB
    test.info().attach('d2-xy-probes', { body: JSON.stringify(xy), contentType: 'application/json' });
  } finally { await ctx.close(); }
});
```

D2 改码**前**（HEAD 停在 D1b 收口后）先落参照并**自比自证**（toHaveScreenshot 在本仓首次使用，须先证工装可信）：

```bash
cd /d/flowweb/apps/web && npx playwright test e2e/d2-board-pixeldiff.spec.ts --update-snapshots && npx playwright test e2e/d2-board-pixeldiff.spec.ts -g "深档"
```

Expected: 深档用例 PASS（同 HEAD 自比 = 0 diff，证快照确定性成立）；**浅档用例此刻红属预期**（wrapper 仍 colorMode 钉深）——参照快照随 D2 commit 提交，浅档用例随 Step 2 转绿。**工装加固三律（第六轮 B4/P1-3 重写、第七轮 M2 改 config 载体——快照经 playwright.config.ts 顶层 snapshotPathTemplate 直落 `e2e/audit/d2-ref-d2-board-dark.png`（单一真身，文件名确定无平台/项目段；{testDir} 是合法 token、{arg}{ext} 中 arg 取 basename 无扩展名——playwright 1.63.0 源码实证）**：① **同 HEAD 连跑 3 次全 0 diff** 才算工装可信（一次通过可能是巧合）；② **真身即固化**：快照文件随 Task 17 commit 入 git + 记 sha256 到 `e2e/audit/d2-ref-board-dark.sha256`（仅存哈希非副本；**生成命令（第七轮 P2-4 补，在仓根执行）**：`cd /d/flowweb && sha256sum apps/web/e2e/audit/d2-ref-d2-board-dark.png > apps/web/e2e/audit/d2-ref-board-dark.sha256`——`-c` 校验同样在仓根跑，否则哈希文件内相对路径解析错位）；**每次对账前 `cd /d/flowweb && sha256sum -c apps/web/e2e/audit/d2-ref-board-dark.sha256`**——被 `--update-snapshots` 覆盖即哈希失配红，恢复 = `git checkout -- apps/web/e2e/audit/d2-ref-d2-board-dark.png`（结构上不存在"校验副本放过真身覆盖"的缝隙）；③ **生成参照只允许 `-g "深档"` 限定**（浅档用例 update 会把浅档像素写进参照名下）。**注**：`--update-snapshots` 落盘的文件名以实测为准（首跑后 `ls e2e/audit/d2-ref-*` 核对 {arg}{ext} 展开形态，与 sha256 记录路径一致即可）。若深档自比 3 次有任一非 0：**判定"像素工装不达标准"——写明噪声源，降级为附件证据（截图归档人工比对），不许调 maxDiffPixels/mask/threshold 凑绿**；深档回归改由 d2-xy-probes computed 值 + --xy-* 复测表承担，登记 adjudications。

- [ ] **Step 2: CanvasView 翻转（实现）**

`CanvasView.tsx`：import 区加 `import { useTheme } from '@/stores/themeStore';`；组件体内（return 前）加 `const { mode } = useTheme();`（唯一例外：节点/面板组件禁 useTheme，CanvasView 是 colorMode 源头，spec §11.1）。改三处：
- `:377` `className="bg-[#000000]"` → `className="bg-[var(--canvas-board-bg)]"`（**留在 Tailwind utility 层（spec §10.1 冻结路线）**——机制实证：CanvasView.tsx:9 顶部 import xyflow style.css 先于 main.tsx 的 index.css，同特异性 (0,1,0) 后序胜（.react-flow 字节 0 < .bg-[#...] 字节 50943）；**删（彻底移除）则 dark 皮肤 `--xy-background-color-default:#141414` 复现**；第五轮 A5 注：移 inline 同样可胜（wrapperStyle 不含 background-color 键、inline 特异性最高）——两条路都成立，维持 utility 是 spec 冻结选择 + a0 探针（backgroundColor 视觉真值）已机械守卫，非"只有 utility 可行"）。
- `:378-379` 注释改写 + `colorMode="dark"` → `colorMode={mode}`。
- `:382` `<Background ... color="#555555" ...>` → `color="var(--canvas-board-dot)"`（xyflow 写内联 `--xy-background-pattern-color-props`，CSS var 代换——Step 4 像素实证）；`bgColor="transparent"` 保留不动。
- `:384-394` MiniMap 本段不动（内联 JS 色 D3 清单双值化；nodeColor 函数 prop 的 var() 不保证生效——spec §10.5）。

- [ ] **Step 3: 镜像断言 + a0 探针 + d-segment 探针翻转（同 commit；a0 改动属探针面不触发冻结令——冻结面只含 snapshotDom 口径，见 Task 10 Step 4）**

① `CanvasView.test.tsx:90-100` 用例替换：

```tsx
  // C8 D2 镜像断言（spec §10.3）：wrapper 主题类恰一个且等于 html 主题类——防常量化（不同类即红）与
  // 防补岛（html.light 下补 .dark 得 ['light','dark'] 长度 2 即红）；与 c0 readHtmlTheme 同口径。
  it('wrapper 主题类镜像 html（colorMode={mode}）', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const wrapper = container.querySelector('.react-flow')!;
    const wrapperThemeClasses = Array.from(wrapper.classList).filter((c) => c === 'light' || c === 'dark');
    const htmlThemeClasses = Array.from(document.documentElement.classList).filter((c) => c === 'light' || c === 'dark');
    expect(wrapperThemeClasses, 'wrapper 主题类恰一个且等于 html 类').toEqual(htmlThemeClasses);
  });
```

② `a0-collect-baseline.spec.ts`：新增 probeFlip helper（islandInvarianceProbes 之外的翻转探针，结果落 `meta.flipProbes`）：

```ts
/** 跟随面翻转探针（C8 D2 起）：html.light 下取浅值（与 probeInvariance 方向相反）；meta 键分流防误判 */
const FLIP_PROBES: Array<{ id: string; expected: string; actual: string; pass: boolean }> = [];
async function probeFlip(page: Page, id: string, read: () => Promise<string>, expectedLight: string) {
  const actual = await read();
  FLIP_PROBES.push({ id, expected: expectedLight, actual, pass: actual === expectedLight });
  expect(actual, `[浅色采集/翻转探针/${id}] html.light 下跟随面必须取浅值`).toBe(expectedLight);
}
```

`:220-221` 两探针替换为（:220 html 根探针保持；:221 改视觉真值）：

```ts
      // 第七轮 P2：html 根 --fw-bg 浅值期望是"翻转"语义——改走 probeFlip（原 probeInvariance 桶名/失败文案
      // 均为"恒深"，翻转断言落进去与桶名相反、误导后人读 meta）
      await probeFlip(page, 'canvas-html根--fw-bg翻浅(注入生效)', () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fw-bg').trim()), '#f7f8fa');
      // C8 D2 改视觉真值 + 反补岛镜像守卫（spec §10.3/§12.2 v1.3 分级①）
      await probeFlip(page, 'canvas-画板wrapper板底翻浅(视觉真值)', () => page.evaluate(() => getComputedStyle(document.querySelector('.react-flow')!).backgroundColor), 'rgb(245, 245, 245)');
      const mirror = await page.evaluate(() => {
        const wrapper = document.querySelector('.react-flow')!;
        const f = (cl: DOMTokenList) => Array.from(cl).filter((c) => c === 'light' || c === 'dark');
        return { wrapper: f(wrapper.classList), html: f(document.documentElement.classList) };
      });
      expect(mirror.wrapper, 'wrapper 主题类恰一个且等于 html 类（反补岛守卫）').toEqual(mirror.html);
```

afterAll meta 对象 `...(REAL_LIGHT ? { islandInvarianceProbes: LIGHT_PROBES, flipProbes: FLIP_PROBES } : {})` **一处**（第八轮订正：原"ANY_LIGHT 两处"是 Task 3 已删的标识符/已合并的分支——照抄即模块加载期 ReferenceError；落盘现由 REAL_LIGHT 分支单独承担，勿为找"第二处"把已删分支加回来）。

③ `d-segment-probes.spec.ts` D-1 组：板底断言改 `rgb(245, 245, 245)`、网格点改 `#c8c8c8`（norm 后）；「gate 节点卡底」探针**不动**（D3-画板才翻）。

- [ ] **Step 4: 像素对账 + 门禁**

参照完整性校验（先于像素对账，**在仓根执行**）：`cd /d/flowweb && sha256sum -c apps/web/e2e/audit/d2-ref-board-dark.sha256`——真身即 audit 文件（第六轮直落方案，无副本缝隙）；失配=被 update 覆盖 → `git checkout -- apps/web/e2e/audit/d2-ref-d2-board-dark.png` 恢复后复校。

```bash
cd /d/flowweb/apps/web && npx playwright test e2e/d2-board-pixeldiff.spec.ts && npx playwright test e2e/c0-theme.spec.ts e2e/d-segment-probes.spec.ts e2e/b0-token-blocks.spec.ts && npx vitest run
```

Expected: 深档像素 0 diff（参照=Step 1 落的 D1b 快照）；浅档 xy 变量复测绿；c0 G4 video-editor 岛用例仍绿（ve 壳岛 D3 才拆）。

- [ ] **Step 5: commit**

```bash
cd /d/flowweb && git add apps/web/src/pages/canvas/components/CanvasView.tsx apps/web/src/pages/canvas/components/CanvasView.test.tsx apps/web/e2e/a0-collect-baseline.spec.ts apps/web/e2e/d-segment-probes.spec.ts apps/web/e2e/d2-board-pixeldiff.spec.ts apps/web/playwright.config.ts apps/web/e2e/audit/d2-ref-d2-board-dark.png apps/web/e2e/audit/d2-ref-board-dark.sha256 && git commit -m "feat(web): C8 D2 colorMode 翻转——CanvasView colorMode={mode}(唯一 useTheme 例外)+板底 bg-[var(--canvas-board-bg)] 留 utility 层+网格点 var(--canvas-board-dot) 代换+镜像断言防常量化/防补岛+a0:221 探针改视觉真值 probeFlip+html 根探针改走 probeFlip(第七轮:翻转语义勿落 invariance 桶)+D 段探针翻浅；深档像素 0 diff 实证(d2-board-pixeldiff maxDiffPixels:0+threshold:0×D1b 参照；snapshotPathTemplate 落 playwright.config.ts 顶层——test.use 不解析该键(第七轮 M2)+直落 audit 单一真身+sha256 固化)+浅档 --xy-* 复测登记"
```

---

## Task 18（D2）: selection 钉值规则级裁定 + 性能探针（render 计数，提前至 D2）+ ProcessSnapshot 不变式登记 + 段验收

**Files:**
- Modify（条件）: `apps/web/src/index.css:207-216`
- Create: `apps/web/src/pages/canvas/components/CanvasView.theme-perf.test.tsx`
- Modify: `apps/web/e2e/d-segment-probes.spec.ts`（D-7 规则级探针）
- Modify: `apps/web/e2e/audit/canvas-migration-registry.json`（adjudications 登记）

- [ ] **Step 1: selection 钉值裁定（第五轮 P0-6 直接定案——撤钉实验取消，xyflow 皮肤默认值已实测）**

**实测证据（@xyflow/react@12.10.2 dist/style.css）**：light 皮肤 `--xy-selection-background-color-default: rgba(0, 89, 220, 0.08)` / `--xy-selection-border-default: 1px dotted rgba(0, 89, 220, 0.8)`（:39-40，第六轮行号订正）——与 index.css:212-216 钉值**逐字节相同**；dark 皮肤（:85-86）是另一组 `rgba(200, 200, 220, 0.08/0.8)`。结论：**钉值在浅档冗余（与 light 皮肤默认重合）、在深档承重**（wrapper colorMode={mode} 后 dark 档若无钉值会被 dark 皮肤改写成浅灰蓝——A2 修复时冻结的正是这个）。裁定 = **保留钉值不动 + 注释补写"浅档=light 皮肤默认值、深档=防 dark 皮肤改写的承重钉值"（:210-211 注释订正）**，D2 后 selection 深浅两档同为蓝色系（与现状一致，非回归）。原"撤钉对照实验"取消——其结论已被上游默认值实证替代；规则级探针**改为断言形态**（不再是只 console.log 的永远绿假守卫）：

```ts
test('D-7 selection 钉值两档断言（深浅均=蓝色系钉值；深档防 dark 皮肤改写承重）', async ({ browser }) => {
  for (const theme of ['dark', 'light'] as const) {
    const ctx = await browser.newContext({ storageState: USER_STATE });
    await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme);
    const page = await ctx.newPage();
    try {
      await openCanvas(page);
      const style = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.className = 'react-flow__nodesselection-rect';
        document.querySelector('.react-flow')!.appendChild(probe);
        const cs = getComputedStyle(probe);
        const out = { background: cs.backgroundColor, borderTopColor: cs.borderTopColor, borderTopStyle: cs.borderTopStyle };
        probe.remove();
        return out;
      });
      // 两档同断蓝色钉值（浅=皮肤默认重合、深=钉值承重——dark 皮肤 rgba(200,200,220,*) 出现即钉值失效红）
      expect(style.background).toBe('rgba(0, 89, 220, 0.08)');
      expect(style.borderTopColor).toBe('rgba(0, 89, 220, 0.8)');
      expect(style.borderTopStyle).toBe('dotted');
      test.info().attach(`d7-selection-${theme}`, { body: JSON.stringify(style), contentType: 'application/json' });
    } finally { await ctx.close(); }
  }
});
```

两档**拖框/选中节点截图目检**证据（像素工装覆盖不了交互态）登记 adjudications（`:208 fill:transparent 多选交由 SelectionBoxOverlay 的既有裁定维持不动`——注意是 `fill: transparent` 非 `fill:none`，引用时勿写错）。

- [ ] **Step 2: 性能探针（render 计数——提前至 D2：colorMode={mode} 引入点即验证点，勿等 D4）**

`CanvasView.theme-perf.test.tsx`（**mock 真实节点组件**——nodeTypes 是 CanvasView 导出常量 `{ textInput: TextInputNode, … }`（CanvasView.tsx:42-43）、测试无法注入 counting 类型，故走组件 mock 路线：**nodes/ 下无 TextNode.tsx，文本节点是 TextInputNode.tsx，nodeTypes 键为 `'textInput'`**；vi.mock 不跨文件——**本文件必须自带一份 `@/stores/canvasStore` mock（照抄 CanvasView.test.tsx:35-70 既有骨架，只写"复用"不抄全则前置自证红，好在红得响）**；双向断言防空转假绿）：

```tsx
// C8 性能实测①render 计数（spec §11.1，D2 落点 + D4 复验）：切换主题一次，节点组件 render 增量预期 0
// ——只有 CanvasView 重渲染（禁 useTheme 的机制验证）。若红：先查 nodes 数组引用稳定性（store 选择器
// 每次返回新数组会让 ReactFlow 重渲全部节点），修法是消费处 memo 化，不是给 colorMode 让步。
import { render, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';

const renders = { nodes: 0 };

vi.mock('./nodes/TextInputNode', () => ({
  TextInputNode: () => { renders.nodes++; return <div data-testid="perf-node" />; },
}));
// …vi.mock('@/stores/canvasStore', …) 照抄 CanvasView.test.tsx 既有骨架，
// mockNodes 铺 ≥2 个 type:'textInput' 节点（走被 mock 的 TextInputNode）……

describe('CanvasView 主题切换性能（render 计数）', () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear(); renders.nodes = 0; });

  it('setMode 切换一次：节点确已渲染（前置自证）且节点 render 增量 = 0', async () => {
    const { setMode } = await import('@/stores/themeStore');
    const { CanvasView } = await import('./CanvasView');
    render(<ReactFlowProvider><CanvasView projectId="p1" /></ReactFlowProvider>);
    expect(renders.nodes, '前置自证：节点确已渲染（mock 空转则此断言红，防"0 重渲"假绿）').toBeGreaterThan(0);
    const before = renders.nodes;
    act(() => setMode('light'));
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(renders.nodes - before, '节点组件不得因主题切换重渲染').toBe(0);
  });
});
```

Expected: PASS。若红（节点增量>0）：CanvasView 消费 nodes 的选择器在主题切换路径重建数组引用——本 commit 内修（memo 化/浅比较，属 D2 引入 {mode} 的配套），**不是放宽断言**。

- [ ] **Step 3: ProcessSnapshot 内容域不变式登记（不动代码）**

registry adjudications 追加：`ProcessSnapshot 整块=内容承载面恒深（spec §10-⑦）:205：:89 colorMode="dark" 保留、:91 网格点 #3a3a3a 保留（勿统一到 --canvas-board-dot——那会引入 #555555≠#3a3a3a 深档 diff）、:34 bg-black/60 中性遮罩留（第六轮行号订正：文件共 95 行无 :96）`。

- [ ] **Step 4: D2 段验收**

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs && COLLECT_BASELINE=1 BASELINE_DIR=segcheck-D2 npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D --after segcheck-D2 --out e2e/audit/baseline-diff-segcheck-D2; echo "deep=$?" && COLLECT_BASELINE=1 REAL_LIGHT=1 BASELINE_DIR=segcheck-D2-light npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D-light --after segcheck-D2-light --out e2e/audit/baseline-diff-segcheck-D2-light; echo "light=$?"
```

Expected: 全绿；深侧 diff=已登记配对吸收 + unexpected=0；浅侧新增板面翻转（wrapper 底 rgb(0,0,0)→rgb(245,245,245)、网格点等）入 pairs 后 exit=0。清理 segcheck 产物（**.json/.md 一起删、深浅共四件**）。**D2 收口后、Task 22 开工前加一次非验收 dev-server 浅色目检（第五轮 A4，5 分钟：只记录不判定、不入档、不加断言、不作为 §13.3 意义上的验收）**——把"板已浅、字面仍深"混排期的大发现挪到大批量迁移之前，目检记录随手记进 registry notes。

- [ ] **Step 5: commit（与 Task 17 连续收口完成，板面批次即 D3-画板紧接开工）**

```bash
cd /d/flowweb && git add apps/web/src/index.css apps/web/src/pages/canvas/components/CanvasView.theme-perf.test.tsx apps/web/e2e/d-segment-probes.spec.ts apps/web/e2e/audit/canvas-migration-registry.json && git commit -m "feat(web): C8 D2 收口——selection 钉值直接定案(xyflow 皮肤默认值实测:浅档重合/深档承重防 dark 皮肤改写,保留+两档断言+注释订正,撤钉实验取消)+render 计数性能探针提前落 D2(mock 真实 TextInputNode+双向断言)+ProcessSnapshot 内容域不变式登记+D2 段验收深浅双跑 diff 全配对；D2↔D3 板面批次连续收口纪律生效"
```

---

## Task 19（D3 前置）: CreditsDropdown 浅色稿 + no-theme-utility 扩规则 + 白名单粒度升级

**Files:**
- Create: `docs/superpowers/specs/2026-09-20-creditsdropdown-light-draft.md`（浅色稿）
- Modify: `apps/web/scripts/eslint-rules/no-theme-utility.js`
- Modify: `apps/web/e2e/audit/canvas-migration-registry.json`（whitelistKeeps 镜像）

- [ ] **Step 1: 产出 CreditsDropdown 浅色稿（ui-ux-pro-max，P5）**

调用 ui-ux-pro-max skill，输入现状精确描述（spec P5；第六轮 P1-2 扩面——style 对象 rgba 蒙层是盲区四分区漏网面，浅色稿必须一并覆盖；**第七轮 P1-3 再扩面——命名色工具类是第五盲区**（zinc/amber/rose 族五条通道皆不可见：no-color-hex 只认 #hex、no-theme-utility 只认 white|black、四分区只认 style 对象/SVG 属性/`<style>` 块/rgba 任意值类），浅色稿输入必须逐类枚举）：基底=inline 深色渐变（CreditsDropdown.tsx:127 `linear-gradient(160deg, #111111, #171717, #101828)`）+ :271 `bg-zinc-900` 图标底；**白系辉光/内阴影三处**：:268 充值钮 `boxShadow: '0 18px 44px -12px rgba(255,255,255,0.22)'`（白色辉光只在深底成立——浅档须出等效浅色阴影或删）、:287 邀请钮 `background: linear-gradient(180deg, rgba(255,255,255,0.04), transparent)` + :288 `boxShadow: inset 0 1px 0 rgba(255,255,255,0.05)`；**光斑层 :132-138（第八轮 P2-4 补——style 对象跨行值，registry styleObjects 逐行正则两行都不命中=盲区中的盲区）**：`:135-136 backgroundImage:` 分行书写，值含 `rgba(255,255,255,0.04)` 白系渐变 + amber/teal 双 radial-gradient 光斑——浅色稿必须一并出裁定（光斑在浅底的等效/删）；**命名色清单（第七轮 P1-3——浅色稿逐处给裁定：保留/换等效/删；text-amber-100/70 压浅底 ≈1.05:1 属直接不可见类）**：:125 `border-zinc-900/90`、:255 `text-amber-100/70`、:270 `bg-amber-200/40`、:275 `text-zinc-950`、:276 `text-zinc-500`、:278 `text-zinc-400`/`group-hover:text-zinc-700`、:292 `bg-rose-300/15`；:270/:292 光斑属装饰（amber/rose）——逐处裁定保留或浅档等效；重做以上浅色版；:267 充值钮 `bg-white + hover:bg-zinc-100` 与 `bg-black/[.06]` 族**保留不 token 化**（通道 3）。深色档现状冻结（实现期 mode 分支）。产出写入 `2026-09-20-creditsdropdown-light-draft.md`（浅色稿值、层级、与 login 营销浅色设计语言的参照关系；**命名色清单逐处裁定表附后**）并 commit。**第五分区一般化方案（namedColorUtilities 正则）否决——简洁优先：CreditsDropdown 是当前唯一已知重灾区，专项清单+B6 兜底；若后续发现第二处重灾区再议**。

- [ ] **Step 2: 扩 no-theme-utility 九前缀族（spec §11.1）**

`no-theme-utility.js` 改三处：

① 正则（:25-26）扩前缀族：

```js
const THEME_UTILITY_RE =
  /(?:^|[\s"'`])((?:[a-zA-Z][\w-]*:)*)!?(text|bg|border|ring|divide|fill|stroke|from|via|to)-(?:white|black)(?:\/(?:\d{1,3}|\[[\d.]+\]))?(?=$|[\s"'`])/u;
// 第八轮 P2-2：alpha 段扩方括号形态 (?:\/(?:\d{1,3}|\[[\d.]+\]))?——bg-white/[0.06]、border-white/[0.1]、
// hover:bg-white/[0.12] 的 / 后是 [ 原正则不匹配（实测在册：ImageFullscreenViewer:137/:247、VideoFullscreenViewer:97、
// TextNodeToolbar:233、MultiImageNode:359、AudioConfigPanel:216/248、TextConfigPanel:216/248、VideoConfigPanel:276/310/414/429、
// ModelSelector:24、RatioResolutionPopover:47、GenerateCountSelector:26…）；两式必须同步（GLOBAL 式同款扩）。
```

② 白名单升级为「目录条目（string=全属性族放行）+ 精确文件条目（{glob, allow:['bg',...]}）」双形态——**现状 17 条一条不丢**（9 目录 + 8 单文件 string：岛 4 条 AuthModal/PhoneLoginForm/LoginModal/WeChatQRLogin 维持 string 全放行，跟随域 4 条 TopActionBar/CanvasTopBar/CreateCanvasCard/TeamDetail 升级为 {glob,allow} 对象形态——少一条即升级后全仓红）：

```js
export const THEME_UTILITY_WHITELIST = [
  // —— 恒深域（C8 D3 逐域摘除：videos→Task 20、video-editor→Task 21、nodes/edges/groups→Task 22）——
  'src/pages/videos/**',
  'src/pages/canvas/components/nodes/**',
  'src/pages/canvas/components/edges/**',
  'src/pages/canvas/components/groups/**',
  'src/pages/canvas/video-editor/**',
  // —— 岛（MaterialLibrary 随 Task 24 摘除并迁 TSX）——
  'src/pages/admin/**',
  'src/pages/login/**',
  'src/pages/register/**',
  'src/components/MaterialLibrary/**',
  'src/components/AuthModal.tsx',
  'src/components/auth/PhoneLoginForm.tsx',
  'src/components/auth/LoginModal.tsx',
  'src/components/auth/WeChatQRLogin.tsx',
  // —— 精确文件+属性族（现状 4 条随升级改对象形态；allow 语义=该属性族放行、其余仍拦）——
  { glob: 'src/components/layout/TopActionBar.tsx', allow: ['bg', 'text'] },       // 登录钮 bg-white/text-black（#9 反白 CTA）
  { glob: 'src/pages/canvas/components/CanvasTopBar.tsx', allow: ['text'] },        // 档位徽章 text-black（#6 黑字随底）
  { glob: 'src/pages/home/components/CreateCanvasCard.tsx', allow: ['bg', 'text'] }, // :30 bg-white 白盒 + :32 text-black 加号（#9 反白 CTA 族——allow 必须 grep 属性族定，禁按语义描述直写）
  { glob: 'src/pages/team/TeamDetail.tsx', allow: ['text'] },                      // 同上
  // —— C8 新增精确条目 ——
  { glob: 'src/pages/canvas/components/CreditsDropdown.tsx', allow: ['bg'] },       // :267 充值钮 bg-white+hover:bg-zinc-100（第五轮订正：此钮非"邀请卡"——邀请钮 :282-285 已 token 化；P5 通道 3 明文保留的即这族白系）
  { glob: 'src/pages/canvas/components/ConfirmModal.tsx', allow: ['bg'] },          // 白卡（通道 3）
  { glob: 'src/pages/canvas/components/SaveAsTemplateDialog.tsx', allow: ['bg'] },  // 白卡（通道 3）
  { glob: 'src/pages/videos/ProcessSnapshot.tsx', allow: ['bg', 'text', 'border'] }, // 内容承载恒深整块（spec §10-⑦）——videos 目录摘除时同 commit 补入
];
```

③ **统一匹配入口（防两套判定 + 模块加载崩溃）**：现状 `WHITELIST_RES = THEME_UTILITY_WHITELIST.map(globToRe)`（:63）与 `isWhitelistedPath`（:71-74）在模块顶层执行——元素变对象后 `globToRe` 对对象调 `.replace` 直接 TypeError。改法：删 `WHITELIST_RES` 与 `isWhitelistedPath`（其唯一消费者是 create() 内 :94，一并接管），统一为：

```js
/** 条目归一：string → {glob, allow:null(全放行)}；{glob,allow} → 原样 */
const normalizeEntry = (e) => (typeof e === 'string' ? { glob: e, allow: null } : e);
const WHITELIST_ENTRIES = THEME_UTILITY_WHITELIST.map(normalizeEntry);

/** 匹配 + 属性族判定：返回 null=不在白名单；返回 Set|null = 放行集（null=全放行） */
const RE_CACHE = new Map(); // 第七轮 P3：旧实现是模块级预编译；新入口若每次访问现编译 17 条 glob 会拖慢全仓 lint——缓存补回
function globToReCached(glob) {
  let re = RE_CACHE.get(glob);
  if (!re) { re = globToRe(glob); RE_CACHE.set(glob, re); }
  return re;
}
function whitelistAllowFor(filePath) {
  const rel = toAppRelPosix(filePath);
  for (const e of WHITELIST_ENTRIES) {
    if (globToReCached(e.glob).test(rel)) return e.allow; // null=目录条目全放行
  }
  return undefined; // 不在白名单
}
```

④ `create(context)` 改用统一入口 + **串内全匹配判定**（⚠ 只取首个匹配再放行整节点 = 首个家族在 allow 里时同串真违例全部漏报——比升级前更弱；判定必须"串内全部匹配的家族都在 allow 内才放行"，并对模板串**逐 quasi 收集**）：

```js
// 全局扫描形态：g 标志 + lookaround 边界（(?:^|[\s"']) 在 matchAll 下会吃掉一个字符致相邻 token 漏匹配）
// ⚠ 与 THEME_UTILITY_RE 两式必须同步修改（家族集/边界/变体前缀/alpha 段任一差异 = familiesOf 与 scanner 判定分叉）；fixture ④ 变体形态用例守此
const GLOBAL_THEME_UTILITY_RE = /(?<![\w-])((?:[a-zA-Z][\w-]*:)*)!?(text|bg|border|ring|divide|fill|stroke|from|via|to)-(?:white|black)(?:\/(?:\d{1,3}|\[[\d.]+\]))?(?![\w-])/gu;

/** 收集节点串内全部匹配的属性族（Literal 单串；TemplateLiteral 逐 quasi cooked——String(node.value) 对其恒 ''） */
const familiesOf = (node) => {
  const texts = node?.type === 'Literal'
    ? [String(node.value ?? '')]
    : (node?.quasi?.quasis ?? []).map((q) => String(q?.value?.cooked ?? ''));
  return texts.flatMap((t) => [...t.matchAll(GLOBAL_THEME_UTILITY_RE)].map((m) => m[2]));
};

  create(context) {
    const visitor = createStringClassScanner(THEME_UTILITY_RE, 'themeUtilityForbidden')(context);
    const wrap =
      (visit) =>
      (...args) => {
        const allow = whitelistAllowFor(context.filename);
        if (allow === null) return; // 目录条目全放行
        if (allow) {
          const fams = familiesOf(args[0]);
          if (fams.length && fams.every((f) => allow.includes(f))) return; // 全部命中家族都在 allow 内才放行
        }
        visit(...args); // 不在白名单 / 精确条目但存在超出 allow 的家族（含首匹配在 allow 的同串真违例）
      };
    return { Literal: wrap(visitor.Literal), TemplateLiteral: wrap(visitor.TemplateLiteral) };
  },
```

（⚠ 正则保持 `!?` 字面 `!` 量词形态——非"可选分组"，语义与现行等价；文件头 :6 注释"bg-white（非 text 前缀）不命中"**扩规则后已反，必须同步改写**为"九前缀族均命中；`bg-whitesmoke` 等非完整 token 仍不命中（尾部边界）"。）

- [ ] **Step 2b: 规则 fixture 自测（扩既有 describe，勿新建目录）**

`scripts/__tests__/lint-gate.fixture.test.mjs` **已具备全部装配**（:8 `import { noThemeUtility }`、:22 Linter plugins 注册、:64 `describe('flowweb/no-theme-utility 规则拦截（fixture，B5）')`、:25 注释写明"白名单按文件路径判定，fixture 以相对路径直供"——**filename 直供即精确条目的正确手法，无需真实文件**）。在该 describe 内追加 3 条用例（filename 分别直供）：

```js
    // ① 目录条目全放行：filename='src/pages/videos/VideoCard.tsx'（升级前基线，守旧语义）
    // ② 精确条目全匹配判定：filename='src/components/layout/TopActionBar.tsx'（allow:['bg','text']）
    //    code 含 'bg-white hover:text-black'（两家族都在 allow → 0 报）与 'border-white'（超出 → 1 报）——
    //    守"首个匹配在 allow 不能放行同串真违例"（N1 回归钩）
    // ③ 模板串逐 quasi：同 filename，code=`className={\`bg-white ${x} border-white\`}` → 1 报（border 超出）
    // ④ ⚠ 第五轮 P0-2 订正——scanner 契约"一个字符串含多个命中记 1 条"（string-class-scan.js:4/:17/:25-46
    //    Literal 单报 + TemplateLiteral 首 quasi 命中即 return）：'hover:!bg-white md:text-black' 恒 **1 报非 2 报**。
    //    写 2 报会诱导执行者改共享 scanner 为多次上报——那会同时改掉 no-color-hex 报告行为与 lint-gate.mjs:87-90
    //    的 baseline 键口径（未登记行为变更）。变体/! 形态的识别验证改走三条：
    // ④a filename 不在白名单，code='hover:!bg-white'（单 token）→ 1 报——守非全局式 THEME_UTILITY_RE 认得
    //    变体前缀+!（不认得则 0 报假绿）
    // ⚠ 第六轮 P0-2 重设 ④b——第五轮用 TopActionBar 当 allow:['bg'] 例是自相矛盾（真实白名单该文件
    //    allow:['bg','text']，正确实现会给 0 报，期望 1 报把"正确"判红、诱导改规则）。改用 allow 恰为
    //    ['bg'] 的真实条目（CreditsDropdown/ConfirmModal 任一）：
    // ④b′ filename='src/pages/canvas/components/CreditsDropdown.tsx'（真实 allow:['bg']），
    //     code='hover:!bg-white' → **0 报**——GLOBAL 式 familiesOf 必须认得变体+!（fams=['bg']⊆allow 放行）；
    //     漏认得则 fams=[] 落到 visit → 1 报，本用例红=变体提取失败
    // ④b″ 同 filename，code='hover:!bg-white text-black' → **1 报**——fams=['bg','text'] 不全在 allow 内
    //     才放行（守"全匹配判定"与变体提取的叠加路径）
    // ④a（1 报）+ ④b′（0 报）+ ④b″（1 报）构成"两式同步"完整闭环
  // ④c 第八轮 P2-2：filename 不在白名单，code='bg-white/[0.06]'（方括号 alpha）→ 1 报——alpha 段方括号
  //    形态两式都认得（不认得则 0 报假绿；实测在册 ImageFullscreenViewer:137 等十余处）
```

断言 message.id 与命中数（Linter.verify 直出）。跑 `node scripts/lint-gate.mjs` 确认全仓无新红 + **`npx vitest run scripts/__tests__/lint-gate.fixture.test.mjs`**（第五轮 M9：lint-gate 只 `lintFiles(['src'])` 不执行 fixture——fixture 由 vitest 拾取（vitest.config include 默认含 scripts/**，仅排除 e2e/**），本步显式跑一次防新增用例未验证就入库）。

- [ ] **Step 3: 跑扩规则拿 working list 并逐条处置**

```bash
cd /d/flowweb/apps/web && node scripts/lint-gate.mjs
```

预期目录白名单外新增红（**以脚本产出为准，第五轮实测 ≈16 处/10 文件、全部 bg 族**：`bg-black/NN` 中性 scrim ×13 + `bg-white` 白卡 ×3——与第四轮"≈25（bg 18+text 7）"预估不符，弃用旧数；text 族在白名单外 0 处=纯未来守卫）。**红的处置纪律**：每条红必须先 grep 该文件的九族属性（`bg-white|text-black` 等全族，**-i 大小写不敏感**）再定 allow——语义描述与属性族不一一对应（CreateCanvasCard"黑字随底"却含 bg-white 即活例），禁按语义描述直写 allow。逐条裁定（每条登记 registry whitelistKeeps 或直接迁移）：
- **token 化**：跟随域 chrome 上的 `text-white`→`text-text`/`text-on-accent`、`bg-white/NN`→`bg-overlay-N`（B2 同款五通道映射）——第五轮实测白名单外 0 处可做，此分支留给后续新增；
- **通道 3 合法面精确豁免**：中性 scrim（`bg-black/50` canvas/page.tsx:313、`bg-black/60` BaseFullscreenModal.tsx:70 等）与白卡面 → 加 `{glob, allow:['bg']}` 条目+理由；**第五轮实测白名单外命中 5 文件需预置条目**（各自按九族属性定 allow，勿照抄）：`src/pages/home/components/BannerCarousel.tsx`（2 处）、`src/pages/workspace/components/CanvasCard.tsx`（1）、`src/pages/workspace/components/FolderCard.tsx`（1）、`src/pages/canvas/components/Lighting/LightingModal.tsx`（3）、`src/pages/canvas/components/Angle3D/Angle3DModal.tsx`（3）；
- **通道 4 内容面**：媒体垫底 `bg-black` → 保留字面+精确豁免（内容承载）。

处置至 lint-gate PASS（此为 D3 开工前置门禁漏洞修补，目录白名单**本任务不摘**——逐域摘除在 Task 20-24）。

**摘除纪律（每域原子，缺一即红）**：Task 20/21/22/24 每摘一条目录，**同 commit** 必须补该域内合法保留位点的 `{glob, allow}` 精确条目（已知：videos 域 ProcessSnapshot 整块恒深、PlayView 压画面 text-white 族、封面垫底 bg 族；ve 域 ExportModal text-on-accent 迁移后无需；nodes 域 GridIcon/mini 垫底/标注调色板族）并同步 `canvas-migration-registry.json` whitelistKeeps。**⚠ 测试文件命中（第五轮实测）**：ESLint LINT_TARGETS=['src'] 会照拦 src 内测试文件——目录摘除后暴露 videos `__tests__/` 3 文件（PlayView/ProcessSnapshot/ProcessView.test）+ nodes 2 文件（TextConfigPanel/TextNodeToolbar.test）的九族命中（多为断言字符串）——同 commit 补单文件 string 条目放行（测试断言非产品 UI，整文件放行合理）并登记。**粒度限制承认**：文件+属性族仍会放走同文件同族未来回归（给 PlayView 开 allow:['text'] 后，将来在 PlayView 新写 text-white 不会被拦）——补偿 = d-segment 探针（VideoCard 前景已探针化，同款随各域补）+ B6 目检。

- [ ] **Step 4: registry 镜像 + commit**

`canvas-migration-registry.json` whitelistKeeps 与白名单同步。commit：

```bash
cd /d/flowweb && git add docs/superpowers/specs/2026-09-20-creditsdropdown-light-draft.md apps/web/scripts/eslint-rules/no-theme-utility.js apps/web/e2e/audit/canvas-migration-registry.json apps/web/src/ && git commit -m "feat(web): C8 D3 前置——CreditsDropdown 浅色稿出稿(ui-ux-pro-max,P5)+no-theme-utility 扩九前缀族(text/bg/border/ring/divide/fill/stroke/from/via/to × white/black)+白名单粒度升级(文件+属性族 {glob,allow})+白名单外 working list 以脚本产出为准(第五轮实测≈16 处全 bg：scrim/白卡精确豁免+5 预置文件条目)+fixture ④ scanner 单串单报契约对齐(④a/④b 变体验证挪 allow 判定侧)"
```

---

## Task 20（D3-videos）: 播放壳域原子对

spec §11.2 P3 专项 + E 表（两个全屏查看器恒深废止/O6② 死类删除/c7 #1#2#3 失效改写前置）。

**Files:**
- Modify: `apps/web/src/router.tsx:48-59`（**第五轮 P0-2 补入：删 /videos 路由级岛**——route 级 `<ConfigProvider darkAlgorithm>` + `<div className="dark">` 双通道整页钉深，不拆则 Task 15 VideoCard 并域在浅档空转（祖先 .dark 把 var(--fw-surface) 解析回 #1e1e1e）、Task 25 的注释订正变成"把假话写真"）
- Modify: `apps/web/src/pages/videos/VideoPlayerModal.tsx:58`（DOM 拆分）+ `PlayView.tsx`/`ProcessView.tsx`/`CarouselBar.tsx`/`VideoCard.tsx`（chrome 迁移；ProcessSnapshot 不动）
- Modify: `apps/web/src/components/BaseFullscreenModal.tsx` + `ImageFullscreenViewer`/`VideoFullscreenViewer`（跟随 + b3 落值双主题化）
- Modify: `apps/web/src/pages/videos/__tests__/VideoPlayerModal.test.tsx:168-173`（⚠ videos 域测试在一等 `__tests__/` 目录）
- Modify: `apps/web/e2e/c0-theme.spec.ts`（G8②③ 反转 + /videos 列表页浅档断言 + 文件头/videos 叙事）
- Modify: `apps/web/scripts/eslint-rules/no-theme-utility.js`（摘 videos 目录条目）

- [ ] **Step 0: viewer 逐元素裁定表（M5——两个全屏查看器混两类元素，不先划清就动手会"浅底浮层压黑画面"观感反转）**

先产出裁定表（登记 adjudications，逐元素归通道）：`ImageFullscreenViewer:239 bg-black`（全屏遮罩=媒体垫底→第四通道恒深）**与 `:145 bg-[#0A0A0A]`（图片区垫底→恒深，两文件同款各一处）**、`VideoFullscreenViewer:106 bg-[#0A0A0A]`（视频区垫底→恒深）、`:91 bg-[#1C1C1C]/80`（浮在媒体上的面板→第四通道）、`:186 bg-[#646464] + border-white/10`（按钮 chrome→跟随）；两文件的 `::-webkit-scrollbar-thumb`（:23-24/:20-21 `<style>` 块，registry styleBlocks 分区在册）随 chrome/恒深归属逐条定。表成后再动 Step 1-3。

- [ ] **Step 0b: /videos 路由根岛拆除（第五轮 P0-2——不拆则本域目标不可达）**

`router.tsx:48-59`（第六轮 P0-1 修订拆法——**保留 `<div>` 只删类名**）：删 route 级 `<ConfigProvider theme={{ algorithm: antdTheme.darkAlgorithm }}>`（React 组件不产 DOM，整块删）+ `<div className="dark">` → `<div>`（**元素必须保留**：/videos 是采集页，删元素 = removed≠added + 全部后代 dom: 路径错位 → 配对闸硬失败（附录 B 自己的铁律 + c7 §3 :43 先例"C2 videos 路由页根 div.dark 插层剥除先归一"）；同标签同位置同兄弟序号 → dom: 键逐字节不变）；**同 commit 清理死 import（第七轮 P2）**：ConfigProvider 删后 `router.tsx:3` 的 `ConfigProvider, theme as antdTheme` 成死引用（实测仅 :52/:58 使用、Spin 仍需保留）→ 改 `import { Spin } from 'antd';`（tsconfig 无 noUnusedLocals 不炸构建，但违反 CLAUDE.md"删除你的修改所导致未被使用的导入"）；Suspense 边界与 lazy 注释（:45-47 直链白屏防线）不动；:48-50 注释同步改写（原"videos 域恒深双通道"叙事废止——Task 25 的 router 注释订正**移到本 commit**，不留"只改注释不改代码"的假档）。深档零 diff 实证依据：html.dark 下 App algorithm 已是 darkAlgorithm；div.dark 删类后 html.dark 仍命中 `:root,.dark` → 深值级联结果不变（浅侧大变=岛拆除本身，浅侧 pairs 登记）。**c0 补一条跨路由浅档断言**（G8② 用例末尾追加）：`/videos` 列表页（非详情）html.light 下 `a[data-card]` 卡面 computed 底 `rgb(255, 255, 255)`（VideoCard 并域后浅值）——没有这条，"整页没翻"这类漏项（路由层）无测试可查。

- [ ] **Step 1: DOM 拆分前置（P3）——画面垫底独立、壳根 chrome 化（三条承重约束）**

`VideoPlayerModal.tsx:58` 壳根拆两层。**归属判据一句话**：视图区（PlayView/ProcessView 全部，含 ProcessView 状态分支）整体留媒体容器内；只有脱离画面的壳级元素（close-btn、CarouselBar）留外层：

```tsx
      {/* C8 D3 壳根 chrome 化：删 dark 类与 [color-scheme:dark]——跟随 html 主题；
          画面视口=内容承载恒深（P6 判据：露出来也是内容的一部分），垫底独立自持固定深底 */}
      <div ref={shellRef} data-vw-shell className="fixed inset-0 bg-bg text-text flex flex-col nokey">
        {/* 媒体容器（letterbox/加载前/poster 未到）：恒深 + 局部 [color-scheme:dark]（<video controls> 原生控件压深媒体面） */}
        <div className="flex-1 min-h-0 bg-black [color-scheme:dark]">
          {/* …PlayView/ProcessView 画面区（原样移入）… */}
        </div>
        {/* 壳 chrome：关闭钮/轮播条/页面级按钮——token 化跟随 */}
```

**承重约束（审核 D2 拍板 (a) 附加，违者布局碎）**：① 新媒体容器**不得加 absolute/relative/overflow-hidden**——PlayView 根是 `absolute inset-0`，包含块现为壳根 fixed，加定位会改几何与裁切；② `min-h-0` 必须保留（高度靠壳 flex 撑开）；③ **浅色档可见变化≈0 属预期**（画面容器恒黑、PlayView UI 压画面恒深，浅档仅外层框与轮播卡变化）——B6 目检防误判，登记 spec §13 已知接受（报告 D1 裁定 (a)+(c)：CarouselBar 与页面级 chrome 算跟随域，PlayView 压画面 UI 恒深）。`close-btn` :80 的 `bg-[rgba(50,50,50,0.45)]` 若压画面=第四通道保留，若在 chrome 区→token 化；以目检判定并登记。

**同层兄弟垫底方案已裁定否决**（第四轮审核提议：壳根首子 `absolute inset-0 z-0 bg-black` 垫底、不新增祖先层）：全屏黑底会压住壳根 bg-bg 自身——浅色档 chrome 跟随失效（P3 ②"画面外 chrome 双值化"的前提是媒体深底**有界**，flex-1 嵌套容器才是视觉正确解；静态定位的 CarouselBar 还会绘于 z-0 垫底之下）。**采集键集零影响的真实依据**：VideoPlayerModal 经 VideosPage.tsx:70 在 /videos 列表页同样挂载，零 DOM 的唯一理由是 :49 `if (!id || !detail) return null` 早退（采集器遍历 body 全域、portal 弹层本在采集范围——"portal 不算"/"只在详情路由渲染"都不是理由）；该前提由 Step 4 新增的 count=0 断言机械守卫（有人给详情加载加骨架屏时红，提醒 D 段基线影响），采集 videos 页的 dom: 键集在 Task 22 segcheck 配对闸另有兜底。

- [ ] **Step 2: 域内 chrome 迁移（四通道逐条）+ 状态分支字面清单（M2）**

按 registry `videosDomain.files` 清单核销，机械配方：
- chrome 面/字/边 → `bg-bg`/`bg-surface`/`text-text`/`border-overlay-2` 等 token 工具类；
- **压画面浮层恒定**（第四通道）：PlayView:69 `from-black/60` 顶栏 scrim、:74 `text-white/90`、:83 `from-black/70` 预览态渐变遮罩（**第五轮行号订正：文件无 `bg-black/70`，勿按图索骥**）——保留字面；
- `VideoCard` 封面占位底 `#262626`（:16）保留（P6 内容垫底；a0:200 探针持续 rgb(38,38,38)）；
- `CarouselBar`/`ProcessView` chrome 部分迁移（ProcessSnapshot **整块不动**）；
- **accent 字面前景点位（第四轮审核清单，本域实测两处）**：`ProcessView.tsx:62` `bg-[#4ade80] text-[#111]`「打开画布」钮（chrome）→ 品牌通道 token（底 `bg-[var(--fw-accent)]`/字 `text-[var(--fw-on-accent)]` 或既有工具类——--fw-accent 两档同值 #4ade80，深档字节等值零 diff）；`PlayView.tsx:104` 点赞钮（`bg-[#2f2f2f]` 深药丸压画面，liked `text-[#4ade80]`/常态 text-white）→ 按第四通道**保留恒深**（深药丸上绿/白两态两档均成立），登记 adjudications。
- **状态分支字面清单（M2——gate fixture 恒有数据，空态/错误态/加载态不在门禁渲染路径上）**：`grep -n "bg-white\|text-white" src/pages/videos/VideosPage.tsx src/pages/videos/ProcessView.tsx` 逐条裁定（VideosPage:53 bg-white/5、:56/:58 text-white/40 空态；ProcessView:45/:67/:69/:71）——空态白系字面浅档=白字白底不可见，随本域迁移并列入 B6 必看项。

每条登记 registry adjudications（file:line/通道/值）。

- [ ] **Step 3: 全屏查看器跟随 + O6② b3 处置订正（E 表实测改判）**

**订正（P5）**：`text-popover-foreground/text-muted-foreground/focus-visible:ring-ring` 在 src **0 处**——B3 轮已按 `b2-migration-registry.json` b3DeadClassDisposal（**:1131-1250**，第五轮跨度订正——下一键 b4DesignConstantWhitelist @1251）处置为 `replaced-literal`（text-neutral-200/text-neutral-400/ring-white/40，宿主即两查看器）。**本步真实工作 = 把 B3 的"恒深落值"改为双主题真值**（按 Step 0 裁定表：chrome 处→token/双值、压画面处→恒深保留），**不是删类名**；登记档以 b2-migration-registry.json 为准（初稿/spec 引 b3-alldead-list.json 系过期快照，spec 随本 commit 走 v1.5.1 变更登记订正；计数订正 ring-ring 2 处非 4）。**同 commit 撤销 b2:1136 domainRule**（"全屏查看器=画布恒深域禁 --fw-*"——E 表废止项，不撤销则 D3 后有人按它把 viewer 又钉回深色），改标 `revoked-C8-D3（跟随域，逐元素裁定见 registry）`。

- [ ] **Step 4: 断言反转（同 commit）**

① `VideoPlayerModal.test.tsx:168-173` 删 `[color-scheme:dark]` 断言、壳根类断言改 `bg-bg`。② c0 G8②（:535-554）反转为跟随断言：

```ts
test('G8 ②videos 壳跟随域（C8 D3 反转）：html.light 下壳根无 dark 类 + --fw-bg 浅值 + 画面垫底独立恒深', async ({ browser }) => {
  const ctx = await newSeededContext(browser, 'light');
  const page = await ctx.newPage();
  try {
    await page.goto('/videos/gate-video-1');
    await expect(page.getByTestId('video')).toBeVisible({ timeout: 15_000 });
    const state = await page.locator('[data-vw-shell]').evaluate((el) => ({
      islandSelfDark: el.classList.contains('dark'),
      fwBg: getComputedStyle(el).getPropertyValue('--fw-bg'),
      shellBg: getComputedStyle(el).backgroundColor,
    }));
    expect(state.islandSelfDark, '[G8②] 壳根应不再自带 dark 类（C8 D3 改跟随）').toBe(false);
    expect(norm(state.fwBg), '[G8②] 壳内 --fw-bg 浅值 #f7f8fa（继承 html.light）').toBe('#f7f8fa');
    expect(norm(state.shellBg), '[G8②] 壳根底=bg-bg 浅值 rgb(247,248,250)（第七轮 P1-3：computed 断 rgb 形态）').toBe('rgb(247,248,250)');
  } finally { await ctx.close(); }
});
```

② 补充（同用例末尾追加，G8② 代码块 closing 前后均可）：`await page.goto('/videos'); await expect(page.locator('[data-vw-shell]')).toHaveCount(0);` + **列表页卡面断言**（Step 0b 路由岛拆除的跨路由守卫）：`const card = page.locator('a[data-card]', { hasText: 'A0-0 门禁样例视频' }).first(); expect(await card.locator('.aspect-video').evaluate(el => getComputedStyle(el.parentElement!).backgroundColor)).toBe('rgb(255, 255, 255)')`（**第八轮撤回第七轮锚法订正、恢复原锚：实测 VideoCard.tsx:14 即 `<Link data-card className="… bg-[var(--vw-card-bg)]">`、:16 `<div className="relative aspect-video bg-[#262626]">`——.aspect-video 直接父级就是卡壳，且采集器自身探针 a0:203 `card.querySelector('.aspect-video')` 现网就在正常取值，结构有实证背书；若担心将来改结构，加固法是"取 .aspect-video 最近祖先中 computed backgroundColor 非 transparent 者"或加 data-testid，不是留未经验证的前提**）断并域后 VideoCard 卡壳 bg-surface 浅值——路由岛未拆此断言必红，正是 P0-2 的机械防线——**采集键集零影响前提的机械守卫**（VideosPage:70 挂载但 :49 早退零 DOM；count 断言红=有人改了早退逻辑（如加骨架屏），D 段基线影响须重评）。

③ G8③（:556-579）重写：壳岛废止后「html.light × 壳浅 × 壳内 LoginModal 浅」同色双层——保留 LoginModal 岛断言（islandLight 命中 + #f7f8fa），壳半断言改"壳根同为浅值"（双浅对照），删"双岛相反"叙事（G8③ 语义随 E 表消亡）。④ c0 文件头组2/组8 注释与 G7 videos 叙事（:379/:445 注释）同步改写。

- [ ] **Step 5: 白名单摘除（本域原子）+ 门禁 + commit**

`no-theme-utility.js` 删 `'src/pages/videos/**'` 行（net -1 目录）——**同 commit** 生效 Task 19 预置的 `{glob:'src/pages/videos/ProcessSnapshot.tsx', allow:['bg','text','border']}` 并补 PlayView 压画面族/封面垫底族的 `{glob, allow}` 条目 + **videos `__tests__/` 4 文件单文件 string 条目**（第五轮原写 3，第八轮 P3-1 实测为 **4**——多出 `__tests__/CarouselBar.test.tsx:80` 的 `'hover:ring-white/60'`：ring 家族、尾部引号满足边界必上报；测试断言字符串的九族命中，非产品 UI，整文件 string 放行合理）；registry whitelistKeeps 镜像。**摘除波实测基线（第八轮 P1-1——开工前先跑域 grep 拿当次数，下数为第八轮实测、以当次为准）**：videos 域九族命中约 41 处（产品码 30 处/8 文件 + 测试 ~11 处）——**产品码按附录 B slash-alpha 字节等值映射表迁 token（深档零 diff），媒体压层/封面垫底走精确条目，禁给产品文件加 string 整文件放行（附录 B 硬禁令）**；域纪律复核（第六轮口径统一）：`grep -rniE "(text|bg|border|ring|divide|fill|stroke|from|via|to)-(white|black)" src/pages/videos/ --include="*.tsx" | wc -l` 命中数=精确豁免登记条目数+已迁移项（九族 -i 口径与 no-theme-utility 规则一致，两词 grep 会漏算），产品码残余 0。

**域 segcheck（深浅双跑，第五轮补）**：

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs && COLLECT_BASELINE=1 BASELINE_DIR=segcheck-D3-videos npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D --after segcheck-D3-videos --out e2e/audit/baseline-diff-segcheck-D3-videos; echo "deep=$?" && COLLECT_BASELINE=1 REAL_LIGHT=1 BASELINE_DIR=segcheck-D3-videos-light npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D-light --after segcheck-D3-videos-light --out e2e/audit/baseline-diff-segcheck-D3-videos-light; echo "light=$?"
```

Expected: 深侧 exit 0（并域等值+路由岛删除在 html.dark 下级联不变）；浅侧大变（路由岛拆除整页翻浅+壳 chrome+空态白系字面迁移）逐对入 pairs 后 exit=0。清理 segcheck 产物（深浅 .json/.md 共四件）。commit **git add 具名**（`apps/web/e2e/audit/` 一把抓会吞 test-results 等未跟踪物——已加 .gitignore 双保险仍具名）：

```bash
cd /d/flowweb && git add apps/web/src/pages/videos/ apps/web/src/router.tsx apps/web/src/components/BaseFullscreenModal.tsx apps/web/src/pages/canvas/components/nodes/ apps/web/e2e/c0-theme.spec.ts apps/web/scripts/eslint-rules/no-theme-utility.js apps/web/e2e/audit/canvas-migration-registry.json apps/web/e2e/audit/c5-portal-census.json && git commit -m "feat(web): C8 D3-videos 播放壳域原子对——**/videos 路由根岛拆除(第五轮 P0-2:删 route 级 darkAlgorithm+div.dark,深档级联不变/浅侧大变入 pairs,Task 25 注释订正并入本 commit)**+viewer 逐元素裁定表(M5 含 Image:145 #0A0A0A)+DOM 拆分(画面垫底独立+三条承重约束/壳根删 dark 类 chrome 化/浅档可见变化≈0 登记已知接受)+PlayView/ProcessView/CarouselBar/VideoCard 四通道迁移+空态白系清单(M2)+全屏查看器跟随+O6② b3DeadClassDisposal 落值双主题化(b2:1136 域规则撤销+档名/计数订正)+G8②③ 反转+/videos 列表页卡面浅值断言(路由层漏项防线)+videos 白名单摘除同 commit 补精确条目+__tests__ 3 文件(net -1)；域 segcheck 深浅双跑:深 exit 0/浅 pairs 全配对；采集键集零影响依据=VideosPage:70 挂载但 :49 早退零 DOM(非\"只在详情路由渲染\"；采集器遍历 body 全域)，前提由 /videos 列表 count=0 断言机械守卫——此注记不得援引为采集页内结构改动的先例(采集页内层级增删=dom: 键漂移=配对闸必红)"
```

---

## Task 21（D3-ve）: ve 域字面迁移 + 壳岛拆除（G4 反转 + a0:250 双断言定稿）

**Files:**
- Modify: `apps/web/src/pages/canvas/video-editor/**`（registry veDomain 清单内字面）
- Modify: `apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.tsx:130-141`
- Modify: `apps/web/e2e/c0-theme.spec.ts`（G4 video-editor :278-315 反转）
- Modify: `apps/web/e2e/a0-collect-baseline.spec.ts`（:250 双断言定稿）/ `d-segment-probes.spec.ts`（D-4 翻转）
- Modify: `apps/web/scripts/eslint-rules/no-theme-utility.js`（摘 video-editor 目录）

- [ ] **Step 1: 壳岛拆除**

`VideoEditorShell.tsx:134` className 删 `dark `前缀与 `[color-scheme:dark]`（壳根 bg 已是 var(--fw-bg)——Task 15 并域）；`:138-141` ConfigProvider 删 `theme={{ algorithm: antdTheme.darkAlgorithm }}`（保留 getPopupContainer；algorithm 继承 App）。媒体区（PreviewPlayer 预览垫底=--ve-preview-base 恒深）若含 `<video>` 原生控件 → 该容器局部 `[color-scheme:dark]`（通则，实测后登记）。

- [ ] **Step 2: 域内字面核销（registry veDomain.files，8 源文件）**

grep 逐条按四通道裁定（chrome→--fw-*；内容承载→恒值键/字面；品牌紫→--ve-accent(-text) 档位；hover 提亮 `hover:text-white`（PreviewPlayer:91-:99）→ `hover:text-text-strong`——**实施期 quality 审查订正：原映射 hover:text-text 是无效 no-op（基础样式已是 text-[var(--fw-text)] 同 token，两档 hover 反馈静默消失——深档原 #e2e8f0→#fff 提亮被消除）；text-strong（深 rgb(247,247,247) 恢复提亮/浅 #111827 更深）保两档 hover 增量非零，hover 态不进快照无 pair**）。**⚠ 运行时键盲区（§0 复核登记）**：video-editor 采集页每轮 3 个 `tid:` 运行时键（节点根/video-edit-node-\*/track-row-track-\*）removed=added 命中既有白名单、结构性不参与属性比对——**这些根元素自身的迁移永远没有 differ 信号，核销靠 B6/探针，勿把"diff 没红"读成"改对了"**（子元素走稳定 dom: 键不受影响；Task 22 的 VideoEditNode 卡面 diff 预期成立——data-testid 在根 div、卡面是其子元素）。代表例：`PreviewPlayer.tsx:91` `hover:text-white` → `hover:text-text-strong`（quality 审查订正，理由见上）；**`ExportModal.tsx:245` `text-white` 保留不迁移（第七轮 M3 订正——原"text-on-accent 零 diff"判定双错：① 现状 computed 是 rgb(255,255,255)，换成 on-accent #141414 会新增未登记深档 diff（紫底白字 4.86 → 深字 3.79=对比度回归，台账 P9-图形档白字行自己就是证据）；② on-accent 语义绑 --fw-accent 绿底搭配，非紫底。紫底填充钮=图形档恒定面，白字即该面既定配对**——摘 video-editor/** 目录白名单的同 commit 补精确条目 `{ glob: 'src/pages/canvas/video-editor/components/ExportModal.tsx', allow: ['text'] }` + adjudications 一行。**消费 registry 盲区四分区**：ve 域命中的 `styleObjects`/`rgbaClasses` 位点逐行核销（两 lint 规则都拦不到，清单是唯一核销依据）。逐条登记 adjudications。

- [ ] **Step 3: 断言反转（同 commit；a0:250 定稿属探针面不触发冻结令——见 Task 10 Step 4）**

① c0 G4 video-editor 用例（:278-315）改判据：

```ts
test('G4 宿主浅×ve 壳跟随（C8 D3 反转）：壳根无 dark 类 + --fw-bg 浅值 + 壳根 backgroundColor=该浅值', async ({ browser }) => {
  // …开编辑器真实 UI 流同现状（:282-290），断言替换为：
      const shellState = await page.getByTestId('video-editor-shell').evaluate((el) => ({
        islandDark: el.closest('.dark') !== null,
        fwBg: getComputedStyle(el).getPropertyValue('--fw-bg'),
        shellBg: getComputedStyle(el).backgroundColor,
      }));
      expect(shellState.islandDark, '[G4/ve] 壳根 closest(".dark") 应为 null（岛拆除，C8 D3）').toBe(false);
      expect(norm(shellState.fwBg), '[G4/ve] 语义层：--fw-bg 浅值 #f7f8fa').toBe('#f7f8fa');
      expect(norm(shellState.shellBg), '[G4/ve] 视觉层：壳根底=该浅值 rgb(247,248,250)（第七轮 P1-3：computed 断 rgb 形态）').toBe('rgb(247,248,250)');
  // …清理段保留…
});
```

② `a0-collect-baseline.spec.ts:250` 探针（Task 15 已改读 --fw-bg）定稿双断言：语义层 `--fw-bg` html.light 下 `#f7f8fa` + 视觉层壳根 `backgroundColor` 归一等于该浅值（不保留任何恒深方向断言）。③ d-segment D-4 探针：壳底断言改 `rgb(247, 248, 250)`；ve 面板底（EditorTopBar）探针翻 `rgb(240, 241, 242)`。④ E 表登记：**c5-portal-census 无 VideoEditorShell 专属条目**（第五轮实测：仅在 :24 VideoPlayerModal 条目 why 与 :81 查看器条目 why 中被提及）——**新增**一条登记行标 `exited-C8-D3`，并在 :81 why 补注壳岛已拆（勿"改现有专属条目"——不存在）。

- [ ] **Step 4: 白名单摘除 + 门禁 + commit**

删 `'src/pages/canvas/video-editor/**'`（net -2 累计）——**同 commit 补三条精确条目（第七轮 M3 + 第八轮 P2-4 补两条）**：① `{ glob: '…/components/ExportModal.tsx', allow: ['text'] }`（紫底填充钮白字恒定面）；② `{ glob: '…/components/PreviewPlayer.tsx', allow: ['bg'] }`（:71 `bg-black` 媒体垫底恒深保留——第八轮实测摘目录后必红）；③ `{ glob: '…/timeline/ClipBlock.tsx', allow: ['text'] }`（:75 `text-white/85` clip 色条前景=内容语义恒深——第八轮裁定取精确条目而非迁近档，clip 面恒深整块与 P6 一致）；registry whitelistKeeps 镜像。**摘除波实测基线（第八轮 P1-1）**：ve 域九族命中约 7 处/3 文件（以当次 grep 为准）——多数可按附录 B slash-alpha 映射表迁 token（深档零 diff），上述三条是保留恒深面。域纪律：`grep -rn "var(--canvas-" src/pages/canvas/video-editor/ | wc -l` = 0。

**域 segcheck（深浅双跑，第五轮补——同 Task 20 形态）**：深侧预期 exit 0（并域等值+岛删 html.dark 级联不变）；浅侧壳 chrome/面板翻浅逐对入 pairs。命令同 Task 20 Step 5（目录名 segcheck-D3-ve / segcheck-D3-ve-light），清理四件产物。

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs
cd /d/flowweb && git add apps/web/src/pages/canvas/video-editor/ apps/web/e2e/c0-theme.spec.ts apps/web/e2e/a0-collect-baseline.spec.ts apps/web/e2e/d-segment-probes.spec.ts apps/web/scripts/eslint-rules/no-theme-utility.js apps/web/e2e/audit/canvas-migration-registry.json apps/web/e2e/audit/c5-portal-census.json && git commit -m "feat(web): C8 D3-ve 壳岛拆除原子对——VideoEditorShell 删 dark 类/darkAlgorithm 改继承 App+域内 8 源文件字面四通道核销(hover 提亮语义等价/ExportModal 紫底白字保留恒定+精确白名单条目——第七轮 M3:on-accent 语义绑绿底非紫底,换深字系对比度回归)+G4 反转(无岛+语义/视觉双断言,computed 断 rgb 形态)+a0:250 双断言定稿+D-4 探针翻浅+c5 新增 VideoEditorShell exited 条目+video-editor 白名单摘除(net -2)；域 segcheck 深浅双跑:深 exit 0/浅 pairs 全配对"
```

---

## Task 22（D3-画板批量）: 节点卡/工具条/底部面板/长尾 + VideoEditNode 三重变更 + #3a3a3a 族 + 白名单摘除

spec §11.2 VideoEditNode 专项 + §11.1 浅底重校清单 + P4/P10。**与 Task 18 之间禁止浅色档画布验收（§13.3 窗口在本任务收口）。拆分预案（第六轮）：若 Task 14 干跑校准量出的单轮 diff→登记→转绿耗时超标，本任务拆两次 commit——「节点卡 8 类（Step 1-2）」与「工具条/长尾/selectionTokens（Step 3）」——两半各自过门禁后连续提交（配对闸按段吸收，原子对纪律不破）。**

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/timeline/block-colors.ts`（P10 叶子共享常量）
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoEditNode.tsx` + `ClipBlock.tsx:8-10`
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx`（MiniMap 内联 JS 色双值化/CanvasView:456 分组索引钮——Step 3 点名，第七轮补列 Files 头）
- Modify: registry canvasDomain 清单内文件（节点卡 8 类/悬浮工具条 6 个/底部面板/CanvasToolbar/NodePalette/AddNodeMenu/selectionTokens.ts 等）
- Modify: `apps/web/scripts/eslint-rules/no-theme-utility.js`（摘 nodes/edges/groups 三条）
- Modify: `apps/web/e2e/d-segment-probes.spec.ts`（gate 节点卡底探针翻转）

- [ ] **Step 1: block-colors.ts 共享常量（P10）**

```ts
// P10 用户裁定 A（2026-09-20）：VideoEditNode TRACK_COLORS 统一到 ve BLOCK_BAR 色表。
// 叶子模块（先例：VideoEditNode 已从 timeline/canvas-size 叶子导入）——勿从 ClipBlock.tsx 导出，
// 否则会把 useAudioPeaks/editorStore 整条依赖链拉进画布节点 chunk。
export const TRACK_BAR_COLORS: Record<string, string> = {
  video: '#6C5CE7',
  image: '#5B7CFA',
  audio: '#8F5DBA',
  subtitle: '#5DBAA0',
};
```

`ClipBlock.tsx:10` 改 `const BLOCK_BAR: Record<Clip['type'], string> = { video: TRACK_BAR_COLORS.video, image: TRACK_BAR_COLORS.image, audio: TRACK_BAR_COLORS.audio, subtitle: TRACK_BAR_COLORS.subtitle };`（import 共享常量）；`VideoEditNode.tsx:20` 删 TRACK_COLORS，改 `import { TRACK_BAR_COLORS } from '@/pages/canvas/video-editor/timeline/block-colors';`，:208 `background: TRACK_BAR_COLORS[c.type] ?? '#6C5CE7'`。**禁指向 --ve-track-video**（BLOCK_BG 面色当类型色=深板近黑回归）。

- [ ] **Step 2: VideoEditNode P4 token 化（三重变更叠加卡，B6 单独目检）**

卡壳与字面替换（:148-221）：

```tsx
      <div
        className="bg-surface rounded-lg overflow-hidden"
        style={{
          width: 316,
          border: '1px solid var(--fw-border)', // #E5E7EB 巧合等值：浅档等值/深档变更（双向预期标注，spec §11.2）
          margin: 2,
          ...(selected ? { border: '1px solid transparent', boxShadow: '0 0 0 3px #9CA3AF' } : {}), // selectionTokens 交互态双值另行处理
        }}
      >
```

- `:161` `border-[#F0F0F0]` → `border-overlay-1`（深档 rgba(255,255,255,0.05)≠#F0F0F0——有意变更登记）；**`:170/:179` 现状是 `text-[#6C5CE7]`/`disabled:text-[#C9CDD4]` 字面（第七轮措辞订正：--ve-accent-text 系 Task 14 创建、此前全仓 0 消费，原文写成"的 var(--ve-accent-text)"会误导执行者去 grep 一个不存在的引用）——本步改为 `text-[var(--ve-accent-text)]`/`disabled:text-text-dim-2` 后即构成画布域反向消费 ve 前缀键**——adjudications 显式登记此跨域消费（第六轮 P2-3：与 Task 15"ve 域禁 var(--canvas-"域纪律不对称；裁定=品牌紫全仓同源单键，不另造 --fw-brand-text 别名防双键同值漂移，重命名/拆包时此条是绊线清单）；
- `:163` `text-[#1F2329]` → `text-text`；`:170/:179` `text-[#6C5CE7]`/`disabled:text-[#C9CDD4]` → `text-[var(--ve-accent-text)]`/`disabled:text-text-dim-2`；`:173/:215` `text-[#86909C]` → `text-text-dim-3`；
- `:194` `bg-black`（mini canvas 垫底）**保留**（JS 通道 #000 经 :129 的 `new CanvasRenderer(ctx)` 复用 canvas-renderer——c3 census 已登记；第五轮注：:129 是 renderer 引用行、黑底 canvas 元素在 :194，引用时勿混）；
- `:201` `bg-[#F2F3F5]` 轨道槽 → `bg-surface-dim`；`:214` `border-[#E5E7EB]` → `border-overlay-2`；
- GridIcon（:22-31）stroke `#6C5CE7` **保持字面**（v1.5 裁定：双档 4.86/3.43 ≥3，品牌图形档；SVG 属性 var() 不生效且不值当传 mode）。

differExpectedPairs 登记（深档有意变更）：VideoEditNode 白卡对 `backgroundColor rgb(255,255,255)→rgb(30,30,30)`（卡壳——**仅 VideoEditNode 是白卡**，gate 画布不渲染它、diff 落 video-editor 采集页）、`color rgb(31,35,41)→rgb(226,232,240)`（标题）等按 segcheck 实测逐对补；**其余 7 类节点卡现状=深卡 `bg-[#222222]`（VideoGenNode:718/ImageGenNode/MultiImageNode/AudioGenNode 同款）+ border #3F3F46——bg-surface 化的深档变更是微变**：补 pair `backgroundColor rgb(34,34,34)→rgb(30,30,30)`（7 类共用同值，全局配对互相吸收）+ borderColor 对（`rgb(63,63,70)→rgb(51,51,51)`，#3F3F46→#333）；**浅档变更=深卡→白卡巨变（bg-surface 浅 #ffffff）走浅侧 pairs + B6 逐类目检**（gate 画布只有 videoGen 一类，其余 7 类卡壳零探针覆盖——B6 清单逐类列名核销，第五轮 P0-1 补偿）。P10 三行 `backgroundColor`：`rgb(108,92,231)→rgb(91,124,250)`（image）、`rgb(149,222,100)→rgb(143,93,186)`（audio）、`rgb(255,214,102)→rgb(93,186,160)`（subtitle）。

- [ ] **Step 3: 画布长尾核销（registry canvasDomain 清单）**

**纪律（N4，先读）**：本步每位点的深档颜色变更都必须落 `differExpectedPairs`（`prop|before|after`）——**adjudications 只记理由，不参与 diff 吸收**（css-baseline-diff 只认 b2Pairs/dPairs）。若该位点不在 8 个采集页的渲染路径上（如 AnnotationToolbar、CreditsDropdown 浮层、隐藏状态分支），以"不可见→无 diff"为理由登记 adjudications，而非留空。

机械配方（每条登记 adjudications）：
- **节点卡 chrome**（ImageGen/Video/MultiImage/TextInput/Text/Storyboard 8 类卡壳——**第五轮叙事订正：除 VideoEditNode 白卡外，其余类现状=深卡 bg-[#222222]+border #3F3F46**，"深档白→深"只适用 VideoEditNode）：深卡面/字/边 → `bg-surface`/`text-text`/`border-overlay-2`（深档微变 rgb(34,34,34)→rgb(30,30,30)+border 对，Step 2 已配对；浅档深卡→白卡巨变走浅侧 pairs+B6 逐类目检）；**TextInputNode 文本节点=内容容器整体跟随**（P6 判据"否"分支，浅色下变浅否则违背需求）；VideoEditNode `:170` 非 disabled 分支 `text-[#C9CDD4]` 与 `:179` `disabled:text-[#C9CDD4]` 分别落 `text-text-dim-2`/`disabled:text-text-dim-2`（禁用态色同键同改）；
- **媒体容器 checklist**（机械检查项）：`grep -rn "<img\|<video" src/pages/canvas/components/nodes/` 祖先链逐个核——每个媒体容器自持深底（透明 PNG/未加载/poster 未到不露浅底）；**4 处节点浮标显式登记（第七轮 P2——按本步 N4 纪律"不可见→无 diff"落 adjudications 而非留空）**：VideoGenNode:623/AudioGenNode:128/ImageNodeToolbar:402/MultiImageNode:207 的 `bg-[#222222]/80 border-white/10 text-[#ccc]` 深浮标（:621 条件 isSingleSelected && !hasMedia → 采集时不渲染无 diff）；浅色档保留深浮标属功能性正确（压在媒体/画布上的选中态浮层）——B6 必看项；
- **悬浮工具条 6 个 + 底部面板 + CanvasToolbar**：**登记通则（第八轮 P2-1——每个位点登记 pair 时深浅两档各算一次："深档字节等值"≠"浅档无 diff"。D2 后画布 chrome 已跟随主题，"深档等值"位点的浅侧才是新值落点；A 组 5 处 #3a3a3a 同属此类，按同一条通则处理——不在采集渲染路径上的以"不可见→无 diff"登记 adjudications）**：只迁移**仍在用字面 `rgb(38,38,38)` 的位点**；**已 token 化的 16 处 --canvas-controls-* 消费（VideoHDPanel 8、VideoNodeToolbar 5（含 hover 1）、VideoTrimPanel 3——第七轮订正：原"19 处"含 AssetPanel 3-hover，该 3 处已随 Task 15 Step 3 改指 --fw-overlay-2 出列；第八轮 breakdown 订正"5+1"与总数 16 打架；计数以 grep 实测为准）保持 token 消费不二次改写**（D1a 双值化即已翻转；D3 再改 bg-surface-dim 是第二次改写——深档字节等值但与"一处变更一条登记"撞车、registry 会出同位点两条裁定）。**CanvasToolbar.tsx 自身六处（第五轮行号订正：容器 backgroundColor 在 :51、border 在 :52；第六轮 P1-1 目标值写死；第七轮 G1/G2 补 :51 容器底与 6 处图标色——不补则浅档画布上最显眼的工具条仍是一个深色盒子+图标浅底不可读）**：`:15 BTN_BG rgb(38,38,38)`→**`var(--canvas-controls-bg)`**（深值字节等值 rgb(38,38,38)；比 --fw-surface-dim 更贴 §9.1 域纪律——画布工具条主键归 --canvas-controls-*，浅档分离度旋钮留在画布域 token 可单独调）、`:16 BTN_BG_ACTIVE rgb(58,58,58)`→**`var(--canvas-controls-active)`**（第六轮复活的激活态双值键——深 rgba(255,255,255,0.12)/浅 rgba(0,0,0,0.08)，蒙层式激活与常态恒可辨；与 CanvasToolbar.test.tsx :130/:138/:144 三条断言同 commit 改齐）、`:51 容器 backgroundColor rgb(38,38,38)`→**`var(--canvas-controls-bg)`**（第七轮 G1：不透明容器底，深档字节等值零 diff；**浅侧 rgb(38,38,38)→rgb(240,241,242) 需 pair——第八轮补**）、`:52 容器 border rgb(54,54,54)`→`var(--canvas-controls-border)`、**6 处图标/文字面色**：`:67/:85/:101/:115/:138 svg `color: 'rgb(160, 160, 160)'`→**`var(--canvas-controls-icon)`**（第七轮 G1 新键，Task 11/12 D1a 已落——深值字节等值零 diff；浅 #6b7280@#f0f1f2=4.27 且与 MiniMap nodeColor 浅值 rgb(107,114,128) 同源）、`:125 rgb(180,180,180)`（缩放文字钮）→同 `var(--canvas-controls-icon)`（**深档 180→160 微变 + 浅侧六处全部变色——第八轮补齐三对 pair，勿再写"其余 5 处无 pair"**）：

```json
  { "prop": "backgroundColor", "before": "rgb(38, 38, 38)", "after": "rgb(240, 241, 242)", "why": "CanvasToolbar :51 容器底浅侧（深档字节等值无 diff；D3-board 浅侧 segcheck 兜底改为预登记——第八轮）" },
  { "prop": "color", "before": "rgb(160, 160, 160)", "after": "rgb(107, 114, 128)", "why": "CanvasToolbar 图标 5 处浅侧→controls-icon 浅值（深档等值无 pair）" },
  { "prop": "color", "before": "rgb(180, 180, 180)", "after": "rgb(107, 114, 128)", "why": "CanvasToolbar :125 缩放文字浅侧；深侧另有微变对 color|rgb(180,180,180)|rgb(160,160,160) 同 commit 一并登记（深浅各算一次，两条并存）" }
```

`:44 .tb-btn:hover rgb(78,78,78) !important`→**保留 !important 只换色值 `var(--fw-overlay-3)`**（优先级承重：BTN_BG/BTN_BG_ACTIVE 是 inline style，拆 !important 则 hover 被内联底色压过=悬停反馈整体消失；**第七轮 G2：原 overlay-2 目标值会把三态压塌——常态 38/激活 64(0.12 白压 38)/hover 60(0.10 白压 38)，hover 比激活更暗且不可辨；overlay-3（0.2 白压 38≈81）≈现状 78，保序 38<64<81**；hover 态不进 differ 快照，有意变更登记 adjudications）；`:91 顶部"画板域恒深"注释同 commit 订正（**在 CanvasToolbar.test.tsx:91**，第五轮订正——同句原混两文件）。**激活态可辨机械断言（第六轮 P1-1 补）**：CanvasToolbar.test 增一条——minimapOpen 翻转前后 `getAttribute('style')` 串不同且分别含 `var(--canvas-controls-bg)`/`var(--canvas-controls-active)`（常态/激活永不同 token）。**CanvasToolbar.test 断言改法（第五轮 M12/P1-8 定案）**：jsdom 的 cssstyle 对 inline `var()` 读回不稳定（`style.backgroundColor` 可能返回 ''）——**禁断 style.backgroundColor；先跑一次微实测**（render 后 `btn.getAttribute('style')` 与 `btn.style.backgroundColor` 各读什么），断言改 **`getAttribute('style')` 含 token 名** 形态（7 条：`rgb(38,38,38)` 4 条 :92/:128/:136/:146 + `rgb(58,58,58)` 3 条 :130/:138/:144；"设计常量白名单（B 段登记）画板域恒深"旧注释同步改写）；**同类断言先实测读回再定形态**：VideoHDPanel.test:73、AudioConfigPanel.test:99（class*= 正则形态）、StoryboardGroupRenderer.test:92/:101、**TextInputNode.test.tsx:222/:282（第七轮 P1-6 补、第八轮风险描述订正——`container.querySelector('[class*="bg-\\[\\#222222\\]"]')` 选择器在 bg-surface 化后返回 null：:222-224 路径经 `?.` 短路落到 `expect(...).toBeTruthy()` **必红（响亮失败非静默）**；:282 as HTMLElement 后解引用 TypeError 待实测确认形态；改法=换稳定锚 `[class*="bg-surface"]` 或 data-testid，禁以保留 bg-[#222222] 字面换测试绿——那正静默废掉 P6 文本节点跟随裁定；顺带复核 :223 的 py-3/pl-3 组合锚）**；
- **白系 alpha className 族（M1）**：`hover:bg-[rgba(255,255,255,0.08)]` 等（AnnotationToolbar:135/:170、EraseBottomToolbar:123/:129、EditToolbar:131/:155/:370 + 常量 EditToolbar:95/:128、AnnotationToolbar:111、TransformToolbar:58/:59）→ `hover:bg-overlay-2` 族双值化——registry rgbaClasses 分区逐行核销 + 1-2 条 hover/active computed 探针（浅色档 hover 无反馈=功能性不可辨）；**JSX 内联 `<style>` 块 6 文件（M4）**：CanvasToolbar:24（**`.tb-btn:hover rgb(78,78,78) !important` 与本 Step 上条 CanvasToolbar 处置是同一件事（:24 是 `<style>` 起始行、:44 是 hover 规则行）——保留 !important 只换色值 var(--fw-overlay-3)；第七轮 G3 删原"先拆 !important"半句：拆掉则 hover 恒被内联底色压过=悬停反馈整体消失，且 hover 态不进快照 differ 看不见**）、EditToolbar:349、ImageNodeToolbar:430、TransformToolbar:139、ImageFullscreenViewer:130、VideoFullscreenViewer:90——registry styleBlocks 分区逐文件裁定（tooltip 底/hover/scrollbar-thumb）；
- **svgAttrs 分区核销（盲区四分区之二，建而有消费者）**：nodes/edges/groups 域命中的 SVG 呈现属性位点（fill=/stroke= 字面）逐行裁定——字面恒定项（GridIcon #6C5CE7 双档达标等）登记 adjudications、双值项落 JS 分支取色（SVG 属性禁 var()，spec §11.1 通则）；
- **accent/危险色字面前景核销（第四轮审核清单）**：`grep -rn "#4ade80\|#ef4444" src/pages/canvas/ src/components/MaterialLibrary/` 逐条裁定（实测在册：**CanvasView:456** `color: enabled ? '#4ade80' : '#fff'` 分组索引钮——**两分支都需主题化**（enabled→`var(--fw-accent-text)`、'#fff'→`var(--fw-text-dim-3)`），浅档白字白底=功能性不可见；**GridSizeDropdown:121** `background: executing ? '#333' : '#4ade80'` + `color:'#000'` 三元同类；**AudioConfigPanel:249/TextConfigPanel:249/VideoConfigPanel:415** listening 态 `bg-white/20 text-[#4ade80]`——bg-white/20 同时是九族命中位（nodes 白名单摘除后 lint 必红），迁 overlay/accent-text 或按宿主底裁定；**ConnectionLine:111** `hover:bg-[#ef4444]` → `hover:bg-[var(--fw-accent-danger)]`（index.css:30/:50 双档键既有，深档字节等值）；**ClipBlock（components/timeline/）:70 missing 边框 / :78 "素材已删除"角标文字，均大写 `#EF4444`**——**第四轮"零命中"结论撤销**（当时大小写敏感 grep + 错路径双误，第五轮 -i 复验命中）：`#EF4444` 恰为 --fw-accent-danger 深值，字节等值换 `var(--fw-accent-danger)`；missing 态 gate fixture 不渲染、无 diff，adjudications 登记；**ConfirmModal:33** danger 映射表（inline style）按对比度实测裁定 var(--fw-accent-danger) 或双档同值保留；MaterialLibraryModal.css:78 系注释非位点）；**KeyboardShortcutsPanel.tsx（§0 复核 P2-1 登记）**：svgAttrs 分区在册约 20 处 `stroke="#5DDCFF"`（:56/:72-79/:92-97——快捷键面板图标），另 **#38bdf8 2 处 @AudioWaveform:202/:234**——#5DDCFF@white=1.60 正是台账 P4-品牌浅底反证行判死的值（禁当浅色档接受值引用）：按该规则裁定双值变体 token 或迁恒深面；面板不可达于 8 采集页 → 无 diff 以"不可见"登记 adjudications + **入 Task 27 B6 必看清单**；
- **selectionTokens.ts 4 处 + StoryboardGroupRenderer #333 组边框/#fffff0 分镜格**：交互可视性双主题值 + 两态可见性实测断言（StoryboardGroupRenderer.test:92/101 改双主题可见性断言，防浅色下选中框消失）。**`--xy-selection-*` 全仓零消费——不列迁移项**（selection 钉值已由 Task 18 D-7 规则级探针+裁定覆盖，初稿两处指涉同一件事）；
- **#3a3a3a 族**（spec §11.1 分组；第六轮 P1-1 目标值写死）：A 组 size-7 图标钮 ×5（RunButton:14/AudioConfigPanel:270/TextConfigPanel:270/VideoHDPanel:220/VideoConfigPanel:467）**同键一次改齐 → `var(--canvas-controls-bg)`**（深档 rgb(58,58,58)→rgb(38,38,38) 微变，pair 登记 `backgroundColor|rgb(58,58,58)|rgb(38,38,38)`；浅档 #f0f1f2；**第七轮 P3 判断项：宿主面若本身是 controls-bg 系（如 VideoHDPanel 面板底）则钮与宿主同色不可辨——保留本裁定不改为 bg-overlay-2（pair 已按 controls-bg 登记且第六轮定案），可辨性入 Task 27 B6 清单逐钮目检，确认不可辨再局部升 bg-overlay-2 并改 pair**）——**CanvasToolbar.tsx:16 BTN_BG_ACTIVE 不在 A 组**（激活态专用，→ var(--canvas-controls-active)，见上条；第五轮"第 6 处同键"措辞作废——同键会把激活/常态坍缩同色）；B 组 tooltip 底 ×2（GenerateCountSelector:30/VideoConfigPanel:432）同键一次改齐（**翻浅后其上 text-white 需同步改 text-text=P7 应用**）；C-F 四处按语义各自裁定勿塌键（C=MultiImageNode:292 徽章、D=TextNodeToolbar:228 文本节点默认底【内容容器】、E=TextNodeToolbar:239 划线色板、F=AudioWaveform:272 波形基线）；3 条测试断言同 commit（AudioConfigPanel.test:99 class*= 正则形态、VideoHDPanel.test:73）；**groups 域深面浮层点名**（浅色档防"深色小岛"）：GridSizeDropdown:24/:60、AspectRatioDropdown:43、SelectionBoxOverlay:93、StitchButton:161、NormalGroupRenderer:81（`#1a1a1a` 族菜单/条）——随本批 chrome 化；
- **MiniMap 内联 JS 色双值化**（CanvasView.tsx:384-394）：`style.backgroundColor 'rgb(50,50,50)'/'rgb(70,70,70)'` 走 `var(--canvas-controls-bg)/var(--canvas-controls-border)`（style 属性 var() 安全；**第八轮 P2-3 订正性质：这是深档改值非"等值双值化"——controls-bg 深 rgb(38,38,38)/controls-border 深收敛后 rgb(51,51,51)，即深档 50→38、70→51 可见变暗。minimapOpen 默认 false（CanvasView:72）→ 采集态不渲染、无 diff——按本步 N4 纪律以"不可见→无 diff"登记 adjudications 并写明：若小地图在采集态可见需补 `backgroundColor|rgb(50,50,50)|rgb(38,38,38)` 与 `borderColor|rgb(70,70,70)|rgb(51,51,51)` 两对**）；**nodeColor 是函数 prop 落 SVG 属性——禁 var()，直接 JS 分支取色**（CanvasView 已有 mode）：`nodeColor={() => (mode === 'dark' ? 'rgb(160, 160, 160)' : 'rgb(107, 114, 128)')}`（nodeColor 深档 160 字面不变零 diff ✓）；`maskColor rgba(0,0,0,0.35)` 中性遮罩保留；**同类登记（第八轮）**：CanvasView:456 分组索引钮 `'#fff'`→`var(--fw-text-dim-3)`（rgba(255,255,255,0.6)）亦是深档改值——enabled 分支 #4ade80≡--fw-accent-text 深值零 diff ✓、gate 画布无分组故不可见，同以"不可见→无 diff"登记；
- **动画类元素浅档可见性专项**：edge particles（opacity 动画）/播放头/吸附线——静态对比达标≠动画可见，逐个目检留档（evidence 附 test-results 截图）；
- **EraseCanvas 涂抹蒙版恒深**（第四通道）+ **OutpaintSelectionOverlay `bg-white/30` 网格线保留字面**（落媒体上）+ 标注调色板 #FF0000/#FFD700/#0066FF/#000000 黑笔 + userColor() 恒定（P6 登记）。

- [ ] **Step 4: 探针翻转 + 禁 useTheme 验收 + 白名单摘除 + 门禁 + commit**

d-segment「gate 节点卡底」翻 **`rgb(255, 255, 255)`**（浅档白卡——探针恒 html.light 注入，D3 后 bg-surface 浅值；深档 rgb(34,34,34)→rgb(30,30,30) 微变走 pairs 非 probe）。禁令验收 grep（spec §11.1）：

```bash
cd /d/flowweb/apps/web && grep -rn "useTheme" src/pages/canvas/components/nodes/ src/pages/canvas/components/groups/ | wc -l
```

Expected: 0（唯一例外 CanvasView colorMode={mode} 不在 nodes/groups 内）。删白名单 nodes/edges/groups 三条（**net -5 累计——第七轮 P2 订正计数：恒深域目录共 5 条（videos/nodes/edges/groups/video-editor），Task 20/21/22/24 分别摘 1/1/3/1 条；四目录全摘完成**；**同 commit 补 nodes 域 2 个测试文件单文件条目**（TextConfigPanel/TextNodeToolbar.test，第五轮））。**⚠ 摘除波实测基线（第八轮 P1-1——本域是全仓最大波：nodes+edges+groups 九族命中约 141 处/28 文件（产品码 137/25）。处理纪律：①跟随型 chrome 上的 `*-white/[0.NN]` 与 `text-white/NN` 按附录 B slash-alpha 字节等值映射表迁 token（深档零 diff，hover/active 变体不进快照无任何 diff；非 hover 态浅侧值变逐条入浅侧 pairs）——实测大头样例 VideoHDPanel:121/130/156/165/188/197、VideoNodeToolbar:219/241/294、AudioConfigPanel:216/248/258、EditToolbar:381/423/443/453 等全为零 diff 可迁项，137 处可压到十几处保留；②保留恒深面（4 处节点浮标/媒体压层浮层/内容垫底/clip 色条）走精确条目；③产品文件禁 string 条目（附录 B 硬禁令——先例只给测试文件与 ProcessSnapshot 整块恒深单文件开过）；④开工先跑域 grep 拿当次基线数，收口时"产品码残余=精确条目数"对账**）。

**像素参照再固化（Task 17 审查补立规——gate 画布 2 枚 videoGen 卡面在 .react-flow 截图区内，本步深档微变 rgb(34,34,34)→rgb(30,30,30) 必打红 D1b 参照，执行者需合法出口）**：全门禁前执行四步——① `cd /d/flowweb/apps/web && npx playwright test e2e/d2-board-pixeldiff.spec.ts -g "深档" --update-snapshots`（只允许 -g "深档" 限定重生成）；② 同 HEAD 连跑 3 次深档全 0 diff（工装三律①重证）；③ 仓根 `cd /d/flowweb && sha256sum apps/web/e2e/audit/d2-ref-d2-board-dark.png > apps/web/e2e/audit/d2-ref-board-dark.sha256` 重固化；④ png+sha256 具名进本 commit（原子对纪律：参照再固化与有意深档变更同 commit——附录 B 豁免口）。未走此四步的任何覆盖仍红仍禁。

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs && COLLECT_BASELINE=1 BASELINE_DIR=segcheck-D3-board npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D --after segcheck-D3-board --out e2e/audit/baseline-diff-segcheck-D3-board; echo "deep=$?" && COLLECT_BASELINE=1 REAL_LIGHT=1 BASELINE_DIR=segcheck-D3-board-light npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D-light --after segcheck-D3-board-light --out e2e/audit/baseline-diff-segcheck-D3-board-light; echo "light=$?"
cd /d/flowweb && git add apps/web/src/pages/canvas/ apps/web/e2e/d-segment-probes.spec.ts apps/web/e2e/audit/canvas-migration-registry.json apps/web/scripts/eslint-rules/no-theme-utility.js && git commit -m "feat(web): C8 D3-画板批量——block-colors.ts 叶子共享常量(P10 统一 TRACK_COLORS→BLOCK_BAR，深档三行变色配对登记)+VideoEditNode P4 token 化(白卡/深卡叙事分轨:#222222 深卡 rgb(34,34,34)→rgb(30,30,30) 微变对+浅档白卡巨变走浅侧)+节点卡 8 类/工具条 6/底部面板/selectionTokens 双值+两态可见性断言+#3a3a3a 族 A/B 同键 C-F 分语义(宿主可辨性入 B6)+CanvasToolbar 六处(:15/:16/:51 容器底/:52 border/6 图标色→controls-icon 新键/:44 hover→overlay-3 保三态序 38<64<81——第七轮 G1/G2)+M4 !important 保留订正+TextInputNode.test:222/:282 稳定锚(禁保字面换绿)+ClipBlock #EF4444 大写命中恢复(第四轮误判撤销)+媒体容器 checklist+4 节点浮标 adjudications+动画可见性专项；白名单摘除 nodes/edges/groups(net -5 累计)+nodes 测试文件条目；D3-board 深浅双跑 diff 全配对实证"
```

---

## Task 23（D3-chrome 专项）: 顶栏药丸 + CreditsDropdown 浅色实现 + AnnotationToolbar 五件套 + Lighting/Angle3D chrome

**Files:**
- Modify: `apps/web/src/pages/canvas/components/CanvasTopBar.tsx:129,143,147`（药丸）+ `CreditsDropdown.tsx`（mode 分支浅色稿实现）
- Modify: `apps/web/src/pages/canvas/components/nodes/AnnotationToolbar.tsx`（五件套 inline style——**零 lint 守卫，registry 显式清单 + B6 目检**）
- Modify: `apps/web/src/pages/canvas/components/Lighting/*` 与 `components/Angle3D/*` 中的 chrome 文件（Modal/ControlPanel/ViewToggle/LightPresetButtons/AnglePresetButtons/Lighting 的 PromptInput）——**第五轮路径订正：两目录在 components/ 下非 video-editor/ 下**（RENDER_WHITELIST 只排除其中的 ThreePreview/Angle3DPreview 两个渲染产物文件）

- [ ] **Step 1: 药丸 chrome 化（P7 反例① 结案；四枚同批）**

CanvasTopBar 三处（:129/:143/:147）**+ ProjectTitle.tsx:64 第 4 枚**（逐字同款 `bg-[#1A1A1A]/90` 药丸，前景 text-text-dim-1 已 token——**并入本批勿留 Task 25**，否则收口时页面 3 浅 1 深）→ `bg-surface/90` 不可用（斜杠禁令）——改 `bg-surface backdrop-blur px-… rounded-full border border-overlay-2 shadow-lg`（不透明化+边 token 化）。**被采集属性实为四项，四条 pairs 全登记（第七轮 P1-4——原只登记深侧 backgroundColor 1/4：药丸本来就有 1px border（色走 tailwind borderColor.DEFAULT=var(--fw-border) 深 #333/浅 #e5e7eb），改 border-overlay-2 后深侧 borderColor after≠桥值、:179 桥豁免兜不住必 unexpected）**：

```json
  { "prop": "backgroundColor", "before": "rgba(26, 26, 26, 0.9)", "after": "rgb(30, 30, 30)", "why": "药丸深侧底 bg-surface 化（P7 反例① 结案）" },
  { "prop": "backgroundColor", "before": "rgba(26, 26, 26, 0.9)", "after": "rgb(255, 255, 255)", "why": "药丸浅侧底（同上，浅侧 pair）" },
  { "prop": "borderColor", "before": "rgb(51, 51, 51)", "after": "rgba(255, 255, 255, 0.1)", "why": "药丸深侧边 --fw-border→overlay-2（bridge 豁免不覆盖，必登记）" },
  { "prop": "borderColor", "before": "rgb(229, 231, 235)", "after": "rgba(0, 0, 0, 0.06)", "why": "药丸浅侧边（同上，浅侧 pair）" }
```

前景已 token（text-text/text-dim 族/userColor 恒定）——P7 面/前景/边一起翻齐。c7 §1 #7 药丸恒深接受项结案标注（Task 25 的 ProjectTitle 仅剩其余字面）。

- [ ] **Step 2: CreditsDropdown 浅色实现（mode 分支，深档现状冻结）**

按 Task 19 浅色稿：组件内 `const { mode } = useTheme();`（CreditsDropdown 在 CanvasTopBar 域非 React Flow 节点，不受 §11.1 禁令），`:127` 渐变与 `:271` 图标底按 mode 分支——深档**字面原样保留**（字节等值守卫：differ 深档零 diff），浅档用稿值；`:267` 充值钮白系族不动（第六轮措辞对齐 Task 19 订正：非邀请卡）。**"不可见"的机制名（第八轮 P2-6 订正——原"不产生深档 diff"没写为什么）：Popover 未展开 → 卡不在采集 DOM（CreditsDropdown.tsx:330-341 `trigger={['hover','focus']}` + `destroyTooltipOnHide`）→ 两侧 diff 皆无。前提失效警示（与 Task 20 VideoPlayerModal 的 count=0 断言防同类情形）：若将来浮层在采集态可见（改 trigger/默认展开/加 hover 预览），本步浅侧变更需逐条入 pairs**。浅色档经 B6 目检（Task 27）。登记 adjudications + differExpectedPairs（若浅档采集对照）。

- [ ] **Step 3: AnnotationToolbar 五件套（P7 反例② 专项）**

**纪律（N4 同 Task 22）**：本组件不在 8 采集页渲染路径（选中节点悬浮工具条）——深档变更以"不可见→无 diff"登记 adjudications；若浅色档采集对照时可见，则逐条落 pairs。

五件一起翻（原子性——同一视觉表面面/前景/边一起钉或一起跟）：
- `BAR_BG` 深底（组件常量）→ `var(--fw-surface)`；
- `:332` 恒白保存钮 → 填充 `var(--fw-accent)` + 字 `var(--fw-on-accent)`；
- `:230/:254` 白系选中环/分隔线 → `var(--fw-overlay-3)`/`var(--fw-border)`；
- `:135/:170` 白系 hover → `var(--fw-overlay-2)`；
- `COLOR_PRESETS` 含 `#000000` 黑笔**保留**（P6：用户在浅色主题下选黑笔=用户选择，显式登记）。

accent 字面收尾（本域一处）：`CanvasTopBar.tsx:175` `hover:bg-[#4ade80]/10`——10% 绿晕深/浅底均成立，**保留字面（唯一路——第五轮 M10 删斜杠分支：tailwind.config 颜色键全是单值 var()、`bg-accent/10` 斜杠形态结构性无输出，且 css-audit --slash-gate 对斜杠任意值 exit 1）**（双主题中性 alpha，通道 3 同类）；前景 text-accent-text 已 token 化勿动；裁定登记 adjudications。

全部 inline style（:111/:135/:161/:170/:187/:199/:211/:230/:305/:317/:332）——no-theme-utility/no-color-hex 双规则都拦不到 style 对象，**逐行核销 registry `styleObjects` 分区显式清单**（Task 5 盲区四分区之一，spec §11.1），核销靠清单+B6 目检。

- [ ] **Step 4: Lighting/Angle3D chrome 面板迁移（非目标收窄为渲染产物层，§11.2）**

迁移：LightingModal/ControlPanel/ViewToggle/LightPresetButtons、Angle3DModal/ControlPanel/AnglePresetButtons、Lighting 的 PromptInput。**勿动**（渲染产物白名单，registry renderWhitelist）：canvas-renderer.ts(+export worker)、Angle3DEngine.ts、LightingEngine.ts、ThreePreview.tsx、Angle3DPreview.tsx——同目录不等于同裁定，勿借目录逃逸。

- [ ] **Step 5: 门禁 + 本域 segcheck（深浅双跑，第七轮 P2-1 补——Task 23 药丸在采集页上，diff 推到 Task 25 才露面则无法按域归因）+ commit**

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs && COLLECT_BASELINE=1 BASELINE_DIR=segcheck-D3-chrome npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D --after segcheck-D3-chrome --out e2e/audit/baseline-diff-segcheck-D3-chrome; echo "deep=$?" && COLLECT_BASELINE=1 REAL_LIGHT=1 BASELINE_DIR=segcheck-D3-chrome-light npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D-light --after segcheck-D3-chrome-light --out e2e/audit/baseline-diff-segcheck-D3-chrome-light; echo "light=$?"
```

Expected: 深侧药丸四条 pairs 中深侧两条吸收（Annotations/CreditsDropdown/Lighting 浮层多为条件渲染不可见→adjudications）；浅侧药丸浅侧两条吸收；未配对=失败。清理 segcheck 产物（.json/.md 一起删、深浅共四件）。

```bash
cd /d/flowweb && git add apps/web/src/pages/canvas/ apps/web/e2e/audit/canvas-migration-registry.json && git commit -m "feat(web): C8 D3-chrome 专项——顶栏四枚药丸 chrome 化(CanvasTopBar 三处+ProjectTitle:64 同款同批，bg-surface+overlay-2 边，P7 反例①结案；四条 pairs 深/浅×底/边全登记——第七轮 P1-4:药丸既有 border 改色 after≠桥值必配对)+CreditsDropdown 浅色实现(mode 分支/深档字面冻结字节等值/充值钮白族保留+命名色清单逐处裁定)+AnnotationToolbar 五件套原子翻(token 化+黑笔保留，盲区 styleObjects 分区显式清单+不可见位点登记)+Lighting/Angle3D chrome 面板迁移(渲染产物 5 文件白名单勿动)+本域 segcheck 深浅双跑(第七轮 P2-1)"
```

---

## Task 24（D3-MaterialLibrary）: 白名单最后一目录摘除（累计 net -6）+ TSX 残余迁移

**Files:**
- Modify: `apps/web/src/components/MaterialLibrary/**`（10 个 TSX ≈77 处字面；CSS 已全量 token 化零改动）
- Modify: `apps/web/scripts/eslint-rules/no-theme-utility.js`（摘 MaterialLibrary 目录条目）
- Modify: `apps/web/e2e/audit/domain-token-adjudication-B0.json`（"原 family #3 恒深裁定废止"标注）

- [ ] **Step 1: TSX 残余按四通道迁移**

现状=纯摘除+字面迁移（无机制改动，**不必与 WeChatFollowModal 同批**）：MaterialLibraryModal.tsx:35-37 实测无岛类/无 ConfigProvider——本来就在跟随域；TSX 字面（hover 白系→`hover:bg-overlay-2` 族、面板深字面→token、封面占位恒深保留）。**CSS 勿读成"零改动"（§0 复核 P2-2 订正）**：MaterialLibraryModal.css 主题面已 token 化，但操作蓝家族约 13 处刻意字面实测在册（:39/:81 `#60a5fa` 文字压 `rgba(59,130,246,0.15)` 底、:66/:69/:74/:75 `#3b82f6` 指示条/滑杆 thumb 及 `rgba(59,130,246,*)` 底，styleObjects 分区在册）——浅档面板转白后 blue-400 文字压浅底 ≈2.6:1 需对比度裁定（台账外表值）+ B6 目检项。**摘除波实测基线（第八轮 P1-1）**：本域九族命中约 14 处/4 文件（产品码，以当次 grep 为准）——按附录 B slash-alpha 映射表迁 token 为主，封面占位/媒体垫底走精确条目，产品文件禁 string 条目（附录 B 硬禁令）。`text-dim-1` 消费点（Browser 侧）纳入浅底重校（浅档 dim-1 #9ca3af 对比 2.39:1 属刻意低层级——目检确认非缺陷）。
- [ ] **Step 2: 摘除 + 登记 + 门禁 + 本域 segcheck（深浅双跑，第七轮 P2-1 补——material-modal 是采集页）+ commit**

```bash
cd /d/flowweb/apps/web && grep -c "text-white\|bg-white" src/components/MaterialLibrary/*.tsx 2>/dev/null | grep -v ":0" ; node scripts/lint-gate.mjs && npx playwright test && npx vitest run && COLLECT_BASELINE=1 BASELINE_DIR=segcheck-D3-material npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D --after segcheck-D3-material --out e2e/audit/baseline-diff-segcheck-D3-material; echo "deep=$?" && COLLECT_BASELINE=1 REAL_LIGHT=1 BASELINE_DIR=segcheck-D3-material-light npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D-light --after segcheck-D3-material-light --out e2e/audit/baseline-diff-segcheck-D3-material-light; echo "light=$?"
```

Expected: 深侧 exit=0（等值 token 化零 diff；非等值处按 pairs 配对）；浅侧 TSX 字面翻浅逐对入 pairs 后 exit=0。清理 segcheck 产物（.json/.md 一起删、深浅共四件）。

```bash
cd /d/flowweb && git add apps/web/src/components/MaterialLibrary/ apps/web/scripts/eslint-rules/no-theme-utility.js apps/web/e2e/audit/domain-token-adjudication-B0.json apps/web/e2e/audit/canvas-migration-registry.json && git commit -m "feat(web): C8 D3-MaterialLibrary——白名单最后一目录摘除(纯摘除+字面迁移：Modal.css 已 token 化，TSX ≈77 处四通道核销+第八轮基线 14 处/4 文件按 slash-alpha 映射表迁移)+原 family #3 恒深裁定废止登记(B0 json)+本域 segcheck 深浅双跑(第七轮 P2-1)；net -6 目录全摘完成(恒深域 5+岛 1，第八轮计数口径)"
```

---

## Task 25（D3 收口）: 浅底重校长尾 + 涌现登记同步 + registry 分区逐域核销

**Files:**
- Modify: `apps/web/src/pages/canvas/components/NodePalette.tsx`(#0f0f0f/#e0e0e0/#f7f7f7)（**ProjectTitle.tsx 的 #1A1A1A 药丸已并入 Task 23 Step 1 同批——第七轮 P2 删本任务陈旧引用；该文件若 registry 清单仍有其余字面则随本步迁移，无则不列**）
- Modify: `apps/web/tailwind.config.ts:9-10`（注释订正；router.tsx 注释订正已随 Task 20 路由岛拆除 commit 完成——第五轮移轨）
- Modify: `apps/web/e2e/audit/canvas-migration-registry.json`（全分区核销标注）

- [ ] **Step 1: 浅底重校清单收尾**

NodePalette 字面迁移（**ProjectTitle 的 #1A1A1A 药丸已随 Task 23 处置——本步仅当 registry 清单列有其残余字面时才动它**；两文件原在 A5 时代 PAGE_REGISTRY_FILES :56-60 映射表——D 对涌现闸已改站点级（Step 2），本步只需迁移字面+d3EmergentSites 登记新边框位点）；透明 PNG 棋盘格/涂抹蒙版/裁剪遮罩逐个裁定"贴媒体 or 贴卡壳"（登记 adjudications）。

- [ ] **Step 2: 涌现登记核验（第五轮改写：D 对走 d3EmergentSites 站点级闸）**

D3 全程新增可见边框（border-width 0→N）位点：每处必须登记 `canvas-migration-registry.json` 的 **`d3EmergentSites`**（`{page, key, why}`——differ 对 D 对**任何采集页**（页无关，第六轮）的 border-width 0→N 站点按 `page|key` 精确匹配，缺即 offender exit 1；工作流=先跑 diff 拿 key 再登记，与 pairs 同款）。**登记位置事实注记**：A5 旧机制的"授权集"是 differ :321-325 运行时现算（`adjudication.bareBorder.nonzeroCodeSites` ∪ colored-144 ∪ `EXTRA_AUTHORIZED_FILES`）——emergence-adjudication-A4.json **没有** authorizedFiles 键，A5 旧对的补登动作是追加到 bareBorder.nonzeroCodeSites 或 EXTRA_AUTHORIZED_FILES（D 对不适用）。跑深浅双侧 `css-baseline-diff.mjs --before before-D[-light] --after segcheck-D3-final[-light]` 验证（segcheck 重采 working 侧）。

- [ ] **Step 3: D3 完成判据三源核销（differ exit 0 ≠ 完成，spec §11.1）**

① registry 分区逐条 `核销` 标注（每文件 adjudications 有裁定或豁免依据；**盲区四分区分级核销（第五轮）**：styleBlocks（6 文件）与 svgAttrs（量少）逐行勾；styleObjects/rgbaClasses 位点量大**不逐行勾**——按位点清单核销 + 把"浅色档会功能性不可见"的位点探针化（Task 22 accent 清单已含 CanvasView:456/GridSizeDropdown:121 等）+ 其余在 registry 明文标注"不逐行核销，靠 B6"——把诚实的边界写下来，比假装全覆盖好）；② 浅色档探针（d-segment 全绿——每跟随面取期望浅值、内容面取深值）；③ B6 目检清单待 Task 27 执行（本任务先登记清单）。hex 键数不增核验：`node scripts/lint-gate.mjs`（"重键计数不增"= meta.note 在册的人工纪律（:139 是说明字符串非检查逻辑）——lint-gate 本身无计数校验，靠核销清单自查）。**hex baseline 陈旧键说明（登记 registry notes 一句）**：D3 删除大量 hex 字面后 `eslint-hex-baseline.json` 残留已删行的陈旧键——默认不动 baseline（陈旧键不影响 no-new-violation 门禁语义），勿手动清也更禁 UPDATE_BASELINE=1。**行文本变更处置惯例（Task 15 实施期立规）**：迁移改写含 hex 字面量的**存续行**（如 ClipBlock:88 键帧菱形 #6C5CE7 改指）会使既有键哈希失配被误报"新增"——处置=确认总计数不变 + diff 仅该键哈希置换后重采合法（baseline meta.note 自身在册的"机械清理允许伴随重键（计数不增前提）"；B5 禁令防的是吞真违例，非此形态）。

- [ ] **Step 4: commit**

```bash
cd /d/flowweb && git add apps/web/src/pages/canvas/components/ apps/web/tailwind.config.ts apps/web/e2e/audit/canvas-migration-registry.json && git commit -m "feat(web): C8 D3 收口——浅底重校长尾(NodePalette/ProjectTitle 迁移+遮罩逐个裁定)+涌现登记 d3EmergentSites 站点级核验(D 对新机制，spec v1.5.2)+registry 全分区分级核销标注(styleBlocks/svgAttrs 逐行+styleObjects/rgbaClasses 清单+功能性不可见探针化+其余明文 B6；完成判据三源：清单/浅探针/B6 清单)+tailwind 注释订正"
```

---

## Task 26（D4-a）: 断言矩阵新形态 + 全域反转清单核销

spec §12.1/§12.2——**不列全就会红**，逐条核销。

**Files:**
- Modify: `apps/web/e2e/c0-theme.spec.ts`（组4 头注释/a0 叙事注释协同）
- Modify: `apps/web/e2e/a0-collect-baseline.spec.ts`（:15-18/:303/:305 叙事注释重写）
- Modify: `docs/superpowers/specs/video-editor.md:289/:291`（复活改写）+ `apps/web/e2e/audit/c7-accepted-items.md`（§1 #1/2/3/7、§3 归因、§2#8 改写——**第五轮路径订正：c7 在 apps/web/e2e/audit/ 非 docs/superpowers/specs/**，去 docs 找不到会误建第二真源）

- [ ] **Step 1: 断言矩阵三组终态（c0 新增 D 段组）**

```ts
// ── C8 D4 断言矩阵（spec §12.1）──
// 1 跟随矩阵：html.light 下 ve 壳(G4 已反转)/videos 壳(G8② 已反转)/WeChatFollowModal(G8① 已反转)/
//   画布全屏查看器/画板(G8 外新增)/节点卡 chrome 取浅值——d-segment-probes 全绿即本组；
// 2 残余真岛对照：LoginModal 浅岛(G7 既有)+admin 深岛(G4 既有)——岛机制断言保留不退化；
//   ProcessSnapshot 不列本组（内容承载面非主题岛，§12.1 v1.4 归类）；
// 3 内容承载面恒深：媒体垫底/clip 面/预览垫底取深值——videos 封面探针+a0:200；
//   ProcessSnapshot 在本组（整块恒深+全仓唯一保留 colorMode 常量，P7 原子性核验：子树 --fw-* 消费取深值与内容面一致）。
```

新增一条 ProcessSnapshot 恒深断言用例（html.light 下打开含快照的 videos 详情：`:91` 网格点 `#3a3a3a`、底深值——按实际可达路径落用例，锚 ProcessSnapshot.test:96 同款结构）。

- [ ] **Step 2: §12.2 全域反转清单逐条核销**

表格核对（已完成段标注、遗漏补齐）：G1/G2/G3/G7（Task 9）✓、G4 ve（Task 21）✓、G8①②③+/videos 列表断言（Task 16/20）✓、a0 探针 ×4 分级（:200 保持/:220 **保持值·改走 probeFlip**（v7 载体变值不变——第八轮措辞）/ :221 Task 17/:250 Task 21）✓、CanvasView.test 镜像（Task 17）✓、canvas+videos 颜色断言 ≥24 条（随 Task 20/22 各域原子对）✓、ve `video-editor/components/timeline/TimelinePanel.render.test.tsx:115-131` **不动**（clip 类型色=内容语义）✓、c7/c5/c3/B0/b2/b6 登记档（Task 16/21/24/25）✓、video-editor.md:289 复活+**:291 后半句改写**（本步——**非加注**：:291 第二句"上文亮色视觉未落地，实现现状暗色已被该 spec 显式追认（D4 video-editor 恒深）"正是复活 :289 所要推翻的话，只贴注记会把两句矛盾的话留在同一行，必须整句改写为"亮色规格随 C8 复活，浅色档以 --fw-* 浅值体系为准"）、**c7 §3 归因表按行改写：videos ×140 与 video-editor ×344 两行方向反转、admin ×984 不动（"484"系两行合计数非表内独立行，勿搜"484"）**、a0 叙事注释（:15-18/:303/:305 本步重写 + c0 文件头 :6-11/:19-20 三态/matchMedia 残留叙事一并清）、router.tsx（Task 20 随岛拆除）✓、tailwind.config.ts（Task 25）✓。

- [ ] **Step 3: G8④ admin 守卫复核（不动）+ 全 e2e + commit**

G8④ admin Popconfirm 现状守卫**保持不动**（admin 域不在本期范围）。跑全门禁后 commit：

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs
cd /d/flowweb && git add apps/web/e2e/c0-theme.spec.ts apps/web/e2e/a0-collect-baseline.spec.ts apps/web/e2e/audit/c7-accepted-items.md docs/superpowers/specs/video-editor.md && git commit -m "test(e2e): C8 D4-a 断言矩阵新形态——跟随/残余真岛/内容承载恒深三组终态+ProcessSnapshot 恒深断言补全+§12.2 全域反转清单逐条核销+video-editor.md 原始亮色规格复活(:289+:291 后半句整句改写非加注)+a0 叙事注释重写+c7 接受项失效改写(#1/2/3/7+§3 归因按行:videos×140/video-editor×344 反转 admin×984 不动)"
```

---

## Task 27（D4-b）: 全门禁 + B6 真实浅色对照 + 性能实测双探针 + 已知接受项终版

- [ ] **Step 1: 性能实测①——render 计数复验（探针已落 D2，此处复跑取证）**

`CanvasView.theme-perf.test.tsx` 已于 Task 18 建立（mock 真实 TextInputNode + 双向断言——**nodeTypes 是 CanvasView 内部常量无法注入 counting 类型，故走组件 mock 路线**）。D3 迁移完成后复跑一次确认仍绿（D3 曾大面积改节点组件，防性能回归）：

```bash
cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/CanvasView.theme-perf.test.tsx
```

Expected: PASS（节点 render 增量 0）。若红：先查 nodes 引用稳定性（store 选择器新数组），修 memo 化而非放宽断言。结果（含首渲染计数快照）记入 Step 2 的 d4-performance.md。

- [ ] **Step 2: 性能实测②——大画布读数（人工，留档）**

dev server 开 /canvas，铺 ≥50 节点画布（或复制 gate 画布加节点），切换主题一次：记录切换耗时与掉帧读数（fps 噪声大难判因——render 计数为主据，读数为辅）；antd cssinjs 晚一帧面积（ve/videos/canvas 三域同帧）观察记录。结果写入 `e2e/audit/c8-d4-performance.md`（含 Step 1 计数结论）。

- [ ] **Step 3: B6 真实浅色对照（画布+ve+videos+弹层全景目检）**

```bash
cd /d/flowweb/apps/web && COLLECT_BASELINE=1 REAL_LIGHT=1 BASELINE_DIR=d4-reallight-tmp npx playwright test e2e/a0-collect-baseline.spec.ts
```

逐页目检（复用 b6-acceptance 流程）：/canvas（**节点卡逐类列名核销 8 类**——gate 只有 videoGen 一类探针，其余 7 类卡壳浅档深卡→白卡巨变零探针覆盖，B6 是唯一守卫、逐类点名：ImageGen/Video/MultiImage/TextInput/Text/Storyboard/VideoEdit/工具条浅/板浅点可见/选中框可见/**浅色档浮层-板分离度**——工具条/面板/药丸 vs 板 #F5F5F5（contrast-pairs 观测行对应，糊板则升边框/阴影并登记）/**A 组 5 枚 size-7 图标钮与宿主面可辨性**（第七轮 P3——宿主同为 controls-bg 系时确认是否需局部升 bg-overlay-2 并改 pair）/**4 处节点浮标深浮标浅色档观感**（Task 22 登记：VideoGenNode:623/AudioGenNode:128/ImageNodeToolbar:402/MultiImageNode:207）/**CanvasToolbar 图标/hover 三态可辨**（常态 38<激活 64<hover 81 序实测）/**KeyboardShortcutsPanel 恒深面板混合态**（Task 22 审查补——面板底/边系 B2-b 期 token 化（overlay 族浅值）而内部 17 处 #5DDCFF 图标按"迁恒深面"裁定保留字面：浅档下面板翻浅而图标仍是 1.60:1 青色——B6 判定是否升面板为恒深或图标双值化，走变更登记）/**VideoHDPanel:108/:143/:175 标签浅档可读性**（Task 22 审查补——color:'#e2e8f0' 深字面在 controls-bg 浅 #f0f1f2 上≈1.1:1，B2-b 遗留灰阶未入 D1a 八键，B6 判定迁 dim 阶））、video-editor（面板浅/clip 块深=§13.4 有意、**ExportModal 紫底白字钮**恒定确认、**关键帧菱形标记浅色档观感**（Task 15 审查补——并域后 --fw-surface-dim 浅值 #f0f1f2 压 clip 面 #1f1f1f 上的反转对比，chrome-follows 架构正确但视觉突兀需目检））、videos（壳浅/画面 scrim 深）、WeChatFollowModal、MaterialLibrary（**操作蓝家族浅档可读性**——Task 24 登记：upload/batch 钮 #60a5fa 文字压 rgba(59,130,246,0.15) 蒙层合成底 ≈2.6:1 台账外表值、指示条/thumb #3b82f6 合成底对比；**白系盲区位点浅档功能性不可见**——FileGridZoomControl:16/:29 与 Browser:96 rgba(255,255,255,*) 白字浅底（styleObjects 在册，现存混排缺陷第三例）；**text-dim-1 消费点浅底重校**——Modal.css:42 upload-hint/:52 file-grid-empty #9ca3af@浅底 2.39:1 刻意低层级目检确认非缺陷；hover 弹层/右键菜单浅档观感顺带看）、CreditsDropdown 浅色稿（**命名色清单逐处回归**——Task 19 裁定表核对）、LoginModal/admin 岛不变。目检表落 `e2e/audit/c8-b6-light-eyeball.md`（VideoEditNode 三重变更卡单独看——P4+P10+#E5E7EB）。完成删除 tmp 目录。

- [ ] **Step 4: D4 全门禁终验（含 e2e 类型门禁——第五轮 M8 补）+ spec §13 已知接受项终版 + 收尾 commit**

**e2e 类型门禁用既有 `e2e/tsconfig.json`**（第六轮 B7 订正：第五轮的 tsconfig.e2e.json 新造方案作废——既有配置已覆盖 e2e 全域 + playwright.config.ts 且当前实跑 exit=0；新造配置的 `scripts/**/*.{ts,mjs}` include 在 allowJs:false 下是 no-op、徒增漂移面。门禁自 Task 3 起逐段执行，本步为终验复跑）：

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs && node scripts/contrast-table.mjs && npx tsc --noEmit -p e2e/tsconfig.json; echo "e2e-tsc=$?"
```

spec §13 增补终版（按实际发生的接受项核对 1-7 条 + AuthModal 范围外待裁项登记：AuthModal.tsx 深色字面宿主恒浅岛、v1.9 §3.2 错误标签订正——独立条目留待后续 spec）。

```bash
cd /d/flowweb && git add apps/web/src/ apps/web/e2e/audit/ docs/superpowers/specs/2026-09-20-canvas-domain-theme-design.md && git commit -m "test(e2e): C8 D4 收口——render 计数探针(节点组件 0 重渲实证)+大画布切换读数留档+B6 真实浅色对照全景目检(三重变更卡单独看+8 类节点卡逐类+浮层/板分离度)+全门禁终验(C0 新形态/vitest/lint 双规则/css-audit D 段 exit 0/contrast-table 自检/e2e tsconfig 既有配置类型门禁——Task 3 起逐段执行本步终验)+spec §13 已知接受项终版(含 AuthModal 范围外待裁登记)"
```

---

## 附录 A: 段↔任务对照与验收锚速查

| 段 | 任务 | 验收锚 |
|---|---|---|
| D0-0 | Task 1-5 | 零产品改动；探针钉值全绿（d0-probe-values.json 落盘）；自比自跑 0 噪声；A5 旧对 diff 不回归；**一轮做完停点复核再进 D0**（before-D 采集不在本段——第五轮移 Task 10） |
| D0 | Task 6-10 | 两态 DOM 类断言；'system' 存储→dark；matchMedia 计数 0；**before-D/before-D-light 于 D0 收口后入档（Step 4 唯一时间窗；"D0 零 diff"锚废止——新钮=有意 DOM 变更）** |
| D1a | Task 11-13 | **深侧 0 diff；浅侧恰为 body 两配对（Task 12 预登记的全局继承族 pair）吸收后 exit=0**（第七轮 P0-1 订正：body 换引是岛外唯一浅侧变化源；域 token 浅值消费者全在 .dark 岛内=其余浅侧 diff 是信号，逐条归因禁止预先豁免）；浅档新值可读（contrast-table 在册）；死键 ve-text-control 删 + controls-active 复活双值键 + controls-icon 新键；块唯一+源序；全文无裸 :root 双值域 token |
| D1b | Task 14-16 | 深浅双跑 diff 与 §9.2 总清单逐条配对（absorbed>0、unexpected=0）；`var(--canvas-` ve 域 0 命中；WeChat html.light 浅值；a0:250 探针仍钉深（岛未拆） |
| D2 | Task 17-18 | 深档像素 0 diff（快照自比自证 + snapshotPathTemplate 直落 audit 单一真身 sha256 固化）；--xy-* 复测表（读 .react-flow__background + circle fill 对照）；镜像断言绿；selection 两档断言（直接定案不实验）；render 计数探针首跑；D2 后非验收浅色目检 checkpoint |
| D3 | Task 19-25 | registry 分区分级核销（styleBlocks/svgAttrs 逐行 + styleObjects/rgbaClasses 清单+功能性不可见探针化）+ 浅探针每面期望值 + B6 目检清单（8 类节点卡逐类）；hex 键数不增；**白名单可执行判据：每域目录摘除后该域 lint 命中数 = 精确豁免登记条数（净计数无手写锚——第五轮改写，"净增 K 文件"旧表废弃）**；路由岛/壳岛/白名单摘除域原子对；涌现站点 d3EmergentSites 登记闸 |
| D4 | Task 26-27 | 断言矩阵三组 + §12.2 核销 + 全门禁（+既有 e2e/tsconfig.json 类型门禁——第七轮对齐第六轮 B7 废止新造配置）+ B6 真实对照 + 性能双探针（①D2 落 D4 复验 ②大画布读数） |

## 附录 B: 全程禁令速查

- 禁 `UPDATE_BASELINE=1` 重采（B5）；A5 旧基线对（before-A0×after-A）冻结不动；hex baseline 陈旧键不清（lint-gate 语义不受影响）。
- 禁重构与有意视觉变更同 commit；每域岛拆除与断言反转同 commit（原子对）；白名单目录摘除与该域精确条目补登同 commit。
- 禁浅色档验收落 D2–D3 空隙（§13.3）；D1b↔D2↔D3 板面批次连续收口。
- 禁 `pages/canvas/components/{nodes,groups}/**` 内 useTheme（CanvasView colorMode 例外）。
- 禁 tailwind.config.ts 加 colors 映射（§5——任意值 var 形式即可，勿增 baseline 键）。
- 禁通道 3 中性色 token 化（scrim/阴影/邀请卡白族——明文保留）。
- 禁 SVG 呈现属性走 var()（stroke=/fill= 一律 JS 分支或字面恒定——GridIcon 先例）；antd Progress strokeColor 判据看 computed stroke 非属性文本。
- 禁两套白名单判定并存（whitelistAllowFor 统一入口，isWhitelistedPath/WHITELIST_RES 已删；glob 编译走 RE_CACHE 缓存——第七轮 P3 防全仓 lint 变慢）；禁 `String(node.value)` 取模板串（走 quasi cooked）。
- **产品文件禁 string 白名单条目（第八轮 P1-1 硬禁令）**：只允许 `{glob, allow:[family…]}`；string 整文件放行仅限测试文件与"整块恒深单文件"（ProcessSnapshot 先例）——nodes 域摘除波约 137 产品码命中，压力下给文件加 string = 把全仓最大域的 lint 保护整体删掉且不留痕。**slash-alpha 字节等值映射表（把 137 处压到十几处的关键，深档零 diff——依据 index.css 深值与单值 token）**：

| 现状类 | 目标 token | 深档等值依据 |
|---|---|---|
| `bg-white/5` | `bg-overlay-1` | overlay-1 深 = rgba(255,255,255,0.05) ✓ |
| `bg-white/10`、`hover:bg-white/10`、`active:…/10` | `bg-overlay-2` | overlay-2 深 = 0.1 ✓ |
| `bg-white/20`、`hover:bg-white/20` | `bg-overlay-3` | overlay-3 深 = 0.2 ✓ |
| `border-white/10` | `border-overlay-2` | 同上 ✓ |
| `text-white/60` | `text-text-dim-3` | dim-3 深 = rgba(255,255,255,0.6) ✓ |
| `text-white/30` | `text-text-dim-1` | dim-1 深 = 0.3 ✓ |

  适用范围：**只对跟随型 chrome**（工具条/面板/配置面板/节点卡 chrome）——保留恒深面（节点浮标/媒体压层浮层/内容垫底/clip 色条）仍走精确条目（浅档会出现"深浮标上 6% 黑边"反效果）。hover/active 变体不进快照→迁移后无任何 diff；非 hover 态（如 AudioConfigPanel:249 listening 三元）浅侧一次值变→逐条入浅侧 pairs。
- 跨域前缀键消费（--ve-accent-text 被画布域 VideoEditNode:170/:179 消费等）以 **adjudications 绊线清单**为准（第七轮补句——与 Task 15"ve 域 var(--canvas- 0 命中"域纪律读起来对称：前者是"画布域可消费 ve 键的显式登记"，后者是"ve 域禁消费 canvas 键"，重命名/拆包时两侧都是绊线）。
- 禁探针/断言直接注入 `classList.add('light')`（D0 起统一 addInitScript localStorage 真实路径；**豁免：b0 组3/B0-6 源序专测**——其机制正是靠 dark 与 light 双命中验 .light 块级联，非跟随面断言）；禁把 `['light','dark']` 之类"错误状态字面量"写进镜像断言（保持 `toEqual(mirror.html)` 形态）。
- **禁在 8 采集页内做 DOM 层级增删**（stableKey 的 dom: 路径键漂移 = 配对闸必红——dom: 键不适用"同位同量"豁免）；域内结构改动须先确认目标不在采集集（先例：VideoPlayerModal 只在 /videos/:id 渲染、不在采集集，Task 20 注记不得援引为采集页内结构改动依据）。**唯一豁免先例：D0 切换钮（CanvasTopBar 首位插入）——发生于 before-D 采集之前，基线锚定后状态**（第五轮 P0-1：这就是 before-D 窗口在 Task 10 的原因）。
- **机时预算（排期显式列入）**：每段验收 = pnpm build（tsc -b && vite build）+ 全量 e2e（workers:1 串行）+ vitest + 8 页采集 ×2（深浅）+ diff，粗估 10-15 分钟/段 × 12+ 段验收——纯门禁机时 3-6 小时；期间 PostgreSQL/Redis/API(含 collab 3001) 必须存活、seed 幂等。**段验收期间 API 尽量以非 watch 模式运行（或采集段之间不重启 dev watch API）**——watch 重启会中途吞掉采集请求（ECONNREFUSED，Task 1 实证），该段两侧基线不可比即作废，重跑代价 = 每段多一轮 8 页采集。
- differExpectedPairs 全局配对残余：同色对不同位点互相吸收——每条附 why + 三源核销补偿；**adjudications 只记理由不吸收 diff**（不可见位点以"不可见→无 diff"登记）。
- 禁像素参照快照被 `--update-snapshots` 静默覆盖：生成参照只允许 `-g "深档"`、**snapshotPathTemplate 落 playwright.config.ts 顶层（第七轮 M2——test.use 不解析该键）直落 e2e/audit/ 单一真身（入 git）+ `sha256sum -c` 校验（生成与校验都在仓根执行）+ 覆盖即红即 `git checkout --` 恢复**（无副本=无"校验副本放过真身覆盖"缝隙）、同 HEAD 3 次自比全 0 才可信；不达标准即降级附件证据，禁调 maxDiffPixels/threshold 凑绿。**豁免口（Task 17 审查立规）**：D3 板面/edges 段内的有意深档变更（Task 22 卡面微变等）按 Task 22 Step 4 的"参照再固化四步"（-g 深档重生成 + 3 次自比 + 仓根 sha256 重固化 + 与有意变更同 commit）为合法路径——禁令只针对无 -g 限定/非同 commit 的静默覆盖。
- 禁 `git add apps/web/e2e/` 一把抓（test-results 等未跟踪目录会被吞——已补 .gitignore 仍具名）；禁 `git add docs/superpowers/specs/` 一把抓（c7 等登记档在 apps/web/e2e/audit/）。
- D1a 起段验收**深浅双跑**（before-D × working + before-D-light × working-light），两侧有意变更都入 differExpectedPairs、未配对=失败；浅侧 diff 与预知值表（DOMAIN_LIGHT 等）核对不上的=失败非中间态。
- jsdom inline `var()` 读回不稳定：断 CanvasToolbar 等内联 token 消费用 `getAttribute('style')` 含 token 名形态，禁断 `style.backgroundColor`（M12）。

