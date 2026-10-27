// apps/api/src/modules/collab/collab-t24-deny-matrix.spec.ts
// Y1c T24 红①（plan Task 24——spec v5.4 §3.2 DENY 面）：写 exec 根/未知类型/未知键/值类型错/
// 容器替换/raw update 替换 live 容器**现放行**=红——绿=DENY 矩阵运行时激活（4411 拒+零 WAL 零 apply；
// 帧外父 raw update 替换=L2 后验毒帧：4411+全连接 close+WAL 截断——doc 内存态由恢复链从 pgSeq 重放）。
// 装置=T9 actor 单元形态（真 spool+mock repo+fake host——collab-project-actor.spec 同款）。
// 红相证据：修前跑=断言差（expect rejects 实收 resolves——非崩溃）；红→绿由 stash 复演留档。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { CollabProjectActorService } from './collab-project-actor.service';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import type { Logger } from '@nestjs/common';

let spoolDir: { dir: string; cleanup: () => Promise<void> };
beforeEach(async () => { spoolDir = await makeSpoolDir('t24-deny-'); });
afterEach(async () => { await spoolDir.cleanup(); });

function makeConn(userId = 'u1') {
  return {
    socketId: 'sock-' + Math.random().toString(36).slice(2, 8),
    readOnly: false,
    sendStateless: (): void => {},
    context: { user: { id: userId } },
  } as never;
}

function buildActor(doc: Y.Doc, pid = 'p1') {
  const spool = new CollabSpoolService(spoolDir.dir);
  spool.setOwner('t24-owner');
  spool.setWalHistory('t24-history');
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
  return { actor, hardCloseCalls, spool };
}

/** 客户端侧构造帧（独立 Y.Doc 全量编码——新节点/新根创建形态）。 */
function clientFrame(mutation: (doc: Y.Doc) => void): Uint8Array {
  const src = new Y.Doc();
  mutation(src);
  return Y.encodeStateAsUpdate(src);
}

/** 增量帧捕获（seed 克隆上 mutation 的 update 事件字节——真客户端 provider 同形）。 */
function captureFrame(seed: Y.Doc, mutation: (doc: Y.Doc) => void): Uint8Array {
  const clone = new Y.Doc();
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(seed));
  const captured: Uint8Array[] = [];
  clone.on('update', (u: Uint8Array) => { captured.push(u); });
  mutation(clone);
  if (captured.length === 0) throw new Error('mutation 产生零 update');
  return captured.reduce((acc, u) => Y.mergeUpdates([acc, u]));
}

/** 合法 textInput 种子（web fillDoc 同形：信封+data{content:XmlFragment,prompt:Map{text},model,order}）。 */
function seedTextInputDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const node = new Y.Map();
    const data = new Y.Map();
    const frag = new Y.XmlFragment();
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText()]);
    frag.insert(0, [p]);
    const prompt = new Y.Map();
    prompt.set('text', new Y.Text());
    data.set('content', frag);
    data.set('prompt', prompt);
    data.set('model', 'gpt-test');
    data.set('order', 'a1');
    node.set('id', 'n1');
    node.set('type', 'textInput');
    node.set('data', data);
    node.set('position', new Y.Map());
    doc.getMap('nodes').set('n1', node);
  });
  return doc;
}

describe('Y1c T24 红①：DENY 矩阵（exec 根/未知类型/未知键/值类型/容器替换——现放行=红）', () => {
  it('exec 根写入拒（4411 exec-root——T9 P1 白名单含 exec 的升格面）', async () => {
    const { actor } = buildActor(new Y.Doc());
    const frame = clientFrame((d) => { d.getMap('exec').set('n1', new Y.Map()); });
    const before = actor.appliedSeqOf('p1');
    await expect(actor.submit('p1', frame, makeConn(), 'update')).rejects.toMatchObject({ code: 4411 });
    expect(actor.appliedSeqOf('p1')).toBe(before);   // 零 WAL 零 apply
  });

  it('未知节点类型拒（NODE_CREATED type∉DOC_SCHEMA_V4——4411）', async () => {
    const { actor } = buildActor(new Y.Doc());
    const frame = clientFrame((d) => {
      const node = new Y.Map();
      node.set('type', 'bogusType');
      node.set('data', new Y.Map());
      d.getMap('nodes').set('nx', node);
    });
    await expect(actor.submit('p1', frame, makeConn(), 'update')).rejects.toMatchObject({ code: 4411 });
  });

  it('未知 data 键拒（in-frame 创建节点 data.hax=1——4411 unknown-data-key）', async () => {
    const { actor } = buildActor(new Y.Doc());
    const frame = clientFrame((d) => {
      const node = new Y.Map();
      const data = new Y.Map();
      data.set('hax', 1);
      node.set('type', 'textInput');
      node.set('data', data);
      d.getMap('nodes').set('nx', node);
    });
    await expect(actor.submit('p1', frame, makeConn(), 'update')).rejects.toMatchObject({ code: 4411 });
  });

  it('值类型错拒（model=Y.Map 容器塞 lww 键——4411 value-type）', async () => {
    const { actor } = buildActor(new Y.Doc());
    const frame = clientFrame((d) => {
      const node = new Y.Map();
      const data = new Y.Map();
      data.set('model', new Y.Map());
      node.set('type', 'textInput');
      node.set('data', data);
      d.getMap('nodes').set('nx', node);
    });
    await expect(actor.submit('p1', frame, makeConn(), 'update')).rejects.toMatchObject({ code: 4411 });
  });

  it('容器替换拒（textInput.content=裸 string 整串覆盖——4411 container-replacement）', async () => {
    const { actor } = buildActor(new Y.Doc());
    const frame = clientFrame((d) => {
      const node = new Y.Map();
      const data = new Y.Map();
      data.set('content', 'raw-string-payload');
      node.set('type', 'textInput');
      node.set('data', data);
      d.getMap('nodes').set('nx', node);
    });
    await expect(actor.submit('p1', frame, makeConn(), 'update')).rejects.toMatchObject({ code: 4411 });
  });

  it('raw update 替换 live 容器拒（既有节点 content 整键覆盖——帧外父深链=L2 后验毒帧：4411+全连接 close+截断至前帧）', async () => {
    const seed = seedTextInputDoc();
    const { actor, hardCloseCalls } = buildActor(seed);
    // 第一帧：合法种子上载（SS2 自包含——L1/L2/矩阵全过）
    await expect(actor.submit('p1', Y.encodeStateAsUpdate(seed), makeConn(), 'ss2')).resolves.toMatchObject({ walSeq: expect.anything() });
    // 第二帧：raw update 把既有节点 content 容器替换为裸 string（父链出帧——L1/DENY 帧内不可判定=L2 面）
    const attack = captureFrame(seed, (d) => {
      const node = d.getMap('nodes').get('n1') as Y.Map<unknown>;
      const data = node.get('data') as Y.Map<unknown>;
      data.set('content', 'hijacked');
    });
    await expect(actor.submit('p1', attack, makeConn('u2'), 'update')).rejects.toMatchObject({ code: 4411 });
    expect(hardCloseCalls.some((c) => c.code === 4411)).toBe(true);   // culprit+全连接 close（毒帧协议）
  });
});
