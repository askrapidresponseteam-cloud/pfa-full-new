'use strict';

/* The remote internship portal (owner, 1 Nov 2026: "Build a neat,
   state-of-the-art PFA internship portal with a dynamic weekly plan, intern
   dashboard, and admin evaluation panel. No OTP, paid authentication, paid
   attribution services, or additional cost to PFA or me").

   ACCESS. No signup and no password. Each approved intern is issued an
   Intern ID (PFA-IN- and six characters) and, once, a random ten digit
   access key. The key is shown on the onboarding page and never again:
   only its scrypt hash is kept. A mobile number is never the secret. A
   wrong key counts against the intern (five in a row lock the ID for
   15 minutes, doubling each time to a day) and against the address (a
   shared count across both servers). A session is a random token in an
   HttpOnly, Secure, SameSite=Strict cookie, kept as its hash, ended by
   signing out, by revoking, or by a new key (keyVersion). PFA can revoke an
   intern, or issue a new onboarding link after saying how it verified the
   person; both are in the audit log.

   PLAN. A batch has a start Monday and a plan of weeks and tasks, editable
   per batch. The default is the eight weeks on internship.html: five core
   tasks in weeks 1 to 5, three electives of seven in weeks 6 and 7, and the
   final review in week 8. A week's tasks are due on its Sunday, 23:59 IST.

   WORK. Per task: links, a note, and files (images or PDFs, one upload at a
   time, within the limits below). PFA accepts it with a score out of ten or
   asks for a revision with feedback; every step is kept in the task's
   history. An intern reads only their own work.

   ZERO COST. Firestore and the existing Storage bucket; if the bucket is not
   switched on, files up to 900 KB are kept in Firestore and anything larger
   is refused with a request for a link instead (Drive, YouTube), which
   always works. Limits per file, per task, per intern and in all, counted in
   intern_usage/all and shown in the panel. Nothing is ever deleted: a
   batch's files are emptied (file-store drop) a set time after it ends. */

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INTERN_ID = /^PFA-IN-[A-HJ-NP-Z2-9]{6}$/;
const CODE = /^PFA[A-HJ-NP-Z2-9]{5}$/;
const KEY = /^\d{10}$/;
const DAY = 86400000;
const IST_MS = 330 * 60000;

const LIMITS = {
  fileBytes: 3 * 1024 * 1024,         // one upload, under Vercel's 4.5 MB request cap once encoded
  firestoreFileBytes: 900 * 1024,     // when Storage is not switched on
  filesPerTask: 4,
  linksPerTask: 6,
  noteChars: 1500,
  filesPerIntern: 40,
  bytesPerIntern: 40 * 1024 * 1024,
  bytesInAll: 3 * 1024 * 1024 * 1024, // well inside the free 5 GB of Storage
  retentionDays: 180,
  sessionDays: 7,
  onboardDays: 7
};
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

const LOCK = { after: 5, baseMs: 15 * 60000, maxMs: DAY };

/* ---- the default plan (internship.html, word for word) ---------------- */

