# Bilingual-Term-Extract 架构与算法参考

> SKILL.md 是操作规范；本文是数据结构、公式、参数与文件格式的完整参考。

## 流水线与模块

```
scripts/
├── term_extract.js      CLI：candidates 子命令（导入→句对齐→候选→译文投票）
├── validate.js          decisions.json 校验（库 + CLI）
├── finalize.js          合并决策 + 状态机 + 写出导出（库 + CLI）
└── core/
    ├── util.js          charClass / weightedLen / normLang / escapeXml
    ├── segmenter.js     多语分句（缩写库、小数、brk 上标、列表标号）+ 语言检测
    ├── aligner.js       Gale-Church DP（1-1/1-2/2-1/2-2/1-0/0-1 + 段落锚定 + 滑窗）
    ├── docximport.js    迷你 ZIP 读取器（node:zlib）+ DOCX 正文 + TXT 编码识别
    ├── tmx.js           TMX 1.4 正则解析（tu/tuv/seg，行内标签剥离，语言前缀匹配）
    ├── tokenizer.js     分词：拉丁=词元（连字符/撇号内聚），CJK=逐字；norm=小写+单数折叠
    ├── stopwords.js     内置停用词（EN 词表；ZH 单字表刻意精简 + 多字虚词表）
    ├── candidates.js    候选提取（本文件 §2）
    ├── vote.js          Dice 共现投票 + 两轮共识（本文件 §3）
    └── exporters.js     TBX / CSV / JSON / Markdown
```

分句与句对齐适配自 multi-align（MIT, tanyaqiong31029），保留了其基准验证过的规则与滑窗分块。

## 1. 句对齐

输入两个单语文档 → `segmentRich`（含段落编号）→ 句对象 `{text, para, len: weightedLen, nums, tokens: simTokens}` → `alignTexts`（variance=autoVariance(g1,g2)，numWeight=60，lexWeight=40 仅同文种组，usePara=true）→ **只保留 1-1 珠**作为句对（conf 0.95）；1-2/2-1/2-2/1-0/0-1 全部丢弃并计数。术语提取需要干净的单句对应，宁缺毋滥。

## 2. 候选术语提取（candidates.js）

### 词元化（tokenizer.js）
- 拉丁：`[\p{L}\p{N}'’\-]+` 连续串为一个词元，首尾连字符/撇号修剪；norm = 小写 + 轻量单数折叠（`ies→y`、`sses/shes/ches/xes/zes→去es`、`ss/us/is` 保留、其余去 `s`）。
- CJK（汉/假名）：逐字成词元。
- `brk` 标志：词元前若存在任何标点（`\p{P}\p{S}`）则 brk=true——候选 n-gram 不得**跨越** brk（逗号两侧不成词），但可以**始于** brk。

### 拉丁 n-gram（1..5 词元）
全拉丁词元、内部无 brk、内部无纯数字词元；**首尾词元不得为停用词/纯数字**（中间词元不检查——`state of the art` 合法）；单词候选须 ≥2 字符且含字母。统计：freq、spread（出现句数）、surfaces（取最高频表面形式为 term）、capOcc（n≥2 且所有字母词元首字母大写——专名信号）。

### 中文 n-gram（2..6 字）
连续 CJK 字、内部无 brk、首字/末字不得为单字虚词（stopwords.js 的 ZH_CHARS）、整词不得为多字虚词（ZH_WORDS）。统计 freq/spread + 左右邻字分布。

- **内凝度**：min PMI over 相邻字对，`PMI = ln( p(xy) / (p(x)·p(y)) )`，p 由全语料 uni/bigram 计数（+0.1 平滑）。硬门槛 `minPMI ≥ 1.2`。
- **邻接熵**：左右邻字分布熵（句边界记 `#`）。**默认仅作软评分**（entF = clamp(minEntropy/2.5, 0.4, 1.3)）——文档级小语料中频次 2 的真术语常被固定邻字压成 0 熵（"的带宽"），硬过滤会误杀。

### 软化 C-value 嵌套折扣
对候选 c，收集所有包含 c 为**连续子串**的更长候选 d（各自 freq ≥ minFreq）：

```
effFreq(c) = f(c) − 0.6 × (Σ f(d)) / p(c)      p(c) = |{d}|，下限 0.5
```

完整 C-value 的系数是 1.0；小语料上过度惩罚（"推理"两现全在"实时推理"内会被清零），取 0.6 折中。

### 打分

```
拉丁：score = effFreq × (1 + 0.4(n−1)) × (1 + 0.3·min(spread,6)/6) × [n≥2 且 capRatio ≥ 0.7 → ×1.15]
中文：score = effFreq × (1 + 0.25(n−2)) × clamp(minPMI/3, 0.5, 1.4) × entF
```

排序取 topN（默认 300），附 id（c1…）与 contexts（前 3 次出现的句对原文）。

## 3. 统计译文投票（vote.js）

对齐粒度与 tokenizer 一致（拉丁词 / CJK 字）。对候选 c 与其出现句集（dfT = 出现句数）：

