import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateVideoProjectDto, PatchVideoProjectDto, RegisterGeneratedDto, RegenerateDto } from './video-project.dto';

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

describe('RegenerateDto（批5-1 retakeId 客户端生成透传）', () => {
  const ok = { workflowId: 'w1', sourceNodeId: 'src1', kind: 'video' as const };
  it('齐全通过（retakeId 必填）', async () => {
    const dto = plainToInstance(RegenerateDto, { ...ok, retakeId: 'rtk-1' });
    expect(await validate(dto)).toHaveLength(0);
  });
  it('缺 retakeId 拒绝——幂等键必须客户端生成（服务端兜底=每次新 id=重放无幂等，E0 病因复发）', async () => {
    const errs = await validate(plainToInstance(RegenerateDto, ok));
    expect(errs.some(e => e.property === 'retakeId')).toBe(true);
  });
  it('kind 非 video/audio 拒绝（@IsIn）', async () => {
    const errs = await validate(plainToInstance(RegenerateDto, { ...ok, kind: 'image', retakeId: 'r' }));
    expect(errs.some(e => e.property === 'kind')).toBe(true);
  });
});

describe('RegisterGeneratedDto（批5-4 导出 DTO：480p/@Max(900)/可选 width-height）', () => {
  const ok = { workflowId: 'w1', videoProjectId: 'p1', resolution: '720p', durationSec: 60, actualSize: 1000 };
  it('480p 与 durationSec=900 合法（15min 上限服务端同步，spec 5.5）', async () => {
    const dto = plainToInstance(RegisterGeneratedDto, { ...ok, resolution: '480p', durationSec: 900 });
    expect(await validate(dto)).toHaveLength(0);
  });
  it('2160p 拒绝', async () => {
    const errs = await validate(plainToInstance(RegisterGeneratedDto, { ...ok, resolution: '2160p' }));
    expect(errs.some(e => e.property === 'resolution')).toBe(true);
  });
  it('durationSec=901 拒绝', async () => {
    const errs = await validate(plainToInstance(RegisterGeneratedDto, { ...ok, durationSec: 901 }));
    expect(errs.some(e => e.property === 'durationSec')).toBe(true);
  });
  it('width/height 可选（不传通过）；传 0 拒绝（@Min(1)）', async () => {
    expect(await validate(plainToInstance(RegisterGeneratedDto, ok))).toHaveLength(0);
    const errs = await validate(plainToInstance(RegisterGeneratedDto, { ...ok, width: 0, height: 0 }));
    expect(errs.some(e => e.property === 'width')).toBe(true);
    expect(errs.some(e => e.property === 'height')).toBe(true);
  });
});
