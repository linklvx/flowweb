// apps/api/src/main-worker.ts
// Y0c T26（Z101/Z102/Z138/Z139）：worker 进程引导——createApplicationContext（结构性零监听：
// controller/gateway 类仍被实例化，零的只是 HTTP/WS 监听——3000/3001 双 ECONNREFUSED 由本形态
// 构造性保证）。引导序列四段（顺序即语义）：
//  ①进程兜底+role 观测：installProcessErrorGuards 首行；setDefaultLabels({role:'worker'})（Z138
//    落点=引导层单点——main.ts role='api' 对位，census ⑳ 双文件各恰 1）；
//  ②Z102 ready 门：**先门后装配**（@Processor 实例化即开始消费——「订阅队列前」的唯一落点=
//    createApplicationContext 之前）；轮询 GET 127.0.0.1:3000/api/ready 上限 60s（env
//    WORKER_READY_TIMEOUT_MS 可调）超限 process.exit(1) 交 pm2 autorestart；
//  ③装配（WorkerModule 平铺 provider——偏离 30）+enableShutdownHooks；
//  ④3002 loopback 指标出口（Z139/Z116——node:http 返 register.metrics()；不进 nginx；
//    127.0.0.1 only；token fail-closed+WORKER_METRICS_PORT env 键化=T29-I 已落〔PROMETHEUS_TOKEN
//    同 token 形态经 validateEnv 透传〕；health 扩读归 T29 第二包）。
// 关停：SIGTERM/SIGINT ⇒ metrics server close+app.close()（BullMQ 既有 close 语义——processor
// in-flight 完成面），完成后 exit(0)。
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env') });

import { applyDatabaseUrlConnectionLimit, validateEnv } from './config/env';
// Y0c T32（Z11/§0.6 偏离 47）：connection_limit 显式预算（worker=4）——必须先于一切 PrismaClient
// 构造：authPrisma（auth/auth.ts:12 顶层自建）在 worker 亦随 worker.module→payment.gateway→auth.ts
// import 闭包构造。main.ts 同款调用位（dotenv 后立即——CJS require 顺序即语句顺序）。
applyDatabaseUrlConnectionLimit(process.env);

import { NestFactory } from '@nestjs/core';
import { register } from 'prom-client';
import { WorkerModule } from './worker.module';
import { installProcessErrorGuards } from './bootstrap/guard';
import { collabRoleInfo } from './modules/collab/store.metrics';
import { waitForApiReady, WORKER_READY_TIMEOUT_DEFAULT_MS } from './bootstrap/worker-ready-gate';
import { startWorkerMetricsServer, WORKER_METRICS_PORT } from './bootstrap/worker-metrics-server';

async function bootstrap() {
  // Y0b-5 T11 同款：进程兜底首行安装（引导期全程覆盖）
  installProcessErrorGuards();

  const env = validateEnv();

  // Z138：worker 侧全族默认 role 标签——引导层单点（禁模块级：register.clear() 连清 _defaultLabels）
  register.setDefaultLabels({ role: 'worker' });

  // Y0c T23（Z67③）：进程角色观测——worker 侧引导层单点
  collabRoleInfo.set({ role: 'worker' }, 1);
  console.log(JSON.stringify({ event: 'process_role', role: 'worker' }));

  // Z102 ready 门：先门后装配（@Processor 装配即订阅——超限非零退出交 pm2 autorestart）
  try {
    await waitForApiReady({
      url: `http://127.0.0.1:${env.PORT}/api/ready`,
      timeoutMs: env.WORKER_READY_TIMEOUT_MS ?? WORKER_READY_TIMEOUT_DEFAULT_MS,
    });
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  // 零监听装配（Z101：controller 仍实例化——零的只是监听）
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  // Z139/Z116：3002 loopback 指标出口（T29-I：port env 键化+PROMETHEUS_TOKEN 同 token 鉴权——
  // 值经 validateEnv 透传，server 文件零 env 裸读；production 未设 token 已由 superRefine 拒启）
  const metricsPort = env.WORKER_METRICS_PORT ?? WORKER_METRICS_PORT;
  const metricsServer = await startWorkerMetricsServer({
    port: metricsPort,
    token: env.PROMETHEUS_TOKEN,
    nodeEnv: env.NODE_ENV,
  });
  console.log(JSON.stringify({ event: 'worker_metrics', port: metricsPort, host: '127.0.0.1' }));

  const shutdown = async (signal: string) => {
    console.log(JSON.stringify({ event: 'worker_shutdown', signal }));
    metricsServer.close();
    await app.close().catch((err) => console.error('app.close 失败（继续退出）:', err));
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

// 评审 F2：装配期失败（createApplicationContext 抛错/3002 被占）须交 pm2 autorestart——
// installProcessErrorGuards 是「计数不退出」哲学，此处显式 exit(1) 与 Z102 ready 门同意图。
bootstrap().catch((err) => {
  console.error('worker bootstrap failed:', err);
  process.exit(1);
});
