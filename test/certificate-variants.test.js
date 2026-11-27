'use strict';

/* Certificate variants, and the signature on the cards (owner, 15 Nov 2026:
   "Add Maneka Gandhi's signature to caregiver and membership cards using the
   same logic as the internship certificate. Also, create certificate
   variants for different purposes, with distinct colour options").

   Five purposes, each with its own number, words and colour; a colour
   chosen for any one certificate; the internship in gold drawn exactly as
   the design. The two cards carry the certificate's own signature above
   their signature line, moved by the studio's Signature position, kept for
   the whole site. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const audit = require('../lib/admin-audit');
const ROUTE = require('../lib/routes/admin/certificates');
const VERIFY = require('../lib/routes/verify-certificate');
const CARDSIG = require('../lib/routes/admin/card-signature');
const LAYOUT = require('../lib/certificate-layout');
const K = require('../lib/certificate-kinds');
const C = require('../assets/certificate.js').PFACertificate;
const MAIL = require('../lib/caregiver-mail');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.parse('2026-11-15T09:00:00.000Z');

let db; let auditRows; let realRecord;
test.beforeEach(() => {
  db = memoryFirestore();
  auditRows = [];
  realRecord = audit.record;
  audit.record = async (who, row) => { auditRows.push(row); };
});
test.afterEach(() => { audit.record = realRecord; });

function respond(resolve) {
  const out = { statusCode: 200 };
  return { out, response: { get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; }, setHeader() {}, status(v) { out.statusCode = v; return this; }, json(b) { out.json = b; resolve(out); },
    end(raw) { out.json = JSON.parse(String(raw || '{}')); resolve(out); } } };
}
function issue(body, module) {
  const handler = ROUTE.createHandler({ getDb: () => db, now: () => NOW, requireAdmin: async (q, r, m) => { if (module) module.push(m); return { uid: 'u1', email: 'office@pfa.test', name: 'Office' }; } });
  return new Promise((resolve, reject) => {
    const { response } = respond(resolve);
    Promise.resolve(handler({ method: 'POST', url: '/api/admin/certificates', query: {}, body: Object.assign({ action: 'issue' }, body), headers: {} }, response)).catch(reject);
  });
}
function verify(n) {
  const handler = VERIFY.createHandler({ getDb: () => db });
  return new Promise((resolve, reject) => {
    const { response } = respond(resolve);
    Promise.resolve(handler({ method: 'GET', url: '/api/verify-certificate', query: { n }, headers: {} }, response)).catch(reject);
  });
}

test('five purposes, each with its own number prefix, words and colour', () => {
  assert.deepEqual(C.KIND_ORDER, ['internship', 'volunteer', 'participation', 'recognition', 'donor']);
  assert.deepEqual(C.KIND_ORDER.map((k) => C.KINDS[k].prefix), ['INT', 'VOL', 'PAR', 'REC', 'DNR']);
  assert.deepEqual(C.KIND_ORDER.map((k) => C.KINDS[k].words.title), ['Certificate of Completion', 'Certificate of Appreciation', 'Certificate of Participation', 'Certificate of Recognition', 'Certificate of Appreciation']);
  assert.deepEqual(C.COLOUR_ORDER, ['gold', 'forest', 'blue', 'maroon']);
  assert.deepEqual(C.KIND_ORDER.map((k) => C.KINDS[k].colour), ['gold', 'forest', 'blue', 'maroon', 'gold'], 'each purpose its own colour');
  assert.equal(C.COLOURS.gold.border, '#b8a77c', 'gold is the design\'s own');
  assert.equal(new Set(C.COLOUR_ORDER.map((c) => C.COLOURS[c].border)).size, 4, 'four distinct colours');
  for (const n of ['PFA-INT-ABCDEFGH', 'PFA-VOL-ABCDEFGH', 'PFA-PAR-ABCDEFGH', 'PFA-REC-ABCDEFGH', 'PFA-DNR-ABCDEFGH']) assert.match(n, K.NUMBER);
  assert.doesNotMatch('PFA-DON-ABCDEFGH', K.NUMBER, 'never a donation\'s order number');
  assert.equal(C.kindOf({ number: 'PFA-REC-ABCDEFGH' }), 'recognition');
  assert.equal(C.colourOf({ kind: 'participation' }), 'blue');
  assert.equal(C.colourOf({ kind: 'participation', colour: 'maroon' }), 'maroon');
  assert.equal(C.lineOf({ kind: 'donor' }), 'A generous gift to the animals');
  assert.equal(C.lineOf({ kind: 'internship', line: 'anything' }), 'Remote Internship', 'the internship\'s line is fixed');
  const all = JSON.stringify(C.KINDS) + JSON.stringify(C.COLOURS);
  assert.doesNotMatch(all, /[–—]/, 'no long dash');
});

test('the internship is drawn from the design\'s own measurements, its words taken out of the art', () => {
  const js = read('assets/certificate.js');
  assert.match(js, /\/\* design:start \(scripts\/build-certificate-art\.js writes this\) \*\//);
  for (const key of ['eyebrow', 'title', 'subtitle', 'star', 'presented', 'lead', 'course', 'after', 'mission', 'dateLabel', 'idLabel']) assert.ok(js.includes(`"${key}": {`), key);
  const art = read('scripts/build-certificate-art.js');
  assert.match(art, /\.certificate:before,\.certificate:after\{display:none!important\}/, 'the borders are drawn in the colour, not baked in');
  assert.match(art, /function writeDesign\(words\)/);
  assert.equal(C.KINDS.internship.words.title, 'Certificate of Completion');
  assert.equal(C.KINDS.internship.words.course, 'Remote Internship');
});

test('issuing a volunteer, participation, recognition or donor certificate: its number, its line, its colour, checked', async () => {
  let r = await issue({ kind: 'volunteer', name: 'asha rao', line: 'Rescue volunteer, PFA Udupi', date: '2026-11-10', issuedOn: '2026-11-15' });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  const v = r.json.certificate;
  assert.match(v.number, /^PFA-VOL-[A-HJ-NP-Z2-9]{8}$/);
  assert.deepEqual([v.kind, v.colour, v.line, v.date, v.name, v.kindLabel], ['volunteer', 'forest', 'Rescue volunteer, PFA Udupi', '2026-11-10', 'Asha Rao', 'Volunteer appreciation']);
  assert.match(auditRows[0].detail, /^Volunteer appreciation: Asha Rao, Rescue volunteer, PFA Udupi, forest, issued on 2026-11-15$/);

  r = await issue({ kind: 'participation', colour: 'maroon', name: 'Ravi Kumar', line: 'Vaccination camp, Udupi' });
  assert.equal(r.json.certificate.colour, 'maroon', 'a colour chosen for this one');
  assert.match(r.json.certificate.number, /^PFA-PAR-/);

  r = await issue({ kind: 'donor', name: 'Karan Shah' });
  assert.equal(r.statusCode, 200, 'a donor\'s line has its own words');
  assert.equal(r.json.certificate.colour, 'gold');

  for (const [body, field] of [
    [{ kind: 'recognition', name: 'Meera Nair' }, 'line'],
    [{ kind: 'recognition', name: 'Meera Nair', line: 'x'.repeat(71) }, 'line'],
    [{ kind: 'participation', name: 'Meera Nair', line: 'Camp', colour: 'purple' }, 'colour'],
    [{ kind: 'party', name: 'Meera Nair' }, 'kind'],
    [{ kind: 'participation', name: 'Meera Nair', line: 'Camp', date: '2026-12-01', issuedOn: '2026-11-15' }, 'date'],
    [{ kind: 'participation', name: '', line: 'Camp' }, 'name']
  ]) {
    const bad = await issue(body);
    assert.equal(bad.statusCode, 422, JSON.stringify(body));
    assert.equal(bad.json.field, field, JSON.stringify(body));
  }
  /* an internship is as it always was */
  r = await issue({ name: 'asha rao', startDate: '2026-11-01', endDate: '2026-12-26', issuedOn: '2026-12-28' });
  assert.match(r.json.certificate.number, /^PFA-INT-/);
  assert.equal(r.json.certificate.colour, 'gold');
});

