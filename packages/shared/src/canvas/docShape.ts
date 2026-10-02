// packages/shared/src/canvas/docShape.ts
// C0-1 契约片（Spec B）：docShape 类型骨架 + stub 谓词——shared 类型与签名定稿（编译门）。
// O0a-1 收编（Spec B）：ydocBuilder 的 fillDoc/readCanvasFromDoc/applyRecordToYMap 三写读函数落此
// （DocLike/DocMapLike 结构性入参——零 yjs import，宿主注入 Y.Map/FakeMap 工厂）+ stripDerivedKeys
// 键集表只读校验。三 stub 谓词（frameMode/isCollapsed/isValidStoredFrame）本分片不动（实现留 O0b）。
import type { RelPos } from './brands';

/** Y.Map 结构性最小面（零 yjs import——防跨实例 instanceof 静默失败，nodeEnvelope 同理由）。
 *  O0a-1 按需扩键：delete（增量删键）/entries（读遍历）——Y.Map 结构兼容零包装。 */
export interface DocMapLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
  delete(key: string): void;
  entries(): Iterable<[string, unknown]>;
}

/** Y.Doc 结构性最小面。O0a-1 按需扩 createMap：空 map 工厂（fillDoc 的节点/position/data 子 Map
 *  创建——零 yjs 的代价：宿主注入 new Y.Map()/FakeMap；Y.Doc 无此方法由适配层补）。 */
export interface DocLike {
  getMap(name: string): DocMapLike;
  createMap(): DocMapLike;
}

/** doc 边记录（fillDoc/readRecordsFromMaps 面——单形状 source/target，缺写 '' 由写侧守卫）。 */
export interface DocEdgeRecord {
  id: string;
  source?: string;
  target?: string;
}

/** 批2-3（R1c 前置物）：doc meta schema 版本——结构迁移判据的持久锚点（随 update 传播/服务端持久）。
 *  O0a-1 常量随 fillDoc 上移 shared（api 无法 import apps/web——防第二真源；O0b-0 只剩改值 1→2）。 */
export const CANVAS_DOC_SCHEMA_VERSION = 1;

/** 结构性子 Map 判定（零 instanceof——鸭子判定 get/has 方法存在；JSON 纯对象无方法不误判）。 */
function isDocMap(v: unknown): v is DocMapLike {
  return typeof v === 'object' && v !== null
    && typeof (v as { get?: unknown }).get === 'function'
    && typeof (v as { has?: unknown }).has === 'function';
}

/** doc 直写（fillDoc 单源——web ydocBuilder/api 收编共用）：meta schemaVersion stamp（同值 no-op
 *  守卫——addNode 每新建节点也走 fillDoc，防 doc 膨胀）+ 节点/边逐键写入。
 *  键集表跳过（O0a-1）：position/parentId/width/height 无键（或 null≡缺，批4a 契约）→ 不写 Y.Map——
 *  分镜子无 position 由上游构造纪律保证（diff 剥键=唯一剥键写者），本函数只认记录键、不做父上下文推算。 */
export function fillDoc(
  doc: DocLike,
  records: readonly DocNodeRecord[],
  edges: readonly DocEdgeRecord[],
): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') !== CANVAS_DOC_SCHEMA_VERSION) {
    meta.set('schemaVersion', CANVAS_DOC_SCHEMA_VERSION);
  }
  const nodesMap = doc.getMap('nodes');
  for (const rec of records) {
    const m = doc.createMap();
    m.set('type', rec.type);
    if (rec.parentId != null) m.set('parentId', rec.parentId);
    if (rec.width != null) m.set('width', rec.width);
    if (rec.height != null) m.set('height', rec.height);
    if (rec.position != null) {
      const position = doc.createMap();
      position.set('x', rec.position.x);
      position.set('y', rec.position.y);
      m.set('position', position);
    }
    const data = doc.createMap();
    for (const [k, v] of Object.entries(rec.data ?? {})) data.set(k, v);
    m.set('data', data);
    nodesMap.set(rec.id, m);
  }
  const edgesMap = doc.getMap('edges');
  for (const e of edges) {
    const m = doc.createMap();
    m.set('source', e.source ?? ''); // edges 单形状 source/target（R1a 收敛——崩溃快照 validate 已锁单形）
    m.set('target', e.target ?? '');
    edgesMap.set(e.id, m);
  }
}

