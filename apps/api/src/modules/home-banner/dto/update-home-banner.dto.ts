import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpdateHomeBannerDto {
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(128)
  title?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(256)
  subtitle?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\//, { message: 'linkUrl 必须以 http(s):// 开头' })
  linkUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  imageKey?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
