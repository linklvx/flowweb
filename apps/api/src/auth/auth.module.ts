import { Module, OnApplicationShutdown } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { WechatController } from './wechat/wechat.controller';
import { WechatService } from './wechat/wechat.service';
import { SmsModule } from '../modules/sms/sms.module';
import { RateLimiterService } from '../common/services/rate-limiter.service';
import { REDIS_CLIENT, createManagedRedis } from '../common/redis/managed-redis';
import { authPrisma, authRedis } from './auth';

@Module({
  imports: [SmsModule],
  controllers: [AuthController, WechatController],
  providers: [
    AuthService,
    SessionService,   // 批3-3：session 直查/滑动续期唯一入口（AuthGuard/collab.gateway 共用——导出供 APP_GUARD 与跨模块注入）
    WechatService,
    RateLimiterService,
    {
      provide: REDIS_CLIENT,   // 批3-2 B6：受管工厂（onApplicationShutdown duck-typing disconnect）
      useFactory: () => createManagedRedis(),
    },
  ],
  exports: [AuthService, SessionService],
})
/** 批3-2 B6：auth.ts 顶层单例（betterAuth OTP Lua 用，DI 容器外）由 module 钩子收口——
 *  不关则 ioredis 保活 event loop，进程退不出 */
export class AuthModule implements OnApplicationShutdown {
  async onApplicationShutdown() {
    authRedis.disconnect();
    await authPrisma.$disconnect();   // Y0a-4/E46：$disconnect 为 async——显式 await（关停序确定）
  }
}
