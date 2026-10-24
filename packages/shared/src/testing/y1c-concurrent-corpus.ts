// packages/shared/src/testing/y1c-concurrent-corpus.ts
// Y1c T5a：双端并发语料骨架（plan v1.7 Task 5/T5a——spec §3.2 pending 区间法+§4.1 去重/准入）。
// 真 Yjs 双 clientID（A/B 固定 id——确定性零随机），产出 gate 输入形态的候选帧+接收端 SV+预期裁定：
//   - SS2 自包含（新 client 全量帧 vs 空 SV——max clock>SV 仍放行，「禁 max-clock 单值」核心语料）
//   - 增量帧（接收端已含该 client 前缀——起点 clock==SV 放行）
//   - 缺前驱（跳过前序 update 的单帧——起点 clock>SV 拒 4412）
//   - 区间有洞（mergeUpdates 挖中段——yjs 以 Skip struct 显式标记洞）
//   - 同字节重复对（SHA-256 去重 promise map 语料）
//   - 两端并发同键写（各帧区间独立自包含——CRDT 并发=合法中间态非缺前驱）
// 装置纪律：**单实例续写**（A 的增量/并发帧出自同一 docA 连续编辑——禁「重放自身 update 到第二实例」：
// yjs 检测同 clientID 双活会静默换号，帧归属即失真——[yjs] Changed the client-id 实测）；B 的 listener
// 在收 A 基座**之后**挂（A 基座不入 bUpdates）。T9 CollabProjectActor gate 用例族与 doc-protocol.spec
// 的 pending 区间断言同源消费（禁两份构造）。
import * as Y from 'yjs';
import type { PendingIntervalAnalysis } from '../collab/doc-protocol';

export const CORPUS_CLIENT_A_ID = 414141;
export const CORPUS_CLIENT_B_ID = 424242;

export type ConcurrentCorpusPurpose =
  | 'ss2-self-contained' | 'incremental' | 'missing-predecessor' | 'hole' | 'concurrent';

export interface ConcurrentCorpusEntry {
  name: string;
  /** 候选帧字节（gate 输入——原始帧「精确 copy 至独立 buffer」语义的源字节） */
  frame: Uint8Array;
  /** 接收端 state vector（pending 区间预检对照面——Y.encodeStateVector 产物） */
  stateVector: Uint8Array;
  /** pending 区间法预期裁定（T9 gate 断言口径与 doc-protocol.spec 同源） */
  expect: PendingIntervalAnalysis['kind'];
  purpose: ConcurrentCorpusPurpose;
}

export interface TwoClientConcurrentCorpus {
  clientAId: number;
  clientBId: number;
  entries: ConcurrentCorpusEntry[];
  /** 同字节重复帧对（SHA-256 去重语料——两帧字节全等，T9 in-flight promise map/命中 applied=no-op 用例） */
  duplicatePair: { frame: Uint8Array; stateVector: Uint8Array };
  /** 两端并发同键写（已同步基座上各自写同键不同值——NORMALIZE 面/收敛语料，双帧对同一 baseSv） */
  concurrentSameKeyFrames: { a: Uint8Array; b: Uint8Array; baseSv: Uint8Array };
}

