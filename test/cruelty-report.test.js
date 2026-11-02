'use strict';

/* The monthly cruelty report (owner, 2 Nov 2026: "month wise cruelty report
   and have a state wise list within that report so that PFA team can
   co-ordinate with govt of that state. at 2nd of each month- previous
   months cruelty reports as 1 pdf has to be sent to gandhim. who reported
   what and when and from where"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const CR = require('../lib/cruelty-report');
const mail = require('../lib/caregiver-mail');
const fileStore = require('../lib/file-store');
const ROUTE = require('../lib/routes/admin/cruelty-report');
const audit = require('../lib/admin-audit');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* 2 Dec 2026, 08:30 in India: the run that reports November */
const DEC2 = Date.parse('2026-12-02T03:00:00.000Z');

let db; let sent; let realRecord;
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_MAIL_API_KEY', 'PFA_PAYMENTS_INBOX', 'PFA_SUBMISSIONS_INBOX'];
const saved = {};
test.beforeEach(() => {
  db = memoryFirestore();
  firebase._setDbForTests(db);
  fileStore._setBucket(async () => null);
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.PFA_SMTP_USER = 'info@peopleforanimalsindia.org';
  process.env.PFA_SMTP_PASS = 'secret';
  sent = [];
  mail._setSmtpTransport(() => ({ sendMail: async (m) => { sent.push(m); return { messageId: m.messageId }; } }));
  realRecord = audit.record;
  audit.record = async () => {};
});
test.afterEach(() => {
  firebase._setDbForTests(null);
  fileStore._setBucket(null);
  mail._setSmtpTransport(null);
  audit.record = realRecord;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const at = (iso) => Date.parse(iso);
function report(ref, iso, fields, extra) {
  db.collection('submissions').doc(ref).set(Object.assign({
    reference: ref, kind: 'PFA-CR', kindLabel: 'Cruelty report', status: 'new', createdAt: iso, receivedAtMs: at(iso), attachments: 0,
    fields: Object.assign({ what: 'A dog is beaten every morning.', animal: 'Dog', urgency: 'Happening now', when: 'This morning', accused: 'The shopkeeper', name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com', address: '12, 4th Cross, Malleshwaram', city: 'Bengaluru', district: 'Bengaluru Urban', state: 'Karnataka', pincode: '560003' }, fields)
  }, extra || {}));
}

function seed() {
  report('PFA-CR-2026-00101', '2026-11-03T05:00:00.000Z', {}, { attachments: 2 });
  report('PFA-CR-2026-00102', '2026-11-05T05:00:00.000Z', { name: 'रमेश कुमार', mobile: '9123456780', email: 'ramesh@example.com', address: 'गली नंबर 4, आलमबाग', city: 'Lucknow', district: 'Lucknow', state: 'Uttar Pradesh', pincode: '226001', animal: 'Cow or buffalo', urgency: 'Ongoing', what: 'एक गाय घायल है।', mapLink: 'https://maps.google.com/?q=26.8467,80.9462' });
  report('PFA-CR-2026-00103', '2026-11-10T05:00:00.000Z', { district: 'Mysuru', city: 'Mysuru', pincode: '570001', urgency: 'Past', name: 'Suma' }, { status: 'in-progress' });
  report('PFA-CR-2026-00104', '2026-11-12T05:00:00.000Z', { name: 'Karthik S', state: 'Tamil Nadu', district: 'Chennai', city: 'Chennai', pincode: '600017', animal: 'Horse or donkey' }, { status: 'handled' });
  report('PFA-CR-2026-00105', '2026-11-14T05:00:00.000Z', { state: '', district: '', name: 'No State' });
  /* 30 Nov, 23:30 in India: November */
  report('PFA-CR-2026-00106', '2026-11-30T18:00:00.000Z', { name: 'Late Night', district: 'Bengaluru Urban' });
  /* 1 Dec, 00:10 in India: December, not November */
  report('PFA-CR-2026-00107', '2026-11-30T18:40:00.000Z', { name: 'Next Month' });
  /* left out: spam, removed, October, and another kind of form */
  report('PFA-CR-2026-00108', '2026-11-15T05:00:00.000Z', { name: 'Spammer' }, { status: 'spam' });
  report('PFA-CR-2026-00109', '2026-11-16T05:00:00.000Z', { name: 'Removed One' }, { status: 'removed' });
  report('PFA-CR-2026-00099', '2026-10-25T05:00:00.000Z', { name: 'October Person' });
  db.collection('submissions').doc('PFA-Q-2026-00001').set({ reference: 'PFA-Q-2026-00001', kind: 'PFA-Q', status: 'new', createdAt: '2026-11-03T05:00:00.000Z', receivedAtMs: at('2026-11-03T05:00:00.000Z'), fields: { name: 'A Question', state: 'Karnataka' } });
}

async function textOf(pdf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const base = path.dirname(require.resolve('pdfjs-dist/package.json')) + '/';
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: 0, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: base + 'standard_fonts/' });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const c = await (await doc.getPage(i)).getTextContent();
    pages.push(c.items.map((x) => x.str).join(' ').replace(/\s+/g, ' '));
  }
  await task.destroy();
  return pages;
}

test('the calendar is India\'s: the month before, sent on the 2nd, caught up to the 8th', () => {
  assert.equal(CR.previousMonth(DEC2), '2026-11');
  assert.equal(CR.previousMonth(Date.parse('2027-01-02T03:00:00.000Z')), '2026-12');
  assert.equal(CR.due(Date.parse('2026-12-01T03:00:00.000Z')), false, 'not on the 1st: that is the payments report\'s day');
  assert.equal(CR.due(DEC2), true);
  assert.equal(CR.due(Date.parse('2026-12-01T19:00:00.000Z')), true, '00:30 on the 2nd in India');
  assert.equal(CR.due(Date.parse('2026-12-08T10:00:00.000Z')), true, 'up to the 8th if the 2nd was missed');
  assert.equal(CR.due(Date.parse('2026-12-09T10:00:00.000Z')), false);
  assert.equal(CR.when(at('2026-11-03T05:00:00.000Z')), '3 Nov 2026, 10:30 am');
  assert.equal(CR.when(at('2026-11-30T18:00:00.000Z')), '30 Nov 2026, 11:30 pm');
});

test('the month\'s cruelty reports, by state A to Z with "State not given" last; spam, removed and other months out', async () => {
  seed();
  const r = CR.summarise('2026-11', await CR.collect(db, '2026-11'));
  assert.equal(r.label, 'November 2026');
  assert.equal(r.count, 6);
  assert.deepEqual(r.states.map((s) => [s.state, s.count, s.now]), [['Karnataka', 3, 2], ['Tamil Nadu', 1, 1], ['Uttar Pradesh', 1, 0], ['State not given', 1, 1]]);
  assert.deepEqual(r.states[0].districts, [{ district: 'Bengaluru Urban', count: 2 }, { district: 'Mysuru', count: 1 }]);
  assert.equal(CR.districtText(r.states[0]), 'Bengaluru Urban (2), Mysuru');
  assert.deepEqual(r.states[0].rows.map((x) => x.reference), ['PFA-CR-2026-00101', 'PFA-CR-2026-00103', 'PFA-CR-2026-00106'], 'oldest first');
  assert.deepEqual(r.leftOut, { spam: 1, removed: 1 });
  const all = r.states.flatMap((s) => s.rows.map((x) => x.name));
  for (const out of ['Next Month', 'Spammer', 'Removed One', 'October Person', 'A Question']) assert.ok(!all.includes(out), out);
  /* who, when, from where, what */
  const a = r.states[0].rows[0];
  assert.deepEqual([a.name, a.mobile, a.email, a.when, a.status, a.address, a.city, a.district, a.state, a.pincode, a.animal, a.urgency, a.happened, a.accused, a.what, a.photos],
    ['Asha Rao', '+91 98765 43210', 'asha@example.com', '3 Nov 2026, 10:30 am', 'New', '12, 4th Cross, Malleshwaram', 'Bengaluru', 'Bengaluru Urban', 'Karnataka', '560003', 'Dog', 'Happening now', 'This morning', 'The shopkeeper', 'A dog is beaten every morning.', 2]);
  assert.equal(r.states[0].rows[1].status, 'Being handled');
  assert.equal(r.states[1].rows[0].status, 'Closed');
  assert.equal(r.states[2].rows[0].mapLink, 'https://maps.google.com/?q=26.8467,80.9462');
});

test('anything a report lacks of its address or phone is said, not skipped', () => {
  const full = { address: '12, 4th Cross', city: 'Bengaluru', district: 'Bengaluru (Bangalore) Urban', state: 'Karnataka', pincode: '560003', mobile: '+91 98765 43210', email: 'a@b.in' };
  assert.equal(CR.missingOf(full), '');
  assert.equal(CR.missingOf(Object.assign({}, full, { pincode: '', district: '', mobile: '' })), 'district, PIN code, phone number');
  assert.equal(CR.missingOf(Object.assign({}, full, { state: '', stateGiven: 'Bangalore' })), '', 'a state typed in but not on the list is shown as given');
  assert.match(read('lib/cruelty-report.js'), /field\('Not given', missingOf\(r\), \{ color: RUST, bold: true \}\);/);
});

test('the site\'s testing (20 Oct 2026 and earlier) is never counted', async () => {
  report('PFA-CR-2026-00001', '2026-10-10T05:00:00.000Z', { name: 'Test Run' });
  report('PFA-CR-2026-00002', '2026-10-25T05:00:00.000Z', { name: 'Real October' });
  const r = CR.summarise('2026-10', await CR.collect(db, '2026-10'));
  assert.deepEqual(r.states.flatMap((s) => s.rows.map((x) => x.name)), ['Real October']);
});

test('the PDF: the month at a glance, then each state on its own page with every report in full', async () => {
  seed();
  const r = await CR.build(db, '2026-11');
  assert.ok(Buffer.isBuffer(r.pdf));
  assert.equal(r.pdf.subarray(0, 5).toString(), '%PDF-');
  const pages = await textOf(r.pdf);
  assert.equal(pages.length, 5, 'the summary, then Karnataka, Tamil Nadu, Uttar Pradesh, State not given');
  assert.match(pages[0], /November 2026/);
  assert.match(pages[0], /6 reports from 3 states/);
  assert.match(pages[0], /Karnataka 3 2 Bengaluru Urban \(2\), Mysuru/);
  assert.match(pages[0], /Left out: 1 marked as spam and 1 removed in the admin panel\./);
  assert.match(pages[0], /Page 1 of 5/);
  assert.match(pages[1], /^.*Karnataka/);
  for (const bit of ['PFA-CR-2026-00101', '3 Nov 2026, 10:30 am', 'New', 'Asha Rao', '+91 98765 43210', 'asha@example.com', '12, 4th Cross, Malleshwaram, Bengaluru, Bengaluru Urban, Karnataka, PIN 560003', 'Dog', 'Happening now', 'This morning', 'The shopkeeper', 'A dog is beaten every morning.', '2 sent, kept in the admin panel under PFA-CR-2026-00101', 'PFA-CR-2026-00106', 'Late Night']) {
    assert.ok(pages[1].includes(bit), bit);
  }
  assert.match(pages[2], /Tamil Nadu[\s\S]*Closed[\s\S]*Karthik S/);
  assert.match(pages[3], /Uttar Pradesh[\s\S]*PFA-CR-2026-00102[\s\S]*https:\/\/maps\.google\.com\/\?q=26\.8467,80\.9462/);
  assert.match(pages[4], /State not given[\s\S]*No State[\s\S]*NOT GIVEN district, state/);
  assert.ok(!/NOT GIVEN/.test(pages[1]), 'nothing flagged on a complete report');
  for (const p of pages) assert.ok(!/[–—]/.test(p), 'no long dashes');
});

test('Indian scripts are drawn in their own Noto font; a character no font has (an emoji) is left out', () => {
  const runs = CR._test.runsOf;
  CR._test.loadFonts();
  assert.deepEqual(runs('गली 4, आलमबाग').map((x) => x.key), ['devanagari', 'latin', 'devanagari']);
  assert.deepEqual(runs('ಸುಮಾ Rao').map((x) => [x.key, x.text]), [['kannada', 'ಸುಮಾ '], ['latin', 'Rao']]);
  assert.deepEqual(runs('குதிரை').map((x) => x.key), ['tamil']);
  assert.deepEqual(runs('help 😢 now').map((x) => x.text), ['help now'], 'one space where the emoji was');
  assert.deepEqual(runs('Asha', true).map((x) => x.key), ['latinBold']);
  for (const f of fs.readdirSync(path.join(ROOT, 'lib/report-fonts')).filter((x) => x.endsWith('.woff'))) {
    assert.ok(read('lib/cruelty-report.js').includes(`'report-fonts', '${f}'`), `${f} is named in full, so the bundlers carry it`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/report-fonts/OFL.txt')), 'the fonts\' licence travels with them');
});

test('on the 2nd: made once, emailed to gandhim alone, with the PDF attached', async () => {
  seed();
  const first = await CR.run({ db, nowMs: DEC2, siteUrl: 'https://peopleforanimalsindia.org' });
  assert.equal(first.state, 'sent', JSON.stringify(first));
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.to, 'gandhim@exmpls.sansad.in');
  assert.equal(m.cc, undefined, 'copied to no one');
  assert.equal(m.subject, 'PFA cruelty reports: November 2026 (6 reports)');
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].filename, 'PFA-cruelty-reports-2026-11.pdf');
  assert.equal(m.attachments[0].contentType, 'application/pdf');
  assert.equal(m.attachments[0].content.subarray(0, 5).toString(), '%PDF-');
  for (const bit of ['Monthly cruelty report', 'November 2026', '6 reports from 3 states', 'PFA-cruelty-reports-2026-11.pdf', 'Karnataka', 'Bengaluru Urban (2), Mysuru', 'Tamil Nadu', 'Uttar Pradesh', 'State not given', 'All states', 'Left out of this report: 1 marked as spam and 1 removed', 'on the 2nd of the month']) {
    assert.ok(m.html.includes(bit), bit);
  }
  assert.ok(!/[–—]/.test(m.html + m.text + m.subject), 'no long dashes');
  /* once: every later run that week leaves it alone */
  assert.equal((await CR.run({ db, nowMs: DEC2 + 600000 })).state, 'already');
  assert.equal((await CR.run({ db, nowMs: Date.parse('2026-12-08T10:00:00.000Z') })).state, 'already');
  assert.equal((await CR.run({ db, nowMs: Date.parse('2026-12-01T03:00:00.000Z') })).state, 'not-due');
  assert.equal(sent.length, 1);
  const kept = await CR.status(db, '2026-11');
  assert.equal(kept.state, 'sent');
  assert.equal(kept.count, 6);
  assert.deepEqual(kept.states.map((s) => s.state), ['Karnataka', 'Tamil Nadu', 'Uttar Pradesh', 'State not given']);
  assert.ok(kept.pdf && kept.pdf.size > 1000, 'the PDF is kept');
  assert.deepEqual(kept.sends.map((s) => s.state), ['queued', 'sent']);
  assert.equal((await CR.readPdf(db, '2026-11')).subarray(0, 5).toString(), '%PDF-');
});

