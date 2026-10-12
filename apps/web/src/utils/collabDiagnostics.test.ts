// apps/web/src/utils/collabDiagnostics.test.ts
// 批1-5 诊断模块单测：环形缓冲封顶覆盖 / 计数常开递增（不受覆盖影响）/ kill switch 读取时点求值。
// Y0b-5 T2：ring 接 sink——批量聚合（复合键）+30s loop+pagehide 即刻 flush+直连（禁 apiFetch）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  recordCollabDiag,
  getRecentCollabDiag,
  getCollabDiagCounters,
  isAutoRecoverDisabled,
  _resetCollabDiagForTest,
  flushTelemetry,
  _startTelemetryLoop,
  _stopTelemetryLoop,
  _telemetryLoopRunning,
  registerTelemetryMeta,
  getTelemetryDroppedTotal,
} from './collabDiagnostics';

const { readFileSync } = await import('node:fs');
const { dirname, join } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'collabDiagnostics.ts'), 'utf8');

describe('collabDiagnostics', () => {
  beforeEach(() => {
    _resetCollabDiagForTest();
  });

  it('环形缓冲封顶 500：最旧被覆盖（保最近）', () => {
    for (let i = 0; i < 600; i++) recordCollabDiag('watchdog_fire', { seq: i });
    const recent = getRecentCollabDiag();
    expect(recent).toHaveLength(500);
    expect(recent[0].detail).toEqual({ seq: 100 }); // 0..99 已被覆盖
    expect(recent[499].detail).toEqual({ seq: 599 });
  });

  it('计数不受环形覆盖影响（prod 常开计数语义——累计递增）', () => {
    for (let i = 0; i < 600; i++) recordCollabDiag('ws_status', { to: 'disconnected' });
    expect(getCollabDiagCounters().get('ws_status')).toBe(600);
  });

  it('kill switch：默认关；VITE_COLLAB_AUTO_RECOVER=off 时开（读取时点求值——stub 即生效）', () => {
    expect(isAutoRecoverDisabled()).toBe(false);
    vi.stubEnv('VITE_COLLAB_AUTO_RECOVER', 'off');
    expect(isAutoRecoverDisabled()).toBe(true);
    vi.unstubAllEnvs();
    expect(isAutoRecoverDisabled()).toBe(false);
  });
});

