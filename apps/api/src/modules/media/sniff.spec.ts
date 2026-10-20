// apps/api/src/modules/media/sniff.spec.ts —— Y1a+Y1b T6④（v11.1⑦）：file-type 独立 sniff 模块
// 单一 import 点（全仓 file-type 面唯此文件）；用例自 media-registration.service.spec T4 红测组④迁入。
// MinIO 真字节流/presign 403 语义归 T5 真 S3 CI job。
import { describe, it, expect } from 'vitest';
import { sniffMimeType, isAllowedUploadMime } from './sniff';

const PNG_HEAD = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452', 'hex'),
  Buffer.alloc(13, 1),
]);
const M4A_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(24, 0)]);
const MP4_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(24, 0)]);
const JPG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);

describe('T6④ sniff 模块：MIME 嗅探/上传白名单（file-type 单一 import 点）', () => {
  it('sniffMimeType：魔数判型（png/jpeg/m4a/mp4）；garbage→null；过短缓冲 EndOfStream 不炸→null', async () => {
    await expect(sniffMimeType(PNG_HEAD)).resolves.toBe('image/png');
    await expect(sniffMimeType(JPG_HEAD)).resolves.toBe('image/jpeg');
    await expect(sniffMimeType(M4A_HEAD)).resolves.toBe('audio/x-m4a');
    await expect(sniffMimeType(MP4_HEAD)).resolves.toBe('video/mp4');
    await expect(sniffMimeType(Buffer.from('hello world this is not media at all'))).resolves.toBeNull();
    // file-type 16.x 对可读 chunk 不完整的缓冲抛 EndOfStreamError——必须吞掉归 null（=拒）
    await expect(sniffMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).resolves.toBeNull();
  });

  it('isAllowedUploadMime：image/|video/|audio/ 家族放行；null/svg/xml/pdf 拒', () => {
    expect(isAllowedUploadMime('image/png')).toBe(true);
    expect(isAllowedUploadMime('image/webp')).toBe(true);
    expect(isAllowedUploadMime('video/mp4')).toBe(true);
    expect(isAllowedUploadMime('video/quicktime')).toBe(true);
    expect(isAllowedUploadMime('audio/x-m4a')).toBe(true);
    expect(isAllowedUploadMime('audio/mpeg')).toBe(true);
    expect(isAllowedUploadMime(null)).toBe(false); // 不可判型=拒
    expect(isAllowedUploadMime('image/svg+xml')).toBe(false); // SVG 一律拒
    expect(isAllowedUploadMime('image/svg')).toBe(false);
    expect(isAllowedUploadMime('application/xml')).toBe(false); // svg 文本报 xml——家族外
    expect(isAllowedUploadMime('application/pdf')).toBe(false);
    expect(isAllowedUploadMime('text/plain')).toBe(false);
  });
});
