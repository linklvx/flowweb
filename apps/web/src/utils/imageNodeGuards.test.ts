// apps/web/src/utils/imageNodeGuards.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { isImageCompletedNode } from './imageNodeGuards';
import { useNodeStore } from '@/stores/nodeStore';

const imgNode = (data: any) => ({ id: 'n', type: 'imageGen', position: { x: 0, y: 0 }, data } as any);

describe('isImageCompletedNode（fileId||referenceImage 归一化，Bug D/E）', () => {
  it('生成图：done + fileId → true', () => {
    expect(isImageCompletedNode(imgNode({ status: 'done', fileId: 'f1' }))).toBe(true);
  });

  it('上传图：referenceImage（status=idle）→ true', () => {
    expect(isImageCompletedNode(imgNode({ status: 'idle', referenceImage: 'ref-1' }))).toBe(true);
  });

  it('fileId 空字符串 + referenceImage → true（|| 空串防御）', () => {
    expect(isImageCompletedNode(imgNode({ status: 'done', fileId: '', referenceImage: 'ref-1' }))).toBe(true);
  });

  it('无任何图片身份字段 → false', () => {
    expect(isImageCompletedNode(imgNode({ status: 'done' }))).toBe(false);
  });

  it('fileId 空字符串 → false', () => {
    expect(isImageCompletedNode(imgNode({ status: 'done', fileId: '' }))).toBe(false);
  });

  it('生成中（status=generating 无结果）→ false', () => {
    expect(isImageCompletedNode(imgNode({ status: 'generating' }))).toBe(false);
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

describe('isImageCompletedNode 批1-6 合并视图（exec 投影终态参与完成判定）', () => {
  beforeEach(() => {
    useNodeStore.setState({ execStatus: new Map(), execAligned: new Map() });
  });

  it('data.status=loading 无 fileId，但 exec 投影 done → true（合并视图语义）', () => {
    useNodeStore.setState({ execStatus: new Map([['n', { status: 'done', fileId: 'f-exec' }]]) });
    expect(isImageCompletedNode(imgNode({ status: 'loading' }))).toBe(true);
  });

  it('data.status=loading 无 fileId，对齐投影 done（intents 恢复）→ true', () => {
    useNodeStore.setState({ execAligned: new Map([['n', { status: 'done' }]]) });
    expect(isImageCompletedNode(imgNode({ status: 'loading' }))).toBe(true);
  });

  it('exec 投影 error/loading → 仍非完成', () => {
    useNodeStore.setState({ execStatus: new Map([['n', { status: 'error' }]]) });
    expect(isImageCompletedNode(imgNode({ status: 'loading' }))).toBe(false);
    useNodeStore.setState({ execStatus: new Map([['n', { status: 'loading' }]]) });
    expect(isImageCompletedNode(imgNode({ status: 'loading' }))).toBe(false);
  });
});
