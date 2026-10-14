// apps/api/src/modules/collab/collab-write.port.ts
// Y0c T13b（端口先行——Z100 顺序修正）：collab 写端口面。Z100：端口抽象先于 worker 拆分落地
// （T24 HttpCollabWritePort 复用本抽象——worker 形态=走内部写端点、结果三分契约 Z99 瞬态 503 显式
// 传递；Direct 形态=api 进程内直调 CollabDocumentService，本文件即该形态）。
// 端口面=7 方法（withDoc/readCanvas/isLeaseServing/isDocResident/writeNodeData/writeExecStatus/
// probeArtifacts）=8 改道文件实测用面（T13b 成员面枚举锚定）；扩端口=结构性闸——新增成员必须先证
// 明属写端口语义，防读/快照域面混入污染写端口抽象。
// 超面 3 成员域归属（spec §0.6 偏离 21）：readServerSV=读域（sync-admission.ts 受理端点 SV 支配门
// 参数类型不动）；readCanvasSnapshotCached/invalidateSnapshotCache=快照域（video-work 分享/渲染面）。
// 三者留在 CollabDocumentService，不经本端口——D 片停止 exports CollabDocumentService 时按域归属
// 再定归读端口或快照域服务（跨模块 4 直注文件：video-work.service+ai-image-edit/execution/lighting
// 三 controller——controller 面=经 assertSyncAdmitted 消费 readServerSV）。
import { Injectable } from '@nestjs/common';
import * as Y from 'yjs';
import { CollabDocumentService, type ArtifactProbeResult, type ExecStatusPatch, type WriteNodeDataResult } from './collab-document.service';

/** collab 写端口（7 方法抽象面——签名逐字对齐 CollabDocumentService 公开签名，withDoc 含泛型）。 */
export abstract class CollabWritePort {
  /** Q1 单实例铁律：业务服务端写 doc 一律走 Hocuspocus 直连（try/finally disconnect 保证 unload flush）；
   *  首行租约门+真空档 503 语义随实现继承（契约见 CollabDocumentService.withDoc 头注）。 */
  abstract withDoc<T>(projectId: string, fn: (doc: Y.Doc) => T | Promise<T>): Promise<T>;
  /** doc → plain nodes/edges（计费/语义读统一活读出口——分源规则见 CollabDocumentService.readCanvas 头注）。 */
  abstract readCanvas(projectId: string): Promise<{ nodes: any[]; edges: any[] }>;
  /** Y0a-3（T8）：租约态透传——计费/语义读调用面的 503 分型查此档。 */
  abstract isLeaseServing(): boolean;
  /** Y0b-2 T5（Z106/Z112）：doc 常驻透传——reaper 投影分治判据。 */
  abstract isDocResident(projectId: string): boolean;
  /** 服务端写节点 data 字段（逐键写入禁整块替换；written:false=节点已删/结构缺失——交付路径唯一退款凭据）。 */
  abstract writeNodeData(projectId: string, nodeId: string, patch: Record<string, unknown>): Promise<WriteNodeDataResult>;
  /** B2/F2：exec map 服务端唯一写者（Z99/Z111 代次守卫 fail-closed——语义见 CollabDocumentService.writeExecStatus 头注）。 */
  abstract writeExecStatus(projectId: string, nodeId: string, patch: ExecStatusPatch): Promise<void>;
  /** Y0b-2 T5（Z98 端口反转）：ArtifactProbe——settleStranded 的产物探测唯一出口（资金分支禁入规则⑤）。 */
  abstract probeArtifacts(projectId: string, items: Array<{ nodeId: string; kind: string }>): Promise<ArtifactProbeResult[]>;
}

/** Direct 形态（api 进程内直调）：构造注入 CollabDocumentService，7 方法一行委托——行为零变化。 */
@Injectable()
export class DirectCollabWritePort extends CollabWritePort {
  constructor(private readonly svc: CollabDocumentService) {
    super();
  }

  override withDoc<T>(projectId: string, fn: (doc: Y.Doc) => T | Promise<T>): Promise<T> {
    return this.svc.withDoc(projectId, fn);
  }

  override readCanvas(projectId: string): Promise<{ nodes: any[]; edges: any[] }> {
    return this.svc.readCanvas(projectId);
  }

  override isLeaseServing(): boolean {
    return this.svc.isLeaseServing();
  }

  override isDocResident(projectId: string): boolean {
    return this.svc.isDocResident(projectId);
  }

  override writeNodeData(projectId: string, nodeId: string, patch: Record<string, unknown>): Promise<WriteNodeDataResult> {
    return this.svc.writeNodeData(projectId, nodeId, patch);
  }

  override writeExecStatus(projectId: string, nodeId: string, patch: ExecStatusPatch): Promise<void> {
    return this.svc.writeExecStatus(projectId, nodeId, patch);
  }

  override probeArtifacts(projectId: string, items: Array<{ nodeId: string; kind: string }>): Promise<ArtifactProbeResult[]> {
    return this.svc.probeArtifacts(projectId, items);
  }
}
