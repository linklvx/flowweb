// apps/api/src/modules/collab/collab-doc-writer.service.ts
// Y0c T8（片 A1 行为契约——spec :502 目标形态①）：服务端 doc 写唯一门面核心（A1 T9 三门/T10 origin/
// T11 守卫/T12 收编都在本服务上叠加）。六 op 词汇表=shared canvas-doc-manifest 单源（禁 api 侧重复定义）。
//
// writeBatch 同 doc 同事务：一次 writeBatch=恰一次会话事务（Y0c T15 起经 withSession{mode:'write'}
// ——A1 期为 withDoc；事务形态与写 origin 逐字保持），「data 与 exec 同事务」（先红用例③）。
// 逐 op 守卫事务内求值，WriteOpResult[] 与入批 ops 一一对应（携带 op 索引+类型——A1 冻结契约）。
//
// Y0c T12（裁决 1——spec §0.6 偏离 20）+T12 勘正：doc 域应用核心 applyWriteOpsToDoc 导出为独立
// 纯函数（Z108 校验+schema 门+applyOp 循环单点），进程内直写调用方（shrink 影子预演/活写、
// export-fresh 干净副本构造）消费——「预演=即将写的内容同源」最强形态；writeBatch 与之共享
// rejectionsOf+applyOpsCore 拆分核心但 Z108 校验位各自持有（writeBatch 事务外·T9 裁定字面；
// doc 域入口调用方事务内·TOCTOU 唯一选项）——每入口恰验一次零双计。六 op 全实现：
// writeNodeData/writeExecStatus/deleteNodeDataKeys（T8 三 op）+deleteNodes/fillDoc/deleteExecOrphans
// （T12 收编三 op——collab-shrink/intent-reconcile 直写语义原样迁移，见 collab-document.service 三原语）。
//
// 失败语义二分（Z40）：
//  - 守卫失败（node-deleted/attempt 过期〔missing-attempts/older-attempts/terminal-superseded〕/
//    Z108 内容违规七码）=合法结果进数组（written:false+reason）——不回滚不 throw，同批合法 op 照常提交；
//  - 仅基础设施级失败（受理门 503/undefined fail-fast〔T18 起 meta schema 门退役——版本判据=PG 列装载门〕/
//    DB/事务异常）全批 thrown→调用方按零交付退款。
//
// Z75 边界（Y0c T11 演进·spec §0.6 偏离 19）：deliver 失败但 done 同批写入 ⇒ done 被 Z4 存在性
// 守卫拦（written:false reason=node-deleted，不建条目——E22 读侧两形态等价：exec 无 node 与无
// exec 条目同 render 不存在）；禁加 done 前跨 op 节点存在性检查补丁（守卫在原语层统一生效即语义，
// 跨 op 耦合仍禁）。
//
// Z76 幂等契约：本层无重试不去重；调用方重试链路重入前须先读 doc 状态校验写入已生效（读状态非重发
// 判定），禁盲目重发同批——幂等 op 键级 set 同值收敛（重放不破坏状态，锚见 spec），但重发=重复
// append delta 行（完整重试链路随消费改道任务落地）。
//
// Y0c T9 进门四段（顺序即语义）：空批早退 → ①X9 受理门（assertWriteAdmitted 单点，503）→
// ②undefined fail-fast（writeNodeData 类 op 扫描，UNDEFINED_PATCH_VALUE）→ ③Z108 内容校验
// （rejectionsOf——事务外；业务级拒绝 written:false+reason 进 reject 计数，非 throw 非 sanitize
// 非截断；批级违规=整批拒绝零执行不进事务；op 级违规仅拒该 op 同批合法 op 照常）→ ④会话写事务
// 事务（transactSync+applyOpsCore 共享核心：schema 门+逐 op 守卫求值+应用）。受理门先于内容
// 校验：降级期不白跑校验、reject 计数不被降级噪声污染。
// T12 勘正（T9 裁定字面恢复）：Z108 校验必须在 withDoc 之外（事务前）——否则业务拒绝被降级成
// 基础设施失败并触发退款；批级违规=整批拒绝零执行不进事务（T8 语义）。doc 域入口
// applyWriteOpsToDoc（shrink 预演/活写、exportFresh fill 直调）的调用方自带事务、无事务外选项
// （TOCTOU 契约=校验与应用同同步段），其校验天然在事务内——两入口各自持校验位（每入口恰验
// 一次零双计），违规一律不 throw 化=实质禁则保持。
//
// 写守卫 reason 词表（本文件枚举——CollabAuthReason 是 auth 拒绝域不混入；wire 面 T27 端点透传
// 只增不改）：node-deleted（writeNodeData/deleteNodeDataKeys/writeExecStatus——Z44/Z4）/ no-node-map
// （writeNodeData，Z44）/ missing-attempts / older-attempts（Z111 代次 fail-closed）/
// terminal-superseded（Z99 同代终态不倒退）/ text-domain-protected + no-data-map（Y1c T15 容器
// 规则——Y.Text 域键整串覆盖拒+缺 data Y.Map 拒绝不懒建，collab-document.service 写核心守卫）。
import { Injectable, Inject } from '@nestjs/common';
import type * as Y from 'yjs';
import {
  validateWriteBatch,
  type DocWriteOp,
  type DocWriteOpType,
  type WriteBatchViolation,
  type WriteBatchViolationCode,
} from '@flowweb/shared';
import {
  CollabDocumentService,
  applyWriteNodeDataToDoc,
  applyWriteExecStatusToDoc,
  applyDeleteNodeDataKeysToDoc,
  applyDeleteNodesToDoc,
  applyFillDocToDoc,
  applyDeleteExecOrphansToDoc,
  undefinedPatchValueError,
  type ExecStatusPatch,
} from './collab-document.service';
import { collabWriteRejectedTotal } from './store.metrics';
import { execProjectionDroppedTotal, execOrphanBlockedTotal } from '../execution/exec.metrics';

