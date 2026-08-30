# 素材库独立页 + works 团队页对齐 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec v6（docs/superpowers/specs/2026-08-30-materials-page-works-team-alignment-design.md）：works 团队 tab 二级页签+共享工作区组件对齐个人页、/materials 独立素材库页（store context 参数化消费 presign ②级）、material 后端防御加固、FileUpload/TeamSection 删除。

**Architecture:** works 页提取 `WorkspaceDimension` 共享组件（个人/团队唯一区别 `useWorkspaceData(teamId)`），团队页签 antd Tabs + URL 三分支回落；素材库 `MaterialLibraryModal` 主体提取 `MaterialLibraryBrowser`，全局单例 store 增加 `context` 字段 + `enterContext(ctx)` 单一入口；后端 material 模块 DTO 装饰器 + 类级 ValidationPipe 成对防护。

**Tech Stack:** React 19 + antd 5 + Zustand + react-router（apps/web）；NestJS + class-validator + Prisma（apps/api）；Vitest 两端。

**约定（全部任务适用）：**
- Web 测试命令：`cd D:/flowweb/apps/web && npx vitest run <路径>`；API：`cd D:/flowweb/apps/api && npx vitest run <路径>`
- TypeScript strict；每个任务独立红-绿-重构、独立提交
- spec 行号引用见 spec 文档；本计划中"§"均指 spec v6 章节

---

## 批 0 · 后端加固（无前端依赖，先行）

### Task 1: material DTO 装饰器 + BatchDeleteFilesDto

**Files:**
- Modify: `apps/api/src/modules/material-library/dto/create-folder.dto.ts`
- Modify: `apps/api/src/modules/material-library/dto/update-folder.dto.ts`
- Modify: `apps/api/src/modules/material-library/dto/move-file.dto.ts`
- Modify: `apps/api/src/modules/material-library/dto/move-folder.dto.ts`
- Create: `apps/api/src/modules/material-library/dto/batch-delete-files.dto.ts`
- Test: `apps/api/src/modules/material-library/dto/dto-decorators.spec.ts`（新建）

- [ ] **Step 1: 写失败测试**（验证装饰器存在且语义正确——纯 class-validator 单元测试，不起 Nest 模块）

```ts
// apps/api/src/modules/material-library/dto/dto-decorators.spec.ts
import { describe, it, expect } from 'vitest';
import { CreateFolderDto } from './create-folder.dto';
import { UpdateFolderDto } from './update-folder.dto';
import { MoveFileDto } from './move-file.dto';
import { MoveFolderDto } from './move-folder.dto';
import { BatchDeleteFilesDto } from './batch-delete-files.dto';

describe('material DTO 装饰器语义', () => {
  it('CreateFolderDto：合法值通过', () => {
    const dto = new CreateFolderDto();
    dto.name = '角色';
    dto.parentId = 'f1';
    dto.teamId = 't1';
    expect(dto.name).toBe('角色');
  });

  it('MoveFileDto：folderId null 通过（根目录语义）、缺失时为 undefined（必填由 ValidateIf 保证非空串校验）', () => {
    const dto = new MoveFileDto();
    dto.folderId = null;
    expect(dto.folderId).toBeNull();
  });

  it('BatchDeleteFilesDto：ids 数组 + teamId 可选', () => {
    const dto = new BatchDeleteFilesDto();
    dto.ids = ['a', 'b'];
    dto.teamId = 't1';
    expect(dto.ids).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd D:/flowweb/apps/api && npx vitest run src/modules/material-library/dto/dto-decorators.spec.ts`
Expected: FAIL —— `BatchDeleteFilesDto` 模块不存在（导入报错）

- [ ] **Step 3: 写实现**——4 个 DTO 补装饰器 + 新建 1 个。装饰器规则（spec §四）：可选可空（`?:`）用 `@IsOptional`；必填可空（`!:`、null 有语义）用 `@ValidateIf((_, v) => v !== null) @IsString()` 不叠 @IsOptional；顺手叠加 `@IsNotEmpty()` 拒空串（P4 加固）

```ts
// apps/api/src/modules/material-library/dto/create-folder.dto.ts
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateFolderDto {
  @IsString() @IsNotEmpty()
  name!: string;

  @IsOptional() @IsString()
  parentId?: string | null;

  @IsOptional() @IsString()
  teamId?: string;
}
```

```ts
// apps/api/src/modules/material-library/dto/update-folder.dto.ts
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class UpdateFolderDto {
  @IsOptional() @IsString() @IsNotEmpty()
  name?: string;

  @IsOptional() @IsString()
  teamId?: string;
}
```

```ts
// apps/api/src/modules/material-library/dto/move-file.dto.ts
import { IsString, IsNotEmpty, IsOptional, ValidateIf } from 'class-validator';

export class MoveFileDto {
  @ValidateIf((_, v) => v !== null) @IsString() @IsNotEmpty()
  folderId!: string | null;

  @IsOptional() @IsString()
  teamId?: string;
}
```

```ts
// apps/api/src/modules/material-library/dto/move-folder.dto.ts
import { IsString, IsNotEmpty, IsOptional, ValidateIf } from 'class-validator';

export class MoveFolderDto {
  @ValidateIf((_, v) => v !== null) @IsString() @IsNotEmpty()
  parentId!: string | null;

  @ValidateIf((_, v) => v !== null) @IsString() @IsNotEmpty()
  afterId!: string | null;

  @IsOptional() @IsString()
  teamId?: string;
}
```

```ts
// apps/api/src/modules/material-library/dto/batch-delete-files.dto.ts（新建）
import { IsArray, IsString, IsOptional } from 'class-validator';

export class BatchDeleteFilesDto {
  @IsArray() @IsString({ each: true })
  ids!: string[];

  @IsOptional() @IsString()
  teamId?: string;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd D:/flowweb/apps/api && npx vitest run src/modules/material-library/dto/dto-decorators.spec.ts`
Expected: PASS（3 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/modules/material-library/dto/
git commit -m "feat(api): material 4 个裸 DTO 补装饰器 + 新建 BatchDeleteFilesDto"
```

### Task 2: 类级 ValidationPipe + batchDelete DTO 替换 + folder.service data 收窄

**Files:**
- Modify: `apps/api/src/modules/material-library/controllers/file.controller.ts`（类级 Pipe + :51 内联类型替换）
- Modify: `apps/api/src/modules/material-library/controllers/folder.controller.ts`（类级 Pipe）
- Modify: `apps/api/src/modules/material-library/services/folder.service.ts:83`（data 收窄）
- Test: `apps/api/src/modules/material-library/dto/dto-whitelist.spec.ts`（新建）+ `services/folder.service.spec.ts`（追加用例）

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/modules/material-library/dto/dto-whitelist.spec.ts（新建）
import { describe, it, expect } from 'vitest';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { CreateFolderDto } from './create-folder.dto';
import { MoveFileDto } from './move-file.dto';
import { BatchDeleteFilesDto } from './batch-delete-files.dto';

describe('material DTO whitelist 剥离', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const meta = (mt: any) => ({ type: 'body', metatype: mt } as any);

  it('未声明字段被剥离、合法字段保留', async () => {
    const value = await pipe.transform(
      { name: 'x', teamId: 't1', malicious: 'hack' },
      meta(CreateFolderDto),
    );
    expect(value).toEqual({ name: 'x', teamId: 't1' });
    expect((value as any).malicious).toBeUndefined();
  });

  it('MoveFileDto 缺 folderId 被拒（必填可空）', async () => {
    await expect(
      pipe.transform({ teamId: 't1' }, meta(MoveFileDto)),
    ).rejects.toThrow(BadRequestException);
  });

  it('MoveFileDto folderId=null 通过（根目录）', async () => {
    const value = await pipe.transform({ folderId: null }, meta(MoveFileDto));
    expect(value).toEqual({ folderId: null });
  });

  it('BatchDeleteFilesDto ids 非数组被拒', async () => {
    await expect(
      pipe.transform({ ids: 'not-array' }, meta(BatchDeleteFilesDto)),
    ).rejects.toThrow(BadRequestException);
  });
});
```

在 `apps/api/src/modules/material-library/services/folder.service.spec.ts` 末尾追加 describe（复用文件顶部现有 mock 结构 `prisma`）：

```ts
  describe('update 写入收窄（spec §四）', () => {
    it('只写 name，不透传 dto 整体（SET teamId 隐式不变量消除）', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({ id: 'f1', teamId: 't1' });
      prisma.materialFolder.update.mockResolvedValue({ id: 'f1' });
      await service.update('f1', { name: '新名', teamId: 't1' } as any, 'u1');
      expect(prisma.materialFolder.update).toHaveBeenCalledWith({
        where: { id: 'f1' },
        data: { name: '新名' },
      });
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd D:/flowweb/apps/api && npx vitest run src/modules/material-library/dto/dto-whitelist.spec.ts src/modules/material-library/services/folder.service.spec.ts`
Expected: whitelist 4 条 PASS（Task 1 已补装饰器，pipe 直接可用——若 MoveFileDto 缺 folderId 用例不抛则说明 ValidateIf 写法有误）；service 收窄用例 FAIL（现状 `data: dto` 传入 `{ name, teamId }` 整体）

- [ ] **Step 3: 写实现**

`file.controller.ts`——类级加 Pipe，import 区加：

```ts
import { UsePipes, ValidationPipe } from '@nestjs/common';
import { BatchDeleteFilesDto } from '../dto/batch-delete-files.dto';
```

类声明改为（:7-8）：

```ts
@Controller('api/material/files')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class FileController {
```

batchDelete（:50-54）替换内联类型：

```ts
  @Post('batch-delete')
  async batchDelete(@Body() body: BatchDeleteFilesDto, @Req() req: any) {
    const count = await this.materialService.deleteFiles(req.user.id, body.ids, body.teamId);
    return { success: true, count };
  }
```

`folder.controller.ts`——import 区加：

```ts
import { UsePipes, ValidationPipe } from '@nestjs/common';
```

类声明改为（:8-9）：

```ts
@Controller('api/material/folders')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class FolderController {
```

`folder.service.ts:83` 收窄：

```ts
    return this.prisma.materialFolder.update({ where: { id }, data: { name: dto.name } });
```

- [ ] **Step 4: 跑测试确认通过 + 既有 material 测试回归**

Run: `cd D:/flowweb/apps/api && npx vitest run src/modules/material-library`
Expected: 全部 PASS（含既有 folder.controller.spec / file.controller.spec / folder.service.spec——若既有用例因 whitelist 拦截了非法测试载荷而失败，按"断言行为不变"原则修测试数据，不改产品代码）

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/modules/material-library/
git commit -m "feat(api): material 两 controller 类级 ValidationPipe + batchDelete DTO 化 + update 收窄 data:{name}"
```

---

## 批 1 · works 数据层

### Task 3: useTeams hook（三态 + 重试 + 排序）

**Files:**
- Create: `apps/web/src/pages/workspace/hooks/useTeams.ts`
- Test: `apps/web/src/pages/workspace/hooks/useTeams.test.tsx`（新建，命名对齐仓内 `useFolderNavigation.test.tsx` 惯例）

- [ ] **Step 1: 写失败测试**

```tsx
// apps/web/src/pages/workspace/hooks/useTeams.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTeams } from './useTeams';

const mockGetMyTeams = vi.fn();
vi.mock('@/api/teamApi', () => ({
  getMyTeams: (...args: any[]) => mockGetMyTeams(...args),
  teamDisplayName: (t: any) => t.name,
}));

const team = (id: string, isOwner: boolean, isDefault = false) => ({ id, name: id, isOwner, isDefault, memberCount: 1 });

