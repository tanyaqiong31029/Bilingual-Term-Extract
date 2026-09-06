# AGENTS.md — AI 协作规范（Bilingual-Term-Extract）

本仓库是双语术语提取 Skill（源码仓库）。已接入工程化规范（husky + commitlint / eslint / pre-commit / gitleaks / CI）。AI agent 在本仓库工作时遵守以下约定。

## 项目概要
双语术语提取技能（零第三方运行时依赖 JavaScript，CommonJS）：`SKILL.md`（skill 指令）、`scripts/core/`（候选提取/分词/投票）、`scripts/`、`tests/pipeline_test.js`、`benchmark/`。

## 常用命令
```bash
npx eslint .                        # lint（0 问题）
node tests/pipeline_test.js         # 104 项流水线回归，必须全过
node benchmark/run_benchmark.js     # 基准测试，必须全过
uvx pre-commit run --all-files      # 提交前全量自检
```

## 提交规范
- 提交信息：Conventional Commits（`<type>(<scope>)?: <subject>`），husky commit-msg 钩子（commitlint）强制校验——历史提交不规范，**从现在起新提交必须合规**。
- pre-commit 钩子 = lint-staged + pre-commit 框架（卫生 + gitleaks）；钩子改了文件 → `git add -u` 重新提交；**禁止 --no-verify**。
- lint 级修复与功能改动分开提交。

## 行为红线
- **SKILL.md 的指令语义不得改动**（它是 skill 行为定义）。
- **package.json 不加 `"type": "module"`**：全部脚本为 CommonJS（`require()`），写了会全线崩。
- 零第三方运行时依赖，新增依赖仅限 devDependencies。
- eslint 按 CommonJS + node globals 配置（`**/*.mjs` 单独豁免为 module），新脚本遵循同款结构。
- 密钥（LLM 精筛用 API key）只走环境变量，绝不入库——gitleaks 会拦截。
