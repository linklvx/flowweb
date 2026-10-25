// packages/shared/src/canvas/text-domains.ts
// Y1c T15（plan v1.7）：Y.Text 域单源——spec §3.1 基准（audioGen/multiImageGen{prompt:Y.Text}；
// textInput{prompt:Y.Map{text:Y.Text}}）+§3.5 容器规则（结构创建时一次性建合法共享容器——
// 唯一创建者=写 seam；普通业务写禁懒创建掩盖结构错误；undo 重建合法〔新容器〕；恢复不夹带
// server 字段）。imageGen/videoGen/imageExtGen prompt=XmlFragment 归 T16，不在本词表。
//
// 三个执法面（splice 单一 seam——全仓 Y.Text 域写只走本模块）：
//   ① 创建 seam：fillDoc 对**在册且在记录 data 中出现**的域键物化容器（string→Y.Text /
//      {text}→Y.Map{text:Y.Text}；已实例原样——rebuild/快照回灌路径）；不发明缺席键
//      （重建等价断言口径：fresh 不多于 source——web 侧创建完整性由 ensureTextDomainDefaults
//      在 dispatch addNode seam 补齐域键缺省，doc 容器与 store 投影同源）。
//   ② 写 seam（writeTextDomainValue）：容器缺失=拒绝（container-missing——禁懒建掩盖结构
//      错误）/容器形状错=拒绝（container-type-mismatch）/值形态错=拒绝（value-form-mismatch）
//      ——命中域键永不 data.set 整串覆盖（getHTML/整串 diff 形态=容器替换对抗面，G17b）。
//   ③ 词表单源：TEXT_DOMAINS 自 DOC_SCHEMA_V4 派生（yType='text'→'text'；yType='map' 且
//      children.text='text'→'map-text'）——矩阵改形状本词表自动随动，禁第二真源。
//
// 零 yjs import（docShape 同款结构性纪律——防跨实例 instanceof 静默失败）：TextLike 为
// Y.Text 结构兼容面（length/toString/insert/delete——Y.Text 全满足），宿主注入工厂。
import { DOC_SCHEMA_V4 } from './doc-schema-v4';
import { isDocMap, type DocMapLike } from './collab-doc-ops';

/** Y.Text 结构性最小面（零 yjs import——Y.Text 结构兼容；测试可注入 fake）。 */
export interface TextLike {
  readonly length: number;
  toString(): string;
  insert(index: number, text: string): void;
  delete(index: number, len: number): void;
}

/** 域容器形状：'text'=裸 Y.Text（audioGen/multiImageGen.prompt）；
 *  'map-text'=Y.Map{text:Y.Text}（textInput.prompt——扩展位随 Y.Map 预留）。 */
export type TextDomainShape = 'text' | 'map-text';

/** 域词表（nodeType → { dataKey: shape }）——DOC_SCHEMA_V4 单源派生，禁手抄。 */
export function deriveTextDomains(
  schema: Record<string, { data: Record<string, { yType: string; children?: Record<string, { yType: string }> }> }>,
): Record<string, Record<string, TextDomainShape>> {
  const out: Record<string, Record<string, TextDomainShape>> = {};
  for (const [type, def] of Object.entries(schema)) {
    for (const [key, spec] of Object.entries(def.data)) {
      let shape: TextDomainShape | undefined;
      if (spec.yType === 'text') shape = 'text';
      else if (spec.yType === 'map' && spec.children?.text?.yType === 'text') shape = 'map-text';
      if (shape) (out[type] ??= {})[key] = shape;
    }
  }
  return out;
}

/** Y.Text 域词表（spec §3.1 基准的运行时投影——矩阵单源派生）。 */
export const TEXT_DOMAINS: Readonly<Record<string, Readonly<Record<string, TextDomainShape>>>> =
  deriveTextDomains(DOC_SCHEMA_V4);

