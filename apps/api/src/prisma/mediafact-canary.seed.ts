// apps/api/src/prisma/mediafact-canary.seed.ts —— C2-5（地基修复批·C2 卡，spec
// 2026-11-11-foundation-batch-design.md §3.1-5）：MediaFact 观测事实金丝雀——synthetic 专用
// user/team/media/fact 行（幂等 upsert 固定 id，platform-team.seed 同款；**不污染生产媒体**——
// canary team 行对真实团队查询不可见〔facts 端点按 teamId 过滤〕）。
// 资产清单+清理责任+生产只读断言语义=runbook §14.2（dev=seed 注入随 reset 重建；生产**不 seed**，
// canary 只读断言 metrics 端点指标存在——不写生产数据）。
// canary 形态（惰性行——零 worker/GC 触碰）：media status=completed（不进 unfinished 健康口径）+
// type=uploaded（materialize 只 claim generated）+sniffedMimeType 恒 NULL（probe 只 claim sniffed
// image/video）+expiresAt NULL（retention 不收）。updatedAt=seed 时点且幂等重跑不动（update:{}——
// canary 行龄锚单调增长，age 断言窗=〔now−seededAt,∞〕的 gauge 下界锚）。
import type { PrismaClient } from '@prisma/client';

/** 固定 id 三件+对象键（canary- 前缀命名=防误清理误判的显式标记）。 */
export const MEDIA_FACT_CANARY_USER_ID = 'canary-mediafact-user';
export const MEDIA_FACT_CANARY_TEAM_ID = 'canary-mediafact-team';
export const MEDIA_FACT_CANARY_MEDIA_ID = 'canary-mediafact-media';
export const MEDIA_FACT_CANARY_OBJECT_KEY = 'canary/mediafact-age-probe.bin';

/** 幂等注入：重复 seed 不炸（固定 id upsert）且不动已建 canary 行（行龄锚保真）。 */
export async function seedMediaFactCanary(prisma: PrismaClient): Promise<void> {
  await prisma.user.upsert({
    where: { id: MEDIA_FACT_CANARY_USER_ID },
    update: {},
    create: { id: MEDIA_FACT_CANARY_USER_ID, name: 'MediaFact Canary', email: 'canary-mediafact@flowweb.local', emailVerified: false },
  });
  await prisma.team.upsert({
    where: { id: MEDIA_FACT_CANARY_TEAM_ID },
    update: { isDefault: false },   // 承重：isDefault=true 会走「默认团队回退」面（platform-team 同款防御）
    create: { id: MEDIA_FACT_CANARY_TEAM_ID, name: 'canary-mediafact-观测团队（勿删——runbook §14.2）', ownerId: MEDIA_FACT_CANARY_USER_ID, status: 'ACTIVE', isDefault: false },
  });
  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: MEDIA_FACT_CANARY_TEAM_ID, userId: MEDIA_FACT_CANARY_USER_ID } },
    update: { role: 'OWNER' },
    create: { teamId: MEDIA_FACT_CANARY_TEAM_ID, userId: MEDIA_FACT_CANARY_USER_ID, role: 'OWNER' },
  });
  await prisma.media.upsert({
    where: { id: MEDIA_FACT_CANARY_MEDIA_ID },
    update: {},
    create: {
      id: MEDIA_FACT_CANARY_MEDIA_ID,
      userId: MEDIA_FACT_CANARY_USER_ID, teamId: MEDIA_FACT_CANARY_TEAM_ID,
      bucket: 'flowai', key: MEDIA_FACT_CANARY_OBJECT_KEY,
      originalName: 'canary-mediafact-age-probe.bin', mimeType: 'application/octet-stream', size: 0n,
      type: 'uploaded', status: 'completed', factVersion: 1n,
    },
  });
  const seededAt = new Date();
  await prisma.mediaFact.upsert({
    where: { mediaId_factType: { mediaId: MEDIA_FACT_CANARY_MEDIA_ID, factType: 'state' } },
    update: {},   // 重跑不动行——canary 行龄锚（updatedAt）保真
    create: { mediaId: MEDIA_FACT_CANARY_MEDIA_ID, factType: 'state', factVersion: 1n, payload: { status: 'completed' }, updatedAt: seededAt },
  });
  await prisma.mediaFact.upsert({
    where: { mediaId_factType: { mediaId: MEDIA_FACT_CANARY_MEDIA_ID, factType: 'natural' } },
    update: {},
    create: { mediaId: MEDIA_FACT_CANARY_MEDIA_ID, factType: 'natural', factVersion: 1n, payload: { naturalWidth: 1, naturalHeight: 1 }, updatedAt: seededAt },
  });
}
