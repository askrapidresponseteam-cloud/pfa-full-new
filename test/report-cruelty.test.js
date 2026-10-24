'use strict';
/* The "Report cruelty" journey: a page that sends a real report with photos,
   a reference back, a way to follow it, and a row in the admin inbox. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const S = require('../lib/submissions');
const { createHandler } = require('../lib/routes/pfa-submissions')._private;
const { PLACE } = require('./_place');

const ROOT = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(ROOT, 'report.html'), 'utf8');
const search = fs.readFileSync(path.join(ROOT, 'pfa-search.js'), 'utf8');

function fakeDb() {
  const store = new Map();
  const key = (c, id) => `${c}/${id}`;
  const docRef = (c, id) => ({
    id,
    collection: (sub) => ({ doc: (subId) => docRef(`${c}/${id}/${sub}`, subId) }),
    async get() { const data = store.get(key(c, id)); return { exists: Boolean(data), id, data: () => data }; },
    async create(data) { if (store.has(key(c, id))) { const e = new Error('exists'); e.code = 6; throw e; } store.set(key(c, id), Object.assign({}, data)); },
    async set(data, opts) { const prev = (opts && opts.merge && store.get(key(c, id))) || {}; store.set(key(c, id), Object.assign({}, prev, data)); }
  });
  return { store, collection: (c) => ({ doc: (id) => docRef(c, id) }),
    async runTransaction(fn) { return fn({ get: (r) => r.get(), set: (r, d, o) => { r.set(d, o); } }); } };
}
function request({ method = 'POST', body, query = {} } = {}) {
  const r = new EventEmitter(); r.method = method; r.query = query; r.headers = {};
  if (body !== undefined) process.nextTick(() => { r.emit('data', JSON.stringify(body)); r.emit('end'); });
  return r;
}
async function run(handler, req) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b || '{}'); } };
  await handler(req, res); return res;
}
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

test('the search quick action goes to the report page, not to a law answer', () => {
  assert.match(search, /t: 'Report cruelty'[^}]*u: 'report\.html'/);
  assert.match(search, /u: 'laws\.html#a33'/, 'the legal answer is still findable on its own');
});

test('the page posts a cruelty report and the server files it under its own kind, photos beside it', async () => {
  assert.match(page, /PFAForms\.submit\('PFA-CR'/);
  assert.equal(S.KIND_LABELS['PFA-CR'], 'Cruelty report');
  const db = fakeDb();
  const handler = createHandler({ getDb: () => db, deliver: async () => ({ id: 'm1' }), isConfigured: () => false, now: () => Date.UTC(2026, 7, 27) });
  const res = await run(handler, request({ body: {
    kind: 'PFA-CR', page: 'report.html',
    data: { what: 'A man beat a dog with a stick outside the market', animal: 'Dog', urgency: 'Happening now', ...PLACE, name: 'Asha', mobile: '9876543210', email: 'asha@example.in' },
    photos: ['data:image/jpeg;base64,' + JPEG.toString('base64')]
  } }));
  assert.equal(res.body.ok, true, JSON.stringify(res.body));
  assert.equal(res.body.reference, 'PFA-CR-2026-00001');
  assert.equal(res.body.kindLabel, 'Cruelty report');
  const stored = db.store.get('submissions/PFA-CR-2026-00001');
  assert.equal(stored.attachments, 1);
  assert.ok(db.store.get('submissions/PFA-CR-2026-00001/attachments/1'), 'the photo is stored beside the report');

  /* and the person who sent it can follow it with the mobile they gave */
  const followed = await run(handler, request({ method: 'GET', query: { reference: 'PFA-CR-2026-00001', contact: '98765 43210' } }));
  assert.equal(followed.body.ok, true);
  assert.equal(followed.body.kindLabel, 'Cruelty report');
  assert.ok(Array.isArray(followed.body.timeline) && followed.body.timeline.length >= 1);
});

test('the page carries a way to follow a report, and the old follow link lands there', () => {
  assert.match(page, /id="followForm"/);
  assert.match(page, /\/api\/pfa-submissions\?reference=/);
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const rw = vercel.rewrites.find((r) => r.source === '/network.html');
  assert.ok(rw && rw.destination === '/report.html', 'acknowledgement emails link to network.html; that must resolve');
});