const DEFAULT_TASKS = [
  { key: 'law', kind: 'core', week: 1, title: 'Learn the law', goal: '4 laws', target: 4, need: 'Learn the four laws and pass the test.', proof: 'Your test result, and a few lines on each law in your own words.' },
  { key: 'map', kind: 'core', week: 2, title: 'Map your town or district', goal: '1 district', target: 1, need: 'Every vet, government vet centre, shelter, ABC centre and feeding spot, checked by a call.', proof: 'Your map or sheet, with photographs taken as they are, not staged.' },
  { key: 'rrt', kind: 'core', week: 3, title: 'Bring your town onto the RRT', goal: '50 people', target: 50, auto: 'rrt', need: 'Share your link to rapid-response.in; 50 people from your district join.', proof: 'Counted for you: only people who finish registering on the RRT app. A click or a visit to the store is not a join.' },
  { key: 'lawyer', kind: 'core', week: 4, title: 'Find a lawyer', goal: '1 lawyer', target: 1, need: 'Find and meet one in your district.', proof: 'Their name, practice and a note of the meeting.' },
  { key: 'film', kind: 'core', week: 5, title: 'A film for The Wall', goal: '1 film', target: 1, need: 'The idea, the script, then the shoot.', proof: 'A link to the film.' },
  { key: 'shelter', kind: 'elective', week: 6, title: 'Help at a shelter PFA knows', goal: '20 hours', target: 20, need: 'Hands-on help alongside the shelter\'s own staff.', proof: 'Hours signed off by the shelter or the nearest PFA unit.' },
  { key: 'paper', kind: 'elective', week: 6, title: 'Write for your local paper', goal: '1 article', target: 1, need: 'An awareness article in a newspaper where you live, reviewed by the PFA team before you send it.', proof: 'The published page, a clipping or a link, with its date.' },
  { key: 'rti', kind: 'elective', week: 6, title: 'Ask your town about its dogs', goal: '1 RTI', target: 1, need: 'An application under the Right to Information Act to your municipality.', proof: 'The acknowledgement number; the reply, when it comes.' },
  { key: 'cinekind', kind: 'elective', week: 6, title: 'Nominate three films for CineKind', goal: '3 films', target: 3, need: 'Three films that show animals truthfully, each nominated on the CineKind page.', proof: 'The three nomination numbers.' },
  { key: 'talk', kind: 'elective', week: 6, title: 'Give one talk', goal: '1 talk', target: 1, need: 'At a school, college or housing society, on kindness and the law.', proof: 'A photograph, and a note from the host with the number who came.' },
  { key: 'firstaid', kind: 'elective', week: 6, title: 'Animal first aid', goal: '1 module', target: 1, need: 'What to do in the first minutes, until help arrives.', proof: 'The module test, passed.' },
  { key: 'story', kind: 'elective', week: 6, title: 'Write your story', goal: '1 story', target: 1, need: 'One real story from your eight weeks, for the PFA site.', proof: 'Four to six hundred words, with photographs.' }
];

const DEFAULT_WEEKS = [
  { n: 1, title: 'Animal welfare laws', summary: 'Learn the four laws and pass the test.' },
  { n: 2, title: 'Map your district', summary: 'Every vet, government vet centre, shelter, ABC centre and feeding spot, checked by a call.' },
  { n: 3, title: 'Bring people onto the RRT', summary: 'Share your link to rapid-response.in; 50 people from your district join.' },
  { n: 4, title: 'A lawyer for animals', summary: 'Find and meet one in your district.' },
  { n: 5, title: 'Your film for The Wall', summary: 'The idea, the script, then the shoot.' },
  { n: 6, title: 'Your electives', summary: 'Start the three you chose.' },
  { n: 7, title: 'Your electives, done', summary: 'Every proof on the portal.' },
  { n: 8, title: 'Final review', summary: 'The last proofs checked by PFA, and the certificate issued.' }
];

/* Electives are due at the end of week 7, though they start in week 6. */
const ELECTIVE_DUE_WEEK = 7;

const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 200);
const cleanBlock = (v, n) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n || 1500);
const sha = (v) => crypto.createHash('sha256').update(String(v), 'utf8').digest('hex');

function randomChars(n) {
  let out = '';
  for (let i = 0; i < n; i += 1) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}
function newInternId() { return `PFA-IN-${randomChars(6)}`; }
function newReferralCode() { return `PFA${randomChars(5)}`; }
function newKey() {
  let k = String(crypto.randomInt(1, 10)); // never a leading zero
  for (let i = 0; i < 9; i += 1) k += String(crypto.randomInt(10));
  return k;
}
function newToken() { return crypto.randomBytes(32).toString('base64url'); }