/** doc 直读（readRecordsFromMaps 单源）：出口=作者态 DocNodeRecord（键可选——doc 无键⇄records 同形
 *  无键，三层表；position 原样拷贝不解释——identity 档，rel→abs 翻转支点=O0b-0 格式批）。
 *  读侧 null 消除（批4a 契约保持：doc 值 null≡缺键→出口 undefined）。 */
export function readRecordsFromMaps(doc: DocLike): { nodes: DocNodeRecord[]; edges: DocEdgeRecord[] } {
  const nodes = [...doc.getMap('nodes').entries()].map(([id, v]) => {
    const m = v as DocMapLike;
    const posV = m.get('position');
    const position: DocNodeRecord['position'] | undefined = isDocMap(posV)
      ? { x: posV.get('x') as number, y: posV.get('y') as number }
      : undefined;
    const parentId = m.get('parentId');
    const width = m.get('width');
    const height = m.get('height');
    const dataV = m.get('data');
    return {
      id,
      type: m.get('type') as string,
      ...(position != null ? { position } : {}),
      ...(parentId != null ? { parentId: parentId as string } : {}),
      ...(width != null ? { width: width as number } : {}),
      ...(height != null ? { height: height as number } : {}),
      data: isDocMap(dataV) ? Object.fromEntries([...dataV.entries()]) : {},
    };
  });
  const edges = [...doc.getMap('edges').entries()].map(([id, v]) => {
    const m = v as DocMapLike;
    return { id, source: m.get('source') as string | undefined, target: m.get('target') as string | undefined };
  });
  return { nodes, edges };
}

/** 增量写：record 缺键 → Y.Map delete；值变才 set（同值 no-op——无守卫=doc 膨胀）。
 *  键集表跳过（O0a-1）：记录无 position → 不写不删（分镜子剥键写者在上游——既有键不覆写）；
 *  position 子 Map 缺失（人为构造）→ 经 createMap 工厂创建。仅测试消费（生产写路径已收口
 *  canvasIntents——批 4b：updateNodeEnvelope 内联逐键 diff）；O0a-2 起 api writeNodeToYMap 收编。 */
export function applyRecordToYMap(
  m: DocMapLike,
  r: DocNodeRecord,
  createMap: () => DocMapLike,
): void {
  for (const key of ['parentId', 'width', 'height'] as const) {
    const cur = m.get(key);
    const want: unknown = r[key];
    if (want == null) { if (cur !== undefined) m.delete(key); }
    else if (cur !== want) m.set(key, want);
  }
  if (m.get('type') !== r.type) m.set('type', r.type);
  const wantPos = r.position;
  if (wantPos == null) return; // 键集表：无 position 记录不动既有键（不写 {0,0} 不删——上游纪律）
  const existingPos = m.get('position');
  let pos: DocMapLike;
  if (isDocMap(existingPos)) {
    pos = existingPos;
  } else {
    pos = createMap();
    m.set('position', pos);
  }
  if (pos.get('x') !== wantPos.x) pos.set('x', wantPos.x);
  if (pos.get('y') !== wantPos.y) pos.set('y', wantPos.y);
}

/** 键集表只读校验（O0a-1 三层防线②——v3.17 终裁 64②，消"同一规则双写者"）：读 records 断言
 *  分镜子无 position 键。storyboard 组判定=**全量预扫**（不依赖遍历序——人为构造序 child 先于
 *  父组入 doc 仍可判，DEV 断言报错而非被静默修好）。
 *  现状锚注明（plan 授权"若现状子先父后则锚按现状写"——2026-10-02 实测）：doc Y.Map 插入序=混合序
 *  （既有子 set 原位+新组 append）——groupNodes 打组场景子恒先于组入 doc（合法形态），"父先子后"
 *  只对同批全新增（mergeStoryboard 组+子）成立；本函数不做序检查（序检查会误报合法混合序——
 *  且键集判定经全量预扫已对序免疫，防线③的原始动机消解）。
 *  纯只读**不写不修**（原"transact 尾 normalize pass 统一剥键"写动作废止转校验）。
 *  返回违例清单，调用方决定处置（本分片挂载点=漏斗尾 DEV throw；组帧键校验留 O0b 扩）。 */
