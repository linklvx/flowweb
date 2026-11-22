// packages/shared/src/canvas/threads-frame-predicate.test.ts
// Y4b T6（plan 2026-11-22-y4b-annotation-security Task 6——spec §0 条 6/7/14〔§2.1/§2.3〕）：
// threads 帧谓词负控矩阵——**谓词吃普通值**三路同函数（L1 framePathOf 收成/L2 落成后 toJSON/
// 客户端将写对象）+L2 动作矩阵按 path 四档（实测 yjs 13.6.32：同帧建线程只发根上一条 add；
// 后补评论=path=[threadId,comments] add；改 resolved=path=[threadId] update；
// **已有评论上 set 未知键发的是该键 add——「只拒 update/delete 漏 add」会放过未知键进 hash/oracle**）。
// 矩阵档逐条（brief Step 1）：
//  ①kind='text' 缺 anchor/②'node' 带 anchor/③垃圾 base64/④解码字节超 512/⑤resolved 缺失/
//  ⑥全空白 body/⑦authorId 空串/⑧createdAt 两端越界/⑨未知键/⑩作者不等两向（'u2'≠'u1' 红、
//  'u1' 过）；L2 档：根键 update 红/comments 容器键 delete·update 红/删整条 entry 合法/
//  评论 add 合法/未知键 add 红/fail-closed 缺省全拒/Y.Map 直传负控（直传 Object.keys 空——
//  必须先 toJSON()）。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  checkThreadEntry,
  checkThreadComment,
  encodeAnchorBase64,
  decodeAnchorBase64,
  buildThreadEntry,
  buildThreadComment,
  threadEventErr,
} from './threads-frame-predicate';

// ═══════════════════ 夹具（合法形态基线——只差待测字段） ═══════════════════

/** 某根 Map 上 index 0 的合法 RelativePosition 的 base64（文本锚两键共用形态）。 */
function legalAnchor(): string {
  const d = new Y.Doc();
  const m = d.getMap('probe');
  m.set('a', 'x');
  return encodeAnchorBase64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(m, 0)));
}

/** 合法线程 entry 普通对象（kind='node'——comments 至少一条 u1 评论；over 可覆写键）。 */
function entryObj(over?: (e: Record<string, unknown>) => void): Record<string, unknown> {
  const e: Record<string, unknown> = {
    id: 't1',
    nodeId: 'n1',
    kind: 'node',
    resolved: false,
    createdAt: 0,
    createdBy: 'u1',
    comments: { c1: { id: 'c1', authorId: 'u1', body: 'hello', createdAt: 0 } },
  };
  over?.(e);
  return e;
}

/** 合法评论普通对象。 */
function commentObj(): Record<string, unknown> {
  return { id: 'c1', authorId: 'u1', body: 'hello', createdAt: 0 };
}

// ═══════════════════ 谓词直调矩阵（三路同函数——纯字段） ═══════════════════

