import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RateLimiterService } from './rate-limiter.service';

describe('RateLimiterService', () => {
  let service: RateLimiterService;
  let mockRedis: { set: any; incr: any; expire: any; del: any };

  beforeEach(async () => {
    mockRedis = {
      set: vi.fn(),
      incr: vi.fn(),
      expire: vi.fn(),
      del: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimiterService,
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get<RateLimiterService>(RateLimiterService);
  });

  describe('checkPhoneRateLimit', () => {
    it('should return true when lock acquired (SET NX returns OK)', async () => {
      mockRedis.set.mockResolvedValue('OK');
      const result = await service.checkPhoneRateLimit('+8613800138000');
      expect(result).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'sms:{+8613800138000}:send', '1', 'EX', 60, 'NX',
      );
    });

    it('should return false when lock not acquired (SET NX returns null)', async () => {
      mockRedis.set.mockResolvedValue(null);
      const result = await service.checkPhoneRateLimit('+8613800138000');
      expect(result).toBe(false);
    });

    it('should use Hash Tag format for key', async () => {
      mockRedis.set.mockResolvedValue('OK');
      await service.checkPhoneRateLimit('+8613800138000');
      const keyArg = mockRedis.set.mock.calls[0][0];
      expect(keyArg).toContain('{+8613800138000}');
    });
  });

  describe('releasePhoneLock', () => {
    it('should delete the send lock key', async () => {
      await service.releasePhoneLock('+8613800138000');
      expect(mockRedis.del).toHaveBeenCalledWith('sms:{+8613800138000}:send');
    });
  });

  describe('checkIpRateLimit', () => {
    it('should return true when under limit', async () => {
      mockRedis.incr.mockResolvedValue(1);
      const result = await service.checkIpRateLimit('192.168.1.1', 'sms:send', 3600, 20);
      expect(result).toBe(true);
      expect(mockRedis.expire).toHaveBeenCalledWith(
        'ratelimit:ip:sms:send:192.168.1.1', 3600,
      );
    });

    it('should return false when over limit', async () => {
      mockRedis.incr.mockResolvedValue(21);
      const result = await service.checkIpRateLimit('192.168.1.1', 'sms:send', 3600, 20);
      expect(result).toBe(false);
    });

    it('should skip IP check for whitelisted IPs', async () => {
      const result = await service.checkIpRateLimit('127.0.0.1', 'sms:send', 3600, 20);
      expect(result).toBe(true);
      expect(mockRedis.incr).not.toHaveBeenCalled();
    });
  });

  describe('getClientIp', () => {
    it('should extract from x-forwarded-for', () => {
      const ip = service.getClientIp({
        headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
        ip: '10.0.0.1',
      } as any);
      expect(ip).toBe('1.2.3.4');
    });

    it('should fallback to x-real-ip', () => {
      const ip = service.getClientIp({
        headers: { 'x-real-ip': '5.6.7.8' },
        ip: '10.0.0.1',
      } as any);
      expect(ip).toBe('5.6.7.8');
    });

    it('should fallback to req.ip', () => {
      const ip = service.getClientIp({
        headers: {},
        ip: '10.0.0.1',
      } as any);
      expect(ip).toBe('10.0.0.1');
    });
  });
});