export function stripDerivedKeys(records: readonly DocNodeRecord[]): string[] {
  const violations: string[] = [];
  const storyboardGroups = new Set(
    records
      .filter((n) => n.type === 'group' && (n.data as Record<string, unknown> | undefined)?.groupType === 'storyboard')
      .map((n) => n.id),
  );
  for (const n of records) {
    if (n.parentId != null && storyboardGroups.has(n.parentId) && n.position != null) {
      violations.push(`分镜子 ${n.id} 带 position 键（键集表：分镜子无 position——剥键写者在上游构造点）`);
    }
  }
  return violations;
}

/** 冻结帧/快照 rect（DragSession 的 baseline/groupBaseline/frozenFrames 共用）。 */
export type Rect = { x: number; y: number; width: number; height: number };

/** 作者态 doc 节点记录（docShape 家族出口专用）：键可选——键集表语义：auto 组无帧键 /
 *  manual 组折叠仍保留三键 / storyboard 组无 wh / 分镜子无 position，运行时键集由谓词守卫、
 *  类型层=可选键。与 nodeEnvelope.ts 的 CanvasNodeRecord（cs/渲染/copyPlan 面，必填）分裂并存——不改后者。
 *  position 裸 {x,y} 注（O0a-1）：本族读写管道=identity 档（位置原样拷贝、不解释空间——分片不变量①），
 *  AbsPos 品牌收紧归 O0b-0 翻转批（翻转后 doc=abs 空间，品牌才有运行时判据——随 toDocRecords 签名同批落）。 */
export interface DocNodeRecord {
  id: string;
  type: string;
  parentId?: string;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  data: Record<string, unknown>;
}

/** 渲染面最小骨架（hidden?: boolean 必须出现；完整化留 O0c-2 分片——勿加更多字段）。 */
export interface RenderNode {
  id: string;
  type: string;
  parentId?: string;
  position: RelPos;
  width?: number;
  height?: number;
  data: Record<string, unknown>;
  hidden?: boolean;
}

/** 拖拽会话（键集=plan v3.6-FROZEN 定稿）：draggingIds=被拖集合 / dragProtectedIds=保护集合
 *  （含 resize 扩展）——两者并存。 */
export interface DragSession {
  baseline: ReadonlyMap<string, Rect>;
  groupBaseline: ReadonlyMap<string, Rect>;
  delta: { x: number; y: number };
  draggingIds: ReadonlySet<string>;
  dragProtectedIds: ReadonlySet<string>;
  draggedGroupIds: ReadonlySet<string>;
  frozenFrames: ReadonlyMap<string, Rect>;
  gestureKind: 'drag' | 'resize';
  resizePending: boolean;
  lastActivityAt: number;
  activePointers: Set<number>;
  gestureAbandoned: boolean;
  resizeTargetId: string | null;
}

/** 帧模式三值。四值枚举装不下 collapsed∧manual/auto 交叉——collapsed 由 isCollapsed 正交表达；
 *  dirty-manual 档不存在（manuallyResized 已被终裁 50 删除）。 */
export type FrameMode = 'auto' | 'manual' | 'storyboard';

/** 帧模式判定（stub——C0 只定签名）：data.groupType==='storyboard'⇒'storyboard'；
 *  storedFrame 三键齐且有效⇒'manual'；否则'auto'。
 *  oracle=doc 侧键：禁 cs 派生帧当 storedFrame——判定只依赖传入的 doc 侧记录键，不从 cs 派生。 */
export function frameMode(input: {
  data: Record<string, unknown>;
  storedFrame?: { position?: { x: number; y: number }; width?: number; height?: number };
}): FrameMode {
  throw new Error('C0 stub');
}

/** 折叠谓词（stub——C0 只定签名）：data.collapsed===true。与 frameMode 正交。 */
export function isCollapsed(data: Record<string, unknown>): boolean {
  throw new Error('C0 stub');
}

/** storedFrame 有效性三态（stub——C0 只定签名）：缺任一键/非有限/宽高≤0 ⇒ false；三态全过才 true。 */
export function isValidStoredFrame(frame: {
  position?: { x: number; y: number };
  width?: number;
  height?: number;
}): boolean {
  throw new Error('C0 stub');
}
