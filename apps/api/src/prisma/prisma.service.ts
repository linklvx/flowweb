import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { writeGateActive, writeGateProxy } from '../modules/collab/project-lock';
import { fillWriteGateRegistry } from '../modules/collab/scope-column.registry';
import { applyReadPathFilter } from './read-path.filter';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    // C4-a（红⑦ 读路径过滤）：CanvasProject 读单点注入 lifecycleState='ACTIVE'（tombstone 行=
    // 用户态不存在）。恒激活（生产/测试同），read-path.filter 为**外层**——tx=读过滤(写门禁(rawTx))，
    // 测试态读径与生产同过滤（形态裁定见 read-path.filter.ts 头注）。
    // C1-0（R15 写锁门禁）：测试态 Proxy 自包裹（guarded registry 初始为空=既有面零行为；
    // 生产态直通零开销）。custom return=构造器返回代理 ⇒ Nest/DI 全链以代理为实例——
    // $transaction 写路径与模型 delegate 写操作过门禁断言（机制与判据单源=project-lock.ts）。
    // C4-b：registry 填充清单=scope-column.registry.ts GUARDED_WRITE_MODELS（A 档已接线闭包——
    // 登记=该模型写路径首句 lock+fence；幂等 Set.add，多实例构造零行为差）。
    fillWriteGateRegistry();
    const gated: this = writeGateActive() ? writeGateProxy(this) : this;
    return applyReadPathFilter(gated);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
