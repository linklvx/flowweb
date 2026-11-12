// apps/api/src/modules/collab/collab-project-actor.binding-delta.spec.ts
// C3a-3（地基修复批·C3a 卡——spec 2026-11-11-foundation-batch-design.md §3.2-1 帧级快照）：
// actor touched 保守收集+帧边界 bindingDelta 五族红测（plan v3 Task C3a-3 Step 1 逐条）。
//   ①数组-only splice→delta 含该 node——**根缺口钉**：现 observeDeep 只读 ev.changes.keys
//     （YMapEvent 形态），YArrayEvent 的 keys 是空 Map ⇒ 数组 splice 事件零 MEDIA_REF 效果产出=漏
//     （spec §1-1 钉的 root update 零分支同族——effects 词表冻结不动，缺口由 touched 承接）；
//   ②nodes.set(existingId,newMapWithMedia) root update→touched（现零分支——root 只处理 add/delete）；
//   ③node 内 set('data',newMap) 整替换→touched；
//   ④position-only 变更→**不** touched（position 不在 data 域——binding 零效应不误触）；
//   ⑤meta/exec 顶层 map 事件不误触（touched 收集挂 nodes.observeDeep——非 nodes 域不进）；
//   ⑥NODE_DELETED 语义：root delete 帧→touched 含被删 node 时 delta 记 null
//     （spec §3.2-1 Map<nodeId,槽位集>——node 已不在 doc，null=全删该 node 槽位，C3a-5 投影器 diff 消费）。
// 红态=FrameEffectsCollector 无 takeBindingDelta/BindingDelta（编译级红——c3a-schema.int.spec 先例）；
// 装置=真 Yjs（Y.Doc 事务帧），收集器用法镜像 drain 批（begin→applyGate→take→takeBindingDelta）。
// 接线组：真实 actor.submit 路径断言 binding_delta_bytes 直方图观测（mkAppliedEntry 单点 observe）
// +帧无 touched 零观测（C3a-4 投影跳过零开销的前置语义）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { register } from 'prom-client';
import type { Logger } from '@nestjs/common';
import { FrameEffectsCollector, type BindingDelta } from './collab-project-actor.service';
import { CollabProjectActorService } from './collab-project-actor.service';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';

/** 事务帧构造（生产形态=单事务增量 update——collab-project-actor.spec incrementalFrame 同款）。 */
function frameOf(mutate: (src: Y.Doc) => void, base?: Uint8Array): Uint8Array {
  const src = new Y.Doc();
  if (base !== undefined) Y.applyUpdate(src, base);
  const ups: Uint8Array[] = [];
  src.on('update', (u: Uint8Array) => { ups.push(u); });
  src.transact(() => { mutate(src); });
  return Y.mergeUpdates(ups);
}

/** 节点构造（信封 type+position+data——data 值原样 set：Y.Array 列表槽/string 标量槽）。 */
function mkNode(type: string, dataEntries: Record<string, unknown>): Y.Map<unknown> {
  const n = new Y.Map<unknown>();
  n.set('type', type);
  const pos = new Y.Map<unknown>();
  pos.set('x', 0);
  pos.set('y', 0);
  n.set('position', pos);
  const d = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(dataEntries)) d.set(k, v);
  n.set('data', d);
  return n;
}

const nodeOf = (doc: Y.Doc, id: string): Y.Map<unknown> => doc.getMap('nodes').get(id) as Y.Map<unknown>;
const dataOf = (doc: Y.Doc, id: string): Y.Map<unknown> => nodeOf(doc, id).get('data') as Y.Map<unknown>;

/** 单元装置：收集器镜像 drain 批用法（begin→apply→take→takeBindingDelta——终态快照非逐事件增量）。 */
function applyFrame(c: FrameEffectsCollector, doc: Y.Doc, walSeq: bigint, frame: Uint8Array): { effects: ReadonlyArray<{ kind: string }>; delta: BindingDelta } {
  c.begin(walSeq);
  Y.applyUpdate(doc, frame);
  const effects = c.take();
  const delta = c.takeBindingDelta(doc);
  return { effects, delta };
}

