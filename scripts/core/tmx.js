'use strict';
/* Bilingual-Term-Extract —— TMX 1.4 导入（正则解析，双端零依赖）
 * 只取每个 <tu> 内各 <tuv> 的 <seg> 文本；行内标签按 TMX 元素语义处理：
 *   - bpt/ept/it/ph：原生格式代码，元素内容本身就是转义后的原生标记
 *     （如 <bpt i="1">&lt;b&gt;</bpt>）——连内容一起移除，否则 <b> 会污染术语正文；
 *   - hi：高亮包裹（内容是译文正文）——去壳留内容；
 *   - 其余未知标签：剥壳留内容。
 */
const { xmlUnescape } = require('./docximport.js');

/* 原生代码元素（含内容移除）：配对与自闭合两种形态 */
const CODE_RE = /<(?:bpt|ept|it|ph)\b[^>]*>[\s\S]*?<\/(?:bpt|ept|it|ph)\s*>|<(?:bpt|ept|it|ph)\b[^>]*\/>/gi;

function segText(segXml) {
  return xmlUnescape(String(segXml || '')
    .replace(CODE_RE, '')
    .replace(/<hi\b[^>]*>([\s\S]*?)<\/hi\s*>/gi, '$1')
    .replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ').trim();
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
