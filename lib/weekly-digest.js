'use strict';

/* The Monday digest (owner, 1 Nov 2026: "on each Monday, a list of people
   who have ordered shop items become members, applied for caregiver card,
   applied for volunteer, jobs etc should go to gandhim cc
   anushkapfacampus@gmail.com . and hyperlink to that application within the
   admin portal. admin should update the status of each application").

   Every Monday, India time (up to Wednesday if Monday went by without a
   run), the week before is gathered from the register: Monday 00:00 to
   Monday 00:00, IST. Each person is listed under what they did, with their
   reference, the day it came in and where it stands now, and the reference
   opens that very record in the panel (admin.html#case=REF), where its
   status is moved along as usual.

   No amounts: the digest is about people and their applications; money is
   reported to the payments inboxes and in the monthly report. Donations are
   not listed, as they are not applications.

   Once a week: the week is claimed in a transaction (weekly_digests/{week}),
   the email is queued with the week as its dedupe key, and every attempt is
   logged on the record and in the email queue. The panel can send a week
   again; that is a second email, logged as such. */

const crypto = require('crypto');
/* reading the register lives apart: no file that reads submissions writes
   anything (test/submissions.test.js) */
const { collect: readWeek } = require('./weekly-digest-read');
const collect = (db, week, helpers) => readWeek(db, week, helpers || { bounds, caseLink, groupOf });

const COLLECTION = 'weekly_digests';
const IST_MS = 330 * 60000;
const DAY = 86400000;
const CATCH_UP_DAYS = 2; // Tuesday and Wednesday, if Monday was missed
const ROWS_PER_GROUP = 250;
const DEFAULT_CC = 'anushkapfacampus@gmail.com';
const DEFAULT_PANEL = 'https://pfa-new-website.web.app/admin.html';

/* What is listed, in this order; anything else falls under "Other forms". */
const GROUPS = [
  { key: 'shop', label: 'Shop orders', kinds: ['PFA-SHP'] },
  { key: 'members', label: 'New members', kinds: ['PFA-MEM'] },
  { key: 'caregiver', label: 'Colony caregiver card applications', kinds: ['PFA-CG'] },
  { key: 'volunteer', label: 'Volunteer applications', kinds: ['PFA-V'] },
  { key: 'jobs', label: 'Job applications', kinds: ['PFA-J'] },
  { key: 'internship', label: 'Remote internship', kinds: ['PFA-VI', 'PFA-VP'] },
  { key: 'other', label: 'Other forms', kinds: [] }
];

