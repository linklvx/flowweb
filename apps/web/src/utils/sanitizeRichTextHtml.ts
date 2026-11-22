// apps/web/src/utils/sanitizeRichTextHtml.ts
// Y4b Task 5（D10）：两渲染点富文本兜底消毒单源出口——TextInputNode.tsx:199 /
// PromptInput.tsx:499 的 dangerouslySetInnerHTML 回退 HTML 渲染前统一过本函数。
// 回退 HTML=richTextOfFragment 产物（doc-codec nodeHtmlOf：paragraph 收成 <p>、image 收成
// <img>、其余元素名原样当标签）——白名单按 codec 真输出配置（spec §0 条 8）：标签名/属性名
// 全小写（DOMPurify HTML 解析收小写，与 jsdom 同）；无 a/href（codec 不产）。
// 正常路径编辑器走 ProseMirror 不经此 HTML——本函数只兜 XmlFragment 缺失的只读回退档。
import DOMPurify from 'dompurify';

/** D10 兜底消毒（两渲染点共用唯一出口+一份配置）。 */
export function sanitizeRichTextHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'img', 'span', 'heading', 'blockquote', 'bulletlist', 'orderedlist', 'listitem', 'codeblock', 'horizontalrule', 'hardbreak', 'command', 'imagemention'],
    ALLOWED_ATTR: ['src', 'alt', 'title', 'class', 'level', 'language', 'start', 'type', 'id', 'label', 'mentionsuggestionchar'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'script'],
    FORBID_ATTR: ['style'],
  });
}
