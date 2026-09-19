// B1 常驻门禁（plan B1：B2 颜色迁移的行为钉子；B2 迁移落地转绿，B6 撤 B1_RED 守卫转常驻默认套件——终态）：
//   三组永久回归守卫——源序结构（B1-1：.light 块全局规则序晚于 :root,.dark，防 CSS 重排致浅色恒输）/
//   token 工具类落产品元素（B1-2：className 含 token 类 + computed 零回退）/ 暗色零回退对照（B1-3：冻结深色现状值）。
//
// plan-B1 三条对账（v1.2，B6 终态）：
//   plan-1「源序断言（html.light 浅值）」行为半由 b0-token-blocks 组3 落地（绿）；结构半 = 本文件
//     B1-1【结构守卫】（D8：.light 块全局规则序必须晚于 :root,.dark 块，防未来 CSS 重排使浅色恒输）；
//   plan-2「token 工具类生效」= 本文件 B1-2（B2 三通道改写后绿——className 含 token 工具类 +
//     border 桥删字面类，回潮即红）；
//   plan-3「暗色零回退对照」= 本文件 B1-3（B2 迁移前后 computed 同值，冻结深色现状值永久钉死）。
//
// 探针域裁定（judgment，依据 e2e/audit/domain-token-adjudication-B0.json + spec D4 + 源码逐个复核）：
//   全部取「跟随域」宿主（AppLayout chrome / 画布壳 = B2 会改写的宿主），恒深域字面值保留集一律不采——
//   * 画板域（D4 保留）：OutpaintSelectionOverlay/TextNodeToolbar/React Flow 节点子树不采；
//   * videos 域（D4 整域恒深保留，VideoCard/PlayView/ProcessView 域字面色豁免）：任务书建议的
//     "videos 页 text-white/NN 探针" 不落 /videos——页内 text-white/NN 全在 D4 保留集、B2 不改写，
//     断言将永红；dim 族探针改落 /works 跟随域（WorkspaceBreadcrumb 分隔符）；
//   * works 卡面 bg-[#1F1F1F]（CanvasCard/FolderCard 网格卡）不采——非 token 深色精确值
//     （--fw-surface=#1e1e1e），B2 机械替换按精确值匹配不会改写它，断言 bg-surface 将永红；
//     bg-surface 探针改落 Sidebar「关注公众号」按钮（bg-[#1e1e1e] 精确等值，B2 会改写）。
//   * border-[#333] 通道（B2 = 删字面类留裸 border，色走 preflight var(--fw-border) 桥）无法断
//     "含某工具类"，改断 classAbsent（不含 border-[#333]）——未迁移前必红，B2 后转绿且防回潮
//     （B5 ESLint hex 禁令兜底同向）。
//
// 深色零回退口径：六探针全部取「深色值精确等值」宿主——B2 改写 className 后 computed 不变，
//   冻结值与 b0-token-blocks DARK 表/chromium computed 序列化逐一对账（rgb(30,30,30)=#1e1e1e 等）。
//   非精确等值宿主（如 /80~/90 归 --fw-text 的 27 处、dim 归并 ~38 处）属 B6 预期变化清单，不采。
// 定位纪律：一律不用待迁移类名定位（B2 改写后定位不失效）——aria-label/role/testid/文本锚点。
// 断言口径：className 用 evaluate 直读 + toContain（含目标 token 工具类/不含字面类），红因 message
//   带实际 className；computed 先行断言（红跑时六探针零回退半全部验过，红因只剩 className）。
// 加载稳定性纪律：目标元素出现 + 有界超时；禁 networkidle（socket.io/ws 长连接 + antd 动画永不安定）。
import path from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';

const HERE = import.meta.dirname!;
const USER_STATE = path.join(HERE, '.auth', 'user.json');

type ColorProp = 'backgroundColor' | 'color' | 'borderTopColor';

interface TokenProbe {
  id: string;
  prop: ColorProp;
  /** 冻结深色现状值：B2 迁移前后 computed 必须同值（零回退烤死在用例里） */
  computed: string;
  /** B2 改写后 className 必含的 token 工具类（组2 红因 = 现状缺它） */
  classNeed?: string;
  /** B2 改写后 className 必不再含的字面值类（border 桥通道） */
  classAbsent?: string;
  locate: (page: Page) => Locator;
  why: string;
}

