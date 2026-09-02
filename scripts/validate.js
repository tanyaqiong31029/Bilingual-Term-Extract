'use strict';
/* Bilingual-Term-Extract —— LLM 精筛结果（decisions.json）校验
 * decisions.json 条目：
 *   { "term": "edge computing",   // 必填，须与候选术语精确对应
 *     "accept": true,             // 必填，false = 判定非术语，整条丢弃
 *     "tgt": "边缘计算",           // 可选，确认或修正后的译文；缺省沿用统计最优
 *     "conf": 0.95,               // 可选，0-1
 *     "pos": "noun", "domain": "云计算", "note": "" }  // 可选
 */
const fs = require('fs');
const Tok = require('./core/tokenizer.js');

function normKey(term) {
  return Tok.keyOf(Tok.tokenize(String(term || '')));
}

function validateDecisions(decisions, candidates) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(decisions)) {
    return { valid: false, errors: ['decisions.json 顶层必须是数组'], warnings };
  }
  const candByTerm = new Map();
  const candByNorm = new Map();
  for (const c of candidates) {
    candByTerm.set(c.term, c);
    candByNorm.set(normKey(c.term), c);
  }
  const seen = new Set();
  decisions.forEach((d, i) => {
    const at = '第 ' + (i + 1) + ' 条';
    if (!d || typeof d !== 'object' || Array.isArray(d)) { errors.push(at + '：不是对象'); return; }
    const term = d.term;
    if (typeof term !== 'string' || !term.trim()) { errors.push(at + '：缺少 term 字段'); return; }
    if (typeof d.accept !== 'boolean') { errors.push(at + '（' + term + '）：accept 必须是布尔值'); }
    if (seen.has(term)) errors.push(at + '（' + term + '）：术语重复出现');
    seen.add(term);
    const hit = candByTerm.get(term) || candByNorm.get(normKey(term));
    if (!hit) {
      errors.push(at + '（' + term + '）：在候选列表中不存在（term 必须与 candidates.json 中的术语一致）');
    }
    if (d.tgt !== undefined && (typeof d.tgt !== 'string')) {
      errors.push(at + '（' + term + '）：tgt 必须是字符串');
    } else if (d.accept === true && (d.tgt === undefined || !String(d.tgt).trim())) {
      warnings.push(at + '（' + term + '）：accept=true 但未给 tgt，将沿用统计最优译文');
    }
    if (d.conf !== undefined && (typeof d.conf !== 'number' || d.conf < 0 || d.conf > 1)) {
      errors.push(at + '（' + term + '）：conf 必须在 0-1 之间');
    }
    for (const k of ['pos', 'domain', 'note']) {
      if (d[k] !== undefined && typeof d[k] !== 'string') errors.push(at + '（' + term + '）：' + k + ' 必须是字符串');
    }
  });
  const decided = new Set();
  for (const d of decisions) if (d && typeof d.term === 'string') decided.add(d.term);
  const normDecided = new Set(decisions.filter(d => d && d.term).map(d => normKey(d.term)));
  let undecided = 0;
  for (const c of candidates) {
    if (!normDecided.has(normKey(c.term))) undecided++;
  }
  return { valid: errors.length === 0, errors, warnings, undecided, total: candidates.length };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.includes('--help')) {
    console.log('用法: node validate.js <decisions.json> <candidates.json>');
    process.exit(args.length < 2 ? 2 : 0);
  }
  let decisions, candJson;
  try {
    decisions = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  } catch (e) { console.error('FATAL: 无法读取/解析 ' + args[0] + '：' + e.message); process.exit(2); }
  try {
    candJson = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  } catch (e) { console.error('FATAL: 无法读取/解析 ' + args[1] + '：' + e.message); process.exit(2); }
  const r = validateDecisions(decisions, candJson.candidates || []);
  for (const w of r.warnings) console.log('WARN: ' + w);
  for (const e of r.errors) console.error('ERROR: ' + e);
  console.log('覆盖：' + (r.total - r.undecided) + '/' + r.total + ' 个候选（未覆盖 ' + r.undecided + ' 个将按统计置信度自动处理）');
  if (!r.valid) { console.error('校验失败'); process.exit(1); }
  console.log('校验通过');
}

if (require.main === module) main();
module.exports = { validateDecisions, normKey };
