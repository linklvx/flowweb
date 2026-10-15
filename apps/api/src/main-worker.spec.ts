// apps/api/src/main-worker.spec.ts
// Y0c T26：main-worker 引导序列文本锚（api vitest 环境陷阱先例——decorator metatype 断言用源码
// 文本；引导脚本不可直跑单测，行为面由 worker-ready-gate/worker-metrics-server 两 spec 承担，
// 本 spec 锁序列不变量：门先于装配/超限非零退出/role 标签/3002/关停钩子）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, 'main-worker.ts'), 'utf8');

describe('Y0c T26 main-worker 引导序列（Z102/Z138/Z139）', () => {
  it('Z102：ready 门先于装配（waitForApiReady 调用位置 < NestFactory.createApplicationContext——@Processor 实例化即订阅，门必须在装配前）', () => {
    const gateAt = src.indexOf('waitForApiReady(');
    const assembleAt = src.indexOf('NestFactory.createApplicationContext');
    expect(gateAt).toBeGreaterThanOrEqual(0);
    expect(assembleAt).toBeGreaterThan(gateAt);
  });

  it('Z102：超限 process.exit(1)（交 pm2 autorestart——非零退出码）', () => {
    expect(src).toMatch(/process\.exit\(1\)/);
  });

  it('Z138：setDefaultLabels({role:"worker"}) 引导层（census ⑳ 双文件各恰 1 的 worker 侧）', () => {
    expect(src).toContain("register.setDefaultLabels({ role: 'worker' })");
  });

  it('Z139：指标出口经 startWorkerMetricsServer（3002 P4 形态——node:http 独立 server）', () => {
    expect(src).toContain('startWorkerMetricsServer(');
  });

  it('Z116/T29：3002 出口传参——port 经 env.WORKER_METRICS_PORT（未设=使用点默认常量）+PROMETHEUS_TOKEN/NODE_ENV 透传（同 token 形态；server 文件零 env 裸读）', () => {
    expect(src).toContain('env.WORKER_METRICS_PORT');
    expect(src).toContain('env.PROMETHEUS_TOKEN');
    expect(src).toContain('env.NODE_ENV');
  });

  it('优雅关停：SIGTERM/SIGINT 钩子调 app.close()（BullMQ 既有 close 语义——processor in-flight 完成面）', () => {
    expect(src).toMatch(/SIGTERM/);
    expect(src).toMatch(/SIGINT/);
    expect(src).toMatch(/app\.close\(\)/);
  });

  it('Z101 措辞修正落注：零监听=createApplicationContext（非 controller 不实例化）', () => {
    expect(src).toMatch(/createApplicationContext/);
  });

  it('评审 F2：bootstrap().catch ⇒ exit(1)（装配期失败交 pm2 autorestart——guards「计数不退出」哲学的例外点）', () => {
    expect(src).toMatch(/bootstrap\(\)\.catch/);
    expect(src).toMatch(/process\.exit\(1\)/);
  });

  it('评审 F1：worker.module 求值序锚——team-recharge.service import 先于首个 processor（环：team-subscription↔team-recharge 装饰元数据求值序；重排则 DI 炸于真进程而单测被 spec 自身 import 掩盖）', () => {
    const wm = readFileSync(resolve(__dirname, 'worker.module.ts'), 'utf8');
    const rechargeAt = wm.indexOf("from './modules/team/team-recharge.service'");
    const firstProcessorAt = wm.indexOf("from './modules/execution/execution.processor'");
    expect(rechargeAt).toBeGreaterThan(-1);
    expect(firstProcessorAt).toBeGreaterThan(-1);
    expect(rechargeAt).toBeLessThan(firstProcessorAt);
  });
});
