import { IsString, IsNotEmpty, IsOptional, ValidateIf } from 'class-validator';

export class MoveFolderDto {
  @ValidateIf((_, v) => v !== null) @IsString() @IsNotEmpty()
  parentId!: string | null;  // 目标父文件夹 ID (null = 根级)

  @ValidateIf((_, v) => v !== null) @IsString() @IsNotEmpty()
  afterId!: string | null;   // 排在哪个文件夹之后 (null = 最前面)

  @IsOptional() @IsString()
  teamId?: string;
}
