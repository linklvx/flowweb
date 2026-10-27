// apps/api/src/modules/collab/collab-canvas-read.controller.spec.ts
// Y1c T25b 微批 C-1（双员同阻断）：会话鉴权用户面画布读端点。★红形态=端点缺席（import 红）——
// fetchServerCanvas 现指 worker 内部通道 GET /collab/doc/:pid/canvas（WorkerWriteAuthGuard 只认
// Bearer WORKER_WRITE_TOKEN——apiFetch 零 Authorization 头生产恒 403+@NoTransform 裸 {nodes,edges}
// vs apiFetch {code:0} envelope 契约击穿）。修=新端点：assertEditor 门（非 EDITOR 403）+标准
// envelope 形态（TransformInterceptor 包裹——apiFetch 契约）；worker 端点不动。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { CollabCanvasReadController } from './collab-canvas-read.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CollabWritePort } from './collab-write.port';

const prisma: any = {};
const perm = { assertEditor: vi.fn() };
const port = { readCanvas: vi.fn() };

async function make() {
  const moduleRef = await Test.createTestingModule({
    controllers: [CollabCanvasReadController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: ProjectPermissionService, useValue: perm },
      { provide: CollabWritePort, useValue: port },
    ],
  }).compile();
  return moduleRef.get(CollabCanvasReadController);
}

const req = (id?: string) => ({ user: id ? { id } : {} }) as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('T25b 微批 C-1：用户面画布读端点（B 场景裁定 current 侧服务端真值读径）', () => {
  it('★c1-1 EDITOR 过门→CollabWritePort.readCanvas 直通（CanvasReadModel——标准 envelope 由 TransformInterceptor 承载非 @NoTransform 裸形态）', async () => {
    const c = await make();
    perm.assertEditor.mockResolvedValue(undefined);
    port.readCanvas.mockResolvedValue({ nodes: [{ id: 's1' }], edges: [] });
    const out = await c.readCanvasView('p1', req('u1'));
    expect(perm.assertEditor).toHaveBeenCalledWith('p1', 'u1');   // 会话鉴权门（apiFetch 面）
    expect(port.readCanvas).toHaveBeenCalledWith('p1');
    expect(out).toEqual({ nodes: [{ id: 's1' }], edges: [] });   // 芯=CanvasReadModel（envelope 包裹归拦截器——wire 对拍在 int 真 HTTP 面）
  });

  it('★c1-2 非 EDITOR/未登录→assertEditor 403 上抛（生产恒拒——worker token 通道语义不再被借用）', async () => {
    const c = await make();
    perm.assertEditor.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
    await expect(c.readCanvasView('p1', req('u-viewer'))).rejects.toThrow(ForbiddenException);
    expect(port.readCanvas).not.toHaveBeenCalled();
    perm.assertEditor.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
    await expect(c.readCanvasView('p1', req())).rejects.toThrow(ForbiddenException);
  });
});
