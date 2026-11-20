'use strict';

/* Letters on PFA's letterhead, issued from the panel (owner, 20 Nov 2026:
   PFA-Letter-Studio.html, "add this feature to the admin panel. admin should
   be able to select the name of the person and issue the cert. the cert
   should automatically take the address from the selected. also the email
   ID should be fetchable").

   The letter is made here, on the server, as an A4 PDF, to the studio's own
   measures: the letterhead across the top, the reference and date, the
   person and their address, the subject, the words, and Maneka Sanjay
   Gandhi's signature with PFA's seal. The preview the panel shows is this
   same PDF, so what is seen is what is issued.

   The letterhead, the signature and the seal are in lib/letter-art/, which
   is never published: the public site is built without lib/
   (scripts/minify.js) and Firebase Hosting carries only the panel
   (scripts/build-firebase.js). They reach a browser only inside a letter,
   made for someone allowed to make letters (the 'letters' module).

   Type: Liberation Sans, which has Arial's widths exactly (owner, 20 Nov
   2026: "letter font to be arial"; Arial itself may not be shipped), with
   Noto for the rupee sign and for a name in an Indian script
   (lib/pdf-fonts.js).

   Every size and place of the letterhead, the signature and the seal can be
   moved (owner, 20 Nov 2026: "logo, signature, seal size and position should
   be adjustable"); a letter keeps the places it was issued with. */

const fs = require('fs');
const path = require('path');
const FONTS = require('./pdf-fonts');

const MM = 72 / 25.4;
const PAGE = { w: 210, h: 297 };
const PAD = { top: 16, side: 19, bottom: 12 };
const TEXT_W = PAGE.w - 2 * PAD.side;
const SITE = 'peopleforanimalsindia.org';
const COLOUR = { ink: '#192b33', meta: '#566d77', soft: '#617985', rule: '#dce6ea' };
const FAMILY = { regular: 'arial', bold: 'arialBold' };
const SIZE = { body: 11.5, meta: 8.5, continued: 8, foot: 7.5, signName: 10 };
const LINE = 1.65;
const MAX_PAGES = 6;

/* Named in full, so the bundlers carry them (Vercel's file tracing,
   scripts/build-firebase.js copies lib/). */
const ART_FILES = {
  letterhead: () => fs.readFileSync(path.join(__dirname, 'letter-art', 'letterhead.png')),
  signature: () => fs.readFileSync(path.join(__dirname, 'letter-art', 'signature.png')),
  seal: () => fs.readFileSync(path.join(__dirname, 'letter-art', 'seal.png'))
};
/* width / height of each, as drawn */
const ART_RATIO = { letterhead: 1672 / 606, signature: 1374 / 374, seal: 956 / 376 };
let art = null;
function artOf() {
  if (!art) art = { letterhead: ART_FILES.letterhead(), signature: ART_FILES.signature(), seal: ART_FILES.seal() };
  return art;
}

/* What can be moved, in millimetres (the letterhead's size as a share of the
   text's width). The studio's places are the starting ones. */
const LAYOUT = {
  headSize: { min: 40, max: 100, value: 100, label: 'Letterhead size', unit: '%' },
  headX: { min: -40, max: 40, value: 0, label: 'Letterhead left and right', unit: 'mm' },
  headY: { min: -10, max: 30, value: 0, label: 'Letterhead up and down', unit: 'mm' },
  sigSize: { min: 35, max: 110, value: 75, label: 'Signature size', unit: 'mm' },
  sigX: { min: 0, max: 110, value: 0, label: 'Signature left and right', unit: 'mm' },
  sigY: { min: -25, max: 25, value: 0, label: 'Signature up and down', unit: 'mm' },
  sealSize: { min: 20, max: 80, value: 43, label: 'Seal size', unit: 'mm' },
  sealX: { min: -130, max: 0, value: 0, label: 'Seal left and right', unit: 'mm' },
  sealY: { min: -25, max: 25, value: 0, label: 'Seal up and down', unit: 'mm' }
};
const LAYOUT_KEYS = Object.keys(LAYOUT);
function layoutOf(raw) {
  const r = raw || {};
  const out = {};
  for (const k of LAYOUT_KEYS) {
    const n = Number(r[k]);
    out[k] = Number.isFinite(n) ? Math.min(LAYOUT[k].max, Math.max(LAYOUT[k].min, Math.round(n * 2) / 2)) : LAYOUT[k].value;
  }
  return out;
}

