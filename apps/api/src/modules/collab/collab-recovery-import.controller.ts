// apps/api/src/modules/collab/collab-recovery-import.controller.ts
// Y1c T25（spec §3.2/§4.5）：POST /api/collab/doc/:projectId/recovery-import——DraftEnvelope
// 恢复导入端点（client→server 大差量恢复唯一接受路径）。鉴权=全局 AuthGuard（JWT 会话面）+
// ProjectPermissionService.assertEditor（OWNER/EDITOR——「仅本人 draft」锚定=envelope.projectId
// 必须等于路由项目〔service 校验〕）。载荷上限=DRAFT_ENVELOPE_MAX_BYTES（8MiB——原始请求体
// 字节计非重序列化；超限 413 导出文件 fail-closed）。**不 @SkipThrottle**——用户面端点吃共享
// 限速桶（恢复导入限速=默认 throttler；worker 内部端点才豁免先例）。
import { BadRequestException, Body, Controller, Inject, Param, PayloadTooLargeException, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DRAFT_ENVELOPE_MAX_BYTES, type DraftEnvelope, type NodeIdConflictPolicy } from '@flowweb/shared';
import { CollabRecoveryImportService } from './collab-recovery-import.service';
import { ProjectPermissionService } from '../team/project-permission.service';


@Controller('api/collab/doc')
export class CollabRecoveryImportController {
  constructor(
    @Inject(CollabRecoveryImportService) private readonly recovery: CollabRecoveryImportService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
  ) {}

  @Post(':projectId/recovery-import')
  async recoveryImport(
    @Param('projectId') projectId: string,
    @Req() req: Request,
    // R0d② 棘轮：@Body 禁 inline/DTO-无-pipe——unknown 收参+下方运行时形状校验（write-batch 同纪律）
    @Body() body: unknown,
  ): Promise<ReturnType<CollabRecoveryImportService['importEnvelope']>> {
    const userId = (req as { user?: { id?: string } }).user?.id ?? '';
    await this.perm.assertEditor(projectId, userId);   // OWNER/EDITOR 门（VIEWER 403）
    const b = body as { envelope?: unknown; conflictChoices?: unknown; deletionNodeIds?: unknown };
    if (body === null || typeof body !== 'object' || Array.isArray(body)
      || typeof b.envelope !== 'object' || b.envelope === null || Array.isArray(b.envelope)) {
      throw new BadRequestException({ code: 'RECOVERY_IMPORT_BAD_BODY', message: 'body 须为 { envelope: DraftEnvelope, conflictChoices?: Record<nodeId, \'skip\'|\'replace\'>, deletionNodeIds?: string[] }' });
    }
    // 原始载荷字节上限（8MiB——超限 fail-closed：导出文件路径，禁截断禁导入）
    const rawBytes = Number(req.headers['content-length'] ?? 0);
    if (rawBytes > DRAFT_ENVELOPE_MAX_BYTES + 4_096) {   // 包壳容差（JSON 键名/conflictChoices 面）
      throw new PayloadTooLargeException({ code: 'RECOVERY_IMPORT_TOO_LARGE', message: `请求体 ${rawBytes}B 超限——导出文件+fail-closed（envelope 上限 ${DRAFT_ENVELOPE_MAX_BYTES}B）` });
    }
    return this.recovery.importEnvelope(
      projectId,
      userId,
      b.envelope as DraftEnvelope,
      b.conflictChoices as Record<string, NodeIdConflictPolicy> | undefined,
      rawBytes || undefined,
      b.deletionNodeIds as string[] | undefined,   // T25b 收口 I-3：B 场景删除确认 typed REST 承载
    );
  }
}
