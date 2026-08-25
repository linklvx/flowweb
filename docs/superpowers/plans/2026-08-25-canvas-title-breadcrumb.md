# Canvas 标题栏面包屑改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Canvas 左上角悬浮按钮——Flow123 白色可点击返回工作空间、分隔符后显示文件夹完整层级路径、编辑框边框绿色改深灰。

**Architecture:** 新增子资源接口 `GET /api/projects/:id/folder`（属主校验，返回 folderId）；前端画布页请求该接口 + `/api/folders`，沿 parentId 拼路径传给 ProjectTitle 纯展示。spec 见 `docs/superpowers/specs/canvas-title-breadcrumb.md`。

**Tech Stack:** NestJS + Prisma（@flowweb/api）、React 19 + react-router v7 + Tailwind + vitest（@flowweb/web）。

**关键背景（执行者必读）：**
- 全局 TransformInterceptor 自动把 controller 返回值包装为 `{ code: 0, data, message }`；前端 `apiFetch`（apps/web/src/api/client.ts）校验 `code === 0` 并返回 `json.data`。
- 鉴权：全局 AuthGuard（app.module.ts APP_GUARD）按 `PUBLIC_PREFIXES` 前缀白名单放行，`/api/projects` 不在白名单。**新接口不加任何公开放行**（项目无 @Public 装饰器；与现有 `GET /api/projects/:id` 一致）。未登录 401 → 前端 apiFetch throw → catch 回退主目录/。
- service 的 `if (!userId) return { folderId: null }` 是正确性必需（非防御）：Prisma 忽略 where 中 undefined 条件，不提前返回会退化为不按属主过滤导致越权。
- `Template.projectId` 有 `@unique`（prisma/schema.prisma:117），`findUnique` 安全。
- `CanvasProject.userId` 可空（草稿画布 null）——属主匹配自然排除草稿。
- 测试命令：`pnpm --filter @flowweb/api test`、`pnpm --filter @flowweb/web test`。
- git 提交信息用中文 conventional 风格（参照 git log），结尾加 `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `apps/api/src/modules/project/project.service.ts` | 修改 | 新增 `getProjectFolder(id, userId)`：属主校验 + 查 template.folderId |
| `apps/api/src/modules/project/project.controller.ts` | 修改 | 新增 `GET :id/folder` 路由（放 `getProject` 之后） |
| `apps/api/src/modules/project/project.service.spec.ts` | 修改 | getProjectFolder 4 个用例 |
| `apps/api/src/modules/project/project.controller.spec.ts` | 修改 | 路由委托 2 个用例 |
| `apps/web/src/pages/canvas/components/ProjectTitle.tsx` | 修改 | Link 返回 /works、folderPath 前缀、边框 #555、导出 ROOT_FOLDER_NAME |
| `apps/web/src/pages/canvas/components/ProjectTitle.test.tsx` | 修改 | MemoryRouter helper + 新用例 + 现有用例适配 |
| `apps/web/src/api/canvasApi.ts` | 修改 | 新增 `getProjectFolder` |
| `apps/web/src/pages/canvas/page.tsx` | 修改 | CanvasPageInner 加 folderPath state + effect，传 prop |
| `apps/web/src/pages/canvas/page.test.tsx` | 修改 | 面包屑集成用例（URL 分发 mock） |

---

### Task 1: 后端 `GET /api/projects/:id/folder`

**Files:**
- Modify: `apps/api/src/modules/project/project.service.ts`
- Modify: `apps/api/src/modules/project/project.controller.ts`
- Test: `apps/api/src/modules/project/project.service.spec.ts`
- Test: `apps/api/src/modules/project/project.controller.spec.ts`

- [ ] **Step 1: 写 service 失败测试**

在 `project.service.spec.ts` 的 `beforeEach` prisma mock 中补充两个方法（加到 `canvasProject` 与新增 `template` 键）：

```ts
      canvasProject: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),          // 新增
        update: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      template: {                     // 新增
        findUnique: vi.fn(),
      },
