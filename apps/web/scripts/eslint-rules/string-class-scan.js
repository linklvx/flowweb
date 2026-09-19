/**
 * 类名字符串扫描访客工厂（B5 自 no-color-hex 泛化，no-color-hex/no-theme-utility 共用）：
 *   - 拦截面 = 字符串字面量 + 模板字面量 quasi（与 no-color-hex A3 落地口径一致）；
 *   - 一个字符串含多个命中记 1 条（增量口径由 lint-gate.mjs 的 baseline/直判承担）；
 *   - 多行模板报错锚定命中所在 quasi 行（键 = 行文本 hash，改前导文本不重键）。
 */
const BOUNDARY = /(?:^|[\s"'`])/u;

/**
 * @param {RegExp} tokenRe 命中正则——须以 BOUNDARY 同款边界开头（吞掉 1 个前导边界字符）
 * @param {string} messageId 规则 messages 键
 * @returns {(context: import('eslint').Rule.RuleContext) => object} ESLint create() 访客
 */
export function createStringClassScanner(tokenRe, messageId) {
  return (context) => ({
    Literal(node) {
      if (typeof node.value === 'string' && tokenRe.test(node.value)) {
        context.report({ node, messageId });
      }
    },
    TemplateLiteral(node) {
      for (const quasi of node.quasis) {
        const text = quasi.value.cooked;
        if (!text) continue;
        const match = tokenRe.exec(text);
        if (!match) continue;
        // 锚命中所在行（多行模板报错行可见+改前导文本不重键）：quasi.loc.start 是起始反引号后一格
        // （首 quasi 时仍在反引号行），须按 cooked 内换行偏移换算命中实际行列——门禁键 = 行文本 hash。
        const coreIndex = match.index === 0 ? 0 : match.index + 1; // 跳过正则捕获的前导字符（可能是 \n）
        const beforeCore = text.slice(0, coreIndex);
        const linesBefore = beforeCore.split('\n');
        const line = quasi.loc.start.line + linesBefore.length - 1;
        const column =
          linesBefore.length === 1
            ? quasi.loc.start.column + beforeCore.length
            : beforeCore.length - (beforeCore.lastIndexOf('\n') + 1);
        const coreLength = match[0].length - (coreIndex - match.index);
        context.report({
          node,
          loc: {
            start: { line, column },
            end: { line, column: column + coreLength },
          },
          messageId,
        });
        return;
      }
    },
  });
}

export { BOUNDARY };
