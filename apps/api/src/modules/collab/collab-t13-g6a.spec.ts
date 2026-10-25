// apps/api/src/modules/collab/collab-t13-g6a.spec.ts
// Y1c T13：G6a 门——单实例故障恢复（doc 平面）· boot 恢复路径生产接线（ADR-01 §3 恢复顺序）。
// 红相（基线 e642bb37 实证）：boot init=旧链 spool.scan()（recoverScan 零生产调用——T8 遗留 #1）——
// ①recoverScan 不被调 ②historyId 不匹配段照常 serving（段头双栅栏零消费）③PG 前缀 violation 照常
// serving ④restore.lock marker 零读取（忘 bump 形态时间戳栅栏永不求值——F-S4-5 信号①缺失）。
// 恢复顺序=段头 historyId+lastWriteAt 时间戳栅栏双校验（不匹配 quarantine/suspect）→WAL 前缀→
// PG 前缀校验→重建 appliedSeq→开放写；无法证明一致=fail-closed 拒服务（start-failed 不 listen）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { register } from 'prom-client';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService, encodeWalSegmentBytes, walSegmentFileName } from './collab-spool.service';
import { buildWalFaultCorpus } from '@flowweb/shared';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { WAL_SEGMENT_HEADER_LAYOUT } from '@flowweb/shared';

const HISTORY_ID = 'g6a-history';

/** 直构 gateway boot 装置（I3 形态——listen spy 免真端口；prisma mock 走 requireSystemHistory 读面）。 */
function makeBoot(spool: CollabSpoolService, opts?: {
  historyId?: string;
  epochStartedAt?: Date;
  floors?: Array<{ projectId: string; generation: number; pgSeq: bigint }>;
}) {
  const prisma = {
    systemHistory: { findUnique: vi.fn().mockResolvedValue({
      historyId: opts?.historyId ?? HISTORY_ID,
      epochStartedAt: opts?.epochStartedAt ?? new Date(),
    }) },
  };
  const repo = createMockRepo({ pgSeqFloors: vi.fn(async () => opts?.floors ?? []) });
  const gateway = new CollabGateway(
    prisma as never, new EventEmitter2() as never, repo as never,
    createLeaseStub() as never, { resolve: vi.fn() } as never, 48300, 300, undefined, undefined, spool,
  );
  return { gateway, facade: gatewayFacade(gateway) };
}

/** 篡改段头 historyId（offset 80/64B zero-pad utf8）+重算段头 CRC（offset 160 覆盖 [0,160)）。 */
async function patchSegHistoryId(spoolDir: string, newHistoryId: string): Promise<void> {
  const files: string[] = [];
  for (const e of await readdir(spoolDir, { withFileTypes: true })) {
    if (e.isDirectory()) files.push(...(await readdir(join(spoolDir, e.name))).map((f) => join(spoolDir, e.name, f)));
    else files.push(join(spoolDir, e.name));
  }
  const segs = files.filter((f) => f.endsWith('.spool'));
  expect(segs.length, '装置前置：恰一段（append 生成）').toBeGreaterThan(0);
  for (const seg of segs) {
    const buf = await readFile(seg);
    const id = Buffer.alloc(WAL_ID_FIELD_BYTES);
    id.write(newHistoryId, 0, 'utf8');
    buf.set(id, WAL_SEGMENT_HEADER_LAYOUT.historyId.offset);
    buf.writeUInt32LE(crc32(buf.subarray(0, WAL_SEGMENT_HEADER_LAYOUT.headerCrc32.offset)) >>> 0, WAL_SEGMENT_HEADER_LAYOUT.headerCrc32.offset);
    await writeFile(seg, buf);
  }
}

import { WAL_ID_FIELD_BYTES } from '@flowweb/shared';

/** 构造真段（owner 子目录+当前 historyId）——spool 生产路径 append（真 fsync）。 */
async function seedFrame(spool: CollabSpoolService, pid: string, payload: Uint8Array) {
  await spool.append(pid, payload);
}

const frameOf = (key: string) => {
  const d = new Y.Doc();
  d.getMap('nodes').set(key, { v: 1 });
  return Y.encodeStateAsUpdate(d);
};

