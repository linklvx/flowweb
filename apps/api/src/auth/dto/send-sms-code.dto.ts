import { IsString, Matches } from 'class-validator';

export class SendSmsCodeDto {
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;
}
