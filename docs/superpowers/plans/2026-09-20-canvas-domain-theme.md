# C8 画布域主题跟随 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画布域（含 video-editor 壳、videos 播放壳、WeChatFollowModal、CreditsDropdown、MaterialLibrary）全量跟随浅/深主题；主题模型两态化（删 system 档），默认深色。

**Architecture:** 主题真源 = html `.light`/`.dark` 类（防闪白内联脚本挂类 + themeStore 两态单值）；antd algorithm / ReactFlow colorMode / CSS 变量三通道同源由 `mode` 推导。迁移按 spec 七段执行：D0-0 仪器先行（before-D 基线+探针+台账脚本）→ D0 两态六件套 → D1a 定义层双值化（深档零 diff）→ D1b 并域+有意变更配对 → D2 colorMode 翻转 → D3 registry 清单逐域原子对迁移 → D4 收口全门禁。

**Tech Stack:** React 18 + xyflow 12.10.2 + antd 5（cssinjs）+ Tailwind（token 工具类 + 任意值 var）+ Playwright（preview:5173 产物门禁）+ vitest（jsdom）+ 自研门禁（lint-gate.mjs / css-baseline-diff.mjs / b0/b1/c0 e2e）。

**Spec:** `docs/superpowers/specs/2026-09-20-canvas-domain-theme-design.md`（v1.5 定稿冻结——实施期分歧以 registry 产出与 contrast-table.mjs 实测为准，不回改 spec 全文，走变更登记）。

---

## 执行总纲（先读）

1. **段顺序不可换（spec §15 三把锁）**：D1 必须先于 D2；D2 与 D3 板面批次连续收口（中间态浅色画布不可用，禁止在 D2–D3 空隙做浅色档验收）；"深色档零 diff"验收锚只适用 D0-0/D0/D1a，D1b 起深档 diff 由 §9.2 总清单配对吸收（未配对=失败），D3 各域由域原子对清单吸收。
2. **原子对纪律**：每域/每岛拆除与断言反转同 commit；重构与有意视觉变更不得同 commit（differ 信号保全）。
3. **基线纪律**：禁 `UPDATE_BASELINE=1` 重采；A5 旧基线对（before-A0 × after-A）保持冻结管 A/B 段；本期新增独立 D 段基线对（before-D × after-D 侧 segcheck 快照）。after-D 不是一次性产物——每次段验收按当前 checkout 重新采集 working 侧快照比对。
4. **常用命令**（全部在 `/d/flowweb/apps/web` 下执行；Bash CWD 会漂移，每条命令自带 `cd` 前缀）：
   - 单测：`cd /d/flowweb/apps/web && npx vitest run <file>`
   - e2e 单文件：`cd /d/flowweb/apps/web && npx playwright test e2e/<file>`
   - 全门禁：`cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs`
   - 基线采集：`cd /d/flowweb/apps/web && COLLECT_BASELINE=1 BASELINE_DIR=<dir> npx playwright test e2e/a0-collect-baseline.spec.ts`
   - 基线 diff：`cd /d/flowweb/apps/web && node scripts/css-baseline-diff.mjs --before before-D --after <segcheck-dir>`（D 对；默认无参仍是 A5 旧行为）
5. **探针生命周期表**（d-segment-probes.spec.ts 内每条探针注明所属段与翻转点；翻转在该段 commit 内同改）：

| 探针 | D0-0 钉值（html.light 下） | 翻转段 → 新预期 |
|---|---|---|
| 画板 wrapper 底 | `rgb(0, 0, 0)`（colorMode 钉深） | D2 → `rgb(245, 245, 245)` |
| 画板网格点 | `#555555` | D2 → `#C8C8C8` |
| gate 节点卡底 | 实测发现值（Task 3 Step 3） | D3-画板 → `rgb(30, 30, 30)`（bg-surface 深值） |
| CanvasTopBar 已连接前景 | `rgb(74, 222, 128)` | D1a → `rgb(21, 128, 61)`（accent-text 浅值 #15803d） |
| videos 封面占位底 | `rgb(38, 38, 38)` | 不翻转（P6 内容垫底恒深，D4 组3 断言） |
| ve 壳底 | `rgb(20, 20, 20)` | D3-ve → 双断言（--fw-bg 浅值 + 壳根=该浅值 `rgb(247, 248, 250)`） |
| ve 面板底（EditorTopBar） | `rgb(38, 38, 38)` | D3-ve（壳岛拆除后）→ `rgb(240, 241, 242)`（--fw-surface-dim 浅值；D1b 并域期壳 .dark 岛仍钉深） |
| WeChatFollowModal 面前景 | `rgb(30, 30, 30)` / `rgb(226, 232, 240)` | D1b → `rgb(255, 255, 255)` / `rgb(31, 35, 41)` |

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

