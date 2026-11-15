// TD-33/C1b T9 真库背书（真 PG）：blocked 五档/purgeable 行存在九档/dry-run 四例/media conflict
// 中止档/行删迁移/live 批量判定——SQL 判定面只有真库能证（单测只证映射与谓词文本锚）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CollabErasureRegistryService } from './collab-erasure-registry.service';
import { FIXTURE_USER } from '../../test-utils/db-fixtures';

const prisma = new PrismaClient();
const createdTeams: string[] = [];
const createdProjects: string[] = [];
const createdScopes: string[] = [];

beforeAll(async () => {
  await prisma.user.upsert({
    where: { id: FIXTURE_USER }, update: {},
    create: { id: FIXTURE_USER, name: 'erasure-reg', email: 'erasure-reg@local.test', emailVerified: true },
  });
});

afterAll(async () => {
  await prisma.projectErasureRun.deleteMany({ where: { scopeId: { in: createdScopes } } });
  await prisma.canvasProject.deleteMany({ where: { id: { in: createdProjects } } });
  await prisma.team.deleteMany({ where: { id: { in: createdTeams } } });
  await prisma.$disconnect();
});

async function mkTeam(status: 'ACTIVE' | 'DISBANDING' | 'DISBANDED' = 'ACTIVE'): Promise<string> {
  const id = `t-${randomUUID()}`;
  await prisma.team.create({ data: { id, name: id, ownerId: FIXTURE_USER, status } });
  createdTeams.push(id);
  return id;
}

async function mkProject(lifecycleState: string, teamId?: string): Promise<string> {
  const id = `p-${randomUUID()}`;
  const tid = teamId ?? (await mkTeam());
  await prisma.canvasProject.create({ data: { id, name: id, teamId: tid, lifecycleState } });
  createdProjects.push(id);
  return id;
}

async function mkRun(scopeId: string, state: string, o: { dryRun?: boolean; manifestPath?: string | null; scopeType?: string } = {}): Promise<void> {
  createdScopes.push(scopeId);
  await prisma.projectErasureRun.create({
    data: {
      scopeType: o.scopeType ?? 'project', scopeId, state, dryRun: o.dryRun ?? false,
      requestedBy: FIXTURE_USER, manifestPath: o.manifestPath ?? null,
    },
  });
}

const load = async (): Promise<CollabErasureRegistryService> => {
  const r = new CollabErasureRegistryService(prisma as never);
  await r.load({ force: true });
  return r;
};

const goneScope = (): string => {
  const id = `p-${randomUUID()}`;
  createdScopes.push(id);
  return id;
};

