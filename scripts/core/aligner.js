'use strict';
/* Bilingual-Term-Extract —— Gale-Church 长度统计句对齐
 * 适配自 multi-align js/aligner.js（MIT License, tanyaqiong31029）。
 * 参考文献：Gale & Church (1993), "A Program for Aligning Sentences in Bilingual Corpora"
 * 增强：数字锚点加权、同文种词汇相似度加权、自然段锚定、超长文本滑窗分块。
 */

/* 误差函数（Abramowitz & Stegun 7.1.26 近似） */
function erf(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
/* 双侧概率 p = 2(1-Φ(|z|))，下限截断防止 log(0) */
function pd(z) {
  return Math.max(2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))), 1e-9);
}

/* 句对类型代价（-100·ln P，Gale-Church Table 5 换算） */
const PEN = { '11': 0, '12': 230, '21': 230, '22': 440, '10': 450, '01': 450 };
/* 句对类型置信度 */
const CONF = { '11': 0.95, '12': 0.72, '21': 0.72, '22': 0.5, '10': 0.15, '01': 0.15 };

function dice(a, b) {
  if (!a || !b || !a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return 2 * inter / (a.size + b.size);
}

/* 核心 DP：A、B 为句子对象数组（含 len/nums/tokens），返回 beads */
function alignPair(A, B, o) {
  const n = A.length, m = B.length;
  if (n === 0 || m === 0) {
    const beads = [];
    for (let i = 0; i < n; i++) beads.push({ a: [i], b: [], type: '1-0', conf: CONF['10'] });
    for (let j = 0; j < m; j++) beads.push({ a: [], b: [j], type: '0-1', conf: CONF['01'] });
    return beads;
  }

  const W = m + 1;
  const size = (n + 1) * (m + 1);
  const cost = new Float64Array(size).fill(Infinity);
  const prevIdx = new Int32Array(size).fill(-1);
  const typeArr = new Int8Array(size).fill(0);
  cost[0] = 0;

  /* 转移：(di,dj,类型码) 1-1 / 1-2 / 2-1 / 2-2 / 1-0 / 0-1 */
  const trans = [[1, 1, 1], [1, 2, 2], [2, 1, 3], [2, 2, 4], [1, 0, 5], [0, 1, 6]];
  const penOf = ['11', '12', '21', '22', '10', '01'];

  function beadCost(i, j, ni, nj, tk) {
    let la = 0, lb = 0;
    for (let x = i; x < ni; x++) la += A[x].len;
    for (let x = j; x < nj; x++) lb += B[x].len;
    let c;
    const sum = la + lb;
    if (sum <= 0) c = 0;
    else {
      const z = (lb - la) / Math.sqrt(sum * o.variance);
      c = -100 * Math.log(pd(z));
    }
    c += PEN[penOf[tk - 1]];

    if (o.numWeight > 0) {
      let na = null, nb = null;
      if (ni - i === 1) na = A[i].nums;
      else { na = new Set(); for (let x = i; x < ni; x++) A[x].nums.forEach(v => na.add(v)); }
      if (nj - j === 1) nb = B[j].nums;
      else { nb = new Set(); for (let x = j; x < nj; x++) B[x].nums.forEach(v => nb.add(v)); }
      if (na.size && nb.size) c -= o.numWeight * dice(na, nb);
      else if (na.size !== nb.size) c += o.numWeight * 0.2;
    }
    if (o.sameScript && o.lexWeight > 0) {
      let ta = null, tb = null;
      if (ni - i === 1) ta = A[i].tokens;
      else { ta = new Set(); for (let x = i; x < ni; x++) A[x].tokens.forEach(v => ta.add(v)); }
      if (nj - j === 1) tb = B[j].tokens;
      else { tb = new Set(); for (let x = j; x < nj; x++) B[x].tokens.forEach(v => tb.add(v)); }
      c -= o.lexWeight * dice(ta, tb);
    }
    return c;
  }

  for (let i = 0; i <= n; i++) {
    const iW = i * W;
    for (let j = 0; j <= m; j++) {
      const cur = cost[iW + j];
      if (!isFinite(cur)) continue;
      for (let t = 0; t < 6; t++) {
        const di = trans[t][0], dj = trans[t][1], tk = trans[t][2];
        const ni = i + di, nj = j + dj;
        if (ni > n || nj > m) continue;
        const c = cur + beadCost(i, j, ni, nj, tk);
        const nidx = ni * W + nj;
        if (c < cost[nidx]) { cost[nidx] = c; prevIdx[nidx] = iW + j; typeArr[nidx] = tk; }
      }
    }
  }

  /* 回溯 */
  const beads = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const idx = i * W + j;
    const tk = typeArr[idx];
    const p = prevIdx[idx];
    if (p < 0) break;
    const pi = (p / W) | 0, pj = p % W;
    const key = penOf[tk - 1];
    if (key === '11') beads.push({ a: [pi], b: [pj], type: '1-1', conf: CONF['11'] });
    else if (key === '12') beads.push({ a: [pi], b: [pj, pj + 1], type: '1-2', conf: CONF['12'] });
    else if (key === '21') beads.push({ a: [pi, pi + 1], b: [pj], type: '2-1', conf: CONF['21'] });
    else if (key === '22') beads.push({ a: [pi, pi + 1], b: [pj, pj + 1], type: '2-2', conf: CONF['22'] });
    else if (key === '10') beads.push({ a: [pi], b: [], type: '1-0', conf: CONF['10'] });
    else beads.push({ a: [], b: [pj], type: '0-1', conf: CONF['01'] });
    i = pi; j = pj;
  }
  beads.reverse();
  return beads;
}

