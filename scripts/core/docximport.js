'use strict';
/* Bilingual-Term-Extract —— 文件导入（Node 版）
 * DOCX 读取适配自 multi-align js/docximport.js（MIT License, tanyaqiong31029），
 * 解压改用 node:zlib（无浏览器 API 依赖）；TXT 支持 UTF-8 / GBK / Big5 自动识别。
 */
const fs = require('fs');
const zlib = require('zlib');
const Srt = require('./srt.js');

const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

/* ---------- 迷你 ZIP 读取器（支持 STORE 与 DEFLATE） ---------- */
function unzipEntry(buffer, wantedName) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65558); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP/DOCX 文件');
  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);
  let found = null;
  for (let n = 0; n < count && ptr + 46 <= u8.length; n++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break;
    const method = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const cmtLen = dv.getUint16(ptr + 32, true);
    const lho = dv.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));
    if (name === wantedName) found = { method: method, compSize: compSize, lho: lho };
    ptr += 46 + nameLen + extraLen + cmtLen;
  }
  if (!found) throw new Error('ZIP 中未找到 ' + wantedName);
  const ln = dv.getUint16(found.lho + 26, true);
  const le = dv.getUint16(found.lho + 28, true);
  const dataStart = found.lho + 30 + ln + le;
  const data = u8.subarray(dataStart, dataStart + found.compSize);
  if (found.method === 0) return data;
  if (found.method === 8) {
    return zlib.inflateRawSync(Buffer.from(data));
  }
  throw new Error('不支持的压缩方式');
}

/* ---------- DOCX → 纯文本（保留段落，段落间空行分隔以启用段落锚定） ---------- */
function xmlUnescape(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, '&');
}

function paraText(pXml) {
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>/g;
  let m;
  while ((m = re.exec(pXml))) {
    if (m[1] !== undefined) out += xmlUnescape(m[1]);
    else if (m[0].indexOf('tab') >= 0) out += '\t';
    else out += '\n';
  }
  return out;
}

function readDocxText(buf) {
  const xmlU8 = unzipEntry(buf, 'word/document.xml');
  const xml = new TextDecoder('utf-8').decode(xmlU8);
  const lines = [];
  const pRe = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = pRe.exec(xml))) {
    lines.push(paraText(m[0]).replace(/\u00a0/g, ' ').trim());
  }
  if (!lines.length) throw new Error('未能从 DOCX 中提取到正文');
  return lines.join('\n\n');
}

/* ---------- TXT 编码识别（UTF-8 → UTF-16LE BOM → GBK / Big5 / Shift-JIS / EUC-KR） ---------- */
function decodeText(buffer) {
  const u8 = new Uint8Array(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8);
  } catch (e) { /* 继续 */ }
  if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) {
    try { return new TextDecoder('utf-16le').decode(u8); } catch (e2) { /* 继续 */ }
  }
  for (const enc of ['gbk', 'big5', 'shift_jis', 'euc-kr']) {
    try { return new TextDecoder(enc, { fatal: true }).decode(u8); } catch (e) { /* 尝试下一个 */ }
  }
  return new TextDecoder('utf-8').decode(u8);
}

/* 任意路径 → 文本（.txt / .md / .docx / .srt / .vtt） */
function readAnyPath(path) {
  const name = String(path).toLowerCase();
  const buf = fs.readFileSync(path);
  if (name.endsWith('.docx')) return { text: readDocxText(buf), type: 'docx' };
  if (name.endsWith('.doc')) throw new Error('暂不支持旧版 .doc，请在 Word 中另存为 .docx 或 .txt');
  if (name.endsWith('.srt') || name.endsWith('.vtt')) {
    return { text: Srt.cuesToText(decodeText(buf)), type: 'srt' };
  }
  return { text: decodeText(buf), type: 'txt' };
}

module.exports = { readAnyPath, readDocxText, decodeText, unzipEntry, xmlUnescape, crc32: (u8) => {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
} };
