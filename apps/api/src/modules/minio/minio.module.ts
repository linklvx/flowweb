import { Global, Module, OnModuleInit, Logger } from '@nestjs/common';
import { MinioService, MinioConfig } from './minio.service';
import { validateEnv } from '../../config/env';

@Global()
@Module({
  providers: [
    {
      provide: MinioService,
      useFactory: () => {
        const env = validateEnv();
        const config: MinioConfig = {
          endpoint: env.MINIO_ENDPOINT,
          accessKey: env.MINIO_ACCESS_KEY,
          secretKey: env.MINIO_SECRET_KEY,
          bucket: env.MINIO_BUCKET,
          useSsl: env.MINIO_USE_SSL,
        };
        return new MinioService(config);
      },
    },
  ],
  exports: [MinioService],
})
export class MinioModule implements OnModuleInit {
  constructor(private readonly minioService: MinioService) {}

  async onModuleInit() {
    // B′（第九轮）：MINIO_INIT=skip 显式跳过 ensureBucket——gate-collab 场景依赖裁剪
    //（该场景零 MinIO 产物消费；MinIO 容器分发 2025 全网下架——Hub repo 404/bitnami tags
    // 清零/quay 匿名不可拉/dl.min.io 410——CI 无法起 service，nightly 曾连红 4 晚）。
    // 语义红线：显式声明式裁剪≠容错垫片——不设该 env 时行为原样（真连失败即 throw，生产 fail-fast 不变）。
    if (process.env.MINIO_INIT === 'skip') {
      new Logger(MinioModule.name).warn('MINIO_INIT=skip：ensureBucket 已显式跳过（gate-collab 场景专用——生产禁设，本实例不保证对象存储可用）');
      return;
    }
    await this.minioService.ensureBucket();
  }
}
