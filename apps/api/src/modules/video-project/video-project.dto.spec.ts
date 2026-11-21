import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterGeneratedDto, RegenerateDto } from './video-project.dto';

// Y4a T8：CreateVideoProjectDto/PatchVideoProjectDto 随 REST 工程面退场（表整删）——create/patch 段同删。

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
  const ok = { workflowId: 'w1', sourceNodeId: 'edit-1', resolution: '720p', durationSec: 60, actualSize: 1000 };
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
  it('Y4a T8 re-key：sourceNodeId 必填（旧键 videoProjectId 不再声明——whitelist 剥离即拒）', async () => {
    const errs = await validate(plainToInstance(RegisterGeneratedDto, { workflowId: 'w1', resolution: '720p', durationSec: 60, actualSize: 1000 }));
    expect(errs.some(e => e.property === 'sourceNodeId')).toBe(true);
  });
});
