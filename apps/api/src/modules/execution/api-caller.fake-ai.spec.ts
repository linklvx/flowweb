// 批7 E2E fake provider（COLLAB_FAKE_AI）：各外呼固定结果零外部调用 + Y0b-2 T2 启动断言豁免档。
// 断言源：master plan 批7 行——"env COLLAB_FAKE_AI=1（dev-only fake provider——ApiCallerService 各 callXxx
// 固定结果）"；fake 期间不得发起任何真实外呼（global.fetch 打死）。
// Y0b-2（Z93）：原 NODE_ENV=production 构造守卫删（与 NODE_ENV 解耦）——fail-closed 主线改为
// onModuleInit 缺密钥拒启 + COLLAB_FAKE_AI=1 显式豁免档（本文件判别性用例；深表在 api-caller.hardening.spec）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiCallerService } from './api-caller.service';

/** 直构 stub prisma（fake 分支/断言路径外零模型查询消费——findMany 供 onModuleInit） */
const stubPrisma = () => ({ aIModel: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) } }) as any;

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
    const svc = new ApiCallerService(stubPrisma());
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
    const svc = new ApiCallerService(stubPrisma());
    const t0 = Date.now();
    await svc.callTextGen({ prompt: 'p', model: 'seed-model-kimi', apiUrl: '' });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(elapsed).toBeLessThan(3000); // 上界留余量（随机 1.5~2s + 计时开销）
  }, 15_000);

  it('Z93 判别①：缺密钥（零 ready 行+零 seedEnv）→ onModuleInit 拒启（fail-closed 与 NODE_ENV 解耦）', async () => {
    vi.stubEnv('COLLAB_FAKE_AI', ''); // 非豁免档
    // vitest 加载 apps/api/.env（moonshot/tencent 有值）——三键显式清零后断言才判别
    vi.stubEnv('PROVIDER_MOONSHOT_API_KEY', '');
    vi.stubEnv('PROVIDER_TENCENT_API_KEY', '');
    vi.stubEnv('DASHSCOPE_API_KEY', '');
    const svc = new ApiCallerService(stubPrisma());
    await expect(svc.onModuleInit()).rejects.toThrow(/PROVIDER_MOONSHOT_API_KEY/);
  });

  it('Z93 判别②：COLLAB_FAKE_AI=1 显式豁免档 → onModuleInit 照常通过（fake 前置分支不因缺密钥红）', async () => {
    const svc = new ApiCallerService(stubPrisma());
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
  });

  it('回归锚：flag 关闭+未注册模型 → PROVIDER_UNKNOWN_MODEL 4xx（Y0b-2 mock 假产物分支退役——非 fake 前缀亦非 mock 文本）', async () => {
    vi.stubEnv('COLLAB_FAKE_AI', '');
    const svc = new ApiCallerService({ aIModel: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) } } as any);
    await expect(svc.callTextGen({ prompt: 'hello', model: 'unregistered-model', apiUrl: '' }))
      .rejects.toMatchObject({ errorCode: 'PROVIDER_UNKNOWN_MODEL' });
  });
});