describe('useTeams', () => {
  beforeEach(() => vi.clearAllMocks());

  it('成功：三态 success，realTeams 过滤 isDefault 且 owned 在前', async () => {
    mockGetMyTeams.mockResolvedValue([
      team('default', true, true),
      team('joined-1', false),
      team('owned-1', true),
    ]);
    const { result } = renderHook(() => useTeams());
    expect(result.current.state.status).toBe('loading');
    await waitFor(() => expect(result.current.state.status).toBe('success'));
    expect(result.current.realTeams.map((t) => t.id)).toEqual(['owned-1', 'joined-1']);
  });

  it('失败：error 终态，retry 后恢复（不再死屏）', async () => {
    mockGetMyTeams.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useTeams());
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    mockGetMyTeams.mockResolvedValue([team('owned-1', true)]);
    result.current.retry();
    await waitFor(() => expect(result.current.state.status).toBe('success'));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd D:/flowweb/apps/web && npx vitest run src/pages/workspace/hooks/useTeams.test.tsx`
Expected: FAIL —— 模块 `./useTeams` 不存在

- [ ] **Step 3: 写实现**

```ts
// apps/web/src/pages/workspace/hooks/useTeams.ts
import { useCallback, useEffect, useState } from 'react';
import { getMyTeams, type MyTeam } from '@/api/teamApi';

export type TeamsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; teams: MyTeam[] };

/** 团队列表三态 hook（works 与 /materials 复用）：失败落显式终态而非死屏（spec §一.1） */
export function useTeams() {
  const [state, setState] = useState<TeamsState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'success', teams: await getMyTeams() });
    } catch {
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const successTeams = state.status === 'success' ? state.teams : [];
  const realTeams = successTeams.filter((t) => !t.isDefault);
  const ordered = [...realTeams.filter((t) => t.isOwner), ...realTeams.filter((t) => !t.isOwner)];
  return { state, realTeams: ordered, retry: load };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd D:/flowweb/apps/web && npx vitest run src/pages/workspace/hooks/useTeams.test.tsx`
Expected: PASS（2 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/workspace/hooks/useTeams.ts apps/web/src/pages/workspace/hooks/useTeams.test.tsx
git commit -m "feat(web): useTeams hook 三态+重试+owned 前置排序（works/素材页复用）"
```

### Task 4: folderApi rename/delete 补 teamId 通道（spec §一.6 断链修复）

**Files:**
- Modify: `apps/web/src/api/folderApi.ts:25-31`
- Test: `apps/web/src/api/folderApi.test.ts`（新建；若已有则追加）

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/api/folderApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renameFolder, deleteFolder } from './folderApi';

const mockFetch = vi.fn();
vi.mock('./client', () => ({
  apiFetch: (...args: any[]) => mockFetch(...args),
}));

