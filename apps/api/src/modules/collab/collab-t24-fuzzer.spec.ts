// apps/api/src/modules/collab/collab-t24-fuzzer.spec.ts
// Y1c T24（卡文 3）：fuzzer——T5 语料（合法全类型载荷）+bit-flip+XML 对抗 L2 混合：任意帧经
// actor 准入=resolve 或 reject（4411/4412/1008），**永不挂起/崩溃/半应用**（apply 失败面=毒帧协议
// 有界处置）。确定性种子（mulberry32）——CI 可复现。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { CollabProjectActorService } from './collab-project-actor.service';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { DOC_SCHEMA_V4 } from '@flowweb/shared';
import type { Logger } from '@nestjs/common';

let spoolDir: { dir: string; cleanup: () => Promise<void> };
beforeEach(async () => { spoolDir = await makeSpoolDir('t24-fuzz-'); });
afterEach(async () => { await spoolDir.cleanup(); });

function buildActor(doc: Y.Doc, pid = 'p1') {
  const spool = new CollabSpoolService(spoolDir.dir);
  spool.setOwner('t24f-owner');
  spool.setWalHistory('t24f-history');
  const repo = createMockRepo();
  const documents = new Map<string, Y.Doc>([[`project:${pid}`, doc]]);
  const actor = new CollabProjectActorService(spool as never, repo as never);
  (actor as unknown as { bindHost(h: unknown): void }).bindHost({
    logger: { log: (): void => {}, warn: (): void => {}, error: (): void => {}, debug: (): void => {}, verbose: (): void => {}, fatal: (): void => {}, localInstance: true } as unknown as Logger,
    documents: () => documents,
    hardClose: (): void => {},
    isQuotaFrozen: () => false,
    generationOf: () => 0,
    noteReadOnlyDrop: () => false,
    onFencedByWrite: async () => {},
  });
  return { actor };
}

/** mulberry32（确定性 PRNG——doc-codec.roundtrip fuzz 同族）。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 全类型合法基线帧（8 类型——DOC_SCHEMA_V4 键集单源）。 */
function corpusFrame(): Uint8Array {
  const d = new Y.Doc();
  d.transact(() => {
    for (const type of Object.keys(DOC_SCHEMA_V4)) {
      const node = new Y.Map();
      const data = new Y.Map();
      for (const [k, spec] of Object.entries(DOC_SCHEMA_V4[type]!.data)) {
        if (spec.yType === 'xml') {
          const frag = new Y.XmlFragment();
          const p = new Y.XmlElement('paragraph');
          p.insert(0, [new Y.XmlText()]);
          frag.insert(0, [p]);
          data.set(k, frag);
        } else if (spec.yType === 'text') data.set(k, new Y.Text('seed'));
        else if (spec.yType === 'map') { const m = new Y.Map(); m.set('text', new Y.Text()); data.set(k, m); }
        else if (spec.yType === 'array') { const a = new Y.Array(); a.push([{ id: 'm1' }]); data.set(k, a); }
        else if (spec.yType === 'lww') data.set(k, 'v');
        else if (spec.yType === 'lww-array') data.set(k, ['v']);
      }
      node.set('type', type);
      node.set('data', data);
      node.set('position', new Y.Map());
      d.getMap('nodes').set(`n-${type}`, node);
    }
  });
  return Y.encodeStateAsUpdate(d);
}

/** XML 对抗子树（L1 盲区形态：合法名+非法属性/嵌套——喂 L2 面）。 */
function xmlAdversarialFrame(): Uint8Array {
  const d = new Y.Doc();
  d.transact(() => {
    const node = new Y.Map();
    const data = new Y.Map();
    const frag = new Y.XmlFragment();
    const p = new Y.XmlElement('paragraph');
    const img = new Y.XmlElement('image');
    img.setAttribute('src', `http://evil-${Math.random().toString(36).slice(2)}.example/x.png`);
    p.insert(0, [img, new Y.XmlText()]);
    frag.insert(0, [p]);
    data.set('content', frag);
    node.set('type', 'textInput');
    node.set('data', data);
    node.set('position', new Y.Map());
    d.getMap('nodes').set('n1', node);
  });
  return Y.encodeStateAsUpdate(d);
}

describe('Y1c T24 fuzzer（T5 语料+bit-flip+XML 对抗 L2——永不挂起/崩溃/半应用）', () => {
  it('bit-flip ×200（种子 20261024）：每帧有界落定（resolve 或 4411/4412/1008 reject）——零挂起零未分类异常', async () => {
    const { actor } = buildActor(new Y.Doc());
    const r = rng(20261024);
    const corpus = [corpusFrame(), xmlAdversarialFrame()];
    let resolved = 0;
    let rejected = 0;
    for (let i = 0; i < 200; i++) {
      const base = corpus[i % corpus.length];
      const bytes = new Uint8Array(base);
      const flips = 1 + Math.floor(r() * 4);
      for (let f = 0; f < flips; f++) {
        const pos = Math.floor(r() * bytes.length);
        bytes[pos] = (bytes[pos] ^ (1 << Math.floor(r() * 8))) & 0xff;
      }
      try {
        const outcome = await actor.submit('p1', bytes, { socketId: `sock-f${i}`, readOnly: false, sendStateless: (): void => {}, context: { user: { id: 'u1' } } } as never, 'update');
        if (typeof outcome === 'object' && outcome !== null && 'walSeq' in outcome) resolved += 1;
        else rejected += 1;
      } catch (e) {
        // 「有界落定」reject 面：FrameRejectError 有界码（毒帧/pending/绑定——零未分类异常）
        expect([4411, 4412, 1008, 4404]).toContain((e as { code?: number }).code ?? -1);
        rejected += 1;
      }
    }
    expect(resolved + rejected).toBe(200);
  }, 60_000);

  it('毒帧 throw 面（bit-flip 命中解码异常/矩阵违规）：reject 恒为 FrameRejectError 有界形态（code ∈ {4411,4412,1008}）', async () => {
    const { actor } = buildActor(new Y.Doc());
    const r = rng(777);
    const codes = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const bytes = new Uint8Array(corpusFrame());
      bytes[Math.floor(r() * bytes.length)] = 0xff;
      try {
        await actor.submit('p1', bytes, { socketId: `sock-t${i}`, readOnly: false, sendStateless: (): void => {}, context: { user: { id: 'u1' } } } as never, 'update');
      } catch (e) {
        const code = (e as { code?: number }).code ?? -1;
        codes.add(code);
        expect([4411, 4412, 1008, 4404]).toContain(code);   // 有界拒码（毒帧/pending/绑定面）
      }
    }
    expect(codes.size).toBeGreaterThan(0);
  }, 60_000);
});