const kindsOf = (effects: ReadonlyArray<{ kind: string }>) => [...new Set(effects.map((e) => e.kind))].sort();

describe('C3a-3：touched 保守收集+帧边界 bindingDelta（五族——spec §3.2-1）', () => {
  it('①数组-only splice→delta 含该 node（根缺口钉：YArrayEvent keys 空 Map ⇒ effects 零 MEDIA_REF 产出）', () => {
    const c = new FrameEffectsCollector();
    const doc = new Y.Doc();
    c.install(doc);
    // 基帧：multiImageGen{images:Y.Array[{id:'m1'}]}（Y1c T17 载体形态——item=plain JSON 携稳定 id）
    const arr = new Y.Array<unknown>();
    arr.push([{ id: 'm1' }]);
    const base = frameOf((src) => { src.getMap('nodes').set('n1', mkNode('multiImageGen', { label: 'L', images: arr })); });
    const seeded = applyFrame(c, doc, 1n, base);
    expect(seeded.delta.get('n1')).toEqual([
      { nodeId: 'n1', mediaId: 'm1', role: 'primary', targetField: 'images', targetItemId: 'm1' },
    ]);
    // 数组 splice 帧：push {id:'m2'}——YArrayEvent(path=['n1','data','images'], keys=空 Map)
    const splice = frameOf((src) => {
      (dataOf(src, 'n1').get('images') as Y.Array<unknown>).push([{ id: 'm2' }]);
    }, base);
    const { effects, delta } = applyFrame(c, doc, 2n, splice);
    expect(kindsOf(effects), '根缺口钉（绿稳态）：effects 词表冻结——数组 splice 零 MEDIA_REF 产出（漏由 touched 承接）').toEqual([]);
    expect(delta.has('n1'), '数组-only 帧必须进 touched（修前=漏——节点引用集与 doc 漂移）').toBe(true);
    expect(delta.get('n1')).toEqual([
      { nodeId: 'n1', mediaId: 'm1', role: 'primary', targetField: 'images', targetItemId: 'm1' },
      { nodeId: 'n1', mediaId: 'm2', role: 'primary', targetField: 'images', targetItemId: 'm2' },
    ]);
  });

  it('②nodes.set(existingId,newMapWithMedia) root update→touched（现零分支——root 只处理 add/delete）', () => {
    const c = new FrameEffectsCollector();
    const doc = new Y.Doc();
    c.install(doc);
    const base = frameOf((src) => { src.getMap('nodes').set('n1', mkNode('imageGen', { referenceImage: 'media-a' })); });
    applyFrame(c, doc, 1n, base);
    // root update 帧：同键换新 Y.Map（引用 media-b）——root 事件 action='update' 现零分支
    const f = frameOf((src) => { src.getMap('nodes').set('n1', mkNode('imageGen', { referenceImage: 'media-b' })); }, base);
    const { effects, delta } = applyFrame(c, doc, 2n, f);
    expect(effects.filter((e) => e.kind.startsWith('NODE_') || e.kind.startsWith('MEDIA_REF')),
      '绿稳态钉：root update 不产 effects（词表冻结）——零分支缺口由 touched 承接').toEqual([]);
    expect(delta.has('n1'), 'root update 必须进 touched（spec §3.2-1「root add/delete/update 全标」——第五轮 P0）').toBe(true);
    expect(delta.get('n1')).toEqual([
      { nodeId: 'n1', mediaId: 'media-b', role: 'primary', targetField: 'referenceImage', targetItemId: '' },
    ]);
  });

  it('③node 内 set(\'data\',newMap) 整替换→touched（终态快照=替换后引用集——标量槽+allImages 列表槽）', () => {
    const c = new FrameEffectsCollector();
    const doc = new Y.Doc();
    c.install(doc);
    const base = frameOf((src) => { src.getMap('nodes').set('n1', mkNode('imageGen', { referenceImage: 'media-a' })); });
    applyFrame(c, doc, 1n, base);
    const f = frameOf((src) => {
      const d = new Y.Map<unknown>();
      d.set('referenceImage', 'media-c');
      const allImages = new Y.Array<unknown>();
      allImages.push([{ id: 'media-all-1' }, { id: 'media-all-2' }]);
      d.set('allImages', allImages);
      nodeOf(src, 'n1').set('data', d);
    }, base);
    const { delta } = applyFrame(c, doc, 2n, f);
    expect(delta.has('n1')).toBe(true);
    expect(delta.get('n1')).toEqual([
      { nodeId: 'n1', mediaId: 'media-c', role: 'primary', targetField: 'referenceImage', targetItemId: '' },
      { nodeId: 'n1', mediaId: 'media-all-1', role: 'primary', targetField: 'allImages', targetItemId: 'media-all-1' },
      { nodeId: 'n1', mediaId: 'media-all-2', role: 'primary', targetField: 'allImages', targetItemId: 'media-all-2' },
    ]);
  });

  it('④position-only 两形态（子 map 逐键/整键替换）→不 touched（position 不在 data 域）', () => {
    const c = new FrameEffectsCollector();
    const doc = new Y.Doc();
    c.install(doc);
    const base = frameOf((src) => { src.getMap('nodes').set('n1', mkNode('imageGen', { referenceImage: 'media-a' })); });
    applyFrame(c, doc, 1n, base);
    // 形态 A：position 子 map 逐键（path=['n1','position']）
    const fA = frameOf((src) => { (nodeOf(src, 'n1').get('position') as Y.Map<unknown>).set('x', 99); }, base);
    const rA = applyFrame(c, doc, 2n, fA);
    expect(rA.delta.size, 'position 子 map 逐键不进 touched').toBe(0);
    // 形态 B：node 级 position 键整替换（path=['n1'], keys={position}）
    const fB = frameOf((src) => {
      const pos = new Y.Map<unknown>();
      pos.set('x', 1);
      pos.set('y', 2);
      nodeOf(src, 'n1').set('position', pos);
    }, Y.mergeUpdates([base, fA]));
    const rB = applyFrame(c, doc, 3n, fB);
    expect(rB.delta.size, 'position-only 键替换不进 touched（保守但不误触）').toBe(0);
  });

  it('⑤meta/exec 顶层 map 事件不误触（touched 收集=nodes 域——非 nodes 域事件零进）', () => {
    const c = new FrameEffectsCollector();
    const doc = new Y.Doc();
    c.install(doc);
    const base = frameOf((src) => { src.getMap('nodes').set('n1', mkNode('imageGen', { referenceImage: 'media-a' })); });
    applyFrame(c, doc, 1n, base);
    const f = frameOf((src) => {
      src.getMap('meta').set('theme', 'dark');
      src.getMap('exec').set('run', 1);
    }, base);
    const { delta } = applyFrame(c, doc, 2n, f);
    expect(delta.size, 'meta/exec 顶层事件零误触（判定挂 nodes.observeDeep——spec §3.2-1「仅 position/edges 类跳过」同族域外）').toBe(0);
  });

  it('⑥NODE_DELETED：root delete 帧→touched 含被删 node 时 delta 记 null（全删该 node 槽位——C3a-5 diff 语义）', () => {
    const c = new FrameEffectsCollector();
    const doc = new Y.Doc();
    c.install(doc);
    const base = frameOf((src) => { src.getMap('nodes').set('n1', mkNode('imageGen', { referenceImage: 'media-a' })); });
    applyFrame(c, doc, 1n, base);
    const f = frameOf((src) => { src.getMap('nodes').delete('n1'); }, base);
    const { delta } = applyFrame(c, doc, 2n, f);
    expect(delta.size).toBe(1);
    expect(delta.get('n1'), 'node 已不在 doc——null=NODE_DELETED（槽位集非空集：空集=无引用，null=全删槽位）').toBeNull();
  });
});

