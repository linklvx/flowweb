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
//     —— ⚠ 旧 classList 注入路径已废止（D0 后双类失真）：themeStore 首渲染即挂 html.dark，classList.add('light')
//     不移除 dark → html 双类 → 浅色采集静默失真；LIGHT_BASELINE 现与 REAL_LIGHT 同义（storage 真实路径）。
//     light-B6 基线系旧机制产物不可复用。
//   C7 真实浅色对照采集（真实路径）：COLLECT_BASELINE=1 REAL_LIGHT=1 BASELINE_DIR=<tmp 目录，勿覆写基线> …
//     —— localStorage theme=light 经 context/page addInitScript 预置（先于一切页面脚本，含 C1 内联
//     主题脚本）→ 真实浅色档挂 html.light；采集时逐页断言 html 类恰为 "light"（结果落 meta.realLight）。
//     C8 终态语义（D4）：壳/画板跟随翻转——canvas 画板 wrapper colorMode={mode} 双向翻转（镜像断言
//     守卫）；videos/video-editor 壳岛已拆除（D3），壳内 --fw-* 直承 html.light；恒深面只剩内容承载面
//     （videos 封面垫底 #262626 字面、ProcessSnapshot 整块 colorMode="dark" 常量）与 admin 深岛（域外
//     保留）。采集时探针分级：恒深面 probeInvariance / 跟随面 probeFlip（结果落 meta，失败即红）。
//
// 加载稳定性纪律：目标元素出现 + 固定沉降等待；禁 networkidle（socket.io/ws 长连接 + antd 动画永不安定）。
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const HERE = import.meta.dirname!;
// 约束：目录名仅允许字母数字连字符（防路径逃逸/分隔符注入写错位置）
const BASELINE_DIR = process.env.BASELINE_DIR ?? 'before-A0';
if (!/^[a-zA-Z0-9-]+$/.test(BASELINE_DIR)) throw new Error(`[baseline] BASELINE_DIR 非法目录名: ${BASELINE_DIR}`);
const OUT_DIR = path.join(HERE, 'baseline', BASELINE_DIR);
const VIEWPORT = { width: 1280, height: 800 };
/* COLLECTOR-FROZEN-BEGIN —— 冻结契约①：沉降等待时长（改动=两侧基线须同时重采，否则快照时点不可比）。
 * 边界：页面清单/流程不进指纹——页集减由 differ 缺页比对守卫、页集增由 differ union 页循环守卫。 */
const SETTLE_MS = 800; // 目标元素出现后的固定沉降（动画/字体收尾），不做 networkidle
/* COLLECTOR-FROZEN-END */
/* COLLECTOR-FROZEN-BEGIN —— 冻结契约②：浅色注入模式开关（storage 真实路径）。旧 classList 注入已废止
 * （D0 后 themeStore 首渲染挂 dark，add('light') 不移除 → html 双类 → 浅色采集静默失真）；
 * LIGHT_BASELINE 历史调用形态 env 兼容保留，语义=REAL_LIGHT。
 * 边界：页面清单/流程不进指纹——页集减由 differ 缺页比对守卫、页集增由 differ union 页循环守卫。 */
const REAL_LIGHT = !!process.env.REAL_LIGHT || !!process.env.LIGHT_BASELINE; // 真实浅色路径模式（C7 对照；D0 起 LIGHT_BASELINE 同义合一）：localStorage theme=light → C1 内联脚本
/* COLLECTOR-FROZEN-END */

/** 浅色采集岛不变性探针结果（REAL_LIGHT 模式共用；afterAll 落 meta） */
const LIGHT_PROBES: Array<{ id: string; expected: string; actual: string; pass: boolean }> = [];

/** 真实浅色路径逐页 html 类记录（REAL_LIGHT 专用；afterAll 落 meta.realLight） */
const REAL_LIGHT_HTML: Array<{ page: string; htmlClass: string; ok: boolean }> = [];

/** html.light 下恒深域值不得翻转（D4）——断言失败即红，结果记录进 meta 作浅色采集证据 */
async function probeInvariance(page: Page, id: string, read: () => Promise<string>, expectedDark: string) {
  const actual = await read();
  LIGHT_PROBES.push({ id, expected: expectedDark, actual, pass: actual === expectedDark });
  expect(actual, `[浅色采集/岛不变性/${id}] html.light 下恒深域值必须保持深色值`).toBe(expectedDark);
}

/** 跟随面翻转探针（C8 D2 起）：html.light 下取浅值（与 probeInvariance 方向相反）；meta 键分流防误判 */
const FLIP_PROBES: Array<{ id: string; expected: string; actual: string; pass: boolean }> = [];
async function probeFlip(page: Page, id: string, read: () => Promise<string>, expectedLight: string) {
  const actual = await read();
  FLIP_PROBES.push({ id, expected: expectedLight, actual, pass: actual === expectedLight });
  expect(actual, `[浅色采集/翻转探针/${id}] html.light 下跟随面必须取浅值`).toBe(expectedLight);
}

