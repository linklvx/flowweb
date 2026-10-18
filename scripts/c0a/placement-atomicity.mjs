// C0a spike：placement 原子性实验——两键形态（parentId/order 独立键）并发混键复现 vs 复合单键整值 LWW
// 对应 G17 先红判据：双客户端并发「移动+置顶」→ merge 后 parentId 来自 A/order 来自 B（跨 sibling 集 key）
import { createRequire } from 'module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const Y = require('yjs');

function makeDoc(clientId) {
  const doc = new Y.Doc();
  doc.clientID = clientId;
  const nodes = doc.getMap('nodes');
  doc.transact(() => {
    // 节点 n1 初始在 g1
    nodes.set('g1', new Y.Map([['type', 'group']]));
    nodes.set('g2', new Y.Map([['type', 'group']]));
    nodes.set('n1', new Y.Map([
      ['type', 'image'],
      ['parentId', 'g1'],
      ['order', 'K'],
    ]));
  }, 'seed');
  return doc;
}

// ── 形态一：两键（v4/v5 前 Z12 方案——parentId 与 order 分属两个 Y.Map 键）──
function twoKeyRun(clientA, clientB) {
  const base = makeDoc(1);
  const baseUpdate = Y.encodeStateAsUpdate(base);
  const A = new Y.Doc(); A.clientID = clientA;
  const B = new Y.Doc(); B.clientID = clientB;
  Y.applyUpdate(A, baseUpdate); Y.applyUpdate(B, baseUpdate);

  // A：把 n1 移到 g2（同事务写 parentId+order）
  A.transact(() => {
    const n1 = A.getMap('nodes').get('n1');
    n1.set('parentId', 'g2');
    n1.set('order', 'AG2KEY'); // g2 层的键
  }, 'move');
  // B 并发：在 g1 内置顶 n1（只写 order——B 未见过 A 的 move）
  B.transact(() => {
    const n1 = B.getMap('nodes').get('n1');
    n1.set('order', 'BG1TOP'); // g1 层顶键
  }, 'top');

  // 双向同步（CRDT merge）
  Y.applyUpdate(A, Y.encodeStateAsUpdate(B));
  Y.applyUpdate(B, Y.encodeStateAsUpdate(A));
  const n1 = A.getMap('nodes').get('n1');
  const n1b = B.getMap('nodes').get('n1');
  const parentId = n1.get('parentId');
  const order = n1.get('order');
  const converged = parentId === n1b.get('parentId') && order === n1b.get('order');
  // 混键判定：parentId 的写者与 order 的写者不同 → 跨 sibling 集 order
  const parentIdWriter = parentId === 'g2' ? 'A' : 'B';
  const orderWriter = order === 'AG2KEY' ? 'A' : (order === 'BG1TOP' ? 'B' : '?');
  return {
    form: 'two-key',
    clients: `${clientA}/${clientB}`,
    parentId, order, converged,
    mixed: parentIdWriter !== orderWriter,
    outcome: `parentId=${parentId}(写者${parentIdWriter}) order=${order}(写者${orderWriter})`,
  };
}

// ── 形态二：复合单键（v6 Z12——placement 整值）──
function compositeRun(clientA, clientB) {
  const doc = new Y.Doc(); doc.clientID = 1;
  doc.getMap('nodes').set('g1', new Y.Map([['type', 'group']]));
  doc.getMap('nodes').set('g2', new Y.Map([['type', 'group']]));
  doc.getMap('nodes').set('n1', new Y.Map([
    ['type', 'image'],
    ['placement', { parentId: 'g1', order: 'K' }],
  ]));
  const baseUpdate = Y.encodeStateAsUpdate(doc);
  const A = new Y.Doc(); A.clientID = clientA;
  const B = new Y.Doc(); B.clientID = clientB;
  Y.applyUpdate(A, baseUpdate); Y.applyUpdate(B, baseUpdate);

  A.transact(() => {
    A.getMap('nodes').get('n1').set('placement', { parentId: 'g2', order: 'AG2KEY' });
  }, 'move');
  B.transact(() => {
    B.getMap('nodes').get('n1').set('placement', { parentId: 'g1', order: 'BG1TOP' });
  }, 'top');

  Y.applyUpdate(A, Y.encodeStateAsUpdate(B));
  Y.applyUpdate(B, Y.encodeStateAsUpdate(A));
  const p = A.getMap('nodes').get('n1').get('placement');
  const pb = B.getMap('nodes').get('n1').get('placement');
  const writer = p.parentId === 'g2' ? 'A' : 'B';
  const paired = (writer === 'A' && p.order === 'AG2KEY') || (writer === 'B' && p.order === 'BG1TOP');
  return {
    form: 'composite',
    clients: `${clientA}/${clientB}`,
    placement: JSON.stringify(p),
    converged: JSON.stringify(p) === JSON.stringify(pb),
    paired, // 整值必配对——不可能 parentId 来自 A 而 order 来自 B
    outcome: `placement 整值来自写者 ${writer}（parentId+order 同源配对）`,
  };
}

console.log('── 形态一：两键（parentId/order 独立 Y.Map 键）──');
for (const [a, b] of [[100, 200], [200, 100], [7, 999], [999, 7]]) {
  console.log(JSON.stringify(twoKeyRun(a, b)));
}
console.log('\n── 形态二：复合单键（placement 整值）──');
for (const [a, b] of [[100, 200], [200, 100], [7, 999], [999, 7]]) {
  console.log(JSON.stringify(compositeRun(a, b)));
}
