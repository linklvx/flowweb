// apps/api/src/test-utils/append-audit.ts
// C3-0/C3-1（doc-append-gap-alert）：append 审计三断言 JS 夹面——单源共享（c30 诊断夹具 + c31 SQL 版对拍
//  双消费面；C3-1 起自 c30 spec 内联形态迁此〔M-2 单源对齐〕）。语义与 worker SQL CTE 版
// （collab-append-audit.worker auditAppendBatch）必须一致——int 夹具双跑两版对拍钉死。
// 聚合域=(projectId,generation) 行 seq>stateSeq（指针快照 stateSeq——折空 0）：
//  a) 行内密度 frameCount==lastWalSeq−firstWalSeq+1；
//  b) 行间衔接 next.firstWalSeq==cur.lastWalSeq+1 ∨ 断点区间 [cur.lastWalSeq+1, next.firstWalSeq−1]
//     全部存在 CanvasDocCoalesced 记录；
//  c) 边界 min(firstWalSeq)==stateSeq+1 ∧ max(lastWalSeq)==pgSeq——**两端侧表豁免**（C3-0 评审 M-1/m-3
//     裁定）：首端缺行→[stateSeq+1, min(first)−1] 全在侧表即豁免（M-1：compact 后重启窗客户端同字节重发
//     →stateSeq+1 号位帧被吞→侧表已覆盖断点但存活行 min(first)=stateSeq+2）；尾端缺行→[max(last)+1, pgSeq]
//     全在侧表即豁免（I-2：尾吞行 pgSeq>存活行 max(last)，侧表覆盖该 seq）；区间空（min(first)<stateSeq+1
//     /max(last)>pgSeq=号位越界）无豁免面=真违例。
import { expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';

/** C3 审计三断言 JS 断言形态（SQL 版语义基准——同判据不同载体）。
 *  违例=expect 抛（调用方对拍用 rejects.toThrow）；绿=静默返回。 */
export async function assertAppendAuditThree(prisma: PrismaClient, pid: string): Promise<void> {
  const head = await prisma.canvasDoc.findUnique({
    where: { projectId: pid },
    select: { generation: true, pgSeq: true, currentSnapshotRev: true },
  });
  expect(head, 'CanvasDoc 行在（夹具布景）').toBeTruthy();
  if (!head) return;
  const snap = await prisma.canvasDocSnapshot.findUnique({
    where: { projectId_generation_snapshotRev: { projectId: pid, generation: head.generation, snapshotRev: head.currentSnapshotRev } },
    select: { stateSeq: true },
  });
  const stateSeq = snap?.stateSeq ?? 0n;
  const rows = await prisma.$queryRaw<{ firstWalSeq: bigint; lastWalSeq: bigint; frameCount: number }[]>`
    SELECT "firstWalSeq", seq AS "lastWalSeq", "frameCount" FROM "CanvasDocUpdate"
    WHERE "projectId" = ${pid}::text AND generation = ${head.generation}::int AND seq > ${stateSeq}::bigint
    ORDER BY seq ASC`;
  const coalesced = new Set((await prisma.$queryRaw<{ seq: bigint }[]>`
    SELECT seq FROM "CanvasDocCoalesced"
    WHERE "projectId" = ${pid}::text AND generation = ${head.generation}::int`).map((r) => r.seq));
  for (const r of rows) {
    // a) 行内密度
    expect(BigInt(r.frameCount), `行内密度违例 seq=${r.lastWalSeq}（frameCount≠lastWalSeq−firstWalSeq+1）`).toBe(r.lastWalSeq - r.firstWalSeq + 1n);
  }
  for (let i = 1; i < rows.length; i++) {
    const cur = rows[i - 1]!, next = rows[i]!;
    // b) 行间衔接：断点区间全在侧表
    for (let s = cur.lastWalSeq + 1n; s < next.firstWalSeq; s++) {
      expect(coalesced.has(s), `行间断点 seq=${s} 应有 CanvasDocCoalesced 记录（行 ${cur.lastWalSeq}→${next.firstWalSeq}）`).toBe(true);
    }
  }
  if (rows.length > 0) {
    // c) 边界——两端侧表豁免（M-1/m-3）：缺行端区间全在侧表即豁免；区间空（号位越界）无豁免面=真违例。
    //    else 分支=豁免不适用时的原断言（==（绿）/越界（红）两分）。
    const minFirst = rows[0]!.firstWalSeq;
    if (minFirst > stateSeq + 1n) {
      for (let s = stateSeq + 1n; s < minFirst; s++) {
        expect(coalesced.has(s), `首端豁免区间 seq=${s} 应有 CanvasDocCoalesced 记录（min(first)=${minFirst}≠stateSeq+1=${stateSeq + 1n}——M-1 重启窗吞行形态须侧表覆盖）`).toBe(true);
      }
    } else {
      expect(minFirst, '边界违例：min(firstWalSeq)≠stateSeq+1').toBe(stateSeq + 1n);
    }
    const maxLast = rows[rows.length - 1]!.lastWalSeq;
    if (maxLast < head.pgSeq) {
      for (let s = maxLast + 1n; s <= head.pgSeq; s++) {
        expect(coalesced.has(s), `尾端豁免区间 seq=${s} 应有 CanvasDocCoalesced 记录（max(last)=${maxLast}≠pgSeq=${head.pgSeq}——I-2 尾吞行形态须侧表覆盖）`).toBe(true);
      }
    } else {
      expect(maxLast, '边界违例：max(lastWalSeq)≠pgSeq').toBe(head.pgSeq);
    }
  }
}