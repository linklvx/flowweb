// B0 语义 token 双套落地——三态回归守卫（常驻默认套件）：
//   组1 默认态（/works，无 theme 存储）：C1 起 html 恒挂 .dark → 16 token 全部 = 深色值（默认深兜底 D3；
//     v1.6 前「无类」态自 C1 起运行时不可达，:root 无 JS 回退退化为机制兜底）+ color-scheme:dark；
//   组2 html.dark：仅命中 `:root,.dark` 块 → 仍全深色值（.dark 与 :root 同块同值）；
//   组3 html.light：html 同时命中 :root 与 .light（均 (0,1,0)）→ 源序在后者胜——全量 token = 浅色值
//     （D8 源序机制的行为级预验证：.light 块必须写在 :root,.dark 之后）+ color-scheme:light；
//   组4 login 恒浅岛：岛根（div.light）浅色值生效、html 保持深色（岛作用域机制预验证，B2 消费）；
//   组5 ::placeholder 语义化（dim-2）：var 逐作用域解析——岛内 rgb(107,114,128) / html 域 rgba(255,255,255,0.45)。
// 自定义属性计算值 = 指定 token 流（引擎不重解析颜色），断言按「去全部空白 + 小写」归一比较。
// 加载稳定性纪律：目标元素出现 + 有界超时；禁 networkidle（socket.io/ws 长连接 + antd 动画永不安定）。
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';

const HERE = import.meta.dirname!;
const USER_STATE = path.join(HERE, '.auth', 'user.json');

/** B0 定稿 16 token（light 值校准记录见提交说明：accent-text/danger/dim 阶梯 WCAG 比对） */
const TOKENS = [
  '--fw-bg', '--fw-surface', '--fw-surface-dim', '--fw-border',
  '--fw-text', '--fw-text-strong', '--fw-text-dim-1', '--fw-text-dim-2', '--fw-text-dim-3',
  '--fw-accent', '--fw-accent-text', '--fw-on-accent', '--fw-accent-danger',
  '--fw-overlay-1', '--fw-overlay-2', '--fw-overlay-3',
] as const;

/** 深色值 = 现状实测（index.css body 与 --vw-*、--ve-* 既有值原样收编） */
const DARK: Record<string, string> = {
  '--fw-bg': '#141414',
  '--fw-surface': '#1e1e1e',
  '--fw-surface-dim': '#262626',
  '--fw-border': '#333',
  '--fw-text': '#e2e8f0',
  '--fw-text-strong': 'rgb(247,247,247)',
  '--fw-text-dim-1': 'rgba(255,255,255,0.3)',
  '--fw-text-dim-2': 'rgba(255,255,255,0.45)',
  '--fw-text-dim-3': 'rgba(255,255,255,0.6)',
  '--fw-accent': '#4ade80',
  '--fw-accent-text': '#4ade80',
  '--fw-on-accent': '#141414',
  '--fw-accent-danger': '#ef4444',
  '--fw-overlay-1': 'rgba(255,255,255,0.05)',
  '--fw-overlay-2': 'rgba(255,255,255,0.1)',
  '--fw-overlay-3': 'rgba(255,255,255,0.2)',
};

/** 浅色值 = B0 校准定稿（对比度记录见提交说明） */
const LIGHT: Record<string, string> = {
  '--fw-bg': '#f7f8fa',
  '--fw-surface': '#ffffff',
  '--fw-surface-dim': '#f0f1f2',
  '--fw-border': '#e5e7eb',
  '--fw-text': '#1f2329',
  '--fw-text-strong': '#111827',
  '--fw-text-dim-1': '#9ca3af',
  '--fw-text-dim-2': '#6b7280',
  '--fw-text-dim-3': '#4b5563',
  '--fw-accent': '#4ade80',
  '--fw-accent-text': '#15803d',
  '--fw-on-accent': '#141414',
  '--fw-accent-danger': '#dc2626',
  '--fw-overlay-1': 'rgba(0,0,0,0.03)',
  '--fw-overlay-2': 'rgba(0,0,0,0.06)',
  '--fw-overlay-3': 'rgba(0,0,0,0.12)',
};

