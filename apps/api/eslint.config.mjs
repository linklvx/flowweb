/**
 * api eslint 从零建（批0e-3）：B3 门禁（connStatus/getMap/setState 类 AST 断言在 web 侧 lint-gate 的
 * api 对应物）/B6 的载体。规则底座 = js.recommended + tseslint.recommended（非 type-aware——
 * api 无 tsconfig projectService 全覆盖诉求，先建底座再收紧）。
 *
 * B3 门禁最小规则占位：批 0.5 三模块 claim 接线范式稳定后，在此以 no-restricted-syntax 升级为
 * AST 精确断言（如 collab 恢复路径的写点收口）。当前刻意不挂实际规则——避免在接线范式未定时误报。
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['{src,test}/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // 仓内 any 密度高——先建底座再收紧（B3 门禁 AST 规则的载体）
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // no-undef 在 TS 文件大量误报（类型导入/全局类型）——TS 编译器（tsc --noEmit）已覆盖未定义标识符
      'no-undef': 'off',
    },
  },
);
