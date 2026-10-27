// apps/api/src/modules/collab/collab-t24-clientid-binding.spec.ts
// Y1c T24（spec v5.4 §3.2 偏离 38⑰——clientID 绑定四元+单活跃）：(projectId,generation,userId,
// clientId) 四元绑定表 connectionId/lastSeenAt——同一四元只允许一个活跃连接：旧连接活跃=先 close
// 旧再纳新；僵尸超时替换；禁并发同键（同键并发=CRDT 结构性损坏）；异活跃用户拒（碰撞=可重试 close）。
// 同用户多 clientID 并发放行；SS2 全量回灌（含他端 client 历史 structs、clock≤SV）不抢绑定。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { CollabProjectActorService } from './collab-project-actor.service';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import type { Logger } from '@nestjs/common';

let spoolDir: { dir: string; cleanup: () => Promise<void> };
beforeEach(async () => { spoolDir = await makeSpoolDir('t24-bind-'); });
afterEach(async () => { await spoolDir.cleanup(); });

function makeConn(userId = 'u1', socketId?: string) {
  return {
    socketId: socketId ?? 'sock-' + Math.random().toString(36).slice(2, 8),
    readOnly: false,
    sendStateless: (): void => {},
    context: { user: { id: userId } },
  } as never;
}

function buildActor(doc: Y.Doc, pid = 'p1') {
  const spool = new CollabSpoolService(spoolDir.dir);
  spool.setOwner('t24b-owner');
  spool.setWalHistory('t24b-history');
  const repo = createMockRepo();
  const documents = new Map<string, Y.Doc>([[`project:${pid}`, doc]]);
  const hardCloseCalls: Array<{ conn: unknown; code: number; reason: string }> = [];
  const actor = new CollabProjectActorService(spool as never, repo as never);
  (actor as unknown as { bindHost(h: unknown): void }).bindHost({
    logger: { log: (): void => {}, warn: (): void => {}, error: (): void => {}, debug: (): void => {}, verbose: (): void => {}, fatal: (): void => {}, localInstance: true } as unknown as Logger,
    documents: () => documents,
    hardClose: (conn: unknown, code: number, reason: string) => { hardCloseCalls.push({ conn, code, reason }); },
    isQuotaFrozen: () => false,
    generationOf: () => 0,
    noteReadOnlyDrop: () => false,
    onFencedByWrite: async () => {},
  });
  return { actor, hardCloseCalls };
}

/** 单一客户端仿真（固定 clientID；frame 产出增量 update）。 */
class Client {
  readonly doc = new Y.Doc();
  constructor(seed?: Y.Doc) { if (seed) Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(seed)); }
  frame(mutation: (d: Y.Doc) => void): Uint8Array {
    const captured: Uint8Array[] = [];
    const h = (u: Uint8Array): void => { captured.push(u); };
    this.doc.on('update', h);
    try { mutation(this.doc); } finally { this.doc.off('update', h); }
    if (captured.length === 0) throw new Error('零 update');
    return captured.reduce((acc, u) => Y.mergeUpdates([acc, u]));
  }
}

const setModel = (v: string) => (d: Y.Doc): void => {
  const nodes = d.getMap('nodes');
  if (!nodes.has('n1')) {
    const node = new Y.Map();
    const data = new Y.Map();
    data.set('model', v);
    node.set('type', 'textInput');
    node.set('data', data);
    nodes.set('n1', node);
    return;
  }
  const node = nodes.get('n1') as Y.Map<unknown>;
  const data = node.get('data') as Y.Map<unknown>;
  data.set('model', v);
};

