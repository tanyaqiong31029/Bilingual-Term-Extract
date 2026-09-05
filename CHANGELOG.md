# Changelog

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