describe('collabDiagnostics 遥测批量缓冲+flush（Y0b-5 T2——spec §5.6 ring 接 sink）', () => {
  let beacon: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    _resetCollabDiagForTest();
    _stopTelemetryLoop();
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
  });

  /** jsdom Blob 无 text()/arrayBuffer()（仅 slice）——FileReader 读取（测试装置） */
  const blobText = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });
  const payloadAt = async (call: number) => {
    const blob = beacon.mock.calls[call]?.[1] as Blob;
    return JSON.parse(await blobText(blob)) as { events: any[]; clientBuild?: string; csv?: string; generation?: unknown };
  };

  it('30s 心跳批量：聚合键=type|code|reason 复合（同窗 3×4408+2×1008=两条各自计数 n=3/2——分布不被压掉）'
    + '且 Blob type=application/json（禁 text/plain=CORS simple request 跨站伪造面）', async () => {
    for (let i = 0; i < 3; i++) recordCollabDiag('close_code', { code: 4408 });
    for (let i = 0; i < 2; i++) recordCollabDiag('close_code', { code: 1008 });
    flushTelemetry();
    expect(beacon).toHaveBeenCalledTimes(1);
    const blob = beacon.mock.calls[0][1] as Blob;
    expect(blob.type).toBe('application/json');
    const { events } = await payloadAt(0);
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.detail?.code === 4408)).toMatchObject({ type: 'close_code', n: 3 });
    expect(events.find((e) => e.detail?.code === 1008)).toMatchObject({ type: 'close_code', n: 2 });
  });

  it('聚合键含 ws_status 的 from/to（迁移对分布不被压掉——SLO ms 载体禁被无 from/to 键合并丢失）', async () => {
    recordCollabDiag('ws_status', { from: 'connecting', to: 'connected', ms: 100 });
    recordCollabDiag('ws_status', { from: 'connected', to: 'disconnected' });
    recordCollabDiag('ws_status', { from: 'connecting', to: 'connected', ms: 900 });
    flushTelemetry();
    const { events } = await payloadAt(0);
    expect(events).toHaveLength(3);
    const msEntries = events.filter((e) => typeof e.detail?.ms === 'number');
    expect(msEntries).toHaveLength(2);   // 两条 ms 载体各自存活（4408 压一条=v1 病复发）
  });

  it('30s loop：_startTelemetryLoop 起搏到点 flush；_stopTelemetryLoop 停后 60s 零 beacon（loop 启停=会话绑定的测试缝）', () => {
    vi.useFakeTimers();
    try {
      recordCollabDiag('hydration_fail');
      _startTelemetryLoop();
      expect(_telemetryLoopRunning()).toBe(true);
      vi.advanceTimersByTime(30_000);
      expect(beacon).toHaveBeenCalledTimes(1);
      _stopTelemetryLoop();
      expect(_telemetryLoopRunning()).toBe(false);
      recordCollabDiag('hydration_fail');
      vi.advanceTimersByTime(60_000);
      expect(beacon).toHaveBeenCalledTimes(1);   // 停后零 beacon（缓冲留存——pagehide 兜底）
    } finally {
      vi.useRealTimers();
    }
  });

  it('flush 走 sendBeacon/fetch keepalive 直连——禁走 apiFetch（其 401 无差别置 httpExpired 电平=误报登录过期；client.ts:30 锚）', async () => {
    const { useSessionExpiry } = await import('@/auth/sessionExpiry');
    useSessionExpiry.getState().reset();
    Reflect.deleteProperty(navigator, 'sendBeacon');   // 降级路径：fetch keepalive
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      recordCollabDiag('hydration_fail');
      flushTelemetry();
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/collab/telemetry');
      expect(init).toMatchObject({ method: 'POST', keepalive: true });
      expect(useSessionExpiry.getState().httpExpired).toBe(false);   // 401 未触发登录过期电平（未走 apiFetch）
      expect(SRC).not.toContain('apiFetch');   // 静态锚：模块级禁 import/调用 apiFetch
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('pagehide（主）+visibilitychange hidden（辅）即刻 flush——应用侧此前零挂载；缓冲空=零 beacon（匿名页零上报）', () => {
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).not.toHaveBeenCalled();
    recordCollabDiag('hydration_fail');
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledTimes(1);
    recordCollabDiag('hydration_fail');
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(beacon).toHaveBeenCalledTimes(2);
  });

  it('聚合后 ≤12 条截断+丢弃计数（复合键下截断分支真实可达）；白名单外类型不入批（运行时防御）；flush 幂等清缓冲', async () => {
    for (let i = 0; i < 13; i++) recordCollabDiag('close_code', { code: 4000 + i });   // 13 个复合键
    expect(getTelemetryDroppedTotal()).toBe(1);   // 第 13 键起丢弃+计数
    recordCollabDiag('mischief-free-string' as never);   // 白名单外（类型 cast 模拟运行时漂移）
    flushTelemetry();
    const { events } = await payloadAt(0);
    expect(events).toHaveLength(12);
    expect(events.some((e) => e.type === 'mischief-free-string')).toBe(false);
    flushTelemetry();
    expect(beacon).toHaveBeenCalledTimes(1);   // 缓冲已清——幂等二次 flush 零 beacon
  });

  it('clientBuild=__CLIENT_BUILD__（vite.config define——__BUILD_HASH__ 不存在禁出现）；csv/generation 经 registerTelemetryMeta 携带（未注册不发）', async () => {
    recordCollabDiag('hydration_fail');
    flushTelemetry();
    const p1 = await payloadAt(0);
    expect(p1.clientBuild).toBe(__CLIENT_BUILD__);
    expect(p1.csv).toBeUndefined();
    expect(SRC).not.toContain('__BUILD_HASH__');
    registerTelemetryMeta(() => ({ csv: '3', generation: 7 }));
    recordCollabDiag('hydration_fail');
    flushTelemetry();
    const p2 = await payloadAt(1);
    expect(p2.csv).toBe('3');
    expect(p2.generation).toBe(7);
  });
});
