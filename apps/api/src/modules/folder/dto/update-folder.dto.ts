import { IsString, Length } from 'class-validator';

export class UpdateFolderDto {
  @IsString() @Length(1, 255) name!: string;
}
