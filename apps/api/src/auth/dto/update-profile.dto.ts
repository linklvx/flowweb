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
    host_whitelist: process.env.NODE_ENV === 'production'
      ? ['flowai.dev', 'cdn.flowai.dev', '*.githubusercontent.com', '*.googleusercontent.com']
      : ['localhost', '127.0.0.1']
  })
  image?: string;
}
