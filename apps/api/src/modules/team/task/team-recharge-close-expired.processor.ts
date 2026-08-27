import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { TeamRechargeService } from '../team-recharge.service';

@Injectable()
@Processor('team-recharge-close-expired')
export class TeamCloseExpiredProcessor extends WorkerHost {
  constructor(private readonly teamRecharge: TeamRechargeService) {
    super();
  }

  async process(job: Job<{ orderNo: string }>): Promise<void> {
    await this.teamRecharge.closeExpired(job.data.orderNo);
  }
}
