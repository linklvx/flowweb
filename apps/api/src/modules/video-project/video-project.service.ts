// apps/api/src/modules/video-project/video-project.service.ts
import { Injectable, Inject, ConflictException, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { ExecutionService } from '../execution/execution.service';

@Injectable()
export class VideoProjectService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(CollabDocumentService) private readonly collab: CollabDocumentService,
    @Inject(ExecutionService) private readonly execution: ExecutionService, // Task 11 regenerate 用——签名一次到位，避免 Task 11 中途改构造器
  ) {}

  /** 默认工程缺省（与前端 shared createDefaultProjectData 同构：1 视频+1 字幕+2 音频）。
   *  不能值 import @flowweb/shared——纯 TS 源码包 barrel 无扩展名相对导入，Node ESM 运行时解析失败（见 admin.guard.ts 注释）；
   *  前端 upsert 会显式传 data，此处仅为 API 直调方的防御缺省（Plan 2 浏览器验收发现原字面量 tracks:[] 与 spec 默认轨脱节） */
  private static defaultProjectData(): object {
    const track = (type: 'video' | 'subtitle' | 'audio', name: string) =>
      ({ id: `track-${crypto.randomUUID()}`, type, name, muted: false, hidden: false, clips: [] });
    return { version: 1, fps: 30, tracks: [track('video', '视频'), track('subtitle', '字幕1'), track('audio', '音频1'), track('audio', '音频2')], clips: {} };
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
   * A1 影子节点克隆生成：
   * 1. readCanvas 找 sourceNode → JSON 整份深拷 data（禁止字段挑拣——取词链 content 优先/prompt 嵌套）
   * 2. insertNode 影子（shadow- 前缀 + __ephemeral 判据——前端 onRemote 以此短路防 applyDocToStore
   *    全量重建闪烁；origin 不过网已实测，见 Task 9 跨端用例）
   * 3. 服务端直调 execute（不走 HTTP、不带 x-yjs-sv——sv 裁剪会让影子不可见）
   * 4. 不在此删影子：done 事件经 socket 回流后由前端读 data 取 fileId 再调 removeNodeByShadow
   */
  async regenerate(userId: string, dto: { sourceNodeId: string; workflowId: string; kind: 'video' | 'audio' }) {
    await this.perm.assertEditor(dto.workflowId, userId);
    const canvas = await this.collab.readCanvas(dto.workflowId);
    const src = (canvas.nodes as any[]).find(n => n.id === dto.sourceNodeId);
    const wantType = dto.kind === 'video' ? 'videoGen' : 'audioGen';
    if (!src || src.type !== wantType) throw new BadRequestException('source node not found or kind mismatch');
    const shadowId = `shadow-${dto.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const clonedData = JSON.parse(JSON.stringify(src.data ?? {})); // 整份深拷（Yjs toJSON 即 JSON 语义）
    clonedData.__ephemeral = true;
    await this.collab.insertNode(dto.workflowId, {
      id: shadowId, type: wantType,
      position: { x: -99999, y: -99999 }, // 次保险：主判据是 shadow- 前缀+__ephemeral（store 投影与渲染层双重过滤），position 仅让万一漏过滤的渲染远离视口
      data: clonedData,
    });
    const result = await this.execution.execute(dto.workflowId, shadowId, userId); // 直调，无 sv
    return { shadowNodeId: shadowId, result };
  }

  /** 前端 done 回流后调用：删影子节点（重复删 no-op 安全） */
  async removeShadow(userId: string, dto: { workflowId: string; shadowNodeId: string }) {
    await this.perm.assertEditor(dto.workflowId, userId);
    if (!dto.shadowNodeId.startsWith('shadow-')) throw new BadRequestException('shadowNodeId 必须以 shadow- 前缀命名'); // 防借道：底层 removeNode 是任意节点原语，端点语义仅限影子
    await this.collab.removeNode(dto.workflowId, dto.shadowNodeId);
    return { ok: true };
  }
}
