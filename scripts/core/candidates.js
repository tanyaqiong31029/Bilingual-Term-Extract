'use strict';
/* Bilingual-Term-Extract —— 源语候选术语提取（统计召回）
 * 拉丁文：token n-gram + 边界停用词过滤 + 软化 C-value 嵌套折扣 + 大写专名加权
 * 中文：字 n-gram + 凝固度（min PMI）+ 邻接熵（左右）过滤
 * 设计目标：高召回 —— 精度交给 LLM 精筛阶段（见 SKILL.md）。
 * 方法论参考：TermSuite（C-value）、Termolator（统计+过滤）、bitext-lexind（词对齐投票）。
 */
const Tok = require('./tokenizer.js');
const SW = require('./stopwords.js');

const DEFAULTS = {
  minFreq: 2,        // 候选最低出现次数
  maxLatinN: 5,      // 拉丁候选最大词元数
  maxZhN: 6,         // 中文候选最大字数
  topN: 300,         // 输出候选上限
  minPMI: 1.2,       // 中文候选内凝度下限（自然对数）——硬过滤
  minEntropy: 0,     // 中文候选邻接熵下限——默认 0（仅作软评分）。文档级小语料中，
                     // 频次 2 的真术语常被固定邻字压成 0 熵（如"带宽"总在"的带宽"），硬过滤会误杀
  zhMinFreq: 2
};

function entropyOf(counts, total) {
  if (!total) return 0;
  let h = 0;
  for (const v of counts.values()) {
    const p = v / total;
    h -= p * Math.log(p);
  }
  return h;
}

function isPureDigit(norm) { return /^[0-9]+$/.test(norm); }