/** Y0c T9（D 类型门）：writeBatch 事务回调同步封套。会话写事务（Y0c T15 起 withSession{mode:'write'}；
 *  A1 期 withDoc）会把异步回调的 Promise 捕获到事务外
 *  续跑（transact 段——transact 不 await 异步回调）——破坏 writeBatch
 *  「守卫求值+应用全部在同一事务内」不变量。类型层 `(doc)=>void` 可被 as any 擦除，故运行层双检：
 *  回调返回 Promise 即 throw（Z40 基础设施档——thrown ⇒ 调用方零交付退款）。模块级导出纯函数便直测。 */
export function transactSync(fn: (doc: Y.Doc) => void): (doc: Y.Doc) => void {
  return (doc: Y.Doc) => {
    const r: unknown = fn(doc);
    if (r instanceof Promise) throw new Error('writeBatch 事务回调返回 Promise——同事务不变量破坏（transactSync 运行层双检：类型层可擦故运行时必检）');
  };
}

/** A1 冻结契约（spec 片 A1 冻结契约行）：WriteOpResult 形状——与入批 ops 一一对应。 */
export interface WriteOpResult {
  index: number;
  op: DocWriteOpType;
  written: boolean;
  reason?: string;
}

/** Y0c T12（裁决 1）：doc 域应用核心——Z108 校验+schema 门+逐 op 应用单点，进程内直写调用方
 *  （shrink 影子预演/活写、export-fresh fill）消费。须在同步上下文调用（transactSync 封套或无外层
 *  await 的同步段——withDoc 直连/scratch doc 均满足）；三 op 原语自带 transact（无外层事务的
 *  scratch 调用原子边界自持；嵌套事务时内层 origin 被 yjs 忽略=T10 已证无影响）。
 *  T12 勘正：本函数的 Z108 校验天然处于调用方事务内（TOCTOU 契约=调用方无事务外选项——校验
 *  与应用必须同同步段），违规不 throw 化=实质禁则保持（业务拒绝=合法结果非基础设施失败）；
 *  writeBatch 的 Z108 在事务外（T9 裁定字面）——两入口各自持校验位，经 rejectionsOf/applyOpsCore
 *  拆分共享，每入口恰验一次零双计。
 *  幂等执法面：validateWriteBatch 默认档（裁决 2·偏离 20）——进程内不产 NON_IDEMPOTENT_OP，
 *  fillDoc 种子路径合法；T27 端点（未来）另传 requireIdempotentOps:true。 */
export function applyWriteOpsToDoc(doc: Y.Doc, ops: readonly DocWriteOp[]): WriteOpResult[] {
  // Z108 进门：内容校验（七码处置总表见 shared WriteBatchViolationCode——全属业务级拒绝）
  const { byIndex, batchLevel } = rejectionsOf(ops);
  if (batchLevel) {
    // 批级违规=整批拒绝零执行（拒绝非截断——逐 op 结果同携批级码，一一对应契约不破）
    return ops.map((op, index) => ({ index, op: op.op, written: false, reason: batchLevel.code }));
  }
  return applyOpsCore(doc, ops, byIndex);
}

