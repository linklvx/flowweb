// apps/api/src/modules/collab/collab-document.service.spec.ts
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { CollabDocumentService } from './collab-document.service';

/** readDocCanvas 是纯读函数（只依赖 doc，不触 gateway）——装置传 {} 即可；
 *  private 方法经 as any 直调（R1a edges 形状语义锁）。 */
function buildDoc(): Y.Doc {
  const doc = new Y.Doc();
  const nodes = doc.getMap('nodes');
  for (const [id, x, y] of [['a', 0, 0], ['b', 100, 0]] as const) {
    const n = new Y.Map();
    n.set('type', 'textInput');
    const pos = new Y.Map();
    pos.set('x', x);
    pos.set('y', y);
    n.set('position', pos);
    const data = new Y.Map();
    data.set('text', id);
    n.set('data', data);
    nodes.set(id, n);
  }
  const edges = doc.getMap('edges');
  const e = new Y.Map();
  e.set('source', 'a');
  e.set('target', 'b');
  edges.set('e1', e);
  return doc;
}

describe('CollabDocumentService.readDocCanvas（R1a edges 单形状）', () => {
  it('readDocCanvas 输出边形状键集锁定（toEqual 键集敏感——语义锁不靠文本 grep）', () => {
    const service = new CollabDocumentService({} as any);
    const { edges } = (service as any).readDocCanvas(buildDoc());
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ id: 'e1', source: 'a', target: 'b' });   // 无双键名别名键
  });
});
