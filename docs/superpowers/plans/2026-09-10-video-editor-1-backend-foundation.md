<!-- doc-status: historical | verified_at: n/a -->
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

- [x] **Step 1: 拷贝快照入仓（PowerShell——本仓 shell 为 pwsh，bash 管道 tar 不可用）**

快照源在 git-bash 的 `/tmp/opencut-classic`（= `C:\Users\link\AppData\Local\Temp\opencut-classic`，commit cf5e79e）。排除 `.git` 与 `node_modules`：

```powershell
# 记录 commit hash（写入 VENDOR.md 用）
git -C "$env:TEMP\opencut-classic" rev-parse HEAD
# robocopy /E 递归 /XD 排除目录（robocopy 退出码 0-7 均为成功，非 0 不是错误）
robocopy "$env:TEMP\opencut-classic" "D:\flowweb\docs\vendor\opencut-classic" /E /XD .git node_modules
```

- [x] **Step 2: 写 VENDOR.md**

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

- [x] **Step 3: 验证路径并提交**

```powershell
ls docs/vendor/opencut-classic/LICENSE
ls docs/vendor/opencut-classic/apps/web/src/timeline, docs/vendor/opencut-classic/apps/web/src/services/renderer, docs/vendor/opencut-classic/apps/web/src/services/video-cache
# 若任一路径不存在：ls docs/vendor/opencut-classic/apps/web/src 找实际目录名，同步修正 VENDOR.md 移植清单后再提交
git add docs/vendor/opencut-classic && git commit -m "chore(vendor): opencut-classic MIT 快照入仓（timeline/renderer/video-cache 参考库）"
```

---

### Task 2: 安装新依赖

**Files:**
- Modify: `apps/web/package.json`

- [x] **Step 1: 安装**

```bash
pnpm -C apps/web add mediabunny@^1.56.1 @mediabunny/aac-encoder@^1.56.1 soundtouchjs@0.3.0
```

- [x] **Step 2: 验证版本并提交**

```bash
grep -E "mediabunny|soundtouch" apps/web/package.json
# 预期: mediabunny ^1.56.1 / @mediabunny/aac-encoder ^1.56.1 / soundtouchjs 0.3.0（精确锁）
git add apps/web/package.json pnpm-lock.yaml && git commit -m "chore(deps): mediabunny + aac-encoder + soundtouchjs(0.3.0 精确锁)"
```

---

### Task 3: soundtouchjs Go/No-Go Spike（半天关卡）

**Files:**
- Create: `docs/superpowers/spikes/soundtouch-spike.mjs`（Node 离线验证；放 spikes/ 不占 vendor/ 语义）

验证三项（spec 附录 A）：① 0.5×/2× 音质；② Worker 内 ESM 导入；③ 离线整段 PCM 处理。任一不过 → 切 WSOLA 自实现（+3~5 天预案），**继续本 plan 其余任务不受阻（音频链在 Plan 3）**。

- [x] **Step 1: 前置——确认库的 ESM 入口（决定 Spike ② 结论）**

```bash
cat apps/web/node_modules/soundtouchjs/package.json | grep -E '"main"|"module"|"exports"|"version"'
# 若无 module/exports 字段（2021 老库可能只有 dist UMD）：Spike ② 结论=需 import 其 dist 路径包一层，记录到结论行
```

- [x] **Step 2: 写 Node 离线验证脚本**

```js
// docs/superpowers/spikes/soundtouch-spike.mjs
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

- [x] **Step 3: 跑 Spike 并记录结论**

```bash
node docs/superpowers/spikes/soundtouch-spike.mjs
```

在 spike 文件末尾追加结论行（示例）：`// CONCLUSION 2026-09-10: ③ PASS（2x tempo 输出 1s 等效）；② 于 Plan 3 Worker 内验证；① 浏览器音质人工判定`

- [x] **Step 4: 提交**

```bash
git add docs/superpowers/spikes && git commit -m "chore(spike): soundtouchjs Go/No-Go 验证（离线 PCM/ESM 导入）"
```

---

### Task 4: Prisma VideoProject migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（新增 model + 三处反向字段）
- Create: `apps/api/prisma/migrations/<本地时间戳>_add_video_project/migration.sql`（migrate dev 生成）

- [x] **Step 1: schema 增加 model（插在 VideoSeparateTask 之后）**

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

- [x] **Step 2: 三个既有模型补反向字段**

在 `model Team`、`model User`、`model CanvasProject` 的字段区各加一行：

```prisma
  videoProjects VideoProject[]
```

- [x] **Step 3: 生成并应用 migration**

记忆红线：migration 目录名用**本地时间戳**、需 CREATEDB 授权、禁 db push：

```bash
pnpm -C apps/api exec prisma migrate dev --name add_video_project
# 预期: 生成 migration.sql 含 CREATE TABLE "VideoProject" + 3 个 index + 3 个 FK
pnpm -C apps/api exec prisma generate
```

- [x] **Step 4: 验证并提交**

```bash
pnpm -C apps/api test
# 预期: 既有测试全绿（schema 追加不破坏现有）
# 若 tsc 报 prisma.videoProject 不存在——Step 3 的 prisma generate 未生效，重跑一次即可
git add apps/api/prisma && git commit -m "feat(db): VideoProject 模型（sourceNodeId 唯一/三关系级联/三索引）"
```

---

### Task 5: ProjectData 共享类型 + DTO（TDD）

**Files:**
- Create: `packages/shared/src/types/video-project.ts`
- Create: `apps/web/src/pages/canvas/video-editor/types.ts`（re-export，Plan 2/3 消费）
- Test: `apps/api/src/modules/video-project/video-project.dto.spec.ts`
- Create: `apps/api/src/modules/video-project/video-project.dto.ts`

- [x] **Step 1: 写 shared 类型（严格按 spec 第三节，strict 模式）**

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

/** shared 层跨 Node/浏览器两侧运行——crypto.randomUUID 在 CJS Node/非 HTTPS 浏览器不可用，必须 fallback */
let idCounter = 0;
export function genId(prefix: string): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return `${prefix}-${c.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

/** 默认空工程：1 视频 + 1 字幕 + 2 音频，空 clips */
export function createDefaultProjectData(): ProjectData {
  return {
    version: 1, fps: 30,
    tracks: [
      { id: genId('track'), type: 'video',    name: '视频',  muted: false, hidden: false, clips: [] },
      { id: genId('track'), type: 'subtitle', name: '字幕1', muted: false, hidden: false, clips: [] },
      { id: genId('track'), type: 'audio',    name: '音频1', muted: false, hidden: false, clips: [] },
      { id: genId('track'), type: 'audio',    name: '音频2', muted: false, hidden: false, clips: [] },
    ],
    clips: {},
  };
}
```

