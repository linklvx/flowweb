// 批7 E2E fake provider（COLLAB_FAKE_AI）：各外呼固定结果零外部调用 + 生产 env 校验拒绝。
// 断言源：master plan 批7 行——"env COLLAB_FAKE_AI=1（dev-only fake provider——ApiCallerService 各 callXxx
// 固定结果，生产 env 校验拒绝该值）"；fake 期间不得发起任何真实外呼（global.fetch 打死）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiCallerService } from './api-caller.service';

describe('批7 COLLAB_FAKE_AI 外呼 stub', () => {
  beforeEach(() => {
    // 外呼打死：fake 模式下任何 fetch 都是门禁失败（真实外呼=随机失败/真实账单）
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('COLLAB_FAKE_AI 模式下不得发起真实外呼'); }));
    vi.stubEnv('COLLAB_FAKE_AI', '1');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('七个 callXxx 全部返回固定结果且零 fetch', async () => {
    const svc = new ApiCallerService();
    const text = await svc.callTextGen({ prompt: 'E2E 冒烟提示词', model: 'seed-model-kimi', apiUrl: '' });
    expect(text.content).toContain('COLLAB_FAKE_AI');
    expect(text.content).toContain('E2E 冒烟提示词');

    const image = await svc.callImageGen({ prompt: 'p', model: 'seed-model-hy-image', resolution: '1024×1024' });
    expect(image.url).toMatch(/^\/mock\//);
    expect(image).toMatchObject({ width: 1024, height: 1024 });

    const video = await svc.callVideoGen({ prompt: 'p', model: 'seed-model-hy-video', mode: 'text-to-video' });
    expect(video.url).toMatch(/^\/mock\//);

    for (const url of [
      await svc.callOutpainting('http://img', { x: 0, y: 0, width: 10, height: 10 }, 100, 100),
      await svc.callErase('http://img', 'http://mask'),
      await svc.callRedraw('http://img', 'http://mask', 'p', 50),
      await svc.callRelighting('http://img', 'p'),
    ]) {
      expect(url.url).toMatch(/^\/mock\//);
    }
    expect(fetch).not.toHaveBeenCalled();
  }, 15_000);

  it('fake 有 1~2s 延迟（E2E 断连窗口/执行态对齐需要可观测 loading 期）', async () => {
    const svc = new ApiCallerService();
    const t0 = Date.now();
    await svc.callTextGen({ prompt: 'p', model: 'seed-model-kimi', apiUrl: '' });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(elapsed).toBeLessThan(3000); // 上界留余量（随机 1.5~2s + 计时开销）
  }, 15_000);

  it('生产 env 拒绝：NODE_ENV=production + COLLAB_FAKE_AI=1 → 构造即抛（启动失败防误配）', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => new ApiCallerService()).toThrow(/COLLAB_FAKE_AI.*生产/);
  });

  it('回归锚：flag 关闭时真实路径不受影响（未配置模型走既有 mock 文本，不发 fake 前缀）', async () => {
    vi.stubEnv('COLLAB_FAKE_AI', '');
    const svc = new ApiCallerService();
    const text = await svc.callTextGen({ prompt: 'hello', model: 'unregistered-model', apiUrl: '' });
    expect(text.content).toBe('[Mock response for: hello...]');
  });
});
