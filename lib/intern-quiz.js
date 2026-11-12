'use strict';

/* The internship quiz (owner, 2 Nov 2026: "quiz module should be [exam]
   grade"; 3 Nov 2026: "Make the 10 common incidents (animal related and
   animal laws) quiz. questions be me overall 30 in total. update time . and
   do a mix and it has to be [exam] standard, no less").

   THE TEST. Week 1's task, "Learn the law", is passed by this quiz, taken in
   the intern portal. 30 questions (lib/intern-quiz-bank.js) on ten common
   incidents, three each, one easy, one medium and one hard, in one mixed
   order: the incidents and the levels come shuffled together, afresh for
   every attempt, and so do the choices within each question (except data
   sufficiency, whose A to E order is standard). One question at a time,
   five choices, one best answer. As in a competitive exam, an answer is final once
   confirmed: there is no going back.

   TIME. 60 minutes on the server's clock, two a question, a competitive exam's pace,
   from the moment the attempt starts. Closing the page does not stop it;
   the intern can come back and carry on within the time. When time runs
   out, what was answered is marked and the rest count as wrong.

   MARKS. Easy 1, medium 2, hard 3: 60 in all. A pass is 60 percent (36
   marks). Three attempts, at least a day apart; the best counts. A pass
   marks the law task accepted, with a score out of ten (the percent / 10,
   to the nearest half), in the task's history "by quiz". Three attempts
   without a pass send the best one to PFA's review queue, where PFA
   decides. An attempt made on the bank of 2 Nov 2026 (55 questions, 125
   marks) is marked out of its own total.

   PRACTICE. Seven questions that are never in the quiz, open to anyone
   without signing in (assets/law-quiz-sample.js), so an intern knows what
   the real one is like before it counts.

   WHAT THE INTERN SEES. Never an answer while an attempt is open: the
   browser gets the question and its choices, nothing else. After each
   attempt, the score by level and by incident. The full review, every
   question with the right answer and why, once they pass or have used
   every attempt.

   WHAT PFA SEES. Every attempt, finished, in the Monday email to gandhim
   (lib/quiz-report.js), and the law task's state in the panel. */

const crypto = require('crypto');
const BANK = require('./intern-quiz-bank');
const I = require('./internship');

const COLLECTION = 'intern_quiz';
const MINUTES = 60;
const PASS = 60;
const MAX_ATTEMPTS = 3;
const GAP_MS = 24 * 3600 * 1000;
const GRACE_MS = 20 * 1000; // an answer sent in the last seconds, still on its way
const SECTIONS = ['easy', 'medium', 'hard'];
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

/* every question an attempt may hold: today's, and the retired bank's for
   attempts begun on it (the practice ones are never served) */
const BY_ID = new Map(BANK.RETIRED.concat(BANK.QUESTIONS).map((q) => [q.id, q]));
const MAX_POINTS = BANK.QUESTIONS.reduce((n, q) => n + BANK.POINTS[q.level], 0);
const maxOf = (order) => order.reduce((n, id) => n + BANK.POINTS[BY_ID.get(id).level], 0);

function fail(code, message, status) {
  const e = new Error(message);
  e.code = code;
  e.status = status || 400;
  return e;
}

const nowIso = (ms) => new Date(ms).toISOString();
const attemptId = (internId, n) => `${internId}__q${n}`;

/* Is this task the quiz? New plans say so (auto: 'quiz'). A batch made
   from the standard plan of 2 Nov 2026, before the quiz, has the law task
   with its ten written answers ('10 answers'); the quiz passes that one
   too. A batch's own plan with some other law task keeps its proof. */
function isQuizTask(t) { return Boolean(t) && (t.auto === 'quiz' || (t.key === 'law' && t.goal === '10 answers')); }
function quizTaskOf(batch) { return ((batch && batch.tasks) || []).find(isQuizTask) || null; }

function shuffle(list, rnd) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* A fresh order: all thirty mixed, incidents and levels together; and for
   each question the order its choices are shown in (original indices). */
function newPaper(rnd) {
  const r = rnd || ((n) => crypto.randomInt(n));
  const order = shuffle(BANK.QUESTIONS, r).map((q) => q.id);
  const perm = {};
  for (const id of order) {
    const q = BY_ID.get(id);
    const idx = q.choices.map((_, i) => i);
    perm[id] = q.fixed ? idx : shuffle(idx, r);
  }
  return { order, perm };
}

