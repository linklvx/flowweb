// apps/web/src/stores/threadsStore.ts
// Y4b T10（plan 2026-11-22-y4b-annotation-security Task 10——spec §2.5/§3.1）：threads 批注写链+投影。
// 八导出：attachThreads/setSessionUserId/五写动作/threadsView$+subscribeThreadsView（themeStore
// listeners Set 形态）。纪律：
//  - 本文件**零 `new Y.Map`**（census 组㉓ 只扫 apps 生产面）——entry/comment 一律走 shared 工厂。
//  - 五动作全 threads-user origin（undo-policy THREADS_ORIGIN，不入任何撤销栈）；getSynced() 为假
//    或 sessionUserId===null 时全部零事务先闸（前四返 false、cleanupOrphans 返 -1）；null 直接闸，
//    不把 undefined 传进谓词指望它跳过作者比较（谓词 fail-closed 语义）。
//  - 写前谓词=Task 6 同函数（checkThreadEntry 递归含 checkThreadComment+sessionUserId 作者比较）。
//  - 观察者只做投影：任何 origin（含 threads-user）都从 doc 重算视图——纯读无写回、无回声跳过面。
import * as Y from 'yjs';
import {
  THREADS_ORIGIN,
  buildThreadComment,
  buildThreadEntry,
  checkThreadEntry,
  checkThreadComment,
  decodeAnchorBase64,
  genId,
} from '@flowweb/shared';
import { resolveNodeXmlFragment } from '@/collab/yXmlFragmentBinding';

export interface ThreadViewItem {
  id: string;
  nodeId: string;
  kind: 'node' | 'text';
  resolved: boolean;
  excerpt?: string;
  createdAt: number;
  comments: { id: string; authorId: string; body: string; createdAt: number }[];
}

export interface ThreadsViewData {
  active: Array<{ nodeId: string; threads: ThreadViewItem[] }>;
  resolved: ThreadViewItem[];
  orphan: ThreadViewItem[];
}

/** 摘录上限（spec §2.5——最多 80 个 UTF-16 码元，投影侧截取不回写）。 */
const EXCERPT_MAX = 80;

/** Y.Map 类型守卫（`instanceof` 直接收窄到 Y.Map<any>——谓词面统一收到 unknown 值域）。 */
const isMap = (value: unknown): value is Y.Map<unknown> => value instanceof Y.Map;

/** XmlText 文本取值（yjs 声明 toString():any——收口到 string，禁 any 逃逸）。 */
function xmlTextString(text: Y.XmlText): string {
  const value: unknown = text.toString();
  return typeof value === 'string' ? value : '';
}

/** 会话用户（page.tsx 从 AuthContext 挂载；null=写闸）。 */
let sessionUserId: string | null = null;

interface Attachment {
  doc: Y.Doc;
  getSynced: () => boolean;
  threads: Y.Map<unknown>;
  nodes: Y.Map<unknown>;
  watched: Set<Y.XmlFragment>;
  onThreads: () => void;
  onNodes: () => void;
  onAnchor: () => void;
  onDestroy: () => void;
}

let attachment: Attachment | null = null;
const listeners = new Set<() => void>();

export function setSessionUserId(uid: string | null): void {
  sessionUserId = uid;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** 锚类型的最近 XmlFragment 祖先（绝对位置的 type 可能是深度嵌套的 XmlText）。 */
function fragmentOf(type: Y.AbstractType<unknown>): Y.XmlFragment | null {
  let node: Y.AbstractType<unknown> = type;
  for (;;) {
    if (node instanceof Y.XmlFragment) return node;
    const parent = node._item === null ? null : node._item.parent;
    if (!(parent instanceof Y.AbstractType)) return null;
    node = parent;
  }
}

/** 锚解码+落位（base64→RelativePosition→绝对位置；失败返 null——投影层归孤儿）。 */
function resolveAnchor(raw: unknown, doc: Y.Doc): Y.AbsolutePosition | null {
  if (typeof raw !== 'string') return null;
  try {
    return Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(decodeAnchorBase64(raw)), doc);
  } catch {
    return null;
  }
}

function isInside(fragment: Y.XmlFragment, type: Y.AbstractType<unknown>): boolean {
  if (type === fragment) return true;
  return type._item !== null && Y.isParentOf(fragment, type._item);
}

