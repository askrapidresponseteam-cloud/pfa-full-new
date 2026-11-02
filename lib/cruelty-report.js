'use strict';

/* The monthly cruelty report (owner, 2 Nov 2026: "month wise cruelty report
   and have a state wise list within that report so that PFA team can
   co-ordinate with govt of that state. at 2nd of each month- previous
   months cruelty reports as 1 pdf has to be sent to gandhim. who reported
   what and when and from where").

   What it reads: every cruelty report (PFA-CR) the website filed in the
   month, India time. Left out: the site's testing (20 Oct 2026 and earlier,
   lib/test-data.js), and reports the panel marked as spam or removed; the
   email and the PDF say how many were left out.

   What it makes: one PDF. Its first page is the month at a glance, a line
   per state (reports, how many were still happening when reported, and the
   districts). Then each state starts on its own page, so its pages can be
   handed to that state's government as they are: every report with its
   number, when it was filed, who reported it (name, mobile, email), where
   (the address as given, town, district, state, PIN and the map link if
   they shared one), the animal, whether it was still going on, when it
   happened, who is responsible, what they saw, the photographs and where
   the case stands. Reports with no state given (only possible before the
   address was made mandatory) come last. Text in Indian scripts is drawn
   in Noto Sans for its script (lib/report-fonts, SIL Open Font Licence).

   When: the email worker calls run() on every run (Vercel's daily cron and
   Firebase's every ten minutes). On the 2nd of a month, India time, it
   reports the month before; if the 2nd was missed it still does up to the
   8th. Once only: cruelty_reports/{YYYY-MM} is claimed in a transaction.
   The email goes to the forms inbox (gandhim) through the outbound queue,
   which retries and keeps every attempt, with the PDF attached. The PDF is
   kept (Firebase Storage, or in the record if the bucket is not set up) and
   can be downloaded, or sent again, from the panel. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const COLLECTION = 'cruelty_reports';
const NO_STATE = 'State not given';
const R = require('./cruelty-report-read');
const { KIND, SEND_DAY, LAST_DAY, istParts, bounds, previousMonth, currentMonth, due, when, collect, mobileOf, line } = R;
const pad = (n) => String(n).padStart(2, '0');

/* By state, A to Z, with "State not given" last; inside each, by date. */
function summarise(month, collected) {
  const { label } = bounds(month);
  const rows = collected.rows || [];
  const by = new Map();
  for (const r of rows) {
    const key = r.state || NO_STATE;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(r);
  }
  const names = [...by.keys()].filter((s) => s !== NO_STATE).sort((a, b) => a.localeCompare(b));
  if (by.has(NO_STATE)) names.push(NO_STATE);
  const states = names.map((state) => {
    const mine = by.get(state);
    const d = new Map();
    for (const r of mine) if (r.district) d.set(r.district, (d.get(r.district) || 0) + 1);
    const districts = [...d.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([district, count]) => ({ district, count }));
    return { state, count: mine.length, now: mine.filter((r) => r.urgency === 'Happening now').length, districts, rows: mine };
  });
  const leftOut = Object.assign({ spam: 0, removed: 0 }, collected.leftOut || {});
  return { month, label, count: rows.length, states, leftOut };
}

/* What a report lacks of the address and contact: "PIN code, district" */
function missingOf(r) {
  return [
    [r.address, 'street address'], [r.city, 'city or town'], [r.district, 'district'],
    [r.state || r.stateGiven, 'state'], [r.pincode, 'PIN code'], [r.mobile, 'phone number'], [r.email, 'email']
  ].filter(([v]) => !v).map(([, name]) => name).join(', ');
}

function districtText(s) {
  return s.districts.map((d) => (d.count > 1 ? `${d.district} (${d.count})` : d.district)).join(', ');
}

function fileName(month) {
  return `PFA-cruelty-reports-${month}.pdf`;
}

