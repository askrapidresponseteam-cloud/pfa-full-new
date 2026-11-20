'use strict';

/* The Letter studio (owner, 20 Nov 2026: PFA-Letter-Studio.html, "add this
   feature to the admin panel. admin should be able to select the name of the
   person and issue the cert. the cert should automatically take the address
   from the selected. also the email ID should be fetchable"; "logo,
   signature, seal size and position should be adjustable"; "letter font to
   be arial"). lib/letters.js, lib/routes/admin/letters.js,
   assets/admin-letters.js. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { memoryFirestore } = require('./_memory-firestore.js');
const L = require('../lib/letters');
const ROUTE = require('../lib/routes/admin/letters');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.parse('2026-11-20T06:00:00.000Z');

/* every string the PDF draws, by its font */
const PDFDocument = require('pdfkit');
let drawn = null;
const realText = PDFDocument.prototype.text;
PDFDocument.prototype.text = function (str, ...rest) {
  if (drawn) drawn.push({ font: this._font && this._font.name, text: String(str) });
  return realText.call(this, str, ...rest);
};
const realImage = PDFDocument.prototype.image;
let images = null;
PDFDocument.prototype.image = function (src, x, y, o) {
  if (images) images.push({ x, y, w: o && o.width, h: o && o.height });
  return realImage.call(this, src, x, y, o);
};
async function make(letter, number) {
  drawn = []; images = [];
  const out = await L.pdfOf(letter, { number });
  const got = { bytes: out.bytes, pages: out.pages, drawn, images, all: drawn.map((d) => d.text).join('') };
  drawn = null; images = null;
  return got;
}

const SOHAN = { id: 'P00002', name: 'Sohan Ashok Banasode', email: 'sohan@example.com', mobile: '6361825963', address: 'House No 10, Shantinagar, Athani 591304', district: 'Belagavi (Belgaum)', state: 'Karnataka', pin: '591304', categories: ['member'], otherEmails: [] };
const RAYA = { id: 'P00001', name: 'Raya Shah', email: 'raya@example.com', mobile: '9876500000', address: '4 Temple Road, Udupi 576101', district: 'Udupi', state: 'Karnataka', pin: '576101', categories: ['donor'], otherEmails: [] };

function appreciation(person) {
  const t = L.TEMPLATES.appreciation;
  return { kind: 'appreciation', date: '2026-11-20', recipient: L.recipientOf(person), subject: t.subject, salutation: t.salutation, body: t.body.split('[Name]').join(person.name), closing: t.closing, person: { id: person.id, name: person.name, email: person.email }, email: person.email };
}

test('the person chosen: their name and address on the letter, the district and state when the address lacks them', () => {
  assert.equal(L.recipientOf(SOHAN), 'Sohan Ashok Banasode\nHouse No 10, Shantinagar, Athani 591304\nBelagavi (Belgaum), Karnataka');
  assert.equal(L.recipientOf(Object.assign({}, RAYA, { address: '4 Temple Road, Udupi 576101, Karnataka' })), 'Raya Shah\n4 Temple Road, Udupi 576101, Karnataka', 'not said twice');
});

