// packages/shared/src/canvas/threads-frame-predicate.ts
// Y4b T6（plan 2026-11-22-y4b-annotation-security Task 6——spec §0 条 6/7/14〔§2.1 键矩阵/§2.3 单源〕）：
// threads 批注域帧谓词——**三路同函数单源**（纯字段检查吃普通值）：L1 frame-deny 深链档（Task 7 接线
// ——framePathOf 把本帧 ContentAny 收成的普通对象）、L2 validateAppliedL2 threads 分支（Task 7 接线
// ——落成后 entry 先 toJSON() 再调）、客户端 threadsStore 写前自检（Task 10——将写对象）。
//
// 执法语义（spec §0 条 6/7/14）：
//  - **fail-closed**：opts.actorUserId 缺省（undefined）=任何 threads 变更全拒（不是跳过作者比较）。
//  - resolved 必写布尔（创建时客户端写 false——缺键即拒）。
//  - 评论 id 1~128 且等于 Map 键；线程键封闭=id/nodeId/kind/anchorStart/anchorEnd/resolved/
//    createdAt/createdBy/comments；评论键封闭=id/authorId/body/createdAt。
//  - 锚 base64 标准字母表带 padding、**解码后字节 ≤512**、Y.decodeRelativePosition 不抛。
//  - L2 按事件 path 四档执法（实测 yjs 13.6.32：同帧建线程只发根上一条 add；后补评论=path=
//    [threadId,comments] add；改 resolved=path=[threadId] update；**已有评论上 set 未知键发的是
//    该键的 add——「只拒 update/delete 漏 add」会放过未知键进真空拷贝/维护 hash/oracle**）。
//  - Y.Map 直传谓词前先 toJSON()（直传 Object.keys 空、必填判断错）——谓词对 yjs 容器直传兜底拒。
//  - 半截 entry（Map 在帧内但必填键不齐）由谓词字段齐备性检查拒（L1 档 Task 7 落）。
import * as Y from 'yjs';

/** 线程 entry 键封闭集（spec §2.1 键矩阵——未知键拒）。 */
const THREAD_ENTRY_KEYS = new Set(['id', 'nodeId', 'kind', 'anchorStart', 'anchorEnd', 'resolved', 'createdAt', 'createdBy', 'comments']);
/** 评论键封闭集。 */
const THREAD_COMMENT_KEYS = new Set(['id', 'authorId', 'body', 'createdAt']);
/** kind 封闭枚举。 */
const THREAD_KINDS = new Set(['node', 'text']);
/** 锚 base64 解码字节上限（spec §0 条 14——「≤512」一律按解码后字节计）。 */
export const ANCHOR_MAX_BYTES = 512;
/** 线程/评论 id 长度上限（1~128 且=Map 键）。 */
const THREAD_ID_MAX = 128;
/** body JS 长度上限（1~2000、去首尾空白仍非空、原文不修剪）。 */
const THREAD_BODY_MAX = 2000;
/** yjs 容器污染判定（直传 Y.Map/Y.Array/Y.Text=非普通值——toJSON() 漏接的兜底拒）。 */
const isYjsContainer = (v: unknown): boolean =>
  v instanceof Y.Map || v instanceof Y.Array || v instanceof Y.Text;
/** 有限数档（createdAt∈[0,MAX_SAFE_INTEGER]——不和服务器时钟比较）。 */
const isCreatedAt = (v: unknown): boolean =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
/** id 档：非空串 1~128 且=Map 键。 */
const idOk = (id: string, v: unknown): boolean =>
  typeof v === 'string' && v !== '' && v.length <= THREAD_ID_MAX && v === id;

/** 锚键档：标准带 padding base64、解码后字节 ≤512、Y.decodeRelativePosition 不抛。 */
function anchorErr(id: string, anchorKey: string, v: unknown): string | undefined {
  if (typeof v !== 'string') return `thread-anchor:${id}.${anchorKey}`;
  let bytes: Uint8Array;
  try {
    bytes = decodeAnchorBase64(v);
  } catch {
    return `thread-anchor:${id}.${anchorKey}`;
  }
  if (bytes.byteLength > ANCHOR_MAX_BYTES) return `thread-anchor:${id}.${anchorKey}-bytes`;
  try {
    Y.decodeRelativePosition(bytes);
  } catch {
    return `thread-anchor:${id}.${anchorKey}-decode`;
  }
  return undefined;
}

/**
 * 线程 entry 字段执法（三路同函数——L1 framePathOf 收成/L2 落成后 toJSON/客户端将写对象）。
 * v=entry 整体普通值；actorUserId 给定时 createdBy 必须相等、每条评论 authorId 必须相等；
 * comments 逐条跑 checkThreadComment（「至少一条」不归本谓词——L2 根键 add 档执法）。
 * 返回 undefined=通过。
 */
