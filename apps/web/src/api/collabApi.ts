// apps/web/src/api/collabApi.ts
// Y0b-4 T11：配额自救三端点（T8/T9/T9a 服务端出口）——shrink/export-fresh/vacuum。
// shrink 的 422 SHRINK_STILL_OVER 是结构体业务档（非错误——引导用户继续导出）：client.ts
// 错误面透传 body，此处解包为 {stillOver:true,bytes,limit} 不上抛；其余错误（503 SHRINK_BUSY
// 等）照 throw（调用方 message.error 兜底）。
import { apiFetch } from './client';

/** T8 body：deleteNodeIds/keepNodeIds 二选一（都传服务端 400）；空体或 recalibrate:true=纯校准 */
export interface ShrinkBody {
  deleteNodeIds?: string[];
  keepNodeIds?: string[];
  recalibrate?: boolean;
}

/** T8 出口：watermark=活文档再编码真值（localDocBytes 重置基线）；deletedIds=服务端契约
 *  字段（UI 暂未消费——整栈 clear 不需要逐 id）。 */
export interface ShrinkOk {
  result: 'ok' | 'recalibrated' | 'noop';
  watermark?: number;
  deletedIds?: string[];
  thawed: boolean;
}

/** 422 SHRINK_STILL_OVER 解包档：影子预演仍超限——服务端实测 bytes vs limit */
export interface ShrinkStillOver {
  stillOver: true;
  bytes: number;
  limit: number;
}

export type ShrinkOutcome = ShrinkOk | ShrinkStillOver;

/** T9 出口：bytes=新副本落地编码；warning=新副本仍超限（告知不阻断——用户决策域） */
export interface ExportFreshResult {
  result: 'ok';
  projectId: string;
  name: string;
  bytes: number;
  warning?: 'still-over-limit';
}

/** T9a 出口：generation=新代数（ok 时）；中止三档 DB 零变更（服务端七步协议） */
export interface VacuumResult {
  result: 'ok' | 'skip-low-residue' | 'equivalence-failed' | 'unsupported-root' | 'quiesce-timeout' | 'error';
  generation?: number;
  bytes?: number;
}

export function shrink(projectId: string, body: ShrinkBody): Promise<ShrinkOutcome> {
  return apiFetch<ShrinkOk>(`/collab/doc/${projectId}/shrink`, { method: 'POST', body: JSON.stringify(body) })
    .catch((e: any) => {
      if (e?.status === 422 && e?.body?.code === 'SHRINK_STILL_OVER') {
        return { stillOver: true, bytes: e.body.bytes as number, limit: e.body.limit as number } satisfies ShrinkStillOver;
      }
      throw e;
    });
}

export function exportFresh(projectId: string): Promise<ExportFreshResult> {
  return apiFetch<ExportFreshResult>(`/collab/doc/${projectId}/export-fresh`, { method: 'POST' });
}

export function vacuum(projectId: string): Promise<VacuumResult> {
  return apiFetch<VacuumResult>(`/collab/doc/${projectId}/vacuum`, { method: 'POST' });
}
