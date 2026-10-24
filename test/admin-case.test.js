'use strict';

/* Working a case: reply to the sender, keep a note, hand it over, change its
   status. Everything is recorded; nothing is deleted; the sender's public
   timeline shows that a reply went out without showing what it said. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const S = require('../lib/submissions');
const { createHandler: createCase } = require('../lib/routes/admin/case')._private;
const { createHandler: createIntake } = require('../lib/routes/pfa-submissions')._private;
const mail = require('../lib/caregiver-mail');
const { PLACE } = require('./_place');

/* Firestore as far as these routes use it: documents, subcollections with
   orderBy/limit, arrayUnion and increment. */
function fakeDb() {
  const store = new Map();
  const key = (c, id) => `${c}/${id}`;
  const apply = (prev, data) => {
    const out = Object.assign({}, prev);
    Object.keys(data).forEach((k) => {
      const v = data[k];
      if (v && v.__union) out[k] = (Array.isArray(prev[k]) ? prev[k] : []).concat([v.__union]);
      else if (v && typeof v.__inc === 'number') out[k] = (Number(prev[k]) || 0) + v.__inc;
      else out[k] = v;
    });
    return out;
  };
  const docRef = (c, id) => ({
    id,
    collection: (sub) => collectionRef(`${c}/${id}/${sub}`),
    async get() { const data = store.get(key(c, id)); return { exists: Boolean(data), id, data: () => data }; },
    async create(data) { if (store.has(key(c, id))) throw new Error('exists'); store.set(key(c, id), apply({}, data)); },
    async set(data, opts) { store.set(key(c, id), apply((opts && opts.merge && store.get(key(c, id))) || {}, data)); }
  });
  const collectionRef = (c) => ({
    doc: (id) => docRef(c, id),
    orderBy() { return this; },
    limit() { return this; },
    async get() {
      const docs = [...store.entries()].filter(([k]) => k.startsWith(c + '/') && !k.slice(c.length + 1).includes('/'))
        .map(([k, v]) => ({ id: k.slice(c.length + 1), data: () => v, exists: true }))
        .sort((a, b) => String(a.data().at || '').localeCompare(String(b.data().at || '')));
      return { docs, empty: !docs.length, size: docs.length };
    }
  });
  return {
    store,
    collection: (c) => collectionRef(c),
    async runTransaction(fn) { return fn({ get: (ref) => ref.get(), set: (ref, data, opts) => ref.set(data, opts) }); }
  };
}
const fieldValue = () => ({ arrayUnion: (v) => ({ __union: v }), increment: (n) => ({ __inc: n }) });

function request({ method = 'POST', body, query = {}, headers = {} } = {}) {
  const r = new EventEmitter(); r.method = method; r.query = query; r.headers = headers;
  if (body !== undefined) process.nextTick(() => { r.emit('data', JSON.stringify(body)); r.emit('end'); });
  return r;
}
async function run(handler, req) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b || '{}'); } };
  await handler(req, res); return res;
}

const NOW = Date.UTC(2026, 7, 23, 7, 0);
const requireAdmin = async () => ({ uid: 'u1', email: 'karthik@pfa.org', name: 'Karthik', mode: 'firebase' });

async function seeded() {
  const db = fakeDb();
  const intake = createIntake({ getDb: () => db, deliver: async () => ({}), isConfigured: () => false, now: () => NOW - 3600000 });
  await run(intake, request({ body: { kind: 'PFA-C', data: { summary: 'Dog chained on a terrace with no water', name: 'asha kumar', contact: 'asha@example.com' } } }));
  await run(intake, request({ body: { kind: 'PFA-Q', data: { question: 'Do you take in injured birds at the Delhi unit?', topic: 'Something else', ...PLACE, name: 'ravi menon', contact: '9876543210', email: 'ravi@example.com' } } }));
  /* A record filed before email was required (16 Sep 2026): the panel still
     has to handle one with no email on file, so the seed takes it back off. */
  { const legacy = db.store.get('submissions/PFA-Q-2026-00001'); if (legacy && legacy.fields) delete legacy.fields.email; }
  return db;
}

