---
name: bilingual-term-extract
description: 双语术语提取技能 — 从双语平行文本（DOCX/TXT/Markdown/SRT/TMX）自动提取源语-目标语对照术语表：统计召回（n-gram 候选 + C-value/PMI + Dice 共现投票）+ LLM 精筛 + 定稿导出 TBX（Trados MultiTerm/memoQ 兼容）/CSV/JSON/Markdown。当用户要求提取双语术语、建术语库、生成术语对照表、glossary、term extraction，或要求修改、扩展、修复、重建本工具——即使没提这个名字——都应使用本技能。
---

# Bilingual-Term-Extract：双语术语提取技能

从双语平行文本自动提取「源语-目标语」对照术语表。分工原则：**统计负责召回，LLM 负责精度**——脚本产出高召回的候选术语与统计译文，由你（agent）逐条判定真伪、确认/修正译文、标注词性与领域，最后定稿导出。

技能实例：`~/.agents/skills/bilingual-term-extract/`（下文 `<S>` 代指该目录）。源码仓库与本地工作副本可能并存，以用户指认为准。依赖：`node ≥ 18`，零第三方依赖。

## 立即执行：回归测试与基准（动手改代码之前和之后都要跑，约 3 秒）

```bash
node <S>/tests/pipeline_test.js          # 无头回归 81 项断言
node <S>/benchmark/run_benchmark.js      # 金标准基准（EN↔ZH 各 16 术语对）
node <S>/benchmark/run_benchmark.js --verbose   # 逐术语核对召回与译文命中
```

两者全绿才继续。改算法/调参数后必须 `--verbose` 逐条核对，防止「阈值达标但质量退化」。

## 核心流水线

```
双语文档 → ① 导入解析(DOCX/TXT/TMX, 编码识别) → ② 句对齐(Gale-Church, 仅取1-1)
        → ③ 候选术语(n-gram + C-value嵌套折扣 + 中文PMI内凝度)
        → ④ 统计译文(Dice共现投票 + 两轮共识) → ⑤ LLM 精筛(你来做) → ⑥ 定稿导出
```

## 工作流

### 第 0 步：确认输入

- 两个互为译文的单语文档（`--src` / `--tgt`，.txt/.md/.docx/.srt/.vtt），或 TMX 翻译记忆（`--tmx`），或预对齐句对 JSON（`--pairs`），或**单文件双语字幕**（`--src 字幕.srt --bilingual`）。
- 语言自动检测；检测失败或同语时报错，此时**请用户显式指明** `--src-lang` / `--tgt-lang`，不要猜。
- 用户没有现成双语文档时，说明本技能需要平行文本（同内容的两种语言版本），不要拿单语文档硬跑。

### 第 1 步：统计阶段（脚本）

```bash
cd <S>
node scripts/term_extract.js candidates --src 源语文档 --tgt 目标文档 \
     --out output --name 项目名          # 可选: --min-freq 2 --top 300 --src-lang en --tgt-lang zh-CN
```

产出 `output/<项目名>_candidates.json`（候选 + 统计译文 + 上下文例句）和 `_preview.md`（速览表）。控制台会打印句对数/候选数；**有效句对 < 3 直接报错**，3–4 个会放行但打 WARN——输入可能不是真平行文本，精筛时格外依赖上下文。

### 第 2 步：LLM 精筛（本技能的核心工作，由你完成）

读 `candidates.json`，**分批处理（每批 ≤ 50 条）**，逐条判定并写 `decisions.json`：

```json
[
  {"term": "edge computing", "accept": true,  "tgt": "边缘计算", "conf": 0.95, "pos": "noun", "domain": "边缘计算", "note": ""},
  {"term": "整个处理过程",     "accept": false, "note": "通用词组，非术语"}
]
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `term` | ✓ | 必须与 candidates.json 中的 `term` 一致（大小写/单复数按 norm 归一匹配） |
| `accept` | ✓ | false = 判定非术语，整条丢弃并记入 report.rejected |
| `tgt` | 建议 | 确认或修正后的译文；缺省沿用统计最优译文 |
| `conf` | 建议 | 0-1。≥0.6 confirmed；<0.6 落 review |
| `pos` / `domain` / `note` | 可选 | 词性（noun/verb/adj…）、领域、备注 |

判定规则（按序）：
1. **是否真术语**：领域专指性是核心。通用词组、日常动词短语、纯功能搭配 → `accept:false`。人名/地名/产品型号默认拒绝，除非用户说明需要收录。
2. **译文是否正确**：以 `contexts[].src/tgt` 例句为准。统计译文错误就修正；统计译文缺失（单句出现术语、`translations` 为空）时**从例句里找对应译文**；找不到确凿证据就不要给 `tgt`。
3. **拿不准宁可留痕**：`accept:true` + `conf ≤ 0.5`（落 review 供人工复核），**绝不编造译文**。
4. 词性/领域有把握才标，没把握留空。

写完先自检：**必须**运行

```bash
node scripts/validate.js decisions.json output/项目名_candidates.json
```

有 ERROR（未知术语 / accept 缺失 / conf 越界 / 重复）必须修复重跑直到「校验通过」，再进第 3 步。

### 第 3 步：定稿导出

```bash
node scripts/finalize.js --candidates output/项目名_candidates.json \
     --decisions decisions.json --out output [--name terms] \
     [--auto-conf 0.75] [--min-conf 0.6] [--include-review]
