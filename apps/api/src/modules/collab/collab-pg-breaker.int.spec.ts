// apps/api/src/modules/collab/collab-pg-breaker.int.spec.ts
// Y0b-5 T16（plan 红测：int 故障注入 PG 停→open→ready reason=db-unavailable；恢复→半开探测→closed）。
// 注入形态说明（Y0a-2 基座核对后裁定）：既有基座=DB 触发器（collab-kill9-drill RAISE EXCEPTION——
// 语句级 P0001，非连接族错，分类器按设计不算 PG 故障 ⇒ 无法推闸）。本 spec 用**真实连接级注入**：
// dead-port PrismaClient（datasourceUrl 端口改 :1+connect_timeout=1——PG 停机的连接层等价形态）产出
// **真 PrismaClientInitializationError**（实证 code=undefined——分类器 message 回退路径由此锚定），
// 经 gateway loadDocument/store 真实路径喂 breaker（零手造错误形状）；恢复腿换接真库 repo=真实半开探测。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { register } from 'prom-client';
import { CollabGateway } from './collab.gateway';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabPgBreakerService } from './collab-pg-breaker.service';
import { CollabReadyService } from './collab-ready.service';
import { CollabSpoolService } from './collab-spool.service';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { createLeaseStub } from './test-utils/lease-stub';
import { makeSpoolDir } from '../../test-utils/spool-dir';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'y0b5-breaker-int';
const COOLDOWN_MS = 250;   // 注短冷却——恢复腿真 timer 等待 <0.5s

