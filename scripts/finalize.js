'use strict';
/* Bilingual-Term-Extract —— 合并 LLM 精筛结果并定稿术语表
 * 状态机：
 *   LLM accept=true            → confirmed（conf ≥ minConf）/ review（conf < minConf）
 *   LLM accept=false           → 丢弃（记入 report.rejected）
 *   无决定 且 statConf ≥ autoConf → auto（统计高置信自动收录）
 *   无决定 且 statConf < autoConf → review（保留待人工，默认不导出，--include-review 打开）
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = { autoConf: 0.75, minConf: 0.6, includeReview: false };

function normKeyOf(term) { return require('./core/tokenizer.js').keyOf(require('./core/tokenizer.js').tokenize(String(term || ''))); }

function finalize(candJson, decisions, opts) {
  opts = Object.assign({}, DEFAULTS, opts || {});
  const cands = candJson.candidates || [];
  const meta = candJson.meta || {};
  const byTerm = new Map(), byNorm = new Map();
  for (const c of cands) {
    byTerm.set(c.term, c);
    byNorm.set(normKeyOf(c.term), c);
  }
  const rejected = [];
  const rejectedNorms = new Set();
  const decidedNorms = new Set();
  for (const d of (Array.isArray(decisions) ? decisions : [])) {
    if (!d || typeof d.term !== 'string') continue;
    const c = byTerm.get(d.term) || byNorm.get(normKeyOf(d.term));
    if (!c) continue; // 校验器负责报错；这里宽容跳过
    if (decidedNorms.has(normKeyOf(c.term))) continue;
    decidedNorms.add(normKeyOf(c.term));
    if (d.accept === false) {
      rejected.push({ term: c.term, reason: d.note || 'LLM 判定非术语' });
      rejectedNorms.add(normKeyOf(c.term));
      continue;
    }
    c._decision = d;
  }

  const terms = [];
  let nConfirmed = 0, nAuto = 0, nReview = 0;
  for (const c of cands) {
    if (rejectedNorms.has(normKeyOf(c.term))) continue;
    const d = c._decision;
    const statTop = c.translations && c.translations[0] ? c.translations[0].t : '';
    let entry;
    if (d) {
      const tgt = (d.tgt && d.tgt.trim()) || statTop;
      const conf = typeof d.conf === 'number' ? +d.conf.toFixed(3) : (c.statConf || 0);
      const status = conf >= opts.minConf ? 'confirmed' : 'review';
      if (status === 'confirmed') nConfirmed++; else nReview++;
      entry = { src: c.term, tgt, freq: c.freq, conf, status, pos: d.pos || '', domain: d.domain || '', note: d.note || '' };
    } else if (c.statConf >= opts.autoConf && statTop) {
      nAuto++;
      entry = { src: c.term, tgt: statTop, freq: c.freq, conf: c.statConf, status: 'auto', pos: '', domain: '', note: '' };
    } else {
      nReview++;
      entry = { src: c.term, tgt: statTop, freq: c.freq, conf: c.statConf, status: 'review', pos: '', domain: '', note: '' };
    }
    if (entry.status === 'review' && !opts.includeReview) continue;
    terms.push(entry);
  }

  const exported = terms.length;
  const report = {
    tool: 'bilingual-term-extract',
    generatedAt: new Date().toISOString(),
    srcLang: meta.srcLang || '', tgtLang: meta.tgtLang || '',
    totalCandidates: cands.length,
    exported, confirmed: nConfirmed, auto: nAuto, review: nReview,
    rejectedCount: rejected.length,
    rejected,
    thresholds: { autoConf: opts.autoConf, minConf: opts.minConf, includeReview: opts.includeReview }
  };
  return { terms, report };
}

function writeOutputs(outDir, name, srcLang, tgtLang, terms, report) {
  fs.mkdirSync(outDir, { recursive: true });
  const { toTBX, toCSV, toJSON, toMD } = require('./core/exporters.js');
  const files = {};
  files[name + '.tbx'] = toTBX(terms, srcLang, tgtLang, name);
  files[name + '.csv'] = toCSV(terms);
  files[name + '.json'] = toJSON(terms, report);
  files[name + '.md'] = toMD(terms, srcLang, tgtLang);
  files[name + '_report.json'] = JSON.stringify(report, null, 2) + '\n';
  for (const [fn, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(outDir, fn), content, 'utf8');
  }
  return Object.keys(files);
}

function main() {
  const argv = process.argv.slice(2);
  const get = (k, dflt) => {
    const i = argv.indexOf('--' + k);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
  };
  const has = k => argv.includes('--' + k);
  const candPath = get('candidates'), decPath = get('decisions'), outDir = get('out', 'output');
  if (!candPath || !decPath || has('help')) {
    console.log('用法: node finalize.js --candidates candidates.json --decisions decisions.json --out output [--auto-conf 0.75] [--min-conf 0.6] [--include-review] [--name terms]');
    process.exit(has('help') ? 0 : 2);
  }
  let candJson, decisions;
  try { candJson = JSON.parse(fs.readFileSync(candPath, 'utf8')); }
  catch (e) { console.error('FATAL: 无法读取 ' + candPath + '：' + e.message); process.exit(2); }
  try { decisions = JSON.parse(fs.readFileSync(decPath, 'utf8')); }
  catch (e) { console.error('FATAL: 无法读取 ' + decPath + '：' + e.message); process.exit(2); }

  const { validateDecisions } = require('./validate.js');
  const v = validateDecisions(decisions, candJson.candidates || []);
  for (const w of v.warnings) console.log('WARN: ' + w);
  if (!v.valid) {
    for (const e of v.errors) console.error('ERROR: ' + e);
    console.error('decisions.json 校验失败，先运行: node validate.js ' + decPath + ' ' + candPath);
    process.exit(1);
  }

  const name = get('name', 'terms');
  const { terms, report } = finalize(candJson, decisions, {
    autoConf: +get('auto-conf', 0.75),
    minConf: +get('min-conf', 0.6),
    includeReview: has('include-review')
  });
  const files = writeOutputs(outDir, name, report.srcLang || 'src', report.tgtLang || 'tgt', terms, report);

  console.log('定稿完成：候选 ' + report.totalCandidates + ' → 导出 ' + report.exported +
    '（confirmed ' + report.confirmed + ' / auto ' + report.auto + ' / review ' + report.review + '），拒绝 ' + report.rejectedCount);
  for (const f of files) console.log('  已写出: ' + path.join(outDir, f));
  if (report.rejected.length) {
    console.log('被拒术语（前 10）: ' + report.rejected.slice(0, 10).map(r => r.term).join('、'));
  }
}

if (require.main === module) main();
module.exports = { finalize, writeOutputs, DEFAULTS };
