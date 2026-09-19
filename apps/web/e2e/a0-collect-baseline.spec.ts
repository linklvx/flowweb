// A0 before-基线采集（现状/暗色基线；浅色主题基线刻意延后到 B6）。
// 与断言分离：本 spec 只写原始 JSON + 截图 + meta；A5 的 diff/断言脚本另行编写（结构保证可配对：
// 每条元素记录带稳定键 = data-testid 优先（同 testid 重复时按 0 基 DOM 序加 @n 后缀），否则 DOM 路径 + 标签 + 同标签序号）。
//
// 调用方式（默认 `npx playwright test` 不跑本文件——env 守卫跳过）：
//   COLLECT_BASELINE=1 npx playwright test e2e/a0-collect-baseline.spec.ts
// 产物：e2e/baseline/<dir>/<page>.json + <page>.png + meta.json（含基线 commit）
// 输出目录可用 BASELINE_DIR 覆盖（相对 e2e/baseline/ 的目录名；默认 before-A0 不动）：
//   A 段后复采（A5 diff 用）：COLLECT_BASELINE=1 BASELINE_DIR=after-A npx playwright test e2e/a0-collect-baseline.spec.ts
//   B6 浅色目标基线（C 段浅色对照目标）：COLLECT_BASELINE=1 LIGHT_BASELINE=1 BASELINE_DIR=light-B6 npx playwright test e2e/a0-collect-baseline.spec.ts
//     —— B 期无主题切换 UI，测试侧注入 html.light 即机制（页加载后、快照/截图前）。
//     D4 语义：岛/画板不受动——login 岛本征浅色；canvas 画板 wrapper colorMode=dark 钉深
//     （:root,.dark 块在 wrapper 重新声明 --fw-*，覆盖 html.light 继承浅值）；videos/video-editor/
//     admin 恒深域用字面值与自持 token（--vw-*/--ve-*，:root 定义非主题块），html.light 只翻转
//     跟随域 --fw-* 消费者。采集时附岛不变性探针（结果落 meta，失败即红）。
//
// 加载稳定性纪律：目标元素出现 + 固定沉降等待；禁 networkidle（socket.io/ws 长连接 + antd 动画永不安定）。
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';

const HERE = import.meta.dirname!;
// 约束：目录名仅允许字母数字连字符（防路径逃逸/分隔符注入写错位置）
const BASELINE_DIR = process.env.BASELINE_DIR ?? 'before-A0';
if (!/^[a-zA-Z0-9-]+$/.test(BASELINE_DIR)) throw new Error(`[baseline] BASELINE_DIR 非法目录名: ${BASELINE_DIR}`);
const OUT_DIR = path.join(HERE, 'baseline', BASELINE_DIR);
const VIEWPORT = { width: 1280, height: 800 };
const SETTLE_MS = 800; // 目标元素出现后的固定沉降（动画/字体收尾），不做 networkidle
const LIGHT = !!process.env.LIGHT_BASELINE; // 浅色目标基线模式（B6）：html.light 注入后再快照

/** 浅色采集岛不变性探针结果（LIGHT 模式专用；afterAll 落 meta） */
const LIGHT_PROBES: Array<{ id: string; expected: string; actual: string; pass: boolean }> = [];

