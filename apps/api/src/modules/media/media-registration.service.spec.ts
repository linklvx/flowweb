// Y1b T4 红测组④ unit 层：MIME 嗅探/白名单/probeState 路由纯函数（file-type 16.x 判型）。
// 新建单元的红=导出不存在（编译级）；MinIO 真字节流/presign 403 语义归 T5 真 S3 CI job。
import { describe, it, expect } from 'vitest';
import { sniffMimeType, isAllowedUploadMime, probeStateForMime } from './media-registration.service';

const PNG_HEAD = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452', 'hex'),
  Buffer.alloc(13, 1),
]);
const M4A_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(24, 0)]);
const MP4_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(24, 0)]);
const JPG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);

describe('Y1b T4：MIME 嗅探/白名单/probeState 路由（纯函数）', () => {
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

  it('probeStateForMime：按 sniffed 路由——image/video→pending（probe 吃）；audio→skipped（无 natural 可算）', () => {
    expect(probeStateForMime('image/png')).toBe('pending');
    expect(probeStateForMime('video/mp4')).toBe('pending');
    expect(probeStateForMime('audio/x-m4a')).toBe('skipped');
  });
});
