// packages/shared/src/canvas/resolvePrimaryMediaId.test.ts
// Y2 B2a（plan v6 裁决 5 改死五）：主媒体身份解析单源五形态——
//   ①只有作者键（data.mediaId 非空）→ 作者键；②只有产物（artifact.mediaId）→ 产物；
//   ③两者皆有 → 作者键胜；④两者皆无 → 空；⑤唯一类型分支=multiImageGen 无产物回落
//   images[mainImageIndex]?.id（图库直读非槽位裁决、入参吃 plain 数组、-1/越界天然回落空；
//   B4 后多图主图首次可当上游源=意图内裁定）。非 multiImage 不回落。
// 红态=模块不存在（编译级红）。
import { describe, it, expect } from 'vitest';
import { resolvePrimaryMediaId } from './resolvePrimaryMediaId';

const node = (type: string, data: Record<string, unknown>) => ({ type, data });

describe('Y2 B2a resolvePrimaryMediaId（五形态）', () => {
  it('① 只有作者键：data.mediaId 非空 → 作者键（产物缺席）', () => {
    expect(resolvePrimaryMediaId(node('imageGen', { mediaId: 'author-1' }), undefined)).toBe('author-1');
    expect(resolvePrimaryMediaId(node('imageGen', { mediaId: 'author-1' }), 'artifact-x')).toBe('author-1');   // ③ 作者键胜
  });

  it('② 只有产物：data.mediaId 缺席 → artifact.mediaId', () => {
    expect(resolvePrimaryMediaId(node('imageGen', {}), 'artifact-1')).toBe('artifact-1');
    expect(resolvePrimaryMediaId(node('imageGen', { mediaId: '' }), 'artifact-1')).toBe('artifact-1');   // 空串=缺席
  });

  it('④ 两者皆无 → 空（空串非 undefined——判据面统一 falsy-free）', () => {
    expect(resolvePrimaryMediaId(node('imageGen', {}), undefined)).toBe('');
    expect(resolvePrimaryMediaId(node('imageGen', { mediaId: null as never }), undefined)).toBe('');
  });

  it('⑤ multiImageGen 无产物：回落 images[mainImageIndex]?.id（图库直读——plain 数组入参；-1/越界天然回落空）；非 multiImage 不回落', () => {
    const images = [{ id: 'img-a' }, { id: 'img-b' }, { id: 'img-c' }];
    expect(resolvePrimaryMediaId(node('multiImageGen', { images, mainImageIndex: 1 }), undefined)).toBe('img-b');
    expect(resolvePrimaryMediaId(node('multiImageGen', { images, mainImageIndex: -1 }), undefined)).toBe('');   // -1 越界回落空
    expect(resolvePrimaryMediaId(node('multiImageGen', { images, mainImageIndex: 99 }), undefined)).toBe('');
    expect(resolvePrimaryMediaId(node('multiImageGen', { images: [], mainImageIndex: 0 }), undefined)).toBe('');
    // 图库直读非槽位：多图主图首次可当上游源（B4 意图内裁定）——有作者键仍胜
    expect(resolvePrimaryMediaId(node('multiImageGen', { images, mainImageIndex: 2, mediaId: 'author-m' }), 'art')).toBe('author-m');
    // 非 multiImage：images 在场不回落（唯一类型分支）
    expect(resolvePrimaryMediaId(node('imageGen', { images, mainImageIndex: 0 }), undefined)).toBe('');
  });
});
