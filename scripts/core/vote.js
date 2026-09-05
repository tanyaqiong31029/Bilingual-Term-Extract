'use strict';
/* Bilingual-Term-Extract —— 术语译文投票
 * 句级共现关联度（Dice）+ 合格词元连续段 + 跨度打分 + 两轮共识投票。
 *
 * 为什么不用 IBM Model 1 EM：文档级小语料上，EM 会把概率质量集中到高频虚词
 * （的/the 与几乎所有词共现），argmax 解码系统性偏向虚词（金标准实测全部对齐到"的"）。
 *
 * 算法要点（在金标准基准上迭代得出）：
 *   - Dice = 2·co/(dfT+dfF)：高频虚词天然低分；
 *   - 合格门槛：co ≥ 0.75·dfT（翻译成分须在多数出现句中伴随术语）+ Dice ≥ 0.3 + dfF ≥ 2；
 *   - brk（子句边界）只阻止跨度内部穿越，不阻止跨度起始（"，固件更新"的固是合法起点）；
 *   - 连续段的全部子跨度参与打分 Σdice − 0.3·max(0, 宽度−基准)；
 *   - 两轮共识：第一轮每处出现投最优 span；随后在票数并列时取「被包含者」为
 *     共识核，包含共识核的 span 改投共识核——抑制共现动词粘连（run machine learning /
 *     行机器学习），因为真术语核会在其他出现句中以更纯的形式独立胜出。
 * 方法论参考：bitext-lexind（词对齐→词条→过滤）、Anymalign（共现对齐）。
 */
const Tok = require('./tokenizer.js');
const U = require('./util.js');

const DEFAULTS = {
  slack: 3,          // 译文跨度最多比基准宽度多出的词元数
  coGate: 0.75,      // 合格门槛：co ≥ coGate·dfT（主闸：偶发同句词在此被挡）
  diceMin: 0.3,      // Dice 下限：只挡高频虚词；对多术语共享的字（网/器/边）
                     // dfF 会被其他术语稀释，门槛必须低（0.5 会把"物联网"的网踢出局）
  widthPenalty: 0.3  // 超出基准宽度后每个词元的罚分：须低于共享字的真实 Dice（~0.57），
                     // 否则"云服务器"会被裁成"云服务"
};

