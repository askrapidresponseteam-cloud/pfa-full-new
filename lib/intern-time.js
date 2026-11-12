'use strict';

/* More time, and reminders sent by hand, for the remote internship (owner,
   12 Nov 2026, of the panel's Internship section: "there should be option
   to send reminder. we need option to extend timeline", then, of who and
   what: all three reminders, and "need all kinds of features. enterprise
   grade").

   EXTENSIONS (lib/internship.js timeline works out every date from them)
     extendBatch   the whole batch, from a week on, by some days
     extendIntern  one intern, from a week on, by some days, on top of the batch
     moveTask      one task for one intern, to a day of PFA's choosing
     undo          takes one of these back; it stays in the list, marked
   Each needs a reason (kept, never shown to the intern), may carry a line
   to the intern, and may email them the new dates (intern_extended). Each
   is in the intern's or the batch's own list with who and when, and in the
   audit log (the route records it). Days are 1 to 56 at a time, a moved
   task's day no later than 120 days from now.

   REMINDERS (intern_nudge; the Sunday ones are lib/intern-reminders.js)
     remindOne     one intern: what is open now, with an optional line
     remindBehind  every active intern of a batch with something open
     askMissing    every application still missing a sign-in detail
   Each is shown before it goes (preview: true returns exactly what would be
   sent and a token made from it; the send must carry that token, so nothing
   goes that was not seen). A reminder by hand to the same intern within
   REMIND_GAP_HOURS is held back and says when the last went, unless PFA
   presses Send anyway (force). Each send is kept on the intern
   (intern.nudges) and in the batch's reminder log. */

const crypto = require('crypto');
const I = require('./internship');
const S = require('./intern-store');

const MAX_DAYS = I.EXT_MAX_DAYS;
const REMIND_GAP_HOURS = 12;
const NOTE_CHARS = 400;
const REASON_CHARS = 300;

function fail(code, message, status) { return S.fail(code, message, status); }
const iso = (ms) => new Date(ms).toISOString();
const byOf = (who) => (typeof who === 'string' ? who : who && (who.email || who.name)) || 'PFA';
function newId() { return crypto.randomBytes(6).toString('hex'); }
function tokenOf(x) { return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 32); }

function reasonOf(v) {
  const r = I.clean(v, REASON_CHARS);
  if (r.length < 4) throw fail('NO_REASON', 'Say why, in a few words. It is kept with the change, not shown to the intern.');
  return r;
}
function daysOf(v) {
  const n = Math.round(Number(v));
  if (!(n >= 1 && n <= MAX_DAYS)) throw fail('BAD_DAYS', `Give between 1 and ${MAX_DAYS} days at a time.`);
  return n;
}
function weekOf(v, batch) {
  const weeks = (batch.weeks || []).length;
  const n = Math.round(Number(v));
  if (!(n >= 1 && n <= weeks)) throw fail('BAD_WEEK', `Choose a week from 1 to ${weeks}.`);
  return n;
}
function noteOf(v) { return I.cleanBlock ? I.cleanBlock(v, NOTE_CHARS) : I.clean(v, NOTE_CHARS); }

async function batchOf(db, batchId) {
  const b = await S.getBatch(db, String(batchId || ''));
  if (!b) throw fail('NO_BATCH', 'That batch is not on record.', 404);
  return b;
}
async function internOf(db, internId) {
  const i = await S.getIntern(db, String(internId || '').toUpperCase());
  if (!i || i.status === 'reserving') throw fail('NO_INTERN', 'That intern is not on record.', 404);
  return i;
}

/* the dates that move, in words, for the email and the panel */
function movedRows(batch, before, after, fromWeek) {
  const rows = [];
  const weeks = (batch.weeks || []).length;
  for (let n = fromWeek; n <= weeks; n += 1) {
    const a = before.weekDue(n);
    const b = after.weekDue(n);
    if (a !== b) rows.push({ label: `Week ${n}`, value: `due ${I.dayLabel(b)}, 11:59 pm (was ${I.dayLabel(a)})` });
  }
  rows.push({ label: 'Your internship ends', value: I.dayLabel(after.endMs()) });
  return rows;
}

