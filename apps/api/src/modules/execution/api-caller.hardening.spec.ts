// apps/api/src/modules/execution/api-caller.hardening.spec.ts —— Y0b-2 T2 红用例主件
// 四主题：①mock 四分支硬失败+AIModel 单源（PROVIDER_UNKNOWN_MODEL/HTTP/EMPTY_RESPONSE）；
// ②deadline 驱动轮询+onTick 双职+停滞检测只计异常（Z68/Z69/Z83/Z105）+PROVIDER_TASK_LOST；
// ③启动断言 fail-closed 两类密钥源∪预算锁（Z93/Z90——与 NODE_ENV 解耦）；
// ④行级密钥外呼面（Bearer=行 apiKey——MODEL_CONFIG 硬编码退役的对照证据）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiCallerService } from './api-caller.service';
import { pollStallTotal, pollUnknownStatusTotal, intentDeadlineExceededTotal } from './exec.metrics';

/** 直构夹具：prisma 只需 aIModel.findUnique（resolveModel）/findMany（启动断言）两读点 */
const makeSvc = (row: any, rows: any[] = []) => {
  const prisma: any = {
    aIModel: {
      findUnique: vi.fn(async () => row),
      findMany: vi.fn(async () => rows),
    },
  };
  return new ApiCallerService(prisma);
};

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** 带标签 Counter 取值 helper（prom-client 15 的 .get() 不回值——扫 hashMap 按 labels 匹配） */
const labeled = (m: any, labels: Record<string, string>): number => {
  for (const v of Object.values(m.hashMap ?? {})) {
    const hit = Object.entries(labels).every(([k, val]) => (v as any).labels?.[k] === val);
    if (hit) return (v as any).value ?? 0;
  }
  return 0;
};
/** 零密钥世界：vitest 会加载 apps/api/.env（moonshot/tencent 有值）——显式清空三键后断言才判别 */
const stubZeroKeys = () => {
  vi.stubEnv('PROVIDER_MOONSHOT_API_KEY', '');
  vi.stubEnv('PROVIDER_TENCENT_API_KEY', '');
  vi.stubEnv('DASHSCOPE_API_KEY', '');
};