test('a blank left in it is refused on issue, never on preview: [Name] means nobody was chosen', () => {
  const t = L.TEMPLATES.appreciation;
  const raw = { kind: 'appreciation', subject: t.subject, body: t.body, closing: t.closing, recipient: 'Raya Shah' };
  assert.equal(L.check(raw, NOW, false).ok, true);
  const r = L.check(raw, NOW, true);
  assert.equal(r.ok, false);
  assert.equal(r.field, 'person');
  assert.match(r.message, /Choose who the letter is for/);
  const a = L.TEMPLATES.authority;
  const r2 = L.check({ kind: 'authority', subject: a.subject, salutation: a.salutation, body: a.body, closing: a.closing, recipient: 'The Commissioner' }, NOW, true);
  assert.match(r2.message, /^Fill in \[Set out the location/);
  assert.equal(L.check({ kind: 'nope', body: 'x' }, NOW, false).field, 'kind');
  assert.equal(L.check(Object.assign(appreciation(RAYA), { email: 'not-an-email' }), NOW, true).field, 'email');
  assert.equal(L.check(appreciation(RAYA), NOW, true).values.date, '2026-11-20');
});

test('the letter: the studio\'s layout in Arial\'s widths, bold where asked, the rupee and an Indian script drawn', async () => {
  const v = L.check(Object.assign(appreciation(RAYA), { body: appreciation(RAYA).body + '\n\nA gift of ₹5,000 from आशा.' }), NOW, true).values;
  const out = await make(v, 'PFA/LET/2026/00007');
  assert.equal(out.bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.match(out.all, /Ref: PFA\/LET\/2026\/00007/);
  assert.match(out.all, /20 November 2026/);
  assert.match(out.all, /Raya Shah/);
  assert.match(out.all, /4 Temple Road, Udupi 576101/);
  assert.match(out.all, /CERTIFICATE OF APPRECIATION/);
  const fonts = new Set(out.drawn.map((d) => d.font));
  assert.ok([...fonts].some((f) => /LiberationSans-Bold/.test(f)) && [...fonts].some((f) => /^LiberationSans$|LiberationSans(?!-)/.test(f)), 'Liberation Sans, Arial\'s widths');
  assert.ok(out.drawn.some((d) => d.text === 'Animals' && /Bold/.test(d.font)), 'People for Animals in bold');
  assert.ok(out.drawn.some((d) => d.text.startsWith(',') && !/Bold/.test(d.font)), 'and the comma straight after it, no space before');
  assert.ok(out.drawn.some((d) => d.text === '₹' && /Noto/.test(d.font)), 'the rupee sign');
  assert.ok(out.drawn.some((d) => /आशा/.test(d.text) && /Devanagari/.test(d.font)), 'a name in Hindi, in its own font');
  assert.match(out.all, /peopleforanimalsindia\.org/);
  assert.match(out.all, /1 \/ \d/);
  assert.equal(out.images.length, 3 * 1 + (out.pages - 1), 'letterhead on each page, the signature and the seal once');
});

test('the letterhead, the signature and the seal: each sized and placed as set, within limits; off when unticked', async () => {
  const base = L.check(appreciation(RAYA), NOW, true).values;
  const plain = await make(base, 'PFA/LET/2026/00001');
  const moved = await make(Object.assign({}, base, { layout: { headSize: 60, headX: 10, headY: 5, sigSize: 50, sigX: 20, sigY: -5, sealSize: 30, sealX: -40, sealY: 8 } }), 'PFA/LET/2026/00001');
  const MM = 72 / 25.4;
  const [h0, s0, z0] = plain.images;
  const [h1, s1, z1] = moved.images;
  assert.ok(Math.abs(h0.w - 172 * MM) < 0.5, 'the letterhead across the text, as the studio has it');
  assert.ok(Math.abs(h1.w - 172 * 0.6 * MM) < 0.5, 'smaller');
  assert.ok(Math.abs((h1.x - h0.x) - ((172 * 0.4) / 2 + 10) * MM) < 0.5, 'centred, then 10 mm to the right');
  assert.ok(Math.abs((h1.y - h0.y) - 5 * MM) < 0.5, '5 mm down');
  assert.ok(Math.abs(s0.w - 75 * MM) < 0.5 && Math.abs(s1.w - 50 * MM) < 0.5, 'the signature 75 mm, then 50');
  assert.ok(Math.abs((s1.x - s0.x) - 20 * MM) < 0.5, 'the signature 20 mm in');
  assert.ok(Math.abs(z0.w - 43 * MM) < 0.5 && Math.abs(z1.w - 30 * MM) < 0.5, 'the seal 43 mm, then 30');
  assert.deepEqual(L.layoutOf({ headSize: 500, sigX: -9, sealSize: 'x' }), Object.assign(L.layoutOf({}), { headSize: 100, sigX: 0 }), 'held within the limits');
  const bare = await make(Object.assign({}, base, { signed: false, sealed: false }), 'PFA/LET/2026/00001');
  assert.equal(bare.images.length, 1, 'only the letterhead');
  assert.match(bare.all, /Maneka Sanjay Gandhi/, 'her name, typed, in place of the signature');
});

test('a long letter runs on: the letterhead and "Continued" on each page, the signature kept with its closing words', async () => {
  const v = L.check(appreciation(RAYA), NOW, true).values;
  const long = Object.assign({}, v, { body: Array(6).fill(v.body).join('\n\n') });
  const out = await make(long, 'PFA/LET/2026/00003');
  assert.ok(out.pages >= 3);
  assert.equal(out.drawn.filter((d) => /Continued/.test(d.text)).length, out.pages - 1);
  assert.ok(out.drawn.some((d) => d.text === `${out.pages} / ${out.pages}`));
});

/* ---- the route --------------------------------------------------------- */

function harness() {
  const db = memoryFirestore();
  /* the audit log writes through the shared handle */
  require('../lib/firebase')._setDbForTests(db);
  const files = new Map();
  const queued = [];
  const delivered = [];
  const guarded = [];
  let who = { uid: 'u1', email: 'office@pfa.test', name: 'Office', role: 'super' };
  const handler = ROUTE.createHandler({
    getDb: () => db,
    requireAdmin: async (req, res, module) => { guarded.push(module); return who; },
    now: () => NOW,
    readPeople: async () => [RAYA, SOHAN],
    fileStore: {
      put: async (p, bytes) => { files.set(p, Buffer.from(bytes)); return { storage: 'test', path: p }; },
      read: async (doc) => files.get(doc.path) || null
    },
    queue: {
      queueEmail: async (e) => { queued.push(e); return { created: true, emailId: `E${queued.length}`, claimToken: 't' }; },
      recordEmailResult: async () => {}
    },
    mail: { isConfigured: () => true, deliver: async (e) => { delivered.push(e); return { providerId: 'p1' }; } }
  });
  ROUTE._private.resetPeople();
  const call = (method, { body, query } = {}) => new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {} };
    const res = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      end(raw) { out.raw = raw; try { out.json = JSON.parse(String(raw)); } catch (_) { out.json = null; } resolve(out); }
    };
    Promise.resolve(handler({ method, body, query: query || {}, headers: {} }, res)).catch(reject);
  });
  return { db, files, queued, delivered, guarded, call, as: (w) => { who = w; } };
}

