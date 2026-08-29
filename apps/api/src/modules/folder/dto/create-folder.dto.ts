import { IsString, IsOptional, Length } from 'class-validator';

export class CreateFolderDto {
  @IsString() @Length(1, 255) name!: string;
  @IsOptional() @IsString() parentId?: string;
}
