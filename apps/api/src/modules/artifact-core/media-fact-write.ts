// apps/api/src/modules/artifact-core/media-fact-write.ts —— C2-2（地基修复批·C2 卡）
// MediaFact 当前态写双函数纪律（spec 2026-11-11-foundation-batch-design.md §3.1-2，第七轮 P0-2 防双递增）：
// ①upsertMediaFactInTx：**已 increment 路径专用**（confirm/completeRegistered/doneNatural/materialize
//   完成·终态——各自主 UPDATE 已 factVersion+1，调用方**事务内读回真实递增值**传入；本函数零递增）。
// ②bumpFactVersionAndUpsert：**仅无 increment 路径用**（registerInTx 新行/probe 终态失败）——
//   UPDATE factVersion+1 RETURNING 读回后以该值 upsert（递增单源在本函数内）。
// 禁对已 increment 路径调 ②（恰多 +1 的版本错位——负控钉 media-fact-write.int.spec）。
// 共用 upsert：ON CONFLICT (mediaId,factType) DO UPDATE ... WHERE EXCLUDED.factVersion > 当前行——
// 单调门吞旧版本（wire mergeFactRows 同语义）；updatedAt=Date 参数绑定（tsz(3) instant 正确——批序
// 纪律「C2/C3a 开发期时间写法=Date 参数绑定」）；payload=JSON.stringify(...)::jsonb（raw 路径绑定法）。
import { Prisma } from '@prisma/client';

/** factType 词表=schema CHECK IN ('state','natural')（DB 约束兜底——词表外值 INSERT 即拒）。 */
export type MediaFactType = 'state' | 'natural';

export interface UpsertMediaFactParams {
  mediaId: string;
  factType: MediaFactType;
  /** 调用方事务内读回的真实递增后版本（禁预读+1 猜测——CAS 写回后同事务读，行锁下精确）。 */
  factVersion: bigint;
  payload: Prisma.InputJsonValue;
  now: Date;
}

/** ①已 increment 路径的 fact 落行（零递增——版本源=调用方主 UPDATE）。 */
export async function upsertMediaFactInTx(tx: Prisma.TransactionClient, p: UpsertMediaFactParams): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "MediaFact" ("mediaId", "factType", "factVersion", "payload", "updatedAt")
    VALUES (${p.mediaId}, ${p.factType}, ${p.factVersion}, ${JSON.stringify(p.payload)}::jsonb, ${p.now})
    ON CONFLICT ("mediaId", "factType") DO UPDATE SET
      "factVersion" = EXCLUDED."factVersion",
      "payload" = EXCLUDED."payload",
      "updatedAt" = EXCLUDED."updatedAt"
    WHERE EXCLUDED."factVersion" > "MediaFact"."factVersion"`;
}

/** ②无 increment 路径的递增+落行（递增单源在此——RETURNING 读回真实值再以该值 upsert）。 */
export async function bumpFactVersionAndUpsert(
  tx: Prisma.TransactionClient,
  mediaId: string,
  factType: MediaFactType,
  payload: Prisma.InputJsonValue,
): Promise<void> {
  const rows = await tx.$queryRaw<{ factVersion: bigint }[]>`
    UPDATE "Media" SET "factVersion" = "factVersion" + 1 WHERE "id" = ${mediaId} RETURNING "factVersion"`;
  if (rows.length !== 1) throw new Error(`MEDIA_FACT_BUMP_MISS: mediaId=${mediaId} 行不存在（零递增零 fact）`);
  await upsertMediaFactInTx(tx, {
    mediaId, factType, factVersion: rows[0].factVersion, payload, now: new Date(),
  });
}
