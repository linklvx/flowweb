// packages/shared/src/canvas/docShape.ts
// C0-1 契约片（Spec B）：docShape 类型骨架 + stub 谓词——shared 类型与签名定稿（编译门）。
// 本片只定形状与签名：谓词 body 全部 throw 'C0 stub'，行为测试与实现由后续分片填充。
// 出口接入 index.ts 是 O0a 分片的事（C0 期间生产代码零消费——docShape.census.test.ts 守卫）。
import type { AbsPos, RelPos } from './brands';

/** Y.Map 结构性最小面（零 yjs import——防跨实例 instanceof 静默失败，nodeEnvelope 同理由）。 */
export interface DocMapLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
}

/** Y.Doc 结构性最小面。 */
export interface DocLike {
  getMap(name: string): DocMapLike;
}

/** 冻结帧/快照 rect（DragSession 的 baseline/groupBaseline/frozenFrames 共用）。 */
export type Rect = { x: number; y: number; width: number; height: number };

/** 作者态 doc 节点记录（docShape 家族出口专用）：键可选——键集表语义：auto 组无帧键 /
 *  manual 组折叠仍保留三键 / storyboard 组无 wh / 分镜子无 position，运行时键集由谓词守卫、
 *  类型层=可选键。与 nodeEnvelope.ts 的 CanvasNodeRecord（cs/渲染/copyPlan 面，必填）分裂并存——不改后者。 */
export interface DocNodeRecord {
  id: string;
  type: string;
  parentId?: string;
  position?: AbsPos;
  width?: number;
  height?: number;
  data: Record<string, unknown>;
}

/** 渲染面最小骨架（hidden?: boolean 必须出现；完整化留 O0c-2 分片——勿加更多字段）。 */
export interface RenderNode {
  id: string;
  type: string;
  parentId?: string;
  position: RelPos;
  width?: number;
  height?: number;
  data: Record<string, unknown>;
  hidden?: boolean;
}

/** 拖拽会话（键集=plan v3.6-FROZEN 定稿）：draggingIds=被拖集合 / dragProtectedIds=保护集合
 *  （含 resize 扩展）——两者并存。 */
export interface DragSession {
  baseline: ReadonlyMap<string, Rect>;
  groupBaseline: ReadonlyMap<string, Rect>;
  delta: { x: number; y: number };
  draggingIds: ReadonlySet<string>;
  dragProtectedIds: ReadonlySet<string>;
  draggedGroupIds: ReadonlySet<string>;
  frozenFrames: ReadonlyMap<string, Rect>;
  gestureKind: 'drag' | 'resize';
  resizePending: boolean;
  lastActivityAt: number;
  activePointers: Set<number>;
  gestureAbandoned: boolean;
  resizeTargetId: string | null;
}

/** 帧模式三值。四值枚举装不下 collapsed∧manual/auto 交叉——collapsed 由 isCollapsed 正交表达；
 *  dirty-manual 档不存在（manuallyResized 已被终裁 50 删除）。 */
export type FrameMode = 'auto' | 'manual' | 'storyboard';

/** 帧模式判定（stub——C0 只定签名）：data.groupType==='storyboard'⇒'storyboard'；
 *  storedFrame 三键齐且有效⇒'manual'；否则'auto'。
 *  oracle=doc 侧键：禁 cs 派生帧当 storedFrame——判定只依赖传入的 doc 侧记录键，不从 cs 派生。 */
export function frameMode(input: {
  data: Record<string, unknown>;
  storedFrame?: { position?: { x: number; y: number }; width?: number; height?: number };
}): FrameMode {
  throw new Error('C0 stub');
}

/** 折叠谓词（stub——C0 只定签名）：data.collapsed===true。与 frameMode 正交。 */
export function isCollapsed(data: Record<string, unknown>): boolean {
  throw new Error('C0 stub');
}

/** storedFrame 有效性三态（stub——C0 只定签名）：缺任一键/非有限/宽高≤0 ⇒ false；三态全过才 true。 */
export function isValidStoredFrame(frame: {
  position?: { x: number; y: number };
  width?: number;
  height?: number;
}): boolean {
  throw new Error('C0 stub');
}