在 `packages/shared/src/index.ts`（若存在 barrel）追加 export；并在 `apps/web/src/pages/canvas/video-editor/types.ts` 写 `export * from '@flowweb/shared/types/video-project';`（若 shared 无 barrel 则按 material-library.ts 的既有导出方式对齐）。

- [x] **Step 2: 写 DTO 校验失败测试**

```ts
// apps/api/src/modules/video-project/video-project.dto.spec.ts
import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateVideoProjectDto, PatchVideoProjectDto } from './video-project.dto';

describe('video-project DTO', () => {
  it('合法 create 通过', async () => {
    const dto = plainToInstance(CreateVideoProjectDto, {
      workflowId: 'wp1', sourceNodeId: 'node-1', title: 'x',
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

- [x] **Step 3: 跑测试确认失败（模块不存在）**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project/video-project.dto.spec.ts
# 预期: FAIL（Cannot find module './video-project.dto'）
```

- [x] **Step 4: 写 DTO**

```ts
// apps/api/src/modules/video-project/video-project.dto.ts
import { IsString, IsObject, IsDateString, IsNumber, IsIn } from 'class-validator';

export class CreateVideoProjectDto {
  @IsString() workflowId!: string;
  @IsString() sourceNodeId!: string;
  @IsString() title!: string;
  @IsObject() data!: object; // ProjectData 结构由前端 shared 类型保证；服务端挡非对象
}
export class PatchVideoProjectDto {
  @IsObject() data!: object;
  @IsDateString() baseUpdatedAt!: string; // 乐观锁基准
}
export class RegenerateDto {
  @IsString() sourceNodeId!: string; // 素材源节点（非剪辑节点）
  @IsString() workflowId!: string;   // 漏了它 whitelist 会剥离 → svc.assertEditor(undefined) 真机挂（服务层测试直传对象测不到）
  @IsIn(['video', 'audio']) kind!: 'video' | 'audio'; // @IsString 只验"是字符串"不验枚举——必须 @IsIn
}
```

- [x] **Step 5: 跑测试通过并提交**

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

- [x] **Step 1: 写失败测试**

```ts
// apps/api/src/modules/video-project/video-project.service.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VideoProjectService } from './video-project.service';

const mkPrisma = (over: any = {}) => ({
  videoProject: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...over,
  },
  canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) }, // teamId 派生查询
});
const perm = { assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR') };
const collab = { readCanvas: vi.fn() };
const execution = { execute: vi.fn() }; // 第 4 参——Task 11 regenerate 用，签名一次到位（避免中途改构造器）

describe('VideoProjectService', () => {
  let svc: VideoProjectService; let prisma: any;
  beforeEach(() => {
    prisma = mkPrisma();
    svc = new VideoProjectService(prisma, perm as any, collab as any, execution as any);
  });

  it('upsertByNode 幂等：并发双调用只产生一条记录 + teamId 服务端派生', async () => {
    prisma.videoProject.upsert.mockResolvedValue({ id: 'p1', sourceNodeId: 'n1', data: { version: 1 } });
    const r = await svc.upsertByNode({ workflowId: 'w1', sourceNodeId: 'n1', userId: 'u1', title: 'x' });
    expect(prisma.videoProject.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.videoProject.upsert.mock.calls[0][0].where).toEqual({ sourceNodeId: 'n1' });
    expect(prisma.videoProject.upsert.mock.calls[0][0].create).toMatchObject({ teamId: 't1' }); // 派生值（勿信客户端——assertEditor 只验 workflow 编辑权不验 teamId 归属）
    expect(r.id).toBe('p1');
  });

  it('patch 乐观锁：updatedAt 不匹配抛 409', async () => {
    prisma.videoProject.findUnique.mockResolvedValue({ id: 'p1', workflowId: 'w1', updatedAt: new Date('2026-09-10T01:00:00Z') });
    await expect(svc.patch('p1', 'u1', { data: {}, baseUpdatedAt: '2026-09-10T00:00:00Z' }))
      .rejects.toThrow(ConflictException);
    expect(prisma.videoProject.update).not.toHaveBeenCalled();
  });

  it('patch 成功返回新 updatedAt 供前端回填', async () => {
    prisma.videoProject.findUnique.mockResolvedValue({ id: 'p1', workflowId: 'w1', updatedAt: new Date('2026-09-10T01:00:00Z') });
    prisma.videoProject.update.mockResolvedValue({ id: 'p1', updatedAt: new Date('2026-09-10T02:00:00Z') });
    const r = await svc.patch('p1', 'u1', { data: {}, baseUpdatedAt: '2026-09-10T01:00:00Z' });
    expect(perm.assertEditor).toHaveBeenCalledWith('w1', 'u1');
    expect(prisma.videoProject.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { data: {} } });
    expect(r.updatedAt).toEqual(new Date('2026-09-10T02:00:00Z'));
  });

  it('patch 记录不存在 → 404', async () => {
    prisma.videoProject.findUnique.mockResolvedValue(null);
    await expect(svc.patch('p404', 'u1', { data: {}, baseUpdatedAt: '2026-09-10T00:00:00Z' }))
      .rejects.toThrow(NotFoundException);
    expect(prisma.videoProject.update).not.toHaveBeenCalled();
  });

  it('deleteByNode 仅删记录不级联 Media', async () => {
    prisma.videoProject.findUnique.mockResolvedValue({ id: 'p1', workflowId: 'w1' });
    await svc.deleteByNode('n1', 'u1');
    expect(prisma.videoProject.delete).toHaveBeenCalledWith({ where: { sourceNodeId: 'n1' } });
  });

  it('deleteByNode 记录不存在静默返回', async () => {
    prisma.videoProject.findUnique.mockResolvedValue(null);
    await svc.deleteByNode('n404', 'u1');
    expect(prisma.videoProject.delete).not.toHaveBeenCalled();
  });

  it('upsertByNode 归属校验：sourceNodeId 已属于其他画布 → 403 不返回数据', async () => {
    prisma.videoProject.findUnique.mockResolvedValue({ id: 'p9', workflowId: 'other-workflow' });
    await expect(svc.upsertByNode({ workflowId: 'w1', sourceNodeId: 'n1', userId: 'u1', title: 'x' }))
      .rejects.toThrow(ForbiddenException);
    expect(prisma.videoProject.upsert).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project/video-project.service.spec.ts
# 预期: FAIL（Cannot find module './video-project.service'）
```

- [x] **Step 3: 写实现**

