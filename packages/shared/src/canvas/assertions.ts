// packages/shared/src/canvas/assertions.ts
// C0-2 运行时断言骨架（Spec B）：六条模型断言 + membership 写侧断言 + 全节点 isFinite 锚
// + 字段级一写者计数框架（GeometryWriteLedger）。
//
// 语义分野：断言函数本身=纯谓词的 throw 形态（违例即抛、消息列结构化违例清单）——
// 调用方决定吞不吞（DEV 直抛 / prod catch 转 id 去重 log；log 计数载体后续分片落，本片只留接缝注释）。
//
// 数据形状假设：输入=DocNodeRecord[]（doc 作者态可选键——docShape.ts）；② 额外吃 cs 侧三方快照
// {docRecords, csNodes, frames}。帧模式判定内联实现（frameMode/isCollapsed 是 C0-1 stub，调不得——
// O0b 接线后本文件内联判定换 frameMode 单源，见各处 `O0b` 注释）。C0 期间生产代码零消费——
// 挂点=assertions.test.ts 的 it.todo（各分片 unskip）。
import type { DocNodeRecord, RenderNode, Rect } from './docShape';
import { COLLAPSED_SIZE, DEFAULT_CHILD_SIZE, calcGroupBounds } from './geometry';

/** 浮点等价容差（对齐 reconcile 单内核零差异短路的同值 1e-6——RF 小数坐标 1ULP 抖动）。 */
const EPS = 1e-6;

/** cs-only 派生字段块名单（禁入 doc data——⑤）。hidden=deriveHidden 派生；selected/dragging=
 *  RF UI 态（投影不含——canvasStore.ts onNodesChange 段注释同口径："投影不含
 *  selected/dragging/measured"）。域随模型扩在此加键。 */
export const CS_ONLY_DERIVED_DATA_KEYS = ['hidden', 'selected', 'dragging'] as const;

/** 几何字段三键（一写者框架的辖域——data.{width,height} 豁免已废止，字段级全覆盖）。 */
export type GeometryField = 'position' | 'width' | 'height';

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isGroupRec = (r: DocNodeRecord): boolean => r.type === 'group';

/** 组是否分镜组（内联判定——O0b 接线后换 frameMode 单源）。 */
const isStoryboardRec = (r: DocNodeRecord): boolean => r.data.groupType === 'storyboard';

/** 组是否折叠（内联判定 data.collapsed===true——O0b 接线后换 isCollapsed 单源）。 */
const isCollapsedRec = (r: DocNodeRecord): boolean => r.data.collapsed === true;

const hasFrameKey = (r: DocNodeRecord): boolean =>
  r.position != null || r.width != null || r.height != null;

/** storedFrame 有效性内联判定（三键齐且有限且宽高>0⇔manual——docShape.frameMode stub 同语义，
 *  O0b 接线后换单源）。 */
const hasValidStoredFrame = (r: DocNodeRecord): boolean =>
  isFiniteNum(r.position?.x) && isFiniteNum(r.position?.y)
  && isFiniteNum(r.width) && isFiniteNum(r.height)
  && (r.width as number) > 0 && (r.height as number) > 0;

/** 违例聚抛：清单非空时 throw 一条含全部违例的消息（结构化文本——id+细节）。 */
function throwIfViolations(assertName: string, violations: string[]): void {
  if (violations.length > 0) {
    throw new Error(`[C0 断言] ${assertName} 违例 ${violations.length} 处：\n${violations.map((v) => `  - ${v}`).join('\n')}`);
  }
}

/**
 * 断言①：auto 组 doc 无帧键。auto 组（非分镜、非 manual）永无 position/width/height——
 * 折叠态同（折叠由 data.collapsed+savedSize 表达，帧键不落 doc）；manual 组（三键齐且有效）
 * 折叠态不动帧三键（键在即放行）；分镜组豁免（帧走配置型公式）。
 * 判定口径：任一帧键存在而 storedFrame 不齐/无效（=frameMode 判 auto）→ 违例。
 */
export function assertNoAutoGroupFrameKeys(records: readonly DocNodeRecord[]): void {
  const violations: string[] = [];
  for (const r of records) {
    if (!isGroupRec(r) || isStoryboardRec(r)) continue;
    if (!hasFrameKey(r)) continue;
    if (!hasValidStoredFrame(r)) violations.push(`${r.id}: auto 组携带帧键（frameMode=auto 形态——position/width/height 应全缺）`);
  }
  throwIfViolations('assertNoAutoGroupFrameKeys', violations);
}

