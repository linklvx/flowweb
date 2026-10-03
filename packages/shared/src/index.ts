export { type ContentCard } from './types/models';
export { NavActionKey } from './types/nav';
export * from './types/material-library';
export * from './types/lighting.types';
export * from './types/angle3d.types';
export * from './types/subscription.types';
export { SubscriptionError } from './constants/subscription-error';
export type { SubscriptionErrorCode } from './constants/subscription-error';
export { CollabAuthReason, isTerminalReason } from './constants/collab-auth-reason';
export type { CollabAuthReasonCode } from './constants/collab-auth-reason';
export * from './types/home.types';
export * from './types/role.types';
export * from './types/video-project';
export * from './types/video-work';
export * from './types/group';
export * from './types/stitch';
export * from './canvas/nodeEnvelope';
// O0a-1（Spec B）：docShape 出口接入——doc 读写单源（fillDoc/readRecordsFromMaps/applyRecordToYMap/
// stripDerivedKeys）+ C0-1 类型骨架出口随本分片落地（census 守卫使命完成拆除）。
export * from './canvas/docShape';
// C0-2（Spec B）：geometryWriterRegistry=纯常量零依赖（写者类别+归类账本）——
// geometryTrap 写者上下文校验与 B7-1 census 引用源。assertions/C0-1 类型骨架 stub 出口仍归 O0a。
export * from './canvas/geometryWriterRegistry';
export * from './canvas/geometry';
export * from './canvas/storyboardConfig';
// O0c-3（终裁 88②）：展开帧单源模块整删——toggleCollapse 展开档消费已随 O0b-5 单意图化消失，
// 折叠恢复唯一来源=doc 帧三键密封（reconcile 写域①）/auto 重派生 bbox。
export * from './canvas/validateParentGraph';
export * from './canvas/arrangeSelection';
export * from './canvas/copyPlan';
// O0c-2（Spec B）：第 4 渲染面唯一写者——records(abs)→RenderNode(rel+派生帧)（ProcessSnapshot/分享）。
export * from './canvas/renderCanvas';
// O0b-2（Spec B）：assertions 出口接入——六条模型断言+membership 写侧断言真实实现（C0-2 骨架
// O0b-1 转实），web 侧 applyDocToStore 尾挂消费（assertDocAbsMatchesCsRel/assertStoryboardMembership）。
export * from './canvas/assertions';
// B6-1（Spec B）：handle 可用性单源谓词——imageGen/imageExtGen 编辑中（含 transformMode）双侧无，
// videoGen 现状保留无门双侧；web 节点组件消费（删组件内 !editMode 直判）。
export * from './canvas/handles';
