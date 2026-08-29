import { IsArray, IsString, IsOptional } from 'class-validator';

export class BatchMoveFilesDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];

  @IsOptional()
  @IsString()
  folderId?: string | null;

  @IsOptional()
  @IsString()
  teamId?: string;
}