/**
 * 断言②：doc.abs ≡ cs.rel + 组帧原点。三方快照纯比较：对每个带 parentId 的 doc 记录，
 * doc position 应等于 cs 同 id 节点 rel position + frames[parentId] 原点（EPS 容差）。
 * 豁免/跳过面：分镜组子（rel 无意义）；cs 缺该子（投影完整性归其他断言）；frames 缺该组帧
 * （无法对照）；顶层节点（无 parentId，不属 rel 对照面）。
 */
export function assertDocAbsMatchesCsRel(snapshot: {
  docRecords: readonly DocNodeRecord[];
  csNodes: readonly RenderNode[];
  frames: ReadonlyMap<string, Rect>;
}): void {
  const { docRecords, csNodes, frames } = snapshot;
  const csById = new Map(csNodes.map((n) => [n.id, n]));
  const violations: string[] = [];
  for (const r of docRecords) {
    if (r.parentId == null || r.position == null) continue;
    const cs = csById.get(r.id);
    if (!cs) continue; // cs 缺子——投影完整性非本断言辖区
    const frame = frames.get(r.parentId);
    if (!frame) continue; // 无帧可对照
    const parent = csById.get(r.parentId);
    if (parent?.data?.groupType === 'storyboard') continue; // 分镜子豁免
    const expectX = cs.position.x + frame.x;
    const expectY = cs.position.y + frame.y;
    if (Math.abs(r.position.x - expectX) > EPS || Math.abs(r.position.y - expectY) > EPS) {
      violations.push(`${r.id}: doc.abs(${r.position.x},${r.position.y}) ≠ cs.rel(${cs.position.x},${cs.position.y})+帧原点(${frame.x},${frame.y})`);
    }
  }
  throwIfViolations('assertDocAbsMatchesCsRel', violations);
}

/** manual 域判定（③/+条口径——O0b-5 随 manuallyResized 整链删除改帧键形态 oracle，终裁 50）：
 *  manual=doc 帧三键齐且有效（hasValidStoredFrame——frameMode 单源同谓词）——帧不归
 *  bbox/COLLAPSED_SIZE 公式管（展开恢复唯一密封源，终裁 82）。 */
const isManualDomain = (r: DocNodeRecord): boolean => hasValidStoredFrame(r);

/**
 * 断言③：展开态 auto 组 frame ≡ bbox+padding（成员≥1 才断言——空组归
 * assertEmptyAutoGroupCollapsedSize）。O0b-5 校验域重定义（manuallyResized 整链删除，终裁 50）：
 * auto 判定=非分镜/非折叠/非 manual（manual=帧三键齐且有效——hasValidStoredFrame，帧≠bbox 合法
 * 密封源[终裁 82]）；③ 可校验对象=携帧键而三键无效的脏形态（① 辖区的 bbox 鉴别力半边）。
 * 对照公式单源 geometry.calcGroupBounds（padding 常量内嵌，
 * 禁自写公式）；成员缺尺寸按 DEFAULT_CHILD_SIZE 兜底（与旧 applyGroupFrame 同源）；成员缺 position
 * 即违例（普通组子节点 doc 恒有 position）。记录无帧键（auto 组 doc 目标形态）→ 无校验对象跳过。
 * 输入空间无关：doc 快照（过渡/混合形态）与 cs 信封快照均可喂（cs 信封快照的 auto/manual 判别
 * 需 frameModes oracle 扩展——随 O0b 接线批评估）。
 */
export function assertExpandedAutoFrameEqualsBounds(records: readonly DocNodeRecord[]): void {
  const violations: string[] = [];
  const membersOf = (gid: string) => records.filter((r) => r.parentId === gid);
  for (const g of records) {
    if (!isGroupRec(g) || isStoryboardRec(g) || isCollapsedRec(g) || isManualDomain(g)) continue;
    if (g.position == null || g.width == null || g.height == null) continue; // 无帧键=①辖区
    const members = membersOf(g.id);
    if (members.length === 0) continue; // 空组归 COLLAPSED_SIZE 条
    const badMember = members.find((m) => m.position == null);
    if (badMember) {
      violations.push(`${badMember.id}: 组 ${g.id} 成员缺 position（普通组子节点 doc 恒有 position）`);
      continue;
    }
    const bbox = calcGroupBounds(members.map((m) => ({
      x: m.position!.x, y: m.position!.y,
      width: m.width ?? DEFAULT_CHILD_SIZE.width, height: m.height ?? DEFAULT_CHILD_SIZE.height,
    })));
    const off =
      Math.abs(g.position.x - bbox.x) > EPS || Math.abs(g.position.y - bbox.y) > EPS
      || Math.abs(g.width - bbox.width) > EPS || Math.abs(g.height - bbox.height) > EPS;
    if (off) {
      violations.push(`${g.id}: 展开态 auto 组帧(${g.position.x},${g.position.y},${g.width},${g.height}) ≠ bbox+padding(${bbox.x},${bbox.y},${bbox.width},${bbox.height})`);
    }
  }
  throwIfViolations('assertExpandedAutoFrameEqualsBounds', violations);
}

