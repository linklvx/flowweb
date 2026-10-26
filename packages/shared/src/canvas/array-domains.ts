// packages/shared/src/canvas/array-domains.ts
// Y1c T17（plan v1.7）：媒体列表 Y.Array 域单源——spec §3.1 基准（imageGen/imageExtGen/
// videoGen{allImages=Y.Array<item>}；multiImageGen{images=Y.Array<item>}）+§3.5 容器规则
// （T15 先例：结构创建时一次性建合法共享容器——唯一创建者=写 seam；普通业务写禁懒创建掩盖
// 结构错误；undo 重建合法〔新容器〕）+v5-7「媒体列表=Y.Array（不默认整数组覆盖——迁移单卡
// 读写同卡）」。Y.Text 域=text-domains、XmlFragment 域=xml-schema，本模块=第三族同款纪律。
//
// 三个执法面（结构操作单一 seam——全仓媒体列表域写只走本模块）：
//   ① 创建 seam：fillDoc 对在册域键物化 Y.Array（plain array→容器+items；已实例原样——
//      rebuild/快照回灌路径）；不发明缺席键（重建等价断言口径：fresh 不多于 source——web 侧
//      创建完整性由 ensureArrayDomainDefaults 在 dispatch addNode seam 补齐域键缺省 []）。
//   ② 写 seam（writeArrayDomainValue）：容器缺失=拒（container-missing——禁懒建掩盖结构
//      错误）/容器形状错=拒（container-type-mismatch——legacy plain array 覆在位=结构错误暴露）
//      /值形态错=拒（value-form-mismatch——非数组/item 缺稳定 id/next 内 id 重复）。命中域键
//      **永不 data.set 整串覆盖**（整串数组替换=并发 add/remove 丢一方的 LWW 载体——G17b 同族
//      对抗面）；全量 patch 值经稳定 id diff 落为最小结构操作（delete/insert——reorder 的
//      delete+insert 语义由 Y.Array CRDT 在并发下合并，不再丢一方）。
//   ③ 词表单源：ARRAY_DOMAINS 自 DOC_SCHEMA_V4 派生（yType='array'）——矩阵改形状本词表
//      自动随动，禁第二真源。
//
// item 身份（spec §3.5「nodeId 即身份」的列表同族）：item.id=稳定字符串身份（ImageItem
// {id,url,name,status,progress}——uploading→success 原位替换按 id 匹配；media-refs 读侧
// item.id=mediaId 槽位）。item 载体=plain JSON 对象（ContentAny）；容器内 item 无有效 id
// （对抗/异形）不参与匹配（写时按 next 全量收敛——确定性删后插，不抛）。
//
// 零 yjs import（text-domains 同款结构性纪律——防跨实例 instanceof 静默失败）：YArrayLike
// 为 Y.Array 结构兼容面（length/get/insert/delete——Y.Array 全满足），宿主注入工厂。
import { DOC_SCHEMA_V4 } from './doc-schema-v4';
import { isDocMap, type DocMapLike } from './collab-doc-ops';

/** Y.Array 结构性最小面（零 yjs import——Y.Array 结构兼容；测试可注入 fake）。 */
export interface YArrayLike {
  readonly length: number;
  get(index: number): unknown;
  insert(index: number, items: unknown[]): void;
  delete(index: number, len: number): void;
}

/** item 稳定身份键（ImageItem.id / media-refs targetItemId 同键）。 */
export const MEDIA_LIST_ITEM_ID_KEY = 'id' as const;

/** 媒体列表规模护栏（Y1c T17 双评审收口 spec-M-1）：computeArraySplice=O(m×k) LCS diff——
 *  面板自然上界=单节点个位数（multiImage 上传 maxCount=9 实证），100=10× 余量护栏；超限
 *  （diff 输入双侧：容器项数或 next 项数）=对抗/病态语料，diff 不展开按 value-form-mismatch
 *  fail-closed 拒（与「结构错误暴露不掩盖」同政策——规模病态也是结构错误面）。 */
export const MEDIA_LIST_MAX_ITEMS = 100;

/** 媒体列表域词表（nodeType → dataKey 集）——DOC_SCHEMA_V4 yType==='array' 派生，禁手抄：
 *  imageGen/imageExtGen/videoGen{allImages}；multiImageGen{images}。 */
