// apps/web/src/pages/canvas/components/nodes/textExtensions.ts
// Y1c T16：textInput content 域 Tiptap extensions 单源 builder（prompt-input/extensions.ts
// 同族纪律——TextInputNode 与 collab/xmlSchemaParity.spec import 同一 builder，schema 面
// （StarterKit heading{1,2,3} 全启用+四 mark）单源漂移即红）。**history:false**——单
// UndoManager 纪律（spec §3.3/v5-10：Tiptap 自带 history 与 ySyncPlugin 冲突〔本地栈 undo
// PM 态而 Y 态分化〕；撤销走画布级单 manager——canvasUndo trackedOrigins+S3 addTrackedOrigin）。
// 注：@tiptap/core 非本包直接依赖（pnpm 严格面）——类型一律经 @tiptap/react 重导出面引入。
import StarterKit from '@tiptap/starter-kit';

/** textInput content 域 extensions（Tiptap 正文——heading levels 与 TextInputNode 产品面一致：
 *  h1-h3+bold/italic/strike/code mark+列表/引用/代码块/分割线/硬换行）。 */
export function buildTextContentSchemaExtensions(): ReturnType<typeof StarterKit.configure>[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      history: false,   // 单 UndoManager（Y1c T16——画布级 manager 收编编辑器撤销）
    }),
  ];
}
