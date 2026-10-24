// packages/shared/src/collab/doc-protocol.spec.ts
// Y1c T5a（plan v1.7 Task 5 载体/协议段；spec v5.4 §3.2/§4.1-§4.4/§5/§8.1）：协议契约冻结的契约测试——
// 锁冻结数字（单源派生——禁第二字面量）、准入链次序、水位三元不变量、quarantine 真值表、
// barrier 形状、ETag 格式、UI 四态映射全态、pending 区间法（真 yjs 双端语料——testing/y1c-concurrent-corpus）。
// 本文件=T8/T9/T10/T13 实现的消费契约锁：任何契约面漂移（数字/次序/形状/判定语义）先红于此。
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  ACK_TIER_SEMANTICS, APPLY_ADMISSION_STAGES, ACTOR_DRAIN_BATCH_MAX_BYTES, ACTOR_DRAIN_BATCH_MAX_MS,
  ACTOR_DRAIN_IDLE_COLLECT_MS, analyzePendingIntervals, AuthHistoryVerdict, BarrierErrorReceipt, BarrierReceipt,
  BarrierRequest, COLLAB_WS_MAX_PAYLOAD_BYTES, DEPRECATED_VERSION_DIMENSION_KEYS,
  DURABLE_WATERMARK_BROADCAST_MIN_INTERVAL_MS, DurableWatermarkBroadcast, FlushThroughResult,
  formatDocETag, formatLocalCacheKey, formatProviderHistoryParam, parseProviderHistoryParam, HTTP_SEED_RETIRE_TRIGGERS,
  INBOUND_QUEUE_LIMIT_BYTES, INBOUND_QUEUE_OVER_LIMIT_CLOSE_CODE, isGateApplyOrigin, LocalCacheKeyFiveTuple,
  MAX_RESIDENT_DOC_BYTES_CONTRACT, NORMAL_FRAME_GATE_BYTES, PendingIntervalAnalysis, POISON_FRAME_PROTOCOL,
  resolveAuthHistoryVerdict, resolveSaveUiState, resolveVersionGate, SAVE_BARRIER_BACKOFF_STEPS_MS,
  SAVE_BARRIER_FLUSH_THROTTLE_MS, SAVE_BARRIER_IDLE_TRIGGER_MS, SAVE_BARRIER_MAX_DIRTY_INTERVAL_MS,
  SAVE_UI_STATE_LABELS, SaveUiState, SS2_FRAME_GATE_BYTES, SS2_SEMAPHORE_GLOBAL_BUDGET_BYTES,
  SS2_SEMAPHORE_PER_PROJECT, VERSION_DIMENSIONS, VERSION_GATE_SERVER_BASE, VersionGateHardTriple,
  WAL_CHECKPOINT_COLUMN_NAME, WAL_DEDUP_INDEX_MAX_ENTRIES, WAL_DEDUP_INDEX_TTL_MS, WAL_FSYNC_TIER_SEMANTICS,
  WAL_FRAME_FIXED_BYTES, WAL_FRAME_LAYOUT, WalFsyncFailureTier, WAL_SEGMENT_HEADER_LAYOUT, WAL_SEGMENT_HEADER_SIZE,
  WAL_SEGMENT_MAGIC, WAL_SEGMENT_VERSION, WAL_ID_FIELD_BYTES, assertWatermarkInvariants, CollabY1cClosePayload,
  shouldQuarantineSegment, walDefectTier, WalSegmentHeader,
} from './doc-protocol';
import {
  FRAME_ALLOWANCE_BYTES, QUOTA_DEFAULTS,
} from '../constants/collab-quota';
import {
  CLIENT_OUTDATED_REASON, CollabCloseCode, FRAME_MALFORMED_REASON, MAINTENANCE_FREEZE_REASON,
  RESYNC_REQUIRED_REASON, SERVER_RESTORED_TERMINAL_REASON,
} from '../constants/collab-close-code';
import { CLIENT_PROTOCOL_VERSION } from '../constants/collab-protocol';
import { CANVAS_DOC_SCHEMA_VERSION } from '../canvas/docShape';
import { buildTwoClientConcurrentCorpus } from '../testing/y1c-concurrent-corpus';
import { buildBarrierCorpus } from '../testing/y1c-barrier-corpus';
import { buildWalFaultCorpus, walFixtureHeader } from '../testing/y1c-wal-fault-corpus';

describe('Y1c T5a 契约冻结：水位拆义（偏离 38⑥）', () => {
  it('不变量 0≤pgSeq≤appliedSeq≤spoolHeadSeq——合法三元全过（零位/等值/严格递增）', () => {
    expect(() => assertWatermarkInvariants({ pgSeq: 0n, appliedSeq: 0n, spoolHeadSeq: 0n })).not.toThrow();
    expect(() => assertWatermarkInvariants({ pgSeq: 3n, appliedSeq: 3n, spoolHeadSeq: 3n })).not.toThrow();
    expect(() => assertWatermarkInvariants({ pgSeq: 1n, appliedSeq: 3n, spoolHeadSeq: 7n })).not.toThrow();
  });
  it('三元任一破坏即 throw：pgSeq<0 / pgSeq>appliedSeq / appliedSeq>spoolHeadSeq', () => {
    expect(() => assertWatermarkInvariants({ pgSeq: -1n, appliedSeq: 0n, spoolHeadSeq: 0n })).toThrow(/pgSeq/);
    expect(() => assertWatermarkInvariants({ pgSeq: 2n, appliedSeq: 1n, spoolHeadSeq: 3n })).toThrow(/pgSeq.*appliedSeq/);
    expect(() => assertWatermarkInvariants({ pgSeq: 1n, appliedSeq: 5n, spoolHeadSeq: 4n })).toThrow(/appliedSeq.*spoolHeadSeq/);
  });
  it('CanvasDoc 持久列改名 walCheckpointSeq（DDL 契约=T7/T21 落地——永不与 appliedSeq 比较）', () => {
    expect(WAL_CHECKPOINT_COLUMN_NAME).toBe('walCheckpointSeq');
  });
});

