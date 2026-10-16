import { IsOptional, IsString, Length, Matches, Validate, ValidatorConstraint, isURL, type ValidationArguments, type ValidatorConstraintInterface } from 'class-validator';
import { Transform } from 'class-transformer';

// T34（Z79/RC3+Z45⑤前半）：头像 URL 两校验的装饰器实参（@IsUrl options/@Matches regex）原在类
// 定义期（模块加载期）求值——NODE_ENV 冻结在 import 时点（dotenv→validateEnv 写回之前=Z79 违规
// 面；vi.stubEnv 对其无效）。改自定义 ValidatorConstraint（class-validator 原生形态）：validate()
// 调用期读 NODE_ENV。语义保持现档二分（production=https+require_tld+白名单域/其余=localhost 档
// 宽松）——COOKIE_SECURE 三态 resolver 单点归 T35（RC7 边界，本 constraint 届时为挂载面）。
// 消息面与原两装饰器对齐：isUrl 缺省消息+白名单自定义消息（两 constraint 分立承担）。
const AVATAR_URL_PROD_RE =
  /^https:\/\/[\w.-]*((flowai\.dev)|(cdn\.flowai\.dev)|(githubusercontent\.com)|(googleusercontent\.com))(\/|$)/;
const AVATAR_URL_DEV_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i;

function avatarUrlProduction(): boolean {
  // T34（Z45②）：校验期惰性读——validateEnv 写回后 process.env.NODE_ENV ≡ env.NODE_ENV 单源同答案
  return process.env.NODE_ENV === 'production';
}

@ValidatorConstraint({ name: 'envAwareIsUrl', async: false })
class EnvAwareIsUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const prod = avatarUrlProduction();
    return isURL(value, {
      require_tld: prod,
      protocols: prod ? ['https'] : ['http', 'https'],
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
    return (avatarUrlProduction() ? AVATAR_URL_PROD_RE : AVATAR_URL_DEV_RE).test(value);
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
