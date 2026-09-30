// apps/web/src/utils/loginRedirect.spec.ts
// 批2-3（v5.10 前移自批 6）：登录跳转收口——loginUrl / resolvePostLoginTarget 单一真相源。
// 判据：①resolvePostLoginTarget 17 条矩阵（白名单前缀透传；外链/协议相对/非白名单/异常回落 /works——防 open redirect）
//       ②loginUrl 无参默认回跳当前地址、带参对应编码
//       ③静态断言：五处裸跳转文件零硬编码 '/login'/'/canvas' 字面量跳转（消费统一走本模块）
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loginUrl, resolvePostLoginTarget } from './loginRedirect';

describe('resolvePostLoginTarget 17 条矩阵', () => {
  const cases: Array<[string | null, string]> = [
    // 空/缺参 → 兜底
    [null, '/works'],
    ['', '/works'],
    // 白名单前缀内 → 透传（含 query）
    ['/canvas', '/canvas'],
    ['/canvas?projectId=x', '/canvas?projectId=x'],
    ['/works', '/works'],
    ['/works/folder-1', '/works/folder-1'],
    ['/team', '/team'],
    ['/team/billing', '/team/billing'],
    ['/materials', '/materials'],
    ['/templates', '/templates'],
    ['/settings/profile', '/settings/profile'],
    ['/join?code=x', '/join?code=x'],
    ['/videos', '/videos'],
    ['/videos/v1?tab=2', '/videos/v1?tab=2'],
    // 外链/协议相对/非白名单（/admin 非 admin 视角）/异常协议 → /works
    ['https://evil.com', '/works'],
    ['//evil.com', '/works'],
    ['/admin', '/works'],
    ['/foo', '/works'],
    ['javascript:alert(1)', '/works'],
  ];

  it.each(cases)('%p → %s', (input, expected) => {
    expect(resolvePostLoginTarget(input)).toBe(expected);
  });

  it('矩阵计数钉 19（防静默删行；批2 评审补 /videos）', () => {
    expect(cases).toHaveLength(19);
  });
});

describe('loginUrl', () => {
  it('无参：next 默认当前地址（pathname+search，编码）', () => {
    expect(loginUrl()).toBe(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
  });

  it('带参：returnTo 对应编码', () => {
    expect(loginUrl('/canvas?projectId=x')).toBe(`/login?next=${encodeURIComponent('/canvas?projectId=x')}`);
  });
});

describe('五处裸跳转收编（静态断言——现场形态 location.href= / to= / navigate()）', () => {
  const srcRoot = resolve(import.meta.dirname, '..');
  const FIVE_FILES = [
    'pages/login/page.tsx',
    'pages/register/page.tsx',
    'components/RequireAuth.tsx',
    'components/RequireAdmin.tsx',
    'pages/canvas/components/CanvasTopBar.tsx',
  ];
  const read = (p: string) => readFileSync(resolve(srcRoot, p), 'utf8');

  it('五文件零 location.href/navigate 硬编码 /login|/canvas 整页跳转', () => {
    for (const f of FIVE_FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/location\.href\s*=\s*['"]\/(?:login|canvas)['"]/);
      expect(src, f).not.toMatch(/navigate\(\s*['"]\/(?:login|canvas)['"]/);
    }
  });

  it('守卫/顶栏三文件零 to="/login" 字面量（路由目标统一 loginUrl()）', () => {
    for (const f of ['components/RequireAuth.tsx', 'components/RequireAdmin.tsx', 'pages/canvas/components/CanvasTopBar.tsx']) {
      expect(read(f), f).not.toMatch(/to=\{?["']\/login["']/);
    }
  });
});
