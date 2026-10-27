// packages/shared/src/canvas/frame-deny.spec.ts
// Y1c T24：DENY 矩阵/L2 纯函数单元（新模块——红相=模块不存在〔编译级，T23 先例〕；本文件为绿态锁定）。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { validateFrameDeny, validateAppliedL2, countDsRanges, FRAME_DENY_ROOTS, FRAME_MAX_DS_RANGES, FRAME_MAX_STRUCTS } from './frame-deny';
import { DOC_SCHEMA_V4 } from './doc-schema-v4';

function frameOf(mutate: (d: Y.Doc) => void): Uint8Array {
  const d = new Y.Doc();
  d.transact(() => mutate(d));
  return Y.encodeStateAsUpdate(d);
}

/** 全类型合法载荷（8 类型各一节点——键集自 DOC_SCHEMA_V4 单源遍历）。 */
function legalNode(type: string): Y.Map<unknown> {
  const node = new Y.Map();
  const data = new Y.Map();
  for (const [k, spec] of Object.entries(DOC_SCHEMA_V4[type]!.data)) {
    switch (spec.yType) {
      case 'xml': {
        const frag = new Y.XmlFragment();
        const p = new Y.XmlElement('paragraph');
        p.insert(0, [new Y.XmlText()]);
        frag.insert(0, [p]);
        data.set(k, frag);
        break;
      }
      case 'text': data.set(k, new Y.Text()); break;
      case 'map': {
        const m = new Y.Map();
        for (const ck of Object.keys(spec.children ?? {})) m.set(ck, ck === 'text' ? new Y.Text() : 'v');
        data.set(k, m);
        break;
      }
      case 'array': {
        const a = new Y.Array();
        a.push([{ id: 'm1' }]);
        data.set(k, a);
        break;
      }
      case 'lww': data.set(k, 'x'); break;
      case 'lww-array': data.set(k, ['x']); break;
      case 'server-forbidden': break;   // D9：登记≠执法（T32 翻禁）——不写不测执法
    }
  }
  node.set('type', type);
  node.set('data', data);
  node.set('position', new Y.Map());
  return node;
}

describe('Y1c T24 validateFrameDeny（DENY 矩阵 frame-local 纯函数）', () => {
  it('8 类型合法载荷全放行（DOC_SCHEMA_V4 键集单源遍历——矩阵与真容器形状一致）', () => {
    const f = frameOf((d) => {
      for (const type of Object.keys(DOC_SCHEMA_V4)) d.getMap('nodes').set(`n-${type}`, legalNode(type));
    });
    expect(validateFrameDeny(f)).toEqual({ ok: true });
  });

  it('roots：exec 拒/未知根拒/三根放行（FRAME_DENY_ROOTS）', () => {
    expect(validateFrameDeny(frameOf((d) => { d.getMap('exec').set('x', new Y.Map()); })).ok).toBe(false);
    expect(validateFrameDeny(frameOf((d) => { d.getMap('bogus').set('x', 1); })).ok).toBe(false);
    expect(FRAME_DENY_ROOTS.has('meta')).toBe(true);
    const f = frameOf((d) => { d.getMap('meta').set('schemaVersion', 3); });
    expect(validateFrameDeny(f)).toMatchObject({ ok: false, reason: 'meta-key:schemaVersion' });   // META_WHITELIST 空=全拒
  });

  it('预算：DS 区间计数=Σ per-client range 数（非 client 数——登记项「ds 预算」根修锚）', () => {
    const d = new Y.Doc();
    d.getMap('nodes').set('a', legalNode('textInput'));
    d.getMap('nodes').set('b', legalNode('imageGen'));
    d.getMap('nodes').delete('a');
    const upd = Y.encodeStateAsUpdate(d);
    const decoded = Y.decodeUpdate(upd);
    expect(decoded.ds.clients.size).toBeLessThanOrEqual(2);
    expect(countDsRanges(decoded.ds as unknown as { clients: Map<number, unknown[]> })).toBeGreaterThanOrEqual(1);
    expect(FRAME_MAX_DS_RANGES).toBe(16_000);   // 收口 I-6：cap=FRAME_MAX_STRUCTS 同值单源（4096→16,000）
  });
});