async function tell(db, intern, what, rows, note, key, deps) {
  if (!intern.email || intern.status === 'revoked') return { state: 'not-sent' };
  const r = await S.mailNow({
    template: 'intern_extended', to: intern.email, dedupeKey: key,
    payload: { name: intern.name, what, rows, note, link: S.dashboardUrl(), siteUrl: S.publicSite() },
    mail: deps.mail, queue: deps.queue
  });
  return { state: r.sent ? 'sent' : r.queued ? 'queued' : 'not-sent', emailId: r.emailId || '' };
}

/* the email a change sends, word for word, for the panel's preview */
function letterOf(intern, what, rows, note) {
  const r = require('./caregiver-mail').render('intern_extended', { name: (intern && intern.name) || 'Intern', what, rows, note, link: S.dashboardUrl(), siteUrl: S.publicSite() });
  return { to: (intern && intern.email) || '', subject: r.subject, html: r.html };
}

/* ---- extensions --------------------------------------------------------- */

async function extendBatch(db, input, who, nowMs = Date.now(), deps = {}) {
  const batch = await batchOf(db, input.batchId);
  const days = daysOf(input.days);
  const fromWeek = weekOf(input.fromWeek, batch);
  const reason = input.preview ? I.clean(input.reason, REASON_CHARS) : reasonOf(input.reason);
  const note = noteOf(input.note);
  const ext = { id: newId(), fromWeek, days, reason, note, by: byOf(who), at: iso(nowMs) };
  const after = Object.assign({}, batch, { extensions: (batch.extensions || []).concat([ext]) });
  if (input.preview) {
    const before = I.timeline(batch);
    const rows = movedRows(batch, before, I.timeline(after), fromWeek);
    const active = (await S.listInterns(db, batch.batchId)).filter((i) => i.status === 'active');
    const first = active[0] || null;
    const sample = first ? movedRows(batch, I.timeline(batch, first), I.timeline(after, first), fromWeek) : rows;
    return { preview: true, rows, endsOn: I.ymdOf(I.timeline(after).endMs()), interns: active.length,
      email: letterOf(first, `PFA has given your batch ${days} more day${days === 1 ? '' : 's'}, from week ${fromWeek}.`, sample, note) };
  }
  await db.collection('intern_batches').doc(batch.batchId).set({ extensions: after.extensions }, { merge: true });
  const told = [];
  if (input.notify) {
    for (const intern of (await S.listInterns(db, batch.batchId)).filter((i) => i.status === 'active')) {
      const rows = movedRows(batch, I.timeline(batch, intern), I.timeline(after, intern), fromWeek);
      const r = await tell(db, intern, `PFA has given your batch ${days} more day${days === 1 ? '' : 's'}, from week ${fromWeek}.`, rows, note, `ext:${batch.batchId}:${ext.id}:${intern.internId}`, deps);
      told.push({ internId: intern.internId, state: r.state });
    }
  }
  return { extension: I.extensionView(ext), endsOn: I.ymdOf(I.timeline(after).endMs()), told };
}

async function extendIntern(db, input, who, nowMs = Date.now(), deps = {}) {
  const intern = await internOf(db, input.internId);
  if (intern.status === 'revoked') throw fail('REVOKED', 'This intern’s access was withdrawn.', 409);
  const batch = await batchOf(db, intern.batchId);
  const days = daysOf(input.days);
  const fromWeek = weekOf(input.fromWeek, batch);
  const reason = input.preview ? I.clean(input.reason, REASON_CHARS) : reasonOf(input.reason);
  const note = noteOf(input.note);
  const ext = { id: newId(), fromWeek, days, reason, note, by: byOf(who), at: iso(nowMs) };
  const after = Object.assign({}, intern, { extensions: (intern.extensions || []).concat([ext]) });
  const rows = movedRows(batch, I.timeline(batch, intern), I.timeline(batch, after), fromWeek);
  if (input.preview) return { preview: true, rows, endsOn: I.ymdOf(I.timeline(batch, after).endMs()), email: letterOf(intern, `PFA has given you ${days} more day${days === 1 ? '' : 's'}, from week ${fromWeek}.`, rows, note) };
  await db.collection('interns').doc(intern.internId).set({ extensions: after.extensions }, { merge: true });
  const told = input.notify ? await tell(db, intern, `PFA has given you ${days} more day${days === 1 ? '' : 's'}, from week ${fromWeek}.`, rows, note, `ext:${intern.internId}:${ext.id}`, deps) : { state: 'not-asked' };
  return { extension: I.extensionView(ext), endsOn: I.ymdOf(I.timeline(batch, after).endMs()), told };
}

