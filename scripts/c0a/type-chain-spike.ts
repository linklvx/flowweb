// C0a spike：placement 四类型链编译验证（Z2''-v6——Raw/Doc/Projected/CanvasStoreNode 分职，零 as）
// 自包含（复刻 CanvasNodeRecord 语义）——验证 G13「projectCanvasNodes 删 cast」路径可编译
// 编译：npx tsc --strict --noEmit scripts/c0a/type-chain-spike.ts

interface Placement { parentId: string | null; order: string }

/** ① doc 读出口（total 容忍——placement/position/wh 缺省合法态） */
interface RawNodeRecord {
  id: string;
  type: string;
  placement?: Placement;
  position?: { x: number; y: number };
  width?: number; height?: number;
  data: Record<string, unknown>;
}

/** ② 写输入（规范化——placement 必填；fillDoc/applyIntentToDoc 只收此型） */
interface DocNodeRecord {
  id: string;
  type: string;
  placement: Placement;
  position?: { x: number; y: number };
  width?: number; height?: number;
  data: Record<string, unknown>;
}

/** ③ diff/seed 投影（position 可缺——auto 组键集表剥 wh；parentId/order 派生） */
interface ProjectedRecord {
  id: string;
  type: string;
  parentId?: string | null;
  order?: string;
  position?: { x: number; y: number };
  width?: number; height?: number;
  data: Record<string, unknown>;
}

/** ④ cs 面（RF Node 形态——position 必填+RF 字段+order 派生只读） */
interface RFNodeBase { id: string; selected?: boolean; dragging?: boolean; measured?: { width: number; height: number } }
interface CanvasStoreNode extends RFNodeBase {
  type: string;
  parentId?: string | null;
  order?: string;
  position: { x: number; y: number };
  width?: number; height?: number;
  data: Record<string, unknown>;
}

/** 派生：Raw → Projected（placement → parentId/order；零 as——条件展开） */
function toProjected(r: RawNodeRecord): ProjectedRecord {
  return {
    id: r.id,
    type: r.type,
    ...(r.placement != null ? { parentId: r.placement.parentId, order: r.placement.order } : {}),
    ...(r.position != null ? { position: r.position } : {}),
    ...(r.width != null ? { width: r.width } : {}),
    ...(r.height != null ? { height: r.height } : {}),
    data: r.data,
  };
}

/** cs 构造：Projected → CanvasStoreNode（position 缺省 {0,0}=RF 契约面显式兜底——非 as 强转） */
function toStoreNode(p: ProjectedRecord): CanvasStoreNode {
  return {
    id: p.id,
    type: p.type,
    ...(p.parentId != null ? { parentId: p.parentId } : {}),
    ...(p.order != null ? { order: p.order } : {}),
    position: p.position ?? { x: 0, y: 0 },
    ...(p.width != null ? { width: p.width } : {}),
    ...(p.height != null ? { height: p.height } : {}),
    data: p.data,
  };
}

/** 写输入窄化：Raw → Doc（validateNodeRecord 契约——缺 placement=typed 拒绝） */
function toDocOrReject(r: RawNodeRecord): { ok: true; node: DocNodeRecord } | { ok: false; reason: 'missing-placement' } {
  if (r.placement == null) return { ok: false, reason: 'missing-placement' };
  return { ok: true, node: { ...r, placement: r.placement } };
}

/** projectCanvasNodes 等价（返回 ProjectedRecord[]——v5 前的 `as CanvasNodeRecord` cast 消除验证） */
function projectCanvasNodesV6(raws: RawNodeRecord[]): ProjectedRecord[] {
  return raws.map(toProjected);
}
function buildStore(raws: RawNodeRecord[]): CanvasStoreNode[] {
  return projectCanvasNodesV6(raws).map(toStoreNode);
}

// 烟雾消费（编译期契约自证）
const raws: RawNodeRecord[] = [
  { id: 'a', type: 'group', data: {} }, // auto 组无 position/wh——键集表剥键形态
  { id: 'b', type: 'image', placement: { parentId: 'a', order: 'K' }, position: { x: 1, y: 2 }, width: 3, height: 4, data: {} },
  { id: 'c', type: 'image', data: { fileId: 'm1' } }, // 坏节点（缺 placement）——total 合法态
];
const store = buildStore(raws);
const t: { x: number; y: number } = store[0].position; // CanvasStoreNode.position 必填契约成立（编译即证）
const docOk = toDocOrReject(raws[0]);
const docBad = toDocOrReject(raws[2]);
if (!docOk.ok) { throw new Error('unreachable'); }
if (docBad.ok) { throw new Error('unreachable'); }
const r: 'missing-placement' = docBad.reason; // typed 拒绝可判别
void t; void r;
