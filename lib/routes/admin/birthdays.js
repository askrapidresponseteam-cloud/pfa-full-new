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

function queryOf(request) {
  if (request.query && typeof request.query === 'object') return request.query;
  try { return Object.fromEntries(new URL(request.url || '/', 'https://pfa.invalid').searchParams); } catch (_) { return {}; }
}

/* Every card emailed, the list kept (owner, 21 Nov 2026: "also maintain the
   list of to who it has been sent. and have standard filters"). Read from
   the email queue, where each greeting is a row that is never removed: who
   it went to, the birthday, the age turned, where it stands, and whether it
   went by itself in the morning or from the panel (and by whom). */
const isoOf = (v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : typeof v === 'string' ? v : '');
async function sentList(db) {
  const snap = await db.collection('caregiverEmails').where('template', '==', G.TEMPLATE).get();
  return (snap.docs || []).map((doc) => {
    const d = doc.data() || {};
    const p = d.payload || {};
    const status = String(d.status || '');
    const by = String(p.by || 'schedule');
    return {
      day: String(p.day || ''),
      name: String(p.name || ''),
      email: String(d.to || ''),
      turns: Number(p.turns) || 0,
      state: status === 'sent' ? 'sent' : status === 'failed' ? 'failed' : 'waiting',
      at: isoOf(d.sentAt) || isoOf(d.updatedAt) || isoOf(d.createdAt),
      how: by === 'schedule' ? 'auto' : 'panel',
      by: by === 'schedule' ? '' : by
    };
  }).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day))
    .sort((a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name));
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;
function filterSent(rows, q) {
  const from = DAY.test(String(q.from || '')) ? q.from : '';
  const to = DAY.test(String(q.to || '')) ? q.to : '';
  const state = /^(sent|waiting|failed)$/.test(String(q.state || '')) ? q.state : '';
  const how = /^(auto|panel)$/.test(String(q.how || '')) ? q.how : '';
  const words = String(q.q || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80).split(' ').filter(Boolean);
  return rows.filter((r) => (!from || r.day >= from) && (!to || r.day <= to) && (!state || r.state === state) && (!how || r.how === how)
    && words.every((w) => `${r.name} ${r.email}`.toLowerCase().includes(w)));
}
const csvCell = (v) => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) || /^[=+\-@]/.test(t) ? `"${t.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : t; };
function sentCsv(rows) {
  const STATE = { sent: 'Sent', waiting: 'Waiting to send', failed: 'Could not send' };
  const lines = [['Birthday', 'Name', 'Email', 'Turned', 'Status', 'At', 'How'].join(',')];
  /* India's time, as read: 2026-11-17 08:04 IST */
  const ist = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? `${new Date(t + 330 * 60000).toISOString().slice(0, 16).replace('T', ' ')} IST` : ''; };
  for (const r of rows) lines.push([r.day, r.name, r.email, r.turns || '', STATE[r.state], ist(r.at), r.how === 'auto' ? 'Automatically' : `From the panel${r.by ? ` by ${r.by}` : ''}`].map(csvCell).join(','));
  return Buffer.from('\ufeff' + lines.join('\r\n') + '\r\n', 'utf8');
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
    /* the cards sent, filtered; as a CSV, logged */
    const q = method === 'GET' ? queryOf(request) : {};
    if (q.sent != null) {
      const all = await sentList(db);
      const rows = filterSent(all, q);
      if (q.format === 'csv') {
        const how = ['from', 'to', 'state', 'how', 'q'].filter((k) => String(q[k] || '').trim()).map((k) => `${k} ${String(q[k]).slice(0, 80)}`).join(', ');
        await require('../../admin-audit').record(who, { module: 'directory', action: 'birthday-cards-download', subject: 'birthday-cards-sent', detail: `${rows.length} ${rows.length === 1 ? 'card' : 'cards'}${how ? `, ${how}` : ', all'}` }, request);
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', `attachment; filename="PFA-birthday-cards-sent-${G.istDay(nowMs)}.csv"`);
        response.setHeader('Cache-Control', 'no-store');
        return response.end(sentCsv(rows));
      }
      return sendJson(response, 200, { ok: true, total: all.length, count: rows.length, rows: rows.slice(0, 2000), today: G.istDay(nowMs) });
    }
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

module.exports._private = { birthdays: G.birthdays, birthdayIn: G.birthdayIn, sentList, filterSent, sentCsv };
