/** 快照/克隆共用白名单纯函数（spec §4.6/§4.7，D9）。
 *  type 键真值来源 = CanvasView.tsx:42-51 的 nodeTypes 注册表（8 键，含 videoEdit/group——
 *  nodeStore NODE_TYPES 只有 6 键不是全集；API 无法 import web 源码，静态照抄；
 *  全覆盖测试是唯一防线——新增节点类型时必须同步本表）。
 *  isTextNode 用 'text' 判断是既有不一致，勿参照。 */

export interface RawNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  parentId?: string | null;
  data: Record<string, unknown>;
}
export interface RawEdge { id: string; sourceId: string; targetId: string }
export interface RawCanvasData { nodes: RawNode[]; edges: RawEdge[] }

export interface FilterOptions {
  dropTypes: string[];        // 克隆传 ['videoEdit']；快照传 []（videoEdit 保留节点、data 全剥——spec:228/D9，第八轮裁定）
  dropIdPrefixes: string[];
  resetStatusIdle: boolean;   // 克隆 true（防"已完成却无产物"）
  injectThumbnails: boolean;  // 快照 true（由调用方在过滤前注入 data.thumbnailUrl，见 Task 5.2）
}

export interface FilteredNode extends RawNode {}
export interface FilteredEdge { id: string; source: string; target: string }

/** data 白名单表（C2 Task 5.1 第五轮定稿——按 nodeStore.ts:101-127 注释分组的字段实际分布）：
 *  aspectRatio 根级通用（两类都有）；aiTool 仅 imageExtGen 根级；style/model/quality/ratio/resolution/prompt
 *  仅 imageGen 根级（ext 节点的这些值在 extConfig 内、随整体剥离）。缺失字段由 applyWhitelist 的
 *  `field in node.data` 检查 no-op——与 spec §4.6 合并行语义等价。 */
export const WHITELIST: Record<string, string[]> = {
  textInput: ['content', 'prompt'],                                  // content=HTML→纯文本；prompt=string
  imageGen: ['prompt', 'style', 'model', 'quality', 'ratio', 'resolution', 'aspectRatio'],
  imageExtGen: ['prompt', 'aspectRatio', 'aiTool'],                  // prompt 通常在 extConfig 内随整体剥离——保留为 no-op 兜底
  videoGen: ['model', 'ratio', 'prompt', 'trimStart', 'trimEnd', 'label'],
  audioGen: ['model', 'content'],
  multiImageGen: ['prompt', 'label'],
  videoEdit: [],   // 仅结构字段
  group: ['groupType', 'cells', 'name'],
};

/** HTML → 纯文本（红线 2 的服务端半边）：剥全部标签，解码基础实体。
 *  已知边界（第十三轮登记，勿修）：顺序替换存在二次解码——源码字面 `&amp;lt;`（用户想显示 "&lt;"）
 *  先解出 & 得 "&lt;"、随即被 &lt; 规则命中变 "<"，仅显示层差异；输出走 JSON → React 文本节点渲染，
 *  无 HTML 解析、不构成 XSS 面。改一次性回调解码反而破坏 &amp; 正常语义，得不偿失。
 *  单次解码 `&lt;tag&gt;`（tiptap 对字面尖括号文本的常规存储形态）同样重生标签形文本——安全性同依赖
 *  React 文本节点渲染（JSON 输出路径），勿在其他 HTML 渲染上下文复用本函数输出。 */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .trim();
}

export function ensureParentFirst(nodes: RawNode[]): RawNode[] {
  // 依赖序输出（spec §4.6：RF v12 要求父先子后；"先有子后建组"的 Y.Map 插入序不保证）
  const byId = new Map(nodes.map(n => [n.id, n]));
  const emitted = new Set<string>();
  const visiting = new Set<string>();  // 环守卫：A↔B 互指命中即跳过（nodeOrder.ts:4,11,15 仓内同款先例，"不抛栈溢出"）
  const out: RawNode[] = [];
  const visit = (n: RawNode) => {
    if (emitted.has(n.id) || visiting.has(n.id)) return;  // visiting 命中=环，跳过不爆栈
    visiting.add(n.id);
    const p = n.parentId ? byId.get(n.parentId) : undefined;
    if (p) visit(p);                                       // 悬空 parentId：byId 未命中 → 安全跳过
    emitted.add(n.id); out.push(n);
    visiting.delete(n.id);
  };
  for (const n of nodes) visit(n);
  return out;
}

