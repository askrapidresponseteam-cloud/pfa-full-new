'use strict';

/* A small, dependency-free reader for .xlsx workbooks (26 Oct 2026), made for
   the old site's membership list (lib/old-members.js). It reads what that
   needs and nothing more: every sheet in workbook order, each cell's text or
   number, and merged ranges. Formulas give their cached value; styles,
   comments and pictures are ignored.

   An .xlsx is a zip of XML parts. The zip is read from its central
   directory, and a workbook that would unpack past MAX_UNPACKED, or that
   holds more parts than MAX_PARTS, is refused before anything is inflated,
   so an upload cannot be used to exhaust the server's memory. */

const zlib = require('zlib');

const MAX_UNPACKED = 80 * 1024 * 1024;
const MAX_PARTS = 2000;

class XlsxError extends Error {
  constructor(message) { super(message); this.name = 'XlsxError'; this.code = 'BAD_WORKBOOK'; }
}

function unzip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new XlsxError('That file is not a spreadsheet.');
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new XlsxError('That file is not an Excel .xlsx workbook.');
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  if (count > MAX_PARTS) throw new XlsxError('That workbook has too many parts to read.');
  const entries = [];
  let total = 0;
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== 0x02014b50) throw new XlsxError('That workbook is damaged.');
    const method = buffer.readUInt16LE(at + 10);
    const packed = buffer.readUInt32LE(at + 20);
    const size = buffer.readUInt32LE(at + 24);
    const nameLen = buffer.readUInt16LE(at + 28);
    const extraLen = buffer.readUInt16LE(at + 30);
    const commentLen = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLen);
    total += size;
    if (total > MAX_UNPACKED) throw new XlsxError('That workbook is too large to read.');
    entries.push({ name, method, packed, size, local });
    at += 46 + nameLen + extraLen + commentLen;
  }
  const parts = new Map();
  for (const e of entries) {
    if (e.local + 30 > buffer.length || buffer.readUInt32LE(e.local) !== 0x04034b50) throw new XlsxError('That workbook is damaged.');
    const start = e.local + 30 + buffer.readUInt16LE(e.local + 26) + buffer.readUInt16LE(e.local + 28);
    const raw = buffer.subarray(start, start + e.packed);
    parts.set(e.name, { raw, method: e.method, size: e.size });
  }
  return {
    has: (name) => parts.has(name),
    text(name) {
      const p = parts.get(name);
      if (!p) return '';
      if (p.method === 0) return p.raw.toString('utf8');
      if (p.method !== 8) throw new XlsxError('That workbook uses a compression this reader does not know.');
      return zlib.inflateRawSync(p.raw, { maxOutputLength: Math.max(p.size, 1) + 1024 }).toString('utf8');
    }
  };
}

function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/* The text of an <si> or <is>: every <t>, in order, without phonetic runs. */
function runText(xml) {
  const body = String(xml).replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
  let m;
  while ((m = re.exec(body))) out += m[1] ? decode(m[1]) : '';
  return out;
}

function attrs(s) {
  const out = {};
  const re = /([\w:]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = decode(m[2]);
  return out;
}

function colNumber(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function colLetters(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function splitRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(String(ref || '').toUpperCase());
  return m ? { col: m[1], row: Number(m[2]) } : null;
}

function readSheet(xml, shared) {
  const rows = new Map();
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm;
  let lastRow = 0;
  while ((rm = rowRe.exec(xml))) {
    const ra = attrs(rm[1]);
    const r = ra.r ? Number(ra.r) : lastRow + 1;
    lastRow = r;
    if (!rm[2]) continue;
    const cells = {};
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    let lastCol = 0;
    while ((cm = cellRe.exec(rm[2]))) {
      const ca = attrs(cm[1]);
      const at = splitRef(ca.r);
      const col = at ? at.col : colLetters(lastCol + 1);
      lastCol = colNumber(col);
      const inner = cm[2] || '';
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
      let value = null;
      if (ca.t === 's') value = v ? (shared[Number(v[1])] ?? '') : '';
      else if (ca.t === 'inlineStr') value = runText((/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner) || [])[1] || '');
      else if (ca.t === 'str' || ca.t === 'e') value = v ? decode(v[1]) : '';
      else if (ca.t === 'b') value = v ? v[1] === '1' : null;
      else if (v) { const num = Number(v[1]); value = Number.isFinite(num) ? num : decode(v[1]); }
      if (value === null || value === '') continue;
      cells[col] = value;
    }
    if (Object.keys(cells).length) rows.set(r, cells);
  }
  const merges = [];
  const mergeRe = /<mergeCell\b[^>]*ref="([A-Z]+\d+):([A-Z]+\d+)"/g;
  let mm;
  while ((mm = mergeRe.exec(xml))) merges.push({ from: splitRef(mm[1]), to: splitRef(mm[2]) });
  /* a merged range shows its top-left value in every cell it covers */
  for (const { from, to } of merges) {
    if (!from || !to) continue;
    const top = (rows.get(from.row) || {})[from.col];
    if (top === undefined) continue;
    for (let r = from.row; r <= to.row; r += 1) {
      for (let c = colNumber(from.col); c <= colNumber(to.col); c += 1) {
        const row = rows.get(r) || {};
        const key = colLetters(c);
        if (row[key] === undefined) { row[key] = top; rows.set(r, row); }
      }
    }
  }
  return rows;
}

/* readWorkbook(buffer) -> { sheets: [{ name, rows: Map<rowNumber, { A: value, ... }> }], date1904 } */
function readWorkbook(buffer) {
  const zip = unzip(buffer);
  if (!zip.has('xl/workbook.xml')) throw new XlsxError('That file is not an Excel .xlsx workbook.');
  const book = zip.text('xl/workbook.xml');
  const rels = {};
  const relRe = /<Relationship\b([^>]*)\/?>/g;
  let m;
  const relXml = zip.text('xl/_rels/workbook.xml.rels');
  while ((m = relRe.exec(relXml))) { const a = attrs(m[1]); if (a.Id) rels[a.Id] = a.Target; }
  const shared = [];
  const sst = zip.text('xl/sharedStrings.xml');
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  while ((m = siRe.exec(sst))) shared.push(m[1] ? runText(m[1]) : '');
  const pr = /<workbookPr\b([^>]*)/.exec(book);
  const date1904 = pr ? /date1904="(1|true)"/.test(pr[1]) : false;
  const sheets = [];
  const sheetRe = /<sheet\b([^>]*)\/?>/g;
  while ((m = sheetRe.exec(book))) {
    const a = attrs(m[1]);
    const target = rels[a['r:id']];
    if (!target) continue;
    const part = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    sheets.push({ name: a.name || '', rows: readSheet(zip.text(part), shared) });
  }
  if (!sheets.length) throw new XlsxError('That workbook has no sheets.');
  return { sheets, date1904 };
}

/* An Excel date serial as YYYY-MM-DD (the 1900 system counts a 29 Feb 1900
   that never was, which is why the epoch is 30 Dec 1899). */
function serialDate(serial, date1904) {
  if (typeof serial !== 'number' || !Number.isFinite(serial) || serial <= 0 || serial > 2958465) return '';
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.round(serial * 86400000)).toISOString().slice(0, 10);
}

module.exports = { readWorkbook, serialDate, XlsxError, _private: { unzip, decode, runText, colLetters, colNumber } };
