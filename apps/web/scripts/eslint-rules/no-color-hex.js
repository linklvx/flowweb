/**
 * flowweb/no-color-hex —— 颜色前缀任意值 hex 禁令（CSS 立项唯一新规则，spec 2026-09-18-css-base-layer-theme §2.5/O3）
 *
 * 拦截面：字符串/模板字面量中出现颜色前缀任意值 hex——
 *   (bg|text|border|ring|divide|from|via|to|fill|stroke|placeholder|outline|shadow|accent|caret|decoration)-\[#…
 *   - `!` important 变体（!bg-[#…]）与变体前缀（hover:bg-[#…]）天然命中：均含 `前缀-[#` 子串；
 *     前缀前字符须为非「字母/数字/_/-」，防 `footext-[#` 类子串误报。
 * 明确不拦（O3 口径，防误报）：
 *   - rgba( / hsl( 字面量（`bg-[rgba(0,0,0,.5)]`）——0 hex ≠ 0 颜色字面量，已知接受；
 *   - `w-[#…]` 等非颜色前缀；`bg-[url(#fragment)]`（前缀后是 `u` 非 `#`）；`shadow-[0_0_10px_#fff]`；
 *   - style 对象字面量（`style={{color:'#fff'}}`）——字符串内容正则天然不触及，归 B2-2 逐处判定通道。
 * 违例报于所在字符串节点（一个字符串含多个 hex 类记 1 条；增量口径由 lint-gate.mjs 的 baseline 承担）。
 */
const COLOR_HEX_CLASS_RE =
  /(?:^|[^\p{L}\p{N}_-])(?:bg|text|border|ring|divide|from|via|to|fill|stroke|placeholder|outline|shadow|accent|caret|decoration)-\[#/u;

export const noColorHex = {
  meta: {
    type: 'problem',
    docs: {
      description:
        '颜色前缀任意值 hex 禁令——迁移至语义 token（spec 2026-09-18-css-base-layer-theme O3/B2）',
    },
    schema: [],
    messages: {
      hexForbidden:
        '颜色前缀任意值 hex 禁令——迁移至语义 token（spec 2026-09-18-css-base-layer-theme O3/B2）；新增违例如属未迁移存量请勿复制模式。',
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === 'string' && COLOR_HEX_CLASS_RE.test(node.value)) {
          context.report({ node, messageId: 'hexForbidden' });
        }
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          if (quasi.value.cooked && COLOR_HEX_CLASS_RE.test(quasi.value.cooked)) {
            context.report({ node, messageId: 'hexForbidden' });
            return;
          }
        }
      },
    };
  },
};

export default noColorHex;
