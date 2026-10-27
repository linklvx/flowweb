// packages/shared/src/canvas/schema-contract.spec.ts
// Y1c T3：DOC_SCHEMA_V4 契约断言族——矩阵冻结的执法面（plan v1.7 T3 红清单逐项）。
// 现无类型维度=红前置（本文件建立前矩阵不存在——先红后绿已由建卡过程隐含，本文件=常驻锁）。
import { describe, expect, it } from 'vitest';
import { DOC_SCHEMA_V4, META_WHITELIST, NODE_TYPE_ALIASES, type DataKeySpec } from './doc-schema-v4';
import { NODE_ENVELOPE_KEYS } from './nodeEnvelope';
import { EPHEMERAL_DATA_KEYS } from './docShape';
import { GROUP_NODE_DATA_KEYS } from '../types/group';

// ── census ① 全集（CanvasView nodeTypes 注册表真值——8 类型）＋ census ② 逐类型 data 键树
//    （零漂移基准：本表键集=census ② 实测（含 product-node 实测三键收编）；矩阵双向 setEqual）──
const CENSUS_TYPES = ['textInput', 'imageGen', 'imageExtGen', 'videoGen', 'audioGen', 'multiImageGen', 'videoEdit', 'group'] as const;

const CENSUS_DATA_KEYS: Record<string, readonly string[]> = {
  textInput: ['content', 'prompt', 'model', 'order'],
  imageGen: ['fileId', 'referenceImage', 'mediaName', 'slot', 'status', 'imageRotation', 'flipH', 'flipV',
    'aspectRatio', 'allImages', 'style', 'styleId', 'styleName', 'model', 'quality', 'ratio', 'resolution', 'prompt', 'order'],
  imageExtGen: ['fileId', 'referenceImage', 'mediaName', 'slot', 'status', 'imageRotation', 'flipH', 'flipV',
    'aspectRatio', 'allImages', 'style', 'styleId', 'styleName', 'model', 'quality', 'ratio', 'resolution', 'prompt',
    'extConfig', 'aiTool', 'order'],
  videoGen: ['model', 'status', 'fileId', 'aspectRatio', 'referenceVideo', 'ratio', 'prompt', 'styleId', 'styleName',
    'allImages', 'trimStart', 'trimEnd', 'trimTaskStatus', 'trimmedFileId', 'order',
    'origin', 'videoProjectId', 'label'],
  // Y1c T15：audioGen content:string → prompt:Y.Text 同卡迁（写面实测键集同步——AudioConfigPanel）
  audioGen: ['model', 'prompt', 'status', 'fileId', 'referenceAudio', 'order'],
  multiImageGen: ['label', 'images', 'mainImageIndex', 'expanded', 'nodeStatus', 'generationBatchId', 'prompt', 'order'],
  videoEdit: ['order'],
  group: ['groupType', 'name', 'storyboard', 'collapsed', 'nameCustom', 'color', 'order'],
};

const setEqual = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((k) => b.includes(k)) && b.every((k) => a.includes(k));

/** 深走矩阵取全部 DataKeySpec（含 children/items）。 */
function* walkSpecs(data: Record<string, DataKeySpec>): Generator<[string, DataKeySpec]> {
  for (const [key, spec] of Object.entries(data)) {
    yield [key, spec];
    if (spec.children) yield* walkSpecs(spec.children);
    if (spec.items) yield [`${key}[]`, spec.items];
  }
}

