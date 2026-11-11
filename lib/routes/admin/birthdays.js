/* GET /api/admin/birthdays
     -> { ok, today: 'YYYY-MM-DD', people: [...today's], upcoming: [...the
          next 30 days], withDate: how many people have given a date }

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

const IST_MS = 330 * 60000;
const AHEAD = 30;
const LABEL = Object.fromEntries(D.CATEGORIES.map((c) => [c.key, c.label]));

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function istDay(ms) { return new Date(ms + IST_MS).toISOString().slice(0, 10); }
function leap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

/* the day this year a date of birth falls on: "2027-02-28" for 29 Feb in 2027 */
function birthdayIn(year, dob) {
  const md = dob.slice(5);
  return `${year}-${md === '02-29' && !leap(year) ? '02-28' : md}`;
}

/* Each person with a date of birth whose birthday is today or within the
   next `ahead` days, soonest first, then by name. */
function birthdays(people, nowMs, ahead) {
  const today = istDay(nowMs);
  const year = Number(today.slice(0, 4));
  const t0 = Date.parse(today + 'T00:00:00Z');
  const out = [];
  for (const p of people) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.dob || '')) continue;
    let day = birthdayIn(year, p.dob);
    if (day < today) day = birthdayIn(year + 1, p.dob);
    const inDays = Math.round((Date.parse(day + 'T00:00:00Z') - t0) / 864e5);
    if (inDays > ahead) continue;
    const born = Number(p.dob.slice(0, 4));
    out.push({
      id: p.id, name: p.name, dob: p.dob, day, inDays,
      turns: Number(day.slice(0, 4)) - born,
      mobile: p.mobile, email: p.email, state: p.state, district: p.district,
      categories: p.categories.map((c) => LABEL[c] || c)
    });
  }
  out.sort((a, b) => a.inDays - b.inDays || String(a.name).localeCompare(String(b.name)));
  return { today, people: out.filter((x) => x.inDays === 0), upcoming: out.filter((x) => x.inDays > 0) };
}

module.exports = async function handler(request, response, deps) {
  const o = deps || {};
  const who = await requireAdmin(request, response, 'directory');
  if (!who) return undefined;
  if (String(request.method || 'GET').toUpperCase() !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  }
  try {
    const people = await D.read(o.getDb ? o.getDb() : getDb());
    const r = birthdays(people, o.now ? o.now() : Date.now(), AHEAD);
    return sendJson(response, 200, Object.assign({ ok: true, withDate: people.filter((p) => p.dob).length, ahead: AHEAD }, r));
  } catch (error) {
    console.error('birthdays failed', { message: error && error.message });
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'The birthdays could not be read just now.' });
  }
};

module.exports._private = { birthdays, birthdayIn };