```ts
// apps/api/src/modules/video-project/video-project.service.ts
import { Injectable, Inject, ConflictException, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { ExecutionService } from '../execution/execution.service';

@Injectable()
export class VideoProjectService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(CollabDocumentService) private readonly collab: CollabDocumentService,
    @Inject(ExecutionService) private readonly execution: ExecutionService, // Task 11 regenerate 用——签名一次到位，避免 Task 11 中途改构造器
  ) {}

  /** upsert by sourceNodeId（@unique）——幂等防双击；update 分支同样全量返回；
   *  teamId 服务端从 workflowId 派生（assertEditor 只验 workflow 编辑权不验 teamId 归属——客户端传 teamId 会造不一致脏行） */
  async upsertByNode(input: { workflowId: string; sourceNodeId: string; userId: string; title: string; data?: unknown }) {
    await this.perm.assertEditor(input.workflowId, input.userId);
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: input.workflowId },
      select: { teamId: true },
    });
    if (!project) throw new BadRequestException('项目不存在'); // 显式抛错（与 Task 10 register 统一）——防 assertEditor 契约变更时 project! 静默 TypeError
    const existing = await this.prisma.videoProject.findUnique({ where: { sourceNodeId: input.sourceNodeId } });
    if (existing && existing.workflowId !== input.workflowId) {
      throw new ForbiddenException('sourceNodeId 已属于其他画布'); // 归属校验——nodeId 全局唯一键下防跨画布读/抢占（质量评审 I1：update:{} 命中他人记录会原样返回全量行）
    }
    return this.prisma.videoProject.upsert({
      where: { sourceNodeId: input.sourceNodeId },
      create: {
        teamId: project.teamId, userId: input.userId, workflowId: input.workflowId,
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
    if (!proj) throw new NotFoundException('project not found'); // 404 语义——409 留给版本冲突（前端可静默停止自动保存，质量评审 M1）
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

- [x] **Step 4: 跑测试通过**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project/video-project.service.spec.ts
# 预期: 7 PASS
```

> **执行期修订记录（2026-09-10 质量评审，提交 69ce425f）**：I1——upsertByNode 补 workflowId 归属校验（403，防 update:{} 命中他人记录原样返回全量行的跨画布越权读）；M1——patch 记录不存在改 404（原 409 语义错位，前端可静默停止自动保存）；M2/M4——fixture 补 workflowId 钉住权限先于时戳比对 + 三个分支用例。上方代码块已同步。

- [x] **Step 5: 提交**

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

- [x] **Step 1: 写失败测试**

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
    await ctrl.create({ workflowId: 'w1', sourceNodeId: 'n1', title: 'x', data: {} } as any, req);
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

- [x] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project/video-project.controller.spec.ts
# 预期: FAIL（Cannot find module）
```

- [x] **Step 3: 写 controller + module 并注册**

```ts
// apps/api/src/modules/video-project/video-project.controller.ts
import { Controller, Post, Get, Patch, Delete, Body, Param, Req, UsePipes, ValidationPipe, Inject } from '@nestjs/common';
import { VideoProjectService } from './video-project.service';
import { CreateVideoProjectDto, PatchVideoProjectDto } from './video-project.dto';

