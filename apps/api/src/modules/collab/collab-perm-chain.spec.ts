// apps/api/src/modules/collab/collab-perm-chain.spec.ts
// Y0b-3 T3 Step 0.5（P-K/F-3 红锚）：authenticate 权限判据单源化——perm.resolveWithTeam
// （显式 ProjectMember > 创建者 > 团队回退）替换 canvasProject.findUnique+teamMember.findUnique
// 硬门+perm.resolve 三段。改前红锚：②仅 ProjectMember 不在团队/③仅创建者不在团队——现状
// teamMember 硬门必 403（FORBIDDEN）；①现状返回 TeamRole 'MEMBER'（词表三套混用）。
// 形态：直构单元组（auth-reason spec 先例）——mock prisma 驱动**真** ProjectPermissionService
// （禁 stub 双权威：NotFoundException/回退链行为随服务真实语义走）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';   // Y0c T39b 波 2：内部状态访问经 façade（check-collab-test-facade 门禁）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CLIENT_PROTOCOL_VERSION } from '@flowweb/shared';

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y0b3-perm-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => { await spoolCleanup(); });

type PermSeed = {
  teamMember?: string;        // teamMember 行的 role（OWNER/MEMBER）
  projectMember?: string;     // projectMember 行的 role（PROJECT_OWNER/EDITOR/VIEWER）
  creator?: boolean;          // u1=创建者
  projectMissing?: boolean;   // 项目行不存在
};

function buildGateway(seed: PermSeed) {
  const prisma = {
    systemHistory: { findUnique: vi.fn().mockResolvedValue({ historyId: 'spec-history-id', epochStartedAt: new Date() }) },  // Y1c T9（T8 接线）：listenCollab requireSystemHistory fail-closed 读面 mock

    session: {
      findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, userId: 'u1', expiresAt: new Date(Date.now() + 86400000) }),
      update: vi.fn(async (args: any) => ({ user: { id: 'u1', name: '张三' }, expiresAt: args.data.expiresAt })),
    },
    canvasProject: {
      findUnique: vi.fn().mockResolvedValue(seed.projectMissing ? null : { teamId: 't1', userId: seed.creator ? 'u1' : 'other' }),
    },
    projectMember: { findUnique: vi.fn().mockResolvedValue(seed.projectMember ? { role: seed.projectMember } : null) },
    teamMember: { findUnique: vi.fn().mockResolvedValue(seed.teamMember ? { role: seed.teamMember, userId: 'u1' } : null) },
  };
  const repo = createMockRepo();
  const lease = createLeaseStub();
  const perm = new ProjectPermissionService(prisma as any);   // 真服务——mock prisma 驱动整链
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, lease as any,
    perm as any, 43000 + Math.floor(Math.random() * 20000),
    undefined, undefined, undefined, new CollabSpoolService(spoolDir),
  );
  gatewayFacade(gateway).forceCollabState('serving');
  return { gateway, prisma };
}

function authPayload(documentName = 'project:p1') {
  return {
    requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),
    requestParameters: new URLSearchParams(`csv=${CLIENT_PROTOCOL_VERSION}`),   // Y0b-3 T5 版本门：装置带当前协议版
    socketId: 'sock-perm-1',
    documentName,
    connectionConfig: { readOnly: false, isAuthenticated: false },
  };
}

describe('Y0b-3 T3 F-3：authenticate 权限判据单源 resolveWithTeam（表驱动五形态）', () => {
  it.each([
    ['①仅 teamMember：无 ProjectMember、非创建者→连上 role=PROJECT_EDITOR', { teamMember: 'MEMBER' }, 'connected:PROJECT_EDITOR'],
    ['②仅 ProjectMember 不在团队（改前红锚：现状 teamMember 硬门必 403）', { projectMember: 'PROJECT_VIEWER' }, 'connected:PROJECT_VIEWER'],
    ['③仅创建者不在团队（改前红锚：现状 teamMember 硬门必 403）', { creator: true }, 'connected:PROJECT_OWNER'],
    ['④无任何角色→FORBIDDEN', {}, 'denied:forbidden'],
    ['⑤项目不存在→NOT_FOUND 分型不退化（resolveWithTeam throw NotFoundException 需 catch 转 deny）', { projectMissing: true }, 'denied:not-found'],
  ])('%s', async (_name, seed, expected) => {
    const { gateway } = buildGateway(seed as PermSeed);
    if (expected.startsWith('connected:')) {
      const ctx = (await gateway.hooks.onAuthenticate(authPayload() as any)) as any;
      expect(ctx.user.role).toBe(expected.slice('connected:'.length));
    } else {
      await expect(gateway.hooks.onAuthenticate(authPayload() as any))
        .rejects.toMatchObject({ reason: expected.slice('denied:'.length) });
    }
  });

  it('词表单源：context.user.role=ProjectRole（PROJECT_OWNER/EDITOR/VIEWER）——TeamRole OWNER/MEMBER 与小写 viewer/editor 三套混用终结', async () => {
    const { gateway } = buildGateway({ teamMember: 'MEMBER' });
    const ctx = (await gateway.hooks.onAuthenticate(authPayload() as any)) as any;
    expect(['PROJECT_OWNER', 'PROJECT_EDITOR', 'PROJECT_VIEWER']).toContain(ctx.user.role);
  });

  it('VIEWER 连接 readOnly（Y0b-5 T16：auth 期意图 freezeIntent=viewer——config 直写退役，connected 登记 writeFreeze 施加）', async () => {
    const { gateway } = buildGateway({ projectMember: 'PROJECT_VIEWER' });
    const config: any = { readOnly: false, isAuthenticated: false };
    const ctx = (await gateway.hooks.onAuthenticate({ ...authPayload(), connectionConfig: config } as any)) as any;
    expect(config.readOnly).toBe(false);   // 直写退役——writeFreeze 单源（census ⑪ 3→2）
    expect(ctx.readOnly).toBe(true);
    expect(ctx.freezeIntent).toBe('viewer');
  });
});