/** 域键判定（nodeType×dataKey → 形状；未命中=undefined=非域键，调用方走普通 LWW 写）。 */
export function textDomainOf(nodeType: unknown, key: string): TextDomainShape | undefined {
  return typeof nodeType === 'string' ? TEXT_DOMAINS[nodeType]?.[key] : undefined;
}

/** TextLike 结构判定（零 instanceof——in 运算符 duck 化：**禁读属性**——未集成 Y.Text 的
 *  `length` getter/方法属性读取触发 yjs warnPrematureAccess 噪声（rebuild 回灌路径在 fillDoc
 *  物化面前拿到的是未集成实例；`in` 检查原型链存在性不触发 getter，Q-M-2 根修）。 */
export function isTextLike(v: unknown): v is TextLike {
  return typeof v === 'object' && v !== null
    && 'insert' in v && 'delete' in v;
}

/** 整串 → 最小 splice（公共前缀/后缀裁剪——IME 组段/粘贴/选区替换全形态收敛为单次 delete+insert）。 */
export function computeTextSplice(cur: string, next: string): { index: number; remove: number; insert: string } {
  if (cur === next) return { index: 0, remove: 0, insert: '' };
  let p = 0;
  const maxP = Math.min(cur.length, next.length);
  while (p < maxP && cur[p] === next[p]) p += 1;
  let s = 0;
  const maxS = Math.min(cur.length - p, next.length - p);
  while (s < maxS && cur[cur.length - 1 - s] === next[next.length - 1 - s]) s += 1;
  return { index: p, remove: cur.length - p - s, insert: next.slice(p, next.length - s) };
}

/** splice 单一 seam 应用体：TextLike 内容推进到 next（最小 diff——并发同位插入双端合并保留）。
 *  返回是否发生变更（同值 no-op——防 doc 膨胀，与 data.set 逐键 diff 守卫同纪律）。 */
export function spliceTextLike(t: TextLike, next: string): boolean {
  const cur = t.toString();
  const { index, remove, insert } = computeTextSplice(cur, next);
  if (remove === 0 && insert === '') return false;
  if (remove > 0) t.delete(index, remove);
  if (insert !== '') t.insert(index, insert);
  return true;
}

/** 创建/写 seam 值合法形态（'text'=string / 'map-text'={text:string} plain 对象——严格面：
 *  异形对象/数组/数字一律不收，结构错误在 seam 拒绝而非静默默认）。 */
function plainTextOf(shape: TextDomainShape, v: unknown): { text: string } | undefined {
  if (shape === 'text') return typeof v === 'string' ? { text: v } : undefined;
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && !isDocMap(v)
    && typeof (v as { text?: unknown }).text === 'string') {
    return { text: (v as { text: string }).text };
  }
  return undefined;
}

/** 创建 seam 物化结果（两段式——Q-M-2 根修）：container=物化容器（initialText=null 时原样
 *  透传值）；initialText≠null ⇒ 调用方须在**容器集成后**对 textTarget 写入初值（detached
 *  Y.Text 上 insert 依赖 yjs 内部 buffer 读取〔warnPrematureAccess 噪声〕——集成后写入=真 op）。
 *  'text'：string → 空容器+初值；TextLike → 原样透传（rebuild/快照回灌别名禁入面，内容自带）。
 *  'map-text'：{text} → Map{text:空容器}+初值；DocMapLike → 原样。
 *  其他（含键缺席 undefined）：原样透传——fillDoc 只物化在册在记域键，结构完整性归创建 seam
 *  （ensureTextDomainDefaults）——重建等价断言（fresh 不多于 source）依赖本不发明语义。 */
