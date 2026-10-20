// packages/shared/src/canvas/canvas-doc-manifest.ts
// Y0c T4（E17/E38 四层形态冻结+R0c-3；Z108 manifest 升格执行期校验表；Z148① idempotent 列）：
// doc schema manifest TS 单源——A1 DocWriter（T8 writeBatch 进门）与 T27 端点 body 校验直接消费。
// 四层：①顶层 map 集合 ②嵌套类型唯一创建者（E27——census 组㉓执法 lexical 面，本表=语义登记面）
// ③每键写入者与读者 ④归属（doc·exec·PG·投影合成）+撤销 scope。
// 键集引用纪律：docShape/nodeEnvelope 已有 schema 一律引用（禁第二真源重复声明值域）——
// 信封键=NODE_ENVELOPE_KEYS、批字节上限=QUOTA_DEFAULTS.maxTxBytes（COLLAB_MAX_TX_BYTES 同源）。
import { QUOTA_DEFAULTS } from '../constants/collab-quota';
import { utf8Bytes } from '../utils/utf8-bytes';
import { NODE_ENVELOPE_KEYS } from './nodeEnvelope';
import type { StoredNodeRecord } from './collab-doc-ops';
import type { DocEdgeRecord } from './docShape';

// ── 层①：顶层 map 集合（生产 getMap 面实测 2026-10-14：nodes/meta/edges/exec 四 map，别无他名）──
export const DOC_TOP_LEVEL_MAPS = ['meta', 'nodes', 'edges', 'exec'] as const;
export type DocTopLevelMap = (typeof DOC_TOP_LEVEL_MAPS)[number];

// ── 层④：归属面+撤销 scope 词汇 ──
/** 键事实归属：doc=doc 内真值 / exec=exec map 语义域 / pg=PG 列真值 / projection=投影合成（非存储键）。 */
export type DocKeyOwnership = 'doc' | 'exec' | 'pg' | 'projection';
/** 撤销 scope：client-undo=客户端意图写面可撤销 / server-only=服务端写（客户端 undo 不达）。 */
export type DocUndoScope = 'client-undo' | 'server-only';

// ── 层②：E27 嵌套唯一创建者登记（语义面；census 组㉓=lexical 白名单执法面）──
export interface NestedCreatorEntry {
  /** 容器（顶层 map 或嵌套路径；'*'=动态 id 键域） */
  container: string;
  key: string;
  /** 创建点标识（生产函数级）；多条并存=现状勘注（unique:false） */
  creators: readonly string[];
  /** E27 目标形态：每个 (容器,键) 嵌套创建点唯一。false=多创建点现状登记（Y1c-3 收敛裁度） */
  unique: boolean;
  note?: string;
}
export const NESTED_TYPE_CREATORS: readonly NestedCreatorEntry[] = [
  {
    container: 'nodes', key: '<nodeId>',
    creators: ['docShape.fillDoc（经 DocLike.createMap 工厂——gate-canvas-state/doc-like.util/ydocBuilder 三适配点）'],
    unique: true,
  },
  {
    container: 'nodes.<id>', key: 'data',
    creators: ['docShape.fillDoc（种子）', 'canvasIntents.applyIntentToDoc(updateNodeData)（客户端意图）',
      'collab-document.service.writeNodeData（服务端写面）'],
    unique: false,
    note: '客户端/服务端/种子三创建点跨进程并存（现状勘注）——Y0a 红例「两 doc 并发对同 nodeId 首建 data 合并单边胜出」风险域，收敛裁度归 Y1c-3',
  },
  {
    container: 'nodes.<id>', key: 'position',
    creators: ['collab-doc-ops.setDocPosition（唯一创建原语——canvasIntents/ydocBuilder 调用点工厂实参同此一函数；Y1a T1 自 docShape 迁入）'],
    unique: true,
  },
  {
    container: 'edges', key: '<edgeId>',
    creators: ['docShape.fillDoc（种子）', 'canvasIntents.applyIntentToDoc(upsertEdge)（在则复用守卫）'],
    unique: false,
    note: '双创建点现状登记——upsert 形态在则复用（非并发首建域）',
  },
  {
    container: 'exec', key: '<nodeId>',
    creators: ['collab-document.service.writeExecStatus'],
    unique: true,
    note: '客户端零 exec 写（批0.5 起静态断言）',
  },
  {
    container: '*', key: '*',
    creators: ['collab.gateway.deepCopyYMap（vacuum 真空重建——任意嵌套递归拷贝）'],
    unique: true,
    note: '重建域=新 doc 副本构造，非协作合并面',
  },
];

