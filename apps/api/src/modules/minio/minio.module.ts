import { Global, Module, OnModuleInit } from '@nestjs/common';
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
    await this.minioService.ensureBucket();
  }
}