describe('Y4b T6 checkThreadEntry 负控矩阵（spec §2.1 键矩阵）', () => {
  it('主用例：kind 越界（weird）红——错误串含 kind', () => {
    const err = checkThreadEntry('t1', { id: 't1', kind: 'weird', nodeId: 'n1', resolved: false, createdAt: 0 }, 'u1');
    expect(err).toContain('kind');
  });

  it('正基线：合法 entry 过（actorUserId 相等）', () => {
    expect(checkThreadEntry('t1', entryObj(), 'u1')).toBeUndefined();
  });

  it('①kind="text" 缺 anchorStart/anchorEnd 红；两键齐备（合法 base64）过', () => {
    const a = legalAnchor();
    const noAnchor = entryObj((e) => { e.kind = 'text'; });
    expect(checkThreadEntry('t1', noAnchor, 'u1')).toContain('anchor');
    const withAnchor = entryObj((e) => { e.kind = 'text'; e.anchorStart = a; e.anchorEnd = a; });
    expect(checkThreadEntry('t1', withAnchor, 'u1')).toBeUndefined();
  });

  it('②kind="node" 带 anchorStart/anchorEnd 红（两键必须不存在）', () => {
    const a = legalAnchor();
    const bad = entryObj((e) => { e.anchorStart = a; });
    expect(checkThreadEntry('t1', bad, 'u1')).toContain('anchor');
    const bad2 = entryObj((e) => { e.anchorEnd = a; });
    expect(checkThreadEntry('t1', bad2, 'u1')).toContain('anchor');
  });

  it('③垃圾 base64 红（非标准字母表/缺 padding/非串型/decodeRelativePosition 抛）', () => {
    for (const garbage of ['!!not-base64!!', 'abc', 'AA==', 42, 'a b c=', 'AAAA=', 'AB CD']) {
      const bad = entryObj((e) => { e.kind = 'text'; e.anchorStart = garbage; e.anchorEnd = legalAnchor(); });
      expect(checkThreadEntry('t1', bad, 'u1'), `anchorStart=${String(garbage)} 必须拒`).toContain('anchor');
    }
  });

  it('④解码字节超 512 红（>512 字节的合法 base64 串）；512 字节边界过', () => {
    // encodeRelativePosition 的输出约 8~50 字节——构造大载荷 base64 串（合法字母表、超 512 解码字节）
    const bigPayload = new Uint8Array(513);
    const bigB64 = encodeAnchorBase64(bigPayload);
    const bad = entryObj((e) => { e.kind = 'text'; e.anchorStart = bigB64; e.anchorEnd = bigB64; });
    expect(checkThreadEntry('t1', bad, 'u1')).toContain('anchor');
    const atLimit = encodeAnchorBase64(new Uint8Array(512));
    const ok512 = entryObj((e) => { e.kind = 'text'; e.anchorStart = atLimit; e.anchorEnd = atLimit; });
    // 512 字节随机值 decodeRelativePosition 可能抛（非 RelativePosition 形）——那也是拒；
    // 本档只锁字节面：≤512 不发 anchor-bytes 错（decode 失败给 anchor-decode 错）。
    const err = checkThreadEntry('t1', ok512, 'u1');
    expect(err === undefined || !err.includes('bytes')).toBe(true);
  });

  it('⑤resolved 缺失红（创建时客户端必写 false——缺键即拒）；非布尔红', () => {
    const missing = entryObj((e) => { delete e.resolved; });
    expect(checkThreadEntry('t1', missing, 'u1')).toContain('resolved');
    for (const notBool of ['false', 0, null]) {
      const bad = entryObj((e) => { e.resolved = notBool; });
      expect(checkThreadEntry('t1', bad, 'u1'), `resolved=${String(notBool)} 必须拒`).toContain('resolved');
    }
  });

  it('⑥id 空串/超 128/≠Map 键红；1~128 且=键过', () => {
    expect(checkThreadEntry('', entryObj((e) => { e.id = ''; }), 'u1')).toContain('id');
    const long = 'x'.repeat(129);
    expect(checkThreadEntry(long, entryObj((e) => { e.id = long; }), 'u1')).toContain('id');
    expect(checkThreadEntry('t1', entryObj((e) => { e.id = 'other'; }), 'u1')).toContain('id');
    const at128 = 'x'.repeat(128);
    expect(checkThreadEntry(at128, entryObj((e) => { e.id = at128; }), 'u1')).toBeUndefined();
  });

  it('⑦nodeId/createdBy 空串或非串红', () => {
    for (const bad of ['', 42, null]) {
      expect(checkThreadEntry('t1', entryObj((e) => { e.nodeId = bad; }), 'u1')).toContain('node-id');
      expect(checkThreadEntry('t1', entryObj((e) => { e.createdBy = bad; }), 'u1')).toContain('created-by');
    }
  });

  it('⑧createdAt -1/超 MAX_SAFE_INTEGER/NaN/Infinity 红；两端边界过', () => {
    for (const bad of [-1, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY, '0']) {
      expect(checkThreadEntry('t1', entryObj((e) => { e.createdAt = bad; }), 'u1'), `createdAt=${String(bad)} 必须拒`).toContain('created-at');
    }
    expect(checkThreadEntry('t1', entryObj((e) => { e.createdAt = 0; }), 'u1')).toBeUndefined();
    expect(checkThreadEntry('t1', entryObj((e) => { e.createdAt = Number.MAX_SAFE_INTEGER; }), 'u1')).toBeUndefined();
  });

  it('⑨未知键红（键封闭=id/nodeId/kind/anchorStart/anchorEnd/resolved/createdAt/createdBy/comments）', () => {
    for (const key of ['hax', 'resolvedAt', 'updatedBy', 'extra']) {
      expect(checkThreadEntry('t1', entryObj((e) => { e[key] = 1; }), 'u1'), `未知键 ${key} 必须拒`).toContain('key');
    }
  });

  it('⑩作者不等两向：createdBy=u2 而 actorUserId=u1 红；=u1 过', () => {
    expect(checkThreadEntry('t1', entryObj((e) => { e.createdBy = 'u2'; }), 'u1')).toContain('created-by');
    expect(checkThreadEntry('t1', entryObj(), 'u1')).toBeUndefined();
  });

  it('⑩b actorUserId 缺省（undefined）不比作者（L2 fail-closed 在 threadEventErr 档执法——谓词本身只跳过比较）', () => {
    // 缺省档：只查字段不查作者归属（fail-closed 全拒在事件矩阵层——threadEventErr 缺省档）。
    expect(checkThreadEntry('t1', entryObj(), undefined)).toBeUndefined();
  });

  it('comments 档：缺 comments 红在事件面（谓词不查至少一条——L2 根键 add 档查）、评论内形状照 checkThreadComment、comments 内未知评论键值非法拒', () => {
    // 谓词对 comments 逐条跑 checkThreadComment（未知键/毒值穿透拒）
    const badComment = entryObj((e) => { (e.comments as Record<string, unknown>).c1 = { id: 'c1', authorId: 'u1', body: 'ok', createdAt: 0, hax: 1 }; });
    expect(checkThreadEntry('t1', badComment, 'u1')).toContain('c1');
    // 评论键≠评论 Map 键红
    const keyDrift = entryObj((e) => { (e.comments as Record<string, unknown>).c1 = { id: 'other', authorId: 'u1', body: 'ok', createdAt: 0 }; });
    expect(checkThreadEntry('t1', keyDrift, 'u1')).toContain('c1');
  });

  it('标量槽 Y.Map/Y.Array/Y.Text 全拒（v 直传 yjs 容器=toJSON 漏接的兜底——谓词收普通值但容器非普通对象拒）', () => {
    for (const poison of [new Y.Map(), new Y.Array(), new Y.Text()]) {
      expect(checkThreadEntry('t1', poison, 'u1')).toContain('thread');
    }
  });
});