async function moveTask(db, input, who, nowMs = Date.now(), deps = {}) {
  const intern = await internOf(db, input.internId);
  if (intern.status === 'revoked') throw fail('REVOKED', 'This intern’s access was withdrawn.', 409);
  const batch = await batchOf(db, intern.batchId);
  const task = (batch.tasks || []).find((t) => t.key === String(input.taskKey || ''));
  if (!task) throw fail('NO_TASK', 'Choose the task.');
  const until = String(input.until || '');
  const at = I.dayStart(until);
  if (!Number.isFinite(at) || I.ymdOf(at) !== until) throw fail('BAD_DATE', 'Choose the new due date.');
  if (at + I.DAY < nowMs) throw fail('BAD_DATE', 'Choose a day from today on.');
  if (at > nowMs + 120 * I.DAY) throw fail('BAD_DATE', 'Choose a day within the next 120 days.');
  const reason = input.preview ? I.clean(input.reason, REASON_CHARS) : reasonOf(input.reason);
  const note = noteOf(input.note);
  const was = I.timeline(batch, intern).taskDue(task);
  const entry = { until, reason, note, by: byOf(who), at: iso(nowMs), was: I.ymdOf(was) };
  const now = I.timeline(batch, Object.assign({}, intern, { taskDue: Object.assign({}, intern.taskDue, { [task.key]: entry }) })).taskDue(task);
  const rows = [{ label: task.title, value: `due ${I.dayLabel(now)}, 11:59 pm (was ${I.dayLabel(was)})` }];
  if (input.preview) return { preview: true, rows, email: letterOf(intern, `PFA has moved the due date of one task: ${task.title}.`, rows, note) };
  const history = (intern.taskDueLog || []).slice(-40).concat([Object.assign({ taskKey: task.key, kind: 'moved' }, entry)]);
  await db.collection('interns').doc(intern.internId).set({ taskDue: { [task.key]: entry }, taskDueLog: history }, { merge: true });
  const told = input.notify ? await tell(db, intern, `PFA has moved the due date of one task: ${task.title}.`, rows, note, `move:${intern.internId}:${task.key}:${until}:${nowMs}`, deps) : { state: 'not-asked' };
  return { task: task.key, until, was: I.ymdOf(was), told };
}

/* Take an extension back, or a moved date: it counts for nothing from now,
   and stays in the list marked, with who, when and why. */
async function undo(db, input, who, nowMs = Date.now()) {
  const why = reasonOf(input.reason);
  const stamp = { undone: true, undoneAt: iso(nowMs), undoneBy: byOf(who), undoneWhy: why };
  if (input.scope === 'batch') {
    const batch = await batchOf(db, input.batchId);
    const list = (batch.extensions || []).slice();
    const k = list.findIndex((e) => e.id === input.id && !e.undone);
    if (k < 0) throw fail('NO_EXTENSION', 'That extension is not in force.', 404);
    list[k] = Object.assign({}, list[k], stamp);
    await db.collection('intern_batches').doc(batch.batchId).set({ extensions: list }, { merge: true });
    return { scope: 'batch', subject: batch.batchId, what: `${list[k].days} days from week ${list[k].fromWeek}` };
  }
  const intern = await internOf(db, input.internId);
  if (input.scope === 'intern') {
    const list = (intern.extensions || []).slice();
    const k = list.findIndex((e) => e.id === input.id && !e.undone);
    if (k < 0) throw fail('NO_EXTENSION', 'That extension is not in force.', 404);
    list[k] = Object.assign({}, list[k], stamp);
    await db.collection('interns').doc(intern.internId).set({ extensions: list }, { merge: true });
    return { scope: 'intern', subject: intern.internId, what: `${list[k].days} days from week ${list[k].fromWeek}` };
  }
  if (input.scope === 'task') {
    const cur = intern.taskDue && intern.taskDue[input.taskKey];
    if (!cur || cur.undone) throw fail('NO_EXTENSION', 'That task has no moved date in force.', 404);
    const history = (intern.taskDueLog || []).slice(-40).concat([Object.assign({ taskKey: input.taskKey, kind: 'back' }, { until: cur.until }, stamp)]);
    await db.collection('interns').doc(intern.internId).set({ taskDue: { [input.taskKey]: Object.assign({}, cur, stamp) }, taskDueLog: history }, { merge: true });
    return { scope: 'task', subject: `${intern.internId} ${input.taskKey}`, what: `due ${cur.until}` };
  }
  throw fail('BAD_SCOPE', 'Say what to take back.');
}

