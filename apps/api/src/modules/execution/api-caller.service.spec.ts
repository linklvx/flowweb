import { Test, TestingModule } from '@nestjs/testing';
import { ApiCallerService } from './api-caller.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ApiCallerService', () => {
  let service: ApiCallerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ApiCallerService],
    }).compile();
    service = module.get<ApiCallerService>(ApiCallerService);
  });

  it('should return mock image result with URL', async () => {
    const result = await service.callImageGen({
      prompt: '一只猫',
      extraPrompt: '阳光窗台',
      style: '写实',
      model: 'SD XL',
      resolution: '1024×1024',
    });
    expect(result.url).toContain('/mock/');
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1024);
  });

  it('should take at least 500ms (simulated delay)', async () => {
    const start = Date.now();
    await service.callImageGen({ prompt: 'test', model: 'SD XL' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(500);
  });

  it('should default to 1024×1024 when no resolution given', async () => {
    const result = await service.callImageGen({ prompt: 'test', model: 'SD XL' });
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1024);
  });

  describe('callVideoGen', () => {
    it('should return mock video URL for unknown model', async () => {
      const result = await service.callVideoGen({
        prompt: '一只小狗', model: 'unknown-model', mode: 'text-to-video',
      });
      expect(result.url).toContain('/mock/');
    });

    it('should fallback to mock when model config is not video type', async () => {
      const result = await service.callVideoGen({
        prompt: 'test', model: 'seed-model-sdxl', mode: 'text-to-video',
      });
      expect(result.url).toContain('/mock/');
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
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ output: { task_id: 'task-1', task_status: 'PENDING' } }),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({
            output: {
              task_status: 'SUCCEEDED',
              results: [{ url: 'https://dashscope.result/outpaint.png' }],
            },
          }),
        });
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

      vi.unstubAllGlobals();
    });
  });

  describe('callErase', () => {
    it('should submit and poll for erase result', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ output: { task_id: 'task-456', task_status: 'PENDING' } }),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({
            output: {
              task_status: 'SUCCEEDED',
              results: [{ url: 'https://dashscope.result/erase.png' }],
            },
          }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await service.callErase('https://example.com/img.png', 'https://example.com/mask.png');
      expect(result.url).toBe('https://dashscope.result/erase.png');
      expect(mockFetch).toHaveBeenCalledTimes(2);

      vi.unstubAllGlobals();
    });
  });

  describe('callRedraw', () => {
    it('should submit and poll for redraw result with strength converted', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ output: { task_id: 'task-789', task_status: 'PENDING' } }),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({
            output: {
              task_status: 'SUCCEEDED',
              results: [{ url: 'https://dashscope.result/redraw.png' }],
            },
          }),
        });
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

      vi.unstubAllGlobals();
    });
  });
});
