import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import * as Y from 'yjs';
import { CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { FolderService } from '../folder/folder.service';
import { TemplateService } from '../template/template.service';
import { TeamService } from '../team/team.service';
import { assertTeamMember } from '../team/team.util';
import { createCanvasDoc } from '../collab/canvas-doc.factory';
import { ensureCanvasDocHead } from '../collab/canvas-doc-genesis';

@Injectable()
export class CanvasService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FolderService) private readonly folderService: FolderService,
    @Inject(TemplateService) private readonly templateService: TemplateService,
    @Inject(TeamService) private readonly teamService: TeamService,
  ) {}

  async create(name: string, folderId: string | null, userId: string, teamId?: string) {
    let teamIdResolved: string;
    if (teamId) {
      await assertTeamMember(this.prisma, teamId, userId);
      teamIdResolved = teamId;
    } else {
      teamIdResolved = (await this.teamService.ensureDefaultTeam(userId)).id;
    }
    if (folderId) {
      const folder = await this.prisma.folder.findFirst({ where: { id: folderId, teamId: teamIdResolved } });
      if (!folder) throw new BadRequestException('目标文件夹不存在');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      let finalName = name;
      if (!name?.trim()) {
        // 同团队并发空名创建串行化，消除编号 read-modify-write 竞态；事务结束自动释放
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'canvas_untitled:' + teamIdResolved}))`;
        finalName = await CanvasService.nextUntitledName(tx, teamIdResolved);
      }
      const project = await tx.canvasProject.create({
        data: { name: finalName, userId, teamId: teamIdResolved },
      });
      const template = await tx.template.create({
        data: { name: finalName, userId, teamId: teamIdResolved, projectId: project.id, folderId },
      });
      // Y1c T7（勘误方案 B·Controller 裁定 4）：genesis 双路之二——本路径原先不建 CanvasDoc 行
      // （doc 懒建于 loadDocument）；现同事务补建头集（空种子=[0,0] 合法空 update 字节——不破坏
      // 旧装载对行的容忍语义：行在 state=合法 update 与行缺 state=null 两态装载结果等价）。
      // SystemHistory 缺失/为零=fail-closed 整事务回滚（无 Template 半建）。
      const seed = createCanvasDoc();
      await ensureCanvasDocHead(tx, project.id, Buffer.from(Y.encodeStateAsUpdate(seed)));
      seed.destroy();
      return { templateId: template.id, projectId: project.id, name: finalName, teamId: teamIdResolved };
    });
    this.templateService.clearCache();
    if (folderId) await this.folderService.touch([folderId]);
    // Y0b-5 T5：世代可见通道随行（与 GET /projects/:id 同族）——本事务建头集（T7 genesis
    // ensureCanvasDocHead）⇒ 确定性 0 代；新建路径首会话同享四维缓存键通道（fail-closed 不误伤）
    return {
      ...result,
      collabGeneration: 0,
      collabSchemaVersion: CANVAS_DOC_SCHEMA_VERSION,
      collabViewerUid: userId,
    };
  }

  async getNextUntitledName(userId: string, teamId?: string): Promise<string> {
    const resolved = teamId ?? (await this.teamService.ensureDefaultTeam(userId)).id;
    if (teamId) await assertTeamMember(this.prisma, teamId, userId);
    return CanvasService.nextUntitledName(this.prisma, resolved);
  }

  private static async nextUntitledName(db: { template: { findMany: (args: {
    where: { teamId: string };
    select: { name: true };
  }) => Promise<{ name: string }[]> } }, teamId: string): Promise<string> {
    const templates = await db.template.findMany({ where: { teamId }, select: { name: true } });
    let max = 0;
    for (const t of templates) {
      const m = /^画布(\d+)$/.exec(t.name);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `画布${max + 1}`;
  }
}
