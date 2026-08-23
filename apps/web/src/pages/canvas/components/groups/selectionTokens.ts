// apps/web/src/pages/canvas/components/groups/selectionTokens.ts
import type { CSSProperties } from 'react';

/** 多选容器框（viewport 外 overlay，屏幕坐标）——mockup 亲选参数 */
export const SELECTION_BOX = {
  borderColor: 'rgba(255,255,255,0.65)',
  borderStyle: 'dashed' as const,
  borderWidth: 2,
  borderRadius: 8,
  background: 'rgba(0,0,0,0.35)',
  padding: 16,
};

/** 组块容器（RF 节点内，流坐标）——单层虚线深色 */
export const GROUP_BOX = {
  border: 'rgba(255,255,255,0.45)',
  selectedBorder: 'rgba(255,255,255,0.85)',
  borderWidth: 2,
  borderRadius: 10,
  background: 'rgba(26,26,26,0.6)',
};

/** 数量徽标（多选框左上角 / 组标题旁共用） */
export const BADGE: CSSProperties = {
  background: '#3f3f3f', color: '#fff', borderRadius: 999,
  padding: '2px 8px', fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap',
};

/** 四角 resize 手柄 */
export const HANDLE: CSSProperties = {
  width: 8, height: 8, background: '#fff', border: '1px solid #666', borderRadius: 1,
};

/** 工具条几何常量（高固定单行，不 ref 测量） */
export const TOOLBAR = { height: 40, offset: 12 };
