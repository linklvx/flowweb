import { EventEmitter2 } from '@nestjs/event-emitter';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { CollabGateway } from './collab.gateway';
import { CollabDocumentService } from './collab-document.service';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';


function buildDocState(): Buffer {
  const doc = new Y.Doc();
  const nodes = doc.getMap('nodes');
  const n = new Y.Map();
  n.set('type', 'textInput');
  const pos = new Y.Map();
  pos.set('x', 1);
  pos.set('y', 2);
  n.set('position', pos);
  const data = new Y.Map();
  data.set('text', 'hi');
  n.set('data', data);
  nodes.set('n1', n);
  const edges = doc.getMap('edges');
  const e = new Y.Map();
  e.set('source', 'n1');
  e.set('target', 'n2');
  edges.set('e1', e);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

describe('CollabGateway + CollabDocumentService（integration）', () => {
  let prisma: any;
  let gateway: CollabGateway;
  let service: CollabDocumentService;
  let emitter: EventEmitter2;
  let url: string;
  const providers: HocuspocusProvider[] = [];

  beforeEach(async () => {
    prisma = {
      session: {
        findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, expiresAt: new Date(Date.now() + 86400000) }),
      },
      canvasProject: {
        findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }),
      },
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }),
      },
      canvasDoc: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
    };


    emitter = new EventEmitter2();
    const port = 20000 + Math.floor(Math.random() * 20000);
    gateway = new CollabGateway(prisma as any, emitter as any, port, 300);
    await gateway.onModuleInit();
    url = `ws://127.0.0.1:${port}`;
    service = new CollabDocumentService(gateway);
  });

  afterEach(async () => {
    for (const p of providers.splice(0)) await p.destroy();
    await (gateway as any).server.destroy();
  });

  function connect(name: string, token = 'tok'): { ydoc: Y.Doc; provider: HocuspocusProvider; synced: Promise<void> } {
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({ url: `${url}?token=${token}`, name, document: ydoc });
    providers.push(provider);
    const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()));
    return { ydoc, provider, synced };
  }

  it('① onAuthenticate：成员连接成功', async () => {
    const { synced } = connect('project:p1');
    await Promise.race([synced, new Promise((_, rej) => setTimeout(() => rej(new Error('sync timeout')), 3000))]);
  });

  it('① 无 session 拒绝：连接永不完成 sync', async () => {
    prisma.session.findUnique.mockResolvedValue(null);
    const provider = new HocuspocusProvider({ url: `${url}?token=bad`, name: 'project:p2', document: new Y.Doc() });
    providers.push(provider);
    await new Promise((r) => setTimeout(r, 1500));
    expect(provider.isSynced).toBe(false);
  }, 8000);

  it('① 非团队成员拒绝：连接永不完成 sync', async () => {
    prisma.teamMember.findUnique.mockResolvedValue(null);
    const provider = new HocuspocusProvider({ url: `${url}?token=tok`, name: 'project:p3', document: new Y.Doc() });
    providers.push(provider);
    await new Promise((r) => setTimeout(r, 1500));
    expect(provider.isSynced).toBe(false);
  }, 8000);

  it('② onLoadDocument：有 CanvasDoc 时客户端连后能读到节点', async () => {
    prisma.canvasDoc.findUnique.mockResolvedValue({ projectId: 'p1', state: buildDocState() });
    const { ydoc, synced } = connect('project:p1');
    await synced;
    await vi.waitFor(() => {
      expect((ydoc.getMap('nodes').get('n1') as Y.Map<any>)?.get('type')).toBe('textInput');
    });
  });

  it('③ onStoreDocument：写变更后 debounce 落库（短 debounce 配置）', async () => {
    const { ydoc, synced } = connect('project:p1');
    await synced;
    const m = new Y.Map();
    m.set('type', 'group');
    ydoc.getMap('nodes').set('g1', m);
    await vi.waitFor(() => {
      expect(prisma.canvasDoc.upsert).toHaveBeenCalled();
    }, { timeout: 4000 });
  }, 8000);

  it('④⑤ withDoc + readCanvas：直连写入广播给客户端；返回 plain 形状', async () => {
    const { ydoc, synced } = connect('project:p1');
    await synced;

    await service.withDoc('p1', (doc) => {
      const n = new Y.Map();
      n.set('type', 'imageGen');
      const pos = new Y.Map();
      pos.set('x', 10);
      pos.set('y', 20);
      n.set('position', pos);
      n.set('data', new Y.Map());
      doc.getMap('nodes').set('srv1', n);
    });

    await vi.waitFor(() => {
      expect((ydoc.getMap('nodes').get('srv1') as Y.Map<any>)?.get('type')).toBe('imageGen');
    });

    const canvas = await service.readCanvas('p1');
    expect(canvas.nodes.find((n: any) => n.id === 'srv1')).toMatchObject({
      type: 'imageGen', position: { x: 10, y: 20 },
    });
  });

  it('⑥ closeTeamDocuments：disband 事件按 payload.projectIds 关连接', async () => {
    const { provider, synced } = connect('project:p9');
    await synced;
    expect(provider.isSynced).toBe(true);

    emitter.emitAsync('team.disbanded', { teamId: 't1', projectIds: ['p9'] });

    await vi.waitFor(() => {
      expect(provider.isSynced).toBe(false);
    }, { timeout: 4000 });
    // 不查库：关闭路径仅用 payload.projectIds（认证期的 findUnique 调用次数不增加）
    const callsBeforeClose = prisma.canvasProject.findUnique.mock.calls.length;
    emitter.emitAsync('team.disbanded', { teamId: 't1', projectIds: ['p9'] });
    await new Promise((r) => setTimeout(r, 200));
    expect(prisma.canvasProject.findUnique.mock.calls.length).toBe(callsBeforeClose);
  }, 8000);
});
