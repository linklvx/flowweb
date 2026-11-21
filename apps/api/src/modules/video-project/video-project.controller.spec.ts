// apps/api/src/modules/video-project/video-project.controller.spec.ts
// Y4a T8（spec §0 条 9）：VideoProject 表整删+REST 工程面退场——控制器只留
// regenerate/export-precheck/register/confirm 四路由。红相两段：
//  A 静态源断言：POST /、GET by-node/:id、PATCH :id、DELETE by-node/:id 四路由的装饰器+方法
//    已从源码消失（Nest 未注册=404 的结构面；源文本断言先例 telemetry.controller.spec A 段）；
//  B 真实 HTTP 集成（telemetry.controller.spec C 段同款装置）：四删路由 404+四留路由 200 契约。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { VideoProjectController } from './video-project.controller';
import { VideoProjectService } from './video-project.service';
import { GeneratedMediaService } from './generated-media.service';

const CTRL_SRC = readFileSync(resolve(__dirname, './video-project.controller.ts'), 'utf8');

describe('VideoProjectController 路由面（Y4a T8：工程 CRUD 四路由退场）', () => {
  it('静态源断言：@Post()（无参根路径）、by-node/:id GET/PATCH/DELETE 四路由零注册', () => {
    expect(CTRL_SRC).not.toMatch(/@Post\(\)\s*\n\s*create\(/);          // POST /api/video-projects
    expect(CTRL_SRC).not.toMatch(/@Get\('by-node\/:sourceNodeId'\)/);   // GET by-node
    expect(CTRL_SRC).not.toMatch(/@Patch\(':id'\)/);                    // PATCH :id
    expect(CTRL_SRC).not.toMatch(/@Delete\('by-node\/:sourceNodeId'\)/); // DELETE by-node
    expect(CTRL_SRC).not.toContain('upsertByNode');
    expect(CTRL_SRC).not.toContain('deleteByNode');
  });
  it('静态源断言：CreateVideoProjectDto/PatchVideoProjectDto 引用随链消失（DTO 删）', () => {
    expect(CTRL_SRC).not.toContain('CreateVideoProjectDto');
    expect(CTRL_SRC).not.toContain('PatchVideoProjectDto');
  });
});

describe('VideoProjectController 留存路由（真实 HTTP 集成）', () => {
  let app: INestApplication;
  let base: string;
  let svc: { regenerate: ReturnType<typeof vi.fn>; exportPrecheck: ReturnType<typeof vi.fn> };
  let generated: { register: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    svc = {
      regenerate: vi.fn().mockResolvedValue({ retakeId: 'r1', result: { success: true } }),
      exportPrecheck: vi.fn().mockResolvedValue({ ok: true }),
    };
    generated = {
      register: vi.fn().mockResolvedValue({ mediaId: 'm1', upload: { url: 'http://x/post', fields: { key: 'k' } } }),
      confirm: vi.fn().mockResolvedValue({ fileId: 'm1' }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [VideoProjectController],
      providers: [
        { provide: VideoProjectService, useValue: svc },
        { provide: GeneratedMediaService, useValue: generated },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    await app.listen(0);
    base = await app.getUrl();
  });
  afterAll(async () => { await app.close(); });

  const post = (path: string, body: unknown) => fetch(`${base}/api/video-projects${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  it('留存四路由 200 契约：regenerate/export-precheck/register/confirm', async () => {
    const r1 = await post('/regenerate', { workflowId: 'w1', sourceNodeId: 'src1', kind: 'video', retakeId: 'r1' });
    expect(r1.status).toBe(201);   // Nest @Post 缺省 201（telemetry 用 @HttpCode 改 200——本控制器无改码）
    const r2 = await post('/export-precheck', { workflowId: 'w1', estimatedSize: 1024 });
    expect(r2.status).toBe(201);
    const r3 = await post('/generated-media/register', { workflowId: 'w1', sourceNodeId: 'edit1', resolution: '720p', durationSec: 60, actualSize: 1000, clientRequestId: 'req-1' });
    expect(r3.status).toBe(201);
    const r4 = await post('/generated-media/confirm', { mediaId: 'm1' });
    expect(r4.status).toBe(201);
    expect(svc.regenerate).toHaveBeenCalledTimes(1);
    expect(svc.exportPrecheck).toHaveBeenCalledTimes(1);
    expect(generated.register).toHaveBeenCalledTimes(1);
    expect(generated.confirm).toHaveBeenCalledTimes(1);
  });

  it('工程 CRUD 四路由不存在（Nest 未注册=404）', async () => {
    const c1 = await fetch(`${base}/api/video-projects`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflowId: 'w1', sourceNodeId: 'n1', title: 'x' }),
    });
    expect(c1.status).toBe(404);   // POST /（upsert 面）
    const c2 = await fetch(`${base}/api/video-projects/by-node/n1`);
    expect(c2.status).toBe(404);   // GET by-node/:id
    const c3 = await fetch(`${base}/api/video-projects/p1`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: {}, baseUpdatedAt: '2026-01-01T00:00:00Z' }),
    });
    expect(c3.status).toBe(404);   // PATCH :id
    const c4 = await fetch(`${base}/api/video-projects/by-node/n1`, { method: 'DELETE' });
    expect(c4.status).toBe(404);   // DELETE by-node/:id
  });
});
