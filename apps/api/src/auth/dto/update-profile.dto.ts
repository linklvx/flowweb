import { IsOptional, IsString, Length, Matches, Validate, ValidatorConstraint, isURL, type ValidationArguments, type ValidatorConstraintInterface } from 'class-validator';
import { Transform } from 'class-transformer';
import { resolveSecureTransport } from '../../config/env';   // T35（Z13+Z45⑤）：严格档判据单点

// T34（Z79/RC3+Z45⑤前半）：头像 URL 两校验的装饰器实参（@IsUrl options/@Matches regex）原在类
// 定义期（模块加载期）求值——NODE_ENV 冻结在 import 时点（dotenv→validateEnv 写回之前=Z79 违规
// 面；vi.stubEnv 对其无效）。改自定义 ValidatorConstraint（class-validator 原生形态）：validate()
// 调用期求值。T35（Z13+Z45⑤）：严格档判据=resolveSecureTransport() 单点（原 avatarUrlProduction
// NODE_ENV 二分退役——「传输必须 TLS」与 cookie secure 同一 resolver 驱动，禁第二处判断）；
// 严格档=https+require_tld+白名单域/宽松档=localhost 档，消息面与原两装饰器对齐零变化。
const AVATAR_URL_PROD_RE =
  /^https:\/\/[\w.-]*((flowai\.dev)|(cdn\.flowai\.dev)|(githubusercontent\.com)|(googleusercontent\.com))(\/|$)/;
const AVATAR_URL_DEV_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i;

@ValidatorConstraint({ name: 'envAwareIsUrl', async: false })
class EnvAwareIsUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const strict = resolveSecureTransport();
    return isURL(value, {
      require_tld: strict,
      protocols: strict ? ['https'] : ['http', 'https'],
      allow_underscores: true,
      // host_whitelist uses exact string matching (Array.includes), not glob patterns.
      // Use the whitelist constraint below for domain validation.
    });
  }
  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a URL address`;
  }
}

@ValidatorConstraint({ name: 'envAwareAvatarWhitelist', async: false })
class EnvAwareAvatarWhitelistConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return (resolveSecureTransport() ? AVATAR_URL_PROD_RE : AVATAR_URL_DEV_RE).test(value);
  }
  defaultMessage(): string {
    return '头像 URL 域名不在允许的白名单中';
  }
}

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
  @Validate(EnvAwareIsUrlConstraint)
  @Validate(EnvAwareAvatarWhitelistConstraint)
  image?: string;
}
