'use strict';

/* The colony card and membership registers (owner, 2 Nov 2026, with the
   office's CACT 2026 and membership sheets: "make the admin center for catc
   and membership look simple and easy to consume like this. with option to
   export and copy paste each item. ensure end user site captures everything
   needed to action the cards. full address, including house number, floor if
   applicable.. phone number etc to send the card without failure of
   delivery"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { memoryFirestore } = require('./_memory-firestore');
const ROUTE = require('../lib/routes/admin/registers');
const POSTAL = require('../lib/postal');
const payment = require('../lib/payment');
const audit = require('../lib/admin-audit');
const firebase = require('../lib/firebase');
const mail = require('../lib/caregiver-mail');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.parse('2026-11-02T06:00:00.000Z');

let realRecord; let logged; let sent;
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_MAIL_API_KEY'];
const saved = {};
test.beforeEach(() => {
  realRecord = audit.record; logged = []; audit.record = async (who, entry) => { logged.push(entry); };
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.PFA_SMTP_USER = 'info@peopleforanimalsindia.org'; process.env.PFA_SMTP_PASS = 'secret';
  sent = [];
  mail._setSmtpTransport(() => ({ sendMail: async (m) => { sent.push(m); return { messageId: m.messageId }; } }));
});
test.afterEach(() => {
  audit.record = realRecord;
  firebase._setDbForTests(null);
  mail._setSmtpTransport(null);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function seed(db) {
  db.collection('submissions').doc('PFA-CG-2026-00011').set({ kind: 'PFA-CG', status: 'approved', createdAt: '2026-10-28T05:00:00.000Z', receivedAtMs: Date.parse('2026-10-28T05:00:00.000Z'),
    fields: { name: 'Manasa P', mobile: '9003565638', altMobile: '9876500000', email: 'manasa@example.com', address: '2H, Touchstone Apartments, 2nd Floor, Annamalai Avenue 1st Main Road, Mogappair West', floor: '2nd Floor', city: 'Chennai', district: 'Chennai', state: 'Tamil Nadu', pin: '600037' } });
  db.collection('caretakerCards').doc('PFA-CCT-2B6N4XKE').set({ name: 'Manasa P', mobile: '9003565638', email: 'manasa@example.com', address: '2H, Touchstone Apartments, 2nd Floor, Annamalai Avenue 1st Main Road, Mogappair West', district: 'Chennai', state: 'Tamil Nadu', pin: '600037', issuedAt: '2026-10-30T05:00:00.000Z', validUntil: '2028-10-30T05:00:00.000Z', applicationRef: 'PFA-CG-2026-00011', cardPrintedAt: '2026-10-30T06:00:00.000Z' });
  db.collection('caretakerCards').doc('PFA-CCT-4K2M8QRT').set({ name: 'Ashokkumar S', mobile: '9655971757', email: 'ashok@example.com', address: '675/3A, Avinashi Road, Chinniyampalayam, Coimbatore, Tamil Nadu 641062', district: 'Coimbatore', state: 'Tamil Nadu', pin: '641062', issuedAt: '2026-10-29T05:00:00.000Z', validUntil: '2028-10-29T05:00:00.000Z', cardPrintedAt: '2026-10-29T06:00:00.000Z', cardPostedAt: '2026-10-30T06:00:00.000Z' });
  /* the site's testing: never listed */
  db.collection('caretakerCards').doc('PFA-CCT-TESTTEST').set({ name: 'Test Card', issuedAt: '2026-10-10T05:00:00.000Z' });
  /* a paid application still waiting for its card, and one turned down */
  db.collection('submissions').doc('PFA-CG-2026-00012').set({ kind: 'PFA-CG', status: 'new', createdAt: '2026-10-29T05:00:00.000Z', receivedAtMs: Date.parse('2026-10-29T05:00:00.000Z'),
    fields: { name: 'trisha dey', mobile: '9883909733', email: 'trisha@example.com', address: 'Vill. Dhanicha, Near Swami Vivekananda School', city: 'Dhanicha', district: 'Nadia', state: 'West Bengal', pin: '741222' } });
  db.collection('submissions').doc('PFA-CG-2026-00013').set({ kind: 'PFA-CG', status: 'rejected', createdAt: '2026-10-29T06:00:00.000Z', receivedAtMs: Date.parse('2026-10-29T06:00:00.000Z'), fields: { name: 'Turned Down', email: 'x@example.com' } });

  db.collection('submissions').doc('PFA-MEM-2026-00031').set({ kind: 'PFA-MEM', status: 'new', createdAt: '2026-10-28T05:00:00.000Z', receivedAtMs: Date.parse('2026-10-28T05:00:00.000Z'),
    fields: { name: 'sanchita banerjee', mobile: '9831563126', altMobile: '', email: 'Sanchita.BMI@gmail.com', tier: 'Golden membership', amount: 2500, address: 'Flat 22/CL, Sanjeeva Town Duplex Estate, Thakdari Main Road, Newtown, Near Aquatica Water Park', city: 'Kolkata', district: 'North 24 Parganas', state: 'West Bengal', pin: '700156' } });
  db.collection('submissions').doc('PFA-MEM-2026-00032').set({ kind: 'PFA-MEM', status: 'dispatched', createdAt: '2026-10-29T05:00:00.000Z', receivedAtMs: Date.parse('2026-10-29T05:00:00.000Z'),
    memberCard: { cardId: 'PFA-MC-AB12CD34', approvedAt: '2026-10-30T05:00:00.000Z', printedAt: '2026-10-30T06:00:00.000Z', dispatchedAt: '2026-10-31T06:00:00.000Z', courier: 'DTDC', trackingNumber: 'D12345678' },
    fields: { name: 'Sohan Ashok Banasode', mobile: '6361825963', altMobile: '9448012345', email: 'sohan@example.com', tier: 'Lifetime membership', amount: 10000, address: 'House No 10, Near Om Shanti Building, Shantinagar', city: 'Athani', district: 'Belagavi (Belgaum)', state: 'Karnataka', pin: '591304' } });
  db.collection('submissions').doc('PFA-MEM-2026-00033').set({ kind: 'PFA-MEM', status: 'removed', createdAt: '2026-10-29T05:00:00.000Z', receivedAtMs: Date.parse('2026-10-29T05:00:00.000Z'), fields: { name: 'Removed One' } });
  db.collection('submissions').doc('PFA-MEM-2026-00001').set({ kind: 'PFA-MEM', status: 'new', createdAt: '2026-10-05T05:00:00.000Z', receivedAtMs: Date.parse('2026-10-05T05:00:00.000Z'), fields: { name: 'Testing Member' } });
}

