// apps/api/src/modules/collab/collab-recovery-import.controller.spec.ts
// Y1c T25：recovery-import 端点接线单测——鉴权（assertEditor OWNER/EDITOR 门）/body 形状 400/
// 8MiB 上限 413 fail-closed/服务透传（幂等键+conflictChoices）。服务行为归 int spec（真 PG）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CollabRecoveryImportController } from './collab-recovery-import.controller';
import { CollabRecoveryImportService } from './collab-recovery-import.service';
import { ProjectPermissionService } from '../team/project-permission.service';

const recovery = {
  importEnvelope: vi.fn(async () => ({ resultReplayed: false })),
} as unknown as CollabRecoveryImportService;
const perm = { assertEditor: vi.fn(async () => undefined) } as unknown as ProjectPermissionService;
const ctl = new CollabRecoveryImportController(recovery, perm);
const ENV: any = { draftId: 'd1', projectId: 'p1', generation: 1, schemaVersion: 3, historyId: 'h', capturedAtMs: 1, tabId: 't', nodes: [], edges: [], meta: {}, hashes: { nodes: '0'.repeat(64), edges: '0'.repeat(64) } };
const req = (uid?: string, len?: number) => ({ user: uid ? { id: uid } : undefined, headers: len !== undefined ? { 'content-length': String(len) } : {} }) as never;

beforeEach(() => {
  vi.mocked(perm.assertEditor as never as ReturnType<typeof vi.fn>).mockClear();
  (recovery.importEnvelope as ReturnType<typeof vi.fn>).mockClear();
});

describe('Y1c T25 recovery-import 端点接线', () => {
  it('assertEditor 门（OWNER/EDITOR——uid 透传）+服务透传（envelope/conflictChoices/content-length/deletionNodeIds〔T25b 收口 I-3〕）', async () => {
    await ctl.recoveryImport('p1', req('u1', 100), { envelope: ENV, conflictChoices: { n1: 'replace' }, deletionNodeIds: ['n3'] });
    expect(perm.assertEditor).toHaveBeenCalledWith('p1', 'u1');
    expect(recovery.importEnvelope).toHaveBeenCalledWith('p1', 'u1', ENV, { n1: 'replace' }, 100, ['n3']);
  });

  it('body 形状违规 400（envelope 缺席/数组 body）——不触服务', async () => {
    await expect(ctl.recoveryImport('p1', req('u1'), {} as never)).rejects.toMatchObject({ status: 400 });
    await expect(ctl.recoveryImport('p1', req('u1'), [] as never)).rejects.toMatchObject({ status: 400 });
    expect(recovery.importEnvelope).not.toHaveBeenCalled();
  });

  it('8MiB 上限 413 fail-closed（content-length 超限——导出文件路径不开导入）', async () => {
    await expect(ctl.recoveryImport('p1', req('u1', 8_388_608 + 8_192), { envelope: ENV })).rejects.toMatchObject({ status: 413 });
    expect(recovery.importEnvelope).not.toHaveBeenCalled();
  });
});
