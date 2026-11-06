// apps/api/src/modules/collab/dto/collect-media-refs.dto.ts
// C4-c1（生产就绪收尾批·project-erasure）：collectMediaRefs 内部端点 body DTO（body-param-ratchet
// v5 棘轮——@Body() inline 对象字面量禁新增，worker 内部端点族=类 DTO 登记〔运行时校验在
// controller 手工面：内部通道无全局 ValidationPipe 依赖，与 exec-status 同律 fail-closed〕）。
import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class CollectMediaRefsDto {
  /** 扫描 team（他项目 doc 引用域）。 */
  @IsString()
  @IsNotEmpty()
  teamId!: string;

  /** 被擦项目（自引用不算——本 scope 行集随批删/工作 detach 自消）。 */
  @IsString()
  @IsNotEmpty()
  excludeProjectId!: string;

  /** 独占判别候选（≤ERASURE_MEDIA_REFS_BATCH——worker 侧按同值分片）。 */
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  mediaIds!: string[];
}
