// packages/shared/src/canvas/docShape.ts
// C0-1 契约片（Spec B）：docShape 类型骨架 + stub 谓词——shared 类型与签名定稿（编译门）。
// O0a-1 收编（Spec B）：ydocBuilder 的 fillDoc/readCanvasFromDoc/applyRecordToYMap 三写读函数落此
// （DocLike/DocMapLike 结构性入参——零 yjs import，宿主注入 Y.Map/FakeMap 工厂）+ stripDerivedKeys
// 键集表只读校验。三 stub 谓词（frameMode/isCollapsed/isValidStoredFrame）本分片不动（实现留 O0b）。
// O0a-3 收编（Spec B）：toDocRecords（web 投影差分出口——双源合并+键集表内剥键）+
// setDocPosition（doc position 写原语唯一单源）+ 键集表谓词家族化（stripAuthorState/stripDerivedKeys
// 共用 storyboardGroupIds/hasValidStoredFrameKeys——禁多份键集表）。
// O0b-0 格式批：doc rel→abs 翻转（toDocRecords 单一翻转点）+版本门 v2.1
// （stampDocSchema/assertDocSchema/ensureSchemaVersion 三函数——戳源唯一化，fillDoc 不再盖章）。
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
 *  O0a-1 常量随 fillDoc 上移 shared（api 无法 import apps/web——防第二真源）。
 *  O0b-0 格式批：1→2——doc 子 position 语义 rel→abs 翻转（toDocRecords 单一翻转点），旧 v1 档
 *  无迁移直接拒（开发期无用户数据——禁垫片/向后兼容）。 */
export const CANVAS_DOC_SCHEMA_VERSION = 2;

/** O0b-0 版本门 v2.1：写 meta.schemaVersion=CURRENT（同值 no-op）。
 *  戳源唯一化：fillDoc 不再盖章——唯一自愈点=WS loadDocument（无戳∧零节点）/api 种子（create
 *  withDoc 回调无条件 stamp）。函数级无条件写 CURRENT，档判定归门函数（ensureSchemaVersion）。 */
export function stampDocSchema(doc: DocLike): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') !== CANVAS_DOC_SCHEMA_VERSION) {
    meta.set('schemaVersion', CANVAS_DOC_SCHEMA_VERSION);
  }
}

/** O0b-0 版本门 v2.1：严格读断言——收到的版本==current 否则 throw（无戳/旧档同拒）。
 *  ensureSchemaVersion 的核心档（复用）——四档门="==current 放行 ∨ 无戳空档放行，其余走本断言"。 */
export function assertDocSchema(doc: DocLike): void {
  const sv = doc.getMap('meta').get('schemaVersion');
  if (sv !== CANVAS_DOC_SCHEMA_VERSION) {
    throw new Error(
      `[O0b-0] doc schemaVersion=${String(sv)}（${sv == null ? '无戳' : '旧档'}）≠ current ${CANVAS_DOC_SCHEMA_VERSION}——拒载（开发期无 v1→v2 迁移，禁按 abs 解释 rel 静默错位）`,
    );
  }
}

/** O0b-0 版本门 v2.1：四档门判据（REST 读入口 fail-closed——readCanvas/getProcessSnapshot 共口）：
 *  戳=2 放行 / 戳=1 拒（throw 带明确信息）/ 无戳∧有节点 ⇒ 拒 / 无戳∧零节点 ⇒ 放行（REST 侧
 *  不盖戳——空画布合法档）。门判据以 doc meta 为唯一事实、从全量 doc 读（不依赖 sv 差量——
 *  sv 等待是调用方 readCanvas 的事）。 */
export function ensureSchemaVersion(doc: DocLike): void {
  const sv = doc.getMap('meta').get('schemaVersion');
  if (sv === CANVAS_DOC_SCHEMA_VERSION) return;      // 戳=2 放行
  if (sv == null) {
    if ([...doc.getMap('nodes').entries()].length > 0) assertDocSchema(doc); // 无戳∧有节点 ⇒ 拒
    return;                                                               // 无戳∧零节点 ⇒ 放行
  }
  assertDocSchema(doc);                              // 戳=1（或未来未知档）⇒ 拒
}