Expected: 41 passed + 5 skipped（collector skip）。global-setup 会做 migrate deploy + seed（gate-canvas-1/gate-node-1/样例视频随 seed 幂等重建），preview 5173 由 webServer 自建。**此步失败则修复环境后再进入 Task 2——扩了采集器却采不到基线等于白做，before-D 时间窗不可补。**

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
    "tolerance": 0.01,
    "selfCheck": [
      { "fg": "#FFFFFF", "bg": "#000000", "expect": 21.00, "why": "极值锚" },
      { "fg": "#767676", "bg": "#FFFFFF", "expect": 4.54, "why": "经典 AA 贴线灰" },
      { "fg": "#555555", "bg": "#000000", "expect": 2.82, "why": "本 spec 深档网格点（历轮争议点）" }
    ]
  },
  "pairs": [
    { "id": "P2-深档点", "fg": "#555555", "bg": "#000000", "spec": "§2 P2" },
    { "id": "P2-浅档点-DCDCDC弃用", "fg": "#DCDCDC", "bg": "#F5F5F5", "spec": "§2 P2" },
    { "id": "P2-浅档点-C8C8C8", "fg": "#C8C8C8", "bg": "#F5F5F5", "spec": "§2 P2" },
    { "id": "P2-边线深档", "fg": "#3B82F6", "bg": "#F5F5F5", "spec": "§8.1 edge-flow" },
    { "id": "P2-边高亮深档-999", "fg": "#999999", "bg": "#F5F5F5", "spec": "§8.1 edge-highlight 换值动因" },
    { "id": "P2-边高亮浅档-6B7280", "fg": "#6B7280", "bg": "#F5F5F5", "spec": "§8.1" },
    { "id": "P6-手柄深档-bg@白卡", "fg": "#9CA3AF", "bg": "#FFFFFF", "spec": "§8.1" },
    { "id": "P6-手柄浅档-bg@白卡", "fg": "#6B7280", "bg": "#FFFFFF", "spec": "§8.1" },
    { "id": "P6-手柄浅档-bg@板", "fg": "#6B7280", "bg": "#F5F5F5", "spec": "§8.1" },
    { "id": "P9-欠账现状", "fg": "#6C5CE7", "bg": "#262626", "spec": "§2 P9" },
    { "id": "P9-图形档白字", "fg": "#FFFFFF", "bg": "#6C5CE7", "spec": "§2 P9" },
    { "id": "P9-图形档浅位", "fg": "#6C5CE7", "bg": "#F0F1F2", "spec": "§2 P9" },
    { "id": "P9-文字档深@262626", "fg": "#9B8CF7", "bg": "#262626", "spec": "§2 P9" },
    { "id": "P9-文字档深@141414", "fg": "#9B8CF7", "bg": "#141414", "spec": "§2 P9" },
    { "id": "P9-文字档浅@f0f1f2", "fg": "#5F4FD1", "bg": "#F0F1F2", "spec": "§2 P9" },
    { "id": "P9-文字档浅@f7f8fa", "fg": "#5F4FD1", "bg": "#F7F8FA", "spec": "§2 P9" },
    { "id": "P4-GridIcon@白卡", "fg": "#6C5CE7", "bg": "#FFFFFF", "spec": "§11.4" },
    { "id": "P4-GridIcon@深卡", "fg": "#6C5CE7", "bg": "#1E1E1E", "spec": "§11.4" },
    { "id": "P4-品牌浅底失格-5DDCFF", "fg": "#5DDCFF", "bg": "#FFFFFF", "spec": "§4 通道2" },
    { "id": "P4-品牌浅底失格-4ade80", "fg": "#4ADE80", "bg": "#FFFFFF", "spec": "§4 通道2" }
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

function channel(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.05) / 1.055, 2.4); }
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
  rows.push(`| ${p.id} | ${p.fg} | ${p.bg} | ${fmt(contrast(p.fg, p.bg))} | — | — | spec ${p.spec} |`);
}
const md = ['# C8 对比度台账（contrast-table.mjs 产出）', '', '| 配对 | 前景 | 底 | 实测 | spec 在册 | 过/弃 | 出处 |', '|---|---|---|---|---|---|---|', ...rows, ''].join('\n');
fs.writeFileSync(path.join(ROOT, 'e2e', 'audit', 'contrast-table.md'), md);
console.log(md);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: 跑自检向量**

```bash
cd /d/flowweb/apps/web && node scripts/contrast-table.mjs; echo "exit=$?"
```

Expected: `exit=0`，且自检三行全 ✅（21.00 / 4.54 / 2.82）。若 #555555/#000000 ≠ 2.82，说明公式实现错误（先查 channel/gamma），**禁止改配对表迁就**。

- [ ] **Step 4: Commit**

```bash
cd /d/flowweb && git add apps/web/scripts/contrast-table.mjs apps/web/e2e/audit/contrast-pairs.json apps/web/e2e/audit/contrast-table.md && git commit -m "feat(web): C8 D0-0 对比度台账脚本 contrast-table.mjs——WCAG 同口径出表 + 3 组自检向量（21.00/4.54/2.82 不过 exit 1），spec 在册数字全量入册"
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

同步删除 `const FORM_CONTROL = new Set([...])`（:105，已无消费）。`computedPropertySet` meta 字段（:314-317）追加 `'backgroundColor(全元素)', 'color(全元素,D1 起)'`，并新增 meta 顶层字段 `attrSetVersion: 'D1'`（afterAll 写入对象第一层）。注释 `// color 仅表单控件（继承色噪声大）` 更新为 `// D1 起全元素采集——D 段基线对比色；旧基线（无 attrSetVersion=A0）跨代比对走"属性缺失=不判"`。

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

④ D 段注册配对源 + 吸收表（B2_REGISTRY 加载处旁）：

```js
/* C8 D 段注册配对（canvas-migration-registry.json differExpectedPairs——D1b/D3 有意变更逐条配对，未配对=失败） */
const D_REGISTRY_PATH = path.join(ROOT, 'e2e', 'audit', 'canvas-migration-registry.json');
const D_REGISTRY = fs.existsSync(D_REGISTRY_PATH) ? JSON.parse(fs.readFileSync(D_REGISTRY_PATH, 'utf8')) : { differExpectedPairs: { pairs: [] } };
const dPairs = new Set(D_REGISTRY.differExpectedPairs.pairs.map((p) => `${p.prop}|${normColorVal(p.before)}|${normColorVal(p.after)}`));
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
      expect(await bgOf(card)).toBe('rgb(255, 255, 255)'); // ← Step 4 发现后若异值则以发现值为准改此处
    } finally { await ctx.close(); }
  });

  test('CanvasTopBar 已连接前景=rgb(74,222,128)（accent-text 深值；D1a 翻浅 #15803d）', async ({ browser }) => {
    const ctx = await lightContext(browser);
    const page = await ctx.newPage();
    try {
      await openCanvas(page);
      expect(await colorOf(page.getByText('已连接', { exact: true }).first())).toBe('rgb(74, 222, 128)');
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

ve 壳探针（`D-4 ve 域`）复用采集器"添加节点→多轨道剪辑→全屏编辑"真实 UI 流（抄 a0-collect-baseline.spec.ts:233-265 流程 + 清理段），断言 `[data-testid="video-editor-shell"]` backgroundColor === 'rgb(20, 20, 20)'（D3-ve 翻双断言）。

- [ ] **Step 4: 发现钉值（gate 节点卡底等未知值）**

```bash
cd /d/flowweb/apps/web && npx playwright test e2e/d-segment-probes.spec.ts
```

红因 message 会回显实际 computed 值——把每处实际值填进对应 `toBe(...)`（已知值预期直接绿则跳过）。再跑一次至全绿。

- [ ] **Step 5: 三件套同 commit**

```bash
cd /d/flowweb/apps/web && npx playwright test e2e/d-segment-probes.spec.ts e2e/c0-theme.spec.ts && npx vitest run
cd /d/flowweb && git add apps/web/e2e/a0-collect-baseline.spec.ts apps/web/scripts/css-baseline-diff.mjs apps/web/e2e/d-segment-probes.spec.ts && git commit -m "feat(web): C8 D0-0 仪器扩展——a0 采集器 D1 属性集(backgroundColor+全元素 color+attrSetVersion)+differ 独立 D 段基线对(同代校验+D 注册配对闸)+d-segment-probes 探针族钉深值（三件同一 commit，spec §6 ⑵）"
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

