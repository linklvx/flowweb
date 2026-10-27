// apps/api/src/modules/collab/collab-recovery-accept.controller.spec.ts
// Y1c T25b 面 B5（plan :338 登记）：server-restored 管理员裁定接受面。★红形态=「现不可达」——
// 端点不存在（import 红）。语义：只读 recovery 态的管理员（项目 OWNER/平台 ADMIN）裁定接受服务端
// 现态→客户端解除只读恢复（清缓存族+reload 以服务端真值 g 重建——acceptance 不改服务端代际，
// 客户端以 DB 真值重连自然过门）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { CollabRecoveryAcceptController } from './collab-recovery-accept.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from '../team/project-permission.service';

const prisma: any = {};
const perm = { resolve: vi.fn() };

async function make() {
  const moduleRef = await Test.createTestingModule({
    controllers: [CollabRecoveryAcceptController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: ProjectPermissionService, useValue: perm },
    ],
  }).compile();
  return moduleRef.get(CollabRecoveryAcceptController);
}

const req = (role?: string) => ({ user: { id: 'u1', ...(role ? { role } : {}) } }) as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('T25b B5：recovery-accept（管理员裁定接受）', () => {
  it('★项目 OWNER 接受→{accepted:true, generation}（canvas-doc-head 三分读真值——客户端以 DB g 重建）', async () => {
    const c = await make();
    perm.resolve.mockResolvedValue('PROJECT_OWNER');
    prisma.canvasDoc = { findUnique: vi.fn().mockResolvedValue({ generation: 1 }) };   // readCanvasDocHead 底层单查
    const out = await c.accept('p1', req());
    expect(out).toEqual({ accepted: true, generation: 1 });
  });

  it('★平台 ADMIN 直通（非项目成员的管理员裁定档）', async () => {
    const c = await make();
    perm.resolve.mockResolvedValue(null);   // 非项目成员
    prisma.canvasDoc = { findUnique: vi.fn().mockResolvedValue({ generation: 2 }) };
    const out = await c.accept('p1', req('ADMIN'));
    expect(out).toEqual({ accepted: true, generation: 2 });
  });

  it('★非 OWNER 非 ADMIN→403（EDITOR/MEMBER/匿名禁裁定——只读恢复态解除是管理员面）；doc 缺失→404', async () => {
    const c = await make();
    perm.resolve.mockResolvedValue('PROJECT_EDITOR');
    await expect(c.accept('p1', req())).rejects.toThrow(ForbiddenException);
    perm.resolve.mockResolvedValue('PROJECT_MEMBER');
    await expect(c.accept('p1', req())).rejects.toThrow(ForbiddenException);
    perm.resolve.mockResolvedValue('PROJECT_OWNER');   // OWNER 但无画布行（doc 缺失=404 档）
    prisma.canvasDoc = { findUnique: vi.fn().mockResolvedValue(null) };
    await expect(c.accept('p1', req())).rejects.toThrow('画布文档不存在');
  });
});
