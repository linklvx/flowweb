// A0 before-基线采集（现状/暗色基线；浅色主题基线刻意延后到 B6）。
// 与断言分离：本 spec 只写原始 JSON + 截图 + meta；A5 的 diff/断言脚本另行编写（结构保证可配对：
// 每条元素记录带稳定键 = data-testid 优先，否则 DOM 路径 + 标签 + 同标签序号）。
//
// 调用方式（默认 `npx playwright test` 不跑本文件——env 守卫跳过）：
//   COLLECT_BASELINE=1 npx playwright test e2e/a0-collect-baseline.spec.ts
// 产物：e2e/baseline/before-A0/<page>.json + <page>.png + meta.json（含基线 commit）
//
// 加载稳定性纪律：目标元素出现 + 固定沉降等待；禁 networkidle（socket.io/ws 长连接 + antd 动画永不安定）。
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';

const HERE = import.meta.dirname!;
const OUT_DIR = path.join(HERE, 'baseline', 'before-A0');
const VIEWPORT = { width: 1280, height: 800 };
const SETTLE_MS = 800; // 目标元素出现后的固定沉降（动画/字体收尾），不做 networkidle

test.skip(!process.env.COLLECT_BASELINE, 'A0 基线采集专用：COLLECT_BASELINE=1 npx playwright test e2e/a0-collect-baseline.spec.ts');

/** 页内全量元素几何/计算样式快照（在浏览器上下文执行；排除规则见 excludedBy） */
async function snapshotDom(page: Page) {
  return page.evaluate(() => {
    // className 稳定哈希：djb2 八位 hex——防原子类长串撑爆快照，且跨采集可配对（确定性）
    const hashCls = (s: string) => {
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0) >>> 0;
      return h.toString(16).padStart(8, '0');
    };
    // 动态区域排除规则（文档化——快照配对时这些区域无稳定几何）：
    //  canvas/WebGL 元素、video、波形容器（testid/class 含 wave）、纯时间文本（mm:ss / h:mm:ss）
    const excludedBy = (el: Element): string | null => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'canvas') return 'canvas/webgl';
      if (tag === 'video') return 'video';
      const tid = el.getAttribute('data-testid') ?? '';
      const cls = el.getAttribute('class') ?? '';
      if (/wave/i.test(tid) || /wavesurfer|waveform/i.test(cls)) return 'waveform';
      if (el.children.length === 0 && /^\s*\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*$/.test(el.textContent ?? '')) return 'time-text';
      return null;
    };
    // 元素配对稳定键：data-testid 优先；否则 DOM 路径（标签 + 同标签兄弟序号，锚定 body）
    const stableKey = (el: Element): string => {
      const tid = el.getAttribute('data-testid');
      if (tid) return `tid:${tid}`;
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur.tagName !== 'BODY' && cur.tagName !== 'HTML') {
        const parent: Element | null = cur.parentElement;
        let idx = 0;
        if (parent) {
          for (const sib of Array.from(parent.children)) {
            if (sib === cur) break;
            if (sib.tagName === cur.tagName) idx++;
          }
        }
        parts.unshift(`${cur.tagName.toLowerCase()}[${idx}]`);
        cur = parent;
      }
      return `dom:${parts.join('/')}`;
    };
    const FORM_CONTROL = new Set(['input', 'textarea', 'select', 'button']);
    const out: unknown[] = [];
    const walk = document.body;
    const all = [walk, ...Array.from(walk.querySelectorAll('*'))];
    for (const el of all) {
      const exc = excludedBy(el);
      if (exc) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const cls = el.getAttribute('class') ?? '';
      const tag = el.tagName.toLowerCase();
      const rec: Record<string, unknown> = {
        key: stableKey(el),
        tag,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        padding: { t: cs.paddingTop, r: cs.paddingRight, b: cs.paddingBottom, l: cs.paddingLeft },
        borderWidth: { t: cs.borderTopWidth, r: cs.borderRightWidth, b: cs.borderBottomWidth, l: cs.borderLeftWidth },
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        // 计算样式属性集（精确冻结）：box-sizing + 四边 border-style/color；color 仅表单控件（继承色噪声大）
        boxSizing: cs.boxSizing,
        borderStyle: { t: cs.borderTopStyle, r: cs.borderRightStyle, b: cs.borderBottomStyle, l: cs.borderLeftStyle },
        borderColor: { t: cs.borderTopColor, r: cs.borderRightColor, b: cs.borderBottomColor, l: cs.borderLeftColor },
        clsHash: cls ? hashCls(cls) : null,
        clsLen: cls.length,
      };
      if (FORM_CONTROL.has(tag)) rec.color = cs.color;
      if (el.getAttribute('aria-disabled')) rec.ariaDisabled = el.getAttribute('aria-disabled');
      out.push(rec);
    }
    return { url: location.href, title: document.title, elementCount: out.length, elements: out };
  });
}

/** 采集一页：等标记元素 → 沉降 → DOM 快照 JSON + 视口截图 */
async function collectPage(page: Page, name: string, marker: () => Promise<void>) {
  await marker();
  await page.waitForTimeout(SETTLE_MS);
  const snap = await snapshotDom(page);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify({ page: name, collectedAt: new Date().toISOString(), ...snap }, null, 1));
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  console.log(`[baseline] ${name}: ${snap.elementCount} 元素`);
}

function getCommit() {
  try { return execSync('git rev-parse HEAD', { cwd: path.join(HERE, '../..') }).toString().trim(); }
  catch { return '(unknown)'; }
}