export function deriveArrayDomains(
  schema: Record<string, { data: Record<string, { yType: string }> }>,
): Record<string, ReadonlySet<string>> {
  const out: Record<string, Set<string>> = {};
  for (const [type, def] of Object.entries(schema)) {
    for (const [key, spec] of Object.entries(def.data)) {
      if (spec.yType === 'array') (out[type] ??= new Set<string>()).add(key);
    }
  }
  return out;
}

/** 媒体列表域词表运行时投影（spec §3.1 数组域行——矩阵单源派生）。 */
export const ARRAY_DOMAINS: Readonly<Record<string, ReadonlySet<string>>> =
  deriveArrayDomains(DOC_SCHEMA_V4);

/** 域键判定（nodeType×dataKey → 是否媒体列表域——容器规则=T15：结构创建时一次性建 Y.Array、
 *  唯一创建者=写 seam；updateNodeData 域键整串 data.set=容器替换对抗面〔G17b〕拒）。 */
export function isMediaListDomainKey(nodeType: unknown, key: string): boolean {
  return typeof nodeType === 'string' && (ARRAY_DOMAINS[nodeType]?.has(key) ?? false);
}

/** Y.Array 结构判定（零 instanceof——typeof 函数检且不读 length：wire 可达伪形态
 *  {insert:1,delete:1} 归 container-type-mismatch 干净拒——text-domains isTextLike 同款 RI-2）。 */
export function isYArrayLike(v: unknown): v is YArrayLike {
  return typeof v === 'object' && v !== null
    && typeof (v as { get?: unknown }).get === 'function'
    && typeof (v as { insert?: unknown }).insert === 'function'
    && typeof (v as { delete?: unknown }).delete === 'function';
}

/** item 稳定 id 提取（双形态：DocMap〔get('id')〕/plain object〔item.id〕——media-refs
 *  refItemId 同口径；非字符串/空串=null=不参与匹配）。 */
function itemIdOf(item: unknown): string | null {
  if (item === null || typeof item !== 'object') return null;
  const id = isDocMap(item)
    ? item.get(MEDIA_LIST_ITEM_ID_KEY)
    : (item as Record<string, unknown>)[MEDIA_LIST_ITEM_ID_KEY];
  return typeof id === 'string' && id !== '' ? id : null;
}

/** item 读归一（DocMap→plain 对象——内容比对/回读同形；plain 原样引用）。 */
function normalizeItem(item: unknown): unknown {
  if (isDocMap(item)) return Object.fromEntries([...item.entries()]);
  return item;
}

/** 值合法形态（写 seam patch 值）：plain 数组 ∧ 每 item=对象携非空 string id ∧ id 唯一。
 *  严格面：非数组/伪形态/缺 id/重复 id 一律不收——结构错误在 seam 拒而非静默合并。 */
export function isMediaListValue(v: unknown): v is Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return false;
  const seen = new Set<string>();
  for (const item of v) {
    const id = itemIdOf(item);
    if (id === null || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/** 容器 → plain item 数组读出口（读侧收敛：调用方/测试消费同形——toReadModel decodeYValue
 *  之外的本域薄读面）。异形值（非容器）原样透传由调用方处置。 */
export function mediaListItemsOf(container: YArrayLike): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < container.length; i += 1) out.push(normalizeItem(container.get(i)));
  return out;
}

/** 深比较（item 内容变更检测——replace 判据；数组/对象递归，其余 ===）。 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object'
    && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/** 结构操作计划（稳定 id diff 产物——应用序：先 deletes（降位序）后 inserts（升位序））。 */
export interface ArraySplicePlan {
  /** 删除（容器当前位序——降序应用）；含内容变更 item 的原位删除（replace=delete+insert）。 */
  deletes: Array<{ index: number; len: number }>;
  /** 插入（目标位序——升序应用；reorder 的 delete+insert 语义载体）。 */
  inserts: Array<{ index: number; items: unknown[] }>;
}

