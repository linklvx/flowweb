import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

import type { Prisma } from '@prisma/client';

export interface AuditLogParams {
  operatorId: string;
  operatorName: string;
  teamId?: string | null;
  targetType: string;
  targetId: string;
  action: string;
  beforeValue?: Prisma.InputJsonValue | null;
  afterValue?: Prisma.InputJsonValue | null;
  remark?: string | null;
}

@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async log(params: AuditLogParams): Promise<void> {
    await this.prisma.auditLog.create({ data: this.buildData(params) });
  }

  /** 事务内审计：与 log 同字段映射，但写在传入 tx 上（随事务原子提交/回滚） */
  async logTx(tx: { auditLog: { create(args: any): Promise<unknown> } }, params: AuditLogParams): Promise<void> {
    await tx.auditLog.create({ data: this.buildData(params) });
  }

  private buildData(params: AuditLogParams) {
    return {
      operatorId: params.operatorId,
      operatorName: params.operatorName,
      teamId: params.teamId ?? null,
      targetType: params.targetType as any,
      targetId: params.targetId,
      action: params.action,
      beforeValue: params.beforeValue ?? undefined,
      afterValue: params.afterValue ?? undefined,
      remark: params.remark ?? null,
    };
  }
}