function deadUrl(): string {
  const raw = process.env.DATABASE_URL!;
  if (!/:(\d+)\//.test(raw)) throw new Error(`deadUrl setup 错误：DATABASE_URL 无显式端口，dead-port 注入不可行：${raw}`);
  const u = raw.replace(/:(\d+)\//, ':1/');
  return u + (u.includes('?') ? '&' : '?') + 'connect_timeout=1&pool_timeout=1';   // 快失败（~1s/次）
}

async function gaugeValue(name: string): Promise<number | undefined> {
  const m = register.getSingleMetric(name) as any;
  return m ? (await m.get()).values[0]?.value : undefined;
}

maybe('PG 熔断（真实连接级注入：dead-port → open → 准入/store 短路 → 恢复 → 半开 → closed）', () => {
  const prisma = new PrismaClient();
  const deadClient = new PrismaClient({ datasourceUrl: deadUrl() });
  const realRepo = new CanvasDocUpdateRepository(prisma as any);
  const deadRepo = new CanvasDocUpdateRepository(deadClient as any);

  let spoolDir = '';
  let spoolCleanup: () => Promise<void> = async () => {};
  let gateway: CollabGateway;
  let breaker: CollabPgBreakerService;
  let spool: CollabSpoolService;
  const loadSpy = vi.spyOn(deadRepo, 'hydrateWithRecovery');   // describe 作用域 spy（类型随 repo 收窄；计数增量断言）

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID);
    await ensureLeaseFixture(prisma, realRepo);
    const d = await makeSpoolDir('y0b5-breaker-int-');
    spoolDir = d.dir;
    spoolCleanup = d.cleanup;
    spool = new CollabSpoolService(spoolDir);
    spool.setOwner('int-test-lease');
    breaker = new CollabPgBreakerService(COOLDOWN_MS);
    gateway = new CollabGateway(
      prisma as any, new EventEmitter2() as any, deadRepo as any, createLeaseStub() as any,
      { resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 'y0a-fixture-team' }) } as any,
      49300, undefined, undefined, undefined, spool, undefined, breaker,
    );
    (gateway as any).collabState = 'serving';
  });
  afterAll(async () => {
    await restoreLeaseRow(prisma);
    await cleanupProjectFixture(prisma, PID);
    await prisma.$disconnect();
    await deadClient.$disconnect().catch(() => {});
    await spoolCleanup();
  });

  it('故障腿：真实连接失败装载→open（窗口判据经 gateway 真路径），gauge=1', async () => {
    // 真实停机在负载下产出 connection（init error）/pool（$transaction maxWait 先到=P2024）混合流
    // ——时序随负载漂移（本 spec 首跑实证），轮询至 open=如实反映生产（5 个连接族样本 30s 窗内聚满即开）
    for (let i = 0; i < 20 && breaker.stateName() !== 'open'; i++) {
      await gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: `project:${PID}`, socketId: 's' } as any).catch(() => {});
    }
    expect(breaker.stateName()).toBe('open');
    expect(await gaugeValue('collab_pg_breaker_state')).toBe(1);
    const failures: any = register.getSingleMetric('collab_pg_breaker_failures_total');
    const conn = (await failures.get()).values.find((s: any) => s.labels.class === 'connection');
    expect(conn?.value).toBeGreaterThanOrEqual(5);   // 推闸样本全为连接族（开=判据满足的推论）
  }, 60_000);

  it('熔断面①准入：open 期装载直接拒（reason=db-unavailable）且**零 Prisma 调用**（防每条新装载等满交互事务超时）', async () => {
    const before = loadSpy.mock.calls.length;
    await expect(gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: `project:${PID}`, socketId: 's' } as any))
      .rejects.toMatchObject({ reason: 'db-unavailable' });
    expect(loadSpy.mock.calls.length).toBe(before);   // 零 DB——真 repo spy 计数不增
  });

  it('熔断面②store 短路：open 期批直落 spool（fsync 落盘）+零 PG 尝试；ready 503 reason=db-unavailable', async () => {
    const doc = new Y.Doc(); doc.getMap('nodes').set('n1', new Y.Map([['x', 1]]));
    (gateway as any).pendingQueues.set(PID, [Y.encodeStateAsUpdate(doc)]);
    const ok = await gateway.hooks.onStoreDocument({ document: {} as any, documentName: `project:${PID}` } as any);
    expect(ok).toBe(false);
    expect(spool.hasFrames(PID)).toBe(true);   // BOI：批在 spool（fsync 落盘非内存态）
    const ready = await new CollabReadyService(
      prisma as any, createLeaseStub() as any, gateway, spool,
      { status: 'ready', connect: async () => {}, ping: async () => 'PONG' } as any,
      { getPresence: async () => ({ registered: 1, waiting: 0 }) } as any,   // Y0c T29-II：workers 维度供数桩
    ).getReady();
    expect(ready.status).toBe(503);
    expect(ready.body.reason).toBe('db-unavailable');   // plan 红测：ready reason=db-unavailable
  });

  it('恢复腿：换接真库 repo→冷却后半开探测（store 走 PG+补排空 spool 帧）→closed+ready 200', async () => {
    (gateway as any).repo = realRepo;   // PG 恢复=连接层可达（真库 repo 接管）
    await new Promise((r) => setTimeout(r, COOLDOWN_MS + 150));   // 真冷却→half-open
    expect(breaker.stateName()).toBe('half-open');
    const doc = new Y.Doc(); doc.getMap('nodes').set('n2', new Y.Map([['y', 2]]));
    (gateway as any).pendingQueues.set(PID, [Y.encodeStateAsUpdate(doc)]);
    const ok = await gateway.hooks.onStoreDocument({ document: {} as any, documentName: `project:${PID}` } as any);
    expect(ok).toBe(true);                       // 探测走 PG：append 真落库（批+排空帧一并）
    expect(breaker.stateName()).toBe('closed');  // 半开一次成功→closed
    expect(await gaugeValue('collab_pg_breaker_state')).toBe(0);
    expect(spool.hasFrames(PID)).toBe(false);    // 补排空：故障腿帧已 confirm 回收
    const rows = await prisma.canvasDocUpdate.count({ where: { projectId: PID } });
    expect(rows).toBeGreaterThanOrEqual(1);      // 帧真落 PG（非仅内存确认）
    const ready = await new CollabReadyService(
      prisma as any, createLeaseStub() as any, gateway, spool,
      { status: 'ready', connect: async () => {}, ping: async () => 'PONG' } as any,
      { getPresence: async () => ({ registered: 1, waiting: 0 }) } as any,   // Y0c T29-II：workers 维度供数桩
    ).getReady();
    expect(ready.status).toBe(200);              // 熔断解除——部署门放行
  }, 15_000);
});
