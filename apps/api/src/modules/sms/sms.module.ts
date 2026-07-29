import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { SmsService } from './sms.service';

@Module({
  providers: [
    SmsService,
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => new Redis(process.env.REDIS_URL || 'redis://localhost:6379/0'),
    },
  ],
  exports: [SmsService],
})
export class SmsModule {}
