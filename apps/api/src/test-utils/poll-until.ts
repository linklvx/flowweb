// apps/api/src/test-utils/poll-until.ts
// Y0a-1：库行为锚轮询器——A1/A5/A6/A9 的异步 settle 判据（vi.waitFor 覆盖不到的跨 timer 断言）。
export async function pollUntil(cond: () => boolean | Promise<boolean>, deadlineMs = 5_000, intervalMs = 50): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`pollUntil timeout after ${deadlineMs}ms`);
}