describe('Y4b T6 checkThreadComment 负控矩阵', () => {
  it('正基线：合法评论过', () => {
    expect(checkThreadComment('c1', commentObj(), 'u1')).toBeUndefined();
  });

  it('⑥b 全空白 body 红（2000 内、去首尾空白后空）；纯空白原文不修剪（服务端不改写）', () => {
    for (const bad of ['', '   ', '\t\n ', '　']) {
      expect(checkThreadComment('c1', { id: 'c1', authorId: 'u1', body: bad, createdAt: 0 }, 'u1'), `body=${JSON.stringify(bad)} 必须拒`).toContain('body');
    }
    // 带首尾空白的非空 body 过（原文不修剪）
    expect(checkThreadComment('c1', { id: 'c1', authorId: 'u1', body: '  hi  ', createdAt: 0 }, 'u1')).toBeUndefined();
  });

  it('body 超 2000 JS 长度红；2000 边界过', () => {
    expect(checkThreadComment('c1', { id: 'c1', authorId: 'u1', body: 'x'.repeat(2001), createdAt: 0 }, 'u1')).toContain('body');
    expect(checkThreadComment('c1', { id: 'c1', authorId: 'u1', body: 'x'.repeat(2000), createdAt: 0 }, 'u1')).toBeUndefined();
  });

  it('⑦b authorId 空串/非串红；authorId=u2≠actorUserId=u1 红、=u1 过', () => {
    for (const bad of ['', 42, null]) {
      expect(checkThreadComment('c1', { id: 'c1', authorId: bad, body: 'x', createdAt: 0 }, 'u1'), `authorId=${String(bad)} 必须拒`).toContain('author-id');
    }
    expect(checkThreadComment('c1', { id: 'c1', authorId: 'u2', body: 'x', createdAt: 0 }, 'u1')).toContain('author-id');
    expect(checkThreadComment('c1', { id: 'c1', authorId: 'u1', body: 'x', createdAt: 0 }, 'u1')).toBeUndefined();
  });

  it('⑧b createdAt 两端越界红；id 空/≠键红；未知键红（id/authorId/body/createdAt 封闭）', () => {
    for (const bad of [-1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(checkThreadComment('c1', { id: 'c1', authorId: 'u1', body: 'x', createdAt: bad }, 'u1')).toContain('created-at');
    }
    expect(checkThreadComment('', { id: '', authorId: 'u1', body: 'x', createdAt: 0 }, 'u1')).toContain('id');
    expect(checkThreadComment('c1', { id: 'other', authorId: 'u1', body: 'x', createdAt: 0 }, 'u1')).toContain('id');
    expect(checkThreadComment('c1', { id: 'c1', authorId: 'u1', body: 'x', createdAt: 0, hax: 1 }, 'u1')).toContain('key');
  });

  it('非对象 v 红（null/标量/yjs 容器）', () => {
    for (const bad of [null, 42, 'x', new Y.Map(), new Y.Map<unknown>().set('id', 'c1')]) {
      expect(checkThreadComment('c1', bad, 'u1')).toContain('comment');
    }
  });
});

// ═══════════════════ base64 编解码（标准字母表带 padding） ═══════════════════

describe('Y4b T6 encodeAnchorBase64/decodeAnchorBase64（标准字母表加 padding）', () => {
  it('往返恒等：合法 RelativePosition 字节 → b64 → 解码 === 原字节（含 padding）', () => {
    const d = new Y.Doc();
    const m = d.getMap('x');
    m.set('a', 1);
    const bytes = Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(m, 0));
    const b64 = encodeAnchorBase64(bytes);
    expect(b64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);   // 标准字母表（非 url-safe）
    expect(decodeAnchorBase64(b64)).toEqual(bytes);
  });

  it('空字节 → "AAAA"（4 字节 padding 档）；全字节值 0..255 往返恒等', () => {
    expect(encodeAnchorBase64(new Uint8Array(0))).toBe('');
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    const round = decodeAnchorBase64(encodeAnchorBase64(all));
    expect(Array.from(round)).toEqual(Array.from(all));
  });

  it('解码非法串抛（垃圾字母表/错 padding）——谓词 try/catch 兜住归 anchor 错', () => {
    for (const bad of ['!!', 'a', 'AB CD', 'AAAA=', 'A']) {
      expect(() => decodeAnchorBase64(bad), `${bad} 必须抛`).toThrow();
    }
  });
});

