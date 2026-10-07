// apps/api/src/modules/collab/collab-not-serving.filter.http-order.spec.ts
// Y0a-3 T8 复审 Critical 回归锚：全局 filter 注册序。Nest10 external-exception-filter-context
// `setCustomFilters(filters.reverse())`——后注册者先求值，宽 @Catch(HttpException) 壳若后注册
// 即遮蔽窄 Catch：标记体 code:'COLLAB_NOT_SERVING' 与 Retry-After 在真实 HTTP 路径不可达
// （filter 单测直调 catch() 探不到该遮蔽，必须走真实 HTTP 全链路）。
// 双锚设计：
//  ① 静态守卫——直接锚定 main.ts useGlobalFilters 注册序（行为镜像测试看不到 main.ts 回退）；
//  ② 行为集成——裸 TestingModule + 真实 Express 监听 ephemeral port + node fetch，
//     镜像 main.ts 修复后顺序注册（默认池，无 DATABASE_URL 依赖）。
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HttpExceptionFilter } from '../../filters/http-exception.filter';
import { CollabNotServingFilter } from './collab-not-serving.filter';

// ---------- ① 静态守卫：main.ts 注册序（Nest10 反转求值 → 窄 Catch 必须最后注册） ----------
const MAIN_TS = readFileSync(resolve(__dirname, '../../main.ts'), 'utf8');

describe('全局 filter 注册序（main.ts 静态守卫）', () => {
  it('HttpExceptionFilter 必须先注册、CollabNotServingFilter 必须后注册（反转=后注册先求值）', () => {
    const m = MAIN_TS.match(/app\.useGlobalFilters\(([^;]*?)\)\s*;/);
    expect(m, 'main.ts 中未找到 app.useGlobalFilters 调用').toBeTruthy();
    // 严格断言完整注册列表（新增 filter 必须显式更新本守卫——强制先推理反转求值序）
    const registered = (m![1] as string)
      .split(',')
      .map((s) => s.replace(/\s+/g, ' ').trim());
    expect(registered).toEqual(['new HttpExceptionFilter()', 'new CollabNotServingFilter()']);
  });
});

// ---------- ② 行为集成：真实 HTTP 全链路（镜像 main.ts 修复后顺序） ----------
@Controller('__cns-order-probe')
class CnsOrderProbeController {
  @Get('marked')
  marked(): never {
    throw new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'x' });
  }

  @Get('plain')
  plain(): never {
    throw new ServiceUnavailableException('boom');
  }
}

@Module({ controllers: [CnsOrderProbeController] })
class CnsOrderProbeModule {}

describe('全局 filter 注册序（真实 HTTP 集成——镜像 main.ts 修复后顺序）', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [CnsOrderProbeModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // 镜像 main.ts：宽壳在前注册、窄 Catch 后注册（Nest10 反转=窄 Catch 先求值）
    app.useGlobalFilters(new HttpExceptionFilter(), new CollabNotServingFilter());
    await app.init();
    await app.listen(0);
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('标记 503 → 体含 code:COLLAB_NOT_SERVING（非 -1 壳）+ Retry-After: 2', async () => {
    const res = await fetch(`${base}/__cns-order-probe/marked`);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('2');
    const body = await res.json();
    expect(body.code).toBe('COLLAB_NOT_SERVING');
  });

  it('非标记 503 → 通用 -1 壳透出、无 Retry-After（不误伤）', async () => {
    const res = await fetch(`${base}/__cns-order-probe/plain`);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBeNull();
    expect(await res.json()).toEqual({ code: -1, data: null, message: 'boom' });
  });
});
