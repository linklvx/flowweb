import { describe, it, expect, vi } from 'vitest';

// 页面 lazy 依赖真实模块，全部 mock 成空组件
// （vi.mock 会被 hoist 到顶层，for 循环变量不可用，故显式逐条声明）
vi.mock('@/pages/admin/AdminLayout', () => ({ default: () => <div>layout</div> }));
vi.mock('@/pages/admin/pages/ModelsPage', () => ({ default: () => <div>ModelsPage</div> }));
vi.mock('@/pages/admin/pages/PlansPage', () => ({ default: () => <div>PlansPage</div> }));
vi.mock('@/pages/admin/pages/SubscriptionsPage', () => ({ default: () => <div>SubscriptionsPage</div> }));
vi.mock('@/pages/admin/pages/CreditsPage', () => ({ default: () => <div>CreditsPage</div> }));
vi.mock('@/pages/admin/pages/SubscriptionBannerPage', () => ({ default: () => <div>SubscriptionBannerPage</div> }));
vi.mock('@/pages/admin/pages/AnnouncementPage', () => ({ default: () => <div>AnnouncementPage</div> }));
vi.mock('@/pages/admin/pages/HomeBannersPage', () => ({ default: () => <div>HomeBannersPage</div> }));
vi.mock('@/pages/admin/pages/SettingsPage', () => ({ default: () => <div>SettingsPage</div> }));
vi.mock('@/pages/admin/pages/StyleCategoriesPage', () => ({ default: () => <div>StyleCategoriesPage</div> }));
vi.mock('@/pages/admin/pages/StyleContentPage', () => ({ default: () => <div>StyleContentPage</div> }));

import { router } from './router';
// 风险备注：import router 会静态连带加载全部真实页面。若 jsdom 下因无关页面顶层副作用报错，
// 需将 router.tsx 中其余静态页面 import 一并 vi.mock 掉（本测试只断言路由树结构）

function flatten(routes: any[]): any[] {
  return routes.flatMap((r) => [r, ...(r.children ? flatten(r.children) : [])]);
}

describe('admin 路由树', () => {
  it('/admin 子树 10 叶子路径精确匹配 + index 重定向指向 /admin/models', () => {
    const all = flatten(router.routes);
    // 叶子用精确集合断言（前缀计数法在路径拼错时仍会通过，如 subscription/foo）
    const leafPaths = all
      .filter((r) => typeof r.path === 'string'
        && (r.path === 'models' || r.path.startsWith('subscription/') || r.path.startsWith('homepage/') || r.path === 'settings' || r.path.startsWith('styles/')))
      .map((r) => r.path)
      .sort();
    expect(leafPaths).toEqual([
      'homepage/announcement', 'homepage/banners', 'models', 'settings',
      'styles/categories', 'styles/content',
      'subscription/banner', 'subscription/credits', 'subscription/plans', 'subscription/subscriptions',
    ]);
    // index 断言锚定到 /admin 子树内部（全局 some 会被其他 index 路由满足）
    const adminParent = all.find((r) => r.path === '/admin');
    expect(adminParent).toBeTruthy();
    const layoutNode = adminParent!.children.find((r: any) => r.path === '');
    expect(layoutNode).toBeTruthy();
    const indexRoute = layoutNode!.children.find((r: any) => r.index === true);
    expect(indexRoute?.element?.props?.to).toBe('/admin/models');
  });
});
