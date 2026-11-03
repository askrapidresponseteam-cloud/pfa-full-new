'use strict';

/* The monthly payments report (owner, 1 Nov 2026: "On the 1st of every
   month, automatically email a consolidated financial report for the
   previous calendar month to gandhim, CC'ing the accounts team using the
   same email addresses that currently receive donation notifications ...
   Only successful payment records").

   This is the one email about money that goes to gandhim, by that
   instruction; every other record of money still goes to the payments
   inboxes alone (lib/caregiver-mail.js, moneyToWrongInbox), and this
   report is copied to them.

   What it reads: this site's transactions register, which holds every
   payment the site has taken (donations, memberships, colony card postage,
   shop orders through the shop ledger in lib/shop-backend.js), and only the
   ones CCAvenue's answer settled as success. Each is put under one of five
   heads, in this order:

     Donations                  type donate (a gift in someone's name too)
     Patrons and membership     type membership
     Shop orders                type shop
     Colony caregiver cards     types caregiver and caregiver-application
     Other payments             anything else that was paid (the retired
                                Give/Send orders, a type added later)

   A payment belongs to the month it was paid in, India time. The day it was
   paid is read from, in order: paidAt (written from 1 Nov 2026 on), the
   first successful answer from CCAvenue on record (paymentEvents), then the
   register's own updatedAt. Records from the site's testing (20 Oct 2026
   and earlier, lib/test-data.js) are never counted.

   When: the backend's own runs (the email worker: Vercel's daily cron and
   Firebase's every ten minutes) call run(). On the 1st of a month, India
   time, it reports the month before; if the 1st was missed (a server down
   all day), it still reports up to the 7th. Once only: the month's record
   finance_reports/{YYYY-MM} is created in a transaction, so two servers
   running together never send two, and a month already reported is left
   alone. The email goes through the outbound queue (caregiverEmails), which
   retries, keys it by the month, and keeps every attempt: the record here
   carries the queue row's id, and the panel shows both (delivery log).

   The CSV: every row of the month, built when the report is made and kept
   with it (Firebase Storage, or in the record if the bucket is not set up),
   attached to the email and downloadable in the panel. Amounts are in their
   own currency; rupees and dollars are never added together. */

const crypto = require('crypto');

const COLLECTION = 'finance_reports';
const IST_MS = 330 * 60000;
const CATCH_UP_DAYS = 7;
/* The email lists every payment up to this many; the CSV always has all. */
const EMAIL_ROWS = 400;

const HEADS = [
  { key: 'donations', label: 'Donations', types: ['donate'] },
  { key: 'membership', label: 'Patrons and membership', types: ['membership'] },
  { key: 'shop', label: 'Shop orders', types: ['shop'] },
  { key: 'caregiver', label: 'Colony caregiver cards', types: ['caregiver', 'caregiver-application'] },
  { key: 'other', label: 'Other payments', types: [] }
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 200);

/* ---- the calendar, India time ---------------------------------------- */

function istParts(ms) {
  const d = new Date(Number(ms) + IST_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}
const pad = (n) => String(n).padStart(2, '0');

/* "2026-10" -> the month's first and last instants (UTC ms), India time */
function bounds(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) throw new Error('A month is YYYY-MM.');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) throw new Error('A month is YYYY-MM.');
  const from = Date.UTC(y, mo - 1, 1) - IST_MS;
  const to = Date.UTC(y, mo, 1) - IST_MS;
  return { from, to, label: `${MONTHS[mo - 1]} ${y}` };
}

/* The month before the one `nowMs` falls in, India time: "2026-10" on 1 Nov 2026 */
function previousMonth(nowMs) {
  const p = istParts(nowMs);
  const y = p.m === 1 ? p.y - 1 : p.y;
  const m = p.m === 1 ? 12 : p.m - 1;
  return `${y}-${pad(m)}`;
}

/* Is it time to report last month? The 1st, India time, or up to the 7th
   if the 1st went by without a run. */
