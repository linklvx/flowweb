# C8 画布域主题跟随 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画布域（含 video-editor 壳、videos 播放壳、WeChatFollowModal、CreditsDropdown、MaterialLibrary）全量跟随浅/深主题；主题模型两态化（删 system 档），默认深色。

**Architecture:** 主题真源 = html `.light`/`.dark` 类（防闪白内联脚本挂类 + themeStore 两态单值）；antd algorithm / ReactFlow colorMode / CSS 变量三通道同源由 `mode` 推导。迁移按 spec 七段执行：D0-0 仪器先行（before-D 基线+探针+台账脚本）→ D0 两态六件套 → D1a 定义层双值化（深档零 diff）→ D1b 并域+有意变更配对 → D2 colorMode 翻转 → D3 registry 清单逐域原子对迁移 → D4 收口全门禁。

**Tech Stack:** React 18 + xyflow 12.10.2 + antd 5（cssinjs）+ Tailwind（token 工具类 + 任意值 var）+ Playwright（preview:5173 产物门禁）+ vitest（jsdom）+ 自研门禁（lint-gate.mjs / css-baseline-diff.mjs / b0/b1/c0 e2e）。

**Spec:** `docs/superpowers/specs/2026-09-20-canvas-domain-theme-design.md`（v1.5 定稿冻结——实施期分歧以 registry 产出与 contrast-table.mjs 实测为准，不回改 spec 全文，走变更登记）。

---

## 执行总纲（先读）

0. **节奏停点**：Task 1-5（D0-0 全部仪器件）**一轮做完停一次**——拿 `e2e/audit/d0-probe-values.json`（探针钉值）+ 自比自跑噪声报告 + registry 产出回来复核，确认仪器可信后再进 D0 代码段（Task 6+）。before-D 入档后**不要再动 a0 采集器的任何一行**（唯一时间窗，改动即不可复采）。
1. **段顺序不可换（spec §15 三把锁）**：D1 必须先于 D2；D2 与 D3 板面批次连续收口（中间态浅色画布不可用，禁止在 D2–D3 空隙做浅色档验收）；"深色档零 diff"验收锚只适用 D0-0/D0/D1a，D1b 起深档 diff 由 §9.2 总清单配对吸收（未配对=失败），D3 各域由域原子对清单吸收。
   - **配对闸已知残余**：differExpectedPairs 是全局 `prop|before|after`（无 page/key 维度），同色对不同位点会互相吸收——补偿 = 每条配对附 why + D3 三源核销（清单/浅探针/B6）。
2. **原子对纪律**：每域/每岛拆除与断言反转同 commit；重构与有意视觉变更不得同 commit（differ 信号保全）。
3. **基线纪律**：禁 `UPDATE_BASELINE=1` 重采；A5 旧基线对（before-A0 × after-A）保持冻结管 A/B 段；本期新增独立 D 段基线对（before-D × after-D 侧 segcheck 快照）。after-D 不是一次性产物——每次段验收按当前 checkout 重新采集 working 侧快照比对。
4. **常用命令**（全部在 `/d/flowweb/apps/web` 下执行；Bash CWD 会漂移，每条命令自带 `cd` 前缀；**命令均为 Git-Bash 形态**——`rm -rf`/`head` 等 PowerShell 下需换等价写法）：
   - 单测：`cd /d/flowweb/apps/web && npx vitest run <file>`
   - e2e 单文件：`cd /d/flowweb/apps/web && npx playwright test e2e/<file>`
   - 全门禁：`cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs`（⚠ e2e 经 playwright webServer 跑 `pnpm build`，而 build = `tsc -b && vite build`——**任何 TS 类型不干净都以"preview 起不来/600s 超时"的形式在 e2e 层爆**，报错面不在类型层；e2e spec 文件若在 tsconfig 范围内其类型必须干净）
   - 基线采集：`cd /d/flowweb/apps/web && COLLECT_BASELINE=1 BASELINE_DIR=<dir> npx playwright test e2e/a0-collect-baseline.spec.ts`
   - 基线 diff：`cd /d/flowweb/apps/web && node scripts/css-baseline-diff.mjs --before before-D --after <segcheck-dir>`（D 对；默认无参仍是 A5 旧行为）
   - segcheck 产物清理时 **.json 与 .md 一起删**（`--out` 前缀同时产出两者，漏删 .md 会被后续 `git add apps/web/e2e/audit/` 吃掉）
5. **探针生命周期表**（d-segment-probes.spec.ts 内每条探针注明所属段与翻转点；翻转在该段 commit 内同改。**全部探针断 computed 归一值**——var() 未被代换时 computed 落字面/空，同一断言可抓"代换失败"）：

| 探针 | D0-0 钉值（html.light 下） | 翻转段 → 新预期 |
|---|---|---|
| 画板 wrapper 底 | `rgb(0, 0, 0)`（colorMode 钉深） | D2 → `rgb(245, 245, 245)` |
| 画板网格点（读 `.react-flow__background` 的 `--xy-background-pattern-color-props` computed——自定义属性只向下继承，**不能从 wrapper 读**） | `#555555` | D2 → `#c8c8c8` |
| gate 节点卡底 | 实测发现值（Task 3 Step 4 落盘 d0-probe-values.json 照盘填） | D3-画板 → `rgb(30, 30, 30)`（bg-surface 深值） |
| CanvasTopBar 已连接前景 | `rgb(21, 128, 61)`（⚠ --fw-accent-text 是 B0 既有键，index.css:48 浅值 #15803d 早已生效——D0-0 即浅值，**无翻转点**，保留作浅档正向对照） | 不翻转 |
| videos 封面占位底 | `rgb(38, 38, 38)` | 不翻转（P6 内容垫底恒深，D4 组3 断言） |
| ve 壳底 | `rgb(20, 20, 20)` | D1b 仅键名并域（仍钉深：--fw-bg=#141414 + rgb(20,20,20) 不变）→ D3-ve → 双断言翻浅（--fw-bg `#f7f8fa` + 壳根 `rgb(247, 248, 250)`） |
| ve 面板底（EditorTopBar） | `rgb(38, 38, 38)` | D3-ve（壳岛拆除后）→ `rgb(240, 241, 242)`（--fw-surface-dim 浅值；D1b 并域期壳 .dark 岛仍钉深） |
| WeChatFollowModal 面前景 | `rgb(30, 30, 30)` / `rgb(226, 232, 240)` | D1b → `rgb(255, 255, 255)` / `rgb(31, 35, 41)` |
| VideoCard 卡标题前景 | `rgb(255, 255, 255)`（text-white 字面） | D3-videos → `rgb(31, 35, 41)`（卡面并 --fw-surface 浅 #ffffff 后白字白卡=不可见，必须探针化） |
| GridIcon rect stroke / 边线 stroke（图形档） | `rgb(108, 92, 231)` / `rgb(59, 130, 246)` | 不翻转（fill/stroke 对 differ 不可见——图形档唯一机械守卫即本组探针） |

---

## Task 1（D0-0 ⑴）: 四进程环境与 fixture 就位确认

零产品改动，只验证。四进程 = PostgreSQL + Redis（外部常驻）+ API(3000，collab 3001 同进程) + vite preview(5173)。playwright `webServer` 会自起后两者（`reuseExistingServer: false` 强制测自建 preview）；前两者必须已在跑。

**Files:** 无改动。

- [ ] **Step 1: 确认 PostgreSQL / Redis 在跑**

```bash
pg_isready -h localhost -p 5432 && redis-cli ping
```

Expected: `accepting connections` + `PONG`。失败则按 `memory/project_startup.md` 启动基础设施后再继续。

- [ ] **Step 2: 确认 gate fixture 与构建链路就位（跑一次现有全门禁）**

```bash
cd /d/flowweb/apps/web && npx playwright test
```

Expected: 41 passed + 5 skipped（collector skip）。global-setup 会做 migrate deploy + seed（gate-canvas-1/gate-node-1/样例视频随 seed 幂等重建），preview 5173 由 webServer 自建。**此步兼验 `pnpm build`（= `tsc -b && vite build`）通过**——webServer 起.preview 前先全量类型检查，后续任何 TS 类型不干净都会以"preview 起不来/600s 超时"的形式在此爆红，报错面在 e2e 层而非类型层，先跑通一次以区分"环境问题"与"类型问题"。**此步失败则修复环境后再进入 Task 2——扩了采集器却采不到基线等于白做，before-D 时间窗不可补。**

- [ ] **Step 3: 确认 USER storageState 就位**

```bash
cd /d/flowweb/apps/web && ls e2e/.auth/user.json
```

Expected: 文件存在（若缺失，跑一次 `npx playwright test e2e/a0-collect-baseline.spec.ts` 以外的任意需登录套件即可生成，或按 global-setup 说明手动登录生成）。

---

## Task 2（D0-0 ⑵a）: contrast-table.mjs 对比度台账脚本（自检向量 TDD）

spec §6.3：全文对比度数字以脚本出表为准；内建 3 组自检向量，不通过 `exit 1`。

**Files:**
- Create: `apps/web/scripts/contrast-table.mjs`
- Create: `apps/web/e2e/audit/contrast-pairs.json`（配对表输入）

- [ ] **Step 1: 写配对表（spec 在册数字全量入册）**

`e2e/audit/contrast-pairs.json`：

```json
{
  "meta": {
    "formula": "WCAG 2.x relative luminance，(L1+.05)/(L2+.05)，全文同公式同口径",
    "gamma": "线性化常数 0.055（((c+0.055)/1.055)^2.4，WCAG 2.x 正式式）。仲裁定案：#767676@white=4.54 与 #777777@white=4.48 两组 WCAG 公布名值只在 0.055 下成立（0.05 错植给 4.50/4.44）；0.05 实现产出约 −2% 偏差（#555555@black→2.76），历轮『spec 个别格多算 2%』论系 0.05 实现的指纹",
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
    { "id": "P2-浅档点-C8C8C8", "fg": "#C8C8C8", "bg": "#F5F5F5", "specExpect": 1.53, "spec": "§2 P2（spec :120 的 1.55 系内部不一致笔误——§13.5 的 1.53 为正确值，随本任务 commit 走 spec v1.5.1 变更登记订正）" },
    { "id": "P2-边线@浅板", "fg": "#3B82F6", "bg": "#F5F5F5", "specExpect": 3.37, "spec": "§8.1 edge-flow" },
    { "id": "P2-边高亮深档-999@浅板", "fg": "#999999", "bg": "#F5F5F5", "specExpect": 2.61, "spec": "§8.1 edge-highlight 换值动因" },
    { "id": "P2-边高亮浅档-6B7280@浅板", "fg": "#6B7280", "bg": "#F5F5F5", "specExpect": 4.43, "spec": "§8.1" },
    { "id": "P6-手柄深档-bg@白卡", "fg": "#9CA3AF", "bg": "#FFFFFF", "specExpect": 2.54, "spec": "§8.1" },
    { "id": "P6-手柄浅档-bg@白卡", "fg": "#6B7280", "bg": "#FFFFFF", "specExpect": 4.83, "spec": "§8.1" },
    { "id": "P6-手柄浅档-bg@板", "fg": "#6B7280", "bg": "#F5F5F5", "specExpect": 4.43, "spec": "§8.1" },
    { "id": "P9-欠账现状", "fg": "#6C5CE7", "bg": "#262626", "specExpect": 3.11, "spec": "§2 P9" },
    { "id": "P9-图形档白字", "fg": "#FFFFFF", "bg": "#6C5CE7", "specExpect": 4.86, "spec": "§2 P9" },
    { "id": "P9-图形档浅位", "fg": "#6C5CE7", "bg": "#F0F1F2", "specExpect": 4.30, "spec": "§2 P9" },
    { "id": "P9-文字档深@262626", "fg": "#9B8CF7", "bg": "#262626", "specExpect": 5.40, "spec": "§2 P9" },
    { "id": "P9-文字档深@141414", "fg": "#9B8CF7", "bg": "#141414", "specExpect": 6.57, "spec": "§2 P9" },
    { "id": "P9-文字档浅@f0f1f2", "fg": "#5F4FD1", "bg": "#F0F1F2", "specExpect": 5.27, "spec": "§2 P9" },
    { "id": "P9-文字档浅@f7f8fa", "fg": "#5F4FD1", "bg": "#F7F8FA", "specExpect": 5.61, "spec": "§2 P9" },
    { "id": "P4-GridIcon@白卡", "fg": "#6C5CE7", "bg": "#FFFFFF", "specExpect": 4.86, "spec": "§11.4" },
    { "id": "P4-GridIcon@深卡", "fg": "#6C5CE7", "bg": "#1E1E1E", "specExpect": 3.43, "spec": "§11.4" },
    { "id": "P4-品牌浅底失格-5DDCFF", "fg": "#5DDCFF", "bg": "#FFFFFF", "specExpect": 1.60, "spec": "§4 通道2" },
    { "id": "P4-品牌浅底失格-4ade80", "fg": "#4ADE80", "bg": "#FFFFFF", "specExpect": 1.74, "spec": "§4 通道2" }
  ]
}
```

- [ ] **Step 2: 写脚本（先跑 --self-check 应失败——脚本不存在即失败形态）**

