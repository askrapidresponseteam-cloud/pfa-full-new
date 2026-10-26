'use strict';

/* The membership card, end to end (owner, 26 Oct 2026: "admin should have
   option to send email to the applicant to upload photo. once they upload the
   application should come to pfa for approval and card generation").

   The real routes, on an in-memory Firestore: the panel emails a member a
   private link, the member opens it and sends a photograph, the photograph
   waits for approval, the panel approves it into a card or asks for another,
   and the card is marked printed. Pinned alongside: the link is a secret
   that is stored only as a hash, works once, expires, and is retired by a
   newer one; the page learns nothing about the member beyond a first name;
   no step can be reached by a plain status change; and nothing is deleted. */

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { EventEmitter } = require('node:events');
const { memoryFirestore } = require('./_memory-firestore');

const firebase = require('../lib/firebase');
const adminAuth = require('../lib/admin-auth');
const S = require('../lib/submissions');
const FLOW = require('../lib/case-flow');
const MC = require('../lib/membership-card');
const FILES = require('../lib/file-store');
const ADMIN = require('../lib/routes/admin/membership');
const PHOTO = require('../lib/routes/membership/photo');

const DAY = 24 * 60 * 60 * 1000;

/* ---- harness ---------------------------------------------------------------- */

function request({ method = 'POST', body, query = {}, headers = {} } = {}) {
  const r = new EventEmitter();
  r.method = method; r.query = query; r.headers = Object.assign({ 'x-forwarded-for': '203.0.113.9' }, headers);
  r.socket = { remoteAddress: '203.0.113.9' };
  if (body !== undefined) process.nextTick(() => { r.emit('data', JSON.stringify(body)); r.emit('end'); });
  else process.nextTick(() => r.emit('end'));
  return r;
}

async function run(handler, req) {
  const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.raw = b; this.body = JSON.parse(b || '{}'); } };
  await handler(req, res);
  return res;
}

/* A real PNG of any size, so the server's own header check reads it. */
function png(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3, 200); row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const dataUrl = (bytes) => `data:image/png;base64,${bytes.toString('base64')}`;
const PHOTO_OK = dataUrl(png(600, 800));

function member(reference, extra) {
  return Object.assign({
    reference, kind: 'PFA-MEM', kindLabel: 'Membership', status: 'new',
    fields: { name: 'karthik dhanya', email: 'karthik@example.com', mobile: '9876543210', tier: 'Golden membership',
      address: '12 Car Street', city: 'Udupi', district: 'Udupi', state: 'Karnataka', pin: '576101', amount: 2500, orderId: 'PFA-MEM-ABCD1234' },
    createdAt: '2026-10-20T06:00:00.000Z', updatedAt: '2026-10-20T06:00:00.000Z', receivedAtMs: Date.parse('2026-10-20T06:00:00.000Z'),
    history: [{ status: 'new', at: '2026-10-20T06:00:00.000Z' }]
  }, extra || {});
}

function setup() {
  const db = memoryFirestore();
  firebase._setDbForTests(db);
  FILES._setBucket(() => null);           // no bucket: bytes are kept beside the record, as before Storage
  S.resetForTests();
  adminAuth._clearFailures();
  adminAuth.identify = async () => ({ mode: 'firebase', uid: 'u1', email: 'office@pfa.test', role: 'super', modules: [] });
  return db;
}
const realIdentify = adminAuth.identify;
test.after(() => { adminAuth.identify = realIdentify; firebase._setDbForTests(null); FILES._reset(); });

async function seed(db, reference, extra) {
  await db.collection('submissions').doc(reference).set(member(reference, extra));
}
const admin = (body) => run(ADMIN, request({ body }));
const adminGet = (query) => run(ADMIN, request({ method: 'GET', query }));

/* The link as the member receives it: the letter is queued (no mail is set
   up in a test), and the queued letter holds the only full copy. */
