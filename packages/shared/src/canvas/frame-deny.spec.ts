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

describe('Y1c T24 终验 I-7：同型容器整键替换零执法（canDelete=false 容器「删了换新」等效绕过）', () => {
  /** 既有 textInput 节点（content=XmlFragment/prompt=Map{text}/model/order）。 */
  function seededDoc(): Y.Doc {
    const doc = new Y.Doc();
    doc.getMap('nodes').set('n1', legalNode('textInput'));
    return doc;
  }
  const capture = (doc: Y.Doc, mutate: (d: Y.Doc) => void): Array<Y.YEvent<never>> => {
    const events: Array<Y.YEvent<never>> = [];
    doc.getMap('nodes').observeDeep((evs) => {
      for (const e of evs) void e.changes.keys;
      (events as unknown[]).push(...evs);
    });
    doc.transact(() => mutate(doc));
    return events;
  };
  const dataOf = (d: Y.Doc): Y.Map<unknown> => (d.getMap('nodes').get('n1') as Y.Map<unknown>).get('data') as Y.Map<unknown>;

  it('既有节点 data.set("content", 全新 XmlFragment)——同型容器整键覆盖 → 违规 container-replacement（修前 {ok:true}）', () => {
    const doc = seededDoc();
    const events = capture(doc, (d) => {
      const frag = new Y.XmlFragment();
      const p = new Y.XmlElement('paragraph'); p.insert(0, [new Y.XmlText()]);
      frag.insert(0, [p]);
      dataOf(d).set('content', frag);
    });
    expect(validateAppliedL2(doc, events)).toMatchObject({ ok: false, reason: expect.stringContaining('container-replacement:textInput.content') });
  });

  it('既有节点 data.set("prompt", 全新 Y.Map)——同型容器整键覆盖 → 违规（修前 {ok:true}）', () => {
    const doc = seededDoc();
    const events = capture(doc, (d) => {
      const m = new Y.Map(); m.set('text', new Y.Text());
      dataOf(d).set('prompt', m);
    });
    expect(validateAppliedL2(doc, events)).toMatchObject({ ok: false, reason: expect.stringContaining('container-replacement:textInput.prompt') });
  });

  it('信封 node.set("data", 全新 Y.Map)——信封容器整键覆盖 → 违规（修前 {ok:true}）', () => {
    const doc = seededDoc();
    const events = capture(doc, (d) => {
      (d.getMap('nodes').get('n1') as Y.Map<unknown>).set('data', new Y.Map());
    });
    expect(validateAppliedL2(doc, events)).toMatchObject({ ok: false, reason: expect.stringContaining('container-replacement:n1.data') });
  });

  it('负控①：帧内新建节点容器初始化（add 形态）放行——creation 路径非 update', () => {
    const doc = new Y.Doc();
    const events: Array<Y.YEvent<never>> = [];
    doc.getMap('nodes').observeDeep((evs) => {
      for (const e of evs) void e.changes.keys;
      (events as unknown[]).push(...evs);
    });
    doc.transact(() => { doc.getMap('nodes').set('fresh', legalNode('textInput')); });
    expect(validateAppliedL2(doc, events)).toEqual({ ok: true });   // 新建节点全容器初始化=add 事件
  });

  it('负控②：既有容器内容写（XmlFragment insert 子元素/prompt.text splice——child 事件）放行', () => {
    const doc = seededDoc();
    const events = capture(doc, (d) => {
      (dataOf(d).get('content') as Y.XmlFragment).insert(0, [new Y.XmlElement('paragraph')]);
      ((dataOf(d).get('prompt') as Y.Map<unknown>).get('text') as Y.Text).insert(0, 'hello');
    });
    expect(validateAppliedL2(doc, events)).toEqual({ ok: true });   // 内容写=child/delta 事件（path≠键本身）
  });
});

// ══════════ Y2 B3：矩阵 mediaId 加键——放置写 data.mediaId 放行（今天 unknown-data-key 拒必红）══════════
describe('Y2 B3：作者键 mediaId 入矩阵（imageGen/imageExtGen/videoGen/audioGen 四类型）', () => {
  const MEDIA_TYPES = ['imageGen', 'imageExtGen', 'videoGen', 'audioGen'] as const;

  it('四类型 data.mediaId 条目在位（lww+mediaRef——NORMALIZE 引用存在性检查输入）', () => {
    for (const t of MEDIA_TYPES) {
      const spec = DOC_SCHEMA_V4[t]!.data.mediaId;
      expect(spec, `${t}.mediaId`).toBeDefined();
      expect(spec!.yType).toBe('lww');
      expect(spec!.mediaRef).toBe(true);
    }
  });

  it('放置帧写 data.mediaId 放行（frame-deny 键集执法——加键前 unknown-data-key 拒）', () => {
    for (const t of MEDIA_TYPES) {
      const f = frameOf((d) => {
        const node = new Y.Map();
        const data = new Y.Map();
        data.set('mediaId', 'm-author-1');
        node.set('type', t);
        node.set('data', data);
        node.set('position', new Y.Map());
        d.getMap('nodes').set(`n-${t}`, node);
      });
      expect(validateFrameDeny(f), `${t} mediaId 放置帧`).toEqual({ ok: true });
    }
  });

  it('fileId 维持 forbidden（矩阵条目不变——执法面翻禁=frame-deny 五处，本 spec 翻禁段承载）', () => {
    for (const t of MEDIA_TYPES) {
      expect(DOC_SCHEMA_V4[t]!.data.fileId!.yType).toBe('server-forbidden');
    }
  });
});

