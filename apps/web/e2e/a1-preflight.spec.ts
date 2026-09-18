// A1 常驻回归门禁（A6 起并入默认 `npx playwright test`）：基础层守卫冻结集，永久防回归——
// 组1 裸按钮四属性归零（border/padding/font-size/background-color）/ 组2 分体模型双臂（选中臂 + 裸
// border div + 未选中臂）/ 组3 login 岛根双保险（computed border-color + --fw-border 直读）/
// 组4 产品 CSS 顺序守卫（antd STYLE 先于产物 LINK）/ 组5 (0,1,0) 档顺序核验（A6 增，规则级直读
// document.styleSheets）。
//
// 历史（TDD red-first）：A1 红先写——preflight:false 下组1/组2 选中臂+裸 border div/组3 必红且红因=UA 样式
// 实测（见各断言 message）；组4 当时已绿防注入顺序回归。A2 preflight 重开后前三组转绿；A4 删 WorkspaceTabBar
// 未选中臂 border-none 后未选中臂转绿——至此 6/6 恒绿，A6 增组5 后 7/7。describe/test 标题中【红→A2 绿】
// 【A4 前恒红】等字样为各阶段验收史标注，非当前状态。
//
// 探针裁定（judgment，依据 e2e/audit/audit-A0.json 注册表 + 源码逐个复核）：
// * 组1 用合成裸按钮：注册表 4 个推荐探针候选（VideoNodeToolbar 视频截帧/音频分离/下载/全屏）全部携带
//   内联 BTN_STYLE/ICON_ONLY_BTN_STYLE（border:'none' + background:'transparent' + padding + fontSize:13），
//   四属性被内联样式钉死——A2 前后计算值不变，无法作为 A2 门禁（现状非 UA outset/1px 6px/13.33px/buttonface）；
//   且 login/register 无产品裸按钮（注册表产品 31 条全在 canvas 子树）。故向 /login body 注入无 class/无 style
//   的裸 <button> 直测基础层——preflight 是全局 `*` 层，合成裸按钮是四属性归零的最纯判据。
// * 组2 裸 border div 同理用合成 div：注册表全部裸 border（宽度 1 无色）div 或带显式色（CreditsDropdown 等
//   border-white/[0.1] 族）、或内联色（#add-node-menu borderColor:var(--canvas-controls-border)→rgb(54,54,54)，
//   A2 后≠rgb(51,51,51)）、或门禁不可达（EraseBottomToolbar 弹层需擦除模式，gate 画布无图片节点）。故在 /works
//   注入 class="border" 的合成 div（border 类在产品 CSS 中真实存在——AddNodeMenu 菜单壳等使用），断言分体模型
//   机制：UA style:none 下宽度类 used 0（不可见）→ A2 后 *{border-style:solid;border-color:var(--fw-border)}
//   落地 → 1px + rgb(51,51,51)。
// * 组2 双臂 = 注册表登记的 WorkspaceTabBar 产品元素（/works 默认 personal 选中；before-A0/works.json 已冻结
//   现状值：选中臂 style 四边 outset + 宽 0/0/2/0；未选中臂 none + 全 0）。
// * 组3 岛根 = login/page.tsx:19 根 div（唯一 bg-[#f5f5f5] 类，无任何 border 声明，border-color 走全级联）；
//   现状红值实测 rgba(0,0,0,0.88) = currentColor（.ant-app 设置 color 后继承——App.tsx <AntdApp> 包全站），
//   机制与计划一致：无任何 author border-color 规则 → 计算值走 currentColor 级联；A2 后被 `*` 桥改写。
// * 组4 方向裁定：任务书原文表述「产品 CSS 在 antd style 之前」与实测 DOM 相反——antd cssinjs 以 prepend 注入
//   head（实测 32 个 STYLE 在 head 最前，vite 产物 link 在 head 末 index 38）。级联平 specificity 时文档序后者胜，
//   故现状真实不变式 = antd 样式先于产品 CSS（产品 CSS 可覆写 antd，A2 后含 preflight 的产品层对 antd 平局可胜）。
//   按实测方向断言（现绿、A2 后必须仍绿）。
//
// 加载稳定性纪律：目标元素出现 + 有界超时；禁 networkidle（socket.io/ws 长连接 + antd 动画永不安定）。
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';

