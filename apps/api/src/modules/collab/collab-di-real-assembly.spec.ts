// apps/api/src/modules/collab/collab-di-real-assembly.spec.ts
// Y1c T33 双评审收口（quality P1-③）：DI **真装配**回归——paramtypes-Object 反射族。
// 掩盖形态实录：构造器参数联合注解（`Service | null`）经 emitDecoratorMetadata 反射为 Object
// （无类 token 可解析）⇒ Nest 真装配对 @Optional 参数恒注入 null/undefined——int/单测 Test 装配
// 显式 new 注入覆盖（T22/T32 两卡 int 绿而生产断链：writeExecStatus/deliverArtifact 生产恒 500
// 〔8a65e096 根修〕；T33 双评审普查另两处静默失效=teamCredit 退款恒不履行+quota presign 门禁
// 恒跳过——本批 @Inject(token) 族修）。本 spec 用**真进程模块图** compile()（DI 解析面——不跑
// onModuleInit/close 生命周期=零监听零连接 init 面）断言生产图注入非空，堵「int 直构掩盖」类
// 缺口（全 paramtypes-Object 族一次覆盖）。双图=api（AppModule——doc/sweeper/quota 面）+worker
// （WorkerModule——MaterializeJob delete-claim 面；REDIS_CLIENT 覆写防真连——非本断言面）。
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
// main.ts 同位同序：真实装配面经 MinioModule useFactory→validateEnv 读 env——先载 .env（CJS
// import 即语句顺序，与 main.ts config() 先于 AppModule 同机制）。
loadEnv({ path: resolve(__dirname, '../../.env') });
import { Test } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { WorkerModule } from '../../worker.module';
import { REDIS_CLIENT } from '../../common/redis/managed-redis';
import { CollabDocumentService } from './collab-document.service';
import { RuntimeFeedService } from './runtime-feed.service';
import { CollabLifecycleObserverService } from './collab-lifecycle-observer.service';
import { LifecycleObligationSweeper } from './lifecycle-obligation.sweeper';
import { TeamCreditService } from '../team/team-credit.service';
import { MediaRegistrationService } from '../artifact-core/media-registration.service';
import { StorageQuotaService } from '../team/storage-quota.service';
import { MaterializeJob } from '../artifact-core/materialize-job.service';
import { ObjectManifestService } from '../artifact-core/object-manifest.service';

describe('Y1c T33 双评审收口：DI 真装配回归（paramtypes-Object 反射族——int 直构掩盖形态）', () => {
  it('api 图（AppModule）：联合注解服务真装配注入非空（修前红：teamCredit/quota 反射 Object→@Optional 恒 null=生产静默失效；feed/lifecycle=8a65e096 已修回归锚）', async () => {
    const app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const doc = app.get(CollabDocumentService);
    expect((doc as unknown as { feed: unknown }).feed).toBeInstanceOf(RuntimeFeedService);
    expect((doc as unknown as { lifecycle: unknown }).lifecycle).toBeInstanceOf(CollabLifecycleObserverService);

    // T33 双评审普查 P1-①：EXEC_FINALIZE 退款主体（TeamModule 在图且 exports——非联合注解本可注入）
    const sweeper = app.get(LifecycleObligationSweeper);
    expect((sweeper as unknown as { teamCredit: unknown }).teamCredit).toBeInstanceOf(TeamCreditService);

    // T33 双评审普查 P1-②：presign 配额门禁（T23 Q7 根修面——恒 null=门禁静默失效）
    const reg = app.get(MediaRegistrationService);
    expect((reg as unknown as { quota: unknown }).quota).toBeInstanceOf(StorageQuotaService);

    // 注记：sweeper.reconciler 在 api 图恒空=结构性（CollabModule 不 import MediaDeliveryModule
    // ——@Optional+@Inject 语义下无 provider 即 undefined，非反射缺陷；普查注记在案）。
    expect((sweeper as unknown as { reconciler: unknown }).reconciler).toBeUndefined();
  });

  it('worker 图（WorkerModule）：MaterializeJob delete-claim 注入非空（修前红：manifests 反射 Object→恒 undefined=claim 面恒跳过〔降级非断链〕）+quota 面 worker 复证', async () => {
    // 双图同进程共享 prom-client 全局 Registry（生产=api/worker 分进程无此面）——worker 图
    // compile 前清表防 default metrics 双注册（api 图断言已完成，其 metric 对象无后续读者）。
    const { register } = await import('prom-client');
    register.clear();
    const app = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(REDIS_CLIENT).useValue({ marker: 'di-real-assembly-stub' })   // 防真连——非本断言面（worker 图 REDIS 工厂 eager 连接）
      .compile();
    const mj = app.get(MaterializeJob);
    expect((mj as unknown as { manifests: unknown }).manifests).toBeInstanceOf(ObjectManifestService);
    const reg = app.get(MediaRegistrationService);
    expect((reg as unknown as { quota: unknown }).quota).toBeInstanceOf(StorageQuotaService);
  });
});
