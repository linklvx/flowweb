// apps/api/src/modules/collab/test-utils/doc-writer-stub.ts
// Y0c T8：writeBatch 测试 stub——按 op 顺序分派到 collabDoc 既有记录器 stub（writeExecCalls
// 断言零改动），返回 A1 冻结契约 WriteOpResult 形（{index,op,written,reason?}）。
// T15 质评 Minor#6：writeNodeData 分支随端口死面删除（生产 writeBatch 消费面=exec 域 op——
// worker 通道 exec-only/交付归投影 poller）；typed 翻译面随 writeOpsBatch 消费方归零同删
// （HttpCollabDocWriter 三分翻译用例在 collab-write.port.http.spec 直测）。未覆盖 op 显式抛错防静默假绿。
import { vi } from 'vitest';
import type { CollabDocWriterService } from '../collab-doc-writer.service';

/** 返回类型=CollabDocWriterService（stub 结构不可比私有字段——cast 一次性收口，调用点零 as any）。 */
export function docWriterStubOf(collabDoc: any): CollabDocWriterService {
  return {
    writeBatch: vi.fn(async (_pid: string, ops: readonly any[], scope?: unknown) => {
      const out: any[] = [];
      for (let index = 0; index < ops.length; index += 1) {
        const op = ops[index];
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
