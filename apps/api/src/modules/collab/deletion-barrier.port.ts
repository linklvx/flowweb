// apps/api/src/modules/collab/deletion-barrier.port.ts
// C3b-4a（plan v3 Task C3b-4a——spec §3.4-4 :79「erasure（worker 进程）经 loopback 端口调 api
// （DeletionBarrierPort+WORKER_WRITE_TOKEN 同族）」）：DeletionBarrier 跨进程端口面。
// 两形态（CollabWritePort 同族体例）：
//   · Direct（api 进程内——GC/测试形态）：直调 DeletionBarrierService（seal 与 DB 行同进程翻/清）；
//   · Http（worker 进程——erasure 形态）：POST /api/collab/doc/deletion-barrier（collab-write.controller
//     @Controller('api/collab/doc') 前缀+@Post('deletion-barrier')——与 media-refs/purge-scope 同族
//     同址；Bearer WORKER_WRITE_TOKEN 传输层——非资金面无 scope 令牌需求，media-refs/purge-scope 同判）。
// 调用纪律：**prepare↔release 必须配对**（prepare 持有 fence 至 release——⑤删除本体在窗内执行且
// **须在剩余预算内完成**：fence 在手至 expiresAt∩release 孰先〔质量评审 M3——过期后 seal 惰性
// 失效+appendBatch 放行，删除事务须自带 budget 自查〕；进程崩溃=expiresAt TTL 自愈+seal 惰性
// 过期）；release 带 barrierId 守卫（stale release 零行）。
// 消费面接线（C3b-5 已兑现：GC=Direct 形态 api 进程内；erasure=Http 形态 worker loopback）——
// prepare↔release 必须配对（窗内删除+budget 自查〔expiresAt〕）。
// spec 评审 P1-1：URL 与 controller 实际路由对拍锚在 deletion-barrier.port.spec.ts（fetchImpl 假体
// 断言 URL/方法/载荷/token 头——路径漂移即红）。
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { DeletionBarrierService, type DeletionBarrierPrepareResult } from './deletion-barrier.service';

/** wire 形 prepare 结果（loopback JSON 契约——pgSeq 序列化为 string；bigint 经 JSON.stringify 即 throw，
 *  端点/Http 形态统一经 mapPrepareToWire 收口）。verified.expiresAt=epoch ms（C3b-5 消费方 budget
 *  自查——过期=围栏已漏，窗内删除/对拍前保守保留）。 */
export type DeletionBarrierPrepareWireResult =
  | { outcome: 'verified'; barrierId: string; expiresAt: number; projects: { projectId: string; pgSeq: string }[] }
  | { outcome: 'bail-out'; reason: Extract<DeletionBarrierPrepareResult, { outcome: 'bail-out' }>['reason'] };

/** wire 映射单点（controller/Direct 形态共用——pgSeq bigint→string/expiresAt Date→epoch ms）。 */
export function mapPrepareToWire(r: DeletionBarrierPrepareResult): DeletionBarrierPrepareWireResult {
  return r.outcome === 'verified'
    ? { outcome: 'verified', barrierId: r.barrierId, expiresAt: r.expiresAt.getTime(), projects: r.projects.map((p) => ({ projectId: p.projectId, pgSeq: p.pgSeq.toString() })) }
    : { outcome: 'bail-out', reason: r.reason };
}

/** barrier 端口（两方法抽象面——wire 契约：prepare 返回 pgSeq string 形）。 */
export abstract class DeletionBarrierPort {
  /** 六步序编排 ①-④+持有（verified 返回=fence 在手至 release；bail-out=已整体释放）。 */
  abstract prepare(teamId: string, opts?: { excludeProjectId?: string }): Promise<DeletionBarrierPrepareWireResult>;
  /** ⑥释放（barrierId 守卫；true=本持有已清）。 */
  abstract release(teamId: string, barrierId: string): Promise<boolean>;
}

/** Direct 形态（api 进程内直调）：prepare 经 wire 映射（与 Http 形态同契约）+release 1 行委托。
 *  ctor=forwardRef 注入（C3b-5 消费接线根由：port→service→media-reference→registry→media-gc→port
 *  import 环——环上求值中段 service 绑定未落，装饰期直引=undefined dependency 红〔bench smoke 实锚〕；
 *  forwardRef 惰性求值使装饰期零依赖，实例化期〔全部模块已求值〕绑定恒在）。 */
@Injectable()
export class DirectDeletionBarrierPort extends DeletionBarrierPort {
  constructor(@Inject(forwardRef(() => DeletionBarrierService)) private readonly svc: DeletionBarrierService) {
    super();
  }

  override async prepare(teamId: string, opts?: { excludeProjectId?: string }): Promise<DeletionBarrierPrepareWireResult> {
    return mapPrepareToWire(await this.svc.prepare(teamId, opts));
  }

  override release(teamId: string, barrierId: string): Promise<boolean> {
    return this.svc.release(teamId, barrierId);
  }
}

/** Http 形态构造选项（baseUrl/token/fetch 注入——测试缝；HttpCollabWritePort 同族）。 */
export interface HttpDeletionBarrierPortOptions {
  baseUrl?: string;
  token?: string;
  fetchImpl?: (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;
  /** 单请求上界（默认 20s——prepare 全链=pre-scan+flush+rescan+snapshot，须覆盖 barrier 总预算 10s）。 */
  requestTimeoutMs?: number;
}

/** Http 形态（worker 进程）：单端点 action 分发（prepare/release）；非 2xx=throw（调用方退避重试——
 *  prepare 幂等方向=bail-out 非错误，错误档只剩传输/鉴权面）。 */
export class HttpDeletionBarrierPort extends DeletionBarrierPort {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly doFetch: NonNullable<HttpDeletionBarrierPortOptions['fetchImpl']>;
  private readonly requestTimeoutMs: number;

  constructor(opts: HttpDeletionBarrierPortOptions = {}) {
    super();
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
    this.token = opts.token;
    this.doFetch = opts.fetchImpl ?? ((globalThis as any).fetch.bind(globalThis));
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 20_000;
  }

  /** 单点：POST action 载荷→2xx body 直返（wire 契约=Direct 形态同形——网络边界单 cast）。 */
  private async request(body: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    // P1-1：controller=@Controller('api/collab/doc')+@Post('deletion-barrier')——URL 含 /doc 段
    //（修前 /api/collab/deletion-barrier 必 404；port.spec 假体对拍锚定全字面）。
    const r = await this.doFetch(`${this.baseUrl}/api/collab/doc/deletion-barrier`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (!(r.status >= 200 && r.status < 300)) throw new Error(`deletion-barrier endpoint ${r.status}`);
    return r.json();
  }

  override async prepare(teamId: string, opts?: { excludeProjectId?: string }): Promise<DeletionBarrierPrepareWireResult> {
    return this.request({ action: 'prepare', teamId, excludeProjectId: opts?.excludeProjectId }) as Promise<DeletionBarrierPrepareWireResult>;
  }

  override async release(teamId: string, barrierId: string): Promise<boolean> {
    const body = (await this.request({ action: 'release', teamId, barrierId })) as { released: boolean };
    return body.released;
  }
}
