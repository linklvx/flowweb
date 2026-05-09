import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { ContentModule } from './modules/content/content.module';

@Module({
  imports: [PrismaModule, HealthModule, ContentModule],
})
export class AppModule {}
