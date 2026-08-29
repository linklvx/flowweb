import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('api/admin/team-plans')
export class AdminTeamPlanController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // storageLimitBytes 列为 BigInt，无法经 JSON.stringify 序列化（Express 抛错致 500），响应统一转 Number
  @Get()
  async list() {
    const plans = await this.prisma.teamPlan.findMany({ orderBy: { sort: 'asc' } });
    return plans.map((p) => ({ ...p, storageLimitBytes: Number(p.storageLimitBytes) }));
  }

  @Post()
  async create(@Body() body: {
    name: string; monthlyCredits: number; storageLimitBytes: bigint | number;
    seatLimit: number; priceMonthly: number; sort?: number;
  }) {
    const plan = await this.prisma.teamPlan.create({
      data: { ...body, storageLimitBytes: BigInt(body.storageLimitBytes) },
    });
    return { ...plan, storageLimitBytes: Number(plan.storageLimitBytes) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Partial<{
    name: string; monthlyCredits: number; storageLimitBytes: bigint | number;
    seatLimit: number; priceMonthly: number; sort: number; isActive: boolean;
  }>) {
    const { storageLimitBytes, ...rest } = body;
    const plan = await this.prisma.teamPlan.update({
      where: { id },
      data: { ...rest, ...(storageLimitBytes != null ? { storageLimitBytes: BigInt(storageLimitBytes) } : {}) },
    });
    return { ...plan, storageLimitBytes: Number(plan.storageLimitBytes) };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.teamPlan.delete({ where: { id } });
  }
}