/** 逐 op 应用循环（writeBatch 事务内④段与 applyWriteOpsToDoc 共享核心——不含 Z108
 *  校验：两入口各自持校验位，writeBatch 事务外/T9 裁定字面、doc 域入口调用方事务内/TOCTOU 唯一
 *  选项；byIndex=入口已验的 op 级违规归集）。
 *  T18（Y1b T2）：O0b-0 meta schema 门（前瞻档 DOC_SCHEMA_AHEAD 拒码+ensureSchemaVersion throw）
 *  随 meta.schemaVersion 整链退役——版本判据唯一承载=CanvasDoc.schemaVersion PG 列，装载门
 *  （loadDocument 行值≠3 拒载）结构性先于一切写路径（withSession/writeBatch 均经装载；scratch
 *  doc=同进程构造无行概念），进程内已装载 doc 无"前瞻档"可达态——写侧不再重复设门（列门单源）。 */
function applyOpsCore(doc: Y.Doc, ops: readonly DocWriteOp[], byIndex: Map<number, WriteBatchViolationCode>): WriteOpResult[] {
  const results: WriteOpResult[] = ops.map((op, index) => ({ index, op: op.op, written: false }));
  ops.forEach((op, index) => {
    const rejected = byIndex.get(index);
    if (rejected !== undefined) {
      results[index] = { index, op: op.op, written: false, reason: rejected }; // Z108 op 级违规——合法 op 照常执行
      return;
    }
    results[index] = applyOp(doc, op, index);
  });
  return results;
}

/** Z108 进门校验（validateWriteBatch 单源消费）+reject 计数：批级违规单提，op 级违规按索引归集
 *  （同 op 多违规取首个入结果，计数逐违规全量）。 */
function rejectionsOf(ops: readonly DocWriteOp[]): { byIndex: Map<number, WriteBatchViolationCode>; batchLevel?: WriteBatchViolation } {
  const byIndex = new Map<number, WriteBatchViolationCode>();
  let batchLevel: WriteBatchViolation | undefined;
  for (const v of validateWriteBatch(ops)) {
    collabWriteRejectedTotal.inc({ reason: v.code });
    if (v.index === -1) batchLevel ??= v;
    else if (!byIndex.has(v.index)) byIndex.set(v.index, v.code);
  }
  return { byIndex, batchLevel };
}

/** 逐 op 守卫事务内求值（Z40②：守卫失败=合法结果 written:false+reason 进数组）。 */
function applyOp(doc: Y.Doc, op: DocWriteOp, index: number): WriteOpResult {
  switch (op.op) {
    case 'writeNodeData': {
      const r = applyWriteNodeDataToDoc(doc, op.nodeId, op.patch);
      return guardResult(index, op.op, r.written, r.reason);
    }
    case 'writeExecStatus': {
      const r = applyWriteExecStatusToDoc(doc, op.nodeId, op.patch as ExecStatusPatch);
      if (!r.written && r.reason === 'node-deleted') {
        execOrphanBlockedTotal.inc();   // Y0c T11 Z4：与单写面同款专项信号（守卫双面生效）
      }
      if (!r.written && r.reason !== 'terminal-superseded') {
        execProjectionDroppedTotal.inc({ cause: r.reason });   // 与单写面同计数（投影丢弃观测零分裂）
      }
      return guardResult(index, op.op, r.written, r.written ? undefined : r.reason);
    }
    case 'deleteNodeDataKeys': {
      const r = applyDeleteNodeDataKeysToDoc(doc, op.nodeId, op.keys);
      return guardResult(index, op.op, r.written, r.reason);
    }
    case 'deleteNodes':
      return guardResult(index, op.op, applyDeleteNodesToDoc(doc, op.nodeIds).written);   // T12 收编（shrink 同源）
    case 'fillDoc':
      return guardResult(index, op.op, applyFillDocToDoc(doc, op.nodes, op.edges).written); // T12 收编（export-fresh 同源）
    case 'deleteExecOrphans':
      return guardResult(index, op.op, applyDeleteExecOrphansToDoc(doc).written);           // T12 收编（exec-GC 同源）
    default:
      // 六 op 词汇表 Record 穷尽=编译断言——运行时不可达（词汇表外 op 已被 Z108 UNKNOWN_OP 业务级拒）。
      throw new Error(`writeBatch op 未实现: ${String((op as { op?: unknown }).op)}`);
  }
}

