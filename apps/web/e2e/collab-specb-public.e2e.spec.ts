// Spec B B7-2 公开页 e2e（匿名 /videos/:id → 查看制作过程——ProcessSnapshot 第 4 渲染面）。
// 装置：specb-gate-seed（collab-global-setup 调用）——已发布作品 specb-public-work 挂源画布
// specb-public-canvas（分镜组 1×3：2 完成图 + 1 空槽；缩略图=真实 PNG 对象在 MinIO——「宫格有图」
// 判据要真加载 naturalWidth>0，非仅 src 在场）。
// 锚（plan B7-2 公开页 e2e 行）：
//   ① 宫格有图（2 img，thumbnailUrl 通道——匿名无会话拿不到预签名 fileId 通道）
//   ② 无 fileId（/process 响应体零 fileId 子串——公开 payload 泄漏红线，api 白名单剥键）
//   ③ 无+号（空槽无 fill 按钮——onFillEmpty 缺省；process-snapshot 内按钮数=0）
//   ④ 无 Delete（onRemoveCell 缺省=零键监听——按 Delete 图数不减；只读快照格子不可点选属设计）
// 匿名=全新 context（零 storageState）——公开组路由 /videos/:id? 不经 RequireAuth。
import { test, expect } from '@playwright/test';

const WORK_ID = 'specb-public-work';

test.beforeEach(async () => {
  // gate 控制面在场自证（与 collab-r2-commands 同款安全网——本 spec 只读公开端，不强求 API 自管，
  // 但整套经 gate 运行的纪律一致）
  const res = await fetch(`${process.env.COLLAB_E2E_API_CONTROL ?? 'http://127.0.0.1:3100'}/status`);
  const { up } = await res.json();
  if (!up) throw new Error('gate 控制面 API 不在线——本 spec 必须经 scripts/gate-collab.mjs 运行');
});

test('匿名公开页：宫格有图（真加载）+payload 无 fileId+空槽无+号+无 Delete 热键', async ({ browser }) => {
  const ctx = await browser.newContext(); // 匿名——零会话
  const page = await ctx.newPage();

  // ② 无 fileId：拦截 /process 响应体（白名单剥键红线——api 出入口契约；断言在拿到响应后主线程面做）
  let processBody = '';
  await page.route(`**/api/video-works/${WORK_ID}/process`, async (route) => {
    const res = await route.fetch();
    const body = await res.text();
    processBody = body;
    await route.fulfill({ response: res, body });
  });

  await page.goto(`/videos/${WORK_ID}`);
  // 弹层打开（匿名可进——公开组路由）；成品视频对象不存在→onError 自愈回预览态（按钮不受影响）
  await expect(page.getByLabel('查看制作过程')).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('查看制作过程').click();

  const snap = page.getByTestId('process-snapshot');
  await expect(snap).toBeVisible({ timeout: 20_000 });

  // ① 宫格有图：2 img（2 完成图 + 1 空槽）且真加载（naturalWidth>0——真实 MinIO 对象）
  const imgs = snap.locator('img');
  await expect(imgs).toHaveCount(2, { timeout: 15_000 });
  await expect.poll(async () => {
    const loaded = await imgs.evaluateAll((els) =>
      els.filter((e) => (e as HTMLImageElement).naturalWidth > 0).length);
    return loaded;
  }, { timeout: 20_000, message: '宫格缩略图未真实加载（naturalWidth=0）' }).toBe(2);

  // ② 主线程面断言（route handler 内 throw 会被吞——捕获后在此判）
  expect(processBody, '/process 响应体不得含 fileId（公开 payload 泄漏红线）').not.toContain('fileId');
  expect(processBody).toContain('thumbnailUrl'); // 通道 4 载荷在场（api injectThumbnails+白名单保留）

  // ③ 无+号（且整个过程页零按钮——+号/删除 UI 双面）
  await expect(snap.locator('button')).toHaveCount(0);

  // ④ 无 Delete：只读快照 RF pane 拦截指针（elementsSelectable=false——格子本就不可点选，首跑实证）；
  //    删除热键面=onRemoveCell 缺省零注册——直接按键：图数不减即无删除通道
  await page.keyboard.press('Delete');
  await page.waitForTimeout(500);
  await expect(snap.locator('img')).toHaveCount(2);
  await ctx.close();
});