// 模型行夹具（id 逐用例唯一——模块级 5min 缓存防跨用例串读）
const KIMI = { id: 'hk-kimi', active: true, provider: 'moonshot', apiModelName: 'kimi-k2.6', apiUrl: 'https://api.moonshot.cn/v1', apiKey: 'sk-row-kimi' };
const HY_IMAGE = { id: 'hk-hy-image', active: true, provider: 'tencent', apiModelName: 'hy-image-v3.0', apiUrl: 'https://hy.example/v1/api/image', apiKey: 'sk-row-hy' };

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Y0b-2 T2：mock 四分支硬失败+AIModel 单源（Z80/Z101）', () => {
  it('text：模型无 adapter → 4xx PROVIDER_UNKNOWN_MODEL（改前红：MODEL_CONFIG 缺=mock 假产物）', async () => {
    const svc = makeSvc({ ...KIMI, id: 'hk-noadapter', provider: 'stability', apiModelName: 'sdxl-3.0' });
    await expect(svc.callTextGen({ prompt: 'p', model: 'hk-noadapter', apiUrl: '' }))
      .rejects.toMatchObject({ errorCode: 'PROVIDER_UNKNOWN_MODEL' });
  });

  it('text 链 4xx → HTTP 错误（改前红：json 解析空串当成功）', async () => {
    const svc = makeSvc(KIMI);
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ error: 'x' }, 429)));
    await expect(svc.callTextGen({ prompt: 'p', model: KIMI.id, apiUrl: '' })).rejects.toThrow(/HTTP 429/);
  });

  it('200 但 choices 空 → PROVIDER_EMPTY_RESPONSE（mock 假产物分支之二）', async () => {
    const svc = makeSvc(KIMI);
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ choices: [] })));
    await expect(svc.callTextGen({ prompt: 'p', model: KIMI.id, apiUrl: '' }))
      .rejects.toMatchObject({ errorCode: 'PROVIDER_EMPTY_RESPONSE' });
  });

  it('text 正常链：Bearer=行级 apiKey + providerTaskId 显式 null（Z88）', async () => {
    const svc = makeSvc(KIMI);
    const fetchMock = vi.fn(async () => jsonRes({ choices: [{ message: { content: '回答' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await svc.callTextGen({ prompt: 'p', model: KIMI.id, apiUrl: '' });
    expect(r.content).toBe('回答');
    expect((r as any).providerTaskId).toBeNull();
    const [calledUrl, init] = (fetchMock.mock.calls[0] as any[]);
    expect(init.headers.Authorization).toBe('Bearer sk-row-kimi');
    expect(String(calledUrl)).toContain('https://api.moonshot.cn/v1/chat/completions');
  });

  it('image：模型无 adapter → PROVIDER_UNKNOWN_MODEL（改前红：回落 mock 图）', async () => {
    const svc = makeSvc({ ...HY_IMAGE, id: 'hk-img-noadapter', provider: 'openai', apiModelName: 'dalle-3' });
    vi.stubGlobal('fetch', vi.fn());
    await expect(svc.callImageGen({ prompt: 'p', model: 'hk-img-noadapter' }))
      .rejects.toMatchObject({ errorCode: 'PROVIDER_UNKNOWN_MODEL' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('video：模型无 adapter → PROVIDER_UNKNOWN_MODEL（改前红：回落 mock 视频——mock 四分支之三）', async () => {
    const svc = makeSvc({ ...HY_IMAGE, id: 'hk-vid-noadapter', provider: 'openai', apiModelName: null });
    await expect(svc.callVideoGen({ prompt: 'p', model: 'hk-vid-noadapter', mode: 'text-to-video' }))
      .rejects.toMatchObject({ errorCode: 'PROVIDER_UNKNOWN_MODEL' });
  });

  it('行级 apiKey 缺（executable∧!ready 漏网行）→ PROVIDER_API_KEY_MISSING 零外呼（防 Bearer undefined 401）', async () => {
    const svc = makeSvc({ ...KIMI, id: 'hk-nokey', apiKey: null });
    vi.stubGlobal('fetch', vi.fn());
    await expect(svc.callTextGen({ prompt: 'p', model: 'hk-nokey', apiUrl: '' }))
      .rejects.toMatchObject({ errorCode: 'PROVIDER_API_KEY_MISSING' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Y0b-2 T2：deadline 驱动轮询+停滞检测（Z68/Z69/Z83/Z105）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 短档轮询（1s）+可测 deadline——字面量 env 直读路径同批被测
    vi.stubEnv('EXEC_POLL_TIMEOUT_MS', '1000');
  });
  afterEach(() => vi.useRealTimers());

  /** tencent submit+query fetch 形状（submit 一次 + query 逐轮） */
  const tencentFetch = (queryImpl: (n: number) => Response | Promise<Response>) => {
    let n = 0;
    return vi.fn(async (url: any, init?: any) => {
      if (String(url).endsWith('/submit')) return jsonRes({ id: 'task-1' });
      n += 1;
      return typeof queryImpl === 'function' ? queryImpl(n) : queryImpl;
    });
  };

  it('onTick 返回 abort → 轮询立即停止（零 query 外呼）', async () => {
    const svc = makeSvc(HY_IMAGE);
    const fetchMock = tencentFetch(() => jsonRes({ status: 'running' }));
    vi.stubGlobal('fetch', fetchMock);
    const p = expect(svc.callImageGen({ prompt: 'p', model: HY_IMAGE.id, onTick: () => 'abort' as const }))
      .rejects.toMatchObject({ errorCode: 'PROVIDER_POLL_ABORTED' });
    await vi.advanceTimersByTimeAsync(5_000);
    await p;
    expect(fetchMock).toHaveBeenCalledTimes(1); // 仅 submit
  });

  it('deadline 到点 → 轮询停止（改前红：30×2s 硬编码先于 deadline）+ intent_deadline_exceeded{phase=call}', async () => {
    vi.stubEnv('EXEC_DEADLINE_IMAGE_MS', '15000');
    const svc = makeSvc(HY_IMAGE);
    vi.stubGlobal('fetch', tencentFetch(() => jsonRes({ status: 'running' })));
    const before = labeled(intentDeadlineExceededTotal, { kind: 'image', phase: 'call' });
    const p = expect(svc.callImageGen({ prompt: 'p', model: HY_IMAGE.id }))
      .rejects.toMatchObject({ errorCode: 'PROVIDER_DEADLINE_EXCEEDED' });
    await vi.advanceTimersByTimeAsync(20_000);
    await p;
    // 1s 间隔 × 15s deadline=恰 15 次 query——旧实现固定 30 次先于 deadline 硬编码的对照
    expect(fetch).toHaveBeenCalledTimes(1 + 15);
    expect(labeled(intentDeadlineExceededTotal, { kind: 'image', phase: 'call' })).toBe(before + 1);
  });

  it('停滞负向①：连续 12 次 running 后 succeeded → 成功且 pollStallTotal 不增（Z105 改前红：按"非终态计数"字面读必杀）', async () => {
    const svc = makeSvc(HY_IMAGE);
    vi.stubGlobal('fetch', tencentFetch((n) => (n <= 12 ? jsonRes({ status: 'running' }) : jsonRes({ status: 'succeeded', data: ['https://r/1.png'] }))));
    const stall0 = labeled(pollStallTotal, { kind: 'image' });
    const unknown0 = labeled(pollUnknownStatusTotal, { kind: 'image' });
    const p = svc.callImageGen({ prompt: 'p', model: HY_IMAGE.id, resolution: '1024×1024' });
    await vi.advanceTimersByTimeAsync(30_000);
    const r = await p;
    expect(r.url).toBe('https://r/1.png');
    expect(labeled(pollStallTotal, { kind: 'image' })).toBe(stall0);
    expect(labeled(pollUnknownStatusTotal, { kind: 'image' })).toBe(unknown0); // running=已知中间态不计未知
  });

  it('停滞负向②：连续 12 次未知中间态（2xx 可解析）→ 不抛不计数停滞，记 exec_poll_unknown_status_total', async () => {
    const svc = makeSvc(HY_IMAGE);
    vi.stubGlobal('fetch', tencentFetch((n) => (n <= 12 ? jsonRes({ status: 'queued_v2' }) : jsonRes({ status: 'succeeded', data: ['https://r/2.png'] }))));
    const stall0 = labeled(pollStallTotal, { kind: 'image' });
    const unknown0 = labeled(pollUnknownStatusTotal, { kind: 'image' });
    const p = svc.callImageGen({ prompt: 'p', model: HY_IMAGE.id });
    await vi.advanceTimersByTimeAsync(30_000);
    const r = await p;
    expect(r.url).toBe('https://r/2.png');
    expect(labeled(pollStallTotal, { kind: 'image' })).toBe(stall0);
    expect(labeled(pollUnknownStatusTotal, { kind: 'image' })).toBe(unknown0 + 12);
  });

  it('停滞正向：连续异常超 EXEC_POLL_TIMEOUT_MS×10 → PROVIDER_POLL_STALLED+pollStallTotal.inc（不含"处理中"稳态）', async () => {
    const svc = makeSvc(HY_IMAGE);
    vi.stubGlobal('fetch', tencentFetch(async () => { throw new Error('network down'); }));
    const stall0 = labeled(pollStallTotal, { kind: 'image' });
    const p = expect(svc.callImageGen({ prompt: 'p', model: HY_IMAGE.id }))
      .rejects.toMatchObject({ errorCode: 'PROVIDER_POLL_STALLED' });
    await vi.advanceTimersByTimeAsync(30_000);
    await p;
    expect(labeled(pollStallTotal, { kind: 'image' })).toBe(stall0 + 1);
  });

  it('404/任务不存在 → 立即终态 PROVIDER_TASK_LOST（非停滞路径）', async () => {
    const svc = makeSvc(HY_IMAGE);
    vi.stubGlobal('fetch', tencentFetch(() => new Response('not found', { status: 404 })));
    const p = expect(svc.callImageGen({ prompt: 'p', model: HY_IMAGE.id }))
      .rejects.toMatchObject({ errorCode: 'PROVIDER_TASK_LOST' });
    await vi.advanceTimersByTimeAsync(5_000);
    await p;
    expect(fetch).toHaveBeenCalledTimes(2); // submit+1 次 query 即终态
  });
});

describe('Y0b-2 T2：启动断言 fail-closed（Z93 两类密钥源∪+Z90 预算锁）', () => {
  it('零密钥+零 ready 行 → 拒启（日志只报缺失键名不报值）', async () => {
    stubZeroKeys();
    const svc = makeSvc(null, []); // 无 ready 行
    const err: any = await svc.onModuleInit().catch((e: any) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('PROVIDER_MOONSHOT_API_KEY');
    expect(err.message).toContain('PROVIDER_TENCENT_API_KEY');
    expect(err.message).toContain('DASHSCOPE_API_KEY');
    expect(err.message).not.toContain('sk-'); // 只报键名不报值
  });

  it('ready AIModel 行 ∪ seedEnv 并列断言输入：行密钥覆盖 moonshot/tencent+seedEnv 覆盖 dashscope → 过', async () => {
    stubZeroKeys();
    vi.stubEnv('DASHSCOPE_API_KEY', 'sk-d');
    const svc = makeSvc(null, [
      { active: true, provider: 'moonshot', apiModelName: 'kimi-k2.6', apiKey: 'sk-row-m' },
      { active: true, provider: 'tencent', apiModelName: 'hy-image-v3.0', apiKey: 'sk-row-t' },
    ]);
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
  });

  it('COLLAB_FAKE_AI=1 显式豁免档 → 零密钥照常启动（与 NODE_ENV 解耦——Z93）', async () => {
    vi.stubEnv('COLLAB_FAKE_AI', '1');
    const svc = makeSvc(null, []);
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
  });

  it('预算锁：EXEC_SYNC_HARD_CAP < max(EXEC_DEADLINE_*) → 拒启（FAKE_AI 不豁免——结构性约束）', async () => {
    vi.stubEnv('EXEC_SYNC_HARD_CAP', '60000'); // 60s < 默认 lighting 1800s
    const svc = makeSvc(null, []);
    const err: any = await svc.onModuleInit().catch((e: any) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('EXEC_SYNC_HARD_CAP');
    // 解耦证据：豁免档下预算锁仍拒
    vi.stubEnv('COLLAB_FAKE_AI', '1');
    const err2: any = await svc.onModuleInit().catch((e: any) => e);
    expect(err2).toBeInstanceOf(Error);
    expect(err2.message).toContain('EXEC_SYNC_HARD_CAP');
  });
});
