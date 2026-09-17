// 空壳，构造签名一次到位——后续任务只加方法、不动构造/providers，spec 文件从创建起就 provide 全部依赖、永不需要二次编辑
import { Injectable, Inject, BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { buildFilteredSnapshot, type RawCanvasData } from './snapshot-filter.util';
import { CreateVideoWorkDto } from './dto/create-video-work.dto';
import { UpdateVideoWorkDto } from './dto/update-video-work.dto';
import { PresignVideoDto } from './dto/presign-video.dto';
import { StorageQuotaService } from '../team/storage-quota.service';
import { PLATFORM_TEAM_ID, PLATFORM_OWNER_ID } from '../team/team.util';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import Redis from 'ioredis';

@Injectable()
export class VideoWorkService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,             // @Global
    @Inject(MinioService) private readonly minio: MinioService,                 // @Global（presign + removeWork/updateWork 域分治对象清理——Task 5 红线改写）
    @Inject('REDIS_CLIENT') private readonly redis: Redis,                      // Task 2.1 缓存/3.3 liked/4.x 计数
    @Inject(RateLimiterService) private readonly rateLimiter: RateLimiterService, // Task 4.2 view 限流
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService, // Task 5.3 快照 readCanvas（详情端点禁用）
    @Inject(StorageQuotaService) private readonly quota: StorageQuotaService, // presignVideo 平台配额闸（Task 2）
  ) {}

  // —— 类型（改类型后删缓存（tags 公开端无缓存，无需失效），spec §4.2 categories 缓存失效） ——
  private static readonly CATEGORY_CACHE_KEY = 'videoWork:categories';

  private static readonly PROCESS_CACHE = (id: string) => `videoWork:process:${id}`;

  // like 键构造收敛为单一来源（批次 3 登记落点）：getDetail 读 liked / toggleLike 写删共用，防两处模板漂移
  private static likeKey(workId: string, userId: string): string {
    return `videoWork:like:${workId}:${userId}`;
  }

  //（第十一轮：删孤儿 listCategories()——公开端走 listCategoriesPublic（Task 3.2）、admin 端走 listAllCategories，全 plan 无第三调用者）
  async listAllCategories() {
    return this.prisma.videoCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }
  async createCategory(dto: { name: string; sortOrder?: number; active?: boolean }) {
    const row = await this.prisma.videoCategory.create({ data: dto });
    await this.invalidateCategoryCache();
    return row;
  }
  async updateCategory(id: string, dto: { name?: string; sortOrder?: number; active?: boolean }) {
    const row = await this.prisma.videoCategory.update({ where: { id }, data: dto });
    await this.invalidateCategoryCache();
    return row;
  }
  async deleteCategory(id: string) {
    await this.prisma.videoCategory.delete({ where: { id } }); // 作品侧 categoryId onDelete: SetNull
    await this.invalidateCategoryCache();
  }

  // —— 标签池（仅录入建议，删池不清洗作品 tags，spec §3.2） ——
  async listAllTags() {
    return this.prisma.videoTag.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }
  async createTag(dto: { name: string; sortOrder?: number; active?: boolean }) {
    return this.prisma.videoTag.create({ data: dto });
  }
  async updateTag(id: string, dto: { name?: string; sortOrder?: number; active?: boolean }) {
    return this.prisma.videoTag.update({ where: { id }, data: dto });
  }
  async deleteTag(id: string) {
    await this.prisma.videoTag.delete({ where: { id } });
  }

  private async invalidateCategoryCache() {
    await this.redis.del(VideoWorkService.CATEGORY_CACHE_KEY);
  }

  /** admin 成品视频预签（spec §4.2）。为何不复用 StorageService.presignUpload：那边 buildKey(dto.type, userId)
   *  与 Media.userId=登录用户——key 归属与 Media.userId 恒等于调用者，正是平台团队形态要去掉的（且走个人团队配额）。 */
  async presignVideo(dto: PresignVideoDto) {
    // 语义校验（中文文案必达前端——见 DTO 头注释）
    if (dto.fileType !== 'video/mp4') throw new BadRequestException('仅支持 MP4 格式（video/mp4）');
    const ONE_GB = 1024 * 1024 * 1024; // 上限不得超 ~2GiB：Media.size 是 Postgres Int（再高需迁 BigInt）
    if (dto.fileSize < 1) throw new BadRequestException('文件为空');
    if (dto.fileSize > ONE_GB) throw new BadRequestException('视频不得超过 1GB');

    await this.quota.assertCanUpload(PLATFORM_TEAM_ID, dto.fileSize); // 配额支点：platform-team，两道闸照跑

    const key = this.minio.buildKey('uploaded', 'system', { ext: 'mp4' }); // ext 硬编码：fileName.split 可能给出 MP4/txt
    const media = await this.prisma.media.create({ data: {
      userId: PLATFORM_OWNER_ID, teamId: PLATFORM_TEAM_ID, bucket: 'flowai', key,
      originalName: dto.fileName, mimeType: dto.fileType,
      size: dto.fileSize,                    // 必须落库——confirm 的 D1 大小事实源
      status: 'pending', type: 'uploaded',   // 禁 temp：expiresAt=+7d 会被 temp-cleanup 删掉已发布作品视频
      expiresAt: null,
    } });
    // contentType 形参是死参（createPresignedPost 未用、policy 有意不钉 $Content-Type）——服务端无真实 MIME 强校验，
    // 真实防线是前端 probeVideoFile 可播放性闸门。预签 fileSize 必须是请求体精确值（policy 钉 ±1024，传 1GB 常量会把正常上传打成 403）。
    const { url, fields } = await this.minio.generatePresignedPost(key, dto.fileType, dto.fileSize, 3600);
    return { fileId: media.id, uploadUrl: url, key, fields };
  }

  /** admin 画布回显。getDetail:205 保留内联轻量 boolean 查询是**有意取舍**（公开热路径不加 join）；
   *  CanvasProject 将来加软删/可见性条件时，getDetail:205 与本函数两处都要改。 */
  private async findCanvasRef(id: string) {
    return this.prisma.canvasProject.findUnique({
      where: { id },
      select: { id: true, name: true, updatedAt: true, user: { select: { name: true } }, team: { select: { owner: { select: { name: true } } } } },
    });
  }

  /** admin-only（AdminGuard /api/admin/ 前缀）+ 有意不做画布 owner 校验——admin 策展跨用户，非漏洞 */
  async canvasCheck(id: string) {
    const c = await this.findCanvasRef(id);
    if (!c) throw new NotFoundException('画布不存在');
    return { id: c.id, name: c.name, ownerName: c.user?.name ?? c.team.owner.name, updatedAt: c.updatedAt.toISOString() };
  }

  // presign + 短缓存纪律（TTL < URL TTL，media.service.ts:16-31 同款）——本任务即定义（Task 3.2 列表/3.3 详情/5.2 缩略图复用；
  // 第七轮前移：原定义在 Task 3.2 会造成本任务的前向引用 tsc 红）
  private async presignWork(key: string): Promise<string> {
    const cacheKey = `videoWork:url:${key}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;
    const url = await this.minio.generatePresignedGetUrl(key, 3600);
    await this.redis.set(cacheKey, url, 'EX', 3500);
    return url;
  }

  async createWork(dto: CreateVideoWorkDto) {
    this.assertProcessFlags(dto as any);
    // 画布校验（spec §4.5）：非空才查；为空允许创建（null 分支）
    if (dto.canvasProjectId && !(await this.findCanvasRef(dto.canvasProjectId)))
      throw new BadRequestException('画布不存在');
    // F2 videoKey 不变量（spec §4.5）——服务端不相信请求体（D1 同源教训）：
    // PK 查 mediaId（Media.key 无索引勿按 key 查）；teamId=platform-team 把"平台域"从约定升级为不变量
    // （普通用户上传素材同样满足 uploaded+completed，须排除）；key 交叉校验防"合法 key+别人的 mediaId"
    //（removeWork 的 Media 软删用的正是 videoMediaId，两字段不一致会软删无关行）。
    if (!dto.videoMediaId) throw new BadRequestException('视频文件不存在或未完成上传');
    const m = await this.prisma.media.findUnique({ where: { id: dto.videoMediaId } });
    if (!m || m.deletedAt || m.status !== 'completed' || m.type !== 'uploaded'
      || m.teamId !== PLATFORM_TEAM_ID || m.key !== dto.videoKey)
      throw new BadRequestException('视频文件不存在或未完成上传');
    const published = dto.status === 'PUBLISHED';
    return this.prisma.videoWork.create({ data: {
      ...dto,
      durationSec: dto.durationSec != null ? Math.round(dto.durationSec) : undefined,
      publishedAt: published ? new Date() : null,   // 请求体无此字段，服务端设
    } });
  }

  async updateWork(id: string, dto: UpdateVideoWorkDto) {
    const existing = await this.prisma.videoWork.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('作品不存在');
    const merged = {
      allowViewProcess: dto.allowViewProcess ?? existing.allowViewProcess,
      allowClone: dto.allowClone ?? existing.allowClone,
      canvasProjectId: dto.canvasProjectId !== undefined ? dto.canvasProjectId : existing.canvasProjectId,
      status: dto.status ?? existing.status,
    } as any;
    this.assertProcessFlags(merged);
    // 画布校验 dto-only（spec §4.5）：只校验 dto 显式提供的非空值。勿用 merged——源画布已被删的存量作品
    // 连改标题都 400，要先清画布+关两开关才存得出去（体验陷阱）；flags 的 merged 是另一语义，勿混。
    if (dto.canvasProjectId && !(await this.findCanvasRef(dto.canvasProjectId)))
      throw new BadRequestException('画布不存在');
    const data: any = { ...dto, durationSec: dto.durationSec != null ? Math.round(dto.durationSec) : undefined };
    // 发布语义：转 PUBLISHED 且原 publishedAt 为空 → 设 now；已有则不动
    if (merged.status === 'PUBLISHED' && !existing.publishedAt) data.publishedAt = new Date();
    const row = await this.prisma.videoWork.update({ where: { id }, data });
    // 换封面删旧（spec §4.6）：DB 更新成功后才删旧对象（新封面已 uploadCover 成功才进表单——顺序保证不丢封面）；
    // 排他防御性（UI 不产生共享 key，防 API 直调把 banner 对象当封面挂进来互删）
    if (dto.coverKey !== undefined && existing.coverKey && dto.coverKey !== existing.coverKey
      && existing.coverKey.startsWith('uploads/system/')) {
      try {
        const used = await this.prisma.videoWork.count({ where: { coverKey: existing.coverKey, NOT: { id } } });
        if (!used) await this.minio.delete(existing.coverKey);
      } catch (e) {
        console.error('[updateWork] 旧封面清理失败（登记后续清理）', { id, error: e });
      }
    }
    await this.invalidateWorkCaches(id);
    return row;
  }

  // 第七轮：本任务就地定义（Task 2.4 removeWork 也调用——前向引用 Task 5.3 会让批次 2 的 tsc 编译红、
  // 违反"每任务红-绿-提交"）。Task 5.3 仅把 key 收敛进 PROCESS_CACHE 常量，方法体不变。
  private async invalidateWorkCaches(id: string) {
    await this.redis.del(VideoWorkService.PROCESS_CACHE(id));
  }

  private assertProcessFlags(w: { allowViewProcess?: boolean; allowClone?: boolean; canvasProjectId?: string | null }) {
    if ((w.allowViewProcess || w.allowClone) && !w.canvasProjectId) {
      throw new BadRequestException('开启创作过程/克隆需要画布来源（canvasProjectId）');
    }
    // 第八轮裁定（spec §4.3）：克隆入口在创作过程视图顶栏——允许克隆必须允许看过程，防"可克隆不可看过程"死开关
    if (w.allowClone && !w.allowViewProcess) {
      throw new BadRequestException('允许克隆必须同时允许查看创作过程（allowClone 依赖 allowViewProcess）');
    }
  }

  async listAllWorks(page: number, pageSize: number) {
    const [rows, total] = await Promise.all([
      this.prisma.videoWork.findMany({ orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }], skip: (page-1)*pageSize, take: pageSize }),
      this.prisma.videoWork.count(),
    ]);
    // edit 信息条封面：裸 /flowai/+coverKey 不成立（桶非公开读，presign 查询串才是授权凭据）——列表顺手 presign（短缓存同 listPublished:184）
    const items = await Promise.all(rows.map(async r => ({ ...r, coverUrl: r.coverKey ? await this.presignWork(r.coverKey) : null })));
    return { items, total };
  }
  async getWorkById(id: string) { return this.prisma.videoWork.findUnique({ where: { id } }); }

  /** 公开列表（spec §4.2：item 只含 5 字段，无 videoUrl） */
  async listPublished(categoryId: string | undefined, page: number, pageSize: number) {
    const where: any = { status: 'PUBLISHED' };
    if (categoryId) where.categoryId = categoryId; // plain filter
    const [rows, total] = await Promise.all([
      this.prisma.videoWork.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { publishedAt: 'desc' }, { id: 'asc' }], // id tiebreaker
        select: { id: true, title: true, coverKey: true, durationSec: true, tags: true },
        skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.videoWork.count({ where }),
    ]);
    const items = await Promise.all(rows.map(async r => ({
      id: r.id, title: r.title, durationSec: r.durationSec, tags: r.tags,
      coverUrl: r.coverKey ? await this.presignWork(r.coverKey) : null,
    })));
    return { items, total, page, pageSize };
  }

  /** 公开类型列表（active + 30-60s 缓存；admin 改动时 Task 2.1 已删缓存） */
  async listCategoriesPublic() {
    const cached = await this.redis.get(VideoWorkService.CATEGORY_CACHE_KEY);
    if (cached) return JSON.parse(cached);
    const rows = await this.prisma.videoCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, sortOrder: true },
    });
    await this.redis.set(VideoWorkService.CATEGORY_CACHE_KEY, JSON.stringify(rows), 'EX', 60);
    return rows;
  }

  async getDetail(id: string, userId: string | null) {
    const w = await this.prisma.videoWork.findUnique({ where: { id } });
    if (!w || w.status !== 'PUBLISHED') throw new NotFoundException();
    const canvasExists = w.canvasProjectId
      ? !!(await this.prisma.canvasProject.findUnique({ where: { id: w.canvasProjectId }, select: { id: true } }))
      : false;
    const [videoUrl, coverUrl] = await Promise.all([
      this.presignWork(w.videoKey),
      w.coverKey ? this.presignWork(w.coverKey) : Promise.resolve(null),
    ]);
    const liked = userId ? await this.redis.get(VideoWorkService.likeKey(id, userId)).then(v => v === '1') : false; // 匿名短路，同 key（§4.2 约束）
    return {
      id: w.id, title: w.title, description: w.description, authorName: w.authorName,
      categoryId: w.categoryId, videoUrl, coverUrl,
      viewCount: w.viewCount, likeCount: w.likeCount, liked, tags: w.tags,
      publishedAt: w.publishedAt?.toISOString() ?? null,
      durationSec: w.durationSec, width: w.width, height: w.height,
      canViewProcess: w.allowViewProcess && canvasExists,  // 详情禁 readCanvas（§4.2）
      canClone: w.allowClone && canvasExists,               // 原始开关值 + 画布存在
    };
  }

  /** 红线改写（spec §4.6）：旧"只删 DB 行禁 minio.delete"的前提是候选池模型（videoKey 与源 Media 共享对象）；
   *  新模型 videoKey 是平台自有上传对象（uploads/system/ 域，F2 的 platform-team 不变量支撑）。
   *  域判断仅视频侧可靠——封面侧 system 域是封面/banner 三子系统共用（banner 无台账），排他只能靠 coverKey 字符串比对。
   *  缓存失效是卫生动作（已签 URL 在 TTL 内仍可播——真正阻止播放的是对象删除）。 */
  async removeWork(id: string) {
    const w = await this.prisma.videoWork.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('作品不存在'); // 先查后删——裸 delete 抛 P2025 变 500

    try {
      if (w.videoKey.startsWith('uploads/system/')) {
        // 排他以 videoMediaId 为主（同一 Media 行 key 唯一，裸 key 可跨域重复）；防御性——UI 不产生共享，防存量脏数据/API 直调
        const shared = await this.prisma.videoWork.count({ where: { videoMediaId: w.videoMediaId, NOT: { id: w.id } } });
        if (!shared) await this.minio.delete(w.videoKey);
      }
      if (w.coverKey?.startsWith('uploads/system/')) {
        const coverUsed = await this.prisma.videoWork.count({ where: { coverKey: w.coverKey, NOT: { id: w.id } } });
        if (!coverUsed) await this.minio.delete(w.coverKey);
      }
    } catch (e) {
      // 尽力而为不阻断：MinIO 抖动仅记日志，作品删除照常成功（失败对象登记后续清理任务）
      console.error('[removeWork] 对象清理失败（登记后续清理）', { id, error: e });
    }

    // Media 软删释放平台配额（getUsage 条件 status='completed' AND deletedAt=null）；失败不阻断
    // （显式 try/catch 而非 .catch() 链——与"尽力而为"自洽，且不依赖调用方返回 thenable）
    if (w.videoMediaId) {
      try { await this.prisma.media.update({ where: { id: w.videoMediaId }, data: { deletedAt: new Date() } }); }
      catch (e) { console.error('[removeWork] Media 软删失败（配额未释放，登记清理）', { id, error: e }); }
    }

    await this.prisma.videoWork.delete({ where: { id } });
    try { await this.redis.del(`videoWork:url:${w.videoKey}`); } catch { /* 卫生动作失败可忍 */ }
    await this.invalidateWorkCaches(id);
  }

  /** 产物缩略图注入（spec §4.6）：收集 fileId → 批量查 thumbnailKey → presign 注入 → 下游白名单剥 fileId */
  async injectThumbnails(raw: RawCanvasData): Promise<RawCanvasData> {
    const fileIds = [...new Set(raw.nodes.map(n => (n.data as any)?.fileId).filter((f): f is string => !!f))];
    if (fileIds.length === 0) return raw;
    const medias = await this.prisma.media.findMany({ where: { id: { in: fileIds } }, select: { id: true, thumbnailKey: true } });
    const urlById = new Map<string, string>();
    await Promise.all(medias.filter(m => m.thumbnailKey).map(async m => {
      urlById.set(m.id, await this.presignWork(m.thumbnailKey!)); // presign 3600s + 短缓存复用
    }));
    for (const n of raw.nodes) {
      const fid = (n.data as any)?.fileId;
      if (typeof fid === 'string' && urlById.has(fid)) (n.data as any).thumbnailUrl = urlById.get(fid)!;
    }
    return raw;
  }

  async getProcessSnapshot(id: string) {
    const w = await this.prisma.videoWork.findUnique({ where: { id } });
    if (!w || w.status !== 'PUBLISHED' || !w.allowViewProcess || !w.canvasProjectId) throw new NotFoundException();
    const canvas = await this.prisma.canvasProject.findUnique({ where: { id: w.canvasProjectId }, select: { id: true } });
    if (!canvas) throw new NotFoundException(); // gateway 空 doc 坑前置校验（§4.6）

    const cacheKey = VideoWorkService.PROCESS_CACHE(id);
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const raw = await this.withTimeout(this.collabDoc.readCanvas(w.canvasProjectId), 5000) as RawCanvasData;
    const withThumbs = await this.injectThumbnails(raw);
    const filtered = buildFilteredSnapshot(withThumbs, {
      dropTypes: [], dropIdPrefixes: ['shadow-'],   // 快照不剥 videoEdit（spec:228 保留节点/data 全剥；剥除仅克隆差异 D9）——第八轮裁定
      resetStatusIdle: false, injectThumbnails: true,
    });
    const result = { workId: id, title: w.title, ...filtered };
    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 300); // TTL 300s（§4.6）
    return result;
  }

  /** 有界等待（readCanvas 无读取超时——内部只有 SV 等待 3s；Promise.race 外套）。finally 清 timer——
   *  否则每次调用悬挂一个 5s 定时器，拖慢测试收尾/进程退出（第八轮） */
  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let t: ReturnType<typeof setTimeout>;
    return Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new ServiceUnavailableException('画布读取超时')), ms); })])
      .finally(() => clearTimeout(t));
  }

  async recordView(id: string, ip: string) {
    const w = await this.prisma.videoWork.findUnique({ where: { id }, select: { status: true } });
    if (!w || w.status !== 'PUBLISHED') throw new NotFoundException();
    const allowed = await this.rateLimiter.checkIpRateLimit(ip, 'video-work:view', 60, 30);
    if (!allowed) throw new ThrottlerException();
    // SET NX 原子去重（1h）——key 存哈希不存明文 IP（spec §4.5 写的就是 ipHash：Redis 内长期驻留客户端明文 IP 是刻意规避的 PII 留存，第七轮对齐）
    const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 16);
    const ok = await this.redis.set(`videoWork:view:${id}:${ipHash}`, '1', 'EX', 3600, 'NX');
    if (ok !== 'OK') return { counted: false };
    await this.prisma.videoWork.update({ where: { id }, data: { viewCount: { increment: 1 } } });
    return { counted: true };
  }

  async toggleLike(id: string, userId: string): Promise<{ liked: boolean; likeCount: number }> {
    const allowed = await this.rateLimiter.checkUserRateLimit(userId, 'video-work:like', 60, 30); // spec §7.5 限流（第八轮补）
    if (!allowed) throw new ThrottlerException();
    const w = await this.prisma.videoWork.findUnique({ where: { id }, select: { status: true } });
    if (!w || w.status !== 'PUBLISHED') throw new NotFoundException();
    const key = VideoWorkService.likeKey(id, userId);
    const nx = await this.redis.set(key, '1', 'EX', 7776000, 'NX'); // 90 天（§4.5）
    let delta: number;
    if (nx === 'OK') delta = 1;
    else { await this.redis.del(key); delta = -1; } // NX 原子判断，勿 GET-再-SET（并发双击 +2）
    await this.prisma.$executeRaw`UPDATE "VideoWork" SET "likeCount" = GREATEST("likeCount" + ${delta}, 0) WHERE id = ${id}`;
    const row = await this.prisma.videoWork.findUnique({ where: { id }, select: { likeCount: true } });
    return { liked: delta === 1, likeCount: row?.likeCount ?? 0 };
  }

  async uploadCover(buffer: Buffer, mimetype: string): Promise<{ key: string }> {
    // magic-number（WebP 查 12 字节：RIFF(0-3) + 偏移 8-11 WEBP——banner 同款 admin-home-banner.controller.ts:54-57）
    const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isJpg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isWebp = buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    const ext = isPng ? 'png' : isJpg ? 'jpg' : isWebp ? 'webp' : null;
    if (!ext) throw new BadRequestException('仅支持 png/jpg/webp');
    const key = this.minio.buildKey('uploaded', 'system', { ext }); // uploads/system/{date}/{uuid}.{ext}——勿手拼 key 勿用 uuid 包（C1-4）
    await this.minio.upload(key, buffer, mimetype); // upload(key, buffer, contentType) 三参（minio.service.ts:105）
    return { key };
  }

  async getSettings(): Promise<{ carouselEnabled: boolean; carouselScope: 'all' | 'category' }> {
    const row = await this.prisma.videoWorkSetting.findUnique({ where: { id: 'singleton' } });
    return { carouselEnabled: row?.carouselEnabled ?? true, carouselScope: (row?.carouselScope as 'all' | 'category') ?? 'all' };
  }
  async updateSettings(dto: { carouselEnabled: boolean; carouselScope: 'all' | 'category' }) {
    if (dto.carouselScope !== 'all' && dto.carouselScope !== 'category') throw new BadRequestException('carouselScope 仅 all|category');
    await this.prisma.videoWorkSetting.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', carouselEnabled: dto.carouselEnabled, carouselScope: dto.carouselScope },
      update: { carouselEnabled: dto.carouselEnabled, carouselScope: dto.carouselScope },
    });
    return this.getSettings();
  }
}
