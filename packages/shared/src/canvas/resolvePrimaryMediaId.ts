// packages/shared/src/canvas/resolvePrimaryMediaId.ts
// Y2 B2a（spec D8/plan v6 裁决 5 改死五）：主媒体身份解析单源——
//   data.mediaId 非空 → 作者键；否则运行时产物 artifact.mediaId；都空 → 空（''）；
//   唯一类型分支=multiImageGen 无产物时回落 images[mainImageIndex]?.id（图库直读非槽位裁决、
//   入参吃 plain 数组、-1/越界天然回落空；B4 后多图主图首次可当上游源=意图内裁定）。
// 消费面：projectCanvas 读点切换（B3）与 author-slot 服务端腿（B2a 装意图行核对）——禁双侧各写漂移。
// 入参 plain 形态（零 Yjs 依赖——doc 读模型/投影源各自适配后传入）。

/** 节点 plain 形态（读模型/投影共同子集——type+data 两键即判据面）。 */
export interface PrimaryMediaNode {
  type: string;
  data: Record<string, unknown>;
}

/** 主媒体身份解析：作者键（data.mediaId）→ 产物（artifactMediaId）→ multiImageGen 图库回落 → ''。 */
export function resolvePrimaryMediaId(node: PrimaryMediaNode, artifactMediaId: string | null | undefined): string {
  const author = node.data.mediaId;
  if (typeof author === 'string' && author !== '') return author;
  if (typeof artifactMediaId === 'string' && artifactMediaId !== '') return artifactMediaId;
  if (node.type === 'multiImageGen') {
    const idx = node.data.mainImageIndex;
    if (typeof idx === 'number' && Number.isInteger(idx) && idx >= 0) {
      const images = node.data.images;
      if (Array.isArray(images)) {
        const item = images[idx] as { id?: unknown } | null | undefined;
        const id = item && typeof item === 'object' ? item.id : undefined;
        if (typeof id === 'string' && id !== '') return id;
      }
    }
  }
  return '';
}
