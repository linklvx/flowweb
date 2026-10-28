// apps/api/src/modules/collab/collab-t27-kill9.process.spec.ts
// Y1c T27：kill -9 每 stage 演练——**真子进程+真 PG**（T13 kill9 先例：spawn+SIGKILL——禁只 mock
// 「模拟崩溃」；t13 套件头注「真子进程 spawn+SIGKILL 物理形态」同款纪律）。
// 子进程=scripts/collab-rebuild-gen.mjs（纯 node CLI——`--hold-after <stage>` 在该 stage 持久化后
// 挂起，父进程此刻 SIGKILL=崩溃物理性）；随后**重跑同 CLI**（=「重启」从 PG stage 继续——CLI 的
// 幂等续跑面）断言推进至 COMPLETED+换代不变量（generation++/旧代行整删/maintenanceId 解除/
// 新代快照 stateSeq=旧代 maxSeq 承接）。
// 覆盖 stage 断点：REQUESTED/FREEZING/DRAINING/DRAINED/EXPORTING/REBUILDING（=SWITCHING 事务前
// 崩溃窗——事务未提交 stage 留 REBUILDING）/SWITCHING（事务提交后崩溃窗——roll-forward）/
// VERIFYING。另：红② CLI 无租约直写拒（真租约行持有=子进程 exit 1+零写）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import path from 'node:path';
import { createCanvasDoc } from './canvas-doc.factory';
import { ensureProjectFixture, cleanupProjectFixture } from '../../test-utils/db-fixtures';

// vitest cwd=apps/api（import.meta 在 spec tsconfig commonjs 下不可用——runtime-feed.t22-static 先例）
const ROOT = path.resolve(process.cwd(), '../..');
const CLI = path.join(ROOT, 'scripts', 'collab-rebuild-gen.mjs');
const DB_URL = (process.env.DATABASE_URL ?? '').replace(/^"|"$/g, '');
const hasDb = !!DB_URL;
const maybe = hasDb ? describe : describe.skip;

const PID = 'y1c-t27-kill9';

async function seedDoc(prisma: PrismaClient): Promise<void> {
  const doc = createCanvasDoc();
  const node = new Y.Map(); const data = new Y.Map();
  data.set('model', 'm1');
  node.set('type', 'textInput'); node.set('data', data);
  doc.getMap('nodes').set('n1', node);
  const state0 = Buffer.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  await prisma.$executeRaw`INSERT INTO "CanvasDocSnapshot" ("projectId", generation, "snapshotRev", "stateSeq", state, "stateHash", "vacuumEpoch", "schemaVersion")
    VALUES (${PID}::text, 0::int, 0::bigint, 0::bigint, ${state0}, ${createHash('sha256').update(state0).digest('hex')}::char(64), 0::int, 3::int) ON CONFLICT DO NOTHING`;
  await prisma.$executeRaw`INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "updatedAt")
    VALUES (${PID}::text, 0::int, 3::int, now()) ON CONFLICT DO NOTHING`;
  for (const seq of [1n, 2n]) {
    const upd = Buffer.from(Y.encodeStateAsUpdate(createCanvasDoc()));
    await prisma.$executeRaw`INSERT INTO "CanvasDocUpdate" ("projectId", generation, seq, "firstWalSeq", "frameCount", "updateHash", update, "createdAt")
      VALUES (${PID}::text, 0::int, ${seq}::bigint, ${seq}::bigint, 1::int, ${'k' + String(seq).padEnd(63, '0')}::char(64), ${upd}, now()) ON CONFLICT DO NOTHING`;
  }
}

/** 跑 CLI 到指定 hold 信号点后 SIGKILL（真进程崩溃——非 mock）。 */
async function runUntilKilled(args: string[], signal: string): Promise<string> {
  const child: ChildProcess = spawn(process.execPath, [CLI, ...args, '--project', PID], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: DB_URL },
  });
  let out = '';
  child.stdout!.on('data', (d: Buffer) => { out += d.toString('utf-8'); });
  child.stderr!.on('data', (d: Buffer) => { out += d.toString('utf-8'); });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`CLI 未达信号 ${signal}（out=${out}）`)), 60_000);
    const check = () => {
      if (out.includes(signal)) { clearTimeout(t); resolve(); }
    };
    child.stdout!.on('data', check);
    child.on('exit', (code) => { if (!out.includes(signal)) { clearTimeout(t); reject(new Error(`CLI 提前退出 code=${code} out=${out}`)); } });
  });
  child.kill('SIGKILL');   // kill -9（Windows TerminateProcess 等价）
  await new Promise<void>((resolve) => child.on('exit', () => resolve()));
  return out;
}

/** 跑 CLI 至完成（重启续跑形态——幂等从 PG stage 继续）。 */
async function runToDone(): Promise<{ code: number | null; out: string }> {
  const child: ChildProcess = spawn(process.execPath, [CLI, '--project', PID], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: DB_URL },
  });
  let out = '';
  child.stdout!.on('data', (d: Buffer) => { out += d.toString('utf-8'); });
  child.stderr!.on('data', (d: Buffer) => { out += d.toString('utf-8'); });
  const code = await new Promise<number | null>((resolve) => child.on('exit', (c) => resolve(c)));
  return { code, out };
}

