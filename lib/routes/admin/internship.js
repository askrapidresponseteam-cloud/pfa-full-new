'use strict';

/* The internship portal in the panel (lib/internship.js), module 'internship'.

   GET  /api/admin/internship                      batches, usage, the RRT link's state
   GET  /api/admin/internship?batch=ID             a batch: its plan, interns, progress, reminder log
   GET  /api/admin/internship?intern=ID            one intern: every task's work and history
   GET  /api/admin/internship?queue=review         work waiting for review, oldest first
   GET  /api/admin/internship?applications=1       internship applications without an Intern ID, one per person
   GET  /api/admin/internship?application=REF      one application: sign-in details, what is missing, later sendings
   GET  /api/admin/internship?file=ID              one uploaded file
   POST { action: 'batch-save', batchId?, name, startDate, status, plan? }
   POST { action: 'issue', batchId?, name, email, mobile, dob, applicationRef? }
        or { action: 'issue', applicationRef }: the details come from the application
        (lib/intern-applications.js), never typed by PFA; with no batch it joins
        the open one, or a new one (lib/intern-store.js)
   POST { action: 'ask-details', applicationRef }  email them for what sign-in needs
                                                  Approve: the intern is made and emailed that
                                                  the internship has started; the application
                                                  is marked Accepted (5 Nov 2026)
   POST { action: 'details', internId, email, mobile, dob }   the sign-in details, corrected
   POST { action: 'revoke', internId, reason }
   POST { action: 'regenerate', internId, verifiedHow }
   POST { action: 'review', internId, taskKey, decision: 'accept'|'revise', score, feedback }
   POST { action: 'referrals' }                    read the RRT counts now
   GET  /api/admin/internship?interns=all[&format=csv]   every intern, every batch (lib/intern-admin-view.js)
   GET  /api/admin/internship?profile=ID           one intern: contact, application, every task, quiz, shelter, certificate
   GET  /api/admin/internship?shelters=1[&format=csv]  the shelter directory (lib/intern-shelters.js)
   GET  /api/admin/internship?shelter=ID           one shelter: every intern's report, who worked there, photographs
   POST { action: 'shelter-status', shelterId, status: 'new'|'verified'|'not-shelter', note }
   POST { action: 'shelter-edit', shelterId, fields }
   POST { action: 'shelter-merge', from, into }
   POST { action: 'place-change', internId, reason }  ask an intern to work somewhere else (emailed)

   More time and reminders by hand (12 Nov 2026, lib/intern-time.js). Each
   takes preview: true first, which changes nothing and shows exactly what
   would change or go:
   POST { action: 'extend-batch', batchId, fromWeek, days, reason, note?, notify? }
   POST { action: 'extend-intern', internId, fromWeek, days, reason, note?, notify? }
   POST { action: 'move-task', internId, taskKey, until, reason, note?, notify? }
   POST { action: 'undo-time', scope: 'batch'|'intern'|'task', batchId?|internId?, id?|taskKey?, reason }
   POST { action: 'remind', internId, note?, token, force? }      one intern
   POST { action: 'remind-behind', batchId, note?, token, force? } everyone with something open
   POST { action: 'ask-missing', token }                           every application missing a detail

   Every change is in the audit log. Nothing returned here carries a key or
   its hash, a session, or an RRT recruit's details (the RRT sends counts). */

const adminAuth = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const I = require('../../internship');
const S = require('../../intern-store');
const R = require('../../intern-reminders');
const RRT = require('../../rrt-referrals');
const SH = require('../../intern-shelters');
const VIEW = require('../../intern-admin-view');
const APPS = require('../../intern-applications');
const TIME = require('../../intern-time');

