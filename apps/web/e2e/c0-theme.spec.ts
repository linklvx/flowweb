// C0 主题套件（plan C0→C7，spec §4.1/§8）：主题切换 C 段常驻门禁——C 段 TDD 期间 C0_RED env 守卫
// 分组红/绿，C7 撤守卫全量转常驻：默认 `npx playwright test` 含本文件 19 用例（C8 D0 两态化后；
// 全量门禁总数不在此写死，避免随删例失真漂移）。组内【红→Cx 绿】标注为 TDD 期历史实证，保留备考。
//
// 生命周期（终态）：
//   组1 三态持久化映射【红→C1 绿】（localStorage theme ∈ {light,dark,system}，system 经 matchMedia 解析；
//     无存储 → html.dark = D3 默认深色兜底，非"跟随系统"——OS light 下仍 dark 钉死该语义）
//     （C8 D0 两态化：system 例删——残留映射深由 themeStore 单测覆盖）；
//   组2 首帧无闪白【红→C1 绿】（运行时：MutationObserver 首录 html 主题类先于首个渲染内容——#root 尚空；
//     静态：head 内联主题脚本含 theme/localStorage、不含 matchMedia（调用形态判别）、无 defer/async、
//     先于 <script type="module">）；
//   组3 持久化 + 显式/系统解析区分【红→C1 绿】（显式 light 压过 OS dark；两态模型 OS 零影响 +
//     prefers-color-scheme matchMedia 调用计数 0 由 G3 断言）（C8 D0 两态化：system 例删——原「system 档
//     同页随 OS 实时翻转 + C1 matchMedia change 监听重解析重挂，spec §4.1 脚本契约」随两态模型移除，备考）；
//   组4 岛三组对照 + 持续断言【红→C1/C2 绿】（login 岛=红因 html.dark 缺失→C1 绿；admin/video-editor 岛=
//     红因岛根无 .dark 类→C2 绿；「html 恒有且仅有 .light/.dark 之一」持续断言仅放本 C 段文件——
//     v1.3 标注：A/B 段 html 无类是合法历史状态，此断言在 A/B 必误红）；
//   组5 岛子树无 dark: 前缀守卫【守卫，恒绿】（措辞固化 spec §4.2：断 `dark:` 前缀，不断"dark 类名"——
//     react-flow wrapper 自带 light/dark 运行时类同名实证合法；全仓 dark: 使用实测 0）。
//   组6 岛断言只落 Playwright【声明条目，无独立用例】：vitest 不落岛/颜色断言——test-setup 清空含 :has( 的
//     antd 样式 + jsdom 不解析 CSS 变量，vitest 拿不到可判颜色（spec §8 D8）。
//   组7 切换 UI【红→C4 绿】TopActionBar 两态往返钮（默认深→浅→深，aria/图标随态；钮存在性三路由）
//     + LoginModal 恒浅活体断言
//     【守卫，现状应绿】（C2 复核遗留项：rootClassName="light" 落 .ant-modal-root，宿主深下后代经继承取浅值）。
//   组8 O5 portal 弹层 closest 矩阵【部分红→C5 绿 / 部分守卫】两通道穿透不对称的落地验收：
//     antd token 经 React context 穿透 portal ✓；--fw-* 经 DOM 继承不穿透 ✗ → body 挂载弹层须自带岛类。
//     ①WeChatFollowModal 恒深岛 × 宿主浅【红→C5 绿】（字面深底 #1e1e1e + B2 已迁 text-text——无岛时 html.light
//       下浅值文字落深底=半半；O5 初判表曾归"营销恒浅"，实测宿主=Sidebar chrome 跟随域、设计=深色自绘 → 按实测订正恒深）；
//     ②videos 壳跟随域【红→C5 绿→C8 D3 反转】（壳根 dark 类删除改跟随 + 壳底 bg-bg；媒体容器自持 bg-black
//       [color-scheme:dark] 压画面恒深——P3 拆两层；列表页 [data-vw-shell] count=0 + 卡面浅值断言随本组）；
//     ③壳内 LoginModal 恒浅 × 双浅对照【守卫绿】（html.light × 壳跟随浅 × 登录层浅岛——原"双层相反"叙事随
//       C8 D3 壳岛消亡，LoginModal 岛断言保持）；
//     ④admin Popconfirm body 弹层 × 宿主浅【守卫，现状裁定】（antd 通道恒深=Pro dark context 穿透；var 通道
//       closest(.dark)=null 为登记缺口——admin 全域 0 个 --fw-* 工具类消费文件（grep 实证），弹层自绘不消费
//       --fw-* → 无可见半半，岛类挂起至 admin token 化（c5-portal-census.json）。
//
// 加载稳定性纪律：目标元素出现 + 有界超时；禁 networkidle（socket.io/ws 长连接 + antd 动画永不安定）。
// 上下文纪律：每用例独立新 context（storageState 不跨用例泄漏）；localStorage theme 经 addInitScript
//   在任何页面脚本（含 C1 内联脚本）之前落键；fresh 用例显式 removeItem 防未来 user.json 污染。
import path from 'node:path';
import { test, expect, type Browser, type Page } from '@playwright/test';

