# 视频剪辑器 Plan 1/4：开工前置 + 后端基础设施 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地视频剪辑器的全部开工前置（vendor 参考库/新依赖/soundtouch Go-No-Go Spike/Prisma migration）与后端基础设施（VideoProject CRUD/A1 doc 原语/执行白名单/generated 产物登记/regenerate/media batch）。

**Architecture:** spec v3.6（docs/superpowers/specs/video-editor.md）附录 B 阶段 0+0.5+1。后端新增 `modules/video-project/` 模块（自挂 ValidationPipe——main.ts 无全局 pipe），扩展 collab-document（insertNode/removeNode 与 ydocBuilder.fillDoc 逐键同构）与 execution（isExecutableNode 白名单前置 emitNodeStatus）。产物登记复用 pending→confirm 状态机语义但方法自建（presigned POST 直传，statObject 实际大小落库，勿误调 confirmUpload 的 ±1024 校验）。

**Tech Stack:** NestJS + Prisma + BullMQ（既有）；新增依赖 mediabunny@^1.56.1、@mediabunny/aac-encoder@^1.56.1（前端装，本 plan 仅登记）、soundtouchjs@0.3.0（Spike 验证）。

**测试命令：** `pnpm -C apps/api test`（tsc --noEmit + vitest run）；单文件 `pnpm -C apps/api exec vitest run src/modules/video-project/xxx.spec.ts`

---

### Task 1: vendor opencut-classic 参考快照入仓（开工第一前置）

**Files:**
- Create: `docs/vendor/opencut-classic/`（快照目录）
- Create: `docs/vendor/opencut-classic/VENDOR.md`（来源/许可证/移植清单）

- [ ] **Step 1: 拷贝快照入仓**

快照源在 git-bash 的 `/tmp/opencut-classic`（= `C:\Users\link\AppData\Local\Temp\opencut-classic`，commit cf5e79e）。排除 `.git` 与 `node_modules`：

```bash
mkdir -p docs/vendor/opencut-classic
cd /tmp/opencut-classic && git rev-parse HEAD
# 记录输出（应为 cf5e79e 开头）
cp -r /tmp/opencut-classic/apps/web/src/timeline docs/flowweb... 
```

完整命令（在仓库根 D:/flowweb 执行）：

```bash
mkdir -p docs/vendor/opencut-classic
(cd /tmp/opencut-classic && tar cf - --exclude=.git --exclude=node_modules .) | (cd docs/vendor/opencut-classic && tar xf -)
```

- [ ] **Step 2: 写 VENDOR.md**

```markdown
# opencut-classic vendor 快照

- 来源: https://github.com/OpenCut-app/opencut-classic
- commit: <Step 1 记录的完整 hash>
- 许可证: MIT（见本目录 LICENSE）
- 引入日期: 2026-09-10
- 用途: 视频剪辑器参考代码（只读，不参与构建）。移植清单:
  - apps/web/src/timeline/ —— 时间轴交互（drag-utils/snapping/group-move/track-capabilities）
  - apps/web/src/services/renderer/ —— scene-builder/canvas-renderer/scene-exporter(mediabunny 171 行)
  - apps/web/src/services/video-cache/ —— LRU 帧缓存设计
- 移植注意: 原库 React19/zustand5/Tailwind4，移植时适配本项目 React18/zustand4/antd5
```

- [ ] **Step 3: 验证并提交**

```bash
ls docs/vendor/opencut-classic/LICENSE docs/vendor/opencut-classic/apps/web/src/timeline
git add docs/vendor/opencut-classic && git commit -m "chore(vendor): opencut-classic MIT 快照入仓（timeline/renderer/video-cache 参考库）"
```

---

### Task 2: 安装新依赖

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: 安装**

```bash
pnpm -C apps/web add mediabunny@^1.56.1 @mediabunny/aac-encoder@^1.56.1 soundtouchjs@0.3.0
```

- [ ] **Step 2: 验证版本并提交**

```bash
grep -E "mediabunny|soundtouch" apps/web/package.json
# 预期: mediabunny ^1.56.1 / @mediabunny/aac-encoder ^1.56.1 / soundtouchjs 0.3.0（精确锁）
git add apps/web/package.json pnpm-lock.yaml && git commit -m "chore(deps): mediabunny + aac-encoder + soundtouchjs(0.3.0 精确锁)"
```

---

### Task 3: soundtouchjs Go/No-Go Spike（半天关卡）

**Files:**
- Create: `docs/vendor/spikes/soundtouch-spike.html`（浏览器手工验证页）
- Create: `docs/vendor/spikes/soundtouch-spike.mjs`（Node 离线验证）

验证三项（spec 附录 A）：① 0.5×/2× 音质；② Worker 内 ESM 导入；③ 离线整段 PCM 处理。任一不过 → 切 WSOLA 自实现（+3~5 天预案），**继续本 plan 其余任务不受阻（音频链在 Plan 3）**。

- [ ] **Step 1: 写 Node 离线验证脚本**

```js
// docs/vendor/spikes/soundtouch-spike.mjs
// 验证③: Node 侧 ESM 导入 + 离线整段 PCM 变速
import { PitchShifter } from 'soundtouchjs';

const sr = 48000, sec = 2;
const pcm = new Float32Array(sr * sec);
for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(2 * Math.PI * 440 * (i / sr)); // 440Hz 正弦

const shifter = new PitchShifter(null, { sampleRate: sr }, { tempo: 2.0 });
// soundtouchjs 0.3.0 API: 通过 onEnd 回调收帧; 无 AudioContext 时构造需传 null + 手动 feed
const out = [];
shifter.on('play', (buf) => out.push(buf));
try {
  shifter._pipe({...pcm, sampleRate: sr, duration: sec});  // 内部管道实测
  console.log('SPIKE-3 PASS: Node ESM import + offline PCM OK, output frames:', out.length);
} catch (e) {
  console.log('SPIKE-3 FAIL:', e.message);
  process.exit(1);
}
```

> 注：soundtouchjs 0.3.0 的离线用法以实测为准——若上述 API 不匹配，查 `docs/vendor/opencut-classic/apps/web/package.json` 锁的用法与其 `src/media/audio.ts` 调用方式修正脚本。**结论记入本文件末尾。**

