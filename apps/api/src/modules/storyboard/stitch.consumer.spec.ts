import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Job } from 'bullmq';
import { StitchConsumer } from './stitch.consumer';

vi.mock('./stitch.composer', () => ({
  composeStoryboard: vi.fn().mockResolvedValue(Buffer.from('fake-jpg')),
}));

describe('StitchConsumer', () => {
  let consumer: StitchConsumer;
  let prisma: any;

  const makeJob = () =>
    ({
      id: 'job-1',
      data: {
        projectId: 'p1',
        userId: 'u1',
        fileIds: ['f1'],
        gridRows: 1,
        gridCols: 1,
        aspectRatio: '16:9',
        showIndex: false,
        resolution: '2K',
      },
    }) as any as Job;

  beforeEach(async () => {
    prisma = {
      canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't-team' }) },
      media: {
        findUnique: vi.fn().mockResolvedValue({ id: 'f1', key: 'uploads/f1.jpg' }),
        create: vi.fn().mockResolvedValue({ id: 'media-out' }),
      },
      team: { findFirst: vi.fn() },
    };
    const minio = {
      getObject: vi.fn().mockImplementation(async () =>
        (async function* () {
          yield Buffer.from('img');
        })(),
      ),
      upload: vi.fn().mockResolvedValue(undefined),
    };
    const gateway = { emitStitchStatus: vi.fn() };
    const collabDoc = { writeNodeData: vi.fn() };

    // StitchConsumer 构造函数无 @Inject 显式 token，vitest（esbuild）不生成
    // design:paramtypes 元数据，Nest DI 解析不到 → 直接实例化注入 mock
    consumer = new StitchConsumer(prisma as any, minio as any, gateway as any, collabDoc as any);
  });

  it('生成物归属 = project.teamId（非 getOwnerTeamId 反推）', async () => {
    await consumer.process(makeJob());

    expect(prisma.media.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ teamId: 't-team' }),
      }),
    );
    expect(prisma.team.findFirst).not.toHaveBeenCalled();
  });

  it('project.teamId 缺失 → 抛错且不建 Media（不回落个人团队）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue(null);

    await expect(consumer.process(makeJob())).rejects.toThrow('PROJECT_TEAM_MISSING');
    expect(prisma.media.create).not.toHaveBeenCalled();
    expect(prisma.team.findFirst).not.toHaveBeenCalled();
  });
});
