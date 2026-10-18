// C0a spike：beforeSync 入口 guard 路径解析原型（v2——origin 链解析版）
// 编码规律（一手探明）：同事务首 item 携带 parent（root YKey 或类型持有 item 的 ID）+parentSub；
//   跨事务同 key 写省略 parent，仅带 origin（同 key 左邻 item ID）——须经 origin 链+live store 反查推导。
// 嵌套类型 ID == 持有它的 item 的 id（种子帧实证：parent ID(…:0) 指向 nodes.set('n1') 的 item）。
// 判据：正例矩阵零误报+坏帧检出+每帧 CPU 达标。
import { createRequire } from 'module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const Y = require('yjs');

function buildDoc(nNodes = 50, seedCapture) {
  const doc = new Y.Doc();
  const nodes = doc.getMap('nodes');
  if (seedCapture) doc.on('update', (u) => seedCapture.push(u));
  doc.transact(() => {
    nodes.set('g1', new Y.Map([['type', 'group'], ['placement', { parentId: null, order: 'K' }]]));
    for (let i = 0; i < nNodes; i++) {
      nodes.set(`n${i}`, new Y.Map([
        ['type', 'image'],
        ['placement', { parentId: i % 2 ? 'g1' : null, order: `K${i}` }],
        ['position', { x: i, y: i }],
        ['data', new Y.Map([['fileId', `m${i}`], ['content', 'x']])],
      ]));
    }
  }, 'seed');
  return doc;
}

/** key 最新 item（content.type === 当前类型；其 id 即后续 parent 引用的类型 ID） */
function holderItem(parentMap, key) {
  let it = parentMap._map.get(key);
  return it ?? null;
}

/** live 索引：类型 ID → 路径 + 类型对象 → 路径（删除反查用） */
function buildIndex(doc) {
  const idIndex = new Map();   // "client:clock" → {kind, nodeId}
  const typeIndex = new Map(); // 类型对象 → {kind, nodeId}
  const nodes = doc.getMap('nodes');
  typeIndex.set(nodes, { kind: 'root' });
  for (const [nid, m] of nodes.entries()) {
    if (!(m instanceof Y.Map)) continue;
    const hi = holderItem(nodes, nid);
    if (hi?.id) idIndex.set(`${hi.id.client}:${hi.id.clock}`, { kind: 'node', nodeId: nid });
    typeIndex.set(m, { kind: 'node', nodeId: nid });
    const dm = m.get('data');
    if (dm instanceof Y.Map) {
      const dh = holderItem(m, 'data');
      if (dh?.id) idIndex.set(`${dh.id.client}:${dh.id.clock}`, { kind: 'data', nodeId: nid });
      typeIndex.set(dm, { kind: 'data', nodeId: nid });
    }
  }
  return { idIndex, typeIndex };
}

const ORDER_RE = /^[0-9A-V]{1,128}$/;
const SERVER_ONLY_DATA_KEYS = new Set(['natural', 'resultUrl', 'videoUrl', 'result', 'errorCode']);

/** live store 二分：ID → item */
function storeLookup(doc, id) {
  const list = doc.store.clients.get(id.client);
  if (!list) return null;
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const st = list[mid];
    const stEnd = st.id.clock + (st.length ?? 1);
    if (stEnd <= id.clock) lo = mid + 1;
    else if (st.id.clock > id.clock) hi = mid - 1;
    else return st;
  }
  return null;
}

/**
 * 解析单个（未集成）struct 的 {parentRef, parentSub}：
 * 有 parent 直接用；无 parent 则沿 origin（同 key 左邻）递归——intra 帧内 struct 或 live store item。
 */
function resolveParentInfo(struct, intraById, doc) {
  if (struct.parent != null || struct.parentSub != null) {
    return { parentRef: struct.parent, parentSub: struct.parentSub };
  }
  const seen = new Set();
  let cur = struct;
  while (cur.origin != null) {
    const key = `${cur.origin.client}:${cur.origin.clock}`;
    if (seen.has(key)) return { parentRef: null, parentSub: null, unresolved: 'cycle' };
    seen.add(key);
    const next = intraById.get(key) ?? storeLookup(doc, cur.origin);
    if (!next) return { parentRef: null, parentSub: null, unresolved: 'origin-miss' };
    if (next.parent != null || next.parentSub != null) {
      return { parentRef: next.parent, parentSub: next.parentSub };
    }
    cur = next;
  }
  return { parentRef: null, parentSub: null, unresolved: 'no-origin' };
}

