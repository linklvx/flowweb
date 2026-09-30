/**
 * collab 恢复静态断言（批0e-4 三条 + 批4b-2 第四条）：
 *   A. flowweb/no-conn-status-write —— connStatus 单写点；
 *   B. flowweb/no-ydoc-getmap —— ydoc getMap 读取三文件门；
 *   C. flowweb/no-store-setstate —— useCanvasStore/useNodeStore 直调 setState 白名单；
 *   D. flowweb/no-delete-scan —— 零删除扫描（批4b-2）：生产代码禁"遍历 Y.Map keys + 条件 delete"
 *      的全量对账删除形态（0b deletion baseline 反模式——删除意图必须显式化 intent）。
 *
 * 共同形态（仿 no-theme-utility）：文件白名单外直判 exit 1（无 baseline，lint-gate.mjs 不建 baseline）；
 * 测试文件豁免（*.test.* / *.spec.*）——单写点/门是对生产代码的结构约束，测试的 mock 与断言不受限。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 相对 apps/web 的 posix 路径（与 no-theme-utility.toAppRelPosix 同口径） */
function toAppRelPosix(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(APP_ROOT, filePath);
  return path.relative(APP_ROOT, abs).split(path.sep).join('/');
}

/** 测试文件豁免：断言针对生产代码结构，测试 mock/断言串不受限 */
const isTestFile = (filePath) => /\.(test|spec)\.[jt]sx?$/.test(toAppRelPosix(filePath));

/** 门是否生效：测试文件或白名单内 → false（放行） */
const gateActive = (context, allowedFiles) => {
  const rel = toAppRelPosix(context.filename ?? context.getFilename());
  return !isTestFile(rel) && !allowedFiles.includes(rel);
};

// A. connStatus 单写点：唯一写点 recomputeConnStatus（批0a，canvasCollabRuntime）。
// 批2-1 修D：超时分支直写 'offline' 已废（超时不再 destroyCollab——provider 存活，recompute 可达全状态）。
// 豁免：canvasStore 初始值 'connecting'。
const CONN_STATUS_WRITE_FILES = [
  'src/stores/canvasCollabRuntime.ts', // recomputeConnStatus 唯一写点
  'src/stores/canvasStore.ts',         // state 初始值 connStatus: 'connecting'
];

// B. getMap 三文件门：ydoc Map 读取收口；0.5 exec 读点落地时增补对应文件。
// 批4b-1：canvasIntents（意图漏斗 applyIntentToDoc doc 直写）入白名单——门 C 裁决的合法 doc 写者。
const GETMAP_FILES = [
  'src/stores/canvasCollabRuntime.ts',
  'src/collab/ydocBuilder.ts',
  'src/stores/canvasUndo.ts',
  'src/stores/canvasIntents.ts',
];

// C. setState 直调白名单：协作数据写入路径（canvasHistory 为 0.5 接线前瞻项，现状无命中）
// + 现状豁免（见各条注释——均非 collab 恢复路径的既有 UI 写点，锁现状防新增，收口另行推进）。
// 批2-2：四 ConfigPanel 10 处 setState 已收口至 nodeStore.applyNodeDataPatch——豁免条目删除
// （白名单外零命中；回退/新增旁路当场红）。
// 批4b-1：canvasIntents 入白名单——projectIntentToStore 是意图漏斗的合法 store 投影写者
// （doc 为真相、store 为投影；组 2 删 bindBridge 后为唯一 store 写者）。
const STORE_SETSTATE_FILES = [
  'src/stores/canvasStore.ts',           // store 自身
  'src/stores/nodeStore.ts',             // store 自身
  'src/stores/canvasCollabRuntime.ts',   // 协作数据写入（含 connStatus 写点）
  'src/stores/canvasIntents.ts',         // 批4b-1 意图漏斗 store 投影回填（projectIntentToStore）
  'src/stores/canvasHistory.ts',         // 0.5 接线前瞻项（现状无直调）
  'src/pages/canvas/page.tsx',           // 生命周期豁免：resetSession（:85-86 清 store）/openSession（:113 装载 projectId）
  'src/hooks/useTrackCanvasPointerShift.ts',    // UI 交互态（shift 键跟踪），非协作数据
  'src/hooks/useMarqueeSelectionGuard.ts',      // UI 交互态（框选 guard），非协作数据
  'src/pages/canvas/components/CanvasView.tsx', // UI 交互态（pendingFillCell/pendingMediaFile/marqueeSelecting）
  'src/pages/canvas/video-editor/components/VideoEditorShell.tsx', // editorDirty B4 镜像（批0d-2，beforeunload 消费）
];

const MSG = {
  connStatusWrite:
    'connStatus 单写点断言：唯一写点 recomputeConnStatus（批0a，canvasCollabRuntime）；' +
    '豁免仅 runtime 超时分支直写（终态，事件通道已断）+ canvasStore 初始值。新写点须先改 spec 再动码（spec 2026-09-29-collab-conn-status-recovery）。',
  getmap:
    'getMap 门：ydoc Map 读取仅限 canvasCollabRuntime/ydocBuilder/canvasUndo/canvasIntents（批4b-1 意图漏斗）；' +
    '新 doc 写/读点落地时增补白名单（spec 2026-09-29-collab-conn-status-recovery）。',
  setstate:
    'setState 白名单断言：useCanvasStore/useNodeStore 直调 setState 仅限协作写入路径（store 本体+runtime+canvasIntents 投影）+生命周期/UI 豁免点（见规则白名单注释）；' +
    '新增写点先判定归属协作数据 or UI 交互态，再入白名单（spec 2026-09-29-collab-conn-status-recovery）。',
};

