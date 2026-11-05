// apps/api/src/modules/collab/collab-canary-verify.spec.ts
// C2-2b（plan Task C2-2 比对侧）：worker verify 纯判定面单测（无 PG——红⑥-a 语义兜底构造直证）。
//  「同逻辑状态不同 integration order」两 doc 构造：①同帧集不同应用序——Yjs 确定性（同 op 集⇒
//  同内部态⇒encodeStateAsUpdate 恒等——hash 主判绿）；②同逻辑态不同 op 集（k1 两跳 vs 直达——
//  encodeCanonicalUpdate hash 不等）而 semanticEqualDocs（节点/边 canonical JSON 深比）=true——
//  语义兜底「语义相等不 freeze」的工具面真值；SV 互支=worker 侧判据（①true②false——同 op 集等价
//  代理的边界实证：op 集差异〔压缩历史/重打 client〕语义等而 SV 判 false=登记的保守面〔mismatch
//  方向〕——生产 same-generation 重放同 op 集恒走①档〕。
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { semanticEqualDocs, svMutuallySupported, replayPgSnapshot } from './collab-canary-verify.worker';
import { encodeCanonicalUpdate } from './collab-replay-canary.service';
import { seedStateHash } from './canvas-doc-genesis';

const hashOf = (doc: Y.Doc): string => seedStateHash(encodeCanonicalUpdate(doc)!);

/** 同内容节点帧（独立 client——frameOf 同族）。 */
const nodeFrame = (key: string, model: string): Uint8Array => {
  const d = new Y.Doc();
  const node = new Y.Map(); const data = new Y.Map();
  data.set('model', model);
  node.set('type', 'textInput'); node.set('data', data);
  (d.getMap('nodes') as Y.Map<unknown>).set(key, node);
  return Y.encodeStateAsUpdate(d);
};

describe('C2-2b canary verify 纯判定面（红⑥-a 语义兜底构造）', () => {
  it('红⑥-a-① 同帧集不同应用序：encodeCanonicalUpdate hash 恒等（Yjs 确定性——同 op 集⇒同编码）+SV 互支成立+语义相等', () => {
    const f1 = nodeFrame('k1', 'm-1');
    const f2 = nodeFrame('k2', 'm-2');
    const a = new Y.Doc(); Y.applyUpdate(a, f1); Y.applyUpdate(a, f2);
    const b = new Y.Doc(); Y.applyUpdate(b, f2); Y.applyUpdate(b, f1);
    expect(hashOf(a)).toBe(hashOf(b));   // 同 op 集=hash 主判绿（重排不产生编码差异）
    expect(svMutuallySupported(Buffer.from(Y.encodeStateVector(a)), b)).toBe(true);
    expect(semanticEqualDocs(a, b)).toBe(true);
  });

  it('红⑥-a-② 同逻辑态不同 op 集（k1 两跳 vs 直达）：hash 不等而 semanticEqualDocs=true——语义兜底「语义相等不 freeze」工具面', () => {
    const a = new Y.Doc();   // k1: set model=v1 → set model=v2（同 client 两跳）
    Y.applyUpdate(a, nodeFrame('k1', 'v1'));
    ((a.getMap('nodes').get('k1') as Y.Map<unknown>).get('data') as Y.Map<unknown>).set('model', 'v2');
    const b = new Y.Doc();   // k1: 直接 v2（单跳——同逻辑态压缩 op 集）
    Y.applyUpdate(b, nodeFrame('k1', 'v2'));
    expect(((a.getMap('nodes').get('k1') as Y.Map<unknown>).get('data') as Y.Map<unknown>).get('model')).toBe('v2');
    expect(((b.getMap('nodes').get('k1') as Y.Map<unknown>).get('data') as Y.Map<unknown>).get('model')).toBe('v2');
    expect(hashOf(a)).not.toBe(hashOf(b));   // 「同逻辑状态不同 integration order→hash 可能不等」实证
    expect(semanticEqualDocs(a, b)).toBe(true);   // 语义兜底：节点/边 canonical JSON 深比等
    // SV 互支边界登记：op 集差异（压缩历史/重打 client）语义等而 SV 判 false——worker 侧判据的
    // 保守面（生产 same-generation 重放=同 op 集恒走互支成立档）
    expect(svMutuallySupported(Buffer.from(Y.encodeStateVector(a)), b)).toBe(false);
  });

  it('svMutuallySupported：重放缺帧（删行形态——SV 少 client clock）→ false（mismatch 判据）', () => {
    const a = new Y.Doc();
    Y.applyUpdate(a, nodeFrame('k1', 'm-1'));
    Y.applyUpdate(a, nodeFrame('k2', 'm-2'));
    const partial = new Y.Doc();
    Y.applyUpdate(partial, nodeFrame('k1', 'm-1'));   // k2 帧被删（注入删行）
    expect(svMutuallySupported(Buffer.from(Y.encodeStateVector(a)), partial)).toBe(false);
  });

  it('replayPgSnapshot：state=null 全量重放+state 铺底+增量按序；预算超时 throw（skip-budget 判据）', () => {
    const f1 = nodeFrame('r1', 'm-1');
    const f2 = nodeFrame('r2', 'm-2');
    const doc = replayPgSnapshot(null, [Buffer.from(f1), Buffer.from(f2)], 10_000);
    expect((doc.getMap('nodes').size)).toBe(2);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    doc.destroy();
    const doc2 = replayPgSnapshot(state, [Buffer.from(nodeFrame('r3', 'm-3'))], 10_000);
    expect(doc2.getMap('nodes').size).toBe(3);
    doc2.destroy();
    // 预算超时（budget=0——首 64 帧检查点即超）：64+ 帧大 doc 确定性触发
    const many = Array.from({ length: 130 }, (_, i) => Buffer.from(nodeFrame(`x${i}`, `m-${i}`)));
    expect(() => replayPgSnapshot(null, many, 0)).toThrow(/replay budget exceeded/);
  });

  it('encodeCanonicalUpdate：尺寸超限返回 null（捕获 hashSkipped/verify 降级 SV 判同口径）', () => {
    const doc = new Y.Doc();
    expect(encodeCanonicalUpdate(doc, 4)).not.toBeNull();   // 空 doc 编码 [0,0] 2 字节——阈值内
    const big = new Y.Doc();
    for (let i = 0; i < 100; i++) Y.applyUpdate(big, nodeFrame(`k${i}`, `m-${i}`));
    expect(encodeCanonicalUpdate(big, 4)).toBeNull();
    expect(encodeCanonicalUpdate(big)).not.toBeNull();
    expect(encodeCanonicalUpdate(doc)).toEqual(Buffer.from(Y.encodeStateAsUpdate(doc)));
    expect(createHash('sha256').update(encodeCanonicalUpdate(doc)!).digest('hex')).toBe(hashOf(doc));
  });
});
