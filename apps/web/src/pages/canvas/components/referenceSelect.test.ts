import { describe, it, expect } from 'vitest';
import { decideReferencePick } from './referenceSelect';

const target = (over: Partial<Parameters<typeof decideReferencePick>[1]> = {}) => ({
  id: 'n2', type: 'imageGen', data: { fileId: 'f1' }, ...over,
}) as Parameters<typeof decideReferencePick>[1];

describe('decideReferencePick', () => {
  it('合法图片节点 → add（fileId 主图）', () => {
    expect(decideReferencePick('n1', target(), [], 9)).toEqual({ kind: 'add', fileId: 'f1' });
  });

  it('fileId 缺失时回退 referenceImage（仅上传未生成的节点）', () => {
    expect(decideReferencePick('n1', target({ data: { referenceImage: 'r1' } }), [], 9))
      .toEqual({ kind: 'add', fileId: 'r1' });
  });

  it('两者皆无 / 发起节点自身 / 非图片类节点（videoGen/group/text）→ ignore', () => {
    expect(decideReferencePick('n1', target({ data: {} }), [], 9).kind).toBe('ignore');
    expect(decideReferencePick('n2', target(), [], 9).kind).toBe('ignore');
    expect(decideReferencePick('n1', target({ type: 'videoGen' }), [], 9).kind).toBe('ignore');
    expect(decideReferencePick('n1', target({ type: 'group' }), [], 9).kind).toBe('ignore');
    expect(decideReferencePick('n1', target({ type: undefined }), [], 9).kind).toBe('ignore');
  });

  it('fileId 已在参考图 → ignore（去重）', () => {
    expect(decideReferencePick('n1', target(), ['f1'], 9).kind).toBe('ignore');
  });

  it('满 maxCount → full（横幅提示路径）', () => {
    expect(decideReferencePick('n1', target({ data: { fileId: 'f9' } }), ['a', 'b'], 2))
      .toEqual({ kind: 'full', fileId: 'f9' });
  });
});
