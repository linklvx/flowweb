// apps/web/src/stores/threadsStore.test.ts
// Y4b T10（plan 2026-11-22-y4b-annotation-security Task 10）：threadsStore 写链+投影测试。
// 施工单 Step 1 六档：主用例 / 未同步闸 / sessionUserId null 闸 / 清理分辨力（A14″）/
// 写前谓词单源自检 / 孤儿摘录 / 观察者只做投影（任何 origin 都从 doc 重算）。
// 测试夹具的 Y 容器只出现在测试文件（census 组㉓ 只扫生产面）；生产侧容器一律走 shared 工厂。
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { buildThreadComment, buildThreadEntry, encodeAnchorBase64, THREADS_ORIGIN } from '@flowweb/shared';
import {
  __resetThreadsStoreForTests,
  addComment,
  attachThreads,
  cleanupOrphans,
  createThread,
  deleteThread,
  setResolved,
  setSessionUserId,
  subscribeThreadsView,
  threadsView$,
} from './threadsStore';

/** 节点夹具：nodes[id] = { type:'textInput', data:{ content?: XmlFragment>XmlText>txt } } */
function addNode(doc: Y.Doc, nodeId: string, text?: string): Y.XmlText | null {
  doc.transact(() => {
    const node = new Y.Map<unknown>();
    node.set('type', 'textInput');
    const data = new Y.Map<unknown>();
    node.set('data', data);
    doc.getMap('nodes').set(nodeId, node);
    if (text !== undefined) {
      const frag = new Y.XmlFragment();
      data.set('content', frag);
      const xmlText = new Y.XmlText();
      frag.insert(0, [xmlText]);
      xmlText.insert(0, text);
    }
  }, 'test-node');
  const entry: unknown = doc.getMap('nodes').get(nodeId);
  if (!(entry instanceof Y.Map)) return null;
  const data: unknown = entry.get('data');
  if (!(data instanceof Y.Map)) return null;
  const frag: unknown = data.get('content');
  if (!(frag instanceof Y.XmlFragment)) return null;
  const first = frag.toArray()[0];
  return first instanceof Y.XmlText ? first : null;
}

function anchorAt(text: Y.XmlText, index: number): string {
  return encodeAnchorBase64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, index)));
}

interface SeedInit {
  id: string;
  nodeId: string;
  kind: 'node' | 'text';
  anchorStart?: string;
  anchorEnd?: string;
  resolved?: boolean;
  createdAt?: number;
  createdBy?: string;
  body?: string;
}

/** 直接 doc 写（远端/恢复形态）——绕过 store 写链，用于投影与清理夹具。 */
function seedThread(doc: Y.Doc, init: SeedInit): void {
  doc.transact(() => {
    const entry = buildThreadEntry({
      id: init.id,
      nodeId: init.nodeId,
      kind: init.kind,
      ...(init.kind === 'text' ? { anchorStart: init.anchorStart, anchorEnd: init.anchorEnd } : {}),
      resolved: init.resolved ?? false,
      createdAt: init.createdAt ?? 1000,
      createdBy: init.createdBy ?? 'u1',
    });
    doc.getMap('threads').set(init.id, entry);
    const comments = entry.get('comments');
    if (comments instanceof Y.Map) {
      comments.set(`c-${init.id}`, buildThreadComment({
        id: `c-${init.id}`,
        authorId: init.createdBy ?? 'u1',
        body: init.body ?? 'seed',
        createdAt: init.createdAt ?? 1000,
      }));
    }
  }, 'seed-remote');
}

