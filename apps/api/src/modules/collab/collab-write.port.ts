// apps/api/src/modules/collab/collab-write.port.ts
// Y0c T13b（端口先行——Z100 顺序修正）：collab 写端口面。Z100：端口抽象先于 worker 拆分落地
// （T24 HttpCollabWritePort 复用本抽象——worker 形态=走内部写端点、结果三分契约 Z99 瞬态 503 显式
// 传递；Direct 形态=api 进程内直调 CollabDocumentService，本文件即该形态）。
// 端口面=6 方法（withDoc/readCanvas/isLeaseServing/isDocResident/writeNodeData/writeExecStatus）
// ——T13 删 probeArtifacts（「以 doc 探测为退款依据」后门根修：R3 判据全量换 PG
// NodeArtifact/Media/ArtifactProjection——spec Z18''⑥/裁决 :27④）；扩端口=结构性闸——新增成员
// 必须先证明属写端口语义，防读/快照域面混入污染写端口抽象。
// 超面 3 成员域归属（spec §0.6 偏离 21）：readServerSV=读域（sync-admission.ts 受理端点 SV 支配门
// 参数类型不动）；readCanvasSnapshotCached/invalidateSnapshotCache=快照域（video-work 分享/渲染面）。
// 三者留在 CollabDocumentService，不经本端口。
//
// T13 typed outcome（资金路径禁伪造 written:true）：writeNodeData/writeOpsBatch 返回判别式三分——
//  business（端点/进程内业务结果——written:false=节点删/结构缺，退款终态链唯一凭据）/transient
// （瞬态耗尽——不判退款，交付收敛归 R3/T15 投影链）/permanent（通道级永久——同不判退款，计数告警）。
// 旧「瞬态/永久耗尽合成 written:true」两路径（防误退款的伪造面）删除——合成 true 会掩盖「节点已删
// 应退款」与「交付未知」两态的区分；资金调用面（execution.service deliver 判定）只认 business-false。
//
// T13（plan v11.2 ①）token 作用域化：Http 形态写方法携带可选 scope（intentRowId+execSeq——claim
// 返回面在手的上下文）→ 逐请求铸造 x-worker-scope HMAC 头（worker-scope-token.ts 单源）；静态
// WORKER_WRITE_TOKEN 保留为传输层 bearer。Direct 形态 scope 参数忽略（进程内直调不经信任边界）。
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Counter, register } from 'prom-client';
import * as Y from 'yjs';
import { CollabDocumentService, type ExecStatusPatch, type WriteNodeDataResult } from './collab-document.service';
import { CollabDocWriterService, type WriteOpResult } from './collab-doc-writer.service';
import { mintWorkerScopeToken, WORKER_SCOPE_HEADER, type WorkerWriteScope } from './worker-scope-token';
import type { DocWriteOp } from '@flowweb/shared';

/** worker 作用域上下文（铸造侧形态——intentRowId/execSeq 缺省=裸项目档：见 worker-scope-token.ts 头注）。 */
export type { WorkerWriteScope } from './worker-scope-token';

/** T13 typed outcome：单写（writeNodeData）三分判别式。business 携带端点/进程内业务结果
 *  （written:false=退款终态链唯一凭据）；transient/permanent 不携 written——禁合成（资金判据只认
 *  business-false；瞬态/永久=交付未知档，收敛归 R3/T15 投影链非即时退款）。 */
export type NodeDataWriteOutcome =
  | ({ kind: 'business' } & WriteNodeDataResult)
  | { kind: 'transient' }
  | { kind: 'permanent' };

/** T13 typed outcome：批写（writeOpsBatch）三分判别式。business 携带 WriteOpResult[]（与入批
 *  一一对应——A1 冻结契约在 business 档内保持）。 */
export type OpsBatchOutcome =
  | { kind: 'business'; results: WriteOpResult[] }
  | { kind: 'transient' }
  | { kind: 'permanent' };

/** T13：Http 形态批写瞬态耗尽（重试预算后仍失败）——HttpCollabDocWriter 令牌壳翻译形态（见其头注）。
 *  调用面（execution.service deliver）捕获后走悬留：不判退款（business-false 才是唯一退款凭据）、
 *  产物已落 PG/投影 pending——交付收敛归 R3/T15 投影链。 */
export class CollabWriteTransientExhaustedError extends Error {
  constructor(message = 'collab write port transient exhausted（预算内重试后仍失败——交付未知档，收敛归投影链）') {
    super(message);
    this.name = 'CollabWriteTransientExhaustedError';
  }
}