/** /works 跟随域四探针（AppLayout chrome + 工作区壳） */
const WORKS_PROBES: TokenProbe[] = [
  {
    id: 'sidebar-关注公众号-面',
    prop: 'backgroundColor',
    computed: 'rgb(30, 30, 30)', // #1e1e1e = --fw-surface 深色值
    classNeed: 'bg-surface',
    locate: (page) => page.getByRole('button', { name: '关注公众号' }),
    why: 'bg-[#1e1e1e] 精确等值 --fw-surface → B2 通道1 机械替换 bg-surface',
  },
  {
    id: 'topbar-avatar-强调填充',
    prop: 'backgroundColor',
    computed: 'rgb(74, 222, 128)', // #4ade80 = --fw-accent 深色值
    classNeed: 'bg-accent',
    locate: (page) => page.getByTestId('user-avatar').locator('span').first(),
    why: 'bg-[#4ade80] 填充用法 → B2 通道 bg-accent（gate USER 无头像图，字母头像恒渲染）',
  },
  {
    id: 'breadcrumb-分隔点-淡化',
    prop: 'color',
    computed: 'rgba(255, 255, 255, 0.3)', // = --fw-text-dim-1 深色值
    classNeed: 'text-text-dim-1',
    locate: (page) => page.getByLabel('当前位置').getByText('·', { exact: true }),
    why: 'text-white/30 → B2 五通道 dim 3 档 text-text-dim-1（videos 页同族全在 D4 保留集故改落此）',
  },
  {
    id: 'toolbar-新建文件夹-覆盖',
    prop: 'backgroundColor',
    computed: 'rgba(255, 255, 255, 0.1)', // = --fw-overlay-2 深色值
    classNeed: 'bg-overlay-2',
    locate: (page) => page.getByRole('button', { name: '新建文件夹' }),
    why: 'bg-white/10 → B2 五通道 overlay bg-overlay-2',
  },
];

/** /canvas 画布壳两探针（CanvasTopBar = 跟随域；画板子树 D4 保留不采） */
const CANVAS_PROBES: TokenProbe[] = [
  {
    id: 'savestatus-已连接-强调前景',
    prop: 'color',
    computed: 'rgb(74, 222, 128)', // #4ade80 = --fw-accent-text 深色值（浅色档 #15803d 不同——探针钉深色现状）
    classNeed: 'text-accent-text',
    locate: (page) => page.getByText('已连接', { exact: true }).first(),
    why: 'text-[#4ade80] 前景用法 → B2 通道 text-accent-text（17 文件族）',
  },
  {
    id: 'savestatus-胶囊-边',
    prop: 'borderTopColor',
    computed: 'rgb(51, 51, 51)', // #333 = --fw-border 深色值（桥同值）
    classAbsent: 'border-[#333]',
    locate: (page) => page.getByText('已连接', { exact: true }).first().locator('xpath=..'),
    why: 'border border-[#333] → B2 删字面类留裸 border（preflight *{border-color:var(--fw-border)} 桥，色不变）',
  },
];

/** 静态零回退探针（组3 专用：无 className 断言，纯 computed 对照） */
const STATIC_PROBES: Array<TokenProbe & { page: 'works' | 'login' }> = [
  {
    id: 'sidebar-根-站点底',
    page: 'works',
    prop: 'backgroundColor',
    computed: 'rgb(20, 20, 20)', // #141414 = --fw-bg 深色值
    locate: (page) => page.getByTestId('sidebar'),
    why: 'aside bg-[#141414] → B2 即使改写 bg-bg（精确等值）computed 不变',
  },
  {
    id: 'topbar-赚积分-前景',
    page: 'works',
    prop: 'color',
    computed: 'rgb(226, 232, 240)', // B2-b 语义通道：#d0d0d0(208) 并入正文 --fw-text（Δ25/255，档位角色同为正文前景）
    locate: (page) => page.getByRole('link', { name: '赚积分' }),
    why: 'text-[#d0d0d0] → text-text（B2-b 灰阶归并；differExpectedPairs 已登记 color 配对 rgb(208,208,208)→rgb(226,232,240)）',
  },
  {
    id: 'login-横幅-恒浅岛深字',
    page: 'login',
    prop: 'color',
    computed: 'rgb(20, 20, 20)', // #141414；恒浅岛内若 token 化只可能落 --fw-on-accent（浅色档同值 #141414）
    locate: (page) => page.getByText('Flow123'),
    why: '横幅 text-[#141414]：保留或 on-accent 改写两路 computed 均不变',
  },
];