若有 unexpected：逐条归因。确定性噪声（如 antd 弹层动画态、时序性 class）→ differ 分类器扩"预期项"白名单（OVERRIDES 或桶预期标注）并**在 spec §6 落一行变更登记**（`docs(superpowers/specs)` 追加变更记录 commit）；非确定性噪声（元素计数漂移）→ 修采集稳定性（沉降等待/排除规则）而非白名单。循环 Step 1-2 直至 0。

- [ ] **Step 4: 清理噪声目录 + 登记预算**

```bash
cd /d/flowweb/apps/web && rm -rf e2e/baseline/d-noise-a e2e/baseline/d-noise-b e2e/audit/baseline-diff-dnoise.json e2e/audit/baseline-diff-dnoise.md
```

（若 Step 3 扩了白名单：单独 commit `fix(web): C8 D0-0 自比自跑噪声白名单——<条目与理由>`。）

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
const stripTests = (files) => files.filter((f) => !/\.(test|spec)\.[jt]sx?$/.test(f));

const canvas = stripTests(walk(path.join(SRC, 'pages/canvas')))
  .filter((f) => !f.includes(`${path.sep}video-editor${path.sep}`) && !RENDER_WHITELIST.includes(rel(f)));
const ve = stripTests(walk(path.join(SRC, 'pages/canvas/video-editor'))).filter((f) => !RENDER_WHITELIST.includes(rel(f)));
const videos = stripTests(walk(path.join(SRC, 'pages/videos')));
const extras = ['src/components/layout/WeChatFollowModal.tsx'];
const cssBlocks = ['src/index.css', 'src/pages/canvas/components/nodes/prompt-input/PromptInput.css', 'src/pages/canvas/components/nodes/NodeHandle.css'];
const tests = [...walk(path.join(SRC, 'pages/canvas')), ...walk(path.join(SRC, 'pages/videos'))]
  .filter((f) => /\.(test|spec)\.[jt]sx?$/.test(f));