@Controller('api/video-projects')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true })) // ValidationPipe 非全局，必须自挂
export class VideoProjectController {
  // @Inject 显式 token（执行期修订：本仓 vitest 走 esbuild 无 emitDecoratorMetadata，裸参数属性
  // 在 TestingModule 下注入 undefined——全仓 23 个被测 controller 均用 @Inject，本仓惯例）
  constructor(@Inject(VideoProjectService) private readonly svc: VideoProjectService) {}

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
import { BullModule } from '@nestjs/bullmq';
import { VideoProjectController } from './video-project.controller';
import { VideoProjectService } from './video-project.service';
import { CollabModule } from '../collab/collab.module';
import { TeamModule } from '../team/team.module';            // StorageQuotaService + ProjectPermissionService 已 export——勿手动 provide（会造第二实例）
import { ExecutionModule } from '../execution/execution.module'; // ExecutionService 已 export——无循环依赖，无需 forwardRef
import { THUMBNAIL_GENERATOR_QUEUE, THUMBNAIL_GENERATOR_CONNECTION } from '../material-library/constants/material-library.constants';

@Module({
  imports: [
    CollabModule,
    TeamModule,
    ExecutionModule,
    BullModule.registerQueue({ name: THUMBNAIL_GENERATOR_QUEUE, configKey: THUMBNAIL_GENERATOR_CONNECTION }), // 队列非全局，本模块必须注册
  ],
  controllers: [VideoProjectController],
  providers: [VideoProjectService], // Task 10 时追加 GeneratedMediaService（本 task 不建占位空类）
})
export class VideoProjectModule {}
```

> 注：MinioService 来自 @Global() 的 MinioModule 无需 import；GeneratedMediaService 到 Task 10 创建文件时同步追加进 providers。Task 11 的 ExecutionService 经 ExecutionModule 注入构造器（`@Inject(ExecutionService) private readonly execution: ExecutionService`），**不用 forwardRef**。**不做整模块编译测试**：ExecutionModule 有 `{ provide: 'REDIS_CLIENT', useFactory: () => new Redis(env.REDIS_URL) }` + 4 个 Bull 队列 + Processor、CollabModule 又两个 Redis 实例——`Test.createTestingModule({ imports: [VideoProjectModule] }).compile()` 会真实连接外部服务且 overrideProvider 对 import 进来的 provider 不可靠（本仓 createTestingModule({imports}) 零先例）——DI 接线由 Task 10 的 **provider 级 getQueueToken 冒烟**拦截（对齐 material.service.spec.ts 既有惯例）。

`app.module.ts` 的 `imports` 数组追加 `VideoProjectModule`（import 路径 `./modules/video-project/video-project.module`）。

- [x] **Step 4: 全量测试通过并提交**

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

- [x] **Step 1: 写失败测试**

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

- [x] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/api exec vitest run src/modules/execution/is-executable-node.spec.ts
# 预期: FAIL（Cannot find module）
```

- [x] **Step 3: 写谓词并接入两处**

```ts
// apps/api/src/modules/execution/is-executable-node.ts
const EXECUTABLE_TYPES = new Set(['textInput', 'imageGen', 'imageExtGen', 'videoGen', 'audioGen', 'multiImageGen']);

/** 白名单真正生效场景：全部执行 / nodeIds 批量执行（单节点 getScope 只收上游，产物边方向 剪辑→产物） */
export function isExecutableNode(node: { type: string; data?: Record<string, unknown> | null }): boolean {
  if (!EXECUTABLE_TYPES.has(node.type)) return false;
  if ((node.data as any)?.origin === 'video-edit') return false; // 导出产物节点：无 model，跳过防误重跑扣费
  if ((node.data as any)?.__ephemeral === true) return false; // A1 影子残留兜底（Task 11 执行期补）：影子全局排除，regenerate 直调路径在 execute 循环单独放行
  return true;
}
```

`validation.service.ts` 的 `validateAll` 循环：`if (node.type === 'textInput') continue;` 一行**之前**插入：

```ts
      if (!isExecutableNode(node)) continue;
```

（随后的 textInput 判断可保留不动——谓词已涵盖，保留无碍。）

`execution.service.ts` 的 execute 循环（L65 `for (const node of orderedNodes) {` 之后、`this.gateway.emitNodeStatus(...'loading')` **之前**）插入（Task 11 执行期修订后的最终形态——__ephemeral 影子全局排除 + regenerate 单节点直调放行）：

```ts
      // 防剪辑/产物节点闪 loading 与误执行；影子唯一放行口 = regenerate 的单 nodeId 直调（nodeIds 批量模式 nodeId 为 undefined，批量中影子仍被排除）
      if (!isExecutableNode(node) && !(nodeId === node.id && String(node.id).startsWith('shadow-'))) continue;
```

同时 validateAll 顶部的 modelIds 收集 filter 改为 `nodes.filter(n => isExecutableNode(n) && n.type !== 'textInput')`（防 videoEdit 无 model 进 modelIds）。

- [x] **Step 4: 跑测试 + 既有 execution 测试不破**

```bash
pnpm -C apps/api exec vitest run src/modules/execution/is-executable-node.spec.ts
pnpm -C apps/api exec vitest run src/modules/execution
# 预期: 新 4 PASS + 既有 execution.*.spec 全绿
```

- [x] **Step 5: 提交**

```bash
git add apps/api/src/modules/execution && git commit -m "feat(execution): isExecutableNode 白名单（类型+产物标记，validation/execute 前置过滤防 loading 闪烁）（TDD）"
```

---

### Task 9: collabDoc insertNode/removeNode 原语（TDD：fillDoc 同构 + 跨端同步实测）

> **机制修正（Plan 审核 P0-1）**：原 SHADOW_ORIGIN 方案证伪——withDoc 的 `connection.transact(fn)` 无 origin 参数（Yjs 嵌套事务 origin 由最外层决定，内层 transact 的 origin 是死代码），且 **Yjs transaction.origin 不跨网络传输**（update 二进制不含 origin，客户端 applyUpdate 的 origin 是应用方自己的）——前端 onRemote 永远读不到服务端 origin。**短路判据改为影子节点 id 前缀 + `__ephemeral`**（跨网络可靠，Plan 2 的 onRemote 扫 events 命中的 nodes key 是否全部 `shadow-` 前缀）。

**Files:**
- Create: `apps/api/src/modules/collab/node-doc.util.ts`
- Modify: `apps/api/src/modules/collab/collab-document.service.ts`（新增两方法）
- Test: `apps/api/src/modules/collab/node-doc.util.spec.ts`

- [x] **Step 1: 写失败测试（同构契约 + 跨端同步实测——后者固化"origin 不过网"认知）**

```ts
// apps/api/src/modules/collab/node-doc.util.spec.ts
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildShadowNodeYMap } from './node-doc.util';

describe('buildShadowNodeYMap（与 ydocBuilder.fillDoc 逐键同构）', () => {
  it('type/position(Y.Map 必写)/data(Y.Map) 结构同构，影子 data 带 __ephemeral', () => {
    // yjs prelim 机制：孤儿 Y.Map 集成进 doc 前内容不可读（执行期修订：原版测试必然失败而非假绿）
    const doc = new Y.Doc();
    const m = buildShadowNodeYMap({ id: 'shadow-video-x', type: 'videoGen', position: { x: -99999, y: -99999 }, data: { model: 'm', __ephemeral: true } });
    doc.getMap('nodes').set('shadow-video-x', m);
    expect(m.get('type')).toBe('videoGen');
    expect(m.get('position')).toBeInstanceOf(Y.Map);
    expect((m.get('position') as Y.Map<any>).get('x')).toBe(-99999);
    const data = m.get('data') as Y.Map<any>;
    expect(data).toBeInstanceOf(Y.Map);
    expect(data.get('__ephemeral')).toBe(true);
  });
  it('无 parentId 键（fillDoc 同构：parentId null 时省略，防差异循环）', () => {
    const doc = new Y.Doc();
    const m = buildShadowNodeYMap({ id: 'shadow-x', type: 'videoGen', position: { x: 0, y: 0 }, data: {} });
    doc.getMap('nodes').set('shadow-x', m);
    expect(m.get('parentId')).toBeUndefined();
  });
});

describe('跨端同步实测（固化机制认知）', () => {
  it('服务端 origin 不随 update 过网——客户端 applyUpdate 后 origin 是自己的，故短路判据必须用 id 前缀', () => {
    const server = new Y.Doc();
    const client = new Y.Doc();
    server.on('update', (u) => Y.applyUpdate(client, u, 'network'));
    // 观察者必须在影子写入之前注册——否则 observeDeep 未触发，断言落入 'unset' 恒真假绿窗口（执行期修订）
    let observedOrigin: unknown = 'unset';
    client.getMap('nodes').observeDeep((events) => { observedOrigin = events[0].transaction.origin; });
    // 服务端以任意 origin 写入影子节点
    server.transact(() => {
      server.getMap('nodes').set('shadow-video-1', buildShadowNodeYMap({ id: 'shadow-video-1', type: 'videoGen', position: { x: 0, y: 0 }, data: { __ephemeral: true } }));
    }, 'server-shadow');
    // 客户端视角：影子节点可见（data.__ephemeral 可判），但事务 origin 是 'network' 而非 'server-shadow'
    const shadow = client.getMap('nodes').get('shadow-video-1') as Y.Map<any>;
    expect(shadow).toBeDefined();
    expect((shadow.get('data') as Y.Map<any>).get('__ephemeral')).toBe(true);
    expect(observedOrigin).toBe('network'); // 客户端 observe 到的是传输层 origin——服务端 'server-shadow' 不可见（update 二进制不含 origin）
  });
});
```

- [x] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/api exec vitest run src/modules/collab/node-doc.util.spec.ts
# 预期: FAIL（Cannot find module './node-doc.util'）
```

- [x] **Step 3: 写实现 + service 两方法**

```ts
// apps/api/src/modules/collab/node-doc.util.ts
import * as Y from 'yjs';

export interface ShadowNodeInput {
  id: string; // 必须以 'shadow-' 前缀命名——前端 onRemote 以此为短路判据（origin 不过网，见 spec v3.6 修正）
  type: 'videoGen' | 'audioGen';
  width?: number; height?: number; // 条件写所需（执行期修订：实现引用 n.width/n.height，接口缺字段 TS strict 报错）
  position: { x: number; y: number };
  data: Record<string, unknown>; // 必含 __ephemeral: true
}

/** 与前端 ydocBuilder.fillDoc 逐键同构：type / parentId?(null 省略) / width?/height?(可选条件写) / position(Y.Map 必写) / data(Y.Map) */
export function buildShadowNodeYMap(n: ShadowNodeInput): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('type', n.type);
  if (n.width != null) m.set('width', n.width);
  if (n.height != null) m.set('height', n.height);
  const position = new Y.Map<unknown>();
  position.set('x', n.position.x);
  position.set('y', n.position.y);
  m.set('position', position);
  const data = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(n.data)) data.set(k, v);
  m.set('data', data);
  return m;
}
```

`collab-document.service.ts` 追加两方法（类内；顶部 `import { buildShadowNodeYMap } from './node-doc.util';`）：

```ts
  /** A1 影子节点：整节点写入。事务 origin 无意义（不过网）——前端 onRemote 以 id 前缀 shadow- 短路 */
  async insertNode(projectId: string, node: Parameters<typeof buildShadowNodeYMap>[0]) {
    await this.withDoc(projectId, (doc) => {
      doc.getMap('nodes').set(node.id, buildShadowNodeYMap(node));
    });
  }

  async removeNode(projectId: string, nodeId: string) {
    await this.withDoc(projectId, (doc) => {
      doc.getMap('nodes').delete(nodeId);
    });
  }
