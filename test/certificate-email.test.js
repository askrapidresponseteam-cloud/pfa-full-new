'use strict';

/* The internship certificate, emailed, and checkable by anyone (owner,
   2 Nov 2026: "once course is completed - admin should be able to issue the
   cert digitally which can be sent to the person completing it over email
   and there should be a publicy verifiable link that it is a genuine
   certificate"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const fileStore = require('../lib/file-store');
const mail = require('../lib/caregiver-mail');
const audit = require('../lib/admin-audit');
const ROUTE = require('../lib/routes/admin/certificates');
const VERIFY = require('../lib/routes/verify-certificate');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.parse('2026-12-28T06:00:00.000Z');
/* a small, real PDF: what the panel sends is an A4 page with the certificate */
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(4000, 0x20), Buffer.from('\n%%EOF\n')]);

let db; let sent; let logged; let realRecord;
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_MAIL_API_KEY', 'PFA_PUBLIC_SITE_URL', 'PUBLIC_SITE_URL'];
const saved = {};
test.beforeEach(() => {
  db = memoryFirestore();
  firebase._setDbForTests(db);
  fileStore._setBucket(async () => null);
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.PFA_SMTP_USER = 'info@peopleforanimalsindia.org';
  process.env.PFA_SMTP_PASS = 'secret';
  sent = []; logged = [];
  mail._setSmtpTransport(() => ({ sendMail: async (m) => { sent.push(m); return { messageId: m.messageId }; } }));
  realRecord = audit.record;
  audit.record = async (who, row) => { logged.push(row); };
});
test.afterEach(() => {
  firebase._setDbForTests(null);
  fileStore._setBucket(null);
  mail._setSmtpTransport(null);
  audit.record = realRecord;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function call(handler, method, { body, query } = {}) {
  return new Promise((resolve, reject) => {
    const out = { status: 200, headers: {} };
    const response = { get statusCode() { return out.status; }, set statusCode(v) { out.status = v; }, setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      end(raw) { out.json = JSON.parse(String(raw || '{}')); resolve(out); } };
    Promise.resolve(handler({ method, url: '/api/x', query: query || {}, body, headers: {} }, response)).catch(reject);
  });
}
const admin = (body) => call(ROUTE.createHandler({ getDb: () => db, requireAdmin: async () => ({ uid: 'u1', email: 'office@pfa.test', name: 'Office', role: 'super' }), now: () => NOW }), body ? 'POST' : 'GET', { body });
const verify = (n) => call(VERIFY.createHandler({ getDb: () => db }), 'GET', { query: { n } });

async function issued(extra) {
  const r = await admin(Object.assign({ action: 'issue', name: 'asha rao', startDate: '2026-11-02', endDate: '2026-12-27', issuedOn: '2026-12-28', email: 'Asha@Example.com' }, extra || {}));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.certificate;
}

test('issuing can carry the email it goes to; a wrong one is said', async () => {
  const c = await issued();
  assert.equal(c.email, 'asha@example.com');
  assert.equal(c.verifyUrl, `https://peopleforanimalsindia.org/verify-certificate?n=${c.number}`);
  const bad = await admin({ action: 'issue', name: 'Ravi Kumar', startDate: '2026-11-02', endDate: '2026-12-27', issuedOn: '2026-12-28', email: 'ravi@' });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.field, 'email');
  const none = await admin({ action: 'issue', name: 'Ravi Kumar', startDate: '2026-11-02', endDate: '2026-12-27', issuedOn: '2026-12-28' });
  assert.equal(none.status, 200, 'the email is not needed to issue');
});

test('the email is previewed, then sent exactly as previewed, with the PDF and the public check', async () => {
  const c = await issued();
  const pre = await admin({ action: 'preview', number: c.number });
  assert.equal(pre.status, 200);
  assert.equal(sent.length, 0, 'a preview sends nothing');
  assert.equal(pre.json.to, 'asha@example.com');
  assert.equal(pre.json.subject, `Your PFA internship certificate - ${c.number}`);
  for (const bit of ['Your certificate.', 'from 2 November 2026 to 27 December 2026', c.number, 'attached as a PDF, and it is online', 'See your certificate', `https://peopleforanimalsindia.org/certificate?n=${c.number}`]) assert.ok(pre.json.html.includes(bit), bit);
  /* without the preview's token, or with a different address than previewed */
  assert.equal((await admin({ action: 'email', number: c.number, token: 'made-up', pdf: PDF.toString('base64') })).status, 409);
  assert.equal((await admin({ action: 'email', number: c.number, email: 'other@example.com', token: pre.json.token, pdf: PDF.toString('base64') })).status, 409);
  /* not a PDF */
  assert.equal((await admin({ action: 'email', number: c.number, token: pre.json.token, pdf: Buffer.from('hello there, not a pdf at all '.repeat(60)).toString('base64') })).status, 422);
  const go = await admin({ action: 'email', number: c.number, token: pre.json.token, pdf: PDF.toString('base64') });
  assert.equal(go.status, 200, JSON.stringify(go.json));
  assert.equal(go.json.state, 'sent');
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.to, 'asha@example.com');
  assert.equal(m.subject, `Your PFA internship certificate - ${c.number}`);
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].filename, `PFA-internship-certificate-${c.number}.pdf`);
  assert.equal(m.attachments[0].contentType, 'application/pdf');
  assert.ok(m.attachments[0].content.equals(PDF), 'the PDF exactly as the panel made it');
  assert.match(m.text, new RegExp(`See it, download it and share it: https://peopleforanimalsindia\\.org/certificate\\?n=${c.number}`));
  const kept = db.dump()[`certificates/${c.number}`];
  assert.equal(kept.pdf.size, PDF.length, 'the PDF is kept with the certificate');
  assert.deepEqual(kept.sends.map((x) => [x.to, x.state, x.by]), [['asha@example.com', 'sent', 'office@pfa.test']]);
  assert.ok(logged.some((x) => x.action === 'certificate-emailed' && x.subject === c.number));
  /* the list says it went */
  const list = await admin();
  assert.equal(list.json.certificates[0].sent.to, 'asha@example.com');
  /* the same preview sent twice is one email */
  await admin({ action: 'email', number: c.number, token: pre.json.token, pdf: PDF.toString('base64') });
  assert.equal(sent.length, 1);
});