function applyWhitelist(node: RawNode, opts: FilterOptions): FilteredNode {
  const allowed = WHITELIST[node.type] ?? []; // 未知类型默认全剥
  // 第十一轮：readCanvas 的 data 可为 undefined（collab-document.service.ts:71 ?.toJSON()，节点无 data map 时），
  // `field in undefined` 是 TypeError → /process 500——与 position 兜底（下行）同款归一
  const src: Record<string, unknown> = node.data ?? {};
  const data: Record<string, unknown> = {};
  for (const field of allowed) {
    if (!(field in src)) continue;
    const v = src[field];
    if (field === 'content' && node.type === 'textInput' && typeof v === 'string') {
      data.content = stripHtmlToText(v);           // 仅 textInput.content 是 tiptap HTML；audioGen.content 是纯文本旁白——误剥会把 "3 < 5" 吃成 "3 5"（第七轮收口）
    } else if (field === 'prompt') {
      data.prompt = (v && typeof v === 'object')
        ? String((v as any).text ?? '')            // PromptValue → 只取 .text 原文（红线 1：永不返回 .html；.text 本身是纯文本，勿再 strip——防正常尖括号文本被吃）
        : v;                                       // textInput/multiImageGen 的 string prompt
    } else {
      data[field] = v;
    }
  }
  if (opts.injectThumbnails && typeof src.thumbnailUrl === 'string') {
    data.thumbnailUrl = src.thumbnailUrl;   // Task 5.2 注入字段（快照侧）
  }
  // 克隆：白名单外强制重置（§4.7）——multiImageGen 的态字段是 nodeStatus（nodeStore.ts:158 必填），
  // 且限定到声明了态字段的类型（给 textInput/group 塞 status 是无害噪音，勿加）
  if (opts.resetStatusIdle) {
    if (node.type === 'multiImageGen') data.nodeStatus = 'idle';
    else if (['imageGen', 'imageExtGen', 'videoGen', 'audioGen'].includes(node.type)) data.status = 'idle';
  }
  // position 兜底：readCanvas 的 position 可 undefined（collab-document.service.ts:70 ?.toJSON()），shared SnapshotNode.position 必填；
  // width/height 归一：readCanvas 是 m.get('width') ?? null（:68-69）→ 实际 number|null，而 RawNode/shared 声明 number|undefined——
  // 在边界把 null 折成 undefined（第十二轮：类型不撒谎，下游 RF 拿到一致的 undefined=未测量）
  return { ...node, width: node.width ?? undefined, height: node.height ?? undefined, position: node.position ?? { x: 0, y: 0 }, data };
}

export function buildFilteredSnapshot(raw: RawCanvasData, opts: FilterOptions): { nodes: FilteredNode[]; edges: FilteredEdge[] } {
  const dropped = new Set<string>();
  const kept = raw.nodes.filter(n => {
    if (opts.dropTypes.includes(n.type)) { dropped.add(n.id); return false; }
    if (opts.dropIdPrefixes.some(p => n.id.startsWith(p))) { dropped.add(n.id); return false; }
    if ((n.data as { __ephemeral?: unknown })?.__ephemeral === true) { dropped.add(n.id); return false; } // 第七轮：spec §4.6 字面要求的 __ephemeral 标记过滤——当前仓库该标记与 shadow- 前缀共生（node-doc.util.ts 不变量），但白名单不依赖命名约定
    return true;
  });
  const edges = raw.edges
    .filter(e => !dropped.has(e.sourceId) && !dropped.has(e.targetId))
    .map(e => ({ id: e.id, source: e.sourceId, target: e.targetId })); // readCanvas sourceId/targetId → source/target 显式映射
  const nodes = ensureParentFirst(kept).map(n => applyWhitelist(n, opts));
  return { nodes, edges };
}
