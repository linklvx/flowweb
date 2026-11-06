// apps/api/src/modules/collab/collab.gateway.erasure.c4b.spec.ts
// C4-b（plan Task C4-2 ★红⑩——生产就绪收尾批·project-erasure）：双进程语义（真连 kit）。
// **API 持 doc+客户端在线 → tombstone → 连接 close 4414 PROJECT_ERASED terminal + doc unload +
// 零 CanvasDoc 行复活**：
//  - 关连接码=4414（C4-b：closeTeamDocuments 由 1000/'team disbanded' 升级 PROJECT_ERASED/
//    'project-erased'——resolveCloseAction(4414)=terminal 档，客户端不自动重连〔web 消费面 C4-c 红⑰〕）；
//  - doc unload=documents Map 键随连接归零卸载（零 CanvasDoc 行复活=卸载后无新写路径可达：
//    storeDocumentUnlocked 对终态集项目 X1 清账+appendBatch 零调用——fence 拒帧/FK 收割的 kit 面代理）；
//  - 重连撞 auth fast-path：tombstone 后 resolveWithTeam 404（读过滤语义）→ lifecycleStateOf 分义
//    DELETING → closeUpgradeTerminal 4414（T24 形态——升级 socket 直写 RFC6455 close 帧后 end）。
// 跨进程裁定注记：project.gone 同进程（api 请求事务侧 emit=gateway 所在）即达；worker 批置 DELETING
// 的跨进程面=DB 对账（sweep 复验 NotFound→4414——int 面断言归 poller/spec；Redis pub/sub 零先例不引入）。
import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { startDualClientServer } from '../../test-utils/dual-client-server';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';

describe('C4-b ★红⑩ 双进程语义（API 持 doc+客户端在线→tombstone→4414 close+unload+零复活）', () => {
  it('tombstone→project.gone→连接 close 4414/project-erased terminal+doc unload+终态零 appendBatch（零 CanvasDoc 行复活代理）', async () => {
    const kit = await startDualClientServer();
    try {
      // 真连（auth ACTIVE 档——perm stub 默认 EDITOR 放行）；onSocket 捕获底层 ws close 帧
      let closeEvt: { code: number; reason: string } | null = null;
      const { provider, synced } = kit.connect('project:p-r10', 'tok', {
        onSocket: (ws: import('ws').WebSocket) => {
          ws.on('close', (code: number, reason: Buffer) => { closeEvt = { code, reason: reason.toString() }; });
        },
      });
      await synced;
      expect(provider.isSynced).toBe(true);
      expect(kit.gateway.server.hocuspocus.documents.has('project:p-r10')).toBe(true);   // doc 在册（API 持 doc）

      // tombstone（请求事务提交后 emit——api 进程=gateway 所在：同进程事件即关连接）
      kit.emitter.emit('project.gone', { projectIds: ['p-r10'] });

      // 连接 close：4414 PROJECT_ERASED terminal（reason 单源常量透传）
      await vi.waitFor(() => expect(closeEvt).not.toBeNull(), { timeout: 4_000 });
      expect(closeEvt!.code).toBe(4414);
      expect(closeEvt!.reason).toBe('project-erased');
      await vi.waitFor(() => expect(provider.isSynced).toBe(false), { timeout: 4_000 });
      // doc unload：documents Map 键消失（连接归零→库卸载——零复活前提）
      await vi.waitFor(() => expect(kit.gateway.server.hocuspocus.documents.has('project:p-r10')).toBe(false), { timeout: 6_000 });
      // 终态集登记（persistence.onProjectGone——清账+X1）
      expect(gatewayFacade(kit.gateway).deletedProjectsHas('p-r10')).toBe(true);
      kit.forget(provider);
      await provider.destroy();
    } finally {
      await kit.dispose();
    }
  }, 20_000);

  it('tombstone 后重连撞 auth fast-path：404 分义→lifecycleStateOf DELETING→升级 socket 直写 4414 close 帧（不进 doc 装载）', async () => {
    const kit = await startDualClientServer();
    try {
      // tombstone 语义注入：resolveWithTeam 404（读过滤形态）+lifecycleStateOf=DELETING（分义读）
      (kit.permSvc.resolveWithTeam as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        throw new NotFoundException('项目不存在');
      });
      (kit.permSvc as unknown as { lifecycleStateOf: (pid: string) => Promise<string | null> }).lifecycleStateOf =
        async () => 'DELETING';
      let closeEvt: { code: number; reason: string } | null = null;
      const { provider } = kit.connect('project:p-r10', 'tok', {
        onSocket: (ws: import('ws').WebSocket) => {
          ws.on('close', (code: number, reason: Buffer) => { closeEvt = { code, reason: reason.toString() }; });
        },
      });
      await vi.waitFor(() => expect(closeEvt).not.toBeNull(), { timeout: 4_000 });
      expect(closeEvt!.code).toBe(4414);   // auth 期 terminal 投递（Connection 未建——升级 socket 直写）
      expect(closeEvt!.reason).toBe('project-erased');
      // doc 不装载（auth 拒先于 onLoadDocument）
      expect(kit.gateway.server.hocuspocus.documents.has('project:p-r10')).toBe(false);
      kit.forget(provider);
      await provider.destroy();
    } finally {
      await kit.dispose();
    }
  }, 20_000);
});
