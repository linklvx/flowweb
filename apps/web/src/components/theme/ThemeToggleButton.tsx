// C8 D0 两态切换钮（spec §7.4/7.5）：TopActionBar 与 CanvasTopBar 共享——label/aria 常量同源，
// G7 按 aria-label 锚定防两处漂移。chrome 跟随主题（token 工具类）。
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { setMode, useTheme, type ThemeMode } from '@/stores/themeStore';

export const THEME_LABEL: Record<ThemeMode, string> = { light: '浅色', dark: '深色' };

const BTN = 'h-8 w-8 rounded-lg border border-overlay-2 bg-overlay-1 hover:bg-surface-dim hover:border-overlay-3 text-text-dim-3 hover:text-text flex items-center justify-center transition-colors duration-150';

export function ThemeToggleButton() {
  const { mode } = useTheme();
  const next: ThemeMode = mode === 'dark' ? 'light' : 'dark';
  const Icon = mode === 'dark' ? MoonOutlined : SunOutlined;
  return (
    <button
      onClick={() => setMode(next)}
      aria-label={`切换主题，当前：${THEME_LABEL[mode]}`}
      title={`主题：${THEME_LABEL[mode]}（点击切换为${THEME_LABEL[next]}）`}
      className={BTN}
    >
      <Icon className="text-base" />
    </button>
  );
}
