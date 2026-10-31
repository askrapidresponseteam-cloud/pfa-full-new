'use strict';

/* Internship certificates made in the panel (owner, 31 Oct 2026: "this
   certificate should be admin generatable"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const audit = require('../lib/admin-audit');
const M = require('../lib/admin-modules');
const ROUTE = require('../lib/routes/admin/certificates');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.parse('2026-10-31T09:00:00.000Z');

let db; let auditRows; let realRecord;
test.beforeEach(() => {
  db = memoryFirestore();
  auditRows = [];
  realRecord = audit.record;
  audit.record = async (who, row) => { auditRows.push(row); };
});
test.afterEach(() => { audit.record = realRecord; });

function call(method, { body, numbers } = {}) {
  const queue = (numbers || []).slice();
  const handler = ROUTE.createHandler({
    getDb: () => db,
    requireAdmin: async () => ({ uid: 'u1', email: 'office@pfa.test', name: 'Office', role: 'super' }),
    now: () => NOW,
    makeNumber: queue.length ? () => queue.shift() || ROUTE._private.newNumber() : undefined
  });
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200 };
    const response = { get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; }, setHeader() {},
      end(raw) { out.json = JSON.parse(String(raw || '{}')); resolve(out); } };
    Promise.resolve(handler({ method, url: '/api/admin/certificates', query: {}, body, headers: {} }, response)).catch(reject);
  });
}

const GOOD = { action: 'issue', name: 'asha rao', startDate: '2026-11-01', endDate: '2026-12-26', issuedOn: '2026-12-28' };

test('issuing gives a random PFA-INT number, keeps the record and logs it', async () => {
  const out = await call('POST', { body: GOOD });
  assert.equal(out.statusCode, 200, JSON.stringify(out.json));
  const c = out.json.certificate;
  assert.match(c.number, /^PFA-INT-[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(c.name, 'Asha Rao', 'the name is written properly');
  assert.deepEqual([c.startDate, c.endDate, c.issuedOn], ['2026-11-01', '2026-12-26', '2026-12-28']);
  const kept = db.dump()[`certificates/${c.number}`];
  assert.equal(kept.name, 'Asha Rao');
  assert.equal(kept.issuedBy.email, 'office@pfa.test');
  assert.equal(auditRows[0].action, 'certificate-issued');
  const list = await call('GET');
  assert.equal(list.json.certificates.length, 1);
  assert.equal(list.json.today, '2026-10-31');
});

test('two numbers are never the same: a number already given is drawn again', async () => {
  const first = await call('POST', { body: GOOD, numbers: ['PFA-INT-ABCDEFGH'] });
  assert.equal(first.json.certificate.number, 'PFA-INT-ABCDEFGH');
  const second = await call('POST', { body: Object.assign({}, GOOD, { name: 'Ravi Kumar' }), numbers: ['PFA-INT-ABCDEFGH', 'PFA-INT-HGFEDCBA'] });
  assert.equal(second.json.certificate.number, 'PFA-INT-HGFEDCBA');
  assert.equal(db.dump()['certificates/PFA-INT-ABCDEFGH'].name, 'Asha Rao', 'the first is untouched');
  const numbers = new Set(Array.from({ length: 500 }, () => ROUTE._private.newNumber()));
  assert.equal(numbers.size, 500);
});

test('the name and dates are checked, each on its own field', async () => {
  for (const [patch, field, said] of [
    [{ name: '' }, 'name', /name/],
    [{ startDate: '2026-02-30' }, 'startDate', /began/],
    [{ endDate: '' }, 'endDate', /ended/],
    [{ endDate: '2026-10-01' }, 'endDate', /cannot end before it began/],
    [{ issuedOn: '2026-12-01' }, 'issuedOn', /on or after the last day/],
    [{ name: 'A'.repeat(60) }, 'name', /./]
  ]) {
    const out = await call('POST', { body: Object.assign({}, GOOD, patch) });
    assert.equal(out.statusCode, 422, JSON.stringify(patch));
    assert.equal(out.json.field, field);
    assert.match(out.json.message, said);
  }
  assert.equal(Object.keys(db.dump()).filter((k) => k.startsWith('certificates/')).length, 0, 'nothing kept');
  const today = await call('POST', { body: Object.assign({}, GOOD, { endDate: '2026-10-30', startDate: '2026-09-01', issuedOn: '' }) });
  assert.equal(today.json.certificate.issuedOn, '2026-10-31', 'issued today, India time, when not said');
});

test('a certificate can be withdrawn with a reason, once, and stays on record', async () => {
  const c = (await call('POST', { body: GOOD })).json.certificate;
  assert.equal((await call('POST', { body: { action: 'revoke', number: c.number, reason: '' } })).statusCode, 422);
  const out = await call('POST', { body: { action: 'revoke', number: c.number, reason: 'Issued with the wrong dates' } });
  assert.equal(out.statusCode, 200);
  assert.equal(out.json.certificate.revoked, true);
  assert.equal(out.json.certificate.revokedReason, 'Issued with the wrong dates');
  assert.equal((await call('POST', { body: { action: 'revoke', number: c.number, reason: 'again please' } })).statusCode, 409);
  assert.equal(db.dump()[`certificates/${c.number}`].name, 'Asha Rao', 'kept, not deleted');
  assert.ok(auditRows.some((r) => r.action === 'certificate-revoked'));
});

test('wired: a module of its own, a route, closed to the browser, shipped with the panel', () => {
  assert.ok(M.MODULE_KEYS.includes('certificates'));
  assert.match(read('lib/routes/admin/certificates.js'), /const who = await requireAdmin\(request, response, MODULE\);/);
  assert.match(read('api/index.js'), /'admin\/certificates': \(\) => require\('\.\.\/lib\/routes\/admin\/certificates\.js'\)/);
  assert.match(read('firestore.rules'), /match \/certificates\/\{id\}\s+\{ allow read, write: if false; \}/);
  const build = read('scripts/build-firebase.js');
  assert.ok(build.includes("'assets/certificate.js'") && build.includes("'assets/certificates/internship.webp'"));
  assert.ok(fs.statSync(path.join(ROOT, 'assets', 'certificates', 'internship.webp')).size > 100000, 'the artwork is there');
});

test('the panel: a Certificates section that draws, issues, downloads and withdraws', () => {
  const html = read('admin.html');
  assert.match(html, /<button class="tab" type="button" data-tab="certificates">Certificates<\/button>/);
  assert.match(html, /<script src="assets\/certificate\.js"><\/script>/);
  assert.match(html, /certificates: \{ title: 'Internship certificates', module: 'certificates', needs: 'certificates' \}/);
  for (const bit of ["data-ct=\"issue\"", "data-ct=\"pdf\"", "data-ct=\"png\"", "data-ct=\"withdraw\"", 'id="ctCanvas"', "api('/api/admin/certificates'"]) assert.ok(html.includes(bit), bit);
  const js = read('assets/certificate.js');
  for (const name of ['load', 'draw', 'png', 'pdf', 'save', 'fileStem', 'longDate']) assert.match(js, new RegExp(`\\b${name}: ${name}\\b`));
  assert.ok(!/[–—]/.test(js + read('lib/routes/admin/certificates.js')), 'no dashes');
});
