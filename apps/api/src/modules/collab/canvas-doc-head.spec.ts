// Y1c T7 ②缺头三态（unit——mock prisma）：读 CanvasDoc/RuntimeFeedCursor/SystemHistory 头行的
// 读取面必须三分「行存在/行缺失/值为零」——缺失=fail-closed 显式分支，禁 `?? 0` 兜底静默默认。
// （卡文先红②：本 spec 先于 canvas-doc-head.ts 落地——红=模块缺失；绿=三态契约锁定。
//  真 PG 行为面在 canvas-doc-genesis.int.spec.ts。）
import { describe, it, expect, vi } from 'vitest';
import {
  readCanvasDocHead,
  requireCanvasDocHead,
  readRuntimeFeedCursor,
  requireRuntimeFeedCursor,
  requireSystemHistory,
} from './canvas-doc-head';

const ZERO_HEAD = {
  projectId: 'p1', generation: 0, schemaVersion: 3, vacuumEpoch: 0,
  currentSnapshotRev: 0n, walCheckpointSeq: 0n, pgSeq: 0n,
  purgeBelowSeq: null, maintenanceId: null,
};

function mockDb(rows: {
  head?: unknown; cursor?: unknown; systemHistory?: unknown;
}) {
  return {
    canvasDoc: { findUnique: vi.fn().mockResolvedValue(rows.head ?? null) },
    runtimeFeedCursor: { findUnique: vi.fn().mockResolvedValue(rows.cursor ?? null) },
    systemHistory: { findUnique: vi.fn().mockResolvedValue(rows.systemHistory ?? null) },
  } as any;
}

describe('Y1c T7 缺头三态：readCanvasDocHead', () => {
  it('行缺失 → {status:"missing"}（非伪造零值头——`?? 0` 兜底=违例形态）', async () => {
    const r = await readCanvasDocHead(mockDb({}), 'p1');
    expect(r).toEqual({ status: 'missing' });
  });

  it('行存在且全零 → {status:"found"} 且水位 0n（值为零≠行缺失——三态第二/三态分立）', async () => {
    const r = await readCanvasDocHead(mockDb({ head: { ...ZERO_HEAD } }), 'p1');
    expect(r.status).toBe('found');
    if (r.status === 'found') {
      expect(r.row.pgSeq).toBe(0n);
      expect(r.row.walCheckpointSeq).toBe(0n);
      expect(r.row.currentSnapshotRev).toBe(0n);
      expect(r.row.maintenanceId).toBeNull();
    }
  });

  it('行存在且非零 → found 带真值（pgSeq/walCheckpointSeq/generation 透传无默认化）', async () => {
    const r = await readCanvasDocHead(mockDb({
      head: { ...ZERO_HEAD, generation: 2, pgSeq: 7n, walCheckpointSeq: 9n, currentSnapshotRev: 1n, maintenanceId: 'm1' },
    }), 'p1');
    expect(r.status).toBe('found');
    if (r.status === 'found') {
      expect(r.row.generation).toBe(2);
      expect(r.row.pgSeq).toBe(7n);
      expect(r.row.walCheckpointSeq).toBe(9n);
      expect(r.row.maintenanceId).toBe('m1');
    }
  });

  it('查询谓词单点：where={projectId}（读面唯一入口——禁第二查询形状）', async () => {
    const db = mockDb({ head: { ...ZERO_HEAD } });
    await readCanvasDocHead(db, 'p1');
    expect(db.canvasDoc.findUnique).toHaveBeenCalledTimes(1);
    expect(db.canvasDoc.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: 'p1' } }));
  });
});

describe('Y1c T7 缺头三态：requireCanvasDocHead（fail-closed 消费面）', () => {
  it('行缺失 → throw（canvasDocHeadMissing 标记——显式分支非静默默认）', async () => {
    await expect(requireCanvasDocHead(mockDb({}), 'p1')).rejects.toMatchObject({
      canvasDocHeadMissing: true,
    });
  });

  it('行存在（含全零） → 返回行（零值合法态不拒）', async () => {
    const row = await requireCanvasDocHead(mockDb({ head: { ...ZERO_HEAD } }), 'p1');
    expect(row.pgSeq).toBe(0n);
  });
});

describe('Y1c T7 缺头三态：readRuntimeFeedCursor / requireRuntimeFeedCursor', () => {
  it('行缺失 → missing / throw（feed 游标缺行=feed 平面未初始化——禁默认 lastSeq=0 静默续读）', async () => {
    const db = mockDb({});
    expect(await readRuntimeFeedCursor(db, 'p1')).toEqual({ status: 'missing' });
    await expect(requireRuntimeFeedCursor(db, 'p1')).rejects.toMatchObject({ runtimeFeedCursorMissing: true });
  });

  it('行存在零值 → found 0n（genesis 初态）/ 非零 → found 真值', async () => {
    expect(await readRuntimeFeedCursor(mockDb({ cursor: { projectId: 'p1', lastSeq: 0n, minRetainedSeq: 0n } }), 'p1'))
      .toEqual({ status: 'found', row: { projectId: 'p1', lastSeq: 0n, minRetainedSeq: 0n } });
    expect(await readRuntimeFeedCursor(mockDb({ cursor: { projectId: 'p1', lastSeq: 3n, minRetainedSeq: 1n } }), 'p1'))
      .toEqual({ status: 'found', row: { projectId: 'p1', lastSeq: 3n, minRetainedSeq: 1n } });
  });
});

describe('Y1c T7 SystemHistory fail-closed 读取（requireSystemHistory）', () => {
  it('行缺失 → throw systemHistoryMissing（不自动建不自动修复——卡文勘误语义）', async () => {
    await expect(requireSystemHistory(mockDb({}))).rejects.toMatchObject({ systemHistoryMissing: true });
  });

  it('historyId 为零值（"0"/空串）→ throw（缺失/为零同拒——bump 前置纪律）', async () => {
    await expect(requireSystemHistory(mockDb({ systemHistory: { historyId: '0' } }))).rejects.toMatchObject({ systemHistoryMissing: true });
    await expect(requireSystemHistory(mockDb({ systemHistory: { historyId: '' } }))).rejects.toMatchObject({ systemHistoryMissing: true });
  });

  it('行在且非零 → 返回 {historyId, epochStartedAtMs}（id=1 单行权威读——T13 快照两字段）', async () => {
    const epoch = new Date('2026-10-01T00:00:00Z');
    const r = await requireSystemHistory(mockDb({ systemHistory: { historyId: 'h-1', epochStartedAt: epoch } }));
    expect(r).toEqual({ historyId: 'h-1', epochStartedAtMs: epoch.getTime() });
  });

  it('epochStartedAt 缺失或为零 → throw（T13：时间戳栅栏求值基准失真 fail-closed——缺头三态纪律禁 ?? 0 静默默认）', async () => {
    await expect(requireSystemHistory(mockDb({ systemHistory: { historyId: 'h-1' } }))).rejects.toMatchObject({ systemHistoryMissing: true });
    await expect(requireSystemHistory(mockDb({ systemHistory: { historyId: 'h-1', epochStartedAt: new Date(0) } }))).rejects.toMatchObject({ systemHistoryMissing: true });
  });
});
