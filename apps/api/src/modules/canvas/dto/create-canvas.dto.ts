import { IsString, IsOptional, Length, ValidateIf, IsNotEmpty } from 'class-validator';

export class CreateCanvasDto {
  @IsString() @Length(1, 255) name!: string;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @IsNotEmpty() folderId?: string | null;
}
