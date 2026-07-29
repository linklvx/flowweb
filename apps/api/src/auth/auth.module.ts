import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SmsModule } from '../modules/sms/sms.module';
import { RateLimiterService } from '../common/services/rate-limiter.service';

@Module({
  imports: [SmsModule],
  controllers: [AuthController],
  providers: [AuthService, RateLimiterService],
  exports: [AuthService],
})
export class AuthModule {}
