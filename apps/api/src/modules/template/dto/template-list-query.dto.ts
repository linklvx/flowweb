import { IsOptional, IsString, IsInt, Min, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
export class TemplateListQueryDto {
  @IsOptional() @IsIn(['official', 'my', 'community']) type?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(['importCount', 'newest']) sort?: string;
  @IsOptional() @Transform(({ value }) => parseInt(value, 10)) @IsInt() @Min(1) page?: number;
  @IsOptional() @Transform(({ value }) => parseInt(value, 10)) @IsInt() @Min(1) limit?: number;
  @IsOptional() @IsString() folderId?: string;
  @IsOptional() @IsString() teamId?: string;
}