const withHits = (files) => files.filter((f) => COLOR_RE.test(fs.readFileSync(f, 'utf8')));
const registry = {
  meta: {
    task: 'C8 画布域主题跟随——迁移 registry（spec 2026-09-20-canvas-domain-theme §5；D0-0 产出，D3 逐域核销）',
    generatedAt: new Date().toISOString(),
    renderWhitelist: RENDER_WHITELIST,
    notes: '逐键裁定列随 D1a/D1b/D3 各段填充；differExpectedPairs 为 D 段配对闸唯一来源（未配对=失败）',
  },
  partitions: {
    canvasDomain: { files: withHits(canvas).map(rel), totalFiles: canvas.length },
    veDomain: { files: withHits(ve).map(rel), totalFiles: ve.length },
    videosDomain: { files: withHits(videos).map(rel), totalFiles: videos.length },
    externalSingles: { files: extras },
    handwrittenCss: { files: cssBlocks },
    tests: { files: tests.map(rel) },
  },
  adjudications: [],
  differExpectedPairs: { pairs: [] },
  whitelistKeeps: [],
};
const out = path.join(ROOT, 'e2e', 'audit', 'canvas-migration-registry.json');
fs.writeFileSync(out, JSON.stringify(registry, null, 1));
// 两用同步辅助：打印 PAGE_REGISTRY_FILES 建议数组（css-baseline-diff.mjs 人工粘贴）
const suggest = {
  canvas: registry.partitions.canvasDomain.files.filter((f) => f.startsWith('src/pages/canvas/components/')),
  videos: registry.partitions.videosDomain.files,
  'video-editor': registry.partitions.veDomain.files,
};
console.log('[registry] 分区计数：', Object.fromEntries(Object.entries(registry.partitions).map(([k, v]) => [k, v.files.length])));
console.log('[registry] PAGE_REGISTRY_FILES 建议数组已含于 JSON partitions——同步见 scripts/css-baseline-diff.mjs');
```

- [ ] **Step 2: 跑脚本产出 registry**

```bash
cd /d/flowweb/apps/web && node scripts/canvas-migration-registry.mjs
```

Expected: 打印各分区计数（ve 源文件带色字面应约 8 个；videos 7 个左右——**以脚本产出为准，勿以本行数字为验收**）。

- [ ] **Step 3: 涌现闸两处同步（css-baseline-diff.mjs）**

① `PAGE_REGISTRY_FILES` 三页数组扩为 registry partitions 对应文件（canvas / video-editor / videos 数组粘贴脚本产出；`material-modal` 数组追加 `src/components/MaterialLibrary/**` 代表文件——MaterialLibraryModal.tsx 等）。② 授权集并集——`authorizedFiles` 构造处（:321-325）追加一行：

```js
  ...D_REGISTRY.partitions ? [
    ...D_REGISTRY.partitions.canvasDomain.files, ...D_REGISTRY.partitions.veDomain.files,
    ...D_REGISTRY.partitions.videosDomain.files, ...D_REGISTRY.partitions.externalSingles.files,
  ].map((f) => f) : [],
```

（理由统一：C8 D3 迁移文件，canvas-migration-registry.json 在册。）跑 `node scripts/css-baseline-diff.mjs --before before-A0 --after after-A` 确认 A5 旧行为不回归（authorized 变大只放行不收紧）。

- [ ] **Step 4: 采 before-D（唯一时间窗，8 页）**

```bash
cd /d/flowweb/apps/web && COLLECT_BASELINE=1 BASELINE_DIR=before-D npx playwright test e2e/a0-collect-baseline.spec.ts
```

Expected: 8 页落盘 + meta 含 `attrSetVersion: 'D1'`（检查：`head -20 e2e/baseline/before-D/meta.json`）。

- [ ] **Step 5: D0-0 段验收 + commit**

验收（spec §6）：D0-0 自身零产品改动 ✓（本任务只动脚本/审计档）；before-D 入档 ✓；`npx playwright test e2e/d-segment-probes.spec.ts` 全绿（钉深值）✓。

```bash
cd /d/flowweb && git add apps/web/scripts/canvas-migration-registry.mjs apps/web/e2e/audit/canvas-migration-registry.json apps/web/scripts/css-baseline-diff.mjs apps/web/e2e/baseline/before-D && git commit -m "feat(web): C8 D0-0 收口——registry 脚本产出迁移清单(分区+渲染白名单)+before-D 基线入档(D1 属性集 8 页)+涌现闸两处同步(PAGE_REGISTRY 三页数组+授权集并集 registry 在册)"
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

- [ ] **Step 1: 死键零消费确认**

```bash
cd /d/flowweb/apps/web && grep -rn "canvas-controls-active\|ve-text-control" src/ --include="*.tsx" --include="*.ts" --include="*.css" | grep -v "index.css"
```

Expected: 0 命中（index.css 定义本身除外）。有命中则该键非死——停手按 registry 裁定列登记后再处置。

- [ ] **Step 2: index.css 重构**

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
  { "key": "--ve-text-control", "removedAt": "D1a", "why": "0 消费死 token；三条 var 间接链（index.css:99/:100/:103）随 D1b 并域删除" }
 ],
```

`domain-token-adjudication-B0.json`：`--canvas-handle-*/--edge-*/--canvas-shadow-*` 三族 neverMerge 条目改标 `re-adjudicated-C8-D1a`（前提"画板恒深域"消失，已双值化）；`--z-panel` 维持永不并入（z-index 非颜色）；过期快照行（AddNodeMenu 15 处/HistorySidebar 2 处）订正为现状（AddNodeMenu.tsx:305 仅剩 --canvas-shadow-menu）。

- [ ] **Step 6: 跑绿（b0/b1/探针/c0 + vitest）**

```bash
cd /d/flowweb/apps/web && npx playwright test e2e/b0-token-blocks.spec.ts e2e/b1-token-migration.spec.ts e2e/d-segment-probes.spec.ts e2e/c0-theme.spec.ts && npx vitest run
```

Expected: 全绿。**注意 d-segment-probes 的「CanvasTopBar 已连接前景」探针本 commit 内翻转为 `rgb(21, 128, 61)`**（accent-text 浅值随 .light 块生效）——改 `d-segment-probes.spec.ts` 该行为 `expect(await colorOf(...)).toBe('rgb(21, 128, 61)');` 并更新注释（D0-0 钉深 → D1a 翻浅）。

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

实测 var() 代换是否生效（antd Progress 落 SVG 属性，`strokeColor="var(--ve-accent)"` 可能不解析——spec §11.4 ⚠ 项）：临时改 `ExportModal.tsx:236` 为 `strokeColor="var(--ve-accent)"`，构建后开导出弹层，`page.evaluate(() => document.querySelector('.ant-progress-circle path')?.getAttribute('stroke'))`——返回 `var(--ve-accent)` 字面且圆环无色即不解析。生效则保留 var()；不生效则**维持字面 `#6C5CE7`**（图形档双档同值，无需 JS 分支）。结论无论哪路：`c3-js-channel-census.json` 补登一行（file: ExportModal.tsx、channel: SVG 呈现属性 strokeColor、值: 双档同值 #6C5CE7 或 var()、裁定依据 §11.4）。

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

（hover .08→.10 只改静态值——differ 快照不含 hover 态、无采集 diff，登记进 adjudications 说明即可；**单次登记规则**：AssetPanel ③ 的改指不重复登记此 diff。）

- [ ] **Step 2: 等值键并域（深档零 diff，无需配对）+ 六键删除**

先枚举：

```bash
cd /d/flowweb/apps/web && grep -rn "var(--ve-panel)\|var(--ve-text)\|var(--ve-bg)\|var(--vw-card" src/ --include="*.tsx" --include="*.css" | grep -v "\.test\." | grep -v "\.spec\."
```

机械替换（深值全等，浅档首次一致）：
- `var(--ve-panel)` → `var(--fw-surface-dim)`（14 处：AssetPanel:55、EditorTopBar:21、PropertiesPanel:74/:81/:138、PreviewPlayer:79、ClipBlock:88、TimelineRuler:47、TrackRow:33/:53、TimelinePanel:280/:285/:292/:307）
- `var(--ve-text)` → `var(--fw-text)`（全部命中，约 34 处）
- `var(--ve-bg)` → `var(--fw-bg)`（1 处：VideoEditorShell:134——PreviewPlayer:64 已于 D1a 拆恒值键；spec 记 2 处系 D1a 前口径，以实测为准）
- `var(--vw-card-bg)` → `var(--fw-surface)`、`var(--vw-card-border)` → `var(--fw-overlay-2)`、`var(--vw-card-border-hover)` → `var(--fw-overlay-3)`（VideoCard.tsx 内，以 grep 实测为准）