/** C8 D1a 域 token 双值化（spec §8.1 表）——深值=现状冻结；浅值=D1b 并域目标键浅值 */
const DOMAIN_TOKENS = [
  '--canvas-board-bg', '--canvas-board-dot', '--canvas-controls-bg', '--canvas-controls-border',
  '--canvas-controls-text', '--canvas-controls-hover', '--canvas-controls-active', '--canvas-controls-icon',
  '--canvas-handle-bg', '--canvas-handle-icon',
  '--canvas-handle-hover-bg', '--canvas-handle-hover-icon', '--edge-flow-color', '--edge-highlight-color',
  '--ve-border', '--ve-text-dim', '--ve-accent', '--ve-accent-text',
] as const;

const DOMAIN_DARK: Record<string, string> = {
  '--canvas-board-bg': '#000000',
  '--canvas-board-dot': '#555555',
  '--canvas-controls-bg': 'rgb(38,38,38)',
  '--canvas-controls-border': '#333',
  '--canvas-controls-text': 'rgb(247,247,247)',
  '--canvas-controls-hover': 'rgba(255,255,255,0.1)',
  '--canvas-controls-active': 'rgba(255,255,255,0.12)',
  '--canvas-controls-icon': 'rgb(160,160,160)',
  '--canvas-handle-bg': '#9ca3af',
  '--canvas-handle-icon': '#6b7280',
  '--canvas-handle-hover-bg': '#ffffff',
  '--canvas-handle-hover-icon': '#ffffff',
  '--edge-flow-color': '#3b82f6',
  '--edge-highlight-color': '#999',
  '--ve-border': '#333',
  '--ve-text-dim': 'rgba(226,232,240,0.6)',
  '--ve-accent': '#6c5ce7',
  '--ve-accent-text': '#9b8cf7',
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
  '--ve-border': '#e5e7eb',
  '--ve-text-dim': '#4b5563',
  '--ve-accent': '#6c5ce7',
  '--ve-accent-text': '#5f4fd1',
};

/** 归一化读作用域元素上全部 token 计算值 + color-scheme。
 * 归一 = 去空白 + 小写 + 小数补前导零（引擎序列化数字去前导零：0.3 → .3，两侧统一回 0.3）。 */
function readTokens(page: Page, selector: string, tokens: string[] = [...TOKENS]) {
  return page.evaluate(
    ({ sel, tokens }) => {
      const el = sel === 'html' ? document.documentElement : document.querySelector(sel);
      if (!el) throw new Error(`B0 探针元素不存在: ${sel}`);
      const cs = getComputedStyle(el);
      const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase().replace(/(\D)\.(\d)/g, '$10.$2');
      const out: Record<string, string> = { __colorScheme: cs.colorScheme };
      for (const t of tokens) out[t] = norm(cs.getPropertyValue(t));
      return out;
    },
    { sel: selector, tokens },
  );
}

function expectAllTokens(actual: Record<string, string>, expected: Record<string, string>, label: string) {
  const snap = JSON.stringify(actual);
  for (const t of TOKENS) {
    expect(actual[t], `[${label}] ${t} 期望 ${expected[t]}；实际快照=${snap}`).toBe(expected[t]);
  }
}

/** 已登录 /works（gate USER storageState）；门禁画布行可见即就绪 */
async function openWorks(page: Page) {
  await page.goto('/works');
  await expect(page.getByText('A0-0 门禁画布').first()).toBeVisible({ timeout: 15_000 });
}

/** 公开 /login；邮箱登录按钮可见即就绪（a1 同锚点） */
async function openLogin(page: Page) {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: '邮箱登录' })).toBeVisible();
}

test.describe('B0-1 默认态 = 深色值（C1 起 html 恒挂 .dark；:root,.dark 同块同值，D3）', () => {
  test('/works：16 token 全部深色值 + color-scheme dark', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: USER_STATE });
    const page = await ctx.newPage();
    try {
      await openWorks(page);
      // 前置：C1 防闪白脚本契约——无 theme 存储时 html 恒有且仅 .dark（默认深兜底；v1.6 前的「无类」态
      // 自 C1 起运行时不可达，:root 无 JS 回退退化为机制兜底，机制等价由本组 + B0-2 覆盖）
      expect(await page.evaluate(() => document.documentElement.className), '[G1] html 应恰挂 dark（C1 默认深）').toBe('dark');
      const s = await readTokens(page, 'html');
      expectAllTokens(s, DARK, 'G1-默认深');
      expect(s.__colorScheme, '[G1] html.dark color-scheme 期望 dark（:root,.dark 同块同值）').toBe('dark');
    } finally {
      await ctx.close();
    }
  });
});

