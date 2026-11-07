'use strict';

/* The donation receipt, as a PDF in PFA's own type (owner, 31 Oct 2026:
   "hope donation receipt can be downloaded - pdf in pfa template!").

   Written by hand on the server, with no PDF library: one A4 page, the PFA
   logo, Marcellus for the headings and EB Garamond for the words and
   figures (both embedded, lib/receipt-assets.js), ink on white, the site's
   look. It is made only for a donation the bank has confirmed
   (lib/routes/payment/receipt.js checks), from what the transaction holds:

     the receipt number   PFA-DON-..., the donation's own record
     the amount           in figures and in words
     the donor            name, address and PAN, as given on donate.html
     the payment          date, PFA transaction ID, bank reference,
                          CCAvenue tracking ID, mode
     what it is for       the cause, and the person a gift was given for

   The standard PDF fonts cannot draw the rupee sign, and neither font here
   has one, so amounts read "INR 5,000.00", the form a bank statement uses.
   It never claims an 80G registration number it does not hold: it says what
   the site already says, that donations are eligible under Section 80G,
   and how to ask PFA's office for the certificate.

   Access: a receipt carries a PAN and a postal address, so it is reached
   only with the random key kept on the transaction (keyFor below), not by
   the transaction ID alone. */

const crypto = require('crypto');
const zlib = require('zlib');

const A4 = { w: 595.28, h: 841.89 };
const OFFICE = '4-T, DCM Building, 16 Barakhamba Road, New Delhi 110001, India';
const SITE = 'peopleforanimalsindia.org';
const KEY = /^[A-Za-z0-9_-]{24}$/;

let assets = null;
const asset = () => { if (!assets) assets = require('./receipt-assets'); return assets; };

/* ---- the key a receipt is reached with ------------------------------- */

/* Given once, on the success callback, and kept: the same key for every
   later page, letter and panel action, so a link sent once keeps working.
   Also stamps receiptIssuedAt, the receipt's date. */
async function keyFor(db, orderId, nowMs = Date.now()) {
  const ref = db.collection('transactions').doc(orderId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('No such transaction.');
    const t = snap.data() || {};
    if (KEY.test(String(t.receiptKey || ''))) return { key: t.receiptKey, issuedAt: t.receiptIssuedAt || '' };
    const key = crypto.randomBytes(18).toString('base64url');
    const issuedAt = new Date(nowMs).toISOString();
    tx.update(ref, { receiptKey: key, receiptIssuedAt: issuedAt });
    return { key, issuedAt };
  });
}