describe('Y1c T24 validateAppliedL2（apply 后事件级后验）', () => {
  it('合法种子零事件误报（L2 通过——textInput content xml+prompt map）', () => {
    const doc = new Y.Doc();
    const events: Array<Y.YEvent<never>> = [];
    doc.getMap('nodes').observeDeep((evs) => {
      for (const e of evs) void e.changes.keys;   // handler 内物化（yjs after-handler 访问限制——生产 collector 同款）
      (events as unknown[]).push(...evs);
    });
    doc.transact(() => { doc.getMap('nodes').set('n1', legalNode('textInput')); });
    expect(validateAppliedL2(doc, events)).toEqual({ ok: true });
  });

  it('type 不可变（信封 type update=违规——节点改型）', () => {
    const doc = new Y.Doc();
    doc.getMap('nodes').set('n1', legalNode('textInput'));
    const events: Array<Y.YEvent<never>> = [];
    doc.getMap('nodes').observeDeep((evs) => {
      for (const e of evs) void e.changes.keys;   // handler 内物化（yjs after-handler 访问限制——生产 collector 同款）
      (events as unknown[]).push(...evs);
    });
    doc.transact(() => { (doc.getMap('nodes').get('n1') as Y.Map<unknown>).set('type', 'imageGen'); });
    expect(validateAppliedL2(doc, events)).toMatchObject({ ok: false, reason: 'type-immutable' });
  });

  it('unknown data key/容器替换/值类型（既有节点 raw update 面三拒）', () => {
    for (const [mutate, reason] of [
      [(d: Y.Doc) => { ((d.getMap('nodes').get('n1') as Y.Map<unknown>).get('data') as Y.Map<unknown>).set('hax', 1); }, 'unknown-data-key'],
      [(d: Y.Doc) => { ((d.getMap('nodes').get('n1') as Y.Map<unknown>).get('data') as Y.Map<unknown>).set('content', 'plain'); }, 'container-replacement'],
      [(d: Y.Doc) => { ((d.getMap('nodes').get('n1') as Y.Map<unknown>).get('data') as Y.Map<unknown>).set('model', new Y.Map()); }, 'value-type'],
    ] as const) {
      const doc = new Y.Doc();
      doc.getMap('nodes').set('n1', legalNode('textInput'));
      const events: Array<Y.YEvent<never>> = [];
      doc.getMap('nodes').observeDeep((evs) => {
        for (const e of evs) void e.changes.keys;   // handler 内物化（yjs after-handler 访问限制）
        (events as unknown[]).push(...evs);
      });
      doc.transact(() => mutate(doc));
      expect(validateAppliedL2(doc, events)).toMatchObject({ ok: false, reason: expect.stringContaining(reason) });
    }
  });
});

describe('Y1c T24 收口 I-3：信封键整删执法（type/id/data/position——canDelete 语义）', () => {
  const envelopeKeys = ['type', 'id', 'data', 'position'] as const;
  it.each(envelopeKeys)('删除 %s → L2 违规 envelope-key-deleted（修前全 {ok:true}）', (key) => {
    const doc = new Y.Doc();
    doc.getMap('nodes').set('n1', legalNode('textInput'));
    (doc.getMap('nodes').get('n1') as Y.Map<unknown>).set('id', 'n1');   // id 键补齐（legalNode 不带 id）
    const events: Array<Y.YEvent<never>> = [];
    doc.getMap('nodes').observeDeep((evs) => {
      for (const e of evs) void e.changes.keys;   // handler 内物化
      (events as unknown[]).push(...evs);
    });
    doc.transact(() => { (doc.getMap('nodes').get('n1') as Y.Map<unknown>).delete(key); });
    expect(validateAppliedL2(doc, events)).toMatchObject({ ok: false, reason: expect.stringContaining('envelope-key-deleted') });
  });
});

describe('Y1c T24 收口 I-6：DS 区间预算 cap 重估（SS2 全量载体——4096 误拒合法交错删史）', () => {
  /** 交错删史帧：seed doc 建 N 键→隔键删（每删一 range）→捕获增量删帧（0 structs+ds ranges=N/2）。 */
  function interleavedDeleteFrame(keys: number): Uint8Array {
    const base = new Y.Doc();
    const m = base.getMap('nodes') as Y.Map<unknown>;
    base.transact(() => { for (let i = 0; i < keys; i++) m.set(`k${i}`, new Y.Map([['type', 'textInput'], ['data', new Y.Map()]])); });
    const clone = new Y.Doc();
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(base));
    const captured: Uint8Array[] = [];
    clone.on('update', (u: Uint8Array) => { captured.push(u); });
    clone.transact(() => {
      const cm = clone.getMap('nodes') as Y.Map<unknown>;
      for (let i = 0; i < keys; i += 2) cm.delete(`k${i}`);   // 隔键删=每键独立 range（交错删线性扩张形态）
    });
    return captured.reduce((acc, u) => Y.mergeUpdates([acc, u]));
  }

  it('5000 区间（>4096 旧 cap、<新 cap）合法交错删史 → 放行（修前=frame-budget-exceeded 永久 4411）', () => {
    const f = interleavedDeleteFrame(10_000);
    const decoded = Y.decodeUpdate(f);
    expect(decoded.structs).toHaveLength(0);   // 纯 DS 帧（0 structs——ds cap 是唯一界）
    expect(countDsRanges(decoded.ds as unknown as { clients: Map<number, unknown[]> })).toBe(5_000);
    expect(validateFrameDeny(f)).toEqual({ ok: true });   // 红={ok:false, reason:'frame-budget-exceeded'}
  });

  it('超新 cap（>FRAME_MAX_STRUCTS 同值界）→ 真 deny（M-8 补：真拒断言非仅常量锚）', () => {
    const f = interleavedDeleteFrame(40_000);   // 20_000 区间 > 16_000 cap
    expect(validateFrameDeny(f)).toMatchObject({ ok: false, reason: 'frame-budget-exceeded' });
  });

  it('cap 单源=FRAME_MAX_STRUCTS 同值（16_000=8×maxNodesPerTx——SS2 全量载体结构性不先于 structs 触发）', () => {
    expect(FRAME_MAX_DS_RANGES).toBe(FRAME_MAX_STRUCTS);
    expect(FRAME_MAX_STRUCTS).toBe(8 * 2000);
  });
});
