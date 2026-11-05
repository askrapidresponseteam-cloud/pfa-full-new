'use strict';

/* The two registers in the office's Google Sheet (owner, 5 Nov 2026: "can
   membership, catc be written here [the sheet] user data should be
   protected. locked so that one doesnt accidentally mess with it?", "1 tab
   for members 1 for catc", "only courier details and date of shipping
   should be editable. the whole details and address of the user should be
   captured in the sheet", "enterprise grade"). Driven against a stand-in
   for the Google Sheets API that answers the way Google does: trailing
   empty cells and rows left out, a typed number kept a number. */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const SHEET = require('../lib/register-sheet');
const ROUTE = require('../lib/routes/admin/registers');
const audit = require('../lib/admin-audit');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ID = 'TESTSHEET_abcdefghijklmnopqrstuvwxyz';
const SA = 'pfa-site@pfa-new-website.iam.gserviceaccount.com';
const NOW = Date.parse('2026-11-05T10:00:00.000Z');
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

let logged;
let realRecord;
test.beforeEach(() => {
  realRecord = audit.record; logged = [];
  audit.record = async (who, entry) => { logged.push(Object.assign({ who: who && who.email }, entry)); };
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'pfa-new-website', client_email: SA, private_key: privateKey });
  process.env.PFA_REGISTER_SHEET_ID = ID;
  SHEET._test.resetToken();
});
test.afterEach(() => {
  audit.record = realRecord;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.PFA_REGISTER_SHEET_ID;
});

/* ---- a stand-in Google ---------------------------------------------------- */

