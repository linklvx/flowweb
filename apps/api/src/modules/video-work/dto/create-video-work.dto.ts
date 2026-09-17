import { IsString, IsInt, IsBoolean, IsOptional, IsArray, IsIn, MaxLength, ArrayMaxSize } from 'class-validator';

export class CreateVideoWorkDto {
  @IsString() @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsString() @MaxLength(64) authorName!: string;
  @IsOptional() @IsString() categoryId?: string;

  @IsString() @MaxLength(512) videoKey!: string;          // 成品视频对象键（presign-video 返回的 key，F2 校验与 videoMediaId 交叉一致）
  @IsOptional() @IsString() videoMediaId?: string;        // presign-video 建的 Media 行 id（platform-team 归属，F2 必填校验在 service）
  @IsOptional() @IsString() @MaxLength(512) coverKey?: string;
  @IsOptional() @IsString() canvasProjectId?: string;     // 源画布（可选；非空时 findCanvasRef 校验存在性）

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
