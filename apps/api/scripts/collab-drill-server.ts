// apps/api/scripts/collab-drill-server.ts —— Y0a-2 演练子进程入口：真实 AppModule（生产同构——
// drain 六步经 Nest onApplicationShutdown 生命周期；metrics 端点=G-1/G-2 演练轮询面）。
// 载体偏差登记（Step 1 探针实证）：tsx/esbuild 不发射 decorator metadata——CollabGateway 的
// prisma/repo/perm 等按类型注入参数全落 undefined（collab.gateway.ts:804 TypeError 实证），AppModule
// 全 DI 链在 tsx 下不可起。改走 gate-collab 先例载体：驱动先 `tsc -p tsconfig.drill.json` 全量编译
// （emitDecoratorMetadata=true），子进程=纯 node dist/scripts/collab-drill-server.js（重启零重编译）。
// env 全由驱动进程注入：DATABASE_URL/COLLAB_PORT/DRILL_HTTP_PORT/COLLAB_DEBOUNCE/
// COLLAB_SPOOL_DIR/PROMETHEUS_TOKEN/MINIO_INIT=skip+三占位（X3：skip 不可省——占位只过 zod，
// MinioModule.onModuleInit 仍 ensureBucket 3 重试后 throw=listen 永不执行）/DRILL_SPOOL_FAIL（Y14）。
// 关停双通道（controller 裁定 9 实测适配）：POSIX=真 SIGTERM 信号；Windows 下
// child.kill('SIGTERM')=libuv TerminateProcess 硬杀（Step 1 探针实证，drill 驱动登记形态）——
// 备选通道=IPC process.send({type:'shutdown'})，驱动按平台选择主通道。
// closing 闸（Y0a-3 必办⑩）：原 IPC 支路独享闸+enableShutdownHooks 承接 SIGTERM——POSIX 支路
// 无闸（双通道并发=app.close 二跑=drain_complete 重复打印+断言污染）。改手动 handler 弃
// enableShutdownHooks：app.close 本身恒调 onApplicationShutdown（信号接线才是它的职责，B4）；
// 两支路同一 closing 闸。
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CollabSpoolService } from '../src/modules/collab/collab-spool.service';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void app.close().then(() => process.exit(0)).catch((e) => { console.error('drill-server close failed:', e); process.exit(1); });   // 显式 exit——IPC/信号句柄不吊 event loop；close 拒绝走 exit(1)（unhandled rejection 退出无诊断）
  };
  process.on('message', (m: unknown) => { if ((m as { type?: string } | null)?.type === 'shutdown') shutdown(); });
  process.on('SIGTERM', shutdown);   // POSIX 真信号（CI Linux=生产同构通道）；win32=TerminateProcess 硬杀不走此
  if (process.env.DRILL_SPOOL_FAIL === '1') {
    // Y14 终口径（Task 5 勘误传导）：monkey-patch append 恒抛——overCapacityFlag 单独注入会被
    // 运行期首个 append 的滞回解除支自清（低深度 ≤90%×256MB 翻 false）=注入失效；探针走 appendRaw
    // 不受影响（演练窗口无真实 ioBroken 需求——只需"spool 故障"语义让 drain/force-spool 的
    // undrained 判据确定可达）。恒抛即不触盘，写失败 streak 记账同样不发生（closed over 原方法）。
    const spool = app.get(CollabSpoolService);
    (spool as unknown as { append: unknown }).append = async (): Promise<string[]> => {
      throw new Error('drill: spool append blocked');
    };
    console.log(JSON.stringify({ event: 'drill_spool_broken' }));
  }
  await app.listen(Number(process.env.DRILL_HTTP_PORT) || 3000);
  console.log(JSON.stringify({ event: 'drill_server_listening', pid: process.pid }));
}

void main().catch((e) => { console.error(e); process.exit(1); });
