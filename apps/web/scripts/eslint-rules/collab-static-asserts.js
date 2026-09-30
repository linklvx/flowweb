/**
 * collab 恢复静态断言三条（批0e-4，spec 2026-09-29-collab-conn-status-recovery 四条静态断言之三）：
 *   A. flowweb/no-conn-status-write —— connStatus 单写点；
 *   B. flowweb/no-ydoc-getmap —— ydoc getMap 读取三文件门；
 *   C. flowweb/no-store-setstate —— useCanvasStore/useNodeStore 直调 setState 白名单。
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
const GETMAP_FILES = [
  'src/stores/canvasCollabRuntime.ts',
  'src/collab/ydocBuilder.ts',
  'src/stores/canvasUndo.ts',
];

// C. setState 直调白名单：协作数据写入路径四文件（canvasHistory 为 0.5 接线前瞻项，现状无命中）
// + 现状豁免（见各条注释——均非 collab 恢复路径的既有 UI 写点，锁现状防新增，收口另行推进）。
const STORE_SETSTATE_FILES = [
  'src/stores/canvasStore.ts',           // store 自身
  'src/stores/nodeStore.ts',             // store 自身
  'src/stores/canvasCollabRuntime.ts',   // 协作数据写入（含 connStatus 写点）
  'src/stores/canvasHistory.ts',         // 0.5 接线前瞻项（现状无直调）
  'src/pages/canvas/page.tsx',           // 生命周期豁免：resetSession（:85-86 清 store）/openSession（:113 装载 projectId）
  'src/hooks/useTrackCanvasPointerShift.ts',    // UI 交互态（shift 键跟踪），非协作数据
  'src/hooks/useMarqueeSelectionGuard.ts',      // UI 交互态（框选 guard），非协作数据
  'src/pages/canvas/components/CanvasView.tsx', // UI 交互态（pendingFillCell/pendingMediaFile/marqueeSelecting）
  'src/pages/canvas/video-editor/components/VideoEditorShell.tsx', // editorDirty B4 镜像（批0d-2，beforeunload 消费）
  // 批 2 VIEWER store wrapper 收口四 ConfigPanel 10 处后，本豁免清单须同步删对应条目（spec 批 2 行）
  'src/pages/canvas/components/nodes/AudioConfigPanel.tsx', // 表单编辑写点（useNodeStore），非协作数据
  'src/pages/canvas/components/nodes/ImageConfigPanel.tsx', // 同上
  'src/pages/canvas/components/nodes/TextConfigPanel.tsx',  // 同上
  'src/pages/canvas/components/nodes/VideoConfigPanel.tsx', // 同上
];

const MSG = {
  connStatusWrite:
    'connStatus 单写点断言：唯一写点 recomputeConnStatus（批0a，canvasCollabRuntime）；' +
    '豁免仅 runtime 超时分支直写（终态，事件通道已断）+ canvasStore 初始值。新写点须先改 spec 再动码（spec 2026-09-29-collab-conn-status-recovery）。',
  getmap:
    'getMap 三文件门：ydoc Map 读取仅限 canvasCollabRuntime/ydocBuilder/canvasUndo；' +
    '0.5 exec 读点落地时增补白名单（spec 2026-09-29-collab-conn-status-recovery）。',
  setstate:
    'setState 白名单断言：useCanvasStore/useNodeStore 直调 setState 仅限协作写入路径四文件+生命周期/UI 豁免点（见规则白名单注释）；' +
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
