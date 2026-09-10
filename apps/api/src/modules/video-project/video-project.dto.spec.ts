import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateVideoProjectDto, PatchVideoProjectDto } from './video-project.dto';

describe('video-project DTO', () => {
  it('合法 create 通过', async () => {
    const dto = plainToInstance(CreateVideoProjectDto, {
      workflowId: 'wp1', sourceNodeId: 'node-1', title: 'x',
      data: { version: 1, fps: 30, tracks: [], clips: {} },
    });
    expect(await validate(dto)).toHaveLength(0);
  });
  it('缺 sourceNodeId 拒绝', async () => {
    const dto = plainToInstance(CreateVideoProjectDto, { workflowId: 'wp1', data: {} });
    const errs = await validate(dto);
    expect(errs.some(e => e.property === 'sourceNodeId')).toBe(true);
  });
  it('create 缺 data 可选通过（首开编辑器 3 字段 upsert——service 缺省空工程；Plan 2 浏览器验收发现 DTO/service 脱节）', async () => {
    const dto = plainToInstance(CreateVideoProjectDto, { workflowId: 'wp1', sourceNodeId: 'node-1', title: 'x' });
    expect(await validate(dto)).toHaveLength(0);
  });
  it('create data 非对象仍拒绝', async () => {
    const dto = plainToInstance(CreateVideoProjectDto, { workflowId: 'wp1', sourceNodeId: 'n1', title: 'x', data: 'bad' });
    const errs = await validate(dto);
    expect(errs.some(e => e.property === 'data')).toBe(true);
  });
  it('patch data 非对象拒绝', async () => {
    const dto = plainToInstance(PatchVideoProjectDto, { data: 'not-object', baseUpdatedAt: '2026-09-10T00:00:00Z' });
    const errs = await validate(dto);
    expect(errs.some(e => e.property === 'data')).toBe(true);
  });
});
