import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateFolderDto {
  @IsString() @IsNotEmpty()
  name!: string;

  @IsOptional() @IsString()
  parentId?: string | null;

  @IsOptional() @IsString()
  teamId?: string;
}
