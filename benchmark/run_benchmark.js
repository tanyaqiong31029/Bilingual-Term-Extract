'use strict';
/* Bilingual-Term-Extract —— 金标准基准
 * 数据：benchmark/data/ 下自创 EN↔ZH 平行文本（16 对期望术语，两侧频次均 ≥2）。
 * 指标（统计阶段，不含 LLM 精筛）：
 *   1. 源语候选召回率：期望术语出现在候选列表中的比例        ≥ 0.85
 *   2. 统计译文 top-3 命中率：期望译文进入统计投票前 3 的比例  ≥ 0.55
 *   3. 端到端：golden decisions → finalize → 导出文件齐全且含全部期望术语对
 * 统计阶段只负责"高召回"，精度由 LLM 精筛兜底（SKILL.md 工作流），阈值据此设定。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TE = require(path.join(ROOT, 'scripts/term_extract.js'));
const Cand = require(path.join(ROOT, 'scripts/core/candidates.js'));
const Vote = require(path.join(ROOT, 'scripts/core/vote.js'));
const Tok = require(path.join(ROOT, 'scripts/core/tokenizer.js'));
const { finalize, writeOutputs } = require(path.join(ROOT, 'scripts/finalize.js'));

const RECALL_MIN = 0.85;
const TR3_MIN = 0.7;

const VERBOSE = process.argv.includes('--verbose');
let failures = 0;
function check(name, ok, detail) {
  const tag = ok ? 'PASS' : 'FAIL';
  console.log('[' + tag + '] ' + name + (detail !== undefined ? '  ' + detail : ''));
  if (!ok) failures++;
}

function normOf(term) { return Tok.keyOf(Tok.tokenize(String(term || ''))); }

/* 期望术语 → 候选匹配：先精确 norm 相等，再退到 token 子序列（cloud server ⊂ central cloud server）。
 * 两轮扫描避免 real-time 这类单词被更高分的 real-time inference 抢先子序列匹配。 */
function matchCandidate(cands, expected) {
  const exp = normOf(expected);
  const parts = exp.split(' ').filter(Boolean);
  for (const c of cands) if (c.norm === exp) return c;
  for (const c of cands) {
    if (c.kind === 'latin') {
      const toks = c.norm.split(' ');
      for (let i = 0; i + parts.length <= toks.length; i++) {
        let hit = true;
        for (let k = 0; k < parts.length; k++) if (toks[i + k] !== parts[k]) { hit = false; break; }
        if (hit) return c;
      }
    } else if (c.kind === 'cjk' && c.norm.indexOf(exp) >= 0) return c;
  }
  return null;
}

function normTrans(t) { return normOf(t); }

/* 单方向评测：返回 {recall, tr3, perTerm} */
function evalDirection(pairs, expectedList, expectKey) {
  const { candidates } = Cand.extractCandidates(pairs, { minFreq: 2, topN: 500 });
  Vote.voteTranslations(candidates, pairs);
  let matched = 0, tr3 = 0, rank1 = 0;
  const perTerm = [];
  for (const exp of expectedList) {
    const c = matchCandidate(candidates, exp[expectKey]);
    if (!c) { perTerm.push({ term: exp[expectKey], ok: false, why: '候选缺失' }); continue; }
    matched++;
    const want = normTrans(exp[expectKey === 'en' ? 'zh' : 'en']);
    const tops = (c.translations || []).map(t => normTrans(t.t));
    const rank = tops.indexOf(want);
    if (rank >= 0) {
      tr3++;
      if (rank === 0) rank1++;
      perTerm.push({ term: exp[expectKey], ok: true, rank, top: (c.translations[0] || {}).t });
    } else {
      perTerm.push({ term: exp[expectKey], ok: false, why: '译文未进 top3: ' + JSON.stringify(c.translations || []) });
    }
  }
  return {
    candidates, recall: matched / expectedList.length,
    tr3: tr3 / expectedList.length, rank1: rank1 / expectedList.length, perTerm
  };
}