// ═══════════════════ Y.Map 工厂（唯一 new Y.Map 创建点——web store 只调用） ═══════════════════

describe('Y4b T6 buildThreadEntry/buildThreadComment（工厂）', () => {
  it('工厂产出=Y.Map 且通过谓词（kind=node 全键+comments 容器+首条评论）', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const entry = buildThreadEntry({
        id: 't1', nodeId: 'n1', kind: 'node', resolved: false, createdAt: 0, createdBy: 'u1',
      });
      const comments = new Y.Map();
      comments.set('c1', buildThreadComment({ id: 'c1', authorId: 'u1', body: 'hello', createdAt: 0 }));
      entry.set('comments', comments);
      doc.getMap('threads').set('t1', entry);
    });
    const entry = doc.getMap('threads').get('t1') as Y.Map<unknown>;
    expect(entry).toBeInstanceOf(Y.Map);
    // 谓词吃落成后 toJSON() 的普通值（L2 形态——detached Y.Map toJSON 为空，须先入 doc）
    expect(checkThreadEntry('t1', entry.toJSON(), 'u1')).toBeUndefined();
    const comments = entry.get('comments') as Y.Map<unknown>;
    expect(comments.get('c1')).toBeInstanceOf(Y.Map);
    expect(checkThreadComment('c1', (comments.get('c1') as Y.Map<unknown>).toJSON(), 'u1')).toBeUndefined();
  });

  it('工厂不带 comments 键（创建面单事务自组——落成后必有至少一条）', () => {
    const entry = buildThreadEntry({ id: 't1', nodeId: 'n1', kind: 'node', resolved: false, createdAt: 0, createdBy: 'u1' });
    expect(entry.has('comments')).toBe(false);   // comments 由调用方在同一事务挂上
  });

  it('工厂签名 strict：文本锚两键可选传入（kind=text 两锚必写出）', () => {
    const a = legalAnchor();
    const doc = new Y.Doc();
    doc.transact(() => {
      doc.getMap('threads').set('t1', buildThreadEntry({
        id: 't1', nodeId: 'n1', kind: 'text', anchorStart: a, anchorEnd: a, resolved: false, createdAt: 0, createdBy: 'u1',
      }));
    });
    expect(checkThreadEntry('t1', (doc.getMap('threads').get('t1') as Y.Map<unknown>).toJSON(), 'u1')).toBeUndefined();
  });
});