/** html.light 下恒深域值不得翻转（D4）——断言失败即红，结果记录进 meta 作 B6 证据 */
async function probeInvariance(page: Page, id: string, read: () => Promise<string>, expectedDark: string) {
  const actual = await read();
  LIGHT_PROBES.push({ id, expected: expectedDark, actual, pass: actual === expectedDark });
  expect(actual, `[light-B6 岛不变性/${id}] html.light 注入下恒深域值必须保持深色值`).toBe(expectedDark);
}

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
    // 元素配对稳定键：data-testid 优先；否则 DOM 路径（标签 + 同标签兄弟序号，锚定 body）。
    // 同 testid 页内重复（如双门禁节点各带 target/source handle 对）→ 按 0 基 DOM 序加后缀
    // tid:<id>@<n>（首现 @0、次现 @1…，唯一 testid 恒 @0）——防重复键静默互相覆盖。
    const tidSeen = new Map<string, number>();
    const stableKey = (el: Element): string => {
      const tid = el.getAttribute('data-testid');
      if (tid) {
        const n = tidSeen.get(tid) ?? 0;
        tidSeen.set(tid, n + 1);
        return `tid:${tid}@${n}`;
      }
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
  if (LIGHT) await page.evaluate(() => document.documentElement.classList.add('light'));
  await page.waitForTimeout(SETTLE_MS);
  const snap = await snapshotDom(page);
  // 采集后稳定键唯一性断言（fail-loud）：重复键会让未来 differ 静默丢记录——有重复即抛错不落盘
  const keyCount = new Map<string, number>();
  for (const el of snap.elements) {
    const k = (el as { key: string }).key;
    keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  }
  const dupes = [...keyCount.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`);
  if (dupes.length) throw new Error(`[baseline] ${name} 存在重复稳定键: ${dupes.join(', ')}`);
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
    if (LIGHT) {
      // videos 整域恒深（D4 保留）：封面底 #262626 字面值不随 html.light 翻转
      await probeInvariance(page, 'videos-封面底-#262626字面', () => page.evaluate(() => {
        const card = Array.from(document.querySelectorAll('a[data-card]'))
          .find((a) => a.textContent?.includes('A0-0 门禁样例视频'));
        return card ? getComputedStyle(card.querySelector('.aspect-video')!).backgroundColor : '(未找到门禁卡)';
      }), 'rgb(38, 38, 38)');
    }
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
    if (LIGHT) {
      // D4 语义双证：html 根 --fw-bg 翻浅（注入生效正向对照）+ 画板 wrapper 经 .dark 块重新声明保持深色
      await probeInvariance(page, 'canvas-html根--fw-bg翻浅(注入生效)', () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fw-bg').trim()), '#f7f8fa');
      await probeInvariance(page, 'canvas-画板wrapper--fw-bg钉深', () => page.evaluate(() => getComputedStyle(document.querySelector('.react-flow')!).getPropertyValue('--fw-bg').trim()), '#141414');
    }
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
    if (LIGHT) {
      // video-editor 岛自持 token：--ve-bg 定义在 :root（非主题块），html.light 不翻转
      await probeInvariance(page, 'video-editor-壳底--ve-bg自持', () => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="video-editor-shell"]')!).backgroundColor), 'rgb(20, 20, 20)');
    }

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
          invocation: `COLLECT_BASELINE=1${LIGHT ? ' LIGHT_BASELINE=1' : ''}${BASELINE_DIR === 'before-A0' ? '' : ` BASELINE_DIR=${BASELINE_DIR}`} npx playwright test e2e/a0-collect-baseline.spec.ts`,
          theme: LIGHT
            ? '浅色目标基线（C 段浅色对照目标）：html 注入 .light（B 期无主题切换 UI，测试侧注入即机制，快照/截图前）；岛/画板不受动——login 岛本征浅、canvas 画板 wrapper colorMode=dark 钉深、videos/video-editor 字面值与自持 token（--vw-*/--ve-*）恒深、admin 自绘 UI 字面值为主（--fw-* 消费者≈0，C2 接线前 html.light 对其基本无效果=预期）'
            : BASELINE_DIR === 'before-A0'
              ? '现状/暗色基线（before 任何 CSS 改动；浅色主题目标基线延后至 B6）'
              : `A 段基线（${BASELINE_DIR}；键/属性集与 before-A0 同构，供 css-baseline-diff 配对）`,
          ...(LIGHT ? { lightInjection: { mechanism: 'collectPage 内 page.evaluate classList.add("light")（每页加载后、SETTLE/快照/截图前；goto 重建文档故逐页重注入）', islandInvarianceProbes: LIGHT_PROBES } } : {}),
          stableKeyFormat: 'data-testid 优先（tid:<id>@<n>，n=同 testid 的 0 基 DOM 序，唯一时 @0），否则 DOM 路径(标签[同标签序号]/…)',
          classNameStorage: 'djb2 十六进制哈希 + 长度（不存原串）',
          excludedRegions: ['canvas/WebGL 元素', 'video 元素', '波形容器（data-testid/class 含 wave）', '纯时间文本（mm:ss|h:mm:ss）'],
          computedPropertySet: [
            'rect(x,y,w,h)', 'padding(四边)', 'borderWidth(四边)', 'fontSize', 'lineHeight',
            'boxSizing', 'borderStyle(四边)', 'borderColor(四边)', 'color(仅 input/textarea/select/button)',
          ],
          pages: fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.json') && f !== 'meta.json').sort().map((f) => f.replace('.json', '')),
        },
        null,
        2,
      ),
    );
    console.log(`[baseline] meta.json 已写入 ${OUT_DIR}`);
  });
});
