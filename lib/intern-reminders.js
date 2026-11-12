'use strict';

/* End-of-week reminders for interns (owner, 1 Nov 2026: "reminders at the
   end of each week through backend scheduling ... duplicate prevention and
   delivery logs").

   On the last day of each intern's week (Sunday, India time, or the day an
   extension moved it to: lib/internship.js timeline), every active intern
   who still has something open is emailed once: the tasks due
   by tonight that are not yet sent, any sent back for a revision, the RRT
   count against its target, and the electives if none are chosen by week 5.
   An intern with nothing open is not emailed. Each email is keyed by batch,
   week and intern, so the worker running every ten minutes sends it once;
   each day's run is logged in intern_reminders/{batch}__{day} with who was
   emailed, who was not and why. The email worker calls this on every run,
   with the referral refresh and the file sweep. */

const I = require('./internship');
const S = require('./intern-store');

/* What is open for an intern at the end of their week `week`: every task
   due by then (its own due date, with any extension or moved date applied,
   lib/internship.js timeline) that is not sent or accepted, and anything sent
   back. Each with its state and due day as the intern's calendar has it. */
function outstanding(batch, intern, works, week, nowMs) {
  const tl = I.timeline(batch, intern);
  const at = Number.isFinite(nowMs) ? nowMs : tl.weekDue(Math.max(1, Math.min(week, tl.weeks)));
  const until = tl.weekDue(Math.max(1, Math.min(week, tl.weeks)));
  const today = I.ymdOf(at);
  const byTask = new Map((works || []).map((w) => [w.taskKey, w]));
  const chosen = intern.electives || [];
  const items = [];
  for (const t of batch.tasks || []) {
    if (t.kind === 'elective' && !chosen.includes(t.key)) continue;
    const due = tl.taskDue(t);
    const w = byTask.get(t.key);
    const state = w ? w.state : 'todo';
    if (state === 'accepted' || state === 'submitted') continue;
    if (due > until && state !== 'revise') continue;
    let line = t.goal ? `${t.title} (${t.goal})` : t.title;
    if (t.auto === 'rrt') {
      const n = Number((intern.referral || {}).registrations) || 0;
      if (n >= (Number(t.target) || 0) && state !== 'revise') continue;
      line = `${t.title}: ${n} of ${t.target} have registered`;
    }
    const when = state === 'revise' ? 'Sent back for a revision' : due < at ? 'Overdue' : I.ymdOf(due) === today ? 'Due tonight' : `Due ${I.dayLabel(due)}`;
    items.push({ key: t.key, line, state: when, due: `${I.dayLabel(due)}, 11:59 pm`, dueMs: due });
  }
  const need = Number(batch.electivesRequired) || 0;
  if (need && week >= 5 && chosen.length < need) items.unshift({ key: 'electives', line: `Choose your ${need} electives`, state: week >= 6 ? 'Overdue' : 'Before week 6', due: '' });
  return items;
}

/* The end-of-week reminder, on the last day of each intern's own week: the
   Sunday, or the day an extension moved it to. Logged once a day per batch. */
async function runBatch(db, batch, nowMs, deps) {
  const weeks = (batch.weeks || []).length;
  const today = I.ymdOf(nowMs);
  const logRef = db.collection('intern_reminders').doc(`${batch.batchId}__${today}`);
  const interns = (await S.listInterns(db, batch.batchId)).filter((i) => i.status === 'active' && i.email);
  const due = interns.map((intern) => {
    const tl = I.timeline(batch, intern);
    const week = tl.current(nowMs);
    return { intern, tl, week, ends: week >= 1 && week <= weeks && I.ymdOf(tl.weekDue(week)) === today };
  }).filter((x) => x.ends);
  if (!due.length) return null;
  const log = await logRef.get();
  const batchWeek = I.timeline(batch).current(nowMs);
  if (log.exists && (log.data() || {}).state === 'done') return { batchId: batch.batchId, week: batchWeek, state: 'already' };
  const done = [];
  for (const { intern, tl, week } of due) {
    const items = outstanding(batch, intern, await S.listWorks(db, intern.internId), week, nowMs);
    if (!items.length) { done.push({ internId: intern.internId, week, state: 'nothing-open' }); continue; }
    const wk = (batch.weeks || [])[week - 1] || { title: `Week ${week}` };
    const next = (batch.weeks || [])[week] || null;
    const r = await S.mailNow({
      template: 'intern_reminder', to: intern.email, dedupeKey: `${batch.batchId}:w${week}:${intern.internId}:${today}`,
      payload: {
        name: intern.name, week, weekTitle: wk.title, weeks,
        due: `${I.dayLabel(tl.weekDue(week))}, 11:59 pm`,
        items: items.map((x) => ({ line: x.line, state: x.state })),
        next: next ? `Week ${next.n}: ${next.title}` : '',
        link: S.dashboardUrl(), siteUrl: S.publicSite()
      },
      mail: deps.mail, queue: deps.queue
    });
    done.push({ internId: intern.internId, week, state: r.sent ? 'sent' : r.queued ? 'queued' : 'failed', emailId: r.emailId || '', error: r.error || '' });
  }
  const summary = {
    batchId: batch.batchId, week: batchWeek, day: today, at: new Date(nowMs).toISOString(), state: 'done', kind: 'weekly',
    sent: done.filter((d) => d.state === 'sent').length, queued: done.filter((d) => d.state === 'queued').length,
    failed: done.filter((d) => d.state === 'failed').length, nothingOpen: done.filter((d) => d.state === 'nothing-open').length,
    interns: done.slice(0, 500)
  };
  await logRef.set(summary, { merge: true });
  return summary;
}

async function run({ db, nowMs = Date.now(), mail, queue, fetchImpl } = {}) {
  const out = { reminders: [], referrals: null, swept: 0 };
  const batches = (await S.listBatches(db)).filter((b) => b.status !== 'closed');
  for (const b of batches) {
    try {
      const r = await runBatch(db, b, nowMs, { mail, queue });
      if (r) out.reminders.push({ batchId: r.batchId, week: r.week, state: r.state, sent: r.sent, queued: r.queued, failed: r.failed });
    } catch (error) {
      console.error('intern reminders failed for a batch', b.batchId, error && error.message);
    }
  }
  try { out.referrals = await require('./rrt-referrals').refresh(db, { nowMs, fetchImpl }); } catch (error) { out.referrals = { state: 'failed', error: String(error && error.message) }; }
  try { out.swept = await S.sweep(db, nowMs); } catch (_) { out.swept = 0; }
  return out;
}

/* every reminder of a batch, the weekly ones and those sent by hand, newest first */
async function logs(db, batchId) {
  const snap = await db.collection('intern_reminders').where('batchId', '==', batchId).get();
  return (snap.docs || []).map((d) => d.data() || {}).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')) || b.week - a.week);
}

module.exports = { run, runBatch, outstanding, logs };
