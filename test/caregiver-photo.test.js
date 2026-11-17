'use strict';

/* Owner, 17 Nov 2026: "option to ask for photo should be there. for each and
   for all at once." A colony caregiver is asked for their photograph by the
   same private, one-time link a member is (lib/caregiver-photo.js); what
   they send becomes the card's photograph, on the application (a photograph
   sent before is kept beside it), and on a card already online at once. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { EventEmitter } = require('node:events');
const { memoryFirestore } = require('./_memory-firestore');

const firebase = require('../lib/firebase');
const adminAuth = require('../lib/admin-auth');
const S = require('../lib/submissions');
const FILES = require('../lib/file-store');
const DC = require('../lib/digital-cards');
const CARDS = require('../lib/routes/admin/digital-cards');
const PHOTO = require('../lib/routes/membership/photo');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function request({ method = 'POST', body } = {}) {
  const r = new EventEmitter();
  r.method = method; r.query = {}; r.headers = { 'x-forwarded-for': '203.0.113.7', authorization: 'Bearer test' };
  r.socket = { remoteAddress: '203.0.113.7' };
  if (body !== undefined) process.nextTick(() => { r.emit('data', JSON.stringify(body)); r.emit('end'); });
  else process.nextTick(() => r.emit('end'));
  return r;
}
async function run(handler, req) {
  const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.raw = b; this.body = JSON.parse(b || '{}'); } };
  await handler(req, res);
  return res;
}
function png(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3, 180); row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PHOTO_OK = `data:image/png;base64,${png(600, 800).toString('base64')}`;
const REF = 'PFA-CG-2026-00041';

function setup() {
  const db = memoryFirestore();
  firebase._setDbForTests(db);
  FILES._setBucket(() => null);
  S.resetForTests();
  adminAuth._clearFailures();
  adminAuth.identify = async () => ({ mode: 'firebase', uid: 'u1', email: 'office@pfa.test', role: 'super', modules: [] });
  return db;
}
const realIdentify = adminAuth.identify;
test.after(() => { adminAuth.identify = realIdentify; firebase._setDbForTests(null); FILES._reset(); });

async function seed(db, extra) {
  await db.collection('submissions').doc(REF).set(Object.assign({
    reference: REF, kind: 'PFA-CG', status: 'new', attachments: 0,
    fields: { name: 'trisha dey', email: 'trisha@example.com', mobile: '9883909733', address: 'Vill. Dhanicha', city: 'Dhanicha', district: 'Nadia', state: 'West Bengal', pin: '741222' },
    createdAt: '2026-11-10T05:00:00.000Z', receivedAtMs: Date.parse('2026-11-10T05:00:00.000Z'), history: [{ status: 'new', at: '2026-11-10T05:00:00.000Z' }]
  }, extra || {}));
}
function tokenOf(db) {
  const letters = Object.entries(db.dump()).filter(([k, v]) => k.startsWith('caregiverEmails/') && v.template === 'caregiver_photo_request');
  const url = letters.length ? letters[letters.length - 1][1].payload.uploadUrl : '';
  return decodeURIComponent((/#t=([^&]+)/.exec(url) || [])[1] || '');
}

test('ask a caregiver for a photograph: the link, the page, and the photograph on the application', async () => {
  const db = setup();
  await seed(db);
  const asked = await run(CARDS, request({ body: { action: 'ask-photo', kind: 'caregiver', refs: [REF] } }));
  assert.equal(asked.statusCode, 200, JSON.stringify(asked.body));
  assert.equal(asked.body.results[0].ok, true, JSON.stringify(asked.body.results));
  const token = tokenOf(db);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/, 'the caregiver is emailed the private link');
  const rec = db.dump()[`submissions/${REF}`];
  assert.equal(rec.status, 'new', 'the status is not touched');
  assert.ok(rec.caregiverPhoto.linkHash);

  const opened = await run(PHOTO, request({ body: { t: token, action: 'open' } }));
  assert.equal(opened.statusCode, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.kind, 'caregiver');
  assert.equal(opened.body.card, 'colony caregiver card');
  assert.ok(!opened.raw.includes('trisha@example.com') && !opened.raw.includes('9883909733'), 'the page is told nothing private');

  const sent = await run(PHOTO, request({ body: { t: token, action: 'send', consent: true, photo: PHOTO_OK } }));
  assert.equal(sent.statusCode, 200, JSON.stringify(sent.body));
  const after = db.dump()[`submissions/${REF}`];
  assert.equal(after.attachments, 1, 'the card\'s photograph, attachment 1');
  assert.ok(db.dump()[`submissions/${REF}/attachments/1`], 'filed where the card is drawn from');
  assert.equal(after.status, 'new');
  assert.equal((await run(PHOTO, request({ body: { t: token, action: 'open' } }))).body.state, 'used', 'once only');
  assert.ok(Object.values(db.dump()).some((v) => v && v.template === 'caregiver_photo_received'), 'a receipt');
});

test('for all at once; a photograph sent before is kept beside the new one; a card online takes it at once', async () => {
  const db = setup();
  await seed(db, { attachments: 1, cardId: 'PFA-CCT-AB2CD3EF', status: 'approved' });
  await db.collection('submissions').doc(REF).collection('attachments').doc('1').set({ label: 'First photograph', contentType: 'image/png', bytes: png(400, 500), size: 10 });
  await db.collection('caretakerCards').doc('PFA-CCT-AB2CD3EF').set({ cardId: 'PFA-CCT-AB2CD3EF', name: 'Trisha Dey', district: 'Nadia', state: 'West Bengal', applicationRef: REF, issuedAt: '2026-11-11T05:00:00.000Z', validUntil: '2029-11-11T00:00:00.000Z', status: 'active' });
  await db.collection('submissions').doc('PFA-CG-2026-00042').set({ kind: 'PFA-CG', status: 'rejected', fields: { name: 'Closed One', email: 'c@example.com' } });
  const asked = await run(CARDS, request({ body: { action: 'ask-photo', kind: 'caregiver', refs: [REF, 'PFA-CG-2026-00042'] } }));
  assert.deepEqual(asked.body.results.map((x) => x.ok), [true, false], 'each answered; a closed application is not asked');
  const sent = await run(PHOTO, request({ body: { t: tokenOf(db), action: 'send', consent: true, photo: PHOTO_OK } }));
  assert.equal(sent.statusCode, 200, JSON.stringify(sent.body));
  const dump = db.dump();
  const kept = Object.keys(dump).filter((k) => k.startsWith(`submissions/${REF}/attachments/before-`));
  assert.equal(kept.length, 1, 'the first photograph kept, never overwritten');
  assert.equal(dump[kept[0]].label, 'First photograph');
  assert.equal(dump[`submissions/${REF}`].attachments, 2);
  const on = await DC.statusOf(db, 'caregiver', 'PFA-CCT-AB2CD3EF');
  assert.ok(on && on.standing === 'valid', 'the card is online with the photograph');
  assert.ok(dump['digitalCards/PFA-CCT-AB2CD3EF'].photo, 'its photograph');
});

test('the panel asks for a photograph: for each card and for all at once, and in caregivers\' To do', () => {
  const cc = read('assets/admin-cardcheck.js');
  assert.match(cc, /data-ccx="ask">Ask for a photograph<\/button>/);
  assert.match(cc, /data-ccx="ask-all">Ask ' \+ asks\.length \+ ' without a photograph for one<\/button>/);
  assert.match(cc, /body: \{ action: 'ask-photo', kind: K\[S\.kind\]\.api, refs: list\.map\(askRef\) \}/);
  const html = read('admin.html');
  assert.match(html, /data-ap="ask">Ask for a photograph<\/button>/);
  assert.match(read('member-photo.html'), /p\.kind === 'caregiver'/, 'the same page, the card named');
  const mail = require('../lib/caregiver-mail');
  for (const t of ['caregiver_photo_request', 'caregiver_photo_received']) {
    const out = mail.render ? mail.render(t, { name: 'trisha dey', reference: REF, uploadUrl: 'https://x.test/member-photo.html#t=abc', expiresAt: '2026-12-01T00:00:00.000Z', receivedAt: '2026-11-17T00:00:00.000Z', siteUrl: 'https://x.test' }) : null;
    if (out) { assert.ok(out.subject && out.html && out.text, t); assert.doesNotMatch(out.subject + out.text, /[–—]/, 'no long dashes'); }
  }
});
