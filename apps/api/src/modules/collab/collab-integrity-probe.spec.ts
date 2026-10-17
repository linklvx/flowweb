// apps/api/src/modules/collab/collab-integrity-probe.spec.ts
// Y0c T22（Z111 完整性巡检——纯函数面单测）：PG 快照重放与 SV 对拍逻辑的判别力。
// 装置面（collab-soak.mjs integrityProbe 消费 dist 本模块）归脚本自证；此处锚三性质：
//   ①重放保真：state+updates 全重放 ⇒ 与源 doc SV 全等+内容一致；
//   ②漂移可检：内存 doc 有 PG 未落内容（store 丢失/滞后）⇒ 对拍 false——A7a 盲区的唯一探测手段；
//   ③边界：空 PG⇒空 doc（SV 长度 0）；同长异字节⇒false。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { replayPgSnapshot, stateVectorsEqual } from './collab-integrity-probe';

describe('Y0c T22 Z111：integrityProbe 纯函数面（SV 对拍）', () => {
  it('①重放保真：快照行+增量行全重放 ⇒ SV 与源 doc 全等+内容一致（增量行=对前态 SV 的 diff——repo 行同构）', () => {
    const src = new Y.Doc();
    src.getMap('nodes').set('n1', new Y.Map([['x', 1]]));
    const state = Buffer.from(Y.encodeStateAsUpdate(src));   // 快照行形态（compact 后）
    const svAfterSnapshot = Y.encodeStateVector(src);
    src.getMap('nodes').set('n2', new Y.Map([['x', 2]]));
    const increments = [Buffer.from(Y.diffUpdate(Y.encodeStateAsUpdate(src), svAfterSnapshot))];   // 增量行=快照后差量（repo append 行同构）

    const revived = replayPgSnapshot(state, increments);
    expect(stateVectorsEqual(Y.encodeStateVector(revived), Y.encodeStateVector(src))).toBe(true);
    expect((revived.getMap('nodes').get('n1') as Y.Map<unknown>).get('x')).toBe(1);
    expect((revived.getMap('nodes').get('n2') as Y.Map<unknown>).get('x')).toBe(2);
  });

  it('②漂移可检：内存 doc 多一次写（PG 未落）⇒ 对拍 false；内容追平后翻真（巡检语义=观测非门禁的单变量演示）', () => {
    const pg = new Y.Doc();
    pg.getMap('nodes').set('k1', new Y.Map([['v', 1]]));
    const pgRows = [Buffer.from(Y.encodeStateAsUpdate(pg))];
    const revived = replayPgSnapshot(null, pgRows);   // 无快照行——纯增量形态

    const live = new Y.Doc();
    Y.applyUpdate(live, pgRows[0]);
    live.getMap('nodes').set('k2', new Y.Map([['v', 2]]));   // 内存有、PG 无（store 丢失/滞后——A7a 盲区形态）
    expect(stateVectorsEqual(Y.encodeStateVector(revived), Y.encodeStateVector(live))).toBe(false);

    Y.applyUpdate(pg, Y.encodeStateAsUpdate(live));   // PG 追平（下一轮 store 后）
    const revived2 = replayPgSnapshot(null, [...pgRows, Buffer.from(Y.encodeStateAsUpdate(live))]);
    expect(stateVectorsEqual(Y.encodeStateVector(revived2), Y.encodeStateVector(live))).toBe(true);
  });

  it('③边界：空 PG⇒空 doc（SV 与新空 doc 全等）；同长异字节⇒false；字节序等同⇒true', () => {
    const empty = replayPgSnapshot(null, []);
    expect(stateVectorsEqual(Y.encodeStateVector(empty), Y.encodeStateVector(new Y.Doc()))).toBe(true);
    // clientID 固定为同 varint 长的两个值（42/43 各 1 字节）：随机 clientID 高位字节数不同则 SV 编码
    // 长度不同（跨 varint 边界），「同长」前提靠运气=固有 flaky（T43 出口轮两次实证）。原注释「同客户端」
    // 有误——两有内容 doc 的 SV 各含自身 clientID；同长异字节档=异 clientID 同 varint 长+同 clock。
    const a = new Y.Doc(); a.clientID = 42; a.getMap('nodes').set('k', new Y.Map([['x', 1]]));
    const b = new Y.Doc(); b.clientID = 43; b.getMap('nodes').set('k', new Y.Map([['x', 2]]));
    const svA = Y.encodeStateVector(a); const svB = Y.encodeStateVector(b);
    expect(svA.length).toBe(svB.length);                                   // 同 varint 长异 clientID 同 clock——同长异字节档（构造保证，字节循环路径必被执行）
    expect(Buffer.compare(Buffer.from(svA), Buffer.from(svB))).not.toBe(0);
    expect(stateVectorsEqual(svA, svB)).toBe(false);
    expect(stateVectorsEqual(svA, svA)).toBe(true);
  });
});
