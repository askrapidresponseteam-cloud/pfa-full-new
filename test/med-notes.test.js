'use strict';

/* Care Guides for pet parents and caregivers (owner, 16 Nov 2026: "a pet
   parents/caregiver's section, where you can find medical information sent
   by owners of animals/caregivers/vet/doctors. allow new submissions also,
   it needs to go to the admin, gandhim. and once approved, submitter will
   get an email confirming success. also admin should have option to
   send/ask for edit, update"). Held here, end to end, through the real
   routes:

     1. the page: the notes first, the form closed until asked for, three
        steps, the address block, and the update form reached only by link;
     2. a note sent with a PDF is filed, confirmed to the sender, and copied
        to gandhim with the PDF attached; it is not on the site yet;
     3. published from the panel, it is on the site with its PDF, and the
        sender is emailed that it is live, once;
     4. sent back for changes, the sender gets a private link; the link opens
        their note, takes the update once, keeps the earlier version, and
        PFA's inbox gets the updated note in the same conversation;
     5. PFA's corrections are kept as versions; taking a note off the site
        takes it and its file off; PFA's own note can be taken off and put back. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const { PLACE } = require('./_place');
const MED = require('../lib/med-notes');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const INBOX = 'gandhim@exmpls.sansad.in';
const SENDER = 'asha.vet@example.com';
const PDF = fs.readFileSync(path.join(ROOT, 'media/med-notes/diabetes-in-dogs.pdf'));
const PDF_URL = 'data:application/pdf;base64,' + PDF.toString('base64');

const ENV = ['PFA_MAIL_API_KEY', 'PFA_MAIL_ENDPOINT', 'PFA_SUBMISSIONS_INBOX', 'PUBLIC_SITE_URL', 'PFA_PUBLIC_SITE_URL', 'PFA_SMTP_USER', 'PFA_SMTP_PASS'];
const saved = {};
const realFetch = global.fetch;
let db;
let sent;

test.beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, { PFA_MAIL_API_KEY: 'test-key', PFA_MAIL_ENDPOINT: 'https://mail.test/emails', PUBLIC_SITE_URL: 'https://pfa.test' });
  db = memoryFirestore();
  firebase._setDbForTests(db);
  sent = [];
  global.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: 'mail_' + sent.length }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
});
test.afterEach(() => {
  global.fetch = realFetch;
  firebase._setDbForTests(null);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function call(handler, { method = 'POST', body, query = {} } = {}) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      getHeader(n) { return out.headers[String(n).toLowerCase()]; },
      end(raw) { out.body = raw; out.raw = Buffer.isBuffer(raw) ? '' : String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api', query, body,
      headers: { host: 'pfa.test', 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.' + Math.floor(Math.random() * 200) } };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

const ADMIN = { uid: 'u1', email: 'karthik@pfa.test', name: 'Karthik', role: 'super' };
const admin = () => require('../lib/routes/admin/med-notes').createHandler({ requireAdmin: async () => ADMIN });
const caseRoute = () => {
  const mail = require('../lib/caregiver-mail');
  return require('../lib/routes/admin/case')._private.createHandler({
    getDb: firebase.getDb, fieldValue: firebase.fieldValue, deliver: mail.deliver, isConfigured: mail.isConfigured,
    now: () => Date.now(), requireAdmin: async () => ADMIN, queue: null
  });
};
const publicRoute = () => require('../lib/routes/med-notes').createHandler({ queue: null });
const toInbox = () => sent.filter((m) => [].concat(m.to).includes(INBOX));
const toSender = () => sent.filter((m) => [].concat(m.to).includes(SENDER));

async function sendNote(extra) {
  const data = Object.assign({
    animal: 'Dogs', title: 'Tick fever in dogs', summary: 'The signs, the blood test that confirms it, the usual treatment and when to go back.',
    noteText: '', role: 'Vet', regNo: 'KVC 1234', credit: 'Dr. Asha Rao, Udupi', sources: 'Our clinic',
    name: 'Asha Rao', mobile: '9876543210', email: SENDER, consent: 'Yes'
  }, PLACE, extra || {});
  const res = await call(require('../lib/routes/pfa-submissions'), { body: { kind: 'PFA-MED', data, photos: [PDF_URL], page: 'pet-health.html', clientRequestId: 'med-' + Math.random() } });
  assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
  return res.json.reference;
}

/* ---- the page ------------------------------------------------------------ */