test('"Ask us anything" is a quick action with its own page, filed as a help desk query', async () => {
  const ask = fs.readFileSync(path.join(ROOT, 'ask.html'), 'utf8');
  assert.match(search, /QUICK = \[[^\]]*'Ask us anything'/);
  assert.match(search, /t: 'Ask us anything'[^}]*u: 'ask\.html'/);
  assert.match(ask, /PFAForms\.submit\('PFA-Q'/);
  assert.equal(S.KIND_LABELS['PFA-Q'], 'Help desk query');
  const db = fakeDb();
  const handler = createHandler({ getDb: () => db, deliver: async () => ({ id: 'm1' }), isConfigured: () => false, now: () => Date.UTC(2026, 7, 27) });
  const res = await run(handler, request({ body: { kind: 'PFA-Q', page: 'ask.html',
    data: { question: 'Can I feed the dogs in my society?', topic: 'Animal law', ...PLACE, name: 'Asha', email: 'asha@example.in' } } }));
  assert.equal(res.body.ok, true, JSON.stringify(res.body));
  assert.match(res.body.reference, /^PFA-Q-2026-\d{5}$/);
  const followed = await run(handler, request({ method: 'GET', query: { reference: res.body.reference, contact: 'asha@example.in' } }));
  assert.equal(followed.body.kindLabel, 'Help desk query');
});

test('the colony caregiver card quick action opens the application, not the law answer', () => {
  assert.match(search, /t: 'Apply for a colony caregiver card'[^}]*u: 'get-involved\.html#caregiver'/);
  const gi = fs.readFileSync(path.join(ROOT, 'get-involved.html'), 'utf8');
  assert.match(gi, /id="caregiver" data-journey="Colony caregiver"/);
  assert.match(gi, /fromHash\(false\)/, 'a link straight to #caregiver must open the journey');
});

test('Careers: one footer link, a page of real roles, and applications filed as their own kind', async () => {
  const footer = fs.readFileSync(path.join(ROOT, 'assets', 'chrome-footer.html'), 'utf8');
  assert.equal((footer.match(/href="careers\.html"/g) || []).length, 1, 'exactly one Careers link in the footer');
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(index, /href="careers\.html">Careers</, 'stamped into every page');
  const page = fs.readFileSync(path.join(ROOT, 'careers.html'), 'utf8');
  /* five openings since 9 Oct 2026 (owner: "properly update the existing
     Jobs section"), the Zonal Head first */
  assert.match(page, /var PFA_ROLES = \[\n {2}\{ id: 'zonal-head'/);
  for (const id of ['zonal-head', 'veterinary-team', 'cruelty-response-coordinator', 'social-media-fundraising', 'internship']) {
    assert.match(page, new RegExp(`<article class="opening role" id="${id}" data-role="${id}">`), `${id} has its own description`);
    assert.match(page, new RegExp(`name="roleId" id="r-${id}" value="${id}"`), `${id} can be chosen in the application`);
  }
  assert.match(page, /<ul class="zones" id="zones"><\/ul>/, 'zones are rendered from PFA_ZONES, not hand-written');
  assert.match(page, /PFA_ZONES = \[[\s\S]*'south-south'/, 'all nine zones');
  assert.match(page, /\u20b935,000 per month/, 'the pay is stated');
  assert.equal((page.match(/class="step" data-step=/g) || []).length, 5, 'five screens');
  assert.match(page, /PFAForms\.submit\('PFA-J'/);
  assert.equal(S.KIND_LABELS['PFA-J'], 'Job application');
  const db = fakeDb();
  const handler = createHandler({ getDb: () => db, deliver: async () => ({ id: 'm1' }), isConfigured: () => false, now: () => Date.UTC(2026, 7, 27) });
  const res = await run(handler, request({ body: { kind: 'PFA-J', page: 'careers.html',
    data: { role: 'Zonal Head \u2014 Central 1', roleId: 'zonal-head', zone: 'Central 1', name: 'Asha', ...PLACE, mobile: '9876543210', email: 'asha@example.in',
      pfaMember: 'Yes', unit: 'PFA Lucknow', background: 'Eight years in rescue', travel: 'Yes',
      'Q1 Poisoning and FIR refusal': 'Secure evidence, vet certificate, complaint to SP, magistrate under 175(3).', 'Q2 First ninety days': 'Sitapur and Hardoi first.' } } }));
  assert.equal(res.body.ok, true, JSON.stringify(res.body));
  assert.match(res.body.reference, /^PFA-J-2026-\d{5}$/);
  const stored = db.store.get(`submissions/${res.body.reference}`);
  assert.equal(stored.fields.zone, 'Central 1', 'the zone is on the record the panel shows');
  assert.ok(stored.fields['Q1 Poisoning and FIR refusal'], 'and so are the answers');
});
