import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { ContentModule } from './modules/content/content.module';
import { ProjectModule } from './modules/project/project.module';
import { AdminModule } from './modules/admin/admin.module';
import { CreditModule } from './modules/credit/credit.module';
import { ExecutionModule } from './modules/execution/execution.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]), PrismaModule, HealthModule, ContentModule, ProjectModule, AdminModule, CreditModule, ExecutionModule, AuthModule],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
