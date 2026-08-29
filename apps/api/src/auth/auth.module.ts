import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { WechatController } from './wechat/wechat.controller';
import { WechatService } from './wechat/wechat.service';
import { SmsModule } from '../modules/sms/sms.module';
import { RateLimiterService } from '../common/services/rate-limiter.service';
import { TeamModule } from '../modules/team/team.module';

@Module({
  imports: [SmsModule, TeamModule],
  controllers: [AuthController, WechatController],
  providers: [
    AuthService,
    WechatService,
    RateLimiterService,
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => new Redis(process.env.REDIS_URL || 'redis://localhost:6379/0'),
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