/* ---- the PDF ---------------------------------------------------------- */

/* Each font is named here in full, so the bundlers (Vercel's file tracing,
   scripts/build-firebase.js) carry it with the code. */
const FONT_FILES = {
  latin: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-latin-400.woff')),
  latinBold: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-latin-700.woff')),
  latinExt: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-latin-ext-400.woff')),
  devanagari: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-devanagari-400.woff')),
  bengali: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-bengali-400.woff')),
  gurmukhi: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-gurmukhi-400.woff')),
  gujarati: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-gujarati-400.woff')),
  oriya: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-oriya-400.woff')),
  tamil: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-tamil-400.woff')),
  telugu: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-telugu-400.woff')),
  kannada: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-kannada-400.woff')),
  malayalam: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-malayalam-400.woff'))
};
const SCRIPTS = [
  { key: 'devanagari', from: 0x0900, to: 0x097f }, { key: 'devanagari', from: 0xa8e0, to: 0xa8ff },
  { key: 'bengali', from: 0x0980, to: 0x09ff },
  { key: 'gurmukhi', from: 0x0a00, to: 0x0a7f },
  { key: 'gujarati', from: 0x0a80, to: 0x0aff },
  { key: 'oriya', from: 0x0b00, to: 0x0b7f },
  { key: 'tamil', from: 0x0b80, to: 0x0bff },
  { key: 'telugu', from: 0x0c00, to: 0x0c7f },
  { key: 'kannada', from: 0x0c80, to: 0x0cff },
  { key: 'malayalam', from: 0x0d00, to: 0x0d7f }
];

let fonts = null;
function loadFonts() {
  if (fonts) return fonts;
  const fontkit = require('fontkit');
  fonts = {};
  for (const key of Object.keys(FONT_FILES)) {
    const bytes = FONT_FILES[key]();
    fonts[key] = { bytes, font: fontkit.create(bytes) };
  }
  return fonts;
}

const has = (key, cp) => { try { return Boolean(fonts[key].font.hasGlyphForCodePoint(cp)); } catch (_) { return false; } };
const scriptOf = (cp) => (SCRIPTS.find((s) => cp >= s.from && cp <= s.to) || {}).key || '';

/* A string split into runs, each in the one font that draws it: an Indian
   script in its own Noto, the rest in Noto Sans. A space, a joiner or a
   mark the current font has stays in the run (so a Hindi sentence is one
   run); a character no font has (an emoji) is left out. */
function runsOf(text, bold) {
  const base = bold ? 'latinBold' : 'latin';
  const out = [];
  let cur = null;
  let dropped = false;
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0);
    /* a left-out character leaves one space, not two */
    if (dropped && /[^\S\n]/.test(ch) && cur && /[^\S\n]$/.test(cur.text)) continue;
    dropped = false;
    let key = scriptOf(cp);
    if (!key) {
      if (ch === '\n') key = cur ? cur.key : base;
      else if (cur && cur.key !== base && cur.key !== 'latinExt' && (/\s/.test(ch) || cp === 0x200c || cp === 0x200d) && has(cur.key, cp)) key = cur.key;
      else if (has(base, cp)) key = base;
      else if (has('latinExt', cp)) key = 'latinExt';
      else if (/\s/.test(ch)) { key = base; }
      else { dropped = true; continue; }
    }
    if (cur && cur.key === key) cur.text += ch;
    else { cur = { key, text: ch }; out.push(cur); }
  }
  return out;
}

const INK = '#1d1d1b';
const SOFT = '#6b6b66';
const HAIR = '#d9d6cf';
const RUST = '#995d3b';

