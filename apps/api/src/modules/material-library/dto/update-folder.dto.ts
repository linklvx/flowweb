import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class UpdateFolderDto {
  @IsOptional() @IsString() @IsNotEmpty()
  name?: string;

  @IsOptional() @IsString()
  teamId?: string;
}
