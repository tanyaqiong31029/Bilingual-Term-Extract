# Bilingual-Term-Extract

[![CI](https://github.com/tanyaqiong31029/Bilingual-Term-Extract/actions/workflows/ci.yml/badge.svg)](https://github.com/tanyaqiong31029/Bilingual-Term-Extract/actions/workflows/ci.yml)

从**双语平行文本**自动提取「源语-目标语」对照术语表的 agent 技能 + 零依赖 CLI。统计召回 + LLM 精筛的混合管线，产出可直接导入 **Trados MultiTerm / memoQ** 的 TBX 术语库。

> 灵感来自 CAT 工具（Trados MultiTerm、memoQ、OmegaT）的术语管理能力，方法论参考 TermSuite（C-value）、Termolator（统计+过滤）、bitext-lexind（词对齐→词条→过滤）与 Anymalign（共现对齐）。

## 功能

- **导入**：DOCX / TXT / Markdown（UTF-8、GBK、Big5 自动识别）、SRT/VTT 双语字幕、TMX 翻译记忆、预对齐句对 JSON
- **句对齐**：Gale-Church 统计对齐（数字锚点 + 段落锚定 + 滑窗分块），20 语种
- **候选术语**（统计召回）：拉丁 n-gram + 软化 C-value 嵌套折扣 + 专名大写加权；中文 n-gram + PMI 内凝度 + 邻接熵
- **统计译文**：句级 Dice 共现关联 + 连续段打分 + 两轮共识投票（不依赖任何外部模型/API）
- **LLM 精筛**：由 agent 技能承载——判定真伪术语、确认/修正译文、标注词性/领域/置信度
- **导出**：TBX（MultiTerm/memoQ 兼容）、CSV（Excel BOM）、JSON、Markdown，附审校报告
- **质量保障**：81 项无头回归测试 + 金标准基准（EN↔ZH 各 16 术语对：召回 100%、统计译文 top-3 75%）

## 快速开始

### 作为 agent 技能（推荐）

把仓库放入技能目录（ZCode/Claude Code 等 agent 环境）：

```bash
git clone https://github.com/tanyaqiong31029/Bilingual-Term-Extract.git \
  ~/.agents/skills/bilingual-term-extract
```

之后对 agent 说「**帮我从这两份文档提取双语术语表**」即可——agent 会执行统计阶段、逐条精筛、导出 TBX/CSV。工作流见 [SKILL.md](SKILL.md)。

### 作为 CLI（手动两段式）

```bash
# ① 统计阶段：双语文档 → 候选术语 + 统计译文
node scripts/term_extract.js candidates \
  --src manual-en.docx --tgt manual-zh.txt \
  --out output --name demo

# ② LLM 精筛：编辑 decisions.json（schema 见 SKILL.md）后校验
node scripts/validate.js decisions.json output/demo_candidates.json

# ③ 定稿导出：terms.tbx / terms.csv / terms.json / terms.md
node scripts/finalize.js --candidates output/demo_candidates.json \
  --decisions decisions.json --out output
```

输入也可以是 TMX：`--tmx memory.tmx --src-lang en --tgt-lang zh-CN`。

## 工作原理

```
双语文档 → ① 导入解析 → ② 句对齐(Gale-Church, 仅取1-1)
        → ③ 候选术语(n-gram + C-value + PMI) → ④ 统计译文(Dice 共现投票)
        → ⑤ LLM 精筛(判定真伪/修正译文/置信度) → ⑥ 定稿导出(TBX/CSV/JSON/MD)
```

**分工原则：统计负责召回，LLM 负责精度。** 统计阶段高召回（基准召回 100%），把「是不是术语」「译文对不对」这两个语义判断交给 LLM——这正是当前各类大模型最擅长、而传统统计方法最薄弱的环节。置信度分级把人工复核量压缩到低置信条目。

算法细节（公式、参数与踩坑记录）：[references/architecture.md](references/architecture.md) · 操作规范：[SKILL.md](SKILL.md)

## 输出示例

| 源语术语 (en) | 目标语术语 (zh-CN) | 置信度 | 频次 | 状态 |
|---|---|---|---|---|
| edge computing | 边缘计算 | 0.95 | 3 | confirmed |
| machine learning | 机器学习 | 0.90 | 2 | confirmed |
| gateway | 网关 | 1.0 | 6 | auto |

## 开发与测试

```bash
node tests/pipeline_test.js        # 无头回归（81 断言，~1s）
node benchmark/run_benchmark.js    # 金标准基准（--verbose 逐术语核对）
```

要求 Node ≥ 18，零第三方依赖。

## 项目结构

```
SKILL.md            agent 技能规范（工作流 / decisions schema / 红线）
scripts/            CLI + 核心算法模块（core/）
tests/              无头回归
benchmark/          金标准基准 + 自创 EN↔ZH 平行样例
references/         架构与算法参考
```

## 致谢

- [multi-align](https://github.com/tanyaqiong31029/multi-align)（同作者）：分句器与 Gale-Church 对齐器适配自此项目
- [TermSuite](https://github.com/termsuite/termsuite-core)：C-value 与术语变体思想
- [The Termolator](https://github.com/AdamMeyers/The_Termolator)：统计召回 + 知识过滤的混合思路
- [bitext-lexind](https://github.com/facebookresearch/bitext-lexind)（Meta）：词对齐→词条→过滤的管线范式
- [Anymalign](https://github.com/pombredanne/anymalign)：共现子树对齐的启发

## License

[MIT](LICENSE) © 2026 tanyaqiong31029
