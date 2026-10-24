// packages/shared/src/testing/y1c-wal-fault-corpus.ts
// Y1c T5a：WAL 故障语料（plan v1.7 Task 5/T5a——spec §4.3/§4.4；T0-S4 spike §4 五验证语义的语料化）。
// **声明式**（段头+帧记录输入+故障注入计划+期望恢复语义）——T8 自 spike 移植唯一编码器后物化字节，
// 本语料不持第二份段格式实现（spike 两份实现收敛单源纪律；T0-S4 §5 格式决策为字段布局唯一权威）。
// 期望值全数来自 spike wal-segment-format.spike.spec.ts 已验证结果（§4 表——T8/T13 恢复扫描用例消费）。
import type {
  SystemHistoryState, WalBadSegmentTier, WalSegmentHeader,
} from '../collab/doc-protocol';

/** 帧记录 fixture 输入（frameHash/crc32 由 T8 编码器自 payload 计算——语料只给身份与载荷） */
export interface WalFrameFixtureInput {
  walSeq: bigint;
  payload: Uint8Array;
  /** 缺省=段头 generation（帧内一律携带 generation——换代混段检测） */
  generation?: number;
}

/** 故障注入计划（七形态——前四=帧级四档、后三=段级 quarantine 面） */
export type WalFaultInjection =
  | { kind: 'bad-crc'; frameIndex: number }                       // 帧载荷单字节翻转（CRC 网拦——截断到 last-good）
  | { kind: 'truncated'; frameIndex: number; keepBytes: number }  // 帧记录前 keepBytes 半写（撕裂尾）
  | { kind: 'missing-seq'; frameIndex: number }                   // walSeq 跳号（gap——前缀止步，其后帧不进前缀）
  | { kind: 'dup-seq-same-hash'; frameIndex: number }             // 旧 seq 同 hash 重放（良性——跳过不挡后续）
  | { kind: 'dup-hash-new-seq'; frameIndex: number; repeatOf: number }  // 新 seq 承载已见 hash（跳过并消费 seq）
  | { kind: 'history-mismatch'; historyId: string }               // 段头 historyId≠SystemHistory（整段 quarantine）
  | { kind: 'timestamp-fence'; lastWriteAtMs: number };           // 段头 lastWriteAt>epochStartedAt（忘 bump 形态）

export interface WalSegmentFixture {
  name: string;
  header: WalSegmentHeader;
  /** 帧输入（**故障物化后**的序——missing-seq/dup 形态的偏序即由本列表自身表达；
   *  bad-crc/truncated 的字节翻转/半写由 fault 描述、T8 物化器对 frameIndex 帧执行） */
  frames: WalFrameFixtureInput[];
  fault?: WalFaultInjection;
  /** 期望恢复扫描重放前缀（walSeq 十进制 bigint 列表——spike §4 精确性口径：无漏好帧/无收坏帧） */
  expectedReplayPrefix: bigint[];
  /** 期望整段 quarantine（零帧重放——fail-closed） */
  expectedQuarantine?: 'history-mismatch' | 'timestamp-fence';
  /** 期望坏段四档（帧级缺陷档——quarantine 档不落此字段） */
  expectedBadTier?: WalBadSegmentTier;
}

/** 确定性载荷（非全零——CRC/SHA 区分度；spike payload() 同式） */
export function walFixturePayload(size: number, seed: number): Uint8Array {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = (seed * 31 + i * 7 + 0x5b) & 0xff;
  return b;
}

/** 连续 walSeq 帧输入（1..n） */
export function walFrameInputs(count: number, generation = 3): WalFrameFixtureInput[] {
  return Array.from({ length: count }, (_, i) => ({
    walSeq: BigInt(i + 1),
    payload: walFixturePayload(1024 + i * 64, 11 + i),
    ...(generation === 3 ? {} : { generation }),
  }));
}

export function walFixtureHeader(over: Partial<WalSegmentHeader> = {}): WalSegmentHeader {
  return {
    projectId: 'proj-fixture', generation: 3, historyId: 'h-fixture-2026-10-24',
    createdAtMs: Date.UTC(2026, 9, 24, 12, 0, 0), lastWriteAtMs: Date.UTC(2026, 9, 24, 12, 0, 30),
    ...over,
  };
}

/** WAL 故障语料全集（期望值=spike §4 表逐条语料化——epochStartedAt 取段头 lastWriteAt 之后为「正常收养」基线） */
export function buildWalFaultCorpus(systemHistory: SystemHistoryState): WalSegmentFixture[] {
  const header = walFixtureHeader({ historyId: systemHistory.historyId });
  const good = (name: string, frames: WalFrameFixtureInput[], prefix: bigint[]): WalSegmentFixture => ({
    name, header, frames, expectedReplayPrefix: prefix,
  });
  return [
    good('完好段 roundtrip', walFrameInputs(3), [1n, 2n, 3n]),
    { name: '坏 CRC 尾帧（载荷字节翻转）', header, frames: walFrameInputs(3),
      fault: { kind: 'bad-crc', frameIndex: 2 },
      expectedReplayPrefix: [1n, 2n], expectedBadTier: 'bad-crc' },
    { name: '撕裂尾（帧记录半写）', header, frames: walFrameInputs(3),
      fault: { kind: 'truncated', frameIndex: 3, keepBytes: 30 },
      expectedReplayPrefix: [1n, 2n, 3n], expectedBadTier: 'truncated' },
    { name: '缺号 gap（seq 3 缺失）', header,
      frames: walFrameInputs(4).map((f, i) => (i >= 2 ? { ...f, walSeq: f.walSeq + 1n } : f)),   // [1,2,4,5]
      fault: { kind: 'missing-seq', frameIndex: 2 },
      expectedReplayPrefix: [1n, 2n], expectedBadTier: 'missing-seq' },
    { name: '旧 seq 同 hash 重放（良性 dup——跳过不挡后续）', header,
      frames: [...walFrameInputs(3), { walSeq: 2n, payload: walFixturePayload(1024 + 64, 12) }, { walSeq: 4n, payload: walFixturePayload(1024 + 192, 14) }],
      fault: { kind: 'dup-seq-same-hash', frameIndex: 3 },
      expectedReplayPrefix: [1n, 2n, 3n, 4n], expectedBadTier: 'dup-hash' },
    { name: '新 seq 旧 hash（dup-hash——跳过并消费 seq）', header,
      frames: [...walFrameInputs(3), { walSeq: 4n, payload: walFixturePayload(1024 + 64, 12) }, { walSeq: 5n, payload: walFixturePayload(1024 + 256, 15) }],
      fault: { kind: 'dup-hash-new-seq', frameIndex: 3, repeatOf: 1 },
      expectedReplayPrefix: [1n, 2n, 3n, 5n], expectedBadTier: 'dup-hash' },
    { name: '段头 historyId≠SystemHistory（整段 quarantine 零帧重放）', header,
      frames: walFrameInputs(2),
      fault: { kind: 'history-mismatch', historyId: 'h-old-epoch' },
      expectedReplayPrefix: [], expectedQuarantine: 'history-mismatch' },
    { name: '时间戳栅栏（lastWriteAt>epochStartedAt——忘 bump 形态整段隔离）',
      header: walFixtureHeader({ historyId: systemHistory.historyId, lastWriteAtMs: systemHistory.epochStartedAtMs + 5_000 }),
      frames: walFrameInputs(1),
      fault: { kind: 'timestamp-fence', lastWriteAtMs: systemHistory.epochStartedAtMs + 5_000 },
      expectedReplayPrefix: [], expectedQuarantine: 'timestamp-fence' },
  ];
}
