import { describe, it, expect } from 'vitest';
import { validateSync } from 'class-validator';
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

  it('MoveFileDto：folderId null 通过（根目录语义）', () => {
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

  it('CreateFolderDto：name 空串被拒（@IsNotEmpty）', () => {
    const dto = new CreateFolderDto();
    dto.name = '';
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('CreateFolderDto：合法完整值校验通过', () => {
    const dto = new CreateFolderDto();
    dto.name = '角色';
    dto.parentId = null;
    expect(validateSync(dto).length).toBe(0);
  });

  it('UpdateFolderDto：name 空串被拒、name 缺省放行', () => {
    const dto = new UpdateFolderDto();
    dto.name = '';
    expect(validateSync(dto).length).toBeGreaterThan(0);
    expect(validateSync(new UpdateFolderDto()).length).toBe(0);
  });

  it('MoveFolderDto：parentId/afterId 空串被拒、null 放行（必填可空语义）', () => {
    const dto = new MoveFolderDto();
    dto.parentId = '';
    dto.afterId = null;
    expect(validateSync(dto).length).toBeGreaterThan(0);
    dto.parentId = 'f1';
    expect(validateSync(dto).length).toBe(0);
  });
});
