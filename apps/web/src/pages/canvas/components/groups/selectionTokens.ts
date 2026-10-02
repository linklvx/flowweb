// apps/web/src/pages/canvas/components/groups/selectionTokens.ts
import type { CSSProperties } from 'react';

/** 多选容器框（viewport 外 overlay，屏幕坐标）——mockup 亲选参数
 * C8 D3-board：选框描边改 --fw-text 双值（深 rgb(226,232,240)/浅 rgb(31,35,41)）——原 rgba(255,255,255,0.65) 浅档白底上不可见 */
export const SELECTION_BOX = {
  borderColor: 'var(--fw-text)',
  borderStyle: 'dashed' as const,
  borderWidth: 2,
  borderRadius: 8,
  background: 'rgba(0,0,0,0.35)',
  padding: 30,
  // 节点标题浮层溢出高度（流坐标：18px 行高 + pb-2 8px 间隙），getNodesBounds 不含此浮层
  titleExtra: 26,
};

/** 组块容器（RF 节点内，流坐标）——双值虚线（浅档防选中框消失）；底随 chrome（#1a1a1a 族） */
export const GROUP_BOX = {
  border: 'var(--fw-text-dim-3)',
  selectedBorder: 'var(--fw-text)',
  borderWidth: 2,
  borderRadius: 10,
  background: 'var(--canvas-controls-bg)',
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

// §4.2 拆分：多选 48/14、组 52/12（容器 padding 8×2 + 按钮 h-8(32)=48 / h-9(36)=52）；
// 旧 40/12 常量已随 R2c-6 GroupToolbar 迁移退役
export const SELECTION_TOOLBAR = { height: 48, offset: 14 } as const;
export const GROUP_TOOLBAR = { height: 52, offset: 12 } as const;

/** R2d-5 分镜智能标题双带（屏幕像素常量）：标题带锚 = frame.top−gap（行高 rowH，
 * translateY(-100%) 后占 [锚−rowH, 锚]）；工具条带锚 = 标题带顶 = frame.top−gap−rowH。
 * 消费面：StoryboardTitlesLayer（标题带）/ GroupToolbar storyboard 分支（STORYBOARD_TOOLBAR_OFFSET=32，
 * normal 分支维持 GROUP_TOOLBAR.offset=12）。两 rect 不相交的浏览器级实测落 2d-8。 */
export const STORYBOARD_TITLE = { gap: 12, rowH: 20, maxWidth: 240 } as const;
export const STORYBOARD_TOOLBAR_OFFSET = STORYBOARD_TITLE.gap + STORYBOARD_TITLE.rowH; // 32