const HERE = import.meta.dirname!;
const USER_STATE = path.join(HERE, '.auth', 'user.json');
const ADMIN_CREDENTIALS = { email: 'admin@flowweb.local', password: 'admin12345' }; // 与 globalSetup/gate-seed 同值
const ADMIN_HOME = '/admin/models';

/** token 计算值归一（与 b0 同口径：去空白 + 小写——引擎按源文本回出自定义属性值） */
const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase();

type ThemeClass = 'light' | 'dark';
type StoredTheme = 'light' | 'dark';

interface HtmlThemeState {
  raw: string;
  classes: string[];
  themeClasses: string[];
}

/** 读 html 主题类快照（raw 原样回显进红因 message） */
async function readHtmlTheme(page: Page): Promise<HtmlThemeState> {
  return page.evaluate(() => {
    const classes = Array.from(document.documentElement.classList);
    return {
      raw: document.documentElement.className,
      classes,
      themeClasses: classes.filter((c) => c === 'light' || c === 'dark'),
    };
  });
}

/** 断 html 主题类恰为 expected 一个（C1 脚本契约：恒有且仅有 .light/.dark 之一） */
function expectHtmlTheme(state: HtmlThemeState, expected: ThemeClass, label: string) {
  expect(state.themeClasses, `${label} html 主题类必须恰为 ["${expected}"]；实际 className="${state.raw}"`).toEqual([expected]);
}

/** 新建种子会话上下文 + 预置/清除 localStorage theme（init script 先于一切页面脚本执行） */
async function newSeededContext(browser: Browser, theme: StoredTheme | null) {
  const ctx = await browser.newContext({ storageState: USER_STATE });
  if (theme === null) await ctx.addInitScript(() => localStorage.removeItem('theme'));
  else await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme);
  return ctx;
}

/** 已登录 /works；门禁画布行可见即就绪（b0/b1 同锚点） */
async function openWorks(page: Page) {
  await page.goto('/works');
  await expect(page.getByText('A0-0 门禁画布').first()).toBeVisible({ timeout: 15_000 });
}

/** 公开 /login；邮箱登录按钮可见即就绪（a0-0/a1/b0 同锚点） */
async function openLogin(page: Page) {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: '邮箱登录' })).toBeVisible();
}

