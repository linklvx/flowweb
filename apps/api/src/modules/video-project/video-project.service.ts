// apps/api/src/modules/video-project/video-project.service.ts
import { Injectable, Inject, BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CollabWritePort } from '../collab/collab-write.port';
import { ExecutionService } from '../execution/execution.service';
import { StorageQuotaService } from '../team/storage-quota.service'; // 实际在 team/ 模块（TeamModule 已 export，与 generated-media.service 同款引法）

// Y4a T8（spec §0 条 9）：VideoProject 表整删——upsertByNode/getByNode/patch/deleteByNode/
// defaultProjectData 随 REST autosave 链退场（时间轴数据面迁画布 doc timelines 根）。
// 留存 regenerate/exportPrecheck 均零依赖表（regenerate 读 doc；exportPrecheck teamId 从
// CanvasProject 派生）。
@Injectable()
export class VideoProjectService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(CollabWritePort) private readonly collab: CollabWritePort,
    @Inject(ExecutionService) private readonly execution: ExecutionService, // Task 11 regenerate 用——签名一次到位，避免 Task 11 中途改构造器
    @Inject(StorageQuotaService) private readonly quota: StorageQuotaService, // Task 5 exportPrecheck 配额预检
  ) {}

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
   * 4. 产物落地不在本方法：Media 行/writeNodeData(fileId)/WS 通知 由 execute→artifactCommit（Y3 T8：通知面已随 /execution 退役删除——本行注记归档）
   *    （T12 video=finalizeVideo+MaterializeJob 异步物化）既有链在真实节点上完成（服务层重复落地=双 Media 行）
   */
  async regenerate(userId: string, dto: { sourceNodeId: string; workflowId: string; kind: 'video' | 'audio'; retakeId: string }) {
    await this.perm.assertEditor(dto.workflowId, userId);
    // Y0a-3（§3.2 语义读）：regenerate 校验读同 execution 计费读分型——租约失守/drain→503 fail-closed
    // （V21 对象响应体；Retry-After 由 collab-not-serving.filter.ts 统一落）。
    if (!this.collab.isLeaseServing())
      throw new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'collab not serving' });
    const canvas = await this.collab.readCanvas(dto.workflowId);
    const src = canvas.nodes.find(n => n.id === dto.sourceNodeId);   // Y1c T19：CanvasReadModel 直面
    const wantType = dto.kind === 'video' ? 'videoGen' : 'audioGen';
    if (!src || src.type !== wantType) throw new BadRequestException('source node not found or kind mismatch');
    // Y0b-2 T7：execute sv 形参删除——retake 直调零客户端状态（SV 门覆盖面=四受理端点，进程内直调豁免：
    // 执行输入全部由服务端从 doc 读出，客户端未同步内容不参与判定——既成事实进偏离表）
    const result = await this.execution.execute(dto.workflowId, undefined, userId, [dto.sourceNodeId], dto.retakeId);
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
    await this.quota.assertCanUpload(project.teamId, dto.estimatedSize); // teamId 服务端从 workflowId 派生（与 register 同款——Y4a T8 后零依赖 VideoProject 表）
    return { ok: true };
  }
}
