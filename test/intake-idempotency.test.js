'use strict';

/* One submission, one record, one number (8 Oct 2026, review B, findings 2
   and 8; review D, finding 10).

   The double-send key was written only after the emails had gone, two to
   nine seconds after the number was taken, so a second press in that time
   filed a second record. Any failure after the record was written (a
   photograph, say) answered "Nothing was saved", so the retry filed another.
   And the number was taken before the photographs were checked, so a refused
   photograph spent a number that then existed nowhere.

   Now everything is judged first; the key, the number and the record are
   written in one transaction; and the work after that (photographs, emails)
   is safe to repeat, so a repeat of an unfinished attempt finishes it. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const S = require('../lib/submissions');
const { createHandler } = require('../lib/routes/pfa-submissions')._private;
const { PLACE } = require('./_place');

const NOW = Date.UTC(2026, 9, 8, 6, 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function call(handler, { method = 'POST', body, query = {}, headers = {}, ip = '198.51.100.7' }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api', query, body, socket: { remoteAddress: ip }, headers: Object.assign({ host: 'pfa.test', 'content-type': 'application/json' }, headers) };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

function build(db, { mails = [] } = {}) {
  return createHandler({
    getDb: () => db,
    deliver: async (m) => { mails.push(m); return { providerId: 'p' }; },
    isConfigured: () => true,
    smtpConfigured: () => false,
    now: () => NOW,
    queue: null
  });
}

const CR = {
  what: 'A community dog near the vegetable market has a deep wound on its back leg and is limping.',
  animal: 'Dog', urgency: 'Happening now', location: 'New Delhi, Delhi', pincode: '110001',
  when: 'This morning, around 8', accused: 'Not known', name: 'Asha Rao', mobile: '9876543210', email: 'reporter@example.com'
};
/* every form now sends an address (test/_place.js) */
Object.assign(CR, PLACE);
const PHOTO = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64, 3)]).toString('base64');

const records = (db) => Object.keys(db.dump()).filter((k) => /^submissions\/[^/]+$/.test(k));
const claims = (db) => Object.entries(db.dump()).filter(([k]) => k.startsWith('submissionIdempotency/')).map(([, v]) => v);
const counter = (db) => (db.dump()['counters/submissions'] || {});

/* Makes the photographs' documents behave as `decide(call, n)` says:
   'fail' (a transient Firestore error), 'hang' (an instance that dies there)
   or anything else (written as normal). */
function attachmentsThat(db, decide) {
  const realCollection = db.collection;
  let calls = 0;
  db.collection = (name) => {
    const c = realCollection(name);
    if (name !== 'submissions') return c;
    const realDoc = c.doc;
    c.doc = (id) => {
      const d = realDoc(id);
      const realSub = d.collection;
      d.collection = (sub) => {
        const s = realSub(sub);
        if (sub !== 'attachments') return s;
        const realAttachment = s.doc;
        s.doc = (n) => {
          const r = realAttachment(n);
          const realCreate = r.create;
          r.create = (value) => {
            calls += 1;
            const what = decide(calls, n);
            if (what === 'fail') return Promise.reject(Object.assign(new Error('14 UNAVAILABLE: try again'), { code: 14 }));
            if (what === 'hang') return new Promise(() => {});
            return realCreate(value);
          };
          return r;
        };
        return s;
      };
      return d;
    };
    return c;
  };
}

test.beforeEach(() => { S.resetForTests(); process.env.PFA_SUBMISSIONS_INBOX = 'off'; });
test.after(() => { delete process.env.PFA_SUBMISSIONS_INBOX; firebase._setDbForTests(null); });

test('B2: the same submission posted twice at the same moment is one record with one number', async () => {
  const db = memoryFirestore({ latency: 3 }); firebase._setDbForTests(db);
  const handler = build(db);
  const body = { kind: 'PFA-CR', data: CR, page: 'report.html', clientRequestId: 'pressed-twice', photos: [PHOTO] };
  const [a, b] = await Promise.all([call(handler, { body }), call(handler, { body })]);
  assert.equal(a.statusCode, 200, a.raw.slice(0, 300));
  assert.equal(b.statusCode, 200, b.raw.slice(0, 300));
  assert.equal(a.json.reference, b.json.reference, 'two numbers for one submission');
  assert.deepEqual(records(db), [`submissions/${a.json.reference}`]);
  assert.equal(counter(db)['PFA-CR-2026'], 1, 'a second number was taken');
  assert.equal([a.json.duplicate, b.json.duplicate].filter(Boolean).length, 1, 'exactly one of them is the repeat');
  assert.ok(db.dump()[`submissions/${a.json.reference}/attachments/1`], 'the photograph is kept');
});