/** fragment 内 XmlText 深度优先序（跨文本节点比较两端顺序用）。 */
function collectXmlTexts(node: Y.XmlFragment, out: Y.XmlText[]): void {
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) out.push(child);
    else if (child instanceof Y.XmlElement) collectXmlTexts(child, out);
  }
}

/** 锚定窗口文本（最多 80 码元；两端同文本且未颠倒时按窗口，否则从起点起截）。
 *  存活锚（可解析到 XmlText）即使线程归孤儿也带摘录（spec §2.5——只读展示不回写）。 */
function excerptOf(start: Y.AbsolutePosition | null, end: Y.AbsolutePosition | null): string | undefined {
  if (!start || !(start.type instanceof Y.XmlText)) return undefined;
  const text = xmlTextString(start.type);
  if (end && end.type === start.type && end.index >= start.index) {
    return text.slice(start.index, Math.min(end.index, start.index + EXCERPT_MAX));
  }
  return text.slice(start.index, start.index + EXCERPT_MAX);
}

/** text 线程判定+摘录：node 缺/片段缺/解码落位失败/落位异片段/两端颠倒=孤儿（spec §2.5）。 */
function analyzeText(a: Attachment, entry: Y.Map<unknown>): { orphan: boolean; excerpt?: string } {
  const nodeId = entry.get('nodeId');
  const fragment = typeof nodeId === 'string' ? resolveNodeXmlFragment(a.doc, nodeId, 'content') : null;
  const start = resolveAnchor(entry.get('anchorStart'), a.doc);
  const end = resolveAnchor(entry.get('anchorEnd'), a.doc);
  const excerpt = excerptOf(start, end);
  const withExcerpt = excerpt === undefined ? {} : { excerpt };
  if (!fragment) return { orphan: true, ...withExcerpt };
  if (!start || !end) return { orphan: true };
  if (!isInside(fragment, start.type) || !isInside(fragment, end.type)) return { orphan: true, ...withExcerpt };
  if (!(start.type instanceof Y.XmlText) || !(end.type instanceof Y.XmlText)) return { orphan: true };
  const texts: Y.XmlText[] = [];
  collectXmlTexts(fragment, texts);
  const startOrder = texts.indexOf(start.type);
  const endOrder = texts.indexOf(end.type);
  if (startOrder < 0 || endOrder < 0 || startOrder > endOrder) return { orphan: true, ...withExcerpt };
  if (start.type === end.type && start.index > end.index) return { orphan: true, ...withExcerpt };
  return { orphan: false, ...withExcerpt };
}

/** 线程判定+摘录（kind='node' 判 nodeId∈nodes 根；kind='text' 走锚解析）。 */
function analyze(a: Attachment, entry: Y.Map<unknown>): { orphan: boolean; excerpt?: string } {
  if (entry.get('kind') === 'text') return analyzeText(a, entry);
  const nodeId = entry.get('nodeId');
  return { orphan: typeof nodeId !== 'string' || !a.nodes.has(nodeId) };
}

/** 文本锚 content 片段订阅同步（threads/nodes 变化时重算；只读、零写回）。 */
function syncWatched(a: Attachment): void {
  const desired = new Set<Y.XmlFragment>();
  a.threads.forEach((raw) => {
    if (!isMap(raw) || raw.get('kind') !== 'text') return;
    const nodeId = raw.get('nodeId');
    if (typeof nodeId !== 'string') return;
    const own = resolveNodeXmlFragment(a.doc, nodeId, 'content');
    if (own) desired.add(own);
    for (const key of ['anchorStart', 'anchorEnd'] as const) {
      const position = resolveAnchor(raw.get(key), a.doc);
      if (!position) continue;
      const location = fragmentOf(position.type);
      if (location) desired.add(location);
    }
  });
  for (const fragment of a.watched) {
    if (desired.has(fragment)) continue;
    fragment.unobserveDeep(a.onAnchor);
    a.watched.delete(fragment);
  }
  for (const fragment of desired) {
    if (a.watched.has(fragment)) continue;
    fragment.observeDeep(a.onAnchor);
    a.watched.add(fragment);
  }
}