- [ ] **Step 2: 跑 Spike 并记录结论**

```bash
node docs/vendor/spikes/soundtouch-spike.mjs
```

在 spike 文件末尾追加结论行（示例）：`// CONCLUSION 2026-09-10: ③ PASS（2x tempo 输出 1s 等效）；② 于 Plan 3 Worker 内验证；① 浏览器音质人工判定`

- [ ] **Step 3: 提交**

```bash
git add docs/vendor/spikes && git commit -m "chore(spike): soundtouchjs Go/No-Go 验证（离线 PCM/ESM 导入）"
```

---

### Task 4: Prisma VideoProject migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（新增 model + 三处反向字段）
- Create: `apps/api/prisma/migrations/<本地时间戳>_add_video_project/migration.sql`（migrate dev 生成）

- [ ] **Step 1: schema 增加 model（插在 VideoSeparateTask 之后）**

```prisma
model VideoProject {
  id           String        @id @default(cuid())
  teamId       String
  userId       String        // 取当前操作用户（assertEditor 通过者）——与 CanvasProject.userId 可空无关
  workflowId   String        // CanvasProject.id：regenerate/socket room/资产过滤/级联删除
  sourceNodeId String        @unique // 视频剪辑节点自身 nodeId——一剪辑节点一工程
  title        String
  data         Json
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  team      Team          @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user      User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  workflow  CanvasProject @relation(fields: [workflowId], references: [id], onDelete: Cascade)

  @@index([teamId])
  @@index([userId])
  @@index([workflowId])
}
```

- [ ] **Step 2: 三个既有模型补反向字段**

在 `model Team`、`model User`、`model CanvasProject` 的字段区各加一行：

```prisma
  videoProjects VideoProject[]
```

- [ ] **Step 3: 生成并应用 migration**

记忆红线：migration 目录名用**本地时间戳**、需 CREATEDB 授权、禁 db push：

```bash
pnpm -C apps/api exec prisma migrate dev --name add_video_project
# 预期: 生成 migration.sql 含 CREATE TABLE "VideoProject" + 3 个 index + 3 个 FK
pnpm -C apps/api exec prisma generate
```

- [ ] **Step 4: 验证并提交**

```bash
pnpm -C apps/api test
# 预期: 既有测试全绿（schema 追加不破坏现有）
git add apps/api/prisma && git commit -m "feat(db): VideoProject 模型（sourceNodeId 唯一/三关系级联/三索引）"
```

---

### Task 5: ProjectData 共享类型 + DTO（TDD）

**Files:**
- Create: `packages/shared/src/types/video-project.ts`
- Create: `apps/web/src/pages/canvas/video-editor/types.ts`（re-export，Plan 2/3 消费）
- Test: `apps/api/src/modules/video-project/video-project.dto.spec.ts`
- Create: `apps/api/src/modules/video-project/video-project.dto.ts`

- [ ] **Step 1: 写 shared 类型（严格按 spec 第三节，strict 模式）**

```ts
// packages/shared/src/types/video-project.ts
export interface ProjectData {
  version: 1;
  fps: 30;
  tracks: Track[];
  clips: Record<string, VideoClip | ImageClip | AudioClip | SubtitleClip>;
}
export interface Track {
  id: string;
  type: 'video' | 'subtitle' | 'audio';
  name: string;
  muted: boolean;
  hidden: boolean;
  clips: string[]; // 三类轨语义一致，按 start 有序
}
export interface BaseClip { id: string; trackId: string; start: number; duration: number; }
export interface Transform { x: number; y: number; scale: number; rotation: number; opacity: number; }
export interface VideoClip extends BaseClip {
  type: 'video'; sourceStart: number; mediaId: string; sourceNodeId?: string;
  transform: Transform;
  playbackSpeed: 0.5 | 1 | 2;
  transitionIn?: Transition; transitionOut?: Transition;
  keyframes: TransformKeyframe[];
}
export interface ImageClip extends BaseClip {
  type: 'image'; mediaId: string; sourceNodeId?: string;
  transform: Transform;
  transitionIn?: Transition; transitionOut?: Transition;
  keyframes: TransformKeyframe[];
}
export interface AudioClip extends BaseClip {
  type: 'audio'; sourceStart: number; mediaId: string; sourceNodeId?: string;
  volume: number; fade: { in: number; out: number };
  playbackSpeed: 0.5 | 1 | 2; keyframes: VolumeKeyframe[];
}
export interface SubtitleClip extends BaseClip {
  type: 'subtitle'; text: string; visible: boolean;
  style: { fontSize: number; color: string; letterSpacing: number };
}
export interface TransformKeyframe { id: string; t: number; property: 'x'|'y'|'scale'|'rotation'|'opacity'; value: number; easing: 'linear'; }
export interface VolumeKeyframe { id: string; t: number; value: number; easing: 'linear'; }
export interface Transition { type: 'fadeIn'|'fadeOut'|'crossfade'|'toBlack'|'toWhite'; duration: number; }

/** 默认空工程：1 视频 + 1 字幕 + 2 音频，空 clips */
export function createDefaultProjectData(): ProjectData {
  return {
    version: 1, fps: 30,
    tracks: [
      { id: crypto.randomUUID(), type: 'video',    name: '视频',  muted: false, hidden: false, clips: [] },
      { id: crypto.randomUUID(), type: 'subtitle', name: '字幕1', muted: false, hidden: false, clips: [] },
      { id: crypto.randomUUID(), type: 'audio',    name: '音频1', muted: false, hidden: false, clips: [] },
      { id: crypto.randomUUID(), type: 'audio',    name: '音频2', muted: false, hidden: false, clips: [] },
    ],
    clips: {},
  };
}
```

在 `packages/shared/src/index.ts`（若存在 barrel）追加 export；并在 `apps/web/src/pages/canvas/video-editor/types.ts` 写 `export * from '@flowweb/shared/types/video-project';`（若 shared 无 barrel 则按 material-library.ts 的既有导出方式对齐）。

- [ ] **Step 2: 写 DTO 校验失败测试**

