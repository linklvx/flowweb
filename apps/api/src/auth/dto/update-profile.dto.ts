import { IsOptional, IsString, Length, IsUrl, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @Length(1, 50)
  @Matches(/^[\p{L}\p{N}\s_-]+$/u, {
    message: '用户名只能包含字母、数字、空格、下划线和连字符'
  })
  name?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsUrl({
    require_tld: process.env.NODE_ENV === 'production',
    protocols: process.env.NODE_ENV === 'production' ? ['https'] : ['http', 'https'],
    allow_underscores: true,
    // host_whitelist uses exact string matching (Array.includes), not glob patterns.
    // Use @Matches below for domain validation.
  })
  @Matches(
    process.env.NODE_ENV === 'production'
      ? /^https:\/\/[\w.-]*((flowai\.dev)|(cdn\.flowai\.dev)|(githubusercontent\.com)|(googleusercontent\.com))(\/|$)/
      : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i,
    { message: '头像 URL 域名不在允许的白名单中' }
  )
  image?: string;
}
