// packages/shared/src/canvas/canvas-doc-manifest.test.ts
// Y0c T4（Z108 manifest 升格执行期校验表+Z148① idempotent 列）：校验表单测——违规 body 拒绝。
// plan 判据面：未知键/超批字节/超 op 数/原型链键各一例+idempotent:false op 被拒（校验表层先拒
// ——端点接线归 T27）+结构完整性（四层类型+六 op 全分类编译断言的运行时面+批上限同源）。
import { describe, expect, it } from 'vitest';
import {
  validateWriteBatch,
  DOC_WRITE_OPS,
  MAX_WRITE_OPS_PER_BATCH,
  MAX_WRITE_BATCH_BYTES,
  BANNED_DATA_KEYS,
  DOC_KEY_MANIFEST,
  DOC_TOP_LEVEL_MAPS,
  NESTED_TYPE_CREATORS,
  type DocWriteOpType,
} from './canvas-doc-manifest';
import { QUOTA_DEFAULTS } from '../constants/collab-quota';

describe('Y0c T4 manifest 执行期校验表（Z108——A1 DocWriter 进门消费）', () => {
  it('合法批零违规（writeNodeData+writeExecStatus+delete 族全词汇）', () => {
    const violations = validateWriteBatch([
      { op: 'writeNodeData', nodeId: 'n1', patch: { fileId: 'media_1', resultUrl: 'https://x/y.png' } },
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1, intentId: 'i1', jobId: null } },
      { op: 'deleteNodeDataKeys', nodeId: 'n2', keys: ['resultUrl'] },
      { op: 'deleteNodes', nodeIds: ['n3'] },
      { op: 'deleteExecOrphans' },
    ]);
    expect(violations).toEqual([]);
  });

  it('skipped 投影 reason 键合法（execution.service 两处生产调用点：:306 重复外呼/:411 Z99 NodeBusy）', () => {
    const violations = validateWriteBatch([
      // 镜像 execution.service.ts:306——reserve 拒（重复外呼企图）投影
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'skipped', reason: 'INTENT_DUPLICATE_ATTEMPT', attempts: 2, intentId: 'i1' } },
      // 镜像 execution.service.ts:411-414——Z99 NodeBusy 投影（intentId 条件展开后缺省形态）
      { op: 'writeExecStatus', nodeId: 'n2', patch: { status: 'skipped', reason: 'node busy: other writer in flight', attempts: 0 } },
    ]);
    expect(violations).toEqual([]);
  });

  it('未知键拒绝（writeNodeData patch 键不在 manifest 键集——UNKNOWN_KEY）', () => {
    const violations = validateWriteBatch([
      { op: 'writeNodeData', nodeId: 'n1', patch: { notARegisteredKey: 'x' } },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('UNKNOWN_KEY');
    expect(violations[0].key).toBe('notARegisteredKey');
  });

  it('原型链三键显式拒绝（__proto__/constructor/prototype——PROTO_KEY_BANNED）', () => {
    for (const k of BANNED_DATA_KEYS) {
      const violations = validateWriteBatch([
        { op: 'writeNodeData', nodeId: 'n1', patch: { [k]: 'evil' } },
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0].code).toBe('PROTO_KEY_BANNED');
    }
  });

  it('单键值超字节上限（PATCH_TOO_LARGE）', () => {
    const violations = validateWriteBatch([
      { op: 'writeNodeData', nodeId: 'n1', patch: { resultUrl: 'x'.repeat(MAX_WRITE_BATCH_BYTES + 1) } },
    ]);
    expect(violations.some((v) => v.code === 'PATCH_TOO_LARGE')).toBe(true);
  });

  it('批总字节 Σ 超 256KB 上限（PATCH_TOO_LARGE——与 COLLAB_MAX_TX_BYTES 同源上限）', () => {
    // 单键均在 per-key 上限内、批 Σ 超阈：多 op 各驮 ~60KB 合法值
    const half = 'x'.repeat(60_000);
    const violations = validateWriteBatch(
      Array.from({ length: 6 }, (_, i) => ({
        op: 'writeNodeData' as const, nodeId: `n${i}`, patch: { resultUrl: half },
      })),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('PATCH_TOO_LARGE');
  });

  it('超 op 数上限（OP_COUNT_EXCEEDED）', () => {
    const violations = validateWriteBatch(
      Array.from({ length: MAX_WRITE_OPS_PER_BATCH + 1 }, () => ({ op: 'deleteExecOrphans' })),
    );
    expect(violations.some((v) => v.code === 'OP_COUNT_EXCEEDED')).toBe(true);
  });

  it('idempotent:false 的 op 被拒（Z148①——校验表层先拒，fillDoc 现行唯一非幂等 op）', () => {
    expect(DOC_WRITE_OPS.fillDoc.idempotent).toBe(false);
    const violations = validateWriteBatch([
      { op: 'fillDoc', nodes: [], edges: [] },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('NON_IDEMPOTENT_OP');
  });

  it('值域违规（writeExecStatus.attempts 非 number——VALUE_TYPE_MISMATCH）', () => {
    const violations = validateWriteBatch([
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'loading', attempts: '3' } },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('VALUE_TYPE_MISMATCH');
    expect(violations[0].key).toBe('attempts');
  });

  it('未知 op 拒绝（新增第七 op 未分类即红——UNKNOWN_OP）', () => {
    const violations = validateWriteBatch([{ op: 'someFutureOp' }]);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('UNKNOWN_OP');
  });

  it('fillDoc 节点 data 内原型链键同样拒绝（递归拒键面）', () => {
    const violations = validateWriteBatch([
      { op: 'fillDoc', nodes: [{ id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { ['__proto__']: 'evil' } }], edges: [] },
    ]);
    expect(violations.some((v) => v.code === 'PROTO_KEY_BANNED')).toBe(true);
  });

  it('fillDoc 记录键域越界拒绝（节点信封/边记录键白名单——UNKNOWN_KEY）', () => {
    const violations = validateWriteBatch([
      { op: 'fillDoc', nodes: [{ id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: {}, strayKey: 1 }], edges: [{ id: 'e1', source: 'a', target: 'b', extra: true }] },
    ]);
    // fillDoc 自身 idempotent:false 违规恒在（Z148①）+两个键域越界
    const keyViolations = violations.filter((v) => v.code === 'UNKNOWN_KEY');
    expect(keyViolations.map((v) => v.key)).toEqual(['strayKey', 'extra']);
  });

  it('violation 载荷携带 opName（T4 二轮 I 项——A1 日志裸读免按 index 反查 ops 数组）', () => {
    const keyViolations = validateWriteBatch([
      { op: 'writeNodeData', nodeId: 'n1', patch: { notARegisteredKey: 'x' } },
    ]);
    expect(keyViolations[0].opName).toBe('writeNodeData');
    const typeViolations = validateWriteBatch([
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'loading', attempts: '3' } },
    ]);
    expect(typeViolations[0].opName).toBe('writeExecStatus');
    // op 形态不可知（op 字段非法值）时 opName 仍带原值——日志可读
    const unknownOp = validateWriteBatch([{ op: 'someFutureOp' }]);
    expect(unknownOp[0].opName).toBe('someFutureOp');
    // 批级违规（index=-1）无 op 归属——opName 缺省
    const batchLevel = validateWriteBatch(
      Array.from({ length: MAX_WRITE_OPS_PER_BATCH + 1 }, () => ({ op: 'deleteExecOrphans' })),
    );
    expect(batchLevel.find((v) => v.code === 'OP_COUNT_EXCEEDED')?.opName).toBeUndefined();
  });

  it('空批=合法 no-op（零违规放行——T27 端点空批幂等重试安全）', () => {
    expect(validateWriteBatch([])).toEqual([]);
  });

  it('undefined 值零违规（Y0c T9·Z5 分流——校验面不执法：nodeData=进门 UNDEFINED_PATCH_VALUE fail-fast/exec=原语跳过；JSON wire 不可达故本表不裁决）', () => {
    // T8 现状：typeNameOf 把 undefined 归 'json' ⇒ VALUE_TYPE_MISMATCH 业务拒——Z5 两条语义
    // （throw 与跳过）在批面均被校验表拦死。T9 勘正：checkPatchEntry 对 undefined skip 早退。
    const violations = validateWriteBatch([
      { op: 'writeNodeData', nodeId: 'n1', patch: { resultUrl: undefined, fileId: 'm_1' } },
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1, reason: undefined } },
    ]);
    expect(violations).toEqual([]);
  });
});

