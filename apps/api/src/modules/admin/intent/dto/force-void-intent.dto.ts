import { IsNotEmpty, IsString } from 'class-validator';

/** Y0b-1 force-void：意图行 id（GenerationIntent.id——cuid 主键，非客户端 intentId） */
export class ForceVoidIntentDto {
  @IsString()
  @IsNotEmpty()
  intentRowId!: string;
}