/* Write text that may mix scripts, at (x, y) in a column `width` wide. */
function rich(doc, text, x, y, width, opts) {
  const o = opts || {};
  const runs = runsOf(text, o.bold);
  if (!runs.length) runs.push({ key: o.bold ? 'latinBold' : 'latin', text: '-' });
  const size = o.size || 10;
  /* every font sits on one baseline, Noto Sans's, so a Hindi word and the
     English around it line up (each font's own top would not) */
  const ascent = (fonts.latin.font.ascent / fonts.latin.font.unitsPerEm) * size;
  doc.fillColor(o.color || INK).fontSize(size);
  runs.forEach((r, i) => {
    doc.font(r.key);
    const last = i === runs.length - 1;
    if (i === 0) doc.text(r.text, x, y + ascent, { width, lineGap: o.lineGap == null ? 2 : o.lineGap, continued: !last, link: o.link || null, baseline: 'alphabetic' });
    else doc.text(r.text, { continued: !last, baseline: 'alphabetic' });
  });
  /* back to where the text ends, as if it had been set from its top */
  doc.y -= ascent;
}

function pdfOf(report) {
  const PDFDocument = require('pdfkit');
  const F = loadFonts();
  const doc = new PDFDocument({
    size: 'A4', margins: { top: 54, bottom: 64, left: 54, right: 54 }, bufferPages: true,
    info: { Title: `PFA cruelty reports: ${report.label}`, Author: 'People For Animals', Subject: 'Cruelty reports filed on the PFA website, by state', Creator: 'PFA website' }
  });
  for (const key of Object.keys(F)) doc.registerFont(key, F[key].bytes);
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const rule = (y, color, w) => { doc.save().moveTo(left, y).lineTo(left + width, y).lineWidth(w || 0.6).strokeColor(color || HAIR).stroke().restore(); };

  /* the month at a glance */
  rich(doc, 'PEOPLE FOR ANIMALS  ·  MONTHLY CRUELTY REPORT', left, 54, width, { size: 8.5, color: RUST, bold: true });
  rich(doc, report.label, left, 72, width, { size: 28, bold: true });
  const states = report.states.filter((s) => s.state !== NO_STATE).length;
  rich(doc, `Every cruelty report filed on the PFA website in ${report.label}, India time: ${report.count} report${report.count === 1 ? '' : 's'}`
    + (report.count ? ` from ${states} state${states === 1 ? '' : 's'}` : '')
    + '. Each state starts on its own page, so its pages can be taken up with that state\'s government as they are: who reported each case, when, from where, and what they saw.', left, 118, width, { size: 10.5, color: SOFT, lineGap: 3 });
  let y = doc.y + 18;
  if (!report.count) {
    rich(doc, 'No cruelty reports were filed on the website this month.', left, y, width, { size: 12, bold: true });
    y = doc.y + 10;
  } else {
    const col = [left, left + 170, left + 230, left + 330];
    const head = (t, x, w, align) => { doc.font('latinBold').fontSize(8).fillColor(SOFT).text(t, x, y, { width: w, align: align || 'left', lineBreak: false }); };
    head('STATE', col[0], 160); head('REPORTS', col[1], 52, 'right'); head('HAPPENING NOW', col[2] + 4, 86, 'right'); head('DISTRICTS', col[3] + 12, width - (col[3] - left) - 12);
    y += 16; rule(y, INK, 1); y += 8;
    for (const s of report.states) {
      const dt = districtText(s) || (s.state === NO_STATE ? 'No state on the report' : '');
      doc.font('latin').fontSize(9.5);
      const h = Math.max(doc.heightOfString(dt, { width: width - (col[3] - left) - 12 }), 13);
      if (y + h > bottom() - 10) { doc.addPage(); y = doc.page.margins.top; }
      rich(doc, s.state, col[0], y, 160, { size: 10.5, bold: true, color: s.state === NO_STATE ? SOFT : INK });
      doc.font('latinBold').fontSize(10.5).fillColor(INK).text(String(s.count), col[1], y, { width: 52, align: 'right' });
      doc.font('latin').fontSize(10.5).fillColor(s.now ? RUST : SOFT).text(String(s.now), col[2] + 4, y, { width: 86, align: 'right' });
      rich(doc, dt, col[3] + 12, y + 1, width - (col[3] - left) - 12, { size: 9.5, color: SOFT });
      y = Math.max(doc.y, y + 14) + 6; rule(y); y += 7;
    }
    doc.font('latinBold').fontSize(10.5).fillColor(INK).text('All states', col[0], y, { width: 160 });
    doc.text(String(report.count), col[1], y, { width: 52, align: 'right' });
    doc.font('latin').fillColor(RUST).text(String(report.states.reduce((n, s) => n + s.now, 0)), col[2] + 4, y, { width: 86, align: 'right' });
    y = doc.y + 16;
  }
  const lo = report.leftOut || {};
  const notes = [
    '"Happening now" counts the reports whose sender said the cruelty was still going on when they reported it.',
    'Times are India time. Contact details are as the person gave them; mobiles were checked to be Indian mobile numbers when sent.',
    'Photographs sent with a report are kept in the PFA admin panel, under its reference number.'
  ];
  if (lo.spam || lo.removed) notes.push(`Left out: ${[lo.spam ? `${lo.spam} marked as spam` : '', lo.removed ? `${lo.removed} removed` : ''].filter(Boolean).join(' and ')} in the admin panel.`);
  if (y > bottom() - 80) { doc.addPage(); y = doc.page.margins.top; }
  for (const n of notes) { rich(doc, n, left, y, width, { size: 8.5, color: SOFT }); y = doc.y + 4; }

  /* each state, then each report in it */
  const labelW = 112;
  const valueX = left + labelW + 8;
  const valueW = width - labelW - 8;
  const field = (label, value, opts) => {
    if (!value) return;
    if (doc.y > bottom() - 24) doc.addPage();
    const y0 = doc.y;
    const page0 = doc.page;
    doc.font('latinBold').fontSize(8).fillColor(SOFT).text(label.toUpperCase(), left, y0 + 1.5, { width: labelW, characterSpacing: 0.3 });
    const yl = doc.y;
    rich(doc, value, valueX, y0, valueW, Object.assign({ size: 10 }, opts || {}));
    doc.y = (doc.page === page0 ? Math.max(yl, doc.y) : doc.y) + 3;
    doc.x = left;
  };
  for (const s of report.states) {
    doc.addPage();
    const top = doc.page.margins.top;
    rich(doc, `${report.label.toUpperCase()}  ·  CRUELTY REPORTS`, left, top, width, { size: 8.5, color: RUST, bold: true });
    rich(doc, s.state, left, top + 16, width, { size: 24, bold: true });
    const sub = `${s.count} report${s.count === 1 ? '' : 's'}${s.now ? `, ${s.now} still happening when reported` : ''}${s.districts.length ? `. Districts: ${districtText(s)}.` : '.'}`;
    rich(doc, sub, left, doc.y + 2, width, { size: 10, color: SOFT });
    doc.y += 12;
    s.rows.forEach((r, i) => {
      if (doc.y > bottom() - 150) {
        doc.addPage();
        rich(doc, `${s.state} (continued)`, left, doc.page.margins.top, width, { size: 9, color: SOFT, bold: true });
        doc.y += 8;
      }
      rule(doc.y, i ? HAIR : INK, i ? 0.6 : 1);
      doc.y += 9;
      const yr = doc.y;
      doc.font('latinBold').fontSize(12).fillColor(RUST).text(r.reference, left, yr, { width: width / 2 });
      doc.font('latin').fontSize(10).fillColor(INK).text(`${r.when}  ·  ${r.status}`, left + width / 2, yr + 1.5, { width: width / 2, align: 'right' });
      doc.y = Math.max(doc.y, yr + 18) + 4;
      doc.x = left;
      field('Reported by', r.name, { bold: true });
      field('Contact', [r.mobile, r.email].filter(Boolean).join('  ·  '));
      field('Where', [r.address, r.city, r.district, r.state || r.stateGiven, r.pincode ? `PIN ${r.pincode}` : ''].filter(Boolean).join(', '));
      /* every report should carry the whole address and a phone (required
         since 24 Oct 2026); anything an older one lacks is said, not skipped */
      field('Not given', missingOf(r), { color: RUST, bold: true });
      field('Map', r.mapLink, { color: RUST, link: r.mapLink, size: 9 });
      field('Animal', r.animal);
      field('Still going on?', r.urgency, r.urgency === 'Happening now' ? { color: RUST, bold: true } : null);
      field('When it happened', r.happened);
      field('Who is responsible', r.accused);
      field('What they saw', r.what, { lineGap: 2.5 });
      field('Photographs', r.photos ? `${r.photos} sent, kept in the admin panel under ${r.reference}` : '');
      doc.y += 8;
    });
  }

  /* the foot of every page */
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - 40;
    rule(fy - 8);
    doc.font('latin').fontSize(7.5).fillColor(SOFT)
      .text(`PFA cruelty reports, ${report.label}. Reporters' contact details: for PFA and government offices only.`, left, fy, { width: width - 70, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, left + width - 70, fy, { width: 70, align: 'right', lineBreak: false });
    doc.page.margins.bottom = keep;
  }
  doc.end();
  return done;
}

