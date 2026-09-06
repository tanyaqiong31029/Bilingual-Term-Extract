/**
 * Conventional Commits 校验规则。
 * 本地：husky commit-msg 钩子调用；云端：CI 的 commitlint job 复用同一份配置。
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [2, "always", 100],
  },
  // Dependabot 的提交 body 带长链接，body-max-line-length 必然超限——整体豁免（官方推荐做法）
  ignores: [(commit) => commit.includes("Bumps")],
};