```

状态机：LLM accept → `confirmed`（conf ≥ 0.6）/ `review`（conf < 0.6）；未决定且统计 conf ≥ 0.75 → `auto`；其余 → `review`（默认**不导出**，`--include-review` 打开才导出）；accept:false → 丢弃（记入 report）。

产出 `terms.tbx`（导入 Trados MultiTerm / memoQ）、`terms.csv`（Excel 友好，UTF-8 BOM）、`terms.json`、`terms.md`、`terms_report.json`。

### 第 4 步：中文汇报

- 统计阶段：句对数、候选数、获得统计译文的候选数
- 精筛：接受 / 拒绝（列代表性词组）/ 留待复核条数
- 导出：confirmed / auto / review 计数，输出文件路径
- 术语表预览（top 10，Markdown 表）

## 核心约束（红线）

1. **不编造译文**——无上下文证据就不写 `tgt`。
2. **validate 有 ERROR 不准 finalize**。
3. **只通过 decisions.json 表达决策**，不得手改 candidates.json。
4. 大文档分批精筛，每批 ≤ 50 条，防遗漏防幻觉。
5. 术语表默认只导出 confirmed + auto；要含 review 必须显式 `--include-review` 并在汇报中说明。

## 常见任务

- **换语言对**：任何语言对皆可跑统计阶段；LLM 精筛按实际语言判定。中文单字停用表在 `scripts/core/stopwords.js`（刻意精简，勿随手加字——见文件头说明）。
- **双语音幕**：两个单语 `.srt/.vtt` 直接作 `--src/--tgt`；每条 cue 独立成段，段落锚定天然生效。**单文件双语字幕**（同 cue 双语行或交替 cue）用 `--bilingual` 自动拆分：
  ```bash
  node scripts/term_extract.js candidates --src 双语.srt --bilingual --src-lang en --out output
  ```
  `--src-lang` 指定术语源语侧；省略则默认以先出现的语言为源语（会告警）。两种语言须分属不同文字系统（en↔zh / en↔ru 可行；en↔fr 同为拉丁字母拆不了，请用 `--pairs`）。短字幕记得 `--min-freq 1`，且统计译文大概率留白（dfT=1），精筛时从上下文补。
- **调召回**：`--min-freq`（默认 2）降为 1 可召回低频术语，但噪声激增，LLM 精筛量翻倍。
- **调召回**：`--min-freq`（默认 2）降为 1 可召回低频术语，但噪声激增，LLM 精筛量翻倍。
- **已有术语库**：把已有术语表转成 decisions.json（accept:true + tgt）可在精筛时保持一致性；黑名单转 accept:false。
- **TMX 输入**：`--tmx file.tmx --src-lang en --tgt-lang zh-CN`，语言前缀自动匹配（en 命中 en-US）。

## 已知陷阱（每条都真实踩过）

1. **Map 用 `.size` 不是 `.length`**——词对齐初始化曾因 `p.tu.length` 全程 NaN，译文全军覆没。
2. **brk（子句边界）只阻止跨度内部穿越**——`full()` 若把带 brk 的词元整体排除，"，固件更新"的固会被踢出 run，译文变成"件"。
3. **dfF 稀释**：多术语共享的字（网/器/边/据）全局 dfF 被其他术语抬高，Dice 被压低——`diceMin` 必须 0.3；0.5 会把"物联网"的"网"踢出局，然后"因此"这类句内偶发词反而满分胜出。
4. **widthPenalty 必须 < 0.57**：超过共享字真实 Dice 后，"云服务器"被裁成"云服务"、"传感器"裁成"传感"。
5. **dfT=1（术语只出现在一句）跳过投票**——共现门槛坍缩为 1，句内一切字都"合格"，统计证据为零。
6. **共识核用包含关系优先于票数**："行机器学习 ⊃ 机器学习" 时核必须取被包含者；但互不包含的平票不要改投（edge node 曾被"因此"霸榜）。
7. **被拒候选必须从导出中排除**——finalize 曾只记 report 不拦导出，被拒的 "edge" 以 auto 身份混进术语表。
8. **foldSingular 只服务统计一致性**（eats→eat），展示永远用 surface。
9. Node 下解码 GBK 用 `TextDecoder`（full-icu），不能用 `Buffer.from(str,'gbk')`（不存在）。

## 详细参考

- 数据结构、公式、参数表、文件格式：读 `references/architecture.md`
- 基准说明与阈值依据：`benchmark/data/expected_terms.json` 及仓库 README
