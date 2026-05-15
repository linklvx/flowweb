import { IsString, IsOptional, IsBoolean, Length } from 'class-validator';
export class CreateTemplateDto {
  @IsString() projectId!: string;
  @IsString() @Length(1, 50) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isPublic?: boolean;
}