function main() {
  const dataDir = path.join(__dirname, 'data');
  const enText = fs.readFileSync(path.join(dataDir, 'sample_en.txt'), 'utf8');
  const zhText = fs.readFileSync(path.join(dataDir, 'sample_zh.txt'), 'utf8');
  const expected = JSON.parse(fs.readFileSync(path.join(dataDir, 'expected_terms.json'), 'utf8')).en2zh;

  /* ---------- 方向 1：EN → ZH ---------- */
  const rEN = align(enText, zhText, 'en', 'zh-CN');
  const eEN = evalDirection(rEN.pairs, expected, 'en');
  console.log('== EN → ZH ==');
  check('EN 源语候选召回率 ≥ ' + RECALL_MIN, eEN.recall >= RECALL_MIN, (eEN.recall * 100).toFixed(1) + '%');
  check('EN 统计译文 top-3 命中率 ≥ ' + TR3_MIN, eEN.tr3 >= TR3_MIN, (eEN.tr3 * 100).toFixed(1) + '%');
  if (VERBOSE) printPerTerm(eEN.perTerm);

  /* ---------- 方向 2：ZH → EN ---------- */
  const rZH = align(zhText, enText, 'zh-CN', 'en');
  const eZH = evalDirection(rZH.pairs, expected, 'zh');
  console.log('== ZH → EN ==');
  check('ZH 源语候选召回率 ≥ ' + RECALL_MIN, eZH.recall >= RECALL_MIN, (eZH.recall * 100).toFixed(1) + '%');
  check('ZH 统计译文 top-3 命中率 ≥ ' + TR3_MIN, eZH.tr3 >= TR3_MIN, (eZH.tr3 * 100).toFixed(1) + '%');
  if (VERBOSE) printPerTerm(eZH.perTerm);

  /* ---------- 端到端：golden decisions → finalize → 导出 ---------- */
  console.log('== 端到端（EN → ZH） ==');
  const decisions = [];
  for (const exp of expected) {
    const c = matchCandidate(eEN.candidates, exp.en);
    if (c) decisions.push({ term: c.term, accept: true, tgt: exp.zh, conf: 0.95, pos: 'noun' });
  }
  // 夹带一个拒绝项：取排序最靠前且不在期望列表中的候选
  const expectedNorms = new Set(expected.map(e => normOf(e.en)));
  const junk = eEN.candidates.find(c => !expectedNorms.has(normOf(c.term)) && !expected.some(e => normOf(c.term).indexOf(normOf(e.en)) >= 0));
  if (junk) decisions.push({ term: junk.term, accept: false, note: '基准注入的拒绝样例' });

  const candJson = {
    app: 'bilingual-term-extract', version: 1,
    meta: { srcLang: 'en', tgtLang: 'zh-CN' },
    candidates: eEN.candidates
  };
  const v = require(path.join(ROOT, 'scripts/validate.js')).validateDecisions(decisions, eEN.candidates);
  check('golden decisions 校验通过', v.valid, v.valid ? '' : JSON.stringify(v.errors.slice(0, 3)));

  const { terms, report } = finalize(candJson, decisions, { autoConf: 0.75, minConf: 0.6, includeReview: false });
  check('导出术语数 ≥ 16', terms.length >= expected.length, '导出 ' + terms.length);
  const missing = expected.filter(exp => !terms.some(t =>
    normOf(t.src).indexOf(normOf(exp.en)) >= 0 && normTrans(t.tgt) === normTrans(exp.zh)));
  check('全部期望术语对均导出且译文正确', missing.length === 0, missing.length ? '缺失: ' + missing.map(m => m.en).join('、') : '');
  check('拒绝项未导出', junk ? !terms.some(t => normOf(t.src) === normOf(junk.term)) : true);

  const outDir = path.join(__dirname, '_out');
  const files = writeOutputs(outDir, 'terms', 'en', 'zh-CN', terms, report);
  check('导出文件齐全 (tbx/csv/json/md/report)', ['terms.tbx', 'terms.csv', 'terms.json', 'terms.md', 'terms_report.json'].every(f => files.includes(f)));

  // TBX 结构校验：优先 python3 minidom，退化到标签平衡检查
  let tbxOk = false, tbxDetail = '';
  const tbx = fs.readFileSync(path.join(outDir, 'terms.tbx'), 'utf8');
  try {
    execSync('python3 -c "import sys,xml.dom.minidom; xml.dom.minidom.parse(sys.argv[1])" ' + path.join(outDir, 'terms.tbx'), { stdio: 'pipe' });
    tbxOk = true; tbxDetail = 'minidom';
  } catch (e) {
    const opens = (tbx.match(/<termEntry\b/g) || []).length;
    const closes = (tbx.match(/<\/termEntry>/g) || []).length;
    tbxOk = opens === closes && opens >= expected.length && tbx.includes('<martif type="TBX"');
    tbxDetail = 'fallback(标签平衡) entry=' + opens;
  }
  check('TBX 结构合法', tbxOk, tbxDetail);
  check('CSV 行数正确', fs.readFileSync(path.join(outDir, 'terms.csv'), 'utf8').trim().split('\n').length === terms.length + 1);
  check('report 拒绝计数正确', report.rejectedCount === (junk ? 1 : 0), 'rejected=' + report.rejectedCount);

  // 清理基准输出
  try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }

  console.log('');
  if (failures) {
    console.log('基准未通过：' + failures + ' 项失败');
    process.exit(1);
  }
  console.log('基准全部通过 ✓');
}

function align(srcText, tgtText, srcLang, tgtLang) {
  return TE.alignDocs(srcText, tgtText, srcLang, tgtLang);
}

function printPerTerm(per) {
  for (const p of per) {
    console.log('  ' + (p.ok ? '  ok ' : 'MISS') + '  ' + p.term + (p.ok ? '  rank=' + (p.rank + 1) + '  top=' + p.top : '  ' + p.why));
  }
}

main();
