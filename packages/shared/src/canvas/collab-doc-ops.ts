// packages/shared/src/canvas/collab-doc-ops.ts
// Y1a T1（plan v11.2 片 S0，v10.1 T1+T2 合并）：doc 写原语+关联类型自 docShape 抽离
// （零行为变更纯机械迁移）。本模块=对 doc 执行节点写操作的原语（setDocPosition position
// 写原语唯一单源 / applyRecordToYMap 增量写）+其签名关联类型（DocMapLike/StoredNodeRecord
// ——docShape 读断言/剥键族仍消费，经本模块单源引用）。
// 依赖方向：docShape → collab-doc-ops 单向（本模块零 docShape import——环检测零命中的结构保证）。

/** Y.Map 结构性最小面（零 yjs import——防跨实例 instanceof 静默失败，nodeEnvelope 同理由）。
 *  O0a-1 按需扩键：delete（增量删键）/entries（读遍历）——Y.Map 结构兼容零包装。 */
export interface DocMapLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
  delete(key: string): void;
  entries(): Iterable<[string, unknown]>;
}

/** 结构性子 Map 判定（零 instanceof——鸭子判定 get/has 方法存在；JSON 纯对象无方法不误判）。 */
export function isDocMap(v: unknown): v is DocMapLike {
  return typeof v === 'object' && v !== null
    && typeof (v as { get?: unknown }).get === 'function'
    && typeof (v as { has?: unknown }).has === 'function';
}

/** 作者态 doc 节点记录（docShape 家族出口专用）：键可选——键集表语义：auto 组无帧键 /
 *  manual 组折叠仍保留三键 / storyboard 组无 wh / 分镜子无 position，运行时键集由谓词守卫、
 *  类型层=可选键。与 nodeEnvelope.ts 的 CanvasNodeRecord（cs/渲染/copyPlan 面，必填）分裂并存——不改后者。
 *  position 裸 {x,y} 注（O0b-0）：doc=abs 空间（写侧 toDocRecords rel→abs 翻转、读侧直拷）——
 *  本族读写管道进出同一空间；AbsPos 品牌收紧随翻转批语义落地后按需跟进（本批不加类型层）。 */
export interface StoredNodeRecord {
  id: string;
  type: string;
  parentId?: string;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  data: Record<string, unknown>;
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

/** 增量写：record 缺键 → Y.Map delete；值变才 set（同值 no-op——无守卫=doc 膨胀）。
 *  键集表跳过（O0a-1）：记录无 position → 不写不删（分镜子剥键写者在上游——既有键不覆写）；
 *  position 子 Map 缺失（人为构造）→ 经 createMap 工厂创建。仅测试消费（生产写路径已收口
 *  canvasIntents——批 4b：updateNodeEnvelope 内联逐键 diff）；O0a-2 起 api 种子写走 fillDoc
 *  （writeNodeToYMap 符号整删——4aaf2fd9，读写同收编 shared docShape 单源）。 */
export function applyRecordToYMap(
  m: DocMapLike,
  r: StoredNodeRecord,
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
