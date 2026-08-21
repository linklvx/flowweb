# Spec: TD-9 API 既有测试失败 9 例修复（测试卫生批次）

日期：2026-08-21
状态：待确认
来源：tech-debt.md 第二批（测试卫生），台账 TD-9

## 问题清单

2026-08-21 复验：9 例失败 / 5 文件，与台账记载完全一致。逐文件定位根因，**全部为测试过时（实现演进后断言/mock 未同步），零实现回归**——与台账来源记载（Fix 7 期间 git stash 基线比对、与业务无关）吻合。

| # | 文件 | 失败用例 | 根因（实现演进点） | 判定 |
|---|------|---------|------------------|------|
| 1 | `src/interceptors/transform.interceptor.spec.ts` | should wrap success response | 实现新增 `reflector.get(NO_TRANSFORM_KEY)` 依赖（interceptor.ts:18），测试构造未传 reflector → `undefined.get` 崩溃 | 测试过时 |
| 2-3 | `src/common/audit/audit.service.spec.ts` | required fields / minimal fields | membership 功能（21f439f）将 `beforeValue ?? null` 改为 `?? undefined`（省略可选列，DB 效果等同）；断言仍 toBeNull | 测试过时 |
| 4-6 | `src/modules/ai-image-edit/ai-image-edit.processor.spec.ts` | outpaint / erase 成功路径 + 失败路径积分 | Processor 构造函数新增第 6 依赖 `LightingConsumer`，TestModule 未提供 → Nest DI 解析失败 | 测试过时 |
| 7 | `src/modules/sms/sms.service.spec.ts` | should use singleton client | 实现新增 `SendStatusSet[0].Code !== 'Ok'` 发送状态校验（HTTP 200 ≠ 发送成功，合理防御）；mock 响应无该字段 → throw SMS_SEND_REJECTED | 测试过时 |
| 8-9 | `src/modules/material-library/controllers/file.controller.spec.ts` | files in folder / null folderId | controller 新增 `@Query('type') type?: 'image'\|'video'\|'audio'` 第 3 参透传 service（file.controller.ts:11，素材类型过滤），断言仍按两参 | 测试过时 |

## 修复设计

**只改测试，不改任何产品代码**（9 例根因均为实现的有意演进，行为正确）。

1. **transform.interceptor.spec**：构造 interceptor 时传 `{ get: () => false }` 的 mock reflector（覆盖 noTransform=false 主路径；不新增 noTransform=true 用例——实现分支简单且非本批范围）
2. **audit.service.spec**：两处 `beforeValue`/`afterValue` 断言 `toBeNull()` → `toBeUndefined()`；`remark` 断言保持 `toBeNull`（实现仍为 `?? null`）
3. **ai-image-edit.processor.spec**：TestModule providers 补 `LightingConsumer` mock（`{ handleLightingJob: vi.fn() }` 占位——已核实该依赖仅在 `taskType === 'lighting'` 分支触发，processor.ts:102-103，本 3 用例的 outpaint/erase/failure 路径不经过，纯 DI 解析需要）
4. **sms.service.spec**：mock `smsClient.SendSms` 返回值补 `{ SendStatusSet: [{ Code: 'Ok' }] }`
5. **file.controller.spec**：两处 service 调用断言补第 3 参数 `undefined`（controller 未传 type 时的实际透传值）

## 验证标准

1. `pnpm --filter @flowweb/api test` 全量绿（当前基线：9 failed / 其余全绿 → 目标 0 failed）
2. 不修改任何 `src/**/*.ts` 产品代码：以 `git diff --stat` 仅出现 `*.spec.ts` 为准（主验证）
3. 收尾跑一次 `pnpm --filter @flowweb/api exec tsc -b --noEmit` 作为产品代码未被误碰的编译护栏。**注意**：api tsconfig.json:15 排除 `**/*.spec.ts`，tsc 不检查本批改动文件，此项仅为护栏非类型验证
4. 修复过程中若发现某例实为实现回归（与当前判定矛盾）：停下报告，不擅自改实现
5. commit 粒度：单 commit（5 文件同为「测试跟实现演进」性质，无独立回滚价值，原子性便于审计）

## 不做什么

- 不新增测试用例（补覆盖属测试增强，非本批噪音清理目标）；清账时将以下覆盖缺口记入台账作后续条目：noTransform=true 分支、SMS SendStatusSet 拒绝分支、file.controller type 过滤分支、**api spec 文件不在 tsc 类型检查范围**——本批 9 例过时断言长期存活的结构性根因（`new TransformInterceptor()` 无参调用仅运行时暴露，测试与实现的接口漂移无编译期安全网）；候选方向：新增 tsconfig.spec.json 并 `tsc -p tsconfig.spec.json --noEmit` 单独检查测试类型
- 不重构测试基建（TestModule 工厂、公共 mock 提取等）
- 不动 TD-10（Prisma migrate）及其他台账项

## 风险（已核实消解）

- ~~LightingConsumer 是否在用例流程中被触发~~：已核实仅 lighting 分支调用（processor.ts:102-103），3 用例不经过，mock 纯占位
- ~~file.controller 第 3 参语义~~：已核实为 `@Query('type')` 素材类型过滤（file.controller.ts:11），未传时 undefined
- ~~remark 是否也已改为 ?? undefined~~：已核实 remark 仍为 `?? null`（audit.service.ts:31），仅 beforeValue/afterValue 两处改 toBeUndefined，remark 断言不动
- ~~LightingConsumer mock 方法名与 tsc 兼容性~~：已核实公开方法即 `handleLightingJob`（lighting.consumer.ts:76）；且 spec 文件被 tsc 排除、vitest 转译不做类型检查，useValue 纯对象模式与既有 5 个 mock provider 完全一致，无类型暴露面
- ~~transform.interceptor reflector.get 返回类型~~：已核实泛型为 `get<boolean>`（transform.interceptor.ts:18），`() => false` 兼容；spec 不在 tsc 范围，仅需运行时正确
- ~~beforeValue/afterValue 的 ?? undefined 与 Prisma 兼容性~~：已核实 schema.prisma:657-658 两字段均为 `Json?` 可选，undefined 省略即列 NULL，与 null 写入 DB 效果等同，无运行时报错可能（且该实现已在开发环境运行）
