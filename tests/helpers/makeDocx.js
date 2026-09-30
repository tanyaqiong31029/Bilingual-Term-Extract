'use strict';
/* 测试辅助：零依赖构造最小合法 DOCX（ZIP STORE / DEFLATE 格式）。
 * 只实现 scripts/core/docximport.js unzipEntry 所需结构：
 * 本地文件头（30B）+ 文件名 + 数据 + 中央目录（46B/项）+ EOCD（22B）。
 * crc32 复用 docximport 导出的实现，避免两份表。 */
const zlib = require('zlib');
const { crc32 } = require('../../scripts/core/docximport.js');

function makeZip(entries) { // entries: [{name, data: Buffer, deflate?: bool}]
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const method = e.deflate ? 8 : 0;
    const payload = e.deflate ? zlib.deflateRawSync(e.data) : e.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // 本地文件头签名
    local.writeUInt16LE(20, 4);         // 解压所需版本
    local.writeUInt16LE(method, 8);     // 0=STORE 8=DEFLATE
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18); // 压缩后大小
    local.writeUInt32LE(e.data.length, 22);  // 原始大小
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, payload);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); // 中央目录签名
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(method, 10); // 压缩方式（与本地头一致）
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(payload.length, 20);
    cen.writeUInt32LE(e.data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42); // 本地头偏移
    central.push(Buffer.concat([cen, name]));
    offset += 30 + name.length + payload.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, eocd]);
}

/* 段落便捷构造 */
function pText(text) {
  return '<w:p><w:r><w:t xml:space="preserve">' + text + '</w:t></w:r></w:p>';
}

function docxXml(paragraphs) {
  return Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paragraphs.join('') + '<w:sectPr/></w:body></w:document>', 'utf8');
}

function makeDocx(paragraphs) {
  return makeZip([
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types/>') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0"?><Relationships/>') },
    { name: 'word/document.xml', data: docxXml(paragraphs) }
  ]);
}

module.exports = { makeZip, makeDocx, docxXml, pText };