`scripts/contrast-table.mjs`：

```js
#!/usr/bin/env node
// C8 对比度台账（spec §6.3）：输入 e2e/audit/contrast-pairs.json 配对表 → 输出 markdown 表；
// 内建 3 组自检向量（21.00 / 4.54 / 2.82），任一偏差 > tolerance 即 exit 1——历轮人工复算同格分歧以此终结。
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

Expected: `exit=0`，自检四行全 ✅（21.00 / 4.54 / **4.48** / 2.82），drift 列全空（drift>0 即 exit 1——在册值核对有牙齿）。**常数仲裁定案（两轮审核翻案的反驳，写入 meta.gamma 防第三轮）**：0.055 是 WCAG 2.x 正式式常数——#767676@white=4.54、#777777@white=4.48 两组公布名值只在 0.055 下成立（0.05 分别给 4.50/4.44）；主张"2.82 系 0.05 产物"的复算组（中间值 0.361453→0.087923）自身算术不自洽（0.361453^2.4≈0.0869 对不上 0.087923，后者恰为 0.05 族中间值 0.3633^2.4≈0.0880），且其"0.05→4.55"实为 4.50。**若你的实现跑出 2.76：channel 常数错植（0.055→0.05），查 selfCheck[1]/[2] 两锚**；实现确认无误而 drift 亮：按脚本值订正 spec 走变更登记——禁止改配对表迁就实现，也禁止改实现迁就 spec。

- [ ] **Step 4: Commit（含 spec v1.5.1 变更登记）**

```bash
cd /d/flowweb && git add apps/web/scripts/contrast-table.mjs apps/web/e2e/audit/contrast-pairs.json apps/web/e2e/audit/contrast-table.md docs/superpowers/specs/2026-09-20-canvas-domain-theme-design.md && git commit -m "feat(web): C8 D0-0 对比度台账脚本 contrast-table.mjs——WCAG 同口径出表 + 3 组自检向量（21.00/4.54/2.82 不过 exit 1，审核期 2.76 负例实证向量有效）+ specExpect/drift 列（在册值机器核对，drift 按脚本值订正走变更登记）；spec v1.5.1 登记：:120 1.55→1.53 订正（内部不一致笔误，§13.5 的 1.53 正确）"
```

---

## Task 3（D0-0 ⑵b）: a0 采集器扩展 + differ D 段基线对 + D 段探针族（同一 commit）

spec §6 动作 1/2/3。采集器冻结集扩 `backgroundColor` + 全元素 `color`；differ 新增独立 D 段属性集与配对闸；探针族先钉当前深值。

**Files:**
- Modify: `apps/web/e2e/a0-collect-baseline.spec.ts`
- Modify: `apps/web/scripts/css-baseline-diff.mjs`
- Create: `apps/web/e2e/d-segment-probes.spec.ts`

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

同步删除 `const FORM_CONTROL = new Set([...])`（:105，已无消费）。**紧随 rec 之后的 `if (el.getAttribute('aria-disabled')) rec.ariaDisabled = …`（:134）保留勿误删**。`computedPropertySet` meta 字段（:314-317）追加 `'backgroundColor(全元素)', 'color(全元素,D1 起)'`，并新增 meta 顶层字段 `attrSetVersion: 'D1'`（afterAll 写入对象第一层）。注释 `// color 仅表单控件（继承色噪声大）` 更新为 `// D1 起全元素采集——D 段基线对比色；旧基线（无 attrSetVersion=A0）跨代比对走"属性缺失=不判"`。

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

③ 新属性 diff（元素配对循环内，`b.color` 段之后追加；null 检查天然实现"属性缺失=不判"跨代分支）：

```js
    if (b.backgroundColor != null && a.backgroundColor != null && b.backgroundColor !== a.backgroundColor) {
      const key = `backgroundColor|${normColorVal(b.backgroundColor)}|${normColorVal(a.backgroundColor)}`;
      if (dPairs.has(key)) bump(dAbsorbed, `backgroundColor ${b.backgroundColor}→${a.backgroundColor}`);
      else {
        bump(bucketCount, `backgroundColor.${b.backgroundColor}→${a.backgroundColor}`);
        if (!reg) propUnexpected.push({ page, key, tag: a.tag, prop: 'backgroundColor', before: b.backgroundColor, after: a.backgroundColor });
      }
    }
```

`b.color` 段（:214-225）同步改：`b2Pairs` 判定外再判 `dPairs`（D 段注册配对同吸收）；A1_COLOR_PAIRS 豁免仅当 `after.attrSetVersion === 'A0'`（D1 全元素 color 下旧豁免不再盲目放行）。

④ D 段注册配对源 + 吸收表（B2_REGISTRY 加载处旁）。**fallback 必须含空 partitions**（authorizedFiles 并集引用 `D_REGISTRY.partitions.*.files`——registry 缺失时（如 CI 只跑 A5 旧对的 checkout）fallback 无 partitions 会 TypeError 崩掉任何 diff 运行）：

```js
/* C8 D 段注册配对（canvas-migration-registry.json differExpectedPairs——D1b/D3 有意变更逐条配对，未配对=失败） */
const D_REGISTRY_PATH = path.join(ROOT, 'e2e', 'audit', 'canvas-migration-registry.json');
const EMPTY_PARTITIONS = { canvasDomain: { files: [] }, veDomain: { files: [] }, videosDomain: { files: [] }, externalSingles: { files: [] }, componentDomains: { files: [] } };
const D_REGISTRY = fs.existsSync(D_REGISTRY_PATH)
  ? JSON.parse(fs.readFileSync(D_REGISTRY_PATH, 'utf8'))
  : { differExpectedPairs: { pairs: [] }, partitions: EMPTY_PARTITIONS };
const dPairs = new Set((D_REGISTRY.differExpectedPairs?.pairs ?? []).map((p) => `${p.prop}|${normColorVal(p.before)}|${normColorVal(p.after)}`));
const dAbsorbed = {};
```

报告 `report` 增加 `dExpectedGate`（同 b2ExpectedGate 结构）与 `meta.attrSetVersion`；MD §2b 旁增加 D 段吸收段。**A5 旧对行为零变化**（默认 before-A0×after-A 同代 A0；`dPairs` 空表不吸收）。

- [ ] **Step 3: 建 D 段探针族 spec（e2e/d-segment-probes.spec.ts，默认常驻套件）**

新建文件（结构照 b1：探针表 + locate 锚 + 断言；html.light 经 addInitScript 真实路径注入）：

