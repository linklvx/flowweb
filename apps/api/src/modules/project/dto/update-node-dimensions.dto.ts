import { IsString, IsNumber, Min, Max } from 'class-validator';

export class UpdateNodeDimensionsDto {
  @IsString()
  id: string;

  @IsNumber()
  @Min(280)
  @Max(2000)
  width: number;

  @IsNumber()
  @Min(120)
  @Max(1500)
  height: number;
}
