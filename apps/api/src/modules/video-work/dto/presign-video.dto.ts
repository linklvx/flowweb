import { IsString, IsInt } from 'class-validator';
// 只做结构约束（通过类级 whitelist/forbidNonWhitelisted）——语义校验（mp4/大小）在 service 抛中文字符串：
// 装饰器 message 是数组，经 HttpException.initMessage 的 constructor.name 兜底后前端只见 "Bad Request Exception"
// （phone-login.dto.ts:5 的中文装饰器消息同款到不了响应体）。裸 TS 类 DTO 在本 controller 恒 400（无 pipe 的 storage 才允许）。
export class PresignVideoDto {
  @IsString() fileName!: string;
  @IsString() fileType!: string;
  @IsInt() fileSize!: number;
}