function linkIn(db, reference) {
  const rows = Object.entries(db.dump()).filter(([k, v]) => k.startsWith('caregiverEmails/') && v.template === 'member_photo_request' && v.payload.memberId === reference);
  const last = rows.map(([, v]) => v).sort((a, b) => String(a.payload.expiresAt).localeCompare(String(b.payload.expiresAt))).pop();
  return last ? decodeURIComponent(last.payload.uploadUrl.split('#t=')[1]) : '';
}
function linksIn(db, reference) {
  return Object.entries(db.dump()).filter(([k, v]) => k.startsWith('caregiverEmails/') && v.template === 'member_photo_request' && v.payload.memberId === reference)
    .map(([, v]) => decodeURIComponent(v.payload.uploadUrl.split('#t=')[1]));
}
const record = (db, reference) => db.dump()[`submissions/${reference}`];

/* ---- the rules on their own ------------------------------------------------- */

test('tiers, validity and the lifetime card', () => {
  assert.equal(MC.tierOf({ tier: 'Golden membership' }).key, 'golden');
  assert.equal(MC.tierOf({ tier: 'Lifetime membership' }).months, null);
  assert.equal(MC.tierWord(MC.tierOf({ tier: 'Student membership' })), 'Student');
  assert.equal(MC.addMonths('2026-01-31T00:00:00.000Z', 1), '2026-02-28T00:00:00.000Z', 'a month on from the 31st is the end of the next month');
  assert.equal(MC.addMonths('2026-10-26T06:00:00.000Z', 12), '2027-10-26T06:00:00.000Z');
  const life = MC.validityOf({ createdAt: '2026-10-26T06:00:00.000Z' }, MC.tierOf({ tier: 'Lifetime membership' }));
  assert.deepEqual([life.lifetime, life.validUntil], [true, '']);
});

test('the link is 256 random bits, and only its hash is ever stored', () => {
  const a = MC.newToken();
  const b = MC.newToken();
  assert.ok(MC.isToken(a.token) && a.token.length === 43);
  assert.notEqual(a.token, b.token);
  assert.equal(a.hash, MC.hashToken(a.token));
  assert.match(a.hash, /^[a-f0-9]{64}$/);
  assert.ok(!MC.isToken('short') && !MC.isToken(`${a.token}x`) && !MC.isToken(a.token.replace(/.$/, '!')));
});

test('a photograph is read from its own header: too small, sideways or not an image is refused', () => {
  assert.deepEqual(MC.imageSize(png(600, 800)), { w: 600, h: 800 });
  assert.equal(MC.checkPhoto(PHOTO_OK).ok, true);
  assert.match(MC.checkPhoto(dataUrl(png(200, 260))).message, /too small/);
  assert.match(MC.checkPhoto(dataUrl(png(800, 600))).message, /upright/);
  assert.equal(MC.checkPhoto('data:image/png;base64,aGVsbG8=').ok, false);
  assert.equal(MC.checkPhoto('').ok, false);
  /* a JPEG's size comes from its frame header */
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x20, 0x02, 0x58, 0x03, 0x01, 0x22, 0x00]);
  assert.deepEqual(MC.imageSize(jpeg), { w: 600, h: 800 });
});

test('the photo, received and approved stages are reached only by their actions', () => {
  for (const to of ['photo-requested', 'photo-received', 'card-approved']) {
    const plan = FLOW.planMove({ kind: 'PFA-MEM', status: 'new' }, to);
    assert.equal(plan.ok, false, to);
    assert.equal(plan.code, 'BAD_MOVE');
    assert.match(plan.message, /not by a status change/);
  }
  assert.equal(FLOW.planMove({ kind: 'PFA-MEM', status: 'card-approved' }, 'dispatched').ok, true, 'the kit still moves on as before');
  assert.equal(FLOW.isClosed('PFA-MEM', 'card-approved'), false, 'an approved card is not the end of a membership');
});

/* ---- the journey -------------------------------------------------------------- */

