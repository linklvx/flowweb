// apps/api/src/modules/collab/collab-threads-collab.int.spec.ts
// Y4b T12（plan 2026-11-22-y4b-annotation-security Task 12——spec 锚 A15/A15′）：threads 双端协作
// 端到端 int——装置=dual-client-server（E40 现成：真实 WS+cookie 认证+csv/sv 版本门+await synced），
// MockRepo 起始空 doc；节点与线程夹具由 A/B 端事务直写。
//
// **落位纠偏（主会话裁定——同 Ruling 3 的 T3 结构性纠偏性质）**：原施工单指定 apps/web int 池
// 不可执行——①apps/web 无 vitest.int.config.ts（只有 vite.config.ts 的 jsdom 默认池）；②web 不能
// import apps/api/src/test-utils/dual-client-server（web deps 无 ws/@hocuspocus/server、无跨包
// test-utils 先例）。本 spec 落 api int 池（vitest.int.config.ts），五档意图不变。
//
// 五档（原施工单意图 → 纠偏后形态）：
//  ①主档：A threads-user 事务 createThread（envelope+comments 容器+首条评论）→ B 端读回线程且
//    首条评论在（真 WS 广播面——服务端闸准入后广播）；
//  ②B 删节点（nodes 根 delete，local-user 画布域）→ **删节点不删线程**：双端 threads 根恒持有该
//    线程、且按 orphan 判据 nodeId∉nodes 成立。threadsView$ 的孤儿投影实现在 apps/web（T10）——
//    本装置**不复制**投影实现（避免第二实现），投影正确性由 T10 档⑤/⑥单元覆盖；
//  ③A15′：A 删节点 → UndoManager.undo()（画布栈）→ 节点回 → thread 自动离开孤儿判据 + **threads
//    根本笔无变更**（observeDeep 监听器 vi.fn 未触发=撤销只写 nodes 根——域隔离反向锚）；
//  ④A 端单 threads-user 事务删孤儿 thread → B 端读回消失（双端 threads 根一致）；
//  ⑤服务端闸全链（隐含主档）：合法 threads 帧经 actor L1/L2 准入后广播 + **同步完成后全程零 close**
//    （provider on('close') 观测，watchClose 装在双方 synced 之后——与 T9 执法档的分界：合法帧不被任何层拒/断连）。
//
// UndoManager 在本 spec 内直构（int 装置不能 import apps/web——apps/api tsconfig 无该路径；形态
// 对齐 web canvasUndo.ts attach 面）：scope=UNDO_STACK_BASE 三根（nodes/edges/timelines）+
// trackedOrigins=['local-user']（web Origin.LocalUser 枚举字面量——undo-policy UNDO_TRACKED_ORIGINS
// 同值钉出处）+captureTimeout=UNDO_CAPTURE_TIMEOUT_MS(500)。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as Y from 'yjs';
import {
  THREADS_ORIGIN, UNDO_CAPTURE_TIMEOUT_MS, UNDO_STACK_BASE,
  buildThreadEntry, buildThreadComment,
} from '@flowweb/shared';
import { startDualClientServer, type DualClientKit } from '../../test-utils/dual-client-server';
import { pollUntil } from '../../test-utils/poll-until';
import { canvasDocName } from './doc-name.util';

/** web canvasUndo.ts Origin.LocalUser 枚举字面量（trackedOrigins 唯一入栈者——undo-policy
 *  UNDO_TRACKED_ORIGINS 同值；int 装置不 import apps/web，字面量钉出处）。 */
const CANVAS_LOCAL_USER = 'local-user';

const PID = 'y4bt12-collab';
/** docName 单源（doc-name.util.canvasDocName——gen0 canonical=裸名；kit 无世代播种故 liveDocName
 *  折裸名同值——裸名 invalid-doc-name，必须带 project: 前缀）。 */
const DOC_NAME = canvasDocName(PID, 0);

type Conn = ReturnType<DualClientKit['connect']>;

/** 装置侧夹具：per-kit 双 client（同 doc 名=同一服务端 doc——互见前提）。 */
interface Pair {
  kit: DualClientKit;
  a: Conn;
  b: Conn;
}