async function build(db, month) {
  const report = summarise(month, await collect(db, month));
  report.pdf = await pdfOf(report);
  return report;
}

/* ---- the PDF, kept ---------------------------------------------------- */

async function keepPdf(month, bytes) {
  const kept = await require('./file-store').put(`cruelty-reports/${month}.pdf`, bytes, 'application/pdf');
  if (kept.bytes && kept.bytes.length > 700 * 1024) return { tooLarge: true, size: bytes.length };
  return Object.assign({ size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }, kept);
}

async function readPdf(db, month) {
  const snap = await db.collection(COLLECTION).doc(month).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  if (!d.pdf) return null;
  const bytes = await require('./file-store').read(d.pdf);
  return bytes ? Buffer.from(bytes) : null;
}

/* ---- sending ---------------------------------------------------------- */

/* To the forms inbox (gandhim), and no one else. */
function recipients() {
  const to = (require('./submission-forward').formInboxes() || [])[0] || '';
  return { to, cc: [] };
}

function payloadOf(report, siteUrl, attempt) {
  return {
    reportMonth: report.month,
    label: report.label,
    count: report.count,
    states: report.states.map((s) => ({ state: s.state, count: s.count, now: s.now, districts: districtText(s) })),
    leftOut: report.leftOut,
    pdfName: fileName(report.month),
    attempt: attempt || 'first',
    siteUrl: String(siteUrl || '').replace(/\/+$/, '')
  };
}

