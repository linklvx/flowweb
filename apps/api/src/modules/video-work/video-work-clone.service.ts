// video-work-clone.service.ts
import { Injectable, Inject, NotFoundException, ForbiddenException, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { ProjectService } from '../project/project.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';
import { buildFilteredSnapshot, CLONE_WHITELIST, type RawCanvasData, type RawNode, type FilteredNode, type FilteredEdge } from './snapshot-filter.util';
import { validateParentGraph } from '@flowweb/shared';

const CLONE_TIMEOUT_MS = 10_000; // read + create 同一有界等待（create 内部 withDoc 同样会挂起）

@Injectable()
export class VideoWorkCloneService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
    @Inject(ProjectService) private readonly projectService: ProjectService,
    @Inject(RateLimiterService) private readonly rateLimiter: RateLimiterService,
  ) {}

  async clone(workId: string, userId: string): Promise<{ projectId: string }> {
    const allowed = await this.rateLimiter.checkUserRateLimit(userId, 'video-work:clone', 3600, 10);
    if (!allowed) throw new ThrottlerException();
    const w = await this.prisma.videoWork.findUnique({ where: { id: workId } });
    if (!w || w.status !== 'PUBLISHED') throw new NotFoundException();
    if (!w.allowClone) throw new ForbiddenException();
    if (!w.canvasProjectId) throw new NotFoundException();
    const canvas = await this.prisma.canvasProject.findUnique({ where: { id: w.canvasProjectId }, select: { id: true } });
    if (!canvas) throw new NotFoundException();

    const run = async () => {
      const raw = await this.collabDoc.readCanvas(w.canvasProjectId!) as RawCanvasData;
      // 克隆走 CLONE_WHITELIST 分表（R0a）：group 7 键（storyboard/collapsed 等——F2 根因半边；O0b-5 摘 manuallyResized、O0c-3 摘 savedSize）；
      // 其余同快照（D9）：resetStatusIdle + 不注入缩略图 + 剥 videoEdit
      // （剥 videoEdit 是克隆独有差异——快照保留该节点类型只剥 data，spec:228/D9 第八轮归一；
      //  批5-1 删信箱后 shadow- 前缀剥除随行消失——id 前缀零特殊处理）
      const filtered = buildFilteredSnapshot(raw, {
        dropTypes: ['videoEdit'], dropIdPrefixes: [],
        resetStatusIdle: true, injectThumbnails: false,
        whitelist: CLONE_WHITELIST,
      });
      const { nodes, edges } = this.remapIds(filtered.nodes, filtered.edges, raw.nodes);
      // R1b Task 21 + O0a-2：clone 档检环+组深≤1（nested-group 两档共用单源升格 fatal——
      // 挂 remap 后——remapIds 已把悬空折平，clone 档悬空不报是降级红线；环/嵌套挂死 RF 无降级 → 400）。
      // 导入档的过滤前全检在 template.service 侧，两档各守各的时机
      const { violations } = validateParentGraph(nodes, 'clone');
      if (violations.some((v) => v.kind === 'cycle')) throw new BadRequestException('画布存在组引用环，无法克隆');
      if (violations.some((v) => v.kind === 'nested-group')) throw new BadRequestException('画布存在嵌套组，无法克隆');
      // O0b-0：normalizeLoadedCanvas 补缺层整删——clone 直读 doc（白名单过滤+remap 后直传；
      // 翻转后 doc=完整作者态，补几何语义整族死；盖章由 create 内种子戳点统一落）
      const project = await this.projectService.create(`${w.title} (副本)`, userId, nodes, edges);
      return { projectId: project.id };
    };
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      run(),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new ServiceUnavailableException('克隆超时')), CLONE_TIMEOUT_MS); }),
    ]).finally(() => clearTimeout(timer)); // 第八轮：与 withTimeout 同款清理，防悬挂定时器
  }

  /** 四元重映射（spec §4.7 红线）：id / parentId / edges source+target / group.data.cells。
   *  cells 三分支一律不抛（悬空 id 是可达真实状态）；禁止 idMap.get(id) || id 兜底。 */
  private remapIds(nodes: FilteredNode[], edges: FilteredEdge[], rawNodes: RawNode[]): { nodes: any[]; edges: FilteredEdge[] } {
    const droppedIds = new Set(
      rawNodes
        .filter(n => n.type === 'videoEdit')
        .map(n => n.id),
    );
    const idMap = new Map<string, string>();
    let seq = 0;
    const newId = () => `vw${Date.now().toString(36)}_${seq++}`;
    for (const n of nodes) idMap.set(n.id, newId());

    const remapped = nodes.map(n => ({ ...n, id: idMap.get(n.id)!, parentId: n.parentId ? (idMap.get(n.parentId) ?? null) : n.parentId }));
    // parentId 指向被剥/悬空 → null（与 cells 同语义降级，勿一条抛一条兜）
    const remappedEdges = edges
      .filter(e => idMap.has(e.source) && idMap.has(e.target))
      .map(e => ({ ...e, source: idMap.get(e.source)!, target: idMap.get(e.target)! }));

    for (const n of remapped) {
      if (n.type !== 'group' || !Array.isArray(n.data.cells)) continue;
      n.data.cells = (n.data.cells as (string | null)[]).map(c => {
        if (c === null || c === undefined) return null;      // 空宫格占位保持 null
        if (droppedIds.has(c)) return null;                   // 被剥槽位 → null
        const mapped = idMap.get(c);
        return mapped ?? null;                                // 悬空 id → null（禁 || c 兜底）；数组长度不变
      });
    }
    return { nodes: remapped, edges: remappedEdges };
  }
}
