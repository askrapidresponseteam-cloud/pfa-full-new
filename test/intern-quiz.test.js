'use strict';

/* The internship quiz (owner, 2 Nov 2026: "quiz result should go to gandhim.
   each week the result should go to gandhim. quiz module should be [exam]
   grade"; 3 Nov 2026: "Make the 10 common incidents (animal related and
   animal laws) quiz. questions be me overall 30 in total. update time . and
   do a mix and it has to be [exam] standard, no less. also have a sample
   quiz/train that doesnt need login. with set of 7 qs.. and these cannot be
   in actual quiz"). Through the real portal routes on an in-memory
   Firestore. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const mail = require('../lib/caregiver-mail');
const fileStore = require('../lib/file-store');
const audit = require('../lib/admin-audit');
const BANK = require('../lib/intern-quiz-bank');
const Q = require('../lib/intern-quiz');
const QR = require('../lib/quiz-report');
const PORTAL = require('../lib/routes/intern/portal');
const ADMIN = require('../lib/routes/admin/internship');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const at = (iso) => Date.parse(iso);
const START = '2026-11-09';
const MIN = 60000;
let NOW;

let db; let sent; let realRecord;
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_MAIL_API_KEY', 'PFA_PUBLIC_SITE_URL', 'PFA_SUBMISSIONS_INBOX'];
const saved = {};
test.beforeEach(() => {
  db = memoryFirestore();
  firebase._setDbForTests(db);
  fileStore._setBucket(async () => null);
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.PFA_SMTP_USER = 'info@peopleforanimalsindia.org';
  process.env.PFA_SMTP_PASS = 'secret';
  sent = [];
  mail._setSmtpTransport(() => ({ sendMail: async (m) => { sent.push(m); return { messageId: m.messageId }; } }));
  realRecord = audit.record;
  audit.record = async () => {};
  NOW = at('2026-11-05T06:00:00.000Z');
});
test.afterEach(() => {
  firebase._setDbForTests(null);
  fileStore._setBucket(null);
  mail._setSmtpTransport(null);
  audit.record = realRecord;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function respond(handler, request) {
  return new Promise((resolve, reject) => {
    const out = { status: 200, headers: {} };
    const response = {
      set statusCode(v) { out.status = v; }, get statusCode() { return out.status; },
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, getHeader(k) { return out.headers[k.toLowerCase()]; },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw || '{}'); } catch (_) { out.json = null; } resolve(out); }
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}
function admin(method, { body, query } = {}) {
  const h = ADMIN.createHandler({ getDb: () => db, requireAdmin: async () => ({ uid: 'u1', email: 'priya@pfa.test', role: 'super' }), now: () => NOW });
  return respond(h, { method, url: '/api/admin/internship', query: query || {}, body, headers: {} });
}
function browser() {
  let cookie = '';
  const go = async (op, method, body) => {
    const h = PORTAL.createHandler(op, { getDb: () => db, now: () => NOW });
    const headers = { 'x-real-ip': '203.0.113.9' };
    if (cookie) headers.cookie = `pfa_intern=${cookie}`;
    if (method !== 'GET') headers['x-pfa-intern'] = '1';
    const r = await respond(h, { method, url: `/api/intern/${op}`, query: {}, body, headers, socket: { remoteAddress: '203.0.113.9' } });
    const set = r.headers['set-cookie'];
    if (set) { const m = /pfa_intern=([^;]*)/.exec(set); cookie = m ? m[1] : ''; }
    return r;
  };
  return { go };
}

/* a batch starting Monday 9 Nov, one intern, signed in */
async function intern(name) {
  const b = await admin('POST', { body: { action: 'batch-save', name: 'November 2026', startDate: START } });
  assert.equal(b.status, 200, JSON.stringify(b.json));
  const issued = await admin('POST', { body: { action: 'issue', batchId: b.json.batch.batchId, name: name || 'Asha Rao', email: 'asha@example.com', mobile: '9876543210' } });
  assert.equal(issued.status, 200, JSON.stringify(issued.json));
  const token = /intern\.html#onboard=([A-Za-z0-9_-]+)/.exec(sent[sent.length - 1].text)[1];
  const br = browser();
  assert.equal((await br.go('onboard', 'POST', { token })).status, 200);
  return { br, internId: issued.json.internId };
}