// ═══ 接线组：真实 submit 路径（touched→delta→AppliedEntry→binding_delta_bytes 直方图单点 observe）═══

let spoolDir: { dir: string; cleanup: () => Promise<void> };
beforeEach(async () => { spoolDir = await makeSpoolDir('c3a3-bd-'); });
afterEach(async () => { await spoolDir.cleanup(); });

function makeConn() {
  return { socketId: 'sock-' + Math.random().toString(36).slice(2, 8), readOnly: false, sendStateless: vi.fn() } as never;
}

function buildActor(doc: Y.Doc, pid = 'p1') {
  const spool = new CollabSpoolService(spoolDir.dir);
  spool.setOwner('c3a3-owner');
  spool.setWalHistory('c3a3-history');
  const repo = createMockRepo();
  const documents = new Map<string, Y.Doc>([[`project:${pid}`, doc]]);
  const actor = new CollabProjectActorService(spool, repo as never);
  (actor as unknown as { bindHost(h: unknown): void }).bindHost({
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn(), fatal: vi.fn(), localInstance: true } as unknown as Logger,
    documents: () => documents,
    hardClose: () => {},
    isQuotaFrozen: () => false,
    generationOf: () => 0,
    noteReadOnlyDrop: () => false,
    onFencedByWrite: async () => {},
  });
  return { actor };
}

