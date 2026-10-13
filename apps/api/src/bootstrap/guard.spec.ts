// apps/api/src/bootstrap/guard.spec.ts
// Y0b-3 T1（P14）：进程级 unhandledRejection 兜底——计数不退出。
// Y0b-5 T11：扩 uncaughtException handler（现缺）+Sentry capture（未 init=SDK 侧 no-op）；
// 安装提前到 NestFactory.create 之前（bootstrap 首行——引导窗全程覆盖）。
// 形态注记：vitest 自身注册全局 unhandledRejection handler（未设 dangerouslyIgnoreUnhandledErrors
// → 真实 Promise.reject 注入=文件判失败），故不走「注入真 rejection」端到端形态——
// spy process.on 抓取注册的 handler 直调（同款计数断言+禁抛断言，进程态等价）。
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { register } from 'prom-client';

vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));
import * as Sentry from '@sentry/nestjs';
import { installProcessErrorGuards } from './guard';

const count = async (source?: string): Promise<number> => {
  const m = register.getSingleMetric('collab_unhandled_rejection_total')!;
  const vals = (await m.get()).values;
  return vals.filter((v) => !source || v.labels.source === source).reduce((s, v) => s + v.value, 0);
};

/** 抓取 install 注册的指定事件 handler（spy callThrough——真实注册与抓取同一次） */
function grabHandler(event: 'unhandledRejection' | 'uncaughtException'): (reason: unknown, promise?: Promise<unknown>) => void {
  const onSpy = vi.spyOn(process, 'on');
  installProcessErrorGuards();
  const calls = onSpy.mock.calls.filter(([ev]) => ev === event);
  onSpy.mockRestore();
  expect(calls.length, `installProcessErrorGuards 必须恰好注册 1 个 ${event} listener`).toBe(1);
  return calls[0][1] as (reason: unknown, promise?: Promise<unknown>) => void;
}

describe('P14/T11 进程级兜底（函数化——create 前安装）', () => {
  type Handler = (reason: unknown, promise?: Promise<unknown>) => void;
  let grabbed: Handler[] = [];
  beforeEach(() => {
    vi.mocked(Sentry.captureException).mockClear();
  });
  afterEach(() => {
    // T1.5 评审小修：grabHandler 经 spy callThrough 真实注册——restoreAllMocks 只拆 spy，
    // listener 仍挂在 process 上（跨用例累积=计数双计面）。逐用例显式摘除。
    for (const h of grabbed) {
      process.removeListener('unhandledRejection', h);
      process.removeListener('uncaughtException', h);
    }
    grabbed = [];
    vi.restoreAllMocks();
  });

  it('unhandledRejection：直调 handler → source=process 计数+1、console.error 一行、Sentry capture、handler 自身不抛', async () => {
    const handler = grabHandler('unhandledRejection');
    grabbed.push(handler);
    const errSpy = vi.spyOn(console, 'error');
    const before = await count('process');
    expect(() => handler(new Error('probe'), Promise.resolve())).not.toThrow();   // 兜底自身禁抛
    expect(await count('process')).toBe(before + 1);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0]?.[0])).toContain('unhandledRejection');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);   // T11：除计数外加 capture（SENTRY_DSN 未设时 SDK 侧 no-op）
  });

  it('unhandledRejection：reason 非 Error（裸字符串）不炸——计数仍+1', async () => {
    const handler = grabHandler('unhandledRejection');
    grabbed.push(handler);
    const before = await count('process');
    expect(() => handler('raw string reason', Promise.resolve())).not.toThrow();
    expect(await count('process')).toBe(before + 1);
  });

  it('T11 uncaughtException：handler 注册（现缺补齐）→ source=uncaught 计数+1+console.error+Sentry capture+不抛', async () => {
    const handler = grabHandler('uncaughtException');
    grabbed.push(handler);
    const errSpy = vi.spyOn(console, 'error');
    const before = await count('uncaught');
    expect(() => handler(new Error('boom'))).not.toThrow();
    expect(await count('uncaught')).toBe(before + 1);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0]?.[0])).toContain('uncaughtException');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
