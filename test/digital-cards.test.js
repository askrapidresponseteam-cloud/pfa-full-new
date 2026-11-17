'use strict';

/* Digital cards (owner, 15 Nov 2026: "Add an option to issue digital
   caregiver and membership cards with front and back views and a flip
   feature premium style ... Each should have a unique peopleforanimals.org
   URL, like the internship certificate. All cards and certificates must be
   verifiable online ... each bg to be in diff cool colors. like blue,
   yellow, etc. text, font, everything to be perfectly legible").

   Issued from the card studio with the photograph as drawn; its own
   address (the caregiver card's number, or a random PFA-MBR- for a member,
   never the member's sequential number); the page shows only what the card
   prints; it says when the card is expired or withdrawn; and the check page
   answers for every card and certificate. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const audit = require('../lib/admin-audit');
const DC = require('../lib/digital-cards');
const ADMIN = require('../lib/routes/admin/digital-cards');
const PUBLIC = require('../lib/routes/digital-card');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.parse('2026-11-15T09:00:00.000Z');
/* a real JPEG's first bytes, enough to be taken for one */
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(400, 7), Buffer.from([0xFF, 0xD9])]).toString('base64');

let db; let rows; let realRecord; let mails;
test.beforeEach(() => {
  db = memoryFirestore();
  rows = []; mails = [];
  realRecord = audit.record;
  audit.record = async (who, row) => { rows.push(row); };
});
test.afterEach(() => { audit.record = realRecord; });

function respond(resolve) {
  const out = { statusCode: 200, headers: {} };
  return { status(v) { out.statusCode = v; return this; }, json(b) { out.json = b; resolve(out); }, get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; }, setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
    end(raw) { out.raw = raw; try { out.json = JSON.parse(String(raw || '{}')); } catch (_) { out.json = null; } resolve(out); } };
}
function admin(method, body, asked) {
  const h = ADMIN.createHandler({ getDb: () => db, now: () => NOW, notify: async (m) => { mails.push(m); return { sent: true }; },
    requireAdmin: async (q, r, m) => { if (asked) asked.push(m); return { uid: 'u1', email: 'office@pfa.test' }; } });
  return new Promise((resolve, reject) => Promise.resolve(h(method === 'GET' ? { method, query: body, headers: {} } : { method, body, headers: {} }, respond(resolve))).catch(reject));
}
function open(query) {
  const h = PUBLIC.createHandler({ getDb: () => db, now: () => NOW });
  return new Promise((resolve, reject) => Promise.resolve(h({ method: 'GET', query, headers: {} }, respond(resolve))).catch(reject));
}
async function seed() {
  await db.collection('caretakerCards').doc('PFA-CCT-AB2CD3EF').set({ cardId: 'PFA-CCT-AB2CD3EF', name: 'ravi kumar', printName: 'Ravi Kumar', email: 'ravi@example.com', mobile: '9876543210', address: '12 MG Road', district: 'Udupi', state: 'Karnataka', issuedAt: '2026-10-24T10:00:00.000Z', validUntil: '2027-10-23T00:00:00.000Z', status: 'active' });
  await db.collection('memberCards').doc('PFA-MEM-2026-00004').set({ cardId: 'KA 2399', reference: 'PFA-MEM-2026-00004', name: 'Asha Rao', printName: 'Asha Rao', tierLabel: 'Golden', district: 'Udupi', state: 'Karnataka', validUntil: '2027-11-09', lifetime: false, approvedAt: '2026-11-10T08:00:00.000Z', status: 'active' });
  await db.collection('submissions').doc('PFA-MEM-2026-00004').set({ kind: 'PFA-MEM', fields: { name: 'Asha Rao', email: 'asha@example.com', mobile: '9000000001' } });
}
async function withCard() {
  await db.collection('submissions').doc('PFA-MEM-2026-00004').set({ kind: 'PFA-MEM', fields: { name: 'Asha Rao', email: 'asha@example.com', mobile: '9000000001' }, memberCard: { cardId: 'KA 2399', printName: 'Asha Rao' } });
}

