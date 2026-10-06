import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { ensureProjectFixture, cleanupProjectFixture } from '../../test-utils/db-fixtures';
import * as Y from 'yjs';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'y0a1-hydration-int';

maybe('loadForHydration（真 PG）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);

  beforeAll(async () => { await ensureProjectFixture(prisma, PID); });
  afterAll(async () => { await cleanupProjectFixture(prisma, PID); await prisma.$disconnect(); });

  async function reset() {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
  }

  it('装载=快照+seq>stateSeq 增量，与全量重放逐位等价', async () => {
    await reset();
    const d1 = new Y.Doc(); d1.getMap('nodes').set('a', new Y.Map([['x', 1]]));
    await repo.append(PID, Y.encodeStateAsUpdate(d1));
    await repo.compact(PID);
    const d2 = new Y.Doc(); Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1));
    d2.getMap('nodes').set('b', new Y.Map([['x', 2]]));
    await repo.append(PID, Y.encodeStateAsUpdate(d2));
    const { state, updates, stateSeq } = await repo.loadForHydration(PID);
    expect(state).not.toBeNull();
    expect(updates.length).toBe(1);                    // 只拉 seq>stateSeq 的一行
    expect(stateSeq).toBeGreaterThan(0n);
    const revived = new Y.Doc();
    Y.applyUpdate(revived, new Uint8Array(state!));
    for (const u of updates) Y.applyUpdate(revived, new Uint8Array(u));
    expect(revived.getMap('nodes').has('a')).toBe(true);
    expect(revived.getMap('nodes').has('b')).toBe(true);
  });

  it('分页取尽：520 行增量全部装载（页 500）', async () => {
    await reset();
    const base = new Y.Doc(); base.getMap('nodes').set('base', new Y.Map([['x', 0]]));
    await repo.append(PID, Y.encodeStateAsUpdate(base));
    await repo.compact(PID);
    for (let i = 0; i < 520; i++) {
      const d = new Y.Doc(); Y.applyUpdate(d, Y.encodeStateAsUpdate(base));
      d.getMap('nodes').set(`k${i}`, new Y.Map([['x', i]]));
      await repo.append(PID, Y.encodeStateAsUpdate(d));
    }
    const { updates } = await repo.loadForHydration(PID);
    expect(updates.length).toBe(520);
    const snap = await prisma.canvasDoc.findUnique({ where: { projectId: PID } });
    const revived = new Y.Doc();
    Y.applyUpdate(revived, new Uint8Array(snap!.state));
    for (const u of updates) Y.applyUpdate(revived, new Uint8Array(u));
    expect(revived.getMap('nodes').size).toBe(521);
  }, 30_000);

  it('超时自愈（仅可重试类）：P2028 首败 → compact(6s/1s 自愈预算) → 重试装载(2s/500ms) 成功（vi.spyOn 白盒；自愈增量 ≤8s——spec v2.4 契约 13）', async () => {
    await reset();
    const d = new Y.Doc(); d.getMap('nodes').set('s', new Y.Map([['x', 1]]));
    await repo.append(PID, Y.encodeStateAsUpdate(d));
    await repo.compact(PID);   // 先真 compact 造快照行——重试装载（真实现）拿到非空 state
    const loadSpy = vi.spyOn(repo, 'loadForHydration')
      .mockRejectedValueOnce(Object.assign(new Error('Transaction query timeout'), { code: 'P2028' }));
    const compactSpy = vi.spyOn(repo, 'compact').mockResolvedValue({ compacted: true });
    try {
      const { state } = await repo.hydrateWithRecovery(PID);
      expect(state).not.toBeNull();
      expect(compactSpy).toHaveBeenCalledWith(PID, { timeoutMs: 6_000, maxWaitMs: 1_000 });
      expect(loadSpy).toHaveBeenCalledTimes(2);   // 首败+重试（重试带 {timeoutMs:2_000,maxWaitMs:500}）
      expect(loadSpy).toHaveBeenLastCalledWith(PID, { timeoutMs: 2_000, maxWaitMs: 500 });
    } finally {
      loadSpy.mockRestore();
      compactSpy.mockRestore();
    }
  });

  it('非可重试类（P1001 连接失败）直接上抛——不 compact 不重试（防故障放大，负例真红门）', async () => {
    await reset();
    const loadSpy = vi.spyOn(repo, 'loadForHydration')
      .mockRejectedValueOnce(Object.assign(new Error("Can't reach database server"), { code: 'P1001' }));
    const compactSpy = vi.spyOn(repo, 'compact').mockResolvedValue({ compacted: true });
    try {
      await expect(repo.hydrateWithRecovery(PID)).rejects.toMatchObject({ code: 'P1001' });
      expect(compactSpy).not.toHaveBeenCalled();
      expect(loadSpy).toHaveBeenCalledTimes(1);
    } finally {
      loadSpy.mockRestore();
      compactSpy.mockRestore();
    }
  });

  it('P2024（连接池饥饿）v2.4 移出自愈集——直接上抛不 compact 不重试（自愈动作自身需持池连接=饥饿期零成功率纯放大）', async () => {
    await reset();
    const loadSpy = vi.spyOn(repo, 'loadForHydration')
      .mockRejectedValueOnce(Object.assign(new Error('Timed out fetching a new connection from the connection pool'), { code: 'P2024' }));
    const compactSpy = vi.spyOn(repo, 'compact').mockResolvedValue({ compacted: true });
    try {
      await expect(repo.hydrateWithRecovery(PID)).rejects.toMatchObject({ code: 'P2024' });
      expect(compactSpy).not.toHaveBeenCalled();
      expect(loadSpy).toHaveBeenCalledTimes(1);
    } finally {
      loadSpy.mockRestore();
      compactSpy.mockRestore();
    }
  });

  it('分类终判锚：code 存在（P2024）即使 message 含 timeout 字样也不自愈（防 Prisma 措辞漂移把池饥饿拉回自愈集——对 message 回退实现红）', async () => {
    await reset();
    const loadSpy = vi.spyOn(repo, 'loadForHydration')
      .mockRejectedValueOnce(Object.assign(new Error('connection pool timeout'), { code: 'P2024' }));
    const compactSpy = vi.spyOn(repo, 'compact').mockResolvedValue({ compacted: true });
    try {
      await expect(repo.hydrateWithRecovery(PID)).rejects.toMatchObject({ code: 'P2024' });
      expect(compactSpy).not.toHaveBeenCalled();
      expect(loadSpy).toHaveBeenCalledTimes(1);
    } finally {
      loadSpy.mockRestore();
      compactSpy.mockRestore();
    }
  });

  it('message 回退正例：code 缺失但 message 含 timeout → 走自愈（回退仅对无 code 错误生效）', async () => {
    await reset();
    const d = new Y.Doc(); d.getMap('nodes').set('t', new Y.Map([['x', 1]]));
    await repo.append(PID, Y.encodeStateAsUpdate(d));
    await repo.compact(PID);
    const loadSpy = vi.spyOn(repo, 'loadForHydration')
      .mockRejectedValueOnce(new Error('statement timeout'));   // 无 code
    const compactSpy = vi.spyOn(repo, 'compact').mockResolvedValue({ compacted: true });
    try {
      const { state } = await repo.hydrateWithRecovery(PID);
      expect(state).not.toBeNull();
      expect(compactSpy).toHaveBeenCalledTimes(1);
      expect(loadSpy).toHaveBeenCalledTimes(2);
    } finally {
      loadSpy.mockRestore();
      compactSpy.mockRestore();
    }
  });
});
