// packages/shared/src/canvas/canvas-invariants.ts
// Y0c T4（E68 不变量登记表——形态冻结+逐条现状核对，R0c-5 勘正口径）：登记表非执法器——
// 新增不变量执法不在本批，缺口项移交 Y1c-3 落地。每条三列=判据/读侧行为/写侧行为+现状标注。
// 结构完整性编译断言：Record<CanvasInvariantId,…> 穷尽（缺条即 tsc 红）+三列必填（运行时面
// =canvas-invariants.test.ts）。
// 现状锚注纪律：引语义锚（函数/机制名）不引行号（Z 行纪律⑤同源——行号随重构漂移）。

/** 不变量 id（五条——E68 原文序）。 */
export type CanvasInvariantId =
  | 'parentExistsAcyclic'
  | 'edgeEndpointsExist'
  | 'storyboardRefExists'
  | 'clipSourceNodeExists'
  | 'execWithoutNodeVoid';

/** 现状标注三态：enforced=已有执法点 / partial=部分覆盖（写侧或读侧单边） / gap=无守卫（缺口）。 */
export type InvariantStatus = 'enforced' | 'partial' | 'gap';

export interface CanvasInvariantEntry {
  /** 判据 */
  criterion: string;
  /** 读侧行为（现状） */
  readSide: string;
  /** 写侧行为（现状） */
  writeSide: string;
  /** 现状标注 */
  status: InvariantStatus;
  /** 现状锚注：已有执法点/缺口/移交标注 */
  anchors: string;
}

/** 铁律（E68 原文——对全部五条生效，违反即机制设计错误非实现 bug）。 */
export const CANVAS_INVARIANT_IRON_RULES: readonly string[] = [
  '读侧全函数——投影对任意 doc 形态绝不抛（E68/E68 读侧兜底同源）',
  '写侧显式拒绝——业务错误码，禁丢帧禁静默跳过',
  '禁修复写回 doc——读侧发现违例只报不修（DEV 断言报错而非被静默修好）',
];

/** 五条不变量登记（现状核对 2026-10-14——Y0c T4 plan 期核对落地）。 */
export const CANVAS_INVARIANTS: Record<CanvasInvariantId, CanvasInvariantEntry> = {
  parentExistsAcyclic: {
    criterion: '节点 parentId（在时）指向存在的节点，且父链无环',
    readSide: '全函数不抛：readRecordsFromMaps/toDocRecords 对悬空 parentId 原样保留输出（无父上下文的孤儿原样透传——docShape 翻转层「无 origin 可加，禁 undefined/NaN 发射」）；validateParentGraph 悬空 parentId 跳过（byId.has 守卫）',
    writeSide: '环=显式拒绝：执行入口 topology.sort 后长度比对不等即 throw BusinessException(CYCLE,4xx)（execution.service——B8 勘正：Kahn 静默丢环前提不成立）；validateParentGraph 三色 DFS 报 cycle violation（clone 档 fatal）；groupNodes/addToGroup membership 变更点走意图漏斗（客户端面 cs 校验前置）',
    status: 'enforced',
    anchors: '执法点=execution.service（CYCLE 拒）+shared validateParentGraph（三色 DFS）；悬空 parentId 写侧无独立服务端守卫（客户端意图面构造纪律保证）——缺口移交 Y1c-3 裁度',
  },
  edgeEndpointsExist: {
    criterion: '边 source/target（在时）指向存在的节点',
    readSide: '全函数不抛：readRecordsFromMaps 原样返回（缺 source/target 读出 undefined 由写侧守卫契约兜——fillDoc 缺写 \'\'）；投影对悬空边不滤不抛',
    writeSide: '客户端意图面级联收敛：canvasIntents deleteNode 同批删全部引用边（孤儿边不残留）；upsertEdge/fillDoc 无端点存在性校验（服务端写面无守卫——现状勘注）',
    status: 'partial',
    anchors: '已有=客户端删除路径级联删边（canvasIntents）；缺口=服务端边写无端点校验（fillDoc/upsertEdge 面）——移交 Y1c-3 落地写侧显式拒绝',
  },
  storyboardRefExists: {
    criterion: '分镜成员关系合法：parentId 指向 storyboard 组的子节点引用存在且组形态一致（groupType=storyboard）',
    readSide: '全函数不抛：toDocRecords 组帧 origin 表缺组时子节点原样输出（无 origin 可加）；键集表全量预扫对遍历序免疫（storyboardGroupIds——人为构造序不误判）；assertStoryboardChildNoPosition/assertStoryboardMembership DEV 断言读侧挂点（违例报错不修）',
    writeSide: 'membership 变更点=剥键写者：convertGroup/addToGroup/dropImageIntoStoryboard 的 doc 面 move intent 落「分镜子无 position」（canvasIntents moveNode 分镜判定）；组建批（mergeStoryboard 组+子）同意图序列原子',
    status: 'partial',
    anchors: '已有=写侧 membership 变更点剥键纪律+读侧 DEV 断言族（assertions.ts——applyDocToStore 尾挂）；缺口=服务端写面（writeNodeData 对组 data 无 storyboard 形态守卫）——移交 Y1c-3 裁度',
  },
  clipSourceNodeExists: {
    criterion: '时间轴 clip.sourceNodeId（在时）指向存在的画布节点（video-project ProjectData 域）',
    readSide: '全函数不抛：sourceNodeId 类型层可选（VideoClip/ImageClip/AudioClip 三类可选键——缺省=无源引用合法档）；导出/播放面按 mediaId 消费，悬挂 sourceNodeId 不参与渲染路径',
    writeSide: '客户端级联清理（best-effort）：节点删除时 deleteProjectByNode 显式清理源引用（canvasStore——.catch 吞错不阻塞删除主流程）；建面=upsert by sourceNodeId 幂等（videoProjectApi 防双击）；无存在性守卫（悬挂引用可产生——best-effort 清理失败窗内）',
    status: 'partial',
    anchors: '已有=客户端删除级联清理（best-effort）+建面幂等；缺口=清理失败窗悬挂引用无服务端守卫——移交 Y1c-3 裁度（服务端 FK 类校验或读侧清扫）',
  },
  execWithoutNodeVoid: {
    criterion: 'exec 条目无对应 node 时视同不存在（读侧兜底语义——E22 已裁）',
    readSide: 'E22 读侧兜底：web exec 投影按节点存在性消费（execStatusView 合并视图按 nodeId 取用——节点已删条目自然失活）；Z75 边界声明「exec=done∧节点已删=合法终态」由本条兜底（禁加 done 前检查 node 跨 op 补丁）',
    writeSide: 'Z4 守卫（本批 A1 T11 闭环落点——现状标注）：writeExecStatus 节点不存在⇒不建条目+exec_orphan_blocked_total 计数（Z69 减法形态——签名不变）；存量孤儿=sweepOrphanExec 每日游标轮转清扫兜底（Z56）；writeNodeData 已有同型守卫（written:false,reason=node-deleted——Z44）',
    status: 'partial',
    anchors: '读侧=E22 已裁（Z75 引用）；写侧守卫=A1 T11 闭环（本批登记非执法——闭环后本条转 enforced）；sweepOrphanExec 维持兜底',
  },
};
