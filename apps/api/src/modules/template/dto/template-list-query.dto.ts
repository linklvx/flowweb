import { IsOptional, IsString, IsInt, Min, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
export class TemplateListQueryDto {
  @IsOptional() @IsIn(['my']) type?: string; // M0 后唯一取值（official/community 随市场下线）
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(['newest']) sort?: string; // importCount 列已 drop
  @IsOptional() @Transform(({ value }) => parseInt(value, 10)) @IsInt() @Min(1) page?: number;
  @IsOptional() @Transform(({ value }) => parseInt(value, 10)) @IsInt() @Min(1) limit?: number;
  @IsOptional() @IsString() folderId?: string;
  @IsOptional() @IsString() teamId?: string;
}
