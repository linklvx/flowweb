// packages/shared/src/canvas/promptText.ts
// Y1c T2（bug② 后半）：节点 data prompt 文本解析单源——执行读点（execution.service nodeClaimPack）
// 唯一入口。改前 :512 `data?.prompt?.text || data?.content || ''` 对 textInput 的 string 形态
// （TextConfigPanel:211 每键击落 doc 的 `data.prompt:string`——nodeStore TextNodeData）恒 miss，
// 面板 prompt 执行链断供（独占依赖 :157 覆盖写——本卡删除）。
// Y1c T15（同卡再改）：三域载体已迁 Yjs 原生类型——audioGen/multiImageGen.prompt=Y.Text、
// textInput.prompt=Y.Map{text:Y.Text}（imageGen/videoGen/imageExtGen.prompt=PromptValue JSON，
// T16 迁 XmlFragment）。读模型（doc-codec.toReadModel 解码）后形态：audioGen/multiImageGen=
// string、textInput={text:string}——本函数两腿对号（string 直读 / .text 取内层），实现无需改，
// 注释与单测随卡收敛；执行读点（:512 调用 resolvePromptText）永不再改。
// Y1c T16（本卡）：content/prompt 四键迁 XmlFragment（textInput.content+三域 prompt）——读模型
// 形态=RichTextValue{text,html,json}（.text 腿天然对号）；textInput.content 裸正文回落腿补
// {text} 形态（string 直读腿保留=测试/回灌兼容面）——实现两行收敛，执行读点仍零改动。

/** prompt 解析输入形态（node data 的 prompt/content 两键——跨端窄化面，宽松入参）：
 *  - audioGen/multiImageGen：`prompt:string`（Y.Text 域读模型——T15 迁移后）；
 *  - textInput：`prompt?:{text:string}`（Y.Map{text:Y.Text} 域读模型——T15 迁移后）
 *    + `content?:string|{text:string}`（正文=XmlFragment 域读模型 RichTextValue{T16 迁}——
 *      裸 textInput 执行正文取 .text）；
 *  - imageGen/imageExtGen/videoGen：`prompt?:{text:string,...}`（XmlFragment 域读模型
 *    RichTextValue{text,html,json}——PromptValue 三出口同形基座，T16 迁）。 */
export interface PromptTextSource {
  prompt?: string | { text?: string } | null;
  content?: string | { text?: string } | null;
}

/** 节点 data → 执行 prompt 文本单源（Y1c T2；T15/T16 形态注见文件头）：
 *  string 形态直读（audioGen/multiImageGen Y.Text 域）> {text} 形态取 .text（textInput Y.Map 域
 *  /RichTextValue 同形）> content 回落（无 prompt 的 textInput 裸正文——string 直读/RichTextValue
 *  取 .text〔T16〕）> 空串。?? 链：{text:''}（面板清空——D28）即空串不回落 content（空=用户明确
 *  清空；上游注入优先级在调用方 || 链——topology textContents 先于本函数，B21 语义不变）。 */
export function resolvePromptText(data?: PromptTextSource | null): string {
  if (typeof data?.prompt === 'string') return data.prompt;
  const promptText = data?.prompt?.text;
  if (typeof promptText === 'string') return promptText;
  const content = data?.content;
  if (typeof content === 'string') return content;
  return content?.text ?? '';
}