function keyMatches(held, given) {
  const a = Buffer.from(String(held || ''));
  const b = Buffer.from(String(given || ''));
  return KEY.test(String(given || '')) && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function urlFor(siteUrl, orderId, key) {
  const base = String(siteUrl || '').replace(/\/+$/, '');
  return `${base}/api/payment/receipt?order=${encodeURIComponent(orderId)}&k=${encodeURIComponent(key)}`;
}

/* ---- words ------------------------------------------------------------ */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '');
}
function belowThousand(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? belowHundred(r) : ''].filter(Boolean).join(' ');
}
/* Indian grouping: crore, lakh, thousand */
function indianWords(n) {
  if (!n) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 1e7);
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  const lakh = Math.floor((n % 1e7) / 1e5);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  const thousand = Math.floor((n % 1e5) / 1e3);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  const rest = n % 1e3;
  if (rest) parts.push(belowThousand(rest));
  return parts.join(' ');
}
function westernWords(n) {
  if (!n) return 'Zero';
  const parts = [];
  for (const [size, name] of [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']]) {
    const k = Math.floor(n / size);
    if (k) parts.push(`${belowThousand(k % 1000)} ${name}`);
    n %= size;
  }
  if (n) parts.push(belowThousand(n));
  return parts.join(' ');
}

/* 5000.5 INR -> "Rupees Five Thousand and Fifty Paise only" */
function amountInWords(amount, currency) {
  const cents = Math.round(Number(amount || 0) * 100);
  const whole = Math.floor(cents / 100);
  const part = cents % 100;
  if (String(currency || 'INR').toUpperCase() === 'USD') {
    return `US Dollars ${westernWords(whole)}${part ? ` and ${belowHundred(part)} Cents` : ''} only`;
  }
  return `Rupees ${indianWords(whole)}${part ? ` and ${belowHundred(part)} Paise` : ''} only`;
}

function money(amount, currency) {
  const usd = String(currency || 'INR').toUpperCase() === 'USD';
  const n = Number(amount || 0);
  return usd
    ? `USD ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `INR ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/* an ISO time, as the date in India: "31 October 2026" */
function indiaDate(iso) {
  const ms = Date.parse(String(iso || ''));
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms + 330 * 60000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/* ---- what the receipt says ------------------------------------------- */

const clean = (v, n) => String(v == null ? '' : v).replace(/[\u2013\u2014]/g, ',').replace(/\s+/g, ' ').trim().slice(0, n || 200);

function timeOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value.toMillis === 'function') return new Date(value.toMillis()).toISOString();
  if (value.seconds) return new Date(value.seconds * 1000).toISOString();
  return '';
}

function dataFrom(t) {
  const customer = t.customer || {};
  const meta = t.metadata || {};
  const cca = t.ccaVenue || {};
  const currency = String(t.currency || 'INR').toUpperCase();
  const address = [customer.address, customer.city, customer.district, customer.state]
    .map((v) => clean(v, 200)).filter(Boolean).filter((v, i, all) => all.indexOf(v) === i).join(', ');
  return {
    number: clean(t.donationReference, 40) || clean(t.orderId, 40),
    orderId: clean(t.orderId, 40),
    date: indiaDate(t.receiptIssuedAt || timeOf(t.updatedAt) || timeOf(t.createdAt)),
    name: clean(customer.name, 120),
    address: [address, clean(customer.pin, 6)].filter(Boolean).join(' '),
    pan: clean(customer.pan, 12).toUpperCase(),
    /* an Aadhaar number given for the 80G receipt (lib/tax-id.js): by its last
       four digits only, never in full on a document */
    aadhaar: clean(customer.aadhaar, 14).replace(/\D/g, '').slice(-4),
    email: clean(customer.email, 160),
    amount: money(t.amount, currency),
    words: amountInWords(t.amount, currency),
    usd: currency === 'USD',
    cause: clean(meta.cause, 120) || 'Where it is needed most',
    giftTo: meta.gift && meta.gift.to ? clean(meta.gift.to, 120) : '',
    bankReference: clean(cca.bankReference, 100),
    trackingId: clean(cca.trackingId, 100),
    mode: clean(cca.paymentMode, 80)
  };
}

/* ---- the PDF ---------------------------------------------------------- */

/* WinAnsi, the encoding both fonts are embedded with */
const WIN = { 0x20AC: 128, 0x201A: 130, 0x0192: 131, 0x201E: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x02C6: 136,
  0x2030: 137, 0x0160: 138, 0x2039: 139, 0x0152: 140, 0x017D: 142, 0x2018: 145, 0x2019: 146, 0x201C: 147,
  0x201D: 148, 0x2022: 149, 0x02DC: 152, 0x2122: 153, 0x0161: 154, 0x203A: 155, 0x0153: 156, 0x017E: 158, 0x0178: 159 };
function winCodes(text) {
  const out = [];
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c === 0x20B9) { out.push(73, 78, 82, 32); continue; } /* the rupee sign, as INR */
    if (c >= 32 && c < 127) out.push(c);
    else if (c >= 160 && c <= 255) out.push(c);
    else if (WIN[c]) out.push(WIN[c]);
    else if (c === 0x2013 || c === 0x2014) out.push(44); /* never a dash */
    else out.push(63);
  }
  return out;
}
function pdfString(text) {
  return '(' + winCodes(text).map((c) => {
    if (c === 40 || c === 41 || c === 92) return '\\' + String.fromCharCode(c);
    if (c < 32 || c > 126) return '\\' + c.toString(8).padStart(3, '0');
    return String.fromCharCode(c);
  }).join('') + ')';
}
function widthOf(font, size, text, spacing = 0) {
  const codes = winCodes(text);
  const w = codes.reduce((sum, c) => sum + (font.widths[c - 32] || 0), 0);
  return (w * size) / 1000 + spacing * Math.max(0, codes.length - 1);
}
function wrap(font, size, text, max) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && widthOf(font, size, next) > max) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const n2 = (v) => (Math.round(v * 100) / 100).toString();

