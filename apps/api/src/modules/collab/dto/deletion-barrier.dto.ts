// apps/api/src/modules/collab/dto/deletion-barrier.dto.ts
// C3b-4a（plan v3 Task C3b-4a）：DeletionBarrier loopback 端点 body DTO（v5 棘轮合规形态：
// DTO-class+端点局部 ValidationPipe——CollectMediaRefsDto 同族；inline/无-pipe 两档均禁新增）。
// action 分发：prepare={teamId, excludeProjectId?}（六步序编排+持有）；release={teamId, barrierId}。
import { IsIn, IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class DeletionBarrierDto {
  @IsIn(['prepare', 'release'])
  action!: 'prepare' | 'release';

  @IsString()
  @IsNotEmpty()
  teamId!: string;

  /** prepare 可选：erasure 被擦项目（其自身引用不算保护——C3b-3 同参）。 */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  excludeProjectId?: string;

  /** release 必携：barrierId 守卫（stale release 零行）。 */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  barrierId?: string;
}
