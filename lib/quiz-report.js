'use strict';

/* The internship quiz, every week, to gandhim (owner, 2 Nov 2026: "quiz
   result should go to gandhim. each week the result should go to
   gandhim").

   Each Monday, India time (or Tuesday or Wednesday if Monday's run was
   missed), every quiz attempt finished in the week before (Monday to
   Sunday) goes to the forms inbox (gandhim) in one email, once:
   quiz_reports/{Monday} is claimed in a transaction. The email has a line
   per attempt (the intern, the attempt, the marks by section, the time
   taken, pass or not), the week at a glance, and the five questions most
   often got wrong; a CSV of the same lines is attached. A week with no
   attempts still sends a short note, so a missing email always means
   something went wrong. The email worker calls run() on every run;
   PFA_QUIZ_REPORT=off stops it (the test suite sets it). */

const crypto = require('crypto');
const Q = require('./intern-quiz');
const W = require('./weekly-digest');

const COLLECTION = 'quiz_reports';
const ROWS = 300;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 200);

function when(ms) {
  const d = new Date(Number(ms) + 330 * 60000);
  const h = d.getUTCHours();
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${((h + 11) % 12) + 1}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

function minutes(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

async function build(db, week) {
  const { from, to, label } = W.bounds(week);
  const attempts = await Q.finishedBetween(db, from, to);
  const batches = new Map((await require('./intern-store').listBatches(db)).map((b) => [b.batchId, b.name]));
  const rows = attempts.map((a) => {
    const r = a.result || {};
    const L = r.byLevel || {};
    const part = (l) => `${(L[l] || {}).right || 0}/${(L[l] || {}).of || 0}`;
    return {
      name: clean(a.name, 80) || a.internId, internId: a.internId, batch: clean(batches.get(a.batchId) || a.batchId, 80), attempt: a.n,
      finished: when(a.finishedMs), percent: r.percent, points: r.points, max: r.max, pass: Boolean(r.pass),
      easy: part('easy'), medium: part('medium'), hard: part('hard'),
      answered: r.answered, time: minutes(r.seconds), timedOut: Boolean(r.timedOut)
    };
  });
  const interns = new Set(rows.map((r) => r.internId)).size;
  const passed = rows.filter((r) => r.pass).length;
  const average = rows.length ? Math.round((rows.reduce((n, r) => n + Number(r.percent || 0), 0) / rows.length) * 10) / 10 : 0;
  const hardest = Q.questionStats(attempts).filter((s) => s.seen > 0).sort((a, b) => a.rate - b.rate || a.qid.localeCompare(b.qid)).slice(0, 5)
    .map((s) => ({ qid: s.qid, level: s.level, text: clean(s.text, 220), rate: s.rate, seen: s.seen }));
  return { week, label, count: rows.length, interns, passed, average, rows, hardest };
}

function csvOf(rows) {
  const cell = (v) => {
    const s = String(v == null ? '' : v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // a spreadsheet must not run it as a formula
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ['Intern', 'Intern ID', 'Batch', 'Attempt', 'Finished (IST)', 'Percent', 'Marks', 'Out of', 'Result', 'Easy', 'Medium', 'Hard', 'Answered', 'Time taken', 'Ran out of time'];
  const lines = [head.map(cell).join(',')].concat((rows || []).map((r) => [r.name, r.internId, r.batch, r.attempt, r.finished, r.percent, r.points, r.max, r.pass ? 'Pass' : 'Not passed', r.easy, r.medium, r.hard, r.answered, r.time, r.timedOut ? 'Yes' : 'No'].map(cell).join(',')));
  return Buffer.from(`\ufeff${lines.join('\r\n')}\r\n`, 'utf8');
}

function fileName(week) { return `PFA-internship-quiz-week-of-${week}.csv`; }

function payloadOf(report, attempt) {
  return {
    week: report.week, label: report.label, count: report.count, interns: report.interns, passed: report.passed,
    average: report.average, passMark: Q.PASS, rows: report.rows.slice(0, ROWS), more: Math.max(0, report.rows.length - ROWS),
    hardest: report.hardest, csvName: fileName(report.week), attempt: attempt || 'first'
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

/* Make and queue one week's email, once (force: send it again). */
async function send({ db, week, nowMs = Date.now(), by = 'schedule', force = false, mail, queue } = {}) {
  const store = queue || require('./caregiver-store');
  const sender = mail || require('./caregiver-mail');
  W.bounds(week);
  const ref = db.collection(COLLECTION).doc(week);
  const at = new Date(nowMs).toISOString();
  const attempt = force ? `again-${crypto.randomBytes(3).toString('hex')}` : 'first';

  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() || {} : null;
    if (d && !force && d.state !== 'failed') return false;
    tx.set(ref, Object.assign(d || { week, createdAt: at, sends: [] }, { state: 'making', claimedAt: at, claimedBy: by }), { merge: true });
    return true;
  });
  if (!claimed) return { state: 'already', week };

  try {
    const report = await build(db, week);
    const { to } = recipients();
    if (!to) throw new Error('No forms inbox is set (PFA_SUBMISSIONS_INBOX).');
    const payload = payloadOf(report, attempt);
    const configured = sender.isConfigured();
    const queued = await store.queueEmail({ template: 'quiz_weekly', to, dedupeKey: `${week}:${attempt}`, claim: configured ? 'quiz-report' : undefined, payload });
    const log = { at, by, attempt, emailId: queued.emailId, to, state: 'queued' };
    await ref.set({ week, label: report.label, state: 'queued', madeAt: at, madeBy: by, count: report.count, passed: report.passed, emailId: queued.emailId, to }, { merge: true });
    await appendSend(db, ref, log);
    if (queued.created && configured) {
      try {
        const sent = await sender.deliver({ to, template: 'quiz_weekly', payload });
        await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: true, providerId: sent.providerId });
        await ref.set({ state: 'sent', sentAt: new Date().toISOString() }, { merge: true });
        await appendSend(db, ref, Object.assign({}, log, { state: 'sent', at: new Date().toISOString() }));
        return { state: 'sent', week, emailId: queued.emailId, count: report.count };
      } catch (error) {
        await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: false, error });
        await appendSend(db, ref, Object.assign({}, log, { state: 'retrying', at: new Date().toISOString(), error: clean(error && error.message, 200) }));
      }
    }
    return { state: 'queued', week, emailId: queued.emailId, count: report.count };
  } catch (error) {
    await ref.set({ state: 'failed', failedAt: new Date().toISOString(), error: clean(error && error.message, 300) }, { merge: true }).catch(() => {});
    await appendSend(db, ref, { at, by, attempt, state: 'failed', error: clean(error && error.message, 200) }).catch(() => {});
    return { state: 'failed', week, error: clean(error && error.message, 300) };
  }
}

/* The scheduler's step: the email worker calls it on every run. */
async function run({ db, nowMs = Date.now(), mail, queue } = {}) {
  const week = W.due(nowMs);
  if (!week) return { state: 'not-due' };
  return send({ db, week, nowMs, by: 'schedule', mail, queue });
}

module.exports = { COLLECTION, build, csvOf, fileName, payloadOf, recipients, send, run };
