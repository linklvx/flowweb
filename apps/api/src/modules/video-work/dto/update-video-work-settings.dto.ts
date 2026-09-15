import { IsBoolean, IsIn } from 'class-validator';

export class UpdateVideoWorkSettingsDto {
  @IsBoolean() carouselEnabled!: boolean;
  @IsIn(['all', 'category'] as const) carouselScope!: 'all' | 'category';
}