/** 节点信封（frame-deny NODE_ENVELOPE_KEYS 矩阵——type/position/data；videoEdit=timeline-collab
 *  先例同款信封，data 空 Map 合法）。 */
function videoEditNode(): Y.Map<unknown> {
  return new Y.Map([
    ['type', 'videoEdit'],
    ['position', new Y.Map([['x', 0], ['y', 0]])],
    ['data', new Y.Map()],
  ]);
}

/** A 端 threads-user 事务建线程（T6 工厂单源——工厂已预建空 comments 容器，禁 new Y.Map；
 *  **先挂根再取 comments**：未集成的 Y.Map 内容不可读〔yjs 语义〕；首条评论同事务=spec §2.1
 *  createThread 形态）。createdBy/authorId 同 userId（与连接 actor 会话 identity 一致——L1 准入）。 */
function aCreateThreadTx(a: Y.Doc, threadId: string, nodeId: string, userId: string): void {
  a.transact(() => {
    const entry = buildThreadEntry({
      id: threadId, nodeId, kind: 'node', resolved: false, createdAt: 1_000, createdBy: userId,
    });
    a.getMap('threads').set(threadId, entry);   // 先挂根（集成后 comments 容器可读）
    const comments = entry.get('comments');
    if (comments instanceof Y.Map) {
      comments.set('c1', buildThreadComment({ id: 'c1', authorId: userId, body: '首条评论', createdAt: 1_001 }));
    }
  }, THREADS_ORIGIN);
}

/** close 事件观测（provider EventEmitter 面——T9 spec watchClose 同款仪器：hardClose→
 *  webSocket.close(code)→客户端 close 事件 {event:{code}}；本 spec 只断言「从未触发」）。 */
function watchClose(provider: Conn['provider']): { code(): number | null } {
  let code: number | null = null;
  (provider as { on(ev: string, cb: (e: unknown) => void): void }).on('close', (e: unknown) => {
    const c = (e as { event?: { code?: unknown } } | null)?.event?.code;
    if (code === null && typeof c === 'number') code = c;
  });
  return { code: () => code };
}

/** 观测窗 settle：套件短 debounce（300ms 批窗）下帧批全落定。 */
async function settle(ms = 300): Promise<void> { await new Promise((r) => setTimeout(r, ms)); }

