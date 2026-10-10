import { IsString, IsObject, IsOptional, ValidateNested, IsNumber, IsBoolean, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

class LightingPositionDto {
  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;

  @IsNumber()
  z!: number;
}

class LightingParamsDto {
  @ValidateNested()
  @Type(() => LightingPositionDto)
  position!: LightingPositionDto;

  @IsNumber()
  @Min(0)
  @Max(100)
  brightness!: number;

  @IsNumber()
  @Min(2000)
  @Max(10000)
  colorTemperature!: number;

  @IsBoolean()
  rimLight!: boolean;

  @IsOptional()
  @IsString()
  customPrompt?: string;
}

export class CreateLightingTaskDto {
  @IsString()
  nodeId!: string;

  @IsString()
  projectId!: string;

  @IsString()
  originalImageId!: string;

  @ValidateNested()
  @Type(() => LightingParamsDto)
  params!: LightingParamsDto;

  @IsOptional()
  @IsString()
  regenToken?: string; // Y0b-2 T6：客户端手势 token（改名自 intentId 位——Z109；whitelist 管道须登记否则被剥）

  /** Y0b-2 T7：SV 支配门必填——缺省交 assertSyncAdmitted 400 SYNC_STATE_VECTOR_REQUIRED
   *  （四受理端点同型单源；whitelist 管道须登记否则被剥） */
  @IsOptional()
  @IsString()
  stateVector?: string;
}
