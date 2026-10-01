// R2c-2 组色单源：palette / 类型 / resolve 唯一收敛函数
// 对应 index.css 双主题块 --canvas-group-color-*（palette↔css 对账由 groupColor.test.ts 钉死）

export const GROUP_PALETTE = [
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
] as const; // 无 gray

export type GroupColorKey = (typeof GROUP_PALETTE)[number];

export const GROUP_COLOR_MAP: Record<GroupColorKey, string> = Object.fromEntries(
  GROUP_PALETTE.map((key) => [key, `var(--canvas-group-color-${key})`]),
) as Record<GroupColorKey, string>;

/** 唯一收敛函数：合法 key → CSS 值；bogus/undefined → undefined（未知 key 按未设色不抛错——写入端另有拒写守卫） */
export function resolveGroupColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return (GROUP_COLOR_MAP as Record<string, string | undefined>)[value];
}