/* ---- the key, kept as a hash ------------------------------------------- */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function hashKey(key) {
  const salt = crypto.randomBytes(16);
  const out = crypto.scryptSync(String(key), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${out.toString('base64')}`;
}

function keyMatches(key, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt' || !KEY.test(String(key || ''))) {
    /* the same work either way, so a missing intern answers no faster */
    crypto.scryptSync('0000000000', 'pfa-intern-dummy-salt', SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
    return false;
  }
  const want = Buffer.from(parts[3], 'base64');
  const got = crypto.scryptSync(String(key), Buffer.from(parts[2], 'base64'), want.length, { N: Number(parts[1]) || SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/* A mobile number, for the self-referral check only: the last ten digits,
   hashed, the same way the RRT hashes its own registrations. */
function mobileHash(mobile) {
  const digits = String(mobile || '').replace(/\D+/g, '').slice(-10);
  return digits.length === 10 ? sha(`rrt-mobile:${digits}`) : '';
}

/* ---- the calendar, India time ------------------------------------------ */

function istDay(ms) {
  const d = new Date(Number(ms) + IST_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate(), dow: d.getUTCDay() };
}
function dayStart(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - IST_MS;
}
function ymdOf(ms) {
  const p = istDay(ms);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayLabel(ms) {
  const p = istDay(ms);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.dow]} ${p.day} ${MONTHS[p.m - 1]}`;
}

/* week n of a batch: Monday 00:00 to the next Monday 00:00 IST; due the
   instant before it ends (Sunday 23:59:59) */
function weekBounds(batch, n) {
  const start = dayStart(batch.startDate);
  const from = start + (n - 1) * 7 * DAY;
  return { from, to: from + 7 * DAY, due: from + 7 * DAY - 1000 };
}
function dueWeekOf(task) { return task.kind === 'elective' ? Math.max(Number(task.week) || 6, ELECTIVE_DUE_WEEK) : Number(task.week) || 1; }

/* Which week of its plan a batch is in now: 0 before it starts, weeks+1 after */
function currentWeek(batch, nowMs) {
  const start = dayStart(batch.startDate);
  if (!Number.isFinite(start) || nowMs < start) return 0;
  const n = Math.floor((nowMs - start) / (7 * DAY)) + 1;
  return Math.min(n, (batch.weeks || []).length + 1);
}

/* ---- batches ------------------------------------------------------------ */

function defaultPlan() {
  return {
    weeks: DEFAULT_WEEKS.map((w) => Object.assign({}, w)),
    tasks: DEFAULT_TASKS.map((t) => Object.assign({}, t)),
    electivesRequired: 3
  };
}

/* A plan as an admin sent it, made safe: known shapes only, sensible caps. */
function cleanPlan(input) {
  const base = defaultPlan();
  const p = input && typeof input === 'object' ? input : {};
  const weeks = Array.isArray(p.weeks) && p.weeks.length ? p.weeks.slice(0, 16).map((w, i) => ({
    n: i + 1, title: clean(w && w.title, 80) || `Week ${i + 1}`, summary: clean(w && w.summary, 240)
  })) : base.weeks;
  const seen = new Set();
  const tasks = (Array.isArray(p.tasks) && p.tasks.length ? p.tasks.slice(0, 30) : base.tasks).map((t) => {
    const key = clean(t && t.key, 24).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
    if (!key || seen.has(key)) return null;
    seen.add(key);
    const week = Math.min(Math.max(Math.round(Number(t.week) || 1), 1), weeks.length);
    return {
      key, kind: t.kind === 'elective' ? 'elective' : 'core', week,
      title: clean(t.title, 80) || key, goal: clean(t.goal, 40), target: Math.max(0, Math.min(Math.round(Number(t.target) || 0), 10000)),
      need: clean(t.need, 300), proof: clean(t.proof, 300), auto: t.auto === 'rrt' ? 'rrt' : undefined
    };
  }).filter(Boolean).map((t) => { if (!t.auto) delete t.auto; return t; });
  const electives = tasks.filter((t) => t.kind === 'elective').length;
  const electivesRequired = Math.min(Math.max(Math.round(Number(p.electivesRequired == null ? base.electivesRequired : p.electivesRequired)), 0), electives);
  return { weeks, tasks, electivesRequired };
}

function batchView(batch, nowMs) {
  const b = batch || {};
  const weeks = (b.weeks || []).map((w) => {
    const wb = weekBounds(b, w.n);
    return Object.assign({}, w, { from: ymdOf(wb.from), due: new Date(wb.due).toISOString(), dueLabel: `${dayLabel(wb.due)}, 11:59 pm` });
  });
  const tasks = (b.tasks || []).map((t) => {
    const wb = weekBounds(b, dueWeekOf(t));
    return Object.assign({}, t, { dueWeek: dueWeekOf(t), due: new Date(wb.due).toISOString(), dueLabel: `${dayLabel(wb.due)}, 11:59 pm` });
  });
  return {
    batchId: b.batchId, name: b.name, startDate: b.startDate, status: b.status || 'open',
    electivesRequired: Number(b.electivesRequired) || 0, weeks, tasks, week: currentWeek(b, nowMs),
    endsOn: weeks.length ? ymdOf(weekBounds(b, weeks.length).due) : b.startDate
  };
}

/* ---- progress ----------------------------------------------------------- */

/* One intern's standing: every task with its state, the electives chosen,
   and the share of the required work that is accepted. */
function progressOf(batch, intern, works, referral) {
  const byTask = new Map((works || []).map((w) => [w.taskKey, w]));
  const chosen = Array.isArray(intern.electives) ? intern.electives : [];
  const tasks = (batch.tasks || []).map((t) => {
    const w = byTask.get(t.key) || null;
    let count = null;
    if (t.auto === 'rrt') count = Number((referral || {}).registrations) || 0;
    return {
      key: t.key, kind: t.kind, title: t.title, goal: t.goal, target: t.target, auto: t.auto || '', dueWeek: dueWeekOf(t),
      chosen: t.kind === 'core' || chosen.includes(t.key),
      state: w ? w.state : 'todo', score: w && w.score != null ? w.score : null, round: w ? w.round || 1 : 0,
      count
    };
  });
  const core = tasks.filter((t) => t.kind === 'core');
  const electives = tasks.filter((t) => t.kind === 'elective' && t.chosen);
  const need = core.length + (Number(batch.electivesRequired) || 0);
  const accepted = core.filter((t) => t.state === 'accepted').length
    + Math.min(electives.filter((t) => t.state === 'accepted').length, Number(batch.electivesRequired) || 0);
  const scored = tasks.filter((t) => t.score != null);
  return {
    tasks, need, accepted, percent: need ? Math.round((accepted / need) * 100) : 0,
    complete: need > 0 && accepted >= need,
    waiting: tasks.filter((t) => t.state === 'submitted').length,
    revise: tasks.filter((t) => t.state === 'revise').length,
    average: scored.length ? Math.round((scored.reduce((s, t) => s + Number(t.score), 0) / scored.length) * 10) / 10 : null
  };
}

/* ---- what the intern is shown about themselves -------------------------- */

function internView(intern) {
  const i = intern || {};
  return {
    internId: i.internId, name: i.name, batchId: i.batchId, status: i.status,
    referralCode: i.referralCode, electives: Array.isArray(i.electives) ? i.electives : []
  };
}

/* A work record as its intern sees it (and as the panel does, plus who
   reviewed it). */
function workView(w, forAdmin) {
  const out = {
    taskKey: w.taskKey, state: w.state, round: w.round || 1, links: w.links || [], note: w.note || '',
    files: (w.files || []).map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size })),
    submittedAt: w.submittedAt || '', reviewedAt: w.reviewedAt || '', score: w.score != null ? w.score : null, feedback: w.feedback || '',
    history: (w.history || []).slice(-20).map((h) => {
      const x = { at: h.at, state: h.state, note: h.note || '', score: h.score != null ? h.score : null };
      if (forAdmin) x.by = h.by || '';
      return x;
    })
  };
  if (forAdmin) Object.assign(out, { internId: w.internId, batchId: w.batchId, reviewedBy: w.reviewedBy || '' });
  return out;
}

