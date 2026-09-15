import { IsString, IsInt, IsBoolean, IsOptional, IsArray, IsIn, MaxLength, ArrayMaxSize } from 'class-validator';

export class UpdateVideoWorkDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;          // 可选（仅改状态/计数等场景）
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(64) authorName?: string;
  @IsOptional() @IsString() categoryId?: string | null;
  @IsOptional() @IsString() @MaxLength(512) coverKey?: string;       // 封面可换（上传新图）
  @IsOptional() @IsString() canvasProjectId?: string | null;
  @IsOptional() @IsInt() durationSec?: number;
  @IsOptional() @IsInt() width?: number;
  @IsOptional() @IsInt() height?: number;
  @IsOptional() @IsInt() viewCount?: number;
  @IsOptional() @IsInt() likeCount?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED'] as const) status?: 'DRAFT' | 'PUBLISHED';
  @IsOptional() @IsBoolean() allowViewProcess?: boolean;
  @IsOptional() @IsBoolean() allowClone?: boolean;
  // 无 videoKey/videoMediaId（换源=重建）、无 publishedAt（服务端专用）
}
