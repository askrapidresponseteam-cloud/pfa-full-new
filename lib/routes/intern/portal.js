'use strict';

/* The intern's side of the internship portal (lib/internship.js).

   POST   /api/intern/onboard  { token }                 the key, shown once; signs in
   POST   /api/intern/session  { internId, key }         sign in
   DELETE /api/intern/session                            sign out
   GET    /api/intern/me                                 the dashboard: plan, deadlines,
                                                         progress, feedback, referral counts
   POST   /api/intern/me       { action: 'electives', electives: [...] }
   POST   /api/intern/work     { taskKey, links, note, files }
   POST   /api/intern/file     { taskKey, name, type, data (base64) }
   GET    /api/intern/file?id=                           one of the intern's own files
   GET    /api/intern/quiz                               the quiz: attempts, marks, the
                                                         open attempt's next question
   POST   /api/intern/quiz     { action: 'start' }
   POST   /api/intern/quiz     { action: 'answer', attemptId, qid, choice: 'A'-'E' }
   GET    /api/intern/shelter                            where they do their shelter work
   POST   /api/intern/shelter  { name, contact, phone, altPhone?, email?, house,
                                 street, landmark?, city, district, state, pin,
                                 mapLink?, animals?, agreed, photos: [file ids] }

   The session is an HttpOnly, Secure, SameSite=Strict cookie scoped to
   /api/intern; every POST must also carry X-PFA-Intern: 1, which a page on
   another site cannot send without asking first. Everything read is the
   signed-in intern's own: no other intern's work, and no recruit's details. */

const firebase = require('../../firebase');
const I = require('../../internship');
const S = require('../../intern-store');
const SUB = require('../../submissions');
const Q = require('../../intern-quiz');
const SH = require('../../intern-shelters');
const { brake } = require('../../memory-brake');

const COOKIE = 'pfa_intern';
const local = new Map();

function sendJson(response, status, payload, cookie) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (cookie) response.setHeader('Set-Cookie', cookie);
  response.end(JSON.stringify(payload));
}

function cookieOf(request) {
  const raw = String((request.headers && (request.headers.cookie || request.headers.Cookie)) || '');
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{30,60})(?:;|$)`).exec(raw);
  return m ? m[1] : '';
}

function setCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/api/intern; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
const CLEAR = `${COOKIE}=; Path=/api/intern; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