/** T13：Http 形态批写通道级永久失败（4xx/bad-body——token 失配/路由错/schema 拒族）。同悬留语义：
 *  不判退款（通道级故障≠节点已删），计数承担可观测。 */
export class CollabWriteChannelPermanentError extends Error {
  constructor(message = 'collab write port channel permanent（4xx/bad-body——通道级不可用）') {
    super(message);
    this.name = 'CollabWriteChannelPermanentError';
  }
}

/** collab 写端口（6 方法抽象面——签名逐字对齐 CollabDocumentService 公开签名，withDoc 含泛型）。 */
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
  /** 服务端写节点 data 字段（逐键写入禁整块替换；business 档 written:false=节点已删/结构缺失——交付
   *  路径唯一退款凭据；T13 起三分 typed outcome——见 NodeDataWriteOutcome）。scope=Http 形态铸造
   *  作用域令牌的上下文（Direct 忽略）。 */
  abstract writeNodeData(projectId: string, nodeId: string, patch: Record<string, unknown>, scope?: WorkerWriteScope): Promise<NodeDataWriteOutcome>;
  /** B2/F2：exec map 服务端唯一写者（Z99/Z111 代次守卫 fail-closed——语义见 CollabDocumentService.writeExecStatus 头注）。
   *  投影写非资金面：Http 形态维持 resolve 不上抛（瞬态/永久档计数），无 typed 悬留腿。 */
  abstract writeExecStatus(projectId: string, nodeId: string, patch: ExecStatusPatch, scope?: WorkerWriteScope): Promise<void>;
}

/** Direct 形态（api 进程内直调）：构造注入 CollabDocumentService，6 方法一行委托——行为零变化
 *  （infra 失败仍抛 503 族——调用面既有 .catch 语义保持；business 档包装 {kind:'business'}）。 */
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

  override async writeNodeData(projectId: string, nodeId: string, patch: Record<string, unknown>, _scope?: WorkerWriteScope): Promise<NodeDataWriteOutcome> {
    const r = await this.svc.writeNodeData(projectId, nodeId, patch);
    return { kind: 'business', ...r };
  }

  override writeExecStatus(projectId: string, nodeId: string, patch: ExecStatusPatch): Promise<void> {
    return this.svc.writeExecStatus(projectId, nodeId, patch);
  }
}

// ── Y0c T24（Z99）：Http 形态（worker 走内部端点——结果三分契约） ──────────────────────────────────
// 三分（Z99 字面+T13 typed 化）：
//  ①瞬态（503/COLLAB_NOT_SERVING/真空窗/租约失守〔端点 filter 统一 503〕+网络错误族 ECONNREFUSED 等
//    ⇒5xx 同族）⇒预算内退避重试（有限次）；耗尽后 typed {kind:'transient'}（T13 起禁合成 written:true
//    ——作业成败由生成结果决定，attempts:1 维持；投影写不上抛后它不再承担投影重试职责）；
//  ②业务合法失败（端点 200 业务响应 written:false）⇒business 档原样传递不重试——退款终态链唯一凭据
//    （HTTP 侧 written:false 唯一生产者=端点业务响应——瞬态/永久一律不产 written:false）；
//  ③永久（token 失配/404/schema 拒=4xx 族）⇒typed {kind:'permanent'}+计数告警不上抛。
// 方法面落法（spec :538「worker 侧消费面实测」裁定）：真走 HTTP=writeNodeData/writeExecStatus（Z99 主对象）
// +readCanvas（spec :540「readCanvas 经 Http 端口读」——计费读 fail-closed E49：503 耗尽**显式传递** throw SUE，
// 区别于投影写的绝不上抛）；其余 3 方法=NotImplemented 显式面（worker 零消费，逐方法注释）。
// WORKER_WRITE_TOKEN=传输层 bearer（worker-write-auth.guard）；T13 起另派生 x-worker-scope 作用域头
// （端点收窄面——collab-write.controller）。

/** Http 形态结果三分观测计数（本文件注册——metrics.service.ts 同款非 *.metrics.ts 载具先例；
 *  *.metrics.ts 域归 y0b spec §10 围栏块（check-spec-consistency 提取面），Y0c 端口面计数不进该块。 */
export const collabWriteHttpOutcomeTotal = new Counter({
  name: 'collab_write_http_outcome_total',
  help: 'Y0c T24（Z99）：Http 写端口结果三分计数（method=writeNodeData/writeExecStatus/readCanvas/writeBatch〔T26 批形态〕；outcome=transient-retry/transient-exhausted/permanent:<status>——T13 起瞬态耗尽与永久均返回 typed outcome 不再合成 written:true，此计数为唯一告警面）',
  labelNames: ['method', 'outcome'],
  registers: [register],
});

