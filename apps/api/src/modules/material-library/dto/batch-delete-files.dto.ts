import { IsArray, IsString, IsOptional } from 'class-validator';

export class BatchDeleteFilesDto {
  @IsArray() @IsString({ each: true })
  ids!: string[];

  @IsOptional() @IsString()
  teamId?: string;
}