describe('Y1c T5a 契约冻结：apply 归属/准入链（偏离 37①+38③）', () => {
  it('准入链 ⓪-⑤ 恰六档且次序冻结——⓪写权限态短路最先（库 readOnly 检查在 beforeSync 后，gate 必须自判）', () => {
    expect(APPLY_ADMISSION_STAGES).toEqual([
      'write-state-shortcircuit',    // ⓪ readOnly/writeFreeze/quota
      'frame-local-validation',      // ① 身份/项目权限/generation 每帧对照世代权威/帧格式+解码+结构/字段权限/预算
      'pending-interval-precheck',   // ② decodeUpdate 各 client 区间 vs SV——4412
      'dedupe-sha256',               // ③ 帧字节精确 copy+SHA-256 去重（promise map——去重后才分配 walSeq）
      'spool-fsync',                 // ④ 批量追加 WAL+一次 fsync
      'apply',                       // ⑤ actor pre-apply origin=GateApplyOrigin→appliedSeq=walSeq→幂等重放→恰一 SyncStatus(true)
    ]);
  });
  it('GateApplyOrigin 形状={source:"connection",connection,gate:true}——gate:false/缺 source 判否', () => {
    expect(isGateApplyOrigin({ source: 'connection', connection: {}, gate: true })).toBe(true);
    expect(isGateApplyOrigin({ source: 'connection', connection: {} })).toBe(false);
    expect(isGateApplyOrigin({ source: 'connection', connection: {}, gate: false })).toBe(false);
    expect(isGateApplyOrigin({ source: 'local', connection: {}, gate: true })).toBe(false);
    expect(isGateApplyOrigin(null)).toBe(false);
  });
  it('actor 批数字：drain ≤20ms/≤1MiB/空闲 1ms 即收（F-S4-3 批窗=上界非 dwell）', () => {
    expect(ACTOR_DRAIN_BATCH_MAX_MS).toBe(20);
    expect(ACTOR_DRAIN_BATCH_MAX_BYTES).toBe(1_048_576);
    expect(ACTOR_DRAIN_IDLE_COLLECT_MS).toBe(1);
  });
  it('毒帧协议次序冻结：隔离→停写→WAL 截断至 appliedSeq→close 4411→pgSeq 重放（不得跳过毒帧提交后续序号）', () => {
    expect(POISON_FRAME_PROTOCOL).toEqual([
      'isolate-doc', 'stop-visible-writes', 'truncate-wal-to-appliedSeq', 'close-4411', 'replay-from-pgSeq',
    ]);
  });
  it('fsync 分档三分：写前失败/ENOSPC=可恢复截断复用 seq；EIO=fail-stop（walHealthy=false/close 1011/要求重启）', () => {
    expect(WAL_FSYNC_TIER_SEMANTICS['fsync-fail-pre']).toMatchObject({ recoverable: true, action: 'truncate-reuse-seq' });
    expect(WAL_FSYNC_TIER_SEMANTICS.ENOSPC).toMatchObject({ recoverable: true, action: 'truncate-reuse-seq' });
    expect(WAL_FSYNC_TIER_SEMANTICS.EIO).toMatchObject({ recoverable: false, action: 'fail-stop', closeCode: 1011 });
    const tiers = Object.keys(WAL_FSYNC_TIER_SEMANTICS).sort();
    expect(tiers).toEqual(['EIO', 'ENOSPC', 'fsync-fail-pre']);
  });
  it('beforeUnloadDocument drain 纪律+maxResidentDocBytes 契约（数值真源=api collab-residency 单源——spec「如 2GB」非冻结值）', () => {
    expect(MAX_RESIDENT_DOC_BYTES_CONTRACT.onLimitExceeded).toBe('reject-new-loads-503-4413');
    expect(MAX_RESIDENT_DOC_BYTES_CONTRACT.numericSource).toContain('collab-residency');
  });
});

describe('Y1c T5a 契约冻结：pending 区间法（真 yjs 双端语料——禁 max-clock 单值）', () => {
  const corpus = buildTwoClientConcurrentCorpus();
  it.each(corpus.entries)('$name → $expect', ({ frame, stateVector, expect: expected }) => {
    const r: PendingIntervalAnalysis = analyzePendingIntervals(frame, stateVector);
    expect(r.kind).toBe(expected);
  });
  it('自包含结果回传各 client 合并后区间（clock 连续）；缺前驱细节带 client+起点+SV 水位', () => {
    const ok = analyzePendingIntervals(corpus.entries[0].frame, corpus.entries[0].stateVector);
    if (ok.kind !== 'self-contained') throw new Error('unreachable');
    expect(ok.intervals.length).toBeGreaterThan(0);
    for (const iv of ok.intervals) expect(iv.end).toBeGreaterThan(iv.start);
    const bad = analyzePendingIntervals(
      corpus.entries.find((e) => e.purpose === 'missing-predecessor')!.frame,
      corpus.entries.find((e) => e.purpose === 'missing-predecessor')!.stateVector,
    );
    if (bad.kind !== 'missing-predecessor') throw new Error('unreachable');
    expect(bad.client).toBe(corpus.clientBId);
    expect(bad.reason).toBe('start-after-sv');
    expect(bad.startClock).toBeGreaterThan(bad.svClock);
  });
  it('区间有洞（mergeUpdates 挖中段——Skip struct）→ missing-predecessor reason=hole 且带洞区间', () => {
    const hole = corpus.entries.find((e) => e.purpose === 'hole')!;
    const r = analyzePendingIntervals(hole.frame, hole.stateVector);
    if (r.kind !== 'missing-predecessor') throw new Error('unreachable');
    expect(r.reason).toBe('hole');
    expect(r.hole).toBeDefined();
  });
  it('空 update（零 struct）→ self-contained（无区间可缺）', () => {
    const empty = new Y.Doc();
    const r = analyzePendingIntervals(Y.encodeStateAsUpdate(empty), Y.encodeStateVector(empty));
    expect(r.kind).toBe('self-contained');
  });
});

