import { beforeEach, describe, expect, it } from 'vitest';
import {
  SNAPSHOT_VERSION,
  snapshotKey,
  loadSnapshot,
  isEmptySnapshot,
} from '../canvasSnapshot';

const PID = 'p1';

function seedRaw(payload: unknown) {
  localStorage.setItem(snapshotKey(PID), JSON.stringify(payload));
}

function validPayload() {
  return {
    version: 2,
    nodes: {
      n1: { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} },
    },
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('canvasSnapshot 常量与 key', () => {
  it('SNAPSHOT_VERSION 为 2，key 为 flowweb_canvas_v2_${pid}', () => {
    expect(SNAPSHOT_VERSION).toBe(2);
    expect(snapshotKey(PID)).toBe('flowweb_canvas_v2_p1');
  });
});

describe('loadSnapshot 校验矩阵', () => {
  it('合法 payload → 返回完整快照，key 保留', () => {
    seedRaw(validPayload());
    const snap = loadSnapshot(PID);
    expect(snap).not.toBeNull();
    expect(snap!.nodes.n1.type).toBe('imageGen');
    expect(snap!.edges).toHaveLength(1);
    expect(snap!.viewport.zoom).toBe(1);
    expect(localStorage.getItem(snapshotKey(PID))).not.toBeNull();
  });

  it('version 不符 → null 且清 key', () => {
    seedRaw({ ...validPayload(), version: 1 });
    expect(loadSnapshot(PID)).toBeNull();
    expect(localStorage.getItem(snapshotKey(PID))).toBeNull();
  });

  it('nodes 传数组而非 Record → null 且清 key', () => {
    seedRaw({ ...validPayload(), nodes: [] });
    expect(loadSnapshot(PID)).toBeNull();
    expect(localStorage.getItem(snapshotKey(PID))).toBeNull();
  });

  it('节点缺 position → null 且清 key', () => {
    const p = validPayload();
    delete (p.nodes.n1 as any).position;
    seedRaw(p);
    expect(loadSnapshot(PID)).toBeNull();
    expect(localStorage.getItem(snapshotKey(PID))).toBeNull();
  });

  it('edge 缺 target → null 且清 key', () => {
    seedRaw({ ...validPayload(), edges: [{ id: 'e1', source: 'n1' }] });
    expect(loadSnapshot(PID)).toBeNull();
    expect(localStorage.getItem(snapshotKey(PID))).toBeNull();
  });

  it('viewport 缺 zoom → null 且清 key', () => {
    seedRaw({ ...validPayload(), viewport: { x: 0, y: 0 } });
    expect(loadSnapshot(PID)).toBeNull();
    expect(localStorage.getItem(snapshotKey(PID))).toBeNull();
  });

  it('截断 JSON → null 且清 key', () => {
    localStorage.setItem(snapshotKey(PID), '{"nodes": {"n1": {"prom');
    expect(loadSnapshot(PID)).toBeNull();
    expect(localStorage.getItem(snapshotKey(PID))).toBeNull();
  });

  it('无 key → 返回 null 不抛', () => {
    expect(loadSnapshot(PID)).toBeNull();
  });
});

describe('isEmptySnapshot', () => {
  it('nodes 为空对象 → 合法快照且 isEmptySnapshot=true', () => {
    seedRaw({ ...validPayload(), nodes: {}, edges: [] });
    const snap = loadSnapshot(PID);
    expect(snap).not.toBeNull();
    expect(isEmptySnapshot(snap!)).toBe(true);
  });

  it('nodes 非空 → isEmptySnapshot=false', () => {
    seedRaw(validPayload());
    expect(isEmptySnapshot(loadSnapshot(PID)!)).toBe(false);
  });
});
