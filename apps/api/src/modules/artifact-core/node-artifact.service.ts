// apps/api/src/modules/artifact-core/node-artifact.service.ts —— Y1a+Y1b T10（spec Z18''-v14）：
// NodeArtifact=生成产物唯一权威（PG；doc fileId/result 的唯一写入源经投影）的 CAS 原语三用
// ——finalize（generated）/replaceMedia/clearMedia（T11 命令）共用 `WHERE rev=expectedRev` 单点：
// claimCapture 在 claim 事务内读槽位当前 rev 作 expectedRev；casUpsert 匹配即 rev+1+mediaId/
// resultText/state/source 锚覆写，0 行=superseded（生成在飞用户 replace/新代）——不更新不投影、
// 资金独立判归 ArtifactCommitService（本服务零资金零投影职责）。
// 实现纪律：PG 侧一律 ON CONFLICT 条件写（$executeRaw 受影响行数判胜负）——禁事务内 catch 驱动
// P2002 再查（事务一报错即 aborted 再查 25P02——claimTx 头注纪律；ON CONFLICT DO UPDATE 带 WHERE
// 不满足时受影响行数=0 非错误，天然规避该面）。
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

/** T10 槽位 targetField 单源（claim 捕获与 finalize 写侧共用）：image/edit/lighting/video→fileId
 *  （doc data.fileId=mediaId——前端 ImageGenNode/VideoGenNode 本就走 useMediaUrl(fileId)）；
 *  text→result（doc data.result=resultText）。 */
export function targetFieldOfKind(kind: string): 'fileId' | 'result' {
  return kind === 'text' ? 'result' : 'fileId';
}

/** 槽位坐标（槽位唯一键 [projectId,nodeId,role,targetField,targetItemId] 的应用层形态）。 */
export interface ArtifactSlot {
  projectId: string;
  nodeId: string;
  targetField: 'fileId' | 'result';
  role?: string;
  targetItemId?: string;
}

export function slotUniqueWhere(slot: ArtifactSlot) {
  return {
    projectId_nodeId_role_targetField_targetItemId: {
      projectId: slot.projectId,
      nodeId: slot.nodeId,
      role: slot.role ?? 'primary',
      targetField: slot.targetField,
      targetItemId: slot.targetItemId ?? '',
    },
  };
}

export interface CasUpsertParams extends ArtifactSlot {
  teamId: string;
  /** claim 时捕获的槽位 rev（无行=0——首代以 INSERT 分支胜出）。 */
  expectedRev: number;
  source: 'generated' | 'replace';
  state: 'none' | 'materializing' | 'stored' | 'failed';
  mediaId?: string | null;
  resultText?: string | null;
  /** 资金/代际锚（finalize 幂等键 @@unique([sourceIntentRowId,sourceExecSeq,artifactIndex]) 的写侧）。 */
  sourceIntentRowId?: string | null;
  sourceExecSeq?: bigint | null;
  artifactIndex?: number;
}

export interface CasUpsertResult {
  won: boolean;
  artifactId: string;
  /** 胜者=新 rev（expectedRev+1）；败者=槽位当前 rev（superseded 投影行锚——ArtifactProjection.artifactRev）。 */
  rev: number;
  mediaId?: string;
}

@Injectable()
export class NodeArtifactService {
  /** claimCapture（T10）：claim 事务内读槽位当前 rev 作 expectedRev——PG 权威非 doc
   *  （v14 裁决①推翻 fileIdRev：rev 在 exec 仍是 Y.Map 可被客户端写/离线合并）。无行=0。 */
  async claimCapture(tx: Prisma.TransactionClient, slot: ArtifactSlot): Promise<number> {
    const row = await tx.nodeArtifact.findUnique({
      where: slotUniqueWhere(slot),
      select: { rev: true },
    });
    return row?.rev ?? 0;
  }

  /** CAS 原语（三用共用）：INSERT（无槽位行——rev=expectedRev+1）∨ ON CONFLICT DO UPDATE
   *  WHERE "NodeArtifact"."rev"=expectedRev（匹配→rev+1+产物值覆写）；WHERE 不满足=受影响 0 行
   *  =superseded（不更新不覆盖用户值）。胜/败后均回读槽位行（artifactId/rev——投影行锚）。 */
  async casUpsert(tx: Prisma.TransactionClient, p: CasUpsertParams): Promise<CasUpsertResult> {
    const role = p.role ?? 'primary';
    const targetItemId = p.targetItemId ?? '';
    const artifactIndex = p.artifactIndex ?? 0;
    const nextRev = p.expectedRev + 1;
    const affected = await tx.$executeRaw`
      INSERT INTO "NodeArtifact" (
        "id", "projectId", "nodeId", "teamId", "role", "targetField", "targetItemId",
        "mediaId", "resultText", "source", "sourceIntentRowId", "sourceExecSeq", "artifactIndex",
        "state", "rev", "createdAt", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${p.projectId}, ${p.nodeId}, ${p.teamId}, ${role}, ${p.targetField}, ${targetItemId},
        ${p.mediaId ?? null}, ${p.resultText ?? null}, ${p.source}, ${p.sourceIntentRowId ?? null},
        ${p.sourceExecSeq ?? null}, ${artifactIndex},
        ${p.state}::"ArtifactState", ${nextRev}, (now() AT TIME ZONE 'utc'), (now() AT TIME ZONE 'utc')
      )
      ON CONFLICT ("projectId", "nodeId", "role", "targetField", "targetItemId")
      DO UPDATE SET
        "mediaId" = EXCLUDED."mediaId",
        "resultText" = EXCLUDED."resultText",
        "source" = EXCLUDED."source",
        "sourceIntentRowId" = EXCLUDED."sourceIntentRowId",
        "sourceExecSeq" = EXCLUDED."sourceExecSeq",
        "artifactIndex" = EXCLUDED."artifactIndex",
        "state" = EXCLUDED."state",
        "rev" = "NodeArtifact"."rev" + 1,
        "updatedAt" = (now() AT TIME ZONE 'utc')
      WHERE "NodeArtifact"."rev" = ${p.expectedRev}`;
    const row = await tx.nodeArtifact.findUnique({
      where: slotUniqueWhere({ projectId: p.projectId, nodeId: p.nodeId, targetField: p.targetField, role, targetItemId }),
      select: { id: true, rev: true, mediaId: true },
    });
    if (!row) {
      // 不可达（INSERT/UPDATE 两分支后行必在）——防御态：以 0 行败者语义上抛（禁静默编 rev）
      throw new Error(`NODE_ARTIFACT_SLOT_LOST: slot 读回灭失 projectId=${p.projectId} nodeId=${p.nodeId}`);
    }
    return { won: affected === 1, artifactId: row.id, rev: row.rev, mediaId: row.mediaId ?? undefined };
  }
}