function google(options) {
  const o = options || {};
  const g = {
    locale: 'en_US', timeZone: 'America/Los_Angeles', nextId: 1, calls: [], writes: 0, shapes: [],
    sheets: [{ properties: { sheetId: 0, title: 'Sheet1', index: 0, gridProperties: { rowCount: 1000, columnCount: 26 } }, protectedRanges: [], values: [] }],
    deny: o.deny || null
  };
  const tab = (title) => g.sheets.find((s) => s.properties.title === title);
  const titleOf = (range) => { const m = /^'((?:[^']|'')+)'/.exec(decodeURIComponent(range)); return m ? m[1].replace(/''/g, "'") : decodeURIComponent(range).split('!')[0]; };
  const startRow = (range) => { const m = /!([A-Z]+)(\d+)/.exec(decodeURIComponent(range)); return m ? Number(m[2]) - 1 : 0; };
  const trimmed = (values) => {
    const rows = values.map((r) => { const x = (r || []).slice(); while (x.length && (x[x.length - 1] === '' || x[x.length - 1] == null)) x.pop(); return x; });
    while (rows.length && !rows[rows.length - 1].length) rows.pop();
    return rows;
  };
  const answer = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  g.tab = tab;
  g.fetch = async (url, init) => {
    const method = (init && init.method) || 'GET';
    g.calls.push(`${method} ${url}`);
    if (url === 'https://oauth2.googleapis.com/token') {
      const assertion = /assertion=([^&]+)/.exec(init.body)[1];
      const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString());
      assert.equal(claims.iss, SA);
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/spreadsheets');
      return answer(200, { access_token: 'tok', expires_in: 3600 });
    }
    assert.ok(url.startsWith(`https://sheets.googleapis.com/v4/spreadsheets/${ID}`), url);
    assert.equal(init.headers.Authorization, 'Bearer tok');
    if (g.deny) return answer(g.deny.status, { error: { code: g.deny.status, message: g.deny.message, status: 'PERMISSION_DENIED' } });
    const rest = url.slice(`https://sheets.googleapis.com/v4/spreadsheets/${ID}`.length);
    const body = init && init.body ? JSON.parse(init.body) : null;
    if (method === 'GET' && rest.startsWith('?fields=')) {
      return answer(200, { properties: { title: 'PFA', locale: g.locale, timeZone: g.timeZone }, sheets: g.sheets.map((s) => ({ properties: JSON.parse(JSON.stringify(s.properties)), protectedRanges: JSON.parse(JSON.stringify(s.protectedRanges)) })) });
    }
    if (method === 'GET' && rest.startsWith('/values:batchGet?')) {
      const ranges = [...rest.matchAll(/ranges=([^&]+)/g)].map((m) => m[1]);
      return answer(200, { valueRanges: ranges.map((r) => ({ range: decodeURIComponent(r), values: trimmed((tab(titleOf(r)) || { values: [] }).values) })) });
    }
    if (method === 'GET' && rest.startsWith('/values/')) {
      const r = rest.slice('/values/'.length);
      return answer(200, { values: trimmed((tab(titleOf(r)) || { values: [] }).values) });
    }
    if (method === 'POST' && rest === ':batchUpdate') {
      g.shapes.push(body.requests);
      for (const q of body.requests) {
        if (q.updateSpreadsheetProperties) { g.locale = q.updateSpreadsheetProperties.properties.locale; g.timeZone = q.updateSpreadsheetProperties.properties.timeZone; }
        if (q.addSheet) g.sheets.push({ properties: Object.assign({ sheetId: 100 + g.nextId++ }, q.addSheet.properties), protectedRanges: [], values: [] });
        if (q.deleteSheet) g.sheets = g.sheets.filter((s) => s.properties.sheetId !== q.deleteSheet.sheetId);
        if (q.addProtectedRange) {
          const p = q.addProtectedRange.protectedRange;
          g.sheets.find((s) => s.properties.sheetId === p.range.sheetId).protectedRanges.push(Object.assign({ protectedRangeId: g.nextId++ }, JSON.parse(JSON.stringify(p))));
        }
        if (q.appendDimension && q.appendDimension.dimension === 'ROWS') g.sheets.find((s) => s.properties.sheetId === q.appendDimension.sheetId).properties.gridProperties.rowCount += q.appendDimension.length;
      }
      return answer(200, { replies: [] });
    }
    if (method === 'POST' && rest === '/values:batchUpdate') {
      assert.equal(body.valueInputOption, 'RAW');
      g.writes += 1;
      for (const d of body.data) {
        const t = tab(titleOf(d.range));
        const at = startRow(d.range);
        d.values.forEach((row, i) => { t.values[at + i] = row.slice(); });
      }
      return answer(200, {});
    }
    if (method === 'POST' && rest === '/values:batchClear') {
      for (const r of body.ranges) { const t = tab(titleOf(r)); t.values.length = Math.min(t.values.length, startRow(r)); }
      return answer(200, {});
    }
    return answer(400, { error: { message: `not in the stand-in: ${method} ${rest}` } });
  };
  /* a person typing in the sheet: a row by its first cell, a column by its heading */
  g.type = (title, id, heading, value) => {
    const t = tab(title);
    const col = t.values[0].indexOf(heading);
    const row = t.values.findIndex((r) => r[0] === id);
    assert.ok(col >= 0 && row > 0, `${heading} / ${id}`);
    t.values[row][col] = value;
  };
  g.cell = (title, id, heading) => { const t = tab(title); return t.values.find((r) => r[0] === id)[t.values[0].indexOf(heading)]; };
  return g;
}