/** 已登录 /videos；门禁样例视频可见即就绪（a0-collect 同锚点） */
async function openVideos(page: Page) {
  await page.goto('/videos');
  await expect(page.getByText('A0-0 门禁样例视频').first()).toBeVisible({ timeout: 15_000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// 组1【红→C1 绿】三态持久化映射（无 UI 依赖——只经 localStorage + 加载断 html 类）
// ─────────────────────────────────────────────────────────────────────────────
const THREE_STATE_CASES: Array<{ id: string; stored: StoredTheme | null; scheme: 'light' | 'dark'; expected: ThemeClass; why: string }> = [
  { id: 'light', stored: 'light', scheme: 'light', expected: 'light', why: '显式 light → html.light' },
  { id: 'dark', stored: 'dark', scheme: 'dark', expected: 'dark', why: '显式 dark → html.dark' },
  { id: '无存储默认深', stored: null, scheme: 'light', expected: 'dark', why: 'D3 默认深色兜底——刻意配 OS light：钉死「默认=深」而非「默认=跟随系统」' },
];

for (const c of THREE_STATE_CASES) {
  test(`G1 两态持久化（light/dark/无存储默认深）：${c.id} → html.${c.expected}（${c.why}）`, async ({ browser }) => {
    const ctx = await newSeededContext(browser, c.stored);
    const page = await ctx.newPage();
    try {
      await page.emulateMedia({ colorScheme: c.scheme });
      await openWorks(page);
      expectHtmlTheme(await readHtmlTheme(page), c.expected, `[G1/${c.id}]`);
    } finally {
      await ctx.close();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 组2【红→C1 绿】首帧无闪白（产物门禁 = vite preview，本构建即产品产物；spec §8 两判据）
// ─────────────────────────────────────────────────────────────────────────────
test('G2 运行时：html 主题类先于首个渲染内容挂上（MutationObserver 首录 #root 尚空）', async ({ browser }) => {
  const ctx = await newSeededContext(browser, 'light'); // 确定性用例：显式 light
  const page = await ctx.newPage();
  try {
    // init script 在一切页面脚本（含 C1 内联主题脚本）之前装观察器——documentElement 尚未解析时
    // 经 document childList 观察补挂（html 元素插入先于 head 内任何脚本执行）
    await page.addInitScript(() => {
      const rec = { firstThemeClass: null as string | null, rootChildCountAtFirstClass: -1, bodyExistedAtFirstClass: false };
      (window as unknown as Record<string, unknown>).__c0FirstPaint = rec;
      const record = () => {
        const html = document.documentElement;
        if (!html || rec.firstThemeClass !== null) return;
        const theme = Array.from(html.classList).find((cls) => cls === 'light' || cls === 'dark');
        if (theme === undefined) return;
        rec.firstThemeClass = theme;
        rec.bodyExistedAtFirstClass = !!document.body;
        rec.rootChildCountAtFirstClass = document.getElementById('root')?.childElementCount ?? 0;
      };
      const attach = () => {
        new MutationObserver(record).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        record(); // 类可能在装观察器前已被内联脚本挂上——立即补录一次
      };
      if (document.documentElement) attach();
      else new MutationObserver((_mutations, mo) => {
        if (document.documentElement) { mo.disconnect(); attach(); }
      }).observe(document, { childList: true });
    });
    await openWorks(page);
    // 终态自证：html.light 已就位（与 G1 同口径，排除"观察器装晚了没录到"的假红）
    expectHtmlTheme(await readHtmlTheme(page), 'light', '[G2/终态自证]');
    const rec = await page.evaluate(() => {
      const r = (window as unknown as { __c0FirstPaint?: { firstThemeClass: string | null; rootChildCountAtFirstClass: number; bodyExistedAtFirstClass: boolean } }).__c0FirstPaint;
      return { found: !!r, ...(r ?? { firstThemeClass: null, rootChildCountAtFirstClass: -1, bodyExistedAtFirstClass: false }) };
    });
    expect(rec.firstThemeClass, '[G2] html 从未获得主题类（红因=无 head 内联主题脚本）；首录快照=' + JSON.stringify(rec)).toBe('light');
    expect(rec.rootChildCountAtFirstClass, '[G2] 主题类必须先于首个渲染内容（首录时 #root 应为空——React 内容未挂载）；首录快照=' + JSON.stringify(rec)).toBe(0);
  } finally {
    await ctx.close();
  }
});

test('G2 静态：head 内联主题脚本（含 theme/localStorage、不含 matchMedia、无 defer/async）先于 <script type="module">', async ({ browser }) => {
  const ctx = await browser.newContext(); // 纯 HTML 静态检查，无需会话
  const page = await ctx.newPage();
  try {
    const res = await page.request.get('/');
    expect(res.status(), '[G2-静态] 首页 HTML 可取').toBe(200);
    const html = await res.text();
    const headEnd = html.indexOf('</head>');
    const moduleIdx = html.search(/<script[^>]*type="module"/);
    expect(moduleIdx, '[G2-静态] 产物 HTML 应含 <script type="module">（vite 注入 head）').toBeGreaterThan(0);
    // 内联 = 无 src/type/defer/async 属性；主题脚本内容契约 = 读 localStorage theme、不含 matchMedia 调用
    //（C8 两态无 system 档；判别式取调用形态 matchMedia\( 而非裸词——index.html 注释「不 matchMedia」含裸词，裸词判别必误红）
    const inlineRe = /<script(?![^>]*\bsrc=)(?![^>]*\btype=)(?![^>]*\bdefer)(?![^>]*\basync)[^>]*>([\s\S]*?)<\/script>/g;
    let themeScriptIdx = -1;
    let m: RegExpExecArray | null;
    while ((m = inlineRe.exec(html)) !== null) {
      if (/theme/.test(m[1]!) && /localStorage/.test(m[1]!) && !/matchMedia\(/.test(m[1]!)) { themeScriptIdx = m.index; break; }
    }
    expect(themeScriptIdx, '[G2-静态] 未找到 head 内联主题脚本（含 theme/localStorage、不含 matchMedia、无 defer/async）').toBeGreaterThanOrEqual(0);
    expect(themeScriptIdx, '[G2-静态] 内联主题脚本必须位于 <head> 内').toBeLessThan(headEnd);
    expect(themeScriptIdx, '[G2-静态] 内联主题脚本必须先于 module 脚本（防首帧闪白——module 加载执行前类已挂）').toBeLessThan(moduleIdx);
  } finally {
    await ctx.close();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 组3【红→C1 绿】持久化 + 显式/系统解析区分（spec §4.1：手选浅色后系统切深不覆盖 + change 监听）
// ─────────────────────────────────────────────────────────────────────────────
test('G3 显式 light 压过 OS dark（explicit wins over media）', async ({ browser }) => {
  const ctx = await newSeededContext(browser, 'light');
  const page = await ctx.newPage();
  try {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openWorks(page);
    expectHtmlTheme(await readHtmlTheme(page), 'light', '[G3/显式压媒体]');
  } finally {
    await ctx.close();
  }
});

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

// ─────────────────────────────────────────────────────────────────────────────
// 组4【红→C1/C2 绿】岛三组对照 + 持续断言
//   宿主深×岛浅 /login【红因=html.dark 缺失→C1 绿，岛半现状已绿（b0-G4）】；
//   宿主浅×岛深 /admin、video-editor【红因=岛根无 .dark→C2 绿；--fw-bg 半：现状 html 无类继承深=绿，
//     C1 后 html.light 继承浅=红，C2 岛根 .dark 重新声明=绿——token 半按 C2 收口】；
//   持续断言「html 恒有且仅有 .light/.dark 之一」三页【红因=零类→C1 绿；仅存本 C 段文件（v1.3 标注）】。
// ─────────────────────────────────────────────────────────────────────────────
test('G4 宿主深×岛浅：/login 岛根（div.light）token 浅、html.dark（theme=dark 强制宿主深）', async ({ browser }) => {
  const ctx = await newSeededContext(browser, 'dark');
  const page = await ctx.newPage();
  try {
    await openLogin(page);
    const island = page.locator('div.light').first();
    await expect(island, '[G4/login] 恒浅岛根 div.light 应存在').toBeVisible();
    const islandBg = await island.evaluate((el) => getComputedStyle(el).getPropertyValue('--fw-bg'));
    expect(norm(islandBg), '[G4/login] 岛根 --fw-bg 必须保持浅色 #f7f8fa（岛作用域不随宿主）').toBe('#f7f8fa');
    expectHtmlTheme(await readHtmlTheme(page), 'dark', '[G4/login 宿主深]');
  } finally {
    await ctx.close();
  }
});

test('G4 宿主浅×岛深：/admin 岛（C2 挂岛根 .dark）closest 命中 + 岛内 --fw-bg 钉深 #141414（theme=light）', async ({ browser }) => {
  const ctx = await browser.newContext(); // admin 走 UI 登录（采集器同款流程），不带 USER 态
  await ctx.addInitScript((t) => localStorage.setItem('theme', t), 'light');
  const page = await ctx.newPage();
  try {
    await page.goto('/login');
    await page.getByRole('button', { name: '邮箱登录' }).click();
    await page.getByPlaceholder('邮箱').fill(ADMIN_CREDENTIALS.email);
    await page.getByPlaceholder('密码').fill(ADMIN_CREDENTIALS.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByTestId('auth-modal-backdrop')).toBeHidden({ timeout: 15_000 });
    await page.goto(ADMIN_HOME);
    await expect(page).toHaveURL(/\/admin\/models/);
    await expect(page.getByText('模型管理').first()).toBeVisible({ timeout: 15_000 });
    expectHtmlTheme(await readHtmlTheme(page), 'light', '[G4/admin 宿主浅]');
    // 探针 = 菜单项「模型管理」（岛内代表元素）：closest 上溯应命中岛根 .dark（C2 落点，ProLayout 岛根/包裹层）
    const probe = page.getByText('模型管理').first();
    const probeState = await probe.evaluate((el) => ({
      islandDark: el.closest('.dark') !== null,
      fwBg: getComputedStyle(el).getPropertyValue('--fw-bg'),
    }));
    expect(probeState.islandDark, '[G4/admin] 岛内代表元素 closest(".dark") 应命中岛根——C2 给 AdminLayout 岛根挂 .dark 前必红（现状无岛类）').toBe(true);
    expect(norm(probeState.fwBg), '[G4/admin] 岛内 --fw-bg 必须钉深 #141414（岛根 .dark 重新声明压过 html.light 继承）——C2 前必红').toBe('#141414');
  } finally {
    await ctx.close();
  }
});

test('G4 宿主浅×岛深：video-editor 壳根（C2 挂 .dark）closest 命中 + 壳 --fw-bg 钉深 #141414（theme=light）', async ({ browser }) => {
  const ctx = await newSeededContext(browser, 'light');
  const page = await ctx.newPage();
  try {
    await page.goto('/canvas?projectId=gate-canvas-1');
    await expect(page.locator('.react-flow__node[data-id="gate-node-1"]')).toBeVisible({ timeout: 20_000 });
    try {
      // video-editor 无独立路由——真实 UI 流开编辑器（采集器同款：添加节点→多轨道剪辑→全屏编辑）
      await page.getByRole('button', { name: '添加节点' }).click();
      await page.getByRole('menuitem', { name: /多轨道剪辑/ }).click();
      await expect(page.getByRole('button', { name: '⤢ 全屏编辑' }).first()).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: '⤢ 全屏编辑' }).first().click();
      await expect(page.getByTestId('video-editor-shell')).toBeVisible({ timeout: 10_000 });

      expectHtmlTheme(await readHtmlTheme(page), 'light', '[G4/video-editor 宿主浅]');
      const shellState = await page.getByTestId('video-editor-shell').evaluate((el) => ({
        islandDark: el.closest('.dark') !== null,
        fwBg: getComputedStyle(el).getPropertyValue('--fw-bg'),
      }));
      expect(shellState.islandDark, '[G4/video-editor] 壳根 closest(".dark") 应命中——C2 给 VideoEditorShell 壳根挂 .dark 前必红').toBe(true);
      expect(norm(shellState.fwBg), '[G4/video-editor] 壳根 --fw-bg 必须钉深 #141414（岛根 .dark 重新声明压过 html.light 继承）——C2 前必红').toBe('#141414');
    } finally {
      // 清理（采集器同款，红跑后仍复原 gate 画布）：Esc 关编辑器 → 删全部多轨道剪辑节点 → 复原双节点
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('video-editor-shell')).toBeHidden({ timeout: 10_000 });
      for (let i = 0; i < 10; i++) {
        const veNode = page.locator('.react-flow__node', { hasText: '多轨道剪辑' }).first();
        if (!(await veNode.count())) break;
        await veNode.getByText('多轨道剪辑', { exact: true }).click(); // 标题文本非交互区——选中节点
        await page.keyboard.press('Delete');
        await page.waitForTimeout(600); // collab 删除同步窗口
      }
      await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 15_000 });
    }
  } finally {
    await ctx.close();
  }
});

test('G4 持续断言：works/login/videos 三页 html 恒有且仅有 .light/.dark 之一（classList 恰 1 项且属该集合）', async ({ browser }) => {
  const ctx = await newSeededContext(browser, 'light'); // 断的是"恒一类"不变式，非具体哪类——种子任取
  const page = await ctx.newPage();
  try {
    const pages: Array<[string, (p: Page) => Promise<void>]> = [
      ['works', openWorks],
      ['login', openLogin],
      ['videos', openVideos],
    ];
    for (const [name, open] of pages) {
      await open(page);
      const state = await readHtmlTheme(page);
      expect(state.classes.length, `[G4/持续@${name}] html classList 必须恰好 1 个类（C1 脚本契约「恒有且仅有」）；实际=[${state.classes.join(',')}]`).toBe(1);
      expect(['light', 'dark'], `[G4/持续@${name}] 唯一类必须是 light/dark 之一；实际=[${state.classes.join(',')}]`).toContain(state.classes[0]!);
    }
  } finally {
    await ctx.close();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 组5【守卫，现状应绿】岛子树无 dark: 前缀遍历（措辞固化：断前缀不断"dark 类"——react-flow wrapper
//   自带 light/dark 运行时类合法；全仓 dark: 使用实测 0，命中即新增违例须上报）
// ─────────────────────────────────────────────────────────────────────────────
test('G5 岛子树无 dark: 前缀：/works 全 app + /login 岛根（div.light）遍历零命中', async ({ browser }) => {
  const ctx = await newSeededContext(browser, 'light');
  const page = await ctx.newPage();
  try {
    await openWorks(page);
    let hits = await collectDarkPrefix(page, 'body');
    expect(hits, `[G5/works] 跟随域全 app 不应存在 dark: 前缀类；命中=${hits.slice(0, 5).join(' | ')}`).toEqual([]);
    await openLogin(page);
    hits = await collectDarkPrefix(page, 'div.light');
    expect(hits, `[G5/login岛] 岛子树不应存在 dark: 前缀类；命中=${hits.slice(0, 5).join(' | ')}`).toEqual([]);
  } finally {
    await ctx.close();
  }
});

/** 遍历 root + 子树，收集 className 含 dark: 变体前缀的元素（变体段精确匹配 dark——dark-mode:x 不误报） */
function collectDarkPrefix(page: Page, rootSelector: string) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) throw new Error(`[G5] 探针根不存在: ${sel}`);
    const hits: string[] = [];
    const scan = (el: Element) => {
      for (const token of el.classList) {
        // dark: 前缀（含 md:dark: 等叠层变体）= 冒号链的变体段（除最后一段外）恰有 "dark"
        if (token.split(':').slice(0, -1).includes('dark')) {
          hits.push(`${el.tagName.toLowerCase()}[${token}]`);
          break;
        }
      }
    };
    scan(root);
    root.querySelectorAll('*').forEach(scan);
    return hits;
  }, rootSelector);
}

// ─────────────────────────────────────────────────────────────────────────────
// 组7【红→C4 绿】切换 UI（TopActionBar 两态往返钮，plan C4 + §8 裁定：入口=TopActionBar、
//   两态往返；/videos 跟随域（C8 D3 拆路由岛）内切换钮可见同 /works，无岛语义）
// ─────────────────────────────────────────────────────────────────────────────

/** 两态 → aria-label 态名 + antd 图标类（当前态驱动图标/aria/title，点击切下一档） */
const THEME_UI: Record<'light' | 'dark', { label: string; icon: string }> = {
  light: { label: '浅色', icon: 'anticon-sun' },
  dark: { label: '深色', icon: 'anticon-moon' },
};

/** 断切换钮处于预期态：aria-label 锚定可见 + 图标随态（返回钮 locator 供点击） */
async function expectThemeButton(page: Page, mode: 'light' | 'dark') {
  const { label, icon } = THEME_UI[mode]!;
  const btn = page.getByRole('button', { name: `切换主题，当前：${label}`, exact: true });
  await expect(btn, `[G7] 切换钮应存在且 aria-label 锚定为「切换主题，当前：${label}」`).toBeVisible();
  await expect(btn.locator(`.${icon}`), `[G7] ${label} 档图标应为 .${icon}`).toBeVisible();
  return btn;
}

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

    // 点击 2：light → dark（往返闭合）——click() 本身须 await（第五轮 P2：floating promise flaky 源）
    await (await expectThemeButton(page, 'light')).click();
    await expectThemeButton(page, 'dark');
    expect(await page.evaluate(() => localStorage.getItem('theme')), '[G7/dark] 存储应写 dark').toBe('dark');
    expectHtmlTheme(await readHtmlTheme(page), 'dark', '[G7/循环回深]');
  } finally {
    await ctx.close();
  }
});

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

// 【守卫，现状应绿】C2 复核遗留项（LoginModal 方案 A 活体断言）：宿主 html.dark 下经 TopActionBar
// 登录钮打开 LoginModal——rootClassName="light" 落 .ant-modal-root，弹层后代经继承取 .light 浅值
test('G7 LoginModal 恒浅活体：宿主 html.dark（显式深）下经顶栏登录钮打开，岛根 .light 命中 + --fw-bg 浅值', async ({ browser }) => {
  const ctx = await browser.newContext(); // 匿名（TopActionBar 登录钮仅未登录态渲染；/works RequireAuth 弹回，用公开组 / ）
  await ctx.addInitScript((t) => localStorage.setItem('theme', t), 'dark');
  const page = await ctx.newPage();
  try {
    await page.goto('/');
    await expect(page.getByTestId('login-register-btn')).toBeVisible({ timeout: 15_000 });
    expectHtmlTheme(await readHtmlTheme(page), 'dark', '[G7/宿主深]');
    await page.getByTestId('login-register-btn').click();
    const content = page.locator('.ant-modal-content').first(); // LoginModal 唯一弹层（rootClassName 岛根无盒高，锚内容卡）
    await expect(content).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.ant-modal-root.light').first(), '[G7] rootClassName="light" 应落 .ant-modal-root').toBeAttached();
    const state = await content.evaluate((el) => ({
      islandLight: el.closest('.light') !== null,
      fwBg: getComputedStyle(el).getPropertyValue('--fw-bg'),
    }));
    expect(state.islandLight, '[G7] 弹层内容 closest(".light") 应命中岛根（.ant-modal-root.light）').toBe(true);
    expect(norm(state.fwBg), '[G7] 弹层内 --fw-bg 必须为浅值 #f7f8fa（岛作用域不随宿主深）').toBe('#f7f8fa');
    expectHtmlTheme(await readHtmlTheme(page), 'dark', '[G7/宿主仍深]');
  } finally {
    await ctx.close();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 组8 O5 portal 弹层 closest 矩阵（plan C5；见文件头组8 注释——①②红→C5 绿、③④守卫）
// ─────────────────────────────────────────────────────────────────────────────

/** 解析 computed color 首三个通道（rgba?(r, g, b, …)），非 rgb 族返回 null */
function parseRgbChannels(color: string): [number, number, number] | null {
  const m = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** 管理端 UI 登录（G4 admin 同款流程）并停在指定 admin 页 */
async function loginAdminAndGoto(page: Page, adminPath: string, readyText: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: '邮箱登录' }).click();
  await page.getByPlaceholder('邮箱').fill(ADMIN_CREDENTIALS.email);
  await page.getByPlaceholder('密码').fill(ADMIN_CREDENTIALS.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByTestId('auth-modal-backdrop')).toBeHidden({ timeout: 15_000 });
  await page.goto(adminPath);
  await expect(page.getByText(readyText).first()).toBeVisible({ timeout: 15_000 });
}

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

test('G8 ②videos 壳跟随域（C8 D3 反转）：html.light 下壳根无 dark 类 + --fw-bg 浅值 + 壳底 bg-bg；列表页无壳 + 卡面浅值', async ({ browser }) => {
  const ctx = await newSeededContext(browser, 'light');
  const page = await ctx.newPage();
  try {
    await page.goto('/videos/gate-video-1');
    await expect(page.getByTestId('video'), '[G8②] 播放壳应打开（公开详情）').toBeVisible({ timeout: 15_000 });
    // C8 D3 拆岛：壳根 dark 类删除（补岛回退即红）+ 壳内 --fw-* 直承 html.light 浅值；媒体容器自持 bg-black
    // [color-scheme:dark]（压画面恒深，P3 拆两层——registry D3-videos-shell-dom-split）
    const state = await page.locator('[data-vw-shell]').evaluate((el) => ({
      islandSelfDark: el.classList.contains('dark'),
      fwBg: getComputedStyle(el).getPropertyValue('--fw-bg'),
      shellBg: getComputedStyle(el).backgroundColor,
    }));
    expect(state.islandSelfDark, '[G8②] 壳根应不再自带 dark 类（C8 D3 改跟随）').toBe(false);
    expect(norm(state.fwBg), '[G8②] 壳内 --fw-bg 浅值 #f7f8fa（继承 html.light）').toBe('#f7f8fa');
    expect(norm(state.shellBg), '[G8②] 壳根底=bg-bg 浅值 rgb(247,248,250)（第七轮 P1-3：computed 断 rgb 形态）').toBe('rgb(247,248,250)');
    // G8② 末尾 /videos 列表：弹层壳零 DOM（VideosPage !id||!detail 早退——D3-videos-shell-dom-split 前提机械守卫）
    await page.goto('/videos');
    await expect(page.locator('[data-vw-shell]')).toHaveCount(0);
    // 卡面 --fw-surface 浅值首次生效（Task 15 并域 + C8 D3 路由岛拆除）：封面垫底容器（.aspect-video）父级=卡壳
    const card = page.locator('a[data-card]', { hasText: 'A0-0 门禁样例视频' }).first();
    expect(await card.locator('.aspect-video').evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor)).toBe('rgb(255, 255, 255)');
  } finally {
    await ctx.close();
  }
});

test('G8 ③双层同浅对照守卫：html.light × videos 壳跟随浅 × 壳内 LoginModal 恒浅（登录层岛断言 C2 方案 A 保持；双岛相反叙事随 C8 D3 壳岛消亡）', async ({ browser }) => {
  const ctx = await browser.newContext(); // 匿名——「喜欢」触发 onNeedLogin 弹壳内登录层（PlayView D18）
  await ctx.addInitScript((t) => localStorage.setItem('theme', t), 'light');
  const page = await ctx.newPage();
  try {
    await page.goto('/videos/gate-video-1');
    await expect(page.getByTestId('video')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '喜欢' }).click();
    const content = page.locator('.ant-modal-content').first();
    await expect(content, '[G8③] 壳内登录层应打开（未登录点喜欢）').toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.ant-modal-root.light').first(), '[G8③] LoginModal rootClassName="light" 应落 .ant-modal-root（C2 方案 A）').toBeAttached();
    const state = await content.evaluate((el) => ({
      islandLight: el.closest('.light') !== null,
      fwBg: getComputedStyle(el).getPropertyValue('--fw-bg'),
      shellBg: getComputedStyle(document.querySelector('[data-vw-shell]')!).getPropertyValue('--fw-bg'),
    }));
    expect(state.islandLight, '[G8③] 登录层内容 closest(".light") 应命中岛根').toBe(true);
    expect(norm(state.fwBg), '[G8③] 登录层 --fw-bg 浅值 #f7f8fa（岛作用域）').toBe('#f7f8fa');
    expect(norm(state.shellBg), '[G8③] 壳跟随 --fw-bg 同浅 #f7f8fa（双浅对照——原「双岛并存」叙事随 C8 D3 壳岛消亡）').toBe('#f7f8fa');
    expectHtmlTheme(await readHtmlTheme(page), 'light', '[G8③/全局仍浅]');
  } finally {
    await ctx.close();
  }
});

test('G8 ④admin Popconfirm body 弹层裁定守卫：html.light 下渲染 + antd 通道深（Pro dark context 穿透）+ var 通道缺口现状登记（closest(.dark)=null，admin 0 --fw-* 弹层消费）', async ({ browser }) => {
  const ctx = await browser.newContext(); // admin 走 UI 登录，不带 USER 态
  await ctx.addInitScript((t) => localStorage.setItem('theme', t), 'light');
  const page = await ctx.newPage();
  try {
    await loginAdminAndGoto(page, '/admin/homepage/announcement', '新用户注册即送100积分');
    expectHtmlTheme(await readHtmlTheme(page), 'light', '[G8④/admin 宿主浅]');
    await page.getByText('删除', { exact: true }).first().click(); // 种子公告行 Popconfirm（body 挂载 rc-trigger 弹层；ProTable 操作列 <a> 无 href → role=generic 非 link）
    const popover = page.locator('.ant-popover').first();
    await expect(popover, '[G8④] Popconfirm 弹层应渲染').toBeVisible({ timeout: 10_000 });
    const state = await popover.evaluate((el) => {
      const inner = el.querySelector('.ant-popover-inner') ?? el;
      return {
        islandDark: el.closest('.dark') !== null,
        innerBg: getComputedStyle(inner).backgroundColor,
      };
    });
    // 现状裁定（c5-portal-census.json）：岛类挂起至 admin token 化——本断言钉住"缺口现状"防静默漂移；
    // admin 弹层自绘 0 --fw-* 消费（grep 实证 0 文件）→ var 通道缺口无可见半半，非 bug
    expect(state.islandDark, '[G8④] 现状登记：body 挂载弹层 closest(".dark")=null（var 通道缺口，admin 未 token 化前接受；转为 true 须同步 census 与本断言）').toBe(false);
    const ch = parseRgbChannels(state.innerBg);
    expect(ch && Math.max(...ch) < 100, `[G8④] antd 通道恒深：弹层面板底应为深色系（Pro dark context 穿透 portal），实际="${state.innerBg}"`).toBeTruthy();
    await page.keyboard.press('Escape'); // 收起确认层（不触删除）
  } finally {
    await ctx.close();
  }
});
