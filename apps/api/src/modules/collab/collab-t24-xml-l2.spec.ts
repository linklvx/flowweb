// apps/api/src/modules/collab/collab-t24-xml-l2.spec.ts
// Y1c T24 红②（spec v5.4 §3.2 偏离 38⑫ XML 双层——L2=apply 后 changed-subtree walk）：XML 对抗语料
// **经既有子树挂接**（父链出帧——L1 帧内不可解析形态）现放行=红：未知属性/嵌套 XmlFragment/
// 超长文本/外链 URL/伪造 mention 锚（URL 形态）。绿=L2 毒帧（4411+截断+全连接 close）+
// per-connection 毒帧速率限制（3 次违规→封禁窗拒——防重复重建 DoS）。
// L1 已拦面（未知元素名/未知 mark 无条件检查）不重复——本语料全部为 L1 盲区（父出帧挂接形态）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { CollabProjectActorService } from './collab-project-actor.service';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import type { Logger } from '@nestjs/common';

let spoolDir: { dir: string; cleanup: () => Promise<void> };
beforeEach(async () => { spoolDir = await makeSpoolDir('t24-xmlL2-'); });
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
  spool.setOwner('t24l2-owner');
  spool.setWalHistory('t24l2-history');
  const repo = createMockRepo();
  const documents = new Map<string, Y.Doc>([[`project:${pid}`, doc]]);
  const hardCloseCalls: Array<{ code: number; reason: string }> = [];
  const actor = new CollabProjectActorService(spool as never, repo as never);
  (actor as unknown as { bindHost(h: unknown): void }).bindHost({
    logger: { log: (): void => {}, warn: (): void => {}, error: (): void => {}, debug: (): void => {}, verbose: (): void => {}, fatal: (): void => {}, localInstance: true } as unknown as Logger,
    documents: () => documents,
    hardClose: (conn: unknown, code: number, reason: string) => { hardCloseCalls.push({ code, reason }); },
    isQuotaFrozen: () => false,
    generationOf: () => 0,
    noteReadOnlyDrop: () => false,
    onFencedByWrite: async () => {},
  });
  return { actor, hardCloseCalls };
}

/** textInput 种子（content=XmlFragment{paragraph>text}——L1/L2 合法基线）。 */
function seedDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const node = new Y.Map();
    const data = new Y.Map();
    const frag = new Y.XmlFragment();
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText()]);
    frag.insert(0, [p]);
    data.set('content', frag);
    const prompt = new Y.Map();
    prompt.set('text', new Y.Text());
    data.set('prompt', prompt);
    data.set('model', 'm');
    data.set('order', 'a1');
    node.set('id', 'n1');
    node.set('type', 'textInput');
    node.set('data', data);
    node.set('position', new Y.Map());
    doc.getMap('nodes').set('n1', node);
  });
  return doc;
}

const contentFragOf = (d: Y.Doc): Y.XmlFragment =>
  ((d.getMap('nodes').get('n1') as Y.Map<unknown>).get('data') as Y.Map<unknown>).get('content') as Y.XmlFragment;

/** 「攻击者客户端」仿真：单一 Y.Doc 实例（固定 clientID）持 seed 基线，逐帧 mutation 产出增量帧。 */
class AttackerClient {
  readonly doc = new Y.Doc();
  constructor(seed: Y.Doc) { Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(seed)); }
  frame(mutation: (d: Y.Doc) => void): Uint8Array {
    const captured: Uint8Array[] = [];
    const h = (u: Uint8Array): void => { captured.push(u); };
    this.doc.on('update', h);
    try { mutation(this.doc); } finally { this.doc.off('update', h); }
    if (captured.length === 0) throw new Error('零 update');
    return captured.reduce((acc, u) => Y.mergeUpdates([acc, u]));
  }
}

async function seedAndConnect(doc: Y.Doc, actor: CollabProjectActorService): Promise<void> {
  await actor.submit('p1', Y.encodeStateAsUpdate(doc), makeConn(), 'ss2');
}

