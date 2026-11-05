// apps/api/src/modules/admin/collab/collab-ops-unfreeze.controller.ts
// C2-3（plan Task C2-3——生产就绪收尾批·replay-canary）：OpsGate 解冻 ack HTTP 端点
// （C2-1/C2-2 评审移交——unfreezeOpsGateCompact service 方法的人工通道接线）。
//   POST /api/admin/collab/ops-gate/unfreeze  body { projectId, remark? }
// 鉴权=admin 域惯例（intent force-void 同族）：全局 AuthGuard（session）+AdminGuard（/api/admin/*
// path 门——ADMIN 角色），零本文件守卫装饰；AuditLog 由 unfreezeOpsGateCompact 同事务落痕
// （ack 凭证与状态翻转原子——service 面，本层只透传 operator）。projectId=''（全局哨兵行）用
// body 承载：path param 空段不可表达；人工 break-glass freeze 的 ack 出口同源，审计旁路禁
// （'' 形态 remark 必填——DTO @ValidateIf 承载：break-glass 无凭证注记禁入）。
// 幂等=service 面（已 OPEN 0 行零审计行）；afterState=同事务回读行态（OPEN/FROZEN/MISSING——
// unfrozen:false 的两因分型：拼写错 projectId=MISSING vs 并发 re-freeze=FROZEN）；version 恒
// 十进制字符串（BigInt JSON 契约）。
// census ⑰：admin 域=api 进程装配（app.module AdminModule），worker 闭包零新增边；
// collab-ops-gate.service 本就在 worker 闭包内（CollabCanaryVerifyWorker freeze 面）——纯函数复用无 DI。
import { Body, Controller, HttpCode, Inject, Post, UnauthorizedException, UsePipes, ValidationPipe, Req, HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import { unfreezeOpsGateCompact } from '../../collab/collab-ops-gate.service';
import { OPS_GATE_COMPACT } from '../../collab/project-governance.service';
import { UnfreezeOpsGateDto } from './dto/unfreeze-ops-gate.dto';

@Controller('api/admin/collab/ops-gate')
export class CollabOpsUnfreezeController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 解冻 ack（runbook §14.1 处置序第四步）：FROZEN→OPEN+AuditLog 同事务；已 OPEN→幂等 no-op。 */
  @Post('unfreeze')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async unfreeze(
    @Body() dto: UnfreezeOpsGateDto,
    @Req() req: Request,
  ): Promise<{ unfrozen: boolean; version: string | null; afterState: 'OPEN' | 'FROZEN' | 'MISSING' }> {
    // 评审 Minor#2：req.user 缺失即显式拒（401）——守卫序漂移（AuthGuard 须先于 AdminGuard 挂载
    // req.user）时禁回落字面 'admin' 审计（破坏性操作的「审计即 ack」链不许静默断）。
    const user = (req as { user?: { id?: string; name?: string | null } }).user;
    if (user?.id == null) throw new UnauthorizedException('req.user 缺失——守卫序漂移（AuthGuard 须先于 AdminGuard 解析 req.user），拒回落默认 operator');
    const r = await this.prisma.$transaction(async (tx) => {
      const res = await unfreezeOpsGateCompact(tx, {
        projectId: dto.projectId, operatorId: user.id!, operatorName: user.name ?? user.id!, remark: dto.remark,
      });
      // afterState=同事务回读（unfrozen:false 分型：行缺=MISSING〔拼写错 projectId〕/仍 FROZEN
      // =FROZEN〔并发 re-freeze 竞态窗〕；unfrozen:true 恒 OPEN）
      const row = await tx.collabOpsGate.findUnique({
        where: { gate_projectId: { gate: OPS_GATE_COMPACT, projectId: dto.projectId } },
        select: { state: true },
      });
      const afterState: 'OPEN' | 'FROZEN' | 'MISSING' = row == null ? 'MISSING' : row.state === 'FROZEN' ? 'FROZEN' : 'OPEN';
      return { ...res, afterState };
    }).catch((e: unknown) => {
      throw new HttpException({ code: 'UNFREEZE_FAILED', message: (e as Error).message }, 500);
    });
    return { unfrozen: r.unfrozen, version: r.version == null ? null : r.version.toString(), afterState: r.afterState };
  }
}