test('a reply is emailed to the sender, recorded on the case, and moves a new case to in-progress', async () => {
  const db = await seeded();
  const sent = [];
  const handler = createCase({ getDb: () => db, fieldValue, requireAdmin, deliver: async (m) => { sent.push(m); return {}; }, isConfigured: () => true, now: () => NOW });
  const res = await run(handler, request({ body: { reference: 'pfa-c-2026-00001', action: 'reply', text: 'Thank you. The Udupi unit will visit tomorrow.\n\nPlease keep the dog in sight.' }, headers: { host: 'peopleforanimalsindia.org' } }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.delivered, true);
  assert.equal(res.body.status, 'in-progress');
  assert.equal(sent[0].to, 'asha@example.com');
  assert.equal(sent[0].template, 'submission_reply');
  assert.equal(sent[0].payload.name, 'Asha Kumar');
  assert.match(sent[0].payload.followUrl, /^https:\/\/peopleforanimalsindia\.org\/track\.html#ref=PFA-C-2026-00001$/);
  assert.match(sent[0].payload.signoff, /Karthik, People for Animals/);

  const rendered = mail.render('submission_reply', sent[0].payload);
  /* "Re:" the letter's own subject, so the reply threads with it in Gmail and Outlook (v1.399) */
  assert.equal(rendered.subject, 'Re: Your request is in - PFA-C-2026-00001');
  assert.ok(rendered.html.includes('Please keep the dog in sight.') && rendered.html.includes('<br>') === false, 'paragraphs, not raw breaks, inside one paragraph');
  assert.ok(rendered.text.includes('Thank you. The Udupi unit will visit tomorrow.'));

  const doc = db.store.get('submissions/PFA-C-2026-00001');
  assert.equal(doc.status, 'in-progress');
  assert.equal(doc.replyCount, 1);
  const msgs = [...db.store.keys()].filter((k) => k.startsWith('submissions/PFA-C-2026-00001/messages/'));
  assert.equal(msgs.length, 1);
  assert.equal(db.store.get(msgs[0]).type, 'reply');

  /* The sender sees that PFA replied, and when - never the text. */
  const view = S.publicView(doc);
  assert.deepEqual(view.timeline.map((t) => t.label), ['Received', 'Being handled', 'PFA replied by email']);
  assert.ok(!JSON.stringify(view).includes('Udupi unit'));

  const detail = await run(handler, request({ method: 'GET', query: { reference: 'PFA-C-2026-00001' } }));
  assert.equal(detail.body.case.messages.length, 1);
  assert.equal(detail.body.case.contact.email, 'asha@example.com');
  assert.equal(detail.body.case.statusLabel, 'In progress');
});

test('a reply that the provider refuses is kept on the case as not delivered, and the status does not move', async () => {
  const db = await seeded();
  const handler = createCase({ getDb: () => db, fieldValue, requireAdmin, deliver: async () => { throw new Error('mailbox does not exist'); }, isConfigured: () => true, now: () => NOW });
  const res = await run(handler, request({ body: { reference: 'PFA-C-2026-00001', action: 'reply', text: 'Hello' } }));
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.delivered, false);
  assert.match(res.body.message, /not delivered: mailbox does not exist/);
  const doc = db.store.get('submissions/PFA-C-2026-00001');
  assert.equal(doc.status, 'new');
  assert.equal(doc.replyCount || 0, 0);
  const msg = db.store.get([...db.store.keys()].find((k) => k.includes('/messages/')));
  assert.equal(msg.delivered, false);
  assert.equal(msg.error, 'mailbox does not exist');
});

test('with no email on file the reply is refused with the mobile to call; notes always work', async () => {
  const db = await seeded();
  const handler = createCase({ getDb: () => db, fieldValue, requireAdmin, deliver: async () => ({}), isConfigured: () => true, now: () => NOW });
  const res = await run(handler, request({ body: { reference: 'PFA-Q-2026-00001', action: 'reply', text: 'Yes we do.' } }));
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /Call 9876543210/);
  const note = await run(handler, request({ body: { reference: 'PFA-Q-2026-00001', action: 'note', text: 'Called; they will bring the bird on Monday.' } }));
  assert.equal(note.statusCode, 200);
  assert.equal(db.store.get('submissions/PFA-Q-2026-00001').noteCount, 1);
  assert.equal((await run(handler, request({ body: { reference: 'PFA-Q-2026-00001', action: 'note', text: '   ' } }))).statusCode, 400);
  const noMail = createCase({ getDb: () => db, fieldValue, requireAdmin, deliver: async () => ({}), isConfigured: () => false, now: () => NOW });
  assert.equal((await run(noMail, request({ body: { reference: 'PFA-C-2026-00001', action: 'reply', text: 'Hi' } }))).statusCode, 503);
});

