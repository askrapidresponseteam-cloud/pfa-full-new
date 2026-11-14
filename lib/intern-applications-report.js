'use strict';

/* Remote internship applications, once a month, to gandhim (owner, 14 Nov
   2026: "gandhim shouldnt be getting an email each time one applies for
   internship. monthyl report of people who applied for remote internship
   should do").

   An internship application is no longer copied to the forms inbox when it
   comes in (lib/submission-forward.js PANEL_ONLY_KINDS); it is in the panel
   at once, and in this report. On the 1st of each month, India time (up to
   the 7th if the 1st went by without a run), everyone who applied in the
   month before goes to the forms inbox (gandhim) in one email, once:
   intern_application_reports/{YYYY-MM} is claimed in a transaction. A line
   per person (the day they applied, their name, email, mobile and place,
   their application number, and where they stand now: started, with their
   Intern ID and batch, and whether they have signed in; missing a detail;
   or turned down), the month at a glance, and a CSV with every line and
   what they wrote. Never the date of birth: it is how an intern signs in.
   A month with nobody still sends a short note, so a missing email always
   means something went wrong. The email worker calls run() on every run;
   PFA_INTERN_APPS_REPORT=off stops it (the test suite sets it). */

const crypto = require('crypto');
const FIN = require('./finance-report');
const APPS = require('./intern-applications');
const I = require('./internship');

const COLLECTION = 'intern_application_reports';
const ROWS = 300;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 200);

function dayOf(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms + 330 * 60000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/* where someone stands now, in a few words */
function standingOf(a, intern, batchName) {
  if (intern) return { key: intern.lastSignInAt ? 'signed-in' : 'started', text: intern.lastSignInAt ? 'Started, signed in' : 'Started, not signed in yet', internId: intern.internId, batch: batchName || intern.batchId || '' };
  if (['rejected', 'withdrawn'].includes(a.status)) return { key: 'closed', text: 'Turned down', internId: '', batch: '' };
  const p = APPS.applicantOf(a);
  if (p.missing.length) return { key: 'missing', text: `Missing ${APPS.listOf(p.missing)}`, internId: '', batch: '' };
  return { key: 'waiting', text: 'Being started', internId: '', batch: '' };
}

async function build(db, month) {
  const { from, to, label } = FIN.bounds(month);
  const S = require('./intern-store');
  const interns = (await S.listInterns(db)).filter((i) => i.status !== 'reserving' && i.status !== 'revoked');
  const byRef = new Map(interns.filter((i) => i.applicationRef).map((i) => [i.applicationRef, i]));
  const byEmail = new Map(interns.map((i) => [i.email, i]));
  const batches = new Map((await S.listBatches(db)).map((b) => [b.batchId, b.name]));
  const apps = await require('./intern-applications-report-read').applicationsBetween(db, from, to);
  const rows = apps.map((a) => {
    const p = APPS.applicantOf(a);
    const f = Object.assign({}, a.fields || {}, ...((a.resent || []).map((r) => r.fields || {})));
    const intern = byRef.get(a.reference) || byEmail.get(I.emailOf(p.email)) || null;
    const s = standingOf(a, intern, intern ? batches.get(intern.batchId) : '');
    const place = [f.district || p.city, f.state].map((x) => clean(x, 60)).filter(Boolean).filter((x, i, all) => all.indexOf(x) === i).join(', ');
    return {
      reference: a.reference, applied: dayOf(a.createdAt), name: clean(p.name, 80) || 'Someone', email: clean(p.email, 120), mobile: clean(p.mobile, 20),
      age: clean(f.age, 4), place, work: clean(f.work, 120), social: clean(f.social, 120), why: clean(f.why, 900),
      standing: s.key, status: s.text, internId: s.internId, batch: clean(s.batch, 60)
    };
  });
  const count = (k) => rows.filter((r) => r.standing === k).length;
  return {
    month, label, count: rows.length, rows,
    started: count('started') + count('signed-in'), signedIn: count('signed-in'), notSignedIn: count('started'),
    missing: count('missing'), closed: count('closed'), waiting: count('waiting')
  };
}

function csvOf(rows) {
  const cell = (v) => {
    const s = String(v == null ? '' : v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // a spreadsheet must not run it as a formula
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ['Applied (IST)', 'Application', 'Name', 'Email', 'Mobile', 'Age', 'Place', 'Status', 'Intern ID', 'Batch', 'College or work', 'Instagram or YouTube', 'Why they want to do it'];
  const lines = [head.map(cell).join(',')].concat((rows || []).map((r) => [r.applied, r.reference, r.name, r.email, r.mobile, r.age, r.place, r.status, r.internId, r.batch, r.work, r.social, r.why].map(cell).join(',')));
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}

function fileName(month) { return `PFA-internship-applications-${month}.csv`; }

function payloadOf(report, attempt) {
  return {
    reportMonth: report.month, label: report.label, count: report.count, started: report.started, signedIn: report.signedIn,
    notSignedIn: report.notSignedIn, missing: report.missing, closed: report.closed, waiting: report.waiting,
    rows: report.rows.slice(0, ROWS).map((r) => ({ reference: r.reference, applied: r.applied, name: r.name, email: r.email, mobile: r.mobile, place: r.place, status: r.status, internId: r.internId, batch: r.batch })),
    more: Math.max(0, report.rows.length - ROWS), csvName: fileName(report.month), attempt: attempt || 'first'
  };
}

function recipients() {
  const to = String((require('./submission-forward').formInboxes() || [])[0] || '').trim().toLowerCase();
  return { to, cc: [] };
}

async function appendSend(db, ref, entry) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const sends = (snap.exists && Array.isArray((snap.data() || {}).sends)) ? snap.data().sends.slice(-29) : [];
    sends.push(entry);
    tx.set(ref, { sends }, { merge: true });
  });
}

