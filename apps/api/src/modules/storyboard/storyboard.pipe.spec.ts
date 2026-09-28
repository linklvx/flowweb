import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { PIPES_METADATA } from '@nestjs/common/constants';
import { STITCH_JOB_KEYS } from '@flowweb/shared';
import { CreateStitchTaskDto } from './storyboard.dto';
import { StoryboardController } from './storyboard.controller';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true });
const meta = { type: 'body', metatype: CreateStitchTaskDto } as any;

const validBody = { fileIds: ['f1'], gridRows: 2, gridCols: 2, aspectRatio: '16:9', showIndex: true, resolution: '4K' };

describe('stitch pipe 配置（R0d①——走私 400 可观测）', () => {
  it('塞 nodeId → BadRequest 且结构化报文含 nodeId（不依赖英文报文原文）', async () => {
    await expect(pipe.transform({ ...validBody, nodeId: 'victim' }, meta)).rejects.toThrow(BadRequestException);
    try {
      await pipe.transform({ ...validBody, nodeId: 'victim' }, meta);
      expect.unreachable('应抛 BadRequestException');
    } catch (e: any) {
      const msgs = (e.getResponse?.() as { message?: string[] })?.message ?? [];
      expect(msgs.join()).toContain('nodeId');
    }
  });

  it('塞 projectId/userId（IDOR 键）→ 拒', async () => {
    await expect(pipe.transform({ ...validBody, projectId: 'V', userId: 'X' }, meta)).rejects.toThrow(BadRequestException);
  });

  it('塞 sourceGroupId（Task 17 剥离前的历史第 7 键）→ 拒（服务端不再容忍）', async () => {
    await expect(pipe.transform({ ...validBody, sourceGroupId: 'g1' }, meta)).rejects.toThrow(BadRequestException);
  });

  it('合法六键透传（whitelist 不误伤）', async () => {
    await expect(pipe.transform(validBody, meta)).resolves.toEqual(validBody);
  });

  it('每个线上键的非标量/错误值被拒（漏装饰器 = whitelist 剥除后 forbid 400——发射策略无关的键集锚定）', async () => {
    const invalid: Record<string, unknown> = {
      fileIds: 'not-array', gridRows: 'x', gridCols: 'x',
      aspectRatio: 'bogus', showIndex: 'x', resolution: '8K',
    };
    for (const k of STITCH_JOB_KEYS) {
      await expect(pipe.transform({ ...validBody, [k]: invalid[k] }, meta)).rejects.toThrow(BadRequestException);
    }
    // v5：数组元素类型维度（@IsString({each:true}) 的射程）
    await expect(pipe.transform({ ...validBody, fileIds: ['ok', 123] }, meta)).rejects.toThrow(BadRequestException);
  });

  it('任意第 7 键被拒（键集契约的行为面——防 STITCH_JOB_KEYS 与 DTO 漂移）', async () => {
    await expect(pipe.transform({ ...validBody, anySeventhKey: 1 }, meta)).rejects.toThrow(BadRequestException);
  });
});

describe('controller 挂载结构断言（pipe 行为对 ≠ 挂上了 ≠ 选项对——三层分开锁）', () => {
  it('stitch 方法挂了 ValidationPipe 且选项含 whitelist+forbidNonWhitelisted（instanceof 锁不住选项——摘掉 forbid 仍 instanceof）', () => {
    const pipes = Reflect.getMetadata(PIPES_METADATA, StoryboardController.prototype.stitch);
    expect(Array.isArray(pipes)).toBe(true);
    expect(pipes.length).toBeGreaterThan(0);
    expect(pipes[0]).toBeInstanceOf(ValidationPipe);
    // ValidationPipe 把选项存 this.validatorOptions（@nestjs/common 10.4.x 实现细节，已验证）。
    // v4 降级话术：若因 Nest 升级此断言失败（私有字段改名），改为断言 controller 源码文本
    // 'forbidNonWhitelisted: true' 同现——勿删断言（摘掉 forbid 会让走私变静默剥除，正是 F31 要消灭的形态）。
    expect((pipes[0] as any).validatorOptions).toMatchObject({ whitelist: true, forbidNonWhitelisted: true });
  });
});
