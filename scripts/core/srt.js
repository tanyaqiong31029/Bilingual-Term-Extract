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

/* 宽容解析：返回 [{start, end, text, lines}]，按起始时间排序。
 * lines 为清洗后的行级文本（双语拆分依赖行结构），text = lines 以空格连接。 */
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
    const body = lines.slice(ti + 1).map(cleanText).filter(x => x !== '');
    if (!body.length || t1 <= t0) continue;
    cues.push({ start: t0, end: t1, text: body.join(' '), lines: body });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/* SRT/VTT 全文 → 纯文本：每条 cue 一个自然段 */
function cuesToText(text) {
  return parse(text).map(c => c.text).join('\n\n') + '\n';
}

/* ---------- 单文件双语字幕拆分 ---------- */
const U = require('./util.js');
const Seg = require('./segmenter.js');

/* 行级文字系统分类：cjk（汉/假名/谚文主导）/ latin / other；无文字返回 null。
 * 并列时按 cjk > latin > other 的固定优先级，保证同一行分类稳定。 */
function lineScript(line) {
  let cjk = 0, latin = 0, other = 0;
  for (const ch of String(line || '')) {
    const c = U.charClass(ch.codePointAt(0));
    if (c === 'han' || c === 'hira' || c === 'kata' || c === 'hangul') cjk++;
    else if (c === 'latin') latin++;
    else if (c === 'cyrillic' || c === 'greek' || c === 'arabic' || c === 'thai') other++;
  }
  if (cjk > 0 && cjk >= latin && cjk >= other) return 'cjk';
  if (latin > 0 && latin >= other) return 'latin';
  if (other > 0) return 'other';
  return null;
}

/* 把单文件双语字幕拆成句对。支持两种排版（自动识别）：
 *  - same-cue：同一 cue 内多行各属一种语言（含 3 行以上混排，取最大的两组）
 *  - alternating / 分块：cue 各为单一语言，按出现顺序两两配对
 * 返回 { pairs: [{src, tgt}], srcLang, tgtLang, pattern, stats }。
 * 限制：两种语言须分属不同文字系统（en↔zh / en↔ru 可行；en↔fr 同为拉丁请用 --pairs）。
 */
function splitBilingual(text, opts) {
  opts = opts || {};
  const cues = parse(text);
  if (cues.length < 2) throw new Error('双语字幕至少需要 2 条 cue，实际解析到 ' + cues.length + ' 条');

  const perCue = cues.map(c => ({ lines: c.lines, keys: c.lines.map(lineScript) }));
  const mixedCues = perCue.filter(p => new Set(p.keys.filter(k => k)).size >= 2).length;
  const pattern = mixedCues >= cues.length / 2 ? 'same-cue' : 'alternating';

  let pairs = [];           // [{a, b}] 待定方向
  let skipped = 0;

  if (pattern === 'same-cue') {
    for (const p of perCue) {
      const groups = {};
      for (let i = 0; i < p.lines.length; i++) {
        const k = p.keys[i];
        if (!k) { skipped++; continue; }
        (groups[k] = groups[k] || []).push(p.lines[i]);
      }
      const ks = Object.keys(groups).sort((x, y) => groups[y].length - groups[x].length);
      if (ks.length < 2) { skipped++; continue; }
      pairs.push({ a: groups[ks[0]].join(' '), b: groups[ks[1]].join(' ') });
      skipped += ks.slice(2).reduce((s, k) => s + groups[k].length, 0);
    }
  } else {
    const buckets = {};
    for (const p of perCue) {
      const k = p.keys.find(k => k);
      if (!k) { skipped++; continue; }
      (buckets[k] = buckets[k] || []).push(p.lines.join(' '));
    }
    const ks = Object.keys(buckets).sort((x, y) => buckets[y].length - buckets[x].length);
    if (ks.length < 2) throw new Error('字幕中只检测到一种文字系统（' + ks[0] + '），无法双语拆分');
    const n = Math.min(buckets[ks[0]].length, buckets[ks[1]].length);
    for (let i = 0; i < n; i++) pairs.push({ a: buckets[ks[0]][i], b: buckets[ks[1]][i] });
    skipped += buckets[ks[0]].length - n + buckets[ks[1]].length - n +
      ks.slice(2).reduce((s, k) => s + buckets[k].length, 0);
  }
  if (!pairs.length) throw new Error('未能从字幕中拆出任何双语对（skipped=' + skipped + '）');

  /* 语言归属 + 源语侧选择 */
  const langA = Seg.detectLang(pairs.map(p => p.a).join('\n')) || 'en';
  const langB = Seg.detectLang(pairs.map(p => p.b).join('\n')) || 'zh-CN';
  let srcIsA;
  if (opts.srcLang) {
    const want = U.normLang(opts.srcLang).split('-')[0];
    const aIs = U.normLang(langA).split('-')[0] === want;
    const bIs = U.normLang(langB).split('-')[0] === want;
    if (aIs === bIs) throw new Error('--src-lang ' + opts.srcLang + ' 与字幕两侧语言（' + langA + ' / ' + langB + '）不匹配');
    srcIsA = aIs;
  } else {
    srcIsA = true; // 默认先出现的语言为源语，调用方负责告警
  }
  const out = pairs.map(p => ({ src: srcIsA ? p.a : p.b, tgt: srcIsA ? p.b : p.a, conf: 1.0, origin: 'srt-bilingual' }));
  return {
    pairs: out,
    srcLang: srcIsA ? langA : langB,
    tgtLang: srcIsA ? langB : langA,
    pattern,
    stats: { cues: cues.length, pairs: out.length, skipped }
  };
}

module.exports = { tsToMs, cleanText, looksLikeSrt, parse, cuesToText, lineScript, splitBilingual };
