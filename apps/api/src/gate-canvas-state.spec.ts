// apps/api/src/gate-canvas-state.spec.ts
// O0c-3 gate-seed 验收断言（O0b-0 一次到位——本文件只验收形状）：直解 buildGateCanvasState 二进制，
// 断言 fixture 含 auto 组形状[零帧键]∧分镜组形状[分镜子无 position]∧gate-node-1/2 仍在
// （a0-0-env.spec:27-28 为 e2e 侧对偶锚）。构造单源=src/gate-canvas-state.ts（gate-seed 消费同函数）。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildGateCanvasState } from './gate-canvas-state';

describe('gate-seed fixture 形状验收（O0b-0 一次到位——O0c-3 验收断言）', () => {
  const decode = (): Y.Doc => {
    const d = new Y.Doc();
    Y.applyUpdate(d, buildGateCanvasState());
    return d;
  };
  const node = (d: Y.Doc, id: string) => d.getMap('nodes').get(id) as Y.Map<any>;

  it('gate-node-1/2 仍在（a0-0-env.spec:27-28 兼容——e2e 强判据的 fixture 侧对偶）+ meta 戳在', () => {
    const d = decode();
    expect(node(d, 'gate-node-1').get('type')).toBe('videoGen');
    expect(node(d, 'gate-node-2').get('type')).toBe('videoGen');
    expect(d.getMap('meta').get('schemaVersion')).toBe(2);   // WS loadDocument 版本门放行前提
  });

  it('auto 组形状：组零帧键（键集表"auto 组=0 帧键"）∧子带 abs position', () => {
    const d = decode();
    const g = node(d, 'gate-auto-group');
    expect(g.has('position')).toBe(false);
    expect(g.has('width')).toBe(false);
    expect(g.has('height')).toBe(false);
    expect(node(d, 'gate-auto-child-1').get('position')).toBeInstanceOf(Y.Map);   // 子带 abs position
    expect(node(d, 'gate-auto-child-1').get('parentId')).toBe('gate-auto-group');
  });

  it('分镜组形状：组带 position+完整 storyboard config+cells ∧分镜子无 position 带 width/height', () => {
    const d = decode();
    const g = node(d, 'gate-sb-group');
    expect(g.get('position')).toBeInstanceOf(Y.Map);          // 分镜组 position 保留（键集表）
    expect(g.has('width')).toBe(false);                       // 分镜组无 wh（帧=配置型公式）
    expect(g.has('height')).toBe(false);
    const data = g.get('data') as Y.Map<any>;
    expect(data.get('groupType')).toBe('storyboard');
    expect(data.get('cells')).toEqual(['gate-sb-cell-1', 'gate-sb-cell-2']);
    expect(data.get('storyboard')).toEqual({ aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: true, stitchResolution: '2K' });
    for (const id of ['gate-sb-cell-1', 'gate-sb-cell-2']) {
      const c = node(d, id);
      expect(c.has('position')).toBe(false);                  // 分镜子无 position（键集表）
      expect(c.get('width')).toBe(320);                       // 分镜子带 width/height
      expect(c.get('height')).toBe(180);
      expect(c.get('parentId')).toBe('gate-sb-group');
    }
  });
});
