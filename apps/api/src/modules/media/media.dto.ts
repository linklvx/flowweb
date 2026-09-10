import { IsArray, IsString, ArrayMaxSize } from 'class-validator';
export class BatchGetMediaDto {
  @IsArray() @IsString({ each: true }) @ArrayMaxSize(200) ids!: string[]; // 上限防 findMany 被万级 ids 砸
}