随后 index.css 两块删六行：`--ve-bg/--ve-panel/--ve-text/--vw-card-bg/--vw-card-border/--vw-card-border-hover`（`--ve-border/--ve-text-dim/--ve-accent/--ve-accent-text` 保留——独立主/已拆档）。b0 DOMAIN 三处同步删对应 6 行。

**配套修订（实施裁定，登记 adjudications）**：`a0-collect-baseline.spec.ts:250` ve 壳探针改读 `--fw-bg`（--ve-bg 键已删；语义断言不变——html.light 下取浅值，spec §10.3 v1.4 措辞按"并域后主键"落地），本 commit 内同改。

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

Expected: 全门禁绿；diff `exit=0` 且 dExpectedGate absorbed>0、unexpected=0——全部 diff 与 §9.2 总清单配对命中（① rgb(108,92,231)→rgb(155,140,247)；② rgb(54,54,54)→rgb(51,51,51)；⑤ 等值并域零 diff）。留档：`cp e2e/baseline/segcheck-D1b/canvas.png e2e/audit/d2-ref-canvas-dark.png`（D2 像素 diff 参照——spec §10"以 D1b 后 checkout 为参照"），其余 segcheck 产物删除。

- [ ] **Step 5: commit**

```bash
cd /d/flowweb && git add apps/web/src/components/layout/WeChatFollowModal.tsx apps/web/e2e/c0-theme.spec.ts apps/web/e2e/d-segment-probes.spec.ts apps/web/e2e/audit/c5-portal-census.json apps/web/e2e/audit/d2-ref-canvas-dark.png apps/web/e2e/audit/baseline-diff-segcheck-D1b.json && git commit -m "feat(web): C8 D1b④ WeChatFollowModal 原子对拆岛——删 darkAlgorithm+rootClassName dark 改跟随(var(--fw-surface) 面底)+G8① 反转(无岛类/浅值/defaultAlgorithm 判据 ch<180)+探针翻浅+census 条目退出；D1b 段验收：segcheck-D1b diff 全配对 absorbed>0 unexpected=0，留 D2 深档像素参照 d2-ref-canvas-dark.png"
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
    const xy = await page.locator('.react-flow').evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        backgroundPattern: cs.getPropertyValue('--xy-background-pattern-color-props'),
        wrapperBg: cs.backgroundColor,
        wrapperClasses: Array.from(el.classList).filter((c) => c === 'light' || c === 'dark'),
      };
    });
    expect(xy.wrapperClasses).toEqual(['light']);
    expect(xy.wrapperBg).toBe('rgb(245, 245, 245)'); // --canvas-board-bg 浅值（bg-[var] utility 层）
    expect(xy.backgroundPattern.replace(/\s+/g, '')).toBe('var(--canvas-board-dot)');
    test.info().attach('d2-xy-probes', { body: JSON.stringify(xy), contentType: 'application/json' });
  } finally { await ctx.close(); }
});
```

D2 改码**前**先落参照并确认绿：

```bash
cd /d/flowweb/apps/web && npx playwright test e2e/d2-board-pixeldiff.spec.ts --update-snapshots && npx playwright test e2e/d2-board-pixeldiff.spec.ts
```

（此刻浅档用例会红——wrapper 仍 colorMode 钉深。属预期：先提交 dark 参照快照随 D2 commit；浅档用例随 Step 2 转绿。）

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

## Task 18（D2）: A2 selection 钉值裁定 + ProcessSnapshot 不变式登记 + 段验收

**Files:**
- Modify（条件）: `apps/web/src/index.css:210-216`
- Modify: `apps/web/e2e/audit/canvas-migration-registry.json`（adjudications 登记）

- [ ] **Step 1: selection 钉值先撤后判（spec §10.2）**

临时注释 `index.css:212-216`（`.react-flow__nodesselection-rect, .react-flow__selection { background: …; border: …; }`）→ 重建跑 `npx playwright test e2e/d2-board-pixeldiff.spec.ts`：
- **0 diff** → 钉值失效（colorMode 跟随后 light 皮肤恢复修复前蓝色）→ 删除该块，gate 恢复有效；
- **非 0** → 恢复注释，改为画板根局部钉值：`CanvasView.tsx:341` wrapper 外层 div 加 `style={{ ['--xy-selection-background' as string]: undefined }}` 不适用——按实测差异项在 `.react-flow` 根局部覆盖（如 `<style>` 不用；采用 index.css 中 `.react-flow .react-flow__selection { … }` 提高作用域到画板根、禁全局 !important 的等值写法），差异值登记 adjudications。

- [ ] **Step 2: ProcessSnapshot 内容域不变式登记（不动代码）**

registry adjudications 追加：`ProcessSnapshot 整块=内容承载面恒深（spec §10.7）：:89 colorMode="dark" 保留、:91 网格点 #3a3a3a 保留（勿统一到 --canvas-board-dot——那会引入 #555555≠#3a3a3a 深档 diff）、:96 bg-black/60 中性遮罩留`。

- [ ] **Step 3: D2 段验收**

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs && COLLECT_BASELINE=1 BASELINE_DIR=segcheck-D2 npx playwright test e2e/a0-collect-baseline.spec.ts && node scripts/css-baseline-diff.mjs --before before-D --after segcheck-D2 --out e2e/audit/baseline-diff-segcheck-D2; echo "exit=$?"
```

Expected: 全绿；diff=已登记配对吸收（D1b 两对 + D2 若有 selection 撤钉新对）+ unexpected=0。清理 segcheck 产物。

- [ ] **Step 4: commit（与 Task 17 连续收口完成，板面批次即 D3-画板紧接开工）**

```bash
cd /d/flowweb && git add apps/web/src/index.css apps/web/e2e/audit/canvas-migration-registry.json apps/web/e2e/audit/baseline-diff-segcheck-D2.json && git commit -m "feat(web): C8 D2 收口——A2 selection 钉值先撤后判裁定(结论按 Step 1 实测：删失效钉值或画板根局部钉值，登记 adjudications)+ProcessSnapshot 内容域不变式登记(colorMode dark 保留+#3a3a3a 保留)+D2 段验收 diff 全配对；D2↔D3 板面批次连续收口纪律生效"
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