async function appendSend(db, ref, entry) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const sends = (snap.exists && Array.isArray((snap.data() || {}).sends)) ? snap.data().sends.slice(-49) : [];
    sends.push(entry);
    tx.set(ref, { sends }, { merge: true });
  });
}

/* Make and queue one month's report, once (force: the panel's Send again). */
async function send({ db, month, nowMs = Date.now(), by = 'schedule', force = false, siteUrl = '', mail, queue } = {}) {
  const store = queue || require('./caregiver-store');
  const sender = mail || require('./caregiver-mail');
  const { label } = bounds(month);
  const ref = db.collection(COLLECTION).doc(month);
  const at = new Date(nowMs).toISOString();
  const attempt = force ? `again-${crypto.randomBytes(3).toString('hex')}` : 'first';

  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() || {} : null;
    if (d && !force && d.state !== 'failed') return false;
    tx.set(ref, Object.assign(d || { month, createdAt: at, sends: [] }, { label, state: 'making', claimedAt: at, claimedBy: by }), { merge: true });
    return true;
  });
  if (!claimed) return { state: 'already', month };

  try {
    const report = await build(db, month);
    const pdf = await keepPdf(month, report.pdf);
    const { to } = recipients();
    if (!to) throw new Error('No forms inbox is set (PFA_SUBMISSIONS_INBOX).');
    const payload = payloadOf(report, siteUrl, attempt);
    const configured = sender.isConfigured();
    const queued = await store.queueEmail({ template: 'cruelty_monthly', to, dedupeKey: `${month}:${attempt}`, claim: configured ? 'cruelty-report' : undefined, payload });
    const log = { at, by, attempt, emailId: queued.emailId, to, state: 'queued' };
    await ref.set({
      month, label, state: 'queued', madeAt: at, madeBy: by, count: report.count,
      states: report.states.map((s) => ({ state: s.state, count: s.count, now: s.now })),
      leftOut: report.leftOut,
      pdf: pdf.tooLarge ? null : pdf, pdfTooLarge: Boolean(pdf.tooLarge),
      emailId: queued.emailId, to
    }, { merge: true });
    await appendSend(db, ref, log);
    if (queued.created && configured) {
      try {
        const sent = await sender.deliver({ to, template: 'cruelty_monthly', payload });
        await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: true, providerId: sent.providerId });
        await ref.set({ state: 'sent', sentAt: new Date().toISOString() }, { merge: true });
        await appendSend(db, ref, Object.assign({}, log, { state: 'sent', at: new Date().toISOString() }));
        return { state: 'sent', month, emailId: queued.emailId, count: report.count };
      } catch (error) {
        await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: false, error });
        await appendSend(db, ref, Object.assign({}, log, { state: 'retrying', at: new Date().toISOString(), error: line(error && error.message, 200) }));
      }
    }
    return { state: 'queued', month, emailId: queued.emailId, count: report.count };
  } catch (error) {
    await ref.set({ state: 'failed', failedAt: new Date().toISOString(), error: line(error && error.message, 300) }, { merge: true }).catch(() => {});
    await appendSend(db, ref, { at, by, attempt, state: 'failed', error: line(error && error.message, 200) }).catch(() => {});
    return { state: 'failed', month, error: line(error && error.message, 300) };
  }
}

