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

// ════════ Y1a T11（spec Z11''③）：replaceMedia/clearMedia 命令——用户写 fileId 必经命令 ════════
// PG NodeArtifact.rev CAS 权威（doc 不携带 rev）：expectedRev 缺省由 GET 槽位取（单次）；
// 调用方可携 opts.expectedRev 预捕获值跳过入口 GET（变换保存=处理开始时捕获——否则处理
// 期间发生的替换对 CAS 不可见）。409 ARTIFACT_REV_CONFLICT（errorCode 线形态——
// HttpExceptionFilter 只透 message/errorCode）→ throw MediaRevConflictError——F2（用户裁定
// ②①）取消静默复读槽位换 rev 重提：旧操作静默胜出=覆盖协作者新版本，与协作画布「冲突后
// 保留先提交者」语义冲突；由调用方拿权威值提示用户显式裁定后才重提交。

export interface MediaSlotState {
  targetField: 'fileId';
  rev: number;
  mediaId: string | null;
}

export type MediaCommandBody =
  | { action: 'replace'; mediaId: string; expectedRev: number }
  | { action: 'clear'; expectedRev: number };

export interface MediaCommandResult {
  action: 'replace' | 'clear';
  /** 胜者新 rev（=expectedRev+1）。expectedRev 缺省才 GET 槽位取 rev（保守写法——本字段不承诺免 GET 往返） */
  rev: number;
  mediaId: string | null;
}

/** F2：槽位已被并发写换代（409 ARTIFACT_REV_CONFLICT）的类型化出口——静默重试已退役，调用方
 *  须以权威值提示用户裁定（保留待保存产物，「仍要替换」才重新提交）。服务端 409 体线形态
 *  ={code:-1,data:null,message,errorCode}——当前 rev 仅内嵌 message 文案无结构化字段，故本类
 *  只透传 status/errorCode/body/message 供面层诊断，不承诺 rev 字段。 */
export class MediaRevConflictError extends Error {
  readonly status: number;
  readonly errorCode: string;
  readonly body: unknown;

  constructor(message: string, info: { status: number; errorCode: string; body: unknown }) {
    super(message);
    this.name = 'MediaRevConflictError';
    this.status = info.status;
    this.errorCode = info.errorCode;
    this.body = info.body;
  }
}

export function getMediaSlot(projectId: string, nodeId: string): Promise<MediaSlotState> {
  return apiFetch<MediaSlotState>(`/projects/${projectId}/collab/nodes/${nodeId}/media`);
}

export function postMediaCommand(projectId: string, nodeId: string, body: MediaCommandBody): Promise<MediaCommandResult> {
  return apiFetch<MediaCommandResult>(`/projects/${projectId}/collab/nodes/${nodeId}/media`, {
    method: 'POST', body: JSON.stringify(body),
  });
}

/** 命令选项：expectedRev=处理开始时预捕获的槽位版本（有则跳过入口 GET——CAS 覆盖整个处理窗口） */
export interface MediaCommandOpts {
  expectedRev?: number;
}

/** 命令执行（单次：expectedRev 缺省则 GET 槽位一次 → POST 一次；409 冲突类型化上抛不重试）。 */
async function runMediaCommand(
  projectId: string,
  nodeId: string,
  make: (expectedRev: number) => MediaCommandBody,
  opts?: MediaCommandOpts,
): Promise<MediaCommandResult> {
  const expectedRev = opts?.expectedRev ?? (await getMediaSlot(projectId, nodeId)).rev;
  try {
    return await postMediaCommand(projectId, nodeId, make(expectedRev));
  } catch (e: unknown) {
    const err = e as { status?: number; errorCode?: string; body?: unknown; message?: string };
    if (err?.status === 409 && err?.errorCode === 'ARTIFACT_REV_CONFLICT') {
      throw new MediaRevConflictError(err.message ?? '槽位已换代', {
        status: err.status, errorCode: err.errorCode!, body: err.body,
      });
    }
    throw e;   // 非 409（网络/403）照 throw 原错误
  }
}

/** 变换保存/手工换图路径的权威写（opts.expectedRev=处理开始时捕获的槽位版本）。 */
export function replaceNodeMedia(projectId: string, nodeId: string, mediaId: string, opts?: MediaCommandOpts): Promise<MediaCommandResult> {
  return runMediaCommand(projectId, nodeId, (expectedRev) => ({ action: 'replace', mediaId, expectedRev }), opts);
}

/** 清空路径的权威写（doc 侧=投影 poller 写 data.fileId=null〔T15 钉 null 写语义——web 消费面
 * null≡缺失等值；旧链 deleteNodeDataKeys 删键随直写收口退役〕）。 */
export function clearNodeMedia(projectId: string, nodeId: string, opts?: MediaCommandOpts): Promise<MediaCommandResult> {
  return runMediaCommand(projectId, nodeId, (expectedRev) => ({ action: 'clear', expectedRev }), opts);
}
