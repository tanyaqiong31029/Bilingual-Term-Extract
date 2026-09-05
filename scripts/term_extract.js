#!/usr/bin/env node
'use strict';
/* Bilingual-Term-Extract —— 统计阶段 CLI（候选术语提取 + 词对齐译文投票）
 *
 * 用法：
 *   node term_extract.js candidates --src en.docx --tgt zh.srt \
 *        [--src-lang en] [--tgt-lang zh-CN] [--min-freq 2] [--top 300] \
 *        [--out output] [--name project]        # 支持 .txt/.md/.docx/.srt/.vtt
 *   node term_extract.js candidates --tmx memory.tmx --src-lang en --tgt-lang zh-CN [...]
 *   node term_extract.js candidates --pairs pairs.json [...]   # 预对齐句对 [{"src":"...","tgt":"..."}]
 *
 * 输出：<out>/<name>_candidates.json + <name>_candidates_preview.md
 * 之后的 LLM 精筛 → finalize 流程见 SKILL.md。
 */
const fs = require('fs');
const path = require('path');

const SRC = path.dirname(__filename);
const Seg = require(path.join(SRC, 'core/segmenter.js'));
const Aligner = require(path.join(SRC, 'core/aligner.js'));
const U = require(path.join(SRC, 'core/util.js'));
const Imp = require(path.join(SRC, 'core/docximport.js'));
const Tmx = require(path.join(SRC, 'core/tmx.js'));
const Cand = require(path.join(SRC, 'core/candidates.js'));
const Vote = require(path.join(SRC, 'core/vote.js'));
const { toMD } = require(path.join(SRC, 'core/exporters.js'));

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'include-review') { o[key] = true; continue; }
      o[key] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      if (o[key] !== true) i++;
    } else o._.push(a);
  }
  return o;
}

function ensurePairLangs(srcLang, tgtLang) {
  const a = U.normLang(srcLang), b = U.normLang(tgtLang);
  if (!a || !b) throw new Error('无法自动识别语言，请显式指定 --src-lang 与 --tgt-lang');
  if (a.split('-')[0] === b.split('-')[0]) throw new Error('两侧语言相同（' + a + ' / ' + b + '），术语提取需要双语平行文本');
  return [a, b];
}

/* 双文档 → 句对（Gale-Church 对齐，仅取 1-1 高置信句对） */
function alignDocs(srcText, tgtText, srcLang, tgtLang) {
  const mk = arr => arr.map(s => ({
    text: s.text, para: s.para,
    len: U.weightedLen(s.text),
    nums: Seg.extractNums(s.text),
    tokens: Seg.simTokens(s.text)
  }));
  const A = mk(Seg.segmentRich(srcText, srcLang));
  const B = mk(Seg.segmentRich(tgtText, tgtLang));
  if (!A.length || !B.length) throw new Error('分句结果为空，请检查文档内容');
  const gA = Seg.langGroup(srcLang), gB = Seg.langGroup(tgtLang);
  const sameGroup = gA === gB;
  const beads = Aligner.alignTexts(A, B, {
    variance: Seg.autoVariance(gA, gB),
    numWeight: 60,
    lexWeight: sameGroup ? 40 : 0,
    sameScript: sameGroup,
    usePara: true,
    srtWeight: 0
  });
  const pairs = [];
  let dropped = 0;
  for (const b of beads) {
    if (b.type === '1-1') {
      pairs.push({ src: A[b.a[0]].text, tgt: B[b.b[0]].text, conf: b.conf, origin: 'gale-church' });
    } else dropped++;
  }
  return { pairs, nA: A.length, nB: B.length, dropped };
}

