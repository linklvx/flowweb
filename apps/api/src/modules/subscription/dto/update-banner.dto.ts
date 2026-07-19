import { IsString, IsOptional, IsBoolean, IsDateString, MaxLength, Matches, ValidateIf } from 'class-validator';

export class UpdateBannerDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;

  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @IsString()
  backgroundImageKey?: string | null;

  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\//, { message: 'backgroundImageUrl must use http or https protocol' })
  backgroundImageUrl?: string | null;

  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @IsDateString()
  countdownEndAt?: string | null;

  @IsOptional()
  @IsBoolean()
  autoExtend?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
