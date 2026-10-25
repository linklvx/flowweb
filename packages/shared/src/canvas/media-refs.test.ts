// packages/shared/src/canvas/media-refs.test.ts —— Y1a+Y1b T16：mediaRefsOf 七键扫描单源纯测。
import { describe, it, expect } from 'vitest';
import { fillDoc, type DocLike } from './docShape';
import type { StoredNodeRecord } from './collab-doc-ops';
import { collectMediaRefs, collectMediaIds, MEDIA_REF_TARGET_FIELDS } from './media-refs';

/** 结构性最小 DocLike（fillDoc 需 createMap 工厂——FakeMap 同款）。 */
function makeDoc(): DocLike {
  const maps = new Map<string, any>();
  return {
    getMap: (name: string) => {
      if (!maps.has(name)) maps.set(name, new Map());
      return maps.get(name);
    },
    createMap: () => new Map() as never,
    createText: () => ({ length: 0, toString: () => '', insert: () => {}, delete: () => {} }),
  };
}

describe('T16 collectMediaRefs（七键扫描）', () => {
  it('全键形（string 槽+列表槽 item.id——targetItemId=item.id；referenceVideo/referenceAudio=config 域入口同落 data）', () => {
    const doc = makeDoc();
    fillDoc(doc, [{
      id: 'n1',
      type: 'imageGen',
      data: {
        fileId: 'm-file',
        referenceImage: 'm-ref',
        referenceVideo: 'm-refv',   // spec 评审 P1#1：AddNodeMenu.tsx:249 上传视频引用（updateConfig→data）
        referenceAudio: 'm-refa',   // AudioGenNode.tsx:105 上传音频引用（同路径）
        images: [{ id: 'm-i1' }, { id: 'm-i2' }],
        allImages: [{ id: 'm-i1' }],
        trimmedFileId: 'm-trim',
        videoFileId: 'm-vid',
        audioFileId: 'm-aud',
      },
    } as unknown as StoredNodeRecord], []);
    const refs = collectMediaRefs(doc).map((r) => [r.targetField, r.targetItemId, r.mediaId]).sort();
    expect(refs).toEqual([
      ['allImages', 'm-i1', 'm-i1'],
      ['audioFileId', '', 'm-aud'],
      ['fileId', '', 'm-file'],
      ['images', 'm-i1', 'm-i1'],
      ['images', 'm-i2', 'm-i2'],
      ['referenceAudio', '', 'm-refa'],
      ['referenceImage', '', 'm-ref'],
      ['referenceVideo', '', 'm-refv'],
      ['trimmedFileId', '', 'm-trim'],
      ['videoFileId', '', 'm-vid'],
    ].sort());
    expect([...collectMediaIds(doc)].sort()).toEqual(['m-aud', 'm-file', 'm-i1', 'm-i2', 'm-ref', 'm-refa', 'm-refv', 'm-trim', 'm-vid']);
  });

  it('非引用形态免疫：null（clearMedia 钉 null 写）/空串/非 string 标量槽、坏 item、无 data 节点、非 map 条目', () => {
    const doc = makeDoc();
    fillDoc(doc, [
      { id: 'n1', type: 'imageGen', data: { fileId: null, referenceImage: '', images: [{ noId: 1 }, 'junk', null], allImages: 'not-a-list' } } as unknown as StoredNodeRecord,
      { id: 'n2', type: 'textGen', data: {} } as unknown as StoredNodeRecord,
    ], []);
    doc.getMap('nodes').set('n3', 'plain string entry');   // 非 map 节点
    expect(collectMediaRefs(doc)).toEqual([]);
    expect(collectMediaIds(doc).size).toBe(0);
  });

  it('词表九键恰（MediaBinding.targetField 应用层单源——增删键本测即红；P1#1 补 referenceVideo/referenceAudio）', () => {
    expect([...MEDIA_REF_TARGET_FIELDS]).toEqual([
      'fileId', 'referenceImage', 'referenceVideo', 'referenceAudio', 'images', 'allImages',
      'trimmedFileId', 'videoFileId', 'audioFileId',
    ]);
  });

  it('跨节点同 media 多行（索引语义——GC 引用图按集消费）', () => {
    const doc = makeDoc();
    fillDoc(doc, [
      { id: 'n1', type: 'imageGen', data: { fileId: 'm-x' } } as unknown as StoredNodeRecord,
      { id: 'n2', type: 'videoGen', data: { videoFileId: 'm-x' } } as unknown as StoredNodeRecord,
    ], []);
    expect(collectMediaRefs(doc)).toHaveLength(2);
    expect(collectMediaIds(doc)).toEqual(new Set(['m-x']));
  });
});