function cmdCandidates(o) {
  let pairs, srcLang, tgtLang;
  if (o.tmx) {
    srcLang = o['src-lang']; tgtLang = o['tgt-lang'];
    if (!srcLang || !tgtLang) throw new Error('--tmx 模式必须显式给出 --src-lang 与 --tgt-lang');
    [srcLang, tgtLang] = ensurePairLangs(srcLang, tgtLang);
    const tmxText = Imp.decodeText(fs.readFileSync(o.tmx));
    pairs = Tmx.extractPairs(tmxText, srcLang, tgtLang);
    if (!pairs.length) throw new Error('TMX 中未找到 ' + srcLang + '↔' + tgtLang + ' 句对');
    console.log('TMX 句对: ' + pairs.length);
  } else if (o.pairs) {
    const arr = JSON.parse(fs.readFileSync(o.pairs, 'utf8'));
    if (!Array.isArray(arr) || !arr.length) throw new Error('--pairs 文件必须是 [{"src":"...","tgt":"..."}] 数组');
    pairs = arr.map(p => ({ src: String(p.src || ''), tgt: String(p.tgt || ''), conf: 1.0, origin: 'pairs' }));
    const detA = Seg.detectLang(pairs.map(p => p.src).join('\n'));
    const detB = Seg.detectLang(pairs.map(p => p.tgt).join('\n'));
    [srcLang, tgtLang] = ensurePairLangs(o['src-lang'] || detA, o['tgt-lang'] || detB);
    console.log('预对齐句对: ' + pairs.length);
  } else {
    if (!o.src || !o.tgt) throw new Error('需要 --src 与 --tgt 两个双语文档（或 --tmx / --pairs）');
    const a = Imp.readAnyPath(o.src), b = Imp.readAnyPath(o.tgt);
    [srcLang, tgtLang] = ensurePairLangs(o['src-lang'] || Seg.detectLang(a.text), o['tgt-lang'] || Seg.detectLang(b.text));
    const r = alignDocs(a.text, b.text, srcLang, tgtLang);
    pairs = r.pairs;
    console.log('分句: 源 ' + r.nA + ' 句 / 目标 ' + r.nB + ' 句；对齐 1-1 句对 ' + pairs.length + '（其余 ' + r.dropped + ' 个珠位已丢弃）');
    if (pairs.length < 3) throw new Error('有效句对过少（' + pairs.length + '），无法统计提取——请检查文档是否真的互为译文');
    if (pairs.length < 5) console.warn('WARN: 有效句对仅 ' + pairs.length + ' 个，统计召回与译文质量有限——LLM 精筛请格外依赖上下文例句');
  }

  const minFreq = +(o['min-freq'] || 2), topN = +(o.top || 300);
  console.log('语言对: ' + srcLang + ' → ' + tgtLang + '；候选参数 minFreq=' + minFreq + ' topN=' + topN);

  const { candidates, stats } = Cand.extractCandidates(pairs, { minFreq, topN });
  console.log('候选术语: 原始 ' + stats.rawCandidates + ' → 输出 ' + stats.returned);

  Vote.voteTranslations(candidates, pairs);
  const withTrans = candidates.filter(c => c.translations && c.translations.length).length;
  console.log('获得统计译文的候选: ' + withTrans + '/' + candidates.length);

  const name = o.name || 'candidates';
  const outDir = o.out || 'output';
  fs.mkdirSync(outDir, { recursive: true });
  const meta = {
    tool: 'bilingual-term-extract', stage: 'candidates',
    generatedAt: new Date().toISOString(),
    srcLang, tgtLang, name: o.name || '', stats,
    note: 'candidates 为统计阶段产物（高召回）。请按 SKILL.md 完成 LLM 精筛，写 decisions.json 后运行 finalize.js。'
  };
  const candPath = path.join(outDir, name + '_candidates.json');
  fs.writeFileSync(candPath, JSON.stringify({ app: 'bilingual-term-extract', version: 1, meta, candidates }, null, 2) + '\n', 'utf8');

  // 预览表（供人工快速浏览，前 30 条）
  const prevEntries = candidates.slice(0, 30).map(c => ({
    src: c.term, tgt: c.translations && c.translations[0] ? c.translations[0].t : '（无）',
    freq: c.freq, conf: c.statConf, status: 'candidate', pos: '', domain: '', note: ''
  }));
  const prevPath = path.join(outDir, name + '_candidates_preview.md');
  fs.writeFileSync(prevPath, toMD(prevEntries, srcLang, tgtLang), 'utf8');

  console.log('已写出: ' + candPath);
  console.log('已写出: ' + prevPath);
  console.log('\n下一步（LLM 精筛）：阅读 SKILL.md 工作流第 2 步，逐批判定候选并写 decisions.json，然后：');
  console.log('  node scripts/validate.js <decisions.json> ' + candPath);
  console.log('  node scripts/finalize.js --candidates ' + candPath + ' --decisions <decisions.json> --out ' + outDir);
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const cmd = o._[0];
  try {
    if (cmd === 'candidates') return cmdCandidates(o);
    if (!cmd || o.help) {
      console.log('Bilingual-Term-Extract v1.0.0');
      console.log('子命令:\n  candidates   统计阶段：双语文档 → 候选术语 + 统计译文（详见 --help 后各参数）');
      console.log('后续 LLM 精筛与定稿: scripts/validate.js + scripts/finalize.js（见 SKILL.md）');
      return;
    }
    throw new Error('未知子命令: ' + cmd);
  } catch (e) {
    console.error('FATAL: ' + e.message);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { alignDocs, cmdCandidates, parseArgs, ensurePairLangs };