/* where a question sits: its level, and the incident it is about */
function sectionOf(order, i) {
  const q = BY_ID.get(order[i]);
  return { level: q.level, label: BANK.LEVELS[q.level], incident: BANK.TOPICS[q.topic] || '', points: BANK.POINTS[q.level] };
}

/* The question as the browser gets it: no answer, no explanation. */
function questionView(a, i) {
  const id = a.order[i];
  const q = BY_ID.get(id);
  const perm = a.perm[id];
  return {
    qid: id, index: i + 1, total: a.order.length, section: sectionOf(a.order, i),
    text: q.q, choices: perm.map((orig, k) => ({ key: LETTERS[k], text: q.choices[orig] })),
    dataSufficiency: Boolean(q.fixed)
  };
}

function answeredCount(a) { return a.order.filter((id) => a.answers && a.answers[id] != null).length; }

/* Marks for a finished (or timed-out) attempt. */
function grade(a, finishedMs, timedOut) {
  let points = 0;
  const byLevel = {};
  const byTopic = {};
  for (const level of SECTIONS) byLevel[level] = { right: 0, of: 0, points: 0, max: 0 };
  for (const id of a.order) {
    const q = BY_ID.get(id);
    const got = a.answers && a.answers[id];
    const right = got === q.answer;
    const p = BANK.POINTS[q.level];
    const L = byLevel[q.level];
    L.of += 1; L.max += p;
    if (right) { L.right += 1; L.points += p; points += p; }
    const T = byTopic[q.topic] || (byTopic[q.topic] = { right: 0, of: 0 });
    T.of += 1;
    if (right) T.right += 1;
  }
  const max = maxOf(a.order);
  const percent = Math.round((points / max) * 1000) / 10;
  return {
    points, max, percent, pass: percent >= PASS,
    byLevel, byTopic, answered: answeredCount(a),
    seconds: Math.max(0, Math.round((Math.min(finishedMs, a.deadlineMs) - a.startedMs) / 1000)),
    timedOut: Boolean(timedOut)
  };
}

/* ---- reading -------------------------------------------------------------- */

async function listAttempts(db, internId) {
  const snap = await db.collection(COLLECTION).where('internId', '==', internId).get();
  return (snap.docs || []).map((d) => d.data() || {}).sort((x, y) => x.n - y.n);
}

function bestOf(attempts) {
  return attempts.filter((a) => a.state === 'done' && a.result)
    .reduce((b, a) => (!b || a.result.percent > b.result.percent ? a : b), null);
}

function resultView(a) {
  if (!a || !a.result) return null;
  const r = a.result;
  return {
    n: a.n, finishedAt: a.finishedAt, percent: r.percent, points: r.points, max: r.max, pass: r.pass,
    answered: r.answered, seconds: r.seconds, timedOut: r.timedOut,
    byLevel: SECTIONS.map((l) => ({ level: l, label: BANK.LEVELS[l], right: r.byLevel[l].right, of: r.byLevel[l].of })),
    byTopic: Object.keys(BANK.TOPICS).filter((t) => r.byTopic[t]).map((t) => ({ topic: t, label: BANK.TOPICS[t], right: r.byTopic[t].right, of: r.byTopic[t].of }))
  };
}

/* Every question, the intern's answer and the right one, with why. Only
   once they have passed or have no attempts left; from their best attempt. */
function reviewOf(a) {
  return a.order.map((id, i) => {
    const q = BY_ID.get(id);
    const perm = a.perm[id];
    const got = a.answers ? a.answers[id] : null;
    return {
      index: i + 1, level: BANK.LEVELS[q.level], topic: BANK.TOPICS[q.topic], text: q.q,
      choices: perm.map((orig, k) => ({ key: LETTERS[k], text: q.choices[orig], right: orig === q.answer, chosen: orig === got, why: (q.explain && q.explain[orig]) || '' })),
      right: got === q.answer, why: q.why, risk: q.risk || ''
    };
  });
}

/* What the dashboard shows about the quiz. Finishes an attempt whose time
   is up first, so a closed tab still gets its marks. */