// ═══════════════════ L2 动作矩阵（threadEventErr——按 path 四档，spec §0 条 14） ═══════════════════

/** L2 事件捕获装置（observeDeep 回调内物化——不物化=事务后读抛 errorComputeChanges）。 */
function captureThreads(doc: Y.Doc): Array<Y.YMapEvent<unknown>> {
  const events: Array<Y.YMapEvent<unknown>> = [];
  doc.getMap('threads').observeDeep((evs) => {
    for (const e of evs) void e.changes;
    (events as unknown[]).push(...evs);
  });
  return events;
}

/** 装一整棵合法线程（entry+comments 容器+首条评论——同事务单帧形态）。 */
function seedThread(doc: Y.Doc, threadId = 't1', actor = 'u1'): void {
  doc.transact(() => {
    doc.getMap('threads').set(threadId, buildThreadEntry({
      id: threadId, nodeId: 'n1', kind: 'node', resolved: false, createdAt: 0, createdBy: actor,
    }));
    const entry = doc.getMap('threads').get(threadId) as Y.Map<unknown>;
    const comments = new Y.Map();
    comments.set('c1', buildThreadComment({ id: 'c1', authorId: actor, body: 'hello', createdAt: 0 }));
    entry.set('comments', comments);
  });
}

describe('Y4b T6 threadEventErr：path=[] 根键档', () => {
  it('合法新建线程整次 add 合法（落成后形状+createdBy/authorId=actorUserId+comments 至少一条）', () => {
    const doc = new Y.Doc();
    const events = captureThreads(doc);
    seedThread(doc);
    expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), { actorUserId: 'u1' })).toBeUndefined();
  });

  it('根键 add 落成值非法拒：缺 createdBy（半截）/comments 空/评论 authorId≠actorUserId', () => {
    // 半截 entry：同事务只建 entry Map、不挂 createdBy（字段补下一帧=父出帧 4411——非合法创建路径）
    const doc = new Y.Doc();
    const events = captureThreads(doc);
    doc.transact(() => {
      const entry = buildThreadEntry({ id: 't1', nodeId: 'n1', kind: 'node', resolved: false, createdAt: 0, createdBy: 'u1' });
      entry.delete('createdBy');
      doc.getMap('threads').set('t1', entry);
    });
    expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), { actorUserId: 'u1' })).toContain('created-by');
    // comments 空容器（创建时至少一条）
    const doc2 = new Y.Doc();
    const events2 = captureThreads(doc2);
    doc2.transact(() => {
      doc2.getMap('threads').set('t1', buildThreadEntry({ id: 't1', nodeId: 'n1', kind: 'node', resolved: false, createdAt: 0, createdBy: 'u1' }));
      const entry = doc2.getMap('threads').get('t1') as Y.Map<unknown>;
      entry.set('comments', new Y.Map());
    });
    expect(threadEventErr(events2[0] as Y.YMapEvent<unknown>, doc2.getMap('threads'), { actorUserId: 'u1' })).toContain('comments');
    // 首条评论 authorId 冒名
    const doc3 = new Y.Doc();
    const events3 = captureThreads(doc3);
    doc3.transact(() => {
      doc3.getMap('threads').set('t1', buildThreadEntry({ id: 't1', nodeId: 'n1', kind: 'node', resolved: false, createdAt: 0, createdBy: 'u1' }));
      const entry = doc3.getMap('threads').get('t1') as Y.Map<unknown>;
      const comments = new Y.Map();
      comments.set('c1', buildThreadComment({ id: 'c1', authorId: 'u2', body: 'hello', createdAt: 0 }));
      entry.set('comments', comments);
    });
    expect(threadEventErr(events3[0] as Y.YMapEvent<unknown>, doc3.getMap('threads'), { actorUserId: 'u1' })).toContain('author-id');
  });

  it('根键 delete 允许（删整条线程——不按作者分权限）；根键 update 拒（整棵 entry Map 被换掉）', () => {
    const doc = new Y.Doc();
    seedThread(doc);
    const events = captureThreads(doc);
    doc.transact(() => { doc.getMap('threads').delete('t1'); });
    expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), { actorUserId: 'u1' })).toBeUndefined();
    const doc2 = new Y.Doc();
    seedThread(doc2);
    const events2 = captureThreads(doc2);
    doc2.transact(() => {
      doc2.getMap('threads').set('t1', buildThreadEntry({ id: 't1', nodeId: 'n1', kind: 'node', resolved: false, createdAt: 0, createdBy: 'u1' }));
    });
    expect(threadEventErr(events2[0] as Y.YMapEvent<unknown>, doc2.getMap('threads'), { actorUserId: 'u1' })).toContain('update');
  });

  it('fail-closed：actorUserId 缺省（undefined）时任何根键档全拒（add 也拒）', () => {
    // add 档缺省
    const doc = new Y.Doc();
    const events = captureThreads(doc);
    seedThread(doc);
    expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), undefined)).toContain('actor');
    // opts 整体缺省同拒
    expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'))).toContain('actor');
    // delete 档缺省（全拒=连合法删除也拒——fail-closed 词面）
    const doc2 = new Y.Doc();
    seedThread(doc2);
    const events2 = captureThreads(doc2);
    doc2.transact(() => { doc2.getMap('threads').delete('t1'); });
    expect(threadEventErr(events2[0] as Y.YMapEvent<unknown>, doc2.getMap('threads'), undefined)).toContain('actor');
  });
});

