'use strict';
/* Bilingual-Term-Extract —— SRT/VTT 字幕导入
 * 解析适配自 multi-align js/srt.js（MIT License, tanyaqiong31029），只保留导入侧。
 * 宽容解析：VTT 头、无小时时间戳、毫秒点/逗号、序号行可有可无；<i>/<font> 与
 * {\an8} 位置标签清洗。每条 cue 输出为一个自然段（空行分隔）——字幕 cue 天然是
 * "同序小段"，下游 Gale-Church 的段落锚定在 cue 数接近的双语字幕上几乎零误差。
 */

/* "00:01:02,500" / "00:01:02.500" / VTT 的 "01:02.500" → 毫秒 */
function tsToMs(tok) {
  const m = String(tok).trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const ms = parseInt((m[4] + '00').slice(0, 3), 10);
  return ((h * 60 + parseInt(m[2], 10)) * 60 + parseInt(m[3], 10)) * 1000 + ms;
}

/* 去除 <i> <font> 等 HTML 标签与 {\an8} 位置标签 */
function cleanText(line) {
  return String(line)
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeSrt(text) {
  const t = String(text || '');
  return /-->\s*(?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d{1,3}/.test(t) || /^\uFEFF?WEBVTT/i.test(t.trim());
}

/* 宽容解析：返回 [{start, end, text}]，按起始时间排序 */
function parse(text) {
  const src = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const tsRe = /((?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d{1,3})/;
  const cues = [];
  for (const block of src.split(/\n{2,}/)) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l !== '');
    if (!lines.length) continue;
    let ti = -1, m = null;
    for (let i = 0; i < lines.length; i++) {
      m = lines[i].match(tsRe);
      if (m) { ti = i; break; }
    }
    if (ti < 0) continue; // WEBVTT 头 / NOTE / 空块
    const t0 = tsToMs(m[1]), t1 = tsToMs(m[2]);
    if (t0 === null || t1 === null) continue;
    const body = lines.slice(ti + 1).map(cleanText).filter(x => x !== '').join(' ');
    if (!body || t1 <= t0) continue;
    cues.push({ start: t0, end: t1, text: body });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/* SRT/VTT 全文 → 纯文本：每条 cue 一个自然段 */
function cuesToText(text) {
  return parse(text).map(c => c.text).join('\n\n') + '\n';
}

module.exports = { tsToMs, cleanText, looksLikeSrt, parse, cuesToText };