function seed(db) {
  db.collection('submissions').doc('PFA-CG-2026-00011').set({ kind: 'PFA-CG', status: 'approved', createdAt: '2026-10-28T05:00:00.000Z', receivedAtMs: Date.parse('2026-10-28T05:00:00.000Z'),
    payment: { orderId: 'ORD-CG-1', amount: 300, bankReference: 'BANK-777' },
    fields: { name: 'Manasa P', mobile: '9003565638', altMobile: '9876500000', email: 'manasa@example.com', address: '2H, Touchstone Apartments, Annamalai Avenue 1st Main Road, Mogappair West', floor: '2nd Floor', colony: 'Mogappair', city: 'Chennai', district: 'Chennai', state: 'Tamil Nadu', pin: '600037', notes: 'About 12 animals.' } });
  db.collection('caretakerCards').doc('PFA-CCT-2B6N4XKE').set({ name: 'Manasa P', issuedAt: '2026-10-30T05:00:00.000Z', applicationRef: 'PFA-CG-2026-00011' });
  db.collection('submissions').doc('PFA-CG-2026-00012').set({ kind: 'PFA-CG', status: 'new', createdAt: '2026-10-29T05:00:00.000Z', receivedAtMs: Date.parse('2026-10-29T05:00:00.000Z'),
    fields: { name: 'trisha dey', mobile: '9883909733', email: 'trisha@example.com', address: 'Vill. Dhanicha, Near Swami Vivekananda School', city: 'Dhanicha', district: 'Nadia', state: 'West Bengal', pin: '741222' } });
  db.collection('submissions').doc('PFA-CG-2026-00013').set({ kind: 'PFA-CG', status: 'rejected', createdAt: '2026-10-29T06:00:00.000Z', receivedAtMs: Date.parse('2026-10-29T06:00:00.000Z'), fields: { name: 'Turned Down' } });
  db.collection('submissions').doc('PFA-MEM-2026-00031').set({ kind: 'PFA-MEM', status: 'new', createdAt: '2026-10-28T05:00:00.000Z', receivedAtMs: Date.parse('2026-10-28T05:00:00.000Z'),
    fields: { name: 'sanchita banerjee', mobile: '9831563126', email: 'Sanchita.BMI@gmail.com', tier: 'Golden membership', kit: 'Card, badge', amount: 2500, orderId: 'ORD-MEM-1', bankReference: 'BANK-888',
      address: 'Flat 22/CL, Sanjeeva Town Duplex Estate, Thakdari Main Road, Newtown', floor: '3rd Floor', city: 'Kolkata', district: 'North 24 Parganas', state: 'West Bengal', pin: '700156' } });
}

const run = (db, g, extra) => SHEET.sync(db, Object.assign({ fetch: g.fetch, now: () => NOW, backoffMs: 0 }, extra || {}));
const valuesText = (g) => JSON.stringify(g.sheets.map((s) => s.values));

/* ---- dates ------------------------------------------------------------- */

test('dates: what the office types, read the Indian way, and the sheet\'s own day numbers', () => {
  const { dateOf, serialOf } = SHEET._test;
  assert.equal(dateOf('05/11/2026'), '2026-11-05');
  assert.equal(dateOf('5-11-26'), '2026-11-05');
  assert.equal(dateOf('5 Nov 2026'), '2026-11-05');
  assert.equal(dateOf('November 5, 2026'), '2026-11-05');
  assert.equal(dateOf('2026-11-05'), '2026-11-05');
  assert.equal(dateOf(serialOf('2026-11-05')), '2026-11-05');
  assert.equal(serialOf('2026-11-05'), 46331);
  assert.equal(dateOf(''), '');
  assert.equal(dateOf('31/02/2026'), null);
  assert.equal(dateOf('next week'), null);
});

/* ---- the first run ------------------------------------------------------- */