test.describe('A0 before-基线采集', () => {
  test('login + register（公开页）', async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await collectPage(page, 'login', async () => {
      await page.goto('/login');
      await expect(page.getByRole('button', { name: '邮箱登录' })).toBeVisible();
    });
    await collectPage(page, 'register', async () => {
      await page.goto('/register');
      await expect(page.getByRole('button', { name: '注册', exact: true })).toBeVisible();
    });
  });

  test('works + videos（USER 会话）', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: path.join(HERE, '.auth', 'user.json'), viewport: VIEWPORT });
    const page = await ctx.newPage();
    await collectPage(page, 'works', async () => {
      await page.goto('/works');
      await expect(page.getByText('A0-0 门禁画布').first()).toBeVisible({ timeout: 15_000 });
    });
    await collectPage(page, 'videos', async () => {
      await page.goto('/videos');
      await expect(page.getByText('A0-0 门禁样例视频').first()).toBeVisible({ timeout: 15_000 });
    });
    await ctx.close();
  });

  test('canvas 画布页 + 材料库弹层 OPEN（USER 会话）', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: path.join(HERE, '.auth', 'user.json'), viewport: VIEWPORT });
    const page = await ctx.newPage();
    await collectPage(page, 'canvas', async () => {
      await page.goto('/canvas?projectId=gate-canvas-1');
      await expect(page.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.react-flow__node[data-id="gate-node-1"]')).toBeVisible({ timeout: 10_000 });
    });
    await collectPage(page, 'material-modal', async () => {
      await page.getByRole('button', { name: '素材库' }).click();
      await expect(page.getByText('我的素材库').first()).toBeVisible({ timeout: 10_000 });
    });
    await ctx.close();
  });

  /** video-editor DOM 骨架：真实 UI 流创建 videoEdit 节点（添加节点菜单→多轨道剪辑）→ 打开编辑器 →
   *  采集后清理：删掉画布上全部 videoEdit 节点（含历史残留），gate fixture 复原为 2 节点，采集可重复。
   *  可见性断言锚 data-testid=video-editor-shell——dialog 外层包 fixed 子元素自身零尺寸，toBeVisible 恒 false */
  test('video-editor DOM 骨架（USER 会话，含节点清理）', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: path.join(HERE, '.auth', 'user.json'), viewport: VIEWPORT });
    const page = await ctx.newPage();
    await page.goto('/canvas?projectId=gate-canvas-1');
    await expect(page.locator('.react-flow__node[data-id="gate-node-1"]')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: '添加节点' }).click();
    await page.getByRole('menuitem', { name: /多轨道剪辑/ }).click();
    // 新节点经 collab 同步渲染（VideoEditNode 带「⤢ 全屏编辑」按钮）
    await expect(page.getByRole('button', { name: '⤢ 全屏编辑' }).first()).toBeVisible({ timeout: 15_000 });
    await collectPage(page, 'video-editor', async () => {
      await page.getByRole('button', { name: '⤢ 全屏编辑' }).first().click();
      await expect(page.getByTestId('video-editor-shell')).toBeVisible({ timeout: 10_000 });
    });

    // 清理：Esc 关编辑器（flush 后 close）→ 逐个选中并删除全部 videoEdit 节点 → 断言画布复原为 gate 双节点
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
    await ctx.close();
  });

  /** admin 代表页（/admin/models 模型管理）：独立浏览器上下文 UI 登录 ADMIN，
   *  storageState 存 e2e/.auth/admin.json（.auth/ 整目录已 gitignore，勿覆写 USER 态） */
  test('admin 代表页（ADMIN 会话）', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.getByRole('button', { name: '邮箱登录' }).click();
    await page.getByPlaceholder('邮箱').fill('admin@flowweb.local');
    await page.getByPlaceholder('密码').fill('admin12345');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByTestId('auth-modal-backdrop')).toBeHidden({ timeout: 15_000 });
    await ctx.storageState({ path: path.join(HERE, '.auth', 'admin.json') });

    await collectPage(page, 'admin-models', async () => {
      await page.goto('/admin/models');
      // admin 布局侧栏出现即就绪（RequireAdmin 失败会重定向，URL 断言兜底）
      await expect(page).toHaveURL(/\/admin\/models/);
      await expect(page.getByText('模型管理').first()).toBeVisible({ timeout: 15_000 });
    });
    await ctx.close();
  });

  test.afterAll(() => {
    // 默认门禁跑法（无 env）本文件全跳过——afterAll 不落任何产物，保持 gate 目录干净
    if (!process.env.COLLECT_BASELINE) return;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUT_DIR, 'meta.json'),
      JSON.stringify(
        {
          commit: getCommit(),
          collectedAt: new Date().toISOString(),
          viewport: VIEWPORT,
          invocation: 'COLLECT_BASELINE=1 npx playwright test e2e/a0-collect-baseline.spec.ts',
          theme: '现状/暗色基线（before 任何 CSS 改动；浅色主题目标基线延后至 B6）',
          stableKeyFormat: 'data-testid 优先，否则 DOM 路径(标签[同标签序号]/…)',
          classNameStorage: 'djb2 十六进制哈希 + 长度（不存原串）',
          excludedRegions: ['canvas/WebGL 元素', 'video 元素', '波形容器（data-testid/class 含 wave）', '纯时间文本（mm:ss|h:mm:ss）'],
          computedPropertySet: [
            'rect(x,y,w,h)', 'padding(四边)', 'borderWidth(四边)', 'fontSize', 'lineHeight',
            'boxSizing', 'borderStyle(四边)', 'borderColor(四边)', 'color(仅 input/textarea/select/button)',
          ],
          pages: fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.json') && f !== 'meta.json').map((f) => f.replace('.json', '')),
        },
        null,
        2,
      ),
    );
    console.log(`[baseline] meta.json 已写入 ${OUT_DIR}`);
  });
});
