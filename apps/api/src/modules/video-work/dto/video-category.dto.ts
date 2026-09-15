import { IsString, IsInt, IsBoolean, IsOptional, MaxLength } from 'class-validator';

export class CreateVideoCategoryDto {
  @IsString() @MaxLength(64) name!: string; // !（strict 下 definite assignment，先例 create-home-banner.dto.ts:25）
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateVideoCategoryDto {
  @IsOptional() @IsString() @MaxLength(64) name?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
