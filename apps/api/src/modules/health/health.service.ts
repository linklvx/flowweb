import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface HealthResult {
  status: 'ok' | 'degraded';
  db: boolean;
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async check(): Promise<HealthResult> {
    let db = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }

    return {
      status: db ? 'ok' : 'degraded',
      db,
      timestamp: new Date().toISOString(),
    };
  }
}
