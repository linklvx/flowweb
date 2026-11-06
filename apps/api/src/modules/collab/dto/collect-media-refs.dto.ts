// apps/api/src/modules/collab/dto/collect-media-refs.dto.ts
// C4-c1（生产就绪收尾批·project-erasure）：collectMediaRefs 内部端点 body DTO（body-param-ratchet
// v5 棘轮合规形态：@Body() inline 对象字面量/DTO-class-无-pipe 两档均禁新增——运行时校验=controller
// 侧 @UsePipes(new ValidationPipe({ whitelist: true }))（decorator 类约束在此声明，端点局部 pipe）。
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
