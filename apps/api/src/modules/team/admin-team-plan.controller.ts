import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('api/admin/team-plans')
export class AdminTeamPlanController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.teamPlan.findMany({ orderBy: { sort: 'asc' } });
  }

  @Post()
  create(@Body() body: {
    name: string; monthlyCredits: number; storageLimitBytes: bigint | number;
    seatLimit: number; priceMonthly: number; sort?: number;
  }) {
    return this.prisma.teamPlan.create({
      data: { ...body, storageLimitBytes: BigInt(body.storageLimitBytes) },
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Partial<{
    name: string; monthlyCredits: number; storageLimitBytes: bigint | number;
    seatLimit: number; priceMonthly: number; sort: number; isActive: boolean;
  }>) {
    const { storageLimitBytes, ...rest } = body;
    return this.prisma.teamPlan.update({
      where: { id },
      data: { ...rest, ...(storageLimitBytes != null ? { storageLimitBytes: BigInt(storageLimitBytes) } : {}) },
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.teamPlan.delete({ where: { id } });
  }
}