test('first run: a CATC tab and a Members tab, every detail and the full address, no money, the empty Sheet1 gone', async () => {
  const db = memoryFirestore(); seed(db);
  const g = google();
  const ran = await run(db, g);
  assert.equal(ran.ok, true, ran.message);
  assert.equal(ran.wrote, true);
  assert.deepEqual(g.sheets.map((s) => s.properties.title), ['CATC', 'Members']);
  assert.equal(g.locale, 'en_IN');
  assert.equal(g.timeZone, 'Asia/Kolkata');

  const catc = g.tab('CATC').values;
  assert.deepEqual(catc[0], SHEET.LAYOUT.caregiver.cols.map((c) => c[0]));
  assert.deepEqual(catc.slice(1).map((r) => r[0]), ['PFA-CG-2026-00011', 'PFA-CG-2026-00012'], 'paid applications only, a turned-down one left out');
  const manasa = Object.fromEntries(catc[0].map((h, i) => [h, catc[1][i]]));
  assert.equal(manasa.Name, 'Manasa P');
  assert.equal(manasa['Phone number'], '9003565638');
  assert.equal(manasa['Other phone'], '9876500000');
  assert.equal(manasa.Email, 'manasa@example.com');
  assert.match(manasa['Full address'], /Touchstone Apartments[\s\S]*Tamil Nadu - 600037/);
  assert.equal(manasa.Floor, '2nd Floor');
  assert.equal(manasa.Colony, 'Mogappair');
  assert.equal(manasa['PIN code'], '600037');
  assert.equal(manasa['About the colony'], 'About 12 animals.');
  assert.equal(manasa['Application status'], 'Card issued');
  assert.equal(manasa['Card number'], 'PFA-CCT-2B6N4XKE');
  assert.equal(manasa['Issued on'], '30/10/2026');

  const mem = g.tab('Members').values;
  const s = Object.fromEntries(mem[0].map((h, i) => [h, mem[1][i]]));
  assert.equal(s['Membership type'], 'Golden membership');
  assert.equal(s['Welcome kit'], 'Card, badge');
  assert.equal(s.Floor, '3rd Floor');

  /* money records go only to the two finance addresses */
  const all = valuesText(g);
  for (const money of ['2500', '300', 'ORD-CG-1', 'ORD-MEM-1', 'BANK-777', 'BANK-888', 'Amount', 'INR']) assert.ok(!all.includes(money), money);

  /* locked, all but the yellow cells under their headings */
  for (const title of ['CATC', 'Members']) {
    const t = g.tab(title);
    const p = t.protectedRanges.filter((x) => x.description === SHEET.PROTECTION);
    assert.equal(p.length, 1, title);
    assert.equal(p[0].warningOnly, false);
    assert.deepEqual(p[0].editors.users, [SA]);
    const heads = t.values[0];
    assert.deepEqual(p[0].unprotectedRanges, [{ sheetId: t.properties.sheetId, startRowIndex: 1, startColumnIndex: heads.indexOf('Courier'), endColumnIndex: heads.indexOf('Shipped on') + 1 }]);
    assert.equal(heads.indexOf('Tracking number'), heads.indexOf('Courier') + 1);
  }
  /* the date column: dd/mm/yyyy, and only a real date may be typed */
  const reqs = g.shapes.flat();
  assert.ok(reqs.some((q) => q.repeatCell && q.repeatCell.cell.userEnteredFormat.numberFormat && q.repeatCell.cell.userEnteredFormat.numberFormat.pattern === 'dd/mm/yyyy'));
  assert.ok(reqs.some((q) => q.setDataValidation && q.setDataValidation.rule.condition.type === 'DATE_IS_VALID' && q.setDataValidation.rule.strict === true));
  assert.ok(reqs.some((q) => q.repeatCell && q.repeatCell.cell.userEnteredFormat.numberFormat && q.repeatCell.cell.userEnteredFormat.numberFormat.type === 'TEXT'), 'a tracking number keeps its zeros');
});

test('a sheet that already holds something of the office\'s keeps it', async () => {
  const db = memoryFirestore(); seed(db);
  const g = google();
  g.sheets[0].values = [['Old notes']];
  const ran = await run(db, g);
  assert.equal(ran.ok, true);
  assert.deepEqual(g.sheets.map((s) => s.properties.title).sort(), ['CATC', 'Members', 'Sheet1']);
  assert.deepEqual(g.tab('Sheet1').values, [['Old notes']]);
});

/* ---- the yellow columns into the panel ------------------------------------ */

