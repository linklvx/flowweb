import { IsString, IsOptional, IsBoolean, Length } from 'class-validator';
export class UpdateTemplateDto {
  @IsOptional() @IsString() @Length(1, 50) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isPublic?: boolean;
}