function due(nowMs) {
  const p = istParts(nowMs);
  return p.day >= 1 && p.day <= CATCH_UP_DAYS;
}

/* ---- reading the register --------------------------------------------- */

function millis(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  return 0;
}

function headOf(type) {
  const t = String(type || '');
  return (HEADS.find((h) => h.types.includes(t)) || HEADS[HEADS.length - 1]).key;
}

function purposeOf(t) {
  const meta = t.metadata || {};
  const type = String(t.type || '');
  if (type === 'donate') {
    const cause = clean(meta.cause, 120) || 'Where it is needed most';
    return meta.gift && meta.gift.to ? `Gift for ${clean(meta.gift.to, 80)}; ${cause}` : `Donation; ${cause}`;
  }
  if (type === 'membership') return clean(meta.tierLabel, 80) || 'PFA membership';
  if (type === 'shop') return clean(meta.note, 200) || 'Shop order';
  if (type === 'caregiver') return meta.kind === 'caregiver-replacement' ? 'Colony caregiver card: replacement, printing and postage' : 'Colony caregiver card: printing and postage';
  if (type === 'caregiver-application') return 'Colony caregiver card application: postage';
  if (type === 'send') return clean(meta.note, 160) || 'Give/Send order';
  return clean(meta.note || meta.cause, 160) || clean(type, 40) || 'Payment';
}

function referenceOf(t) {
  return clean(t.donationReference || t.membershipReference || t.applicationReference || (t.metadata && t.metadata.cardId) || '', 60);
}

/* Every successful payment paid in `month`, India time, newest last within
   each head. `db` is this site's Firestore. */
async function collect(db, month) {
  const { from, to } = bounds(month);
  return collectBetween(db, from, to);
}

/* Every successful payment paid from `from` up to (not including) `to`,
   both in milliseconds. */
async function collectBetween(db, from, to) {
  const TEST = require('./test-data');
  const [paid, answers] = await Promise.all([
    db.collection('transactions').where('status', '==', 'success').get(),
    db.collection('paymentEvents').where('status', '==', 'success').get().catch(() => ({ docs: [] }))
  ]);
  /* the first successful answer CCAvenue gave for each order */
  const firstAnswer = new Map();
  for (const doc of answers.docs || []) {
    const e = doc.data() || {};
    const at = millis(e.receivedAt);
    const id = String(e.orderId || '');
    if (!id || !at) continue;
    if (!firstAnswer.has(id) || at < firstAnswer.get(id)) firstAnswer.set(id, at);
  }
  const rows = [];
  for (const doc of paid.docs || []) {
    const t = Object.assign({ orderId: doc.id }, doc.data() || {});
    if (t.status !== 'success') continue;
    if (TEST.isTest && TEST.isTest(t)) continue;
    const at = millis(t.paidAt) || firstAnswer.get(doc.id) || millis(t.updatedAt) || millis(t.createdAt);
    if (!at || at < from || at >= to) continue;
    const customer = t.customer || {};
    const cca = t.ccaVenue || {};
    const amount = Math.round(Number(t.amount || 0) * 100) / 100;
    if (!(amount > 0)) continue;
    const p = istParts(at);
    rows.push({
      source: 'new',
      type: String(t.type || ''),
      head: headOf(t.type),
      paidAtMs: at,
      date: `${p.y}-${pad(p.m)}-${pad(p.day)}`,
      time: `${pad(p.hh)}:${pad(p.mm)}`,
      name: clean(customer.name, 120) || 'Not given',
      purpose: purposeOf(t),
      amount,
      currency: String(t.currency || 'INR').toUpperCase() === 'USD' ? 'USD' : 'INR',
      status: 'Success',
      orderId: clean(t.orderId || doc.id, 60),
      reference: referenceOf(t),
      bankReference: clean(cca.bankReference, 80),
      trackingId: clean(cca.trackingId, 80),
      mode: clean(cca.paymentMode, 40)
    });
  }
  rows.sort((a, b) => a.paidAtMs - b.paidAtMs || a.orderId.localeCompare(b.orderId));
  return rows;
}

