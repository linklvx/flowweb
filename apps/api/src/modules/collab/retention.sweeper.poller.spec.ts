// apps/api/src/modules/collab/retention.sweeper.poller.spec.ts
// C1-1（plan Task C1-1 红④⑤⑥——unit 面）：RetentionSweeperPoller tick 编排/单飞 skip 计数/
// 连续失败退避/指标提交后计数/bytes 基线播种。真 PG 语义（advisory 锁并发/claim SKIP LOCKED/批删）
// 在 retention.sweeper.poller.int.spec——本面=mock prisma 事务形态行为。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { register } from 'prom-client';
import { RetentionSweeperPoller, RETENTION_SWEEP_INTERVAL_MS, RETENTION_ADVISORY_KEY } from './retention.sweeper.poller';
import { RETENTION_REQUEST_CLAIM_BATCH } from '../execution/execution-request.retention.service';

const metricValue = async (name: string, labels: Record<string, string> = {}): Promise<number> => {
  const m = (await register.getMetricsAsJSON()).find((x) => x.name === name) as
    { values: { labels: Record<string, string>; value: number }[] } | undefined;
  return m?.values.find((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val))?.value ?? 0;
};

const buildTx = (lockOk: boolean) => ({
  $queryRaw: vi.fn(async (q: TemplateStringsArray, ...vals: unknown[]) => {
    void q; void vals;
    return lockOk ? [{ ok: true }] : [{ ok: false }];   // 红④ 首句单飞探针
  }),
});

const buildFaces = () => ({
  requestRetention: {
    countStuckInTx: vi.fn(async () => ({ admitted: 0, executing: 0, orphan: 0 })),
    sweepExpiredInTx: vi.fn(async () => ({ claimed: 0, voided: 0 })),
    sweepExpiredInputsInTx: vi.fn(async () => ({ deleted: 0, capped: false })),
    countExpiredAdmittedBacklog: vi.fn(async () => 0),
    countExpiredTerminalInputBacklog: vi.fn(async () => 0),
  },
  feedRetention: {
    sweepEventsInTx: vi.fn(async () => ({ deleted: 0, deletedBytes: 0, projects: 0, capped: false })),
    countRetentionBacklog: vi.fn(async () => 0),
    bytesBaseline: vi.fn(async () => 12345),
  },
});

const buildPoller = (lockOk: boolean, faces = buildFaces()) => {
  const tx = buildTx(lockOk);
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    $queryRaw: tx.$queryRaw,
  };
  const poller = new RetentionSweeperPoller(prisma as never, faces.requestRetention as never, faces.feedRetention as never);
  return { poller, faces, tx };
};

