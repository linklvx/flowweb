import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { ContentModule } from './modules/content/content.module';
import { ProjectModule } from './modules/project/project.module';
import { AdminModule } from './modules/admin/admin.module';
import { CreditModule } from './modules/credit/credit.module';
import { ExecutionModule } from './modules/execution/execution.module';

@Module({
  imports: [PrismaModule, HealthModule, ContentModule, ProjectModule, AdminModule, CreditModule, ExecutionModule],
})
export class AppModule {}
