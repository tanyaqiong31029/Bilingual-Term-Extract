'use strict';
/* Bilingual-Term-Extract —— TMX 1.4 导入（正则解析，双端零依赖）
 * 只取每个 <tu> 内各 <tuv> 的 <seg> 文本；行内标签（<bpt>/<ept>/<it>/<ph>/<hi>）剥离。
 */
const { xmlUnescape } = require('./docximport.js');

function segText(segXml) {
  return xmlUnescape(String(segXml || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function normLangAttr(l) {
  return String(l || '').trim().replace(/_/g, '-').toLowerCase();
}

/* 返回 [{ langs: { 'en': '...', 'zh-cn': '...' } }, ...] */
function parseTmx(tmxText) {
  const tus = [];
  const tuRe = /<tu\b[\s\S]*?<\/tu\s*>/gi;
  let m;
  while ((m = tuRe.exec(tmxText))) {
    const tuXml = m[0];
    const langs = {};
    const tuvRe = /<tuv\b([^>]*)>([\s\S]*?)<\/tuv\s*>/gi;
    let t;
    while ((t = tuvRe.exec(tuXml))) {
      const attrs = t[1] || '';
      const lm = attrs.match(/xml:lang\s*=\s*["']([^"']+)["']/i) || attrs.match(/\blang\s*=\s*["']([^"']+)["']/i);
      if (!lm) continue;
      const lang = normLangAttr(lm[1]);
      if (!lang || langs[lang] !== undefined) continue;
      const sm = t[2].match(/<seg\b[^>]*>([\s\S]*?)<\/seg\s*>/i);
      if (!sm) continue;
      const txt = segText(sm[1]);
      if (txt) langs[lang] = txt;
    }
    if (Object.keys(langs).length >= 2) tus.push({ langs });
  }
  return tus;
}

/* 从 TMX 中抽取指定语言对的句对（语言前缀匹配：'en' 命中 'en-us'） */
function extractPairs(tmxText, srcLang, tgtLang) {
  const s = normLangAttr(srcLang);
  const t = normLangAttr(tgtLang);
  const pick = (langs, want) => {
    if (langs[want] !== undefined) return langs[want];
    const pre = want.split('-')[0];
    const key = Object.keys(langs).find(k => k === want || k.split('-')[0] === pre);
    return key !== undefined ? langs[key] : undefined;
  };
  const pairs = [];
  for (const tu of parseTmx(tmxText)) {
    const a = pick(tu.langs, s), b = pick(tu.langs, t);
    if (a && b) pairs.push({ src: a, tgt: b, conf: 1.0, origin: 'tmx' });
  }
  return pairs;
}

module.exports = { parseTmx, extractPairs, segText };