```ts
// apps/api/src/modules/video-project/video-project.dto.spec.ts
import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateVideoProjectDto, PatchVideoProjectDto } from './video-project.dto';

describe('video-project DTO', () => {
  it('合法 create 通过', async () => {
    const dto = plainToInstance(CreateVideoProjectDto, {
      workflowId: 'wp1', sourceNodeId: 'node-1', teamId: 't1', title: 'x',
      data: { version: 1, fps: 30, tracks: [], clips: {} },
    });
    expect(await validate(dto)).toHaveLength(0);
  });
  it('缺 sourceNodeId 拒绝', async () => {
    const dto = plainToInstance(CreateVideoProjectDto, { workflowId: 'wp1', data: {} });
    const errs = await validate(dto);
    expect(errs.some(e => e.property === 'sourceNodeId')).toBe(true);
  });
  it('patch data 非对象拒绝', async () => {
    const dto = plainToInstance(PatchVideoProjectDto, { data: 'not-object', baseUpdatedAt: '2026-09-10T00:00:00Z' });
    const errs = await validate(dto);
    expect(errs.some(e => e.property === 'data')).toBe(true);
  });
});
```

- [ ] **Step 3: 跑测试确认失败（模块不存在）**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project/video-project.dto.spec.ts
# 预期: FAIL（Cannot find module './video-project.dto'）
```

- [ ] **Step 4: 写 DTO**

```ts
// apps/api/src/modules/video-project/video-project.dto.ts
import { IsString, IsObject, IsOptional, IsDateString } from 'class-validator';

export class CreateVideoProjectDto {
  @IsString() workflowId!: string;
  @IsString() sourceNodeId!: string;
  @IsString() teamId!: string;
  @IsString() title!: string;
  @IsObject() data!: object; // ProjectData 结构由前端 shared 类型保证；服务端挡非对象
}
export class PatchVideoProjectDto {
  @IsObject() data!: object;
  @IsDateString() baseUpdatedAt!: string; // 乐观锁基准
}
export class RegenerateDto {
  @IsString() sourceNodeId!: string; // 素材源节点（非剪辑节点）
  @IsString() kind!: 'video' | 'audio';
}
```

- [ ] **Step 5: 跑测试通过并提交**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project/video-project.dto.spec.ts
git add packages/shared apps/web/src/pages/canvas/video-editor apps/api/src/modules/video-project
git commit -m "feat(video-project): ProjectData shared 类型 + DTO（TDD）"
```

---

### Task 6: VideoProjectService（TDD：upsert 幂等/乐观锁/权限）

**Files:**
- Create: `apps/api/src/modules/video-project/video-project.service.ts`
- Test: `apps/api/src/modules/video-project/video-project.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/modules/video-project/video-project.service.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { VideoProjectService } from './video-project.service';

const mkPrisma = (over: any = {}) => ({
  videoProject: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...over,
  },
});
const perm = { assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR') };
const collab = { readCanvas: vi.fn() };

describe('VideoProjectService', () => {
  let svc: VideoProjectService; let prisma: any;
  beforeEach(() => {
    prisma = mkPrisma();
    svc = new VideoProjectService(prisma, perm as any, collab as any);
  });

  it('upsertByNode 幂等：并发双调用只产生一条记录', async () => {
    prisma.videoProject.upsert.mockResolvedValue({ id: 'p1', sourceNodeId: 'n1', data: { version: 1 } });
    const r = await svc.upsertByNode({ workflowId: 'w1', sourceNodeId: 'n1', teamId: 't1', userId: 'u1', title: 'x' });
    expect(prisma.videoProject.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.videoProject.upsert.mock.calls[0][0].where).toEqual({ sourceNodeId: 'n1' });
    expect(r.id).toBe('p1');
  });

  it('patch 乐观锁：updatedAt 不匹配抛 409', async () => {
    prisma.videoProject.findUnique.mockResolvedValue({ id: 'p1', updatedAt: new Date('2026-09-10T01:00:00Z') });
    await expect(svc.patch('p1', 'u1', { data: {}, baseUpdatedAt: '2026-09-10T00:00:00Z' }))
      .rejects.toThrow(ConflictException);
    expect(prisma.videoProject.update).not.toHaveBeenCalled();
  });

  it('patch 成功返回新 updatedAt 供前端回填', async () => {
    prisma.videoProject.findUnique.mockResolvedValue({ id: 'p1', workflowId: 'w1', updatedAt: new Date('2026-09-10T01:00:00Z') });
    prisma.videoProject.update.mockResolvedValue({ id: 'p1', updatedAt: new Date('2026-09-10T02:00:00Z') });
    const r = await svc.patch('p1', 'u1', { data: {}, baseUpdatedAt: '2026-09-10T01:00:00Z' });
    expect(perm.assertEditor).toHaveBeenCalledWith('w1', 'u1');
    expect(r.updatedAt).toEqual(new Date('2026-09-10T02:00:00Z'));
  });

  it('deleteByNode 仅删记录不级联 Media', async () => {
    prisma.videoProject.findUnique.mockResolvedValue({ id: 'p1', workflowId: 'w1' });
    await svc.deleteByNode('n1', 'u1');
    expect(prisma.videoProject.delete).toHaveBeenCalledWith({ where: { sourceNodeId: 'n1' } });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project/video-project.service.spec.ts
# 预期: FAIL（Cannot find module './video-project.service'）
```

- [ ] **Step 3: 写实现**