test('ask, send, approve, print: the whole journey on the real routes', async () => {
  const db = setup();
  const REF = 'PFA-MEM-2026-00012';
  await seed(db, REF);

  /* the queue shows a member to ask */
  let list = await adminGet({ queue: 'all' });
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.counts.request, 1);
  assert.equal(list.body.rows[0].name, 'Karthik Dhanya');

  /* 1. the panel emails the link */
  const asked = await admin({ action: 'request-photo', references: [REF, 'not-a-ref'] });
  assert.equal(asked.statusCode, 200);
  assert.equal(asked.body.results.length, 1, 'only well-formed member numbers are acted on');
  assert.equal(asked.body.results[0].ok, true);
  assert.equal(asked.body.results[0].to, 'karthik@example.com');
  let rec = record(db, REF);
  assert.equal(rec.status, 'photo-requested');
  assert.equal(rec.fields.name, 'karthik dhanya', 'what the member wrote is never rewritten');
  const token = linkIn(db, REF);
  assert.ok(MC.isToken(token));
  const linkDoc = db.dump()[`memberPhotoLinks/${MC.hashToken(token)}`];
  assert.ok(linkDoc, 'the link is filed under its hash');
  assert.ok(!Object.entries(db.dump()).some(([k, v]) => !k.startsWith('caregiverEmails/') && JSON.stringify(v).includes(token)), 'the raw link is kept nowhere but the outgoing letter');
  assert.equal(rec.memberPhoto.linkHash, MC.hashToken(token));

  /* 2. the member opens it: a first name and the membership, nothing else */
  const opened = await run(PHOTO, request({ body: { t: token, action: 'open' } }));
  assert.equal(opened.statusCode, 200);
  assert.equal(opened.body.firstName, 'Karthik');
  assert.equal(opened.body.membership, 'Golden membership');
  for (const secret of ['karthik@example.com', '9876543210', 'Car Street', '576101', 'PFA-MEM-ABCD1234', '2500']) {
    assert.ok(!opened.raw.includes(secret), `the page is never told ${secret}`);
  }
  assert.equal(opened.headers['Cache-Control'], 'no-store');

  /* 3. they send it: consent and a printable photograph are required */
  assert.equal((await run(PHOTO, request({ body: { t: token, action: 'send', photo: PHOTO_OK } }))).statusCode, 422);
  assert.equal((await run(PHOTO, request({ body: { t: token, action: 'send', consent: true, photo: dataUrl(png(100, 140)) } }))).statusCode, 422);
  const sent = await run(PHOTO, request({ body: { t: token, action: 'send', consent: true, photo: PHOTO_OK } }));
  assert.equal(sent.statusCode, 200, JSON.stringify(sent.body));
  rec = record(db, REF);
  assert.equal(rec.status, 'photo-received');
  assert.ok(rec.memberPhoto.current);
  const attachment = db.dump()[`submissions/${REF}/attachments/${rec.memberPhoto.current}`];
  assert.ok(attachment && attachment.width === 600 && attachment.height === 800 && attachment.consentAt);
  assert.ok(db.dump()[`memberPhotoLinks/${MC.hashToken(token)}`].usedAt, 'the link is used up');
  const used = await run(PHOTO, request({ body: { t: token, action: 'open' } }));
  assert.equal(used.statusCode, 410);
  assert.equal(used.body.state, 'used');
  const letters = Object.values(db.dump()).filter((v) => v && v.template && /^member_/.test(v.template));
  assert.ok(letters.some((l) => l.template === 'member_photo_received' && l.to === 'karthik@example.com'), 'the member is told it arrived');
  assert.ok(letters.some((l) => l.template === 'member_photo_staff' && l.to === 'gandhim@exmpls.sansad.in'), 'the office is told one is waiting');

  /* it now waits in To approve, with its photograph */
  list = await adminGet({ queue: 'review' });
  assert.equal(list.body.rows.length, 1);
  const detail = await adminGet({ reference: REF });
  assert.equal(detail.statusCode, 200);
  assert.equal(Buffer.from(detail.body.photo.data, 'base64').length, png(600, 800).length);
  assert.equal(detail.body.card.draft, true);
  assert.equal(detail.body.card.validUntil, '2027-10-20T06:00:00.000Z', 'a year from the day the membership was paid');

  /* 4. approve: the printed name is checked, the card is made once */
  assert.equal((await admin({ action: 'approve', reference: REF, printName: 'K<script>' })).statusCode, 422);
  const approved = await admin({ action: 'approve', reference: REF, printName: 'Karthik Dhanya' });
  assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
  const card = db.dump()[`memberCards/${REF}`];
  assert.equal(card.cardId, REF, 'the card carries the member number');
  assert.equal(card.printName, 'Karthik Dhanya');
  assert.equal(card.photo, rec.memberPhoto.current);
  rec = record(db, REF);
  assert.equal(rec.status, 'card-approved');
  assert.equal(rec.memberCard.cardId, REF);
  assert.ok(rec.history.some((h) => h.status === 'card-approved' && h.by === 'office@pfa.test'));
  assert.equal((await admin({ action: 'approve', reference: REF })).statusCode, 409, 'a card is approved once');
  assert.equal((await admin({ action: 'request-photo', references: [REF] })).body.results[0].code, 'ALREADY_ISSUED', 'no link after the card exists');
  assert.ok(Object.values(db.dump()).some((v) => v && v.template === 'member_card_approved'));

  /* 5. printed */
  const printed = await admin({ action: 'printed', references: [REF] });
  assert.equal(printed.body.results[0].ok, true);
  assert.ok(db.dump()[`memberCards/${REF}`].cardPrintedAt);
  assert.equal((await adminGet({ queue: 'all' })).body.rows[0].queue, 'printed');

  /* the public tracker reads the new stages in words */
  assert.equal(FLOW.labelOf('PFA-MEM', 'photo-received'), 'Photo received');

  /* everything was written down, by the person who did it */
  const audit = Object.values(db.dump()).filter((v) => v && v.module === 'membership');
  assert.ok(['member-photo-request', 'member-card-approve', 'member-cards-printed'].every((a) => audit.some((e) => e.action === a)));
});

