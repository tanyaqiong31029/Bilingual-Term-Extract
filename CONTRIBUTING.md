# 贡献指南

感谢关注 Bilingual-Term-Extract。这是一个零第三方运行时依赖的 Node.js CLI + agent 技能，贡献前请先读 [AGENTS.md](AGENTS.md)（AI 协作规范，对人类贡献者同样适用）与 [SKILL.md](SKILL.md)。

## 开发环境

- Node.js ≥ 18（CI 用 20）
- 无需全局安装任何东西：`npm ci` 只装 devDependencies（eslint / husky / commitlint / lint-staged）

```bash
npm ci                            # 安装开发依赖
npx eslint .                      # lint（必须 0 问题）
node tests/pipeline_test.js       # 无头回归（115 项断言），必须全过
node benchmark/run_benchmark.js   # 金标准基准（EN↔ZH 双向），必须全过
```

## 提交规范

- **Conventional Commits**：`<type>(<scope>)?: <subject>`，husky 的 commit-msg 钩子（commitlint）强制校验；
- pre-commit 钩子 = lint-staged（eslint --fix）+ pre-commit 框架（卫生 + gitleaks）；钩子改了文件 → `git add -u` 重新提交；**禁止 --no-verify**；
- lint 级修复与功能改动分开提交。

## 改动须知

- **零运行时依赖**是本项目的核心性质：新增依赖仅限 devDependencies，且需说明理由；
- `package.json` **不加 `"type": "module"`**——全部脚本是 CommonJS；
- 改动算法（`scripts/core/candidates.js` / `vote.js`）或停用词表后：
  1. `node tests/pipeline_test.js` 全绿；
  2. `node benchmark/run_benchmark.js --verbose` 逐术语核对，阈值只许在质量实质提升后上调，**禁止为过线改基准数据**；
- `SKILL.md` 是技能行为定义：结构性改动需同步 `references/architecture.md`，并在 PR 中说明；
- 新增导入格式 / 导出格式：补对应回归断言 + 端到端用例（参考 tests 里的 TMX/SRT/DOCX 组）。

## 提交 PR

1. 从 main 拉分支（`feat/xxx` / `fix/xxx` / `docs/xxx`）；
2. 确保上述三命令全绿，CI（test / lint / security / gitleaks / commitlint）全过；
3. PR 描述写清动机、改动点与验证方式。