describe('Y1c T5a 契约修正 #2：pending 区间三分精化（SV 前缀扣除/SV 覆盖 Skip 放行/DS-only 未知 clock→4412）', () => {
  // 确定性单 client 语料：clock 0..7 逐笔 update（同 corpus 单实例续写纪律——一 doc 连续编辑）
  const C = 555555;
  const ups: Uint8Array[] = [];
  {
    const src = new Y.Doc();
    src.clientID = C;
    src.on('update', (u) => ups.push(u));
    for (let i = 0; i < 8; i++) src.getMap('nodes').set(`k${i}`, { i });
    if (ups.length !== 8) throw new Error('修正#2 语料构造异常');
  }
  /** 接收端含前 applyCount 笔（SV clock=applyCount——覆盖 [0,applyCount)） */
  const svOf = (applyCount: number): Uint8Array => {
    const d = new Y.Doc();
    for (let i = 0; i < applyCount; i++) Y.applyUpdate(d, ups[i]!);
    return Y.encodeStateVector(d);
  };
  /** 删除 clock=delClock 键产生的 DS-only 帧（纯删集零 struct——deleter 持全量后删） */
  const dsOnlyFrame = (delClock: number): Uint8Array => {
    const deleter = new Y.Doc();
    Y.applyUpdate(deleter, Y.mergeUpdates(ups));
    const captured: Uint8Array[] = [];
    deleter.on('update', (u) => captured.push(u));
    deleter.getMap('nodes').delete(`k${delClock}`);
    return captured[0]!;
  };

  it('① SV 已覆盖前缀扣除：区间 [3,8) 含 SV 覆盖洞 [4,5)（Skip）——SV=5 时仅 [5,8) 待判 → self-contained 放行', () => {
    // frame=Item[3,4)+Skip[4,5)+Item[5,8)（mergeUpdates 挖中段）；接收端 SV clock=5 已覆盖 [0,5)
    const frame = Y.mergeUpdates([ups[3]!, ups[5]!, ups[6]!, ups[7]!]);
    const r = analyzePendingIntervals(frame, svOf(5));
    expect(r.kind).toBe('self-contained');
  });
  it('① 反向锚：同帧对未见前驱的接收端（SV=0）仍拒——扣除只豁免 SV 实际覆盖的前缀段', () => {
    const frame = Y.mergeUpdates([ups[3]!, ups[5]!, ups[6]!, ups[7]!]);
    const r = analyzePendingIntervals(frame, svOf(0));
    expect(r.kind).toBe('missing-predecessor');   // 起点 clock 3>SV 0——缺前驱拒（4412）
  });
  it('② SV 已覆盖的 Skip 放行：Item[2,3)+Skip[3,4)+Item[4,5) 全落 SV=5 覆盖域 → self-contained', () => {
    const frame = Y.mergeUpdates([ups[2]!, ups[4]!]);
    const r = analyzePendingIntervals(frame, svOf(5));
    expect(r.kind).toBe('self-contained');
  });
  it('② 半覆盖 Skip 仍拒且洞区间扣除 SV 覆盖段：Skip[4,6) 对 SV=5 → hole 恰为未覆盖段 {from:5,to:6}', () => {
    const frame = Y.mergeUpdates([ups[3]!, ups[6]!, ups[7]!]);   // Item[3,4)+Skip[4,6)+Item[6,8)
    const r = analyzePendingIntervals(frame, svOf(5));
    if (r.kind !== 'missing-predecessor') throw new Error('unreachable');
    expect(r.reason).toBe('hole');
    expect(r.hole).toEqual({ from: 5, to: 6 });   // 覆盖段 [4,5) 不进洞区间——只报待判缺口
  });
  it('③ DS-only 更新（纯删集零 struct）遇未知 client clock → missing-predecessor（4412 零 WAL 零 apply）', () => {
    const frame = dsOnlyFrame(4);                    // 删 client C clock=4——接收端从未见过 C
    const r = analyzePendingIntervals(frame, Y.encodeStateVector(new Y.Doc()));
    if (r.kind !== 'missing-predecessor') throw new Error('unreachable');
    expect(r.reason).toBe('ds-unknown-clock');
    expect(r.client).toBe(C);
    expect(r.startClock).toBe(4);
    expect(r.svClock).toBe(0);                       // client 不在 SV 即 0——新 client 的删集也须自 clock 0 起可覆盖
  });
  it('③ 反向锚：DS-only 删已覆盖区间（SV 含该 client 全量）→ self-contained 放行（不扩大拒绝面）', () => {
    const frame = dsOnlyFrame(4);                    // 同帧——接收端已含 C 全量（SV clock=8 覆盖 [0,8)）
    const r = analyzePendingIntervals(frame, svOf(8));
    expect(r.kind).toBe('self-contained');
  });
});