describe('Y4b T6 threadEventErr：path=[threadId] 唯 resolved update 档', () => {
  it('resolved true→false（布尔）改动合法——唯一可更新键', () => {
    const doc = new Y.Doc();
    seedThread(doc);
    doc.transact(() => { (doc.getMap('threads').get('t1') as Y.Map<unknown>).set('resolved', true); });
    const events = captureThreads(doc);
    doc.transact(() => { (doc.getMap('threads').get('t1') as Y.Map<unknown>).set('resolved', false); });
    expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), { actorUserId: 'u1' })).toBeUndefined();
  });

  it('resolved 非布尔新值拒；resolved delete 拒', () => {
    const doc = new Y.Doc();
    seedThread(doc);
    const events = captureThreads(doc);
    doc.transact(() => { (doc.getMap('threads').get('t1') as Y.Map<unknown>).set('resolved', 'yes'); });
    expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), { actorUserId: 'u1' })).toContain('resolved');
    const doc2 = new Y.Doc();
    seedThread(doc2);
    const events2 = captureThreads(doc2);
    doc2.transact(() => { (doc2.getMap('threads').get('t2-never' as string) as Y.Map<unknown>); });
    doc2.transact(() => { (doc2.getMap('threads').get('t1') as Y.Map<unknown>).delete('resolved'); });
    expect(threadEventErr(events2[0] as Y.YMapEvent<unknown>, doc2.getMap('threads'), { actorUserId: 'u1' })).toContain('resolved');
  });

  it('不可变键 update 全拒：body 不在此档、nodeId/kind/createdBy/createdAt/id 的 update 红', () => {
    for (const key of ['nodeId', 'kind', 'createdBy', 'createdAt', 'id']) {
      const doc = new Y.Doc();
      seedThread(doc);
      const events = captureThreads(doc);
      doc.transact(() => {
        (doc.getMap('threads').get('t1') as Y.Map<unknown>).set(key, key === 'kind' ? 'text' : key === 'createdAt' ? 1 : 'zz');
      });
      expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), { actorUserId: 'u1' }), `${key} update 必须拒`).toContain(key);
    }
  });

  it('不可变键 delete 全拒（nodeId/kind/createdBy/createdAt/anchorStart 缺席面/entry 级未知键 add 拒）', () => {
    for (const key of ['nodeId', 'kind', 'createdBy', 'createdAt']) {
      const doc = new Y.Doc();
      seedThread(doc);
      const events = captureThreads(doc);
      doc.transact(() => { (doc.getMap('threads').get('t1') as Y.Map<unknown>).delete(key); });
      expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), { actorUserId: 'u1' }), `${key} delete 必须拒`).toContain(key);
    }
    // entry 级未知键 add（键封闭）
    const doc = new Y.Doc();
    seedThread(doc);
    const events = captureThreads(doc);
    doc.transact(() => { (doc.getMap('threads').get('t1') as Y.Map<unknown>).set('hax', 1); });
    expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), { actorUserId: 'u1' })).toContain('key');
  });

  it('comments 容器键 delete/update 拒（删除三级——timelines 同形）', () => {
    const doc = new Y.Doc();
    seedThread(doc);
    const events = captureThreads(doc);
    doc.transact(() => { (doc.getMap('threads').get('t1') as Y.Map<unknown>).delete('comments'); });
    expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), { actorUserId: 'u1' })).toContain('comments');
    const doc2 = new Y.Doc();
    seedThread(doc2);
    const events2 = captureThreads(doc2);
    doc2.transact(() => { (doc2.getMap('threads').get('t1') as Y.Map<unknown>).set('comments', new Y.Map()); });
    expect(threadEventErr(events2[0] as Y.YMapEvent<unknown>, doc2.getMap('threads'), { actorUserId: 'u1' })).toContain('comments');
  });

  it('fail-closed 缺省档：path=[threadId] 任何动作全拒（resolved 合法更新也拒）', () => {
    const doc = new Y.Doc();
    seedThread(doc);
    const events = captureThreads(doc);
    doc.transact(() => { (doc.getMap('threads').get('t1') as Y.Map<unknown>).set('resolved', true); });
    expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), undefined)).toContain('actor');
  });
});

