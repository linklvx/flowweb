// apps/api/src/modules/collab/dto/author-slot.dto.ts
// Y2 B2a（裁决 11）：read/release-author-slot 两端点 body DTO（body-param-ratchet v5 棘轮合规形态
// ——purge-scope DTO 同族：DTO-class+端点局部 ValidationPipe；请求体只 intentRowId、worker 不传 mediaId）。
import { IsString } from 'class-validator';

export class AuthorSlotDto {
  /** 目标意图行（worker 侧 claim 上下文在手——scope 令牌绑 projectId/intentRowId/execSeq）。 */
  @IsString()
  intentRowId!: string;
}
