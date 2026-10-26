'use strict';

/* What the sender sees of their own case (8 Oct 2026, review A, findings 4,
   5, 6 and 12; CONTRACT.md section 1).

   The public timeline showed every internal event as another "Received"
   (an assignment, the wall, a note), sent the raw status "spam", called the
   sender's own email "PFA replied by email", and showed a volunteer whose
   application was approved as "Received". And the panel's register search
   passed whatever was typed straight to Firestore as a document id. */

const test = require('node:test');
const assert = require('node:assert/strict');

/* The admin panel's sign-in, stood in for: the token "test-admin" is a super
   administrator. Installed before anything loads firebase-admin/auth. */
const authPath = require.resolve('firebase-admin/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    getAuth: () => ({
      async verifyIdToken(token) { if (token !== 'test-admin') throw new Error('bad token'); return { uid: 'u1', email: 'admin@pfa.test' }; },
      async getUser() { return { uid: 'u1', email: 'admin@pfa.test', customClaims: { admin: true, role: 'super' } }; }
    })
  }
};

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const S = require('../lib/submissions');

const at = (d) => `2026-10-0${d}T10:00:00.000Z`;
const labels = (view) => view.timeline.map((t) => t.label);

test('A5: internal events never reach the sender\'s timeline', () => {
  const view = S.publicView({
    reference: 'PFA-CR-2026-00001', kind: 'PFA-CR', status: 'new', createdAt: at(1),
    history: [
      { status: 'new', at: at(1) },
      { status: 'new', event: 'assign', to: 'desk@pfa.test', at: at(2), by: 'a@pfa.test' },
      { status: 'new', event: 'assign', to: '', at: at(3), by: 'a@pfa.test' },
      { status: 'new', event: 'wall-publish', at: at(4), by: 'a@pfa.test' },
      { status: 'new', event: 'wall-remove', at: at(5), by: 'a@pfa.test' },
      { status: 'new', event: 'note', at: at(6), by: 'a@pfa.test' },
      { status: 'new', event: 'bounce', at: at(7), by: 'mailer' },
      { status: 'new', event: 'reply', direction: 'in', party: 'other', at: at(8), by: 'x@y.in' },
      { status: 'new', event: 'something-new', at: at(9), by: 'a@pfa.test' }
    ]
  });
  assert.deepEqual(labels(view), ['Received']);
  assert.equal(view.updatedAt, at(1));
});

test('A5: "spam" never leaves the server; it is closed', () => {
  const view = S.publicView({
    reference: 'PFA-Q-2026-00007', kind: 'PFA-Q', status: 'spam', createdAt: at(1),
    history: [{ status: 'new', at: at(1) }, { status: 'spam', at: at(2), by: 'a@pfa.test' }]
  });
  assert.equal(view.status, 'closed');
  assert.equal(view.statusLabel, 'Closed');
  assert.deepEqual(view.timeline[1], { status: 'closed', label: 'Closed', at: at(2) });
  assert.ok(!JSON.stringify(view).includes('spam'), 'the word spam is in the public answer');
});

test('A4/A5: a reopen says Reopened, and each email is named by who wrote it', () => {
  const view = S.publicView({
    reference: 'PFA-C-2026-00003', kind: 'PFA-C', status: 'new', createdAt: at(1),
    history: [
      { status: 'new', at: at(1) },
      { status: 'in-progress', at: at(2), by: 'a@pfa.test' },
      { status: 'in-progress', event: 'reply', direction: 'out', at: at(2), by: 'a@pfa.test', n: 1 },
      { status: 'handled', at: at(3), by: 'a@pfa.test' },
      { status: 'handled', event: 'reply', direction: 'in', party: 'sender', at: at(4), by: 'asha@example.com' },
      { status: 'new', event: 'reopen', reason: 'sender-replied', at: at(4), by: 'asha@example.com' },
      { status: 'new', event: 'reply', direction: 'in', party: 'staff', at: at(5), by: 'info@pfa.test' }
    ]
  });
  assert.deepEqual(labels(view), ['Received', 'Being handled', 'PFA replied by email', 'Closed', 'You wrote to PFA', 'Reopened', 'PFA replied by email']);
  assert.equal(view.statusLabel, 'Received');
  /* a reply row from before directions were recorded is PFA's own */
  const legacy = S.publicView({ kind: 'PFA-C', status: 'in-progress', createdAt: at(1), history: [{ status: 'new', at: at(1) }, { status: 'in-progress', event: 'reply', at: at(2) }] });
  assert.deepEqual(labels(legacy), ['Received', 'PFA replied by email']);
});

