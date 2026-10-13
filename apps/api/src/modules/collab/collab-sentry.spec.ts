// apps/api/src/modules/collab/collab-sentry.spec.ts
// Y0b-5 T11：collab 关键 catch → captureException+scope{docName,reason,connectionId}
// （gateway 三样本：store 失败/装载失败/compact 放弃 + lease/spool/repo 扩展）
// +WS connectionId（onAuthenticate 生成 randomUUID+结构化日志三元组〔traceId 预留位——T13 才有，
// 现为 null〕+doc-status 通道预留字段回传客户端+断连清理）。
// 形态：直构单元组（auth-reason spec 先例——mock prisma/repo/lease，不 listen）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));
import * as Sentry from '@sentry/nestjs';
import { CollabGateway } from './collab.gateway';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CollabSpoolService } from './collab-spool.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabLeaseService } from './collab-lease.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { CLIENT_PROTOCOL_VERSION } from '@flowweb/shared';
import type { MockRepo } from '../../test-utils/mock-repo';

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('t11-sentry-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => { await spoolCleanup(); });

function buildGateway(repoOver: Partial<MockRepo> = {}) {
  const prisma = {
    session: {
      findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, expiresAt: new Date(Date.now() + 86400000) }),
      update: vi.fn(async (args: any) => ({ user: { id: 'u1', name: '张三' }, expiresAt: args.data.expiresAt })),
    },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1', userId: 'other' }) },
    projectMember: { findUnique: vi.fn().mockResolvedValue(null) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
  };
  const repo = createMockRepo(repoOver);
  const lease = createLeaseStub();
  const perm = new ProjectPermissionService(prisma as any);
  const spool = new CollabSpoolService(spoolDir);
  spool.setOwner('test-owner');
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, lease as any,
    perm as any, 43000 + Math.floor(Math.random() * 20000),
    undefined, undefined, undefined, spool,
  );
  (gateway as any).collabState = 'serving';
  return { gateway, prisma, repo };
}

const authPayload = (documentName = 'project:p1') => ({
  requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),
  requestParameters: new URLSearchParams(`csv=${CLIENT_PROTOCOL_VERSION}`),
  documentName,
  connectionConfig: { readOnly: false, isAuthenticated: false },
  socketId: 'sock-1',
});

describe('T11 gateway 三样本 catch → captureException+scope{docName,reason,connectionId}', () => {
  it('装载失败：hydrate 抛错 → db-unavailable + capture{docName, reason:load-db-unavailable, connectionId=实值}（onLoadDocumentPayload 带 socketId）', async () => {
    const { gateway } = buildGateway({ hydrateWithRecovery: vi.fn().mockRejectedValue(new Error('P1001')) });
    (gateway as any).connectionIds.set('sock-1', 'cid-load-1');
    await expect(gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p1', socketId: 'sock-1' } as any))
      .rejects.toMatchObject({ reason: 'db-unavailable' });
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { docName: 'project:p1', reason: 'load-db-unavailable', connectionId: 'cid-load-1' },
    });
  });

  it('store 失败：append 抛错 → capture{docName, reason:store-append-failed, connectionId:"-"}（onStoreDocumentPayload 无 socketId）', async () => {
    const { gateway } = buildGateway({ append: vi.fn().mockRejectedValue(new Error('pg down')) });
    (gateway as any).pendingQueues.set('p1', [new Uint8Array([1, 2, 3])]);
    const r = await gateway.hooks.onStoreDocument({ document: new Y.Doc(), documentName: 'project:p1' } as any);
    expect(r).toBe(false);
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { docName: 'project:p1', reason: 'store-append-failed', connectionId: '-' },
    });
  });

  it('compact 放弃：append 成功后 compact 抛错 → 行已落库仅 WARN + capture{reason:compact-failed, connectionId:"-"}', async () => {
    const { gateway } = buildGateway({ compact: vi.fn().mockRejectedValue(new Error('compact boom')) });
    (gateway as any).pendingQueues.set('p1', [new Uint8Array([1, 2, 3])]);
    const r = await gateway.hooks.onStoreDocument({ document: new Y.Doc(), documentName: 'project:p1' } as any);
    expect(r).toBe(true);   // compact 是优化不是不变量载体——失败不翻 store 结果
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { docName: 'project:p1', reason: 'compact-failed', connectionId: '-' },
    });
  });
});