// ── 键集符号单源（先于 manifest 声明——path/readers 描述串模板派生自此，禁手抄枚举＝I-2 漂移教训）──

/** fillDoc 边记录键域（编译锚定 DocEdgeRecord——nodeEnvelope NODE_ENVELOPE_KEYS 同款防漂移）。 */
export const DOC_EDGE_RECORD_KEYS = ['id', 'source', 'target'] as const satisfies readonly (keyof DocEdgeRecord)[];
type _MissingEdgeKeys = Exclude<keyof DocEdgeRecord, (typeof DOC_EDGE_RECORD_KEYS)[number]>;
type _AssertNoMissing<T extends never> = T;
type _EdgeAnchor = _AssertNoMissing<_MissingEdgeKeys>;  // 勿删——删即静默失去缺键防护

/** writeNodeData 服务端键域=现行写面实测键集（ai-download/ai-image-edit/lighting/execution 四调用方
 *  全枚举 2026-10-14）：fileId/resultUrl/videoUrl/content/result/errorCode。新增键未分类即
 *  UNKNOWN_KEY 红（键集冻结的宗旨）。 */
const SERVER_NODE_DATA_KEYS = ['fileId', 'resultUrl', 'videoUrl', 'content', 'result', 'errorCode'] as const;

/** writeExecStatus 键域=现行 ExecStatusPatch 写面实测键集（枚举全文见 DOC_WRITE_OPS.writeExecStatus——
 *  本常量即单源，path 派生+valueTypes 逐键声明同源，不再此处重抄）。T4 评审勘误（2026-10-14）：
 *  初版注释自称「execution.service 全调用点枚举」实为不实——漏 reason（execution.service.ts:306
 *  reserve 拒重复外呼投影与 :411 Z99 NodeBusy 投影两处 skipped 在写），若不补 A1 DocWriter 消费
 *  即 UNKNOWN_KEY 拒合法写。attempts 必填（编译级）；error 已被 errorPatch slice(0,200) 上界。 */
const EXEC_STATUS_KEYS = ['status', 'attempts', 'jobId', 'intentId', 'fileId', 'errorCode', 'error', 'rearmable', 'reason'] as const;

