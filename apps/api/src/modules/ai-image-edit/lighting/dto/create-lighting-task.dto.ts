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
}