```ts
// apps/api/src/modules/video-project/video-project.service.ts
import { Injectable, Inject, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CollabDocumentService } from '../collab/collab-document.service';

@Injectable()
export class VideoProjectService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(CollabDocumentService) private readonly collab: CollabDocumentService,
  ) {}

  /** upsert by sourceNodeId（@unique）——幂等防双击；update 分支同样全量返回 */
  async upsertByNode(input: { workflowId: string; sourceNodeId: string; teamId: string; userId: string; title: string; data?: unknown }) {
    await this.perm.assertEditor(input.workflowId, input.userId);
    return this.prisma.videoProject.upsert({
      where: { sourceNodeId: input.sourceNodeId },
      create: {
        teamId: input.teamId, userId: input.userId, workflowId: input.workflowId,
        sourceNodeId: input.sourceNodeId, title: input.title,
        data: (input.data ?? { version: 1, fps: 30, tracks: [], clips: {} }) as object,
      },
      update: {}, // 已存在则原样返回全量（title/data 不动——编辑器加载用）
    });
  }

  async getByNode(sourceNodeId: string, userId: string) {
    const proj = await this.prisma.videoProject.findUnique({ where: { sourceNodeId } });
    if (!proj) return null;
    await this.perm.assertEditor(proj.workflowId, userId);
    return proj;
  }

  /** PATCH 单飞配合：乐观锁 baseUpdatedAt ≠ 库内值 → 409 */
  async patch(id: string, userId: string, dto: { data: object; baseUpdatedAt: string }) {
    const proj = await this.prisma.videoProject.findUnique({ where: { id } });
    if (!proj) throw new ConflictException('project not found');
    await this.perm.assertEditor(proj.workflowId, userId);
    if (proj.updatedAt.getTime() !== new Date(dto.baseUpdatedAt).getTime()) {
      throw new ConflictException('project modified elsewhere');
    }
    return this.prisma.videoProject.update({ where: { id }, data: { data: dto.data as object } });
  }

  async deleteByNode(sourceNodeId: string, userId: string) {
    const proj = await this.prisma.videoProject.findUnique({ where: { sourceNodeId } });
    if (!proj) return;
    await this.perm.assertEditor(proj.workflowId, userId);
    await this.prisma.videoProject.delete({ where: { sourceNodeId } });
  }
}
```

- [ ] **Step 4: 跑测试通过**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project/video-project.service.spec.ts
# 预期: 4 PASS
```

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/modules/video-project && git commit -m "feat(video-project): service upsert 幂等/乐观锁 409/assertEditor（TDD）"
```

---

### Task 7: Controller + Module（TDD：ValidationPipe 自挂）

**Files:**
- Create: `apps/api/src/modules/video-project/video-project.controller.ts`
- Create: `apps/api/src/modules/video-project/video-project.module.ts`
- Modify: `apps/api/src/app.module.ts`（imports 数组注册 VideoProjectModule）
- Test: `apps/api/src/modules/video-project/video-project.controller.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/modules/video-project/video-project.controller.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { VideoProjectController } from './video-project.controller';
import { VideoProjectService } from './video-project.service';

describe('VideoProjectController', () => {
  let ctrl: VideoProjectController; let svc: any;
  const req = { user: { id: 'u1' } };
  beforeEach(async () => {
    svc = {
      upsertByNode: vi.fn().mockResolvedValue({ id: 'p1' }),
      getByNode: vi.fn().mockResolvedValue({ id: 'p1' }),
      patch: vi.fn().mockResolvedValue({ id: 'p1', updatedAt: new Date() }),
      deleteByNode: vi.fn().mockResolvedValue(undefined),
    };
    const mod = await Test.createTestingModule({
      controllers: [VideoProjectController],
      providers: [{ provide: VideoProjectService, useValue: svc }],
    }).compile();
    ctrl = mod.get(VideoProjectController);
  });

  it('POST upsert 透传 userId', async () => {
    await ctrl.create({ workflowId: 'w1', sourceNodeId: 'n1', teamId: 't1', title: 'x', data: {} } as any, req);
    expect(svc.upsertByNode).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
  });
  it('GET by-node 透传', async () => {
    await ctrl.byNode('n1', req);
    expect(svc.getByNode).toHaveBeenCalledWith('n1', 'u1');
  });
  it('DELETE by-node', async () => {
    await ctrl.deleteByNode('n1', req);
    expect(svc.deleteByNode).toHaveBeenCalledWith('n1', 'u1');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project/video-project.controller.spec.ts
# 预期: FAIL（Cannot find module）
```

- [ ] **Step 3: 写 controller + module 并注册**

```ts
// apps/api/src/modules/video-project/video-project.controller.ts
import { Controller, Post, Get, Patch, Delete, Body, Param, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { VideoProjectService } from './video-project.service';
import { CreateVideoProjectDto, PatchVideoProjectDto } from './video-project.dto';

@Controller('api/video-projects')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true })) // ValidationPipe 非全局，必须自挂
export class VideoProjectController {
  constructor(private readonly svc: VideoProjectService) {}

  @Post()
  create(@Body() dto: CreateVideoProjectDto, @Req() req: any) {
    return this.svc.upsertByNode({ ...dto, userId: req.user?.id });
  }

  @Get('by-node/:sourceNodeId')
  byNode(@Param('sourceNodeId') sourceNodeId: string, @Req() req: any) {
    return this.svc.getByNode(sourceNodeId, req.user?.id);
  }

  @Patch(':id')
  patch(@Param('id') id: string, @Body() dto: PatchVideoProjectDto, @Req() req: any) {
    return this.svc.patch(id, req.user?.id, dto);
  }

  @Delete('by-node/:sourceNodeId')
  deleteByNode(@Param('sourceNodeId') sourceNodeId: string, @Req() req: any) {
    return this.svc.deleteByNode(sourceNodeId, req.user?.id);
  }
}
```

```ts
// apps/api/src/modules/video-project/video-project.module.ts
import { Module } from '@nestjs/common';
import { VideoProjectController } from './video-project.controller';
import { VideoProjectService } from './video-project.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CollabModule } from '../collab/collab.module'; // 若模块名不同，按实际（find apps/api/src/modules/collab -name "*.module.ts"）

@Module({
  imports: [CollabModule],
  controllers: [VideoProjectController],
  providers: [VideoProjectService, ProjectPermissionService],
})
export class VideoProjectModule {}
```

`app.module.ts` 的 `imports` 数组追加 `VideoProjectModule`（import 路径 `./modules/video-project/video-project.module`）。

- [ ] **Step 4: 全量测试通过并提交**

```bash
pnpm -C apps/api test
# 预期: 全绿（含既有）
git add apps/api/src && git commit -m "feat(video-project): controller/module 注册（ValidationPipe 自挂）（TDD）"
```

---

### Task 8: isExecutableNode 执行白名单（TDD）

