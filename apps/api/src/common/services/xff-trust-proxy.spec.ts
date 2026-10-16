// apps/api/src/common/services/xff-trust-proxy.spec.ts
// Y0c T36（Z14③/Z46+RN4）：XFF 统一 req.ip——trust proxy 语义链双锚（http-order.spec 先例形态）。
// 手写 getClientIp（无条件采信 XFF 首元素=伪造面，绕过 trust proxy 防线）已删——消费方
// （auth.controller:94/:129+video-work.controller recordView）与全局 ThrottlerModule tracker
// （TelemetryThrottlerGuard 回落 super=req.ip）同吃 req.ip 单源（Z14③ 两条通道同批覆盖）。
// ① 静态锚：main.ts trust proxy 设置行文本锚（防静默移除——移除即本静态锚红（行为锚独立锁语义））+
//    rate-limiter.service.ts 手写解析零残留（禁垫片：转发壳也算残留）；
// ② 行为锚：Nest 测试 app 配 main.ts 同款 trust proxy 'loopback'+回显路由（测试内路由非生产面），
//    proxy-addr 语义三档：loopback 直连+XFF 单值⇒该值；XFF 链⇒右起首个非 loopback（左端伪造
//    被忽略=nginx $proxy_add_x_forwarded_for 追加语义防线，runbook §3.8）；无 XFF⇒socket 地址。
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { Controller, Get, Module, Req } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

// ---------- ① 静态锚 ----------
const MAIN_TS = readFileSync(resolve(__dirname, '../../main.ts'), 'utf8');
const RATE_LIMITER_TS = readFileSync(resolve(__dirname, './rate-limiter.service.ts'), 'utf8');

describe('T36 XFF 单源（静态锚）', () => {
  it("main.ts 含 app.set('trust proxy', 'loopback')（结构锚防静默移除——移除即本静态锚红（行为锚独立锁语义））", () => {
    expect(MAIN_TS).toContain("app.set('trust proxy', 'loopback')");
  });

  it("main.ts listen 携带绑定面：app.listen(env.PORT, env.API_BIND_ADDR ?? '127.0.0.1')（Z14①——全网 0.0.0.0 默认退役，nginx 同机反代唯一路径）", () => {
    expect(MAIN_TS, '实现前红：listen 无第二参（全网监听）').toMatch(/app\.listen\(env\.PORT,\s*env\.API_BIND_ADDR \?\? '127\.0\.0\.1'\)/);
  });

  it('rate-limiter.service.ts 手写 XFF 解析零残留（getClientIp 已删——转发壳=垫片亦禁）', () => {
    expect(RATE_LIMITER_TS, '实现前红：手写 XFF 首元素采信解析仍在').not.toMatch(/x-forwarded-for/i);
    expect(RATE_LIMITER_TS, '实现前红：getClientIp 仍在').not.toMatch(/getClientIp/);
  });
});

// ---------- ② 行为锚：真实 HTTP 全链路（镜像 main.ts trust proxy 配置） ----------
@Controller('__xff-probe')
class XffProbeController {
  @Get('ip')
  ip(@Req() req: any): { ip: string | undefined } {
    return { ip: req.ip };
  }
}

@Module({ controllers: [XffProbeController] })
class XffProbeModule {}

describe('T36 trust proxy loopback 语义（行为锚——proxy-addr 三档）', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [XffProbeModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    (app as unknown as NestExpressApplication).set('trust proxy', 'loopback');   // 镜像 main.ts:122（唯一信任前提）
    await app.init();
    await app.listen(0);
    const addr = app.getHttpServer().address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;   // 钉死 IPv4 loopback 直连（socket 地址确定性——③档判据面）
  });

  afterAll(async () => {
    await app.close();
  });

  const getIp = async (xff?: string): Promise<string> => {
    const res = await fetch(`${base}/__xff-probe/ip`, { headers: xff ? { 'x-forwarded-for': xff } : {} });
    return ((await res.json()) as { ip: string }).ip;
  };

  it("① loopback 直连+XFF '1.2.3.4' ⇒ req.ip='1.2.3.4'（信任 loopback 跳后取右起首个非 loopback）", async () => {
    expect(await getIp('1.2.3.4')).toBe('1.2.3.4');
  });

  it("② XFF 链 '1.2.3.4, 9.9.9.9' ⇒ req.ip='9.9.9.9'——链首伪造值被忽略（反转锚：旧手写 getClientIp 无条件采信首元素='1.2.3.4'；追加语义防线=伪造不可键控，§0.6 偏离 57）", async () => {
    expect(await getIp('1.2.3.4, 9.9.9.9')).toBe('9.9.9.9');
  });

  it('③ 无 XFF ⇒ socket 地址（IPv4 loopback 直连档——双栈监听下 IPv4 映射形态 ::ffff:127.0.0.1 等价；本地白名单语义面）', async () => {
    expect(['127.0.0.1', '::ffff:127.0.0.1']).toContain(await getIp());
  });
});