/* 主入口：pairs = [{src, tgt, conf}]，返回 {candidates, stats} */
function extractCandidates(pairs, opts) {
  opts = Object.assign({}, DEFAULTS, opts || {});
  const sents = pairs.map(p => Tok.tokenize(p.src));

  /* ---------- 字符级统计（中文 PMI / 邻接熵用） ---------- */
  const uni = new Map(), bi = new Map();
  let uniTotal = 0, biTotal = 0;
  for (const toks of sents) {
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (!tk.cjk) continue;
      uni.set(tk.norm, (uni.get(tk.norm) || 0) + 1);
      uniTotal++;
      if (i + 1 < toks.length && toks[i + 1].cjk && !toks[i + 1].brk) {
        const key = tk.norm + '\u0000' + toks[i + 1].norm;
        bi.set(key, (bi.get(key) || 0) + 1);
        biTotal++;
      }
    }
  }

  /* ---------- n-gram 频次与出现位置 ---------- */
  const map = new Map(); // key → cand 骨架
  function touch(key, kind, n) {
    let c = map.get(key);
    if (!c) {
      c = { key, kind, n, freq: 0, surfaces: new Map(), occurrences: [], capOcc: 0, spread: new Set(), _left: new Map(), _right: new Map() };
      map.set(key, c);
    }
    return c;
  }

  for (let si = 0; si < sents.length; si++) {
    const toks = sents[si];
    const T = toks.length;

    /* 拉丁 n-gram（1..maxLatinN）：全拉丁词元、不跨 brk、边界非停用词 */
    const maxN = opts.maxLatinN;
    for (let n = 1; n <= maxN; n++) {
      for (let s = 0; s + n <= T; s++) {
        const e = s + n;
        let ok = true, allCap = true;
        for (let k = s; k < e; k++) {
          const tk = toks[k];
          if (tk.cjk) { ok = false; break; }
          if (k > s && tk.brk) { ok = false; break; } // 跨子句标点
          if (k > s && isPureDigit(tk.norm)) { ok = false; break; }
        }
        if (!ok) continue;
        const first = toks[s], last = toks[e - 1];
        if (isPureDigit(first.norm) || isPureDigit(last.norm)) continue;
        if (SW.isStopEn(first.norm) || SW.isStopEn(last.norm)) continue;
        // 单词候选：至少含一个字母、长度≥2、非停用词（已在上方保证）
        if (n === 1 && !/\p{L}/u.test(first.norm)) continue;
        if (n === 1 && first.norm.length < 2) continue;

        const key = Tok.keyOf(toks.slice(s, e));
        const c = touch(key, 'latin', n);
        c.freq++;
        c.spread.add(si);
        const surf = Tok.joinTokens(toks.slice(s, e));
        c.surfaces.set(surf, (c.surfaces.get(surf) || 0) + 1);
        c.occurrences.push({ pair: si, start: s, end: e });
        // 大写专名统计：n≥2 且所有字母词元首字母大写（排除句首影响：看非首词元或整词）
        if (n >= 2) {
          let capAll = true, hasAlpha = false;
          for (let k = s; k < e; k++) {
            const w = toks[k];
            if (/\p{L}/u.test(w.surface)) {
              hasAlpha = true;
              if (!/^\p{Lu}/u.test(w.surface)) capAll = false;
            }
          }
          if (hasAlpha && capAll) c.capOcc++;
        }
      }
    }

    /* 中文 n-gram（2..maxZhN）：连续 CJK 单字、不跨 brk、首尾非虚词 */
    for (let n = 2; n <= opts.maxZhN; n++) {
      for (let s = 0; s + n <= T; s++) {
        const e = s + n;
        if (!toks[s].cjk) continue;
        let ok = true;
        for (let k = s + 1; k < e; k++) {
          if (!toks[k].cjk || toks[k].brk) { ok = false; break; }
        }
        if (!ok) continue;
        if (SW.isZhStopChar(toks[s].norm) || SW.isZhStopChar(toks[e - 1].norm)) continue;
        const key = Tok.keyOf(toks.slice(s, e));
        const c = touch(key, 'cjk', n);
        c.freq++;
        c.spread.add(si);
        c.surfaces.set(key, (c.surfaces.get(key) || 0) + 1);
        c.occurrences.push({ pair: si, start: s, end: e });
        // 邻接熵：记录左右邻字（同句内且不跨 brk）
        const lc = s > 0 && toks[s - 1].cjk && !toks[s].brk ? toks[s - 1].norm : '#';
        const rc = e < T && toks[e].cjk && !toks[e].brk ? toks[e].norm : '#';
        c._left.set(lc, (c._left.get(lc) || 0) + 1);
        c._right.set(rc, (c._right.get(rc) || 0) + 1);
      }
    }
  }

  /* ---------- 过滤 + 特征计算 ---------- */
  const list = [];
  for (const c of map.values()) {
    if (c.freq < (c.kind === 'cjk' ? Math.max(opts.minFreq, opts.zhMinFreq) : opts.minFreq)) continue;
    if (c.kind === 'cjk') {
      if (SW.isZhStopWord(c.key)) continue;
      // 内凝度：候选内部相邻字对的 min PMI
      let minPMI = Infinity;
      for (let k = 0; k + 1 < c.n; k++) {
        const a = c.key[k], b = c.key[k + 1];
        const pxy = ((bi.get(a + '\u0000' + b) || 0) + 0.1) / (biTotal + 0.1 * uniTotal);
        const p = (uni.get(a) || 0) / uniTotal, q = (uni.get(b) || 0) / uniTotal;
        if (p <= 0 || q <= 0) { minPMI = -Infinity; break; }
        const pmi = Math.log(pxy / (p * q));
        if (pmi < minPMI) minPMI = pmi;
      }
      if (!isFinite(minPMI) || minPMI < opts.minPMI) continue;
      const le = entropyOf(c._left, c.freq), re = entropyOf(c._right, c.freq);
      const minEntropy = Math.min(le, re);
      if (minEntropy < opts.minEntropy) continue; // 默认 minEntropy=0，仅当显式调高时硬过滤
      c.minPMI = +minPMI.toFixed(3);
      c.minEntropy = +minEntropy.toFixed(3);
    }
    list.push(c);
  }

  /* ---------- 软化 C-value 嵌套折扣 ----------
   * 候选 c 若主要作为更长候选 d 的子串出现，则有效频次下调：
   * effFreq = f(c) − 0.6 × (1/p) × Σ f(d)，p 为包含 c 的更长候选数。
   * 小语料下不做完整 C-value（避免过度惩罚），系数 0.6 为折中。
   */
  for (const d of list) {
    if (d.n < 2) continue;
    // d 的所有真子串（拉丁子串 ≥1 词元，中文 ≥2 字）；排除 d 自身
    const minSub = d.kind === 'cjk' ? 2 : 1;
    for (let s = 0; s < d.n; s++) {
      for (let e = s + minSub; e <= d.n; e++) {
        if (s === 0 && e === d.n) continue;
        const subKey = d.kind === 'cjk'
          ? d.key.slice(s, e)
          : d.key.split(' ').slice(s, e).join(' ');
        const sub = map.get(subKey);
        if (sub && sub.freq >= opts.minFreq) {
          (sub._containers = sub._containers || []).push(d.freq);
        }
      }
    }
  }
  for (const c of list) {
    const cs = c._containers || [];
    let eff = c.freq;
    if (cs.length) {
      const sum = cs.reduce((a, b) => a + b, 0);
      eff = c.freq - 0.6 * (sum / cs.length);
    }
    c.effFreq = +Math.max(eff, 0.5).toFixed(2);
  }

  /* ---------- 打分排序 ---------- */
  for (const c of list) {
    let score;
    if (c.kind === 'latin') {
      const capRatio = c.freq ? c.capOcc / c.freq : 0;
      score = c.effFreq * (1 + 0.4 * (c.n - 1)) * (1 + 0.3 * Math.min(c.spread.size, 6) / 6);
      if (c.n >= 2 && capRatio >= 0.7) score *= 1.15;
      c.capRatio = +capRatio.toFixed(2);
    } else {
      const pmiF = Math.min(Math.max(c.minPMI / 3, 0.5), 1.4);
      const entF = Math.min(Math.max(c.minEntropy / 2.5, 0.4), 1.3);
      score = c.effFreq * (1 + 0.25 * (c.n - 2)) * pmiF * entF;
    }
    c.score = +score.toFixed(3);
    c.term = [...c.surfaces.entries()].sort((a, b) => b[1] - a[1])[0][0];
    c.norm = c.key;
  }

  list.sort((a, b) => b.score - a.score || b.freq - a.freq);
  const top = list.slice(0, opts.topN);
  top.forEach((c, i) => {
    c.id = 'c' + (i + 1);
    c.contexts = c.occurrences.slice(0, 3).map(o => ({
      pair: o.pair,
      src: pairs[o.pair].src,
      tgt: pairs[o.pair].tgt
    }));
  });

  return {
    candidates: top,
    stats: {
      sentences: sents.length,
      rawCandidates: list.length,
      returned: top.length,
      minFreq: opts.minFreq,
      topN: opts.topN
    }
  };
}

module.exports = { extractCandidates, DEFAULTS };
