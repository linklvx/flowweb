// TD-33/C1b T13：purgeScope 端点 emit 面——只对已 mark 的 pid best-effort emit project.gone；
// mark 前失败（4xx/503）零 emit（旧实现无条件 emit=误关活项目连接）。
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CollabWriteController } from './collab-write.controller';

const build = (spool: { purgeErasureScope: ReturnType<typeof vi.fn> }, events: { emit: ReturnType<typeof vi.fn> }) =>
  new CollabWriteController({} as never, {} as never, spool as never, {} as never, {} as never, {} as never, events as never);   // Y2 B2a：authorSlot 第 6 参

describe('TD-33 T13：purgeScope emit project.gone', () => {
  it('marked 非空→emit 一次（list 透传）；返回 purgedSegments', async () => {
    const spool = { purgeErasureScope: vi.fn(async () => ({ purgedSegments: 2, markedProjectIds: ['p1', 'p2'] })) };
    const events = { emit: vi.fn() };
    await expect(build(spool, events).purgeScope({ projectIds: ['p1', 'p2'] } as never)).resolves.toEqual({ purgedSegments: 2 });
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith('project.gone', { projectIds: ['p1', 'p2'] });
  });

  it('mark 前失败（4xx）→零 emit（零 4414 零 deletedProjects）', async () => {
    const spool = { purgeErasureScope: vi.fn(async () => { throw new BadRequestException({ code: 'PROJECT_NOT_PURGEABLE' }); }) };
    const events = { emit: vi.fn() };
    await expect(build(spool, events).purgeScope({ projectIds: ['p1'] } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('marked 空（normal 档未 mark）→零 emit', async () => {
    const spool = { purgeErasureScope: vi.fn(async () => ({ purgedSegments: 0, markedProjectIds: [] })) };
    const events = { emit: vi.fn() };
    await build(spool, events).purgeScope({ projectIds: [] } as never);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('双审 F1：mark 后中途失败（错误携带 markedProjectIds）→仍 emit 一次+错误上抛', async () => {
    const spool = { purgeErasureScope: vi.fn(async () => {
      const e = new Error('unlink boom');                     // service :2163 同款挂集形态
      Object.assign(e, { markedProjectIds: ['p1'] });
      throw e;
    }) };
    const events = { emit: vi.fn() };
    await expect(build(spool, events).purgeScope({ projectIds: ['p1'] } as never)).rejects.toThrow('unlink boom');
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith('project.gone', { projectIds: ['p1'] });
  });
});