test('B2: a photograph that cannot be kept never turns a filed record into "Nothing was saved"', async () => {
  const db = memoryFirestore(); firebase._setDbForTests(db);
  attachmentsThat(db, () => 'fail');
  const mails = [];
  const handler = build(db, { mails });
  const body = { kind: 'PFA-CR', data: CR, clientRequestId: 'photo-lost', photos: [PHOTO] };
  const first = await call(handler, { body });
  assert.equal(first.statusCode, 200, first.raw.slice(0, 300));
  assert.match(first.json.reference, /^PFA-CR-2026-00001$/);
  assert.doesNotMatch(first.raw, /Nothing was saved/);
  assert.equal(first.json.attachments, 0);
  assert.equal(first.json.photosNotKept, 1);
  assert.match(first.json.photoNotice, /photograph could not be kept/);
  assert.match(first.json.confirmation.lines[0], /photograph could not be kept/, 'the page shows it beside the number');
  assert.equal(db.dump()[`submissions/${first.json.reference}`].attachments, 0, 'the record counts only what is there');
  assert.deepEqual(mails.map((m) => m.to), ['reporter@example.com'], 'the sender is still confirmed');
  assert.equal(claims(db)[0].state, 'filed');

  const retry = await call(handler, { body });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json.reference, first.json.reference);
  assert.equal(retry.json.duplicate, true);
  assert.equal(retry.json.photosNotKept, 1, 'the repeat is told what the first was told');
  assert.equal(records(db).length, 1);
});

test('B2: a photograph that fails once is tried again and kept', async () => {
  const db = memoryFirestore(); firebase._setDbForTests(db);
  attachmentsThat(db, (n) => (n === 1 ? 'fail' : 'ok'));
  const res = await call(build(db), { body: { kind: 'PFA-CR', data: CR, clientRequestId: 'photo-flaky', photos: [PHOTO] } });
  assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
  assert.equal(res.json.attachments, 1);
  assert.equal(res.json.photoNotice, undefined);
  assert.ok(db.dump()[`submissions/${res.json.reference}/attachments/1`]);
});

test('B2: a repeat that finds the first attempt unfinished finishes it, without a second number', async () => {
  const db = memoryFirestore(); firebase._setDbForTests(db);
  /* the first attempt dies while keeping the photograph */
  attachmentsThat(db, (n) => (n === 1 ? 'hang' : 'ok'));
  const mails = [];
  const handler = build(db, { mails });
  const body = { kind: 'PFA-CR', data: CR, clientRequestId: 'died-part-way', photos: [PHOTO] };
  call(handler, { body });   // never answers
  for (let i = 0; i < 200 && !claims(db).length; i += 1) await sleep(5);
  assert.equal(claims(db)[0] && claims(db)[0].state, 'filing', 'the key is taken with the number, before the photographs');
  assert.equal(mails.length, 0);

  const again = await call(handler, { body });
  assert.equal(again.statusCode, 200, again.raw.slice(0, 300));
  assert.equal(again.json.reference, 'PFA-CR-2026-00001');
  assert.equal(again.json.duplicate, true);
  assert.equal(again.json.attachments, 1);
  assert.deepEqual(records(db), ['submissions/PFA-CR-2026-00001']);
  assert.equal(counter(db)['PFA-CR-2026'], 1);
  assert.ok(db.dump()['submissions/PFA-CR-2026-00001/attachments/1'], 'the photograph was kept by the repeat');
  assert.deepEqual(mails.map((m) => m.to), ['reporter@example.com'], 'the confirmation went, once');
  assert.equal(claims(db)[0].state, 'filed');
  assert.equal(claims(db)[0].confirmation.state, 'sent');
});