/**
 * 断言④：分镜子 doc 无 position。识别=parentId 指向 data.groupType==='storyboard' 的组的记录；
 * 该类记录携带 position 即违例（分镜组子坐标无意义——纯 DOM 宫格渲染）。
 */
export function assertStoryboardChildNoPosition(records: readonly DocNodeRecord[]): void {
  const storyboardIds = new Set(records.filter((r) => isGroupRec(r) && isStoryboardRec(r)).map((r) => r.id));
  const violations: string[] = [];
  for (const r of records) {
    if (r.parentId == null || !storyboardIds.has(r.parentId)) continue;
    if (r.position != null) violations.push(`${r.id}: 分镜组 ${r.parentId} 的子节点携带 position（应无此键）`);
  }
  throwIfViolations('assertStoryboardChildNoPosition', violations);
}

/**
 * 断言⑤：cs-only 派生字段（hidden/selected/dragging——CS_ONLY_DERIVED_DATA_KEYS）禁入任何
 * 记录的 data。派生态在 cs 顶层/render 面表达，落 data 即双真相违例。
 */
export function assertNoCsDerivedKeysInData(records: readonly DocNodeRecord[]): void {
  const block = new Set<string>(CS_ONLY_DERIVED_DATA_KEYS);
  const violations: string[] = [];
  for (const r of records) {
    const hits = Object.keys(r.data ?? {}).filter((k) => block.has(k));
    if (hits.length > 0) violations.push(`${r.id}: data 携带 cs-only 派生键 [${hits.join(',')}]（应落顶层、禁入 data）`);
  }
  throwIfViolations('assertNoCsDerivedKeysInData', violations);
}

/**
 * 断言⑥：`__` 前缀键不进组 data。辖域=type==='group' 记录的 data（普通节点 data 的 `__` 键
 * ——如 __fromMulti——不属本断言面）。
 */
export function assertNoDunderKeysInGroupData(records: readonly DocNodeRecord[]): void {
  const violations: string[] = [];
  for (const r of records) {
    if (!isGroupRec(r)) continue;
    const hits = Object.keys(r.data ?? {}).filter((k) => k.startsWith('__'));
    if (hits.length > 0) violations.push(`${r.id}: 组 data 携带 __ 前缀键 [${hits.join(',')}]`);
  }
  throwIfViolations('assertNoDunderKeysInGroupData', violations);
}

/**
 * +条：空 auto 组 → COLLAPSED_SIZE。空（无成员）auto 组必须折叠（data.collapsed===true），
 * 且帧键若在则 width/height ≡ COLLAPSED_SIZE；帧键缺省（doc 目标形态）只查折叠标记。
 * manual 域（O0b-5 起帧三键形态判定——isManualDomain）/storyboard/有成员 → 跳过。
 */
export function assertEmptyAutoGroupCollapsedSize(records: readonly DocNodeRecord[]): void {
  const violations: string[] = [];
  for (const g of records) {
    if (!isGroupRec(g) || isStoryboardRec(g) || isManualDomain(g)) continue;
    const empty = !records.some((r) => r.parentId === g.id);
    if (!empty) continue;
    if (!isCollapsedRec(g)) {
      violations.push(`${g.id}: 空 auto 组未折叠（应 collapsed=true）`);
      continue;
    }
    if (g.width != null && g.width !== COLLAPSED_SIZE.width
      || g.height != null && g.height !== COLLAPSED_SIZE.height) {
      violations.push(`${g.id}: 空 auto 组帧(${g.width ?? '-'},${g.height ?? '-'}) ≠ COLLAPSED_SIZE(${COLLAPSED_SIZE.width},${COLLAPSED_SIZE.height})`);
    }
  }
  throwIfViolations('assertEmptyAutoGroupCollapsedSize', violations);
}

/**
 * membership 写侧断言：分镜组 children（parentId=G 的记录 id）⊆ cells(G)。
 * 反向不拦（cells 悬空项/槽位无子=F38 槽位语义放行）；cells 缺失或非数组而子存在 → 违例。
 * 接缝：断言 throw 形态——调用方（O0b-2 接线点）catch 后 DEV 直抛 / prod 转"变更 id 去重 log"
 * （log 计数载体后续分片落，本片只留此接缝注释）。
 */
