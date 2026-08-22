import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { STORYBOARD_STITCH_QUEUE } from './storyboard.constants';

@Processor(STORYBOARD_STITCH_QUEUE)
export class StitchConsumer extends WorkerHost {
  async process(job: Job<any>) {
    // Task 19 完整实现（sharp 合成 + MinIO 上传 + Media 写入 + Socket 推送）
    return { fileId: null };
  }
}
