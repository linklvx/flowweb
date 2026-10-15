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
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Counter, register } from 'prom-client';
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

// ── Y0c T24（Z99）：Http 形态（worker 走内部端点——结果三分契约） ──────────────────────────────────
// 三分（Z99 字面，防误退款——资金方向二分）：
//  ①瞬态（503/COLLAB_NOT_SERVING/真空窗/租约失守〔端点 filter 统一 503〕+网络错误族 ECONNREFUSED 等
//    ⇒5xx 同族）⇒预算内退避重试（有限次）；耗尽后**绝不上抛到 job**（作业成败由生成结果决定，不由
//    投影写决定；attempts:1 维持——投影写不上抛后它不再承担投影重试职责）；
//  ②业务合法失败（端点 200 业务响应 written:false）⇒原样传递不重试——退款终态链唯一凭据（HTTP 侧
//    written:false 唯一生产者=端点业务响应；瞬态/永久一律不产 written:false，防 worker 误判「节点已删」错误退款）；
//  ③永久（token 失配/404/schema 拒=4xx 族）⇒计数告警不上抛。
// 方法面落法（spec :538「worker 侧消费面实测」裁定）：真走 HTTP=writeNodeData/writeExecStatus（Z99 主对象）
// +readCanvas（spec :540「readCanvas 经 Http 端口读」——计费读 fail-closed E49：503 耗尽**显式传递** throw SUE，
// 区别于投影写的绝不上抛）；其余 4 方法=NotImplemented 显式面（worker 零消费，逐方法注释）。
// 写端点 POST /api/collab/doc/write-batch 归 T27（客户端先行——端点未落，单测 mock fetch；响应契约=
// WriteOpResult[]〔A1 冻结契约〕取 [0]）；读端点 GET /api/collab/doc/:projectId/canvas 归 T25 前置清单。
// WORKER_WRITE_TOKEN=预留参数（T27 服务端鉴权/T26 worker 引导注入——本类不读 env，census ㉒零新增面）。

/** Http 形态结果三分观测计数（本文件注册——metrics.service.ts 同款非 *.metrics.ts 载具先例；
 *  *.metrics.ts 域归 y0b spec §10 围栏块（check-spec-consistency 提取面），Y0c 端口面计数不进该块。 */
export const collabWriteHttpOutcomeTotal = new Counter({
  name: 'collab_write_http_outcome_total',
  help: 'Y0c T24（Z99）：Http 写端口结果三分计数（method=writeNodeData/writeExecStatus/readCanvas；outcome=transient-retry/transient-exhausted/permanent:<status>——瞬态耗尽与永久均不上抛，此计数为唯一告警面）',
  labelNames: ['method', 'outcome'],
  registers: [register],
});

/** fetch 结构面子集（全局 fetch 可赋值——Response 结构满足；测试 mock 同形免环境依赖）。 */
type HttpFetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json: () => Promise<unknown> }>;

/** Http 形态构造选项（baseUrl/token/预算可注入——测试面与 T26 worker 引导注入面）。 */
export interface HttpCollabWritePortOptions {
  /** api 进程基址（默认 loopback 3000——Z102 ready 门同源）。 */
  baseUrl?: string;
  /** WORKER_WRITE_TOKEN（Bearer 头——T27 落服务端 timingSafeEqual 鉴权，此处纯参数不读 env）。 */
  token?: string;
  /** fetch 实现（测试缝；默认 node 原生 fetch，Node 18+）。 */
  fetchImpl?: HttpFetchLike;
  /** 瞬态退避重试预算（默认 4 次——200/400/800ms 退避合计 ≤1.4s+每尝试 10s 请求上界，远低于 worker lockDuration 60s）。 */
  maxAttempts?: number;
  /** 单次请求上界（评审 F2：挂起 fetch 旁路 BullMQ 预算——AbortSignal.timeout 10s，超时归网络错误族=瞬态重试）。 */
  requestTimeoutMs?: number;
  /** 退避基（默认 200ms，指数 ×2^n）。 */
  backoffBaseMs?: number;
}

/** 单次请求三分结果（transient-retry 计数+退避在 request 内部循环消化）。 */
type HttpTriOutcome = { kind: 'ok'; body: unknown } | { kind: 'transient-exhausted' } | { kind: 'permanent'; status: number };

/** Http 形态（worker）：构造选项注入 baseUrl/token/预算——非 @Injectable（无 DI 依赖，T26 workerProviders 装配）。 */
export class HttpCollabWritePort extends CollabWritePort {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly doFetch: HttpFetchLike;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly requestTimeoutMs: number;

