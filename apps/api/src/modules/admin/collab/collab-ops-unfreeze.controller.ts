// apps/api/src/modules/admin/collab/collab-ops-unfreeze.controller.ts
// C2-3（plan Task C2-3——生产就绪收尾批·replay-canary）：OpsGate 解冻 ack HTTP 端点
// （C2-1/C2-2 评审移交——unfreezeOpsGateCompact service 方法的人工通道接线）。
//   POST /api/admin/collab/ops-gate/unfreeze  body { projectId, remark? }
// 鉴权=admin 域惯例（intent force-void 同族）：全局 AuthGuard（session）+AdminGuard（/api/admin/*
// path 门——ADMIN 角色），零本文件守卫装饰；AuditLog 由 unfreezeOpsGateCompact 同事务落痕
// （ack 凭证与状态翻转原子——service 面，本层只透传 operator）。projectId=''（全局哨兵行）用
// body 承载：path param 空段不可表达；人工 break-glass freeze 的 ack 出口同源，审计旁路禁。
// 幂等=service 面（已 OPEN 0 行零审计行）；version 恒十进制字符串（BigInt JSON 契约）。
// census ⑰：admin 域=api 进程装配（app.module AdminModule），worker 闭包零新增边；
// collab-ops-gate.service 本就在 worker 闭包内（CollabCanaryVerifyWorker freeze 面）——纯函数复用无 DI。
import { Body, Controller, HttpCode, Inject, Post, UsePipes, ValidationPipe, Req, HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import { unfreezeOpsGateCompact } from '../../collab/collab-ops-gate.service';
import { UnfreezeOpsGateDto } from './dto/unfreeze-ops-gate.dto';

@Controller('api/admin/collab/ops-gate')
export class CollabOpsUnfreezeController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 解冻 ack（runbook §14 处置序第四步）：FROZEN→OPEN+AuditLog 同事务；已 OPEN→幂等 no-op。
   *  HttpCode(200)=幂等 ack 语义（非资源创建——重复调用同响应零副作用）。 */
  @Post('unfreeze')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async unfreeze(@Body() dto: UnfreezeOpsGateDto, @Req() req: Request): Promise<{ unfrozen: boolean; version: string | null }> {
    const user = (req as { user?: { id?: string; name?: string | null } }).user;
    const operatorId = user?.id ?? 'admin';
    const operatorName = user?.name ?? 'admin';
    try {
      const r = await this.prisma.$transaction((tx) => unfreezeOpsGateCompact(tx, {
        projectId: dto.projectId, operatorId, operatorName, remark: dto.remark,
      }));
      return { unfrozen: r.unfrozen, version: r.version == null ? null : r.version.toString() };
    } catch (e) {
      throw new HttpException({ code: 'UNFREEZE_FAILED', message: (e as Error).message }, 500);
    }
  }
}