describe('folderApi teamId 通道', () => {
  beforeEach(() => { vi.clearAllMocks(); mockFetch.mockResolvedValue({}); });

  it('renameFolder 带 teamId → PATCH query', async () => {
    await renameFolder('f1', '新名', 't1');
    expect(mockFetch).toHaveBeenCalledWith('/folders/f1?teamId=t1', {
      method: 'PATCH',
      body: JSON.stringify({ name: '新名' }),
    });
  });

  it('renameFolder 无 teamId → 无 query（个人=默认团队回落）', async () => {
    await renameFolder('f1', '新名');
    expect(mockFetch).toHaveBeenCalledWith('/folders/f1', expect.objectContaining({ method: 'PATCH' }));
  });

  it('deleteFolder 带 teamId → DELETE query', async () => {
    await deleteFolder('f1', 't1');
    expect(mockFetch).toHaveBeenCalledWith('/folders/f1?teamId=t1', { method: 'DELETE' });
  });

  it('deleteFolder 无 teamId → 无 query', async () => {
    await deleteFolder('f1');
    expect(mockFetch).toHaveBeenCalledWith('/folders/f1', { method: 'DELETE' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd D:/flowweb/apps/web && npx vitest run src/api/folderApi.test.ts`
Expected: FAIL —— `renameFolder` 只收 2 参，第 3 参 teamId 被忽略，URL 无 query

- [ ] **Step 3: 写实现**（folderApi.ts:25-31 替换）

```ts
export function renameFolder(id: string, name: string, teamId?: string) {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  return apiFetch<{ id: string }>(`/folders/${id}${qs}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export function deleteFolder(id: string, teamId?: string) {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  return apiFetch<{ movedCanvasCount: number }>(`/folders/${id}${qs}`, { method: 'DELETE' });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd D:/flowweb/apps/web && npx vitest run src/api/folderApi.test.ts`
Expected: PASS（4 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/api/folderApi.ts apps/web/src/api/folderApi.test.ts
git commit -m "fix(web): folderApi rename/delete 补 teamId query——修团队文件夹 404 断链"
```

### Task 5: useWorkspaceData——initialFolderId + teamId 传递 + session 序号

**Files:**
- Modify: `apps/web/src/pages/workspace/hooks/useWorkspaceData.ts`
- Test: `apps/web/src/pages/workspace/__tests__/useWorkspaceData.test.tsx`（已存在，追加 describe）

- [ ] **Step 1: 写失败测试**（追加到现有测试文件末尾）

**Mock 风格（重要）**：现有 useWorkspaceData.test.tsx 顶部已是 hoisted `vi.mock('@/api/templateApi')` + `import { getTemplates, updateTemplate, deleteTemplate, getFolders, createFolder, renameFolder, deleteFolder }` + `vi.mocked(x)` 风格——**复用现有 mock 与导入，不要新增第二套 vi.mock**（同模块重复 mock 会互相覆盖）。新增 describe 中一律用 `vi.mocked(getTemplates)` / `vi.mocked(apiRenameFolder)` / `vi.mocked(apiDeleteFolder)` 断言（命名随现有文件导入别名）。

追加用例（renderHook/act/waitFor 从 '@testing-library/react' 导入，现有文件已有）：

```ts
describe('useWorkspaceData 维度化改造（spec §一.3/§一.6/竞态）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFolders).mockResolvedValue({ folders: [] } as never);
    vi.mocked(getTemplates).mockResolvedValue({ templates: [], totalPages: 1 } as never);
  });

  it('mount 直打 initialFolderId（首帧单请求，URL 原始值）', async () => {
    renderHook(() => useWorkspaceData(undefined, 'yyy'));
    await waitFor(() => expect(vi.mocked(getTemplates)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(getTemplates)).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'yyy' }));
  });

  it('无 initialFolderId → mount 打根目录 1 次', async () => {
    renderHook(() => useWorkspaceData());
    await waitFor(() => expect(vi.mocked(getTemplates)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(getTemplates)).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'root' }));
  });

  it('renameFolder/deleteFolder 传维度 teamId（断链修复）', async () => {
    const { result } = renderHook(() => useWorkspaceData('t1'));
    await waitFor(() => expect(result.current.status).toBe('success'));
    await result.current.renameFolder('f1', '新名');
    expect(vi.mocked(apiRenameFolder)).toHaveBeenCalledWith('f1', '新名', 't1');
    await result.current.deleteFolder('f1');
    expect(vi.mocked(apiDeleteFolder)).toHaveBeenCalledWith('f1', 't1');
  });

  it('loadFolder 替换型乱序：慢响应后到被丢弃', async () => {
    let resolveSlow!: (v: any) => void;
    vi.mocked(getTemplates).mockImplementation((q: any) =>
      (q.folderId ?? 'root') === 'A'
        ? new Promise((r) => { resolveSlow = r; })
        : Promise.resolve({ templates: [{ id: 'b' }], totalPages: 1 }),
    );
    const { result } = renderHook(() => useWorkspaceData());
    await act(async () => { await Promise.resolve(); });
    await act(async () => { void result.current.loadFolder('A'); });
    await act(async () => { void result.current.loadFolder('B'); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.canvases.map((c) => c.id)).toEqual(['b']); // B 已生效
    await act(async () => { resolveSlow({ templates: [{ id: 'a-stale' }], totalPages: 1 }); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.canvases.map((c) => c.id)).toEqual(['b']); // A 慢响应被丢弃
  });

  it('loadMore 追加型：sessionId 相等才 append', async () => {
    vi.mocked(getTemplates)
      .mockResolvedValueOnce({ templates: [{ id: 'c1' }], totalPages: 2 } as never)
      .mockResolvedValueOnce({ templates: [{ id: 'c2' }], totalPages: 2 } as never);
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.canvases.map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});
```

（乱序用例不用 fake timers——链路全是 Promise 无定时器，且 fake timers 会禁用 waitFor。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd D:/flowweb/apps/web && npx vitest run src/pages/workspace/__tests__/useWorkspaceData.test.tsx`
Expected: 新增用例 FAIL——`useWorkspaceData` 不收第 2 参；`renameFolder('f1','新名')` 调 `mockRenameFolder` 仅 2 参；乱序用例终态被 A 污染

- [ ] **Step 3: 写实现**（useWorkspaceData.ts 关键改动；import 区加 `useRef` 已有）

签名与 mount effect（:18、:55）：

```ts
export function useWorkspaceData(teamId?: string, initialFolderId?: string | null) {
```

mount effect（替换现有 `useEffect(() => { loadFolder(null); }, [loadFolder])`）：

```ts
  // 首帧按 URL 原始值直打目标（spec：initialFolderId 未经 nav valid 过滤），全场景挂载单请求
  const initialFolderIdRef = useRef(initialFolderId);
  useEffect(() => { loadFolder(initialFolderIdRef.current ?? null); }, [loadFolder]);
```

替换型/追加型 session 序号（loadFolder/loadMore，:37-71 区域重写）：

```ts
  const sessionIdRef = useRef(0);

  const loadFolder = useCallback(async (folderId: string | null) => {
    const session = ++sessionIdRef.current; // 替换型：递增并捕获
    currentRef.current = folderId;
    pageRef.current = 1;
    setPage(1);
    setStatus('loading');
    try {
      const [, data] = await Promise.all([
        refreshFolders(),
        getTemplates({ type: 'my', teamId, folderId: folderId ?? 'root', page: 1, limit: PAGE_SIZE }),
      ]);
      if (session !== sessionIdRef.current) return; // 同实例内已被更新请求覆盖
      setCanvases((data.templates ?? []).map(toCanvas));
      setHasMore(1 < (data.totalPages ?? 1));
      setStatus('success');
    } catch {
      if (session !== sessionIdRef.current) return;
      setStatus('error');
    }
  }, [refreshFolders, teamId]);
```

```ts
  const loadMore = useCallback(async () => {
    const session = sessionIdRef.current; // 追加型：捕获当前，不递增（翻页不互杀）
    const next = pageRef.current + 1;
    const folderId = currentRef.current;
    try {
      const data = await getTemplates({ type: 'my', teamId, folderId: folderId ?? 'root', page: next, limit: PAGE_SIZE });
      if (session !== sessionIdRef.current) return; // loadFolder/重挂载后丢弃
      setCanvases((prev) => [...prev, ...(data.templates ?? []).map(toCanvas)]);
      pageRef.current = next;
      setPage(next);
      setHasMore(next < (data.totalPages ?? 1));
    } catch {
      message.error('加载失败，请重试');
    }
  }, [teamId]);
```

renameFolder/deleteFolder 传 teamId + 依赖补全（:78-96）：

```ts
  const renameFolder = useCallback(async (id: string, name: string) => {
    const prev = folders;
    const now = new Date().toISOString();
    setFolders((fs) => fs.map((f) => (f.id === id ? { ...f, name, updatedAt: now } : f)));
    try {
      await apiRenameFolder(id, name, teamId);
    } catch {
      setFolders(prev);
      message.error('重命名失败，请重试');
    }
  }, [folders, teamId]);

  const deleteFolder = useCallback(async (id: string): Promise<number> => {
    const { movedCanvasCount } = await apiDeleteFolder(id, teamId);
    const target = currentRef.current === id ? null : currentRef.current;
    await Promise.all([refreshFolders(), loadFolder(target)]);
    return movedCanvasCount;
  }, [refreshFolders, loadFolder, teamId]);
```

- [ ] **Step 4: 跑测试确认通过 + 既有用例回归**

Run: `cd D:/flowweb/apps/web && npx vitest run src/pages/workspace/__tests__/useWorkspaceData.test.tsx`
Expected: 全 PASS。**既有用例适配（必做，非可选）**：
- `:131` 附近 `expect(apiDeleteFolder).toHaveBeenCalledWith('f2')` → 改为 `toHaveBeenCalledWith('f2', undefined)`（改造后实际传 2 参，参数个数校验会失败）
- 其他既有用例若因 mount 行为/依赖数组变化失败：只调整 setup（如显式传 initialFolderId），行为断言不变

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/workspace/hooks/useWorkspaceData.ts apps/web/src/pages/workspace/__tests__/useWorkspaceData.test.tsx
git commit -m "feat(web): useWorkspaceData 维度化——initialFolderId 首帧单请求+session 序号双语义+rename/delete 传 teamId"
```

---

## 批 2 · works UI 组装

### Task 6: WorkspaceDimension 共享组件（吸收个人分支全部）

**Files:**
- Create: `apps/web/src/pages/workspace/components/WorkspaceDimension.tsx`
- Test: `apps/web/src/pages/workspace/__tests__/WorkspaceDimension.test.tsx`（新建）

- [ ] **Step 1: 写失败测试**（关键断言：同构渲染、首帧单请求、CreateCanvasModal 传 teamId）

```tsx
// apps/web/src/pages/workspace/__tests__/WorkspaceDimension.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { WorkspaceDimension } from '../components/WorkspaceDimension';

const mockGetTemplates = vi.fn();
vi.mock('@/api/templateApi', () => ({
  getTemplates: (...a: any[]) => mockGetTemplates(...a),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));
const mockGetFolders = vi.fn();
vi.mock('@/api/folderApi', () => ({
  getFolders: (...a: any[]) => mockGetFolders(...a),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
}));
const mockGetNext = vi.fn();
vi.mock('@/api/canvasApi', () => ({
  createCanvas: vi.fn(),
  getNextUntitledName: (...a: any[]) => mockGetNext(...a),
}));

const renderDim = (teamId: string | undefined, initialEntries = ['/works']) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <WorkspaceDimension teamId={teamId} />
    </MemoryRouter>,
  );

const folderY = { id: 'yyy', name: 'Y', parentId: null, createdAt: '', updatedAt: '', canvasCount: 0, thumbnails: [] };

describe('WorkspaceDimension 共享组件', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFolders.mockResolvedValue({ folders: [] });
    mockGetTemplates.mockResolvedValue({ templates: [], totalPages: 1 });
    mockGetNext.mockResolvedValue({ name: '画布 1' });
  });

  it('个人维度：mount 单请求（folderId=root）+ 渲染新建画布卡', async () => {
    renderDim(undefined);
    await waitFor(() => expect(mockGetTemplates).toHaveBeenCalledTimes(1));
    expect(mockGetTemplates).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'root' }));
    expect(await screen.findByTestId('create-canvas-card')).toBeInTheDocument();
  });

  it('团队维度：请求带 teamId', async () => {
    renderDim('t1');
    await waitFor(() => expect(mockGetTemplates).toHaveBeenCalledTimes(1));
    expect(mockGetTemplates).toHaveBeenCalledWith(expect.objectContaining({ teamId: 't1' }));
  });

  it('有效 folder 直链：mount 直打 yyy 且全程仅 1 次请求', async () => {
    // folders 树必须含 yyy——空树下 yyy 会被判无效走 fallback，用例前提就变了（P0-2）
    mockGetFolders.mockResolvedValue({ folders: [folderY] });
    renderDim(undefined, ['/works?folder=yyy']);
    await waitFor(() => expect(mockGetTemplates).toHaveBeenCalledTimes(1));
    expect(mockGetTemplates).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'yyy' }));
  });

  it('无效 folder 直链：=2 次请求且终态根目录（spec 请求次数边界表）', async () => {
    // folders 树不含 yyy（beforeEach 默认空树）→ loaded 后 fallback replace 删 folder → URL raw 变 null 与基准不等 → 打根目录
    renderDim(undefined, ['/works?folder=yyy']);
    await waitFor(() => expect(mockGetTemplates).toHaveBeenCalledTimes(2), { timeout: 3000 });
    const lastCall = mockGetTemplates.mock.calls[mockGetTemplates.mock.calls.length - 1][0];
    expect(lastCall.folderId).toBe('root');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd D:/flowweb/apps/web && npx vitest run src/pages/workspace/__tests__/WorkspaceDimension.test.tsx`
Expected: FAIL —— 组件不存在

- [ ] **Step 3: 写实现**——把 WorkspacePage.tsx 的 :35-119（本地状态+items+effect+handlers）与 :168-268（渲染）与 :271-294（三弹窗）整体迁入。完整组件：

```tsx
// apps/web/src/pages/workspace/components/WorkspaceDimension.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useWorkspaceData } from '../hooks/useWorkspaceData';
import { useFolderNavigation } from '../hooks/useFolderNavigation';
import { WorkspaceToolbar } from './WorkspaceToolbar';
import { WorkspaceBreadcrumb } from './WorkspaceBreadcrumb';
import { CreateCanvasCard } from './CreateCanvasCard';
import { FolderCard } from './FolderCard';
import { CanvasCard } from './CanvasCard';
import { CreateFolderModal } from './CreateFolderModal';
import { CreateCanvasModal } from './CreateCanvasModal';
import { MoveToFolderModal } from './MoveToFolderModal';
import { EmptyState } from './EmptyState';
import { CardGridSkeleton } from './CardGridSkeleton';
import type { Canvas, FilterKind, FolderViewModel, ViewMode, WorkspaceItem } from '../types';

const byUpdatedDesc = (a: { updatedAt: string }, b: { updatedAt: string }) => b.updatedAt.localeCompare(a.updatedAt);

interface WorkspaceDimensionProps {
  teamId?: string;
}

/**
 * 工作区维度组件：个人（teamId=undefined）与团队 tab 选中团队渲染同一组件（spec §一.3）。
 * 以 key={teamId ?? 'personal'} 重挂载实现切维度状态归零；nav+data+URL effect 全部内聚，
 * 父组件只产出有效选中 teamId。
 */
export function WorkspaceDimension({ teamId }: WorkspaceDimensionProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // initialFolderId 取 URL 原始值（未经 nav valid 过滤——挂载瞬间 folders 为空会被判无效，spec §一.3）
  const initialFolderIdRef = useRef(searchParams.get('folder'));

  const data = useWorkspaceData(teamId, initialFolderIdRef.current);
  const nav = useFolderNavigation(data.folders, data.status !== 'loading');

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterKind>('all');
  const [folderModal, setFolderModal] = useState<{ open: boolean; rename?: FolderViewModel }>({ open: false });
  const [canvasModal, setCanvasModal] = useState(false);
  const [moveTarget, setMoveTarget] = useState<Canvas | null>(null);

  const items = useMemo<WorkspaceItem[]>(() => {
    let folders = data.folders;
    let canvases = data.canvases;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      folders = folders.filter((f) => f.name.toLowerCase().includes(q));
      canvases = canvases.filter((c) => c.name.toLowerCase().includes(q));
    } else {
      folders = folders.filter((f) => f.parentId === nav.currentFolderId);
      canvases = canvases.filter((c) => c.folderId === nav.currentFolderId);
    }
    if (filter === 'folders') canvases = [];
    if (filter === 'canvases') folders = [];
    return [
      ...[...folders].sort(byUpdatedDesc).map((f) => ({ type: 'folder' as const, data: f })),
      ...[...canvases].sort(byUpdatedDesc).map((c) => ({ type: 'canvas' as const, data: c })),
    ];
  }, [data.folders, data.canvases, searchQuery, filter, nav.currentFolderId]);

  const showCreateCanvasCard = !searchQuery && filter !== 'folders';

  // URL→loadFolder 单一数据流（v6.1 勘误版，raw + lastLoadedRef）：盯「原始 searchParams」而非
  // nav.currentFolderId——nav 值经 valid 过滤（useFolderNavigation:41-42），挂载瞬间 folders 为空 →
  // 有效 folder 也返回 null，请求回来后 null→yyy 跳变会被误判为"后续导航"造成双发。
  // 基准初始化 = 挂载时 raw → 首帧必然等于基准自然被吞（firstRender 冗余，省略）；
  // 与 fallback effect（useFolderNavigation:8,12 同盯 raw）数据源一致，「fallback 删 URL → 回落根目录」链路才闭合。
  // loadFolder 引用实例内稳定（useCallback 依赖 [refreshFolders, teamId]，teamId 只随 key 重挂载变化）。
  const rawFolderId = searchParams.get('folder');
  const lastLoadedRef = useRef<string | null>(rawFolderId);
  useEffect(() => {
    if (rawFolderId === lastLoadedRef.current) return; // valid 恢复造成的跳变 / 首帧，mount 已加载，吞掉
    lastLoadedRef.current = rawFolderId;
    void data.loadFolder(rawFolderId);
  }, [rawFolderId, data.loadFolder]);

  const enterFolder = (folderId: string | null) => {
    nav.setCurrentFolderId(folderId);
    setSearchQuery('');
  };

  const onItemClick = (item: WorkspaceItem) => {
    if (data.status === 'loading') return;
    if (item.type === 'folder') enterFolder(item.data.id);
    else if (item.data.projectId) navigate(`/canvas?projectId=${item.data.projectId}`);
    else navigate(`/works/${item.data.id}`);
  };

  const handleDeleteFolder = async (folder: FolderViewModel) => {
    try {
      const moved = await data.deleteFolder(folder.id);
      message.success(moved > 0 ? `文件夹已删除，${moved} 张画布已移至根目录` : '文件夹已删除');
    } catch {
      message.error('删除失败，请重试');
    }
  };

  const handleCreateCanvas = async (name: string, folderId: string | null) => {
    setCanvasModal(false);
    try {
      const projectId = await data.createCanvas(name, folderId);
      navigate(`/canvas?projectId=${projectId}`);
    } catch {
      message.error('创建画布失败，请重试');
    }
  };

  const gridClass = 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4';
  const isEmpty = items.length === 0 && !showCreateCanvasCard;

  return (
    <>
      <WorkspaceToolbar
        viewMode={viewMode} onViewModeChange={setViewMode}
        onSearchChange={setSearchQuery}
        filter={filter} onFilterChange={setFilter}
        onCreateFolder={() => setFolderModal({ open: true })}
      />
      <WorkspaceBreadcrumb
        path={nav.path} currentFolderId={nav.currentFolderId}
        searchQuery={searchQuery}
        onNavigate={enterFolder}
        onClearSearch={() => setSearchQuery('')}
      />
      <div className="px-8 pb-10">
        {data.status === 'loading' && <CardGridSkeleton />}
        {data.status === 'error' && <EmptyState variant="error" onAction={data.reload} />}
        {data.status === 'success' && isEmpty && (
          <EmptyState
            variant={searchQuery ? 'no-results' : nav.currentFolderId ? 'empty-folder' : 'empty-root'}
            onAction={searchQuery ? () => setSearchQuery('') : () => setCanvasModal(true)}
          />
        )}
        {data.status === 'success' && !isEmpty && viewMode === 'grid' && (
          <>
            <ul className={gridClass} data-testid="workspace-grid">
              {showCreateCanvasCard && (
                <li data-testid="create-canvas-card"><CreateCanvasCard onClick={() => setCanvasModal(true)} /></li>
              )}
              {items.map((item) => (
                <li key={item.data.id}>
                  {item.type === 'folder' ? (
                    <FolderCard
                      folder={item.data}
                      showCount={!searchQuery}
                      onClick={() => onItemClick(item)}
                      onRequestRename={(f) => setFolderModal({ open: true, rename: f })}
                      onDelete={handleDeleteFolder}
                    />
                  ) : (
                    <CanvasCard
                      canvas={item.data}
                      onClick={() => onItemClick(item)}
                      onRename={data.renameCanvas}
                      onMove={setMoveTarget}
                      onTogglePublic={data.togglePublic}
                      onDelete={(c) => { void data.deleteCanvas(c.id); }}
                    />
                  )}
                </li>
              ))}
            </ul>
            {data.hasMore && !searchQuery && (
              <button
                data-testid="load-more"
                onClick={() => { void data.loadMore(); }}
                className="mt-4 mx-auto block px-6 py-2 border border-white/20 rounded-lg text-sm text-white/70 bg-transparent cursor-pointer hover:border-white/40"
              >
                加载更多
              </button>
            )}
          </>
        )}
        {data.status === 'success' && !isEmpty && viewMode === 'list' && (
          <>
            <ul className="flex flex-col" data-testid="workspace-list">
              {showCreateCanvasCard && (
                <li data-testid="create-canvas-card" className="px-4 py-2">
                  <button
                    onClick={() => setCanvasModal(true)}
                    className="h-12 w-full flex items-center justify-center gap-2 border border-dashed border-white/20 rounded-lg text-sm text-white/60 bg-transparent cursor-pointer hover:border-white/40"
                  >
                    <PlusOutlined /> 新建画布
                  </button>
                </li>
              )}
              {items.map((item) => (
                <li key={item.data.id}>
                  {item.type === 'folder' ? (
                    <FolderCard
                      variant="list"
                      folder={item.data}
                      showCount={!searchQuery}
                      onClick={() => onItemClick(item)}
                      onRequestRename={(f) => setFolderModal({ open: true, rename: f })}
                      onDelete={handleDeleteFolder}
                    />
                  ) : (
                    <CanvasCard
                      variant="list"
                      canvas={item.data}
                      onClick={() => onItemClick(item)}
                      onRename={data.renameCanvas}
                      onMove={setMoveTarget}
                      onTogglePublic={data.togglePublic}
                      onDelete={(c) => { void data.deleteCanvas(c.id); }}
                    />
                  )}
                </li>
              ))}
            </ul>
            {data.hasMore && !searchQuery && (
              <button
                data-testid="load-more"
                onClick={() => { void data.loadMore(); }}
                className="mt-4 mx-auto block px-6 py-2 border border-white/20 rounded-lg text-sm text-white/70 bg-transparent cursor-pointer hover:border-white/40"
              >
                加载更多
              </button>
            )}
          </>
        )}
      </div>

      <CreateFolderModal
        open={folderModal.open}
        initialName={folderModal.rename?.name}
        onOk={(name) => {
          if (folderModal.rename) data.renameFolder(folderModal.rename.id, name);
          else data.createFolder(name);
          setFolderModal({ open: false });
        }}
        onCancel={() => setFolderModal({ open: false })}
      />
      <CreateCanvasModal
        open={canvasModal}
        teamId={teamId}
        folders={data.folders}
        defaultFolderId={nav.currentFolderId}
        onOk={handleCreateCanvas}
        onCancel={() => setCanvasModal(false)}
      />
      <MoveToFolderModal
        open={!!moveTarget}
        folders={data.folders}
        currentFolderId={moveTarget?.folderId ?? null}
        onOk={(folderId) => { if (moveTarget) data.moveCanvas(moveTarget.id, folderId); setMoveTarget(null); }}
        onCancel={() => setMoveTarget(null)}
      />
    </>
  );
}
```

**配套改造（必须执行）**：一级 tab 行从 `WorkspaceToolbar` 上移到父组件，避免维度组件内重复渲染。新建 `WorkspaceTabBar.tsx`（一级 tab 按钮，代码见上）；改造 `WorkspaceToolbar.tsx`——删除 `activeTab`/`onTabChange`/`showTools` props 与 :43-52 的 tab 按钮区块（工具行 :53-90 原样保留，`showTools !== false` 条件简化为恒显）。

**ToolbarBreadcrumb.test.tsx 适配（P1-5，断言对象随迁移走）**：
- `:29-40` 两条 tab 用例（页签受控/激活态）的被测对象已迁至 WorkspaceTabBar → 新建 `__tests__/WorkspaceTabBar.test.tsx` 承接这两条（render `<WorkspaceTabBar activeTab=... onTabChange=.../>`，断言原样）
- `:43` `showTools=false 隐藏工具` 用例随 prop 一起**删除**（新设计工具行恒显）
- `renderToolbar` 默认 props（:15-27）删除 `activeTab`/`onTabChange` 两键
- `:98-117` Breadcrumb 用例不受影响，原样保留

```tsx
// apps/web/src/pages/workspace/components/WorkspaceTabBar.tsx（新建）
interface WorkspaceTabBarProps {
  activeTab: 'personal' | 'team';
  onTabChange: (tab: 'personal' | 'team') => void;
  labels?: { personal: string; team: string };
}

export function WorkspaceTabBar({ activeTab, onTabChange, labels = { personal: '个人', team: '团队项目' } }: WorkspaceTabBarProps) {
  return (
    <div className="flex gap-2 text-lg items-center px-8 pt-2">
      <button
        onClick={() => onTabChange('personal')}
        className={`mx-3 py-1.5 bg-transparent ${activeTab === 'personal' ? 'text-white border-b-2 border-white border-x-0 border-t-0 cursor-pointer' : 'text-white/60 border-none cursor-pointer'}`}
      >{labels.personal}</button>
      <button
        onClick={() => onTabChange('team')}
        className={`mx-3 py-1.5 bg-transparent ${activeTab === 'team' ? 'text-white border-b-2 border-white border-x-0 border-t-0 cursor-pointer' : 'text-white/60 border-none cursor-pointer'}`}
      >{labels.team}</button>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd D:/flowweb/apps/web && npx vitest run src/pages/workspace/__tests__/WorkspaceDimension.test.tsx src/pages/workspace/__tests__/WorkspaceTabBar.test.tsx src/pages/workspace/__tests__/ToolbarBreadcrumb.test.tsx`
Expected: 新用例 PASS；WorkspaceTabBar.test（配套改造新建）PASS；ToolbarBreadcrumb 既有用例按 P1-5 适配后 PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/workspace/
git commit -m "feat(web): WorkspaceDimension 共享组件——个人/团队同构渲染+首帧单请求+工具行恒显"
```

### Task 7: WorkspacePage 瘦身 + 团队页签 + 三分支回落 + 删 TeamSection

**Files:**
- Modify: `apps/web/src/pages/workspace/WorkspacePage.tsx`（全文重写为瘦身后版本）
- Delete: `apps/web/src/pages/workspace/components/TeamSection.tsx`
- Delete: `apps/web/src/pages/workspace/__tests__/TeamSection.test.tsx`
- Test: `apps/web/src/pages/workspace/__tests__/WorkspacePage.test.tsx`（已存在，追加团队分支用例；`WorkspacePage.folder-create.test.tsx` 回归）

- [ ] **Step 1: 写失败测试**（追加到 WorkspacePage.test.tsx；顶部 mock 参照现有文件的 mock 结构，另需 `vi.mock('@/api/teamApi')` 提供 getMyTeams/teamDisplayName）

```tsx
describe('WorkspacePage 团队 tab（spec §一.1/§一.2）', () => {
  const team = (id: string, isOwner: boolean) => ({ id, name: id, isOwner, isDefault: false, memberCount: 2 });

  it('团队页签：owned 在前 joined 在后、平铺无分组标题、默认选第一个', async () => {
    mockGetMyTeams.mockResolvedValue([team('joined-1', false), team('owned-1', true)]);
    renderPage('/works?tab=team');
    await waitFor(() => expect(screen.getByTestId('team-tabs-row')).toBeInTheDocument());
    const tabs = screen.getByTestId('team-tabs-row').querySelectorAll('.ant-tabs-tab');
    expect(tabs[0].textContent).toContain('owned-1');
    expect(tabs[1].textContent).toContain('joined-1');
    expect(screen.queryByText('我创建的')).not.toBeInTheDocument();
    expect(window.location.search).toContain('teamId=owned-1'); // replace 补默认
  });

  it('非法 teamId 直链：replace 到第一个真实团队且不带 folder', async () => {
    mockGetMyTeams.mockResolvedValue([team('owned-1', true)]);
    renderPage('/works?tab=team&teamId=bogus&folder=fff');
    await waitFor(() => expect(screen.getByTestId('team-tabs-row')).toBeInTheDocument());
    expect(window.location.search).not.toContain('folder=');
    expect(window.location.search).toContain('teamId=owned-1');
  });

  it('teams 加载失败：渲染失败+重试，不挂载维度组件（不死屏）', async () => {
    mockGetMyTeams.mockRejectedValue(new Error('boom'));
    renderPage('/works?tab=team');
    await waitFor(() => expect(screen.getByTestId('teams-error')).toBeInTheDocument());
    expect(screen.queryByTestId('workspace-grid')).not.toBeInTheDocument();
  });

  it('无真实团队：team-empty-state', async () => {
    mockGetMyTeams.mockResolvedValue([{ id: 'd', name: '默认', isOwner: true, isDefault: true, memberCount: 1 }]);
    renderPage('/works?tab=team');
    await waitFor(() => expect(screen.getByTestId('team-empty-state')).toBeInTheDocument());
  });

  it('teams 未就绪：不挂载维度组件（不发画布请求）', () => {
    mockGetMyTeams.mockReturnValue(new Promise(() => {}));
    renderPage('/works?tab=team&teamId=t1');
    expect(screen.queryByTestId('workspace-grid')).not.toBeInTheDocument();
    expect(vi.mocked(templateApi.getTemplates)).not.toHaveBeenCalled();
  });

  it('切团队：维度组件 key 重挂载，搜索/筛选等本地 state 归零', async () => {
    mockGetMyTeams.mockResolvedValue([team('t1', true), team('t2', true)]);
    renderPage('/works?tab=team');
    await waitFor(() => expect(screen.getByTestId('team-tabs-row')).toBeInTheDocument());
    // 输入搜索词后切团队 → 新维度实例搜索框为空
    const searchInput = screen.getByLabelText('搜索');
    fireEvent.change(searchInput, { target: { value: 'abc' } });
    const tab2 = screen.getByTestId('team-tabs-row').querySelectorAll('.ant-tabs-tab')[1];
    fireEvent.click(tab2!);
    await waitFor(() => {
      const fresh = screen.getByLabelText('搜索') as HTMLInputElement;
      expect(fresh.value).toBe('');
    });
  });
});
```

（`renderPage` 为现有文件里的渲染辅助——若无名则封装 `render(<MemoryRouter initialEntries={[url]}><WorkspacePage /></MemoryRouter>)`；`mockGetMyTeams` 在顶部 `vi.mock('@/api/teamApi', ...)` 中定义；**mock 断言风格（P1-3）**：该文件是 `import * as templateApi from '@/api/templateApi'` + `vi.mocked()` 风格，无 mockGetTemplates 本地变量——画布请求断言一律 `vi.mocked(templateApi.getTemplates)`；`fireEvent` 从 '@testing-library/react' 导入——注意 antd5 测试中 input 受控变更用 fireEvent.change 生效，参照记忆 antd5_testing_quirks。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd D:/flowweb/apps/web && npx vitest run src/pages/workspace/__tests__/WorkspacePage.test.tsx`
Expected: 新用例 FAIL——现状平铺 TeamSection、无 team-tabs-row、失败死屏

- [ ] **Step 3: 写实现**——WorkspacePage.tsx 全文重写：

```tsx
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, Tabs } from 'antd';
import { Navbar } from '@/pages/home/components/Navbar';
import { teamDisplayName } from '@/api/teamApi';
import { useTeams } from './hooks/useTeams';
import { WorkspaceTabBar } from './components/WorkspaceTabBar';
import { WorkspaceDimension } from './components/WorkspaceDimension';
import type { MyTeam } from '@/api/teamApi';

export function WorkspacePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: 'personal' | 'team' = searchParams.get('tab') === 'team' ? 'team' : 'personal';
  const urlTeamId = searchParams.get('teamId');
  const { state, realTeams, retry } = useTeams();

  // 切页签：清 folder 与 teamId（D3 扩展，spec §一.2）
  const setTab = (t: 'personal' | 'team') => {
    setSearchParams(t === 'team' ? { tab: 'team' } : {}, { replace: true });
  };
  // 切团队：清 folder（spec §一.2）
  const setTeamId = (id: string) => setSearchParams({ tab: 'team', teamId: id }, { replace: true });

  const validTeamId = urlTeamId && realTeams.some((t) => t.id === urlTeamId) ? urlTeamId : null;

  // 直链 teamId 回落三分支（spec §一.2）：teams 就绪后修正 URL（replace，不污染后退栈；不带 folder）
  useEffect(() => {
    if (tab !== 'team' || state.status !== 'success' || realTeams.length === 0) return;
    if (!validTeamId) {
      setSearchParams({ tab: 'team', teamId: realTeams[0].id }, { replace: true });
    }
  }, [tab, state.status, validTeamId, realTeams, setSearchParams]);

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />
      <div className="mx-auto max-w-[1640px] pt-4">
        <WorkspaceTabBar activeTab={tab} onTabChange={setTab} />
        {tab === 'team' ? (
          state.status === 'loading' ? (
            <p className="text-sm text-[#888] px-8 pt-4">加载中…</p>
          ) : state.status === 'error' ? (
            <div className="flex flex-col items-center py-20 gap-3" data-testid="teams-error">
              <p className="text-sm text-[#888]">团队列表加载失败</p>
              <Button onClick={() => retry()}>重试</Button>
            </div>
          ) : realTeams.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3" data-testid="team-empty-state">
              <p className="text-sm text-[#888]">还没有团队，创建一个开始协作吧</p>
              <Button type="primary" onClick={() => navigate('/team')}>前往创建团队</Button>
            </div>
          ) : validTeamId ? (
            <>
              <div className="px-8" data-testid="team-tabs-row">
                <Tabs
                  activeKey={validTeamId}
                  onChange={setTeamId}
                  items={realTeams.map((t) => ({ key: t.id, label: teamTabLabel(t) }))}
                />
              </div>
              <WorkspaceDimension key={validTeamId} teamId={validTeamId} />
            </>
          ) : (
            <p className="text-sm text-[#888] px-8 pt-4">加载中…</p>
          )
        ) : (
          <WorkspaceDimension key="personal" />
        )}
      </div>
    </div>
  );
}