test('courier, tracking number and date typed in the sheet: the card is shipped in the panel, logged as the Google Sheet', async () => {
  const db = memoryFirestore(); seed(db);
  const g = google();
  await run(db, g);
  g.type('CATC', 'PFA-CG-2026-00011', 'Courier', 'DTDC');
  g.type('CATC', 'PFA-CG-2026-00011', 'Tracking number', 'd 1234 5678');
  g.type('CATC', 'PFA-CG-2026-00011', 'Shipped on', SHEET._test.serialOf('2026-11-04'));
  const ran = await run(db, g);
  assert.equal(ran.ok, true, ran.message);
  assert.deepEqual(ran.applied, [{ kind: 'caregiver', id: 'PFA-CG-2026-00011', status: 'shipped' }]);
  const d = (await db.collection('submissions').doc('PFA-CG-2026-00011').get()).data();
  assert.equal(d.shipment.status, 'shipped');
  assert.equal(d.shipment.courier, 'DTDC');
  assert.equal(d.shipment.trackingNumber, 'D12345678');
  assert.equal(d.shipment.shippedOn, '2026-11-04');
  assert.equal(d.shipment.updatedBy, 'Google Sheet');
  const notes = (await db.collection('submissions').doc('PFA-CG-2026-00011').collection('messages').get()).docs.map((x) => x.data());
  assert.ok(notes.some((n) => n.by === 'Google Sheet' && /DTDC, tracking number D12345678, sent on 04\/11\/2026 \(Google Sheet\)/.test(n.text)), JSON.stringify(notes));
  assert.ok(logged.some((x) => x.action === 'shipment-updated' && x.subject === 'PFA-CG-2026-00011' && x.who === 'Google Sheet'));
  /* the sheet shows it as kept: tidied, and the card status beside it */
  assert.equal(g.cell('CATC', 'PFA-CG-2026-00011', 'Tracking number'), 'D12345678');
  assert.equal(g.cell('CATC', 'PFA-CG-2026-00011', 'Card status'), 'Shipped');
  assert.equal(g.cell('CATC', 'PFA-CG-2026-00011', 'Shipped on'), SHEET._test.serialOf('2026-11-04'));
  /* and the panel's register says the same */
  const rows = await ROUTE.register.caregiverRows(db);
  const r = rows.find((x) => x.id === 'PFA-CG-2026-00011');
  assert.equal(r.done, true);
  assert.equal(r.shippedOnLabel, '04/11/2026');
});

test('only the courier typed so far: being prepared, nothing marked shipped', async () => {
  const db = memoryFirestore(); seed(db);
  const g = google();
  await run(db, g);
  g.type('Members', 'PFA-MEM-2026-00031', 'Courier', 'India Post');
  const ran = await run(db, g);
  assert.deepEqual(ran.applied, [{ kind: 'membership', id: 'PFA-MEM-2026-00031', status: 'processing' }]);
  const d = (await db.collection('submissions').doc('PFA-MEM-2026-00031').get()).data();
  assert.equal(d.shipment.status, 'processing');
  assert.equal(d.shipment.shippedOn, '');
});