test('D10: when the second of two photographs cannot be kept, the record counts one and the answer gives the number', async () => {
  const db = memoryFirestore(); firebase._setDbForTests(db);
  attachmentsThat(db, (call, n) => (String(n) === '2' ? 'fail' : 'ok'));
  const body = { kind: 'PFA-CR', data: CR, clientRequestId: 'half-kept', photos: [PHOTO, PHOTO] };
  const first = await call(build(db), { body });
  assert.equal(first.statusCode, 200, first.raw.slice(0, 300));
  assert.equal(first.json.attachments, 1);
  assert.equal(first.json.photosNotKept, 1);
  const record = db.dump()[`submissions/${first.json.reference}`];
  assert.equal(record.attachments, 1, 'the record names a photograph that is not there');
  assert.equal(record.attachmentsNotKept, 1);
  assert.ok(db.dump()[`submissions/${first.json.reference}/attachments/1`]);
  const retry = await call(build(db), { body });
  assert.equal(retry.json.reference, first.json.reference);
  assert.equal(records(db).length, 1);
});

test('B8: a refused photograph, a refused field or a failed write spends no number', async () => {
  const db = memoryFirestore(); firebase._setDbForTests(db);
  const handler = build(db);
  const badPhoto = await call(handler, { body: { kind: 'PFA-CR', data: CR, clientRequestId: 'k1', photos: ['data:image/png;base64,AAAA'] } });
  assert.equal(badPhoto.statusCode, 422);
  const badField = await call(handler, { body: { kind: 'PFA-CR', data: Object.assign({}, CR, { animal: 'Dragon' }), clientRequestId: 'k2' } });
  assert.equal(badField.statusCode, 422);

  /* the record's own write fails: nothing at all is kept, and saying so is true */
  const realCollection = db.collection;
  let broken = true;
  db.collection = (name) => {
    const c = realCollection(name);
    if (name !== 'submissions') return c;
    const realDoc = c.doc;
    c.doc = (id) => { const d = realDoc(id); const realSet = d._set; d._set = (...args) => { if (broken) throw Object.assign(new Error('4 DEADLINE_EXCEEDED'), { code: 4 }); return realSet(...args); }; return d; };
    return c;
  };
  const failed = await call(handler, { body: { kind: 'PFA-CR', data: CR, clientRequestId: 'k3' } });
  assert.equal(failed.statusCode, 500);
  assert.match(failed.json.error, /Nothing was saved/);
  broken = false;

  const good = await call(handler, { body: { kind: 'PFA-CR', data: CR, clientRequestId: 'k4' } });
  assert.equal(good.statusCode, 200, good.raw.slice(0, 300));
  assert.equal(good.json.reference, 'PFA-CR-2026-00001', 'a number was spent on something that was never filed');
  assert.equal(counter(db)['PFA-CR-2026'], 1);
  assert.equal(claims(db).length, 1, 'a refused or failed attempt left a key behind');
});

test('guard: a form posted with no key, and a page with no script, still file as before', async () => {
  const db = memoryFirestore(); firebase._setDbForTests(db);
  const handler = build(db);
  const json = await call(handler, { body: { kind: 'PFA-CR', data: CR } });
  assert.equal(json.statusCode, 200);
  assert.equal(json.json.duplicate, undefined);

  const flat = new URLSearchParams(Object.assign({ kind: 'PFA-CR', page: 'report.html' }, CR)).toString();
  const html = await call(handler, { body: flat, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(html.statusCode, 200);
  assert.match(html.headers['content-type'], /text\/html/);
  assert.match(html.raw, /PFA-CR-2026-00002/);
  assert.equal(claims(db).length, 0);
});

test('guard: a key written before this change (no state) is answered as the replay it is', async () => {
  const db = memoryFirestore(); firebase._setDbForTests(db);
  await db.collection('submissionIdempotency').doc(firebase.hashKey('PFA-CR:old-key')).create({
    reference: 'PFA-CR-2026-00007', kind: 'PFA-CR', createdAt: '2026-10-07T10:00:00.000Z', acknowledged: true, attachments: 0,
    confirmation: { state: 'sent', to: 'reporter@example.com' }
  });
  const res = await call(build(db), { body: { kind: 'PFA-CR', data: CR, clientRequestId: 'old-key' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.reference, 'PFA-CR-2026-00007');
  assert.equal(res.json.duplicate, true);
  assert.equal(res.json.confirmation.state, 'sent');
  assert.deepEqual(records(db), [], 'nothing new is filed');
});
