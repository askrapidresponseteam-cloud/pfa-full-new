'use strict';

/* End-of-week reminders for interns (owner, 1 Nov 2026: "reminders at the
   end of each week through backend scheduling ... duplicate prevention and
   delivery logs").

   On the last day of each week of a batch (Sunday, India time), every
   active intern who still has something open is emailed once: the tasks due
   by tonight that are not yet sent, any sent back for a revision, the RRT
   count against its target, and the electives if none are chosen by week 5.
   An intern with nothing open is not emailed. Each email is keyed by batch,
   week and intern, so the worker running every ten minutes sends it once;
   the week's run is logged in intern_reminders/{batch}__w{n} with who was
   emailed, who was not and why. The email worker calls this on every run,
   with the referral refresh and the file sweep. */

const I = require('./internship');
const S = require('./intern-store');

function outstanding(batch, intern, works, week) {
  const byTask = new Map((works || []).map((w) => [w.taskKey, w]));
  const chosen = intern.electives || [];
  const items = [];
  for (const t of batch.tasks || []) {
    if (t.kind === 'elective' && !chosen.includes(t.key)) continue;
    if (I.dueWeekOf(t) > week) continue;
    const w = byTask.get(t.key);
    const state = w ? w.state : 'todo';
    if (state === 'accepted' || state === 'submitted') continue;
    let line = t.goal ? `${t.title} (${t.goal})` : t.title;
    if (t.auto === 'rrt') {
      const n = Number((intern.referral || {}).registrations) || 0;
      if (n >= (Number(t.target) || 0) && state !== 'revise') continue;
      line = `${t.title}: ${n} of ${t.target} have registered`;
    }
    items.push({ key: t.key, line, state: state === 'revise' ? 'Sent back for a revision' : (I.dueWeekOf(t) < week ? 'Overdue' : 'Due tonight') });
  }
  const need = Number(batch.electivesRequired) || 0;
  if (need && week >= 5 && chosen.length < need) items.unshift({ key: 'electives', line: `Choose your ${need} electives`, state: week >= 6 ? 'Overdue' : 'Before week 6' });
  return items;
}

async function runBatch(db, batch, nowMs, deps) {
  const week = I.currentWeek(batch, nowMs);
  const weeks = (batch.weeks || []).length;
  if (week < 1 || week > weeks) return null;
  if (I.istDay(nowMs).dow !== 0) return null; // Sunday, IST: the week's last day
  const logRef = db.collection('intern_reminders').doc(`${batch.batchId}__w${week}`);
  const log = await logRef.get();
  if (log.exists && (log.data() || {}).state === 'done') return { batchId: batch.batchId, week, state: 'already' };
  const interns = (await S.listInterns(db, batch.batchId)).filter((i) => i.status === 'active' && i.email);
  const done = [];
  const wk = (batch.weeks || [])[week - 1] || { title: `Week ${week}` };
  const next = (batch.weeks || [])[week] || null;
  for (const intern of interns) {
    const items = outstanding(batch, intern, await S.listWorks(db, intern.internId), week);
    if (!items.length) { done.push({ internId: intern.internId, state: 'nothing-open' }); continue; }
    const r = await S.mailNow({
      template: 'intern_reminder', to: intern.email, dedupeKey: `${batch.batchId}:w${week}:${intern.internId}`,
      payload: {
        name: intern.name, week, weekTitle: wk.title, weeks,
        due: `${I.dayLabel(I.weekBounds(batch, week).due)}, 11:59 pm`,
        items: items.map((x) => ({ line: x.line, state: x.state })),
        next: next ? `Week ${next.n}: ${next.title}` : '',
        link: S.dashboardUrl(), siteUrl: S.publicSite()
      },
      mail: deps.mail, queue: deps.queue
    });
    done.push({ internId: intern.internId, state: r.sent ? 'sent' : r.queued ? 'queued' : 'failed', emailId: r.emailId || '', error: r.error || '' });
  }
  const summary = {
    batchId: batch.batchId, week, at: new Date(nowMs).toISOString(), state: 'done',
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

async function logs(db, batchId) {
  const snap = await db.collection('intern_reminders').where('batchId', '==', batchId).get();
  return (snap.docs || []).map((d) => d.data() || {}).sort((a, b) => b.week - a.week);
}

module.exports = { run, runBatch, outstanding, logs };
