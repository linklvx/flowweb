// B′（第九轮用户裁决）：MINIO_INIT=skip 显式跳过 ensureBucket——gate-collab 场景依赖裁剪
// （该场景零 MinIO 产物消费；MinIO 容器分发 2025 全网下架，CI 无法起 service）。
// 语义红线：显式声明式裁剪≠容错垫片——不设该 env 时行为原样（真连失败即 throw，生产 fail-fast 不变）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MinioModule } from './minio.module';

function mkModule() {
  const ensureBucket = vi.fn().mockResolvedValue(undefined);
  return { mod: new MinioModule({ ensureBucket } as any), ensureBucket };
}

afterEach(() => { delete process.env.MINIO_INIT; });

describe('MinioModule onModuleInit（B′ MINIO_INIT=skip）', () => {
  it('默认（未设）：调用 ensureBucket——生产 fail-fast 语义原样（真连失败即 throw 透传）', async () => {
    delete process.env.MINIO_INIT;
    const { mod, ensureBucket } = mkModule();
    await mod.onModuleInit();
    expect(ensureBucket).toHaveBeenCalledTimes(1);
  });

  it('MINIO_INIT=skip：跳过 ensureBucket（gate-collab 场景裁剪——不发起任何连接）', async () => {
    process.env.MINIO_INIT = 'skip';
    const { mod, ensureBucket } = mkModule();
    await mod.onModuleInit();
    expect(ensureBucket).not.toHaveBeenCalled();
  });
});