**Files:**
- Create: `apps/api/src/modules/execution/is-executable-node.ts`
- Modify: `apps/api/src/modules/execution/validation.service.ts`（validateAll 循环首行跳过）
- Modify: `apps/api/src/modules/execution/execution.service.ts`（execute 循环**首行、emitNodeStatus 之前**跳过）
- Test: `apps/api/src/modules/execution/is-executable-node.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/modules/execution/is-executable-node.spec.ts
import { describe, it, expect } from 'vitest';
import { isExecutableNode } from './is-executable-node';

describe('isExecutableNode（类型+产物标记双条件白名单）', () => {
  it('六类生成节点可执行', () => {
    for (const type of ['textInput', 'imageGen', 'imageExtGen', 'videoGen', 'audioGen', 'multiImageGen'])
      expect(isExecutableNode({ id: 'n', type, data: { model: 'm' } })).toBe(true);
  });
  it('videoEdit 类型跳过（防全部执行必挂）', () => {
    expect(isExecutableNode({ id: 'n', type: 'videoEdit', data: {} })).toBe(false);
  });
  it('origin=video-edit 的 videoGen 产物节点跳过（防二次必挂）', () => {
    expect(isExecutableNode({ id: 'n', type: 'videoGen', data: { origin: 'video-edit', status: 'done', fileId: 'f1' } })).toBe(false);
  });
  it('普通 videoGen（有 model）不误伤', () => {
    expect(isExecutableNode({ id: 'n', type: 'videoGen', data: { model: 'm' } })).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/api exec vitest run src/modules/execution/is-executable-node.spec.ts
# 预期: FAIL（Cannot find module）
```

- [ ] **Step 3: 写谓词并接入两处**

```ts
// apps/api/src/modules/execution/is-executable-node.ts
const EXECUTABLE_TYPES = new Set(['textInput', 'imageGen', 'imageExtGen', 'videoGen', 'audioGen', 'multiImageGen']);

/** 白名单真正生效场景：全部执行 / nodeIds 批量执行（单节点 getScope 只收上游，产物边方向 剪辑→产物） */
export function isExecutableNode(node: { type: string; data?: Record<string, unknown> | null }): boolean {
  if (!EXECUTABLE_TYPES.has(node.type)) return false;
  if ((node.data as any)?.origin === 'video-edit') return false; // 导出产物节点：无 model，跳过防误重跑扣费
  return true;
}
```

`validation.service.ts` 的 `validateAll` 循环：`if (node.type === 'textInput') continue;` 一行**之前**插入：

```ts
      if (!isExecutableNode(node)) continue;
```

（随后的 textInput 判断可保留不动——谓词已涵盖，保留无碍。）

`execution.service.ts` 的 execute 循环（L65 `for (const node of orderedNodes) {` 之后、`this.gateway.emitNodeStatus(...'loading')` **之前**）插入：

```ts
      if (!isExecutableNode(node)) continue; // 防剪辑/产物节点闪 loading 与误执行
```

同时 validateAll 顶部的 modelIds 收集 filter 改为 `nodes.filter(n => isExecutableNode(n) && n.type !== 'textInput')`（防 videoEdit 无 model 进 modelIds）。

- [ ] **Step 4: 跑测试 + 既有 execution 测试不破**

```bash
pnpm -C apps/api exec vitest run src/modules/execution/is-executable-node.spec.ts
pnpm -C apps/api exec vitest run src/modules/execution
# 预期: 新 4 PASS + 既有 execution.*.spec 全绿
```

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/modules/execution && git commit -m "feat(execution): isExecutableNode 白名单（类型+产物标记，validation/execute 前置过滤防 loading 闪烁）（TDD）"
```

---

### Task 9: collabDoc insertNode/removeNode 原语（TDD：fillDoc 逐键同构）

**Files:**
- Create: `apps/api/src/modules/collab/node-doc.util.ts`（单节点 Y.Map 构造，与 ydocBuilder.fillDoc 同构）
- Modify: `apps/api/src/modules/collab/collab-document.service.ts`（新增两方法）
- Test: `apps/api/src/modules/collab/node-doc.util.spec.ts`

- [ ] **Step 1: 写失败测试（往返 + 契约）**

```ts
// apps/api/src/modules/collab/node-doc.util.spec.ts
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildNodeYMap, SHADOW_ORIGIN } from './node-doc.util';