test('two servers on the 2nd at once send it once', async () => {
  seed();
  const both = await Promise.all([CR.run({ db, nowMs: DEC2 }), CR.run({ db, nowMs: DEC2 })]);
  assert.deepEqual(both.map((x) => x.state).sort(), ['already', 'sent']);
  assert.equal(sent.length, 1);
});

test('a month with no reports still says so, with its PDF', async () => {
  const r = await CR.run({ db, nowMs: DEC2 });
  assert.equal(r.state, 'sent');
  assert.equal(sent[0].subject, 'PFA cruelty reports: November 2026 (0 reports)');
  assert.ok(sent[0].html.includes('No cruelty reports were filed on the website this month.'));
  assert.equal(sent[0].attachments.length, 1);
  const pages = await textOf(sent[0].attachments[0].content);
  assert.equal(pages.length, 1);
  assert.match(pages[0], /No cruelty reports were filed on the website this month\./);
});

test('with mail not set up it waits in the queue, and the worker sends it with the PDF', async () => {
  seed();
  delete process.env.PFA_SMTP_USER; delete process.env.PFA_SMTP_PASS;
  const r = await CR.run({ db, nowMs: DEC2 });
  assert.equal(r.state, 'queued');
  assert.equal(sent.length, 0);
  const row = db.dump()[`caregiverEmails/${r.emailId}`];
  assert.equal(row.template, 'cruelty_monthly');
  assert.equal(row.to, 'gandhim@exmpls.sansad.in');
  assert.equal(row.payload.reportMonth, '2026-11');
});