/* The scheduler's step: the email worker calls it on every run. */
async function run({ db, nowMs = Date.now(), siteUrl = '', mail, queue } = {}) {
  if (!due(nowMs)) return { state: 'not-due' };
  return send({ db, month: previousMonth(nowMs), nowMs, by: 'schedule', siteUrl, mail, queue });
}

async function status(db, month) {
  const snap = await db.collection(COLLECTION).doc(month).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  let email = null;
  if (d.emailId) {
    try {
      const row = await db.collection('caregiverEmails').doc(d.emailId).get();
      if (row.exists) {
        const e = row.data() || {};
        email = { status: e.status || '', attempts: Number(e.attempts) || 0, lastError: e.lastError ? line(e.lastError.message || e.lastError, 200) : '', sentAt: e.sentAt || '' };
      }
    } catch (_) { email = null; }
  }
  return Object.assign({}, d, { pdf: d.pdf ? { size: d.pdf.size || 0 } : null, email });
}

/* This month so far, then the eleven before it, newest first. */
function lastMonths(nowMs, n = 12) {
  const out = [];
  let month = currentMonth(nowMs);
  for (let i = 0; i < n; i += 1) {
    out.push(month);
    const [y, m] = month.split('-').map(Number);
    month = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
  }
  return out;
}

module.exports = {
  COLLECTION, KIND, NO_STATE, SEND_DAY, LAST_DAY,
  bounds, previousMonth, currentMonth, due, when, collect, summarise, districtText, missingOf, build, pdfOf, fileName,
  readPdf, recipients, payloadOf, send, run, status, lastMonths,
  _test: { istParts, mobileOf, runsOf, loadFonts }
};