test('the route: its own module; people found with their address and email; the studio\'s templates and limits', async () => {
  const h = harness();
  const setup = await h.call('GET');
  assert.equal(setup.statusCode, 200);
  assert.deepEqual(h.guarded, ['letters'], 'the letters module, not certificates');
  assert.deepEqual(setup.json.templates.map((t) => t.kind), ['appreciation', 'general', 'support', 'authority']);
  assert.equal(setup.json.layout.sigSize.value, 75);
  assert.deepEqual(setup.json.letters, []);
  const found = await h.call('GET', { query: { people: 'sohan' } });
  assert.equal(found.json.people.length, 1);
  const p = found.json.people[0];
  assert.deepEqual([p.name, p.email, p.recipient], ['Sohan Ashok Banasode', 'sohan@example.com', 'Sohan Ashok Banasode\nHouse No 10, Shantinagar, Athani 591304\nBelagavi (Belgaum), Karnataka']);
  assert.deepEqual(p.categories, ['Member']);
  assert.equal((await h.call('GET', { query: { people: '576101' } })).json.people[0].name, 'Raya Shah', 'by PIN too');
  assert.deepEqual((await h.call('GET', { query: { people: '' } })).json.people, []);
});

test('preview, then issue: the next reference of the year, the record and the PDF kept as issued, all in the audit log', async () => {
  const h = harness();
  const pv = await h.call('POST', { body: { action: 'preview', letter: appreciation(RAYA) } });
  assert.equal(pv.statusCode, 200);
  assert.equal(Buffer.from(pv.json.pdf, 'base64').subarray(0, 5).toString(), '%PDF-');
  assert.equal(pv.json.pages, 1);
  assert.equal((await h.call('GET')).json.letters.length, 0, 'a preview issues nothing');

  const one = await h.call('POST', { body: { action: 'issue', letter: appreciation(RAYA) } });
  assert.equal(one.statusCode, 200, JSON.stringify(one.json));
  assert.equal(one.json.letter.number, 'PFA/LET/2026/00001');
  assert.equal(one.json.letter.email, 'raya@example.com', 'the person\'s email, ready');
  const two = await h.call('POST', { body: { action: 'issue', letter: appreciation(SOHAN) } });
  assert.equal(two.json.letter.number, 'PFA/LET/2026/00002');
  const rec = (await h.db.collection('letters').doc('PFA-LET-2026-00001').get()).data();
  assert.equal(rec.recipient, 'Raya Shah\n4 Temple Road, Udupi 576101\nKarnataka', 'the district not said twice');
  assert.deepEqual(rec.layout, L.layoutOf({}));
  assert.equal(rec.issuedBy.email, 'office@pfa.test');
  const kept = h.files.get('letters/PFA-LET-2026-00001.pdf');
  assert.ok(kept && kept.equals(Buffer.from(one.json.pdf, 'base64')), 'the PDF kept is the one issued');
  assert.equal(rec.pdf.sha256, crypto.createHash('sha256').update(kept).digest('hex'));
  const dl = await h.call('GET', { query: { number: 'PFA/LET/2026/00001', format: 'pdf' } });
  assert.equal(dl.headers['content-type'], 'application/pdf');
  assert.ok(Buffer.from(dl.raw).equals(kept), 'downloaded as issued');
  assert.match(dl.headers['content-disposition'], /PFA-letter-PFA-LET-2026-00001\.pdf/);
  const log = (await h.db.collection('adminAudit').get()).docs.map((d) => d.data()).filter((a) => a.module === 'letters').map((a) => a.action);
  assert.deepEqual(log.sort(), ['letter-downloaded', 'letter-issued', 'letter-issued']);
  const listed = (await h.call('GET')).json.letters.map((l) => l.number);
  assert.deepEqual(listed, ['PFA/LET/2026/00002', 'PFA/LET/2026/00001']);
});