test('the public check and the email say what it is for', async () => {
  const r = await issue({ kind: 'participation', name: 'Ravi Kumar', line: 'Vaccination camp, Udupi', date: '2026-11-09', issuedOn: '2026-11-15' });
  const n = r.json.certificate.number;
  const v = await verify(n);
  assert.equal(v.statusCode, 200);
  assert.deepEqual([v.json.kind, v.json.kindLabel, v.json.title, v.json.about, v.json.colour], ['participation', 'Participation', 'Certificate of Participation', 'Vaccination camp, Udupi, 9 November 2026', 'blue']);
  const page = read('verify-certificate.html');
  /* and a letter, PFA-LET- (20 Nov 2026, test/letters.test.js) */
  assert.match(page, /var NUMBER = \/\^PFA-\(INT\|VOL\|PAR\|REC\|DNR\|LET\)-\[A-HJ-NP-Z2-9\]\{8\}\$\/;/);
  assert.match(read('certificate.html'), /record = \{ kind: d\.kind \|\| 'internship', colour: d\.colour, line: d\.line, date: d\.date,/);
  const letter = MAIL.TEMPLATES.internship_certificate({ kind: 'participation', name: 'Ravi Kumar', number: n, line: 'Vaccination camp, Udupi', date: '2026-11-09', issuedOn: '2026-11-15' });
  assert.equal(letter.subject, `Your PFA certificate of participation - ${n}`);
  assert.match(letter.text, /thank you for taking part in Vaccination camp, Udupi on 9 November 2026/);
  assert.match(letter.text, /Took part in: Vaccination camp, Udupi/);
  const intern = MAIL.TEMPLATES.internship_certificate({ name: 'Asha Rao', number: 'PFA-INT-ABCDEFGH', startDate: '2026-11-01', endDate: '2026-12-26', issuedOn: '2026-12-28' });
  assert.match(intern.subject, /^Your PFA internship certificate/, 'the internship\'s letter is unchanged');
});

test('the panel: what it is for, then a colour, then the details; in its own file', () => {
  const pane = read('assets/admin-cert-pane.js');
  assert.match(pane, /<label for="ctKind">What it is for<\/label>/);
  assert.match(pane, /data-ct-hue="' \+ esc\(h\) \+ '" aria-pressed="/);
  assert.match(pane, /<label for="ctLine">' \+ esc\(s\.line\.label\) \+ '<\/label>/);
  assert.match(pane, /<label for="ctDate">Date <span class="ct-opt">\(optional\)<\/span><\/label>/);
  assert.ok(fs.statSync(path.join(ROOT, 'admin.html')).size < 409600, 'the panel stays under its ceiling');
  assert.doesNotMatch(pane, /[–—]/);
});

test('the cards: the signature above the line, moved by the studio, saved for every card, never printed without it', async () => {
  for (const f of ['assets/caregiver-card.js', 'assets/member-card.js']) {
    const js = read(f);
    assert.match(js, /var SIG_SRC = 'assets\/certificates\/signature-print\.png';/, f);
    assert.match(js, /fetch\('\/api\/certificate-layout'/, `${f}: the saved place`);
    assert.match(js, /The signature did not load, so the card/, `${f}: no card printed without it`);
    assert.match(js, /setSignature: setSignature/);
  }
  assert.match(read('assets/caregiver-card.js'), /var shh = SIG_BOX\.h \* sigAt\.s \/ 100;\n {6}var sw = shh \* SIG_BOX\.aspect;/, 'at the size the studio set (owner, 15 Nov 2026)');
  assert.match(read('assets/caregiver-card.js'), /ctx\.drawImage\(data\.signatureImage, P\.v\(sg\.x \+ 6 \+ sigAt\.x\), P\.v\(sg\.line - SIG_BOX\.gap - shh \+ sigAt\.y\)/);
  const admin = read('admin.html');
  assert.match(admin, /<div data-sig-card="caregiver"><\/div>/);
  assert.match(admin, /<div data-sig-card="member"><\/div>/);
  assert.match(read('assets/admin-cert-layout.js'), /A\.api\('\/api\/admin\/card-signature', \{ method: 'POST', body: \{ card: card, x: x, y: y, s: sz \} \}\)/);
  assert.match(read('assets/admin-cert-layout.js'), /\+ sizeRow\('cs' \+ card \+ 's', 'data-csig="' \+ card \+ '" data-axis="s"', l\.s \|\| 100\)/, 'Size, under Left / right and Up / down');
  assert.match(read('api/index.js'), /'admin\/card-signature': \(\) => require\('\.\.\/lib\/routes\/admin\/card-signature\.js'\)/);

  /* saved, logged, and told to the panel; each card by its own section */
  const asked = [];
  const handler = CARDSIG.createHandler({ getDb: () => db, now: () => NOW, requireAdmin: async (q, r, m) => { asked.push(m); return { uid: 'u1', email: 'office@pfa.test' }; } });
  const post = (body) => new Promise((resolve, reject) => { const { response } = respond(resolve); Promise.resolve(handler({ method: 'POST', body, headers: {} }, response)).catch(reject); });
  let r = await post({ card: 'member', x: 12, y: -4 });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  r = await post({ card: 'caregiver', x: -60, y: 30 });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(asked, ['membership', 'caregivers']);
  assert.equal((await post({ card: 'caregiver', x: 861, y: 0 })).statusCode, 422);
  assert.equal(auditRows.length, 2);
  assert.match(auditRows[0].detail, /membership card moved from 0 across, 0 down to 12 across, -4 down/);
  assert.deepEqual(await LAYOUT.readCards(db).then((c) => [c.caregiver.x, c.caregiver.y, c.member.x, c.member.y]), [-60, 30, 12, -4]);
  /* the size too (owner, 15 Nov 2026: "there should be option to adjust the size of the sign as well not just position") */
  assert.equal((await post({ card: 'member', x: 12, y: -4, s: 130 })).statusCode, 200);
  assert.equal((await LAYOUT.readCards(db)).member.s, 130);
  assert.equal((await post({ card: 'member', x: 12, y: -4, s: 400 })).statusCode, 422, 'a size past its range is refused');
  assert.equal((await post({ card: 'member', x: 12, y: -4 })).statusCode, 200);
  assert.equal((await LAYOUT.readCards(db)).member.s, 130, 'a move alone keeps the size');
  assert.match(auditRows[auditRows.length - 2].detail, /size from 100% to 130%/);
  await post({ card: 'member', x: 12, y: -4, s: 100 });
  /* the certificate's own place is untouched */
  assert.deepEqual(await LAYOUT.read(db).then((l) => [l.x, l.y]), [26, 0]);
  /* and the public answer carries the cards' */
  const pub = require('../lib/routes/certificate-layout.js');
  const firebase = require('../lib/firebase');
  firebase._setDbForTests(db);
  try {
    const out = await new Promise((resolve) => { const { response } = respond(resolve); pub({ method: 'GET', headers: {} }, response); });
    assert.deepEqual(out.json.cards, { caregiver: { x: -60, y: 30, s: 100 }, member: { x: 12, y: -4, s: 100 }, caregiverOnline: { x: 0, y: 0, s: 100 }, memberOnline: { x: 0, y: 0, s: 100 } });
  } finally { firebase._setDbForTests(null); }
});

test('never words on words: the frame has its own name, and the script and its art change together (owner, 15 Nov 2026: "all the certs look terrible because of double text/ text over text")', () => {
  const js = read('assets/certificate.js');
  const SC = require('../scripts/sync-chrome.js');
  assert.match(js, new RegExp(`var ART_V = '${SC.certArtStamp()}';`), 'run npm run sync:chrome');
  assert.match(js, /var ART = ROOT \+ 'assets\/certificates\/frame\.webp\?v=' \+ ART_V;/);
  assert.doesNotMatch(js, /completion\.webp|completion-print\.png/, 'never the full design, which already has the words');
  const v = require('node:crypto').createHash('sha256').update(js).digest('hex').slice(0, 10);
  for (const page of SC.CERT_PAGES) assert.ok(read(page).includes(`<script src="assets/certificate.js?v=${v}"></script>`), `${page} loads this very script`);
  /* the full design stays where it was, for a browser still holding the previous script */
  assert.ok(fs.statSync(path.join(ROOT, 'assets/certificates/completion.webp')).size > 50000);
  /* the frame carries none of the purpose's words: its middle is bare paper */
  assert.ok(fs.statSync(path.join(ROOT, 'assets/certificates/frame.webp')).size < fs.statSync(path.join(ROOT, 'assets/certificates/completion.webp')).size);
});