function voteTranslations(cands, pairs, opts) {
  opts = Object.assign({}, DEFAULTS, opts || {});
  const tgtToks = pairs.map(p => Tok.tokenize(p.tgt));
  const tgtCJK = pairs.length > 0 && U.isCJKText(pairs.map(p => p.tgt).join(''));

  /* 目标词元文档频次 dfF（按句去重） */
  const dfF = new Map();
  for (const toks of tgtToks) {
    const seen = new Set();
    for (const t of toks) {
      if (seen.has(t.norm)) continue;
      seen.add(t.norm);
      dfF.set(t.norm, (dfF.get(t.norm) || 0) + 1);
    }
  }

  for (let ci = 0; ci < cands.length; ci++) {
    const c = cands[ci];
    /* 按句聚合出现；术语-目标词元共现 co（按句去重） */
    const occByS = new Map();
    for (const occ of c.occurrences) {
      if (!occByS.has(occ.pair)) occByS.set(occ.pair, []);
      occByS.get(occ.pair).push(occ);
    }
    const dfT = occByS.size;
    const co = new Map();
    for (const [si] of occByS) {
      const seen = new Set();
      for (const t of tgtToks[si]) {
        if (seen.has(t.norm)) continue;
        seen.add(t.norm);
        co.set(t.norm, (co.get(t.norm) || 0) + 1);
      }
    }
    const coNeed = Math.max(1, opts.coGate * dfT);
    /* dfT=1：术语全部出现在同一句，无跨句统计证据，共现门槛坍缩为 1，
     * 句内一切字都"合格"——跳过投票，译文留给 LLM 精筛（SKILL.md 工作流第 2 步）。 */
    if (dfT < 2) {
      c.translations = [];
      c.statConf = 0;
      c.occTotal = c.occurrences.length;
      c.occVoted = 0;
      continue;
    }

    /* 第一轮：每处出现投得分最优 span（同句多出现共享同一最优 span） */
    const chosen = []; // [{pair, span:{lo,hi,phrase}|null}]
    for (const [si, occs] of occByS) {
      const tt = tgtToks[si];
      if (!tt.length) { for (let k = 0; k < occs.length; k++) chosen.push({ pair: si, span: null }); continue; }

      const D = new Map();
      for (const t of tt) {
        if (D.has(t.norm)) continue;
        D.set(t.norm, (2 * (co.get(t.norm) || 0)) / (dfT + (dfF.get(t.norm) || 1)));
      }
      const full = t => (co.get(t.norm) || 0) >= coNeed &&
        D.get(t.norm) >= opts.diceMin && (dfF.get(t.norm) || 0) >= 2;

      const baseline = tgtCJK ? c.n + 1 : Math.ceil(c.n / 2);
      const cap = c.n + opts.slack;
      const scoreSpan = (lo, hi, softIdx) => {
        let s = 0;
        for (let j = lo; j <= hi; j++) if (j !== softIdx) s += D.get(tt[j].norm) || 0;
        return s - opts.widthPenalty * Math.max(0, hi - lo + 1 - baseline);
      };
      let best = null;
      const consider = (lo, hi, softIdx) => {
        if (hi - lo + 1 > cap) return;
        const sc = scoreSpan(lo, hi, softIdx);
        if (!best || sc > best.score + 1e-9) best = { score: sc, lo, hi };
      };

      /* 合格词元连续段：brk 词元可开新段，不可续接（跨度内部不穿子句边界） */
      const runs = [];
      let run = [];
      for (let j = 0; j < tt.length; j++) {
        if (!full(tt[j])) { if (run.length) { runs.push(run); run = []; } continue; }
        if (run.length && tt[j].brk) { runs.push(run); run = [j]; }
        else run.push(j);
      }
      if (run.length) runs.push(run);

      for (const r of runs) {
        const lo0 = r[0], hi0 = r[r.length - 1];
        /* 全部子跨度 */
        for (let lo = lo0; lo <= hi0; lo++) {
          for (let hi = lo; hi <= hi0 && hi - lo + 1 <= cap; hi++) consider(lo, hi, -1);
        }
      }

      if (!best) { for (let k = 0; k < occs.length; k++) chosen.push({ pair: si, span: null }); continue; }
      const phrase = Tok.joinTokens(tt.slice(best.lo, best.hi + 1));
      if (process.env.BTE_DEBUG === c.norm || process.env.BTE_DEBUG === '*') {
        console.error('[vote] cand=' + c.term + ' sent=' + si +
          ' runs=' + JSON.stringify(runs.map(r => r.map(j => tt[j].norm))) +
          ' best=' + JSON.stringify(tt.slice(best.lo, best.hi + 1).map(t => t.norm)) +
          ' score=' + best.score.toFixed(2));
      }
      for (let k = 0; k < occs.length; k++) chosen.push({ pair: si, span: { lo: best.lo, hi: best.hi, phrase } });
    }

    /* 第二轮：共识核改投。核心规则：若第一轮某短语 A 严格包含另一短语 B（如
     * "行机器学习" ⊃ "机器学习"、"模型训练完" ⊃ "模型训练"），则 B 为共识核——
     * 真术语核会在其他出现句中以更纯的形式独立胜出，包含它的粘连带应归顺于它。
     * 无包含关系时不改投（平票互不包含则各自保留，交给 LLM 精筛）。 */
    const pass1 = new Map();
    for (const ch of chosen) {
      if (ch.span && ch.span.phrase) pass1.set(ch.span.phrase, (pass1.get(ch.span.phrase) || 0) + 1);
    }
    let core = null;
    for (const [a, ca] of pass1) {
      for (const [b, cb] of pass1) {
        if (a === b || a.indexOf(b) < 0) continue;
        if (!core || cb > core.cnt || (cb === core.cnt && b.length < core.phrase.length)) {
          core = { phrase: b, cnt: cb };
        }
      }
    }
    if (!core) {
      let top = null;
      for (const [phrase, cnt] of pass1) {
        if (!top || cnt > top.cnt) top = { phrase, cnt };
      }
      if (top && top.cnt >= 2) core = { phrase: top.phrase, cnt: top.cnt };
    }
    const votes = new Map();
    let total = chosen.length;
    for (const ch of chosen) {
      let phrase = ch.span && ch.span.phrase;
      if (core && phrase && phrase !== core.phrase && phrase.indexOf(core.phrase) >= 0) phrase = core.phrase;
      if (phrase) votes.set(phrase, (votes.get(phrase) || 0) + 1);
    }

    const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    c.translations = sorted.map(([t, v]) => ({ t, votes: v }));
    c.statConf = total ? +((sorted[0] ? sorted[0][1] : 0) / total).toFixed(3) : 0;
    c.occTotal = total;
    c.occVoted = sorted[0] ? sorted[0][1] : 0;
  }
  return cands;
}

module.exports = { voteTranslations, DEFAULTS };