const HERE = import.meta.dirname!;
const USER_STATE = path.join(HERE, '.auth', 'user.json');

/** 已登录 /works（gate USER storageState）；门禁画布行可见即就绪 */
async function openWorks(page: Page) {
  await page.goto('/works');
  await expect(page.getByText('A0-0 门禁画布').first()).toBeVisible({ timeout: 15_000 });
}

/** 公开 /login；邮箱登录按钮可见即就绪（a0-0 同锚点） */
async function openLogin(page: Page) {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: '邮箱登录' })).toBeVisible();
}

test.describe('A1-1【红→A2 绿】裸按钮四属性归零（合成探针，/login）', () => {
  test('border / padding / font-size / background-color 全部 preflight 归一', async ({ page }) => {
    await openLogin(page);
    const s = await page.evaluate(() => {
      const btn = document.createElement('button'); // 无 class、无 style —— 裸按钮探针
      btn.textContent = 'a1-bare-button-probe';
      document.body.appendChild(btn);
      const cs = getComputedStyle(btn);
      const out = {
        borderStyle: { t: cs.borderTopStyle, r: cs.borderRightStyle, b: cs.borderBottomStyle, l: cs.borderLeftStyle },
        borderWidth: { t: cs.borderTopWidth, r: cs.borderRightWidth, b: cs.borderBottomWidth, l: cs.borderLeftWidth },
        padding: { t: cs.paddingTop, r: cs.paddingRight, b: cs.paddingBottom, l: cs.paddingLeft },
        fontSize: cs.fontSize,
        parentFontSize: getComputedStyle(btn.parentElement!).fontSize, // preflight font-size:100% 的断言基准 = 父级计算值
        backgroundColor: cs.backgroundColor,
      };
      btn.remove();
      return out;
    });
    const snap = JSON.stringify(s);
    // 1) border-style：preflight *{border-style:solid}；现状 UA button outset
    for (const [side, v] of Object.entries(s.borderStyle)) {
      expect(v, `[G1] border-${side}-style 期望 solid；实际快照=${snap}`).toBe('solid');
    }
    // 1) border-width：preflight *{border-width:0} + button 归一；现状 UA ~2px
    for (const [side, v] of Object.entries(s.borderWidth)) {
      expect(v, `[G1] border-${side}-width 期望 0px；实际快照=${snap}`).toBe('0px');
    }
    // 2) padding：preflight button 归一 0；现状 UA 1px 6px
    for (const [side, v] of Object.entries(s.padding)) {
      expect(v, `[G1] padding-${side} 期望 0px；实际快照=${snap}`).toBe('0px');
    }
    // 3) font-size：preflight button font-size:100% → 等于父级计算值；现状 UA 13.3333px ≠ 父级 16px
    expect(s.fontSize, `[G1] 按钮计算 font-size 应等于父级（100% 继承）；实际快照=${snap}`).toBe(s.parentFontSize);
    // 4) background-color：preflight button 显式透明；现状 UA buttonface
    expect(s.backgroundColor, `[G1] 裸按钮 background-color 期望 rgba(0, 0, 0, 0)；实际快照=${snap}`).toBe('rgba(0, 0, 0, 0)');
  });
});

