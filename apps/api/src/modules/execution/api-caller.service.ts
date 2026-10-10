// apps/api/src/modules/execution/api-caller.service.ts —— Y0b-2 T2 全文重构
// 旧"三键硬编码模型表（含内置密钥）"退役：AIModel 行=唯一模型源（provider slug+apiModelName+
// 行级 apiKey——E51）；本服务只做 provider→外呼方式分派（provider-adapters 单源）。
// mock 四分支（未注册模型回落假图/假视频/mock 文本/未知类型回落）全部退役——显式 errorCode 硬失败。
import { Inject, Injectable, Logger, HttpStatus, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { EXEC_DEFAULTS } from '../../config/env';
import { deadlineMsForKind } from './intent-key.util';
import { adapterFor, fakeAiEnabled, seedEnvValue, ready, ADAPTERS, type ProviderAdapter } from './provider-adapters';
import { outboundDuration, intentDeadlineExceededTotal, pollStallTotal, pollUnknownStatusTotal } from './exec.metrics';

export interface ImageGenParams {
  prompt: string;
  extraPrompt?: string;
  style?: string;
  model: string;
  resolution?: string;
  imageUrl?: string;
  /** Y0b-2 T2：轮询每 tick 回调（双职——T4 接 touchHeartbeat/意图状态检查）；返回 'abort' 立即停轮询 */
  onTick?: PollOnTick;
  /** submit 回传 providerTaskId（T4 接 GenerationIntent.providerTaskId 落库——reconcile 任务查询锚） */
  onProviderTaskId?: (taskId: string) => void;
}

export interface ImageGenResult {
  url: string;
  width: number;
  height: number;
  /** submit-poll 类回传 provider 任务 id；无则缺省（text 链显式 null——Z88） */
  providerTaskId?: string | null;
}

export interface VideoGenParams {
  prompt: string;
  model: string;
  mode: 'text-to-video' | 'image-to-video' | 'first-last-frame' | 'multi-frame';
  imageUrl?: string;
  startImageUrl?: string;
  endImageUrl?: string;
  imageUrls?: string[];
  ratio?: string;
  quality?: string;
  duration?: string;
  audio?: boolean;
  onTick?: PollOnTick;
  onProviderTaskId?: (taskId: string) => void;
}

export interface VideoGenResult {
  url: string;
  providerTaskId?: string | null;
}

export interface TextGenParams {
  prompt: string;
  model: string;
  apiUrl: string;
}

export interface TextGenResult {
  content: string;
  /** text=openai-chat 单次外呼无 provider 任务——显式 null（Z88） */
  providerTaskId: null;
}

/** 编辑链（DashScope submit-poll）可选回调束 */
export interface EditCallOpts {
  onTick?: PollOnTick;
  onProviderTaskId?: (taskId: string) => void;
}

export type PollOnTick = () => 'abort' | void | Promise<'abort' | void>;

/** 单次轮询分类（pollLoop 消费；progress/unknown-status 均刷新 lastGoodResponseAt——Z105） */
type PollOutcome =
  | { kind: 'succeeded'; json: any }
  | { kind: 'failed'; message: string }
  | { kind: 'progress' }
  | { kind: 'unknown-status' }
  | { kind: 'lost' }
  | { kind: 'error'; message: string };

/** env 字面量直读（collab-env-single-source 方向②只认字面量）+EXEC_DEFAULTS 兜底单源；<1000 视为未设 */
const envMs = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n >= 1000 ? n : d;
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface OutboundModel {
  id: string;
  provider: string;
  apiUrl: string;
  apiModelName: string;
  apiKey: string;
}

/** 模型配置 5min 缓存（模块级）——只服务 claim 后外呼面：判活/杀开关走 claim 真库新鲜查
 *  （validation 预检+resolver 门 model.active），缓存不拦新执行。
 *  单实例假设：readServerSV/SnapshotDocCache/prom-client registry/本缓存四处均依赖 PM2
 *  instances:1——多实例下各持陈旧本地态（SV 门=最隐蔽错），ecosystem.config 同源注释。 */
const MODEL_CACHE_TTL_MS = 5 * 60_000;
const modelCache = new Map<string, { at: number; row: OutboundModel }>();

/** 停停滞窗口倍数：连续异常超 pollInterval×STALL_LIMIT 无有效响应 ⇒ PROVIDER_POLL_STALLED */
const STALL_LIMIT = 10;

@Injectable()
export class ApiCallerService implements OnModuleInit {
  private readonly logger = new Logger(ApiCallerService.name);
  private readonly dashscopeBaseUrl = 'https://dashscope.aliyuncs.com';

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Z93/Z90 启动断言（fail-closed，与 NODE_ENV 解耦）：
   *  ①预算锁：EXEC_SYNC_HARD_CAP ≥ max(EXEC_DEADLINE_*)，否则拒启（结构性——FAKE_AI 不豁免）；
   *  ②密钥断言：每类 adapter 至少有一个 ready 的 AIModel 行或对应 seedEnv 非空（两类密钥源∪）；
   *  日志只报缺失键名不报值；COLLAB_FAKE_AI=1 显式豁免档（密钥断言，非预算锁）。 */
  async onModuleInit(): Promise<void> {
    const cap = envMs(process.env.EXEC_SYNC_HARD_CAP, EXEC_DEFAULTS.SYNC_HARD_CAP);
    const maxDeadline = Math.max(
      deadlineMsForKind('text'), deadlineMsForKind('image'), deadlineMsForKind('video'),
      deadlineMsForKind('outpaint'), deadlineMsForKind('lighting'),
    );
    if (cap < maxDeadline) {
      throw new Error(
        `EXEC_SYNC_HARD_CAP(${cap}ms) < max(EXEC_DEADLINE_*)(${maxDeadline}ms)——同步总预算硬帽必须覆盖最大单 kind 外呼截止（Z90），拒启`,
      );
    }
    if (fakeAiEnabled()) {
      this.logger.log('COLLAB_FAKE_AI=1——外呼密钥启动断言走豁免档（E2E）');
      return;
    }
    const rows = await this.prisma.aIModel.findMany({
      where: { active: true },
      select: { provider: true, apiModelName: true, apiKey: true },
    });
    const missing: string[] = [];
    for (const [slug, adapter] of Object.entries(ADAPTERS)) {
      const hasReadyRow = rows.some(
        (r) => r.provider === slug && ready({ active: true, provider: r.provider, apiModelName: r.apiModelName, apiKey: r.apiKey }),
      );
      if (!hasReadyRow && !seedEnvValue(adapter.seedEnv)) missing.push(adapter.seedEnv);
    }
    if (missing.length > 0) {
      throw new Error(
        `外呼密钥启动断言 fail-closed（Z93）：以下 adapter 既无 ready AIModel 行、seedEnv 亦空——缺 ${missing.join(', ')}`
        + `（密钥经 seed 灌 AIModel.apiKey 行或设对应 env；COLLAB_FAKE_AI=1 为 E2E 显式豁免档）`,
      );
    }
  }

  /** fake 延迟 1.5~2s——模拟真实外呼节奏（E2E 断连窗口/AI 执行态对齐需要可观测的 loading 期） */
  private fakeDelay(): Promise<void> {
    return new Promise((r) => setTimeout(r, 1500 + Math.random() * 500));
  }

  private fakeImageUrl(params: ImageGenParams): { url: string; width: number; height: number } {
    const [w, h] = (params.resolution || '1024×1024').split('×').map(Number);
    return { url: `/mock/collab-fake-ai-image_${w || 1024}x${h || 1024}.jpg`, width: w || 1024, height: h || 1024 };
  }

  /** Combine main prompt and extra prompt, ensuring at least one is present */
  combinePrompt(prompt: string, extraPrompt?: string): string {
    const parts = [prompt, extraPrompt].filter(Boolean);
    return parts.join(', ');
  }

  /** AIModel 行→外呼模型（5min 模块缓存；行缺=PROVIDER_UNKNOWN_MODEL——mock 假产物分支退役） */
  private async resolveModel(modelId: string): Promise<OutboundModel> {
    const hit = modelCache.get(modelId);
    if (hit && Date.now() - hit.at < MODEL_CACHE_TTL_MS) return hit.row;
    const row = await this.prisma.aIModel.findUnique({ where: { id: modelId } });
    if (!row) {
      throw new BusinessException('PROVIDER_UNKNOWN_MODEL', `模型 ${modelId} 不存在（AIModel 单源——E51）`, HttpStatus.BAD_REQUEST);
    }
    const outbound: OutboundModel = {
      id: row.id, provider: row.provider, apiUrl: row.apiUrl,
      apiModelName: row.apiModelName ?? '', apiKey: row.apiKey ?? '',
    };
    modelCache.set(modelId, { at: Date.now(), row: outbound });
    return outbound;
  }

  /** 外呼方式分派断言：adapter 在位+type 匹配+apiModelName+行级密钥——任一缺即显式错误（零外呼） */
  private assertDispatch(m: OutboundModel, expectType: ProviderAdapter['type'], kind: string): void {
    const a = adapterFor(m.provider);
    if (!a || a.type !== expectType) {
      throw new BusinessException(
        'PROVIDER_UNKNOWN_MODEL',
        `模型 ${m.id}（provider=${m.provider}）不支撑 ${kind} 外呼（需 ${expectType} adapter）`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!m.apiModelName) {
      throw new BusinessException('PROVIDER_UNKNOWN_MODEL', `模型 ${m.id} 缺 apiModelName（provider 侧模型 id）`, HttpStatus.BAD_REQUEST);
    }
    if (!m.apiKey) {
      throw new BusinessException(
        'PROVIDER_API_KEY_MISSING',
        `模型 ${m.id} 行级 apiKey 缺（admin 补钥或 seed 灌行——Z93 拒启兜底的漏网行，防 Bearer undefined 401）`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /** Z45：显式 AbortController + finally clearTimeout（防 abort 定时器泄漏拖进程） */
  private async withDeadline<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fn(ctrl.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  /** tencent 提交（/submit）——submit 阶段预算 EXEC_SUBMIT_TIMEOUT_MS；返回 taskId */
  private async tencentSubmit(m: OutboundModel, body: Record<string, unknown>, kind: string): Promise<string> {
    const ms = envMs(process.env.EXEC_SUBMIT_TIMEOUT_MS, EXEC_DEFAULTS.SUBMIT);
    const res = await this.withDeadline(ms, (signal) =>
      fetch(`${m.apiUrl}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m.apiKey}` },
        body: JSON.stringify(body),
        signal,
      }));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${m.apiUrl}/submit（${kind} submit）`);
    const json = await res.json().catch(() => null) as any;
    const taskId = json?.id ?? json?.task_id;
    if (!taskId) throw new Error(`${kind} submit failed: no task ID, got: ${JSON.stringify(json).slice(0, 200)}`);
    return String(taskId);
  }

  /** tencent 单轮查询（/query）分类；supportsTaskQuery 适用面：404/任务不存在 ⇒ 立即终态 PROVIDER_TASK_LOST */
  private async tencentPoll(m: OutboundModel, taskId: string): Promise<PollOutcome> {
    const ms = envMs(process.env.EXEC_POLL_TIMEOUT_MS, EXEC_DEFAULTS.POLL);
    try {
      const res = await this.withDeadline(ms, (signal) =>
        fetch(`${m.apiUrl}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m.apiKey}` },
          body: JSON.stringify({ model: m.apiModelName, id: taskId }),
          signal,
        }));
      if (res.status === 404) return { kind: 'lost' };
      if (!res.ok) return { kind: 'error', message: `HTTP ${res.status}` };
      const json = await res.json().catch(() => null) as any;
      if (!json || json.status === undefined) return { kind: 'error', message: '响应不可解析' };
      const s = String(json.status);
      if (['succeeded', 'completed', 'done'].includes(s)) return { kind: 'succeeded', json };
      if (['failed', 'error'].includes(s)) return { kind: 'failed', message: String(json.error ?? 'unknown error') };
      if (['running', 'pending', 'processing', 'queued', 'submitted'].includes(s)) return { kind: 'progress' };
      return { kind: 'unknown-status' };
    } catch (e) {
      return { kind: 'error', message: String(e) };
    }
  }

  /** DashScope 单轮任务查询分类（编辑链四 kind 共用） */
  private async dashscopePoll(apiKey: string, taskId: string): Promise<PollOutcome> {
    const ms = envMs(process.env.EXEC_POLL_TIMEOUT_MS, EXEC_DEFAULTS.POLL);
    try {
      const res = await this.withDeadline(ms, (signal) =>
        fetch(`${this.dashscopeBaseUrl}/api/v1/tasks/${taskId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal,
        }));
      if (res.status === 404) return { kind: 'lost' };
      if (!res.ok) return { kind: 'error', message: `HTTP ${res.status}` };
      const json = await res.json().catch(() => null) as any;
      if (!json) return { kind: 'error', message: '响应不可解析' };
      const s = String(json.output?.task_status ?? json.status ?? '');
      if (['SUCCEEDED', 'succeeded', 'completed'].includes(s)) return { kind: 'succeeded', json };
      if (['FAILED', 'failed', 'error'].includes(s)) return { kind: 'failed', message: String(json.output?.message ?? json.message ?? 'unknown error') };
      if (['PENDING', 'RUNNING', 'running', 'pending'].includes(s)) return { kind: 'progress' };
      return { kind: 'unknown-status' };
    } catch (e) {
      return { kind: 'error', message: String(e) };
    }
  }

  /** Z68/Z69/Z83/Z105：deadline 驱动轮询（while-deadline，退役 30×2s/60×3s 硬编码）+onTick 双职
   *  （每 tick 回调，'abort' 立即停——T4 接 touchHeartbeat/意图状态检查）+停滞检测只计异常。
   *  停滞判据（Z105 第五轮修订）：lastGoodResponseAt 只在"任意 2xx 且响应可解析"时刷新——
   *  已知中间态（running/pending）与未知 status 均刷新（禁"status∈已知集合"词表悬崖：provider 新增
   *  中间态会停刷新⇒误杀）；未知 status 记 exec_poll_unknown_status_total+WARN 不判停滞；
   *  连续异常（fetch 抛错/非 2xx/解析失败）超 pollInterval×STALL_LIMIT ⇒ PROVIDER_POLL_STALLED。 */
  private async pollLoop(kind: string, deadlineMs: number, onTick: PollOnTick | undefined, poll: () => Promise<PollOutcome>): Promise<any> {
    const startedAt = Date.now();
    const pollMs = envMs(process.env.EXEC_POLL_TIMEOUT_MS, EXEC_DEFAULTS.POLL);
    let lastGoodResponseAt = startedAt;
    for (;;) {
      if (onTick && (await onTick()) === 'abort') {
        throw new BusinessException('PROVIDER_POLL_ABORTED', `${kind} 轮询被 onTick 中止（意图失效/心跳门——T4 接线）`, HttpStatus.SERVICE_UNAVAILABLE);
      }
      if (Date.now() - startedAt >= deadlineMs) {
        intentDeadlineExceededTotal.inc({ kind, phase: 'call' });
        throw new BusinessException('PROVIDER_DEADLINE_EXCEEDED', `${kind} 外呼 deadline ${deadlineMs}ms 到点——强制收敛（Z68）`, HttpStatus.SERVICE_UNAVAILABLE);
      }
      await sleep(pollMs);
      const r = await poll();
      if (r.kind === 'succeeded') return r.json;
      if (r.kind === 'failed') throw new Error(`${kind} provider task failed: ${r.message}`);
      if (r.kind === 'lost') {
        throw new BusinessException('PROVIDER_TASK_LOST', `${kind} provider 任务不存在（404）——立即终态`, HttpStatus.SERVICE_UNAVAILABLE);
      }
      if (r.kind === 'unknown-status') {
        pollUnknownStatusTotal.inc({ kind });
        this.logger.warn(`[poll] ${kind} 未知中间态（可解析 2xx）——继续轮询不判停滞（Z105 词表悬崖防护）`);
        lastGoodResponseAt = Date.now();
        continue;
      }
      if (r.kind === 'progress') {
        lastGoodResponseAt = Date.now();
        continue;
      }
      // error：连续异常（不刷新 lastGoodResponseAt）——超窗即停滞终态
      if (Date.now() - lastGoodResponseAt > pollMs * STALL_LIMIT) {
        pollStallTotal.inc({ kind });
        throw new BusinessException(
          'PROVIDER_POLL_STALLED',
          `${kind} 轮询停滞：连续异常超 ${pollMs * STALL_LIMIT}ms 无有效响应（末次异常：${r.message}）`,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    }
  }

  /** DashScope 编辑链密钥（kind 级配置留代码侧——seedEnv 唯一源，无 AIModel 行） */
  private dashscopeKey(): string {
    const key = seedEnvValue('DASHSCOPE_API_KEY');
    if (!key) {
      throw new BusinessException('PROVIDER_API_KEY_MISSING', 'DASHSCOPE_API_KEY 未配置（编辑链 seedEnv 侧）', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return key;
  }

  private async dashscopeSubmit(path: string, body: unknown, kind: string): Promise<string> {
    const ms = envMs(process.env.EXEC_SUBMIT_TIMEOUT_MS, EXEC_DEFAULTS.SUBMIT);
    const res = await this.withDeadline(ms, (signal) =>
      fetch(`${this.dashscopeBaseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.dashscopeKey()}` },
        body: JSON.stringify(body),
        signal,
      }));
    if (!res.ok) throw new Error(`HTTP ${res.status}: DashScope ${path}（${kind} submit）`);
    const json = await res.json().catch(() => null) as any;
    const taskId = json?.output?.task_id ?? json?.task_id;
    if (!taskId) throw new Error(`${kind} submit failed: no task ID, got: ${JSON.stringify(json).slice(0, 200)}`);
    return String(taskId);
  }

  /** DashScope 编辑链 submit-poll 公共尾段（url+providerTaskId 双回传——submit-poll 类契约） */
  private async dashscopeRun(kind: string, path: string, body: unknown, opts?: EditCallOpts): Promise<{ url: string; providerTaskId: string }> {
    const taskId = await this.dashscopeSubmit(path, body, kind);
    opts?.onProviderTaskId?.(taskId);
    const result = await this.pollLoop(kind, deadlineMsForKind(kind), opts?.onTick, () => this.dashscopePoll(this.dashscopeKey(), taskId));
    const results = result.output?.results ?? result.results ?? [];
    const first = Array.isArray(results) ? results[0] : results;
    const resultUrl = typeof first === 'string' ? first : first?.url ?? first;
    return { url: String(resultUrl), providerTaskId: taskId };
  }

  async callOutpainting(
    imageUrl: string,
    rect: { x: number; y: number; width: number; height: number },
    imageWidth: number,
    imageHeight: number,
    onProgress?: (progress: number) => void,
    opts?: EditCallOpts,
  ): Promise<{ url: string; providerTaskId?: string | null }> {
    void onProgress; // 签名兼容保留（批7 前调用方形参）
    if (fakeAiEnabled()) { await this.fakeDelay(); return { url: '/mock/collab-fake-ai-image.jpg', providerTaskId: null }; }
    const t0 = Date.now();
    try {
      const top = Math.max(0, -rect.y);
      const bottom = Math.max(0, rect.y + rect.height - imageHeight);
      const left = Math.max(0, -rect.x);
      const right = Math.max(0, rect.x + rect.width - imageWidth);
      const { url, providerTaskId } = await this.dashscopeRun('outpaint', '/api/v1/services/aigc/image2image/out-painting', {
        model: 'wanx-outpainting-v1',
        input: {
          image_url: imageUrl,
          top: Math.round(top), bottom: Math.round(bottom), left: Math.round(left), right: Math.round(right),
        },
      }, opts);
      return { url, providerTaskId };
    } finally {
      outboundDuration.observe({ kind: 'outpaint' }, (Date.now() - t0) / 1000);
    }
  }

  async callErase(imageUrl: string, maskUrl: string, opts?: EditCallOpts): Promise<{ url: string; providerTaskId?: string | null }> {
    if (fakeAiEnabled()) { await this.fakeDelay(); return { url: '/mock/collab-fake-ai-image.jpg', providerTaskId: null }; }
    const t0 = Date.now();
    try {
      const { url, providerTaskId } = await this.dashscopeRun('erase', '/api/v1/services/aigc/image2image/in-painting', {
        model: 'wanx-inpainting-v1',
        input: { image_url: imageUrl, mask_url: maskUrl },
      }, opts);
      return { url, providerTaskId };
    } finally {
      outboundDuration.observe({ kind: 'erase' }, (Date.now() - t0) / 1000);
    }
  }

  async callRedraw(
    imageUrl: string,
    maskUrl: string,
    prompt: string,
    strength: number,
    opts?: EditCallOpts,
  ): Promise<{ url: string; providerTaskId?: string | null }> {
    if (fakeAiEnabled()) { await this.fakeDelay(); return { url: '/mock/collab-fake-ai-image.jpg', providerTaskId: null }; }
    const t0 = Date.now();
    try {
      const { url, providerTaskId } = await this.dashscopeRun('redraw', '/api/v1/services/aigc/image2image/image-repainting', {
        model: 'wanx-repainting-v1',
        input: { image_url: imageUrl, mask_url: maskUrl, prompt, strength: strength / 100 },
      }, opts);
      return { url, providerTaskId };
    } finally {
      outboundDuration.observe({ kind: 'redraw' }, (Date.now() - t0) / 1000);
    }
  }

  async callTextGen(params: TextGenParams): Promise<TextGenResult> {
    if (fakeAiEnabled()) {
      await this.fakeDelay();
      return { content: `[COLLAB_FAKE_AI] ${params.prompt.slice(0, 200)}`, providerTaskId: null };
    }
    const t0 = Date.now();
    try {
      const m = await this.resolveModel(params.model);
      this.assertDispatch(m, 'openai-chat', 'text');
      const res = await this.withDeadline(deadlineMsForKind('text'), (signal) =>
        fetch(`${m.apiUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m.apiKey}` },
          body: JSON.stringify({
            model: m.apiModelName,
            messages: [
              { role: 'system', content: '你是一个AI助手，请根据用户提示词生成内容。' },
              { role: 'user', content: params.prompt },
            ],
            temperature: 1,
            max_tokens: 4096,
          }),
          signal,
        }));
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${m.apiUrl}/chat/completions`);
      const json = await res.json().catch(() => null) as any;
      const content = json?.choices?.[0]?.message?.content;
      if (!content) {
        throw new BusinessException('PROVIDER_EMPTY_RESPONSE', `text 外呼空响应（choices 空/缺 message——provider=${m.provider}）`, HttpStatus.BAD_GATEWAY);
      }
      return { content, providerTaskId: null }; // Z88：text 无 provider 任务——显式 null
    } finally {
      outboundDuration.observe({ kind: 'text' }, (Date.now() - t0) / 1000);
    }
  }

  async callImageGen(params: ImageGenParams): Promise<ImageGenResult> {
    if (fakeAiEnabled()) { await this.fakeDelay(); return this.fakeImageUrl(params); }
    const t0 = Date.now();
    try {
      const m = await this.resolveModel(params.model);
      this.assertDispatch(m, 'tencent-submit-poll', 'image');
      const taskId = await this.tencentSubmit(m, { model: m.apiModelName, prompt: this.combinePrompt(params.prompt, params.extraPrompt) }, 'image');
      params.onProviderTaskId?.(taskId);
      const json = await this.pollLoop('image', deadlineMsForKind('image'), params.onTick, () => this.tencentPoll(m, taskId));
      const urls = json.data ?? json.results ?? json.images ?? [];
      const first = Array.isArray(urls) ? urls[0] : urls;
      const resultUrl = typeof first === 'string' ? first : first?.url ?? first;
      const [w, h] = (params.resolution || '1024×1024').split('×').map(Number);
      return { url: String(resultUrl), width: w || 1024, height: h || 1024, providerTaskId: taskId };
    } finally {
      outboundDuration.observe({ kind: 'image' }, (Date.now() - t0) / 1000);
    }
  }

  async callVideoGen(params: VideoGenParams): Promise<VideoGenResult> {
    if (fakeAiEnabled()) { await this.fakeDelay(); return { url: '/mock/collab-fake-ai-video.mp4', providerTaskId: null }; }
    const t0 = Date.now();
    try {
      const m = await this.resolveModel(params.model);
      this.assertDispatch(m, 'tencent-submit-poll', 'video');
      const body: Record<string, unknown> = { model: m.apiModelName, prompt: params.prompt };
      if (params.imageUrl) body.imageUrl = params.imageUrl;
      if (params.startImageUrl) body.startImageUrl = params.startImageUrl;
      if (params.endImageUrl) body.endImageUrl = params.endImageUrl;
      if (params.imageUrls?.length) body.imageUrls = params.imageUrls;
      const taskId = await this.tencentSubmit(m, body, 'video');
      params.onProviderTaskId?.(taskId);
      const json = await this.pollLoop('video', deadlineMsForKind('video'), params.onTick, () => this.tencentPoll(m, taskId));
      const urls = json.data ?? json.results ?? [];
      const first = Array.isArray(urls) ? urls[0] : urls;
      const resultUrl = typeof first === 'string' ? first : first?.url ?? first;
      return { url: String(resultUrl), providerTaskId: taskId };
    } finally {
      outboundDuration.observe({ kind: 'video' }, (Date.now() - t0) / 1000);
    }
  }

  async callRelighting(imageUrl: string, prompt: string, opts?: EditCallOpts): Promise<{ url: string; providerTaskId?: string | null }> {
    if (fakeAiEnabled()) { await this.fakeDelay(); return { url: '/mock/collab-fake-ai-image.jpg', providerTaskId: null }; }
    const t0 = Date.now();
    try {
      const { url, providerTaskId } = await this.dashscopeRun('lighting', '/api/v1/services/aigc/image2image/relighting', {
        model: 'wanx-image-relighting-v1',
        input: { image_url: imageUrl, prompt },
      }, opts);
      return { url, providerTaskId };
    } finally {
      outboundDuration.observe({ kind: 'lighting' }, (Date.now() - t0) / 1000);
    }
  }
}