/** written:false 一律进 reject 计数（reason=Z108 校验码∪守卫 reason 两族闭集——store.metrics 词表）。 */
function guardResult(index: number, op: DocWriteOpType, written: boolean, reason?: string): WriteOpResult {
  if (!written && reason) collabWriteRejectedTotal.inc({ reason });
  return { index, op, written, ...(reason ? { reason } : {}) };
}

@Injectable()
export class CollabDocWriterService {
  constructor(@Inject(CollabDocumentService) private readonly doc: CollabDocumentService) {}

  /** 同 doc 同事务组批写（Y0c T15 起=片 A1 唯一组批会话事务点，经 withSession{mode:'write'}；
   *  census ⑭ 分类同步：.withDoc( 点位随读写二分改道收敛——登记表见 check-collab-census.mjs）。
   *  Y0c T9 进门四段顺序（顺序即语义）：空批早退 → ①X9 受理门（assertWriteAdmitted 单点——503
   *  throw）→ ②undefined fail-fast（writeNodeData 类 op 扫描——UNDEFINED_PATCH_VALUE throw）→
   *  ③Z108 内容校验（rejectionsOf——事务外·T9 裁定字面：业务拒绝不得降级成基础设施失败触发退款；
   *  批级违规=整批拒绝零执行不进事务·T8 语义；op 级违规归集 byIndex 进事务短路）→ ④会话写事务
   *  （withSession write；transactSync 包裹；回调=applyOpsCore 共享核心——schema 门+逐 op 守卫求值+应用）。
   *  受理门先于内容校验：降级期不白跑校验、reject 计数不被降级噪声污染。
   *  T13：可选 scope 形参——进程内（api/Direct）形态忽略；worker 形态（HttpCollabDocWriter 覆盖）
   *  用于铸造 x-worker-scope 作用域头（write-batch 端点收窄面——collab-write.controller）。 */
  async writeBatch(projectId: string, ops: readonly DocWriteOp[], _scope?: unknown): Promise<WriteOpResult[]> {
    // 空批=合法 no-op（validateWriteBatch 同判据——零违规放行，不白开一次 doc 事务）
    if (ops.length === 0) return [];
    // ① X9 批面受理门（T9 根修单点——与单写面同判据同 throw；Z40 基础设施档全批 thrown⇒零交付退款）
    this.doc.assertWriteAdmitted();
    // ② undefined fail-fast（Z5 分流：writeNodeData 含 undefined=进程内 bug ⇒ throw；writeExecStatus
    //   不扫——其 undefined 合法走原语跳过。事务外 fail-fast：避免 mid-transaction 部分应用）
    for (const op of ops) {
      if (op.op !== 'writeNodeData') continue;
      for (const [k, v] of Object.entries(op.patch)) {
        if (v === undefined) throw undefinedPatchValueError('writeBatch.writeNodeData', k);
      }
    }
    // ③ Z108 进门（事务外——T9 裁定字面：校验在会话事务之前，业务拒绝=合法结果非基础设施失败）
    const { byIndex, batchLevel } = rejectionsOf(ops);
    if (batchLevel) {
      // 批级违规=整批拒绝零执行（不进事务——T8 语义；拒绝非截断，逐 op 结果同携批级码一一对应）
      return ops.map((op, index) => ({ index, op: op.op, written: false, reason: batchLevel.code }));
    }
    // ④ 同 doc 同事务：schema 门+守卫求值+应用在此唯一事务内完成；守卫失败只落结果不回滚不 throw；
    //   transactSync 类型门包裹（异步回调=同事务不变量破坏）；回调=applyOpsCore 共享核心（T12 勘正）。
    //   Y0c T15（A2）：改道 withSession({mode:'write'})——写路径走会话 acquire（spec「写路径走会话
    //   acquire」）；事务形态与 withDoc 同款（SERVER_TRANSACT_ORIGIN 最外层——Z119/Z6 保持），
    //   会话复用零 disconnect 零重装（Z128 写面零抖动）。
    let results: WriteOpResult[] = [];
    await this.doc.withSession(projectId, transactSync((doc) => {
      results = applyOpsCore(doc, ops, byIndex);
    }), { mode: 'write' });
    return results;
  }
}