// ── 层③④：键清单种子条目（nodes/edges/exec——plan 指定种子三 map+meta 版本键）──
export interface DocKeyManifestEntry {
  map: DocTopLevelMap;
  /** 键路径形态（'*'=动态 id 键域；括注=键集域说明） */
  path: string;
  writers: readonly string[];
  readers: readonly string[];
  ownership: DocKeyOwnership;
  undo: DocUndoScope;
}
export const DOC_KEY_MANIFEST: Record<DocTopLevelMap, readonly DocKeyManifestEntry[]> = {
  meta: [
    {
      map: 'meta', path: 'meta.schemaVersion',
      writers: ['docShape.stampDocSchema（唯一戳源——WS loadDocument 无戳空档/api 种子 withDoc）'],
      readers: ['docShape.ensureSchemaVersion/assertDocSchema（REST 读门+写门）'],
      ownership: 'doc', undo: 'server-only',
    },
  ],
  nodes: [
    {
      map: 'nodes', path: `nodes.*（信封键=${NODE_ENVELOPE_KEYS.join('/')}——NODE_ENVELOPE_KEYS 单源派生）`,
      writers: ['docShape.fillDoc（种子）/applyRecordToYMap（增量）', 'canvasIntents.applyIntentToDoc(addNode/updateNodeEnvelope/moveNode/deleteNode)'],
      readers: ['docShape.readRecordsFromMaps→readCanvas/REST 快照', 'web reconcile（applyDocToStore 投影）'],
      ownership: 'doc', undo: 'client-undo',
    },
    {
      map: 'nodes', path: 'nodes.*.position',
      writers: ['collab-doc-ops.setDocPosition（唯一写原语——逐键 diff 同值 no-op；Y1a T1 自 docShape 迁入）', '键集表剥键面（分镜子无 position——membership 变更点为剥键写者）'],
      readers: ['docShape.toDocRecords（rel→abs 翻转切）', 'web 渲染投影'],
      ownership: 'doc', undo: 'client-undo',
    },
    {
      map: 'nodes', path: 'nodes.*.data.*（客户端域——EPHEMERAL_DATA_KEYS 禁入）',
      writers: ['canvasIntents.applyIntentToDoc(updateNodeData/addNode)'],
      readers: ['web ns data 回填/节点组件消费'],
      ownership: 'doc', undo: 'client-undo',
    },
    {
      map: 'nodes', path: 'nodes.*.data.*（服务端域=DOC_WRITE_OPS.writeNodeData.keys 白名单）',
      writers: ['collab-document.service.writeNodeData（逐键写禁整块替换）'],
      readers: [`web 产物消费（${SERVER_NODE_DATA_KEYS.join('/')}——SERVER_NODE_DATA_KEYS 派生）`, 'collab-document.service.probeArtifacts（产物键白名单）'],
      ownership: 'doc', undo: 'server-only',
    },
  ],
  edges: [
    {
      map: 'edges', path: `edges.*（${DOC_EDGE_RECORD_KEYS.join('/')} 单形状——R1a 收敛，DOC_EDGE_RECORD_KEYS 派生）`,
      writers: ['docShape.fillDoc（种子）', 'canvasIntents.applyIntentToDoc(upsertEdge/deleteEdge/deleteNode 级联删)'],
      readers: ['docShape.readRecordsFromMaps', 'web 连线渲染投影'],
      ownership: 'doc', undo: 'client-undo',
    },
  ],
  exec: [
    {
      map: 'exec', path: `exec.*（键集=DOC_WRITE_OPS.writeExecStatus.keys——${EXEC_STATUS_KEYS.join('/')}，EXEC_STATUS_KEYS 派生）`,
      writers: ['collab-document.service.writeExecStatus（唯一写者——客户端零 exec 写）'],
      readers: ['web exec 投影（execStatusView/visibility 门）', 'intent-reconcile/sweepOrphanExec（孤儿清扫兜底）'],
      ownership: 'exec', undo: 'server-only',
    },
  ],
};

// ── Z108 执行期校验表：DocWriteOp 六 op 词汇+逐 op 五面（键集/值域/字节上限/拒键/idempotent）──
export type DocWriteOpType =
  | 'writeNodeData'
  | 'writeExecStatus'
  | 'deleteNodeDataKeys'
  | 'deleteNodes'
  | 'fillDoc'
  | 'deleteExecOrphans';

/** DocWriteOp 线格式（A1 T8 writeBatch body 词汇——T27 端点同此消费）。 */
export type DocWriteOp =
  | { op: 'writeNodeData'; nodeId: string; patch: Record<string, unknown> }
  | { op: 'writeExecStatus'; nodeId: string; patch: Record<string, unknown> }
  | { op: 'deleteNodeDataKeys'; nodeId: string; keys: string[] }
  | { op: 'deleteNodes'; nodeIds: string[] }
  | { op: 'fillDoc'; nodes: StoredNodeRecord[]; edges: DocEdgeRecord[] }
  | { op: 'deleteExecOrphans' };

