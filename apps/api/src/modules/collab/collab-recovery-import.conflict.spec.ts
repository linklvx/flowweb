// apps/api/src/modules/collab/collab-recovery-import.conflict.spec.ts
// Y1c T25 收口批 I-3 真因回归锁：Y.Map 同 key 冲突 clientID 大者胜——随机 client 的替换项
// 对既有项**五五开**败北（delete+tombstone 后新项不可达=替换静默丢失；60 次微基准 100% 相关
// ——tempClient<liveClient 恒空键）。修=rebuildCanvasDoc opts.clientID 钉「高于 live 全部在册
// client 的空闲位」（pickWriterClientAbove 同式）——本用例 40 次随机 regime 全胜为锁。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { rebuildCanvasDoc, type CanvasDocument } from '@flowweb/shared';

const PROMPT = { $yjs: 'map', entries: { text: { $yjs: 'text', delta: [{ insert: 'recover' }] } } };

const envelopeNode = { id: 'n-exist', type: 'textInput', position: { x: 1, y: 2 }, data: { prompt: PROMPT } };

function pickWriterAbove(live: Y.Doc): number {
  // yjs 13.6：decodeStateVector 返回 Map<client, clock> 本体（无 .clients 壳——防御分支恒空=恒钉
  // 0xFFFFFFFF 的回归锚：二次 import 同 client 同 clock 被 SV 滤空=commitDiff 空）
  const taken = Y.decodeStateVector(Y.encodeStateVector(live)) as unknown as Map<number, number>;
  let c = 0xFFFFFFFF;
  while (taken.has(c) && c > 0) c -= 1;
  return c;
}

describe('T25 收口 I-3 真因：replace 冲突 clientID 规（钉高位 client 恒胜）', () => {
  it('40 次随机 regime：delete+tombstone 后钉位 client 替换项恒达（键非空+内容=替换值）', () => {
    for (let i = 0; i < 40; i++) {
      const live = new Y.Doc();
      live.transact(() => {
        const m = new Y.Map();
        m.set('type', 'textInput');
        m.set('data', new Y.Map([['prompt', 'seed']]));
        live.getMap('nodes').set('n-exist', m);
      });
      const candidate = new Y.Doc();
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(live));
      const temp = rebuildCanvasDoc({ nodes: [envelopeNode], edges: [], meta: {} } as unknown as CanvasDocument, { clientID: pickWriterAbove(live) });
      expect(temp.clientID).toBe(pickWriterAbove(live));
      candidate.transact(() => { candidate.getMap('nodes').delete('n-exist'); });
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(temp));
      expect([...candidate.getMap('nodes').keys()]).toEqual(['n-exist']);   // 未钉位时 ~50% 此处为 []（真因锚）
      const data = candidate.getMap('nodes').get('n-exist') as Y.Map<unknown>;
      expect((data.get('data') as Y.Map<unknown>).get('prompt')).toBeTruthy();
    }
  });

  it('live 侧同规则：commitDiff 应用到 live（随机 liveClient regime）替换恒胜', () => {
    for (let i = 0; i < 40; i++) {
      const live = new Y.Doc();
      live.transact(() => {
        const m = new Y.Map();
        m.set('type', 'textInput');
        m.set('data', new Y.Map([['prompt', 'seed']]));
        live.getMap('nodes').set('n-exist', m);
      });
      const candidate = new Y.Doc();
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(live));
      const temp = rebuildCanvasDoc({ nodes: [envelopeNode], edges: [], meta: {} } as unknown as CanvasDocument, { clientID: pickWriterAbove(live) });
      candidate.transact(() => { candidate.getMap('nodes').delete('n-exist'); });
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(temp));
      const diff = Y.encodeStateAsUpdate(candidate, Y.encodeStateVector(live));
      Y.applyUpdate(live, diff, 'import');
      const data = live.getMap('nodes').get('n-exist') as Y.Map<unknown>;
      expect((data.get('data') as Y.Map<unknown>).get('prompt')).toBeTruthy();
    }
  });
});