describe('Y1c T5a 契约冻结：save barrier（偏离 37⑦+38⑳）', () => {
  it('触发数字冻结：800ms idle/5s 上限/250ms flush 节流/1s watermark 广播/退避 1-2-5-10s', () => {
    expect(SAVE_BARRIER_IDLE_TRIGGER_MS).toBe(800);
    expect(SAVE_BARRIER_MAX_DIRTY_INTERVAL_MS).toBe(5_000);
    expect(SAVE_BARRIER_FLUSH_THROTTLE_MS).toBe(250);
    expect(DURABLE_WATERMARK_BROADCAST_MIN_INTERVAL_MS).toBe(1_000);
    expect(SAVE_BARRIER_BACKOFF_STEPS_MS).toEqual([1_000, 2_000, 5_000, 10_000]);
  });
  it('BarrierRequest 四键 {nonce,clientSeq,tabId,sessionEpoch}——clientSeq 配 tabId/sessionEpoch（reload 后按同 session 比较）', () => {
    const req: BarrierRequest = { nonce: 'n1', clientSeq: 3, tabId: 'tab-1', sessionEpoch: 2 };
    expect(Object.keys(req).sort()).toEqual(['clientSeq', 'nonce', 'sessionEpoch', 'tabId']);
  });
  it('回执 {nonce,clientSeq,committedSeq}——committedSeq=pgSeq 且 BigInt 入 wire 显式 String()', () => {
    const ok: BarrierReceipt = { nonce: 'n1', clientSeq: 3, committedSeq: '42' };
    expect(Object.keys(ok).sort()).toEqual(['clientSeq', 'committedSeq', 'nonce']);
    expect(typeof ok.committedSeq).toBe('string');
  });
  it('错误回执 {nonce,error:BARRIER_FAILED|maintenance,committedSeq}——maintenance 不产生 Durable', () => {
    const a: BarrierErrorReceipt = { nonce: 'n1', error: 'BARRIER_FAILED', committedSeq: '42' };
    const b: BarrierErrorReceipt = { nonce: 'n1', error: 'maintenance', committedSeq: '42' };
    expect(a.error === 'BARRIER_FAILED' || b.error === 'maintenance').toBe(true);
    expect(Object.keys(a).sort()).toEqual(['committedSeq', 'error', 'nonce']);
  });
  it('flushThrough 契约形状 {pgSeq,targetReached}（幂等/有界/不阻塞写/返回当前 pgSeq）；watermark 广播 {type:"durable",pgSeq}', () => {
    const r: FlushThroughResult = { pgSeq: 42n, targetReached: true };
    expect(r.targetReached).toBe(true);
    const w: DurableWatermarkBroadcast = { type: 'durable', pgSeq: '42' };
    expect(w.type).toBe('durable');
  });
});