const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 200);
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ist(ms) {
  const d = new Date(Number(ms) + IST_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate(), dow: d.getUTCDay(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}

/* The Monday (IST) that starts the week `nowMs` falls in, as UTC ms */
function mondayOf(nowMs) {
  const p = ist(nowMs);
  const midnight = Date.UTC(p.y, p.m - 1, p.day) - IST_MS;
  const back = (p.dow + 6) % 7; // Monday 0 ... Sunday 6
  return midnight - back * DAY;
}

function keyOf(ms) {
  const p = ist(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.day)}`;
}

/* "2026-11-02" (the Monday it is sent) -> the week before it */
function bounds(week) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(week || ''));
  if (!m) throw new Error('A week is the Monday it is sent, YYYY-MM-DD.');
  const to = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - IST_MS;
  if (ist(to).dow !== 1) throw new Error('A week is named by its Monday.');
  const from = to - 7 * DAY;
  const a = ist(from);
  const b = ist(to - DAY);
  return { from, to, label: `${a.day} ${MONTHS[a.m - 1]} to ${b.day} ${MONTHS[b.m - 1]} ${b.y}` };
}

/* The week due now, or '' if it is not Monday to Wednesday, IST */
function due(nowMs) {
  const back = (ist(nowMs).dow + 6) % 7;
  return back <= CATCH_UP_DAYS ? keyOf(mondayOf(nowMs)) : '';
}


function panelUrl() {
  const named = String(process.env.PFA_PANEL_URL || '').trim();
  try { if (named && /^https?:$/.test(new URL(named).protocol)) return named.replace(/[#?].*$/, ''); } catch (_) { /* default */ }
  return DEFAULT_PANEL;
}

function groupOf(kind) {
  return (GROUPS.find((g) => g.kinds.includes(kind)) || GROUPS[GROUPS.length - 1]).key;
}

function caseLink(reference) {
  return `${panelUrl()}#case=${encodeURIComponent(reference)}`;
}

async function build(db, week) {
  const rows = await collect(db, week, { bounds, caseLink, groupOf });
  const groups = GROUPS.map((g) => {
    const mine = rows.filter((r) => r.group === g.key);
    return { key: g.key, label: g.label, count: mine.length, waiting: mine.filter((r) => r.open).length, rows: mine.slice(0, ROWS_PER_GROUP), more: Math.max(0, mine.length - ROWS_PER_GROUP) };
  });
  return { week, label: bounds(week).label, count: rows.length, waiting: rows.filter((r) => r.open).length, groups };
}

function payloadOf(report, attempt) {
  return {
    week: report.week,
    label: report.label,
    count: report.count,
    waiting: report.waiting,
    panelUrl: panelUrl(),
    attempt: attempt || 'first',
    groups: report.groups.map((g) => ({
      key: g.key, label: g.label, count: g.count, waiting: g.waiting, more: g.more,
      rows: g.rows.map((r) => ({ reference: r.reference, kindLabel: r.kindLabel, name: r.name, place: r.place, date: r.date, status: r.status, link: r.link }))
    }))
  };
}

function ccList() {
  const named = String(process.env.PFA_DIGEST_CC || '').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  return named.length ? named : [DEFAULT_CC];
}

function recipients() {
  const FWD = require('./submission-forward');
  const to = String((FWD.formInboxes() || [])[0] || '').trim().toLowerCase();
  return { to, cc: ccList().filter((a) => a !== to) };
}

async function appendSend(db, ref, entry) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const sends = (snap.exists && Array.isArray((snap.data() || {}).sends)) ? snap.data().sends.slice(-29) : [];
    sends.push(entry);
    tx.set(ref, { sends }, { merge: true });
  });
}

/* Make and queue one week's digest, once (force: send it again). */
async function send({ db, week, nowMs = Date.now(), by = 'schedule', force = false, mail, queue } = {}) {
  const store = queue || require('./caregiver-store');
  const sender = mail || require('./caregiver-mail');
  bounds(week);
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
    const { to, cc } = recipients();
    if (!to) throw new Error('No forms inbox is set (PFA_SUBMISSIONS_INBOX).');
    const payload = Object.assign(payloadOf(report, attempt), { cc });
    const configured = sender.isConfigured();
    const queued = await store.queueEmail({ template: 'weekly_digest', to, dedupeKey: `${week}:${attempt}`, claim: configured ? 'weekly-digest' : undefined, payload });
    const log = { at, by, attempt, emailId: queued.emailId, to, cc, state: 'queued' };
    await ref.set({
      week, label: report.label, state: 'queued', madeAt: at, madeBy: by, count: report.count, waiting: report.waiting,
      groups: report.groups.map((g) => ({ key: g.key, label: g.label, count: g.count, waiting: g.waiting })),
      emailId: queued.emailId, to, cc
    }, { merge: true });
    await appendSend(db, ref, log);
    if (queued.created && configured) {
      try {
        const sent = await sender.deliver({ to, template: 'weekly_digest', payload });
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
  const week = due(nowMs);
  if (!week) return { state: 'not-due' };
  return send({ db, week, nowMs, by: 'schedule', mail, queue });
}

async function status(db, week) {
  const snap = await db.collection(COLLECTION).doc(week).get();
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
  return Object.assign({}, d, { email });
}

/* The Mondays of the last n weeks, newest first */
function lastWeeks(nowMs, n = 8) {
  const out = [];
  let m = mondayOf(nowMs);
  for (let i = 0; i < n; i += 1) { out.push(keyOf(m)); m -= 7 * DAY; }
  return out;
}

module.exports = {
  COLLECTION, GROUPS, DEFAULT_CC,
  bounds, due, mondayOf, keyOf, collect, build, payloadOf, recipients, ccList, caseLink, panelUrl, send, run, status, lastWeeks
};