test.describe('A1-2【红→A2 绿 / 未选中臂→A4 绿】分体模型 border-style 机制（/works WorkspaceTabBar）', () => {
  test('选中臂：border-bottom solid 2px + 左/右/上宽 0（现状 UA outset 浮雕）', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: USER_STATE });
    const page = await ctx.newPage();
    await openWorks(page);
    // 唯一性前提：gate USER 无真实团队 → TeamSwitcher 渲染 null → 该角色名在 /works 唯一；若 gate 夹具未来获得真实团队，此定位器需重新收窄
    const tab = page.getByRole('button', { name: '个人项目' }); // audit 探针登记选择器
    await expect(tab).toBeVisible();
    const s = await tab.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        borderBottomStyle: cs.borderBottomStyle,
        borderBottomWidth: cs.borderBottomWidth,
        borderTopWidth: cs.borderTopWidth,
        borderLeftWidth: cs.borderLeftWidth,
        borderRightWidth: cs.borderRightWidth,
      };
    });
    const snap = JSON.stringify(s);
    expect(s.borderBottomStyle, `[G2-选中臂] border-bottom-style 期望 solid（preflight 落地后 border-b-2 呈实线）；实际快照=${snap}`).toBe('solid');
    expect(s.borderBottomWidth, `[G2-选中臂] border-bottom-width 期望 2px；实际快照=${snap}`).toBe('2px');
    expect(s.borderTopWidth, `[G2-选中臂] border-top-width 期望 0px；实际快照=${snap}`).toBe('0px');
    expect(s.borderLeftWidth, `[G2-选中臂] border-left-width 期望 0px；实际快照=${snap}`).toBe('0px');
    expect(s.borderRightWidth, `[G2-选中臂] border-right-width 期望 0px；实际快照=${snap}`).toBe('0px');
    await ctx.close();
  });

  test('裸 border 宽度类 div：used width 0（style none）→ A2 后 1px solid rgb(51,51,51)（合成探针）', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: USER_STATE });
    const page = await ctx.newPage();
    await openWorks(page);
    const s = await page.evaluate(() => {
      const div = document.createElement('div'); // 仅 border 宽度类（产品 CSS 真实存在），无色/无 style —— 「忘配色」族探针
      div.className = 'border';
      document.body.appendChild(div);
      const cs = getComputedStyle(div);
      const out = {
        borderStyle: { t: cs.borderTopStyle, r: cs.borderRightStyle, b: cs.borderBottomStyle, l: cs.borderLeftStyle },
        borderWidth: { t: cs.borderTopWidth, r: cs.borderRightWidth, b: cs.borderBottomWidth, l: cs.borderLeftWidth },
        borderColor: { t: cs.borderTopColor, r: cs.borderRightColor, b: cs.borderBottomColor, l: cs.borderLeftColor },
      };
      div.remove();
      return out;
    });
    const snap = JSON.stringify(s);
    // 现状：UA div border-style:none → 宽度类 used 0（边框不可见，A2 修复的目标缺陷）
    for (const [side, v] of Object.entries(s.borderWidth)) {
      expect(v, `[G2-裸border] border-${side}-width 期望 1px（border 类宽 1 + preflight solid 后生效）；实际快照=${snap}`).toBe('1px');
    }
    for (const [side, v] of Object.entries(s.borderColor)) {
      expect(v, `[G2-裸border] border-${side}-color 期望 rgb(51, 51, 51)（preflight var(--fw-border) 桥 = #333333）；实际快照=${snap}`).toBe('rgb(51, 51, 51)');
    }
    await ctx.close();
  });

  // 【A4 靶点】本测试的红 = A4 验收信号：未选中臂 border-none (0,1,0) 恒压 preflight `*` (0,0,0)，
  // A2 后仍为 none；A4 删除 border-none 后 preflight 兜底 → solid + 四边 0px。
  test('【A4 前恒红】未选中臂：border-none 删除后 solid + 四边宽 0', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: USER_STATE });
    const page = await ctx.newPage();
    await openWorks(page);
    // 唯一性前提：gate USER 无真实团队 → TeamSwitcher 渲染 null → 该角色名在 /works 唯一；若 gate 夹具未来获得真实团队，此定位器需重新收窄
    const tab = page.getByRole('button', { name: '团队项目' }); // audit 探针登记选择器
    await expect(tab).toBeVisible();
    const s = await tab.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        borderStyle: { t: cs.borderTopStyle, r: cs.borderRightStyle, b: cs.borderBottomStyle, l: cs.borderLeftStyle },
        borderWidth: { t: cs.borderTopWidth, r: cs.borderRightWidth, b: cs.borderBottomWidth, l: cs.borderLeftWidth },
      };
    });
    const snap = JSON.stringify(s);
    for (const [side, v] of Object.entries(s.borderStyle)) {
      expect(v, `[G2-未选中臂] border-${side}-style 期望 solid（A4 删 border-none 后 preflight 兜底）；实际快照=${snap}`).toBe('solid');
    }
    for (const [side, v] of Object.entries(s.borderWidth)) {
      expect(v, `[G2-未选中臂] border-${side}-width 期望 0px；实际快照=${snap}`).toBe('0px');
    }
    await ctx.close();
  });
});

