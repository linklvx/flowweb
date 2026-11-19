import { describe, it, expect } from 'vitest';
import { decideReferencePick } from './referenceSelect';

// Y2 B3（spec D8）：主图判定=resolvePrimaryMediaId 单源——作者键 data.mediaId；
// data.fileId 禁键后不再当主图、referenceImage 不再兜底（「仅上传未生成的节点」形态随作者键换名）。
const target = (over: Partial<Parameters<typeof decideReferencePick>[1]> = {}) => ({
  id: 'n2', type: 'imageGen', data: { mediaId: 'f1' }, ...over,
}) as Parameters<typeof decideReferencePick>[1];

describe('decideReferencePick', () => {
  it('合法图片节点 → add（mediaId 主图）', () => {
    expect(decideReferencePick('n1', target(), [], 9)).toEqual({ kind: 'add', fileId: 'f1' });
  });

  it('残留 fileId 不再当主图 → ignore（禁键零回落）', () => {
    expect(decideReferencePick('n1', target({ data: { fileId: 'f1' } }), [], 9).kind).toBe('ignore');
  });

  it('两者皆无 / 发起节点自身 / 非图片类节点（videoGen/group/text）→ ignore', () => {
    expect(decideReferencePick('n1', target({ data: {} }), [], 9).kind).toBe('ignore');
    expect(decideReferencePick('n1', target({ data: { referenceImage: 'r1' } }), [], 9).kind).toBe('ignore');   // referenceImage 不再兜底
    expect(decideReferencePick('n2', target(), [], 9).kind).toBe('ignore');
    expect(decideReferencePick('n1', target({ type: 'videoGen' }), [], 9).kind).toBe('ignore');
    expect(decideReferencePick('n1', target({ type: 'group' }), [], 9).kind).toBe('ignore');
    expect(decideReferencePick('n1', target({ type: undefined }), [], 9).kind).toBe('ignore');
  });

  it('fileId 已在参考图 → ignore（去重）', () => {
    expect(decideReferencePick('n1', target(), ['f1'], 9).kind).toBe('ignore');
  });

  it('满 maxCount → full（横幅提示路径）', () => {
    expect(decideReferencePick('n1', target({ data: { mediaId: 'f9' } }), ['a', 'b'], 2))
      .toEqual({ kind: 'full', fileId: 'f9' });
  });
});
