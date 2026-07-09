import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

import type { Prisma } from '@prisma/client';

export interface AuditLogParams {
  operatorId: string;
  operatorName: string;
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
    await this.prisma.auditLog.create({
      data: {
        operatorId: params.operatorId,
        operatorName: params.operatorName,
        targetType: params.targetType as any,
        targetId: params.targetId,
        action: params.action,
        beforeValue: params.beforeValue ?? undefined,
        afterValue: params.afterValue ?? undefined,
        remark: params.remark ?? null,
      },
    });
  }
}
