import { IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

/** C2-3 解冻 ack 入参：projectId=''/目标项目 id（''=全局哨兵行 compact break-glass 形态——
 *  path param 空段不可表达故 body 承载）；remark=ack 凭证注记（runbook §14.1 处置序第四步）。
 *  '' 时 remark 必填=@ValidateIf 条件承载（break-glass 凭证注记禁缺→400；projectId≠'' 时
 *  ValidateIf=false 整组跳过=可选——class-validator 条件装饰器语义单属性单组，长度帽随组）。 */
export class UnfreezeOpsGateDto {
  @IsString()
  @MaxLength(64)
  projectId!: string;

  @ValidateIf((o) => o.projectId === '')
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  remark?: string;
}