/** 结构性子 Map 判定（零 instanceof——鸭子判定 get/has 方法存在；JSON 纯对象无方法不误判）。 */
function isDocMap(v: unknown): v is DocMapLike {
  return typeof v === 'object' && v !== null
    && typeof (v as { get?: unknown }).get === 'function'
    && typeof (v as { has?: unknown }).has === 'function';
}

/** doc 直写（fillDoc 单源——web ydocBuilder/api 收编共用）：节点/边逐键写入。
 *  O0b-0：meta stamp 删除（戳源唯一化——唯一自愈点=WS loadDocument/api 种子显式 stampDocSchema；
 *  fillDoc 每写盖戳会让"每 doc 至多一次幂等戳"契约与"无戳∧有节点拒"门档失真）。
 *  键集表跳过（O0a-1）：position/parentId/width/height 无键（或 null≡缺，批4a 契约）→ 不写 Y.Map——
 *  分镜子无 position 由上游构造纪律保证（diff 剥键=唯一剥键写者），本函数只认记录键、不做父上下文推算。 */
export function fillDoc(
  doc: DocLike,
  records: readonly DocNodeRecord[],
  edges: readonly DocEdgeRecord[],
): void {
  const nodesMap = doc.getMap('nodes');
  for (const rec of records) {
    const m = doc.createMap();
    m.set('type', rec.type);
    if (rec.parentId != null) m.set('parentId', rec.parentId);
    if (rec.width != null) m.set('width', rec.width);
    if (rec.height != null) m.set('height', rec.height);
    if (rec.position != null) {
      setDocPosition(m, rec.position, () => doc.createMap());
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
 *  无键，三层表；position 原样拷贝——O0b-0 起 doc=abs 空间，读出口即 abs）。
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
 *  canvasIntents——批 4b：updateNodeEnvelope 内联逐键 diff）；O0a-2 起 api 种子写走 fillDoc
 *  （writeNodeToYMap 符号整删——4aaf2fd9，读写同收编 shared docShape 单源）。 */
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
  setDocPosition(m, wantPos, createMap);
}

/** doc position 写原语唯一单源（O0a-3——Y.Map 嵌套子 Map）：子 Map 缺失（人为构造）经 createMap
 *  工厂创建，在则复用既有子 Map；x/y 逐键 diff 写（同值 no-op——防 doc 膨胀）。
 *  fillDoc/applyRecordToYMap/web applyIntentToDoc(moveNode) 三写点共此一口——envelope-serialization
 *  门禁 allowlist census 收敛（web 侧内联 position 子 Map 构造同批撤）。 */
export function setDocPosition(
  m: DocMapLike,
  pos: { x: number; y: number },
  createMap: () => DocMapLike,
): void {
  const existing = m.get('position');
  let p: DocMapLike;
  if (isDocMap(existing)) {
    p = existing;
  } else {
    p = createMap();
    m.set('position', p);
  }
  if (p.get('x') !== pos.x) p.set('x', pos.x);
  if (p.get('y') !== pos.y) p.set('y', pos.y);
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
  const storyboardGroups = storyboardGroupIds(records);
  for (const n of records) {
    if (n.parentId != null && storyboardGroups.has(n.parentId) && n.position != null) {
      violations.push(`分镜子 ${n.id} 带 position 键（键集表：分镜子无 position——剥键写者在上游构造点）`);
    }
  }
  return violations;
}

// ── 键集表共用内联谓词（O0a-3——stripAuthorState=api 种子入口 / toDocRecords=web 投影差分出口，
// 两函数同表禁复制；stripDerivedKeys 预扫同源）──
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** storedFrame 有效性三态内联判定：三键齐且有限且宽高>0——O0b-1 起 isValidStoredFrame 单源实装，
 *  本谓词降为记录形入参的薄委托（消同语义双实现——frameMode/键集表同源）。 */
function hasValidStoredFrameKeys(n: DocNodeRecord): boolean {
  return isValidStoredFrame(n);
}

/** storyboard 组 id 全量预扫（不依赖遍历序——判定对构造序免疫）。 */
function storyboardGroupIds(records: readonly DocNodeRecord[]): Set<string> {
  return new Set(
    records
      .filter((n) => n.type === 'group' && (n.data as Record<string, unknown> | undefined)?.groupType === 'storyboard')
      .map((n) => n.id),
  );
}

/** 键集表④应用（spec ④字段×模式——O0a-2 从 stripAuthorState 提取为家族共用单实现）：
 *  组 position⟺manual∨storyboard；组 width/height⟺manual only；auto/collapsed 组=0 帧键；
 *  分镜子无 position；非组节点信封键自由原样。纯剥不补：输入无键⇄输出无键。 */
function applyKeySetTable(records: readonly DocNodeRecord[]): DocNodeRecord[] {
  const storyboardIds = storyboardGroupIds(records);
  return records.map((n) => {
    const data = (n.data ?? {}) as Record<string, unknown>;
    const out: DocNodeRecord = { id: n.id, type: n.type, data };
    const isGroup = n.type === 'group';
    const isStoryboard = isGroup && data.groupType === 'storyboard';
    let keepPosition = n.position != null;
    let keepFrame = true;
    if (isGroup) {
      if (isStoryboard) {
        keepFrame = false; // 尺寸=config 权威故剥（position 留）
      } else if (!hasValidStoredFrameKeys(n)) {
        keepPosition = false; // auto/collapsed 组=0 帧键
        keepFrame = false;
      } // manual（三键齐且有效）：全留——含折叠态（折叠恢复唯一密封源）
    }
    if (n.parentId != null && storyboardIds.has(n.parentId)) keepPosition = false; // 分镜子无 position
    if (keepPosition) out.position = n.position;
    if (n.parentId != null) out.parentId = n.parentId;
    if (keepFrame) {
      if (n.width != null) out.width = n.width;
      if (n.height != null) out.height = n.height;
    }
    return out;
  });
}

/** 入口剥键回作者态（O0a-2——spec ③记录契约：api 种子入口唯一剥键写者，fillDoc 只接受其输出）。
 *  键集表（spec ④字段×模式，与 O0a-1 剥键口径同源）：组 position⟺manual∨storyboard；组
 *  width/height⟺manual only（storyboard 尺寸=config 权威故剥）；auto/collapsed 组=0 帧键；
 *  分镜子（parentId 指向 storyboard 组）无 position；非组节点信封键自由原样。manual 判定=
 *  storedFrame 内联三态（三键齐且有限且宽高>0——hasValidStoredFrameKeys 同谓词共用；
 *  assertions.ts 内联判定同语义，O0b 一并换 frameMode 单源）。storyboard 组判定=全量预扫
 * （stripDerivedKeys 同款——不依赖遍历序）。与 toDocRecords 方向不同：本函数=api 种子入口剥、
 *  toDocRecords=web 投影差分出口剥——键集判定共用下方内联谓词（禁复制两份键集表）。
 *  纯剥不补：输入无键⇄输出无键（键集表跳过同构；O0b-0 起 normalizeLoadedCanvas 补几何层整删——
 *  种子直读作者态，无补齐层）。data 原样透传不碰内部（白名单/快照域归
 *  O0c-1——snapshot-filter normalizeNodeRecord 是相邻物不收敛）。 */
export function stripAuthorState(records: readonly DocNodeRecord[]): DocNodeRecord[] {
  return applyKeySetTable(records);
}

/** 结构性最小 cs 节点面（O0a-3——web canvasStore 节点形状，零 xyflow import）：
 *  position 必填（cs 层恒有——React Flow 节点构造语义）；width/height 可空（缺=auto 组
 *  record 键集判定形态）；measured 声明在入参面仅为一处纪律注记——本函数不消费（渲染期量
 *  →跨端漂移源，投影禁入）。 */
export interface MinimalCSNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  parentId?: string | null;
  width?: number | null;
  height?: number | null;
  measured?: { width?: number; height?: number };
  data?: Record<string, unknown>;
}

/** web 投影差分出口（O0a-3 换芯——projectCanvasNodes 双源合并逻辑上移 shared 单源）：
 *  双源合并（F42：组 data 取 cs[所有权单一]；普通节点取 ns、ns 缺席回落 cs[恢复窗口]）
 *  → 键集表内剥键（applyKeySetTable——与 stripAuthorState 同表同谓词，方向不同：本函数=
 *  web 投影差分出口，stripAuthorState=api 种子入口）。输出已满足字段×模式键集表。
 *  O0b-0 格式批：**rel→abs 翻转切（本函数体=唯一翻转点，无 space 参数）**——子节点输出
 *  abs=cs.rel+组帧 origin（组帧 origin 取 cs 组 position 现值——含 auto 组：origin 消费在翻转层、
 *  键集剥在 applyKeySetTable，两者正交）；顶层节点原样（本就是绝对位）；分镜子翻转后仍被剥
 *  position（剥键优先，翻转可见面为零）；无父上下文的孤儿 parentId 原样输出（无 origin 可加，
 *  禁 undefined/NaN 发射）。type 缺省回落 videoGen（旧投影同口径）。ephemeral 键
 * （editMode/transformMode）=web 口径 13 键集、shared 不可见——由 web 包装层 projectCanvasNodes
 *  剥除（doc 持久面另有漏斗入口剥键双保险）。 */
export function toDocRecords(
  csNodes: readonly MinimalCSNode[],
  nsNodes: Record<string, { data?: Record<string, unknown> }>,
): DocNodeRecord[] {
  // 组帧 origin 表：cs 组 position 现值（一次预扫——子翻转只查表，不做遍历内推算）
  const origins = new Map<string, { x: number; y: number }>();
  for (const nd of csNodes) {
    if (nd.type === 'group') origins.set(nd.id, nd.position);
  }
  const merged: DocNodeRecord[] = csNodes.map((nd) => {
    let position = nd.position;
    if (nd.parentId != null && nd.position != null) {
      const origin = origins.get(nd.parentId);
      if (origin) {
        position = { x: nd.position.x + origin.x, y: nd.position.y + origin.y }; // rel→abs 翻转
      }
    }
    return {
      id: nd.id,
      type: nd.type || 'videoGen',
      position,
      ...(nd.parentId != null ? { parentId: nd.parentId } : {}),
      ...(nd.width != null ? { width: nd.width } : {}),
      ...(nd.height != null ? { height: nd.height } : {}),
      data: nd.type === 'group' ? (nd.data ?? {}) : (nsNodes[nd.id]?.data ?? nd.data ?? {}),
    };
  });
  return applyKeySetTable(merged);
}

/** 冻结帧/快照 rect（DragSession 的 baseline/groupBaseline/frozenFrames 共用）。 */
export type Rect = { x: number; y: number; width: number; height: number };

/** 作者态 doc 节点记录（docShape 家族出口专用）：键可选——键集表语义：auto 组无帧键 /
 *  manual 组折叠仍保留三键 / storyboard 组无 wh / 分镜子无 position，运行时键集由谓词守卫、
 *  类型层=可选键。与 nodeEnvelope.ts 的 CanvasNodeRecord（cs/渲染/copyPlan 面，必填）分裂并存——不改后者。
 *  position 裸 {x,y} 注（O0b-0）：doc=abs 空间（写侧 toDocRecords rel→abs 翻转、读侧直拷）——
 *  本族读写管道进出同一空间；AbsPos 品牌收紧随翻转批语义落地后按需跟进（本批不加类型层）。 */
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

/** 帧模式判定（O0b-1 实装——写域①模式 oracle 单源）：data.groupType==='storyboard'⇒'storyboard'；
 *  storedFrame 三键齐且有效⇒'manual'；否则'auto'。
 *  oracle=doc 侧键：禁 cs 派生帧当 storedFrame——判定只依赖传入的 doc 侧记录键，不从 cs 派生
 * （终裁 44——auto 组防 manual 死锁）。 */
export function frameMode(input: {
  data: Record<string, unknown>;
  storedFrame?: { position?: { x: number; y: number }; width?: number; height?: number };
}): FrameMode {
  if (input.data.groupType === 'storyboard') return 'storyboard';
  if (input.storedFrame != null && isValidStoredFrame(input.storedFrame)) return 'manual';
  return 'auto';
}

/** 折叠谓词（O0b-1 实装）：data.collapsed===true。与 frameMode 正交。 */
export function isCollapsed(data: Record<string, unknown>): boolean {
  return data.collapsed === true;
}

/** storedFrame 有效性三态（O0b-1 实装——frameMode 单源判定底座）：缺任一键/非有限/宽高≤0 ⇒ false；
 *  三态全过才 true。 */
export function isValidStoredFrame(frame: {
  position?: { x: number; y: number };
  width?: number;
  height?: number;
}): boolean {
  return isFiniteNum(frame.position?.x) && isFiniteNum(frame.position?.y)
    && isFiniteNum(frame.width) && isFiniteNum(frame.height)
    && (frame.width as number) > 0 && (frame.height as number) > 0;
}