test('a caregiver card online: its own number is its address; issued with its photograph, logged and emailed', async () => {
  await seed();
  const asked = [];
  const r = await admin('POST', { action: 'issue', kind: 'caregiver', ref: 'PFA-CCT-AB2CD3EF', photo: JPEG }, asked);
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  assert.deepEqual(asked, ['caregivers'], 'a caregiver card by whoever has Caregivers');
  assert.equal(r.json.digital.id, 'PFA-CCT-AB2CD3EF');
  assert.equal(r.json.digital.url, 'https://peopleforanimalsindia.org/card?id=PFA-CCT-AB2CD3EF');
  assert.deepEqual([r.json.digital.name, r.json.digital.number, r.json.digital.district, r.json.digital.state, r.json.digital.issuedOn, r.json.digital.validUntil, r.json.digital.standing], ['Ravi Kumar', 'PFA-CCT-AB2CD3EF', 'Udupi', 'Karnataka', '2026-10-24', '2027-10-23', 'valid']);
  assert.equal(r.json.emailed, true);
  assert.equal(mails[0].template, 'digital_card');
  assert.equal(mails[0].to, 'ravi@example.com');
  assert.equal(mails[0].payload.url, 'https://peopleforanimalsindia.org/card?id=PFA-CCT-AB2CD3EF');
  assert.match(rows[0].detail, /Colony Caregiver Card for Ravi Kumar/);
  /* the page: what the card prints, never the address, mobile or email */
  const page = await open({ id: 'pfa-cct-ab2cd3ef' });
  assert.equal(page.statusCode, 200);
  assert.doesNotMatch(JSON.stringify(page.json), /MG Road|9876543210|ravi@example/);
  const pic = await open({ id: 'PFA-CCT-AB2CD3EF', photo: '1' });
  assert.equal(pic.statusCode, 200);
  assert.equal(pic.headers['content-type'], 'image/jpeg');
  /* withdrawn: says so, shows no photograph */
  const w = await admin('POST', { action: 'withdraw', kind: 'caregiver', id: 'PFA-CCT-AB2CD3EF' });
  assert.equal(w.json.digital.standing, 'withdrawn');
  assert.equal((await open({ id: 'PFA-CCT-AB2CD3EF' })).json.standing, 'withdrawn');
  assert.equal((await open({ id: 'PFA-CCT-AB2CD3EF', photo: '1' })).statusCode, 404);
});

test('a membership card online: a random PFA-MBR address, never the member\'s number; issued again it keeps it', async () => {
  await seed();
  const asked = [];
  /* a membership card goes online without a photograph when there is none,
     and carries the member's when the panel sends it (owner, 16 Nov 2026:
     "We can still have photo appended on membership card (right side)") */
  const r = await admin('POST', { action: 'issue', kind: 'member', ref: 'PFA-MEM-2026-00004' }, asked);
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  assert.deepEqual(asked, ['membership']);
  assert.equal(r.json.digital.photo, false);
  const id = r.json.digital.id;
  assert.match(id, /^PFA-MBR-[A-HJ-NP-Z2-9]{8}$/);
  assert.deepEqual([r.json.digital.number, r.json.digital.tier, r.json.digital.kind], ['KA 2399', 'Golden', 'member']);
  assert.equal(mails[0].to, 'asha@example.com');
  const again = await admin('POST', { action: 'issue', kind: 'member', ref: 'PFA-MEM-2026-00004', photo: JPEG });
  assert.equal(again.json.digital.id, id, 'one card, one address');
  assert.equal((await admin('GET', { kind: 'member', ref: 'PFA-MEM-2026-00004' })).json.digital.id, id);
  assert.equal(again.json.digital.photo, true, 'the photograph sent is kept');
  assert.equal((await admin('POST', { action: 'issue', kind: 'member', ref: 'PFA-MEM-2026-00004' })).json.digital.photo, true, 'issued again without one, the photograph it has stays');
  assert.equal((await open({ id, photo: '1' })).statusCode, 200);
  /* a caregiver card never without its photograph; never a card not on the register */
  assert.equal((await admin('POST', { action: 'issue', kind: 'caregiver', ref: 'PFA-CCT-AB2CD3EF' })).statusCode, 422);
  assert.equal((await admin('POST', { action: 'issue', kind: 'member', ref: 'PFA-MEM-2026-00099', photo: JPEG })).statusCode, 422);
  assert.equal((await admin('POST', { action: 'issue', kind: 'caregiver', ref: 'PFA-CCT-ZZZZZZZZ', photo: JPEG })).statusCode, 422);
  assert.equal((await admin('POST', { action: 'issue', kind: 'caregiver', ref: 'PFA-CCT-AB2CD3EF', photo: Buffer.from('not a picture').toString('base64') })).statusCode, 422);
  /* expired, as the page says */
  assert.equal(DC.standing({ validUntil: '2026-01-01' }, NOW), 'expired');
  assert.equal(DC.standing({ lifetime: true }, NOW), 'valid');
  assert.equal((await open({ id: 'PFA-MBR-AAAAAAAA' })).statusCode, 404);
  assert.equal((await open({ id: 'KA 2399' })).statusCode, 400, 'a member number is not an address');
});

