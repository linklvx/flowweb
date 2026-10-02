// packages/shared/src/canvas/brands.ts
// C0-1 字段级品牌（Spec B）：品牌打在坐标 number 上——AbsPos/RelPos 由 AbsCoord/RelCoord 组成。
// 数组品牌 AbsRecords/RelRecords（泛型 readonly 数组包装）供 copyPlan 族/投影族签名用。
// 纯类型文件，零运行时代码。
/** 绝对坐标（画布全局空间）。 */
export type AbsCoord = number & { readonly __coordSpace: 'abs' };
/** 相对坐标（组内局部空间）。 */
export type RelCoord = number & { readonly __coordSpace: 'rel' };

/** 绝对位置。 */
export type AbsPos = { x: AbsCoord; y: AbsCoord };
/** 相对位置。 */
export type RelPos = { x: RelCoord; y: RelCoord };

/** 绝对空间记录数组品牌。语义约定：元素 position 空间为 abs（本类型不校验元素空间——类型层强制由后续分片的签名约束承担）。 */
export type AbsRecords<T extends { position: unknown }> = readonly T[] & { readonly __recordsSpace: 'abs' };
/** 相对空间记录数组品牌。语义约定：元素 position 空间为 rel（本类型不校验元素空间——类型层强制由后续分片的签名约束承担）。 */
export type RelRecords<T extends { position: unknown }> = readonly T[] & { readonly __recordsSpace: 'rel' };