/* ---- reminders by hand -------------------------------------------------- */

async function openFor(db, batch, intern, nowMs) {
  const tl = I.timeline(batch, intern);
  const week = tl.current(nowMs);
  if (week < 1) return { week, items: [] };
  const works = await S.listWorks(db, intern.internId);
  return { week: Math.min(week, tl.weeks), items: require('./intern-reminders').outstanding(batch, intern, works, Math.min(week, tl.weeks), nowMs) };
}
function lastNudge(intern) { const l = intern.nudges || []; return l.length ? l[l.length - 1] : null; }
function heldBack(intern, nowMs) {
  const last = lastNudge(intern);
  return last && nowMs - Date.parse(last.at) < REMIND_GAP_HOURS * 3600000 ? last : null;
}

function letterFor(intern, batch, open, note) {
  const payload = {
    name: intern.name, week: open.week, weeks: (batch.weeks || []).length, note,
    items: open.items.map((x) => ({ line: x.line, state: x.state, due: x.due })), link: S.dashboardUrl(), siteUrl: S.publicSite()
  };
  const r = require('./caregiver-mail').render('intern_nudge', payload);
  return { payload, subject: r.subject, html: r.html, text: r.text };
}

async function logNudge(db, batch, nowMs, entries, who) {
  const id = `${batch.batchId}__hand_${nowMs}_${newId()}`;
  await db.collection('intern_reminders').doc(id).set({
    batchId: batch.batchId, week: I.timeline(batch).current(nowMs), day: I.ymdOf(nowMs), at: iso(nowMs), state: 'done', kind: 'hand', by: byOf(who),
    sent: entries.filter((e) => e.state === 'sent').length, queued: entries.filter((e) => e.state === 'queued').length,
    failed: entries.filter((e) => e.state === 'failed').length, nothingOpen: 0, interns: entries.slice(0, 500)
  });
}

async function send(db, intern, batch, letter, nowMs, who, deps) {
  const r = await S.mailNow({ template: 'intern_nudge', to: intern.email, dedupeKey: `nudge:${intern.internId}:${nowMs}`, payload: letter.payload, mail: deps.mail, queue: deps.queue });
  const state = r.sent ? 'sent' : r.queued ? 'queued' : 'failed';
  const entry = { at: iso(nowMs), by: byOf(who), items: letter.payload.items.length, state };
  await db.collection('interns').doc(intern.internId).set({ nudges: (intern.nudges || []).slice(-30).concat([entry]) }, { merge: true });
  return { internId: intern.internId, state, emailId: r.emailId || '' };
}

async function remindOne(db, input, who, nowMs = Date.now(), deps = {}) {
  const intern = await internOf(db, input.internId);
  if (intern.status !== 'active') throw fail('NOT_ACTIVE', intern.status === 'revoked' ? 'This intern’s access was withdrawn.' : 'This intern has not signed in yet. Send them their sign-in details first.', 409);
  if (!intern.email) throw fail('NO_EMAIL', 'There is no email address for this intern.', 409);
  const batch = await batchOf(db, intern.batchId);
  const open = await openFor(db, batch, intern, nowMs);
  if (!open.items.length) throw fail('NOTHING_OPEN', open.week < 1 ? 'Their internship has not started yet.' : 'Nothing is open for this intern right now.', 409);
  const note = noteOf(input.note);
  const letter = letterFor(intern, batch, open, note);
  const token = tokenOf([intern.internId, intern.email, letter.subject, letter.text]);
  const held = heldBack(intern, nowMs);
  if (input.preview) return { preview: true, to: intern.email, subject: letter.subject, html: letter.html, items: open.items.length, token, last: lastNudge(intern), held: Boolean(held) };
  if (input.token !== token) throw fail('PREVIEW_STALE', 'Something changed since the preview. Look at it again, then send.', 409);
  if (held && !input.force) throw fail('TOO_SOON', `Reminded ${Math.max(1, Math.round((nowMs - Date.parse(held.at)) / 3600000))} hours ago by ${held.by}. Send anyway if it is needed.`, 409);
  const r = await send(db, intern, batch, letter, nowMs, who, deps);
  await logNudge(db, batch, nowMs, [r], who);
  return r;
}