/** 值域词汇（JS typeof 域；null 单列——jobId:string|null 形态）。 */
export type ValueTypeName = 'string' | 'number' | 'boolean' | 'null';

export interface DocWriteOpSpec {
  /** 键集白名单（patch 键域/删键名单/fillDoc 载荷键域——空=op 无键集面） */
  keys: readonly string[];
  /** 值域（有写值面的 op 才有——键→types） */
  valueTypes?: Readonly<Record<string, readonly ValueTypeName[]>>;
  /** 每键值字节上限（utf8Bytes(JSON 值)——PATCH_TOO_LARGE 判据一；无值面 op 缺省） */
  keyMaxBytes?: number;
  /** Z148① 幂等列：T27 端点对 false 直接 4xx 拒收（Z133「端口只收幂等 op」可执行化） */
  idempotent: boolean;
}

/** Z108 批级上限：op 数/op 总字节 Σ（与 COLLAB_MAX_TX_BYTES 同源——QUOTA_DEFAULTS.maxTxBytes=262144）。
 *  op 数 1000=初始保守值（plan/spec 无数字依据），待 A1 T8 实测校准。 */
export const MAX_WRITE_OPS_PER_BATCH = 1000;
export const MAX_WRITE_BATCH_BYTES = QUOTA_DEFAULTS.maxTxBytes;

/** Z108③ 原型链三键显式拒绝（patch/删键名单/fillDoc data 全域生效）。 */
export const BANNED_DATA_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/** Record<DocWriteOpType,…> 穷尽=编译断言：新增第七 op 忘分类即 tsc 红（Z148① 宗旨）。 */
export const DOC_WRITE_OPS: Record<DocWriteOpType, DocWriteOpSpec> = {
  writeNodeData: {
    keys: SERVER_NODE_DATA_KEYS,
    valueTypes: Object.fromEntries(SERVER_NODE_DATA_KEYS.map((k) => [k, ['string'] as const])),
    keyMaxBytes: 65_536, // 文本产物 content/result 大文本域——≤批上限 1/4
    idempotent: true,    // 键级 set 语义——CRDT 重放同值收敛（Z133）
  },
  writeExecStatus: {
    keys: EXEC_STATUS_KEYS,
    valueTypes: {
      status: ['string'], attempts: ['number'], jobId: ['string', 'null'], intentId: ['string'],
      fileId: ['string'], errorCode: ['string'], error: ['string'], rearmable: ['boolean'], reason: ['string'],
    },
    keyMaxBytes: 4_096, // errorPatch 已 slice(0,200)——上限防绕过 errorPatch 直写大值
    idempotent: true,   // 键级 set+attempts 代次守卫（Z99/Z111）
  },
  deleteNodeDataKeys: {
    keys: SERVER_NODE_DATA_KEYS, // 删键名单与写域同集（删自己写过的键）
    idempotent: true,            // delete 幂等
  },
  deleteNodes: {
    keys: [],
    idempotent: true,            // delete 幂等
  },
  fillDoc: {
    // 载荷键域=节点信封+边记录（引用单源）。声明性数据——执法按记录类切域（节点=NODE_ENVELOPE_KEYS/
    // 边=DOC_EDGE_RECORD_KEYS，见 validateWriteBatch fillDoc 分支），generic 消费者禁按此扁平白名单校验。
    keys: [...NODE_ENVELOPE_KEYS, ...DOC_EDGE_RECORD_KEYS],
    idempotent: false,           // 无条件 new Y.Map=重放即新 item（doc 膨胀）——非幂等；种子路径专用，T27 端点拒收
  },
  deleteExecOrphans: {
    keys: [],
    idempotent: true,            // 重放二次扫描空集
  },
};