describe('Y1c T24 红②：XML 对抗语料 L2（既有子树挂接——L1 帧内盲区现放行=红）', () => {
  it('未知属性键（既有 paragraph.setAttribute("onclick")——父出帧 L1 不查属性域）→ L2 毒帧 4411', async () => {
    const seed = seedDoc();
    const { actor } = buildActor(seed);
    await seedAndConnect(seed, actor);
    const attacker = new AttackerClient(seed);
    const attack = attacker.frame((d) => {
      (contentFragOf(d).get(0) as Y.XmlElement).setAttribute('onclick', 'evil()');
    });
    await expect(actor.submit('p1', attack, makeConn('u2'), 'update')).rejects.toMatchObject({ code: 4411 });
  });

  it('嵌套 XmlFragment（既有 paragraph 下挂 XmlFragment——L1 祖先出帧不判嵌套）→ L2 毒帧 4411', async () => {
    const seed = seedDoc();
    const { actor } = buildActor(seed);
    await seedAndConnect(seed, actor);
    const attacker = new AttackerClient(seed);
    const attack = attacker.frame((d) => {
      ((contentFragOf(d).get(0) as unknown as { insert: (i: number, c: unknown[]) => void }).insert(0, [new Y.XmlFragment()]));   // 嵌套 fragment 挂接（结构性窄化——XmlElement.insert 公开面）
    });
    await expect(actor.submit('p1', attack, makeConn('u2'), 'update')).rejects.toMatchObject({ code: 4411 });
  });

  it('外链 URL 属性值（帧内新建 image（合法）→次帧对既有 image.src 写 http URL——L1 值扫描需帧内父）→ L2 毒帧 4411', async () => {
    const seed = seedDoc();
    const { actor } = buildActor(seed);
    await seedAndConnect(seed, actor);
    const attacker = new AttackerClient(seed);
    // 帧 1：新建 image（元素名域 L1 无条件过；src=mediaId 值合法）
    const setup = attacker.frame((d) => {
      const img = new Y.XmlElement('image');
      img.setAttribute('src', 'media-1');
      contentFragOf(d).insert(1, [img]);
    });
    await expect(actor.submit('p1', setup, makeConn('u2'), 'update')).resolves.toBeDefined();
    // 帧 2：对既有 image 写外链 URL（父出帧——L1 值扫描盲区；COLLAB_XML_URL_HOSTS 缺省 deny-all）
    const attack = attacker.frame((d) => {
      (contentFragOf(d).get(1) as Y.XmlElement).setAttribute('src', 'http://evil.example/x.png');
    });
    await expect(actor.submit('p1', attack, makeConn('u2'), 'update')).rejects.toMatchObject({ code: 4411 });
  });

  it('伪造 mention 锚（帧内新建 command（合法）→次帧对既有 command.id 写 http URL 锚）→ L2 毒帧 4411', async () => {
    const seed = seedDoc();
    const { actor } = buildActor(seed);
    await seedAndConnect(seed, actor);
    const attacker = new AttackerClient(seed);
    const setup = attacker.frame((d) => {
      const cmd = new Y.XmlElement('command');
      cmd.setAttribute('id', 'cmd-1');
      cmd.setAttribute('label', 'l');
      contentFragOf(d).insert(1, [cmd]);
    });
    await expect(actor.submit('p1', setup, makeConn('u2'), 'update')).resolves.toBeDefined();
    const attack = attacker.frame((d) => {
      (contentFragOf(d).get(1) as Y.XmlElement).setAttribute('id', 'http://evil.example/mention');
    });
    await expect(actor.submit('p1', attack, makeConn('u2'), 'update')).rejects.toMatchObject({ code: 4411 });
  });

  it('超长文本（既有 XmlText 插入 >128KiB——L1 字节域需帧内父）→ L2 毒帧 4411', async () => {
    const seed = seedDoc();
    const { actor } = buildActor(seed);
    await seedAndConnect(seed, actor);
    const attacker = new AttackerClient(seed);
    const attack = attacker.frame((d) => {
      ((contentFragOf(d).get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'x'.repeat(200_000));
    });
    await expect(actor.submit('p1', attack, makeConn('u2'), 'update')).rejects.toMatchObject({ code: 4411 });
  });

  it('超深链（合法 30 层种子〔L1 单帧 ≤32 放行〕+攻击帧追挂 5 层=合并 35>32——帧内链短 L1 不越限）→ L2 毒帧 4411', async () => {
    const seed = seedDoc();
    // 种子：既有 paragraph 下 30 层 bulletList 链（L1 深度=30≤32 合法上载）
    seed.transact(() => {
      let cur: Y.XmlElement = contentFragOf(seed).get(0) as Y.XmlElement;
      for (let i = 0; i < 30; i++) {
        const list = new Y.XmlElement('bulletList');
        cur.insert(0, [list]);
        cur = list;
      }
    });
    const { actor } = buildActor(seed);
    await seedAndConnect(seed, actor);
    const attacker = new AttackerClient(seed);
    // 攻击帧：既有最深元素下追挂 5 层（帧内链=5——L1 深度面不越限；全链 35>32=L2 面）
    const attack = attacker.frame((d) => {
      const frag = contentFragOf(d);
      let cur: unknown = frag.get(0);
      for (let i = 0; i < 30; i++) cur = (cur as Y.XmlElement).get(0);
      let deep = cur as Y.XmlElement;
      for (let i = 0; i < 5; i++) {
        const list = new Y.XmlElement('bulletList');
        deep.insert(0, [list]);
        deep = list;
      }
    });
    await expect(actor.submit('p1', attack, makeConn('u2'), 'update')).rejects.toMatchObject({ code: 4411 });
  });

  it('per-connection 毒帧速率限制（同 clientID 3 次 L2 违规→封禁窗：第 4 帧准入门即拒 1008 poison-rate-limited——不走到 apply/L2）', async () => {
    const seed = seedDoc();
    const { actor, hardCloseCalls } = buildActor(seed);
    await seedAndConnect(seed, actor);
    const attacker = new AttackerClient(seed);
    const conn = makeConn('u9');
    for (let i = 0; i < 3; i++) {
      const attack = attacker.frame((d) => {
        (contentFragOf(d).get(0) as Y.XmlElement).setAttribute('onclick', `evil-${i}()`);
      });
      await expect(actor.submit('p1', attack, conn, 'update')).rejects.toMatchObject({ code: 4411 });
    }
    // 第 4 帧（干净帧）——封禁窗内：绑定面准入门拒（防重复重建 DoS）
    const clean = attacker.frame((d) => {
      ((d.getMap('nodes').get('n1') as Y.Map<unknown>).get('data') as Y.Map<unknown>).set('model', 'm2');
    });
    await expect(actor.submit('p1', clean, conn, 'update')).rejects.toMatchObject({ code: 1008, frameReason: CollabProjectActorService.CLIENT_BINDING_WIRE_REASONS.poisonRateLimited });
    expect(hardCloseCalls.some((c) => c.reason === CollabProjectActorService.CLIENT_BINDING_WIRE_REASONS.poisonRateLimited)).toBe(true);
  });
});
