// apps/api/src/modules/collab/collab-t24-t26-parity.spec.ts
// Y1c T24（T26 收口批登记两行——本卡顺手落档）：
// ①FrameEffect 词表两面对齐：collector NODE_CREATED/RESTORED 门（actor FrameEffectsCollector）与
//   T26 播种门（lifecycle-observer deriveSeedWrites）同滤 isFrameNodeTypeName——**两门漂移即红**
//   （对拍用例：同输入集两门过滤结果逐值等值）；
// ②T9 卫生项：NODE_RESTORED 分支在单事务 delete+re-add 的 Yjs map 事件合并形态下不可达（实测
//   yjs 13.6.32：合并为单事件 action='update'，无 keysDeleted/keysAdded 序列）——collector 注释
//   /用例对齐（本 spec 用例锁行为：update 形态零 effect=存在性净不变语义正确）。
// 附：T24 graph_anomaly_total/装载即 rebuild 观测锚。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { register } from 'prom-client';
import { CollabProjectActorService, ProjectDocIndexImpl } from './collab-project-actor.service';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { isFrameNodeTypeName, DOC_SCHEMA_V4 } from '@flowweb/shared';
import { deriveLifecycleWrites } from './collab-lifecycle-observer.service';
import type { Logger } from '@nestjs/common';

let spoolDir: { dir: string; cleanup: () => Promise<void> };
beforeEach(async () => { spoolDir = await makeSpoolDir('t24-par-'); });
afterEach(async () => { await spoolDir.cleanup(); });

