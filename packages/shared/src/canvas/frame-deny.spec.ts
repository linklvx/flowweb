// packages/shared/src/canvas/frame-deny.spec.ts
// Y1c T24：DENY 矩阵/L2 纯函数单元（新模块——红相=模块不存在〔编译级，T23 先例〕；本文件为绿态锁定）。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { validateFrameDeny, validateAppliedL2, countDsRanges, FRAME_DENY_ROOTS, FRAME_MAX_DS_RANGES, FRAME_MAX_STRUCTS } from './frame-deny';
import { DOC_SCHEMA_V4 } from './doc-schema-v4';
import { buildThreadEntry, buildThreadComment } from './threads-frame-predicate';

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

  // Y4a T2（spec §3.2 表——L1 根准入；帧谓词详细执法=T3）：timelines 根入 FRAME_DENY_ROOTS。
  // 先红：timelines 不在白名单 → unknown-root 拒。
  it('Y4a T2：timelines 根帧准入（L1 只收根——timeline-user 事务形态整棵工程子树放行；详细帧谓词=T3）', () => {
    expect(FRAME_DENY_ROOTS.has('timelines')).toBe(true);
    // 合法 timeline-user 事务形状：timelines.<nodeId>=Y.Map（version/fps/tracks/clips 混合容器+标量）
    // T3 起 L1 直接子项档跑全字段谓词——夹具补齐轨五键/片段满键（muted/hidden/transform/
    // playbackSpeed/keyframes 空容器=键矩阵合法树形态）。
    const entry = new Y.Map();
    entry.set('version', 1);
    entry.set('fps', 30);
    const tracks = new Y.Map();
    tracks.set('node1:video', new Y.Map([['type', 'video'], ['name', '视频'], ['muted', false], ['hidden', false], ['order', '5000']]));
    entry.set('tracks', tracks);
    const clips = new Y.Map();
    const clip = new Y.Map();
    clip.set('type', 'video');
    clip.set('mediaId', 'm-1');
    clip.set('span', { trackId: 'node1:video', start: 0, duration: 5 });
    clip.set('transform', { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
    clip.set('playbackSpeed', 1);
    clip.set('keyframes', new Y.Map());
    clips.set('clip1', clip);
    entry.set('clips', clips);
    const f = frameOf((d) => { d.getMap('timelines').set('node1', entry); });
    expect(validateFrameDeny(f)).toEqual({ ok: true });   // 修前红：unknown-root:timelines
    // 未准根维持 DENY（负控——白名单收窄检查）
    expect(validateFrameDeny(frameOf((d) => { d.getMap('bogus2').set('x', 1); })).ok).toBe(false);
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

// ══════════ Y4a T3（spec §0 条 8——L1 只查插入/L2 执法删除三级）：timelines 双面接线 ══════════
// 谓词单源=timeline-frame-predicate.ts（负控矩阵在 timeline-frame-predicate.spec.ts）；
// 本段锁 frame-deny.ts 的**接线面**：L1 两支（:153-159 直接子项档+:178 帧内深链档）只对插入跑
// 谓词、删除集不执法；L2 currentTarget 身份分支插在循环第一行（path.length===0 continue 块之前
// ——插到 :365 启发式前不够：path 空事件在 :363 已 continue、根上整棵新工程不检查=负控钉死）。

/** 合法 timelines.<nodeId> 工程入口（T2 既有夹具同族——version/fps/默认轨/零片段）。 */
function legalTimelineEntry(nodeId: string): Y.Map<unknown> {
  const entry = new Y.Map();
  entry.set('version', 1);
  entry.set('fps', 30);
  const tracks = new Y.Map();
  const t = new Y.Map();
  t.set('type', 'video'); t.set('name', '视频'); t.set('muted', false); t.set('hidden', false); t.set('order', '5000');
  tracks.set(`${nodeId}:video`, t);
  entry.set('tracks', tracks);
  entry.set('clips', new Y.Map());
  return entry;
}

/** L2 事件捕获装置（observeDeep 物化形态开关——④物化负控钉死用）。 */
function captureTimelines(doc: Y.Doc, materialize: boolean): Array<Y.YEvent<never>> {
  const events: Array<Y.YEvent<never>> = [];
  doc.getMap('timelines').observeDeep((evs) => {
    if (materialize) for (const e of evs) void e.changes;   // 回调内物化（edges :313 同款——不物化=事务后读抛 errorComputeChanges）
    (events as unknown[]).push(...evs);
  });
  return events;
}

describe('Y4a T3 ①：L1 两支只查插入（timelines 帧谓词接线——spec §0 条 8）', () => {
  it('直接子项档（:153-159 形态——timelines 根上新建工程 struct）：非法 fps 拒/合法树放行', () => {
    // 非法：根直接子项=version 标量非法值（fps 24——字面量矩阵）
    const bad = frameOf((d) => {
      const entry = legalTimelineEntry('n1');
      entry.set('fps', 24);
      d.getMap('timelines').set('n1', entry);
    });
    expect(validateFrameDeny(bad)).toMatchObject({ ok: false, reason: expect.stringContaining('timeline') });
    // 合法：整棵新工程（默认轨+容器）放行——容器创建本身合法
    const good = frameOf((d) => { d.getMap('timelines').set('n1', legalTimelineEntry('n1')); });
    expect(validateFrameDeny(good)).toEqual({ ok: true });
  });

  it('直接子项档：根直接子项非 Y.Map 拒（timelines.<nodeId> 标量=毒值）', () => {
    const f = frameOf((d) => { d.getMap('timelines').set('n1', 'not-a-map'); });
    expect(validateFrameDeny(f)).toMatchObject({ ok: false, reason: expect.stringContaining('timeline') });
  });

  it('帧内深链档（:178 形态——帧内新建工程下钻片段 span/transform）：非法 duration 拒/合法放行', () => {
    const bad = frameOf((d) => {
      const entry = legalTimelineEntry('n1');
      const clip = new Y.Map();
      clip.set('type', 'video');
      clip.set('span', { trackId: 'n1:video', start: 0, duration: -5, sourceStart: 0 });   // 非正 duration
      clip.set('transform', { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
      clip.set('mediaId', 'm-1');
      clip.set('playbackSpeed', 1);
      clip.set('keyframes', new Y.Map());
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('c1', clip);
    });
    expect(validateFrameDeny(bad)).toMatchObject({ ok: false, reason: expect.stringContaining('timeline') });
    const good = frameOf((d) => {
      const entry = legalTimelineEntry('n1');
      const clip = new Y.Map();
      clip.set('type', 'video');
      clip.set('span', { trackId: 'n1:video', start: 0, duration: 5, sourceStart: 0 });
      clip.set('transform', { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
      clip.set('mediaId', 'm-1');
      clip.set('playbackSpeed', 1);
      clip.set('keyframes', new Y.Map());
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('c1', clip);
    });
    expect(validateFrameDeny(good)).toEqual({ ok: true });
  });

  it('L1 不执法删除三级：纯删除帧放行（删除集只有 client/clock、帧内读不出键名——执法归 L2）', () => {
    // 建立基线 → 删 version 键（三级非法删除）→ 捕获纯删帧 → L1 必须放行（其执法=L2 档）
    const base = new Y.Doc();
    base.getMap('timelines').set('n1', legalTimelineEntry('n1'));
    const clone = new Y.Doc();
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(base));
    const captured: Uint8Array[] = [];
    clone.on('update', (u: Uint8Array) => { captured.push(u); });
    clone.transact(() => { (clone.getMap('timelines').get('n1') as Y.Map<unknown>).delete('version'); });
    const delFrame = captured.reduce((acc, u) => Y.mergeUpdates([acc, u]));
    expect(validateFrameDeny(delFrame)).toEqual({ ok: true });   // L1 拒=红（本任务钉「L1 只查插入」）
  });
});

describe('Y4a T3 ②：L2 currentTarget 身份分支（循环第一行、path 空 continue 块之前）', () => {
  it('根上整棵新工程（path 空+action add+新值 Y.Map）→ 谓词递归检查：非法值拒（分支未接/插点在 :363 之后=放行——负控钉死）', () => {
    const doc = new Y.Doc();
    const events = captureTimelines(doc, true);
    doc.transact(() => {
      const entry = legalTimelineEntry('n1');
      entry.set('fps', 24);   // 整棵新工程内非法字面量——递归谓词必须拒
      doc.getMap('timelines').set('n1', entry);
    });
    expect(events.length).toBeGreaterThan(0);
    expect(validateAppliedL2(doc, events)).toMatchObject({ ok: false, reason: expect.stringContaining('timeline') });
  });

  it('根上整棵新工程合法 → 放行（同事务 new Y.Map 子树不发独立事件——只查「这是个 Map」漏掉整棵=负控对照）', () => {
    const doc = new Y.Doc();
    const events = captureTimelines(doc, true);
    doc.transact(() => { doc.getMap('timelines').set('n1', legalTimelineEntry('n1')); });
    expect(validateAppliedL2(doc, events)).toEqual({ ok: true });
  });

  it('根上删 version/fps/tracks/clips 容器键 → 拒（三级删除规则——「删除一律合法」负控）', () => {
    for (const key of ['version', 'fps', 'tracks', 'clips'] as const) {
      const doc = new Y.Doc();
      doc.getMap('timelines').set('n1', legalTimelineEntry('n1'));
      const events = captureTimelines(doc, true);
      doc.transact(() => { (doc.getMap('timelines').get('n1') as Y.Map<unknown>).delete(key); });
      expect(validateAppliedL2(doc, events), `删除 ${key} 必须拒`).toMatchObject({ ok: false, reason: expect.stringContaining('timeline') });
    }
  });

  it('删片段条目/删整棵 timelines.<nodeId> → 放行（三级合法删除）', () => {
    // 删片段条目
    const doc = new Y.Doc();
    doc.getMap('timelines').set('n1', legalTimelineEntry('n1'));
    (doc.getMap('timelines').get('n1') as Y.Map<unknown>);
    doc.transact(() => {
      const entry = doc.getMap('timelines').get('n1') as Y.Map<unknown>;
      const clip = new Y.Map();
      clip.set('type', 'video');
      clip.set('span', { trackId: 'n1:video', start: 0, duration: 5, sourceStart: 0 });
      clip.set('transform', { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
      clip.set('mediaId', 'm-1');
      clip.set('playbackSpeed', 1);
      clip.set('keyframes', new Y.Map());
      (entry.get('clips') as Y.Map<unknown>).set('c1', clip);
    });
    const events = captureTimelines(doc, true);
    doc.transact(() => { ((doc.getMap('timelines').get('n1') as Y.Map<unknown>).get('clips') as Y.Map<unknown>).delete('c1'); });
    expect(validateAppliedL2(doc, events)).toEqual({ ok: true });
    // 删整棵 timelines.<nodeId>（根键 delete）
    const doc2 = new Y.Doc();
    doc2.getMap('timelines').set('n1', legalTimelineEntry('n1'));
    const events2 = captureTimelines(doc2, true);
    doc2.transact(() => { doc2.getMap('timelines').delete('n1'); });
    expect(validateAppliedL2(doc2, events2)).toEqual({ ok: true });
  });

  it('入口 Map 直接键事件（path=[nodeId] 改 canvasSize）→ 不进节点启发式（现形态 :383 node-key:* 毒帧误杀——改造后走 timelines 谓词放行）', () => {
    const doc = new Y.Doc();
    doc.getMap('timelines').set('n1', legalTimelineEntry('n1'));
    const events = captureTimelines(doc, true);
    doc.transact(() => { (doc.getMap('timelines').get('n1') as Y.Map<unknown>).set('canvasSize', { width: 1920, height: 1080 }); });
    expect(validateAppliedL2(doc, events)).toEqual({ ok: true });   // 修前红：n1 不在 nodes → :369 continue 或 :383 node-key 毒帧（按现状形态）
  });

  it('片段 Map 标量事件（path[1]=clips）非法 duration → L2 拒（现形态 :398 放行——改造后拒）', () => {
    const doc = new Y.Doc();
    doc.getMap('timelines').set('n1', legalTimelineEntry('n1'));
    doc.transact(() => {
      const entry = doc.getMap('timelines').get('n1') as Y.Map<unknown>;
      const clip = new Y.Map();
      clip.set('type', 'video');
      clip.set('span', { trackId: 'n1:video', start: 0, duration: 5, sourceStart: 0 });
      clip.set('transform', { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
      clip.set('mediaId', 'm-1');
      clip.set('playbackSpeed', 1);
      clip.set('keyframes', new Y.Map());
      (entry.get('clips') as Y.Map<unknown>).set('c1', clip);
    });
    const events = captureTimelines(doc, true);
    doc.transact(() => {
      const clip = ((doc.getMap('timelines').get('n1') as Y.Map<unknown>).get('clips') as Y.Map<unknown>).get('c1') as Y.Map<unknown>;
      clip.set('span', { trackId: 'n1:video', start: 0, duration: -1, sourceStart: 0 });   // 非法 duration
    });
    expect(validateAppliedL2(doc, events)).toMatchObject({ ok: false, reason: expect.stringContaining('timeline') });
  });

  it('已存在键 set 新 Y.Map（事件路径=timelines 谓词结构拒绝）→ 拒', () => {
    const doc = new Y.Doc();
    doc.getMap('timelines').set('n1', legalTimelineEntry('n1'));
    const events = captureTimelines(doc, true);
    doc.transact(() => { (doc.getMap('timelines').get('n1') as Y.Map<unknown>).set('tracks', new Y.Map()); });
    expect(validateAppliedL2(doc, events)).toMatchObject({ ok: false, reason: expect.stringContaining('timeline') });
  });
});

describe('Y4a T3 ③：现有面不破（nodes/edges/meta 事件照旧执法——回归）', () => {
  it('nodes 毒帧用例回归：type-immutable 维持（timelines 分支不得劫持 nodes 事件路径）', () => {
    const doc = new Y.Doc();
    doc.getMap('nodes').set('n1', legalNode('textInput'));
    const events: Array<Y.YEvent<never>> = [];
    doc.getMap('nodes').observeDeep((evs) => {
      for (const e of evs) void e.changes.keys;
      (events as unknown[]).push(...evs);
    });
    doc.transact(() => { (doc.getMap('nodes').get('n1') as Y.Map<unknown>).set('type', 'imageGen'); });
    expect(validateAppliedL2(doc, events)).toMatchObject({ ok: false, reason: 'type-immutable' });
  });

  it('timelines 事件与 nodes 事件同帧共存：nodes 违规仍被执（分支互不遮蔽）', () => {
    const doc = new Y.Doc();
    doc.getMap('nodes').set('n1', legalNode('textInput'));
    doc.getMap('timelines').set('t1', legalTimelineEntry('t1'));
    const events: Array<Y.YEvent<never>> = [];
    doc.getMap('nodes').observeDeep((evs) => { for (const e of evs) void e.changes.keys; (events as unknown[]).push(...evs); });
    doc.getMap('timelines').observeDeep((evs) => { for (const e of evs) void e.changes; (events as unknown[]).push(...evs); });
    doc.transact(() => {
      (doc.getMap('nodes').get('n1') as Y.Map<unknown>).set('type', 'imageGen');   // nodes 违规
      doc.getMap('timelines').delete('t1');   // timelines 合法删除
    });
    expect(validateAppliedL2(doc, events)).toMatchObject({ ok: false, reason: 'type-immutable' });
  });
});

describe('Y4a T3 ④：observeDeep 物化（事务结束后读面——errorComputeChanges 负控）', () => {
  it('不物化形态：事务结束后读 ev.changes 抛 errorComputeChanges（缓冲长度>0 盖不住——负控钉死；断言在事务结束后的读面）', () => {
    const doc = new Y.Doc();
    doc.getMap('timelines').set('n1', legalTimelineEntry('n1'));
    const events = captureTimelines(doc, false);   // 不物化
    expect(events.length).toBe(0);
    doc.transact(() => {
      (doc.getMap('timelines').get('n1') as Y.Map<unknown>).set('canvasSize', { width: 1920, height: 1080 });
      (doc.getMap('timelines').get('n1') as Y.Map<unknown>).set('fps', 24);   // 同帧两键——path=[n1] 单事件多键
    });
    // 事务结束后（cleanups 已清、_changes===null）——L2 timelines 分支读 changes 即抛：
    // 本负控断言在**接入后的读面**（改造前 path=[n1] 事件在 :369 归属判定 continue、不读 changes=
    // 改造前本测试不抛=先红；分支接上后本测试绿=物化负控生效钉死）。
    expect(events.length).toBeGreaterThan(0);   // 缓冲有事件——但 changes 未物化
    expect(() => validateAppliedL2(doc, events)).toThrow(/compute changes|You must not/i);
  });

  it('物化形态：事务结束后 validateAppliedL2 全通过（断言在事务结束后的读面）', () => {
    const doc = new Y.Doc();
    doc.getMap('timelines').set('n1', legalTimelineEntry('n1'));
    const events = captureTimelines(doc, true);
    doc.transact(() => { (doc.getMap('timelines').get('n1') as Y.Map<unknown>).set('canvasSize', { width: 1920, height: 1080 }); });
    expect(validateAppliedL2(doc, events)).toEqual({ ok: true });
  });
});

// ══════════ Y4a T3-fix（评审回包 round 1——I#2）：L2 keyframes 档（修前面零覆盖）══════════
// codec 的合法关键帧更新路径=kf.set(k.id, {...k}) 整值替换（action='update'）——修前
// timelineEventErr 对 keyframe id 的 update 无条件拒（timeline-keyframe-replaced）=合法关键帧
// 移动被 L2 毒帧；volume 关键帧带 property 的键矩阵规则（音量关键帧无 property）同批归位。
describe('Y4a T3-fix ②：L2 keyframes 容器事件档（path=[nodeId,clips,clipId,keyframes]）', () => {
  /** 建 doc：seed 工程+一个 audio 片段（keyframes 携 k1 音量关键帧）。 */
  function seededWithAudioKf(): { doc: Y.Doc; clip: Y.Map<unknown> } {
    const doc = new Y.Doc();
    doc.getMap('timelines').set('n1', legalTimelineEntry('n1'));
    const clip = new Y.Map();
    clip.set('type', 'audio');
    clip.set('span', { trackId: 'n1:video', start: 0, duration: 3, sourceStart: 0 });
    clip.set('mediaId', 'm-a');
    clip.set('volume', 1);
    clip.set('fade', { in: 0, out: 0 });
    clip.set('playbackSpeed', 1);
    const kf = new Y.Map();
    kf.set('k1', { id: 'k1', t: 0, value: 1, easing: 'linear' });
    clip.set('keyframes', kf);
    doc.transact(() => {
      ((doc.getMap('timelines').get('n1') as Y.Map<unknown>).get('clips') as Y.Map<unknown>).set('a1', clip);
    });
    return { doc, clip };
  }

  it('I#2a：codec 产出的 kf 整值更新（kf.set 同 id 新值）→ L2 放行（修前 update 无条件拒=合法编辑毒帧）', () => {
    const { doc } = seededWithAudioKf();
    const events = captureTimelines(doc, true);
    doc.transact(() => {
      const kf = (((doc.getMap('timelines').get('n1') as Y.Map<unknown>).get('clips') as Y.Map<unknown>).get('a1') as Y.Map<unknown>).get('keyframes') as Y.Map<unknown>;
      kf.set('k1', { id: 'k1', t: 5, value: 0.5, easing: 'linear' });   // codec timeline-codec.ts:334 同款整值替换
    });
    expect(events.length).toBeGreaterThan(0);
    expect(validateAppliedL2(doc, events)).toEqual({ ok: true });   // 修前红：timeline-keyframe-replaced:k1
  });

  it('I#2b：kf 整值更新带非法值（id 漂移 / 非 linear）→ L2 拒（update 合法但值非法才拒）', () => {
    // 键矩阵真值域：t 仅需有限数（排序域——spec §3.1 v6 修订⑤「t 再 id」无符号约束）、
    // id=Map 键、easing 只 linear；非法例=id 漂移+easing 非 linear。
    for (const poison of [{ id: 'k-other', t: 0, value: 1, easing: 'linear' }, { id: 'k1', t: 0, value: 1, easing: 'easeIn' }]) {
      const { doc } = seededWithAudioKf();
      const events = captureTimelines(doc, true);
      doc.transact(() => {
        const kf = (((doc.getMap('timelines').get('n1') as Y.Map<unknown>).get('clips') as Y.Map<unknown>).get('a1') as Y.Map<unknown>).get('keyframes') as Y.Map<unknown>;
        kf.set('k1', poison);
      });
      expect(validateAppliedL2(doc, events)).toMatchObject({ ok: false, reason: expect.stringContaining('timeline-keyframe') });
    }
  });

  it('I#2c：volume 关键帧带 property → L2 拒（音量关键帧无 property——键矩阵归位；修前 L2 面漏此规则）', () => {
    const { doc } = seededWithAudioKf();
    const events = captureTimelines(doc, true);
    doc.transact(() => {
      const kf = (((doc.getMap('timelines').get('n1') as Y.Map<unknown>).get('clips') as Y.Map<unknown>).get('a1') as Y.Map<unknown>).get('keyframes') as Y.Map<unknown>;
      kf.set('k2', { id: 'k2', t: 1, value: 1, easing: 'linear', property: 'volume' });   // VolumeKeyframe 无 property
    });
    expect(validateAppliedL2(doc, events)).toMatchObject({ ok: false, reason: expect.stringContaining('timeline-keyframe-property') });
  });

  it('I#2d：Transform 片段关键帧五键 property → L2 放行（正控——video kf 带 property 合法）', () => {
    const doc = new Y.Doc();
    doc.getMap('timelines').set('n1', legalTimelineEntry('n1'));
    const clip = new Y.Map();
    clip.set('type', 'video');
    clip.set('span', { trackId: 'n1:video', start: 0, duration: 5, sourceStart: 0 });
    clip.set('transform', { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
    clip.set('mediaId', 'm-1');
    clip.set('playbackSpeed', 1);
    clip.set('keyframes', new Y.Map());
    doc.transact(() => {
      ((doc.getMap('timelines').get('n1') as Y.Map<unknown>).get('clips') as Y.Map<unknown>).set('c1', clip);
    });
    const events = captureTimelines(doc, true);
    doc.transact(() => {
      const kf = (((doc.getMap('timelines').get('n1') as Y.Map<unknown>).get('clips') as Y.Map<unknown>).get('c1') as Y.Map<unknown>).get('keyframes') as Y.Map<unknown>;
      kf.set('k1', { id: 'k1', t: 0, property: 'x', value: 3, easing: 'linear' });
      kf.set('k1', { id: 'k1', t: 1, property: 'opacity', value: 0.5, easing: 'linear' });   // 整值更新
    });
    expect(validateAppliedL2(doc, events)).toEqual({ ok: true });
  });
});

// ═══════════ Y4b T7（spec §0 条 2/3/6/14）：threads 根接线 frame-deny 双面 ═══════════
// 谓词单源=threads-frame-predicate.ts（负控矩阵在其 .test.ts）；本段锁 frame-deny.ts 的
// **接线面**：L1 直档（:179-183 timelines 同形）+L1 深链档（:203-211 同形——framePathOf 把
// 本帧 ContentAny 收成普通对象调 checkThreadEntry/checkThreadComment）+L2 root-identity 分支
// （:527-531 同形——事件循环第一行、path.length===0 continue 之前）+fail-closed 缺省档。

/** 整棵合法线程 Y.Map（entry+comments 容器+首条评论——frameOf 单帧插入用；工厂出自 Task 6 谓词模块）。
 *  detached Y.Map.get 抛 Invalid access——评论挂入径=同帧持有 comments 引用先写后 attach（T6 fix r1
 *  held-ref 消费径同款）。overCb=entry 覆写（detached set 可行）；overComments=评论容器覆写。 */
function legalThreadMap(
  threadId: string,
  actor: string,
  overEntry?: (e: Y.Map<unknown>) => void,
  overComments?: (c: Y.Map<unknown>) => void,
): Y.Map<unknown> {
  const comments = new Y.Map<unknown>();
  const entry = buildThreadEntry({
    id: threadId, nodeId: 'n1', kind: 'node', resolved: false, createdAt: 0, createdBy: actor,
  });
  entry.set('comments', comments);   // 覆写工厂预建容器=同引用持有（测试构造自由度——帧内形状与工厂同形）
  comments.set('c1', buildThreadComment({ id: 'c1', authorId: actor, body: '首条评论正文', createdAt: 0 }));
  overComments?.(comments);
  overEntry?.(entry);
  return entry;
}

describe('Y4b T7 ②：L1 同帧新建档（整棵线程同帧插入+opts.actorUserId——spec §0 条 6）', () => {
  it('合法整棵线程（createdBy/authorId=actorUserId、resolved:false 在帧内）→ 放行（修前红：unknown-root:threads）', () => {
    const f = frameOf((d) => { d.getMap('threads').set('t1', legalThreadMap('t1', 'u1')); });
    expect(validateFrameDeny(f, { actorUserId: 'u1' })).toEqual({ ok: true });
  });

  it('冒名（createdBy/authorId=u2≠opts.actorUserId=u1）→ 拒', () => {
    const f = frameOf((d) => { d.getMap('threads').set('t1', legalThreadMap('t1', 'u2')); });
    expect(validateFrameDeny(f, { actorUserId: 'u1' }).ok).toBe(false);
  });

  it('缺省 opts（不传 actorUserId）带 threads 条目帧 → 拒（fail-closed——恢复导入空根放行带 parentSub 条目拒）', () => {
    const f = frameOf((d) => { d.getMap('threads').set('t1', legalThreadMap('t1', 'u1')); });
    expect(validateFrameDeny(f).ok).toBe(false);
  });

  it('空 threads 根（帧内只物化根、零条目）→ 缺省 opts 放行（恢复导入装载缝形态）', () => {
    const f = frameOf((d) => { d.getMap('threads'); });
    expect(validateFrameDeny(f)).toEqual({ ok: true });
  });

  it('半截 entry（只有 entry Map、缺 createdBy 等必填键——字段补下一帧=父出帧 4411 非合法创建路径）→ 拒（Review Focus 3）', () => {
    const f = frameOf((d) => {
      const entry = buildThreadEntry({ id: 't1', nodeId: 'n1', kind: 'node', resolved: false, createdAt: 0, createdBy: 'u1' });
      entry.delete('createdBy');   // 同帧只留 Map 骨架、必填键缺席
      d.getMap('threads').set('t1', entry);
    });
    expect(validateFrameDeny(f, { actorUserId: 'u1' }).ok).toBe(false);
  });
});

describe('Y4b T7 ③：L1 非法矩阵（深链档 ContentAny 收成普通对象调谓词——spec §2.3 三路同函数）', () => {
  it('entry 非 Map（根直接子项标量毒值）→ 拒（:179-183 timelines 直档同形）', () => {
    const f = frameOf((d) => { d.getMap('threads').set('t1', 'not-a-map'); });
    expect(validateFrameDeny(f, { actorUserId: 'u1' }).ok).toBe(false);
  });

  it('kind 越界（weird）→ 拒（深链档收成对象跑 checkThreadEntry）', () => {
    const f = frameOf((d) => { d.getMap('threads').set('t1', legalThreadMap('t1', 'u1', (e) => { e.set('kind', 'weird'); })); });
    expect(validateFrameDeny(f, { actorUserId: 'u1' }).ok).toBe(false);
  });

  it('垃圾 base64（kind=text 帧内直写锚值）→ 拒', () => {
    const f = frameOf((d) => {
      const entry = legalThreadMap('t1', 'u1', (e) => {
        e.set('kind', 'text');
        e.set('anchorStart', 'AA==');
        e.set('anchorEnd', 'AA==');
      });
      d.getMap('threads').set('t1', entry);
    });
    expect(validateFrameDeny(f, { actorUserId: 'u1' }).ok).toBe(false);
  });

  it('空白 body 首条评论 → 拒（评论深链档收成对象跑 checkThreadComment）', () => {
    const f = frameOf((d) => { d.getMap('threads').set('t1', legalThreadMap('t1', 'u1', undefined, (c) => {
      c.set('c1', buildThreadComment({ id: 'c1', authorId: 'u1', body: '   ', createdAt: 0 }));
    })); });
    expect(validateFrameDeny(f, { actorUserId: 'u1' }).ok).toBe(false);
  });

  it('空 threadId 键（threads 根键为 \'\' 的深链帧）→ 拒（thread-id-empty 固定原因码）', () => {
    const f = frameOf((d) => { d.getMap('threads').set('', legalThreadMap('', 'u1')); });
    const r = validateFrameDeny(f, { actorUserId: 'u1' });
    if (r.ok) throw new Error('expected denial');
    expect(r.reason).toBe('thread-id-empty');
  });

  // T7r1（Important 1 覆盖性锚——收成集记忆化后行为不变）：深链档多 threads value-struct 帧是
  // 修前逐 struct 重收集的 O(structs²) 面——本档用**多线程多 value-struct 帧**（每线程一条评论、
  // 评论区在 entry 逐 struct 之后——判定依赖全帧收成集而非首个 struct 的局部视图）钉死修后
  // 语义恒等：合法全过、任一线程毒值拒（含末位线程——修前重收集形态下末位判定同样依赖整帧集）。
  it('T7r1 记忆化行为锚：多线程多 value-struct 帧合法全过；末位线程毒值拒（收集恰一次、逐 struct 复用同集——行为与逐次重收集恒等）', () => {
    // 30 线程 × 每线程 entry 6 值 struct+评论 4 值 struct ≈ 300 value-struct——深链档复用面实载
    const mk = (tid: string, actor: string, bad?: boolean): Y.Map<unknown> =>
      legalThreadMap(tid, actor, undefined, (c) => {
        if (bad) c.set('c1', buildThreadComment({ id: 'c1', authorId: actor, body: '   ', createdAt: 0 }));
      });
    const good = frameOf((d) => {
      for (let i = 0; i < 30; i++) d.getMap('threads').set(`t${i}`, mk(`t${i}`, 'u1'));
    });
    expect(validateFrameDeny(good, { actorUserId: 'u1' })).toEqual({ ok: true });
    // 末位线程毒值：直档放行（Map 容器合法）、深链档末个 value-struct 收成集判拒——修前修后同拒
    const bad = frameOf((d) => {
      for (let i = 0; i < 29; i++) d.getMap('threads').set(`t${i}`, mk(`t${i}`, 'u1'));
      d.getMap('threads').set('t29', mk('t29', 'u1', true));
    });
    expect(validateFrameDeny(bad, { actorUserId: 'u1' }).ok).toBe(false);
  });
});

/** threads 事件捕获装置（observeDeep 回调内物化——Task 8 actor observer 同形；不物化=事务后读抛）。 */
function captureThreadsEvents(doc: Y.Doc): Array<Y.YEvent<never>> {
  const events: Array<Y.YEvent<never>> = [];
  doc.getMap('threads').observeDeep((evs) => {
    for (const e of evs) void e.changes;
    (events as unknown[]).push(...evs);
  });
  return events;
}

describe('Y4b T7 ④：L2 动作矩阵（validateAppliedL2 threads 分支——物化事件按 spec §0 条 14）', () => {
  it('合法新建线程整次 add → 放行（落成后形状+comments 至少一条——threadEventErr 根键 add 档）', () => {
    const doc = new Y.Doc();
    const events = captureThreadsEvents(doc);
    doc.transact(() => { doc.getMap('threads').set('t1', legalThreadMap('t1', 'u1')); });
    expect(events.length).toBeGreaterThan(0);
    expect(validateAppliedL2(doc, events, { actorUserId: 'u1' })).toEqual({ ok: true });
  });

  it('resolved 置布尔 → 合法（唯一可更新键）', () => {
    const doc = new Y.Doc();
    doc.transact(() => { doc.getMap('threads').set('t1', legalThreadMap('t1', 'u1')); });
    const events = captureThreadsEvents(doc);
    doc.transact(() => { (doc.getMap('threads').get('t1') as Y.Map<unknown>).set('resolved', true); });
    expect(validateAppliedL2(doc, events, { actorUserId: 'u1' })).toEqual({ ok: true });
  });

  it('根键 update（已存在 threads.<id> set 新 Map）→ 拒', () => {
    const doc = new Y.Doc();
    doc.transact(() => { doc.getMap('threads').set('t1', legalThreadMap('t1', 'u1')); });
    const events = captureThreadsEvents(doc);
    doc.transact(() => { doc.getMap('threads').set('t1', legalThreadMap('t1', 'u1')); });
    expect(validateAppliedL2(doc, events, { actorUserId: 'u1' }).ok).toBe(false);
  });

  it('body 改动（已有评论上 set body=该键 update 形态）→ 拒（评论内部键全拒）', () => {
    const doc = new Y.Doc();
    doc.transact(() => { doc.getMap('threads').set('t1', legalThreadMap('t1', 'u1')); });
    const events = captureThreadsEvents(doc);
    doc.transact(() => {
      const c1 = ((doc.getMap('threads').get('t1') as Y.Map<unknown>).get('comments') as Y.Map<unknown>).get('c1') as Y.Map<unknown>;
      c1.set('body', 'edited');
    });
    expect(validateAppliedL2(doc, events, { actorUserId: 'u1' }).ok).toBe(false);
  });

  it('追加评论 authorId=u2≠opts.actorUserId=u1 → 拒（冒名评论）', () => {
    const doc = new Y.Doc();
    doc.transact(() => { doc.getMap('threads').set('t1', legalThreadMap('t1', 'u1')); });
    const events = captureThreadsEvents(doc);
    doc.transact(() => {
      const comments = (doc.getMap('threads').get('t1') as Y.Map<unknown>).get('comments') as Y.Map<unknown>;
      comments.set('c2', buildThreadComment({ id: 'c2', authorId: 'u2', body: 'reply', createdAt: 1 }));
    });
    expect(validateAppliedL2(doc, events, { actorUserId: 'u1' }).ok).toBe(false);
  });

  it('opts.actorUserId 缺省 → threads 事件全拒（fail-closed；合法新建 add 也拒）', () => {
    const doc = new Y.Doc();
    const events = captureThreadsEvents(doc);
    doc.transact(() => { doc.getMap('threads').set('t1', legalThreadMap('t1', 'u1')); });
    expect(validateAppliedL2(doc, events).ok).toBe(false);
    // 缺省档对合法 resolved 更新同拒（全拒词面）
    const doc2 = new Y.Doc();
    doc2.transact(() => { doc2.getMap('threads').set('t1', legalThreadMap('t1', 'u1')); });
    const events2 = captureThreadsEvents(doc2);
    doc2.transact(() => { (doc2.getMap('threads').get('t1') as Y.Map<unknown>).set('resolved', true); });
    expect(validateAppliedL2(doc2, events2).ok).toBe(false);
  });

  it('回归：nodes/timelines 事件照旧执法（threads 分支不得劫持——既有面负控）', () => {
    const doc = new Y.Doc();
    doc.getMap('nodes').set('n1', legalNode('textInput'));
    const events: Array<Y.YEvent<never>> = [];
    doc.getMap('nodes').observeDeep((evs) => { for (const e of evs) void e.changes.keys; (events as unknown[]).push(...evs); });
    doc.transact(() => { (doc.getMap('nodes').get('n1') as Y.Map<unknown>).set('type', 'imageGen'); });
    expect(validateAppliedL2(doc, events)).toMatchObject({ ok: false, reason: 'type-immutable' });
  });
});