/** binding_delta_bytes 直方图样本数（<name>_count 计数项——观测次数单源读面）。 */
async function bindingDeltaObservations(): Promise<number> {
  const json = await register.getMetricsAsJSON();
  const m = json.find((x) => x.name === 'binding_delta_bytes');
  if (!m) return 0;
  const count = (m.values as Array<{ metricName?: string; value?: number }>).find((v) => v.metricName === 'binding_delta_bytes_count');
  return count?.value ?? 0;
}

describe('C3a-3 接线：actor.submit 路径 binding_delta_bytes 直方图（帧无 touched=零观测）', () => {
  it('数组 splice 帧经真实 submit→直方图恰 2 观测（基帧 root add+splice 帧）；position-only 帧零观测', async () => {
    const doc = new Y.Doc();
    const { actor } = buildActor(doc);
    const arr = new Y.Array<unknown>();
    arr.push([{ id: 'm1' }]);
    const base = frameOf((src) => { src.getMap('nodes').set('n1', mkNode('multiImageGen', { label: 'L', images: arr })); });
    const before = await bindingDeltaObservations();
    const r1 = await actor.submit('p1', base, makeConn(), 'update');
    expect(r1.walSeq).toBe(1n);
    const splice = frameOf((src) => {
      (dataOf(src, 'n1').get('images') as Y.Array<unknown>).push([{ id: 'm2' }]);
    }, base);
    const r2 = await actor.submit('p1', splice, makeConn(), 'update');
    expect(r2.walSeq).toBe(2n);
    expect(await bindingDeltaObservations() - before, '基帧（root add→touched n1）+splice 帧（数组根缺口承接）各一观测').toBe(2);
    const posOnly = frameOf((src) => {
      (nodeOf(src, 'n1').get('position') as Y.Map<unknown>).set('x', 99);
    }, Y.mergeUpdates([base, splice]));
    const r3 = await actor.submit('p1', posOnly, makeConn(), 'update');
    expect(r3.walSeq).toBe(3n);
    expect(await bindingDeltaObservations() - before, 'position-only 帧 delta 空=零观测（C3a-4 投影跳过零开销前置语义）').toBe(2);
  }, 20_000);
});