/** parentRef（string YKey | ID | live 类型对象）+parentSub → 结构化路径 */
function toPath(parentRef, parentSub, intraTypes, idIndex, typeIndex) {
  if (typeof parentRef === 'string') {
    return parentRef === 'nodes' ? { kind: 'root', key: parentSub } : { kind: 'otherMap', map: parentRef, key: parentSub };
  }
  if (parentRef && typeof parentRef === 'object') {
    if (parentRef.constructor?.name === 'ID') {
      const k = `${parentRef.client}:${parentRef.clock}`;
      const hit = intraTypes.get(k) ?? idIndex.get(k);
      return hit ? { ...hit, key: parentSub } : { kind: 'unknownParent', id: k, key: parentSub };
    }
    const hit = typeIndex.get(parentRef);
    return hit ? { ...hit, key: parentSub } : { kind: 'unknownType', key: parentSub };
  }
  return { kind: 'unresolved', key: parentSub };
}

/** guard 解析器：update 字节 → 违规清单（正例零误报） */
function resolveUpdate(update, doc, prebuiltIndex) {
  const violations = [];
  const { idIndex, typeIndex } = prebuiltIndex ?? buildIndex(doc);
  const { structs, ds } = Y.decodeUpdate(update);
  const intraById = new Map();   // 帧内 struct by id
  const intraTypes = new Map();  // 帧内新建类型 id → 路径（其持有 item 的 id）
  const writtenKeys = new Set(); // 同帧覆写豁免：Y.Map set=删旧+加新——DS 中的旧 item 键若同帧重写=覆写非删除
  for (const s of structs) intraById.set(`${s.id.client}:${s.id.clock}`, s);

  for (const s of structs) {
    const { parentRef, parentSub } = resolveParentInfo(s, intraById, doc);
    const path = toPath(parentRef, parentSub, intraTypes, idIndex, typeIndex);
    if (process.env.GUARD_DEBUG) console.log('  [dbg] struct', `${s.id.client}:${s.id.clock}`, '→ path', JSON.stringify(path), 'val', JSON.stringify(s.content?.arr?.[0])?.slice(0, 30));
    // 帧内新建类型注册：content 为 ContentType ⇒ 该 item 持有新 Y.Map，后续 parent ID 指向它
    if (s.content?.constructor?.name === 'ContentType' && s.id) {
      const k = `${s.id.client}:${s.id.clock}`;
      if (path.kind === 'root') intraTypes.set(k, { kind: 'node', nodeId: path.key });
      else if (path.kind === 'node') intraTypes.set(k, { kind: 'data', nodeId: path.nodeId });
    }
    if ((path.kind === 'node' || path.kind === 'data') && path.key != null && path.nodeId != null) {
      writtenKeys.add(`${path.nodeId}:${path.key}`);
    }
    // ── 策略 ──
    const val = s.content?.arr?.[0];
    if (path.kind === 'node' && path.key === 'placement') {
      const order = val && typeof val === 'object' ? val.order : undefined;
      if (typeof order !== 'string' || !ORDER_RE.test(order) || order.endsWith('0')) {
        violations.push({ path: `nodes.${path.nodeId}.placement`, op: 'set', value: JSON.stringify(val)?.slice(0, 50), reason: 'placement 格式非法' });
      }
    } else if (path.kind === 'data' && path.key != null && SERVER_ONLY_DATA_KEYS.has(path.key)) {
      violations.push({ path: `nodes.${path.nodeId}.data.${path.key}`, op: 'set', value: JSON.stringify(val)?.slice(0, 50), reason: '客户端写服务端域键' });
    }
  }

  // ── 删除区间 → live store 反查（整节点删除允许；placement 键删除拒绝）──
  if (ds?.clients) {
    for (const [client, ranges] of ds.clients.entries()) {
      for (const range of ranges) {
        const item = storeLookup(doc, { client, clock: range.clock });
        if (!item) continue;
        const p = item.parent;
        if (process.env.GUARD_DEBUG) console.log('  [dbg] ds', `${client}:${range.clock}+${range.len}`, '→ item', item.constructor.name, 'parentSub', JSON.stringify(item.parentSub), 'p-is-root', p === doc.getMap('nodes'), 'tp', JSON.stringify(p ? typeIndex.get(p) : null), 'written', JSON.stringify([...writtenKeys].filter((k) => k.includes('placement'))));
        if (p === doc.getMap('nodes')) continue; // 整节点删除（nodes.<id> 持有 item）——允许
        const tp = p ? typeIndex.get(p) : null;
        if (tp?.kind === 'node' && item.parentSub === 'placement' && !writtenKeys.has(`${tp.nodeId}:placement`)) {
          violations.push({ path: `nodes.${tp.nodeId}.placement`, op: 'delete', value: '', reason: 'placement 键删除（整值写语义外）' });
        }
      }
    }
  }
  return violations;
}