test('a withdrawn certificate is never sent', async () => {
  const c = await issued();
  await admin({ action: 'revoke', number: c.number, reason: 'Issued in error' });
  const pre = await admin({ action: 'preview', number: c.number });
  assert.equal(pre.status, 409);
  assert.match(pre.json.message, /withdrawn certificate is not sent/);
});

test('the public check: genuine, withdrawn, or not issued; never the email', async () => {
  const c = await issued();
  const ok = await verify(c.number.toLowerCase());
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { found: true, genuine: true, number: c.number, kind: 'Internship', name: 'Asha Rao', startDate: '2026-11-02', endDate: '2026-12-27', issuedOn: '2026-12-28', withdrawn: false, withdrawnOn: '' });
  assert.doesNotMatch(JSON.stringify(ok.json), /example\.com|office@/, 'no email, no one at PFA');
  await admin({ action: 'revoke', number: c.number, reason: 'Issued in error' });
  const gone = await verify(c.number);
  assert.deepEqual([gone.json.genuine, gone.json.withdrawn, gone.json.withdrawnOn], [false, true, '2026-12-28']);
  assert.doesNotMatch(JSON.stringify(gone.json), /Issued in error/, 'the reason stays inside PFA');
  assert.equal((await verify('PFA-INT-ABCDEFGH')).status, 404);
  assert.equal((await verify('PFA-CCT-ABCDEFGH')).status, 400);
  assert.equal((await verify('')).status, 400);
});

test('wired: the route, the page, the panel and the Firebase panel', () => {
  const api = read('api/index.js');
  assert.match(api, /'verify-certificate': '\.\/verify-certificate\.js'/);
  assert.match(api, /'verify-certificate': \(\) => require\('\.\.\/lib\/routes\/verify-certificate\.js'\)/);
  const page = read('verify-certificate.html');
  assert.match(page, /<title>Check a certificate \| People for Animals<\/title>/);
  assert.match(page, /fetch\('\/api\/verify-certificate\?n=' \+ encodeURIComponent\(n\)/);
  assert.match(page, /new URLSearchParams\(window\.location\.search\)\)\.get\('n'\)/, 'the emailed link fills the number in and checks it');
  const panel = read('admin.html');
  assert.match(panel, /<input id="ctEmail" type="email"/);
  assert.match(panel, /data-ct-mail="' \+ esc\(c\.number\) \+ '">Email it</);
  assert.match(panel, /<script src="assets\/admin-certificates\.js"><\/script>/);
  const js = read('assets/admin-certificates.js');
  assert.match(js, /action: 'preview', number: state\.cert\.number, email: to/);
  assert.match(js, /C\.pdf\(\{[^}]+\}\)\.then\(base64\)/, 'at print quality, the default');
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-certificates\.js'/);
});

