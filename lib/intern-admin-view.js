'use strict';

/* The internship in the panel, intern by intern (owner, 3 Nov 2026: "the
   admin panel needs to have the whole internship management module
   comprehensive, that is aligned with the end user site's remote internship
   program"). Read only: what the routes and the portal wrote, put side by
   side.

   Every intern, across every batch: who they are and how to reach them
   (email, mobile, and the town, college and other answers from their
   application), their batch and its week, each of the eight tasks with its
   state and score, the law quiz (best, attempts, pass), where they do their
   shelter work and the hours they logged, their RRT counts, and their
   certificate when one is issued. One intern opens to all of it, with every
   piece of work and its history. The same list downloads for Excel. */

const I = require('./internship');
const S = require('./intern-store');
const Q = require('./intern-quiz');
const SH = require('./intern-shelters');

const clean = (v, n) => I.clean(v, n);

/* What they wrote on their application, by its question. */
async function applicationOf(db, ref) {
  if (!ref) return null;
  const snap = await db.collection('submissions').doc(String(ref)).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  const f = d.fields || {};
  const pick = (re) => { const k = Object.keys(f).find((x) => re.test(x)); return k ? clean(f[k], 300) : ''; };
  return {
    reference: snap.id, receivedAt: d.createdAt || '',
    mobile: pick(/^(mobile|phone|whatsapp)$/i), city: pick(/^(city|town)$/i), district: pick(/^district$/i), state: pick(/^state$/i),
    college: pick(/college|institution|university|school/i), course: pick(/course|degree|year|study/i), age: pick(/^age$/i),
    answers: Object.keys(f).filter((k) => !/^(name|full ?name|e-?mail|mobile|phone|whatsapp|terms|consent|documents?)$/i.test(k))
      .slice(0, 30).map((k) => ({ q: k, a: clean(f[k], 600) })).filter((x) => x.a)
  };
}

/* Issued certificates, by the email or the name on them. */
async function certificatesBy(db) {
  const snap = await db.collection('certificates').get();
  const byEmail = new Map();
  const byName = new Map();
  for (const doc of snap.docs || []) {
    const c = doc.data() || {};
    if (c.withdrawn) continue;
    const x = { number: c.number || doc.id, issuedOn: c.issuedOn || '', emailedTo: ((c.sends || []).filter((s) => s.state === 'sent').slice(-1)[0] || {}).to || '' };
    if (c.email) byEmail.set(String(c.email).toLowerCase(), x);
    if (c.name) byName.set(String(c.name).toLowerCase().replace(/\s+/g, ' ').trim(), x);
  }
  return (intern) => byEmail.get(String(intern.email || '').toLowerCase()) || byName.get(String(intern.name || '').toLowerCase().replace(/\s+/g, ' ').trim()) || null;
}

function quizLine(attempts) {
  const done = attempts.filter((a) => a.state === 'done' && a.result);
  const best = Q.bestOf(attempts);
  return {
    attempts: done.length, open: attempts.some((a) => a.state === 'open'),
    best: best ? best.result.percent : null, passed: Boolean(best && best.result.pass), max: Q.MAX_ATTEMPTS
  };
}

async function placeLine(db, internId) {
  const p = await db.collection(SH.PLACES).doc(internId).get();
  if (!p.exists) return null;
  const pd = p.data() || {};
  const s = pd.shelterId ? await db.collection(SH.SHELTERS).doc(pd.shelterId).get() : null;
  const e = s && s.exists ? s.data() || {} : {};
  return { shelterId: pd.shelterId, state: pd.state, changeReason: pd.changeReason || '', registeredAt: pd.registeredAt, name: e.name || '', city: (e.address || {}).city || '', district: (e.address || {}).district || '', status: e.status || '', phone: e.phone || '' };
}

