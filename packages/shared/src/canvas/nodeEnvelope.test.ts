import { describe, it, expect } from 'vitest';
import { NODE_ENVELOPE_KEYS, normalizeCanvasRecord } from './nodeEnvelope';

describe('NODE_ENVELOPE_KEYS', () => {
  it('恰 7 键', () => {
    expect(NODE_ENVELOPE_KEYS).toHaveLength(7);
    expect([...NODE_ENVELOPE_KEYS].sort()).toEqual(['data', 'height', 'id', 'parentId', 'position', 'type', 'width'].sort());
  });
});

describe('normalizeCanvasRecord（写侧真删键——Object.entries 型写入方依赖键存在性确定）', () => {
  it('null → 键消失（Object.keys 不含；JSON 往返同）', () => {
    const out = normalizeCanvasRecord({ id: 'n1', type: 'group', position: { x: 1, y: 2 }, data: {}, parentId: null, width: null, height: null } as any);
    expect(Object.keys(out).includes('parentId')).toBe(false);
    expect(Object.keys(out).includes('width')).toBe(false);
    expect(Object.keys(out).includes('height')).toBe(false);
    expect(JSON.parse(JSON.stringify(out)).parentId).toBeUndefined();
  });

  it('position: null（非 undefined）也兜底 {x:0,y:0}（?? 双吃 null）', () => {
    const out = normalizeCanvasRecord({ id: 'n1', type: 'textInput', position: null, data: {} } as any);
    expect(out.position).toEqual({ x: 0, y: 0 });
  });

  it('有值全保留；position undefined → {x:0,y:0}；data undefined → {}', () => {
    const out = normalizeCanvasRecord({ id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal' }, parentId: 'p', width: 320, height: 180 });
    expect(out.parentId).toBe('p');
    expect(out.width).toBe(320);
    const out2 = normalizeCanvasRecord({ id: 'n1', type: 'textInput', position: undefined, data: undefined } as any);
    expect(out2.position).toEqual({ x: 0, y: 0 });
    expect(out2.data).toEqual({});
  });

  it('不碰 data 内部（cells 的 null 是空宫格占位）', () => {
    const out = normalizeCanvasRecord({ id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { cells: ['c1', null] } });
    expect(out.data.cells).toEqual(['c1', null]);
  });
});