describe('T11 WS connectionId：onAuthenticate 生成+三元组日志+doc-status 回传+断连清理', () => {
  it('认证成功 → connectionIds 播种 randomUUID + 结构化日志三元组（traceId 预留位=null+connectionId+docName 原文——日志面不 scrub）+context 携带', async () => {
    const { gateway } = buildGateway();
    const logSpy = vi.spyOn((gateway as any).logger, 'log');
    const ctx = await gateway.hooks.onAuthenticate(authPayload() as any);
    const cid = (gateway as any).connectionIds.get('sock-1');
    expect(cid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);   // randomUUID 形态
    expect((ctx as any).connectionId).toBe(cid);   // 进连接 context（后续连接上下文 catch 可取）
    const line = logSpy.mock.calls.map((c) => String(c[0])).find((s) => s.includes('"collab_connection_auth"'));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line!);
    expect(parsed).toMatchObject({ traceId: null, connectionId: cid, docName: 'project:p1' });   // 三元组（traceId=T13 预留位）
    expect(line).toContain('project:p1');   // 日志面不 scrub（偏离表：project id 非机密）
  });

  it('connected 钩子：doc-status 载荷带预留字段 connectionId（回传客户端——遥测 join 通道）', async () => {
    const { gateway } = buildGateway();
    (gateway as any).connectionIds.set('sock-1', 'cid-push-1');
    const conn = { sendStateless: vi.fn(), webSocket: { send: vi.fn(), close: vi.fn(), bufferedAmount: 0 } };
    await gateway.hooks.connected({ socketId: 'sock-1', connection: conn, documentName: 'project:p1' } as any);
    const payloads = conn.sendStateless.mock.calls.map((c) => JSON.parse(String(c[0])));
    const docStatus = payloads.find((p) => p.type === 'doc-status');
    expect(docStatus).toMatchObject({ connectionId: 'cid-push-1', rev: expect.any(Number) });
  });

  it('断连清理：onDisconnect 删 connectionIds 条目（防无界）', async () => {
    const { gateway } = buildGateway();
    (gateway as any).connectionIds.set('sock-1', 'cid-gone');
    await gateway.hooks.onDisconnect({ document: new Y.Doc(), documentName: 'project:p1', socketId: 'sock-1', clientsCount: 1 } as any);
    expect((gateway as any).connectionIds.has('sock-1')).toBe(false);
  });
});

describe('T11 lease/spool/repo 扩展 catch → captureException', () => {
  it('lease：onHeld 接线失败（spool.setOwner 抛）→ release+rethrow + capture{docName:"-", reason:lease-onheld-failed, connectionId:"-"}', async () => {
    const query = vi.fn().mockResolvedValue([{ epoch: 1n }]);   // CAS SELECT 与 release UPDATE 共用（lease spec 同款形态）
    const prisma = {
      $queryRaw: query,
      $transaction: vi.fn(async (fn: any) => fn({ $queryRaw: query, $executeRaw: vi.fn().mockResolvedValue(0) })),
    };
    const badSpool = new CollabSpoolService(spoolDir);
    vi.spyOn(badSpool, 'setOwner').mockImplementation(() => { throw new Error('owner 非法'); });
    const svc = new CollabLeaseService(prisma as any, { setLeaseOwner: vi.fn() } as any, badSpool);
    await expect(svc.tryAcquireFast()).rejects.toThrow('owner 非法');
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { docName: '-', reason: 'lease-onheld-failed', connectionId: '-' },
    });
  });

  it('spool：append 失败（目录不可写）→ 封段+throw + capture{docName:"project:proj-s1", reason:spool-append-failed}', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 't11-spool-'));
    try {
      const fileAsDir = join(tmp, 'not-a-dir');   // 常规文件占位目录路径 → mkdir(adir) ENOTDIR
      writeFileSync(fileAsDir, 'x');
      const spool = new CollabSpoolService(fileAsDir);
      spool.setOwner('o1');
      await expect(spool.append('proj-s1', new Uint8Array([1, 2]))).rejects.toThrow();
      expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
        tags: { docName: 'project:proj-s1', reason: 'spool-append-failed', connectionId: '-' },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('repo：hydrate 自愈 compact 失败 → WARN 后仍重试装载 + capture{docName:"project:hr-1", reason:hydrate-compact-failed}', async () => {
    const repo = new CanvasDocUpdateRepository({} as any);
    const okHydration = { state: null, updates: [] as Buffer[], stateSeq: 0n };
    vi.spyOn(repo, 'loadForHydration')
      .mockRejectedValueOnce(Object.assign(new Error('connection terminated'), { code: 'P2028' }))
      .mockResolvedValueOnce(okHydration);
    vi.spyOn(repo, 'compact').mockRejectedValue(new Error('compact boom'));
    await expect(repo.hydrateWithRecovery('hr-1')).resolves.toBe(okHydration);   // compact 失败不构成新 fail-closed（契约 13）
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { docName: 'project:hr-1', reason: 'hydrate-compact-failed', connectionId: '-' },
    });
  });
});
