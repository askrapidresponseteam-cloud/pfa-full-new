'use strict';

/* Who the confirmation goes to (8 Oct 2026, review B, finding 1).

   The intake sent the confirmation to the first value shaped like an email,
   in field order. On report.html "Who is doing it" comes before "Email", so a
   reporter who typed the abuser's address there had the confirmation - their
   own name, the reference and the tracking link - sent to the person they
   were reporting. These pin that it goes only to the field the form names as
   the sender's email, for every public form, and that one address cannot be
   sent an endless stream of them. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const S = require('../lib/submissions');
const { createHandler } = require('../lib/routes/pfa-submissions')._private;
const { PLACE } = require('./_place');

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

function build(db, { mails = [], queue = null } = {}) {
  return createHandler({
    getDb: () => db,
    deliver: async (m) => { mails.push(m); return { providerId: 'p' }; },
    isConfigured: () => true,
    smtpConfigured: () => false,
    now: () => Date.now(),
    queue
  });
}

/* What the real pages send (the same values as
   test/submissions-end-to-end.test.js), in the pages' own field order. */
const LONG = 'A community dog near the vegetable market has a deep wound on its back leg and is limping. It needs a vet soon.';
const FORMS = {
  'PFA-CR': { what: LONG, animal: 'Dog', urgency: 'Happening now', location: 'New Delhi, Delhi', pincode: '110001', when: 'This morning, around 8', accused: 'Not known', name: 'Asha Rao', mobile: '9876543210', email: 'sender@example.com' },
  'PFA-Q': { question: LONG, topic: 'An animal I found or feed', state: 'Delhi', city: 'New Delhi', name: 'Asha Rao', mobile: '9876543210', email: 'sender@example.com' },
  'PFA-J': { role: 'Zonal Head - North North', roleId: 'zonal-head', zone: 'North North', name: 'Asha Rao', city: 'New Delhi, Delhi', mobile: '9876543210', email: 'sender@example.com', pfaMember: 'Yes', unit: 'PFA Delhi, volunteer', background: 'Five years of rescue work with community animals', travel: 'Yes', link: 'https://www.youtube.com/watch?v=LCwIbbSg-8E' },
  'PFA-EV': { title: 'An adoption drive', city: 'New Delhi, Delhi', address: 'Near The Vegetable Market, Lajpat Nagar', name: 'Asha Rao', mobile: '9876543210', email: 'sender@example.com', notes: LONG },
  'PFA-V': { name: 'Asha Rao', mobile: '9876543210', email: 'sender@example.com', city: 'New Delhi, Delhi', title: 'Volunteer: Head Office', notes: LONG },
  'PFA-CK': { nominee: 'Kalyan Varma', category: 'A film or documentary', work: 'Wild Karnataka', link: 'https://www.youtube.com/watch?v=LCwIbbSg-8E', why: LONG, name: 'Asha Rao', mobile: '9876543210', email: 'sender@example.com' },
  'PFA-S': { url: 'https://www.youtube.com/watch?v=LCwIbbSg-8E', wall: 'Long form, over three minutes', name: 'Asha Rao', email: 'sender@example.com', notes: 'Consent given for PFA to show this on The Wall.', mobile: '9876543210' }
};
/* every form now sends an address (test/_place.js) */
Object.values(FORMS).forEach((f) => Object.assign(f, PLACE));

test.beforeEach(() => { S.resetForTests(); process.env.PFA_SUBMISSIONS_INBOX = 'off'; });
test.after(() => { delete process.env.PFA_SUBMISSIONS_INBOX; firebase._setDbForTests(null); });

test('B1: an address typed under "Who is doing it" is never sent the reporter\'s confirmation', async () => {
  const db = memoryFirestore(); firebase._setDbForTests(db);
  const mails = [];
  const res = await call(build(db, { mails }), { body: {
    kind: 'PFA-CR', page: 'report.html', clientRequestId: 'b1-accused',
    data: Object.assign({}, FORMS['PFA-CR'], { accused: 'ramesh.abuser@example.com', email: 'reporter@example.com' })
  } });
  assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
  assert.deepEqual(mails.map((m) => m.to), ['reporter@example.com'], 'the confirmation went to someone other than the reporter');
  assert.equal(res.json.confirmation.to, 'reporter@example.com');
  assert.ok(!res.raw.includes('ramesh.abuser'), 'the page names the accused as where the email went');
});

