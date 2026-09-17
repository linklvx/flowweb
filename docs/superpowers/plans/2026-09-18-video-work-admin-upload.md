# 管理后台成品视频上传改造 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理后台"新增作品"改为上传本地成品视频（预签直传 MinIO + 平台团队配额），关联可选源画布（粘贴 ID/URL），删除候选池；同时收口 storage confirm 的任意对象删除漏洞（D1）。

**Architecture:** 后端三块——①storage confirm 服务层以 Media 行为唯一事实源（D1）；②新端点 presign-video（平台团队 1TB 配额支点）+ canvas-check（画布存在性回显）；③createWork videoKey 五条件不变量（F2）+ removeWork 按域分治清理。前端——probeVideoFile/uploadToPresignedPost 两个独立模块 + WorkFormModal 编排（上传流水线、画布状态机、封面提交时上传、edit 只读信息条）。seed 平台团队五行（B 形态）。

**Tech Stack:** NestJS + Prisma + MinIO presigned POST + Redis；React + antd ProComponents + 裸 axios（直传）+ vitest/jsdom。

**Spec:** `docs/superpowers/specs/2026-09-18-video-work-admin-upload-design.md`（v2.4，六轮审核收敛——所有"为什么"都在 spec，本 plan 只写"怎么做"）

**测试命令约定**（Bash CWD 会漂移，每条命令显式 cd）：
- api 单测：`cd D:/flowweb/apps/api && npx vitest run <spec 路径>`
- web 单测：`cd D:/flowweb/apps/web && npx vitest run <test 路径>`
- 全量（提交前）：`cd D:/flowweb/apps/api && npm test` / `cd D:/flowweb/apps/web && npm test`

---

## Task 1: D1——storage confirm 服务层收口（安全修复，先行）

**Files:**
- Modify: `apps/api/src/modules/team/storage-quota.service.ts:35-49`（assertOnConfirm 删 key/bucket 形参）
- Modify: `apps/api/src/modules/storage/storage.service.ts:69-101`（confirmUpload 一律读 media 行）
- Modify: `apps/api/src/modules/storage/dto/confirm.dto.ts`（@deprecated 注释）
- Modify: `apps/api/src/modules/video-project/generated-media.service.ts:75`（**第二调用方**——签名收窄必须同批，否则 TS2554 全仓 api 测试编译红）
- Test: `apps/api/src/modules/team/storage-quota.service.spec.ts:53-70`
- Test: `apps/api/src/modules/storage/storage.service.spec.ts:123-169`
- Test: `apps/api/src/modules/video-project/generated-media.service.spec.ts:77`（四参断言 → 两参）

> 注意：spec §4.3 说"与 generated-media 的 confirm 无关勿动"指的是**那个端点**（generated-media/confirm 路由），不是这里被共享的 `assertOnConfirm` 方法——签名一变，它的调用点必须跟着改。

- [ ] **Step 1: 写失败测试（storage-quota.service.spec.ts）**

改 :53-70 两条用例（签名两参 + delete 收 media.key）并新增 fixture key：

```ts
  it('③ confirm 二次校验（Q7）：超限删对象+删记录+抛错（事务断言顺序）', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', teamId: 't1', key: 'uploads/u1/a.png' }); // fixture 必须含 key——删的是行内 key（D1）
    const order: string[] = [];
    minio.delete.mockImplementation(async () => { order.push('minio'); });
    prisma.media.delete.mockImplementation(async () => { order.push('media'); });

    await expect(service.assertOnConfirm('m1', 550)).rejects.toThrow('存储空间不足'); // D1：删 key/bucket 形参，两参

    expect(minio.delete).toHaveBeenCalledWith('uploads/u1/a.png'); // 行内 key，非请求体
    expect(prisma.media.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    expect(order).toEqual(['minio', 'media']);
  });

  it('③ confirm：未超限不动', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', teamId: 't1', key: 'uploads/u1/a.png' });
    await expect(service.assertOnConfirm('m1', 400)).resolves.toBeUndefined();
    expect(minio.delete).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: 跑测试确认红**

`cd D:/flowweb/apps/api && npx vitest run src/modules/team/storage-quota.service.spec.ts`
Expected: FAIL——TS 编译错（实参 2 个 vs 形参 4 个）或运行时 delete 收到 undefined

- [ ] **Step 3: 改 assertOnConfirm（两参，行内 key）**

```ts
  /** confirm 二次校验（Q7：两并发 presign 可同过，confirm 按 actualSize 终判）；
   * 超限：删 MinIO 对象 + 删 pending Media + 抛错。
   * D1：key 形参已删（bucket 本就是死参）——删的是行内 media.key。原 key 形参吃请求体，
   * 构成任意对象删除面（自 presign 造 pending 行 + 传受害者 key 即可删任意已发布作品对象）。 */
  async assertOnConfirm(mediaId: string, actualSize: number): Promise<void> {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media?.teamId) return;
    const { storageLimitBytes } = await this.subscription.getLimits(media.teamId);
    const usage = await this.getUsage(media.teamId);
    if (usage + actualSize > storageLimitBytes) {
      try {
        await this.minio.delete(media.key);
      } catch {
        // 对象不存在——继续删记录
      }
      await this.prisma.media.delete({ where: { id: mediaId } });
      throw new BadRequestException('存储空间不足，上传已取消');
    }
  }
```

- [ ] **Step 4: 写失败测试（storage.service.spec.ts——victim key 安全回归 + fixture 对齐）**

改/增 :123-169 区域：

```ts
  it('should confirm upload and update status to completed', async () => {
    prisma.media.findFirst = vi.fn().mockResolvedValue({ id: 'media-1', userId: 'user1', teamId: 'team1', status: 'pending', key: 'uploads/u1/test.png', size: 2048000 }); // fixture 补 size 且与请求体 fileSize 差 ≤1024
    const result = await service.confirmUpload('user1', {
      fileId: 'media-1',
      key: 'uploads/u1/test.png',
      fileSize: 2048000,
    });
    expect(result.fileId).toBe('media-1');
    expect(prisma.media.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'media-1' },
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  it('D1 victim key：请求体传任意 key 也不生效——statSize/delete 收到的都是 media.key', async () => {
    prisma.media.findFirst = vi.fn().mockResolvedValue({ id: 'media-1', userId: 'user1', teamId: 'team1', status: 'pending', key: 'uploads/system/real.mp4', size: 2048000 });
    minio.statSize.mockResolvedValue(2048000);
    await service.confirmUpload('user1', { fileId: 'media-1', key: 'victim/obj', fileSize: 1 }); // 攻击载荷：受害者 key + 伪造大小
    expect(minio.statSize).toHaveBeenCalledWith('uploads/system/real.mp4'); // 用行内 key 探测
    expect(prisma.media.update).toHaveBeenCalled();                          // 正常完成，victim 无感
  });

  it('confirmUpload 团队成员可确认他人上传', async () => {
    prisma.media.findFirst.mockResolvedValue({ id: 'm1', userId: 'other', teamId: 't-team', key: 'k', size: 100 }); // fixture 补 key+size
    prisma.teamMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
    minio.statSize.mockResolvedValue(100);
    await service.confirmUpload('u1', { fileId: 'm1', key: 'k', fileSize: 100 });
    expect(prisma.teamMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teamId: 't-team', userId: 'u1' }) }),
    );
    expect(prisma.media.update).toHaveBeenCalled();
  });

  it('confirmUpload 非成员 → 403/400 拒绝', async () => {
    prisma.media.findFirst.mockResolvedValue({ id: 'm1', userId: 'other', teamId: 't-team', key: 'k' }); // 授权在 statSize 之前，无需 size
    prisma.teamMember.findFirst.mockResolvedValue(null);
    minio.statSize.mockResolvedValue(100);
    await expect(service.confirmUpload('u1', { fileId: 'm1', key: 'k', fileSize: 100 })).rejects.toThrow(ForbiddenException);
    expect(prisma.media.update).not.toHaveBeenCalled();
  });

  it('should reject confirm if fileSize mismatch（D1 后判据 = actualSize vs media.size；请求体 key 与 fixture 不同——防"实现回退 dto.key 也绿"的真空断言）', async () => {
    prisma.media.findFirst = vi.fn().mockResolvedValue({ id: 'media-1', userId: 'user1', teamId: 'team1', status: 'pending', key: 'uploads/u1/test.png', size: 2048000 });
    minio.statSize = vi.fn().mockResolvedValue(999); // 真实对象 999 ≠ 行内 size 2048000
    await expect(
      service.confirmUpload('user1', { fileId: 'media-1', key: 'victim/obj', fileSize: 999 }), // 请求体 key 故意不同
    ).rejects.toThrow(); // 请求体 fileSize=999（旧实现会放行——新实现不读它，仍按行内 size 拒）
    expect(minio.delete).toHaveBeenCalledWith('uploads/u1/test.png'); // 清理也用行内 key（非 victim——攻击 A 独立钉子）
    expect(minio.delete).not.toHaveBeenCalledWith('victim/obj');
  });
```

- [ ] **Step 5: 跑测试确认红**

`cd D:/flowweb/apps/api && npx vitest run src/modules/storage/storage.service.spec.ts`
Expected: FAIL——victim 用例 statSize 收到 'victim/obj'（现实现读 dto.key）

- [ ] **Step 6: 改 confirmUpload（media 行为唯一事实源）**

```ts
  async confirmUpload(userId: string, dto: ConfirmUploadDto) {
    const media = await this.prisma.media.findFirst({
      where: { id: dto.fileId },
    });
    if (!media) {
      throw new BadRequestException('文件记录不存在');
    }
    if (media.userId !== userId) {
      await assertTeamMember(this.prisma, media.teamId, userId);
    }

    // D1 服务层收口：一律以 media 行为唯一事实源。dto.key/dto.fileSize 已不读——
    // 请求体 key 曾流入 statSize/minio.delete（mismatch 分支）与 assertOnConfirm（配额分支），
    // 构成任意对象删除面。禁止回退 `media.size ?? dto.fileSize`（会让本性质静默失效）。
    const actualSize = await this.minio.statSize(media.key);

    if (Math.abs(actualSize - media.size) > 1024) {
      await this.minio.delete(media.key);
      await this.prisma.media.delete({ where: { id: dto.fileId } });
      throw new BadRequestException('文件大小不匹配，请重新上传');
    }

    await this.quota.assertOnConfirm(dto.fileId, actualSize);

    await this.prisma.media.update({
      where: { id: dto.fileId },
      data: { status: 'completed', size: actualSize },
    });

    return { fileId: dto.fileId };
  }
```

- [ ] **Step 6.5: 第二调用方同批改（generated-media）**

`apps/api/src/modules/video-project/generated-media.service.ts:75`：

```ts
      await this.quota.assertOnConfirm(media.id, actualSize); // D1：key/bucket 已由服务内部读行——这里传的本来就是行内值（:70 已 findUnique 取 media），
                                                              // 收口后语义完全等价、零行为变化——是签名收窄的机械连带，非顺手改
```

（原 `assertOnConfirm(media.id, actualSize, media.key, media.bucket)`。）

`generated-media.service.spec.ts:77`：

```ts
    expect(quota.assertOnConfirm).toHaveBeenCalledWith('m1', 12_345_678);
```

- [ ] **Step 7: ConfirmUploadDto 加 @deprecated 注释（字段保留，前端 12 处调用点零改动）**

```ts
export class ConfirmUploadDto {
  fileId!: string;
  /** @deprecated 服务端已改用 media.key/media.size（D1），此字段保留兼容、不被读取 */
  key!: string;
  /** @deprecated 同上 */
  fileSize!: number;
}
```

- [ ] **Step 8: 全绿 + 全量回归 + 提交**

`cd D:/flowweb/apps/api && npm test`
Expected: PASS——波及面：storage 两个 spec + **generated-media.service.spec.ts（:77 四参断言已同批改两参，不改则 tsc/断言双红）**

```bash
cd D:/flowweb && git add apps/api/src/modules/team/storage-quota.service.ts apps/api/src/modules/team/storage-quota.service.spec.ts apps/api/src/modules/storage/storage.service.ts apps/api/src/modules/storage/storage.service.spec.ts apps/api/src/modules/storage/dto/confirm.dto.ts apps/api/src/modules/video-project/generated-media.service.ts apps/api/src/modules/video-project/generated-media.service.spec.ts
git commit -m "fix(storage): confirm 服务层收口 D1——Media 行为唯一事实源（statSize/delete/配额一律行内 key/size），关死 mismatch+配额两条任意对象删除链；assertOnConfirm 删 key/bucket 死参（含 generated-media 调用点同批）"
```

---

## Task 2: 平台 id 常量 + presign-video 端点

**Files:**
- Modify: `apps/api/src/modules/team/team.util.ts`（文件尾追加两个常量）
- Create: `apps/api/src/modules/video-work/dto/presign-video.dto.ts`
- Modify: `apps/api/src/modules/video-work/video-work.service.ts`（构造注入 StorageQuotaService + presignVideo 方法）
- Modify: `apps/api/src/modules/video-work/video-work.module.ts:13`（imports 加 TeamModule）
- Modify: `apps/api/src/modules/video-work/admin-video-work.controller.ts`（静态段加 @Post('presign-video')）
- Test: `apps/api/src/modules/video-work/video-work.service.spec.ts`（文件级 providers 加 quota mock + 新 describe）
- Test: `apps/api/src/modules/video-work/admin-video-work.controller.spec.ts`（staticRoutes += presignVideo + 转发用例）

- [ ] **Step 1: team.util.ts 追加常量（文件尾）**

```ts
/** 平台资产归属（spec 2026-09-18-video-work-admin-upload §4.1）——api 侧共用（presignVideo/createWork F2/api spec）。
 *  seed 侧是独立字面量（seed.ts 不在 tsc 范围，不 import src——跨 rootDir 别扭）：
 *  **改 id 时必须连同 seed.ts（两个 id 共 6 次字面量）与 seed spec（2 次）全部同步**——
 *  F2 漏改 = 每次建作品 400"视频文件不存在"且无编译期提示（本设计唯一"改一处坏远处不报错"耦合）。 */
export const PLATFORM_TEAM_ID = 'platform-team';
export const PLATFORM_OWNER_ID = 'platform-owner';
```

- [ ] **Step 2: 写失败测试（video-work.service.spec.ts）**

文件级 beforeEach 的 providers 数组追加（构造注入新增依赖，不加则整文件 compile 红）：

```ts
import { StorageQuotaService } from '../team/storage-quota.service'; // 文件头 import 区追加
// providers 数组（:50-53 区域）追加：
        { provide: StorageQuotaService, useValue: { assertCanUpload: vi.fn().mockResolvedValue(undefined), assertMember: vi.fn(), getUsage: vi.fn().mockResolvedValue(0), assertOnConfirm: vi.fn().mockResolvedValue(undefined) } },