// ── 违规分类码+校验函数（Z108②：业务级拒绝非截断非 sanitize）──
export type WriteBatchViolationCode =
  | 'UNKNOWN_OP'
  | 'UNKNOWN_KEY'
  | 'PROTO_KEY_BANNED'
  | 'PATCH_TOO_LARGE'
  | 'OP_COUNT_EXCEEDED'
  | 'VALUE_TYPE_MISMATCH'
  | 'NON_IDEMPOTENT_OP';

/** 七码处置总表（T4 二轮 M-1——A1 T8 DocWriter/T27 端点消费契约，禁自造私有映射）：
 *  全七码同属 Z40① 内容违规=业务级拒绝——违规清单返调用方、不回滚整批、不 throw；
 *  A1 侧逐码进 reject 计数，T27 端点侧 4xx 拒收（NON_IDEMPOTENT_OP 仅 requireIdempotentOps:true
 *  执法档产出——Y0c T12 偏离 20：默认进程内档 fillDoc 种子路径合法，不产此码）。按执法面分三组：
 *  - 批级（进门即拒，index=-1）：OP_COUNT_EXCEEDED/PATCH_TOO_LARGE（批 Σ）
 *  - op 形态级：UNKNOWN_OP（非对象/类型不在六 op 词汇/patch·keys·nodes 载荷缺或形不对）
 *    /NON_IDEMPOTENT_OP（Z148① 端点执法档——flag 门控）
 *  - 键值内容级：UNKNOWN_KEY/PROTO_KEY_BANNED（Z108③）/VALUE_TYPE_MISMATCH/PATCH_TOO_LARGE（每键） */
export interface WriteBatchViolation {
  /** op 索引（批级违规=-1） */
  index: number;
  code: WriteBatchViolationCode;
  /** 违规 op 类型（批级违规/op 形态不可知时缺省——日志裸读免按 index 反查 ops 数组） */
  opName?: string;
  /** 违规键（键面违规时） */
  key?: string;
  message: string;
}

const typeNameOf = (v: unknown): ValueTypeName | 'json' =>
  v === null ? 'null' : typeof v === 'string' ? 'string' : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'json';

/** 检查一个键值对（键名禁键+白名单+值域+字节上限）——writeNodeData/writeExecStatus patch 共用。
 *  Y0c T9（Z5 分流勘正）：undefined 不是内容违规——writeNodeData=原语/进门 UNDEFINED_PATCH_VALUE
 *  fail-fast throw（api 侧 collab-document.service 单源）、writeExecStatus=原语跳过
 *  （applyWriteExecStatusToDoc `v !== undefined` 既有语义）；undefined 经 JSON wire 不可达
 *  （本表的其他消费面 T27 端点同样收不到），故校验面不执法（skip 早退）——否则 typeNameOf 把
 *  undefined 归 'json' ⇒ VALUE_TYPE_MISMATCH 会把 Z5 的 throw 与「维持跳」两条语义双双拦死。 */
function checkPatchEntry(spec: DocWriteOpSpec, k: string, v: unknown, index: number, opName: string, out: WriteBatchViolation[]): void {
  if (v === undefined) return;
  if (BANNED_DATA_KEYS.includes(k)) {
    out.push({ index, opName, code: 'PROTO_KEY_BANNED', key: k, message: `原型链键 ${k} 显式拒绝（Z108③）` });
    return;
  }
  if (!spec.keys.includes(k)) {
    out.push({ index, opName, code: 'UNKNOWN_KEY', key: k, message: `键 ${k} 不在 DOC_WRITE_OPS 键集白名单` });
    return;
  }
  const domains = spec.valueTypes?.[k];
  // 白名单内键的值域覆盖完整性由结构测试钉死（valueTypes 与 keys 全等——manifest 结构完整性用例）：
  // `?.` 与空域判断是防御性形态（空域=不设限），非「忘配值域即静默跳过」的逃生口（T4 二轮 M-6）。
  const tn = typeNameOf(v);
  if (domains && domains.length > 0 && (tn === 'json' || !domains.includes(tn))) {
    out.push({ index, opName, code: 'VALUE_TYPE_MISMATCH', key: k, message: `键 ${k} 值域=${tn}∉[${domains.join(',')}]` });
    return;
  }
  if (spec.keyMaxBytes !== undefined) {
    const bytes = utf8Bytes(JSON.stringify(v) ?? '');
    if (bytes > spec.keyMaxBytes) {
      out.push({ index, opName, code: 'PATCH_TOO_LARGE', key: k, message: `键 ${k} 值 ${bytes}B 超每键上限 ${spec.keyMaxBytes}B` });
    }
  }
}