```ts
// C8 D 段探针族（spec §6.3，b1 同构）：钉各域"当前主题应取值"——D0-0 先钉深值（html.light 下恒深面不变、
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

  test('gate 节点卡底=<发现值>（D0-0 实测钉值；D3-画板翻 bg-surface 深值）', async ({ browser }) => {
    const ctx = await lightContext(browser);
    const page = await ctx.newPage();
    try {
      await openCanvas(page);
      const card = page.locator('.react-flow__node[data-id="gate-node-1"]').locator('div').first();
      expect(await bgOf(card)).toBe('rgb(255, 255, 255)'); // ← Step 4 落盘发现值后照盘填（异值以发现为准）
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

（发现步落盘后：挑 gate 画布**真实渲染**且颜色随主题应恒定/翻转的 1-2 个 SVG 目标写成断言（如节点工具条 SVG 图标 fill、NodeHandle 的 SVG 部分）；不可测目标（粒子边/GridIcon）在 registry 显式登记"无门禁覆盖，B6 目检兜"——**宁缺勿假**，勿把与主题无关的默认值固化成探针。）

- [ ] **Step 4: 发现钉值（落盘照盘填，禁抄报错）**

在 d-segment-probes.spec.ts 顶部加一个仅本步使用的发现用例（全绿后删除或保留为 attach 证据）：

```ts
test('D-0 发现：探针钉值基线输出（落盘照盘填，防抄报错人因）', async ({ browser }) => {
  const ctx = await lightContext(browser);
  const page = await ctx.newPage();
  await openCanvas(page);
  const values = await page.evaluate(() => ({
    gateCardBg: getComputedStyle(document.querySelector('.react-flow__node[data-id="gate-node-1"] div')!).backgroundColor,
    boardDot: getComputedStyle(document.querySelector('.react-flow__background')!).getPropertyValue('--xy-background-pattern-color-props'),
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
cd /d/flowweb/apps/web && npx playwright test e2e/d-segment-probes.spec.ts e2e/c0-theme.spec.ts && npx vitest run
cd /d/flowweb && git add apps/web/e2e/a0-collect-baseline.spec.ts apps/web/scripts/css-baseline-diff.mjs apps/web/e2e/d-segment-probes.spec.ts apps/web/e2e/audit/d0-probe-values.json && git commit -m "feat(web): C8 D0-0 仪器扩展——a0 采集器 D1 属性集(backgroundColor+全元素 color+attrSetVersion)+differ 独立 D 段基线对(同代校验+D 注册配对闸)+d-segment-probes 探针族钉值(d0-probe-values.json 落盘随 commit，图形档发现步附 svg inventory)（三件同一 commit，spec §6 ⑵）"
```

---

## Task 4（D0-0 ⑶）: 自比自跑定 0 噪声基线

spec §6：before-D 自比自跑一次定 0 噪声——全元素继承色噪声先测预算，非 0 则就地扩分类器白名单并登记，**勿带噪声进 D1a**。

**Files:** 无产品改动（若出噪声：改 `css-baseline-diff.mjs` 分类器 + spec 变更登记）。

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

- [ ] **Step 3（条件）: 非零噪声处置**

若 unexpected：先查 **backgroundColor 的 `transparent` / `rgba(0, 0, 0, 0)` 变体噪声**（新属性集特有——两值等价但序列化不同，跨运行可能因元素渲染顺序抖动）→ 有则先在 differ 侧加归一化（`transparent → rgba(0, 0, 0, 0)` 再比对），归一化后仍有噪声才走白名单。其余逐条归因：确定性噪声（antd 弹层动画态/时序性 class）→ differ 分类器扩"预期项"白名单（OVERRIDES 或桶预期标注）并**在 spec §6 落一行变更登记**；非确定性噪声（元素计数漂移）→ 修采集稳定性（沉降等待/排除规则）而非白名单。循环 Step 1-2 直至 0。

- [ ] **Step 4: 清理噪声目录前先落结论文档（§0 停点复核物）**

```bash
cd /d/flowweb/apps/web && cat > e2e/audit/d0-noise-report.md << 'EOF'
# D0-0 自比自跑噪声报告（Task 4）
- unexpectedTotal: <填 Step 2 实测值（预期 0）>
- 归一化/白名单处置: <transparent 归一化或 OVERRIDES 条目，无则"无">
- 逐页元素计数: <d-noise-a vs d-noise-b 逐页对比（应全等）>
EOF
rm -rf e2e/baseline/d-noise-a e2e/baseline/d-noise-b e2e/audit/baseline-diff-dnoise.json e2e/audit/baseline-diff-dnoise.md
```

`d0-noise-report.md` 与 `d0-probe-values.json` 一起作为 §0 停点复核物随 Task 5 commit 入库（原始噪声产物删，结论文档留）。（若 Step 3 扩了白名单：单独 commit `fix(web): C8 D0-0 自比自跑噪声白名单——<条目与理由>`。）

---

## Task 5（D0-0 ⑷）: registry 脚本产出迁移清单 + before-D 采集入档 + 涌现闸两处同步

spec §5/§6.4：手写数字一律不作验收依据；迁移文件全集同时反向写入 PAGE_REGISTRY_FILES 与涌现授权集。

**Files:**
- Create: `apps/web/scripts/canvas-migration-registry.mjs`
- Create（脚本产出）: `apps/web/e2e/audit/canvas-migration-registry.json`
- Modify: `apps/web/scripts/css-baseline-diff.mjs`（PAGE_REGISTRY_FILES 三页数组 + 授权集并集）
- Create（脚本产出）: `apps/web/e2e/baseline/before-D/*`（8 页 json+png+meta，入档 commit）

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
  'src/pages/canvas/video-editor/renderer/export-worker.ts',
  'src/pages/canvas/video-editor/engine/Angle3DEngine.ts',
  'src/pages/canvas/video-editor/engine/LightingEngine.ts',
  'src/pages/canvas/video-editor/Lighting/ThreePreview.tsx',
  'src/pages/canvas/video-editor/Angle3D/Angle3DPreview.tsx',
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

/* 非 lint 可见盲区四分区（spec §11.1 + 审核补 <style> 块/rgba className 族/内容数据拆离）——
 * 两规则只拦 className 串 hex 与 white/black 类名；style 对象色值、SVG 呈现属性、JSX <style> 块、rgba( 任意值类
 * 全部漏网。styleObjects/svgAttrs/rgbaClasses 是核销清单；contentData（ve store 字幕默认 style:{color:'#FFFFFF'} 等
 * 内容语义色）显式排除——它们不是主题面，核销时勿混勾。 */
const STYLE_OBJECT_RE = /(?:backgroundColor|color|borderColor|boxShadow|background|outline)\s*:\s*['"`][^'"`]*#[0-9a-fA-F]{3,8}/;
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
    notes: '逐键裁定列随 D1a/D1b/D3 各段填充；differExpectedPairs 为 D 段配对闸唯一来源（未配对=失败，adjudications 只记理由不吸收 diff）；盲区分区（styleObjects/svgAttrs/styleBlocks/rgbaClasses）是"两条 lint 规则都拦不到"位点的唯一清单产出，量级以脚本产出为准',
  },
  partitions: {
    canvasDomain: { files: withHits(canvas).map(rel), totalFiles: canvas.length },
    veDomain: { files: withHits(ve).map(rel), totalFiles: ve.length },
    videosDomain: { files: withHits(videos).map(rel), totalFiles: videos.length },
    externalSingles: { files: extras },
    componentDomains: { files: withHits(componentDirs.filter(fs.existsSync).flatMap((p) => (fs.statSync(p).isDirectory() ? walk(p) : [p]))).map(rel) },
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
  whitelistKeeps: [],
};
const out = path.join(ROOT, 'e2e', 'audit', 'canvas-migration-registry.json');
fs.writeFileSync(out, JSON.stringify(registry, null, 1));
// PAGE_REGISTRY_FILES 粘贴视图（源文件、已滤测试）——css-baseline-diff.mjs 涌现闸双向校验要求
// 页数组内每个文件都在 authorizedFiles，故视图必须与 authorized 并集同源（tests 分区勿贴入页数组）
const pageRegistry = {
  canvas: registry.partitions.canvasDomain.files,
  videos: registry.partitions.videosDomain.files,
  'video-editor': registry.partitions.veDomain.files,
  'material-modal': registry.partitions.componentDomains.files.filter((f) => f.includes('MaterialLibrary')),
};
fs.writeFileSync(path.join(ROOT, 'e2e', 'audit', 'canvas-page-registry-view.json'), JSON.stringify(pageRegistry, null, 1));
console.log('[registry] 分区计数：', Object.fromEntries(Object.entries(registry.partitions).map(([k, v]) => [k, v.files ? v.files.length : v.sites.length])));
console.log('[registry] PAGE_REGISTRY_FILES 粘贴视图 → e2e/audit/canvas-page-registry-view.json（源文件视图，tests 已滤）');
```

- [ ] **Step 2: 跑脚本产出 registry**

```bash
cd /d/flowweb/apps/web && node scripts/canvas-migration-registry.mjs
```

Expected: 打印各分区计数（ve 源文件带色字面应约 8 个；videos 7 个左右——**以脚本产出为准，勿以本行数字为验收**）。

- [ ] **Step 3: 涌现闸两处同步（css-baseline-diff.mjs；缺一即 registryDrift/exit 1——双向校验 ：327-329）**

① `PAGE_REGISTRY_FILES` 三页数组粘贴 **canvas-page-registry-view.json**（源文件视图、已滤测试——**勿直接贴 partitions.canvasDomain.files 之外再混入 tests 分区**，测试文件不在授权集必红）。② 授权集并集——`authorizedFiles` 构造处（:321-325）追加（含 componentDomains，与 ① material-modal 数组同源）：

```js
  ...(D_REGISTRY.partitions?.canvasDomain?.files ?? []),
  ...(D_REGISTRY.partitions?.veDomain?.files ?? []),
  ...(D_REGISTRY.partitions?.videosDomain?.files ?? []),
  ...(D_REGISTRY.partitions?.externalSingles?.files ?? []),
  ...(D_REGISTRY.partitions?.componentDomains?.files ?? []),
```

（理由统一：C8 D3 迁移文件，canvas-migration-registry.json 在册。）**已知减弱登记**（registry meta.notes 补一句）：canvas/ve/videos 全量文件并入 authorized 后，涌现闸在这三页退化为近似 no-op（"必须归因到登记组件"被整批登记吸收）——替代守卫 = registry 逐条裁定 + d-segment 探针 + B6 目检。跑 `node scripts/css-baseline-diff.mjs --before before-A0 --after after-A` 确认 A5 旧行为不回归（authorized 变大只放行不收紧）。

- [ ] **Step 4: 采 before-D（唯一时间窗，8 页）**

```bash
cd /d/flowweb/apps/web && COLLECT_BASELINE=1 BASELINE_DIR=before-D npx playwright test e2e/a0-collect-baseline.spec.ts
```

Expected: 8 页落盘 + meta 含 `attrSetVersion: 'D1'`（检查：`head -20 e2e/baseline/before-D/meta.json`）。

- [ ] **Step 5: D0-0 段验收 + commit**

验收（spec §6）：D0-0 自身零产品改动 ✓（本任务只动脚本/审计档）；before-D 入档 ✓；`npx playwright test e2e/d-segment-probes.spec.ts` 全绿（钉深值）✓。

```bash
cd /d/flowweb && git add apps/web/scripts/canvas-migration-registry.mjs apps/web/e2e/audit/canvas-migration-registry.json apps/web/e2e/audit/canvas-page-registry-view.json apps/web/e2e/audit/d0-noise-report.md apps/web/e2e/audit/d0-probe-values.json apps/web/scripts/css-baseline-diff.mjs apps/web/e2e/baseline/before-D && git commit -m "feat(web): C8 D0-0 收口——registry 脚本产出迁移清单(分区+渲染白名单+盲区四分区 styleObjects/svgAttrs/styleBlocks/rgbaClasses 位点级清单+componentDomains+__tests__ 判据)+pageRegistry 粘贴视图+噪声/探针结论文档入库+before-D 基线入档(D1 属性集 8 页)+涌现闸两处同步(含已知减弱登记)；此后禁改 a0 采集器任何一行(before-D 唯一时间窗)"
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
// - 缺省/非法存储默认深；'system' 残留读取侧映射 dark 不回写（P8）。
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
- Modify: `apps/web/e2e/c0-theme.spec.ts`（G1 :102-122 / G2 静态 :168-191 / G3 :208-226 / G7 :383-457）

- [ ] **Step 1: G1 删 2 条 system 例**

`THREE_STATE_CASES` 删 `system+OS浅`、`system+OS深` 两行（保留 light/dark/无存储默认深三条）。`StoredTheme` 类型改 `'light' | 'dark'`。文件头组1 注释补一句：`（C8 D0 两态化：system 例删——残留映射深由 themeStore 单测覆盖）`。

- [ ] **Step 2: G2 静态判别式换两态**

:183 命中条件 `/theme/.test(m[1]) && /localStorage/.test(m[1]) && /matchMedia/.test(m[1])` 改为：

```ts
      if (/theme/.test(m[1]!) && /localStorage/.test(m[1]!) && !/matchMedia/.test(m[1]!)) { themeScriptIdx = m.index; break; }
```

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

① `THEME_UI`（:383-387）删 system 行。② 三态循环用例（:398-443）替换为两态往返：

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

    // 显式浅压 OS（live 变体：两态模型 OS 翻转零影响）
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    expectHtmlTheme(await readHtmlTheme(page), 'light', '[G7/显式浅压 OS 深]');

    // 点击 2：light → dark（往返闭合）
    (await expectThemeButton(page, 'light')).click();
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

- [ ] **Step 1: D 段探针 + before-D 零 diff（本段无视觉变更）**

```bash
cd /d/flowweb/apps/web && npx playwright test e2e/d-segment-probes.spec.ts && COLLECT_BASELINE=1 BASELINE_DIR=segcheck-D0 npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D --after segcheck-D0 --out e2e/audit/baseline-diff-segcheck-D0; echo "exit=$?"
```

Expected: 探针全绿；diff `exit=0`、unexpectedTotal=0（D0 零视觉变更）。清理：`rm -rf e2e/baseline/segcheck-D0 e2e/audit/baseline-diff-segcheck-D0.*`

- [ ] **Step 2: 全门禁**

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs
```

Expected: e2e 全绿（41±用例数变化：G1 -2、G3 重写 1）、vitest 全绿、lint 双规则 PASS。

- [ ] **Step 3: 原子 commit（D0 六件套 + c0 同步）**

```bash
cd /d/flowweb && git add apps/web/src/stores/themeStore.ts apps/web/src/stores/themeStore.test.ts apps/web/src/App.tsx apps/web/index.html apps/web/src/main.tsx apps/web/src/components/theme/ apps/web/src/components/layout/TopActionBar.tsx apps/web/src/pages/canvas/components/CanvasTopBar.tsx apps/web/e2e/c0-theme.spec.ts && git commit -m "feat(web): C8 D0 两态六件套——themeStore 单值 mode 删 system/matchMedia(P8 残留映射深不回写+storage 优先回挂 html 类)+App algorithm 由 mode 派生+index.html 两态脚本+ThemeToggleButton 共享组件(TopActionBar 两态化+CanvasTopBar 新钮三页入口)+c0 同步(G1 删 system 例/G2 判别式去 matchMedia/G3 OS 零影响+matchMedia 计数 0/G7 两态往返+钮存在性扩 /canvas)；零视觉变更：segcheck-D0×before-D 0 diff 实证"
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
  '--canvas-controls-text', '--canvas-controls-hover', '--canvas-handle-bg', '--canvas-handle-icon',
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
  '--canvas-handle-bg': '#6b7280',
  '--canvas-handle-icon': '#ffffff',
  '--canvas-handle-hover-bg': '#111827',
  '--canvas-handle-hover-icon': '#ffffff',
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

`readTokens` 的 evaluate 参数 tokens 传 `[...TOKENS, ...DOMAIN_TOKENS]` 方式复用（把函数签名加第二参 `tokens: string[] = [...]`）。新增：

```ts
test.describe('B0-6 C8 域 token 双值化（D1a）', () => {
  test('默认深：域 token 全部深值 + 死键已删（--canvas-controls-active/--ve-text-control 空）', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: USER_STATE });
    const page = await ctx.newPage();
    try {
      await openWorks(page);
      const s = await readTokens(page, 'html');
      for (const t of DOMAIN_TOKENS) {
        expect(s[t], `[B0-6] ${t} 深值期望 ${DOMAIN_DARK[t]}；实际=${JSON.stringify(s)}`).toBe(DOMAIN_DARK[t]);
      }
      expect(s['--canvas-controls-active'], '死 token 必须删除（D1a）').toBe('');
      expect(s['--ve-text-control'], '死 token 必须删除（D1a）').toBe('');
    } finally { await ctx.close(); }
  });

  test('html.light：域 token 全部浅值（双块源序）', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: USER_STATE });
    const page = await ctx.newPage();
    try {
      await openWorks(page);
      await page.evaluate(() => document.documentElement.classList.add('light'));
      const s = await readTokens(page, 'html');
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
          const keys = [...new Set((r.style.cssText.match(/--(?:canvas-|ve-|vw-)[\w-]+/g) ?? []).filter((k) => !SINGLE.test(k)))];
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

铁律：**只搬定义不改消费点语义；深色档字节零变更**（ve 媒体侧 4 处换恒值 token 为字节等值代换，非语义变更）。

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

**删除按点名清单而非行号区间**：裸 `:root` 块（:75-94/:97-106/:109-113）中被搬运的全部双值键 + **死键 `--canvas-controls-active`（:90）与 `--ve-text-control`（:103）显式点名删除** + 三条 var 链行（:99 `--ve-panel: var(--canvas-controls-bg)`、:100 `--ve-border: var(--canvas-controls-border)`、:103）——深块直写字面值后链不复存在。编辑完成后**全文不得再有任何裸 `:root` 双值域 token**（只剩 Step ④ 的单值恒值块；因双值键只存在于 `:root,.dark` 与 `.light` 一对块中，裸 :root 源序无关紧要，"只允许一对主题块"从纪律升级为结构不可能——b1-4 断言守卫）。

① 删除现 `:root` 域 token 块（:74-94 的 handle/edge/controls/shadow/z-panel 与 :96-106 的 ve 块、:108-113 的 vw 卡块——保留 :118-121 几何 px 块）。② 在 `:root,.dark` 块（:15-34）尾部 `--fw-overlay-3` 之后追加：

```css
  /* ===== C8 画布域 token（D1a 双值化，spec 2026-09-20 §8.1；深值=现状冻结字节等值） ===== */
  --canvas-board-bg: #000000;
  --canvas-board-dot: #555555;
  --canvas-controls-bg: rgb(38, 38, 38);
  --canvas-controls-border: rgb(54, 54, 54);
  --canvas-controls-text: rgb(247, 247, 247);
  --canvas-controls-hover: rgba(255, 255, 255, 0.08);
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
  --canvas-handle-bg: #6B7280;
  --canvas-handle-icon: #FFFFFF;
  --canvas-handle-hover-bg: #111827;
  --canvas-handle-hover-icon: #FFFFFF;
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
  background: var(--fw-bg);   /* C8 D1a：#141414 = --fw-bg 深值字节等值 */
  color: var(--fw-text);      /* #e2e8f0 同上 */
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}
```

② `.tiptap-content` 族（:130-200）与 `.editor-scroll`（:218-235）、`PromptInput.css` 28 处、`NodeHandle.css` 1 处：**深值规则原样保留，文件尾追加 `.light` 作用域覆盖块**（特异性 (0,1,1) > (0,1,0) 源序无关，天然生效）。index.css 尾部追加：

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

`PromptInput.css` / `NodeHandle.css` 同法：文件尾追加 `.light` 前缀覆盖组（逐条对照原深值声明：面色→`var(--fw-surface-dim)`/#f0f1f2、边→`var(--fw-border)`、文字→`var(--fw-text)`/dim 阶梯、hover 蒙层→`rgba(0,0,0,0.06)`；`--canvas-handle-*` 消费处直接用 Task 12 ② 的浅值 token，无需覆盖）。每条覆盖在 `canvas-migration-registry.json` adjudications 登记一行（file:line、深值、浅值、裁定依据 P6/通道）。

- [ ] **Step 5: b2 registry 死键删除登记 + B0 json 三族重裁定标注**

`b2-migration-registry.json` meta 旁新增：

```json
 "c8DeadTokenRemovals": [
  { "key": "--canvas-controls-active", "removedAt": "D1a", "why": "0 消费死 token（spec §8.1）" },
  { "key": "--ve-text-control", "removedAt": "D1a", "why": "0 消费死 token；index.css:103 var 间接链随 D1a 块删除同 commit 消失（与 Task 12 Step 2 口径一致，非 D1b）" }
 ],
```

`domain-token-adjudication-B0.json`：`--canvas-handle-*/--edge-*/--canvas-shadow-*` 三族 neverMerge 条目改标 `re-adjudicated-C8-D1a`（前提"画板恒深域"消失，已双值化）；`--z-panel` 维持永不并入（z-index 非颜色）；过期快照行（AddNodeMenu 15 处/HistorySidebar 2 处）订正为现状（AddNodeMenu.tsx:305 仅剩 --canvas-shadow-menu）。

- [ ] **Step 6: 跑绿（b0/b1/探针/c0 + vitest）**

```bash
cd /d/flowweb/apps/web && npx playwright test e2e/b0-token-blocks.spec.ts e2e/b1-token-migration.spec.ts e2e/d-segment-probes.spec.ts e2e/c0-theme.spec.ts && npx vitest run
```

Expected: 全绿。d-segment-probes 各探针复核仍为 D0-0 钉值（含「CanvasTopBar 已连接前景」rgb(21,128,61)——--fw-accent-text 浅值 B0 既有，D1a 无翻转，本段复核即可勿"制造"变化）。

---

## Task 13（D1a）: 段验收（深档 0 diff）+ commit

- [ ] **Step 1: segcheck-D1a 零 diff**

```bash
cd /d/flowweb/apps/web && COLLECT_BASELINE=1 BASELINE_DIR=segcheck-D1a npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D --after segcheck-D1a --out e2e/audit/baseline-diff-segcheck-D1a; echo "exit=$?"
```

Expected: `exit=0`、unexpectedTotal=0（D1a 深档字节零变更——body var 等值、tiptap 深规则未动、域 token 深值冻结、ve 4 处恒值等值）。清理 segcheck 产物。

- [ ] **Step 2: 全门禁 + commit**

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs
cd /d/flowweb && git add apps/web/src/index.css apps/web/src/pages/canvas/video-editor/components/AssetPanel.tsx apps/web/src/pages/canvas/video-editor/components/PreviewPlayer.tsx apps/web/e2e/b0-token-blocks.spec.ts apps/web/e2e/b1-token-migration.spec.ts apps/web/e2e/d-segment-probes.spec.ts apps/web/e2e/audit/b2-migration-registry.json apps/web/e2e/audit/canvas-migration-registry.json && git commit -m "feat(web): C8 D1a 定义层双值化——域 token 入 :root,.dark/.light 唯一块对(board-bg/dot 新增+controls/handle/edge/shadow/ve/vw 双值+死键 controls-active/ve-text-control 删)+ve 媒体侧拆恒值键(thumb-base #363636/preview-base #141414 字节等值 4 处)+手写 CSS 块 .light 覆盖(tiptap/editor-scroll/PromptInput/NodeHandle/body var 等值)+b0 B0-6 域 token 值断言/b1 B1-4 块唯一性源序；深档 0 diff：segcheck-D1a×before-D 实证"
```

---

## Task 14（D1b-a）: --ve-accent-text 拆档 + 8 处文字钮改指 + ExportModal Progress 实测

spec §9.2①（P9）。**本段起深色档 diff 由 differExpectedPairs 配对吸收，未配对=失败。**

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

（hover .08→.10 只改静态值——differ 快照不含 hover 态、无采集 diff，登记进 adjudications 说明即可；**单次登记规则**：AssetPanel ③ 的改指不重复登记此 diff。② 收敛清单另含 Task 8 登记的 TopActionBar `BTN` `bg-[rgba(255,255,255,0.04)]`→`bg-overlay-1`（0.04→0.05，深档微变随本段配对吸收——同栏视觉一致补收）。）

- [ ] **Step 2: 等值键并域（深档零 diff，无需配对）+ 六键删除**

先枚举：

```bash
cd /d/flowweb/apps/web && grep -rn "var(--ve-panel)\|var(--ve-text)\|var(--ve-bg)\|var(--vw-card" src/ --include="*.tsx" --include="*.css" | grep -v "\.test\." | grep -v "\.spec\." | grep -v "__tests__"
```

机械替换（深值全等，浅档首次一致）：
- `var(--ve-panel)` → `var(--fw-surface-dim)`（14 处：AssetPanel:55、EditorTopBar:21、PropertiesPanel:74/:81/:138、PreviewPlayer:79、ClipBlock:88、TimelineRuler:47、TrackRow:33/:53、TimelinePanel:280/:285/:292/:307）
- `var(--ve-text)` → `var(--fw-text)`（全部命中——**审核实测 .tsx 消费 30 处**，spec/初稿记 34 含 index.css 定义口径，以 grep 实测为准）
- `var(--ve-bg)` → `var(--fw-bg)`（1 处：VideoEditorShell:134——**若 grep 得 2 处说明 D1a Step 3 漏执行（PreviewPlayer:64 应已换 --ve-preview-base），停手回查**；spec 记 2 处系 D1a 前口径，以实测为准）
- `var(--vw-card-bg)` → `var(--fw-surface)`、`var(--vw-card-border)` → `var(--fw-overlay-2)`、`var(--vw-card-border-hover)` → `var(--fw-overlay-3)`（VideoCard.tsx 内，以 grep 实测为准）

随后 index.css 两块删六行：`--ve-bg/--ve-panel/--ve-text/--vw-card-bg/--vw-card-border/--vw-card-border-hover`。**`--ve-text-dim` 与 `--ve-border` 保留勿删**：前者 19-22 处消费（浅值 D1a 已落 `#4b5563`，spec §9.1 裁定"独立键"——勿顺手并入 dim-3，其深值 rgba(226,232,240,.6) 与 dim-3 的 rgba(255,255,255,.6) computed 字面不同、并域即深档未登记 diff）；后者按 ② 仅收敛值（收敛后与 --fw-border 双档同值，是否归并删键留作实施裁定登记——本计划按 spec §9.2② 字面保留键）。b0 DOMAIN 三处同步删对应 6 行。

**配套修订（实施裁定，登记 adjudications）**：`a0-collect-baseline.spec.ts:250` ve 壳探针改读 `--fw-bg`，**D1b 窗口内期望保持深值**（ve 壳根 .dark 岛到 Task 21 才拆——壳内 --fw-bg 仍 #141414、壳根底 rgb(20,20,20)；探针 id 同步去 "--ve-bg自持" 改 "--fw-bg@壳岛"），Task 21 岛拆除时才翻浅为双断言。

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
    expect(norm(state.contentBg), '[G8①] 面底 var(--fw-surface) 浅值 #ffffff').toBe('#ffffff');
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
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs && COLLECT_BASELINE=1 BASELINE_DIR=segcheck-D1b npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D --after segcheck-D1b --out e2e/audit/baseline-diff-segcheck-D1b; echo "exit=$?"
```

Expected: 全门禁绿；diff `exit=0` 且 dExpectedGate absorbed>0、unexpected=0——全部 diff 与 §9.2 总清单配对命中（① rgb(108,92,231)→rgb(155,140,247)；② rgb(54,54,54)→rgb(51,51,51)；⑤ 等值并域零 diff）。清理 segcheck 产物（**.json/.md 一起删**；D2 像素参照由 Task 17 的 Playwright 快照工装自足承担——`--update-snapshots` 在 D2 改码前（即本任务验收后的 HEAD）落参照，无需 png 副本）：`rm -rf e2e/baseline/segcheck-D1b e2e/audit/baseline-diff-segcheck-D1b.json e2e/audit/baseline-diff-segcheck-D1b.md`。

- [ ] **Step 5: commit**

```bash
cd /d/flowweb && git add apps/web/src/components/layout/WeChatFollowModal.tsx apps/web/e2e/c0-theme.spec.ts apps/web/e2e/d-segment-probes.spec.ts apps/web/e2e/audit/c5-portal-census.json && git commit -m "feat(web): C8 D1b④ WeChatFollowModal 原子对拆岛——删 darkAlgorithm+rootClassName dark 改跟随(var(--fw-surface) 面底)+G8① 反转(无岛类/浅值/defaultAlgorithm 判据 ch<180)+探针翻浅+census 条目退出；D1b 段验收：segcheck-D1b diff 全配对 absorbed>0 unexpected=0"
```

---

## Task 17（D2）: CanvasView colorMode 翻转 + 板面三机制 + 镜像断言 + 探针翻转

spec §10.1/10.3/10.4/10.5/10.6。**执行窗口纪律：本任务与 Task 18 连续收口，期间禁止浅色档验收画布（§13.3）。**

**Files:**
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx:341-394`
- Modify: `apps/web/src/pages/canvas/components/CanvasView.test.tsx:90-100`
- Modify: `apps/web/e2e/a0-collect-baseline.spec.ts`（:220-221 探针改造 + probeFlip helper）
- Modify: `apps/web/e2e/d-segment-probes.spec.ts`（D-1 组翻浅）

- [ ] **Step 1: 建像素 diff 对账工装（e2e/d2-board-pixeldiff.spec.ts，先取 D1b 参照）**

```ts
// C8 D2 画板像素对账（spec §10.2/§10 验收）：深色档以 D1b 后 checkout 为参照 0 diff（toHaveScreenshot
// maxDiffPixels:0 + animations disabled）；浅色档断 xyflow 皮肤变量取值（翻转正确性，非 0 diff——D2 本身就是翻转）。
// 基线采集：D2 改码前 `npx playwright test e2e/d2-board-pixeldiff.spec.ts --update-snapshots` 落参照。
import path from 'node:path';
import { test, expect } from '@playwright/test';

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
    await expect(page).toHaveScreenshot('d2-board-dark.png', { maxDiffPixels: 0, animations: 'disabled', caret: 'hide' });
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

Expected: 深档用例 PASS（同 HEAD 自比 = 0 diff，证快照确定性成立）；**浅档用例此刻红属预期**（wrapper 仍 colorMode 钉深）——参照快照随 D2 commit 提交，浅档用例随 Step 2 转绿。**工装加固三律（防参照被一次 `--update-snapshots` 静默抹掉）**：① **同 HEAD 连跑 3 次全 0 diff** 才算工装可信（一次通过可能是巧合）；② 参照快照落盘即**固化**：`cp` 到 `e2e/audit/d2-ref-board-dark.png` + 记 sha256 到 `e2e/audit/d2-ref-board-dark.sha256`（后续任何 diff 运行前校验 hash——"红了就 update"是本工装唯一失效路径，固化后 update 会留指纹）；③ **生成参照只允许 `-g "深档"` 限定**（浅档用例 update 会把浅档像素写进参照名下）。若深档自比 3 次有任一非 0：**判定"像素工装不达标准"——写明噪声源，降级为附件证据（截图归档人工比对），不许调 maxDiffPixels/mask 凑绿**；深档回归改由 d2-xy-probes computed 值 + --xy-* 复测表承担，登记 adjudications。

- [ ] **Step 2: CanvasView 翻转（实现）**

`CanvasView.tsx`：import 区加 `import { useTheme } from '@/stores/themeStore';`；组件体内（return 前）加 `const { mode } = useTheme();`（唯一例外：节点/面板组件禁 useTheme，CanvasView 是 colorMode 源头，spec §11.1）。改三处：
- `:377` `className="bg-[#000000]"` → `className="bg-[var(--canvas-board-bg)]"`（**必须留在 Tailwind utility 层**——产物 CSS 实证 .react-flow 字节 0 < .bg-[#...] 字节 50943，同特异性源序 utility 胜；移 inline/删则 dark 皮肤 `--xy-background-color-default:#141414` 复现）。
- `:378-379` 注释改写 + `colorMode="dark"` → `colorMode={mode}`。
- `:382` `<Background ... color="#555555" ...>` → `color="var(--canvas-board-dot)"`（xyflow 写内联 `--xy-background-pattern-color-props`，CSS var 代换——Step 4 像素实证）；`bgColor="transparent"` 保留不动。
- `:384-394` MiniMap 本段不动（内联 JS 色 D3 清单双值化；nodeColor 函数 prop 的 var() 不保证生效——spec §10.5）。

- [ ] **Step 3: 镜像断言 + a0 探针 + d-segment 探针翻转（同 commit）**

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
      await probeInvariance(page, 'canvas-html根--fw-bg翻浅(注入生效)', () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fw-bg').trim()), '#f7f8fa');
      // C8 D2 改视觉真值 + 反补岛镜像守卫（spec §10.3/§12.2 v1.3 分级①）
      await probeFlip(page, 'canvas-画板wrapper板底翻浅(视觉真值)', () => page.evaluate(() => getComputedStyle(document.querySelector('.react-flow')!).backgroundColor), 'rgb(245, 245, 245)');
      const mirror = await page.evaluate(() => {
        const wrapper = document.querySelector('.react-flow')!;
        const f = (cl: DOMTokenList) => Array.from(cl).filter((c) => c === 'light' || c === 'dark');
        return { wrapper: f(wrapper.classList), html: f(document.documentElement.classList) };
      });
      expect(mirror.wrapper, 'wrapper 主题类恰一个且等于 html 类（反补岛守卫）').toEqual(mirror.html);
```

afterAll meta 对象 `...(ANY_LIGHT ? { islandInvarianceProbes: LIGHT_PROBES, flipProbes: FLIP_PROBES } : {})` 两处（LIGHT 与 REAL_LIGHT 分支）。

③ `d-segment-probes.spec.ts` D-1 组：板底断言改 `rgb(245, 245, 245)`、网格点改 `#c8c8c8`（norm 后）；「gate 节点卡底」探针**不动**（D3-画板才翻）。

- [ ] **Step 4: 像素对账 + 门禁**

```bash
cd /d/flowweb/apps/web && npx playwright test e2e/d2-board-pixeldiff.spec.ts && npx playwright test e2e/c0-theme.spec.ts e2e/d-segment-probes.spec.ts e2e/b0-token-blocks.spec.ts && npx vitest run
```

Expected: 深档像素 0 diff（参照=Step 1 落的 D1b 快照）；浅档 xy 变量复测绿；c0 G4 video-editor 岛用例仍绿（ve 壳岛 D3 才拆）。

- [ ] **Step 5: commit**

```bash
cd /d/flowweb && git add apps/web/src/pages/canvas/components/CanvasView.tsx apps/web/src/pages/canvas/components/CanvasView.test.tsx apps/web/e2e/a0-collect-baseline.spec.ts apps/web/e2e/d-segment-probes.spec.ts apps/web/e2e/d2-board-pixeldiff.spec.ts apps/web/e2e/d2-board-pixeldiff.spec.ts-snapshots/ && git commit -m "feat(web): C8 D2 colorMode 翻转——CanvasView colorMode={mode}(唯一 useTheme 例外)+板底 bg-[var(--canvas-board-bg)] 留 utility 层+网格点 var(--canvas-board-dot) 代换+镜像断言防常量化/防补岛+a0:221 探针改视觉真值 probeFlip+D 段探针翻浅；深档像素 0 diff 实证(d2-board-pixeldiff maxDiffPixels:0×D1b 参照)+浅档 --xy-* 复测登记"
```

---

## Task 18（D2）: selection 钉值规则级裁定 + 性能探针（render 计数，提前至 D2）+ ProcessSnapshot 不变式登记 + 段验收

**Files:**
- Modify（条件）: `apps/web/src/index.css:207-216`
- Create: `apps/web/src/pages/canvas/components/CanvasView.theme-perf.test.tsx`
- Modify: `apps/web/e2e/d-segment-probes.spec.ts`（D-7 规则级探针）
- Modify: `apps/web/e2e/audit/canvas-migration-registry.json`（adjudications 登记）

- [ ] **Step 1: selection 钉值裁定（规则级探针——门禁画布不渲染选中框，像素 diff 无信号不可判）**

在 d-segment-probes.spec.ts 加规则级探针（画板内挂同类元素读 computed，两档各记录）：

```ts
test('D-7 selection 钉值规则级探针（同类元素两档取值，先记基准再撤钉对照）', async ({ browser }) => {
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
      console.log(`[D-7/${theme}] ${JSON.stringify(style)}`);
      test.info().attach(`d7-selection-${theme}`, { body: JSON.stringify(style), contentType: 'application/json' });
    } finally { await ctx.close(); }
  }
});
```

跑一次记录**钉值在场**两档基准 → 临时注释 `index.css:212-216` **连同 :207-208（`.react-flow__nodesselection-rect { fill:none; stroke:transparent }`——多选视觉交由 SelectionBoxOverlay 的既有裁定）一并纳入考察，别只撤一半** → 重跑探针：两档值仍各自等于基准 = 钉值失效 → **删除两块**（light 皮肤按 colorMode 分支自绘）；某档值变 = 钉值仍承重 → 恢复并按差异项改画板根局部作用域写法（`.react-flow .react-flow__selection { … }`，禁全局 !important）。结论 + 两档**拖框/选中节点截图目检**证据（像素工装覆盖不了交互态）登记 adjudications。

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

registry adjudications 追加：`ProcessSnapshot 整块=内容承载面恒深（spec §10.7）：:89 colorMode="dark" 保留、:91 网格点 #3a3a3a 保留（勿统一到 --canvas-board-dot——那会引入 #555555≠#3a3a3a 深档 diff）、:96 bg-black/60 中性遮罩留`。

- [ ] **Step 4: D2 段验收**

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs && COLLECT_BASELINE=1 BASELINE_DIR=segcheck-D2 npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D --after segcheck-D2 --out e2e/audit/baseline-diff-segcheck-D2; echo "exit=$?"
```

Expected: 全绿；diff=已登记配对吸收 + unexpected=0。清理 segcheck 产物（**.json/.md 一起删**）。

- [ ] **Step 5: commit（与 Task 17 连续收口完成，板面批次即 D3-画板紧接开工）**

```bash
cd /d/flowweb && git add apps/web/src/index.css apps/web/src/pages/canvas/components/CanvasView.theme-perf.test.tsx apps/web/e2e/d-segment-probes.spec.ts apps/web/e2e/audit/canvas-migration-registry.json && git commit -m "feat(web): C8 D2 收口——selection 钉值规则级裁定(同类元素探针两档基准→撤钉对照+:207-208 一并考察，结论+目检证据登记)+render 计数性能探针提前落 D2(mock 真实 TextNode+双向断言)+ProcessSnapshot 内容域不变式登记+D2 段验收 diff 全配对；D2↔D3 板面批次连续收口纪律生效"
```

---

## Task 19（D3 前置）: CreditsDropdown 浅色稿 + no-theme-utility 扩规则 + 白名单粒度升级

**Files:**
- Create: `docs/superpowers/specs/2026-09-20-creditsdropdown-light-draft.md`（浅色稿）
- Modify: `apps/web/scripts/eslint-rules/no-theme-utility.js`
- Modify: `apps/web/e2e/audit/canvas-migration-registry.json`（whitelistKeeps 镜像）

- [ ] **Step 1: 产出 CreditsDropdown 浅色稿（ui-ux-pro-max，P5）**

调用 ui-ux-pro-max skill，输入现状精确描述（spec P5）：基底=inline 深色渐变（CreditsDropdown.tsx:127 `linear-gradient(160deg, #111111, #171717, #101828)`）+ :271 `bg-zinc-900` 图标底；重做这两处浅色版；:267 邀请卡 `bg-white + hover:bg-zinc-100` 与 `bg-black/[.06]` 族**保留不 token 化**（通道 3）。深色档现状冻结（实现期 mode 分支）。产出写入 `2026-09-20-creditsdropdown-light-draft.md`（浅色稿值、层级、与 login 营销浅色设计语言的参照关系）并 commit。

- [ ] **Step 2: 扩 no-theme-utility 九前缀族（spec §11.1）**

`no-theme-utility.js` 改三处：

① 正则（:25-26）扩前缀族：

```js
const THEME_UTILITY_RE =
  /(?:^|[\s"'`])((?:[a-zA-Z][\w-]*:)*)!?(text|bg|border|ring|divide|fill|stroke|from|via|to)-(?:white|black)(?:\/\d{1,3})?(?=$|[\s"'`])/u;
```

② 白名单升级为「目录条目（string=全属性族放行）+ 精确文件条目（{glob, allow:['bg',...]}）」双形态——**现状 18 条一条不丢**（14 目录 + 4 精确文件，其中 CreateCanvasCard/TeamDetail 两条必须补回为精确条目，否则升级即红）：

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
  { glob: 'src/pages/home/components/CreateCanvasCard.tsx', allow: ['text'] },      // 黑字随底（升级前整文件条目，勿丢）
  { glob: 'src/pages/team/TeamDetail.tsx', allow: ['text'] },                      // 同上
  // —— C8 新增精确条目 ——
  { glob: 'src/pages/canvas/components/CreditsDropdown.tsx', allow: ['bg'] },       // :267 邀请卡 bg-white（P5 通道 3 明文保留）
  { glob: 'src/pages/canvas/components/ConfirmModal.tsx', allow: ['bg'] },          // 白卡（通道 3）
  { glob: 'src/pages/canvas/components/SaveAsTemplateDialog.tsx', allow: ['bg'] },  // 白卡（通道 3）
  { glob: 'src/pages/videos/ProcessSnapshot.tsx', allow: ['bg', 'text', 'border'] }, // 内容承载恒深整块（spec §10.7）——videos 目录摘除时同 commit 补入
];
```

③ **统一匹配入口（防两套判定 + 模块加载崩溃）**：现状 `WHITELIST_RES = THEME_UTILITY_WHITELIST.map(globToRe)`（:63）与 `isWhitelistedPath`（:71-74）在模块顶层执行——元素变对象后 `globToRe` 对对象调 `.replace` 直接 TypeError。改法：删 `WHITELIST_RES` 与 `isWhitelistedPath`（其唯一消费者是 create() 内 :94，一并接管），统一为：

```js
/** 条目归一：string → {glob, allow:null(全放行)}；{glob,allow} → 原样 */
const normalizeEntry = (e) => (typeof e === 'string' ? { glob: e, allow: null } : e);
const WHITELIST_ENTRIES = THEME_UTILITY_WHITELIST.map(normalizeEntry);

/** 匹配 + 属性族判定：返回 null=不在白名单；返回 Set|null = 放行集（null=全放行） */
function whitelistAllowFor(filePath) {
  const rel = toAppRelPosix(filePath);
  for (const e of WHITELIST_ENTRIES) {
    if (globToRe(e.glob).test(rel)) return e.allow; // null=目录条目全放行
  }
  return undefined; // 不在白名单
}
```

④ `create(context)` 改用统一入口 + **串内全匹配判定**（⚠ 只取首个匹配再放行整节点 = 首个家族在 allow 里时同串真违例全部漏报——比升级前更弱；判定必须"串内全部匹配的家族都在 allow 内才放行"，并对模板串**逐 quasi 收集**）：

```js
// 全局扫描形态：g 标志 + lookaround 边界（(?:^|[\s"']) 在 matchAll 下会吃掉一个字符致相邻 token 漏匹配）
const GLOBAL_THEME_UTILITY_RE = /(?<![\w-])((?:[a-zA-Z][\w-]*:)*)!?(text|bg|border|ring|divide|fill|stroke|from|via|to)-(?:white|black)(?:\/\d{1,3})?(?![\w-])/gu;

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
```

断言 message.id 与命中数（Linter.verify 直出）。跑 `node scripts/lint-gate.mjs` 确认全仓无新红。

- [ ] **Step 3: 跑扩规则拿 working list 并逐条处置**

```bash
cd /d/flowweb/apps/web && node scripts/lint-gate.mjs
```

预期目录白名单外新增红 ≈25 处（bg 18+text 7；**以脚本产出为准**）。逐条裁定（每条登记 registry whitelistKeeps 或直接迁移）：
- **token 化**：跟随域 chrome 上的 `text-white`→`text-text`/`text-on-accent`、`bg-white/NN`→`bg-overlay-N`（B2 同款五通道映射）；
- **通道 3 合法面精确豁免**：中性 scrim（`bg-black/50` canvas/page.tsx:313、`bg-black/60` BaseFullscreenModal.tsx:70 等）与白卡面 → 加 `{glob, allow:['bg']}` 条目+理由；
- **通道 4 内容面**：媒体垫底 `bg-black` → 保留字面+精确豁免（内容承载）。

处置至 lint-gate PASS（此为 D3 开工前置门禁漏洞修补，目录白名单**本任务不摘**——逐域摘除在 Task 20-24）。

**摘除纪律（每域原子，缺一即红）**：Task 20/21/22/24 每摘一条目录，**同 commit** 必须补该域内合法保留位点的 `{glob, allow}` 精确条目（已知：videos 域 ProcessSnapshot 整块恒深、PlayView 压画面 text-white 族、封面垫底 bg 族；ve 域 ExportModal text-on-accent 迁移后无需；nodes 域 GridIcon/mini 垫底/标注调色板族）并同步 `canvas-migration-registry.json` whitelistKeeps。**粒度限制承认**：文件+属性族仍会放走同文件同族未来回归（给 PlayView 开 allow:['text'] 后，将来在 PlayView 新写 text-white 不会被拦）——补偿 = d-segment 探针（VideoCard 前景已探针化，同款随各域补）+ B6 目检。

- [ ] **Step 4: registry 镜像 + commit**

`canvas-migration-registry.json` whitelistKeeps 与白名单同步。commit：

```bash
cd /d/flowweb && git add docs/superpowers/specs/2026-09-20-creditsdropdown-light-draft.md apps/web/scripts/eslint-rules/no-theme-utility.js apps/web/e2e/audit/canvas-migration-registry.json apps/web/src/ && git commit -m "feat(web): C8 D3 前置——CreditsDropdown 浅色稿出稿(ui-ux-pro-max,P5)+no-theme-utility 扩九前缀族(text/bg/border/ring/divide/fill/stroke/from/via/to × white/black)+白名单粒度升级(文件+属性族 {glob,allow})+白名单外 working list ≈25 处逐条裁定(token 化/通道 3 精确豁免/通道 4 内容面豁免)"
```

---

## Task 20（D3-videos）: 播放壳域原子对

spec §11.2 P3 专项 + E 表（两个全屏查看器恒深废止/O6② 死类删除/c7 #1#2#3 失效改写前置）。

**Files:**
- Modify: `apps/web/src/pages/videos/VideoPlayerModal.tsx:58`（DOM 拆分）+ `PlayView.tsx`/`ProcessView.tsx`/`CarouselBar.tsx`/`VideoCard.tsx`（chrome 迁移；ProcessSnapshot 不动）
- Modify: `apps/web/src/components/BaseFullscreenModal.tsx` + `ImageFullscreenViewer`/`VideoFullscreenViewer`（跟随 + b3 落值双主题化）
- Modify: `apps/web/src/pages/videos/__tests__/VideoPlayerModal.test.tsx:168-173`（⚠ videos 域测试在一等 `__tests__/` 目录）
- Modify: `apps/web/e2e/c0-theme.spec.ts`（G8②③ 反转 + 文件头/videos 叙事）
- Modify: `apps/web/scripts/eslint-rules/no-theme-utility.js`（摘 videos 目录条目）

- [ ] **Step 0: viewer 逐元素裁定表（M5——两个全屏查看器混两类元素，不先划清就动手会"浅底浮层压黑画面"观感反转）**

先产出裁定表（登记 adjudications，逐元素归通道）：`ImageFullscreenViewer:239 bg-black`（全屏遮罩=媒体垫底→第四通道恒深）**与 `:145 bg-[#0A0A0A]`（图片区垫底→恒深，两文件同款各一处）**、`VideoFullscreenViewer:106 bg-[#0A0A0A]`（视频区垫底→恒深）、`:91 bg-[#1C1C1C]/80`（浮在媒体上的面板→第四通道）、`:186 bg-[#646464] + border-white/10`（按钮 chrome→跟随）；两文件的 `::-webkit-scrollbar-thumb`（:23-24/:20-21 `<style>` 块，registry styleBlocks 分区在册）随 chrome/恒深归属逐条定。表成后再动 Step 1-3。

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

- [ ] **Step 2: 域内 chrome 迁移（四通道逐条）+ 状态分支字面清单（M2）**

按 registry `videosDomain.files` 清单核销，机械配方：
- chrome 面/字/边 → `bg-bg`/`bg-surface`/`text-text`/`border-overlay-2` 等 token 工具类；
- **压画面浮层恒定**（第四通道）：PlayView:69/:83 `from-black` scrim、`text-white/90`、`bg-black/70` 时长条——保留字面；
- `VideoCard` 封面占位底 `#262626`（:16）保留（P6 内容垫底；a0:200 探针持续 rgb(38,38,38)）；
- `CarouselBar`/`ProcessView` chrome 部分迁移（ProcessSnapshot **整块不动**）。
- **状态分支字面清单（M2——gate fixture 恒有数据，空态/错误态/加载态不在门禁渲染路径上）**：`grep -n "bg-white\|text-white" src/pages/videos/VideosPage.tsx src/pages/videos/ProcessView.tsx` 逐条裁定（VideosPage:53 bg-white/5、:56/:58 text-white/40 空态；ProcessView:45/:67/:69/:71）——空态白系字面浅档=白字白底不可见，随本域迁移并列入 B6 必看项。

每条登记 registry adjudications（file:line/通道/值）。

- [ ] **Step 3: 全屏查看器跟随 + O6② b3 处置订正（E 表实测改判）**

**订正（P5）**：`text-popover-foreground/text-muted-foreground/focus-visible:ring-ring` 在 src **0 处**——B3 轮已按 `b2-migration-registry.json` b3DeadClassDisposal（:1131-1181）处置为 `replaced-literal`（text-neutral-200/text-neutral-400/ring-white/40，宿主即两查看器）。**本步真实工作 = 把 B3 的"恒深落值"改为双主题真值**（按 Step 0 裁定表：chrome 处→token/双值、压画面处→恒深保留），**不是删类名**；登记档以 b2-migration-registry.json 为准（初稿/spec 引 b3-alldead-list.json 系过期快照，spec 随本 commit 走 v1.5.1 变更登记订正；计数订正 ring-ring 2 处非 4）。**同 commit 撤销 b2:1136 domainRule**（"全屏查看器=画布恒深域禁 --fw-*"——E 表废止项，不撤销则 D3 后有人按它把 viewer 又钉回深色），改标 `revoked-C8-D3（跟随域，逐元素裁定见 registry）`。

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
    expect(norm(state.shellBg), '[G8②] 壳根底=bg-bg 浅值').toBe('#f7f8fa');
  } finally { await ctx.close(); }
});
```

③ G8③（:556-579）重写：壳岛废止后「html.light × 壳浅 × 壳内 LoginModal 浅」同色双层——保留 LoginModal 岛断言（islandLight 命中 + #f7f8fa），壳半断言改"壳根同为浅值"（双浅对照），删"双岛相反"叙事（G8③ 语义随 E 表消亡）。④ c0 文件头组2/组8 注释与 G7 videos 叙事（:379/:445 注释）同步改写。

- [ ] **Step 5: 白名单摘除（本域原子）+ 门禁 + commit**

`no-theme-utility.js` 删 `'src/pages/videos/**'` 行（net -1 目录）——**同 commit** 生效 Task 19 预置的 `{glob:'src/pages/videos/ProcessSnapshot.tsx', allow:['bg','text','border']}` 并补 PlayView 压画面族/封面垫底族的 `{glob, allow}` 条目；registry whitelistKeeps 镜像；域纪律复核：`grep -rn "text-white\|bg-white" src/pages/videos/ | wc -l` 命中数=精确豁免登记数，其余 0。

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs
cd /d/flowweb && git add apps/web/src/pages/videos/ apps/web/src/components/BaseFullscreenModal.tsx apps/web/src/pages/canvas/components/nodes/ apps/web/e2e/c0-theme.spec.ts apps/web/scripts/eslint-rules/no-theme-utility.js apps/web/e2e/audit/ && git commit -m "feat(web): C8 D3-videos 播放壳域原子对——viewer 逐元素裁定表(M5 含 Image:145 #0A0A0A)+DOM 拆分(画面垫底独立+三条承重约束/壳根删 dark 类 chrome 化/浅档可见变化≈0 登记已知接受)+PlayView/ProcessView/CarouselBar/VideoCard 四通道迁移+空态白系清单(M2)+全屏查看器跟随+O6② b3DeadClassDisposal 落值双主题化(b2:1136 域规则撤销+档名/计数订正)+G8②③ 反转+videos 白名单摘除同 commit 补精确条目(net -1)；采集键集零影响实证：VideoPlayerModal 只在 /videos/:id 详情路由渲染、不在 8 采集页(采集 videos 页=/videos 列表)，DOM 拆分不触碰 stableKey——此注记不得援引为采集页内结构改动的先例(采集页内层级增删=dom: 键漂移=配对闸必红)"
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

grep 逐条按四通道裁定（chrome→--fw-*；内容承载→恒值键/字面；品牌紫→--ve-accent(-text) 档位；hover 提亮 `hover:text-white`（PreviewPlayer:91-:99）→ `hover:text-text` 浅档语义等价）。代表例：`PreviewPlayer.tsx:91` `hover:text-white` → `hover:text-text`；`ExportModal.tsx:245` `text-white`（填充钮白字）→ `text-on-accent`（深 #141414=--fw-on-accent 深值字节等值，浅档同值——**先查 on-accent 两档同 #141414 ✓ 零 diff**）。**消费 registry 盲区三分区**：ve 域命中的 `inlineStyle`/`rgbaClasses` 位点逐行核销（两 lint 规则都拦不到，清单是唯一核销依据）。逐条登记 adjudications。

- [ ] **Step 3: 断言反转（同 commit）**

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
      expect(norm(shellState.shellBg), '[G4/ve] 视觉层：壳根底=该浅值（bg-[var(--fw-bg)] 实渲染）').toBe('#f7f8fa');
  // …清理段保留…
});
```

② `a0-collect-baseline.spec.ts:250` 探针（Task 15 已改读 --fw-bg）定稿双断言：语义层 `--fw-bg` html.light 下 `#f7f8fa` + 视觉层壳根 `backgroundColor` 归一等于该浅值（不保留任何恒深方向断言）。③ d-segment D-4 探针：壳底断言改 `rgb(247, 248, 250)`；ve 面板底（EditorTopBar）探针翻 `rgb(240, 241, 242)`。④ E 表登记：c5-portal-census VideoEditorShell 岛条目 `exited-C8-D3`。

- [ ] **Step 4: 白名单摘除 + 门禁 + commit**

删 `'src/pages/canvas/video-editor/**'`（net -2 累计）。域纪律：`grep -rn "var(--canvas-" src/pages/canvas/video-editor/ | wc -l` = 0。

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs
cd /d/flowweb && git add apps/web/src/pages/canvas/video-editor/ apps/web/e2e/c0-theme.spec.ts apps/web/e2e/a0-collect-baseline.spec.ts apps/web/e2e/d-segment-probes.spec.ts apps/web/scripts/eslint-rules/no-theme-utility.js apps/web/e2e/audit/ && git commit -m "feat(web): C8 D3-ve 壳岛拆除原子对——VideoEditorShell 删 dark 类/darkAlgorithm 改继承 App+域内 8 源文件字面四通道核销(hover 提亮语义等价/on-accent 白字零 diff)+G4 反转(无岛+语义/视觉双断言)+a0:250 双断言定稿+D-4 探针翻浅+video-editor 白名单摘除(net -2)"
```

---

## Task 22（D3-画板批量）: 节点卡/工具条/底部面板/长尾 + VideoEditNode 三重变更 + #3a3a3a 族 + 白名单摘除

spec §11.2 VideoEditNode 专项 + §11.1 浅底重校清单 + P4/P10。**与 Task 18 之间禁止浅色档画布验收（§13.3 窗口在本任务收口）。**

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/timeline/block-colors.ts`（P10 叶子共享常量）
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoEditNode.tsx` + `ClipBlock.tsx:8-10`
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

- `:161` `border-[#F0F0F0]` → `border-overlay-1`（深档 rgba(255,255,255,0.05)≠#F0F0F0——有意变更登记）；
- `:163` `text-[#1F2329]` → `text-text`；`:170/:179` `text-[#6C5CE7]`/`disabled:text-[#C9CDD4]` → `text-[var(--ve-accent-text)]`/`disabled:text-text-dim-2`；`:173/:215` `text-[#86909C]` → `text-text-dim-3`；
- `:194` `bg-black`（mini canvas 垫底）**保留**（JS 通道 #000 经 VideoEditNode:129 复用 canvas-renderer——c3 census 已登记）；
- `:201` `bg-[#F2F3F5]` 轨道槽 → `bg-surface-dim`；`:214` `border-[#E5E7EB]` → `border-overlay-2`；
- GridIcon（:22-31）stroke `#6C5CE7` **保持字面**（v1.5 裁定：双档 4.86/3.43 ≥3，品牌图形档；SVG 属性 var() 不生效且不值当传 mode）。

differExpectedPairs 登记（深档有意变更）：`backgroundColor rgb(255,255,255)→rgb(30,30,30)`（卡壳）、`color rgb(31,35,41)→rgb(226,232,240)`（标题）等按 segcheck 实测逐对补；P10 三行 `backgroundColor`：`rgb(108,92,231)→rgb(91,124,250)`（image）、`rgb(149,222,100)→rgb(143,93,186)`（audio）、`rgb(255,214,102)→rgb(93,186,160)`（subtitle）。

- [ ] **Step 3: 画布长尾核销（registry canvasDomain 清单）**

**纪律（N4，先读）**：本步每位点的深档颜色变更都必须落 `differExpectedPairs`（`prop|before|after`）——**adjudications 只记理由，不参与 diff 吸收**（css-baseline-diff 只认 b2Pairs/dPairs）。若该位点不在 8 个采集页的渲染路径上（如 AnnotationToolbar、CreditsDropdown 浮层、隐藏状态分支），以"不可见→无 diff"为理由登记 adjudications，而非留空。

机械配方（每条登记 adjudications）：
- **节点卡 chrome**（ImageGen/Video/MultiImage/TextInput/Text/Storyboard 8 类卡壳）：白卡面/字/边 → `bg-surface`/`text-text`/`border-overlay-2`（深档白→深=P4 级有意变更，逐卡配对登记）；**TextInputNode 文本节点=内容容器整体跟随**（P6 判据"否"分支，浅色下变浅否则违背需求）；VideoEditNode `:170` 非 disabled 分支 `text-[#C9CDD4]` 与 `:179` `disabled:text-[#C9CDD4]` 分别落 `text-text-dim-2`/`disabled:text-text-dim-2`（禁用态色同键同改）；
- **媒体容器 checklist**（机械检查项）：`grep -rn "<img\|<video" src/pages/canvas/components/nodes/` 祖先链逐个核——每个媒体容器自持深底（透明 PNG/未加载/poster 未到不露浅底）；
- **悬浮工具条 6 个 + 底部面板 + CanvasToolbar**：只迁移**仍在用字面 `rgb(38,38,38)` 的位点**；**已 token 化的 19 处 --canvas-controls-* 消费（VideoHDPanel 8、VideoNodeToolbar 5+1、VideoTrimPanel 3、AssetPanel 3-hover）保持 token 消费不二次改写**（D1a 双值化即已翻转；D3 再改 bg-surface-dim 是第二次改写——深档字节等值但与"一处变更一条登记"撞车、registry 会出同位点两条裁定）。**CanvasToolbar.tsx 自身四处**：`:15 BTN_BG rgb(38,38,38)`→`var(--fw-surface-dim)`、`:16 BTN_BG_ACTIVE rgb(58,58,58)`→**#3a3a3a 族 A 组第 6 处（与 :130/:138/:144 三条测试断言同键一次改齐，漏则断言指向未改源）**、`:51 容器 border rgb(54,54,54)`→`var(--canvas-controls-border)`、`:44 .tb-btn:hover rgb(78,78,78) !important`→**先拆 !important 再落 `var(--fw-overlay-2)`**（合成值不等值=有意变更登记 pairs）；`:91 顶部"画板域恒深"注释同 commit 订正。CanvasToolbar.test 断言随改：**`rgb(38,38,38)` 4 条（:92/:128/:136/:146）+ `rgb(58,58,58)` 3 条（:130/:138/:144）**；
- **白系 alpha className 族（M1）**：`hover:bg-[rgba(255,255,255,0.08)]` 等（AnnotationToolbar:135/:170、EraseBottomToolbar:123/:129、EditToolbar:131/:155/:370 + 常量 EditToolbar:95/:128、AnnotationToolbar:111、TransformToolbar:58/:59）→ `hover:bg-overlay-2` 族双值化——registry rgbaClasses 分区逐行核销 + 1-2 条 hover/active computed 探针（浅色档 hover 无反馈=功能性不可辨）；**JSX 内联 `<style>` 块 6 文件（M4）**：CanvasToolbar:24（含 `.tb-btn:hover rgb(78,78,78) !important` 会顶掉 token hover——先拆 !important）、EditToolbar:349、ImageNodeToolbar:430、TransformToolbar:139、ImageFullscreenViewer:130、VideoFullscreenViewer:90——registry styleBlocks 分区逐文件裁定（tooltip 底/hover/scrollbar-thumb）；
- **selectionTokens.ts 4 处 + StoryboardGroupRenderer #333 组边框/#fffff0 分镜格**：交互可视性双主题值 + 两态可见性实测断言（StoryboardGroupRenderer.test:92/101 改双主题可见性断言，防浅色下选中框消失）。**`--xy-selection-*` 全仓零消费——不列迁移项**（selection 钉值已由 Task 18 D-7 规则级探针+裁定覆盖，初稿两处指涉同一件事）；
- **#3a3a3a 族**（spec §11.1 分组）：A 组 size-7 图标钮 ×5（RunButton:14/AudioConfigPanel:270/TextConfigPanel:270/VideoHDPanel:220/VideoConfigPanel:467）**+ CanvasToolbar.tsx:16 BTN_BG_ACTIVE（第 6 处）**同键一次改齐（按钮面 → surface-dim 系）；B 组 tooltip 底 ×2（GenerateCountSelector:30/VideoConfigPanel:432）同键一次改齐（**翻浅后其上 text-white 需同步改 text-text=P7 应用**）；C-F 四处按语义各自裁定勿塌键（C=MultiImageNode:292 徽章、D=TextNodeToolbar:228 文本节点默认底【内容容器】、E=TextNodeToolbar:239 划线色板、F=AudioWaveform:272 波形基线）；3 条测试断言同 commit（AudioConfigPanel.test:99 class*= 正则形态、VideoHDPanel.test:73）；**groups 域深面浮层点名**（浅色档防"深色小岛"）：GridSizeDropdown:24/:60、AspectRatioDropdown:43、SelectionBoxOverlay:93、StitchButton:161、NormalGroupRenderer:81（`#1a1a1a` 族菜单/条）——随本批 chrome 化；
- **MiniMap 内联 JS 色双值化**（CanvasView.tsx:384-394）：`style.backgroundColor 'rgb(50,50,50)'/'rgb(70,70,70)'` 走 `var(--canvas-controls-bg)/var(--canvas-controls-border)`（style 属性 var() 安全）；**nodeColor 是函数 prop 落 SVG 属性——禁 var()，直接 JS 分支取色**（CanvasView 已有 mode）：`nodeColor={() => (mode === 'dark' ? 'rgb(160, 160, 160)' : 'rgb(107, 114, 128)')}`；`maskColor rgba(0,0,0,0.35)` 中性遮罩保留；
- **动画类元素浅档可见性专项**：edge particles（opacity 动画）/播放头/吸附线——静态对比达标≠动画可见，逐个目检留档（evidence 附 test-results 截图）；
- **EraseCanvas 涂抹蒙版恒深**（第四通道）+ **OutpaintSelectionOverlay `bg-white/30` 网格线保留字面**（落媒体上）+ 标注调色板 #FF0000/#FFD700/#0066FF/#000000 黑笔 + userColor() 恒定（P6 登记）。

- [ ] **Step 4: 探针翻转 + 禁 useTheme 验收 + 白名单摘除 + 门禁 + commit**

d-segment「gate 节点卡底」翻 `rgb(30, 30, 30)`。禁令验收 grep（spec §11.1）：

```bash
cd /d/flowweb/apps/web && grep -rn "useTheme" src/pages/canvas/components/nodes/ src/pages/canvas/components/groups/ | wc -l
```

Expected: 0（唯一例外 CanvasView colorMode={mode} 不在 nodes/groups 内）。删白名单 nodes/edges/groups 三条（net -4 累计——四目录全摘完成）。

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs && COLLECT_BASELINE=1 BASELINE_DIR=segcheck-D3-board npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D --after segcheck-D3-board --out e2e/audit/baseline-diff-segcheck-D3-board; echo "exit=$?"
cd /d/flowweb && git add apps/web/src/pages/canvas/ apps/web/e2e/ apps/web/scripts/eslint-rules/no-theme-utility.js && git commit -m "feat(web): C8 D3-画板批量——block-colors.ts 叶子共享常量(P10 统一 TRACK_COLORS→BLOCK_BAR，深档三行变色配对登记)+VideoEditNode P4 token 化(bg-surface 深卡/#E5E7EB 巧格等值/GridIcon 字面恒定/mini 垫底 JS 通道保留)+节点卡 8 类/工具条 6/底部面板/selectionTokens 双值+两态可见性断言+#3a3a3a 族 A/B 同键 C-F 分语义+媒体容器 checklist+动画可见性专项；白名单摘除 nodes/edges/groups(net -4 累计)；D3-board diff 全配对实证"
```

---

## Task 23（D3-chrome 专项）: 顶栏药丸 + CreditsDropdown 浅色实现 + AnnotationToolbar 五件套 + Lighting/Angle3D chrome

**Files:**
- Modify: `apps/web/src/pages/canvas/components/CanvasTopBar.tsx:129,143,147`（药丸）+ `CreditsDropdown.tsx`（mode 分支浅色稿实现）
- Modify: `apps/web/src/pages/canvas/components/nodes/AnnotationToolbar.tsx`（五件套 inline style——**零 lint 守卫，registry 显式清单 + B6 目检**）
- Modify: `apps/web/src/pages/canvas/video-editor/Lighting/*` 与 `Angle3D/*` 中的 chrome 文件（Modal/ControlPanel/ViewToggle/LightPresetButtons/AnglePresetButtons/Lighting 的 PromptInput）

- [ ] **Step 1: 药丸 chrome 化（P7 反例① 结案；四枚同批）**

CanvasTopBar 三处（:129/:143/:147）**+ ProjectTitle.tsx:64 第 4 枚**（逐字同款 `bg-[#1A1A1A]/90` 药丸，前景 text-text-dim-1 已 token——**并入本批勿留 Task 25**，否则收口时页面 3 浅 1 深）→ `bg-surface/90` 不可用（斜杠禁令）——改 `bg-surface backdrop-blur px-… rounded-full border border-overlay-2 shadow-lg`（不透明化+边 token 化；有意变更登记 `backgroundColor rgba(26,26,26,0.9)→rgb(30,30,30)` 配对）。前景已 token（text-text/text-dim 族/userColor 恒定）——P7 面/前景/边一起翻齐。c7 §1 #7 药丸恒深接受项结案标注（Task 25 的 ProjectTitle 仅剩其余字面）。

- [ ] **Step 2: CreditsDropdown 浅色实现（mode 分支，深档现状冻结）**

按 Task 19 浅色稿：组件内 `const { mode } = useTheme();`（CreditsDropdown 在 CanvasTopBar 域非 React Flow 节点，不受 §11.1 禁令），`:127` 渐变与 `:271` 图标底按 mode 分支——深档**字面原样保留**（字节等值守卫：differ 深档零 diff），浅档用稿值；`:267` 邀请卡族不动。有意变更（浅档）不产生深档 diff，浅色档经 B6 目检（Task 27）。登记 adjudications + differExpectedPairs（若浅档采集对照）。

- [ ] **Step 3: AnnotationToolbar 五件套（P7 反例② 专项）**

**纪律（N4 同 Task 22）**：本组件不在 8 采集页渲染路径（选中节点悬浮工具条）——深档变更以"不可见→无 diff"登记 adjudications；若浅色档采集对照时可见，则逐条落 pairs。

五件一起翻（原子性——同一视觉表面面/前景/边一起钉或一起跟）：
- `BAR_BG` 深底（组件常量）→ `var(--fw-surface)`；
- `:332` 恒白保存钮 → 填充 `var(--fw-accent)` + 字 `var(--fw-on-accent)`；
- `:230/:254` 白系选中环/分隔线 → `var(--fw-overlay-3)`/`var(--fw-border)`；
- `:135/:170` 白系 hover → `var(--fw-overlay-2)`；
- `COLOR_PRESETS` 含 `#000000` 黑笔**保留**（P6：用户在浅色主题下选黑笔=用户选择，显式登记）。

全部 inline style（:111/:135/:161/:170/:187/:199/:211/:230/:305/:317/:332）——no-theme-utility/no-color-hex 双规则都拦不到 style 对象，**逐行登记 registry `inlineStylePartition` 显式清单**（C8 新分区，spec §11.1），核销靠清单+B6 目检。

- [ ] **Step 4: Lighting/Angle3D chrome 面板迁移（非目标收窄为渲染产物层，§11.2）**

迁移：LightingModal/ControlPanel/ViewToggle/LightPresetButtons、Angle3DModal/ControlPanel/AnglePresetButtons、Lighting 的 PromptInput。**勿动**（渲染产物白名单，registry renderWhitelist）：canvas-renderer.ts(+export worker)、Angle3DEngine.ts、LightingEngine.ts、ThreePreview.tsx、Angle3DPreview.tsx——同目录不等于同裁定，勿借目录逃逸。

- [ ] **Step 5: 门禁 + commit**

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs
cd /d/flowweb && git add apps/web/src/pages/canvas/ apps/web/e2e/audit/ && git commit -m "feat(web): C8 D3-chrome 专项——顶栏四枚药丸 chrome 化(CanvasTopBar 三处+ProjectTitle:64 同款同批，bg-surface+overlay-2 边，P7 反例①结案)+CreditsDropdown 浅色实现(mode 分支/深档字面冻结字节等值/邀请卡族保留)+AnnotationToolbar 五件套原子翻(token 化+黑笔保留，盲区 styleObjects 分区显式清单+不可见位点登记)+Lighting/Angle3D chrome 面板迁移(渲染产物 5 文件白名单勿动)"
```

---

## Task 24（D3-MaterialLibrary）: 白名单第 4 条摘除 + TSX 残余迁移

**Files:**
- Modify: `apps/web/src/components/MaterialLibrary/**`（10 个 TSX ≈77 处字面；CSS 已全量 token 化零改动）
- Modify: `apps/web/scripts/eslint-rules/no-theme-utility.js`（摘 MaterialLibrary 目录条目）
- Modify: `apps/web/e2e/audit/domain-token-adjudication-B0.json`（"原 family #3 恒深裁定废止"标注）

- [ ] **Step 1: TSX 残余按四通道迁移**

现状=纯摘除+字面迁移（无机制改动，**不必与 WeChatFollowModal 同批**）：MaterialLibraryModal.tsx:35-37 实测无岛类/无 ConfigProvider——本来就在跟随域；TSX 字面（hover 白系→`hover:bg-overlay-2` 族、面板深字面→token、封面占位恒深保留）。`text-dim-1` 消费点（Browser 侧）纳入浅底重校（浅档 dim-1 #9ca3af 对比 2.39:1 属刻意低层级——目检确认非缺陷）。
- [ ] **Step 2: 摘除 + 登记 + 门禁 + commit**

```bash
cd /d/flowweb/apps/web && grep -c "text-white\|bg-white" src/components/MaterialLibrary/*.tsx 2>/dev/null | grep -v ":0" ; node scripts/lint-gate.mjs && npx playwright test && npx vitest run
cd /d/flowweb && git add apps/web/src/components/MaterialLibrary/ apps/web/scripts/eslint-rules/no-theme-utility.js apps/web/e2e/audit/domain-token-adjudication-B0.json && git commit -m "feat(web): C8 D3-MaterialLibrary——白名单第 4 条摘除(纯摘除+字面迁移：Modal.css 已 token 化，TSX ≈77 处四通道核销)+原 family #3 恒深裁定废止登记(B0 json)；net -5 目录全摘完成"
```

---

## Task 25（D3 收口）: 浅底重校长尾 + 涌现登记同步 + registry 分区逐域核销

**Files:**
- Modify: `apps/web/src/pages/canvas/components/NodePalette.tsx`(#0f0f0f/#e0e0e0/#f7f7f7)、`ProjectTitle.tsx`(#1A1A1A)
- Modify: `apps/web/scripts/css-baseline-diff.mjs`（PAGE_REGISTRY_FILES 对应页数组同步——NodePalette/CanvasToolbar 等预期新位点预登记）
- Modify: `apps/web/src/router.tsx:48-50`（注释订正：板跟随主题）、`apps/web/tailwind.config.ts:9-10`（注释订正）
- Modify: `apps/web/e2e/audit/canvas-migration-registry.json`（全分区核销标注）

- [ ] **Step 1: 浅底重校清单收尾**

NodePalette/ProjectTitle 字面迁移（两文件在 PAGE_REGISTRY_FILES——改动同 commit 更新 css-baseline-diff.mjs:56-60 映射表）；透明 PNG 棋盘格/涂抹蒙版/裁剪遮罩逐个裁定"贴媒体 or 贴卡壳"（登记 adjudications）。

- [ ] **Step 2: 涌现登记两处同步核验**

D3 全程新增可见边框（border-width 0→N）位点：每处必须同时登记 emergence-adjudication-A4.json 授权集（或 EXTRA_AUTHORIZED_FILES 附理由）**与** PAGE_REGISTRY_FILES 对应页数组——缺一闸门 exit 1。跑 `node scripts/css-baseline-diff.mjs --before before-D --after segcheck-D3-final` 验证（segcheck 重采 working 侧）。

- [ ] **Step 3: D3 完成判据三源核销（differ exit 0 ≠ 完成，spec §11.1）**

① registry 分区逐条 `核销` 标注（每文件 adjudications 有裁定或豁免依据，**盲区三分区 inlineStyle/styleBlocks/rgbaClasses 逐行勾**）；② 浅色档探针（d-segment 全绿——每跟随面取期望浅值、内容面取深值）；③ B6 目检清单待 Task 27 执行（本任务先登记清单）。hex 键数不增核验：`node scripts/lint-gate.mjs`（重键口径 lint-gate.mjs:139）。**hex baseline 陈旧键说明（登记 registry notes 一句）**：D3 删除大量 hex 字面后 `eslint-hex-baseline.json` 残留已删行的陈旧键——默认不动 baseline（陈旧键不影响 no-new-violation 门禁语义），勿手动清也更禁 UPDATE_BASELINE=1。

- [ ] **Step 4: commit**

```bash
cd /d/flowweb && git add apps/web/src/pages/canvas/components/ apps/web/scripts/css-baseline-diff.mjs apps/web/src/router.tsx apps/web/tailwind.config.ts apps/web/e2e/audit/ && git commit -m "feat(web): C8 D3 收口——浅底重校长尾(NodePalette/ProjectTitle 迁移+PAGE_REGISTRY 同步+遮罩逐个裁定)+涌现登记两处同步核验+registry 全分区核销标注(完成判据三源：清单/浅探针/B6 清单)+router/tailwind 注释订正(板跟随主题)"
```

---

## Task 26（D4-a）: 断言矩阵新形态 + 全域反转清单核销

spec §12.1/§12.2——**不列全就会红**，逐条核销。

**Files:**
- Modify: `apps/web/e2e/c0-theme.spec.ts`（组4 头注释/a0 叙事注释协同）
- Modify: `apps/web/e2e/a0-collect-baseline.spec.ts`（:15-18/:303/:305 叙事注释重写）
- Modify: `docs/superpowers/specs/`（`video-editor.md:289/:291` 复活改注；c7-accepted-items.md §1 #1/2/3/7、§3 归因、§2#8 改写）

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

表格核对（已完成段标注、遗漏补齐）：G1/G2/G3/G7（Task 9）✓、G4 ve（Task 21）✓、G8①②③（Task 16/20）✓、a0 探针 ×4 分级（:200 保持/:220 保持/:221 Task 17/:250 Task 21）✓、CanvasView.test 镜像（Task 17）✓、canvas+videos 颜色断言 ≥24 条（随 Task 20/22 各域原子对）✓、ve `video-editor/components/timeline/TimelinePanel.render.test.tsx:115-131` **不动**（clip 类型色=内容语义）✓、c7/c5/c3/B0/b2/b6 登记档（Task 16/21/24/25）✓、video-editor.md:289 复活+`:291` 废止注改写（本步）、a0 叙事注释（:15-18/:303/:305 本步重写 + c0 文件头 :6-11/:19-20 三态/matchMedia 残留叙事一并清）、router.tsx/tailwind.config.ts（Task 25）✓。

- [ ] **Step 3: G8④ admin 守卫复核（不动）+ 全 e2e + commit**

G8④ admin Popconfirm 现状守卫**保持不动**（admin 域不在本期范围）。跑全门禁后 commit：

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs
cd /d/flowweb && git add apps/web/e2e/ docs/superpowers/specs/ && git commit -m "test(e2e): C8 D4-a 断言矩阵新形态——跟随/残余真岛/内容承载恒深三组终态+ProcessSnapshot 恒深断言补全+§12.2 全域反转清单逐条核销+video-editor.md 原始亮色规格复活(:289/:291)+a0 叙事注释重写+c7 接受项失效改写(#1/2/3/7+§3 归因 484 条方向反转)"
```

---

## Task 27（D4-b）: 全门禁 + B6 真实浅色对照 + 性能实测双探针 + 已知接受项终版

- [ ] **Step 1: 性能实测①——render 计数复验（探针已落 D2，此处复跑取证）**

`CanvasView.theme-perf.test.tsx` 已于 Task 18 建立（mock 真实 TextNode + 双向断言——**nodeTypes 是 CanvasView 内部常量无法注入 counting 类型，故走组件 mock 路线**）。D3 迁移完成后复跑一次确认仍绿（D3 曾大面积改节点组件，防性能回归）：

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

逐页目检（复用 b6-acceptance 流程）：/canvas（节点卡浅/工具条浅/板浅点可见/选中框可见）、video-editor（面板浅/clip 块深=§13.4 有意）、videos（壳浅/画面 scrim 深）、WeChatFollowModal、CreditsDropdown 浅色稿、LoginModal/admin 岛不变。目检表落 `e2e/audit/c8-b6-light-eyeball.md`（VideoEditNode 三重变更卡单独看——P4+P10+#E5E7EB）。完成删除 tmp 目录。

- [ ] **Step 4: D4 全门禁终验 + spec §13 已知接受项终版 + 收尾 commit**

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs && node scripts/contrast-table.mjs
```

spec §13 增补终版（按实际发生的接受项核对 1-7 条 + AuthModal 范围外待裁项登记：AuthModal.tsx 深色字面宿主恒浅岛、v1.9 §3.2 错误标签订正——独立条目留待后续 spec）。

```bash
cd /d/flowweb && git add apps/web/src/ apps/web/e2e/audit/ docs/superpowers/specs/2026-09-20-canvas-domain-theme-design.md && git commit -m "test(e2e): C8 D4 收口——render 计数探针(节点组件 0 重渲实证)+大画布切换读数留档+B6 真实浅色对照全景目检(三重变更卡单独看)+全门禁终验(C0 新形态/vitest/lint 双规则/css-audit D 段 exit 0/contrast-table 自检)+spec §13 已知接受项终版(含 AuthModal 范围外待裁登记)"
```

---

## 附录 A: 段↔任务对照与验收锚速查

| 段 | 任务 | 验收锚 |
|---|---|---|
| D0-0 | Task 1-5 | 零产品改动；before-D 入档（attrSetVersion D1）；探针钉值全绿（d0-probe-values.json 落盘）；自比自跑 0 噪声；**一轮做完停点复核再进 D0** |
| D0 | Task 6-10 | 两态 DOM 类断言；'system' 存储→dark；matchMedia 计数 0；segcheck-D0×before-D = 0 diff |
| D1a | Task 11-13 | 深档 0 diff（segcheck-D1a）；浅档新值可读（contrast-table 在册）；死键删；块唯一+源序；全文无裸 :root 双值域 token |
| D1b | Task 14-16 | diff 与 §9.2 总清单逐条配对（absorbed>0、unexpected=0）；`var(--canvas-` ve 域 0 命中；WeChat html.light 浅值；a0:250 探针仍钉深（岛未拆） |
| D2 | Task 17-18 | 深档像素 0 diff（快照自比自证后）；--xy-* 复测表（读 .react-flow__background）；镜像断言绿；selection 规则级裁定；render 计数探针首跑 |
| D3 | Task 19-25 | registry 分区（含盲区四分区 styleObjects/svgAttrs/styleBlocks/rgbaClasses）逐条核销 + 浅探针每面期望值 + B6 目检清单；hex 键数不增；白名单净减 4 目录/净增 **6** 精确文件（新增：CreditsDropdown/ConfirmModal/SaveAsTemplateDialog/ProcessSnapshot + Task 20 补 PlayView 与 VideoCard 族 2 条；现状 4 条精确条目升级为对象形态不计净增——与正文 Task 19 白名单同源） |
| D4 | Task 26-27 | 断言矩阵三组 + §12.2 核销 + 全门禁 + B6 真实对照 + 性能双探针（①D2 落 D4 复验 ②大画布读数） |

## 附录 B: 全程禁令速查

- 禁 `UPDATE_BASELINE=1` 重采（B5）；A5 旧基线对（before-A0×after-A）冻结不动；hex baseline 陈旧键不清（lint-gate 语义不受影响）。
- 禁重构与有意视觉变更同 commit；每域岛拆除与断言反转同 commit（原子对）；白名单目录摘除与该域精确条目补登同 commit。
- 禁浅色档验收落 D2–D3 空隙（§13.3）；D1b↔D2↔D3 板面批次连续收口。
- 禁 `pages/canvas/components/{nodes,groups}/**` 内 useTheme（CanvasView colorMode 例外）。
- 禁 tailwind.config.ts 加 colors 映射（§5——任意值 var 形式即可，勿增 baseline 键）。
- 禁通道 3 中性色 token 化（scrim/阴影/邀请卡白族——明文保留）。
- 禁 SVG 呈现属性走 var()（stroke=/fill= 一律 JS 分支或字面恒定——GridIcon 先例）；antd Progress strokeColor 判据看 computed stroke 非属性文本。
- 禁两套白名单判定并存（whitelistAllowFor 统一入口，isWhitelistedPath/WHITELIST_RES 已删）；禁 `String(node.value)` 取模板串（走 quasi cooked）。
- 禁探针/断言直接注入 `classList.add('light')`（D0 起统一 addInitScript localStorage 真实路径；**豁免：b0 组3/B0-6 源序专测**——其机制正是靠 dark 与 light 双命中验 .light 块级联，非跟随面断言）；禁把 `['light','dark']` 之类"错误状态字面量"写进镜像断言（保持 `toEqual(mirror.html)` 形态）。
- **禁在 8 采集页内做 DOM 层级增删**（stableKey 的 dom: 路径键漂移 = 配对闸必红——dom: 键不适用"同位同量"豁免）；域内结构改动须先确认目标不在采集集（先例：VideoPlayerModal 只在 /videos/:id 渲染、不在采集集，Task 20 注记不得援引为采集页内结构改动依据）。
- differExpectedPairs 全局配对残余：同色对不同位点互相吸收——每条附 why + 三源核销补偿；**adjudications 只记理由不吸收 diff**（不可见位点以"不可见→无 diff"登记）。
- 禁像素参照快照被 `--update-snapshots` 静默覆盖：生成参照只允许 `-g "深档"`、落盘即 sha256 固化、同 HEAD 3 次自比全 0 才可信；不达标准即降级附件证据，禁调 maxDiffPixels 凑绿。