function render(d) {
  const A = asset();
  const F = { D: A.display, T: A.text };
  const ops = [];
  const M = 56;
  const W = A4.w - M * 2;
  const ink = '0.067 0.067 0.067';
  const muted = '0.42 0.40 0.37';
  const line = '0.85 0.84 0.82';

  const text = (font, size, x, y, s, { color = ink, spacing = 0, align = 'left' } = {}) => {
    const w = widthOf(F[font], size, s, spacing);
    const at = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    ops.push(`BT /${font} ${size} Tf ${color} rg ${spacing ? `${spacing} Tc ` : ''}${n2(at)} ${n2(y)} Td ${pdfString(s)} Tj ${spacing ? '0 Tc ' : ''}ET`);
  };
  const rule = (y, color = line, width = 0.6) => ops.push(`${color} RG ${width} w ${M} ${n2(y)} m ${n2(M + W)} ${n2(y)} l S`);
  const box = (x, y, w, h, fill) => ops.push(`${fill} rg ${n2(x)} ${n2(y)} ${n2(w)} ${n2(h)} re f`);

  let y = A4.h - M;

  /* the head: the logo, and what this is */
  const lw = 150;
  const lh = (lw * A.logo.height) / A.logo.width;
  ops.push(`q ${lw} 0 0 ${n2(lh)} ${M} ${n2(y - lh)} cm /Logo Do Q`);
  text('D', 10, M + W, y - 12, 'DONATION RECEIPT', { color: muted, spacing: 2.2, align: 'right' });
  text('T', 15, M + W, y - 32, d.number, { align: 'right' });
  text('T', 11, M + W, y - 48, d.date, { color: muted, align: 'right' });
  y -= Math.max(lh, 52) + 22;
  rule(y, ink, 0.9);

  /* the thank-you, and the gift itself */
  y -= 46;
  text('D', 26, M, y, 'THANK YOU', { spacing: 1.2 });
  y -= 22;
  text('T', 12.5, M, y, 'for standing with the animals of India.', { color: muted });

  y -= 34;
  const words = wrap(F.T, 11.5, d.words, W - 36).slice(0, 3);
  const extra = (words.length - 1) * 13;
  box(M, y - 70 - extra, W, 82 + extra, '0.957 0.953 0.941');
  text('D', 9, M + 18, y - 8, 'AMOUNT RECEIVED', { color: muted, spacing: 1.8 });
  text('T', 30, M + 18, y - 40, d.amount);
  words.forEach((l, i) => text('T', 11.5, M + 18, y - 58 - i * 13, l, { color: muted }));
  y -= 70 + extra + 34;

  /* who gave it */
  text('D', 9, M, y, 'RECEIVED WITH THANKS FROM', { color: muted, spacing: 1.8 });
  y -= 22;
  text('T', 16, M, y, d.name || 'A friend of the animals');
  y -= 16;
  for (const l of wrap(F.T, 11.5, d.address, W).slice(0, 3)) { text('T', 11.5, M, y, l, { color: muted }); y -= 14; }
  if (d.pan) { text('T', 11.5, M, y, `PAN ${d.pan}`, { color: muted }); y -= 14; }
  else if (d.aadhaar) { text('T', 11.5, M, y, `Aadhaar XXXX XXXX ${d.aadhaar}`, { color: muted }); y -= 14; }
  y -= 18;

  /* the payment, row by row (the number and the date are at the head) */
  const rows = [
    ['Towards', d.cause],
    ...(d.giftTo ? [['Given as a gift for', d.giftTo]] : []),
    ['PFA transaction ID', d.orderId],
    ['Bank reference', d.bankReference],
    ['CCAvenue tracking ID', d.trackingId],
    ['Paid by', d.mode]
  ].filter((r) => r[1]);
  rule(y + 4);
  for (const [label, value] of rows) {
    y -= 21;
    text('D', 8.5, M, y + 1, label.toUpperCase(), { color: muted, spacing: 1.4 });
    const vs = wrap(F.T, 12, value, W * 0.58);
    vs.forEach((v, i) => text('T', 12, M + W, y - i * 14, v, { align: 'right' }));
    y -= (vs.length - 1) * 14 + 9;
    rule(y);
  }

  /* what it means for tax, said as the site says it */
  y -= 26;
  const fine = [
    /* as the receipt email: the 80G line only for a gift in rupees */
    d.usd ? '' : 'Donations to People for Animals are eligible for tax deduction under Section 80G of the Income Tax Act, 1961. For the 80G certificate, write to PFA quoting the PFA transaction ID above.',
    'The payment was taken by CCAvenue; People for Animals does not receive or store card, bank or UPI details.',
    'This receipt is generated by computer and needs no signature.'
  ].filter(Boolean);
  for (const para of fine) {
    for (const l of wrap(F.T, 10.5, para, W)) { text('T', 10.5, M, y, l, { color: muted }); y -= 13.5; }
    y -= 6;
  }

  /* the foot */
  const fy = M - 6;
  rule(fy + 26, ink, 0.9);
  text('D', 9, M, fy + 10, 'PEOPLE FOR ANIMALS', { spacing: 1.8 });
  text('T', 9.5, M + W, fy + 10, SITE, { color: muted, align: 'right' });
  text('T', 9.5, M, fy - 4, OFFICE, { color: muted });

  return ops.join('\n');
}