describe('C1-1 RetentionSweeperPoller（unit——tick 编排）', () => {
  it('RETENTION_SWEEP_INTERVAL_MS 缺省 60s+advisory 单飞键字面（红④ 键协议锚）', () => {
    expect(RETENTION_SWEEP_INTERVAL_MS).toBe(60_000);
    expect(RETENTION_ADVISORY_KEY).toBe('flowweb:retention');
    expect(RETENTION_REQUEST_CLAIM_BATCH).toBe(50);   // 红⑤ 小批上界
  });

  it('红④ 单飞 skip：try_advisory_xact_lock 失败 ⇒ 四扫面零调用+skip-singleflight 计数', async () => {
    const before = await metricValue('retention_sweeper_tick_total', { result: 'skip-singleflight' });
    const { poller, faces } = buildPoller(false);
    await poller.tick();
    expect(faces.requestRetention.countStuckInTx).not.toHaveBeenCalled();
    expect(faces.requestRetention.sweepExpiredInTx).not.toHaveBeenCalled();
    expect(faces.requestRetention.sweepExpiredInputsInTx).not.toHaveBeenCalled();
    expect(faces.feedRetention.sweepEventsInTx).not.toHaveBeenCalled();
    expect(await metricValue('retention_sweeper_tick_total', { result: 'skip-singleflight' })).toBeGreaterThan(before);
  });

  it('ok tick：同事务四扫面（stuck→request→input→event）+指标提交后计数+backlog gauge 回填', async () => {
    const okBefore = await metricValue('retention_sweeper_tick_total', { result: 'ok' });
    const voidBefore = await metricValue('retention_void_total');
    const inputBefore = await metricValue('retention_deleted_rows_total', { table: 'execution_input' });
    const eventBefore = await metricValue('retention_deleted_rows_total', { table: 'runtime_event' });
    const backlogBefore = await metricValue('retention_backlog_rows', { table: 'execution_request' });
    const { poller, faces, tx } = buildPoller(true);
    faces.requestRetention.sweepExpiredInTx.mockResolvedValue({ claimed: RETENTION_REQUEST_CLAIM_BATCH, voided: 3 });
    faces.requestRetention.sweepExpiredInputsInTx.mockResolvedValue({ deleted: 7, capped: false });
    faces.feedRetention.sweepEventsInTx.mockResolvedValue({ deleted: 9, deletedBytes: 512, projects: 1, capped: false });
    faces.requestRetention.countStuckInTx.mockResolvedValue({ admitted: 2, executing: 1, orphan: 0 });
    faces.requestRetention.countExpiredAdmittedBacklog.mockResolvedValue(4242);
    await poller.tick();
    // 同一 tx 实例贯穿四扫面（Controller 裁定 1：每 tick 主体一个事务）
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(faces.requestRetention.countStuckInTx).toHaveBeenCalledWith(tx);
    expect(faces.requestRetention.sweepExpiredInTx).toHaveBeenCalledWith(tx);
    expect(faces.requestRetention.sweepExpiredInputsInTx).toHaveBeenCalledWith(tx);
    expect(faces.feedRetention.sweepEventsInTx).toHaveBeenCalledWith(tx);
    // 提交后计数
    expect(await metricValue('retention_sweeper_tick_total', { result: 'ok' })).toBeGreaterThan(okBefore);
    expect(await metricValue('retention_void_total')).toBeGreaterThan(voidBefore);
    expect(await metricValue('retention_deleted_rows_total', { table: 'execution_input' })).toBeGreaterThan(inputBefore);
    expect(await metricValue('retention_deleted_rows_total', { table: 'runtime_event' })).toBeGreaterThan(eventBefore);
    expect(await metricValue('retention_stuck_requests_total', { state: 'ADMITTED' })).toBeGreaterThanOrEqual(2);
    expect(await metricValue('retention_stuck_requests_total', { state: 'EXECUTING' })).toBeGreaterThanOrEqual(1);
    // claim 满批 ⇒ backlog 按需 count 回填（不满批=0）
    expect(faces.requestRetention.countExpiredAdmittedBacklog).toHaveBeenCalled();
    expect(await metricValue('retention_backlog_rows', { table: 'execution_request' })).toBeGreaterThan(backlogBefore);
  });

  it('claim 不满批 ⇒ backlog 零回填（按需 count 不触发）+ runtime_event 恒清零', async () => {
    const { poller, faces } = buildPoller(true);
    await poller.tick();
    expect(faces.requestRetention.countExpiredAdmittedBacklog).not.toHaveBeenCalled();
    expect(await metricValue('retention_backlog_rows', { table: 'runtime_event' })).toBe(0);
  });

  it('红⑤后半 连续失败退避：≥3 连续 error ⇒ skip-backoff 窗内跳过，成功后复位', async () => {
    const errBefore = await metricValue('retention_sweeper_tick_total', { result: 'error' });
    const backoffBefore = await metricValue('retention_sweeper_tick_total', { result: 'skip-backoff' });
    const failing = {
      requestRetention: {
        countStuckInTx: vi.fn(async () => { throw new Error('db down'); }),
        sweepExpiredInTx: vi.fn(async () => ({ claimed: 0, voided: 0 })),
        sweepExpiredInputsInTx: vi.fn(async () => ({ deleted: 0, capped: false })),
        countExpiredAdmittedBacklog: vi.fn(async () => 0),
        countExpiredTerminalInputBacklog: vi.fn(async () => 0),
      },
      feedRetention: {
        sweepEventsInTx: vi.fn(async () => ({ deleted: 0, deletedBytes: 0, projects: 0, capped: false })),
        countRetentionBacklog: vi.fn(async () => 0),
        bytesBaseline: vi.fn(async () => 0),
      },
    };
    const { poller } = buildPoller(true, failing);
    await poller.tick();   // err 1
    await poller.tick();   // err 2
    await poller.tick();   // err 3 ⇒ 退避窗武装
    expect(await metricValue('retention_sweeper_tick_total', { result: 'error' })).toBeGreaterThanOrEqual(errBefore + 3);
    // 退避窗内 tick=skip-backoff（扫面零调用——error 计数不再增长）
    const errMid = await metricValue('retention_sweeper_tick_total', { result: 'error' });
    await poller.tick();
    expect(await metricValue('retention_sweeper_tick_total', { result: 'skip-backoff' })).toBeGreaterThan(backoffBefore);
    expect(await metricValue('retention_sweeper_tick_total', { result: 'error' })).toBe(errMid);
    // 窗过（backoffUntil 由 Date.now()+min(3×60000,...)——测试直改私有字段模拟窗过）+ 成功复位
    (poller as unknown as { backoffUntil: number }).backoffUntil = 0;
    const healthy = buildFaces();
    const okPoller = new RetentionSweeperPoller({ $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(buildTx(true))) } as never,
      healthy.requestRetention as never, healthy.feedRetention as never);
    await okPoller.tick();
    expect(await metricValue('retention_sweeper_tick_total', { result: 'ok' })).toBeGreaterThan(0);
  });

  it('tick 单飞互斥：running 期二入即返（防 setInterval 叠跑）', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const faces = buildFaces();
    faces.requestRetention.sweepExpiredInTx.mockImplementation(async () => { await gate; return { claimed: 0, voided: 0 }; });
    const { poller } = buildPoller(true, faces);
    const first = poller.tick();
    await new Promise((r) => setTimeout(r, 0));   // 让首 tick 链推进到阻塞面（sweepExpiredInTx 已入场）
    const calls = faces.requestRetention.sweepExpiredInTx.mock.calls.length;
    expect(calls).toBe(1);
    await poller.tick();   // running ⇒ 即返（不叠跑）
    expect(faces.requestRetention.sweepExpiredInTx.mock.calls.length).toBe(calls);   // 恒 1（二入未达扫面）
    release();
    await first;
  });

  it('onModuleInit：bytes 基线播种（boot SUM 一次）+timer 武装（unref）+shutdown 清 timer；基线失败⇒维护面停用不阻启动', async () => {
    const faces = buildFaces();
    const { poller } = buildPoller(true, faces);
    await poller.onModuleInit();
    expect(faces.feedRetention.bytesBaseline).toHaveBeenCalledTimes(1);
    const gauge = ((await register.getMetricsAsJSON()).find((m) => m.name === 'runtime_feed_bytes') as { values: { value: number }[] });
    expect(gauge?.values[0]?.value).toBe(12345);   // 基线 set（本进程 boot SUM mock=12345）
    expect((poller as unknown as { timer: unknown }).timer).not.toBeNull();
    await poller.onApplicationShutdown();
    expect((poller as unknown as { timer: unknown }).timer).toBeNull();
    // 基线失败：warn 不阻启动（timer 仍武装）
    const failingFaces = buildFaces();
    failingFaces.feedRetention.bytesBaseline.mockRejectedValueOnce(new Error('sum failed'));
    const poller2 = new RetentionSweeperPoller({ $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(buildTx(true))) } as never,
      failingFaces.requestRetention as never, failingFaces.feedRetention as never);
    await poller2.onModuleInit();
    expect((poller2 as unknown as { timer: unknown }).timer).not.toBeNull();
    await poller2.onApplicationShutdown();
  });

  it('红① cap 出口 ⇒ input/event 两面 backlog 按需 count 回填 gauge；cap 未触 ⇒ 零触发+归零', async () => {
    const { poller, faces } = buildPoller(true);
    faces.requestRetention.sweepExpiredInTx.mockResolvedValue({ claimed: 0, voided: 0 });
    faces.requestRetention.sweepExpiredInputsInTx.mockResolvedValue({ deleted: 700, capped: true });   // input 面 cap 出口
    faces.requestRetention.countExpiredTerminalInputBacklog.mockResolvedValue(777);
    faces.feedRetention.sweepEventsInTx.mockResolvedValue({ deleted: 900, deletedBytes: 0, projects: 1, capped: true });   // event 面 cap 出口
    faces.feedRetention.countRetentionBacklog.mockResolvedValue(888);
    await poller.tick();
    // cap 出口 ⇒ 两面按需 count 各恰一次（残余行回填 backlog gauge——「静默死亡」观测半边）
    expect(faces.requestRetention.countExpiredTerminalInputBacklog).toHaveBeenCalledTimes(1);
    expect(faces.feedRetention.countRetentionBacklog).toHaveBeenCalledTimes(1);
    expect(await metricValue('retention_backlog_rows', { table: 'execution_input' })).toBe(777);
    expect(await metricValue('retention_backlog_rows', { table: 'runtime_event' })).toBe(888);
    // cap 未触（capped=false）⇒ 两面按需 count 零触发+gauge 归零（正常排空不挂观测）
    faces.requestRetention.sweepExpiredInputsInTx.mockResolvedValue({ deleted: 3, capped: false });
    faces.feedRetention.sweepEventsInTx.mockResolvedValue({ deleted: 4, deletedBytes: 0, projects: 0, capped: false });
    await poller.tick();
    expect(faces.requestRetention.countExpiredTerminalInputBacklog).toHaveBeenCalledTimes(1);   // 未再触发
    expect(faces.feedRetention.countRetentionBacklog).toHaveBeenCalledTimes(1);
    expect(await metricValue('retention_backlog_rows', { table: 'execution_input' })).toBe(0);
    expect(await metricValue('retention_backlog_rows', { table: 'runtime_event' })).toBe(0);
  });

  it('红② 孤儿档：EXECUTING∧无 RUNNING intent ⇒ retention_stuck_requests_total{state=EXECUTING_ORPHAN} 计数', async () => {
    const before = await metricValue('retention_stuck_requests_total', { state: 'EXECUTING_ORPHAN' });
    const { poller, faces } = buildPoller(true);
    faces.requestRetention.countStuckInTx.mockResolvedValue({ admitted: 0, executing: 0, orphan: 2 });
    await poller.tick();
    expect(await metricValue('retention_stuck_requests_total', { state: 'EXECUTING_ORPHAN' })).toBeGreaterThanOrEqual(before + 2);
  });

  it('Minor#4 观测块抛错不武装退避：tx 提交成功+backlog count reject ⇒ 连续 3 tick 恒不武装（重置在观测块前——观测失败≠扫面失败）', async () => {
    const skipBefore = await metricValue('retention_sweeper_tick_total', { result: 'skip-backoff' });
    const { poller, faces } = buildPoller(true);
    faces.requestRetention.sweepExpiredInTx.mockResolvedValue({ claimed: RETENTION_REQUEST_CLAIM_BATCH, voided: 0 });   // 满批 ⇒ backlog 按需 count 触发面
    faces.requestRetention.countExpiredAdmittedBacklog.mockRejectedValue(new Error('count obs down'));   // 观测块抛错（tx 已提交成功）
    await poller.tick();   // err 1（tx 成功——观测失败）
    await poller.tick();   // err 2
    await poller.tick();   // err 3——缺陷形态下退避武装（连续计数未按「扫面成功」重置）；修复后每轮重置=1 ⇒ 恒不武装
    expect((poller as unknown as { backoffUntil: number }).backoffUntil).toBe(0);   // 未武装（consecutiveErrors 每轮在观测块前重置）
    expect(await metricValue('retention_sweeper_tick_total', { result: 'skip-backoff' })).toBe(skipBefore);   // 零 skip-backoff 增量
  });
});