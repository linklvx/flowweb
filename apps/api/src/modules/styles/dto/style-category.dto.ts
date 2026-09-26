import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateStyleCategoryDto {
  @IsString() @MaxLength(30) name!: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateStyleCategoryDto {
  @IsOptional() @IsString() @MaxLength(30) name?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