  constructor(opts: HttpCollabWritePortOptions = {}) {
    super();
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
    this.token = opts.token;
    this.doFetch = opts.fetchImpl ?? ((globalThis as any).fetch.bind(globalThis) as HttpFetchLike);
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.backoffBaseMs = opts.backoffBaseMs ?? 200;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 10_000;
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) };
  }

  /** 三分单点：网络错误/5xx=瞬态族（预算内退避重试）；2xx=ok；其余=永久。计数全档落本方法。 */
  private async request(method: 'writeNodeData' | 'writeExecStatus' | 'readCanvas', url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<HttpTriOutcome> {
    for (let attempt = 1; ; attempt += 1) {
      let status: number;
      let json: () => Promise<unknown> = async () => undefined;   // 网络错误档（status=-1）不读 body——占位初始化
      try {
        const r = await this.doFetch(url, { ...init, signal: AbortSignal.timeout(this.requestTimeoutMs) });
        status = r.status;
        json = r.json;
      } catch {
        status = -1;   // 网络错误族（ECONNREFUSED/fetch failed 等）——同瞬态重试族（Z99）
      }
      if (status >= 200 && status < 300) {
        let body: unknown;
        try { body = await json(); } catch { body = undefined; }
        return { kind: 'ok', body };
      }
      const transient = status === -1 || status >= 500;
      if (transient && attempt < this.maxAttempts) {
        collabWriteHttpOutcomeTotal.inc({ method, outcome: 'transient-retry' });
        await new Promise((resolve) => setTimeout(resolve, this.backoffBaseMs * 2 ** (attempt - 1)));
        continue;
      }
      if (transient) {
        collabWriteHttpOutcomeTotal.inc({ method, outcome: 'transient-exhausted' });
        return { kind: 'transient-exhausted' };
      }
      collabWriteHttpOutcomeTotal.inc({ method, outcome: `permanent:${status}` });
      return { kind: 'permanent', status };
    }
  }

  override async writeNodeData(projectId: string, nodeId: string, patch: Record<string, unknown>): Promise<WriteNodeDataResult> {
    const out = await this.request('writeNodeData', `${this.baseUrl}/api/collab/doc/write-batch`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ projectId, ops: [{ op: 'writeNodeData', nodeId, patch }] }),
    });
    if (out.kind === 'ok') {
      const first = Array.isArray(out.body) ? out.body[0] : undefined;
      if (first && typeof first === 'object' && typeof (first as { written?: unknown }).written === 'boolean') {
        const r = first as { written: boolean; reason?: string };
        return { written: r.written, ...(r.reason ? { reason: r.reason as WriteNodeDataResult['reason'] } : {}) };   // ②业务：原样传递（退款终态链凭据）
      }
      collabWriteHttpOutcomeTotal.inc({ method: 'writeNodeData', outcome: 'permanent:bad-body' });
    }
    // ①瞬态耗尽/③永久（含 bad-body）：不上抛（作业成败由生成结果决定）+不产 written:false（防误退款）；
    // 投影收敛归 api 既有最终一致链（alignExecFromIntents+reconcile——spec :540）。written:true 是「非退款档」
    // 的既有调用链唯一表达（execution.service :377 只判 written）——本裁决 T24 落锚，计数承担可观测。
    return { written: true };
  }

  override async writeExecStatus(projectId: string, nodeId: string, patch: ExecStatusPatch): Promise<void> {
    // ①③档已计数——resolve 不上抛（Z99：投影写不决定作业成败；消费面 .catch(countExecProjectionFailure) 双保险）
    await this.request('writeExecStatus', `${this.baseUrl}/api/collab/doc/write-batch`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ projectId, ops: [{ op: 'writeExecStatus', nodeId, patch }] }),
    });
  }

  override async readCanvas(projectId: string): Promise<{ nodes: any[]; edges: any[] }> {
    const out = await this.request('readCanvas', `${this.baseUrl}/api/collab/doc/${encodeURIComponent(projectId)}/canvas`, {
      method: 'GET', headers: this.headers(),
    });
    if (out.kind === 'ok') return out.body as { nodes: any[]; edges: any[] };
    if (out.kind === 'transient-exhausted') {
      // 计费读 fail-closed（E49——按陈旧/空画布烧钱比拒服务更糟）：503 语义显式传递（spec :538 Http 端
      // 「显式传递 503 语义」）——throw 进 job 失败（零外呼零扣费），区别于投影写的绝不上抛。
      throw new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'collab write port readCanvas: transient exhausted' });
    }
    throw new Error(`collab write port readCanvas permanent: ${out.status}`);   // ③永久同 fail-closed（404/401 禁按空画布外呼）
  }

  /** worker 不消费（Z100 实测：withDoc 消费面=collab-shrink/export-fresh——api 进程面）。 */
  override withDoc<T>(_projectId: string, _fn: (doc: Y.Doc) => T | Promise<T>): Promise<T> {
    throw new Error('NotImplemented: HttpCollabWritePort.withDoc —— worker 不消费（Z100 实测：消费面=collab-shrink，api 进程面）');
  }

  /** sync 面结构性不能过 HTTP（fetch 异步 vs 布尔同步签名）——worker 侧受理判据由端点 503 显式传递承担
   *  （Z99 三分语义/Z102③「正确性由三分语义承担，不由启动顺序承担」）；execution.service :155 前置门的
   *  worker 形态处置归 T25 改道。 */
  override isLeaseServing(): boolean {
    throw new Error('NotImplemented: HttpCollabWritePort.isLeaseServing —— sync 面结构性不能过 HTTP（受理判据=端点 503 显式传递，Z99/Z102③）');
  }

  /** worker 不消费（Z100 实测：isDocResident 消费面=intent-reconcile——role=api Daemon，Z98）。 */
  override isDocResident(_projectId: string): boolean {
    throw new Error('NotImplemented: HttpCollabWritePort.isDocResident —— worker 不消费（消费面=intent-reconcile，role=api Daemon）');
  }

  /** worker 不消费（Z100 实测：probeArtifacts 消费面=intent-reconcile settleStranded——role=api Daemon，Z98）。 */
  override async probeArtifacts(_projectId: string, _items: Array<{ nodeId: string; kind: string }>): Promise<ArtifactProbeResult[]> {
    throw new Error('NotImplemented: HttpCollabWritePort.probeArtifacts —— worker 不消费（消费面=intent-reconcile settleStranded，role=api Daemon）');
  }
}
