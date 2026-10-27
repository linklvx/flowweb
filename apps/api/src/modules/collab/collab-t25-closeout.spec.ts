// apps/api/src/modules/collab/collab-t25-closeout.spec.ts
// Y1c T25 收口批（Controller 双评审裁定 2026-10-27）——C-1(spec) 服务端腿：
// 装载/auth 面消费 resolveAuthHistoryVerdict——g_client>g_server（PITR 回退形态：长存活 tab 携
// #g5 重连、DB 真值 g3）发 **4410 server-restored 档**（码权威投递=webSocket.close 先行——T24
// closeUpgradeTerminal 形态），非 GENERATION_STALE 死端（客户端 readonly-recovery 分派消费）。
// 修前红=零 4410 写帧（deny throw 无码投递）。装置承 collab-t24-closeout.spec（buildGateway 同款）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollabSpoolService } from './collab-spool.service';
import { CollabGateway } from './collab.gateway';
import { createMockRepo, type MockRepo } from '../../test-utils/mock-repo';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { CLIENT_PROTOCOL_VERSION, CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';

let spoolDir: { dir: string; cleanup: () => Promise<void> };
beforeEach(async () => { spoolDir = await makeSpoolDir('t25-co-'); });
afterEach(async () => { await spoolDir.cleanup(); vi.restoreAllMocks(); });

function buildGateway(): { gateway: CollabGateway; repo: MockRepo } {
  const prisma = {
    systemHistory: { findUnique: vi.fn().mockResolvedValue({ historyId: 't25co-history', epochStartedAt: new Date() }) },
    session: {
      findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, userId: 'u1', expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }),
    },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1', userId: 'other' }) },
    projectMember: { findUnique: vi.fn().mockResolvedValue(null) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
  };
  const repo = createMockRepo();
  const lease = createLeaseStub();
  const perm = { resolve: vi.fn(), resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }) };
  const spool = new CollabSpoolService(spoolDir.dir);
  spool.setOwner('t25co-gw');
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, lease as any,
    perm as any, 49000 + Math.floor(Math.random() * 1000),
    undefined, undefined, undefined, spool,
  );
  gatewayFacade(gateway).forceCollabState('serving');
  gateway.sessionGuard.setServerHistory({ historyId: 't25co-history' });
  return { gateway, repo };
}

function fakeSocket() {
  const writes: Buffer[] = [];
  return {
    writes,
    socket: { write: (b: Buffer) => { writes.push(Buffer.from(b)); return true; }, end: vi.fn(), on: vi.fn() },
  };
}
const parseClose = (b: Buffer): number => b.readUInt16BE(2);
const closeReason = (b: Buffer): string => b.subarray(4).toString('utf8');

async function auth(gateway: CollabGateway, socket: { write: (b: Buffer) => boolean; end: unknown; on: unknown }, documentName: string, socketId: string): Promise<unknown> {
  const req = { headers: { origin: 'http://localhost:5173' }, url: '/collab' };
  await (gateway as unknown as { hooks: { onUpgrade(p: unknown): Promise<void> } }).hooks.onUpgrade({ request: req as never, socket: socket as never, head: null, instance: undefined } as never);
  return (gateway as unknown as { hooks: { onAuthenticate(p: unknown): Promise<unknown> } }).hooks.onAuthenticate({
    requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),
    requestParameters: new URLSearchParams(`csv=${CLIENT_PROTOCOL_VERSION}&sv=${CANVAS_DOC_SCHEMA_VERSION}`),
    socketId, documentName,
    connectionConfig: { readOnly: false, isAuthenticated: false },
    request: req as never,
  } as never);
}

describe('T25 收口批 C-1(spec) 服务端腿：g_client>g_server → 4410 server-restored 档', () => {
  it('★closeout-2s #g5 重连@DB g3（PITR 回退）→ close 4410 reason=server-restored（修前=零 close 写帧死端拒）', async () => {
    const { gateway, repo } = buildGateway();
    repo.readGeneration.mockResolvedValue(3);   // DB 真值 g3（PITR 回退后）
    const fs = fakeSocket();
    await expect(auth(gateway, fs.socket, 'project:p-sr#g5', 'sock-sr1')).rejects.toMatchObject({ reason: 'generation-stale' });
    // 码权威投递：webSocket.close(4410, 'server-restored') 先行（修前：fs.writes 空=红）
    expect(fs.writes.length).toBeGreaterThan(0);
    expect(parseClose(fs.writes[0]!)).toBe(4410);
    expect(closeReason(fs.writes[0]!)).toBe('server-restored');
  }, 10_000);

  it('负控：#g1 重连@DB g3（g_client<g_server=主动换代后陈旧名）维持 GENERATION_STALE 死端拒+零 4410 写帧（换代通道语义不变）', async () => {
    const { gateway, repo } = buildGateway();
    repo.readGeneration.mockResolvedValue(3);
    const fs = fakeSocket();
    await expect(auth(gateway, fs.socket, 'project:p-sr#g1', 'sock-sr2')).rejects.toMatchObject({ reason: 'generation-stale' });
    expect(fs.writes.filter((b) => parseClose(b) === 4410)).toHaveLength(0);
  }, 10_000);

  it('负控：#g3 重连@DB g3（同代正路）放行（方向分档不误伤）', async () => {
    const { gateway, repo } = buildGateway();
    repo.readGeneration.mockResolvedValue(3);
    const req = { headers: { origin: 'http://localhost:5173' }, url: '/collab' };
    await expect((gateway as unknown as { hooks: { onAuthenticate(p: unknown): Promise<unknown> } }).hooks.onAuthenticate({
      requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),
      requestParameters: new URLSearchParams(`csv=${CLIENT_PROTOCOL_VERSION}&sv=${CANVAS_DOC_SCHEMA_VERSION}&hid=t25co-history`),
      socketId: 'sock-sr3', documentName: 'project:p-sr#g3',
      connectionConfig: { readOnly: false, isAuthenticated: false },
      request: req as never,
    } as never)).resolves.toBeTruthy();
  }, 10_000);
});