test.describe('A1-3【红→A2 绿】浅色岛根计算链（/login 岛根双保险）', () => {
  // 岛根 = login/page.tsx:19 根 div（min-h-screen bg-[#f5f5f5]…，无任何 border 声明 → border-color 走全级联；
  // A2 将为登录容器加 .light，本根即岛根）。定位用既有类名，不向产品码注入 testid。
  test('岛根 borderColor=rgb(229,231,235) 且 --fw-border=#e5e7eb', async ({ page }) => {
    await openLogin(page);
    const root = page.locator('div[class~="bg-[#f5f5f5]"]').first();
    await expect(root).toBeVisible();
    const s = await root.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        borderColor: cs.borderColor,
        color: cs.color, // 现状红值 = currentColor（.ant-app color 继承），随快照留证
        fwBorder: cs.getPropertyValue('--fw-border').trim(),
      };
    });
    // 双保险 1：单断言证明全链——preflight *{border-color:var(--fw-border)} 桥 + .light 域覆写 + 消费真实。
    // 现状：岛根无任何 author border-color 规则 → 计算值走 currentColor 级联（实测 rgba(0,0,0,0.88)，经 .ant-app color 继承）
    expect(s.borderColor, `[G3] 岛根计算 border-color 期望 rgb(229, 231, 235)（#e5e7eb 经 --fw-border 桥）；实际=${JSON.stringify(s)}`).toBe('rgb(229, 231, 235)');
    // 双保险 2：直读自定义属性（.light 域内 --fw-border=#e5e7eb）；现状未定义 → 空串
    expect(s.fwBorder, `[G3] 岛根 --fw-border 期望 #e5e7eb；实际=${JSON.stringify(s)}`).toBe('#e5e7eb');
  });
});