test('a value that cannot be taken stays as typed, Sheet check says why, and the record is not touched', async () => {
  const db = memoryFirestore(); seed(db);
  const g = google();
  await run(db, g);
  g.type('CATC', 'PFA-CG-2026-00012', 'Courier', 'India Post');
  g.type('CATC', 'PFA-CG-2026-00012', 'Tracking number', '12345');
  g.type('CATC', 'PFA-CG-2026-00012', 'Shipped on', '04/11/2026');
  const ran = await run(db, g);
  assert.equal(ran.applied.length, 0);
  assert.equal(ran.refused.length, 1);
  assert.match(ran.refused[0].problem, /EE123456789IN/);
  const d = (await db.collection('submissions').doc('PFA-CG-2026-00012').get()).data();
  assert.equal(d.shipment, undefined);
  assert.equal(g.cell('CATC', 'PFA-CG-2026-00012', 'Tracking number'), '12345');
  assert.match(g.cell('CATC', 'PFA-CG-2026-00012', 'Sheet check'), /EE123456789IN/);
  const st = await SHEET.statusOf(db);
  assert.equal(st.held.caregiver, 1);

  /* left as it is, the next run reads the sheet and writes nothing */
  const writes = g.writes;
  const again = await run(db, g);
  assert.equal(again.ok, true);
  assert.equal(again.wrote, false);
  assert.equal(g.writes, writes);

  /* put right: taken, and the note goes */
  g.type('CATC', 'PFA-CG-2026-00012', 'Tracking number', 'EE123456789IN');
  const fixed = await run(db, g);
  assert.deepEqual(fixed.applied.map((x) => x.status), ['shipped']);
  assert.equal(g.cell('CATC', 'PFA-CG-2026-00012', 'Sheet check'), '');
  assert.equal((await SHEET.statusOf(db)).held.caregiver, 0);
});

test('a date that is not a date is not taken', async () => {
  const db = memoryFirestore(); seed(db);
  const g = google();
  await run(db, g);
  g.type('CATC', 'PFA-CG-2026-00011', 'Courier', 'DTDC');
  g.type('CATC', 'PFA-CG-2026-00011', 'Tracking number', 'D1234567');
  g.type('CATC', 'PFA-CG-2026-00011', 'Shipped on', 'yesterday');
  const ran = await run(db, g);
  assert.match(ran.refused[0].problem, /"yesterday" is not a date: type it like 05\/11\/2026/);
  assert.equal(g.cell('CATC', 'PFA-CG-2026-00011', 'Shipped on'), 'yesterday');
});

/* ---- locked ---------------------------------------------------------------- */

test('anything changed outside the yellow columns is put back at the next run', async () => {
  const db = memoryFirestore(); seed(db);
  const g = google();
  await run(db, g);
  g.type('CATC', 'PFA-CG-2026-00011', 'Name', 'Someone Else');
  g.type('Members', 'PFA-MEM-2026-00031', 'PIN code', '000000');
  g.tab('CATC').values.push(['A stray line']);
  const ran = await run(db, g);
  assert.equal(ran.wrote, true);
  assert.equal(g.cell('CATC', 'PFA-CG-2026-00011', 'Name'), 'Manasa P');
  assert.equal(g.cell('Members', 'PFA-MEM-2026-00031', 'PIN code'), '700156');
  assert.equal(g.tab('CATC').values.length, 3);
  /* no shipment came of it */
  assert.equal((await db.collection('submissions').doc('PFA-CG-2026-00011').get()).data().shipment, undefined);
});

test('nothing changed: the sheet is read, not written; a new paid application is in by the next run', async () => {
  const db = memoryFirestore(); seed(db);
  const g = google();
  let t = NOW;
  const at = () => t;
  await SHEET.sync(db, { fetch: g.fetch, now: at, backoffMs: 0 });
  const writes = g.writes;
  t += 10 * 60000;
  const quiet = await SHEET.sync(db, { fetch: g.fetch, now: at, backoffMs: 0 });
  assert.equal(quiet.ok, true);
  assert.equal(quiet.wrote, false);
  assert.equal(g.writes, writes);

  db.collection('submissions').doc('PFA-CG-2026-00014').set({ kind: 'PFA-CG', status: 'new', createdAt: new Date(t + 1000).toISOString(), receivedAtMs: t + 1000, fields: { name: 'New Person', mobile: '9000000001', address: '1 Road', city: 'Udupi', district: 'Udupi', state: 'Karnataka', pin: '576101' } });
  t += 10 * 60000;
  const next = await SHEET.sync(db, { fetch: g.fetch, now: at, backoffMs: 0 });
  assert.equal(next.wrote, true);
  assert.ok(g.tab('CATC').values.some((r) => r[0] === 'PFA-CG-2026-00014'));

  /* a shipment saved in the panel reaches the sheet too */
  const who = { uid: 'u1', email: 'staff@pfa.test' };
  const saved = await ROUTE.register.save(db, 'caregiver', { id: 'PFA-CG-2026-00012', status: 'shipped', courier: 'Blue Dart', trackingNumber: 'BD99887766' }, who, t + 2000);
  assert.equal(saved.status, 200);
  t += 10 * 60000;
  await SHEET.sync(db, { fetch: g.fetch, now: at, backoffMs: 0 });
  assert.equal(g.cell('CATC', 'PFA-CG-2026-00012', 'Courier'), 'Blue Dart');
  assert.equal(g.cell('CATC', 'PFA-CG-2026-00012', 'Shipped on'), SHEET._test.serialOf('2026-11-05'), 'the day it was marked shipped');
});

