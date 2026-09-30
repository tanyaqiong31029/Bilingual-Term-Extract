# 覆盖率基线（c8 / V8）

> 运行 `npm run coverage` 重新生成。基线建立于 v1.3.0（2026-09-06），141 项断言全绿。
> 新增代码请勿让下表明显回退；异常分支（错误出口、防御检查）是补测重点。

## 当前基线

| 文件 | 语句 | 分支 | 未测行说明 |
|---|---|---|---|
| **全部** | **97.4%** | **76.0%** | |
| scripts/finalize.js | 96.4% | 70.8% | CLI --help / 缺参出口（人工路径，execSync 已覆盖主流程） |
| scripts/term_extract.js | 98.9% | 63.2% | --bilingual 非 srt 扩展名出口 |
| scripts/validate.js | 93.0% | 62.2% | CLI main 出口；validate 决策非数组等防御分支 |
| scripts/core/aligner.js | 92.0% | 71.2% | 同文种词汇相似度分支（lexWeight>0，仅 latin↔latin 触发）、erf/pd 极值 |
| scripts/core/candidates.js | 100% | 85.4% | 少量防御分支（空 key、极端 n） |
| scripts/core/docximport.js | 96.4% | 80.4% | UTF-16LE BOM 与 GBK 循环回退的次序分支 |
| scripts/core/exporters.js | 100% | 75.8% | 空字段/缺省值展示分支 |
| scripts/core/segmenter.js | 96.0% | 67.0% | 泰语整行分支、缩写库冷僻条目 |
| scripts/core/srt.js | 98.7% | 78.6% | looksLikeSrt 的 WEBVTT 头分支（由 parse 用例间接覆盖） |
| scripts/core/tmx.js | 100% | 63.6% | seg 内嵌套标签的防御分支 |
| scripts/core/tokenizer.js | 100% | 88.6% | 纯标点/纯空白边界 |
| scripts/core/util.js | 100% | 80.0% | escapeXml 次序、charClass 冷僻文种 |
| scripts/core/vote.js | 97.1% | 83.0% | BTE_DEBUG 调试输出块 |

## 已知未测路径的取舍

- **aligner 同文种分支**：multi-align 上游已验证（其基准含 latin↔latin 用例）；本仓库基准为 EN↔ZH，不重复建设。
- **CLI --help / 缺参出口**：交互路径，CI 用 execSync 覆盖了主流程与主要异常码（1/2）。
- **调试输出块**（BTE_DEBUG）：按设计不在测试内。

## 覆盖重点（按审查要求已补测）

候选（100%）、投票（97%）、TMX（100%，含 Trados bpt/ept/ph 语义样例）、
DOCX（96%，含损坏/zip bomb/坏 deflate 流/表格/br-tab/E2E 出 TBX）、
定稿（96%，含校验失败退出码、拒绝清单）。
