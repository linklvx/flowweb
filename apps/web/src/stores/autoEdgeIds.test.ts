import { describe, it, expect } from 'vitest';
import { autoEdgeId, autoOutEdgeId, isAutoEdgeId } from './autoEdgeIds';

describe('自动边确定性 id（身份只依赖 id，不依赖会丢失的 edge.data）', () => {
  it('autoEdgeId/autoOutEdgeId 派生', () => {
    expect(autoEdgeId('edit1', 'src1')).toBe('auto:edit1:src1');
    expect(autoOutEdgeId('edit1', 'prod1')).toBe('auto-out:edit1:prod1');
  });
  it('isAutoEdgeId 双前缀识别', () => {
    expect(isAutoEdgeId('auto:edit1:src1')).toBe(true);
    expect(isAutoEdgeId('auto-out:edit1:prod1')).toBe(true);
    expect(isAutoEdgeId('edge_123')).toBe(false);
  });
});