test('the page: the guide first, with its cover; sharing one is closed until asked for, three steps, with the address; updating only by link', () => {
  const doc = new JSDOM(read('pet-health.html')).window.document;
  /* owner, 16 Nov 2026: "article has to come 1st when the page opens" */
  const first = doc.querySelector('main').firstElementChild;
  assert.equal(first.id, 'top');
  assert.equal(first.querySelector('h1').textContent, 'Care Guides.', 'called Care Guides');
  const lead = first.querySelector('#phList > li.ph-card--lead');
  assert.ok(lead, 'the first guide, large, is the first thing on the page, before any script runs');
  assert.ok(!doc.querySelector('main .hero'), 'no panel of words above it');
  const own = MED.seeds()[0];
  assert.equal(lead.id, 'note-pfa-' + own.id);
  assert.equal(lead.querySelector('.ph-card__title').textContent, own.title, 'the same as the data the server reads');
  const img = lead.querySelector('.ph-cover img');
  assert.equal(img.getAttribute('src'), own.cover, 'with its cover');
  assert.ok(fs.existsSync(path.join(ROOT, own.cover)));
  assert.equal(lead.querySelector('a[download]').getAttribute('href'), own.files[0].src);
  const share = doc.getElementById('share');
  assert.ok(share.hasAttribute('data-flow'), 'the form opens only when asked for');
  assert.ok(doc.querySelector('a[href="#share"]'), 'and something asks for it');
  const form = share.querySelector('form#phForm');
  assert.deepEqual([...form.querySelectorAll('.m-step')].map((s) => s.getAttribute('data-step')), ['The guide', 'About you', 'Contact']);
  assert.ok(form.querySelector('fieldset[data-address][data-kind="PFA-MED"]'), 'the address block every form carries');
  assert.match(form.querySelector('#phFile').getAttribute('accept'), /application\/pdf/);
  for (const [name, n] of [['animal', 7], ['role', 5]]) assert.equal(form.querySelectorAll(`input[type="radio"][name="${name}"]`).length, n, name);
  const edit = doc.getElementById('edit');
  assert.ok(edit.hasAttribute('data-flow') && edit.querySelector('form#edForm'), 'the update form, opened by #edit=<link>');
  assert.match(read('pet-health.html'), /\/api\/med-notes/, 'the page reads the notes from the server');
  /* in the menu, under Learn, on every page */
  assert.match(read('index.html'), /href="pet-health\.html"[^>]*>Care Guides</);
});