test('one run at a time', async () => {
  const db = memoryFirestore(); seed(db);
  const g = google();
  await db.collection('registerSheet').doc('state').set({ lease: { id: 'other', until: NOW + 60000 } });
  const ran = await run(db, g);
  assert.equal(ran.ok, false);
  assert.equal(ran.code, 'running');
  assert.equal(g.calls.length, 0);
});

/* ---- what the panel is told when it cannot write ------------------------------ */

test('the sheet not shared, the API off, or no account: each said plainly, with what to do', async () => {
  const db = memoryFirestore(); seed(db);
  let g = google({ deny: { status: 403, message: 'The caller does not have permission' } });
  let ran = await run(db, g);
  assert.equal(ran.ok, false);
  assert.equal(ran.code, 'not-shared');
  assert.equal(ran.email, SA, 'the address to share the sheet with');
  assert.equal((await db.collection('registerSheet').doc('state').get()).data().lease, null, 'the lease is let go');

  g = google({ deny: { status: 403, message: 'Google Sheets API has not been used in project 123456 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=123456 then retry.' } });
  ran = await run(db, g);
  assert.equal(ran.code, 'api-off');
  assert.equal(ran.error.link, 'https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=123456');

  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  SHEET._test.resetToken();
  ran = await run(db, google());
  assert.equal(ran.code, 'not-set-up');

  process.env.PFA_REGISTER_SHEET_ID = 'off';
  ran = await run(db, google());
  assert.equal(ran.code, 'off');
});

test('on Firebase: the project\'s own account, from the metadata server', async () => {
  const db = memoryFirestore(); seed(db);
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  process.env.K_SERVICE = 'api';
  try {
    const g = google();
    const inner = g.fetch;
    const asked = [];
    const fetchFn = async (url, init) => {
      if (url.startsWith('http://metadata.google.internal/')) {
        asked.push(url);
        assert.equal(init.headers['Metadata-Flavor'], 'Google');
        if (url.endsWith('/email')) return { ok: true, status: 200, text: async () => SA };
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3000 }) };
      }
      return inner(url, init);
    };
    const ran = await SHEET.sync(db, { fetch: fetchFn, now: () => NOW, backoffMs: 0 });
    assert.equal(ran.ok, true, ran.message);
    assert.ok(asked.some((u) => u.includes('scopes=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fspreadsheets')));
    assert.deepEqual(g.tab('CATC').protectedRanges[0].editors.users, [SA]);
  } finally { delete process.env.K_SERVICE; }
});

/* ---- the panel ---------------------------------------------------------------- */

function callRoute(db, method, body, sheet) {
  const handler = ROUTE.createHandler({ getDb: () => db, now: () => NOW, sheet, requireAdmin: async () => ({ uid: 'u1', email: 'staff@pfa.test' }) });
  return new Promise((resolve, reject) => {
    const out = { status: 200 };
    const response = { set statusCode(v) { out.status = v; }, get statusCode() { return out.status; }, setHeader() {}, end(raw) { out.json = JSON.parse(String(raw || '{}')); resolve(out); } };
    Promise.resolve(handler({ method, url: '/api/admin/registers', query: method === 'GET' ? { kind: 'caregiver' } : {}, body, headers: {} }, response)).catch(reject);
  });
}