export function checkThreadEntry(id: string, v: unknown, actorUserId?: string): string | undefined {
  if (isYjsContainer(v) || typeof v !== 'object' || v === null) return `thread-entry:${id}`;
  const e = v as Record<string, unknown>;
  for (const k of Object.keys(e)) {
    if (!THREAD_ENTRY_KEYS.has(k)) return `thread-entry-key:${id}.${k}`;
  }
  if (!idOk(id, e.id)) return `thread-id:${id}`;
  if (typeof e.kind !== 'string' || !THREAD_KINDS.has(e.kind)) return `thread-kind:${id}`;
  if (e.kind === 'text') {
    for (const anchorKey of ['anchorStart', 'anchorEnd'] as const) {
      if (e[anchorKey] === undefined) return `thread-anchor-missing:${id}.${anchorKey}`;
      const aErr = anchorErr(id, anchorKey, e[anchorKey]);
      if (aErr !== undefined) return aErr;
    }
  } else {
    // kind='node'——两锚键必须不存在
    for (const anchorKey of ['anchorStart', 'anchorEnd'] as const) {
      if (e[anchorKey] !== undefined) return `thread-anchor-forbidden:${id}.${anchorKey}`;
    }
  }
  if (typeof e.nodeId !== 'string' || e.nodeId === '') return `thread-node-id:${id}`;
  if (typeof e.resolved !== 'boolean') return `thread-resolved:${id}`;
  if (!isCreatedAt(e.createdAt)) return `thread-created-at:${id}`;
  if (typeof e.createdBy !== 'string' || e.createdBy === '') return `thread-created-by:${id}`;
  if (actorUserId !== undefined && e.createdBy !== actorUserId) return `thread-created-by:${id}`;
  if (e.comments !== undefined) {
    // comments=Y.Map 容器（spec §2.1 键矩阵）——数组形拒（Object.entries 把下标当 Map 键、
    // 「评论 id=Map 键」退化为下标；timeline 先例 tracks/clips/keyframes 同为 instanceof 类型封闭）。
    if (Array.isArray(e.comments) || isYjsContainer(e.comments) || typeof e.comments !== 'object') return `thread-comments:${id}`;
    const comments = e.comments as Record<string, unknown>;
    for (const [cid, cv] of Object.entries(comments)) {
      const cErr = checkThreadComment(cid, cv, actorUserId);
      if (cErr !== undefined) return cErr;
    }
  }
  return undefined;
}

/**
 * 评论字段执法（三路同函数）：authorId 非空串（actorUserId 给定时必须相等）；body JS 长度
 * 1~2000、去首尾空白仍非空、原文不修剪；createdAt 同 entry 档；未知键拒。返回 undefined=通过。
 */
export function checkThreadComment(id: string, v: unknown, actorUserId?: string): string | undefined {
  if (isYjsContainer(v) || typeof v !== 'object' || v === null) return `thread-comment:${id}`;
  const c = v as Record<string, unknown>;
  for (const k of Object.keys(c)) {
    if (!THREAD_COMMENT_KEYS.has(k)) return `thread-comment-key:${id}.${k}`;
  }
  if (!idOk(id, c.id)) return `thread-comment-id:${id}`;
  if (typeof c.authorId !== 'string' || c.authorId === '') return `thread-author-id:${id}`;
  if (actorUserId !== undefined && c.authorId !== actorUserId) return `thread-author-id:${id}`;
  if (typeof c.body !== 'string' || c.body.length < 1 || c.body.length > THREAD_BODY_MAX) return `thread-body:${id}`;
  if (c.body.trim() === '') return `thread-body:${id}`;
  if (!isCreatedAt(c.createdAt)) return `thread-comment-created-at:${id}`;
  return undefined;
}

// ═══════════════════ base64（标准字母表带 padding——Buffer 等价自实现，无 DOM 假设） ═══════════════════

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_REV: Record<string, number> = {};
for (let i = 0; i < B64_ALPHABET.length; i++) B64_REV[B64_ALPHABET[i]!] = i;

/** 字节 → 标准 base64（带 padding；禁 url-safe）。空字节 → 空串。 */
export function encodeAnchorBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes.length > i + 1 ? bytes[i + 1]! : 0;
    const b2 = bytes.length > i + 2 ? bytes[i + 2]! : 0;
    out += B64_ALPHABET[b0 >> 2]!;
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]!;
    out += bytes.length > i + 1 ? B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]! : '=';
    out += bytes.length > i + 2 ? B64_ALPHABET[b2 & 0x3f]! : '=';
  }
  return out;
}

