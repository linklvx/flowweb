import { IsString, IsInt, IsBoolean, IsOptional, MaxLength } from 'class-validator';

export class CreateVideoTagDto {
  @IsString() @MaxLength(32) name!: string; // !（strict 下 definite assignment，先例 create-home-banner.dto.ts:25）
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateVideoTagDto {
  @IsOptional() @IsString() @MaxLength(32) name?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