```

- [x] **Step 4: 跑测试通过 + 提交**

```bash
pnpm -C apps/api exec vitest run src/modules/collab
# 预期: 新 3 PASS（同构 2 + 跨端 1）+ 既有 collab spec 全绿
git add apps/api/src/modules/collab && git commit -m "feat(collab): insertNode/removeNode 原语（fillDoc 同构；短路判据=shadow- 前缀，origin 不过网实测固化）（TDD）"
```

> **执行期修订记录（2026-09-10，提交 88e428b9 + 9b9b35a6）**：① 接口补可选 `width?/height?`（plan 代码块自相矛盾——实现引用 n.width/n.height 但接口无字段）；② 同构测试补"集成进 doc"前置两行（yjs 13.6.32 prelim 机制：孤儿 Y.Map 集成前 get 不可读——原版测试 1 必然失败、测试 2 靠"任何 get 都 undefined"假绿）；③ 跨端测试 observeDeep 前置注册 + 断言改 `toBe('network')`（原 `not.toBe('server-shadow')` 恒真假绿，锁力为零）。上方代码块已同步。

---

### Task 10: generated 产物登记接口（TDD：POST 直传 + 实际大小落库）

**Files:**
- Create: `apps/api/src/modules/video-project/generated-media.service.ts`
- Modify: `apps/api/src/modules/video-project/video-project.controller.ts`（+2 路由）
- Modify: `apps/api/src/modules/video-project/video-project.module.ts`（providers）
- Modify: `apps/api/src/modules/material-library/consumers/thumbnail-generator.consumer.ts`（**执行期补**：job 解构 `seekSec?: number` + `timestamps: [seekSec ?? 1]`——spec L341 要求的抽帧时间点参数，原 Files 遗漏；默认 1 保持旧行为）
- Test: `apps/api/src/modules/video-project/generated-media.service.spec.ts` + `apps/api/src/modules/material-library/consumers/thumbnail-generator.consumer.spec.ts`（执行期新建）

- [x] **Step 1: 写失败测试**

```ts
// apps/api/src/modules/video-project/generated-media.service.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ForbiddenException } from '@nestjs/common';
import { GeneratedMediaService } from './generated-media.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { StorageQuotaService } from '../team/storage-quota.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { THUMBNAIL_GENERATOR_QUEUE } from '../material-library/constants/material-library.constants';

describe('GeneratedMediaService（复用状态机语义，方法自建）', () => {
  let svc: GeneratedMediaService; let prisma: any; let minio: any; let quota: any; let perm: any; let thumb: any;
  const base = { userId: 'u1', workflowId: 'w1', videoProjectId: 'p1', resolution: '1080p', durationSec: 60 }; // 无 teamId——服务端派生

  beforeEach(() => {
    prisma = {
      media: { create: vi.fn().mockResolvedValue({ id: 'm1' }), findUnique: vi.fn(), update: vi.fn().mockResolvedValue({ id: 'm1' }) },
      canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
    };
    minio = {
      buildKey: vi.fn().mockReturnValue('results/u1/w1/n1/2026-09-10/uuid.mp4'),
      generatePresignedPost: vi.fn().mockResolvedValue({ url: 'http://minio/post', fields: { key: 'results/u1/w1/n1/2026-09-10/uuid.mp4' } }),
      // statSize 是新方法：内部消化 HeadObjectCommand 的 ContentLength，直接返回数字
      statSize: vi.fn().mockResolvedValue(12_345_678),
    };
    quota = { assertCanUpload: vi.fn().mockResolvedValue(undefined) };
    perm = { assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR') };
    thumb = { add: vi.fn().mockResolvedValue(undefined) };
    svc = new GeneratedMediaService(prisma, minio, quota, perm, thumb);
  });

  it('register（编码完成后调用，actualSize=Blob.size）: teamId 服务端派生 + 建 pending Media + presigned POST + 配额终判', async () => {
    const r = await svc.register({ ...base, actualSize: 12_345_000 });
    expect(r.mediaId).toBe('m1');
    expect(r.upload.url).toBe('http://minio/post');
    expect(perm.assertEditor).toHaveBeenCalledWith('w1', 'u1'); // 权限门
    expect(prisma.canvasProject.findUnique).toHaveBeenCalledWith({ where: { id: 'w1' }, select: { teamId: true } }); // 派生而非客户端传入
    expect(quota.assertCanUpload).toHaveBeenCalledWith('t1', 12_345_000);
    expect(minio.generatePresignedPost).toHaveBeenCalledWith('results/u1/w1/n1/2026-09-10/uuid.mp4', 'video/mp4', 12_345_000);
    expect(prisma.media.create.mock.calls[0][0].data).toMatchObject({ teamId: 't1', type: 'generated', status: 'pending', mimeType: 'video/mp4', size: 12_345_000 });
  });

  it('confirm: statSize 实际大小落库 + 缩略图 seekSec 从 metadata.durationSec 读', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', userId: 'u1', key: 'k.mp4', metadata: { durationSec: 30 } });
    await svc.confirm('u1', { mediaId: 'm1' }); // 不再收 key/时长——均从 register 时落的记录读
    expect(minio.statSize).toHaveBeenCalledWith('k.mp4');
    expect(prisma.media.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'm1' },
      data: expect.objectContaining({ status: 'completed', size: 12_345_678 }),
    }));
    expect(thumb.add).toHaveBeenCalledWith('generate-thumbnail',
      expect.objectContaining({ mediaId: 'm1', key: 'k.mp4', mimeType: 'video/mp4', seekSec: 3 })); // max(1, 30*0.1)
  });

  it('confirm: 归属校验失败拒绝', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', userId: 'other' });
    await expect(svc.confirm('u1', { mediaId: 'm1' })).rejects.toThrow(ForbiddenException);
  });

  // provider 级 DI 冒烟（本仓惯例 getQueueToken 模式）——整模块 compile 会撞 ExecutionModule/CollabModule 的
  // Redis useFactory 真实连接（见 Task 7 注），故用此法拦截"忘写 BullModule.registerQueue"的接线错误
  it('DI 可解析（@InjectQueue token 满足）', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        GeneratedMediaService,
        { provide: PrismaService, useValue: {} },
        { provide: MinioService, useValue: {} },
        { provide: StorageQuotaService, useValue: {} },
        { provide: ProjectPermissionService, useValue: {} },
        { provide: getQueueToken(THUMBNAIL_GENERATOR_QUEUE), useValue: { add: vi.fn() } },
      ],
    }).compile();
    expect(mod.get(GeneratedMediaService)).toBeDefined();
  });
});
```

- [x] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project/generated-media.service.spec.ts
# 预期: FAIL（Cannot find module）
```