function teamTabLabel(t: MyTeam) {
  return <span>{teamDisplayName(t)}<span className="text-xs text-[#888] ml-1">{t.memberCount}</span></span>;
}
```

**清理清单（Step 3 一并执行）**：删除 WorkspacePage 中不再使用的 imports——`useWorkspaceData`（data/nav 已下沉 Dimension）、`useFolderNavigation`（随重写自然消失）、以及原 :5-20 的全部卡片/弹窗/工具组件 imports（TeamSection/CreateCanvasCard/FolderCard/CanvasCard/CreateFolderModal/CreateCanvasModal/MoveToFolderModal/EmptyState/CardGridSkeleton/getMyTeams 内联 state 等，均已迁入 Dimension 或被 useTeams 替代）。

删除两个文件：

```bash
git rm apps/web/src/pages/workspace/components/TeamSection.tsx apps/web/src/pages/workspace/__tests__/TeamSection.test.tsx
```

同时清理 WorkspacePage 中不再使用的 imports（getMyTeams/MyTeam 内联 state、TeamSection、全部卡片/弹窗/工具组件——已迁入 Dimension）。

- [ ] **Step 4: 跑测试确认通过 + 既有回归**

Run: `cd D:/flowweb/apps/web && npx vitest run src/pages/workspace`
Expected: 全 PASS。**既有用例适配（必做）**：
- `WorkspacePage.test.tsx:207-219`「?tab=team 渲染团队分组（我创建的/我加入的）」——新设计**删除分组标题**，该用例必须重写为 team-tabs-row 页签断言（owned 前 joined 后 + `queryByText('我创建的')` not.toBe；mock 数据结构沿用其现有 MyTeam 全字段 fixture）
- `:221-227` 空态用例可保留（断言 不再需要——新空态同文案同 testid）
- `WorkspacePage.folder-create.test.tsx`：个人分支渲染路径不变，仅外层多 WorkspaceTabBar；mock getMyTeams 需提供默认成功值避免团队请求干扰

- [ ] **Step 5: 提交**

```bash
git add -A apps/web/src/pages/workspace/
git commit -m "feat(web): WorkspacePage 团队二级页签+三分支回落+删 TeamSection——团队 tab 与个人页同构"
```

---

## 批 3 · 素材 store

### Task 8: context 字段 + enterContext 完整重置

**Files:**
- Modify: `apps/web/src/stores/materialLibraryStore.ts`
- Test: `apps/web/src/stores/materialLibraryStore.test.ts`（追加）

- [ ] **Step 1: 写失败测试**（追加 describe）

```ts
describe('materialLibraryStore - enterContext 完整重置（spec §二.3）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('重置清单全覆盖：context+selectedFolderId+folders+files+batchMode+selectedFileIds+renameModal', async () => {
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    // 预置脏状态（模拟团队 A 的残留）
    useMaterialLibraryStore.setState({
      selectedFolderId: 'folder-A',
      folders: [{ id: 'fa', name: 'A文件夹', parentId: null, userId: 'u1', sortOrder: 0, isDefault: false, createdAt: '', updatedAt: '' }] as any,
      files: [{ id: 'fa-file' }] as any,
      batchMode: true,
      selectedFileIds: new Set(['fa-file']),
      renameModal: { open: true, folderId: 'fa', defaultValue: 'x' },
    });

    await useMaterialLibraryStore.getState().enterContext({ teamId: 'B' });

    const s = useMaterialLibraryStore.getState();
    expect(s.context).toEqual({ teamId: 'B' });
    expect(s.selectedFolderId).toBeNull();
    expect(s.folders).toEqual([]);
    expect(s.files).toEqual([]);
    expect(s.batchMode).toBe(false);
    expect(s.selectedFileIds.size).toBe(0);
    expect((s as any).renameModal).toEqual({ open: false, folderId: null, defaultValue: '' });
    expect(mockGet).toHaveBeenCalledWith('/api/material/folders', expect.objectContaining({
      params: expect.objectContaining({ teamId: 'B' }),
    }));
  });

  it('跨团队批量误操作回归：A 勾选残留切 B 后 batchDelete 请求体不含 A 的 fileId', async () => {
    mockPost.mockResolvedValue({ data: { data: { success: true, count: 0 } } });
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    useMaterialLibraryStore.setState({ batchMode: true, selectedFileIds: new Set(['file-A1', 'file-A2']) });

    await useMaterialLibraryStore.getState().enterContext({});
    useMaterialLibraryStore.getState().enterBatchMode();
    await useMaterialLibraryStore.getState().batchDelete();

    expect(mockPost).toHaveBeenCalledWith('/api/material/files/batch-delete', { ids: [] });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd D:/flowweb/apps/web && npx vitest run src/stores/materialLibraryStore.test.ts`
Expected: FAIL——store 无 `context` 字段、无 `enterContext` action

- [ ] **Step 3: 写实现**（materialLibraryStore.ts）

import 区后加类型与常量：

```ts
export interface MaterialLibraryContext {
  teamId?: string;
  projectId?: string;
}

const RENAME_MODAL_INIT: RenameModalState = { open: false, folderId: null, defaultValue: '' };
```

`MaterialLibraryState` 接口（:16-52）增加：

```ts
  context: MaterialLibraryContext;
  enterContext: (ctx: MaterialLibraryContext) => void;
```

初始值区（:54-66）改 `renameModal: RENAME_MODAL_INIT` 并加 `context: {}`；action 区（:68-72 附近）加：

```ts
  enterContext: (ctx) => {
    // 单一入口：完整重置 + reload（spec §二.3，时序约束编码进 API）
    set({
      context: ctx,
      selectedFolderId: null,
      folders: [],
      files: [],
      batchMode: false,
      selectedFileIds: new Set(),
      renameModal: RENAME_MODAL_INIT,
    });
    void get().loadFolders();
    void get().loadFiles();
  },
```

（`close()`（:69）同步改为复用常量：`renameModal: RENAME_MODAL_INIT`——保持行为一致。）

- [ ] **Step 4: 跑测试确认通过 + 既有回归**

Run: `cd D:/flowweb/apps/web && npx vitest run src/stores/materialLibraryStore.test.ts`
Expected: 全 PASS（既有用例未动断言）

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/stores/materialLibraryStore.ts apps/web/src/stores/materialLibraryStore.test.ts
git commit -m "feat(web): materialLibraryStore context 字段+enterContext 完整重置——防跨团队串台与批量误操作"
```

### Task 9: 12 action 注入 + uploadFile 快照 + 替换型序号 + deleteFolder 补 loadFiles

**Files:**
- Modify: `apps/web/src/stores/materialLibraryStore.ts`
- Test: `apps/web/src/stores/materialLibraryStore.test.ts`（追加）

- [ ] **Step 1: 写失败测试**（追加 describe；既有"画布团队维度"describe 的 `vi.mock('@/stores/canvasStore')` 保留但不再被生产代码消费——相关用例改走 setState context）

```ts
describe('materialLibraryStore - context 注入与快照（spec §二.4/§二.5）', () => {
  // 文件头部 import 区补：import { waitFor } from '@testing-library/react';
  // （乱序用例穿两层 await 需 waitFor 而非单次 await Promise.resolve()）
  beforeEach(() => {
    vi.clearAllMocks();
    useMaterialLibraryStore.setState({
      context: {}, folders: [], selectedFolderId: null, files: [], uploading: false, uploadProgress: 0,
    });
  });

  it('个人上下文 loadFolders 不带 teamId（③级回落）', async () => {
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    await useMaterialLibraryStore.getState().loadFolders();
    expect(mockGet).toHaveBeenCalledWith('/api/material/folders', { params: {} });
  });

  it('团队上下文 loadFiles 带 teamId（②级）', async () => {
    useMaterialLibraryStore.setState({ context: { teamId: 'T2' } });
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    await useMaterialLibraryStore.getState().loadFiles();
    expect(mockGet).toHaveBeenCalledWith('/api/material/files', expect.objectContaining({
      params: expect.objectContaining({ teamId: 'T2' }),
    }));
  });

  it('createFolder body 带 teamId', async () => {
    useMaterialLibraryStore.setState({ context: { teamId: 'T2' } });
    mockPost.mockResolvedValue({ data: {} });
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    await useMaterialLibraryStore.getState().createFolder('新夹', null);
    expect(mockPost).toHaveBeenCalledWith('/api/material/folders', { name: '新夹', parentId: null, teamId: 'T2' });
  });

  it('renameFolder/moveFolder body 带 teamId；deleteFolder/moveFolderUp query 带 teamId', async () => {
    useMaterialLibraryStore.setState({
      context: { teamId: 'T2' },
      folders: [{ id: 'f1', name: 'a', parentId: null, userId: 'u1', sortOrder: 0, isDefault: false, createdAt: '', updatedAt: '' }] as any,
    });
    mockPut.mockResolvedValue({ data: {} });
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    mockDelete.mockResolvedValue({ data: {} });
    await useMaterialLibraryStore.getState().renameFolder('f1', 'b');
    expect(mockPut).toHaveBeenCalledWith('/api/material/folders/f1', { name: 'b', teamId: 'T2' });
    await useMaterialLibraryStore.getState().moveFolder('f1', { parentId: null, afterId: null });
    expect(mockPut).toHaveBeenCalledWith('/api/material/folders/f1/move', { parentId: null, afterId: null, teamId: 'T2' });
    await useMaterialLibraryStore.getState().moveFolderUp('f1');
    expect(mockPut).toHaveBeenCalledWith('/api/material/folders/f1/move-up', { params: { teamId: 'T2' } });
    await useMaterialLibraryStore.getState().deleteFolder('f1');
    expect(mockDelete).toHaveBeenCalledWith('/api/material/folders/f1', { params: { teamId: 'T2' } });
  });

  it('deleteFolder 后 loadFiles 被调用（残留修复）', async () => {
    mockDelete.mockResolvedValue({ data: {} });
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
    await useMaterialLibraryStore.getState().deleteFolder('f1');
    expect(mockGet).toHaveBeenCalledWith('/api/material/files', expect.anything());
  });

  it('deleteFile/toggleFavorite query 带 teamId', async () => {
    useMaterialLibraryStore.setState({ context: { teamId: 'T2' }, files: [{ id: 'x1' }] as any });
    mockDelete.mockResolvedValue({ data: {} });
    mockPut.mockResolvedValue({ data: { data: { success: true, data: { isFavorite: true } } } });
    await useMaterialLibraryStore.getState().deleteFile('x1');
    expect(mockDelete).toHaveBeenCalledWith('/api/material/files/x1', { params: { teamId: 'T2' } });
    await useMaterialLibraryStore.getState().toggleFavorite('x1');
    expect(mockPut).toHaveBeenCalledWith('/api/material/files/x1/toggle-favorite', { params: { teamId: 'T2' } });
  });

  it('batchDelete/batchMove body 带 teamId', async () => {
    useMaterialLibraryStore.setState({ context: { teamId: 'T2' }, batchMode: true, selectedFileIds: new Set(['a']) });
    mockPost.mockResolvedValue({ data: { data: { success: true, count: 1 } } });
    await useMaterialLibraryStore.getState().batchDelete();
    expect(mockPost).toHaveBeenCalledWith('/api/material/files/batch-delete', { ids: ['a'], teamId: 'T2' });
    useMaterialLibraryStore.setState({ batchMode: true, selectedFileIds: new Set(['a']), selectedFolderId: 'f1' });
    await useMaterialLibraryStore.getState().batchMove('f2');
    expect(mockPost).toHaveBeenCalledWith('/api/material/files/batch-move', { ids: ['a'], folderId: 'f2', teamId: 'T2' });
  });

  it('uploadFile 快照：presign/move 用快照 teamId+projectId，末尾仅 context 未变才刷新', async () => {
    useMaterialLibraryStore.setState({ context: { teamId: 'A', projectId: 'P' }, selectedFolderId: 'fa' });
    mockPresignUpload.mockImplementation(async () => {
      // 上传在途时用户切到团队 B
      useMaterialLibraryStore.setState({ context: { teamId: 'B' }, selectedFolderId: null, files: [{ id: 'b-file' }] as any });
      return { fileId: 'fid', uploadUrl: 'http://127.0.0.1:9000/flowai/k1', key: 'k1', fields: {} };
    });
    mockConfirmUpload.mockResolvedValue({});
    mockPost.mockResolvedValue({ data: {} });
    mockPut.mockResolvedValue({ data: {} });

    await useMaterialLibraryStore.getState().uploadFile(new File(['x'], 'a.png', { type: 'image/png' }));

    expect(mockPresignUpload).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'A', projectId: 'P' }));
    expect(mockPut).toHaveBeenCalledWith('/api/material/files/fid/move', { folderId: 'fa', teamId: 'A' });
    // 末尾不刷新旧视图（context 已变，mockGet 不应被 loadFiles 以旧团队调用刷新当前态）
    const calls = mockGet.mock.calls.filter((c: any[]) => c[0] === '/api/material/files');
    expect(calls.every((c: any[]) => c[1]?.params?.teamId !== 'A')).toBe(true);
  });

  it('loadFolders 替换型乱序：慢响应后到被丢弃', async () => {
    let resolveSlow!: (v: any) => void;
    mockGet.mockImplementation((url: string, cfg?: any) => {
      if (cfg?.params?.teamId === 'A') return new Promise((r) => { resolveSlow = r; });
      return Promise.resolve({ data: { data: { success: true, data: [{ id: 'b-folder' }] } } });
    });
    const store = useMaterialLibraryStore.getState();
    void store.enterContext({ teamId: 'A' });
    void store.enterContext({ teamId: 'B' });
    await waitFor(() => expect(useMaterialLibraryStore.getState().folders).toEqual([{ id: 'b-folder' }]));
    resolveSlow({ data: { data: { success: true, data: [{ id: 'a-stale' }] } } });
    await waitFor(() => expect(useMaterialLibraryStore.getState().folders).toEqual([{ id: 'b-folder' }])); // A 被丢弃
  });
});
```

（注：快照用例中 `teamId: 'A'` 断言——presignUpload 现签名 `presignUpload({...})`，改造后加传 `teamId`；`confirmUpload` **不传 teamId**（spec §二.4 显式排除），用例同步断言：`expect(mockConfirmUpload).toHaveBeenCalledWith(expect.not.objectContaining({ teamId: expect.anything() }))`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd D:/flowweb/apps/web && npx vitest run src/stores/materialLibraryStore.test.ts`
Expected: 新用例全 FAIL——action 仍从 canvasStore 取值/不带 teamId

- [ ] **Step 3: 写实现**（materialLibraryStore.ts 逐 action 改造）

顶部（create 闭包内、state 定义前）加序号变量：

```ts
let foldersSeq = 0;
let filesSeq = 0;
```

loadFolders（:74-86 重写）：

```ts
  loadFolders: async () => {
    const seq = ++foldersSeq;
    set({ loading: true });
    try {
      const { data } = await axios.get('/api/material/folders', {
        params: { teamId: get().context.teamId ?? undefined },
      });
      if (seq !== foldersSeq) return;
      if (data.data?.success) set({ folders: data.data.data });
    } catch {
      // silently handle error
    } finally {
      if (seq === foldersSeq) set({ loading: false });
    }
  },
```

loadFiles（:88-112 重写，序号同型 + `const { teamId } = get().context;` params 注入；URL 改写逻辑 :98-104 原样保留）：

```ts
  loadFiles: async () => {
    const seq = ++filesSeq;
    set({ loading: true, batchMode: false, selectedFileIds: new Set() });
    try {
      const { selectedFolderId } = get();
      const { data } = await axios.get('/api/material/files', {
        params: { folderId: selectedFolderId, teamId: get().context.teamId ?? undefined },
      });
      if (seq !== filesSeq) return;
      if (data.data?.success) {
        const files = (data.data.data as any[]).map((f: any) => ({
          ...f,
          url: (f.url as string).replace(/^https?:\/\/[^/]+\/flowai/, '/flowai'),
          thumbnailUrl: f.thumbnailUrl
            ? (f.thumbnailUrl as string).replace(/^https?:\/\/[^/]+\/flowai/, '/flowai')
            : undefined,
        }));
        set({ files });
      }
    } catch {
      // silently handle error
    } finally {
      if (seq === filesSeq) set({ loading: false });
    }
  },
```

createFolder（:114-121）——body 条件注入 teamId（避免 undefined 字段，保持既有测试兼容）：

```ts
  createFolder: async (name, parentId = null) => {
    const { folders, context } = get();
    const parentKey = parentId ?? null;
    const dup = folders.find((f) => f.name === name && (f.parentId ?? null) === parentKey);
    if (dup) { message.error('同名文件夹已存在'); return; }
    const body: { name: string; parentId: string | null; teamId?: string } = { name, parentId };
    if (context.teamId) body.teamId = context.teamId;
    await axios.post('/api/material/folders', body);
    await get().loadFolders();
  },
```

renameFolder（:123-132）：

```ts
  renameFolder: async (id, name) => {
    const { folders, context } = get();
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    const parentKey = folder.parentId ?? null;
    const dup = folders.find((f) => f.id !== id && f.name === name && (f.parentId ?? null) === parentKey);
    if (dup) { message.error('同名文件夹已存在'); return; }
    const body: { name: string; teamId?: string } = { name };
    if (context.teamId) body.teamId = context.teamId;
    await axios.put(`/api/material/folders/${id}`, body);
    await get().loadFolders();
  },
```

deleteFolder（:134-140）——query teamId + 补 loadFiles：

```ts
  deleteFolder: async (id) => {
    await axios.delete(`/api/material/folders/${id}`, { params: { teamId: get().context.teamId ?? undefined } });
    const { selectedFolderId } = get();
    if (selectedFolderId === id) set({ selectedFolderId: null });
    message.success('文件夹删除成功');
    await Promise.all([get().loadFolders(), get().loadFiles()]);
  },
```

moveFolderUp（:142-145）/ moveFolder（:147-155）：

```ts
  moveFolderUp: async (id) => {
    await axios.put(`/api/material/folders/${id}/move-up`, null, { params: { teamId: get().context.teamId ?? undefined } });
    await get().loadFolders();
  },

  moveFolder: async (id, dto) => {
    try {
      const body = { ...dto, teamId: get().context.teamId };
      await axios.put(`/api/material/folders/${id}/move`, body);
      await get().loadFolders();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err.message || '未知错误';
      message.error(`移动文件夹失败：${msg}`);
    }
  },
```

uploadFile（:157-206 重写——快照 + context 注入 + 末尾刷新口径）：

```ts
  uploadFile: async (file) => {
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) { message.warning('仅支持图片和视频文件'); return; }
    const maxSize = isVideo ? MAX_FILE_SIZE.video : MAX_FILE_SIZE.image;
    if (file.size > maxSize) {
      message.warning(`文件太大，${isVideo ? '视频' : '图片'}最大 ${maxSize / 1024 / 1024}MB`);
      return;
    }

    set({ uploading: true, uploadProgress: 0 });
    const source = axios.CancelToken.source();
    try {
      // 请求链路一律快照（spec §二.5）：上传在途的上下文切换不影响归属
      const snapCtx = { ...get().context };
      const snapFolderId = get().selectedFolderId;

      const { fileId, uploadUrl, key, fields } = await presignUpload({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        type: 'uploaded',
        teamId: snapCtx.teamId,
        projectId: snapCtx.projectId,
      });

      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);

      const proxyUrl = uploadUrl.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');

      await axios.post(proxyUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        cancelToken: source.token,
        onUploadProgress: (e) => set({ uploadProgress: Math.round((e.loaded * 100) / (e.total || 1)) }),
      });

      // confirm 不传 teamId：后端按 fileId 自证（spec §二.4 显式排除）
      await confirmUpload({ fileId, key, fileSize: file.size });

      await axios.put(`/api/material/files/${fileId}/move`, { folderId: snapFolderId, teamId: snapCtx.teamId });

      // 末尾刷新口径：仅当前 context 与快照一致且 folder 未变才刷新（spec §二.5）
      const cur = get();
      const ctxUnchanged =
        cur.context.teamId === snapCtx.teamId && cur.context.projectId === snapCtx.projectId;
      if (ctxUnchanged && cur.selectedFolderId === snapFolderId) {
        await get().loadFiles();
      }
    } catch (err) {
      if (!axios.isCancel(err)) console.error('Upload failed:', err);
    } finally {
      set({ uploading: false, uploadProgress: 0 });
    }
  },
