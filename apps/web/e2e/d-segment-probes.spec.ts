// C8 D 段探针族（spec §6-③，b1 同构）：钉各域"当前主题应取值"——D0-0 先钉深值（html.light 下恒深面不变、
// 跟随面翻转点见文件头生命周期表）；随各段迁移同 commit 翻转预期值（探针是活断言，不是快照）。
// 探针生命周期表见 docs/superpowers/plans/2026-09-20-canvas-domain-theme.md 执行总纲 §5。
//
// 浅色注入纪律：一律走 lightContext 的 addInitScript localStorage theme=light（真实路径，先于一切页面脚本，
// 同 c0 newSeededContext 口径）——禁 classList 注入（D0 起 themeStore 首渲染挂 dark，add('light') 不移除
// → html 双类 → 失真）。
// 发现步（D-0/D-6）：一次性发现用例，仅 console.log + attach 证据、不带断言——钉值落盘
// e2e/audit/d0-probe-values.json 后断言照盘填（禁抄报错人因）；D4 收口时可撤（防沉淀为无断言假守卫）。
// 加载稳定性纪律：目标元素出现 + 有界超时；禁 networkidle（socket.io/ws 长连接 + antd 动画永不安定）。
import path from 'node:path';
import { test, expect, type Browser, type Page, type Locator } from '@playwright/test';

const HERE = import.meta.dirname!;
const USER_STATE = path.join(HERE, '.auth', 'user.json');

/** 真实浅色路径：localStorage theme=light 先于一切页面脚本（同 c0/采集器口径） */
async function lightContext(browser: Browser) {
  const ctx = await browser.newContext({ storageState: USER_STATE });
  await ctx.addInitScript(() => localStorage.setItem('theme', 'light'));
  return ctx;
}

/** 已登录 /canvas；门禁节点 + 协作已连接即就绪（b1 openCanvasPage 同锚点） */
async function openCanvas(page: Page) {
  await page.goto('/canvas?projectId=gate-canvas-1');
  await expect(page.locator('.react-flow__node[data-id="gate-node-1"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('已连接', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
}
/** 已登录 /works；门禁画布行可见即就绪（b0/b1/c0 同锚点） */
async function openWorks(page: Page) {
  await page.goto('/works');
  await expect(page.getByText('A0-0 门禁画布').first()).toBeVisible({ timeout: 15_000 });
}
/** 已登录 /videos；门禁样例视频可见即就绪（a0-collect/c0 同锚点） */
async function openVideos(page: Page) {
  await page.goto('/videos');
  await expect(page.getByText('A0-0 门禁样例视频').first()).toBeVisible({ timeout: 15_000 });
}
/** token/自定义属性计算值归一（b0/c0 同口径：去空白 + 小写） */
const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase();
const bgOf = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
const colorOf = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).color);