test('the panel: where the sheet stands with each register, and Update now (logged)', async () => {
  const db = memoryFirestore(); seed(db);
  const forced = [];
  const stub = { statusOf: async () => ({ on: true, url: 'https://docs.google.com/spreadsheets/d/x/edit', lastOkMs: NOW }), sync: async (d, o) => { forced.push(o); return { ok: true, applied: [], refused: [] }; } };
  const got = await callRoute(db, 'GET', null, stub);
  assert.equal(got.json.sheet.on, true);
  const now = await callRoute(db, 'POST', { action: 'sheet', kind: 'caregiver' }, stub);
  assert.equal(now.status, 200);
  assert.deepEqual(forced, [{ force: true }]);
  assert.ok(logged.some((x) => x.action === 'register-sheet-updated'));
});

test('a shipment saved in the panel keeps the day it left', async () => {
  const db = memoryFirestore(); seed(db);
  const who = { uid: 'u1', email: 'staff@pfa.test' };
  await ROUTE.register.save(db, 'membership', { id: 'PFA-MEM-2026-00031', status: 'shipped', courier: 'DTDC', trackingNumber: 'D7654321' }, who, NOW);
  let d = (await db.collection('submissions').doc('PFA-MEM-2026-00031').get()).data();
  assert.equal(d.shipment.shippedOn, '2026-11-05');
  /* delivered later: still the day it left */
  await ROUTE.register.save(db, 'membership', { id: 'PFA-MEM-2026-00031', status: 'delivered', courier: 'DTDC', trackingNumber: 'D7654321' }, who, NOW + 3 * 86400000);
  d = (await db.collection('submissions').doc('PFA-MEM-2026-00031').get()).data();
  assert.equal(d.shipment.shippedOn, '2026-11-05');
  /* a date later than today is refused */
  const bad = await ROUTE.register.save(db, 'membership', { id: 'PFA-MEM-2026-00031', status: 'delivered', courier: 'DTDC', trackingNumber: 'D7654321', shippedOn: '2026-12-01' }, who, NOW);
  assert.equal(bad.status, 422);
});

test('wiring: the ten-minute run, the panel line, the closed state record, and the house rules', () => {
  const fn = read('functions/index.js');
  assert.match(fn, /require\('\.\/lib\/register-sheet\.js'\)[\s\S]*SHEET\.sync\(getDb\(\)\)/);
  assert.match(read('firestore.rules'), /match \/registerSheet\/\{id\}\s*\{ allow read, write: if false; \}/);
  const ui = read('assets/admin-registers.js');
  assert.match(ui, /function sheetHtml\(kind, sh\)/);
  assert.match(ui, /data-rg="sheet"/);
  assert.match(ui, /action: 'sheet'/);
  assert.match(ui, /Open the sheet/);
  for (const f of ['lib/register-sheet.js', 'assets/admin-registers.js', 'lib/routes/admin/registers.js', 'test/register-sheet.test.js']) {
    const s = read(f);
    assert.ok(!/[\u2013\u2014]/.test(s), `${f}: no long dashes`);
    assert.ok(!/care[t]aker/i.test(s.replace(/caretakerCards/g, '')), `${f}: the retired word for a caregiver`);
  }
  /* the sheet never carries money: no column reads a fee, an order or a bank reference */
  for (const k of Object.keys(SHEET.LAYOUT)) for (const [h, key] of SHEET.LAYOUT[k].cols) assert.ok(!/amount|order|bank|payment|fee/i.test(`${h} ${typeof key === 'string' ? key : ''}`), h);
});
