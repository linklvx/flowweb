// apps/api/src/bootstrap/guard.spec.ts
// Y0b-3 T1（P14）：进程级 unhandledRejection 兜底——计数不退出。
// 形态注记：vitest 自身注册全局 unhandledRejection handler（未设 dangerouslyIgnoreUnhandledErrors
// → 真实 Promise.reject 注入=文件判失败），故不走「注入真 rejection」端到端形态——
// spy process.on 抓取注册的 handler 直调（同款计数断言+禁抛断言，进程态等价）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { register } from 'prom-client';
import { installUnhandledRejectionGuard } from './guard';

const count = async (): Promise<number> => {
  const m = register.getSingleMetric('collab_unhandled_rejection_total')!;
  return (await m.get()).values.reduce((s, v) => s + v.value, 0);   // 带标签 counter=values 数组求和
};

/** 抓取 install 注册的 unhandledRejection handler（spy callThrough——真实注册与抓取同一次） */
function grabHandler(): (reason: unknown, promise: Promise<unknown>) => void {
  const onSpy = vi.spyOn(process, 'on');
  installUnhandledRejectionGuard();
  const calls = onSpy.mock.calls.filter(([ev]) => ev === 'unhandledRejection');
  onSpy.mockRestore();
  expect(calls.length, 'installUnhandledRejectionGuard 必须恰好注册 1 个 unhandledRejection listener').toBe(1);
  return calls[0][1] as (reason: unknown, promise: Promise<unknown>) => void;
}

describe('P14 unhandledRejection 兜底（函数化）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('注册 listener；直调 handler → source=process 计数+1、console.error 一行、handler 自身不抛', async () => {
    const handler = grabHandler();
    const errSpy = vi.spyOn(console, 'error');
    const before = await count();
    expect(() => handler(new Error('probe'), Promise.resolve())).not.toThrow();   // 兜底自身禁抛
    expect(await count()).toBe(before + 1);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0]?.[0])).toContain('unhandledRejection');
  });

  it('reason 非 Error（裸字符串）不炸——计数仍+1', async () => {
    const handler = grabHandler();
    const before = await count();
    expect(() => handler('raw string reason', Promise.resolve())).not.toThrow();
    expect(await count()).toBe(before + 1);
  });
});
