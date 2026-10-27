// packages/shared/src/canvas/graph-normalize.spec.ts
// Y1c T24：NORMALIZE 读侧确定性屏蔽（kind 词表+validateParentGraph 语义单源——禁第二份深度遍历）。
import { describe, it, expect } from 'vitest';
import { GRAPH_ANOMALY_KINDS, maskGraphAnomalies } from './graph-normalize';

describe('Y1c T24 maskGraphAnomalies（读侧确定性屏蔽）', () => {
  const nodes = [
    { id: 'a', type: 'group', parentId: null },
    { id: 'b', type: 'textInput', parentId: 'a' },
    { id: 'c', type: 'textInput', parentId: 'missing' },      // dangling-parent
    { id: 'd', type: 'textInput', parentId: 'b' },            // non-group parent → cross-group-parent
    { id: 'e', type: 'textInput', parentId: 'f' },
    { id: 'f', type: 'textInput', parentId: 'e' },            // parent-cycle（e↔f——两起点各报一次）
  ];
  const edges = [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'b', target: 'ghost' },               // dangling-edge（target 缺失）
    { id: 'e3', source: 'a', target: 'b' },                   // duplicate-edge（同 e1 对）
    { id: 'e4', source: 'b', target: 'c' },
  ];

  it('五 kind 全屏蔽+确定性（同输入恒同输出；healthy 部分零触碰）', () => {
    const r = maskGraphAnomalies({ nodes, edges });
    expect(r.masked).toEqual({ 'dangling-parent': 1, 'cross-group-parent': 3, 'parent-cycle': 1, 'duplicate-edge': 1, 'dangling-edge': 1 });   // cross-group=3（d 挂 textInput+e/f 互挂均 non-group）；cycle=1（三色 memo 每环一报——validateParentGraph 语义）
    expect(r.edges.map((e) => e.id)).toEqual(['e1', 'e4']);   // e2 悬挂/e3 重复剥除；e1/e4 保序
    const c = r.nodes.find((n) => n.id === 'c')!;
    expect(c.parentId).toBeUndefined();                        // 悬挂 parentId 剥除
    expect(r.nodes.find((n) => n.id === 'b')!.parentId).toBe('a');   // 健康链零触碰
    // 确定性：重跑同输入等值
    expect(maskGraphAnomalies({ nodes, edges })).toEqual(r);
  });

  it('空异常图=零屏蔽零键（healthy fixtures 形状不变——read-model census 兼容面）', () => {
    const r = maskGraphAnomalies({ nodes: [{ id: 'a', type: 'group' }], edges: [] });
    expect(r.masked).toEqual({});
    expect(r.nodes).toHaveLength(1);
    expect(r.edges).toHaveLength(0);
  });

  it('kind 词表 closed（media-ref-missing 登记——计算归 T26 PG join 接线）', () => {
    expect(GRAPH_ANOMALY_KINDS).toContain('media-ref-missing');
    expect(GRAPH_ANOMALY_KINDS).toHaveLength(6);
  });
});