test('nothing is issued with a blank in it, nor longer than the most pages, and no reference is used up by a refusal', async () => {
  const h = harness();
  const t = L.TEMPLATES.appreciation;
  const blank = await h.call('POST', { body: { action: 'issue', letter: { kind: 'appreciation', subject: t.subject, body: t.body, closing: t.closing, recipient: 'Someone' } } });
  assert.equal(blank.statusCode, 422);
  assert.equal(blank.json.field, 'person');
  const huge = Object.assign(appreciation(RAYA), { body: Array(260).fill('A line of the letter that goes on.').join('\n\n') });
  const long = await h.call('POST', { body: { action: 'issue', letter: huge } });
  assert.equal(long.statusCode, 422);
  assert.match(long.json.message, /pages; the most is 6/);
  const ok = await h.call('POST', { body: { action: 'issue', letter: appreciation(RAYA) } });
  assert.equal(ok.json.letter.number, 'PFA/LET/2026/00001', 'the first number, still');
});

test('emailed with its PDF, to the person\'s email or another; the email seen first; a withdrawn letter is never sent', async () => {
  const h = harness();
  await h.call('POST', { body: { action: 'issue', letter: appreciation(RAYA) } });
  const seen = await h.call('POST', { body: { action: 'mail', number: 'PFA/LET/2026/00001' } });
  assert.equal(seen.json.to, 'raya@example.com', 'fetched from the person');
  assert.match(seen.json.subject, /Your PFA certificate of appreciation - PFA\/LET\/2026\/00001/);
  assert.equal(h.queued.length, 0, 'seeing it sends nothing');
  const sent = await h.call('POST', { body: { action: 'email', number: 'PFA/LET/2026/00001', email: 'Raya.S@Example.com' } });
  assert.equal(sent.json.state, 'sent');
  assert.equal(sent.json.to, 'raya.s@example.com');
  assert.equal(h.delivered[0].template, 'pfa_letter');
  assert.equal(h.delivered[0].payload.number, 'PFA/LET/2026/00001');
  assert.equal(sent.json.letter.sent.to, 'raya.s@example.com');
  const off = await h.call('POST', { body: { action: 'withdraw', number: 'PFA/LET/2026/00001', reason: 'Wrong name' } });
  assert.equal(off.json.letter.withdrawn, true);
  const again = await h.call('POST', { body: { action: 'email', number: 'PFA/LET/2026/00001' } });
  assert.equal(again.statusCode, 409);
  assert.match(again.json.message, /withdrawn letter is not sent/);
  assert.equal((await h.call('POST', { body: { action: 'withdraw', number: 'PFA/LET/2026/00001', reason: 'x' } })).statusCode, 422);
});