/* one A4 page: catalog, pages, page, two embedded TrueType fonts, the logo */
function build(d) {
  const A = asset();
  const content = zlib.deflateSync(Buffer.from(render(d), 'latin1'));
  const objects = [];
  const add = (body, stream) => { objects.push({ body, stream }); return objects.length; };
  const fontObjects = (f, tag) => {
    const ttf = Buffer.from(f.ttf, 'base64');
    const packed = zlib.deflateSync(ttf);
    const file = add(`<< /Length ${packed.length} /Length1 ${ttf.length} /Filter /FlateDecode >>`, packed);
    const desc = add(`<< /Type /FontDescriptor /FontName /${tag}+${f.name} /Flags 34 /FontBBox [${f.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${f.ascent} /Descent ${f.descent} /CapHeight ${f.capHeight} /StemV 80 /FontFile2 ${file} 0 R >>`);
    return add(`<< /Type /Font /Subtype /TrueType /BaseFont /${tag}+${f.name} /FirstChar 32 /LastChar 255 /Widths [${f.widths.join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${desc} 0 R >>`);
  };
  const display = fontObjects(A.display, 'PFAAAA');
  const textFont = fontObjects(A.text, 'PFAAAB');
  const jpeg = Buffer.from(A.logo.jpeg, 'base64');
  const logo = add(`<< /Type /XObject /Subtype /Image /Width ${A.logo.width} /Height ${A.logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  const contents = add(`<< /Length ${content.length} /Filter /FlateDecode >>`, content);
  const pagesNo = objects.length + 2;
  const page = add(`<< /Type /Page /Parent ${pagesNo} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /D ${display} 0 R /T ${textFont} 0 R >> /XObject << /Logo ${logo} 0 R >> >> /Contents ${contents} 0 R >>`);
  add(`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  const info = add(`<< /Title ${pdfString(`PFA donation receipt ${d.number}`)} /Author (People for Animals) /Producer (peopleforanimalsindia.org) >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesNo} 0 R >>`);

  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let length = chunks[0].length;
  const offsets = [];
  objects.forEach((o, i) => {
    offsets[i + 1] = length;
    const parts = [Buffer.from(`${i + 1} 0 obj\n${o.body}`, 'latin1')];
    if (o.stream) parts.push(Buffer.from('\nstream\n', 'latin1'), o.stream, Buffer.from('\nendstream', 'latin1'));
    parts.push(Buffer.from('\nendobj\n', 'latin1'));
    for (const p of parts) { chunks.push(p); length += p.length; }
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${length}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(chunks);
}

function pdf(transaction) {
  return build(dataFrom(transaction));
}

/* "PFA-DON-2026-00012" -> "PFA-donation-receipt-PFA-DON-2026-00012.pdf" */
function fileName(transaction) {
  const d = dataFrom(transaction);
  return `PFA-donation-receipt-${d.number.replace(/[^A-Za-z0-9-]/g, '')}.pdf`;
}

module.exports = { keyFor, keyMatches, urlFor, pdf, fileName, dataFrom, amountInWords, money, indiaDate, KEY };