/**
 * 整串 → 最小结构操作（公共稳定 id 序列 LCS——add/remove/reorder/replace 全形态收敛）：
 * - LCS 内且内容同 ⇒ 原位保持（零 op）；
 * - LCS 外的当前项 ⇒ delete（reorder/remove）；
 * - next 新项/内容变更项 ⇒ insert（add/replace/reorder 的插入半边）。
 * LCS 保证保留项相对序与 next 一致——删后插后容器恒等于 next（含未识别 id 的容器项：
 * 不参与匹配，全部删除——确定性收敛不抛）。
 *
 * **前置条件（Y1c T17 双评审收口 Q-M-3）**：`next` 的 item id 唯一（isMediaListValue 执法面
 * ——writeArrayDomainValue 单点保证后调用）。直接调用方须自守：next 含重复 id 时本函数不抛，
 * 但保留/删除判定在重复项上退化为首个匹配（keptUnchanged 单值集）——产物仍确定性、非崩溃，
 * 然语义上「同 id 两项并存」非本域合法形态，写 seam 恒拒之于前。
 * 规模前置：m/k ≤ MEDIA_LIST_MAX_ITEMS（同上单点保证——超限 diff 不展开）。
 */
export function computeArraySplice(cur: readonly unknown[], next: readonly unknown[]): ArraySplicePlan {
  // LCS（id 序列——容器项无 id 记 null，null 恒不匹配）
  const curIds = cur.map(itemIdOf);
  const nextIds = next.map(itemIdOf);
  const m = curIds.length;
  const k = nextIds.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(k + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = k - 1; j >= 0; j -= 1) {
      lcs[i][j] = curIds[i] !== null && curIds[i] === nextIds[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const keepCur = new Set<number>();   // 容器保留位（LCS 命中且内容同）
  const keptUnchanged = new Set<string>(); // LCS 命中且内容未变 id
  let i = 0, j = 0;
  while (i < m && j < k) {
    if (curIds[i] !== null && curIds[i] === nextIds[j]) {
      if (deepEqual(normalizeItem(cur[i]), normalizeItem(next[j]))) {
        keepCur.add(i);
        keptUnchanged.add(curIds[i]!);
      }
      i += 1; j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i += 1;
    else j += 1;
  }
  const deletes: ArraySplicePlan['deletes'] = [];
  for (let idx = 0; idx < m; idx += 1) if (!keepCur.has(idx)) deletes.push({ index: idx, len: 1 });
  // 插入位序：删除后的容器=保留项序列（相对序同 next）——按 next 序走读，非保留项在其目标位插入
  const inserts: ArraySplicePlan['inserts'] = [];
  let writeIdx = 0;
  for (let nj = 0; nj < k; nj += 1) {
    const id = nextIds[nj];
    if (id !== null && keptUnchanged.has(id)) { writeIdx += 1; continue; }
    inserts.push({ index: writeIdx, items: [next[nj]] });
    writeIdx += 1;
  }
  return { deletes: deletes.reverse(), inserts };   // deletes 降序应用（高位先删——低位索引不漂移）
}

/** item 插入侧浅拷（Y1c T17 双评审收口 spec-M-2——与 materializeArrayDomainValue 同款纪律：
 *  调用方数组与 doc 容器引用隔离，防 ns 侧未来原地 mutate 经共享引用静默改 doc；
 *  DocMap/数组/标量原样——仅 plain 对象拷贝）。 */
const copyInsertedItem = (item: unknown): unknown =>
  item !== null && typeof item === 'object' && !Array.isArray(item) && !isDocMap(item) ? { ...item } : item;

/** 应用计划到容器（单一应用体——deletes 降序已完成，inserts 升序直放；插入侧浅拷）。 */
function applyArraySplice(container: YArrayLike, plan: ArraySplicePlan): void {
  for (const d of plan.deletes) container.delete(d.index, d.len);
  for (const ins of plan.inserts) container.insert(ins.index, ins.items.map(copyInsertedItem));
}

/** 写 seam 拒绝词表（closed enum——canvasIntents diag reason + 观测面同词；text-domains 同族）。 */
export type ArrayDomainRejectReason =
  | 'container-missing'        // 域键无容器（结构创建缺位）——拒绝不懒建（§3.5）
  | 'container-type-mismatch'  // 容器形状错（如 legacy plain array 覆在 Y.Array 位）——结构错误不掩盖
  | 'value-form-mismatch';     // patch 值非法定形态（非数组/item 缺稳定 id/next 内 id 重复/超 MEDIA_LIST_MAX_ITEMS 规模护栏〔spec-M-1〕）

export type ArrayDomainWriteResult = { ok: true; changed: boolean } | { ok: false; reason: ArrayDomainRejectReason };

/**
 * 写 seam（updateNodeData 域键共口）：媒体列表值写=容器内最小结构操作（稳定 id diff——
 * 并发 add/remove/reorder 由 Y.Array CRDT 合并不丢一方）。拒绝三档见 ArrayDomainRejectReason
 *（value-form-mismatch 含 spec-M-1 规模护栏档）；命中域键**永不** data.set（整串覆盖=容器
 * 替换结构性禁止）。插入侧 item 浅拷（spec-M-2——调用方数组与容器引用隔离）。
 * 返回 changed（同值 no-op=零 op——防 doc 膨胀，与 data.set 逐键 diff 守卫同纪律）。
 */
export function writeArrayDomainValue(data: DocMapLike, key: string, value: unknown): ArrayDomainWriteResult {
  const container = data.get(key);
  if (container === undefined) return { ok: false, reason: 'container-missing' };
  if (!isYArrayLike(container)) return { ok: false, reason: 'container-type-mismatch' };
  if (!isMediaListValue(value)) return { ok: false, reason: 'value-form-mismatch' };
  // Y1c T17 双评审收口 spec-M-1：规模护栏（diff 输入双侧超限=对抗/病态——O(m×k) 不展开，
  // fail-closed 拒；面板自然上界 9 → 100=10× 余量）
  if (value.length > MEDIA_LIST_MAX_ITEMS || container.length > MEDIA_LIST_MAX_ITEMS) {
    return { ok: false, reason: 'value-form-mismatch' };
  }
  const plan = computeArraySplice(mediaListItemsOf(container), value);
  if (plan.deletes.length === 0 && plan.inserts.length === 0) return { ok: true, changed: false };
  applyArraySplice(container, plan);
  return { ok: true, changed: true };
}

/** 创建 seam 物化工厂（宿主注入——零 yjs 依赖面；DocLike.createArray）。 */
export interface ArrayDomainFactories {
  createArray(): YArrayLike;
}

/**
 * 创建 seam 物化（text-domains materializeTextDomainValue 同族）：
 * - plain array → 全新 Y.Array + items 逐项浅拷入（item=flat ImageItem——调用方数组与 doc 容器
 *   引用隔离；detached insert 零读零告警——T15 RM-1 同款，集成随 data.set）；
 * - YArrayLike 实例 → 原样透传（rebuild/快照回灌路径——内容自带）；
 * - 其他（含键缺席 undefined：fillDoc 不发明缺席键——完整性归 ensureArrayDomainDefaults）→
 *   原样透传（异形=结构错误暴露不掩盖——后续域键写 seam 拒 container-type-mismatch）。
 */
export function materializeArrayDomainValue(value: unknown, f: ArrayDomainFactories): unknown {
  if (isYArrayLike(value)) return value;
  if (Array.isArray(value)) {
    const a = f.createArray();
    if (value.length > 0) a.insert(0, value.map((item) => (item !== null && typeof item === 'object' && !Array.isArray(item) && !isDocMap(item) ? { ...item } : item)));
    return a;
  }
  return value;
}

/**
 * 创建 seam 域键缺省补齐（**纯函数**——Q-M-6 同款：不突变入参，返回补齐副本；无缺省键时返回
 * 原引用便于调用方零拷贝直通）：imageGen/imageExtGen/videoGen.allImages=[]、multiImageGen.
 * images=[]。已在键不覆写（dataOverride 显式初值优先）。调用面=canvasIntents.applyIntentToDoc
 * （fillDoc 前）+canvasStore 构造点预填（doc 容器/store 投影/ns 直写三面同源）。
 */
export function ensureArrayDomainDefaults(nodeType: unknown, data: Record<string, unknown>): Record<string, unknown> {
  const domains = typeof nodeType === 'string' ? ARRAY_DOMAINS[nodeType] : undefined;
  if (!domains) return data;
  let out: Record<string, unknown> | null = null;
  for (const key of domains) {
    if (data[key] !== undefined) continue;
    (out ??= { ...data })[key] = [];
  }
  return out ?? data;
}