/* ---- the report ------------------------------------------------------- */

function addTo(totals, currency, amount) {
  totals[currency] = Math.round(((totals[currency] || 0) + amount) * 100) / 100;
}

function summarise(month, rows, named) {
  const label = named || bounds(month).label;
  const heads = HEADS.map((h) => {
    const mine = rows.filter((r) => r.head === h.key);
    const subtotal = {};
    for (const r of mine) addTo(subtotal, r.currency, r.amount);
    return { key: h.key, label: h.label, count: mine.length, subtotal, rows: mine };
  });
  const total = {};
  for (const r of rows) addTo(total, r.currency, r.amount);
  return { month, label, count: rows.length, total, heads };
}

function money(amount, currency) {
  const n = Number(amount || 0);
  return currency === 'USD'
    ? `USD ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `INR ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* "INR 12,500.00 and USD 40.00", or "INR 0.00" for an empty month */
function totalText(totals) {
  const parts = ['INR', 'USD'].filter((c) => totals[c]).map((c) => money(totals[c], c));
  return parts.length ? parts.join(' and ') : money(0, 'INR');
}

/* One CSV for the month: a line per payment under its head, a subtotal
   line after each head, and the grand total at the foot. Excel opens it as
   it is (UTF-8 with its mark, CRLF lines); a cell that could be read as a
   formula is written as text. */
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvOf(report) {
  const lines = [];
  const row = (cells) => lines.push(cells.map(csvCell).join(','));
  row([`PFA payments report, ${report.label} (India time); successful payments only`]);
  row([]);
  const rec = report.reconciliation;
  row(['Category', 'Payer', 'Paid on (IST)', 'Time (IST)', 'Purpose', 'Currency', 'Amount', 'Status', 'PFA transaction ID', 'PFA reference', 'Bank reference', 'CCAvenue tracking ID', 'Paid by'].concat(rec ? ['Recorded on', 'Checked with CCAvenue'] : []));
  for (const h of report.heads) {
    for (const r of h.rows) {
      row([h.label, r.name, r.date, r.time, r.purpose, r.currency, r.amount.toFixed(2), r.status, r.orderId, r.reference, r.bankReference, r.trackingId, r.mode]
        .concat(rec ? [r.source === 'old' ? 'Old site' : 'New site', r.gateway || ''] : []));
    }
    for (const c of ['INR', 'USD']) {
      if (h.subtotal[c]) row([`${h.label}: subtotal`, `${h.count} payment${h.count === 1 ? '' : 's'}`, '', '', '', c, h.subtotal[c].toFixed(2)]);
    }
    if (!h.count) row([`${h.label}: subtotal`, 'No payments', '', '', '', 'INR', '0.00']);
  }
  row([]);
  for (const c of ['INR', 'USD']) {
    if (report.total[c] || c === 'INR') row(['Grand total', `${report.count} payment${report.count === 1 ? '' : 's'}`, '', '', '', c, Number(report.total[c] || 0).toFixed(2)]);
  }
  if (rec) {
    const s = rec.summary;
    const site = (x) => (x === 'old' ? 'Old site' : 'New site');
    row([]);
    row(['Reconciliation']);
    if (rec.window) row([rec.window.note]);
    row([`Old site records (${rec.window ? `${rec.window.from} to ${rec.window.to}` : 'imported'})`, String(s.oldSite)]);
    row(['New site records', String(s.newSite)]);
    row(['Recorded on both sites, counted once (matched by gateway identifier)', String(s.matched)]);
    row(['Counted', String(s.counted)]);
    row(['Confirmed with CCAvenue', String(s.confirmed)]);
    row(['Amount corrected to CCAvenue\'s', String(s.corrected)]);
    row(['Not confirmed with CCAvenue (counted as recorded)', String(s.unconfirmed)]);
    row(['Left out: CCAvenue says not successful', String(s.excluded)]);
    if (rec.matched.length) {
      row([]);
      row(['Counted once', 'Kept', 'Kept from', 'Also recorded as', 'Recorded on', 'Matched by', 'Same amount']);
      for (const m of rec.matched) row(['', m.kept, site(m.keptSource), m.dropped, site(m.droppedSource), m.by, m.sameAmount ? 'Yes' : 'No']);
    }
    if (rec.excluded.length) {
      row([]);
      row(['Left out', 'PFA transaction ID', 'Recorded on', 'Payer', 'Currency', 'Amount', 'Why']);
      for (const x of rec.excluded) row(['', x.orderId, site(x.source), x.name, x.currency, x.amount.toFixed(2), x.reason]);
    }
    if (rec.corrected.length) {
      row([]);
      row(['Amount corrected', 'PFA transaction ID', 'Recorded on', 'Payer', 'Currency', 'Recorded', 'CCAvenue']);
      for (const x of rec.corrected) row(['', x.orderId, site(x.source), x.name, x.currency, x.recorded.toFixed(2), Number(x.gateway).toFixed(2)]);
    }
    if (rec.unconfirmed.length) {
      row([]);
      row(['Not confirmed with CCAvenue', 'PFA transaction ID', 'Recorded on', 'Payer', 'Currency', 'Amount', 'Why']);
      for (const x of rec.unconfirmed) row(['', x.orderId, site(x.source), x.name, x.currency, x.amount.toFixed(2), x.reason]);
    }
    if (rec.lookalikes.length) {
      row([]);
      row(['Alike but different payments (both counted)', 'One', 'Other', 'Payer', 'Amount', 'Date']);
      for (const x of rec.lookalikes) row(['', x.a, x.b, x.name, x.amount.toFixed(2), x.date]);
    }
  }
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

function fileName(month) {
  return `PFA-payments-${month}.csv`;
}

/* "2026-11-03" -> "3 Nov 2026", as the email shows it (the CSV keeps the
   sortable form) */
function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1].slice(0, 3)} ${m[1]}` : String(iso || '');
}

/* What the email is made from: the totals, and the payments themselves up to
   EMAIL_ROWS (the rest are in the CSV). Kept small enough for the queue. */
function payloadOf(report, siteUrl) {
  let left = EMAIL_ROWS;
  const heads = report.heads.map((h) => {
    const shown = h.rows.slice(0, Math.max(0, left));
    left -= shown.length;
    return {
      key: h.key, label: h.label, count: h.count,
      subtotal: totalText(h.subtotal),
      rows: shown.map((r) => ({ name: r.name, date: shortDate(r.date), time: r.time, purpose: r.purpose, amount: money(r.amount, r.currency), status: r.status, orderId: r.orderId, reference: r.reference })),
      more: h.count - shown.length
    };
  });
  const rec = report.reconciliation;
  const list = (xs, f) => xs.slice(0, 40).map(f);
  return {
    reconciliation: rec ? {
      note: rec.window ? rec.window.note : '',
      summary: rec.summary,
      matched: list(rec.matched, (m) => `${m.dropped} (${m.droppedSource === 'old' ? 'old site' : 'new site'}) is ${m.kept}: same ${m.by}`),
      excluded: list(rec.excluded, (x) => `${x.orderId}, ${x.name}, ${money(x.amount, x.currency)}: ${x.reason}`),
      corrected: list(rec.corrected, (x) => `${x.orderId}, ${x.name}: recorded ${money(x.recorded, x.currency)}, CCAvenue ${money(x.gateway, x.currency)}`),
      unconfirmed: list(rec.unconfirmed, (x) => `${x.orderId}, ${x.name}, ${money(x.amount, x.currency)}: ${x.reason}`),
      lookalikes: list(rec.lookalikes, (x) => `${x.a} and ${x.b}: ${x.name}, ${x.amount.toFixed(2)} on ${x.date}`)
    } : null,
    reportMonth: report.month,
    label: report.label,
    count: report.count,
    total: totalText(report.total),
    heads,
    csvName: fileName(report.month),
    siteUrl: String(siteUrl || '').replace(/\/+$/, '')
  };
}

/* Build the month's report. */
async function build(db, month) {
  const REC = require('./finance-reconcile');
  const newRows = await collect(db, month);
  const [imported, checks] = await Promise.all([REC.importOf(db, month), REC.checksOf(db, month)]);
  const window = REC.OLD_SITE_WINDOWS[month] || null;
  /* A month with the old site's payments, or checked with CCAvenue: each
     payment once, by gateway identifier, and the gateway's word applied
     (lib/finance-reconcile.js). Any other month: this site's records. */
  if (imported || window || Object.keys(checks).length) {
    const oldRows = imported ? imported.rows || [] : [];
    const rec = REC.reconcile(newRows, oldRows, checks);
    const report = summarise(month, rec.rows);
    report.reconciliation = Object.assign({ window: window ? Object.assign({ month }, window) : null, imported: Boolean(imported), importedAt: imported ? imported.importedAt || '' : '' }, rec);
    return Object.assign(report, { csv: csvOf(report) });
  }
  const report = summarise(month, newRows);
  return Object.assign(report, { csv: csvOf(report) });
}

/* ---- the CSV, kept --------------------------------------------------- */

async function keepCsv(month, csv) {
  const bytes = Buffer.from(csv, 'utf8');
  const kept = await require('./file-store').put(`finance-reports/${month}.csv`, bytes, 'text/csv; charset=utf-8');
  /* a record holds at most ~1 MB: past that the bucket is the only home */
  if (kept.bytes && kept.bytes.length > 700 * 1024) return { tooLarge: true, size: bytes.length };
  return Object.assign({ size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }, kept);
}

async function readCsv(db, month) {
  const snap = await db.collection(COLLECTION).doc(month).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  if (!d.csv) return null;
  const bytes = await require('./file-store').read(d.csv);
  return bytes ? Buffer.from(bytes) : null;
}

/* ---- sending ---------------------------------------------------------- */

function recipients() {
  const FWD = require('./submission-forward');
  const to = (FWD.formInboxes() || [])[0] || '';
  const cc = (FWD.paymentInboxes() || []).filter((a) => a && a !== to);
  return { to, cc };
}

/* Make and queue one month's report, once. Returns what happened:
     { state: 'queued' | 'sent' | 'already' | 'not-due' | 'failed', month, ... }
   force: the panel's "Send again" for a month (a second email, logged as
   such); otherwise a month already made is left as it is. */
async function send({ db, month, nowMs = Date.now(), by = 'schedule', force = false, siteUrl = '', mail, queue } = {}) {
  const store = queue || require('./caregiver-store');
  const sender = mail || require('./caregiver-mail');
  const ref = db.collection(COLLECTION).doc(month);
  const at = new Date(nowMs).toISOString();
  const attempt = force ? `again-${crypto.randomBytes(3).toString('hex')}` : 'first';

  /* claim the month: one server makes it, once */
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() || {} : null;
    if (d && !force && d.state !== 'failed' && d.state !== 'waiting-old-site') return false;
    tx.set(ref, Object.assign(d || { month, createdAt: at, sends: [] }, { state: 'making', claimedAt: at, claimedBy: by }), { merge: true });
    return true;
  });
  if (!claimed) return { state: 'already', month };

  try {
    const report = await build(db, month);
    const csv = await keepCsv(month, report.csv);
    const { to, cc } = recipients();
    if (!to) throw new Error('No forms inbox is set (PFA_SUBMISSIONS_INBOX).');
    const payload = Object.assign(payloadOf(report, siteUrl), { cc, attempt });
    const configured = sender.isConfigured();
    const queued = await store.queueEmail({
      template: 'finance_monthly',
      to,
      dedupeKey: `${month}:${attempt}`,
      claim: configured ? 'finance-report' : undefined,
      payload
    });
    const log = { at, by, attempt, emailId: queued.emailId, to, cc, state: 'queued' };
    await ref.set({
      month, label: report.label, state: 'queued', madeAt: at, madeBy: by,
      count: report.count, total: report.total, totalText: totalText(report.total),
      heads: report.heads.map((h) => ({ key: h.key, label: h.label, count: h.count, subtotal: h.subtotal })),
      csv: csv.tooLarge ? null : csv, csvTooLarge: Boolean(csv.tooLarge),
      emailId: queued.emailId, to, cc
    }, { merge: true });
    await appendSend(db, ref, log);

    /* sent now when mail is set up; otherwise, and on any failure, the
       queue's worker retries it */
    if (queued.created && configured) {
      try {
        const sent = await sender.deliver({ to, template: 'finance_monthly', payload });
        await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: true, providerId: sent.providerId });
        await ref.set({ state: 'sent', sentAt: new Date().toISOString() }, { merge: true });
        await appendSend(db, ref, Object.assign({}, log, { state: 'sent', at: new Date().toISOString() }));
        return { state: 'sent', month, emailId: queued.emailId, count: report.count, total: totalText(report.total) };
      } catch (error) {
        await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: false, error });
        await appendSend(db, ref, Object.assign({}, log, { state: 'retrying', at: new Date().toISOString(), error: clean(error && error.message, 200) }));
      }
    }
    return { state: 'queued', month, emailId: queued.emailId, count: report.count, total: totalText(report.total) };
  } catch (error) {
    await ref.set({ state: 'failed', failedAt: new Date().toISOString(), error: clean(error && error.message, 300) }, { merge: true }).catch(() => {});
    await appendSend(db, ref, { at, by, attempt, state: 'failed', error: clean(error && error.message, 200) }).catch(() => {});
    return { state: 'failed', month, error: clean(error && error.message, 300) };
  }
}

/* ---- a report for any period, sent by hand ----------------------------

   Owner, 3 Nov 2026, on Payments & donations: "have 1 option to send report
   from here to selected people with segregation. it should go as report, for
   the selected duration". The period chosen above the list (a month, two
   dates, or all time) and its purpose, made the same way as the monthly
   report: successful payments only, under the same five heads with their
   subtotals, every payment listed, the CSV attached.

   To whom: only the inboxes money already goes to. The payments inboxes
   (PFA_PAYMENTS_INBOX), each on its own; or the forms inbox, which, like the
   monthly report, is always copied to the payments inboxes (owner, 21 Oct
   2026: money records to the payments inboxes; 1 Nov 2026: the monthly
   report to gandhim, CC'ing them). No other address, whatever is asked.

   Kept: finance_report_sends/{id}, with the period, who sent it, to whom,
   the totals, the CSV (Firebase Storage, or the record) and each email's
   queue row. */

const SENDS = 'finance_report_sends';
const DAY_MS = 24 * 60 * 60 * 1000;

/* The addresses a report may go to, as the panel offers them. */
function periodRecipients() {
  const FWD = require('./submission-forward');
  const pay = (FWD.paymentInboxes() || []).filter(Boolean);
  const form = ((FWD.formInboxes() || [])[0] || '').toLowerCase();
  const out = pay.map((address) => ({ address, role: 'Payments inbox', cc: [] }));
  if (form && !pay.includes(form)) out.unshift({ address: form, role: 'Forms inbox', cc: pay });
  return out;
}

/* "2026-11-03" read as the start of that day in India */
function istDay(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - IST_MS : null;
}
function dayLabel(ms) {
  const p = istParts(ms);
  return `${p.day} ${MONTHS[p.m - 1].slice(0, 3)} ${p.y}`;
}
function dayKey(ms) {
  const p = istParts(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.day)}`;
}