describe('Y1c T3 DOC_SCHEMA_V4 契约（矩阵冻结唯一基准）', () => {
  it('census① 全集穷举：矩阵类型集 setEqual 8 类型（group/videoEdit 必在册）', () => {
    expect(setEqual(Object.keys(DOC_SCHEMA_V4), CENSUS_TYPES)).toBe(true);
  });

  it('Y1a envelope：逐类型 envelope setEqual NODE_ENVELOPE_KEYS（单源派生——缺一即红）', () => {
    for (const [type, entry] of Object.entries(DOC_SCHEMA_V4)) {
      expect(setEqual(entry.envelope, NODE_ENVELOPE_KEYS), `envelope 漂移: ${type}`).toBe(true);
    }
  });

  it('census② 键树零漂移：逐类型 data 键集 setEqual census 实测键集（双向——不发明键不漏真实键）', () => {
    for (const type of CENSUS_TYPES) {
      const matrixKeys = Object.keys(DOC_SCHEMA_V4[type].data);
      expect(setEqual(matrixKeys, CENSUS_DATA_KEYS[type]), `键集漂移: ${type}`).toBe(true);
    }
  });

  it('writer 二元执法：矩阵全量（含 children/items）零 writer:"server" 条目（服务端派生键=server-forbidden 非写权）', () => {
    for (const [type, entry] of Object.entries(DOC_SCHEMA_V4)) {
      for (const [path, spec] of walkSpecs(entry.data)) {
        expect(spec.writer, `${type}.${path} writer`).toBe('user');
      }
    }
  });

  it('server-forbidden 语义一致：禁入键 canWrite/canCreate/canDelete 全 false + undo false + importExport false', () => {
    for (const [type, entry] of Object.entries(DOC_SCHEMA_V4)) {
      for (const [path, spec] of walkSpecs(entry.data)) {
        if (spec.yType !== 'server-forbidden') continue;
        expect([spec.canWrite, spec.canCreate, spec.canDelete, spec.undo, spec.importExport].every((v) => v === false),
          `${type}.${path} server-forbidden 操作面必须全 false`).toBe(true);
      }
    }
  });

  it('manifest 现键零漂移：v3 服务端域键（SERVER_NODE_DATA_KEYS 形域）在矩阵内一律 server-forbidden 分类', () => {
    // SERVER_NODE_DATA_KEYS={fileId,resultUrl,videoUrl,result,errorCode}（manifest 单源——此处
    // 不 import 私有常量，按语义域断言矩阵侧分类）：矩阵中出现的键若属服务端产物/进度域必须 forbidden。
    // Y1c T24 D-3：'content' 已移除（死键 fail-closed——textInput.content=xml 域用户键，零合法写者）。
    const serverDomain = new Set(['fileId', 'resultUrl', 'videoUrl', 'result', 'errorCode', 'status',
      'trimTaskStatus', 'trimmedFileId', 'nodeStatus']);
    for (const [type, entry] of Object.entries(DOC_SCHEMA_V4)) {
      for (const [key, spec] of Object.entries(entry.data)) {
        if (serverDomain.has(key)) {
          expect(spec.yType, `${type}.${key} 服务端域键必须 server-forbidden`).toBe('server-forbidden');
        }
      }
    }
    // 例外白名单：textInput.content = 用户文本域（Y1c T15 后矩阵内 content 用户键仅 textInput——
    // audioGen.content 已随 T15 迁 prompt 退册；serverDomain 的 content 指 videoGen text 产物域，
    // 产物键现状住 exec/投影不进 data 矩阵）
  });

  it('EPHEMERAL_DATA_KEYS 禁入矩阵（本地瞬态 UI 键不入 doc schema）', () => {
    for (const [type, entry] of Object.entries(DOC_SCHEMA_V4)) {
      for (const key of Object.keys(entry.data)) {
        expect(EPHEMERAL_DATA_KEYS.has(key), `${type}.${key} 为 EPHEMERAL 键禁入矩阵`).toBe(false);
      }
    }
  });

  it('Y1a order/slot 键覆盖：order 全 8 类型在册（addNodeInner 通用分配）；slot=imageGen/imageExtGen（快照白名单实证）', () => {
    for (const type of CENSUS_TYPES) {
      const orderSpec = DOC_SCHEMA_V4[type].data.order;
      expect(orderSpec, `${type}.order 缺失`).toBeDefined();
      expect(orderSpec!.yType).toBe('lww');
    }
    expect(DOC_SCHEMA_V4.imageGen.data.slot?.yType).toBe('lww');
    expect(DOC_SCHEMA_V4.imageExtGen.data.slot?.yType).toBe('lww');
    expect(DOC_SCHEMA_V4.textInput.data.slot).toBeUndefined(); // census ② slot 字样按快照白名单（:38 无 slot）裁定不入册
  });

  it('v4 目标 yType 基准（spec §3.1 矩阵线）：textInput{content:xml,prompt:map{text}}；image/video/imageExt prompt=xml；audioGen prompt=text（T15 已迁——content 退册）；multiImageGen prompt=text（T15 已赋形）；allImages/images=array', () => {
    const s = DOC_SCHEMA_V4;
    expect(s.textInput.data.content?.yType).toBe('xml');
    expect(s.textInput.data.prompt?.yType).toBe('map');
    expect(s.textInput.data.prompt?.children?.text?.yType).toBe('text');
    expect(s.imageGen.data.prompt?.yType).toBe('xml');
    expect(s.videoGen.data.prompt?.yType).toBe('xml');
    expect(s.imageExtGen.data.prompt?.yType).toBe('xml');
    expect(s.audioGen.data.prompt?.yType).toBe('text');
    expect(s.audioGen.data.content).toBeUndefined(); // T15 同卡迁——content 键退册（写面=AudioConfigPanel 已改键）
    expect(s.multiImageGen.data.prompt?.yType).toBe('text');
    expect(s.imageGen.data.allImages?.yType).toBe('array');
    expect(s.videoGen.data.allImages?.yType).toBe('array');
    expect(s.multiImageGen.data.images?.yType).toBe('array');
  });

  it('DataKeySpec 结构完备：全量条目字段齐全+undo/im 操作面自洽（lww 用户键三操作 true）', () => {
    const REQUIRED: (keyof DataKeySpec)[] = ['yType', 'writer', 'reader', 'permission', 'undo', 'mediaRef',
      'importExport', 'canCreate', 'canWrite', 'canDelete', 'inExecutionPlan'];
    for (const [type, entry] of Object.entries(DOC_SCHEMA_V4)) {
      for (const [path, spec] of walkSpecs(entry.data)) {
        for (const field of REQUIRED) {
          expect(spec[field], `${type}.${path}.${field} 缺失`).not.toBeUndefined();
        }
        if (spec.yType === 'lww' && spec.permission === 'free') {
          expect(spec.canCreate && spec.canWrite && spec.canDelete && spec.undo, `${type}.${path} lww 用户键操作面`).toBe(true);
        }
      }
    }
  });

  it('META_WHITELIST ⊆ meta 现活键（T18 起 meta 零生产写者——现活键=空集，白名单必空；占位锁：meta 活键无机器单源〔manifest 为叙述条目〕，活键面变更时本行手动同步）', () => {
    const META_LIVE_KEYS: readonly string[] = []; // manifest meta 条目：零生产写者零版本读者
    for (const key of META_WHITELIST) {
      expect(META_LIVE_KEYS, `meta 白名单键 ${key} 无现活键支撑`).toContain(key);
    }
    expect(META_WHITELIST).toHaveLength(0); // 空集冻结（后续用户可编辑 meta 键落位时此断言随白名单同步放宽）
  });

  it('组键集锚：矩阵 group.data ⊇ GROUP_NODE_DATA_KEYS（克隆/公开过滤契约键全在册——types/group 单源直引）', () => {
    const groupKeys = Object.keys(DOC_SCHEMA_V4.group.data);
    for (const key of GROUP_NODE_DATA_KEYS) {
      expect(groupKeys, `group.${key} 缺失（GROUP_NODE_DATA_KEYS 单源）`).toContain(key);
    }
    // storyboard 子键集 ⊇ GroupNodeDataShape.storyboard 五键（aspectRatio/gridRows/gridCols/showIndex/stitchResolution）
    const sbChildren = Object.keys(DOC_SCHEMA_V4.group.data.storyboard?.children ?? {});
    for (const key of ['aspectRatio', 'gridRows', 'gridCols', 'showIndex', 'stitchResolution']) {
      expect(sbChildren, `group.storyboard.${key} 缺失`).toContain(key);
    }
  });

  it('exec 根不在 schema（写入即 DENY——矩阵无 exec 维度即语义本身）', () => {
    expect(Object.keys(DOC_SCHEMA_V4).includes('exec')).toBe(false);
    for (const entry of Object.values(DOC_SCHEMA_V4)) {
      for (const key of Object.keys(entry.data)) {
        expect(key.startsWith('exec')).toBe(false);
      }
    }
  });

  // ── Y1c T16（挂账#3：T3 遗留别名表吸收）────────────────────────────────
  it('NODE_TYPE_ALIASES 派生不变量：值集 ⊆ 矩阵全集+alias=全名剥 {Gen,Input} 后缀正则象+无撞车', () => {
    const matrixTypes = new Set(Object.keys(DOC_SCHEMA_V4));
    for (const [alias, full] of Object.entries(NODE_TYPE_ALIASES)) {
      expect(matrixTypes, `别名值 ${full} 不在 DOC_SCHEMA_V4 全集`).toContain(full);
      const stripped = full.replace(/(Gen|Input)$/, '');
      expect(alias, `${full} 剥后缀=${stripped} ≠ 表值 ${alias}（后缀派生不变量）`).toBe(stripped);
    }
    // 撞车排除面：videoEdit 剥 'Gen|Input' 后='videoEdit'（无后缀）不入表；盲剥派生在
    // videoGen/videoEdit 上短名撞车 ⇒ 显式冻结表（doc-schema-v4 注记锚）
    expect('videoEdit' in NODE_TYPE_ALIASES).toBe(false);
    expect('group' in NODE_TYPE_ALIASES).toBe(false);
    expect(Object.keys(NODE_TYPE_ALIASES)).toHaveLength(6);
  });
});
