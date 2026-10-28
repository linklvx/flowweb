// packages/shared/src/collab/read-model-census.ts
// Y1c T5c（plan v1.7 Task 5 客户端/恢复段——plan T19）：read-model-census.json 形态类型冻结。
// **CONTRACT-FREEZE**——本卡只冻形态（id/file/fields/test 锚+shape hash+27 fixture）；**27 fixture
// 由 T19 填充**（形态校验器先行——T19 写入前自检，fixture 数量门=T19 侧断言 entries 总数）。
// shapeHash 纪律=canonicalPlanHashPayload 同款（execution-request.ts:80 先例）：shared 无 crypto
// 且需 web 同构——本文件只冻 canonical payload 纯函数，**sha256hex 调用点归 T19**。
// 契约测试=read-model-census.spec.ts（TDD 红先行）。

/** census 落盘文件名（T19 产出物——docs/superpowers/census/ 域）。 */
export const READ_MODEL_CENSUS_FILENAME = 'read-model-census.json' as const;

/** fixture 计数冻结（plan T19 卡：27 fixture——T19 填充达成；本常量=T19 侧数量门的单源）。
 *  T25b 微批 C-1：+1（api-canvas-read-user-face——B 场景裁定 current 侧用户面读端点）→28。
 *  Y1c T27：+1（api-maintenance-export——维护 EXPORTING/VERIFYING records 真值读面）→29。 */
export const READ_MODEL_CENSUS_FIXTURE_COUNT = 29 as const;

/** 单条 census 条目（读模型读者面登记——id/file/fields/test 锚+shape hash+fixtures）。 */
export interface ReadModelCensusEntry {
  /** 条目标识（稳定——census 内唯一） */
  id: string;
  /** 读者所在文件（仓相对路径） */
  file: string;
  /** 读模型消费字段面（读侧字段清单——shape hash 输入） */
  fields: readonly string[];
  /** 测试锚（锁定该读者的既有测试文件——census 可验证性载体） */
  testAnchor: string;
  /** sha256hex(canonicalReadModelShapePayload(...))——64hex；计算点归 T19 */
  shapeHash: string;
  /** fixture 引用清单（语料锚——T19 的 27 fixture 按 id 引用） */
  fixtures: readonly string[];
}

/** shapeHash 的 canonical payload（纯函数——**不含 sha256**：fields 排序归一+id/file/testAnchor
 *  逐字；JSON 元组序列化保证跨端字节稳定。同形状同输出、字段序漂移不变形——canonicalPlanHashPayload
 *  同款纪律）。 */
export function canonicalReadModelShapePayload(
  entry: Pick<ReadModelCensusEntry, 'id' | 'file' | 'fields' | 'testAnchor'>,
): string {
  return JSON.stringify([entry.id, entry.file, [...entry.fields].sort(), entry.testAnchor]);
}

/** 形态校验器（纯函数——T19 写入前自检；返回问题清单空=通过）：
 *  - id/file/testAnchor 非空字符串；
 *  - fields 非空（读模型读者至少消费一字段）；
 *  - shapeHash=64 位小写 hex（sha256hex 形态）；
 *  - fixtures 非空数组（每条目至少锚一个语料——27 fixture 的分配面）。 */
export function validateReadModelCensusEntry(entry: ReadModelCensusEntry): string[] {
  const problems: string[] = [];
  if (typeof entry.id !== 'string' || entry.id.length === 0) problems.push('id 必须为非空字符串');
  if (typeof entry.file !== 'string' || entry.file.length === 0) problems.push('file 必须为非空字符串（仓相对路径）');
  if (!Array.isArray(entry.fields) || entry.fields.length === 0) problems.push('fields 必须为非空数组（至少消费一字段）');
  if (typeof entry.testAnchor !== 'string' || entry.testAnchor.length === 0) problems.push('testAnchor 必须为非空字符串（测试锚）');
  if (typeof entry.shapeHash !== 'string' || !/^[0-9a-f]{64}$/.test(entry.shapeHash)) problems.push('shapeHash 必须为 64 位小写 hex（sha256hex）');
  if (!Array.isArray(entry.fixtures) || entry.fixtures.length === 0) problems.push('fixtures 必须为非空数组（至少锚一个语料）');
  return problems;
}