// ─────────────────────────────────────────────────────────────────────────────
// D-0 发现：探针钉值基线输出（一次性发现步——console.log + attach 证据、不带断言；
// 钉值落 e2e/audit/d0-probe-values.json，断言照盘填禁抄报错；D4 收口时可撤）
// ─────────────────────────────────────────────────────────────────────────────
test('D-0 发现：探针钉值基线输出（落盘照盘填，防抄报错人因）', async ({ browser }) => {
  const ctx = await lightContext(browser);
  const page = await ctx.newPage();
  try {
    await openCanvas(page);
    const values = await page.evaluate(() => ({
      gateCardBg: getComputedStyle(document.querySelector('.react-flow__node[data-id="gate-node-1"] .canvas-node div.rounded-lg')!).backgroundColor,
      boardDot: getComputedStyle(document.querySelector('.react-flow__background')!).getPropertyValue('--xy-background-pattern-color-props'),
      // M5 对照读数：若 boardDot 返回未代换字面串（如 'var(--canvas-board-dot)'）而 circleFill 是
      // 真实 RGB → 网格点探针必须改用 circle fill 断言（自定义属性假守卫风险，数据定形态）
      boardDotCircleFill: (() => { const c = document.querySelector('.react-flow__background circle'); return c ? getComputedStyle(c).fill : '(无 circle)'; })(),
    }));
    console.log('[D-0-probe-values] ' + JSON.stringify(values));
    test.info().attach('d0-probe-values', { body: JSON.stringify(values, null, 2), contentType: 'application/json' });
  } finally { await ctx.close(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// D-1 画板域（D0-0 钉深；D2 已随 colorMode={mode} 翻转浅值）
// ─────────────────────────────────────────────────────────────────────────────
test.describe('D-1 画板域（D0-0 钉深；D2 已翻浅）', () => {
  test('画板 wrapper 底=rgb(245,245,245)、网格点=#c8c8c8（html.light 下 colorMode={mode} 翻浅）', async ({ browser }) => {
    const ctx = await lightContext(browser);
    const page = await ctx.newPage();
    try {
      await openCanvas(page);
      const wrapper = page.locator('.react-flow');
      expect(await bgOf(wrapper)).toBe('rgb(245, 245, 245)');
      // 网格点读 .react-flow__background 自身（自定义属性只向下继承，从 wrapper 读=空）；
      // computed 已被 var() 代换 → 断 RGB 可同时抓"代换失败"（失败落字面/空）
      const dot = await wrapper.evaluate((el) => getComputedStyle(el.querySelector('.react-flow__background')!).getPropertyValue('--xy-background-pattern-color-props'));
      expect(norm(dot)).toBe('#c8c8c8');
    } finally { await ctx.close(); }
  });

  test('gate 节点卡底=rgb(34,34,34)（D0-0 实测钉值；D3-画板翻浅白卡）', async ({ browser }) => {
    const ctx = await lightContext(browser);
    const page = await ctx.newPage();
    try {
      await openCanvas(page);
      // ⚠ gate 节点 type='videoGen'（gate-seed.ts:27）→ VideoGenNode：根 .canvas-node(:607) 无底色，
      // 卡面在 :718 bg-[#222222]——选择器必须锚卡面 div 非 .canvas-node 根，
      // 照抄 locator('div').first() 会钉到根 div 的 rgba(0,0,0,0)=与主题无关的假守卫（第五轮 P0-1）。
      // 后裔选择器实命中卡面与其内层内容盒两枚 div.rounded-lg——.first() 取文档序首个=卡面本体
      // （与 D-0 发现步 querySelector 首个同元素）；缺 .first() 则 locator.evaluate 双命中 strict 报错。
      // C8 Task 22 D3-board：卡面 #222222→bg-surface——浅档白卡 rgb(255, 255, 255)（--fw-surface 浅值）；
      // 行号注释随迁移漂移作废，定位按结构锚（.canvas-node 后裔 div.rounded-lg 文档序首个）
      const card = page.locator('.react-flow__node[data-id="gate-node-1"] .canvas-node div.rounded-lg').first();
      expect(await bgOf(card)).toBe('rgb(255, 255, 255)'); // 浅档白卡（--fw-surface 浅值，本组恒 html.light 注入）
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

// ─────────────────────────────────────────────────────────────────────────────
// D-2 videos 域（封面=P6 内容垫底恒深，不翻转）
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// D-3 WeChatFollowModal（D1b 拆岛翻浅）
// ─────────────────────────────────────────────────────────────────────────────
test.describe('D-3 WeChatFollowModal（D1b 拆岛翻浅）', () => {
  test('面=rgb(255,255,255)、标题前景=rgb(31,35,41)', async ({ browser }) => {
    const ctx = await lightContext(browser);
    const page = await ctx.newPage();
    try {
      await openWorks(page);
      await page.getByTestId('wechat-follow-entry').click();
      const content = page.locator('.ant-modal-content').first();
      await expect(content).toBeVisible({ timeout: 10_000 });
      expect(await bgOf(content)).toBe('rgb(255, 255, 255)');
      // exact: true 锚标题 span——子串匹配会双命中（标题「关注公众号」+ 副标题「扫码关注公众号…」）
      expect(await colorOf(content.getByText('关注公众号', { exact: true }))).toBe('rgb(31, 35, 41)');
    } finally { await ctx.close(); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D-4 ve 域（C8 D3-ve 已反转：壳底跟随翻浅 + ve 面板底钉浅值）——复用采集器"添加节点→多轨道剪辑→全屏编辑"
// 操作序列（a0-collect-baseline video-editor 流程 + 清理段；c0-G4 同构）。
// 浅色注入走本文件 lightContext 的 addInitScript——禁抄采集器旧 classList 注入（D0 后双类失真）。
// ─────────────────────────────────────────────────────────────────────────────
test.describe('D-4 ve 域（C8 D3-ve 已反转：壳底跟随翻浅 + ve 面板底钉浅值）', () => {
  test('video-editor 壳底=rgb(247,248,250)（壳岛拆除 --fw-bg 跟随翻浅）+ EditorTopBar 面板底=rgb(240,241,242)（--fw-surface-dim 浅值）', async ({ browser }) => {
    const ctx = await lightContext(browser);
    const page = await ctx.newPage();
    try {
      await openCanvas(page);
      try {
        await page.getByRole('button', { name: '添加节点' }).click();
        await page.getByRole('menuitem', { name: /多轨道剪辑/ }).click();
        // 新节点经 collab 同步渲染（VideoEditNode 带「⤢ 全屏编辑」按钮）
        await expect(page.getByRole('button', { name: '⤢ 全屏编辑' }).first()).toBeVisible({ timeout: 15_000 });
        await page.getByRole('button', { name: '⤢ 全屏编辑' }).first().click();
        // 可见性锚 data-testid=video-editor-shell（dialog 外层包 fixed 子元素自身零尺寸）
        await expect(page.getByTestId('video-editor-shell')).toBeVisible({ timeout: 10_000 });
        expect(await bgOf(page.getByTestId('video-editor-shell'))).toBe('rgb(247, 248, 250)');
        expect(await bgOf(page.getByTestId('editor-top-bar'))).toBe('rgb(240, 241, 242)');
      } finally {
        // 清理（采集器/c0-G4 同款，红跑后仍复原 gate 画布）：Esc 关编辑器 → 删全部多轨道剪辑节点 → 复原双节点
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('video-editor-shell')).toBeHidden({ timeout: 10_000 });
        for (let i = 0; i < 10; i++) {
          const veNode = page.locator('.react-flow__node', { hasText: '多轨道剪辑' }).first();
          if (!(await veNode.count())) break;
          await veNode.getByText('多轨道剪辑', { exact: true }).click(); // 标题文本非交互区——选中节点（避开播放/编辑按钮）
          await page.keyboard.press('Delete');
          await page.waitForTimeout(600); // collab 删除同步窗口
        }
        await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 15_000 });
      }
    } finally { await ctx.close(); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D-5 videos 卡面前景（D3-videos 翻转——白字白卡不可见防线；卡片白前景对 differ 不可见，
// 探针是唯一机械守卫）
// ─────────────────────────────────────────────────────────────────────────────
test.describe('D-5 videos 卡面前景（D3-videos 已翻转——白字白卡不可见防线兑现）', () => {
  test('VideoCard 卡标题前景=rgb(31,35,41)（C8 Task 20 D3-videos 反转：text-white→text-text，html.light 取 --fw-text 浅值）', async ({ browser }) => {
    const ctx = await lightContext(browser);
    const page = await ctx.newPage();
    try {
      await openVideos(page);
      const title = page.locator('a[data-card]', { hasText: 'A0-0 门禁样例视频' }).first().getByText('A0-0 门禁样例视频');
      expect(await colorOf(title)).toBe('rgb(31, 35, 41)'); // 迁移前钉 rgb(255,255,255)（text-white 字面现状），Task 20 域原子对同 commit 改真值
    } finally { await ctx.close(); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D-6 图形档（fill/stroke——differ 属性集不可见；目标由发现步实测选定）
// ⚠ gate 画布实测：两节点 type='videoGen'（gate-seed.ts:27，无 GridIcon）、gate-edge-1 无 type（无
// EdgeFlowParticles 粒子边）——"edge 线 stroke"读 .react-flow__edge path 是 xyflow 默认边
// （--xy-edge-stroke），与 --edge-flow-color 无关。--edge-flow-color 唯一消费者 = EdgeFlowParticles
// circle 的 fill（edges/EdgeFlowParticles.tsx:24），gate 画布不渲染 → 显式登记
// "图形档：--edge-flow-color 无门禁覆盖（需粒子边），B6 目检兜底"。
// D0-0 误判订正：NodeHandle（nodes/NodeHandle.tsx:22/28）circle/path stroke 系 var() 呈现属性，
// computed 已代换=真实 token 绑定目标（--canvas-handle-bg/icon）——gate 画布唯一真 token 绑定
// SVG 面、Task 2 对比度台账改浅值的对象，已钉真断言（此前零机械覆盖）。
// ─────────────────────────────────────────────────────────────────────────────
test.describe('D-6 图形档（fill/stroke——differ 属性集不可见；目标由发现步实测选定）', () => {
  // 一次性发现步：钉值落定后本用例仅保留 attach 证据、不新增断言，D4 收口时可撤（防沉淀为第二个无断言假守卫）
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
      // NodeHandle 手柄专项读数（D0-0 误判订正：circle/path stroke 系 var(--canvas-handle-bg/icon)
      // 呈现属性，computed 已代换=token 绑定目标）——gate-node-1 双手柄（target 左 + source 右），
      // 同读 3 锚交叉印证 document 序首个（querySelector/.first() 落点）与专类锚一致
      const handles = await page.evaluate(() => {
        const read = (sel: string) => {
          const s = document.querySelector(sel);
          if (!s) return null;
          const circle = s.querySelector('circle');
          const p = s.querySelector('path');
          return {
            circleStroke: circle ? getComputedStyle(circle).stroke : '(无 circle)',
            pathStroke: p ? getComputedStyle(p).stroke : '(无 path)',
          };
        };
        return {
          first: read('.react-flow__node[data-id="gate-node-1"] .handle-icon'),
          target: read('.react-flow__node[data-id="gate-node-1"] .handle-icon-target'),
          source: read('.react-flow__node[data-id="gate-node-1"] .handle-icon-source'),
          handleIconCount: document.querySelectorAll('.react-flow__node[data-id="gate-node-1"] .handle-icon').length,
        };
      });
      console.log('[D-6-handle-stroke] ' + JSON.stringify(handles));
      test.info().attach('d6-handle-stroke', { body: JSON.stringify(handles, null, 2), contentType: 'application/json' });
    } finally { await ctx.close(); }
  });

  // 真断言（D0-0 误判订正，照盘填 2026-09-20 [D-6-handle-stroke] 发现跑批——first/target/source 三锚
  // 读数一致）：NodeHandle circle/path stroke 系 var() 呈现属性、computed 已代换 → 断 RGB 可同时抓
  // "代换失败"（失败落字面/空，同 D-1 网格点口径）。gate-node-1 双手柄（target 左 + source 右）
  // → .first() 取文档序首个。D2 已翻浅（ebfe1c85 预告）：circle→'rgb(107, 114, 128)'
  // （handle-bg 浅 #6B7280）、path→'rgb(75, 85, 99)'（icon 浅 #4B5563）。
  test('D-6 手柄图形档：circle stroke=var(--canvas-handle-bg) 浅值、path stroke=var(--canvas-handle-icon) 浅值（D2 已随画板翻浅）', async ({ browser }) => {
    const ctx = await lightContext(browser);
    const page = await ctx.newPage();
    try {
      await openCanvas(page);
      const icon = page.locator('.react-flow__node[data-id="gate-node-1"] .handle-icon').first();
      expect(await icon.evaluate((el) => getComputedStyle(el.querySelector('circle')!).stroke)).toBe('rgb(107, 114, 128)');
      expect(await icon.evaluate((el) => getComputedStyle(el.querySelector('path')!).stroke)).toBe('rgb(75, 85, 99)');
    } finally { await ctx.close(); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D-7 selection 钉值规则级（D2 定案，断言形态——撤钉实验取消：xyflow 12.10.2 dist/style.css :39-40/:85-86
// 实测 light 皮肤默认 rgba(0,89,220,0.08/0.8) 与 index.css 钉值逐字节重合（浅档冗余）、dark 皮肤另一组
// rgba(200,200,220,*)——wrapper colorMode={mode} 后深档钉值承重（无钉值即被 dark 皮肤改写浅灰蓝）。
// 临时探针 div 注入 .react-flow 读 computed，两档同断蓝色钉值；dark 皮肤值出现=钉值失效红。
// ─────────────────────────────────────────────────────────────────────────────
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
