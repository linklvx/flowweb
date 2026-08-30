import { describe, it, expect } from 'vitest';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { CreateFolderDto } from './create-folder.dto';
import { MoveFileDto } from './move-file.dto';
import { BatchDeleteFilesDto } from './batch-delete-files.dto';

describe('material DTO whitelist 剥离', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const meta = (mt: any) => ({ type: 'body', metatype: mt } as any);

  it('未声明字段被剥离、合法字段保留', async () => {
    const value = await pipe.transform(
      { name: 'x', teamId: 't1', malicious: 'hack' },
      meta(CreateFolderDto),
    );
    expect(value).toEqual({ name: 'x', teamId: 't1' });
    expect((value as any).malicious).toBeUndefined();
  });

  it('MoveFileDto 缺 folderId 被拒（必填可空）', async () => {
    await expect(
      pipe.transform({ teamId: 't1' }, meta(MoveFileDto)),
    ).rejects.toThrow(BadRequestException);
  });

  it('MoveFileDto folderId=null 通过（根目录）', async () => {
    const value = await pipe.transform({ folderId: null }, meta(MoveFileDto));
    expect(value).toEqual({ folderId: null });
  });

  it('BatchDeleteFilesDto ids 非数组被拒', async () => {
    await expect(
      pipe.transform({ ids: 'not-array' }, meta(BatchDeleteFilesDto)),
    ).rejects.toThrow(BadRequestException);
  });
});
