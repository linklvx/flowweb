// apps/api/src/modules/gateway/emit.port.ts
// Y0c T24（Z101）：emit 端口——emitNodeStatus 单方法面（签名逐字对齐 ExecutionGateway :70-79）。
// 根因：Nest createApplicationContext 仍实例化已加载模块的 controller（@nestjs/core 源码实证），
// worker 进程 @WebSocketServer 恒 undefined ⇒ gateway.emitNodeStatus（:70-82 无防护 this.server.to()
// 直调）必抛 TypeError——端口层解决（gateway 本体零改，:70-82 防护不加）。
// 三形态：DirectEmitPort（api：逐字委托真 gateway——行为零变化）/WorkerEmitPort（worker：降级
// no-op+计数——emit 非资金路径降级安全；投影收敛归 api 既有最终一致链 alignExecFromIntents+reconcile）；
// 按 COLLAB_ROLE 选形态（emitPortForRole——ExecutionCoreModule useFactory 消费，T23 register 同款容器装配期读）。
// 消费面改道（Z101 字面板内）：emitNodeStatus 面 4 文件 15 调用点（execution.service 8+
// ai-image-edit.processor 3+ai-download.processor 2+lighting.consumer 2）注入从 gateway 改 EmitPort。
// Y0c T25（T24 评审 F1 补面）：三族专法入端口（emitTrimStatus/emitSeparateStatus/emitStitchStatus——
// gateway :84-117 同构无防护）——video-trim.service/video-separate.service/stitch.consumer 注入改道对齐。
import { Counter, register } from 'prom-client';
import type { CollabRole } from '../../config/env';
import type { ExecutionGateway } from './execution.gateway';

/** emitNodeStatus 载荷（gateway :70-79 内联类型的独立声明——gateway 本体零改，形状逐字镜像）。 */
export interface EmitNodeStatusData {
  nodeId: string;
  status: 'loading' | 'done' | 'error' | 'edit-result' | 'edit-failed';
  resultUrl?: string;
  fileId?: string;
  error?: string;
  credits?: { credits: number; subscriptionCredits: number; total: number };
}

/** Y0c T25（T24 评审 F1 补面）：三族载荷（gateway :84-117 内联类型逐字镜像——gateway 本体零改）。
 *  与 emitNodeStatus 同构无防护（this.server.to() 直调）——worker 侧同样必抛，同批改道。 */
export interface EmitTrimStatusData {
  nodeId: string;
  taskId: string;
  status: string;
  outputFileId?: string;
  error?: string;
}

export interface EmitSeparateStatusData {
  nodeId: string;
  taskId: string;
  status: 'processing' | 'done' | 'error';
  videoFileId?: string;
  audioFileId?: string;
  error?: string;
}

export interface EmitStitchStatusData {
  taskId: string;
  status: 'COMPLETED' | 'FAILED';
  fileId?: string;
  url?: string;
  width?: number;
  height?: number;
  cellCount?: number;
  failedCount?: number;
  error?: string;
}

/** emit 端口抽象（第二端口——spec :538②「emit 端口」）。 */
export abstract class EmitPort {
  abstract emitNodeStatus(projectId: string, data: EmitNodeStatusData): void;
  /** Y0c T25：三族专法（video-trim/video-separate/stitch 消费——T24 评审 F1 补面）。 */
  abstract emitTrimStatus(workflowId: string, data: EmitTrimStatusData): void;
  abstract emitSeparateStatus(workflowId: string, data: EmitSeparateStatusData): void;
  abstract emitStitchStatus(projectId: string, data: EmitStitchStatusData): void;
}

/** Direct 形态（api 进程）：构造注入真 gateway，一行委托——行为零变化。 */
export class DirectEmitPort extends EmitPort {
  constructor(private readonly gateway: ExecutionGateway) {
    super();
  }

  override emitNodeStatus(projectId: string, data: EmitNodeStatusData): void {
    this.gateway.emitNodeStatus(projectId, data);
  }

  override emitTrimStatus(workflowId: string, data: EmitTrimStatusData): void {
    this.gateway.emitTrimStatus(workflowId, data);
  }

  override emitSeparateStatus(workflowId: string, data: EmitSeparateStatusData): void {
    this.gateway.emitSeparateStatus(workflowId, data);
  }

  override emitStitchStatus(projectId: string, data: EmitStitchStatusData): void {
    this.gateway.emitStitchStatus(projectId, data);
  }
}

/** Z101：worker 侧 emit 降级计数（本文件注册——metrics.service.ts 同款非 *.metrics.ts 载具先例；
 *  *.metrics.ts 域归 y0b spec §10 围栏块，Y0c 端口面计数不进该块）。 */
export const collabEmitDegradedTotal = new Counter({
  name: 'collab_emit_degraded_total',
  help: 'Y0c T24（Z101）：worker 侧 emit 降级 no-op 计数（@WebSocketServer 恒 undefined——emit 非资金路径降级安全）',
  registers: [register],
});

/** Worker 形态：降级 no-op+计数（不抛——worker 全生命周期安全）。 */
export class WorkerEmitPort extends EmitPort {
  override emitNodeStatus(_projectId: string, _data: EmitNodeStatusData): void {
    collabEmitDegradedTotal.inc();
  }

  /** Y0c T25：三族同降级（计数共用同一 metric——emit 族统一「worker 无 WS 面」口径）。 */
  override emitTrimStatus(_workflowId: string, _data: EmitTrimStatusData): void {
    collabEmitDegradedTotal.inc();
  }

  override emitSeparateStatus(_workflowId: string, _data: EmitSeparateStatusData): void {
    collabEmitDegradedTotal.inc();
  }

  override emitStitchStatus(_projectId: string, _data: EmitStitchStatusData): void {
    collabEmitDegradedTotal.inc();
  }
}

/** 按 COLLAB_ROLE 选形态（api/all=DirectEmitPort/worker=WorkerEmitPort）——纯函数供
 *  ExecutionCoreModule useFactory 消费（单测直证；模块侧 env 读=census ㉒登记红，T23 register 同款）。 */
export function emitPortForRole(role: CollabRole, gateway: ExecutionGateway): EmitPort {
  return role === 'worker' ? new WorkerEmitPort() : new DirectEmitPort(gateway);
}
