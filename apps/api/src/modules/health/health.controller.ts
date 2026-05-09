import { Controller, Get, Inject } from '@nestjs/common';
import { HealthService, HealthResult } from './health.service';

@Controller('api/health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get()
  check(): Promise<HealthResult> {
    return this.healthService.check();
  }
}