/** fetch 结构面子集（全局 fetch 可赋值——Response 结构满足；测试 mock 同形免环境依赖）。 */
type HttpFetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json: () => Promise<unknown> }>;

// ── Y0c T26（偏离 31）：CollabDocWriterService 令牌 worker 形态 ────────────────────────────────────
// ExecutionService 直注 docWriter 令牌（deliver+done 组批写）——worker 侧无 Http 形态则 DI 图
// 不可解析。形态=writeOpsBatch 整批单 POST（write-batch 端点契约 {projectId,ops}→WriteOpResult[]）。
// T13：writeOpsBatch 返回 OpsBatchOutcome 三分（business=端点 200 业务响应透传；transient/permanent
// =typed 不合成）；HttpCollabDocWriter 令牌壳保持父类 writeBatch 签名（WriteOpResult[]）——typed
// 非 business 档翻译为 CollabWriteTransientExhaustedError/CollabWriteChannelPermanentError throw
// （执行链 deliver 调用面据此走悬留——不判退款；Direct/未知异常仍走既有 B-1 catch 语义不变）。

/** Http 形态构造选项（baseUrl/token/预算可注入——测试面与 T26 worker 引导注入面）。 */
export interface HttpCollabWritePortOptions {
  /** api 进程基址（默认 loopback 3000——Z102 ready 门同源）。 */
  baseUrl?: string;
  /** WORKER_WRITE_TOKEN（Bearer 头=传输层；T13 起另作 scope HMAC 密钥派生源——worker-scope-token.ts）。 */
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

