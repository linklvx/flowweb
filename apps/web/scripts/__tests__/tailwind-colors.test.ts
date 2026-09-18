// B0 Tailwind colors 同名映射守卫（plan B0-3）：
//   1) 15 个语义 token 后缀同名键全部映射为单值 var(--fw-*)（无嵌套对象、无 rgb(var()/alpha-value 包装）；
//   2) 斜杠键全关硬约束——任何键值含 alpha-value 或 rgb( 包装即失败（`bg-surface/50` 形用法会零输出，
//      由 scripts/css-audit.mjs --slash-gate 常驻门禁兜住使用侧，本测试钉死配置侧）；
//   3) 既有键不回退：brand 族 + borderColor.DEFAULT 桥保持。
import { describe, it, expect } from 'vitest';
import config from '../../tailwind.config';

const colors = (config.theme?.extend?.colors ?? {}) as Record<string, unknown>;

/** B0 定稿 15 键 = token 后缀同名（--fw-border 经 borderColor.DEFAULT 桥，不入 colors） */
const FW_KEYS = [
  'bg', 'surface', 'surface-dim',
  'text', 'text-strong', 'text-dim-1', 'text-dim-2', 'text-dim-3',
  'accent', 'accent-text', 'on-accent', 'accent-danger',
  'overlay-1', 'overlay-2', 'overlay-3',
];

describe('B0 colors 同名映射（15 键单值 var）', () => {
  it('每个 --fw-* 后缀键映射为 var(--fw-<键>) 单值', () => {
    for (const k of FW_KEYS) {
      expect(colors[k], `colors.${k} 应映射 var(--fw-${k})`).toBe(`var(--fw-${k})`);
    }
  });

  it('无 alpha-value / rgb( 包装——斜杠键全关（斜杠透明度用法将零输出）', () => {
    const flat = Object.entries(colors).flatMap(([k, v]) =>
      typeof v === 'string' ? [`${k}:${v}`] : Object.entries(v as Record<string, string>).map(([sk, sv]) => `${k}.${sk}:${sv}`),
    );
    for (const entry of flat) {
      expect(entry.includes('alpha-value'), `${entry} 含 alpha-value——斜杠键开启，违反斜杠零输出硬约束`).toBe(false);
      expect(entry.includes('rgb('), `${entry} 含 rgb( 包装——斜杠键开启，违反斜杠零输出硬约束`).toBe(false);
    }
  });

  it('既有键不回退：brand 族 + borderColor.DEFAULT 桥保持', () => {
    expect(colors.brand).toEqual({ green: '#4ade80', dark: '#1A1A1A', darker: '#111' });
    expect((config.theme?.extend?.borderColor as Record<string, string>).DEFAULT).toBe('var(--fw-border)');
  });
});