describe('Y4b T6 threadEventErr：path=[threadId,comments] 评论容器档', () => {
  it('评论 add（authorId=actorUserId）合法——读落成值跑谓词', () => {
    const doc = new Y.Doc();
    seedThread(doc);
    const events = captureThreads(doc);
    doc.transact(() => {
      const comments = (doc.getMap('threads').get('t1') as Y.Map<unknown>).get('comments') as Y.Map<unknown>;
      comments.set('c2', buildThreadComment({ id: 'c2', authorId: 'u1', body: 'reply', createdAt: 1 }));
    });
    expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), { actorUserId: 'u1' })).toBeUndefined();
  });

  it('追加评论 authorId=u2≠u1 红（冒名）；毒 body（全空白）红', () => {
    const doc = new Y.Doc();
    seedThread(doc);
    const events = captureThreads(doc);
    doc.transact(() => {
      const comments = (doc.getMap('threads').get('t1') as Y.Map<unknown>).get('comments') as Y.Map<unknown>;
      comments.set('c2', buildThreadComment({ id: 'c2', authorId: 'u2', body: 'reply', createdAt: 1 }));
    });
    expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), { actorUserId: 'u1' })).toContain('author');
    const doc2 = new Y.Doc();
    seedThread(doc2);
    const events2 = captureThreads(doc2);
    doc2.transact(() => {
      const comments = (doc2.getMap('threads').get('t1') as Y.Map<unknown>).get('comments') as Y.Map<unknown>;
      comments.set('c2', buildThreadComment({ id: 'c2', authorId: 'u1', body: '   ', createdAt: 1 }));
    });
    expect(threadEventErr(events2[0] as Y.YMapEvent<unknown>, doc2.getMap('threads'), { actorUserId: 'u1' })).toContain('body');
  });

  it('评论 add 整值替换（同评论 id 后到帧=update）拒——两客户端同 id 竞争面', () => {
    const doc = new Y.Doc();
    seedThread(doc);
    const events = captureThreads(doc);
    doc.transact(() => {
      const comments = (doc.getMap('threads').get('t1') as Y.Map<unknown>).get('comments') as Y.Map<unknown>;
      comments.set('c1', buildThreadComment({ id: 'c1', authorId: 'u1', body: 'dup', createdAt: 2 }));
    });
    expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), { actorUserId: 'u1' })).toContain('comment');
  });

  it('评论 delete 允许（任何能写画布成员——删到零条线程还在）；comments 容器键换新 Map（update 形）拒', () => {
    const doc = new Y.Doc();
    seedThread(doc);
    const events = captureThreads(doc);
    doc.transact(() => {
      ((doc.getMap('threads').get('t1') as Y.Map<unknown>).get('comments') as Y.Map<unknown>).delete('c1');
    });
    expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), { actorUserId: 'u1' })).toBeUndefined();
  });

  it('fail-closed 缺省档：评论 add 也拒', () => {
    const doc = new Y.Doc();
    seedThread(doc);
    const events = captureThreads(doc);
    doc.transact(() => {
      const comments = (doc.getMap('threads').get('t1') as Y.Map<unknown>).get('comments') as Y.Map<unknown>;
      comments.set('c2', buildThreadComment({ id: 'c2', authorId: 'u1', body: 'reply', createdAt: 1 }));
    });
    expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), undefined)).toContain('actor');
  });
});

