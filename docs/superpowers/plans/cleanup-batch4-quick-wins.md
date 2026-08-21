# Plan: 随手清批次（4a/4b/4c + 台账 docs commit）

日期：2026-08-21
Spec：docs/superpowers/specs/cleanup-batch4-quick-wins.md（已确认：D1 仅台账改写、D2 授权删 TD-16、D3 三子批，B1-B3/S1-S3 全落实）
总原则：总门禁（S3）——每个子批 commit 前 `pnpm --filter @flowweb/web test` 全绿 + `tsc -b` 零错误（web 侧子批）；4c 起 api 侧 `pnpm --filter @flowweb/api test` 全绿 + spec tsc 零错误。

## 任务 0：TD-15/TD-8 台账改写（独立 docs commit，先于 4a）

- 按 spec 附录改写稿逐字应用 tech-debt.md：TD-15 条目整体替换（断路+埋雷双实证、修复方向方案 A 预评审、优先级高）；TD-8 仅「现状」行改「孤儿累积进行中」
- commit：`docs(ledger): upgrade TD-15 to verified dual-finding, sync TD-8 status`

## 任务 1（4a）：web 微清理——TD-3 + TD-7 + TD-16

### 1.1 TD-7（先做，TDD 有红绿）

- 测试（先红，ImageGenNode.test.tsx 新 describe）：既有 mock 基建直接可用——`let mockNodeData`（:21）模块级可变、nodeStore mock 调用时取新值（注入点已核实）
  - `mockNodeData = undefined` → render → `getByTestId('node-loading-placeholder')` 存在、`toHaveAttribute('role', 'status')`、`toHaveAttribute('aria-live', 'polite')`、文案「内容加载中」；用 getByTestId+attr 断言（S1，规避 antd Spin 内部歧义）
  - afterEach 已有清理则复用；确保 mockNodeData 恢复默认
- 实现（转绿）：ImageGenNode.tsx:981 `if (!nodeData) return null;` → 返回占位 JSX：
  ```tsx
  if (!nodeData) return (
    <div data-testid="node-loading-placeholder" role="status" aria-live="polite" className="flex h-full items-center justify-center text-sm text-neutral-400">
      <Spin size="small" /> <span>内容加载中</span>
    </div>
  );
  ```
  （N4 已核实：ImageGenNode.tsx:23 现为 `import { Modal, message } from 'antd'`——扩行为 `{ Modal, message, Spin }`，单行无冲突）

### 1.2 TD-3（删除死写入）

- ImageGenNode.tsx:450：updateConfig 对象中删 `isSaving: false`（行变为 `transformMode: false,`）
- nodeStore.ts:128-129：删注释行 `// —— 变换保存流程写入的标记（ImageGenNode）——` 与 `isSaving?: boolean;`
- 前置检查：grep 测试文件确认无数据级 `isSaving` mock 依赖（工具栏 props 级无关）；有则一并清

### 1.3 TD-16（D2 已授权）

- 删 `apps/web/src/pages/canvas/hooks/useReactFlowSync.ts` + `useReactFlowSync.test.ts`（仅此二文件引用，已实证零接线）

### 1.4 4a 收口

- 总门禁 → 台账 TD-3/7/16 三行入已清账（commit 列暂「（hash 回填）」）
- 原子 commit：`refactor(web): quick cleanups TD-3/7/16 (dead write, loading placeholder, dead hook)`

## 任务 2（4b）：TD-12 类型卫生——锚点迁移 + 删字段（单原子）

1. **预演计数（N2 修正版命令）**：
   - A（嵌套处总数，预期 ≈52+）：`grep -rn 'allImages: \[\], referencedImageIds' apps/web/src --include='*.test.*' | wc -l`
   - B（根级空数组且不紧邻，预期少数；B 类**不迁移**——根级空数组是合法新形状，仅记录核对）：`grep -rn 'allImages: \[\]' apps/web/src --include='*.test.*' | grep -v 'referencedImageIds' | wc -l`
   - 若 A 与 10 文件分布预期严重不符（存在多行拆分形状）→ 该文件转人工
