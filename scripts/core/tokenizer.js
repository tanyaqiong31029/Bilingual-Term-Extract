'use strict';
/* Bilingual-Term-Extract —— 分词器
 * 拉丁文：连续字母/数字/连字符/撇号为一个词元；CJK：逐字成词元（对齐与 n-gram 统一的粒度）。
 * norm 为小写 + 轻量单数折叠（仅用于统计与对齐，term 展示用 surface）。
 * brk 标记"此词元前存在子句标点"——候选 n-gram 不得跨越 brk。
 */
const U = require('./util.js');

/* 轻量单数折叠：保证统计一致性即可，不追求语言学正确 */
function foldSingular(w) {
  if (w.length < 4) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/(sses|shes|ches|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (/(ss|us|is)$/.test(w)) return w;
  if (/s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
  return w;
}

function isCJKChar(ch) {
  const c = U.charClass(ch.codePointAt(0));
  return c === 'han' || c === 'hira' || c === 'kata';
}

/* 子句标点：出现在词元之间即视为不可跨越的边界（词元内部的连字符不经过此处） */
const PUNCT_RE = /[\p{P}\p{S}]/u;

/* 分词：返回 [{surface, norm, cjk, brk, start, end}] */
function tokenize(text) {
  const t = String(text || '');
  const out = [];
  let i = 0, pendingBrk = false;
  const L = t.length;
  while (i < L) {
    const ch = t[i];
    if (isCJKChar(ch)) {
      out.push({ surface: ch, norm: ch, cjk: true, brk: pendingBrk, start: i, end: i + 1 });
      pendingBrk = false; i++;
      continue;
    }
    if (/[\p{L}\p{N}]/u.test(ch)) {
      // 累积拉丁/数字词元（允许内部连字符、撇号）
      let j = i + 1;
      while (j < L && /[\p{L}\p{N}'’\-]/u.test(t[j]) && !isCJKChar(t[j])) j++;
      // 去掉首尾连字符（如 " -5 " 的孤立连字符）
      let s = i, e = j;
      while (s < e && /[-'’]/.test(t[s])) s++;
      while (e > s && /[-'’]/.test(t[e - 1])) e--;
      if (e > s) {
        const surface = t.slice(s, e);
        out.push({ surface, norm: foldSingular(surface.toLowerCase()), cjk: false, brk: pendingBrk, start: s, end: e });
      }
      pendingBrk = false; i = j;
      continue;
    }
    if (PUNCT_RE.test(ch)) pendingBrk = true;
    i++;
  }
  return out;
}

/* 词元列表 → 展示文本（拉丁以空格连接，CJK 直接拼接） */
function joinTokens(toks) {
  if (!toks || !toks.length) return '';
  if (toks.every(x => x.cjk)) return toks.map(x => x.surface).join('');
  return toks.map(x => x.surface).join(' ');
}

/* 词元列表 → 统计键（norm） */
function keyOf(toks) {
  if (!toks || !toks.length) return '';
  if (toks.every(x => x.cjk)) return toks.map(x => x.norm).join('');
  return toks.map(x => x.norm).join(' ');
}

module.exports = { tokenize, joinTokens, keyOf, foldSingular, isCJKChar };
