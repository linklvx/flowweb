import { IsArray, IsString, IsOptional } from 'class-validator';

export class BatchRestoreFilesDto {
  @IsArray() @IsString({ each: true })
  ids!: string[];

  @IsOptional() @IsString()
  teamId?: string;
}
