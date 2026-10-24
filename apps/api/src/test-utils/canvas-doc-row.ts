// apps/api/src/test-utils/canvas-doc-row.ts
// Y1c T9：CanvasDocUpdate 新表形态播种便捷面——旧 repo.append（nextval 单帧）随写入方换代退役，
// spec 播种统一走 appendBatch+singleFrameRow（walSeq 由用例供给单调序——行 seq 口径=批 lastWalSeq）。
import { createHash } from 'node:crypto';
import { CanvasDocUpdateRepository } from '../modules/collab/canvas-doc-update.repository';

export function seedRow(update: Uint8Array | Buffer, walSeq: bigint, generation = 1) {
  const u = update instanceof Uint8Array ? update : new Uint8Array(update);
  return CanvasDocUpdateRepository.singleFrameRow({
    generation,
    walSeq,
    frameHash: createHash('sha256').update(u).digest(),
    update: u,
  });
}

/** 递增 walSeq 播种器（spec 文件级闭包用——append 退役后 nextval 语义的测试替身）。 */
export function makeSeedSeq(start = 0n): (update: Uint8Array | Buffer, generation?: number) => { generation: number; firstWalSeq: bigint; lastWalSeq: bigint; frameCount: number; updateHash: string; update: Uint8Array } {
  let seq = start;
  return (update, generation = 1) => {
    seq += 1n;
    return seedRow(update, seq, generation);
  };
}
