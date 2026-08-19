import { IsString, IsOptional, IsBoolean, Length, ValidateIf, IsNotEmpty } from 'class-validator';

export class UpdateTemplateDto {
  @IsOptional() @IsString() @Length(1, 255) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @IsNotEmpty() folderId?: string | null;
}
