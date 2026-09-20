// C8 D2 画板像素对账（spec §10.2/§10 验收）：深色档以 D1b 后 checkout 为参照 0 diff（toHaveScreenshot
// maxDiffPixels:0 + threshold:0 + animations disabled）；浅色档断 xyflow 皮肤变量取值（翻转正确性，非 0 diff——D2 本身就是翻转）。
// 基线采集：D2 改码前 `npx playwright test e2e/d2-board-pixeldiff.spec.ts --update-snapshots` 落参照。
// 第六轮 B4/P1-3：snapshotPathTemplate 定死直落 e2e/audit/——无 projects 的仓默认快照名实为
// d2-board-dark-win32.png（无 -chromium 段），字面硬编码必踩"文件不存在"；模板直落 audit 后文件名确定、
// 固化/校验/比对三处同一文件，"副本 vs 真身"缝隙从结构上消失（真身入 git，被 --update-snapshots 覆盖时
// sha256sum -c 红、git checkout -- 恢复）。
import path from 'node:path';
import { test, expect } from '@playwright/test';

// ⚠ 第七轮 M2：snapshotPathTemplate 配置在 playwright.config.ts 顶层（与快照同 commit）——
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
