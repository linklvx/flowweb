// packages/shared/src/canvas/canvas-node-delete.spec.ts
// Y4a T1（plan 2026-11-20-y4a-timeline-domain Task 1——spec §0 条 3/4）：两个删除原语的行为锁。
//  - deleteNodesWithTimelines：恰好一次事务删节点+source/target 指向它的边+timelines 同名键；
//  - deleteTimelineClips：恰好一次事务只删给定片段键；
//  - 嵌套即抛 nested-transact-forbidden（Yjs 嵌套 transact 并进外层、内层 origin 被丢——禁止静默并帧）；
//  - 缺 id 跳过/非 Map 边跳过/幂等（第二次调用零帧）——全部用真实 yjs 装置，非 mock。
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { deleteNodesWithTimelines, deleteTimelineClips } from './canvas-node-delete';

/** 真实删除形态夹具：剪辑节点+指向它的边+另一条无关边+带片段的时间轴（ProjectData-like Y.Map 形）。 */
function buildDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const n1 = new Y.Map();
    n1.set('type', 'videoEdit');
    doc.getMap('nodes').set('n1', n1);
    const other = new Y.Map();
    other.set('type', 'text');
    doc.getMap('nodes').set('other', other);
    const e1 = new Y.Map();
    e1.set('id', 'e1'); e1.set('source', 'src'); e1.set('target', 'n1');
    doc.getMap('edges').set('e1', e1);
    const e2 = new Y.Map();
    e2.set('id', 'e2'); e2.set('source', 'n1'); e2.set('target', 'dst');
    doc.getMap('edges').set('e2', e2);
    const e3 = new Y.Map();
    e3.set('id', 'e3'); e3.set('source', 'a'); e3.set('target', 'b');
    doc.getMap('edges').set('e3', e3);
    const tl = new Y.Map();
    tl.set('version', 1); tl.set('fps', 30);
    const tracks = new Y.Map();
    const tr = new Y.Map();
    tr.set('id', 'n1:video'); tr.set('type', 'video'); tr.set('name', '视频');
    tr.set('muted', false); tr.set('hidden', false); tr.set('order', '5000');
    tracks.set('n1:video', tr);
    tl.set('tracks', tracks);
    const clips = new Y.Map();
    for (let c = 0; c < 3; c++) {
      const clip = new Y.Map();
      clip.set('span', { trackId: 'n1:video', start: c, duration: 1 });
      clips.set(`c${c}`, clip);
    }
    tl.set('clips', clips);
    doc.getMap('timelines').set('n1', tl);
  }, 'seed');
  return doc;
}

/** 计帧器：收 doc.on('update') 帧数+末帧字节（origin 不入 update 监听签名——以帧数断言一次事务）。 */
function frameCounter(doc: Y.Doc): { count(): number } {
  let n = 0;
  doc.on('update', () => { n += 1; });
  return { count: () => n };
}

describe('Y4a T1 删除原语：deleteNodesWithTimelines（spec §0 条 3/4——恰一次事务单源）', () => {
  it('同一事务删节点+source/target 指向它的边+timelines 同名键——恰好一帧、无关边/节点保留', () => {
    const doc = buildDoc();
    const fc = frameCounter(doc);
    deleteNodesWithTimelines(doc, ['n1'], 'local-user');
    expect(fc.count()).toBe(1);   // 恰好一次事务=一个 update 帧
    expect(doc.getMap('nodes').has('n1')).toBe(false);
    expect(doc.getMap('nodes').has('other')).toBe(true);
    expect(doc.getMap('edges').has('e1')).toBe(false);   // target 指向 n1
    expect(doc.getMap('edges').has('e2')).toBe(false);   // source 指向 n1
    expect(doc.getMap('edges').has('e3')).toBe(true);    // 无关边保留
    expect(doc.getMap('timelines').has('n1')).toBe(false);
  });

  it('缺 id 跳过（不抛）；幂等：第二次调用零帧零变更', () => {
    const doc = buildDoc();
    deleteNodesWithTimelines(doc, ['n1', 'ghost'], 'local-user');
    const fc = frameCounter(doc);
    deleteNodesWithTimelines(doc, ['n1'], 'local-user');   // 幂等重放
    expect(fc.count()).toBe(0);   // 全缺 id=零帧（无 update 事件）
    deleteNodesWithTimelines(doc, ['ghost'], 'local-user');
    expect(fc.count()).toBe(0);
    expect(doc.getMap('nodes').has('other')).toBe(true);
  });

  it('非 Map 边跳过（毒值边不炸——只按 source/target 字段判定）', () => {
    const doc = buildDoc();
    doc.transact(() => {
      doc.getMap('edges').set('poison', 'just-a-string');   // 边值=scalar 非 map（对抗面）
      doc.getMap('edges').set('poison2', { source: 'n1' });   // JSON 纯对象非 Y.Map
    }, 'seed');
    expect(() => deleteNodesWithTimelines(doc, ['n1'], 'local-user')).not.toThrow();
    expect(doc.getMap('nodes').has('n1')).toBe(false);
    expect(doc.getMap('edges').get('poison')).toBe('just-a-string');   // 毒值原样保留
    expect(doc.getMap('edges').has('e3')).toBe(true);
  });

  it('嵌套即抛 nested-transact-forbidden（文档已在事务里——禁止静默并帧）', () => {
    const doc = buildDoc();
    doc.transact(() => {
      expect(() => deleteNodesWithTimelines(doc, ['n1'], 'local-user'))
        .toThrow('nested-transact-forbidden');
      doc.getMap('nodes').get('n1');   // 事务里读合法（不产生额外写）
    }, 'seed');
    expect(doc.getMap('nodes').has('n1')).toBe(true);   // 抛出后未删——活文档未写
  });

  it('多节点批：多条边与多个 timelines 键仍在一帧内', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      for (const id of ['n1', 'n2']) {
        const n = new Y.Map();
        n.set('type', 'videoEdit');
        doc.getMap('nodes').set(id, n);
        const tl = new Y.Map();
        tl.set('clips', new Y.Map());
        doc.getMap('timelines').set(id, tl);
      }
      const e = new Y.Map();
      e.set('id', 'ex'); e.set('source', 'n1'); e.set('target', 'n2');
      doc.getMap('edges').set('ex', e);
    }, 'seed');
    const fc = frameCounter(doc);
    deleteNodesWithTimelines(doc, ['n1', 'n2'], 'local-user');
    expect(fc.count()).toBe(1);
    expect(doc.getMap('edges').has('ex')).toBe(false);
    expect(doc.getMap('timelines').size).toBe(0);
  });
});