function referralLink(code) {
  const base = String(process.env.PFA_RRT_SITE || 'https://rapid-response.in').replace(/\/+$/, '');
  return `${base}/r/${encodeURIComponent(code)}`;
}

/* ---- links a person may send as proof ----------------------------------- */

function cleanLinks(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const v = clean(raw, 500);
    if (!v) continue;
    let u;
    try { u = new URL(v); } catch (_) { return { error: `"${v.slice(0, 60)}" is not a web address. Start it with https://` }; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Only web links (https://) can be sent.' };
    if (!out.includes(u.href)) out.push(u.href);
  }
  if (out.length > LIMITS.linksPerTask) return { error: `Up to ${LIMITS.linksPerTask} links for one task.` };
  return { links: out };
}

function fileTypeOf(type, bytes) {
  const t = String(type || '').toLowerCase();
  if (!TYPES[t] || !bytes || bytes.length < 4) return '';
  const b = bytes;
  if (t === 'application/pdf') return b.slice(0, 4).toString('latin1') === '%PDF' ? t : '';
  if (t === 'image/png') return b[0] === 0x89 && b[1] === 0x50 ? t : '';
  if (t === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 ? t : '';
  if (t === 'image/webp') return b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP' ? t : '';
  return '';
}

module.exports = {
  ALPHABET, INTERN_ID, CODE, KEY, LIMITS, LOCK, TYPES, DAY,
  DEFAULT_TASKS, DEFAULT_WEEKS, ELECTIVE_DUE_WEEK,
  clean, cleanBlock, sha, newInternId, newReferralCode, newKey, newToken, hashKey, keyMatches, mobileHash,
  istDay, dayStart, ymdOf, dayLabel, weekBounds, dueWeekOf, currentWeek,
  defaultPlan, cleanPlan, batchView, progressOf, internView, workView, referralLink, cleanLinks, fileTypeOf
};
