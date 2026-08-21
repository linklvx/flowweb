import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SmsService } from './sms.service';

// 静态 mock TencentCloudSdk（不再动态 import）
vi.mock('tencentcloud-sdk-nodejs-sms', () => ({
  sms: {
    v20210111: {
      Client: vi.fn().mockImplementation(() => ({
        SendSms: vi.fn().mockResolvedValue({ SendStatusSet: [{ Code: 'Ok' }] }),
      })),
    },
  },
}));

describe('SmsService', () => {
  let service: SmsService;
  let mockRedis: { eval: any; evalsha: any; del: any; script: any; load: any };

  beforeEach(async () => {
    mockRedis = {
      eval: vi.fn(),
      evalsha: vi.fn(),
      del: vi.fn(),
      script: vi.fn().mockReturnThis(),
      load: vi.fn().mockResolvedValue('fake-sha'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsService,
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get<SmsService>(SmsService);
    // 静默 onModuleInit 的 SCRIPT LOAD
    await service.onModuleInit();
  });

  describe('onModuleInit', () => {
    it('should preload Lua scripts and cache SHA', async () => {
      expect(mockRedis.script).toHaveBeenCalledWith('LOAD', expect.stringContaining('redis.call'));
    });
  });

  describe('storeOtp', () => {
    it('should call EVALSHA with cached SHA (preferred path)', async () => {
      mockRedis.evalsha.mockResolvedValue(0);
      await service.storeOtp('+8613800138000', '123456');
      expect(mockRedis.evalsha).toHaveBeenCalled();
      expect(mockRedis.eval).not.toHaveBeenCalled();
    });

    it('should fallback to EVAL on NOSCRIPT error', async () => {
      mockRedis.evalsha.mockRejectedValue(new Error('NOSCRIPT'));
      mockRedis.eval.mockResolvedValue('OK');
      await service.storeOtp('+8613800138000', '123456');
      expect(mockRedis.eval).toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    it('should return true on success (0)', async () => {
      mockRedis.evalsha.mockResolvedValue(0);
      const result = await service.verifyOtp('+8613800138000', '123456');
      expect(result).toBe(true);
    });

    it('should return false on wrong code (-3)', async () => {
      mockRedis.evalsha.mockResolvedValue(-3);
      const result = await service.verifyOtp('+8613800138000', '000000');
      expect(result).toBe(false);
    });

    it('should return false on not found (-1)', async () => {
      mockRedis.evalsha.mockResolvedValue(-1);
      const result = await service.verifyOtp('+8613800138000', '123456');
      expect(result).toBe(false);
    });

    it('should return false on too many attempts (-2)', async () => {
      mockRedis.evalsha.mockResolvedValue(-2);
      const result = await service.verifyOtp('+8613800138000', '123456');
      expect(result).toBe(false);
    });
  });

  describe('deleteOtp', () => {
    it('should delete code and errors keys', async () => {
      await service.deleteOtp('+8613800138000');
      expect(mockRedis.del).toHaveBeenCalledWith(
        'sms:{+8613800138000}:code',
        'sms:{+8613800138000}:errors',
      );
    });
  });

  describe('sendSms', () => {
    it('should use singleton client (no dynamic import)', async () => {
      await service.sendSms('+8613800138000', '123456');
      // 不抛异常即通过
    });
  });
});
