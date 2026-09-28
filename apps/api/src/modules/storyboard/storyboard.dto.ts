import { IsArray, IsInt, IsIn, IsBoolean, IsString, Min, Max } from 'class-validator';
import { VALID_ASPECT_RATIOS, VALID_RESOLUTIONS } from './storyboard.constants';

/** stitch 线上载荷契约（R0d①）：@Body() 必须是 class——inline type/any 的 metatype 是 Object，
 *  pipe 直接跳过（F31）。键集=shared STITCH_JOB_KEYS（storyboard.pipe.spec.ts 锚定）；
 *  sourceGroupId 是客户端本地定位字段，已由 stitchApi 剥离（Task 17）。 */
export class CreateStitchTaskDto {
  @IsArray()
  @IsString({ each: true })
  fileIds!: string[];

  @IsInt()
  @Min(1)
  @Max(10)
  gridRows!: number;

  @IsInt()
  @Min(1)
  @Max(10)
  gridCols!: number;

  @IsIn(VALID_ASPECT_RATIOS)
  aspectRatio!: string;

  @IsBoolean()
  showIndex!: boolean;

  @IsIn(VALID_RESOLUTIONS)
  resolution!: string;
}
