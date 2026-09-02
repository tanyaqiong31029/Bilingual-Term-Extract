'use strict';
/* Bilingual-Term-Extract —— 通用工具
 * charClass / weightedLen / isCJKText 适配自 multi-align（MIT License, tanyaqiong31029）
 */

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function timestamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
}

/* ---------- 字符类别（长度加权 / 分句 / 语言检测共用） ---------- */
function charClass(cp) {
  if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) ||
      (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0x20000 && cp <= 0x2FA1F)) return 'han';
  if (cp >= 0x3041 && cp <= 0x309F) return 'hira';
  if (cp >= 0x30A1 && cp <= 0x30FF) return 'kata';
  if ((cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0x1100 && cp <= 0x11FF) || (cp >= 0x3130 && cp <= 0x318F)) return 'hangul';
  if (cp >= 0x0E00 && cp <= 0x0E7F) return 'thai';
  if ((cp >= 0x0600 && cp <= 0x06FF) || (cp >= 0x0750 && cp <= 0x077F) ||
      (cp >= 0xFB50 && cp <= 0xFDFF) || (cp >= 0xFE70 && cp <= 0xFEFF)) return 'arabic';
  if (cp >= 0x0900 && cp <= 0x097F) return 'deva';
  if (cp >= 0x0400 && cp <= 0x04FF) return 'cyrillic';
  if (cp >= 0x0370 && cp <= 0x03FF) return 'greek';
  if ((cp >= 0x0041 && cp <= 0x005A) || (cp >= 0x0061 && cp <= 0x007A) ||
      (cp >= 0x00C0 && cp <= 0x024F) || (cp >= 0x1E00 && cp <= 0x1EFF) ||
      (cp >= 0x0100 && cp <= 0x017F)) return 'latin';
  if ((cp >= 0x0030 && cp <= 0x0039) || (cp >= 0xFF10 && cp <= 0xFF19)) return 'digit';
  if (cp === 0x20 || cp === 0x09 || cp === 0x3000 || cp === 0x0A) return 'space';
  return 'other';
}

/* 加权长度：汉字 2.3 / 假名 1.8 / 谚文 2.1 / 泰文 1.6 / 其他 1.0 —— 使跨文种句长可比较 */
function weightedLen(text) {
  let w = 0;
  for (const ch of String(text || '')) {
    const c = charClass(ch.codePointAt(0));
    w += c === 'han' ? 2.3 : (c === 'hira' || c === 'kata') ? 1.8 : c === 'hangul' ? 2.1 : c === 'thai' ? 1.6 : 1;
  }
  return w;
}

/* 粗略判断文本是否为 CJK 文种 */
function isCJKText(text) {
  const t = String(text || '');
  if (!t) return false;
  let cjk = 0, total = 0;
  for (const ch of t) {
    const c = charClass(ch.codePointAt(0));
    if (c === 'han' || c === 'hira' || c === 'kata') cjk++;
    if (c !== 'space' && c !== 'other' && c !== 'digit') total++;
  }
  return total > 0 && cjk / total > 0.3;
}

/* 语言代码归一：en-US → en，zh_CN → zh-CN（保留显式简繁） */
function normLang(lang) {
  let l = String(lang || '').trim().replace(/_/g, '-');
  if (!l) return '';
  const lower = l.toLowerCase();
  if (lower === 'zh' || lower === 'zh-hans') return 'zh-CN';
  if (lower === 'zh-hant' || lower === 'zh-tw' || lower === 'zh-hk') return lower === 'zh-hant' ? 'zh-TW' : l;
  const main = lower.split('-')[0];
  const KNOWN = ['en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'ar', 'th', 'vi', 'id', 'ms', 'tr', 'nl', 'pl', 'uk'];
  if (KNOWN.includes(main)) return main;
  return l;
}

module.exports = { escapeXml, timestamp, charClass, weightedLen, isCJKText, normLang };