```

文件尾追加新 describe：

```ts
describe('presignVideo（admin 成品视频预签）', () => {
  const base = { fileName: 'final.mp4', fileSize: 1000, fileType: 'video/mp4' };

  it('语义校验在 service 抛中文（装饰器 message 是数组→前端只见 Bad Request Exception，中文到不了响应体）', async () => {
    await expect(service.presignVideo({ ...base, fileType: 'video/quicktime' } as any)).rejects.toThrow('仅支持 MP4 格式（video/mp4）');
    await expect(service.presignVideo({ ...base, fileSize: 0 } as any)).rejects.toThrow('文件为空');
    await expect(service.presignVideo({ ...base, fileSize: 1024 * 1024 * 1024 + 1 } as any)).rejects.toThrow('视频不得超过 1GB');
  });

  it('配额支点：quota.assertCanUpload 用 platform-team（勿改成管理员个人团队）', async () => {
    minio.buildKey = vi.fn().mockReturnValue('uploads/system/2026-09-18/a.mp4');
    prisma.media.create = vi.fn().mockResolvedValue({ id: 'm-vid' });
    minio.generatePresignedPost = vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:9000/flowai', fields: { key: 'uploads/system/2026-09-18/a.mp4' } });
    await service.presignVideo({ ...base, fileName: 'x.TXT' } as any); // fileName 扩展名脏值也要过——ext 恒 mp4
    expect((service as any).quota.assertCanUpload).toHaveBeenCalledWith('platform-team', 1000);
    expect(minio.buildKey).toHaveBeenCalledWith('uploaded', 'system', { ext: 'mp4' });
    expect(prisma.media.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      userId: 'platform-owner', teamId: 'platform-team', type: 'uploaded', status: 'pending',
      size: 1000, mimeType: 'video/mp4', originalName: 'x.TXT', expiresAt: null, // size 落库=confirm 大小事实源；禁 temp（7d 清理 footgun）
    }) }));
    expect(minio.generatePresignedPost).toHaveBeenCalledWith('uploads/system/2026-09-18/a.mp4', 'video/mp4', 1000, 3600); // expiresIn 3600（默认 900 慢网 1GB 会中途过期）
  });
});
```

- [ ] **Step 3: 跑测试确认红**

`cd D:/flowweb/apps/api && npx vitest run src/modules/video-work/video-work.service.spec.ts`
Expected: FAIL——`service.presignVideo is not a function`

- [ ] **Step 4: 实现——DTO + service 方法 + module imports + controller**

`apps/api/src/modules/video-work/dto/presign-video.dto.ts`（新建）：

```ts
import { IsString, IsInt } from 'class-validator';
// 只做结构约束（通过类级 whitelist/forbidNonWhitelisted）——语义校验（mp4/大小）在 service 抛中文字符串：
// 装饰器 message 是数组，经 HttpException.initMessage 的 constructor.name 兜底后前端只见 "Bad Request Exception"
// （phone-login.dto.ts:5 的中文装饰器消息同款到不了响应体）。裸 TS 类 DTO 在本 controller 恒 400（无 pipe 的 storage 才允许）。
export class PresignVideoDto {
  @IsString() fileName!: string;
  @IsString() fileType!: string;
  @IsInt() fileSize!: number;
}
```

`video-work.service.ts`——文件头 import 区追加：

```ts
import { PresignVideoDto } from './dto/presign-video.dto';
import { StorageQuotaService } from '../team/storage-quota.service';
import { PLATFORM_TEAM_ID, PLATFORM_OWNER_ID } from '../team/team.util';
```

构造函数追加一个参数（最后一个）：

```ts
    @Inject(StorageQuotaService) private readonly quota: StorageQuotaService, // presignVideo 平台配额闸（Task 2）
```

`listCandidates` 方法**之前**插入新方法：

```ts
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
```

`video-work.module.ts`——imports 加 `TeamModule`（TeamModule exports StorageQuotaService；无循环依赖——TeamModule 不 import VideoWorkModule）：

```ts
import { TeamModule } from '../team/team.module';
// ...
  imports: [ProjectModule, CollabModule, TeamModule],
```

`admin-video-work.controller.ts`——静态段（`@Get('settings')` 之前或之后、**必须在整个 `:id` 段之前**）追加，注意**必须是类方法不能是类字段箭头函数**（路由序守卫用 `Object.getOwnPropertyNames(prototype)`，箭头函数字段不在 prototype 上恒红）：

```ts
  @Post('presign-video')
  presignVideo(@Body() dto: PresignVideoDto) { return this.service.presignVideo(dto); } // Task 2：静态段声明（:id 之前）
```

文件头 import 追加 `PresignVideoDto`。

- [ ] **Step 5: controller.spec——staticRoutes += presignVideo + 转发用例**

`admin-video-work.controller.spec.ts`：

:75 数组追加（本任务保留 listCandidates，Task 3 再换）：

```ts
    const staticRoutes = ['listCategories', 'listTags', 'listCandidates', 'uploadCover', 'getSettings', 'presignVideo']; // Task 2 += 'presignVideo'（POST 纳入属防御性完整性——:id 是 GET 吃不掉它，防将来改 @Get）
```

文件尾追加转发用例（service mock 按本文件既有约定"用例内现补"）：

```ts
  it('presign-video 转发 DTO 给 service', async () => {
    service.presignVideo = vi.fn().mockResolvedValue({ fileId: 'm1', uploadUrl: 'http://x', key: 'k', fields: {} });
    const res = await controller.presignVideo({ fileName: 'a.mp4', fileSize: 1, fileType: 'video/mp4' });
    expect(service.presignVideo).toHaveBeenCalledWith({ fileName: 'a.mp4', fileSize: 1, fileType: 'video/mp4' });
    expect(res.fileId).toBe('m1');
  });
