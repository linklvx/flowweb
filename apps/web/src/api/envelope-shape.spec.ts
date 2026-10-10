// apps/web/src/api/envelope-shape.spec.ts —— Y0b-2 T6（Z78 信封清剿）web 消费面
// fetchNodeIntents 的 rows 必须是数组（alignExecFromIntents 对齐成功的前提）：
//   清剿后真实形态=单层 {code:0,data:rows}（TransformInterceptor 全局包裹）⇒ apiFetch 返 json.data=数组 ✓；
//   改前=controller 手包 {code:0,data:{code:0,data:rows}} 双层 ⇒ apiFetch 返 {code,data} 对象 ⇒
//   rows?.[0] 恒 undefined ⇒ alignExecFromIntents 静默 no-op（恢复对齐整链失效的根因——本 spec 锚定）。
// api 侧单层断言（controller 裸值+interceptor 单包）：execution.security.spec / group-idempotency.int.spec；
// align 对齐终态分义（SUCCEEDED/FAILED/VOIDED+attempts）：canvasCollabRuntime.execView.spec。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchNodeIntents } from './executionApi';

const single = (rows: unknown) =>
  new Response(JSON.stringify({ code: 0, data: rows, message: 'ok' }), { status: 200 });
const double = (rows: unknown) =>
  new Response(JSON.stringify({ code: 0, data: { code: 0, data: rows }, message: 'ok' }), { status: 200 });

describe('Y0b-2 T6（Z78）：intents 信封单层——fetchNodeIntents 消费面', () => {
  afterEach(() => vi.restoreAllMocks());

  it('清剿后真实形态（单层）→ rows 为数组（alignExecFromIntents 激活后对齐成功的前提）', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(single([{ intentId: 'i-1', kind: 'image', status: 'SUCCEEDED', resultRef: 'f', error: null }]));
    const rows = await fetchNodeIntents('p1', 'n1');
    expect(Array.isArray(rows)).toBe(true);
    expect(rows[0]).toMatchObject({ intentId: 'i-1', status: 'SUCCEEDED' });
  });

  it('改前双层形态 → apiFetch 返 {code,data} 对象非数组（锚定改前 align 静默 no-op 根因——rows?.[0] 恒 undefined）', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(double([{ intentId: 'i-1' }]));
    const rows = await fetchNodeIntents('p1', 'n1');
    expect(Array.isArray(rows)).toBe(false); // 双层下消费面拿到的不是数组——对齐结构性失效
  });

  it('空列表 → 空数组（loading 保持——不误对齐）', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(single([]));
    const rows = await fetchNodeIntents('p1', 'n1');
    expect(rows).toEqual([]);
  });
});