test('PFA\'s own first note is the one-page guide the owner supplied, with its PDF', () => {
  MED._resetSeeds();
  const own = MED.seeds();
  assert.equal(own[0].id, 'diabetes-in-dogs');
  const file = path.join(ROOT, own[0].files[0].src);
  assert.equal(fs.readFileSync(file).subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(fs.statSync(file).size, own[0].files[0].size, 'the size the page shows is the file\'s');
});

/* ---- sending, publishing --------------------------------------------------- */

test('a note with a PDF: filed, confirmed to the sender, one copy to gandhim with the PDF; not on the site until published', async () => {
  const ref = await sendNote();
  assert.match(ref, /^PFA-MED-\d{4}-\d{5}$/);
  const rec = db.dump()['submissions/' + ref];
  assert.equal(rec.status, 'new');
  assert.equal(rec.attachments, 1);
  assert.equal(db.dump()[`submissions/${ref}/attachments/1`].contentType, 'application/pdf');

  const copies = toInbox();
  assert.equal(copies.length, 1, 'one copy to gandhim');
  assert.equal(copies[0].reply_to, SENDER);
  assert.ok((copies[0].attachments || []).some((a) => a.content_type === 'application/pdf' && /\.pdf$/.test(a.filename)), 'the PDF goes with it');
  assert.equal(toSender().length, 1, 'the sender is told it arrived');
  assert.match(toSender()[0].subject, /care guide/i);

  const list = await call(publicRoute(), { method: 'GET' });
  assert.ok(!list.json.notes.some((n) => n.id === ref), 'not on the site before it is published');
  const file = await call(publicRoute(), { method: 'GET', query: { ref, file: '1' } });
  assert.equal(file.statusCode, 404, 'nor its file');
});

test('published from the panel: on the site with its PDF, and the sender emailed once that it is live', async () => {
  const ref = await sendNote();
  sent = [];
  const res = await call(admin(), { body: { reference: ref, action: 'publish' } });
  assert.equal(res.statusCode, 200, res.raw);
  assert.equal(res.json.row.status, 'approved');
  assert.equal(res.json.row.statusLabel, 'Published');
  const live = toSender();
  assert.equal(live.length, 1);
  assert.match(live[0].subject, /published/i);
  assert.match(live[0].html, /pet-health\.html#note=PFA-MED-/);

  const again = await call(admin(), { body: { reference: ref, action: 'publish' } });
  assert.equal(again.json.unchanged, true, 'a second press changes nothing');
  assert.equal(toSender().length, 1, 'and emails nobody again');

  const list = await call(publicRoute(), { method: 'GET' });
  const note = list.json.notes.find((n) => n.id === ref);
  assert.ok(note, 'on the site');
  assert.equal(note.credit, 'Dr. Asha Rao, Udupi');
  assert.equal(note.role, 'Vet');
  assert.deepEqual(Object.keys(note).sort(), ['animal', 'at', 'cover', 'credit', 'files', 'id', 'role', 'sources', 'summary', 'text', 'title'], 'nothing about the sender but the credit they chose');
  assert.ok(!JSON.stringify(list.json).includes(SENDER) && !JSON.stringify(list.json).includes('9876543210'));
  assert.equal(note.files[0].type, 'application/pdf');
  const file = await call(publicRoute(), { method: 'GET', query: { ref, file: '1' } });
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers['content-type'], 'application/pdf');
  assert.ok(Buffer.isBuffer(file.body) && file.body.equals(PDF));
  /* PFA's own note is listed too */
  assert.ok(list.json.notes.some((n) => n.id === 'pfa-diabetes-in-dogs'));
});

test('asked for changes: a private link, the note opened by it, the update taken once, the old version kept, gandhim given the update', async () => {
  const ref = await sendNote();
  sent = [];
  const asked = await call(admin(), { body: { reference: ref, action: 'ask', text: 'Please add which blood test confirms it.' } });
  assert.equal(asked.statusCode, 200, asked.raw);
  assert.equal(asked.json.row.status, 'changes');
  const letter = toSender()[0];
  assert.match(letter.subject, /change to your care guide/i);
  assert.match(letter.text, /Please add which blood test confirms it\./);
  const token = (/#edit=([A-Za-z0-9_-]{43})/.exec(letter.text) || [])[1];
  assert.ok(token, 'the link is in the email');
  assert.ok(!JSON.stringify(db.dump()).includes(token), 'only its hash is kept');

  const open = await call(publicRoute(), { body: { t: token, action: 'open' } });
  assert.equal(open.statusCode, 200, open.raw);
  assert.equal(open.json.note.title, 'Tick fever in dogs');
  assert.equal(open.json.asked, 'Please add which blood test confirms it.');
  assert.ok(!JSON.stringify(open.json).includes('9876543210'), 'the link shows the note, not the contact details');

  sent = [];
  const note = Object.assign({}, open.json.note, { summary: 'The signs, the SNAP 4Dx blood test that confirms it, the usual treatment and when to go back.' });
  const upd = await call(publicRoute(), { body: { t: token, action: 'send', note } });
  assert.equal(upd.statusCode, 200, upd.raw);
  const rec = db.dump()['submissions/' + ref];
  assert.equal(rec.status, 'updated');
  assert.match(rec.note.summary, /SNAP 4Dx/);
  assert.equal(rec.revisions.length, 1, 'the earlier version is kept');
  assert.match(rec.revisions[0].before.summary, /^The signs, the blood test/);
  assert.equal(toSender().length, 1, 'the sender is told the update arrived');
  const copy = toInbox();
  assert.equal(copy.length, 1, 'gandhim gets the updated note');
  assert.match(copy[0].subject, /^Re: PFA-MED-.*updated/);
  assert.match(copy[0].html, /SNAP 4Dx/);

  const twice = await call(publicRoute(), { body: { t: token, action: 'send', note } });
  assert.equal(twice.statusCode, 410, 'the link works once');
  assert.equal(twice.json.state, 'used');
});

test('a new link replaces the old; a published note is corrected by PFA, not sent back', async () => {
  const ref = await sendNote();
  await call(admin(), { body: { reference: ref, action: 'ask', text: 'First ask.' } });
  const first = (/#edit=([A-Za-z0-9_-]{43})/.exec(toSender().slice(-1)[0].text) || [])[1];
  await call(admin(), { body: { reference: ref, action: 'ask', text: 'Second ask.' } });
  const old = await call(publicRoute(), { body: { t: first, action: 'open' } });
  assert.equal(old.json.state, 'replaced');

  await call(admin(), { body: { reference: ref, action: 'publish' } });
  const refused = await call(admin(), { body: { reference: ref, action: 'ask', text: 'Late.' } });
  assert.equal(refused.statusCode, 409);
});

test('PFA\'s corrections are versions; a bad field is refused; taking it off the site takes the file too', async () => {
  const ref = await sendNote();
  await call(admin(), { body: { reference: ref, action: 'publish' } });
  const bad = await call(admin(), { body: { reference: ref, action: 'save', note: { title: '', summary: 'x', animal: 'Dragons', role: 'Vet', credit: 'A' } } });
  assert.equal(bad.statusCode, 422);
  const row = bad.json.row;
  const fixed = await call(admin(), { body: { reference: ref, action: 'save', note: Object.assign({}, row.note, { title: 'Tick fever in dogs: what to watch for' }) } });
  assert.equal(fixed.statusCode, 200, fixed.raw);
  assert.equal(fixed.json.row.note.title, 'Tick fever in dogs: what to watch for');
  assert.equal(fixed.json.row.versions, 2);
  const live = await call(publicRoute(), { method: 'GET' });
  assert.equal(live.json.notes.find((n) => n.id === ref).title, 'Tick fever in dogs: what to watch for', 'the site shows the correction');

  const off = await call(caseRoute(), { body: { reference: ref, action: 'status', status: 'withdrawn', note: 'Taken off the website.' } });
  assert.equal(off.statusCode, 200, off.raw);
  const after = await call(publicRoute(), { method: 'GET' });
  assert.ok(!after.json.notes.some((n) => n.id === ref), 'off the site');
  const file = await call(publicRoute(), { method: 'GET', query: { ref, file: '1' } });
  assert.equal(file.statusCode, 404, 'and its file with it');
  /* Published is reached only by publishing, never by a status move */
  const move = await call(caseRoute(), { body: { reference: ref, action: 'status', status: 'approved' } });
  assert.equal(move.statusCode, 409);
});

test('PFA\'s own note can be taken off the site and put back from the panel', async () => {
  const off = await call(admin(), { body: { action: 'seed', id: 'diabetes-in-dogs', hidden: true } });
  assert.equal(off.statusCode, 200);
  let list = await call(publicRoute(), { method: 'GET' });
  assert.ok(!list.json.notes.some((n) => n.id === 'pfa-diabetes-in-dogs'));
  await call(admin(), { body: { action: 'seed', id: 'diabetes-in-dogs', hidden: false } });
  list = await call(publicRoute(), { method: 'GET' });
  assert.ok(list.json.notes.some((n) => n.id === 'pfa-diabetes-in-dogs'));
  const panel = await call(admin(), { method: 'GET' });
  assert.equal(panel.json.own[0].seed, 'diabetes-in-dogs');
});

test('a guide sent with a cover: the cover shows with it, the PDF is the guide', async () => {
  const JPEG = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(ROOT, 'media/cinekind-2026/reels/glimpse.jpg')).toString('base64');
  const data = Object.assign({ animal: 'Cats', title: 'Kidney care for cats', summary: 'What the vet changed in her food, and how we got her to eat it.',
    role: 'Pet parent', credit: 'Ravi Kumar, Mysuru', name: 'Ravi Kumar', mobile: '9876500011', email: SENDER, consent: 'Yes', cover: 'Yes' }, PLACE);
  const res = await call(require('../lib/routes/pfa-submissions'), { body: { kind: 'PFA-MED', data, photos: [JPEG, PDF_URL], page: 'pet-health.html', clientRequestId: 'cov-1' } });
  assert.equal(res.statusCode, 200, res.raw);
  const ref = res.json.reference;
  assert.equal(db.dump()[`submissions/${ref}/attachments/1`].label, 'Cover');
  assert.equal(db.dump()[`submissions/${ref}/attachments/2`].contentType, 'application/pdf');
  await call(admin(), { body: { reference: ref, action: 'publish' } });
  const note = (await call(publicRoute(), { method: 'GET' })).json.notes.find((n) => n.id === ref);
  assert.equal(note.cover, `/api/med-notes?ref=${ref}&file=1`);
  assert.deepEqual(note.files.map((f) => f.type), ['application/pdf'], 'the cover is not part of the guide');
  const pic = await call(publicRoute(), { method: 'GET', query: { ref, file: '1' } });
  assert.equal(pic.headers['content-type'], 'image/jpeg');
});

test('a PDF only where a kind takes documents, one at a time, judged by its bytes', () => {
  const S = require('../lib/submissions');
  assert.equal(S.parsePhotos([PDF_URL], 3, 'PFA-MED').accepted[0].contentType, 'application/pdf');
  assert.match(S.parsePhotos([PDF_URL], 3, 'PFA-CR').rejected[0], /not a PDF/);
  assert.match(S.parsePhotos([PDF_URL, PDF_URL], 3, 'PFA-MED').rejected[0], /one PDF/);
  const fake = 'data:application/pdf;base64,' + Buffer.from('not a pdf at all').toString('base64');
  assert.match(S.parsePhotos([fake], 3, 'PFA-MED').rejected[0], /not a PDF/);
});

/* ---- the panel ------------------------------------------------------------- */

test('the panel has Care Guides: its own section, list first, every action a press with a last look', () => {
  const html = read('admin.html');
  assert.match(html, /data-tab="mednotes">Care Guides/);
  assert.match(html, /<script src="assets\/admin-mednotes\.js"><\/script>/);
  const js = read('assets/admin-mednotes.js');
  for (const word of ['Publish', 'Edit', 'Ask for changes', 'Not for the site', 'Take off the site']) assert.ok(js.includes(word), word);
  assert.ok(require('../lib/admin-modules').MODULE_KEYS.includes('mednotes'));
  assert.ok(read('scripts/build-firebase.js').includes("'assets/admin-mednotes.js'"), 'shipped with the panel');
  assert.ok(read('scripts/build-firebase.js').includes("'data/med-notes.json'"), 'and the notes PFA put up, for the function');
});
