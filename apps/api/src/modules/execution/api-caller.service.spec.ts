import { Test, TestingModule } from '@nestjs/testing';
import { ApiCallerService } from './api-caller.service';
import { describe, it, expect, beforeEach } from 'vitest';

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
});
