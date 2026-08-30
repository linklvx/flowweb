import { IsBoolean, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export class CreateAnnouncementDto {
  @IsString()
  @MaxLength(200)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Matches(/^#[0-9a-fA-F]{3,8}$/, { message: 'bgColor 必须是十六进制颜色' })
  bgColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Matches(/^#[0-9a-fA-F]{3,8}$/, { message: 'textColor 必须是十六进制颜色' })
  textColor?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(32)
  linkText?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\//, { message: 'linkUrl 必须以 http(s):// 开头' })
  linkUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