  private headers(scope?: WorkerWriteScope, projectId?: string): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.token) {
      h.authorization = `Bearer ${this.token}`;
      // T13 作用域铸造：逐请求现铸（exp=120s 短命——mint 时点即写时点，非 claim 时点）；scope 缺省
      // （pre-claim 断言路径）=裸项目档（仅 projectId 绑定——writeNodeData 端点侧拒裸档）。
      h[WORKER_SCOPE_HEADER] = mintWorkerScopeToken(this.token, projectId ?? '', scope);
    }
    return h;
  }

  /** 三分单点：网络错误/5xx=瞬态族（预算内退避重试）；2xx=ok；其余=永久。计数全档落本方法。 */
  private async request(method: 'writeNodeData' | 'writeExecStatus' | 'readCanvas' | 'writeBatch', url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<HttpTriOutcome> {
    for (let attempt = 1; ; attempt += 1) {
      let status: number;
      let json: () => Promise<unknown> = async () => undefined;   // 网络错误档（status=-1）不读 body——占位初始化
      try {
        const r = await this.doFetch(url, { ...init, signal: AbortSignal.timeout(this.requestTimeoutMs) });
        status = r.status;
        // 闭包捕获（T27 int 真链红根修）：undici Response.json 解绑调用抛 illegal invocation——
        // r.json 裸提取后 this 丢失。mock fetch（箭头闭包 json）测不出此面（mock 脱节教训 TD-2 实例），
        // 真 undici 响应即 permanent:bad-body 假档（服务端已执行、客户端读不出结果=无谓重试面）。
        json = () => r.json();
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

  override async writeNodeData(projectId: string, nodeId: string, patch: Record<string, unknown>, scope?: WorkerWriteScope): Promise<NodeDataWriteOutcome> {
    const out = await this.request('writeNodeData', `${this.baseUrl}/api/collab/doc/write-batch`, {
      method: 'POST', headers: this.headers(scope, projectId),
      body: JSON.stringify({ projectId, ops: [{ op: 'writeNodeData', nodeId, patch }] }),
    });
    if (out.kind === 'ok') {
      const first = Array.isArray(out.body) ? out.body[0] : undefined;
      if (first && typeof first === 'object' && typeof (first as { written?: unknown }).written === 'boolean') {
        const r = first as { written: boolean; reason?: string };
        return { kind: 'business', written: r.written, ...(r.reason ? { reason: r.reason as WriteNodeDataResult['reason'] } : {}) };   // ②业务：原样传递（退款终态链凭据）
      }
      collabWriteHttpOutcomeTotal.inc({ method: 'writeNodeData', outcome: 'permanent:bad-body' });
      return { kind: 'permanent' };
    }
    // ①瞬态耗尽/③永久（含 bad-body）：typed outcome（T13——禁合成 written:true：合成会掩盖「节点已删
    // 应退款」与「交付未知」的区分）。调用面（资金判定）只认 business-false；投影收敛归 R3/T15 链。
    return out.kind === 'transient-exhausted' ? { kind: 'transient' } : { kind: 'permanent' };
  }

  override async writeExecStatus(projectId: string, nodeId: string, patch: ExecStatusPatch, scope?: WorkerWriteScope): Promise<void> {
    // ①③档已计数——resolve 不上抛（Z99：投影写不决定作业成败；消费面 .catch(countExecProjectionFailure) 双保险）
    await this.request('writeExecStatus', `${this.baseUrl}/api/collab/doc/write-batch`, {
      method: 'POST', headers: this.headers(scope, projectId),
      body: JSON.stringify({ projectId, ops: [{ op: 'writeExecStatus', nodeId, patch }] }),
    });
  }

  override async readCanvas(projectId: string): Promise<{ nodes: any[]; edges: any[] }> {
    const out = await this.request('readCanvas', `${this.baseUrl}/api/collab/doc/${encodeURIComponent(projectId)}/canvas`, {
      method: 'GET', headers: this.headers(undefined, projectId),
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

  /** Y0c T25 裁决（Z99/Z102③ 自证）：sync 布尔面结构性不能过 HTTP——worker 形态恒 true=门放行，
   *  受理拒绝延迟到首个端点调用点显式传递（readCanvas 503 耗尽 throw SUE——E49 计费读 fail-closed；
   *  投影写瞬态重试不上抛语义下 execution.service 前置门在 worker 侧冗余——api/Direct 形态门不变）。
   *  「正确性由三分语义承担，不由启动顺序承担」（Z102③）。 */
  override isLeaseServing(): boolean {
    return true;
  }

  /** worker 不消费（Z100 实测：isDocResident 消费面=intent-reconcile——role=api Daemon，Z98）。 */
  override isDocResident(_projectId: string): boolean {
    throw new Error('NotImplemented: HttpCollabWritePort.isDocResident —— worker 不消费（消费面=intent-reconcile，role=api Daemon）');
  }

  /** Y0c T26（偏离 31）：批形态写（HttpCollabDocWriter 消费——deliver+done 组批整批单 POST）。
   *  T13 typed outcome：ok+数组=business 透传 WriteOpResult[]；瞬态耗尽/永久/bad-body=typed 档
   *  （禁合成 written:true 一一对应——原「防误退款」合成面删除）+计数。 */
  async writeOpsBatch(projectId: string, ops: readonly DocWriteOp[], scope?: WorkerWriteScope): Promise<OpsBatchOutcome> {
    const out = await this.request('writeBatch', `${this.baseUrl}/api/collab/doc/write-batch`, {
      method: 'POST', headers: this.headers(scope, projectId),
      body: JSON.stringify({ projectId, ops }),
    });
    if (out.kind === 'ok' && Array.isArray(out.body)) return { kind: 'business', results: out.body as WriteOpResult[] };
    if (out.kind === 'ok') {
      collabWriteHttpOutcomeTotal.inc({ method: 'writeBatch', outcome: 'permanent:bad-body' });
      return { kind: 'permanent' };
    }
    return out.kind === 'transient-exhausted' ? { kind: 'transient' } : { kind: 'permanent' };
  }
}

/** Y0c T26（偏离 31）：CollabDocWriterService 令牌的 worker 形态——writeBatch 整批走 write-batch
 *  端点。extends 保 override 签名受检（父构造仅赋私有 doc 字段——worker 形态 writeBatch 全覆盖
 *  永不触达，占位注入；api 形态仍由 CollabModule 提供真类）。
 *  T13：typed 非 business 档翻译为 typed 异常 throw（保持父类 WriteOpResult[] 返回契约——execution
 *  链 deliver 调用面捕获两类 typed 异常走悬留；Direct/未知异常走既有 B-1 catch 语义不变）。 */
export class HttpCollabDocWriter extends CollabDocWriterService {
  constructor(private readonly http: HttpCollabWritePort) {
    super(undefined as unknown as CollabDocumentService);
  }

  override writeBatch(projectId: string, ops: readonly DocWriteOp[], scope?: WorkerWriteScope): Promise<WriteOpResult[]> {
    return this.http.writeOpsBatch(projectId, ops, scope).then((out) => {
      if (out.kind === 'business') return out.results;
      if (out.kind === 'transient') throw new CollabWriteTransientExhaustedError();
      throw new CollabWriteChannelPermanentError();
    });
  }
}