/** 检查字符串键名名单（deleteNodeDataKeys.keys 面）：禁键+白名单。 */
function checkKeyNameList(spec: DocWriteOpSpec, keys: readonly unknown[], index: number, opName: string, out: WriteBatchViolation[]): void {
  for (const k of keys) {
    if (typeof k !== 'string') {
      out.push({ index, opName, code: 'UNKNOWN_KEY', key: String(k), message: `删键名单含非字符串键 ${String(k)}` });
      continue;
    }
    if (BANNED_DATA_KEYS.includes(k)) {
      out.push({ index, opName, code: 'PROTO_KEY_BANNED', key: k, message: `原型链键 ${k} 显式拒绝（Z108③）` });
      continue;
    }
    if (!spec.keys.includes(k)) {
      out.push({ index, opName, code: 'UNKNOWN_KEY', key: k, message: `删键 ${k} 不在 DOC_WRITE_OPS 键集白名单` });
    }
  }
}

/** 对象键面禁键扫描（fillDoc 节点 data/记录顶层——递归一层 data 即可，doc 数据域两层封顶）。 */
function checkBannedKeysOf(obj: Record<string, unknown>, index: number, opName: string, out: WriteBatchViolation[]): boolean {
  let hit = false;
  for (const k of Object.keys(obj)) {
    if (BANNED_DATA_KEYS.includes(k)) {
      out.push({ index, opName, code: 'PROTO_KEY_BANNED', key: k, message: `原型链键 ${k} 显式拒绝（Z108③）` });
      hit = true;
    }
  }
  return hit;
}

/** Z108 执行期校验（A1 T8 writeBatch 进门/T27 端点 body 共此一口）：返回违规清单（空=放行）。
 *  空批=合法 no-op（零违规放行——T27 端点空批幂等重试安全，T4 二轮钉死）。
 *  调用方对非空清单=业务级拒绝（七码处置总表见 WriteBatchViolationCode doc——全属 Z40①
 *  内容违规：不回滚整批不 throw，进 reject 计数；拒绝非截断非 sanitize）。批级违规 index=-1。
 *  Y0c T12（裁决 2·spec §0.6 偏离 20）：幂等执法面 flag——默认档（进程内 writeBatch/直写收编
 *  调用方）不产 NON_IDEMPOTENT_OP（fillDoc 种子路径专用是合法进程内 op）；requireIdempotentOps:
 *  true=T27 端点执法档（Z133「端口只收幂等 op」可执行化——未来端点接线时传 true）。 */