maybe('Y1c T27 kill -9 每 stage 演练（真子进程 CLI+真 PG——重启从 PG stage 继续）', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } } as never);

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID);
  });
  afterAll(async () => {
    await cleanupProjectFixture(prisma, PID);
    await prisma.$executeRaw`DELETE FROM "CollabLease" WHERE scope = 'primary'`;
    await prisma.$disconnect();
  });

  /** 布景复位（每断点独立：doc 头 gen0+2 行增量+零 MaintenanceOperation+租约行清）。 */
  async function reset(): Promise<void> {
    await prisma.maintenanceOperation.deleteMany({ where: { projectId: PID } });
    await prisma.$executeRaw`DELETE FROM "CanvasDocUpdate" WHERE "projectId" = ${PID}::text`;
    await prisma.$executeRaw`DELETE FROM "CanvasDocSnapshot" WHERE "projectId" = ${PID}::text`;
    await prisma.$executeRaw`DELETE FROM "CanvasDoc" WHERE "projectId" = ${PID}::text`;
    await prisma.$executeRaw`DELETE FROM "CollabLease" WHERE scope = 'primary'`;
    await seedDoc(prisma);
  }

  /** 终态不变量断言（续跑后）：generation 0→1+旧代行整删+关闸解除+新代快照 stateSeq=旧代 maxSeq。 */
  async function assertCompleted(): Promise<void> {
    const doc = await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { generation: true, maintenanceId: true, currentSnapshotRev: true, purgeBelowSeq: true } });
    expect(doc?.generation).toBe(1);
    expect(doc?.maintenanceId).toBeNull();
    const rows = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM "CanvasDocUpdate" WHERE "projectId" = ${PID}::text`;
    expect(rows[0]!.n).toBe(0);   // 旧代行换代即删（跨代连续 seq——vacuumReplace 语义经 CLI 事务兑现）
    const snap = await prisma.canvasDocSnapshot.findUnique({ where: { projectId_generation_snapshotRev: { projectId: PID, generation: 1, snapshotRev: 0n } } });
    expect(snap?.stateSeq).toBe(2n);   // 旧代 maxSeq 承接非归零
    const op = await prisma.maintenanceOperation.findFirst({ where: { projectId: PID }, orderBy: { createdAt: 'desc' } });
    expect(op?.stage).toBe('COMPLETED');
  }

  // ── 各 stage 断点（kill 后重跑=从 PG stage 续→COMPLETED）──
  for (const stage of ['REQUESTED', 'FREEZING', 'DRAINING', 'DRAINED', 'EXPORTING', 'REBUILDING', 'VERIFYING'] as const) {
    it(`K[${stage}] kill -9 后重跑续至 COMPLETED（stage 持久化单源=PG）`, async () => {
      await reset();
      await runUntilKilled(['--hold-after', stage], `HOLDING ${stage}`);
      // 断点在档：非终态 stage 行+maintenanceId 关闸在
      const mid = await prisma.maintenanceOperation.findFirst({ where: { projectId: PID } });
      expect(mid?.stage).toBe(stage);
      expect((await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { maintenanceId: true } }))?.maintenanceId).toBe(mid?.maintenanceId);
      const r = await runToDone();
      expect(r.code, `续跑应 exit 0（out=${r.out}）`).toBe(0);
      expect(r.out).toContain('OK generation 0->1');
      await assertCompleted();
    }, 120_000);
  }

  it('K[SWITCHING] 事务提交后 kill -9（唯一不可回退点后崩溃窗）→重跑 roll-forward（不重切只走 VERIFYING→COMPLETED）', async () => {
    await reset();
    await runUntilKilled(['--hold-after', 'SWITCHING'], 'HOLDING SWITCHING');
    // 崩溃窗真值：SWITCHING 已提交（generation=1+新代快照在+旧代行已整删）+stage=SWITCHING 在档
    expect((await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { generation: true } }))?.generation).toBe(1);
    const op = await prisma.maintenanceOperation.findFirst({ where: { projectId: PID } });
    expect(op?.stage).toBe('SWITCHING');
    const r = await runToDone();
    expect(r.code).toBe(0);
    expect(r.out).toContain('roll-forward');   // 不重切（generation≥target 检出——幂等）
    await assertCompleted();
  }, 120_000);

  it('红② CLI 无租约直写拒（真子进程+真租约行）：持有者在=exit 1+零 DB 写', async () => {
    await reset();
    await prisma.$executeRaw`INSERT INTO "CollabLease" (scope, owner, epoch, "expiresAt")
      VALUES ('primary', 'api-live-proc', ${1n}::bigint, now() + interval '5 minutes')
      ON CONFLICT (scope) DO UPDATE SET owner = 'api-live-proc', "expiresAt" = now() + interval '5 minutes'`;
    try {
      const r = await runToDone();
      expect(r.code).toBe(1);
      expect(r.out).toContain('REFUSED lease-held');
      // 零 DB 写：无 MaintenanceOperation 行+maintenanceId 未置
      expect(await prisma.maintenanceOperation.findFirst({ where: { projectId: PID } })).toBeNull();
      expect((await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { maintenanceId: true } }))?.maintenanceId).toBeNull();
    } finally {
      await prisma.$executeRaw`DELETE FROM "CollabLease" WHERE scope = 'primary'`;
    }
  }, 60_000);
});