/* The studio's four starting letters. [Name] is the person chosen. */
const TEMPLATES = {
  appreciation: {
    label: 'Certificate of appreciation',
    subject: 'CERTIFICATE OF APPRECIATION',
    salutation: '',
    body: '**Presented with Gratitude**\n\nThis Certificate is proudly presented to\n\n**[Name]**\n\nin grateful recognition and sincere appreciation of your generous contribution to **People for Animals**, a Trust dedicated to the welfare, protection, rescue and care of animals.\n\nYour generous support reflects your compassion, kindness and commitment towards the cause of animal welfare. Your valuable contribution will help us continue our efforts to provide food, shelter, medical care and protection to voiceless animals in need.\n\nWe sincerely appreciate your generosity and thank you for being a part of our mission to create a more compassionate and humane world for all living beings.',
    closing: 'With heartfelt gratitude and best wishes.'
  },
  general: {
    label: 'General letter',
    subject: 'Support for animal welfare in your community',
    salutation: 'Dear [Name],',
    body: 'I am writing on behalf of People for Animals regarding the welfare and protection of animals in your community.\n\nWe request your support in ensuring that animals receive timely care, access to food and water, and protection from cruelty. Coordinated action between residents, local authorities and animal welfare volunteers can make a meaningful difference.\n\nPlease nominate a point of contact so that we may discuss the specific needs, responsibilities and next steps.\n\nThank you for your attention and cooperation.',
    closing: 'Yours sincerely,'
  },
  support: {
    label: 'Request for support',
    subject: 'Request for support for animal welfare',
    salutation: 'Dear [Name],',
    body: 'People for Animals seeks your support for its animal welfare work.\n\nWe would welcome an opportunity to discuss a specific area in which your organisation can contribute, including veterinary care, rescue support or community welfare initiatives.\n\nPlease let us know a suitable time to discuss the proposed scope, resources and next steps.\n\nThank you for considering this request.',
    closing: 'Yours sincerely,'
  },
  authority: {
    label: 'Letter to an authority',
    subject: 'Request for action on an animal welfare concern',
    salutation: 'Dear Sir / Madam,',
    body: 'I am writing on behalf of People for Animals to bring an animal welfare concern to your attention.\n\n[Set out the location, date, verified facts and supporting documents.]\n\nWe request that your office examine the matter, arrange the appropriate response and nominate an officer for further coordination.\n\nPlease share the action taken and the expected timeline for any outstanding steps.\n\nThank you for your attention to this matter.',
    closing: 'Yours sincerely,'
  }
};
const KIND_ORDER = ['appreciation', 'general', 'support', 'authority'];

