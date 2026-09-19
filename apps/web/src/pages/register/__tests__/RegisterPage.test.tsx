// register 浅色重做（plan §5）：视觉壳对齐 login 恒浅营销岛——本测试钉住与 login page.tsx 的设计语言耦合
// （同字面色板/岛根 .light/表宽 320/主按钮 accent），表单逻辑（fetch/校验/跳转）不在此文件范围。
// 岛/颜色断言口径：vitest 只断 className 字面（C0 组6——jsdom 不解析 CSS 变量，计算色走 Playwright）。
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { RegisterPage } from '../page';

function renderAt() {
  const router = createMemoryRouter([{ path: '/register', element: <RegisterPage /> }], { initialEntries: ['/register'] });
  render(<RouterProvider router={router} />);
}

describe('RegisterPage 恒浅营销岛（login 同款设计语言）', () => {
  it('岛根 div.light + login 同款浅底字面 bg-[#f5f5f5]', () => {
    renderAt();
    const island = screen.getByRole('heading', { name: '注册 Flow123' }).closest('div.light');
    expect(island, '岛根必须与 login 同款：根元素首类 light').toBeTruthy();
    expect(island!.className).toContain('bg-[#f5f5f5]');
  });

  it('表宽对齐 login 列宽 w-[320px]（A5：原 w-96=384 不一致）', () => {
    renderAt();
    // ByRole 的 name 字符串本身即整名匹配（testing-library 无 exact 项——那是 Playwright 选项）
    const form = screen.getByRole('button', { name: '注册' }).closest('form');
    expect(form, '注册按钮应在 form 内（流程不变）').toBeTruthy();
    expect(form!.className).toContain('w-[320px]');
  });

  it('主按钮 login 同款 accent 字面 bg-[#1F6DFF]', () => {
    renderAt();
    expect(screen.getByRole('button', { name: '注册' }).className).toContain('bg-[#1F6DFF]');
  });

  it('旧深色字面清除：#0f0f0f / #1a1a1a 不再出现', () => {
    renderAt();
    const html = document.body.innerHTML;
    expect(html).not.toContain('#0f0f0f');
    expect(html).not.toContain('#1a1a1a');
  });
});
