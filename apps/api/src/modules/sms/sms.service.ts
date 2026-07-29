import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import Redis from 'ioredis';
import { LUA_WRITE_OTP, LUA_VERIFY_OTP } from '../../common/services/lua-scripts';
import { maskPhone } from '../../common/utils/mask-phone';
// 静态导入 — 模块顶层单例，避免每次 sendSms 动态 import
import { sms } from 'tencentcloud-sdk-nodejs-sms';

const SmsClient = sms.v20210111.Client;

const logger = new Logger('SmsService');

@Injectable()
export class SmsService implements OnModuleInit {
  private writeOtpSha: string | null = null;
  private verifyOtpSha: string | null = null;
  private smsClient: InstanceType<typeof SmsClient>;

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {
    this.smsClient = new SmsClient({
      credential: {
        secretId: process.env.TENCENT_SMS_SECRET_ID!,
        secretKey: process.env.TENCENT_SMS_SECRET_KEY!,
      },
      region: 'ap-guangzhou',
    });
  }

  /** 启动时预加载 Lua 脚本，缓存 SHA 摘要 */
  async onModuleInit() {
    try {
      this.writeOtpSha = await this.redis.script('LOAD', LUA_WRITE_OTP) as string;
      this.verifyOtpSha = await this.redis.script('LOAD', LUA_VERIFY_OTP) as string;
      logger.log('Lua scripts preloaded successfully');
    } catch (err) {
      logger.warn({ err }, 'Lua SCRIPT LOAD failed, will fallback to EVAL');
    }
  }

  /** 生成 6 位密码学安全随机验证码 */
  generateOtp(): string {
    return Array.from({ length: 6 }, () => randomInt(0, 10)).join('');
  }

  /** Lua 原子写入 OTP（优先 EVALSHA，NOSCRIPT 自动降级 EVAL） */
  async storeOtp(e164Phone: string, code: string): Promise<void> {
    const keys = [
      `sms:{${e164Phone}}:code`,
      `sms:{${e164Phone}}:errors`,
    ];
    await this.evalWithFallback(LUA_WRITE_OTP, this.writeOtpSha, keys, [code, '300']);
  }

  /** Lua 原子校验 OTP — 供 Better Auth verifyOTP 调用 */
  async verifyOtp(e164Phone: string, code: string): Promise<boolean> {
    const keys = [
      `sms:{${e164Phone}}:code`,
      `sms:{${e164Phone}}:errors`,
      `sms:{${e164Phone}}:last_error`,
    ];
    const result = await this.evalWithFallback(
      LUA_VERIFY_OTP, this.verifyOtpSha, keys, [code, '5'],
    );
    return result === 0;
  }

  /**
   * 优先 EVALSHA（减少网络传输），捕获 NOSCRIPT 自动回退 EVAL 并重载脚本。
   * 覆盖 Redis 重启/主从切换导致脚本丢失的场景。
   */
  private async evalWithFallback(
    script: string, sha: string | null, keys: string[], args: string[],
  ): Promise<number> {
    if (sha) {
      try {
        return await this.redis.evalsha(sha, keys.length, ...keys, ...args) as number;
      } catch (err: any) {
        if (!err?.message?.includes('NOSCRIPT')) throw err;
        logger.warn('EVALSHA NOSCRIPT, falling back to EVAL');
      }
    }
    // 降级 EVAL + 重载
    const result = await this.redis.eval(script, keys.length, ...keys, ...args) as number;
    try {
      const newSha = await this.redis.script('LOAD', script) as string;
      if (script === LUA_WRITE_OTP) this.writeOtpSha = newSha;
      else this.verifyOtpSha = newSha;
    } catch { /* 静默 — 下次继续 EVAL */ }
    return result;
  }

  /** 删除 OTP（SMS 发送失败回滚） */
  async deleteOtp(e164Phone: string): Promise<void> {
    await this.redis.del(
      `sms:{${e164Phone}}:code`,
      `sms:{${e164Phone}}:errors`,
    );
  }

  /** 腾讯云 SMS 发送（复用单例 smsClient） */
  async sendSms(phoneNumber: string, code: string): Promise<void> {
    const masked = maskPhone(phoneNumber);
    logger.log({ phone: masked }, 'Sending SMS OTP');

    try {
      await this.smsClient.SendSms({
        PhoneNumberSet: [phoneNumber],
        SmsSdkAppId: process.env.TENCENT_SMS_SDK_APP_ID!,
        TemplateId: process.env.TENCENT_SMS_TEMPLATE_ID!,
        TemplateParamSet: [code],
        SignName: process.env.TENCENT_SMS_SIGN_NAME,
      });
      logger.log({ phone: masked }, 'SMS sent successfully');
    } catch (err) {
      logger.error({ phone: masked, err }, 'SMS send failed');
      throw err;
    }
  }
}
