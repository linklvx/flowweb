<!-- doc-status: historical | verified_at: n/a -->
# Plan: TD-9 API 既有测试失败 9 例修复

日期：2026-08-21
Spec：docs/superpowers/specs/td9-api-stale-tests-fix.md（已确认）
总原则：**只改 5 个 spec 文件，零产品代码改动**；9 例当前红即 TDD 红，逐文件转绿。
红绿闭环：任务 1-5 每个任务**修改前先跑一次单文件测试记录基线红（N failed）**，改后再跑确认 0 failed——显式闭环，防修错文件、防引入新失败。

## 任务 0：提交文档

- commit 1：`docs: spec and plan for TD-9 stale api tests fix`（spec + plan 两文件）
- 目的：使任务 1-5 的工作区 diff 仅含 spec 代码改动，git diff --stat 审计干净

## 任务 1：transform.interceptor.spec.ts（1 例）

- 改动：`new TransformInterceptor()` → `new TransformInterceptor({ get: () => false } as any)`
- `as any` 沿用该文件既有风格（context as any）；spec 不在 tsc 范围，仅需运行时正确
- 验证：`pnpm --filter @flowweb/api exec vitest run transform.interceptor.spec` → 1 passed

## 任务 2：audit.service.spec.ts（2 例）

- 改动：必填字段/最小字段两用例中 `beforeValue`/`afterValue` 断言 `toBeNull()` → `toBeUndefined()`；`remark` 断言不动（实现仍 `?? null`，audit.service.ts:31）
- 验证：单文件跑 → 2 passed

## 任务 3：ai-image-edit.processor.spec.ts（3 例）

- 改动：
  1. import 区补 `import { LightingConsumer } from './lighting/lighting.consumer';`（路径已核实：与 processor.ts:10 既有 import 完全一致）
  2. TestModule providers 数组末尾补 `{ provide: LightingConsumer, useValue: { handleLightingJob: vi.fn() } }`
- 方法名已核实（lighting.consumer.ts:76）；outpaint/erase/failure 路径不触发，纯 DI 解析占位
- 验证：单文件跑 → 3 passed

## 任务 4：sms.service.spec.ts（1 例）

- 改动：sms.service.spec.ts:10 `SendSms: vi.fn().mockResolvedValue({})` → `mockResolvedValue({ SendStatusSet: [{ Code: 'Ok' }] })`（mock 形状已核实：顶层平级单对象，无嵌套 body；空对象使实现的 SendStatusSet 校验抛 SMS_SEND_REJECTED）
- 验证：单文件跑 → 1 passed

## 任务 5：file.controller.spec.ts（2 例)

- 改动：两处 service 调用断言（files in folder / null folderId）补第 3 参数 `undefined`（controller `@Query('type')` 未传时的实际透传值）
- 验证：单文件跑 → 2 passed

## 任务 6：全量验证（spec 验证标准）

1. `pnpm --filter @flowweb/api test` → 0 failed（基线 9 failed）
2. `git diff --name-only HEAD` → 输出恰好 5 个 `*.spec.ts` 路径，零产品代码文件（--name-only 纯列表比 --stat 更直观；--stat 并跑作行数参考）
3. `pnpm --filter @flowweb/api exec tsc -b --noEmit` → 通过（护栏，注意 tsc 不检查 spec 文件）
4. 任一用例暴露实现回归 → 停下报告，不擅自改实现

## 任务 7：commit 2（test commit，用户已确认模板）

```
test(api): fix 9 stale assertions across 5 specs after implementation evolution (TD-9)

- transform.interceptor: pass mock reflector (NO_TRANSFORM_KEY dependency)
- audit.service: beforeValue/afterValue toBeNull → toBeUndefined (membership 21f439f)
- ai-image-edit.processor: add LightingConsumer mock provider (6th dependency)
- sms.service: mock SendStatusSet[{Code:'Ok'}] (send status guard)
- file.controller: assert 3rd type param undefined (@Query filter)

Zero product code changes. Verified via git diff --stat.
```

## 任务 8：台账清账

- tech-debt.md：TD-9 移入「已清账」表（引用 commit 2 hash；编号已核实：台账最新为 TD-12，TD-13/TD-14 可用）
- 新增两条：
  - TD-13 三个实现新增分支无测试覆盖（noTransform=true / SMS SendStatusSet 拒绝 / file.controller type 过滤），优先级低
  - TD-14 api spec 文件不在 tsc 类型检查范围（本批过时断言长期存活的结构性根因），候选方向：tsconfig.spec.json + `tsc -p tsconfig.spec.json --noEmit`
- commit 3：`docs: settle TD-9 in tech-debt ledger, add TD-13/14 coverage-gap entries`