test.describe('B0-2 html.dark：仅命中深色块', () => {
  test('挂 .dark 后 16 token 仍全深色值（.dark 与 :root 同块同值，机制等价）', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: USER_STATE });
    const page = await ctx.newPage();
    try {
      await openWorks(page);
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      const s = await readTokens(page, 'html');
      expectAllTokens(s, DARK, 'G2-dark');
      expect(s.__colorScheme, '[G2] html.dark color-scheme 期望 dark').toBe('dark');
    } finally {
      await ctx.close();
    }
  });
});

test.describe('B0-3 html.light：双命中源序裁定（D8 预验证）', () => {
  test('html 同时命中 :root 与 .light（同 (0,1,0)）→ 源序在后 .light 胜：全量浅色值', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: USER_STATE });
    const page = await ctx.newPage();
    try {
      await openWorks(page);
      await page.evaluate(() => document.documentElement.classList.add('light'));
      const s = await readTokens(page, 'html');
      expectAllTokens(s, LIGHT, 'G3-light源序胜');
      expect(s.__colorScheme, '[G3] html.light color-scheme 期望 light（.light 块源序在后压 :root,.dark 的 dark）').toBe('light');
    } finally {
      await ctx.close();
    }
  });
});

test.describe('B0-4 login 恒浅岛：岛根浅色值生效、html 保持深色', () => {
  test('岛根（div.light）抽查浅色值 + html --fw-border=#333（岛作用域机制预验证）', async ({ page }) => {
    await openLogin(page);
    const root = page.locator('div.light').first();
    await expect(root).toBeVisible();
    const s = await readTokens(page, 'div.light');
    // 抽查 3 枚覆盖三族：面（bg）/边（border）/文本（text-dim-2）——全量三态断言已由组1-3 覆盖
    expect(s['--fw-bg'], '[G4] 岛根 --fw-bg 期望浅色值 #f7f8fa').toBe('#f7f8fa');
    expect(s['--fw-border'], '[G4] 岛根 --fw-border 期望 #e5e7eb（A2 起既有）').toBe('#e5e7eb');
    expect(s['--fw-text-dim-2'], '[G4] 岛根 --fw-text-dim-2 期望 #6b7280（B0 扩展岛作用域全量 token）').toBe('#6b7280');
    expect(s.__colorScheme, '[G4] 岛根 color-scheme 期望 light').toBe('light');
    const html = await readTokens(page, 'html');
    expect(html['--fw-border'], '[G4] html（岛外）--fw-border 保持深色 #333——岛机制只改岛内作用域').toBe('#333');
    expect(html.__colorScheme, '[G4] html color-scheme 保持 dark').toBe('dark');
  });
});

test.describe('B0-5 ::placeholder 语义化（dim-2，var 逐作用域解析）', () => {
  test('岛内 input::placeholder=rgb(107,114,128)；html 域=rgba(255,255,255,0.45)', async ({ page }) => {
    await openLogin(page);
    const s = await page.evaluate(() => {
      const mk = () => {
        const i = document.createElement('input');
        i.placeholder = 'b0-placeholder-probe';
        return i;
      };
      const darkScope = mk();
      document.body.appendChild(darkScope); // html 域（无 .light 祖先）→ 深色套
      const island = document.querySelector('div.light')!;
      const lightScope = mk();
      island.appendChild(lightScope); // 岛根内 → 浅色套
      const out = {
        darkScope: getComputedStyle(darkScope, '::placeholder').color,
        lightScope: getComputedStyle(lightScope, '::placeholder').color,
      };
      darkScope.remove();
      lightScope.remove();
      return out;
    });
    const snap = JSON.stringify(s);
    expect(s.darkScope, `[G5] html 域 input::placeholder 期望 rgba(255, 255, 255, 0.45)（--fw-text-dim-2 深色值，取代 preflight #9ca3af）；实际=${snap}`).toBe('rgba(255, 255, 255, 0.45)');
    expect(s.lightScope, `[G5] 岛内 input::placeholder 期望 rgb(107, 114, 128)（--fw-text-dim-2 浅色值 #6b7280）；实际=${snap}`).toBe('rgb(107, 114, 128)');
  });
});

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