/* COLLECTOR-FROZEN-BEGIN —— 冻结契约②（续）：seedRealLight 注入本体（storage 真实路径——init script 先于
 * 一切页面脚本，含 C1 内联主题脚本；禁改回 classList 注入，理由见契约②首标记）。
 * 边界：页面清单/流程不进指纹——页集减由 differ 缺页比对守卫、页集增由 differ union 页循环守卫。 */
/** REAL_LIGHT：预置 theme=light（init script 先于一切页面脚本——C1 内联脚本读到显式浅色档） */
function seedRealLight(target: BrowserContext | Page) {
  return target.addInitScript(() => localStorage.setItem('theme', 'light'));
}
/* COLLECTOR-FROZEN-END */

test.skip(!process.env.COLLECT_BASELINE, 'A0 基线采集专用：COLLECT_BASELINE=1 npx playwright test e2e/a0-collect-baseline.spec.ts');

/* COLLECTOR-FROZEN-BEGIN —— 冻结契约③：snapshotDom 采集函数本体（稳定键 stableKey/djb2 clsHash/排除规则
 * excludedBy 与属性集实现均在此函数内——契约实现随函数显式冻结，勿依赖段位置隐含）。
 * 边界：页面清单/流程不进指纹——页集减由 differ 缺页比对守卫、页集增由 differ union 页循环守卫。 */
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
        // 计算样式属性集 D1（C8 D0-0 扩面）：新增全元素 backgroundColor + color（原 color 仅表单控件）
        boxSizing: cs.boxSizing,
        borderStyle: { t: cs.borderTopStyle, r: cs.borderRightStyle, b: cs.borderBottomStyle, l: cs.borderLeftStyle },
        borderColor: { t: cs.borderTopColor, r: cs.borderRightColor, b: cs.borderBottomColor, l: cs.borderLeftColor },
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        clsHash: cls ? hashCls(cls) : null,
        clsLen: cls.length,
      };
      if (el.getAttribute('aria-disabled')) rec.ariaDisabled = el.getAttribute('aria-disabled');
      out.push(rec);
    }
    return { url: location.href, title: document.title, elementCount: out.length, elements: out };
  });
}
/* COLLECTOR-FROZEN-END */