- `co(f)` = f 与 c 同句的句数（按句去重）；`dfF(f)` = f 的全局文档频次。
- `Dice(c,f) = 2·co / (dfT + dfF)`
- **合格（full）**：`co ≥ 0.75·dfT` 且 `Dice ≥ 0.3` 且 `dfF ≥ 2` 且词元非 brk 起（run 结构上 brk 词元只能开新段不能续接）。
- 连续段（runs）：句内相邻合格词元的极大连续串；**枚举全部子跨度**（宽度 ≤ cap = n + slack）。
- 跨度打分：`Σ Dice(合格字) − 0.6? → 0.3 × max(0, 宽度 − 基准)`；基准宽度 = 目标语为 CJK ? n+1 : ⌈n/2⌉。每处出现只投**得分最优**的一个 span。
- **两轮共识**：第一轮后，若短语 A 严格包含短语 B（"行机器学习"⊃"机器学习"），共识核取 B（真术语核会在其他出现句独立胜出，粘连带归顺）；无包含关系且最高票 < 2 不改投。共现动词粘连（run machine learning / 行机器学习）由此消除。
- `translations` = 票数 top3；`statConf` = 最高票 / 出现总次数。
- **dfT=1（单句术语）跳过投票**：共现门槛坍缩、无跨句证据，translations=[] 交给 LLM。

参数（DEFAULTS）：`slack=3, coGate=0.75, diceMin=0.3, softDice=0.3（保留供桥接重启）, widthPenalty=0.3`。

> 为什么不用 IBM Model 1 EM：文档级小语料上 EM 把概率质量集中到高频虚词（的/the 与一切词共现），argmax 解码系统性偏向虚词——金标准实测所有源词对齐到"的"，译文投票全军覆没。Dice 的 dfF 分母天然抑制高频虚词；其代价（dfF 稀释多术语共享字）由 co-gate 与低 diceMin 补偿。

## 4. 文件格式

### candidates.json（统计阶段产物，只读）

```json
{ "app": "bilingual-term-extract", "version": 1,
  "meta": { "srcLang": "en", "tgtLang": "zh-CN", "stats": {...}, "note": "..." },
  "candidates": [ { "id": "c1", "term": "edge computing", "norm": "edge computing",
    "kind": "latin", "n": 2, "freq": 3, "spread": 3, "effFreq": 1.8, "score": 3.1,
    "statConf": 1.0, "occTotal": 3, "occVoted": 3,
    "translations": [{ "t": "边缘计算", "votes": 3 }],
    "occurrences": [{ "pair": 0, "start": 0, "end": 2 }],
    "contexts": [{ "pair": 0, "src": "…", "tgt": "…" }] } ] }
```

### decisions.json（LLM 精筛产物，唯一决策载体）

条目：`{ term*, accept*(bool), tgt?, conf?(0-1), pos?, domain?, note? }`。校验规则（validate.js）：term 必须命中候选（term 精确或 norm 归一匹配）；accept 必须布尔；conf ∈ [0,1]；去重；accept=true 无 tgt 仅 WARN（回退统计最优）。

### 术语条目（finalize 产物）

`{ src, tgt, freq, conf, status: confirmed|auto|review, pos, domain, note }`

状态机：LLM accept → conf ≥ minConf(0.6) ? confirmed : review；未决定 → statConf ≥ autoConf(0.75) ? auto : review；accept=false → 拒绝（只进 report，**绝不导出**）。review 默认不导出，`--include-review` 打开。

### TBX（v02 martif）

`martif/martifHeader/fileDesc` + `text/body/termEntry`；domain → `descrip type="subjectField"`；note/review → `descrip type="usageNote"`；POS → `termNote type="partOfSpeech"`；每条目两个 `langSet`（xml:lang = src/tgt）。Trados MultiTerm 与 memoQ 可导入。

## 5. 基准（benchmark/）

自创 EN↔ZH 平行文本（3 段 16 句，边缘计算/物联网领域），16 对期望术语（双侧频次 ≥2）。指标与阈值：

| 指标 | 阈值 | 现值 | 说明 |
|---|---|---|---|
| 源语候选召回率（双向） | ≥ 0.85 | 100% | 统计阶段的生命线 |
| 统计译文 top-3 命中率（双向） | ≥ 0.70 | 75% | 已知失分：latency↔带宽 与 推理↔model training 的统计本质歧义、单句术语留白——均为 LLM 精筛的职责范围 |
| 端到端（golden decisions → 导出） | 全对 | ✓ | TBX 经 python3 minidom 校验 |

调参纪律：动 candidates.js/vote.js 后 `--verbose` 逐条核对；阈值只许在质量实质提升后上调，禁止为过线改数据。

## 6. 性能

零依赖、纯 JS。16 句样例全流程 < 200ms；千句级文档 O(句数×平均句长²) 的 DP 与 O(候选×出现×句长) 的投票在秒级。滑窗分块使万句级语料不爆内存（沿用 multi-align 实测路径）。
