// apps/api/src/common/recovery-import-body-limit.spec.ts —— T30b 切换演练实弹发现的回归锚
// （2026-11-03，gate-evidence/t30b-cutover-drill 问题清单 P-1）：
// T25 收口 C-2 的路由级 json limit 裸注册 body-parser（函数名=jsonParser），Nest
// registerParserMiddleware 的 isMiddlewareApplied('jsonParser') 按函数名检测 ⇒ 误判全局
// parser 已装而**跳过注册** ⇒ 除 recovery-import 外全部路由的 JSON POST body 停在 {}
// （execute/enqueue/sign-in 全 500/静默失败——exec-smoke 实弹 500 复现）。
// 红例形态：与 main.ts 同源 wiring（applyRecoveryImportBodyLimit 后 listen），断言**其他路由**
// body 仍被解析（行为锚）+ 装置中间件函数名不碰撞（结构锚——双保险）。
import { describe, it, expect, afterAll } from 'vitest';
import { Controller, Post, Body } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { applyRecoveryImportBodyLimit } from './recovery-import-body-limit';

@Controller('api/t30b-echo')
class T30bEchoController {
  @Post()
  echo(@Body() body: unknown): { got: unknown } {
    return { got: body };
  }
}

describe('T30b 实弹发现 P-1：路由级 json limit 不得压制 Nest 全局 body parser（isMiddlewareApplied 名字碰撞）', () => {
  let app: INestApplication;
  let baseUrl: string;

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
  });

  it('红锚①（行为）：applyRecoveryImportBodyLimit 后其他路由 JSON body 仍被解析（修前={}/500 面）', async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [T30bEchoController] }).compile();
    app = moduleRef.createNestApplication();
    applyRecoveryImportBodyLimit(app);   // main.ts 同源 wiring（先于 init/listen——与生产栈序一致）
    await app.listen(0);
    const port = (app.getHttpServer().address() as { port: number }).port;
    baseUrl = `http://127.0.0.1:${port}`;
    const res = await fetch(`${baseUrl}/api/t30b-echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world', projectId: 'p1' }),
    });
    expect(res.ok).toBe(true);   // Nest @Post 缺省 201——红锚取 ok（修前的失败在 body 非状态码）
    const j = (await res.json()) as { got?: unknown };
    expect((j.got as { hello?: string })?.hello).toBe('world');   // 修前：全局 parser 未注册 → got={}
  });

  it('红锚②（结构）：recovery-import 路由层的中间件函数名 ≠ jsonParser（修前=裸 json 以 jsonParser 之名入栈触发 Nest 跳过；修后全局 jsonParser 恰 1=全局注册恢复）', async () => {
    const inst = app.getHttpAdapter().getInstance() as unknown as Record<string, { stack?: Array<{ handle?: { name?: string }; regexp?: RegExp }> }>;
    const stack = inst._router?.stack ?? [];
    const recoveryLayers = stack.filter((l) => String(l.regexp ?? '').includes('recovery-import'));
    expect(recoveryLayers.length).toBeGreaterThan(0);
    for (const l of recoveryLayers) expect(l.handle?.name ?? '').not.toBe('jsonParser');
    expect(stack.filter((l) => l.handle?.name === 'jsonParser').length).toBe(1);   // 全局 parser 恰一层（修前=0——被名字碰撞吞掉）
  });
});
