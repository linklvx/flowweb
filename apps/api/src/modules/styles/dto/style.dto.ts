import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateStyleDto {
  @IsString() @MaxLength(60) name!: string;
  @IsString() categoryId!: string;
  @IsString() coverKey!: string;
  @IsOptional() @IsString() @MaxLength(60) authorName?: string;
  @IsOptional() @IsBoolean() isCommercial?: boolean;
  @IsString() @MaxLength(2000) promptText!: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateStyleDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() coverKey?: string;
  @IsOptional() @IsString() @MaxLength(60) authorName?: string;
  @IsOptional() @IsBoolean() isCommercial?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) promptText?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