test('assignment and status changes are recorded with who and when; bad input is refused', async () => {
  const db = await seeded();
  const handler = createCase({ getDb: () => db, fieldValue, requireAdmin, deliver: async () => ({}), isConfigured: () => true, now: () => NOW });
  const assigned = await run(handler, request({ body: { reference: 'PFA-C-2026-00001', action: 'assign', to: 'Rescue@PeopleForAnimalsIndia.org' } }));
  assert.equal(assigned.body.assignedTo.email, 'rescue@peopleforanimalsindia.org');
  assert.equal((await run(handler, request({ body: { reference: 'PFA-C-2026-00001', action: 'assign', to: 'not an email' } }))).statusCode, 400);

  const done = await run(handler, request({ body: { reference: 'PFA-C-2026-00001', action: 'status', status: 'handled', note: 'Animal moved to the shelter.' } }));
  assert.equal(done.body.statusLabel, 'Handled');
  const doc = db.store.get('submissions/PFA-C-2026-00001');
  assert.equal(doc.status, 'handled');
  assert.equal(doc.handledBy, 'karthik@pfa.org');
  assert.deepEqual(doc.history.map((h) => h.event || h.status), ['new', 'assign', 'handled']);
  assert.ok(doc.history.slice(1).every((h) => h.by === 'karthik@pfa.org' && h.at));
  assert.equal((await run(handler, request({ body: { reference: 'PFA-C-2026-00001', action: 'status', status: 'deleted' } }))).statusCode, 400);
  assert.equal((await run(handler, request({ body: { reference: 'PFA-C-2026-00001', action: 'destroy' } }))).statusCode, 400);
  assert.equal((await run(handler, request({ body: { reference: 'PFA-C-2026-09999', action: 'note', text: 'x' } }))).statusCode, 404);
  assert.equal((await run(handler, request({ method: 'DELETE', query: { reference: 'PFA-C-2026-00001' } }))).statusCode, 405);
});

test('the panel opens a case from its row rather than acting inside it', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.ok(html.includes('id="caseDrawer"') && html.includes('role="dialog"'));
  assert.ok(/data-open-case=/.test(html), 'rows open the case');
  assert.ok(!/data-set-status="in-progress"[^>]*>Taking it</.test(html), 'no status toolbar inside the row');
  assert.ok(/action: 'reply'/.test(html) && /action: 'note'/.test(html) && /action: 'assign'/.test(html) && /action: 'status'/.test(html));
  assert.ok(/\/api\/admin\/staff/.test(html), 'assignment lists the staff');
});

test('the panel reads the photo under the field the attachment route sends', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '..', 'lib', 'routes', 'admin', 'attachment.js'), 'utf8');
  const sent = (route.match(/^\s*(\w+): bytes\.toString\('base64'\)/m) || [])[1];
  require('node:assert/strict').ok(sent, 'the route should send base64 under a named field');
  require('node:assert/strict').ok(html.includes('data.' + sent), `the panel must read data.${sent}`);
});