/** 确定性双端并发语料（每次调用全新 Y.Doc 实例——clientID/编辑内容全脚本化，输出逐字节稳定） */
export function buildTwoClientConcurrentCorpus(): TwoClientConcurrentCorpus {
  const docA = new Y.Doc();
  docA.clientID = CORPUS_CLIENT_A_ID;
  const docB = new Y.Doc();
  docB.clientID = CORPUS_CLIENT_B_ID;

  // ── 基座：A 三笔（clock 0-2）→ 同步给 B（B 的 listener 后挂——A 基座不入 bUpdates） ──
  const aUpdates: Uint8Array[] = [];
  docA.on('update', (u) => aUpdates.push(u));
  docA.getMap('nodes').set('n1', { x: 1 });
  docA.getMap('nodes').set('n2', { x: 2 });
  docA.getMap('meta').set('title', 'A');
  const baseState = Y.mergeUpdates(aUpdates.slice(0, 3));
  Y.applyUpdate(docB, baseState);
  const svAfterBase = Y.encodeStateVector(docB);   // A:3，B 缺席

  // ── B 三笔独立编辑（clock 0-2——对「只见基座的服务端」而言 B 是新 client） ──
  const bUpdates: Uint8Array[] = [];
  docB.on('update', (u) => bUpdates.push(u));
  docB.getMap('nodes').set('m1', { y: 1 });
  docB.getMap('nodes').set('m2', { y: 2 });
  docB.getMap('nodes').set('m3', { y: 3 });

  // ── A 增量（同步后下一笔——clock 3，单实例续写） ──
  docA.getMap('nodes').set('n3', { x: 3 });
  const aIncremental = aUpdates[3];

  // ── 接收端（「服务端」）状态：基座+A 增量+B 三笔——A:4, B:3 ──
  const receiver = new Y.Doc();
  Y.applyUpdate(receiver, baseState);
  Y.applyUpdate(receiver, aIncremental);
  for (const u of bUpdates) Y.applyUpdate(receiver, u);
  const receiverSv = Y.encodeStateVector(receiver);

  // ── 并发同键写：A/B 各写 meta.title 同键不同值（互不感知对方在飞帧——A clock 4 / B clock 3） ──
  docA.getMap('meta').set('title', 'A-wins?');
  docB.getMap('meta').set('title', 'B-wins?');
  const aConcurrent = aUpdates[4];
  const bConcurrent = bUpdates[3];

  // 服务端只见基座（未见过 B 任何帧）——缺前驱/洞判定的对照 SV
  const serverSvWithoutB = (() => {
    const s = new Y.Doc();
    Y.applyUpdate(s, baseState);
    return Y.encodeStateVector(s);
  })();
  const emptySv = Y.encodeStateVector(new Y.Doc());

  if (aUpdates.length !== 5 || bUpdates.length !== 4) {
    throw new Error(`concurrent-corpus: update 收集数异常 A=${aUpdates.length} B=${bUpdates.length}（应 5/4）`);
  }

  const entries: ConcurrentCorpusEntry[] = [
    { name: 'A-ss2-full-state-vs-empty-sv', frame: baseState, stateVector: emptySv,
      expect: 'self-contained', purpose: 'ss2-self-contained' },
    { name: 'B-ss2-full-state-vs-empty-sv', frame: Y.encodeStateAsUpdate(docB), stateVector: emptySv,
      expect: 'self-contained', purpose: 'ss2-self-contained' },
    { name: 'A-incremental-starts-at-sv', frame: aIncremental, stateVector: svAfterBase,
      expect: 'self-contained', purpose: 'incremental' },
    { name: 'B-missing-predecessor-third-frame-only', frame: bUpdates[2], stateVector: serverSvWithoutB,
      expect: 'missing-predecessor', purpose: 'missing-predecessor' },
    { name: 'B-merged-hole-skip-middle', frame: Y.mergeUpdates([bUpdates[0], bUpdates[2]]), stateVector: serverSvWithoutB,
      expect: 'missing-predecessor', purpose: 'hole' },
    { name: 'B-contiguous-prefix-pair', frame: Y.mergeUpdates([bUpdates[0], bUpdates[1]]), stateVector: serverSvWithoutB,
      expect: 'self-contained', purpose: 'incremental' },
    { name: 'A-concurrent-same-key-frame', frame: aConcurrent, stateVector: receiverSv,
      expect: 'self-contained', purpose: 'concurrent' },
    { name: 'B-concurrent-same-key-frame', frame: bConcurrent, stateVector: receiverSv,
      expect: 'self-contained', purpose: 'concurrent' },
  ];

  return {
    clientAId: CORPUS_CLIENT_A_ID,
    clientBId: CORPUS_CLIENT_B_ID,
    entries,
    duplicatePair: { frame: aIncremental, stateVector: svAfterBase },
    concurrentSameKeyFrames: { a: aConcurrent, b: bConcurrent, baseSv: receiverSv },
  };
}