test('the email carries the letter as issued, read from where it was kept', async () => {
  const mail = read('lib/caregiver-mail.js');
  assert.match(mail, /if \(template === 'pfa_letter'\) \{[\s\S]*collection\('letters'\)\.doc\(L\.docIdOf\(number\)\)[\s\S]*if \(l\.withdrawn\) return \[\];[\s\S]*filename: L\.fileName\(number\)/);
});

test('the signature, the seal and the letterhead are never public; the panel has the studio under Certificates', () => {
  for (const f of ['letterhead.png', 'signature.png', 'seal.png']) assert.ok(fs.existsSync(path.join(ROOT, 'lib/letter-art', f)), f);
  assert.match(read('scripts/minify.js'), /const SKIP_DIRS = new Set\(\[[^\]]*'lib'/, 'the public site is built without lib/');
  const B = require('../scripts/build-firebase.js');
  assert.ok(!B.PUBLIC_DIRS.includes('lib') && !(B.PANEL_ASSETS || []).some((a) => /letter-art/.test(a)), 'nor is Hosting given it');
  for (const f of ['assets/admin-letters.js', 'admin.html']) assert.doesNotMatch(read(f), /letter-art/, `${f} never names the art`);
  for (const k of Object.keys(L._test.ART_FILES)) assert.match(read('lib/letters.js'), new RegExp(`'letter-art', '${k}\\.png'`), 'named in full, so the bundlers carry it');
  assert.match(read('lib/pdf-fonts.js'), /'report-fonts', 'liberation-sans-400\.ttf'/);
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/report-fonts/OFL-Liberation.txt')), 'Liberation Sans\'s licence travels with it');

  const admin = read('admin.html');
  assert.match(admin, /certificates: \{ title: 'Certificates', module: 'certificates', needs: 'certificates', panes: \['certificates', 'letters'\] \}/);
  assert.match(admin, /letters: \{ title: 'Letter studio', module: 'letters', needs: 'letters' \}/);
  assert.match(admin, /<div class="pane" data-pane="letters" role="region" aria-label="Letter studio">/);
  assert.match(admin, /if \(tab === 'letters'\) return window\.PFALetters && window\.PFALetters\.pane\(\);/);
  assert.match(admin, /<script src="assets\/admin-letters\.js"><\/script>/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-letters\.js'/);
  assert.match(read('api/index.js'), /'admin\/letters': \(\) => require\('\.\.\/lib\/routes\/admin\/letters\.js'\)/);
  assert.match(read('firestore.rules'), /match \/letters\/\{id\}\s+\{ allow read, write: if false; \}/);
  assert.ok(require('../lib/admin-modules').MODULE_KEYS.includes('letters'));
  const js = read('assets/admin-letters.js');
  assert.match(js, /'\/api\/admin\/letters\?people=' \+ encodeURIComponent/, 'the person found in the People directory');
  assert.match(js, /field\('recipient'\)\.value = p\.recipient \|\| p\.name;/, 'their address on the letter');
  assert.match(js, /field\('email'\)\.value = p\.email \|\| '';/, 'their email, fetched');
  assert.match(js, /split\('\[Name\]'\)\.join\(p\.name\)/, 'their name in it');
  assert.doesNotMatch(js + read('lib/letters.js') + read('lib/routes/admin/letters.js'), /[–—]/, 'no long dash');
});
