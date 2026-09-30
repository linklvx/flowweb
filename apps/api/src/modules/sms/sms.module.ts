import { Module } from '@nestjs/common';
import { SmsService } from './sms.service';
import { REDIS_CLIENT, createManagedRedis } from '../../common/redis/managed-redis';

@Module({
  providers: [
    SmsService,
    { provide: REDIS_CLIENT, useFactory: () => createManagedRedis() },   // 批3-2 B6 受管工厂
  ],
  exports: [SmsService],
})
export class SmsModule {}