// ══════════ Y2 C1：五处翻禁执法——server-forbidden 键写入即拒（今天「登记≠执法」continue 放行必红）══════════
// spec §4 第③步（三件同批：翻禁+双常量 4+@default(4)）：L1 :222 帧内创建链+L2 :472 既有节点 data.set
// +:499 NODE_CREATED/根级 update 三处行为红测可达；:442/:513=map children 死分支（现行矩阵全
// server-forbidden 键均为顶层 data 键、无 map children 条目）——同批一致翻转+防漂移注记，无行为红测。
// 键族覆盖 fileId/status/trimTaskStatus/trimmedFileId/nodeStatus 全部五键（doc-schema-v4 forbidden
// 条目 11 个——防只翻两键的窄实现，spec Review Focus 7）。
describe('Y2 C1 翻禁：server-forbidden 键写入即拒（forbidden-data-key）', () => {
  /** 独立含禁键构造器（帧内创建链——type 在本帧可解析，走 :222 面）。 */
  function forbiddenFrame(type: string, key: string): Uint8Array {
    return frameOf((d) => {
      const node = new Y.Map();
      const data = new Y.Map();
      data.set(key, 'legacy-value');
      node.set('type', type);
      node.set('data', data);
      node.set('position', new Y.Map());
      d.getMap('nodes').set('n-forbid', node);
    });
  }

  it('L1 :222 帧内创建节点 data 带禁键 → !ok reason 含 forbidden-data-key（今天 continue 放行=先红）', () => {
    for (const [type, key] of [
      ['imageGen', 'fileId'], ['imageGen', 'status'],
      ['videoGen', 'fileId'], ['videoGen', 'status'],
      ['videoGen', 'trimTaskStatus'], ['videoGen', 'trimmedFileId'],
      ['multiImageGen', 'nodeStatus'],
    ] as const) {
      expect(validateFrameDeny(forbiddenFrame(type, key)), `${type}.${key}`)
        .toMatchObject({ ok: false, reason: expect.stringContaining('forbidden-data-key') });
    }
  });

  it('L1 :222 reason 形态=forbidden-data-key:<type>.<key>（verdict code=FRAME_MALFORMED）', () => {
    expect(validateFrameDeny(forbiddenFrame('imageGen', 'fileId')))
      .toMatchObject({ ok: false, code: 4411, reason: 'forbidden-data-key:imageGen.fileId' });
  });

  it('L2 :472 既有节点 data.set 禁键 → violation reason 含 forbidden-data-key（今天 dataValueShapeOk 放行=先红）', () => {
    for (const [type, key] of [
      ['imageGen', 'fileId'], ['imageGen', 'status'],
      ['videoGen', 'trimTaskStatus'], ['videoGen', 'trimmedFileId'],
      ['multiImageGen', 'nodeStatus'],
    ] as const) {
      const doc = new Y.Doc();
      doc.getMap('nodes').set('n1', legalNode(type));
      const events: Array<Y.YEvent<never>> = [];
      doc.getMap('nodes').observeDeep((evs) => {
        for (const e of evs) void e.changes.keys;   // handler 内物化（yjs after-handler 访问限制——生产 collector 同款）
        (events as unknown[]).push(...evs);
      });
      doc.transact(() => {
        ((doc.getMap('nodes').get('n1') as Y.Map<unknown>).get('data') as Y.Map<unknown>).set(key, 'legacy');
      });
      expect(validateAppliedL2(doc, events), `${type}.${key}`)
        .toMatchObject({ ok: false, reason: expect.stringContaining('forbidden-data-key') });
    }
  });

  it('L2 :499 NODE_CREATED 根级节点 data 带禁键 → violation reason 含 forbidden-data-key（今天 validateNodeShape 放行=先红）', () => {
    for (const [type, key] of [
      ['imageGen', 'fileId'], ['imageGen', 'status'],
      ['videoGen', 'trimTaskStatus'], ['videoGen', 'trimmedFileId'],
      ['multiImageGen', 'nodeStatus'],
    ] as const) {
      // 根级置入节点（NODE_CREATED 同形态——validateNodeShape 根级事件面）
      const doc = new Y.Doc();
      const events: Array<Y.YEvent<never>> = [];
      doc.getMap('nodes').observeDeep((evs) => {
        for (const e of evs) void e.changes.keys;
        (events as unknown[]).push(...evs);
      });
      doc.transact(() => { doc.getMap('nodes').set('n-root', forbiddenNode(type, key)); });
      expect(validateAppliedL2(doc, events), `${type}.${key}`)
        .toMatchObject({ ok: false, reason: expect.stringContaining('forbidden-data-key') });
    }
  });

  it('负控：合法载荷全放行维持（legalNode 不含禁键——翻禁后 8 类型负控仍绿）', () => {
    const f = frameOf((d) => {
      for (const type of Object.keys(DOC_SCHEMA_V4)) d.getMap('nodes').set(`n-${type}`, legalNode(type));
    });
    expect(validateFrameDeny(f)).toEqual({ ok: true });
  });
});

/** 根级置入节点构造器（validateNodeShape 面——data 含禁键）。 */
function forbiddenNode(type: string, key: string): Y.Map<unknown> {
  const node = new Y.Map();
  const data = new Y.Map();
  data.set(key, 'legacy-value');
  node.set('type', type);
  node.set('data', data);
  node.set('position', new Y.Map());
  return node;
}