describe('buildNodeYMap（与 ydocBuilder.fillDoc 逐键同构）', () => {
  it('parentId 为 null 时省略键（防差异循环）', () => {
    const doc = new Y.Doc();
    const m = buildNodeYMap(doc, { id: 's1', type: 'videoGen', position: { x: -99999, y: -99999 }, data: { model: 'm', __ephemeral: true } });
    expect(m.get('parentId')).toBeUndefined();
    expect(m.get('type')).toBe('videoGen');
  });
  it('position 为独立 Y.Map 且必写', () => {
    const doc = new Y.Doc();
    const m = buildNodeYMap(doc, { id: 's1', type: 'videoGen', position: { x: 1, y: 2 }, data: {} });
    expect(m.get('position')).toBeInstanceOf(Y.Map);
    expect((m.get('position') as Y.Map<any>).get('x')).toBe(1);
  });
  it('data 为独立 Y.Map，嵌套对象保真（prompt.text）', () => {
    const doc = new Y.Doc();
    const m = buildNodeYMap(doc, { id: 's1', type: 'videoGen', position: { x: 0, y: 0 }, data: { prompt: { text: 'hello' } } });
    const data = m.get('data') as Y.Map<any>;
    expect(data).toBeInstanceOf(Y.Map);
    expect((data.get('prompt') as any).text).toBe('hello');
  });
  it('SHADOW_ORIGIN 常量存在且非 local-user', () => {
    expect(typeof SHADOW_ORIGIN).toBe('string');
    expect(SHADOW_ORIGIN).not.toBe('local-user');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/api exec vitest run src/modules/collab/node-doc.util.spec.ts
# 预期: FAIL（Cannot find module）
```

- [ ] **Step 3: 写实现 + service 两方法**

```ts
// apps/api/src/modules/collab/node-doc.util.ts
import * as Y from 'yjs';

export const SHADOW_ORIGIN = 'server-shadow'; // onRemote 短路判定用（非 local-user，不进 UndoManager）

export interface ShadowNodeInput {
  id: string; type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

/** 与前端 ydocBuilder.fillDoc 逐键同构：type / parentId?(null 省略) / width? / height? / position(Y.Map 必写) / data(Y.Map) */
export function buildNodeYMap(doc: Y.Doc, n: ShadowNodeInput): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('type', n.type);
  const position = new Y.Map<unknown>();
  position.set('x', n.position.x);
  position.set('y', n.position.y);
  m.set('position', position);
  const data = new Y.Map<unknown>();
  doc.transact(() => {
    for (const [k, v] of Object.entries(n.data)) data.set(k, v);
  }, SHADOW_ORIGIN);
  m.set('data', data);
  return m;
}
```

`collab-document.service.ts` 追加两方法（类内）：

```ts
  /** A1 影子节点：整节点写入（独立 SHADOW_ORIGIN 事务，前端 onRemote 短路防全量重建闪烁） */
  async insertNode(projectId: string, node: { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }) {
    await this.withDoc(projectId, (doc) => {
      const m = buildNodeYMap(doc, node);
      doc.getMap('nodes').transact(() => {
        doc.getMap('nodes').set(node.id, m);
      }, SHADOW_ORIGIN);
    });
  }

  async removeNode(projectId: string, nodeId: string) {
    await this.withDoc(projectId, (doc) => {
      doc.getMap('nodes').transact(() => {
        doc.getMap('nodes').delete(nodeId);
      }, SHADOW_ORIGIN);
    });
  }
```

顶部 `import { buildNodeYMap, SHADOW_ORIGIN } from './node-doc.util';`。

> 注意：withDoc 若要求非 LocalUser origin 直连的等待语义，SHADOW_ORIGIN 事务与 Server 更新同通道——保持默认即可（onRemote 侧按 origin 短路是前端 Plan 2 的活）。

- [ ] **Step 4: 跑测试通过 + 提交**

```bash
pnpm -C apps/api exec vitest run src/modules/collab
# 预期: 新 4 PASS + 既有 collab spec 全绿
git add apps/api/src/modules/collab && git commit -m "feat(collab): insertNode/removeNode 原语（fillDoc 同构/SHADOW_ORIGIN 独立事务）（TDD）"
```

---

### Task 10: generated 产物登记接口（TDD：POST 直传 + 实际大小落库）

**Files:**
- Create: `apps/api/src/modules/video-project/generated-media.service.ts`
- Modify: `apps/api/src/modules/video-project/video-project.controller.ts`（+2 路由）
- Modify: `apps/api/src/modules/video-project/video-project.module.ts`（providers）
- Test: `apps/api/src/modules/video-project/generated-media.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/modules/video-project/generated-media.service.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { GeneratedMediaService } from './generated-media.service';

describe('GeneratedMediaService（复用状态机语义，方法自建）', () => {
  let svc: GeneratedMediaService; let prisma: any; let minio: any; let quota: any; let thumb: any;
  const base = { teamId: 't1', userId: 'u1', workflowId: 'w1', videoProjectId: 'p1', resolution: '1080p', durationSec: 60 };

  beforeEach(() => {
    prisma = { media: { create: vi.fn().mockResolvedValue({ id: 'm1' }), findUnique: vi.fn(), update: vi.fn().mockResolvedValue({ id: 'm1' }) } };
    minio = {
      buildKey: vi.fn().mockReturnValue('results/u1/w1/n1/2026-09-10/uuid.mp4'),
      generatePresignedPost: vi.fn().mockResolvedValue({ url: 'http://minio/post', fields: { key: 'results/u1/w1/n1/2026-09-10/uuid.mp4' } }),
      statObject: vi.fn().mockResolvedValue({ size: 12_345_678 }),
    };
    quota = { assertCanUpload: vi.fn().mockResolvedValue(undefined) };
    thumb = { add: vi.fn().mockResolvedValue(undefined) };
    svc = new GeneratedMediaService(prisma, minio, quota, thumb);
  });

  it('register（编码完成后调用，actualSize=Blob.size）: 建 pending Media + presigned POST + 配额终判', async () => {
    const r = await svc.register({ ...base, actualSize: 12_345_000 });
    expect(r.mediaId).toBe('m1');
    expect(r.upload.url).toBe('http://minio/post');
    expect(quota.assertCanUpload).toHaveBeenCalledWith('t1', 12_345_000);
    expect(minio.generatePresignedPost).toHaveBeenCalledWith('results/u1/w1/n1/2026-09-10/uuid.mp4', 'video/mp4', 12_345_000);
    expect(prisma.media.create.mock.calls[0][0].data).toMatchObject({ type: 'generated', status: 'pending', mimeType: 'video/mp4', size: 12_345_000 });
  });

  it('confirm: statObject 实际大小落库 + enqueue 缩略图（video/mp4 + 抽帧点 seekSec）', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', userId: 'u1' });
    await svc.confirm('u1', { mediaId: 'm1', key: 'k.mp4', totalDurationSec: 30 });
    expect(prisma.media.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'm1' },
      data: expect.objectContaining({ status: 'completed', size: 12_345_678 }),
    }));
    expect(thumb.add).toHaveBeenCalledWith('generate-thumbnail',
      expect.objectContaining({ mediaId: 'm1', key: 'k.mp4', mimeType: 'video/mp4', seekSec: 3 })); // max(1, 30*0.1)
  });

  it('confirm: 归属校验失败拒绝', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', userId: 'other' });
    await expect(svc.confirm('u1', { mediaId: 'm1', key: 'k', totalDurationSec: 10 })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project/generated-media.service.spec.ts
# 预期: FAIL（Cannot find module）
```

- [ ] **Step 3: 写实现**

```ts
// apps/api/src/modules/video-project/generated-media.service.ts
import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { StorageQuotaService } from '../storage/storage-quota.service';
import { THUMBNAIL_GENERATOR_QUEUE } from '../material-library/constants/material-library.constants';

@Injectable()
export class GeneratedMediaService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(StorageQuotaService) private readonly quota: StorageQuotaService,
    @InjectQueue(THUMBNAIL_GENERATOR_QUEUE) private readonly thumbnailQueue: Queue,
  ) {}

  /**
   * 登记入口——**编码完成后调用**（前端持有 Blob，actualSize = Blob.size）。
   * 时序关键：generatePresignedPost 的 Conditions 含 content-length-range ±1024——
   * 编码前估算体积过不了该条件，必须用真实字节数（spec v3.6 时序修正）。
   */
  async register(input: { teamId: string; userId: string; workflowId: string; videoProjectId: string; resolution: string; durationSec: number; actualSize: number }) {
    await this.quota.assertCanUpload(input.teamId, input.actualSize); // 配额终判（真实大小）
    const key = this.minio.buildKey('generated', input.userId, { projectId: input.workflowId, ext: 'mp4' });
    const media = await this.prisma.media.create({
      data: {
        userId: input.userId, teamId: input.teamId, projectId: input.workflowId,
        bucket: 'flowai', key, originalName: `export-${input.resolution}.mp4`,
        mimeType: 'video/mp4', size: input.actualSize,
        type: 'generated', status: 'pending',
        metadata: { origin: 'video-project', videoProjectId: input.videoProjectId, resolution: input.resolution, durationSec: input.durationSec },
      },
    });
    const upload = await this.minio.generatePresignedPost(key, 'video/mp4', input.actualSize);
    return { mediaId: media.id, upload }; // upload: { url, fields }——前端 FormData 逐字段填 + file 最后追加
  }

  /** 确认：statObject 实际大小落库（无 ±1024 比对——勿误调 storage.confirmUpload）+ 缩略图 enqueue */
  async confirm(userId: string, dto: { mediaId: string; key: string; totalDurationSec: number }) {
    const media = await this.prisma.media.findUnique({ where: { id: dto.mediaId } });
    if (!media || media.userId !== userId) throw new ForbiddenException('media not found');
    const stats = await this.minio.statObject(dto.key);
    const seekSec = Math.max(1, dto.totalDurationSec * 0.1); // 防前导黑场黑帧；consumer 需支持可选 seekSec（默认 1 保持旧行为）
    await this.thumbnailQueue.add('generate-thumbnail',
      { mediaId: media.id, key: dto.key, mimeType: 'video/mp4', seekSec });
    return this.prisma.media.update({
      where: { id: media.id },
      data: { status: 'completed', size: stats.size },
    });
  }
}
```

> 实现时两个核对：① `thumbnail-generator.consumer.ts` 加可选 `seekSec` job 参数（默认 1 保持旧行为）；② Media 的 metadata/size 字段以 schema.prisma 实际为准（size 是 Int，15min 产物远低于 2.1GB 上限）。

Controller 追加（同文件，注入 GeneratedMediaService）：

```ts
  @Post('generated-media/register')
  registerGenerated(@Body() dto: Record<string, any>, @Req() req: any) {
    return this.generated.register({ ...dto, userId: req.user?.id });
  }
  @Post('generated-media/confirm')
  confirmGenerated(@Body() dto: Record<string, any>, @Req() req: any) {
    return this.generated.confirm(req.user?.id, dto);
  }
```

- [ ] **Step 4: 跑测试 + 提交**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project
# 预期: 全部 PASS
git add apps/api/src && git commit -m "feat(video-project): generated 登记接口（presigned POST 直传/实际大小落库/缩略图抽帧点）（TDD）"
```

---

### Task 11: regenerate A1 影子节点接口（TDD）

**Files:**
- Modify: `apps/api/src/modules/video-project/video-project.service.ts`（+regenerate）
- Modify: `apps/api/src/modules/video-project/video-project.controller.ts`（+1 路由）
- Test: `apps/api/src/modules/video-project/video-project.regenerate.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/modules/video-project/video-project.regenerate.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { VideoProjectService } from './video-project.service';

describe('regenerate（A1 影子节点）', () => {
  let svc: VideoProjectService; let prisma: any; let collab: any; let execution: any;
  const perm = { assertEditor: vi.fn().mockResolvedValue('E') };

  beforeEach(() => {
    prisma = { videoProject: { findUnique: vi.fn() } };
    collab = { readCanvas: vi.fn(), insertNode: vi.fn(), removeNode: vi.fn() };
    execution = { execute: vi.fn().mockResolvedValue({ success: true }) };
    svc = new VideoProjectService(prisma, perm as any, collab as any);
    (svc as any).execution = execution; // 注入（或走构造器，见 Step 3）
  });

  it('源节点存在且为生成类型：克隆影子→直调 execute（不带 sv）→返回 shadowNodeId', async () => {
    collab.readCanvas.mockResolvedValue({
      nodes: [{ id: 'src1', type: 'videoGen', position: { x: 1, y: 2 }, data: { model: 'm', prompt: { text: 't' } } }],
      edges: [],
    });
    const r = await svc.regenerate('u1', { sourceNodeId: 'src1', workflowId: 'w1' });
    expect(collab.insertNode).toHaveBeenCalledWith('w1', expect.objectContaining({
      id: expect.stringContaining('shadow'),
      type: 'videoGen',
      data: expect.objectContaining({ __ephemeral: true, model: 'm' }), // JSON 整份深拷
    }));
    expect(execution.execute).toHaveBeenCalledWith('w1', expect.any(String), 'u1', undefined, undefined);
    expect(r.shadowNodeId).toBeTruthy();
  });

  it('源节点不存在/非生成类型：400', async () => {
    collab.readCanvas.mockResolvedValue({ nodes: [{ id: 'x', type: 'videoEdit', data: {} }], edges: [] });
    await expect(svc.regenerate('u1', { sourceNodeId: 'x', workflowId: 'w1' })).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project/video-project.regenerate.spec.ts
# 预期: FAIL（svc.regenerate 不是函数）
```

- [ ] **Step 3: 写实现（service 追加方法；构造器注入 ExecutionService 用前向引用防循环依赖）**

`video-project.service.ts` 追加（构造器加 `@Inject(forwardRef(() => ExecutionService)) private readonly execution: ExecutionService`，`import { forwardRef, Inject } from '@nestjs/common'`；module providers 相应调整）：

```ts
  /**
   * A1 影子节点克隆生成：
   * 1. readCanvas 找 sourceNode → JSON 整份深拷 data（禁止字段挑拣——取词链 content 优先/prompt 嵌套）
   * 2. insertNode 影子（SHADOW_ORIGIN 独立事务，防前端 applyDocToStore 全量重建闪烁）
   * 3. 服务端直调 execute（不走 HTTP、不带 x-yjs-sv——sv 裁剪会让影子不可见）
   * 4. 不在此删影子：done 事件经 socket 回流后由前端读 data 取 fileId 再调 removeNodeByShadow
   */
  async regenerate(userId: string, dto: { sourceNodeId: string; workflowId: string; kind: 'video' | 'audio' }) {
    await this.perm.assertEditor(dto.workflowId, userId);
    const canvas = await this.collab.readCanvas(dto.workflowId);
    const src = (canvas.nodes as any[]).find(n => n.id === dto.sourceNodeId);
    const wantType = dto.kind === 'video' ? 'videoGen' : 'audioGen';
    if (!src || src.type !== wantType) throw new BadRequestException('source node not found or kind mismatch');
    const shadowId = `shadow-${dto.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const clonedData = JSON.parse(JSON.stringify(src.data ?? {})); // 整份深拷（Yjs toJSON 即 JSON 语义）
    clonedData.__ephemeral = true;
    await this.collab.insertNode(dto.workflowId, {
      id: shadowId, type: wantType,
      position: { x: -99999, y: -99999 }, // 视口外（投影层仍会过滤，双保险）
      data: clonedData,
    });
    const result = await this.execution.execute(dto.workflowId, shadowId, userId); // 直调，无 sv
    return { shadowNodeId: shadowId, result };
  }

  /** 前端 done 回流后调用：删影子节点（fire-and-forget 安全，重复删 no-op） */
  async removeShadow(userId: string, dto: { workflowId: string; shadowNodeId: string }) {
    await this.perm.assertEditor(dto.workflowId, userId);
    await this.collab.removeNode(dto.workflowId, dto.shadowNodeId);
    return { ok: true };
  }
```

Controller 追加：

```ts
  @Post('regenerate')
  regenerate(@Body() dto: RegenerateDto, @Req() req: any) {
    return this.svc.regenerate(req.user?.id, dto);
  }
  @Post('remove-shadow')
  removeShadow(@Body() dto: { workflowId: string; shadowNodeId: string }, @Req() req: any) {
    return this.svc.removeShadow(req.user?.id, dto);
  }
```

> execute 为同步串行可能数分钟——前端 axios 对这两个端点单独放大超时（Plan 4 处理）。

- [ ] **Step 4: 跑测试 + 提交**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project
# 预期: 全部 PASS
git add apps/api/src && git commit -m "feat(video-project): regenerate A1 影子节点（JSON 整份克隆/SHADOW_ORIGIN/服务端直调 execute）（TDD）"
```

---

### Task 12: media batch 批查接口（TDD）

**Files:**
- Create: `apps/api/src/modules/media/media-batch.service.ts`
- Modify: `apps/api/src/modules/media/media.controller.ts`（+1 路由，前缀已是 `api/media`）
- Test: `apps/api/src/modules/media/media-batch.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/modules/media/media-batch.service.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MediaBatchService } from './media-batch.service';

describe('MediaBatchService（左面板聚合：按 mediaId 集合查，绕开 type 硬编码过滤）', () => {
  it('按 ids 批查且只返回归属团队的记录', async () => {
    const prisma = { media: { findMany: vi.fn().mockResolvedValue([{ id: 'm1' }]) } };
    const svc = new MediaBatchService(prisma as any);
    const r = await svc.batchGet('u1', 't1', ['m1', 'm2']);
    expect(prisma.media.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] }, teamId: 't1', deletedAt: null },
      select: expect.objectContaining({ id: true, key: true, mimeType: true }),
    });
    expect(r).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 确认失败 → Step 3: 实现**

```ts
// apps/api/src/modules/media/media-batch.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MediaBatchService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 直接按 mediaId 集合查（避开 material.service 的 type='generated' 硬编码过滤） */
  batchGet(_userId: string, teamId: string, ids: string[]) {
    return this.prisma.media.findMany({
      where: { id: { in: ids }, teamId, deletedAt: null },
      select: { id: true, key: true, originalName: true, mimeType: true, size: true, thumbnailKey: true, createdAt: true },
    });
  }
}
```

`media.controller.ts` 追加（teamId 走 `@Query`，对齐 file.controller.ts 既有模式）：

```ts
  @Post('batch')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  batch(@Req() req: any, @Query('teamId') teamId: string, @Body() dto: { ids: string[] }) {
    return this.batch.batchGet(req.user?.id, teamId, dto.ids);
  }
```

- [ ] **Step 4: 跑测试 + 全量回归 + 提交**

```bash
pnpm -C apps/api test
# 预期: 全绿
git add apps/api/src && git commit -m "feat(media): POST /api/media/batch 批查（绕开 generated 过滤，左面板聚合用）（TDD）"
```

---

## Plan 1 完成判定

- `pnpm -C apps/api test` 全绿；`pnpm -C apps/web test` 不受影响
- 手动冒烟（可选）：本地起 API 后 `curl -X POST localhost:3000/api/video-projects -H 'Content-Type: application/json' -d '{...}'` 走 401（AuthGuard 生效即证明路由注册成功）
- spec 对应：附录 B 阶段 0/0.5/1 全部落地；验收 13/23/24 的服务端侧就绪

## 后续 Plan（另开文件）

- Plan 2/4：VideoEditNode 全链路注册 + timeline 纯函数 TDD + store/时间轴 UI + 连线同步（syncAutoEdgesToDoc/订阅跳前缀/桥层测试）
- Plan 3/4：scene 纯函数 + 预览 + audio-engine + 右面板四态 + 转场关键帧
- Plan 4/4：Worker 导出 + 产物上画布 + socket 单例迁移 + AI 按钮 + 29 条验收
