// Y1b T4 红测组④ unit 层：probeState 路由纯函数（Media 业务逻辑——留本模块）。
// sniffMimeType/isAllowedUploadMime 已迁 T6④ 独立 sniff.spec.ts（file-type 单一 import 点）。
import { describe, it, expect } from 'vitest';
import { probeStateForMime } from './media-registration.service';

describe('Y1b T4：probeState 路由（纯函数）', () => {
  it('probeStateForMime：按 sniffed 路由——image/video→pending（probe 吃）；audio→skipped（无 natural 可算）', () => {
    expect(probeStateForMime('image/png')).toBe('pending');
    expect(probeStateForMime('video/mp4')).toBe('pending');
    expect(probeStateForMime('audio/x-m4a')).toBe('skipped');
  });
});
