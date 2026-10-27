// apps/api/src/test-utils/dual-client-server.ts
// Y0a-1：双 client+单进程单 Server 装置——构造形态自 collab.gateway.spec.ts beforeEach 移植
// （位置参数构造+随机端口段 20000+random(20000)=既有惯例 spec:81——port=0 时库不回写 configuration.port，
// 必用随机段）。Y2/Y1a 复用地基。
// T1.5：provider 改注入式 ws（Node ws 包 headers 选项）——URL 不带 query token，凭据经
// `Cookie: flowweb.session_token=` 头承载（gateway 现状 fallback 分支认证通过=行为等价），
// 并显式发 Origin 头（T2 Origin 校验的注入面）。undici 全局 WebSocket 不支持自定义 header，
// 故用 ws 包（探针实证：provider esm :292 `new WebSocketPolyfill(url)` + addEventListener/binaryType/
// send/close 消费面，ws8 全兼容）。
// 移植适配：prisma stub 形态以既有 beforeEach 为准（session/canvasProject/teamMember 三 findUnique——
// 无 canvasDoc：gateway 装载走 repo，不查 canvasDoc）；prisma/emitter/permSvc 随 kit 暴露——
// 既有用例的失败注入面（session/teamMember 置 null、VIEWER 覆写、disband 事件）原样保留。
import { vi } from 'vitest';
import * as Y from 'yjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HocuspocusProvider } from '@hocuspocus/provider';
import WebSocket from 'ws';
import { CollabGateway } from '../modules/collab/collab.gateway';
import { CollabDocumentService } from '../modules/collab/collab-document.service';
import { CollabResidencyService } from '../modules/collab/collab-residency.service';
import { CollabSpoolService } from '../modules/collab/collab-spool.service';
import { createMockRepo, type MockRepo } from './mock-repo';
import { createLeaseStub } from '../modules/collab/test-utils/lease-stub';
import { CANVAS_DOC_SCHEMA_VERSION, CLIENT_PROTOCOL_VERSION } from '@flowweb/shared';

export interface DualClientKit {
  gateway: CollabGateway;
  docService: CollabDocumentService;
  /** Y0c T15（A2）：常驻会话单例（docService 显式注入同实例——测试可驱动释放/断言会话表）。
   *  dispose 先 releaseSessionFor 全部条目再 destroy（Z81 前置的测试等价物：direct 在则 runDestroy 永不 settle）。 */
  residency: CollabResidencyService;
  repo: MockRepo;
  url: string;
  /** 失败注入面：session/canvasProject/teamMember 的 findUnique 可逐用例覆写 */
  prisma: Record<string, any>;
  emitter: EventEmitter2;
  /** T1.5（S-1）：resolveWithTeam 预置——T3 判据换轨零障碍（本 Task gateway 仍消费 resolve） */
  permSvc: { resolve: ReturnType<typeof vi.fn>; resolveWithTeam: ReturnType<typeof vi.fn> };
  /** Y0a-2：spool 实例（BOI 用例/降级用例的帧断言与白盒注入面） */
  spool: CollabSpoolService;
  /** T1.5：token 语义=cookie 值（`flowweb.session_token=${token}`），URL 无 query。
   *  T10：opts.onSocket——socket 构造回调（重连检测=构造计数，重连路径必经新构造）。
   *  T11：opts.extraHeaders——追加 ws 头（重连风暴演练按生产拓扑逐客户端 X-Real-IP——
   *  COLLAB_TRUSTED_PROXY='1' 下限流键=该值，单桶 burst 20 不拦 N>20 同 tick 握手）。 */
  connect(name: string, token?: string, opts?: { origin?: string; onSocket?: (ws: WebSocket) => void; extraHeaders?: Record<string, string> }): { ydoc: Y.Doc; provider: HocuspocusProvider; synced: Promise<void> };
  /** 用例自管 destroy 后调——从 dispose 清理数组移除（双 destroy 是本仓已知 flaky 源，惯例同 collab.gateway.spec.ts:262） */
  forget(provider: HocuspocusProvider): void;
  dispose: () => Promise<void>;
}

/** T1.5：注入式 ws 工厂——Node ws 包构造器 headers 选项（undici 全局 WebSocket 不支持自定义 header）。
 *  消费面（provider esm）：new (url) → binaryType → add/removeEventListener('open'|'message'|'close'|'error')
 *  → send/close——ws8 全兼容。供 kit.connect 与真连 spec 调用点共用。
 *  T10：onCreated 可选回调——socket 构造计数（重连检测锚：provider 重连路径必经
 *  createWebSocketConnection `new WebSocketPolyfill(url)`，构造次数=连接代数）。 */
export function makeHeaderWs(headers: Record<string, string>, onCreated?: (ws: WebSocket) => void) {
  return class HeaderWs extends WebSocket {
    constructor(url: string | URL) {
      super(url as string, { headers });
      onCreated?.(this);
    }
  };
}

/** Y0a-2：spool 第三参（缺省内部 mkdtemp tmpdir——dispose 只清**自建**目录，注入目录归用例的
 *  makeSpoolDir.cleanup，防 BOI-4 崩溃模拟等"跨实例共享目录"场景被 dispose 误清）。 */