describe('TD-33 C1b T9：ErasureRegistry（真 PG）', () => {
  it('blocked 五档：lifecycleState<>ACTIVE / Team<>ACTIVE / active run / terminal run∧ACTIVE 行（restore-pending）/ terminal run∧行缺=ERASED', async () => {
    const before = (await load()).restorePendingCount();
    const team = await mkTeam();
    const pDeleting = await mkProject('DELETING', team);
    const teamDb = await mkTeam('DISBANDING');
    const pTeamDisbanding = await mkProject('ACTIVE', teamDb);
    const pActiveRun = await mkProject('ACTIVE', team);
    await mkRun(pActiveRun, 'PURGING_DB');
    const pTerminalActive = await mkProject('ACTIVE', team);
    await mkRun(pTerminalActive, 'DONE', { manifestPath: '/m/a.json' });
    const pTerminalGone = goneScope();
    await mkRun(pTerminalGone, 'DONE');

    const r = await load();
    expect(r.isBlocked(pDeleting)).toBe('ERASING');
    expect(r.isBlocked(pTeamDisbanding)).toBe('ERASING');
    expect(r.isBlocked(pActiveRun)).toBe('ERASING');          // active run：行在否皆拒
    expect(r.isBlocked(pTerminalActive)).toBe('ERASING');     // restore-pending（旧 spool 禁重放）
    expect(r.isBlocked(pTerminalGone)).toBe('ERASED');
    expect(r.restorePendingCount()).toBe(before + 1);
  });

  it('purgeable 行存在九档：DELETING/DISBANDING 无 run、DRAINING、PURGING_DB/FAILED 行在/行缺、DONE 行缺、terminal∧ACTIVE 行', async () => {
    const team = await mkTeam();
    const pDeleting = await mkProject('DELETING', team);
    const teamDb = await mkTeam('DISBANDING');
    const pDisbandChild = await mkProject('ACTIVE', teamDb);
    const pDraining = await mkProject('ACTIVE', team);
    await mkRun(pDraining, 'DRAINING', { manifestPath: '/m/draining.json' });
    const pPurgingDbRow = await mkProject('ACTIVE', team);
    await mkRun(pPurgingDbRow, 'PURGING_DB');
    const pPurgingDbGone = goneScope();
    await mkRun(pPurgingDbGone, 'PURGING_DB');
    const pFailedRow = await mkProject('ACTIVE', team);
    await mkRun(pFailedRow, 'FAILED');
    const pFailedGone = goneScope();
    await mkRun(pFailedGone, 'FAILED');
    const pDoneGone = goneScope();
    await mkRun(pDoneGone, 'DONE');
    const pTerminalActive = await mkProject('ACTIVE', team);
    await mkRun(pTerminalActive, 'DONE', { manifestPath: '/m/t.json' });

    const r = await load();
    const purgeable = new Set(r.listPurgeableProjectIds());
    expect(purgeable.has(pDeleting)).toBe(false);             // 行在（DELETING）
    expect(purgeable.has(pDisbandChild)).toBe(false);         // Team DISBANDING 子项目
    expect(purgeable.has(pDraining)).toBe(false);              // 行必在（manifest 非判据）
    expect(purgeable.has(pPurgingDbRow)).toBe(false);          // 复核窗行在
    expect(purgeable.has(pPurgingDbGone)).toBe(true);          // 删行后窄窗
    expect(purgeable.has(pFailedRow)).toBe(false);             // FAILED∧行在
    expect(purgeable.has(pFailedGone)).toBe(true);             // FAILED∧行缺
    expect(purgeable.has(pDoneGone)).toBe(true);
    expect(purgeable.has(pTerminalActive)).toBe(false);        // restore-pending 不清
    expect(r.isBlocked(pFailedRow)).toBe('ERASING');           // FAILED∧ACTIVE 行=restore-pending 拒写
    expect(r.isBlocked(pDisbandChild)).toBe('ERASING');
  });

  it('media conflict 中止档：CanvasProject 仍 DELETING+run 停 PURGING_DB→不清+仍拒写', async () => {
    const team = await mkTeam();
    const p = await mkProject('DELETING', team);
    await mkRun(p, 'PURGING_DB');
    const r = await load();
    expect(r.isBlocked(p)).toBe('ERASING');
    expect(r.listPurgeableProjectIds()).not.toContain(p);
  });

  it('dry-run 四例：PENDING/DONE 不 blocked 不 restore-pending；dry-run team run 零项目影响；dryRun=false 同形态仍 blocked', async () => {
    const before = (await load()).restorePendingCount();
    const team = await mkTeam();
    const pDryPend = await mkProject('ACTIVE', team);
    await mkRun(pDryPend, 'PENDING', { dryRun: true });
    const pDryDone = await mkProject('ACTIVE', team);
    await mkRun(pDryDone, 'DONE', { dryRun: true });
    const pTeamDry = await mkProject('ACTIVE', team);
    await mkRun(team, 'PENDING', { dryRun: true, scopeType: 'team' });
    const pRealPend = await mkProject('ACTIVE', team);
    await mkRun(pRealPend, 'PENDING');   // 反向：dryRun=false 同形态仍 blocked

    const r = await load();
    expect(r.isBlocked(pDryPend)).toBeUndefined();   // dry-run run 永久 PENDING 不得锁活项目
    expect(r.isBlocked(pDryDone)).toBeUndefined();
    expect(r.isBlocked(pTeamDry)).toBeUndefined();   // team run scopeId=teamId 不撞项目
    expect(r.isBlocked(pRealPend)).toBe('ERASING');
    expect(r.restorePendingCount()).toBe(before);    // dry-run DONE 不入 restore-pending
  });

  it('行删迁移：terminal run∧ACTIVE 行（ERASING 不清）→ 删行后 reload=ERASED+purgeable', async () => {
    const team = await mkTeam();
    const p = await mkProject('ACTIVE', team);
    await mkRun(p, 'DONE', { manifestPath: '/m/r.json' });
    const r1 = await load();
    expect(r1.isBlocked(p)).toBe('ERASING');
    expect(r1.listPurgeableProjectIds()).not.toContain(p);
    await prisma.canvasProject.deleteMany({ where: { id: p } });
    const r2 = await load();
    expect(r2.isBlocked(p)).toBe('ERASED');
    expect(r2.listPurgeableProjectIds()).toContain(p);
  });

  it('listPurgeableProjectIdsLive：批量判定只回行缺者（端点删除授权面——不读快照）', async () => {
    const team = await mkTeam();
    const pRow = await mkProject('ACTIVE', team);
    await mkRun(pRow, 'DONE', { manifestPath: '/m/l1.json' });
    const pGone = goneScope();
    await mkRun(pGone, 'DONE');
    const r = await load();
    const live = await r.listPurgeableProjectIdsLive([pRow, pGone, 'p-not-exist-at-all']);
    expect(live.has(pGone)).toBe(true);
    expect(live.has(pRow)).toBe(false);
    expect(live.has('p-not-exist-at-all')).toBe(false);
  });
});