test('a photograph that will not do: the member is told why and sent a new link; the old photograph is kept', async () => {
  const db = setup();
  const REF = 'PFA-MEM-2026-00013';
  await seed(db, REF);
  assert.equal((await admin({ action: 'retake', reference: REF, reasons: ['face'] })).statusCode, 409, 'nothing to retake before a photograph arrives');
  await admin({ action: 'request-photo', references: [REF] });
  const first = linkIn(db, REF);
  await run(PHOTO, request({ body: { t: first, action: 'send', consent: true, photo: PHOTO_OK } }));
  const firstPhoto = record(db, REF).memberPhoto.current;

  assert.equal((await admin({ action: 'retake', reference: REF })).statusCode, 400, 'a reason is required');
  const again = await admin({ action: 'retake', reference: REF, reasons: ['face', 'unknown-key'], note: 'Please remove the cap.' });
  assert.equal(again.statusCode, 200, JSON.stringify(again.body));
  const rec = record(db, REF);
  assert.equal(rec.status, 'photo-requested');
  assert.equal(rec.memberPhoto.current, '');
  assert.deepEqual(rec.memberPhoto.superseded, [firstPhoto]);
  assert.ok(db.dump()[`submissions/${REF}/attachments/${firstPhoto}`], 'the first photograph stays on file');
  assert.equal(rec.memberPhoto.reasons.length, 1, 'only known reasons are used');

  const links = linksIn(db, REF);
  const second = links.find((t) => t !== first);
  const reopened = await run(PHOTO, request({ body: { t: second, action: 'open' } }));
  assert.equal(reopened.statusCode, 200);
  assert.equal(reopened.body.retake, true);
  assert.match(reopened.body.reasons[0], /face is not clearly visible/);
  const letter = Object.values(db.dump()).find((v) => v && v.template === 'member_photo_request' && v.payload.uploadUrl.includes(encodeURIComponent(second)));
  assert.ok(letter.payload.reasons.includes('Please remove the cap.'));
});

test('a newer link retires the older; a link expires; an unknown or malformed link learns nothing', async () => {
  const db = setup();
  const REF = 'PFA-MEM-2026-00014';
  await seed(db, REF);
  let now = Date.parse('2026-10-26T06:00:00.000Z');
  const handler = PHOTO.createHandler({ now: () => now, tellOffice: async () => [] });

  await admin({ action: 'request-photo', references: [REF] });
  const first = linkIn(db, REF);
  await admin({ action: 'request-photo', references: [REF] });
  const second = linksIn(db, REF).find((t) => t !== first);
  assert.ok(second && second !== first);
  assert.equal((await run(handler, request({ body: { t: first, action: 'open' } }))).body.state, 'replaced');
  const stale = await run(handler, request({ body: { t: first, action: 'send', consent: true, photo: PHOTO_OK } }));
  assert.equal(stale.statusCode, 410);
  assert.equal(record(db, REF).status, 'photo-requested', 'a retired link files nothing');

  now = Date.now() + 15 * DAY;
  const late = await run(handler, request({ body: { t: second, action: 'open' } }));
  assert.equal(late.statusCode, 410);
  assert.equal(late.body.state, 'expired');

  const unknown = await run(handler, request({ body: { t: MC.newToken().token, action: 'open' } }));
  assert.equal(unknown.statusCode, 404);
  const malformed = await run(handler, request({ body: { t: '../../etc', action: 'open' } }));
  assert.equal(malformed.statusCode, 404);
  assert.equal(unknown.body.error, malformed.body.error, 'one answer for every link that is not one');
  assert.equal((await run(handler, request({ method: 'GET' }))).statusCode, 405, 'the secret never travels in a URL');
});

