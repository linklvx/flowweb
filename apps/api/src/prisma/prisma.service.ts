import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { writeGateActive, writeGateProxy } from '../modules/collab/project-lock';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    // C1-0（R15 写锁门禁）：测试态 Proxy 自包裹（guarded registry 初始为空=既有面零行为；
    // 生产态直通零开销）。custom return=构造器返回代理 ⇒ Nest/DI 全链以代理为实例——
    // $transaction 写路径与模型 delegate 写操作过门禁断言（机制与判据单源=project-lock.ts）。
    if (writeGateActive()) return writeGateProxy(this);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