// ── 场景矩阵（忠实时序：server 重放 doc——每帧先 resolve（pre-apply）后 apply）──
console.log('═══ 四形态+正例矩阵+坏帧注入 ═══');
{
  const seedCap = [];
  const client = buildDoc(50, seedCap); // 「客户端」doc：seed 帧单独捕获
  const frames = [];
  client.on('update', (u) => frames.push(u));

  // 正例①：新建节点（带合法 placement+data）
  client.transact(() => {
    client.getMap('nodes').set('new1', new Y.Map([
      ['type', 'image'], ['placement', { parentId: null, order: 'K' }],
      ['position', { x: 0, y: 0 }], ['data', new Y.Map([['fileId', 'mX']])],
    ]));
  }, 'c');
  // 正例②：合法信封写（跨帧同 key——origin 链路径）
  client.getMap('nodes').get('n3').set('placement', { parentId: 'g1', order: 'KAA' });
  // 正例③：合法 data 写（新 key+已有 key）
  client.getMap('nodes').get('n3').get('data').set('content', 'hello');
  client.getMap('nodes').get('n3').get('data').set('fileId', 'mY');
  // 正例④：position 写
  client.getMap('nodes').get('n3').set('position', { x: 9, y: 9 });

  // 坏帧①：placement 非法 order
  client.getMap('nodes').get('n5').set('placement', { parentId: null, order: 'BAD-KEY!' });
  // 坏帧②：客户端写 data.natural（服务端域键）
  client.getMap('nodes').get('n5').get('data').set('natural', { mediaId: 'mZ', width: 100, height: 50 });
  // 坏帧③：删除 placement 键
  client.getMap('nodes').get('n6').delete('placement');
  // 正例⑤：整节点删除
  client.getMap('nodes').delete('n7');

  // server doc：seed 起步，逐帧 pre-apply resolve → apply（生产 guard 时序等价）
  const server = new Y.Doc();
  Y.applyUpdate(server, seedCap[0]);
  const tags = ['正①新建节点', '正②信封写(跨帧)', '正③data写content', '正③data写fileId(跨帧)', '正④position写', '坏①placement非法', '坏②客户端写natural', '坏③删placement键', '正⑤整节点删除'];
  let pass = 0, miss = 0, fp = 0;
  frames.forEach((u, i) => {
    const index = buildIndex(server); // 每帧重建（生产=增量维护；重建仅影响成本口径不影响判定）
    const v = resolveUpdate(u, server, index);
    Y.applyUpdate(server, u);
    const expectBad = tags[i]?.startsWith('坏');
    if (expectBad && v.length > 0) { pass++; console.log(`✓ 检出 [${tags[i]}]:`, JSON.stringify(v)); }
    else if (expectBad && v.length === 0) { miss++; console.log(`✗ 漏检 [${tags[i]}]`); }
    else if (!expectBad && v.length > 0) { fp++; console.log(`✗ 误报 [${tags[i]}]:`, JSON.stringify(v)); }
    else { pass++; console.log(`✓ 放行 [${tags[i]}]`); }
  });
  console.log(`\n矩阵结果：正确 ${pass} / 漏检 ${miss} / 误报 ${fp}`);

  // ── CPU：单 op 帧 vs 全量帧 + 索引构建成本 ──
  console.log('\n═══ CPU 实测 ═══');
  const docBig = buildDoc(1000);
  const tIdx0 = performance.now();
  const idxBig = buildIndex(docBig);
  console.log(`索引构建（1000 节点，一次性）: ${(performance.now() - tIdx0).toFixed(2)}ms`);
  const cap = [];
  docBig.on('update', (u) => cap.push(u));
  docBig.getMap('nodes').get('n1').set('placement', { parentId: 'g1', order: 'KAA' });
  const singleOp = cap[0];
  const fullState = Y.encodeStateAsUpdate(docBig);

  function cpu(name, bytes, target, idx, iters) {
    const t = [];
    for (let i = 0; i < iters; i++) { const t0 = performance.now(); resolveUpdate(bytes, target, idx); t.push(performance.now() - t0); }
    t.sort((a, b) => a - b);
    console.log(`${name}（${bytes.byteLength}B）: p50=${t[Math.floor(t.length * 0.5)].toFixed(3)}ms p95=${t[Math.floor(t.length * 0.95)].toFixed(3)}ms`);
  }
  cpu('单 op 帧（1 键 placement 写）', singleOp, docBig, idxBig, 200);
  cpu('全量帧（1000 节点 SyncStep2 形态）', fullState, docBig, idxBig, 20);
}
