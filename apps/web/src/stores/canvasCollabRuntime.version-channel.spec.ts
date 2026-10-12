// apps/web/src/stores/canvasCollabRuntime.version-channel.spec.ts
// Y0b-3 T5 客户端版本通道（P-C/M-9）：createProvider 的 collabUrl() 单次构造——
// transport 与 provider 同一 URL 字符串（两处独立调用=漂移风险，v1 钉死）；
// URL 恰含 csv=CLIENT_PROTOCOL_VERSION&cb=__CLIENT_BUILD__（缺 csv=服务端版本门恒拒）。
// cb 在 vitest 下='dev'（vite define 兜底——GIT_COMMIT_HASH 仅部署构建注入，M-9）。
// 装置：conn.spec 同款（mock provider+initCollab 驱动）；reconnectTransport mock 捕获入参。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';
import { CLIENT_PROTOCOL_VERSION } from '@flowweb/shared';

const transportUrls: string[] = [];
vi.mock('../collab/reconnectTransport', () => ({
  createReconnectingWebSocket: (url: string) => {
    transportUrls.push(url);
    class TransportWebSocket extends WebSocket {}
    return { WebSocketClass: TransportWebSocket };
  },
}));

// Y0b-5 T3：mock 收敛——唯一载体 @/test/fixtures/fakeHocuspocusProvider（裁定 24⑪⑤；
// fixture.cfg 保留构造入参——lastCfg 断言面不变）。
vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

const lastCfg = () => (HocuspocusProvider as any).instances.at(-1)?.cfg;

describe('Y0b-3 T5 版本通道（collabUrl 单次+csv/cb 参数）', () => {
  beforeEach(() => {
    (HocuspocusProvider as any).instances.length = 0;
    transportUrls.length = 0;
    useCanvasStore.setState({ connStatus: 'connecting', nodes: [], edges: [], hydration: 'idle' });
  });
  afterEach(async () => {
    await runtime.destroyCollab();
  });

  it('provider 与 transport 同一 URL 字符串（单次构造证据——两处独立调用=漂移风险）', async () => {
    void runtime.initCollab('p-vc1');   // conn.spec 同款：只 flush 构造不 await done（settle 需事件驱动）
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(transportUrls.length).toBe(1);
    expect(lastCfg().url).toBe(transportUrls[0]);
  });

  it('URL 恰含 csv=<当前协议版>&cb=<构建标识>（query 通道——服务端版本门消费 csv）', async () => {
    void runtime.initCollab('p-vc2');
    await new Promise<void>((r) => setTimeout(r, 0));
    const u = new URL(lastCfg().url);
    expect(u.searchParams.get('csv')).toBe(String(CLIENT_PROTOCOL_VERSION));
    expect(u.searchParams.get('cb')).toBe('dev');   // vitest 无 GIT_COMMIT_HASH——define 兜底 'dev'（M-9）
  });
});