function detachAttachments(): void {
  const a = attachment;
  if (!a) return;
  attachment = null;
  a.threads.unobserveDeep(a.onThreads);
  a.nodes.unobserve(a.onNodes);
  a.doc.off('destroy', a.onDestroy);
  for (const fragment of a.watched) fragment.unobserveDeep(a.onAnchor);
  a.watched.clear();
}

export function attachThreads(doc: Y.Doc, getSynced: () => boolean): void {
  if (attachment && attachment.doc === doc) {
    attachment.getSynced = getSynced;
    return;
  }
  detachAttachments();
  const threads = doc.getMap('threads');
  const nodes = doc.getMap('nodes');
  const a: Attachment = {
    doc,
    getSynced,
    threads,
    nodes,
    watched: new Set<Y.XmlFragment>(),
    onThreads: () => { syncWatched(a); notify(); },
    onNodes: () => { syncWatched(a); notify(); },
    onAnchor: () => { notify(); },
    onDestroy: () => { if (attachment?.doc === doc) detachAttachments(); },
  };
  attachment = a;
  threads.observeDeep(a.onThreads);
  nodes.observe(a.onNodes);
  doc.on('destroy', a.onDestroy);
  syncWatched(a);
}

export function subscribeThreadsView(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareByCreatedAt(a: ThreadViewItem, b: ThreadViewItem): number {
  return a.createdAt - b.createdAt || compareIds(a.id, b.id);
}

function toThreadItem(id: string, entry: Y.Map<unknown>): ThreadViewItem | null {
  const nodeId = entry.get('nodeId');
  const kind = entry.get('kind');
  const resolved = entry.get('resolved');
  const createdAt = entry.get('createdAt');
  if (typeof nodeId !== 'string' || (kind !== 'node' && kind !== 'text')) return null;
  if (typeof resolved !== 'boolean' || typeof createdAt !== 'number') return null;
  const comments: ThreadViewItem['comments'] = [];
  const container = entry.get('comments');
  if (isMap(container)) {
    container.forEach((raw, commentId) => {
      if (!isMap(raw)) return;
      const authorId = raw.get('authorId');
      const body = raw.get('body');
      const commentCreatedAt = raw.get('createdAt');
      if (typeof authorId !== 'string' || typeof body !== 'string' || typeof commentCreatedAt !== 'number') return;
      comments.push({ id: commentId, authorId, body, createdAt: commentCreatedAt });
    });
  }
  comments.sort((a, b) => a.createdAt - b.createdAt || compareIds(a.id, b.id));
  return { id, nodeId, kind, resolved, createdAt, comments };
}

/** 纯读投影（selector）：三组互斥，优先级孤儿>已解决>进行中；组内 createdAt 升序、相同按 id。 */
export function threadsView$(): ThreadsViewData {
  const a = attachment;
  if (!a) return { active: [], resolved: [], orphan: [] };
  const orphan: ThreadViewItem[] = [];
  const resolved: ThreadViewItem[] = [];
  const activeByNode = new Map<string, ThreadViewItem[]>();
  a.threads.forEach((raw, id) => {
    if (!isMap(raw)) return;
    const item = toThreadItem(id, raw);
    if (!item) return;
    const analysis = analyze(a, raw);
    const viewItem = analysis.excerpt === undefined ? item : { ...item, excerpt: analysis.excerpt };
    if (analysis.orphan) {
      orphan.push(viewItem);
    } else if (item.resolved) {
      resolved.push(viewItem);
    } else {
      const group = activeByNode.get(item.nodeId) ?? [];
      group.push(viewItem);
      activeByNode.set(item.nodeId, group);
    }
  });
  // 节点组排序（spec §0 条 5）：**先**把每组线程按 createdAt 升序排好（组首=该组最早线程），
  // 再按「组首 createdAt，平局按 nodeId」排组。次序不可颠倒：先排组会取到 Y.Map 插入序首线程。
  // 平局也不可复用 compareByCreatedAt（它自带线程 id 二级判据，会让 nodeId 那一档永不可达）。
  const active = [...activeByNode.entries()]
    .map(([nodeId, threads]) => ({ nodeId, threads: threads.sort(compareByCreatedAt) }))
    .sort((a, b) => a.threads[0].createdAt - b.threads[0].createdAt || compareIds(a.nodeId, b.nodeId));
  return {
    active,
    resolved: resolved.sort(compareByCreatedAt),
    orphan: orphan.sort(compareByCreatedAt),
  };
}

/** 写闸：未 attach/getSynced()!==true/sessionUserId===null 全部先闸（零事务）。 */
function writable(): { a: Attachment; uid: string } | null {
  const uid = sessionUserId;
  const a = attachment;
  if (!a || uid === null || !a.getSynced()) return null;
  return { a, uid };
}

export function createThread(input: {
  nodeId: string;
  kind: 'node' | 'text';
  anchorStart?: string;
  anchorEnd?: string;
  body: string;
}): boolean {
  const gate = writable();
  if (!gate) return false;
  const { a, uid } = gate;
  if (input.kind === 'node' && (input.anchorStart !== undefined || input.anchorEnd !== undefined)) return false;
  if (input.kind === 'text') {
    if (input.anchorStart === undefined || input.anchorEnd === undefined) return false;
    if (resolveNodeXmlFragment(a.doc, input.nodeId, 'content') === null) return false;   // 缺片段不创建
  }
  const id = genId('thread');
  const commentId = genId('comment');
  const createdAt = Date.now();
  const plain = {
    id,
    nodeId: input.nodeId,
    kind: input.kind,
    ...(input.kind === 'text' ? { anchorStart: input.anchorStart, anchorEnd: input.anchorEnd } : {}),
    resolved: false,
    createdAt,
    createdBy: uid,
    comments: { [commentId]: { id: commentId, authorId: uid, body: input.body, createdAt } },
  };
  if (checkThreadEntry(id, plain, uid) !== undefined) return false;   // 写前谓词（单源）
  a.doc.transact(() => {
    const entry = buildThreadEntry({
      id,
      nodeId: input.nodeId,
      kind: input.kind,
      ...(input.kind === 'text' ? { anchorStart: input.anchorStart, anchorEnd: input.anchorEnd } : {}),
      resolved: false,
      createdAt,
      createdBy: uid,
    });
    a.threads.set(id, entry);   // 先挂根再取 comments（工厂预建容器——集成前 get 不可读）
    const comments = entry.get('comments');
    if (isMap(comments)) {
      comments.set(commentId, buildThreadComment({ id: commentId, authorId: uid, body: input.body, createdAt }));
    }
  }, THREADS_ORIGIN);
  return true;
}

export function addComment(threadId: string, body: string): boolean {
  const gate = writable();
  if (!gate) return false;
  const { a, uid } = gate;
  const entry = a.threads.get(threadId);
  if (!isMap(entry)) return false;
  if (!isMap(entry.get('comments'))) return false;
  const commentId = genId('comment');
  const createdAt = Date.now();
  if (checkThreadComment(commentId, { id: commentId, authorId: uid, body, createdAt }, uid) !== undefined) return false;
  a.doc.transact(() => {
    const comments = entry.get('comments');
    if (isMap(comments)) {
      comments.set(commentId, buildThreadComment({ id: commentId, authorId: uid, body, createdAt }));
    }
  }, THREADS_ORIGIN);
  return true;
}

export function setResolved(threadId: string, resolved: boolean): boolean {
  const gate = writable();
  if (!gate) return false;
  const { a } = gate;
  const entry = a.threads.get(threadId);
  if (!isMap(entry)) return false;
  if (entry.get('resolved') === resolved) return true;
  a.doc.transact(() => { entry.set('resolved', resolved); }, THREADS_ORIGIN);
  return true;
}

export function deleteThread(threadId: string): boolean {
  const gate = writable();
  if (!gate) return false;
  const { a } = gate;
  if (!a.threads.has(threadId)) return false;
  a.doc.transact(() => { a.threads.delete(threadId); }, THREADS_ORIGIN);
  return true;
}

export function cleanupOrphans(): number {
  const gate = writable();
  if (!gate) return -1;
  const { a } = gate;
  let removed = 0;
  a.doc.transact(() => {
    // 单事务内按当时文档重算孤儿键集（事务外先摘清单=分辨力测试必红——spec §2.5）
    const orphans: string[] = [];
    a.threads.forEach((raw, id) => {
      if (isMap(raw) && analyze(a, raw).orphan) orphans.push(id);
    });
    for (const id of orphans) {
      a.threads.delete(id);
      removed++;
    }
  }, THREADS_ORIGIN);
  return removed;
}