/** 标准 base64（带 padding）→ 字节；非法输入抛（长度非 4 倍/非标准字母表——谓词 try/catch 归锚错）。 */
export function decodeAnchorBase64(s: string): Uint8Array {
  if (typeof s !== 'string' || s.length === 0) return new Uint8Array(0);
  if (s.length % 4 !== 0) throw new Error('thread-b64-length');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const body = pad > 0 ? s.slice(0, -pad) : s;
  for (const ch of s) {
    if (ch === '=') continue;
    if (B64_REV[ch] === undefined) throw new Error('thread-b64-alphabet');
  }
  const out: number[] = [];
  for (let i = 0; i < body.length; i += 4) {
    const n0 = B64_REV[body[i]!]!;
    const n1 = B64_REV[body[i + 1]!]!;
    const n2 = body.length > i + 2 ? B64_REV[body[i + 2]!]! : 0;
    const n3 = body.length > i + 3 ? B64_REV[body[i + 3]!]! : 0;
    out.push((n0 << 2) | (n1 >> 4));
    if (body.length > i + 2) out.push(((n1 & 0x0f) << 4) | (n2 >> 2));
    if (body.length > i + 3) out.push(((n2 & 0x03) << 6) | n3);
  }
  return new Uint8Array(out);
}

// ═══════════════════ Y.Map 工厂（唯一 new Y.Map 创建点——web store 只调用不自建） ═══════════════════

/** 线程 entry 工厂入参（kind='text' 时两锚必传）。 */
export interface ThreadEntryInit {
  id: string;
  nodeId: string;
  kind: 'node' | 'text';
  anchorStart?: string;
  anchorEnd?: string;
  resolved: boolean;
  createdAt: number;
  createdBy: string;
}

/** 评论工厂入参。 */
export interface ThreadCommentInit {
  id: string;
  authorId: string;
  body: string;
  createdAt: number;
}

/** 线程 entry Y.Map 工厂（本模块=threads 域唯一 `new Y.Map` 创建点——含 comments 容器预建
 *  〔spec §2.1 键矩阵 comments=Y.Map 容器/§3.1 createThread 单事务=envelope+comments 容器+
 *  首条评论——census 组㉓ 只扫 apps 生产文件，写在 web store 会红；timeline 的 Map 创建在
 *  shared timeline-codec 同一先例〕）。调用方同事务挂首条评论（L2 根键 add 的
 *  comments-empty 拒兜住漏挂——创建时至少一条 spec §2.1）。 */
export function buildThreadEntry(init: ThreadEntryInit): Y.Map<unknown> {
  const entry = new Y.Map<unknown>();
  entry.set('id', init.id);
  entry.set('nodeId', init.nodeId);
  entry.set('kind', init.kind);
  if (init.kind === 'text') {
    entry.set('anchorStart', init.anchorStart);
    entry.set('anchorEnd', init.anchorEnd);
  }
  entry.set('resolved', init.resolved);
  entry.set('createdAt', init.createdAt);
  entry.set('createdBy', init.createdBy);
  entry.set('comments', new Y.Map<unknown>());
  return entry;
}

/** 评论 Y.Map 工厂（同上——唯一创建点）。 */
export function buildThreadComment(init: ThreadCommentInit): Y.Map<unknown> {
  const comment = new Y.Map<unknown>();
  comment.set('id', init.id);
  comment.set('authorId', init.authorId);
  comment.set('body', init.body);
  comment.set('createdAt', init.createdAt);
  return comment;
}

// ═══════════ L2：apply 后事件动作矩阵（spec §0 条 14——按 path 四档；实测 yjs 13.6.32 形状） ═══════════

/** threadsRoot 身份约定=安装观察者时拿到的那棵根（调用方 getMap 一次传入；谓词内不再 getMap）。 */
export interface ThreadEventOptions { actorUserId?: string }

/**
 * threads 事件执法（L2 currentTarget 身份分支的谓词体——Task 7 接线 validateAppliedL2 循环第一行）。
 * 按事件 path 四档：
 *  - path=[]（根键）：add→读落成后整棵值 toJSON() 跑 checkThreadEntry+每条评论（createdBy/authorId=
 *    actorUserId、comments 至少一条）；delete→允许（删整条线程）；update→拒（整棵 entry 被换）。
 *  - path=[threadId]：只有 resolved 的 update 且新值布尔允许；其余任何键 add/update/delete 拒；
 *    comments 容器键不允许任何动作。
 *  - path=[threadId,comments]：add→读落成值跑 checkThreadComment；delete→允许；update→拒。
 *  - path 再深（评论内部）：add/update/delete 全拒（**已有评论上 set 未知键发的是该键的 add**
 *    ——「只拒 update/delete 漏 add」会放过未知键进 hash/oracle）。
 * **actorUserId 缺省=任何 threads 变更全拒（fail-closed——不是跳过作者比较）**。
 * ev.changes 由 actor 观察者回调内物化（Task 8 接线——不物化=事务后读抛 errorComputeChanges）。
 */
