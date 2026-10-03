/** handle 拖拽弹菜单的菜单项定义（B6-1（Spec B 终裁 57①）：SOURCE_ITEMS/TARGET_ITEMS
 * 自 HandleAddNodeMenu.tsx 组件文件迁入 utils/——与 handleMenu.ts 守卫/决策纯函数同层。 */

export interface MenuItemDef {
  type: string;
  label: string;
  icon: React.ReactNode;
}

const ICON_TEXT = (
  <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="7" y="8" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="2.2" />
    <path d="M11 13H21M11 18H18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);
const ICON_IMAGE = (
  <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="7" y="7" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2.2" />
    <path d="M10.5 21L14.2 16.7L17 19.5L19.2 16.8L22 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12.5" cy="12.5" r="1.5" fill="currentColor" />
  </svg>
);
const ICON_VIDEO = (
  <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="7" y="8" width="18" height="16" rx="4" stroke="currentColor" strokeWidth="2.2" />
    <path d="M14 13.2V18.8L19 16L14 13.2Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
  </svg>
);
const ICON_AUDIO = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M3.5 8v4M7.5 5v10M11.5 7v6M15.5 9v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const SOURCE_ITEMS: MenuItemDef[] = [
  { type: 'textInput', label: '文本', icon: ICON_TEXT },
  { type: 'imageGen', label: '图片', icon: ICON_IMAGE },
  { type: 'videoGen', label: '视频', icon: ICON_VIDEO },
  { type: 'audioGen', label: '音频', icon: ICON_AUDIO },
];
export const TARGET_ITEMS: MenuItemDef[] = [
  { type: 'textInput', label: '文本', icon: ICON_TEXT },
  { type: 'imageGen', label: '图片', icon: ICON_IMAGE },
];
