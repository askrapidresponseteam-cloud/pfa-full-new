'use strict';

/* The internship portal in the panel (lib/internship.js), module 'internship'.

   GET  /api/admin/internship                      batches, usage, the RRT link's state
   GET  /api/admin/internship?batch=ID             a batch: its plan, interns, progress, reminder log
   GET  /api/admin/internship?intern=ID            one intern: every task's work and history
   GET  /api/admin/internship?queue=review         work waiting for review, oldest first
   GET  /api/admin/internship?applications=1       internship applications without an Intern ID
   GET  /api/admin/internship?file=ID              one uploaded file
   POST { action: 'batch-save', batchId?, name, startDate, status, plan? }
   POST { action: 'issue', batchId, name, email, mobile?, applicationRef? }
   POST { action: 'revoke', internId, reason }
   POST { action: 'regenerate', internId, verifiedHow }
   POST { action: 'review', internId, taskKey, decision: 'accept'|'revise', score, feedback }
   POST { action: 'referrals' }                    read the RRT counts now

   Every change is in the audit log. Nothing returned here carries a key or
   its hash, a session, or an RRT recruit's details (the RRT sends counts). */

const adminAuth = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const I = require('../../internship');
const S = require('../../intern-store');
const R = require('../../intern-reminders');
const RRT = require('../../rrt-referrals');

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
function row(intern, batch, works) {
  const ref = intern.referral || {};
  const p = batch ? I.progressOf(batch, intern, works, ref) : null;
  return {
    internId: intern.internId, name: intern.name, email: intern.email, status: intern.status, batchId: intern.batchId,
    applicationRef: intern.applicationRef || '', referralCode: intern.referralCode, referralLink: I.referralLink(intern.referralCode),
    referralRegistered: intern.referralRegistered || '',
    referral: { clicks: Number(ref.clicks) || 0, storeVisits: Number(ref.storeVisits) || 0, firstOpens: Number(ref.firstOpens) || 0, registrations: Number(ref.registrations) || 0, fetchedAt: ref.fetchedAt || '' },
    electives: intern.electives || [], lastSignInAt: intern.lastSignInAt || '', lockedUntil: intern.lockedUntil || '', createdAt: intern.createdAt || '',
    progress: p ? { percent: p.percent, accepted: p.accepted, need: p.need, waiting: p.waiting, revise: p.revise, complete: p.complete, average: p.average, tasks: p.tasks.map((t) => ({ key: t.key, state: t.state, chosen: t.chosen, score: t.score, count: t.count })) } : null,
    log: (intern.log || []).slice(-10)
  };
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
        if (q.intern) {
          const intern = await S.getIntern(db, String(q.intern).toUpperCase());
          if (!intern) return sendJson(response, 404, { code: 'NO_INTERN', message: 'That intern is not on record.' });
          const batch = await S.getBatch(db, intern.batchId);
          const works = await S.listWorks(db, intern.internId);
          return sendJson(response, 200, { ok: true, intern: row(intern, batch, works), batch: batch ? I.batchView(batch, nowMs) : null, works: works.map((w) => I.workView(w, true)) });
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
        if (q.applications) {
          const snap = await db.collection('submissions').where('kind', '==', 'PFA-VI').get();
          const issued = new Set((await S.listInterns(db)).filter((i) => i.status !== 'revoked').map((i) => i.applicationRef));
          const apps = (snap.docs || []).map((doc) => Object.assign({ reference: doc.id }, doc.data() || {}))
            .filter((a) => a.status !== 'removed' && a.status !== 'spam' && !issued.has(a.reference) && !(require('../../test-data').isTest(a)))
            .map((a) => {
              const f = a.fields || {};
              const pick = (re) => { const k = Object.keys(f).find((x) => re.test(x)); return k ? I.clean(f[k], 160) : ''; };
              return { reference: a.reference, name: pick(/^(name|full ?name)$/i), email: pick(/^e-?mail$/i), mobile: pick(/^(mobile|phone|whatsapp)$/i), city: pick(/^(city|district|town)$/i), status: a.status || 'new', createdAt: a.createdAt || '' };
            })
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
          return sendJson(response, 200, { ok: true, applications: apps.slice(0, 300) });
        }
        if (q.batch) {
          const batch = await S.getBatch(db, String(q.batch));
          if (!batch) return sendJson(response, 404, { code: 'NO_BATCH', message: 'That batch is not on record.' });
          const interns = (await S.listInterns(db, batch.batchId)).filter((i) => i.status !== 'reserving');
          const rows = [];
          for (const i of interns) rows.push(row(i, batch, await S.listWorks(db, i.internId)));
          rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
          return sendJson(response, 200, { ok: true, batch: I.batchView(batch, nowMs), plan: { weeks: batch.weeks, tasks: batch.tasks, electivesRequired: batch.electivesRequired }, interns: rows, reminders: await R.logs(db, batch.batchId) });
        }
        const batches = await S.listBatches(db);
        const all = (await S.listInterns(db)).filter((i) => i.status !== 'reserving');
        const waiting = (await S.reviewQueue(db)).length;
        return sendJson(response, 200, {
          ok: true,
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
        const r = await S.issueIntern(db, body, by, nowMs, { mail: d.mail, queue: d.queue, fetchImpl: d.fetchImpl });
        await audit.record(who, { module: MODULE, action: 'intern-issued', subject: r.intern.internId, detail: `${r.intern.name}, ${r.intern.batchId}${r.intern.applicationRef ? `, from ${r.intern.applicationRef}` : ''}` }, request);
        return sendJson(response, 200, { ok: true, internId: r.intern.internId, referralCode: r.intern.referralCode, onboardUrl: r.onboardUrl, mailed: r.mailed.sent ? 'sent' : r.mailed.queued ? 'queued' : 'not-sent' });
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
      if (action === 'referrals') {
        const r = await RRT.refresh(db, { force: true, nowMs, fetchImpl: d.fetchImpl });
        return sendJson(response, r.state === 'failed' ? 502 : 200, { ok: r.state !== 'failed', result: r, rrt: await RRT.status(db), message: r.state === 'not-configured' ? 'The RRT link is not set up: PFA_RRT_REFERRAL_SECRET is missing.' : r.error || '' });
      }
      return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Nothing to do.' });
    } catch (error) {
      if (error && error.code && error.status) return sendJson(response, error.status, { code: error.code, message: error.message });
      console.error('internship admin route failed', (error && error.message) || error);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done just now.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
