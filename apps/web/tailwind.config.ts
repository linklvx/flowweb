import type { Config } from 'tailwindcss';

/**
 * 基础层（preflight）必须开启——root-cause 修复 spec docs/superpowers/specs/2026-09-18-css-base-layer-theme-design.md：
 * preflight:false 曾致 border 工具类在非表单元素全站失效 + 裸 button 吃 UA 样式；旧「preflight:false 红线」已被该 spec 废止，勿再关闭。
 * borderColor.DEFAULT = --fw-border 桥（D2）：preflight 的 *{border-color} 发出该变量，指向项目习惯边色（暗色 #333，见 index.css）。
 * darkMode 用 'class' 而非 v3.4 推荐的 'selector'：'class' 把 dark: 变体编译为整条 .dark\:x:is(.dark *) = (0,2,0)（:is 取参数最高特异性），
 * 会硬压岛内同属性工具类——误用可见；'selector' (:where(.dark,.dark *) (0,1,0)) 则让误用静默。仓库 dark: 变体 0 处；.light 类名源码无占用，
 * 但 @xyflow/react 的 ReactFlow wrapper 运行时默认挂 light 类（dist esm index.mjs:3598/3606）——CanvasView 已钉 colorMode="dark"
 * 消除撞名（实测视觉零差，见 A2 修复记录），ProcessSnapshot 本就 colorMode="dark"。
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          green: '#4ade80',
          dark: '#1A1A1A',
          darker: '#111',
        },
      },
      borderColor: {
        DEFAULT: 'var(--fw-border)',
      },
    },
  },
  plugins: [],
};

export default config;