export function threadEventErr(ev: Y.YMapEvent<unknown>, threadsRoot: Y.Map<unknown>, opts?: ThreadEventOptions): string | undefined {
  const actorUserId = opts?.actorUserId;
  if (actorUserId === undefined) return 'thread-actor-missing';   // fail-closed：缺省=任何变更全拒
  const path = ev.path as readonly string[];
  const changes = ev.changes;   // 物化面（观察者回调内已读——本函数在事务外消费）
  if (path.length === 0) {
    // 根键档：keys=threads.<threadId>
    for (const [threadId, ch] of changes.keys) {
      if (ch.action === 'delete') continue;   // 删整条线程=合法（不按作者分权限）
      if (ch.action === 'update') return `thread-root-update:${threadId}`;   // 整棵 entry Map 被换掉
      // add：读落成后整棵值（同事务 new Y.Map 子树不发独立事件——只查「这是个 Map」漏掉整棵新线程）
      const cur = threadsRoot.get(threadId);
      if (!(cur instanceof Y.Map)) return `thread-entry:${threadId}`;
      const plain = cur.toJSON() as unknown;
      const entryErr = checkThreadEntry(threadId, plain, actorUserId);
      if (entryErr !== undefined) return entryErr;
      const comments = plain !== null && typeof plain === 'object' ? (plain as Record<string, unknown>)['comments'] : undefined;
      // comments=Y.Map 容器（spec §2.1）——数组形拒（Object.keys([x]).length===1 会过「至少一条」档）
      if (comments === undefined || comments === null || Array.isArray(comments) || typeof comments !== 'object') return `thread-comments:${threadId}`;
      const commentCount = Object.keys(comments as Record<string, unknown>).length;
      if (commentCount === 0) return `thread-comments-empty:${threadId}`;   // 创建时至少一条评论
    }
    return undefined;
  }
  const threadId = path[0] ?? '';
  if (path.length === 1) {
    // entry 直接键档：只有 resolved update（布尔）合法——其余任何键任何动作拒（不可变键+键封闭）
    for (const [k, ch] of changes.keys) {
      if (k === 'resolved') {
        if (ch.action !== 'update') return `thread-resolved-${ch.action}:${threadId}`;   // add/delete 拒
        const cur = (ev.target as unknown as { get?: (kk: string) => unknown })?.get?.('resolved');
        if (typeof cur !== 'boolean') return `thread-resolved:${threadId}`;
        continue;
      }
      if (k === 'comments') return `thread-comments-${ch.action}:${threadId}`;   // 容器键任何动作拒
      // 其余键（id/nodeId/kind/anchorStart/anchorEnd/createdAt/createdBy/未知）：add/update/delete 全拒
      return `thread-key-${ch.action}:${threadId}.${k}`;
    }
    return undefined;
  }
  const seg1 = path[1] ?? '';
  if (seg1 !== 'comments') return `thread-entry-key:${threadId}.${seg1}`;   // entry 下钻只认 comments
  if (path.length === 2) {
    // 评论容器档：keys=commentId（后补评论 add 读落成值跑谓词；同 id 后到帧=update 拒；delete 合法）
    for (const [cid, ch] of changes.keys) {
      if (ch.action === 'delete') continue;   // 删评论条目=合法（删到零条线程还在）
      if (ch.action === 'update') return `thread-comment-update:${cid}`;   // 两客户端同评论 id 后到帧
      // add：读落成值（同帧建好不发独立键事件——后补评论本体；toJSON 后跑谓词）
      const cur = (ev.target as unknown as { get?: (kk: string) => unknown })?.get?.(cid);
      if (!(cur instanceof Y.Map)) return `thread-comment:${cid}`;
      const cErr = checkThreadComment(cid, cur.toJSON(), actorUserId);
      if (cErr !== undefined) return cErr;
    }
    return undefined;
  }
  // path 再深（评论内部任何键）：add/update/delete 全拒——**未知键 add 含在拒内**（实测：已有评论上
  // set 未知键发的是该键的 add；「只拒 update/delete」会放过未知键写进已有评论、进真空拷贝/hash/oracle）。
  const cid = path[2] ?? '';
  for (const [k, ch] of changes.keys) {
    return `thread-comment-key-${ch.action}:${cid}.${k}`;
  }
  return undefined;
}