/* The period the panel asked for: { month } or { from, to } (days, India
   time, either order) or neither (all time). Never past now. */
function periodOf(input, nowMs = Date.now()) {
  const q = input || {};
  let from; let to; let label;
  if (q.month) {
    const b = bounds(String(q.month));
    from = b.from; to = b.to; label = b.label;
  } else if (q.from || q.to) {
    let a = istDay(q.from); let z = istDay(q.to);
    if (q.from && a === null) throw Object.assign(new Error('A date is YYYY-MM-DD.'), { code: 'BAD_DATE' });
    if (q.to && z === null) throw Object.assign(new Error('A date is YYYY-MM-DD.'), { code: 'BAD_DATE' });
    if (a !== null && z !== null && z < a) { const x = a; a = z; z = x; }
    from = a === null ? 0 : a;
    to = z === null ? nowMs : z + DAY_MS;
    label = a === null ? `Up to ${dayLabel(to - 1)}` : z === null ? `${dayLabel(from)} onwards` : (a === z ? dayLabel(a) : `${dayLabel(a)} to ${dayLabel(z)}`);
  } else {
    from = 0; to = nowMs; label = `All time, to ${dayLabel(nowMs)}`;
  }
  if (from >= nowMs) throw Object.assign(new Error('That period has not begun yet.'), { code: 'NOT_BEGUN' });
  /* a period still running: up to now, and said so */
  if (to > nowMs) { to = nowMs; label = `${label}, to ${dayLabel(nowMs)}`; }
  const file = from ? `${dayKey(from)}-to-${dayKey(to - 1)}` : `to-${dayKey(to - 1)}`;
  return { from, to, label, file };
}