async function summary(db, intern, nowMs, deps = {}) {
  let attempts = await listAttempts(db, intern.internId);
  const open = attempts.find((a) => a.state === 'open');
  if (open && nowMs > open.deadlineMs + GRACE_MS) {
    await finish(db, intern, open.attemptId, nowMs, deps);
    attempts = await listAttempts(db, intern.internId);
  }
  const done = attempts.filter((a) => a.state === 'done');
  const best = bestOf(attempts);
  const passed = Boolean(best && best.result.pass);
  const last = done[done.length - 1];
  const nextAt = last ? Date.parse(last.finishedAt) + GAP_MS : 0;
  const still = attempts.find((a) => a.state === 'open') || null;
  const left = MAX_ATTEMPTS - attempts.length;
  return {
    count: BANK.QUESTIONS.length, minutes: MINUTES, passMark: PASS, maxAttempts: MAX_ATTEMPTS,
    sections: SECTIONS.map((l) => ({ level: l, label: BANK.LEVELS[l], count: BANK.QUESTIONS.filter((q) => q.level === l).length, points: BANK.POINTS[l] })),
    incidents: BANK.INCIDENTS.map(([key, label]) => ({ key, label, count: BANK.QUESTIONS.filter((q) => q.topic === key).length })),
    maxPoints: MAX_POINTS,
    attempts: done.map(resultView),
    best: resultView(best), passed, left,
    open: still ? { attemptId: still.attemptId, n: still.n, deadline: nowIso(still.deadlineMs), answered: answeredCount(still) } : null,
    canStart: !still && !passed && left > 0 && (!last || nowMs >= nextAt),
    nextAt: !passed && left > 0 && last && nowMs < nextAt ? nowIso(nextAt) : '',
    review: (passed || left <= 0) && best ? reviewOf(best) : null
  };
}

/* ---- the attempt ---------------------------------------------------------- */

async function start(db, intern, batch, nowMs, deps = {}) {
  if (!quizTaskOf(batch)) throw fail('NO_QUIZ', 'Your plan has no quiz.', 404);
  if (I.currentWeek(batch, nowMs) < 1) throw fail('NOT_STARTED', `The quiz opens when your internship starts, on ${I.dayLabel(I.dayStart(batch.startDate))}.`, 409);
  const s = await summary(db, intern, nowMs, deps);
  if (s.open) return current(db, intern, s.open.attemptId, nowMs);
  if (s.passed) throw fail('PASSED', 'You have passed the quiz. Nothing more is needed.', 409);
  if (s.left <= 0) throw fail('NO_ATTEMPTS', `All ${MAX_ATTEMPTS} attempts are used. PFA will review your best one.`, 409);
  if (!s.canStart) throw fail('TOO_SOON', `Your next attempt opens ${I.dayLabel(Date.parse(s.nextAt))} at ${timeOf(Date.parse(s.nextAt))}.`, 409);
  const n = MAX_ATTEMPTS - s.left + 1;
  const id = attemptId(intern.internId, n);
  const paper = newPaper(deps.random);
  const ref = db.collection(COLLECTION).doc(id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) throw fail('BUSY', 'That attempt has already started. Reload the page.', 409);
    tx.set(ref, {
      attemptId: id, internId: intern.internId, name: intern.name || '', batchId: intern.batchId || '', n,
      state: 'open', startedAt: nowIso(nowMs), startedMs: nowMs, deadlineMs: nowMs + MINUTES * 60000,
      order: paper.order, perm: paper.perm, answers: {}, answeredAt: {}
    });
  });
  return current(db, intern, id, nowMs);
}