/* the letter for a question's right answer, or a wrong one */
async function letterFor(attemptId, qid, right) {
  const a = (await db.collection('intern_quiz').doc(attemptId).get()).data();
  const q = BANK.QUESTIONS.find((x) => x.id === qid);
  const k = a.perm[qid].findIndex((orig) => (right ? orig === q.answer : orig !== q.answer));
  return Q.LETTERS[k];
}

/* answer every question; `rightIf(question)` decides which are right */
async function sit(br, rightIf) {
  let r = await br.go('quiz', 'POST', { action: 'start' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  let a = r.json.attempt;
  const id = a.attemptId;
  while (a.state === 'open' && a.question) {
    const q = a.question;
    r = await br.go('quiz', 'POST', { action: 'answer', attemptId: id, qid: q.qid, choice: await letterFor(id, q.qid, rightIf(q)) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    a = r.json.attempt;
  }
  assert.equal(a.state, 'done');
  return r.json;
}

/* ---- the questions -------------------------------------------------------- */

test('30 questions on ten incidents, three each, one of every level; five choices and one answer each', () => {
  const count = { easy: 0, medium: 0, hard: 0 };
  const ids = new Set();
  const texts = new Set();
  for (const q of BANK.QUESTIONS) {
    count[q.level] += 1;
    assert.ok(!ids.has(q.id), `id ${q.id} once`); ids.add(q.id);
    assert.ok(!texts.has(q.q), `${q.id} asked once`); texts.add(q.q);
    assert.equal(q.choices.length, 5, `${q.id}: five choices, as in a competitive exam`);
    assert.equal(new Set(q.choices).size, 5, `${q.id}: five different choices`);
    assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 5, `${q.id}: an answer`);
    assert.ok(q.why && q.why.length > 40, `${q.id}: says why`);
    for (const x of [q.q, q.why].concat(q.choices)) assert.doesNotMatch(x, /[\u2013\u2014]/, `${q.id}: no long dash`);
  }
  assert.deepEqual(count, { easy: 10, medium: 10, hard: 10 });
  assert.equal(Q.MAX_POINTS, 10 + 20 + 30);
  assert.equal(BANK.INCIDENTS.length, 10);
  for (const [key, label] of BANK.INCIDENTS) {
    const mine = BANK.QUESTIONS.filter((q) => q.topic === key);
    assert.deepEqual(mine.map((q) => q.level).sort(), ['easy', 'hard', 'medium'], `${label}: one easy, one medium, one hard`);
    assert.equal(BANK.TOPICS[key], label);
  }
  /* Competitive-exam standard: the hard ones are reasoning, data sufficiency and the law applied, not recall */
  const hard = BANK.QUESTIONS.filter((q) => q.level === 'hard');
  assert.ok(hard.filter((q) => /Which of the following|depends on which assumption|best explains|must be true/.test(q.q)).length >= 6, 'critical reasoning');
  assert.equal(hard.filter((q) => q.fixed).length, 1, 'a data sufficiency question, in the standard order');
  /* the right answer is not given away by being the longest choice */
  const longest = BANK.QUESTIONS.filter((q) => !q.fixed && q.choices[q.answer].length > Math.max(...q.choices.filter((_, i) => i !== q.answer).map((c) => c.length)));
  assert.ok(longest.length <= 7, longest.map((q) => q.id).join(', '));
});

test('seven practice questions, none of them in the quiz, the same on the open page', () => {
  assert.equal(BANK.SAMPLE.length, 7);
  const inQuiz = new Set(BANK.QUESTIONS.map((q) => q.q));
  const was = new Set(BANK.QUESTIONS.map((q) => q.was).filter(Boolean));
  for (const q of BANK.SAMPLE) {
    assert.ok(!inQuiz.has(q.q), `${q.id} is not in the quiz`);
    assert.ok(!was.has(q.was), `${q.id} is not a quiz question under another id`);
    assert.equal(q.choices.length, 5);
  }
  assert.deepEqual([...new Set(BANK.SAMPLE.map((q) => q.level))].sort(), ['easy', 'hard', 'medium'], 'every level, so it shows what the quiz is like');
  /* the open page carries the same seven, with their answers (they count for nothing) */
  const page = require('../assets/law-quiz-sample.js');
  assert.deepEqual(page.QUESTIONS.map((q) => [q.q, q.choices, q.answer, q.why, Boolean(q.fixed)]), BANK.SAMPLE.map((q) => [q.q, q.choices, q.answer, q.why, Boolean(q.fixed)]));
  /* the quiz never serves one */
  for (let i = 0; i < 20; i += 1) assert.ok(Q.newPaper().order.every((id) => !id.startsWith('sample-')));
});

test('the sums in the number questions are right', () => {
  const ans = (id) => { const q = BANK.RETIRED.concat(BANK.SAMPLE).find((x) => x.id === id); return q.choices[q.answer]; };
  assert.equal(ans('h18'), String(0.7 * 600 - 210));
  assert.equal(ans('h19'), String(40 * (30 / 5)));
  assert.equal(ans('sample-6'), String(40 * (30 / 5)));
  assert.equal(ans('h20'), String(Math.ceil((0.7 * 5000 - 1500) / 240)));
  assert.equal(ans('h23'), `${(30 * 50 * 30 * 0.4).toLocaleString('en-IN')} rupees`);
  assert.equal(ans('h24'), String(Math.ceil(50 / (0.25 * 0.6 * 0.5)) - 400));
  let dogs = 100; let females = 50;
  for (let y = 0; y < 2; y += 1) { const pups = females * 3; dogs += pups; females += pups / 2; }
  assert.equal(ans('h25'), String(dogs));
  /* the earlier offence 30 months before the arrest, the new one before the arrest: at most 30 months apart, so (1) alone answers it */
  const ds = BANK.QUESTIONS.find((q) => q.id === 'neglect-h');
  assert.equal(ds.answer, 0);
  assert.equal(ds.choices[ds.answer], 'Statement (1) alone is sufficient, but statement (2) alone is not.');
  assert.match(ds.q, /30 months before he was arrested/);
  assert.match(ds.q, /within three years/);
});

test('every attempt is shuffled afresh, all thirty mixed; data sufficiency keeps A to E', () => {
  let seed = 1;
  const rnd = (n) => { seed = (seed * 16807) % 2147483647; return seed % n; };
  const a = Q.newPaper(rnd);
  const b = Q.newPaper(rnd);
  assert.equal(a.order.length, 30);
  assert.equal(new Set(a.order).size, 30);
  assert.notDeepEqual(a.order, b.order);
  const levels = a.order.map((id) => BANK.QUESTIONS.find((q) => q.id === id).level);
  assert.notDeepEqual(levels, Array(10).fill('easy').concat(Array(10).fill('medium'), Array(10).fill('hard')), 'mixed, not in sections');
  assert.ok(levels.slice(0, 10).some((l) => l !== 'easy'));
  assert.deepEqual(a.perm['neglect-h'], [0, 1, 2, 3, 4]);
  assert.ok(Object.keys(a.perm).some((id) => a.perm[id].join() !== '0,1,2,3,4'));
});

/* an attempt begun on the bank of 2 Nov 2026 is still marked out of its own 125 */
test('an attempt on the old bank is marked as it was', () => {
  const old = BANK.RETIRED.map((q) => q.id);
  const a = { order: old, perm: Object.fromEntries(old.map((id) => [id, [0, 1, 2, 3, 4]])), answers: Object.fromEntries(BANK.RETIRED.filter((q) => q.level !== 'hard').map((q) => [q.id, q.answer])), startedMs: 0, deadlineMs: 75 * MIN };
  const r = Q.grade(a, 60 * MIN, false);
  assert.equal(r.max, 125);
  assert.equal(r.points, 50);
  assert.equal(r.percent, 40);
});

/* ---- sitting it ------------------------------------------------------------- */

test('the quiz opens with the internship; the browser never sees an answer while it is open', async () => {
  const { br } = await intern();
  const early = await br.go('quiz', 'POST', { action: 'start' });
  assert.equal(early.status, 409);
  assert.match(early.json.message, /opens when your internship starts, on Mon 9 Nov/);

  NOW = at('2026-11-09T05:00:00.000Z');
  const me = await br.go('me', 'GET');
  assert.equal(me.json.quiz.count, 30);
  assert.equal(me.json.quiz.minutes, 60);
  assert.deepEqual(me.json.quiz.incidents.map((x) => x.count), Array(10).fill(3));
  assert.equal(me.json.quiz.canStart, true);
  const law = me.json.batch.tasks.find((t) => t.key === 'law');
  assert.equal(law.auto, 'quiz');

  const r = await br.go('quiz', 'POST', { action: 'start' });
  assert.equal(r.status, 200);
  const q = r.json.attempt.question;
  assert.equal(q.index, 1);
  assert.equal(q.total, 30);
  assert.ok(['easy', 'medium', 'hard'].includes(q.section.level));
  assert.ok(BANK.INCIDENTS.some(([, label]) => label === q.section.incident), 'the incident it is about');
  assert.deepEqual(q.choices.map((c) => c.key), ['A', 'B', 'C', 'D', 'E']);
  assert.doesNotMatch(r.raw, /"answer"|"why"|"right"|"perm"|"answers"/, 'no answer in what the browser gets');
  /* starting again resumes the same attempt; the page can be reloaded */
  const again = await br.go('quiz', 'POST', { action: 'start' });
  assert.equal(again.json.attempt.attemptId, r.json.attempt.attemptId);
  const got = await br.go('quiz', 'GET');
  assert.equal(got.json.attempt.question.qid, q.qid);
  assert.doesNotMatch(got.raw, /"answer"|"why"|"perm"/);
  assert.ok(got.json.attempt.secondsLeft <= 60 * 60 && got.json.attempt.secondsLeft > 59 * 60, 'sixty minutes: two a question');
});

test('answers are final and in order, as in a competitive exam', async () => {
  const { br } = await intern();
  NOW = at('2026-11-09T05:00:00.000Z');
  const r = await br.go('quiz', 'POST', { action: 'start' });
  const a = r.json.attempt;
  const first = a.question.qid;
  const next = await br.go('quiz', 'POST', { action: 'answer', attemptId: a.attemptId, qid: first, choice: 'A' });
  assert.equal(next.json.attempt.question.index, 2);
  /* the same answer sent twice (a retried request) changes nothing */
  const dup = await br.go('quiz', 'POST', { action: 'answer', attemptId: a.attemptId, qid: first, choice: 'B' });
  assert.equal(dup.status, 200);
  assert.equal(dup.json.attempt.question.index, 2);
  const kept = (await db.collection('intern_quiz').doc(a.attemptId).get()).data();
  assert.equal(kept.answers[first], kept.perm[first][0], 'the first answer stands');
  /* a question further on cannot be answered out of turn */
  const ahead = kept.order[5];
  assert.equal((await br.go('quiz', 'POST', { action: 'answer', attemptId: a.attemptId, qid: ahead, choice: 'A' })).status, 409);
  assert.equal((await br.go('quiz', 'POST', { action: 'answer', attemptId: a.attemptId, qid: next.json.attempt.question.qid, choice: 'F' })).status, 400);
  /* someone else's attempt */
  const other = await intern('Ravi Kumar');
  assert.equal((await other.br.go('quiz', 'POST', { action: 'answer', attemptId: a.attemptId, qid: next.json.attempt.question.qid, choice: 'A' })).status, 404);
});

test('a pass marks the law task accepted, shows the marks by section, and opens the review', async () => {
  const { br, internId } = await intern();
  NOW = at('2026-11-10T05:00:00.000Z');
  /* right on everything but five hard questions: 60 - 15 = 45 marks, 75 percent */
  let wrongHard = 0;
  const done = await sit(br, (q) => !(q.section.level === 'hard' && wrongHard++ < 5));
  const quiz = done.quiz;
  assert.equal(quiz.passed, true);
  assert.equal(quiz.best.percent, 75);
  assert.equal(quiz.best.points, 45);
  assert.equal(quiz.best.max, 60);
  assert.deepEqual(quiz.best.byLevel.map((l) => [l.level, l.right, l.of]), [['easy', 10, 10], ['medium', 10, 10], ['hard', 5, 10]]);
  assert.equal(quiz.best.byTopic.length, 10, 'marks by incident');
  assert.ok(quiz.best.byTopic.every((t) => t.of === 3));
  assert.equal(quiz.canStart, false);
  assert.equal(quiz.review.length, 30);
  assert.ok(quiz.review.every((x) => x.why && x.choices.filter((c) => c.right).length === 1));
  assert.equal(quiz.review.filter((x) => !x.right).length, 5);
  const work = (await db.collection('intern_work').doc(`${internId}__law`).get()).data();
  assert.equal(work.state, 'accepted');
  assert.equal(work.score, 7.5);
  assert.equal(work.reviewedBy, 'quiz');
  assert.match(work.note, /75 percent \(45 of 60 marks\), attempt 1 of 3\. Easy 10\/10, medium 10\/10, hard 5\/10\./);
  const me = await br.go('me', 'GET');
  assert.equal(me.json.progress.tasks.find((t) => t.key === 'law').state, 'accepted');
  /* no proof form for the quiz task */
  const proof = await br.go('work', 'POST', { taskKey: 'law', links: ['https://example.com/x'] });
  assert.equal(proof.status, 409);
  assert.equal((await br.go('quiz', 'POST', { action: 'start' })).json.code, 'PASSED');
});

test('three attempts a day apart; no review until passed or done; then PFA reviews the best', async () => {
  NOW = at('2026-11-09T05:00:00.000Z'); // a session lasts seven days
  const { br, internId } = await intern();
  NOW = at('2026-11-10T05:00:00.000Z');
  const one = await sit(br, (q) => q.section.level === 'easy');
  assert.equal(one.quiz.best.percent, 16.7);
  assert.equal(one.quiz.passed, false);
  assert.equal(one.quiz.review, null, 'no answers while attempts remain');
  assert.equal(one.quiz.left, 2);
  assert.match(one.quiz.nextAt, /^2026-11-11T05:/);
  const soon = await br.go('quiz', 'POST', { action: 'start' });
  assert.equal(soon.status, 409);
  assert.match(soon.json.message, /Your next attempt opens Wed 11 Nov at 10:30 am/);
  assert.equal((await db.collection('intern_work').doc(`${internId}__law`).get()).exists, false, 'nothing for PFA yet');

  NOW = at('2026-11-11T06:00:00.000Z');
  const two = await sit(br, (q) => q.section.level !== 'hard');
  assert.equal(two.quiz.best.percent, 50);
  NOW = at('2026-11-12T07:00:00.000Z');
  const three = await sit(br, (q) => q.section.level === 'medium');
  assert.equal(three.quiz.left, 0);
  assert.equal(three.quiz.best.n, 2, 'the best attempt counts');
  assert.equal(three.quiz.review.length, 30, 'the review opens once every attempt is used');
  const work = (await db.collection('intern_work').doc(`${internId}__law`).get()).data();
  assert.equal(work.state, 'submitted', 'in the review queue for PFA to decide');
  assert.match(work.note, /50 percent \(30 of 60 marks\), attempt 2 of 3\. .* Below the pass mark of 60 percent after 3 attempts\./);
  NOW = at('2026-11-14T07:00:00.000Z');
  assert.equal((await br.go('quiz', 'POST', { action: 'start' })).json.code, 'NO_ATTEMPTS');
});

test('the clock is the server’s: an attempt left open is marked when its time is up', async () => {
  const { br } = await intern();
  NOW = at('2026-11-09T05:00:00.000Z');
  const r = await br.go('quiz', 'POST', { action: 'start' });
  let a = r.json.attempt;
  for (let i = 0; i < 4; i += 1) {
    const x = await br.go('quiz', 'POST', { action: 'answer', attemptId: a.attemptId, qid: a.question.qid, choice: await letterFor(a.attemptId, a.question.qid, true) });
    a = x.json.attempt;
  }
  /* an answer that arrives after the time (and its grace) is not taken */
  const firstFour = (await db.collection('intern_quiz').doc(a.attemptId).get()).data().order.slice(0, 4);
  NOW += 60 * MIN + Q.GRACE_MS + 1000;
  const late = await br.go('quiz', 'POST', { action: 'answer', attemptId: a.attemptId, qid: a.question.qid, choice: 'A' });
  assert.equal(late.json.attempt.state, 'done');
  assert.equal(late.json.attempt.timeUp, true);
  const s = late.json.quiz.attempts[0];
  assert.equal(s.answered, 4);
  assert.equal(s.points, firstFour.reduce((n, id) => n + BANK.POINTS[BANK.QUESTIONS.find((q) => q.id === id).level], 0));
  assert.equal(s.timedOut, true);
  assert.equal(s.seconds, 60 * 60);
});

test('a closed tab: the dashboard marks the attempt when its time is up', async () => {
  const { br } = await intern();
  NOW = at('2026-11-09T05:00:00.000Z');
  await br.go('quiz', 'POST', { action: 'start' });
  NOW += 65 * MIN;
  const me = await br.go('me', 'GET');
  assert.equal(me.json.quiz.open, null);
  assert.equal(me.json.quiz.attempts.length, 1);
  assert.equal(me.json.quiz.attempts[0].answered, 0);
});

/* ---- the Monday email to gandhim --------------------------------------------- */

test('every attempt of the week goes to gandhim on Monday, once, with a CSV', async () => {
  const a = await intern('Asha Rao');
  const b = await intern('Ravi Kumar');
  NOW = at('2026-11-10T05:00:00.000Z');
  await sit(a.br, () => true);
  NOW = at('2026-11-11T05:00:00.000Z');
  await sit(b.br, (q) => q.section.level === 'easy');
  sent = [];

  assert.equal((await QR.run({ db, nowMs: at('2026-11-13T06:00:00.000Z') })).state, 'not-due', 'only Monday to Wednesday');
  const r = await QR.run({ db, nowMs: at('2026-11-16T03:00:00.000Z') });
  assert.equal(r.state, 'sent', JSON.stringify(r));
  assert.equal(r.count, 2);
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.to, 'gandhim@exmpls.sansad.in', 'the forms inbox, and no one else');
  assert.ok(!m.cc || !m.cc.length);
  assert.equal(m.subject, 'PFA internship quiz: 9 Nov to 15 Nov 2026 (2 attempts, 1 passed)');
  assert.match(m.text, /Asha Rao \(PFA-IN-[A-Z0-9]{6}\), attempt 1, 10 Nov, 10:30 am: 100% Pass\. Easy 10\/10, medium 10\/10, hard 10\/10\./);
  assert.match(m.text, /Ravi Kumar \(PFA-IN-[A-Z0-9]{6}\), attempt 1, 11 Nov, 10:30 am: 16\.7% Not passed\. Easy 10\/10, medium 0\/10, hard 0\/10\./);
  assert.match(m.text, /Most often got wrong:/);
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].filename, 'PFA-internship-quiz-week-of-2026-11-16.csv');
  const csv = Buffer.from(m.attachments[0].content).toString('utf8');
  assert.match(csv, /^\ufeffIntern,Intern ID,Batch,Attempt,Finished \(IST\),Percent,Marks,Out of,Result,Easy,Medium,Hard,Answered,Time taken,Ran out of time\r\n/);
  assert.equal(csv.trim().split('\r\n').length, 3);
  assert.match(csv, /Ravi Kumar,PFA-IN-\w{6},November 2026,1,"11 Nov, 10:30 am",16\.7,10,60,Not passed,10\/10,0\/10,0\/10,30,/);
  /* once */
  assert.equal((await QR.run({ db, nowMs: at('2026-11-17T03:00:00.000Z') })).state, 'already');
  assert.equal(sent.length, 1);
});