2. **sed 迁移**（N1 动态清单，避免硬编码遗漏）：
   ```bash
   grep -rln 'allImages: \[\], referencedImageIds' apps/web/src --include='*.test.*' > /tmp/td12_files.txt
   wc -l /tmp/td12_files.txt   # 预期 = 10，≠10 先核对再继续
   xargs sed -i 's/allImages: \[\], referencedImageIds:/referencedImageIds:/g' < /tmp/td12_files.txt
   ```
3. **验证协议**：锚点计数归零；`git diff --stat` 文件数=10；抽样 ≥5 处人工确认（必含 imageNodeApi.test.ts 根级含内容样例 :55-57 与 ImageGenNode.test.tsx :22）；全量测试 + tsc 双绿
4. **类型删除**：nodeStore.ts:90 删 `allImages: ImageItem[];`；:258 imageGenDefaults 删 allImages 键
5. tsc 再绿（若有非测试代码残留嵌套写入——预期无，PromptValue 必填报错会暴露）
6. 台账 TD-12 入已清账 → 原子 commit：`refactor(web): drop zombie PromptValue.allImages after mock migration (TD-12)`

## 任务 3（4c-1）：TD-14 spec 编译安全网

1. 新建 apps/api/tsconfig.spec.json（N3 显式 include，子配置 exclude 覆盖父级从而不再排除 spec）：
   ```json
   {
     "extends": "./tsconfig.json",
     "compilerOptions": { "noEmit": true },
     "include": ["src"],
     "exclude": ["node_modules", "dist"]
   }
   ```
2. **裸跑基线（S2）**：`pnpm --filter @flowweb/api exec tsc -p tsconfig.spec.json --noEmit`
   - 零错误 → 直接下一步；有残留 → **单独清零 commit**（不与 TD-14 混合），逐个修
3. 接入 test script：apps/api package.json `"test": "tsc -p tsconfig.spec.json --noEmit && vitest run"`
4. 验证：`pnpm --filter @flowweb/api test` 全绿（含 tsc 前置）
5. 台账 TD-14 入已清账 → commit：`build(api): typecheck spec files via tsconfig.spec.json (TD-14)`

## 任务 4（4c-2）：TD-13 三组分支测试（安全网下补）

三个 spec 文件均已存在（已核实），各加用例：

1. **transform.interceptor.spec.ts**：`@NoTransform` 直通分支——`Reflect.defineMetadata(NO_TRANSFORM_KEY, true, handler)` + 真 Reflector 构造 `new TransformInterceptor(new Reflector())`，断言输出为裸数据（无 code/data/message 包装）；对照组（无 metadata）已由既有用例覆盖
2. **sms.service.spec.ts**：拒绝分支——mock 腾讯 SDK 返回 `SendStatusSet: [{ Code: 'LimitExceeded' }]`，断言 throw 且 message 为 `LimitExceeded`（`status?.Code || 'SMS_SEND_REJECTED'` 语义，按 sms.service.ts:116-118 实码）；既有 mock 基建复用（执行时核实该文件对 tencent client 的 mock 注入点）
3. **file.controller.spec.ts**：type 过滤——`getFiles(req, folderId, 'image')` 断言 materialService.getFilesByFolderId 收到 `{ userId, folderId, type: 'image' }`（按 file.controller.ts:11-15 实参形状）；补不带 type 的对照（type: undefined）
4. 门禁（4c 总门禁含 spec tsc）→ 台账 TD-13 入已清账 → commit：`test(api): cover noTransform, sms rejection, file type filter branches (TD-13)`

## 任务 5：hash 回填 + 收官

- 微 docs commit：4a/4b/4c 三个 hash 回填已清账行；「集中修复建议批次」随手清行更新（TD-3/7/12/13/14/16 完成标记，TD-15 注明已升级另立）
- commit：`docs: backfill batch4 hashes in tech-debt ledger`

## 回滚路径

- 任务 0：单 docs commit revert
- 4a/4b/4c：各自单 commit revert（4b revert 后类型字段恢复但 mock 已迁移——revert 需整体回退同 commit 内两者，原子性保证）
- TD-16 文件恢复：`git checkout <4a-hash>~1 -- apps/web/src/pages/canvas/hooks/useReactFlowSync.ts useReactFlowSync.test.ts`