/** 采集一页：等标记元素 → 沉降 → DOM 快照 JSON + 视口截图 */
async function collectPage(page: Page, name: string, marker: () => Promise<void>) {
  await marker();
  if (REAL_LIGHT) {
    // 真实路径自证：C1 内联脚本应已挂 html.light 且恰一类（localStorage theme=light 显式档）
    const cls = await page.evaluate(() => document.documentElement.className);
    REAL_LIGHT_HTML.push({ page: name, htmlClass: cls, ok: cls === 'light' });
    expect(cls, `[real-light/${name}] 真实浅色路径 html 类必须恰为 "light"（theme=light → C1 内联脚本）；实际="${cls}"`).toBe('light');
  }
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
    if (REAL_LIGHT) await seedRealLight(page); // page 级 init script：对后续全部导航生效（先于页面脚本）
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
    if (REAL_LIGHT) await seedRealLight(ctx);
    const page = await ctx.newPage();
    await collectPage(page, 'works', async () => {
      await page.goto('/works');
      await expect(page.getByText('A0-0 门禁画布').first()).toBeVisible({ timeout: 15_000 });
    });
    await collectPage(page, 'videos', async () => {
      await page.goto('/videos');
      await expect(page.getByText('A0-0 门禁样例视频').first()).toBeVisible({ timeout: 15_000 });
    });
    if (REAL_LIGHT) {
      // 封面垫底恒深（P6 内容承载面，C8 D3 壳跟随后的残余恒深面）：封面底 #262626 字面值不随 html.light 翻转
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
    if (REAL_LIGHT) await seedRealLight(ctx);
    const page = await ctx.newPage();
    await collectPage(page, 'canvas', async () => {
      await page.goto('/canvas?projectId=gate-canvas-1');
      await expect(page.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.react-flow__node[data-id="gate-node-1"]')).toBeVisible({ timeout: 10_000 });
    });
    if (REAL_LIGHT) {
      // 第七轮 P2：html 根 --fw-bg 浅值期望是"翻转"语义——改走 probeFlip（原 probeInvariance 桶名/失败文案
      // 均为"恒深"，翻转断言落进去与桶名相反、误导后人读 meta）
      await probeFlip(page, 'canvas-html根--fw-bg翻浅(注入生效)', () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fw-bg').trim()), '#f7f8fa');
      // C8 D2 改视觉真值 + 反补岛镜像守卫（spec §10.3/§12.2 v1.3 分级①）
      await probeFlip(page, 'canvas-画板wrapper板底翻浅(视觉真值)', () => page.evaluate(() => getComputedStyle(document.querySelector('.react-flow')!).backgroundColor), 'rgb(245, 245, 245)');
      const mirror = await page.evaluate(() => {
        const wrapper = document.querySelector('.react-flow')!;
        const f = (cl: DOMTokenList) => Array.from(cl).filter((c) => c === 'light' || c === 'dark');
        return { wrapper: f(wrapper.classList), html: f(document.documentElement.classList) };
      });
      expect(mirror.wrapper, 'wrapper 主题类恰一个且等于 html 类（反补岛守卫）').toEqual(mirror.html);
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
    if (REAL_LIGHT) await seedRealLight(ctx);
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
    if (REAL_LIGHT) {
      // C8 D3-ve（Task 21）：壳岛拆除，探针双断言定稿——语义层 --fw-bg 浅值 + 视觉层壳根 backgroundColor=浅值
      // （原 D1b 岛不变式探针随岛拆除退役；恒深方向不再保留任何断言。探针面改动，冻结面指纹不受影响）
      await probeFlip(page, 'video-editor-壳根--fw-bg翻浅(语义层)', () => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="video-editor-shell"]')!).getPropertyValue('--fw-bg').trim()), '#f7f8fa');
      await probeFlip(page, 'video-editor-壳根底翻浅(视觉真值)', () => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="video-editor-shell"]')!).backgroundColor), 'rgb(247, 248, 250)');
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
    if (REAL_LIGHT) await seedRealLight(ctx);
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
          invocation: `COLLECT_BASELINE=1${process.env.LIGHT_BASELINE ? ' LIGHT_BASELINE=1' : ''}${process.env.REAL_LIGHT ? ' REAL_LIGHT=1' : ''}${BASELINE_DIR === 'before-A0' ? '' : ` BASELINE_DIR=${BASELINE_DIR}`} npx playwright test e2e/a0-collect-baseline.spec.ts`,
          theme: REAL_LIGHT
            ? '真实浅色路径（C7 对照；D0 起 LIGHT_BASELINE=1 同义合一——旧 classList 注入路径已废止（D0 后双类失真），light-B6 基线系旧机制产物不可复用）：localStorage theme=light 经 context/page addInitScript 预置（先于一切页面脚本，含 C1 head 内联主题脚本）→ 真实浅色档挂 html.light；C8 终态（D4）：壳/画板跟随翻转——canvas 画板 wrapper colorMode={mode} 双向翻转、videos/video-editor 壳岛已拆（D3），恒深面仅内容承载面（videos 封面垫底字面、ProcessSnapshot 整块 colorMode="dark" 常量）与 admin 深岛（域外保留）'
            : BASELINE_DIR === 'before-A0'
              ? '现状/暗色基线（before 任何 CSS 改动；浅色主题目标基线延后至 B6）'
              : `A 段基线（${BASELINE_DIR}；键/属性集与 before-A0 同构，供 css-baseline-diff 配对）`,
          ...(REAL_LIGHT ? { realLight: { mechanism: 'context/page addInitScript localStorage.setItem("theme","light")（先于一切页面脚本）→ C1 head 内联主题脚本解析显式浅色档挂 html.light', htmlClassPerPage: REAL_LIGHT_HTML, islandInvarianceProbes: LIGHT_PROBES, flipProbes: FLIP_PROBES } } : {}),
          stableKeyFormat: 'data-testid 优先（tid:<id>@<n>，n=同 testid 的 0 基 DOM 序，唯一时 @0），否则 DOM 路径(标签[同标签序号]/…)',
          classNameStorage: 'djb2 十六进制哈希 + 长度（不存原串）',
          excludedRegions: ['canvas/WebGL 元素', 'video 元素', '波形容器（data-testid/class 含 wave）', '纯时间文本（mm:ss|h:mm:ss）'],
          /* COLLECTOR-FROZEN-BEGIN —— 冻结契约④a：属性集版本号。differ 同代校验锚（before/after 不一致即 exit 1）；
           * 升版=采集属性集变更，须对侧基线同版重采。边界：页面清单/流程不进指纹——页集减由 differ 缺页比对守卫、
           * 页集增由 differ union 页循环守卫。 */
          attrSetVersion: 'D1',
          /* COLLECTOR-FROZEN-END */
          // D1 起全元素采集——D 段基线对比色；旧基线（无 attrSetVersion=A0）跨代比对走"属性缺失=不判"
          /* COLLECTOR-FROZEN-BEGIN —— 冻结契约④b：采集属性集清单（differ 属性 diff 的依据；扩面=D1 式升版登记）。
           * 边界：页面清单/流程不进指纹——页集减由 differ 缺页比对守卫、页集增由 differ union 页循环守卫。 */
          computedPropertySet: [
            'rect(x,y,w,h)', 'padding(四边)', 'borderWidth(四边)', 'fontSize', 'lineHeight',
            'boxSizing', 'borderStyle(四边)', 'borderColor(四边)', 'backgroundColor(全元素)', 'color(全元素,D1 起)',
          ],
          /* COLLECTOR-FROZEN-END */
          pages: fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.json') && f !== 'meta.json').sort().map((f) => f.replace('.json', '')),
        },
        null,
        2,
      ),
    );
    console.log(`[baseline] meta.json 已写入 ${OUT_DIR}`);
  });
});