```

在文件末尾 `cleanDrafts` describe 之后、顶层 describe 结束前加：

```ts
  describe('getProjectFolder', () => {
    it('属主项目返回 template 的 folderId', async () => {
      prisma.canvasProject.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.template.findUnique.mockResolvedValue({ folderId: 'f1' });

      const result = await service.getProjectFolder('p1', 'u1');

      expect(prisma.canvasProject.findFirst).toHaveBeenCalledWith({
        where: { id: 'p1', userId: 'u1' },
        select: { id: true },
      });
      expect(result).toEqual({ folderId: 'f1' });
    });

    it('非属主项目返回 null 且不查 template（不暴露存在性）', async () => {
      prisma.canvasProject.findFirst.mockResolvedValue(null);

      const result = await service.getProjectFolder('p1', 'other-user');

      expect(result).toEqual({ folderId: null });
      expect(prisma.template.findUnique).not.toHaveBeenCalled();
    });

    it('未登录（userId 空）直接返回 null 且不查库', async () => {
      const result = await service.getProjectFolder('p1', undefined);

      expect(result).toEqual({ folderId: null });
      expect(prisma.canvasProject.findFirst).not.toHaveBeenCalled();
    });

    it('无 template 记录返回 null', async () => {
      prisma.canvasProject.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.template.findUnique.mockResolvedValue(null);

      const result = await service.getProjectFolder('p1', 'u1');

      expect(result).toEqual({ folderId: null });
    });
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/project/project.service.spec.ts`
Expected: FAIL — `service.getProjectFolder is not a function`

- [ ] **Step 3: 实现 service 方法**

`project.service.ts` 在 `findById` 方法之后加：

```ts
  /** 画布所属文件夹 id；属主不匹配/未登录/无关联时返回 null（不暴露项目存在性） */
  async getProjectFolder(id: string, userId?: string) {
    if (!userId) return { folderId: null };
    const project = await this.prisma.canvasProject.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!project) return { folderId: null };
    const template = await this.prisma.template.findUnique({
      where: { projectId: id },
      select: { folderId: true },
    });
    return { folderId: template?.folderId ?? null };
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/project/project.service.spec.ts`
Expected: PASS（全部用例含既有）

- [ ] **Step 5: 写 controller 失败测试**

`project.controller.spec.ts` 的 beforeEach service mock 补充方法：

```ts
      getProjectFolder: vi.fn().mockResolvedValue({ folderId: null }),
```

在 `GET /api/projects/:id` 用例后加：

```ts
  it('GET /api/projects/:id/folder 登录时透传 userId', async () => {
    await controller.getProjectFolder('p1', { user: { id: 'u1' } } as any);
    expect(service.getProjectFolder).toHaveBeenCalledWith('p1', 'u1');
  });

  it('GET /api/projects/:id/folder 未登录时透传 undefined', async () => {
    await controller.getProjectFolder('p1', {} as any);
    expect(service.getProjectFolder).toHaveBeenCalledWith('p1', undefined);
  });
```

- [ ] **Step 6: 运行确认失败**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/project/project.controller.spec.ts`
Expected: FAIL — `controller.getProjectFolder is not a function`

- [ ] **Step 7: 实现 controller 路由**

`project.controller.ts` 在 `getProject` 之后加（`Req`、`Request` 已在文件头 import）：

```ts
  @Get(':id/folder')
  getProjectFolder(@Param('id') id: string, @Req() req: Request) {
    const userId = (req as any).user?.id;
    return this.projectService.getProjectFolder(id, userId);
  }
```

- [ ] **Step 8: 运行确认通过**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/project`
Expected: PASS（service + controller 全部）

- [ ] **Step 9: 提交**

```bash
git add apps/api/src/modules/project/project.service.ts apps/api/src/modules/project/project.controller.ts apps/api/src/modules/project/project.service.spec.ts apps/api/src/modules/project/project.controller.spec.ts
git commit -m "feat(api): GET /api/projects/:id/folder 返回画布所属 folderId——属主校验，非属主/未登录返回 null

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: ProjectTitle 组件 UI 三项变更

**Files:**
- Modify: `apps/web/src/pages/canvas/components/ProjectTitle.tsx`
- Test: `apps/web/src/pages/canvas/components/ProjectTitle.test.tsx`

**注意：** Link 需要 Router 上下文，现有 5 个用例的裸 `render` 会崩，Step 1 一并改造为 `renderTitle` helper。

- [ ] **Step 1: 改造测试文件（现有用例适配 + 新用例，全量失败）**

`ProjectTitle.test.tsx` 顶部 import 增加：

```ts
import { MemoryRouter } from 'react-router';
```

import 之后加 helper 与 Props 类型引用（类型从组件文件导出前直接内联声明参数类型）：

```ts
import { ProjectTitle, ROOT_FOLDER_NAME } from './ProjectTitle';

function renderTitle(props: { folderPath?: string[]; projectName?: string } = {}) {
  return render(
    <MemoryRouter>
      <ProjectTitle projectId="p1" projectName={props.projectName ?? '未命名项目'} folderPath={props.folderPath} />
    </MemoryRouter>,
  );
}
```

（同时删除原有 `import { ProjectTitle } from './ProjectTitle';` 行，由上面合并 import 替代。）

现有 5 个用例把 `render(<ProjectTitle projectId="p1" projectName="未命名项目" />)` 全部替换为 `renderTitle()`。

文件末尾 `describe` 内追加新用例：

```ts
  it('Flow123 为返回工作空间的白色链接', () => {
    renderTitle();
    const link = screen.getByRole('link', { name: /Flow123/ });
    expect(link).toHaveAttribute('href', '/works');
    expect(link.className).toContain('text-white');
  });

  it('folderPath 为空显示 主目录/ 前缀', () => {
    renderTitle({ folderPath: [] });
    expect(screen.getByText(`${ROOT_FOLDER_NAME}/`)).toBeInTheDocument();
  });

  it('folderPath 嵌套层级以 / 连接显示', () => {
    renderTitle({ folderPath: ['设计稿', '子文件夹'] });
    expect(screen.getByText('设计稿/子文件夹/')).toBeInTheDocument();
  });

  it('编辑态保留路径前缀，输入框仅含画布名', () => {
    renderTitle({ folderPath: ['设计稿'] });
    fireEvent.click(screen.getByText('未命名项目'));
    expect(screen.getByText('设计稿/')).toBeInTheDocument();
    expect(screen.getByDisplayValue('未命名项目')).toBeInTheDocument();
  });

  it('路径前缀带 truncate 与 max-w 限制', () => {
    renderTitle({ folderPath: ['设计稿'] });
    const prefix = screen.getByText('设计稿/');
    expect(prefix.className).toContain('truncate');
    expect(prefix.className).toContain('max-w-[200px]');
  });

  it('编辑输入框边框为深灰 #555 且最小宽 120px', () => {
    renderTitle();
    fireEvent.click(screen.getByText('未命名项目'));
    const input = screen.getByDisplayValue('未命名项目');
    expect(input.className).toContain('border-[#555]');
    expect(input.className).not.toContain('border-[#4ade80]');
    expect(input.className).toContain('min-w-[120px]');
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @flowweb/web exec vitest run src/pages/canvas/components/ProjectTitle.test.tsx`
Expected: FAIL — 新用例失败（`ROOT_FOLDER_NAME` 未导出、无 Link、无前缀、边框仍绿色）；现有用例若因无 Router 报错也属预期失败

- [ ] **Step 3: 实现组件变更**

`ProjectTitle.tsx` 完整改动：

import 行改为：

```ts
import { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router';

export const ROOT_FOLDER_NAME = '主目录';

interface Props {
  projectId: string;
  projectName: string;
  folderPath?: string[];
  onNameChange?: (name: string) => void;
}
```

组件签名与 prefix 计算：

```ts
export function ProjectTitle({ projectId, projectName: initialName, folderPath = [], onNameChange }: Props) {
```

（state 与逻辑保持不变，在 return 前加：）

```ts
  const prefix = folderPath.length > 0 ? `${folderPath.join('/')}/` : `${ROOT_FOLDER_NAME}/`;
```

JSX 中替换三处：

Flow123（原绿色 span）：

```tsx
      <Link
        to="/works"
        title="返回工作空间"
        className="text-white font-bold text-sm select-none hover:opacity-80 transition-opacity"
      >
        💦 Flow123
      </Link>
```

分隔符后新增前缀 span（放在 `<span className="text-[#555] select-none">/</span>` 与 editing 三元之间）：

```tsx
      <span className="text-[#888] select-none max-w-[200px] truncate" title={prefix}>
        {prefix}
      </span>
```

编辑态 input 的 className 替换（绿色→深灰，80→120）：

```tsx
          className="bg-[#252525] border border-[#555] rounded px-1.5 py-0.5 text-xs text-[#e2e8f0] outline-none min-w-[120px]"
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @flowweb/web exec vitest run src/pages/canvas/components/ProjectTitle.test.tsx`
Expected: PASS（新 6 用例 + 现有 5 用例全绿）

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/canvas/components/ProjectTitle.tsx apps/web/src/pages/canvas/components/ProjectTitle.test.tsx
git commit -m "feat(web): ProjectTitle 面包屑——Flow123 白色 Link 返回工作空间、文件夹路径前缀、编辑框深灰边框

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: 画布页数据流（canvasApi + page.tsx）

**Files:**
- Modify: `apps/web/src/api/canvasApi.ts`
- Modify: `apps/web/src/pages/canvas/page.tsx`
- Test: `apps/web/src/pages/canvas/page.test.tsx`

**现有测试兼容性说明：** page.test.tsx 的 beforeEach 默认 `mockResolvedValue` 返回 `{ code: 0, data: { id: 'test-pid-123', ..., name: '我的画布' } }`。folder 请求消费该默认响应时 `data.folderId === undefined`（falsy）→ 直接回退主目录、不发 `/api/folders` 请求，现有用例断言均不涉及标题栏前缀，不受影响。

- [ ] **Step 1: 写页面集成失败测试**

`page.test.tsx` 文件末尾（顶层 describe 内）追加：

```ts
  describe('folderPath 面包屑', () => {
    const projectResponse = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 0, data: { id: 'p1', name: '我的画布', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }),
    };

    function mockByUrl({ folder, folders }: { folder?: { folderId: string | null }; folders?: { id: string; name: string; parentId: string | null }[] } = {}) {
      mockFetch.mockImplementation((url: string) => {
        // 注意用 endsWith：'/api/folders'.includes('/folder') 为 true，会误拦截
        if (url.endsWith('/folder')) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ code: 0, data: folder ?? { folderId: null } }) });
        }
        if (url === '/api/folders') {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ code: 0, data: { folders: folders ?? [] } }) });
        }
        return Promise.resolve(projectResponse);
      });
    }

    it('folderId 非空：请求 folders 并渲染嵌套层级路径', async () => {
      mockByUrl({
        folder: { folderId: 'f2' },
        folders: [
          { id: 'f1', name: '设计稿', parentId: null },
          { id: 'f2', name: '子文件夹', parentId: 'f1' },
        ],
      });
      render(<MemoryRouter initialEntries={['/canvas?projectId=p1']}><CanvasPage /></MemoryRouter>);

      expect(await screen.findByText('设计稿/子文件夹/')).toBeInTheDocument();
      expect(mockFetch.mock.calls.some((c: any[]) => c[0] === '/api/folders')).toBe(true);
    });

    it('folderId 为空：显示 主目录/ 且不请求 /api/folders', async () => {
      mockByUrl({ folder: { folderId: null } });
      render(<MemoryRouter initialEntries={['/canvas?projectId=p1']}><CanvasPage /></MemoryRouter>);

      expect(await screen.findByText('主目录/')).toBeInTheDocument();
      expect(mockFetch.mock.calls.every((c: any[]) => c[0] !== '/api/folders')).toBe(true);
    });

    it('folderId 指向的文件夹已删除（不在列表）：回退主目录', async () => {
      mockByUrl({ folder: { folderId: 'ghost' }, folders: [{ id: 'f1', name: '设计稿', parentId: null }] });
      render(<MemoryRouter initialEntries={['/canvas?projectId=p1']}><CanvasPage /></MemoryRouter>);

      expect(await screen.findByText('主目录/')).toBeInTheDocument();
    });

    it('StrictMode 下迟到的 folder 响应不覆盖新一轮结果', async () => {
      let resolveStale!: (v: any) => void;
      let firstFolderCall = true;
      const foldersData = [
        { id: 'f1', name: '设计稿', parentId: null },
        { id: 'f2', name: '子文件夹', parentId: 'f1' },
      ];
      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/folder') && firstFolderCall) {
          firstFolderCall = false;
          return new Promise((r) => { resolveStale = r; }); // 第一轮：慢，将被取消
        }
        if (url.endsWith('/folder')) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ code: 0, data: { folderId: 'f2' } }) });
        }
        if (url === '/api/folders') {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ code: 0, data: { folders: foldersData } }) });
        }
        return Promise.resolve(projectResponse);
      });

      render(
        <MemoryRouter initialEntries={['/canvas?projectId=p1']}>
          <React.StrictMode><CanvasPage /></React.StrictMode>
        </MemoryRouter>,
      );

      // 第二轮（有效）完成 → 嵌套路径渲染
      expect(await screen.findByText('设计稿/子文件夹/')).toBeInTheDocument();

      // 第一轮（已取消）迟到返回 folderId 指向 f1 链 —— 若实现未做 cancelled 守卫，前缀会被覆盖为 设计稿/
      resolveStale({ ok: true, status: 200, json: () => Promise.resolve({ code: 0, data: { folderId: 'f1' } }) });
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.getByText('设计稿/子文件夹/')).toBeInTheDocument();
    });
  });
```

（`React` 已在文件头 import，`MemoryRouter` 已 import。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @flowweb/web exec vitest run src/pages/canvas/page.test.tsx`
Expected: FAIL — 3 个路径用例找不到 `主目录/` 或 `设计稿/子文件夹/` 文本；竞态用例在迟到 resolve 后前缀被覆盖（或直接因前缀缺失失败）

- [ ] **Step 3: 实现 canvasApi.getProjectFolder**

`canvasApi.ts` 末尾追加：

```ts
export function getProjectFolder(projectId: string) {
  return apiFetch<{ folderId: string | null }>(`/projects/${projectId}/folder`);
}
```

- [ ] **Step 4: 实现 page.tsx 数据流**

`page.tsx` 顶部 import 增加：

```ts
import { apiFetch } from '@/api/client';
```

原有 `import { createCanvas } from '@/api/canvasApi';` 改为：

```ts
import { createCanvas, getProjectFolder } from '@/api/canvasApi';
```

`CanvasPageInner` 组件内（`const [isShortcutsOpen, setShortcutsOpen] = useState(false);` 之前）加 state 与 effect：

```ts
  // 标题栏面包屑：folderId → folders 平铺列表沿 parentId 拼「顶层→直接父级」链；任何失败回退主目录
  const [folderPath, setFolderPath] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    getProjectFolder(projectId)
      .then(async ({ folderId }) => {
        if (cancelled || !folderId) return;
        const data = await apiFetch<{ folders: { id: string; name: string; parentId: string | null }[] }>('/folders');
        if (cancelled) return;
        const chain: string[] = [];
        let cur = data.folders.find((f) => f.id === folderId);
        let depth = 0;
        while (cur && depth < 10) { // 上限防脏数据循环引用死循环
          chain.unshift(cur.name);
          cur = cur.parentId ? data.folders.find((f) => f.id === cur!.parentId) : undefined;
          depth++;
        }
        setFolderPath(chain);
      })
      .catch(() => {
        // 未登录/网络失败/接口异常 → 保持主目录
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
```

`<ProjectTitle ... />` 渲染行加 prop：

```tsx
        <ProjectTitle projectId={projectId} projectName={projectName} folderPath={folderPath} onNameChange={onNameChange} />
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @flowweb/web exec vitest run src/pages/canvas/page.test.tsx`
Expected: PASS（新 4 用例 + 现有全部用例）

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/api/canvasApi.ts apps/web/src/pages/canvas/page.tsx apps/web/src/pages/canvas/page.test.tsx
git commit -m "feat(web): 画布页加载文件夹路径——folder 接口+folders 列表拼链，cancelled 守卫防过期覆盖

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: 全量回归与浏览器验收

**Files:** 无新改动（本任务只验证；若验收发现问题，修复后补提交）

- [ ] **Step 1: 前后端全量测试**

Run: `pnpm --filter @flowweb/api test && pnpm --filter @flowweb/web test`
Expected: 全部 PASS（api 含 tsc --noEmit 类型检查）

- [ ] **Step 2: 浏览器验收**

按项目启动流程启动服务，验收清单：

1. 打开根目录画布 → 标题栏显示 `💦 Flow123 / 主目录/画布名`，Flow123 为白色
2. 打开文件夹内画布（含嵌套文件夹）→ 显示 `💦 Flow123 / 文件夹A/子文件夹B/画布名`
3. 点击 Flow123 → 返回工作空间 `/works`
4. 点击画布名进入编辑 → 输入框边框深灰、路径前缀保留；Enter 保存后路径不变
5. 未登录/异常场景（可选）→ 标题栏回退 `主目录/`

- [ ] **Step 3: 验收问题修复（如有）**

发现问题 → 修复 → 重跑 Step 1 → 单独提交修复。

---

## 自查记录（Self-Review）

1. **Spec 覆盖**：spec §3 后端接口（Task 1）、§4 前端数据流与组件（Task 2/3）、§5 测试策略全部用例（Task 1 四例 / Task 2 六例 / Task 3 四例一一对应）、竞态防护（Task 3 用例 4）✓
2. **占位符扫描**：无 TBD/TODO，所有代码步骤含完整代码 ✓
3. **类型一致性**：`getProjectFolder(id: string, userId?: string)` 前后端一致；`folderPath?: string[]` 组件/页面一致；`ROOT_FOLDER_NAME` 导出与引用一致 ✓
