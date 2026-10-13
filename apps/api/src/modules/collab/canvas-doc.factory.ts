// Y0c T3（B9 v2/Z57）：api 生产面 Y.Doc 构造单源工厂——census 组⑯执法载体（白名单=本文件
// +gate-canvas-state.ts〔Z57 豁免：非生产，仅 gate-seed/spec 消费〕）。现状 6 处 new Y.Doc()
// 全部无参构造（gc=true 默认），工厂保持同语义零行为变化；Server 级 yDocOptions{gc:true,
// gcFilter:()=>true}（collab.gateway 装载 options）只覆盖 Hocuspocus 托管 doc，独立 doc
// （scratch 影子预演/vacuum 真空/seed 种子/compact 重放/快照解码）不受其管辖。
import * as Y from 'yjs';

export function createCanvasDoc(): Y.Doc {
  return new Y.Doc();
}