/** Y0b-4 T4：第五参 quota——gateway 构造注入面透传（真连配额用例注入小值；缺省 env/QUOTA_DEFAULTS） */
export async function startDualClientServer(over: Partial<MockRepo> = {}, debounce = 300, spool?: CollabSpoolService, lease?: unknown, quota?: import('../modules/collab/collab.gateway').QuotaConfig): Promise<DualClientKit> {
  const prisma: Record<string, any> = {
    // Y1c T9（T8 接线）：listenCollab requireSystemHistory fail-closed 读面 mock（缺头=start-failed）
    // Y1c T13（G6a）：epochStartedAtMs 补——boot init recoverScan 入口快照（F-S4-5）读面前移
    systemHistory: { findUnique: vi.fn().mockResolvedValue({ historyId: 'spec-history-id', epochStartedAt: new Date() }) },
    session: { findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, expiresAt: new Date(Date.now() + 86400000) }) },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
  };
  const repo = createMockRepo(over);
  // T1.5（S-1）：resolveWithTeam 预置默认 mock（gateway 判据 T3 才换轨——现在仍走 resolve，
  // 此 mock 只让夹具就绪、防 T3 落地后 TypeError 折 DB_UNAVAILABLE 误诊）
  const permSvc = {
    resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }),
  };
  const emitter = new EventEmitter2();
  const port = 20000 + Math.floor(Math.random() * 20000);
  const ownedSpoolDir = spool ? null : await mkdtemp(join(tmpdir(), 'y0a2-kit-'));
  const spoolSvc = spool ?? new CollabSpoolService(ownedSpoolDir!);
  // Y0a-3 T5：lease stub 第四参（缺省契约形态 stub——V1 三件套：tryAcquireFast 成功 ⇒ repo/spool
  // setOwner + await onAcquired，生产 onHeld 同序；G-3/门用例经 over 关闭）。
  const leaseSvc = lease ?? createLeaseStub({}, { repo: repo as any, spool: spoolSvc });
  const gateway = new CollabGateway(prisma as any, emitter as any, repo as any, leaseSvc as any, permSvc as any, port, debounce, undefined, undefined, spoolSvc, quota);
  await gateway.onModuleInit();   // async+await listen——无端口竞态
  const url = `ws://127.0.0.1:${port}`;
  const providers: HocuspocusProvider[] = [];
  const residency = new CollabResidencyService(gateway);   // Y0c T15：显式实例（docService 注入同实例——dispose 释放面）
  return {
    gateway,
    docService: new CollabDocumentService(gateway, repo as any, residency),
    residency,
    repo,
    url,
    prisma,
    emitter,
    permSvc,
    spool: spoolSvc,
    // T1.5：注入式 ws（Origin+Cookie header）——URL 无 query token（cookie 通道承载原 token 语义）
    connect(name: string, token = 'tok', opts: { origin?: string; onSocket?: (ws: WebSocket) => void; extraHeaders?: Record<string, string> } = {}) {
      const ydoc = new Y.Doc();
      // T1.5 评审小修：`|| undefined` 后置——COLLAB_ALLOWED_ORIGINS='' 时 split(',')[0]='' 穿透为 Origin 空头
      const origin = opts.origin ?? (process.env.COLLAB_ALLOWED_ORIGINS?.split(',')[0] || undefined) ?? 'http://localhost:5173';
      const provider = new HocuspocusProvider({
        url: `${url}?csv=${CLIENT_PROTOCOL_VERSION}&sv=${CANVAS_DOC_SCHEMA_VERSION}`,   // Y0b-3 T5 版本门：装置带当前协议版（缺 csv=client-version-missing 恒拒；csv 单源防 bump 漂移）+T24 收口 M-1 sv（三元真承载——缺 sv=4406）
        name,
        document: ydoc,
        WebSocketPolyfill: makeHeaderWs({ origin, cookie: `flowweb.session_token=${token}`, ...opts.extraHeaders }, opts.onSocket),
        // WebSocketPolyfill 运行时透传支持、顶层 HocuspocusProviderConfiguration 未声明（先例 ws-polyfill.gate.spec:47）
      } as any);
      providers.push(provider);
      const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()));
      return { ydoc, provider, synced };
    },
    forget(provider: HocuspocusProvider) {
      const i = providers.indexOf(provider);
      if (i >= 0) providers.splice(i, 1);
    },
    async dispose() {
      for (const p of providers.splice(0)) await p.destroy();
      // Y0c T15：常驻会话先释放（Z81 测试等价——direct 在则库 runDestroy 永不 settle；
      // 释放=releaseSessionFor 逐条目（T18 releaseAllSessions 关停序前的基础形态复用））
      for (const pid of residency.residentProjectIds()) await residency.releaseSessionFor(pid);
      // Y1c T10：destroy 套 4s race——beforeUnloadDocument 拒绝卸载（applied 未 drain——doc 常驻
      // fail-closed）会取消库卸载=destroy 永不 resolve（生产 onApplicationShutdown 自带 4s race 同款；
      // kit 不走 Nest 关停链，此处补齐等价兜底）。
      await Promise.race([
        (gateway as any).server.destroy(),
        new Promise((r) => { setTimeout(r, 4_000).unref?.(); }),
      ]);
      if (ownedSpoolDir) await rm(ownedSpoolDir, { recursive: true, force: true }).catch(() => {});   // mkdtemp tmpdir 域——自建才清
    },
  };
}
