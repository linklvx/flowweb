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

  // Y0c T36（Z14③）：旧 getClientIp 三用例（「伪造 XFF 首元素被采信」/x-real-ip 回落/req.ip 回落）
  // 随手写解析整体删除——手写解析无条件采信 XFF 链首=伪造面（绕过 main.ts trust proxy 'loopback'
  // 防线）。反转为防垫片断言；trust proxy 语义链行为锚（右起首个非 loopback 三档）见
  // xff-trust-proxy.spec.ts（消费方与全局 ThrottlerModule 同吃 req.ip 单源）。
  describe('T36：getClientIp 已删除（req.ip 单源——手写 XFF 首元素采信面消灭）', () => {
    it('service 上无 getClientIp 方法（转发壳=垫片亦禁）', () => {
      expect((service as any).getClientIp, '实现前红：方法仍在').toBeUndefined();
    });
  });

  // 第七轮：变量名对齐既有文件——rate-limiter.service.spec.ts 的替身叫 mockRedis、实例叫 service
  // （裸写 redis/limiter 是 TS2304 编译红，错误信息与业务无关易误判环境问题）
  describe('checkUserRateLimit', () => {
    it('用户维度固定窗口：window 内超 max → false', async () => {
      mockRedis.incr = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(11);
      mockRedis.expire = vi.fn();
      expect(await service.checkUserRateLimit('u1', 'video-work:clone', 3600, 10)).toBe(true);
      expect(await service.checkUserRateLimit('u1', 'video-work:clone', 3600, 10)).toBe(false);
    });
    it('key 形如 ratelimit:user:{action}:{userId}', async () => {
      mockRedis.incr = vi.fn().mockResolvedValue(1); mockRedis.expire = vi.fn();
      await service.checkUserRateLimit('u1', 'act', 60, 5);
      expect(mockRedis.incr).toHaveBeenCalledWith('ratelimit:user:act:u1');
    });
    it('不走 IP_WHITELIST（用户维度与 IP 无关）', async () => {
      mockRedis.incr = vi.fn().mockResolvedValue(1); mockRedis.expire = vi.fn();
      expect(await service.checkUserRateLimit('u1', 'act', 60, 5)).toBe(true); // 本地 127.0.0.1 请求也照常计数
    });
  });

  // Y0c T34（Z79/RC3）：RATE_LIMIT_IP_WHITELIST 惰性化——模块级 const（import 期冻结，先于
  // dotenv→validateEnv 写回=Z79 违规面）改调用期读；T36 承接入 zod+删手写解析（本用例只钉时序形态）。
  describe('T34：IP 白名单惰性求值（import 后 env 改值即生效）', () => {
    it('stubEnv 扩白名单 ⇒ 新 IP 放行零计数（旧实现=import 期冻结 ⇒ 照常 incr ⇒ 红）', async () => {
      mockRedis.incr = vi.fn().mockResolvedValue(1); mockRedis.expire = vi.fn();
      vi.stubEnv('RATE_LIMIT_IP_WHITELIST', '127.0.0.1,::1,10.9.8.7');
      try {
        expect(await service.checkIpRateLimit('10.9.8.7', 'act', 60, 5)).toBe(true);
        expect(mockRedis.incr).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
