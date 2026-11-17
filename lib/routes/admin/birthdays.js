/* GET /api/admin/birthdays
     -> { ok, today: 'YYYY-MM-DD', people: [...today's, each with its
          emailed greeting], upcoming: [...the next 30 days], withDate: how
          many people have given a date, greetings: { hour, on, past } }
   POST { action: 'send', key } -> the card emailed now to someone whose
          birthday is today (lib/birthday-greetings.js), once.

   Birthdays (owner, 11 Nov 2026: "have this in the admin panel. and also
   have a section for birthday's today", "admin should have birthday
   reminder stuff"). From the People directory (lib/people-directory.js):
   everyone who gave a date of birth on the donation or membership form, or
   the internship's, once each. India's day decides whose birthday it is. A
   29 February birthday is kept on 28 February in a year without one.

   Part of the People directory module ('directory'): whoever can see the
   people can see their birthdays, and no one else. Only what a greeting
   needs leaves: the name, the day, the age being turned, how to reach them
   and how PFA knows them; never the address. */

'use strict';

const { requireAdmin } = require('../../admin-auth');
const D = require('../../people-directory');
const { getDb } = require('../../firebase');

const G = require('../../birthday-greetings');

const AHEAD = 30;

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
    if (raw || request.body === null || request.readableEnded || typeof request.on !== 'function') { try { return resolve(JSON.parse(raw || '{}')); } catch (_) { return resolve({}); } }
    request.on('data', (chunk) => { if (raw.length < 4096) raw += chunk; });
    request.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

/* today's people, each with where their emailed greeting stands; the key
   the panel sends back to email one by hand */
async function withGreetings(db, list, day) {
  return Promise.all(list.map(async (p) => {
    let greeting;
    try { greeting = await G.statusOf(db, p, day); } catch (_) { greeting = { state: 'unknown' }; }
    return Object.assign({}, p, { key: G.keyOf(p, day), greeting });
  }));
}

module.exports = async function handler(request, response, deps) {
  const o = deps || {};
  const who = o.requireAdmin ? await o.requireAdmin(request, response, 'directory') : await requireAdmin(request, response, 'directory');
  if (!who) return undefined;
  const method = String(request.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  }
  const db = o.getDb ? o.getDb() : getDb();
  const nowMs = o.now ? o.now() : Date.now();
  try {
    const people = o.readPeople ? await o.readPeople(db) : await D.read(db);
    const r = G.birthdays(people, nowMs, AHEAD);
    /* Email the card to someone whose birthday it is today, now: the
       morning's greeting by hand, for a morning that was missed. Only
       today's, and only once: the same key as the morning's own. */
    if (method === 'POST') {
      const body = await readBody(request);
      if (body.action !== 'send') return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Nothing to do.' });
      const p = r.people.find((x) => G.keyOf(x, r.today) === String(body.key || ''));
      if (!p) return sendJson(response, 404, { code: 'NOT_TODAY', message: 'That birthday is not today, so its card is not emailed now.' });
      const done = await G.greet(p, r.today, { send: o.send, by: (who && who.email) || 'panel' });
      const greeting = await G.statusOf(db, p, r.today).catch(() => ({ state: done.state }));
      return sendJson(response, 200, { ok: true, state: done.state, reason: done.reason || '', greeting });
    }
    r.people = await withGreetings(db, r.people, r.today);
    return sendJson(response, 200, Object.assign({ ok: true, withDate: people.filter((p) => p.dob).length, ahead: AHEAD,
      greetings: { hour: G.HOUR, on: !/^off$/i.test(String(process.env.PFA_BIRTHDAY_GREETINGS || '').trim()), past: G.istHour(nowMs) >= G.HOUR + 1 } }, r));
  } catch (error) {
    console.error('birthdays failed', { message: error && error.message });
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'The birthdays could not be read just now.' });
  }
};

module.exports._private = { birthdays: G.birthdays, birthdayIn: G.birthdayIn };