```

deleteFile（:208-211）/ toggleFavorite（:213-218）：

```ts
  deleteFile: async (id) => {
    await axios.delete(`/api/material/files/${id}`, { params: { teamId: get().context.teamId ?? undefined } });
    set((s) => ({ files: s.files.filter((f) => f.id !== id) }));
  },

  toggleFavorite: async (id) => {
    const { data } = await axios.put(`/api/material/files/${id}/toggle-favorite`, null, { params: { teamId: get().context.teamId ?? undefined } });
    if (data.data?.success) {
      set((s) => ({ files: s.files.map((f) => f.id === id ? { ...f, isFavorite: data.data.data.isFavorite } : f) }));
    }
  },
```

batchDelete（:241-262）/ batchMove（:264-292）——body 条件注入：

```ts
  batchDelete: async () => {
    const { selectedFileIds, context } = get();
    if (selectedFileIds.size === 0) return;
    try {
      const body: { ids: string[]; teamId?: string } = { ids: Array.from(selectedFileIds) };
      if (context.teamId) body.teamId = context.teamId;
      const { data } = await axios.post('/api/material/files/batch-delete', body);
      set((s) => ({
        files: s.files.filter((f) => !selectedFileIds.has(f.id)),
        batchMode: false,
        selectedFileIds: new Set(),
      }));
      const count = data.data?.count ?? 0;
      if (count === selectedFileIds.size) {
        message.success(`成功删除 ${count} 个文件`);
      } else {
        message.warning(`部分文件删除失败，成功删除 ${count}/${selectedFileIds.size} 个`);
      }
    } catch {
      message.error('批量删除失败，请稍后重试');
    }
  },

  batchMove: async (folderId) => {
    const { selectedFileIds, selectedFolderId, context } = get();
    if (selectedFileIds.size === 0) return;
    if (folderId === selectedFolderId) {
      message.warning('文件已在目标文件夹中');
      return;
    }
    try {
      const ids = Array.from(selectedFileIds);
      const body: { ids: string[]; folderId: string | null; teamId?: string } = { ids, folderId };
      if (context.teamId) body.teamId = context.teamId;
      const { data } = await axios.post('/api/material/files/batch-move', body);
      const count = data.data?.count ?? 0;
      if (count > 0) {
        set((s) => ({
          files: s.files.filter((f) => !selectedFileIds.has(f.id)),
          batchMode: false,
          selectedFileIds: new Set(),
        }));
        if (count === selectedFileIds.size) {
          message.success(`成功移动 ${count} 个文件`);
        } else {
          message.warning(`部分文件移动失败，成功移动 ${count}/${selectedFileIds.size} 个`);
        }
      } else {
        message.info('没有文件被移动');
      }
    } catch {
      message.error('批量移动失败，请稍后重试');
    }
  },
