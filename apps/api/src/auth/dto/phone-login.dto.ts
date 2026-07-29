import { IsString, Matches } from 'class-validator';

export class PhoneLoginDto {
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: '验证码为6位数字' })
  code!: string;
}