/* ---- approving a colony caregiver application into a card ---- */
test('approving a paid application issues the card from what was sent, closes the application, and emails the holder', async () => {
  const db = fakeDb();
  await db.collection('submissions').doc('PFA-CG-2026-00001').create({
    reference: 'PFA-CG-2026-00001', kind: 'PFA-CG', kindLabel: 'Colony caregiver card application', status: 'new', attachments: 2,
    fields: { name: 'asha rao', mobile: '98765 43210', email: 'asha@example.com', address: 'Car Street colony, near the temple 576101', city: 'Udupi' },
    createdAt: new Date(NOW - 3600000).toISOString(), history: [{ status: 'new', at: new Date(NOW - 3600000).toISOString() }]
  });
  const issued = [], queued = [], delivered = [], results = [];
  const handler = createCase({ getDb: () => db, fieldValue, requireAdmin,
    deliver: async (m) => { delivered.push(m); return { providerId: 'resend_1' }; }, isConfigured: () => true, now: () => NOW,
    issueCard: async ({ application, idempotencyKey }) => {
      issued.push({ application, idempotencyKey });
      return { card: { cardId: 'PFA-CCT-4K2M8QRT', name: application.name, issuedAt: 'i', validUntil: 'v' }, reissued: false, sameRequest: false };
    },
    queueEmail: async (m) => { queued.push(m); return { emailId: 'e1', created: true }; },
    recordEmailResult: async (r) => { results.push(r); } });

  const wrong = await run(handler, request({ body: { reference: 'PFA-CG-2026-00001', action: 'bogus' } }));
  assert.equal(wrong.statusCode, 400);

  const res = await run(handler, request({ body: { reference: 'PFA-CG-2026-00001', action: 'approve' } }));
  assert.equal(res.body.ok, true, JSON.stringify(res.body));
  assert.equal(res.body.cardId, 'PFA-CCT-4K2M8QRT');
  assert.equal(issued.length, 1);
  assert.equal(issued[0].application.mobile, '9876543210', 'the mobile is normalised for the register');
  assert.equal(issued[0].application.pin, '576101', 'the PIN is lifted from the colony address');
  assert.match(issued[0].application.address, /Car Street colony.*Udupi/);
  assert.equal(issued[0].idempotencyKey, 'application:PFA-CG-2026-00001', 'a double click cannot issue twice');
  const app = db.store.get('submissions/PFA-CG-2026-00001');
  assert.equal(app.cardId, 'PFA-CCT-4K2M8QRT');
  /* approve moves an application to its own stage, "Card issued" (lib/case-flow.js, 8 Oct 2026) */
  assert.equal(app.status, 'approved');
  const card = db.store.get('caretakerCards/PFA-CCT-4K2M8QRT');
  assert.equal(card.applicationRef, 'PFA-CG-2026-00001', 'the card points back at the application, for its photograph');
  assert.equal(queued.length, 1); assert.equal(queued[0].template, 'card_issued'); assert.equal(queued[0].to, 'asha@example.com');
  /* Sent now, not left for the nightly worker: the panel says "emailed", so
     the email has to have gone. Recorded as sent on the queue entry, so the
     worker does not send it a second time. */
  assert.equal(res.body.emailed, true);
  assert.equal(delivered.length, 1); assert.equal(delivered[0].template, 'card_issued');
  /* an approval notice, not the card (owner, 24 Oct 2026: "only physical
     card will go to the applicant"): no card number, no link to a card,
     where the printed card is going, and the application to follow */
  const notice = delivered[0].payload;
  assert.equal(notice.cardId, undefined, 'no card number in the email');
  assert.equal(notice.cardUrl, undefined, 'no link to a card');
  assert.equal(notice.applicationRef, 'PFA-CG-2026-00001');
  assert.match(notice.followUrl, /\/track\.html#ref=PFA-CG-2026-00001$/);
  assert.deepEqual(notice.postTo, ['Car Street colony, near the temple, Udupi', 'Karnataka 576101'], 'the state found from the district, the PIN once');
  const letter = require('../lib/caregiver-mail').render('card_issued', notice);
  for (const part of [letter.subject, letter.html, letter.text]) {
    assert.doesNotMatch(part, /PFA-CCT-|caregiver-card\.html|download/i, 'nothing in the email is or opens a card');
  }
  assert.match(letter.text, /printed card will be posted to you/);
  /* recorded under the claim the row was written with (8 Oct 2026); this stub store hands out none */
  assert.deepEqual(results.map(({ claimToken, ...r }) => r), [{ emailId: 'e1', ok: true, providerId: 'resend_1' }]);

  const again = await run(handler, request({ body: { reference: 'PFA-CG-2026-00001', action: 'approve' } }));
  assert.equal(again.statusCode, 409, 'an issued application cannot be approved twice');

  /* a case that is not an application cannot become a card */
  const other = await seeded();
  const h2 = createCase({ getDb: () => other, fieldValue, requireAdmin, deliver: async () => ({}), isConfigured: () => true, now: () => NOW, issueCard: async () => { throw new Error('must not be called'); } });
  const no = await run(h2, request({ body: { reference: 'PFA-C-2026-00001', action: 'approve' } }));
  assert.equal(no.statusCode, 400);
});

test('a mobile that already holds a card is refused with the card named, so the reviewer replies instead', async () => {
  const db = fakeDb();
  await db.collection('submissions').doc('PFA-CG-2026-00002').create({ reference: 'PFA-CG-2026-00002', kind: 'PFA-CG', status: 'new',
    fields: { name: 'Ravi', mobile: '9876543210', address: 'Somewhere 560001', city: 'Bengaluru', district: 'Bengaluru (Bangalore) Urban', state: 'Karnataka' }, createdAt: new Date(NOW).toISOString(), history: [] });
  const handler = createCase({ getDb: () => db, fieldValue, requireAdmin, deliver: async () => ({}), isConfigured: () => true, now: () => NOW,
    issueCard: async () => ({ card: { cardId: 'PFA-CCT-OLD00001', name: 'Someone Else' }, reissued: true, sameRequest: false }), queueEmail: async () => ({}) });
  const res = await run(handler, request({ body: { reference: 'PFA-CG-2026-00002', action: 'approve' } }));
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /PFA-CCT-OLD00001/);
  assert.equal(db.store.get('submissions/PFA-CG-2026-00002').cardId, undefined, 'nothing recorded');
});

test('the drawer previews both faces, offers approve and a correction reply, and prints approved cards with the applicant photograph', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(html, /id="cardPreview"[\s\S]*data-side="front"[\s\S]*data-side="back"/);
  assert.match(html, /id="caseApprove"/);
  assert.match(html, /id="caseFix"/);
  assert.match(html, /action: 'approve'/);
  assert.ok((html.match(/<label><input type="checkbox" value="/g) || []).length >= 5, 'a set of ready-made corrections');
  assert.match(html, /photos\.get\('app:' \+ row\.applicationRef\)/, 'Issue cards uses the application photograph');
  const cards = fs.readFileSync(path.join(__dirname, '..', 'lib', 'routes', 'admin', 'cards.js'), 'utf8');
  assert.match(cards, /applicationRef: clean\(c\.applicationRef/);
});
