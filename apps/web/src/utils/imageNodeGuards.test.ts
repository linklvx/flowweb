// apps/web/src/utils/imageNodeGuards.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { isImageCompletedNode } from './imageNodeGuards';
import { useNodeStore } from '@/stores/nodeStore';

const imgNode = (data: any) => ({ id: 'n', type: 'imageGen', position: { x: 0, y: 0 }, data } as any);

describe('isImageCompletedNode（Y2 B3：resolvePrimaryMediaId 单源——fileId||referenceImage 退役）', () => {
  it('生成图：mediaId → true', () => {
    expect(isImageCompletedNode(imgNode({ mediaId: 'f1' }))).toBe(true);
  });

  it('Y2 B3（spec D8）：referenceImage 不再充当主槽兜底——纯参考图 → false', () => {
    expect(isImageCompletedNode(imgNode({ referenceImage: 'ref-1' }))).toBe(false);
  });

  it('mediaId 空字符串 + referenceImage → false（参考图非主槽）', () => {
    expect(isImageCompletedNode(imgNode({ mediaId: '', referenceImage: 'ref-1' }))).toBe(false);
  });

  it('无任何图片身份字段 → false', () => {
    expect(isImageCompletedNode(imgNode({}))).toBe(false);
  });

  it('mediaId 空字符串 → false', () => {
    expect(isImageCompletedNode(imgNode({ mediaId: '' }))).toBe(false);
  });

  it('Y2 B3：残留 fileId（禁键历史字节）不再判完成——解析主槽零命中', () => {
    expect(isImageCompletedNode(imgNode({ status: 'done', fileId: 'f-legacy' }))).toBe(false);
  });

  it('multiImageGen：images 有 success → true（回归）', () => {
    const node = { id: 'm', type: 'multiImageGen', position: { x: 0, y: 0 }, data: { images: [{ id: 'i1', status: 'success' }] } } as any;
    expect(isImageCompletedNode(node)).toBe(true);
  });

  it('multiImageGen：images 全失败 → false（回归）', () => {
    const node = { id: 'm', type: 'multiImageGen', position: { x: 0, y: 0 }, data: { images: [{ id: 'i1', status: 'error' }] } } as any;
    expect(isImageCompletedNode(node)).toBe(false);
  });
});

// Y1b T16（spec :55 Z18''「exec 降 cache——资金/执行/交付判定全读 PG」）重写块：
// 完成判定不再读 doc exec 投影——raw 写 exec（外部 Yjs update 直改 exec map 形态：
// nodeStore.execStatus 携 {status:'done'}）仅构成显示漂移，不影响交付判定。T15 起 deliverArtifact 同 withSession(write) 事务原子写
// data.fileId+exec done——exec done 可见则 fileId 必已可见，exec 子句历史使命（断连恢复直写
// 竞态窗）随直写收口消亡。旧断言（exec done 无 fileId ⇒ true）随本卡废止——红复现面。
describe('T16 exec 降 cache：篡改 exec 后交付判定不变（判定唯一权威=data.fileId〔PG 投影〕）', () => {
  beforeEach(() => {
    useNodeStore.setState({ execStatus: new Map() });
  });

  it('红复现：data.status=loading 无 fileId，exec 投影篡改 done ⇒ false（判定不被 cache 污染）', () => {
    useNodeStore.setState({ execStatus: new Map([['n', { status: 'done', fileId: 'f-exec' }]]) });
    expect(isImageCompletedNode(imgNode({ status: 'loading' }))).toBe(false);
  });

  it('exec 投影 error/loading → 非完成（维持）', () => {
    useNodeStore.setState({ execStatus: new Map([['n', { status: 'error' }]]) });
    expect(isImageCompletedNode(imgNode({ status: 'loading' }))).toBe(false);
    useNodeStore.setState({ execStatus: new Map([['n', { status: 'loading' }]]) });
    expect(isImageCompletedNode(imgNode({ status: 'loading' }))).toBe(false);
  });

  it('Y2 B3：mediaId 在（作者键所有权面）⇒ true——exec 漂移（error）不拖低正判', () => {
    useNodeStore.setState({ execStatus: new Map([['n', { status: 'error' }]]) });
    expect(isImageCompletedNode(imgNode({ status: 'loading', mediaId: 'f1' }))).toBe(true);
  });
});