export function validateWriteBatch(
  ops: readonly unknown[],
  opts?: { requireIdempotentOps?: boolean },
): WriteBatchViolation[] {
  const violations: WriteBatchViolation[] = [];
  if (ops.length > MAX_WRITE_OPS_PER_BATCH) {
    violations.push({ index: -1, code: 'OP_COUNT_EXCEEDED', message: `批 op 数 ${ops.length} 超上限 ${MAX_WRITE_OPS_PER_BATCH}` });
  }
  let batchBytes = 0;
  ops.forEach((raw, index) => {
    if (raw === null || typeof raw !== 'object') {
      violations.push({ index, code: 'UNKNOWN_OP', message: `op#${index} 非对象形态` });
      return;
    }
    batchBytes += utf8Bytes(JSON.stringify(raw) ?? '');
    const op = raw as Record<string, unknown>;
    const opName = op.op;
    if (typeof opName !== 'string' || !(opName in DOC_WRITE_OPS)) {
      // op 形态违规但 op 字段为字符串时仍带原值——日志可读（载荷约定见 WriteBatchViolation.opName）
      violations.push({ index, ...(typeof opName === 'string' ? { opName } : {}), code: 'UNKNOWN_OP', message: `op#${index} 类型 ${String(opName)} 不在六 op 词汇（新增 op 须先入 DOC_WRITE_OPS 分类）` });
      return;
    }
    const spec = DOC_WRITE_OPS[opName as DocWriteOpType];
    if (!spec.idempotent && opts?.requireIdempotentOps === true) {
      violations.push({ index, opName, code: 'NON_IDEMPOTENT_OP', message: `op#${index} ${opName} 声明 idempotent:false——T27 端点拒收（Z148①/Z133 端口只收幂等 op）` });
    }
    if (opName === 'writeNodeData' || opName === 'writeExecStatus') {
      const patch = op.patch;
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        violations.push({ index, opName, code: 'UNKNOWN_OP', message: `op#${index} ${opName} patch 缺失或非对象` });
        return;
      }
      for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
        checkPatchEntry(spec, k, v, index, opName, violations);
      }
      return;
    }
    if (opName === 'deleteNodeDataKeys') {
      if (!Array.isArray(op.keys)) {
        violations.push({ index, opName, code: 'UNKNOWN_OP', message: `op#${index} deleteNodeDataKeys keys 缺失或非数组` });
        return;
      }
      checkKeyNameList(spec, op.keys, index, opName, violations);
      return;
    }
    if (opName === 'fillDoc') {
      const nodes = op.nodes;
      const edges = op.edges;
      if (!Array.isArray(nodes) || !Array.isArray(edges)) {
        violations.push({ index, opName, code: 'UNKNOWN_OP', message: `op#${index} fillDoc nodes/edges 缺失或非数组` });
        return;
      }
      for (const n of nodes as unknown[]) {
        if (n === null || typeof n !== 'object') continue;
        const rec = n as Record<string, unknown>;
        // 命中禁键即跳过同记录白名单检查（保守行为——禁键是安全级违规，只报最响信号避免两类违规混报）
        if (checkBannedKeysOf(rec, index, opName, violations)) continue;
        for (const k of Object.keys(rec)) {
          if (!NODE_ENVELOPE_KEYS.includes(k as (typeof NODE_ENVELOPE_KEYS)[number])) {
            violations.push({ index, opName, code: 'UNKNOWN_KEY', key: k, message: `fillDoc 节点记录键 ${k} 不在节点信封键域（NODE_ENVELOPE_KEYS）` });
          }
        }
        const data = rec.data;
        if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
          checkBannedKeysOf(data as Record<string, unknown>, index, opName, violations);
        }
      }
      for (const e of edges as unknown[]) {
        if (e === null || typeof e !== 'object') continue;
        const rec = e as Record<string, unknown>;
        if (checkBannedKeysOf(rec, index, opName, violations)) continue;
        for (const k of Object.keys(rec)) {
          if (!DOC_EDGE_RECORD_KEYS.includes(k as (typeof DOC_EDGE_RECORD_KEYS)[number])) {
            violations.push({ index, opName, code: 'UNKNOWN_KEY', key: k, message: `fillDoc 边记录键 ${k} 不在边记录键域（DOC_EDGE_RECORD_KEYS）` });
          }
        }
      }
      return;
    }
    // deleteNodes / deleteExecOrphans：无键集面（载荷键面已由线类型约束）
  });
  if (batchBytes > MAX_WRITE_BATCH_BYTES) {
    violations.push({ index: -1, code: 'PATCH_TOO_LARGE', message: `批总字节 Σ=${batchBytes}B 超上限 ${MAX_WRITE_BATCH_BYTES}B（COLLAB_MAX_TX_BYTES 同源）` });
  }
  return violations;
}