test('A5: the same words twice in a row are shown once, at the first', () => {
  const view = S.publicView({
    reference: 'PFA-Q-2026-00009', kind: 'PFA-Q', status: 'handled', createdAt: at(1),
    history: [
      { status: 'new', at: at(1) },
      { status: 'new', at: at(2), by: 'a@pfa.test' },
      { status: 'in-progress', at: at(3), by: 'a@pfa.test' },
      { status: 'in-progress', at: at(4), by: 'b@pfa.test' },
      { status: 'handled', at: at(5), by: 'a@pfa.test' },
      { status: 'spam', at: at(6), by: 'a@pfa.test' }
    ]
  });
  assert.deepEqual(view.timeline.map((t) => [t.label, t.at]), [['Received', at(1)], ['Being handled', at(3)], ['Closed', at(5)]]);
});

test('A6 (public half): a kind with its own stages shows its stage and what comes next', () => {
  const cases = [
    ['PFA-V', 'approved', 'Approved', /volunteer register/],
    ['PFA-V', 'shortlisted', 'Shortlisted', /in touch/],
    ['PFA-CG', 'verified', 'Verified', /card is being prepared/],
    ['PFA-MEM', 'dispatched', 'Sent by courier', /on their way by courier/]
  ];
  for (const [kind, status, label, next] of cases) {
    const view = S.publicView({ kind, status, createdAt: at(1), history: [{ status: 'new', at: at(1) }, { status, at: at(2), by: 'a@pfa.test' }] });
    assert.equal(view.statusLabel, label, `${kind} ${status}`);
    assert.match(view.next, next);
    assert.equal(view.status, status);
    assert.equal(view.timeline[view.timeline.length - 1].label, label);
  }
  /* a generic status on a staged kind (moved under the old flow) keeps its generic words */
  assert.equal(S.publicView({ kind: 'PFA-V', status: 'handled', createdAt: at(1) }).statusLabel, 'Closed');
});

test('A12: a register search for something that is not a reference finds nothing, and never fails', async () => {
  /* The real Firestore client throws on an id with a slash ("must point to a
     document"); this stand-in does the same. */
  const db = memoryFirestore();
  const realCollection = db.collection;
  db.collection = (name) => {
    const c = realCollection(name);
    const realDoc = c.doc;
    c.doc = (id) => {
      if (id !== undefined && (!String(id) || /\//.test(String(id)) || /^__.*__$/.test(String(id)))) {
        throw new Error(`Value for argument "documentPath" must point to a document, but was "${id}".`);
      }
      return realDoc(id);
    };
    return c;
  };
  firebase._setDbForTests(db);
  const records = require('../lib/routes/admin/records.js');
  const ask = (q) => new Promise((resolve, reject) => {
    const out = { statusCode: 200 };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader() {}, getHeader() {}, writeHead(code) { out.statusCode = code; },
      end(raw) { out.json = JSON.parse(String(raw || '{}')); resolve(out); }
    };
    Promise.resolve(records({ method: 'GET', url: '/api', query: { type: 'submissions', q }, headers: { authorization: 'Bearer test-admin', host: 'pfa.test' } }, response)).catch(reject);
  });
  try {
    for (const q of ['PFA-Q/2026', '__name__', 'x/y/z']) {
      const res = await ask(q);
      assert.equal(res.statusCode, 200, `${q}: ${JSON.stringify(res.json)}`);
      assert.deepEqual(res.json.rows, []);
    }
    await db.collection('submissions').doc('PFA-Q-2026-00001').create({ reference: 'PFA-Q-2026-00001', kind: 'PFA-Q', status: 'new', fields: {}, createdAt: at(1), receivedAtMs: 1 });
    const found = await ask(' pfa-q-2026-00001 ');
    assert.equal(found.json.rows.length, 1, 'a real reference is still found');
  } finally {
    firebase._setDbForTests(null);
  }
});
