import js from "@eslint/js";
import globals from "globals";

/**
 * ESLint flat config（宽松 recommended 档）。
 * 本仓库为 CommonJS 的 Node CLI 脚本（零第三方依赖），因此：
 *  - sourceType: "commonjs"（识别 require/module/exports）
 *  - globals: node（process/console/Buffer 等）
 * 与 lint-staged、CI 的 lint job 共用同一份配置。
 */
export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/.husky/_/**",
      "output/**",
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // 宽松档：不引入风格类规则，只保留正确性规则（recommended 默认集）。
      // caughtErrors: "none" —— 保留惯用的 `catch (e) { /* 继续 */ }` 容错写法，
      // 改名反而徒增噪音；其余未用变量仍报错（`_` 前缀豁免）。
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
    },
  },
  {
    // 本配置文件自身及 future ESM 工具脚本
    files: ["**/*.mjs"],
    languageOptions: {
      sourceType: "module",
    },
  },
];
