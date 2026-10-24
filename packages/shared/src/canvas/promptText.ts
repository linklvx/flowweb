// packages/shared/src/canvas/promptText.ts
// Y1c T2（bug② 后半）：节点 data prompt 文本解析单源——执行读点（execution.service nodeClaimPack）
// 唯一入口。改前 :512 `data?.prompt?.text || data?.content || ''` 对 textInput 的 string 形态
// （TextConfigPanel:211 每键击落 doc 的 `data.prompt:string`——nodeStore TextNodeData）恒 miss，
// 面板 prompt 执行链断供（独占依赖 :157 覆盖写——本卡删除）。T15 终形 prompt=Y.Map{text:Y.Text}
// 迁移时**只改本函数实现与单测**，执行读点永不再改。

/** prompt 解析输入形态（node data 的 prompt/content 两键——跨端窄化面，宽松入参）：
 *  - textInput：`prompt?:string` + `content:string`（正文=tiptap 正文/上游注入语义）；
 *  - imageGen/imageExtGen/videoGen：`prompt?:PromptValue`（{text,html,referencedImageIds}）；
 *  - audioGen：无 prompt 键，prompt 住 `content:string`（现状——T15 迁移时改本函数实现收编）。 */
export interface PromptTextSource {
  prompt?: string | { text?: string } | null;
  content?: string | null;
}

/** 节点 data → 执行 prompt 文本单源（Y1c T2）：
 *  string 形态直读 > PromptValue 形态取 .text > content 回落（audioGen 腿/无 prompt 的 textInput
 *  裸正文）> 空串。?? 链：PromptValue.text=''（面板清空——D28）即空串不回落 content（空=用户明确
 *  清空；上游注入优先级在调用方 || 链——topology textContents 先于本函数，B21 语义不变）。 */
export function resolvePromptText(data?: PromptTextSource | null): string {
  if (typeof data?.prompt === 'string') return data.prompt;
  return data?.prompt?.text ?? data?.content ?? '';
}