- [x] **Step 3: 写实现**

```ts
// apps/api/src/modules/video-project/generated-media.service.ts
import { Injectable, Inject, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { StorageQuotaService } from '../team/storage-quota.service'; // 实际在 team/ 模块（TeamModule 已 export）
import { ProjectPermissionService } from '../team/project-permission.service';
import { THUMBNAIL_GENERATOR_QUEUE } from '../material-library/constants/material-library.constants';

@Injectable()
export class GeneratedMediaService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(StorageQuotaService) private readonly quota: StorageQuotaService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @InjectQueue(THUMBNAIL_GENERATOR_QUEUE) private readonly thumbnailQueue: Queue,
  ) {}

  /**
   * 登记入口——**编码完成后调用**（前端持有 Blob，actualSize = Blob.size）。
   * 时序关键：generatePresignedPost 的 Conditions 含 content-length-range ±1024——
   * 编码前估算体积过不了该条件，必须用真实字节数（spec v3.6 时序修正）。
   * teamId 服务端从 workflowId 派生（assertCanUpload 无成员校验——客户端传他团 teamId
   * 会打他团配额并把产物记到他团名下；对齐 storage.service.presignUpload 的 projectId 派生先例）。
   */
  async register(input: { userId: string; workflowId: string; videoProjectId: string; resolution: string; durationSec: number; actualSize: number }) {
    await this.perm.assertEditor(input.workflowId, input.userId);
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: input.workflowId },
      select: { teamId: true },
    });
    if (!project) throw new BadRequestException('项目不存在');
    const teamId = project.teamId;
    await this.quota.assertCanUpload(teamId, input.actualSize); // 配额终判（真实大小）
    const key = this.minio.buildKey('generated', input.userId, { projectId: input.workflowId, ext: 'mp4' });
    const media = await this.prisma.media.create({
      data: {
        userId: input.userId, teamId, projectId: input.workflowId,
        bucket: 'flowai', key, originalName: `export-${input.resolution}.mp4`,
        mimeType: 'video/mp4', size: input.actualSize,
        type: 'generated', status: 'pending',
        metadata: { origin: 'video-project', videoProjectId: input.videoProjectId, resolution: input.resolution, durationSec: input.durationSec },
      },
    });
    const upload = await this.minio.generatePresignedPost(key, 'video/mp4', input.actualSize);
    return { mediaId: media.id, upload }; // upload: { url, fields }——前端 FormData 逐字段填 + file 最后追加
  }

  /** 确认：statSize 实际大小落库（无 ±1024 比对——勿误调 storage.confirmUpload）+ 缩略图 seekSec 从 metadata 读 */
  async confirm(userId: string, dto: { mediaId: string }) {
    const media = await this.prisma.media.findUnique({ where: { id: dto.mediaId } });
    if (!media || media.userId !== userId) throw new ForbiddenException('media not found');
    const actualSize = await this.minio.statSize(media.key); // 统一口径（ContentLength ?? 0）——stats.size 不存在，真机必 undefined
    const durationSec = Number((media.metadata as any)?.durationSec ?? 0);
    const seekSec = Math.max(1, durationSec * 0.1); // 防前导黑场黑帧；consumer 需支持可选 seekSec（默认 1 保持旧行为）
    await this.thumbnailQueue.add('generate-thumbnail',
      { mediaId: media.id, key: media.key, mimeType: 'video/mp4', seekSec });
    return this.prisma.media.update({
      where: { id: media.id },
      data: { status: 'completed', size: actualSize },
    });
  }
}
```

**MinioService 顺手加固**（`modules/minio/minio.service.ts` 追加，同口径防第三处踩坑；storage.service.ts L85 的 `stats.ContentLength ?? 0` **顺手改用** `statSize()`——防两套口径并存）：

```ts
  /** 统一大小口径：HeadObjectCommand 输出是 ContentLength（无 size 字段） */
  async statSize(key: string): Promise<number> {
    const stats = await this.statObject(key);
    return stats.ContentLength ?? 0;
  }
```

**三个新端点补 DTO**（ValidationPipe 对 `Record<string, any>` 不生效——whitelist/必填全空转，与 Task 7 红线自相矛盾）。`video-project.dto.ts` 追加：

```ts
export class RegisterGeneratedDto {
  @IsString() workflowId!: string;
  @IsString() videoProjectId!: string;
  @IsIn(['720p', '1080p']) resolution!: string;
  @IsNumber() durationSec!: number;
  @IsNumber() actualSize!: number; // 编码后真实字节（presigned POST ±1024 Conditions 要求）
}
export class ConfirmGeneratedDto { @IsString() mediaId!: string; }
export class RemoveShadowDto { @IsString() workflowId!: string; @IsString() shadowNodeId!: string; }
```

（顶部 import 追加 `IsNumber, IsIn`。RegisterGeneratedDto **不带 teamId**——服务端从 workflowId 派生（P0-B：assertCanUpload 无成员校验，客户端 teamId 是越权面）。）Controller 路由签名相应改为 `@Body() dto: RegisterGeneratedDto` / `ConfirmGeneratedDto` / `RemoveShadowDto`；`video-project.controller.ts` 顶部 DTO import 行同步扩为全部六个（Task 11 追加路由时不再改 import）：

```ts
import { CreateVideoProjectDto, PatchVideoProjectDto, RegenerateDto, RegisterGeneratedDto, ConfirmGeneratedDto, RemoveShadowDto } from './video-project.dto';
```

同时 `video-project.module.ts` 的 providers 追加 `GeneratedMediaService`（Task 7 预留位）并补 import。

Controller 追加（同文件——**构造器改两参**，这是 Task 7 → Task 10 唯一一处构造器变更；注意沿用 Task 7 执行期修订的 **@Inject 显式 token** 模式——裸参数属性在本仓 esbuild vitest 下注入 undefined）：

```ts
  constructor(
    @Inject(VideoProjectService) private readonly svc: VideoProjectService,
    @Inject(GeneratedMediaService) private readonly generated: GeneratedMediaService,
  ) {}
```

