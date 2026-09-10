import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { VideoProjectController } from './video-project.controller';
import { VideoProjectService } from './video-project.service';

describe('VideoProjectController', () => {
  let ctrl: VideoProjectController; let svc: any;
  const req = { user: { id: 'u1' } };
  beforeEach(async () => {
    svc = {
      upsertByNode: vi.fn().mockResolvedValue({ id: 'p1' }),
      getByNode: vi.fn().mockResolvedValue({ id: 'p1' }),
      patch: vi.fn().mockResolvedValue({ id: 'p1', updatedAt: new Date() }),
      deleteByNode: vi.fn().mockResolvedValue(undefined),
    };
    const mod = await Test.createTestingModule({
      controllers: [VideoProjectController],
      providers: [{ provide: VideoProjectService, useValue: svc }],
    }).compile();
    ctrl = mod.get(VideoProjectController);
  });

  it('POST upsert 透传 userId', async () => {
    await ctrl.create({ workflowId: 'w1', sourceNodeId: 'n1', title: 'x', data: {} } as any, req);
    expect(svc.upsertByNode).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
  });
  it('GET by-node 透传', async () => {
    await ctrl.byNode('n1', req);
    expect(svc.getByNode).toHaveBeenCalledWith('n1', 'u1');
  });
  it('DELETE by-node', async () => {
    await ctrl.deleteByNode('n1', req);
    expect(svc.deleteByNode).toHaveBeenCalledWith('n1', 'u1');
  });
});