```

- [ ] **Step 6: 全绿 + 提交**

`cd D:/flowweb/apps/api && npm test`
Expected: PASS

```bash
cd D:/flowweb && git add apps/api/src/modules/team/team.util.ts apps/api/src/modules/video-work/dto/presign-video.dto.ts apps/api/src/modules/video-work/video-work.service.ts apps/api/src/modules/video-work/video-work.service.spec.ts apps/api/src/modules/video-work/video-work.module.ts apps/api/src/modules/video-work/admin-video-work.controller.ts apps/api/src/modules/video-work/admin-video-work.controller.spec.ts
git commit -m "feat(video-work): admin presign-video 端点——平台团队配额支点+语义校验中文下沉 service+system 域 mp4+expiresIn 3600"
```

---

## Task 3: canvas-check + findCanvasRef + 删候选池 + listAllWorks 封面 presign

**Files:**
- Modify: `apps/api/src/modules/video-work/video-work.service.ts`（删 listCandidates + 加 findCanvasRef/canvasCheck + listAllWorks presign）
- Modify: `apps/api/src/modules/video-work/admin-video-work.controller.ts`（删 @Get('candidates') + 加 @Get('canvas-check')）
- Modify: `apps/api/src/modules/team/../video-work/…` 无；`packages/shared/src/types/video-work.ts`（删 CandidateMedia）
- Test: `apps/api/src/modules/video-work/video-work.service.spec.ts`（删 :59-88 describe + 新 describe）
- Test: `apps/api/src/modules/video-work/admin-video-work.controller.spec.ts`（数组换名 + 标题 + 转发用例）

- [ ] **Step 1: 写失败测试（service spec——canvasCheck 三例 + listAllWorks 封面）**

删除整个 `describe('VideoWorkService.listCandidates')` 块（:59-88，含 4 条用例——listCandidates 删除后它们必红）。文件尾追加：

```ts
describe('canvasCheck（admin 画布存在性回显）', () => {
  it('存在 + 个人画布 → ownerName=user.name', async () => {
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue({ id: 'p1', name: '我的画布', updatedAt: new Date('2026-09-01'), user: { name: '张三' }, team: { owner: { name: '张三' } } });
    const res = await service.canvasCheck('p1');
    expect(res).toMatchObject({ id: 'p1', name: '我的画布', ownerName: '张三' });
    expect(res.updatedAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('团队画布（userId=null）→ ownerName 回落 team.owner.name（不得出现 null）', async () => {
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue({ id: 'p2', name: '团队画布', updatedAt: new Date('2026-09-01'), user: null, team: { owner: { name: '老板' } } });
    const res = await service.canvasCheck('p2');
    expect(res.ownerName).toBe('老板');
  });

  it('不存在 → 404 画布不存在', async () => {
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue(null);
    await expect(service.canvasCheck('p-404')).rejects.toThrow(NotFoundException);
  });
});

describe('listAllWorks（edit 信息条封面支撑）', () => {
  it('coverKey 非空 → presign coverUrl（裸 /flowai/ key 在生产 403——桶非公开读）', async () => {
    prisma.videoWork.findMany = vi.fn().mockResolvedValue([{ id: 'w1', coverKey: 'uploads/system/c.jpg' }]);
    prisma.videoWork.count = vi.fn().mockResolvedValue(1);
    const res = await service.listAllWorks(1, 20);
    expect(res.items[0].coverUrl).toBe('http://minio/presigned'); // minio.generatePresignedGetUrl 文件级 mock 固定值
  });
  it('coverKey 空 → coverUrl null', async () => {
    prisma.videoWork.findMany = vi.fn().mockResolvedValue([{ id: 'w2', coverKey: null }]);
    prisma.videoWork.count = vi.fn().mockResolvedValue(1);
    const res = await service.listAllWorks(1, 20);
    expect(res.items[0].coverUrl).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认红**

`cd D:/flowweb/apps/api && npx vitest run src/modules/video-work/video-work.service.spec.ts`
Expected: FAIL——`service.canvasCheck is not a function`（同时 listCandidates describe 已删）

- [ ] **Step 3: 实现 service——删 listCandidates、加 findCanvasRef/canvasCheck、listAllWorks presign**

删除 `listCandidates` 整个方法（:72-103）及文件头 `import type { CandidateMedia } from '@flowweb/shared';`（孤立导入）。

在 `presignVideo` 方法之后追加：

```ts
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
```

`listAllWorks` 改为（edit 只读信息条缩略图的唯一后端支撑）：

```ts
  async listAllWorks(page: number, pageSize: number) {
    const [rows, total] = await Promise.all([
      this.prisma.videoWork.findMany({ orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }], skip: (page-1)*pageSize, take: pageSize }),
      this.prisma.videoWork.count(),
    ]);
    // edit 信息条封面：裸 /flowai/+coverKey 不成立（桶非公开读，presign 查询串才是授权凭据）——列表顺手 presign（短缓存同 listPublished:184）
    const items = await Promise.all(rows.map(async r => ({ ...r, coverUrl: r.coverKey ? await this.presignWork(r.coverKey) : null })));
    return { items, total };
  }
```

`packages/shared/src/types/video-work.ts`——删除 `CandidateMedia` 接口整块（index.ts 是 `export *`，无需改动；全仓仅 video-work.service.ts 使用，Task 3 已删引用）。

- [ ] **Step 4: controller——删 candidates 路由、加 canvas-check；spec 数组换名**

`admin-video-work.controller.ts`：删除 `@Get('candidates') listCandidates(...)` 两行（:29-32）。静态段追加（类方法）：

```ts
  @Get('canvas-check')
  canvasCheck(@Query('id') id: string) { return this.service.canvasCheck(id); } // @Query 原始类型保持——类 DTO 反而任何多余 query 参数 400（whitelist 对原始类型不生效）
```

controller.spec：

```ts
  // 标题同步（原"categories/tags/candidates"已过期）+ 数组换名：'listCandidates' → 'canvasCheck'（删方法与去名必须同批，悬空名直接红）
  it('路由声明序：静态段（categories/tags/canvas-check/presign-video）先于作品 :id', () => {
    const proto = AdminVideoWorkController.prototype;
    const names = Object.getOwnPropertyNames(proto).filter(n => n !== 'constructor');
    const idRoutes = ['getWork', 'updateWork', 'deleteWork'].map(n => names.indexOf(n)).filter(i => i >= 0);
    const staticRoutes = ['listCategories', 'listTags', 'canvasCheck', 'uploadCover', 'getSettings', 'presignVideo'];
    for (const s of staticRoutes) {
      expect(names.indexOf(s)).toBeGreaterThan(-1);
      expect(Math.min(...idRoutes)).toBeGreaterThan(names.indexOf(s)); // :id 吃 GET 静态段（canvas-check 返回 200+null 而非 404）
    }
  });

  it('canvas-check 转发 query id', async () => {
    service.canvasCheck = vi.fn().mockResolvedValue({ id: 'p1', name: 'x', ownerName: null, updatedAt: '2026-09-01' });
    await controller.canvasCheck('p1');
    expect(service.canvasCheck).toHaveBeenCalledWith('p1');
  });
```

- [ ] **Step 5: 全绿 + 提交**

`cd D:/flowweb/apps/api && npm test`
Expected: PASS（注意 video-work.service.spec 的文件级 beforeEach media.findMany 默认值是候选形状——describe 已删，无消费者，不冲突）

```bash
cd D:/flowweb && git add apps/api/src/modules/video-work packages/shared/src/types/video-work.ts
git commit -m "feat(video-work): canvas-check 画布回显（ownerName 回落链）+删候选池（controller/service/CandidateMedia/describe/数组换名同批）+listAllWorks 封面 presign"
```

---

## Task 4: createWork 画布校验 + F2 videoKey 不变量 + updateWork dto-only 口径

**Files:**
- Modify: `apps/api/src/modules/video-work/video-work.service.ts:116-142`（createWork/updateWork）
- Modify: `apps/api/src/modules/video-work/dto/create-video-work.dto.ts:9-12`（注释失真修复）
- Test: `apps/api/src/modules/video-work/video-work.service.spec.ts`（文件级 mock 三样 + beforeEach 默认行 + 5 处 payload + 文案断言 + 新 describe）

- [ ] **Step 1: spec 基建——文件级 mock 补三样 + 默认匹配行**

`video-work.service.spec.ts` 文件级 beforeEach：

(a) `prisma.media` 命名空间追加两个方法（F2 用 findUnique；removeWork 软删用 update——Task 5 复用）：

```ts
      media: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(1),
        findUnique: vi.fn(),   // Task 4 F2：PK 查 mediaId
        update: vi.fn().mockResolvedValue({}),  // Task 5 removeWork：软删——默认 resolved（裸 vi.fn() 返回 undefined，实现里 .catch 链会 TypeError）
      },
```

（原 `findMany` 的候选形状默认值改 `[]`——**前置条件：Task 3 Step 1 已删 `describe('VideoWorkService.listCandidates')`**（:61/:71/:84 三条用例依赖该默认形状）；若单独回滚 Task 4，必须先确认该 describe 不在文件中。）

(b) `videoWork` 命名空间 `count` 补默认值（裸 vi.fn() 返回 undefined，排他 `undefined > 0` 恒 false 是真空绿）：

```ts
      videoWork: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
```

(c) beforeEach 末尾（`service = moduleRef.get(...)` 之前）加 F2 默认匹配行：

```ts
    // Task 4 F2 默认匹配行——createWork 用例 payload 传 videoKey:'k' + videoMediaId:'m1' 时直接过；
    // negative 用例自行 mockResolvedValueOnce 覆盖（证明默认行没把断言架空）
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', key: 'k', status: 'completed', type: 'uploaded', teamId: 'platform-team', deletedAt: null });
```

- [ ] **Step 2: 写失败测试（新 describe + 存量 5 处用例改造）**

(a) 存量用例 payload 补 `videoMediaId: 'm1'`：`:111/:113`（flags 两条）、`:118`（allowClone 耦合 createWork 侧）、`:131`（publishedAt）、`:147`（durationSec 取整）——只列 diff（`videoKey: 'k'` 后追加）：

```ts
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k', videoMediaId: 'm1',
      allowViewProcess: true, allowClone: false, canvasProjectId: undefined } as any)).rejects.toThrow('开启创作过程/克隆需要画布来源'); // 泛型 toThrow(BadRequestException) 升级为文案（F2 插入位置 flags→画布→F2 的唯一漂移探测器）
```

（四处同理：:114 → `'开启创作过程/克隆需要画布来源'`；:118-119 → `'允许克隆必须同时允许查看创作过程'`；:126 updateWork 侧同文案。）

(b) `:118` 用例的 createWork 侧带 `canvasProjectId: 'p1'`——**flags 先抛（顺序 flags→画布→F2），画布校验实际不会跑**；stub 留作防御性（若有人把顺序调转会以正确文案红而非 TypeError），非必需：

```ts
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', name: 'n', updatedAt: new Date(), user: null, team: { owner: { name: 'o' } } }); // 防御性：正常时序 flags 先抛、此 stub 不被消费
```

(c) 文件尾追加新 describe：

```ts
describe('createWork 画布校验 + F2 videoKey 不变量（顺序钉死：flags→画布→F2）', () => {
  it('画布不存在 → 400 画布不存在（findCanvasRef）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k', videoMediaId: 'm1', canvasProjectId: 'p-404' } as any))
      .rejects.toThrow('画布不存在');
  });

  it('canvasProjectId 空 → 不校验画布、允许创建（null 分支）', async () => {
    prisma.videoWork.create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k', videoMediaId: 'm1', canvasProjectId: undefined } as any)).resolves.toBeTruthy();
    expect(prisma.canvasProject.findUnique).not.toHaveBeenCalled();
  });

  it('F2：无 videoMediaId → 400（先于 media.findUnique）', async () => {
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k' } as any))
      .rejects.toThrow('视频文件不存在或未完成上传');
    expect(prisma.media.findUnique).not.toHaveBeenCalled();
  });

  it('F2 五条件 negative（默认匹配行之外的行 → 400，证明 beforeEach 行没架空断言）', async () => {
    for (const bad of [
      null,                                                                                 // 不存在
      { id: 'm1', key: 'k', status: 'completed', type: 'uploaded', teamId: 'platform-team', deletedAt: new Date() },   // 软删
      { id: 'm1', key: 'k', status: 'pending', type: 'uploaded', teamId: 'platform-team', deletedAt: null },           // 未完成
      { id: 'm1', key: 'k', status: 'completed', type: 'generated', teamId: 'platform-team', deletedAt: null },        // 非上传
      { id: 'm1', key: 'k', status: 'completed', type: 'uploaded', teamId: 'personal-team', deletedAt: null },         // 非平台团队
      { id: 'm1', key: 'other-key', status: 'completed', type: 'uploaded', teamId: 'platform-team', deletedAt: null }, // key 交叉不符
    ]) {
      prisma.media.findUnique.mockResolvedValueOnce(bad as any);
      await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k', videoMediaId: 'm1' } as any))
        .rejects.toThrow('视频文件不存在或未完成上传');
    }
  });

  it('F2：PK 查 mediaId（勿按 key 查——Media.key 无索引全表扫）', async () => {
    prisma.videoWork.create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await service.createWork({ title: 't', authorName: 'a', videoKey: 'k', videoMediaId: 'm1' } as any);
    expect(prisma.media.findUnique).toHaveBeenCalledWith({ where: { id: 'm1' } });
    expect(prisma.videoWork.create).toHaveBeenCalled();
  });
});

describe('updateWork 画布校验 dto-only 口径（勿用 merged——死画布存量作品连改标题都会 400）', () => {
  const existing = (over: Record<string, unknown> = {}) => ({ id: 'w1', status: 'DRAFT', publishedAt: null, allowViewProcess: false, allowClone: false, canvasProjectId: 'p-dead', ...over });

  it('显式传不存在的画布 → 400', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue(existing());
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    await expect(service.updateWork('w1', { canvasProjectId: 'p-404' } as any)).rejects.toThrow('画布不存在');
  });

  it('传 null → 跳过校验、已存值不动（dto-only：null 是"显式清除"语义，不查存在性）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue(existing());
    prisma.videoWork.update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await expect(service.updateWork('w1', { canvasProjectId: null } as any)).resolves.toBeTruthy();
    expect(prisma.canvasProject.findUnique).not.toHaveBeenCalled();
  });

  it('存量作品画布已删 + 仅改标题 → 成功（merged 口径下此用例红——旧语义容忍死画布，getDetail 用 canvasExists 降级不报错）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue(existing({ canvasProjectId: 'p-dead' }));
    prisma.videoWork.update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await expect(service.updateWork('w1', { title: '新标题' } as any)).resolves.toBeTruthy();
    expect(prisma.canvasProject.findUnique).not.toHaveBeenCalled(); // dto 未带画布 → 不查
  });
});
```

- [ ] **Step 3: 跑测试确认红**

`cd D:/flowweb/apps/api && npx vitest run src/modules/video-work/video-work.service.spec.ts`
Expected: FAIL——'画布不存在'/'视频文件不存在或未完成上传' 用例（方法未实现）

- [ ] **Step 4: 实现 createWork/updateWork**

`video-work.service.ts`（createWork :116-124 替换为——顺序钉死 flags→画布→F2）：

```ts
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
```

updateWork（:126-142）——`assertProcessFlags(merged)` 之后、`const data` 之前插入（顺序 flags→画布；F2 不适用 update：UpdateVideoWorkDto 无 videoKey/videoMediaId 字段 + controller 类级 forbidNonWhitelisted，传即 400，服务端面已守住"换源=重建"）：

```ts
    // 画布校验 dto-only（spec §4.5）：只校验 dto 显式提供的非空值。勿用 merged——源画布已被删的存量作品
    // 连改标题都 400，要先清画布+关两开关才存得出去（体验陷阱）；flags 的 merged 是另一语义，勿混。
    if (dto.canvasProjectId && !(await this.findCanvasRef(dto.canvasProjectId)))
      throw new BadRequestException('画布不存在');
```

- [ ] **Step 5: DTO 注释失真修复（create-video-work.dto.ts:9-12，本次改动造成的孤立注释）**

```ts
  @IsString() @MaxLength(512) videoKey!: string;          // 成品视频对象键（presign-video 返回的 key，F2 校验与 videoMediaId 交叉一致）
  @IsOptional() @IsString() videoMediaId?: string;        // presign-video 建的 Media 行 id（platform-team 归属，F2 必填校验在 service）
  @IsOptional() @IsString() @MaxLength(512) coverKey?: string;
  @IsOptional() @IsString() canvasProjectId?: string;     // 源画布（可选；非空时 findCanvasRef 校验存在性）
```

- [ ] **Step 6: 全绿 + 提交**

`cd D:/flowweb/apps/api && npm test`
Expected: PASS（重点核对：flags 四处文案断言、updateWork 既有三条 merged-flags 用例仍绿——dto 未带画布不触发校验）

```bash
cd D:/flowweb && git add apps/api/src/modules/video-work/video-work.service.ts apps/api/src/modules/video-work/video-work.service.spec.ts apps/api/src/modules/video-work/dto/create-video-work.dto.ts
git commit -m "feat(video-work): createWork F2 videoKey 五条件不变量（PK+platform-team+key 交叉）+画布校验（update dto-only 口径）+存量用例补 mediaId/默认行/文案断言"
```

---

## Task 5: removeWork 域分治清理 + updateWork 换封面删旧

**Files:**
- Modify: `apps/api/src/modules/video-work/video-work.service.ts`（removeWork :224-229 + updateWork 换封面）
- Test: `apps/api/src/modules/video-work/video-work.service.spec.ts`（翻转 :151-157 钉子为非真空三态 + 新用例）

- [ ] **Step 0: spec 基建——文件级 mock 默认 resolved（裸 vi.fn() 返回 undefined，实现里的 await 链会 TypeError）**

`video-work.service.spec.ts` 文件级 beforeEach 的 `minio`（:42）与 `REDIS_CLIENT`（:52）：

```ts
    minio = { generatePresignedGetUrl: vi.fn().mockResolvedValue('http://minio/presigned'), buildKey: vi.fn(), upload: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) }; // delete 补默认 resolved（Task 5）
    // providers 里：
        { provide: 'REDIS_CLIENT', useValue: { get: vi.fn(), set: vi.fn(), del: vi.fn().mockResolvedValue(undefined) } }, // del 补默认 resolved（Task 5）
```

（先例：同文件 :153 用例内 `minio.delete = vi.fn().mockResolvedValue(undefined)`——现在提升为文件级默认。）

- [ ] **Step 1: 写失败测试（翻转钉子用例）**

替换 `:151-157` 的 removeWork 红线用例（旧用例不 stub findUnique 是真空绿——裸 vi.fn() 返回 undefined → 无 key → not.toHaveBeenCalled 恒真，验不到任何东西）：

```ts
  it('removeWork 平台域作品：删对象 + Media 软删 + 缓存失效（videoWork:url:key + process）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', videoKey: 'uploads/system/2026-09-18/a.mp4', videoMediaId: 'm1', coverKey: 'uploads/system/c.jpg' });
    prisma.videoWork.count = vi.fn().mockResolvedValue(0); // 排他：无共享
    prisma.videoWork.delete = vi.fn().mockResolvedValue({});
    minio.delete = vi.fn().mockResolvedValue(undefined);
    await service.removeWork('w1');
    expect(minio.delete).toHaveBeenCalledWith('uploads/system/2026-09-18/a.mp4'); // 平台域删对象（非真空——findUnique 已 stub）
    expect(minio.delete).toHaveBeenCalledWith('uploads/system/c.jpg');             // 封面同域同删
    expect(prisma.media.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1' }, data: expect.objectContaining({ deletedAt: expect.any(Date) }) })); // 软删释放平台配额
    expect((service as any).redis.del).toHaveBeenCalledWith('videoWork:url:uploads/system/2026-09-18/a.mp4'); // 卫生动作：防将来"删对象但保留行"路径
    expect(prisma.videoWork.delete).toHaveBeenCalledWith({ where: { id: 'w1' } });
  });

  it('removeWork 存量 results/ 域作品：只删 DB 行不删对象（旧红线保留的半边——旧对象与源 Media 共享）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w2', videoKey: 'results/u1/p1/n1/d/v.mp4', videoMediaId: 'm2', coverKey: null });
    prisma.videoWork.delete = vi.fn().mockResolvedValue({});
    await service.removeWork('w2');
    expect(minio.delete).not.toHaveBeenCalled(); // 域外不删
    expect(prisma.videoWork.delete).toHaveBeenCalledWith({ where: { id: 'w2' } });
  });

  it('removeWork 行不存在 → 404（先查后删——裸 delete 抛 P2025 变 500）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue(null);
    await expect(service.removeWork('w-404')).rejects.toThrow(NotFoundException);
  });

  it('removeWork 排他：videoMediaId 被其他作品引用 → 不删对象（防存量共享/直调；封面 coverKey 字符串比对）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w3', videoKey: 'uploads/system/a.mp4', videoMediaId: 'm3', coverKey: 'uploads/system/c.jpg' });
    prisma.videoWork.count = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0); // 第一次=videoMediaId 排他(共享)，第二次=coverKey 排他(独占)
    prisma.videoWork.delete = vi.fn().mockResolvedValue({});
    await service.removeWork('w3');
    expect(minio.delete).not.toHaveBeenCalledWith('uploads/system/a.mp4'); // 共享视频不删
    expect(minio.delete).toHaveBeenCalledWith('uploads/system/c.jpg');     // 独占封面照删
  });

  it('removeWork MinIO 抖动不阻断（尽力而为——失败仅记日志，作品删除照常成功）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w4', videoKey: 'uploads/system/a.mp4', videoMediaId: 'm4', coverKey: null });
    prisma.videoWork.count = vi.fn().mockResolvedValue(0);
    prisma.videoWork.delete = vi.fn().mockResolvedValue({});
    minio.delete = vi.fn().mockRejectedValue(new Error('minio down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(service.removeWork('w4')).resolves.toBeUndefined(); // 不抛
    expect(prisma.videoWork.delete).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('updateWork 换封面：DB 更新后删旧封面对象（排他——被其他作品引用则不删）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'DRAFT', publishedAt: null, allowViewProcess: false, allowClone: false, canvasProjectId: null, coverKey: 'uploads/system/old.jpg' });
    prisma.videoWork.update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    prisma.videoWork.count = vi.fn().mockResolvedValue(0);
    await service.updateWork('w1', { coverKey: 'uploads/system/new.jpg' } as any);
    expect(minio.delete).toHaveBeenCalledWith('uploads/system/old.jpg');
  });

  it('updateWork 换封面：旧 coverKey 被引用 → 不删（同一 key 挂多作品的防御性互斥）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'DRAFT', publishedAt: null, allowViewProcess: false, allowClone: false, canvasProjectId: null, coverKey: 'uploads/system/shared.jpg' });
    prisma.videoWork.update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    prisma.videoWork.count = vi.fn().mockResolvedValue(1); // 被另一作品引用
    await service.updateWork('w1', { coverKey: 'uploads/system/new.jpg' } as any);
    expect(minio.delete).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: 跑测试确认红**

`cd D:/flowweb/apps/api && npx vitest run src/modules/video-work/video-work.service.spec.ts`
Expected: FAIL——现 removeWork 无 findUnique/404/对象删除

- [ ] **Step 3: 实现 removeWork + updateWork 换封面**

替换 removeWork（:224-229 连同旧红线注释）：

```ts
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
```

updateWork——`const row = await this.prisma.videoWork.update(...)` 之后、`invalidateWorkCaches` 之前插入：

```ts
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
```

- [ ] **Step 4: 全绿 + 提交**

`cd D:/flowweb/apps/api && npm test`
Expected: PASS

```bash
cd D:/flowweb && git add apps/api/src/modules/video-work/video-work.service.ts apps/api/src/modules/video-work/video-work.service.spec.ts
git commit -m "feat(video-work): removeWork 域分治（平台域删+排他+Media 软删+缓存失效+不阻断+404）+updateWork 换封面删旧——翻转旧红线钉子为非真空三态"
```

---

## Task 6: seed 平台团队 + seed 完整性 spec（连真库）

**Files:**
- Modify: `apps/api/prisma/seed.ts`（:229 管理员块之后追加）
- Create: `apps/api/src/modules/team/platform-team.seed.spec.ts`

- [ ] **Step 1: 写失败测试（连真库 spec——src/auth/auth.role.spec.ts:5 先例）**

`apps/api/src/modules/team/platform-team.seed.spec.ts`（放 src/ 下：tsconfig.spec.json include 只有 ["src"]，放 prisma/ 则 tsc 看不见；另注意 prisma/seed.ts 本身不在任何 tsc 范围——类型保护靠 `prisma db seed` 时 tsx 报错，这是已知盲区）：

```ts
import { PrismaClient } from '@prisma/client';
import { TeamSubscriptionService } from './team-subscription.service';
import { describe, it, expect, afterAll } from 'vitest';

// 连真库（apps/api/src/auth/auth.role.spec.ts:5 先例：new PrismaClient() 直连）——前提：本地已跑 `prisma db seed`。未 seed 的环境此 spec 红（与先例相同前提）。
// 钉死原因：订阅缺失/过期/非 active 时 getLimits 静默回落 6GiB 不报错——失效极难排查，必须自动化而非手工步骤。
const prisma = new PrismaClient();

afterAll(async () => { await prisma.$disconnect(); });

describe('平台团队 seed 完整性', () => {
  it("getLimits('platform-team').storageLimitBytes === 1TB（getLimits 出口已 Number(BigInt)，number 比较）", async () => {
    const svc = new TeamSubscriptionService(prisma as any, {} as any); // getLimits 只用 prisma，audit 依赖不触及
    expect((await svc.getLimits('platform-team')).storageLimitBytes).toBe(1024 ** 4);
  });

  it('platform-storage 套餐 isActive=false（防泄漏到用户端可购买列表）且管理员是 platform-team 成员', async () => {
    const plan = await prisma.teamPlan.findUnique({ where: { id: 'platform-storage' } });
    expect(plan?.isActive).toBe(false);
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@flowweb.local';
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    expect(admin).toBeTruthy();
    const member = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: 'platform-team', userId: admin!.id } } });
    expect(member?.role).toBe('OWNER');
  });
});
```

- [ ] **Step 2: seed.ts 追加平台团队块**

在管理员账号块（`console.log('Seed complete...')` 之前、admin 创建/提升逻辑之后）插入：

```ts
  // ===== 平台资产团队（spec 2026-09-18-video-work-admin-upload §4.1，B 形态：专用系统用户） =====
  // 成品视频归属：配额代码零改动、两道闸照跑（1TB）；管理员个人配额零污染；Media.user 级联风险消失。
  // update 分支显式写关键字段——空 update 命中同 id 不改值：isActive 被误点上架/isDefault 被改 true/订阅被改
  // 过期后，重跑 seed 即自愈（第一道防线）；"勿上架"命名是第二道（先例：非空 update seed.ts:169）。
  await prisma.user.upsert({
    where: { id: 'platform-owner' },
    update: {},
    create: { id: 'platform-owner', name: 'Platform Owner', email: 'platform-owner@flowweb.local', emailVerified: true },
  });
  await prisma.teamPlan.upsert({
    where: { id: 'platform-storage' },
    // isActive:false 承重：GET /api/team/plans 用户端 where isActive:true——true 会把 1TB/0 元档泄漏为可购买套餐
    //（getLimits 只读 storageLimitBytes 不读 isActive，false 零副作用；subscribe 也挡 !isActive）
    update: { isActive: false, storageLimitBytes: 1099511627776n },
    create: { id: 'platform-storage', name: '（内部）平台存储·勿上架', monthlyCredits: 0, storageLimitBytes: 1099511627776n, seatLimit: 1, priceMonthly: 0, isActive: false, sort: 99 },
  });
  await prisma.team.upsert({
    where: { id: 'platform-team' },
    update: { isDefault: false }, // 承重：true 会使 getLimits 走"默认团队回退个人订阅"分支、1TB 被忽略
    create: { id: 'platform-team', name: '平台资产团队', ownerId: 'platform-owner', status: 'ACTIVE', isDefault: false },
  });
  // TeamMember 必须在管理员创建之后（admin id 由 BetterAuth 生成，按 email 查回——ADMIN_EMAIL 可被环境变量覆盖）
  const platformAdmin = await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true } });
  if (platformAdmin) {
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: 'platform-team', userId: platformAdmin.id } }, // 复合键先例 seed.ts:187-191
      update: { role: 'OWNER' },
      create: { teamId: 'platform-team', userId: platformAdmin.id, role: 'OWNER' },
    });
  }
  await prisma.teamSubscription.upsert({
    // 无自然键——固定 id。必须 upsert：partial unique index team_subscription_one_active（migration 20260829201000:105）
    // 下裸 create 二次 seed 必冲突。改此固定 id 前先清旧 active 行，否则同撞该索引。
    where: { id: 'platform-subscription' },
    update: { status: 'active', currentPeriodEnd: new Date('2099-01-01') },
    create: { id: 'platform-subscription', teamId: 'platform-team', planId: 'platform-storage', status: 'active', paidAmount: 0, currentPeriodStart: new Date(), currentPeriodEnd: new Date('2099-01-01') },
  });
