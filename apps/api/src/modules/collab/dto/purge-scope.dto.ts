// apps/api/src/modules/collab/dto/purge-scope.dto.ts
// C4-c2（生产就绪收尾批·project-erasure）：purgeScope 内部端点 body DTO（body-param-ratchet v5
// 棘轮合规形态——CollectMediaRefsDto 同族：DTO-class+端点局部 ValidationPipe）。
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class PurgeScopeDto {
  /** 擦除 scope 项目集（worker 单 scope 调用恒 1 项——上限 50 与 service 限批同值双保险）。 */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  projectIds!: string[];
}
