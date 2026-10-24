// packages/shared/src/collab/runtime-event.spec.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段；spec v5.4 §7——D5 per-project feedSeq）：Runtime Feed 契约冻结的
// 契约测试——EVENT_KINDS 五值精确冻结、payload envelope v:1 各 kind 键清单、payload≤64KB、PII 扫描
// 纯函数（禁 prompt/正文/URL 原文）、RuntimeFeedCursor upsert SQL+genesis 同事务、锁序「业务行→counter」、
// 保留期 7d/100k、feed 故障语料自洽（乱序/缺口/旧代/游标失效/提交顺序交错/反向锁序负控）。
// 本文件=T22（feed 投递）/T26（义务观察器）/T31（故障演练）的消费契约锁。
import { describe, expect, it } from 'vitest';
import {
  EVENT_KINDS, RuntimeEventKind, RuntimeEventPayload, RuntimeEventRow,
  RUNTIME_EVENT_PAYLOAD_MAX_BYTES, RUNTIME_EVENT_PAYLOAD_VERSION, runtimeEventPayloadPiiViolations,
  RUNTIME_FEED_CURSOR_UPSERT_SQL, RUNTIME_FEED_LOCK_ORDER, RuntimeFeedCursorRow,
  RUNTIME_EVENT_RETENTION_DAYS, RUNTIME_EVENT_RETENTION_MAX_PER_PROJECT, RUNTIME_FEED_DELIVERY_CONTRACT,
} from './runtime-event';
import { buildFeedFaultCorpus, FeedFaultCase } from '../testing/y1c-feed-fault-corpus';

describe('Y1c T5b 契约冻结：RuntimeEvent taxonomy（spec §7 v5.4⑭——exact）', () => {
  it('EVENT_KINDS 五值精确冻结：exec.status/exec.artifact/media.fact/node.deleted/doc.vacuumed', () => {
    expect([...EVENT_KINDS]).toEqual(['exec.status', 'exec.artifact', 'media.fact', 'node.deleted', 'doc.vacuumed']);
    expect(new Set(EVENT_KINDS).size).toBe(5);
  });
  it('payload envelope v:1——各 kind 键清单精确冻结（nodeVersion/lifecycleSeq=BigInt String 化；media.fact 带 natural 尺寸）', () => {
    const payloads: RuntimeEventPayload[] = [
      { v: 1, kind: 'exec.status', nodeId: 'n1', status: 'RUNNING', attempts: 1, nodeVersion: '7' },
      { v: 1, kind: 'exec.status', nodeId: 'n1', status: 'FAILED', attempts: 2, errorCode: 'E_PROV', artifactRev: 3, nodeVersion: '9' },
      { v: 1, kind: 'exec.artifact', nodeId: 'n1', mediaId: 'm1', resultRef: 'ref-1', artifactRev: 3, nodeVersion: '9' },
      { v: 1, kind: 'media.fact', mediaId: 'm1', naturalWidth: 1920, naturalHeight: 1080, factVersion: 2, nodeVersion: '11' },
      { v: 1, kind: 'media.fact', mediaId: 'm1', naturalWidth: 800, naturalHeight: 600, downscaledFrom: { width: 1600, height: 1200 }, factVersion: 3, nodeVersion: '12' },
      { v: 1, kind: 'node.deleted', nodeId: 'n1', lifecycleSeq: '15', nodeVersion: '15' },
      { v: 1, kind: 'doc.vacuumed', generation: 4 },
    ];
    for (const p of payloads) expect(p.v).toBe(RUNTIME_EVENT_PAYLOAD_VERSION);
    expect(Object.keys(payloads[0]).sort()).toEqual(['attempts', 'kind', 'nodeId', 'nodeVersion', 'status', 'v']);
    expect(Object.keys(payloads[1]).sort()).toEqual(['artifactRev', 'attempts', 'errorCode', 'kind', 'nodeId', 'nodeVersion', 'status', 'v']);
    expect(Object.keys(payloads[2]).sort()).toEqual(['artifactRev', 'kind', 'mediaId', 'nodeId', 'nodeVersion', 'resultRef', 'v']);
    expect(Object.keys(payloads[3]).sort()).toEqual(['factVersion', 'kind', 'mediaId', 'naturalHeight', 'naturalWidth', 'nodeVersion', 'v']);
    expect(Object.keys(payloads[5]).sort()).toEqual(['kind', 'lifecycleSeq', 'nodeId', 'nodeVersion', 'v']);
    expect(Object.keys(payloads[6]).sort()).toEqual(['generation', 'kind', 'v']);
  });
  it('RuntimeEventRow 列集冻结：@@unique([projectId,feedSeq])+@@index([projectId,generation,feedSeq])+docSeq? 下界列', () => {
    const row: RuntimeEventRow = {
      id: 'cuid-e1', projectId: 'p1', generation: 3, feedSeq: 42n, kind: 'exec.status',
      payload: { v: 1, kind: 'exec.status', nodeId: 'n1', status: 'RUNNING', attempts: 1, nodeVersion: '7' },
      docSeq: 40n, createdAtMs: 1,
    };
    expect(Object.keys(row).sort()).toEqual(['createdAtMs', 'docSeq', 'feedSeq', 'generation', 'id', 'kind', 'payload', 'projectId']);
    if (row.payload.kind === 'doc.vacuumed') throw new Error('unreachable');
    expect(typeof row.payload.nodeVersion).toBe('string');   // BigInt 一律 String() 进 payload（kind 窄化后可达）
  });
  it('payload≤64KB 超限拒绝写入（业务 bug 非截断——resultText 大文本放 NodeArtifact 事件只带引用）', () => {
    expect(RUNTIME_EVENT_PAYLOAD_MAX_BYTES).toBe(64 * 1024);
  });
});