/* PFA/LET/2026/00001, one series a year; kept as PFA-LET-2026-00001 */
const NUMBER = /^PFA\/LET\/(\d{4})\/(\d{5})$/;
const formatNumber = (year, n) => `PFA/LET/${year}/${String(n).padStart(5, '0')}`;
const docIdOf = (number) => String(number || '').replace(/\//g, '-');
const numberOfDoc = (id) => String(id || '').replace(/^PFA-LET-(\d{4})-(\d{5})$/, 'PFA/LET/$1/$2');

/* ---- checking what the panel sent ------------------------------------ */

const LIMITS = { recipient: 600, subject: 200, salutation: 120, body: 12000, closing: 160 };
const text = (v, n) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/[ \t]+$/gm, '').trim().slice(0, n);
const line = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const emailOf = (v) => { const e = line(v, 254).toLowerCase(); return EMAIL.test(e) ? e : ''; };
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
function dayOf(v) {
  const m = DAY.exec(line(v, 10));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3] || +m[1] < 2000 || +m[1] > 2100) return '';
  return m[0];
}
const todayIst = (nowMs) => new Date(nowMs + 330 * 60000).toISOString().slice(0, 10);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function dateWords(iso) {
  const m = DAY.exec(String(iso || ''));
  return m ? `${m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : '';
}

/* A bracketed blank still in the letter: [Name], [Set out the facts...] */
function blankIn(...parts) {
  for (const p of parts) {
    const m = /\[[^\]\n]{2,80}\]/.exec(String(p || ''));
    if (m) return m[0];
  }
  return '';
}

/* The letter as the panel sent it, checked. `issuing` also refuses a blank
   left in it; a preview shows it as it is. */
function check(body, nowMs, issuing) {
  const b = body || {};
  const kind = Object.prototype.hasOwnProperty.call(TEMPLATES, b.kind) ? b.kind : '';
  if (!kind) return { ok: false, field: 'kind', message: 'Choose what kind of letter it is.' };
  const date = b.date ? dayOf(b.date) : todayIst(nowMs);
  if (!date) return { ok: false, field: 'date', message: 'Choose the date the letter carries.' };
  const v = {
    kind,
    date,
    recipient: text(b.recipient, LIMITS.recipient),
    subject: line(b.subject, LIMITS.subject),
    salutation: line(b.salutation, LIMITS.salutation),
    body: text(b.body, LIMITS.body),
    closing: line(b.closing, LIMITS.closing),
    signed: b.signed !== false,
    sealed: b.sealed !== false,
    layout: layoutOf(b.layout)
  };
  if (String(b.body || '').length > LIMITS.body) return { ok: false, field: 'body', message: `Keep the letter under ${LIMITS.body.toLocaleString('en-IN')} characters.` };
  if (v.recipient.split('\n').length > 8) return { ok: false, field: 'recipient', message: 'Keep the name and address to 8 lines.' };
  if (!v.body) return { ok: false, field: 'body', message: 'Write the letter.' };
  const p = b.person && typeof b.person === 'object' ? b.person : null;
  if (p && line(p.name, 120)) v.person = { id: line(p.id, 20), name: line(p.name, 120), email: emailOf(p.email), mobile: line(p.mobile, 15) };
  const email = emailOf(b.email);
  if (b.email && String(b.email).trim() && !email) return { ok: false, field: 'email', message: 'That email does not look right.' };
  if (email) v.email = email;
  if (issuing) {
    if (!v.recipient && !v.person) return { ok: false, field: 'person', message: 'Choose who the letter is for, or write their name and address.' };
    if (!v.subject) return { ok: false, field: 'subject', message: 'Write the subject.' };
    const blank = blankIn(v.recipient, v.subject, v.salutation, v.body, v.closing);
    if (blank) return { ok: false, field: /\[name\]/i.test(blank) ? 'person' : 'body', message: /\[name\]/i.test(blank) ? 'Choose who the letter is for: [Name] is still in the letter.' : `Fill in ${blank.length > 50 ? `${blank.slice(0, 48)}...]` : blank} before issuing.` };
  }
  return { ok: true, values: v };
}

/* The person's name and address, as the letter shows them: the name, the
   address as last given (it carries the town and PIN), then the district
   and state when the address does not already say them. */
function recipientOf(person) {
  const p = person || {};
  const name = line(p.name, 120);
  const address = line(p.address, 400);
  const low = address.toLowerCase();
  const tail = [p.district, p.state].map((x) => line(x, 60)).filter((x) => x && !low.includes(x.toLowerCase()));
  return [name, address, tail.join(', ')].filter(Boolean).join('\n');
}

/* ---- the PDF ----------------------------------------------------------- */

/* Text with **bold** in it, as runs of one font each. */
function runsOfText(str, bold) {
  const out = [];
  const parts = String(str || '').split('**');
  parts.forEach((part, i) => {
    if (!part) return;
    for (const r of FONTS.runsOf(part, bold ? true : i % 2 === 1, FAMILY)) out.push(r);
  });
  return out;
}

/* Lines that fit `width` points, from runs: each line a list of pieces
   { key, text, w }. Breaks at spaces; a word longer than the line is broken
   where it must be; a newline always breaks. */
function linesOf(doc, runs, size, width) {
  const measure = (key, t) => doc.font(key).fontSize(size).widthOfString(t);
  const atoms = [];
  for (const r of runs) {
    for (const piece of r.text.split(/(\n| +)/)) {
      if (!piece) continue;
      if (piece === '\n') atoms.push({ br: true });
      else if (/^ +$/.test(piece)) atoms.push({ space: true, key: r.key, w: measure(r.key, ' ') });
      else atoms.push({ key: r.key, text: piece, w: measure(r.key, piece) });
    }
  }
  /* words: what lies between spaces, which may be several runs (₹5,000) */
  const lines = [];
  let cur = [];
  let curW = 0;
  let word = [];
  let pendingSpace = null;
  const flushLine = () => { lines.push(cur); cur = []; curW = 0; };
  const placeWord = () => {
    if (!word.length) return;
    const ww = word.reduce((s, a) => s + a.w, 0);
    const sp = cur.length && pendingSpace ? pendingSpace.w : 0;
    if (cur.length && curW + sp + ww > width) { flushLine(); }
    else if (cur.length && pendingSpace) { cur.push({ key: pendingSpace.key, text: ' ', w: pendingSpace.w }); curW += pendingSpace.w; }
    if (ww <= width) { for (const a of word) cur.push(a); curW += ww; }
    else {
      /* longer than a line: broken by character */
      for (const a of word) {
        for (const ch of Array.from(a.text)) {
          const cw = measure(a.key, ch);
          if (curW + cw > width && cur.length) flushLine();
          const last = cur[cur.length - 1];
          if (last && last.key === a.key && !last.space) { last.text += ch; last.w += cw; } else cur.push({ key: a.key, text: ch, w: cw });
          curW += cw;
        }
      }
    }
    word = [];
    pendingSpace = null;
  };
  for (const a of atoms) {
    if (a.br) { placeWord(); flushLine(); continue; }
    if (a.space) { placeWord(); pendingSpace = a; continue; }
    word.push(a);
  }
  placeWord();
  if (cur.length || !lines.length) flushLine();
  return lines;
}

/* The letter as a PDF. `number` is the reference printed on it; a preview,
   not yet issued, says so instead. Resolves to { bytes, pages }. */
function pdfOf(letter, opts) {
  const o = opts || {};
  const PDFDocument = require('pdfkit');
  const F = FONTS.loadFonts();
  const L = layoutOf(letter.layout);
  const number = o.number || '';
  const doc = new PDFDocument({
    size: 'A4', margin: 0, bufferPages: true,
    info: { Title: letter.subject || 'Letter', Author: 'People For Animals', Subject: number ? `Letter ${number}` : 'Letter, not yet issued', Creator: SITE }
  });
  for (const key of Object.keys(F)) doc.registerFont(key, F[key].bytes);
  /* each picture embedded once, however many pages show it */
  const raw = artOf();
  const A = { letterhead: doc.openImage(raw.letterhead), signature: doc.openImage(raw.signature), seal: doc.openImage(raw.seal) };
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

  const left = PAD.side * MM;
  const width = TEXT_W * MM;
  const ascentOf = (key) => (F[key].font.ascent / F[key].font.unitsPerEm);
  const descentOf = (key) => (-F[key].font.descent / F[key].font.unitsPerEm);
  /* the foot: a hairline, then the site and the page number, 12 mm off the bottom */
  const footText = SIZE.foot * 1.5;
  const footTop = PAGE.h * MM - PAD.bottom * MM - footText;
  const ruleY = footTop - 4 * MM;
  const bottom = ruleY - 6 * MM;

  let y = 0;
  let pageNo = 0;
  const headW = TEXT_W * (L.headSize / 100);
  const headH = headW / ART_RATIO.letterhead;
  function startPage() {
    if (pageNo > 0) doc.addPage({ size: 'A4', margin: 0 });
    pageNo += 1;
    const hx = PAD.side + (TEXT_W - headW) / 2 + L.headX;
    const hy = PAD.top + L.headY;
    doc.image(A.letterhead, hx * MM, hy * MM, { width: headW * MM, height: headH * MM });
    y = Math.max(PAD.top, hy + headH) * MM + 7 * MM;
    if (pageNo === 1) {
      const sz = SIZE.meta;
      const base = y + sz * ascentOf('arial') * 1.0;
      doc.fillColor(COLOUR.meta);
      const ref = number ? `Ref: ${number}` : 'Ref: given when issued';
      drawRuns(runsOfText(ref, false), sz, left, base);
      const when = dateWords(letter.date);
      const ww = doc.font('arial').fontSize(sz).widthOfString(when);
      drawRuns(runsOfText(when, false), sz, left + width - ww, base);
      y += sz * 1.15 + 8 * MM;
    } else {
      const sz = SIZE.continued;
      doc.fillColor(COLOUR.soft);
      drawRuns(runsOfText(`${number || 'Not yet issued'} · Continued`, false), sz, left, y + sz * ascentOf('arial'));
      y += sz * 1.15 + 6 * MM;
    }
    doc.fillColor(COLOUR.ink);
  }
  function drawRuns(runs, size, x, baseline) {
    let at = x;
    for (const r of runs) {
      doc.font(r.key).fontSize(size).text(r.text, at, baseline, { lineBreak: false, baseline: 'alphabetic' });
      at += doc.widthOfString(r.text);
    }
  }
  function drawLine(pieces, size) {
    const lh = size * LINE;
    const content = (ascentOf('arial') + descentOf('arial')) * size;
    const base = y + (lh - content) / 2 + ascentOf('arial') * size;
    let at = left;
    for (const p of pieces) {
      doc.font(p.key).fontSize(size).text(p.text, at, base, { lineBreak: false, baseline: 'alphabetic' });
      at += p.w;
    }
    y += lh;
  }
  /* a block of text, lines carried to the next page as they must be */
  function block(str, opt) {
    const o2 = opt || {};
    const size = o2.size || SIZE.body;
    doc.fillColor(o2.color || COLOUR.ink);
    const lines = linesOf(doc, runsOfText(str, o2.bold), size, width);
    for (const ln of lines) {
      if (y + size * LINE > bottom) startPage();
      drawLine(ln, size);
    }
    y += (o2.after || 0) * MM;
  }

  startPage();
  if (letter.recipient) block(letter.recipient, { after: 6 });
  if (letter.subject) block(letter.kind === 'appreciation' ? letter.subject : `Subject: ${letter.subject}`, { bold: true, after: 6 });
  if (letter.salutation) block(letter.salutation, { after: 4 });
  for (const para of String(letter.body || '').split(/\n[ \t]*\n/).map((x) => x.trim()).filter(Boolean)) block(para, { after: 4.5 });

  /* the signature and the seal, kept together with the closing words */
  const sigW = L.sigSize;
  const sigH = sigW / ART_RATIO.signature;
  const sealW = L.sealSize;
  const sealBox = sealW * (24 / 43);
  const rowH = Math.max(letter.signed ? sigH : 8, letter.sealed ? sealBox : 0);
  const closingLines = letter.closing ? linesOf(doc, runsOfText(letter.closing, letter.kind === 'appreciation'), SIZE.body, width).length : 0;
  const blockH = 3 * MM + closingLines * SIZE.body * LINE + 1 * MM + rowH * MM;
  if (y + blockH > bottom) startPage();
  y += 3 * MM;
  if (letter.closing) block(letter.closing, { bold: letter.kind === 'appreciation', after: 1 });
  else y += 1 * MM;
  const rowTop = y;
  const mid = rowTop + (rowH * MM) / 2;
  if (letter.signed) {
    doc.image(A.signature, left + L.sigX * MM, mid - (sigH * MM) / 2 + L.sigY * MM, { width: sigW * MM, height: sigH * MM });
  } else {
    doc.fillColor(COLOUR.ink);
    drawRuns(runsOfText('Maneka Sanjay Gandhi', true), SIZE.signName, left + L.sigX * MM, mid + SIZE.signName * 0.35);
  }
  if (letter.sealed) {
    const sealH = sealW / ART_RATIO.seal;
    doc.image(A.seal, left + width - sealW * MM + L.sealX * MM, mid - (sealH * MM) / 2 + L.sealY * MM, { width: sealW * MM, height: sealH * MM });
  }
  y = rowTop + rowH * MM;

  /* the foot of every page */
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = 0; i < total; i += 1) {
    doc.switchToPage(range.start + i);
    doc.save().moveTo(left, ruleY).lineTo(left + width, ruleY).lineWidth(0.75).strokeColor(COLOUR.rule).stroke().restore();
    doc.fillColor(COLOUR.soft);
    const base = footTop + (footText - SIZE.foot * (ascentOf('arial') + descentOf('arial'))) / 2 + SIZE.foot * ascentOf('arial');
    drawRuns(runsOfText(SITE, false), SIZE.foot, left, base);
    const n = `${i + 1} / ${total}`;
    const nw = doc.font('arial').fontSize(SIZE.foot).widthOfString(n);
    drawRuns(runsOfText(n, false), SIZE.foot, left + width - nw, base);
  }
  doc.end();
  return done.then((bytes) => ({ bytes, pages: total }));
}

/* What the panel lists of a letter. */
function rowOf(id, l) {
  return {
    number: l.number || numberOfDoc(id),
    kind: l.kind || '',
    kindLabel: (TEMPLATES[l.kind] || {}).label || 'Letter',
    date: l.date || '',
    subject: l.subject || '',
    name: (l.person && l.person.name) || String(l.recipient || '').split('\n')[0] || '',
    personId: (l.person && l.person.id) || '',
    email: l.email || (l.person && l.person.email) || '',
    pages: l.pages || 0,
    issuedAt: l.issuedAt || '',
    issuedBy: (l.issuedBy && (l.issuedBy.name || l.issuedBy.email)) || '',
    withdrawn: Boolean(l.withdrawn),
    withdrawnAt: l.withdrawnAt || '',
    withdrawnReason: l.withdrawnReason || '',
    sent: Array.isArray(l.sends) && l.sends.length ? l.sends[l.sends.length - 1] : null
  };
}

/* The letter, its fields, from its record: to draw it again exactly. */
function letterOfRecord(l) {
  return { kind: l.kind, date: l.date, recipient: l.recipient || '', subject: l.subject || '', salutation: l.salutation || '', body: l.body || '', closing: l.closing || '', signed: l.signed !== false, sealed: l.sealed !== false, layout: layoutOf(l.layout) };
}

const fileName = (number) => `PFA-letter-${docIdOf(number)}.pdf`;

module.exports = {
  TEMPLATES, KIND_ORDER, LAYOUT, LIMITS, NUMBER, MAX_PAGES, SITE,
  formatNumber, docIdOf, numberOfDoc, check, recipientOf, layoutOf, pdfOf, rowOf, letterOfRecord, fileName, dateWords, todayIst, blankIn,
  _test: { linesOf, runsOfText, ART_FILES }
};
