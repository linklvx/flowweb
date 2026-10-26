// apps/api/src/modules/collab/runtime-feed.controller.ts
// Y1c T22（plan v1.7 Task 22——spec §7「唯一交付=HTTP 游标」）：feed HTTP 端点。
// ①GET /api/collab/runtime-feed/:projectId/snapshot——首连 RR 快照 {snapshot,cursor,minRetainedSeq,
//   historyId}（#10 换代必须全量 snapshot——snapshot=全量替换+统一 cursor；historyId 不匹配档
//   客户端清投影重建）；
// ②GET /api/collab/runtime-feed/:projectId/events?after=&limit=——cursor 后升序 ≤200 行
//   （返回不连续=缺口→客户端从 cursor 重取；cursor<minRetainedSeq→全量快照——判定归客户端
//   reducer，响应恒携 latestFeedSeq/minRetainedSeq/historyId）。
// 鉴权=全局 AuthGuard（JWT——非 public 前缀路径默认会话面）+ProjectPermissionService.assertEditor
// （项目成员读门——feed 事件虽经 PII 扫描，成员门维持与 readCanvas 同尺）。
import { Controller, Get, Param, Query, ParseIntPipe, DefaultValuePipe, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RuntimeFeedService } from './runtime-feed.service';
import { ProjectPermissionService } from '../team/project-permission.service';

@Controller('api/collab/runtime-feed')
export class RuntimeFeedController {
  constructor(
    private readonly feed: RuntimeFeedService,
    private readonly perm: ProjectPermissionService,
  ) {}

  /** 首连/换代/游标失效快照（RR 读——事件与水位一致性由 cursor 三元承载）。 */
  @Get(':projectId/snapshot')
  async snapshot(@Param('projectId') projectId: string, @Req() req: Request) {
    await this.perm.assertEditor(projectId, (req as { user?: { id?: string } }).user?.id ?? '');
    return this.feed.snapshotEnvelope(projectId);
  }

  /** 增量续传（升序 ≤200；limit 上界 200 硬帽在 service）。 */
  @Get(':projectId/events')
  async events(
    @Param('projectId') projectId: string,
    @Req() req: Request,
    @Query('after', new DefaultValuePipe('0')) after: string,
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit: number,
  ) {
    await this.perm.assertEditor(projectId, (req as { user?: { id?: string } }).user?.id ?? '');
    const afterSeq = BigInt(/^\d+$/.test(after ?? '') ? after : '0');
    const events = await this.feed.readAfter(projectId, afterSeq, limit);
    const [latestFeedSeq, minRetainedSeq, historyId] = await Promise.all([
      this.feed.latestFeedSeq(projectId),
      this.feed.minRetainedSeq(projectId),
      this.feed.currentHistoryId(),
    ]);
    return {
      events,
      latestFeedSeq: latestFeedSeq.toString(),
      minRetainedSeq: minRetainedSeq.toString(),
      historyId,
    };
  }
}