```ts
  @Post('generated-media/register')
  registerGenerated(@Body() dto: RegisterGeneratedDto, @Req() req: any) {
    return this.generated.register({ ...dto, userId: req.user?.id });
  }
  @Post('generated-media/confirm')
  confirmGenerated(@Body() dto: ConfirmGeneratedDto, @Req() req: any) {
    return this.generated.confirm(req.user?.id, dto);
  }
```

- [x] **Step 4: 跑测试 + 提交**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project
# 预期: 全部 PASS
git add apps/api/src && git commit -m "feat(video-project): generated 登记接口（presigned POST 直传/实际大小落库/缩略图抽帧点）（TDD）"
```

> **执行期修订记录（2026-09-10，提交 01107759 + 9bdd5045）**：① **Gap 1 闭合**——thumbnail consumer 补 seekSec 支持（spec L341"须给 consumer 加抽帧时间点参数"在原 Files 遗漏；`timestamps: [seekSec ?? 1]` + 新建 consumer spec 两用例，默认 1 回归保护）；② 伴随改动——storage.service.spec mock 同步 statSize（断言不变）/ controller.spec 补 GeneratedMediaService 空 provider / minio.service.spec +2 statSize 用例；③ Gap 2 登记（低危不阻塞）——generated confirm 无 assertOnConfirm 二次配额终判（content-length-range ±1024 已物理锁死上传大小与声明一致，并发绕过窗口 ≤1KB 不可利用；一期接受）。

---

### Task 11: regenerate A1 影子节点接口（TDD）

**Files:**
- Modify: `apps/api/src/modules/video-project/video-project.service.ts`（+regenerate）
- Modify: `apps/api/src/modules/video-project/video-project.controller.ts`（+1 路由）
- Test: `apps/api/src/modules/video-project/video-project.regenerate.spec.ts`

- [x] **Step 1: 写失败测试**

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
    svc = new VideoProjectService(prisma, perm as any, collab as any, execution as any); // 构造器 4 参（Task 6 已一次到位）
  });

  it('源节点存在且为生成类型：克隆影子→直调 execute（不带 sv）→返回 shadowNodeId', async () => {
    collab.readCanvas.mockResolvedValue({
      nodes: [{ id: 'src1', type: 'videoGen', position: { x: 1, y: 2 }, data: { model: 'm', prompt: { text: 't' } } }],
      edges: [],
    });
    const r = await svc.regenerate('u1', { sourceNodeId: 'src1', workflowId: 'w1', kind: 'video' });
    expect(collab.insertNode).toHaveBeenCalledWith('w1', expect.objectContaining({
      id: expect.stringContaining('shadow-'),
      type: 'videoGen',
      data: expect.objectContaining({ __ephemeral: true, model: 'm' }), // JSON 整份深拷
    }));
    expect(execution.execute).toHaveBeenCalledWith('w1', expect.any(String), 'u1'); // 可选参不钉死为契约
    expect(r.shadowNodeId).toBeTruthy();
  });

  it('源节点类型不匹配：400（video/audio 两分支显式传 kind——防"缺省 kind 因错误原因通过"）', async () => {
    collab.readCanvas.mockResolvedValue({ nodes: [{ id: 'x', type: 'videoEdit', data: {} }], edges: [] });
    await expect(svc.regenerate('u1', { sourceNodeId: 'x', workflowId: 'w1', kind: 'video' })).rejects.toThrow(BadRequestException);
    await expect(svc.regenerate('u1', { sourceNodeId: 'x', workflowId: 'w1', kind: 'audio' })).rejects.toThrow(BadRequestException);
  });
  it('源节点不存在：400', async () => {
    collab.readCanvas.mockResolvedValue({ nodes: [], edges: [] });
    await expect(svc.regenerate('u1', { sourceNodeId: 'nope', workflowId: 'w1', kind: 'video' })).rejects.toThrow(BadRequestException);
  });
});
```

- [x] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project/video-project.regenerate.spec.ts
# 预期: FAIL（svc.regenerate 不是函数）
```

- [x] **Step 3: 写实现（service 追加方法；构造器注入 ExecutionService 用前向引用防循环依赖）**

`video-project.service.ts` 追加方法（构造器第 4 参 `@Inject(ExecutionService) execution` 已在 Task 6 一次到位——经 Task 7 的 ExecutionModule 注入，**不用 forwardRef**）：

```ts
  /**
   * A1 影子节点克隆生成：
   * 1. readCanvas 找 sourceNode → JSON 整份深拷 data（禁止字段挑拣——取词链 content 优先/prompt 嵌套）
   * 2. insertNode 影子（shadow- 前缀 + __ephemeral 判据——前端 onRemote 以此短路防 applyDocToStore
   *    全量重建闪烁；origin 不过网已实测，见 Task 9 跨端用例）
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
      position: { x: -99999, y: -99999 }, // 次保险：主判据是 shadow- 前缀+__ephemeral（store 投影与渲染层双重过滤），position 仅让万一漏过滤的渲染远离视口
      data: clonedData,
    });
    const result = await this.execution.execute(dto.workflowId, shadowId, userId); // 直调，无 sv
    return { shadowNodeId: shadowId, result };
  }

  /** 前端 done 回流后调用：删影子节点（重复删 no-op 安全） */
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
  removeShadow(@Body() dto: RemoveShadowDto, @Req() req: any) {
    return this.svc.removeShadow(req.user?.id, dto);
  }
```

> execute 为同步串行可能数分钟——前端 axios 对这两个端点单独放大超时（Plan 4 处理）。

> **执行期修订记录（2026-09-10，提交 3c23434b）**：Task 11 评审发现残留影子幽灵执行风险（客户端崩溃时影子永久残留 doc，在白名单内会被"全部执行"真实执行+扣费且用户不可见）——isExecutableNode 全局排除 `__ephemeral`（Task 8 代码块已同步）+ execute 循环白名单行为"单 nodeId 直调且 shadow- 前缀"放行（regenerate 唯一合法入口）。

- [x] **Step 4: 跑测试 + 提交**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project
# 预期: 全部 PASS
git add apps/api/src && git commit -m "feat(video-project): regenerate A1 影子节点（JSON 整份克隆/shadow- 前缀判据/服务端直调 execute）（TDD）"
```

---

### Task 12: media batch 批查接口（TDD）

**Files:**
- Create: `apps/api/src/modules/media/media-batch.service.ts`
- Create: `apps/api/src/modules/media/media.dto.ts`
- Modify: `apps/api/src/modules/media/media.controller.ts`（+1 路由 + 方法级 ValidationPipe + 构造器注入 MediaBatchService，前缀已是 `api/media`）
- Modify: `apps/api/src/modules/media/media.module.ts`（providers 追加 MediaBatchService——PrismaService/MinioService 来自全局模块无需 import）
- Test: `apps/api/src/modules/media/media-batch.service.spec.ts`