function call(db, query, modules) {
  const asked = [];
  const handler = ROUTE.createHandler({ getDb: () => db, now: () => NOW, requireAdmin: async (req, res, module) => { asked.push(module); return modules && !modules.includes(module) ? null : { uid: 'u1', email: 'staff@pfa.test' }; } });
  return new Promise((resolve, reject) => {
    const out = { status: 200, headers: {}, asked };
    const response = { set statusCode(v) { out.status = v; }, get statusCode() { return out.status; }, setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      end(raw) { out.raw = raw; try { out.json = JSON.parse(String(raw || '{}')); } catch (_) { out.json = null; } resolve(out); } };
    Promise.resolve(handler({ method: 'GET', url: '/api/admin/registers', query, headers: {} }, response)).then((r) => { if (r === undefined && out.raw === undefined) resolve(out); }).catch(reject);
  });
}

test('the colony card register: only applications the website took, with their card once issued', async () => {
  const db = memoryFirestore(); seed(db);
  const r = await call(db, { kind: 'caregiver' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.asked, ['caregivers'], 'the Colony cards section decides who sees it');
  assert.deepEqual(r.json.rows.map((x) => x.id), ['PFA-CG-2026-00011', 'PFA-CG-2026-00012'],
    'a line per paid website application, oldest first; a card issued by hand (no application), testing and a rejected application are not listed');
  const [manasa, trisha] = r.json.rows;
  assert.deepEqual(manasa.lines, ['2H, Touchstone Apartments, 2nd Floor, Annamalai Avenue 1st Main Road, Mogappair West', 'Chennai', 'Tamil Nadu - 600037']);
  assert.deepEqual([manasa.cardId, manasa.issuedOn, manasa.appliedOn, manasa.mobile, manasa.altMobile, manasa.floor], ['PFA-CCT-2B6N4XKE', '30/10/2026', '28/10/2026', '9003565638', '9876500000', '2nd Floor']);
  assert.deepEqual([manasa.ship, manasa.courier, manasa.tracking, manasa.done], ['', '', '', false], 'printed, not shipped');
  assert.deepEqual([trisha.name, trisha.cardId, trisha.lines], ['Trisha Dey', '', ['Vill. Dhanicha, Near Swami Vivekananda School', 'Nadia', 'West Bengal - 741222']], 'the town once: it is in the street line already');
  assert.deepEqual(r.json.statuses, { processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', returned: 'Returned to sender' });
});

test('a card already marked posted in Print and post reads as shipped', async () => {
  const db = memoryFirestore(); seed(db);
  db.collection('caretakerCards').doc('PFA-CCT-2B6N4XKE').set({ cardPostedAt: '2026-10-31T06:00:00.000Z' }, { merge: true });
  const r = await call(db, { kind: 'caregiver' });
  assert.deepEqual([r.json.rows[0].ship, r.json.rows[0].shipLabel, r.json.rows[0].done], ['shipped', 'Shipped', true]);
});

test('the membership register: name, number, email, address, type and amount, date; dispatched ones done', async () => {
  const db = memoryFirestore(); seed(db);
  const r = await call(db, { kind: 'membership' });
  assert.deepEqual(r.asked, ['membership']);
  assert.deepEqual(r.json.rows.map((x) => x.id), ['PFA-MEM-2026-00031', 'PFA-MEM-2026-00032'], 'removed and testing left out');
  const [s, sohan] = r.json.rows;
  assert.deepEqual([s.name, s.mobile, s.email, s.type, s.amount, s.paidOn, s.done], ['Sanchita Banerjee', '9831563126', 'sanchita.bmi@gmail.com', 'Golden membership', 'INR 2,500.00', '28/10/2026', false]);
  assert.deepEqual(s.lines, ['Flat 22/CL, Sanjeeva Town Duplex Estate, Thakdari Main Road, Newtown, Near Aquatica Water Park', 'Kolkata, North 24 Parganas', 'West Bengal - 700156']);
  assert.deepEqual([sohan.altMobile, sohan.cardId, sohan.cardStage, sohan.courier, sohan.tracking, sohan.ship, sohan.done], ['9448012345', 'PFA-MC-AB12CD34', 'Dispatched by courier', 'DTDC', 'D12345678', 'shipped', true], 'a card already dispatched by courier reads as shipped, with its courier');
  assert.deepEqual(sohan.lines, ['House No 10, Near Om Shanti Building, Shantinagar', 'Athani, Belagavi (Belgaum)', 'Karnataka - 591304']);
});

test('export: a CSV Excel and Sheets open as they are, each address part in its own column too, logged', async () => {
  const db = memoryFirestore(); seed(db);
  const r = await call(db, { kind: 'membership', format: 'csv' });
  assert.equal(r.headers['content-type'], 'text/csv; charset=utf-8');
  assert.equal(r.headers['content-disposition'], 'attachment; filename="PFA-members-2026-11-02.csv"');
  const csv = String(r.raw);
  assert.ok(csv.startsWith('\ufeff'), 'Excel reads it as UTF-8');
  const head = csv.slice(1).split('\r\n')[0];
  assert.equal(head, 'Name,Phone number,Other phone,Email,Address,"House, street and area",City,District,State,PIN code,Membership type,Amount,Date,Member number,Card number,Courier,Tracking number,Status,Last email');
  assert.ok(csv.includes('"Flat 22/CL, Sanjeeva Town Duplex Estate, Thakdari Main Road, Newtown, Near Aquatica Water Park\nKolkata, North 24 Parganas\nWest Bengal - 700156"'), 'the label, as one cell with its lines');
  assert.ok(csv.includes(',Kolkata,North 24 Parganas,West Bengal,700156,'), 'and the parts, a column each');
  assert.deepEqual(logged.map((x) => [x.action, x.subject, x.detail]), [['register-exported', 'membership', '2 rows']]);
  const cg = await call(db, { kind: 'caregiver', format: 'csv' });
  assert.equal(cg.headers['content-disposition'], 'attachment; filename="PFA-colony-cards-2026-11-02.csv"');
  assert.match(String(cg.raw).split('\r\n')[0], /^\ufeffName,Phone number,Other phone,Email,Address,"House, street and area",City,District,State,PIN code,Application number,Applied on,Card number,Issued on,Courier,Tracking number,Status,Last email$/);
  assert.ok(!/[–—]/.test(csv + cg.raw), 'no long dashes');
});

function post(db, body, who) {
  firebase._setDbForTests(db);
  const handler = ROUTE.createHandler({ getDb: () => db, now: () => NOW, requireAdmin: async () => who || { uid: 'u1', email: 'staff@pfa.test' } });
  return new Promise((resolve, reject) => {
    const out = { status: 200, headers: {} };
    const response = { set statusCode(v) { out.status = v; }, get statusCode() { return out.status; }, setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      end(raw) { out.raw = raw; try { out.json = JSON.parse(String(raw || '{}')); } catch (_) { out.json = null; } resolve(out); } };
    Promise.resolve(handler({ method: 'POST', url: '/api/admin/registers', query: {}, body, headers: {} }, response)).catch(reject);
  });
}

test('saving where a card stands: checked, kept on the application beside what the person wrote, in its history and notes', async () => {
  const db = memoryFirestore(); seed(db);
  const no = await post(db, { action: 'save', kind: 'caregiver', id: 'PFA-CG-2026-00011', status: 'shipped', courier: 'DTDC', trackingNumber: '' });
  assert.equal(no.status, 422);
  assert.match(no.json.message, /needs the courier and the tracking number/);
  for (const status of ['delivered', 'returned']) {
    assert.equal((await post(db, { action: 'save', kind: 'caregiver', id: 'PFA-CG-2026-00011', status, courier: '', trackingNumber: '' })).status, 422, `${status} needs the courier and the number too`);
  }
  const ip = await post(db, { action: 'save', kind: 'caregiver', id: 'PFA-CG-2026-00011', status: 'shipped', courier: 'India Post', trackingNumber: '12345' });
  assert.equal(ip.status, 422);
  assert.match(ip.json.message, /An India Post number looks like EE123456789IN/);
  assert.equal((await post(db, { action: 'save', kind: 'caregiver', id: 'PFA-CG-2026-00011', status: 'processing' })).status, 200, 'being prepared needs only the status');
  assert.equal((await post(db, { action: 'save', kind: 'caregiver', id: 'PFA-CG-2026-00011', status: 'lost' })).status, 422);
  assert.equal((await post(db, { action: 'save', kind: 'caregiver', id: 'PFA-MEM-2026-00031', status: 'processing' })).status, 400, 'a membership is not a colony card');
  const ok = await post(db, { action: 'save', kind: 'caregiver', id: 'PFA-CG-2026-00011', status: 'shipped', courier: 'DTDC', trackingNumber: 'd 1234 5678' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const rec = db.dump()['submissions/PFA-CG-2026-00011'];
  assert.deepEqual([rec.shipment.status, rec.shipment.courier, rec.shipment.trackingNumber, rec.shipment.updatedBy], ['shipped', 'DTDC', 'D12345678', 'staff@pfa.test']);
  assert.equal(rec.fields.name, 'Manasa P', 'what the person wrote is untouched');
  assert.equal(rec.status, 'approved', 'the application keeps its own status');
  const h = rec.history[rec.history.length - 1];
  assert.deepEqual([h.event, h.shipStatus, h.courier, h.trackingNumber, h.by], ['shipment', 'shipped', 'DTDC', 'D12345678', 'staff@pfa.test']);
  const notes = Object.entries(db.dump()).filter(([k]) => k.startsWith('submissions/PFA-CG-2026-00011/messages/')).map(([, v]) => v.text);
  assert.deepEqual(notes.sort(), ['Card being prepared.', 'Card shipped, DTDC, tracking number D12345678.']);
  assert.deepEqual(logged.map((x) => [x.action, x.subject]), [['shipment-updated', 'PFA-CG-2026-00011'], ['shipment-updated', 'PFA-CG-2026-00011']]);
  const rows = (await call(db, { kind: 'caregiver' })).json.rows;
  assert.deepEqual([rows[0].ship, rows[0].shipLabel, rows[0].courier, rows[0].tracking, rows[0].done], ['shipped', 'Shipped', 'DTDC', 'D12345678', true]);
});

test('the letter: previewed one card per person, then sent exactly as previewed; a change in between refuses', async () => {
  const db = memoryFirestore(); seed(db);
  await post(db, { action: 'save', kind: 'caregiver', id: 'PFA-CG-2026-00011', status: 'shipped', courier: 'DTDC', trackingNumber: 'D12345678' });
  const pre = await post(db, { action: 'preview', kind: 'caregiver', ids: ['PFA-CG-2026-00011', 'PFA-CG-2026-00012'] });
  assert.equal(pre.status, 200);
  assert.equal(sent.length, 0, 'a preview sends nothing');
  const [a, b] = pre.json.items;
  assert.deepEqual([a.ok, a.name, a.to, a.subject], [true, 'Manasa P', 'manasa@example.com', 'Your PFA colony caregiver card is on its way - DTDC D12345678']);
  for (const bit of ['Your card is on its way.', 'DTDC', 'D12345678', 'PFA-CG-2026-00011', 'PFA-CCT-2B6N4XKE', 'Mogappair West, Chennai, Tamil Nadu - 600037']) assert.ok(a.html.includes(bit), bit);
  assert.deepEqual([b.ok, b.problem], [false, 'Set the status and save it first.'], 'Trisha has no status yet');
  /* sending without the preview's token, or after something changed */
  assert.equal((await post(db, { action: 'send', kind: 'caregiver', ids: ['PFA-CG-2026-00011'], token: 'made-up' })).status, 409);
  await post(db, { action: 'save', kind: 'caregiver', id: 'PFA-CG-2026-00011', status: 'shipped', courier: 'DTDC', trackingNumber: 'D99999999' });
  const stale = await post(db, { action: 'send', kind: 'caregiver', ids: ['PFA-CG-2026-00011', 'PFA-CG-2026-00012'], token: pre.json.token });
  assert.equal(stale.status, 409);
  assert.match(stale.json.message, /Something changed since the preview/);
  assert.equal(sent.length, 0);
  /* preview again, send */
  const again = await post(db, { action: 'preview', kind: 'caregiver', ids: ['PFA-CG-2026-00011', 'PFA-CG-2026-00012'] });
  const go = await post(db, { action: 'send', kind: 'caregiver', ids: ['PFA-CG-2026-00011', 'PFA-CG-2026-00012'], token: again.json.token });
  assert.equal(go.status, 200, JSON.stringify(go.json));
  assert.deepEqual(go.json.results.map((x) => [x.id, x.state]), [['PFA-CG-2026-00011', 'sent'], ['PFA-CG-2026-00012', 'skipped']]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'manasa@example.com');
  assert.equal(sent[0].subject, 'Your PFA colony caregiver card is on its way - DTDC D99999999');
  const rec = db.dump()['submissions/PFA-CG-2026-00011'];
  assert.deepEqual(rec.shipment.emails.map((e) => [e.status, e.to, e.by]), [['shipped', 'manasa@example.com', 'staff@pfa.test']]);
  assert.equal(rec.history[rec.history.length - 1].event, 'shipment-emailed');
  assert.ok(logged.some((x) => x.action === 'shipping-letters-sent' && /1 sent, 0 queued, 1 not sent/.test(x.detail)));
  assert.match((await call(db, { kind: 'caregiver' })).json.rows[0].emailed, /^Shipped on 02\/11\/2026$/);
  /* a double press sends it once */
  const twice = await post(db, { action: 'send', kind: 'caregiver', ids: ['PFA-CG-2026-00011', 'PFA-CG-2026-00012'], token: again.json.token });
  assert.equal(twice.status, 200);
  assert.equal(sent.length, 1, 'the same preview, sent again, is not a second email');
});

test('bulk: members, each previewed as their own card; a returned card asks for the address again', async () => {
  const db = memoryFirestore(); seed(db);
  await post(db, { action: 'save', kind: 'membership', id: 'PFA-MEM-2026-00031', status: 'returned', courier: 'India Post', trackingNumber: 'EE123456789IN' });
  const pre = await post(db, { action: 'preview', kind: 'membership', ids: ['PFA-MEM-2026-00031', 'PFA-MEM-2026-00032', 'PFA-MEM-2026-00033'] });
  const by = Object.fromEntries(pre.json.items.map((x) => [x.id, x]));
  assert.equal(by['PFA-MEM-2026-00031'].subject, 'Your PFA membership card could not be delivered');
  assert.ok(by['PFA-MEM-2026-00031'].html.includes('Reply to this email with your full address (house or flat number, floor, street, area, PIN code)'));
  assert.equal(by['PFA-MEM-2026-00032'].ok, false, 'dispatched before the registers, but nothing saved here yet');
  assert.equal(by['PFA-MEM-2026-00033'].problem, 'Not on record.', 'a removed membership is never written to');
  const go = await post(db, { action: 'send', kind: 'membership', ids: ['PFA-MEM-2026-00031', 'PFA-MEM-2026-00032', 'PFA-MEM-2026-00033'], token: pre.json.token });
  assert.equal(go.json.sent, 1);
  assert.equal(sent[0].to, 'sanchita.bmi@gmail.com');
  assert.equal((await post(db, { action: 'preview', kind: 'membership', ids: [] })).status, 400);
  assert.equal((await post(db, { action: 'nothing', kind: 'membership' })).status, 400);
});

test('someone without the section sees nothing; a bad kind is refused', async () => {
  const db = memoryFirestore(); seed(db);
  const r = await call(db, { kind: 'membership' }, ['caregivers']);
  assert.equal(r.json, undefined, 'requireAdmin answered for it');
  const bad = await call(db, { kind: 'donors' });
  assert.equal(bad.status, 400);
});

test('the courier gets the door: an optional floor, written into the address line', () => {
  assert.deepEqual(['2', '1', '11', '22', '3rd', 'g', 'Ground', '0', '2nd floor', 'Mezzanine', ''].map(POSTAL.floorOf),
    ['2nd Floor', '1st Floor', '11th Floor', '22nd Floor', '3rd Floor', 'Ground Floor', 'Ground Floor', 'Ground Floor', '2nd floor', 'Mezzanine Floor', '']);
  const p = POSTAL.read({ house: 'Flat 4B, Sai Residency', floor: '2', street: '12th Cross, Kodavoor', landmark: 'Krishna temple' });
  assert.equal(p.address, 'Flat 4B, Sai Residency, 2nd Floor, 12th Cross, Kodavoor, Near Krishna Temple');
  assert.equal(p.floor, '2nd Floor');
  assert.equal(POSTAL.read({ house: '12', street: 'MG Road' }).address, '12 MG Road', 'no floor: as before');
  assert.equal(POSTAL.read({ house: 'Flat 2, 3rd Floor', floor: '3rd', street: 'MG Road' }).address, 'Flat 2, 3rd Floor, MG Road', 'a floor already in the house line is not said twice');
});

test('a second number for the courier: optional, a real mobile if given, dropped when it is the first again', () => {
  const base = { type: 'membership', tier: 'golden', name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com', house: 'Flat 4B, Sai Residency', floor: '2', street: '12th Cross, Kodavoor', city: 'Udupi', state: 'Karnataka', district: 'Udupi', pincode: '576101', terms: 'yes' };
  const m = payment.parsePaymentRequest(Object.assign({}, base, { altMobile: '+91 94480 12345' }));
  assert.equal(m.metadata.altMobile, '9448012345');
  assert.equal(m.metadata.floor, '2nd Floor');
  assert.equal(m.metadata.address, 'Flat 4B, Sai Residency, 2nd Floor, 12th Cross, Kodavoor');
  assert.equal(payment.parsePaymentRequest(base).metadata.altMobile, '');
  assert.equal(payment.parsePaymentRequest(Object.assign({}, base, { altMobile: '98765 43210' })).metadata.altMobile, '', 'the first number again');
  assert.throws(() => payment.parsePaymentRequest(Object.assign({}, base, { altMobile: '12345' })), /other number has to be a 10-digit Indian mobile number/);
  const cg = payment.parseCaregiverApplication(Object.assign({}, base, { type: 'caregiver-application', colony: 'Kodavoor', altMobile: '9448012345', documents: 'a'.repeat(48) }));
  assert.deepEqual([cg.metadata.altMobile, cg.metadata.floor], ['9448012345', '2nd Floor']);
  const response = read('lib/routes/payment/response.js');
  assert.equal((response.match(/altMobile: meta\.altMobile \|\| '', floor: meta\.floor \|\| ''/g) || []).length, 2, 'both records keep them');
});

test('the two card forms ask for the floor and a second number, beside what they already require', () => {
  const doc = new JSDOM(read('get-involved.html')).window.document;
  for (const id of ['memForm', 'cgForm']) {
    const form = doc.getElementById(id);
    const named = (n) => form.querySelector(`[name="${n}"]`);
    for (const n of ['name', 'mobile', 'email', 'house', 'street', 'city', 'state', 'district', 'pincode']) assert.ok(named(n) && named(n).hasAttribute('required'), `${id} requires ${n}`);
    assert.ok(named('floor') && !named('floor').hasAttribute('required'), `${id} asks for the floor, optional`);
    assert.ok(named('altMobile') && !named('altMobile').hasAttribute('required'), `${id} asks for a second number, optional`);
    assert.equal(named('altMobile').getAttribute('type'), 'tel');
    assert.match(form.querySelector('label[for$="AltMobile"]').textContent, /Another number the courier can call/);
  }
});

test('the panel: each register first in its tab, every item copies, a row pastes as cells, export downloads', () => {
  /* the register code lives in assets/admin-registers.js (admin.html stays
     under the page-weight ceiling); the panel loads it after its own script */
  const page = read('admin.html');
  const admin = page + read('assets/admin-registers.js');
  assert.match(page, /window\.PFAAdmin = \{ \$: \$, esc: esc, say: say, api: api, token: token, on: on, certificates: function \(\) \{ return ct\.rows; \} \};/);
  assert.match(page, /<\/script>\n<script src="assets\/admin-registers\.js"><\/script>/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-registers\.js'/, 'the Firebase panel carries it');
  assert.match(admin, /caregivers:\s+\{ title: 'Colony cards',\s+module: 'caregivers',\s+needs: 'caregivers', panes: \['cgsheet', 'apply', 'caregivers', 'verify', 'cards'\] \}/);
  assert.match(admin, /membership:\s+\{ title: 'Membership cards', module: 'membership', needs: 'membership', panes: \['memsheet', 'membership'\] \}/);
  assert.ok(admin.indexOf('data-pane="cgsheet"') < admin.indexOf('data-pane="apply" role'), 'the register comes before the applications');
  assert.match(admin, /if \(tab === 'cgsheet'\) return window\.PFARegisters && window\.PFARegisters\.pane\('caregiver'\);/);
  assert.match(admin, /if \(tab === 'memsheet'\) return window\.PFARegisters && window\.PFARegisters\.pane\('membership'\);/);
  assert.match(admin, /class="rg-c[^"]*" data-copy="/);
  assert.match(admin, /new window\.ClipboardItem\(\{ 'text\/plain': .*'text\/html': /, 'a row is copied as text and as a table, so a sheet takes it as cells');
  assert.match(admin, /\/api\/admin\/registers\?kind=' \+ kind \+ '&format=csv'/);
  for (const h of ['Name', 'Phone number', 'Address', 'Application', 'District / State', 'Name / number / email', 'Membership type', 'Date']) assert.ok(admin.includes(`['${h}', function (r)`), h);
  /* shipping on every line, and the letters always previewed, one card each */
  assert.match(admin, /<select data-f="ship" aria-label="Status">/);
  assert.match(admin, /<input data-f="courier"[^>]*placeholder="Courier"/);
  assert.match(admin, /<input data-f="tracking"[^>]*placeholder="Tracking number"/);
  assert.match(admin, /data-rg="mailpicked" disabled>Preview emails</);
  /* Preview email lights only when the line is complete and valid (owner, 2 Nov 2026) */
  assert.match(admin, /data-rg="mail" disabled>Preview email</, 'off until the line is ready');
  assert.match(admin, /mail\.disabled = !c\.ready; mail\.classList\.toggle\('is-ready', c\.ready\);/);
  assert.match(admin, /if \(valid && !mailable\) why = 'No email address on the application, so no email can go\.';/);
  assert.match(admin, /INDIA_POST\.test\(v\.courier\) && !\/\^\[A-Z\]\{2\}\\d\{9\}IN\$\/\.test\(v\.tracking\)/, 'India Post numbers in their shape');
  assert.match(admin, /var ready = regPickedReady\(kind\);\n\s+if \(ready\.length\) regPreview\(kind, ready\);/, 'bulk takes only the ready lines');
  assert.match(admin, /dirty\.reduce\(function \(p, tr\) \{ return p\.then\(function \(\) \{ return regSave\(kind, tr\); \}\); \}, Promise\.resolve\(\)\)/, 'unsaved changes are saved before the preview');
  assert.match(admin, /<dialog class="rgm" id="rgMail"/);
  assert.match(admin, /action: 'preview', kind: kind, ids: ids/);
  assert.match(admin, /<article class="rgm-card/);
  assert.match(admin, /<iframe class="rgm-frame" sandbox="" /, 'each letter shown as it is, with nothing in it able to run');
  assert.match(admin, /action: 'send', kind: kind, ids: JSON\.parse\(dlg\.getAttribute\('data-ids'\) \|\| '\[\]'\), token: dlg\.getAttribute\('data-token'\)/, 'send only from the preview, with its token');
  const api = read('api/index.js');
  assert.match(api, /'admin\/registers': '\.\/admin\/registers\.js'/);
  assert.match(api, /'admin\/registers': \(\) => require\('\.\.\/lib\/routes\/admin\/registers\.js'\)/);
});