describe('threadsStore（Y4b T10 写链+投影）', () => {
  afterEach(() => {
    __resetThreadsStoreForTests();
  });

  it('档①主用例：createThread 单事务写 envelope+comments 容器+首条评论（threads-user origin）', () => {
    const doc = new Y.Doc();
    attachThreads(doc, () => true);
    setSessionUserId('u1');
    const threads = doc.getMap('threads');
    expect(threads.size).toBe(0);
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => { origins.push(origin); });

    expect(createThread({ nodeId: 'n1', kind: 'node', body: 'hello' })).toBe(true);

    expect(origins).toEqual([THREADS_ORIGIN]);   // 单事务 threads-user origin（禁 ySyncPluginKey 混入）
    expect(threads.size).toBe(1);
    const [threadId, rawEntry] = [...threads.entries()][0];
    expect(typeof threadId).toBe('string');
    expect(rawEntry).toBeInstanceOf(Y.Map);
    const entry = rawEntry as Y.Map<unknown>;
    expect(entry.get('id')).toBe(threadId);
    expect(entry.get('nodeId')).toBe('n1');
    expect(entry.get('kind')).toBe('node');
    expect(entry.get('resolved')).toBe(false);
    expect(typeof entry.get('createdAt')).toBe('number');
    expect(entry.get('createdBy')).toBe('u1');
    expect(entry.get('anchorStart')).toBeUndefined();
    expect(entry.get('anchorEnd')).toBeUndefined();

    const rawComments = entry.get('comments');
    expect(rawComments).toBeInstanceOf(Y.Map);
    const comments = rawComments as Y.Map<unknown>;
    expect(comments.size).toBe(1);
    const [commentId, rawComment] = [...comments.entries()][0];
    expect(rawComment).toBeInstanceOf(Y.Map);
    const comment = rawComment as Y.Map<unknown>;
    expect(comment.get('id')).toBe(commentId);
    expect(comment.get('authorId')).toBe('u1');
    expect(comment.get('body')).toBe('hello');
  });

  it('档②未同步闸：getSynced=false → 五动作零事务（前四 false / cleanup -1）', () => {
    const doc = new Y.Doc();
    addNode(doc, 'n1');
    attachThreads(doc, () => false);
    setSessionUserId('u1');
    // 预置合法线程+孤儿（同步为假时五动作若有漏闸会真写/真删——分辨力）
    seedThread(doc, { id: 't1', nodeId: 'n1', kind: 'node', createdAt: 1000 });
    seedThread(doc, { id: 't-orphan', nodeId: 'gone', kind: 'node', createdAt: 1001 });
    const updates = vi.fn();
    doc.on('update', updates);

    expect(createThread({ nodeId: 'n1', kind: 'node', body: 'hello' })).toBe(false);
    expect(addComment('t1', 'reply')).toBe(false);
    expect(setResolved('t1', true)).toBe(false);
    expect(deleteThread('t1')).toBe(false);
    expect(cleanupOrphans()).toBe(-1);

    expect(updates).not.toHaveBeenCalled();
    expect(doc.getMap('threads').size).toBe(2);
    expect(doc.getMap('threads').has('t-orphan')).toBe(true);
  });

  it('档②′sessionUserId null 闸：五动作同样零事务全返 false/-1（null 直接先闸）', () => {
    const doc = new Y.Doc();
    addNode(doc, 'n1');
    attachThreads(doc, () => true);
    seedThread(doc, { id: 't1', nodeId: 'n1', kind: 'node', createdAt: 1000 });
    seedThread(doc, { id: 't-orphan', nodeId: 'gone', kind: 'node', createdAt: 1001 });
    setSessionUserId(null);
    const updates = vi.fn();
    doc.on('update', updates);

    expect(createThread({ nodeId: 'n1', kind: 'node', body: 'hello' })).toBe(false);
    expect(addComment('t1', 'reply')).toBe(false);
    expect(setResolved('t1', true)).toBe(false);
    expect(deleteThread('t1')).toBe(false);
    expect(cleanupOrphans()).toBe(-1);

    expect(updates).not.toHaveBeenCalled();
    expect(doc.getMap('threads').size).toBe(2);
    expect(doc.getMap('threads').has('t-orphan')).toBe(true);
  });

  it('档③清理分辨力（A14″）：补写发生在外层事务「开始前」（beforeTransaction），清理必须在该事务内重算', () => {
    const doc = new Y.Doc();
    addNode(doc, 'n2');
    attachThreads(doc, () => true);
    setSessionUserId('u1');
    seedThread(doc, { id: 't-orphan-a', nodeId: 'gone-a', kind: 'node', createdAt: 1000 });
    seedThread(doc, { id: 't-orphan-b', nodeId: 'gone-b', kind: 'node', createdAt: 1001 });
    seedThread(doc, { id: 't-keep', nodeId: 'n2', kind: 'node', createdAt: 1002 });

    // 分辨力关键（Y4b T10 评审核正后形态）：补写挂在**外层事务开始前**（beforeTransaction）。
    // 若实现「事务外先摘清单」（在函数入口、本外层事务开启之前算孤儿集），它会看到补写之前的旧态；
    // 若实现「事务内重算」（正确形态），它看到补写之后的新态。两者由此可区分。
    // 旧形态（补写放在外层 transact 的**回调内**）不可分辨——yjs 回调内写立即可见，入口前摘与
    // 回调内摘读到同一份数据（评审以 yjs 原生三态探针实证）。
    let restored = false;
    const restoreBeforeTx = () => {
      if (restored) return;
      restored = true;
      doc.off('beforeTransaction', restoreBeforeTx);
      const node = new Y.Map<unknown>();
      node.set('type', 'textInput');
      node.set('data', new Y.Map<unknown>());
      doc.getMap('nodes').set('gone-a', node);
      const entry = buildThreadEntry({ id: 't-new', nodeId: 'n2', kind: 'node', resolved: false, createdAt: 2000, createdBy: 'u1' });
      doc.getMap('threads').set('t-new', entry);
      const comments = entry.get('comments');
      if (comments instanceof Y.Map) {
        comments.set('c-t-new', buildThreadComment({ id: 'c-t-new', authorId: 'u1', body: '合法', createdAt: 2000 }));
      }
    };
    doc.on('beforeTransaction', restoreBeforeTx);

    const removed = cleanupOrphans();

    const threads = doc.getMap('threads');
    expect(removed, '仅删 gone-b（gone-a 的 node 已在事务开始前补回、t-new 合法）').toBe(1);
    expect(threads.has('t-orphan-a'), '补回者还在').toBe(true);
    expect(threads.has('t-new'), '新线程还在').toBe(true);
    expect(threads.has('t-keep')).toBe(true);
    expect(threads.has('t-orphan-b'), '另一条孤儿消失').toBe(false);
    expect(threads.size).toBe(3);
  });

  it('档④写前谓词单源自检：全空白 body → createThread 拒、零事务', () => {
    const doc = new Y.Doc();
    attachThreads(doc, () => true);
    setSessionUserId('u1');
    const updates = vi.fn();
    doc.on('update', updates);

    expect(createThread({ nodeId: 'n1', kind: 'node', body: '   ' })).toBe(false);
    expect(updates).not.toHaveBeenCalled();
    expect(doc.getMap('threads').size).toBe(0);
  });

  it('档⑤孤儿摘录：text 锚落位异节点片段 → orphan 组（已解决仍孤儿优先）+ 摘录 ≤80 + 文档不改', () => {
    const doc = new Y.Doc();
    const n1Text = addNode(doc, 'n1', 'node one text');
    const n2Text = addNode(doc, 'n2', 'other node text');
    const n3Text = addNode(doc, 'n3', 'x'.repeat(100));
    if (!n1Text || !n2Text || !n3Text) throw new Error('节点文本夹具未就绪');

    attachThreads(doc, () => true);
    setSessionUserId('u1');
    // 锚从 n2 的文本解出，但线程挂在 n1 → 落位异节点片段 = 孤儿
    expect(createThread({
      nodeId: 'n1',
      kind: 'text',
      anchorStart: anchorAt(n2Text, 0),
      anchorEnd: anchorAt(n2Text, 5),
      body: '跨节点',
    })).toBe(true);
    // 存活长锚（同节点 0..100）→ 摘录截断 80
    expect(createThread({
      nodeId: 'n3',
      kind: 'text',
      anchorStart: anchorAt(n3Text, 0),
      anchorEnd: anchorAt(n3Text, 100),
      body: '长摘录',
    })).toBe(true);

    const threadIds = [...doc.getMap('threads').keys()];
    const orphanId = threadIds[0];
    const activeId = threadIds[1];
    if (!orphanId || !activeId) throw new Error('createThread 未写入两条线程');
    expect(setResolved(orphanId, true)).toBe(true);   // 已解决但孤儿优先级更高

    const before = Y.encodeStateAsUpdate(doc);
    const view = threadsView$();
    const after = Y.encodeStateAsUpdate(doc);

    expect(after).toEqual(before);                    // 纯读投影无写回
    expect(view.orphan.map((t) => t.id)).toEqual([orphanId]);
    expect(view.resolved).toHaveLength(0);            // resolved && orphan → 孤儿组
    expect(view.active).toHaveLength(1);
    const group = view.active[0];
    const orphanItem = view.orphan[0];
    const activeItem = group.threads[0];
    expect(group.nodeId).toBe('n3');
    expect(group.threads.map((t) => t.id)).toEqual([activeId]);
    expect(orphanItem.excerpt).toBe('other');
    expect(activeItem.excerpt).toHaveLength(80);
    expect(doc.getMap('threads').has(orphanId)).toBe(true);   // 孤儿不自动删
  });

  it('档⑥观察者只做投影：任何 origin（含 threads-user）都从 doc 重算视图+广播；组内 createdAt 升序相同按 id', () => {
    const doc = new Y.Doc();
    const n1Text = addNode(doc, 'n1', 'node one text');
    addNode(doc, 'n2');
    if (!n1Text) throw new Error('n1 文本夹具未就绪');
    attachThreads(doc, () => true);
    setSessionUserId('u1');
    const listener = vi.fn();
    const unsubscribe = subscribeThreadsView(listener);

    // remote origin 直接写入（含 createdAt 相同的 id 平局排序）
    doc.transact(() => {
      for (const init of [
        { id: 't-b', nodeId: 'n1', kind: 'node' as const, createdAt: 2000 },
        { id: 't-c', nodeId: 'n1', kind: 'node' as const, createdAt: 1000 },
        { id: 't-a', nodeId: 'n1', kind: 'node' as const, createdAt: 1000 },
      ]) {
        const entry = buildThreadEntry({ id: init.id, nodeId: 'n1', kind: 'node', resolved: false, createdAt: init.createdAt, createdBy: 'u1' });
        doc.getMap('threads').set(init.id, entry);
        const comments = entry.get('comments');
        if (comments instanceof Y.Map) {
          comments.set(`c-${init.id}`, buildThreadComment({ id: `c-${init.id}`, authorId: 'u1', body: 'seed', createdAt: init.createdAt }));
        }
      }
    }, 'remote');

    expect(listener).toHaveBeenCalled();
    const view1 = threadsView$();
    expect(view1.active.map((g) => g.nodeId)).toEqual(['n1']);
    expect(view1.active[0]?.threads.map((t) => t.id)).toEqual(['t-a', 't-c', 't-b']);
    expect(view1.orphan).toHaveLength(0);
    expect(view1.resolved).toHaveLength(0);

    // threads-user 写（store 自身）→ 观察者同步更新（不跳过自己的 origin）
    const callsBefore = listener.mock.calls.length;
    expect(createThread({ nodeId: 'n2', kind: 'node', body: 'store 写' })).toBe(true);
    expect(listener.mock.calls.length).toBeGreaterThan(callsBefore);
    const view2 = threadsView$();
    expect(view2.active.map((g) => g.nodeId)).toEqual(['n1', 'n2']);
    expect(view2.active[1]?.threads).toHaveLength(1);

    // 任意非 threads-user origin 的远端删除同样重算
    const createdId = view2.active[1]?.threads[0]?.id;
    if (!createdId) throw new Error('store 写后投影缺失新线程');
    doc.transact(() => {
      doc.getMap('threads').delete(createdId);
    }, 'remote-2');
    expect(threadsView$().active.map((g) => g.nodeId)).toEqual(['n1']);

    // 文本锚 content 片段 observeDeep：文本编辑（远端）→ 摘录重算（±3 字符不变不在此档）
    expect(createThread({
      nodeId: 'n1', kind: 'text',
      anchorStart: anchorAt(n1Text, 0), anchorEnd: anchorAt(n1Text, 4),
      body: '文本锚',
    })).toBe(true);
    const callsBeforeEdit = listener.mock.calls.length;
    doc.transact(() => { n1Text.insert(2, 'ZZ'); }, 'remote-3');
    expect(listener.mock.calls.length).toBeGreaterThan(callsBeforeEdit);
    const anchorItem = threadsView$().active
      .find((g) => g.nodeId === 'n1')?.threads.find((t) => t.kind === 'text');
    expect(anchorItem?.excerpt).toBe('noZZde');

    // nodes 键增删 observe（浅层）：删节点 → 该 node 全部线程落孤儿组，投影零写回
    doc.transact(() => { doc.getMap('nodes').delete('n1'); }, 'remote-4');
    const beforeProjection = Y.encodeStateAsUpdate(doc);
    const afterView = threadsView$();
    expect(afterView.active).toHaveLength(0);
    expect(afterView.orphan.map((t) => t.id).sort()).toEqual(['t-a', 't-b', 't-c', anchorItem?.id].sort());
    expect(Y.encodeStateAsUpdate(doc)).toEqual(beforeProjection);   // 投影纯读

    // 补回 nodes 键（undo 语义的 doc 面等价）→ 该 nodeId 的线程离开孤儿组回到 active：
    // 靠 nodes 订阅驱动，零新 threads 事务（spec §0 条 5「删节点再撤销后线程离开孤儿组，靠 nodes 订阅」）。
    // 注：文本锚指向已销毁的旧片段——补回后仍可能因锚失效留在孤儿组（另见档⑤）；本档只锁「nodeId 存在
    // 即不再是 nodeId∉nodes 档孤儿」这条判定腿。
    const callsBeforeRestore = listener.mock.calls.length;
    doc.transact(() => {
      const node = new Y.Map<unknown>();
      node.set('type', 'textInput');
      node.set('data', new Y.Map<unknown>());
      doc.getMap('nodes').set('n1', node);
    }, 'remote-5');
    const restored = threadsView$();
    const nodeOrphans = restored.orphan.filter((t) => t.kind === 'node');
    expect(nodeOrphans, '补回节点→node 类孤儿全消（nodes 订阅驱动，非新 threads 事务）').toHaveLength(0);
    expect(restored.active.some((g) => g.nodeId === 'n1'), 'n1 组回到 active（其 node 类线程）').toBe(true);
    expect(listener.mock.calls.length).toBeGreaterThan(callsBeforeRestore);

    unsubscribe();
  });

  it('档⑥补：active 节点组间排序=组内最早 createdAt 升序（非 nodeId 字典序），相同按 nodeId', () => {
    const doc = new Y.Doc();
    addNode(doc, 'n-a');   // 字典序最小，但线程最晚
    addNode(doc, 'n-b');   // 字典序居中，线程最早
    addNode(doc, 'n-c');   // 字典序最大，线程居中
    attachThreads(doc, () => true);
    setSessionUserId('u1');
    // createdAt 刻意与 nodeId 字典序相反：n-b(100) < n-c(200) < n-a(300)
    const seed = (id: string, nodeId: string, createdAt: number) => {
      doc.transact(() => {
        const entry = buildThreadEntry({
          id, nodeId, kind: 'node', resolved: false, createdAt, createdBy: 'u1',
        });
        // 先挂进 doc 再取 comments（未集成的 Y.Map 内容不可读——yjs 语义）
        doc.getMap('threads').set(id, entry);
        const comments = entry.get('comments');
        if (!(comments instanceof Y.Map)) throw new Error('comments 容器缺失');
        comments.set('c1', buildThreadComment({
          id: 'c1', authorId: 'u1', body: 'x', createdAt: createdAt + 1,
        }));
      }, 'remote-seed');
    };
    seed('t-late', 'n-a', 300);
    seed('t-early', 'n-b', 100);
    seed('t-mid', 'n-c', 200);

    expect(threadsView$().active.map((g) => g.nodeId), '组按最早 createdAt 升序（红相=字典序 n-a,n-b,n-c）')
      .toEqual(['n-b', 'n-c', 'n-a']);

    // 平局：两组的组首 createdAt 相同 → nodeId 升序。**线程 id 序与 nodeId 序刻意为反**
    // （t-zzz 在 n-b、t-aaa 在 n-d）——可分辨「碰巧复用了线程 id tiebreak」的错误实现。
    addNode(doc, 'n-d');   // 必须先建节点，否则线程落孤儿组
    seed('t-zzz', 'n-b', 100);   // n-b 再来一条同 createdAt（组首不变）
    seed('t-aaa', 'n-d', 100);   // n-d 组首 createdAt=100；线程 id t-aaa < t-zzz
    const tied = threadsView$().active.map((g) => g.nodeId);
    expect(tied, '组首 createdAt 平局→nodeId 升序（n-b<n-d；红相=线程 id 序把 n-d 提前）')
      .toEqual(['n-b', 'n-d', 'n-c', 'n-a']);

    // 组内多线程且插入序与 createdAt 相反：组首必须是 createdAt 最早者而非插入序首者
    addNode(doc, 'n-z');
    seed('t-z-first-inserted', 'n-z', 500);   // 先插入，createdAt 最晚
    seed('t-z-early', 'n-z', 50);             // 后插入，createdAt 最早 → 组首
    const reordered = threadsView$().active;
    expect(reordered[0]?.nodeId, 'n-z 组首 createdAt=50 → 排最前（红相=插入序 500 把它排后）').toBe('n-z');
    expect(reordered[0]?.threads.map((t) => t.id), '组内 createdAt 升序').toEqual(['t-z-early', 't-z-first-inserted']);
  });
});