describe('Y1c T5b 契约冻结：PII 扫描纯函数（事件写入前——禁 prompt/正文/URL 原文）', () => {
  it('全部五 kind 合法 payload 零违例（冻结 taxonomy 不误伤）', () => {
    const legal: RuntimeEventPayload[] = [
      { v: 1, kind: 'exec.status', nodeId: 'n1', status: 'RUNNING', attempts: 1, nodeVersion: '7' },
      { v: 1, kind: 'exec.artifact', nodeId: 'n1', artifactRev: 1, nodeVersion: '7' },
      { v: 1, kind: 'media.fact', mediaId: 'm1', naturalWidth: 1, naturalHeight: 1, factVersion: 1, nodeVersion: '7' },
      { v: 1, kind: 'node.deleted', nodeId: 'n1', lifecycleSeq: '1', nodeVersion: '7' },
      { v: 1, kind: 'doc.vacuumed', generation: 4 },
    ];
    for (const p of legal) expect(runtimeEventPayloadPiiViolations(p)).toEqual([]);
  });
  it('业务 bug 形态拦截：prompt/正文/URL/HTML 键命中即报（返回违例键清单）', () => {
    expect(runtimeEventPayloadPiiViolations({ v: 1, kind: 'exec.status', nodeId: 'n1', status: 'RUNNING', attempts: 1, nodeVersion: '7', promptText: '画一只猫' })).toContain('promptText');
    expect(runtimeEventPayloadPiiViolations({ v: 1, kind: 'exec.status', nodeId: 'n1', status: 'RUNNING', attempts: 1, nodeVersion: '7', resultText: '生成结果正文', mediaUrl: 'https://x/y.png' }).length).toBe(2);
    expect(runtimeEventPayloadPiiViolations({ v: 1, kind: 'exec.status', nodeId: 'n1', status: 'RUNNING', attempts: 1, nodeVersion: '7', html: '<p>x</p>' })).toContain('html');
  });
});

describe('Y1c T5b 契约冻结：RuntimeFeedCursor+锁序（spec §7 v5.4⑫⑮——偏离 30 v5.2）', () => {
  it('RuntimeFeedCursorRow 列集冻结：projectId PK+lastSeq+minRetainedSeq', () => {
    const row: RuntimeFeedCursorRow = { projectId: 'p1', lastSeq: 42n, minRetainedSeq: 7n };
    expect(Object.keys(row).sort()).toEqual(['lastSeq', 'minRetainedSeq', 'projectId']);
  });
  it('upsert SQL 契约：INSERT ON CONFLICT DO UPDATE SET lastSeq=lastSeq+1 RETURNING（空项目首事件 0 行问题修）+genesis 同事务插行+行锁持有至提交', () => {
    expect(RUNTIME_FEED_CURSOR_UPSERT_SQL).toContain('ON CONFLICT ("projectId") DO UPDATE SET "lastSeq" = "RuntimeFeedCursor"."lastSeq" + 1');
    expect(RUNTIME_FEED_CURSOR_UPSERT_SQL).toContain('RETURNING "lastSeq"');
    expect(RUNTIME_FEED_CURSOR_UPSERT_SQL).toMatch(/^INSERT INTO "RuntimeFeedCursor"/);
  });
  it('锁序冻结：业务行→counter（CanvasDoc 普通 SELECT/FOR SHARE——不与维护/快照互斥）；counter 恒最后拿', () => {
    expect([...RUNTIME_FEED_LOCK_ORDER]).toEqual(['business-rows', 'runtime-feed-cursor']);
  });
  it('保留期冻结：7 天或 100k 条/项目（先到为准）——清理 worker 更新 minRetainedSeq+runtime_feed_bytes 指标；feedSeq 跨代不重置', () => {
    expect(RUNTIME_EVENT_RETENTION_DAYS).toBe(7);
    expect(RUNTIME_EVENT_RETENTION_MAX_PER_PROJECT).toBe(100_000);
  });
  it('交付契约注记：唯一交付=HTTP 游标（stateless/心跳只带 latestFeedSeq 不带事件体）', () => {
    expect(RUNTIME_FEED_DELIVERY_CONTRACT.uniqueChannel).toContain('HTTP 游标');
    expect(RUNTIME_FEED_DELIVERY_CONTRACT.notificationBody).toContain('不带事件体');
  });
});