```

- [ ] **Step 3: 跑 seed 再跑测试**

```bash
cd D:/flowweb/apps/api && npx prisma db seed
npx vitest run src/modules/team/platform-team.seed.spec.ts
```
Expected: seed 输出 `Seed complete`；spec PASS（若 spec 在 seed 前先跑应为红：getLimits 回落 6GiB ≠ 1TB）

- [ ] **Step 4: 全量回归 + 提交**

`cd D:/flowweb/apps/api && npm test`
Expected: PASS

```bash
cd D:/flowweb && git add apps/api/prisma/seed.ts apps/api/src/modules/team/platform-team.seed.spec.ts
git commit -m "feat(seed): 平台资产团队五行（platform-owner/1TB isActive:false/platform-team/admin 成员/2099 订阅）——非空 update 自愈 + 连真库完整性 spec"
```

---

## Task 7: 前端 probeVideoFile 模块（探测 + 抽帧）

**Files:**
- Create: `apps/web/src/pages/admin/utils/probeVideoFile.ts`
- Test: `apps/web/src/pages/admin/utils/__tests__/probeVideoFile.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react'; // waitFor 必须显式 import——globals:true 只给 vitest 全局（VideoWorksPage.test.tsx:2 同款）
import { probeVideoFile } from '../probeVideoFile';

// jsdom 无 URL.createObjectURL/revokeObjectURL——直接赋桩 + 还原（ExportModal.test.tsx:148-152 先例；
// 勿 vi.stubGlobal('URL', {...URL}) 整体替换——同文件任何 new URL(...) 会变 "not a constructor"）
const urlBag = URL as unknown as { createObjectURL: () => string; revokeObjectURL: () => void };
const origCreate = urlBag.createObjectURL;
const origRevoke = urlBag.revokeObjectURL;
const createObjectURL = vi.fn().mockReturnValue('blob:mock');
const revokeObjectURL = vi.fn();

// jsdom 的 duration/videoWidth/videoHeight/readyState 是只读 IDL 属性（ESM 严格模式直赋抛 TypeError）——
// 四处全走 defineProperty（VideoGenNode.test.tsx:376-377 先例）；readyState 默认 0，不 stub 抽帧会被跳过。
// canvas getContext jsdom 默认 null——createElement spy 里一并 stub（EraseCanvas/PreviewPlayer 先例）。
const def = (el: HTMLElement, prop: string, value: unknown) =>
  Object.defineProperty(el, prop, { value, configurable: true });

const setupSpies = () => {
  const orig = document.createElement.bind(document);
  let video: HTMLVideoElement | null = null;
  const toBlob = vi.fn((cb: (b: Blob | null) => void) => cb(new Blob(['x'], { type: 'image/jpeg' })));
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = orig(tag);
    if (tag === 'video') video = el as HTMLVideoElement;
    if (tag === 'canvas') {
      (el as HTMLCanvasElement).getContext = () => ({ drawImage: vi.fn() } as any);
      (el as HTMLCanvasElement).toBlob = toBlob as any;
    }
    return el;
  });
  return { get video() { return video!; }, toBlob };
};