async function remindBehind(db, input, who, nowMs = Date.now(), deps = {}) {
  const batch = await batchOf(db, input.batchId);
  const note = noteOf(input.note);
  const plan = [];
  for (const intern of await S.listInterns(db, batch.batchId)) {
    if (intern.status !== 'active' || !intern.email) continue;
    const open = await openFor(db, batch, intern, nowMs);
    if (!open.items.length) continue;
    const held = heldBack(intern, nowMs);
    plan.push({ intern, open, held, letter: letterFor(intern, batch, open, note) });
  }
  const list = plan.map((p) => ({ internId: p.intern.internId, name: p.intern.name, email: p.intern.email, items: p.open.items.length, lines: p.open.items.map((x) => `${x.line} (${x.state})`).slice(0, 8), skip: p.held ? `reminded ${I.dayLabel(Date.parse(p.held.at))} by ${p.held.by}` : '' }));
  const token = tokenOf(plan.map((p) => [p.intern.internId, p.letter.text, Boolean(p.held)]));
  if (input.preview) return { preview: true, interns: list, sample: plan[0] ? { subject: plan[0].letter.subject, html: plan[0].letter.html } : null, token };
  if (!plan.length) throw fail('NOTHING_OPEN', 'No active intern in this batch has anything open.', 409);
  if (input.token !== token) throw fail('PREVIEW_STALE', 'Something changed since the preview. Look at it again, then send.', 409);
  const out = [];
  for (const p of plan) {
    if (p.held && !input.force) { out.push({ internId: p.intern.internId, state: 'held' }); continue; }
    out.push(await send(db, p.intern, batch, p.letter, nowMs, who, deps));
  }
  await logNudge(db, batch, nowMs, out.filter((x) => x.state !== 'held'), who);
  return { sent: out.filter((x) => x.state === 'sent').length, queued: out.filter((x) => x.state === 'queued').length, failed: out.filter((x) => x.state === 'failed').length, held: out.filter((x) => x.state === 'held').length, interns: out };
}

/* Every application still missing a sign-in detail, asked again, one email
   each (lib/intern-applications.js askFor, once a day at most for each). */
async function askMissing(db, input, who, nowMs = Date.now(), deps = {}) {
  const APPS = require('./intern-applications');
  const waiting = (await APPS.waiting(db, nowMs)).filter((a) => a.missing && a.missing.length);
  const today = I.ymdOf(nowMs);
  const list = waiting.map((a) => ({ reference: a.reference, name: a.name, email: a.email, missing: a.missing, askedAt: a.askedAt || '', asks: a.asks || 0,
    skip: !I.emailOf(a.email) ? 'no email address to write to' : a.askedAt && I.ymdOf(Date.parse(a.askedAt)) === today ? 'already asked today' : '' }));
  const token = tokenOf(list.map((a) => [a.reference, a.missing, a.skip]));
  if (input.preview) return { preview: true, applications: list, token };
  if (input.token !== token) throw fail('PREVIEW_STALE', 'Something changed since the preview. Look at it again, then send.', 409);
  const out = [];
  for (const a of list) {
    if (a.skip) { out.push({ reference: a.reference, state: 'skipped', why: a.skip }); continue; }
    try {
      const r = await APPS.askFor(db, a.reference, byOf(who), nowMs, deps);
      out.push({ reference: a.reference, state: r.mailed, missing: r.missing });
    } catch (error) {
      out.push({ reference: a.reference, state: 'failed', why: error && error.message });
    }
  }
  return { asked: out.filter((x) => x.state === 'sent' || x.state === 'queued').length, skipped: out.filter((x) => x.state === 'skipped').length, failed: out.filter((x) => x.state === 'failed').length, applications: out };
}

module.exports = { extendBatch, extendIntern, moveTask, undo, remindOne, remindBehind, askMissing, REMIND_GAP_HOURS, MAX_DAYS };