function timeOf(ms) {
  const d = new Date(ms + 330 * 60000);
  const h = d.getUTCHours();
  return `${((h + 11) % 12) + 1}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

async function load(db, internId, id) {
  const snap = await db.collection(COLLECTION).doc(String(id || '')).get();
  const a = snap.exists ? snap.data() || {} : null;
  if (!a || a.internId !== internId) throw fail('NOT_FOUND', 'That attempt is not yours.', 404);
  return a;
}

/* Where an open attempt stands: the next question and the time left. */
async function current(db, intern, id, nowMs) {
  const a = await load(db, intern.internId, id);
  if (a.state !== 'open') return { state: 'done', attemptId: a.attemptId };
  const i = answeredCount(a);
  return {
    state: 'open', attemptId: a.attemptId, n: a.n, deadline: nowIso(a.deadlineMs),
    secondsLeft: Math.max(0, Math.round((a.deadlineMs - nowMs) / 1000)), answered: i,
    question: i < a.order.length ? questionView(a, i) : null
  };
}

/* One answer, final. It must be for the question now showing; a second
   send of the same answer (a retried request) is taken as already done. */
async function answer(db, intern, input, nowMs, deps = {}) {
  const id = String((input && input.attemptId) || '');
  const qid = String((input && input.qid) || '');
  const pick = String((input && input.choice) || '').toUpperCase();
  const k = LETTERS.indexOf(pick);
  if (k < 0) throw fail('NO_CHOICE', 'Choose one answer.');
  const ref = db.collection(COLLECTION).doc(id);
  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const a = snap.exists ? snap.data() || {} : null;
    if (!a || a.internId !== intern.internId) throw fail('NOT_FOUND', 'That attempt is not yours.', 404);
    if (a.state !== 'open') return { finished: true };
    if (nowMs > a.deadlineMs + GRACE_MS) return { timeUp: true };
    const answers = Object.assign({}, a.answers || {});
    if (answers[qid] != null) return { again: true };
    const i = answeredCount(a);
    if (a.order[i] !== qid) throw fail('NOT_NOW', 'That question is not the one showing. Reload the page.', 409);
    answers[qid] = a.perm[qid][k];
    const answeredAt = Object.assign({}, a.answeredAt || {}, { [qid]: nowIso(nowMs) });
    tx.set(ref, { answers, answeredAt }, { merge: true });
    return { last: i + 1 >= a.order.length };
  });
  if (out.finished) return { state: 'done', attemptId: id };
  if (out.timeUp || out.last) {
    await finish(db, intern, id, nowMs, deps);
    return { state: 'done', attemptId: id, timeUp: Boolean(out.timeUp) };
  }
  return current(db, intern, id, nowMs);
}

/* Mark an attempt, once; then the law task. */
async function finish(db, intern, id, nowMs, deps = {}) {
  const ref = db.collection(COLLECTION).doc(id);
  const done = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const a = snap.exists ? snap.data() || {} : null;
    if (!a || a.internId !== intern.internId) throw fail('NOT_FOUND', 'That attempt is not yours.', 404);
    if (a.state !== 'open') return null;
    const timedOut = nowMs > a.deadlineMs;
    const result = grade(a, nowMs, timedOut && answeredCount(a) < a.order.length);
    const patch = { state: 'done', finishedAt: nowIso(Math.min(nowMs, a.deadlineMs)), finishedMs: Math.min(nowMs, a.deadlineMs), result };
    tx.set(ref, patch, { merge: true });
    return Object.assign({}, a, patch);
  });
  if (done) {
    await recordOnTask(db, intern, done, nowMs, deps);
    await mailResult(db, intern, done, nowMs, deps);
  }
  return done;
}

/* Each attempt's marks, to the intern who took it (owner, 3 Nov 2026: "hope
   quiz results get emailed to gandhim as well as one taking it"). Once per
   attempt; PFA's copy is the Monday email to gandhim (lib/quiz-report.js).
   No answers in it: those open in the dashboard once they pass or have used
   every attempt, as on screen. A mail that cannot go is logged, never in the
   way of the marks. */
async function mailResult(db, intern, a, nowMs, deps = {}) {
  try {
    const S = deps.store || require('./intern-store');
    const who = (await S.getIntern(db, intern.internId)) || intern;
    if (!who.email) return;
    const attempts = await listAttempts(db, intern.internId);
    const doneN = attempts.filter((x) => x.state === 'done').length;
    const best = bestOf(attempts);
    const left = Math.max(0, MAX_ATTEMPTS - attempts.length);
    const passedNow = Boolean(best && best.result.pass);
    const nextMs = Date.parse(a.finishedAt) + GAP_MS;
    const r = a.result;
    const L = (l) => `${r.byLevel[l].right} of ${r.byLevel[l].of}`;
    await S.mailNow({
      template: 'intern_quiz_result', to: who.email, dedupeKey: a.attemptId,
      payload: {
        name: who.name || '', n: a.n, of: MAX_ATTEMPTS, percent: r.percent, points: r.points, max: r.max, pass: r.pass, passMark: PASS,
        easy: L('easy'), medium: L('medium'), hard: L('hard'), minutes: Math.round(r.seconds / 60), answered: r.answered, count: a.order.length,
        timedOut: Boolean(r.timedOut), passedBefore: passedNow && !r.pass, best: best ? best.result.percent : r.percent,
        left: passedNow ? 0 : left, next: !passedNow && left > 0 ? `${I.dayLabel(nextMs)}, ${timeOf(nextMs)}` : '',
        lastAttempt: !passedNow && doneN >= MAX_ATTEMPTS,
        link: S.dashboardUrl(), siteUrl: S.publicSite()
      },
      mail: deps.mail, queue: deps.queue
    });
  } catch (error) {
    console.warn('quiz result mail not sent', a && a.attemptId, error && error.message);
  }
}

/* The law task: accepted on a pass; after the last attempt without one,
   the best attempt goes to PFA's review queue. */
async function recordOnTask(db, intern, a, nowMs, deps = {}) {
  const S = deps.store || require('./intern-store');
  const batch = await S.getBatch(db, intern.batchId);
  const task = quizTaskOf(batch);
  if (!task) return;
  const attempts = await listAttempts(db, intern.internId);
  const best = bestOf(attempts);
  const usedUp = attempts.filter((x) => x.state === 'done').length >= MAX_ATTEMPTS;
  if (!a.result.pass && !usedUp) return;
  const r = best.result;
  const pass = r.pass;
  const note = `Quiz: ${r.percent} percent (${r.points} of ${r.max} marks), attempt ${best.n} of ${MAX_ATTEMPTS}. Easy ${r.byLevel.easy.right}/${r.byLevel.easy.of}, medium ${r.byLevel.medium.right}/${r.byLevel.medium.of}, hard ${r.byLevel.hard.right}/${r.byLevel.hard.of}.`
    + (pass ? '' : ` Below the pass mark of ${PASS} percent after ${MAX_ATTEMPTS} attempts.`);
  const ref = db.collection('intern_work').doc(S.workId(intern.internId, task.key));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const w = snap.exists ? snap.data() || {} : null;
    if (w && w.state === 'accepted') return;
    const at = nowIso(nowMs);
    const record = {
      internId: intern.internId, batchId: batch.batchId, taskKey: task.key, round: (w && w.round) || 1,
      links: [], files: [], note, submittedAt: at, late: nowMs > I.timeline(batch, intern).taskDue(task), quiz: true
    };
    if (pass) {
      const score = Math.round((r.percent / 10) * 2) / 2;
      Object.assign(record, { state: 'accepted', score, feedback: `Passed the quiz with ${r.percent} percent.`, reviewedAt: at, reviewedBy: 'quiz' });
      record.history = ((w && w.history) || []).slice(-30).concat([{ at, by: 'quiz', state: 'accepted', note, score }]);
    } else {
      Object.assign(record, { state: 'submitted' });
      record.history = ((w && w.history) || []).slice(-30).concat([{ at, by: 'quiz', state: 'submitted', note }]);
    }
    tx.set(ref, record, { merge: true });
  });
  /* a pass may be the last task: the certificate, by itself (lib/intern-certificate.js) */
  if (pass) await require('./intern-certificate').issueIfComplete(db, intern.internId, nowMs, Object.assign({ store: S }, deps));
}

/* ---- for the Monday email ------------------------------------------------- */

async function finishedBetween(db, fromMs, toMs) {
  const snap = await db.collection(COLLECTION).where('state', '==', 'done').get();
  return (snap.docs || []).map((d) => d.data() || {})
    .filter((a) => Number(a.finishedMs) >= fromMs && Number(a.finishedMs) < toMs)
    .sort((x, y) => x.finishedMs - y.finishedMs);
}

/* How often each question was answered right in a set of attempts. */
function questionStats(attempts) {
  const out = [];
  for (const q of BANK.QUESTIONS) {
    let seen = 0; let right = 0;
    for (const a of attempts) {
      if (!a.order || !a.order.includes(q.id)) continue;
      seen += 1;
      if (a.answers && a.answers[q.id] === q.answer) right += 1;
    }
    if (seen) out.push({ qid: q.id, level: BANK.LEVELS[q.level], topic: BANK.TOPICS[q.topic], text: q.q, seen, right, rate: Math.round((right / seen) * 100) });
  }
  return out;
}

module.exports = {
  COLLECTION, MINUTES, PASS, MAX_ATTEMPTS, GAP_MS, GRACE_MS, SECTIONS, LETTERS, MAX_POINTS,
  isQuizTask, quizTaskOf, newPaper, questionView, grade, listAttempts, bestOf, resultView, reviewOf,
  summary, start, current, answer, finish, finishedBetween, questionStats, attemptId
};
