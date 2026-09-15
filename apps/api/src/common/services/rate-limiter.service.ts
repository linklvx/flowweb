import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import type { Request } from 'express';

const IP_WHITELIST = (process.env.RATE_LIMIT_IP_WHITELIST || '127.0.0.1,::1')
  .split(',').map(s => s.trim());

@Injectable()
export class RateLimiterService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  /** 手机号维度原子锁: SET NX + EX 60 */
  async checkPhoneRateLimit(e164Phone: string): Promise<boolean> {
    const key = `sms:{${e164Phone}}:send`;
    const result = await this.redis.set(key, '1', 'EX', 60, 'NX');
    return result === 'OK';
  }

  /** 释放手机号锁（SMS 发送失败时调用） */
  async releasePhoneLock(e164Phone: string): Promise<void> {
    await this.redis.del(`sms:{${e164Phone}}:send`);
  }

  /** IP 维度固定窗口限流 */
  async checkIpRateLimit(
    ip: string, action: string, windowSec: number, max: number,
  ): Promise<boolean> {
    if (IP_WHITELIST.some(w => this.ipMatches(ip, w))) return true;
    const key = `ratelimit:ip:${action}:${ip}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, windowSec);
    return count <= max;
  }

  /** 用户维度固定窗口限流（不走 IP 白名单——与来源 IP 无关，spec §4.5） */
  async checkUserRateLimit(userId: string, action: string, windowSec: number, max: number): Promise<boolean> {
    const key = `ratelimit:user:${action}:${userId}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, windowSec);
    return count <= max;
  }

  /** 提取真实客户端 IP（兼容 APISIX 网关） */
  getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'] as string | undefined;
    return forwarded?.split(',')[0]?.trim()
      || (req.headers['x-real-ip'] as string)
      || req.ip
      || '127.0.0.1';
  }

  /** 仅支持 /8、/16、/24 三类 IPv4 网段与精确 IP 匹配 */
  private ipMatches(ip: string, whitelist: string): boolean {
    if (!whitelist.includes('/')) return ip === whitelist;
    const [range, bits] = whitelist.split('/');
    const mask = parseInt(bits, 10);
    if (mask === 8) return ip.split('.')[0] === range.split('.')[0];
    if (mask === 16) return ip.split('.').slice(0, 2).join('.') === range.split('.').slice(0, 2).join('.');
    if (mask === 24) return ip.split('.').slice(0, 3).join('.') === range.split('.').slice(0, 3).join('.');
    return ip === range;
  }
}