test('B1: every public form confirms to its own email field, wherever another address sits', async () => {
  for (const [kind, fields] of Object.entries(FORMS)) {
    const db = memoryFirestore(); firebase._setDbForTests(db);
    S.resetForTests();
    const mails = [];
    /* an address in a field that is not the sender's, placed first */
    const data = Object.assign({ friend: 'someone.else@example.com' }, fields);
    const res = await call(build(db, { mails }), { body: { kind, data, clientRequestId: `b1-${kind}` } });
    assert.equal(res.statusCode, 200, `${kind}: ${res.raw.slice(0, 300)}`);
    assert.deepEqual(mails.map((m) => m.to), ['sender@example.com'], `${kind}: confirmed to the wrong address`);
    assert.equal(res.json.confirmation.state, 'sent', `${kind}: lost its confirmation`);
  }
});

test('B1: a kind that gives its email as "contact" keeps its confirmation', async () => {
  const db = memoryFirestore(); firebase._setDbForTests(db);
  const mails = [];
  const res = await call(build(db, { mails }), { body: { kind: 'PFA-C', data: { summary: 'Dog chained on a terrace with no water', contact: 'Asha@Example.com' } } });
  assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
  assert.deepEqual(mails.map((m) => m.to), ['asha@example.com']);
});

test('B1: the panel\'s contact for a report is the reporter, not the person accused', () => {
  /* a reply from the panel goes to contactOf().email; the panel shows .mobile to call */
  const byEmail = { what: LONG, accused: 'ramesh.abuser@example.com', name: 'asha rao', mobile: '9876543210', email: 'reporter@example.com' };
  assert.deepEqual(S.contactOf(byEmail), { name: 'Asha Rao', email: 'reporter@example.com', mobile: '9876543210' });
  const byMobile = { what: LONG, accused: 'Ramesh 98111 22333', name: 'asha rao', mobile: '9876543210', email: 'reporter@example.com' };
  assert.equal(S.contactOf(byMobile).mobile, '9876543210', 'the accused\'s mobile was taken for the reporter\'s');
  /* a record from before the forms named their fields still has a contact */
  assert.equal(S.contactOf({ 'where to reach you': 'old@example.com' }).email, 'old@example.com');
});

test('C1: the confirmation is deduplicated per conversation, not per number alone', async () => {
  const db = memoryFirestore(); firebase._setDbForTests(db);
  const rows = [];
  const queue = {
    async queueEmail(row) { rows.push(row); return { emailId: `e${rows.length}`, created: true }; },
    async recordEmailResult() { return {}; }
  };
  const res = await call(build(db, { queue }), { body: { kind: 'PFA-Q', data: FORMS['PFA-Q'], clientRequestId: 'c1' } });
  assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
  const record = db.dump()[`submissions/${res.json.reference}`];
  assert.ok(record.threadId, 'the record has its conversation');
  assert.equal(rows[0].dedupeKey, `submission_received:${res.json.reference}:${record.threadId}`);
});

test('B7: one address is sent at most five confirmations an hour, and every submission is still filed', async () => {
  const db = memoryFirestore(); firebase._setDbForTests(db);
  const mails = [];
  const handler = build(db, { mails });
  const answers = [];
  for (let i = 0; i < 8; i += 1) {
    /* eight connections, so only the per-address cap can stop the letters */
    const res = await call(handler, { ip: `203.0.113.${i + 1}`, body: { kind: 'PFA-CR', data: Object.assign({}, FORMS['PFA-CR'], { email: 'victim@example.com' }), clientRequestId: `cap-${i}` } });
    assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
    answers.push(res.json);
  }
  assert.equal(mails.filter((m) => m.to === 'victim@example.com').length, S.CONFIRM_LIMIT);
  assert.equal(new Set(answers.map((a) => a.reference)).size, 8, 'a submission was refused, not just its letter');
  assert.equal(answers[7].confirmation.state, 'unsent', 'the page must not claim an email went');
  assert.equal(answers[7].acknowledged, false);
});
