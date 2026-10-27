// apps/api/src/modules/collab/collab-t24-version-gate.spec.ts
// Y1c T24 红③（plan Task 24——spec v5.4 §3.2 v5.4⑧/偏离 37⑰）：**协议版本门缺失=旧 bundle fixture
// 连新服务端进 DENY 无限循环**。库行为（4.6.0 esm:938-942）：onAuthenticate throw → 只发
// PermissionDenied 消息+簿记清理，**socket 保持打开**——旧 bundle 客户端（无 4406 终态认知）超时/
// 重连=无限循环撞同一硬门。红相=deny 后 socket 零 close（fake socket writes 空）；绿=升级 socket
// 直写 RFC6455 close 帧 4406 client-outdated（terminal——resolveCloseAction 强刷档）后 end。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';
import { CLIENT_PROTOCOL_VERSION, resolveCloseAction, CollabCloseCode } from '@flowweb/shared';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetHeapPressure } from './heap-pressure';

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('t24-vg-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
  resetHeapPressure();
});
afterEach(async () => { await spoolCleanup(); });

function buildGateway() {
  const prisma = {
    systemHistory: { findUnique: vi.fn().mockResolvedValue({ historyId: 't24-history', epochStartedAt: new Date() }) },
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
  const spool = new CollabSpoolService(spoolDir);
  spool.setOwner('t24-vg-owner');
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, lease as any,
    perm as any, 48000 + Math.floor(Math.random() * 2000),
    undefined, undefined, undefined, spool,
  );
  gatewayFacade(gateway).forceCollabState('serving');
  return { gateway };
}

/** fake 升级 socket（write/end 捕获——RFC6455 close 帧断言面）。 */
function fakeSocket() {
  const writes: Buffer[] = [];
  return {
    writes,
    socket: {
      write: (b: Buffer) => { writes.push(Buffer.from(b)); return true; },
      end: vi.fn(),
      on: vi.fn(),
    },
  };
}

/** 解析首个 WS close 帧（0x88+长度+2B code BE+reason UTF-8）。 */
function parseCloseFrame(buf: Buffer): { code: number; reason: string } | null {
  if (buf.length < 2 || buf[0] !== 0x88) return null;
  const len = buf[1];
  if (buf.length < 2 + len) return null;
  return { code: buf.readUInt16BE(2), reason: buf.subarray(4, 2 + len).toString('utf8') };
}

describe('Y1c T24 红③：版本门 4406 terminal close（旧 bundle DENY 无限循环阻断）', () => {
  it('旧 bundle（csv=2<current 四档门 schema-outdated 拒）→ 升级 socket close 4406 client-outdated（修前：socket 保持打开=循环）', async () => {
    const { gateway } = buildGateway();
    const fs = fakeSocket();
    const req = { headers: { origin: 'http://localhost:5173' }, url: '/collab?csv=2' };
    await gateway.hooks.onUpgrade({ request: req as never, socket: fs.socket as never, head: null, instance: undefined } as never);
    expect(fs.writes.length).toBe(0);   // 升级放行（origin 合法+速率未超）——拒绝 write 不发生
    await expect(gateway.hooks.onAuthenticate({
      requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),
      requestParameters: new URLSearchParams('csv=2'),
      socketId: 'sock-t24-1',
      documentName: 'project:vg',
      connectionConfig: { readOnly: false, isAuthenticated: false },
      request: req as never,
    } as never)).rejects.toMatchObject({ reason: 'schema-outdated' });
    // ★ 红相：修前 writes 空（库 throw 不关 socket——旧 bundle 无终态认知循环撞门）；绿=close 4406
    expect(fs.writes.length).toBeGreaterThan(0);
    const close = parseCloseFrame(fs.writes[0]!);
    expect(close?.code).toBe(CollabCloseCode.CLIENT_OUTDATED);   // 4406
    expect(close?.reason).toBe('client-outdated');
    expect(fs.socket.end).toHaveBeenCalled();
  });

  it('historyId 不匹配（三元硬门 client-outdated——修正 #8 首连放行的反面档）→ close 4406', async () => {
    const { gateway } = buildGateway();
    gateway.sessionGuard.setServerHistory({ historyId: 't24-history' });   // listenCollab 接线等价（t9-ownership-switch.spec 同款）
    const fs = fakeSocket();
    const req = { headers: { origin: 'http://localhost:5173' }, url: `/collab?csv=${CLIENT_PROTOCOL_VERSION}&hid=stale-history` };
    await gateway.hooks.onUpgrade({ request: req as never, socket: fs.socket as never, head: null, instance: undefined } as never);
    await expect(gateway.hooks.onAuthenticate({
      requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),
      requestParameters: new URLSearchParams(`csv=${CLIENT_PROTOCOL_VERSION}&hid=stale-history`),
      socketId: 'sock-t24-2',
      documentName: 'project:vg',
      connectionConfig: { readOnly: false, isAuthenticated: false },
      request: req as never,
    } as never)).rejects.toMatchObject({ reason: 'schema-outdated' });
    expect(fs.writes.length).toBeGreaterThan(0);
    expect(parseCloseFrame(fs.writes[0]!)?.code).toBe(4406);
  });

  it('resolveCloseAction(4406)=terminal（客户端停止重连+强刷——循环阻断的客户端半链；build hash 不进门=遥测）', () => {
    expect(resolveCloseAction(4406, 'client-outdated')).toMatchObject({ kind: 'terminal', terminalReason: 'client-outdated' });
  });
});