function call(method, { body, query } = {}, nowMs = DEC2) {
  const handler = ROUTE.createHandler({ getDb: () => db, requireAdmin: async () => ({ uid: 'u1', email: 'staff@pfa.test', role: 'super' }), now: () => nowMs });
  return new Promise((resolve, reject) => {
    const out = { status: 200, headers: {} };
    const response = { set statusCode(v) { out.status = v; }, get statusCode() { return out.status; }, setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      end(raw) { out.raw = raw; try { out.json = JSON.parse(String(raw || '{}')); } catch (_) { out.json = null; } resolve(out); } };
    Promise.resolve(handler({ method, url: '/api/admin/cruelty-report', query: query || {}, body, headers: {} }, response)).catch(reject);
  });
}

test('the panel: twelve months with this one so far, a PDF for any, and send again (logged)', async () => {
  seed();
  report('PFA-CR-2026-00201', '2026-12-01T20:00:00.000Z', { name: 'December Person' });
  await CR.run({ db, nowMs: DEC2 });
  const list = await call('GET');
  assert.equal(list.status, 200);
  assert.equal(list.json.months.length, 12);
  assert.deepEqual(list.json.months.slice(0, 2).map((m) => [m.month, m.current]), [['2026-12', true], ['2026-11', false]]);
  assert.equal(list.json.months[1].report.count, 6);
  assert.deepEqual(list.json.recipients, { to: 'gandhim@exmpls.sansad.in' });
  const pdf = await call('GET', { query: { month: '2026-11', format: 'pdf' } });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal(pdf.headers['content-disposition'], 'attachment; filename="PFA-cruelty-reports-2026-11.pdf"');
  assert.equal(Buffer.from(pdf.raw).subarray(0, 5).toString(), '%PDF-');
  const sofar = await call('GET', { query: { month: '2026-12', format: 'pdf' } });
  assert.equal(sofar.status, 200);
  assert.match((await textOf(Buffer.from(sofar.raw))).join(' '), /December Person/, 'this month, so far');
  assert.equal((await call('POST', { body: { action: 'send', month: '2026-12' } })).status, 422, 'a month not ended');
  assert.equal((await call('GET', { query: { month: '2026-13', format: 'pdf' } })).status, 400);
  const again = await call('POST', { body: { action: 'send', month: '2026-11' } });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.equal(sent.length, 2);
  assert.deepEqual(again.json.report.sends.map((s) => s.state), ['queued', 'sent', 'queued', 'sent']);
});