test.describe('A1-4【现在绿，A2 后必须仍绿】产品 CSS 顺序守卫', () => {
  // 方向见文件头「组4 方向裁定」：antd cssinjs prepend 在 head 最前、vite 产物 link 在后——
  // 级联平 specificity 文档序后者胜 → 此序保证产品 CSS（A2 后含 preflight）对 antd 平局可胜，防注入顺序回归。
  test('antd cssinjs style 注入于 vite 产物 link 之前（产品 CSS 平局可胜）', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: USER_STATE });
    const page = await ctx.newPage();
    await openWorks(page);
    // antd 样式随组件挂载注入（/works 有 Dropdown 等）——有界轮询等其出现，不做 networkidle
    await expect
      .poll(
        () => page.evaluate(() => Array.from(document.head.children).findIndex((n) => n.tagName === 'STYLE' && ((n as HTMLStyleElement).textContent ?? '').includes('.ant-'))),
        { message: 'antd cssinjs style 注入', timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(0);
    const s = await page.evaluate(() => {
      const kids = Array.from(document.head.children);
      const productIdx = kids.findIndex((n) => n.tagName === 'LINK' && ((n as HTMLLinkElement).getAttribute('href') ?? '').match(/\/assets\/[^/]+\.css$/));
      const antdIdx = kids.findIndex((n) => n.tagName === 'STYLE' && ((n as HTMLStyleElement).textContent ?? '').includes('.ant-'));
      return {
        productIdx,
        antdIdx,
        headOrder: kids.map((n) => (n.tagName === 'LINK' ? `LINK(${(n as HTMLLinkElement).getAttribute('href') ?? ''})` : n.tagName)).join(' → '),
      };
    });
    expect(s.productIdx, `[G4] 未找到 vite 产物 CSS link（/assets/*.css）；实际 head 序列=${s.headOrder}`).toBeGreaterThanOrEqual(0);
    expect(s.antdIdx, `[G4] antd cssinjs style 必须先于产品 CSS link（现序防回归：产品层对 antd 平 specificity 可胜）；实际 head 序列=${s.headOrder}`).toBeLessThan(s.productIdx);
    await ctx.close();
  });
});