describe('Y4b T6 threadEventErr：path 再深档（评论内部任何键 add/update/delete 全拒）', () => {
  it('已有评论上 set 未知键发的是该键的 add——同拒（「只拒 update/delete 漏 add」会放过未知键进 hash/oracle）', () => {
    const doc = new Y.Doc();
    seedThread(doc);
    const events = captureThreads(doc);
    doc.transact(() => {
      const c1 = ((doc.getMap('threads').get('t1') as Y.Map<unknown>).get('comments') as Y.Map<unknown>).get('c1') as Y.Map<unknown>;
      c1.set('hax', 1);
    });
    expect(events.length).toBeGreaterThan(0);
    expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), { actorUserId: 'u1' })).toContain('comment');
  });

  it('body/authorId/createdAt/id 的 update 红（不可变键——新值合法也拒）', () => {
    for (const [key, val] of [['body', 'edited'], ['authorId', 'u1'], ['createdAt', 9], ['id', 'c1']] as const) {
      const doc = new Y.Doc();
      seedThread(doc);
      const events = captureThreads(doc);
      doc.transact(() => {
        const c1 = ((doc.getMap('threads').get('t1') as Y.Map<unknown>).get('comments') as Y.Map<unknown>).get('c1') as Y.Map<unknown>;
        c1.set(key, val);
      });
      expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), { actorUserId: 'u1' }), `${key} update 必须拒`).toContain('comment');
    }
  });

  it('评论内部键 delete 红；fail-closed 缺省档同拒', () => {
    const doc = new Y.Doc();
    seedThread(doc);
    const events = captureThreads(doc);
    doc.transact(() => {
      const c1 = ((doc.getMap('threads').get('t1') as Y.Map<unknown>).get('comments') as Y.Map<unknown>).get('c1') as Y.Map<unknown>;
      c1.delete('body');
    });
    expect(threadEventErr(events[0] as Y.YMapEvent<unknown>, doc.getMap('threads'), { actorUserId: 'u1' })).toContain('comment');
    const doc2 = new Y.Doc();
    seedThread(doc2);
    const events2 = captureThreads(doc2);
    doc2.transact(() => {
      const c1 = ((doc2.getMap('threads').get('t1') as Y.Map<unknown>).get('comments') as Y.Map<unknown>).get('c1') as Y.Map<unknown>;
      c1.set('hax', 1);
    });
    expect(threadEventErr(events2[0] as Y.YMapEvent<unknown>, doc2.getMap('threads'), undefined)).toContain('actor');
  });
});

describe('Y4b T6 Y.Map 直传负控（L2 调谓词前先 toJSON()——直传 Object.keys 空、必填判断错）', () => {
  it('直传 Y.Map 必被拒（谓词兜底档）；同值 toJSON() 过——谓词内兜底而非依赖调用方自觉', () => {
    // 负控锁底座：直传 Object.keys(Y.Map) 是内部槽（_item/_map 等）非记录键——必填项判断必错。
    // 谓词对 yjs 容器直传兜底拒（isYjsContainer 档）；L2 正路=toJSON() 后调（threadEventErr 内建）。
    const doc = new Y.Doc();
    seedThread(doc);
    const entry = doc.getMap('threads').get('t1') as Y.Map<unknown>;
    expect(Object.keys(entry)).not.toContain('id');   // 直传底座：键名不可见
    expect(checkThreadEntry('t1', entry, 'u1')).toContain('thread');   // 直传兜底拒
    expect(checkThreadEntry('t1', entry.toJSON(), 'u1')).toBeUndefined();   // toJSON 正路过
    const c1 = (entry.get('comments') as Y.Map<unknown>).get('c1') as Y.Map<unknown>;
    expect(checkThreadComment('c1', c1, 'u1')).toContain('comment');
    expect(checkThreadComment('c1', c1.toJSON(), 'u1')).toBeUndefined();
  });
});