/* 超长文本：按累计长度比例滑窗分块，避免 O(n·m) 爆内存 */
function alignLarge(A, B, o) {
  const n = A.length, m = B.length;
  if ((n + 1) * (m + 1) <= 2600000) return alignPair(A, B, o);

  const beads = [];
  const CH = 1100;
  const ratio = m / n;
  let bConsumed = 0;
  for (let a0 = 0; a0 < n; a0 += CH) {
    const a1 = Math.min(n, a0 + CH);
    const last = a1 >= n;
    const bLo = Math.min(bConsumed, m);
    let bHi;
    if (last) {
      bHi = m; // 末块消费全部剩余：右侧不留人工填充
    } else {
      // 内部块无右填充：删除珠代价远高于 1-2 合并，任何右侧填充都会被 DP 吸收。
      // 窗口宽度 = 全局比例 × 块大小，锚定在真实已消费位置，接缝处自校正。
      bHi = Math.min(m, bLo + Math.max(1, Math.round((a1 - a0) * ratio)));
    }
    if (bHi <= bLo) bHi = Math.min(m, bLo + 1);
    const sub = alignPair(A.slice(a0, a1), B.slice(bLo, bHi), o);
    for (const b of sub) {
      b.a = b.a.map(x => x + a0);
      b.b = b.b.map(x => x + bLo);
      if (b.b.length && b.b[0] < bConsumed) continue;
      if (b.b.length) bConsumed = Math.max(bConsumed, b.b[b.b.length - 1] + 1);
      beads.push(b);
    }
  }
  for (let j = bConsumed; j < m; j++) beads.push({ a: [], b: [j], type: '0-1', conf: CONF['01'] });
  beads.sort((x, y) => ((x.a[0] !== undefined ? x.a[0] : 1e9) - (y.a[0] !== undefined ? y.a[0] : 1e9)) ||
    ((x.b[0] !== undefined ? x.b[0] : 1e9) - (y.b[0] !== undefined ? y.b[0] : 1e9)));
  return beads;
}

/* 对外入口：先尝试自然段锚定（段落数一致时逐段对齐），否则全局（含滑窗） */
function alignTexts(A, B, o) {
  if (o.usePara && A.length && B.length) {
    const pa = A[A.length - 1].para + 1;
    const pb = B[B.length - 1].para + 1;
    if (pa === pb && pa > 1) {
      const groupsA = [], groupsB = [];
      A.forEach((s, k) => { (groupsA[s.para] = groupsA[s.para] || []).push(k); });
      B.forEach((s, k) => { (groupsB[s.para] = groupsB[s.para] || []).push(k); });
      const beads = [];
      for (let p = 0; p < pa; p++) {
        const ga = groupsA[p] || [], gb = groupsB[p] || [];
        if (!ga.length && !gb.length) continue;
        const sub = alignPair(ga.map(k => A[k]), gb.map(k => B[k]), o);
        for (const b of sub) {
          b.a = b.a.map(x => ga[x]);
          b.b = b.b.map(x => gb[x]);
          beads.push(b);
        }
      }
      return beads;
    }
  }
  return alignLarge(A, B, o);
}

module.exports = { alignTexts, alignPair, alignLarge, CONF };