describe('Y4a T1 删除原语：deleteTimelineClips（片段键删除单源——T4 清空/T5 切块同源）', () => {
  it('恰好一次事务只删给定片段键；未列出的片段保留', () => {
    const doc = buildDoc();
    const fc = frameCounter(doc);
    deleteTimelineClips(doc, 'n1', ['c0', 'c2'], 'local-user');
    expect(fc.count()).toBe(1);
    const clips = doc.getMap('timelines').get('n1')! as Y.Map<unknown>;
    expect((clips.get('clips') as Y.Map<unknown>).has('c0')).toBe(false);
    expect((clips.get('clips') as Y.Map<unknown>).has('c2')).toBe(false);
    expect((clips.get('clips') as Y.Map<unknown>).has('c1')).toBe(true);
    // 轨/入口/version 全保留——原语不碰片段键以外的一切
    expect(clips.get('version')).toBe(1);
    expect((clips.get('tracks') as Y.Map<unknown>).size).toBe(1);
  });

  it('缺 node/缺 clip 键跳过不抛；幂等零帧', () => {
    const doc = buildDoc();
    expect(() => deleteTimelineClips(doc, 'ghost-node', ['c0'], 'local-user')).not.toThrow();
    deleteTimelineClips(doc, 'n1', ['c0'], 'local-user');
    const fc = frameCounter(doc);
    deleteTimelineClips(doc, 'n1', ['c0', 'missing'], 'local-user');   // 幂等+缺键
    expect(fc.count()).toBe(0);
    expect(doc.getMap('timelines').has('n1')).toBe(true);   // 时间轴键未被整删
  });

  it('嵌套即抛 nested-transact-forbidden', () => {
    const doc = buildDoc();
    doc.transact(() => {
      expect(() => deleteTimelineClips(doc, 'n1', ['c0'], 'local-user'))
        .toThrow('nested-transact-forbidden');
    }, 'seed');
    const clips = doc.getMap('timelines').get('n1')! as Y.Map<unknown>;
    expect((clips.get('clips') as Y.Map<unknown>).has('c0')).toBe(true);   // 抛出后未删
  });

  it('clips 非 Y.Map 的毒值时间轴不炸（缺键跳过同族——只删 Map 上的片段键）', () => {
    const doc = buildDoc();
    doc.transact(() => {
      const bad = new Y.Map();
      bad.set('clips', 'not-a-map');
      doc.getMap('timelines').set('bad', bad);
    }, 'seed');
    expect(() => deleteTimelineClips(doc, 'bad', ['c0'], 'local-user')).not.toThrow();
    expect((doc.getMap('timelines').get('bad') as Y.Map<unknown>).get('clips')).toBe('not-a-map');
  });
});

// ── Y4a T5（spec §0 条 3/4）：三路共用原语形态锁——local-user 入画布栈+缺 id/毒值边零破 ──

describe('Y4a T5 三路共用原语：deleteNodesWithTimelines 带 origin 形参（spec §0 条 3/4）', () => {
  it('local-user 调用进画布撤销栈：undo 带回节点+timelines 同名键（三根 scope）', () => {
    const doc = buildDoc();
    const um = new Y.UndoManager(
      ['nodes', 'edges', 'timelines'].map((r) => doc.getMap(r)),
      { captureTimeout: 0, trackedOrigins: new Set(['local-user']) },
    );
    deleteNodesWithTimelines(doc, ['n1'], 'local-user');
    expect(um.undoStack.length).toBe(1);
    expect(doc.getMap('nodes').has('n1')).toBe(false);
    um.undo();
    expect(doc.getMap('nodes').has('n1')).toBe(true);
    expect(doc.getMap('timelines').has('n1')).toBe(true);
    expect(doc.getMap('edges').has('e1')).toBe(true);   // 连边一并装回
    um.destroy();
  });

  it('外层事务已有 origin 时嵌套不破：非 tracked origin 调用不入栈、删除照落（服务端批事务形态负控）', () => {
    const doc = buildDoc();
    const um = new Y.UndoManager(
      ['nodes', 'edges', 'timelines'].map((r) => doc.getMap(r)),
      { captureTimeout: 0, trackedOrigins: new Set(['local-user']) },
    );
    // 非 tracked origin 的直接调用（服务端 SERVER_TRANSACT_ORIGIN 同族形态）——删除照落、不进栈
    deleteNodesWithTimelines(doc, ['n1'], 'server-transact');
    expect(um.undoStack.length).toBe(0);
    expect(doc.getMap('nodes').has('n1')).toBe(false);
    expect(doc.getMap('timelines').has('n1')).toBe(false);
    um.destroy();
  });
});