```

最后**同步接通 Modal 调用点（消除中间态）**：`MaterialLibraryModal.tsx` 的 load effect（原 :42-44 `if (isOpen) { loadFolders(); loadFiles(); }`）改为下述 enterContext 版，并**删除 :27-28 的 `loadFolders`/`loadFiles` 订阅**（仅被旧 effect 使用，改后闲置）：

```tsx
  const enterContext = useMaterialLibraryStore((s) => s.enterContext);
  useEffect(() => {
    if (isOpen) {
      const cs = useCanvasStore.getState();
      enterContext({ teamId: cs.teamId ?? undefined, projectId: cs.projectId ?? undefined });
    }
  }, [isOpen, enterContext]);
```

（store 层的 `import { useCanvasStore } from './canvasStore'`（:5）删除——store 不再依赖画布 store；Modal 自身的 useCanvasStore 引用保留至 Task 11 提取 Browser 时由 handleApplyFile 继续使用。store+Modal 接通在同一 commit，无"画布内回落个人上下文"中间态。）

- [ ] **Step 4: 跑测试确认通过 + 既有回归**

Run: `cd D:/flowweb/apps/web && npx vitest run src/stores/materialLibraryStore.test.ts`
Expected: 全 PASS。既有"画布团队维度"describe 的 2 个用例（:288-324）改造 setup：删除 canvasStore mock 依赖，改 `useMaterialLibraryStore.setState({ context: { teamId: 't-team', projectId: 'p1' } })` 后调用——断言不变

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/stores/materialLibraryStore.ts apps/web/src/stores/materialLibraryStore.test.ts apps/web/src/components/MaterialLibrary/MaterialLibraryModal.tsx
git commit -m "feat(web): material store 12 action context 注入+uploadFile 快照+替换型序号+deleteFolder 补 loadFiles；Modal 同步接通 enterContext"
```