test('a week with no attempts still sends a short note, without a CSV', async () => {
  const r = await QR.run({ db, nowMs: at('2026-11-23T03:00:00.000Z') });
  assert.equal(r.state, 'sent');
  assert.equal(sent[0].subject, 'PFA internship quiz: 16 Nov to 22 Nov 2026 (no attempts)');
  assert.match(sent[0].text, /No attempts this week\./);
  assert.equal((sent[0].attachments || []).length, 0);
});

test('wired: the route, the portal page, the plan, the email worker and the internship page', () => {
  const api = read('api/index.js');
  assert.match(api, /'intern\/quiz': '\.\/intern\/portal\.js'/);
  assert.match(api, /'intern\/quiz': \(\) => require\('\.\.\/lib\/routes\/intern\/portal\.js'\)\.quiz/);
  const page = read('intern.html');
  assert.match(page, /<script src="assets\/intern-quiz\.js"><\/script>\n(<script src="assets\/[\w-]+\.js"><\/script>\n)*<script>\n\(function \(\) \{/,'loaded before the portal script, which uses it');
  const js = read('assets/intern-quiz.js');
  assert.match(js, /'\/api\/intern\/quiz'/);
  assert.match(js, /action: 'answer'/);
  assert.match(read('lib/routes/caregiver/email-worker.js'), /require\('\.\.\/\.\.\/quiz-report'\)\.run/);
  assert.match(read('test/_isolate-env.js'), /PFA_QUIZ_REPORT = 'off'/);
  const internship = read('internship.html');
  assert.match(internship, /30 questions/);
  assert.doesNotMatch(internship + read('lib/internship.js') + read('assets/intern-quiz.js'), /55[ -]question|75 minutes/, 'the old size is gone everywhere');
  /* the practice round, open to anyone, on the internship page and in the portal */
  assert.match(internship, /<script src="assets\/law-quiz-sample\.js" defer><\/script>/);
  assert.match(internship, /data-law-sample/);
  assert.match(page, /<script src="assets\/law-quiz-sample\.js"><\/script>/);
  assert.doesNotMatch(internship, /The ten questions/, 'the old ten questions are gone from the public page');
});

/* owner, 3 Nov 2026: "hope quiz results get emailed to gandhim as well as one taking it" */
test('each attempt’s marks are emailed to the intern who took it, once; no answers in it', async () => {
  NOW = at('2026-11-09T05:00:00.000Z');
  const { br } = await intern();
  NOW = at('2026-11-10T05:00:00.000Z');
  sent = [];
  await sit(br, (q) => q.section.level === 'easy');
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.to, 'asha@example.com');
  assert.equal(m.subject, 'Your PFA internship quiz: 16.7%, attempt 1 of 3');
  assert.match(m.text, /Asha, here are your marks for attempt 1 of 3 of the internship quiz\./);
  assert.match(m.text, /Easy 10 of 10, medium 0 of 10, hard 0 of 10\./);
  assert.match(m.text, /You have 2 more attempts; the next opens Wed 11 Nov, 10:30 am\./);
  assert.doesNotMatch(m.text + m.html, /The answer|Why:/, 'no answers by email');
  /* the dashboard reading the finished attempt again sends nothing more */
  await br.go('me', 'GET');
  assert.equal(sent.length, 1);
  NOW = at('2026-11-11T06:00:00.000Z');
  sent = [];
  await sit(br, () => true);
  assert.equal(sent.length, 1, 'one email: the quiz result, not a second "accepted" email as well');
  assert.equal(sent[0].subject, 'You passed the PFA internship quiz: 100%');
  assert.match(sent[0].text, /Week 1's task, Learn the law, is marked done\./);
});

test('the exam the quiz is modelled on is never named (owner, 3 Nov 2026)', () => {
  const fsx = require('node:fs'); const px = require('node:path');
  const root = px.join(__dirname, '..');
  const word = new RegExp('\\b' + ['G', 'M', 'A', 'T'].join('') + '\\b', 'i');
  const hits = [];
  const walk = (dir) => {
    for (const f of fsx.readdirSync(dir)) {
      if (['node_modules', '.git', 'functions', 'public', 'dist', 'resources', 'media', 'fonts', 'img'].includes(f)) continue;
      const p = px.join(dir, f); const st = fsx.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(html|js|json|md|css|txt)$/.test(f) && word.test(fsx.readFileSync(p, 'utf8'))) hits.push(px.relative(root, p));
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});
