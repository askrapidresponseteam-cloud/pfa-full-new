'use strict';

/* The internship portal, end to end (owner, 1 Nov 2026: "Verify the full
   journey from issuing intern credentials to weekly reminders, submission
   evaluation, and credited RRT registrations"). Every step goes through the
   real route handlers on an in-memory Firestore. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const mail = require('../lib/caregiver-mail');
const fileStore = require('../lib/file-store');
const audit = require('../lib/admin-audit');
const I = require('../lib/internship');
const S = require('../lib/intern-store');
const R = require('../lib/intern-reminders');
const PORTAL = require('../lib/routes/intern/portal');
const ADMIN = require('../lib/routes/admin/internship');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* Monday 9 Nov 2026 is the batch's first day; "now" moves through it */
const START = '2026-11-09';
const at = (iso) => Date.parse(iso);
let NOW = at('2026-11-05T06:00:00.000Z');

let db; let sent; let realRecord; let audits;
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_MAIL_API_KEY', 'PFA_RRT_REFERRAL_SECRET', 'PFA_RRT_API', 'PFA_PUBLIC_SITE_URL', 'PFA_INTERN_PEPPER'];
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
  audits = [];
  audit.record = async (who, entry) => { audits.push(entry); };
  NOW = at('2026-11-05T06:00:00.000Z');
});
test.afterEach(() => {
  firebase._setDbForTests(null);
  fileStore._setBucket(null);
  mail._setSmtpTransport(null);
  audit.record = realRecord;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

/* ---- calling the routes ------------------------------------------------- */

function respond(handler, request) {
  return new Promise((resolve, reject) => {
    const out = { status: 200, headers: {} };
    const response = {
      set statusCode(v) { out.status = v; }, get statusCode() { return out.status; },
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, getHeader(k) { return out.headers[k.toLowerCase()]; },
      end(raw) { out.raw = raw; try { out.json = JSON.parse(String(raw || '{}')); } catch (_) { out.json = null; } resolve(out); }
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

function admin(method, { body, query } = {}, fetchImpl) {
  const h = ADMIN.createHandler({ getDb: () => db, requireAdmin: async () => ({ uid: 'u1', email: 'priya@pfa.test', role: 'super' }), now: () => NOW, fetchImpl });
  return respond(h, { method, url: '/api/admin/internship', query: query || {}, body, headers: {} });
}

/* a browser: keeps its cookie, sends the same-site header */
function browser(ip) {
  let cookie = '';
  const go = async (op, method, body, { header = true, query } = {}) => {
    const h = PORTAL.createHandler(op, { getDb: () => db, now: () => NOW });
    const headers = { 'x-real-ip': ip || '203.0.113.7' };
    if (cookie) headers.cookie = `pfa_intern=${cookie}`;
    if (header && method !== 'GET') headers['x-pfa-intern'] = '1';
    const r = await respond(h, { method, url: `/api/intern/${op}`, query: query || {}, body, headers, socket: { remoteAddress: ip || '203.0.113.7' } });
    const set = r.headers['set-cookie'];
    if (set) { const m = /pfa_intern=([^;]*)/.exec(set); cookie = m ? m[1] : ''; }
    return r;
  };
  return { go, get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}

function application(ref, name, email, mobile) {
  db.collection('submissions').doc(ref).set({ reference: ref, kind: 'PFA-VI', status: 'new', createdAt: '2026-11-01T06:00:00.000Z', fields: { name, email, mobile, city: 'Udupi' } });
}

/* A batch with electives, as the plan was before 2 Nov 2026: a batch's own
   plan can still have them, and the portal still handles a choice. */
const ELECTIVE_TASKS = [
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
const ELECTIVE_WEEKS = [
  { n: 1, title: 'Animal welfare laws', summary: 'Learn the four laws and pass the test.' },
  { n: 2, title: 'Map your district', summary: 'Every vet, government vet centre, shelter, ABC centre and feeding spot, checked by a call.' },
  { n: 3, title: 'Bring people onto the RRT', summary: 'Share your link to rapid-response.in; 50 people from your district join.' },
  { n: 4, title: 'A lawyer for animals', summary: 'Find and meet one in your district.' },
  { n: 5, title: 'Your film for The Wall', summary: 'The idea, the script, then the shoot.' },
  { n: 6, title: 'Your electives', summary: 'Start the three you chose.' },
  { n: 7, title: 'Your electives, done', summary: 'Every proof on the portal.' },
  { n: 8, title: 'Final review', summary: 'The last proofs checked by PFA, and the certificate issued.' }
];
const ELECTIVE_PLAN = { weeks: ELECTIVE_WEEKS, tasks: ELECTIVE_TASKS, electivesRequired: 3 };

async function batch(plan) {
  const r = await admin('POST', { body: Object.assign({ action: 'batch-save', name: 'November 2026', startDate: START }, plan ? { plan } : {}) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.batch.batchId;
}

function linkIn(message) {
  const m = /intern\.html#onboard=([A-Za-z0-9_-]+)/.exec(message.text);
  assert.ok(m, 'the welcome carries the link');
  return m[1];
}

/* ---- the plan ----------------------------------------------------------- */

test('the default plan is the eight weeks on the internship page: all eight tasks for every intern; weeks run Monday to Sunday, IST', async () => {
  /* owner, 2 Nov 2026: "All interns do all 8 in 2 months" */
  const id = await batch();
  const b = await S.getBatch(db, id);
  assert.equal(b.weeks.length, 8);
  assert.deepEqual(b.weeks.slice(0, 3).map((w) => w.title), ['Learn the law', 'Map your district', 'Bring people onto the RRT']);
  assert.deepEqual(b.tasks.map((t) => [t.key, t.kind, t.week, t.goal]), [
    ['law', 'core', 1, '55-question quiz'], ['map', 'core', 2, '1 district'], ['rrt', 'core', 3, '50 people'], ['films', 'core', 4, '2 films'],
    ['shelter', 'core', 5, '20 hours'], ['rti', 'core', 6, '1 RTI'], ['cinekind', 'core', 7, '1 nomination'], ['story', 'core', 8, '1 story']
  ]);
  assert.deepEqual(b.tasks.map((t) => t.title), ['Learn the law', 'Map your district', 'Bring 50 people onto the RRT', 'Two films for The Wall', 'Shelter work', 'An RTI to the municipality', 'One CineKind nomination', 'Your own story with animals'],
    'the same titles as the page and the proof form');
  assert.equal(b.electivesRequired, 0);
  const v = I.batchView(b, NOW);
  assert.equal(v.weeks[0].due, '2026-11-15T18:29:59.000Z', 'week 1 is due Sunday 15 Nov, 11:59:59 pm IST');
  assert.equal(v.weeks[0].dueLabel, 'Sun 15 Nov, 11:59 pm');
  assert.equal(v.tasks.find((t) => t.key === 'shelter').dueWeek, 6, 'shelter work runs across weeks 5 and 6');
  assert.equal(v.tasks.find((t) => t.key === 'rti').dueWeek, 6);
  assert.equal(I.progressOf(b, { electives: [] }, [], null).need, 8, 'all eight make the certificate');
  assert.equal(v.week, 0, 'not started');
  assert.equal(I.currentWeek(b, at('2026-11-08T18:30:00.000Z')), 1, 'Monday 00:00 IST');
  assert.equal(I.currentWeek(b, at('2026-11-15T18:29:00.000Z')), 1);
  assert.equal(I.currentWeek(b, at('2026-11-15T18:31:00.000Z')), 2);
  /* a running batch can take the standard plan from the panel in one go */
  const panel = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(panel, /data-ip="plan-standard">Use the standard plan</);
  assert.match(panel, /if \(what === 'plan-standard'\) \{\n\s+var std = \(ip\.home \|\| \{\}\)\.defaultPlan;/);
  const titles = require('../lib/submission-fields').specFor('PFA-VP').options.task;
  assert.deepEqual(titles, b.tasks.map((t) => t.title), 'the proof form names the same eight');
  /* a batch must start on a Monday, and its plan is per batch */
  assert.equal((await admin('POST', { body: { action: 'batch-save', name: 'X', startDate: '2026-11-10' } })).status, 400);
  const plan = I.defaultPlan();
  plan.tasks.find((t) => t.key === 'rrt').target = 30;
  const edited = await admin('POST', { body: { action: 'batch-save', batchId: id, name: 'November 2026', startDate: START, plan } });
  assert.equal(edited.json.batch.tasks.find((t) => t.key === 'rrt').target, 30);
});

/* ---- credentials -------------------------------------------------------- */

test('issuing: an Intern ID and an emailed one-time link; the key is shown once, kept only as a hash, never the mobile', async () => {
  const id = await batch();
  application('PFA-VI-2026-00001', 'arjun nair', 'arjun@example.com', '9876543210');
  const apps = await admin('GET', { query: { applications: '1' } });
  assert.deepEqual(apps.json.applications.map((a) => a.reference), ['PFA-VI-2026-00001']);
  const issued = await admin('POST', { body: { action: 'issue', batchId: id, name: 'arjun nair', email: 'arjun@example.com', mobile: '9876543210', applicationRef: 'PFA-VI-2026-00001' } });
  assert.equal(issued.status, 200, JSON.stringify(issued.json));
  assert.match(issued.json.internId, /^PFA-IN-[A-HJ-NP-Z2-9]{6}$/);
  assert.match(issued.json.referralCode, /^PFA[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(issued.json.mailed, 'sent');
  assert.equal((await admin('GET', { query: { applications: '1' } })).json.applications.length, 0, 'an issued application leaves the list');
  assert.equal((await admin('POST', { body: { action: 'issue', batchId: id, name: 'Arjun', email: 'arjun@example.com', applicationRef: 'PFA-VI-2026-00001' } })).status, 409, 'once per application');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'arjun@example.com');
  const token = linkIn(sent[0]);
  assert.doesNotMatch(sent[0].text + sent[0].html, /\b\d{10}\b/, 'no key in any email');

  const b = browser();
  const once = await b.go('onboard', 'POST', { token });
  assert.equal(once.status, 200, JSON.stringify(once.json));
  assert.equal(once.json.internId, issued.json.internId);
  assert.match(once.json.key, /^[1-9]\d{9}$/);
  assert.notEqual(once.json.key, '9876543210');
  assert.match(once.headers['set-cookie'], /^pfa_intern=[A-Za-z0-9_-]{43}; Path=\/api\/intern; HttpOnly; Secure; SameSite=Strict; Max-Age=604800$/);
  /* stored as a scrypt hash, nowhere in plain */
  const dump = JSON.stringify(db.dump());
  assert.ok(!dump.includes(once.json.key), 'the key is nowhere in the database');
  assert.ok(!dump.includes(token), 'nor the link');
  assert.ok(!dump.includes(b.cookie), 'nor the session');
  assert.match((await S.getIntern(db, once.json.internId)).keyHash, /^scrypt\$16384\$/);
  /* the link works once */
  const again = await browser('198.51.100.2').go('onboard', 'POST', { token });
  assert.equal(again.status, 410);
  /* and the panel never shows the hash */
  const view = await admin('GET', { query: { intern: once.json.internId } });
  assert.doesNotMatch(JSON.stringify(view.json), /scrypt|keyHash|onboardHash/);
});

async function onboarded(name, email, mobile) {
  const id = (await S.listBatches(db))[0] ? (await S.listBatches(db))[0].batchId : await batch();
  sent = [];
  const issued = await admin('POST', { body: { action: 'issue', batchId: id, name, email, mobile } });
  const b = browser();
  const once = await b.go('onboard', 'POST', { token: linkIn(sent[0]) });
  sent = [];
  return { b, internId: issued.json.internId, key: once.json.key, code: issued.json.referralCode };
}

test('signing in: wrong keys lock the ID, growing; the address is braked too; a cross-site post is refused', async () => {
  await batch();
  const a = await onboarded('Asha Rao', 'asha@example.com', '9000000001');
  const b = browser('192.0.2.10');
  for (let i = 0; i < 4; i += 1) assert.equal((await b.go('session', 'POST', { internId: a.internId, key: '1111111111' })).status, 401);
  assert.equal((await b.go('session', 'POST', { internId: a.internId, key: '1111111111' })).status, 401);
  const locked = await b.go('session', 'POST', { internId: a.internId, key: a.key });
  assert.equal(locked.status, 429, 'locked, even with the right key');
  assert.match(locked.json.message, /Too many wrong keys/);
  NOW += 16 * 60000;
  const ok = await b.go('session', 'POST', { internId: a.internId, key: a.key });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  /* a second lock lasts twice as long */
  for (let i = 0; i < 5; i += 1) await browser('192.0.2.11').go('session', 'POST', { internId: a.internId, key: '2222222222' });
  NOW += 16 * 60000;
  assert.equal((await browser('192.0.2.12').go('session', 'POST', { internId: a.internId, key: a.key })).status, 429);
  NOW += 16 * 60000;
  assert.equal((await browser('192.0.2.12').go('session', 'POST', { internId: a.internId, key: a.key })).status, 200);
  /* the same answer for an ID that does not exist */
  assert.equal((await b.go('session', 'POST', { internId: 'PFA-IN-ZZZZZZ', key: '1234567890' })).json.message, 'That Intern ID and key do not match.');
  /* one address guessing across IDs is braked */
  const guesser = browser('192.0.2.99');
  let last;
  for (let i = 0; i < 22; i += 1) last = await guesser.go('session', 'POST', { internId: 'PFA-IN-ZZZZZZ', key: '1234567890' });
  assert.equal(last.status, 429);
  /* no same-site header, no post */
  const cross = await browser().go('session', 'POST', { internId: a.internId, key: a.key }, { header: false });
  assert.equal(cross.status, 403);
  /* signing out ends the session on the server */
  const me = await a.b.go('me', 'GET');
  assert.equal(me.status, 200);
  const old = a.b.cookie;
  await a.b.go('session', 'DELETE');
  a.b.cookie = old;
  assert.equal((await a.b.go('me', 'GET')).status, 401);
});

test('the full journey: plan and deadlines, electives, proof with a file, revision, acceptance, privacy between interns', async () => {
  /* a batch whose own plan has electives: the portal still handles a choice */
  await batch(ELECTIVE_PLAN);
  const a = await onboarded('Asha Rao', 'asha@example.com', '9000000001');
  const z = await onboarded('Zoya Khan', 'zoya@example.com', '9000000002');
  /* before the start: the plan is readable, nothing can be sent */
  let me = await a.b.go('me', 'GET');
  assert.equal(me.status, 200);
  assert.equal(me.json.batch.week, 0);
  assert.equal(me.json.progress.need, 8);
  assert.equal(me.json.referral.link, `https://rapid-response.in/r/${a.code}`);
  assert.equal(me.json.referral.connected, false);
  assert.doesNotMatch(JSON.stringify(me.json), /keyHash|scrypt|email|mobile/i, 'nothing private comes back, not even their own email');
  assert.equal((await a.b.go('work', 'POST', { taskKey: 'law', links: ['https://drive.google.com/x'] })).status, 400);

  NOW = at('2026-11-10T06:00:00.000Z'); // week 1
  /* electives: exactly three, from the seven */
  assert.equal((await a.b.go('me', 'POST', { action: 'electives', electives: ['paper', 'talk'] })).status, 400);
  me = await a.b.go('me', 'POST', { action: 'electives', electives: ['paper', 'talk', 'cinekind'] });
  assert.equal(me.status, 200);
  assert.deepEqual(me.json.intern.electives, ['paper', 'talk', 'cinekind']);
  assert.equal((await a.b.go('work', 'POST', { taskKey: 'shelter', links: ['https://x.example/a'] })).status, 400, 'an elective not chosen');

  /* a file, then the proof */
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
  const up = await a.b.go('file', 'POST', { taskKey: 'law', name: 'test-result.png', type: 'image/png', data: png.toString('base64') });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.equal((await a.b.go('file', 'POST', { taskKey: 'law', name: 'x.png', type: 'image/png', data: Buffer.from('not a png').toString('base64') })).status, 415);
  assert.equal((await a.b.go('work', 'POST', { taskKey: 'law', links: ['javascript:alert(1)'] })).status, 400);
  me = await a.b.go('work', 'POST', { taskKey: 'law', links: ['https://drive.google.com/file/law-notes'], note: 'Notes on the four laws.', files: [up.json.file.id] });
  assert.equal(me.status, 200, JSON.stringify(me.json));
  assert.equal(me.json.progress.tasks.find((t) => t.key === 'law').state, 'submitted');
  /* another intern can neither read the file nor use it */
  assert.equal((await z.b.go('file', 'GET', null, { query: { id: up.json.file.id } })).status, 404);
  assert.equal((await z.b.go('work', 'POST', { taskKey: 'law', files: [up.json.file.id] })).status, 400);
  assert.equal((await a.b.go('file', 'GET', null, { query: { id: up.json.file.id } })).status, 200);
  assert.equal((await z.b.go('me', 'GET')).json.works.length, 0, 'Zoya sees only her own work');

  /* review: a revision, then acceptance; the intern is told each time */
  const q = await admin('GET', { query: { queue: 'review' } });
  assert.equal(q.json.queue.length, 1);
  assert.equal(q.json.queue[0].name, 'Asha Rao');
  assert.equal(q.json.queue[0].taskTitle, 'Learn the law');
  assert.equal((await admin('POST', { body: { action: 'review', internId: a.internId, taskKey: 'law', decision: 'revise', feedback: '' } })).status, 400, 'a revision says what to change');
  const rev = await admin('POST', { body: { action: 'review', internId: a.internId, taskKey: 'law', decision: 'revise', feedback: 'Add the PCA Act in your own words.' } });
  assert.equal(rev.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'asha@example.com');
  assert.match(sent[0].subject, /Please revise: Learn the law/);
  me = await a.b.go('me', 'GET');
  const w = me.json.works.find((x) => x.taskKey === 'law');
  assert.equal(w.state, 'revise');
  assert.equal(w.feedback, 'Add the PCA Act in your own words.');
  assert.ok(!('by' in w.history[0]), 'the intern does not see which staff member reviewed');
  me = await a.b.go('work', 'POST', { taskKey: 'law', links: ['https://drive.google.com/file/law-notes-2'] });
  assert.equal(me.json.works.find((x) => x.taskKey === 'law').round, 2);
  assert.equal((await admin('POST', { body: { action: 'review', internId: a.internId, taskKey: 'law', decision: 'accept', score: 11 } })).status, 400);
  const acc = await admin('POST', { body: { action: 'review', internId: a.internId, taskKey: 'law', decision: 'accept', score: 8.5, feedback: 'Clear.' } });
  assert.equal(acc.status, 200);
  assert.match(sent[1].subject, /Accepted: Learn the law/);
  me = await a.b.go('me', 'GET');
  assert.equal(me.json.progress.accepted, 1);
  assert.equal(me.json.progress.percent, 13);
  assert.equal(me.json.progress.average, 8.5);
  assert.equal((await a.b.go('work', 'POST', { taskKey: 'law', links: ['https://x.example/'] })).status, 409, 'accepted is final');
  /* audited */
  assert.deepEqual(audits.map((x) => x.action).filter((x) => /work/.test(x)), ['intern-work-revise', 'intern-work-accepted']);
  /* the panel's batch view */
  const view = await admin('GET', { query: { batch: (await S.listBatches(db))[0].batchId } });
  const asha = view.json.interns.find((r) => r.internId === a.internId);
  assert.equal(asha.progress.accepted, 1);
  assert.equal(asha.status, 'active');
});

test('reminders: on each week\'s Sunday, once per intern, only when something is open, logged', async () => {
  const id = await batch();
  const a = await onboarded('Asha Rao', 'asha@example.com', '9000000001');
  const z = await onboarded('Zoya Khan', 'zoya@example.com', '9000000002');
  NOW = at('2026-11-12T06:00:00.000Z');
  /* Asha has done week 1: the quiz marked it (lib/intern-quiz.js) */
  await db.collection('intern_work').doc(S.workId(a.internId, 'law')).set({ internId: a.internId, batchId: id, taskKey: 'law', state: 'accepted', score: 8, reviewedBy: 'quiz', history: [] });
  /* not Sunday: nothing */
  let r = await R.run({ db, nowMs: at('2026-11-14T06:00:00.000Z') });
  assert.deepEqual(r.reminders, []);
  assert.equal(sent.length, 0);
  /* Sunday 15 Nov, 9 am IST */
  const SUN = at('2026-11-15T03:30:00.000Z');
  r = await R.run({ db, nowMs: SUN });
  assert.deepEqual(r.reminders.map((x) => [x.week, x.sent]), [[1, 1]]);
  assert.equal(sent.length, 1, 'Asha sent hers; only Zoya is reminded');
  assert.equal(sent[0].to, 'zoya@example.com');
  assert.match(sent[0].subject, /week 1: 1 still open/);
  assert.match(sent[0].text, /Learn the law \(55-question quiz\)/);
  assert.match(sent[0].text, /Sun 15 Nov, 11:59 pm/);
  /* every later run that Sunday: no second email */
  await R.run({ db, nowMs: SUN + 600000 });
  await R.run({ db, nowMs: SUN + 6 * 3600000 });
  assert.equal(sent.length, 1);
  const log = (await R.logs(db, id))[0];
  assert.equal(log.week, 1);
  assert.equal(log.sent, 1);
  assert.equal(log.nothingOpen, 1);
  /* week 3: the RRT count against its target */
  sent = [];
  await db.collection('interns').doc(z.internId).set({ referral: { registrations: 12, clicks: 300 } }, { merge: true });
  await R.run({ db, nowMs: at('2026-11-29T03:30:00.000Z') });
  const zoya = sent.find((m) => m.to === 'zoya@example.com');
  assert.match(zoya.text, /Bring 50 people onto the RRT: 12 of 50 have registered/);
  assert.match(zoya.text, /Learn the law \(55-question quiz\) \(Overdue\)/);
  /* a closed batch is not reminded */
  sent = [];
  await db.collection('intern_batches').doc(id).set({ status: 'closed' }, { merge: true });
  await R.run({ db, nowMs: at('2026-12-06T03:30:00.000Z') });
  assert.equal(sent.length, 0);
});

test('RRT counts: codes registered with the self-referral hash, only registrations count, withdrawn on revoke', async () => {
  await batch();
  process.env.PFA_RRT_REFERRAL_SECRET = 'a-shared-secret-of-enough-length';
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (/\/referrals\/stats/.test(url)) {
      const codes = decodeURIComponent(/codes=([^&]+)/.exec(url)[1]).split(',');
      return { ok: true, status: 200, text: async () => JSON.stringify({ codes: Object.fromEntries(codes.map((c) => [c, { clicks: 120, storeVisits: 40, firstOpens: 25, registrations: 12 }])) }) };
    }
    return { ok: true, status: 200, text: async () => '{"ok":true}' };
  };
  const a = await onboarded('Asha Rao', 'asha@example.com', '9000000001');
  /* issued while the RRT was unreachable: registered on the refresh */
  const r = await admin('POST', { body: { action: 'referrals' } }, fetchImpl);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const reg = calls.find((c) => /\/referrals\/codes$/.test(c.url));
  assert.equal(reg.init.headers['x-pfa-referral-key'], 'a-shared-secret-of-enough-length');
  const sentBody = JSON.parse(reg.init.body);
  assert.equal(sentBody.code, a.code);
  assert.equal(sentBody.active, true);
  assert.equal(sentBody.ownerMobileHash, I.mobileHash('+91 90000 00001'));
  assert.ok(!reg.init.body.includes('9000000001'), 'the mobile is sent only as a hash');
  const me = await a.b.go('me', 'GET');
  assert.deepEqual([me.json.referral.registrations, me.json.referral.clicks, me.json.referral.storeVisits, me.json.referral.firstOpens], [12, 120, 40, 25]);
  assert.equal(me.json.progress.tasks.find((t) => t.key === 'rrt').count, 12, 'the target counts registrations only');
  /* revoked: the session ends, sign-in refused, the code withdrawn at the RRT */
  calls.length = 0;
  assert.equal((await admin('POST', { body: { action: 'revoke', internId: a.internId, reason: '' } }, fetchImpl)).status, 400);
  assert.equal((await admin('POST', { body: { action: 'revoke', internId: a.internId, reason: 'Left the internship' } }, fetchImpl)).status, 200);
  assert.equal(JSON.parse(calls.find((c) => /\/referrals\/codes$/.test(c.url)).init.body).active, false);
  assert.equal((await a.b.go('me', 'GET')).status, 401);
  assert.equal((await browser('192.0.2.50').go('session', 'POST', { internId: a.internId, key: a.key })).status, 403);
  /* without the secret nothing is sent */
  delete process.env.PFA_RRT_REFERRAL_SECRET;
  calls.length = 0;
  const off = await admin('POST', { body: { action: 'referrals' } }, fetchImpl);
  assert.equal(off.json.result.state, 'not-configured');
  assert.equal(calls.length, 0);
});

test('a new key only after PFA says how it verified the intern; the old key and sessions stop at once', async () => {
  await batch();
  const a = await onboarded('Asha Rao', 'asha@example.com', '9000000001');
  assert.equal((await admin('POST', { body: { action: 'regenerate', internId: a.internId, verifiedHow: 'ok' } })).status, 400);
  const r = await admin('POST', { body: { action: 'regenerate', internId: a.internId, verifiedHow: 'Called 9000000001, the number on her application' } });
  assert.equal(r.status, 200);
  assert.match(sent[0].subject, /new PFA internship access key/);
  assert.equal((await a.b.go('me', 'GET')).status, 401, 'the old session stops');
  assert.equal((await browser('192.0.2.60').go('session', 'POST', { internId: a.internId, key: a.key })).status, 401, 'the old key stops');
  const fresh = await browser('192.0.2.61').go('onboard', 'POST', { token: linkIn(sent[0]) });
  assert.equal(fresh.status, 200);
  assert.notEqual(fresh.json.key, a.key);
  assert.equal((await browser('192.0.2.62').go('session', 'POST', { internId: a.internId, key: fresh.json.key })).status, 200);
  assert.ok(audits.some((x) => x.action === 'intern-new-key' && /Called 9000000001/.test(x.detail)));
});

test('limits: file size and type, files per task, the Firestore fallback asks for a link', async () => {
  await batch();
  const a = await onboarded('Asha Rao', 'asha@example.com', '9000000001');
  NOW = at('2026-11-10T06:00:00.000Z');
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(950 * 1024)]);
  const r = await a.b.go('file', 'POST', { taskKey: 'map', name: 'map.jpg', type: 'image/jpeg', data: big.toString('base64') });
  assert.equal(r.status, 507, 'no Storage bucket: a file over 900 KB is refused, with the link alternative');
  assert.match(r.json.message, /as a link/);
  const tooBig = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(I.LIMITS.fileBytes)]);
  assert.equal((await a.b.go('file', 'POST', { taskKey: 'map', name: 'x.jpg', type: 'image/jpeg', data: tooBig.toString('base64') })).status, 413);
  assert.equal((await a.b.go('work', 'POST', { taskKey: 'map', links: Array.from({ length: 7 }, (_, i) => `https://x.example/${i}`) })).status, 400);
  const usage = await admin('GET');
  assert.equal(usage.json.usage.refused, 1);
});

test('wired: routes, rules, the worker, the panel and the page', () => {
  const index = read('api/index.js');
  for (const op of ['onboard', 'session', 'me', 'work', 'file']) assert.match(index, new RegExp(`'intern/${op}': \\(\\) => require\\('\\.\\./lib/routes/intern/portal\\.js'\\)\\.${op}`));
  assert.match(index, /'admin\/internship': \(\) => require\('\.\.\/lib\/routes\/admin\/internship\.js'\)/);
  const rules = read('firestore.rules');
  for (const c of ['intern_batches', 'interns', 'intern_codes', 'intern_onboard', 'intern_sessions', 'intern_work', 'intern_files', 'intern_usage', 'intern_reminders', 'intern_meta']) {
    assert.match(rules, new RegExp(`match /${c}/\\{id\\}\\s+\\{ allow read, write: if false; \\}`), c);
  }
  assert.match(read('lib/routes/caregiver/email-worker.js'), /require\('\.\.\/\.\.\/intern-reminders'\)\.run\(/);
  assert.ok(require('../lib/admin-modules').MODULE_KEYS.includes('internship'));
  const html = read('admin.html');
  assert.match(html, /data-tab="internship"/);
  assert.match(html, /function internshipPane\(/);
  const page = read('intern.html');
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(page, /'X-PFA-Intern'\] = '1'/);
  assert.match(page, /history\.replaceState\(null, '', location\.pathname\)/, 'the onboarding secret leaves the address bar');
  assert.doesNotMatch(page, /[–—]/);
  const own = page.slice(page.indexOf("The intern's side of the internship portal"));
  assert.doesNotMatch(own, /localStorage|sessionStorage|document\.cookie/, 'the key and session are never stored by the page');
  assert.match(read('internship.html'), /href="intern\.html"/);
});