test.describe('A1-5【A6 增】(0,1,0) 档顺序核验（§2.6-3 余项）', () => {
  // 平 specificity（(0,1,0) 档）时级联按文档序取后者：preflight 的 :disabled/[hidden]（(0,1,0) 档）要胜过
  // antd 同档类选择器（如 .ant-btn{cursor:pointer}），必须文档序位于 antd 注入之后。G4 已断言元素级顺序
  // （antd STYLE 先于产物 LINK）；本组下钻规则级——直读 document.styleSheets 定位全局规则序：antd 禁用态
  // 类规则（.ant-btn:disabled 族随 Button 挂载整包注入）必须先于产品 sheet 内 preflight
  // :disabled{cursor:default}、[hidden]{display:none}（两规则 (0,1,0)）与 index.css
  // button:disabled{cursor:not-allowed}（(0,1,1)，经特异性压 preflight，位序同向佐证产品层最后落位）。
  test('antd 禁用态类规则先于产品 :disabled/[hidden] 规则（文档序平局归产品层）', async ({ page }) => {
    await openLogin(page); // PhoneLoginForm 挂载 antd Input/Button → 其样式（含禁用态规则）整包注入
    // 自包含快照函数（page.evaluate 直传，禁闭包依赖）：全 sheet 顶层规则序统一计数（跨域 sheet cssRules
    // 抛 SecurityError 则跳过该 sheet，计数口径一致）；未命中以 -1/空串回传，断言期统一判定
    const snapStylesheets = () => {
      const isProductSheet = (i: number) => {
        const n = document.styleSheets[i].ownerNode as HTMLLinkElement | null;
        return !!n && n.tagName === 'LINK' && /\/assets\/[^/]+\.css$/.test(n.getAttribute('href') ?? '');
      };
      const locate = (from: number, to: number, pred: (r: CSSStyleRule) => boolean) => {
        let g = 0;
        for (let i = 0; i <= to && i < document.styleSheets.length; i++) {
          let rules: CSSRuleList;
          try {
            rules = document.styleSheets[i].cssRules;
          } catch {
            continue;
          }
          for (let j = 0; j < rules.length; j++) {
            const r = rules[j];
            if (i >= from && r instanceof CSSStyleRule && pred(r)) return { global: g, sheetIdx: i, selectorText: r.selectorText };
            g++;
          }
        }
        return null;
      };
      let productSheetIdx = -1;
      for (let i = 0; i < document.styleSheets.length; i++) {
        if (isProductSheet(i)) {
          productSheetIdx = i;
          break;
        }
      }
      const flat = (h: { global: number; sheetIdx: number; selectorText: string } | null) => h ?? { global: -1, sheetIdx: -1, selectorText: '' };
      // antd 禁用态类规则只在产品 sheet 之前的 sheet 里找（其位序本就必须 < 产品 sheet）
      const antd = productSheetIdx >= 0 ? locate(0, productSheetIdx - 1, (r) => r.selectorText.includes('.ant-') && /:disabled|\[disabled\]/.test(r.selectorText)) : null;
      const pre = (pred: (r: CSSStyleRule) => boolean) => (productSheetIdx >= 0 ? locate(productSheetIdx, productSheetIdx, pred) : null);
      return {
        productSheetIdx,
        antdDisabled: flat(antd),
        preflightDisabled: flat(pre((r) => r.selectorText === ':disabled' && r.style.cursor === 'default')),
        preflightHidden: flat(pre((r) => r.selectorText.includes('[hidden]') && r.style.display === 'none')),
        productButtonDisabled: flat(pre((r) => r.selectorText.includes('button:disabled') && r.style.cursor === 'not-allowed')),
      };
    };
    await expect
      .poll(
        async () => {
          const s = await page.evaluate(snapStylesheets);
          return [s.productSheetIdx, s.antdDisabled.global, s.preflightDisabled.global, s.preflightHidden.global, s.productButtonDisabled.global].every((v) => v >= 0);
        },
        { message: '规则级定位（antd 禁用态规则注入 + 产品 sheet 内 preflight/button:disabled 规则出现）', timeout: 10_000 },
      )
      .toBe(true);
    const s = await page.evaluate(snapStylesheets);
    const brief = JSON.stringify(s);
    const dump = `快照=${brief}`;
    expect(s.productSheetIdx, `[G5] 未找到 vite 产物 CSS sheet（/assets/*.css）；${dump}`).toBeGreaterThanOrEqual(0);
    expect(s.antdDisabled.global, `[G5] 产品 sheet 之前未定位到 antd 禁用态类规则（.ant-*:disabled/[disabled]）——cssinjs 未注入或注入点回归；${dump}`).toBeGreaterThanOrEqual(0);
    expect(s.preflightDisabled.selectorText, `[G5] 产品 sheet 内未定位到 preflight :disabled{cursor:default}（(0,1,0) 档）；${dump}`).toBe(':disabled');
    expect(s.preflightHidden.selectorText, `[G5] 产品 sheet 内未定位到 preflight [hidden]{display:none}（(0,1,0) 档）；${dump}`).toContain('[hidden]');
    expect(s.productButtonDisabled.selectorText, `[G5] 产品 sheet 内未定位到 index.css button:disabled{cursor:not-allowed}（(0,1,1)）；${dump}`).toContain('button:disabled');
    expect(s.antdDisabled.sheetIdx, `[G5] antd 禁用态规则 sheet 位必须先于产品 sheet；${dump}`).toBeLessThan(s.productSheetIdx);
    // 方向断言（全局规则序）：平 (0,1,0) 档文档序后者胜 → antd 禁用态规则必须先于产品三规则
    expect(s.antdDisabled.global, `[G5] antd 禁用态规则(${s.antdDisabled.selectorText})必须先于产品 :disabled 规则(${s.preflightDisabled.selectorText})——平 (0,1,0) 档文档序后者胜；${dump}`).toBeLessThan(s.preflightDisabled.global);
    expect(s.antdDisabled.global, `[G5] antd 禁用态规则(${s.antdDisabled.selectorText})必须先于产品 [hidden] 规则(${s.preflightHidden.selectorText})；${dump}`).toBeLessThan(s.preflightHidden.global);
    expect(s.antdDisabled.global, `[G5] antd 禁用态规则(${s.antdDisabled.selectorText})必须先于产品 button:disabled 规则(${s.productButtonDisabled.selectorText})；${dump}`).toBeLessThan(s.productButtonDisabled.global);
    await test.info().attach('G5-stylesheet-order', { body: JSON.stringify(s, null, 2), contentType: 'application/json' });
  });
});
