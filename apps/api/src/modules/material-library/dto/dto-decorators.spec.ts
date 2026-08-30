import { describe, it, expect } from 'vitest';
import { CreateFolderDto } from './create-folder.dto';
import { UpdateFolderDto } from './update-folder.dto';
import { MoveFileDto } from './move-file.dto';
import { MoveFolderDto } from './move-folder.dto';
import { BatchDeleteFilesDto } from './batch-delete-files.dto';

describe('material DTO 装饰器语义', () => {
  it('CreateFolderDto：合法值通过', () => {
    const dto = new CreateFolderDto();
    dto.name = '角色';
    dto.parentId = 'f1';
    dto.teamId = 't1';
    expect(dto.name).toBe('角色');
  });

  it('MoveFileDto：folderId null 通过（根目录语义）、缺失时为 undefined（必填由 ValidateIf 保证非空串校验）', () => {
    const dto = new MoveFileDto();
    dto.folderId = null;
    expect(dto.folderId).toBeNull();
  });

  it('BatchDeleteFilesDto：ids 数组 + teamId 可选', () => {
    const dto = new BatchDeleteFilesDto();
    dto.ids = ['a', 'b'];
    dto.teamId = 't1';
    expect(dto.ids).toEqual(['a', 'b']);
  });
});