describe('Y4b T12：threads 双端协作（装置=dual-client-server 真 WS）', () => {
  let pair: Pair;
  let aClose: { code(): number | null };
  let bClose: { code(): number | null };

  beforeAll(async () => {
    const kit = await startDualClientServer();
    const a = kit.connect(DOC_NAME);
    const b = kit.connect(DOC_NAME);
    pair = { kit, a, b };
    await Promise.all([a.synced, b.synced]);
    // 同步完成后全程零 close 观测（watchClose 装在双方 synced 之后——合法帧链路任何层拒/断连都会落 code 非 null）
    aClose = watchClose(a.provider);
    bClose = watchClose(b.provider);
    // 布景：A 建节点 n1（local-user 画布域——档②/③ 的孤儿基线）；B 读回=互见前提就位
    pair.a.ydoc.transact(() => {
      pair.a.ydoc.getMap('nodes').set('n1', videoEditNode());
    }, CANVAS_LOCAL_USER);
    await pollUntil(() => pair.b.ydoc.getMap('nodes').has('n1'), 5_000);
  }, 30_000);

  afterAll(async () => { await pair.kit.dispose(); }, 30_000);

  it('①主档：A createThread→B 读回线程+首条评论（真 WS 广播——服务端闸准入后中转）', async () => {
    aCreateThreadTx(pair.a.ydoc, 't1', 'n1', 'u1');
    // 主用例第一条断言面：B 端收到该线程（改造前红=无此 spec 文件）
    await pollUntil(() => pair.b.ydoc.getMap('threads').has('t1'), 5_000);
    const bEntry = pair.b.ydoc.getMap('threads').get('t1') as Y.Map<unknown>;
    const comments = bEntry.get('comments');
    expect(comments instanceof Y.Map).toBe(true);
    expect((comments as Y.Map<unknown>).size, '广播内容含首条评论').toBe(1);
    expect((comments as Y.Map<unknown>).get('c1') instanceof Y.Map).toBe(true);
  }, 20_000);

  it('②B 删节点（local-user 画布域）→ 删节点不删线程（双端 threads 恒持有 + orphan 判据 nodeId∉nodes）', async () => {
    pair.b.ydoc.transact(() => {
      pair.b.ydoc.getMap('nodes').delete('n1');
    }, CANVAS_LOCAL_USER);
    // A 端读回节点删除（真 WS）
    await pollUntil(() => !pair.a.ydoc.getMap('nodes').has('n1'), 5_000);
    expect(pair.b.ydoc.getMap('nodes').has('n1')).toBe(false);
    // 删节点不删线程：双端 threads 根恒持有 t1
    expect(pair.a.ydoc.getMap('threads').has('t1')).toBe(true);
    expect(pair.b.ydoc.getMap('threads').has('t1')).toBe(true);
    // orphan 判据（kind='node' 投影单源语义=nodeId 不在 nodes 根）：nodeId='n1' ∉ nodes
    const t1 = pair.a.ydoc.getMap('threads').get('t1') as Y.Map<unknown>;
    const nodeId = t1.get('nodeId') as string;
    expect(nodeId).toBe('n1');
    expect(pair.a.ydoc.getMap('nodes').has(nodeId), 'orphan 判据成立=nodeId∉nodes').toBe(false);
    const t1b = pair.b.ydoc.getMap('threads').get('t1') as Y.Map<unknown>;
    expect(t1b.get('nodeId'), 'B 端同判据').toBe('n1');
    expect(pair.b.ydoc.getMap('nodes').has('n1'), 'B 端 nodes 不含 n1').toBe(false);
  }, 20_000);

  it('③A15′：A 删节点→undo→节点回→thread 自动离开 orphan 判据 + threads 根本笔无变更（观察器未触发）', async () => {
    // 独立布景 n2/t2（不与②的 n1/t1 夹具串扰——同 timeline-collab 隔离纪律）
    pair.a.ydoc.transact(() => {
      pair.a.ydoc.getMap('nodes').set('n2', videoEditNode());
    }, CANVAS_LOCAL_USER);
    await pollUntil(() => pair.b.ydoc.getMap('nodes').has('n2'), 5_000);
    aCreateThreadTx(pair.a.ydoc, 't2', 'n2', 'u1');
    await pollUntil(() => pair.b.ydoc.getMap('threads').has('t2'), 5_000);

    // 画布栈直构（int 装置不 import apps/web——scope=UNDO_STACK_BASE 三根+local-user+500ms 窗）
    const canvasUm = new Y.UndoManager(
      UNDO_STACK_BASE.map((root) => pair.a.ydoc.getMap(root)),
      { trackedOrigins: new Set([CANVAS_LOCAL_USER]), captureTimeout: UNDO_CAPTURE_TIMEOUT_MS },
    );
    const threadsListener = vi.fn();   // threads 根 observeDeep 计数（零变更判据）
    pair.a.ydoc.getMap('threads').observeDeep(threadsListener);
    try {
      // A 删节点（画布域一笔）→ B 读回删除
      pair.a.ydoc.transact(() => {
        pair.a.ydoc.getMap('nodes').delete('n2');
      }, CANVAS_LOCAL_USER);
      await pollUntil(() => !pair.b.ydoc.getMap('nodes').has('n2'), 5_000);
      // 删节点不动线程（撤销前：thread 仍在、orphan 判据已成立）
      expect(pair.a.ydoc.getMap('threads').has('t2')).toBe(true);
      const t2Before = pair.a.ydoc.getMap('threads').get('t2') as Y.Map<unknown>;
      expect(pair.a.ydoc.getMap('nodes').has(t2Before.get('nodeId') as string)).toBe(false);

      // A15′：undo 撤销删节点（画布栈——threads 不在 scope、threads-user 非 tracked origin）
      canvasUm.stopCapturing();
      expect(canvasUm.undoStack.length).toBe(1);
      canvasUm.undo();
      // 节点回（双端）——thread 自动离开 orphan 判据（nodeId 重新 ∈ nodes，无需任何 threads 写）
      await pollUntil(() => pair.b.ydoc.getMap('nodes').has('n2'), 5_000);
      expect(pair.a.ydoc.getMap('nodes').has('n2')).toBe(true);
      expect(pair.a.ydoc.getMap('threads').has('t2')).toBe(true);
      const t2After = pair.a.ydoc.getMap('threads').get('t2') as Y.Map<unknown>;
      expect(t2After.get('nodeId')).toBe('n2');
      expect(pair.a.ydoc.getMap('nodes').has(t2After.get('nodeId') as string), 'undo 后离开 orphan 判据').toBe(true);
      // 尾部静默窗（防在途 update 迟到误计）
      await settle(300);
      // threads 根零变更（前后恒持有 t2 + 监听器一次未触发——撤销只写 nodes 根、零新 threads-user 事务）
      expect(threadsListener, 'threads 根本笔无变更（observeDeep 未触发；负断言后活性探针见下）').not.toHaveBeenCalled();
      expect(pair.a.ydoc.getMap('threads').has('t2')).toBe(true);
      expect(canvasUm.redoStack.length).toBe(1);   // 装置活性：undo 真弹栈非 no-op
      // 观察器活性自证（防上面 not.toHaveBeenCalled 是空断言）：负断言之后用一笔 threads-user 写证明监听器接上了。
      // 追加评论一笔 threads-user 事务必须触发监听器（合法帧经服务端闸广播）
      pair.a.ydoc.transact(() => {
        const entry = pair.a.ydoc.getMap('threads').get('t2') as Y.Map<unknown>;
        (entry.get('comments') as Y.Map<unknown>).set(
          'c-probe', buildThreadComment({ id: 'c-probe', authorId: 'u1', body: '活性探针', createdAt: 2_000 }),
        );
      }, THREADS_ORIGIN);
      expect(threadsListener, '观察器活性：threads-user 写必触发（负断言非空）').toHaveBeenCalled();
      await pollUntil(() => {
        const entry = pair.b.ydoc.getMap('threads').get('t2') as Y.Map<unknown> | undefined;
        return entry != null && (entry.get('comments') as Y.Map<unknown>).has('c-probe');
      }, 5_000);
    } finally {
      pair.a.ydoc.getMap('threads').unobserveDeep(threadsListener);
      canvasUm.destroy();
    }
  }, 20_000);

  it('④A 单 threads-user 事务删孤儿 thread→B 读回消失（双端 threads 根一致）', async () => {
    expect(pair.a.ydoc.getMap('threads').has('t1'), '前置：t1=②留下的孤儿线程').toBe(true);
    pair.a.ydoc.transact(() => {
      pair.a.ydoc.getMap('threads').delete('t1');
    }, THREADS_ORIGIN);
    await pollUntil(() => !pair.b.ydoc.getMap('threads').has('t1'), 5_000);
    expect(pair.b.ydoc.getMap('threads').has('t1')).toBe(false);
    expect(pair.a.ydoc.getMap('threads').has('t1')).toBe(false);
    // 双端 roots 一致（仅剩③的 t2——删除面同步无残留）
    const keysA = [...pair.a.ydoc.getMap('threads').keys()].sort();
    const keysB = [...pair.b.ydoc.getMap('threads').keys()].sort();
    expect(keysB).toEqual(keysA);
    expect(keysA).toEqual(['t2']);
  }, 20_000);

  it('⑤服务端闸全链（隐含主档）+同步完成后全程零 close：合法 createThread 帧准入后广播', async () => {
    aCreateThreadTx(pair.a.ydoc, 't5', 'n2', 'u1');
    await pollUntil(() => pair.b.ydoc.getMap('threads').has('t5'), 5_000);
    const bEntry = pair.b.ydoc.getMap('threads').get('t5') as Y.Map<unknown>;
    expect((bEntry.get('comments') as Y.Map<unknown>).size).toBe(1);
    // 显式零 close：同步完成后 A/B 全程未收到 close（合法帧 L1/L2 全过闸——不拒/不断连）
    expect(aClose.code(), 'A 同步完成后全程零 close（服务端闸准入后广播）').toBeNull();
    expect(bClose.code()).toBeNull();
  }, 20_000);
});
