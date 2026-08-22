import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { BadRequestException } from '@nestjs/common';

const stitchQueue = { add: vi.fn().mockResolvedValue({ id: 'job1' }), getJob: vi.fn() };
const prisma = { canvasProject: { findUnique: vi.fn() }, media: { findMany: vi.fn() } };

const validBody = {
  fileIds: ['f1', 'f2', 'f3', 'f4'], gridRows: 2, gridCols: 2,
  aspectRatio: '16:9', showIndex: false, resolution: '2K',
};

let service: any;

beforeAll(async () => {
  const { StoryboardService } = await import('./storyboard.service');
  service = new StoryboardService(stitchQueue as any, prisma as any);
});

describe('StoryboardService.createStitchTask', () => {
  beforeEach(() => vi.clearAllMocks());

  it('合法参数 → 202 taskId', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.media.findMany.mockResolvedValue([{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }, { id: 'f4' }]);
    const result = await service.createStitchTask('p1', validBody, 'u1');
    expect(result.taskId).toBe('job1');
    expect(prisma.media.findMany).toHaveBeenCalledWith({
      where: { id: { in: validBody.fileIds }, projectId: 'p1' },
      select: { id: true },
    });
    expect(stitchQueue.add).toHaveBeenCalledWith('stitch', expect.objectContaining({
      projectId: 'p1', userId: 'u1', fileIds: validBody.fileIds, resolution: '2K',
    }));
  });

  it('fileIds 含不存在或不属于本项目的图片 → 400', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.media.findMany.mockResolvedValue([{ id: 'f1' }]); // 只命中 1/4
    await expect(service.createStitchTask('p1', validBody, 'u1')).rejects.toThrow(/无效或不属于/);
    expect(stitchQueue.add).not.toHaveBeenCalled();
  });

  it.each([
    ['fileIds 为空', { ...validBody, fileIds: [] }],
    ['行列超界', { ...validBody, gridRows: 11 }],
    ['非法比例', { ...validBody, aspectRatio: '4:5' }],
    ['非法分辨率', { ...validBody, resolution: '8K' }],
    ['图片数超过容量', { ...validBody, gridRows: 1, gridCols: 2 }],
  ])('%s → 400', async (_label, body) => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1' }); // 否则先抛 404，格式校验分支未被测到
    await expect(service.createStitchTask('p1', body as any, 'u1')).rejects.toThrow(BadRequestException);
  });

  it('项目不存在 → 404', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    await expect(service.createStitchTask('nope', validBody, 'u1')).rejects.toThrow(/不存在/);
  });
});

describe('StoryboardService.getTaskStatus', () => {
  it('COMPLETED job → 返回产物字段', async () => {
    stitchQueue.getJob.mockResolvedValue({
      id: 'job1',
      getState: vi.fn().mockResolvedValue('completed'),
      returnvalue: { fileId: 'out1', width: 2048, height: 1026, failedCount: 0 }, // 无 url：前端经 useMediaUrl(fileId) 解析
    });
    const r = await service.getTaskStatus('p1', 'job1');
    expect(r).toMatchObject({ taskId: 'job1', status: 'COMPLETED', fileId: 'out1' });
  });

  it('job 不存在 → 404', async () => {
    stitchQueue.getJob.mockResolvedValue(null);
    await expect(service.getTaskStatus('p1', 'nope')).rejects.toThrow();
  });
});