describe('Y1c T24：clientID 绑定四元+单活跃（偏离 38⑰）', () => {
  it('同用户同 clientID 第二连接接管：旧连接活跃→先 close 旧（clientid-superseded）再纳新——禁两活跃共享', async () => {
    const { actor, hardCloseCalls } = buildActor(new Y.Doc());
    const c1 = new Client();
    const connA = makeConn('u1', 'sock-a');
    await expect(actor.submit('p1', c1.frame(setModel('a1')), connA, 'update')).resolves.toBeDefined();
    // connB 伪造同 clientID（四元同键——CRDT 结构标识冒用）：接管=close 旧+纳新（禁并发同键）
    const connB = makeConn('u1', 'sock-b');
    await expect(actor.submit('p1', c1.frame(setModel('a2')), connB, 'update')).resolves.toBeDefined();
    const superseded = hardCloseCalls.filter((c) => c.reason === 'clientid-superseded');
    expect(superseded.length).toBe(1);   // 旧连接 sock-a 被先 close
  });

  it('异活跃用户撞同 clientID=碰撞拒（clientid-collision 1008 可重试 close——clientID 非身份凭证）', async () => {
    const { actor, hardCloseCalls } = buildActor(new Y.Doc());
    const c1 = new Client();
    await expect(actor.submit('p1', c1.frame(setModel('a1')), makeConn('u1', 'sock-a'), 'update')).resolves.toBeDefined();
    // u2 冒用 u1 的 clientID（同 pid|gen|client 异 userId）
    await expect(actor.submit('p1', c1.frame(setModel('a2')), makeConn('u2', 'sock-b'), 'update'))
      .rejects.toMatchObject({ code: 1008, frameReason: 'clientid-collision' });
    expect(hardCloseCalls.some((c) => c.reason === 'clientid-collision' && c.code === 1008)).toBe(true);
  });

  it('同用户多 clientID 并发放行（不同 clientID=不同四元键——多标签/多设备合法形态）', async () => {
    const { actor } = buildActor(new Y.Doc());
    const c1 = new Client();
    const c2 = new Client();
    await expect(actor.submit('p1', c1.frame(setModel('a1')), makeConn('u1', 'sock-a'), 'update')).resolves.toBeDefined();
    await expect(actor.submit('p1', c2.frame(setModel('b1')), makeConn('u1', 'sock-b'), 'update')).resolves.toBeDefined();
  });

  it('僵尸绑定替换（旧连接 socket 已断+lastSeenAt 静默超时→新连接直接纳新零 close）', async () => {
    const { actor, hardCloseCalls } = buildActor(new Y.Doc());
    const c1 = new Client();
    const connA = makeConn('u1', 'sock-a');
    await expect(actor.submit('p1', c1.frame(setModel('a1')), connA, 'update')).resolves.toBeDefined();
    // 僵尸形态：旧 conn 引用的 socketId 已失配（socket 断开后 socketId 换新——模拟：直接改绑表视角
    // 不可达，此处以 fresh=false + stillConnected=false 形态经第二连接同一 client 接管验证零 close）
    (connA as unknown as { socketId: string }).socketId = 'sock-a-gone';   // 旧连接 socket 已断（socketId 失配）
    const connB = makeConn('u1', 'sock-b');
    await expect(actor.submit('p1', c1.frame(setModel('a3')), connB, 'update')).resolves.toBeDefined();
    expect(hardCloseCalls.filter((c) => c.reason === 'clientid-superseded').length).toBe(0);   // 僵尸=直接替换不 close
  });

  it('SS2 全量回灌不抢绑定（他端 client 历史 structs clock≤SV 非新增——fresh 连接携带全量状态）', async () => {
    const { actor } = buildActor(new Y.Doc());
    const author = new Client();
    await expect(actor.submit('p1', author.frame(setModel('a1')), makeConn('u-author'), 'update')).resolves.toBeDefined();
    // 新连接（u-sync）SS2 携带全量状态（含 author client structs——clock≤服务端 SV）
    const syncer = new Y.Doc();
    Y.applyUpdate(syncer, Y.encodeStateAsUpdate(author.doc));
    const connSync = makeConn('u-sync', 'sock-sync');
    await expect(actor.submit('p1', Y.encodeStateAsUpdate(syncer), connSync, 'ss2')).resolves.toBeDefined();
    // author 原连接继续写不受影响（u-sync 的 SS2 未绑定 author 的 clientID）
    await expect(actor.submit('p1', author.frame(setModel('a2')), makeConn('u-author', 'sock-author-2'), 'update')).resolves.toBeDefined();
  });
});
