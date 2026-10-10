import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AiImageEditController } from './ai-image-edit.controller';
import { AiImageEditService } from './ai-image-edit.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { GenerationIntentService, NodeBusyError } from '../execution/generation-intent.service';
import { PricingResolverService } from '../execution/pricing-resolver.service';
import { normalizeIntentParams } from '../execution/normalize-intent-params';

describe('AiImageEditController', () => {
  let controller: AiImageEditController;
  let service: { enqueueOutpaint: ReturnType<typeof vi.fn>; enqueueErase: ReturnType<typeof vi.fn>; enqueueRedraw: ReturnType<typeof vi.fn> };
  let permSvc: { assertEditor: ReturnType<typeof vi.fn>; assertEditorWithTeam: ReturnType<typeof vi.fn> };
  let intentSvc: { claim: ReturnType<typeof vi.fn>; attachJob: ReturnType<typeof vi.fn>; fail: ReturnType<typeof vi.fn> };
  let resolver: { resolveByNodeTypeKey: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = {
      enqueueOutpaint: vi.fn().mockResolvedValue({ jobId: 'job-outpaint-1' }),
      enqueueErase: vi.fn().mockResolvedValue({ jobId: 'job-erase-1' }),
      enqueueRedraw: vi.fn().mockResolvedValue({ jobId: 'job-redraw-1' }),
    };
    permSvc = {
      assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
      // Y0b-1（E1）：claim 团队锚经 assertEditorWithTeam 取（零额外查询）
      assertEditorWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 'team-1' }),
    };
    intentSvc = {
      claim: vi.fn().mockResolvedValue({ created: true, intent: { id: 'row-1', intentId: 'i-1' } }),
      attachJob: vi.fn(),
      fail: vi.fn(),
    };
    // Y0b-1（E1）：kind 级定价快照（编辑 4 kind=modelId IS NULL，Z5）
    resolver = {
      resolveByNodeTypeKey: vi.fn().mockResolvedValue({ pricingRuleId: 'pr-kind', modelId: null, resolutionId: null, durationId: null, creditCost: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiImageEditController],
      providers: [
        { provide: AiImageEditService, useValue: service },
        { provide: ProjectPermissionService, useValue: permSvc },
        { provide: GenerationIntentService, useValue: intentSvc },
        { provide: PricingResolverService, useValue: resolver },
      ],
    }).compile();
    controller = module.get<AiImageEditController>(AiImageEditController);
  });

  describe('POST /api/image-edit/outpaint', () => {
    it('should enqueue outpaint job with userId from req.user and return jobId', async () => {
      const body = {
        projectId: 'proj1',
        nodeId: 'node1',
        fileId: 'file-1',
        rect: { x: -16, y: 0, width: 528, height: 512 },
        imageWidth: 512,
        imageHeight: 512,
      };
      const req = { user: { id: 'u1' } } as any;
      const result = await controller.outpaint(body, req);
      expect(service.enqueueOutpaint).toHaveBeenCalledWith(
        'u1', 'proj1', 'node1', 'file-1', { x: -16, y: 0, width: 528, height: 512 }, 512, 512, 'row-1', 'i-1',
      );
      expect(result).toEqual({ jobId: 'job-outpaint-1' });
    });
  });

  describe('POST /api/image-edit/erase', () => {
    it('should enqueue erase job with userId from req.user and return jobId', async () => {
      const body = {
        projectId: 'proj1',
        nodeId: 'node1',
        fileId: 'file-1',
        maskFileId: 'mask-1',
      };
      const req = { user: { id: 'u1' } } as any;
      const result = await controller.erase(body, req);
      expect(service.enqueueErase).toHaveBeenCalledWith(
        'u1', 'proj1', 'node1', 'file-1', 'mask-1', 'row-1', 'i-1',
      );
      expect(result).toEqual({ jobId: 'job-erase-1' });
    });
  });

  describe('POST /api/image-edit/redraw', () => {
    it('should enqueue redraw job with userId from req.user and return jobId', async () => {
      const body = {
        projectId: 'proj1',
        nodeId: 'node1',
        fileId: 'file-1',
        maskFileId: 'mask-1',
        prompt: 'a beautiful sunset',
        strength: 70,
      };
      const req = { user: { id: 'u1' } } as any;
      const result = await controller.redraw(body, req);
      expect(service.enqueueRedraw).toHaveBeenCalledWith(
        'u1', 'proj1', 'node1', 'file-1', 'mask-1', 'a beautiful sunset', 70, 'row-1', 'i-1',
      );
      expect(result).toEqual({ jobId: 'job-redraw-1' });
    });
  });

  describe('批0.5-8 意图表扩面（F13：claim→enqueue→attachJob）', () => {
    const outpaintBody = {
      projectId: 'proj1',
      nodeId: 'node1',
      fileId: 'file-1',
      rect: { x: -16, y: 0, width: 528, height: 512 },
      imageWidth: 512,
      imageHeight: 512,
    };

    it('claim 参数：kind=端点任务类型 + paramsHash=白名单规范化（T6 身份字段 fileId 进哈希）+ body.regenToken 透传', async () => {
      const req = { user: { id: 'u1' } } as any;
      await controller.outpaint({ ...outpaintBody, regenToken: 'client-int-1' }, req);
      expect(intentSvc.claim).toHaveBeenCalledWith(expect.objectContaining({
        projectId: 'proj1', nodeId: 'node1', userId: 'u1',
        gestureToken: 'client-int-1', kind: 'outpaint',
        paramsHash: normalizeIntentParams('outpaint', {
          fileId: 'file-1', rect: outpaintBody.rect, imageWidth: 512, imageHeight: 512,
        }),
      }));
    });

    it('body 无 regenToken → gestureToken=undefined（Z109：内容键路径——行身份由 claim 内部铸造，controller 不再代铸 UUID）', async () => {
      const req = { user: { id: 'u1' } } as any;
      await controller.outpaint(outpaintBody, req);
      const arg = intentSvc.claim.mock.calls[0][0];
      expect(arg.gestureToken).toBeUndefined();
      expect(arg.intentId).toBeUndefined();   // 行身份不入参——claim 内部 randomUUID
    });

    it('erase/redraw 同构：kind 与白名单参数集各按端点提取（T6：身份字段 fileId/maskFileId 进哈希）', async () => {
      const req = { user: { id: 'u1' } } as any;
      await controller.erase({ projectId: 'proj1', nodeId: 'node1', fileId: 'file-1', maskFileId: 'mask-1', regenToken: 'e-1' }, req);
      expect(intentSvc.claim).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'erase', paramsHash: normalizeIntentParams('erase', { fileId: 'file-1', maskFileId: 'mask-1' }),
      }));
      await controller.redraw({ projectId: 'proj1', nodeId: 'node1', fileId: 'file-1', maskFileId: 'mask-1', prompt: 'a sunset', strength: 70, regenToken: 'r-1' }, req);
      expect(intentSvc.claim).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'redraw',
        paramsHash: normalizeIntentParams('redraw', { fileId: 'file-1', maskFileId: 'mask-1', prompt: 'a sunset', strength: 70 }),
      }));
    });

    it('claim 成功 → enqueue 携 intentRowId/intentId + attachJob(intent.id, job.id) 回写（F13 资损盲区）', async () => {
      const req = { user: { id: 'u1' } } as any;
      await controller.outpaint(outpaintBody, req);
      expect(service.enqueueOutpaint).toHaveBeenCalledWith(
        'u1', 'proj1', 'node1', 'file-1', outpaintBody.rect, 512, 512, 'row-1', 'i-1',
      );
      expect(intentSvc.attachJob).toHaveBeenCalledTimes(1);
      expect(intentSvc.attachJob).toHaveBeenCalledWith('row-1', 'job-outpaint-1');
    });

    it('双击互斥（同节点异 intentId 第二击）：claim 抛 NodeBusyError → 409 冒泡 + 零 enqueue 零 attachJob', async () => {
      intentSvc.claim.mockRejectedValue(new NodeBusyError());
      const req = { user: { id: 'u1' } } as any;
      await expect(controller.outpaint(outpaintBody, req)).rejects.toBeInstanceOf(NodeBusyError);
      expect(service.enqueueOutpaint).not.toHaveBeenCalled();
      expect(intentSvc.attachJob).not.toHaveBeenCalled();
      expect(intentSvc.fail).not.toHaveBeenCalled(); // 未获执行权——不碰行
    });

    it('同 token 重放（claim created:false SUCCEEDED）→ 零 enqueue 零扣费路径 + 裸值返回（T6 信封清剿——交全局拦截器单层包裹）', async () => {
      intentSvc.claim.mockResolvedValue({
        created: false,
        intent: { id: 'row-1', intentId: 'i-1', status: 'SUCCEEDED', resultRef: 'media-old' },
      });
      const req = { user: { id: 'u1' } } as any;
      const result = await controller.outpaint({ ...outpaintBody, regenToken: 'i-1' }, req);
      expect(service.enqueueOutpaint).not.toHaveBeenCalled();
      expect(intentSvc.attachJob).not.toHaveBeenCalled();
      expect(result).toEqual({ replayed: true, resultRef: 'media-old' });
    });

    it('enqueue 失败（队列宕）→ fail 置 FAILED（防 RUNNING 孤儿锁节点 15min）+ 异常透传', async () => {
      service.enqueueOutpaint.mockRejectedValue(new Error('redis down'));
      const req = { user: { id: 'u1' } } as any;
      await expect(controller.outpaint(outpaintBody, req)).rejects.toThrow('redis down');
      expect(intentSvc.fail).toHaveBeenCalledWith('row-1', expect.stringContaining('redis down'));
      expect(intentSvc.attachJob).not.toHaveBeenCalled();
    });
  });

  describe('安全止血（spec 批0c-1 判据①：非成员 403 且 service 零调用）', () => {
    it('outpaint：assertEditor 拒绝 → 抛错且 service 零调用（越权扣费面）', async () => {
      permSvc.assertEditorWithTeam.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
      const body = {
        projectId: 'p1',
        nodeId: 'n1',
        fileId: 'f1',
        rect: { x: 0, y: 0, width: 10, height: 10 },
        imageWidth: 10,
        imageHeight: 10,
      };
      const req = { user: { id: 'u1' } } as any;
      await expect(controller.outpaint(body, req)).rejects.toThrow('无项目编辑权限');
      expect(permSvc.assertEditorWithTeam).toHaveBeenCalledWith('p1', 'u1');
      expect(service.enqueueOutpaint).not.toHaveBeenCalled();
    });

    it('erase/redraw 同守卫：拒绝 → service 零调用', async () => {
      permSvc.assertEditorWithTeam.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
      const req = { user: { id: 'u1' } } as any;
      await expect(controller.erase({ projectId: 'p1', nodeId: 'n1', fileId: 'f1', maskFileId: 'm1' }, req)).rejects.toThrow('无项目编辑权限');
      await expect(controller.redraw({ projectId: 'p1', nodeId: 'n1', fileId: 'f1', maskFileId: 'm1', prompt: 'x', strength: 0.5 }, req)).rejects.toThrow('无项目编辑权限');
      expect(permSvc.assertEditorWithTeam).toHaveBeenCalledWith('p1', 'u1');
      expect(service.enqueueErase).not.toHaveBeenCalled();
      expect(service.enqueueRedraw).not.toHaveBeenCalled();
    });
  });
});