test('wired: the worker runs it (off in tests), the route is registered, the browser is kept out, the panel has it', () => {
  const worker = read('lib/routes/caregiver/email-worker.js');
  assert.match(worker, /PFA_CRUELTY_REPORT[\s\S]*off \? \{ state: 'not-due' \} : await require\('\.\.\/\.\.\/cruelty-report'\)\.run\(/);
  assert.equal(process.env.PFA_CRUELTY_REPORT, 'off');
  const api = read('api/index.js');
  assert.match(api, /'admin\/cruelty-report': '\.\/admin\/cruelty-report\.js'/);
  assert.match(api, /'admin\/cruelty-report': \(\) => require\('\.\.\/lib\/routes\/admin\/cruelty-report\.js'\)/);
  assert.match(read('firestore.rules'), /match \/cruelty_reports\/\{id\}\s+\{ allow read, write: if false; \}/);
  const admin = read('admin.html');
  assert.match(admin, /<details class="fold fr" id="crFold"><summary>Monthly cruelty report<\/summary>/);
  assert.match(admin, /\/api\/admin\/cruelty-report\?month=' \+ encodeURIComponent\(month\) \+ '&format=pdf'/);
  assert.match(read('package.json'), /"pdfkit": "\^0\.17\.2"/);
  assert.match(read('functions/package.json'), /"pdfkit": "\^0\.17\.2"/, 'the Firebase worker can make it too');
});
