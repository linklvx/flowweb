import { IsString, IsNotEmpty, IsOptional, ValidateIf } from 'class-validator';

export class MoveFileDto {
  @ValidateIf((_, v) => v !== null) @IsString() @IsNotEmpty()
  folderId!: string | null;

  @IsOptional() @IsString()
  teamId?: string;
}