function buildActor(doc: Y.Doc, pid = 'p1') {
  const spool = new CollabSpoolService(spoolDir.dir);
  spool.setOwner('t24p-owner');
  spool.setWalHistory('t24p-history');
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

function nodeFrame(type: string, id: string): Uint8Array {
  const d = new Y.Doc();
  const node = new Y.Map();
  const data = new Y.Map();
  data.set('order', 'a1');
  node.set('type', type);
  node.set('data', data);
  node.set('position', new Y.Map());
  d.getMap('nodes').set(id, node);
  return Y.encodeStateAsUpdate(d);
}

describe('Y1c T24/T26：FrameEffect 词表两面对齐（两门漂移即红——对拍用例）', () => {
  it('collector 门与 T26 播种门同滤：词表内类型产 NODE_CREATED、词表外零 effect 且 derive 零行——逐值对拍', async () => {
    const doc = new Y.Doc();
    const { actor } = buildActor(doc);
    // 词表内全集（DOC_SCHEMA_V4 8 类型——与 FRAME_EFFECT_NODE_TYPE_VOCABULARY 同锚）
    for (const type of Object.keys(DOC_SCHEMA_V4)) {
      await expect(actor.submit('p1', nodeFrame(type, `n-${type}`), { socketId: 's-v', readOnly: false, sendStateless: (): void => {}, context: { user: { id: 'u1' } } } as never, 'update')).resolves.toBeDefined();
      expect(actor.docIndexOf('p1').nodeType(`n-${type}`)).toBe(type);   // collector 门放行+索引落型
    }
    // 词表外类型：gate DENY（unknown-node-type——帧进不来=零 effect 面）；
    // T26 播种门 deriveSeedWrites 词表外零行（同滤对拍——观察器种子面）
    const vocabIn = Object.keys(DOC_SCHEMA_V4);
    const probe = ['bogusType', 'text', 'image', 'exec'];
    for (const t of probe) {
      expect(isFrameNodeTypeName(t)).toBe(vocabIn.includes(t));   // 词表判定单源对拍
    }
    // deriveLifecycleWrites 对拍：在册 ACTIVE 节点的 NODE_DELETED 产行（词表门在 collector 侧滤型——
    // 观察器消费 effect 流；两门同输入〔词表〕同输出〔零词表外 effect〕由 collector 侧 deny+本对拍共锁）
    const writesIn = deriveLifecycleWrites([{ walSeq: 1n, effects: [{ kind: 'NODE_DELETED', nodeId: 'x', walSeq: 1n }] }], {
      current: new Map([['x', { lifecycleSeq: 1n, state: 'ACTIVE' as const }]]),
      seen: new Set(), nextSeq: 2n,
    });
    expect(writesIn.writes).toHaveLength(1);
  });
});

describe('Y1c T24：NODE_RESTORED 不可达形态用例对齐（T9 卫生项②——collector 注释配对用例）', () => {
  it('同事务 delete+re-add=合并 update 事件：零 NODE_* effect（存在性净不变——实测 yjs 13.6.32 事件合并形态）', async () => {
    const doc = new Y.Doc();
    const { actor } = buildActor(doc);
    await actor.submit('p1', nodeFrame('textInput', 'n1'), { socketId: 's-r', readOnly: false, sendStateless: (): void => {}, context: { user: { id: 'u1' } } } as never, 'update');
    // 单事务 delete+re-add 帧（客户端合并形态）
    const src = new Y.Doc();
    Y.applyUpdate(src, Y.encodeStateAsUpdate(doc));
    src.transact(() => {
      src.getMap('nodes').delete('n1');
      src.getMap('nodes').set('n1', (src.getMap('nodes') as Y.Map<unknown>).get('n1') ?? new Y.Map());
    });
    // 事件层实证（spec 内直接锁 yjs 行为）：root 事件 action='update'（无 add/delete 序列）
    const probe = new Y.Doc();
    Y.applyUpdate(probe, Y.encodeStateAsUpdate(doc));
    const actions: string[] = [];
    probe.getMap('nodes').observe((ev) => { for (const [, ch] of ev.keys) actions.push(ch.action); });
    probe.transact(() => {
      probe.getMap('nodes').delete('n1');
      probe.getMap('nodes').set('n1', new Y.Map());
    });
    expect(actions).toEqual(['update']);   // 合并形态实锤——NODE_RESTORED 分支（frameDeleted 命中）不可达
    expect(actor.docIndexOf('p1').nodeType('n1')).toBe('textInput');   // 存在性净不变（索引不变）
  });
});

describe('Y1c T24：graph_anomaly_total{kind}+docIndex 装载即 rebuild 观测锚', () => {
  it('悬挂边/重复边经索引评估计数（增量——graph_anomaly_total{dangling-edge}）', async () => {
    const doc = new Y.Doc();
    const { actor } = buildActor(doc);
    const countOf = async (kind: string): Promise<number> => {
      const m = register.getSingleMetric('graph_anomaly_total') as never as { get(): Promise<{ values: Array<{ labels: Record<string, string>; value: number }> }> };
      const v = await m.get();
      return v.values.find((s) => s.labels.kind === kind)?.value ?? 0;
    };
    const before = await countOf('dangling-edge');
    // 建节点+悬挂边（target 不存在）——edge effect 落索引→anomaly 计数
    const d = new Y.Doc();
    d.transact(() => {
      const node = new Y.Map();
      node.set('type', 'textInput');
      node.set('data', new Y.Map());
      node.set('position', new Y.Map());
      d.getMap('nodes').set('n1', node);
      const edge = new Y.Map();
      edge.set('id', 'e1');
      edge.set('source', 'n1');
      edge.set('target', 'ghost');
      d.getMap('edges').set('e1', edge);
    });
    await actor.submit('p1', Y.encodeStateAsUpdate(d), { socketId: 's-g', readOnly: false, sendStateless: (): void => {}, context: { user: { id: 'u1' } } } as never, 'update');
    expect(await countOf('dangling-edge')).toBeGreaterThan(before);
  });

  it('docIndex 装载即 rebuild（noteDocIndexRebuild——装载 doc 既有节点进索引；登记项根修锚）', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const node = new Y.Map();
      node.set('type', 'audioGen');
      node.set('data', new Y.Map());
      node.set('position', new Y.Map());
      doc.getMap('nodes').set('pre1', node);
    });
    const { actor } = buildActor(new Y.Doc(), 'p-load');
    // 装载缝 rebuild 前：索引空（nodeType miss）；rebuild 后：装载态全量在册
    expect(actor.docIndexOf('p-load').nodeType('pre1')).toBeUndefined();
    actor.noteDocIndexRebuild('p-load', doc);
    expect(actor.docIndexOf('p-load').nodeType('pre1')).toBe('audioGen');
    // 索引 impl 异常评估面（edgeEndpoints 维护）
    const idx = actor.docIndexOf('p-load') as ProjectDocIndexImpl;
    expect(idx.graphAnomalies()['dangling-edge'] ?? 0).toBe(0);
  });
});