describe('probeVideoFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    urlBag.createObjectURL = createObjectURL as any;
    urlBag.revokeObjectURL = revokeObjectURL as any;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    urlBag.createObjectURL = origCreate;
    urlBag.revokeObjectURL = origRevoke;
  });

  it('loadedmetadata → 元数据（12.345 → durationSec=12 钉取整）+ seeked → 抽帧 coverBlob', async () => {
    const spy = setupSpies();
    const p = probeVideoFile(new File(['x'], 'a.mp4', { type: 'video/mp4' }));
    const v = spy.video; // createElement 同步执行——无需 waitFor
    def(v, 'duration', 12.345); def(v, 'videoWidth', 1920); def(v, 'videoHeight', 1080); def(v, 'readyState', 2);
    fireEvent(v, new Event('loadedmetadata'));
    // jsdom 的 currentTime setter 只写字段不发 seeked——同步点：实现已执行 currentTime = min(1, 12.345/2)
    await waitFor(() => expect(v.currentTime).toBe(1));
    fireEvent(v, new Event('seeked'));
    const r = await p;
    expect(r).toEqual({ ok: true, durationSec: 12, width: 1920, height: 1080, coverBlob: expect.any(Blob) });
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it('video error → { ok:false, reason:"decode" }（可播放性闸门——拦 HEVC/ProRes/.mov）', async () => {
    const spy = setupSpies();
    const p = probeVideoFile(new File(['x'], 'a.mov', { type: 'video/quicktime' }));
    fireEvent(spy.video, new Event('error'));
    await expect(p).resolves.toEqual({ ok: false, reason: 'decode' });
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it('数值守卫：duration=Infinity / 宽高=0 / readyState<2 → 字段 null + 抽帧跳过，非整体失败（真实 MP4 形态）', async () => {
    const spy = setupSpies();
    const p = probeVideoFile(new File(['x'], 'a.mp4', { type: 'video/mp4' }));
    const v = spy.video;
    def(v, 'duration', Infinity); def(v, 'videoWidth', 0); def(v, 'videoHeight', 0); def(v, 'readyState', 0);
    fireEvent(v, new Event('loadedmetadata'));
    const r = await p; // 守卫跳过抽帧——无需 seeked，直接 settle
    expect(r).toEqual({ ok: true, durationSec: null, width: null, height: null, coverBlob: null });
  });

  it('duration=Infinity + readyState≥2 → durationSec=null 但抽帧照走且 currentTime=1（第十轮：守卫拦 duration 勿 seek(0)——前导黑帧高发，数值守卫与抽帧互不阻断的正例）', async () => {
    const spy = setupSpies();
    const p = probeVideoFile(new File(['x'], 'a.mp4', { type: 'video/mp4' }));
    const v = spy.video;
    def(v, 'duration', Infinity); def(v, 'videoWidth', 1280); def(v, 'videoHeight', 720); def(v, 'readyState', 2);
    fireEvent(v, new Event('loadedmetadata'));
    await waitFor(() => expect(v.currentTime).toBe(1)); // 非 0——rawDuration=0 分支的 seek 目标（防回归 seek(0) 抽黑帧）
    fireEvent(v, new Event('seeked'));
    const r = await p;
    expect(r).toEqual({ ok: true, durationSec: null, width: 1280, height: 720, coverBlob: expect.any(Blob) });
  });

  it('metadata 正常但 seeked 永不到来 → captureFrame 超时兜底 coverBlob=null（真实浏览器 seek 偶尔不回调——实现必须兜底防挂死）', async () => {
    vi.useFakeTimers();
    try {
      const spy = setupSpies();
      const p = probeVideoFile(new File(['x'], 'a.mp4', { type: 'video/mp4' }));
      const v = spy.video;
      def(v, 'duration', 30); def(v, 'videoWidth', 1280); def(v, 'videoHeight', 720); def(v, 'readyState', 2);
      fireEvent(v, new Event('loadedmetadata'));
      await vi.advanceTimersByTimeAsync(5_000); // CAPTURE_TIMEOUT_MS
      const r = await p;
      expect(r).toEqual({ ok: true, durationSec: 30, width: 1280, height: 720, coverBlob: null }); // 不挂死、元数据照返
    } finally { vi.useRealTimers(); }
  });

  it('事件永不触发 → 10s 超时 decode，且清理真实发生（revokeObjectURL 调用 + src 清空）', async () => {
    vi.useFakeTimers();
    try {
      const spy = setupSpies();
      const p = probeVideoFile(new File(['x'], 'a.mp4', { type: 'video/mp4' }));
      const v = spy.video;
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(p).resolves.toEqual({ ok: false, reason: 'decode' });
      expect(revokeObjectURL).toHaveBeenCalled();
      expect(v.getAttribute('src')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
```

- [ ] **Step 2: 跑测试确认红**

`cd D:/flowweb/apps/web && npx vitest run src/pages/admin/utils/__tests__/probeVideoFile.test.ts`
Expected: FAIL——模块不存在

- [ ] **Step 3: 实现 probeVideoFile.ts**

```ts
/** 成品视频本地探测（spec §5.1）：objectURL + <video> 事件舞。
 *  返回 null 字段 = 探测不到对应值（Infinity/0 宽高的真实 MP4 形态），非失败——DTO 全 @IsOptional。
 *  decode 失败同时是可播放性闸门：HEVC/ProRes/.mov 在 Chrome 播不了，probe 就拦下（服务器端无真实 MIME 校验，
 *  presign 的 contentType 形参是死参——这是唯一防线）。 */
export type ProbeResult =
  | { ok: true; durationSec: number | null; width: number | null; height: number | null; coverBlob: Blob | null }
  | { ok: false; reason: 'decode' };

const COVER_MAX_W = 1280;        // 封面限宽（抽帧 jpeg 过大无意义）
const PROBE_TIMEOUT_MS = 10_000; // 畸形文件事件永不触发——不兜底则 Promise 永不 settle + objectURL 泄漏
const CAPTURE_TIMEOUT_MS = 5_000; // seek 不回调兜底（真实浏览器偶发）——没封面比挂死好

export async function probeVideoFile(file: File): Promise<ProbeResult> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  video.src = url;

  const cleanup = () => {
    // src 清空即释放（真实浏览器可再调 load() 中止解码；jsdom 的 load 是 notImplemented 噪音，故不调）
    video.removeAttribute('src');
    URL.revokeObjectURL(url);
  };

  const metadata = new Promise<{ durationSec: number | null; width: number | null; height: number | null; rawDuration: number }>((resolve, reject) => {
    video.addEventListener('loadedmetadata', () => {
      const finite = Number.isFinite(video.duration) && video.duration > 0;
      resolve({
        durationSec: finite ? Math.round(video.duration) : null, // durationSec 取整在此完成（DTO @IsInt 无 transform，浮点直接 400）
        width: video.videoWidth > 0 ? video.videoWidth : null,
        height: video.videoHeight > 0 ? video.videoHeight : null,
        rawDuration: finite ? video.duration : 0,
      });
    }, { once: true });
    video.addEventListener('error', () => reject(new Error('decode')), { once: true });
  });

  let probeTimer: ReturnType<typeof setTimeout>;
  try {
    const m = await Promise.race([
      metadata,
      new Promise<never>((_, rej) => { probeTimer = setTimeout(() => rej(new Error('timeout')), PROBE_TIMEOUT_MS); }),
    ]);
    const coverBlob = await captureFrame(video, m.rawDuration);
    return { ok: true, durationSec: m.durationSec, width: m.width, height: m.height, coverBlob };
  } catch {
    return { ok: false, reason: 'decode' }; // video error 或 10s 超时
  } finally {
    clearTimeout(probeTimer!); // 成功路径也清——悬挂 10s timer 是 fake-timers 环境的隐患（与 captureFrame 的清理纪律一致）
    cleanup();
  }
}

async function captureFrame(video: HTMLVideoElement, duration: number): Promise<Blob | null> {
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null; // HAVE_CURRENT_DATA——drawImage 前置
  let t: ReturnType<typeof setTimeout>;
  const frame = new Promise<Blob | null>((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, COVER_MAX_W / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => resolve(b), 'image/jpeg');
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = duration > 0 ? Math.min(1, duration / 2) : 1; // <1s 短视频 seek(1) 被夹到末帧可能抽到黑帧；duration 非法(rawDuration=0) 勿 seek(0)——前导黑帧高发（第九轮：数值守卫只拦 readyState/宽高，不拦 duration）
    t = setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS); // seek 不回调兜底——勿让整个 probe 挂死
  });
  return frame.finally(() => clearTimeout(t));
}
```

- [ ] **Step 4: 跑测试确认绿 + 提交**

`cd D:/flowweb/apps/web && npx vitest run src/pages/admin/utils/__tests__/probeVideoFile.test.ts`
Expected: PASS

```bash
cd D:/flowweb && git add apps/web/src/pages/admin/utils/probeVideoFile.ts apps/web/src/pages/admin/utils/__tests__/probeVideoFile.test.ts
git commit -m "feat(admin): probeVideoFile 模块——本地探测（取整+守卫+10s 超时）+抽帧（seek min(1,d/2)、限宽 1280），可播放性闸门"
```

---

## Task 8: 前端 uploadToPresignedPost 模块 + adminApi 增删

**Files:**
- Create: `apps/web/src/pages/admin/utils/uploadToPresignedPost.ts`
- Modify: `apps/web/src/api/adminApi.ts:198`（删 listCandidates、加 presignVideo/canvasCheck）
- Test: `apps/web/src/pages/admin/utils/__tests__/uploadToPresignedPost.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { uploadToPresignedPost } from '../uploadToPresignedPost';

vi.mock('axios');
const post = vi.mocked(axios.post);

describe('uploadToPresignedPost', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('FormData fields 在前、file 在后（S3 presigned POST 硬要求）+ 显式 multipart 头', async () => {
    post.mockResolvedValue({} as any);
    await uploadToPresignedPost({ url: '/flowai/up', fields: { key: 'k', Policy: 'p' }, file: new File(['x'], 'a.mp4') });
    const [, formData, config] = post.mock.calls[0];
    const entries = [...(formData as FormData).entries()];
    expect(entries.map(([k]) => k)).toEqual(['key', 'Policy', 'file']); // fields 先、file 后
    expect((config as any).headers['Content-Type']).toBe('multipart/form-data');
  });

  it('onUploadProgress 喂 {loaded,total} → onProgress 百分比（useImageUpload.test.ts:265-267 先例）', async () => {
    post.mockImplementation(async (_url: string, _fd: FormData, cfg: any) => {
      cfg.onUploadProgress?.({ loaded: 50, total: 100 });
      return {};
    });
    const onProgress = vi.fn();
    await uploadToPresignedPost({ url: '/flowai/up', fields: {}, file: new File(['x'], 'a.mp4'), onProgress });
    expect(onProgress).toHaveBeenCalledWith(50);
  });

  it('signal 透传给 axios（abort 贯穿三段）', async () => {
    post.mockResolvedValue({} as any);
    const controller = new AbortController();
    await uploadToPresignedPost({ url: '/flowai/up', fields: {}, file: new File(['x'], 'a.mp4'), signal: controller.signal });
    expect((post.mock.calls[0][2] as any).signal).toBe(controller.signal);
  });

  it('403 → "上传超时（签名过期），请重试"（与体积超 policy ±1024 同症状——排查注意）', async () => {
    post.mockRejectedValue({ response: { status: 403 } });
    await expect(uploadToPresignedPost({ url: '/flowai/up', fields: {}, file: new File(['x'], 'a.mp4') }))
      .rejects.toThrow('上传超时（签名过期），请重试');
  });

  it('其他错误原样抛出', async () => {
    post.mockRejectedValue(new Error('network'));
    await expect(uploadToPresignedPost({ url: '/flowai/up', fields: {}, file: new File(['x'], 'a.mp4') }))
      .rejects.toThrow('network');
  });
});
```

- [ ] **Step 2: 跑测试确认红**

`cd D:/flowweb/apps/web && npx vitest run src/pages/admin/utils/__tests__/uploadToPresignedPost.test.ts`
Expected: FAIL——模块不存在

- [ ] **Step 3: 实现 uploadToPresignedPost.ts + adminApi**

```ts
import axios from 'axios';

/** 预签直传（spec §5.1）。裸 axios（非应用实例——api/client.ts 默认 Content-Type: application/json，
 *  S3 policy 对表单字段敏感）；模板 mediaUploadUtils.ts:27-35（该模板无进度参数——进度写法另引 VideoGenNode.tsx:498）。
 *  url 由调用方先过 toFlowaiUrl（桶非公开读 + dev CORS——同源改写后走 /flowai 代理/Vite 代理）。 */
export async function uploadToPresignedPost(args: {
  url: string;
  fields: Record<string, string>;
  file: File | Blob;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const formData = new FormData();
  for (const [k, v] of Object.entries(args.fields)) formData.append(k, v); // fields 在前
  formData.append('file', args.file, args.file instanceof File ? args.file.name : 'cover.jpg'); // file 在后（S3 硬要求）
  try {
    await axios.post(args.url, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (e.total) args.onProgress?.(Math.round((e.loaded / e.total) * 100));
      },
      signal: args.signal,
    });
  } catch (e: any) {
    if (e?.response?.status === 403) throw new Error('上传超时（签名过期），请重试');
    throw e;
  }
}
```

`adminApi.ts`——`listCandidates` 行（:198）**之后追加**两方法（**listCandidates 本行不删**——删除挪 Task 10 与页面改动同批，每提交 tsc 自洽：本任务先删会令 commit 8-9 的 `npx tsc -b` 红（页面 :241 仍在调用），而 web 的 npm test 只跑 vitest 抓不到、拖到 Task 12 才发现；**返回类型必须标注**：apiFetch 无推断位时 T=unknown，调用点读 `.uploadUrl` 等会 TS2571；signal 形参照 storageApi.presignUpload 先例——三段贯穿 abort。测试 mock 依赖已核：VideoWorksPage.test.tsx:12 是 `vi.mock('@/api/adminApi')` automock——方法来自真实模块，Task 10 的 `vi.mocked(adminVideoWorkApi.presignVideo)` 依赖本任务先加上）：

```ts
  presignVideo: (data: { fileName: string; fileSize: number; fileType: string }, signal?: AbortSignal): Promise<PresignResponse> =>
    apiFetch('/admin/video-works/presign-video', { method: 'POST', body: JSON.stringify(data), signal }),
  canvasCheck: (id: string): Promise<{ id: string; name: string; ownerName: string | null; updatedAt: string }> =>
    apiFetch(`/admin/video-works/canvas-check?id=${encodeURIComponent(id)}`),
```

文件头追加 `import type { PresignResponse } from './storageApi';`（复用既有导出，勿另造类型）。

- [ ] **Step 4: 跑测试确认绿 + 提交**

`cd D:/flowweb/apps/web && npx vitest run src/pages/admin/utils/__tests__/uploadToPresignedPost.test.ts`
Expected: PASS

```bash
cd D:/flowweb && git add apps/web/src/pages/admin/utils/uploadToPresignedPost.ts apps/web/src/pages/admin/utils/__tests__/uploadToPresignedPost.test.ts apps/web/src/api/adminApi.ts
git commit -m "feat(admin): uploadToPresignedPost（裸 axios+fields 前 file 后+403 映射+signal）+adminApi 增 presignVideo/canvasCheck（listCandidates 删除挪 Task 10 与页面同批——每提交 tsc 自洽）"
```

---

## Task 9: 前端 parseCanvasRef 纯函数

**Files:**
- Create: `apps/web/src/pages/admin/utils/parseCanvasRef.ts`
- Test: `apps/web/src/pages/admin/utils/__tests__/parseCanvasRef.test.ts`

- [ ] **Step 1: 写失败测试（表驱动）**

```ts
import { describe, it, expect } from 'vitest';
import { parseCanvasRef } from '../parseCanvasRef';

describe('parseCanvasRef（表驱动——onFinish 现算，防 C-1 注册陷阱）', () => {
  it.each([
    ['cpx1abc', 'cpx1abc'],                                              // 裸 ID
    ['  cpx1abc  ', 'cpx1abc'],                                          // 首尾空白
    ['"cpx1abc"', 'cpx1abc'],                                            // 控制台粘贴带引号
    ['http://localhost:5173/canvas?projectId=cpx1abc', 'cpx1abc'],       // 绝对 URL
    ['/canvas?projectId=cpx1abc', 'cpx1abc'],                            // 相对 URL（new URL(v, origin)）
    ['https://app.example.com/canvas?projectId=p&x=1', 'p'],             // 多参数
    ['/canvas', '/canvas'],                                              // URL 无 projectId → 整串当裸 ID
    ['', null],                                                          // 空
  ])('%s → %s', (input, expected) => {
    expect(parseCanvasRef(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: 跑测试确认红 → Step 3: 实现 → Step 4: 绿 + 提交**

`cd D:/flowweb/apps/web && npx vitest run src/pages/admin/utils/__tests__/parseCanvasRef.test.ts`

```ts
/** 粘贴画布 ID/URL → projectId（spec §5.3）。URL 形态对齐 canvas 路由（?projectId=，canvas/page.tsx:75）。 */
export function parseCanvasRef(text: string): string | null {
  const t = text.trim().replace(/^['"]|['"]$/g, ''); // 控制台粘贴可能带引号
  if (!t) return null;
  try {
    const u = new URL(t, window.location.origin); // 相对 /canvas?projectId=x 需 base
    return u.searchParams.get('projectId') || t;  // URL 无 projectId → 整串当裸 ID
  } catch {
    return t; // 非 URL → 裸 ID
  }
}
```

```bash
cd D:/flowweb && git add apps/web/src/pages/admin/utils/parseCanvasRef.ts apps/web/src/pages/admin/utils/__tests__/parseCanvasRef.test.ts
git commit -m "feat(admin): parseCanvasRef——裸 ID/URL/相对 URL/带引号/无参数回落 表驱动"
```

---

## Task 10: WorkFormModal 改造——成品视频上传区 + 封面提交时上传 + afterClose abort

> Task 10 完成后：候选下拉已删、上传流水线可用、create 门禁生效。画布输入框与开关联动的 verified 驱动在 Task 11。**本任务不动两开关的 disabled 逻辑**（仍按 canvasProjectId 字段值驱动）——edit 的 initialValues 仍带画布值，`:63` 开关联动用例照旧绿（其 mock 不变），无临时 skip。

**Files:**
- Modify: `apps/web/src/pages/admin/pages/VideoWorksPage.tsx`（WorkFormModal 整体改造）
- Test: `apps/web/src/pages/admin/pages/__tests__/VideoWorksPage.test.tsx`（删候选用例 + 新上传用例）

- [ ] **Step 1: 写失败测试（文件头 mock 调整 + 新用例）**

`VideoWorksPage.test.tsx` 文件头追加三个模块 mock（表单编排测试隔离两模块的完整事件舞）：

```ts
import { probeVideoFile } from '@/pages/admin/utils/probeVideoFile';
import { uploadToPresignedPost } from '@/pages/admin/utils/uploadToPresignedPost';
import { confirmUpload } from '@/api/storageApi';

vi.mock('@/pages/admin/utils/probeVideoFile', () => ({ probeVideoFile: vi.fn() }));
vi.mock('@/pages/admin/utils/uploadToPresignedPost', () => ({ uploadToPresignedPost: vi.fn() }));
vi.mock('@/api/storageApi', () => ({ presignUpload: vi.fn(), confirmUpload: vi.fn() }));
```

beforeEach 的 `:22` 行 `vi.mocked(adminVideoWorkApi.listCandidates)...` **删除**（API 已无此方法），追加默认值（canvasCheck 默认值防用例间泄漏——本文件 :15-16 注释自证 clearAllMocks 不清实现）：

```ts
  vi.mocked(adminVideoWorkApi.presignVideo).mockResolvedValue({ fileId: 'm1', uploadUrl: 'http://127.0.0.1:9000/flowai', key: 'uploads/system/a.mp4', fields: { key: 'uploads/system/a.mp4' } });
  vi.mocked(adminVideoWorkApi.canvasCheck).mockResolvedValue({ id: 'p1', name: '源画布', ownerName: '张三', updatedAt: '2026-09-01' });
  vi.mocked(confirmUpload).mockResolvedValue({ fileId: 'm1' });
  vi.mocked(probeVideoFile).mockResolvedValue({ ok: true, durationSec: 12, width: 1920, height: 1080, coverBlob: new Blob(['c'], { type: 'image/jpeg' }) });
  vi.mocked(uploadToPresignedPost).mockResolvedValue(undefined);
  vi.mocked(adminVideoWorkApi.uploadCover).mockResolvedValue({ key: 'uploads/system/frame.jpg' }); // 第十轮自查：probe 默认带 coverBlob → 一切提交用例的 onFinish 都走 uploadCover——无默认值则 await undefined 解构 TypeError → return false → createWork 永不被调、用例超时红（:157 用例自己的 importActual 透传会覆盖此默认值，其 mockReset 后下用例 beforeEach 重设——无冲突）
```

文件头追加 URL 赋桩（jsdom 无 createObjectURL/revokeObjectURL——probe 成功后 `setCoverPreview(URL.createObjectURL(...))` 与 afterClose 的 `URL.revokeObjectURL` 两条路都会 TypeError；**必须赋桩而非 stubGlobal 整体替换**——onFinish 里 parseCanvasRef 会 `new URL(...)`，`{...URL}` 展开 plain object 后 new 直接 "not a constructor"；ExportModal.test.tsx:148-152 赋桩先例）：

```ts
const urlBag = URL as unknown as { createObjectURL: () => string; revokeObjectURL: () => void };
beforeEach(() => {
  urlBag.createObjectURL = vi.fn().mockReturnValue('blob:cover') as any;
  urlBag.revokeObjectURL = vi.fn() as any;
});
```

删除 `:115-133`（旧候选版 create 提交用例——第十轮 A1：其覆盖由本任务新增的「create 提交：上传成品视频+必填」用例整体取代；不删则 Step 3 删 adminApi.listCandidates 后 ：116 是 tsc TS2339 + 运行期 vi.mocked(undefined) TypeError，Step 4 的 PASS 不可达，且 ：122-123 的候选下拉交互已随下拉消失）、`:176-190`（I-1 previewUrl 改写）与 `:194-200`（I-2 pageSize）三条纯候选用例。改写 `:49` 用例：

```ts
it('ModalForm 含成品视频上传区/两开关/标签 tags 模式/封面控件（候选下拉已删）', async () => {
  vi.mocked(adminVideoWorkApi.listCategories).mockResolvedValue([{ id: 'c1', name: 'AI真人影视', sortOrder: 0, active: true }] as any);
  vi.mocked(adminVideoWorkApi.listTags).mockResolvedValue([{ id: 't1', name: '悬疑', sortOrder: 0, active: true }] as any);
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => within(dialog).getByText(/成品视频/));
  expect(within(dialog).getByRole('button', { name: /选择 MP4 文件/ })).toBeInTheDocument();
  expect(within(dialog).queryByText(/候选视频/)).not.toBeInTheDocument(); // 候选下拉已删
  expect(within(dialog).getByText(/允许查看创作过程|查看制作过程/)).toBeInTheDocument();
  expect(within(dialog).getByText(/留空则用视频截帧封面/)).toBeInTheDocument();
});
```

追加核心用例（create 提交 / 门禁 / abort / 前置拦截 / 闸门 / 封面提交时上传）：

```ts
const openCreateAndUpload = async () => {
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  const input = dialog.querySelector('input[accept="video/mp4"]') as HTMLInputElement;
  expect(input.style.display).toBe('none'); // 内联锚点：antd :where 特异性 (0,2,1) 压 Tailwind .hidden——防回退
  fireEvent.change(input, { target: { files: [new File(['v'], 'final.mp4', { type: 'video/mp4' })] } });
  await waitFor(() => expect(within(dialog).getByText(/已上传：final\.mp4/)).toBeInTheDocument());
  return dialog;
};

it('create 提交：上传成品视频+必填 → createWork 载荷含五字段（durationSec 已取整）', async () => {
  vi.mocked(adminVideoWorkApi.createWork).mockResolvedValue({ id: 'w9' } as any);
  const dialog = await openCreateAndUpload();
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: '测试标题' } });
  fireEvent.change(within(dialog).getByLabelText('作者名'), { target: { value: '作者甲' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(adminVideoWorkApi.createWork).toHaveBeenCalledTimes(1));
  expect(adminVideoWorkApi.createWork).toHaveBeenCalledWith(expect.objectContaining({
    title: '测试标题', authorName: '作者甲',
    videoKey: 'uploads/system/a.mp4', videoMediaId: 'm1',
    durationSec: 12, width: 1920, height: 1080,
  }));
});

it('门禁：未上传视频提交 → "请先上传成品视频"，createWork 不被调', async () => {
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: 't' } });
  fireEvent.change(within(dialog).getByLabelText('作者名'), { target: { value: 'a' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(screen.getByText('请先上传成品视频')).toBeInTheDocument());
  expect(adminVideoWorkApi.createWork).not.toHaveBeenCalled();
});

it('afterClose → abort signal + 状态机重置（组件常驻 trigger 宿主不卸载——abort 必须挂 afterClose 非 useEffect cleanup）', async () => {
  let capturedSignal: AbortSignal | undefined;
  // mock 必须"abort 即 reject"（axios 真实行为是 reject CanceledError）——只挂住不监听 abort 的话，
  // 实现的 catch 永不执行、"上传已取消"永不出、waitFor 超时红
  vi.mocked(uploadToPresignedPost).mockImplementation(({ signal }) => new Promise((_, rej) => {
    capturedSignal = signal;
    signal?.addEventListener('abort', () => rej(new DOMException('canceled', 'AbortError')));
  }));
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(dialog.querySelector('input[accept="video/mp4"]') as HTMLInputElement,
    { target: { files: [new File(['v'], 'big.mp4', { type: 'video/mp4' })] } });
  await waitFor(() => expect(capturedSignal).toBeTruthy());
  fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ })); // 关弹层
  await waitFor(() => expect(screen.getByText('上传已取消')).toBeInTheDocument());
  expect(capturedSignal!.aborted).toBe(true); // 真实 abort——白传 1GB 防线
  // 重开弹层不残留上次状态（正面断言）
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog2 = await screen.findByRole('dialog');
  await waitFor(() => expect(within(dialog2).queryByText(/已上传：big\.mp4/)).not.toBeInTheDocument());
});

it('前置拦截：非 mp4 → "仅支持 MP4 格式"，presignVideo 不被调（accept 只是选择器过滤，JS 判断不可省）', async () => {
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(dialog.querySelector('input[accept="video/mp4"]') as HTMLInputElement,
    { target: { files: [new File(['v'], 'a.mov', { type: 'video/quicktime' })] } });
  await waitFor(() => expect(screen.getByText('仅支持 MP4 格式')).toBeInTheDocument());
  expect(adminVideoWorkApi.presignVideo).not.toHaveBeenCalled();
});

it('可播放性闸门：probe decode 失败 → "浏览器无法解码"（服务端无真实 MIME 校验——这是唯一防线）', async () => {
  vi.mocked(probeVideoFile).mockResolvedValue({ ok: false, reason: 'decode' } as any);
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(dialog.querySelector('input[accept="video/mp4"]') as HTMLInputElement,
    { target: { files: [new File(['v'], 'hevc.mp4', { type: 'video/mp4' })] } });
  await waitFor(() => expect(screen.getByText('浏览器无法解码，请导出 H.264 编码 MP4')).toBeInTheDocument());
  expect(adminVideoWorkApi.presignVideo).not.toHaveBeenCalled();
});

it('封面提交时上传：抽帧 blob 在 onFinish 才 uploadCover（孤儿归零）；手选封面后（coverTouched）不再上传 blob', async () => {
  vi.mocked(adminVideoWorkApi.createWork).mockResolvedValue({ id: 'w9' } as any);
  vi.mocked(adminVideoWorkApi.uploadCover).mockResolvedValue({ key: 'uploads/system/frame.jpg' } as any);
  const dialog = await openCreateAndUpload();
  expect(adminVideoWorkApi.uploadCover).not.toHaveBeenCalled(); // probe 后只存内存——不上传
  expect(within(dialog).getByText('将使用视频截帧作封面')).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: 't' } });
  fireEvent.change(within(dialog).getByLabelText('作者名'), { target: { value: 'a' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(adminVideoWorkApi.uploadCover).toHaveBeenCalledTimes(1)); // 提交时一次
  expect(adminVideoWorkApi.uploadCover).toHaveBeenCalledWith(expect.any(File)); // new File([blob],'cover.jpg')
  await waitFor(() => expect(adminVideoWorkApi.createWork).toHaveBeenCalledWith(expect.objectContaining({ coverKey: 'uploads/system/frame.jpg' })));
});
```

（`:135` edit 提交用例归 Task 11；`:157` uploadCover 失败用例**本任务连带改 selector**——视频上传区插在封面之前后，`dialog.querySelector('input[type=file]')` 在 DOM 顺序上先命中视频框、封面用例会拿到"仅支持 MP4 格式"而红：

```ts
  // :166 原选择器收窄（视频 input 在封面之前，裸 input[type=file] 命中视频框）
  await user.upload(dialog.querySelector('input[accept="image/jpeg,image/png,image/webp"]') as HTMLInputElement, new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
```）

- [ ] **Step 2: 跑测试确认红**

`cd D:/flowweb/apps/web && npx vitest run src/pages/admin/pages/__tests__/VideoWorksPage.test.tsx`
Expected: FAIL——上传区不存在 / listCandidates mock 报错

- [ ] **Step 3: 实现 WorkFormModal 改造**

`adminApi.ts`——删除 `listCandidates` 行（:198；Task 8 只增未删，此处与页面调用删除同批——每提交 tsc 自洽）。

`VideoWorksPage.tsx`——文件头 import 调整：

```ts
import { useEffect, useMemo, useRef, useState } from 'react';
import { toFlowaiUrl } from '@/api/videoWorkApi';
import { confirmUpload } from '@/api/storageApi';
import { probeVideoFile } from '../utils/probeVideoFile';
import { uploadToPresignedPost } from '../utils/uploadToPresignedPost';
// CandidateItem 接口整块删除
```

WorkFormModal 组件体替换（保留 `handleUpload` 封面手动上传，追加 `coverTouchedRef.current = true; setCoverPreview(null);` 两行）：

```tsx
function WorkFormModal({ mode, record, onDone, trigger }: {
  mode: 'create' | 'edit'; record?: VideoWorkRow; onDone: () => void; trigger: React.ReactElement;
}) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [coverKey, setCoverKey] = useState<string | undefined>(record?.coverKey ?? undefined);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // —— 成品视频上传状态机（组件常驻 trigger 宿主——重置挂 afterClose，useEffect cleanup 不会执行）——
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [video, setVideo] = useState<{ videoKey: string; videoMediaId: string; fileName: string; fileSize: number; durationSec: number | null; width: number | null; height: number | null } | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // —— 封面（提交时上传：blob 留内存 + objectURL 预览——竞态与孤儿双消除，spec §5.4）——
  const coverBlobRef = useRef<Blob | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const coverTouchedRef = useRef(false);

  const handleUpload = async (file: File) => { // 封面手动上传（现有路径）
    setUploading(true);
    try {
      const { key } = await adminVideoWorkApi.uploadCover(file);
      setCoverKey(key); coverTouchedRef.current = true; // 手选后抽帧 blob 不再使用
      if (coverPreview) URL.revokeObjectURL(coverPreview);
      setCoverPreview(null);
      message.success('已上传，保存后生效');
    } catch (e) { message.error((e as Error).message); }
    finally { setUploading(false); }
  };

  const handleVideoSelected = async (file: File) => {
    // 前置拦截（中文即时提示，别等 presign 400——那是 "Bad Request Exception" 无细节）
    if (file.type !== 'video/mp4') { message.error('仅支持 MP4 格式'); return; }
    if (file.size > 1024 * 1024 * 1024) { message.error('视频不得超过 1GB'); return; }
    const probe = await probeVideoFile(file);
    if (!probe.ok) { message.error('浏览器无法解码，请导出 H.264 编码 MP4'); return; } // 可播放性闸门
    if (probe.coverBlob && !coverTouchedRef.current) {
      coverBlobRef.current = probe.coverBlob;
      setCoverPreview(URL.createObjectURL(probe.coverBlob)); // 只预览，onFinish 才 uploadCover
    }
    setVideoUploading(true); setVideoProgress(0);
    const ac = new AbortController(); abortRef.current = ac; // signal 贯穿 presign/直传/confirm 三段
    try {
      const presign = await adminVideoWorkApi.presignVideo({ fileName: file.name, fileSize: file.size, fileType: file.type }, ac.signal);
      await uploadToPresignedPost({
        url: toFlowaiUrl(presign.uploadUrl), // 同源改写：桶非公开读 + dev CORS
        fields: presign.fields, file,
        onProgress: (p) => setVideoProgress(p), // 包一层钉类型（Dispatch<SetStateAction> 直赋协变侥幸，显式包一层防后续签名漂移）
        signal: ac.signal,
      });
      await confirmUpload({ fileId: presign.fileId, key: presign.key, fileSize: file.size }, ac.signal);
      setVideo({ videoKey: presign.key, videoMediaId: presign.fileId, fileName: file.name, fileSize: file.size,
        durationSec: probe.durationSec, width: probe.width, height: probe.height });
    } catch (e) {
      if (ac.signal.aborted) message.info('上传已取消');
      else message.error(`上传失败：${(e as Error).message}`);
      // 悬挂 pending 说明：直传失败未 confirm 的 Media 行不占配额、永不过期（temp 清理抓不到 uploaded）——已知台账噪音，登记后续清理
    } finally { setVideoUploading(false); abortRef.current = null; }
  };
```

`modalProps.afterClose` 扩展：

```tsx
      modalProps={{
        destroyOnClose: true,
        // WorkFormModal 组件常驻（trigger 挂在行/工具栏；销毁的是弹层内容非本组件），关闭重置全部上传状态；abort 防关弹层白传 1GB
        afterClose: () => {
          setCoverKey(record?.coverKey ?? undefined);
          abortRef.current?.abort();
          setVideo(null); setVideoUploading(false); setVideoProgress(0);
          if (coverPreview) URL.revokeObjectURL(coverPreview);
          setCoverPreview(null); coverBlobRef.current = null; coverTouchedRef.current = false;
        },
      }}
```

`onFinish` 替换（create 门禁改 state；封面提交时上传；payload 从 state 组装五字段）：

```tsx
      onFinish={async (v) => {
        if (mode === 'create' && !video) { message.error('请先上传成品视频'); return false; }
        const { videoKey: _vk, videoMediaId: _vm, ...rest } = v; // edit 剔除（UpdateVideoWorkDto 禁字段——forbidNonWhitelisted 400；换源=重建）。剩余值命名 rest 勿 form——onFinish 内 form 一词保留给表单实例（第九轮 A1：同名影子令 form.getFieldValue 是 undefined、每次提交 TypeError 且浏览器静默）
        let finalCover = coverKey;
        if (mode === 'create' && !coverTouchedRef.current && coverBlobRef.current) {
          try {
            const { key } = await adminVideoWorkApi.uploadCover(new File([coverBlobRef.current], 'cover.jpg', { type: 'image/jpeg' }));
            finalCover = key;
          } catch (e) { message.error(`封面上传失败：${(e as Error).message}`); return false; } // 失败阻断——视频已 confirm 无引用属 §9② 清理范围，非遗漏
        }
        try {
          if (mode === 'create') {
            await adminVideoWorkApi.createWork({
              ...rest,
              videoKey: video!.videoKey, videoMediaId: video!.videoMediaId,
              durationSec: video!.durationSec, width: video!.width, height: video!.height,
              coverKey: finalCover ?? null,
            });
          } else if (record) {
            await adminVideoWorkApi.updateWork(record.id, { ...rest, coverKey: finalCover ?? null });
          }
          message.success('已保存'); onDone(); return true;
        } catch (e) { message.error((e as Error).message); return false; }
      }}
```

候选 `ProFormSelect`（原 :210-251）整块删除，替换为上传区：

```tsx
      {mode === 'create' && (
        <div className="mb-4">
          <div className="mb-1 text-sm">成品视频（上传后不可更换，更换需删除作品重建——会丢观看/喜欢数）</div>
          {/* 内联 display:none：antd :where().ant-form input[type=file] 特异性 (0,2,1) 压 Tailwind .hidden 致原生控件暴露 */}
          <input ref={videoInputRef} type="file" accept="video/mp4" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleVideoSelected(f); e.target.value = ''; /* 复位：连续选同一文件 */ }} />
          <Button onClick={() => videoInputRef.current?.click()} loading={videoUploading}>选择 MP4 文件（≤1GB）</Button>
          {videoUploading && <span className="ml-2 text-xs text-gray-500">直传中 {videoProgress}%</span>}
          {video && !videoUploading && (
            <div className="mt-1 text-xs text-gray-600">
              已上传：{video.fileName}（{(video.fileSize / 1024 / 1024).toFixed(1)}MB{video.durationSec != null ? ` / ${video.durationSec}s` : ''}{video.width != null ? ` / ${video.width}×${video.height}` : ''}）
            </div>
          )}
        </div>
      )}
```

封面区块文案与预览替换：

```tsx
      <div className="mb-4">
        <div className="mb-1 text-sm">封面（留空则用视频截帧封面）</div>
        <Button onClick={() => fileRef.current?.click()} loading={uploading}>选择文件</Button>
        {coverPreview && <img src={coverPreview} alt="封面预览" style={{ height: 48 }} className="ml-2 inline-block align-middle" />}
        <span className="ml-2 text-xs text-gray-400">{coverKey ? `已上传：${coverKey}` : coverPreview ? '将使用视频截帧作封面' : '未上传'}</span>
      </div>
```

- [ ] **Step 4: 跑测试确认绿 + 提交**

`cd D:/flowweb/apps/web && npx vitest run src/pages/admin/pages/__tests__/VideoWorksPage.test.tsx`
Expected: PASS（`:63` 开关联动用例不受影响——两开关 disabled 逻辑本任务未动，edit initialValues 仍带画布值）

```bash
cd D:/flowweb && git add apps/web/src/pages/admin/pages/VideoWorksPage.tsx apps/web/src/pages/admin/pages/__tests__/VideoWorksPage.test.tsx apps/web/src/api/adminApi.ts
git commit -m "feat(admin): WorkFormModal 成品视频上传流水线——前置拦截/probe 闸门/直传进度/abort 挂 afterClose/封面提交时上传/门禁改 state；删 adminApi.listCandidates（Task 8 延后至此与页面同批）"
```

---

## Task 11: 画布输入状态机 + 开关 verified 驱动 + edit 只读信息条

**Files:**
- Modify: `apps/web/src/pages/admin/pages/VideoWorksPage.tsx`（canvasProjectId 注册字段 + canvasVerified 状态 + edit 信息条 + VideoWorkRow 加 coverUrl）
- Test: `apps/web/src/pages/admin/pages/__tests__/VideoWorksPage.test.tsx`（改写 :63/:135 + 画布状态机新用例）

- [ ] **Step 1: 写失败测试**

```ts
const mockWorkRow = (over: Record<string, unknown> = {}) => ({
  id: 'w1', title: '末班地铁', description: null, authorName: '作者甲', categoryId: null,
  videoKey: 'videos/old.mp4', videoMediaId: 'm9', coverKey: null, coverUrl: null, canvasProjectId: 'p1',
  durationSec: 10, width: 1920, height: 1080, viewCount: 1, likeCount: 2, tags: [],
  sortOrder: 0, status: 'DRAFT', allowViewProcess: false, allowClone: false,
  updatedAt: '2026-09-01T00:00:00Z', ...over,
});

it('edit：只读信息条（时长/分辨率/封面缩略图）且无上传控件；改标题保存 payload 无 videoKey/videoMediaId、未动画布则 payload 省略 canvasProjectId（后端不动已存值）', async () => {
  vi.mocked(adminVideoWorkApi.listWorks).mockResolvedValue({ items: [mockWorkRow({ coverUrl: 'http://127.0.0.1:9000/flowai/uploads/system/c.jpg?X-Amz-Signature=s' })], total: 1 } as any);
  vi.mocked(adminVideoWorkApi.updateWork).mockResolvedValue({ id: 'w1' } as any);
  vi.mocked(adminVideoWorkApi.canvasCheck).mockResolvedValue({ id: 'p1', name: '源画布', ownerName: '张三', updatedAt: '2026-09-01' } as any);
  renderWithProviders(<VideoWorksPage />);
  await waitFor(() => screen.getByText('末班地铁'));
  expect(adminVideoWorkApi.canvasCheck).not.toHaveBeenCalled(); // 初始校验挂 onOpenChange——WorkFormModal 是每行一个的常驻 trigger 宿主组件（弹层内容才 destroyOnClose），useEffect([]) 会在列表渲染时就打 N 个请求
  fireEvent.click(screen.getByText('编辑'));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/当前视频：10s \/ 1920×1080/)).toBeInTheDocument();  // 只读信息条
  expect(within(dialog).getByLabelText('源画布（可选）')).toHaveValue('p1');          // initialValues 确实播种到字段——门禁"文本===初值"判据的前提钉死（initialValues 没落字段这里立刻红）
  expect(within(dialog).queryByRole('button', { name: /选择 MP4 文件/ })).not.toBeInTheDocument(); // edit 无上传控件
  await waitFor(() => expect(within(dialog).getByText(/画布：源画布（作者 张三）/)).toBeInTheDocument()); // 打开即初始校验回显
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: '早班高铁' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(adminVideoWorkApi.updateWork).toHaveBeenCalledTimes(1));
  const payload = vi.mocked(adminVideoWorkApi.updateWork).mock.calls[0][1] as Record<string, unknown>;
  expect(payload).not.toHaveProperty('videoKey');
  expect(payload).not.toHaveProperty('videoMediaId');
  expect(payload.title).toBe('早班高铁');
  expect(payload).not.toHaveProperty('canvasProjectId'); // 未动画布 → 省略（后端 dto-only：undefined 不动已存值）
});

it('edit + 死画布（canvasCheck 404）+ 未动画布文本 → 可保存（黄字警告不硬拦——与后端 dto-only 口径一致，防"连改标题都存不了"陷阱）；两开关禁用', async () => {
  vi.mocked(adminVideoWorkApi.listWorks).mockResolvedValue({ items: [mockWorkRow({ canvasProjectId: 'p-dead', allowViewProcess: false, allowClone: false })], total: 1 } as any);
  vi.mocked(adminVideoWorkApi.updateWork).mockResolvedValue({ id: 'w1' } as any);
  vi.mocked(adminVideoWorkApi.canvasCheck).mockRejectedValue(new Error('画布不存在') as any);
  renderWithProviders(<VideoWorksPage />);
  await waitFor(() => screen.getByText('末班地铁'));
  fireEvent.click(screen.getByText('编辑'));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(within(dialog).getByText('源画布已删除，保存将保留原关联')).toBeInTheDocument()); // 黄字警告非红字硬拦
  await waitFor(() => expect(within(dialog).getByRole('switch', { name: /允许查看创作过程|查看制作过程/ })).toBeDisabled()); // verified=null → 禁用
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: 'x' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(adminVideoWorkApi.updateWork).toHaveBeenCalledTimes(1)); // 未动文本 → 放行
  const payload = vi.mocked(adminVideoWorkApi.updateWork).mock.calls[0][1] as Record<string, unknown>;
  expect(payload).not.toHaveProperty('canvasProjectId'); // 省略——后端不动已存值，不触发画布校验
});

it('画布状态机：粘贴 URL → blur 校验回显 → payload 带解析后 ID（C-1 家族回归：注册字段 onFinish 现算）', async () => {
  vi.mocked(adminVideoWorkApi.createWork).mockResolvedValue({ id: 'w9' } as any);
  vi.mocked(adminVideoWorkApi.canvasCheck).mockResolvedValue({ id: 'cparsed', name: '我的画布', ownerName: null, updatedAt: '2026-09-01' } as any);
  const dialog = await openCreateAndUpload(); // Task 10 定义的 helper
  const canvasInput = within(dialog).getByLabelText('源画布（可选）');
  fireEvent.change(canvasInput, { target: { value: 'http://localhost:5173/canvas?projectId=cparsed' } });
  fireEvent.blur(canvasInput);
  await waitFor(() => expect(within(dialog).getByText('画布：我的画布（团队画布）')).toBeInTheDocument()); // ownerName null → 团队画布
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: 't' } });
  fireEvent.change(within(dialog).getByLabelText('作者名'), { target: { value: 'a' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(adminVideoWorkApi.createWork).toHaveBeenCalledWith(expect.objectContaining({ canvasProjectId: 'cparsed' })));
});

it('画布状态机：校验通过后改动文本 → 提交阻止"画布已修改，请重新校验"+两开关回禁用（值不动——第十轮收窄：churn 不落 false，B2 防线由门禁承担；B3）', async () => {
  vi.mocked(adminVideoWorkApi.canvasCheck).mockResolvedValue({ id: 'p1', name: 'n', ownerName: 'o', updatedAt: '2026-09-01' } as any);
  const dialog = await openCreateAndUpload();
  const canvasInput = within(dialog).getByLabelText('源画布（可选）');
  fireEvent.change(canvasInput, { target: { value: 'p1' } });
  fireEvent.blur(canvasInput);
  await waitFor(() => expect(within(dialog).getByText(/画布：n/)).toBeInTheDocument());
  const viewSwitch = within(dialog).getByRole('switch', { name: /允许查看创作过程|查看制作过程/ });
  await waitFor(() => expect(viewSwitch).toBeEnabled()); // 包 waitFor：enabled 依赖 canvasCheck resolve 后的 setState
  fireEvent.click(viewSwitch); // 开（create 初值 false）——为 B2 断言铺状态
  expect(viewSwitch).toBeChecked();
  fireEvent.change(canvasInput, { target: { value: 'p1-changed' } }); // 校验后改动 → verified 失效
  await waitFor(() => expect(viewSwitch).toBeDisabled()); // 开关回禁用
  expect(viewSwitch).toBeChecked(); // 第十轮收窄：文本 churn **不动开关值**（edit 场景敲错字又改回原文若落 false 会静默关掉存量开关）——本路径的 400 防线由门禁拦截承担（下方 createWork not called）；落 false 只发生在 checkCanvas 空文本/catch 分支（见清空用例）
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: 't' } });
  fireEvent.change(within(dialog).getByLabelText('作者名'), { target: { value: 'a' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(screen.getByText('画布已修改，请重新校验')).toBeInTheDocument());
  expect(adminVideoWorkApi.createWork).not.toHaveBeenCalled();
});

it('画布状态机：校验通过→开开关→清空文本 blur → 开关值落 false（B2 收窄落点：清空=放弃画布，防 true 残留撞 400）+ 提交成功（create 清空回初值 → untouched → payload 省略 canvasProjectId）', async () => {
  vi.mocked(adminVideoWorkApi.canvasCheck).mockResolvedValue({ id: 'p1', name: 'n', ownerName: 'o', updatedAt: '2026-09-01' } as any);
  vi.mocked(adminVideoWorkApi.createWork).mockResolvedValue({ id: 'w9' } as any);
  const dialog = await openCreateAndUpload();
  const canvasInput = within(dialog).getByLabelText('源画布（可选）');
  fireEvent.change(canvasInput, { target: { value: 'p1' } });
  fireEvent.blur(canvasInput);
  const viewSwitch = within(dialog).getByRole('switch', { name: /允许查看创作过程|查看制作过程/ });
  await waitFor(() => expect(viewSwitch).toBeEnabled());
  fireEvent.click(viewSwitch); // 开
  expect(viewSwitch).toBeChecked();
  fireEvent.change(canvasInput, { target: { value: '' } }); // 清空
  fireEvent.blur(canvasInput); // 真实浏览器点确定前输入框必先 blur（jsdom fireEvent.click 不自动 blur——显式化）
  await waitFor(() => expect(viewSwitch).toBeDisabled());
  expect(viewSwitch).not.toBeChecked(); // checkCanvas 空文本分支落 false——canvasProjectId 省略落 null 后 allowViewProcess:true 必撞 assertProcessFlags 400
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: 't' } });
  fireEvent.change(within(dialog).getByLabelText('作者名'), { target: { value: 'a' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(adminVideoWorkApi.createWork).toHaveBeenCalledTimes(1));
  const payload = vi.mocked(adminVideoWorkApi.createWork).mock.calls[0][0] as Record<string, unknown>;
  expect(payload.allowViewProcess).toBe(false);
  expect(payload).not.toHaveProperty('canvasProjectId'); // '' === create 初值 '' → untouched → 省略（后端落 null）
});

it('画布状态机：校验通过→改出去→改回原值（未 blur）→ 等价放行不弹"已修改"（第十轮 C1：verifiedRef.id 与当前解析一致即视同已验证——否则文本与已验证值相同的提交也遭拦）', async () => {
  vi.mocked(adminVideoWorkApi.canvasCheck).mockResolvedValue({ id: 'p1', name: 'n', ownerName: 'o', updatedAt: '2026-09-01' } as any);
  vi.mocked(adminVideoWorkApi.createWork).mockResolvedValue({ id: 'w9' } as any);
  const dialog = await openCreateAndUpload();
  const canvasInput = within(dialog).getByLabelText('源画布（可选）');
  fireEvent.change(canvasInput, { target: { value: 'p1' } });
  fireEvent.blur(canvasInput);
  await waitFor(() => expect(within(dialog).getByText(/画布：n/)).toBeInTheDocument());
  fireEvent.change(canvasInput, { target: { value: 'x' } });  // 改出去
  fireEvent.change(canvasInput, { target: { value: 'p1' } }); // 改回原值（未 blur——canvasVerified 已清、verifiedRef 仍在）
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: 't' } });
  fireEvent.change(within(dialog).getByLabelText('作者名'), { target: { value: 'a' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(adminVideoWorkApi.createWork).toHaveBeenCalledWith(expect.objectContaining({ canvasProjectId: 'p1' })); // 等价放行——修复前弹"画布已修改，请重新校验"、createWork 不被调
});

it('画布 404 → 红字"画布不存在"；未校验通过（乱码未 blur）提交 → 阻止', async () => {
  vi.mocked(adminVideoWorkApi.canvasCheck).mockRejectedValue(new Error('画布不存在') as any);
  const dialog = await openCreateAndUpload();
  const canvasInput = within(dialog).getByLabelText('源画布（可选）');
  fireEvent.change(canvasInput, { target: { value: 'garbage' } });
  fireEvent.blur(canvasInput);
  await waitFor(() => expect(within(dialog).getByText('画布不存在')).toBeInTheDocument());
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: 't' } });
  fireEvent.change(within(dialog).getByLabelText('作者名'), { target: { value: 'a' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(adminVideoWorkApi.createWork).not.toHaveBeenCalled());
});

it('afterClose 画布状态重置：校验通过→取消→重开，绿字消失+两开关禁用（第九轮必修2：canvasVerified 不重置则重开"假画布"——resetFields 已清字段、verified 却残留 → 两开关可点 → 提交 payload 无 canvasProjectId 撞 assertProcessFlags 400，绿字在骗人）', async () => {
  vi.mocked(adminVideoWorkApi.canvasCheck).mockResolvedValue({ id: 'p1', name: '源画布', ownerName: '张三', updatedAt: '2026-09-01' } as any);
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  const dialog = await screen.findByRole('dialog');
  const canvasInput = within(dialog).getByLabelText('源画布（可选）');
  fireEvent.change(canvasInput, { target: { value: 'p1' } });
  fireEvent.blur(canvasInput);
  await waitFor(() => expect(within(dialog).getByText(/画布：源画布/)).toBeInTheDocument()); // 先证存在（防 not 断言空转）
  fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
  fireEvent.click(screen.getByRole('button', { name: /新增/ }));
  await screen.findByRole('dialog');
  await waitFor(() => expect(screen.queryByText(/画布：源画布/)).not.toBeInTheDocument()); // 绿字不残留
  await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('switch', { name: /允许查看创作过程|查看制作过程/ })).toBeDisabled()); // verified 已清——修复前此断言红（残留 verified → enabled）
});
```

（`:63` 开关联动用例同批小改——第九轮核实：verified 驱动下**两条断言都会失真**（:75 同步 `toBeEnabled()` 此刻 canvasCheck 未 resolve → canvasVerified=null → disabled → 红；:76 click 打在禁用开关上是 no-op；:77 `toBeDisabled()` 变**假绿**——没点成功也自然 disabled，用例从此不验联动只验"开关是灰的"，正是 :63 自己第九轮修正注释骂过的同类事故第二次）。三处一起治，click 前加"当前是开"正向断言，把"click 生效"从推断变成断言：

```ts
  await waitFor(() => expect(screen.getByRole('switch', { name: /允许克隆/ }) as HTMLButtonElement).toBeEnabled()); // 包 waitFor：enabled 依赖 canvasCheck resolve 后 canvasVerified 落定（beforeEach 默认值已供 resolve）
  const viewSwitch = screen.getByRole('switch', { name: /允许查看创作过程|查看制作过程/ });
  expect(viewSwitch).toBeChecked(); // 前置：fixture allowViewProcess=true → 初始开（防 click 打在禁用开关上 no-op、:77 沦为假绿）
  fireEvent.click(viewSwitch); // 关闭
  await waitFor(() => expect(screen.getByRole('switch', { name: /允许克隆/ }) as HTMLButtonElement).toBeDisabled()); // 联动禁用同样包 waitFor（禁用依赖 setFieldsValue 重渲染）
```
）

- [ ] **Step 2: 跑测试确认红**

`cd D:/flowweb/apps/web && npx vitest run src/pages/admin/pages/__tests__/VideoWorksPage.test.tsx`
Expected: FAIL——源画布输入框不存在

- [ ] **Step 3: 实现**

`VideoWorkRow` 接口追加 `coverUrl?: string | null;`（Task 3 listAllWorks 已注入）。

WorkFormModal 追加状态与初始校验：

```tsx
  // —— 源画布（可选）：输入即注册字段（防 C-1），校验结果只做回显+门禁，不写回表单值 ——
  const [canvasVerified, setCanvasVerified] = useState<{ id: string; name: string; ownerName: string | null } | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  // verifiedRef（第九轮必修1）：onChange 清 state 但**不清它**——门禁文案"画布已修改"的唯一判据。
  // 若判 canvasVerified，"校验通过→改文本"时它已被 onChange 清 null，三元式永远落到"画布不存在"（钦定文案成死分支）。
  // text 记校验时原始文本：粘 URL 直接提交时校验还在飞（ref=null）会误弹"画布不存在"，已知误导、登记不处理（第九轮小项3）。
  const verifiedRef = useRef<{ id: string; text: string } | null>(null);
  // 序号守卫（第九轮必修2）：canvasCheck 无 signal，关弹层/重新输入后飞行中的 resolve 落定会把已重置状态写回来
  const canvasCheckSeq = useRef(0);
  // 渲染期"未改动"判定（红/黄互斥的事实源）——与 onFinish 用同一判据：文本 === record 初值。
  // Form.useWatch 本仓首次使用（rc-field-form 2.7.1 传 form 实例路径已验：useWatch.js:46 _init 校验 + :81 effect 主动读初值）——
  // 渲染期读值与 onFinish 同判据必须它；ProFormDependency 的 render-prop 拿不到 onFinish 闭包，替代不了
  const canvasTextWatch = Form.useWatch('canvasProjectId', form) ?? '';
  const initialCanvasText = mode === 'edit' && record?.canvasProjectId ? record.canvasProjectId : '';
  const canvasUntouched = String(canvasTextWatch).trim() === initialCanvasText.trim();

  const checkCanvas = async (text: string) => {
    const id = parseCanvasRef(text);
    if (!id) {
      // 空文本也作废在飞校验（第十轮 B1：否则"粘 p1→blur 在飞→清空→再 blur"后旧请求 resolve 会把已清空表单写回"已验证"）
      canvasCheckSeq.current++;
      verifiedRef.current = null;
      setCanvasVerified(null); setCanvasError(null);
      form.setFieldsValue({ allowViewProcess: false, allowClone: false }); // 收窄落 false 落点①：清空=放弃画布，防 true 残留撞 400
      return;
    }
    const seq = ++canvasCheckSeq.current;
    try {
      const c = await adminVideoWorkApi.canvasCheck(id);
      if (seq !== canvasCheckSeq.current) return; // 过期校验（已关弹层/已重新输入）——勿写回
      verifiedRef.current = { id: c.id, text };
      setCanvasVerified({ id: c.id, name: c.name, ownerName: c.ownerName });
      setCanvasError(null);
    } catch {
      if (seq !== canvasCheckSeq.current) return;
      verifiedRef.current = null;
      setCanvasVerified(null); setCanvasError('画布不存在');
      form.setFieldsValue({ allowViewProcess: false, allowClone: false }); // 收窄落 false 落点②：校验失败同理
    }
  };
```

初始校验挂 **ModalForm 顶层 `onOpenChange`** prop（非 modalProps.afterOpenChange——那是 rc-motion 动效回调，jsdom 依赖降级路径。onOpenChange 的依据是 pro-form 源码而非仓内先例：@ant-design/pro-form@2.32.0 `es/layouts/ModalForm/index.d.ts:29` 顶层 prop + `index.js:43-49` useMergedState 直连零 motion 依赖——**仓内 10 处 onOpenChange 全是 Popover/Dropdown、ModalForm 零先例**，后人勿按"先例"去找。另注意它在触发器 click 内同步触发、弹层内容尚未挂载——回调内勿读表单字段（checkCanvas 只用 record 值，安全）。勿用 `useEffect(..., [])`：WorkFormModal 是每行一个的常驻 trigger 宿主组件，mount effect 会在列表渲染时对每行各打一次 canvas-check）：

```tsx
    <ModalForm
      onOpenChange={(open) => {
        if (!open) return;
        if (mode === 'edit' && record?.canvasProjectId) void checkCanvas(record.canvasProjectId); // 打开即回显
      }}
      ...
```

（import 追加 `import { parseCanvasRef } from '../utils/parseCanvasRef';`）

Task 10 的 `modalProps.afterClose` 块末尾追加（canvas 状态是 Task 11 新增组件状态，必须同步进重置清单——第九轮必修2：不重置则重开弹层出现"假画布"——resetFields 已清字段、canvasVerified 却残留 → 两开关可点 → 提交 payload 无 canvasProjectId 撞 assertProcessFlags 400，绿字在骗人；对应 Step 1 新增的 afterClose 重置用例）：

```tsx
          setCanvasVerified(null); setCanvasError(null); verifiedRef.current = null;
          canvasCheckSeq.current++; // 作废飞行中的 canvasCheck（其 resolve 被 seq 守卫拦下，不写回已重置状态）
```

表单：候选删除位置之后插入画布输入 + 回显（在上传区之后）：

```tsx
      <ProFormText name="canvasProjectId" label="源画布（可选）" placeholder="粘贴画布 ID 或画布页 URL"
        fieldProps={{
          onBlur: (e) => void checkCanvas(e.target.value),
          // 文本改动即失效（state 清、verifiedRef 不清——必修1 的文案判据）：
          // 落 false **不在此处**（第十轮收窄）——edit 场景敲错字又改回原文会静默关掉存量"创作过程/克隆"开关，
          // 超出防 400 目标；落 false 只在 checkCanvas 空文本/catch 两分支（真实浏览器点确定前输入框必先 blur，
          // jsdom fireEvent.click 不自动 blur——测试显式 fireEvent.blur）。B2 两条 400 路径（清空/校验失败）照堵，
          // "改文本未重校验"路径由 onFinish 门禁拦截承担。
          // 此处 form 是组件作用域的表单实例（无 A1 影子问题——影子只在 onFinish 解构之后）
          onChange: (e) => {
            canvasCheckSeq.current++; // 文本失效即作废在飞校验（第十轮 B1 三路之一：onChange/空文本/afterClose）
            setCanvasVerified(null); setCanvasError(null);
          },
        }}
      />
      {canvasVerified && (
        <div className="mb-2 -mt-2 text-xs text-green-600">
          {/* ownerName null 分支防御性——schema.prisma:169 CanvasProject.teamId 必填 + Team.owner 必填，实际不可达（测试 mock 才走到，勿当 nullable 契约） */}
          画布：{canvasVerified.name}（{canvasVerified.ownerName ? `作者 ${canvasVerified.ownerName}` : '团队画布'}）
        </div>
      )}
      {canvasError && <div className="mb-2 -mt-2 text-xs text-red-500">{canvasError}</div>}
```

两开关联动改 **canvasVerified 驱动**（原 ProFormDependency 依赖字段文本——现在是原始文本，非空乱码也会让开关可点）：

```tsx
      <ProFormDependency name={['allowViewProcess']}>{/* canvasProjectId 已非依赖（noCanvas 由 canvasVerified 驱动）——留着会误导后人以为门禁仍是文本非空驱动 */}
        {({ allowViewProcess }) => {
          const noCanvas = !canvasVerified; // B3：由"校验通过"驱动，非文本非空——防乱码可点、清空残留 true 撞 assertProcessFlags 400
          return (
            <>
              <ProFormSwitch
                name="allowViewProcess" label="允许查看创作过程"
                tooltip={noCanvas ? '需先校验通过源画布' : '开启后播放页可查看创作过程快照'}
                disabled={noCanvas}
                fieldProps={{
                  'aria-label': '允许查看创作过程',
                  onChange: (checked: boolean) => {
                    if (!checked) form.setFieldsValue({ allowClone: false }); // 强制关（后端 400 校验的前端半边）
                  },
                } as any}
              />
              <ProFormSwitch
                name="allowClone" label="允许克隆"
                tooltip={noCanvas ? '需先校验通过源画布' : !allowViewProcess ? '需先开启「允许查看创作过程」' : '开启后播放页可一键克隆到我的画布'}
                disabled={noCanvas || !allowViewProcess}
                fieldProps={{ 'aria-label': '允许克隆' } as any}
              />
            </>
          );
        }}
      </ProFormDependency>
```

`onFinish` 开头追加画布门禁 + payload 组装（create 与 edit 共用）。**门禁与后端 dto-only 口径对齐**：文本与初始值相同（用户未动）→ 放行且 payload **省略** canvasProjectId（后端不动已存值——死画布存量作品也能改标题保存）；被改动且未重新校验 → 拦截。

**先改 Task 10 引入的解构行**（canvasProjectId 已是注册字段，`...rest` 会原样带出原始文本，把"未改动则省略"抵消掉——not.toHaveProperty 用例必红）：

```tsx
        const { videoKey: _vk, videoMediaId: _vm, canvasProjectId: _cp, ...rest } = v; // 画布字段从 rest 剥离——payload 是否带它由下方门禁决定；剩余值命名 rest（同 Task 10，onFinish 内 form 保留给表单实例）
```

门禁（onFinish 顶部、解构行之后；`untouched`/`parsedCanvasId` 与 payload 组装在同一直属作用域，中间隔着封面上传的 await——const 已在 await 前求值，勿挪进 try 内新作用域）：

```tsx
        const canvasText = String(_cp ?? '').trim(); // 第九轮 A1：读解构出的 _cp——此处若写 form.getFieldValue，form 是上面的剩余值对象（影子），getFieldValue 是 undefined → 每次提交 TypeError、createWork 永不被调且浏览器静默
        const parsedCanvasId = parseCanvasRef(canvasText);
        const untouched = canvasText === initialCanvasText.trim(); // 与渲染期 canvasUntouched 同判据（文本===record 初值），两处勿各算各的
        if (!untouched && canvasText && (!canvasVerified || canvasVerified.id !== parsedCanvasId)) {
          // 等价放行（第十轮 C1）：改出去又改回已验证文本（未 blur）——verifiedRef.id 与当前解析一致即视同已验证
          if (verifiedRef.current?.id !== parsedCanvasId) {
            // 文案判据是 verifiedRef（必修1）——canvasVerified 已被 onChange 清 null，判它则"画布已修改"永不可达
            message.error(verifiedRef.current ? '画布已修改，请重新校验' : (canvasError ?? '画布不存在，请重新校验'));
            return false;
          }
        }
```

payload 组装（createWork 与 updateWork 的 spread 中显式给）：

```tsx
              ...(untouched ? {} : { canvasProjectId: parsedCanvasId ?? null }), // 未动 → 省略（后端不动已存值）；动了 → 解析值（空文本=显式清除 null）
```

红/黄回显互斥（同一 canvasError 下不能同屏"画布不存在"+"源画布已删除"）——替换 Task 11 先前的红字块：

```tsx
      {canvasError && !canvasUntouched && <div className="mb-2 -mt-2 text-xs text-red-500">画布不存在</div>}
      {canvasError && canvasUntouched && mode === 'edit' && record?.canvasProjectId && (
        <div className="mb-2 -mt-2 text-xs text-amber-500">源画布已删除，保存将保留原关联</div>
      )}
```

edit 只读信息条（上传区位置、`mode === 'edit'` 分支）：

```tsx
      {mode === 'edit' && record && (
        <div className="mb-4 rounded bg-gray-50 p-2 text-xs text-gray-600">
          <div>当前视频：{record.durationSec != null ? `${record.durationSec}s` : '时长未知'}{record.width != null ? ` / ${record.width}×${record.height}` : ''}（上传后不可更换，更换需删除作品重建——会丢观看/喜欢数）</div>
          {/* 封面缩略图走 listAllWorks 的 presign coverUrl（裸 /flowai/+coverKey 生产 403——桶非公开读）；
              信息条只读 VideoWork 行字段，不解析 videoKey（旧域 key 可能指向已删对象） */}
          {record.coverUrl
            ? <img src={toFlowaiUrl(record.coverUrl)} alt="当前封面" style={{ height: 48, marginTop: 4 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            : <div style={{ marginTop: 4 }}>无封面</div>}
        </div>
      )}
```

（同时删除原 ProFormDependency 内两处 tooltip 的"需先选择有画布的候选视频"文案——已被上文新写法取代。）

- [ ] **Step 4: 跑测试确认绿 + 全量 + 提交**

`cd D:/flowweb/apps/web && npm test`
Expected: PASS（全部用例——`:63` 在 Task 10 未被 skip，本任务的 verified 驱动改造后其 mock 已含 canvasCheck resolve）

```bash
cd D:/flowweb && git add apps/web/src/pages/admin/pages/VideoWorksPage.tsx apps/web/src/pages/admin/pages/__tests__/VideoWorksPage.test.tsx
git commit -m "feat(admin): 源画布输入状态机（注册字段+canvasCheck 回显+改动失效+开关 verified 驱动+空文本/校验失败落 false 收窄）+verifiedRef 文案判据+等价文本放行+afterClose 画布重置+seq 三路守卫+edit 只读信息条（presign 封面缩略图）"
```

---

## Task 12: 全量验证 + 浏览器验收 + 上线顺序确认

- [ ] **Step 1: 全仓测试与类型检查**

```bash
cd D:/flowweb/apps/api && npm test
cd D:/flowweb/apps/web && npm test
cd D:/flowweb/apps/web && npx tsc -b --noEmit
```
Expected: 全绿 + 零 TS 错误。**web 的 npm test 只是 `vitest run` 不含 tsc**（类型检查在 build 里——apps/web/package.json:8-9），本改动碰严格模式的面不小（VideoWorkRow.coverUrl、onProgress 签名、updateWork payload 的 canvasProjectId: string | null），必须显式跑。重点核对清单：storage 两个 spec（D1 victim 断言）、generated-media spec（两参断言）、video-work service spec（F2 negative/文案断言/removeWork 三态）、controller spec（staticRoutes 最终数组）、seed spec（1TB）、VideoWorksPage 全部用例。

- [ ] **Step 2: 浏览器验收（spec §7.3）**

启动本地栈（Postgres/Redis/MinIO/api/web，项目启动流程见 memory）。管理后台 `/admin/content/video-works`：

1. 平台限额生效：seed spec 已自动化（1TB）；未 seed 的库必挂（6GiB 回落 → FK 500 → confirm 403）
2. 真实 MP4（<1GB）上传 → 进度百分比 → 建作品（选画布：粘贴画布 URL 验证回显）→ 发布 → 前台播放 + 制作过程 + 克隆全链路
3. HEVC/.mov 文件 → 闸门文案"浏览器无法解码"
4. >1GB 文件 → 前置拦截"视频不得超过 1GB"
5. Network 面板：上传请求 URL 以 `/flowai/` 开头且 200/204（toFlowaiUrl 改写生效证据）；confirm 请求打到 `/api/storage/confirm`（全路径——仓内有两个 /confirm 路由）
6. 删除一个新建作品 → psql 查 Media 行软删（Prisma 字段 deletedAt，schema 无 @map 时 DB 列同名——psql 需双引号 `"deletedAt"`）+ MinIO 对象已删（或登记清理）
7. 关弹层中断上传 → "上传已取消"提示 + 无残留状态

- [ ] **Step 3: 上线顺序提醒（写给部署者，spec §8）**

```
1. 本设计无 Prisma schema 变更（无需 migrate）
2. 部署代码后：cd apps/api && npx prisma db seed（平台团队五行；deploy_api 模式不带 prisma/——须先补传 seed.ts，seed 依赖 devDependency tsx）
3. 重启 api
4. Nginx 前置三件套：client_max_body_size > 1024m（multipart 编码膨胀，恰 1024m 仍 413）；
   proxy_read_timeout/client_body_timeout 放宽（慢网 1GB 默认 60s → 504）；
   proxy_request_buffering 保持 on（勿改 off——chunked 会让 S3 presigned POST 被拒、全站上传挂），确认 client_body_temp_path 磁盘余量
```

- [ ] **Step 4: 最终提交（若有验收修补）+ 完成**

```bash
cd D:/flowweb && git status && git log --oneline -12
```
Expected: 12 个任务提交全部在列，工作区干净（docs 除外）。

---

## 自审记录（writing-plans Self-Review）

1. **Spec 覆盖**：§4.1 seed→Task 6；§4.2 presign-video→Task 2；§4.3 D1→Task 1；§4.4 canvas-check/findCanvasRef/删候选→Task 3；§4.5 F2+dto-only→Task 4；§4.6 清理→Task 5；§5.1 两模块→Task 7/8；§5.2/5.4/5.6 表单→Task 10；§5.3/5.5→Task 11；§7 全部测试→各任务 Step 1；§8 上线→Task 12。无缺口。
2. **占位符扫描**：无 TBD/TODO；所有代码步骤给完整代码。
3. **类型一致性**：`probeVideoFile` 返回类型 Task 7 定义、Task 10 mock 消费一致；`PLATFORM_TEAM_ID/PLATFORM_OWNER_ID` Task 2 定义、Task 4/6 消费一致；`findCanvasRef` Task 3 定义、Task 4 消费一致；`openCreateAndUpload` helper Task 10 定义、Task 11 消费一致。