describe('Y1c T5b 契约冻结：feed 故障语料自洽（T22/T31 消费面——形态对照 y1c-wal-fault-corpus）', () => {
  const corpus = buildFeedFaultCorpus();
  it('六形态齐备：乱序去重/缺口/旧代/游标失效两档/提交顺序交错/反向锁序负控（heavy）', () => {
    const names = corpus.map((c) => c.name).join('|');
    expect(names).toContain('乱序到达');
    expect(names).toContain('缺口');
    expect(names).toContain('旧代');
    expect(names).toContain('historyId 不匹配');
    expect(names).toContain('游标过期');
    expect(names).toContain('提交顺序交错');
    expect(names).toContain('反向锁序负控');
  });
  it('全部事件 kind ⊆ EVENT_KINDS 且 payload v:1；feedSeq 正整数', () => {
    for (const c of corpus) {
      for (const e of c.events) {
        expect((EVENT_KINDS as readonly string[])).toContain(e.kind);
        expect(e.payload.v).toBe(1);
        expect(e.feedSeq > 0n).toBe(true);
      }
    }
  });
  it('反向锁序负控恰一例且标 heavy（受控死锁用例不进 PR——静态锁序 lint+正常序压力替代）', () => {
    const heavy = corpus.filter((c) => c.heavy);
    expect(heavy.length).toBe(1);
    expect(heavy[0]!.expect.verdict).toBe('deadlock-negative-control-heavy');
  });
  it('期望语义自洽：乱序例 applied=升序去重；缺口例 feedSeq 有洞；交错例事件流连续（锁内分配=分配序≡提交序）', () => {
    const byVerdict = (v: FeedFaultCase['expect']['verdict']) => corpus.find((c) => c.expect.verdict === v)!;
    const disorder = byVerdict('apply-ascending');
    if (disorder.expect.verdict !== 'apply-ascending') throw new Error('unreachable');
    expect(disorder.expect.applied.map((s) => s)).toEqual([...new Set(disorder.expect.applied)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));   // 升序+去重
    const gap = byVerdict('gap-refetch-from-cursor');
    const seqs = gap.events.map((e) => e.feedSeq);
    expect(seqs.every((s, i) => i === 0 || s === seqs[i - 1]! + 1n)).toBe(true);   // 批内自身连续
    expect(gap.events[0]!.feedSeq > gap.cursor.feedSeq + 1n).toBe(true);           // 洞在 cursor 边界（缺 4）
    const interleave = byVerdict('no-gap-locked-allocation');
    const iseq = interleave.events.map((e) => e.feedSeq);
    expect(iseq.every((s, i) => i === 0 || s === iseq[i - 1]! + 1n)).toBe(true);   // 读者永不见提交序洞
    const stale = byVerdict('isolate-stale-generation');
    expect(stale.events.every((e) => e.generation < stale.cursor.generation)).toBe(true);
  });
  it('游标失效两档：historyId 不匹配（清投影）/cursor<minRetainedSeq（全量快照）', () => {
    const hist = corpus.find((c) => c.expect.verdict === 'full-snapshot-history-mismatch')!;
    expect(hist.historyId !== hist.cursor.historyId).toBe(true);
    const expired = corpus.find((c) => c.expect.verdict === 'full-snapshot-cursor-expired')!;
    expect(expired.cursor.feedSeq < expired.minRetainedSeq).toBe(true);
  });
  it('RuntimeEventKind 类型面：语料 kind 收敛于 union（编译级——五值外不可构造）', () => {
    const kinds = new Set<RuntimeEventKind>(corpus.flatMap((c) => c.events.map((e) => e.kind)));
    expect(kinds.size).toBeGreaterThan(0);
  });
});