afterEach(() => { vi.restoreAllMocks(); });

describe('Y1c T13 G6a：boot 恢复路径生产接线（ADR-01 §3——recoverScan 消费+fail-closed）', () => {
  it('K1 恢复顺序接线（红=recoverScan 零生产调用）：boot init 走 recoverScan（段头双栅栏+PG 前缀校验+水位重建）——旧链 scan 不再被调', async () => {
    const { dir, cleanup } = await makeSpoolDir('y1c-t13-k1-');
    try {
      const spool = new CollabSpoolService(dir);
      spool.setOwner('k1-owner');
      spool.setWalHistory(HISTORY_ID);
      await seedFrame(spool, 'p-k1', frameOf('k1'));
      const { gateway, facade } = makeBoot(spool);
      const listenSpy = facade.spyListenServer().mockResolvedValue(undefined);
      const recoverSpy = vi.spyOn(spool, 'recoverScan');
      const scanSpy = vi.spyOn(spool, 'scan');
      try {
        await facade.startCollabAfterLease();
        expect(gateway.getCollabState(), '正常恢复→serving（开放写）').toBe('serving');
        expect(recoverSpy, 'boot init 调 recoverScan（T8 遗留 #1 生产接线）').toHaveBeenCalledTimes(1);
        expect(scanSpy, '旧链 scan 从 boot 退役（recoverScan 覆盖截断/隔离处置）').not.toHaveBeenCalled();
        // 恢复顺序输入断言：SystemHistory 快照（historyId+epochStartedAtMs）+pgSeq 回调（pgSeqFloors 单源）
        const arg = recoverSpy.mock.calls[0]![0]!;
        expect(arg.systemHistory.historyId).toBe(HISTORY_ID);
        expect(typeof arg.systemHistory.epochStartedAtMs).toBe('number');
        expect(arg.pgSeq('p-k1')).toBe(0n);
        // 幸存帧经 boot replayAll 回灌（WAL 前缀→开放写）
        expect(await spool.peek('p-k1')).toHaveLength(0);
      } finally { listenSpy.mockRestore(); }
      await gateway.onApplicationShutdown();
    } finally { await cleanup(); }
  }, 15_000);

  it('K2 historyId 不匹配段 fail-closed（红=旧链 scan 不查栅栏照常 serving）：bump 后旧段≠SystemHistory→整段 quarantine 零重放+PG pgSeq 残留→链断 violation→boot 拒服务（start-failed 不 listen）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y1c-t13-k2-');
    try {
      const spool = new CollabSpoolService(dir);
      spool.setOwner('k2-owner');
      spool.setWalHistory(HISTORY_ID);
      await seedFrame(spool, 'p-k2', frameOf('k2'));   // 段帧 walSeq=1（pg_dump 恢复前已落 PG）
      await patchSegHistoryId(dir, 'stale-history-after-restore');   // pg_dump 恢复后旧段（bump 前）+CanvasDoc.pgSeq=1 残留（dump 行）
      // ADR-01 §3.2 I3：全段隔离+PG 残留 pgSeq>可证链尾（0）=同归 violation fail-closed
      const { gateway, facade } = makeBoot(spool, { floors: [{ projectId: 'p-k2', generation: 0, pgSeq: 1n }] });
      const listenSpy = facade.spyListenServer().mockResolvedValue(undefined);
      try {
        await facade.startCollabAfterLease();
        expect(gateway.getCollabState(), '无法证明一致=fail-closed 拒服务（ADR-01 §3.2 quarantine+violation 维）').toBe('start-failed');
        expect(listenSpy, '不 listen=不开放写').not.toHaveBeenCalled();
        // 整段 quarantine 持久（sidecar）+帧零重放（旧段禁复活——bump 后旧段禁重放）
        expect((await spool.quarantinedSegments()).length).toBe(1);
        expect(await spool.peek('p-k2')).toHaveLength(0);
      } finally { listenSpy.mockRestore(); }
      await gateway.onApplicationShutdown();
    } finally { await cleanup(); }
  }, 15_000);

  it('K3 PG 前缀 violation fail-closed（红=旧链无 PG 前缀校验照常 serving）：WAL 链断 lastGood<pgSeq=账本失真→boot 拒服务（证据保全禁截断续跑）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y1c-t13-k3-');
    try {
      const spool = new CollabSpoolService(dir);
      spool.setOwner('k3-owner');
      spool.setWalHistory(HISTORY_ID);
      await seedFrame(spool, 'p-k3', frameOf('k3a'));   // walSeq=1
      await seedFrame(spool, 'p-k3', frameOf('k3b'));   // walSeq=2
      // 构造致命缺陷：帧 2 walSeq 篡改为 4（gap=fatal→lastGood=1）+帧 CRC 重算（帧头 offset+8 u64；CRC 覆盖 walSeq 起）
      const seg = (await readdir(join(dir, 'k3-owner'))).find((f) => f.endsWith('.spool'));
      expect(seg, '装置前置：owner 子目录恰一段').toBeTruthy();
      const segPath = join(dir, 'k3-owner', seg!);
      const buf = await readFile(segPath);
      // 帧布局：164B 段头+帧1（52+payloadLen）+帧2；定位帧 2 起点=段头+帧 1 长度
      let off = 164;
      const len1 = buf.readUInt32LE(off);
      const frame2 = off + 52 + len1;
      buf.writeBigUInt64LE(4n, frame2 + 8);   // walSeq 2→4（gap）
      const flen = buf.readUInt32LE(frame2);
      const body = buf.subarray(frame2 + 8, frame2 + 52 + flen);   // CRC 覆盖域=walSeq 起（帧头 CRC 校验 body）
      buf.writeUInt32LE(crc32(body) >>> 0, frame2 + 4);
      await writeFile(segPath, buf);
      // PG 声称 pgSeq=3（>lastGood=1——PG 已提交帧 WAL 无法证明）
      const { gateway, facade } = makeBoot(spool, { floors: [{ projectId: 'p-k3', generation: 0, pgSeq: 3n }] });
      const listenSpy = facade.spyListenServer().mockResolvedValue(undefined);
      try {
        await facade.startCollabAfterLease();
        expect(gateway.getCollabState(), 'PG 前缀校验 violation=fail-closed（禁截断续跑——ADR-01 §3.2）').toBe('start-failed');
        expect(listenSpy).not.toHaveBeenCalled();
      } finally { listenSpy.mockRestore(); }
      await gateway.onApplicationShutdown();
    } finally { await cleanup(); }
  }, 15_000);

  it('K4 restore.lock marker+忘 bump 形态（红=marker 零读取）：时间戳栅栏求值（F-S4-5 信号①）→recoverySuspect 零重放+boot 拒服务；人工清 marker 后 boot 恢复开放', async () => {
    const { dir, cleanup } = await makeSpoolDir('y1c-t13-k4-');
    try {
      const spool = new CollabSpoolService(dir);
      spool.setOwner('k4-owner');
      spool.setWalHistory(HISTORY_ID);
      await seedFrame(spool, 'p-k4', frameOf('k4'));   // 段 lastWriteAt=now
      // 忘 bump 形态：historyId 匹配（未 bump）+段比 epoch 新（lastWriteAt>epochStartedAt——pg_dump 恢复后常态）
      const epoch = new Date(Date.now() - 3_600_000);
      const lockFile = join(dir, 'restore.lock');
      await writeFile(lockFile, 'restored-at ' + new Date().toISOString());
      const { gateway, facade } = makeBoot(spool, { epochStartedAt: epoch });
      const listenSpy = facade.spyListenServer().mockResolvedValue(undefined);
      try {
        await facade.startCollabAfterLease();
        expect(gateway.getCollabState(), '恢复怀疑态=重放归恢复流裁定（修正 #6）——boot fail-closed 拒服务').toBe('start-failed');
        expect(listenSpy).not.toHaveBeenCalled();
        expect(spool.suspectSegments(), 'recoverySuspect 分维可见（T8 遗留 #2 消费面）').toHaveLength(1);
        expect(await spool.peek('p-k4'), '怀疑段零帧重放（忘 bump 拦截——F-S4-5 定形面）').toHaveLength(0);

        // 人工处置（恢复流裁定等价物）：清 marker 后重启——正常恢复路径（不求值时间戳栅栏）
        await unlink(lockFile);
        const boot2 = makeBoot(spool, { epochStartedAt: epoch });
        const listen2 = boot2.facade.spyListenServer().mockResolvedValue(undefined);
        try {
          await boot2.facade.startCollabAfterLease();
          expect(boot2.gateway.getCollabState(), 'marker 清除=恢复怀疑态解除→正常恢复（段比 epoch 新=长命 epoch 常态不误伤）').toBe('serving');
        } finally { listen2.mockRestore(); }
        await boot2.gateway.onApplicationShutdown();
      } finally { listenSpy.mockRestore(); }
      await gateway.onApplicationShutdown();
    } finally { await cleanup(); }
  }, 20_000);

  it('K2b（M3 收口）pgSeq=0+全段隔离=合法续跑 serving（K2 只测 pgSeq 残留 blocked 侧——本用例补正向半直锚：丢帧全为未承诺 Durable 档 ADR-01 §3.2，拒服务判定=violation 维非 quarantine 维）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y1c-t13-k2b-');
    try {
      const spool = new CollabSpoolService(dir);
      spool.setOwner('k2b-owner');
      spool.setWalHistory(HISTORY_ID);
      await seedFrame(spool, 'p-k2b', frameOf('k2b'));   // 段帧 walSeq=1（无 PG 残留——floors 空集 pgSeq()=0n）
      await patchSegHistoryId(dir, 'stale-history-no-pg-residue');   // 全段 history-mismatch 隔离布景
      const { gateway, facade } = makeBoot(spool);       // floors 缺省 [] → pgSeq=0（对照 K2：floors pgSeq=1 残留）
      const listenSpy = facade.spyListenServer().mockResolvedValue(undefined);
      try {
        await facade.startCollabAfterLease();
        expect(gateway.getCollabState(), 'pgSeq=0+全隔离：maxSeq=0≮pgW=0 ⇒ violation 维不触发→合法续跑（开放写）').toBe('serving');
        expect((await spool.quarantinedSegments()).length, '隔离档照常可见（quarantine 维独立于拒服务判定）').toBe(1);
        expect(await spool.peek('p-k2b'), '零重放（隔离段帧不复活）').toHaveLength(0);
      } finally { listenSpy.mockRestore(); }
      await gateway.onApplicationShutdown();
    } finally { await cleanup(); }
  }, 15_000);

  it('K5 PG 不可用 boot：pgSeqFloors 抛错（恢复扫描前置输入不可达）→start-failed 不 listen（fail-closed 重试语义——不半截上线）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y1c-t13-k5-');
    try {
      const spool = new CollabSpoolService(dir);
      spool.setOwner('k5-owner');
      spool.setWalHistory(HISTORY_ID);
      await seedFrame(spool, 'p-k5', frameOf('k5'));
      const prisma = { systemHistory: { findUnique: vi.fn().mockResolvedValue({ historyId: HISTORY_ID, epochStartedAt: new Date() }) } };
      const repo = createMockRepo({ pgSeqFloors: vi.fn(async () => { throw new Error('pg unavailable (t13 k5)'); }) });
      const gateway = new CollabGateway(prisma as never, new EventEmitter2() as never, repo as never, createLeaseStub() as never, { resolve: vi.fn() } as never, 48300, 300, undefined, undefined, spool);
      const facade = gatewayFacade(gateway);
      const listenSpy = facade.spyListenServer().mockResolvedValue(undefined);
      try {
        await facade.startCollabAfterLease();
        expect(gateway.getCollabState(), 'PG 不可用=恢复输入不可达→fail-closed 拒服务').toBe('start-failed');
        expect(listenSpy).not.toHaveBeenCalled();
        expect(await spool.peek('p-k5'), '帧保留（WAL 磁盘安全——恢复后重放）').toHaveLength(1);
      } finally { listenSpy.mockRestore(); }
      await gateway.onApplicationShutdown();
    } finally { await cleanup(); }
  }, 15_000);

  it('K6 EIO fail-stop 后重启恢复（T8 契约面 G6a 收口）：EIO=walHealthy=false 停收不截断（段证据保留）→新实例（重启等价）recoverScan 裁定+帧恢复+walHealthy 复位', async () => {
    const { dir, cleanup } = await makeSpoolDir('y1c-t13-k6-');
    try {
      const s1 = new CollabSpoolService(dir);
      s1.setOwner('k6-owner');
      s1.setWalHistory(HISTORY_ID);
      await seedFrame(s1, 'p-k6', frameOf('k6a'));   // 好帧在段（EIO 前）
      const syncOrig = Object.getPrototypeOf(s1).syncSegmentHandle;
      (s1 as unknown as { syncSegmentHandle: unknown }).syncSegmentHandle = async () => { const e = new Error('EIO'); (e as NodeJS.ErrnoException).code = 'EIO'; throw e; };
      await expect(s1.append('p-k6', frameOf('k6b'))).rejects.toThrow('EIO');
      (s1 as unknown as { syncSegmentHandle: unknown }).syncSegmentHandle = syncOrig;
      expect(s1.walHealthy(), 'EIO fail-stop：walHealthy=false 停收').toBe(false);
      await expect(s1.append('p-k6', frameOf('k6c'))).rejects.toThrow('wal fail-stop');
      // 重启等价：新实例（进程级状态归零）+恢复扫描裁定——段不截断（证据保留）+好帧恢复+受理复位
      const s2 = new CollabSpoolService(dir);
      s2.setOwner('k6-owner');
      const report = await s2.recoverScan({ systemHistory: { historyId: HISTORY_ID, epochStartedAtMs: Date.now() }, pgSeq: () => 0n });
      // EIO 档字节面：write 已完成的字节在页缓存（单机进程死后仍在）——帧 CRC 通过=可证即重放；
      // 磁盘真坏时 CRC 网拒（fail-closed 方向正确）。「不进复用路径」=进程内 walSeq 不复用（拒收新帧），
      // 重启后恢复扫描以可证前缀续号——不跳号。
      expect(report.projects[0]!.replayPrefix, '段未因 EIO 截断（证据保留）——CRC 可证帧全数恢复').toEqual([1n, 2n]);
      expect(s2.walHealthy(), '新实例（重启）walHealthy 复位').toBe(true);
      await seedFrame(s2, 'p-k6', frameOf('k6c'));   // 恢复开放写（新帧 walSeq=3——续号承接不跳号）
      expect(s2.peekNextWalSeq('p-k6')).toBe(4n);
    } finally { await cleanup(); }
  }, 15_000);

  it('K7 观测六指标落位（G6a）：wal_fsync_latency/wal_pending_bytes/doc_pg_lag_seq/doc_prefix_gap_total/doc_recovery_total 注册面+inc 点+collect 源（doc_frame_rejected_total=既有等价登记）', async () => {
    const fsyncHist = register.getSingleMetric('wal_fsync_latency');
    const pendingG = register.getSingleMetric('wal_pending_bytes');
    const lagG = register.getSingleMetric('doc_pg_lag_seq');
    const gapC = register.getSingleMetric('doc_prefix_gap_total');
    const recoveryC = register.getSingleMetric('doc_recovery_total');
    expect(fsyncHist && pendingG && lagG && gapC && recoveryC, '五新指标注册（registry 面——/api/metrics 自动暴露）').toBeTruthy();
    // doc_frame_rejected_total{reason}=既有等价（collab_actor_frame_outcome_total reject-* + collab_quota_frame_rejected_total——不重复新增）
    expect(register.getSingleMetric('collab_actor_frame_outcome_total')).toBeTruthy();
    // inc/collect 点：真 append→fsync 观测+pending/lag 读面+撕裂段→prefix gap（prom-client 文本暴露面）
    const { dir, cleanup } = await makeSpoolDir('y1c-t13-k7-');
    try {
      const textBefore = await register.metrics();
      const before = Number(/wal_fsync_latency_count (\d+)/.exec(textBefore)?.[1] ?? 0);
      const gapBefore = Number(/doc_prefix_gap_total (\d+)/.exec(textBefore)?.[1] ?? 0);
      const spool = new CollabSpoolService(dir);
      spool.setOwner('k7-owner');
      spool.setWalHistory(HISTORY_ID);
      await seedFrame(spool, 'p-k7', frameOf('k7'));
      const textAfter = await register.metrics();
      const after = Number(/wal_fsync_latency_count (\d+)/.exec(textAfter)?.[1] ?? 0);
      expect(after, 'wal_fsync_latency：append fsync 观测（文本暴露面递增）').toBeGreaterThan(before);
      expect(spool.pendingSpoolBytes(), 'wal_pending_bytes collect 源：未 confirm 段字节').toBeGreaterThan(0);
      spool.noteApplied('p-k7', 1n);   // actor apply 推进面
      expect(spool.maxPgLagSeq(), 'doc_pg_lag_seq collect 源：appliedSeq−pgSeq').toBe(1n);
      // doc_prefix_gap_total：撕裂段扫描触发（构造坏尾=帧定界截断→truncated 档缺口事件）
      const seg = join(dir, 'k7-owner', 'p-k7.g1.0.spool');
      const buf = await readFile(seg);
      await writeFile(seg, buf.subarray(0, buf.length - 5));   // 尾撕裂
      const s2 = new CollabSpoolService(dir);
      s2.setOwner('k7-owner');
      await s2.recoverScan({ systemHistory: { historyId: HISTORY_ID, epochStartedAtMs: Date.now() }, pgSeq: () => 0n });
      const textGap = await register.metrics();
      const gapAfter = Number(/doc_prefix_gap_total (\d+)/.exec(textGap)?.[1] ?? 0);
      expect(gapAfter, 'doc_prefix_gap_total：撕裂段扫描 inc').toBeGreaterThan(gapBefore);
      // doc_recovery_total：boot 消费点（K1 ok/K2·K4 blocked 已覆盖 inc 面——本用例注册面锚）
      expect(/doc_recovery_total_total\{result="ok"\}/.test(textGap) || /doc_recovery_total\{result="ok"\}/.test(textGap)).toBe(true);
    } finally { await cleanup(); }
  }, 15_000);

  it('M4 启动自检噪声收口：良性 dup 段（dup-seq 同 hash——崩溃重试天然重复，fatal=false）零 quarantine/truncated → boot serving+不落 spool_startup_selfcheck ERROR（观测面=yjs_spool_bad_segment_total 全档含良性——旧实现 defects.length>0 含良性必红）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y1c-t13-m4-');
    try {
      const spool = new CollabSpoolService(dir);
      spool.setOwner('m4-owner');
      spool.setWalHistory(HISTORY_ID);
      // 语料良性 dup 段（链式扫描 defects 仅一条 fatal=false 条目——无 quarantine/truncated/violation）
      const corpus = buildWalFaultCorpus({ historyId: HISTORY_ID });
      const benign = corpus.find((f) => f.fault?.kind === 'dup-seq-same-hash')!;
      await mkdir(join(dir, 'm4-owner'), { recursive: true });
      const name = walSegmentFileName(benign.header.projectId, benign.header.generation, 0);
      await writeFile(join(dir, 'm4-owner', name), encodeWalSegmentBytes(benign.header, benign.frames, benign.fault));
      const { gateway, facade } = makeBoot(spool);
      const listenSpy = facade.spyListenServer().mockResolvedValue(undefined);
      const errSpy = facade.spyLogger('error');
      try {
        await facade.startCollabAfterLease();
        expect(gateway.getCollabState(), '良性 dup=合法续跑（非人工介入信号）').toBe('serving');
        expect(errSpy.mock.calls.some((c) => String(c[0]).includes('spool_startup_selfcheck')), '良性维不进 ERROR 自检（条件收窄 fatal 维）').toBe(false);
      } finally { listenSpy.mockRestore(); errSpy.mockRestore(); }
      await gateway.onApplicationShutdown();
    } finally { await cleanup(); }
  }, 15_000);
});
