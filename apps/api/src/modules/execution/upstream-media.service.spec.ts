import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UpstreamMediaService } from './upstream-media.service';

// Y1a T8：上游媒体解析服务单测（mock prisma/minio——真库形态归 upstream-media.int.spec.ts）。
// 三职责：readUpstreamMediaId（NodeArtifact 槽位读身份）/canonicalizeMediaRef（doc 手工 URL→身份）/
// resolveCallUrl（身份→外呼可达 URL——哈希稳定身份、外呼时解析 URL）。
describe('UpstreamMediaService', () => {
  let svc: UpstreamMediaService;
  let prisma: any;
  let minio: any;

  beforeEach(() => {
    prisma = {
      nodeArtifact: { findUnique: vi.fn().mockResolvedValue(null) },
      media: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    minio = { generatePresignedGetUrl: vi.fn().mockResolvedValue('https://minio.local:9000/flowai/k?sig=x') };
    svc = new UpstreamMediaService(prisma, minio);
  });

  describe('readUpstreamMediaId（NodeArtifact 槽位读身份）', () => {
    it('槽位行 state=stored 且 mediaId 非空 → 返回 mediaId', async () => {
      prisma.nodeArtifact.findUnique.mockResolvedValue({ mediaId: 'media-1', state: 'stored' });
      await expect(svc.readUpstreamMediaId('p1', 'n1')).resolves.toBe('media-1');
      expect(prisma.nodeArtifact.findUnique).toHaveBeenCalledWith({
        where: { projectId_nodeId_role_targetField_targetItemId: { projectId: 'p1', nodeId: 'n1', role: 'primary', targetField: 'result', targetItemId: '' } },
        select: { mediaId: true, state: true },
      });
    });

    it('槽位行非终态（materializing）→ null（finalize 未完成不注入）', async () => {
      prisma.nodeArtifact.findUnique.mockResolvedValue({ mediaId: 'media-1', state: 'materializing' });
      await expect(svc.readUpstreamMediaId('p1', 'n1')).resolves.toBeNull();
    });

    it('槽位行 mediaId 为 null（text 产物行）→ null', async () => {
      prisma.nodeArtifact.findUnique.mockResolvedValue({ mediaId: null, state: 'stored' });
      await expect(svc.readUpstreamMediaId('p1', 'n1')).resolves.toBeNull();
    });

    it('无槽位行 → null', async () => {
      prisma.nodeArtifact.findUnique.mockResolvedValue(null);
      await expect(svc.readUpstreamMediaId('p1', 'n1')).resolves.toBeNull();
    });
  });

  describe('canonicalizeMediaRef（doc 手工 URL → 身份形态）', () => {
    it('空值 → undefined（normalizeIntentParams 转 null 进哈希）', async () => {
      await expect(svc.canonicalizeMediaRef(undefined)).resolves.toBeUndefined();
      await expect(svc.canonicalizeMediaRef('')).resolves.toBeUndefined();
    });

    it('/flowai/ URL → key → Media (bucket,key) 反查 → mediaId（同对象不同 URL 同身份）', async () => {
      prisma.media.findUnique.mockResolvedValue({ id: 'media-flowai-1' });
      await expect(svc.canonicalizeMediaRef('/flowai/uploads/u1/a.png')).resolves.toBe('media-flowai-1');
      expect(prisma.media.findUnique).toHaveBeenCalledWith({
        where: { bucket_key: { bucket: 'flowai', key: 'uploads/u1/a.png' } },
        select: { id: true },
      });
    });

    it('完整 presigned URL（域名+/flowai+签名）→ 同一 key 反查 → 同 mediaId（presign 续签后同身份——红测 2 链）', async () => {
      prisma.media.findUnique.mockResolvedValue({ id: 'media-flowai-1' });
      const a = await svc.canonicalizeMediaRef('https://minio.local:9000/flowai/uploads/u1/a.png?X-Amz-Signature=AAA');
      const b = await svc.canonicalizeMediaRef('https://minio.local:9000/flowai/uploads/u1/a.png?X-Amz-Signature=BBB');
      expect(a).toBe('media-flowai-1');
      expect(b).toBe('media-flowai-1');
    });

    it('/flowai/ URL 但 Media 行不存在 → 原样 URL 进哈希（fail-open——悬空引用维持可辨别值）', async () => {
      prisma.media.findUnique.mockResolvedValue(null);
      await expect(svc.canonicalizeMediaRef('/flowai/ghost/key.png')).resolves.toBe('/flowai/ghost/key.png');
    });

    it('外网 URL → 原样（非本仓 Media 域——用户不变则身份不变）', async () => {
      await expect(svc.canonicalizeMediaRef('https://cdn.example.com/ref.png')).resolves.toBe('https://cdn.example.com/ref.png');
      expect(prisma.media.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('resolveCallUrl（身份 → 外呼可达 URL）', () => {
    it('空值 → undefined（外呼省略 imageUrl）', async () => {
      await expect(svc.resolveCallUrl(undefined)).resolves.toBeUndefined();
      await expect(svc.resolveCallUrl(null)).resolves.toBeUndefined();
    });

    it('URL 形态（外网/同源路径）→ 原样直传（手工配置非本仓 Media 域）', async () => {
      await expect(svc.resolveCallUrl('https://cdn.example.com/ref.png')).resolves.toBe('https://cdn.example.com/ref.png');
      await expect(svc.resolveCallUrl('/other/path.png')).resolves.toBe('/other/path.png');
      expect(prisma.media.findUnique).not.toHaveBeenCalled();
    });

    it('mediaId → Media 行 sourceUrl 未过期 → 直传 sourceUrl（provider 取自家 URL；presign 零调用）', async () => {
      prisma.media.findUnique.mockResolvedValue({
        sourceUrl: 'https://provider-oss.example.com/r1.png',
        sourceUrlExpiresAt: new Date('2030-01-01T00:00:00Z'),
        key: 'results/u1/x.png',
      });
      await expect(svc.resolveCallUrl('media-1')).resolves.toBe('https://provider-oss.example.com/r1.png');
      expect(minio.generatePresignedGetUrl).not.toHaveBeenCalled();
    });

    it('Y1a T8 红测 3（过期降级）：sourceUrlExpiresAt 已过 → presigned GET 降级（nginx /flowai 公网可达）', async () => {
      prisma.media.findUnique.mockResolvedValue({
        sourceUrl: 'https://provider-oss.example.com/expired.png',
        sourceUrlExpiresAt: new Date('2020-01-01T00:00:00Z'),
        key: 'results/u1/x.png',
      });
      await expect(svc.resolveCallUrl('media-1')).resolves.toBe('https://minio.local:9000/flowai/k?sig=x');
      expect(minio.generatePresignedGetUrl).toHaveBeenCalledWith('results/u1/x.png', 3600);
    });

    it('mediaId 无 Media 行 → fail-fast throw（哈希身份有效但行缺失=数据损坏，禁静默省略图外呼）', async () => {
      prisma.media.findUnique.mockResolvedValue(null);
      await expect(svc.resolveCallUrl('media-ghost')).rejects.toThrow(/media-ghost/);
    });
  });
});