---

## 批 4 · 素材 UI

### Task 10: onApplyFile 透传链（Popover 按钮条件渲染 + 预览保留）

**Files:**
- Modify: `apps/web/src/components/MaterialLibrary/FilePreviewPopover.tsx:16-17`（props 可选化 + :190 按钮条件渲染）
- Modify: `apps/web/src/components/MaterialLibrary/FileGrid/FileCard.tsx`（props + 删 canvasStore 依赖）
- Modify: `apps/web/src/components/MaterialLibrary/FileGrid/FileGrid.tsx`（props 透传）
- Test: `apps/web/src/components/MaterialLibrary/FileGrid/FileCard.test.tsx`（追加）

- [ ] **Step 1: 写失败测试**（追加到 FileCard.test.tsx。**P1-6 前置适配**：该文件 :31-50 现有 mock 的 FilePreviewPopoverContent 无条件渲染"应用到画布"按钮——先改 mock 为 `{onApplyToCanvas && <button>应用到画布</button>}` 并给 Popover mock 的 trigger div 加 `data-testid="popover-trigger"`；antd 合成 mouseEnter 不冒泡，事件必须打在 trigger 元素上而非内部 img；:24-29 已不被消费的 canvasStore mock 顺手清理）

```tsx
describe('FileCard onApplyFile 场景感知（spec §二.6）', () => {
  it('未传 onApplyFile：不渲染"应用到画布"，但预览 Popover 仍可唤起', async () => {
    render(<FileCard file={mockFile} isFinePointer />);
    fireEvent.mouseEnter(screen.getByTestId('popover-trigger'));
    await waitFor(() => expect(screen.getByTestId('popover-content')).toBeInTheDocument()); // 预览保留
    expect(screen.queryByText('应用到画布')).not.toBeInTheDocument(); // 按钮不渲染
  });

  it('传 onApplyFile：按钮渲染且点击回调', async () => {
    const onApplyFile = vi.fn();
    render(<FileCard file={mockFile} isFinePointer onApplyFile={onApplyFile} />);
    fireEvent.mouseEnter(screen.getByTestId('popover-trigger'));
    await waitFor(() => expect(screen.getByText('应用到画布')).toBeInTheDocument());
    fireEvent.click(screen.getByText('应用到画布'));
    expect(onApplyFile).toHaveBeenCalledWith(mockFile);
  });
});
```

（`mockFile`/`fireEvent`/`render`/`screen` 复用该测试文件现有导入与 fixture；`popover-content` testid 加在 Popover mock 的 content 根 div 上。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd D:/flowweb/apps/web && npx vitest run src/components/MaterialLibrary/FileGrid/FileCard.test.tsx`
Expected: 新用例 FAIL——onApplyToCanvas 必填且按钮恒渲染

- [ ] **Step 3: 写实现**

FilePreviewPopover.tsx（:16-17）：

```ts
interface FilePreviewPopoverProps {
  file: MaterialFile;
  onApplyToCanvas?: (file: MaterialFile) => void;
}
```

:190 附近按钮区域改为条件渲染（保留其余预览结构不动）：

```tsx
          {onApplyToCanvas ? (
            <button onClick={handleApply} className="...">
              {loading ? '处理中...' : '应用到画布'}
            </button>
          ) : null}
```

（`handleApply` 即现有 :161-164 回调；按钮原有 className 原样保留。）

FileCard.tsx——props 加 `onApplyFile?: (f: MaterialFile) => void`，删除 `useCanvasStore` import（:4）与 `handleApplyToCanvas`（:36-40），Popover content 改：

```tsx
      content={
        <FilePreviewPopoverContent
          file={file}
          onApplyToCanvas={onApplyFile ? (f) => { setPopoverOpen(false); onApplyFile(f); } : undefined}
        />
      }
```

FileGrid.tsx——props 加 `onApplyFile?: (f: MaterialFile) => void`，FileCard 调用处透传 `onApplyFile={props.onApplyFile}`。

- [ ] **Step 4: 跑测试确认通过 + 既有 FileGrid/FileCard/FilePreviewPopover 回归**

Run: `cd D:/flowweb/apps/web && npx vitest run src/components/MaterialLibrary`
Expected: 全 PASS（Modal 未改前 FileGrid 不传 onApplyFile → 按钮 hidden；MaterialLibraryModal.test 若断言按钮存在，本任务先跳过该文件——Task 11 恢复）

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/MaterialLibrary/
git commit -m "feat(web): FileCard onApplyFile 可选透传——页面版隐藏应用按钮保留预览 Popover"
```

### Task 11: MaterialLibraryBrowser 提取 + Modal 改包装（enterContext）

**Files:**
- Create: `apps/web/src/components/MaterialLibrary/MaterialLibraryBrowser.tsx`
- Modify: `apps/web/src/components/MaterialLibrary/MaterialLibraryModal.tsx`（全文重写为薄包装）
- Test: `apps/web/src/components/MaterialLibrary/MaterialLibraryModal.test.tsx`（既有回归 + setup 适配）

- [ ] **Step 1: 写失败测试**（新建 `apps/web/src/components/MaterialLibrary/MaterialLibraryBrowser.test.tsx`）

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MaterialLibraryBrowser } from './MaterialLibraryBrowser';

vi.mock('antd', async () => {
  const actual = await vi.importActual<any>('antd');
  return { ...actual, App: { useApp: () => ({ modal: { confirm: vi.fn() } }) } };
});

