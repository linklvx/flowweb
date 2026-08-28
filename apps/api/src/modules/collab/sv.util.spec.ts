import * as Y from 'yjs';
import { svSatisfied, decodeStateVector } from './sv.util';

describe('svSatisfied', () => {
  it('server 完全覆盖 required 时 true', () => {
    const doc = new Y.Doc();
    doc.getMap('nodes').set('a', 1);
    doc.getMap('nodes').set('a', 2); // client clock 前进到 2
    const sv = Y.encodeStateVector(doc);
    expect(svSatisfied(sv, sv)).toBe(true);
  });

  it('server 落后时 false', () => {
    const doc1 = new Y.Doc();
    doc1.getMap('nodes').set('a', 1);
    const doc2 = new Y.Doc();
    doc2.getMap('nodes').set('b', 1);
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
    doc2.getMap('nodes').set('c', 1); // doc2 领先
    expect(svSatisfied(Y.encodeStateVector(doc2), Y.encodeStateVector(doc1))).toBe(true);
    expect(svSatisfied(Y.encodeStateVector(doc1), Y.encodeStateVector(doc2))).toBe(false);
  });

  it('decodeStateVector 解出 client→clock', () => {
    const doc = new Y.Doc();
    doc.getMap('nodes').set('a', 1);
    const m = decodeStateVector(Y.encodeStateVector(doc));
    expect(m.size).toBe(1);
    expect([...m.values()][0]).toBe(1);
  });
});
