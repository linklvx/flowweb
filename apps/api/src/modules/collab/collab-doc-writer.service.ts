// apps/api/src/modules/collab/collab-doc-writer.service.ts
// Y0c T8（片 A1 行为契约——spec :502 目标形态①）：服务端 doc 写唯一门面核心（A1 T9 三门/T10 origin/
// T11 守卫/T12 收编都在本服务上叠加）。六 op 词汇表=shared canvas-doc-manifest 单源（禁 api 侧重复定义）。
//
// writeBatch 同 doc 同事务：一次 writeBatch=恰一次 withDoc，「data 与 exec 同事务」（先红用例③）。
// 逐 op 守卫事务内求值，WriteOpResult[] 与入批 ops 一一对应（携带 op 索引+类型——A1 冻结契约）。
//
// 失败语义二分（Z40）：
//  - 守卫失败（node-deleted/attempt 过期〔missing-attempts/older-attempts/terminal-superseded〕/
//    Z108 内容违规七码）=合法结果进数组（written:false+reason）——不回滚不 throw，同批合法 op 照常提交；
//  - 仅基础设施级失败（租约/真空 503/DB/事务异常）全批 thrown→调用方按零交付退款。
//
// Z75 边界：deliver 失败但 done 同批写入 ⇒ exec=done∧节点已删=合法终态（E22 读侧兜底）——禁加
// done 前跨 op 节点存在性检查补丁。
//
// Z76 幂等契约：本层无重试不去重；调用方重试链路重入前须先读 doc 状态校验写入已生效（读状态非重发
// 判定），禁盲目重发同批——幂等 op 键级 set 同值收敛（重放不破坏状态，锚见 spec），但重发=重复
// append delta 行（完整重试链路随消费改道任务落地）。
//
// Z108 进门：writeBatch 首段消费 T4 manifest 执行期校验表（validateWriteBatch——shared 单源）。
// 违规=业务级拒绝（written:false+reason=违规码）进 reject 计数，非 throw 非 sanitize 非截断；
// 批级违规（OP_COUNT_EXCEEDED/批字节 Σ PATCH_TOO_LARGE，index=-1）=整批拒绝零执行（不进事务）；
// op 级违规仅拒该 op，同批合法 op 照常事务执行。
//
// 写守卫 reason 词表（本文件枚举——CollabAuthReason 是 auth 拒绝域不混入；wire 面 T27 端点透传
// 只增不改）：node-deleted / no-node-map（writeNodeData 现状守卫，Z44）/ missing-attempts /
// older-attempts（Z111 代次 fail-closed）/ terminal-superseded（Z99 同代终态不倒退）。
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
  type ExecStatusPatch,
} from './collab-document.service';
import { collabWriteRejectedTotal } from './store.metrics';
import { execProjectionDroppedTotal } from '../execution/exec.metrics';

/** A1 冻结契约（spec 片 A1 冻结契约行）：WriteOpResult 形状——与入批 ops 一一对应。 */
export interface WriteOpResult {
  index: number;
  op: DocWriteOpType;
  written: boolean;
  reason?: string;
}

@Injectable()
export class CollabDocWriterService {
  constructor(@Inject(CollabDocumentService) private readonly doc: CollabDocumentService) {}

  /** 同 doc 同事务组批写（片 A1 唯一 withDoc 调用点=census ⑭ 登记 write-via-writer）。 */
  async writeBatch(projectId: string, ops: readonly DocWriteOp[]): Promise<WriteOpResult[]> {
    // 空批=合法 no-op（validateWriteBatch 同判据——零违规放行，不白开一次 doc 事务）
    if (ops.length === 0) return [];
    const results: WriteOpResult[] = ops.map((op, index) => ({ index, op: op.op, written: false }));

    // Z108 进门：内容校验（七码处置总表见 shared WriteBatchViolationCode——全属业务级拒绝）
    const { byIndex, batchLevel } = this.rejectionsOf(ops);
    if (batchLevel) {
      // 批级违规=整批拒绝零执行（拒绝非截断——逐 op 结果同携批级码，一一对应契约不破）
      for (let i = 0; i < ops.length; i += 1) {
        results[i] = { index: i, op: ops[i].op, written: false, reason: batchLevel.code };
      }
      return results;
    }

    // 同 doc 同事务：全部 op（含守卫求值）在此唯一事务内完成；守卫失败只落结果不回滚不 throw
    await this.doc.withDoc(projectId, (doc) => {
      ops.forEach((op, index) => {
        const rejected = byIndex.get(index);
        if (rejected !== undefined) {
          results[index] = { index, op: op.op, written: false, reason: rejected }; // Z108 op 级违规——合法 op 照常执行
          return;
        }
        results[index] = this.applyOp(doc, op, index);
      });
    });
    return results;
  }

  /** Z108 进门校验（validateWriteBatch 单源消费）+reject 计数：批级违规单提，op 级违规按索引归集
   *  （同 op 多违规取首个入结果，计数逐违规全量）。 */
  private rejectionsOf(ops: readonly DocWriteOp[]): { byIndex: Map<number, WriteBatchViolationCode>; batchLevel?: WriteBatchViolation } {
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
  private applyOp(doc: Y.Doc, op: DocWriteOp, index: number): WriteOpResult {
    switch (op.op) {
      case 'writeNodeData': {
        const r = applyWriteNodeDataToDoc(doc, op.nodeId, op.patch);
        return this.guardResult(index, op.op, r.written, r.reason);
      }
      case 'writeExecStatus': {
        const r = applyWriteExecStatusToDoc(doc, op.nodeId, op.patch as ExecStatusPatch);
        if (!r.written && r.reason !== 'terminal-superseded') {
          execProjectionDroppedTotal.inc({ cause: r.reason });   // 与单写面同计数（投影丢弃观测零分裂）
        }
        return this.guardResult(index, op.op, r.written, r.written ? undefined : r.reason);
      }
      default:
        // deleteNodeDataKeys 归 T9（undefined 拒+显式删键 op 同批落）；deleteNodes/fillDoc/
        // deleteExecOrphans 归 T12 直写收编（collab-shrink:114,154/intent-reconcile:493）。词汇表已
        // 冻结（shared DOC_WRITE_OPS Record 穷尽）——提前调用=编程错误，fail-fast 归 Z40 基础设施档
        // （thrown→调用方零交付退款），禁静默 written:false 假装成功。
        throw new Error(`writeBatch op 未实现: ${op.op}（deleteNodeDataKeys 归 T9；deleteNodes/fillDoc/deleteExecOrphans 归 T12 直写收编）`);
    }
  }

  /** written:false 一律进 reject 计数（reason=Z108 校验码∪守卫 reason 两族闭集——store.metrics 词表）。 */
  private guardResult(index: number, op: DocWriteOpType, written: boolean, reason?: string): WriteOpResult {
    if (!written && reason) collabWriteRejectedTotal.inc({ reason });
    return { index, op, written, ...(reason ? { reason } : {}) };
  }
}