const mockGet = vi.fn();
vi.mock('axios', () => ({
  default: { get: (...a: any[]) => mockGet(...a), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../../stores/canvasStore', () => ({}));

describe('MaterialLibraryBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
  });

  it('页面版（无 onApplyFile）：渲染素材容器，上传按钮在', () => {
    render(<MaterialLibraryBrowser title="我的素材库" />);
    expect(screen.getByText('选择文件')).toBeInTheDocument();
  });
});
```

（antd App.useApp mock 参照仓内 antd5 测试 workaround；jsdom 环境细节见记忆 antd5_testing_quirks。）

同时跑既有 Modal 测试确认改造后行为不变：

Run: `cd D:/flowweb/apps/web && npx vitest run src/components/MaterialLibrary/MaterialLibraryModal.test.tsx`
Expected: 改造前全 PASS（基线）

- [ ] **Step 2: 跑新测试确认失败**

Run: `cd D:/flowweb/apps/web && npx vitest run src/components/MaterialLibrary/MaterialLibraryBrowser.test.tsx`
Expected: FAIL——组件不存在

- [ ] **Step 3: 写实现**

`MaterialLibraryBrowser.tsx`（新建）——整体迁自 Modal 主体（原 :10-176：flattenFolders、全部 state/handler、容器 JSX、内嵌目标文件夹 Modal、键盘监听），差异点：

```tsx
import { useEffect, useState, useMemo } from 'react';
import { App, Modal, Select } from 'antd';
import { useMaterialLibraryStore } from '../../stores/materialLibraryStore';
import type { MaterialFolder, MaterialFile } from '@flowweb/shared';
import FolderTree from './FolderTree/FolderTree';
import FileGrid from './FileGrid/FileGrid';
import FileGridZoomControl from './FileGridZoomControl';
import './MaterialLibraryModal.css';

function flattenFolders(
  folders: MaterialFolder[],
  parentId: string | null = null,
  depth = 0,
): { value: string; label: string; depth: number }[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((f) => [
      { value: f.id, label: f.name, depth },
      ...flattenFolders(folders, f.id, depth + 1),
    ]);
}

export interface MaterialLibraryBrowserProps {
  title?: string;
  /** 画布内传入=现有行为（应用+关闭）；独立页不传 → 不渲染"应用到画布"（spec §二.6） */
  onApplyFile?: (file: MaterialFile) => void;
}

export function MaterialLibraryBrowser({ title = '我的素材库', onApplyFile }: MaterialLibraryBrowserProps) {
  // ……（原 Modal :25-90 的 store 订阅、folderSelector state、useEffect 键盘监听、
  //      handleBatchDelete/openFolderSelector/handleBatchMove 原样迁入，本组件不渲染外层 Modal）
  // 返回（原 :98-155 容器 JSX 原样，标题渲染在头部左侧）：
  return (
    <div className="material-library-container">
      <div className="material-library-sidebar">
        <FolderTree />
      </div>
      <div className="material-library-main">
        <div className="main-header">
          <span className="text-sm font-bold text-white mr-2">{title}</span>
          {/* 原 :104-151 批量/上传头原样 */}
          {/* …… */}
          <FileGridZoomControl />
        </div>
        <FileGrid onApplyFile={onApplyFile} />
      </div>
      {/* 原 :156-176 内嵌"选择目标文件夹"Modal 原样保留 */}
      {/* …… */}
    </div>
  );
}
```

（**迁移范围 = 现 MaterialLibraryModal.tsx :25-176 逐行搬运，排除清单（P1-1，写死）**：Task 9 改造后的 enterContext 加载 effect **不迁入 Browser**——加载职责已统一由 enterContext 驱动（Modal/页面各自定义），Browser 内再放加载 effect 会双发请求并触发 enterContext 重置竞争。Browser 只迁：store 订阅（isOpen/close/uploading/batchMode/selectedFileIds/selectedFolderId/folders）、folderSelector 本地态、键盘监听 effect、flattenFolders、handleBatchDelete/openFolderSelector/handleBatchMove、容器 JSX、内嵌「选择目标文件夹」Modal。三处变化：①外层 `<Modal title="我的素材库" ...>` 壳移除；②`<FileGrid />` 改 `<FileGrid onApplyFile={onApplyFile} />`；③头部加 `{title}` 显示。）

`MaterialLibraryModal.tsx` 全文重写为薄包装：

```tsx
import { useEffect } from 'react';
import { Modal } from 'antd';
import { useMaterialLibraryStore } from '../../stores/materialLibraryStore';
import { useCanvasStore } from '../../stores/canvasStore';
import { MaterialLibraryBrowser } from './MaterialLibraryBrowser';
import type { MaterialFile } from '@flowweb/shared';
import './MaterialLibraryModal.css';

export default function MaterialLibraryModal() {
  const isOpen = useMaterialLibraryStore((s) => s.isOpen);
  const close = useMaterialLibraryStore((s) => s.close);
  const enterContext = useMaterialLibraryStore((s) => s.enterContext);

  // 画布场景 enterContext（spec §二.3 调用时机①）：context 取 canvasStore
  useEffect(() => {
    if (isOpen) {
      const cs = useCanvasStore.getState();
      enterContext({ teamId: cs.teamId ?? undefined, projectId: cs.projectId ?? undefined });
    }
  }, [isOpen, enterContext]);

  const handleClose = () => {
    useMaterialLibraryStore.getState().exitBatchMode();
    close();
  };

  const handleApplyFile = (f: MaterialFile) => {
    useCanvasStore.getState().requestAddMediaNode(f);
    useMaterialLibraryStore.getState().close();
  };

  if (!isOpen) return null;

  return (
    <Modal title="我的素材库" open={isOpen} onCancel={handleClose} footer={null}
      width="90%" style={{ top: 50 }}
      className="material-library-modal">
      <MaterialLibraryBrowser title="我的素材库" onApplyFile={handleApplyFile} />
    </Modal>
  );
}
```

- [ ] **Step 4: 跑测试确认通过 + Modal 既有回归**

Run: `cd D:/flowweb/apps/web && npx vitest run src/components/MaterialLibrary`
Expected: 全 PASS。**MaterialLibraryModal.test.tsx 适配（P1-7，该文件是 automock + 手工 state，:6/18-43）**：
- state 对象补 `enterContext: vi.fn()`——否则 Modal 订阅 `s.enterContext` 得 undefined，effect 调用直接 TypeError
- 原「should load folders and files on open」用例（:43-47）：automock 下 enterContext 不会内部真调 loadFolders，**断言改为** `expect(state.enterContext).toHaveBeenCalled()` 且入参为 canvasStore 的 teamId/projectId；文件顶部补 `vi.mock('../../stores/canvasStore', () => ({ useCanvasStore: { getState: () => ({ teamId: 't-team', projectId: 'p1' }) } }))`
- 「我的素材库」标题断言（:41-42）随 title prop 传入 Browser 继续成立；Browser/`FolderTree`/`FileGrid` 的既有子组件 mock（:5-6）继续生效
- FileGrid mock 需接收 onApplyFile prop（mock 组件可忽略）

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/MaterialLibrary/
git commit -m "feat(web): MaterialLibraryBrowser 提取+Modal 薄包装 enterContext——画布行为不变"
```

### Task 12: /materials 页 + 路由 + Navbar 入口

**Files:**
- Create: `apps/web/src/pages/materials/MaterialsPage.tsx`
- Modify: `apps/web/src/router.tsx`（+1 路由）
- Modify: `apps/web/src/pages/home/components/Navbar.tsx:16-21`（navLinks +1）
- Test: `apps/web/src/pages/materials/MaterialsPage.test.tsx`（新建）

- [ ] **Step 1: 写失败测试**

```tsx
// apps/web/src/pages/materials/MaterialsPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MaterialsPage from './MaterialsPage';

const mockGetMyTeams = vi.fn();
vi.mock('@/api/teamApi', () => ({
  getMyTeams: (...a: any[]) => mockGetMyTeams(...a),
  teamDisplayName: (t: any) => t.name,
));
vi.mock('@/pages/home/components/Navbar', () => ({ Navbar: () => <div data-testid="navbar" /> }));
vi.mock('@/components/MaterialLibrary/MaterialLibraryBrowser', () => ({
  MaterialLibraryBrowser: (p: any) => <div data-testid="browser">{p.title}</div>,
}));
const mockGet = vi.fn();
vi.mock('axios', () => ({
  default: { get: (...a: any[]) => mockGet(...a), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const team = (id: string, isOwner: boolean) => ({ id, name: id, isOwner, isDefault: false, memberCount: 1 });
const renderPage = (url = '/materials') =>
  render(<MemoryRouter initialEntries={[url]}><MaterialsPage /></MemoryRouter>);

describe('MaterialsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
  });

  it('个人素材 tab（默认）：渲染 Browser，无团队页签', async () => {
    mockGetMyTeams.mockResolvedValue([team('t1', true)]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('browser')).toBeInTheDocument());
    expect(screen.queryByTestId('team-tabs-row')).not.toBeInTheDocument();
  });

  it('团队 tab：渲染团队页签 + Browser（key 重挂载）；非法 teamId replace 回落', async () => {
    mockGetMyTeams.mockResolvedValue([team('t1', true)]);
    renderPage('/materials?tab=team&teamId=bogus');
    await waitFor(() => expect(screen.getByTestId('team-tabs-row')).toBeInTheDocument());
    expect(window.location.search).toContain('teamId=t1');
    expect(await screen.findByTestId('browser')).toBeInTheDocument();
  });

  it('无真实团队：空态引导', async () => {
    mockGetMyTeams.mockResolvedValue([{ id: 'd', name: '默认', isOwner: true, isDefault: true, memberCount: 1 }]);
    renderPage('/materials?tab=team');
    await waitFor(() => expect(screen.getByTestId('materials-empty-state')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd D:/flowweb/apps/web && npx vitest run src/pages/materials/MaterialsPage.test.tsx`
Expected: FAIL——页面不存在

- [ ] **Step 3: 写实现**

```tsx
// apps/web/src/pages/materials/MaterialsPage.tsx
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Tabs } from 'antd';
import { Navbar } from '@/pages/home/components/Navbar';
import { teamDisplayName } from '@/api/teamApi';
import { useTeams } from '@/pages/workspace/hooks/useTeams';
import { WorkspaceTabBar } from '@/pages/workspace/components/WorkspaceTabBar';
import { MaterialLibraryBrowser } from '@/components/MaterialLibrary/MaterialLibraryBrowser';
import { useMaterialLibraryStore } from '@/stores/materialLibraryStore';

/** 独立素材库页（spec §二）：个人=默认团队③级回落，团队=②级 dto.teamId */
export default function MaterialsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: 'personal' | 'team' = searchParams.get('tab') === 'team' ? 'team' : 'personal';
  const urlTeamId = searchParams.get('teamId');
  const { state, realTeams, retry } = useTeams();
  const enterContext = useMaterialLibraryStore((s) => s.enterContext);

  const setTab = (t: 'personal' | 'team') => {
    setSearchParams(t === 'team' ? { tab: 'team' } : {}, { replace: true });
  };
  const setTeamId = (id: string) => setSearchParams({ tab: 'team', teamId: id }, { replace: true });

  const validTeamId = urlTeamId && realTeams.some((t) => t.id === urlTeamId) ? urlTeamId : null;

  // 直链 teamId 回落三分支（同 works，spec §一.2；素材页 folder 不进 URL 无 folder 残留问题）
  useEffect(() => {
    if (tab !== 'team' || state.status !== 'success' || realTeams.length === 0) return;
    if (!validTeamId) {
      setSearchParams({ tab: 'team', teamId: realTeams[0].id }, { replace: true });
    }
  }, [tab, state.status, validTeamId, realTeams, setSearchParams]);

  // enterContext 调用时机②③④（spec §二.3）：页面挂载/切 tab/切团队
  useEffect(() => {
    if (tab === 'personal') enterContext({});
  }, [tab, enterContext]);
  useEffect(() => {
    if (tab === 'team' && validTeamId) enterContext({ teamId: validTeamId });
  }, [tab, validTeamId, enterContext]);

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />
      <div className="mx-auto max-w-[1640px] pt-4">
        {/* 一级 tab：复用 works 的 WorkspaceTabBar（labels prop 定制文案，消重复） */}
        <WorkspaceTabBar
          activeTab={tab}
          onTabChange={setTab}
          labels={{ personal: '个人素材', team: '团队素材' }}
        />
        {tab === 'team' ? (
          state.status === 'loading' ? (
            <p className="text-sm text-[#888] px-8 pt-4">加载中…</p>
          ) : state.status === 'error' ? (
            <div className="flex flex-col items-center py-20 gap-3" data-testid="teams-error">
              <p className="text-sm text-[#888]">团队列表加载失败</p>
              <Button onClick={() => retry()}>重试</Button>
            </div>
          ) : realTeams.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3" data-testid="materials-empty-state">
              <p className="text-sm text-[#888]">还没有团队，创建一个开始协作吧</p>
              <Button type="primary" onClick={() => navigate('/team')}>前往创建团队</Button>
            </div>
          ) : validTeamId ? (
            <>
              <div className="px-8" data-testid="team-tabs-row">
                <Tabs
                  activeKey={validTeamId}
                  onChange={setTeamId}
                  items={realTeams.map((t) => ({ key: t.id, label: teamDisplayName(t) }))}
                />
              </div>
              <div className="px-8 pb-10">
                <MaterialLibraryBrowser key={validTeamId} />
              </div>
            </>
          ) : (
            <p className="text-sm text-[#888] px-8 pt-4">加载中…</p>
          )
        ) : (
          <div className="px-8 pb-10">
            <MaterialLibraryBrowser key="personal" />
          </div>
        )}
      </div>
    </div>
  );
}
```

`router.tsx`——import 区加 `import MaterialsPage from '@/pages/materials/MaterialsPage';`，RequireAuth children 中 `/works` 前加：

```tsx
      { path: '/materials', element: <MaterialsPage /> },
```

`Navbar.tsx:16-21` navLinks 加：

```ts
  { label: '素材库', href: '/materials' },
```

（置于「工作空间」之后。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd D:/flowweb/apps/web && npx vitest run src/pages/materials`
Expected: PASS（3 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/materials/ apps/web/src/router.tsx apps/web/src/pages/home/components/Navbar.tsx
git commit -m "feat(web): /materials 独立素材库页——个人③级/团队②级 presign 通道+Navbar 入口"
```

---

## 批 5 · 删除与兜底

### Task 13: FileUpload 删除 + 残留清理 + 全量验证

**Files:**
- Delete: `apps/web/src/components/FileUpload.tsx`
- Delete: `apps/web/src/components/FileUpload.test.tsx`
- Modify: `apps/web/src/utils/splitUploadService.ts:72`（注释清理）
- Test: 兜底验证命令（无新测试文件）

- [ ] **Step 1: 写"失败测试"**（此处为兜底断言——删除前先记录引用基线）

Run: `grep -rn "FileUpload" D:/flowweb/apps/web/src --include="*.ts" --include="*.tsx" | grep -v "splitUploadService"`
Expected: 仅 `FileUpload.tsx` 自身与 `FileUpload.test.tsx`（若出现其他引用则停下评估，spec §三判定仅测试引用）

- [ ] **Step 2: 执行删除 + 注释清理**

```bash
git rm apps/web/src/components/FileUpload.tsx apps/web/src/components/FileUpload.test.tsx
```

`splitUploadService.ts:72` 注释改为：

```ts
  // Rewrite presigned URL through Vite proxy in dev (pattern shared with materialLibraryStore upload)
```

- [ ] **Step 3: 验证 tsc + grep 兜底**

Run: `cd D:/flowweb/apps/web && npx tsc -b`
Expected: 0 error

Run: `grep -rn "FileUpload" D:/flowweb/apps/web/src --include="*.ts" --include="*.tsx"`
Expected: 仅 `splitUploadService.ts` 注释一行（已改写，不再指向已删文件）或零命中

- [ ] **Step 4: 全量测试**

Run: `cd D:/flowweb/apps/web && npx vitest run`
Expected: 全 PASS

Run: `cd D:/flowweb/apps/api && pnpm test`
Expected: tsc + vitest 全 PASS

- [ ] **Step 5: 提交**

```bash
git add -A apps/web/src/
git commit -m "chore(web): 删除无生产挂载的 FileUpload 组件与测试，清理悬空注释"
```

---

## 手动回归（DoD，实现完成后浏览器验收）

按 spec 测试策略，用 preview 工具（dev server 已在 5173/3000 运行）逐条验证：

1. **四种直链**：`/works`（根目录 1 请求）、`/works?folder=有效`（直打 1 请求）、`/works?folder=无效`（fallback 回根 + message.info）、`/works?tab=team&teamId=非法`（replace 第一个团队、无 folder）
2. **团队页签 A→B 快速切换**：终态为 B 数据（Network 面板无串台）
3. **上传中切团队**：文件落快照团队、当前视图不闪旧数据（/materials 页）
4. **画布内 Modal**：「应用到画布」按钮在且行为不变（创建媒体节点）；素材归属画布项目团队（①级）
5. **/works?tab=team 功能对齐**：新建画布（预填名带团队序号、落当前文件夹）、新建文件夹、文件夹重命名/删除（不再 404）、搜索/筛选/视图切换/加载更多
6. **/materials**：个人 tab 上传走③级（Network presign 无 teamId/projectId）、团队 tab 上传走②级（presign 带 teamId）、页面无「应用到画布」按钮但 hover 预览可用

## 完成定义（DoD）

- `cd D:/flowweb/apps/web && npx tsc -b` 0 error；`cd D:/flowweb/apps/api && npx tsc -p tsconfig.spec.json --noEmit` 0 error
- 全部新增测试先红后绿（执行时逐任务验证）
- 手动回归 6 条全过
- grep 断言：`FileUpload`、`TeamSection`、materialLibraryStore 内 `useCanvasStore` 生产引用零残留