describe('Y0c T4 manifest 结构完整性（E38 四层——编译断言的运行时面）', () => {
  it('六 op 词汇全分类（Record<DocWriteOpType,…> 穷尽——新增忘分类即 tsc 红）', () => {
    const expected: readonly DocWriteOpType[] = [
      'writeNodeData', 'writeExecStatus', 'deleteNodeDataKeys', 'deleteNodes', 'fillDoc', 'deleteExecOrphans',
    ];
    expect(Object.keys(DOC_WRITE_OPS).sort()).toEqual([...expected].sort());
    for (const spec of Object.values(DOC_WRITE_OPS)) {
      expect(typeof spec.idempotent).toBe('boolean'); // Z148① 列无缺省
    }
  });

  it('批总字节上限与 COLLAB_MAX_TX_BYTES 同源（262144——QUOTA_DEFAULTS.maxTxBytes）', () => {
    expect(MAX_WRITE_BATCH_BYTES).toBe(262_144);
    expect(MAX_WRITE_BATCH_BYTES).toBe(QUOTA_DEFAULTS.maxTxBytes);
  });

  it('值域覆盖 keys 全集（定义了 valueTypes 的 op——键集与值域表全等，T4 二轮 I-1）', () => {
    // 防漂移宗旨：checkPatchEntry 对 valueTypes 缺键静默跳过值域检查——「向键集加第 N 键
    // 忘配 valueTypes ⇒ 编译绿+测试全绿+运行时值域无约束」的洞由此断言封死。
    // writeNodeData 由 SERVER_NODE_DATA_KEYS 派生（Object.fromEntries）天然覆盖；
    // writeExecStatus 手写表是本断言的真实执法对象。
    for (const [opName, spec] of Object.entries(DOC_WRITE_OPS)) {
      if (!spec.valueTypes) continue;
      expect(
        Object.keys(spec.valueTypes).sort(),
        `op=${opName} valueTypes 与 keys 不全等——键集有键无值域=运行时静默放行`,
      ).toEqual([...spec.keys].sort());
    }
  });

  it('层①顶层 map 集合+层③④种子条目：四 map 全登记且 nodes/edges/exec 非空', () => {
    expect([...DOC_TOP_LEVEL_MAPS].sort()).toEqual(['edges', 'exec', 'meta', 'nodes']);
    for (const map of DOC_TOP_LEVEL_MAPS) {
      expect(DOC_KEY_MANIFEST[map], `种子条目缺 map=${map}`).toBeDefined();
    }
    expect(DOC_KEY_MANIFEST.nodes.length).toBeGreaterThan(0);
    expect(DOC_KEY_MANIFEST.edges.length).toBeGreaterThan(0);
    expect(DOC_KEY_MANIFEST.exec.length).toBeGreaterThan(0);
    // 层③每键写入者与读者/层④归属与撤销 scope 三字段无空洞
    for (const entries of Object.values(DOC_KEY_MANIFEST)) {
      for (const e of entries) {
        expect(e.writers.length).toBeGreaterThan(0);
        expect(e.readers.length).toBeGreaterThan(0);
        expect(e.ownership).toBeDefined();
        expect(e.undo).toBeDefined();
      }
    }
  });

  it('层②嵌套唯一创建者登记非空且逐条带创建点', () => {
    expect(NESTED_TYPE_CREATORS.length).toBeGreaterThan(0);
    for (const c of NESTED_TYPE_CREATORS) {
      expect(c.container).toBeTruthy();
      expect(c.creators.length).toBeGreaterThan(0);
    }
  });
});
