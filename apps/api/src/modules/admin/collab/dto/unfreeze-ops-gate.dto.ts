import { IsOptional, IsString, MaxLength } from 'class-validator';

/** C2-3 解冻 ack 入参：projectId=''/目标项目 id（''=全局哨兵行 compact break-glass 形态——
 *  path param 空段不可表达故 body 承载）；remark=ack 凭证注记（runbook §14 处置序第四步）。 */
export class UnfreezeOpsGateDto {
  @IsString()
  @MaxLength(64)
  projectId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  remark?: string;
}
