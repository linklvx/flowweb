// apps/api/src/modules/worker-presence/worker-naming.int.spec.ts
// Y0c T31（§0.6 偏离 46）：worker 连接命名分裂真因 int 红测——T31 部署演练实测服务器 Redis
// CLIENT LIST：17 个 processor 连接 12 个 `undefined:<b64(queue)>`+5 个 `bull:<b64>`，付费两队列
// （execution/ai-image-edit）恰落 undefined 组 ⇒ api 侧 queue.getWorkers()（按自身 prefix 过滤
// CLIENT LIST——偏离 39 形态）registered=0 ⇒ 巡检 P0 + Z148② enqueue 门 503 拒收（消费面本身
// 正常——bullmq Worker 的键前缀走 QueueKeys 默认参数〔undefined 触发默认 'bull'〕而连接命名走
// `${this.opts.prefix}:` 模板串〔undefined 被字符串化〕——同库两路径对 undefined 语义不对称）。
// 分裂条件=@nestjs/bullmq@10.2.1 BullExplorer.getQueueOptions：worker.module 平铺装配（偏离 30）下
// **12 个队列在 worker 应用图内无 registerQueue/Queue 实例**（registerQueue 仅服务 @InjectQueue 注入
// 面——worker.module 头注①；feature 模块未被导入），moduleRef.get(queueToken) 抛 ⇒ catch 回落
// forRoot 共享配置——配置无 prefix 键 ⇒ `prefix: queueOpts.prefix` 显式传 undefined ⇒
// Object.assign({prefix:'bull'},{prefix:undefined}) 覆盖 ⇒ "undefined:" 命名。worker.module 自
// registerQueue 的 5 队列（ai-result-download/video-trim/video-separate/双 close-expired）Queue
// 实例可解析（.opts.prefix='bull' QueueBase 默认）⇒ bull: 命名——服务器 12/5 分裂与清单一一对应。
// 修复=forRoot 显式 prefix:'bull'（app.module+worker.module 两处——case C 源码结构断言执法）。
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BullModule, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

class NoopProcessor extends WorkerHost {
  async process(_job: Job): Promise<void> { /* 命名面测试零消费语义 */ }
}

function makeProcessor(queueName: string) {
  @Processor(queueName)
  class P extends NoopProcessor {}
  return P;
}

/** 特性模块（陷阱触发形态=生产真形：processor 在图内但该队列**无 registerQueue/Queue 实例**——
 *  worker.module 平铺装配下 12 队列同款；explorer getQueueOptions 落 forRoot 共享配置回落） */
function makeFeatureModule(queueName: string) {
  @Module({
    providers: [makeProcessor(queueName)],
  })
  class FeatureModule {}
  return FeatureModule;
}

/** 轮询 getWorkers 至 ≥expect 或超时（Worker SETNAME 在连接建立后——引导异步窗） */
async function workersAtLeast(q: Queue, expectN: number, timeoutMs = 8000): Promise<number> {
  const t0 = Date.now();
  for (;;) {
    const n = (await q.getWorkers()).length;
    if (n >= expectN || Date.now() - t0 > timeoutMs) return n;
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function bootApp(tag: 'a' | 'b', rootQueue: string, featureQueue: string, withPrefix: boolean) {
  const rootOpts = { connection: { url: REDIS_URL }, ...(withPrefix ? { prefix: 'bull' as const } : {}) };
  @Module({
    imports: [
      BullModule.forRoot('default', rootOpts),
      BullModule.registerQueue({ name: rootQueue }),
      makeFeatureModule(featureQueue),
    ],
    providers: [makeProcessor(rootQueue)],
  })
  class RootModule {}
  const app = await NestFactory.createApplicationContext(RootModule, { logger: false });
  await app.init();
  return app;
}

const queueNames = {
  aRoot: 't31-naming-a-root', aFeature: 't31-naming-a-feature',
  bRoot: 't31-naming-b-root', bFeature: 't31-naming-b-feature',
};
const madeQueues: Queue[] = [];
function trackQueue(name: string): Queue {
  const q = new Queue(name, { connection: { url: REDIS_URL } });
  madeQueues.push(q);
  return q;
}

describe('Y0c T31 worker 连接命名分裂（偏离 46——getWorkers 侦测面真因）', () => {
  afterAll(async () => {
    for (const q of madeQueues) { await q.obliterate({ force: true }).catch(() => undefined); await q.close().catch(() => undefined); }
  });

  it('case A（陷阱复现，T31 前生产形态）：forRoot 无 prefix ⇒ 特性模块队列 worker 连接命名 undefined: ⇒ getWorkers 不可见；根模块队列不受影响', async () => {
    const app = await bootApp('a', queueNames.aRoot, queueNames.aFeature, false);
    try {
      const rootQ = trackQueue(queueNames.aRoot);
      const featureQ = trackQueue(queueNames.aFeature);
      expect(await workersAtLeast(rootQ, 1), '根模块 registerQueue：Queue 实例可解析 ⇒ bull: 命名 ⇒ 可见').toBeGreaterThanOrEqual(1);
      const featureWorkers = (await featureQ.getWorkers()).length;
      expect(featureWorkers, '特性模块 registerQueue：forRoot 回落无 prefix ⇒ undefined: 命名 ⇒ getWorkers=0（服务器 12/17 实测同款）').toBe(0);
    } finally {
      await app.close();
    }
  });

  it('case B（修复行为）：forRoot 显式 prefix bull ⇒ 两侧队列 worker 均 bull: 命名 ⇒ getWorkers 均可见（registered≥1）', async () => {
    const app = await bootApp('b', queueNames.bRoot, queueNames.bFeature, true);
    try {
      const rootQ = trackQueue(queueNames.bRoot);
      const featureQ = trackQueue(queueNames.bFeature);
      expect(await workersAtLeast(rootQ, 1)).toBeGreaterThanOrEqual(1);
      expect(await workersAtLeast(featureQ, 1), '修复后特性模块队列 worker 必须可被 getWorkers 发现（presence registered 语义恢复）').toBeGreaterThanOrEqual(1);
    } finally {
      await app.close();
    }
  });

  it('case C（生产源码结构断言）：app.module+worker.module 的 forRoot(default) 必须显式 prefix bull（防回落路径再裸奔）', () => {
    for (const rel of ['../../app.module.ts', '../../worker.module.ts']) {
      const src = readFileSync(join(__dirname, rel), 'utf8');
      const at = src.indexOf("BullModule.forRoot('default'");
      expect(at, `${rel} 缺 BullModule.forRoot('default'`).toBeGreaterThanOrEqual(0);
      const window = src.slice(at, at + 1200);   // forRoot 块全文窗（两块均 <1200 字符）
      expect(/prefix:\s*'bull'/.test(window), `${rel} forRoot 缺显式 prefix:'bull'（@nestjs/bullmq BullExplorer 回落路径会以 prefix:undefined 覆盖 bullmq 默认 ⇒ worker 连接命名 undefined: ⇒ getWorkers 侦测失明——偏离 46）`).toBe(true);
    }
  });
});