/* Every intern, every batch: the panel's Interns list. */
async function register(db, nowMs = Date.now()) {
  const batches = new Map((await S.listBatches(db)).map((b) => [b.batchId, b]));
  const interns = (await S.listInterns(db)).filter((i) => i.status !== 'reserving');
  const certOf = await certificatesBy(db);
  const rows = [];
  for (const i of interns) {
    const batch = batches.get(i.batchId) || null;
    const works = await S.listWorks(db, i.internId);
    const p = batch ? I.progressOf(batch, i, works, i.referral || {}) : null;
    const app = await applicationOf(db, i.applicationRef);
    const shelterWork = works.find((w) => w.taskKey === SH.TASK);
    rows.push({
      internId: i.internId, name: i.name, email: i.email, mobile: clean(i.mobile, 20) || (app && app.mobile) || '',
      town: app ? [app.city, app.district, app.state].filter(Boolean).join(', ') : '', college: app ? app.college : '',
      status: i.status, batchId: i.batchId, batch: batch ? batch.name : '', week: batch ? I.currentWeek(batch, nowMs, i) : 0, endsOn: batch ? I.ymdOf(I.timeline(batch, i).endMs()) : '', weeks: batch ? (batch.weeks || []).length : 0,
      applicationRef: i.applicationRef || '', createdAt: i.createdAt || '', lastSignInAt: i.lastSignInAt || '',
      progress: p ? { percent: p.percent, accepted: p.accepted, need: p.need, waiting: p.waiting, revise: p.revise, complete: p.complete, average: p.average, tasks: p.tasks.filter((t) => t.chosen).map((t) => ({ key: t.key, title: t.title, state: t.state, score: t.score })) } : null,
      quiz: quizLine(await Q.listAttempts(db, i.internId)),
      place: await placeLine(db, i.internId),
      hours: shelterWork ? Number(shelterWork.hours) || 0 : 0,
      rrt: Number((i.referral || {}).registrations) || 0,
      certificate: certOf(i)
    });
  }
  rows.sort((a, b) => String(a.batch).localeCompare(String(b.batch)) || String(a.name).localeCompare(String(b.name)));
  return rows;
}

/* One intern, all of it. */
async function detail(db, internId, nowMs = Date.now()) {
  const intern = await S.getIntern(db, String(internId || '').toUpperCase());
  if (!intern) { const e = new Error('That intern is not on record.'); e.code = 'NO_INTERN'; e.status = 404; throw e; }
  const batch = await S.getBatch(db, intern.batchId);
  const works = await S.listWorks(db, intern.internId);
  const app = await applicationOf(db, intern.applicationRef);
  const attempts = await Q.listAttempts(db, intern.internId);
  const place = await placeLine(db, intern.internId);
  const placeDoc = await db.collection(SH.PLACES).doc(intern.internId).get();
  const certOf = await certificatesBy(db);
  const tasks = batch ? (batch.tasks || []) : [];
  return {
    contact: { name: intern.name, email: intern.email, mobile: clean(intern.mobile, 20) || (app && app.mobile) || '', dob: intern.dob || '', status: intern.status, town: app ? [app.city, app.district, app.state].filter(Boolean).join(', ') : '', college: app ? app.college : '', course: app ? app.course : '' },
    application: app,
    batch: batch ? I.batchView(batch, nowMs, intern) : null,
    works: works.map((w) => Object.assign(I.workView(w, true), { hours: w.hours != null ? w.hours : null, title: (tasks.find((t) => t.key === w.taskKey) || {}).title || w.taskKey })),
    quiz: { line: quizLine(attempts), attempts: attempts.filter((a) => a.state === 'done').map(Q.resultView) },
    place: place ? Object.assign(place, { history: ((placeDoc.data() || {}).history || []).slice(-20) }) : null,
    certificate: certOf(intern),
    referral: Object.assign({ code: intern.referralCode, link: I.referralLink(intern.referralCode) }, intern.referral || {})
  };
}

function csvOf(rows) {
  const cell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const STATE = { todo: 'To do', submitted: 'Waiting for review', revise: 'Revise', accepted: 'Accepted' };
  const titles = [];
  rows.forEach((r) => ((r.progress || {}).tasks || []).forEach((t) => { if (!titles.includes(t.title)) titles.push(t.title); }));
  const head = ['Intern', 'Intern ID', 'Email', 'Mobile', 'Town', 'College', 'Batch', 'Week', 'Status', 'Done', 'Percent'].concat(titles, ['Quiz best', 'Quiz attempts', 'Shelter', 'Shelter town', 'Hours', 'RRT joins', 'Certificate', 'Application']);
  const lines = [head.map(cell).join(',')].concat(rows.map((r) => {
    const p = r.progress || { tasks: [] };
    const byTitle = new Map(p.tasks.map((t) => [t.title, t]));
    return [r.name, r.internId, r.email, r.mobile, r.town, r.college, r.batch, r.week, r.status, p.accepted != null ? `${p.accepted}/${p.need}` : '', p.percent != null ? p.percent : '']
      .concat(titles.map((t) => { const x = byTitle.get(t); return x ? `${STATE[x.state] || x.state}${x.score != null ? ` ${x.score}/10` : ''}` : ''; }))
      .concat([r.quiz.best != null ? `${r.quiz.best}%${r.quiz.passed ? ' pass' : ''}` : '', r.quiz.attempts, r.place ? r.place.name : '', r.place ? r.place.city : '', r.hours || '', r.rrt, r.certificate ? r.certificate.number : '', r.applicationRef])
      .map(cell).join(',');
  }));
  return Buffer.from(`\ufeff${lines.join('\r\n')}\r\n`, 'utf8');
}

module.exports = { applicationOf, register, detail, csvOf };