- [x] **Step 1: 写失败测试**

```ts
// apps/api/src/modules/media/media-batch.service.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { MediaBatchService } from './media-batch.service';

describe('MediaBatchService（左面板聚合：按 mediaId 集合查，绕开 type 硬编码过滤）', () => {
  let svc: MediaBatchService; let prisma: any; let minio: any;
  beforeEach(() => {
    prisma = {
      media: { findMany: vi.fn().mockResolvedValue([{ id: 'm1', key: 'k1.mp4', thumbnailKey: 't1.jpg' }]) },
      teamMember: { findFirst: vi.fn().mockResolvedValue({ role: 'MEMBER' }) }, // assertTeamMember 的查询形状（team.util.ts L29）
    };
    minio = { generatePresignedGetUrl: vi.fn().mockResolvedValue('http://signed') }; // 构造器第 2 参——缺了 batchGet 必 TypeError
    svc = new MediaBatchService(prisma, minio);
  });

  it('按 ids 批查 + 成员校验 + presigned URL', async () => {
    const r = await svc.batchGet('u1', 't1', ['m1', 'm2']);
    expect(prisma.teamMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teamId: 't1', userId: 'u1' }) }));
    expect(prisma.media.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] }, teamId: 't1', deletedAt: null },
      select: expect.objectContaining({ id: true, key: true, mimeType: true }),
    });
    expect(r).toHaveLength(1);
    expect(r[0].url).toBe('http://signed');
    expect(r[0].thumbnailUrl).toBe('http://signed');
  });

  it('他团 teamId → 403（非成员不暴露存在性，findMany 不触发）', async () => {
    prisma.teamMember.findFirst.mockResolvedValueOnce(null);
    await expect(svc.batchGet('u1', 't-other', ['m1'])).rejects.toThrow(ForbiddenException);
    expect(prisma.media.findMany).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: 确认失败 → Step 3: 实现**

```ts
// apps/api/src/modules/media/media-batch.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { getOwnerTeamId, assertTeamMember } from '../team/team.util';

@Injectable()
export class MediaBatchService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  /** 按 mediaId 集合查（避开 type='generated' 硬编码过滤）+ presigned URL——对齐 material.service 既有口径；
   *  teamId 走 resolveTeamId 同款门（folder.service.ts L19 先例）：缺省回落本人默认团队，外部传入必过 assertTeamMember（P0-B——纯客户端 teamId 是越权面） */
  async batchGet(userId: string, teamId: string | undefined, ids: string[]) {
    const resolved = teamId ?? (await getOwnerTeamId(this.prisma, userId));
    await assertTeamMember(this.prisma, resolved, userId);
    const rows = await this.prisma.media.findMany({
      where: { id: { in: ids }, teamId: resolved, deletedAt: null },
      select: { id: true, key: true, originalName: true, mimeType: true, size: true, thumbnailKey: true, metadata: true, createdAt: true },
    });
    return Promise.all(rows.map(async (r) => ({
      ...r,
      url: await this.minio.generatePresignedGetUrl(r.key, 3600),
      thumbnailUrl: r.thumbnailKey ? await this.minio.generatePresignedGetUrl(r.thumbnailKey, 3600) : null,
    })));
  }
}
```

`media.controller.ts` 追加（构造器注入 `private readonly batchService: MediaBatchService`——**执行期修订**：plan 原文参数名 `batch` 与方法名 `batch` 同名触发 TS2300，改 batchService 对齐既有 mediaService/minioService 命名；teamId 走 `@Query` 对齐 file.controller.ts 模式；DTO 补齐防 Record 空转）：

```ts
  // 方法级 ValidationPipe（media.controller 无 class 级 pipe——不挂则 @ArrayMaxSize 等 DTO 装饰器纯装饰，
  // ids 不校验不剥离）；@Query 裸 string 依然不经过 pipe（ValidationPipe 只作用 body 的 metatype）——
  // teamId 为 Prisma 等值 where 无注入面，越权已由 batchGet 内 assertTeamMember 封堵
  @Post('batch')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  batch(@Req() req: any, @Query('teamId') teamId: string | undefined, @Body() dto: BatchGetMediaDto) {
    return this.batch.batchGet(req.user?.id, teamId, dto.ids);
  }
```

（`media.controller.ts` 顶部 import 追加 `Post, Body, UsePipes, ValidationPipe` from '@nestjs/common' 与 `BatchGetMediaDto` from './media.dto'。）

`BatchGetMediaDto`（就近放 media 模块内新建 `media.dto.ts`）：

```ts
import { IsArray, IsString, ArrayMaxSize } from 'class-validator';
export class BatchGetMediaDto {
  @IsArray() @IsString({ each: true }) @ArrayMaxSize(200) ids!: string[]; // 上限防 findMany 被万级 ids 砸
}
```

- [x] **Step 4: 跑测试 + 全量回归 + 提交**

```bash
pnpm -C apps/api test
# 预期: 全绿
git add apps/api/src && git commit -m "feat(media): POST /api/media/batch 批查（绕开 generated 过滤，左面板聚合用）（TDD）"
```

---

## Plan 1 完成判定

- **final review 结论（2026-09-10，Yes 可判定完成）**：975→976 API 测试 + 2049 web 测试全绿；8 路由 401 冒烟全过；spec 阶段 0/0.5/1 落地核对通过；9 端点权限盘点无越权残留。唯一 Important（removeShadow 未校验 shadow- 前缀——防借道删任意节点）已修复（提交 813dad7d）；spec API 表已同步补 4 端点 + DELETE 路径修正。
- `pnpm -C apps/api test` 全绿；`pnpm -C apps/web test` 不受影响
- 手动冒烟（可选）：本地起 API 后 `curl -X POST localhost:3000/api/video-projects -H 'Content-Type: application/json' -d '{...}'` 走 401（AuthGuard 生效即证明路由注册成功）
- spec 对应：附录 B 阶段 0/0.5/1 全部落地；验收 13/23/24 的服务端侧就绪
- **登记 gap（Task 6 质量评审 I2，已接受）**：spec 第九节"并发双 POST 只一条 / assertEditor 越权 403 真库断言"无集成测试落点——本仓无 supertest/测试库基建，一期以 DB `@unique` 约束物理兜底 + service 单测（越权/归属校验 mock 断言）+ 完成判定 curl 冒烟覆盖；spec 措辞已同步修正

## 后续 Plan（另开文件）

- Plan 2/4：VideoEditNode 全链路注册 + timeline 纯函数 TDD + store/时间轴 UI + 连线同步（syncAutoEdgesToDoc/订阅跳前缀/桥层测试）
- Plan 3/4：scene 纯函数 + 预览 + audio-engine + 右面板四态 + 转场关键帧
- Plan 4/4：Worker 导出 + 产物上画布 + socket 单例迁移 + AI 按钮 + 29 条验收