/** 已登录 /works（gate USER storageState）；门禁画布行可见即就绪 */
async function openWorks(page: Page) {
  await page.goto('/works');
  await expect(page.getByText('A0-0 门禁画布').first()).toBeVisible({ timeout: 15_000 });
}

/** 公开 /login；邮箱登录按钮可见即就绪（a0-0/a1/b0 同锚点） */
async function openLogin(page: Page) {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: '邮箱登录' })).toBeVisible();
}

/** 已登录 /canvas；react-flow 就绪 + 协作已连接（CanvasTopBar 胶囊随 user 恒渲染） */
async function openCanvas(page: Page) {
  await page.goto('/canvas?projectId=gate-canvas-1');
  await expect(page.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
  // 已连接 仅 synced 后置位；canvasCollabRuntime 10s 兜底也会置位——窗口放宽到兜底之后
  await expect(page.getByText('已连接', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

/** 读元素计算色（chromium 序列化口径，与冻结值直比） */
function readColor(loc: Locator, prop: ColorProp) {
  return loc.evaluate((node, p) => getComputedStyle(node)[p], prop);
}

/** 直读 className 字符串（红因 message 原样回显） */
function readClass(loc: Locator) {
  return loc.evaluate((node) => node.className);
}

async function expectComputed(probes: TokenProbe[], page: Page, group: string) {
  for (const el of probes) {
    const loc = el.locate(page);
    await expect(loc, `[${group}/${el.id}] 探针元素必须存在`).toHaveCount(1);
    const actual = await readColor(loc, el.prop);
    expect(actual, `[${group}/${el.id}] computed ${el.prop} 必须等于冻结深色值（B2 迁移前后同值）；实际=${actual}`).toBe(el.computed);
  }
}

async function expectClassName(probes: TokenProbe[], page: Page) {
  for (const el of probes) {
    const cls = await readClass(el.locate(page));
    if (el.classNeed) {
      expect(cls, `[B1-2/${el.id}] B2 改写后 className 应含「${el.classNeed}」（${el.why}）——未迁移前必红（红因=现状仍为字面值类）；实际 className="${cls}"`).toContain(el.classNeed);
    } else {
      expect(cls, `[B1-2/${el.id}] B2 删字面边色类后 className 不应再含「${el.classAbsent}」（${el.why}）——未迁移前必红；实际 className="${cls}"`).not.toContain(el.classAbsent!);
    }
  }
}

test.describe('B1-1【绿·结构守卫】D8 源序结构断言（.light 块在 :root,.dark 之后）', () => {
  // b0 组3 已行为级验证（html.light 取浅值）；本组下钻规则级钉死源序结构本身——双块同 (0,1,0)
  // 特异性靠文档序决胜，任何人把 .light 块挪到 :root,.dark 之前，浅色将恒输且无任何行为报错，
  // 唯结构断言可拦。定位口径同 a1 组5：产品 sheet 内顶层 CSSStyleRule，归一 selectorText + 声明含
  // --fw-bg 双条件钉 token 块本体（排除同名非 token 规则）。
  test('产品 sheet 内 .light token 块全局规则序 > :root,.dark token 块', async ({ page }) => {
    await openLogin(page);
    const snapBlockOrder = () => page.evaluate(() => {
      const isProductSheet = (i: number) => {
        const n = document.styleSheets[i].ownerNode as HTMLLinkElement | null;
        return !!n && n.tagName === 'LINK' && /\/assets\/[^/]+\.css$/.test(n.getAttribute('href') ?? '');
      };
      let productSheetIdx = -1;
      for (let i = 0; i < document.styleSheets.length; i++) {
        if (isProductSheet(i)) {
          productSheetIdx = i;
          break;
        }
      }
      const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
      const hit = { global: -1, sheetIdx: -1, selectorText: '' };
      const out = { productSheetIdx, dark: { ...hit }, light: { ...hit } };
      let g = 0;
      for (let i = 0; i < document.styleSheets.length; i++) {
        let rules: CSSRuleList;
        try {
          rules = document.styleSheets[i].cssRules;
        } catch {
          continue; // 跨域 sheet 直读抛 SecurityError → 跳过，全局计数口径不变
        }
        for (let j = 0; j < rules.length; j++) {
          const r = rules[j];
          if (i === productSheetIdx && r instanceof CSSStyleRule) {
            const sel = norm(r.selectorText ?? '');
            if (out.dark.global < 0 && sel === ':root,.dark' && r.style.getPropertyValue('--fw-bg')) {
              out.dark = { global: g, sheetIdx: i, selectorText: r.selectorText };
            }
            if (out.light.global < 0 && sel === '.light' && r.style.getPropertyValue('--fw-bg')) {
              out.light = { global: g, sheetIdx: i, selectorText: r.selectorText };
            }
          }
          g++;
        }
      }
      return out;
    });
    await expect
      .poll(
        async () => {
          const s = await snapBlockOrder();
          return [s.productSheetIdx, s.dark.global, s.light.global].every((v) => v >= 0);
        },
        { message: '产品 sheet 与两 token 块定位（:root,.dark / .light 各含 --fw-bg）', timeout: 10_000 },
      )
      .toBe(true);
    const s = await snapBlockOrder();
    const dump = `快照=${JSON.stringify(s)}`;
    expect(s.dark.selectorText, `[G1] 未定位到 :root,.dark 深色 token 块；${dump}`).toBe(':root, .dark');
    expect(s.light.selectorText, `[G1] 未定位到 .light 浅色 token 块；${dump}`).toBe('.light');
    // 方向断言（D8）：.light 必须写在 :root,.dark 之后——html.light 同时命中两块，源序在后者胜
    expect(s.light.global, `[G1] .light 块全局规则序(${s.light.global})必须晚于 :root,.dark 块(${s.dark.global})——源序决胜，.light 在前则浅色恒输；${dump}`).toBeGreaterThan(s.dark.global);
    await test.info().attach('G1-token-block-order', { body: JSON.stringify(s, null, 2), contentType: 'application/json' });
  });
});

test.describe('B1-2【常驻】token 工具类落到产品元素（B2 改写后绿，字面类回潮即红）', () => {
  test('/works 跟随域四探针：computed 零回退先行 + className 缺 token 工具类（红因）', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: USER_STATE });
    const page = await ctx.newPage();
    try {
      await openWorks(page);
      await expectComputed(WORKS_PROBES, page, 'B1-2-works');
      await expectClassName(WORKS_PROBES, page);
    } finally {
      await ctx.close();
    }
  });

  test('/canvas 画布壳两探针：computed 零回退先行 + className 断言（含 border 桥通道删类）', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: USER_STATE });
    const page = await ctx.newPage();
    try {
      await openCanvas(page);
      await expectComputed(CANVAS_PROBES, page, 'B1-2-canvas');
      await expectClassName(CANVAS_PROBES, page);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('B1-3【绿·B2 后必须仍绿】暗色零回退元素级对照（冻结深色现状值）', () => {
  // 与组2 同表六探针的 computed 半独立复验（组2 红转绿的改写过程不得动计算值）+ 三静态探针
  // （works 站点底/字面前景 + login 恒浅岛）。complement after-A 基线 differ：站点级 → 元素级。
  test('组2 六探针 + 静态三探针 computed 全部等于冻结值', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: USER_STATE });
    const page = await ctx.newPage();
    try {
      await openWorks(page);
      await expectComputed(WORKS_PROBES, page, 'G3-works');
      await expectComputed(STATIC_PROBES.filter((e) => e.page === 'works'), page, 'G3-works-static');
      await openCanvas(page);
      await expectComputed(CANVAS_PROBES, page, 'G3-canvas');
      await openLogin(page);
      await expectComputed(STATIC_PROBES.filter((e) => e.page === 'login'), page, 'G3-login-static');
    } finally {
      await ctx.close();
    }
  });
});
