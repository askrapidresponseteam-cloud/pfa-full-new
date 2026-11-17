'use strict';

/* Birthday greetings, sent by themselves (owner, 17 Nov 2026:
   "automatically trigger the birthday greetings between 6-7 A.M on that
   special day").

   Between 6:00 and 6:59 in the morning, India time, everyone whose birthday
   it is gets an email: the card with their name on it (lib/birthday-card.js,
   the panel's own card), and the wish, from Maneka Sanjay Gandhi. The email
   worker runs every ten minutes on Firebase (functions/index.js), so the
   first run after 6 sends them; the runs after it find the day done.

   Once each: every greeting is queued under a key made of the day and the
   person (their email and name, not the directory's row number, which moves
   as people are added), so a second run, a second server or a press in the
   panel never sends a second card. A greeting the mail server would not take
   at once waits in the queue and the worker retries it, as every email does.

   Whoever gave no email is listed in the panel to greet by hand (the card
   to download, the wish to copy). If the morning's runs were missed
   altogether, nothing goes later in the day by itself: the panel shows
   "Not emailed" and its "Email the card" button sends it.

   PFA_BIRTHDAY_GREETINGS=off stops the morning send (the test suite sets
   it, as for the scheduled reports); the panel's button still works.

   The list is the People directory's (lib/people-directory.js): everyone who
   gave a date of birth on the donation, membership or internship forms. */

const crypto = require('crypto');
const D = require('./people-directory');

const IST_MS = 330 * 60000;
const HOUR = 6;               /* 6:00 to 6:59, India time */
const TEMPLATE = 'birthday_greeting';
const STATE = 'birthdayGreetings';
const LABEL = Object.fromEntries(D.CATEGORIES.map((c) => [c.key, c.label]));

function istDay(ms) { return new Date(ms + IST_MS).toISOString().slice(0, 10); }
function istHour(ms) { return new Date(ms + IST_MS).getUTCHours(); }
function leap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
function off() { return /^off$/i.test(String(process.env.PFA_BIRTHDAY_GREETINGS || '').trim()); }

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
      categories: (p.categories || []).map((c) => LABEL[c] || c)
    });
  }
  out.sort((a, b) => a.inDays - b.inDays || String(a.name).localeCompare(String(b.name)));
  return { today, people: out.filter((x) => x.inDays === 0), upcoming: out.filter((x) => x.inDays > 0) };
}

function validEmail(value) { return require('./caregiver').validEmail(String(value || '').trim()); }

/* who a greeting is for, the same on every run: the day, the email and the name */
function keyOf(p, day) {
  const who = `${String(p.email || '').trim().toLowerCase()}|${String(p.name || '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
  return `${day}:${crypto.createHash('sha256').update(who).digest('hex').slice(0, 24)}`;
}

/* where a greeting stands, from its row in the email queue:
   { state: 'sent' | 'queued' | 'failed' | 'none' | 'no-email', at } */
async function statusOf(db, p, day) {
  if (!validEmail(p.email)) return { state: 'no-email' };
  const store = require('./caregiver-store');
  const snap = await db.collection('caregiverEmails').doc(store.emailIdFor(TEMPLATE, keyOf(p, day))).get();
  if (!snap.exists) return { state: 'none' };
  const d = snap.data() || {};
  const status = String(d.status || '');
  const at = d.sentAt || d.updatedAt || d.createdAt || '';
  const iso = at && typeof at.toDate === 'function' ? at.toDate().toISOString() : (typeof at === 'string' ? at : '');
  return { state: status === 'sent' ? 'sent' : status === 'failed' ? 'failed' : 'queued', at: iso };
}

/* One greeting: queued once, sent now when mail is set up. */
async function greet(p, day, options) {
  const o = options || {};
  if (!validEmail(p.email)) return { state: 'no-email' };
  const site = require('./public-site').originOf(process.env.PFA_PUBLIC_SITE_URL) || 'https://peopleforanimalsindia.org';
  const send = o.send || require('./membership-notify').send;
  const r = await send({
    template: TEMPLATE,
    to: String(p.email).trim(),
    payload: { name: String(p.name || '').slice(0, 160), day, turns: Number(p.turns) || 0, siteUrl: site, by: o.by || 'schedule' },
    dedupeKey: keyOf(p, day),
    claimBy: 'birthday'
  });
  return { state: r.sent ? 'sent' : r.queued ? 'queued' : 'failed', reason: r.reason || '' };
}

/* The morning's step: the email worker calls it on every run. */
async function run({ db, nowMs = Date.now(), send, readPeople } = {}) {
  if (off() || istHour(nowMs) !== HOUR) return { state: 'not-due' };
  const day = istDay(nowMs);
  const ref = db.collection('counters').doc(STATE);
  const was = await ref.get();
  if (was.exists && (was.data() || {}).day === day && (was.data() || {}).done) return { state: 'done', day };
  const people = readPeople ? await readPeople(db) : await D.read(db);
  const list = birthdays(people, nowMs, 0).people;
  const outcome = { sent: 0, queued: 0, failed: 0, noEmail: 0 };
  for (const p of list) {
    let r;
    try { r = await greet(p, day, { send, by: 'schedule' }); } catch (error) { r = { state: 'failed' }; console.error('birthday greeting failed', String(error && error.message).slice(0, 200)); }
    if (r.state === 'sent') outcome.sent += 1;
    else if (r.state === 'queued') outcome.queued += 1;
    else if (r.state === 'no-email') outcome.noEmail += 1;
    else outcome.failed += 1;
  }
  /* a greeting that could not even be queued is tried again on the next run */
  await ref.set({ day, done: outcome.failed === 0, count: list.length, outcome, at: new Date(nowMs).toISOString() });
  return Object.assign({ state: 'ran', day, count: list.length }, outcome);
}

module.exports = { run, greet, statusOf, birthdays, birthdayIn, keyOf, istDay, istHour, HOUR, TEMPLATE };
