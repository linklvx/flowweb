import { IsString, IsInt, IsBoolean, IsOptional, IsArray, IsIn, MaxLength, ArrayMaxSize } from 'class-validator';

export class CreateVideoWorkDto {
  @IsString() @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsString() @MaxLength(64) authorName!: string;
  @IsOptional() @IsString() categoryId?: string;

  @IsString() @MaxLength(512) videoKey!: string;          // 取自 candidate.key
  @IsOptional() @IsString() videoMediaId?: string;        // 取自 candidate.id
  @IsOptional() @IsString() @MaxLength(512) coverKey?: string;
  @IsOptional() @IsString() canvasProjectId?: string;     // 取自 candidate.projectId（D16）

  @IsOptional() @IsInt() durationSec?: number;
  @IsOptional() @IsInt() width?: number;
  @IsOptional() @IsInt() height?: number;

  @IsOptional() @IsInt() viewCount?: number;              // 后台可调（覆盖式）
  @IsOptional() @IsInt() likeCount?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED'] as const) status?: 'DRAFT' | 'PUBLISHED'; // @IsIn 非 @IsEnum（C2 Task 2.3——按值匹配成立但文案为空，IsIn 更干净）
  @IsOptional() @IsBoolean() allowViewProcess?: boolean;
  @IsOptional() @IsBoolean() allowClone?: boolean;
  // 注意：无 publishedAt 字段——服务端专用（spec §4.3）
}
