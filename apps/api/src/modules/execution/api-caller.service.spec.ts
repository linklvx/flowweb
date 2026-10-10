import { Test, TestingModule } from '@nestjs/testing';
import { ApiCallerService } from './api-caller.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Y0b-2 T2：MODEL_CONFIG 退役——mock 四分支（无配置回落假图/假视频/mock 文本/Unknown model type）
// 随删，本 spec 原对应用例改写为 PROVIDER_UNKNOWN_MODEL 硬失败断言（深表在 api-caller.hardening.spec）。
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** tencent 提交-轮询模型行（5min 模块缓存按 id 隔离——id 逐用例唯一） */
const hyImageRow = (id: string) => ({
  id, active: true, provider: 'tencent', apiModelName: 'hy-image-v3.0',
  apiUrl: 'https://hy.example/v1/api/image', apiKey: 'sk-test',
});

describe('ApiCallerService', () => {
  let service: ApiCallerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiCallerService,
        { provide: PrismaService, useValue: { aIModel: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) } } },
      ],
    }).compile();
    service = module.get<ApiCallerService>(ApiCallerService);
  });

  it('should return real image result with URL and dimensions (submit+poll 真链)', async () => {
    vi.stubEnv('EXEC_POLL_TIMEOUT_MS', '1000'); // 单测实时钟——1s 轮询档
    (service as any).prisma.aIModel.findUnique.mockImplementation(async () => hyImageRow('spec-img-ok'));
    vi.stubGlobal('fetch', vi.fn(async (url: any) =>
      String(url).endsWith('/submit') ? jsonRes({ id: 't1' }) : jsonRes({ status: 'succeeded', data: ['https://r/cat.png'] })));
    const result = await service.callImageGen({
      prompt: '一只猫', extraPrompt: '阳光窗台', model: 'spec-img-ok', resolution: '1024×1024',
    });
    expect(result.url).toBe('https://r/cat.png');
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1024);
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
  });

  it('should default to 1024×1024 when no resolution given', async () => {
    vi.stubEnv('EXEC_POLL_TIMEOUT_MS', '1000');
    (service as any).prisma.aIModel.findUnique.mockImplementation(async () => hyImageRow('spec-img-default'));
    vi.stubGlobal('fetch', vi.fn(async (url: any) =>
      String(url).endsWith('/submit') ? jsonRes({ id: 't2' }) : jsonRes({ status: 'done', data: ['https://r/x.png'] })));
    const result = await service.callImageGen({ prompt: 'test', model: 'spec-img-default' });
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1024);
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
  });

  describe('callVideoGen', () => {
    it('unknown model → PROVIDER_UNKNOWN_MODEL（mock 视频分支已删——Y0b-2 T2）', async () => {
      await expect(service.callVideoGen({ prompt: '一只小狗', model: 'unknown-model', mode: 'text-to-video' }))
        .rejects.toMatchObject({ errorCode: 'PROVIDER_UNKNOWN_MODEL' });
    });

    it('模型 provider 非 tencent-submit-poll → PROVIDER_UNKNOWN_MODEL', async () => {
      (service as any).prisma.aIModel.findUnique.mockImplementation(async () => ({ ...hyImageRow('spec-vid-moonshot'), provider: 'moonshot', apiModelName: 'kimi-k2.6' }));
      await expect(service.callVideoGen({ prompt: 'test', model: 'spec-vid-moonshot', mode: 'text-to-video' }))
        .rejects.toMatchObject({ errorCode: 'PROVIDER_UNKNOWN_MODEL' });
    });
  });

  describe('combinePrompt', () => {
    it('should return prompt only when no extraPrompt', () => {
      expect((service as any).combinePrompt('高山 流水', undefined)).toBe('高山 流水');
    });

    it('should return extraPrompt when prompt is empty', () => {
      expect((service as any).combinePrompt('', '农夫 小孩')).toBe('农夫 小孩');
    });

    it('should combine prompt and extraPrompt with comma', () => {
      expect((service as any).combinePrompt('高山 流水', '农夫 小孩')).toBe('高山 流水, 农夫 小孩');
    });

    it('should return empty when both empty', () => {
      expect((service as any).combinePrompt('', '')).toBe('');
    });
  });

  describe('callOutpainting', () => {
    it('should convert outpaintRect to top/bottom/left/right for DashScope API', async () => {
      vi.stubEnv('EXEC_POLL_TIMEOUT_MS', '1000');
      vi.stubEnv('DASHSCOPE_API_KEY', 'sk-dash-test'); // 编辑链密钥=seedEnv 侧（无 AIModel 行）
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(jsonRes({ output: { task_id: 'task-1', task_status: 'PENDING' } }))
        .mockResolvedValueOnce(jsonRes({
          output: { task_status: 'SUCCEEDED', results: [{ url: 'https://dashscope.result/outpaint.png' }] },
        }));
      vi.stubGlobal('fetch', mockFetch);

      const result = await service.callOutpainting(
        'https://example.com/img.png',
        { x: -51, y: -51, width: 614, height: 614 },
        512, 512,
      );
      expect(result.url).toBe('https://dashscope.result/outpaint.png');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.input.top).toBe(51);
      expect(body.input.bottom).toBe(51);
      expect(body.input.left).toBe(51);
      expect(body.input.right).toBe(51);
      expect(body.input.prompt).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);

      vi.unstubAllGlobals(); vi.unstubAllEnvs();
    });
  });

  describe('callErase', () => {
    it('should submit and poll for erase result', async () => {
      vi.stubEnv('EXEC_POLL_TIMEOUT_MS', '1000');
      vi.stubEnv('DASHSCOPE_API_KEY', 'sk-dash-test'); // 编辑链密钥=seedEnv 侧（无 AIModel 行）
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(jsonRes({ output: { task_id: 'task-456', task_status: 'PENDING' } }))
        .mockResolvedValueOnce(jsonRes({
          output: { task_status: 'SUCCEEDED', results: [{ url: 'https://dashscope.result/erase.png' }] },
        }));
      vi.stubGlobal('fetch', mockFetch);

      const result = await service.callErase('https://example.com/img.png', 'https://example.com/mask.png');
      expect(result.url).toBe('https://dashscope.result/erase.png');
      expect(mockFetch).toHaveBeenCalledTimes(2);

      vi.unstubAllGlobals(); vi.unstubAllEnvs();
    });
  });

  describe('callRedraw', () => {
    it('should submit and poll for redraw result with strength converted', async () => {
      vi.stubEnv('EXEC_POLL_TIMEOUT_MS', '1000');
      vi.stubEnv('DASHSCOPE_API_KEY', 'sk-dash-test'); // 编辑链密钥=seedEnv 侧（无 AIModel 行）
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(jsonRes({ output: { task_id: 'task-789', task_status: 'PENDING' } }))
        .mockResolvedValueOnce(jsonRes({
          output: { task_status: 'SUCCEEDED', results: [{ url: 'https://dashscope.result/redraw.png' }] },
        }));
      vi.stubGlobal('fetch', mockFetch);

      const result = await service.callRedraw(
        'https://example.com/img.png',
        'https://example.com/mask.png',
        'a beautiful sunset',
        70,
      );
      expect(result.url).toBe('https://dashscope.result/redraw.png');

      // Verify the first call body includes strength / 100
      const firstCallBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(firstCallBody.input.strength).toBe(0.7);

      vi.unstubAllGlobals(); vi.unstubAllEnvs();
    });
  });
});