export function assertStoryboardMembership(records: readonly DocNodeRecord[]): void {
  const violations: string[] = [];
  for (const g of records) {
    if (!isGroupRec(g) || !isStoryboardRec(g)) continue;
    const children = records.filter((r) => r.parentId === g.id).map((r) => r.id);
    if (children.length === 0) continue;
    const cells = g.data.cells;
    if (!Array.isArray(cells)) {
      violations.push(`${g.id}: 分镜组 cells 缺失/非数组而存在 ${children.length} 个子节点`);
      continue;
    }
    const cellSet = new Set(cells.filter((c): c is string => typeof c === 'string'));
    for (const id of children) {
      if (!cellSet.has(id)) violations.push(`${id}: 分镜组 ${g.id} 子节点不在 cells（children⊆cells 违例）`);
    }
  }
  throwIfViolations('assertStoryboardMembership', violations);
}

/**
 * 全节点锚：任一记录 position 存在即须 Number.isFinite(x/y)。NaN/Infinity 坐标（除零/脏数据
 * 传播终点）就地违例。
 */
export function assertAllPositionsFinite(records: readonly DocNodeRecord[]): void {
  const violations: string[] = [];
  for (const r of records) {
    if (r.position == null) continue;
    if (!Number.isFinite(r.position.x) || !Number.isFinite(r.position.y)) {
      violations.push(`${r.id}: position 非有限值(${r.position.x},${r.position.y})`);
    }
  }
  throwIfViolations('assertAllPositionsFinite', violations);
}

/**
 * 字段级一写者计数框架：任一节点任一几何字段（position/width/height）在断言窗口内恰好一个写者。
 * 框架=接口+计数器（GeometryWriteLedger 类）——reconcile 内建计数是 O0b-4 接线（transact 边界
 * assertExactlyOneWriter），本片只落框架类型与计数工具。
 * data.{width,height} 豁免废止：字段级全覆盖，不写豁免。
 */
export interface IGeometryWriteLedger {
  /** 登记一次写：writer 名下对 nodeId 的 field 计数 +1。 */
  record(writer: string, field: GeometryField, nodeId: string): void;
  /** 查询计数：field（可选再按 nodeId/ writer 收窄）的总次数。 */
  countFor(field: GeometryField, nodeId?: string, writer?: string): number;
  /** 列出该节点该字段的去重写者名（按首次登记序）。 */
  writersOf(field: GeometryField, nodeId: string): string[];
  /** 断言该字段在全部节点上写者数 ≤1——违者 throw 列首个违例节点及其写者名单。 */
  assertExactlyOneWriter(field: GeometryField): void;
  /** 清空计数（新断言窗口）。 */
  reset(): void;
}

export class GeometryWriteLedger implements IGeometryWriteLedger {
  // field → nodeId → (writer → count)
  private counts = new Map<GeometryField, Map<string, Map<string, number>>>();

  record(writer: string, field: GeometryField, nodeId: string): void {
    let byNode = this.counts.get(field);
    if (!byNode) {
      byNode = new Map();
      this.counts.set(field, byNode);
    }
    let byWriter = byNode.get(nodeId);
    if (!byWriter) {
      byWriter = new Map();
      byNode.set(nodeId, byWriter);
    }
    byWriter.set(writer, (byWriter.get(writer) ?? 0) + 1);
  }

  countFor(field: GeometryField, nodeId?: string, writer?: string): number {
    const byNode = this.counts.get(field);
    if (!byNode) return 0;
    if (nodeId == null) {
      let total = 0;
      for (const byWriter of byNode.values()) {
        for (const [w, n] of byWriter) {
          if (writer == null || w === writer) total += n;
        }
      }
      return total;
    }
    const byWriter = byNode.get(nodeId);
    if (!byWriter) return 0;
    if (writer == null) return [...byWriter.values()].reduce((a, b) => a + b, 0);
    return byWriter.get(writer) ?? 0;
  }

  writersOf(field: GeometryField, nodeId: string): string[] {
    return [...this.counts.get(field)?.get(nodeId)?.keys() ?? []];
  }

  assertExactlyOneWriter(field: GeometryField): void {
    const byNode = this.counts.get(field);
    if (!byNode) return;
    for (const [nodeId, byWriter] of byNode) {
      const writers = [...byWriter.keys()];
      if (writers.length > 1) {
        throw new Error(`[C0 断言] 字段级一写者违例：节点 ${nodeId} 的 ${field} 有 ${writers.length} 个写者 [${writers.join(',')}]（应恰好一个）`);
      }
    }
  }

  reset(): void {
    this.counts = new Map();
  }
}