/* Make and queue one month's email, once (force: send it again). */
async function send({ db, month, nowMs = Date.now(), by = 'schedule', force = false, mail, queue } = {}) {
  const store = queue || require('./caregiver-store');
  const sender = mail || require('./caregiver-mail');
  FIN.bounds(month);
  const ref = db.collection(COLLECTION).doc(month);
  const at = new Date(nowMs).toISOString();
  const attempt = force ? `again-${crypto.randomBytes(3).toString('hex')}` : 'first';

  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() || {} : null;
    if (d && !force && d.state !== 'failed') return false;
    tx.set(ref, Object.assign(d || { month, createdAt: at, sends: [] }, { state: 'making', claimedAt: at, claimedBy: by }), { merge: true });
    return true;
  });
  if (!claimed) return { state: 'already', month };

  try {
    const report = await build(db, month);
    const { to } = recipients();
    if (!to) throw new Error('No forms inbox is set (PFA_SUBMISSIONS_INBOX).');
    const payload = payloadOf(report, attempt);
    const configured = sender.isConfigured();
    const queued = await store.queueEmail({ template: 'intern_applications_monthly', to, dedupeKey: `${month}:${attempt}`, claim: configured ? 'intern-applications-report' : undefined, payload });
    const log = { at, by, attempt, emailId: queued.emailId, to, state: 'queued' };
    await ref.set({ month, label: report.label, state: 'queued', madeAt: at, madeBy: by, count: report.count, started: report.started, emailId: queued.emailId, to }, { merge: true });
    await appendSend(db, ref, log);
    if (queued.created && configured) {
      try {
        const sent = await sender.deliver({ to, template: 'intern_applications_monthly', payload });
        await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: true, providerId: sent.providerId });
        await ref.set({ state: 'sent', sentAt: new Date().toISOString() }, { merge: true });
        await appendSend(db, ref, Object.assign({}, log, { state: 'sent', at: new Date().toISOString() }));
        return { state: 'sent', month, emailId: queued.emailId, count: report.count };
      } catch (error) {
        await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: false, error });
        await appendSend(db, ref, Object.assign({}, log, { state: 'retrying', at: new Date().toISOString(), error: clean(error && error.message, 200) }));
      }
    }
    return { state: 'queued', month, emailId: queued.emailId, count: report.count };
  } catch (error) {
    await ref.set({ state: 'failed', failedAt: new Date().toISOString(), error: clean(error && error.message, 300) }, { merge: true }).catch(() => {});
    await appendSend(db, ref, { at, by, attempt, state: 'failed', error: clean(error && error.message, 200) }).catch(() => {});
    return { state: 'failed', month, error: clean(error && error.message, 300) };
  }
}

/* The scheduler's step: the email worker calls it on every run. */
async function run({ db, nowMs = Date.now(), mail, queue } = {}) {
  if (!FIN.due(nowMs)) return { state: 'not-due' };
  return send({ db, month: FIN.previousMonth(nowMs), nowMs, by: 'schedule', mail, queue });
}

module.exports = { COLLECTION, build, csvOf, fileName, payloadOf, recipients, send, run };