/** A. connStatus 写点：ObjectExpression 属性（setState({connStatus}) / 初始 state）+ 成员赋值（x.connStatus=） */
export const noConnStatusWrite = {
  meta: { type: 'problem', docs: { description: 'connStatus 单写点（批0e-4 静态断言 A）' }, schema: [], messages: { forbidden: MSG.connStatusWrite } },
  create(context) {
    const active = gateActive(context, CONN_STATUS_WRITE_FILES);
    return {
      Property(node) {
        if (active && !node.computed && node.key.type === 'Identifier' && node.key.name === 'connStatus') {
          context.report({ node, messageId: 'forbidden' });
        }
      },
      AssignmentExpression(node) {
        const l = node.left;
        if (active && l.type === 'MemberExpression' && !l.computed && l.property.type === 'Identifier' && l.property.name === 'connStatus') {
          context.report({ node, messageId: 'forbidden' });
        }
      },
    };
  },
};

/** B. getMap( 调用门：Identifier 或 MemberExpression property 形态均拦 */
export const noYdocGetmap = {
  meta: { type: 'problem', docs: { description: 'getMap 三文件门（批0e-4 静态断言 B）' }, schema: [], messages: { forbidden: MSG.getmap } },
  create(context) {
    const active = gateActive(context, GETMAP_FILES);
    return {
      CallExpression(node) {
        if (!active) return;
        const c = node.callee;
        const name = c.type === 'Identifier'
          ? c.name
          : c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier' ? c.property.name : null;
        if (name === 'getMap') context.report({ node, messageId: 'forbidden' });
      },
    };
  },
};

/** C. useCanvasStore.setState( / useNodeStore.setState( 直调白名单 */
export const noStoreSetstate = {
  meta: { type: 'problem', docs: { description: 'setState 白名单（批0e-4 静态断言 C）' }, schema: [], messages: { forbidden: MSG.setstate } },
  create(context) {
    const active = gateActive(context, STORE_SETSTATE_FILES);
    return {
      CallExpression(node) {
        if (!active) return;
        const c = node.callee;
        if (
          c.type === 'MemberExpression' && !c.computed &&
          c.object.type === 'Identifier' && (c.object.name === 'useCanvasStore' || c.object.name === 'useNodeStore') &&
          c.property.type === 'Identifier' && c.property.name === 'setState'
        ) {
          context.report({ node, messageId: 'forbidden' });
        }
      },
    };
  },
};

// D. 批4b-2 零删除扫描：生产代码禁"遍历 Y.Map keys + 条件 delete 同基座"的全量对账删除形态
// （syncStoreToDoc/0b deletion baseline 的结构性反模式——靠"上次投影"猜测删除意图）。删除意图
// 必须显式化 intent（deleteNode/deleteEdge）。豁免 canvasIntents：applyIntentToDoc 的 deleteNode
// 级联引用边清理是显式 intent 的执行体（删除目标=引用边判定，非 baseline 成员扫描）。
const DELETE_SCAN_EXEMPT_FILES = ['src/stores/canvasIntents.ts'];

const MSG_DELETE_SCAN =
  '零删除扫描断言（批4b-2）：生产代码禁"遍历 Y.Map keys + 条件 delete"的全量对账删除形态——' +
  '删除意图必须显式化 intent（canvasIntents deleteNode/deleteEdge；豁免仅 canvasIntents）。' +
  '新删除路径落地先改 spec 再动码（spec 2026-09-29-collab-conn-status-recovery 批4b）。';

/** 迭代表达式 → 被迭代集合的基座文本（X.keys() 或 [ ...X.keys() ] 的 X）；非 keys() 形态返回 null */
function keysBaseText(node, sourceCode) {
  const call =
    node.type === 'CallExpression' ? node
    : node.type === 'ArrayExpression' && node.elements.length === 1 && node.elements[0].type === 'SpreadElement'
      ? node.elements[0].argument
      : null;
  if (!call || call.type !== 'CallExpression') return null;
  const callee = call.callee;
  if (callee.type !== 'MemberExpression' || callee.computed ||
    callee.property.type !== 'Identifier' || callee.property.name !== 'keys') return null;
  return sourceCode.getText(callee.object);
}

/** D. delete-scan 门：for..of 迭代某集合 keys() 且循环体内对同基座 delete —— 扫描删除形态 */
export const noDeleteScan = {
  meta: { type: 'problem', docs: { description: '零删除扫描（批4b-2 静态断言 D）' }, schema: [], messages: { forbidden: MSG_DELETE_SCAN } },
  create(context) {
    const active = gateActive(context, DELETE_SCAN_EXEMPT_FILES);
    if (!active) return {};
    return {
      ForOfStatement(node) {
        const base = keysBaseText(node.right, context.sourceCode ?? context.getSourceCode());
        if (base == null) return;
        const bodyText = (context.sourceCode ?? context.getSourceCode()).getText(node.body);
        // 同基座 delete（文本判据：基座精确匹配 + .delete( ——避免成员链/别名的宽松误报）
        const re = new RegExp(`(^|[^\\w$.])${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.delete\\s*\\(`);
        if (re.test(bodyText)) context.report({ node, messageId: 'forbidden' });
      },
    };
  },
};
