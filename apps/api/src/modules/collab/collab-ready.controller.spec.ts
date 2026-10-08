// Y0a-3 T7 Step 4（Z14+V17）：端点级用例——路由注册 smoke（decorator metadata 反射；
// 无 supertest 先例→轻量直控 auth.controller.spec.ts 同款）+GET ready 两档视图（无 token 四键
// /持 token 全字段）+POST drain 守卫（403 fail-closed/凭据命中）+beginDraining+审计接线。
// 仓内先例（vitest_api_env_quirks）：esbuild 不发射 design:paramtypes——路由断言用
// PATH/METHOD/GUARDS 自定义 metadata（decorator 运行时 Reflect.defineMetadata，与框架同源）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { CollabReadyController } from './collab-ready.controller';
import { CollabAdminAuthGuard } from './collab-admin-auth.guard';

const PENDING = { projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, storeInFlight: 0, strandedFiles: 0, strandedBytes: 0 };

function fakeRes() {
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  return res;
}

/** V17 键断言走 JSON 序列化后的 wire 形态（res.json 里 undefined 值字段上线后即消失） */
function wireKeys(payload: unknown): string[] {
  return Object.keys(JSON.parse(JSON.stringify(payload))).sort();
}

describe('CollabReadyController', () => {
  let readyMock: Record<string, any>;
  let gatewayMock: Record<string, any>;
  let auditMock: Record<string, any>;
  let controller: CollabReadyController;
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = { ...process.env };
    readyMock = { getReady: vi.fn() };
    gatewayMock = { beginDraining: vi.fn() };
    auditMock = { log: vi.fn(async () => {}) };
    controller = new CollabReadyController(readyMock as any, gatewayMock as any, auditMock as any);
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('Z14 路由注册 smoke：@Controller("api")+GET ready+POST drain（decorator metadata——非 404 判据）', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CollabReadyController)).toBe('api');
    const proto = CollabReadyController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, proto.getReady)).toBe('ready');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.getReady)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, proto.drain)).toBe('drain');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.drain)).toBe(RequestMethod.POST);
  });

  it('Z14/Z15：drain 挂 CollabAdminAuthGuard；类级 @SkipThrottle（探针不吃限流桶）', () => {
    const proto = CollabReadyController.prototype;
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.drain)).toEqual([CollabAdminAuthGuard]);
    // @SkipThrottle() 类级：throttler v6 置 THROTTLER:SKIPdefault metadata 于类（throttler.decorator.js:32）
    expect(Reflect.getMetadata('THROTTLER:SKIPdefault', CollabReadyController)).toBe(true);
  });

  it('V17 两档：无 token 响应体仅 {ready,reason,redis,epoch} 四键（503 档）', async () => {
    delete process.env.COLLAB_ADMIN_TOKEN;
    delete process.env.PROMETHEUS_TOKEN;
    readyMock.getReady.mockResolvedValue({
      status: 503,
      body: { ready: false, reason: 'lease-held', holder: 'other', epoch: '9', holderRenewedAgoMs: 5, redis: 'up', pending: PENDING, spoolQuarantined: 0 },
    });
    const res = fakeRes();
    await controller.getReady({ headers: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(wireKeys(res.json.mock.calls[0][0])).toEqual(['epoch', 'ready', 'reason', 'redis']);
  });

  it('V17 两档：无 token 200 档同样裁剪（无 holder/pending——内部信息不出公网面）', async () => {
    delete process.env.COLLAB_ADMIN_TOKEN;
    delete process.env.PROMETHEUS_TOKEN;
    readyMock.getReady.mockResolvedValue({ status: 200, body: { ready: true, redis: 'up', pending: PENDING, spoolQuarantined: 0 } });
    const res = fakeRes();
    await controller.getReady({ headers: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(wireKeys(res.json.mock.calls[0][0])).toEqual(['ready', 'redis']);
  });

  it('V17 两档：持有效 x-prometheus-token=全字段（holder/pending/spoolQuarantined 保留）', async () => {
    process.env.PROMETHEUS_TOKEN = 'tok';
    const full = { ready: false, reason: 'lease-held', holder: 'other', epoch: '9', holderRenewedAgoMs: 5, redis: 'up', pending: PENDING, spoolQuarantined: 2 };
    readyMock.getReady.mockResolvedValue({ status: 503, body: full });
    const res = fakeRes();
    await controller.getReady({ headers: { 'x-prometheus-token': 'tok' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(full);
  });

  it('V17 两档：token 已设但 header 失配→仍走公开裁剪档', async () => {
    process.env.PROMETHEUS_TOKEN = 'tok';
    readyMock.getReady.mockResolvedValue({ status: 200, body: { ready: true, holder: 'me', redis: 'up', pending: PENDING, spoolQuarantined: 0 } });
    const res = fakeRes();
    await controller.getReady({ headers: { 'x-prometheus-token': 'wrong' } } as any, res);
    expect(wireKeys(res.json.mock.calls[0][0])).toEqual(['ready', 'redis']);
  });

  it('Y0a-4/N16：授权档透传 loadedDocs/connections（容量观测兄弟字段）；公开档四键裁剪不外泄（V17 契约零动）', async () => {
    process.env.PROMETHEUS_TOKEN = 'tok';
    const full = { ready: false, reason: 'lease-held', epoch: '9', redis: 'up' as const, pending: PENDING, spoolQuarantined: 0, loadedDocs: 7, connections: 9 };
    readyMock.getReady.mockResolvedValue({ status: 503, body: full });
    const resAuth = fakeRes();
    await controller.getReady({ headers: { 'x-prometheus-token': 'tok' } } as any, resAuth);
    expect(resAuth.status).toHaveBeenCalledWith(503);
    expect(resAuth.json).toHaveBeenCalledWith(full);   // 授权档全字段透传（新键不过滤）
    const resPub = fakeRes();
    await controller.getReady({ headers: {} } as any, resPub);
    expect(wireKeys(resPub.json.mock.calls[0][0])).toEqual(['epoch', 'ready', 'reason', 'redis']);   // 公开档四键——loadedDocs/connections 不外泄
  });

  describe('POST /api/drain（CollabAdminAuthGuard fail-closed）', () => {
    function ctxFor(headers: Record<string, string>) {
      const req = { headers };
      return { switchToHttp: () => ({ getRequest: () => req }) } as any;
    }

    it('无令牌环境（生产形态）→403 fail-closed', () => {
      process.env.NODE_ENV = 'test';   // 显式非 development——dev fail-open 分支不触
      delete process.env.COLLAB_ADMIN_TOKEN;
      delete process.env.PROMETHEUS_TOKEN;
      const guard = new CollabAdminAuthGuard();
      expect(() => guard.canActivate(ctxFor({}))).toThrow(/fail-closed/);
    });

    it('Y0a-4/W23 换装：仅设 PROMETHEUS_TOKEN 不再授予 drain 权（fail-closed）；失配→403', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.COLLAB_ADMIN_TOKEN;
      process.env.PROMETHEUS_TOKEN = 'tok';
      const guard = new CollabAdminAuthGuard();
      expect(() => guard.canActivate(ctxFor({ 'x-prometheus-token': 'tok' }))).toThrow();   // 监控令牌≠停机权（不回退）
      process.env.COLLAB_ADMIN_TOKEN = 'adm';
      expect(guard.canActivate(ctxFor({ 'x-prometheus-token': 'adm' }))).toBe(true);
      expect(() => guard.canActivate(ctxFor({ 'x-prometheus-token': 'nope' }))).toThrow();
    });

    it('drain 动作体：beginDraining 接线+audit.log 审计（Z15）+返回 {draining,autoReleaseAt,pending}', async () => {
      gatewayMock.beginDraining.mockReturnValue({ draining: true, phase: 'draining', autoReleaseAt: 1719999999999, pending: PENDING });
      const r = await controller.drain();
      expect(gatewayMock.beginDraining).toHaveBeenCalledTimes(1);
      expect(r).toEqual({ draining: true, autoReleaseAt: 1719999999999, pending: PENDING });
      expect(auditMock.log).toHaveBeenCalledTimes(1);
      expect(auditMock.log).toHaveBeenCalledWith(expect.objectContaining({
        operatorId: 'system:drain',
        operatorName: 'system:drain',
        targetType: 'COLLAB_LEASE',
        targetId: 'primary',
        action: 'collab_drain',
        afterValue: { autoReleaseAt: 1719999999999 },
        remark: `pending=${JSON.stringify(PENDING)}`,
      }));
    });

    it('审计失败容忍：audit.log reject→仍返回 drain 体（drain 已生效不得 500 中断部署链，break-glass 同判）', async () => {
      gatewayMock.beginDraining.mockReturnValue({ draining: true, phase: 'draining', autoReleaseAt: 1719999999999, pending: PENDING });
      auditMock.log.mockRejectedValue(new Error('pg down'));
      const errSpy = vi.spyOn((controller as any).logger, 'error');
      const r = await controller.drain();
      expect(r).toEqual({ draining: true, autoReleaseAt: 1719999999999, pending: PENDING });
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy.mock.calls[0][0]).toEqual(expect.objectContaining({ event: 'drain_audit_failed' }));
    });
  });
});