test('certificate links are always the public site, never the panel\'s Firebase address (owner, 12 Nov 2026: "we cant expose the firebase admin site url to people")', async () => {
  /* on Firebase, PUBLIC_SITE_URL is the panel's own address (functions/index.js) */
  process.env.PUBLIC_SITE_URL = 'https://pfa-new-website.web.app';
  let c = await issued();
  assert.equal(c.certificateUrl, `https://peopleforanimalsindia.org/certificate?n=${c.number}`);
  assert.equal(c.verifyUrl, `https://peopleforanimalsindia.org/verify-certificate?n=${c.number}`);
  const pre = await admin({ action: 'preview', number: c.number, email: 'asha@example.com' });
  assert.equal(pre.status, 200, JSON.stringify(pre.json));
  assert.doesNotMatch(pre.json.html, /web\.app|firebaseapp/, 'nothing of Firebase in the email');
  assert.match(pre.json.html, /https:\/\/peopleforanimalsindia\.org\/certificate\?n=/);
  /* even named as the public site by mistake, a Firebase host is refused */
  for (const bad of ['https://pfa-new-website.web.app', 'https://pfa-new-website.firebaseapp.com/', 'not a url']) {
    process.env.PFA_PUBLIC_SITE_URL = bad;
    assert.equal(require('../lib/intern-certificate').siteUrl(), 'https://peopleforanimalsindia.org', bad);
  }
  process.env.PFA_PUBLIC_SITE_URL = 'https://www.peopleforanimalsindia.org/';
  assert.equal(require('../lib/intern-certificate').siteUrl(), 'https://www.peopleforanimalsindia.org');
  c = (await admin()).json;
  assert.ok(JSON.stringify(c).indexOf('web.app') === -1, 'nor in the panel\'s list');
  /* links already sent with the Firebase address go on to the public site */
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firebase.json'), 'utf8'));
  const host = Array.isArray(cfg.hosting) ? cfg.hosting[0] : cfg.hosting;
  for (const src of ['/certificate', '/certificate.html', '/verify-certificate', '/verify-certificate.html']) {
    const r = host.redirects.find((x) => x.source === src);
    assert.ok(r, src);
    assert.match(r.destination, /^https:\/\/peopleforanimalsindia\.org\/(verify-)?certificate$/);
    assert.equal(r.type, 301);
  }
});

test('the emailed PDF is print quality: a 2 MB certificate goes, attached exactly; past 10 MB, or with nowhere to keep it, it does not (owner, 12 Nov 2026: "can you make it super high/highest quality")', async () => {
  /* a working Storage bucket */
  const files = new Map();
  const bucket = { file: (p) => ({ async save(b) { files.set(p, Buffer.from(b)); }, async download() { return [files.get(p)]; } }) };
  fileStore._setBucket(() => ({ bucket, name: 'pfa-test-bucket' }));
  const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2 * 1024 * 1024, 0x20), Buffer.from('\n%%EOF\n')]);
  let c = await issued();
  let pre = await admin({ action: 'preview', number: c.number });
  const go = await admin({ action: 'email', number: c.number, token: pre.json.token, pdf: big.toString('base64') });
  assert.equal(go.status, 200, JSON.stringify(go.json));
  assert.equal(sent.length, 1);
  assert.ok(sent[0].attachments[0].content.equals(big), 'the 2 MB PDF, exactly as the panel made it');
  assert.equal(files.get(`certificates/${c.number}.pdf`).length, big.length, 'kept in Storage, not in the record');
  assert.equal(db.dump()[`certificates/${c.number}`].pdf.bytes, undefined);
  /* past the ceiling */
  const huge = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024 + 10, 0x20)]);
  assert.equal((await admin({ action: 'email', number: c.number, token: pre.json.token, pdf: huge.toString('base64') })).status, 413);
  /* Storage not there: a print-quality PDF cannot sit in a record, so nothing is sent and it says why */
  fileStore._setBucket(async () => null);
  sent = [];
  c = await issued({ name: 'Ravi Kumar', email: 'ravi@example.com' });
  pre = await admin({ action: 'preview', number: c.number });
  const held = await admin({ action: 'email', number: c.number, token: pre.json.token, pdf: big.toString('base64') });
  assert.equal(held.status, 503);
  assert.match(held.json.message, /could not be stored just now/);
  assert.equal(sent.length, 0);
});

test('the PDF is drawn on the 6x print masters and carried losslessly', () => {
  const js = read('assets/certificate.js');
  assert.match(js, /var ART_PRINT = ROOT \+ 'assets\/certificates\/completion-print\.png';/);
  assert.match(js, /var SIG_PRINT = ROOT \+ 'assets\/certificates\/signature-print\.png';/);
  assert.match(js, /var PRINT_SCALE = 6;/);
  assert.match(js, /new root\.CompressionStream\('deflate'\)/, 'lossless');
  assert.match(js, /\/Filter \/' \+ image\.filter/);
  assert.doesNotMatch(read('assets/admin-certificates.js'), /quality: 0\.\d+/, 'the emailed copy is not made smaller or lossy');
  assert.match(read('certificate.html'), /C\.pdf\(record\)/);
  for (const [f, w, h] of [['completion-print.png', 6720, 4752], ['signature-print.png', 1512, 438]]) {
    const png = fs.readFileSync(path.join(__dirname, '..', 'assets', 'certificates', f));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [w, h], f);
    assert.match(read('scripts/build-firebase.js'), new RegExp(`'assets/certificates/${f.replace('.', '\\.')}'`), `${f} goes with the panel`);
  }
});
