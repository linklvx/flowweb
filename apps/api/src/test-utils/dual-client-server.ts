// apps/api/src/test-utils/dual-client-server.ts
// Y0a-1：双 client+单进程单 Server 装置——构造形态自 collab.gateway.spec.ts beforeEach 移植
// （位置参数构造+随机端口段 20000+random(20000)=既有惯例 spec:81——port=0 时库不回写 configuration.port，
// 必用随机段；provider 带 token query）。Y2/Y1a 复用地基。
// 移植适配：prisma stub 形态以既有 beforeEach 为准（session/canvasProject/teamMember 三 findUnique——
// 无 canvasDoc：gateway 装载走 repo，不查 canvasDoc）；prisma/emitter/permSvc 随 kit 暴露——
// 既有用例的失败注入面（session/teamMember 置 null、VIEWER 覆写、disband 事件）原样保留。
import { vi } from 'vitest';
import * as Y from 'yjs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { CollabGateway } from '../modules/collab/collab.gateway';
import { CollabDocumentService } from '../modules/collab/collab-document.service';
import { createMockRepo, type MockRepo } from './mock-repo';

export interface DualClientKit {
  gateway: CollabGateway;
  docService: CollabDocumentService;
  repo: MockRepo;
  url: string;
  /** 失败注入面：session/canvasProject/teamMember 的 findUnique 可逐用例覆写 */
  prisma: Record<string, any>;
  emitter: EventEmitter2;
  permSvc: { resolve: ReturnType<typeof vi.fn> };
  connect(name: string, token?: string): { ydoc: Y.Doc; provider: HocuspocusProvider; synced: Promise<void> };
  /** 用例自管 destroy 后调——从 dispose 清理数组移除（双 destroy 是本仓已知 flaky 源，惯例同 collab.gateway.spec.ts:262） */
  forget(provider: HocuspocusProvider): void;
  dispose: () => Promise<void>;
}

export async function startDualClientServer(over: Partial<MockRepo> = {}, debounce = 300): Promise<DualClientKit> {
  const prisma: Record<string, any> = {
    session: { findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, expiresAt: new Date(Date.now() + 86400000) }) },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
  };
  const repo = createMockRepo(over);
  const permSvc = { resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR') };
  const emitter = new EventEmitter2();
  const port = 20000 + Math.floor(Math.random() * 20000);
  const gateway = new CollabGateway(prisma as any, emitter as any, repo as any, { syncFromPeers: vi.fn(async () => {}) } as any, permSvc as any, port, debounce);
  await gateway.onModuleInit();   // async+await listen——无端口竞态
  const url = `ws://127.0.0.1:${port}`;
  const providers: HocuspocusProvider[] = [];
  return {
    gateway,
    docService: new CollabDocumentService(gateway),
    repo,
    url,
    prisma,
    emitter,
    permSvc,
    connect(name: string, token = 'tok') {
      const ydoc = new Y.Doc();
      const provider = new HocuspocusProvider({ url: `${url}?token=${token}`, name, document: ydoc });
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
      await (gateway as any).server.destroy();
    },
  };
}