function readBody(request, max) {
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) return Promise.resolve(request.body);
  return new Promise((resolve) => {
    let raw = typeof request.body === 'string' ? request.body : Buffer.isBuffer(request.body) ? request.body.toString('utf8') : '';
    if (raw) { try { return resolve(JSON.parse(raw)); } catch (_) { return resolve({}); } }
    let size = 0;
    request.on('data', (c) => { size += c.length; if (size <= max) raw += c; });
    request.on('end', () => { if (size > max) return resolve({ __tooLarge: true }); try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

function queryOf(request) {
  if (request.query && typeof request.query === 'object') return request.query;
  try { return Object.fromEntries(new URL(request.url || '/', 'https://pfa.invalid').searchParams); } catch (_) { return {}; }
}

/* a page on another site cannot send this header without a preflight */
function sameSite(request) {
  return String((request.headers && (request.headers['x-pfa-intern'] || request.headers['X-PFA-Intern'])) || '') === '1';
}

/* Signing in and opening a link are braked per address on failures only
   (owner, 4 Nov 2026: "ensure login works perfectly"): a batch signing in
   together from one college network is never stopped, and someone guessing
   keys or links still is, after 20 misses in 15 minutes (40 on this
   instance alone when the shared count cannot be reached). */
const LOCAL_MISSES = 40;
async function braked(db, request, nowMs) {
  const ip = SUB.clientIp(request);
  const mine = local.get(String(ip || 'unknown'));
  if (mine && mine.resetAt > nowMs && mine.count >= LOCAL_MISSES) return true;
  return (await SUB.sharedAtLimit(db, 'intern', ip, nowMs)) === true;
}
async function missed(db, request, nowMs) {
  const ip = SUB.clientIp(request);
  brake(local, ip, LOCAL_MISSES, nowMs);
  await SUB.sharedLimited(db, 'intern', ip, nowMs);
}
const MISSES = new Set(['BAD_LINK', 'USED_LINK', 'OLD_LINK', 'NO_MATCH', 'NOT_SET', 'REVOKED', 'LOCKED']);
async function counting(db, request, nowMs, work) {
  try {
    return await work();
  } catch (error) {
    if (error && MISSES.has(error.code)) await missed(db, request, nowMs).catch(() => {});
    throw error;
  }
}

function errorOut(response, error) {
  if (error && error.code && error.status) return sendJson(response, error.status, Object.assign({ code: error.code, message: error.message }, error.field ? { field: error.field } : {}));
  console.error('intern portal failed', (error && error.message) || error);
  return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done just now. Try again in a minute.' });
}

async function dashboard(db, intern, nowMs) {
  const batch = await S.getBatch(db, intern.batchId);
  if (!batch) return { intern: I.internView(intern), batch: null };
  const works = await S.listWorks(db, intern.internId);
  const ref = intern.referral || {};
  const rrtTask = (batch.tasks || []).find((t) => t.auto === 'rrt');
  const quiz = Q.quizTaskOf(batch) ? await Q.summary(db, intern, nowMs) : null;
  const place = (batch.tasks || []).some(SH.isShelterTask) ? await SH.placeOf(db, intern.internId) : null;
  return {
    quiz,
    place,
    intern: I.internView(intern),
    batch: I.batchView(batch, nowMs),
    progress: I.progressOf(batch, intern, works, ref),
    works: works.map((w) => I.workView(w, false)),
    referral: {
      code: intern.referralCode, link: I.referralLink(intern.referralCode),
      clicks: Number(ref.clicks) || 0, storeVisits: Number(ref.storeVisits) || 0, firstOpens: Number(ref.firstOpens) || 0,
      registrations: Number(ref.registrations) || 0, target: rrtTask ? Number(rrtTask.target) || 0 : 0,
      fetchedAt: ref.fetchedAt || '', connected: require('../../rrt-referrals').configured()
    },
    limits: { fileMb: Math.round(I.LIMITS.fileBytes / 1048576), filesPerTask: I.LIMITS.filesPerTask, linksPerTask: I.LIMITS.linksPerTask, noteChars: I.LIMITS.noteChars },
    now: new Date(nowMs).toISOString()
  };
}

function createHandler(op, deps) {
  const d = deps || {};
  const getDb = d.getDb || firebase.getDb;
  const now = d.now || (() => Date.now());

  return async function handler(request, response) {
    const method = request.method;
    const nowMs = now();
    try {
      const db = getDb();
      if (method === 'POST' && !sameSite(request)) return sendJson(response, 403, { code: 'FORBIDDEN', message: 'Open the portal from the PFA site.' });

      if (op === 'onboard') {
        if (method !== 'POST') { response.setHeader('Allow', 'POST'); return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' }); }
        if (await braked(db, request, nowMs)) return sendJson(response, 429, { code: 'SLOW_DOWN', message: 'Too many tries from here. Wait fifteen minutes.' });
        const body = await readBody(request, 4096);
        const r = await counting(db, request, nowMs, () => S.onboard(db, body.token, nowMs));
        return sendJson(response, 200, { ok: true, internId: r.internId, key: r.key }, setCookie(r.session.token, r.session.maxAge));
      }

      if (op === 'session') {
        if (method === 'DELETE') {
          await S.endSession(db, cookieOf(request), nowMs);
          return sendJson(response, 200, { ok: true }, CLEAR);
        }
        if (method !== 'POST') { response.setHeader('Allow', 'POST, DELETE'); return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' }); }
        if (await braked(db, request, nowMs)) return sendJson(response, 429, { code: 'SLOW_DOWN', message: 'Too many tries from here. Wait fifteen minutes.' });
        const body = await readBody(request, 4096);
        const s = await counting(db, request, nowMs, () => S.signIn(db, body.internId, body.key, nowMs));
        return sendJson(response, 200, { ok: true }, setCookie(s.token, s.maxAge));
      }

      /* everything else needs a session */
      const intern = await S.whoIs(db, cookieOf(request), nowMs);
      if (!intern) return sendJson(response, 401, { code: 'SIGN_IN', message: 'Sign in with your Intern ID and access key.' }, cookieOf(request) ? CLEAR : undefined);

      if (op === 'me') {
        if (method === 'GET') return sendJson(response, 200, Object.assign({ ok: true }, await dashboard(db, intern, nowMs)));
        if (method !== 'POST') { response.setHeader('Allow', 'GET, POST'); return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' }); }
        const body = await readBody(request, 8192);
        if (body.action !== 'electives') return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Nothing to do.' });
        const batch = await S.getBatch(db, intern.batchId);
        await S.chooseElectives(db, intern, batch, body.electives, nowMs);
        return sendJson(response, 200, Object.assign({ ok: true }, await dashboard(db, await S.getIntern(db, intern.internId), nowMs)));
      }

      if (op === 'work') {
        if (method !== 'POST') { response.setHeader('Allow', 'POST'); return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' }); }
        const body = await readBody(request, 64 * 1024);
        const batch = await S.getBatch(db, intern.batchId);
        if (!batch) return sendJson(response, 409, { code: 'NO_BATCH', message: 'Your batch is not set up yet. PFA has been told.' });
        await S.submitWork(db, intern, batch, body, nowMs);
        return sendJson(response, 200, Object.assign({ ok: true }, await dashboard(db, intern, nowMs)));
      }

      if (op === 'quiz') {
        const batch = await S.getBatch(db, intern.batchId);
        if (!batch || !Q.quizTaskOf(batch)) return sendJson(response, 404, { code: 'NO_QUIZ', message: 'Your plan has no quiz.' });
        if (method === 'GET') {
          const quiz = await Q.summary(db, intern, nowMs);
          const now = quiz.open ? await Q.current(db, intern, quiz.open.attemptId, nowMs) : null;
          return sendJson(response, 200, { ok: true, quiz, attempt: now });
        }
        if (method !== 'POST') { response.setHeader('Allow', 'GET, POST'); return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' }); }
        const body = await readBody(request, 4096);
        let attempt;
        if (body.action === 'start') attempt = await Q.start(db, intern, batch, nowMs);
        else if (body.action === 'answer') attempt = await Q.answer(db, intern, body, nowMs);
        else return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Nothing to do.' });
        const quiz = attempt.state === 'done' ? await Q.summary(db, intern, nowMs) : undefined;
        return sendJson(response, 200, { ok: true, attempt, quiz });
      }

      if (op === 'shelter') {
        const batch = await S.getBatch(db, intern.batchId);
        if (!batch) return sendJson(response, 409, { code: 'NO_BATCH', message: 'Your batch is not set up yet. PFA has been told.' });
        if (method === 'GET') return sendJson(response, 200, { ok: true, place: await SH.placeOf(db, intern.internId) });
        if (method !== 'POST') { response.setHeader('Allow', 'GET, POST'); return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' }); }
        const body = await readBody(request, 16 * 1024);
        await SH.register(db, intern, batch, body, nowMs);
        return sendJson(response, 200, Object.assign({ ok: true }, await dashboard(db, intern, nowMs)));
      }

      if (op === 'file') {
        if (method === 'GET') {
          const f = await S.readFile(db, queryOf(request).id, intern.internId);
          if (!f) return sendJson(response, 404, { code: 'NOT_FOUND', message: 'That file is not one of yours, or is no longer kept.' });
          response.statusCode = 200;
          response.setHeader('Content-Type', f.type);
          response.setHeader('Content-Disposition', `inline; filename="${String(f.name).replace(/[^\w. -]+/g, '_')}"`);
          response.setHeader('Cache-Control', 'private, no-store');
          response.setHeader('X-Content-Type-Options', 'nosniff');
          response.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
          return response.end(f.bytes);
        }
        if (method !== 'POST') { response.setHeader('Allow', 'GET, POST'); return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' }); }
        const body = await readBody(request, Math.ceil(I.LIMITS.fileBytes * 1.4) + 4096);
        if (body.__tooLarge) return sendJson(response, 413, { code: 'TOO_LARGE', message: `A file can be up to ${Math.round(I.LIMITS.fileBytes / 1048576)} MB. Send a larger one as a link.` });
        const saved = await S.saveFile(db, intern, body, nowMs, { fileStore: d.fileStore });
        return sendJson(response, 200, { ok: true, file: saved });
      }

      return sendJson(response, 404, { code: 'NOT_FOUND', message: 'Unknown API route.' });
    } catch (error) {
      return errorOut(response, error);
    }
  };
}

module.exports = {
  onboard: createHandler('onboard'),
  session: createHandler('session'),
  me: createHandler('me'),
  work: createHandler('work'),
  file: createHandler('file'),
  quiz: createHandler('quiz'),
  shelter: createHandler('shelter'),
  createHandler,
  _private: { cookieOf, COOKIE }
};
