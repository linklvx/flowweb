// apps/api/src/modules/video-project/video-project.service.ts
import { Injectable, Inject, ConflictException, BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { ExecutionService } from '../execution/execution.service';
import { StorageQuotaService } from '../team/storage-quota.service'; // 实际在 team/ 模块（TeamModule 已 export，与 generated-media.service 同款引法）

@Injectable()
export class VideoProjectService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(CollabDocumentService) private readonly collab: CollabDocumentService,
    @Inject(ExecutionService) private readonly execution: ExecutionService, // Task 11 regenerate 用——签名一次到位，避免 Task 11 中途改构造器
    @Inject(StorageQuotaService) private readonly quota: StorageQuotaService, // Task 5 exportPrecheck 配额预检
  ) {}

  /** 默认工程缺省（与前端 shared createDefaultProjectData 同构：单条空视频轨，其余轨道随素材动态创建——spec 勘误③）。
   *  @flowweb/shared 已真构建（R1a：main→dist CJS）——生产源码值导入自 R1a 起合法，dist 陈旧时 dev/build/test 首段内联的 check-shared-dist 会拦（勿删内联段；见 admin.guard.ts 注释）；
   *  前端 upsert 会显式传 data，此处仅为 API 直调方的防御缺省（Plan 2 浏览器验收发现原字面量 tracks:[] 与 spec 默认轨脱节） */
  private static defaultProjectData(): object {
    return {
      version: 1, fps: 30,
      tracks: [{ id: `track-${crypto.randomUUID()}`, type: 'video', name: '视频', muted: false, hidden: false, clips: [] }],
      clips: {},
    };
  }

  /** upsert by sourceNodeId（@unique）——幂等防双击；update 分支同样全量返回；
   *  teamId 服务端从 workflowId 派生（assertEditor 只验 workflow 编辑权不验 teamId 归属——客户端传 teamId 会造不一致脏行） */
  async upsertByNode(input: { workflowId: string; sourceNodeId: string; userId: string; title: string; data?: unknown }) {
    await this.perm.assertEditor(input.workflowId, input.userId);
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: input.workflowId },
      select: { teamId: true },
    });
    if (!project) throw new BadRequestException('项目不存在'); // 显式抛错（与 Task 10 register 统一）——防 assertEditor 契约变更时 project! 静默 TypeError
    const existing = await this.prisma.videoProject.findUnique({ where: { sourceNodeId: input.sourceNodeId } });
    if (existing && existing.workflowId !== input.workflowId) {
      throw new ForbiddenException('sourceNodeId 已属于其他画布'); // 归属校验——nodeId 全局唯一键下防跨画布读/抢占
    }
    return this.prisma.videoProject.upsert({
      where: { sourceNodeId: input.sourceNodeId },
      create: {
        teamId: project.teamId, userId: input.userId, workflowId: input.workflowId,
        sourceNodeId: input.sourceNodeId, title: input.title,
        data: (input.data ?? VideoProjectService.defaultProjectData()) as object,
      },
      update: {}, // 已存在则原样返回全量（title/data 不动——编辑器加载用）
    });
  }

  async getByNode(sourceNodeId: string, userId: string) {
    const proj = await this.prisma.videoProject.findUnique({ where: { sourceNodeId } });
    if (!proj) return null;
    await this.perm.assertEditor(proj.workflowId, userId);
    return proj;
  }

  /** PATCH 单飞配合：乐观锁 baseUpdatedAt ≠ 库内值 → 409 */
  async patch(id: string, userId: string, dto: { data: object; baseUpdatedAt: string }) {
    const proj = await this.prisma.videoProject.findUnique({ where: { id } });
    if (!proj) throw new NotFoundException('project not found'); // 404 语义——409 留给版本冲突（前端可静默停止自动保存）
    await this.perm.assertEditor(proj.workflowId, userId);
    if (proj.updatedAt.getTime() !== new Date(dto.baseUpdatedAt).getTime()) {
      throw new ConflictException('project modified elsewhere');
    }
    return this.prisma.videoProject.update({ where: { id }, data: { data: dto.data as object } });
  }

  async deleteByNode(sourceNodeId: string, userId: string) {
    const proj = await this.prisma.videoProject.findUnique({ where: { sourceNodeId } });
    if (!proj) return;
    await this.perm.assertEditor(proj.workflowId, userId);
    await this.prisma.videoProject.delete({ where: { sourceNodeId } });
  }

  /**
   * 批5-1 retake 直连真实节点（落点 B——影子信箱删除）：
   * 1. readCanvas 校验 sourceNode 类型（video→videoGen / audio→audioGen）
   * 2. 直调 execute 的 nodeIds 模式（scope 恰为目标自身——nodeId 模式 getScope 是"上游闭包+自身"，
   *    会连带重执行上游=重复扣费，且 retakeId 落首个 exec 节点（最上游）而非目标——批5 评审 H1 根堵；
   *    上游产物仍可读：nodeIds 模式 collectUpstreamData 用全量节点注入 prompt）
   * 3. retakeId 客户端生成（E0）透传 execute 作 regenToken（目标节点是唯一 exec 节点=token 归属处）——
   *    Y0b-2 T6 语义重定位：retakeId=手势 token（Z79——重拍=生成性重跑，error 后同 token 免费重试，
   *    成功后 web 轮换；同 token 重放由 claim 层幂等 SUCCEEDED → created:false 零外呼零扣费回放产物）。
   *    DTO 字段名 retakeId 保持（dto.spec:41 红测锚不动）。
   * 4. 产物落地不在本方法：Media.create/writeNodeData(fileId)/emitNodeStatus 由 execute→ai-download
   *    既有链在真实节点上完成（服务层重复落地=双 Media 行）
   */
  async regenerate(userId: string, dto: { sourceNodeId: string; workflowId: string; kind: 'video' | 'audio'; retakeId: string }) {
    await this.perm.assertEditor(dto.workflowId, userId);
    // Y0a-3（§3.2 语义读）：regenerate 校验读同 execution 计费读分型——租约失守/drain→503 fail-closed
    // （V21 对象响应体；Retry-After 由 collab-not-serving.filter.ts 统一落）。
    if (!this.collab.isLeaseServing())
      throw new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'collab not serving' });
    const canvas = await this.collab.readCanvas(dto.workflowId);
    const src = (canvas.nodes as any[]).find(n => n.id === dto.sourceNodeId);
    const wantType = dto.kind === 'video' ? 'videoGen' : 'audioGen';
    if (!src || src.type !== wantType) throw new BadRequestException('source node not found or kind mismatch');
    const result = await this.execution.execute(dto.workflowId, undefined, userId, [dto.sourceNodeId], undefined, dto.retakeId);
    return { retakeId: dto.retakeId, result };
  }

  /** 导出前置配额预检——编码数分钟前拦截，避免上传时 4xx；只读不建 Media（落库留给 generated-media.register） */
  async exportPrecheck(userId: string, dto: { workflowId: string; estimatedSize: number }): Promise<{ ok: true }> {
    // 先鉴权再查库（防未授权存在性探测）
    await this.perm.assertEditor(dto.workflowId, userId); // 参数序 (projectId, userId)
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: dto.workflowId },
      select: { teamId: true },
    });
    if (!project) throw new NotFoundException('画布不存在');
    await this.quota.assertCanUpload(project.teamId, dto.estimatedSize); // teamId 服务端从 workflowId 派生（与 register 同款）
    return { ok: true };
  }
}