② 白名单升级为「目录条目（string=全属性族放行）+ 精确文件条目（{glob, allow:['bg',...]}）」双形态：

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
  // —— 精确文件+属性族（C8 白名单粒度升级：整文件放行会放走同文件未来回归）——
  { glob: 'src/components/layout/TopActionBar.tsx', allow: ['bg', 'text'] },       // 登录钮 bg-white/text-black（#9 反白 CTA）
  { glob: 'src/pages/canvas/components/CanvasTopBar.tsx', allow: ['text'] },        // 档位徽章 text-black（#6 黑字随底）
  { glob: 'src/pages/home/components/CreateCanvasCard.tsx', allow: ['text'] },
  { glob: 'src/pages/team/TeamDetail.tsx', allow: ['text'] },
  { glob: 'src/pages/canvas/components/CreditsDropdown.tsx', allow: ['bg'] },       // :267 邀请卡 bg-white（P5 通道 3 明文保留）
  { glob: 'src/pages/canvas/components/ConfirmModal.tsx', allow: ['bg'] },          // 白卡（通道 3）
  { glob: 'src/pages/canvas/components/SaveAsTemplateDialog.tsx', allow: ['bg'] },  // 白卡（通道 3）
];
```

③ `create(context)` 内命中时提取属性族并按 allow 判定：

```js
  create(context) {
    const visitor = createStringClassScanner(THEME_UTILITY_RE, 'themeUtilityForbidden')(context);
    const wrap =
      (visit) =>
      (...args) => {
        const rel = toAppRelPosix(context.filename);
        let allow = null; // null=整目录全放行
        let hit = false;
        for (const e of THEME_UTILITY_WHITELIST) {
          const glob = typeof e === 'string' ? e : e.glob;
          if (globToRe(glob).test(rel)) { hit = true; if (typeof e !== 'string') allow = e.allow; break; }
        }
        if (hit && allow === null) return; // 目录条目全放行
        const node = args[0];
        const text = String(node?.value ?? '');
        const m = THEME_UTILITY_RE.exec(text.replace(/^[\s"'`]/, ''));
        const prop = m?.[2];
        if (hit && allow && prop && allow.includes(prop)) return; // 精确条目放行该属性族
        visit(...args);
      };
    return { Literal: wrap(visitor.Literal), TemplateLiteral: wrap(visitor.TemplateLiteral) };
  },
```

（`string-class-scan.js` 的 token 回调携带原 token 串；若其接口只传 node，则按上方在 wrap 内自行 rematch 提取 `m[2]` 属性族。实现后以单测/fixture 验证：同文件 `bg-white` 放行 + `text-white` 仍拦。）

- [ ] **Step 3: 跑扩规则拿 working list 并逐条处置**

```bash
cd /d/flowweb/apps/web && node scripts/lint-gate.mjs
```

预期目录白名单外新增红 ≈25 处（bg 18+text 7；**以脚本产出为准**）。逐条裁定（每条登记 registry whitelistKeeps 或直接迁移）：
- **token 化**：跟随域 chrome 上的 `text-white`→`text-text`/`text-on-accent`、`bg-white/NN`→`bg-overlay-N`（B2 同款五通道映射）；
- **通道 3 合法面精确豁免**：中性 scrim（`bg-black/50` canvas/page.tsx:313、`bg-black/60` BaseFullscreenModal.tsx:70 等）与白卡面 → 加 `{glob, allow:['bg']}` 条目+理由；
- **通道 4 内容面**：媒体垫底 `bg-black` → 保留字面+精确豁免（内容承载）。

处置至 lint-gate PASS（此为 D3 开工前置门禁漏洞修补，目录白名单**本任务不摘**——逐域摘除在 Task 20-24）。

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
- Modify: `apps/web/src/components/BaseFullscreenModal.tsx` + `ImageFullscreenViewer`/`VideoFullscreenViewer`（跟随 + 死类删除）
- Modify: `apps/web/src/pages/videos/VideoPlayerModal.test.tsx:168-173`
- Modify: `apps/web/e2e/c0-theme.spec.ts`（G8②③ 反转 + 文件头/videos 叙事）
- Modify: `apps/web/scripts/eslint-rules/no-theme-utility.js`（摘 videos 目录条目）

- [ ] **Step 1: DOM 拆分前置（P3）——画面垫底独立、壳根 chrome 化**

`VideoPlayerModal.tsx:58` 壳根拆两层：

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

（按 :58-84 实际结构落位：媒体区入内层深容器；`close-btn` :80 的 `bg-[rgba(50,50,50,0.45)]` 若压画面=第四通道保留，若在 chrome 区→token 化；以目检判定并登记 adjudications。）

- [ ] **Step 2: 域内 chrome 迁移（四通道逐条）**

按 registry `videosDomain.files` 清单核销，机械配方：
- chrome 面/字/边 → `bg-bg`/`bg-surface`/`text-text`/`border-overlay-2` 等 token 工具类；
- **压画面浮层恒定**（第四通道）：PlayView:69/:83 `from-black` scrim、`text-white/90`、`bg-black/70` 时长条——保留字面；
- `VideoCard` 封面占位底 `#262626`（:16）保留（P6 内容垫底；a0:200 探针持续 rgb(38,38,38)）；
- `CarouselBar`/`ProcessView` chrome 部分迁移（ProcessSnapshot **整块不动**）。

每条登记 registry adjudications（file:line/通道/值）。

- [ ] **Step 3: 全屏查看器跟随 + O6② 死类删除（E 表）**

`ImageFullscreenViewer`/`VideoFullscreenViewer`：岛类/深色字面按跟随迁移；**死类删除**（b3-alldead-list.json 中本两文件的 `text-popover-foreground` 10 处、`text-muted-foreground` 8 处、`focus-visible:ring-ring` 4 处等 v4/shadcn 词汇）——**删除类名**而非落深值（防与新命名撞名复活）；`b3-alldead-list.json` 标注 `reopened-C8-D3`。

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

`no-theme-utility.js` 删 `'src/pages/videos/**'` 行（net -1 目录）；registry whitelistKeeps 镜像；域纪律复核：`grep -rn "text-white\|bg-white" src/pages/videos/ | wc -l` 命中数=精确豁免登记数（压画面浮层/封面垫底），其余 0。

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs
cd /d/flowweb && git add apps/web/src/pages/videos/ apps/web/src/components/BaseFullscreenModal.tsx apps/web/e2e/c0-theme.spec.ts apps/web/scripts/eslint-rules/no-theme-utility.js apps/web/e2e/audit/ apps/web/src/components/ && git commit -m "feat(web): C8 D3-videos 播放壳域原子对——DOM 拆分(画面垫底独立自持深底+局部 color-scheme:dark/壳根删 dark 类 chrome 化)+PlayView/ProcessView/CarouselBar/VideoCard 四通道迁移(压画面 scrim+白字恒定/封面垫底 #262626 恒深)+全屏查看器跟随+O6② 死类删除(popover-foreground 族删类不落值)+G8②③ 反转+videos 白名单摘除(net -1)"
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

grep 逐条按四通道裁定（chrome→--fw-*；内容承载→恒值键/字面；品牌紫→--ve-accent(-text) 档位；hover 提亮 `hover:text-white`（PreviewPlayer:91-:99）→ `hover:text-text` 浅档语义等价）。代表例：`PreviewPlayer.tsx:91` `hover:text-white` → `hover:text-text`；`ExportModal.tsx:245` `text-white`（填充钮白字）→ `text-on-accent`（深 #141414=--fw-on-accent 深值字节等值，浅档同值——**先查 on-accent 两档同 #141414 ✓ 零 diff**）。逐条登记 adjudications。

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

机械配方（每条登记 adjudications）：
- **节点卡 chrome**（ImageGen/Video/MultiImage/TextInput/Text/Storyboard 8 类卡壳）：白卡面/字/边 → `bg-surface`/`text-text`/`border-overlay-2`（深档白→深=P4 级有意变更，逐卡配对登记）；**TextInputNode 文本节点=内容容器整体跟随**（P6 判据"否"分支，浅色下变浅否则违背需求）；
- **媒体容器 checklist**（机械检查项）：`grep -rn "<img\|<video" src/pages/canvas/components/nodes/` 祖先链逐个核——每个媒体容器自持深底（透明 PNG/未加载/poster 未到不露浅底）；
- **悬浮工具条 6 个 + 底部面板 + CanvasToolbar**：`rgb(38,38,38)` 族 → `bg-[var(--canvas-controls-bg)]`（token 已双值）或并域 `bg-surface-dim`（CanvasToolbar.test ×7 rgb(38,38,38) 断言随改——测试分区清单在 registry tests）；
- **selectionTokens.ts 4 处 + StoryboardGroupRenderer #333 组边框/#fffff0 分镜格 + --xy-selection-***：交互可视性双主题值 + 两态可见性实测断言（StoryboardGroupRenderer.test:92/101 改双主题可见性断言，防浅色下选中框消失）；
- **#3a3a3a 族**（spec §11.1 分组）：A 组 size-7 图标钮 ×5（RunButton:14/AudioConfigPanel:270/TextConfigPanel:270/VideoHDPanel:220/VideoConfigPanel:467）同键一次改齐（按钮面 → surface-dim 系）；B 组 tooltip 底 ×2（GenerateCountSelector:30/VideoConfigPanel:432）同键一次改齐（**翻浅后其上 text-white 需同步改 text-text=P7 应用**）；C-F 四处按语义各自裁定勿塌键（C=MultiImageNode:292 徽章、D=TextNodeToolbar:228 文本节点默认底【内容容器】、E=TextNodeToolbar:239 划线色板、F=AudioWaveform:272 波形基线）；3 条测试断言同 commit（AudioConfigPanel.test:99 class*= 正则形态、VideoHDPanel.test:73）；
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

- [ ] **Step 1: 药丸 chrome 化（P7 反例① 结案）**

三处 `bg-[#1A1A1A]/90 backdrop-blur px-… rounded-full border shadow-lg` → `bg-surface/90` 不可用（斜杠禁令）——改 `bg-surface backdrop-blur px-… rounded-full border border-overlay-2 shadow-lg`（不透明化+边 token 化；有意变更登记 `backgroundColor rgba(26,26,26,0.9)→rgb(30,30,30)` 配对）。前景已 token（text-text/userColor 恒定）——P7 面/前景/边一起翻齐。c7 §1 #7 药丸恒深接受项结案标注。

- [ ] **Step 2: CreditsDropdown 浅色实现（mode 分支，深档现状冻结）**

按 Task 19 浅色稿：组件内 `const { mode } = useTheme();`（CreditsDropdown 在 CanvasTopBar 域非 React Flow 节点，不受 §11.1 禁令），`:127` 渐变与 `:271` 图标底按 mode 分支——深档**字面原样保留**（字节等值守卫：differ 深档零 diff），浅档用稿值；`:267` 邀请卡族不动。有意变更（浅档）不产生深档 diff，浅色档经 B6 目检（Task 27）。登记 adjudications + differExpectedPairs（若浅档采集对照）。

- [ ] **Step 3: AnnotationToolbar 五件套（P7 反例② 专项）**

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
cd /d/flowweb && git add apps/web/src/pages/canvas/ apps/web/e2e/audit/ && git commit -m "feat(web): C8 D3-chrome 专项——顶栏三药丸 chrome 化(bg-surface+overlay-2 边，P7 反例①结案)+CreditsDropdown 浅色实现(mode 分支/深档字面冻结字节等值/邀请卡族保留)+AnnotationToolbar 五件套原子翻(token 化+黑笔保留，inlineStylePartition 显式清单)+Lighting/Angle3D chrome 面板迁移(渲染产物 5 文件白名单勿动)"
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

① registry 分区逐条 `核销` 标注（每文件 adjudications 有裁定或豁免依据）；② 浅色档探针（d-segment 全绿——每跟随面取期望浅值、内容面取深值）；③ B6 目检清单待 Task 27 执行（本任务先登记清单）。hex 键数不增核验：`node scripts/lint-gate.mjs`（重键口径 lint-gate.mjs:139）。

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

表格核对（已完成段标注、遗漏补齐）：G1/G2/G3/G7（Task 9）✓、G4 ve（Task 21）✓、G8①②③（Task 16/20）✓、a0 探针 ×4 分级（:200 保持/:220 保持/:221 Task 17/:250 Task 21）✓、CanvasView.test 镜像（Task 17）✓、canvas+videos 颜色断言 ≥24 条（随 Task 20/22 各域原子对）✓、ve TimelinePanel.render.test:115-131 **不动**（clip 类型色=内容语义）✓、c7/c5/c3/B0/b2/b6 登记档（Task 16/21/24/25）✓、video-editor.md:289 复活+`:291` 废止注改写（本步）、a0 叙事注释（本步）、router.tsx/tailwind.config.ts（Task 25）✓。

- [ ] **Step 3: G8④ admin 守卫复核（不动）+ 全 e2e + commit**

G8④ admin Popconfirm 现状守卫**保持不动**（admin 域不在本期范围）。跑全门禁后 commit：

```bash
cd /d/flowweb/apps/web && npx playwright test && npx vitest run && node scripts/lint-gate.mjs
cd /d/flowweb && git add apps/web/e2e/ docs/superpowers/specs/ && git commit -m "test(e2e): C8 D4-a 断言矩阵新形态——跟随/残余真岛/内容承载恒深三组终态+ProcessSnapshot 恒深断言补全+§12.2 全域反转清单逐条核销+video-editor.md 原始亮色规格复活(:289/:291)+a0 叙事注释重写+c7 接受项失效改写(#1/2/3/7+§3 归因 484 条方向反转)"
```

---

## Task 27（D4-b）: 全门禁 + B6 真实浅色对照 + 性能实测双探针 + 已知接受项终版

- [ ] **Step 1: 性能实测①——render 计数探针（vitest，D4 主据）**

新增 `apps/web/src/pages/canvas/components/CanvasView.theme-perf.test.tsx`：

```tsx
// C8 D4 性能实测双探针之一（spec §11.1）：切换主题一次，节点组件 render 次数预期 0——
// 只有 CanvasView 重渲染（禁 useTheme 收益的直接验证）。节点 memo + 零主题订阅 → 不重渲。
import { render, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
// 复用 CanvasView.test 既有 store mock 骨架（mockNodes 等），另注入 render 计数节点：
const renders = { count: 0 };
const CountingNode = () => { renders.count++; return <div data-testid="counting-node" />; };
// …按 CanvasView.test.tsx 既有 mock 结构注册 nodeTypes.counting，铺 50 个 counting 节点…
describe('CanvasView 主题切换性能', () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear(); renders.count = 0; });
  it('setMode 切换一次主题：节点组件 render 次数 = 0（只有 CanvasView 重渲染）', async () => {
    const { setMode } = await import('@/stores/themeStore');
    const { CanvasView } = await import('./CanvasView');
    render(<ReactFlowProvider><CanvasView projectId="p1" /></ReactFlowProvider>);
    const before = renders.count;
    act(() => setMode('light'));
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(renders.count - before, '节点组件不得因主题切换重渲染（禁 useTheme 纪律的机制验证）').toBe(0);
  });
});
```

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
| D0-0 | Task 1-5 | 零产品改动；before-D 入档（attrSetVersion D1）；探针钉深全绿；自比自跑 0 噪声 |
| D0 | Task 6-10 | 两态 DOM 类断言；'system' 存储→dark；matchMedia 计数 0；segcheck-D0×before-D = 0 diff |
| D1a | Task 11-13 | 深档 0 diff（segcheck-D1a）；浅档新值可读（contrast-table 在册）；死键删；块唯一+源序 |
| D1b | Task 14-16 | diff 与 §9.2 总清单逐条配对（absorbed>0、unexpected=0）；`var(--canvas-` ve 域 0 命中；WeChat html.light 浅值 |
| D2 | Task 17-18 | 以 D1b 后为参照深档像素 0 diff；--xy-* 复测表；镜像断言绿 |
| D3 | Task 19-25 | registry 分区逐条核销 + 浅探针每面期望值 + B6 目检清单；hex 键数不增；白名单净减 4 目录/净增 K 精确文件 |
| D4 | Task 26-27 | 断言矩阵三组 + §12.2 核销 + 全门禁 + B6 真实对照 + 性能双探针 |

## 附录 B: 全程禁令速查

- 禁 `UPDATE_BASELINE=1` 重采（B5）；A5 旧基线对（before-A0×after-A）冻结不动。
- 禁重构与有意视觉变更同 commit；每域岛拆除与断言反转同 commit（原子对）。
- 禁浅色档验收落 D2–D3 空隙（§13.3）；D1b↔D2↔D3 板面批次连续收口。
- 禁 `pages/canvas/components/{nodes,groups}/**` 内 useTheme（CanvasView colorMode 例外）。
- 禁 tailwind.config.ts 加 colors 映射（§5——任意值 var 形式即可，勿增 baseline 键）。
- 禁通道 3 中性色 token 化（scrim/阴影/邀请卡白族——明文保留）。
- 禁 SVG 呈现属性走 var()（stroke=/fill= 一律 JS 分支或字面恒定——GridIcon 先例）。