test('only a membership, with an email, before its card, is sent a link', async () => {
  const db = setup();
  await seed(db, 'PFA-MEM-2026-00015', { fields: { name: 'Asha Rao', email: '', tier: 'Student membership' } });
  await seed(db, 'PFA-MEM-2026-00016', { status: 'spam' });
  await db.collection('submissions').doc('PFA-V-2026-00001').set({ kind: 'PFA-V', status: 'new', fields: { email: 'v@example.com' } });
  const res = await admin({ action: 'request-photo', references: ['PFA-MEM-2026-00015', 'PFA-MEM-2026-00016', 'PFA-MEM-2026-00099'] });
  assert.deepEqual(res.body.results.map((r) => r.code), ['NO_EMAIL', 'CLOSED', 'NOT_FOUND']);
  assert.equal((await adminGet({ reference: 'PFA-V-2026-00001' })).statusCode, 400);
  assert.equal((await admin({ action: 'nonsense' })).statusCode, 400);
});

test('the section is its own: an account without it is refused, and the routes are registered', async () => {
  setup();
  adminAuth.identify = async () => ({ mode: 'firebase', uid: 'u2', email: 'staff@pfa.test', role: 'staff', modules: ['submissions', 'caregivers'] });
  const res = await adminGet({ queue: 'all' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.module, 'membership');
  const M = require('../lib/admin-modules');
  assert.ok(M.MODULE_KEYS.includes('membership'));
  const router = require('../api/index.js')._private;
  assert.ok(router.ROUTES['admin/membership'] && router.ROUTES['membership/photo']);
});

test('the panel draws the card, prints it, and never sends it; the page keeps the link out of every URL', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ROOT = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  assert.ok(html.includes('src="assets/member-card.js"'));
  assert.match(html, /data-tab="membership"/);
  const build = require('../scripts/build-firebase.js');
  for (const f of ['assets/member-card.js', 'media/member-card-logo.png', 'fonts/cinzel-latin-500.woff2', 'fonts/dm-sans-latin-500.woff2']) {
    assert.ok(build.PANEL_ASSETS.includes(f), `${f} ships with the panel`);
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is in the tree`);
  }
  const page = fs.readFileSync(path.join(ROOT, 'member-photo.html'), 'utf8');
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(page, /location\.hash/, 'the link is read from the fragment');
  assert.match(page, /history\.replaceState\(null, '', location\.pathname\)/, 'and taken out of the address bar');
  assert.match(page, /method: 'POST'/);
  assert.match(page, /href="ask\.html"/, 'a way to reach PFA at every step');
  assert.ok(!/[\u2013\u2014]/.test(page + fs.readFileSync(path.join(ROOT, 'assets', 'member-card.js'), 'utf8')), 'no long dashes');
  const mail = require('../lib/caregiver-mail');
  for (const t of ['member_photo_request', 'member_photo_received', 'member_card_approved', 'member_photo_staff']) {
    const r = mail.render(t, { name: 'Asha Rao', memberId: 'PFA-MEM-2026-00012', siteUrl: 'https://peopleforanimalsindia.org', uploadUrl: 'https://peopleforanimalsindia.org/member-photo.html#t=x', expiresAt: '2026-11-09T00:00:00Z', receivedAt: '2026-10-26T00:00:00Z' });
    assert.ok(!/base64|PFA-CCT|member-card/.test(r.html), `${t} carries no card image`);
  }
});