test('every card is checked online: a caregiver card, a membership card online, and a printed membership card by its number', async () => {
  await seed();
  const firebase = require('../lib/firebase');
  firebase._setDbForTests(db);
  try {
    const issued = await admin('POST', { action: 'issue', kind: 'member', ref: 'PFA-MEM-2026-00004', photo: JPEG });
    const verify = require('../lib/routes/verify-card');
    const ask = (id) => new Promise((resolve) => verify({ method: 'GET', query: { id }, headers: {} }, respond(resolve)));
    const mbr = await ask(issued.json.digital.id);
    assert.equal(mbr.statusCode, 200);
    assert.deepEqual([mbr.json.kind, mbr.json.name, mbr.json.number, mbr.json.valid], ['member', 'Asha Rao', 'KA 2399', true]);
    const printed = await ask('ka2399');
    assert.equal(printed.statusCode, 200, JSON.stringify(printed.json));
    assert.deepEqual([printed.json.name, printed.json.tier, printed.json.valid], ['Asha Rao', 'Golden', true]);
    assert.doesNotMatch(JSON.stringify(printed.json), /asha@example|9000000001/);
    assert.equal((await ask('KA 9999')).statusCode, 404);
  } finally { firebase._setDbForTests(null); }
  const page = read('verify-certificate.html');
  assert.match(page, /fetch\('\/api\/verify-card\?id=' \+ encodeURIComponent\(n\)/);
  assert.match(page, /Check a certificate or card\./);
});

test('the page: front and back, turned over by a tap, Enter or the button; sky blue for a caregiver, the owner\'s matte black for a member', () => {
  const html = read('card.html');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<link rel="stylesheet" href="assets\/digital-card\.css\?v=[a-f0-9]{10}">/);
  assert.match(html, /<script src="assets\/qr\.js\?v=[a-f0-9]{10}"><\/script>\n<script src="assets\/digital-card\.js\?v=[a-f0-9]{10}"><\/script>/);
  assert.match(html, /fetch\('\/api\/digital-card\?id=' \+ encodeURIComponent\(id\)/);
  assert.ok(require('../scripts/build-search-index').EXCLUDE.has('card.html'), 'a person\'s card is not for search');
  const css = read('assets/digital-card.css');
  const vars = (kind) => { const m = new RegExp(`\\.dc\\[data-kind="${kind}"\\]\\{([^}]*)\\}`).exec(css); return Object.fromEntries(m[1].split(';').filter(Boolean).map((x) => x.split(':'))); };
  const blue = vars('caregiver');
  const black = vars('member');
  assert.deepEqual([blue['--g1'], blue['--g4']], ['#f5faff', '#93c5fd'], 'sky blue');
  assert.deepEqual([black['--g1'], black['--g2'], black['--g3'], black['--g4']], ['#303234', '#111213', '#08090a', '#202224'], 'the template\'s own black');
  assert.match(css, /backface-visibility:hidden/);
  assert.match(css, /@container \(max-width:519px\)\{\n {2}\.dc__stage\{aspect-ratio:54\/85\.6\}/, 'upright on a phone');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(css + read('assets/digital-card.js') + html.replace(/<script id="pfa-vis">[\s\S]*?<\/script>/, ''), /[–—]/, 'no long dash');
  const js = read('assets/digital-card.js');
  assert.match(js, /if \(e\.key === 'Enter' \|\| e\.key === ' '\) \{ e\.preventDefault\(\); flip\(\); \}/);
  assert.match(js, /role="button" tabindex="0" aria-pressed="false"/);
  assert.match(js, /assets\/certificates\/signature\.svg" alt="Signature of Smt\. Maneka Sanjay Gandhi" width="1512" height="438"/, 'the chairperson\'s signature at print resolution, sharp at any zoom (owner, 15 Nov 2026: "is the signature super high res")');
  /* owner, 15 Nov 2026: "logo has to render perfectly. and it has to have
     transparent bg", "color of the card has to be chosen keeping the
     contrast in mind": every word in deep ink at 7 to 1 or more on every
     part of each card, the smaller labels at 4.5 to 1 or more, and the
     logo's own blue and black clear of the light corner it stands in */
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const v of [blue, black]) {
    for (const g of ['--g1', '--g2', '--g3', '--g4']) {
      assert.ok(ratio(v['--ink'], v[g]) >= 7, `ink ${v['--ink']} on ${v[g]}: ${ratio(v['--ink'], v[g]).toFixed(1)}`);
      assert.ok(ratio(v['--soft'], v[g]) >= 4.5, `labels ${v['--soft']} on ${v[g]}: ${ratio(v['--soft'], v[g]).toFixed(1)}`);
    }
  }
  for (const logo of ['#0064a0', '#000000']) assert.ok(ratio(logo, blue['--g1']) >= 4.5, `the logo's ${logo} on ${blue['--g1']}`);
  /* the black card's small type, the template's greys, read on its lightest corner */
  for (const grey of ['#969da5', '#b4b9bf', '#c1c5c9']) assert.ok(ratio(grey, '#303234') >= 4.5, `${grey} on the card`);
  assert.match(css, /\.dc__logo\{flex:none;display:block;width:15.5cqw\}/, 'the logo on the card itself, no panel behind it');
  assert.doesNotMatch(css, /--chip|\.dc__logo\{[^}]*background/, 'no white banner behind the logo');
  const page = fs.readFileSync(path.join(ROOT, 'card.html'), 'utf8');
  assert.match(page, /href="assets\/digital-card\.css\?v=[a-f0-9]{10}"/, 'the style is fingerprinted, so a new colour reaches every holder at once');
  assert.match(page, /src="assets\/digital-card\.js\?v=[a-f0-9]{10}"/);
  const png = fs.readFileSync(path.join(ROOT, 'media/member-card-logo.png'));
  assert.equal(png[25], 6, 'the logo is a PNG with its own transparency (colour type 6, RGBA)');
});

test('the panel: Issue online in each card studio, in its own file; the routes are wired', () => {
  const admin = read('admin.html');
  assert.match(admin, /<div data-digital="caregiver"><\/div>/);
  assert.match(admin, /<div data-digital="member"><\/div>/);
  assert.match(admin, /<script src="assets\/admin-digital-cards\.js"><\/script>/);
  assert.ok(fs.statSync(path.join(ROOT, 'admin.html')).size < 409600);
  const js = read('assets/admin-digital-cards.js');
  assert.match(js, /A\.api\('\/api\/admin\/digital-cards', \{ method: 'POST', body: \{ action: 'issue', kind: kind, ref: card\.ref, photo: photo, email: true \} \}\)/);
  const api = read('api/index.js');
  assert.match(api, /'admin\/digital-cards': \(\) => require\('\.\.\/lib\/routes\/admin\/digital-cards\.js'\)/);
  assert.match(api, /'digital-card': \(\) => require\('\.\.\/lib\/routes\/digital-card\.js'\)/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-digital-cards\.js'/);
  const fb = JSON.parse(read('firebase.json'));
  const host = Array.isArray(fb.hosting) ? fb.hosting[0] : fb.hosting;
  assert.ok(host.redirects.some((r) => r.source === '/card' && r.destination === 'https://peopleforanimalsindia.org/card'), 'the panel\'s host sends a card link to the public site');
  assert.match(read('firestore.rules'), /match \/digitalCards\/\{id\}\s+\{ allow read, write: if false; \}/);
});

/* Owner, 15 Nov 2026: "it cant be cluttered. have a clean and premium
   design". The front carries the logo, the card's name, the holder's name
   and place, two facts and the signature; nothing says the same thing
   twice, and the back holds only the check and where to return it. */
test('the faces: clean, each thing said once', () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="c"></div>', { runScripts: 'outside-only' });
  dom.window.eval(read('assets/qr.js'));
  dom.window.eval(read('assets/digital-card.js'));
  const D = dom.window.PFADigitalCard;
  const box = dom.window.document.getElementById('c');
  const base = { found: true, standing: 'valid', valid: true, district: 'Udupi', state: 'Karnataka', issuedOn: '2026-11-10', validUntil: '2027-11-09', url: 'https://peopleforanimalsindia.org/card?id=PFA-MBR-AB2CD3EF' };
  for (const [data, labels, kicker] of [
    [{ ...base, kind: 'caregiver', name: 'Ravi Kumar Shetty', id: 'PFA-CCT-AB2CD3EF', number: 'PFA-CCT-AB2CD3EF' }, ['Card number', 'Valid until'], null]
  ]) {
    D.render(box, data, {});
    const front = box.querySelector('.dc__front');
    assert.deepEqual([...front.querySelectorAll('.dc__lab')].map((l) => l.textContent), labels, 'two facts, no "Name" label');
    assert.equal(front.querySelector('.dc__name').textContent, data.name);
    assert.equal(front.querySelector('.dc__place').textContent, 'Udupi, Karnataka');
    const sub = front.querySelector('.dc__title span');
    assert.equal(sub ? sub.textContent : null, kicker, 'the logo already says People for Animals; a member\'s tier stands under the title');
    assert.equal(front.querySelectorAll('.dc__logo').length, 1);
    const back = box.querySelector('.dc__back');
    assert.equal(back.querySelectorAll('.dc__logo').length, 0, 'the back holds only the check and the return address');
    assert.equal(back.querySelector('.dc__strip'), null, 'no stripe on the back: it does nothing (owner, 15 Nov 2026: "no need of black strip at the back, has no function")');
    /* owner, 15 Nov 2026: "dont print the url ... at the back instead of
       check this card is genuine. just say something like find the card
       online or something standard. enterprise grade framing ... mention it
       is digital card. not to be printed and have 1 line of no misues" */
    assert.equal(back.querySelector('.dc__check b').textContent, 'Scan to verify');
    assert.doesNotMatch(back.textContent, /peopleforanimalsindia\.org|card\?id=|https?:/, 'no address printed: the QR code carries it');
    assert.deepEqual([...back.querySelectorAll('.dc__return p')].map((p) => p.textContent), [
      'This is a digital card, for display on screen only. It is not to be printed.',
      'This card is non-transferable. Any misuse will lead to its withdrawal.'
    ]);
    assert.ok(back.querySelector('.dc__qr svg, .dc__qr canvas, .dc__qr img, .dc__qr *'), 'the QR code of the card\'s own address');
    assert.ok(box.querySelector('.dc__noprint'), 'printed, the page says it is not to be printed');
  }
  /* the signature where the panel put it (owner, 15 Nov 2026: "give
     option to adjust the sign position") */
  D.render(box, { ...base, kind: 'caregiver', name: 'Ravi', id: 'PFA-CCT-AB2CD3EF', sig: { x: -20, y: 6 } }, {});
  assert.deepEqual([box.style.getPropertyValue('--sx'), box.style.getPropertyValue('--sy')], ['-20', '6']);
  const css = read('assets/digital-card.css');
  assert.match(css, /\.dc__sign img\{[^}]*transform:translate\(calc\(var\(--sx,0\) \* 100cqw \/ 856\),calc\(var\(--sy,0\) \* 100cqw \/ 856\)\)\}/, 'in tenths of a millimetre of a bank card 85.6 mm wide');
  assert.match(css, /\.dc__sign img\{height:calc\(max\(30px,10cqw\) \* var\(--ss,1\) \* var\(--sfit,1\)\);transform:translate\(calc\(var\(--sx,0\) \* 100cqw \/ 540\)/, 'and 54 mm wide upright, at the size the panel set');
  assert.match(css, /@media print\{\.dc__stage,\.dc__acts,\.dc__hint\{display:none!important\}\.dc__noprint\{display:block/, 'the card itself does not print');
  assert.match(read('card.html'), /D\.render\(box, Object\.assign\(\{\}, d, \{ url: d\.url \|\| here \}\)/, 'the QR code opens the card\'s own address, as PFA issued it');
  assert.doesNotMatch(css, /repeating-radial-gradient/, 'a clean ground, no pattern');
  assert.match(css, /font-size:calc\(max\(20px,6cqw\) \* var\(--fit,1\)\)/, 'a long name steps down to fit');
  const js = read('assets/digital-card.js');
  assert.match(js, /top\.getBoundingClientRect\(\)\.bottom \+ gap - name\.getBoundingClientRect\(\)\.top/, 'the name clear of the logo');
  /* 16 Nov 2026: a 320 px phone drew the member's name a quarter of its
     size, shrunk for lines it could not move; now only where it makes room */
  assert.match(js, /if \(o < least - 0\.5\) \{ least = o; best = f; \}/);
  assert.match(js, /f <= 0\.6\) break/);
  assert.match(js, /front\.style\.setProperty\('--fit', String\(best\)\)/);
});

test('the signature on a card online: its own place, set in the panel, saved, logged and served with the card', async () => {
  const L = require('../lib/certificate-layout');
  assert.deepEqual(Object.keys(L.CARDS), ['caregiver', 'member', 'caregiverOnline', 'memberOnline']);
  assert.equal(L.CARDS.caregiverOnline.module, 'caregivers');
  assert.equal(L.CARDS.memberOnline.module, 'membership');
  const db = require('./_memory-firestore.js').memoryFirestore();
  await L.writeCard(db, 'memberOnline', 14, -8, { email: 'a@b.c' }, Date.parse('2026-11-15T10:00:00Z'));
  const all = await L.readCards(db);
  assert.deepEqual([all.memberOnline.x, all.memberOnline.y, all.member.x, all.member.y], [14, -8, 0, 0], 'the printed card keeps its own');
  assert.equal(L.checkCard({ card: 'caregiverOnline', x: 61, y: 0 }).ok, false);
  const route = read('lib/routes/digital-card.js');
  assert.match(route, /view\.kind === 'member' \? 'memberOnline' : 'caregiverOnline'/);
  assert.match(route, /view\.sig = \{ x: Number\(sig\.x\) \|\| 0, y: Number\(sig\.y\) \|\| 0, s: Number\(sig\.s\) \|\| 100 \};/);
  const panel = read('assets/admin-digital-cards.js');
  assert.match(panel, /\(pre === 'dgs' \? 'Signature position online' : 'Signature size and position'\)/, 'apart from the printed card\'s Signature position');
  assert.match(panel, /A\.api\('\/api\/admin\/card-signature', \{ method: 'POST', body: \{ card: SIG\[kind\], x: l\.x, y: l\.y, s: l\.s \|\| 100 \} \}\)/);
  assert.match(panel, /<label for="' \+ pre \+ kind \+ 'sR">Size<\/label>/, 'the size, as well as the place (owner, 15 Nov 2026)');
  assert.match(panel, /Save for every card online/);
  const files = read('scripts/build-firebase.js');
  for (const f of ['assets/digital-card.css', 'assets/digital-card.js', 'media/member-card-logo.png', 'assets/certificates/signature.svg', 'fonts/dm-sans-latin-400.woff2']) assert.ok(files.includes(`'${f}'`), `${f} goes with the panel`);
});

/* Owner, 15 Nov 2026: "PFA-Premium-Membership.html for membership. let
   this be the exact template", then "font should be marcellus in
   membership card". */
test('the membership card online: the owner\'s template, in Marcellus, with what it must say', () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="c"></div>', { runScripts: 'outside-only' });
  dom.window.eval(read('assets/qr.js'));
  dom.window.eval(read('assets/digital-card.js'));
  const box = dom.window.document.getElementById('c');
  dom.window.PFADigitalCard.render(box, { kind: 'member', standing: 'valid', valid: true, name: 'Asha Venkataraman', id: 'PFA-MBR-AB2CD3EF', number: 'KA 2399', tier: 'Golden membership', district: 'Udupi', state: 'Karnataka', issuedOn: '2026-11-10', validUntil: '2027-11-09', url: 'https://peopleforanimalsindia.org/card?id=PFA-MBR-AB2CD3EF', sig: { x: 4, y: -2, s: 120 } }, { photo: 'data:image/png;base64,AAAA' });
  const front = box.querySelector('.dc__front');
  const back = box.querySelector('.dc__back');
  assert.equal(front.querySelector('.dcm__logo').getAttribute('src'), 'img/logo-dark.png', 'the template\'s logo for dark grounds, transparent');
  assert.equal(front.querySelector('.dcm__tier').textContent, 'Golden Membership');
  assert.equal(front.querySelector('.dcm__portrait'), null, 'not the faded stand-in the owner turned down');
  assert.equal(front.querySelector('.dcm__photo img').getAttribute('src'), 'data:image/png;base64,AAAA', 'the member\'s photograph, framed on the right (16 Nov 2026)');
  assert.ok(front.classList.contains('dcm--photo'), 'the name kept clear of it');
  assert.deepEqual([...front.querySelectorAll('.dcm__details > div')].map((d) => d.textContent), ['Member', 'Asha Venkataraman', 'Udupi, Karnataka']);
  assert.deepEqual([...front.querySelectorAll('.dcm__footer span')].map((d) => d.textContent.replace(/\s+/g, ' ')), ['KA 2399', 'Member since 2026']);
  /* owner, 15 Nov 2026: "a voice for the voiceless can be in 1 row", a
     sentence a line, and the signature just above the line, the name over
     "Chairperson, People for Animals" */
  assert.equal(back.querySelector('h2').innerHTML, 'A voice for the voiceless.');
  assert.match(read('assets/digital-card.css'), /\.dcm__message h2\{[^}]*white-space:nowrap\}/);
  assert.deepEqual([...back.querySelectorAll('.dcm__message p')].map((p) => p.textContent), [
    'This digital card identifies the named member of People for Animals.',
    'It is for display on screen only and is not to be printed.',
    'Non-transferable. Any misuse will lead to its withdrawal.'
  ]);
  const baseRow = back.querySelector('.dcm__base');
  assert.deepEqual([...baseRow.children].map((c) => c.className), ['dcm__sign', 'dcm__footer'], 'the signature sits just above the line');
  assert.deepEqual([baseRow.querySelector('.dcm__sign b').textContent, baseRow.querySelector('.dcm__sign span').textContent], ['Smt. Maneka Sanjay Gandhi', 'Chairperson, People for Animals']);
  assert.equal(back.querySelector('.dcm__scan').textContent, 'Scan to verify');
  assert.ok(back.querySelector('.dcm__qr svg path'), 'the QR code of the card\'s own address');
  assert.doesNotMatch(back.textContent, /card\?id=/, 'the card\'s address is in the code, not printed');
  assert.ok(back.querySelector('.dcm__sign img[src="assets/certificates/signature.svg"]'), 'the chairperson\'s signature, where the panel puts it');
  assert.deepEqual([box.style.getPropertyValue('--sx'), box.style.getPropertyValue('--sy'), box.style.getPropertyValue('--ss')], ['4', '-2', '1.2']);
  const css = read('assets/digital-card.css');
  assert.match(css, /\.dc\[data-kind="member"\]\{[^}]*font-family:var\(--dc-serif\)\}/, 'Marcellus throughout');
  assert.doesNotMatch(css.slice(css.indexOf('/* ---- the membership card')), /Georgia|Arial/, 'none of the template\'s stand-in faces');
  assert.doesNotMatch(css + read('assets/digital-card.js'), /dcm__portrait|cutout/);
  assert.match(css, /\.dc\[data-kind="member"\] \.dc__stage\{aspect-ratio:85\.6\/53\.98\}/, 'a bank card\'s shape, on a phone too');
  assert.match(css, /\.dcm__sign img\{[^}]*filter:brightness\(0\) invert\(1\)[^}]*100cqw \/ 856/, 'white on black, moved as the panel says');
  assert.match(read('assets/admin-digital-cards.js'), /var photo = jpeg\(card\.photo\);/, 'the panel sends the photograph on the card, when there is one');
  assert.ok(read('scripts/build-firebase.js').includes("'img/logo-dark.png'"), 'the panel draws it too');
});

/* owner, 16 Nov 2026: "why no option preview and issue digital card?" from
   the Members and Caregivers registers, where no card studio is on screen:
   the photograph kept on the server is used, and Preview saves nothing. */
test('from a register: Preview card draws it with the kept photograph and saves nothing; Issue uses the kept photograph', async () => {
  await seed();
  await db.collection('caretakerCards').doc('PFA-CCT-AB2CD3EF').update({ applicationRef: 'PFA-CG-2026-00007' });
  await db.collection('submissions').doc('PFA-CG-2026-00007').collection('attachments').doc('1').set({ bytes: Buffer.from(JPEG, 'base64'), contentType: 'image/jpeg' });
  await db.collection('memberCards').doc('PFA-MEM-2026-00004').update({ photo: 'p1' });
  await db.collection('submissions').doc('PFA-MEM-2026-00004').collection('attachments').doc('p1').set({ bytes: Buffer.from(JPEG, 'base64'), contentType: 'image/jpeg' });

  const p = await admin('GET', { kind: 'caregiver', ref: 'PFA-CCT-AB2CD3EF', preview: '1' });
  assert.equal(p.statusCode, 200, JSON.stringify(p.json));
  assert.equal(p.json.card.name, 'Ravi Kumar');
  assert.equal(p.json.card.url, '', 'not online yet: no address, so no QR code');
  assert.equal(p.json.online, null);
  assert.match(p.json.photo, /^data:image\/jpeg;base64,/);
  assert.equal((await db.collection('digitalCards').doc('PFA-CCT-AB2CD3EF').get()).exists, false, 'a preview saves nothing');
  assert.equal(mails.length, 0);

  const cg = await admin('POST', { action: 'issue', kind: 'caregiver', ref: 'PFA-CCT-AB2CD3EF', email: true });
  assert.equal(cg.statusCode, 200, JSON.stringify(cg.json));
  assert.equal(cg.json.digital.photo, true, 'the application\'s photograph');
  assert.equal(cg.json.emailed, true);
  const after = await admin('GET', { kind: 'caregiver', ref: 'PFA-CCT-AB2CD3EF', preview: '1' });
  assert.equal(after.json.online.url, 'https://peopleforanimalsindia.org/card?id=PFA-CCT-AB2CD3EF');

  const m = await admin('POST', { action: 'issue', kind: 'member', ref: 'PFA-MEM-2026-00004', email: true });
  assert.equal(m.statusCode, 200, JSON.stringify(m.json));
  assert.equal(m.json.digital.photo, true, 'the member\'s approved photograph');

  /* a caregiver card with no photograph anywhere: said plainly, not issued */
  await db.collection('caretakerCards').doc('PFA-CCT-ZZ2ZZ3ZZ').set({ cardId: 'PFA-CCT-ZZ2ZZ3ZZ', name: 'No Photo', email: 'n@example.com', status: 'active' });
  const none = await admin('POST', { action: 'issue', kind: 'caregiver', ref: 'PFA-CCT-ZZ2ZZ3ZZ' });
  assert.equal(none.statusCode, 422);
  assert.match(none.json.message, /No photograph was found with the application/);
  assert.equal((await admin('GET', { kind: 'member', ref: 'PFA-MEM-2026-00099', preview: '1' })).statusCode, 422);
});

/* owner, 16 Nov 2026: "sign should be super high res. like 4k . sharp and
   crisp. even when zoomed": the card online draws it as lines, not pixels */
test('the signature online is a vector: lines in the ink of the print master, sharp at any zoom', () => {
  const svg = read('assets/certificates/signature.svg');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1512 438"/);
  assert.match(svg, /<path fill="#0e33a6" fill-rule="evenodd" d="M/);
  assert.doesNotMatch(svg, /<image|data:image/, 'no picture inside it');
  assert.ok(svg.length < 60000, 'small enough to load at once');
  assert.match(read('scripts/build-firebase.js'), /'assets\/certificates\/signature\.svg'/, 'on the panel\'s server too');
});

/* owner, 16 Nov 2026: "there should be option to change size and pos of
   sign"; a large signature never runs into the words on a small screen */
test('signature size and position under Preview card; on a small screen it steps down only as far as it must', () => {
  const panel = read('assets/admin-digital-cards.js');
  assert.match(panel, /sigFold\(kind, 'dgr' \+ ref\.replace/);
  assert.match(panel, /\.rg-dc__card > \.dc'\), function \(box\) \{/);
  assert.match(panel, /box\._pfaFit\(\)/);
  const js = read('assets/digital-card.js');
  assert.match(js, /box\._pfaFit = fitAll;/);
  assert.match(js, /var least = Math\.max\(0\.5, floor \|\| 0\);/);
  assert.match(js, /shrinkSign\(back, crowd, ownSize\(back\)\);/);
  assert.equal((read('assets/digital-card.css').match(/var\(--ss,1\) \* var\(--sfit,1\)/g) || []).length, 4);
});

test('the registers: a Digital card part under Open on Members and Caregivers lines, with Preview card and Issue digital card', () => {
  const regs = read('assets/admin-registers.js');
  const dc = read('assets/admin-digital-cards.js');
  assert.match(regs, /PFADigitalCards\.regSlot\(kind, r\)/);
  assert.match(regs, /PFADigitalCards\.regFill\(body\)/);
  assert.match(dc, /data-dgr="preview">Preview card</);
  assert.match(dc, />' \+ \(live \? 'Update and email again' : 'Issue digital card'\) \+ '</);
  assert.match(dc, /regSlot: regSlot, regFill: regFill/);
});

/* Owner, 17 Nov 2026: "there should be an easy way to preview and correct
   both caregiver and membership cards. easy way to do it in 1 go and also
   to do 1 by 1.. keep it super simple. people of age 70 should be able to
   do it easily". */
test('a card corrected: the name, district and state on the register\'s card; a card online is brought up to date, quietly', async () => {
  await seed();
  const first = await admin('POST', { action: 'issue', kind: 'member', ref: 'PFA-MEM-2026-00004' });
  const id = first.json.digital.id;
  mails.length = 0; rows.length = 0;
  const r = await admin('POST', { action: 'correct', kind: 'member', ref: 'PFA-MEM-2026-00004', name: 'Asha  Rao Shetty', district: 'Udupi', state: 'Karnataka' });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  assert.equal(r.json.changed, true);
  const card = db.dump()['memberCards/PFA-MEM-2026-00004'];
  assert.equal(card.printName, 'Asha Rao Shetty', 'spaces tidied');
  assert.equal(db.dump()[`digitalCards/${id}`].name, 'Asha Rao Shetty', 'the card online shows it at once');
  assert.equal(mails.length, 0, 'no second email for a correction');
  assert.match(rows[0].detail, /name now Asha Rao Shetty/);
  assert.equal(db.dump()['submissions/PFA-MEM-2026-00004'].memberCard, undefined, 'a membership with no card on it is left alone');
  /* the same again: nothing changed, nothing logged */
  rows.length = 0;
  const same = await admin('POST', { action: 'correct', kind: 'member', ref: 'PFA-MEM-2026-00004', name: 'Asha Rao Shetty', district: 'Udupi', state: 'Karnataka' });
  assert.equal(same.json.changed, false);
  assert.equal(rows.length, 0);
  /* the membership's copy of its card, which the printed card is drawn from */
  await withCard();
  await admin('POST', { action: 'correct', kind: 'member', ref: 'PFA-MEM-2026-00004', name: 'Asha R. Shetty', district: 'Udupi', state: 'Karnataka' });
  const sub = db.dump()['submissions/PFA-MEM-2026-00004'];
  assert.equal(sub.memberCard.printName, 'Asha R. Shetty');
  assert.equal(sub.fields.name, 'Asha Rao', 'what the member wrote is never changed');
  /* a caregiver card's district and state */
  const asked = [];
  const cg = await admin('POST', { action: 'correct', kind: 'caregiver', ref: 'PFA-CCT-AB2CD3EF', name: 'Ravi Kumar', district: 'Dakshina Kannada', state: 'Karnataka' }, asked);
  assert.equal(cg.statusCode, 200, JSON.stringify(cg.json));
  assert.deepEqual(asked, ['caregivers'], 'by whoever has Caregivers');
  assert.equal(db.dump()['caretakerCards/PFA-CCT-AB2CD3EF'].district, 'Dakshina Kannada');
  /* a name the card cannot print; a membership with no card yet */
  assert.equal((await admin('POST', { action: 'correct', kind: 'member', ref: 'PFA-MEM-2026-00004', name: 'Asha <b>' })).statusCode, 422);
  const none = await admin('POST', { action: 'correct', kind: 'member', ref: 'PFA-MEM-2026-00099', name: 'Someone' });
  assert.equal(none.statusCode, 404);
  assert.match(none.json.message, /Press Issue card/);
});

test('Check the cards: one by one and all at once, in large type, the card in its new style', () => {
  const js = read('assets/admin-cardcheck.js');
  assert.match(js, /data-ccx-view="one" aria-pressed="true">One by one<\/button><button type="button" data-ccx-view="all" aria-pressed="false">All at once<\/button>/);
  assert.match(js, /<label>Name on the card<input name="name"/);
  assert.match(js, /<label>District<input name="district"/);
  assert.match(js, /<label>State<input name="state"/);
  assert.match(js, /'Save and go to the next card'/);
  assert.match(js, /data-ccx="issue">Issue this card<\/button>/);
  assert.match(js, /data-ccx="issue-all">Issue the ' \+ waiting\.length/);
  assert.match(js, /data-ccx-change="' \+ i \+ '">Change<\/button>/);
  assert.match(js, /\.ccx__fix input\{height:56px;[^}]*font-size:20px/, 'large boxes and type');
  assert.match(js, /\.ccx__go button\{min-height:60px/, 'large buttons');
  assert.match(js, /body: \{ action: 'correct', kind: K\[S\.kind\]\.api, ref: item\.ref, name: t\.name, district: t\.district, state: t\.state \}/);
  assert.match(js, /body: \{ action: 'issue', reference: item\.ref, printName: t\.name \}/, 'issued with the name as typed');
  assert.match(js, /D\.render\(box, card, \{ root: '', photo: photo \|\| '', controls: false \}\)/, 'the new-style card');
  assert.doesNotMatch(js, /[–—]/);
  const html = read('admin.html');
  assert.match(html, /<script src="assets\/admin-digital-cards\.js"><\/script>\n<script src="assets\/admin-cardcheck\.js"><\/script>/);
  assert.match(html, /window\.PFACardCheck\.inPlaceOf\(canvas, \{ kind: 'caregiver'/, 'To decide shows the new style');
  assert.match(html, /window\.PFACardCheck\.inPlaceOf\(front, \{ kind: 'caregiver'/, 'a case\'s own preview too');
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-cardcheck\.js'/);
});
