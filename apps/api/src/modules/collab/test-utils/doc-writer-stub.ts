// apps/api/src/modules/collab/test-utils/doc-writer-stub.ts
// Y0c T8：writeBatch 测试 stub——按 op 顺序分派到 collabDoc 既有记录器 stub（writeNodeCalls/
// writeExecCalls 断言零改动），返回 A1 冻结契约 WriteOpResult 形（{index,op,written,reason?}）。
// 仅覆盖执行链两 op（writeNodeData/writeExecStatus）——其余四 op 尚无生产调用方（T9/T12 收编时按需扩）。
// T13 typed outcome：writeNodeData 非 business 档（transient/permanent）按 HttpCollabDocWriter 同款
// 翻译为 typed 异常 throw（禁合成 written:true——stub 与生产壳语义对齐，防 mock 脱节 TD-2）。
import { vi } from 'vitest';
import type { CollabDocWriterService } from '../collab-doc-writer.service';
import { CollabWriteChannelPermanentError, CollabWriteTransientExhaustedError } from '../collab-write.port';

/** 返回类型=CollabDocWriterService（stub 结构不可比私有字段——cast 一次性收口，调用点零 as any）。 */
export function docWriterStubOf(collabDoc: any): CollabDocWriterService {
  return {
    writeBatch: vi.fn(async (_pid: string, ops: readonly any[], scope?: unknown) => {
      const out: any[] = [];
      for (let index = 0; index < ops.length; index += 1) {
        const op = ops[index];
        if (op.op === 'writeNodeData') {
          const r = await collabDoc.writeNodeData(_pid, op.nodeId, op.patch, scope);
          if (r && r.kind === 'transient') throw new CollabWriteTransientExhaustedError();
          if (r && r.kind === 'permanent') throw new CollabWriteChannelPermanentError();
          out.push({ index, op: op.op, written: !!(r && r.written), ...(r?.reason ? { reason: r.reason } : {}) });
          continue;
        }
        if (op.op === 'writeExecStatus') {
          await collabDoc.writeExecStatus(_pid, op.nodeId, op.patch, scope);
          out.push({ index, op: op.op, written: true });
          continue;
        }
        throw new Error(`docWriterStubOf 未覆盖 op: ${op.op}`);
      }
      return out;
    }),
  } as unknown as CollabDocWriterService;
}