/* The report for a period, the purposes chosen (types; none is every one). */
async function buildPeriod(db, period, types) {
  const only = (types || []).filter(Boolean);
  let rows = await collectBetween(db, period.from, period.to);
  if (only.length) rows = rows.filter((r) => only.includes(r.type));
  const report = summarise(period.file, rows, period.label);
  if (only.length) report.heads = report.heads.filter((h) => h.count || only.some((t) => headOf(t) === h.key));
  return Object.assign(report, { csv: csvOf(report) });
}

/* Make the report and email it to the addresses chosen. Returns
   { state: 'sent' | 'queued' | 'failed', sendId, count, total, emails }. */
async function sendPeriod({ db, period, types, to, by = '', nowMs = Date.now(), siteUrl = '', purposeLabel = '', mail, queue } = {}) {
  const store = queue || require('./caregiver-store');
  const sender = mail || require('./caregiver-mail');
  const allowed = periodRecipients();
  const asked = [...new Set((Array.isArray(to) ? to : [to]).map((a) => String(a || '').trim().toLowerCase()).filter(Boolean))];
  if (!asked.length) throw Object.assign(new Error('Choose who the report goes to.'), { code: 'NO_RECIPIENT' });
  const stray = asked.filter((a) => !allowed.some((x) => x.address === a));
  if (stray.length) throw Object.assign(new Error(`A payments report goes only to the payments inboxes or the forms inbox, not ${stray.join(', ')}.`), { code: 'NOT_ALLOWED' });
  /* the forms inbox carries the payments inboxes in copy: no second email to them */
  const form = allowed.find((x) => x.role === 'Forms inbox');
  const copied = form && asked.includes(form.address) ? form.cc : [];
  const targets = asked.filter((a) => !copied.includes(a));

  const report = await buildPeriod(db, period, types);
  const sendId = `R-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const csvName = `PFA-payments-${period.file}.csv`;
  const at = new Date(nowMs).toISOString();
  const kept = await (async () => {
    const bytes = Buffer.from(report.csv, 'utf8');
    const k = await require('./file-store').put(`finance-reports/sent/${sendId}.csv`, bytes, 'text/csv; charset=utf-8');
    return k.bytes && k.bytes.length > 700 * 1024 ? null : k;
  })();
  const ref = db.collection(SENDS).doc(sendId);
  await ref.set({
    sendId, at, by, label: report.label, from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString(),
    types: types || [], purpose: purposeLabel, count: report.count, total: report.total, totalText: totalText(report.total),
    heads: report.heads.map((h) => ({ key: h.key, label: h.label, count: h.count, subtotal: h.subtotal })),
    csv: kept, csvName, recipients: targets, copied, emails: []
  });
  const payload = Object.assign(payloadOf(report, siteUrl), { sendId, csvName, purpose: purposeLabel, reportMonth: undefined });
  const configured = sender.isConfigured();
  const emails = [];
  for (const address of targets) {
    const queued = await store.queueEmail({ template: 'finance_period', to: address, dedupeKey: `${sendId}:${address}`, claim: configured ? 'finance-period' : undefined, payload });
    const e = { to: address, cc: address === (form && form.address) ? copied : [], emailId: queued.emailId, state: 'queued' };
    if (queued.created && configured) {
      try {
        const out = await sender.deliver({ to: address, template: 'finance_period', payload });
        await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: true, providerId: out.providerId });
        e.state = 'sent';
      } catch (error) {
        await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: false, error });
        e.state = 'retrying'; e.error = clean(error && error.message, 200);
      }
    }
    emails.push(e);
  }
  await ref.set({ emails }, { merge: true });
  return { state: emails.every((e) => e.state === 'sent') ? 'sent' : 'queued', sendId, label: report.label, count: report.count, total: totalText(report.total), emails };
}

async function readSentCsv(db, sendId) {
  if (!/^R-[0-9A-F]{10}$/.test(String(sendId || ''))) return null;
  const snap = await db.collection(SENDS).doc(String(sendId)).get();
  const d = snap.exists ? snap.data() || {} : {};
  if (!d.csv) return null;
  const bytes = await require('./file-store').read(d.csv);
  return bytes ? { name: d.csvName || `PFA-payments-${sendId}.csv`, bytes: Buffer.from(bytes) } : null;
}

async function appendSend(db, ref, entry) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const sends = (snap.exists && Array.isArray((snap.data() || {}).sends)) ? snap.data().sends.slice(-49) : [];
    sends.push(entry);
    tx.set(ref, { sends }, { merge: true });
  });
}

/* The scheduler's step (the email worker calls it on every run). */
async function run({ db, nowMs = Date.now(), siteUrl = '', mail, queue } = {}) {
  if (!due(nowMs)) return { state: 'not-due' };
  const month = previousMonth(nowMs);
  /* A month that must carry the old site's payments waits for them: it is
     sent from the panel once they are in and checked with CCAvenue. */
  const REC = require('./finance-reconcile');
  if (REC.OLD_SITE_WINDOWS[month]) {
    const ref = db.collection(COLLECTION).doc(month);
    const snap = await ref.get();
    const d = snap.exists ? snap.data() || {} : {};
    if (d.state && d.state !== 'waiting-old-site' && d.state !== 'failed') return { state: 'already', month };
    if (!d.state) await ref.set({ month, label: bounds(month).label, state: 'waiting-old-site', waitingSince: new Date(nowMs).toISOString(), sends: [] }, { merge: true });
    return { state: 'waiting-old-site', month };
  }
  return send({ db, month, nowMs, by: 'schedule', siteUrl, mail, queue });
}

/* The delivery state of a month's email, from the queue row (the log). */
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
        email = { status: e.status || '', attempts: Number(e.attempts) || 0, lastError: e.lastError ? clean(e.lastError.message || e.lastError, 200) : '', sentAt: e.sentAt || '' };
      }
    } catch (_) { email = null; }
  }
  return Object.assign({}, d, { csv: d.csv ? { size: d.csv.size || 0 } : null, email });
}

module.exports = {
  COLLECTION, HEADS, EMAIL_ROWS,
  bounds, previousMonth, due, collect, summarise, build, csvOf, fileName, payloadOf, money, totalText,
  readCsv, recipients, send, run, status,
  collectBetween, periodRecipients, periodOf, buildPeriod, sendPeriod, readSentCsv, SENDS,
  _test: { istParts, headOf, purposeOf, millis }
};