describe('Y1c T5a 契约冻结：WAL 段头/帧记录布局（T0-S4 §5 复用——禁发明第二格式）', () => {
  it('段头固定 164B：magic FWWALS1\\n + version 1 + 各域偏移冻结 + 头 CRC 覆盖 [0,160)', () => {
    expect(WAL_SEGMENT_MAGIC).toBe('FWWALS1\n');
    expect(WAL_SEGMENT_VERSION).toBe(1);
    expect(WAL_SEGMENT_HEADER_SIZE).toBe(164);
    expect(WAL_ID_FIELD_BYTES).toBe(64);
    expect(WAL_SEGMENT_HEADER_LAYOUT).toEqual({
      magic: { offset: 0, size: 8 },
      version: { offset: 8, size: 2 },
      headerSize: { offset: 10, size: 2 },
      generation: { offset: 12, size: 4 },
      projectId: { offset: 16, size: 64 },
      historyId: { offset: 80, size: 64 },
      createdAtMs: { offset: 144, size: 8 },
      lastWriteAtMs: { offset: 152, size: 8 },
      headerCrc32: { offset: 160, size: 4 },
    });
  });
  it('帧记录固定 52B 头：payloadLen|crc32|walSeq|generation|frameHash(SHA-256 32B)——CRC 覆盖含帧头字段', () => {
    expect(WAL_FRAME_FIXED_BYTES).toBe(52);
    expect(WAL_FRAME_LAYOUT).toEqual({
      payloadLen: { offset: 0, size: 4 },
      crc32: { offset: 4, size: 4 },
      walSeq: { offset: 8, size: 8 },
      generation: { offset: 16, size: 4 },
      frameHash: { offset: 20, size: 32 },
      payload: { offset: 52 },
    });
  });
  it('段头五域+lastWriteAt 成对更新 CRC 纪律（F-S4-6）——WalSegmentHeader 形状冻结', () => {
    const h: WalSegmentHeader = {
      projectId: 'p1', generation: 3, historyId: 'h1', createdAtMs: 1, lastWriteAtMs: 2,
    };
    expect(Object.keys(h).sort()).toEqual(['createdAtMs', 'generation', 'historyId', 'lastWriteAtMs', 'projectId']);
  });
  it('去重索引有界：24h TTL/100k 条——跨重启零重复 walSeq（偏离 38④）', () => {
    expect(WAL_DEDUP_INDEX_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(WAL_DEDUP_INDEX_MAX_ENTRIES).toBe(100_000);
  });
  it('shouldQuarantineSegment 两维真值表（修正 #6）：historyId 错=quarantine 不置 recoverySuspect；时间戳栅栏=recoverySuspect 不 quarantine；两因同触=两维皆真；正常段=两维皆 false（默认）', () => {
    const sys = { historyId: 'h-sys', epochStartedAtMs: 1_000 };
    const base = { historyId: 'h-sys', lastWriteAtMs: 999 };
    // 正常段：两维皆 false（默认值）
    expect(shouldQuarantineSegment(base, sys)).toEqual({ quarantine: false, recoverySuspect: false });
    // historyId 不匹配 → quarantine fail-closed（语义不变）——不置 recoverySuspect
    expect(shouldQuarantineSegment({ historyId: 'h-old', lastWriteAtMs: 999 }, sys))
      .toEqual({ quarantine: true, recoverySuspect: false, reason: 'history-mismatch' });
    // 时间戳栅栏 → 显式 recoverySuspect（默认 false——触发才置真）；不再并入整段 quarantine
    expect(shouldQuarantineSegment({ historyId: 'h-sys', lastWriteAtMs: 1_001 }, sys))
      .toEqual({ quarantine: false, recoverySuspect: true, reason: 'timestamp-fence' });
    // 边界：lastWriteAt==epoch（严格 > 才触发）→ 两维皆 false
    expect(shouldQuarantineSegment({ historyId: 'h-sys', lastWriteAtMs: 1_000 }, sys))
      .toEqual({ quarantine: false, recoverySuspect: false });
    // 两因同触：两维皆真（reason=history-mismatch 优先——fail-closed 档先判先报）
    expect(shouldQuarantineSegment({ historyId: 'h-old', lastWriteAtMs: 1_001 }, sys))
      .toEqual({ quarantine: true, recoverySuspect: true, reason: 'history-mismatch' });
    // F-S4-5 作用域收窄：时间戳栅栏仅在恢复怀疑态求值（restore.lock marker/水位倒挂）——跳过求值=recoverySuspect 恒 false；
    // historyId 栅栏每次恢复先查（不受该 opt 影响）
    expect(shouldQuarantineSegment({ historyId: 'h-sys', lastWriteAtMs: 1_001 }, sys, { evaluateTimestampFence: false }))
      .toEqual({ quarantine: false, recoverySuspect: false });
    expect(shouldQuarantineSegment({ historyId: 'h-old', lastWriteAtMs: 1_001 }, sys, { evaluateTimestampFence: false }))
      .toEqual({ quarantine: true, recoverySuspect: false, reason: 'history-mismatch' });
  });
  it('坏段四档映射穷尽：granular 缺陷码→{bad-crc,truncated,missing-seq,dup-hash}', () => {
    expect(walDefectTier('truncated')).toBe('truncated');
    expect(walDefectTier('bad-crc')).toBe('bad-crc');
    expect(walDefectTier('hash-mismatch')).toBe('bad-crc');
    expect(walDefectTier('generation-mismatch')).toBe('bad-crc');
    expect(walDefectTier('gap')).toBe('missing-seq');
    expect(walDefectTier('dup-seq')).toBe('dup-hash');
    expect(walDefectTier('dup-hash')).toBe('dup-hash');
  });
});

describe('Y1c T5a 契约冻结：ACK 三档+UI 四态+版本门拆分（偏离 38⑧）', () => {
  it('ACK 三档 Applied/Spooled/Durable——ACK 与承诺的持久等级严格一致', () => {
    expect(Object.keys(ACK_TIER_SEMANTICS).sort()).toEqual(['Applied', 'Durable', 'Spooled']);
  });
  it('UI 四态标签全集（Local 编辑中/Spooled/Applied/Durable）——Durable 不因 WS 连接或 SyncStatus 自动显示', () => {
    expect(SAVE_UI_STATE_LABELS).toEqual({
      local: '编辑中', spooled: '已接收正在保存', applied: '已同步等待数据库提交', durable: '已保存',
    });
  });
  it('resolveSaveUiState 全态可达+优先级：回执覆盖 lastLocalEditSeq→durable；否则随 syncPhase（local/spooled/applied）', () => {
    const receipt: BarrierReceipt = { nonce: 'n', clientSeq: 5, committedSeq: '42' };
    // durable：唯一到达路径=回执 clientSeq>=lastLocalEditSeq
    expect(resolveSaveUiState({ syncPhase: 'applied', lastLocalEditSeq: 5, receipt })).toBe('durable');
    expect(resolveSaveUiState({ syncPhase: 'applied', lastLocalEditSeq: 5, receipt: null })).toBe('applied');
    // 回执落后于新编辑 → 不显示 durable（回退 syncPhase）
    expect(resolveSaveUiState({ syncPhase: 'local', lastLocalEditSeq: 6, receipt })).toBe('local');
    expect(resolveSaveUiState({ syncPhase: 'spooled', lastLocalEditSeq: 7, receipt })).toBe('spooled');
    // 全态可达
    const states = new Set<SaveUiState>();
    for (const syncPhase of ['local', 'spooled', 'applied'] as const) {
      states.add(resolveSaveUiState({ syncPhase, lastLocalEditSeq: 1, receipt: null }));
    }
    states.add(resolveSaveUiState({ syncPhase: 'applied', lastLocalEditSeq: 1, receipt }));
    expect([...states].sort()).toEqual(['applied', 'durable', 'local', 'spooled']);
  });
  it('版本门硬三元 {protocolVersion,schemaVersion,historyId}——server 基准与既有单源常量对齐', () => {
    expect(VERSION_GATE_SERVER_BASE).toEqual({ protocolVersion: CLIENT_PROTOCOL_VERSION, schemaVersion: CANVAS_DOC_SCHEMA_VERSION });
    expect(VERSION_GATE_SERVER_BASE.protocolVersion).toBe(3);
    expect(VERSION_GATE_SERVER_BASE.schemaVersion).toBe(3);
  });
  it('resolveVersionGate：三元精确匹配→allow；任一缺失/不匹配→client-outdated（硬门无区间协商）', () => {
    const server: VersionGateHardTriple = { protocolVersion: 3, schemaVersion: 3, historyId: 'h1' };
    expect(resolveVersionGate(server, server)).toBe('allow');
    expect(resolveVersionGate({ protocolVersion: 2, schemaVersion: 3, historyId: 'h1' }, server)).toBe('client-outdated');
    expect(resolveVersionGate({ protocolVersion: 4, schemaVersion: 3, historyId: 'h1' }, server)).toBe('client-outdated');  // 高于也拒（强刷）
    expect(resolveVersionGate({ protocolVersion: 3, schemaVersion: 2, historyId: 'h1' }, server)).toBe('client-outdated');
    expect(resolveVersionGate({ protocolVersion: 3, schemaVersion: 3, historyId: 'h2' }, server)).toBe('client-outdated');
    expect(resolveVersionGate({ schemaVersion: 3, historyId: 'h1' }, server)).toBe('client-outdated');                      // 缺 protocolVersion
    expect(resolveVersionGate(undefined, server)).toBe('client-outdated');
  });
  it('修正 #8 allowFirstConnect：首连无 historyId（protocol/schema 匹配）→ allow 放行（非 4406——auth 回执下发 historyId 客户端持久化）', () => {
    const server: VersionGateHardTriple = { protocolVersion: 3, schemaVersion: 3, historyId: 'h1' };
    // 首连=无本地缓存键五元历史——historyId 无值（区分「无值」与「有值不匹配」）
    expect(resolveVersionGate({ protocolVersion: 3, schemaVersion: 3 }, server)).toBe('allow');
    expect(resolveVersionGate({ protocolVersion: 3, schemaVersion: 3, historyId: undefined }, server)).toBe('allow');
    // 有值不匹配→仍 4406（同代 PITR 面归 resolveAuthHistoryVerdict/4406 硬门——本门不豁免）
    expect(resolveVersionGate({ protocolVersion: 3, schemaVersion: 3, historyId: 'h-old' }, server)).toBe('client-outdated');
  });
  it('修正 #8 正交性：protocolVersion 或 schemaVersion 不匹配与首连正交——首连也 4406（版本硬门不因首连豁免）', () => {
    const server: VersionGateHardTriple = { protocolVersion: 3, schemaVersion: 3, historyId: 'h1' };
    expect(resolveVersionGate({ protocolVersion: 2, schemaVersion: 3 }, server)).toBe('client-outdated');   // 首连+协议旧
    expect(resolveVersionGate({ protocolVersion: 4, schemaVersion: 3 }, server)).toBe('client-outdated');   // 首连+协议新（高于也拒）
    expect(resolveVersionGate({ protocolVersion: 3, schemaVersion: 2 }, server)).toBe('client-outdated');   // 首连+schema 旧
  });
  it('Y1c 码载荷：4410 三分/4411/4412/4413（Retry-After）/4406（带硬门三元）——码值与 collab-close-code 单源一致', () => {
    const payloads: CollabY1cClosePayload[] = [
      { code: CollabCloseCode.GENERATION_SUPERSEDED, reason: 'doc-generation-stale' },
      { code: CollabCloseCode.GENERATION_SUPERSEDED, reason: 'doc-vacuuming', discardLocalCache: true },
      { code: CollabCloseCode.GENERATION_SUPERSEDED, reason: SERVER_RESTORED_TERMINAL_REASON },
      { code: CollabCloseCode.FRAME_MALFORMED, reason: FRAME_MALFORMED_REASON },
      { code: CollabCloseCode.RESYNC_REQUIRED, reason: RESYNC_REQUIRED_REASON },
      { code: CollabCloseCode.MAINTENANCE_FREEZE, reason: MAINTENANCE_FREEZE_REASON, retryAfterMs: 30_000 },
      { code: CollabCloseCode.CLIENT_OUTDATED, reason: CLIENT_OUTDATED_REASON, gate: { protocolVersion: 3, schemaVersion: 3, historyId: 'h1' } },
    ];
    expect(payloads.map((p) => p.code)).toEqual([4410, 4410, 4410, 4411, 4412, 4413, 4406]);
    expect(CollabCloseCode.WAL_FSYNC_EIO).toBe(1011);
  });
});

describe('Y1c T5a 契约冻结：帧闸数字（单源派生表）', () => {
  it('普通帧闸=2×maxTxBytes=512KB（collab-limits updateFrameGate 同式——spec 旧文 1MiB 作废）', () => {
    expect(NORMAL_FRAME_GATE_BYTES).toBe(2 * QUOTA_DEFAULTS.maxTxBytes);
    expect(NORMAL_FRAME_GATE_BYTES).toBe(524_288);
  });
  it('SS2 帧闸=maxDocBytes+FRAME_ALLOWANCE_BYTES=8454144（≈8.06MiB——与 api deriveCollabLimits ss2FrameGate 同式同源）', () => {
    expect(SS2_FRAME_GATE_BYTES).toBe(QUOTA_DEFAULTS.maxDocBytes + FRAME_ALLOWANCE_BYTES);
    expect(SS2_FRAME_GATE_BYTES).toBe(8_454_144);
  });
  it('WS maxPayload 16→9MiB：恰容纳 SS2 闸（>8454144）且不为 16MiB 纯攻击面留余', () => {
    expect(COLLAB_WS_MAX_PAYLOAD_BYTES).toBe(9_437_184);
    expect(COLLAB_WS_MAX_PAYLOAD_BYTES).toBeGreaterThan(SS2_FRAME_GATE_BYTES);
    expect(COLLAB_WS_MAX_PAYLOAD_BYTES).toBeLessThan(16_777_216);
  });
  it('认证后 per-connection 入站排队上限=2×ss2FrameGate，超限 close 1009（库 MessageTooBig 单源）', () => {
    expect(INBOUND_QUEUE_LIMIT_BYTES).toBe(2 * SS2_FRAME_GATE_BYTES);
    expect(INBOUND_QUEUE_LIMIT_BYTES).toBe(16_908_288);
    expect(INBOUND_QUEUE_OVER_LIMIT_CLOSE_CODE).toBe(CollabCloseCode.LIB_MESSAGE_TOO_BIG);
    expect(INBOUND_QUEUE_OVER_LIMIT_CLOSE_CODE).toBe(1009);
  });
  it('SS2 大帧并发信号量：per-project 1+全局内存预算（初始工程值 4×ss2FrameGate≈32MiB——T33 观测后调）', () => {
    expect(SS2_SEMAPHORE_PER_PROJECT).toBe(1);
    expect(SS2_SEMAPHORE_GLOBAL_BUDGET_BYTES).toBe(4 * SS2_FRAME_GATE_BYTES);
  });
  it('HTTP seed 端点废止 T29 触发条件数字化：cold p95>3s 或 loop block>50ms', () => {
    expect(HTTP_SEED_RETIRE_TRIGGERS).toEqual({ coldP95Ms: 3_000, eventLoopBlockMs: 50 });
  });
});

describe('Y1c T5a 契约冻结：版本维度表（单名单义）', () => {
  it('nodeVersion=节点末次变更 feedSeq；feedSeq 跨代不重置——语义表全集冻结', () => {
    expect(VERSION_DIMENSIONS.nodeVersion).toContain('feedSeq');
    expect(VERSION_DIMENSIONS.feedSeq).toContain('跨代不重置');
    expect(Object.keys(VERSION_DIMENSIONS).sort()).toEqual([
      'appliedSeq', 'artifactRev', 'docSeq', 'execSeq', 'feedSeq', 'generation', 'nodeVersion',
      'pgSeq', 'snapshotRev', 'spoolHeadSeq', 'vacuumEpoch', 'walCheckpointSeq', 'walSeq',
    ]);
  });
  it('废止名单：projectedEventVersion/projectedExecSeq（+spec §5.2 同句 eventVersion）禁复活', () => {
    expect(DEPRECATED_VERSION_DIMENSION_KEYS).toContain('projectedEventVersion');
    expect(DEPRECATED_VERSION_DIMENSION_KEYS).toContain('projectedExecSeq');
    expect(DEPRECATED_VERSION_DIMENSION_KEYS).toContain('eventVersion');
  });
});

describe('Y1c T5a 契约冻结：客户端半链（providerVersion h=/缓存键五元/ETag）', () => {
  it('providerVersion 带 h=<historyId>：format/parse 往返（缺省 null）', () => {
    expect(formatProviderHistoryParam('h-2026-10-24-a')).toBe('h=h-2026-10-24-a');
    expect(formatProviderHistoryParam('h-x')).toBe('h=h-x');
    expect(parseProviderHistoryParam(formatProviderHistoryParam('h-2026-10-24-a'))).toBe('h-2026-10-24-a');
  });
  it('解析：URL search 串取 h= 值；无 h=→null', () => {
    expect(parseProviderHistoryParam('csv=3&cb=build9&h=h-2026-10-24-a')).toBe('h-2026-10-24-a');
    expect(parseProviderHistoryParam('csv=3&cb=build9')).toBeNull();
    expect(parseProviderHistoryParam('')).toBeNull();
  });
  it('h= 编解码对称（评审 Minor#2）：format 补 encodeURIComponent——含保留字符 historyId 往返恒等且安全字符输出逐字节不变', () => {
    // 安全字符（RFC 3986 unreserved）——encodeURIComponent 不动，既有断言面零破坏
    expect(formatProviderHistoryParam('h-2026-10-24-a')).toBe('h=h-2026-10-24-a');
    expect(formatProviderHistoryParam('h-x')).toBe('h=h-x');
    // 保留字符（空格、%、&、=、?、#）与非 ASCII——format→parse 往返恒等
    for (const h of ['a b/c%d', 'x&y=z?q#r', 'ü-mlaut']) {
      expect(parseProviderHistoryParam(formatProviderHistoryParam(h))).toBe(h);
    }
  });
  it('h= 解析防御（评审 Minor#2）：畸形 % 串 parse 归 null 不抛 URIError（URL 由调用方构造不可信）', () => {
    expect(parseProviderHistoryParam('h=%zz')).toBeNull();
    expect(parseProviderHistoryParam('csv=3&h=tail%')).toBeNull();
  });
  it('本地缓存键五元 (uid,pid,generation,schemaVersion,historyId)——任一元不同则键不同（换代清整族不靠改键）', () => {
    const base: LocalCacheKeyFiveTuple = { uid: 'u1', pid: 'p1', generation: 3, schemaVersion: 3, historyId: 'h1' };
    const k0 = formatLocalCacheKey(base);
    expect(typeof k0).toBe('string');
    expect(k0.length).toBeGreaterThan(0);
    expect(formatLocalCacheKey({ ...base, historyId: 'h2' })).not.toBe(k0);
    expect(formatLocalCacheKey({ ...base, generation: 4 })).not.toBe(k0);
    expect(formatLocalCacheKey({ ...base, schemaVersion: 4 })).not.toBe(k0);
    expect(formatLocalCacheKey({ ...base, uid: 'u2' })).not.toBe(k0);
    expect(formatLocalCacheKey({ ...base, pid: 'p2' })).not.toBe(k0);
    expect(formatLocalCacheKey(base)).toBe(k0);   // 确定性
  });
  it('onAuthenticate 先比 historyId 再比 generation（堵同代 PITR 客户端 SS2 复活）', () => {
    const server = { historyId: 'h-new', generation: 5 };
    const v = (c: Parameters<typeof resolveAuthHistoryVerdict>[0]): AuthHistoryVerdict =>
      resolveAuthHistoryVerdict(c, server);
    expect(v({ historyId: 'h-new', generation: 5 })).toBe('ok');
    // 同代 PITR：generation 相等但 historyId 不匹配 → server-restored（historyId 先比——generation 相等救不了它）
    expect(v({ historyId: 'h-old', generation: 5 })).toBe('server-restored');
    expect(v({ historyId: 'h-old', generation: 9 })).toBe('server-restored');   // historyId 先于 generation
    // historyId 匹配下的代际差：客户端旧→换代通道；客户端新于服务端→恢复态
    expect(v({ historyId: 'h-new', generation: 4 })).toBe('doc-generation-stale');
    expect(v({ historyId: 'h-new', generation: 6 })).toBe('server-restored');
    // 首连无 historyId：服务端 auth 回执下发并客户端持久化——非 mismatch
    expect(v({ historyId: undefined, generation: 5 })).toBe('ok');
  });
  it('ETag=generation:pgSeq（恢复后无 304 旧内容——堵同代 PITR 客户端 SS2 复活）', () => {
    expect(formatDocETag({ generation: 3, pgSeq: 42n })).toBe('3:42');
    expect(formatDocETag({ generation: 10, pgSeq: 0n })).toBe('10:0');
    expect(formatDocETag({ generation: 4, pgSeq: 12345678901234567890n })).toBe('4:12345678901234567890');   // u64 全域十进制
  });
});

describe('Y1c T5a 契约冻结：barrier/WAL/并发语料 fixture 自洽（T8/T9/T10 消费面）', () => {
  it('并发语料：期望分布恰含两档（self-contained/missing-predecessor）且各 purpose 齐备', () => {
    const corpus = buildTwoClientConcurrentCorpus();
    const kinds = new Set(corpus.entries.map((e) => e.expect));
    expect(kinds).toEqual(new Set(['self-contained', 'missing-predecessor']));
    const purposes = new Set(corpus.entries.map((e) => e.purpose));
    expect(purposes).toEqual(new Set(['ss2-self-contained', 'incremental', 'missing-predecessor', 'hole', 'concurrent']));
    expect(corpus.duplicatePair.frame.byteLength).toBeGreaterThan(0);
    expect(corpus.concurrentSameKeyFrames.a).not.toEqual(corpus.concurrentSameKeyFrames.b);
  });
});

describe('Y1c T5a 契约冻结：wal-fault/barrier 语料不变式（评审 Important#2——零测试消费面补齐）', () => {
  const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
    a.length === b.length && a.every((v, i) => v === b[i]);

  it('wal-fault：帧级 fault 的 frameIndex 全部落在 frames 界内（物化器按文件契约对 frames[frameIndex] 执行——撕裂尾须存在第 4 帧可撕，Important#1 回归锁）', () => {
    const corpus = buildWalFaultCorpus({ historyId: 'h-fixture-2026-10-24' });
    let frameLevelFaults = 0;
    for (const f of corpus) {
      if (f.fault == null || !('frameIndex' in f.fault)) continue;
      frameLevelFaults += 1;
      expect(f.fault.frameIndex).toBeGreaterThanOrEqual(0);
      expect(f.fault.frameIndex).toBeLessThan(f.frames.length);   // 越界=物化器读 undefined
    }
    expect(frameLevelFaults).toBe(5);   // 五帧级形态齐备（bad-crc/truncated/missing-seq/dup×2）
  });

  it('wal-fault：dup 两形态载荷与原帧逐字节相等——dup-seq-same-hash 同 seq 同 payload；dup-hash-new-seq 载荷=repeatOf 帧 payload 且 seq 为新', () => {
    const corpus = buildWalFaultCorpus({ historyId: 'h-fixture-2026-10-24' });
    const sameSeq = corpus.find((f) => f.fault?.kind === 'dup-seq-same-hash')!;
    const fault = sameSeq.fault as { kind: 'dup-seq-same-hash'; frameIndex: number };
    const dup = sameSeq.frames[fault.frameIndex];
    const orig = sameSeq.frames.find((fr, i) => i < fault.frameIndex && fr.walSeq === dup.walSeq)!;
    expect(orig).toBeDefined();                                   // 旧 seq 重放须有对应原帧
    expect(bytesEqual(dup.payload, orig.payload)).toBe(true);     // 载荷逐字节相等（同 hash 的语料前提）
    expect(dup.generation ?? 3).toBe(orig.generation ?? 3);
    const newSeq = corpus.find((f) => f.fault?.kind === 'dup-hash-new-seq')!;
    const nf = newSeq.fault as { kind: 'dup-hash-new-seq'; frameIndex: number; repeatOf: number };
    expect(nf.repeatOf).toBeGreaterThanOrEqual(0);
    expect(nf.repeatOf).toBeLessThan(newSeq.frames.length);
    expect(bytesEqual(newSeq.frames[nf.frameIndex].payload, newSeq.frames[nf.repeatOf].payload)).toBe(true);
    expect(newSeq.frames[nf.frameIndex].walSeq).not.toBe(newSeq.frames[nf.repeatOf].walSeq);   // 新 seq 承载旧 hash
  });

  it('wal-fault：expectedQuarantine 为真 ⇒ expectedReplayPrefix 恒空（自动扫描零帧重放——history-mismatch=整段 fail-closed；timestamp-fence=修正 #6 后 recoverySuspect 恢复怀疑态，重放归 T8 恢复流裁定非静默丢段）', () => {
    const corpus = buildWalFaultCorpus({ historyId: 'h-fixture-2026-10-24', epochStartedAtMs: Date.UTC(2026, 9, 24, 13, 0, 0) });
    const quarantined = corpus.filter((f) => f.expectedQuarantine != null);
    expect(quarantined.length).toBe(2);   // history-mismatch + timestamp-fence 两段级形态
    for (const f of quarantined) expect(f.expectedReplayPrefix).toEqual([]);
  });

  it('wal-fault：epochStartedAtMs 缺省=完好段成立下界（评审 Minor#5 隐式耦合显式化）——非栅栏条目对缺省 epoch 两维皆 false、timestamp-fence 条目确落 recoverySuspect（修正 #6 分派）', () => {
    const corpus = buildWalFaultCorpus({ historyId: 'h-fixture-2026-10-24' });   // 不传 epochStartedAtMs——取缺省下界
    const sysDefault = { historyId: 'h-fixture-2026-10-24', epochStartedAtMs: walFixtureHeader().lastWriteAtMs };
    for (const f of corpus) {
      if (f.expectedQuarantine == null) {
        expect(shouldQuarantineSegment(f.header, sysDefault)).toEqual({ quarantine: false, recoverySuspect: false });
      } else if (f.expectedQuarantine === 'timestamp-fence') {
        // timestamp-fence 条目段头直载栅栏值（lastWriteAtMs=epoch+5s）——修正 #6 后落 recoverySuspect 档；
        // history-mismatch 条目段头未物化故障（fault 由 T8 物化器注入）——不在本断言面（真值表测试已覆盖）
        expect(shouldQuarantineSegment(f.header, sysDefault))
          .toEqual({ quarantine: false, recoverySuspect: true, reason: 'timestamp-fence' });
      }
    }
  });

  it('barrier：全部回执 nonce/clientSeq 回显请求（幂等匹配面）；nonceRetry 两回执逐字段等值；错误回执同形带 committedSeq', () => {
    const c = buildBarrierCorpus();
    c.concurrentTabs.requests.forEach((req, i) => {
      expect(c.concurrentTabs.receipts[i].nonce).toBe(req.nonce);
      expect(c.concurrentTabs.receipts[i].clientSeq).toBe(req.clientSeq);
    });
    expect(c.nonceRetry.receipts[0]).toEqual(c.nonceRetry.receipts[1]);   // 幂等——重试同结果
    expect(c.nonceRetry.receipts[0].nonce).toBe(c.nonceRetry.request.nonce);
    expect(c.nonceRetry.receipts[0].clientSeq).toBe(c.nonceRetry.request.clientSeq);
    for (const { request, receipt } of [c.maintenanceReject, c.barrierFailed]) {
      expect(receipt.nonce).toBe(request.nonce);                          // nonce 回显——幂等匹配键
      expect(typeof receipt.committedSeq).toBe('string');
    }
    expect(c.maintenanceReject.receipt.error).toBe('maintenance');
    expect(c.barrierFailed.receipt.error).toBe('BARRIER_FAILED');
  });
});
