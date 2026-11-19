import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { AiImageEditController } from './ai-image-edit.controller';
import { AiImageEditService } from './ai-image-edit.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { GenerationIntentService, NodeBusyError } from '../execution/generation-intent.service';
import { PricingResolverService } from '../execution/pricing-resolver.service';
import { normalizeIntentParams } from '../execution/normalize-intent-params';
import { CollabDocumentService } from '../collab/collab-document.service';
import { WorkerPresenceService } from '../worker-presence/worker-presence.service';
import { QUEUE_NAMES } from '../../config/queue.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { EmitPort } from '../gateway/emit.port';
import { AuthorSlotService } from '../collab/author-slot.service';

// T7：SV 支配门夹具——客户端/服务端同 doc ⇒ 支配成立（缺省 400/落后 409 两态另测）
const svDoc = new Y.Doc();
svDoc.getMap('meta').set('schemaVersion', 2);
const SV_OK = Buffer.from(Y.encodeStateVector(svDoc)).toString('base64');

describe('AiImageEditController', () => {
  let controller: AiImageEditController;
  let service: { enqueueOutpaint: ReturnType<typeof vi.fn>; enqueueErase: ReturnType<typeof vi.fn>; enqueueRedraw: ReturnType<typeof vi.fn> };
  let permSvc: { assertEditor: ReturnType<typeof vi.fn>; assertEditorWithTeam: ReturnType<typeof vi.fn> };
  let intentSvc: { claim: ReturnType<typeof vi.fn>; attachJob: ReturnType<typeof vi.fn>; fail: ReturnType<typeof vi.fn>; observeNodeExecution: ReturnType<typeof vi.fn> };
  let resolver: { resolveByNodeTypeKey: ReturnType<typeof vi.fn> };
  let collabSvc: { readServerSV: ReturnType<typeof vi.fn>; readCanvas: ReturnType<typeof vi.fn> };
  let presence: { assertAdmittable: ReturnType<typeof vi.fn> };
  // Y2 B2d：受理回放两档依赖（!created → 作废键等值查+补释放+emit）
  let prismaMock: { artifactProjection: { findUnique: ReturnType<typeof vi.fn> } };
  let emitMock: ReturnType<typeof vi.fn>;
  let authorSlotMock: { releaseAuthorSlot: ReturnType<typeof vi.fn> };

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
      claim: vi.fn().mockResolvedValue({ created: true, artifactRev: 0, intent: { id: 'row-1', intentId: 'i-1', execSeq: 1n } }),   // T10：claimCapture 返回槽位 rev（ticket.expectedRev） // T9：claim 返回行携 execSeq（controller 铸票）
      attachJob: vi.fn(),
      fail: vi.fn(),
      observeNodeExecution: vi.fn().mockResolvedValue(undefined),   // Y1c T23 收口 I-1(spec)：claim 后 NodeExecution 观测写（M-5 补接线）
    };
    // Y0b-1（E1）：kind 级定价快照（编辑 4 kind=modelId IS NULL，Z5）
    resolver = {
      resolveByNodeTypeKey: vi.fn().mockResolvedValue({ pricingRuleId: 'pr-kind', modelId: null, resolutionId: null, durationId: null, creditCost: 1 }),
    };
    // Y0b-2 T7：SV 支配门依赖（默认=支配成立）
    collabSvc = {
      readServerSV: vi.fn(async () => Y.encodeStateVector(svDoc)),
      readCanvas: vi.fn(async () => ({ nodes: [{ id: 'node1', type: 'imageGen', data: { mediaId: 'm-author' } }], edges: [] })),
    };
    // Y0c T29-II（Z148②）：worker 准入门依赖（默认放行——单进程拓扑常态，裁决①）
    presence = { assertAdmittable: vi.fn().mockResolvedValue(undefined) };
    // Y2 B2d：回放两档依赖（默认=作废键未命中即正常档；各用例 mockResolvedValueOnce 覆写）
    prismaMock = { artifactProjection: { findUnique: vi.fn().mockResolvedValue(null) } };
    emitMock = vi.fn();
    authorSlotMock = { releaseAuthorSlot: vi.fn().mockResolvedValue({ released: true, deletedSlot: true, bindingStats: { upserted: 0, deleted: 0, noop: 1 } }) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiImageEditController],
      providers: [
        { provide: AiImageEditService, useValue: service },
        { provide: ProjectPermissionService, useValue: permSvc },
        { provide: GenerationIntentService, useValue: intentSvc },
        { provide: PricingResolverService, useValue: resolver },
        { provide: CollabDocumentService, useValue: collabSvc },
        { provide: WorkerPresenceService, useValue: presence },
        { provide: PrismaService, useValue: prismaMock },
        { provide: EmitPort, useValue: { emitNodeStatus: emitMock } },
        { provide: AuthorSlotService, useValue: authorSlotMock },
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
        stateVector: SV_OK,
      };
      const req = { user: { id: 'u1' } } as any;
      const result = await controller.outpaint(body, req);
      expect(service.enqueueOutpaint).toHaveBeenCalledWith(
        'u1', 'proj1', 'node1', 'file-1', { x: -16, y: 0, width: 528, height: 512 }, 512, 512,
        { intentRowId: 'row-1', execSeq: '1', jobId: expect.stringMatching(/^[0-9a-f-]{36}$/), expectedRev: 0 },   // T10：票携 claimCapture 槽位 rev // T9 票
      );
      expect(result).toMatchObject({ jobId: 'job-outpaint-1', replayed: false, intentId: 'i-1', execSeq: '1' });   // Y3 受理显式结局：新建档带行身份
    });
  });

  describe('POST /api/image-edit/erase', () => {
    it('should enqueue erase job with userId from req.user and return jobId', async () => {
      const body = {
        projectId: 'proj1',
        nodeId: 'node1',
        fileId: 'file-1',
        maskFileId: 'mask-1',
        stateVector: SV_OK,
      };
      const req = { user: { id: 'u1' } } as any;
      const result = await controller.erase(body, req);
      expect(service.enqueueErase).toHaveBeenCalledWith(
        'u1', 'proj1', 'node1', 'file-1', 'mask-1',
        { intentRowId: 'row-1', execSeq: '1', jobId: expect.stringMatching(/^[0-9a-f-]{36}$/), expectedRev: 0 },   // T10：票携 claimCapture 槽位 rev
      );
      expect(result).toMatchObject({ jobId: 'job-erase-1', replayed: false, intentId: 'i-1', execSeq: '1' });   // Y3 受理显式结局
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
        stateVector: SV_OK,
      };
      const req = { user: { id: 'u1' } } as any;
      const result = await controller.redraw(body, req);
      expect(service.enqueueRedraw).toHaveBeenCalledWith(
        'u1', 'proj1', 'node1', 'file-1', 'mask-1', 'a beautiful sunset', 70,
        { intentRowId: 'row-1', execSeq: '1', jobId: expect.stringMatching(/^[0-9a-f-]{36}$/), expectedRev: 0 },   // T10：票携 claimCapture 槽位 rev
      );
      expect(result).toMatchObject({ jobId: 'job-redraw-1', replayed: false, intentId: 'i-1', execSeq: '1' });   // Y3 受理显式结局
    });
  });

  describe('Y1c T23 收口 I-1(spec)：M-5 补接线——编辑链 claim 后 NodeExecution 观测写', () => {
    it('claim 成功（created）→ observeNodeExecution({projectId,nodeId,execSeq}) 恒达（观测位零副作用纪律）', async () => {
      const body = {
        projectId: 'p1', nodeId: 'n1', fileId: 'f',
        rect: { x: 0, y: 0, width: 10, height: 10 }, imageWidth: 100, imageHeight: 100,
        stateVector: SV_OK,
      };
      await controller.outpaint(body, { user: { id: 'u1' } } as never);
      expect(intentSvc.observeNodeExecution).toHaveBeenCalledWith({ projectId: 'p1', nodeId: 'n1', execSeq: 1n });
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
      stateVector: SV_OK,
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
      await controller.erase({ projectId: 'proj1', nodeId: 'node1', fileId: 'file-1', maskFileId: 'mask-1', regenToken: 'e-1', stateVector: SV_OK }, req);
      expect(intentSvc.claim).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'erase', paramsHash: normalizeIntentParams('erase', { fileId: 'file-1', maskFileId: 'mask-1' }),
      }));
      await controller.redraw({ projectId: 'proj1', nodeId: 'node1', fileId: 'file-1', maskFileId: 'mask-1', prompt: 'a sunset', strength: 70, regenToken: 'r-1', stateVector: SV_OK }, req);
      expect(intentSvc.claim).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'redraw',
        paramsHash: normalizeIntentParams('redraw', { fileId: 'file-1', maskFileId: 'mask-1', prompt: 'a sunset', strength: 70 }),
      }));
    });

    it('claim 成功 → enqueue 携 intentRowId/intentId + attachJob(intent.id, job.id) 回写（F13 资损盲区）', async () => {
      const req = { user: { id: 'u1' } } as any;
      await controller.outpaint(outpaintBody, req);
      expect(service.enqueueOutpaint).toHaveBeenCalledWith(
        'u1', 'proj1', 'node1', 'file-1', outpaintBody.rect, 512, 512,
        { intentRowId: 'row-1', execSeq: '1', jobId: expect.any(String), expectedRev: 0 },
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

    it('同 token 重放（claim created:false SUCCEEDED）→ 零 enqueue 零扣费路径 + 裸值返回（T6 信封清剿；Y3 受理显式结局 outcome=delivered）', async () => {
      intentSvc.claim.mockResolvedValue({
        created: false,
        intent: { id: 'row-1', intentId: 'i-1', status: 'SUCCEEDED', resultRef: 'media-old' },
      });
      const req = { user: { id: 'u1' } } as any;
      const result = await controller.outpaint({ ...outpaintBody, regenToken: 'i-1' }, req);
      expect(service.enqueueOutpaint).not.toHaveBeenCalled();
      expect(intentSvc.attachJob).not.toHaveBeenCalled();
      expect(result).toEqual({ replayed: true, outcome: 'delivered', resultRef: 'media-old' });
    });

    it('enqueue 失败（队列宕）→ fail 置 FAILED（防 RUNNING 孤儿锁节点 15min）+ 异常透传', async () => {
      service.enqueueOutpaint.mockRejectedValue(new Error('redis down'));
      const req = { user: { id: 'u1' } } as any;
      await expect(controller.outpaint(outpaintBody, req)).rejects.toThrow('redis down');
      expect(intentSvc.fail).toHaveBeenCalledWith('row-1', expect.stringContaining('redis down'), undefined, 1n);
      expect(intentSvc.attachJob).not.toHaveBeenCalled();
    });
  });

  describe('Y0b-2 T7：SV 支配门（runGuarded 首位——claim 之前）', () => {
    const gateBody = {
      projectId: 'proj1',
      nodeId: 'node1',
      fileId: 'file-1',
      rect: { x: -16, y: 0, width: 528, height: 512 },
      imageWidth: 512,
      imageHeight: 512,
      stateVector: SV_OK,
    };

    it('客户端 SV 未被服务端支配 → 409 SYNC_PENDING：零 claim 零 enqueue 零 fail（不烧 attempts）', async () => {
      collabSvc.readServerSV.mockResolvedValue(Y.encodeStateVector(new Y.Doc()));   // 服务端空 doc——不支配
      const req = { user: { id: 'u1' } } as any;
      const err = await controller.outpaint(gateBody, req).catch((e: unknown) => e);
      expect(err).toMatchObject({ errorCode: 'SYNC_PENDING' });
      expect((err as any).getStatus()).toBe(409);
      expect(intentSvc.claim).not.toHaveBeenCalled();
      expect(service.enqueueOutpaint).not.toHaveBeenCalled();
      expect(intentSvc.fail).not.toHaveBeenCalled();
    });

    it('缺 stateVector → 400 SYNC_STATE_VECTOR_REQUIRED（fail-closed）', async () => {
      const { stateVector: _sv, ...noSv } = gateBody;
      const req = { user: { id: 'u1' } } as any;
      const err = await controller.outpaint(noSv as any, req).catch((e: unknown) => e);
      expect(err).toMatchObject({ errorCode: 'SYNC_STATE_VECTOR_REQUIRED' });
      expect((err as any).getStatus()).toBe(400);
      expect(intentSvc.claim).not.toHaveBeenCalled();
    });
  });

  // Y0c T29-II（Z148②/F11 同源）：付费队列 enqueue fail-closed——runGuarded 门序=SV→presence→定价快照→claim
  describe('Y0c T29-II（Z148②）：worker 准入门（runGuarded——claim 之前拒=零退款义务）', () => {
    const gateBody = {
      projectId: 'proj1', nodeId: 'node1', fileId: 'file-1',
      rect: { x: 0, y: 0, width: 10, height: 10 }, imageWidth: 10, imageHeight: 10,
      stateVector: SV_OK,
    };

    it('无消费者 ⇒ 503 WORKER_ABSENT：零定价快照 零 claim 零 enqueue 零 fail（三端点同型单点覆盖）', async () => {
      presence.assertAdmittable.mockRejectedValue(
        new ServiceUnavailableException({ code: 'WORKER_ABSENT', message: '队列 ai-image-edit 当前无 worker 消费，请稍后重试' }),
      );
      const req = { user: { id: 'u1' } } as any;
      const err = await controller.outpaint(gateBody, req).catch((e: unknown) => e);
      expect((err as any).getStatus()).toBe(503);
      expect((err as any).getResponse()).toMatchObject({ code: 'WORKER_ABSENT' });
      expect(presence.assertAdmittable).toHaveBeenCalledWith(QUEUE_NAMES.AI_IMAGE_EDIT);
      expect(resolver.resolveByNodeTypeKey).not.toHaveBeenCalled();   // 门在定价快照之前
      expect(intentSvc.claim).not.toHaveBeenCalled();                // claim 前拒=零退款义务
      expect(service.enqueueOutpaint).not.toHaveBeenCalled();
      expect(intentSvc.fail).not.toHaveBeenCalled();                 // 未获执行权——不碰行（NodeBusy 同款纪律）
    });

    it('放行路径探门恰一次（ai-image-edit 队列——erase/redraw 同经 runGuarded 单点）；SV 门在前（409 时零探测）', async () => {
      const req = { user: { id: 'u1' } } as any;
      await controller.erase({ projectId: 'proj1', nodeId: 'node1', fileId: 'file-1', maskFileId: 'mask-1', stateVector: SV_OK }, req);
      expect(presence.assertAdmittable).toHaveBeenCalledTimes(1);
      expect(presence.assertAdmittable).toHaveBeenCalledWith(QUEUE_NAMES.AI_IMAGE_EDIT);
      presence.assertAdmittable.mockClear();
      collabSvc.readServerSV.mockResolvedValue(Y.encodeStateVector(new Y.Doc()));   // 服务端空 doc——不支配
      await expect(controller.outpaint(gateBody, req)).rejects.toMatchObject({ errorCode: 'SYNC_PENDING' });
      expect(presence.assertAdmittable).not.toHaveBeenCalled();
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
        stateVector: SV_OK,
      };
      const req = { user: { id: 'u1' } } as any;
      await expect(controller.outpaint(body, req)).rejects.toThrow('无项目编辑权限');
      expect(permSvc.assertEditorWithTeam).toHaveBeenCalledWith('p1', 'u1');
      expect(service.enqueueOutpaint).not.toHaveBeenCalled();
    });

    it('erase/redraw 同守卫：拒绝 → service 零调用', async () => {
      permSvc.assertEditorWithTeam.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
      const req = { user: { id: 'u1' } } as any;
      await expect(controller.erase({ projectId: 'p1', nodeId: 'n1', fileId: 'f1', maskFileId: 'm1', stateVector: SV_OK }, req)).rejects.toThrow('无项目编辑权限');
      await expect(controller.redraw({ projectId: 'p1', nodeId: 'n1', fileId: 'f1', maskFileId: 'm1', prompt: 'x', strength: 0.5, stateVector: SV_OK }, req)).rejects.toThrow('无项目编辑权限');
      expect(permSvc.assertEditorWithTeam).toHaveBeenCalledWith('p1', 'u1');
      expect(service.enqueueErase).not.toHaveBeenCalled();
      expect(service.enqueueRedraw).not.toHaveBeenCalled();
    });
  });

  // ══════════ Y2 B1：非画布编辑链 claim 占位（B2d 换受理读槽真值〔裁决 13〕）══════════
  it('Y2 B2d outpaint claim 受理读槽：frozen true + data.mediaId（缺席=null）', async () => {
    const body = { projectId: 'proj1', nodeId: 'node1', fileId: 'file-1', rect: { x: 0, y: 0, width: 64, height: 64 }, imageWidth: 512, imageHeight: 512, stateVector: SV_OK };
    await controller.outpaint(body, { user: { id: 'u1' } } as any);
    expect(intentSvc.claim).toHaveBeenCalledWith(expect.objectContaining({ authorSlotFrozen: true, authorMediaId: 'm-author' }));
  });

  // ══════════ Y2 B2d（裁决 13）：受理回放两档（!created → 同代作废键等值查询——
  //    命中=emit done 不带 fileId 零释放 / 未命中=带 fileId+releaseAuthorSlot 补释放）══════════
  describe('Y2 B2d：!created 受理回放两档', () => {
    const replayBody = {
      projectId: 'proj1',
      nodeId: 'node1',
      fileId: 'file-1',
      rect: { x: 0, y: 0, width: 64, height: 64 },
      imageWidth: 512,
      imageHeight: 512,
      stateVector: SV_OK,
    };

    beforeEach(() => {
      intentSvc.claim.mockResolvedValue({
        created: false,
        intent: { id: 'row-1', intentId: 'i-1', status: 'SUCCEEDED', resultRef: 'media-old', execSeq: 1n },
      });
    });

    it('作废键命中（该代交付已作废）→ emit done 不带 fileId + 零释放 + 零 enqueue（Y3 受理显式结局 outcome=voided 无 resultRef 键）', async () => {
      prismaMock.artifactProjection.findUnique.mockResolvedValueOnce({ artifactId: 'author-void:row-1:1' });
      const req = { user: { id: 'u1' } } as any;
      const result = await controller.outpaint({ ...replayBody, regenToken: 'i-1' }, req);
      expect(service.enqueueOutpaint).not.toHaveBeenCalled();
      expect(prismaMock.artifactProjection.findUnique).toHaveBeenCalledWith({
        where: { artifactId_artifactRev: { artifactId: 'author-void:row-1:1', artifactRev: 0 } },
      });
      expect(emitMock).toHaveBeenCalledWith('proj1', expect.objectContaining({ nodeId: 'node1', status: 'done' }));
      expect(emitMock).not.toHaveBeenCalledWith('proj1', expect.objectContaining({ status: 'done', fileId: expect.anything() }));
      expect(authorSlotMock.releaseAuthorSlot).not.toHaveBeenCalled();
      expect(result).toEqual({ replayed: true, outcome: 'voided' });
      expect('resultRef' in (result as Record<string, unknown>)).toBe(false);
    });

    it('作废键未命中（正常成功交付）→ emit done 带 fileId + releaseAuthorSlot 补释放（Y3 受理显式结局 outcome=delivered）', async () => {
      prismaMock.artifactProjection.findUnique.mockResolvedValueOnce(null);
      const req = { user: { id: 'u1' } } as any;
      const result = await controller.outpaint({ ...replayBody, regenToken: 'i-1' }, req);
      expect(authorSlotMock.releaseAuthorSlot).toHaveBeenCalledWith('proj1', 'row-1');
      expect(emitMock).toHaveBeenCalledWith('proj1', expect.objectContaining({ status: 'done', fileId: 'media-old' }));
      expect(service.enqueueOutpaint).not.toHaveBeenCalled();
      expect(result).toEqual({ replayed: true, outcome: 'delivered', resultRef: 'media-old' });
    });
  });

  // ══════════ Y3 Task3（受理显式结局——controller ruling ⑨）：runGuarded 三档返回形状 ══════════
  describe('Y3 Task3：受理显式结局（shared AdmissionOutcome——三档形状，先红）', () => {
    const body = {
      projectId: 'proj1',
      nodeId: 'node1',
      fileId: 'file-1',
      rect: { x: 0, y: 0, width: 64, height: 64 },
      imageWidth: 512,
      imageHeight: 512,
      stateVector: SV_OK,
    };

    it('新建受理：return {...r, replayed:false, intentId, execSeq}——execSeq=intent.execSeq.toString()', async () => {
      const req = { user: { id: 'u1' } } as any;
      const result: any = await controller.outpaint(body, req);
      expect(result).toMatchObject({ replayed: false, intentId: 'i-1', execSeq: '1' });
      expect(result.jobId).toBe('job-outpaint-1');   // 既有入队字段保留
    });

    it('交付重放：return {replayed:true, outcome:"delivered", resultRef}', async () => {
      prismaMock.artifactProjection.findUnique.mockResolvedValueOnce(null);   // 作废键未命中=正常交付档
      intentSvc.claim.mockResolvedValue({
        created: false,
        intent: { id: 'row-1', intentId: 'i-1', execSeq: 1n, status: 'SUCCEEDED', resultRef: 'media-old' },
      });
      const req = { user: { id: 'u1' } } as any;
      const result: any = await controller.outpaint({ ...body, regenToken: 'i-1' }, req);
      expect(result).toEqual({ replayed: true, outcome: 'delivered', resultRef: 'media-old' });
    });

    it('作废重放：return {replayed:true, outcome:"voided"}——对象上没有 resultRef 键', async () => {
      prismaMock.artifactProjection.findUnique.mockResolvedValueOnce({ artifactId: 'author-void:row-1:1' });   // 作废键命中
      intentSvc.claim.mockResolvedValue({
        created: false,
        intent: { id: 'row-1', intentId: 'i-1', execSeq: 1n, status: 'SUCCEEDED', resultRef: 'media-old' },
      });
      const req = { user: { id: 'u1' } } as any;
      const result: any = await controller.outpaint({ ...body, regenToken: 'i-1' }, req);
      expect(result).toEqual({ replayed: true, outcome: 'voided' });
      expect('resultRef' in result).toBe(false);
    });
  });
});