const MODULE = 'internship';

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve) => {
    let raw = typeof request.body === 'string' ? request.body : '';
    if (raw) { try { return resolve(JSON.parse(raw)); } catch (_) { return resolve({}); } }
    request.on('data', (c) => { raw += c; if (raw.length > 256 * 1024) raw = raw.slice(0, 256 * 1024); });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

function queryOf(request) {
  if (request.query && typeof request.query === 'object') return request.query;
  try { return Object.fromEntries(new URL(request.url || '/', 'https://pfa.invalid').searchParams); } catch (_) { return {}; }
}

/* an intern as the panel lists them: never the key's hash */
function row(intern, batch, works, nowMs = Date.now()) {
  const ref = intern.referral || {};
  const p = batch ? I.progressOf(batch, intern, works, ref) : null;
  return {
    internId: intern.internId, name: intern.name, email: intern.email, mobile: intern.mobile || '', dob: intern.dob || '', status: intern.status, batchId: intern.batchId,
    applicationRef: intern.applicationRef || '', referralCode: intern.referralCode, referralLink: I.referralLink(intern.referralCode),
    referralRegistered: intern.referralRegistered || '',
    referral: { clicks: Number(ref.clicks) || 0, storeVisits: Number(ref.storeVisits) || 0, firstOpens: Number(ref.firstOpens) || 0, registrations: Number(ref.registrations) || 0, fetchedAt: ref.fetchedAt || '' },
    electives: intern.electives || [], lastSignInAt: intern.lastSignInAt || '', lockedUntil: intern.lockedUntil || '', createdAt: intern.createdAt || '',
    /* their own calendar (12 Nov 2026): extensions, moved tasks, the end, the reminders sent by hand */
    week: batch ? I.currentWeek(batch, nowMs, intern) : 0,
    endsOn: batch ? I.ymdOf(I.timeline(batch, intern).endMs()) : '',
    extensions: (intern.extensions || []).map(I.extensionView),
    moved: Object.keys(intern.taskDue || {}).map((k) => Object.assign({ taskKey: k, title: ((batch && batch.tasks) || []).find((t) => t.key === k) ? batch.tasks.find((t) => t.key === k).title : k }, intern.taskDue[k])),
    nudges: (intern.nudges || []).slice(-10),
    progress: p ? { percent: p.percent, accepted: p.accepted, need: p.need, waiting: p.waiting, revise: p.revise, complete: p.complete, average: p.average, tasks: p.tasks.map((t) => ({ key: t.key, state: t.state, chosen: t.chosen, score: t.score, count: t.count })) } : null,
    log: (intern.log || []).slice(-10)
  };
}

function csvOut(response, name, bytes) {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  response.setHeader('Cache-Control', 'no-store');
  return response.end(bytes);
}

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || firebase.getDb;
  const requireAdmin = d.requireAdmin || adminAuth.requireAdmin;
  const now = d.now || (() => Date.now());

  return async function handler(request, response) {
    const who = await requireAdmin(request, response, MODULE);
    if (!who) return undefined;
    const by = who.email || who.uid || 'admin';
    if (request.method !== 'GET' && request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    try {
      const db = getDb();
      const nowMs = now();
      if (request.method === 'GET') {
        const q = queryOf(request);
        if (q.file) {
          const f = await S.readFile(db, q.file, null);
          if (!f) return sendJson(response, 404, { code: 'NOT_FOUND', message: 'That file is not kept.' });
          response.statusCode = 200;
          response.setHeader('Content-Type', f.type);
          response.setHeader('Content-Disposition', `inline; filename="${String(f.name).replace(/[^\w. -]+/g, '_')}"`);
          response.setHeader('Cache-Control', 'private, no-store');
          response.setHeader('X-Content-Type-Options', 'nosniff');
          return response.end(f.bytes);
        }
        if (q.interns === 'all') {
          const rows = await VIEW.register(db, nowMs);
          if (String(q.format || '') === 'csv') {
            await audit.record(who, { module: MODULE, action: 'interns-exported', subject: 'interns', detail: `${rows.length} interns` }, request);
            return csvOut(response, `pfa-interns-${new Date(nowMs + 330 * 60000).toISOString().slice(0, 10)}.csv`, VIEW.csvOf(rows));
          }
          return sendJson(response, 200, { ok: true, interns: rows });
        }
        if (q.profile) return sendJson(response, 200, Object.assign({ ok: true }, await VIEW.detail(db, q.profile, nowMs)));
        if (q.shelters) {
          const all = await SH.list(db);
          if (String(q.format || '') === 'csv') {
            await audit.record(who, { module: MODULE, action: 'shelters-exported', subject: 'shelters', detail: `${all.rows.length} shelters` }, request);
            return csvOut(response, `pfa-shelters-${new Date(nowMs + 330 * 60000).toISOString().slice(0, 10)}.csv`, SH.csvOf(all.rows));
          }
          return sendJson(response, 200, Object.assign({ ok: true }, all));
        }
        if (q.shelter) return sendJson(response, 200, Object.assign({ ok: true }, await SH.detail(db, q.shelter)));
        if (q.intern) {
          const intern = await S.getIntern(db, String(q.intern).toUpperCase());
          if (!intern) return sendJson(response, 404, { code: 'NO_INTERN', message: 'That intern is not on record.' });
          const batch = await S.getBatch(db, intern.batchId);
          const works = await S.listWorks(db, intern.internId);
          return sendJson(response, 200, { ok: true, intern: row(intern, batch, works, nowMs), batch: batch ? I.batchView(batch, nowMs, intern) : null, works: works.map((w) => I.workView(w, true)) });
        }
        if (q.queue === 'review') {
          const works = await S.reviewQueue(db);
          const cache = new Map();
          const out = [];
          for (const w of works.slice(0, 200)) {
            if (!cache.has(w.internId)) cache.set(w.internId, await S.getIntern(db, w.internId));
            const intern = cache.get(w.internId) || {};
            const batch = await S.getBatch(db, w.batchId);
            const task = batch ? (batch.tasks || []).find((t) => t.key === w.taskKey) : null;
            out.push(Object.assign(I.workView(w, true), { name: intern.name || '', taskTitle: (task && task.title) || w.taskKey, goal: (task && task.goal) || '', need: (task && task.need) || '', proofAsked: (task && task.proof) || '' }));
          }
          return sendJson(response, 200, { ok: true, queue: out });
        }
        if (q.application) {
          /* one application for its case in Submissions: what sign-in needs
             and what is missing, and every later sending */
          const snap = await db.collection('submissions').doc(I.clean(q.application, 40).toUpperCase()).get();
          const a = snap.exists ? Object.assign({ reference: snap.id }, snap.data() || {}) : null;
          if (!a || a.kind !== APPS.KIND) return sendJson(response, 404, { code: 'NO_APPLICATION', message: 'That internship application is not on record.' });
          const p = APPS.applicantOf(a, nowMs);
          const holder = (await S.listInterns(db)).find((i) => i.status !== 'revoked' && i.status !== 'reserving' && (i.applicationRef === a.reference || (p.email && i.email === I.emailOf(p.email))));
          return sendJson(response, 200, { ok: true, application: Object.assign(p, {
            resent: (a.resent || []).map((x) => ({ at: x.at || '', fields: x.fields || {} })),
            intern: holder ? { internId: holder.internId, applicationRef: holder.applicationRef || '' } : null
          }) });
        }
        if (q.applications) {
          const apps = await APPS.waiting(db, nowMs);
          return sendJson(response, 200, { ok: true, applications: apps.slice(0, 300) });
        }
        if (q.batch) {
          const batch = await S.getBatch(db, String(q.batch));
          if (!batch) return sendJson(response, 404, { code: 'NO_BATCH', message: 'That batch is not on record.' });
          const interns = (await S.listInterns(db, batch.batchId)).filter((i) => i.status !== 'reserving');
          const rows = [];
          for (const i of interns) rows.push(row(i, batch, await S.listWorks(db, i.internId), nowMs));
          rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
          return sendJson(response, 200, { ok: true, batch: I.batchView(batch, nowMs), plan: { weeks: batch.weeks, tasks: batch.tasks, electivesRequired: batch.electivesRequired }, interns: rows, reminders: await R.logs(db, batch.batchId) });
        }
        const batches = await S.listBatches(db);
        const all = (await S.listInterns(db)).filter((i) => i.status !== 'reserving');
        const waiting = (await S.reviewQueue(db)).length;
        const sheltersNew = ((await db.collection(SH.SHELTERS).where('status', '==', 'new').get()).docs || []).length;
        return sendJson(response, 200, {
          ok: true,
          sheltersNew,
          batches: batches.map((b) => Object.assign(I.batchView(b, nowMs), { interns: all.filter((i) => i.batchId === b.batchId && i.status !== 'revoked').length })),
          waiting, usage: Object.assign(await S.usage(db), { limits: I.LIMITS }), rrt: await RRT.status(db),
          defaultPlan: I.defaultPlan()
        });
      }

      const body = await readBody(request);
      const action = String(body.action || '');
      if (action === 'batch-save') {
        const b = await S.saveBatch(db, body, by, nowMs);
        await audit.record(who, { module: MODULE, action: body.batchId ? 'intern-batch-updated' : 'intern-batch-created', subject: b.batchId, detail: `${b.name}, from ${b.startDate}, ${b.weeks.length} weeks, ${b.tasks.length} tasks` }, request);
        return sendJson(response, 200, { ok: true, batch: I.batchView(b, nowMs) });
      }
      if (action === 'issue') {
        /* approved from the application itself (the Submissions panel sends
           only its reference): the sign-in details are the ones applied with */
        const ref = I.clean(body.applicationRef, 40).toUpperCase();
        if (ref) {
          const snap = await db.collection('submissions').doc(ref).get();
          const a = snap.exists ? Object.assign({ reference: ref }, snap.data() || {}) : null;
          if (!a || a.kind !== APPS.KIND) return sendJson(response, 404, { code: 'NO_APPLICATION', message: 'That internship application is not on record.' });
          const p = APPS.applicantOf(a, nowMs);
          if (p.missing.length) return sendJson(response, 400, { code: 'MISSING_DETAILS', missing: p.missing, message: `${ref} has no ${APPS.listOf(p.missing)}, and they sign in with it. Ask them for it: they fill in the form again and it is added to this application.` });
          Object.assign(body, { name: p.name, email: p.email, mobile: p.mobile, dob: p.dob });
        }
        const r = await S.issueIntern(db, body, by, nowMs, { mail: d.mail, queue: d.queue, fetchImpl: d.fetchImpl });
        /* the application, Accepted: its track page says so (lib/case-flow.js) */
        if (r.intern.applicationRef) {
          await require('../../case-flow').changeStatus({ db, ref: db.collection('submissions').doc(r.intern.applicationRef), to: 'approved', note: `Approved into ${r.intern.batchId} as ${r.intern.internId}; the start email went to the intern.`, at: new Date(nowMs).toISOString(), fieldValue: firebase.fieldValue, handledBy: by })
            .catch((error) => console.warn('internship application not marked accepted', error && error.message));
        }
        /* the same person's other applications from before one per email:
           Accepted with it, so none is left waiting */
        for (const other of (await APPS.all(db)).filter((a) => a.reference !== r.intern.applicationRef && a.status !== 'approved' && I.emailOf(APPS.applicantOf(a, nowMs).email) === r.intern.email)) {
          await require('../../case-flow').changeStatus({ db, ref: db.collection('submissions').doc(other.reference), to: 'approved', note: `The same person as ${r.intern.applicationRef || r.intern.internId} (the same email): approved there as ${r.intern.internId}.`, at: new Date(nowMs).toISOString(), fieldValue: firebase.fieldValue, handledBy: by })
            .catch((error) => console.warn('same-person application not marked accepted', error && error.message));
        }
        await audit.record(who, { module: MODULE, action: 'intern-approved', subject: r.intern.internId, detail: `${r.intern.name}, ${r.intern.batchId}${r.intern.applicationRef ? `, from ${r.intern.applicationRef}` : ''}` }, request);
        return sendJson(response, 200, { ok: true, internId: r.intern.internId, referralCode: r.intern.referralCode, mailed: r.mailed.sent ? 'sent' : r.mailed.queued ? 'queued' : 'not-sent' });
      }
      if (action === 'ask-details') {
        const r = await APPS.askFor(db, I.clean(body.applicationRef, 40), by, nowMs, { mail: d.mail, queue: d.queue });
        await audit.record(who, { module: MODULE, action: 'intern-details-asked', subject: r.reference, detail: `asked for ${APPS.listOf(r.missing)}` }, request);
        return sendJson(response, 200, { ok: true, reference: r.reference, missing: r.missing, mailed: r.mailed });
      }
      if (action === 'details') {
        const r = await S.setDetails(db, String(body.internId || '').toUpperCase(), body, by, nowMs);
        await audit.record(who, { module: MODULE, action: 'intern-sign-in-details', subject: r.internId, detail: r.changed.length ? `changed: ${r.changed.join(', ')}` : 'set again' }, request);
        return sendJson(response, 200, { ok: true, changed: r.changed });
      }
      if (action === 'revoke') {
        const reason = I.clean(body.reason, 200);
        if (reason.length < 4) return sendJson(response, 400, { code: 'NO_REASON', message: 'Say why access is withdrawn.' });
        await S.revoke(db, String(body.internId || ''), reason, by, nowMs);
        const intern = await S.getIntern(db, String(body.internId || ''));
        try { await RRT.register(db, intern, { fetchImpl: d.fetchImpl }); } catch (_) { /* withdrawn on the next refresh */ }
        await audit.record(who, { module: MODULE, action: 'intern-revoked', subject: body.internId, detail: reason }, request);
        return sendJson(response, 200, { ok: true });
      }
      if (action === 'regenerate') {
        const r = await S.regenerate(db, String(body.internId || ''), body.verifiedHow, by, nowMs, { mail: d.mail, queue: d.queue });
        await audit.record(who, { module: MODULE, action: 'intern-new-key', subject: body.internId, detail: `verified: ${I.clean(body.verifiedHow, 200)}` }, request);
        return sendJson(response, 200, { ok: true, onboardUrl: r.onboardUrl, mailed: r.mailed.sent ? 'sent' : r.mailed.queued ? 'queued' : 'not-sent' });
      }
      if (action === 'review') {
        const w = await S.review(db, body, by, nowMs, { mail: d.mail, queue: d.queue });
        await audit.record(who, { module: MODULE, action: w.state === 'accepted' ? 'intern-work-accepted' : 'intern-work-revise', subject: `${body.internId} ${body.taskKey}`, detail: w.state === 'accepted' ? `score ${w.score}` : I.clean(w.feedback, 200) }, request);
        return sendJson(response, 200, { ok: true, work: I.workView(w, true) });
      }
      /* more time, and reminders by hand (lib/intern-time.js) */
      if (action === 'extend-batch' || action === 'extend-intern' || action === 'move-task') {
        const fn = action === 'extend-batch' ? TIME.extendBatch : action === 'extend-intern' ? TIME.extendIntern : TIME.moveTask;
        const r = await fn(db, body, by, nowMs, { mail: d.mail, queue: d.queue });
        if (r.preview) return sendJson(response, 200, Object.assign({ ok: true }, r));
        const subject = action === 'extend-batch' ? String(body.batchId) : `${String(body.internId || '').toUpperCase()}${action === 'move-task' ? ` ${body.taskKey}` : ''}`;
        const detail = action === 'move-task'
          ? `${r.task} due ${r.until} (was ${r.was}): ${I.clean(body.reason, 200)}`
          : `${r.extension.days} days from week ${r.extension.fromWeek}, now ends ${r.endsOn}: ${r.extension.reason}`;
        await audit.record(who, { module: MODULE, action: action === 'move-task' ? 'intern-task-moved' : action === 'extend-batch' ? 'intern-batch-extended' : 'intern-extended', subject, detail }, request);
        return sendJson(response, 200, Object.assign({ ok: true }, r));
      }
      if (action === 'undo-time') {
        const r = await TIME.undo(db, body, by, nowMs);
        await audit.record(who, { module: MODULE, action: 'intern-time-undone', subject: r.subject, detail: `${r.scope}: ${r.what} taken back: ${I.clean(body.reason, 200)}` }, request);
        return sendJson(response, 200, Object.assign({ ok: true }, r));
      }
      if (action === 'remind' || action === 'remind-behind' || action === 'ask-missing') {
        const fn = action === 'remind' ? TIME.remindOne : action === 'remind-behind' ? TIME.remindBehind : TIME.askMissing;
        const r = await fn(db, Object.assign({}, body, { preview: Boolean(body.preview) }), by, nowMs, { mail: d.mail, queue: d.queue });
        if (r.preview) return sendJson(response, 200, Object.assign({ ok: true }, r));
        const detail = action === 'remind' ? `reminded by hand: ${r.state}${body.force ? ' (sent anyway)' : ''}`
          : action === 'remind-behind' ? `${r.sent} sent, ${r.queued} queued, ${r.failed} failed, ${r.held} held back${body.force ? ' (sent anyway)' : ''}`
            : `${r.asked} asked again, ${r.skipped} skipped, ${r.failed} failed`;
        await audit.record(who, { module: MODULE, action: action === 'remind' ? 'intern-reminded' : action === 'remind-behind' ? 'intern-batch-reminded' : 'intern-details-asked-all', subject: action === 'remind' ? String(body.internId || '').toUpperCase() : action === 'remind-behind' ? String(body.batchId) : 'applications', detail }, request);
        return sendJson(response, 200, Object.assign({ ok: true }, r));
      }
      if (action === 'referrals') {
        const r = await RRT.refresh(db, { force: true, nowMs, fetchImpl: d.fetchImpl });
        return sendJson(response, r.state === 'failed' ? 502 : 200, { ok: r.state !== 'failed', result: r, rrt: await RRT.status(db), message: r.state === 'not-configured' ? 'The RRT link is not set up: PFA_RRT_REFERRAL_SECRET is missing.' : r.error || '' });
      }
      if (action === 'shelter-status') {
        const r = await SH.setStatus(db, String(body.shelterId || ''), String(body.status || ''), body.note, by, nowMs);
        await audit.record(who, { module: MODULE, action: 'shelter-status', subject: r.shelterId, detail: `${r.status}${body.note ? `: ${I.clean(body.note, 200)}` : ''}` }, request);
        return sendJson(response, 200, Object.assign({ ok: true }, await SH.detail(db, r.shelterId)));
      }
      if (action === 'shelter-edit') {
        const r = await SH.edit(db, String(body.shelterId || ''), body.fields || {}, by, nowMs);
        await audit.record(who, { module: MODULE, action: 'shelter-edited', subject: r.shelterId, detail: I.clean(body.fields && body.fields.name, 120) }, request);
        return sendJson(response, 200, Object.assign({ ok: true }, await SH.detail(db, r.shelterId)));
      }
      if (action === 'shelter-merge') {
        const r = await SH.merge(db, String(body.from || ''), String(body.into || ''), by, nowMs);
        await audit.record(who, { module: MODULE, action: 'shelters-merged', subject: r.shelterId, detail: `${I.clean(body.from, 20)} into ${I.clean(body.into, 20)}` }, request);
        return sendJson(response, 200, Object.assign({ ok: true }, await SH.detail(db, r.shelterId)));
      }
      if (action === 'place-change') {
        const r = await SH.askToChange(db, String(body.internId || ''), body.reason, by, nowMs);
        const intern = await S.getIntern(db, r.internId);
        let mailed = { sent: false };
        if (intern && intern.email) {
          mailed = await S.mailNow({ template: 'intern_shelter_change', to: intern.email, dedupeKey: `${r.internId}:place:${nowMs}`,
            payload: { name: intern.name, reason: r.reason, link: S.dashboardUrl(), siteUrl: S.publicSite() }, mail: d.mail, queue: d.queue });
        }
        await audit.record(who, { module: MODULE, action: 'intern-place-change', subject: r.internId, detail: r.reason }, request);
        return sendJson(response, 200, { ok: true, mailed: mailed.sent ? 'sent' : mailed.queued ? 'queued' : 'not-sent' });
      }
      return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Nothing to do.' });
    } catch (error) {
      if (error && error.code && error.status) return sendJson(response, error.status, Object.assign({ code: error.code, message: error.message }, error.field ? { field: error.field } : {}));
      console.error('internship admin route failed', (error && error.message) || error);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done just now.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
