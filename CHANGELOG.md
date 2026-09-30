# Changelog

## 1.3.0 (2026-09-06)

- **TMX 行内标签按元素语义清洗**（Trados/memoQ 互操作修复）：bpt/ept/it/ph 的内容
  本身是转义后的原生标记（如 `<bpt>&lt;b&gt;</bpt>`），此前剥壳留内容会把 `<b>`
  残留进术语正文——现连内容整体移除；hi 去壳留内容；新增真实 Trados Studio 风格
  样例回归与截断/空 TMX 异常用例
- **DOCX zip bomb 防护**：unzipEntry 增加单文件解压展开上限（默认 64MB，STORE 与
  DEFLATE 双路约束，DEFLATE 走 inflate maxOutputLength）；坏 deflate 流报错而非崩溃
- **CSV Excel 公式注入防护**（默认开启）：以 `= + - @ Tab CR` 开头的单元格加单引号
  降级为纯文本，`{ excelSafe: false }` 关闭
- **覆盖率基线**：`npm run coverage`（c8）；语句 97.4% / 分支 76.0%，基线表与
  未测路径取舍说明见 tests/COVERAGE_BASELINE.md；补测 CLI --tmx/--pairs/--bilingual
  入口、finalize/validate 异常退出码、滑窗长文对齐（1700 句 1-1 全对齐）
- 开发工具升级（Dependabot）：eslint 10、lint-staged 17、globals 17、commitlint
  config 21、checkout/setup-node v7、gitleaks-action v3；homepage 指向 SKILL.md 入门文档
- 回归测试 115 → **141 项**

## 1.2.0 (2026-09-05)

- 新增 `--bilingual`：单文件双语字幕自动拆分入口（same-cue 双语行 / 交替 cue /
  分块排布三种排版自动识别），`--src-lang` 指定术语源语侧
- srt.js parse 暴露行级结构（lines）；修复 --bilingual 误经 readAnyPath 剥掉时间轴的问题
- 回归测试新增双语拆分组 13 项断言（104 项）

## 1.1.0 (2026-09-03)

- 新增 SRT/VTT 字幕导入：宽容解析（VTT 头、无小时时间戳、标签/位置标记清洗），
  每条 cue 独立成段以启用段落锚定；`--src/--tgt` 现支持 .txt/.md/.docx/.srt/.vtt
- vote.js 清理桥接残留死代码（soft/softDice），算法注释与实现对齐
- README 增加 CI badge；package.json 补 repository/bugs/homepage 字段
- 回归测试新增 SRT 组 10 项断言（91 项）

## 1.0.0 (2026-09-03)

首个发布版本。

- 统计管线：DOCX/TXT/MD/TMX/句对 JSON 导入 → Gale-Church 句对齐（仅取 1-1）→ 候选术语
  （拉丁 n-gram + 软化 C-value + 专名加权；中文 n-gram + PMI 内凝度 + 邻接熵软评分）
  → Dice 共现投票 + 两轮共识（连续段打分、宽度罚分、brk 语义修正）
- LLM 精筛工作流：candidates.json → decisions.json（schema + validate.js 校验）→ finalize.js 状态机
  （confirmed / auto / review / rejected，被拒条目绝不导出）
- 导出：TBX v02 martif（MultiTerm/memoQ 兼容）、CSV（UTF-8 BOM）、JSON、Markdown、审校报告
- 质量：81 项无头回归测试；金标准基准（EN↔ZH 16 术语对，双向召回 100%、
  统计译文 top-3 75%、端到端含 TBX 结构校验）
- agent 技能规范 SKILL.md + 架构参考 references/architecture.md