export interface MaterializeTextDomainResult {
  /** 物化容器（或原样透传值）——fillDoc 直接 data.set。 */
  value: unknown;
  /** 初值文本（null=无需写入：透传/异形/空串）；目标=shape 'text' 的 value 本体/'map-text' 的 text 子键。 */
  initialText: string | null;
}
export function materializeTextDomainValue(shape: TextDomainShape, value: unknown, f: { createText(): TextLike; createMap(): DocMapLike }): MaterializeTextDomainResult {
  if (shape === 'text') {
    if (isTextLike(value)) return { value, initialText: null };
    const plain = plainTextOf('text', value);
    if (!plain) return { value, initialText: null };
    return { value: f.createText(), initialText: plain.text };
  }
  if (isDocMap(value)) return { value, initialText: null };
  const plain = plainTextOf('map-text', value);
  if (!plain) return { value, initialText: null };
  const m = f.createMap();
  m.set('text', f.createText());
  return { value: m, initialText: plain.text };
}

/** 物化结果的初值写入目标解析（fillDoc 集成后消费——shape 定位 text 键）。 */
export function textTargetOf(shape: TextDomainShape, container: unknown): TextLike | undefined {
  if (shape === 'text') return isTextLike(container) ? container : undefined;
  if (!isDocMap(container)) return undefined;
  const inner = container.get('text');
  return isTextLike(inner) ? inner : undefined;
}

/** 创建 seam 域键缺省补齐（**纯函数**——Q-M-6：不突变入参，返回补齐副本；无缺省键时返回原引用
 *  便于调用方零拷贝直通）：audioGen/multiImageGen.prompt=''、textInput.prompt={text:''}。
 *  已在键不覆写（dataOverride 显式初值优先）。调用面=canvasIntents.applyIntentToDoc（fillDoc 前）
 *  +canvasStore 构造点预填（doc 容器/store 投影/ns 直写三面同源）。 */
export function ensureTextDomainDefaults(nodeType: unknown, data: Record<string, unknown>): Record<string, unknown> {
  const domains = typeof nodeType === 'string' ? TEXT_DOMAINS[nodeType] : undefined;
  if (!domains) return data;
  let out: Record<string, unknown> | null = null;
  for (const [key, shape] of Object.entries(domains)) {
    if (data[key] !== undefined) continue;
    (out ??= { ...data })[key] = shape === 'text' ? '' : { text: '' };
  }
  return out ?? data;
}

/** 写 seam 拒绝词表（closed enum——canvasIntents diag reason + 观测面同词）。 */
export type TextDomainRejectReason =
  | 'container-missing'        // 域键无容器（结构创建缺位）——拒绝不懒建（§3.5）
  | 'container-type-mismatch'  // 容器形状错（如 prompt=string 覆在 Y.Text 位）——结构错误不掩盖
  | 'value-form-mismatch';     // patch 值非法定形态（'text'=string；'map-text'={text:string}|string）

export type TextDomainWriteResult = { ok: true; changed: boolean } | { ok: false; reason: TextDomainRejectReason };

/** 写 seam（updateNodeData/updateNodeData 原语共口）：域键值写=容器内 TextLike 最小 splice。
 *  拒绝三档见 TextDomainRejectReason；命中域键**永不** data.set（整串覆盖/容器替换结构性禁止）。
 *  'map-text' 值形态={text:string}|string（面板整串受控值——两形等价 splice 内层 text）。 */
export function writeTextDomainValue(data: DocMapLike, shape: TextDomainShape, key: string, value: unknown): TextDomainWriteResult {
  const container = data.get(key);
  if (container === undefined) return { ok: false, reason: 'container-missing' };
  if (shape === 'text') {
    if (!isTextLike(container)) return { ok: false, reason: 'container-type-mismatch' };
    const plain = plainTextOf('text', value);
    if (!plain) return { ok: false, reason: 'value-form-mismatch' };
    return { ok: true, changed: spliceTextLike(container, plain.text) };
  }
  if (!isDocMap(container)) return { ok: false, reason: 'container-type-mismatch' };
  const inner = container.get('text');
  if (!isTextLike(inner)) return { ok: false, reason: 'container-type-mismatch' };
  const plain = plainTextOf('map-text', value) ?? plainTextOf('text', value);
  if (!plain) return { ok: false, reason: 'value-form-mismatch' };
  return { ok: true, changed: spliceTextLike(inner, plain.text) };
}
