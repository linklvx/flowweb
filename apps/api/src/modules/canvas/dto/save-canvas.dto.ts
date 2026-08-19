import { IsString, IsOptional, IsBoolean, Length } from 'class-validator';

export class SaveCanvasDto {
  @IsString() @Length(1, 255) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isPublic?: boolean;
}
